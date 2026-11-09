import { EVENT_META, MARKER_CODES, HEAT_MODES, fmtTime, dayLabel } from './constants.js';
import { loadIndex, loadMap, selectMatches, upperBound } from './data.js';
import { buildHeat, heatGradientCss } from './heatmap.js';
import { Viewer } from './viewer.js';

const $ = id => document.getElementById(id);
const S = {                                  // single source of truth for UI state
  map: 'AmbroseValley', days: new Set(), matchId: null, sort: 'date', onlyHumans: false,
  humans: true, bots: true, paths: true, events: Object.fromEntries(MARKER_CODES.map(c => [c, true])),
  heat: 'off', heatOpacity: 0.8, heatRadius: 6, markersOverHeat: false,
  t: Infinity, playing: false, speed: 10,
};
let index, mapData, viewer, sel = [], maxT = 0, metaById = new Map();
const imgs = {};

init().catch(e => { $('loading').textContent = 'Failed to load data: ' + e.message; console.error(e); });

async function init() {
  index = await loadIndex();
  index.matches.forEach(m => metaById.set(m.id, m));
  S.days = new Set(index.days);
  readHash();
  viewer = new Viewer($('canvas'), $('tip'));
  buildStaticUI();
  await setMap(S.map, true);
  $('loading').classList.add('done');
  window.addEventListener('keydown', onKey);
}

/* ---------------- state transitions ---------------- */
async function setMap(map, first = false) {
  S.map = map; if (!first) S.matchId = null;
  $('loading').classList.remove('done'); $('loading').textContent = 'Loading ' + index.maps[map].label + '…';
  const [md, img] = await Promise.all([loadMap(map, index.q), loadImg(map)]);
  if (S.map !== map) return;                      // user switched again while loading
  mapData = md; viewer.setMap(img, index.maps[map]); viewer.resize();
  $('loading').classList.add('done');
  refresh(true);
}
function loadImg(map) {
  if (imgs[map]) return imgs[map];
  return imgs[map] = new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = `maps/${map}.webp`; });
}

/** Recompute everything that depends on filters. `resetTime` jumps the cursor to the end (full journey). */
function refresh(resetTime) {
  const metaOk = m => !S.onlyHumans || metaById.get(m.id).humans > 0;
  sel = selectMatches(mapData, S.days, S.matchId).filter(metaOk);
  maxT = sel.reduce((a, m) => Math.max(a, m.dur), 0);
  if (resetTime) { S.t = maxT; stop(); }
  S.t = Math.min(S.t, maxT);
  renderMaps(); renderDays(); renderMatchList(); renderStats(); drawSpark(); redraw(true); saveHash();
  $('empty').hidden = sel.length > 0;
  const m = S.matchId && sel[0];
  $('badge').innerHTML = m ? `<b>Match ${m.id.slice(0, 8)}</b> · ${dayLabel(m.day)} · ${fmtTime(m.dur)} · ${m.p.filter(p => !p.bot).length} human, ${m.p.filter(p => p.bot).length} bot journeys`
    : `<b>${index.maps[S.map].label}</b> · ${sel.length} matches overlaid · all start at 00:00`;
}

let heatKey = '', heatCanvas = null, heatCount = 0, lastHeat = 0;
function redraw(force) {
  const tc = S.t >= maxT ? Infinity : S.t;
  if (S.heat !== 'off') {
    const key = [S.heat, S.map, S.matchId, [...S.days].join(), S.onlyHumans, S.humans, S.bots, S.heatRadius, Math.floor(S.t / (S.playing ? 3 : 1))].join('|');
    if (key !== heatKey && (force || performance.now() - lastHeat > 90)) {
      const r = buildHeat(sel, S.heat, { humans: S.humans, bots: S.bots, radius: S.heatRadius, tc });
      heatCanvas = r.canvas; heatCount = r.count; heatKey = key; lastHeat = performance.now();
    }
  }
  viewer.setData(sel, { humans: S.humans, bots: S.bots, paths: S.paths, events: S.events, heat: S.heat, heatOpacity: S.heatOpacity, markersOverHeat: S.markersOverHeat, q: index.q }, tc, heatCanvas);
  $('clock').textContent = `${fmtTime(Math.min(S.t, maxT))} / ${fmtTime(maxT)}`;
  const sc = $('scrub'); sc.max = Math.max(1, Math.ceil(maxT)); sc.value = Math.min(S.t, maxT);
  $('play').textContent = S.playing ? '⏸' : '▶';
  $('play').setAttribute('aria-label', S.playing ? 'Pause' : 'Play');
}

/* ---------------- playback ---------------- */
let last = 0;
function tick(ts) {
  if (!S.playing) return;
  S.t += (ts - last) / 1000 * S.speed; last = ts;
  if (S.t >= maxT) { S.t = maxT; S.playing = false; }
  redraw(false); renderStatsThrottled();
  if (S.playing) requestAnimationFrame(tick);
}
function play() { if (!maxT) return; if (S.t >= maxT) S.t = 0; S.playing = true; last = performance.now(); requestAnimationFrame(tick); redraw(true); }
function stop() { S.playing = false; }
let statTimer = 0;
function renderStatsThrottled() { if (!statTimer) statTimer = setTimeout(() => { statTimer = 0; renderStats(); }, 200); }

/* ---------------- UI ---------------- */
function buildStaticUI() {
  $('gradBar').style.background = heatGradientCss;
  // event legend / toggles
  const iconPath = { circle: '<circle cx="8" cy="8" r="5"/>', diamond: '<path d="M8 2l6 6-6 6-6-6z"/>', triangle: '<path d="M8 14 14 4H2z"/>', cross: '<path d="M3 5l2-2 3 3 3-3 2 2-3 3 3 3-2 2-3-3-3 3-2-2 3-3z"/>' };
  $('events').innerHTML = [2, 5, 6, 3, 4, 7].map(c => { const m = EVENT_META[c];
    return `<label title="${m.label}"><input type="checkbox" data-ev="${c}" checked><svg width="16" height="16" viewBox="0 0 16 16" fill="${m.color}" stroke="#000" stroke-opacity=".6">${iconPath[m.glyph]}</svg>${m.label}</label>`; }).join('');
  $('events').addEventListener('change', e => { const c = e.target.dataset.ev; if (c) { S.events[c] = e.target.checked; redraw(true); renderStats(); } });
  $('heatModes').innerHTML = ['off', ...Object.keys(HEAT_MODES)].map(k => `<button data-h="${k}">${k === 'off' ? 'Off' : HEAT_MODES[k].label}</button>`).join('');
  $('heatModes').addEventListener('click', e => { const k = e.target.closest('button')?.dataset.h; if (k) { S.heat = k; S.paths = k === 'off'; $('showPaths').checked = S.paths; syncHeatUI(); redraw(true); saveHash(); } });
  const bind = (id, key, ev = 'change', get = e => e.target.checked, after = () => { redraw(true); renderStats(); }) => $(id).addEventListener(ev, e => { S[key] = get(e); after(); });
  bind('showHumans', 'humans'); bind('showBots', 'bots'); bind('showPaths', 'paths'); bind('markersOverHeat', 'markersOverHeat');
  bind('heatOpacity', 'heatOpacity', 'input', e => e.target.value / 100, () => redraw(true));
  bind('heatRadius', 'heatRadius', 'input', e => +e.target.value, () => redraw(true));
  bind('onlyHumans', 'onlyHumans', 'change', e => e.target.checked, () => { if (S.matchId && !metaOk(S.matchId)) S.matchId = null; refresh(true); });
  $('sort').addEventListener('change', e => { S.sort = e.target.value; renderMatchList(); });
  $('allMatches').addEventListener('click', () => { S.matchId = null; refresh(true); });
  $('daysAll').addEventListener('click', () => { S.days = new Set(index.days); S.matchId = null; refresh(true); });
  $('play').addEventListener('click', () => S.playing ? stop() : play());
  $('scrub').addEventListener('input', e => { stop(); S.t = +e.target.value; redraw(true); renderStats(); });
  $('speed').addEventListener('change', e => S.speed = +e.target.value);
  $('zin').onclick = () => viewer.zoomBy(1.4); $('zout').onclick = () => viewer.zoomBy(1 / 1.4); $('zreset').onclick = () => viewer.resetView();
  $('maps').addEventListener('click', e => { const k = e.target.closest('button')?.dataset.map; if (k && k !== S.map) setMap(k); });
  $('days').addEventListener('click', e => {
    const d = e.target.closest('button')?.dataset.day; if (!d) return;
    if (S.days.has(d) && S.days.size > 1) S.days.delete(d); else S.days.add(d);
    S.matchId = null; refresh(true);
  });
  $('matchList').addEventListener('click', e => { const id = e.target.closest('.item')?.dataset.id; if (id) { S.matchId = id; refresh(true); } });
  new ResizeObserver(drawSpark).observe($('spark'));
  $('showHumans').checked = S.humans; $('onlyHumans').checked = S.onlyHumans; $('showPaths').checked = S.paths; syncHeatUI();
}
const metaOk = id => !S.onlyHumans || metaById.get(id).humans > 0;
function syncHeatUI() {
  [...$('heatModes').children].forEach(b => b.classList.toggle('on', b.dataset.h === S.heat));
  $('heatOpts').style.display = S.heat === 'off' ? 'none' : '';
  $('heatOpacity').value = S.heatOpacity * 100; $('heatRadius').value = S.heatRadius;
}
function renderMaps() {
  const counts = {}; index.matches.forEach(m => { if (S.days.has(m.day)) counts[m.map] = (counts[m.map] || 0) + 1; });
  $('maps').innerHTML = Object.entries(index.maps).map(([k, v]) => `<button data-map="${k}" class="${k === S.map ? 'on' : ''}"><span>${v.label}</span><small>${counts[k] || 0} matches</small></button>`).join('');
}
function renderDays() {
  const counts = {}; index.matches.forEach(m => { if (m.map === S.map) counts[m.day] = (counts[m.day] || 0) + 1; });
  $('days').innerHTML = index.days.map(d => `<button data-day="${d}" class="${S.days.has(d) ? 'on' : ''}">${dayLabel(d)}<small>${counts[d] || 0}</small></button>`).join('');
}
function renderMatchList() {
  let list = index.matches.filter(m => m.map === S.map && S.days.has(m.day) && (!S.onlyHumans || m.humans > 0));
  const by = { date: null, dur: m => -m.dur, kills: m => -m.kills, deaths: m => -m.deaths, loot: m => -m.loot }[S.sort];
  if (by) list = [...list].sort((a, b) => by(a) - by(b) || a.id.localeCompare(b.id));
  $('matchCount').textContent = `${list.length} in filter`;
  $('allMatches').classList.toggle('on', !S.matchId);
  let shown = list.slice(0, 400);
  const cur = list.find(m => m.id === S.matchId); if (cur && !shown.includes(cur)) shown = [cur, ...shown];   // keep the selection visible
  $('matchList').innerHTML = shown.map(m => `<div class="item ${m.id === S.matchId ? 'on' : ''}" data-id="${m.id}" role="option"><b>${m.id.slice(0, 8)}</b><span>${dayLabel(m.day)} · ${fmtTime(m.dur)}</span>
    <div class="tags"><span class="tag-h">${m.humans}H</span><span class="tag-b">${m.bots}B</span><span class="tag-l">◆${m.loot}</span><span class="tag-k">●${m.kills}</span><span class="tag-d">✕${m.deaths}</span>${m.storm ? `<span class="tag-s">▼${m.storm}</span>` : ''}</div></div>`).join('')
    + (list.length > 400 ? `<div class="item"><span>+${list.length - 400} more — narrow by date or sort</span></div>` : '') || '<div class="item"><span>No matches</span></div>';
  $('matchList').querySelector('.item.on')?.scrollIntoView({ block: 'nearest' });
}
function renderStats() {
  const c = { loot: 0, kills: 0, deaths: 0, storm: 0, h: 0, b: 0 };
  const tc = S.t >= maxT ? Infinity : S.t;
  for (const m of sel) for (const p of m.p) {
    if (p.bot ? !S.bots : !S.humans) continue;
    p.bot ? c.b++ : c.h++;
    const n = upperBound(p.t, tc);
    for (let i = 0; i < n; i++) { const e = p.e[i]; if (e === 2) c.loot++; else if (e === 3 || e === 5) c.kills++; else if (e === 4 || e === 6) c.deaths++; else if (e === 7) { c.deaths++; c.storm++; } }
  }
  const cell = (v, l) => `<div class="stat"><b>${v.toLocaleString()}</b><span>${l}</span></div>`;
  $('stats').innerHTML = cell(sel.length, 'matches') + cell(c.h, 'human journeys') + cell(c.b, 'bot journeys') + cell(c.loot, 'loot pickups') + cell(c.kills, 'kills') + cell(c.deaths, `deaths (${c.storm} storm)`);
}
function drawSpark() {
  const cv = $('spark'), w = cv.clientWidth, dpr = window.devicePixelRatio || 1; if (!w) return;
  cv.width = w * dpr; cv.height = 30 * dpr; const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, 30);
  if (!maxT) return;
  const B = Math.min(120, Math.max(30, Math.floor(w / 5))), bins = { loot: new Float32Array(B), kill: new Float32Array(B), death: new Float32Array(B) };
  for (const m of sel) for (const p of m.p) { if (p.bot) continue; for (let i = 0; i < p.t.length; i++) {
    const e = p.e[i]; if (e < 2) continue; const b = Math.min(B - 1, Math.floor(p.t[i] / maxT * B));
    (e === 2 ? bins.loot : e === 3 || e === 5 ? bins.kill : bins.death)[b]++; } }
  const mx = Math.max(1, ...bins.loot.map((v, i) => v + bins.kill[i] + bins.death[i])), bw = w / B;
  for (let i = 0; i < B; i++) { let y = 30;
    for (const [k, col] of [['loot', '#facc1599'], ['kill', '#fb923c'], ['death', '#ef4444']]) { const h = bins[k][i] / mx * 28; g.fillStyle = col; g.fillRect(i * bw + .5, y - h, bw - 1, h); y -= h; } }
}
function onKey(e) {
  if (e.target.matches('input[type=range],select') && e.code !== 'Space') return;
  if (e.code === 'Space') { e.preventDefault(); S.playing ? stop() : play(); redraw(true); }
  else if (e.code === 'ArrowRight' || e.code === 'ArrowLeft') { stop(); S.t = Math.max(0, Math.min(maxT, S.t + (e.code === 'ArrowRight' ? 5 : -5))); redraw(true); renderStats(); }
}

/* ---------------- shareable URL ---------------- */
function saveHash() {
  const p = new URLSearchParams({ map: S.map });
  if (S.days.size !== index.days.length) p.set('days', [...S.days].map(d => d.replace('February_', '')).join(','));
  if (S.matchId) p.set('match', S.matchId);
  if (S.heat !== 'off') p.set('heat', S.heat);
  if (S.onlyHumans) p.set('humans', '1');
  history.replaceState(null, '', '#' + p);
}
function readHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  if (index.maps[p.get('map')]) S.map = p.get('map');
  if (p.get('days')) { const ds = p.get('days').split(',').map(d => 'February_' + d).filter(d => index.days.includes(d)); if (ds.length) S.days = new Set(ds); }
  if (p.get('match') && metaById.has(p.get('match'))) { const m = metaById.get(p.get('match')); S.map = m.map; S.matchId = m.id; S.days = new Set(index.days); }
  if (HEAT_MODES[p.get('heat')]) { S.heat = p.get('heat'); S.paths = false; }
  S.onlyHumans = p.get('humans') === '1';
}
