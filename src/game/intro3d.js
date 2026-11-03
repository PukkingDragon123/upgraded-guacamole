// The 3D opening (phase 3, Intro agent): about 24 s, skippable with a glossy Skip pill (or Esc).
//   1. A sunny Frutiger Aero room in true one-point perspective: a white wall, a big window onto green hills
//      (with parallax), a shelf with a glowing moving-picture aquarium lamp, a glass desk on chrome legs, a glossy
//      monitor, Goldie (voxel, cartoon eyes) in her goldfish jar, a voxel plant, sun shafts, dust motes.
//   2. A smooth camera dolly into the monitor, which shows the classic rolling-green-hill desktop.
//   3. Bubbles rise from the jar, fly into the screen, and the desktop floods.
//   4. Underwater, the bubbles coalesce into the player's bubble person (gfx/character.js drawCharacter).
//   5. The camera tilts up through the surface into a 2000s eco wallpaper: a curved grass horizon, sun rays and
//      a big lens flare, white arcs, a green glass globe, a glass city in a water bubble, glossy leaves framing
//      the shot, splashes and bubbles; the glossy FISHTOP logo (puffy voxel letters) blooms in; a fish in white
//      high-tops hops past.
//   6. A dive back under with a bubble curtain dissolves into whatever is drawn underneath (the live game).
// Props are voxel models (gfx/voxel.js) rendered once and drawn as billboards at their depth; glass, gloss and
// light are painted per frame at the projected size so the dolly stays crisp. Assets build progressively
// behind a white Aero bloom, so nothing hitches for long.
//
//   const intro = new Intro3D({W, H, input, audio, look, onHandoff, onDone});
//   intro.update(dt); intro.draw(ctx);    intro.skip(); intro.seek(t); intro.resize(W, H)
//   intro.active (false once done), intro.t (timeline seconds), intro.ready (assets built)
//   drawGoldie(ctx, x, y, {scale, facing, blink, mood, t})   Goldie (npcs.js 'goldie' when present, else voxel)

import { makeCanvas, ctxOf } from '../core/canvas.js';
import { PixelBuffer } from '../gfx/pixel.js';
import { pack, mix, rgba } from '../core/color.js';
import { clamp, clamp01, lerp, smoothstep, ease, hash2, fbm2, TAU } from '../core/math.js';
import { RNG } from '../core/rng.js';
import { VoxelModel, renderVoxels } from '../gfx/voxel.js';
import { Particles } from '../gfx/particles.js';
import { renderLandscape, cumulus } from '../desktop/wallpaper.js';
import { drawAeroButton, drawAeroGlow, drawAeroBubble, drawGlossOrb, drawSparkle, drawAeroSurface } from '../ui/aero.js';
import { getUiIcon } from '../gfx/uiicons.js';
import * as NPC from '../gfx/npcs.js';
import * as CHAR from '../gfx/character.js';
import * as BIG from '../gfx/bigicons.js';

// ------------------------------------------------------------------------------------------------ timeline
export const INTRO_T = {
  fade: 1.5,                    // white bloom -> the room
  notice: 2.4,                  // Goldie spots the camera
  blow: 4.0,                    // ... and starts blowing bubbles
  dolly0: 3.4, dolly1: 11.2,    // camera push into the monitor (the screen fills the frame at dolly1)
  fly0: 5.0, fly1: 10.2,        // bubbles fly from the jar into the screen
  flood0: 7.6, flood1: 12.4,    // the desktop floods
  swirl: 12.2, gather: 13.8, pop: 14.6,
  rise0: 15.8, rise1: 17.4,     // tilt up through the surface into the eco wallpaper
  logo: 17.0, flare: 17.8,
  sneak: 18.4,                  // the sneaker fish hops past
  out0: 22.2, out1: 24.0,       // dive back under + dissolve to the live game
};
const T = INTRO_T;
const END = T.out1;

// --------------------------------------------------------------------------------------------- the room
// World units: at camera z = 0 a point at Z = 100 maps 1 unit -> 1 px of a 540 px tall screen. Y is down.
const ZW = 185;            // back wall
const FLOOR_Y = 300;
const DESK = { y: 100, z0: 78, z1: 132, x0: -470, x1: 470, th: 7 };
const SCREEN_H = 144;      // world height of the monitor's screen; its width follows the game's aspect
const MON = { cy: -36, z: 100, depth: 9, side: 11, top: 11, chin: 24 };
const JAR = { x: 236, z: 94, r: 50, cut: 6, water: -80 };
const WIN = { x0: -870, x1: -230, y0: -455, y1: 70, frame: 15 };
const SHELF = { x: 520, y: -170, z: ZW - 6 };
const LAMP = { x: 640, y: -170, w: 118, h: 74 };   // the aquarium lamp sits on the shelf (world units, on the wall)
const Z_OUT = 360;         // the landscape outside the window
const WALL = { x0: -1050, x1: 950, y0: -640, y1: FLOOR_Y };

const COL = {
  wallM: '#e6f5fb', wallB: '#cfe9f4',
  glassEdge: '#7fe2cc', glassEdgeD: '#2fa79a',
  chrome: ['#5f7486', '#a9bccb', '#e8f2f8', '#ffffff'],
  bezel: ['#3a4756', '#151c24', '#07090c', '#1a232d'],
};

// ------------------------------------------------------------------------------------------------ helpers
const inv = (a, b, t) => clamp01((t - a) / (b - a));

function bez(p0, p1, p2, u) {
  const a = (1 - u) * (1 - u), b = 2 * (1 - u) * u, c = u * u;
  return [p0[0] * a + p1[0] * b + p2[0] * c, p0[1] * a + p1[1] * b + p2[1] * c, p0[2] * a + p1[2] * b + p2[2] * c];
}

function rrect(g, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function vgrad(g, y0, y1, stops) {
  const gr = g.createLinearGradient(0, y0, 0, y1);
  for (const [k, c] of stops) gr.addColorStop(k, c);
  return gr;
}

function hgrad(g, x0, x1, stops) {
  const gr = g.createLinearGradient(x0, 0, x1, 0);
  for (const [k, c] of stops) gr.addColorStop(k, c);
  return gr;
}

const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

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

// Big cartoon voxel eye: white ball, a big dark pupil looking along `look`, one emissive shine voxel.
function cartoonEye(m, x, y, z, r, look, P, closed = false, lid = 0) {
  if (closed) {
    m.sphere(x, y, z, r, lid);
    const n = norm(look);
    for (let a = -1; a <= 1; a += 0.25) m.set(x + n[0] * r + a * r * 0.9 * (n[2] !== 0 ? 1 : 0), y - Math.abs(a) * 0.8 + 0.2, z + n[2] * r * 0.92 + a * r * 0.9 * (n[2] === 0 ? 1 : 0), P.pupil);
    return;
  }
  m.sphere(x, y, z, r, P.white);
  const n = norm(look);
  m.sphere(x + n[0] * r * 0.62, y + n[1] * r * 0.62 - 0.2, z + n[2] * r * 0.62, r * 0.56, P.pupil);
  m.set(x + n[0] * r * 1.02 - 0.5, y + r * 0.3, z + n[2] * r * 1.02, P.shine);
  m.set(x + n[0] * r * 1.02 - 1.2, y + r * 0.3, z + n[2] * r * 1.02 - 0.6, P.shine);
  m.set(x + n[0] * r * 1.0 + 0.6, y - r * 0.3, z + n[2] * r * 1.0, P.shine2);
}

// ------------------------------------------------------------------------------------------- voxel props
function plantModel(seed = 5) {
  const r = new RNG(seed);
  const m = new VoxelModel(70, 92, 52);
  const pot = m.color('#ffffff', { spec: 0.55, specPow: 18, smooth: 0.8, jitter: 0.03 });
  const band = m.color('#8be04a', { spec: 0.45, specPow: 16, smooth: 0.8 });
  const soil = m.color('#6a4a32', { jitter: 0.2 });
  const stem = m.color('#3f9a2e', { smooth: 0.4 });
  const pal = ['#2c8f34', '#4cbf45', '#8fe05a', '#d8ffa0'].map((c, i) => m.color(c, { spec: i < 3 ? 0.42 : 0.2, specPow: 14, smooth: 0.65, jitter: 0.05, edge: 0.6 }));
  const cx = 35, cz = 26;
  for (let y = 0; y < 22; y++) {
    const rr = lerp(9, 13, Math.pow(y / 21, 0.8)) + (y > 18 ? 1 : 0);
    m.cylinder(cx, cz, y, y, rr, y >= 9 && y <= 11 ? band : pot);
  }
  m.cylinder(cx, cz, 21, 21, 11.5, soil);
  for (let i = 0; i < 11; i++) {
    const a = (i / 11) * TAU + r.float(-0.25, 0.25);
    const el = r.float(0.35, 1.25);
    const h = r.float(30, 56);
    const sx = cx + Math.cos(a) * 3, sz = cz + Math.sin(a) * 3;
    const ex = cx + Math.cos(a) * r.float(8, 18), ez = cz + Math.sin(a) * r.float(5, 12);
    m.line(sx, 21, sz, ex, h - 8, ez, stem, 0.7);
    leaf(m, [ex, h - 8, ez], [Math.cos(a) * Math.cos(el), Math.sin(el), Math.sin(a) * Math.cos(el) * 0.7], r.float(17, 24), r.float(6, 8.5), pal, r.float(0.15, 0.45));
  }
  return m;
}

function keyboardModel() {
  const m = new VoxelModel(88, 6, 26);
  const body = m.color('#9fb8c8', { spec: 0.5, specPow: 16, smooth: 0.4 });
  const key = m.color('#ffffff', { spec: 0.6, specPow: 20, jitter: 0.02, light: 0.3 });
  const led = m.color('#5fe6ff', { emissive: 0.8 });
  m.box(0, 0, 0, 87, 2, 25, body);
  m.box(3, 2, 1, 84, 2, 1, led);
  for (let row = 0; row < 5; row++) for (let col = 0; col < 20; col++) {
    if (row === 4 && col > 5 && col < 14) continue;
    const x = 4 + col * 4, z = 4 + row * 4;
    m.box(x, 3, z, x + 2, 3, z + 2, key);
  }
  m.box(4 + 6 * 4, 3, 20, 4 + 13 * 4 + 2, 3, 22, key);
  return m;
}

function mouseModel() {
  const m = new VoxelModel(16, 9, 22);
  const shell = m.color('#ffffff', { spec: 0.7, specPow: 22, smooth: 1 });
  const glow = m.color('#5fe6ff', { emissive: 0.7 });
  m.ellipsoid(8, 0, 11, 6.5, 4.2, 10, shell);
  m.box(7, 3, 3, 8, 4, 6, glow);
  return m;
}

function gravelModel(seed = 3) {
  const m = new VoxelModel(64, 16, 64);
  const cols = ['#e8f4f8', '#5fd6e8', '#9be05a', '#6aa8f0', '#f6b8d0', '#ffffff', '#3cc0b0', '#c8e86a', '#ffd27a'];
  const P = cols.map((c) => m.color(c, { spec: 0.5, specPow: 14, smooth: 0.7, jitter: 0.04 }));
  const sand = m.color('#f0d8a8', { jitter: 0.15 });
  m.ellipsoid(32, -2, 32, 31, 10, 31, sand);
  const r = new RNG(seed);
  for (let i = 0; i < 130; i++) {
    const a = r.float(0, TAU), d = Math.sqrt(r.float(0, 1)) * 28;
    const x = 32 + Math.cos(a) * d, z = 32 + Math.sin(a) * d;
    const y = 8 * (1 - (d / 31) ** 2) - 1;
    m.ellipsoid(x, y, z, r.float(1.6, 2.6), r.float(1.2, 2), r.float(1.6, 2.6), P[r.int(0, P.length - 1)]);
  }
  const g1 = m.color('#3fc85a', { smooth: 0.5 }), g2 = m.color('#8ff07a', { smooth: 0.5 });
  for (const [x0, z0] of [[18, 40], [44, 30]]) {
    for (let k = 0; k < 5; k++) {
      const a = k * 1.3;
      m.line(x0, 4, z0, x0 + Math.cos(a) * 4, 15, z0 + Math.sin(a) * 3, k % 2 ? g1 : g2, 0.6);
    }
  }
  return m;
}

function shelfModel() {
  const m = new VoxelModel(110, 34, 18);
  const board = m.color('#ffffff', { spec: 0.4, specPow: 14, smooth: 0.4 });
  const books = ['#3fb8f0', '#8be04a', '#f4fbff', '#2fd3e8'].map((c) => m.color(c, { spec: 0.35, specPow: 12, smooth: 0.3 }));
  const pot = m.color('#e8f8ff', { spec: 0.6, specPow: 18, smooth: 0.8 });
  const succ = ['#3fae5a', '#6fd47a', '#b8f0a0'].map((c) => m.color(c, { spec: 0.35, specPow: 12, smooth: 0.8 }));
  m.box(0, 0, 2, 109, 3, 16, board);
  let x = 6;
  for (let i = 0; i < 4; i++) { const w = 4 + (i % 2), h = 20 + ((i * 7) % 6); m.box(x, 4, 5, x + w, 4 + h, 14, books[i]); x += w + 1; }
  m.box(x + 1, 4, 5, x + 18, 8, 14, books[0]); m.box(x + 2, 9, 6, x + 16, 12, 13, books[1]);
  m.cylinder(52, 10, 4, 12, 6, pot);
  for (let i = 0; i < 9; i++) { const a = i * 0.7, rr = 2 + (i % 3); m.ellipsoid(52 + Math.cos(a) * rr, 15 + (i % 3) * 2, 10 + Math.sin(a) * rr * 0.6, 2.6, 3.2, 2.6, succ[i % 3]); }
  return m;
}

function frondModel(seed = 9) {
  const r = new RNG(seed);
  const m = new VoxelModel(60, 60, 24);
  const pal = ['#1f7a2e', '#36a63e', '#6fd04a', '#b8f08a'].map((c) => m.color(c, { smooth: 0.6, spec: 0.3 }));
  for (let i = 0; i < 6; i++) {
    const a = -0.4 + i * 0.32 + r.float(-0.1, 0.1);
    leaf(m, [4, 50 - i * 5, 12], [Math.cos(a), -Math.sin(a) * 0.6, 0.1], r.float(26, 36), r.float(6, 9), pal, 0.2);
  }
  return m;
}

// Goldie: a round voxel goldfish with a flowing fan tail and big glossy cartoon eyes.
// frame 0..3 = tail wag; mood: 'n' | 'b' (blink) | 'o' (mouth open, blowing bubbles) | 'h' (happy squint)
function goldieModel(frame, mood) {
  const m = new VoxelModel(36, 30, 22);
  const B = ['#c63e08', '#f2600e', '#ff8424', '#ffad4a', '#ffd896'].map((c) => m.color(c, { spec: 0.6, specPow: 20, smooth: 0.95, jitter: 0.02, edge: 0.35 }));
  const F = ['#ff7a2a', '#ffb070', '#ffe2c4'].map((c) => m.color(c, { spec: 0.35, specPow: 14, smooth: 0.5, light: 0.3 }));
  const P = { white: m.color('#ffffff', { spec: 0.9, specPow: 30, smooth: 1 }), pupil: m.color('#141a2e', { spec: 1, specPow: 40, smooth: 1 }), shine: m.color('#ffffff', { emissive: 1 }), shine2: m.color('#cfefff', { emissive: 0.8 }) };
  const blush = m.color('#ff7a9a', { smooth: 1 }), lip = m.color('#ff5a6a', { smooth: 1, spec: 0.6 }), dark = m.color('#5a1020');
  const cx = 20, cy = 15, cz = 11;
  m.ellipsoid(cx, cy, cz, 9.5, 8.5, 7, (x, y) => {
    const k = (y + 0.5 - (cy - 8.5)) / 17;
    return B[clamp(Math.round(k < 0.32 ? 4 : k < 0.45 ? 3 : 3 - (k - 0.45) * 5), 0, 4)];
  });
  // fan tail (two lobes) + wag
  const wag = Math.sin((frame / 4) * TAU) * 0.55;
  for (const s of [1, -1]) {
    const ax = norm([-1, s * 0.62, wag]);
    const az = norm(cross(ax, [0, 1, 0]));
    const ay = norm(cross(az, ax));
    blob(m, cx - 13, cy + s * 4, cz + wag * 6, ax, ay, az, 7, 5.2, 1.1, (u) => F[u > 0.5 ? 2 : u > -0.25 ? 1 : 0]);
  }
  // dorsal, pectoral and pelvic fins
  blob(m, cx - 1.5, cy + 7.8, cz, norm([1, -0.2, 0]), [0, 1, 0], [0, 0, 1], 5.5, 3.6, 0.9, (u, v) => F[v > 0.35 ? 2 : 1]);
  const pf = Math.sin((frame / 4) * TAU + 1) * 0.4;
  blob(m, cx + 1, cy - 4.5, cz + 6.8, norm([-0.6, -0.5 + pf, 0.4]), norm([0.5, -0.6, 0]), norm([0.3, 0.3, 1]), 3.4, 2.2, 0.8, F[1]);
  blob(m, cx - 3, cy - 7.5, cz + 2, norm([-0.7, -0.6, 0.2]), norm([0.6, -0.7, 0]), [0, 0, 1], 3.2, 1.8, 0.8, F[1]);
  // cartoon eyes (both sides; the far one peeks over the head in the 3/4 view)
  for (const s of [1, -1]) {
    const ex = cx + 5.2, ey = cy + 2.6, ez = cz + s * 5.0;
    const look = [0.65, 0.05, s * 0.75];
    if (mood === 'b') cartoonEye(m, ex, ey, ez, 3.6, look, P, true, B[2]);
    else if (mood === 'h') { m.sphere(ex, ey, ez, 3.6, B[3]); for (let a = -1; a <= 1; a += 0.25) m.set(ex + 2.6, ey + 1.2 - Math.abs(a) * 1.4, ez + s * 2.4 + a * 2.6, P.pupil); }
    else cartoonEye(m, ex, ey, ez, 4.0, look, P);
  }
  // blush + mouth
  m.ellipsoid(cx + 6.5, cy - 2.2, cz + 5.4, 1.6, 1, 1, blush);
  if (mood === 'o') { m.ellipsoid(cx + 9.4, cy - 1.2, cz, 1.2, 2.2, 2.2, lip); m.ellipsoid(cx + 10.2, cy - 1.2, cz, 0.8, 1.4, 1.4, dark); }
  else m.ellipsoid(cx + 9.2, cy - 1.6, cz, 1, 1.3, 1.8, lip);
  return m;
}

const GOLDIE = new Map();
function goldieFrame(vs, frame, mood) {
  const key = vs + '|' + frame + '|' + mood;
  let f = GOLDIE.get(key);
  if (!f) {
    const r = renderVoxels(goldieModel(frame, mood), { scale: vs, yaw: 34, pitch: 12, outline: true, ao: 0.7, edges: 0.5 });
    const [ax, ay] = r.project(20, 15, 11);
    f = { canvas: r.canvas, ax, ay, vs };
    GOLDIE.set(key, f);
  }
  return f;
}

// Goldie through the Character agent's NPC when it exists, else the built-in voxel Goldie. (x, y) = body centre;
// scale = screen px per voxel (she is about 30 voxels long), vs = the voxel render scale to use.
export function drawGoldie(ctx, x, y, o = {}) {
  const k = o.scale ?? 1;
  if (NPC.NPCS && NPC.NPCS.goldie && typeof NPC.drawNPC === 'function') {
    try { NPC.drawNPC(ctx, 'goldie', { x, y: y + 9 * k, t: o.t || 0, scale: k, facing: o.facing ?? 1, talk: o.mood === 'o' ? 1 : 0, mood: o.mood || 'happy', blink: o.blink ? 1 : 0, pose: 'swim' }); return; } catch (e) { /* fall through */ }
  }
  const vs = o.vs || 1;
  const mood = o.blink ? 'b' : o.mood === 'o' ? 'o' : o.mood === 'happy' ? 'h' : 'n';
  const f = goldieFrame(vs, Math.floor((o.t || 0) * 8) % 4, mood);
  const s = k / vs;
  ctx.save();
  ctx.translate(x, y);
  if ((o.facing ?? 1) < 0) ctx.scale(-1, 1);
  if (o.angle) ctx.rotate(o.angle);
  ctx.imageSmoothingEnabled = s < 0.98;
  ctx.drawImage(f.canvas, -f.ax * s, -f.ay * s, f.canvas.width * s, f.canvas.height * s);
  ctx.restore();
  ctx.imageSmoothingEnabled = false;
}

// A silver fish standing in a pair of generic white high-top sneakers (meme gag; no logos).
function sneakerFishModel() {
  const m = new VoxelModel(70, 50, 34);
  const sole = m.color('#f4f4f0', { spec: 0.3, smooth: 0.4 }), stripe = m.color('#d84a4a'), stripe2 = m.color('#3a62b8');
  const canvasC = m.color('#ffffff', { smooth: 0.5, jitter: 0.03, spec: 0.2 }), toe = m.color('#f8f8f4', { spec: 0.5, smooth: 0.8 });
  const lace = m.color('#c8ccd4'), eyelet = m.color('#9aa2ae', { spec: 0.8 }), inside = m.color('#d8d4cc');
  const fish = ['#4a5a6a', '#7a8a9a', '#aab8c4', '#dfe8ee', '#f4f8fa'].map((c) => m.color(c, { spec: 0.7, specPow: 22, smooth: 0.9, jitter: 0.03 }));
  const fin = m.color('#8a96a2', { smooth: 0.5, spec: 0.3 });
  const P = { white: m.color('#ffffff', { spec: 0.9, smooth: 1 }), pupil: m.color('#141a2e', { spec: 1, smooth: 1 }), shine: m.color('#ffffff', { emissive: 1 }), shine2: m.color('#cfefff', { emissive: 0.8 }) };
  const shoe = (x0, z0) => {
    m.box(x0, 0, z0, x0 + 26, 2, z0 + 11, sole);
    m.box(x0, 1, z0, x0 + 26, 1, z0 + 11, stripe);
    m.box(x0, 2, z0, x0 + 26, 2, z0 + 11, stripe2);
    m.ellipsoid(x0 + 21, 3, z0 + 5.5, 6, 3.5, 5.5, toe);
    m.box(x0 + 1, 3, z0 + 1, x0 + 19, 8, z0 + 10, canvasC);
    m.box(x0 + 1, 8, z0 + 1, x0 + 11, 22, z0 + 10, canvasC);
    m.box(x0 + 3, 21, z0 + 3, x0 + 9, 22, z0 + 8, inside);
    for (let y = 9; y < 21; y += 3) { m.set(x0 + 12, y, z0 + 2, eyelet); m.set(x0 + 12, y, z0 + 9, eyelet); m.line(x0 + 12, y, z0 + 2, x0 + 12, y + 1, z0 + 9, lace, 0.3); }
    m.line(x0 + 12, 21, z0 + 5, x0 + 15, 17, z0 + 4, lace, 0.4);
  };
  shoe(6, 2); shoe(30, 18);
  // the fish lies across the two shoe openings, head to the right
  const fx = 36, fy = 32, fz = 17;
  m.ellipsoid(fx, fy, fz, 22, 7.5, 6, (x, y) => fish[clamp(Math.round(((y - fy) / 7.5) * 1.6 + 2.6), 0, 4)]);
  blob(m, fx - 25, fy + 3, fz, norm([-1, 0.7, 0]), norm([0.7, 1, 0]), [0, 0, 1], 6, 3.4, 1, fin);
  blob(m, fx - 25, fy - 3, fz, norm([-1, -0.7, 0]), norm([0.7, -1, 0]), [0, 0, 1], 6, 3.4, 1, fin);
  blob(m, fx - 2, fy + 7, fz, norm([1, 0.3, 0]), [0, 1, 0], [0, 0, 1], 6, 3, 0.9, fin);
  cartoonEye(m, fx + 15, fy + 2, fz + 4.6, 3.2, [0.6, 0, 0.8], P);
  m.ellipsoid(fx + 21.5, fy - 1.5, fz, 1, 1, 2, P.pupil);
  return m;
}

function cityModel() {
  const m = new VoxelModel(74, 96, 34);
  const glass = ['#3f6f9f', '#6a9ac8', '#a8d4f0', '#d8f0ff'].map((c) => m.color(c, { spec: 0.85, specPow: 26, smooth: 0.2, jitter: 0.03, edge: 0.6 }));
  const towers = [[4, 8, 12, 10, 62], [17, 4, 10, 12, 84], [29, 10, 12, 10, 70], [42, 6, 9, 9, 92], [53, 12, 12, 10, 58], [12, 20, 10, 10, 40], [36, 22, 12, 9, 46], [60, 22, 10, 9, 34]];
  towers.forEach(([x, z, w, d, h], i) => {
    m.box(x, 0, z, x + w, h, z + d, (xx, yy, zz) => {
      const win = yy % 4 === 0 ? 0 : (xx + zz) % 3 === 0 ? 1 : 2 + ((i + (yy >> 3)) % 2);
      return glass[win];
    });
    if (i % 2 === 0) m.box(x + 2, h + 1, z + 2, x + w - 2, h + 4, z + d - 2, glass[1]);
  });
  return m;
}

function globeModel(R = 30, seed = 7) {
  const n = R * 2 + 3;
  const m = new VoxelModel(n, n, n);
  const land = ['#3fae2a', '#6fd83a', '#a6f06a'].map((c) => m.color(c, { spec: 0.7, specPow: 26, smooth: 1, jitter: 0.02 }));
  const sea = ['#d8f8e0', '#f2fff4'].map((c) => m.color(c, { spec: 0.8, specPow: 30, smooth: 1, jitter: 0.01 }));
  const c = n / 2;
  m.sphere(c, c, c, R, (x, y, z) => {
    const dx = x + 0.5 - c, dy = y + 0.5 - c, dz = z + 0.5 - c;
    const lon = Math.atan2(dz, dx), lat = Math.asin(clamp(dy / R, -1, 1));
    const v = fbm2(lon * 1.1 + 4, lat * 1.9, 4, seed) - 0.5 + Math.cos(lat) * 0.04;
    if (v > 0.02) return land[v > 0.14 ? 2 : v > 0.07 ? 1 : 0];
    return sea[dy > R * 0.2 ? 1 : 0];
  });
  return m;
}

function treeModel() {
  const m = new VoxelModel(40, 52, 40);
  const trunk = m.color('#6a4a2e', { jitter: 0.1 });
  const P = ['#2f9a2a', '#4cbc32', '#86dc4a'].map((c) => m.color(c, { spec: 0.4, smooth: 0.8, jitter: 0.08 }));
  m.box(18, 0, 18, 21, 22, 21, trunk);
  const col = (x, y, z) => P[clamp(Math.round((y - 24) / 10 + (x < 20 ? 0.6 : 0) + hash2(x, z, 3) * 0.6), 0, 2)];
  m.ellipsoid(20, 34, 20, 15, 13, 14, col);
  m.ellipsoid(12, 30, 22, 9, 8, 9, col);
  m.ellipsoid(28, 32, 18, 10, 9, 9, col);
  m.ellipsoid(19, 44, 20, 9, 7, 9, col);
  return m;
}

// Glossy leafy branch for framing the eco shot.
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

// ---------------------------------------------------------------------------------------- painted textures
let causticTile = null;
function caustics() {
  if (causticTile) return causticTile;
  const S = 96;
  const b = new PixelBuffer(S, S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = (x / S) * TAU, v = (y / S) * TAU;
    const a = Math.sin(2 * u + 1.6 * Math.sin(v) + 0.7 * Math.sin(3 * v + u));
    const c = Math.sin(2 * v + 1.4 * Math.sin(u * 2) - 0.6 * Math.sin(u + 3 * v));
    const k = Math.exp(-a * a * 9) + Math.exp(-c * c * 9);
    const al = clamp01((k - 0.45) * 1.6);
    if (al > 0.05) b.set(x, y, pack('#ffffff', Math.round(al * 255)));
  }
  causticTile = b.toCanvas();
  return causticTile;
}

// The moving-picture aquarium lamp's illustrated reef panorama (a seamless strip that scrolls).
let reefStrip = null;
function reefPanorama() {
  if (reefStrip) return reefStrip;
  const W = 192, H = 44;
  const b = new PixelBuffer(W, H);
  const r = new RNG(77);
  for (let y = 0; y < H; y++) {
    const k = y / H;
    const col = pack(mix('#2a9cf0', '#0a3a9a', k));
    for (let x = 0; x < W; x++) b.set(x, y, col);
  }
  // light rays
  for (let i = 0; i < 6; i++) { const x0 = r.int(0, W); for (let y = 0; y < H * 0.7; y++) for (let w = 0; w < 3; w++) b.set((x0 + w + Math.floor(y * 0.3)) % W, y, pack(mix('#2a9cf0', '#9fe0ff', 0.35 * (1 - y / H)))); }
  // corals along the bottom
  const coral = ['#ff5a8a', '#ffb02e', '#b05aff', '#ff7a3a', '#3fe0c8', '#ffe05a', '#ff4a6a'];
  for (let i = 0; i < 26; i++) {
    const x = r.int(0, W - 1), h = r.int(6, 16), c = pack(r.pick(coral));
    const kind = r.int(0, 2);
    for (let y = 0; y < h; y++) {
      const w = kind === 0 ? Math.max(1, Math.round(3 * Math.sin(Math.PI * y / h) + 1)) : kind === 1 ? 2 : 1 + (y % 4 === 0 ? 2 : 0);
      for (let dx = -w; dx <= w; dx++) b.set(((x + dx + (kind === 2 ? Math.round(Math.sin(y * 0.6) * 2) : 0)) % W + W) % W, H - 1 - y, c);
    }
  }
  for (let x = 0; x < W; x++) for (let y = H - 3; y < H; y++) if (hash2(x, y, 5) > 0.3) b.set(x, y, pack(r.pick(['#ffe0a0', '#f0c890', '#ff9ab8'])));
  // vivid tropical fish (clown, yellow tang, blue tang, angel)
  const fish = [['#ff7a1a', '#ffffff', 'clown'], ['#ffe02a', '#ffe02a', 'tang'], ['#2a6aff', '#ffe02a', 'blue'], ['#ffd02a', '#1a1a2a', 'angel']];
  for (let i = 0; i < 16; i++) {
    const [c1, c2, kind] = fish[i % 4];
    const x = (i * 37 + r.int(0, 10)) % W, y = r.int(5, H - 18);
    const len = kind === 'angel' ? 7 : r.int(6, 9), h = kind === 'angel' ? 7 : 4;
    for (let dx = 0; dx < len; dx++) {
      const hh = Math.round(h * Math.sin(Math.PI * (dx + 0.5) / len));
      for (let dy = -hh; dy <= hh; dy++) {
        let c = c1;
        if (kind === 'clown' && (dx === 2 || dx === 5)) c = c2;
        if (kind === 'angel' && dx % 3 === 1) c = c2;
        if (kind === 'blue' && dy === hh && dx > 1) c = c2;
        b.set((x + dx) % W, y + dy, pack(c));
      }
    }
    b.set((x + len) % W, y - 1, pack('#ffffff')); b.set((x + len - 1) % W, y - 1, pack('#141a2e'));
    for (let dy = -2; dy <= 2; dy++) b.set((x - 1 + W) % W, y + dy, pack(kind === 'blue' ? '#ffe02a' : c1));
  }
  reefStrip = b.toCanvas();
  return reefStrip;
}

// ===================================================================================================== Intro3D
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
    this.fx = new Particles(1000);  // screen-space effects
    this.sp = new Particles(700);   // bubbles inside the monitor's desktop (screen-layer coordinates)
    this.p3 = [];                   // 3D particles: dust motes, jar bubbles, flying bubbles
    this.gather = [];               // bubbles converging into the bubble person
    this.icons = [];
    this.rng = new RNG(1234);
    this.A = {};
    this.resize(o.W || 960, o.H || 540);
  }

  resize(W, H) {
    W = Math.max(64, Math.round(W)); H = Math.max(64, Math.round(H));
    if (W === this.W && H === this.H) return;
    this.W = W; this.H = H;
    this.u = H / 540;
    this.F = 100 * this.u;
    this.SW = SCREEN_H * W / H;
    this.Zf = 100 - (this.F * SCREEN_H) / H;
    this.scr = makeCanvas(W, H);
    this.sg = ctxOf(this.scr);
    this.land = null;
    this.vig = null;
    this.eco = null;
    this.layoutIcons();
    this.ready = false;
    this.tasks = this.buildTasks();
  }

  // ---------------------------------------------------------------------------------- progressive assets
  buildTasks() {
    const A = this.A;
    const u = this.u;
    const vox = (key, make, worldPerVoxel, maxScale, ro = {}) => () => {
      const scale = Math.max(1, Math.round(worldPerVoxel * maxScale * u * 4) / 4);
      const r = renderVoxels(make(), { scale, yaw: 0, pitch: 16, outline: true, ao: 0.9, ...ro });
      A[key] = { canvas: r.canvas, ox: r.ox, oy: r.oy, res: scale / worldPerVoxel, r };
    };
    const px = (key, make, scale, ro = {}) => () => {
      const ss = ro.ss || 1;
      const sc = Math.max(1, Math.round(scale * ss * 4) / 4);
      const r = renderVoxels(make(), { scale: sc, outline: true, ao: 0.8, ...ro });
      A[key] = { canvas: r.canvas, ox: r.ox, oy: r.oy, r, scale: sc, ss };
    };
    this.goldieVs = Math.max(1, Math.round(2.6 * u * 4) / 4);
    const goldieJobs = [];
    for (const mood of ['n', 'b', 'o', 'h']) for (let f = 0; f < 4; f++) goldieJobs.push(() => { goldieFrame(this.goldieVs, f, mood); });
    return [
      () => { this.land = renderLandscape(this.W, this.H); },
      () => this.paintWall(),
      vox('plant', () => plantModel(5), 2.3, 1.7, { yaw: -14, pitch: 14 }),
      vox('gravel', () => gravelModel(3), 1.25, 2.2, { pitch: 26, outline: false }),
      vox('keyboard', keyboardModel, 2.0, 1.8, { pitch: 62, outline: false, ao: 0.6 }),
      vox('mouse', mouseModel, 2.0, 1.8, { pitch: 42 }),
      vox('shelf', shelfModel, 3.4, 1.0, { pitch: 10 }),
      vox('frond', () => frondModel(9), 4, 0.6, { yaw: 10, pitch: 6, outline: false }),
      ...goldieJobs,
      () => {
        const m = logoModel();
        const want = this.W * 0.5 / m.nx;
        const r = renderVoxels(m, { scale: Math.max(1, Math.round(want * 4) / 4), yaw: -5, pitch: 10, outline: false, depthLines: false, ao: 0.5, edges: 0.25, light: { top: 3.5, lit: 3.2, dark: 2.3, bottom: 1.7 } });
        A.logo = this.finishLogo(r.canvas);
      },
      px('globe', () => globeModel(30, 7), (this.H * 0.36) / 63, { yaw: 20, pitch: 18, outline: false, ao: 0.4 }),
      px('city', cityModel, (this.H * 0.3) / 96, { yaw: 24, pitch: 6, outline: true }),
      px('tree', treeModel, (this.H * 0.13) / 52, { yaw: 10, pitch: 10 }),
      px('branch', () => branchModel(4, 11), (this.H * 0.5) / 80, { yaw: -8, pitch: 12, outline: true, ao: 0.7, ss: 2 }),
      px('branch2', () => branchModel(11, 7), (this.H * 0.36) / 80, { yaw: 12, pitch: 18, outline: true, ao: 0.7, ss: 2 }),
      px('sneaker', sneakerFishModel, (this.H * 0.17) / 50, { yaw: 28, pitch: 10, outline: true }),
      () => this.paintEco(),
      () => this.warmCharacter(),
    ];
  }

  runTasks(budgetMs) {
    const t0 = performance.now();
    while (this.tasks.length) {
      const job = this.tasks[0];
      let again = false;
      try { again = job() === 'again'; } catch (e) { console.warn('intro asset', e); }
      if (!again) this.tasks.shift();
      if (performance.now() - t0 > budgetMs) break;
    }
    if (!this.tasks.length) this.ready = true;
  }

  // The opening may start before the character's frames exist: build them under a small per-frame budget.
  warmCharacter() {
    if (typeof CHAR.warmCharacter !== 'function') return undefined;
    this.warmN = (this.warmN || 0) + 1;
    let done = true;
    try { done = CHAR.warmCharacter(this.look, { poses: ['wave', 'idle', 'cheer'], scale: this.charScale(), facing: 1, ms: 10 }); } catch (e) { done = true; }
    return !done && this.warmN < 150 ? 'again' : undefined;
  }

  charScale() { return Math.max(1, Math.round(1.6 * this.u * 4) / 4); }

  // The back wall: gradient, sunlight patch, a big white window (panes cut out), a glossy clock, baseboard.
  paintWall() {
    const rw = Math.max(0.5, 0.96 * this.u);
    const w = Math.ceil((WALL.x1 - WALL.x0) * rw), h = Math.ceil((WALL.y1 - WALL.y0) * rw);
    const c = makeCanvas(w, h), g = ctxOf(c);
    const X = (x) => (x - WALL.x0) * rw, Y = (y) => (y - WALL.y0) * rw;
    g.fillStyle = vgrad(g, 0, h, [[0, '#cfeaf9'], [0.45, '#e2f4fc'], [0.8, '#d4ecf7'], [1, '#bcdfef']]);
    g.fillRect(0, 0, w, h);
    const pool = g.createRadialGradient(X(60), Y(-160), 0, X(60), Y(-160), 520 * rw);
    pool.addColorStop(0, 'rgba(255,253,236,0.55)'); pool.addColorStop(0.5, 'rgba(255,253,236,0.18)'); pool.addColorStop(1, 'rgba(255,253,236,0)');
    g.fillStyle = pool; g.fillRect(0, 0, w, h);
    // Aero wall decal: a lime and aqua swoosh with glossy bubbles
    g.lineCap = 'round';
    for (const [col, off, lw] of [['rgba(140,224,90,0.55)', 0, 16], ['rgba(70,200,240,0.45)', 34, 10], ['rgba(255,255,255,0.8)', 56, 4]]) {
      g.strokeStyle = col; g.lineWidth = lw * rw;
      g.beginPath(); g.moveTo(X(300), Y(170 - off)); g.bezierCurveTo(X(470), Y(-20 - off), X(700), Y(140 - off), X(960), Y(-60 - off)); g.stroke();
    }
    for (const [bx, by, br] of [[380, 20, 26], [450, -40, 14], [620, 60, 34], [700, -30, 12], [820, 20, 22], [540, -90, 9]]) {
      const cx = X(bx), cy = Y(by), r = br * rw;
      const bg = g.createRadialGradient(cx - r * 0.3, cy - r * 0.35, r * 0.1, cx, cy, r);
      bg.addColorStop(0, 'rgba(255,255,255,0.85)'); bg.addColorStop(0.5, 'rgba(150,230,255,0.35)'); bg.addColorStop(1, 'rgba(60,180,230,0.55)');
      g.fillStyle = bg; g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.fill();
      g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = Math.max(1, 1.5 * rw); g.beginPath(); g.arc(cx, cy, r, Math.PI * 1.05, Math.PI * 1.6); g.stroke();
    }
    g.fillStyle = vgrad(g, Y(FLOOR_Y - 22), Y(FLOOR_Y), [[0, '#ffffff'], [0.7, '#e2f0f6'], [1, '#b8d2de']]);
    g.fillRect(0, Y(FLOOR_Y - 22), w, Y(FLOOR_Y) - Y(FLOOR_Y - 22));
    const f = WIN.frame;
    g.fillStyle = 'rgba(60,110,140,0.16)';
    rrect(g, X(WIN.x0 - 6), Y(WIN.y0 - 2), X(WIN.x1 + 10) - X(WIN.x0 - 6), Y(WIN.y1 + 14) - Y(WIN.y0 - 2), 10 * rw); g.fill();
    g.fillStyle = vgrad(g, Y(WIN.y0), Y(WIN.y1), [[0, '#ffffff'], [1, '#e4f1f7']]);
    rrect(g, X(WIN.x0), Y(WIN.y0), X(WIN.x1) - X(WIN.x0), Y(WIN.y1) - Y(WIN.y0), 8 * rw); g.fill();
    g.save();
    g.globalCompositeOperation = 'destination-out';
    const mx = (WIN.x0 + WIN.x1) / 2, my = WIN.y0 + (WIN.y1 - WIN.y0) * 0.42;
    const panes = [[WIN.x0 + f, WIN.y0 + f, mx - 5, my - 5], [mx + 5, WIN.y0 + f, WIN.x1 - f, my - 5], [WIN.x0 + f, my + 5, mx - 5, WIN.y1 - f], [mx + 5, my + 5, WIN.x1 - f, WIN.y1 - f]];
    for (const [a, b, cc, d] of panes) { rrect(g, X(a), Y(b), X(cc) - X(a), Y(d) - Y(b), 3 * rw); g.fill(); }
    g.restore();
    for (const [a, b, cc, d] of panes) {
      g.strokeStyle = 'rgba(110,160,190,0.55)'; g.lineWidth = Math.max(1, 2 * rw);
      rrect(g, X(a), Y(b), X(cc) - X(a), Y(d) - Y(b), 3 * rw); g.stroke();
      g.save();
      rrect(g, X(a), Y(b), X(cc) - X(a), Y(d) - Y(b), 3 * rw); g.clip();
      const pw = X(cc) - X(a), ph = Y(d) - Y(b);
      g.fillStyle = 'rgba(255,255,255,0.16)';
      g.beginPath(); g.moveTo(X(a) + pw * 0.15, Y(b)); g.lineTo(X(a) + pw * 0.42, Y(b)); g.lineTo(X(a) + pw * 0.05, Y(b) + ph); g.lineTo(X(a) - pw * 0.22, Y(b) + ph); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.09)';
      g.beginPath(); g.moveTo(X(a) + pw * 0.55, Y(b)); g.lineTo(X(a) + pw * 0.62, Y(b)); g.lineTo(X(a) + pw * 0.25, Y(b) + ph); g.lineTo(X(a) + pw * 0.18, Y(b) + ph); g.fill();
      g.restore();
    }
    g.fillStyle = 'rgba(255,255,255,0.9)';
    g.fillRect(X(WIN.x0 + 3), Y(WIN.y0 + 2), X(WIN.x1 - 3) - X(WIN.x0 + 3), Math.max(1, 2 * rw));
    g.fillStyle = vgrad(g, Y(WIN.y1 - 4), Y(WIN.y1 + 16), [[0, '#ffffff'], [0.45, '#f2f9fc'], [1, '#bcd6e2']]);
    rrect(g, X(WIN.x0 - 22), Y(WIN.y1 - 4), X(WIN.x1 + 22) - X(WIN.x0 - 22), Y(WIN.y1 + 16) - Y(WIN.y1 - 4), 4 * rw); g.fill();
    g.fillStyle = 'rgba(60,110,140,0.18)';
    g.fillRect(X(WIN.x0 - 18), Y(WIN.y1 + 16), X(WIN.x1 + 18) - X(WIN.x0 - 18), Math.max(2, 6 * rw));
    // glossy wall clock
    const ccx = X(470), ccy = Y(-390), cr = 46 * rw;
    g.fillStyle = 'rgba(60,110,140,0.18)'; g.beginPath(); g.arc(ccx + 4 * rw, ccy + 6 * rw, cr, 0, TAU); g.fill();
    g.fillStyle = hgrad(g, ccx - cr, ccx + cr, [[0, '#9fb4c4'], [0.3, '#ffffff'], [0.7, '#dbe8f0'], [1, '#8aa2b4']]);
    g.beginPath(); g.arc(ccx, ccy, cr, 0, TAU); g.fill();
    g.fillStyle = vgrad(g, ccy - cr, ccy + cr, [[0, '#ffffff'], [1, '#e2f4fb']]);
    g.beginPath(); g.arc(ccx, ccy, cr * 0.86, 0, TAU); g.fill();
    g.fillStyle = '#3f8fc4';
    for (let i = 0; i < 12; i++) { const a = (i / 12) * TAU; g.beginPath(); g.arc(ccx + Math.cos(a) * cr * 0.72, ccy + Math.sin(a) * cr * 0.72, (i % 3 ? 1.2 : 2.2) * rw, 0, TAU); g.fill(); }
    g.strokeStyle = '#0c3a52'; g.lineCap = 'round';
    g.lineWidth = 3.5 * rw; g.beginPath(); g.moveTo(ccx, ccy); g.lineTo(ccx + Math.cos(-2.4) * cr * 0.45, ccy + Math.sin(-2.4) * cr * 0.45); g.stroke();
    g.lineWidth = 2.5 * rw; g.beginPath(); g.moveTo(ccx, ccy); g.lineTo(ccx + Math.cos(-0.75) * cr * 0.66, ccy + Math.sin(-0.75) * cr * 0.66); g.stroke();
    g.fillStyle = '#ff9d2e'; g.beginPath(); g.arc(ccx, ccy, 3 * rw, 0, TAU); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.55)'; g.beginPath(); g.ellipse(ccx - cr * 0.25, ccy - cr * 0.45, cr * 0.5, cr * 0.22, -0.3, 0, TAU); g.fill();
    this.A.wall = { canvas: c, rw };
  }

  // The 2000s eco wallpaper behind the logo (static part, W x H): saturated sky, white arcs, wisps,
  // the curved grass horizon, the glass city in its water bubble and a round tree.
  paintEco() {
    const { W, H } = this;
    const c = makeCanvas(W, H), g = ctxOf(c);
    const sun = this.ecoSun();
    g.fillStyle = vgrad(g, 0, H, [[0, '#0a4fc0'], [0.32, '#1f7ae0'], [0.6, '#5fb6f6'], [0.78, '#bfe6ff'], [1, '#e8f8ff']]);
    g.fillRect(0, 0, W, H);
    // sun bloom baked in
    const sg = g.createRadialGradient(sun[0], sun[1], 0, sun[0], sun[1], H * 0.7);
    sg.addColorStop(0, 'rgba(255,255,250,0.95)'); sg.addColorStop(0.12, 'rgba(240,250,255,0.7)'); sg.addColorStop(0.45, 'rgba(160,220,255,0.18)'); sg.addColorStop(1, 'rgba(160,220,255,0)');
    g.fillStyle = sg; g.fillRect(0, 0, W, H);
    // white wireframe arcs sweeping across the sky
    g.strokeStyle = 'rgba(255,255,255,0.42)'; g.lineWidth = 1;
    const ac = [W * 0.66, H * 1.25];
    for (let i = 0; i < 12; i++) { const r = H * (0.78 + i * 0.032); g.beginPath(); g.arc(ac[0], ac[1], r, -2.55, -0.95); g.stroke(); }
    g.strokeStyle = 'rgba(255,255,255,0.22)';
    for (let i = 0; i < 6; i++) { const a = -2.4 + i * 0.26; g.beginPath(); g.moveTo(ac[0] + Math.cos(a) * H * 0.78, ac[1] + Math.sin(a) * H * 0.78); g.lineTo(ac[0] + Math.cos(a) * H * 1.13, ac[1] + Math.sin(a) * H * 1.13); g.stroke(); }
    // cumulus wisps
    const s = Math.max(1, Math.round(2 * this.u));
    for (const [fx, fy, cw, seed] of [[0.12, 0.08, 46, 3], [0.3, 0.2, 30, 8], [0.88, 0.62, 40, 5], [0.62, 0.05, 26, 12]]) {
      try { const cr = cumulus(seed, Math.round(cw * this.u * 2 / s), s); g.globalAlpha = 0.92; g.drawImage(cr.canvas, Math.round(fx * W - cr.w / 2), Math.round(fy * H)); g.globalAlpha = 1; } catch (e) { /* optional */ }
    }
    this.ecoSky = c;
    // the land layer: the curved grass horizon (a huge glossy dome), the tree, the glass city in its bubble
    const c2 = makeCanvas(W, H);
    const g2 = ctxOf(c2);
    const D = this.dome();
    const b = new PixelBuffer(W, H);
    const GR = ['#1f6a14', '#2a7e1a', '#358f20', '#43a126', '#52b32c', '#64c432', '#7ad23a', '#94de48', '#b2ea5a', '#d2f68a'].map((h) => pack(h));
    for (let y = Math.floor(D.top); y < H; y++) for (let x = 0; x < W; x++) {
      const d = D.r - Math.hypot(x - D.cx, y - D.cy);
      if (d < 0) continue;
      const rim = d < 3 * this.u ? 2.5 : d < 9 * this.u ? 1.2 : 0;
      const k = 6.2 - (d / (H * 0.55)) * 5 + rim + fbm2(x * 0.03, y * 0.05, 3, 4) * 1.6 - (x / W) * 0.6 + (hash2(x, y >> 1, 9) - 0.5) * 1.1;
      b.set(x, y, GR[clamp(Math.round(k + (((x + y) & 1) ? 0.25 : -0.25)), 0, GR.length - 1)]);
    }
    g2.drawImage(b.toCanvas(), 0, 0);
    // a winding path of light down the hill
    g2.strokeStyle = 'rgba(230,255,200,0.35)'; g2.lineWidth = 2 * this.u;
    g2.beginPath(); g2.moveTo(W * 0.3, D.y(W * 0.3) + 3); g2.bezierCurveTo(W * 0.32, H * 0.82, W * 0.24, H * 0.9, W * 0.28, H); g2.stroke();
    // the round tree on the horizon
    const tr = this.A.tree;
    if (tr) g2.drawImage(tr.canvas, Math.round(W * 0.56 - tr.ox), Math.round(D.y(W * 0.56) + 3 * this.u - tr.oy));
    // the glass city inside a water bubble (left)
    const ci = this.A.city;
    const bx = W * 0.16, by = D.y(W * 0.16) - H * 0.12, br = H * 0.21;
    if (ci) g2.drawImage(ci.canvas, Math.round(bx - ci.ox), Math.round(D.y(bx) + 8 * this.u - ci.oy));
    g2.save();
    g2.beginPath(); g2.arc(bx, by, br, 0, TAU); g2.clip();
    g2.fillStyle = 'rgba(200,245,255,0.16)'; g2.fillRect(bx - br, by - br, br * 2, br * 2);
    g2.restore();
    const rg = g2.createRadialGradient(bx - br * 0.2, by - br * 0.25, br * 0.6, bx, by, br);
    rg.addColorStop(0, 'rgba(255,255,255,0)'); rg.addColorStop(0.85, 'rgba(210,248,255,0.35)'); rg.addColorStop(1, 'rgba(255,255,255,0.9)');
    g2.fillStyle = rg; g2.beginPath(); g2.arc(bx, by, br, 0, TAU); g2.fill();
    g2.strokeStyle = 'rgba(255,255,255,0.85)'; g2.lineWidth = 1.5 * this.u;
    g2.beginPath(); g2.arc(bx, by, br, Math.PI * 0.9, Math.PI * 1.65); g2.stroke();
    g2.fillStyle = 'rgba(255,255,255,0.75)';
    g2.beginPath(); g2.ellipse(bx - br * 0.45, by - br * 0.5, br * 0.22, br * 0.1, -0.7, 0, TAU); g2.fill();
    // water wrapping around the bubble's base (a splash crown)
    g2.fillStyle = 'rgba(220,250,255,0.6)';
    for (let i = 0; i < 9; i++) { const a = Math.PI * (0.05 + i * 0.11); g2.beginPath(); g2.ellipse(bx + Math.cos(a) * br * 1.02, by + Math.sin(a) * br * 0.98, 3 * this.u, 9 * this.u, a + 1.2, 0, TAU); g2.fill(); }
    this.eco = c2;
    this.ecoDome = D;
  }

  ecoSun() { return [this.W * 0.4, this.H * 0.47]; }

  dome() {
    const { W, H } = this;
    const r = H * 1.9, cx = W * 0.42, cy = H * 0.6 + r;
    return { r, cx, cy, top: cy - r, y: (x) => cy - Math.sqrt(Math.max(0, r * r - (x - cx) ** 2)) };
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

  layoutIcons() {
    const ids = (BIG.MENU_ICON_IDS || []).filter((id) => ['appsea', 'lab', 'aquarium', 'journal', 'map', 'settings'].includes(id));
    this.icons = ids.map((id, i) => ({ id, x: 44 + Math.floor(i / 4) * 74, y: 48 + (i % 4) * 70, lift: 0, ph: i * 1.7, wet: 0 }));
  }

  // -------------------------------------------------------------------------------------------- control
  seek(t) {
    while (this.tasks.length) this.runTasks(1e9);
    this.t = t;
    this.ready = true;
    for (const k of Object.keys(T)) if (T[k] < t) this.cues.add(k);
    if (t > T.swirl && t < T.pop + 0.4) { this.cues.delete('swirl'); }
  }

  skip() {
    if (this.skipT >= 0 || !this.active) return;
    this.skipT = 0;
    this.sfx('travel_whoosh', { vol: 0.5 });
  }

  sfx(name, o) { try { this.audio?.play?.(name, o); } catch (e) { /* audio is optional */ } }

  cue(name, at) {
    if (this.cues.has(name) || this.t < at) return false;
    this.cues.add(name);
    return true;
  }

  // ------------------------------------------------------------------------------------------- camera
  camera(t) {
    const a = ease.inOutCubic(inv(T.dolly0, T.dolly1, t));
    const ax = ease.inOutCubic(inv(T.dolly0, T.dolly1 - 0.9, t));
    const drift = t * 3.2;
    const sx = -74 + drift * 1.6, sy = -52 + drift * 0.5, sz = -8 + drift * 2.2;
    const hand = 1 - a;
    const cx = lerp(sx, 0, ax) + Math.sin(t * 0.7) * 2.2 * hand;
    const cy = lerp(sy, MON.cy, ax) + Math.cos(t * 0.53) * 1.4 * hand;
    const cz = lerp(sz, this.Zf, a);
    return { x: cx, y: cy, z: cz, a };
  }

  proj(X, Y, Z) {
    const c = this.cam;
    const d = Math.max(0.5, Z - c.z);
    const s = this.F / d;
    return [this.W / 2 + (X - c.x) * s, this.H / 2 + (Y - c.y) * s, s];
  }

  // ------------------------------------------------------------------------------------------- update
  update(dt) {
    if (!this.active) return;
    dt = Math.min(dt, 1 / 15);
    const inp = this.input;
    if (!this.ready) {
      this.bootT += dt;
      this.runTasks(this.bootT < 0.15 ? 4 : 16);
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
    const t = (this.t += dt);
    this.cam = this.camera(t);
    this.updateCues(t);
    this.updateGoldie(dt, t);
    this.update3D(dt, t);
    this.updateScreen(dt, t);
    this.updateGather(dt, t);
    this.updateEco(dt, t);
    // the bubble person bursts through the water surface while the camera tilts up
    if (t > T.rise0 && t < T.rise1 + 0.3) {
      const seam = ease.inOutCubic(inv(T.rise0, T.rise1, t)) * this.H;
      const [hx, hy] = this.charPos(t);
      const below = hy - 30 * this.charScale() > seam;
      if (this.heroBelow && !below) {
        this.sfx('splash_big', { vol: 0.7 });
        this.fx.splash(hx, seam, 1.6);
        this.fx.droplets(hx, seam, 26, { speed: [80, 260], spread: 0.9, w: 20 });
        this.fx.ringWave(hx, seam, 60 * this.u, '#ffffff', { life: 0.5, w: 3, flat: 0.3 });
        this.fx.aeroBubbles(hx, seam + 20, 20, { w: 60, h: 10, speed: [60, 180] });
      }
      this.heroBelow = below;
    }
    this.fx.update(dt);
    if (t >= T.out0 + 0.3 && !this.handed) { this.handed = true; this.o.onHandoff?.(); }
    if (t >= END) this.finish();
  }

  finish() {
    if (!this.active) return;
    this.active = false;
    this.o.onDone?.();
  }

  updateCues(t) {
    if (this.cue('start', 0)) { try { this.audio?.setMusic?.('desktop'); } catch (e) { /* optional */ } }
    if (this.cue('notice', T.notice)) this.sfx('squeak', { vol: 0.5, pitch: 1.3 });
    if (this.cue('blow', T.blow)) this.sfx('bubbles', { vol: 0.6 });
    if (this.cue('dolly0', T.dolly0)) this.sfx('travel_whoosh', { vol: 0.25, pitch: 0.7 });
    if (this.cue('flood0', T.flood0)) this.sfx('flood_rush', { vol: 0.7 });
    if (this.cue('dolly1', T.dolly1)) this.sfx('splash_big', { vol: 0.5 });
    if (this.cue('swirl', T.swirl)) { this.sfx('magic', { vol: 0.6 }); this.startGather(); }
    if (this.cue('pop', T.pop)) {
      this.sfx('boing', { vol: 0.7 }); this.sfx('catch_rare', { vol: 0.45 });
      const [x, y] = this.charPos(t);
      const h = 50 * this.charScale();
      this.fx.ringWave(x, y - h * 0.5, 70 * this.u, '#dff8ff', { life: 0.6, w: 3 });
      this.fx.glints(x, y - h * 0.5, 10, { w: 40 * this.u, h: 50 * this.u });
      this.fx.aeroBubbles(x, y - h * 0.4, 26, { w: 30, h: 40, speed: [40, 120] });
    }
    if (this.cue('rise0', T.rise0)) { this.sfx('travel_whoosh', { vol: 0.5, pitch: 1.2 }); try { this.audio?.setMusic?.(this.o.music || 'shallows'); } catch (e) { /* optional */ } }
    if (this.cue('logo', T.logo)) { this.sfx('ui_unlock', { vol: 0.6 }); this.sfx('sparkle', { vol: 0.6 }); }
    if (this.cue('flare', T.flare)) this.sfx('golden_shimmer', { vol: 0.5 });
    if (this.cue('sneak', T.sneak + 0.4)) this.sfx('squeak', { vol: 0.4, pitch: 0.8 });
    if (this.cue('out0', T.out0)) {
      this.sfx('splash_big', { vol: 0.7 });
      this.sfx('bubbles', { vol: 0.8 });
      const { W, H } = this;
      for (let i = 0; i < 80; i++) this.fx.add({ kind: 'gbubble', x: this.rng.float(0, W), y: H + this.rng.float(0, H * 0.5), vx: this.rng.float(-10, 10), vy: -this.rng.float(180, 340) * this.u, life: 3, r: this.rng.pick([3, 4, 5, 6, 8, 10, 12]), wob: this.rng.float(0, TAU), layer: 'top', rise: 1, delay: this.rng.float(0, 1.0) });
    }
  }

  // --------------------------------------------------------------------------------------------- Goldie
  updateGoldie(dt, t) {
    const G = (this.goldie ||= { x: -10, y: -46, d: 0.2, facing: 1, blink: 0, mood: 'neutral' });
    let tx, ty, td;
    if (t < T.notice) { const a = t * 0.9; tx = Math.sin(a) * 22; ty = -44 + Math.sin(a * 1.7) * 5; td = Math.cos(a) * 0.8; }
    else if (t < T.blow + 1.2) { tx = 4 + Math.sin(t * 2) * 2; ty = -46; td = 1; }
    else { const a = (t - T.blow) * 1.1; tx = Math.sin(a) * 16; ty = -48 + Math.sin(a * 1.3) * 6; td = 0.4 + Math.cos(a) * 0.5; }
    const px = G.x;
    G.x += (tx - G.x) * Math.min(1, dt * 3);
    G.y += (ty - G.y) * Math.min(1, dt * 3);
    G.d += (td - G.d) * Math.min(1, dt * 3);
    const vx = (G.x - px) / Math.max(1e-4, dt);
    if (Math.abs(vx) > 3) G.facing = vx > 0 ? 1 : -1;
    if (t >= T.notice && t < T.blow - 0.2) G.facing = 1;
    if (t > T.blow - 0.2 && t < T.blow + 1.4) G.facing = -1; // turn toward the monitor and blow
    G.blink = (t % 3.1 < 0.12) || (t > T.notice + 0.25 && t < T.notice + 0.37) || (t > T.notice + 0.55 && t < T.notice + 0.65) ? 1 : 0;
    G.mood = t > T.blow - 0.2 && t < T.blow + 1.6 ? 'o' : t >= T.notice + 0.8 && t < T.blow - 0.3 ? 'happy' : 'neutral';
  }

  // ----------------------------------------------------------------------------------- 3D particles
  update3D(dt, t) {
    const r = this.rng;
    if (t < T.dolly1 && this.p3.length < 160 && r.chance(dt * 30)) {
      this.p3.push({ kind: 'dust', x: r.float(-760, 300), y: r.float(-380, 220), z: r.float(60, 175), vx: r.float(-2, 2), vy: r.float(-3, 1), vz: r.float(-1, 1), t: 0, life: r.float(4, 8), r: r.pick([1, 1, 1, 2]), ph: r.float(0, TAU) });
    }
    if (t < T.dolly1 - 2 && this.p3.filter((p) => p.kind === 'bokeh').length < 9 && r.chance(dt * 3)) {
      this.p3.push({ kind: 'bokeh', x: this.cam.x + r.float(-260, 260), y: this.cam.y + r.float(-170, 170), z: this.cam.z + r.float(26, 60), vx: r.float(-5, 5), vy: r.float(-6, -1), vz: 0, t: 0, life: r.float(3, 6), r: r.float(9, 20), c: r.pick(['#bff0ff', '#e8ffd0', '#ffffff', '#9fe8ff', '#d8ffa0']), ph: 0 });
    }
    const G = this.goldie;
    const blowing = t > T.blow && t < T.fly1;
    if (t < T.dolly1 && r.chance(dt * (blowing ? 14 : 1.4))) {
      const fromG = blowing && r.chance(0.6);
      this.p3.push({ kind: 'jar', x: fromG ? G.x - 12 * G.facing * -1 : r.float(-26, 26), y: fromG ? G.y - 2 : -14, z: JAR.z - 4 + r.float(-6, 6), vy: -r.float(14, 26), t: 0, life: 6, r: r.pick([1.5, 2, 2.5, 3]), ph: r.float(0, TAU), fly: blowing && t > T.fly0 - 1 && r.chance(0.75) });
    }
    for (const p of this.p3) {
      p.t += dt;
      if (p.kind === 'dust' || p.kind === 'bokeh') {
        p.x += (p.vx + Math.sin(t * 0.6 + p.ph) * 2) * dt; p.y += p.vy * dt; p.z += p.vz * dt;
        if (p.z - this.cam.z < 8) p.dead = true;
      } else if (p.kind === 'jar') {
        p.ph += dt * 6;
        p.y += p.vy * dt; p.x += Math.sin(p.ph) * 6 * dt;
        if (p.y < JAR.water + 2) {
          if (p.fly) {
            const tx = lerp(-this.SW * 0.42, this.SW * 0.42, r.float(0, 1)), ty = MON.cy + r.float(-0.2, 0.5) * SCREEN_H;
            Object.assign(p, { kind: 'fly', p0: [JAR.x + p.x, DESK.y + JAR.water - 4, JAR.z], p1: [JAR.x * 0.35 + r.float(-60, 60), -200 + r.float(-40, 40), JAR.z - 8], p2: [tx, ty, MON.z - 0.5], t: 0, life: r.float(1.6, 2.6), r: p.r * 1.6 + r.float(0, 2) });
          } else p.dead = true;
        }
      } else if (p.kind === 'fly') {
        const k = ease.inOutQuad(clamp01(p.t / p.life));
        const q = bez(p.p0, p.p1, p.p2, k);
        p.x = q[0] + Math.sin(p.t * 5 + p.r) * 4 * (1 - k); p.y = q[1]; p.z = q[2];
        if (p.t >= p.life) {
          p.dead = true;
          const lx = ((p.x + this.SW / 2) / this.SW) * this.W, ly = ((p.y - (MON.cy - SCREEN_H / 2)) / SCREEN_H) * this.H;
          this.sp.add({ kind: 'gbubble', x: lx, y: ly, vx: r.float(-20, 20), vy: -r.float(10, 40), life: 4, r: Math.max(2, Math.round(p.r * this.H / SCREEN_H * 0.45)), wob: 0, layer: 'fg', rise: 0.6 });
          this.sp.ringWave(lx, ly, 14 * this.u, '#e8fbff', { life: 0.4, w: 2 });
          if (r.chance(0.3)) this.sfx('bubble', { vol: 0.25, pitch: r.float(0.9, 1.4) });
        }
      }
      if (p.t >= p.life) p.dead = true;
    }
    this.p3 = this.p3.filter((p) => !p.dead);
  }

  // ---------------------------------------------------------------------------- the desktop on screen
  waterline(x, t) {
    const k = ease.inOutCubic(inv(T.flood0, T.flood1, t));
    const base = lerp(this.H + 16, this.H * 0.085, k);
    const amp = 1 + 2 * Math.sin(Math.PI * k);
    return base + (Math.sin(x * 0.03 + t * 2.4) * 3 + Math.sin(x * 0.011 - t * 1.4) * 5) * amp;
  }

  updateScreen(dt, t) {
    if (t > T.rise1 && t < T.out0) return;
    const { W, H } = this;
    const flooding = t > T.flood0;
    this.sp.surfaceY = flooding ? this.waterline(W / 2, t) + 4 : null;
    for (const ic of this.icons) {
      const wl = this.waterline(ic.x, t);
      const wet = flooding && wl < ic.y + 40;
      ic.wet = clamp01(ic.wet + (wet ? dt * 1.5 : -dt));
      if (wet) ic.lift = Math.min(ic.lift + dt * 14, 26);
    }
    if (flooding) {
      const r = this.rng;
      const k = inv(T.flood0, T.flood1, t);
      if (k < 1) for (let i = 0; i < 3; i++) { const x = r.float(0, W); this.sp.bubble(x, this.waterline(x, t) + r.float(4, 30), { size: r.pick([1, 2, 2, 3]) }); }
      if (r.chance(dt * 12)) { const x = r.float(0, W); this.sp.aeroBubbles(x, H + 6, 1, { sizes: [2, 3, 4, 5], speed: [30, 70], life: [2, 4] }); }
      if (k > 0.05 && k < 0.95 && r.chance(dt * 4)) { const x = r.float(0, W); this.sp.splash(x, this.waterline(x, t), 0.5); }
    }
    this.sp.update(dt);
  }

  // ------------------------------------------------------------------------------- the bubble person
  charPos(t) {
    const { W, H } = this;
    const bob = Math.sin(t * 1.8) * 3 * this.u;
    const under = [W * 0.5, H * 0.66 + bob];
    if (t < T.rise0) return under;
    const D = this.ecoDome || this.dome();
    const land = [W * 0.5, D.y(W * 0.5) + 6 * this.u];
    const k = inv(T.rise0 + 0.1, T.rise1 + 0.2, t);
    if (k >= 1) {
      const hop = t < T.rise1 + 0.8 ? Math.abs(Math.sin((t - T.rise1) * 6)) * 6 * this.u * (1 - (t - T.rise1) / 0.8) : 0;
      return [land[0], land[1] - hop];
    }
    // swim up through the surface in an arc and land on the hill
    const e = ease.inOutCubic(k);
    return [lerp(under[0], land[0], e), lerp(under[1], land[1], e) - Math.sin(Math.PI * e) * H * 0.22];
  }

  silhouette() {
    const pts = [];
    try {
      if (typeof CHAR.drawCharacter === 'function') {
        const S = Math.ceil(220 * this.u), c = makeCanvas(S, S), g = ctxOf(c);
        CHAR.drawCharacter(g, S / 2, S * 0.92, { pose: 'wave', t: 0, facing: 1, scale: this.charScale(), look: this.look, shadow: false });
        const d = g.getImageData(0, 0, S, S).data;
        const step = Math.max(2, Math.round(3 * this.u));
        for (let y = 0; y < S; y += step) for (let x = 0; x < S; x += step) if (d[(y * S + x) * 4 + 3] > 128) pts.push([x - S / 2, y - S * 0.92]);
      }
    } catch (e) { /* default below */ }
    if (pts.length < 20) {
      const s = this.charScale();
      for (let i = 0; i < 90; i++) { const a = (i / 90) * TAU; const head = i % 3 === 0; pts.push(head ? [Math.cos(a) * 14 * s, -58 * s + Math.sin(a) * 14 * s] : [Math.cos(a) * 12 * s * this.rng.float(0.2, 1), -22 * s + Math.sin(a) * 22 * s * this.rng.float(0.2, 1)]); }
    }
    return pts;
  }

  startGather() {
    const pts = this.silhouette();
    const r = this.rng;
    for (let i = pts.length - 1; i > 0; i--) { const j = r.int(0, i); [pts[i], pts[j]] = [pts[j], pts[i]]; }
    const n = Math.min(150, pts.length);
    const { W, H } = this;
    this.gather = [];
    for (let i = 0; i < n; i++) {
      const a = r.float(0, TAU), d = r.float(0.45, 0.8) * Math.max(W, H);
      this.gather.push({ tx: pts[i][0], ty: pts[i][1], a, d, r: r.pick([2, 2.5, 3, 3.5, 4, 5]), spin: r.float(2.2, 3.4), delay: r.float(0, 0.6), x: -99, y: -99 });
    }
  }

  updateGather(dt, t) {
    if (!this.gather.length) return;
    const [cx, cy] = this.charPos(t);
    const span = T.gather - T.swirl;
    for (const b of this.gather) {
      const k = clamp01((t - T.swirl - b.delay) / (span - b.delay * 0.5));
      const e = ease.inOutCubic(k);
      const ang = b.a + (1 - e) * b.spin * TAU * 0.5;
      const rad = b.d * (1 - e);
      b.x = cx + b.tx * e + Math.cos(ang) * rad;
      b.y = cy + b.ty * e + Math.sin(ang) * rad * 0.7;
    }
    if (t > T.pop) for (const b of this.gather) if (!b.popped && this.rng.chance(0.25)) { b.popped = true; this.fx.sparkle(b.x, b.y, '#ffffff'); }
    if (t > T.pop + 0.4) this.gather = [];
  }

  // --------------------------------------------------------------------------------------- eco scene
  updateEco(dt, t) {
    if (t < T.rise0 || !this.eco) return;
    const { W, H } = this;
    const r = this.rng;
    // splashes and bubbles along the water at the bottom; sun glints
    if (r.chance(dt * 3)) this.fx.splash(r.float(W * 0.05, W * 0.95), H * 0.93, r.float(0.4, 0.9));
    if (r.chance(dt * 8)) this.fx.aeroBubbles(r.float(0, W), H * 0.98, 1, { sizes: [3, 4, 5, 6, 8], speed: [20, 60], life: [2, 4] });
    if (r.chance(dt * 2)) this.fx.glint(r.float(0, W), r.float(H * 0.05, H * 0.5), { len: r.pick([3, 4, 6]) });
  }

  // ============================================================================================== drawing
  skipRect() { const w = 64, h = 20; return { x: this.W - w - 10, y: 10, w, h }; }

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
    else if (t > T.out0 + 0.5) alpha = 1 - ease.inOutCubic(inv(T.out0 + 0.5, T.out1, t));
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
    drawAeroGlow(ctx, W / 2, H / 2, Math.round(H * 0.4), '#bfeeff', 0.5);
    const b = this.bootT;
    if (b > 0.25) {
      ctx.globalAlpha = clamp01((b - 0.25) * 3);
      drawGlossOrb(ctx, W / 2, H / 2 + Math.sin(b * 4) * 3, 9 * this.u, '#2fd3e8');
      for (let i = 0; i < 3; i++) { const ph = (b * 0.8 + i / 3) % 1; drawAeroBubble(ctx, W / 2 + Math.sin(ph * 9 + i) * 8, H / 2 - 14 - ph * 40, 2 + i, 1 - ph); }
      ctx.globalAlpha = 1;
    }
  }

  drawFrame(ctx, t) {
    const { W, H } = this;
    this.cam = this.camera(t);
    // pan offsets: up into the eco wallpaper, then back down under the water at the end
    const up = ease.inOutCubic(inv(T.rise0, T.rise1, t)), down = ease.inOutCubic(inv(T.out0, T.out0 + 1.1, t));
    const pan = up - down;
    if (pan < 0.999) {
      this.renderScreen(t);
      const dy = Math.round(pan * H);
      if (t < T.dolly1) this.drawRoom(ctx, t);
      else ctx.drawImage(this.scr, 0, dy);
      if (t >= T.swirl - 0.1 && t < T.rise0 + 0.5) this.drawGather(ctx, t);
    }
    if (pan > 0.001) this.drawEco(ctx, t, Math.round((pan - 1) * H));
    if (pan > 0.001 && pan < 0.999) this.drawSurfaceSeam(ctx, t, Math.round(pan * H));
    if (t >= T.pop - 0.15 && t < T.out0 + 0.9) this.drawHero(ctx, t, pan);
    if (t >= T.logo) this.drawLogo(ctx, t, Math.round((pan - 1) * H));
    this.fx.draw(ctx, 'fg', t);
    this.drawVignette(ctx);
    if (t < T.fade) {
      const k = 1 - ease.outCubic(t / T.fade);
      ctx.fillStyle = rgba('#f5fcff', k);
      ctx.fillRect(0, 0, W, H);
    }
  }

  drawVignette(ctx) {
    const { W, H } = this;
    if (!this.vig || this.vig.width !== W || this.vig.height !== H) {
      const c = makeCanvas(W, H), g = ctxOf(c);
      const gr = g.createRadialGradient(W / 2, H * 0.48, Math.min(W, H) * 0.42, W / 2, H / 2, Math.hypot(W, H) * 0.62);
      gr.addColorStop(0, 'rgba(6,40,80,0)'); gr.addColorStop(1, 'rgba(6,40,80,0.26)');
      g.fillStyle = gr; g.fillRect(0, 0, W, H);
      this.vig = c;
    }
    ctx.drawImage(this.vig, 0, 0);
  }

  // A sprite billboard at a world anchor; res = sprite px per world unit; (ax, ay) = anchor in sprite px.
  card(ctx, spr, X, Y, Z, res, ax, ay, alpha = 1) {
    if (!spr || Z - this.cam.z < 4) return;
    const [sx, sy, s] = this.proj(X, Y, Z);
    const k = s / res;
    const w = spr.width * k, h = spr.height * k;
    const x = sx - ax * k, y = sy - ay * k;
    if (x > this.W || y > this.H || x + w < 0 || y + h < 0) return;
    ctx.imageSmoothingEnabled = k < 0.98;
    ctx.imageSmoothingQuality = 'high';
    if (alpha < 1) ctx.globalAlpha = alpha;
    ctx.drawImage(spr, x, y, w, h);
    ctx.globalAlpha = 1;
    ctx.imageSmoothingEnabled = false;
  }

  prop(ctx, key, X, Y, Z, alpha = 1) {
    const a = this.A[key];
    if (a) this.card(ctx, a.canvas, X, Y, Z, a.res, a.ox, a.oy, alpha);
  }

  quad(ctx, pts) {
    ctx.beginPath();
    pts.forEach(([x, y, z], i) => { const p = this.proj(x, y, z); if (i) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]); });
    ctx.closePath();
  }

  drawRoom(ctx, t) {
    const { W, H } = this;
    ctx.fillStyle = COL.wallM;
    ctx.fillRect(0, 0, W, H);
    this.drawOutside(ctx, t);
    const wa = this.A.wall;
    if (wa) this.card(ctx, wa.canvas, WALL.x0, WALL.y0, ZW, wa.rw, 0, 0);
    this.drawFloor(ctx);
    this.prop(ctx, 'shelf', SHELF.x, SHELF.y, SHELF.z);
    this.drawLamp(ctx, t);
    this.drawBeams(ctx, t);
    this.drawLegs(ctx, DESK.z1 - 8);
    this.drawDeskTop(ctx, t);
    this.drawMonitor(ctx, t);
    this.prop(ctx, 'keyboard', -18, DESK.y, 86);
    this.prop(ctx, 'mouse', 150, DESK.y, 88);
    this.drawJar(ctx, t);
    this.prop(ctx, 'plant', -330, DESK.y, 98);
    this.drawDeskEdge(ctx);
    this.drawLegs(ctx, DESK.z0 + 8);
    this.draw3D(ctx, t);
    const fr = this.A.frond;
    if (fr && this.cam.z < 30) this.card(ctx, fr.canvas, -300, -250, 46, fr.res, fr.canvas.width * 0.95, fr.canvas.height * 0.6, clamp01((30 - this.cam.z) / 16) * 0.92);
    this.drawSunFlare(ctx, t);
  }

  drawOutside(ctx, t) {
    if (!this.land) return;
    const [x0, y0] = this.proj(WIN.x0, WIN.y0, ZW), [x1, y1] = this.proj(WIN.x1, WIN.y1, ZW);
    if (x1 < 0 || x0 > this.W) return;
    ctx.save();
    ctx.beginPath(); ctx.rect(x0, y0, x1 - x0, y1 - y0); ctx.clip();
    ctx.fillStyle = '#1361c8';
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    const lw = 2700, lh = lw * this.land.height / this.land.width;
    const [a, b, s] = this.proj(-2100, -120 - lh * 0.6, Z_OUT);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.land, a, b, lw * s, lh * s);
    ctx.imageSmoothingEnabled = false;
    const [sx, sy] = this.proj(-930, -520, Z_OUT);
    drawAeroGlow(ctx, sx, sy, Math.round(80 * this.u), '#fffbe0', 0.85);
    drawAeroGlow(ctx, sx, sy, Math.round(26 * this.u), '#ffffff', 1);
    ctx.restore();
    this.sunPos = [sx, sy];
    void t;
  }

  drawSunFlare(ctx, t) {
    if (!this.sunPos) return;
    const [sx, sy] = this.sunPos;
    const vis = clamp01(1 - inv(T.dolly0 + 1, T.dolly0 + 4.5, t)) * (0.75 + 0.25 * Math.sin(t * 1.3));
    if (vis > 0.01) this.flare(ctx, sx, sy, vis, 1);
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
    for (const [k, r, c, a] of ghosts) drawAeroGlow(ctx, lerp(sx, cx, k * 1.2), lerp(sy, cy, k * 1.2), Math.round(r * this.u * size), c, a * vis * 2);
    ctx.restore();
  }

  drawFloor(ctx) {
    this.quad(ctx, [[-1600, FLOOR_Y, ZW], [1600, FLOOR_Y, ZW], [1600, FLOOR_Y, 10], [-1600, FLOOR_Y, 10]]);
    const [, ya] = this.proj(0, FLOOR_Y, ZW), [, yb] = this.proj(0, FLOOR_Y, 40);
    ctx.fillStyle = vgrad(ctx, ya, yb, [[0, '#dcecf2'], [0.4, '#eef5f4'], [1, '#f8f3ea']]);
    ctx.fill();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = 'rgba(255,250,230,0.18)';
    this.quad(ctx, [[-700, FLOOR_Y, ZW - 10], [-260, FLOOR_Y, ZW - 10], [80, FLOOR_Y, 110], [-360, FLOOR_Y, 110]]);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  }

  // Easter egg: the moving-picture aquarium lamp (silver frame, a scrolling reef panorama, a blue glow).
  drawLamp(ctx, t) {
    const z = SHELF.z - 4;
    const [x0, y0, s] = this.proj(LAMP.x - LAMP.w / 2, LAMP.y - LAMP.h, z), [x1, y1] = this.proj(LAMP.x + LAMP.w / 2, LAMP.y, z);
    if (x0 > this.W || x1 < 0) return;
    const w = x1 - x0, h = y1 - y0;
    drawAeroGlow(ctx, (x0 + x1) / 2, (y0 + y1) / 2, Math.round(w * 0.75), '#5fc8ff', 0.35 + 0.05 * Math.sin(t * 3));
    // base and top: silver plastic
    const bar = (yy, hh) => { ctx.fillStyle = vgrad(ctx, yy, yy + hh, [[0, '#f4f8fb'], [0.4, '#c8d2da'], [0.7, '#9aa8b4'], [1, '#d8e0e6']]); rrect(ctx, x0, yy, w, hh, Math.min(3 * s, hh / 2)); ctx.fill(); };
    const bh = h * 0.2, th = h * 0.1;
    // the scrolling panorama (behind the clear front)
    const py0 = y0 + th, ph = h - bh - th;
    const strip = reefPanorama();
    ctx.save();
    ctx.beginPath(); ctx.rect(x0 + 2 * s, py0, w - 4 * s, ph); ctx.clip();
    const k = ph / strip.height;
    const sw = strip.width * k;
    const off = ((t * 14 * s) % sw);
    ctx.imageSmoothingEnabled = k < 0.98;
    for (let x = x0 - off; x < x1; x += sw) ctx.drawImage(strip, x, py0, sw, ph);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = 'rgba(120,200,255,0.18)'; ctx.fillRect(x0, py0, w, ph * 0.3);
    ctx.fillStyle = 'rgba(255,255,255,0.22)'; ctx.fillRect(x0 + w * 0.08, py0, Math.max(1, w * 0.05), ph);
    ctx.restore();
    // side columns (curved clear plastic)
    ctx.fillStyle = 'rgba(230,245,255,0.35)';
    ctx.fillRect(x0, py0, w * 0.06, ph); ctx.fillRect(x1 - w * 0.06, py0, w * 0.06, ph);
    bar(y0, th);
    bar(y1 - bh, bh);
    ctx.fillStyle = '#1a2230'; ctx.fillRect(x0 + w * 0.72, y1 - bh * 0.62, w * 0.09, bh * 0.4);
    ctx.fillStyle = '#ff5a5a'; ctx.fillRect(x0 + w * 0.735, y1 - bh * 0.55, Math.max(1, w * 0.03), bh * 0.26);
  }

  drawBeams(ctx, t) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const off = [240, 330, -110];
    for (let i = 0; i < 4; i++) {
      const xa = WIN.x0 + 40 + i * 150, xb = xa + 70 + (i % 2) * 40;
      const a = 0.03 + 0.015 * Math.sin(t * 0.9 + i * 1.7);
      const P = [[xa, WIN.y0 + 30, ZW - 2], [xb, WIN.y0 + 30, ZW - 2], [xb + off[0], WIN.y1 + off[1], ZW - 2 + off[2]], [xa + off[0], WIN.y1 + off[1], ZW - 2 + off[2]]];
      const p0 = this.proj(...P[0]), p2 = this.proj(...P[2]);
      const gr = ctx.createLinearGradient(p0[0], p0[1], p2[0], p2[1]);
      gr.addColorStop(0, rgba('#fffbe8', a)); gr.addColorStop(0.7, rgba('#fffbe8', a * 0.4)); gr.addColorStop(1, 'rgba(255,251,232,0)');
      ctx.fillStyle = gr;
      this.quad(ctx, P);
      ctx.fill();
    }
    ctx.restore();
  }

  drawLegs(ctx, z) {
    for (const x of [DESK.x0 + 26, DESK.x1 - 26]) {
      const [a, b, s] = this.proj(x, DESK.y + DESK.th, z), [, c] = this.proj(x, FLOOR_Y, z);
      const w = 9 * s;
      if (a + w < 0 || a - w > this.W) continue;
      ctx.fillStyle = hgrad(ctx, a - w / 2, a + w / 2, [[0, COL.chrome[0]], [0.3, COL.chrome[2]], [0.45, COL.chrome[3]], [0.7, COL.chrome[1]], [1, COL.chrome[0]]]);
      ctx.fillRect(a - w / 2, b, w, c - b);
      ctx.fillStyle = 'rgba(40,70,90,0.18)';
      ctx.beginPath(); ctx.ellipse(a, c, w * 1.4, w * 0.3, 0, 0, TAU); ctx.fill();
    }
  }

  drawDeskTop(ctx, t) {
    const { y, z0, z1, x0, x1 } = DESK;
    this.quad(ctx, [[x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0]]);
    const [, ya] = this.proj(0, y, z1), [, yb] = this.proj(0, y, z0);
    ctx.fillStyle = vgrad(ctx, ya, yb, [[0, 'rgba(150,222,236,0.6)'], [1, 'rgba(206,248,248,0.78)']]);
    ctx.fill();
    ctx.save();
    this.quad(ctx, [[x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0]]);
    ctx.clip();
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    this.quad(ctx, [[-520, y, z1], [-300, y, z1], [-200, y, z0], [-420, y, z0]]); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    this.quad(ctx, [[-260, y, z1], [-220, y, z1], [-120, y, z0], [-160, y, z0]]); ctx.fill();
    const hw = this.SW / 2 + MON.side;
    ctx.fillStyle = 'rgba(10,30,50,0.10)';
    this.quad(ctx, [[-hw, y, MON.z + 3], [hw, y, MON.z + 3], [hw * 0.9, y, z0], [-hw * 0.9, y, z0]]); ctx.fill();
    ctx.restore();
    // light focused through the bowl onto the desk
    if (JAR.z - 22 - this.cam.z < 12) return;
    const [cx, cy, s] = this.proj(JAR.x + 30, y, JAR.z - 22);
    if (cx - 42 * s > this.W) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.translate(cx, cy); ctx.scale(1, 0.28);
    drawAeroGlow(ctx, 0, 0, Math.min(160, Math.round(42 * s)), '#c8fbff', 0.5 + 0.1 * Math.sin(t * 2));
    ctx.restore();
  }

  drawDeskEdge(ctx) {
    const { y, z0, x0, x1, th } = DESK;
    this.quad(ctx, [[x0, y, z0], [x1, y, z0], [x1, y + th, z0], [x0, y + th, z0]]);
    const [, ya] = this.proj(0, y, z0), [, yb] = this.proj(0, y + th, z0);
    ctx.fillStyle = vgrad(ctx, ya, yb, [[0, '#d8fff4'], [0.25, COL.glassEdge], [1, COL.glassEdgeD]]);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    const [a] = this.proj(x0, y, z0), [b] = this.proj(x1, y, z0);
    ctx.fillRect(a, ya, b - a, Math.max(1, (yb - ya) * 0.18));
  }

  drawMonitor(ctx, t) {
    const hw = this.SW / 2, hh = SCREEN_H / 2;
    const bx0 = -hw - MON.side, bx1 = hw + MON.side, by0 = MON.cy - hh - MON.top, by1 = MON.cy + hh + MON.chin;
    const z0 = MON.z, z1 = MON.z + MON.depth;
    const [nx, ny0, ns] = this.proj(0, by1 - 4, z1 - 2), [, ny1] = this.proj(0, DESK.y, z1 - 2);
    const nw = 26 * ns;
    ctx.fillStyle = hgrad(ctx, nx - nw / 2, nx + nw / 2, [[0, COL.chrome[0]], [0.25, COL.chrome[2]], [0.4, COL.chrome[3]], [0.75, COL.chrome[1]], [1, COL.chrome[0]]]);
    ctx.fillRect(nx - nw / 2, ny0, nw, ny1 - ny0);
    const [fx, fy, fs] = this.proj(0, DESK.y, z1);
    ctx.fillStyle = 'rgba(20,40,60,0.18)';
    ctx.beginPath(); ctx.ellipse(fx, fy + 1, 74 * fs, 9 * fs, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = vgrad(ctx, fy - 8 * fs, fy + 3 * fs, [[0, '#ffffff'], [0.5, '#cfe6ee'], [1, '#7f9cb0']]);
    ctx.beginPath(); ctx.ellipse(fx, fy - 2 * fs, 64 * fs, 8 * fs, 0, 0, TAU); ctx.fill();
    const c = this.cam;
    ctx.fillStyle = '#1a222c';
    if (c.x < bx0) { this.quad(ctx, [[bx0, by0, z0], [bx0, by0, z1], [bx0, by1, z1], [bx0, by1, z0]]); ctx.fill(); }
    if (c.x > bx1) { this.quad(ctx, [[bx1, by0, z0], [bx1, by0, z1], [bx1, by1, z1], [bx1, by1, z0]]); ctx.fill(); }
    if (c.y < by0) { ctx.fillStyle = '#2c3846'; this.quad(ctx, [[bx0, by0, z0], [bx1, by0, z0], [bx1, by0, z1], [bx0, by0, z1]]); ctx.fill(); }
    const [x0, y0, s] = this.proj(bx0, by0, z0), [x1, y1] = this.proj(bx1, by1, z0);
    const R = 7 * s;
    ctx.fillStyle = vgrad(ctx, y0, y1, [[0, COL.bezel[0]], [0.12, COL.bezel[1]], [0.75, COL.bezel[2]], [1, COL.bezel[3]]]);
    rrect(ctx, x0, y0, x1 - x0, y1 - y0, R); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.lineWidth = Math.max(1, s * 0.8);
    rrect(ctx, x0 + 0.5, y0 + 0.5, x1 - x0 - 1, y1 - y0 - 1, R); ctx.stroke();
    const [qx0, qy0] = this.proj(-hw, MON.cy - hh, z0), [qx1, qy1] = this.proj(hw, MON.cy + hh, z0);
    const sw = qx1 - qx0, sh = qy1 - qy0;
    ctx.imageSmoothingEnabled = sw < this.W - 0.5;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.scr, qx0, qy0, sw, sh);
    ctx.imageSmoothingEnabled = false;
    const sheen = 1 - this.cam.a;
    if (sheen > 0.02) {
      ctx.save();
      ctx.beginPath(); ctx.rect(qx0, qy0, sw, sh); ctx.clip();
      ctx.fillStyle = rgba('#ffffff', 0.13 * sheen);
      ctx.beginPath(); ctx.moveTo(qx0, qy0); ctx.lineTo(qx0 + sw * 0.55, qy0); ctx.lineTo(qx0 + sw * 0.25, qy1); ctx.lineTo(qx0, qy1); ctx.fill();
      ctx.fillStyle = rgba('#ffffff', 0.06 * sheen);
      ctx.beginPath(); ctx.moveTo(qx0 + sw * 0.62, qy0); ctx.lineTo(qx0 + sw * 0.7, qy0); ctx.lineTo(qx0 + sw * 0.4, qy1); ctx.lineTo(qx0 + sw * 0.32, qy1); ctx.fill();
      ctx.restore();
      ctx.fillStyle = rgba('#ffffff', 0.1 * sheen);
      ctx.fillRect(x0 + R, y0 + s, x1 - x0 - R * 2, Math.max(1, (qy0 - y0) * 0.5));
    }
    const [lx, ly, ls] = this.proj(hw - 6, MON.cy + hh + MON.chin * 0.55, z0);
    drawAeroGlow(ctx, lx, ly, clamp(Math.round(7 * ls), 3, 40), '#5fe6ff', 0.7);
    ctx.fillStyle = '#d8fbff'; ctx.fillRect(Math.round(lx - ls), Math.round(ly - ls * 0.5), Math.max(1, Math.round(2 * ls)), Math.max(1, Math.round(ls)));
    void t;
  }

  // The goldfish jar: water body with gravel, Goldie, bubbles; glass rim, lip, highlights. Local units = world.
  drawJar(ctx, t) {
    const [sx, sy, s] = this.proj(JAR.x, DESK.y, JAR.z);
    const R = JAR.r, cy = -R + JAR.cut;
    if (sx - R * s > this.W || sx + R * s < 0 || JAR.z - this.cam.z < 6) return;
    ctx.save();
    ctx.translate(sx, sy);
    ctx.scale(s, s);
    ctx.fillStyle = 'rgba(20,60,80,0.2)';
    ctx.beginPath(); ctx.ellipse(4, 1, R * 0.72, 5, 0, 0, TAU); ctx.fill();
    const bowl = () => { ctx.beginPath(); ctx.arc(0, cy, R, 0, TAU); };
    bowl();
    ctx.fillStyle = 'rgba(210,245,255,0.22)'; ctx.fill();
    ctx.save();
    bowl(); ctx.clip();
    ctx.beginPath(); ctx.rect(-R, JAR.water, R * 2, -JAR.water + 2); ctx.clip();
    ctx.fillStyle = vgrad(ctx, JAR.water, 0, [[0, 'rgba(140,232,255,0.72)'], [0.6, 'rgba(60,190,236,0.78)'], [1, 'rgba(26,140,210,0.85)']]);
    ctx.fillRect(-R, JAR.water, R * 2, -JAR.water);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.18;
    const ct = caustics();
    ctx.drawImage(ct, -R + ((t * 6) % 24) - 24, JAR.water, ct.width * 0.9, ct.height * 0.9);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    const gv = this.A.gravel;
    if (gv) {
      const k = 1 / gv.res;
      ctx.imageSmoothingEnabled = s * k < 0.98;
      ctx.drawImage(gv.canvas, -gv.ox * k, -gv.oy * k + 1, gv.canvas.width * k, gv.canvas.height * k);
      ctx.imageSmoothingEnabled = false;
    }
    this.drawJarBubbles(ctx, s, false);
    const G = this.goldie;
    if (G) {
      const ds = 0.86 + G.d * 0.14;
      ctx.save();
      ctx.translate(G.x, G.y);
      ctx.scale(1 / s, 1 / s); // screen pixels from here
      if (G.d < 0) ctx.globalAlpha = 0.85;
      drawGoldie(ctx, 0, 0, { scale: 1.3 * ds * s, vs: this.goldieVs, facing: G.facing, blink: G.blink, mood: G.mood, t });
      ctx.restore();
    }
    this.drawJarBubbles(ctx, s, true);
    ctx.restore();
    const ws = Math.sqrt(R * R - (JAR.water - cy) ** 2);
    ctx.fillStyle = 'rgba(200,250,255,0.55)';
    ctx.beginPath(); ctx.ellipse(0, JAR.water, ws, 4.5, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.ellipse(0, JAR.water, ws, 4.5, 0, 0.1, Math.PI - 0.1); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.75)'; ctx.lineWidth = 1.6;
    bowl(); ctx.stroke();
    ctx.strokeStyle = 'rgba(120,210,230,0.5)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(0, cy, R - 2, 0.35, Math.PI - 0.35); ctx.stroke();
    const lipY = cy - Math.sqrt(R * R - 34 * 34);
    ctx.fillStyle = 'rgba(230,252,255,0.55)';
    ctx.beginPath(); ctx.ellipse(0, lipY, 36, 5, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.95)'; ctx.lineWidth = 1.8;
    ctx.beginPath(); ctx.ellipse(0, lipY, 36, 5, 0, 0, TAU); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.beginPath(); ctx.ellipse(-R * 0.48, cy - R * 0.3, R * 0.14, R * 0.36, 0.45, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.beginPath(); ctx.ellipse(-R * 0.36, cy - R * 0.58, R * 0.06, R * 0.1, 0.6, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(190,250,255,0.35)';
    ctx.beginPath(); ctx.ellipse(R * 0.45, cy + R * 0.5, R * 0.3, R * 0.12, -0.6, 0, TAU); ctx.fill();
    ctx.restore();
  }

  drawJarBubbles(ctx, s, front) {
    for (const p of this.p3) {
      if (p.kind !== 'jar' || (p.z < JAR.z) !== front) continue;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.scale(1 / s, 1 / s);
      drawAeroBubble(ctx, 0, 0, clamp(p.r * s * 0.8, 1.5, 24), 0.9);
      ctx.restore();
    }
  }

  draw3D(ctx, t) {
    for (const p of this.p3) {
      if (p.kind === 'dust') {
        const [x, y, s] = this.proj(p.x, p.y, p.z);
        if (x < 0 || y < 0 || x > this.W || y > this.H) continue;
        const a = Math.sin(Math.PI * clamp01(p.t / p.life)) * (0.4 + 0.6 * Math.max(0, Math.sin(t * 2 + p.ph)));
        if (a > 0.85 && s > 0.9) drawSparkle(ctx, x, y, 1, a * 0.8, '#fffbe0');
        else { ctx.fillStyle = rgba('#ffffff', a * 0.7); const q = Math.max(1, Math.round(p.r * s * 0.6)); ctx.fillRect(Math.round(x), Math.round(y), q, q); }
      } else if (p.kind === 'bokeh') {
        const [x, y, s] = this.proj(p.x, p.y, p.z);
        const a = Math.sin(Math.PI * clamp01(p.t / p.life)) * 0.32;
        const rr = Math.round(p.r * s * 0.5);
        if (rr < 2 || x < -rr || y < -rr || x > this.W + rr || y > this.H + rr) continue;
        drawAeroGlow(ctx, x, y, rr, p.c, a);
        ctx.strokeStyle = rgba('#ffffff', a * 0.5); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(x, y, rr * 0.8, 0, TAU); ctx.stroke();
      } else if (p.kind === 'fly') {
        if (p.z - this.cam.z < 6) continue;
        const [x, y, s] = this.proj(p.x, p.y, p.z);
        if (x < -40 || y < -40 || x > this.W + 40 || y > this.H + 40) continue;
        drawAeroBubble(ctx, x, y, clamp(p.r * s * 0.7, 1.5, 24), 1);
        if (Math.sin(t * 9 + p.r * 7) > 0.92) drawSparkle(ctx, x - p.r * s * 0.3, y - p.r * s * 0.3, 1, 0.9);
      }
    }
  }

  // The monitor's desktop: the classic hill wallpaper, glossy icons, a glass taskbar; then the flood.
  renderScreen(t) {
    const g = this.sg, { W, H } = this;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    if (this.land) g.drawImage(this.land, 0, 0); else { g.fillStyle = '#58aef0'; g.fillRect(0, 0, W, H); }
    const flooding = t > T.flood0;
    const wl = (x) => this.waterline(x, t);
    const tb = Math.round(26 * this.u);
    g.globalAlpha = 1 - inv(T.flood0, T.flood0 + 1.6, t) * 0.65;
    drawAeroSurface(g, 0, H - tb, W, tb, { tone: 'sky', r: 0, gloss: 0.55, glossH: Math.round(tb * 0.42), rim: 0.6, glow: 0.4 });
    drawGlossOrb(g, 18 * this.u, H - tb / 2, 10 * this.u, '#59d36a');
    for (let i = 0; i < 3; i++) drawAeroSurface(g, (40 + i * 30) * this.u, H - tb + 4, 24 * this.u, tb - 8, { tone: 'clear', r: 4, gloss: 0.6, glossH: 6, rim: 0.7, glow: 0.3 });
    g.globalAlpha = 1;
    for (const ic of this.icons) {
      const bob = ic.wet ? Math.sin(t * 1.6 + ic.ph) * 3 * ic.wet : 0;
      const spr = this.iconSprite(ic.id);
      if (spr) g.drawImage(spr.canvas, Math.round(ic.x * this.u - spr.cx), Math.round((ic.y - ic.lift) * this.u + bob - spr.by));
    }
    if (flooding) {
      g.save();
      g.beginPath();
      g.moveTo(0, H);
      for (let x = 0; x <= W; x += 6) g.lineTo(x, wl(x));
      g.lineTo(W, H);
      g.closePath();
      g.clip();
      const top = wl(W / 2);
      g.fillStyle = vgrad(g, top - 10, H, [[0, 'rgba(80,215,255,0.4)'], [0.5, 'rgba(30,165,235,0.46)'], [1, 'rgba(10,95,190,0.58)']]);
      g.fillRect(0, 0, W, H);
      const ct = caustics();
      g.globalCompositeOperation = 'lighter';
      g.imageSmoothingEnabled = true;
      const tw = Math.round(ct.width * 3.2 * this.u);
      const ox = (t * 14) % tw, oy = (t * 6) % tw;
      for (let y = -tw + oy; y < H; y += tw) {
        g.globalAlpha = 0.11 * (1 - clamp01((y + tw * 0.5 - top) / (H * 0.9))) + 0.02;
        for (let x = -tw + ox; x < W; x += tw) g.drawImage(ct, Math.round(x), Math.round(y), tw, tw);
      }
      g.imageSmoothingEnabled = false;
      g.globalAlpha = 1;
      for (let i = 0; i < 6; i++) {
        const x = ((i * 0.19 + 0.07) * W + Math.sin(t * 0.4 + i * 2) * 30) % W;
        const w = (30 + (i % 3) * 22) * this.u;
        const gr = g.createLinearGradient(0, top, 0, H * 0.9);
        gr.addColorStop(0, 'rgba(255,255,255,0.16)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = gr;
        g.beginPath(); g.moveTo(x, top); g.lineTo(x + w, top); g.lineTo(x + w + 120 * this.u, H); g.lineTo(x + 60 * this.u, H); g.closePath(); g.fill();
      }
      g.globalCompositeOperation = 'source-over';
      g.restore();
      for (let x = 0; x < W; x += 2) {
        const y = Math.round(wl(x));
        const glint = Math.sin(x * 0.21 + t * 3) + Math.sin(x * 0.057 - t * 1.7) > 1.1;
        g.fillStyle = glint ? '#ffffff' : 'rgba(255,255,255,0.8)';
        g.fillRect(x, y - 1, 2, glint ? 2 : 1);
        g.fillStyle = 'rgba(140,235,255,0.7)';
        g.fillRect(x, y + 1, 2, 2);
      }
    }
    this.sp.draw(g, 'fg', t);
  }

  iconSprite(id) {
    this.iconCache ||= {};
    if (id in this.iconCache) return this.iconCache[id];
    let s = null;
    try { s = typeof BIG.getBigIcon === 'function' ? BIG.getBigIcon(id, { size: 'big' }) : null; } catch (e) { s = null; }
    this.iconCache[id] = s && s.canvas ? s : null;
    return this.iconCache[id];
  }

  drawGather(ctx, t) {
    if (!this.gather.length) return;
    const [x, y] = this.charPos(t);
    const fade = t > T.pop ? 1 - clamp01((t - T.pop) / 0.35) : 1;
    for (const b of this.gather) {
      if (fade <= 0) break;
      const k = clamp01((t - T.swirl - b.delay) / 0.4);
      drawAeroBubble(ctx, b.x, b.y, b.r * this.u * (t > T.gather ? 0.8 : 1), k * fade);
    }
    const g = inv(T.swirl + 0.6, T.pop, t);
    if (g > 0 && t < T.pop + 0.3) drawAeroGlow(ctx, x, y - 45 * this.charScale(), Math.round(70 * this.u), '#dff8ff', 0.45 * g * (t > T.pop ? 1 - (t - T.pop) / 0.3 : 1));
  }

  // The bubble person: pops out of the gathered bubbles, rises through the surface and lands on the hill.
  drawHero(ctx, t, pan) {
    let [x, y] = this.charPos(t);
    if (t > T.out0) y += (pan - 1) * this.H; // ride the dive with the scene
    const k = ease.outBack(clamp01((t - T.pop + 0.15) / 0.5));
    const alpha = clamp01((t - T.pop + 0.15) / 0.3);
    const rising = t > T.rise0 && t < T.rise1 + 0.2;
    const pose = rising ? 'cheer' : t < T.pop + 2.6 || (t > T.logo && t < T.logo + 2.5) ? 'wave' : 'idle';
    ctx.save();
    ctx.globalAlpha *= alpha;
    drawAeroGlow(ctx, x, y - 42 * this.charScale(), Math.round(60 * this.u), '#bff0ff', t < T.rise0 ? 0.35 : 0.2);
    ctx.translate(x, y);
    ctx.scale(k, k);
    try {
      if (typeof CHAR.drawCharacter === 'function') CHAR.drawCharacter(ctx, 0, 0, { pose, t: t - T.pop, facing: 1, scale: this.charScale(), look: this.look, lookAt: [this.W / 2, this.H * 0.3], id: 'intro', shadow: t > T.rise1 });
    } catch (e) { /* the character module is optional here */ }
    ctx.restore();
    if (t < T.rise1 && Math.random() < 0.08) this.fx.aeroBubbles(x + this.rng.float(-14, 14), y - 60 * this.charScale(), 1, { sizes: [2, 2, 3], speed: [20, 50] });
    if (rising && Math.random() < 0.5) this.fx.aeroBubbles(x, y - 20 * this.charScale(), 1, { sizes: [2, 3, 4], speed: [10, 40], layer: 'fg' });
  }

  // The 2000s eco wallpaper (offset dy while panning): sky, arcs, hill, city bubble, globe, leaves, water.
  drawEco(ctx, t, dy) {
    const { W, H } = this;
    if (!this.eco) return;
    ctx.drawImage(this.ecoSky, 0, dy);
    const [sx, sy0] = this.ecoSun();
    const sy = sy0 + dy;
    // rotating sun rays
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.translate(sx, sy);
    ctx.rotate(t * 0.05);
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * TAU, w = 0.035 + (i % 3) * 0.02, L = H * (0.8 + (i % 4) * 0.25);
      const gr = ctx.createLinearGradient(0, 0, Math.cos(a) * L, Math.sin(a) * L);
      gr.addColorStop(0, 'rgba(255,255,240,0.16)'); gr.addColorStop(0.5, 'rgba(255,255,240,0.05)'); gr.addColorStop(1, 'rgba(255,255,240,0)');
      ctx.fillStyle = gr;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a - w) * L, Math.sin(a - w) * L); ctx.lineTo(Math.cos(a + w) * L, Math.sin(a + w) * L); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
    drawAeroGlow(ctx, sx, sy, Math.round(H * 0.22), '#ffffff', 0.7);
    drawAeroGlow(ctx, sx, sy, Math.round(H * 0.06), '#ffffff', 1);
    ctx.drawImage(this.eco, 0, dy);
    // the green glass globe (upper right) with its grid and gloss
    const gl = this.A.globe;
    if (gl) {
      const gx = W * 0.82, gy = H * 0.4 + dy + Math.sin(t * 0.8) * 3 * this.u;
      const R = 30 * gl.scale;
      const [pcx, pcy] = gl.r.project(31.5, 31.5, 31.5);
      drawAeroGlow(ctx, gx, gy, Math.round(R * 1.35), '#b8ff8a', 0.35);
      ctx.drawImage(gl.canvas, Math.round(gx - pcx), Math.round(gy - pcy));
      ctx.save();
      ctx.beginPath(); ctx.arc(gx, gy, R, 0, TAU); ctx.clip();
      ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1;
      for (let i = 1; i < 6; i++) { ctx.beginPath(); ctx.ellipse(gx, gy, R, R * Math.abs(Math.cos((i / 6) * Math.PI)), 0, 0, TAU); ctx.stroke(); }
      const sp = (t * 0.25) % 1;
      for (let i = 0; i < 6; i++) { const ph = ((i / 6 + sp) % 1) * Math.PI; ctx.beginPath(); ctx.ellipse(gx, gy, R * Math.abs(Math.cos(ph)), R, 0, 0, TAU); ctx.stroke(); }
      const hg = ctx.createRadialGradient(gx - R * 0.35, gy - R * 0.45, 0, gx - R * 0.35, gy - R * 0.45, R * 0.9);
      hg.addColorStop(0, 'rgba(255,255,255,0.85)'); hg.addColorStop(0.35, 'rgba(255,255,255,0.25)'); hg.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = hg; ctx.fillRect(gx - R, gy - R, R * 2, R * 2);
      ctx.restore();
      ctx.strokeStyle = 'rgba(220,255,200,0.9)'; ctx.lineWidth = 1.5 * this.u;
      ctx.beginPath(); ctx.arc(gx, gy, R, 0.2, 1.4); ctx.stroke();
      // water spilling off the globe
      if (Math.random() < 0.3) this.fx.droplets?.(gx + R * 0.6, gy + R * 0.7, 2, { colors: ['#e8fbff', '#bff0ff'] });
    }
    // sneaker fish hopping across the hill (meme gag)
    this.drawSneaker(ctx, t, dy);
    // water along the bottom with a glossy crest
    const wy = H * 0.9 + dy;
    ctx.fillStyle = vgrad(ctx, wy - 6, H + dy, [[0, 'rgba(170,240,255,0.85)'], [0.3, 'rgba(60,190,240,0.85)'], [1, 'rgba(20,120,210,0.95)']]);
    ctx.beginPath(); ctx.moveTo(0, H + dy);
    for (let x = 0; x <= W; x += 6) ctx.lineTo(x, wy + Math.sin(x * 0.02 + t * 2) * 4 * this.u + Math.sin(x * 0.007 - t) * 7 * this.u);
    ctx.lineTo(W, H + dy); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.95)'; ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let x = 0; x <= W; x += 6) { const y = wy + Math.sin(x * 0.02 + t * 2) * 4 * this.u + Math.sin(x * 0.007 - t) * 7 * this.u; if (x) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
    ctx.stroke();
    // glossy leaves framing the shot (sway)
    const br = this.A.branch, b2 = this.A.branch2;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    if (br) {
      const w = br.canvas.width / br.ss, h = br.canvas.height / br.ss;
      ctx.save();
      ctx.translate(W + 4, H * 0.98 + dy);
      ctx.rotate(Math.sin(t * 0.9) * 0.025 - 0.08);
      ctx.drawImage(br.canvas, -w * 0.98, -h * 0.92, w, h);
      ctx.restore();
    }
    if (b2) {
      const w = b2.canvas.width / b2.ss, h = b2.canvas.height / b2.ss;
      ctx.save();
      ctx.translate(-6, -4 + dy);
      ctx.rotate(Math.PI + Math.sin(t * 1.1 + 1) * 0.03 + 0.12);
      ctx.drawImage(b2.canvas, -w * 0.98, -h * 0.85, w, h);
      ctx.restore();
    }
    ctx.imageSmoothingEnabled = false;
    // the big lens flare
    const fv = inv(T.rise1 - 0.4, T.rise1 + 0.6, t) * (0.85 + 0.15 * Math.sin(t * 1.7));
    if (fv > 0.01) this.flare(ctx, sx, sy, fv, 1.6);
  }

  drawSneaker(ctx, t, dy) {
    const s = this.A.sneaker;
    if (!s || t < T.sneak) return;
    const { W } = this;
    const D = this.ecoDome;
    const k = (t - T.sneak) / 4.6;
    if (k > 1) return;
    const x = lerp(-s.canvas.width * 0.6, W + s.canvas.width * 0.6, k);
    const hopT = (t - T.sneak) * 2.6;
    const hop = Math.abs(Math.sin(hopT * Math.PI)) * 14 * this.u;
    const sq = 1 + Math.max(0, 0.12 - Math.abs(Math.sin(hopT * Math.PI)) * 0.4);
    const y = D.y(x) + 70 * this.u + dy;
    ctx.fillStyle = 'rgba(20,60,20,0.25)';
    ctx.beginPath(); ctx.ellipse(x, y, s.canvas.width * 0.3 * (1 - hop / (40 * this.u)), 3 * this.u, 0, 0, TAU); ctx.fill();
    ctx.save();
    ctx.translate(x, y - hop);
    ctx.scale(1 / sq, sq);
    ctx.drawImage(s.canvas, -s.ox, -s.oy);
    ctx.restore();
    if (k < 0.95 && Math.abs(Math.sin(hopT * Math.PI)) < 0.08 && this.rng.chance(0.5)) this.fx.leaves?.(x, y, 2, { speed: [20, 60], life: 1.2, g: 120 });
  }

  // Crossing the water surface while panning: a bright glossy band, foam and bubbles.
  drawSurfaceSeam(ctx, t, y) {
    const { W } = this;
    const gr = ctx.createLinearGradient(0, y - 18 * this.u, 0, y + 18 * this.u);
    gr.addColorStop(0, 'rgba(200,250,255,0)'); gr.addColorStop(0.45, 'rgba(230,252,255,0.85)'); gr.addColorStop(0.55, 'rgba(255,255,255,0.95)'); gr.addColorStop(1, 'rgba(120,220,255,0)');
    ctx.fillStyle = gr;
    ctx.fillRect(0, y - 18 * this.u, W, 36 * this.u);
    for (let i = 0; i < 4; i++) { const x = this.rng.float(0, W); drawAeroBubble(ctx, x, y + this.rng.float(-6, 10), this.rng.pick([2, 3, 4]), 0.9); }
    void t;
  }

  drawLogo(ctx, t, dy) {
    const L = this.A.logo;
    if (!L) return;
    const { W, H } = this;
    const k = clamp01((t - T.logo) / 0.7);
    const sc = 0.55 + 0.45 * ease.outBack(k, 2.2);
    const cx = W / 2, cy = H * 0.2 + Math.sin(t * 1.4) * 2 + dy;
    const a = clamp01(k * 2);
    if (a <= 0) return;
    ctx.save();
    ctx.globalAlpha = a;
    // bloom
    ctx.globalCompositeOperation = 'lighter';
    drawAeroGlow(ctx, cx, cy, Math.round(L.w * 0.45 * sc), '#cfefff', 0.5);
    ctx.globalCompositeOperation = 'source-over';
    drawAeroGlow(ctx, cx, cy, Math.round(L.w * 0.32 * sc), '#ffffff', 0.4);
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

  drawSkip(ctx, alpha) {
    if (this.t < 0.3 && this.skipT < 0) return;
    const r = this.skipRect();
    ctx.globalAlpha = alpha * clamp01((this.t - 0.3) * 3);
    drawAeroButton(ctx, r.x, r.y, r.w, r.h, { label: 'Skip', icon: getUiIcon('play'), tone: 'glass', state: this.skipHover ? 'hover' : 'normal' });
    if (this.audio?.isUnlocked && !this.audio.isUnlocked()) {
      const ic = getUiIcon('sound'), ml = getUiIcon('mouse_l');
      if (ic && ml) {
        const w = ic.width + ml.width + 16, h = 18, x = this.W - w - 10, y = this.H - h - 10;
        drawAeroSurface(ctx, x, y, w, h, { tone: 'glass', r: 'pill', gloss: 0.6, glossH: 8, rim: 0.8, glow: 0.4 });
        ctx.drawImage(ml, x + 6, y + Math.round((h - ml.height) / 2));
        ctx.drawImage(ic, x + 10 + ml.width, y + Math.round((h - ic.height) / 2));
      }
    }
    ctx.globalAlpha = 1;
  }
}
