import { MAP_SIZE } from './constants.js';

const cache = new Map();

export async function loadIndex() {
  const r = await fetch('data/index.json');
  if (!r.ok) throw new Error('Could not load data/index.json');
  return r.json();
}

/** Lazily load one map's journeys and precompute minimap pixel coordinates. */
export async function loadMap(map, q) {
  if (cache.has(map)) return cache.get(map);
  const r = await fetch(`data/${map}.json`);
  if (!r.ok) throw new Error(`Could not load data/${map}.json`);
  const j = await r.json();
  j.byId = new Map();
  for (const m of j.matches) {
    j.byId.set(m.id, m);
    for (const p of m.p) {
      const n = p.t.length;
      p.px = new Float32Array(n); p.py = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        p.px[i] = (p.u[i] / q) * MAP_SIZE;
        p.py[i] = (1 - p.v[i] / q) * MAP_SIZE;   // README: image Y axis is flipped
      }
    }
  }
  cache.set(map, j);
  return j;
}

/** Matches visible under the current filters. */
export function selectMatches(mapData, days, matchId) {
  if (!mapData) return [];
  if (matchId) { const m = mapData.byId.get(matchId); return m ? [m] : []; }
  return mapData.matches.filter(m => days.has(m.day));
}

/** number of samples with t <= tc (t is sorted ascending) */
export function upperBound(t, tc) {
  let lo = 0, hi = t.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (t[mid] <= tc) lo = mid + 1; else hi = mid; }
  return lo;
}

export const isMovement = e => e === 0 || e === 1;
