// "Ask Trailscope": a designer-facing assistant that lives in the page.
// Runs entirely in the browser: it understands a question, drives the map to the matching view,
// and answers from the same numbers the tool draws. An optional LLM endpoint (config.js) handles
// questions it cannot parse; without one it falls back to suggestions. No API key is ever shipped.
import { selectMatches } from './data.js';
import { coarseCounts } from './heatmap.js';
import { fmtTime, dayLabel } from './constants.js';

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pct = (a, b) => b ? (a / b * 100) : 0;
const f1 = n => n.toFixed(1);

/** compass wording for a pin; the minimap has north at the top */
function where(px, py) {
  const h = px < 341 ? 'west' : px > 683 ? 'east' : '', v = py < 341 ? 'north' : py > 683 ? 'south' : '';
  return v && h ? `${v}-${h}` : (v || h || 'centre');
}

export function initAssistant(api) {
  const $ = id => document.getElementById(id);
  const log = $('askLog'), form = $('askForm'), input = $('askInput'), panel = $('ask'), fab = $('askBtn');
  const idx = () => api.index();
  let busy = false;

  /* ---------- UI plumbing ---------- */
  const open = on => { panel.hidden = !on; fab.setAttribute('aria-expanded', on); if (on) input.focus(); };
  fab.addEventListener('click', () => open(panel.hidden));
  $('askClose').addEventListener('click', () => open(false));
  const scroll = () => { log.scrollTop = log.scrollHeight; };
  const bubble = (cls, html) => { const d = document.createElement('div'); d.className = 'msg ' + cls; d.innerHTML = html; log.appendChild(d); scroll(); return d; };
  const chips = list => bubble('chips', list.map(q => `<button type="button" data-q="${esc(q)}">${esc(q)}</button>`).join(''));
  log.addEventListener('click', e => {
    const b = e.target.closest('[data-q]'); if (b) ask(b.dataset.q);
    const f = e.target.closest('[data-pin]'); if (f) api.focusPin(+f.dataset.pin);
  });
  form.addEventListener('submit', e => { e.preventDefault(); const q = input.value.trim(); if (q) { input.value = ''; ask(q); } });
  window.addEventListener('keydown', e => { if (e.key === 'Escape' && !panel.hidden) open(false); });

  const START = ['Where do players die most?', 'Which areas are barely used?', 'How dangerous is the storm?', 'Compare the three maps', 'What should I fix first?', 'Explain what I am looking at'];

  /* ---------- understanding the question ---------- */
  function parse(q) {
    const s = q.toLowerCase();
    const o = { s, map: null, days: null, all: /\b(all|each|every|three|3|both|which)\b.*\bmaps?\b|\bcompare\b|\bmaps?\b.*\b(compare|differ)/.test(s) };
    if (/ambrose|valley/.test(s)) o.map = 'AmbroseValley'; else if (/grand|rift/.test(s)) o.map = 'GrandRift'; else if (/lockdown/.test(s)) o.map = 'Lockdown';
    const d = s.match(/feb(?:ruary)?\.?\s*(1[0-4])\b/); if (d) o.days = ['February_' + d[1]];
    if (/\ball days\b|\bwhole week\b|\bevery day\b/.test(s)) o.days = idx().days;
    const has = re => re.test(s);
    o.intent =
      has(/^(hi|hello|hey|help)\b|what can you|what can i ask|how do (i|you) use/) ? 'help' :
      has(/explain|what am i (looking|seeing)|what does this (view|show|mean)|this view|how to read/) ? 'explain' :
      has(/\bfix\b|priorit|first|improve|recommend|should i|what.*change|top (issue|problem)|biggest (problem|issue)/) ? 'fix' :
      o.all ? 'compare' :
      has(/storm|circle|zone closing/) ? 'storm' :
      has(/replay|watch|show me a match|example match|play (a )?match|longest|busiest match/) ? 'replay' :
      has(/pvp|player vs|versus player|human kill|bots?\b.*\b(only|most)|are (there )?(any )?real players|ai opponents|pve/) ? 'pvp' :
      has(/unused|barely|underused|under-used|empty|cold|ignored|dead (area|zone|space)|nobody|never go|avoid|quiet|wasted|dark/) ? 'unused' :
      has(/loot|pickup|pick up|item|chest/) ? 'loot' :
      has(/survive|survival|how long|live|lifespan|time to (die|death)|die early|die late/) ? 'survival' :
      has(/die|death|dead|deadl|danger|lethal|unfair|killed/) ? 'deaths' :
      has(/fight|kill|combat|engage|hotspot|action/) ? 'kills' :
      has(/traffic|busy|busiest|crowd|popular|route|path|where do (players|people) (go|walk|move)|movement|heat/) ? 'traffic' : 'unknown';
    return o;
  }

  /* ---------- data helpers ---------- */
  const humanDeaths = (md, days) => { // [{t, code}] for human deaths
    const out = [];
    for (const m of selectMatches(md, new Set(days), null)) for (const p of m.p) if (!p.bot) for (let i = 0; i < p.e.length; i++) { const e = p.e[i]; if (e === 4 || e === 6 || e === 7) out.push({ t: p.t[i], e }); }
    return out;
  };
  const tally = (md, days) => {
    const c = { matches: 0, journeys: 0, died: 0, deaths: 0, bot: 0, storm: 0, pvp: 0, loot: 0, botKills: 0, humanKills: 0, deathTimes: [] };
    for (const m of selectMatches(md, new Set(days), null)) {
      c.matches++;
      for (const p of m.p) {
        if (p.bot) continue; c.journeys++; let died = false;
        for (let i = 0; i < p.e.length; i++) {
          const e = p.e[i];
          if (e === 2) c.loot++; else if (e === 3) c.humanKills++; else if (e === 5) c.botKills++;
          else if (e === 4 || e === 6 || e === 7) { c.deaths++; if (e === 6) c.bot++; else if (e === 7) c.storm++; else c.pvp++; if (!died) { died = true; c.deathTimes.push(p.t[i]); } }
        }
        if (died) c.died++;
      }
    }
    return c;
  };
  const median = a => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
  const pinLines = (pins, noun) => pins.length
    ? `<ol class="pl">${pins.map(p => `<li><button type="button" class="lnk" data-pin="${p.rank}">#${p.rank}</button> <b>${esc(p.label)}</b>, ${where(p.px, p.py)} of the map<br><small>${esc(p.short)}</small></li>`).join('')}</ol>`
    : `<p>Not enough ${esc(noun)} here to rank spots.</p>`;
  const scope = (map, days) => `${idx().maps[map].label}${days.length === idx().days.length ? '' : ', ' + days.map(dayLabel).join(', ')}`;

  /* ---------- answers ---------- */
  const A = {
    help: async () => ({ html: `<p>I answer design questions from the telemetry and set the map up so you can <b>see</b> the answer. Try:</p><ul><li>"Where do players die most on Lockdown?"</li><li>"Which areas of Grand Rift are barely used?"</li><li>"Show me a good match to replay"</li><li>"Compare the maps"</li></ul><p class="sm">You can name a map and a day (e.g. "Feb 12").</p>`, chips: START.slice(0, 4) }),

    explain: async c => {
      const t = tally(c.md, c.days), L = c.lensInfo;
      return { html: `<p><b>${esc(L.label)}</b> on ${esc(scope(c.map, c.days))}: ${esc(L.sub.toLowerCase())}.</p><p>${t.matches.toLocaleString()} matches, ${t.journeys.toLocaleString()} human journeys, ${t.deaths.toLocaleString()} human deaths (${f1(pct(t.bot, t.deaths))}% by bots, ${f1(pct(t.storm, t.deaths))}% by the storm).</p><p class="sm">Cyan = humans, pink = bots. Numbered pins are the busiest spots; click one to zoom. The legend toggles layers, and the timeline limits the view to the first minutes of each match.</p>`, chips: ['Where do players die most?', 'What should I fix first?'], noShow: true };
    },

    deaths: async c => {
      await c.show('deaths'); const pins = api.pins(), hot = api.hot();
      const lethal = pins.filter(p => /risk/.test(p.label)).map(p => ({ p, r: parseFloat(p.label.split('·')[1]) })).filter(x => x.r >= 1.8);
      return { html: `<p>Deaths on <b>${esc(scope(c.map, c.days))}</b> (human players; bots hidden):</p>${pinLines(pins, 'deaths')}<p>The top ${pins.length} spots hold <b>${hot ? hot.topShare.toFixed(0) : 0}%</b> of deaths.${lethal.length ? ` ${lethal.length === 1 ? 'Spot' : 'Spots'} ${lethal.map(x => '#' + x.p.rank).join(', ')} ${lethal.length === 1 ? 'is' : 'are'} deadlier than their foot traffic explains (risk 1.8x or more): check whether that is intended.` : ' None is much deadlier than its traffic, so deaths mostly follow where players go.'}</p>`, chips: ['What should I fix first?', 'Which areas are barely used?'] };
    },

    kills: async c => {
      await c.show('kills'); const pins = api.pins(), hot = api.hot();
      return { html: `<p>Fights (kills by human players, against bots unless PvP) on <b>${esc(scope(c.map, c.days))}</b>:</p>${pinLines(pins, 'kills')}<p>The top ${pins.length} spots hold <b>${hot ? hot.topShare.toFixed(0) : 0}%</b> of kills.</p>`, chips: ['Where do players die most?', 'Are there real PvP fights?'] };
    },

    loot: async c => {
      await c.show('loot'); const pins = api.pins(), hot = api.hot();
      return { html: `<p>Loot pickups on <b>${esc(scope(c.map, c.days))}</b>:</p>${pinLines(pins, 'pickups')}<p>The top ${pins.length} spots hold <b>${hot ? hot.topShare.toFixed(0) : 0}%</b> of pickups. If that is high, loot is pulling everyone to the same few places.</p>`, chips: ['Which areas are barely used?', 'Where do players die most?'] };
    },

    traffic: async c => {
      await c.show('traffic'); const pins = api.pins(), hot = api.hot();
      return { html: `<p>Where players actually go on <b>${esc(scope(c.map, c.days))}</b>:</p>${pinLines(pins, 'movement')}<p>The busiest ${pins.length} spots carry <b>${hot ? hot.topShare.toFixed(0) : 0}%</b> of all movement.</p>`, chips: ['Which areas are barely used?', 'Where do players die most?'] };
    },

    unused: async c => {
      await c.show('traffic');
      const G = 16, r = coarseCounts(selectMatches(c.md, new Set(c.days), null), [0, 1], { humans: true, bots: true, tc: Infinity }, G);
      const all = [...r.counts].sort((a, b) => b - a), tot = r.total || 1, seen = all.filter(n => n > 0), V = seen.length;
      const top10 = seen.slice(0, Math.max(1, Math.ceil(V * 0.1))).reduce((a, n) => a + n, 0), bottomHalf = seen.slice(Math.ceil(V / 2)).reduce((a, n) => a + n, 0);
      const never = G * G - V;
      return { html: `<p>On <b>${esc(scope(c.map, c.days))}</b>, players entered ${V} of ${G * G} grid squares. Among those, the busiest 10% take <b>${f1(pct(top10, tot))}%</b> of all movement and the quieter half get only <b>${f1(pct(bottomHalf, tot))}%</b>.</p><p>${never} squares were never entered; many are probably void or out of bounds, so check the dark areas on the Traffic view against the minimap.</p><p class="sm">For each cold zone ask: is it unreachable, unrewarding or too exposed? Then add loot, an objective or a route there.</p>`, chips: ['What should I fix first?', 'Where do players die most?'] };
    },

    storm: async c => {
      await c.show('storm');
      const ds = humanDeaths(c.md, c.days), st = ds.filter(d => d.e === 7).map(d => d.t);
      if (!st.length) return { html: `<p>No human player died to the storm on ${esc(scope(c.map, c.days))}.</p>`, chips: ['Compare the three maps'] };
      return { html: `<p>On <b>${esc(scope(c.map, c.days))}</b>, <b>${st.length}</b> human deaths came from the storm (${f1(pct(st.length, ds.length))}% of human deaths).</p><p>The earliest was at <b>${fmtTime(Math.min(...st))}</b>, the median at ${fmtTime(median(st))}. Storm deaths are scattered, so I show markers instead of ranked spots; hover one for its match time.</p><p class="sm">If most players are dead or gone before the storm bites, it is not shaping their routes yet.</p>`, chips: ['Compare the three maps', 'What should I fix first?'] };
    },

    survival: async c => {
      const t = tally(c.md, c.days);
      return { html: `<p>On <b>${esc(scope(c.map, c.days))}</b>, <b>${f1(pct(t.died, t.journeys))}%</b> of human journeys (${t.died} of ${t.journeys}) end in death. The median first death comes at <b>${fmtTime(median(t.deathTimes))}</b> into the match.</p>`, chips: ['How dangerous is the storm?', 'Where do players die most?'], noShow: true };
    },

    pvp: async c => {
      const t = tally(c.md, c.days), multi = selectMatches(c.md, new Set(c.days), null).filter(m => m.p.filter(p => !p.bot).length > 1).length;
      return { html: `<p>On <b>${esc(scope(c.map, c.days))}</b>, humans made <b>${t.botKills.toLocaleString()}</b> bot kills and <b>${t.humanKills}</b> human kills. ${multi} of ${t.matches} matches had more than one human.</p><p class="sm">So in this data the opposition is almost entirely bots. That may be a sampling effect, so confirm with full match rosters before acting on it.</p>`, chips: ['Compare the three maps', 'What should I fix first?'], noShow: true };
    },

    compare: async () => {
      const days = idx().days, rows = [];
      for (const k of Object.keys(idx().maps)) { const md = await api.loadMap(k), t = tally(md, days); rows.push({ k, t }); }
      const body = rows.map(({ k, t }) => `<tr><td>${esc(idx().maps[k].label)}</td><td>${t.matches}</td><td>${t.journeys}</td><td>${f1(pct(t.died, t.journeys))}%</td><td>${f1(pct(t.storm, t.deaths))}%</td><td>${t.loot.toLocaleString()}</td></tr>`).join('');
      return { html: `<table class="cmp"><thead><tr><th>Map</th><th>Matches</th><th>Humans</th><th>End in death</th><th>Storm share of deaths</th><th>Loot</th></tr></thead><tbody>${body}</tbody></table><p class="sm">All five days. Grand Rift has the smallest sample, so treat its numbers as leads.</p>`, chips: ['Where do players die most?', 'Which areas are barely used?'], noShow: true };
    },

    replay: async c => {
      const pool = idx().matches.filter(m => m.map === c.map && c.days.includes(m.day) && m.humans > 0);
      if (!pool.length) return { html: '<p>No match with a human player in this selection.</p>' };
      const best = pool.reduce((a, b) => (b.kills + b.deaths + b.loot / 10) > (a.kills + a.deaths + a.loot / 10) ? b : a);
      await api.openMatch(best.id);
      return { html: `<p>Playing the most eventful match on ${esc(idx().maps[c.map].label)}: ${fmtTime(best.dur)} long, ${best.kills} kills, ${best.deaths} deaths, ${best.loot} loot pickups. The cyan dot is the human; pink dots are bots.</p>`, chips: ['Where do players die most?'], noShow: true };
    },

    fix: async c => {
      await c.show('deaths'); const pins = api.pins();
      const top = pins[0], lethal = pins.map(p => ({ p, r: parseFloat((p.label.split('·')[1] || '0')) })).sort((a, b) => b.r - a.r)[0];
      const G = 16, r = coarseCounts(selectMatches(c.md, new Set(c.days), null), [0, 1], { humans: true, bots: true, tc: Infinity }, G), tot = r.total || 1;
      const seen = [...r.counts].filter(n => n > 0).sort((a, b) => b - a), bottom = seen.slice(Math.ceil(seen.length / 2)).reduce((a, n) => a + n, 0);
      const parts = [];
      if (lethal && lethal.r >= 1.8) parts.push(`<li><b>Review spot #${lethal.p.rank}</b> (${where(lethal.p.px, lethal.p.py)}): it is ${lethal.r.toFixed(1)}x deadlier per visit than the map average. Decide if it is intended; if so add cover or an escape route, if not break the sight line or move a bot patrol.</li>`);
      else if (top) parts.push(`<li><b>Check spot #1</b> (${where(top.px, top.py)}): it holds ${esc(top.label)}. Deaths here mostly follow traffic, so tune enemy placement rather than geometry.</li>`);
      parts.push(`<li><b>Use the cold half of the map:</b> the quieter half of the squares players use gets only ${f1(pct(bottom, tot))}% of movement. Add loot or objectives there to spread play.</li>`);
      parts.push('<li><b>Re-measure</b> after each change: aim for a deliberate death curve, not zero deaths.</li>');
      return { html: `<p>For <b>${esc(scope(c.map, c.days))}</b> I would start here:</p><ol>${parts.join('')}</ol><p class="sm">Based on a 16x16 grid of the minimap; small samples (Grand Rift) are leads, not conclusions.</p>`, chips: ['Which areas are barely used?', 'Compare the three maps'] };
    },
  };

  /* ---------- optional LLM fallback ---------- */
  async function llm(q, c) {
    const cfg = window.TRAILSCOPE_AI; if (!cfg || !cfg.endpoint) return null;
    try {
      const body = { question: q, view: { map: c.map, lens: c.lensInfo.label, days: c.days, pins: api.pins().map(p => ({ rank: p.rank, label: p.label, where: where(p.px, p.py) })) }, stats: tally(c.md, c.days) };
      delete body.stats.deathTimes;
      const r = await fetch(cfg.endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      if (!r.ok) return null; const j = await r.json(); return typeof j.answer === 'string' ? j.answer : null;
    } catch (e) { return null; }
  }

  /* ---------- run a question ---------- */
  async function ask(q) {
    if (busy) return; busy = true; open(true);
    log.querySelectorAll('.chips').forEach(n => n.remove());
    bubble('me', esc(q));
    const think = bubble('bot think', '<span class="dots"><i></i><i></i><i></i></span>');
    try {
      const o = parse(q), st = api.state();
      const map = o.map || st.map, days = o.days || (st.days.size === idx().days.length ? idx().days : [...st.days]);
      const md = await api.loadMap(map);
      const c = { map, days, md, lensInfo: api.lenses()[st.lens], show: lens => api.show({ map, lens, days }) };
      let res;
      if (o.intent === 'unknown') {
        const text = await llm(q, c);
        res = text ? { html: `<p>${esc(text)}</p><p class="sm">Answered by the connected AI service from the current view's numbers.</p>` }
                   : { html: `<p>I can't answer that one yet. I understand questions about <b>deaths, fights, loot, storm, traffic, unused areas, survival, PvP, comparing maps and replays</b>, on a named map or day.</p>`, chips: START.slice(0, 4) };
      } else res = await A[o.intent](c);
      if (res.noShow === true && (o.map || o.days) && o.intent !== 'compare') await api.show({ map, days, lens: st.lens });
      think.remove(); bubble('bot', res.html);
      if (res.chips) chips(res.chips);
    } catch (e) { console.error(e); think.remove(); bubble('bot', '<p>Something went wrong reading that data. Try again or pick a lens manually.</p>'); }
    busy = false;
  }

  bubble('bot', '<p>Hi! Ask me about player behaviour on any map. I will answer and set the map up so you can see it.</p>');
  chips(START);
}
