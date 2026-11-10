import { MAP_SIZE, HEAT_MODES } from './constants.js';
import { upperBound } from './data.js';

const GRID = 256;
// transparent -> indigo -> magenta -> orange -> pale yellow (legible on dark and on the brown GrandRift map)
const STOPS = [[0, [40, 10, 120, 0]], [0.12, [70, 20, 160, 120]], [0.35, [180, 30, 150, 190]], [0.6, [250, 100, 40, 225]], [0.85, [255, 190, 40, 245]], [1, [255, 250, 190, 255]]];
const LUT = (() => {
  const l = new Uint8ClampedArray(256 * 4);
  for (let i = 0; i < 256; i++) {
    const t = i / 255; let k = 1; while (k < STOPS.length - 1 && STOPS[k][0] < t) k++;
    const [t0, c0] = STOPS[k - 1], [t1, c1] = STOPS[k], f = (t - t0) / (t1 - t0);
    for (let c = 0; c < 4; c++) l[i * 4 + c] = c0[c] + (c1[c] - c0[c]) * f;
  }
  return l;
})();
export const heatGradientCss = 'linear-gradient(90deg,' + STOPS.map(([t, c]) => `rgba(${c[0]},${c[1]},${c[2]},${Math.max(c[3] / 255, .15)}) ${t * 100}%`).join(',') + ')';

const canvas = document.createElement('canvas'); canvas.width = canvas.height = GRID;
const ctx = canvas.getContext('2d');

/**
 * Build a density image for the selection.
 * @returns {{canvas:HTMLCanvasElement, count:number}}
 */
export function buildHeat(matches, mode, { humans, bots, radius, tc }) {
  const codes = new Set(HEAT_MODES[mode].codes);
  const grid = new Float32Array(GRID * GRID);
  const R = Math.max(1, Math.round(radius)), sigma = R / 2.2;
  const kern = new Float32Array((2 * R + 1) ** 2);
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) kern[(dy + R) * (2 * R + 1) + dx + R] = Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma));
  const s = GRID / MAP_SIZE; let count = 0;
  for (const m of matches) for (const p of m.p) {
    if (p.bot ? !bots : !humans) continue;
    const n = upperBound(p.t, tc);
    for (let i = 0; i < n; i++) {
      if (!codes.has(p.e[i])) continue;
      count++;
      const cx = Math.floor(p.px[i] * s), cy = Math.floor(p.py[i] * s);
      for (let dy = -R; dy <= R; dy++) {
        const y = cy + dy; if (y < 0 || y >= GRID) continue;
        for (let dx = -R; dx <= R; dx++) { const x = cx + dx; if (x < 0 || x >= GRID) continue; grid[y * GRID + x] += kern[(dy + R) * (2 * R + 1) + dx + R]; }
      }
    }
  }
  // normalise to the 98th percentile of non-zero cells so one outlier cell doesn't wash out the rest
  const nz = []; for (let i = 0; i < grid.length; i++) if (grid[i] > 0.01) nz.push(grid[i]);
  nz.sort((a, b) => a - b);
  const ref = nz.length ? nz[Math.min(nz.length - 1, Math.floor(nz.length * 0.98))] : 1;
  const img = ctx.createImageData(GRID, GRID), gamma = HEAT_MODES[mode].gamma;
  for (let i = 0; i < grid.length; i++) {
    const v = grid[i] < 0.01 ? 0 : Math.min(1, Math.pow(grid[i] / ref, gamma));
    const li = Math.round(v * 255) * 4;
    img.data[i * 4] = LUT[li]; img.data[i * 4 + 1] = LUT[li + 1]; img.data[i * 4 + 2] = LUT[li + 2]; img.data[i * 4 + 3] = LUT[li + 3];
  }
  ctx.putImageData(img, 0, 0);
  return { canvas, count };
}

/** Coarse GxG counts (image-pixel space, row 0 = top) used for hotspot ranking and hover read-outs. */
export function coarseCounts(matches, codes, { humans, bots, tc }, G = 16) {
  const set = new Set(codes), counts = new Int32Array(G * G); let total = 0;
  for (const m of matches) for (const p of m.p) {
    if (p.bot ? !bots : !humans) continue;
    const n = upperBound(p.t, tc);
    for (let i = 0; i < n; i++) {
      if (!set.has(p.e[i])) continue;
      const cx = Math.min(G - 1, Math.floor(p.px[i] / MAP_SIZE * G)), cy = Math.min(G - 1, Math.floor(p.py[i] / MAP_SIZE * G));
      counts[cy * G + cx]++; total++;
    }
  }
  return { counts, total, G };
}
