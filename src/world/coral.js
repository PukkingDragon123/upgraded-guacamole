// Voxel coral reef kit: procedural, organic coral species built voxel by voxel and rendered with the one world
// camera (front-facing, see voxkit.js) at a fine voxel scale, then clustered into natural reef formations.
//
// Species (static): staghorn / acropora (tapered branches, pale growth tips), table coral (tiered plates on a
// stalk), sea fan (lacy curved mesh with veins), brain coral (meandering grooves), tube sponges (hollow rims,
// ribbed walls), bubble coral, pillar coral, sea whips, encrusting rock mounds with coralline algae.
// Species (animated, VoxAnim frames): anemones (swaying tentacles with tip bulbs), soft tree corals (fluffy polyp
// clusters), kelp (stipe, blades and floats), seagrass clumps.
// Every species takes a theme palette: base -> mid -> hi -> tip (hue-shifted gradient, base to tip), plus polyp
// dot textures. Tip voxels form a night overlay (`night`) used for gentle bioluminescence.
//
//   reefFormation(seed, theme, {w, h, d, density}) -> VoxelModel     a rock bommie densely covered in corals
//   coralModel(kind, seed, theme, size) -> VoxelModel                 one coral on its own
//   renderCoral(model, scale) -> {canvas, ox, oy, w, h, night}        (cached by the caller)
//   voxAnim(kind, seed, theme, size, scale, frames) -> {frames, ox, oy, n, P, nights}
//   placeAnim(anim, x, y) -> DepthDecor-compatible animation (frame(t, off), x, y, frames)

import { VoxelModel } from '../gfx/voxel.js';
import { noise3 } from '../gfx/props.js';
import { RNG } from '../core/rng.js';
import { TAU, clamp, hash3 } from '../core/math.js';
import { mix, shade } from '../core/color.js';
import { renderModel, idPaint } from './voxkit.js';

// ------------------------------------------------------------------ themes

export const THEMES = {
  shallows: {
    pals: {
      pink: ['#7a2252', '#c4407e', '#ff74b0', '#ffd0e6'], orange: ['#7a3216', '#cc5e26', '#ff9446', '#ffe0b0'], purple: ['#3e2470', '#6e44b0', '#a07ae6', '#e6d4ff'],
      yellow: ['#6e5214', '#c08e22', '#f2cc46', '#fff6c0'], teal: ['#14525e', '#2694a2', '#56d6d2', '#d4fff6'], red: ['#5e1426', '#a82a36', '#f05652', '#ffc0b0'],
      lime: ['#34561a', '#62962a', '#a4d446', '#eeffc0'], blue: ['#183670', '#2864c0', '#58a4f8', '#d0eaff'], cream: ['#6e6044', '#b09c74', '#e4d2a8', '#fffbf0'],
      magenta: ['#5a1460', '#9a2a9e', '#e05ad8', '#ffd0fa'],
    },
    rock: ['#5e5874', '#7a7290', '#9890a8'], coralline: ['#c86a8e', '#e89ab4'], algae: ['#4a8a4a', '#76b45a'], sand: ['#d8c08a', '#e8d4a4'],
    weights: { staghorn: 4, table: 2, fan: 3, brain: 3, tube: 3, bubble: 1.5, pillar: 1, whip: 1.5 },
    schemes: [['pink', 'orange', 'yellow', 'cream'], ['purple', 'blue', 'teal', 'cream'], ['lime', 'yellow', 'teal', 'orange'], ['red', 'pink', 'magenta', 'cream'], ['blue', 'teal', 'purple', 'lime'], ['orange', 'yellow', 'purple', 'teal']],
    glow: 0.35,
  },
  junkyard: {
    pals: {
      rust: ['#40200e', '#84421e', '#c8783a', '#ffd08a'], copper: ['#2e2010', '#7a4e24', '#cc8a48', '#ffe0b0'], circuit: ['#0a3424', '#16624a', '#34b47a', '#a8ffd4'],
      oxide: ['#143c3c', '#246e66', '#4cb0a2', '#d0fff4'], steel: ['#24282e', '#454b58', '#77818f', '#e4ecf4'], wire: ['#3a1a1a', '#8a2a2a', '#e04a3a', '#ffd0a0'],
    },
    rock: ['#4a4840', '#5e5a4e', '#767060'], coralline: ['#8a5a3a', '#b07a4a'], algae: ['#3e6a3a', '#5e8a44'], sand: ['#6e6a56', '#827c64'],
    weights: { staghorn: 4, table: 3, fan: 2, brain: 2, tube: 4, bubble: 1, pillar: 1.5, whip: 2 },
    schemes: [['rust', 'copper', 'circuit'], ['oxide', 'steel', 'wire'], ['circuit', 'oxide', 'rust'], ['copper', 'wire', 'steel']],
    glow: 0.8, ledTips: true,
  },
  abyss: {
    pals: {
      ghost: ['#24304e', '#4c6894', '#9ac0ea', '#f0ffff'], bamboo: ['#3a3a48', '#8a8a9a', '#d8d8e4', '#ffffff'], violet: ['#241a44', '#4e3a86', '#9a7ad8', '#f0e0ff'],
      cyan: ['#0e2e44', '#1e6488', '#4ac8e8', '#d8ffff'], black: ['#12121a', '#24242e', '#3a3a48', '#9affe8'], rose: ['#341a34', '#6a3a6a', '#c07ac0', '#ffe0ff'],
    },
    rock: ['#262a40', '#323852', '#444c6a'], coralline: ['#3a4a7a', '#5a6aa0'], algae: ['#24485a', '#346a78'], sand: ['#2e3450', '#3a4262'],
    weights: { staghorn: 3, table: 1, fan: 3, brain: 1, tube: 3, bubble: 2, pillar: 2, whip: 4 },
    schemes: [['ghost', 'cyan', 'bamboo'], ['violet', 'rose', 'ghost'], ['black', 'cyan', 'violet'], ['bamboo', 'ghost', 'rose']],
    glow: 1, alwaysGlow: true,
  },
};

// Palette pick: mostly from the formation's colour scheme (harmonious reefs), with the odd accent.
const pickPal = (theme, r, scheme = null) => {
  const keys = scheme && r.chance(0.85) ? scheme : Object.keys(theme.pals);
  return theme.pals[keys[r.int(0, keys.length - 1)]];
};

// Register a 4-step gradient (+ polyp dot shade + tip) palette; returns {c: [base, mid, hi, tip], dot}.
function palIdx(m, cols, glowTips) {
  m._pals ||= new Map();
  const key = cols.join(',');
  if (m._pals.has(key)) return m._pals.get(key);
  const c = [
    m.color(cols[0], { jitter: 0.1, aoMul: 1.2, coral: true }),
    m.color(cols[1], { jitter: 0.12, coral: true }),
    m.color(cols[2], { jitter: 0.1, spec: 0.25, coral: true }),
    m.color(cols[3], { jitter: 0.06, spec: 0.4, emissive: glowTips ? 0.25 : 0, tip: true }),
  ];
  const dot = m.color(mix(cols[2], cols[3], 0.6), { jitter: 0.05 });
  const dark = m.color(shade(cols[0], -0.25), { jitter: 0.05 });
  const P = { c, dot, dark, hex: cols };
  m._pals.set(key, P);
  return P;
}

// Gradient pick with dithered transitions: k 0 base .. 1 tip.
function grad(P, k, x, y, z) {
  const q = clamp(k, 0, 1) * 2.999 + (hash3(x, y, z, 17) - 0.5) * 0.8;
  return P.c[clamp(Math.floor(q), 0, 2)];
}

function ball(m, x, y, z, r, c) {
  if (r < 0.75) { m.set(x, y, z, c); return; }
  m.sphere(x, y, z, r, c);
}

// ------------------------------------------------------------------ static species

function staghorn(m, o, size, P, r) {
  const maxD = size > 9 ? 4 : 3;
  const rec = (x, y, z, dx, dy, dz, len, rad, depth) => {
    const n = Math.max(2, Math.round(len));
    for (let i = 0; i < n; i++) {
      const t = i / n;
      dy += 0.05; dx += (r.next() - 0.5) * 0.08; dz += (r.next() - 0.5) * 0.08;
      const l = Math.hypot(dx, dy, dz); dx /= l; dy /= l; dz /= l;
      const rr = rad * (1 - t * 0.3);
      const k = (maxD - depth + t) / (maxD + 0.6);
      ball(m, x, y, z, rr, grad(P, k, x | 0, y | 0, z | 0));
      x += dx; y += dy; z += dz;
    }
    if (depth <= 0 || rad < 0.55) {
      m.set(x, y, z, P.c[3]); m.set(x - dx, y - dy, z - dz, P.c[3]);
      return;
    }
    const kids = r.int(2, 3);
    for (let k = 0; k < kids; k++) {
      const a = r.float(0.35, 0.75) * (k % 2 ? 1 : -1), b = r.float(-0.6, 0.6);
      let ndx = dx + Math.sin(a) * 0.9, ndy = dy * 0.8 + 0.3, ndz = dz + Math.sin(b) * 0.7;
      const l = Math.hypot(ndx, ndy, ndz);
      rec(x, y, z, ndx / l, ndy / l, ndz / l, len * r.float(0.62, 0.85), rad * 0.74, depth - 1);
    }
  };
  const trunks = size > 8 ? r.int(2, 3) : 1;
  for (let k = 0; k < trunks; k++) {
    const a = (k - (trunks - 1) / 2) * 0.5 + r.float(-0.15, 0.15);
    rec(o[0] + (k - (trunks - 1) / 2) * 2, o[1], o[2] + r.float(-1, 1), Math.sin(a), 1, r.float(-0.3, 0.3), size * 0.55, Math.max(0.8, size * 0.14), maxD);
  }
}

function tableCoral(m, o, size, P, r) {
  const [cx, y0, cz] = o;
  const h0 = Math.round(size * 0.45);
  m.cylinder(cx, cz, y0, y0 + h0, Math.max(1, size * 0.1), P.c[0]);
  const tiers = size > 9 ? 3 : 2;
  for (let t = 0; t < tiers; t++) {
    const R = size * (0.95 - t * 0.24), y = y0 + h0 + t * 3;
    const ox = cx + r.float(-2, 2) * t, oz = cz + r.float(-1.5, 1.5) * t;
    const seed = r.int(0, 999);
    for (let z = Math.floor(oz - R); z <= Math.ceil(oz + R); z++) for (let x = Math.floor(ox - R); x <= Math.ceil(ox + R); x++) {
      const d = Math.hypot(x + 0.5 - ox, (z + 0.5 - oz) * 1.15);
      const edge = R * (0.86 + 0.18 * noise3(x * 0.3, z * 0.3, t, seed));
      if (d > edge) continue;
      const rim = d > edge - 1.2;
      const k = d / edge;
      const ring = Math.floor(d * 0.7 + noise3(x * 0.4, z * 0.4, 1, seed) * 1.5) % 2;
      m.set(x, y, z, rim ? P.c[3] : ring ? P.c[2] : P.c[1]);
      if (k < 0.45) m.set(x, y - 1, z, P.c[0]);
      if (!rim && hash3(x, y, z, 5) < 0.22) m.set(x, y + 1, z, P.dot);
      if (rim && hash3(x, y, z, 6) < 0.5) m.set(x, y + 1, z, P.c[3]);
    }
    m.cylinder(ox, oz, y - 1, y - 1, R * 0.5, P.c[0]);
  }
}

function seaFan(m, o, size, P, r) {
  const [cx, y0, cz] = o;
  const W = size * 1.05, H = size * 1.25, yb = y0 + 2;
  const zAt = (x) => cz + Math.round(Math.sin(((x - cx) / W) * 1.4) * 1.6);
  const inside = (x, y) => { const dx = (x - cx) / W, dy = (y - yb) / H; return y >= yb && dx * dx + dy * dy <= 1; };
  m.line(cx, y0, cz, cx, yb + 1, cz, P.c[0], 0.9);
  // veins radiating and forking
  const vein = (x, y, a, len, d) => {
    for (let i = 0; i < len; i++) {
      x += Math.sin(a); y += Math.cos(a);
      if (!inside(Math.round(x), Math.round(y))) return;
      m.set(Math.round(x), Math.round(y), zAt(Math.round(x)), P.c[d > 1 ? 1 : 0]);
      a += (r.next() - 0.5) * 0.12;
    }
    if (d > 0) { vein(x, y, a - 0.35, len * 0.7, d - 1); vein(x, y, a + 0.35, len * 0.7, d - 1); }
  };
  for (let k = -3; k <= 3; k++) vein(cx, yb, k * 0.38, H * 0.45, 2);
  // lacy mesh between the veins
  const seed = r.int(0, 999);
  for (let y = yb; y <= yb + H; y++) for (let x = Math.floor(cx - W); x <= Math.ceil(cx + W); x++) {
    if (!inside(x, y)) continue;
    const z = zAt(x);
    if (m.get(x, y, z)) continue;
    const u = x + Math.round(noise3(x * 0.2, y * 0.2, 0, seed) * 2), v = y;
    const line = (u % 4 === 0) || ((v + (u >> 1)) % 4 === 0);
    if (!line || hash3(x, y, 3, seed) < 0.06) continue;
    const k = Math.hypot((x - cx) / W, (y - yb) / H);
    m.set(x, y, z, k > 0.9 ? P.c[3] : k > 0.6 ? P.c[2] : P.c[1]);
  }
}

function brainCoral(m, o, size, P, r) {
  const [cx, y0, cz] = o;
  const R = size * 0.75, Hh = size * 0.62, Rz = R * 0.8;
  const seed = r.int(0, 999);
  for (let y = y0; y <= y0 + Hh; y++) for (let z = Math.floor(cz - Rz); z <= Math.ceil(cz + Rz); z++) for (let x = Math.floor(cx - R); x <= Math.ceil(cx + R); x++) {
    const dx = (x + 0.5 - cx) / R, dy = (y + 0.5 - y0) / Hh, dz = (z + 0.5 - cz) / Rz;
    const q = dx * dx + dy * dy + dz * dz;
    if (q > 1) continue;
    // meandering grooves: contour bands of warped noise near the surface
    if (q > 0.62) {
      const n = noise3(x * 0.2, y * 0.2, z * 0.2, seed) * 7 + noise3(x * 0.45, y * 0.45, z * 0.45, seed + 3) * 1.4;
      const f = n - Math.floor(n);
      if (f < 0.3 && q > 0.72) continue;
      m.set(x, y, z, f < 0.3 ? P.dark : f > 0.66 ? P.c[3] : f > 0.48 ? P.c[2] : P.c[1]);
    } else m.set(x, y, z, P.dark);
  }
  m.cylinder(cx, cz, y0, y0, R * 0.9, P.c[0]);
}

function tubeSponge(m, o, size, P, r) {
  const [cx, y0, cz] = o;
  const n = size > 8 ? r.int(4, 6) : r.int(2, 4);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + r.float(-0.4, 0.4), dist = i === 0 ? 0 : size * r.float(0.2, 0.42);
    const bx = cx + Math.cos(a) * dist, bz = cz + Math.sin(a) * dist * 0.7;
    const h = size * r.float(0.7, 1.35) * (i === 0 ? 1.15 : 1), rr = Math.max(1.4, size * r.float(0.14, 0.22));
    const lean = r.float(-0.12, 0.12), leanz = r.float(-0.08, 0.08);
    for (let y = 0; y <= h; y++) {
      const px = bx + lean * y, pz = bz + leanz * y;
      const rad = rr * (1 + Math.max(0, (y - h * 0.7) / h) * 0.5);
      for (let z = Math.floor(pz - rad - 1); z <= Math.ceil(pz + rad + 1); z++) for (let x = Math.floor(px - rad - 1); x <= Math.ceil(px + rad + 1); x++) {
        const d = Math.hypot(x + 0.5 - px, z + 0.5 - pz);
        if (d > rad) continue;
        const wall = d > rad - 1.15;
        const yy = y0 + y;
        if (!wall && y > h - 4) { if (y === Math.floor(h - 4)) m.set(x, yy, z, P.dark); continue; }
        if (!wall) { m.set(x, yy, z, P.c[0]); continue; }
        const rib = Math.floor((Math.atan2(z + 0.5 - pz, x + 0.5 - px) + Math.PI) * 2.2) % 2;
        m.set(x, yy, z, y >= h - 1 ? P.c[3] : y > h * 0.75 ? P.c[2] : rib ? P.c[1] : grad(P, (y / h) * 0.7, x, yy, z));
      }
    }
  }
}

function bubbleCoral(m, o, size, P, r) {
  const [cx, y0, cz] = o;
  const n = Math.round(size * 3.2);
  const gloss = m.color(mix(P.hex[3], '#ffffff', 0.45), { jitter: 0.03, spec: 0.9, smooth: 0.6, tip: true });
  for (let i = 0; i < n; i++) {
    const a = r.float(0, TAU), d = r.float(0, size * 0.55);
    const x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d * 0.7;
    const y = y0 + (size * 0.5 - d) * 0.6 + r.float(0, 2);
    const rr = r.float(1, 1.9);
    m.sphere(x, y, z, rr, r.chance(0.4) ? gloss : r.chance(0.5) ? P.c[3] : P.c[2]);
  }
  m.ellipsoid(cx, y0, cz, size * 0.55, size * 0.3, size * 0.4, P.c[0]);
}

function pillarCoral(m, o, size, P, r) {
  const [cx, y0, cz] = o;
  const n = r.int(3, 6);
  for (let i = 0; i < n; i++) {
    const bx = cx + r.float(-size * 0.35, size * 0.35), bz = cz + r.float(-size * 0.22, size * 0.22), h = size * r.float(0.6, 1.6), rr = r.float(1.6, 2.6);
    for (let y = 0; y < h; y++) {
      const k = y / h;
      m.cylinder(bx, bz, y0 + y, y0 + y, rr * (1 - k * 0.15), (x, yy, z) => (hash3(x, yy, z, 9) < 0.35 ? P.dot : grad(P, k, x, yy, z)));
    }
    m.sphere(bx, y0 + h, bz, rr * 0.9, P.c[3]);
  }
}

function seaWhip(m, o, size, P, r) {
  const [cx, y0, cz] = o;
  const n = r.int(3, 6);
  for (let i = 0; i < n; i++) {
    let x = cx + r.float(-1, 1), y = y0, z = cz + r.float(-1, 1);
    const a = r.float(-0.35, 0.35), b = r.float(-0.25, 0.25), L = size * r.float(1.1, 1.8);
    for (let k = 0; k < L; k++) {
      const t = k / L;
      x += Math.sin(a + t * a); y += 1; z += Math.sin(b) * 0.6;
      m.set(Math.round(x), Math.round(y), Math.round(z), t > 0.9 ? P.c[3] : grad(P, t, x | 0, y | 0, z | 0));
    }
  }
}

const SPECIES = { staghorn, table: tableCoral, fan: seaFan, brain: brainCoral, tube: tubeSponge, bubble: bubbleCoral, pillar: pillarCoral, whip: seaWhip };

// Lumpy encrusted rock mound (bommie base).
function rockMound(m, theme, r, cx, cz, w, h, d) {
  const R = theme.rock.map((c) => m.color(c, { jitter: 0.12, rock: true }));
  const CL = theme.coralline.map((c) => m.color(c, { jitter: 0.12 }));
  const AL = theme.algae.map((c) => m.color(c, { jitter: 0.15 }));
  const seed = r.int(0, 999);
  const lumps = r.int(4, 7);
  for (let i = 0; i < lumps; i++) {
    const lx = cx + r.float(-w * 0.3, w * 0.3), lz = cz + r.float(-d * 0.18, d * 0.18);
    const rx = Math.min(w * r.float(0.2, 0.34), lx - 3, m.nx - 4 - lx), ry = h * r.float(0.55, 1), rz = Math.min(d * r.float(0.24, 0.36), lz - 2, m.nz - 3 - lz);
    if (rx < 4 || rz < 3) continue;
    for (let y = 0; y <= ry; y++) for (let z = Math.floor(lz - rz); z <= Math.ceil(lz + rz); z++) for (let x = Math.floor(lx - rx); x <= Math.ceil(lx + rx); x++) {
      const dx = (x + 0.5 - lx) / rx, dy = (y + 0.5) / ry, dz = (z + 0.5 - lz) / rz;
      const n = noise3(x * 0.18, y * 0.18, z * 0.18, seed) * 0.5;
      if (dx * dx + dy * dy + dz * dz > 0.85 + n) continue;
      m.set(x, y, z, R[Math.floor(clamp(y / ry + (hash3(x, y, z, 2) - 0.5) * 0.4, 0, 0.999) * R.length)]);
    }
  }
  // encrusting coralline algae and turf in patches on exposed tops
  for (let z = 0; z < m.nz; z++) for (let x = 0; x < m.nx; x++) for (let y = m.ny - 2; y >= 0; y--) {
    const v = m.get(x, y, z);
    if (!v) continue;
    if (!m.get(x, y + 1, z)) {
      const n = noise3(x * 0.12, y * 0.12, z * 0.12, seed + 5);
      if (n > 0.62) m.set(x, y, z, CL[n > 0.72 ? 1 : 0]);
      else if (n < 0.3) m.set(x, y, z, AL[n < 0.2 ? 1 : 0]);
    }
    break;
  }
}

function surfaceY(m, x, z) {
  for (let y = m.ny - 1; y >= 0; y--) if (m.get(x, y, z)) return y + 1;
  return 0;
}

// Encrusting life on the rock faces: coral crusts, zoanthid dot clusters, button sponges and plate corals
// shelving out of the front faces (tiers), so the rock reads as a living reef rather than bare stone.
function encrust(m, theme, r, scheme, seed) {
  const pals = (scheme || Object.keys(theme.pals)).map((k) => palIdx(m, theme.pals[k], theme.glow > 0.5));
  const { nx, ny, nz } = m;
  const shelves = [];
  for (let z = 1; z < nz - 1; z++) for (let y = 1; y < ny - 1; y++) for (let x = 1; x < nx - 1; x++) {
    const v = m.get(x, y, z);
    if (!v || !m.palette[v].rock) continue;
    const front = !m.get(x, y, z + 1), up = !m.get(x, y + 1, z);
    if (!front && !up) continue;
    const n = noise3(x * 0.08, y * 0.08, z * 0.08, seed + 21);
    const P = pals[Math.floor(noise3(x * 0.03, y * 0.03, z * 0.03, seed + 7) * 0.999 * pals.length * 1.6) % pals.length];
    const h = hash3(x, y, z, seed + 3);
    if (n > 0.56) {
      // crust: one voxel proud of the face, gradient by exposure, polyp dots
      const tx = x, ty = up ? y + 1 : y, tz = up ? z : z + 1;
      m.set(tx, ty, tz, h < 0.12 ? P.c[3] : h < 0.4 ? P.c[2] : P.c[1]);
      if (n > 0.68 && h < 0.3) m.set(tx, ty + 1, tz, P.c[2]);
    } else if (h < 0.006) {
      // zoanthid cluster: a tight posy of bright polyp dots
      for (let k = 0; k < 5; k++) m.set(x + r.int(-1, 1), y + (up ? 1 : r.int(-1, 1)), z + (front ? 1 : 0), k ? P.c[3] : P.c[2]);
    } else if (h < 0.009) {
      ball(m, x, y + (up ? 1 : 0), z + (front ? 1 : 0), r.float(1, 1.8), P.c[r.int(1, 2)]);
    } else if (front && !up && y > 4 && h > 0.9985) shelves.push([x, y, z, P]);
  }
  for (const [x, y, z, P] of shelves) {
    const R = r.float(3, 6.5);
    for (let dz = 0; dz <= R; dz++) for (let dx = -Math.ceil(R); dx <= R; dx++) {
      const d = Math.hypot(dx, dz * 1.3);
      if (d > R) continue;
      m.set(x + dx, y, z + 1 + dz, d > R - 1.2 ? P.c[3] : (dx + dz) % 3 === 0 ? P.c[2] : P.c[1]);
      if (d < R * 0.5) m.set(x + dx, y - 1, z + 1 + dz, P.c[0]);
    }
  }
}

// A whole coral bommie: rock mound covered with species chosen by the theme's weights.
export function reefFormation(seed, theme, { w = 140, h = 84, d = 54, density = 1, rock = 0.42, sizes = [10, 24] } = {}) {
  const r = new RNG(seed);
  const m = new VoxelModel(w, h, d);
  const cx = w / 2, cz = d / 2;
  const scheme = theme.schemes ? theme.schemes[r.int(0, theme.schemes.length - 1)] : null;
  rockMound(m, theme, r, cx, cz, w * 0.82, h * rock, d * 0.7);
  encrust(m, theme, r, scheme, seed);
  const kinds = Object.entries(theme.weights);
  const total = kinds.reduce((a, [, wt]) => a + wt, 0);
  const pick = () => { let q = r.next() * total; for (const [k, wt] of kinds) { q -= wt; if (q <= 0) return k; } return kinds[0][0]; };
  const n = Math.round((w * d) / 260 * density * (10 / sizes[0]) ** 2 * 1.1);
  const used = [];
  for (let i = 0; i < n * 5 && used.length < n; i++) {
    const x = Math.round(r.float(w * 0.08, w * 0.92)), z = Math.round(r.float(d * 0.18, d * 0.85));
    if (!m.get(x, 1, z) && surfaceY(m, x, z) < 3 && r.chance(0.6)) continue;
    const kind = pick();
    const size = r.float(sizes[0], kind === 'fan' || kind === 'staghorn' || kind === 'table' ? sizes[1] : sizes[1] * 0.8) * (0.7 + 0.3 * (1 - Math.abs(x - cx) / cx));
    if (used.some((u) => Math.hypot(u[0] - x, (u[1] - z) * 1.4) < (u[2] + size) * 0.38)) continue;
    const y = surfaceY(m, x, z);
    if (y + size * 1.4 >= h - 2) continue;
    used.push([x, z, size]);
    const P = palIdx(m, pickPal(theme, r, scheme), theme.glow > 0.5);
    SPECIES[kind](m, [x, y, kind === 'fan' ? Math.max(3, Math.round(z * 0.6)) : z], size, P, r);
  }
  polyps(m, seed);
  return m;
}

// One species standing on the seabed (no plinth: it sits straight on the terrain).
export function coralModel(kind, seed, theme, size = 10) {
  const r = new RNG(seed);
  const s = Math.ceil(size * 2.6) + 6;
  const m = new VoxelModel(s, Math.ceil(size * 2.2) + 8, Math.ceil(size * 1.8) + 6);
  const P = palIdx(m, pickPal(theme, r), theme.glow > 0.5);
  SPECIES[kind](m, [m.nx / 2, 0, m.nz / 2], size, P, r);
  polyps(m, seed);
  return m;
}

// Sprinkle lighter polyp dots on exposed coral voxels (not on rock or sand).
function polyps(m, seed) {
  const lighter = new Map();
  for (let z = 1; z < m.nz - 1; z++) for (let y = 1; y < m.ny - 1; y++) for (let x = 1; x < m.nx - 1; x++) {
    const v = m.get(x, y, z);
    if (!v || hash3(x, y, z, seed + 11) > 0.1 || !m.exposed(x, y, z)) continue;
    const pe = m.palette[v];
    if (!pe || !pe.coral) continue;
    let l = lighter.get(v);
    if (l === undefined) { l = m.palette.length < 250 ? m.color(shade(pe.color, 0.3), { jitter: 0.04 }) : v; lighter.set(v, l); }
    m.set(x, y, z, l);
  }
}

// Render with the world camera; returns the sprite + night (bioluminescent tips) overlay.
export function renderCoral(m, scale, theme) {
  const r = renderModel(m, { scale, outline: true, jitter: 0.06, ao: 1.3, edges: 0.7, sideEdges: 0.4, light: { top: 4.8, lit: 3.4, dark: 2.1, bottom: 1 } });
  let night = null;
  if (theme?.glow) {
    const map = new Map();
    m.palette.forEach((pe, i) => { if (pe && pe.tip) map.set(i, shade(pe.color, 0.25)); });
    night = map.size ? idPaint(r, map) : null;
  }
  return { canvas: r.canvas, ox: r.ox, oy: r.oy, w: r.w, h: r.h, night, glow: r.glow };
}

// ------------------------------------------------------------------ animated species

function anemone(m, o, size, P, r, ph) {
  const [cx, y0, cz] = o;
  const R = size * 0.32;
  m.cylinder(cx, cz, y0, y0 + size * 0.28, R, (x, y, z) => (hash3(x, y, z, 3) < 0.25 ? P.dot : P.c[0]));
  m.cylinder(cx, cz, y0 + size * 0.28 + 1, y0 + size * 0.28 + 1, R + 0.6, P.c[1]);
  const top = y0 + size * 0.28 + 1;
  const n = Math.round(14 + size * 2.2);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + r.float(-0.1, 0.1);
    const ring = i % 2 ? R * 0.55 : R + 0.4;
    let x = cx + Math.cos(a) * ring, y = top, z = cz + Math.sin(a) * ring * 0.8;
    const L = size * r.float(0.45, 0.7);
    let dx = Math.cos(a) * 0.55, dy = 0.85, dz = Math.sin(a) * 0.45;
    for (let k = 0; k < L; k++) {
      const t = k / L;
      const sw = Math.sin(ph + i * 0.37 + t * 2.2) * 0.38 * t;
      dx += sw * 0.3; dz += Math.cos(ph * 0.7 + i) * 0.04;
      const l = Math.hypot(dx, dy, dz); dx /= l; dy /= l; dz /= l;
      x += dx; y += dy * 0.9; z += dz;
      m.set(Math.round(x), Math.round(y), Math.round(z), t > 0.82 ? P.c[3] : t > 0.45 ? P.c[2] : P.c[1]);
    }
    m.set(Math.round(x), Math.round(y) + 1, Math.round(z), P.c[3]);
  }
}

function softCoral(m, o, size, P, r, ph) {
  const [cx, y0, cz] = o;
  const trunk = m.color(mix(P.hex[3], '#ffffff', 0.4), { jitter: 0.05 });
  const rec = (x, y, z, a, b, len, depth) => {
    for (let i = 0; i < len; i++) {
      const sw = Math.sin(ph + depth * 0.9 + i * 0.2) * 0.06 * (4 - depth);
      x += Math.sin(a + sw); y += Math.cos(a + sw) * 0.9; z += Math.sin(b) * 0.4;
      m.set(Math.round(x), Math.round(y), Math.round(z), trunk);
    }
    if (depth === 0) {
      for (let k = 0; k < 5; k++) m.sphere(x + r.float(-1.5, 1.5), y + r.float(-0.5, 1.5), z + r.float(-1, 1), r.float(0.9, 1.5), r.chance(0.4) ? P.c[3] : r.chance(0.5) ? P.c[2] : P.c[1]);
      return;
    }
    for (let k = 0; k < 2 + (depth > 1 ? 1 : 0); k++) rec(x, y, z, a + (k - 1) * 0.7 + r.float(-0.3, 0.3), b + r.float(-0.6, 0.6), len * 0.72, depth - 1);
  };
  m.cylinder(cx, cz, y0, y0 + 3, size * 0.16, trunk);
  for (const a of [-0.45, 0.1, 0.55]) rec(cx, y0 + 3, cz, a, r.float(-0.4, 0.4), size * 0.28, 3);
}

// Giant kelp: holdfast, a swaying stipe and slender blades angled up from gas floats on alternating sides.
function kelp(m, o, size, P, r, ph) {
  const [cx, y0, cz] = o;
  const H = Math.round(size * 5);
  const flt = m.color(mix(P.hex[3], '#ffe8a0', 0.3), { jitter: 0.04, spec: 0.6 });
  for (let k = 0; k < 7; k++) m.set(cx + r.int(-2, 2), y0, cz + r.int(-1, 1), P.c[0]);
  const xs = [];
  for (let y = 0; y < H; y++) {
    const t = y / H;
    xs[y] = cx + Math.sin(ph + y * 0.06) * t * t * size * 0.55 + Math.sin(y * 0.13 + size) * 0.7;
    m.set(Math.round(xs[y]), y0 + y, cz, P.c[0]);
  }
  let side = r.chance(0.5) ? 1 : -1;
  for (let y = 4; y < H - 1; y += r.int(3, 4)) {
    side = -side;
    const t = y / H;
    const x0 = Math.round(xs[y]);
    m.set(x0 + side, y0 + y, cz, flt);
    const L = Math.round(size * r.float(0.55, 0.8) * (1 - t * 0.3));
    const up = r.float(0.55, 0.9), sw = Math.sin(ph * 1.3 + y * 0.21);
    let bx = x0 + side * 1.5, by = y0 + y + 0.5;
    for (let k = 0; k < L; k++) {
      const kk = k / L;
      bx += side * (1 - up * 0.6) + sw * kk * 0.35;
      by += up * (1 - kk * 0.5);
      const c = kk > 0.75 ? P.c[3] : kk > 0.35 ? P.c[2] : P.c[1];
      m.set(Math.round(bx), Math.round(by), cz, c);
      if (kk > 0.15 && kk < 0.8) m.set(Math.round(bx), Math.round(by) + 1, cz + 1, P.c[1]);
    }
  }
}

// Seagrass clump: thin ribbon blades fanning out of the sand, each with its own sway phase.
function seagrass(m, o, size, P, r, ph) {
  const [cx, y0, cz] = o;
  const n = r.int(9, 14);
  for (let i = 0; i < n; i++) {
    let x = cx + r.float(-size * 0.35, size * 0.35);
    const z = cz + r.int(-2, 2);
    const L = size * r.float(1, 2), lean = (x - cx) / (size * 0.35) * 0.35 + r.float(-0.15, 0.15), off = r.float(0, TAU);
    for (let k = 0; k < L; k++) {
      const t = k / L;
      x += Math.sin(lean * (0.4 + t) + Math.sin(ph + off + t * 1.8) * 0.5 * t);
      m.set(Math.round(x), y0 + k, z, t > 0.88 ? P.c[3] : t > 0.55 ? P.c[2] : t > 0.2 ? P.c[1] : P.c[0]);
    }
  }
}

const ANIMATED = { anemone, soft: softCoral, kelp, seagrass };

const animCache = new Map();
// Animated coral sprite set (frames over one sway cycle), cached per (kind, seed, theme, size, scale).
// `k` scales the voxel count (perspective size); frames render at 1 px per voxel.
export function voxAnim(kind, seed, themeId, size0, k, frames = 8, palKey = null) {
  const key = [kind, seed, themeId, size0, k, frames, palKey].join('|');
  const size = size0 * k;
  let A = animCache.get(key);
  if (A) return A;
  const theme = THEMES[themeId] || THEMES.shallows;
  const r0 = new RNG(seed);
  const FIXED = { kelp: { shallows: ['#2e3010', '#5e5e1c', '#9a922c', '#dcca5a'], junkyard: ['#2a2a1a', '#4a4a2a', '#7a7a3a', '#b8b060'], abyss: ['#1a2a3a', '#2a4a5a', '#4a8a9a', '#a8f0ff'] },
    seagrass: { shallows: ['#1e4a24', '#2e7a36', '#5ab04e', '#b8e88a'], junkyard: ['#2a3a1e', '#3e5a2a', '#6a8a3a', '#b0c870'], abyss: ['#1a2e44', '#2a4e6a', '#4a8aaa', '#bfffff'] } };
  const cols = palKey && theme.pals[palKey] ? theme.pals[palKey] : FIXED[kind]?.[themeId] || pickPal(theme, r0);
  const h = Math.ceil(kind === 'kelp' ? size * 6 + 10 : size * 2.2 + 8), wd = Math.ceil(size * 2.4 + 12);
  const out = [], nights = [];
  let ox = 0, oy = 0;
  for (let f = 0; f < frames; f++) {
    const m = new VoxelModel(wd + (kind === 'kelp' ? size * 3 : 0), h, Math.ceil(size * 1.6) + 6);
    const P = palIdx(m, cols, theme.glow > 0.5);
    ANIMATED[kind](m, [m.nx / 2, 0, m.nz / 2], size, P, new RNG(seed), (f / frames) * TAU);
    const r = renderModel(m, { scale: 1, outline: kind !== 'seagrass', jitter: 0.06, ao: 1.2, edges: 0.6, light: { top: 4.8, lit: 3.4, dark: 2.1, bottom: 1 } });
    // anchor every frame on the model's base centre so frames line up
    const p = r.project(m.nx / 2, 0, m.nz / 2);
    ox = Math.round(p[0]); oy = Math.round(p[1]);
    out.push({ canvas: r.canvas, ox, oy });
    const map = new Map([[P.c[3], shade(cols[3], 0.2)]]);
    nights.push(theme.glow ? idPaint(r, map) : null);
  }
  // normalise to a shared frame box
  const minX = Math.min(...out.map((q) => -q.ox)), minY = Math.min(...out.map((q) => -q.oy));
  const maxX = Math.max(...out.map((q) => q.canvas.width - q.ox)), maxY = Math.max(...out.map((q) => q.canvas.height - q.oy));
  const W = maxX - minX, Hh = maxY - minY;
  const box = (src, q) => {
    if (!src) return null;
    const c = document.createElement('canvas');
    c.width = W; c.height = Hh;
    c.getContext('2d').drawImage(src, -minX - q.ox, -minY - q.oy);
    return c;
  };
  A = { frames: out.map((q) => box(q.canvas, q)), nights: out.map((q, i) => box(nights[i], q)), ox: -minX, oy: -minY, n: frames, P: 2.4 + (seed % 7) * 0.15 };
  animCache.set(key, A);
  return A;
}

// Bind an animation to a world position (DepthDecor-compatible: anim.x/y top-left, frame(t, off), frames).
export function placeAnim(A, x, y) {
  return {
    frames: A.frames, nights: A.nights, n: A.n, P: A.P, x: Math.round(x - A.ox), y: Math.round(y - A.oy),
    frame(t, off = 0) { const i = Math.floor((t / A.P) * A.n + off); return A.frames[((i % A.n) + A.n) % A.n]; },
    night(t, off = 0) { const i = Math.floor((t / A.P) * A.n + off); return A.nights[((i % A.n) + A.n) % A.n]; },
  };
}

// ------------------------------------------------------------------ cached sprites for the biomes

// `k` is the perspective size factor: models gain or lose voxels and always render at 1 px per voxel, so
// near corals carry the most detail and nothing is resampled at fractional scales.
const spriteCache = new Map();
export function reefSprite(seed, themeId, opts, k = 1) {
  const key = 'reef|' + seed + '|' + themeId + '|' + JSON.stringify(opts) + '|' + k;
  let s = spriteCache.get(key);
  if (!s) {
    const theme = THEMES[themeId];
    const o = { ...opts, w: Math.round((opts.w ?? 140) * k), h: Math.round((opts.h ?? 84) * k), d: Math.round((opts.d ?? 54) * k), sizes: (opts.sizes ?? [10, 24]).map((v) => v * k) };
    s = renderCoral(reefFormation(seed, theme, o), 1, theme);
    spriteCache.set(key, s);
  }
  return s;
}

export function coralSprite(kind, seed, themeId, size, k = 1) {
  const key = kind + '|' + seed + '|' + themeId + '|' + size + '|' + k;
  let s = spriteCache.get(key);
  if (!s) { const theme = THEMES[themeId]; s = renderCoral(coralModel(kind, seed, theme, size * k), 1, theme); spriteCache.set(key, s); }
  return s;
}

// Night bioluminescence for corals: list of {night, x, y, band, z} (baked sprites) or {anim, off, band, z}
// (animated decor). Drawn additively after the darkness pass with the band's parallax offset.
export function drawCoralGlow(ctx, list, band, dx, dy, alpha, fogOf, t = 0) {
  if (alpha <= 0.02) return;
  const po = ctx.globalCompositeOperation, pa = ctx.globalAlpha;
  ctx.globalCompositeOperation = 'lighter';
  for (const g of list) {
    if (g.band !== band) continue;
    const img = g.anim ? g.anim.night(t, g.off) : g.night;
    if (!img) continue;
    ctx.globalAlpha = alpha * (1 - fogOf(g.z) * 0.8);
    if (g.anim) ctx.drawImage(img, Math.round(g.anim.x + dx), Math.round(g.anim.y + dy));
    else ctx.drawImage(img, Math.round(g.x + dx), Math.round(g.y + dy));
  }
  ctx.globalCompositeOperation = po;
  ctx.globalAlpha = pa;
}

// ------------------------------------------------------------------ critters

// Front-facing voxel crab: frames [idle (claws up), walk A, walk B] as {canvas, ox, oy} (ox/oy = feet centre).
const crabCache = new Map();
export function voxCrab(body = '#e0502e', scale = 1.5) {
  const key = body + scale;
  if (crabCache.has(key)) return crabCache.get(key);
  const frames = [0, 1, 2].map((f) => {
    const m = new VoxelModel(20, 11, 13);
    const C = (c, o = {}) => m.color(c, { jitter: 0.08, ...o });
    const shell = C(body), top = C(mix(body, '#ffd8a8', 0.35), { spec: 0.4 }), under = C(mix(body, '#4a1028', 0.4)), leg = C(mix(body, '#5a1430', 0.3));
    const claw = C(mix(body, '#ffffff', 0.12), { spec: 0.3 }), tipC = C(mix(body, '#2a0a10', 0.55)), eye = C('#120c14', { spec: 0.9 }), dot = C(mix(body, '#fff0d8', 0.6));
    const cx = 10, cz = 6;
    // legs (three a side) splay out and down; walking frames alternate the feet
    for (let i = 0; i < 3; i++) for (const side of [-1, 1]) {
      const o = f === 0 ? 0 : ((i + (side > 0 ? 1 : 0)) % 2 ? 1 : -1) * (f === 1 ? 1 : -1);
      const kx = cx + side * 4, kz = cz - 2 + i * 2;
      m.line(kx, 3, kz, cx + side * 7, 4, kz + o * 0.5, leg, 0.6);
      m.line(cx + side * 7, 4, kz + o * 0.5, cx + side * (8 + (o > 0 ? 1 : 0)), 0, kz + o, leg, 0.6);
    }
    m.ellipsoid(cx, 3.6, cz, 4.6, 2.2, 3.4, (x, y, z) => (y >= 5 ? (hash3(x, y, z, 3) < 0.2 ? dot : top) : y <= 2 ? under : shell));
    // claws held forward (raised when idle)
    const cy = f === 0 ? 6 : 5;
    for (const side of [-1, 1]) {
      m.line(cx + side * 3, 3, cz + 3, cx + side * 5, cy - 1, cz + 5, shell, 0.7);
      m.ellipsoid(cx + side * 5.5, cy, cz + 5.5, 1.6, 1.3, 1.3, claw);
      m.set(cx + side * 5, cy + 1, cz + 7, tipC); m.set(cx + side * 6, cy + 1, cz + 7, tipC);
      m.set(cx + side * 5, cy - 1, cz + 7, tipC);
    }
    // eye stalks
    for (const side of [-1, 1]) { m.set(cx + side * 1.5, 6, cz + 3, shell); m.set(cx + side * 1.5, 7, cz + 3, eye); }
    const r = renderModel(m, { scale, outline: true, jitter: 0.08, ao: 1.1, edges: 0.6 });
    const p = r.project(cx, 0, cz + 2);
    return { canvas: r.canvas, ox: Math.round(p[0]), oy: Math.round(p[1]) };
  });
  crabCache.set(key, frames);
  return frames;
}
