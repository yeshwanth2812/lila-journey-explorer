import { MAP_SIZE, EVENT_META, MARKER_CODES, COLORS, fmtTime } from './constants.js';
import { upperBound, isMovement } from './data.js';

/** Canvas viewer: minimap + heatmap + journeys + event markers, with zoom/pan and hover. */
export class Viewer {
  constructor(canvas, tooltip) {
    this.c = canvas; this.ctx = canvas.getContext('2d'); this.tip = tooltip;
    this.view = { k: 1, x: 0, y: 0 };
    this.img = null; this.heat = null; this.mapInfo = null;
    this.matches = []; this.opts = {}; this.tc = Infinity; this.hover = null; this.pins = []; this.hot = null; this.onPin = null;
    this._raf = 0;
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
    this.bind();
  }

  setMap(img, info) { this.img = img; this.mapInfo = info; this.resetView(); }
  setData(matches, opts, tc, heat, pins = [], hot = null) { this.matches = matches; this.opts = opts; this.tc = tc; this.heat = heat; this.pins = pins; this.hot = hot; this.requestDraw(); }

  /** smoothly centre on a minimap-pixel point and zoom in */
  focus(px, py, zoom = 3.2) {
    const from = { ...this.view }, k = this.fit * zoom, to = { k, x: this.w / 2 - px * k, y: this.h / 2 - py * k }, t0 = performance.now();
    const step = now => { const f = Math.min(1, (now - t0) / 350), e = 1 - Math.pow(1 - f, 3);
      this.view = { k: from.k + (to.k - from.k) * e, x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e }; this.draw(); if (f < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  }
  pinAt(mx, my) {
    for (const pin of this.pins) { const sx = pin.px * this.view.k + this.view.x, sy = pin.py * this.view.k + this.view.y; if ((sx - mx) ** 2 + (sy - my) ** 2 < 15 * 15) return pin; }
    return null;
  }

  resize() {
    const p = this.c.parentElement, dpr = window.devicePixelRatio || 1;
    this.w = p.clientWidth; this.h = p.clientHeight;
    this.c.width = Math.round(this.w * dpr); this.c.height = Math.round(this.h * dpr);
    this.c.style.width = this.w + 'px'; this.c.style.height = this.h + 'px';
    this.dpr = dpr; this.resetView();
  }
  resetView() {
    if (!this.w) return;
    const fit = Math.min(this.w, this.h) / MAP_SIZE;
    this.fit = fit;
    this.view = { k: fit, x: (this.w - MAP_SIZE * fit) / 2, y: (this.h - MAP_SIZE * fit) / 2 };
    this.requestDraw();
  }
  zoomBy(f, cx = this.w / 2, cy = this.h / 2) {
    const v = this.view, k = Math.min(this.fit * 12, Math.max(this.fit * 0.9, v.k * f)), r = k / v.k;
    v.x = cx - (cx - v.x) * r; v.y = cy - (cy - v.y) * r; v.k = k; this.requestDraw();
  }
  toWorldPx(mx, my) { return [(mx - this.view.x) / this.view.k, (my - this.view.y) / this.view.k]; }

  bind() {
    const c = this.c; let drag = null;
    c.addEventListener('wheel', e => { e.preventDefault(); const r = c.getBoundingClientRect(); this.zoomBy(e.deltaY < 0 ? 1.18 : 1 / 1.18, e.clientX - r.left, e.clientY - r.top); }, { passive: false });
    c.addEventListener('pointerdown', e => { c.setPointerCapture(e.pointerId); drag = { x: e.clientX, y: e.clientY, vx: this.view.x, vy: this.view.y }; c.classList.add('grabbing'); });
    c.addEventListener('pointerup', e => {
      const moved = drag && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 4; drag = null; c.classList.remove('grabbing');
      if (!moved) { const r = c.getBoundingClientRect(), pin = this.pinAt(e.clientX - r.left, e.clientY - r.top); if (pin && this.onPin) this.onPin(pin); }
    });
    c.addEventListener('pointermove', e => {
      const r = c.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
      if (drag) { this.view.x = drag.vx + e.clientX - drag.x; this.view.y = drag.vy + e.clientY - drag.y; this.hideTip(); this.requestDraw(); return; }
      this.updateHover(mx, my, e.clientX, e.clientY);
    });
    c.addEventListener('pointerleave', () => this.hideTip());
    c.addEventListener('dblclick', () => this.resetView());
  }

  requestDraw() { if (!this._raf) this._raf = requestAnimationFrame(() => { this._raf = 0; this.draw(); }); }

  /** iterate visible marker events (respecting filters + time cursor) */
  *markers() {
    const { humans, bots, events } = this.opts;
    for (const m of this.matches) for (const p of m.p) {
      if (p.bot ? !bots : !humans) continue;
      const n = upperBound(p.t, this.tc);
      for (let i = 0; i < n; i++) { const e = p.e[i]; if (e >= 2 && events[e]) yield { m, p, i, e }; }
    }
  }

  draw() {
    const { ctx, view: v, dpr } = this; if (!this.w) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#05070b'; ctx.fillRect(0, 0, this.w, this.h);
    ctx.setTransform(dpr * v.k, 0, 0, dpr * v.k, dpr * v.x, dpr * v.y);
    ctx.imageSmoothingQuality = 'high';
    if (this.img) ctx.drawImage(this.img, 0, 0, MAP_SIZE, MAP_SIZE);
    const o = this.opts;
    if (o.heat !== 'off' && this.heat) {
      ctx.fillStyle = 'rgba(0,0,0,.42)'; ctx.fillRect(0, 0, MAP_SIZE, MAP_SIZE);   // dim minimap so the overlay reads
      ctx.globalAlpha = o.heatOpacity; ctx.imageSmoothingEnabled = true; ctx.drawImage(this.heat, 0, 0, MAP_SIZE, MAP_SIZE); ctx.globalAlpha = 1;
    }
    const many = this.matches.length > 1, px = 1 / v.k;
    if (o.paths) this.drawPaths(many, px);
    if (o.heat === 'off' || o.markersOverHeat) this.drawMarkers(px, many);
    this.drawHeads(px);
    this.drawPins();
  }

  /** numbered hotspot callouts, drawn in screen space so they stay readable at any zoom; labels dodge each other */
  drawPins() {
    if (!this.pins.length || this.opts.heat === 'off') return;
    const ctx = this.ctx, v = this.view; ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.font = '600 12px ui-sans-serif,system-ui,sans-serif'; ctx.textBaseline = 'middle';
    const pts = this.pins.map(pin => ({ pin, x: pin.px * v.k + v.x, y: pin.py * v.k + v.y })).filter(o => o.x > -40 && o.y > -20 && o.x < this.w + 40 && o.y < this.h + 20);
    const hit = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    const placed = pts.map(o => ({ x: o.x - 13, y: o.y - 13, w: 26, h: 26 }));          // every pin circle is an obstacle
    for (const o of pts) {
      const w = ctx.measureText(o.pin.label).width + 18, h = 24, { x, y } = o;
      const cands = [[x + 20, y - 12], [x - 20 - w, y - 12], [x - w / 2, y - 40], [x - w / 2, y + 16], [x + 20, y - 34], [x - 20 - w, y + 10]];
      let best = cands.find(([bx, by]) => bx > 4 && bx + w < this.w - 4 && by > 4 && by + h < this.h - 4 && !placed.some(r => hit({ x: bx, y: by, w, h }, r))) || cands[0];
      o.box = { x: best[0], y: best[1], w, h }; placed.push(o.box);
    }
    for (const o of pts) {
      const { x: bx, y: by, w: bw } = o.box;
      ctx.fillStyle = 'rgba(8,11,16,.9)'; ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.roundRect(bx, by, bw, 24, 12); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.textAlign = 'left'; ctx.fillText(o.pin.label, bx + 9, by + 12.5);
    }
    for (const o of pts) {
      ctx.beginPath(); ctx.arc(o.x, o.y, 12, 0, 7); ctx.fillStyle = '#fff'; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = '#0b0f16'; ctx.stroke();
      ctx.fillStyle = '#0b0f16'; ctx.textAlign = 'center'; ctx.fillText(String(o.pin.rank), o.x, o.y + 0.5);
    }
  }

  drawPaths(many, px) {
    const ctx = this.ctx, { humans, bots } = this.opts;
    for (const bot of [true, false]) {           // humans on top of bots
      if (bot ? !bots : !humans) continue;
      ctx.strokeStyle = bot ? COLORS.bot : COLORS.human;
      ctx.globalAlpha = many ? (bot ? 0.22 : 0.38) : (bot ? 0.7 : 0.95);
      ctx.lineWidth = (many ? 1.1 : bot ? 1.4 : 2.2) * Math.max(px, 0.35) * (many ? 1.2 : 1.3);
      ctx.lineJoin = 'round'; ctx.beginPath();
      for (const m of this.matches) for (const p of m.p) {
        if (p.bot !== bot) continue;
        const n = upperBound(p.t, this.tc); let pen = false;
        for (let i = 0; i < n; i++) {
          if (!isMovement(p.e[i])) continue;
          if (!pen) { ctx.moveTo(p.px[i], p.py[i]); pen = true; } else ctx.lineTo(p.px[i], p.py[i]);
        }
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  drawMarkers(px, many) {
    const ctx = this.ctx; ctx.lineJoin = 'round';
    const groups = {};
    for (const mk of this.markers()) (groups[mk.e] ||= []).push(mk);
    const order = [2, 5, 6, 3, 4, 7];                 // loot first so combat/storm render on top
    for (const e of order) {
      const list = groups[e]; if (!list) continue; const meta = EVENT_META[e];
      const s = meta.size * Math.max(px, 0.25) * (many ? 0.8 : 1.15);
      ctx.globalAlpha = many ? (e === 2 ? 0.55 : 0.85) : 1;
      ctx.fillStyle = meta.color; ctx.strokeStyle = 'rgba(0,0,0,.75)'; ctx.lineWidth = s * 0.28;
      for (const { p, i } of list) glyph(ctx, meta.glyph, p.px[i], p.py[i], s, meta.color);
    }
    ctx.globalAlpha = 1;
  }

  /** moving dots for each player when a single match is selected */
  drawHeads(px) {
    if (this.matches.length !== 1 || !isFinite(this.tc)) return;
    const ctx = this.ctx, { humans, bots } = this.opts;
    for (const p of this.matches[0].p) {
      if (p.bot ? !bots : !humans) continue;
      const n = upperBound(p.t, this.tc); if (!n) continue;
      let i = n - 1; while (i > 0 && !isMovement(p.e[i])) i--;
      const dead = p.e.slice(0, n).some(e => e === 4 || e === 6 || e === 7);
      const last = p.t[p.t.length - 1] <= this.tc;
      if (dead && last) continue;                      // player is gone after their death
      ctx.beginPath(); ctx.arc(p.px[i], p.py[i], (p.bot ? 4 : 5.5) * px, 0, 7);
      ctx.fillStyle = p.bot ? COLORS.bot : COLORS.human; ctx.fill();
      ctx.lineWidth = 1.6 * px; ctx.strokeStyle = '#fff'; ctx.stroke();
    }
  }

  updateHover(mx, my, cx, cy) {
    const r0 = this.c.parentElement.getBoundingClientRect(), place = () => { this.tip.style.left = Math.min(cx - r0.left + 14, r0.width - 250) + 'px'; this.tip.style.top = Math.max(cy - r0.top - 10, 4) + 'px'; this.tip.hidden = false; };
    const pin = this.opts.heat !== 'off' ? this.pinAt(mx, my) : null;
    if (pin) { this.tip.innerHTML = `<b>Hotspot #${pin.rank}</b><br>${pin.detail}<br><span style="color:#8b97a8">Click to zoom in</span>`; place(); this.c.style.cursor = 'pointer'; return; }
    if (this.opts.heat !== 'off' && !this.opts.markersOverHeat && this.hot) {
      const [wx0, wy0] = this.toWorldPx(mx, my), h = this.hot, i = Math.floor(wx0 / MAP_SIZE * h.G), j = Math.floor(wy0 / MAP_SIZE * h.G);
      if (i < 0 || j < 0 || i >= h.G || j >= h.G) return this.hideTip();
      const n = h.counts[j * h.G + i];
      this.tip.innerHTML = `<b>${n.toLocaleString()} ${h.noun}</b> in this ~${h.cellM} m square<br><span style="color:#8b97a8">${h.total ? (n / h.total * 100).toFixed(1) : 0}% of all ${h.noun} shown</span>`;
      place(); this.c.style.cursor = ''; return;
    }
    let best = null, bd = 100; const [wx, wy] = this.toWorldPx(mx, my), lim = 9 / this.view.k;
    if (this.opts.heat === 'off' || this.opts.markersOverHeat) for (const mk of this.markers()) {
      const dx = mk.p.px[mk.i] - wx, dy = mk.p.py[mk.i] - wy, d = dx * dx + dy * dy;
      if (d < lim * lim && d < bd) { bd = d; best = mk; }
    }
    if (!best) return this.hideTip();
    const { m, p, i, e } = best, meta = EVENT_META[e], q = this.opts.q, mi = this.mapInfo;
    const u = p.u[i] / q, vv = p.v[i] / q;
    this.tip.innerHTML = `<b style="color:${meta.color}">${meta.label}</b><br>${p.bot ? 'Bot' : 'Human'} <code>${p.id.length > 12 ? p.id.slice(0, 8) + '…' : p.id}</code><br>Match time ${fmtTime(p.t[i])} · match <code>${m.id.slice(0, 8)}</code><br>World x ${(mi.ox + u * mi.scale).toFixed(0)}, z ${(mi.oz + vv * mi.scale).toFixed(0)}`;
    const r = this.c.parentElement.getBoundingClientRect();
    this.tip.style.left = Math.min(cx - r.left + 14, r.width - 230) + 'px'; this.tip.style.top = Math.max(cy - r.top - 10, 4) + 'px';
    this.tip.hidden = false; this.c.style.cursor = 'pointer';
  }
  hideTip() { this.tip.hidden = true; this.c.style.cursor = ''; }
}

function glyph(ctx, kind, x, y, s, color) {
  ctx.beginPath();
  if (kind === 'circle') { ctx.arc(x, y, s, 0, 7); }
  else if (kind === 'diamond') { ctx.moveTo(x, y - s); ctx.lineTo(x + s, y); ctx.lineTo(x, y + s); ctx.lineTo(x - s, y); ctx.closePath(); }
  else if (kind === 'triangle') { ctx.moveTo(x, y + s); ctx.lineTo(x + s, y - s * .8); ctx.lineTo(x - s, y - s * .8); ctx.closePath(); }
  else if (kind === 'cross') {
    const a = s * .85, t = s * .38;
    ctx.moveTo(x - a, y - a + t); ctx.lineTo(x - a + t, y - a); ctx.lineTo(x, y - t); ctx.lineTo(x + a - t, y - a); ctx.lineTo(x + a, y - a + t);
    ctx.lineTo(x + t, y); ctx.lineTo(x + a, y + a - t); ctx.lineTo(x + a - t, y + a); ctx.lineTo(x, y + t); ctx.lineTo(x - a + t, y + a);
    ctx.lineTo(x - a, y + a - t); ctx.lineTo(x - t, y); ctx.closePath();
  }
  ctx.fillStyle = color; ctx.fill(); ctx.stroke();
}
