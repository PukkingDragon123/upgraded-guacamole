// Voxel art for the side-view tank (phase 10). Every builder is a generator (spread over frames by the scene's job
// queue) that returns a sprite {canvas, ox, oy, w, h} with (ox, oy) = its anchor (ground contact / attach point).
// All pieces render with the tank camera: yaw 0 (edges level with the screen), a gentle downward pitch, 2 screen px
// per voxel, so the substrate, rocks, frame, room and equipment read as one hand-built voxel diorama.
//
//   planeSteps(shape, k, Z, sK, pitch, sandLv)  substrate plane k (0 front, 1 mid, 2 back): dunes, grains, pebbles,
//                                                shells and (front) the layered cross-section against the glass
//   backdropSteps(shape, Z, sK, seed)           the reef relief on the back glass (fogged toward the water)
//   rockSteps(kind, seed, px)                   boulder | stack | slate | mossy | pebbles | driftwood | marimo
//   plantSteps(kind, seed, px)                  sword | fern | redstem | anubias | moss (lush static plants)
//   frameSteps(kind, Z, o)                      hood | hoodcap | base | basecap | pillar | stand | standcap tiles
//   roomSteps(kind, seed)                       wall | floor | window | monstera | shelf | lamp
//   gearSteps(kind, lv)                         filter | heater | airstone | ledge (tank equipment, a wall ledge)
//   SANDS[lv]                                   substrate palettes (gear 'sand' level)

import { VoxelModel, renderVoxels } from '../gfx/voxel.js';
import { renderSteps } from '../world/slabrender.js';
import { makeCanvas, ctxOf } from '../core/canvas.js';
import { shade, mix } from '../core/color.js';
import { hash2, hash3, clamp } from '../core/math.js';
import { RNG } from '../core/rng.js';
import { vnoise } from './sim2d.js';

const DEG = Math.PI / 180;
export const PXV = 2; // screen px per voxel

export const SANDS = [
  { name: 'aqua', grains: ['#9fe8fb', '#6fd2f2', '#c9f4ff', '#45b8e6', '#e6fbff', '#86dcf6', '#58c4ee'], pebbles: ['#2a9ee0', '#ffffff', '#6ae0cc', '#b4e4ff', '#2a7ad0', '#ffd27a'], deep: ['#2a7ab8', '#3a8cc8', '#1e64a0'], mid: ['#5ac4ea', '#46b0e0', '#7ad4f2'] },
  { name: 'beach', grains: ['#f6e6bc', '#efd8a0', '#fff4d8', '#e4c488', '#fbecc8', '#f0dcae'], pebbles: ['#c89a6a', '#fff8ec', '#e8b890', '#b8a088', '#f4d0b0'], deep: ['#a07850', '#8a6440', '#b88a5a'], mid: ['#d8b47a', '#e4c690'] },
  { name: 'snow', grains: ['#f4f8ff', '#e2eaf6', '#ffffff', '#d0dcec', '#eef4fc', '#c8d6ea'], pebbles: ['#a8b8d0', '#ffffff', '#b8c8e0', '#8898b8', '#dfe8f8'], deep: ['#8898b8', '#7888a8', '#98a8c4'], mid: ['#c0cce0', '#b0bed8'] },
  { name: 'rainbow', grains: ['#ff8aa8', '#ffd84a', '#7ae85a', '#4ac8ff', '#b88aff', '#ffffff', '#ffa45a'], pebbles: ['#ff5a7a', '#ffc21a', '#3ad04a', '#2aa8f0', '#9a5aff'], deep: ['#6a5aa8', '#5a4a98', '#7a6ab8'], mid: ['#e8a8d8', '#a8c8f8'] },
  { name: 'black', grains: ['#2e2e3a', '#3c3c4c', '#24242e', '#4a4a5e', '#343442', '#5a5a70'], pebbles: ['#6a6a84', '#9a9ab8', '#1a1a22', '#4a4a64', '#cfd8ff'], deep: ['#18181f', '#202028', '#121218'], mid: ['#2a2a36', '#323240'] },
];

const memo = new Map();
function cached(key, gen) {
  return function* () {
    if (memo.has(key)) return memo.get(key);
    const v = yield* gen();
    memo.set(key, v);
    if (memo.size > 260) memo.delete(memo.keys().next().value);
    return v;
  };
}
export function artCached(key) { return memo.get(key) || null; }

function spr(r, ox, oy) { return { canvas: r.canvas, ox: Math.round(ox), oy: Math.round(oy), w: r.canvas.width, h: r.canvas.height }; }

// crop a canvas to [x, x + w)
function crop(src, x, y, w, h) {
  const c = makeCanvas(Math.max(1, w), Math.max(1, h));
  ctxOf(c).drawImage(src, -x, -y);
  return c;
}

// ------------------------------------------------------------------ substrate planes
export function* planeSteps(shape, k, Z, sK, pitch, sandLv) {
  const S = SANDS[sandLv] || SANDS[0];
  const vs = PXV / (Z * sK);
  const cosP = Math.cos(pitch * DEG);
  const W = shape.W, D = shape.D;
  const slab = D / 3;
  const nx = Math.ceil(W / vs) + 1;
  const nz = Math.max(4, Math.round(slab / vs));
  const hv = new Int16Array(nx * nz);
  let maxH = 1;
  const seed = shape.seed + k * 101 + sandLv * 7;
  for (let i = 0; i < nx; i++) {
    const x = -W / 2 + (i + 0.5) * vs;
    const h0 = shape.planeH(k, x);
    const h1 = k < 2 ? shape.planeH(k + 1, x) : h0 + 4;
    for (let j = 0; j < nz; j++) {
      const back = 1 - j / Math.max(1, nz - 1); // 0 front .. 1 back of the slab
      const h = h0 + (h1 - h0) * 0.42 * (back - 0.5) + (vnoise(i * 0.31 + seed, j * 0.4) - 0.5) * 1.6 * vs;
      const v = Math.max(2, Math.round(h / (vs * cosP)));
      hv[j * nx + i] = v;
      if (v > maxH) maxH = v;
    }
  }
  const ny = maxH + 4;
  const m = new VoxelModel(nx, ny, nz);
  const G = S.grains.map((c) => m.color(c, { jitter: 0.04, smooth: 0.4 }));
  const P = S.pebbles.map((c) => m.color(c, { jitter: 0.05, smooth: 0.5, spec: 0.5 }));
  const Dp = S.deep.map((c) => m.color(c, { jitter: 0.06 }));
  const Md = S.mid.map((c) => m.color(c, { jitter: 0.06 }));
  const shell = [m.color('#ffe2ec', { spec: 0.6 }), m.color('#ffc8a8', { spec: 0.6 }), m.color('#fff8f0', { spec: 0.6 })];
  const glint = m.color('#ffffff', { emissive: 0.3, spec: 1 });
  yield;
  // columns: strata by height (deep soil, mid band, grains), wavy band edges, pebbles pressed into the faces
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const top = hv[j * nx + i];
      const wav = Math.round((vnoise(i * 0.08 + seed, 3) - 0.5) * 3);
      const deepTop = Math.round(top * 0.34) + wav, midTop = Math.round(top * 0.62) + wav;
      for (let y = 0; y < top; y++) {
        // gravel: every 2x2x2 cell is one little stone with its own colour; finer grains in the deep band
        const cell = hash3((i + (y & 2 ? 1 : 0)) >> 1, y >> 1, j >> 1, seed);
        const r = hash3(i, y, j, seed);
        let c;
        if (y < deepTop) c = Dp[((r * 0.4 + cell * 0.6) * Dp.length) | 0];
        else if (y < midTop) c = cell < 0.22 ? G[(cell * 31 * G.length | 0) % G.length] : Md[(cell * Md.length * 4.5 | 0) % Md.length];
        else c = G[(cell * G.length) | 0];
        // bigger pebbles pressed into the faces
        if (y < top - 1 && hash2((i / 3) | 0, (y / 3 + j / 2) | 0, seed + 5) < 0.06) c = P[(hash2((i / 3) | 0, (y / 3) | 0, seed + 9) * P.length) | 0];
        m.set(i, y, j, c);
      }
    }
    if (!(j & 3)) yield;
  }
  // pebbles and shells on the surface
  const R = new RNG(seed * 7 + 3);
  const nPeb = Math.round(nx * nz * 0.012);
  for (let n = 0; n < nPeb; n++) {
    const i = R.int(1, nx - 2), j = R.int(0, nz - 1);
    const top = hv[j * nx + i];
    const r = R.float(0.8, 1.9);
    const c = R.chance(0.06) ? shell[R.int(0, 2)] : P[R.int(0, P.length - 1)];
    m.ellipsoid(i + 0.5, top + r * 0.3, j + 0.5, r * 1.15, r * 0.75, r, c);
    if (R.chance(0.25)) m.set(i, Math.round(top + r * 0.9), j, glint);
  }
  yield;
  const r = yield* renderSteps(m, { scale: PXV, yaw: 0, pitch, outline: true, ao: 0.55, edges: 0.6, jitter: 0.03 });
  const i0 = (W / 2) / vs;
  const [ax, ay] = r.project(i0, 0, nz / 2);
  return { canvas: r.canvas, ox: ax, oy: ay, w: r.canvas.width, h: r.canvas.height, vs };
}

// ------------------------------------------------------------------ the reef relief on the back glass
export function* backdropSteps(shape, Z, sK, water = '#2a9ad8', seedIn = 0) {
  const vs = PXV / (Z * sK);
  const W = shape.W, H = shape.H;
  const nx = Math.ceil(W / vs) + 1, nz = 5;
  const hMax = Math.round((H * 0.62) / vs);
  const m = new VoxelModel(nx, hMax + 4, nz);
  const fog = (c, f) => mix(c, water, f);
  const rockC = ['#5a8ab8', '#6898c4', '#5084b4', '#8ec0e4'].map((c) => m.color(fog(c, 0.5), { jitter: 0.02, smooth: 0.6 }));
  const coralC = ['#ff8ab8', '#ffb46a', '#b88aff', '#6ae8c0'].map((c) => m.color(fog(c, 0.5), { jitter: 0.04 }));
  const kelpC = [m.color(fog('#3aa84a', 0.5)), m.color(fog('#5ac85a', 0.5))];
  const seed = shape.seed + seedIn;
  const prof = new Int16Array(nx);
  for (let i = 0; i < nx; i++) {
    const x = i * vs;
    const n = vnoise(x * 0.004 + seed, 1) * 0.6 + vnoise(x * 0.013 + seed * 2, 2) * 0.3 + vnoise(x * 0.05, seed) * 0.1;
    prof[i] = Math.round(hMax * (0.18 + 0.82 * Math.pow(n, 1.6)));
  }
  for (let i = 0; i < nx; i++) {
    for (let y = 0; y < prof[i]; y++) for (let z = 0; z < nz; z++) {
      const depthIn = Math.min(prof[i] - y, 4);
      if (z > 1 + depthIn) continue;
      const band = ((y + Math.round(vnoise(i * 0.05, seed) * 6)) / 7) | 0;
      const top = y >= prof[i] - 2;
      m.set(i, y, z, top ? rockC[3] : rockC[band % 3]);
    }
    if (!(i & 31)) yield;
  }
  // coral tufts on the ridges, kelp stalks between
  const R = new RNG(seed + 77);
  for (let n = 0; n < nx / 14; n++) {
    const i = R.int(2, nx - 3), y = prof[i];
    const c = coralC[R.int(0, coralC.length - 1)];
    const rr = R.float(1.5, 3.5);
    m.ellipsoid(i, y + rr * 0.5, 2, rr, rr * 0.8, 1.6, c);
  }
  for (let n = 0; n < nx / 40; n++) {
    const i = R.int(4, nx - 5), h = R.int(Math.round(hMax * 0.5), hMax + 2);
    let x = i;
    for (let y = 0; y < h; y++) { x += Math.sin(y * 0.25 + n) * 0.35; m.set(Math.round(x), y, 3, kelpC[(y >> 2) & 1]); if (y % 6 === 3) m.set(Math.round(x) + (y % 12 === 3 ? 1 : -1), y, 3, kelpC[1]); }
  }
  yield;
  const r = yield* renderSteps(m, { scale: PXV, yaw: 0, pitch: 6, outline: false, ao: 0.4, edges: 0.3 });
  const [ax, ay] = r.project((W / 2) / vs, 0, 0);
  return { canvas: r.canvas, ox: ax, oy: ay, w: r.canvas.width, h: r.canvas.height, vs };
}

// ------------------------------------------------------------------ rocks, driftwood, moss balls
const ROCK_COLS = {
  boulder: ['#8e9cb4', '#a8b4c8', '#7a88a0', '#b8c2d4', '#6a7890'],
  stack: ['#c8b8a0', '#b4a088', '#dccab0', '#a08c74'],
  slate: ['#5a6a88', '#6a7c9a', '#4a5a78', '#7a8eae'],
  mossy: ['#8a94a4', '#a0a8b8', '#76808e', '#b0b8c4'],
  lava: ['#4a3a44', '#5a4650', '#3a2e38', '#6a5460'],
};
export function rockSteps(kind, seed, px) {
  return cached(`rock|${kind}|${seed}|${px}`, function* () {
    const R = new RNG(seed * 31 + 7);
    if (kind === 'driftwood') return yield* driftSteps(R, px);
    if (kind === 'marimo') return yield* marimoSteps(R, px);
    if (kind === 'pebbles') return yield* pebbleSteps(R, px);
    const size = Math.max(6, Math.round(px / PXV));
    const w = kind === 'slate' ? Math.round(size * 0.7) : kind === 'stack' ? Math.round(size * 1.1) : Math.round(size * 1.3);
    const h = kind === 'slate' ? Math.round(size * 1.35) : kind === 'stack' ? Math.round(size * 1.05) : Math.round(size * 0.85);
    const d = Math.max(6, Math.round(Math.min(w, size) * 0.8));
    const m = new VoxelModel(w + 6, h + 6, d + 4);
    const cols = (ROCK_COLS[kind] || ROCK_COLS.boulder).map((c) => m.color(c, { jitter: 0.09 }));
    const moss = [m.color('#4ab85a', { jitter: 0.14 }), m.color('#7ad84a', { jitter: 0.14 }), m.color('#2e9a4a', { jitter: 0.1 })];
    const lichen = m.color('#e8f0a8', { jitter: 0.1 });
    const cx = (w + 6) / 2, cz = (d + 4) / 2;
    const blobs = [];
    if (kind === 'stack') {
      let y = 0;
      for (let i = 0; i < 4 && y < h; i++) {
        const rw = (w / 2) * (1 - i * 0.17) * R.float(0.85, 1.05), rh = Math.max(2, h / 4.4 * R.float(0.8, 1.15));
        blobs.push([cx + R.float(-1.5, 1.5), y + rh, cz, rw, rh, Math.min(cz - 1, rw * 0.7)]);
        y += rh * 1.75;
      }
    } else if (kind === 'slate') {
      for (let i = 0; i < 3; i++) blobs.push([cx + (i - 1) * w * 0.22, h * (0.38 + i * 0.12) * R.float(0.8, 1), cz + R.float(-1, 1), w * 0.24, h * (0.42 - Math.abs(i - 1) * 0.1), d * 0.36]);
    } else {
      blobs.push([cx, h * 0.45, cz, w * 0.5, h * 0.5, d * 0.46]);
      for (let i = 0; i < 3; i++) blobs.push([cx + R.float(-0.45, 0.45) * w, h * R.float(0.25, 0.55), cz + R.float(-0.2, 0.2) * d, w * R.float(0.22, 0.34), h * R.float(0.3, 0.45), d * R.float(0.28, 0.4)]);
    }
    const nseed = R.int(0, 9999);
    m.fill((x, y, z) => {
      let f = -1;
      for (const [bx, by, bz, rx, ry, rz] of blobs) {
        const dx = (x + 0.5 - bx) / rx, dy = (y + 0.5 - by) / ry, dz = (z + 0.5 - bz) / rz;
        f = Math.max(f, 1 - Math.sqrt(dx * dx + dy * dy + dz * dz));
      }
      f += (hash3(x >> 1, y >> 1, z >> 1, nseed) - 0.5) * 0.16;
      if (f <= 0 || y < 0) return null;
      const band = kind === 'slate' ? (x + (hash2(y >> 2, 0, nseed) * 3 | 0)) % 4 : ((y + (hash2(x >> 2, z, nseed) * 2 | 0)) >> 1) % cols.length;
      return cols[Math.abs(band) % cols.length];
    });
    // moss caps and lichen flecks on exposed tops
    m.recolor((x, y, z, prev) => {
      if (m.get(x, y + 1, z)) return null;
      const r = hash3(x, y, z, nseed + 3);
      if ((kind === 'mossy' && r < 0.85) || (kind !== 'lava' && r < 0.18 && y > h * 0.5)) return moss[(r * 7 | 0) % 3];
      if (r > 0.96) return lichen;
      return null;
    });
    yield;
    const r = renderVoxels(m, { scale: PXV, yaw: 0, pitch: 18, outline: true, ao: 0.6, edges: 0.7 });
    const [ax, ay] = r.project(cx, 0, cz);
    return spr(r, ax, ay);
  })();
}
function* driftSteps(R, px) {
  const L = Math.max(16, Math.round(px / PXV));
  const m = new VoxelModel(L + 8, Math.round(L * 0.8) + 6, 14);
  const bark = ['#8a5a3a', '#a06a44', '#704830', '#b88458'].map((c) => m.color(c, { jitter: 0.1 }));
  const moss = m.color('#5ac85a', { jitter: 0.12 });
  const pts = [];
  let x = 3, y = 2;
  for (let i = 0; i <= 6; i++) { pts.push([x, y, 7, Math.max(1.2, (L / 14) * (1 - i * 0.11))]); x += L / 7; y += R.float(0.5, L / 8) * (i < 3 ? 1 : -0.4) + (i === 3 ? L * 0.12 : 0); }
  m.tube(pts, (xx, yy, zz) => bark[(hash2(xx >> 1, yy, 3) * 4) | 0]);
  // two branches
  for (let b = 0; b < 2; b++) {
    const p = pts[2 + b * 2];
    m.tube([[p[0], p[1], 7, p[3] * 0.7], [p[0] + R.float(-3, 4), p[1] + L * 0.25, 7 + R.float(-2, 2), p[3] * 0.45], [p[0] + R.float(-6, 6), p[1] + L * 0.45, 7, 0.8]], bark[1]);
  }
  m.recolor((xx, yy, zz) => (!m.get(xx, yy + 1, zz) && hash3(xx, yy, zz, 9) < 0.35 ? moss : null));
  yield;
  const r = renderVoxels(m, { scale: PXV, yaw: 0, pitch: 18, outline: true, ao: 0.5, edges: 0.6 });
  const [ax, ay] = r.project((L + 8) / 2, 0, 7);
  return spr(r, ax, ay);
}
function* marimoSteps(R, px) {
  const r0 = Math.max(3, Math.round(px / PXV / 2));
  const n = r0 * 2 + 4;
  const m = new VoxelModel(n, n, n);
  const g = ['#2e9a3a', '#4ab84a', '#6ad85a', '#3aa844', '#8ae86a'].map((c) => m.color(c, { jitter: 0.16 }));
  const c = n / 2;
  m.fill((x, y, z) => {
    const d = Math.hypot(x + 0.5 - c, y + 0.5 - r0 - 0.5, z + 0.5 - c);
    const fuzz = hash3(x, y, z, 5) * 0.9;
    return d < r0 - 0.4 + fuzz ? g[(hash3(x, y, z, 7) * g.length) | 0] : null;
  });
  yield;
  const r = renderVoxels(m, { scale: PXV, yaw: 0, pitch: 18, outline: true, ao: 0.5 });
  const [ax, ay] = r.project(c, 0, c);
  return spr(r, ax, ay);
}
function* pebbleSteps(R, px) {
  const L = Math.max(10, Math.round(px / PXV));
  const m = new VoxelModel(L + 4, 8, 10);
  const cols = ['#e8f4ff', '#bff4ff', '#d8cca0', '#8ae0d0', '#f4fbff', '#a8b0bc'].map((c) => m.color(c, { jitter: 0.05, smooth: 0.6, spec: 0.5 }));
  for (let i = 0; i < Math.round(L / 2.5); i++) {
    const r = R.float(1, 2.4);
    m.ellipsoid(R.float(2, L + 2), r * 0.55, R.float(3, 7), r * 1.2, r * 0.75, r, cols[R.int(0, cols.length - 1)]);
  }
  yield;
  const r = renderVoxels(m, { scale: PXV, yaw: 0, pitch: 18, outline: true, ao: 0.5 });
  const [ax, ay] = r.project((L + 4) / 2, 0, 5);
  return spr(r, ax, ay);
}

// ------------------------------------------------------------------ lush static aquarium plants
// sword (Amazon sword rosette), fern (wavy Java fern), redstem (stem plants fading to vivid red / pink tips),
// anubias (broad glossy leaves), moss (a fuzzy carpet clump). px = rough height in screen px.
function leafRibbon(m, B, th, phi, L, W, droop, colFn, curl = 0.25) {
  const n = Math.max(6, Math.round(L * 1.6));
  const sx = -Math.sin(th), sz = Math.cos(th);
  for (let k = 0; k <= n; k++) {
    const t = k / n;
    const rx = L * Math.cos(phi) * t, y = L * (Math.sin(phi) * t - droop * t * t);
    const cx = B[0] + Math.cos(th) * rx, cy = B[1] + y, cz = B[2] + Math.sin(th) * rx;
    const w = W * Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.08 + 0.02)), 0.75);
    const steps = Math.max(1, Math.ceil(w * 2));
    for (let q = -steps; q <= steps; q++) {
      const u = (q / steps) * w;
      const lift = Math.abs(u / Math.max(0.5, W)) * curl * W;
      m.set(Math.round(cx + sx * u), Math.round(cy + lift), Math.round(cz + sz * u), colFn(t, Math.abs(q / steps)));
    }
  }
}
export function plantSteps(kind, seed, px) {
  return cached(`plant|${kind}|${seed}|${px}`, function* () {
    const R = new RNG(seed * 17 + 11);
    const H = Math.max(10, Math.round(px / PXV));
    const Wd = Math.round(H * (kind === 'moss' ? 2.2 : kind === 'anubias' ? 1.6 : 1.4)) + 8;
    const Dd = Math.max(10, Math.round(H * 0.7));
    const m = new VoxelModel(Wd, H + 4, Dd);
    const cx = Wd / 2, cz = Dd / 2;
    const ramp = (cols) => cols.map((c) => m.color(c, { jitter: 0.05, spec: 0.45 }));
    yield;
    if (kind === 'sword' || kind === 'fern' || kind === 'anubias') {
      const greens = kind === 'fern' ? ramp(['#1e7a3a', '#2a9046', '#3aa852', '#5ac06a', '#7ad07a']) : kind === 'anubias' ? ramp(['#1e8a3a', '#2fa84a', '#46c05a', '#7ae070', '#b8f4a0']) : ramp(['#2a9a3a', '#3ab84a', '#56d05a', '#86e66a', '#c8f8a0']);
      const spot = m.color('#6a4a2a');
      const nL = kind === 'sword' ? R.int(11, 15) : kind === 'fern' ? R.int(7, 10) : R.int(5, 7);
      for (let i = 0; i < nL; i++) {
        const th = (i / nL) * TAU2 + R.float(-0.3, 0.3);
        const phi = kind === 'anubias' ? R.float(0.5, 1.0) : R.float(0.95, 1.4);
        const L = kind === 'anubias' ? H * R.float(0.55, 0.75) : H * R.float(0.75, 1.05);
        const W = kind === 'anubias' ? H * 0.2 : kind === 'fern' ? H * 0.09 : H * 0.11;
        const B = [cx + R.float(-1, 1), 1, cz + R.float(-1, 1)];
        const wav = kind === 'fern' ? 1 : 0;
        leafRibbon(m, B, th, phi, L, W, kind === 'anubias' ? 0.25 : 0.5, (t, e) => {
          if (wav && e > 0.6 && hash2(Math.round(t * 30), i, seed) < 0.12) return spot;
          const base = e < 0.18 ? 3 : t > 0.85 ? 4 : t > 0.5 ? 2 : 1;
          return greens[clamp(base - (e > 0.8 ? 1 : 0), 0, 4)];
        }, kind === 'fern' ? 0.6 : 0.3);
        if (kind === 'anubias') m.line(B[0], B[1], B[2], B[0] + Math.cos(th) * L * 0.3, B[1] + L * 0.25, B[2] + Math.sin(th) * L * 0.3, greens[0], 0.6);
      }
    } else if (kind === 'redstem') {
      const tips = R.pick([['#ff5a5a', '#ff8a4a', '#ffb84a'], ['#ff5ab4', '#ff8ad8', '#ffc8f0'], ['#b86aff', '#d89aff', '#f0d0ff']]);
      const cols = ramp(['#2a9a3a', '#5ab84a', '#a8c84a', ...tips]);
      const stem = m.color('#3a8a3a');
      const nS = R.int(5, 8);
      for (let si = 0; si < nS; si++) {
        let x = cx + R.float(-H * 0.25, H * 0.25), z = cz + R.float(-H * 0.2, H * 0.2);
        const h = Math.round(H * R.float(0.65, 1));
        for (let y = 0; y < h; y++) {
          x += Math.sin(y * 0.2 + si) * 0.18;
          m.set(Math.round(x), y, Math.round(z), stem);
          if (y % 3 === 1 && y > 2) {
            const u = y / h, c = cols[clamp(Math.floor(u * 6), 0, 5)];
            const a = y * 1.3 + si;
            const ln = 2 + Math.round((1 - u) * 2.5);
            for (let k = 1; k <= ln; k++) {
              m.set(Math.round(x + Math.cos(a) * k), y + (k > 2 ? 1 : 0), Math.round(z + Math.sin(a) * k * 0.7), c);
              m.set(Math.round(x - Math.cos(a) * k), y + (k > 2 ? 1 : 0), Math.round(z - Math.sin(a) * k * 0.7), c);
            }
          }
        }
        m.ellipsoid(x, h, z, 1.6, 1.4, 1.6, cols[5]);
      }
    } else if (kind === 'moss') {
      const g = ramp(['#3aa83a', '#5ac84a', '#7ad85a', '#a8ec6a', '#2e8a34']);
      const ry = H * 0.55, rx = Wd * 0.42;
      m.fill((x, y, z) => {
        const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5) / ry, dz = (z + 0.5 - cz) / (Dd * 0.42);
        const d = dx * dx + dy * dy + dz * dz;
        const fuzz = hash3(x, y, z, seed) * 0.35;
        return d < 1 - fuzz * 0.6 ? g[(hash3(x >> 1, y, z >> 1, seed + 1) * 5) | 0] : null;
      });
    }
    yield;
    const r = renderVoxels(m, { scale: PXV, yaw: 0, pitch: 18, outline: true, ao: 0.55, edges: 0.7 });
    const [ax, ay] = r.project(cx, 0, cz);
    return spr(r, ax, ay);
  })();
}
const TAU2 = Math.PI * 2;

// ------------------------------------------------------------------ tank frame (tileable pieces)
// Renders a model that is three tiles wide (or tall) and keeps the middle one, so tiles repeat without outline seams.
function midTile(r, axis, n, proj) {
  void proj;
  const c = r.canvas;
  if (axis === 'x') { const tw = Math.round(c.width / 3), x0 = Math.round((c.width - tw) / 2); return { canvas: crop(c, x0, 0, tw, c.height), w: tw, h: c.height, x0 }; }
  const th = Math.round(c.height / 3), y0 = Math.round((c.height - th) / 2);
  return { canvas: crop(c, 0, y0, c.width, th), w: c.width, h: th, y0 };
}

export const LIGHT_COLS = ['#fffbe8', '#bff8ff', '#ffffff', '#ffe2b0'];

export function frameSteps(kind, Z, o = {}) {
  return cached(`frame|${kind}|${Z}|${o.light ?? ''}|${o.h ?? ''}`, function* () {
    const k = Z / 1.4; // frame thickness follows the zoom
    const n = (v) => Math.max(2, Math.round(v * k));
    yield;
    if (kind === 'hood' || kind === 'hoodcap') {
      // a glossy white Aero lid: rounded front, an aqua glass band with a highlight, vents on top, the LED strip below
      const T = 24, h = n(18), d = n(13);
      const wide = kind === 'hood' ? T * 3 : n(12) + 2;
      const m = new VoxelModel(wide, h + 1, d + 1);
      const white = m.color('#f6fcff', { jitter: 0.015, spec: 0.9, specPow: 14, smooth: 0.9 });
      const white2 = m.color('#e2eef8', { jitter: 0.015, spec: 0.6, smooth: 0.9 });
      const lip = m.color('#b8d4e8', { spec: 0.5 });
      const aqua = m.color('#4ad2ff', { spec: 1, specPow: 18, smooth: 0.9, emissive: 0.15 });
      const aqua2 = m.color('#1e9ee8', { spec: 0.9, smooth: 0.9 });
      const aquaHi = m.color('#c8f6ff', { spec: 1, emissive: 0.3 });
      const vent = m.color('#a8c4dc');
      const lite = m.color(LIGHT_COLS[o.light ?? 0], { emissive: 1 });
      const leaf = m.color('#6ae04a', { spec: 0.8, emissive: 0.2 });
      const rr = Math.max(2, Math.round(Math.min(h, d) * 0.5));
      const b0 = Math.round(h * 0.38), b1 = b0 + Math.max(2, Math.round(h * 0.2));
      const front = m.color('#38c0f6', { spec: 1, specPow: 16, smooth: 0.9 }), front2 = m.color('#1f94e0', { spec: 0.9, smooth: 0.9 });
      for (let x = 0; x < wide; x++) for (let y = 0; y <= h; y++) for (let z = 0; z <= d; z++) {
        // rounded top-front edge (quarter circle of radius rr)
        const cy = h - rr, cz = d - rr;
        if (y > cy && z > cz && (y - cy) ** 2 + (z - cz) ** 2 > rr * rr) continue;
        if (y > 1 && z === d && !(y >= b0 && y <= b1)) continue;
        const outer = y > cy ? cz + Math.sqrt(Math.max(0, rr * rr - (y - cy) ** 2)) : d;
        const shell = z >= outer - 1.6;
        let c = y <= 1 ? lip : !shell ? white : y > cy + rr * 0.55 ? white : y < b0 ? front2 : front;
        if (y >= b0 && y <= b1 && shell) c = y === b1 ? aquaHi : y === b0 ? aqua2 : white;
        if (y === 0 && z > d * 0.3 && z < d - 1) c = lite;
        if (y >= h - 1 && z > 1 && z < d - rr && x % 8 < 4) c = vent;
        m.set(x, y, z, c);
      }
      if (kind === 'hoodcap') {
        // rounded outer end
        const R0 = 3.2;
        m.sub(() => { for (let x = 0; x < wide; x++) for (let y = 0; y <= h; y++) { const dx = R0 - x, dy = y - (h - R0); if (dx > 0 && dy > 0 && dx * dx + dy * dy > R0 * R0) m.box(x, y, 0, x, y, d, 1); } });
        const lx = Math.round(wide * 0.62), ly = Math.round(h * 0.68);
        for (let i = 0; i < 4; i++) { m.set(lx + i, ly + (i >> 1), d - Math.round(rr * 0.3), leaf); m.set(lx + i, ly + 1 + (i >> 1), d - Math.round(rr * 0.3), leaf); }
      }
      const r = renderVoxels(m, { scale: PXV, yaw: 0, pitch: 20, outline: true, ao: 0.45, edges: 0.9 });
      if (kind === 'hood') { const t = midTile(r, 'x'); return { canvas: t.canvas, ox: 0, oy: t.h, w: t.w, h: t.h }; }
      return spr(r, r.canvas.width - 1, r.canvas.height);
    }
    if (kind === 'base' || kind === 'basecap') {
      const T = 24, h = n(8), d = n(9);
      const wide = kind === 'base' ? T * 3 : n(10) + 2;
      const m = new VoxelModel(wide, h, d);
      const white = m.color('#f4fbff', { spec: 0.8, smooth: 0.8 });
      const shadeW = m.color('#c8dcec', { spec: 0.5 });
      const aqua = m.color('#4ad0ff', { spec: 0.9, smooth: 0.8, emissive: 0.15 });
      const green = m.color('#6ae04a', { spec: 0.9 });
      for (let x = 0; x < wide; x++) for (let y = 0; y < h; y++) for (let z = 0; z < d; z++) {
        if (y === h - 1 && z === d - 1) continue;
        let c = y < 2 ? shadeW : white;
        if (y === Math.round(h * 0.5)) c = aqua;
        if (kind === 'basecap' && y === Math.round(h * 0.5) && x > wide - 4) c = green;
        m.set(x, y, z, c);
      }
      if (kind === 'basecap') m.sub(() => { m.box(0, h - 2, 0, 1, h - 1, d - 1, 1); m.box(0, 0, 0, 0, 1, d - 1, 1); });
      const r = renderVoxels(m, { scale: PXV, yaw: 0, pitch: 16, outline: true, ao: 0.4, edges: 0.8 });
      if (kind === 'base') { const t = midTile(r, 'x'); return { canvas: t.canvas, ox: 0, oy: 0, w: t.w, h: t.h }; }
      return spr(r, r.canvas.width - 1, 0);
    }
    if (kind === 'pillar') {
      const T = 16, wv = n(4), d = 3;
      const m = new VoxelModel(wv, T * 3, d);
      const g1 = m.color('#c8fff6', { spec: 1, smooth: 0.9 }), g2 = m.color('#7ae8d8', { spec: 0.9, smooth: 0.9 }), g3 = m.color('#3aa8b8', { spec: 0.6 });
      const seal = m.color('#1e5a6a');
      for (let x = 0; x < wv; x++) for (let y = 0; y < T * 3; y++) for (let z = 0; z < d; z++) {
        const c = x === 0 ? g1 : x === wv - 1 ? seal : (y % T === 0 && x === 1) ? g1 : z === d - 1 ? g2 : g3;
        m.set(x, y, z, c);
      }
      const r = renderVoxels(m, { scale: PXV, yaw: 0, pitch: 0, outline: false, ao: 0.2, edges: 0.9 });
      const t = midTile(r, 'y');
      return { canvas: t.canvas, ox: 0, oy: 0, w: t.w, h: t.h };
    }
    if (kind === 'stand' || kind === 'standcap') {
      const T = 40, h = n(46), d = n(12);
      const wide = kind === 'stand' ? T * 3 : n(14) + 2;
      const m = new VoxelModel(wide, h, d);
      const white = m.color('#eef8ff', { spec: 0.7, smooth: 0.8 });
      const white2 = m.color('#d4e8f6', { spec: 0.5 });
      const glass = m.color('#7ad8f8', { spec: 1, smooth: 0.9 }), glass2 = m.color('#4ab4e8', { spec: 0.9, smooth: 0.9 });
      const chrome = m.color('#e8f0f8', { spec: 1, specPow: 20 });
      const leaf = [m.color('#6ae04a', { spec: 0.8 }), m.color('#3ab84a', { spec: 0.8 })];
      for (let x = 0; x < wide; x++) for (let y = 0; y < h; y++) for (let z = 0; z < d; z++) {
        let c = y < 3 || y > h - 3 ? white2 : white;
        if (kind === 'stand' && z === d - 1) {
          const lx = x % T;
          if (lx >= 3 && lx <= T - 4 && y >= 5 && y <= h - 6) {
            c = (lx + y) % 9 < 2 ? glass : glass2;
            if (lx === T - 7 && y > h * 0.4 && y < h * 0.6) c = chrome;
          }
        }
        m.set(x, y, z, c);
      }
      if (kind === 'stand') {
        // a little glossy leaf decal on every other door
        for (let t = 0; t < 3; t++) { const bx = t * T + 9, by = Math.round(h * 0.28); for (let i = 0; i < 5; i++) { m.set(bx + i, by + i, d - 1, leaf[0]); m.set(bx + i + 1, by + i, d - 1, leaf[1]); } }
      } else m.sub(() => m.box(0, 0, 0, 1, h - 1, d - 1, 1));
      const r = renderVoxels(m, { scale: PXV, yaw: 0, pitch: 12, outline: true, ao: 0.4, edges: 0.7 });
      if (kind === 'stand') { const t = midTile(r, 'x'); return { canvas: t.canvas, ox: 0, oy: 0, w: t.w, h: t.h }; }
      return spr(r, r.canvas.width - 1, 0);
    }
    return null;
  })();
}

// ------------------------------------------------------------------ the Frutiger Aero room around the tank
export function roomSteps(kind, seed = 1) {
  return cached(`room|${kind}|${seed}`, function* () {
    yield;
    const R = new RNG(seed * 13 + 5);
    if (kind === 'wall') {
      const T = 56;
      const m = new VoxelModel(T * 3, T * 3, 3);
      const p = ['#e8f7ff', '#e4f5ff', '#ecf9ff'].map((c) => m.color(c, { jitter: 0.008, spec: 0.25, smooth: 0.95 }));
      const groove = m.color('#d2eaf7');
      for (let x = 0; x < T * 3; x++) for (let y = 0; y < T * 3; y++) {
        const lx = x % T, ly = y % T;
        const g = lx === 0 || ly === 0;
        const c = p[((x / T | 0) + (y / T | 0)) % 3];
        m.set(x, y, 0, c);
        if (!g) { m.set(x, y, 1, c); m.set(x, y, 2, c); } else m.set(x, y, 1, groove);
      }
      const r = renderVoxels(m, { scale: PXV, yaw: 0, pitch: 0, outline: false, ao: 0.35, edges: 0.25 });
      const c = r.canvas, tw = Math.round(c.width / 3), th = Math.round(c.height / 3);
      return { canvas: crop(c, Math.round((c.width - tw) / 2), Math.round((c.height - th) / 2), tw, th), ox: 0, oy: 0, w: tw, h: th };
    }
    if (kind === 'rail') {
      // a glossy aqua chair rail with a leaf-green inlay along the wall
      const T = 32;
      const m = new VoxelModel(T * 3, 6, 4);
      const w = m.color('#ffffff', { spec: 0.9, smooth: 0.9 }), a = m.color('#4ad2ff', { spec: 1, smooth: 0.9 }), gr = m.color('#7ae05a', { spec: 0.9 });
      for (let x = 0; x < T * 3; x++) for (let y = 0; y < 6; y++) for (let z = 0; z < 4; z++) m.set(x, y, z, y === 0 || y === 5 ? w : y === 2 ? gr : a);
      const r = renderVoxels(m, { scale: PXV, yaw: 0, pitch: 10, outline: true, ao: 0.3, edges: 0.8 });
      const t = midTile(r, 'x');
      return { canvas: t.canvas, ox: 0, oy: 0, w: t.w, h: t.h };
    }
    if (kind === 'floor') {
      const T = 36;
      const m = new VoxelModel(T * 3, 4, 26);
      const wood = ['#f2dcb4', '#e8cc9c', '#f8e6c4', '#dcbc88'].map((c) => m.color(c, { jitter: 0.04, spec: 0.5 }));
      const gap = m.color('#c8a474');
      for (let x = 0; x < T * 3; x++) for (let z = 0; z < 26; z++) {
        const plank = (z / 5) | 0, off = (plank * 11) % T;
        const seam = (x + off) % T === 0 || z % 5 === 0;
        for (let y = 0; y < 4; y++) m.set(x, y, z, y === 3 && seam ? gap : wood[(plank + ((x + off) / T | 0)) % 4]);
      }
      const r = renderVoxels(m, { scale: PXV, yaw: 0, pitch: 30, outline: false, ao: 0.3, edges: 0.4 });
      const t = midTile(r, 'x');
      return { canvas: t.canvas, ox: 0, oy: 0, w: t.w, h: t.h };
    }
    if (kind === 'window') {
      const w = 64, h = 74;
      const m = new VoxelModel(w, h, 8);
      const frame = m.color('#ffffff', { spec: 0.8, smooth: 0.8 }), frame2 = m.color('#d8eaf6', { spec: 0.5 });
      const sky = ['#5ac8ff', '#7ad6ff', '#9ae2ff', '#bfeeff'].map((c) => m.color(c, { jitter: 0.01, smooth: 1, emissive: 0.85 }));
      const hill = ['#5ad84a', '#7ae85a', '#3ac04a'].map((c) => m.color(c, { jitter: 0.05 }));
      const cloud = m.color('#ffffff', { jitter: 0.02, smooth: 1 });
      const tower = m.color('#f4fbff', { spec: 0.8 });
      const sun = m.color('#fff6c8', { emissive: 1 });
      for (let x = 0; x < w; x++) for (let y = 0; y < h; y++) {
        const isFrame = x < 4 || x >= w - 4 || y < 4 || y >= h - 4 || Math.abs(x - w / 2) < 2 || Math.abs(y - h * 0.55) < 1.5;
        if (isFrame) { for (let z = 3; z < 8; z++) m.set(x, y, z, z === 7 ? frame : frame2); continue; }
        const hy = 14 + Math.sin(x * 0.09 + 1) * 6 + Math.sin(x * 0.21) * 2;
        let c;
        if (y < hy) c = hill[(y + (x >> 3)) % 3];
        else c = sky[clamp(Math.floor((y - hy) / ((h - hy) / 4)), 0, 3)];
        m.set(x, y, 0, c);
      }
      // a cloud, the sun and a wind turbine out on the hill
      m.ellipsoid(18, 52, 1.5, 9, 3.5, 1.5, cloud); m.ellipsoid(24, 55, 1.5, 6, 4, 1.5, cloud);
      m.ellipsoid(48, 62, 1, 4, 4, 1, sun);
      m.box(44, 14, 1, 44, 40, 1, tower);
      m.line(44, 40, 2, 37, 46, 2, tower); m.line(44, 40, 2, 51, 45, 2, tower); m.line(44, 40, 2, 45, 31, 2, tower);
      const r = renderVoxels(m, { scale: PXV, yaw: 0, pitch: 4, outline: true, ao: 0.5, edges: 0.6 });
      return spr(r, r.canvas.width / 2, r.canvas.height);
    }
    if (kind === 'monstera') {
      const m = new VoxelModel(60, 92, 34);
      const pot = ['#ffffff', '#e4f2fc'].map((c) => m.color(c, { spec: 0.9, smooth: 0.8 }));
      const potBand = m.color('#3ac4f8', { spec: 0.9 });
      const soil = m.color('#6a4a32');
      const leaf = ['#2fa84a', '#4ac85a', '#6ae06a', '#238a3e'].map((c) => m.color(c, { jitter: 0.06, spec: 0.5 }));
      const stem = m.color('#3a9a44');
      m.cone(30, 17, 0, 22, 11, 14, (x, y) => (y === 14 || y === 15 ? potBand : pot[y < 4 ? 1 : 0]));
      m.cylinder(30, 17, 22, 22, 12, soil);
      for (let i = 0; i < 7; i++) {
        const a = -1.3 + i * 0.43 + R.float(-0.1, 0.1), L = R.float(34, 58);
        const ex = 30 + Math.sin(a) * L * 0.75, ey = 22 + Math.cos(a) * L, ez = 17 + R.float(-6, 6);
        m.line(30, 22, 17, ex, ey - 4, ez, stem, 0.8);
        const lr = R.float(8, 12);
        m.ellipsoid(ex, ey, ez, lr, lr * 0.75, 2, (x, y, z) => {
          // monstera splits
          const ang = Math.atan2(y + 0.5 - ey, x + 0.5 - ex);
          const dd = Math.hypot(x + 0.5 - ex, y + 0.5 - ey);
          if (dd > lr * 0.45 && Math.sin(ang * 7 + i) > 0.82) return null;
          return leaf[(x + y + i) % 4 === 0 ? 2 : (i % 3)];
        });
      }
      yield;
      const r = renderVoxels(m, { scale: PXV, yaw: 0, pitch: 16, outline: true, ao: 0.5, edges: 0.7 });
      const [ax, ay] = r.project(30, 0, 17);
      return spr(r, ax, ay);
    }
    if (kind === 'shelf') {
      const m = new VoxelModel(72, 44, 18);
      const board = m.color('#ffffff', { spec: 0.8, smooth: 0.8 }), board2 = m.color('#d4e6f4');
      const glob = ['#4ad86a', '#2ab0f0', '#8ae86a'].map((c) => m.color(c, { spec: 1, smooth: 0.9 }));
      const book = ['#3ac4f8', '#ffb43a', '#6ae04a', '#ff7ab4', '#ffffff'].map((c) => m.color(c, { spec: 0.4 }));
      const chrome = m.color('#e8f0f8', { spec: 1 });
      const pot = m.color('#ffffff', { spec: 0.8 }), plant = ['#4ac85a', '#6ae06a'].map((c) => m.color(c, { jitter: 0.08 }));
      m.box(0, 0, 0, 71, 2, 17, (x, y) => (y === 0 ? board2 : board));
      // a glossy globe on a chrome stand
      m.box(12, 3, 9, 13, 6, 10, chrome);
      m.sphere(12.5, 16, 9.5, 9, (x, y, z) => glob[(hash3(x >> 2, y >> 2, z >> 2, 4) * 3) | 0]);
      // books
      let bx = 30;
      for (let i = 0; i < 6; i++) { const bh = R.int(12, 18), bw = R.int(2, 4); m.box(bx, 3, 4, bx + bw - 1, 3 + bh, 14, book[i % book.length]); bx += bw + (i === 3 ? 2 : 0); }
      // a little plant
      m.cone(60, 9, 3, 10, 5, 6, pot);
      for (let i = 0; i < 9; i++) m.line(60, 10, 9, 60 + R.float(-8, 8), 10 + R.float(6, 18), 9 + R.float(-5, 5), plant[i & 1], 1.2);
      const r = renderVoxels(m, { scale: PXV, yaw: 0, pitch: 16, outline: true, ao: 0.5, edges: 0.7 });
      const [ax, ay] = r.project(36, 0, 9);
      return spr(r, ax, ay);
    }
    if (kind === 'lamp') {
      const m = new VoxelModel(30, 96, 30);
      const chrome = m.color('#e8f0f8', { spec: 1, specPow: 24 }), base = m.color('#ffffff', { spec: 0.8 });
      const orb = m.color('#bff8ff', { emissive: 0.8, spec: 1 }), orb2 = m.color('#7ae8ff', { emissive: 0.6 });
      m.cylinder(15, 15, 0, 3, 10, base);
      m.cylinder(15, 15, 4, 74, 1.4, chrome);
      m.sphere(15, 84, 15, 11, (x, y, z) => (hash3(x >> 1, y >> 1, z >> 1, 3) < 0.25 ? orb2 : orb));
      const r = renderVoxels(m, { scale: PXV, yaw: 0, pitch: 14, outline: true, ao: 0.4, glowRadius: 4 });
      const [ax, ay] = r.project(15, 0, 15);
      return { ...spr(r, ax, ay), glow: r.glow };
    }
    return null;
  })();
}

// ------------------------------------------------------------------ tank equipment (gear levels)
export function gearSteps(kind, lv = 0, Z = 1.4) {
  return cached(`gear|${kind}|${lv}|${Z}`, function* () {
    yield;
    const k = Z / 1.4;
    const n = (v) => Math.max(2, Math.round(v * k));
    if (kind === 'filter') {
      // 0 sponge filter on the floor, 1 hang-on box over the back rim, 2 canister intake + spray bar, 3 turbo Aero module
      const h = n([46, 40, 70, 54][lv] || 46), w = n([12, 22, 10, 22][lv] || 14), d = 10;
      const m = new VoxelModel(w + 4, h + 4, d);
      const sponge = ['#3a8ad8', '#2a6ab8', '#4a9ae8'].map((c) => m.color(c, { jitter: 0.12 }));
      const pipe = m.color('#e8f8ff', { spec: 0.9, smooth: 0.8 }), pipe2 = m.color('#9ad8f0', { spec: 0.8 });
      const black = m.color('#2a3a4a', { spec: 0.6 }), white = m.color('#f4fbff', { spec: 0.8, smooth: 0.8 });
      const aqua = m.color('#3ac4f8', { spec: 1, emissive: 0.4 }), green = m.color('#6ae04a', { spec: 0.9, emissive: 0.3 });
      const cx = (w + 4) / 2;
      if (lv === 0) {
        m.cylinder(cx, 5, 0, Math.round(h * 0.38), w / 2, (x, y, z) => sponge[(hash3(x, y, z, 2) * 3) | 0]);
        m.cylinder(cx, 5, Math.round(h * 0.38), h, 1.2, pipe);
        m.box(cx - 2, h - 2, 4, cx + 2, h, 6, pipe2);
      } else if (lv === 1) {
        m.box(1, h - n(18), 1, w + 2, h, d - 2, (x, y) => (y === h - n(9) ? aqua : white));
        m.box(cx - 1, 0, 3, cx + 1, h - n(18), 6, pipe2);
        m.box(cx - 3, 0, 2, cx + 3, 4, 7, black);
      } else if (lv === 2) {
        m.cylinder(cx, 5, 0, h, 1.6, pipe);
        m.cylinder(cx, 5, 0, n(10), 2.6, (x, y) => (y % 2 ? black : pipe2));
        m.box(cx - 2, h - 2, 3, cx + 2, h, 7, pipe2);
      } else {
        m.box(1, 0, 1, w + 2, h, d - 2, (x, y, z) => (y % n(10) === 0 ? aqua : z === d - 2 && x > 3 && x < w && y > 4 && y < h - 4 ? (y % 3 ? green : aqua) : white));
      }
      const r = renderVoxels(m, { scale: PXV, yaw: 0, pitch: 14, outline: true, ao: 0.4, glowRadius: 3 });
      const [ax, ay] = r.project(cx, 0, 5);
      return { ...spr(r, ax, ay), glow: r.glow };
    }
    if (kind === 'heater') {
      if (lv <= 0) return null;
      const h = n(lv >= 2 ? 52 : 46);
      const m = new VoxelModel(10, h + 2, 8);
      const glass = m.color('#c8f4ff', { spec: 1, smooth: 0.9 }), coil = m.color('#ff7a3a', { emissive: 0.7 }), cap = m.color('#2a3a4a', { spec: 0.7 });
      const disp = m.color('#3ac4f8', { emissive: 1 }), cup = m.color('#e8f8ff', { spec: 0.8 });
      m.cylinder(5, 4, 3, h - 6, 2.2, (x, y) => (y % 3 === 0 && y < h - 10 ? coil : glass));
      m.cylinder(5, 4, h - 6, h, 2.6, cap);
      if (lv >= 2) m.box(3, h - 4, 6, 7, h - 2, 6, disp);
      m.box(2, Math.round(h * 0.3), 1, 8, Math.round(h * 0.3) + 1, 2, cup);
      m.box(2, Math.round(h * 0.75), 1, 8, Math.round(h * 0.75) + 1, 2, cup);
      const r = renderVoxels(m, { scale: PXV, yaw: 0, pitch: 10, outline: true, ao: 0.3, glowRadius: 3 });
      const [ax, ay] = r.project(5, 0, 4);
      return { ...spr(r, ax, ay), glow: r.glow };
    }
    if (kind === 'airstone') {
      // 0-1 round stones, 2 a bubble wall bar, 3 glowing geyser stones
      const w = lv === 2 ? n(60) : n(10), h = 5, d = 8;
      const m = new VoxelModel(w + 2, h + 2, d);
      const stone = ['#d8e4f0', '#b8c8dc', '#eef4fc'].map((c) => m.color(c, { jitter: 0.1 }));
      const glow = m.color('#7af8ff', { emissive: 1 }), tube = m.color('#bff4ff', { spec: 0.8 });
      if (lv === 2) { m.box(1, 0, 2, w, 2, 5, (x) => (x % 4 === 0 ? tube : stone[x % 3])); }
      else m.ellipsoid((w + 2) / 2, 2, 4, w / 2, 2.6, 3, (x, y, z) => (lv >= 3 && y >= 3 && hash3(x, y, z, 1) < 0.4 ? glow : stone[(hash3(x, y, z, 2) * 3) | 0]));
      const r = renderVoxels(m, { scale: PXV, yaw: 0, pitch: 18, outline: true, ao: 0.4, glowRadius: lv >= 3 ? 3 : 0 });
      const [ax, ay] = r.project((w + 2) / 2, 0, 4);
      return { ...spr(r, ax, ay), glow: r.glow };
    }
    if (kind === 'ledge') {
      // a little stone shelf glued to the back glass that wall-mounted pieces sit on
      const w = n(30) | 0;
      const m = new VoxelModel(w + 2, 7, 10);
      const st = ['#9aa8bc', '#b4c0d0', '#8494aa'].map((c) => m.color(c, { jitter: 0.1 }));
      const moss = m.color('#5ac85a', { jitter: 0.1 });
      for (let x = 1; x <= w; x++) {
        const t = Math.abs(x - w / 2) / (w / 2);
        const hh = Math.round(6 - t * t * 3);
        for (let y = 6 - hh; y < 6; y++) for (let z = 0; z < 9 - Math.round(t * 3); z++) m.set(x, y, z, y === 5 && hash2(x, z, 3) < 0.3 ? moss : st[(hash3(x, y, z, 1) * 3) | 0]);
      }
      const r = renderVoxels(m, { scale: PXV, yaw: 0, pitch: 22, outline: true, ao: 0.4 });
      const [ax, ay] = r.project((w + 2) / 2, 6, 4);
      return spr(r, ax, ay);
    }
    return null;
  })();
}

// Run a generator to completion now (small sprites, editor previews).
export function runNow(it) {
  let r = it.next();
  while (!r.done) r = it.next();
  return r.value;
}
