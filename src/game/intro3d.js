// The 3D opening (phase 4, Intro agent): a Frutiger Aero fishing-game trailer, about 19 s, skippable with a
// glossy Skip pill (or Esc). No desktop premise: it is all about fishing.
//   1. Sweep  - fly in low over a glossy sunlit ocean toward the (OS)cean's green-hill island: rolling voxel hills,
//               white wind turbines, a lone round tree, the glass city in its water bubble, the green glass globe
//               floating in the sky, voxel clouds and gulls, sun rays, Aero arcs and a lens flare.
//   2. Swoop  - bank down to the bubble person on their boat (drawCharacter + boatmodels), who casts a line.
//   3. Plunge - follow the bobber under: a split-level shot through the glossy surface, a bubble curtain.
//   4. Under  - glide past schools of voxel fish (the fish renderer), rising bubbles, sun shafts, a candy reef.
//   5. Strike - a big fish rises out of the blue, charges the lure, strikes (flash, slow-mo) and surges up; it leaps
//               out of the water toward the camera in a huge splash, droplets hitting the lens.
//   6. Logo   - a glossy puffy-voxel FISHTOP logo blooms in over the sunny bay, with a sweeping lens flare.
//   7. Hand-off - rising bubbles dissolve into the live game (onHandoff prepares it, onDone ends the opening).
// The world is a true perspective camera (X right, Y DOWN with 0 = the sea surface, Z forward) along a keyframed
// spline; every object is a voxel model rendered once and drawn as a depth-sorted billboard; the sea, the sky and
// the underwater volume are painted per row from the camera, so the flight has real parallax. Only effects
// (light, water streaks, bubbles, splashes, flares) are 2D. Assets build progressively behind a white Aero bloom.
//
//   const intro = new Intro3D({W, H, input, audio, look, boat, music, onHandoff, onDone});
//   intro.update(dt); intro.draw(ctx);    intro.skip(); intro.seek(t); intro.resize(W, H); intro.skipRect()
//   intro.active (false once done), intro.t (timeline seconds), intro.ready (first assets built),
//   intro.opaque (covers the whole frame: the host may skip drawing the world underneath)

import { makeCanvas, ctxOf } from '../core/canvas.js';
import { rgba } from '../core/color.js';
import { clamp, clamp01, lerp, ease, hash2, fbm2, smoothstep, TAU } from '../core/math.js';
import { RNG } from '../core/rng.js';
import { VoxelModel, renderVoxels } from '../gfx/voxel.js';
import { Particles } from '../gfx/particles.js';
import * as AE from '../ui/aero.js';
import * as UIC from '../gfx/uiicons.js';
import * as CHAR from '../gfx/character.js';
import * as KIT from '../world/aerokit.js';
import * as GIANT from '../world/giants.js';
import * as CRIT from '../world/voxcritters.js';
import * as CORAL from '../world/coral.js';
import * as BM from '../world/boatmodels.js';
import * as RIG from '../gfx/fishrig.js';
import * as SC from '../gfx/spritecache.js';
import * as SPEC from '../fish/species.js';
import * as ART from '../gfx/fishart.js';

// ------------------------------------------------------------------------------------------------ timeline
export const INTRO_T = {
  sweep: 0,          // fly in over the glossy ocean toward the island
  swoop: 4.0,        // bank down to the boat
  cast: 5.5,         // the bubble person casts (the bobber leaves the rod ~0.4 s later)
  land: 6.75,        // the bobber splashes down
  plunge: 7.55,      // follow the line under (the camera crosses the surface ~7.9)
  under: 8.3,        // schools of fish, bubbles, sun shafts
  shadow: 10.3,      // a big fish rises out of the blue
  strike: 12.0,      // ... and strikes the lure
  surge: 12.55,      // it surges for the surface
  breach: 13.35,     // cut: it bursts out of the water toward the camera
  logo: 15.05,       // white flash -> the glossy FISHTOP logo over the bay
  flare: 15.8,
  out0: 18.0, out1: 19.2,
};
const T = INTRO_T;
const END = T.out1;

// ------------------------------------------------------------------------------------------------ the world
// World units ~ one boat voxel. X right, Y down (0 = the sea surface, negative = up), Z forward.
// The sun sits at infinity; each shot gets its own (cuts hide the cheat): [azimuth, elevation] in radians.
const SUNS = [[-0.2, 0.2], [-0.13, 0.3], [-0.2, 0.47]];
const BOAT = { x: 0, z: 1000 };
const LURE = { x: 150, y: 62, z: 1004 };      // where the lure sinks to (it lands at y = 0)
const ISLE = { x: -240, z: 3600, w: 2300 };
const GLOBE = { x: 1960, y: -760, z: 4300, r: 280 };
const SEABED = 300;
const FISH_LEN = 96;                          // the big fish, world units
const EXIT = { x: 150, z: 1000 };             // where it breaks the surface
const DOWN = { x: 50, z: 920 };               // ... and where its arc comes back down
const SPLASH2 = { x: 170, z: 1240 };          // the splash still settling in the logo shot

// Camera keys: [t, x, y, z, pitch (deg, + looks down), roll (deg)]. Three shots: the flight, the leap, the logo.
const SHOTS = [
  { t0: 0, t1: T.breach, keys: [
    [0.0, -200, -430, -1700, 9, 0],
    [2.0, -130, -300, -520, 8.5, -1.5],
    [4.0, -50, -150, 430, 7, -3.5],
    [5.0, -30, -62, 770, 5, -3],
    [5.8, -14, -32, 868, 4, -1],
    [6.5, 48, -25, 882, 6, 1],
    [7.2, 118, -15, 890, 8, 0.5],
    [7.6, 140, -6, 895, 8, 0],
    [7.95, 148, 6, 898, 3, 0],
    [8.6, 150, 34, 900, 0, 0],
    [10.3, 152, 54, 908, 0.5, 0],
    [12.0, 174, 64, 940, 2, 0],
    [12.55, 166, 70, 918, -14, 1.5],
    [13.35, 156, 52, 900, -30, 0],
  ] },
  { t0: T.breach, t1: T.logo, keys: [
    [T.breach, 108, -11, 826, -3.5, 0],
    [T.logo, 112, -14, 836, -4.5, 0],
  ] },
  { t0: T.logo, t1: 99, keys: [
    [T.logo, -24, -40, 772, -6, 0],
    [END, -12, -46, 812, -6.5, 0],
  ] },
];

// ------------------------------------------------------------------------------------------------ helpers
const inv = (a, b, t) => clamp01((t - a) / (b - a));
const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const DEG = Math.PI / 180;

function vgrad(g, y0, y1, stops) {
  const gr = g.createLinearGradient(0, y0, 0, y1);
  for (const [k, c] of stops) gr.addColorStop(clamp01(k), c);
  return gr;
}

// Hermite spline through keyed rows (finite-difference tangents) -> the row at time t.
function spline(keys, t) {
  if (t <= keys[0][0]) return keys[0].slice(1);
  const n = keys.length;
  if (t >= keys[n - 1][0]) return keys[n - 1].slice(1);
  let i = 0;
  while (i < n - 2 && t > keys[i + 1][0]) i++;
  const a = keys[i], b = keys[i + 1];
  const h = b[0] - a[0], s = (t - a[0]) / h;
  const s2 = s * s, s3 = s2 * s;
  const h00 = 2 * s3 - 3 * s2 + 1, h10 = s3 - 2 * s2 + s, h01 = -2 * s3 + 3 * s2, h11 = s3 - s2;
  const tan = (k, j) => {
    const p = keys[Math.max(0, k - 1)], q = keys[Math.min(n - 1, k + 1)];
    return q[0] === p[0] ? 0 : (q[j] - p[j]) / (q[0] - p[0]);
  };
  const out = [];
  for (let j = 1; j < a.length; j++) out.push(h00 * a[j] + h10 * h * tan(i, j) + h01 * b[j] + h11 * h * tan(i + 1, j));
  return out;
}

// Oriented ellipsoid (axes = unit vectors in model space), colour = index or fn(u, v, w) -> index.
function blob(m, cx, cy, cz, ax, ay, az, rx, ry, rz, col) {
  const R = Math.max(rx, ry, rz) + 1;
  for (let z = Math.floor(cz - R); z <= Math.ceil(cz + R); z++) for (let y = Math.floor(cy - R); y <= Math.ceil(cy + R); y++) for (let x = Math.floor(cx - R); x <= Math.ceil(cx + R); x++) {
    const dx = x + 0.5 - cx, dy = y + 0.5 - cy, dz = z + 0.5 - cz;
    const u = (dx * ax[0] + dy * ax[1] + dz * ax[2]) / rx, v = (dx * ay[0] + dy * ay[1] + dz * ay[2]) / ry, w = (dx * az[0] + dy * az[1] + dz * az[2]) / rz;
    if (u * u + v * v + w * w <= 1) { const c = typeof col === 'function' ? col(u, v, w) : col; if (c) m.set(x, y, z, c); }
  }
}

// A glossy leaf: length along `dir`, width across, thin; tone ramp from base to tip, a light midrib.
function leaf(m, base, dir, len, wid, pal, droop = 0.25) {
  dir = norm(dir);
  let side = cross(dir, [0, 1, 0]);
  side = Math.hypot(...side) < 0.2 ? [1, 0, 0] : norm(side);
  const up = norm(cross(side, dir));
  const segs = 3;
  for (let i = 0; i < segs; i++) {
    const km = (i + 0.5) / segs;
    const d = norm([dir[0], dir[1] - droop * km * 1.6, dir[2]]);
    const c = [base[0] + dir[0] * len * km, base[1] + (dir[1] - droop * km) * len * km, base[2] + dir[2] * len * km];
    const wk = Math.sin(Math.PI * (0.15 + km * 0.8)) * wid;
    blob(m, c[0], c[1], c[2], d, side, up, (len / segs) * 0.75, Math.max(1.2, wk), 1.15, (u, v) => {
      if (Math.abs(v) < 0.14) return pal[3];
      const t = clamp01(km + u * 0.15 + (v > 0 ? 0.12 : 0));
      return pal[Math.min(2, Math.floor(t * 3))];
    });
  }
}

function catmull(pts, n = 6) {
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    for (let k = 0; k < n; k++) {
      const t = k / n, t2 = t * t, t3 = t2 * t;
      out.push([0, 1].map((j) => 0.5 * (2 * p1[j] + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2 + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t3)));
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy || 1;
  const t = clamp01(((px - ax) * dx + (py - ay) * dy) / l2);
  return Math.hypot(px - ax - dx * t, py - ay - dy * t);
}

// A copy of a sprite washed toward a colour (fog), cached per quantised amount.
const FOG = new Map();
function fogged(src, color, a) {
  const q = Math.round(clamp01(a) * 10) / 10;
  if (q <= 0) return src;
  let m = FOG.get(src);
  if (!m) { FOG.set(src, (m = new Map())); if (FOG.size > 200) FOG.delete(FOG.keys().next().value); }
  const key = color + q;
  let c = m.get(key);
  if (!c) {
    c = makeCanvas(src.width, src.height);
    const g = ctxOf(c);
    g.drawImage(src, 0, 0);
    g.globalCompositeOperation = 'source-atop';
    g.globalAlpha = q;
    g.fillStyle = color;
    g.fillRect(0, 0, c.width, c.height);
    m.set(key, c);
  }
  return c;
}

// A vertically mirrored copy of a sprite, washed toward the water and fading away from the mirror line.
function mirrorFade(src, wash, a0) {
  const c = makeCanvas(src.width, src.height), g = ctxOf(c);
  g.save(); g.scale(1, -1); g.drawImage(src, 0, -src.height); g.restore();
  g.globalCompositeOperation = 'source-atop';
  g.fillStyle = wash; g.fillRect(0, 0, c.width, c.height);
  g.globalCompositeOperation = 'destination-in';
  g.fillStyle = vgrad(g, 0, c.height, [[0, `rgba(0,0,0,${a0})`], [1, 'rgba(0,0,0,0)']]);
  g.fillRect(0, 0, c.width, c.height);
  return c;
}

// ------------------------------------------------------------------------------------------- voxel models
// The (OS)cean island: a smooth rolling green hill (the big glossy hill to the right, a shoulder on the left, a
// meadow sloping to a white beach), foam at the shore, flowers in the grass. Returns {m, h(x, z) top height}.
function islandModel(NX, NY, NZ) {
  const m = new VoxelModel(NX, NY, NZ);
  const C = (c, o = {}) => m.color(c, { jitter: 0.03, ...o });
  const G = ['#1f8a34', '#2ea83c', '#46c244', '#6ad84e', '#9cec64', '#c8f88a'].map((c, i) => C(c, { spec: 0.3 + i * 0.07, specPow: 12, smooth: 0.7 }));
  const sheen = C('#eaffc4', { spec: 0.9, specPow: 9, smooth: 0.85 });
  const sand = C('#fff3d2', { spec: 0.3, smooth: 0.5 }), sandD = C('#ecd9a8', { smooth: 0.4 });
  const foam = C('#ffffff', { spec: 0.6, smooth: 0.6 }), wet = C('#8fe6f2', { spec: 0.8, smooth: 0.8 });
  const fl = [C('#ffffff'), C('#ffe23a'), C('#ff8ad0'), C('#8ad8ff')];
  const cx = NX * 0.5, cz = NZ * 0.56;
  const hill = (x, z) => {
    const X = x / NX, Z = z / NZ;
    let h = 1.0 * Math.exp(-(((X - 0.6) / 0.27) ** 2) - (((Z - 0.42) / 0.4) ** 2));
    h += 0.5 * Math.exp(-(((X - 0.24) / 0.17) ** 2) - (((Z - 0.5) / 0.34) ** 2));
    h += 0.16 * Math.exp(-(((X - 0.86) / 0.1) ** 2) - (((Z - 0.4) / 0.3) ** 2));
    h += 0.04 * Math.sin(X * 17 + Z * 4) * smoothstep(0.2, 0.8, Z);
    return h;
  };
  const H = new Float32Array(NX * NZ);
  for (let z = 0; z < NZ; z++) for (let x = 0; x < NX; x++) {
    const dx = (x + 0.5 - cx) / (NX * 0.5), dz = (z + 0.5 - cz) / (NZ * 0.46);
    const wob = (fbm2(x * 0.05, z * 0.09, 2, 7) - 0.5) * 0.18;
    const r = Math.hypot(dx, dz) + wob;
    if (r > 1) { H[z * NX + x] = -1; continue; }
    const coast = smoothstep(1, 0.8, r);
    H[z * NX + x] = 1.5 + coast * hill(x, z) * (NY - 6) + coast * 1.5;
  }
  const at = (x, z) => (x < 0 || z < 0 || x >= NX || z >= NZ ? -1 : H[z * NX + x]);
  for (let z = 0; z < NZ; z++) for (let x = 0; x < NX; x++) {
    const h = at(x, z);
    if (h < 0) continue;
    const top = Math.max(1, Math.round(h));
    const nx = at(x + 1, z) - at(x - 1, z), nz = at(x, z + 1) - at(x, z - 1);
    const lit = clamp01(0.55 - nx * 0.09 + nz * 0.05);
    const shore = top <= 3;
    for (let y = 0; y < top; y++) {
      let c;
      if (shore) c = y === 0 ? wet : y === top - 1 ? sand : sandD;
      else if (y < 2) c = y === 0 ? wet : sand;
      else {
        const k = clamp01(y / (NY - 6));
        c = G[clamp(Math.round(k * 3 + lit * 2.2 + (fbm2(x * 0.11, z * 0.13, 2, 3) - 0.5) * 1.6), 0, 5)];
        if (y === top - 1) {
          if (lit > 0.62 && k > 0.35 && hash2(x >> 1, z >> 1, 4) < 0.6) c = sheen;
          const f = hash2(x, z, 9);
          if (f < 0.022 && k < 0.7) c = fl[Math.floor(hash2(z, x, 2) * 4)];
        }
      }
      m.set(x, y, z, c);
    }
    // a ring of foam around the beach
    if (shore && (at(x + 2, z) < 0 || at(x - 2, z) < 0 || at(x, z + 2) < 0 || at(x, z - 2) < 0)) m.set(x, 0, z, foam);
  }
  return { m, h: (x, z) => Math.max(0, at(Math.round(x), Math.round(z))) };
}

// The red-and-white bobber (a glossy ball with an antenna) and the chrome lure with its hook.
function bobberModel() {
  const m = new VoxelModel(13, 18, 13);
  const red = m.color('#ff3a3a', { spec: 0.9, specPow: 18, smooth: 1 }), white = m.color('#ffffff', { spec: 0.9, specPow: 18, smooth: 1 });
  const stick = m.color('#ffd23a', { emissive: 0.4 });
  m.sphere(6.5, 6.5, 6.5, 5.6, (x, y) => (y >= 6 ? white : red));
  m.box(6, 12, 6, 6, 16, 6, stick);
  return m;
}

function lureModel() {
  const m = new VoxelModel(26, 12, 10);
  const chrome = ['#4a7a9a', '#8ac8e8', '#e8fbff'].map((c) => m.color(c, { spec: 1.1, specPow: 22, smooth: 1, jitter: 0.01 }));
  const aqua = m.color('#2fe0f0', { spec: 1, specPow: 16, smooth: 1, emissive: 0.25 });
  const hook = m.color('#c8d4e0', { spec: 1, specPow: 26 }), ring = m.color('#ffd23a', { spec: 0.8 });
  // a curved spoon body
  blob(m, 13, 6, 5, norm([1, 0.12, 0]), [0, 1, 0], [0, 0, 1], 8, 3.6, 1.6, (u, v) => chrome[v > 0.3 ? 2 : v > -0.3 ? 1 : 0]);
  m.sphere(4.2, 6.5, 5, 1.6, aqua);
  m.box(1, 6, 5, 2, 7, 5, ring);
  // treble hook at the tail
  m.line(21, 5, 5, 24, 5, 5, hook);
  m.line(24, 5, 5, 24, 2, 5, hook);
  m.line(24, 2, 5, 22.5, 3.2, 5, hook);
  m.line(21, 5, 5, 24, 4, 7, hook);
  return m;
}

// Glossy leafy branch for framing the logo shot.
function branchModel(seed, nLeaves = 12) {
  const r = new RNG(seed);
  const m = new VoxelModel(120, 80, 30);
  const twig = m.color('#4a8a2a', { smooth: 0.5 });
  const pal = ['#2c9a2a', '#56c83a', '#9be85a', '#e2ffb0'].map((c, i) => m.color(c, { spec: i < 3 ? 0.55 : 0.2, specPow: 18, smooth: 0.7, jitter: 0.04, edge: 0.7 }));
  let px = 118, py = 10, pz = 15;
  for (let i = 0; i < nLeaves; i++) {
    const nx = px - r.float(6, 11), ny = py + r.float(1, 6), nz = 15 + r.float(-4, 4);
    m.line(px, py, pz, nx, ny, nz, twig, 0.9);
    const s = i % 2 ? 1 : -1;
    const a = s * r.float(0.5, 1.1);
    leaf(m, [nx, ny, nz], [-Math.cos(a) * 0.6, Math.sin(a) + 0.35, r.float(-0.3, 0.3)], r.float(20, 28), r.float(10, 13), pal, r.float(0.1, 0.3));
    px = nx; py = ny; pz = nz;
  }
  return m;
}

// Puffy glossy voxel letters: each glyph is a set of strokes in a 0..1 box, inflated around the stroke.
const GLYPHS = {
  F: { w: 0.6, s: [[[0, 0], [0, 1]], [[0, 0], [0.92, 0]], [[0, 0.47], [0.74, 0.47]]] },
  I: { w: 0.0, s: [[[0, 0], [0, 1]]] },
  S: { w: 0.66, curve: true, s: [[[0.98, 0.1], [0.62, -0.02], [0.2, 0.02], [0.02, 0.24], [0.2, 0.46], [0.8, 0.56], [1, 0.78], [0.82, 1.0], [0.36, 1.03], [0.0, 0.9]]] },
  H: { w: 0.66, s: [[[0, 0], [0, 1]], [[1, 0], [1, 1]], [[0, 0.5], [1, 0.5]]] },
  T: { w: 0.72, s: [[[0, 0], [1, 0]], [[0.5, 0], [0.5, 1]]] },
  O: { w: 0.78, ring: true },
  P: { w: 0.6, curve: true, s: [[[0, 1.0], [0, 0]], [[0, 0], [0.55, 0], [0.98, 0.12], [1.0, 0.36], [0.6, 0.52], [0, 0.52]]] },
};

function logoModel() {
  const word = 'FISHTOP';
  const LH = 36, R = 4.4, GAP = R * 2 + 4, PAD = Math.ceil(R) + 2;
  let width = PAD * 2;
  for (const ch of word) width += GLYPHS[ch].w * LH + GAP;
  width -= GAP;
  const nz = Math.ceil(R * 2) + 3;
  const m = new VoxelModel(Math.ceil(width), LH + PAD * 2, nz);
  const blue = ['#0a4fa8', '#1676d8', '#2a9cf0', '#4cc4fa', '#8ae4ff', '#d4f8ff'];
  const green = ['#1f7a12', '#2f9a1c', '#4cbc2a', '#7ad83c', '#b4ee6a', '#e8ffb8'];
  const opts = { spec: 0.45, specPow: 9, smooth: 1, jitter: 0.01, edge: 0.2, aoMul: 0.4 };
  const PB = blue.map((c) => m.color(c, opts)), PG = green.map((c) => m.color(c, opts));
  let ox = PAD;
  const zc = nz / 2;
  word.split('').forEach((ch, li) => {
    const G = GLYPHS[ch];
    const gw = G.w * LH;
    const pal = li < 4 ? PB : PG;
    const segs = [];
    if (G.ring) {
      const pts = [];
      for (let i = 0; i <= 32; i++) { const a = (i / 32) * TAU; pts.push([0.5 + Math.cos(a) * 0.5, 0.5 + Math.sin(a) * 0.5]); }
      for (let i = 0; i < pts.length - 1; i++) segs.push([pts[i], pts[i + 1]]);
    } else {
      for (const s of G.s) {
        const pts = G.curve && s.length > 2 ? catmull(s, 6) : s;
        for (let i = 0; i < pts.length - 1; i++) segs.push([pts[i], pts[i + 1]]);
      }
    }
    const sx = (u) => ox + u * gw, sy = (v) => PAD + v * LH;
    const x0 = Math.floor(ox - R - 1), x1 = Math.ceil(ox + gw + R + 1);
    for (let y = 0; y < m.ny; y++) for (let x = x0; x <= x1; x++) {
      const px = x + 0.5, py = y + 0.5;
      let d = 1e9;
      for (const [a, b] of segs) d = Math.min(d, segDist(px, py, sx(a[0]), sy(a[1]), sx(b[0]), sy(b[1])));
      if (d > R) continue;
      const h = R * Math.cbrt(1 - (d / R) ** 3) * 0.85;
      const my = m.ny - 1 - y; // model y is up: glyph v = 0 is the top
      const k = clamp01((my - PAD * 0.5) / (LH + PAD));
      const ci = clamp(Math.round(k * (pal.length - 1) + (d / R) * -0.6 + 0.4), 0, pal.length - 1);
      for (let z = Math.floor(zc - h); z <= Math.ceil(zc + h) - 1; z++) m.set(x, my, z, pal[ci]);
    }
    ox += gw + GAP;
  });
  return m;
}

// Fish used by the opening, in order of preference (ids from fish/species.js; the first that exists wins).
const SCHOOL_IDS = ['zebrafish', 'pixel', 'loafer', 'cookie', 'googly'];
const MID_IDS = ['grouper', 'bubblepuff', 'sneakerhead', 'koi'];
const BIG_IDS = ['gottagofast', 'koi', 'dragonkarp', 'grouper'];

// ================================================================================================= Intro3D
export class Intro3D {
  constructor(o = {}) {
    this.o = o;
    this.input = o.input || null;
    this.audio = o.audio || null;
    this.look = o.look || null;
    this.active = true;
    this.ready = false;
    this.t = 0;
    this.bootT = 0;
    this.skipT = -1;
    this.handed = false;
    this.cues = new Set();
    this.fx = new Particles(900);
    this.rng = new RNG(4242);
    this.A = {};
    this.fish = null;
    this.lens = [];
    this.resize(o.W || 960, o.H || 540);
  }

  // True while the opening fully covers the frame (the host may skip drawing the world underneath).
  get opaque() { return this.active && this.skipT < 0 && (!this.ready || this.t < T.out0 + 0.3); }

  resize(W, H) {
    W = Math.max(64, Math.round(W)); H = Math.max(64, Math.round(H));
    if (W === this.W && H === this.H) return;
    this.W = W; this.H = H;
    this.u = H / 540;
    this.F = H * 0.95;
    this.layer = null;
    this.vig = null;
    this.ready = false;
    this.A = {};
    this.tasks = this.buildTasks();
    this.bubbles3 = this.spawnBubbles();
  }

  // ---------------------------------------------------------------------------------- progressive assets
  // Each task: {need: timeline seconds by which it must exist, fn: () => 'again' | undefined}.
  buildTasks() {
    const out = [];
    const add = (need, fn) => out.push({ need, fn });
    // the heavy one-off renders happen behind the boot bloom; light warmers trickle in while it plays
    add(0, () => this.buildIsland());
    add(0, () => this.buildIslandProps());
    add(0, () => this.buildSky());
    add(0, () => { this.globe = new KIT.GlassGlobe(Math.round(GLOBE.r * this.globeRes()), 24, 4); this.globe.frame(0); });
    add(0, () => this.buildBoat());
    add(0, () => this.buildLures());
    add(0, () => this.buildFish());
    add(0, () => this.buildSeabed());
    add(0, () => this.buildLogo());
    add(0, () => this.buildBranches());
    add(1.2, () => { try { this.dolphin = this.dolphin || new GIANT.VoxelGiant('dolphin'); this.dolphin.warm(); return this.dolphin.frames.includes(null) ? 'again' : undefined; } catch (e) { this.dolphin = null; return undefined; } });
    add(3.5, () => this.warmCharacter());
    add(30, () => { if (!this.globe) return undefined; this.globe.warm(); return this.globe.frames.includes(null) ? 'again' : undefined; });
    return out;
  }

  runTasks(budgetMs, horizon = 0.5) {
    const t0 = performance.now();
    let i = 0;
    while (i < this.tasks.length) {
      const job = this.tasks[i];
      const due = job.need <= horizon;
      if (performance.now() - t0 > (due ? budgetMs * 2 : budgetMs)) break;
      let again = false;
      try { again = job.fn() === 'again'; } catch (e) { console.warn('intro asset', e); }
      if (!again) this.tasks.splice(i, 1);
      else if (performance.now() - t0 > (due ? Math.max(budgetMs, 30) : budgetMs)) break;
    }
    if (!this.tasks.some((j) => j.need <= 0.5)) this.ready = true;
  }

  // px per world unit at which the sky objects (globe) are built: their size in the logo shot
  globeRes() { return this.F / (GLOBE.z - SHOTS[2].keys[0][3]); }

  buildIsland() {
    const NX = 250, NY = 46, NZ = 96;
    const { m, h } = islandModel(NX, NY, NZ);
    const vu = ISLE.w / NX;
    const want = (this.F / (ISLE.z - SHOTS[2].keys[0][3])) * vu; // px per voxel in the logo shot
    const scale = clamp(Math.round(want * 4) / 4, 1, 4);
    const r = renderVoxels(m, { scale, yaw: 0, pitch: 9, outline: true, ao: 0.85, edges: 0.45, depthLines: false, light: { top: 5.2, lit: 4, dark: 2.5, bottom: 1.4 } });
    const [ax, ay] = r.project(NX / 2, 0, NZ * 0.56);
    const res = scale / vu;
    // the island reflected in the glossy sea: flipped, washed toward the water, fading out
    const ref = makeCanvas(r.w, Math.round(r.h * 0.6));
    const rg = ctxOf(ref);
    rg.save();
    rg.scale(1, -1);
    rg.drawImage(r.canvas, 0, -Math.round(ay) - 1);
    rg.restore();
    rg.globalCompositeOperation = 'source-atop';
    rg.fillStyle = 'rgba(70,190,250,0.55)';
    rg.fillRect(0, 0, ref.width, ref.height);
    rg.globalCompositeOperation = 'destination-in';
    rg.fillStyle = vgrad(rg, 0, ref.height, [[0, 'rgba(0,0,0,0.55)'], [0.5, 'rgba(0,0,0,0.18)'], [1, 'rgba(0,0,0,0)']]);
    rg.fillRect(0, 0, ref.width, ref.height);
    this.A.isle = { canvas: r.canvas, ax, ay, res, ref, r, h, vu, NX, NZ };
  }

  // A spot on the island surface (model x, z fractions) -> world [X, Y, Z] just in front of the island card.
  islePoint(xf, zf) {
    const I = this.A.isle;
    if (!I) return null;
    const x = xf * I.NX, z = zf * I.NZ;
    const [px, py] = I.r.project(x, I.h(x, z), z);
    return [ISLE.x + (px - I.ax) / I.res, (py - I.ay) / I.res, ISLE.z - 1 - zf * 2];
  }

  buildIslandProps() {
    const P = (this.A.props = []);
    const I = this.A.isle;
    if (!I) return;
    const vs = clamp(Math.round(I.res * 5 * 4) / 4, 1, 3); // props: px per voxel
    // white wind turbines along the hills (towers baked, rotors spin live)
    for (const [xf, zf, h] of [[0.68, 0.34, 64], [0.77, 0.42, 58], [0.86, 0.5, 52], [0.36, 0.38, 56], [0.45, 0.6, 46]]) {
      const pt = this.islePoint(xf, zf);
      if (!pt) continue;
      const tw = KIT.turbineTower(h, vs);
      const rot = KIT.rotorFrames(Math.round(h * 0.42), vs, 12);
      const unit = 3.9; // world units per turbine voxel
      P.push({ kind: 'turbine', x: pt[0], y: pt[1] + 4, z: pt[2] - 0.5, spr: tw, res: vs / unit, rot, ph: xf * 7 });
    }
    // the lone round tree near the top of the big hill
    { const pt = this.islePoint(0.565, 0.4); const tr = KIT.roundTree(vs, 5); if (pt && tr) P.push({ kind: 'sprite', x: pt[0], y: pt[1] + 3, z: pt[2] - 0.2, spr: tr, res: vs / 5.2 }); }
    // the glass city in its water bubble, on the left shoulder
    {
      const pt = this.islePoint(0.18, 0.5);
      const city = KIT.glassCity(3, vs);
      if (pt && city) {
        const res = vs / 5.2;
        const R = Math.round((city.w * 0.62) / res * res);
        const bub = KIT.voxWaterBubble ? KIT.voxWaterBubble(Math.round(city.w * 0.66)) : null;
        P.push({ kind: 'city', x: pt[0], y: pt[1] + 5, z: pt[2] - 0.6, spr: city, res, bub, R });
      }
    }
  }

  buildSky() {
    const S = (this.A.sky = { clouds: [], gulls: null });
    const r = new RNG(77);
    for (let i = 0; i < 9; i++) {
      const w = r.int(90, 170), h = Math.round(w * r.float(0.3, 0.42));
      let spr = null;
      try { spr = CRIT.voxCloudSprite(20 + i, w, h); } catch (e) { spr = null; }
      if (!spr) continue;
      S.clouds.push({ spr, x: r.float(-9000, 9000), y: -r.float(900, 3400), z: r.float(9000, 15000), res: 0.75 / r.float(9, 14) });
    }
    try { S.gulls = CRIT.gullFrames('#ffffff'); } catch (e) { S.gulls = null; }
  }

  boatScale() { return clamp(Math.round((this.F / 130) * 0.5 * 4) / 4, 1, 3); }

  buildBoat() {
    const st = this.o.boat || {};
    const bs = this.boatScale();
    let pv = null;
    try { pv = BM.renderBoatPreview(st.tier | 0, st.parts || null, { scale: bs }); } catch (e) { pv = null; }
    if (!pv) { try { pv = BM.renderBoatPreview(0, null, { scale: bs }); } catch (e) { pv = null; } }
    this.A.boat = pv ? { pv, res: 2 * bs, bs } : null;
  }

  charScale() { return 0.62 * this.boatScale(); }

  // The opening may start before the character's frames exist: build them under a small per-frame budget.
  warmCharacter() {
    if (typeof CHAR.warmCharacter !== 'function') return undefined;
    this.warmN = (this.warmN || 0) + 1;
    let done = true;
    try { done = CHAR.warmCharacter(this.look, { poses: ['idle', 'cast', 'cheer', 'reel'], scale: this.charScale(), facing: 1, ms: 12 }); } catch (e) { done = true; }
    return !done && this.warmN < 200 ? 'again' : undefined;
  }

  buildLures() {
    const b = renderVoxels(bobberModel(), { scale: 2, yaw: 20, pitch: 14, outline: true, ao: 0.5 });
    this.A.bobber = { canvas: b.canvas, ax: b.project(6.5, 0, 6.5)[0], ay: b.project(6.5, 6.5, 6.5)[1], res: 2 / 0.42 };
    const l = renderVoxels(lureModel(), { scale: 3, yaw: 18, pitch: 10, outline: true, ao: 0.5 });
    const [lx, ly] = l.project(1.5, 6.5, 5);
    this.A.lure = { canvas: l.canvas, ax: lx, ay: ly, res: 3 / 0.42 };
  }

  // The underwater floor: candy reefs, glossy orbs and turbines scattered on a grid (world-anchored).
  buildSeabed() {
    const S = (this.A.seabed = { reefs: [], orbs: [] });
    for (let i = 0; i < 6; i++) {
      try { S.reefs.push(CORAL.reefSprite(410 + i, 'oscean', { w: 86 + (i % 3) * 14, h: 56 + (i % 2) * 10, d: 34 }, 1, i % 2 === 1)); } catch (e) { /* the coral kit is optional */ }
    }
    for (const [r, c] of [[7, '#7fdcff'], [5, '#8af0a8'], [6, '#ffffff'], [4, '#ffd27a']]) {
      try { S.orbs.push(CRIT.voxBall(r, c, { spec: 0.95 })); } catch (e) { /* optional */ }
    }
    try { S.turbine = KIT.turbineTower(60, 2); S.rot = KIT.rotorFrames(25, 2, 12); } catch (e) { S.turbine = null; }
  }

  // Fish: compiled looks, their size at scale 1 and the fixed scale their voxel frames are built at.
  buildFish() {
    const pick = (ids) => { for (const id of ids) { const sp = SPEC.SPECIES_BY_ID?.[id]; if (sp) return sp; } return SPEC.SPECIES?.[0] || null; };
    const make = (sp, len, sMax) => {
      if (!sp) return null;
      try {
        const c = SC.compiled(sp.look, null, sp.id);
        const g = ART.rigGeom(c, { sw: 0, angle: 0, scale: 1, inflate: 0, still: true });
        const gw = Math.max(8, g.w || 30);
        const S0 = clamp((len * sMax) / gw, 0.2, 8);
        return { sp, c, gw, len, S0 };
      } catch (e) { console.warn('intro fish', e); return null; }
    };
    const s = this.F;
    const school = [];
    for (const id of SCHOOL_IDS) { const sp = SPEC.SPECIES_BY_ID?.[id]; if (sp && school.length < 2) school.push(make(sp, 22, s / 110)); }
    this.fish = {
      school: school.filter(Boolean),
      mid: make(pick(MID_IDS), 50, s / 100),
      big: make(pick(BIG_IDS), FISH_LEN, s / 150),
    };
    this.buildSchools();
  }

  // Touch the voxel frames the opening will show (a few per frame, drawn off-screen): the fish renderer queues
  // and builds them under its own per-frame budget, so they exist before the camera goes under.
  touchFish() {
    const F = this.fish;
    if (!F || typeof RIG.drawFishRig !== 'function') return;
    if (!this.warmQ) {
      this.warmQ = [];
      const add = (f, st) => { if (f) for (let i = 0; i < 6; i++) this.warmQ.push([f, { ...st, swimPhase: i / 6, tailPhase: i / 6 }]); };
      for (const f of F.school) { add(f, { facing: 1 }); add(f, { facing: -1 }); }
      add(F.mid, { facing: -1 });
      add(F.big, { facing: -1, heading: -48 });
      add(F.big, { facing: -1, heading: -20 });
      add(F.big, { facing: -1, heading: 0 });
      this.warmI = 0;
    }
    const scratch = this.scratch || (this.scratch = ctxOf(makeCanvas(4, 4)));
    for (let n = 0; n < 3 && this.warmQ.length; n++) {
      const [f, st] = this.warmQ[this.warmI++ % this.warmQ.length];
      try { RIG.drawFishRig(scratch, f.c, { x: 2, y: 2, scale: f.S0, turn: st.facing, angle: 0, speed01: 0.5, time: 0, emotion: 'neutral', pri: 3, ...st }); } catch (e) { /* the fish renderer may be mid-rework */ }
    }
  }

  buildLogo() {
    const m = logoModel();
    const want = (this.W * 0.56) / m.nx;
    const r = renderVoxels(m, { scale: Math.max(1, Math.round(want * 4) / 4), yaw: -5, pitch: 10, outline: false, depthLines: false, ao: 0.5, edges: 0.25, light: { top: 3.5, lit: 3.2, dark: 2.3, bottom: 1.7 } });
    this.A.logo = this.finishLogo(r.canvas);
  }

  buildBranches() {
    const px = (make, scale, o) => { const r = renderVoxels(make(), { scale: Math.max(1, Math.round(scale * 2 * 4) / 4), outline: true, ao: 0.7, ...o }); return { canvas: r.canvas, ss: 2 }; };
    this.A.branch = px(() => branchModel(4, 11), (this.H * 0.46) / 80, { yaw: -8, pitch: 12 });
    this.A.branch2 = px(() => branchModel(11, 7), (this.H * 0.34) / 80, { yaw: 12, pitch: 18 });
  }

  // Post-process the logo: white outline, deep drop shadow and a top gloss band.
  finishLogo(src) {
    const p = 8;
    const w = src.width + p * 2, h = src.height + p * 2;
    const mask = makeCanvas(w, h), mg = ctxOf(mask);
    mg.drawImage(src, p, p);
    const tint = (col) => { const c = makeCanvas(w, h), g = ctxOf(c); g.drawImage(mask, 0, 0); g.globalCompositeOperation = 'source-in'; g.fillStyle = col; g.fillRect(0, 0, w, h); return c; };
    const white = tint('#ffffff'), deep = tint('#0a3a6e');
    const c = makeCanvas(w, h), g = ctxOf(c);
    g.globalAlpha = 0.35;
    for (const [dx, dy] of [[0, 4], [1, 5], [-1, 5], [0, 6]]) g.drawImage(deep, dx, dy);
    g.globalAlpha = 1;
    for (let a = 0; a < 16; a++) { const an = (a / 16) * TAU; g.drawImage(white, Math.round(Math.cos(an) * 3), Math.round(Math.sin(an) * 3)); }
    g.drawImage(deep, 0, 1);
    g.drawImage(mask, 0, 0);
    const gl = makeCanvas(w, h), gg = ctxOf(gl);
    gg.drawImage(mask, 0, 0);
    gg.globalCompositeOperation = 'source-in';
    gg.fillStyle = vgrad(gg, p, h - p, [[0, 'rgba(255,255,255,0.75)'], [0.38, 'rgba(255,255,255,0.32)'], [0.46, 'rgba(255,255,255,0)'], [1, 'rgba(255,255,255,0)']]);
    gg.fillRect(0, 0, w, h);
    g.drawImage(gl, 0, 0);
    return { canvas: c, mask, w, h };
  }

  // ------------------------------------------------------------------------------------------- the cast
  // Schools: members keep an offset around a moving centre; each school crosses the view at its own depth.
  buildSchools() {
    const r = new RNG(9);
    const F = this.fish;
    const sch = (n, f, o) => ({ f, ...o, m: Array.from({ length: n }, () => ({ dx: r.gauss ? r.gauss() * o.sx : r.float(-1, 1) * o.sx, dy: r.float(-1, 1) * o.sy, dz: r.float(-1, 1) * o.sz, ph: r.float(0, 1), sp: r.float(0.85, 1.15) })) });
    this.schools = [];
    if (F.school[0]) {
      this.schools.push(sch(18, F.school[0], { x0: -230, x1: 470, y: 92, z: 1060, dir: 1, sx: 60, sy: 22, sz: 34, t0: T.plunge, t1: T.strike + 0.8 }));
      this.schools.push(sch(14, F.school[1] || F.school[0], { x0: 560, x1: -300, y: 170, z: 1330, dir: -1, sx: 80, sy: 30, sz: 50, t0: T.plunge, t1: T.strike + 2 }));
      this.schools.push(sch(7, F.school[1] || F.school[0], { x0: -80, x1: 430, y: 28, z: 1015, dir: 1, sx: 30, sy: 10, sz: 12, t0: T.under + 0.2, t1: T.under + 2.8 }));
    }
  }

  spawnBubbles() {
    const r = new RNG(31);
    return Array.from({ length: 110 }, () => ({ x: r.float(-160, 460), y: r.float(0, 360), z: r.float(900, 1500), r: r.float(1.2, 3.4), v: r.float(18, 46), ph: r.float(0, TAU) }));
  }

  // -------------------------------------------------------------------------------------------- control
  seek(t) {
    while (this.tasks.length) this.runTasks(1e9, 1e9);
    this.t = t;
    this.ready = true;
    for (const k of Object.keys(T)) if (T[k] < t - 0.05) this.cues.add(k);
  }

  skip() {
    if (this.skipT >= 0 || !this.active) return;
    this.skipT = 0;
    this.sfx('travel_whoosh', { vol: 0.5 });
  }

  skipRect() { const w = 64, h = 20; return { x: this.W - w - 10, y: 10, w, h }; }

  sfx(name, o) { try { this.audio?.play?.(name, o); } catch (e) { /* audio is optional */ } }

  cue(name, at) {
    if (this.cues.has(name) || this.t < at) return false;
    this.cues.add(name);
    return true;
  }

  // ------------------------------------------------------------------------------------------- camera
  shotAt(t) { for (let i = 0; i < SHOTS.length; i++) if (t < SHOTS[i].t1 || i === SHOTS.length - 1) return i; return SHOTS.length - 1; }

  camera(t) {
    const si = this.shotAt(t);
    const [x, y, z, pitch, roll] = spline(SHOTS[si].keys, t);
    let sx = 0, sy = 0;
    if (this.shake > 0) { sx = (Math.random() - 0.5) * this.shake; sy = (Math.random() - 0.5) * this.shake; }
    const p = pitch * DEG;
    return { x: x + sx, y: y + sy, z, p, cp: Math.cos(p), sp: Math.sin(p), roll: roll * DEG, shot: si };
  }

  // World -> screen: [sx, sy, px per unit, depth] (null behind the camera).
  proj(X, Y, Z) {
    const c = this.cam;
    const rx = X - c.x, ry = Y - c.y, rz = Z - c.z;
    const d = ry * c.sp + rz * c.cp;
    if (d < 2) return null;
    const v = ry * c.cp - rz * c.sp;
    const s = this.F / d;
    return [this.W / 2 + rx * s, this.H / 2 + v * s, s, d];
  }

  horizon() { return this.H / 2 - this.F * Math.tan(this.cam.p); }

  // Screen row of a point on a horizontal plane (y = Y) straight ahead at forward distance D.
  rowAt(Y, D) {
    const c = this.cam;
    const ry = Y - c.y;
    const d = ry * c.sp + D * c.cp;
    if (d < 1) return this.H * 4;
    return this.H / 2 + (this.F * (ry * c.cp - D * c.sp)) / d;
  }

  // ------------------------------------------------------------------------------------------- update
  update(dt) {
    if (!this.active) return;
    dt = clamp(dt || 0, 0, 1 / 15);
    const inp = this.input;
    if (!this.ready) {
      this.bootT += dt;
      this.runTasks(this.bootT < 0.15 ? 4 : 18, 0.5);
      if (!this.ready) return;
    }
    if (inp) {
      const r = this.skipRect();
      this.skipHover = inp.x >= r.x && inp.y >= r.y && inp.x < r.x + r.w && inp.y < r.y + r.h && this.t > 0.4;
      if (this.skipHover && inp.pressed) { inp.consume?.(); this.skip(); }
      if (inp.keyPressed?.('Escape')) this.skip();
    }
    if (this.skipT >= 0) {
      this.skipT += dt;
      if (!this.handed) { this.handed = true; this.o.onHandoff?.(); }
      this.fx.update(dt);
      if (this.skipT > 0.5) this.finish();
      return;
    }
    if (this.tasks.length) this.runTasks(5, this.t + 1.2);
    if (this.t < T.strike) this.touchFish();
    // slow-motion beats
    let ts = 1;
    if (this.t > T.strike && this.t < T.strike + 0.45) ts = 0.35;
    const lk = inv(T.breach + 0.15, T.logo - 0.2, this.t);
    if (lk > 0.3 && lk < 0.62) ts = 0.45;
    const sdt = dt * ts;
    const t = (this.t += sdt);
    this.shake = Math.max(0, (this.shake || 0) - dt * 22);
    this.cam = this.camera(t);
    this.updateCues(t);
    this.updateBubbles(sdt, t);
    this.updateLens(dt);
    this.fx.update(sdt);
    if (t >= T.out0 && !this.handed) { this.handed = true; this.o.onHandoff?.(); }
    if (t >= END) this.finish();
  }

  finish() {
    if (!this.active) return;
    this.active = false;
    this.o.onDone?.();
  }

  updateCues(t) {
    const { W, H } = this;
    if (this.cue('start', 0)) { try { this.audio?.setMusic?.(this.o.music || 'oscean'); } catch (e) { /* optional */ } this.sfx('travel_whoosh', { vol: 0.35, pitch: 0.7 }); }
    if (this.cue('swoop', T.swoop)) this.sfx('travel_whoosh', { vol: 0.45, pitch: 1.1 });
    if (this.cue('cast', T.cast + 0.35)) this.sfx('cast', { vol: 0.7 });
    if (this.cue('land', T.land)) {
      this.sfx('splash_small', { vol: 0.7 });
      const p = this.proj(LURE.x, 0, LURE.z);
      if (p) { this.fx.splash(p[0], p[1], 0.6); this.fx.ringWave(p[0], p[1], 26 * p[2], '#ffffff', { life: 0.7, w: 2, flat: 0.25 }); }
    }
    if (this.cue('plunge', T.plunge + 0.32)) { this.fx.list.length = 0; this.sfx('splash_big', { vol: 0.55 }); this.sfx('bubbles', { vol: 0.7 }); }
    if (this.cue('curtain', T.plunge + 0.42)) {
      for (let i = 0; i < 70; i++) this.fx.add({ kind: 'gbubble', x: this.rng.float(0, W), y: H + this.rng.float(0, H * 0.3), vx: this.rng.float(-14, 14), vy: -this.rng.float(260, 520) * this.u, life: 1.6, r: this.rng.pick([2, 3, 4, 5, 6, 8, 10]), wob: this.rng.float(0, TAU), layer: 'fg', rise: 1, delay: this.rng.float(0, 0.35) });
    }
    if (this.cue('shadow', T.shadow)) this.sfx('whale_call', { vol: 0.25, pitch: 1.6 });
    if (this.cue('strike', T.strike)) {
      this.sfx('hookset', { vol: 0.9 }); this.sfx('bite', { vol: 0.7 });
      this.shake = 9 * this.u;
      this.flashT = t;
      const p = this.lureScreen;
      if (p) { this.fx.ringWave(p[0], p[1], 90 * this.u, '#ffffff', { life: 0.45, w: 3 }); this.fx.aeroBubbles(p[0], p[1], 30, { w: 30, h: 20, speed: [40, 160], layer: 'top' }); }
    }
    if (this.cue('surge', T.surge)) { this.sfx('reel', { vol: 0.6 }); this.sfx('bubbles', { vol: 0.6 }); }
    if (this.cue('breach', T.breach + 0.08)) {
      this.fx.list.length = 0;
      this.sfx('jump_out', { vol: 0.9 }); this.sfx('splash_big', { vol: 0.9 });
      this.flashT = t - 0.05;
      this.shake = 7 * this.u;
      const p = this.proj(EXIT.x, 0, EXIT.z);
      if (p) {
        this.fx.splash(p[0], p[1], 2.2);
        this.fx.droplets?.(p[0], p[1], 40, { speed: [120, 380], spread: 1.1, w: 30 });
        this.fx.ringWave(p[0], p[1], 120 * this.u, '#ffffff', { life: 0.6, w: 3, flat: 0.28 });
      }
      for (let i = 0; i < 9; i++) this.addLensDrop(this.rng.float(0.1, 0.9) * W, this.rng.float(0.15, 0.85) * H, this.rng.float(5, 15) * this.u, this.rng.float(0, 0.5));
    }
    if (this.cue('apex', T.breach + 0.75)) this.sfx('catch_epic', { vol: 0.55 });
    if (this.cue('logo', T.logo)) { this.fx.list.length = 0; this.lens.length = 0; this.sfx('ui_unlock', { vol: 0.6 }); this.sfx('sparkle', { vol: 0.6 }); this.flashT = t; }
    if (this.cue('down', T.logo + 0.12)) {
      this.sfx('splash_big', { vol: 0.5 });
      this.cam = this.camera(t);
      const p = this.proj(SPLASH2.x, 0, SPLASH2.z);
      if (p) { this.fx.splash(p[0], p[1], 1.1); this.fx.ringWave(p[0], p[1], 40 * this.u, '#ffffff', { life: 0.9, w: 2, flat: 0.28 }); }
    }
    if (this.cue('flare', T.flare)) this.sfx('golden_shimmer', { vol: 0.5 });
    if (this.cue('out0', T.out0)) {
      this.sfx('bubbles', { vol: 0.8 });
      for (let i = 0; i < 90; i++) this.fx.add({ kind: 'gbubble', x: this.rng.float(0, W), y: H + this.rng.float(0, H * 0.5), vx: this.rng.float(-10, 10), vy: -this.rng.float(200, 380) * this.u, life: 3, r: this.rng.pick([3, 4, 5, 6, 8, 10, 12]), wob: this.rng.float(0, TAU), layer: 'top', rise: 1, delay: this.rng.float(0, 0.9) });
    }
  }

  // 3D bubbles rising past the camera underwater (respawn ahead of it).
  updateBubbles(dt, t) {
    const c = this.cam;
    if (!c || c.y < -20) return;
    for (const b of this.bubbles3) {
      b.y -= b.v * dt;
      b.x += Math.sin(t * 2 + b.ph) * 6 * dt;
      if (b.y < 1 || b.z < c.z + 10) {
        b.y = c.y + this.rng.float(40, 260);
        b.z = c.z + this.rng.float(40, 640);
        b.x = c.x + this.rng.float(-300, 300);
      }
    }
  }

  addLensDrop(x, y, r, delay = 0) { this.lens.push({ x, y, r, t: -delay, life: this.rng.float(1.6, 2.6), vy: this.rng.float(4, 18) * this.u }); }

  updateLens(dt) {
    for (const d of this.lens) { d.t += dt; if (d.t > 0) d.y += d.vy * dt * clamp01(d.t * 2); }
    this.lens = this.lens.filter((d) => d.t < d.life);
  }

  // --------------------------------------------------------------------------------------------- draw
  draw(ctx) {
    if (!this.active) return;
    const { W, H } = this;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    if (!this.ready) { this.drawBoot(ctx); ctx.restore(); return; }
    const t = this.t;
    let alpha = 1;
    if (this.skipT >= 0) alpha = 1 - ease.inOutQuad(clamp01(this.skipT / 0.5));
    else if (t > T.out0 + 0.4) alpha = 1 - ease.inOutCubic(inv(T.out0 + 0.4, T.out1, t));
    if (alpha > 0.002) {
      if (alpha < 1) {
        const L = this.layer || (this.layer = makeCanvas(W, H));
        if (L.width !== W || L.height !== H) { L.width = W; L.height = H; }
        const g = ctxOf(L);
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.clearRect(0, 0, W, H);
        this.drawFrame(g, t);
        ctx.globalAlpha = alpha;
        ctx.drawImage(L, 0, 0);
        ctx.globalAlpha = 1;
      } else this.drawFrame(ctx, t);
    }
    this.fx.draw(ctx, 'top', t);
    if (alpha > 0.05) this.drawSkip(ctx, alpha);
    ctx.restore();
  }

  drawBoot(ctx) {
    const { W, H } = this;
    ctx.fillStyle = '#f5fcff';
    ctx.fillRect(0, 0, W, H);
    AE.drawAeroGlow?.(ctx, W / 2, H / 2, Math.round(H * 0.4), '#bfeeff', 0.5);
    const b = this.bootT;
    if (b > 0.25) {
      ctx.globalAlpha = clamp01((b - 0.25) * 3);
      AE.drawGlossOrb?.(ctx, W / 2, H / 2 + Math.sin(b * 4) * 3, 9 * this.u, '#2fd3e8');
      for (let i = 0; i < 3; i++) { const ph = (b * 0.8 + i / 3) % 1; AE.drawAeroBubble?.(ctx, W / 2 + Math.sin(ph * 9 + i) * 8, H / 2 - 14 - ph * 40, 2 + i, 1 - ph); }
      ctx.globalAlpha = 1;
    }
  }

  drawFrame(ctx, t) {
    const { W, H } = this;
    const c = (this.cam = this.camera(t));
    ctx.save();
    if (c.roll) { ctx.translate(W / 2, H / 2); ctx.rotate(c.roll); ctx.scale(1.06, 1.06); ctx.translate(-W / 2, -H / 2); }
    // the meniscus sweeps across the lens while the camera crosses the surface
    const rho = 7;
    const k = clamp01((c.y + rho) / (2 * rho));
    if (k <= 0) this.drawAbove(ctx, t);
    else if (k >= 1) this.drawUnder(ctx, t);
    else {
      this.drawUnder(ctx, t);
      const sy = H * (1 - k);
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(-40, -40);
      ctx.lineTo(W + 40, -40);
      for (let x = W + 40; x >= -40; x -= 16) ctx.lineTo(x, sy + Math.sin(x * 0.03 + t * 9) * 6 * this.u + Math.sin(x * 0.011 - t * 5) * 9 * this.u);
      ctx.closePath();
      ctx.clip();
      this.drawAbove(ctx, t);
      ctx.restore();
      this.drawMeniscus(ctx, t, sy);
    }
    ctx.restore();
    this.fx.draw(ctx, 'fg', t);
    this.drawLens(ctx);
    this.drawVignette(ctx);
    this.drawBars(ctx, t);
    if (t >= T.logo - 0.2) this.drawLogo(ctx, t);
    this.drawFlash(ctx, t);
  }

  // ------------------------------------------------------------------------------------- above the water
  drawAbove(ctx, t) {
    const { W, H } = this;
    this.ctx = ctx;
    const hy = this.horizon();
    this.drawSky(ctx, t, hy);
    this.drawSea(ctx, t, hy);
    // billboards, far -> near
    const items = [];
    const push = (z, fn) => items.push([z, fn]);
    const I = this.A.isle;
    if (I) push(ISLE.z, () => this.drawIsland(ctx, t));
    for (const p of this.A.props || []) push(p.z, () => this.drawProp(ctx, p, t));
    if (this.globe) push(GLOBE.z, () => this.drawGlobe(ctx, t));
    const shot = this.cam.shot;
    if (shot === 0 || shot === 2) push(BOAT.z, () => this.drawBoat(ctx, t));
    if (shot === 0 && t > T.cast) push(LURE.z - 1, () => this.drawBobber(ctx, t));
    if (shot === 1) push(950, () => this.drawLeaper(ctx, t));
    this.drawGulls(ctx, t, push);
    this.drawDolphins(ctx, t, push);
    items.sort((a, b) => b[0] - a[0]);
    for (const [, fn] of items) fn();
    if (this.cam.shot === 1) this.drawBreachSplash(ctx, t);
    // sun flare over everything above the water
    const sun = this.sunPos;
    if (sun) {
      let vis = 0.55 + 0.25 * Math.sin(t * 1.3);
      if (this.cam.shot === 2) vis = 0.35 + 0.65 * inv(T.flare - 0.3, T.flare + 0.6, t);
      if (this.cam.shot === 1) vis = 0.9;
      if (sun[0] > -60 && sun[0] < W + 60 && sun[1] > -60 && sun[1] < H) this.flare(ctx, sun[0], sun[1], vis, 1.2);
    }
  }

  drawSky(ctx, t, hy) {
    const { W, H, u } = this;
    const top = Math.min(-1, hy - H * 1.3);
    ctx.fillStyle = vgrad(ctx, top, hy, [[0, '#0640b8'], [0.35, '#1268e0'], [0.68, '#3aa2fa'], [0.88, '#9adcff'], [1, '#eafcff']]);
    ctx.fillRect(-W * 0.1, -H * 0.1, W * 1.2, Math.max(0, hy + 2 + H * 0.1));
    const c = this.cam;
    const [az, el] = SUNS[c.shot] || SUNS[0];
    const sx = W / 2 + this.F * Math.tan(az), sy = H / 2 - this.F * Math.tan(el + c.p);
    this.sunPos = [sx, sy];
    // white Aero arcs sweeping across the sky
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.lineWidth = 1;
    const ac = [W * 0.72, hy + H * 0.9];
    for (let i = 0; i < 11; i++) { const r = H * (0.95 + i * 0.03); ctx.beginPath(); ctx.arc(ac[0], ac[1], r, -2.5, -1.15); ctx.stroke(); }
    ctx.restore();
    // rotating sun rays + bloom
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.translate(sx, sy);
    ctx.rotate(t * 0.04);
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * TAU, w = 0.03 + (i % 3) * 0.018, L = H * (0.7 + (i % 4) * 0.22);
      const gr = ctx.createLinearGradient(0, 0, Math.cos(a) * L, Math.sin(a) * L);
      gr.addColorStop(0, 'rgba(255,255,240,0.17)'); gr.addColorStop(0.5, 'rgba(255,255,240,0.05)'); gr.addColorStop(1, 'rgba(255,255,240,0)');
      ctx.fillStyle = gr;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a - w) * L, Math.sin(a - w) * L); ctx.lineTo(Math.cos(a + w) * L, Math.sin(a + w) * L); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
    AE.drawAeroGlow?.(ctx, sx, sy, Math.round(H * 0.24), '#ffffff', 0.65);
    AE.drawAeroGlow?.(ctx, sx, sy, Math.round(H * 0.06), '#ffffff', 1);
    // voxel clouds (far billboards)
    for (const cl of this.A.sky?.clouds || []) {
      const p = this.proj(cl.x, cl.y, cl.z);
      if (!p) continue;
      const k = p[2] / cl.res;
      const w = cl.spr.width * k, h = cl.spr.height * k;
      if (p[0] + w < 0 || p[0] - w > W || p[1] > hy) continue;
      ctx.imageSmoothingEnabled = k < 0.98;
      ctx.globalAlpha = 0.95;
      ctx.drawImage(cl.spr, Math.round(p[0] - w / 2), Math.round(p[1] - h), Math.round(w), Math.round(h));
    }
    ctx.globalAlpha = 1;
    ctx.imageSmoothingEnabled = false;
    // the horizon haze
    const hz = ctx.createLinearGradient(0, hy - 26 * u, 0, hy + 10 * u);
    hz.addColorStop(0, 'rgba(255,255,255,0)'); hz.addColorStop(0.75, 'rgba(240,252,255,0.75)'); hz.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = hz;
    ctx.fillRect(-W * 0.1, hy - 26 * u, W * 1.2, 36 * u);
  }

  // The glossy sea: per-distance colour rows, the island's reflection, sun glitter, world-anchored wave streaks.
  drawSea(ctx, t, hy) {
    const { W, H, u } = this;
    const c = this.cam;
    if (hy > H + 40) return;
    const stops = [[1e5, '#e4f9ff'], [5000, '#bdeeff'], [2400, '#78d6ff'], [1100, '#3bb4fa'], [450, '#1c92ee'], [160, '#0f74de'], [40, '#0a5cc8']];
    const y0 = Math.max(-H * 0.2, hy), y1 = H * 1.15;
    const gr = ctx.createLinearGradient(0, y0, 0, y1);
    for (const [D, col] of stops) { const y = this.rowAt(0, D); gr.addColorStop(clamp01((y - y0) / (y1 - y0)), col); }
    ctx.fillStyle = gr;
    ctx.fillRect(-W * 0.1, y0, W * 1.2, y1 - y0);
    this.drawReflections(ctx, t, hy);
    // the island's reflection
    const I = this.A.isle;
    if (I) {
      const p = this.proj(ISLE.x, 0, ISLE.z);
      if (p) {
        const k = p[2] / I.res;
        ctx.imageSmoothingEnabled = true;
        ctx.globalAlpha = 0.8;
        const sh = Math.sin(t * 2.2) * 1.5 * u;
        ctx.drawImage(I.ref, Math.round(p[0] - I.ax * k + sh), Math.round(p[1]), Math.round(I.ref.width * k), Math.round(I.ref.height * k * 0.8));
        ctx.globalAlpha = 1;
        ctx.imageSmoothingEnabled = false;
      }
    }
    // broad glossy swells rolling toward the camera
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let zi = Math.ceil((c.z + 30) / 70); zi <= Math.floor((c.z + 900) / 70); zi++) {
      const Z = zi * 70 + Math.sin(t * 0.7 + zi) * 12;
      const p = this.proj(c.x, 0, Z);
      if (!p || p[1] > H + 6) continue;
      const a = 0.05 * (0.5 + 0.5 * Math.sin(zi * 1.7 + t * 0.9)) * (1 - inv(500, 900, Z - c.z));
      ctx.globalAlpha = a;
      ctx.fillStyle = '#bff4ff';
      ctx.fillRect(-W * 0.1, Math.round(p[1]), W * 1.2, Math.max(1, Math.round(p[2] * 5)));
    }
    ctx.restore();
    // the sun's glitter path
    const sun = this.sunPos;
    if (sun && sun[0] > -W * 0.3 && sun[0] < W * 1.3) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const gw = ctx.createLinearGradient(0, hy, 0, H);
      gw.addColorStop(0, 'rgba(255,255,240,0.3)'); gw.addColorStop(0.3, 'rgba(255,255,240,0.08)'); gw.addColorStop(1, 'rgba(255,255,240,0)');
      ctx.fillStyle = gw;
      ctx.beginPath(); ctx.moveTo(sun[0] - 4 * u, hy); ctx.lineTo(sun[0] + 4 * u, hy); ctx.lineTo(sun[0] + 46 * u, H); ctx.lineTo(sun[0] - 46 * u, H); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#ffffff';
      for (let i = 0; i < 110; i++) {
        const fy = Math.pow(hash2(i, 3, 1), 1.8);
        const y = hy + 1 + fy * (H - hy);
        const spread = (3 + fy * 78) * u;
        const x = sun[0] + (hash2(i, 7, 2) - 0.5) * 2 * spread * (0.4 + hash2(i, 8, 2) * 0.6);
        const tw = Math.sin(t * (4 + hash2(i, 1, 3) * 6) + i * 1.3);
        if (tw < 0.3) continue;
        const sz = tw > 0.9 && fy > 0.2 ? 2 : 1;
        ctx.globalAlpha = tw * (1 - fy * 0.5);
        ctx.fillRect(Math.round(x) - sz, Math.round(y), sz * 2 + 1, 1);
        if (sz > 1) ctx.fillRect(Math.round(x), Math.round(y) - 1, 1, 3);
      }
      ctx.restore();
    }
    // world-anchored wave marks: LOD bands (world spacing doubles with distance); a light crest, a dark trough
    ctx.save();
    const cap = 70 * u;
    for (let band = 0; band < 6; band++) {
      const sp = 10 * Math.pow(2, band), d0 = 24 * Math.pow(2.05, band) * 1.6, d1 = d0 * 2.05;
      const zA = Math.ceil((c.z + d0) / sp), zB = Math.floor((c.z + d1) / sp);
      for (let zi = zA; zi <= zB; zi++) {
        const Z = zi * sp;
        const dz = Z - c.z;
        const fade = Math.min(inv(d0, d0 * 1.25, dz), 1 - inv(d1 * 0.8, d1, dz));
        if (fade <= 0.02) continue;
        const half = (dz * (W / this.F)) * 0.62 + 80;
        const gx = sp * 2.1;
        const xA = Math.floor((c.x - half) / gx), xB = Math.ceil((c.x + half) / gx);
        for (let xi = xA; xi <= xB; xi++) {
          const hsh = hash2(xi, zi, band + 3);
          if (hsh > 0.68) continue;
          const X = (xi + hash2(zi, xi, 5)) * gx + Math.sin(t * 0.8 + zi * 0.7) * sp * 0.4;
          const p = this.proj(X, 0, Z + Math.sin(t * 1.5 + xi) * sp * 0.15);
          if (!p || p[0] < -60 || p[0] > W + 60 || p[1] > H + 4) continue;
          const len = Math.min(cap, Math.max(2, Math.round(sp * (0.55 + hsh * 1.1) * p[2])));
          const th = p[2] > 1.6 ? 2 : 1;
          const a = fade * (0.4 + 0.5 * hsh) * clamp01(0.45 + Math.sin(t * 2.2 + hsh * 20) * 0.55);
          const x0 = Math.round(p[0] - len / 2), y = Math.round(p[1]);
          if (p[2] > 0.35) { ctx.globalAlpha = a * 0.5; ctx.fillStyle = '#0a58b8'; ctx.fillRect(x0 + Math.round(len * 0.15), y + th, Math.round(len * 0.7), 1); }
          ctx.globalAlpha = a * 0.5;
          ctx.fillStyle = '#cdf6ff';
          ctx.fillRect(x0, y, len, th);
          ctx.globalAlpha = a;
          ctx.fillRect(x0 + Math.round(len * 0.18), y, Math.max(1, Math.round(len * 0.64)), th);
          if (hsh < 0.1) { ctx.fillStyle = '#ffffff'; ctx.fillRect(Math.round(p[0]) - 1, y, 2, th); }
        }
      }
    }
    ctx.restore();
    // twinkling sun glints on the swell
    for (let zi = Math.ceil((c.z + 60) / 90); zi <= Math.floor((c.z + 1400) / 90); zi++) {
      for (let k = 0; k < 2; k++) {
        const hsh = hash2(zi, k, 41);
        const tw = Math.sin(t * (2.5 + hsh * 3) + hsh * 40);
        if (tw < 0.82) continue;
        const p = this.proj(c.x + (hsh - 0.5) * (zi * 90 - c.z) * 1.6, 0, zi * 90);
        if (!p || p[1] > H) continue;
        AE.drawSparkle?.(ctx, Math.round(p[0]), Math.round(p[1]), p[2] > 1 ? 3 : 2, (tw - 0.82) / 0.18);
      }
    }
  }

  // The sky mirrored in the glossy water (a planar mirror: y -> -y): clouds and the green globe, rippling and faded.
  drawReflections(ctx, t, hy) {
    const { W, H } = this;
    for (const cl of this.A.sky?.clouds || []) {
      const p = this.proj(cl.x, -cl.y, cl.z);
      if (!p || p[1] < hy - 2 || p[1] > H || p[1] - hy > H * 0.13) continue;
      const k = p[2] / cl.res;
      const w = cl.spr.width * k, h = cl.spr.height * k;
      if (p[0] + w < 0 || p[0] - w > W) continue;
      const ref = cl.ref || (cl.ref = mirrorFade(cl.spr, 'rgba(60,170,240,0.45)', 0.4));
      const n = 5, sh = ref.height / n;
      ctx.imageSmoothingEnabled = true;
      for (let i = 0; i < n; i++) {
        const dx = Math.sin(t * 2.2 + i * 1.7 + cl.x * 0.01) * 2 * this.u;
        ctx.drawImage(ref, 0, i * sh, ref.width, sh, Math.round(p[0] - w / 2 + dx), Math.round(p[1] + i * (h / n)), Math.round(w), Math.ceil(h / n) + 1);
      }
    }
    const G = this.globe;
    if (G) {
      const p = this.proj(GLOBE.x, -GLOBE.y - Math.sin(t * 0.8) * 10, GLOBE.z);
      const f = p && G.get(Math.floor(t * 4));
      if (f && p[1] > hy && p[1] < H + 200) {
        const k = p[2] / this.globeRes();
        const w = f.width * k, h = f.height * k;
        ctx.save();
        ctx.globalAlpha = 0.16;
        ctx.imageSmoothingEnabled = true;
        ctx.translate(Math.round(p[0] + Math.sin(t * 1.9) * 2 * this.u), Math.round(p[1]));
        ctx.scale(1, -1);
        ctx.drawImage(f, -w / 2, -h / 2, w, h);
        ctx.restore();
      }
    }
    ctx.imageSmoothingEnabled = false;
  }

  drawIsland(ctx, t) {
    const I = this.A.isle;
    const p = this.proj(ISLE.x, 0, ISLE.z);
    if (!p) return;
    const k = p[2] / I.res;
    ctx.imageSmoothingEnabled = k < 0.98;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(I.canvas, Math.round(p[0] - I.ax * k), Math.round(p[1] - I.ay * k), Math.round(I.canvas.width * k), Math.round(I.canvas.height * k));
    ctx.imageSmoothingEnabled = false;
    // foam glinting along the shore
    const w = I.canvas.width * k * 0.86;
    for (let i = 0; i < 18; i++) {
      const x = p[0] + (hash2(i, 9, 4) - 0.5) * w;
      const tw = Math.sin(t * 3 + i * 1.7);
      if (tw > 0.55) AE.drawSparkle?.(ctx, Math.round(x), Math.round(p[1] + 2 * this.u - hash2(i, 2, 2) * 4 * this.u), 1, tw);
    }
  }

  drawProp(ctx, P, t) {
    const p = this.proj(P.x, P.y, P.z);
    if (!p) return;
    const k = p[2] / P.res;
    const spr = P.spr;
    if (!spr?.canvas) return;
    ctx.imageSmoothingEnabled = k < 0.98;
    ctx.imageSmoothingQuality = 'high';
    if (P.kind === 'city' && P.bub) {
      // glass city in its water bubble: city, faint voxel shell, splashing rim, gloss
      const cw = spr.canvas.width * k, ch = spr.canvas.height * k;
      ctx.drawImage(spr.canvas, Math.round(p[0] - spr.ox * k), Math.round(p[1] - spr.oy * k), Math.round(cw), Math.round(ch));
      const R = cw * 0.66, cx = p[0], cy = p[1] - ch * 0.42;
      const B = P.bub, bk = (R * 2) / Math.max(1, B.shell.width);
      ctx.globalAlpha = 0.35;
      ctx.drawImage(B.shell, Math.round(cx - B.sx * bk), Math.round(cy - B.sy * bk), Math.round(B.shell.width * bk), Math.round(B.shell.height * bk));
      ctx.globalAlpha = 0.9;
      ctx.drawImage(B.ribbon, Math.round(cx - B.rx * bk), Math.round(cy - B.ry * bk), Math.round(B.ribbon.width * bk), Math.round(B.ribbon.height * bk));
      ctx.globalAlpha = 1;
      const rg = ctx.createRadialGradient(cx - R * 0.2, cy - R * 0.25, R * 0.55, cx, cy, R);
      rg.addColorStop(0, 'rgba(255,255,255,0)'); rg.addColorStop(0.85, 'rgba(210,248,255,0.28)'); rg.addColorStop(1, 'rgba(255,255,255,0.75)');
      ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.beginPath(); ctx.ellipse(cx - R * 0.45, cy - R * 0.5, R * 0.22, R * 0.09, -0.7, 0, TAU); ctx.fill();
      if (Math.sin(t * 2.3) > 0.9) AE.drawSparkle?.(ctx, cx + R * 0.5, cy - R * 0.45, 2, 1);
    } else {
      ctx.drawImage(spr.canvas, Math.round(p[0] - spr.ox * k), Math.round(p[1] - spr.oy * k), Math.round(spr.canvas.width * k), Math.round(spr.canvas.height * k));
    }
    if (P.kind === 'turbine' && P.rot) {
      const R = P.rot;
      const f = R.frames[Math.floor((t * 1.6 + P.ph) * R.n) % R.n];
      const hx = p[0] + (spr.hub[0] - spr.ox) * k, hy = p[1] + (spr.hub[1] - spr.oy) * k;
      if (f) ctx.drawImage(f, Math.round(hx - R.cx * k), Math.round(hy - R.cy * k), Math.round(f.width * k), Math.round(f.height * k));
    }
    ctx.imageSmoothingEnabled = false;
  }

  drawGlobe(ctx, t) {
    const G = this.globe;
    const p = this.proj(GLOBE.x, GLOBE.y + Math.sin(t * 0.8) * 10, GLOBE.z);
    if (!p || !G) return;
    const f = G.get(Math.floor(t * 4));
    if (!f) return;
    const k = p[2] / this.globeRes();
    const w = f.width * k, h = f.height * k;
    const R = w / 2;
    AE.drawAeroGlow?.(ctx, p[0], p[1], Math.round(R * 1.4), '#b8ff8a', 0.35);
    ctx.imageSmoothingEnabled = k < 0.98;
    ctx.drawImage(f, Math.round(p[0] - w / 2), Math.round(p[1] - h / 2), Math.round(w), Math.round(h));
    ctx.imageSmoothingEnabled = false;
    // glass gloss + a rim
    const hg = ctx.createRadialGradient(p[0] - R * 0.35, p[1] - R * 0.45, 0, p[0] - R * 0.35, p[1] - R * 0.45, R * 0.9);
    hg.addColorStop(0, 'rgba(255,255,255,0.8)'); hg.addColorStop(0.35, 'rgba(255,255,255,0.2)'); hg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = hg;
    ctx.beginPath(); ctx.arc(p[0], p[1], R * 0.96, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(220,255,200,0.85)'; ctx.lineWidth = Math.max(1, 1.5 * this.u);
    ctx.beginPath(); ctx.arc(p[0], p[1], R * 0.96, 0.2, 1.4); ctx.stroke();
    if (Math.random() < 0.25) this.fx.droplets?.(p[0] + R * 0.55, p[1] + R * 0.7, 1, { colors: ['#e8fbff', '#bff0ff'] });
  }

  // Gulls flying alongside the camera during the sweep (they keep pace, flapping and gliding).
  drawGulls(ctx, t, push) {
    const fr = this.A.sky?.gulls;
    if (!fr || this.cam.shot !== 0 || t > 5.6) return;
    const alt = lerp(-400, -175, clamp01(t / 4.5));
    for (const [x0, dy, z0, vz, ph, dx] of [[-260, -30, -1150, 500, 0, 9], [-330, -60, -1080, 500, 0.6, 7], [190, -10, -1000, 490, 1.3, -6], [60, -90, -760, 470, 2.1, 5]]) {
      const X = x0 + dx * t + Math.sin(t * 0.9 + ph) * 10, Y = alt + dy + Math.sin(t * 1.3 + ph * 5) * 8, Z = z0 + vz * t;
      push(Z, () => {
        const p = this.proj(X, Y, Z);
        if (!p) return;
        const glide = Math.sin(t * 0.8 + ph * 3) > 0.3;
        const f = fr[glide ? 1 : Math.abs(Math.floor(t * 7 + ph * 3)) % 3];
        const k = p[2] * 1.15;
        if (k < 0.15 || k > 2.6) return;
        ctx.save();
        ctx.translate(Math.round(p[0]), Math.round(p[1]));
        ctx.rotate(Math.sin(t * 1.1 + ph) * 0.12);
        ctx.scale(k, k);
        ctx.imageSmoothingEnabled = k < 0.98;
        ctx.drawImage(f, -f.width / 2, -f.height / 2);
        ctx.restore();
      });
    }
  }

  // A pod of glossy voxel dolphins leaping across the bay during the sweep (world-anchored, splashing).
  drawDolphins(ctx, t, push) {
    const D = this.dolphin;
    if (!D || this.cam.shot !== 0 || t < 1.5 || t > 4.4) return;
    const per = 1.25, air = 0.6;
    for (let i = 0; i < 3; i++) {
      const tt = t - 1.5 - i * 0.28;
      if (tt < 0) continue;
      const n = Math.floor(tt / per), u = (tt % per) / per;
      if (u > air) continue;
      const a = u / air;
      const X = 60 - i * 34 - tt * 70, Z = 480 + i * 46, Y = -Math.sin(a * Math.PI) * (44 + i * 5);
      push(Z, () => {
        const p = this.proj(X, Y, Z);
        if (!p) return;
        const f = D.frame(t * 9 + i, -1);
        if (!f) return;
        const k = (p[2] * 56) / f.canvas.width;
        if (k < 0.05) return;
        ctx.save();
        ctx.translate(Math.round(p[0]), Math.round(p[1]));
        ctx.rotate(Math.cos(a * Math.PI) * 0.75);
        ctx.scale(k, k);
        ctx.imageSmoothingEnabled = k < 0.98;
        ctx.drawImage(f.canvas, -f.ox, -f.oy);
        ctx.restore();
        ctx.imageSmoothingEnabled = false;
        if (a < 0.08 && this.cue('dolO' + i + '_' + n, 0)) { const q = this.proj(X, 0, Z); if (q) { this.fx.splash(q[0], q[1], 0.5); this.sfx('splash_small', { vol: 0.25 }); } }
        if (a > 0.9 && this.cue('dolI' + i + '_' + n, 0)) { const q = this.proj(X - 8, 0, Z); if (q) this.fx.splash(q[0], q[1], 0.45); }
      });
    }
  }

  // ------------------------------------------------------------------------------- the boat and the cast
  boatBob(t) { return Math.sin(t * 1.7) * 1.2; }

  drawBoat(ctx, t) {
    const B = this.A.boat;
    if (!B) return;
    const pv = B.pv;
    const bob = this.boatBob(t);
    const p = this.proj(BOAT.x, bob, BOAT.z);
    if (!p) return;
    const k = p[2] / B.res;
    if (pv.canvas.width * k < 4) return;
    // compose boat + fisherman at native scale, tint the hull below the waterline, then draw in perspective
    const pad = Math.round(60 * B.bs);
    const w = pv.canvas.width + pad * 2, h = pv.canvas.height + pad * 2;
    const L = this.boatL && this.boatL.width === w && this.boatL.height === h ? this.boatL : (this.boatL = makeCanvas(w, h));
    const g = ctxOf(L);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
    g.clearRect(0, 0, w, h);
    const bx = pad + pv.px, by = pad + pv.py;
    g.drawImage(pv.canvas, pad, pad);
    let pose = 'idle', pt = t;
    if (this.cam.shot === 2) { pose = 'cheer'; pt = t - T.logo; } else if (t > T.cast && t < T.cast + 0.75) { pose = 'cast'; pt = t - T.cast; } else if (t >= T.cast + 0.75) { pose = 'reel'; pt = t; }
    let an = null;
    try {
      an = CHAR.drawCharacter(g, bx + pv.stand[0], by + pv.stand[1], { pose, t: pt, facing: 1, look: this.look, scale: this.charScale(), id: 'intro', shadow: true });
    } catch (e) { an = null; }
    try { pv.drawFront?.(g, bx, by, t, 1); } catch (e) { /* optional */ }
    g.globalCompositeOperation = 'source-atop';
    g.fillStyle = '#2a8ad8';
    g.globalAlpha = 0.45; g.fillRect(0, by + 1, w, h);
    g.globalAlpha = 0.25; g.fillRect(0, by + Math.round(6 * B.bs), w, h);
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    const ox = p[0] - bx * k, oy = p[1] - by * k;
    ctx.imageSmoothingEnabled = k < 0.98;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(L, Math.round(ox), Math.round(oy), Math.round(w * k), Math.round(h * k));
    ctx.imageSmoothingEnabled = false;
    // foam hugging the hull
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    const hw = pv.canvas.width * k * 0.5;
    for (let i = -6; i <= 6; i++) { const x = p[0] + (i / 6) * hw * 1.05; ctx.fillRect(Math.round(x), Math.round(p[1] + Math.sin(t * 4 + i) * k), Math.max(1, Math.round(3 * k)), 1); }
    this.rodTip = an?.rodTip ? [ox + an.rodTip[0] * k, oy + an.rodTip[1] * k] : null;
  }

  // Bobber flight: rod tip -> a ballistic arc -> it lands and bobs (world space).
  bobberAt(t) {
    const t0 = T.cast + 0.42;
    if (t < t0) return null;
    const k = clamp01((t - t0) / (T.land - t0));
    const s0 = [BOAT.x + 24, -40, BOAT.z], s1 = [LURE.x, 0, LURE.z];
    if (k < 1) return [lerp(s0[0], s1[0], k), lerp(s0[1], s1[1], k) - Math.sin(k * Math.PI) * 34, lerp(s0[2], s1[2], k), k];
    return [LURE.x, Math.sin((t - T.land) * 5) * 1.2 * Math.exp(-(t - T.land) * 1.5) + Math.sin(t * 1.7) * 0.6, LURE.z, 1];
  }

  drawBobber(ctx, t) {
    const b = this.bobberAt(t);
    const A = this.A.bobber;
    if (!b || !A) return;
    const p = this.proj(b[0], b[1], b[2]);
    if (!p) return;
    // the line: rod tip -> bobber, sagging once it has landed
    const tip = this.rodTip;
    if (tip) {
      ctx.save();
      const mx = (tip[0] + p[0]) / 2, my = (tip[1] + p[1]) / 2 + (b[3] >= 1 ? 18 * this.u : -6 * this.u);
      ctx.beginPath(); ctx.moveTo(tip[0], tip[1]); ctx.quadraticCurveTo(mx, my, p[0], p[1] - 4);
      ctx.strokeStyle = 'rgba(10,60,120,0.35)'; ctx.lineWidth = 2.2; ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.95)'; ctx.lineWidth = 1.2; ctx.stroke();
      ctx.restore();
    }
    const k = p[2] / A.res;
    ctx.imageSmoothingEnabled = k < 0.98;
    ctx.drawImage(A.canvas, Math.round(p[0] - A.ax * k), Math.round(p[1] - A.ay * k), Math.round(A.canvas.width * k), Math.round(A.canvas.height * k));
    ctx.imageSmoothingEnabled = false;
    if (b[3] >= 1) {
      const rr = (1 + ((t - T.land) * 0.8) % 1) * 9 * p[2];
      ctx.strokeStyle = `rgba(255,255,255,${0.5 * (1 - ((t - T.land) * 0.8) % 1)})`;
      ctx.beginPath(); ctx.ellipse(p[0], p[1], rr, rr * 0.22, 0, 0, TAU); ctx.stroke();
    }
  }

  // ------------------------------------------------------------------------------------ under the water
  drawUnder(ctx, t) {
    const { W, H, u } = this;
    this.ctx = ctx;
    const c = this.cam;
    const hy = this.horizon();
    // the surface seen from below (above the horizon row): bright toward the top, shimmering
    const top = Math.min(-H * 0.2, hy - H);
    ctx.fillStyle = vgrad(ctx, top, Math.max(hy, 1), [[0, '#e8ffff'], [0.4, '#a6f2ff'], [0.8, '#52ccf4'], [1, '#2ab0ec']]);
    ctx.fillRect(-W * 0.1, -H * 0.2, W * 1.2, Math.max(0, hy + H * 0.2 + 2));
    // the water volume below: fog by distance over the seabed
    const stops = [[1e5, '#2ab0ec'], [3000, '#22a0e2'], [1500, '#1888d4'], [900, '#1474c4'], [600, '#1f8aa0'], [430, '#2fa874'], [300, '#46c060']];
    const y0 = Math.max(-H * 0.2, hy), y1 = H * 1.2;
    const gr = ctx.createLinearGradient(0, y0, 0, y1);
    for (const [D, col] of stops) gr.addColorStop(clamp01((this.rowAt(SEABED, D) - y0) / (y1 - y0)), col);
    ctx.fillStyle = gr;
    ctx.fillRect(-W * 0.1, y0, W * 1.2, y1 - y0);
    // ripples on the underside of the surface (world-anchored)
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let band = 0; band < 4; band++) {
      const sp = 10 * Math.pow(2, band), d0 = 16 * Math.pow(2.1, band), d1 = d0 * 2.1;
      const zA = Math.ceil((c.z + d0) / sp), zB = Math.floor((c.z + d1) / sp);
      for (let zi = zA; zi <= zB; zi++) {
        const Z = zi * sp, dz = Z - c.z;
        const fade = Math.min(inv(d0, d0 * 1.3, dz), 1 - inv(d1 * 0.75, d1, dz));
        if (fade <= 0.02) continue;
        const half = dz * (W / this.F) * 0.7 + 60;
        for (let xi = Math.floor((c.x - half) / (sp * 2)); xi <= Math.ceil((c.x + half) / (sp * 2)); xi++) {
          const hsh = hash2(xi, zi, band + 11);
          if (hsh > 0.6) continue;
          const p = this.proj((xi + hash2(zi, xi, 6)) * sp * 2 + Math.sin(t * 1.2 + zi) * sp * 0.3, 0, Z);
          if (!p || p[1] < -10 || p[1] > hy + 4) continue;
          const len = Math.min(26 * u, Math.max(2, Math.round(sp * (0.5 + hsh * 0.7) * p[2])));
          const a = fade * (0.22 + 0.4 * hsh) * (0.6 + 0.4 * Math.sin(t * 3 + hsh * 30));
          ctx.fillStyle = '#ffffff';
          ctx.globalAlpha = a * 0.5;
          ctx.fillRect(Math.round(p[0] - len / 2), Math.round(p[1]), Math.round(len), 1);
          ctx.globalAlpha = a;
          ctx.fillRect(Math.round(p[0] - len / 4), Math.round(p[1]), Math.max(1, Math.round(len / 2)), 1);
        }
      }
    }
    ctx.restore();
    // the sun through the surface + god rays
    const sx = W / 2 + this.F * Math.tan(SUNS[0][0]) * 0.6, syy = Math.min(hy - 10, H / 2 - this.F * Math.tan(0.9 + c.p));
    AE.drawAeroGlow?.(ctx, sx, syy, Math.round(H * 0.3), '#ffffff', 0.55);
    this.drawRays(ctx, t, sx, syy);
    // seabed decor, fish and the lure (far -> near)
    const items = [];
    const push = (d, fn) => items.push([d, fn]);
    this.pushSeabed(push, t);
    this.pushSchools(push, t);
    this.pushBigFish(push, t);
    this.pushLure(push, t);
    items.sort((a, b) => b[0] - a[0]);
    for (const [, fn] of items) fn();
    // 3D bubbles and motes rising past the camera
    for (const b of this.bubbles3) {
      const p = this.proj(b.x, b.y, b.z);
      if (!p || p[0] < -10 || p[0] > W + 10 || p[1] < -10 || p[1] > H + 10) continue;
      const r = b.r * p[2] * 0.9;
      if (r < 0.6) continue;
      const fog = clamp01((p[3] - 150) / 700);
      if (r < 1.5) { ctx.fillStyle = `rgba(230,255,255,${0.6 * (1 - fog)})`; ctx.fillRect(Math.round(p[0]), Math.round(p[1]), 1, 1); continue; }
      AE.drawAeroBubble?.(ctx, p[0], p[1], Math.min(16, r), 0.85 * (1 - fog));
    }
    // a light haze toward the surface
    const hz = ctx.createLinearGradient(0, hy - 30 * u, 0, hy + 20 * u);
    hz.addColorStop(0, 'rgba(160,240,255,0)'); hz.addColorStop(0.6, 'rgba(160,240,255,0.3)'); hz.addColorStop(1, 'rgba(160,240,255,0)');
    ctx.fillStyle = hz;
    ctx.fillRect(-W * 0.1, hy - 30 * u, W * 1.2, 50 * u);
  }

  drawRays(ctx, t, sx, sy) {
    const { W, H } = this;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 9; i++) {
      const a = Math.PI / 2 + (i - 4) * 0.16 + Math.sin(t * 0.4 + i * 1.7) * 0.05;
      const L = H * 1.5, w = 0.035 + (i % 3) * 0.015;
      const al = 0.1 + 0.07 * Math.sin(t * 0.9 + i * 2.1);
      const gr = ctx.createLinearGradient(sx, sy, sx + Math.cos(a) * L, sy + Math.sin(a) * L);
      gr.addColorStop(0, `rgba(240,255,255,${al})`); gr.addColorStop(0.6, `rgba(200,250,255,${al * 0.35})`); gr.addColorStop(1, 'rgba(200,250,255,0)');
      ctx.fillStyle = gr;
      ctx.beginPath(); ctx.moveTo(sx + Math.cos(a + Math.PI / 2) * 6, sy); ctx.lineTo(sx + Math.cos(a - w) * L, sy + Math.sin(a - w) * L); ctx.lineTo(sx + Math.cos(a + w) * L, sy + Math.sin(a + w) * L); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
    void W;
  }

  pushSeabed(push, t) {
    const S = this.A.seabed;
    if (!S) return;
    const c = this.cam;
    const fogC = '#2aa4e6';
    // reefs on a world grid
    const sp = 230;
    for (let zi = Math.ceil((c.z + 200) / sp); zi <= Math.floor((c.z + 1700) / sp); zi++) {
      for (let xi = Math.floor((c.x - 900) / sp); xi <= Math.ceil((c.x + 900) / sp); xi++) {
        const h = hash2(xi, zi, 21);
        const X = (xi + hash2(zi, xi, 22)) * sp, Z = zi * sp + hash2(xi, zi, 23) * sp * 0.5;
        if (Z - c.z < 380) continue;
        if (h < 0.55 && S.reefs.length) {
          const spr = S.reefs[Math.floor(hash2(xi, zi, 24) * S.reefs.length)];
          push(Z - c.z, () => this.drawSeabedSprite(spr.canvas, spr.ox ?? spr.canvas.width / 2, spr.oy ?? spr.canvas.height, X, SEABED + 6, Z, 1.6, fogC));
        } else if (h < 0.75 && S.orbs.length) {
          const b = S.orbs[Math.floor(hash2(xi, zi, 25) * S.orbs.length)];
          push(Z - c.z, () => this.drawSeabedSprite(b.canvas, b.ox, b.h, X, SEABED + 2, Z, 1.3, fogC));
        } else if (h < 0.6 && S.turbine && Z - c.z > 1100 && Math.abs(X - c.x) > 300) {
          push(Z - c.z, () => {
            this.drawSeabedSprite(S.turbine.canvas, S.turbine.ox, S.turbine.oy, X, SEABED + 4, Z, 1.7, fogC);
            const p = this.proj(X, SEABED + 4, Z);
            if (!p || !S.rot) return;
            const k = p[2] * 1.7, R = S.rot, f = R.frames[Math.floor(t * 0.8 * R.n + xi) % R.n];
            const hx = p[0] + (S.turbine.hub[0] - S.turbine.ox) * k, hy = p[1] + (S.turbine.hub[1] - S.turbine.oy) * k;
            const fo = fogged(f, fogC, clamp01((p[3] - 200) / 1100));
            this.ctx.imageSmoothingEnabled = k < 0.98;
            this.ctx.drawImage(fo, Math.round(hx - R.cx * k), Math.round(hy - R.cy * k), Math.round(f.width * k), Math.round(f.height * k));
            this.ctx.imageSmoothingEnabled = false;
          });
        }
      }
    }
  }

  drawSeabedSprite(canvas, ox, oy, X, Y, Z, unitPerPx, fogC) {
    const ctx = this.ctx;
    const p = this.proj(X, Y, Z);
    if (!p) return;
    const k = p[2] * unitPerPx;
    const w = canvas.width * k, h = canvas.height * k;
    if (p[0] + w < 0 || p[0] - w > this.W || p[1] - h > this.H || w < 2) return;
    const src = fogged(canvas, fogC, clamp01((p[3] - 200) / 1100));
    ctx.imageSmoothingEnabled = k < 0.98;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, Math.round(p[0] - ox * k), Math.round(p[1] - oy * k), Math.round(w), Math.round(h));
    ctx.imageSmoothingEnabled = false;
  }

  // One voxel fish at a world point, drawn through the rig at its fixed build scale, perspective by transform.
  drawFish(f, X, Y, Z, st, fogA = null) {
    const ctx = this.ctx;
    const p = this.proj(X, Y, Z);
    if (!p || !f) return null;
    const want = (f.len * p[2]) / f.gw;
    const k = want / f.S0;
    if (want * f.gw < 3) return p;
    if (p[0] < -f.len * p[2] || p[0] > this.W + f.len * p[2] || p[1] < -f.len * p[2] || p[1] > this.H + f.len * p[2]) return p;
    const fog = fogA ?? clamp01((p[3] - 160) / 900);
    ctx.save();
    ctx.translate(p[0], p[1]);
    ctx.scale(k, k);
    ctx.imageSmoothingEnabled = k < 0.98;
    ctx.imageSmoothingQuality = 'high';
    try {
      RIG.drawFishRig(ctx, f.c, {
        x: 0, y: 0, scale: f.S0, facing: st.facing ?? 1, turn: st.facing ?? 1, angle: st.angle || 0, heading: st.heading || 0,
        swimPhase: st.swim ?? 0, tailPhase: st.swim ?? 0, finPhase: (st.swim ?? 0) * 1.3 % 1, speed01: st.speed ?? 0.5,
        mouth: st.mouth || 0, emotion: st.emotion || 'neutral', time: this.t, blink: 0, pri: st.pri ?? 2, lod: 0,
        wash: fog > 0.08 ? { color: '#2aa4e6', alpha: Math.round(fog * 8) / 10 } : null,
      });
    } catch (e) { /* the fish renderer may be mid-rework */ }
    ctx.restore();
    ctx.imageSmoothingEnabled = false;
    return p;
  }

  pushSchools(push, t) {
    if (!this.schools) return;
    for (const S of this.schools) {
      if (t < S.t0 - 0.5 || t > S.t1 + 1) continue;
      const k = inv(S.t0, S.t1, t);
      const cx = lerp(S.x0, S.x1, k);
      // they scatter when the big fish strikes
      const scat = inv(T.strike - 0.6, T.strike + 0.8, t);
      for (const m of S.m) {
        const sw = (t * 2.2 * m.sp + m.ph) % 1;
        const X = cx + m.dx + Math.sin(t * 1.1 + m.ph * 9) * 6 + scat * m.dx * 3;
        const Y = S.y + m.dy + Math.sin(t * 1.7 + m.ph * 7) * 4 - scat * Math.abs(m.dy) * 2;
        const Z = S.z + m.dz;
        const d = Z - this.cam.z;
        push(d, () => this.drawFish(S.f, X, Y, Z, { facing: S.dir, swim: sw, speed: 0.6 + scat * 0.4, angle: Math.sin(t * 1.7 + m.ph * 7) * 0.08 }));
      }
    }
    // a big mid fish cruising close past the lens
    const M = this.fish?.mid;
    if (M && t > T.under - 0.2 && t < T.shadow + 1.4) {
      const k = inv(T.under - 0.2, T.shadow + 1.4, t);
      const X = lerp(330, -120, k), Y = 120 + Math.sin(t * 1.3) * 4, Z = 1110;
      push(Z - this.cam.z, () => this.drawFish(M, X, Y, Z, { facing: -1, swim: (t * 1.4) % 1, speed: 0.5 }));
    }
  }

  // The big fish: rises from the blue, charges the lure (toward the camera), strikes, thrashes and surges up.
  bigFishState(t) {
    if (t < T.shadow || t > T.breach) return null;
    const L = this.lurePos(t);
    if (t < T.strike) {
      const k = ease.inCubic(inv(T.shadow, T.strike, t));
      const k2 = inv(T.shadow, T.strike, t);
      const s0 = [420, 210, 1680];
      const X = lerp(s0[0], L[0] + 36, k), Y = lerp(s0[1], L[1] + 4, k) + Math.sin(k2 * 7) * 8 * (1 - k), Z = lerp(s0[2], L[2] + 20, k);
      return { X, Y, Z, facing: -1, heading: lerp(-20, -50, k), angle: lerp(-0.12, 0.05, k), mouth: k > 0.8 ? 1 : 0.2, swim: (t * lerp(1.2, 3.4, k)) % 1, speed: lerp(0.4, 1, k) };
    }
    if (t < T.surge) {
      const k = inv(T.strike, T.surge, t);
      return { X: L[0] + 36 + Math.sin(t * 40) * 3, Y: L[1] + 4, Z: L[2] + 20, facing: -1, heading: lerp(-50, -10, k), angle: Math.sin(t * 30) * 0.18, mouth: 0.1, swim: (t * 5) % 1, speed: 1, emotion: 'angry' };
    }
    const k = ease.inQuad(inv(T.surge, T.breach, t));
    return { X: lerp(L[0] + 36, 150, k), Y: lerp(L[1] + 4, -40, k), Z: lerp(L[2] + 20, 960, k), facing: -1, heading: lerp(-10, 10, k), angle: lerp(-0.2, -1.15, Math.min(1, k * 2)), mouth: 0.1, swim: (t * 6) % 1, speed: 1 };
  }

  pushBigFish(push, t) {
    const F = this.fish?.big;
    const s = this.bigFishState(t);
    if (!F || !s) return;
    push(s.Z - this.cam.z, () => {
      const fog = clamp01((s.Z - this.cam.z - 140) / 1300);
      const p = this.drawFish(F, s.X, s.Y, s.Z, { ...s, pri: 3 }, fog);
      if (p && t < T.strike) {
        // its shadowy approach: a soft dark glow in the blue
        const a = 0.25 * (1 - inv(T.strike - 0.8, T.strike, t));
        if (a > 0.01) { this.ctx.fillStyle = `rgba(10,40,90,${a})`; this.ctx.beginPath(); this.ctx.ellipse(p[0], p[1], F.len * p[2] * 0.55, F.len * p[2] * 0.16, 0, 0, TAU); this.ctx.fill(); }
      }
    });
  }

  lurePos(t) {
    const k = ease.outCubic(inv(T.land, T.shadow + 0.5, t));
    return [LURE.x + Math.sin(t * 1.4) * 3, lerp(0, LURE.y, k) + Math.sin(t * 2.1) * 2, LURE.z];
  }

  pushLure(push, t) {
    const A = this.A.lure;
    if (!A || t > T.surge + 0.3) return;
    const L = this.lurePos(t);
    if (t >= T.strike) { const s = this.bigFishState(t); if (s) { L[0] = s.X - 34; L[1] = s.Y - 2; L[2] = s.Z - 18; } }
    push(L[2] - this.cam.z - 0.5, () => {
      const ctx = this.ctx;
      const p = this.proj(L[0], L[1], L[2]);
      if (!p) return;
      this.lureScreen = [p[0], p[1]];
      // the line rises to the surface
      const q = this.proj(L[0] + 4, 0, L[2] + 6);
      ctx.save();
      ctx.strokeStyle = 'rgba(230,255,255,0.8)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(p[0], p[1]);
      if (q) ctx.lineTo(q[0], q[1]); else ctx.lineTo(p[0] + 10, -20);
      ctx.stroke();
      ctx.restore();
      if (t >= T.strike) return;
      const k = p[2] / A.res;
      ctx.save();
      ctx.translate(Math.round(p[0]), Math.round(p[1]));
      ctx.rotate(Math.sin(t * 2.4) * 0.25 + 0.3);
      ctx.imageSmoothingEnabled = k < 0.98;
      ctx.drawImage(A.canvas, -A.ax * k, -A.ay * k, A.canvas.width * k, A.canvas.height * k);
      ctx.restore();
      ctx.imageSmoothingEnabled = false;
      if (Math.sin(t * 5) > 0.8) AE.drawSparkle?.(ctx, p[0] + 6 * p[2], p[1] - 2, 2, 1);
    });
  }

  // ---------------------------------------------------------------------------------------- the leap
  leapState(t) {
    const t0 = T.breach + 0.06, t1 = T.logo + 0.35;
    if (t < t0 || t > t1) return null;
    const x = inv(t0, t1, t);
    // ballistic in world space, fastest at the ends
    const X = lerp(EXIT.x, DOWN.x, x), Z = lerp(EXIT.z, DOWN.z, x);
    const Y = -4 * 52 * x * (1 - x) + (x < 0.04 ? (0.04 - x) * 300 : 0);
    const vy = -4 * 52 * (1 - 2 * x), vx = DOWN.x - EXIT.x;
    return { X, Y, Z, x, ang: Math.atan2(vy, -vx) };
  }

  drawLeaper(ctx, t) {
    const F = this.fish?.big;
    const s = this.leapState(t);
    if (!F || !s) return;
    const p = this.drawFishAbove(F, s, t);
    if (p && Math.random() < 0.7) this.fx.droplets?.(p[0] + this.rng.float(-20, 20) * this.u, p[1] + this.rng.float(-8, 8) * this.u, 2, { speed: [20, 90], colors: ['#ffffff', '#bff4ff'] });
  }

  drawFishAbove(F, s, t) {
    return this.drawFish(F, s.X, s.Y, s.Z, { facing: -1, angle: s.ang, swim: (t * 4) % 1, speed: 1, mouth: 0.3, pri: 3 }, 0);
  }

  drawBreachSplash(ctx, t) {
    const p = this.proj(EXIT.x, 0, EXIT.z);
    if (!p) return;
    const k = inv(T.breach + 0.02, T.breach + 1.25, t);
    if (k <= 0 || k >= 1) return;
    this.drawSplashCrown(ctx, p[0], p[1], 26 * p[2], k, t);
  }

  // A glossy water crown (effect): a fan of water sheets with white crests and drops, a foam ring at its base.
  drawSplashCrown(ctx, x, y, R, k, t) {
    const rise = Math.sin(Math.min(1, k * 1.6) * Math.PI * 0.5) * (1 - ease.inCubic(k));
    const spread = 0.7 + k * 0.45;
    const a = 1 - smoothstep(0.55, 1, k);
    ctx.save();
    ctx.lineCap = 'round';
    ctx.globalAlpha = a;
    // foam ring + glossy disc
    ctx.fillStyle = 'rgba(200,245,255,0.7)';
    ctx.beginPath(); ctx.ellipse(x, y, R * spread * 1.15, R * 0.2 * spread, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.95)'; ctx.lineWidth = Math.max(1, R * 0.05);
    ctx.beginPath(); ctx.ellipse(x, y, R * spread * 1.15, R * 0.2 * spread, 0, 0, TAU); ctx.stroke();
    // the water column dragged up behind the fish
    const ch = R * 2.2 * rise * (1 - k * 0.6);
    if (ch > 2) {
      const g = ctx.createLinearGradient(0, y - ch, 0, y);
      g.addColorStop(0, 'rgba(255,255,255,0.9)'); g.addColorStop(0.5, 'rgba(170,236,255,0.7)'); g.addColorStop(1, 'rgba(120,214,255,0.55)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(x - R * 0.42, y);
      ctx.quadraticCurveTo(x - R * 0.16, y - ch * 0.5, x - R * 0.05, y - ch);
      ctx.quadraticCurveTo(x + R * 0.12, y - ch * 0.96, x + R * 0.16, y - ch * 0.82);
      ctx.quadraticCurveTo(x + R * 0.2, y - ch * 0.4, x + R * 0.42, y);
      ctx.closePath(); ctx.fill();
    }
    // the crown sheets
    const n = 13;
    for (let i = 0; i < n; i++) {
      const u = i / (n - 1) - 0.5;
      const ang = -Math.PI / 2 + u * 2.5 + Math.sin(i * 3.1) * 0.08;
      const len = R * (0.9 + 0.8 * hash2(i, 1, 7)) * rise * (1.15 - Math.abs(u));
      const bx = x + u * R * 1.9 * spread, by = y + Math.abs(u) * R * 0.06;
      const tx = bx + Math.cos(ang) * len * 0.85, ty = by + Math.sin(ang) * len;
      const w = Math.max(1.5, R * 0.14 * (1 - Math.abs(u) * 1.2));
      ctx.strokeStyle = 'rgba(140,226,255,0.8)'; ctx.lineWidth = w;
      ctx.beginPath(); ctx.moveTo(bx, by); ctx.quadraticCurveTo(bx + (tx - bx) * 0.15, by + (ty - by) * 0.65, tx, ty); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.95)'; ctx.lineWidth = Math.max(1, w * 0.35);
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      const dr = Math.max(1, Math.min(2.5, R * 0.03));
      ctx.beginPath(); ctx.arc(tx + Math.cos(ang) * dr * 3 * k * 4, ty + Math.sin(ang) * dr * 3 * k * 4, dr, 0, TAU); ctx.fill();
    }
    ctx.restore();
    void t;
  }

  // ---------------------------------------------------------------------------------- the logo and fx
  drawLogo(ctx, t) {
    const L = this.A.logo;
    if (!L) return;
    const { W, H } = this;
    const k = clamp01((t - T.logo) / 0.7);
    const sc = 0.55 + 0.45 * ease.outBack(k, 2.2);
    const out = inv(T.out0, T.out0 + 0.9, t);
    const cx = W / 2, cy = H * 0.3 + Math.sin(t * 1.4) * 2 - out * H * 0.06;
    const a = clamp01(k * 2) * (1 - out);
    if (a <= 0) return;
    // the leafy branches framing the shot
    this.drawBranches(ctx, t, a);
    ctx.save();
    ctx.globalAlpha = a;
    ctx.globalCompositeOperation = 'lighter';
    AE.drawAeroGlow?.(ctx, cx, cy, Math.round(L.w * 0.45 * sc), '#cfefff', 0.5);
    ctx.globalCompositeOperation = 'source-over';
    AE.drawAeroGlow?.(ctx, cx, cy, Math.round(L.w * 0.32 * sc), '#ffffff', 0.4);
    ctx.translate(cx, cy);
    ctx.scale(sc, sc);
    ctx.imageSmoothingEnabled = sc < 0.99;
    ctx.drawImage(L.canvas, -L.w / 2, -L.h / 2);
    const sw = inv(T.flare, T.flare + 1.2, t);
    if (sw > 0 && sw < 1) {
      const c = this.shineC || (this.shineC = makeCanvas(L.w, L.h));
      const g = ctxOf(c);
      g.globalCompositeOperation = 'source-over';
      g.clearRect(0, 0, L.w, L.h);
      g.drawImage(L.mask, 0, 0);
      g.globalCompositeOperation = 'source-in';
      const x = lerp(-L.w * 0.3, L.w * 1.3, ease.inOutQuad(sw));
      const gr = g.createLinearGradient(x - 40, 0, x + 40, L.h * 0.3);
      gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.85)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr;
      g.fillRect(0, 0, L.w, L.h);
      ctx.globalCompositeOperation = 'lighter';
      ctx.drawImage(c, -L.w / 2, -L.h / 2);
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.restore();
    ctx.imageSmoothingEnabled = false;
    if (this.cue('logoFx', T.logo + 0.15)) {
      this.fx.glints(cx, cy, 14, { w: L.w * 0.45, h: L.h * 0.35 });
      this.fx.aeroBubbles(cx, cy + L.h * 0.3, 24, { w: L.w * 0.4, h: 10, speed: [20, 80] });
    }
    if (this.cue('flareFx', T.flare)) {
      this.fx.lensFlare(cx - L.w * 0.42, cy - L.h * 0.3, { cx: W / 2, cy: H / 2, life: 1.4, scale: 1.4 * this.u });
      this.fx.glints(cx, cy, 10, { w: L.w * 0.5, h: L.h * 0.4, delay: 1 });
    }
    if (t > T.logo + 0.8 && t < T.out0 && Math.random() < 0.15) this.fx.glint(cx + this.rng.float(-0.45, 0.45) * L.w, cy + this.rng.float(-0.3, 0.3) * L.h, { len: this.rng.pick([3, 4, 6]) });
    if (t > T.logo + 0.5 && t < T.out0 && Math.random() < 0.1) this.fx.aeroBubbles(cx + this.rng.float(-0.4, 0.4) * L.w, cy + L.h * 0.4, 1, { sizes: [2, 3, 4], speed: [10, 30] });
  }

  drawBranches(ctx, t, a) {
    const { W, H } = this;
    const br = this.A.branch, b2 = this.A.branch2;
    const k = ease.outCubic(clamp01((t - T.logo) / 1.1));
    ctx.save();
    ctx.globalAlpha = a;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    if (br) {
      const w = br.canvas.width / br.ss, h = br.canvas.height / br.ss;
      ctx.save();
      ctx.translate(W + 4 + (1 - k) * w * 0.5, H * 0.98);
      ctx.rotate(Math.sin(t * 0.9) * 0.025 - 0.08);
      ctx.drawImage(br.canvas, -w * 0.98, -h * 0.92, w, h);
      ctx.restore();
    }
    if (b2) {
      const w = b2.canvas.width / b2.ss, h = b2.canvas.height / b2.ss;
      ctx.save();
      ctx.translate(-6 - (1 - k) * w * 0.5, -4);
      ctx.rotate(Math.PI + Math.sin(t * 1.1 + 1) * 0.03 + 0.12);
      ctx.drawImage(b2.canvas, -w * 0.98, -h * 0.85, w, h);
      ctx.restore();
    }
    ctx.restore();
    ctx.imageSmoothingEnabled = false;
  }

  // Lens flare from a light at (sx, sy) through the screen centre: anamorphic streak, glow, coloured ghosts.
  flare(ctx, sx, sy, vis, size) {
    const cx = this.W / 2, cy = this.H / 2;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const L = 240 * this.u * size;
    const gr = ctx.createLinearGradient(sx - L, 0, sx + L, 0);
    gr.addColorStop(0, 'rgba(160,230,255,0)'); gr.addColorStop(0.5, rgba('#e8fbff', 0.55 * vis)); gr.addColorStop(1, 'rgba(160,230,255,0)');
    ctx.fillStyle = gr;
    ctx.fillRect(sx - L, sy - Math.max(1, size), L * 2, Math.max(2, 2 * size));
    const ghosts = [[0.35, 10, '#bfefff', 0.16], [0.6, 5, '#fff2b0', 0.2], [0.85, 16, '#c8f56a', 0.1], [1.25, 8, '#7ff0ff', 0.16], [1.6, 24, '#bfeaff', 0.08], [1.9, 12, '#ffd0f0', 0.1]];
    for (const [k, r, c, a] of ghosts) AE.drawAeroGlow?.(ctx, lerp(sx, cx, k * 1.2), lerp(sy, cy, k * 1.2), Math.round(r * this.u * size), c, a * vis * 2);
    ctx.restore();
  }

  drawMeniscus(ctx, t, sy) {
    const { W, u } = this;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.lineWidth = Math.max(2, 3 * u);
    ctx.beginPath();
    for (let x = -40; x <= W + 40; x += 16) {
      const y = sy + Math.sin(x * 0.03 + t * 9) * 6 * u + Math.sin(x * 0.011 - t * 5) * 9 * u;
      if (x === -40) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = Math.max(6, 10 * u);
    ctx.strokeStyle = '#bff6ff';
    ctx.stroke();
    ctx.restore();
    for (let i = 0; i < 3; i++) AE.drawAeroBubble?.(ctx, this.rng.float(0, W), sy + this.rng.float(-4, 14) * u, this.rng.pick([2, 3, 4, 5]), 0.9);
  }

  // Water drops sliding on the lens after the splash (refraction-ish highlight).
  drawLens(ctx) {
    for (const d of this.lens) {
      if (d.t < 0) continue;
      const a = clamp01(d.t * 6) * clamp01((d.life - d.t) * 2);
      ctx.save();
      ctx.globalAlpha = a;
      const g = ctx.createRadialGradient(d.x - d.r * 0.3, d.y - d.r * 0.35, d.r * 0.1, d.x, d.y, d.r);
      g.addColorStop(0, 'rgba(255,255,255,0.75)'); g.addColorStop(0.5, 'rgba(200,245,255,0.18)'); g.addColorStop(0.9, 'rgba(120,200,255,0.25)'); g.addColorStop(1, 'rgba(255,255,255,0.6)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.ellipse(d.x, d.y, d.r * 0.92, d.r, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.fillRect(Math.round(d.x - d.r * 0.4), Math.round(d.y - d.r * 0.5), Math.max(1, Math.round(d.r * 0.25)), Math.max(1, Math.round(d.r * 0.18)));
      ctx.restore();
    }
  }

  drawFlash(ctx, t) {
    const { W, H } = this;
    let a = 0;
    if (t < 0.9) a = 1 - ease.outCubic(t / 0.9);
    if (this.flashT != null) a = Math.max(a, 0.85 * (1 - clamp01((t - this.flashT) / 0.45)));
    // a white splash wipe over the cut into the leap, and a bloom into the logo
    a = Math.max(a, 0.9 * clamp01(1 - Math.abs(t - T.breach) / 0.14));
    a = Math.max(a, clamp01(1 - Math.abs(t - T.logo) / 0.22));
    if (a <= 0.01) return;
    ctx.fillStyle = rgba('#f5fcff', a);
    ctx.fillRect(0, 0, W, H);
  }

  drawVignette(ctx) {
    const { W, H } = this;
    if (!this.vig || this.vig.width !== W || this.vig.height !== H) {
      const c = makeCanvas(W, H), g = ctxOf(c);
      const gr = g.createRadialGradient(W / 2, H * 0.48, Math.min(W, H) * 0.42, W / 2, H / 2, Math.hypot(W, H) * 0.62);
      gr.addColorStop(0, 'rgba(6,40,80,0)'); gr.addColorStop(1, 'rgba(6,40,80,0.28)');
      g.fillStyle = gr; g.fillRect(0, 0, W, H);
      this.vig = c;
    }
    ctx.drawImage(this.vig, 0, 0);
  }

  // Cinema bars for the trailer part; they slide away for the logo.
  drawBars(ctx, t) {
    const { W, H } = this;
    const k = 1 - ease.inOutCubic(inv(T.logo - 0.1, T.logo + 0.7, t));
    const bh = Math.round(H * 0.07 * k * ease.outCubic(clamp01(t / 0.8)));
    if (bh <= 0) return;
    ctx.fillStyle = '#04132a';
    ctx.fillRect(0, 0, W, bh);
    ctx.fillRect(0, H - bh, W, bh);
    ctx.fillStyle = 'rgba(127,240,255,0.35)';
    ctx.fillRect(0, bh, W, 1);
    ctx.fillRect(0, H - bh - 1, W, 1);
  }

  drawSkip(ctx, alpha) {
    if (this.t < 0.3 && this.skipT < 0) return;
    const r = this.skipRect();
    ctx.globalAlpha = alpha * clamp01((this.t - 0.3) * 3);
    AE.drawAeroButton?.(ctx, r.x, r.y, r.w, r.h, { label: 'Skip', icon: UIC.getUiIcon?.('play'), tone: 'glass', state: this.skipHover ? 'hover' : 'normal' });
    if (this.audio?.isUnlocked && !this.audio.isUnlocked()) {
      const ic = UIC.getUiIcon?.('sound'), ml = UIC.getUiIcon?.('mouse_l');
      if (ic && ml) {
        const w = ic.width + ml.width + 16, h = 18, x = this.W - w - 10, y = this.H - h - 10;
        AE.drawAeroSurface?.(ctx, x, y, w, h, { tone: 'glass', r: 'pill', gloss: 0.6, glossH: 8, rim: 0.8, glow: 0.4 });
        ctx.drawImage(ml, x + 6, y + Math.round((h - ml.height) / 2));
        ctx.drawImage(ic, x + 10 + ml.width, y + Math.round((h - ic.height) / 2));
      }
    }
    ctx.globalAlpha = 1;
  }
}
