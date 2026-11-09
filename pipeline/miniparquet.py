"""Minimal, dependency-free Parquet reader (enough for the LILA telemetry files).

Why: keeps the data pipeline runnable with only the Python stdlib. Supports
PLAIN / RLE / RLE_DICTIONARY / PLAIN_DICTIONARY encodings, flat required/optional
columns, UNCOMPRESSED / GZIP codecs (+ SNAPPY via a tiny pure-python decoder).
For anything fancier use pyarrow; this is a fallback, verified against the dataset.
"""
import struct, zlib

# ---------- Thrift compact protocol (just what parquet metadata needs) ----------
class _T:
    def __init__(self, b, p=0): self.b, self.p = b, p
    def byte(self):
        v = self.b[self.p]; self.p += 1; return v
    def varint(self):
        r = s = 0
        while True:
            c = self.byte(); r |= (c & 0x7F) << s
            if not c & 0x80: return r
            s += 7
    def zz(self):
        n = self.varint(); return (n >> 1) ^ -(n & 1)
    def binary(self):
        n = self.varint(); v = self.b[self.p:self.p + n]; self.p += n; return v
    def value(self, t):
        if t in (1, 2): return t == 1
        if t == 3: return struct.unpack('b', bytes([self.byte()]))[0]
        if t in (4, 5, 6): return self.zz()
        if t == 7:
            v = struct.unpack('<d', self.b[self.p:self.p + 8])[0]; self.p += 8; return v
        if t == 8: return self.binary()
        if t in (9, 10):
            h = self.byte(); n = h >> 4; et = h & 15
            if n == 15: n = self.varint()
            return [self.value(et) for _ in range(n)]
        if t == 12: return self.struct()
        raise ValueError('thrift type %d' % t)
    def struct(self):
        out, last = {}, 0
        while True:
            h = self.byte()
            if h == 0: return out
            t = h & 15; d = h >> 4
            fid = last + d if d else self.zz()
            last = fid
            out[fid] = self.value(t)

# ---------- Snappy (raw block format) ----------
def _snappy(data):
    p = 0; n = 0; s = 0
    while True:
        c = data[p]; p += 1; n |= (c & 0x7F) << s
        if not c & 0x80: break
        s += 7
    out = bytearray()
    while p < len(data):
        tag = data[p]; p += 1; k = tag & 3
        if k == 0:
            ln = tag >> 2
            if ln >= 60:
                nb = ln - 59; ln = int.from_bytes(data[p:p + nb], 'little'); p += nb
            ln += 1; out += data[p:p + ln]; p += ln
        else:
            if k == 1: ln = 4 + ((tag >> 2) & 7); off = ((tag >> 5) << 8) | data[p]; p += 1
            elif k == 2: ln = 1 + (tag >> 2); off = int.from_bytes(data[p:p + 2], 'little'); p += 2
            else: ln = 1 + (tag >> 2); off = int.from_bytes(data[p:p + 4], 'little'); p += 4
            for _ in range(ln): out.append(out[-off])
    return bytes(out)

def _decompress(codec, data):
    if codec == 0: return data
    if codec == 1: return _snappy(data)
    if codec == 2: return zlib.decompress(data, 31)
    raise NotImplementedError('codec %d' % codec)

# ---------- RLE / bit-packed hybrid ----------
def _rle(buf, p, bw, count):
    out = []
    while len(out) < count:
        h = 0; s = 0
        while True:
            c = buf[p]; p += 1; h |= (c & 0x7F) << s
            if not c & 0x80: break
            s += 7
        if h & 1:
            groups = h >> 1; nvals = groups * 8; nbytes = groups * bw
            bits = int.from_bytes(buf[p:p + nbytes], 'little'); p += nbytes
            m = (1 << bw) - 1
            out.extend((bits >> (i * bw)) & m for i in range(nvals))
        else:
            run = h >> 1; w = (bw + 7) // 8
            v = int.from_bytes(buf[p:p + w], 'little'); p += w
            out.extend([v] * run)
    return out[:count], p

_FMT = {1: ('<i', 4), 2: ('<q', 8), 4: ('<f', 4), 5: ('<d', 8)}

def _plain(buf, p, ptype, n):
    out = []
    if ptype == 6:  # BYTE_ARRAY
        for _ in range(n):
            ln = struct.unpack_from('<I', buf, p)[0]; p += 4
            out.append(bytes(buf[p:p + ln])); p += ln
    elif ptype == 0:
        for i in range(n): out.append(bool(buf[p + i // 8] >> (i % 8) & 1))
    else:
        f, sz = _FMT[ptype]
        out = [struct.unpack_from(f, buf, p + i * sz)[0] for i in range(n)]
    return out

def read_parquet(path):
    """Return (column_names, {name: list}) for a flat parquet file."""
    b = open(path, 'rb').read()
    assert b[:4] == b'PAR1' and b[-4:] == b'PAR1', 'not parquet'
    flen = struct.unpack('<I', b[-8:-4])[0]
    meta = _T(b, len(b) - 8 - flen).struct()
    schema = meta[2][1:]  # skip root
    names = [s[4].decode() for s in schema]
    optional = [s.get(3, 1) == 1 for s in schema]
    cols = {n: [] for n in names}
    for rg in meta[4]:
        for ci, cc in enumerate(rg[1]):
            cm = cc[3]; ptype = cm[1]; codec = cm[4]
            p = cm[11] if 11 in cm else cm[9]
            end = p + cm[7]; dictv = None; vals = []
            while p < end:
                t = _T(b, p); ph = t.struct(); p = t.p
                raw = _decompress(codec, b[p:p + ph[3]]); p += ph[3]
                if ph[1] == 2:  # dictionary page
                    dictv = _plain(raw, 0, ptype, ph[7][1])
                elif ph[1] in (0, 3):
                    dh = ph[5] if ph[1] == 0 else ph[8]
                    n = dh[1]; enc = dh[2]; q = 0
                    if ph[1] == 3:
                        rl = dh[5]; dl = dh[6]; q = rl
                        defs = _rle(raw, q, 1, n)[0] if optional[ci] and dl else [1] * n
                        q += dl
                    else:
                        if optional[ci]:
                            dl_len = struct.unpack_from('<I', raw, 0)[0]
                            defs = _rle(raw, 4, 1, n)[0]; q = 4 + dl_len
                        else: defs = [1] * n
                    nn = sum(defs)
                    if enc in (2, 8):
                        bw = raw[q]; idx, _ = _rle(raw, q + 1, bw, nn)
                        vs = [dictv[i] for i in idx]
                    else:
                        vs = _plain(raw, q, ptype, nn)
                    it = iter(vs)
                    vals.extend(next(it) if d else None for d in defs)
            cols[names[ci]].extend(vals)
    return names, cols
