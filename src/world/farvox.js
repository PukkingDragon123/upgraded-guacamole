// Voxel far layers for the biomes: big hand-shaped formations (reef pinnacles with coral crowns, mesas, natural
// arches, kelp columns; junk mountains, a sunken freighter, a lattice dock crane, container stacks, utility poles;
// a stepped temple, colonnades, broken arches and obelisks) rendered once with the voxel renderer and laid into
// wide strips that the biomes fog toward the live water colour (FogLayer) and draw with a gentle wobble.
//
// strip(LW, h, base, items, ridge) -> canvas;  items: [{spr, x, z}] (spr = {canvas, ox, oy}, x = strip x of the
// ground point, z = draw order: higher is further back). Ridge: an optional voxel ground strip drawn after z > 0.5.

import { VoxelModel } from '../gfx/voxel.js';
import { makeCanvas, ctxOf } from '../core/canvas.js';
import { RNG } from '../core/rng.js';
import { TAU, smoothstep, hash3, fbm2 } from '../core/math.js';
import { renderModel, worldProp } from './voxkit.js';

const spr = (r) => ({ canvas: r.canvas, ox: r.ox, oy: r.oy, w: r.w, h: r.h });
export const render = (m, o = {}) => spr(renderModel(m, { scale: 2, yaw: 24, pitch: 16, jitter: 0.16, ...o }));

export function propSprite(id, scale = 1.15, variant = 0) {
  try { const p = worldProp(id, { scale, variant }); return { canvas: p.canvas, ox: p.ox, oy: p.oy, w: p.w, h: p.h }; } catch { return null; }
}

export function strip(LW, h, items, ridge = null) {
  const c = makeCanvas(LW, h);
  const g = ctxOf(c);
  items.sort((a, b) => b.z - a.z);
  let ridgeDone = !ridge;
  for (const it of items) {
    if (!ridgeDone && it.z <= 0.5) { g.drawImage(ridge.canvas, ridge.x, ridge.y); ridgeDone = true; }
    const s = it.spr;
    if (!s) continue;
    g.drawImage(s.canvas, Math.round(it.x - s.ox), Math.round(it.y - s.oy));
  }
  if (!ridgeDone) g.drawImage(ridge.canvas, ridge.x, ridge.y);
  return c;
}

// ------------------------------------------------------------------ generic formations

const pals = (m, cols, o = {}) => cols.map((c) => m.color(c, { jitter: 0.2, ...o }));

// Irregular stacked-disc spire with ledges; crown(m, x, y, z, r) decorates exposed tops.
export function spire(seed, { h = 60, w = 9, d = 18, lean = 0, cols, crown = null, ledges = 8, taper = 0.62 }) {
  const r = new RNG(seed);
  const W = Math.ceil(w * 2 + Math.abs(lean) * h + 8), D = d;
  const m = new VoxelModel(W, h + 6, D);
  const P = pals(m, cols);
  const cx0 = W / 2 - (lean * h) / 2, cz = D / 2;
  let ledge = r.int(4, ledges);
  for (let y = 0; y < h; y++) {
    const k = y / h;
    let rr = w * (1 - Math.pow(k, 1.3) * taper) * (0.92 + 0.16 * Math.sin(y * 0.45 + seed));
    if (y === ledge) { rr *= 1.25; ledge += r.int(5, ledges + 4); }
    const cx = cx0 + lean * y + Math.sin(y * 0.11 + seed) * 1.2;
    const rz = Math.min(D / 2 - 0.5, rr * 0.85);
    for (let z = 0; z < D; z++) for (let x = Math.floor(cx - rr - 1); x <= Math.ceil(cx + rr + 1); x++) {
      const dx = (x + 0.5 - cx) / rr, dz = (z + 0.5 - cz) / rz;
      if (dx * dx + dz * dz > 1) continue;
      const band = Math.floor((y + hash3(x, 0, z, 3) * 3) / 4) % P.length;
      m.set(x, y, z, P[band]);
    }
  }
  if (crown) decorate(m, r, crown);
  return m;
}

// Flat-topped terraced mesa.
export function mesa(seed, { h = 34, w = 26, d = 18, cols, crown = null }) {
  const r = new RNG(seed);
  const W = w * 2 + 8;
  const m = new VoxelModel(W, h + 8, d);
  const P = pals(m, cols);
  const tiers = r.int(2, 4);
  for (let t = 0; t < tiers; t++) {
    const y0 = Math.round((t / tiers) * h), y1 = Math.round(((t + 1) / tiers) * h);
    const rw = w * (1 - t * 0.22) * r.float(0.9, 1.05), rz = Math.min(d / 2 - 0.5, (d / 2) * (1 - t * 0.12));
    const cx = W / 2 + r.float(-3, 3);
    for (let y = y0; y < y1; y++) for (let z = 0; z < d; z++) for (let x = 0; x < W; x++) {
      const dx = (x + 0.5 - cx) / (rw * (1 - (y - y0) / (y1 - y0 + 1) * 0.08)), dz = (z + 0.5 - d / 2) / rz;
      if (Math.pow(Math.abs(dx), 3) + Math.pow(Math.abs(dz), 3) > 1) continue;
      m.set(x, y, z, P[Math.floor((y + hash3(x, 0, z, 9) * 2) / 3) % P.length]);
    }
  }
  if (crown) decorate(m, r, crown);
  return m;
}

// Natural rock arch (two legs + a thick curved span).
export function rockArch(seed, { span = 44, h = 50, th = 7, d = 16, cols, crown = null }) {
  const r = new RNG(seed);
  const W = span + th * 2 + 10;
  const m = new VoxelModel(W, h + th + 6, d);
  const P = pals(m, cols);
  const cx = W / 2, R = span / 2 + th / 2;
  const put = (x, y, z, rr) => {
    for (let k = 0; k < d; k++) for (let i = -rr; i <= rr; i++) for (let j = -rr; j <= rr; j++) {
      if (i * i + j * j > rr * rr || Math.abs(k + 0.5 - d / 2) > d / 2 - 1 + Math.sin(y * 0.3) * 0.8) continue;
      m.set(Math.round(x + i), Math.round(y + j), k, P[Math.floor((y + j + hash3(x + i, 0, k, 2) * 3) / 4) % P.length]);
    }
  };
  for (let a = 0; a <= Math.PI; a += 0.02) put(cx + Math.cos(a) * R, h - R + Math.sin(a) * R * 0.95, 0, th * (0.8 + 0.3 * Math.sin(a * 3 + seed)));
  for (let y = 0; y < h - R; y++) { put(cx - R, y, 0, th * 1.05); put(cx + R, y, 0, th * 1.05); }
  if (crown) decorate(m, r, crown);
  return m;
}

// Coral / algae / snow crowns on exposed top voxels: crown = {cols, density, blobs}
function decorate(m, r, crown) {
  const C = crown.cols.map((c) => m.color(c, { jitter: 0.15 }));
  const tops = [];
  for (let z = 0; z < m.nz; z++) for (let x = 0; x < m.nx; x++) {
    for (let y = m.ny - 2; y >= 0; y--) {
      if (m.get(x, y, z)) { if (!m.get(x, y + 1, z)) tops.push([x, y, z]); break; }
    }
  }
  for (const [x, y, z] of tops) if (r.chance(crown.density ?? 0.5)) m.set(x, y + (r.chance(0.3) ? 1 : 0), z, r.pick(C));
  // ledge tops (not only the very top): scan for exposed top faces anywhere
  for (let i = 0; i < (crown.blobs ?? 10); i++) {
    const [x, y, z] = tops[r.int(0, tops.length - 1)] || [0, 0, 0];
    const c = r.pick(C);
    if (crown.branch && r.chance(0.5)) {
      for (let k = 0; k < r.int(2, 4); k++) m.line(x, y + 1, z, x + r.int(-3, 3), y + r.int(3, 6), z + r.int(-1, 1), c, 0);
    } else m.ellipsoid(x + 0.5, y + 1.5, z + 0.5, r.float(1.2, 2.6), r.float(1, 2.2), r.float(1.2, 2.2), c);
  }
  // side growth on ledges
  for (let z = 1; z < m.nz - 1; z++) for (let y = 1; y < m.ny - 1; y++) for (let x = 1; x < m.nx - 1; x++) {
    if (!m.get(x, y, z) || m.get(x, y + 1, z) || hash3(x, y, z, 5) > (crown.ledge ?? 0.18)) continue;
    m.set(x, y + 1, z, C[Math.floor(hash3(x, y, z, 7) * C.length)]);
  }
}

// Long rolling ground strip (yaw 0 so it stays level), with scattered rocks.
export function ridgeStrip(seed, LW, { amp = 10, base = 6, d = 16, cols, rocks = null, scale = 2 }) {
  const r = new RNG(seed);
  const nx = Math.ceil(LW / scale) + 2;
  const m = new VoxelModel(nx, base + amp + 12, d);
  const P = pals(m, cols);
  for (let x = 0; x < nx; x++) {
    const hh = base + amp * (0.5 + 0.5 * Math.sin(x * 0.037 + seed) * 0.6 + (fbm2(x * 0.05, seed, 3, seed) - 0.5) * 0.9);
    for (let z = 0; z < d; z++) {
      const h = Math.round(hh * (0.55 + 0.45 * Math.sin(((z + 0.5) / d) * Math.PI)));
      for (let y = 0; y < h; y++) m.set(x, y, z, P[Math.min(P.length - 1, Math.floor((h - y) / 2 + hash3(x, y, z, 1) * 1.5))]);
    }
  }
  if (rocks) {
    const R = rocks.cols.map((c) => m.color(c, { jitter: 0.2 }));
    for (let i = 0; i < nx / 6; i++) {
      const x = r.int(2, nx - 3), z = r.int(3, d - 4);
      let y = 0; while (m.get(x, y, z)) y++;
      m.ellipsoid(x, y, z, r.float(1.5, 3.5), r.float(1.2, 3), r.float(1.5, 3), r.pick(R));
    }
  }
  const out = render(m, { scale, yaw: 0, pitch: 18 });
  return out;
}

// Static voxel kelp column (for far layers).
export function kelpColumn(seed, h, cols, scale = 2) {
  const r = new RNG(seed);
  const m = new VoxelModel(16, h + 4, 8);
  const C = cols.map((c) => m.color(c, { jitter: 0.15 }));
  let x = 8;
  for (let y = 0; y < h; y++) {
    x += Math.sin(y * 0.18 + seed) * 0.35;
    m.set(Math.round(x), y, 4, C[0]);
    if (y % 3 === 0 && y > 3) {
      const s = (y / 3) % 2 ? 1 : -1, len = r.int(2, 4);
      for (let k = 1; k <= len; k++) m.set(Math.round(x) + s * k, y + Math.floor(k / 2), 4, C[Math.min(C.length - 1, 1 + (k > 2 ? 1 : 0))]);
    }
  }
  return render(m, { yaw: 0, pitch: 10, outline: true, scale });
}

// ------------------------------------------------------------------ junkyard pieces

export function junkHeap(seed, { w = 40, h = 30, d = 20 }) {
  const r = new RNG(seed);
  const m = new VoxelModel(w * 2 + 10, h + 12, d);
  const cols = ['#7a6a5a', '#6a6e78', '#8a5a3e', '#5a6a5a', '#9a8a6a', '#4a5e7a', '#8a3e34', '#6e6a5e', '#3a3e48'].map((c) => m.color(c, { jitter: 0.22 }));
  const dirt = m.color('#5a5446', { jitter: 0.25 });
  const screen = m.color('#3affa0', { emissive: 0.6 });
  const cx = m.nx / 2;
  for (let z = 0; z < d; z++) for (let x = 0; x < m.nx; x++) {
    const dx = (x - cx) / w, dz = (z - d / 2) / (d / 2);
    const hh = h * Math.max(0, 1 - dx * dx - dz * dz * 0.4) * (0.85 + 0.15 * Math.sin(x * 0.5 + z));
    for (let y = 0; y < hh; y++) m.set(x, y, z, dirt);
  }
  for (let i = 0; i < w * 1.4; i++) {
    const x = cx + r.float(-w * 0.9, w * 0.9), z = r.float(2, d - 3);
    const dx = (x - cx) / w;
    const top = h * Math.max(0, 1 - dx * dx) - r.float(0, 4);
    const c = r.pick(cols), k = r.next();
    if (k < 0.4) { const bw = r.int(2, 6), bh = r.int(2, 5); m.box(x, top - 1, z, x + bw, top + bh, z + r.int(2, 4), c); if (r.chance(0.25)) m.box(x + 1, top + 1, z + 2, x + bw - 1, top + bh - 1, z + 2, screen); }
    else if (k < 0.6) m.cylinder(x, z, top - 1, top + r.int(2, 6), r.float(1.2, 2.6), c);
    else if (k < 0.75) for (let a = 0; a < TAU; a += 0.35) m.set(x + Math.cos(a) * 2.6, top + 2 + Math.sin(a) * 2.6, z, cols[8]);
    else m.line(x, top, z, x + r.int(-6, 6), top + r.int(4, 14), z + r.int(-2, 2), c, r.chance(0.5) ? 0.6 : 0);
  }
  return m;
}

export function freighter(seed) {
  const r = new RNG(seed);
  const L = 150, m = new VoxelModel(L + 20, 70, 26);
  const C = (c, o = {}) => m.color(c, { jitter: 0.18, ...o });
  const hull = C('#5a3a32'), rust = C('#8a4a2a'), hullD = C('#3a2a28'), deck = C('#5a5a52'), white = C('#bab4a4'), win = C('#22282c'), mast = C('#4a4e52');
  const cont = ['#9a3a2e', '#2e5a8a', '#3a7a4a', '#a8862e', '#6a4a8a'].map((c) => C(c));
  const zc = 13;
  for (let u = 0; u < L; u++) {
    const x = u + 6;
    const bow = smoothstep(L - 30, L, u), stern = 1 - smoothstep(0, 8, u);
    const yb = Math.round(bow * 12 + stern * 4), ys = Math.round(24 + bow * 6);
    const hb = 11 * (1 - Math.pow(bow, 2) * 0.95);
    for (let y = yb; y <= ys; y++) for (let z = 0; z < 26; z++) {
      if (Math.abs(z - zc) > hb * (0.5 + 0.5 * Math.pow((y - yb) / Math.max(1, ys - yb), 0.4))) continue;
      m.set(x, y, z, y > ys - 2 ? deck : hash3(x >> 1, y >> 2, 0, 3) < 0.18 ? rust : y < 8 ? hullD : hull);
    }
  }
  // holes punched in the hull
  m.sub(() => { m.sphere(70, 14, 24, 5, 1); m.sphere(100, 10, 24, 4, 1); });
  // superstructure aft
  m.box(10, 25, 4, 34, 46, 22, (x, y) => (y % 5 === 2 && x % 3 !== 0 ? win : white));
  m.box(14, 47, 6, 30, 52, 20, (x, y) => (y === 49 && x % 2 ? win : white));
  m.cylinder(22, 13, 53, 62, 2.6, rust);
  // containers
  for (let k = 0; k < 5; k++) for (let lvl = 0; lvl < 2 - (k % 2); lvl++) {
    const x0 = 42 + k * 20, y0 = 25 + lvl * 8;
    m.box(x0, y0, 5 + r.int(0, 2), x0 + 17, y0 + 7, 19, r.pick(cont));
  }
  m.line(130, 30, 13, 140, 62, 13, mast, 0.8);
  m.line(140, 62, 13, 155, 50, 13, mast, 0);
  return m;
}

export function latticeCrane(seed, h = 90) {
  const m = new VoxelModel(110, h + 10, 14);
  const y1 = m.color('#c88a3a', { jitter: 0.12 }), y2 = m.color('#9a6a2a', { jitter: 0.1 }), cab = m.color('#3e5a7a'), cable = m.color('#22242a');
  for (const z of [3, 10]) { m.line(20, 0, z, 24, h, z, y1, 0.8); m.line(34, 0, z, 30, h, z, y1, 0.8); }
  for (let y = 4; y < h; y += 10) for (const z of [3, 10]) { m.line(20 + y * 0.044, y, z, 34 - (y + 10) * 0.044, y + 10, z, y2, 0); m.line(34 - y * 0.044, y, z, 20 + (y + 10) * 0.044, y + 10, z, y2, 0); }
  m.box(4, h, 3, 104, h + 3, 10, (x) => (x % 6 < 2 ? y1 : y2));
  m.sub(() => m.box(6, h + 1, 4, 102, h + 2, 9, 1));
  m.box(22, h - 8, 4, 32, h - 1, 9, cab);
  m.line(90, h, 6, 90, h - 50, 6, cable, 0);
  m.box(87, h - 56, 5, 93, h - 51, 8, y2);
  void seed;
  return m;
}

export function containerStackModel(seed, cols = 4, rows = 3) {
  const r = new RNG(seed);
  const m = new VoxelModel(cols * 19 + 6, rows * 9 + 4, 24);
  const C = ['#b84a3a', '#3a6ab8', '#3a984e', '#d0982e', '#7a4ab0', '#c86a2e', '#4a5a6a'].map((c) => m.color(c, { jitter: 0.1 }));
  const D = C.map((c) => m.color(m.palette[c].color, { jitter: 0.05, light: -1.1 }));
  for (let row = 0; row < rows; row++) for (let i = 0; i < cols - row; i++) {
    if (r.chance(0.15)) continue;
    const ci = r.int(0, C.length - 1);
    const x0 = 2 + i * 19 + row * 9 + r.int(-1, 1), y0 = row * 9, z0 = 3 + r.int(0, 3);
    m.box(x0, y0, z0, x0 + 17, y0 + 8, z0 + 10, (x) => ((x - x0) % 2 === 0 && x > x0 && x < x0 + 17 ? D[ci] : C[ci]));
  }
  return m;
}

export function utilityPole(seed, h = 70) {
  const m = new VoxelModel(24, h + 4, 6);
  const wood = m.color('#5a4a3a', { jitter: 0.15 }), metal = m.color('#4a4e56'), ins = m.color('#c8d0c8');
  m.line(12, 0, 3, 12, h, 3, wood, 0.8);
  for (const [y, w] of [[h - 4, 10], [h - 11, 7]]) {
    m.line(12 - w, y, 3, 12 + w, y, 3, wood, 0.5);
    for (const dx of [-w + 1, 0, w - 1]) { m.set(12 + dx, y + 1, 3, ins); m.set(12 + dx, y + 2, 3, ins); }
  }
  m.box(9, h - 20, 1, 15, h - 15, 5, metal);
  void seed;
  return m;
}

// ------------------------------------------------------------------ abyss pieces

export function ziggurat(seed, { w = 64, steps = 6, stepH = 7, d = 30, cols, glow }) {
  const m = new VoxelModel(w * 2 + 6, steps * stepH + 40, d + 4);
  const P = pals(m, cols, { jitter: 0.14 });
  const G = m.color(glow, { emissive: 0.8 });
  const cx = m.nx / 2, cz = m.nz / 2;
  for (let s = 0; s < steps; s++) {
    const rw = w * (1 - s / (steps + 1)), rz = (d / 2) * (1 - s / (steps + 2));
    const y0 = s * stepH;
    m.box(cx - rw, y0, cz - rz, cx + rw, y0 + stepH - 1, cz + rz, (x, y, z) => (y === y0 + stepH - 1 ? P[0] : (x + y) % 9 === 0 ? P[2] : P[1]));
    // stair in the middle front
    m.box(cx - 4, y0, cz + rz - 1, cx + 4, y0 + stepH - 1, cz + rz + 1, (x, y) => (y % 2 ? P[0] : P[2]));
  }
  const ty = steps * stepH;
  m.box(cx - 10, ty, cz - 6, cx + 10, ty + 16, cz + 6, P[1]);
  m.box(cx - 12, ty + 17, cz - 8, cx + 12, ty + 19, cz + 8, P[0]);
  m.box(cx - 4, ty, cz + 6, cx + 4, ty + 10, cz + 6, G);
  for (let k = 0; k < 4; k++) m.set(cx - 8 + k * 5, ty + 14, cz + 6, G);
  void seed;
  return m;
}

export function colonnade(seed, { n = 7, h = 40, gap = 12, cols, broken = 0.3 }) {
  const r = new RNG(seed);
  const m = new VoxelModel(n * gap + 10, h + 12, 14);
  const P = pals(m, cols, { jitter: 0.12 });
  for (let i = 0; i < n; i++) {
    const x = 5 + i * gap, hh = r.chance(broken) ? Math.round(h * r.float(0.35, 0.75)) : h;
    m.box(x - 3, 0, 3, x + 3, 2, 10, P[2]);
    for (let y = 3; y < hh; y++) m.cylinder(x, 7, y, y, 2.6 + (y % 6 === 0 ? 0.3 : 0), (xx, yy, zz) => ((Math.atan2(zz - 7, xx - x) * 4) % 1 > 0.5 ? P[1] : P[0]));
    if (hh === h) m.box(x - 4, h, 2, x + 4, h + 2, 12, P[2]);
  }
  for (let i = 0; i < n - 1; i++) if (r.chance(0.6)) m.box(5 + i * gap - 3, h + 3, 3, 5 + (i + 1) * gap + 3, h + 5, 11, P[0]);
  return m;
}

export function obelisk(seed, { h = 50, cols, glow }) {
  const m = new VoxelModel(16, h + 6, 16);
  const P = pals(m, cols, { jitter: 0.12 });
  const G = m.color(glow, { emissive: 0.85 });
  for (let y = 0; y < h; y++) { const rr = 5 * (1 - (y / h) * 0.45); m.box(8 - rr, y, 8 - rr, 8 + rr, y, 8 + rr, y % 9 === 0 ? P[2] : P[0]); }
  m.cone(8, 8, h, h + 5, 3, 0.4, P[1], 'y');
  for (let y = 8; y < h - 6; y += 7) m.set(8, y, 8 + Math.floor(5 * (1 - (y / h) * 0.45)), G);
  void seed;
  return m;
}


