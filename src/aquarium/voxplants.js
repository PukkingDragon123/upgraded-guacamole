// Voxel aquarium plants with pre-rendered sway frames.
// voxPlant(kind, screenH, seed) -> {frames: [{canvas, ax, ay}], n}: models are built so one voxel is
// about VPX screen pixels (chunky at any depth); frames bend stems/blades with height (sway).
// Kinds: vallis (ribbon grass), kelp (wide ruffled blade), rotala (red-tipped stems with leaf pairs),
// cabomba (stems with needle whorls), sword (amazon sword rosette), fern (java fern), hairgrass (tuft).

import { VoxelModel, renderVoxels } from '../gfx/voxel.js';
import { RNG } from '../core/rng.js';
import { TAU, clamp } from '../core/math.js';

export const PLANT_FRAMES = 6;
export const VPX = 2;

const GREENS = { leaf: ['#2f7a3a', '#46a046', '#6cc456', '#9ee06a'], deep: ['#1f5a3e', '#2f7a4a', '#4a9a52'], red: ['#a8343a', '#d2504a', '#ee7a6a'], olive: ['#5a7a2e', '#7a9a3a'], kelp: ['#6a7a22', '#8a9a2a', '#b0b83a', '#d0c860'] };

function palette(m) {
  const P = {};
  const add = (k, cols, opt = {}) => { P[k] = cols.map((c) => m.color(c, { jitter: 0.08, smooth: 0.2, ...opt })); };
  add('leaf', GREENS.leaf);
  add('deep', GREENS.deep);
  add('red', GREENS.red);
  add('olive', GREENS.olive);
  add('kelp', GREENS.kelp);
  P.root = m.color('#7a5a3a', { jitter: 0.1 });
  P.sand = m.color('#d89050', { jitter: 0.12 });
  return P;
}

// Build one sway frame. H in voxels; ph = frame phase 0..1.
function build(kind, H, seed, ph) {
  const rng = new RNG(seed);
  const amp = Math.max(1, H * 0.09);
  const nx = Math.ceil(H * (kind === 'sword' || kind === 'fern' ? 1.3 : kind === 'hairgrass' ? 1.4 : 0.9) + amp * 2 + 6);
  const nz = Math.max(8, Math.ceil(nx * 0.8));
  const m = new VoxelModel(nx, H + 4, nz);
  const P = palette(m);
  const cx = nx / 2, cz = nz / 2;
  const sway = (t, k) => Math.sin((ph + k) * TAU + t * 1.6) * amp * Math.pow(t, 1.5);
  const swayZ = (t, k) => Math.cos((ph + k) * TAU + t * 1.3) * amp * 0.5 * Math.pow(t, 1.5);
  const tone = (R, t, extra = 0) => R[clamp(Math.floor(t * (R.length - 0.01) + extra), 0, R.length - 1)];
  // sandy root mound
  for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) if (x * x + z * z <= 5) m.set(Math.floor(cx + x), 0, Math.floor(cz + z), P.sand);

  if (kind === 'vallis' || kind === 'kelp' || kind === 'hairgrass') {
    const n = kind === 'hairgrass' ? 9 + rng.int(0, 6) : kind === 'kelp' ? 2 + rng.int(0, 2) : 5 + rng.int(0, 3);
    for (let b = 0; b < n; b++) {
      const k = rng.float(0, 1);
      const hh = Math.round(H * rng.float(kind === 'hairgrass' ? 0.4 : 0.6, 1));
      const bx = cx + rng.float(-1, 1) * (kind === 'hairgrass' ? H * 0.4 : 2), bz = cz + rng.float(-1, 1) * (kind === 'hairgrass' ? H * 0.3 : 2);
      const lean = rng.float(-0.3, 0.3), leanZ = rng.float(-0.2, 0.2);
      const w = kind === 'kelp' ? 3 : kind === 'vallis' ? 2 : 1;
      const R = kind === 'kelp' ? P.kelp : b % 3 === 0 ? P.olive : P.leaf;
      for (let y = 1; y <= hh; y++) {
        const t = y / hh;
        const x = bx + lean * y * 0.6 * t + sway(t, k), z = bz + leanZ * y * 0.5 + swayZ(t, k);
        const ww = Math.max(1, Math.round(w * (kind === 'kelp' ? 1 + 0.6 * Math.sin(y * 0.9) : 1 - t * 0.4)));
        for (let i = 0; i < ww; i++) m.set(Math.floor(x + i - ww / 2), y, Math.floor(z), tone(R, t * 0.85 + (i === 0 ? 0.15 : 0)));
        if (kind === 'kelp' && y % 7 === 3) m.set(Math.floor(x + ww / 2 + 1), y, Math.floor(z), P.kelp[3]);
      }
    }
  } else if (kind === 'rotala' || kind === 'cabomba') {
    const stems = 2 + rng.int(0, 2);
    for (let s = 0; s < stems; s++) {
      const k = rng.float(0, 1);
      const hh = Math.round(H * rng.float(0.65, 1));
      const bx = cx + rng.float(-2.5, 2.5), bz = cz + rng.float(-2.5, 2.5);
      for (let y = 1; y <= hh; y++) {
        const t = y / hh;
        const x = bx + sway(t, k), z = bz + swayZ(t, k);
        m.set(Math.floor(x), y, Math.floor(z), kind === 'rotala' ? (t > 0.6 ? P.red[0] : P.olive[0]) : P.deep[0]);
        const gap = kind === 'rotala' ? 3 : 4;
        if (y % gap !== 1 || y < 3) continue;
        if (kind === 'rotala') {
          const R = t > 0.62 ? P.red : t > 0.45 ? P.olive : P.leaf;
          const ll = Math.max(1, Math.round(H * 0.07 * (1 - t * 0.3)));
          const a0 = y * 1.7;
          for (const a of [a0, a0 + Math.PI]) for (let q = 1; q <= ll; q++) m.set(Math.floor(x + Math.cos(a) * q), y + (q === ll ? 1 : 0), Math.floor(z + Math.sin(a) * q), tone(R, q / ll * 0.6 + 0.3));
        } else {
          const rr = Math.max(2, Math.round(H * 0.09 * (1 - t * 0.35)));
          for (let a = 0; a < 8; a++) {
            const ang = (a / 8) * TAU + y;
            for (let q = 1; q <= rr; q++) m.set(Math.floor(x + Math.cos(ang) * q), y + Math.floor(q / rr * 1.5), Math.floor(z + Math.sin(ang) * q), tone(P.leaf, 0.4 + (q / rr) * 0.6));
          }
        }
      }
    }
  } else {
    // rosette of broad leaves (amazon sword / java fern)
    const n = kind === 'fern' ? 6 + rng.int(0, 3) : 8 + rng.int(0, 4);
    const R = kind === 'fern' ? P.deep : P.leaf;
    for (let i = 0; i < n; i++) {
      const k = rng.float(0, 1);
      const az = (i / n) * TAU + rng.float(-0.2, 0.2);
      const lean = rng.float(0.35, kind === 'fern' ? 0.9 : 0.75);
      const len = H * rng.float(0.7, 1);
      const wid = Math.max(1, len * (kind === 'fern' ? 0.14 : 0.17));
      const dx = Math.cos(az), dz = Math.sin(az);
      for (let s = 0; s <= len; s++) {
        const t = s / len;
        const out = Math.sin(lean) * s * (0.6 + 0.4 * t);
        const up = Math.cos(lean) * s * (1 - 0.25 * t * t);
        const px = cx + dx * out + sway(t, k) * 0.5, pz = cz + dz * out, py = 1 + up;
        const ww = Math.sin(Math.min(1, t * 1.15) * Math.PI) * wid;
        for (let j = -ww; j <= ww; j += 0.7) {
          const vx = px - dz * j, vz = pz + dx * j;
          const mid = Math.abs(j) < 0.6;
          m.set(Math.floor(vx), Math.floor(py + Math.abs(j) * 0.2), Math.floor(vz), mid ? R[Math.min(R.length - 1, 2)] : tone(R, 0.25 + t * 0.6 + (j < 0 ? 0.15 : 0)));
        }
      }
    }
  }
  return m;
}

const cache = new Map();
const queue = [];

function renderFrame(kind, H, seed, f) {
  const m = build(kind, H, seed, f / PLANT_FRAMES);
  const r = renderVoxels(m, { scale: VPX, yaw: 18, pitch: 14, ao: 1, edges: 0.6, sideEdges: 0.3, groundAO: true });
  const [ax, ay] = r.project(m.nx / 2, 0, m.nz / 2);
  return { canvas: r.canvas, ax: Math.round(ax), ay: Math.round(ay) };
}

// Plant of on-screen height screenH: {frames: [frame|undefined x PLANT_FRAMES], done}. Frames are
// rendered one at a time by pumpVoxPlants(); `now` builds everything immediately.
export function voxPlant(kind, screenH, seed, now = false) {
  const H = Math.max(6, Math.round(screenH / VPX));
  const key = kind + '|' + H + '|' + seed;
  let p = cache.get(key);
  if (!p) {
    p = { kind, H, seed, frames: new Array(PLANT_FRAMES), done: 0 };
    cache.set(key, p);
    queue.push(p);
  }
  if (now) while (p.done < PLANT_FRAMES) { p.frames[p.done] = renderFrame(kind, H, seed, p.done); p.done++; }
  return p;
}

// Nearest built frame to index i (null when nothing is built yet).
export function plantFrame(p, i) {
  if (p.frames[i]) return p.frames[i];
  for (let d = 1; d < PLANT_FRAMES; d++) {
    const a = p.frames[(i + d) % PLANT_FRAMES] || p.frames[(i - d + PLANT_FRAMES) % PLANT_FRAMES];
    if (a) return a;
  }
  return null;
}

// Render queued plant frames within a time budget (one frame at a time).
export function pumpVoxPlants(budgetMs = 4) {
  const t0 = performance.now();
  while (queue.length && performance.now() - t0 < budgetMs) {
    const p = queue[0];
    if (p.done >= PLANT_FRAMES) { queue.shift(); continue; }
    p.frames[p.done] = renderFrame(p.kind, p.H, p.seed, p.done);
    p.done++;
    if (p.done >= PLANT_FRAMES) queue.shift();
  }
}
