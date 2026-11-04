// The cinematic opening (phase 5, Intro agent): a FULLY 3D, interactive Frutiger Aero fishing trailer.
// A real perspective camera (position, yaw, pitch, roll and field of view per frame) flies through a WebGL2 voxel
// world rendered by src/gfx/voxgl.js: every island hill, wind turbine, glass tower, cloud, the boat, the seabed
// meadow and the floating 3D Alagard lettering is a voxel mesh; fish (the realistic voxel fish renderer), the
// bubble person and Clip are drawn by their own voxel renderers into a sprite atlas each frame and stand in the
// world as depth-tested, fogged camera-facing billboards at the angle the camera sees them from.
// Effects: HDR bloom, god rays, analytic lens flares, depth of field on far layers, chromatic aberration, zoom
// blur on crash zooms, caustics, a glossy reflective sea with shore foam, 3D splash droplets, bubbles and
// sparkles, water drops and bubbles refracting on the lens.
//
// Beats (story seconds, INTRO_T). At four of them the camera crash-zooms in, big floating 3D text appears and
// Clip (the paperclip guide, gfx/npcs.js) talks through the dialogue system (game/dialogue.js); the story waits
// for the player's response bubbles (click, or keys 1/2/3) while the camera keeps drifting:
//   sweep  fly in low over the sea to the (OS)cean island: grass-and-flower hills, turbines, the glass city in
//          its bubble, the green globe
//   clip   a bubble pops out of the sea: Clip! -> greeting (sets Clip's mood) and your angler name
//   boat   swoop to the bubble person's boat -> pick its paint (the boat repaints)
//   cast   the cast, the bobber lands; follow the line under the surface
//   fish   schools of realistic fish, caustics, the seabed meadow; zoom on the first fish -> pick a first bait
//   strike a big fish rises from the blue, strikes (flash, slow motion) and surges
//   breach cut: it bursts out of the sea toward the camera, drops hit the lens
//   logo   the glossy 3D FISHTOP logo over the bay, a flare sweep; Clip: "Let's fish!" -> hand-off
//
//   const intro = new Intro3D({W, H, input, audio, look, boat, music, state, lowPower,
//                              onChoice(key, value, picks), onHandoff, onDone});
//   intro.update(dt); intro.draw(ctx);   intro.skip(); intro.seek(t); intro.resize(W, H); intro.skipRect()
//   intro.active, intro.t (story seconds), intro.ready, intro.opaque, intro.picks {mood, name, hull, bait},
//   intro.dialogue (the Dialogue), intro.choiceRects(), intro.choose(i), intro.holding (beat id | null), intro.gl
// Without WebGL2 the same interactive story plays over a painted Aero backdrop with the 2D renderers.

import { makeCanvas, ctxOf } from '../core/canvas.js';
import { clamp, clamp01, lerp, ease, hash2, fbm2, smoothstep, TAU } from '../core/math.js';
import { RNG } from '../core/rng.js';
import { VoxelModel } from '../gfx/voxel.js';
import { createVoxGL, M4 } from '../gfx/voxgl.js';
import { buildText3D, drawText3D } from '../gfx/text3d.js';
import { loadAlagard, alagardReady } from '../gfx/alagard.js';
import { Dialogue, drawAlagard } from './dialogue.js';
import * as AE from '../ui/aero.js';
import * as UIC from '../gfx/uiicons.js';
import * as CHAR from '../gfx/character.js';
import * as NPC from '../gfx/npcs.js';
import * as BM from '../world/boatmodels.js';
import * as RIG from '../gfx/fishrig.js';
import * as SC from '../gfx/spritecache.js';
import * as SPEC from '../fish/species.js';
import * as ART from '../gfx/fishart.js';
import { swellAt, SWELLS, waterPalette } from '../world/watersim.js'; // the Water agent's swell field + ocean palette

// ------------------------------------------------------------------------------------------------ timeline
export const INTRO_T = {
  sweep: 0,
  pop: 4.6,        // a bubble surfaces and pops: Clip
  clip: 5.3,       // beat: greeting + name
  swoop: 5.4,
  boat: 7.6,       // beat: boat paint
  cast: 8.0,       // the bubble person casts
  land: 9.15,      // the bobber lands
  plunge: 9.6,     // follow the line under
  under: 10.5,
  fish: 12.0,      // beat: first fish / bait
  shadow: 12.5,    // the big one rises
  strike: 14.0,
  surge: 14.5,
  breach: 15.3,    // cut: it bursts out of the sea
  logo: 17.4,      // the FISHTOP logo
  flare: 18.0,
  final: 18.9,     // beat: let's fish
  out0: 19.2, out1: 20.4,
};
const T = INTRO_T;
const END = T.out1;
const BEATS = ['clip', 'boat', 'fish', 'final'];

// ------------------------------------------------------------------------------------------------ the world
// Units: one boat voxel. X right, Y up (0 = the sea), Z toward the opening camera (it flies toward -Z).
const SUN = norm3([-0.38, 0.47, -0.8]);        // the visible sun: high front-left (flares, rays, glitter)
const LIGHT = norm3([-0.45, 0.78, 0.44]);      // the key light shading the voxels: front-lit Aero look
const SUN_COL = [2.1, 1.92, 1.66];
const ISLE = { x: 0, z: -2250, vox: 10, NX: 240, NY: 46, NZ: 104, sink: 3 }; // sink: voxel rows under the sea (the shelf)
const CLIP_A = [-60, 3, 300];
const CLIP_B = [-35, 6, 42];
const CLIP_C = [66, -54, -59];
const CLIP_D = [-50, 50, 252];
const BOBBER = [70, 0, -40];
const LURE_Y = -40;
const SEABED = { x: -300, z: -500, vox: 5, NX: 140, NZ: 130, y: -200 };
const LEAP = { x0: 70, z0: -44, x1: -24, z1: -22, top: 44 };
const LOGO = [0, 86, 150];

// Camera keys: [t, eye x, y, z, target x, y, z, fov, roll(deg)]. Three shots (cuts at the breach and the logo).
const SHOTS = [
  { t0: 0, t1: T.breach, keys: [
    [0.0, -760, 420, 2300, 180, 70, -2250, 48, -2],
    [2.3, -400, 170, 1250, 70, 80, -2250, 46, -5],
    [4.2, -110, 34, 640, -56, 16, 280, 48, -3],
    [T.clip, -42, 21, 372, -44, 12, 240, 36, 0],
    [6.3, -76, 40, 196, -6, 12, 50, 42, 3],
    [T.boat, -44, 20, 88, 4, 12, 0, 38, 0],
    [8.7, -66, 30, 118, 30, 8, -20, 46, 0],
    [9.2, -6, 24, 46, 70, 0, -40, 50, 0],
    [9.7, 50, 8, -14, 70, -8, -40, 54, 0],
    [10.1, 60, -10, -22, 72, -26, -42, 58, 0],
    [11.2, 40, -30, 18, 72, -42, -44, 52, 0],
    [T.fish, 46, -40, -6, 78, -46, -52, 34, 0],
    [13.0, 30, -48, 34, 74, -58, -62, 48, 0],
    [T.strike, 42, -52, 10, 72, -44, -44, 42, 0],
    [14.7, 52, -44, 18, 74, -18, -58, 50, 3],
    [T.breach, 58, -26, 12, 70, 2, -62, 56, 0],
  ] },
  { t0: T.breach, t1: T.logo, keys: [
    [T.breach, -26, 5, 72, 26, 22, -40, 54, 0],
    [T.logo, -32, 7, 86, 22, 26, -40, 50, 0],
  ] },
  { t0: T.logo, t1: 99, keys: [
    [T.logo, 0, 46, 360, 0, 96, -400, 50, 0],
    [END, 0, 50, 310, 0, 98, -400, 46, 0],
  ] },
];

// Fish used by the opening (ids from fish/species.js; the first that exists wins).
const SCHOOL_IDS = [['zebrafish', 'guppy', 'pixel'], ['guppy', 'pixel', 'zebrafish']];
const FIRST_IDS = ['sneakerhead', 'koi', 'grouper', 'bubblepuff'];
const BIG_IDS = ['bruce', 'gottagofast', 'dragonkarp', 'koi', 'grouper'];

// ------------------------------------------------------------------------------------------------ helpers
const DEG = Math.PI / 180;
const inv = (a, b, t) => clamp01((t - a) / (b - a));
function norm3(v) { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }
const add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scl3 = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const mix3 = (a, b, k) => [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];
const hexLin = (h) => { const s = h.replace('#', ''); const v = parseInt(s, 16); return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255].map((c) => c * c); };

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
  // holds (beat keys) get zero tangents so the camera settles on them
  const tan = (k, j) => {
    if (BEATS.some((id) => Math.abs(keys[k][0] - T[id]) < 1e-6)) return 0;
    const p = keys[Math.max(0, k - 1)], q = keys[Math.min(n - 1, k + 1)];
    return q[0] === p[0] ? 0 : (q[j] - p[j]) / (q[0] - p[0]);
  };
  const out = [];
  for (let j = 1; j < a.length; j++) out.push(h00 * a[j] + h10 * h * tan(i, j) + h01 * b[j] + h11 * h * tan(i + 1, j));
  return out;
}

// ------------------------------------------------------------------------------------------- voxel models
function islandModel() {
  const { NX, NY, NZ } = ISLE;
  const m = new VoxelModel(NX, NY, NZ);
  const C = (c, o = {}) => m.color(c, { jitter: 0.035, spec: 0.35, specPow: 10, ...o });
  const G = ['#1f8a34', '#2ea83c', '#43bf42', '#62d44c', '#8ee65e', '#bdf486'].map((c, i) => C(c, { spec: 0.25 + i * 0.06 }));
  const sheen = C('#e6ffc0', { spec: 0.8, specPow: 14 });
  const sand = C('#fff1cc', { spec: 0.25 }), sandD = C('#e8d3a0'), wet = C('#7fd8e0', { spec: 0.7 });
  const fl = [C('#ffffff', { emissive: 0.15 }), C('#ffe23a', { emissive: 0.15 }), C('#ff8ad0', { emissive: 0.15 }), C('#8ad8ff', { emissive: 0.15 }), C('#ff5a5a', { emissive: 0.1 })];
  const cx = NX * 0.5, cz = NZ * 0.55;
  const hill = (x, z) => {
    const X = x / NX, Z = z / NZ;
    let h = 1.0 * Math.exp(-(((X - 0.6) / 0.25) ** 2) - (((Z - 0.42) / 0.38) ** 2));
    h += 0.56 * Math.exp(-(((X - 0.25) / 0.16) ** 2) - (((Z - 0.5) / 0.32) ** 2));
    h += 0.2 * Math.exp(-(((X - 0.86) / 0.09) ** 2) - (((Z - 0.4) / 0.28) ** 2));
    h += 0.04 * Math.sin(X * 17 + Z * 4) * smoothstep(0.2, 0.8, Z);
    return h;
  };
  const H = new Float32Array(NX * NZ);
  for (let z = 0; z < NZ; z++) for (let x = 0; x < NX; x++) {
    const dx = (x + 0.5 - cx) / (NX * 0.5), dz = (z + 0.5 - cz) / (NZ * 0.46);
    const r = Math.hypot(dx, dz) + (fbm2(x * 0.05, z * 0.09, 2, 7) - 0.5) * 0.18;
    if (r > 1) { H[z * NX + x] = -1; continue; }
    const coast = smoothstep(1, 0.8, r);
    H[z * NX + x] = 1 + coast * hill(x, z) * (NY - 8) + coast * 4.5;
  }
  const at = (x, z) => (x < 0 || z < 0 || x >= NX || z >= NZ ? -1 : H[z * NX + x]);
  const hmap = new Uint8Array(NX * NZ);
  for (let z = 0; z < NZ; z++) for (let x = 0; x < NX; x++) {
    const h = at(x, z);
    if (h < 0) continue;
    const top = Math.max(1, Math.round(h));
    hmap[z * NX + x] = clamp(Math.round(((top - ISLE.sink) * ISLE.vox + 64) / (NY * ISLE.vox) * 255), 1, 255);
    const lo = Math.max(0, Math.min(top - 2, Math.round(Math.min(at(x + 1, z), at(x - 1, z), at(x, z + 1), at(x, z - 1))) - 1));
    const nx = at(x + 1, z) - at(x - 1, z), nz = at(x, z + 1) - at(x, z - 1);
    const lit = clamp01(0.55 - nx * 0.09 + nz * 0.05);
    const shore = top <= ISLE.sink + 2;
    for (let y = lo; y < top; y++) {
      let c;
      if (shore) c = y < ISLE.sink ? wet : y === top - 1 ? sand : sandD;
      else if (y < ISLE.sink + 2) c = y < ISLE.sink ? wet : sand;
      else {
        const k = clamp01(y / (NY - 6));
        c = G[clamp(Math.round(k * 2.6 + lit * 2.4 + (fbm2(x * 0.11, z * 0.13, 2, 3) - 0.5) * 1.6), 0, 5)];
        if (y === top - 1) {
          if (lit > 0.62 && k > 0.35 && hash2(x >> 1, z >> 1, 4) < 0.55) c = sheen;
          if (hash2(x, z, 9) < 0.014 && k < 0.75) c = fl[Math.floor(hash2(z, x, 2) * fl.length)];
        }
      }
      m.set(x, y, z, c);
    }
  }
  return { m, hmap, at };
}

function turbineModel() {
  const m = new VoxelModel(11, 70, 11);
  const w = m.color('#f4fbff', { spec: 0.9, specPow: 18, smooth: 1, jitter: 0.01 }), g = m.color('#d6e6f2', { spec: 0.6 });
  const aq = m.color('#2fd3e8', { spec: 1, emissive: 0.35 });
  for (let y = 0; y < 62; y++) { const r = lerp(2.6, 1.4, y / 62); m.cylinder(5.5, 5.5, y, y, r, y < 4 ? aq : y % 18 === 0 ? g : w); }
  m.box(3, 61, 2, 7, 65, 9, w);
  m.box(4, 62, 9, 6, 64, 10, g);
  return m;
}

function rotorModel() {
  const m = new VoxelModel(61, 61, 5);
  const w = m.color('#ffffff', { spec: 1, specPow: 20, smooth: 1, jitter: 0.01 }), tip = m.color('#2fd3e8', { spec: 1, emissive: 0.3 });
  const hub = m.color('#c8d8e6', { spec: 1 });
  for (let b = 0; b < 3; b++) {
    const a = (b / 3) * TAU + 0.3;
    for (let k = 2; k < 29; k += 0.5) {
      const wd = k < 6 ? 1.6 : lerp(2.2, 0.8, (k - 6) / 23);
      for (let j = -wd; j <= wd; j += 0.5) {
        const x = 30 + Math.cos(a) * k - Math.sin(a) * j * 0.8, y = 30 + Math.sin(a) * k + Math.cos(a) * j * 0.8;
        m.set(x, y, 2, k > 25 ? tip : w);
      }
    }
  }
  m.sphere(30, 30, 2.5, 2.4, hub);
  return m;
}

function cityModel() {
  const m = new VoxelModel(44, 60, 44);
  const glass = ['#7fe6ff', '#4cc8f4', '#2a9ae0', '#bff6ff'].map((c) => m.color(c, { spec: 1.3, specPow: 24, smooth: 1, jitter: 0.02 }));
  const win = m.color('#ffffff', { emissive: 0.7, spec: 1 }), lime = m.color('#9ef05a', { spec: 0.6 }), base = m.color('#e8f6ff', { spec: 0.5 });
  m.cylinder(22, 22, 0, 2, 20, base);
  m.cylinder(22, 22, 3, 3, 19, lime);
  const r = new RNG(5);
  const towers = [[22, 22, 56, 5], [12, 18, 34, 4], [31, 14, 40, 4], [15, 31, 28, 4], [30, 30, 46, 4.5], [22, 9, 24, 3], [8, 26, 18, 3], [35, 23, 22, 3]];
  for (const [x, z, h, rr] of towers) {
    const c = glass[r.int(0, 2)];
    for (let y = 4; y < h; y++) {
      const rad = y > h - 6 ? rr * (1 - (y - (h - 6)) / 8) : rr;
      m.cylinder(x, z, y, y, rad, (vx, vy, vz) => ((vy % 4 === 0 && (vx + vz) % 2 === 0) ? win : vy > h - 3 ? glass[3] : c));
    }
  }
  return m;
}

function globeModel() {
  const R = 22, n = R * 2 + 3;
  const m = new VoxelModel(n, n, n);
  const sea = m.color('#2fc8f0', { spec: 1.2, specPow: 20, smooth: 1, emissive: 0.15 });
  const seaD = m.color('#1a90d8', { spec: 1.1, specPow: 20, smooth: 1, emissive: 0.1 });
  const land = ['#2fa83c', '#4cc84a', '#7ae05a', '#c8f88a'].map((c) => m.color(c, { spec: 0.9, specPow: 16, smooth: 1, emissive: 0.18 }));
  const c = n / 2;
  m.sphere(c, c, c, R, (x, y, z) => {
    const dx = x + 0.5 - c, dy = y + 0.5 - c, dz = z + 0.5 - c;
    const lon = Math.atan2(dz, dx), lat = Math.asin(dy / Math.max(1, Math.hypot(dx, dy, dz)));
    const k = fbm2(lon * 1.6 + 3, lat * 2.2 + 1, 4, 11);
    if (k > 0.53) return land[clamp(Math.floor((k - 0.53) * 14), 0, 3)];
    return k > 0.47 ? sea : seaD;
  });
  return m;
}

function cloudModel(seed) {
  const r = new RNG(seed);
  const m = new VoxelModel(44, 18, 26);
  const W = m.color('#ffffff', { spec: 0.2, emissive: 0.45 }), G = m.color('#eef8ff', { spec: 0.1, emissive: 0.3 }), B = m.color('#cfe8ff', { emissive: 0.2 });
  const n = r.int(5, 8);
  for (let i = 0; i < n; i++) {
    const x = 8 + (i / (n - 1)) * 28 + r.float(-2, 2), rr = r.float(4.5, 8) * (1 - Math.abs(i / (n - 1) - 0.5) * 0.6);
    m.ellipsoid(x, rr * 0.8 + 1, 13 + r.float(-3, 3), rr, rr * 0.85, rr * 0.9, (vx, vy) => (vy > rr * 0.9 ? W : vy > 3 ? G : B));
  }
  return m;
}

function bobberModel() {
  const m = new VoxelModel(9, 13, 9);
  const red = m.color('#ff3a4a', { spec: 1.2, specPow: 20, smooth: 1 }), white = m.color('#ffffff', { spec: 1.2, specPow: 20, smooth: 1 });
  const stick = m.color('#ffd23a', { emissive: 0.6 });
  m.sphere(4.5, 4.5, 4.5, 4, (x, y) => (y >= 5 ? red : white));
  m.box(4, 8, 4, 4, 12, 4, stick);
  return m;
}

function lureModel() {
  const m = new VoxelModel(16, 7, 5);
  const ch = ['#4a7aa0', '#9ad8f0', '#f0fcff'].map((c) => m.color(c, { spec: 1.4, specPow: 26, smooth: 1 }));
  const aq = m.color('#2fe0f0', { emissive: 0.6, spec: 1 }), hook = m.color('#d0dae6', { spec: 1.2 });
  m.ellipsoid(7, 3.5, 2.5, 6, 2.6, 1.4, (x, y) => ch[y > 4 ? 2 : y > 2 ? 1 : 0]);
  m.sphere(3, 3.5, 2.5, 1.2, aq);
  m.line(12, 3, 2, 15, 3, 2, hook); m.line(15, 3, 2, 15, 1, 2, hook); m.line(15, 1, 2, 13.5, 1.5, 2, hook);
  return m;
}

// The underwater (OS)cean meadow: rolling green hills, grass tufts and flowers (only grass and flowers).
function seabedModel() {
  const { NX, NZ } = SEABED;
  const NY = 30;
  const m = new VoxelModel(NX, NY, NZ);
  const C = (c, o = {}) => m.color(c, { jitter: 0.05, spec: 0.3, ...o });
  const G = ['#1e7a3a', '#2a9a44', '#3cb84c', '#5ad05a', '#86e46a'].map((c) => C(c));
  const grass = [C('#5ae06a', { spec: 0.4 }), C('#8ff07a', { spec: 0.5 }), C('#3cc860')];
  const fl = [C('#ffffff', { emissive: 0.35 }), C('#ffe24a', { emissive: 0.35 }), C('#ff8ad0', { emissive: 0.35 }), C('#7fd8ff', { emissive: 0.4 })];
  const sand = C('#e8f0c0');
  const h = (x, z) => 8 + (fbm2(x * 0.018, z * 0.018, 3, 21) - 0.5) * 26 + Math.sin(x * 0.03) * 3;
  const Hm = new Float32Array(NX * NZ);
  for (let z = 0; z < NZ; z++) for (let x = 0; x < NX; x++) Hm[z * NX + x] = clamp(h(x, z), 2, NY - 8);
  const at = (x, z) => Hm[clamp(z, 0, NZ - 1) * NX + clamp(x, 0, NX - 1)];
  for (let z = 0; z < NZ; z++) for (let x = 0; x < NX; x++) {
    const top = Math.round(at(x, z));
    const lo = Math.max(0, Math.round(Math.min(at(x + 1, z), at(x - 1, z), at(x, z + 1), at(x, z - 1))) - 1);
    for (let y = Math.min(lo, top - 1); y < top; y++) {
      const k = clamp01((y - 2) / 18);
      m.set(x, y, z, hash2(x, z, 3) < 0.04 && y === top - 1 ? sand : G[clamp(Math.round(k * 3 + (hash2(x >> 2, z >> 2, 8) - 0.5) * 1.5), 0, 4)]);
    }
    const r = hash2(x, z, 17);
    if (r < 0.1) {
      const gh = 1 + Math.floor(hash2(z, x, 2) * 3);
      for (let y = 0; y < gh; y++) m.set(x, top + y, z, grass[(x + z + y) % 3]);
      if (r < 0.022) m.set(x, top + gh, z, fl[Math.floor(hash2(x, z, 6) * fl.length)]);
    }
  }
  return m;
}

// ================================================================================================= Intro3D
export class Intro3D {
  constructor(o = {}) {
    this.o = o;
    this.T = INTRO_T;
    this.input = o.input || null;
    this.audio = o.audio || null;
    this.look = o.look || null;
    this.active = true;
    this.ready = false;
    this.t = 0;
    this.wall = 0;
    this.bootT = 0;
    this.skipT = -1;
    this.handed = false;
    this.cues = new Set();
    this.rng = new RNG(4242);
    this.A = {};
    this.picks = { mood: null, name: null, hull: null, bait: null };
    this.holding = null;
    this.holdT = 0;
    this.beatsDone = new Set();
    this.texts = [];
    this.parts = [];
    this.drops = [];
    this.sbubs = [];
    this.shake = 0;
    this.flashT = -9;
    this.zoomT = -9;
    this.boatKey = null;
    this.fish = null;
    loadAlagard();
    this.dlg = new Dialogue({
      audio: this.audio, voice: 'clip', name: 'Clip', vars: { name: 'Angler' },
      portrait: (ctx, cx, cy, r, d) => NPC.drawNPC(ctx, 'clip', { x: cx + 1, y: cy + r * 1.45, t: this.wall, scale: r / 30, talk: d.talk, mood: d.mood, pose: 'talk', bubble: false, id: 'portrait' }),
    });
    this.resize(o.W || 960, o.H || 540);
  }

  get dialogue() { return this.dlg; }
  get opaque() { return this.active && this.skipT < 0 && (!this.ready || this.t < T.out0 + 0.4); }
  choiceRects() { return this.dlg.choiceRects(); }
  choose(i) { return this.dlg.choose(i); }

  resize(W, H) {
    W = Math.max(64, Math.round(W)); H = Math.max(64, Math.round(H));
    if (W === this.W && H === this.H) return;
    this.W = W; this.H = H;
    this.u = H / 540;
    if (this.E) this.E.resize(W, H);
    if (!this.tasks) this.tasks = this.buildTasks();
    this.atlasC = this.atlasC || makeCanvas(2048, 1024);
    this.atlasG = this.atlasG || ctxOf(this.atlasC);
  }

  // ---------------------------------------------------------------------------------- progressive assets
  buildTasks() {
    const out = [];
    const add = (need, name, fn) => out.push({ need, name, fn });
    add(0, 'gl', () => {
      this.E = createVoxGL(this.W, this.H, { lowPower: !!this.o.lowPower });
      this.gl = !!this.E;
    });
    add(0, 'island', () => this.buildIsland());
    add(0, 'props', () => this.buildProps());
    add(0, 'boat', () => this.buildBoat());
    add(0, 'bits', () => this.buildBits());
    add(0, 'fish', () => this.buildFish());
    add(0, 'font', () => (alagardReady() || this.bootT > 3 ? undefined : 'again'));
    add(0.3, 'seabed', () => this.buildSeabed());
    add(0.5, 'logo', () => this.buildLogo());
    add(1, 'clip', () => { try { NPC.warmNPC?.('clip', { scale: 2.5, facing: 1 }); } catch (e) { /* optional */ } });
    add(3, 'char', () => this.warmCharacter());
    return out;
  }

  runTasks(budgetMs, horizon = 0.5) {
    const t0 = performance.now();
    let i = 0;
    while (i < this.tasks.length) {
      const job = this.tasks[i];
      if (job.need > horizon && performance.now() - t0 > budgetMs * 0.5) { i++; continue; }
      if (performance.now() - t0 > budgetMs) break;
      let again = false;
      try { again = job.fn() === 'again'; } catch (e) { console.warn('intro asset ' + job.name, e); }
      if (!again) this.tasks.splice(i, 1);
      else i++;
    }
    if (!this.tasks.some((j) => j.need <= 0.5)) this.ready = true;
  }

  mesh(model, o) { return this.E ? this.E.mesh(model, o) : null; }

  buildIsland() {
    const I = islandModel();
    const { NX, NY, NZ, vox } = ISLE;
    this.isle = I;
    // model origin: centre of the footprint at sea level
    this.A.isle = this.mesh(I.m, { scale: vox, origin: [NX / 2, 0, NZ / 2] });
    this.E?.heightmap(I.hmap, NX, NZ, [ISLE.x - (NX / 2) * vox, ISLE.z - (NZ / 2) * vox, NX * vox, NZ * vox], [NY * vox, 64]);
  }

  // world point on the island surface at model fractions (xf, zf)
  islePoint(xf, zf) {
    const { NX, NZ, vox } = ISLE;
    const x = Math.floor(xf * NX), z = Math.floor(zf * NZ);
    const h = Math.max(0, this.isle?.at(x, z) ?? 0);
    return [ISLE.x + (x - NX / 2) * vox, (h - ISLE.sink) * vox, ISLE.z + (z - NZ / 2) * vox];
  }

  buildProps() {
    const P = (this.A.props = { turbines: [], clouds: [] });
    P.tower = this.mesh(turbineModel(), { scale: 3.2, origin: [5.5, 0, 5.5] });
    P.rotor = this.mesh(rotorModel(), { scale: 3.2, origin: [30, 30, 2.5] });
    for (const [xf, zf, s] of [[0.66, 0.36, 1], [0.75, 0.43, 0.95], [0.84, 0.5, 0.9], [0.4, 0.4, 0.92], [0.5, 0.62, 0.85], [0.58, 0.24, 0.8]]) {
      const p = this.islePoint(xf, zf);
      P.turbines.push({ p, s, ph: xf * 7, yaw: -0.5 });
    }
    P.city = this.mesh(cityModel(), { scale: 3.4, origin: [22, 0, 22] });
    P.cityAt = this.islePoint(0.2, 0.5);
    P.globe = this.mesh(globeModel(), { scale: 12, origin: [23.5, 23.5, 23.5] });
    P.globeAt = [1750, 820, -4600];
    const cloudMeshes = [1, 2, 3, 4].map((s) => this.mesh(cloudModel(s), { scale: 34, origin: [22, 0, 13] }));
    const r = new RNG(77);
    for (let i = 0; i < 11; i++) P.clouds.push({ mesh: cloudMeshes[i % 4], p: [r.float(-7000, 7000), r.float(700, 2400), r.float(-12000, -5200)], s: r.float(0.8, 1.5), yaw: r.float(-0.6, 0.6) });
  }

  boatParts() { const st = this.o.boat || {}; return { tier: st.tier | 0, parts: { ...(st.parts || {}), ...(this.picks.hull ? { hull: this.picks.hull } : {}) } }; }

  buildBoat() {
    const { tier, parts } = this.boatParts();
    const key = tier + JSON.stringify(parts);
    if (key === this.boatKey) return;
    let T0 = null;
    try { T0 = BM.buildBoatModel(tier, null, null, parts); } catch (e) { try { T0 = BM.buildBoatModel(0, null, null, null); } catch (e2) { T0 = null; } }
    if (!T0) return;
    if (this.A.boat) this.E?.freeMesh(this.A.boat.mesh);
    const piv = [T0.pivot[0], T0.wl ?? T0.pivot[1], T0.zc + 0.5];
    const stand = T0.A?.stand || [T0.pivot[0] - 6, (T0.wl ?? 3) + 4, T0.zc];
    this.A.boat = { mesh: this.mesh(T0.m, { origin: piv }), stand: sub3([stand[0] + 0.5, stand[1], stand[2] + 0.5], piv), T: T0 };
    this.boatKey = key;
  }

  buildBits() {
    this.A.bobber = this.mesh(bobberModel(), { scale: 0.7, origin: [4.5, 4, 4.5] });
    this.A.lure = this.mesh(lureModel(), { scale: 0.24, origin: [1, 3.5, 2.5] });
  }

  buildSeabed() {
    if (!this.E) return;
    const { NX, NZ, vox } = SEABED;
    this.A.seabed = this.mesh(seabedModel(), { scale: vox, origin: [0, 0, 0] });
  }

  buildLogo() {
    if (!this.E) return alagardReady() ? undefined : 'again';
    const a = buildText3D('FISH', { size: 16, px: 2, depth: 6, palette: 'logoBlue', outline: 0.5 });
    const b = buildText3D('TOP', { size: 16, px: 2, depth: 6, palette: 'logoGreen', outline: 0.5 });
    if (!a || !b) return this.bootT > 3 ? undefined : 'again';
    this.A.logo = [a, b];
    return undefined;
  }

  warmCharacter() {
    if (typeof CHAR.warmCharacter !== 'function') return undefined;
    this.warmN = (this.warmN || 0) + 1;
    let done = true;
    try { done = CHAR.warmCharacter(this.look, { poses: ['idle', 'cast', 'reel', 'cheer'], scale: 1, facing: 1, ms: 10 }); } catch (e) { done = true; }
    return !done && this.warmN < 200 ? 'again' : undefined;
  }

  buildFish() {
    const pick = (ids) => { for (const id of ids) { const sp = SPEC.SPECIES_BY_ID?.[id]; if (sp) return sp; } return SPEC.SPECIES?.[0] || null; };
    const make = (sp, len) => {
      if (!sp) return null;
      try {
        const c = SC.compiled(sp.look, null, sp.id);
        const g = ART.rigGeom(c, { sw: 0, angle: 0, scale: 1, inflate: 0, still: true });
        return { sp, c, gw: Math.max(8, g.w || 30), gh: Math.max(6, g.h || 20), len };
      } catch (e) { console.warn('intro fish', e); return null; }
    };
    this.fish = { school: SCHOOL_IDS.map((ids) => make(pick(ids), 6)).filter(Boolean), first: make(pick(FIRST_IDS), 15), big: make(pick(BIG_IDS), 44) };
    const r = new RNG(9);
    const sch = (n, f, o) => ({ f, ...o, m: Array.from({ length: n }, () => ({ d: [r.float(-1, 1) * o.sx, r.float(-1, 1) * o.sy, r.float(-1, 1) * o.sz], ph: r.float(0, 1), sp: r.float(0.85, 1.15) })) });
    this.schools = [];
    const F = this.fish;
    if (F.school[0]) {
      this.schools.push(sch(16, F.school[0], { a: [-120, -34, -30], b: [260, -38, -70], t0: T.plunge, t1: T.fish + 1.5, sx: 26, sy: 8, sz: 14 }));
      this.schools.push(sch(14, F.school[1] || F.school[0], { a: [300, -70, -150], b: [-120, -64, -110], t0: T.plunge, t1: T.strike + 1, sx: 34, sy: 12, sz: 24 }));
      this.schools.push(sch(10, F.school[0], { a: [-60, -24, 10], b: [200, -20, -24], t0: T.fish + 0.2, t1: T.strike + 0.8, sx: 14, sy: 5, sz: 6 }));
      this.schools.push(sch(12, F.school[1] || F.school[0], { a: [-200, -100, -260], b: [260, -110, -300], t0: T.under, t1: T.breach, sx: 40, sy: 16, sz: 30 }));
    }
  }

  // ---------------------------------------------------------------------------------- control
  seek(t) {
    while (this.tasks.length) this.runTasks(1e9, 1e9);
    this.t = t;
    this.ready = true;
    this.bootFade = -9;
    this.holding = null;
    this.dlg.clear();
    this.texts = [];
    for (const k of Object.keys(T)) if (T[k] < t - 0.05) this.cues.add(k); else this.cues.delete(k);
    for (const b of BEATS) if (T[b] < t - 0.05) this.beatsDone.add(b); else this.beatsDone.delete(b);
    if (t > T.logo - 0.05) this.cues.delete('logo');
  }

  skip() {
    if (this.skipT >= 0 || !this.active) return;
    this.skipT = 0;
    this.sfx('travel_whoosh', { vol: 0.5 });
    this.dlg.clear();
  }

  skipRect() { const w = 64, h = 20; return { x: this.W - w - 10, y: 8, w, h }; }

  sfx(name, o) { try { this.audio?.play?.(name, o); } catch (e) { /* audio is optional */ } }

  cue(name, at) {
    if (this.cues.has(name) || this.t < at) return false;
    this.cues.add(name);
    return true;
  }

  pick(key, value) {
    this.picks[key] = value;
    try { this.o.onChoice?.(key, value, { ...this.picks }); } catch (e) { console.warn(e); }
  }

  // ---------------------------------------------------------------------------------- the beats
  beat(id) {
    this.holding = id;
    this.holdT = 0;
    this.zoomT = this.wall;
    this.sfx('travel_whoosh', { vol: 0.5, pitch: 1.5 });
    this.sfx('sparkle', { vol: 0.35 });
    const d = this.dlg;
    const done = () => { this.beatsDone.add(id); this.holding = null; this.releaseT = this.wall; };
    const smug = this.picks.mood === 'smug', shy = this.picks.mood === 'surprised';
    if (id === 'clip') {
      this.say3D('HELLO!', { palette: 'aqua', anchor: 'clip', dx: 1.5, dy: 0.05, size: 0.12, life: 4.2, px: 2 });
      d.script([
        { text: 'Whoa! A new angler in the (OS)cean!', mood: 'excited', pose: 'wave', hold: 1.4 },
        { text: "I'm Clip. I hold things together... mostly fishing lines.", mood: 'happy', pose: 'talk', choices: [
          { text: 'Hi, Clip!', value: 'happy', mood: 'happy', reply: "Aww, a polite one! We'll be great pals." },
          { text: 'A talking paperclip?', value: 'smug', mood: 'smug', reply: 'A talking FISHING paperclip. Totally different.' },
          { text: 'Can you even fish?', value: 'surprised', mood: 'surprised', reply: "Can I fish?! I'm basically a hook with ambition!" },
        ], onChoose: (c) => { this.pick('mood', c.value); this.response(c.text); } },
        { text: 'So... what should I call you?', mood: 'happy', pose: 'point', choices: [
          { text: 'Captain Bubbles', value: 'Captain Bubbles' }, { text: 'Reel Deal', value: 'Reel Deal' }, { text: 'Finn', value: 'Finn' },
        ], onChoose: (c) => {
          this.pick('name', c.value);
          d.vars.name = c.value;
          this.say3D(c.value.toUpperCase(), { palette: 'leaf', anchor: 'clip', dx: 1.5, dy: 0.05, size: 0.1, life: 3.2, px: 2 });
          d.queue.unshift({ raw: '{name}! I love it. Come on, your boat is waiting!', mood: 'excited', pose: 'cheer', hold: 1.2 });
        } },
      ], done);
    } else if (id === 'boat') {
      this.say3D('PAINT JOB!', { palette: 'sky', anchor: 'boat', dx: 0.35, dy: 0.62, size: 0.09, life: 4, px: 2 });
      d.script([
        { text: smug ? "That's your boat. Cute. A bit plain, though." : "That's your boat! Cute, but it needs a fresh coat.", mood: smug ? 'smug' : 'happy', pose: 'point', hold: 1.2 },
        { text: 'Pick a colour, {name}!', mood: 'excited', pose: 'talk', choices: [
          { text: 'Aqua Gloss', value: 'aqua', reply: 'Classic! Shiny like a soap bubble.' },
          { text: 'Leaf Green', value: 'leaf', reply: 'So eco! The turbines approve.' },
          { text: 'Coral Reef', value: 'coral', reply: 'Bold! The fish will see you coming.' },
        ], onChoose: (c) => { this.pick('hull', c.value); this.repaint(); this.response(c.text); } },
        { text: 'Now watch the line...', mood: 'happy', pose: 'point', hold: 0.6 },
      ], done);
    } else if (id === 'fish') {
      this.say3D('FIRST FISH!', { palette: 'aqua', anchor: 'first', dx: 0.2, dy: 0.85, size: 0.1, life: 4, px: 2 });
      d.script([
        { text: shy ? 'Look! A real fish! Okay, okay, stay calm...' : 'Look, {name}! Your very first fish!', mood: 'excited', pose: 'point', hold: 1.2 },
        { text: "Fish are picky eaters. What's on the menu?", mood: 'happy', pose: 'think', choices: [
          { text: 'Bread Crumbs', value: 'crumbs', reply: 'Crunchy and classic. Every fish loves a snack.' },
          { text: 'Glowing Worm', value: 'worm', reply: 'Wiggly AND glowing? Irresistible!' },
          { text: 'Sugar Cube', value: 'sugar', reply: 'Sweet! A fish with a sweet tooth, coming up.' },
        ], onChoose: (c) => { this.pick('bait', c.value); this.response(c.text); } },
        { text: 'Wait... something BIG is coming!', mood: 'surprised', pose: 'point', hold: 0.5 },
      ], done);
    } else if (id === 'final') {
      d.script([
        { text: smug ? "Not bad for a beginner, {name}. Not bad at all." : "That's the spirit, {name}! The (OS)cean is all yours.", mood: 'excited', pose: 'cheer', hold: 1.2 },
        { text: "I'll stick around and show you the ropes. Ready?", mood: 'happy', pose: 'wave', choices: [
          { text: "Let's fish!", value: 'go' }, { text: 'Born ready!', value: 'go' },
        ], onChoose: (c) => this.response(c.text) },
      ], done);
    }
    // never stall the story: a slow default after a long idle
    for (const l of d.queue) if (l.choices?.length) l.autoPick = 40;
    if (d.line?.choices?.length) d.line.autoPick = 40;
  }

  // the player's response flies into the scene as glossy 3D text
  response(text) {
    this.say3D(text.toUpperCase().replace(/[?!.]+$/, '') + '!', { palette: 'white', anchor: 'cam', dx: 0, dy: -0.25, size: 0.075, life: 1.6, px: 1, fly: 1 });
    this.burst2D(this.W / 2, this.H * 0.62, 16);
  }

  repaint() {
    this.buildBoat();
    this.sfx('magic', { vol: 0.5 }); this.sfx('sparkle', { vol: 0.5 });
    const b = [0, 10, 0];
    for (let i = 0; i < 70; i++) {
      const a = this.rng.float(0, TAU), r = this.rng.float(4, 26);
      this.parts.push({ x: b[0] + Math.cos(a) * r, y: b[1] + this.rng.float(-4, 18), z: b[2] + Math.sin(a) * r * 0.5, vx: Math.cos(a) * 8, vy: this.rng.float(6, 30), vz: Math.sin(a) * 4, g: -20, size: this.rng.float(0.8, 2.2), c: [1.4, 1.5, 1.2, 1], kind: 2, life: this.rng.float(0.6, 1.4), t: 0, spin: this.rng.float(0, 3) });
    }
  }

  // spawn floating 3D text: anchor = 'clip' | 'boat' | 'first' | 'cam' | [x, y, z]; dx / dy offsets in subject sizes
  say3D(text, o = {}) {
    if (!this.E) { this.texts.push({ text, o, t0: this.wall, flat: true }); return; }
    const T3 = buildText3D(text, { size: 16, px: o.px ?? 2, depth: o.px === 1 ? 4 : 5, palette: o.palette || 'aqua', outline: o.px === 1 ? 1 : 0.5 });
    if (!T3) return;
    const meshes = T3.letters.map((L) => ({ L, mesh: this.meshFor(L) }));
    this.texts.push({ text, T3, meshes, o, t0: this.wall });
  }

  meshFor(L) {
    this.meshCache ||= new Map();
    let m = this.meshCache.get(L.model);
    if (!m) { m = this.E.mesh(L.model, { origin: [L.model.nx / 2, L.model.ny / 2, L.model.nz / 2] }); this.meshCache.set(L.model, m); }
    return m;
  }

  // ---------------------------------------------------------------------------------- update
  update(dt) {
    if (!this.active) return;
    dt = clamp(dt || 0, 0, 1 / 15);
    const inp = this.input;
    if (!this.ready) {
      this.bootT += dt;
      this.runTasks(this.bootT < 0.1 ? 6 : 26, 0.5);
      if (!this.ready) return;
    }
    this.wall += dt;
    if (inp) {
      const r = this.skipRect();
      this.skipHover = inp.x >= r.x && inp.y >= r.y && inp.x < r.x + r.w && inp.y < r.y + r.h && this.wall > 0.4;
      if (this.skipHover && inp.pressed) { inp.consume?.(); this.skip(); }
      if (inp.keyPressed?.('Escape')) this.skip();
    }
    if (this.skipT >= 0) {
      this.skipT += dt;
      if (!this.handed) { this.handed = true; this.o.onHandoff?.(); }
      if (this.skipT > 0.5) this.finish();
      return;
    }
    if (this.tasks.length) this.runTasks(4, this.t + 1.5);
    if (this.t < T.strike + 1) this.touchFish();
    // dialogue (the story waits at beats)
    this.dlg.update(dt, inp, { clickAnywhere: true });
    if (this.holding) {
      this.holdT += dt;
      if (!this.dlg.active) { this.beatsDone.add(this.holding); this.holding = null; this.releaseT = this.wall; }
    }
    // slow-motion moments
    let ts = 1;
    if (this.t > T.strike && this.t < T.strike + 0.5) ts = 0.32;
    const lk = inv(T.breach + 0.1, T.logo - 0.3, this.t);
    if (lk > 0.32 && lk < 0.6) ts = 0.42;
    const sdt = this.holding ? 0 : dt * ts;
    this.t += sdt;
    const t = this.t;
    for (const id of BEATS) if (!this.holding && !this.beatsDone.has(id) && t >= T[id] && t < T[id] + 1.5) { this.t = T[id]; this.beat(id); break; }
    this.shake = Math.max(0, this.shake - dt * 18);
    this.updateCues(t);
    this.updateParts(dt, sdt);
    if (t >= T.out0 && !this.handed) { this.handed = true; this.o.onHandoff?.(); }
    if (t >= END) this.finish();
  }

  finish() {
    if (!this.active) return;
    this.active = false;
    this.dlg.clear();
    try { this.E?.dispose(); } catch (e) { /* ignore */ }
    this.o.onDone?.(this.picks);
  }

  updateCues(t) {
    if (this.cue('start', 0)) { try { this.audio?.setMusic?.(this.o.music || 'oscean'); } catch (e) { /* optional */ } this.sfx('travel_whoosh', { vol: 0.35, pitch: 0.7 }); }
    if (this.cue('pop', T.pop)) {
      this.sfx('bubble', { vol: 0.8 }); this.sfx('boing', { vol: 0.5, pitch: 1.4 });
      this.splash([CLIP_A[0], 0, CLIP_A[2]], 0.5);
      this.bubbleBurst([CLIP_A[0], 4, CLIP_A[2]], 26, 7);
    }
    if (this.cue('swoop', T.swoop)) this.sfx('travel_whoosh', { vol: 0.45, pitch: 1.1 });
    if (this.cue('cast', T.cast + 0.3)) this.sfx('cast', { vol: 0.7 });
    if (this.cue('land', T.land)) { this.sfx('splash_small', { vol: 0.7 }); this.splash(BOBBER, 0.45); this.ripple = { p: BOBBER, t0: this.wall }; }
    if (this.cue('plunge', T.plunge + 0.45)) {
      this.sfx('splash_big', { vol: 0.55 }); this.sfx('bubbles', { vol: 0.7 });
      this.flashT = this.wall; this.flashK = 0.5;
      for (let i = 0; i < 26; i++) this.sbubs.push({ x: this.rng.float(0, 1), y: 1 + this.rng.float(0, 0.4), r: this.rng.float(0.02, 0.09), v: this.rng.float(0.5, 1.1), a: 1, life: 1.8, t: -this.rng.float(0, 0.3) });
    }
    if (this.cue('shadow', T.shadow)) this.sfx('whale_call', { vol: 0.25, pitch: 1.6 });
    if (this.cue('strike', T.strike)) {
      this.sfx('hookset', { vol: 0.9 }); this.sfx('bite', { vol: 0.7 });
      this.shake = 9;
      this.flashT = this.wall; this.flashK = 0.7;
      this.zoomT = this.wall;
      this.bubbleBurst([BOBBER[0] + 2, LURE_Y, BOBBER[2]], 40, 10);
      this.say3D('FISH ON!', { palette: 'gold', anchor: 'cam', dx: 0, dy: 0.22, size: 0.13, life: 2.4, px: 2 });
    }
    if (this.cue('surge', T.surge)) { this.sfx('reel', { vol: 0.6 }); this.sfx('bubbles', { vol: 0.6 }); }
    if (this.cue('breach', T.breach + 0.06)) {
      this.parts.length = 0;
      this.sfx('jump_out', { vol: 0.9 }); this.sfx('splash_big', { vol: 0.9 });
      this.flashT = this.wall; this.flashK = 0.45;
      this.shake = 6;
      this.splash([LEAP.x0, 0, LEAP.z0], 2.4);
      for (let i = 0; i < 10; i++) this.drops.push({ x: this.rng.float(0.08, 0.92), y: this.rng.float(0.12, 0.88), r: this.rng.float(0.025, 0.07), t: -this.rng.float(0, 0.6), life: this.rng.float(1.8, 3), vy: this.rng.float(0.004, 0.02) });
    }
    if (this.cue('apex', T.breach + 0.9)) this.sfx('catch_epic', { vol: 0.55 });
    if (this.cue('down', T.breach + 1.75)) { this.sfx('splash_big', { vol: 0.7 }); this.splash([LEAP.x1, 0, LEAP.z1], 1.8); }
    if (this.cue('logo', T.logo)) {
      this.parts.length = 0; this.drops.length = 0;
      this.sfx('ui_unlock', { vol: 0.6 }); this.sfx('sparkle', { vol: 0.6 });
      this.flashT = this.wall; this.flashK = 1;
      this.logoT = this.wall;
    }
    if (this.cue('flare', T.flare)) this.sfx('golden_shimmer', { vol: 0.5 });
    if (this.cue('out0', T.out0)) {
      this.sfx('bubbles', { vol: 0.8 });
      for (let i = 0; i < 20; i++) this.sbubs.push({ x: this.rng.float(0, 1), y: 1 + this.rng.float(0, 0.6), r: this.rng.float(0.03, 0.1), v: this.rng.float(0.35, 0.7), a: 1, life: 3, t: -this.rng.float(0, 0.8) });
    }
  }

  splash(p, k = 1) {
    const n = Math.round(60 * k + 20);
    for (let i = 0; i < n; i++) {
      const a = this.rng.float(0, TAU), sp = this.rng.float(4, 22) * Math.sqrt(k), up = this.rng.float(14, 46) * Math.sqrt(k);
      this.parts.push({ x: p[0] + Math.cos(a) * 2 * k, y: 0.5, z: p[2] + Math.sin(a) * 2 * k, vx: Math.cos(a) * sp, vy: up, vz: Math.sin(a) * sp, g: -60, size: this.rng.float(0.35, 1.1) * Math.sqrt(k), c: [0.85, 1.05, 1.15, 1], kind: 0, life: this.rng.float(0.7, 1.5), t: 0, drag: 0.4 });
    }
    for (let i = 0; i < 14 * k; i++) {
      const a = this.rng.float(0, TAU), r = this.rng.float(0, 5 * k);
      this.parts.push({ x: p[0] + Math.cos(a) * r, y: this.rng.float(0, 4 * k), z: p[2] + Math.sin(a) * r, vx: Math.cos(a) * 6, vy: this.rng.float(2, 9), vz: Math.sin(a) * 6, g: -2, size: this.rng.float(2.5, 6) * k, c: [1, 1, 1, 0.7], kind: 3, life: this.rng.float(0.6, 1.2), t: 0 });
    }
  }

  bubbleBurst(p, n, spread = 6) {
    for (let i = 0; i < n; i++) this.parts.push({ x: p[0] + this.rng.float(-spread, spread), y: p[1] + this.rng.float(-spread, spread) * 0.5, z: p[2] + this.rng.float(-spread, spread), vx: this.rng.float(-5, 5), vy: this.rng.float(8, 26), vz: this.rng.float(-5, 5), g: 6, size: this.rng.float(0.4, 1.5), c: [0.8, 1, 1.1, 0.9], kind: 1, life: this.rng.float(1, 2.2), t: 0, bub: 1 });
  }

  burst2D(x, y, n) { (this.burst ||= []).push({ x, y, n, t0: this.wall }); }

  updateParts(dt, sdt) {
    const k = sdt > 0 ? sdt : dt * 0.6;
    for (const p of this.parts) {
      p.t += k;
      p.vy += p.g * k;
      if (p.drag) { p.vx *= 1 - p.drag * k; p.vz *= 1 - p.drag * k; }
      if (p.bub) { p.vx += Math.sin(p.t * 6 + p.size * 9) * 10 * k; if (p.y > -0.5) p.t = p.life; }
      p.x += p.vx * k; p.y += p.vy * k; p.z += p.vz * k;
      if (p.kind === 0 && p.y < 0 && p.vy < 0 && !this.under) p.t = p.life;
    }
    this.parts = this.parts.filter((p) => p.t < p.life);
    for (const d of this.drops) { d.t += dt; if (d.t > 0) d.y += d.vy * dt * clamp01(d.t * 2); }
    this.drops = this.drops.filter((d) => d.t < d.life);
    for (const b of this.sbubs) { b.t += dt; if (b.t > 0) { b.y -= b.v * dt; b.x += Math.sin(b.t * 4 + b.r * 50) * 0.02 * dt; } }
    this.sbubs = this.sbubs.filter((b) => b.t < b.life && b.y > -0.2);
    this.texts = this.texts.filter((x) => this.wall - x.t0 < (x.o.life ?? 3) + 0.6);
    // ambient underwater bubbles around the camera
    if (this.cam && this.cam.eye[1] < -2 && this.parts.length < 500 && Math.random() < 0.6) {
      const e = this.cam.eye, f = this.camFwd || [0, 0, -1];
      const p = add3(e, add3(scl3(f, this.rng.float(45, 170)), [this.rng.float(-70, 70), this.rng.float(-40, 10), this.rng.float(-70, 70)]));
      if (p[1] < -4) this.parts.push({ x: p[0], y: p[1], z: p[2], vx: 0, vy: this.rng.float(6, 16), vz: 0, g: 2, size: this.rng.float(0.3, 1.0), c: [0.75, 1, 1.1, 0.7], kind: 1, life: 4, t: 0, bub: 1 });
    }
  }

  // ---------------------------------------------------------------------------------- the camera
  shotAt(t) { for (let i = 0; i < SHOTS.length; i++) if (t < SHOTS[i].t1 || i === SHOTS.length - 1) return i; return SHOTS.length - 1; }

  camera(t) {
    const si = this.shotAt(t);
    const [ex, ey, ez, tx, ty, tz, fov0, roll] = spline(SHOTS[si].keys, t);
    let eye = [ex, ey, ez], target = [tx, ty, tz], fov = fov0;
    // holding on a beat: a slow drift around the subject and a gentle push-in
    const hk = this.holding ? this.holdT : this.releaseT != null ? -Math.max(0, 0.8 - (this.wall - this.releaseT)) : 0;
    if (this.holding) {
      // orbit both the eye and the aim point slowly around the subject, easing a little closer
      const piv = this.subject(this.holding, t) || target;
      const a = Math.sin(this.holdT * 0.3) * 0.07, push = 1 - 0.06 * smoothstep(0, 7, this.holdT);
      const ca = Math.cos(a), sa = Math.sin(a);
      const rot = (p, k) => { const d = sub3(p, piv); return add3(piv, scl3([d[0] * ca - d[2] * sa, d[1] + Math.sin(this.holdT * 0.5) * 0.6, d[0] * sa + d[2] * ca], k)); };
      eye = rot(eye, push); target = rot(target, 1);
    }
    void hk;
    // crash zoom when a beat starts (and the strike)
    const zk = 1 - ease.outCubic(clamp01((this.wall - this.zoomT) / 0.6));
    fov *= 1 + 0.5 * zk;
    if (this.shake > 0) { const s = this.shake * 0.08; target = add3(target, [(Math.random() - 0.5) * s, (Math.random() - 0.5) * s, 0]); }
    return { eye, target, fov, roll: roll * DEG, shot: si, near: si === 0 && t < 4 ? 4 : 1, far: 42000, zoom: zk };
  }

  // the subject of a beat (the camera orbits it while it holds)
  subject(id, t) {
    if (id === 'clip') return this.clipPos(t) || CLIP_A;
    if (id === 'boat') return [0, 12, 0];
    if (id === 'fish') return this.firstFishPos(t) || [86, -46, -54];
    if (id === 'final') return LOGO;
    return null;
  }

  // ---------------------------------------------------------------------------------- the cast
  clipPos(t) {
    if (t < T.pop) return null;
    if (t < T.swoop) {
      const k = inv(T.pop, T.pop + 0.6, t);
      const y = k < 1 ? lerp(-8, CLIP_A[1], ease.outBack(k)) : CLIP_A[1];
      return [CLIP_A[0], y, CLIP_A[2]];
    }
    if (t < T.boat) {
      const k = ease.inOutCubic(inv(T.swoop + 0.2, T.boat - 0.2, t));
      const p = mix3(CLIP_A, CLIP_B, k);
      p[1] += Math.sin(k * Math.PI) * 26;
      return p;
    }
    if (t < T.plunge + 0.35) return add3(CLIP_B, [0, 0, 0]);
    if (t < T.breach) {
      const k = ease.inOutCubic(inv(T.plunge + 0.35, T.under + 0.4, t));
      return mix3([CLIP_B[0] + 40, -10, CLIP_B[2] - 40], CLIP_C, k);
    }
    if (t < T.logo) return [-25, 4, 24];
    const k = ease.outBack(inv(T.logo + 0.4, T.logo + 1.2, t));
    return mix3([CLIP_D[0] - 30, CLIP_D[1] - 60, CLIP_D[2]], CLIP_D, k);
  }

  clipPose(t) {
    const d = this.dlg;
    if (this.holding && d.line) return { pose: d.pose || 'talk', mood: d.mood, talk: d.talk };
    if (t < T.pop + 0.8) return { pose: 'cheer', mood: 'excited', talk: 0 };
    if (t > T.strike && t < T.breach) return { pose: 'point', mood: 'surprised', talk: 0 };
    if (t > T.breach && t < T.logo) return { pose: 'cheer', mood: 'excited', talk: 0 };
    if (t > T.logo) return { pose: 'wave', mood: 'happy', talk: 0 };
    return { pose: 'idle', mood: this.picks.mood || 'happy', talk: 0 };
  }

  firstFishPos(t) {
    const a = [150, -54, -110], b = [86, -46, -54], c = [190, -60, -150];
    if (t < T.under) return null;
    if (t < T.fish) return mix3(a, b, ease.outCubic(inv(T.under, T.fish, t)));
    if (t < T.shadow) return add3(b, [Math.sin(this.wall * 1.2) * 1.5, Math.sin(this.wall * 1.7) * 0.8, 0]);
    if (t < T.strike) return mix3(b, c, ease.inCubic(inv(T.shadow, T.shadow + 1.2, t)));
    return null;
  }

  bigFishPos(t) {
    const L = [BOBBER[0] + 4, LURE_Y, BOBBER[2]];
    if (t < T.shadow) return null;
    if (t < T.strike) {
      const k = inv(T.shadow, T.strike, t);
      const p0 = [290, -96, -100];
      return { p: mix3(p0, L, ease.inQuad(k)), dir: norm3(sub3(L, p0)) };
    }
    if (t < T.breach) {
      const k = inv(T.strike, T.breach, t);
      const p = mix3(L, [80, -8, -80], ease.inCubic(k));
      p[0] += Math.sin(k * 9) * 6 * k;
      return { p, dir: norm3([0.2 + Math.cos(k * 9) * 0.3, 0.75, -0.4]), fight: 1 };
    }
    // the leap: an arc out of the sea toward the camera
    const k = inv(T.breach, T.breach + 1.75, t);
    if (k >= 1) return null;
    const x = lerp(LEAP.x0, LEAP.x1, k), z = lerp(LEAP.z0, LEAP.z1, k), y = 4 * LEAP.top * k * (1 - k) - 4;
    const dy = 4 * LEAP.top * (1 - 2 * k);
    return { p: [x, y, z], dir: norm3([LEAP.x1 - LEAP.x0, dy, LEAP.z1 - LEAP.z0]), leap: 1 };
  }

  lurePos(t) {
    if (t >= T.strike && t < T.breach && this.bigMouth) return this.bigMouth;
    const sway = Math.sin(this.wall * 1.4) * 1.2;
    const k = ease.outCubic(inv(T.land, T.under, t));
    return [BOBBER[0] + sway, lerp(-1, LURE_Y, k), BOBBER[2]];
  }

  bobberPos(t) {
    if (t < T.cast + 0.35) return null;
    const rod = this.rodTip || [6, 22, 0];
    if (t < T.land) {
      const k = inv(T.cast + 0.35, T.land, t);
      const p = mix3(rod, BOBBER, k);
      p[1] += Math.sin(k * Math.PI) * 30;
      return p;
    }
    const sw = this.swell(BOBBER[0], BOBBER[2], this.wall);
    return [BOBBER[0] + sw.dx * 0.4, sw.h * 0.8 + Math.sin(this.wall * 3) * 0.2 - (t > T.strike ? 2 : 0), BOBBER[2] + sw.dz * 0.4];
  }

  // Touch the voxel frames the opening will need (built by the fish renderer's own budgeted queue).
  touchFish() {
    const F = this.fish;
    if (!F || typeof RIG.drawFishRig !== 'function') return;
    if (!this.warmQ) {
      this.warmQ = [];
      const add = (f, S, st) => { if (f) for (let i = 0; i < 6; i++) this.warmQ.push([f, { scale: S, ...st, swimPhase: i / 6, tailPhase: i / 6 }]); };
      for (const f of F.school) for (const S of [1, 1.6]) { add(f, S, { turn: 1 }); add(f, S, { turn: -1 }); }
      if (F.first) add(F.first, this.quantS(F.first, 300 / F.first.gw), { turn: 0.5 });
      if (F.big) { add(F.big, this.quantS(F.big, 260 / F.big.gw), { turn: 0.6 }); add(F.big, this.quantS(F.big, 340 / F.big.gw), { turn: 0.2, angle: -0.5 }); }
      this.warmI = 0;
    }
    const g = this.scratch || (this.scratch = ctxOf(makeCanvas(8, 8)));
    for (let n = 0; n < 2 && this.warmQ.length; n++) {
      const [f, st] = this.warmQ[this.warmI++ % this.warmQ.length];
      try { RIG.drawFishRig(g, f.c, { x: 4, y: 4, angle: 0, speed01: 0.5, time: 0, emotion: 'neutral', pri: 3, yawBase: 0, noCull: true, ...st }); } catch (e) { /* the fish renderer may be mid-rework */ }
    }
  }

  // the Water agent's 2D Gerstner swell (watersim.swellAt), in our world units
  swell(x, z, t) {
    try { return swellAt(x, z, t, SWELLS.calm); } catch (e) { return { h: Math.sin(t * 1.6) * 0.5, dx: 0, dz: 0 }; }
  }

  // sea colours from the Water agent's (OS)cean palette (sRGB hex -> linear)
  seaColours() {
    if (this.seaCol) return this.seaCol;
    let P = null;
    try { P = waterPalette('oscean', 1); } catch (e) { P = null; }
    const L = (h, k = 1) => hexLin(h).map((c) => c * k);
    this.seaCol = P
      ? { skyTop: [0.02, 0.2, 0.78], skyHor: mix3(L(P.horizon), [0.66, 0.88, 1.0], 0.5), deep: L(P.deep, 0.55), shallow: mix3(L(P.surface, 0.7), [0.04, 0.5, 0.6], 0.5) }
      : { skyTop: [0.02, 0.2, 0.78], skyHor: [0.66, 0.88, 1.0], deep: [0.0, 0.12, 0.34], shallow: [0.04, 0.5, 0.6] };
    return this.seaCol;
  }

  quantS(f, s) { const q = Math.pow(1.25, Math.round(Math.log(Math.max(0.05, s)) / Math.log(1.25))); return q; }

  // ---------------------------------------------------------------------------------- the sprite atlas
  atlasBegin() {
    const g = this.atlasG;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, this.atlasC.width, this.atlasUsed || this.atlasC.height);
    g.imageSmoothingEnabled = false;
    this.ax = 0; this.ay = 0; this.ashelf = 0; this.atlasUsed = 0;
  }

  atlasCell(w, h) {
    w = Math.ceil(w) + 2; h = Math.ceil(h) + 2;
    const AW = this.atlasC.width, AH = this.atlasC.height;
    if (w > AW || h > AH) return null;
    if (this.ax + w > AW) { this.ax = 0; this.ay += this.ashelf; this.ashelf = 0; }
    if (this.ay + h > AH) return null;
    const c = { x: this.ax + 1, y: this.ay + 1, w: w - 2, h: h - 2 };
    this.ax += w; this.ashelf = Math.max(this.ashelf, h);
    this.atlasUsed = Math.max(this.atlasUsed, this.ay + h);
    return c;
  }

  uvOf(c) { const AW = this.atlasC.width, AH = this.atlasC.height; return [c.x / AW, c.y / AH, (c.x + c.w) / AW, (c.y + c.h) / AH]; }

  // fish sprite at a world point heading along dir: the renderer's yaw = the angle the camera sees it from
  fishBillboard(out, f, p, dir, o = {}) {
    const E = this.E;
    const pr = E.project(p);
    if (!pr) return null;
    const ppu = E.ppu(pr[2]);
    const lenPx = f.len * ppu;
    if (lenPx < 3 || pr[0] < -lenPx * 2 || pr[0] > this.W + lenPx * 2 || pr[1] < -lenPx * 2 || pr[1] > this.H + lenPx * 2) return null;
    const S = this.quantS(f, Math.min(lenPx, 520) / f.gw);
    const spx = f.gw * S; // sprite length px
    const cell = this.atlasCell(spx * 1.7 + 10, spx * 1.25 + 10);
    if (!cell) return null;
    const r = dot3(dir, E.right), u = dot3(dir, E.upv), tw = -dot3(dir, E.fwd);
    const deg = Math.atan2(tw, r) / DEG, ab = Math.abs(deg);
    const Yc = ab <= 90 ? ab : 180 - ab;
    const st = {
      x: cell.x + cell.w / 2, y: cell.y + cell.h / 2, scale: S, turn: Math.cos(ab * DEG), heading: deg < 0 ? 2 * Yc : 0, yawBase: 0,
      angle: clamp(-Math.atan2(u, Math.hypot(r, tw)), -0.6, 0.6) * (deg < -90 || deg > 90 ? -1 : 1),
      swimPhase: o.phase ?? 0, tailPhase: o.phase ?? 0, speed01: o.speed ?? 0.5, time: this.wall, emotion: o.emotion || 'neutral', pri: o.pri ?? 1, noCull: true,
    };
    let anchors = null;
    try { anchors = RIG.drawFishRig(this.atlasG, f.c, st); } catch (e) { return null; }
    const k = spx / f.len; // sprite px per world unit
    out.push({ pos: p, w: cell.w / k, h: cell.h / k, uv: this.uvOf(cell), alpha: o.alpha ?? 1, reflect: o.reflect, wet: 1 });
    if (anchors?.mouth) {
      const mx = (anchors.mouth[0] - st.x) / k, my = (st.y - anchors.mouth[1]) / k;
      return add3(p, add3(scl3(E.right, mx), scl3(E.upv, my)));
    }
    return p;
  }

  spriteLevel(want, ladder) { for (const s of ladder) if (s >= want * 0.92) return s; return ladder[ladder.length - 1]; }

  // ---------------------------------------------------------------------------------- draw
  draw(ctx) {
    if (!this.active) return;
    const { W, H } = this;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    if (!this.ready) { this.drawBoot(ctx); ctx.restore(); return; }
    let alpha = 1;
    if (this.skipT >= 0) alpha = 1 - ease.inOutQuad(clamp01(this.skipT / 0.5));
    else if (this.t > T.out0 + 0.3) alpha = 1 - ease.inOutCubic(inv(T.out0 + 0.3, T.out1, this.t));
    if (alpha > 0.002) {
      ctx.globalAlpha = alpha;
      if (this.E) this.drawGL(ctx);
      else this.drawFlat(ctx);
      ctx.globalAlpha = 1;
      this.drawOverlay(ctx, alpha);
    }
    if (this.bootFade == null) this.bootFade = this.wall;
    const bf = 1 - clamp01((this.wall - this.bootFade) / 0.6);
    if (bf > 0) { ctx.globalAlpha = bf; this.drawBoot(ctx); ctx.globalAlpha = 1; }
    ctx.restore();
  }

  drawBoot(ctx) {
    const { W, H } = this;
    ctx.fillStyle = '#f5fcff';
    ctx.fillRect(0, 0, W, H);
    AE.drawAeroGlow?.(ctx, W / 2, H / 2, Math.round(H * 0.4), '#bfeeff', 0.5);
    const b = this.bootT;
    if (b > 0.15) {
      const a = ctx.globalAlpha;
      ctx.globalAlpha = a * clamp01((b - 0.15) * 3);
      AE.drawGlossOrb?.(ctx, W / 2, H / 2 + Math.sin(b * 4) * 3, 9 * this.u, '#2fd3e8');
      for (let i = 0; i < 3; i++) { const ph = (b * 0.8 + i / 3) % 1; AE.drawAeroBubble?.(ctx, W / 2 + Math.sin(ph * 9 + i) * 8, H / 2 - 14 - ph * 40, 2 + i, 1 - ph); }
      ctx.globalAlpha = a;
    }
  }

  // Build the 3D scene for this frame and render it with WebGL.
  drawGL(ctx) {
    const E = this.E, t = this.t, w = this.wall;
    const cam = (this.cam = this.camera(t));
    E.setCamera(cam);
    this.camFwd = E.fwd;
    const under = cam.eye[1] < 0;
    this.under = under;
    const meshes = [], glass = [], bbs = [], lines = [];
    // --- the island and its props (skip when underwater: hidden by the water)
    if (!under || cam.eye[1] > -3) {
      if (this.A.isle) meshes.push({ mesh: this.A.isle, model: M4.model([ISLE.x, -ISLE.sink * ISLE.vox, ISLE.z]), reflect: true, k: [0.8, 0.8, 0, 1] });
      const P = this.A.props;
      if (P) {
        for (const tb of P.turbines) {
          meshes.push({ mesh: P.tower, model: M4.model(tb.p, { scale: tb.s, yaw: tb.yaw }), reflect: true });
          const hub = add3(tb.p, [Math.sin(tb.yaw) * 14 * tb.s, 63 * 3.2 * tb.s, Math.cos(tb.yaw) * 14 * tb.s]);
          meshes.push({ mesh: P.rotor, model: M4.model(hub, { scale: tb.s, yaw: tb.yaw, roll: w * 1.6 + tb.ph }), reflect: true });
        }
        if (P.city && P.cityAt) {
          meshes.push({ mesh: P.city, model: M4.model(P.cityAt), reflect: true, k: [1.2, 1.4, 0.25, 1] });
          glass.push({ model: M4.model(add3(P.cityAt, [0, 70, 0]), { scale: 105 }), tint: [0.55, 0.95, 1.1, 0.45], irid: 0.9, reflect: true });
        }
        if (P.globe) {
          meshes.push({ mesh: P.globe, model: M4.model(P.globeAt, { yaw: w * 0.12, roll: 0.35 }), reflect: true, k: [1.2, 1.6, 0.2, 1] });
          glass.push({ model: M4.model(P.globeAt, { scale: 300 }), tint: [0.45, 1.0, 0.6, 0.5], irid: 0.6, reflect: true });
        }
        for (const c of P.clouds) meshes.push({ mesh: c.mesh, model: M4.model(c.p, { scale: c.s, yaw: c.yaw }), reflect: true, k: [0.3, 0.5, 0, 1], tint: [1.25, 1.25, 1.3, 0] });
      }
    }
    // --- the seabed (only near and under the water)
    if (this.A.seabed && cam.eye[1] < 3) meshes.push({ mesh: this.A.seabed, model: M4.model([SEABED.x, SEABED.y, SEABED.z]), k: [0.6, 0.6, 0, 1] });
    // --- the boat (bobbing)
    const B = this.A.boat;
    let boatM = null;
    if (B) {
      // ride the shared Gerstner swell (src/world/watersim.js): heave plus roll / pitch from the local slope
      const s0 = this.swell(0, 0, w), sx = this.swell(12, 0, w), sz = this.swell(0, 8, w);
      boatM = M4.model([s0.dx * 0.5, s0.h * 0.7 - 0.6, s0.dz * 0.5], { roll: Math.atan2(sx.h - s0.h, 12) * 0.9 + Math.sin(w * 1.3) * 0.015, pitch: -Math.atan2(sz.h - s0.h, 8) * 0.9 });
      meshes.push({ mesh: B.mesh, model: boatM, reflect: true, k: [1, 1, 0, 1] });
    }
    // --- sprites: begin the atlas
    this.atlasBegin();
    this.drawPeople(bbs, t, w, boatM);
    this.drawSchools(bbs, t, w);
    // the bobber, the line and the lure
    const bp = this.bobberPos(t);
    if (bp && this.A.bobber) meshes.push({ mesh: this.A.bobber, model: M4.model(bp, { roll: Math.sin(w * 2) * 0.2 }), reflect: true, k: [1.2, 1, 0, 1] });
    if (bp && this.rodTip && cam.shot === 0) {
      const pts = [];
      const a = this.rodTip;
      for (let i = 0; i <= 16; i++) { const k = i / 16; const p = mix3(a, bp, k); p[1] -= Math.sin(k * Math.PI) * 4 * (t > T.land ? 1 : 0.2); pts.push(...p); }
      if (t > T.land) { const L = this.lurePos(t); for (let i = 1; i <= 10; i++) pts.push(...mix3(bp, L, i / 10)); }
      lines.push({ pts: new Float32Array(pts), color: [0.95, 1, 1, 0.85] });
    }
    if (t > T.land && t < T.breach && this.A.lure) {
      const L = this.lurePos(t);
      meshes.push({ mesh: this.A.lure, model: M4.model(L, { yaw: Math.sin(w * 2) * 0.6 + 1.2, roll: Math.sin(w * 3) * 0.3 }), k: [1.4, 1.0, 0.22, 1] });
    }
    // --- floating 3D text
    this.drawTexts(meshes, w);
    // --- particles
    const parts = this.parts.map((p) => {
      const a = clamp01((p.life - p.t) / Math.min(0.4, p.life * 0.5));
      return { x: p.x, y: p.y, z: p.z, size: p.size * (p.kind === 3 ? 1 + p.t : 1), r: p.c[0], g: p.c[1], b: p.c[2], a: p.c[3] * a, kind: p.kind, spin: p.spin ? p.spin * p.t : 0 };
    });
    E.atlas(this.atlasC, this.atlasUsed);
    // --- post
    const post = this.postFx(t, w, cam, under);
    const rp = this.ripple ? [this.ripple.p[0], this.ripple.p[2], (w - this.ripple.t0) * 26, w - this.ripple.t0] : null;
    E.render({
      cam, time: w, under, sunDir: SUN, lightDir: LIGHT, sunCol: SUN_COL,
      ...this.seaColours(),
      haze: cam.shot === 2 ? 0.00003 : 0.000045, waterDens: 0.0052, caustics: 1.2, spriteExp: 1.08,
      arcs: [-1.3, -0.25, -0.6, 0.22], water: true, ripple: rp,
      meshes, glass, billboards: bbs, particles: parts, lines, post,
    });
    ctx.drawImage(E.canvas, 0, 0);
  }

  drawPeople(bbs, t, w, boatM) {
    const E = this.E;
    // the bubble person on the boat
    const B = this.A.boat;
    if (B && boatM) {
      const sp = [boatM[12] + B.stand[0], boatM[13] + B.stand[1], boatM[14] + B.stand[2]];
      const pr = E.project(sp);
      if (pr) {
        const ppu = E.ppu(pr[2]);
        const s = this.spriteLevel(ppu / 3.2, [0.5, 0.75, 1, 1.5, 2, 3]);
        const k = 3.2 * s;
        const cell = this.atlasCell(120 * s, 100 * s);
        if (cell) {
          let pose = 'idle', pt = w;
          if (t > T.cast && t < T.cast + 0.9) { pose = 'cast'; pt = t - T.cast; }
          else if (t > T.cast + 0.9 && t < T.strike) pose = 'idle';
          else if (t > T.strike && t < T.breach) pose = 'reel';
          else if (t > T.logo) pose = 'cheer';
          else if (t >= T.boat && this.holding === 'boat') pose = 'wave';
          const cx = cell.x + cell.w * 0.42, fy = cell.y + cell.h - 6 * s;
          let A = null;
          try { A = CHAR.drawCharacter(this.atlasG, cx, fy, { pose, t: pt, facing: 1, scale: s, look: this.look, shadow: false }); } catch (e) { A = null; }
          const ax = (cx - cell.x) / cell.w, ay = (cell.y + cell.h - fy) / cell.h;
          bbs.push({ pos: sp, w: cell.w / k, h: cell.h / k, ax, ay, uv: this.uvOf(cell), reflect: true });
          if (A?.rodTip) this.rodTip = add3(sp, add3(scl3(E.right, (A.rodTip[0] - cx) / k), scl3(E.upv, (fy - A.rodTip[1]) / k)));
        }
      }
    }
    // Clip
    const cp = this.clipPos(t);
    if (cp) {
      const pr = E.project(cp);
      if (pr) {
        const ppu = E.ppu(pr[2]);
        const VU = 0.21; // world units per Clip voxel
        const vs = this.spriteLevel(ppu * VU, [1, 1.5, 2, 2.5, 3, 4, 5, 6]);
        const k = vs / VU;
        const cell = this.atlasCell(64 * vs, 110 * vs);
        if (cell) {
          const P = this.clipPose(t);
          const cx = cell.x + cell.w / 2, by = cell.y + cell.h - 2;
          let A = null;
          try { A = NPC.drawNPC(this.atlasG, 'clip', { x: cx, y: by, t: w, scale: vs / 1.6, pose: P.pose, mood: P.mood, talk: P.talk, facing: cp[0] > this.cam.eye[0] + 8 ? -1 : 1, id: 'intro' }); } catch (e) { A = null; }
          bbs.push({ pos: cp, w: cell.w / k, h: cell.h / k, ax: 0.5, ay: 2 / cell.h, uv: this.uvOf(cell), reflect: true, wet: 0.4 });
          this.clipTop = A?.top ? add3(cp, add3(scl3(E.right, (A.top[0] - cx) / k), scl3(E.upv, (by - A.top[1]) / k))) : add3(cp, [0, 18, 0]);
          this.clipH = (cell.h / k) * 0.8;
        }
      }
    }
  }

  drawSchools(bbs, t, w) {
    const F = this.fish;
    if (!F || !this.cam || this.cam.eye[1] > 20) return;
    for (const S of this.schools || []) {
      if (t < S.t0 - 0.3 || t > S.t1 + 0.3) continue;
      const k = inv(S.t0, S.t1, t);
      const c = mix3(S.a, S.b, k);
      const dir = norm3(sub3(S.b, S.a));
      for (const m of S.m) {
        const wob = Math.sin(w * 1.3 * m.sp + m.ph * 9);
        const p = add3(c, [m.d[0] + wob * 2, m.d[1] + Math.sin(w * 0.9 + m.ph * 5) * 2, m.d[2]]);
        this.fishBillboard(bbs, S.f, p, norm3(add3(dir, [0, wob * 0.08, 0])), { phase: w * 1.6 * m.sp + m.ph, speed: 0.6 });
      }
    }
    // the first fish
    const fp = this.firstFishPos(t);
    if (fp && F.first) {
      const dir = t < T.fish ? norm3([-1, 0.1, 0.6]) : t < T.shadow ? norm3([-1, 0, 0.35]) : norm3([1, -0.1, -0.7]);
      this.fishBillboard(bbs, F.first, fp, dir, { phase: w * (t > T.shadow ? 3 : 1), speed: 0.5, pri: 3 });
    }
    // the big one
    const bf = this.bigFishPos(t);
    if (bf && F.big) {
      const mouth = this.fishBillboard(bbs, F.big, bf.p, bf.dir, { phase: w * (bf.fight ? 3.2 : 1.4), speed: 0.9, pri: 3, emotion: bf.fight ? 'angry' : 'neutral', reflect: !!bf.leap });
      if (mouth) bf.mouth = mouth;
      this.bigMouth = mouth;
    }
  }

  drawTexts(meshes, w) {
    const E = this.E;
    const f = E.fwd, R = E.right, U = E.upv;
    const yaw0 = Math.atan2(-f[0], -f[2]), pitch0 = Math.asin(clamp(f[1], -1, 1));
    const list = [...this.texts];
    // the logo
    if (this.A.logo && this.t > T.logo - 0.05) list.push({ logo: true, t0: this.logoT ?? this.wall, o: { life: 99 } });
    for (const X of list) {
      const age = w - X.t0;
      const life = X.o.life ?? 3;
      const parts = X.logo ? this.A.logo.map((T3, i) => ({ T3, i })) : [{ T3: X.T3, i: 0 }];
      if (!parts[0].T3) continue;
      // anchor + size (fraction of the screen height)
      let pos, size = X.o.size ?? 0.1;
      if (X.logo) pos = LOGO, size = 0.2;
      else {
        const a = X.o.anchor;
        let base = null, sub = 16;
        if (a === 'clip') { base = this.clipTop || this.clipPos(this.t); sub = this.clipH || 16; }
        else if (a === 'boat') { base = [0, 18, 0]; sub = 30; }
        else if (a === 'first') { base = this.firstFishPos(this.t) || [86, -46, -54]; sub = 14; }
        else if (Array.isArray(a)) base = a;
        if (!base) { const d = 60; base = add3(this.cam.eye, scl3(f, d)); sub = d * 0.6; }
        pos = add3(base, add3(scl3(R, (X.o.dx || 0) * sub), scl3(U, (X.o.dy || 0) * sub)));
        if (X.o.fly) pos = add3(pos, add3(scl3(U, age * sub * 0.25), scl3(f, -age * 4)));
      }
      const pr = E.project(pos);
      if (!pr) { X.span = null; continue; }
      const ppu = E.ppu(pr[2]);
      const exit = X.logo ? 0 : clamp01((age - life) / 0.5);
      // total width so the pieces line up
      const pxPer = X.logo ? 2 : 1;
      const totalW = parts.reduce((s, p) => s + p.T3.w, 0) + (parts.length - 1) * 2;
      const hVox = parts[0].T3.h;
      const s = (this.H * size) / (hVox * ppu);
      X.span = [pr[0] - (totalW / 2) * s * ppu, pr[1] - hVox * s * ppu * 0.25, pr[0] + (totalW / 2) * s * ppu];
      let ox = -totalW / 2;
      let li = 0;
      for (const { T3 } of parts) {
        for (const L of T3.letters) {
          const mesh = this.meshFor(L);
          const k = ease.outBack(clamp01((age - li * 0.05) / 0.45));
          li++;
          if (k <= 0.01) continue;
          const bob = Math.sin(w * 2.6 + li * 0.55) * 0.9 * pxPer;
          const lx = (ox + L.cx) * s, ly = (bob + (1 - k) * -8 - exit * 30) * s;
          const p = add3(pos, add3(scl3(R, lx), scl3(U, ly)));
          const spin = (1 - k) * 2.2 + Math.sin(w * 1.4 + li * 0.4) * 0.12 + (X.logo ? Math.sin(w * 0.9) * 0.08 : 0);
          const sc = s * Math.max(0.01, k) * (1 - exit * 0.6);
          // a glint band sweeping across the whole word every 3 s
          const ph = (age * 0.8) % 3;
          const sweepX = lerp(-40, totalW + 40, ph / 1.2) - (ox + totalW / 2 + L.cx - L.w / 2);
          meshes.push({ mesh, model: M4.model(p, { scale: sc, yaw: yaw0 + spin, pitch: pitch0 + Math.sin(w * 1.1 + li) * 0.06, roll: this.cam.roll || 0 }), reflect: !X.logo, k: [1.2, 1.0, 0.12, 1 - exit], tint: [1, 1, 1, X.logo ? clamp01(1 - (w - X.t0) * 3) * 0.6 : 0], sweep: [sweepX, 7, 1.3, 0.06], grad: [0, L.model.ny, 0.5] });
        }
        ox += T3.w + 2;
      }
    }
  }

  postFx(t, w, cam, under) {
    const E = this.E;
    const P = { bloom: 0.45, chroma: 0.35, vignette: 0.38, exposure: 1.0, saturation: 1.16, grain: 0.25, threshold: 1.35 };
    // sun flare + rays (above water)
    const flares = [];
    const sunP = E.project(add3(cam.eye, scl3(SUN, 30000)));
    if (!under && sunP) {
      const sx = sunP[0] / this.W, sy = sunP[1] / this.H;
      if (sx > -0.3 && sx < 1.3 && sy > -0.3 && sy < 1.2) {
        let vis = 0.5;
        if (cam.shot === 2) vis = 0.35 + 0.65 * inv(T.flare - 0.3, T.flare + 0.6, t);
        // fade as the sun leaves the frame
        const edge = Math.min(sx, 1 - sx, sy, 1 - sy);
        const inside = clamp01((edge + 0.08) / 0.2);
        flares.push([sx, 1 - sy, vis * inside, 1.1]);
        P.raysSrc = [sx, 1 - sy]; P.rays = 0.3 * inside; P.raysDensity = 0.8;
      }
    }
    if (under) {
      // light shafts streaming down from the bright surface
      const lp = E.project(add3(cam.eye, [SUN[0] * 260, 400, SUN[2] * 260]));
      if (lp) { P.raysSrc = [lp[0] / this.W, 1 - lp[1] / this.H]; P.rays = 0.95; P.raysDensity = 1.0; P.raysDecay = 0.97; }
      P.bloom = 0.7; P.chroma = 0.5; P.saturation = 1.1;
    }
    // a glint flare riding the glint band across fresh 3D text (drawTexts stores each text's screen span)
    for (const X of this.texts) {
      const age = w - X.t0, k = clamp01((age - 0.3) / 1.0);
      if (X.span && k > 0 && k < 1) flares.push([lerp(X.span[0], X.span[2], k) / this.W, 1 - X.span[1] / this.H, Math.sin(k * Math.PI) * 0.6, 0.45]);
    }
    if (this.A.logo && t > T.flare - 0.3) {
      const q = E.project(LOGO);
      const k = inv(T.flare - 0.3, T.flare + 1.2, t);
      if (q && k < 1) flares.push([q[0] / this.W - 0.3 + k * 0.6, 1 - q[1] / this.H, Math.sin(k * Math.PI) * 0.55, 0.55]);
    }
    P.flares = flares;
    // depth of field: focus on the subject of the shot
    let focus = 0, subj = null;
    if (this.holding === 'clip' || (t > T.pop && t < T.swoop + 0.6)) subj = this.clipPos(t);
    else if (this.holding === 'boat' || (t > T.boat - 0.6 && t < T.cast)) subj = [0, 12, 0];
    else if (this.holding === 'fish') subj = this.firstFishPos(t);
    else if (t > T.shadow && t < T.breach) subj = this.bigFishPos(t)?.p;
    else if (this.holding === 'final' || t > T.logo) subj = LOGO;
    if (subj) {
      const q = E.project(subj);
      if (q) focus = q[2];
    }
    if (focus > 0) P.dof = [focus * 1.35, focus * 1.2, 1, 0.5];
    else if (cam.shot === 0 && t < T.pop) P.dof = [1500, 2500, 0.5, 0];
    // crash zoom / strike
    P.zoomBlur = cam.zoom * 1.4;
    P.chroma += cam.zoom * 2.5;
    const fk = clamp01(1 - (w - this.flashT) / 0.45) * (this.flashK ?? 1);
    if (fk > 0) P.flash = [1, 1, 1, fk * 0.85];
    // lens drops and screen bubbles
    P.drops = this.drops.filter((d) => d.t > 0).map((d) => [d.x, 1 - d.y, d.r, clamp01(d.t * 4) * clamp01((d.life - d.t) / 0.6)]);
    P.bubbles = this.sbubs.filter((b) => b.t > 0).map((b) => [b.x, 1 - b.y, b.r, clamp01(b.t * 3) * clamp01((b.life - b.t) / 0.5)]);
    return P;
  }

  // ---------------------------------------------------------------------------------- 2D fallback (no WebGL2)
  drawFlat(ctx) {
    const { W, H } = this, t = this.t, w = this.wall;
    const under = t > T.plunge + 0.4 && t < T.breach;
    const g = ctx.createLinearGradient(0, 0, 0, H);
    if (under) { g.addColorStop(0, '#5fd8f0'); g.addColorStop(0.5, '#0f78c8'); g.addColorStop(1, '#063a7a'); }
    else { g.addColorStop(0, '#1a6ee0'); g.addColorStop(0.5, '#9adcff'); g.addColorStop(0.52, '#3ab4f8'); g.addColorStop(1, '#0a5cc8'); }
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    if (!under) { AE.drawAeroGlow?.(ctx, W * 0.25, H * 0.2, H * 0.3, '#ffffff', 0.6); AE.drawArcLines?.(ctx, W * 0.7, H * 1.2, H * 0.9, 7, {}); }
    const P = this.clipPose(t);
    if (t > T.pop) NPC.drawNPC(ctx, 'clip', { x: W * 0.32, y: H * 0.78, t: w, scale: 2.6, pose: P.pose, mood: P.mood, talk: P.talk, id: 'flat' });
    for (const X of this.texts) drawText3D(ctx, X.text, W * 0.66, H * 0.36, { t: w, pop: clamp01((w - X.t0) / 0.4), palette: X.o.palette, scale: 2, px: 1 });
    if (t > T.logo) { drawText3D(ctx, 'FISHTOP', W / 2, H * 0.3, { t: w, pop: clamp01((t - T.logo) / 0.5), palette: 'logoBlue', scale: 4, px: 1 }); }
  }

  // ---------------------------------------------------------------------------------- 2D overlay: bars, dialogue, skip
  drawOverlay(ctx, alpha) {
    const { W, H } = this;
    // cinematic letterbox
    const bh = Math.round(H * 0.075);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#020c1c';
    ctx.fillRect(0, 0, W, bh);
    ctx.fillRect(0, H - bh, W, bh);
    // response bursts (2D sparkles)
    for (const b of this.burst || []) {
      const age = this.wall - b.t0;
      if (age > 0.8) continue;
      for (let i = 0; i < b.n; i++) {
        const a = (i / b.n) * TAU + i, r = age * 140 * (0.6 + (i % 3) * 0.2);
        AE.drawSparkle?.(ctx, b.x + Math.cos(a) * r, b.y + Math.sin(a) * r * 0.6, 2, 1 - age / 0.8);
      }
    }
    this.burst = (this.burst || []).filter((b) => this.wall - b.t0 < 0.8);
    // dialogue panel + response bubbles
    if (this.dlg.active) {
      const pw = Math.min(W - 40, Math.round(W * 0.7)), ph = 66;
      this.dlg.drawPanel(ctx, { x: Math.round((W - pw) / 2), y: H - bh - ph + 22, w: pw, h: ph, t: this.wall, alpha });
    }
    // skip pill + sound hint
    if (this.skipT < 0) {
      const r = this.skipRect();
      ctx.globalAlpha = alpha * clamp01((this.wall - 0.3) * 3);
      AE.drawAeroButton?.(ctx, r.x, r.y, r.w, r.h, { label: 'Skip', icon: UIC.getUiIcon?.('play'), tone: 'glass', state: this.skipHover ? 'hover' : 'normal' });
      if (this.audio?.isUnlocked && !this.audio.isUnlocked()) {
        const ic = UIC.getUiIcon?.('sound'), ml = UIC.getUiIcon?.('mouse_l');
        if (ic && ml) {
          const ww = ic.width + ml.width + 16, hh = 18, x = 10, y = 9;
          AE.drawAeroSurface?.(ctx, x, y, ww, hh, { tone: 'glass', r: 'pill', gloss: 0.6, glossH: 8, rim: 0.8, glow: 0.4 });
          ctx.drawImage(ml, x + 6, y + Math.round((hh - ml.height) / 2));
          ctx.drawImage(ic, x + 10 + ml.width, y + Math.round((hh - ic.height) / 2));
        }
      }
      ctx.globalAlpha = 1;
    }
    void drawAlagard;
  }
}
