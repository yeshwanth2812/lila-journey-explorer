import { EVENT_META, EV, HEAT_MODES, fmtTime, dayLabel } from './constants.js';
import { loadIndex, loadMap, selectMatches, upperBound } from './data.js';
import { buildHeat, coarseCounts, heatGradientCss } from './heatmap.js';
import { Viewer } from './viewer.js';
import { initAssistant } from './assistant.js';

const $ = id => document.getElementById(id);
const svg = d => `<svg viewBox="0 0 24 24" aria-hidden="true">${d}</svg>`;

/** The six "lenses" a designer can look through. Each one answers a plain question. */
const LENSES = {
  routes:  { label: 'Routes',  sub: 'Every player\'s path',       heat: 'off',     icon: svg('<path d="M4 19c3-9 5 1 8-6s5-2 8-8"/><circle cx="4" cy="19" r="1.5"/><circle cx="20" cy="5" r="1.5"/>') },
  traffic: { label: 'Traffic', sub: 'Where players go',           heat: 'traffic', icon: svg('<path d="M12 3c1 4 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-5 1-9z"/>'),           noun: 'position samples', share: 'of all movement' },
  kills:   { label: 'Fights',  sub: 'Where players get kills',    heat: 'kills',   icon: svg('<circle cx="12" cy="12" r="7"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/>'),                    noun: 'kills',            share: 'of kills' },
  deaths:  { label: 'Deaths',  sub: 'Where players die',          heat: 'deaths',  icon: svg('<path d="M6 6l12 12M18 6L6 18"/>'),                                                              noun: 'deaths',           share: 'of deaths' },
  storm:   { label: 'Storm',   sub: 'Where the storm kills',      heat: 'storm',   icon: svg('<path d="M13 2 5 14h6l-1 8 8-12h-6z"/>'),                                                        noun: 'storm deaths',     share: 'of storm deaths' },
  loot:    { label: 'Loot',    sub: 'Where loot is picked up',    heat: 'loot',    icon: svg('<path d="M12 3l8 9-8 9-8-9z"/>'),                                                                noun: 'loot pickups',     share: 'of loot' },
  replay:  { label: 'Replay',  sub: 'Watch one match unfold',     heat: 'off',     icon: svg('<path d="M7 4l13 8-13 8z"/>') },
};
const HEAT_HELP = {
  traffic: 'Brighter = more movement. Dark patches are routes almost nobody takes.',
  kills:   'Brighter = more kills happen here (almost all against bots).',
  deaths:  'Brighter = more deaths. These are the level\'s danger zones.',
  storm:   'Each purple marker is one player the storm caught (39 across all maps) - hover for the match time. They are scattered, not clustered.',
  loot:    'Brighter = more pickups. Dark areas are rarely looted.',
};
const TOGGLE_EVENTS = [   // legend rows that also act as layer switches
  { id: 'loot', codes: [EV.Loot],              label: 'Loot picked up', meta: EV.Loot },
  { id: 'bk',   codes: [EV.BotKill],           label: 'Killed a bot',   meta: EV.BotKill },
  { id: 'bd',   codes: [EV.BotKilled],         label: 'Killed by a bot', meta: EV.BotKilled },
  { id: 'pvp',  codes: [EV.Kill, EV.Killed],   label: 'Player vs player', meta: EV.Kill },
  { id: 'storm', codes: [EV.KilledByStorm],    label: 'Died to the storm', meta: EV.KilledByStorm },
];
const GLYPH = { circle: '<circle cx="8" cy="8" r="5"/>', diamond: '<path d="M8 2l6 6-6 6-6-6z"/>', triangle: '<path d="M8 14 14 4H2z"/>', cross: '<path d="M3 5l2-2 3 3 3-3 2 2-3 3 3 3-2 2-3-3-3 3-2-2 3-3z"/>' };

const S = {
  lens: 'routes', map: 'AmbroseValley', days: new Set(), matchId: null, sort: 'act', onlyHumans: false,
  humans: true, bots: true, paths: true, heat: 'off', heatOpacity: 0.8, heatRadius: 6, markersOverHeat: false,
  events: { [EV.Loot]: true, [EV.BotKill]: true, [EV.BotKilled]: true, [EV.Kill]: true, [EV.Killed]: true, [EV.KilledByStorm]: true },
  t: Infinity, playing: false, speed: 10,
};
let index, mapData, viewer, sel = [], maxT = 0, hot = null, pins = [];
const metaById = new Map(), imgs = {};

init().catch(e => { $('loading').textContent = 'Failed to load data: ' + e.message; console.error(e); });

async function init() {
  index = await loadIndex();
  index.matches.forEach(m => metaById.set(m.id, m));
  S.days = new Set(index.days);
  readHash();
  viewer = new Viewer($('canvas'), $('tip'));
  viewer.onPin = pin => viewer.focus(pin.px, pin.py);
  bindUI();
  await setMap(S.map, true);
  initAssistant({
    index: () => index, state: () => S, lenses: () => LENSES, pins: () => pins, hot: () => hot,
    loadMap: m => loadMap(m, index.q), show, openMatch, focusPin: r => { const p = pins.find(x => x.rank === r); if (p) viewer.focus(p.px, p.py); },
  });
  $('loading').classList.add('done');
  window.addEventListener('keydown', onKey);
  try { if (!localStorage.getItem('lila-welcome')) $('help').hidden = false; } catch (e) { $('help').hidden = false; }
}

/* ============ state transitions ============ */
async function setMap(map, first = false) {
  S.map = map; if (!first && S.lens !== 'replay') S.matchId = null; if (!first && S.lens === 'replay') S.matchId = null;
  $('loading').classList.remove('done'); $('loading').textContent = 'Loading ' + index.maps[map].label + '…';
  const [md, img] = await Promise.all([loadMap(map, index.q), loadImg(map)]);
  if (S.map !== map) return;
  mapData = md; viewer.setMap(img, index.maps[map]); viewer.resize();
  $('loading').classList.add('done');
  refresh(true);
}
const loadImg = map => imgs[map] ||= new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = `maps/${map}.webp`; });

/** Used by the assistant: move the view to a map / lens / set of days and wait until it is drawn. */
async function show({ map, lens, days }) {
  stop();
  if (days) S.days = new Set(days);
  if (lens && (lens !== S.lens || S.matchId)) { S.lens = lens; S.heat = LENSES[lens].heat; S.paths = lens === 'routes' || lens === 'replay'; S.bots = lensShowsBots(lens); S.matchId = null; }
  if (map && map !== S.map) await setMap(map); else refresh(true);
}
async function openMatch(id) {
  const m = metaById.get(id); if (!m) return;
  stop(); S.days = new Set(index.days); S.lens = 'replay'; S.heat = 'off'; S.paths = true; S.bots = true; S.matchId = id;
  if (m.map !== S.map) await setMap(m.map); else refresh(true);
  S.t = 0; redraw(true); play();
}

function setLens(l, autoplay = true) {
  stop(); S.lens = l; S.heat = LENSES[l].heat; S.paths = l === 'routes' || l === 'replay';
  S.bots = lensShowsBots(l);
  if (l !== 'replay') S.matchId = null;
  refresh(true);
  if (l === 'replay' && autoplay && maxT) { S.t = 0; redraw(true); play(); }
}

/** Fights/Deaths/Loot describe what *players* do, so bots start switched off there (they can be turned on in the legend). */
const lensShowsBots = l => !['kills', 'deaths', 'storm', 'loot'].includes(l);

const activity = m => m.kills + m.deaths + m.loot / 10;
function busiest() {
  const pool = index.matches.filter(x => x.map === S.map && S.days.has(x.day) && x.humans > 0);
  return pool.length ? pool.reduce((a, b) => activity(b) > activity(a) ? b : a).id : null;
}

/** Recompute everything that depends on filters. `resetTime` puts the cursor at the end (full picture). */
function refresh(resetTime) {
  if (S.lens === 'replay' && (!S.matchId || !metaById.get(S.matchId) || metaById.get(S.matchId).map !== S.map || !S.days.has(metaById.get(S.matchId).day))) S.matchId = busiest();
  const ok = m => !S.onlyHumans || metaById.get(m.id).humans > 0;
  sel = selectMatches(mapData, S.days, S.matchId).filter(ok);
  maxT = sel.reduce((a, m) => Math.max(a, m.dur), 0);
  if (resetTime) { S.t = maxT; stop(); }
  S.t = Math.min(S.t, maxT);
  renderLenses(); renderMaps(); renderDays(); renderPanels(); renderMatchList(); renderStats(); renderLegend(); drawSpark(); describe();
  heatKey = ''; redraw(true); saveHash();
  $('empty').hidden = sel.length > 0;
}

/* ============ drawing ============ */
let heatKey = '', heatCanvas = null, heatCount = 0, lastHeat = 0;
function redraw(force) {
  const tc = S.t >= maxT ? Infinity : S.t;
  if (S.heat !== 'off') {
    const key = [S.heat, S.map, S.matchId, [...S.days].join(), S.onlyHumans, S.humans, S.bots, S.heatRadius, Math.floor(S.t / (S.playing ? 3 : 1))].join('|');
    if (key !== heatKey && (force || performance.now() - lastHeat > 90)) {
      const r = buildHeat(sel, S.heat, { humans: S.humans, bots: S.bots, radius: S.heatRadius, tc });
      heatCanvas = r.canvas; heatCount = r.count; heatKey = key; lastHeat = performance.now();
      computeHot(tc); renderHot();
      const note = $('scaleNote'); if (note) note.textContent = `${heatCount.toLocaleString()} ${LENSES[S.lens].noun} plotted`;
    }
  } else { pins = []; hot = null; }
  viewer.setData(sel, { humans: S.humans, bots: S.bots, paths: S.paths, events: S.lens === 'storm' ? { [EV.KilledByStorm]: true } : S.events, heat: S.heat, heatOpacity: S.heatOpacity, markersOverHeat: S.markersOverHeat || S.lens === 'storm', q: index.q }, tc, heatCanvas, pins, hot);
  $('clock').textContent = `${fmtTime(Math.min(S.t, maxT))} / ${fmtTime(maxT)}`;
  const sc = $('scrub'); sc.max = Math.max(1, Math.ceil(maxT)); sc.value = Math.min(S.t, maxT);
  $('play').textContent = S.playing ? '⏸' : '▶'; $('play').setAttribute('aria-label', S.playing ? 'Pause' : 'Play');
  $('tlabel').textContent = S.lens === 'replay'
    ? 'Match clock - press ▶ or drag. Bars: loot (yellow), fights (orange), deaths (red).'
    : (S.t >= maxT ? 'Time window: whole matches. Drag left to see only the first minutes of every match.' : `Time window: only the first ${fmtTime(S.t)} of each match`);
}

/** Rank the busiest spots on a coarse grid; they become numbered pins on the map and the sidebar list. */
function computeHot(tc) {
  const G = 16, L = LENSES[S.lens], info = index.maps[S.map], cellM = Math.round(info.scale / G), o = { humans: S.humans, bots: S.bots, tc };
  const main = coarseCounts(sel, HEAT_MODES[S.heat].codes, o, G);
  const base = S.heat === 'deaths' ? coarseCounts(sel, [EV.Position, EV.BotPosition], o, G) : null;
  const order = S.lens === 'storm' ? [] : [...main.counts.keys()].filter(i => main.counts[i] >= 2)   // 39 storm deaths never repeat a spot: show markers, not rankings
   .sort((a, b) => main.counts[b] - main.counts[a]);
  const picked = [];
  for (const i of order) {
    const cx = i % G, cy = Math.floor(i / G);
    if (picked.some(p => Math.max(Math.abs(p.cx - cx), Math.abs(p.cy - cy)) < 2)) continue;
    picked.push({ cx, cy, n: main.counts[i], i }); if (picked.length === 5) break;
  }
  pins = picked.map((p, k) => {
    const pct = main.total ? p.n / main.total * 100 : 0, px = (p.cx + .5) / G * 1024, py = (p.cy + .5) / G * 1024;
    let risk = null;
    if (base && base.total) { const b = base.counts[p.i]; if (b >= base.total * 0.003) risk = (p.n / b) / (main.total / base.total); }
    const label = `${pct.toFixed(pct < 10 ? 1 : 0)}% ${L.share}` + (risk ? ` · ${risk.toFixed(1)}× risk` : '');
    const detail = `${p.n.toLocaleString()} ${L.noun} in this ~${cellM} m square` + (risk ? `<br>${risk.toFixed(1)}× ${risk >= 1 ? 'more' : 'less'} deadly per visit than the map average` : '');
    return { rank: k + 1, px, py, label, detail, short: `${p.n.toLocaleString()} ${L.noun} in this ~${cellM} m square` + (risk ? ` · ${risk.toFixed(1)}× avg risk` : '') };
  });
  const top = pins.reduce((a, p) => a + parseFloat(p.label), 0);
  hot = { counts: main.counts, total: main.total, G, noun: L.noun, cellM, topShare: top };
}

/* ============ sidebar rendering ============ */
function renderLenses() {
  $('lenses').innerHTML = Object.entries(LENSES).map(([k, l]) =>
    `<button class="lens" role="radio" aria-checked="${k === S.lens}" data-lens="${k}"><span class="ic">${l.icon}</span><b>${l.label}</b><small>${l.sub}</small></button>`).join('');
}
function renderMaps() {
  const counts = {}; index.matches.forEach(m => { if (S.days.has(m.day)) counts[m.map] = (counts[m.map] || 0) + 1; });
  $('maps').innerHTML = Object.entries(index.maps).map(([k, v]) =>
    `<button class="mapcard" role="radio" aria-checked="${k === S.map}" data-map="${k}" style="background-image:url(maps/${k}.webp)"><span>${v.label}<small>${counts[k] || 0} matches</small></span></button>`).join('');
}
function renderDays() {
  const counts = {}; index.matches.forEach(m => { if (m.map === S.map) counts[m.day] = (counts[m.day] || 0) + 1; });
  const all = S.days.size === index.days.length;
  $('days').innerHTML = `<button class="chip all ${all ? 'on' : ''}" data-day="*">All days</button>` +
    index.days.map(d => `<button class="chip ${S.days.has(d) && !all ? 'on' : ''}" data-day="${d}" aria-pressed="${S.days.has(d)}">${dayLabel(d)}<small>${counts[d] || 0}</small></button>`).join('');
}
function renderPanels() {
  $('panelHeat').hidden = S.heat === 'off'; $('panelReplay').hidden = S.lens !== 'replay'; $('panelRoutes').hidden = S.lens !== 'routes';
  if (S.heat !== 'off') { $('heatTitle').textContent = S.lens === 'storm' ? 'Where the storm kills' : `Top spots · ${LENSES[S.lens].sub.toLowerCase()}`; $('heatHint').textContent = HEAT_HELP[S.heat]; }
}
function renderHot() {
  if (S.heat === 'off') return;
  $('hotList').innerHTML = pins.length
    ? pins.map(p => `<li data-rank="${p.rank}" title="Click to zoom"><span class="rk">${p.rank}</span><div><b>${p.label}</b><span>${p.short}</span></div></li>`).join('') +
      `<li class="none" style="cursor:default"><span class="rk" style="background:none;color:var(--muted)">Σ</span><div><span>Top ${pins.length} spots = <b style="display:inline;font-size:inherit">${hot.topShare.toFixed(0)}%</b> ${LENSES[S.lens].share}</span></div></li>`
    : (S.lens === 'storm' ? '<li class="none"><span>No repeat spots: storm deaths don\'t cluster. Hover a marker for its match time.</span></li>' : '<li class="none"><span>Not enough events in this selection to rank spots.</span></li>');
}
function renderMatchList() {
  if (S.lens !== 'replay') return;
  let list = index.matches.filter(m => m.map === S.map && S.days.has(m.day) && m.humans > 0);
  const by = { act: m => -activity(m), date: null, dur: m => -m.dur, deaths: m => -m.deaths, loot: m => -m.loot }[S.sort];
  if (by) list = [...list].sort((a, b) => by(a) - by(b) || a.id.localeCompare(b.id));
  $('matchCount').textContent = `${list.length} matches`;
  let shown = list.slice(0, 300); const cur = list.find(m => m.id === S.matchId); if (cur && !shown.includes(cur)) shown = [cur, ...shown];
  $('matchList').innerHTML = shown.map(m => `<div class="item ${m.id === S.matchId ? 'on' : ''}" data-id="${m.id}" role="option"><b>${dayLabel(m.day)} · ${fmtTime(m.dur)} long</b><span>#${m.id.slice(0, 6)}</span>
    <div class="tags"><span class="tag-h">${m.humans} human${m.humans > 1 ? 's' : ''}, ${m.bots} bot${m.bots === 1 ? '' : 's'}</span><span class="tag-l">◆ ${m.loot} loot</span><span class="tag-k">● ${m.kills} kills</span><span class="tag-d">✕ ${m.deaths} deaths</span>${m.storm ? `<span class="tag-s">▼ storm</span>` : ''}</div></div>`).join('')
    + (list.length > shown.length ? `<div class="item"><span>+${list.length - shown.length} more - narrow the days or change the sort</span></div>` : '') || '<div class="item"><span>No matches with humans in this selection</span></div>';
  $('matchList').querySelector('.item.on')?.scrollIntoView({ block: 'nearest' });
}
function renderStats() {
  const c = { loot: 0, kills: 0, deaths: 0, h: 0, b: 0 }, tc = S.t >= maxT ? Infinity : S.t;
  for (const m of sel) for (const p of m.p) {
    if (p.bot ? !S.bots : !S.humans) continue; p.bot ? c.b++ : c.h++;
    const n = upperBound(p.t, tc);
    for (let i = 0; i < n; i++) { const e = p.e[i]; if (e === 2) c.loot++; else if (e === 3 || e === 5) c.kills++; else if (e >= 4 && e <= 7 && e !== 5) c.deaths++; }
  }
  const cell = (v, l) => `<div class="stat"><b>${v.toLocaleString()}</b><span>${l}</span></div>`;
  $('stats').innerHTML = cell(sel.length, sel.length === 1 ? 'match' : 'matches') + cell(c.h, 'human players') + cell(c.b, 'bots') + cell(c.loot, 'loot picked up') + cell(c.kills, 'kills') + cell(c.deaths, 'deaths');
}
let statTimer = 0; const renderStatsSoon = () => { if (!statTimer) statTimer = setTimeout(() => { statTimer = 0; renderStats(); }, 200); };

/** Legend doubles as the layer switchboard: click a row to show/hide it. */
function renderLegend() {
  const ev = e => e.codes.some(c => S.events[c]);
  const mk = (pressed, id, icon, label) => `<button class="lg" data-lg="${id}" aria-pressed="${pressed}">${icon}${label}</button>`;
  const rows = [mk(S.humans, 'humans', '<i class="ln" style="background:var(--human)"></i>', 'Human players'), mk(S.bots, 'bots', '<i class="ln" style="background:var(--bot)"></i>', 'Bots')];
  if (S.heat !== 'off') {
    $('legend').innerHTML = `<h4>Heatmap scale</h4><div class="scale"><i style="background:${heatGradientCss}"></i><div><span>fewer</span><span>more</span></div><p id="scaleNote"></p></div><h4>Show data from</h4>${rows.join('')}`;
    return;
  }
  const evRows = TOGGLE_EVENTS.map(e => { const m = EVENT_META[e.meta]; const icon = e.id === 'bd' ? GLYPH.cross : e.id === 'pvp' ? GLYPH.circle : GLYPH[m.glyph];
    const col = e.id === 'pvp' ? '#4ade80' : m.color;
    return mk(ev(e), e.id, `<svg width="14" height="14" viewBox="0 0 16 16" fill="${col}" stroke="#000" stroke-opacity=".6">${icon}</svg>`, e.label); });
  $('legend').innerHTML = `<h4>Legend · click to hide/show</h4>${rows.join('')}${evRows.join('')}`;
}
function describe() {
  const mp = index.maps[S.map].label, m = S.matchId && sel[0];
  const scope = m ? `match #${m.id.slice(0, 6)} · ${dayLabel(m.day)} · ${fmtTime(m.dur)} long` : `${sel.length} matches on ${mp}`;
  let t, d;
  if (S.lens === 'replay') { t = `Replay · ${mp}`; d = m ? `${scope[0].toUpperCase() + scope.slice(1)}. Press ▶ to watch: the cyan dot is the human player, pink dots are bots. Loot, kills and deaths pop up as they happen.` : 'No match with human players in this selection.'; }
  else if (S.lens === 'routes') { t = `Every route · ${mp}`; d = `${scope}, drawn on top of each other. Each line is one player\'s path. Use the legend to hide humans, bots or events.`; }
  else { t = `${LENSES[S.lens].sub} · ${mp}`; d = S.lens === 'storm' ? HEAT_HELP.storm : `${HEAT_HELP[S.heat]} Numbered pins mark the top spots - click one to zoom.`; }
  $('badge').innerHTML = `<b>${t}</b><span>${d}</span>`;
}
function drawSpark() {
  const cv = $('spark'), w = cv.clientWidth, dpr = window.devicePixelRatio || 1; if (!w) return;
  cv.width = w * dpr; cv.height = 26 * dpr; const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, 26);
  if (!maxT) return;
  const B = Math.min(120, Math.max(30, Math.floor(w / 5))), bins = { loot: new Float32Array(B), kill: new Float32Array(B), death: new Float32Array(B) };
  for (const m of sel) for (const p of m.p) { if (p.bot) continue; for (let i = 0; i < p.t.length; i++) {
    const e = p.e[i]; if (e < 2) continue; const b = Math.min(B - 1, Math.floor(p.t[i] / maxT * B));
    (e === 2 ? bins.loot : e === 3 || e === 5 ? bins.kill : bins.death)[b]++; } }
  const mx = Math.max(1, ...bins.loot.map((v, i) => v + bins.kill[i] + bins.death[i])), bw = w / B;
  for (let i = 0; i < B; i++) { let y = 26;
    for (const [k, col] of [['loot', '#facc1599'], ['kill', '#fb923c'], ['death', '#ef4444']]) { const h = bins[k][i] / mx * 24; g.fillStyle = col; g.fillRect(i * bw + .5, y - h, bw - 1, h); y -= h; } }
}

/* ============ playback ============ */
let last = 0;
function tick(ts) {
  if (!S.playing) return;
  S.t += (ts - last) / 1000 * S.speed; last = ts;
  if (S.t >= maxT) { S.t = maxT; S.playing = false; }
  redraw(false); renderStatsSoon();
  if (S.playing) requestAnimationFrame(tick);
}
function play() { if (!maxT) return; if (S.t >= maxT) S.t = 0; S.playing = true; last = performance.now(); requestAnimationFrame(tick); redraw(true); }
function stop() { S.playing = false; }

/* ============ events ============ */
function bindUI() {
  $('lenses').addEventListener('click', e => { const k = e.target.closest('[data-lens]')?.dataset.lens; if (k) setLens(k); });
  $('maps').addEventListener('click', e => { const k = e.target.closest('[data-map]')?.dataset.map; if (k && k !== S.map) setMap(k); });
  $('days').addEventListener('click', e => {
    const d = e.target.closest('[data-day]')?.dataset.day; if (!d) return;
    if (d === '*') S.days = new Set(index.days);
    else if (S.days.size === index.days.length) S.days = new Set([d]);      // first pick from "all" = just that day
    else if (S.days.has(d)) { if (S.days.size > 1) S.days.delete(d); } else S.days.add(d);
    if (S.lens !== 'replay') S.matchId = null; refresh(true);
  });
  $('matchList').addEventListener('click', e => { const id = e.target.closest('.item')?.dataset.id; if (id) { S.matchId = id; refresh(true); S.t = 0; redraw(true); play(); } });
  $('hotList').addEventListener('click', e => { const r = e.target.closest('li[data-rank]')?.dataset.rank; const p = pins.find(x => x.rank == r); if (p) viewer.focus(p.px, p.py); });
  $('legend').addEventListener('click', e => {
    const id = e.target.closest('[data-lg]')?.dataset.lg; if (!id) return;
    if (id === 'humans') S.humans = !S.humans; else if (id === 'bots') S.bots = !S.bots;
    else { const ev = TOGGLE_EVENTS.find(x => x.id === id), on = !ev.codes.some(c => S.events[c]); ev.codes.forEach(c => S.events[c] = on); }
    renderLegend(); heatKey = ''; redraw(true); renderStats();
  });
  $('sort').addEventListener('change', e => { S.sort = e.target.value; renderMatchList(); });
  $('onlyHumans').addEventListener('change', e => { S.onlyHumans = e.target.checked; refresh(true); });
  $('markersOverHeat').addEventListener('change', e => { S.markersOverHeat = e.target.checked; redraw(true); });
  $('heatOpacity').addEventListener('input', e => { S.heatOpacity = e.target.value / 100; redraw(true); });
  $('heatRadius').addEventListener('input', e => { S.heatRadius = +e.target.value; heatKey = ''; redraw(true); });
  $('play').addEventListener('click', () => S.playing ? (stop(), redraw(true)) : play());
  $('scrub').addEventListener('input', e => { stop(); S.t = +e.target.value; redraw(true); renderStats(); });
  $('speed').addEventListener('change', e => S.speed = +e.target.value);
  $('zin').onclick = () => viewer.zoomBy(1.4); $('zout').onclick = () => viewer.zoomBy(1 / 1.4); $('zreset').onclick = () => viewer.resetView();
  const closeHelp = () => { $('help').hidden = true; try { localStorage.setItem('lila-welcome', '1'); } catch (e) {} };
  $('helpBtn').addEventListener('click', () => $('help').hidden ? ($('help').hidden = false) : closeHelp());
  $('helpClose').addEventListener('click', closeHelp); $('helpOk').addEventListener('click', closeHelp);
  new ResizeObserver(drawSpark).observe($('spark'));
  $('onlyHumans').checked = S.onlyHumans;
}
function onKey(e) {
  if (e.target.matches('input[type=range],select,input[type=checkbox]') && e.code !== 'Space') return;
  if (e.code === 'Space' && !e.target.matches('button')) { e.preventDefault(); S.playing ? (stop(), redraw(true)) : play(); }
  else if (e.code === 'ArrowRight' || e.code === 'ArrowLeft') { stop(); S.t = Math.max(0, Math.min(maxT, S.t + (e.code === 'ArrowRight' ? 5 : -5))); redraw(true); renderStats(); }
}

/* ============ shareable URL ============ */
function saveHash() {
  const p = new URLSearchParams({ map: S.map, lens: S.lens });
  if (S.days.size !== index.days.length) p.set('days', [...S.days].map(d => d.replace('February_', '')).join(','));
  if (S.matchId && S.lens === 'replay') p.set('match', S.matchId);
  if (S.onlyHumans) p.set('humans', '1');
  history.replaceState(null, '', '#' + p);
}
function readHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  if (index.maps[p.get('map')]) S.map = p.get('map');
  if (p.get('days')) { const ds = p.get('days').split(',').map(d => 'February_' + d).filter(d => index.days.includes(d)); if (ds.length) S.days = new Set(ds); }
  const lens = p.get('lens') || p.get('heat');                       // `heat=` kept so older shared links still work
  if (LENSES[lens]) { S.lens = lens; S.heat = LENSES[lens].heat; S.paths = lens === 'routes' || lens === 'replay'; S.bots = lensShowsBots(lens); }
  if (p.get('match') && metaById.has(p.get('match'))) { const m = metaById.get(p.get('match')); S.map = m.map; S.matchId = m.id; S.lens = 'replay'; S.heat = 'off'; S.paths = true; S.days = new Set(index.days); }
  S.onlyHumans = p.get('humans') === '1';
}
