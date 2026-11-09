#!/usr/bin/env python3
"""LILA BLACK telemetry -> compact static JSON for the web viewer.

    python pipeline/build_data.py --src /path/to/player_data --out web

Reads every parquet file (pyarrow if installed, otherwise the bundled pure-Python
reader), normalises the data and writes:

    web/data/index.json            maps, days, match list (small, loaded on start)
    web/data/<MapId>.json          all journeys for one map (lazy loaded)
    web/maps/<MapId>.webp          2048px minimaps

Normalisation done here (so the browser never has to think about it):
  * event bytes -> str, event -> small int code
  * ts: raw values are epoch *seconds* although the schema says ms -> rebased to
    seconds since the first event of the match (so all players in a match align)
  * world (x, z) -> minimap UV in [0,1] using the README formula; y (elevation) dropped
  * bot detection by event evidence (BotPosition) with filename fallback
"""
import argparse, json, os, sys
from collections import defaultdict
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

MAPS = {  # README "Map Configuration"
    "AmbroseValley": dict(scale=900, ox=-370, oz=-473, label="Ambrose Valley", img="AmbroseValley_Minimap.png"),
    "GrandRift":     dict(scale=581, ox=-290, oz=-290, label="Grand Rift",     img="GrandRift_Minimap.png"),
    "Lockdown":      dict(scale=1000, ox=-500, oz=-500, label="Lockdown",      img="Lockdown_Minimap.jpg"),
}
EVENTS = ["Position", "BotPosition", "Loot", "Kill", "Killed", "BotKill", "BotKilled", "KilledByStorm"]
CODE = {e: i for i, e in enumerate(EVENTS)}
Q = 10000  # UV quantisation (1e-4 of the map ~ 0.1 px on a 1024 minimap)


def read_file(path):
    try:
        import pyarrow.parquet as pq
        tbl = pq.read_table(path)
        t = tbl.to_pydict()
        t["ts"] = tbl.column("ts").cast("int64").to_pylist()   # raw int, NOT a datetime (see ts note in docstring)
    except ImportError:
        from miniparquet import read_parquet
        _, t = read_parquet(path)
    ev = [e.decode() if isinstance(e, bytes) else e for e in t["event"]]
    s = lambda c: [v.decode() if isinstance(v, bytes) else v for v in t[c]]
    ts = [int(v) for v in t["ts"]]
    return dict(user=s("user_id")[0], match=s("match_id")[0], map=s("map_id")[0],
                x=list(t["x"]), z=list(t["z"]), ts=ts, ev=ev)


def world_to_uv(m, x, z):
    c = MAPS[m]
    return (x - c["ox"]) / c["scale"], (z - c["oz"]) / c["scale"]   # v NOT flipped here; renderer flips


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True); ap.add_argument("--out", default="web")
    a = ap.parse_args()
    files = []
    for day in sorted(d for d in os.listdir(a.src) if d.startswith("February_")):
        for f in sorted(os.listdir(os.path.join(a.src, day))):
            if not f.startswith("."):
                files.append((day, os.path.join(a.src, day, f)))
    matches = defaultdict(lambda: dict(players=[], days=set()))
    oob = 0
    for day, p in files:
        r = read_file(p)
        evset = set(r["ev"])
        # Bot = emits BotPosition. Filename rule (numeric id) is only the fallback:
        # 17 numeric-id files actually carry human events (Position/Loot).
        if "BotPosition" in evset: bot = True
        elif "Position" in evset: bot = False
        else: bot = r["user"].isdigit()
        m = matches[r["match"]]
        m["map"] = r["map"]; m["days"].add(day)
        m["players"].append(dict(id=r["user"], bot=bot, r=r))
    out_matches = {k: [] for k in MAPS}
    index_matches = []
    for mid, m in matches.items():
        t0 = min(min(p["r"]["ts"]) for p in m["players"])
        t1 = max(max(p["r"]["ts"]) for p in m["players"])
        day = datetime.fromtimestamp(t0, timezone.utc).strftime("%Y-%m-%d")
        folder = sorted(m["days"])[0]
        players = []
        for p in sorted(m["players"], key=lambda p: (p["bot"], p["id"])):
            r = p["r"]; mp = m["map"]
            order = sorted(range(len(r["ts"])), key=lambda i: r["ts"][i])  # stable
            T, U, V, E = [], [], [], []
            for i in order:
                u, v = world_to_uv(mp, r["x"][i], r["z"][i])
                if not (0 <= u <= 1 and 0 <= v <= 1): oob += 1
                T.append(r["ts"][i] - t0); U.append(round(u * Q)); V.append(round(v * Q)); E.append(CODE[r["ev"][i]])
            players.append(dict(id=p["id"], bot=p["bot"], t=T, u=U, v=V, e=E))
        out_matches[m["map"]].append(dict(id=mid, day=folder, dur=t1 - t0, p=players))
        cnt = lambda codes: sum(1 for pl in players for e in pl["e"] if e in codes)
        index_matches.append(dict(
            id=mid, map=m["map"], day=folder, utc=day, dur=t1 - t0,
            humans=sum(not p["bot"] for p in players), bots=sum(p["bot"] for p in players),
            loot=cnt({2}), kills=cnt({3, 5}), deaths=cnt({4, 6, 7}), storm=cnt({7}), pvp=cnt({3, 4})))
    os.makedirs(os.path.join(a.out, "data"), exist_ok=True)
    os.makedirs(os.path.join(a.out, "maps"), exist_ok=True)
    index_matches.sort(key=lambda m: (m["day"], m["map"], m["id"]))
    days = sorted({m["day"] for m in index_matches})
    index = dict(maps={k: dict(label=v["label"], scale=v["scale"], ox=v["ox"], oz=v["oz"]) for k, v in MAPS.items()},
                 events=EVENTS, q=Q, days=days, matches=index_matches)
    json.dump(index, open(os.path.join(a.out, "data", "index.json"), "w"), separators=(",", ":"))
    for k, ms in out_matches.items():
        ms.sort(key=lambda m: m["id"])
        json.dump(dict(map=k, matches=ms), open(os.path.join(a.out, "data", k + ".json"), "w"), separators=(",", ":"))
    mism = [m["id"] for m in index_matches if m["utc"][-2:] != m["day"][-2:]]
    print(f"{len(files)} files, {len(matches)} matches, out-of-bounds points: {oob}, folder/UTC-date mismatches: {len(mism)}")
    # minimaps
    from PIL import Image
    Image.MAX_IMAGE_PIXELS = None
    mm = os.path.join(a.src, "minimaps")
    for k, c in MAPS.items():
        im = Image.open(os.path.join(mm, c["img"]))
        if im.mode == "RGBA":  # composite on black so transparent edges match the in-game void
            bg = Image.new("RGB", im.size, (0, 0, 0)); bg.paste(im, mask=im.split()[3]); im = bg
        im = im.convert("RGB").resize((2048, 2048), Image.LANCZOS)  # GrandRift is 2160x2158 -> square-normalised
        im.save(os.path.join(a.out, "maps", k + ".webp"), quality=82)


if __name__ == "__main__":
    main()
