// Deep-zone voxel dressing (phase 7, Environment agent): fine voxel props that grow on the deep column's ledges,
// sea-stack tops and canyon walls, a different cast per zone:
//   twilight  glass sponges, lacy sea fans, crinoids, orange cup-coral clusters, brittle-star rocks
//   midnight  black coral trees with glowing polyps, bioluminescent mushroom caps, glowing crystal shards, sea pens
//   abyss     hydrothermal chimneys with glowing cracks, tube-worm thickets, bone piles, crystals, dim glow caps
// Models are built voxel by voxel (2 hi px per voxel = 2/3 world px at the 3x camera) and rendered with the world
// camera; emissive voxels come back as a glow layer that the deep's glow pass draws after the darkness.
//
//   dressModel(kind, seed, cols) -> VoxelModel       DRESS[zoneId] -> kinds        dressSprite(kind, seed, cols, R)

import { VoxelModel, renderVoxels, refineSteps } from '../gfx/voxel.js';
import { runSteps } from './slabrender.js';
import { RNG } from '../core/rng.js';
import { mix, shade } from '../core/color.js';
import { hash3, TAU } from '../core/math.js';
import { noise3 } from '../gfx/props.js';
import { WORLD_YAW, WORLD_PITCH } from './voxkit.js';

export const DRESS = {
  twilight: ['sponge', 'fan', 'crinoid', 'cups', 'fan', 'sponge', 'brittle'],
  midnight: ['blackcoral', 'shrooms', 'crystal', 'pen', 'blackcoral', 'crinoid'],
  abyss: ['vent', 'worms', 'bones', 'crystal', 'shrooms', 'worms'],
};

const C = (m, hex, o = {}) => m.color(hex, { jitter: 0.12, ...o });

// mossy rock lump with strata, a few pebbles around it
function rockBase(m, r, cx, cz, w, h, d, cols) {
  const R = cols.rock.map((c) => C(m, c, { jitter: 0.16 }));
  const moss = C(m, cols.moss || '#3e5a4a', { jitter: 0.2 });
  const seed = r.int(0, 999);
  for (let y = 0; y <= h; y++) for (let z = Math.floor(cz - d); z <= cz + d; z++) for (let x = Math.floor(cx - w); x <= cx + w; x++) {
    const dx = (x + 0.5 - cx) / w, dy = (y + 0.5) / h, dz = (z + 0.5 - cz) / d;
    const q = dx * dx + dy * dy * 1.1 + dz * dz;
    if (q > 1 + (noise3(x * 0.3, y * 0.3, z * 0.3, seed) - 0.5) * 0.5) continue;
    const band = Math.floor(y * 0.7 + noise3(x * 0.1, y * 0.2, z * 0.1, seed + 3) * 3) % R.length;
    m.set(x, y, z, R[band]);
  }
  // moss on top faces
  for (let z = 0; z < m.nz; z++) for (let x = 0; x < m.nx; x++) for (let y = h + 1; y >= 0; y--) {
    if (!m.get(x, y, z)) continue;
    if (noise3(x * 0.25, 0, z * 0.25, seed + 9) > 0.5) m.set(x, y, z, moss);
    break;
  }
  for (let i = 0; i < 6; i++) m.set(Math.round(cx + r.float(-w - 3, w + 3)), 0, Math.round(cz + r.float(-d, d)), R[r.int(0, R.length - 1)]);
}

function glassSponge(m, r, cols) {
  const cx = m.nx / 2, cz = m.nz / 2, H = r.int(26, 36);
  const body = C(m, cols.pale, { spec: 0.4 }), hole = C(m, shade(cols.pale, -0.3)), rim = C(m, mix(cols.pale, '#ffffff', 0.5), { spec: 0.6 });
  rockBase(m, r, cx, cz, 9, 4, 6, cols);
  const lean = r.float(-0.12, 0.12);
  for (let y = 3; y < H; y++) {
    const u = (y - 3) / (H - 3);
    const rad = 2.4 + u * 5.5 + Math.sin(u * 7) * 0.4;
    const ox = cx + lean * y;
    for (let a = 0; a < 64; a++) {
      const t = (a / 64) * TAU;
      const x = Math.floor(ox + Math.cos(t) * rad), z = Math.floor(cz + Math.sin(t) * rad * 0.8);
      const lattice = ((Math.floor(t * 4) + y) % 4 === 0) || (y % 5 === 0);
      m.set(x, y, z, y >= H - 1 ? rim : lattice || hash3(x, y, z, 3) < 0.2 ? body : hole);
    }
  }
}

function seaFan(m, r, cols) {
  const cx = m.nx / 2, cz = Math.floor(m.nz / 2);
  const col = r.pick(cols.sponge);
  const stem = C(m, shade(col, -0.35)), a = C(m, col), b = C(m, shade(col, 0.2)), tip = C(m, mix(col, '#ffffff', 0.45));
  rockBase(m, r, cx, cz, 6, 3, 4, cols);
  const branch = (x, y, ang, len, w, depth) => {
    const ex = x + Math.sin(ang) * len, ey = y + Math.cos(ang) * len;
    m.line(x, y, cz + 0.5, ex, ey, cz + 0.5, depth < 2 ? stem : depth < 4 ? a : b, w);
    if (depth >= 6 || len < 2.5) { m.set(Math.floor(ex), Math.floor(ey), cz, tip); return; }
    const n = r.chance(0.3) ? 3 : 2;
    for (let i = 0; i < n; i++) branch(ex, ey, ang + r.float(-0.75, 0.75), len * r.float(0.62, 0.82), Math.max(0.5, w * 0.75), depth + 1);
  };
  branch(cx, 3, r.float(-0.15, 0.15), r.float(9, 12), 1.2, 0);
  // lacy mesh between branches: fill in the plate where neighbours are close
  const lace = C(m, shade(col, 0.05));
  for (let y = 4; y < m.ny; y++) for (let x = 1; x < m.nx - 1; x++) {
    if (m.get(x, y, cz)) continue;
    let n = 0;
    for (let k = 1; k <= 2; k++) n += (m.get(x - k, y, cz) ? 1 : 0) + (m.get(x + k, y, cz) ? 1 : 0);
    if (n >= 2 && (x + y) % 2 === 0) m.set(x, y, cz, lace);
  }
}

function crinoid(m, r, cols, glow) {
  const cx = m.nx / 2, cz = m.nz / 2;
  const col = glow ? '#c8c0d8' : r.pick(['#ffd25a', '#ff8a5a', '#f0f0e0', '#ff6a8a']);
  const s0 = C(m, shade(col, -0.3)), s1 = C(m, shade(col, -0.1)), arm = C(m, col), pin = C(m, mix(col, '#ffffff', 0.4));
  const tipC = glow ? C(m, glow, { emissive: 0.9 }) : pin;
  rockBase(m, r, cx, cz, 5, 3, 4, cols);
  const H = r.int(18, 28), lean = r.float(-0.3, 0.3);
  let px = cx, py = 3;
  for (let y = 3; y < H; y++) { const x = cx + Math.sin(y * 0.12) * 1.5 + lean * (y - 3) * 0.3; m.line(px, py, cz, x, y, cz, (y >> 1) & 1 ? s0 : s1, 0.7); px = x; py = y; }
  const n = r.int(8, 11);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    const dx = Math.cos(a), dz = Math.sin(a) * 0.7;
    let x = px, y = py, z = cz;
    for (let k = 0; k < 10; k++) {
      const nx2 = x + dx * 1.3, ny2 = y + 1.3 - k * 0.42, nz2 = z + dz * 1.3;
      m.line(x, y, z, nx2, ny2, nz2, arm, 0.55);
      if (k % 2 === 0) { m.set(Math.floor(nx2 - dz), Math.floor(ny2 + 0.6), Math.floor(nz2 + dx * 0.5), pin); m.set(Math.floor(nx2 + dz), Math.floor(ny2 + 0.6), Math.floor(nz2 - dx * 0.5), pin); }
      x = nx2; y = ny2; z = nz2;
    }
    m.set(Math.floor(x), Math.floor(y), Math.floor(z), tipC);
  }
}

function cupCorals(m, r, cols) {
  const cx = m.nx / 2, cz = m.nz / 2;
  rockBase(m, r, cx, cz, 11, 7, 7, cols);
  const P = [r.pick(cols.sponge), r.pick(cols.sponge)];
  for (let i = 0; i < 14; i++) {
    const col = P[i & 1], c0 = C(m, shade(col, -0.2)), c1 = C(m, col, { spec: 0.3 }), c2 = C(m, mix(col, '#ffffff', 0.35));
    const x = Math.round(cx + r.float(-9, 9)), z = Math.round(cz + r.float(-5, 6));
    let y = 0; for (let yy = m.ny - 1; yy >= 0; yy--) if (m.get(x, yy, z)) { y = yy + 1; break; }
    const h = r.int(2, 5), rad = r.float(1.3, 2.3);
    m.cylinder(x + 0.5, z + 0.5, y, y + h, rad, c0);
    m.cylinder(x + 0.5, z + 0.5, y + h, y + h, rad + 0.4, c1);
    m.set(x, y + h, z, c2);
  }
}

function brittleRock(m, r, cols) {
  const cx = m.nx / 2, cz = m.nz / 2;
  rockBase(m, r, cx, cz, 12, 8, 7, cols);
  for (let s = 0; s < 3; s++) {
    const col = r.pick(['#ff7a5a', '#ffd25a', '#c87aff', '#ff5a8a']);
    const body = C(m, col), arm = C(m, shade(col, 0.15));
    const x0 = cx + r.float(-7, 7), z0 = cz + r.float(-3, 4);
    let y0 = 0; for (let yy = m.ny - 1; yy >= 0; yy--) if (m.get(Math.round(x0), yy, Math.round(z0))) { y0 = yy + 1; break; }
    m.set(Math.round(x0), y0, Math.round(z0), body);
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * TAU + r.float(0, 1);
      let x = x0, z = z0;
      for (let j = 0; j < 7; j++) { x += Math.cos(a + Math.sin(j * 0.9) * 0.4); z += Math.sin(a + Math.sin(j * 0.9) * 0.4) * 0.6; let y = y0; while (y > 0 && !m.get(Math.round(x), y - 1, Math.round(z))) y--; if (y > y0 + 1) break; m.set(Math.round(x), Math.max(y, 0), Math.round(z), arm); }
    }
  }
}

function blackCoral(m, r, cols, glow) {
  const cx = m.nx / 2, cz = m.nz / 2;
  rockBase(m, r, cx, cz, 6, 3, 5, cols);
  const trunk = C(m, '#1e1a24'), br = C(m, '#2e2836'), pol = C(m, glow, { emissive: 0.85 }), pol2 = C(m, mix(glow, '#ffffff', 0.5), { emissive: 1 });
  const branch = (x, y, z, ang, tilt, len, w, d) => {
    const ex = x + Math.sin(ang) * len, ey = y + Math.cos(ang) * len, ez = z + tilt * len;
    m.line(x, y, z, ex, ey, ez, d < 2 ? trunk : br, w);
    for (let k = 1; k < 4; k++) if (r.chance(0.45)) m.set(Math.floor(x + (ex - x) * k / 4 + r.float(-1, 1)), Math.floor(y + (ey - y) * k / 4), Math.floor(z + (ez - z) * k / 4), r.chance(0.3) ? pol2 : pol);
    if (d >= 5 || len < 2) { m.set(Math.floor(ex), Math.floor(ey), Math.floor(ez), pol2); return; }
    for (let i = 0; i < 2; i++) branch(ex, ey, ez, ang + r.float(-0.8, 0.8), r.float(-0.2, 0.2), len * r.float(0.6, 0.8), Math.max(0.5, w * 0.7), d + 1);
  };
  branch(cx, 3, cz, r.float(-0.2, 0.2), 0, r.float(9, 12), 1.1, 0);
}

function glowShrooms(m, r, cols, glow) {
  const cx = m.nx / 2, cz = m.nz / 2;
  rockBase(m, r, cx, cz, 10, 4, 6, cols);
  const stem = C(m, '#cfc6d8'), stemD = C(m, '#8a8098');
  for (let i = 0; i < r.int(4, 7); i++) {
    const g = r.pick(cols.glows), cap = C(m, shade(g, -0.35)), spot = C(m, g, { emissive: 0.9 }), gill = C(m, mix(g, '#ffffff', 0.3), { emissive: 1 });
    const x = cx + r.float(-8, 8), z = cz + r.float(-4, 4);
    let y = 0; for (let yy = m.ny - 1; yy >= 0; yy--) if (m.get(Math.round(x), yy, Math.round(z))) { y = yy + 1; break; }
    const h = r.int(4, 11), cr = r.float(2.2, 4.2);
    m.line(x, y, z, x + r.float(-1, 1), y + h, z, stemD, 0.8);
    m.line(x, y, z, x, y + h, z, stem, 0.6);
    for (let yy = 0; yy <= cr * 0.8; yy++) {
      const rr = cr * Math.sqrt(1 - (yy / (cr * 0.85)) ** 2);
      for (let dz = -Math.ceil(rr); dz <= rr; dz++) for (let dx = -Math.ceil(rr); dx <= rr; dx++) {
        if (dx * dx + dz * dz > rr * rr) continue;
        const X = Math.round(x + dx), Y = y + h + yy, Z = Math.round(z + dz);
        m.set(X, Y, Z, yy === 0 && dx * dx + dz * dz > (rr - 1.2) ** 2 ? gill : hash3(X, Y, Z, 5) < 0.16 ? spot : cap);
      }
    }
  }
}

function crystal(m, r, cols, glow) {
  const cx = m.nx / 2, cz = m.nz / 2;
  rockBase(m, r, cx, cz, 9, 4, 6, cols);
  const g = glow || r.pick(cols.glows);
  const a = C(m, shade(g, -0.4), { spec: 0.5 }), b = C(m, shade(g, -0.1), { spec: 0.7, emissive: 0.35 }), c = C(m, mix(g, '#ffffff', 0.55), { emissive: 0.9 });
  for (let i = 0; i < r.int(5, 8); i++) {
    const x = cx + r.float(-6, 6), z = cz + r.float(-3, 3), len = r.float(8, i === 0 ? 24 : 16);
    const ang = r.float(-0.6, 0.6), tilt = r.float(-0.3, 0.3), w = r.float(1.1, 2.2);
    const ex = x + Math.sin(ang) * len, ey = 3 + Math.cos(ang) * len, ez = z + tilt * len;
    for (let k = 0; k <= len * 2; k++) {
      const t = k / (len * 2), rad = w * (t < 0.75 ? 1 : (1 - t) * 4);
      const px = x + (ex - x) * t, py = 3 + (ey - 3) * t, pz = z + (ez - z) * t;
      for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
        if (Math.abs(dx) + Math.abs(dz) > rad * 1.4) continue; // faceted (diamond) cross section
        const X = Math.round(px + dx), Z = Math.round(pz + dz), Y = Math.round(py);
        m.set(X, Y, Z, t > 0.82 || (dx === 0 && dz === 0 && t > 0.3) ? c : dx < 0 || dz > 0 ? b : a);
      }
    }
  }
}

function seaPen(m, r, cols, glow) {
  const cx = m.nx / 2, cz = m.nz / 2;
  rockBase(m, r, cx, cz, 5, 2, 4, cols);
  const stalk = C(m, '#e8d8b0'), vane = C(m, shade(glow, -0.25), { emissive: 0.45 }), lit = C(m, glow, { emissive: 0.95 });
  const H = r.int(22, 30), lean = r.float(-0.25, 0.25);
  for (let y = 2; y < H; y++) {
    const x = cx + lean * (y - 2) + Math.sin(y * 0.2) * 0.8;
    m.set(Math.round(x), y, Math.round(cz), stalk);
    if (y > 8) {
      const u = (y - 8) / (H - 8), wv = Math.sin(u * Math.PI) * 5;
      for (const s of [-1, 1]) for (let k = 1; k <= wv; k++) m.set(Math.round(x + s * k), y + Math.floor(k * 0.4), Math.round(cz), k >= wv - 1 || (y % 3 === 0) ? lit : vane);
    }
  }
}

function vent(m, r, cols, glow) {
  const cx = m.nx / 2, cz = m.nz / 2;
  const rock = cols.rock.map((c) => C(m, shade(c, -0.2), { jitter: 0.18 }));
  const min = C(m, '#c8a868'), crack = C(m, '#ff7a2a', { emissive: 0.9 }), hot = C(m, '#ffd86a', { emissive: 1 });
  rockBase(m, r, cx, cz, 12, 5, 8, cols);
  const H = r.int(30, 42), seed = r.int(0, 999);
  for (let y = 2; y < H; y++) {
    const u = y / H, rad = 5.5 - u * 3 + Math.sin(y * 0.5) * 0.6 + (y % 7 === 0 ? 1.2 : 0);
    const ox = cx + Math.sin(y * 0.11 + seed) * 1.5;
    for (let dz = -6; dz <= 6; dz++) for (let dx = -7; dx <= 7; dx++) {
      const d = Math.hypot(dx, dz * 1.2);
      if (d > rad + (noise3(dx * 0.4, y * 0.3, dz * 0.4, seed) - 0.5) * 1.6) continue;
      const X = Math.round(ox + dx), Z = Math.round(cz + dz);
      const n = noise3(X * 0.5, y * 0.35, Z * 0.5, seed + 7);
      let v = rock[(y + (n * 4 | 0)) % rock.length];
      if (n > 0.72 && d > rad - 1.5) v = crack;
      else if (y % 7 === 0 && d > rad - 1) v = min;
      if (y >= H - 2 && d < rad - 0.5) v = hot;
      m.set(X, y, Z, v);
    }
  }
  void glow;
}

function tubeWorms(m, r, cols) {
  const cx = m.nx / 2, cz = m.nz / 2;
  rockBase(m, r, cx, cz, 11, 4, 7, cols);
  const tube = C(m, '#e8e2d4'), tubeD = C(m, '#a89a88'), plume = C(m, '#e8283a', { spec: 0.3 }), plumeL = C(m, '#ff6a6a', { emissive: 0.25 });
  for (let i = 0; i < r.int(10, 16); i++) {
    const x = cx + r.float(-9, 9), z = cz + r.float(-5, 5), h = r.int(8, 24), lean = r.float(-0.25, 0.25);
    let y0 = 0; for (let yy = m.ny - 1; yy >= 0; yy--) if (m.get(Math.round(x), yy, Math.round(z))) { y0 = yy + 1; break; }
    for (let y = 0; y < h; y++) m.cylinder(x + lean * y + 0.5, z + 0.5, y0 + y, y0 + y, 1.1, y % 3 === 0 ? tubeD : tube);
    const tx = x + lean * h, ty = y0 + h;
    m.sphere(tx + 0.5, ty + 1.5, z + 0.5, 2.2, (X, Y) => (Y > ty + 1 ? plumeL : plume));
  }
}

function bones(m, r, cols) {
  const cx = m.nx / 2, cz = m.nz / 2;
  rockBase(m, r, cx, cz, 13, 3, 8, cols);
  const bone = C(m, '#e4dcc4'), boneD = C(m, '#a89a80'), crack = C(m, '#6a5e4e');
  // ribs: arcs rising from a spine
  const n = r.int(4, 6);
  for (let i = 0; i < n; i++) {
    const x = cx - 9 + i * (18 / (n - 1)), h = 14 - Math.abs(i - n / 2) * 2;
    let px = x, py = 3;
    for (let k = 1; k <= 12; k++) {
      const t = k / 12, nx2 = x + Math.sin(t * 2.6) * 6 * (i % 2 ? 1 : -0.4), ny2 = 3 + Math.sin(t * Math.PI * 0.8) * h;
      m.line(px, py, cz - 3 + (i % 2), nx2, ny2, cz - 3 + t * 6, t > 0.85 ? boneD : bone, 0.7);
      px = nx2; py = ny2;
    }
  }
  m.line(cx - 12, 3, cz - 3, cx + 12, 3, cz - 3, bone, 1.3);
  for (let x = Math.floor(cx - 12); x < cx + 12; x += 3) m.set(x, 4, Math.floor(cz - 3), crack);
  // skull-ish lump
  m.ellipsoid(cx + 12, 5, cz + 2, 4, 3.5, 3.5, (X, Y, Z) => (Y > 6 ? bone : boneD));
  m.sub(() => { m.sphere(cx + 13.5, 6, cz + 5, 1.3); m.sphere(cx + 10.5, 6, cz + 5, 1.3); });
}

const BUILD = { sponge: glassSponge, fan: seaFan, crinoid, cups: cupCorals, brittle: brittleRock, blackcoral: blackCoral, shrooms: glowShrooms, crystal, pen: seaPen, vent, worms: tubeWorms, bones };
const SIZE = { sponge: [30, 42, 24], fan: [36, 40, 12], crinoid: [34, 34, 26], cups: [30, 24, 20], brittle: [32, 22, 20], blackcoral: [40, 44, 28], shrooms: [30, 28, 20], crystal: [36, 34, 22], pen: [22, 38, 14], vent: [34, 48, 24], worms: [32, 34, 22], bones: [40, 24, 24] };

export function dressModel(kind, seed, cols, glow) {
  const r = new RNG(seed);
  const [x, y, z] = SIZE[kind] || [32, 32, 20];
  const m = new VoxelModel(x, y, z);
  (BUILD[kind] || crystal)(m, r, cols, glow === undefined ? r.pick(cols.glows) : glow);
  return m;
}

const cache = new Map();
// Rendered sprite at R hi px per world px (2/3 world px per voxel): {canvas, glow, ox, oy, R}
export function dressSprite(kind, seed, cols, R = 3, key = '') {
  const k = kind + '|' + seed + '|' + R + '|' + key;
  let s = cache.get(k);
  if (s) return s;
  // modelled coarse, then refined 2x (EPX smoothing + grit): twice the size on screen with 8x the voxels
  const m = runSteps(refineSteps(dressModel(kind, seed, cols, cols.noGlow && kind === 'crinoid' ? null : undefined), { grit: 0.12 }));
  const r = renderVoxels(m, { scale: (R * 2) / 3, yaw: WORLD_YAW, pitch: WORLD_PITCH, outline: true, jitter: 0.1, ao: 1.25, edges: 0.75, sideEdges: 0.5, glowRadius: 5, light: { top: 4.7, lit: 3.4, dark: 2, bottom: 1 } });
  s = { canvas: r.canvas, glow: r.glow, ox: r.ox, oy: r.oy, R, w: r.w, h: r.h, lights: [] };
  for (const reg of Object.values(r.regions)) if (reg.n > 4) s.lights.push({ x: reg.cx, y: reg.cy });
  cache.set(k, s);
  if (cache.size > 160) cache.delete(cache.keys().next().value);
  return s;
}
