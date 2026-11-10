// Hand-crafted, highly detailed voxel bait models (one per bait). Used by src/fishing/baitart.js for the big
// views (shop cards, Bait panel, Satchel), the low-res toy-block icons (downsampled) and the animated bait on the hook.
//
//   BAIT_MODELS[shape] = {dims: [nx, ny, nz], yaw, pitch, anim (wiggles on the hook), build(m, art, ph)}
//     specials: crumbs bread worm sugar chip popup flood lantern golden blackhole relic
//     flavour lines (art.line): notes documents calculator calendar music photos videos paint games fishtop chat
//                               mail fishnet terminal settings moreram notavirus (+ 'grub' fallback)
//   modelFor(art, ph = 0) -> {model: VoxelModel, def}   builds a model for an art spec at animation phase ph (0..1)
// y is up, z points toward the viewer; models stand on y = 0. Colours of flavour creatures come from art.color /
// art.color2 so custom tints recolour the creature itself; art.tier (0..4) adds glitter, glow and gold flecks.

import { VoxelModel } from '../gfx/voxel.js';
import { shade, mix } from '../core/color.js';
import { TAU, hash1 } from '../core/math.js';

const GL = { spec: 0.85, specPow: 9, smooth: 0.75 };          // wet / glossy skin
const SOFT = { smooth: 0.6, jitter: 0.05 };
const METAL = { spec: 1, specPow: 5, smooth: 0.55 };
const h3 = (x, y, z, s = 0) => {
  let h = (x * 374761393 + y * 668265263 + z * 1274126177 + s * 2246822519) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// memoised palette: pal(hex, opts) -> index
function palette(m) {
  const map = new Map();
  return (hex, o = {}) => {
    const k = hex + '|' + JSON.stringify(o);
    let c = map.get(k);
    if (c === undefined) { c = m.color(hex, o); map.set(k, c); }
    return c;
  };
}

// ---------------------------------------------------------------- shape helpers
// Catmull-Rom samples of [x, y, z, r] control points, with arc-length parameter u (0..1) and tangents.
function spline(P, step = 0.3) {
  const at = (i) => P[Math.max(0, Math.min(P.length - 1, i))];
  const raw = [];
  for (let i = 0; i < P.length - 1; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    const seg = Math.hypot(p2[0] - p1[0], p2[1] - p1[1], p2[2] - p1[2]);
    const n = Math.max(2, Math.ceil(seg / step));
    for (let s = 0; s < n; s++) {
      const t = s / n, t2 = t * t, t3 = t2 * t;
      raw.push([0, 1, 2, 3].map((k) => 0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3)));
    }
  }
  raw.push(P[P.length - 1].slice());
  let L = 0;
  const out = raw.map((q, i) => {
    if (i) L += Math.hypot(q[0] - raw[i - 1][0], q[1] - raw[i - 1][1], q[2] - raw[i - 1][2]);
    return { p: q, l: L };
  });
  for (let i = 0; i < out.length; i++) {
    const a = raw[Math.max(0, i - 1)], b = raw[Math.min(raw.length - 1, i + 1)];
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], dl = Math.hypot(...d) || 1;
    out[i].t = d.map((v) => v / dl);
    out[i].u = L ? out[i].l / L : 0;
  }
  out.L = L;
  return out;
}

// A soft-bodied tube: every voxel takes the colour of the NEAREST spine sample (normalised distance), so ring
// grooves and stripes stay crisp. paint(u, n /* unit offset from the spine */, s /* sample */, d /* 0..1 depth */)
function tube(m, P, paint, o = {}) {
  const S = spline(P, o.step || 0.3);
  const best = new Map();
  const ry = o.ry || 1, rz = o.rz || 1;
  for (const s of S) {
    const [cx, cy, cz, r] = s.p;
    const Ry = r * ry, Rz = r * rz;
    for (let z = Math.floor(cz - Rz); z <= Math.ceil(cz + Rz); z++) for (let y = Math.floor(cy - Ry); y <= Math.ceil(cy + Ry); y++) for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      const dx = x + 0.5 - cx, dy = (y + 0.5 - cy) / ry, dz = (z + 0.5 - cz) / rz;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > r * r) continue;
      if (!m.inside(x, y, z)) continue;
      const key = x + 1024 * (y + 1024 * z);
      const d = Math.sqrt(d2) / r;
      const prev = best.get(key);
      if (prev !== undefined && prev <= d) continue;
      best.set(key, d);
      const dl = Math.sqrt(d2) || 1;
      const c = paint(s.u, [dx / dl, dy / dl, dz / dl], s, d);
      if (c) m.set(x, y, z, c);
    }
  }
  return S;
}

// Thin jointed limb through points (1-voxel or capsule lines).
function limb(m, pts, c, r = 0) {
  for (let i = 1; i < pts.length; i++) m.line(pts[i - 1][0], pts[i - 1][1], pts[i - 1][2], pts[i][0], pts[i][1], pts[i][2], c, r);
}

// Glossy cartoon-ish bead eye: dark ball + a white shine voxel (top-left-front).
function eye(m, pal, x, y, z, r = 1.6, col = '#120c1c') {
  const e = pal(col, { spec: 1, specPow: 6, smooth: 1 });
  m.sphere(x, y, z, r, e);
  const w = pal('#ffffff', { emissive: 0.3, spec: 1 });
  m.set(x - r * 0.35, y + r * 0.45, z + r * 0.8, w);
  if (r >= 2.2) m.set(x - r * 0.35 + 1, y + r * 0.45, z + r * 0.8, w);
}

// Recolour a share of the exposed upward / front-facing voxels (glitter, flecks).
function speckle(m, chance, c, seed = 1, test = null) {
  const { nx, ny, nz } = m;
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    if (!m.get(x, y, z) || !m.exposed(x, y, z)) continue;
    if (m.get(x, y + 1, z) && m.get(x, y, z + 1)) continue;
    if (h3(x, y, z, seed) >= chance) continue;
    if (test && !test(x, y, z, m.get(x, y, z))) continue;
    m.set(x, y, z, c);
  }
}

// Tier sparkle: glitter (1+), glowing flecks (3+), gold flecks (4).
function tierFx(m, pal, a) {
  const tier = a.tier | 0;
  if (tier >= 1) speckle(m, 0.012 + tier * 0.008, pal('#ffffff', { spec: 1, specPow: 4, emissive: tier >= 3 ? 0.55 : 0.25 }), 7 + tier);
  if (tier >= 4) speckle(m, 0.02, pal('#ffd84a', { spec: 1, specPow: 4, emissive: 0.7 }), 31);
}

// ---------------------------------------------------------------- SPECIAL BAIT

// Glowing Worm: a fat glossy earthworm in an S-curve: ringed segments, a swollen clitellum saddle, a dark dorsal
// vessel, a paler belly and a wet highlight streak; it glows softly and writhes on the hook.
function worm(m, a, ph, o = {}) {
  const pal = palette(m);
  const base = o.body || '#ff7aa8';
  const glow = o.glow ?? 0.22;
  const C = {
    skin: pal(base, { ...GL, emissive: glow }), groove: pal(shade(base, -0.24), { ...GL, emissive: glow * 0.6 }),
    belly: pal(mix(base, '#ffe0ea', 0.45), { ...GL, emissive: glow }), vessel: pal(shade(base, -0.38), { ...GL }),
    gloss: pal(mix(base, '#ffffff', 0.75), { spec: 1, specPow: 5, emissive: 0.45 }),
    clit: pal(o.clit || mix(base, '#ffb07a', 0.55), { ...GL, emissive: glow }), clitG: pal(shade(o.clit || mix(base, '#ffb07a', 0.55), -0.18), { ...GL }),
    tip: pal(shade(base, -0.12), { ...GL, emissive: glow }),
  };
  const w = Math.sin(ph * TAU), w2 = Math.cos(ph * TAU);
  const N = 9, P = [];
  for (let i = 0; i < N; i++) {
    const u = i / (N - 1);
    const x = 5 + u * 38;
    const y = 10 + Math.sin(u * 6.0 + ph * TAU) * (4.4 + w2 * 0.8);
    const z = 13 + Math.cos(u * 3.4 - ph * TAU * 0.5) * 3 + w * 0.5;
    const r = 3.9 * (0.55 + 0.45 * Math.sin(Math.min(1, u * 1.15 + 0.08) * Math.PI)) + (u > 0.66 && u < 0.8 ? 0.7 : 0);
    P.push([x, y, z, Math.max(1.4, r)]);
  }
  P[N - 1][3] = 2.3; P[0][3] = 1.3;
  const rings = 19;
  tube(m, P, (u, n) => {
    const f = (u * rings) % 1;
    const clit = u > 0.66 && u < 0.8;
    if (clit) return f < 0.14 || f > 0.5 && f < 0.6 ? C.clitG : C.clit;
    if (f < 0.2 && u > 0.04 && u < 0.97) return C.groove;
    if (n[1] > 0.55 && n[2] > 0.25 && f > 0.3 && f < 0.85) return C.gloss;
    if (n[1] > 0.88 && Math.abs(n[2]) < 0.35) return C.vessel;
    if (n[1] < -0.35) return C.belly;
    if (u > 0.95) return C.tip;
    return C.skin;
  });
  // the head end: a tiny darker mouth lobe
  const hp = P[N - 1];
  m.set(hp[0] + 2, hp[1], hp[2] + 0.5, pal(shade(base, -0.5), { ...GL }));
  if (o.after) o.after(m, pal, P);
  if (!o.noTier) tierFx(m, pal, a);
}

// Bread Crumbs: a little heap of torn crumbs: toasted crust on the old outside, porous soft crumb on the torn faces.
function crumbs(m, a) {
  const pal = palette(m);
  const C = {
    crust: pal('#c47a32', { jitter: 0.1, smooth: 0.35 }), toast: pal('#94501e', { jitter: 0.08 }), crustL: pal('#e0a050', { jitter: 0.06 }),
    soft: pal('#f8e4b6', { jitter: 0.05, smooth: 0.3 }), soft2: pal('#efd49c', { jitter: 0.05 }), pore: pal('#c8a46a', { jitter: 0.04 }),
  };
  const chunk = (cx, cy, cz, sx, sy, sz, seed, crustTop = true) => {
    for (let z = Math.floor(cz - sz); z <= cz + sz; z++) for (let y = Math.floor(cy - sy); y <= cy + sy; y++) for (let x = Math.floor(cx - sx); x <= cx + sx; x++) {
      const dx = (x + 0.5 - cx) / sx, dy = (y + 0.5 - cy) / sy, dz = (z + 0.5 - cz) / sz;
      const q = dx ** 4 + dy ** 4 + dz ** 4 + (h3(x, y, z, seed) - 0.5) * 0.5;
      if (q > 1 || y < 0) continue;
      const top = crustTop ? dy > 0.62 : dx < -0.62;
      const side = dz < -0.7 || (dx > 0.7 && !crustTop);
      let c;
      if (top || side) c = h3(x, y, z, seed + 3) < 0.25 ? C.toast : h3(x, y, z, seed + 4) < 0.2 ? C.crustL : C.crust;
      else c = h3(x, y, z, seed + 1) < 0.16 ? C.pore : h3(x, y, z, seed + 2) < 0.3 ? C.soft2 : C.soft;
      m.set(x, y, z, c);
    }
  };
  chunk(17, 7, 14, 8.5, 6.6, 7.5, 1, true);
  chunk(30, 5.2, 18, 6, 5, 5.2, 2, false);
  chunk(27, 13.6, 9, 4.6, 3.6, 4.6, 3, true);
  chunk(8, 3.4, 20, 3.6, 3.2, 3.4, 4, false);
  chunk(36, 3, 9, 3.2, 2.8, 3.2, 5, true);
  // tiny loose crumbs
  for (let i = 0; i < 9; i++) {
    const x = 4 + hash1(i, 11) * 38, z = 4 + hash1(i, 13) * 20;
    const c = i % 3 ? C.soft : C.crust;
    m.set(x, 0, z, c);
    if (i % 2) m.set(x + 1, 0, z, c);
    if (i % 4 === 0) m.set(x, 1, z, c);
  }
}

// Fresh Bread: a baked mini loaf, cut open toward the viewer: domed scored crust with sesame, a pale crumb face with
// air holes, and one slice leaning against it.
function bread(m) {
  const pal = palette(m);
  const C = {
    top: pal('#b8642a', { smooth: 0.5, jitter: 0.06, spec: 0.3 }), side: pal('#d48a3e', { smooth: 0.5, jitter: 0.05 }),
    dark: pal('#8a4618', { jitter: 0.06 }), score: pal('#f2c47a', { smooth: 0.4 }), bottom: pal('#a65a24'),
    crumb: pal('#fbecc6', { jitter: 0.04 }), crumb2: pal('#f2dcaa', { jitter: 0.04 }), hole: pal('#d4b47e'),
    seed: pal('#fff6dc', { spec: 0.6 }),
  };
  const X0 = 4, X1 = 34, Z0 = 4, Z1 = 22;
  const prof = (x, z) => { // loaf height at (x, z): flat sides, domed top
    const u = (x + 0.5 - (X0 + X1) / 2) / ((X1 - X0) / 2), v = (z + 0.5 - (Z0 + Z1) / 2) / ((Z1 - Z0) / 2);
    const e = Math.max(0, 1 - u ** 4) * Math.max(0, 1 - v ** 4);
    return 10 + Math.sqrt(Math.max(0, 1 - u * u * 0.85)) * Math.sqrt(Math.max(0, 1 - v * v * 0.9)) * 10 * Math.min(1, e * 3);
  };
  for (let z = Z0; z <= Z1; z++) for (let x = X0; x <= X1; x++) {
    const u = (x + 0.5 - (X0 + X1) / 2) / ((X1 - X0) / 2), v = (z + 0.5 - (Z0 + Z1) / 2) / ((Z1 - Z0) / 2);
    if (u ** 6 + v ** 6 > 1) continue;
    const H = prof(x, z);
    for (let y = 0; y <= H; y++) {
      const shell = y > H - 1.6 || u ** 6 + v ** 6 > 0.72 || y === 0;
      let c;
      if (!shell) c = h3(x, y, z, 9) < 0.14 ? C.hole : h3(x, y, z, 8) < 0.35 ? C.crumb2 : C.crumb;
      else if (y === 0) c = C.bottom;
      else if (y > H - 1.6) {
        // three diagonal score cuts open into lighter bloom
        const sc = ((x - z * 0.6 + 40) % 9.5);
        c = sc < 1.6 && y > 12 && Math.abs(v) < 0.75 ? C.score : h3(x, y, z, 2) < 0.12 ? C.dark : C.top;
        if (c === C.top && h3(x, 7, z, 5) < 0.05) c = C.seed;
      } else c = y > H - 4 && h3(x, y, z, 3) < 0.3 ? C.top : C.side;
      m.set(x, y, z, c);
    }
  }
  // cut face: the loaf is sliced at z = Z1 - 1 (front), showing crumb with a 1-voxel crust rim
  for (let x = X0; x <= X1; x++) for (let y = 0; y <= 22; y++) {
    const z = Z1;
    if (!m.get(x, y, z)) continue;
    const rim = !m.get(x, y + 1, z) || !m.get(x - 1, y, z) || !m.get(x + 1, y, z) || y === 0;
    m.set(x, y, z, rim ? (y === 0 ? C.bottom : C.side) : h3(x, y, 1, 4) < 0.15 ? C.hole : h3(x, y, 2, 5) < 0.3 ? C.crumb2 : C.crumb);
  }
  // a slice leaning on the cut face
  for (let y = 0; y <= 15; y++) for (let x = 0; x <= 13; x++) {
    const u = (x - 6.5) / 6.5, top = 11 + Math.sqrt(Math.max(0, 1 - u * u)) * 4;
    if (y > top) continue;
    const lean = Math.round(y * 0.28);
    for (let d = 0; d < 2; d++) {
      const z = Z1 + 4 - lean + d, X = X1 - 3 + x;
      const rim = y >= top - 1 || x === 0 || x === 13 || y === 0;
      m.set(X, y, z, rim ? C.top : h3(X, y, z, 6) < 0.14 ? C.hole : C.crumb);
    }
  }
}

// Sugar Cube: a cube of packed crystals: every 3-voxel grain a slightly different icy white, sparkling facets,
// chipped edges and corners, and a few loose crystals.
function sugar(m) {
  const pal = palette(m);
  const T = ['#ffffff', '#f6f9ff', '#eef4fc', '#fbfbfd', '#f2f5fb'];
  const tints = T.map((c) => pal(c, { spec: 0.75, specPow: 8, jitter: 0.03 }));
  const facet = pal('#ffffff', { spec: 1, specPow: 3, emissive: 0.4 });
  const ice = pal('#e4f2ff', { spec: 1, specPow: 4, emissive: 0.25 });
  const S0 = 6, S1 = 29;
  for (let z = S0; z <= S1; z++) for (let y = 0; y <= S1 - S0; y++) for (let x = S0; x <= S1; x++) {
    const gx = Math.floor(x / 3), gy = Math.floor(y / 3), gz = Math.floor(z / 3);
    const onX = x <= S0 + 1 || x >= S1 - 1, onY = y >= S1 - S0 - 1, onZ = z <= S0 + 1 || z >= S1 - 1;
    const edges = onX + onY + onZ + (y <= 1 ? 1 : 0);
    if (edges >= 2 && h3(gx, gy, gz, 3) < 0.45) continue; // chipped edges
    if (edges >= 1 && h3(x, y, z, 7) < 0.08) continue;    // granular surface
    const g = h3(gx, gy, gz, 1);
    m.set(x, y, z, g > 0.95 ? facet : g > 0.9 ? ice : tints[Math.floor(h3(gx, gy, gz, 2) * tints.length)]);
  }
  // loose crystals around the base
  for (const [x, z, s] of [[1, 15, 2], [32, 9, 2], [32, 19, 1], [2, 23, 1]]) {
    m.box(x, 0, z, x + s, s, z + s, (vx, vy, vz) => (h3(vx, vy, vz, 4) < 0.35 ? facet : tints[1]));
  }
}

// Overclocked Chip: a QFP chip on a green PCB with gold traces, gull-wing pins, SMD parts, a status LED and an
// aluminium heatsink whose fins glow hot at the top.
function chip(m) {
  const pal = palette(m);
  const C = {
    pcb: pal('#1d8a4c', { jitter: 0.04 }), pcbD: pal('#14683a'), trace: pal('#e8be52', { spec: 0.9, specPow: 5 }), silk: pal('#f0f6f0'),
    body: pal('#23262f', { spec: 0.7, specPow: 14 }), etch: pal('#4a4f5c'), pin: pal('#ffd25a', METAL), pinD: pal('#c89a2a', METAL),
    sink: pal('#c8d2de', METAL), sinkD: pal('#8a98aa', METAL), hot: pal('#ff8a2a', { emissive: 0.75 }), hot2: pal('#ffd060', { emissive: 0.95 }),
    led: pal('#5affd8', { emissive: 1 }), cap: pal('#c8a070', { jitter: 0.05 }), capE: pal('#c8ccd4', METAL), res: pal('#1a1a22'), pad: pal('#d8dce4', METAL),
  };
  // board
  m.box(1, 0, 1, 40, 1, 40, (x, y, z) => (y === 1 && (x === 1 || x === 40 || z === 1 || z === 40) ? C.pcbD : C.pcb));
  // traces fanning out from the pins
  for (let i = 0; i < 8; i++) {
    const k = 12 + i * 2.4;
    m.line(k, 2, 4, k, 2, 8, C.trace); m.line(k, 2, 33, k + (i - 3.5) * 0.8, 2, 38, C.trace);
    m.line(4, 2, k, 8, 2, k, C.trace); m.line(33, 2, k, 38, 2, k + (i - 3.5) * 0.8, C.trace);
  }
  for (const [x, z] of [[4, 4], [37, 4], [4, 37], [37, 37]]) { m.set(x, 2, z, C.pad); m.set(x + 1, 2, z, C.pad); }
  // gull-wing pins
  for (let k = 12; k <= 29; k += 2) {
    for (const [x0, z0, dx, dz] of [[k, 9, 0, -1], [k, 32, 0, 1], [9, k, -1, 0], [32, k, 1, 0]]) {
      m.set(x0, 4, z0, C.pin); m.set(x0 + dx, 4, z0 + dz, C.pin); m.set(x0 + dx * 2, 3, z0 + dz * 2, C.pinD); m.set(x0 + dx * 3, 2, z0 + dz * 3, C.pin);
    }
  }
  // package + markings
  m.box(10, 2, 10, 31, 5, 31, C.body);
  m.set(12, 6, 29, C.etch); m.set(13, 6, 29, C.etch);
  for (let x = 13; x <= 22; x++) if (h3(x, 1, 1) < 0.7) m.set(x, 5, 28, C.etch);
  // heatsink: base plate + fins, glowing hot along the top
  m.box(12, 6, 12, 29, 7, 29, C.sinkD);
  for (let x = 12; x <= 29; x += 2) for (let y = 8; y <= 15; y++) for (let z = 13; z <= 28; z++) {
    m.set(x, y, z, y >= 15 ? (h3(x, y, z) < 0.5 ? C.hot2 : C.hot) : y >= 14 ? C.hot : z === 13 || z === 28 ? C.sinkD : C.sink);
  }
  // SMD capacitors / resistors, an electrolytic can, the LED
  for (const [x, z] of [[5, 14], [5, 20], [35, 26], [21, 35]]) { m.box(x, 2, z, x + 2, 3, z + 1, C.cap); m.set(x, 3, z, C.capE); m.set(x + 2, 3, z + 1, C.capE); }
  for (const [x, z] of [[6, 26], [34, 12]]) m.box(x, 2, z, x + 1, 2, z + 2, C.res);
  m.cylinder(36, 35, 2, 7, 2.2, (x, y) => (y === 7 ? C.capE : C.sinkD));
  m.box(35, 2, 6, 36, 3, 7, C.led);
  m.set(4, 2, 30, C.silk); m.set(5, 2, 30, C.silk); m.set(4, 2, 31, C.silk);
}

// Pop-up Ad: a chunky retro pop-up window: glossy blue title bar with min / max / close buttons, a gold prize star,
// headline bars, a big green CLAIM button and a white cursor pointing at it.
function popup(m) {
  const pal = palette(m);
  const C = {
    bar: pal('#2a6ee0', { spec: 0.7, specPow: 8, smooth: 0.4 }), barL: pal('#5aa8ff', { spec: 0.8, specPow: 8 }), frame: pal('#c8d4e8'),
    body: pal('#fbfdff', { jitter: 0.02 }), bodyS: pal('#e4ecf8'), red: pal('#ff3a4a', { spec: 0.8, emissive: 0.15 }), x: pal('#ffffff', { emissive: 0.3 }),
    min: pal('#ffc83a', { spec: 0.8 }), max: pal('#4ad86a', { spec: 0.8 }), star: pal('#ffd23a', { spec: 1, specPow: 4, emissive: 0.45 }), starD: pal('#e89a1a', { spec: 0.8 }),
    head: pal('#ff4a6a', { spec: 0.5 }), line: pal('#9aa8c0'), btn: pal('#3ad05a', { spec: 0.9, specPow: 6, smooth: 0.4 }), btnL: pal('#9af0a0', { spec: 1 }), btnD: pal('#1f9a3a'),
    cur: pal('#ffffff', { spec: 0.6 }), curK: pal('#16121e'), fish: pal('#ff9a3a', { spec: 0.8 }),
  };
  // window slab
  m.box(2, 2, 4, 41, 33, 7, (x, y, z) => (x === 2 || x === 41 || y === 2 ? C.frame : y >= 27 ? (y >= 31 ? C.barL : C.bar) : z === 7 ? C.body : C.bodyS));
  // title-bar buttons
  m.box(36, 28, 8, 39, 31, 8, C.red);
  for (let i = 0; i < 4; i++) { m.set(36 + i, 28 + i, 9, C.x); m.set(39 - i, 28 + i, 9, C.x); }
  m.box(31, 28, 8, 34, 31, 8, C.max); m.box(26, 28, 8, 29, 31, 8, C.min);
  m.box(5, 29, 8, 16, 30, 8, C.barL);
  // prize star (raised, two-tone)
  const sx = 11, sy = 17;
  for (let y = -6; y <= 6; y++) for (let x = -6; x <= 6; x++) {
    const ang = Math.atan2(y, x), rr = Math.hypot(x, y);
    const lim = 3.2 + 2.8 * Math.pow(Math.abs(Math.cos(ang * 2.5)), 3);
    if (rr <= lim) { m.set(sx + x, sy + y, 8, rr < lim - 1.2 ? C.star : C.starD); if (rr < 2.2) m.set(sx + x, sy + y, 9, C.star); }
  }
  // a little orange fish on the prize
  m.box(9, 16, 10, 12, 18, 10, C.fish); m.set(13, 17, 10, C.fish); m.set(8, 15, 10, C.fish); m.set(8, 19, 10, C.fish);
  // headline + text bars
  m.box(20, 22, 8, 37, 24, 8, C.head);
  m.box(20, 18, 8, 34, 18, 8, C.line); m.box(20, 15, 8, 31, 15, 8, C.line);
  // CLAIM button
  m.box(19, 5, 8, 37, 11, 10, (x, y, z) => (y === 11 || x === 19 ? C.btnL : y === 5 || x === 37 ? C.btnD : C.btn));
  for (let x = 22; x <= 34; x += 3) m.box(x, 8, 11, x + 1, 8, 11, C.btnL);
  // the cursor arrow hovering in front
  const ax = 31, ay = 9, az = 13;
  for (let r = 0; r <= 8; r++) for (let c = 0; c <= r; c++) {
    if (r > 6 && c > 2) continue;
    const edge = c === 0 || c === r || r === 8 || (r === 6 && c > 2);
    m.set(ax + c, ay - r + 8, az, edge ? C.curK : C.cur);
    m.set(ax + c, ay - r + 8, az + 1, edge ? C.curK : C.cur);
  }
  m.box(ax + 2, ay - 4, az, ax + 3, ay - 1, az + 1, C.curK);
}

// Flood Bait: a glossy water drop with a curling wave inside, a splash crown at its foot and droplets around it.
function flood(m) {
  const pal = palette(m);
  const C = {
    deep: pal('#1670d0', { spec: 1, specPow: 7, smooth: 1 }), mid: pal('#2aa0f0', { spec: 1, specPow: 7, smooth: 1, emissive: 0.08 }),
    lite: pal('#7ae0ff', { spec: 1, specPow: 6, smooth: 1, emissive: 0.15 }), hi: pal('#eafcff', { spec: 1, specPow: 4, emissive: 0.5 }),
    foam: pal('#ffffff', { spec: 0.8, smooth: 0.8, emissive: 0.2 }), wave: pal('#bff4ff', { spec: 1, smooth: 1, emissive: 0.25 }),
  };
  const cx = 18, cz = 15, cy = 14, R = 11;
  for (let y = 2; y <= 40; y++) {
    // round bottom, curving to a pointed tip
    let r;
    if (y <= cy) r = Math.sqrt(Math.max(0, R * R - (y + 0.5 - cy) ** 2));
    else { const t = (y - cy) / (40 - cy); r = R * Math.pow(1 - t, 1.35) * (1 + 0.15 * Math.sin(t * Math.PI)); }
    for (let z = Math.floor(cz - r); z <= cz + r; z++) for (let x = Math.floor(cx - r); x <= cx + r; x++) {
      const dx = x + 0.5 - cx, dz = z + 0.5 - cz, d = Math.hypot(dx, dz);
      if (d > r) continue;
      const nx = dx / (r || 1), nz = dz / (r || 1);
      let c = y < cy - 4 ? C.deep : C.mid;
      if (nx < -0.2 && nz > 0.2 && y > cy - 2 && y < cy + 14) c = C.lite;
      if (nx < -0.35 && nz > 0.45 && y > cy + 2 && y < cy + 11) c = C.hi;
      // a curling wave band across the front
      const wv = cy - 2 + Math.sin((x - cx) * 0.45) * 2.4;
      if (nz > 0.55 && Math.abs(y - wv) < 0.8) c = C.wave;
      m.set(x, y, z, c);
    }
  }
  // splash crown
  for (let i = 0; i < 14; i++) {
    const ang = (i / 14) * TAU, rr = R + 1.5;
    const x = cx + Math.cos(ang) * rr, z = cz + Math.sin(ang) * rr;
    const h = 2 + (i % 3) * 1.4;
    m.line(x, 0, z, x + Math.cos(ang) * 1.6, h, z + Math.sin(ang) * 1.6, i % 2 ? C.foam : C.lite, 0.9);
    if (i % 3 === 0) m.sphere(x + Math.cos(ang) * 2.4, h + 2, z + Math.sin(ang) * 2.4, 0.9, C.foam);
  }
  m.ellipsoid(cx, 0.5, cz, R + 1, 1, R + 1, C.lite);
  // droplets
  for (const [x, y, z, r] of [[33, 22, 16, 2.2], [31, 31, 12, 1.4], [3, 26, 18, 1.8], [5, 9, 26, 1.2]]) {
    m.sphere(x, y, z, r, C.mid); m.set(x - r * 0.4, y + r * 0.4, z + r * 0.6, C.hi);
  }
}

// Lantern Pearl: a glowing iridescent pearl in a brass filigree cage: domed cap with a hanging ring, curved bars,
// a bottom cup and a finial drop.
function lantern(m) {
  const pal = palette(m);
  const C = {
    pearl: pal('#c8fff0', { emissive: 0.85, smooth: 1, spec: 1 }), pearlP: pal('#ffd8f0', { emissive: 0.8, smooth: 1, spec: 1 }),
    pearlB: pal('#a8e8ff', { emissive: 0.8, smooth: 1, spec: 1 }), core: pal('#ffffff', { emissive: 1 }),
    gold: pal('#e8b23a', METAL), goldL: pal('#ffe08a', METAL), goldD: pal('#a8701a', METAL), gem: pal('#4af0c8', { emissive: 0.9, spec: 1 }),
  };
  const cx = 16, cz = 16, py = 19, R = 10;
  m.sphere(cx, py, cz, R, (x, y, z) => {
    const nx = (x + 0.5 - cx) / R, ny = (y + 0.5 - py) / R, nz = (z + 0.5 - cz) / R;
    if (nx < -0.3 && ny > 0.3 && nz > 0.3) return C.core;
    const k = Math.sin(nx * 3.1 + ny * 2.3 + nz * 1.7);
    return k > 0.45 ? C.pearlP : k < -0.45 ? C.pearlB : C.pearl;
  });
  // cage bars (8 meridians curving around the pearl)
  for (let i = 0; i < 8; i++) {
    const ang = (i / 8) * TAU + 0.2;
    const pts = [];
    for (let k = 0; k <= 10; k++) {
      const t = -1 + (k / 10) * 2, el = t * 1.25;
      const rr = (R + 1.2) * Math.cos(el);
      pts.push([cx + Math.cos(ang) * rr, py + (R + 1.2) * Math.sin(el), cz + Math.sin(ang) * rr]);
    }
    limb(m, pts, i % 2 ? C.gold : C.goldD, 0.6);
  }
  // equator band with gems
  for (let i = 0; i < 40; i++) {
    const ang = (i / 40) * TAU, rr = R + 1.6;
    m.set(cx + Math.cos(ang) * rr, py, cz + Math.sin(ang) * rr, i % 10 === 0 ? C.gem : C.goldL);
  }
  // cap + ring, bottom cup + finial
  m.ellipsoid(cx, py + R + 1.5, cz, 5.5, 2.6, 5.5, (x, y) => (y > py + R + 2.5 ? C.goldL : C.gold));
  m.cylinder(cx, cz, py + R + 3, py + R + 4, 1.6, C.goldD);
  for (let i = 0; i < 20; i++) { const ang = (i / 20) * TAU; m.set(cx + Math.cos(ang) * 3, py + R + 7.5 + Math.sin(ang) * 3, cz, C.gold); }
  m.ellipsoid(cx, py - R - 1.2, cz, 4.5, 2, 4.5, C.gold);
  m.sphere(cx, py - R - 4.2, cz, 1.6, C.goldL);
  m.set(cx, py - R - 6.2, cz, C.gem);
}

// Golden Bait: a gilded crankbait lure: scaled gold body (darker back, pale belly), a ruby eye, a clear diving lip,
// split rings and two treble hooks.
function golden(m) {
  const pal = palette(m);
  const C = {
    g: pal('#ffc83a', { ...METAL, emissive: 0.15 }), gD: pal('#d8901a', METAL), gL: pal('#fff0a0', { ...METAL, emissive: 0.3 }),
    back: pal('#c87a1a', METAL), belly: pal('#ffe88a', METAL), eye: pal('#ff2a4a', { spec: 1, specPow: 4, emissive: 0.4 }), eyeW: pal('#ffffff', { emissive: 0.6 }),
    pupil: pal('#1a0a14', { spec: 1 }), lip: pal('#fff4c8', { spec: 1, specPow: 4, emissive: 0.15 }), wire: pal('#d8dee8', METAL), wireD: pal('#8a96a8', METAL),
    gill: pal('#b8601a', METAL),
  };
  const cx = 21, cy = 18, cz = 11;
  m.ellipsoid(cx, cy, cz, 16, 7.5, 6, (x, y, z) => {
    const nx = (x + 0.5 - cx) / 16, ny = (y + 0.5 - cy) / 7.5, nz = (z + 0.5 - cz) / 6;
    if (ny > 0.62) return C.back;
    if (ny < -0.5) return C.belly;
    // embossed scale rows
    const row = Math.floor((y + 40) / 2), col = Math.floor((x + (row % 2) * 1.5) / 3);
    const f = ((x + (row % 2) * 1.5) / 3) % 1;
    if (nx > 0.55) return nz > 0.6 && ny > 0.1 ? C.gL : C.g;
    if (f < 0.25) return C.gD;
    return (row + col) % 5 === 0 ? C.gL : C.g;
  });
  // tail taper + head gill line
  m.ellipsoid(4.5, cy, cz, 3.5, 3.2, 2.6, C.gD);
  for (let y = cy - 4; y <= cy + 4; y++) m.set(28 - Math.abs(y - cy) * 0.3, y, cz + 5.6, C.gill);
  // eye
  m.sphere(31, cy + 1.6, cz + 4.4, 2.4, C.eye);
  m.set(31, cy + 1.6, cz + 6.6, C.pupil); m.set(30, cy + 2.8, cz + 6.4, C.eyeW);
  // diving lip
  for (let i = 0; i < 6; i++) m.box(36 + i * 0.9, cy - 3 - i * 0.9, cz - 4, 37 + i * 0.9, cy - 3 - i * 0.9, cz + 4, C.lip);
  // rings + treble hooks
  const treble = (x, y) => {
    // split ring, then a J hook: shank, round bend, point rising with a barb (a second hook turned toward us)
    for (let i = 0; i < 8; i++) { const ang = (i / 8) * TAU; m.set(x + Math.cos(ang) * 1.3, y + Math.sin(ang) * 1.3, cz, C.wire); }
    for (const [dz, sx, c] of [[0, 1, C.wire], [2.2, -1, C.wireD]]) {
      const pts = [[x, y - 1.5, cz + dz * 0.3], [x, y - 7, cz + dz * 0.6]];
      for (let k = 0; k <= 8; k++) { const ang = Math.PI + (k / 8) * Math.PI; pts.push([x + sx * (2.8 + Math.cos(ang) * 2.8), y - 7 + Math.sin(ang) * 2.8, cz + dz]); }
      pts.push([x + sx * 5.6, y - 3, cz + dz]);
      limb(m, pts, c, 0.5);
      m.set(x + sx * 4.6, y - 4.4, cz + dz, c); m.set(x + sx * 4.6, y - 3.6, cz + dz, c);
    }
  };
  treble(25, cy - 8.4);
  treble(10, cy - 6.6);
  m.line(2, cy, cz, 0, cy, cz, C.wire);
}

// Black Hole Bait: an event horizon wrapped in a blazing accretion disk (hot white inside, orange, then violet),
// spiral streaks, a bright photon ring and the far side of the disk lensed up over the top.
function blackhole(m) {
  const pal = palette(m);
  const C = {
    core: pal('#040208', { spec: 0.4, specPow: 30 }), rim: pal('#ffe8b0', { emissive: 1 }),
    d0: pal('#fffbe0', { emissive: 1 }), d1: pal('#ffd060', { emissive: 0.95 }), d2: pal('#ff8a2a', { emissive: 0.85 }),
    d3: pal('#e04a7a', { emissive: 0.75 }), d4: pal('#8a4ae8', { emissive: 0.65 }), d5: pal('#4a2a9a', { emissive: 0.45 }),
  };
  const cx = 24, cy = 14, cz = 24, R = 7.5;
  const band = (r, ang) => {
    const sw = Math.sin(ang * 3 + r * 0.55);
    const k = (r - R - 1.5) / 13 + sw * 0.06;
    return k < 0.12 ? C.d0 : k < 0.28 ? C.d1 : k < 0.48 ? C.d2 : k < 0.66 ? C.d3 : k < 0.84 ? C.d4 : C.d5;
  };
  // the disk (flat, slightly thicker toward the inside)
  for (let z = 0; z < 48; z++) for (let x = 0; x < 48; x++) {
    const dx = x + 0.5 - cx, dz = z + 0.5 - cz, r = Math.hypot(dx, dz);
    if (r < R + 1.5 || r > 23) continue;
    const ang = Math.atan2(dz, dx);
    const th = r < 12 ? 2 : r < 17 ? 1 : 0;
    if (h3(x, 0, z, 3) < (r - 16) / 14) continue; // ragged outer edge
    for (let y = cy - th; y <= cy + (r < 12 ? 1 : 0); y++) m.set(x, y, z, band(r, ang));
  }
  // the lensed far side: an arc rising over the top of the hole
  for (let i = 0; i <= 120; i++) {
    const ang = Math.PI * (i / 120);
    for (let rr = R + 1; rr <= R + 6.5; rr += 0.5) {
      const x = cx + Math.cos(ang) * rr, y = cy + 0.5 + Math.sin(ang) * rr * 1.05;
      const c = band(R + 1.5 + (rr - R - 1) * 2.2, ang * 2);
      m.set(x, y, cz - 1, c); m.set(x, y, cz - 2, c);
    }
  }
  m.sphere(cx, cy, cz, R, C.core);
  // photon ring hugging the horizon
  for (let i = 0; i < 90; i++) {
    const ang = (i / 90) * TAU;
    m.set(cx + Math.cos(ang) * (R + 0.6), cy + Math.sin(ang) * (R + 0.6), cz + 1, C.rim);
  }
}

// Ancient Relic: a weathered stone tablet with a rounded top, a carved border, a glowing fish-and-wave rune, cracks,
// moss, barnacles and a tarnished gold band, standing on a little rubble.
function relic(m) {
  const pal = palette(m);
  const st = ['#8a8270', '#7a7262', '#968e7a', '#6c6556'].map((c) => pal(c, { jitter: 0.1, smooth: 0.2 }));
  const C = {
    groove: pal('#4e483e'), rune: pal('#5affe0', { emissive: 1 }), runeE: pal('#2ac8b0', { emissive: 0.7 }), crack: pal('#3a342c'),
    moss: pal('#5a9a3a', { jitter: 0.12 }), moss2: pal('#7ac04a', { jitter: 0.1 }), gold: pal('#c8962a', METAL), goldL: pal('#f0c860', METAL),
    barn: pal('#d8d0c0', { jitter: 0.1 }), rub: pal('#6a6252', { jitter: 0.1 }),
  };
  const X0 = 6, X1 = 27, Z0 = 6, Z1 = 12, TOP = 30;
  for (let x = X0; x <= X1; x++) for (let y = 3; y <= TOP + 6; y++) {
    const u = (x + 0.5 - (X0 + X1 + 1) / 2) / ((X1 - X0 + 1) / 2);
    const lim = TOP + Math.sqrt(Math.max(0, 1 - u * u)) * 6;
    if (y > lim) continue;
    if (x === X1 && y > TOP + 1) continue; // chipped corner
    for (let z = Z0; z <= Z1; z++) m.set(x, y, z, st[Math.floor(h3(x >> 1, y >> 1, z, 1) * st.length)]);
  }
  // carved border on the front face
  const F = Z1;
  for (let x = X0 + 2; x <= X1 - 2; x++) for (let y = 5; y <= TOP + 3; y++) {
    const u = (x + 0.5 - (X0 + X1 + 1) / 2) / ((X1 - X0 + 1) / 2 - 2);
    const lim = TOP + Math.sqrt(Math.max(0, 1 - u * u)) * 4;
    const onB = (x === X0 + 2 || x === X1 - 2 || y === 5 || Math.abs(y - lim) < 0.7) && y <= lim + 0.7;
    if (onB && m.get(x, y, F)) m.set(x, y, F, C.groove);
  }
  // rune: a fish over three waves, inset and glowing
  const cxr = (X0 + X1) / 2 + 0.5;
  for (let y = -6; y <= 6; y++) for (let x = -8; x <= 8; x++) {
    const body = (x / 6.5) ** 2 + (y / 3.6) ** 2;
    const fish = body < 1 && x > -6.5;
    const tail = x <= -5 && x >= -8 && Math.abs(y) <= (-5 - x) * 1.3 + 0.6;
    const dot = x === 3 && y === 1;
    if (fish || tail) { m.set(cxr + x, 22 + y, F, 0); m.set(cxr + x, 22 + y, F - 1, dot ? C.groove : C.rune); }
  }
  for (let w = 0; w < 3; w++) for (let x = -7; x <= 7; x++) {
    const y = 12 - w * 2.6 + Math.round(Math.sin(x * 0.9) * 0.8);
    m.set(cxr + x, y, F, C.runeE);
  }
  // cracks
  limb(m, [[X0 + 1, TOP - 2, F], [X0 + 4, TOP - 6, F], [X0 + 3, TOP - 10, F], [X0 + 6, TOP - 14, F]], C.crack);
  limb(m, [[X1, 10, F], [X1 - 3, 12, F], [X1 - 4, 16, F]], C.crack);
  // moss along the top and left edge, barnacles low on the right
  for (let x = X0; x <= X1; x++) for (let y = 3; y <= TOP + 6; y++) for (let z = Z0; z <= Z1; z++) {
    if (!m.get(x, y, z) || m.get(x, y + 1, z)) continue;
    const u = h3(x, y, z, 6);
    if (u < 0.55) m.set(x, y, z, u < 0.25 ? C.moss2 : C.moss);
    if (u < 0.3 && x < X0 + 5) m.set(x, y - 1, z, C.moss);
  }
  for (const [x, y] of [[X1 - 3, 6], [X1 - 1, 8], [X1 - 5, 4]]) { m.sphere(x, y, F + 0.6, 1.1, C.barn); m.set(x, y + 1, F + 1, C.groove); }
  // gold band near the base
  m.box(X0, 6, Z0, X1, 7, Z1 + 0.4, (x, y, z) => (z >= Z1 || z === Z0 || x === X0 || x === X1 ? (h3(x, y, z) < 0.3 ? C.goldL : C.gold) : null));
  // rubble
  m.box(X0 - 3, 0, Z0 - 2, X1 + 3, 2, Z1 + 3, (x, y, z) => (h3(x, y, z, 9) < 0.7 - y * 0.25 ? (h3(x, y, z, 2) < 0.5 ? C.rub : st[1]) : null));
}

// ---------------------------------------------------------------- FLAVOUR LINES (creatures)

// Scribble Grubs (docs): a plump C-curled beetle grub on lined notebook paper: cream rolls with ruled blue lines and a
// red margin, an amber head capsule with dark mandibles and three pairs of little legs.
function notes(m, a, ph) {
  const pal = palette(m);
  const c1 = a.color || '#ffd84a', c2 = a.color2 || '#fff6c8';
  const C = {
    body: pal(c2, { ...GL }), fold: pal(shade(c2, -0.2), { ...GL }), back: pal(mix(c1, c2, 0.35), { ...GL }), line: pal('#5a8ae8', { ...GL }),
    margin: pal('#ff5a6a', { ...GL }), gloss: pal('#ffffff', { spec: 1, specPow: 5, emissive: 0.3 }),
    head: pal('#c8782a', { spec: 0.9, specPow: 8, smooth: 0.6 }), headD: pal('#8a4a18', { spec: 0.8 }), jaw: pal('#2a1810', { spec: 1 }), leg: pal('#b8702a'),
  };
  const curl = 1 + Math.sin(ph * TAU) * 0.12;
  const P = [];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10, ang = Math.PI * 1.15 - t * Math.PI * 1.25 * curl;
    const R = 10;
    P.push([22 + Math.cos(ang) * R * 1.25, 12 + Math.sin(ang) * R, 14, 3.4 + Math.sin(t * Math.PI) * 3.2]);
  }
  P[0][3] = 3.2;
  const segs = 11;
  const S = tube(m, P, (u, n) => {
    const f = (u * segs) % 1;
    if (f < 0.13) return C.fold;
    if (n[2] > 0.45 && Math.abs(f - 0.55) < 0.07) return C.line;
    if (n[2] > 0.3 && n[1] > 0.45 && f > 0.25 && f < 0.42) return C.gloss;
    if (Math.abs(n[2]) < 0.3 && n[1] > 0.6) return C.margin;
    return n[1] > 0.35 ? C.back : C.body;
  });
  // head capsule at the end of the curl
  const hp = S[S.length - 1].p, ht = S[S.length - 1].t;
  const hx = hp[0] + ht[0] * 3, hy = hp[1] + ht[1] * 3, hz = 14;
  m.ellipsoid(hx, hy, hz, 3.6, 3.4, 3.8, (x, y) => (y > hy + 1.5 ? C.headD : C.head));
  m.set(hx + ht[0] * 3.6, hy + ht[1] * 3.6 - 1, hz + 1.5, C.jaw); m.set(hx + ht[0] * 3.6, hy + ht[1] * 3.6 - 1, hz - 1.5, C.jaw);
  m.set(hx + ht[0] * 4.2, hy + ht[1] * 4.2 - 1.5, hz + 1, C.jaw);
  eye(m, pal, hx + ht[0] * 1.5 - 0.5, hy + 1.6, hz + 3.2, 0.9);
  // three pairs of legs just behind the head
  for (let k = 1; k <= 3; k++) {
    const s = S[Math.max(0, S.length - 1 - k * 9)];
    const [x, y] = s.p;
    for (const zs of [-1, 1]) limb(m, [[x, y - 2, 14 + zs * 3], [x + 1.4, y - 4.5, 14 + zs * 4.5], [x + 2.4, y - 5, 14 + zs * 4]], C.leg);
  }
  tierFx(m, pal, a);
}

// Nesting Nymphs (folder): a dragonfly nymph: big glossy compound eyes, a broad thorax with wing pads (folder tabs),
// a ringed tapering abdomen ending in three gill spikes, and six jointed legs splayed out.
function documents(m, a, ph) {
  const pal = palette(m);
  const c1 = a.color || '#f0b850', c2 = a.color2 || '#ffe7a8';
  const C = {
    body: pal(c1, { ...GL }), ring: pal(shade(c1, -0.25), { ...GL }), belly: pal(c2, { ...GL }), pad: pal(mix(c1, '#ffffff', 0.25), { spec: 0.8, specPow: 8 }),
    padV: pal(shade(c1, -0.35)), eye: pal('#2a3a5a', { spec: 1, specPow: 5, smooth: 1 }), eyeH: pal('#9ad8ff', { emissive: 0.4, spec: 1 }),
    leg: pal(shade(c1, -0.3), { spec: 0.5 }), legL: pal(mix(c1, c2, 0.5)), gill: pal(mix(c1, '#ff9a5a', 0.4), { spec: 0.6 }), gloss: pal('#ffffff', { spec: 1, emissive: 0.25 }),
  };
  const w = Math.sin(ph * TAU) * 1.4;
  // abdomen (tail end on the left)
  const P = [[5, 9 + w * 0.6, 14, 1.6], [10, 9.5 + w * 0.4, 14, 3.4], [16, 10, 14, 4.3], [22, 10.5, 14, 4.4], [27, 11, 14, 3.6]];
  tube(m, P, (u, n) => {
    const f = (u * 8) % 1;
    if (f < 0.15) return C.ring;
    if (n[1] > 0.5 && n[2] > 0.3 && f > 0.4 && f < 0.6) return C.gloss;
    return n[1] < -0.3 ? C.belly : C.body;
  }, { ry: 0.8 });
  // gill spikes
  for (const [dy, dz] of [[0, 0], [1.2, 1.5], [1.2, -1.5]]) m.line(5, 9 + w * 0.6 + dy * 0.5, 14 + dz, 1, 9.6 + w + dy, 14 + dz * 1.4, C.gill, 0.7);
  // thorax + wing pads
  m.ellipsoid(31, 11.5, 14, 4.6, 4, 4.8, (x, y) => (y < 10 ? C.belly : C.body));
  for (const s of [-1, 1]) {
    for (let i = 0; i < 9; i++) for (let j = 0; j <= 2; j++) m.set(29 - i, 15 - i * 0.18, 14 + s * (1.6 + j), i === 8 || j === 2 ? C.padV : C.pad);
  }
  // head + eyes
  m.ellipsoid(37, 12, 14, 3.4, 3.2, 4.2, C.body);
  for (const s of [-1, 1]) { m.sphere(38, 13.5, 14 + s * 3.6, 2.4, C.eye); m.set(37.4, 15, 14 + s * 3.6 + (s > 0 ? 1.6 : -1.6), C.eyeH); }
  m.set(40.6, 11, 14, C.ring); m.set(40.6, 10, 14.8, C.ring); m.set(40.6, 10, 13.2, C.ring);
  // six legs
  for (let k = 0; k < 3; k++) {
    const x = 28 + k * 3.4, kick = Math.sin(ph * TAU + k * 2) * 0.8;
    for (const s of [-1, 1]) limb(m, [[x, 9.5, 14 + s * 3.5], [x + (k - 1) * 3 + kick, 11, 14 + s * 8], [x + (k - 1) * 4.5 + kick, 1, 14 + s * 10]], k === 1 ? C.legL : C.leg, 0.55);
  }
  tierFx(m, pal, a);
}

// Number Nibbles (calc): a round beetle whose shell is a calculator: an LCD strip with glowing digits, a 4 x 3 grid of
// raised keys (orange operators), a black head with antennae and six legs.
function calculator(m, a, ph) {
  const pal = palette(m);
  const c1 = a.color || '#8a9ab8', c2 = a.color2 || '#ff9a3a';
  const C = {
    shell: pal(c1, { spec: 0.8, specPow: 9, smooth: 0.6 }), shellD: pal(shade(c1, -0.3), { spec: 0.6 }), key: pal('#eef2f8', { spec: 0.8, specPow: 7 }),
    keyD: pal('#b8c2d2'), op: pal(c2, { spec: 0.9, specPow: 6, emissive: 0.1 }), lcd: pal('#2a4a2a', { spec: 0.9 }), seg: pal('#9aff8a', { emissive: 0.9 }),
    head: pal('#1e1a24', { spec: 1, specPow: 7 }), leg: pal('#2a2430'), eye: pal('#ffffff', { emissive: 0.5 }), belly: pal(shade(c1, -0.42)),
  };
  const cx = 20, cy = 6, cz = 14;
  m.ellipsoid(cx, cy, cz, 13, 9, 10, (x, y) => (y < cy - 1 ? C.belly : C.shell));
  m.sub(() => m.box(0, 0, 0, 47, cy - 3, 30));
  // flatten top into a keypad plateau
  for (let z = 0; z < 30; z++) for (let x = 0; x < 48; x++) for (let y = cy + 7; y < 30; y++) m.set(x, y, z, 0);
  // keys on the top face
  const keyAt = (kx, kz, c) => {
    const x = Math.round(cx - 8 + kx * 4.2), z = Math.round(cz - 5.5 + kz * 3.8);
    for (let dx = 0; dx < 3; dx++) for (let dz = 0; dz < 3; dz++) {
      const X = x + dx, Z = z + dz;
      if (!m.get(X, cy + 6, Z)) continue;
      m.set(X, cy + 7, Z, dz === 0 || dx === 2 ? (c === C.op ? C.op : C.keyD) : c);
    }
  };
  for (let kx = 0; kx < 4; kx++) for (let kz = 0; kz < 3; kz++) keyAt(kx, kz, kx === 3 || (kz === 0 && kx > 1) ? C.op : C.key);
  // LCD strip along the front edge of the shell
  for (let x = cx - 9; x <= cx + 8; x++) for (let y = cy + 2; y <= cy + 5; y++) {
    const z = Math.round(cz + 9.6 * Math.sqrt(Math.max(0, 1 - ((x + 0.5 - cx) / 13) ** 2 - ((y + 0.5 - cy) / 9) ** 2)));
    if (z > 0 && m.get(x, y, z)) {
      const d = (x - (cx - 8)) % 4;
      m.set(x, y, z, (y === cy + 3 || y === cy + 4) && d !== 3 && x < cx + 6 && h3(x, y, 1) < 0.75 ? C.seg : C.lcd);
    }
  }
  // seam down the middle
  // head + antennae
  m.ellipsoid(cx + 13.5, cy + 1, cz, 3.8, 3.4, 4.2, C.head);
  eye(m, pal, cx + 15, cy + 2.4, cz + 3, 1.1, '#0a080e');
  const wv = Math.sin(ph * TAU) * 1.5;
  for (const s of [-1, 1]) limb(m, [[cx + 15, cy + 3.5, cz + s * 2], [cx + 19, cy + 8 + wv * s, cz + s * 4], [cx + 23, cy + 9 + wv, cz + s * 6]], C.leg);
  // legs
  for (let k = 0; k < 3; k++) {
    const x = cx - 6 + k * 6;
    for (const s of [-1, 1]) limb(m, [[x, cy - 1, cz + s * 8], [x + (k - 1) * 2, cy, cz + s * 12], [x + (k - 1) * 3, 0, cz + s * 13]], C.leg, 0.5);
  }
  tierFx(m, pal, a);
}

// Tide Ticks (calendar): a fat round tick carrying a calendar page on its back: red header with silver binder rings,
// a grid of day dots with one circled day, a little head with palps and eight jointed legs.
function calendar(m, a, ph) {
  const pal = palette(m);
  const c1 = a.color || '#ff5a62', c2 = a.color2 || '#ffffff';
  const C = {
    body: pal(shade(c1, -0.35), { ...GL }), bodyL: pal(shade(c1, -0.15), { ...GL }), page: pal(c2, { spec: 0.4 }), pageS: pal(shade(c2, -0.12)),
    head: pal(c1, { spec: 0.9, specPow: 8 }), ring: pal('#d8dee8', METAL), dot: pal('#5a6478'), today: pal(c1, { emissive: 0.4 }),
    leg: pal(shade(c1, -0.5), { spec: 0.5 }), legL: pal(shade(c1, -0.3)), palp: pal(shade(c1, -0.45)),
  };
  const cx = 22, cy = 7, cz = 14;
  m.ellipsoid(cx, cy, cz, 12, 6.5, 10, (x, y, z) => (y > cy + 3 ? C.bodyL : C.body));
  // calendar page draped on the back (top layer)
  for (let z = 0; z < 30; z++) for (let x = 0; x < 48; x++) {
    let top = -1;
    for (let y = 29; y >= 0; y--) if (m.get(x, y, z)) { top = y; break; }
    if (top < cy + 3) continue;
    const u = x - (cx - 9), v = z - (cz - 7.5);
    if (u < 0 || u > 17 || v < 0 || v > 15) continue;
    const header = v < 4;
    let c = header ? C.head : C.page;
    if (!header && u % 3 === 1 && (v - 5) % 3 === 0 && v > 4 && u < 17) c = C.dot;
    if (!header && u === 10 && v === 11) c = C.today;
    if (!header && (u === 9 || u === 11) && v === 11) c = C.today;
    if (u === 0 || u === 17 || v === 15) c = header ? C.head : C.pageS;
    m.set(x, top + 1, z, c);
  }
  // binder rings
  for (const u of [3, 8, 13]) for (let i = 0; i < 10; i++) {
    const ang = (i / 10) * Math.PI;
    const x = cx - 9 + u, z = cz - 7.5 + 1.5 + Math.cos(ang) * 1.6;
    m.set(x, cy + 8 + Math.sin(ang) * 2.4, z, C.ring);
  }
  // head + palps (front = +x)
  m.ellipsoid(cx + 12.5, cy, cz, 3, 2.4, 2.6, C.head);
  for (const s of [-1, 1]) m.line(cx + 14, cy - 0.5, cz + s * 1.2, cx + 17, cy - 1.5, cz + s * 1.4, C.palp, 0.6);
  // eight legs
  const kick = Math.sin(ph * TAU) * 0.8;
  for (let k = 0; k < 4; k++) {
    const x = cx - 5 + k * 4.2, sp = (k - 1.5) * 3;
    for (const s of [-1, 1]) limb(m, [[x, cy - 1, cz + s * 8], [x + sp + kick * s, cy + 3.5, cz + s * 12], [x + sp * 1.4, 0, cz + s * 14]], k % 2 ? C.legL : C.leg, 0.55);
  }
  tierFx(m, pal, a);
}

// Bassline Minnows (music): a glossy minnow with a two-tone back, silver belly, scale rows, a dark lateral line,
// translucent fins, a big eye and a beamed-note mark on its flank; its tail beats on the hook.
function music(m, a, ph) {
  const pal = palette(m);
  const c1 = a.color || '#ff6ac8', c2 = a.color2 || '#9a6aff';
  const C = {
    back: pal(c2, { ...GL }), side: pal(c1, { ...GL }), sideD: pal(shade(c1, -0.16), { ...GL }), belly: pal('#eef4ff', { spec: 1, specPow: 6, smooth: 0.8 }),
    lat: pal(shade(c2, -0.3), { ...GL }), fin: pal(mix(c1, '#ffffff', 0.45), { spec: 0.7 }), finR: pal(mix(c1, c2, 0.5), { spec: 0.5 }),
    note: pal('#1a1430', { spec: 1, specPow: 6 }), gill: pal(shade(c1, -0.35)), gloss: pal('#ffffff', { spec: 1, emissive: 0.35 }),
  };
  const sw = Math.sin(ph * TAU);
  const cx = 22, cy = 12, cz = 13;
  const L = 15, H = 6.2, Z = 4.4;
  for (let x = cx - L; x <= cx + L; x++) {
    const t = (x + 0.5 - (cx - L)) / (2 * L);      // 0 tail .. 1 nose
    const prof = Math.pow(Math.sin(Math.min(1, t * 1.08) * Math.PI), 0.75) * (t > 0.82 ? 1 - (t - 0.82) * 1.6 : 1);
    const bend = sw * Math.pow(1 - t, 2) * 3.5;
    const hh = H * prof, zz = Z * prof;
    for (let y = Math.floor(cy - hh); y <= cy + hh; y++) for (let z = Math.floor(cz - zz + bend); z <= cz + zz + bend; z++) {
      const ny = (y + 0.5 - cy) / (hh || 1), nz = (z + 0.5 - cz - bend) / (zz || 1);
      if (ny * ny + nz * nz > 1) continue;
      let c = ny > 0.55 ? C.back : ny < -0.35 ? C.belly : ((Math.floor(x / 2) + Math.floor((y + 30) / 2)) % 2 ? C.side : C.sideD);
      if (Math.abs(ny - 0.08) < 0.12 && t > 0.15 && t < 0.8) c = C.lat;
      if (ny > 0.35 && nz > 0.55 && t > 0.4 && t < 0.75) c = C.gloss;
      m.set(x, y, z, c);
    }
  }
  // gill arc
  for (let y = cy - 4; y <= cy + 3; y++) m.set(cx + 8 - Math.abs(y - cy) * 0.35, y, cz + 4.2, C.gill);
  eye(m, pal, cx + 11, cy + 1.6, cz + 3.4, 1.8);
  // forked tail (bends with the swim)
  const tb = sw * 4;
  for (let i = 0; i <= 7; i++) for (const s of [-1, 1]) {
    const x = cx - L - i * 0.9, y = cy + s * (1 + i * 0.9);
    m.line(x, y, cz + tb * (0.5 + i * 0.08), x, cy + s * 0.5, cz + tb * 0.5, i === 7 ? C.finR : C.fin);
  }
  // dorsal, anal, pectoral fins
  for (let i = 0; i < 7; i++) m.line(cx - 2 + i, cy + H - 0.5, cz, cx - 4 + i * 1.2, cy + H + 3 - i * 0.35, cz, i % 2 ? C.fin : C.finR);
  for (let i = 0; i < 5; i++) m.line(cx - 7 + i, cy - H + 1, cz, cx - 9 + i * 1.2, cy - H - 1.8 + i * 0.2, cz, C.fin);
  limb(m, [[cx + 6, cy - 2, cz + 4], [cx + 2, cy - 4, cz + 6.5], [cx + 1, cy - 2.5, cz + 6.8]], C.fin, 0.5);
  // the beamed note on its flank
  const nx = cx - 3, ny = cy - 1, nz = cz + 4.4;
  m.set(nx, ny, nz, C.note); m.set(nx + 1, ny, nz, C.note); m.set(nx + 4, ny + 1, nz - 0.2, C.note); m.set(nx + 5, ny + 1, nz - 0.2, C.note);
  m.line(nx + 1, ny, nz, nx + 1, ny + 4, nz, C.note); m.line(nx + 5, ny + 1, nz - 0.2, nx + 5, ny + 5, nz - 0.2, C.note);
  m.line(nx + 1, ny + 4, nz, nx + 5, ny + 5, nz - 0.2, C.note);
  tierFx(m, pal, a);
}

// Pixel Shrimp (image): a glossy shrimp: curled ringed abdomen, a carapace with a toothed rostrum, stalked eyes, long
// sweeping antennae, five pairs of walking legs, swimmerets and a spread tail fan.
function photos(m, a, ph) {
  const pal = palette(m);
  const c1 = a.color || '#4ac8ff', c2 = a.color2 || '#7ae05a';
  const C = {
    shell: pal(c1, { ...GL }), shellD: pal(shade(c1, -0.22), { ...GL }), band: pal(c2, { ...GL }), belly: pal(mix(c1, '#ffffff', 0.5), { ...GL }),
    gloss: pal('#ffffff', { spec: 1, emissive: 0.35 }), leg: pal(mix(c1, '#ffffff', 0.3)), legD: pal(shade(c1, -0.3)), ant: pal(shade(c1, -0.4)),
    fan: pal(mix(c1, c2, 0.4), { spec: 0.8, specPow: 6 }), fanE: pal(c2, { spec: 0.6 }), eye: pal('#0e0a18', { spec: 1, smooth: 1 }),
  };
  const fl = Math.sin(ph * TAU);
  // abdomen curling down to the tail fan (tail on the left)
  const P = [];
  for (let i = 0; i <= 6; i++) {
    const t = i / 6, ang = Math.PI * (0.95 - t * 0.62) + fl * 0.08 * (1 - t);
    P.push([20 + Math.cos(ang) * 11, 12 + Math.sin(ang) * 6.5 - (1 - t) * 2, 14, 2.4 + t * 2.6]);
  }
  tube(m, P, (u, n) => {
    const f = (u * 6) % 1;
    if (f < 0.14) return C.shellD;
    if (n[1] > 0.55 && f > 0.2 && f < 0.5) return C.band;
    if (n[1] > 0.3 && n[2] > 0.5 && f > 0.55 && f < 0.75) return C.gloss;
    return n[1] < -0.4 ? C.belly : C.shell;
  });
  // carapace + rostrum
  m.ellipsoid(32, 12.6, 14, 6.2, 5, 4.8, (x, y, z) => (y > 15.5 && z > 15 ? C.gloss : y < 10 ? C.belly : C.shell));
  for (let i = 0; i < 8; i++) { m.set(37 + i, 15.5 + i * 0.25, 14, C.shellD); if (i % 2 === 0) m.set(37 + i, 16.5 + i * 0.25, 14, C.shell); }
  // stalked eyes
  for (const s of [-1, 1]) { m.line(36, 14, 14 + s * 2.5, 37.5, 15.5, 14 + s * 3.8, C.shellD, 0.6); m.sphere(38, 16, 14 + s * 4, 1.4, C.eye); m.set(37.6, 16.8, 14 + s * 4 + 1, C.gloss); }
  // long antennae sweeping back over the body, and short antennules
  for (const s of [-1, 1]) {
    limb(m, [[38, 13, 14 + s * 2], [44, 18, 14 + s * 4], [40, 26 + fl, 14 + s * 6], [26, 29 + fl * 0.5, 14 + s * 7], [12, 27, 14 + s * 7]], C.ant);
    limb(m, [[38, 12, 14 + s], [44, 13, 14 + s * 2], [46, 15, 14 + s * 2]], C.legD);
  }
  // walking legs + swimmerets
  for (let k = 0; k < 5; k++) {
    const x = 28 + k * 2, kick = Math.sin(ph * TAU + k) * 0.6;
    for (const s of [-1, 1]) limb(m, [[x, 9, 14 + s * 3], [x + 1 + kick, 6, 14 + s * 5.5], [x + 2.5, 1, 14 + s * 6]], k % 2 ? C.leg : C.legD);
  }
  for (let k = 0; k < 4; k++) { const p = P[2 + k] || P[5]; for (const s of [-1, 1]) m.line(p[0], p[1] - p[3] + 0.5, 14 + s * 1.5, p[0] - 0.5, p[1] - p[3] - 2, 14 + s * 2.5, C.leg); }
  // tail fan: telson + 4 uropods spread
  const tp = P[0];
  for (let i = -2; i <= 2; i++) {
    const ang = Math.PI * 0.62 + i * 0.22;
    for (let r = 1; r <= 6; r++) {
      const x = tp[0] + Math.cos(ang) * r * 0.9, y = tp[1] - 1 - Math.sin(ang) * r * 0.5 - r * 0.35;
      const wdt = r < 5 ? 1.6 : 1;
      m.box(x, y, 14 - wdt + i * 0.6, x, y, 14 + wdt + i * 0.6, r === 6 ? C.fanE : C.fan);
    }
  }
  tierFx(m, pal, a);
}

// Buffer Leeches (video): a flattened, finely ringed leech: red with two dark dorsal stripes and yellow dots, a white
// play-button mark, a small oral sucker and a broad tail sucker; it inches along in a looping arch.
function videos(m, a, ph) {
  const pal = palette(m);
  const c1 = a.color || '#ff4a5a', c2 = a.color2 || '#3a3a52';
  const C = {
    body: pal(c1, { ...GL }), ring: pal(shade(c1, -0.18), { ...GL }), stripe: pal(c2, { ...GL }), dot: pal('#ffd84a', { ...GL, emissive: 0.2 }),
    belly: pal(mix(c1, '#ffd8c8', 0.45), { ...GL }), play: pal('#ffffff', { emissive: 0.35, spec: 0.8 }), sucker: pal(shade(c1, -0.32), { ...GL }),
    gloss: pal('#ffffff', { spec: 1, emissive: 0.3 }),
  };
  const arch = 0.5 + 0.5 * Math.sin(ph * TAU);
  const P = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    const x = 5 + t * (36 - arch * 8);
    const y = 3.5 + Math.sin(t * Math.PI) * (2 + arch * 9);
    P.push([x, y, 14, 2.4 + Math.sin(Math.min(1, t * 1.2) * Math.PI) * 2.4]);
  }
  P[0][3] = 3.6; P[8][3] = 1.8;
  tube(m, P, (u, n) => {
    const f = (u * 34) % 1;
    if (n[1] > 0.4 && Math.abs(Math.abs(n[2]) - 0.45) < 0.13) return C.stripe;
    if (n[1] > 0.5 && Math.abs(n[2]) < 0.2 && h3(Math.floor(u * 40), 1, 1) < 0.35) return C.dot;
    if (n[1] > 0.7 && n[2] > 0.15 && f > 0.4) return C.gloss;
    if (f < 0.25) return C.ring;
    return n[1] < -0.3 ? C.belly : C.body;
  }, { ry: 0.7, step: 0.25 });
  // tail sucker disc + oral sucker
  m.ellipsoid(P[0][0] - 1, 1.5, 14, 4.2, 1.5, 4.2, C.sucker);
  m.ellipsoid(P[8][0] + 1, P[8][1] - 0.6, 14, 1.8, 1.4, 1.8, C.sucker);
  // play button on top of the arch
  const S = spline(P);
  const mid = S[Math.floor(S.length * 0.5)].p;
  const top = Math.ceil(mid[1] + mid[3] * 0.7);
  for (let i = 0; i < 5; i++) for (let j = -i; j <= i; j++) if (Math.abs(j) <= 2) m.set(mid[0] - 2 + (4 - i), top, 14 + j * 0.9, C.play);
  tierFx(m, pal, a);
}

// Splatter Worms (paint): a juicy worm splattered with paint in every colour, drips on its sides, and a paint-dipped
// brush tuft for a tail.
function paint(m, a, ph) {
  const c1 = a.color || '#ff8a3a', c2 = a.color2 || '#4ac8ff';
  const spl = ['#ffd23a', '#ff4ac8', '#7ae05a', '#ffffff'];
  worm(m, a, ph, {
    body: c1, glow: 0.05, clit: mix(c1, '#ffffff', 0.35), noTier: true,
    after: (mm, pal, P) => {
      const cols = [c2, ...spl].map((c) => pal(c, { ...GL }));
      for (let i = 0; i < 22; i++) {
        const k = 1 + Math.floor(hash1(i, 3) * (P.length - 2)), p = P[k], q = P[k + 1];
        const t = hash1(i, 5), x = p[0] + (q[0] - p[0]) * t, y = p[1] + (q[1] - p[1]) * t, z = p[2] + (q[2] - p[2]) * t;
        const ang = hash1(i, 7) * TAU, r = p[3] + 0.2;
        const sx = x, sy = y + Math.sin(ang) * r, sz = z + Math.cos(ang) * r;
        const c = cols[i % cols.length];
        mm.paint(() => mm.sphere(sx, sy, sz, 1.4 + hash1(i, 9) * 1.2, c));
        if (i % 3 === 0) mm.paint(() => mm.line(sx, sy, sz, sx, sy - 3, sz, c, 0.6));
      }
      // brush tuft at the tail end (left): ferrule + bristles dipped in paint
      const t0 = P[0];
      const fer = pal('#d8dee8', METAL), bri = pal('#e8c890'), dip = pal(c2, { ...GL });
      mm.cylinder(t0[1], t0[2], t0[0] - 3, t0[0], 1.8, fer, 'x');
      for (let i = 0; i < 9; i++) {
        const ang = (i / 9) * TAU, dy = Math.cos(ang) * 1.3, dz = Math.sin(ang) * 1.3;
        mm.line(t0[0] - 3, t0[1] + dy, t0[2] + dz, t0[0] - 8, t0[1] + dy * 1.8 - 0.5, t0[2] + dz * 1.8, bri);
        mm.line(t0[0] - 6.5, t0[1] + dy * 1.6 - 0.4, t0[2] + dz * 1.6, t0[0] - 8.5, t0[1] + dy * 1.9 - 0.6, t0[2] + dz * 1.9, dip);
      }
    },
  });
  tierFx(m, palette(m), a);
}

// Arcade Crickets (game): a cricket with a glossy shield, folded veined wings, two arcade buttons on its back, huge
// jumping hind legs, long antennae and tail cerci.
function games(m, a, ph) {
  const pal = palette(m);
  const c1 = a.color || '#8a5aff', c2 = a.color2 || '#5affa8';
  const C = {
    body: pal(c1, { ...GL }), bodyD: pal(shade(c1, -0.28), { ...GL }), wing: pal(mix(c1, '#ffffff', 0.35), { spec: 0.8, specPow: 7 }), vein: pal(shade(c1, -0.4)),
    leg: pal(shade(c1, -0.15), { spec: 0.6 }), legD: pal(shade(c1, -0.45)), btnA: pal('#ff4a6a', { spec: 1, specPow: 5, emissive: 0.2 }), btnB: pal('#ffd23a', { spec: 1, specPow: 5, emissive: 0.2 }),
    acc: pal(c2, { ...GL, emissive: 0.15 }), ant: pal(shade(c1, -0.5)),
  };
  const kick = Math.sin(ph * TAU) * 1.2;
  // abdomen, thorax, head (head toward +x)
  m.ellipsoid(16, 9, 14, 9, 4.6, 5, (x, y) => (y < 7 ? C.bodyD : C.body));
  m.ellipsoid(27, 10.5, 14, 4.5, 4.6, 5.2, C.body);
  m.ellipsoid(33.5, 11, 14, 3.8, 4.2, 4.6, (x, y) => (y > 13 ? C.bodyD : C.body));
  eye(m, pal, 35, 13, 17.5, 1.6); eye(m, pal, 35, 13, 10.5, 1.6);
  // folded wings over the abdomen, veined
  for (let x = 9; x <= 28; x++) for (let z = 10; z <= 18; z++) {
    const y = 13.6 - (28 - x) * 0.06 - Math.abs(z - 14) * 0.3;
    m.set(x, y, z, (x % 3 === 0 || z === 14 || z === 10 || z === 18) ? C.vein : C.wing);
  }
  // arcade buttons + d-pad on the shield
  m.cylinder(26, 12, 15, 16, 1.4, C.btnA); m.cylinder(28.5, 16, 15, 16, 1.4, C.btnB);
  m.box(25, 15, 17, 25, 15, 19, C.acc); m.box(24, 15, 18, 26, 15, 18, C.acc);
  // huge hind legs (thick femur, thin tibia)
  for (const s of [-1, 1]) {
    const z = 14 + s * 5.4;
    m.line(22, 9, z, 13, 17 + kick, z + s * 1.5, C.leg, 1.6);
    m.line(13, 17 + kick, z + s * 1.5, 7, 1, z + s * 2.5, C.legD, 0.6);
    for (let i = 0; i < 4; i++) m.set(12 - i * 1.4, 14 + kick - i * 3.7, z + s * 1.8, C.acc);
    limb(m, [[7, 1, z + s * 2.5], [4, 0, z + s * 2.5]], C.legD);
  }
  // front + middle legs
  for (const [x, dx] of [[30, 3], [26, -1]]) for (const s of [-1, 1]) limb(m, [[x, 8, 14 + s * 4], [x + dx, 5, 14 + s * 7], [x + dx * 1.4, 0, 14 + s * 8]], C.legD, 0.5);
  // antennae + cerci
  for (const s of [-1, 1]) {
    limb(m, [[36, 14, 14 + s * 2], [42, 20 + kick * s * 0.5, 14 + s * 4], [46, 27, 14 + s * 6]], C.ant);
    m.line(7.5, 9, 14 + s, 2, 11, 14 + s * 3, C.ant);
  }
  tierFx(m, pal, a);
}

// Meta Mayflies (fishtop): a mayfly resting with its big veined wings raised, a curved slender abdomen ending in three
// long tail filaments, a humped thorax and large eyes.
function fishtop(m, a, ph) {
  const pal = palette(m);
  const c1 = a.color || '#8a5aff', c2 = a.color2 || '#5affa8';
  const C = {
    body: pal(c1, { ...GL }), ring: pal(shade(c1, -0.25), { ...GL }), wing: pal(mix(c2, '#ffffff', 0.6), { spec: 0.9, specPow: 6, emissive: 0.1 }),
    wingE: pal(mix(c2, '#ffffff', 0.25), { spec: 0.7 }), vein: pal(shade(c2, -0.35)), tail: pal(shade(c1, -0.35)), leg: pal(shade(c1, -0.4)),
    eye: pal('#1a1a2a', { spec: 1, smooth: 1 }), spot: pal(c2, { emissive: 0.5 }),
  };
  const flap = Math.sin(ph * TAU) * 1.5;
  // curved abdomen rising to the tail (tail on the left)
  const P = [[28, 9, 14, 2.6], [22, 8.4, 14, 2.4], [16, 9.6, 14, 2], [11, 12, 14, 1.5], [8, 15, 14, 1.1]];
  tube(m, P, (u, n) => ((u * 9) % 1 < 0.2 ? C.ring : n[1] > 0.5 && (u * 9) % 1 > 0.6 ? C.spot : C.body));
  // three tail filaments
  for (const dz of [-1.5, 0, 1.5]) limb(m, [[8, 15, 14 + dz], [3, 19, 14 + dz * 2.2], [0, 25, 14 + dz * 3.2]], C.tail);
  // thorax + head + eyes
  m.ellipsoid(31, 10.5, 14, 3.6, 3.6, 3.4, C.body);
  m.ellipsoid(35.5, 10.5, 14, 2.4, 2.4, 2.8, C.body);
  for (const s of [-1, 1]) { m.sphere(36.2, 11.6, 14 + s * 2.4, 1.8, C.eye); m.set(35.8, 12.8, 14 + s * 3.4, pal('#ffffff', { emissive: 0.4 })); }
  // raised fore wings (a fan, veined) and small hind wings
  for (const s of [-1, 1]) {
    for (let r = 0; r <= 18; r++) for (let k = 0; k <= 10; k++) {
      const t = k / 10, ang = 0.25 + t * 1.15;
      const x = 31 - Math.cos(ang) * r * 0.85, y = 13 + Math.sin(ang) * r + flap * (r / 18);
      const z = 14 + s * (1 + r * 0.12);
      const edge = r === 18 || k === 0 || k === 10;
      if (r > 18 * (0.75 + 0.25 * Math.sin(t * Math.PI))) continue;
      m.set(x, y, z, edge ? C.wingE : k % 3 === 0 || r % 6 === 0 ? C.vein : C.wing);
    }
    for (let r = 0; r <= 6; r++) for (let k = 0; k <= 4; k++) m.set(28 - r * 0.6, 12 + k * 0.8 + r * 0.3, 14 + s * (1.6 + r * 0.2), k === 4 ? C.wingE : C.wing);
  }
  // legs
  for (let k = 0; k < 3; k++) for (const s of [-1, 1]) limb(m, [[29 + k * 2, 8, 14 + s * 2], [30 + k * 3, 5, 14 + s * 5], [31 + k * 3.5, 0, 14 + s * 6]], C.leg);
  tierFx(m, pal, a);
}

// Chatter Krill (chat): a glassy krill with huge black eyes, orange pigment dots, glowing blue belly lights and
// feathery legs, chattering a little three-dot speech bubble.
function chat(m, a, ph) {
  const pal = palette(m);
  const c1 = a.color || '#4ad0ff', c2 = a.color2 || '#ffffff';
  const C = {
    shell: pal(mix(c1, '#ffffff', 0.35), { ...GL }), shellD: pal(c1, { ...GL }), dot: pal('#ff7a3a', { ...GL }), light: pal('#6af0ff', { emissive: 1 }),
    eye: pal('#0e0a18', { spec: 1, smooth: 1 }), leg: pal(mix(c1, '#ffffff', 0.55)), bub: pal(c2, { spec: 0.6, smooth: 0.5 }), bubE: pal(shade(c2, -0.18)),
    bubD: pal(c1, { spec: 0.8, emissive: 0.2 }), gloss: pal('#ffffff', { spec: 1, emissive: 0.35 }), fan: pal(mix(c1, '#ffffff', 0.2), { spec: 0.7 }),
  };
  const fl = Math.sin(ph * TAU);
  const P = [[6, 7, 12, 1.6], [11, 8, 12, 2.6], [17, 9, 12, 3.4], [24, 10, 12, 3.8], [30, 10.5, 12, 3.6], [34, 10.5, 12, 3]];
  tube(m, P, (u, n) => {
    const f = (u * 9) % 1;
    if (n[1] < -0.55 && f > 0.4 && f < 0.6 && u > 0.2) return C.light;
    if (n[1] > 0.2 && h3(Math.floor(u * 30), Math.floor(n[2] * 4), 2) < 0.18) return C.dot;
    if (n[1] > 0.5 && n[2] > 0.3 && f > 0.55 && f < 0.8) return C.gloss;
    return f < 0.15 ? C.shellD : C.shell;
  });
  // big eyes
  for (const s of [-1, 1]) { m.sphere(35, 12, 12 + s * 3, 2.2, C.eye); m.set(34.4, 13.4, 12 + s * 3 + (s > 0 ? 1.8 : -1.6), C.gloss); }
  // antennae
  for (const s of [-1, 1]) limb(m, [[36, 11, 12 + s], [42, 14 + fl * s, 12 + s * 2], [46, 12, 12 + s * 3]], C.leg);
  // feathery legs
  for (let k = 0; k < 7; k++) {
    const x = 14 + k * 2.6, kick = Math.sin(ph * TAU + k * 0.8) * 1.2;
    for (const s of [-1, 1]) { m.line(x, 7, 12 + s * 1.5, x + kick, 2, 12 + s * 3.5, C.leg); m.set(x + kick - 0.5, 3, 12 + s * 4, C.leg); }
  }
  // tail fan
  for (let i = -1; i <= 1; i++) m.line(6, 7, 12 + i, 1, 5 + Math.abs(i), 12 + i * 2.5, C.fan, 0.6);
  // speech bubble above, with three dots
  const bx = 26, by = 22, bz = 14;
  m.ellipsoid(bx, by, bz, 8, 4.6, 2.2, (x, y, z) => (z < bz - 1 ? C.bubE : C.bub));
  m.line(bx - 3, by - 4, bz, bx - 6, by - 7.5, bz, C.bub, 1);
  for (let i = 0; i < 3; i++) m.sphere(bx - 3.5 + i * 3.5, by + (Math.floor(ph * 3) % 3 === i ? 1 : 0), bz + 2, 1, C.bubD);
  tierFx(m, pal, a);
}

// Bottle Bugs (mail): a glass bottle lying on its side with a rolled letter in it (sealed with a wax heart), a cork,
// and a spotted beetle riding on top.
function mail(m, a, ph) {
  const pal = palette(m);
  const c1 = a.color || '#3a8aff', c2 = a.color2 || '#ffffff';
  const C = {
    glass: pal('#bfeeff', { spec: 1, specPow: 4, smooth: 1, emissive: 0.05 }), glassD: pal('#7ac8e0', { spec: 1, smooth: 1 }), glassH: pal('#ffffff', { spec: 1, emissive: 0.5 }),
    cork: pal('#c8925a', { jitter: 0.12 }), corkD: pal('#9a6a3a'), paper: pal('#fff6e0'), paperS: pal('#e8d8b0'), wax: pal('#ff4a5a', { spec: 0.9 }),
    shell: pal(c1, { ...GL }), spot: pal(c2, { ...GL }), head: pal('#1a1828', { spec: 1 }), leg: pal('#2a2838'), ribbon: pal(c1, { spec: 0.6 }),
  };
  const cz = 12, cy = 8;
  // bottle body (x 4..30) + shoulder + neck to the right
  for (let x = 4; x <= 40; x++) {
    const r = x <= 28 ? 7 : x <= 33 ? 7 - (x - 28) * 0.95 : 2.6;
    for (let y = Math.floor(cy - r); y <= cy + r; y++) for (let z = Math.floor(cz - r); z <= cz + r; z++) {
      const d = Math.hypot(y + 0.5 - cy, z + 0.5 - cz);
      if (d > r) continue;
      const shell = d > r - 1.1 || x === 4;
      if (!shell) {
        // the rolled letter inside, visible through the glass gaps
        if (x >= 9 && x <= 30 && Math.hypot(y + 0.5 - cy, z + 0.5 - cz) < 3) m.set(x, y, z, x === 18 || x === 19 ? C.ribbon : C.paper);
        continue;
      }
      const ny = (y + 0.5 - cy) / r, nz = (z + 0.5 - cz) / r;
      // window into the glass: front-facing panes are left open so the letter shows
      if (nz > 0.55 && Math.abs(ny) < 0.55 && x > 7 && x < 27 && x % 6 !== 0) continue;
      m.set(x, y, z, ny > 0.55 && nz > 0.2 ? C.glassH : x === 4 || ny < -0.5 ? C.glassD : C.glass);
    }
  }
  // cork with paper peeking out
  m.cylinder(cy, cz, 41, 44, 2.6, (x, y, z) => (h3(x, y, z) < 0.25 ? C.corkD : C.cork), 'x');
  m.set(18.5, cy, cz + 3, C.wax); m.set(18.5, cy + 1, cz + 3, C.wax);
  // beetle riding on top
  const bx = 18, by = cy + 8.5, bz = cz;
  const st = Math.sin(ph * TAU) * 0.6;
  m.ellipsoid(bx, by, bz, 4.4, 2.8, 3.8, (x, y, z) => (Math.abs(z + 0.5 - bz) < 0.6 && y > by ? C.head : C.shell));
  for (const [dx, dz] of [[-2, -2], [1, 2], [-1, 2], [2, -1], [0, 0]]) m.set(bx + dx, by + 2.5, bz + dz, C.spot);
  m.ellipsoid(bx + 4.6, by - 0.4, bz, 1.8, 1.6, 2, C.head);
  eye(m, pal, bx + 5.4, by + 0.4, bz + 1.6, 0.7, '#ffffff');
  for (let k = -1; k <= 1; k++) for (const s of [-1, 1]) limb(m, [[bx + k * 2.4, by - 1.5, bz + s * 3], [bx + k * 3 + st, by - 3, bz + s * 5], [bx + k * 3.4, by - 5.4, bz + s * 5.5]], C.leg);
  tierFx(m, pal, a);
}

// Surf Squidlets (browser): a little squid riding a surfboard: a spotted mantle with fins, big eyes, arms curling over
// the board's edge, and a striped board.
function fishnet(m, a, ph) {
  const pal = palette(m);
  const c1 = a.color || '#2a9aff', c2 = a.color2 || '#6ad06a';
  const C = {
    board: pal('#fff8ec', { spec: 0.9, specPow: 7, smooth: 0.5 }), stripe: pal(c2, { spec: 0.8 }), rail: pal(shade(c2, -0.3)), fin: pal('#2a2a3a'),
    body: pal(c1, { ...GL }), bodyD: pal(shade(c1, -0.25), { ...GL }), spot: pal(shade(c1, -0.4), { ...GL }), belly: pal(mix(c1, '#ffffff', 0.5), { ...GL }),
    gloss: pal('#ffffff', { spec: 1, emissive: 0.35 }), arm: pal(mix(c1, '#ffffff', 0.2), { ...GL }), sucker: pal(mix(c1, '#ffffff', 0.7)),
  };
  const tilt = Math.sin(ph * TAU) * 1.2;
  // surfboard (long oval, slightly rockered)
  for (let x = 2; x <= 45; x++) for (let z = 6; z <= 22; z++) {
    const u = (x + 0.5 - 23.5) / 22, v = (z + 0.5 - 14) / 8;
    if (u * u + (v * v) / (1 - Math.min(0.9, Math.abs(u) ** 3)) > 1) continue;
    const y = 2 + Math.round(u * u * 3 + u * tilt);
    m.set(x, y, z, Math.abs(z + 0.5 - 14) < 1 ? C.stripe : C.board);
    m.set(x, y - 1, z, C.rail);
  }
  m.box(6, -0, 13, 8, 0, 14, C.fin);
  // mantle (pointing up-left) with fins
  const P = [[22, 8, 14, 4.6], [19, 13, 14, 4.2], [16, 18, 14, 3.2], [14, 22, 14, 1.6]];
  tube(m, P, (u, n) => {
    if (h3(Math.floor(u * 20), Math.floor(n[2] * 3 + 3), Math.floor(n[1] * 3 + 3)) < 0.14) return C.spot;
    if (n[0] < -0.3 && n[2] > 0.4 && u > 0.2 && u < 0.6) return C.gloss;
    return n[0] > 0.4 ? C.belly : C.body;
  });
  for (const s of [-1, 1]) for (let i = 0; i < 6; i++) m.line(15 - i * 0.3, 18 + i, 14 + s * 2, 13 - i * 0.6, 17 + i * 0.6, 14 + s * (5 - i * 0.4), C.bodyD);
  // head with big eyes
  m.ellipsoid(24, 7.5, 14, 4, 3.6, 4.4, C.body);
  for (const s of [-1, 1]) eye(m, pal, 26, 8.6, 14 + s * 3.6, 1.9);
  // arms draped onto the board
  for (let i = 0; i < 8; i++) {
    const ang = -1.1 + (i / 7) * 2.2, s = Math.sin(ph * TAU + i) * 0.8;
    const ex = 26 + Math.cos(ang) * 7, ez = 14 + Math.sin(ang) * 7;
    limb(m, [[25, 5, 14 + Math.sin(ang) * 2], [ex - 1, 4 + s * 0.4, ez], [ex + 1.5, 4, ez + s * 0.5], [ex + 2.5, 5, ez]], i % 2 ? C.arm : C.bodyD, 0.6);
  }
  tierFx(m, pal, a);
}

// Code Caddis (terminal): a caddisfly larva peeking out of its hand-built case of dark pebbles, some of them glowing
// green "code" bits, with a striped head and three pairs of legs.
function terminal(m, a, ph) {
  const pal = palette(m);
  const c1 = a.color || '#24343a', c2 = a.color2 || '#5aff8a';
  const pebbles = [c1, shade(c1, 0.25), shade(c1, -0.2), '#5a6070', '#3a4048'].map((c) => pal(c, { jitter: 0.08, smooth: 0.3 }));
  const C = {
    code: pal(c2, { emissive: 0.95 }), code2: pal(mix(c2, '#ffffff', 0.4), { emissive: 1 }), larva: pal('#d8f0c8', { ...GL }), larvaD: pal('#a8c898', { ...GL }),
    head: pal('#6a4a2a', { spec: 0.9, specPow: 8 }), headS: pal('#2a1a10', { spec: 0.8 }), leg: pal('#4a3420'), mouth: pal('#1a1008'),
  };
  // the case: a slightly tapered tube of pebble blocks (opening on the right)
  for (let x = 4; x <= 31; x++) {
    const r = 5.2 + (x - 4) * 0.06;
    for (let y = 0; y < 20; y++) for (let z = 0; z < 28; z++) {
      const d = Math.hypot(y + 0.5 - 7, z + 0.5 - 14);
      if (d > r) continue;
      if (x > 6 && d < r - 1.8) continue; // hollow
      const bx = Math.floor((x + (Math.floor(y / 2) % 2)) / 2), by = Math.floor(y / 2), bz = Math.floor(z / 2);
      const hsh = h3(bx, by, bz, 5);
      if (d > r - 0.7 && hsh < 0.12) continue; // knobbly surface
      const isCode = hsh > 0.88;
      m.set(x, y, z, isCode ? (hsh > 0.95 ? C.code2 : C.code) : pebbles[Math.floor(h3(bx, by, bz, 2) * pebbles.length)]);
    }
  }
  // the larva poking out of the mouth of the case
  const out = 0.5 + 0.5 * Math.sin(ph * TAU);
  const P = [[28, 7, 14, 3.4], [33, 7.4, 14, 3], [36 + out, 8, 14, 2.6]];
  tube(m, P, (u) => ((u * 5) % 1 < 0.2 ? C.larvaD : C.larva));
  const hx = 39 + out;
  m.ellipsoid(hx, 8.2, 14, 2.6, 2.4, 2.6, (x, y, z) => (Math.abs(z + 0.5 - 14) < 0.8 && y > 8.5 ? C.headS : C.head));
  m.set(hx + 2.4, 7.4, 14, C.mouth);
  eye(m, pal, hx + 1, 9, 15.8, 0.6, '#0a0806');
  eye(m, pal, hx + 1, 9, 12.2, 0.6, '#0a0806');
  for (let k = 0; k < 3; k++) for (const s of [-1, 1]) limb(m, [[33 + k * 1.6 + out, 6, 14 + s * 2], [35 + k * 2 + out, 4, 14 + s * 4], [36 + k * 2.5 + out, 2, 14 + s * 4.5]], C.leg);
  tierFx(m, pal, a);
}

// Gear Grubs (settings): a clockwork grub made of brushed-metal cog segments that turn, with rivets, a domed robot
// head, a glowing eye strip and spring antennae.
function settings(m, a, ph) {
  const pal = palette(m);
  const c1 = a.color || '#9aa8b8', c2 = a.color2 || '#e8f0f8';
  const C = {
    gear: pal(c1, METAL), gearD: pal(shade(c1, -0.3), METAL), gearL: pal(c2, METAL), hub: pal('#ffc83a', METAL), rivet: pal('#fff4c0', { spec: 1, emissive: 0.2 }),
    head: pal(mix(c1, c2, 0.5), METAL), visor: pal('#2a3448', { spec: 1 }), led: pal('#5affd8', { emissive: 1 }), spring: pal('#d8a83a', METAL), ball: pal('#ff5a6a', { spec: 1, emissive: 0.3 }),
    axle: pal('#5a6474', METAL),
  };
  const turn = ph * TAU / 8;
  const n = 6;
  for (let i = 0; i < n; i++) {
    const x = 6 + i * 4.6, y = 7.6 + Math.sin(i * 0.9 + ph * TAU) * 0.8;
    const R = 4.2 + Math.sin((i / (n - 1)) * Math.PI) * 2.2;
    const teeth = 10;
    // gear disc in the y-z plane (rotating about x)
    for (let z = -10; z <= 10; z++) for (let yy = -10; yy <= 10; yy++) {
      const r = Math.hypot(yy, z), ang = Math.atan2(yy, z) + turn * (i % 2 ? 1 : -1);
      const toothed = Math.cos(ang * teeth) > 0.2 ? R + 1.2 : R;
      if (r > toothed) continue;
      for (let dx = 0; dx <= 2; dx++) {
        const edge = dx === 0 || dx === 2;
        let c = r > R - 0.4 ? C.gearD : edge ? C.gear : C.gearL;
        if (r < 1.5) c = C.hub;
        else if (Math.abs(r - R * 0.6) < 0.5 && Math.cos(ang * 4) > 0.9) c = C.rivet;
        m.set(x + dx, y + yy, 14 + z, c);
      }
    }
    if (i < n - 1) m.line(x + 2, y, 14, x + 4.6, 7.6 + Math.sin((i + 1) * 0.9 + ph * TAU) * 0.8, 14, C.axle, 1.1);
  }
  // robot head
  const hx = 6 + n * 4.6 + 3;
  m.ellipsoid(hx, 9.5, 14, 4.8, 5.2, 5.4, (x, y) => (y > 12 ? C.gearL : C.head));
  for (let z = 10; z <= 18; z++) for (let y = 9; y <= 11; y++) m.set(hx + 4.2, y, z, y === 10 && z % 2 === 0 ? C.led : C.visor);
  for (const s of [-1, 1]) {
    const pts = [];
    for (let k = 0; k <= 12; k++) pts.push([hx - 1 + Math.sin(k * 1.6) * 0.8, 14 + k * 0.7, 14 + s * (2 + k * 0.25) + Math.cos(k * 1.6) * 0.8]);
    limb(m, pts, C.spring);
    m.sphere(pts[12][0], pts[12][1] + 1, pts[12][2], 1.2, C.ball);
  }
  tierFx(m, pal, a);
}

// RAM Roe (moreram): a cluster of glossy fish eggs (each with a tiny eye spot and a highlight) sitting on a RAM
// stick: green PCB, black memory chips with white labels and a row of gold contacts.
function moreram(m, a, ph) {
  const pal = palette(m);
  const c1 = a.color || '#3ab85a', c2 = a.color2 || '#ffd84a';
  const C = {
    pcb: pal(c1, { jitter: 0.04 }), pcbD: pal(shade(c1, -0.3)), gold: pal(c2, METAL), chip: pal('#1c1e26', { spec: 0.8, specPow: 12 }), label: pal('#e8eef8'),
    egg: pal('#ff9a3a', { spec: 1, specPow: 5, smooth: 1, emissive: 0.2 }), egg2: pal('#ffb85a', { spec: 1, specPow: 5, smooth: 1, emissive: 0.2 }),
    yolk: pal('#ff6a1a', { spec: 0.8, smooth: 1, emissive: 0.15 }), spot: pal('#1a1020'), hi: pal('#ffffff', { emissive: 0.6 }),
  };
  // stick lying flat, slightly raised
  m.box(2, 0, 9, 45, 1, 19, (x, y, z) => (z === 9 ? C.pcbD : C.pcb));
  for (let x = 3; x <= 44; x += 2) m.box(x, 0, 19, x, 1, 20, C.gold);
  m.box(22, 0, 19, 23, 1, 20, 0);
  for (let k = 0; k < 4; k++) { const x = 4 + k * 10.5; m.box(x, 2, 11, x + 7, 3, 17, C.chip); m.box(x + 2, 4, 13, x + 5, 4, 14, C.label); }
  // the roe cluster
  const eggs = [[14, 7, 14, 3.4], [20, 7.5, 13, 3.6], [26, 7, 15, 3.3], [17, 12.5, 14, 3.2], [23, 12.4, 14.5, 3.3], [31, 6.6, 13, 3], [20, 17, 14, 3], [9, 6.6, 15, 2.8], [28, 11.6, 12, 2.8]];
  eggs.forEach(([x, y, z, r], i) => {
    const bob = Math.sin(ph * TAU + i) * 0.3;
    m.sphere(x, y + bob, z, r, i % 3 === 0 ? C.egg2 : C.egg);
    m.sphere(x + 0.4, y + bob - 0.4, z + 0.8, r * 0.45, C.yolk);
    m.set(x + r * 0.2, y + bob - r * 0.1, z + r * 0.95, C.spot);
    m.set(x - r * 0.4, y + bob + r * 0.5, z + r * 0.7, C.hi);
  });
  tierFx(m, pal, a);
}

// NotAWorm.exe (notavirus): a worm in an unconvincing disguise: thick glasses, a big pink nose and a bushy moustache,
// waving a fake red crab claw on its tail.
function notavirus(m, a, ph) {
  const c1 = a.color || '#6ad84a', c2 = a.color2 || '#ff5a5a';
  worm(m, a, ph, {
    body: c1, glow: 0.08, clit: mix(c1, c2, 0.5), noTier: true,
    after: (mm, pal, P) => {
      const h = P[P.length - 1];
      const K = pal('#16121e', { spec: 1, specPow: 8 }), lens = pal('#cfefff', { spec: 1, emissive: 0.3 }), nose = pal('#ff9ab0', { spec: 1, specPow: 5, smooth: 1 });
      const stache = pal('#3a2418', { jitter: 0.1 }), claw = pal(c2, { ...GL }), clawD = pal(shade(c2, -0.3), { ...GL });
      const hx = h[0] + 1.5, hy = h[1] + 1, hz = h[2];
      // glasses: two thick frames facing the viewer, bridge and arms
      for (const s of [-1, 1]) {
        const ex = hx + 0.6, ez = hz + s * 1.6;
        for (let i = 0; i < 16; i++) { const ang = (i / 16) * TAU; mm.set(ex + 1.6, hy + 1.2 + Math.sin(ang) * 1.6, ez + Math.cos(ang) * 1.6, K); }
        mm.set(ex + 1.6, hy + 1.2, ez, lens); mm.set(ex + 1.6, hy + 2, ez, lens); mm.set(ex + 1.6, hy + 1.2, ez + 0.8 * s, lens);
        mm.line(ex + 1.6, hy + 2.6, ez + s * 1.6, ex - 2, hy + 2.4, ez + s * 2.6, K);
      }
      // nose + moustache
      mm.sphere(hx + 3, hy - 0.6, hz, 1.5, nose);
      for (let i = -4; i <= 4; i++) mm.line(hx + 2.6, hy - 1.8, hz + i * 0.5, hx + 2.6, hy - 2.6 - Math.abs(i) * 0.15, hz + i * 0.8, stache);
      // the fake crab claw on the tail
      const t0 = P[0], wave = Math.sin(ph * TAU) * 0.8;
      mm.line(t0[0], t0[1], t0[2], t0[0] - 3, t0[1] + 3 + wave, t0[2], clawD, 0.9);
      const cx = t0[0] - 4.5, cy = t0[1] + 6 + wave, cz = t0[2];
      mm.ellipsoid(cx, cy, cz, 2.6, 3.2, 2, claw);
      mm.line(cx - 1, cy + 2.6, cz, cx - 2.6, cy + 6, cz, claw, 1);
      mm.line(cx + 1, cy + 2.6, cz, cx + 1.6, cy + 5.2, cz, clawD, 0.9);
    },
  });
  tierFx(m, palette(m), a);
}

// generic grub (fallback for unknown lines)
function grub(m, a, ph) { notes(m, a, ph); }

// ---------------------------------------------------------------- registry
const D = (dims, yaw, pitch, build, anim = false) => ({ dims, yaw, pitch, build, anim });
export const BAIT_MODELS = {
  crumbs: D([44, 20, 28], 24, 26, crumbs),
  bread: D([48, 28, 32], 26, 24, bread),
  worm: D([48, 22, 28], -16, 22, worm, true),
  sugar: D([36, 28, 36], 34, 28, sugar),
  chip: D([44, 18, 44], 30, 34, chip),
  popup: D([44, 36, 16], 18, 14, popup),
  flood: D([36, 44, 32], 20, 16, flood),
  lantern: D([32, 46, 32], 22, 14, lantern),
  golden: D([46, 30, 22], -14, 14, golden),
  blackhole: D([48, 32, 48], 14, 11, blackhole),
  relic: D([34, 40, 18], 22, 12, relic),
  // flavour lines
  notes: D([44, 26, 28], -14, 20, notes, true),
  documents: D([48, 22, 30], -20, 26, documents, true),
  calculator: D([48, 28, 30], -24, 30, calculator, true),
  calendar: D([48, 24, 30], -22, 32, calendar, true),
  music: D([48, 26, 28], -14, 16, music, true),
  photos: D([48, 32, 28], -16, 20, photos, true),
  videos: D([48, 22, 28], -16, 24, videos, true),
  paint: D([48, 24, 28], -16, 22, paint, true),
  games: D([48, 30, 28], -20, 22, games, true),
  fishtop: D([44, 34, 28], -20, 18, fishtop, true),
  chat: D([48, 30, 26], -16, 18, chat, true),
  mail: D([46, 26, 26], -18, 22, mail, true),
  fishnet: D([48, 26, 28], -18, 22, fishnet, true),
  terminal: D([46, 20, 28], -20, 22, terminal, true),
  settings: D([48, 26, 28], -18, 20, settings, true),
  moreram: D([48, 22, 28], -16, 32, moreram, true),
  notavirus: D([48, 22, 28], -16, 22, notavirus, true),
  grub: D([44, 26, 28], -14, 20, grub, true),
};

export function modelKind(a) {
  if (!a) return 'crumbs';
  if (a.shape === 'grub') return BAIT_MODELS[a.line] ? a.line : 'grub';
  return BAIT_MODELS[a.shape] ? a.shape : 'grub';
}

export function modelFor(a, ph = 0, extraY = 0) {
  const kind = modelKind(a);
  const def = BAIT_MODELS[kind];
  const m = new VoxelModel(def.dims[0], def.dims[1] + extraY, def.dims[2]);
  def.build(m, a || {}, ((ph % 1) + 1) % 1);
  return { model: m, def, kind };
}
