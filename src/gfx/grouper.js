// Bubbles, the guide [grouper23]: a chunky wind-up TALKING TOY GROUPER that floats about, in high-resolution VOXEL art
// with a black ink outline. An original design: a big-headed, big-lipped grouper made of glossy painted plastic
// (mottled olive / brown / gold grouper paint with dark saddles and spots, gold-rimmed fins, a spiny dorsal fin, a
// round tail), with toy details: the head is a separate moulded piece that turns on a seam along the gill cover, a
// little speaker grille on its cheek, a battery hatch with a silver screw on its belly and a brass wind-up key on its
// side that turns while it moves. Its lower jaw is a real HINGE: it flaps open and shut in sync with dialogue (the
// talk value picks one of a few baked jaw positions), showing a dark mouth, a pink tongue and two little toy teeth.
// The bulging white eye domes are voxels; the pupils (which swivel, glance, roll and pop), the eyelids, the thick
// painted eyebrows, tears, a sweat drop and blush are drawn live on top AT VOXEL RESOLUTION, so blinking, gaze and
// expressions cost nothing.
//
// Each pose is a smooth painted mesh, VOXELISED (src/fish/voxelize.js) and rendered with glossy plastic shading; every
// animation cycle is rendered once per size / view / jaw level into one sprite sheet (lowpoly renderSheet) with a
// baked ink outline, at most one new sheet per frame (otherwise the nearest cached sheet stands in).
//
//   GROUPER_INFO                       {id: 'seal' (the NPC id stays 'seal'), name: 'Bubbles', role, desc, color, h}
//   GROUPER_ANIMS                      idle swim wiggle wave point flop spin worried clap think blow cheer sad sleep
//                                      surprised (puffs up) scared look (goofy head-turn to the camera) laugh
//   GROUPER_ALIAS                      other pose / mood names -> animations (talk, celebrate, love, cry, ...)
//   drawGrouper(ctx, o) -> anchors     o: {x, y (body centre; o.base = 'bottom' -> y is the bottom: it hovers a little
//       above it), t, size (px per model unit, bucketed), k (extra draw scale), facing (1 right / -1 left), anim,
//       phase (0..1 override), point: [sx, sy] (the pectoral fin points there), tilt (rad), mood, talk 0..1 (jaw),
//       lookAt [sx, sy], blink, ride 0..1 (a trickle of bubbles under it), noseBubble 0..1 (a bubble on its lips),
//       hover (false = no built-in float bob), view: 'side' | 'front' (portrait), id (blink / gaze state), alpha}
//     anchors: {head, top, mouth, nose, hand (pointing fin tip), tail, bottom, center, rect {x, y, w, h}} (screen)
//   warmGrouper(size, anims, view)     pre-render sheets (call from a loading step)
//   grouperReady(size, view)           the idle sheet exists
//   new GrouperGuide({x, y, size, audio, id})  a screen-space floater with smooth physics:
//       .goTo(x, y, {snap}) .pointAt([sx, sy] | null) .emote(anim, secs) .update(dt, {W, H, cursor, talk})
//       .draw(ctx, {t, talk, mood, lookAt, alpha}) -> anchors .rect() .hit(x, y) .settled .speed .anim
//       swims with tail beats, tilts with its heading, faces its target, points when it arrives, shies away from
//       the cursor, trails bubbles, blows bubbles, puffs up when surprised and now and then turns its head to stare
//       at you.
// src/gfx/seal.js re-exports all of this under the old seal names (drawSeal, SealGuide, SEAL_ANIMS ...).

import { LPMesh, renderSheet, lpProject, lpAvailable, T4 } from './lowpoly.js';
import { voxelizeMesh } from '../fish/voxelize.js';
import { clamp, clamp01, lerp, TAU } from '../core/math.js';
import { drawAeroBubble } from '../ui/aero.js';

export const GROUPER_INFO = {
  id: 'seal', name: 'Bubbles', role: 'Guide', color: '#ffc45a', h: 56,
  desc: 'A chunky wind-up talking toy grouper. Floats, flaps its jaw at everyone and blows bubbles. Batteries not included.',
};

// ------------------------------------------------------------------------------------------------ small math
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scl = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const rx = (p, a) => { const c = Math.cos(a), s = Math.sin(a); return [p[0], p[1] * c - p[2] * s, p[1] * s + p[2] * c]; };
const ry = (p, a) => { const c = Math.cos(a), s = Math.sin(a); return [p[0] * c + p[2] * s, p[1], -p[0] * s + p[2] * c]; };
const rz = (p, a) => { const c = Math.cos(a), s = Math.sin(a); return [p[0] * c - p[1] * s, p[0] * s + p[1] * c, p[2]]; };
const h3 = (x, y, z) => { const n = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return n - Math.floor(n); };
const rgb = (hex) => { const n = parseInt(hex.slice(1), 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; };
const mixC = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
const lit = (c, k) => [clamp01(c[0] * k), clamp01(c[1] * k), clamp01(c[2] * k)];
const sm = (t) => { t = clamp01(t); return t * t * (3 - 2 * t); };

// ------------------------------------------------------------------------------------------------ palette
// glossy painted toy plastic: olive back, golden-brown flanks, a pale gold belly, dark chocolate saddles and spots,
// gold freckles on the head, gold-rimmed fins, coral lips, white eye domes, brass key, silver screw
const C = {
  back: rgb('#665022'), side: rgb('#bb8a3a'), belly: rgb('#f6e0a0'), blotch: rgb('#48301a'), spot: rgb('#2c1d0c'),
  gold: rgb('#ffcf4a'), seam: rgb('#2a1c0c'), fin: rgb('#6d5524'), finD: rgb('#4a3816'), finEdge: rgb('#ffc94a'),
  lip: rgb('#f08a68'), lipHi: rgb('#ffb795'), lipD: rgb('#c8604a'), mouth: rgb('#5a1220'), mouthD: rgb('#3a0a14'),
  tongue: rgb('#ef6e86'), tooth: rgb('#fffdf4'), eye: rgb('#fdfbf3'), eyeD: rgb('#e6e0cf'), socket: rgb('#3a2810'),
  brass: rgb('#b9c4d4'), brassD: rgb('#6f7a8c'), brassHi: rgb('#eef4ff'), screw: rgb('#d6dbe4'), screwD: rgb('#5a606c'),
  hatch: rgb('#7a5a26'), grille: rgb('#1c1206'),
};
const LID = '#7c5e2a', LID_D = '#2a1c0c', BROW = '#2a1a0a';
// the look (lowpoly shader options): glossy painted plastic with a warm rim
const LOOK = { ambient: 0.68, spec: 0.55, shine: 30, soft: 0.35, softColor: '#ffe2b0', rim: 0.32, rimColor: '#fff0c4', env: 0.16, iri: 0.02, sky: '#fffbf0', ground: '#a9c6dc', light: [-0.42, 0.72, 0.75] };
// voxel edge in model units (~56 voxels from the lips to the tail tip)
export const GROUPER_VOXEL = 0.043;

// ------------------------------------------------------------------------------------------------ geometry
// Model space: x forward (the lips), y up, z toward the near (+z) side. The body is lofted from a profile table
// (top line, bottom line, half width); the lower jaw is its own loft hinged under the cheek.
const BODY = [
  [-0.88, 0.50, 0.28, 0.06],
  [-0.72, 0.59, 0.19, 0.13],
  [-0.48, 0.76, 0.06, 0.24],
  [-0.18, 0.91, -0.03, 0.33],
  [0.12, 0.99, -0.06, 0.37],
  [0.38, 0.99, -0.04, 0.37],
  [0.58, 0.91, 0.09, 0.33],
  [0.74, 0.78, 0.26, 0.27],
  [0.88, 0.63, 0.32, 0.2],
  [0.97, 0.5, 0.345, 0.13],
  [1.01, 0.43, 0.355, 0.06],
];
const JAW = [
  [0.38, 0.26, -0.03, 0.33],
  [0.54, 0.275, -0.01, 0.32],
  [0.7, 0.295, 0.06, 0.29],
  [0.85, 0.315, 0.14, 0.24],
  [0.98, 0.33, 0.21, 0.17],
  [1.06, 0.34, 0.27, 0.1],
  [1.09, 0.345, 0.31, 0.04],
];
function cr(tab, x, col) {
  const n = tab.length;
  if (x <= tab[0][0]) return tab[0][col];
  if (x >= tab[n - 1][0]) return tab[n - 1][col];
  let i = 0;
  while (i < n - 2 && x > tab[i + 1][0]) i++;
  const p0 = tab[Math.max(0, i - 1)], p1 = tab[i], p2 = tab[i + 1], p3 = tab[Math.min(n - 1, i + 2)];
  const t = (x - p1[0]) / (p2[0] - p1[0]);
  const a = p0[col], b = p1[col], c = p2[col], d = p3[col];
  return 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t);
}
const X0 = -0.88, X1 = 1.01, BODY_SEG = 28, BODY_ROWS = 32;
const HINGE = [0.46, 0.255, 0];          // the jaw hinge
const HP = [0.3, 0.46, 0];               // the head joint pivot (head turns on the gill seam)
const PIV = [-0.05, -0.06, 0];           // squash pivot (bottom)
const MID_Y = 0.46;                      // body roll axis height
const EYE = [0.55, 0.85, 0.215], EYE_R = 0.158;
const EYE_N = norm([0.28, 0.5, 0.82]);
const TAIL0 = [-0.86, 0.39, 0];
const C0 = [-0.14, 0.47, 0];             // sprite centre (model point at the sheet cell centre)
const CELL_W = 3.25, CELL_H = 2.7;      // cell size in model units
const YAW0 = -0.56, TILT0 = 0.2, YAW_FRONT = -1.02, TILT_FRONT = 0.13;
const seamX = (yn) => 0.33 - 0.08 * Math.sin(clamp01(yn) * Math.PI);
const mouthY = (x) => 0.3 + (x - 0.66) * 0.14;

function bodyAt(x) { return [cr(BODY, x, 1), cr(BODY, x, 2), cr(BODY, x, 3)]; }
function sectPt(top, bot, hz, x, a, flatTop = false) {
  const cy = (top + bot) / 2, hy = (top - bot) / 2;
  const c = Math.cos(a), s = Math.sin(a);
  const ey = c >= 0 ? (flatTop ? 0.3 : 0.85) : 0.72;
  return [x, cy + Math.sign(c) * Math.pow(Math.abs(c), ey) * hy, Math.sign(s) * Math.pow(Math.abs(s), 0.8) * hz];
}
function bodyPt(x, a) { const [t, b, z] = bodyAt(x); return sectPt(t, b, z, x, a); }
function jawPt(x, a) { return sectPt(cr(JAW, x, 1), cr(JAW, x, 2), cr(JAW, x, 3), x, a, true); }
function bodyN(x, a) {
  const e = 0.01;
  const p0 = bodyPt(x, a), px = bodyPt(x + e, a), pa = bodyPt(x, a + e);
  let n = norm(cross(sub(px, p0), sub(pa, p0)));
  const [t, b] = bodyAt(x);
  if (dot(n, sub(p0, [x, (t + b) / 2, 0])) < 0) n = scl(n, -1);
  return n;
}

// A tiny builder with PER-VERTEX colours, producing the shared renderer's LPMesh (11 floats per vertex).
class PaintMesh {
  constructor() { this.buf = new Float32Array(33 * 2400); this.n = 0; }
  push(v) {
    if (this.n + 11 > this.buf.length) { const nb = new Float32Array(this.buf.length * 2); nb.set(this.buf); this.buf = nb; }
    this.buf.set(v, this.n); this.n += 11;
  }
  build() {
    const data = this.buf.slice(0, this.n);
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < data.length; i += 11) for (let k = 0; k < 3; k++) { const q = data[i + k]; if (q < min[k]) min[k] = q; if (q > max[k]) max[k] = q; }
    const center = [0, 1, 2].map((k) => (min[k] + max[k]) / 2);
    const radius = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2 || 1;
    return new LPMesh(data, data.length / 11, { min, max, center, radius });
  }
}
function triV(mb, a, b, c, ca, cb, cc) {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const l = Math.hypot(nx, ny, nz);
  if (l < 1e-10) return;
  nx /= l; ny /= l; nz /= l;
  mb.push([a[0], a[1], a[2], nx, ny, nz, ca[0], ca[1], ca[2], 0, 0]);
  mb.push([b[0], b[1], b[2], nx, ny, nz, cb[0], cb[1], cb[2], 0, 0]);
  mb.push([c[0], c[1], c[2], nx, ny, nz, cc[0], cc[1], cc[2], 0, 0]);
}
// grid of rest points -> painted + deformed quads (rows i; columns wrap unless open)
function sheetMesh(mb, rows, paint, deform, open = false) {
  const col = rows.map((r) => r.map(paint));
  const pos = rows.map((r) => r.map(deform));
  for (let i = 0; i < rows.length - 1; i++) {
    const n = rows[i].length;
    for (let j = 0; j < (open ? n - 1 : n); j++) {
      const j2 = (j + 1) % n;
      triV(mb, pos[i][j], pos[i][j2], pos[i + 1][j2], col[i][j], col[i][j2], col[i + 1][j2]);
      triV(mb, pos[i][j], pos[i + 1][j2], pos[i + 1][j], col[i][j], col[i + 1][j2], col[i + 1][j]);
    }
  }
}
function capFan(mb, ring, c, paint, deform, flip) {
  const pc = deform(c), cc = paint(c);
  const P = ring.map(deform), K = ring.map(paint);
  for (let j = 0; j < ring.length; j++) {
    const j2 = (j + 1) % ring.length;
    if (flip) triV(mb, pc, P[j], P[j2], cc, K[j], K[j2]);
    else triV(mb, pc, P[j2], P[j], cc, K[j2], K[j]);
  }
}
function ellRows(c, r, seg, rings, basis = null) {
  const rows = [];
  for (let i = 0; i <= rings; i++) {
    const th = (i / rings) * Math.PI, row = [];
    for (let j = 0; j < seg; j++) {
      const ph = (j / seg) * TAU;
      const l = [Math.sin(th) * Math.cos(ph) * r[0], Math.cos(th) * r[1], Math.sin(th) * Math.sin(ph) * r[2]];
      row.push(basis ? add(c, add(add(scl(basis[0], l[0]), scl(basis[1], l[1])), scl(basis[2], l[2]))) : add(c, l));
    }
    rows.push(row);
  }
  return rows;
}
function ellipsoid(mb, c, r, paint, def, seg = 10, rings = 7, basis = null) {
  sheetMesh(mb, ellRows(c, r, seg, rings, basis), paint, def);
}
// tube rows along a polyline (closed: a ring); r may be a function of t (0..1)
function tubeRows(pts, r, M = 6, closed = false) {
  const n = pts.length, rows = [];
  for (let i = 0; i < n; i++) {
    const a = closed ? pts[(i - 1 + n) % n] : pts[Math.max(0, i - 1)], b = closed ? pts[(i + 1) % n] : pts[Math.min(n - 1, i + 1)];
    const T = norm(sub(b, a));
    const b1 = norm(cross(T, Math.abs(T[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0]));
    const b2 = cross(T, b1), row = [];
    const rr = typeof r === 'function' ? r(i / Math.max(1, n - 1)) : r;
    for (let j = 0; j < M; j++) { const f = (j / M) * TAU; row.push(add(pts[i], add(scl(b1, Math.cos(f) * rr), scl(b2, Math.sin(f) * rr)))); }
    rows.push(row);
  }
  if (closed) rows.push(rows[0]);
  return rows;
}
// a flattened paddle (fan) of length L from base along D (broad face hint Thint), posed space
function paddle(mb, base, D, Thint, L, widths, thick, paint, twist = 0) {
  D = norm(D);
  let Wd = cross(D, norm(Thint));
  if (Math.hypot(Wd[0], Wd[1], Wd[2]) < 1e-3) Wd = cross(D, [0, 1, 0.01]);
  Wd = norm(Wd);
  let T = cross(Wd, D);
  if (twist) { const c = Math.cos(twist), s = Math.sin(twist); const W2 = add(scl(Wd, c), scl(T, s)); T = sub(scl(T, c), scl(Wd, s)); Wd = W2; }
  const seg = 8, n = widths.length, rows = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1), row = [];
    for (let j = 0; j < seg; j++) { const a = (j / seg) * TAU; row.push([t * L, Math.cos(a) * thick[i], Math.sin(a) * widths[i]]); }
    rows.push(row);
  }
  const place = (q) => add(base, add(add(scl(D, q[0]), scl(T, q[1])), scl(Wd, q[2])));
  const pnt = (q) => paint(q, L);
  sheetMesh(mb, rows, pnt, place);
  capFan(mb, rows[0], [-0.02, 0, 0], pnt, place, false);
  capFan(mb, rows[n - 1], [L + 0.02, 0, 0], pnt, place, true);
  return place([L + 0.02, 0, 0]);
}

// ---- paint (rest positions -> colour)
function vnoise(x, y, z) {
  const X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z), fx = x - X, fy = y - Y, fz = z - Z;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz);
  const L = (a, b, k) => a + (b - a) * k;
  return L(L(L(h3(X, Y, Z), h3(X + 1, Y, Z), u), L(h3(X, Y + 1, Z), h3(X + 1, Y + 1, Z), u), v),
    L(L(h3(X, Y, Z + 1), h3(X + 1, Y, Z + 1), u), L(h3(X, Y + 1, Z + 1), h3(X + 1, Y + 1, Z + 1), u), v), w);
}
// distance (in spot radii) to the nearest jittered spot centre of a cell grid over (x, y); < 1 = inside a spot
function spotD(x, y, side, cell, r, seed) {
  const u = x / cell, v = y / cell, iu = Math.floor(u), iv = Math.floor(v);
  let best = 9;
  for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
    const cu = iu + a, cv = iv + b;
    const jx = h3(cu, cv, side + seed), jy = h3(cv + 7.1, cu - 3.3, side + seed + 2);
    const dx = (cu + 0.15 + jx * 0.7 - u) * cell, dy = (cv + 0.15 + jy * 0.7 - v) * cell;
    const d = Math.hypot(dx, dy) / (r * (0.7 + 0.6 * h3(cu + 1.7, cv + 9.2, side + seed + 5)));
    if (d < best) best = d;
  }
  return best;
}
const GRILLE = [];
for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) GRILLE.push([i * 0.055, j * 0.055]);
const GRILLE_C = [0.64, 0.5], HATCH = { x: -0.5, y: 0.28, w: 0.12, h: 0.085 };
function paintBody(p) {
  const x = p[0], [top, bot] = bodyAt(x);
  const yn = clamp01((p[1] - bot) / Math.max(0.04, top - bot));
  const side = p[2] >= 0 ? 1 : -1;
  let c = yn > 0.55 ? mixC(C.side, C.back, sm((yn - 0.55) / 0.4)) : mixC(C.belly, C.side, sm((yn - 0.1) / 0.45));
  const sx = seamX(yn), head = x > sx;
  // big chocolate saddles in vertical bands on the body (not the head), fading out on the belly
  if (!head) {
    const n = vnoise(x * 4.2 + 1.3, p[1] * 3.1, p[2] * 2 + (side > 0 ? 0 : 5));
    const b = (0.5 + 0.5 * Math.sin(x * 8.2 + n * 2.4 + 1.2)) * 0.6 + n * 0.4;
    if (b > 0.62 && yn > 0.32) c = mixC(c, C.blotch, 0.55 + 0.3 * clamp01((b - 0.62) * 6));
  }
  // small dark spots everywhere above the belly, gold freckles on the head
  if (yn > 0.22 && spotD(x, p[1], side, head ? 0.1 : 0.125, 0.03, 0) < 1) c = mixC(c, C.spot, 0.85);
  else if (head && yn > 0.25 && spotD(x, p[1], side, 0.115, 0.026, 3) < 1) c = C.gold;
  // the toy's moulding seam along the gill cover (the head turns on it)
  if (Math.abs(x - sx) < 0.024 && yn > 0.06 && yn < 0.95) c = C.seam;
  if (side > 0 && p[2] > 0.08) {
    // the speaker grille on its cheek (its voice box!)
    const gd = Math.hypot(x - GRILLE_C[0], p[1] - GRILLE_C[1]);
    if (gd < 0.125) c = gd > 0.1 ? C.seam : C.belly;
    for (const [gx, gy] of GRILLE) if (Math.hypot(x - GRILLE_C[0] - gx, p[1] - GRILLE_C[1] - gy) < 0.027) c = C.grille;
    // the battery hatch on its lower flank
    const hx = Math.abs(x - HATCH.x), hy = Math.abs(p[1] - HATCH.y);
    if (hx < HATCH.w && hy < HATCH.h) c = hx > HATCH.w - 0.04 || hy > HATCH.h - 0.04 ? C.seam : C.hatch;
  }
  return lit(c, 1 + (h3(Math.round(x * 23), Math.round(p[1] * 23), Math.round(p[2] * 23)) - 0.5) * 0.05);
}
// the palate (under the upper head front): dark mouth inside
const paintPalate = (p) => (p[1] < mouthY(p[0]) + 0.035 && p[0] > 0.58 ? C.mouth : paintBody(p));
function paintJaw(p) {
  const top = cr(JAW, p[0], 1), bot = cr(JAW, p[0], 2);
  const yn = clamp01((p[1] - bot) / Math.max(0.03, top - bot));
  if (yn > 0.9 && Math.abs(p[2]) < cr(JAW, p[0], 3) * 0.82) return C.mouth; // the mouth floor
  let c = mixC(C.belly, C.side, sm((yn - 0.35) / 0.6) * 0.6);
  if (yn > 0.4 && spotD(p[0], p[1], p[2] >= 0 ? 1 : -1, 0.1, 0.026, 7) < 1) c = mixC(c, C.spot, 0.7);
  return lit(c, 1 + (h3(Math.round(p[0] * 23), Math.round(p[1] * 23), Math.round(p[2] * 23)) - 0.5) * 0.05);
}
const paintLipU = (p) => (p[1] > mouthY(p[0]) + 0.075 ? C.lipHi : p[1] < mouthY(p[0]) - 0.0 ? C.lipD : C.lip);
const paintLipL = (p) => (p[1] > mouthY(p[0]) + 0.02 ? C.lipHi : p[1] < mouthY(p[0]) - 0.07 ? C.lipD : C.lip);
function paintFin(q, L) {
  const t = clamp01(q[0] / L);
  let c = t > 0.8 ? C.finEdge : mixC(C.fin, C.finD, 0.3 * t);
  if (t < 0.8 && t > 0.15 && Math.abs(((q[2] * 26) % 1 + 1) % 1 - 0.5) < 0.14) c = C.finD; // rays
  if (t < 0.78 && t > 0.2 && h3(Math.round(q[0] * 18), Math.round(q[2] * 18), 3) > 0.84) c = C.spot;
  return c;
}
// membranes (dorsal, anal, tail): u along the fin (0 base .. 1 edge), ray = distance to the nearest ray (0..1)
function finCol(u, ray, spotty) {
  let c = u > 0.86 ? C.finEdge : mixC(C.fin, C.finD, ray < 0.25 ? 0.65 : 0.1);
  if (u < 0.82 && u > 0.12 && spotty) c = mixC(c, C.spot, 0.8);
  return c;
}

// ---- the pose
function P0() {
  return {
    yaw: YAW0, tilt: TILT0, rz: 0, sq: [1, 1, 1], puff: 0, bend: 0, wave: 0, wph: 0, side: 0, roll: 0,
    head: [0, 0, 0], jaw: 0.04, pucker: 0, cheek: 0,
    pn: [-0.78, -0.32, 0.55], pf: [-0.78, -0.32, -0.55], pnLen: 1, pfLen: 1, pnTw: 0, pfTw: 0,
    wag: 0, tailUp: 0, dors: 1, key: 0, dy: 0, eyePop: 0,
  };
}

// The deformation of a rest point: puff, jaw hinge, head joint, body bend / swim wave / roll, squash.
// part: 'body' (head weight from x), 'head' (fully on the head piece), 'jaw' (hinged, on the head piece)
function makeDef(P) {
  const [sx, sy, sz] = P.sq;
  const ja = P.jaw * 0.66;
  const [hyw, hpi, hro] = P.head;
  return (p, part = 'body') => {
    let q = p;
    if (P.puff) {
      const [t, b] = bodyAt(clamp(q[0], X0, X1));
      const cy = (t + b) / 2, k = P.puff * clamp01(1 - ((q[0] - 0.12) / 1.05) ** 2);
      q = [q[0] + P.puff * 0.03, cy + (q[1] - cy) * (1 + 0.3 * k), q[2] * (1 + 0.42 * k)];
    }
    if (part === 'jaw' && ja) q = add(HINGE, rz(sub(q, HINGE), -ja));
    const w = part === 'body' ? sm((q[0] - 0.2) / 0.2) : 1;
    if (w > 0 && (hyw || hpi || hro)) {
      let v = sub(q, HP);
      v = rx(v, hro * w); v = rz(v, hpi * w); v = ry(v, hyw * w);
      q = add(HP, v);
    }
    let x = q[0], y = q[1], z = q[2];
    const u = x - 0.1;
    y += P.bend * u * u * 0.55;
    if (P.wave) z += P.wave * Math.sin(P.wph - x * 3.4) * Math.pow(clamp01((0.45 - x) / 1.35), 1.15);
    if (P.side) z += P.side * Math.sign(u) * u * u * 0.6;
    if (P.roll) { const c = Math.cos(P.roll), s = Math.sin(P.roll), yy = y - MID_Y; y = MID_Y + yy * c - z * s; z = yy * s + z * c; }
    return [PIV[0] + (x - PIV[0]) * sx, PIV[1] + (y - PIV[1]) * sy, z * sz];
  };
}

// dorsal fin height profile: 7 spines (membrane dips between), then a rounded soft lobe
const SPINES = [0.27, 0.17, 0.07, -0.03, -0.13, -0.23];
function dorsalH(x) {
  if (x > SPINES[SPINES.length - 1] - 0.04) {
    let best = 9, bi = 0;
    SPINES.forEach((s, i) => { const d = Math.abs(x - s); if (d < best) { best = d; bi = i; } });
    const tip = bi === 0 ? 0.22 : 0.3 - bi * 0.008;
    const k = clamp01(best / 0.05);
    return { h: lerp(tip, 0.12, Math.pow(k, 0.55)), ray: k, spine: true };
  }
  const t = clamp01((x - -0.7) / (SPINES[SPINES.length - 1] - 0.04 - -0.7));
  return { h: 0.07 + 0.25 * Math.sin(Math.pow(t, 0.75) * Math.PI) ** 0.8, ray: Math.abs(((x * 22) % 1 + 1) % 1 - 0.5) * 2, spine: false };
}

// Build the toy grouper for pose P -> {mesh, A (posed model-space anchors)}
export const GSTAT = { mesh: 0, vox: 0, render: 0, outline: 0, frames: 0 };
function buildGrouper(P) {
  const tm0 = performance.now();
  GSTAT.frames++;
  const mb = new PaintMesh();
  const def = makeDef(P);
  const dB = (p) => def(p, 'body'), dH = (p) => def(p, 'head'), dJ = (p) => def(p, 'jaw');
  // ---- body + upper head (one loft, the palate on its front underside)
  const rows = [];
  for (let i = 0; i <= BODY_ROWS; i++) {
    const k = i / BODY_ROWS, x = X0 + (X1 - X0) * (0.5 - 0.5 * Math.cos(k * Math.PI));
    const row = [];
    for (let j = 0; j < BODY_SEG; j++) row.push(bodyPt(x, (j / BODY_SEG) * TAU));
    rows.push(row);
  }
  sheetMesh(mb, rows, paintPalate, dB);
  const [t0, b0] = bodyAt(X0), [t1, b1] = bodyAt(X1);
  capFan(mb, rows[0], [X0 - 0.005, (t0 + b0) / 2, 0], paintBody, dB, false);
  capFan(mb, rows[rows.length - 1], [X1 + 0.012, (t1 + b1) / 2, 0], paintBody, dB, true);
  // ---- inside the mouth: a dark throat (hidden while the jaw is shut)
  ellipsoid(mb, [0.66, 0.24, 0], [0.3, 0.1, 0.21], (q) => (q[1] < 0.2 ? C.mouthD : C.mouth), dH, 10, 6);
  // ---- the lower jaw (hinged): a scoop, a pink tongue, the big pouty lower lip
  const jr = [];
  for (let i = 0; i <= 12; i++) {
    const x = lerp(0.38, 1.09, Math.pow(i / 12, 0.85)), row = [];
    for (let j = 0; j < 20; j++) row.push(jawPt(x, (j / 20) * TAU));
    jr.push(row);
  }
  sheetMesh(mb, jr, paintJaw, dJ);
  capFan(mb, jr[0], [0.37, 0.12, 0], paintJaw, dJ, false);
  capFan(mb, jr[jr.length - 1], [1.1, 0.33, 0], paintJaw, dJ, true);
  ellipsoid(mb, [0.76, mouthY(0.76) - 0.005, 0], [0.2, 0.035, 0.12], () => C.tongue, dJ, 9, 5);
  const pk = P.pucker;
  const lipPath = (x0, ax, w0, y0, dx) => {
    const pts = [];
    for (let i = 0; i <= 16; i++) { const a = -Math.PI / 2 + (i / 16) * Math.PI; pts.push([x0 + ax * Math.cos(a) + dx * Math.cos(a) ** 4, y0(x0 + ax * Math.cos(a)), w0 * Math.sin(a) * (1 - 0.35 * pk)]); }
    return pts;
  };
  const lipR = (base, k0) => (t) => { const f = Math.sin(t * Math.PI); return k0 + (base - k0) * Math.pow(f, 0.7); };
  sheetMesh(mb, tubeRows(lipPath(0.68, 0.38, 0.235, (x) => mouthY(x) + 0.03, 0.06 * pk), lipR(0.072 + 0.02 * pk, 0.028), 7), paintLipU, dH);
  sheetMesh(mb, tubeRows(lipPath(0.68, 0.43, 0.26, (x) => mouthY(x) - 0.025, 0.07 * pk), lipR(0.088 + 0.02 * pk, 0.03), 7), paintLipL, dJ);
  // two little toy teeth under the upper lip
  for (const sd of [1, -1]) ellipsoid(mb, [0.96, mouthY(0.96) - 0.03, 0.062 * sd], [0.026, 0.04, 0.026], () => C.tooth, dH, 6, 4);
  // ---- big bulging toy eyes in dark sockets
  const eyeC = (sd) => [EYE[0], EYE[1], EYE[2] * sd];
  const eyeN = (sd) => [EYE_N[0], EYE_N[1], EYE_N[2] * sd];
  const er = EYE_R * (1 + 0.25 * P.eyePop);
  for (const sd of [1, -1]) {
    const c = add(eyeC(sd), scl(eyeN(sd), 0.03 * P.eyePop));
    ellipsoid(mb, c, [er, er, er], (q) => (dot(sub(q, c), eyeN(sd)) < -er * 0.2 ? C.eyeD : C.eye), dH, 12, 8);
    const n = eyeN(sd), u = norm(cross(n, [0, 1, 0])), v = norm(cross(u, n));
    const ring = [];
    for (let i = 0; i < 18; i++) { const f = (i / 18) * TAU; ring.push(add(add(c, scl(n, -er * 0.38)), add(scl(u, Math.cos(f) * er * 0.95), scl(v, Math.sin(f) * er * 0.95)))); }
    sheetMesh(mb, tubeRows(ring, 0.036, 6, true), () => C.socket, dH);
  }
  // ---- the cheeks puff out when it blows
  if (P.cheek > 0.02) for (const sd of [1, -1]) ellipsoid(mb, [0.62, 0.42, 0.24 * sd], [0.17 * P.cheek + 0.05, 0.14 * P.cheek + 0.04, 0.12 * P.cheek + 0.03], paintBody, dH, 8, 6);
  // ---- dorsal fin: spines with a scalloped membrane, then the soft rounded lobe
  const dr = [];
  const DN = 46;
  for (let i = 0; i <= DN; i++) {
    const x = lerp(-0.7, 0.31, i / DN);
    const top = bodyAt(x)[0];
    const D = dorsalH(x);
    const h = D.h * (0.55 + 0.45 * P.dors) * (1 + 0.25 * P.puff);
    const row = [];
    for (let j = 0; j <= 5; j++) { const u = j / 5; row.push([x - u * h * 0.32, top - 0.05 + u * (h + 0.05), 0, u, D.ray, D.spine]); }
    dr.push(row);
  }
  sheetMesh(mb, dr.map((r) => r.map((q) => q.slice(0, 3))), (q) => {
    const D = dorsalH(q[0] + 0.0), top = bodyAt(q[0])[0];
    const u = clamp01((q[1] - top) / Math.max(0.05, D.h));
    if (D.spine) return D.ray < 0.3 ? (u > 0.72 ? C.finEdge : C.finD) : u > 0.92 ? C.finEdge : mixC(C.fin, C.back, 0.3);
    return finCol(u, D.ray, h3(Math.round(q[0] * 14), Math.round(q[1] * 14), 1) > 0.8);
  }, dB, true);
  // ---- anal fin (rounded, under the rear) and pelvic fins
  const ar = [];
  for (let i = 0; i <= 12; i++) {
    const x = lerp(-0.66, -0.26, i / 12), b = bodyAt(x)[1];
    const h = 0.2 * Math.sin((i / 12) * Math.PI) ** 0.7 + 0.02;
    const row = [];
    for (let j = 0; j <= 4; j++) { const u = j / 4; row.push([x - u * h * 0.4, b + 0.04 - u * (h + 0.04), 0]); }
    ar.push(row);
  }
  sheetMesh(mb, ar, (q) => finCol(clamp01((bodyAt(q[0])[1] - q[1]) / 0.2), Math.abs(((q[0] * 20) % 1 + 1) % 1 - 0.5) * 2, false), dB, true);
  for (const sd of [1, -1]) {
    const base = dB([0.3, 0.0, 0.13 * sd]);
    paddle(mb, base, [-0.55, -0.72 - 0.2 * P.puff, 0.32 * sd], [0, 0, 1], 0.2, [0.03, 0.06, 0.08, 0.07, 0.03], [0.022, 0.02, 0.017, 0.014, 0.01], paintFin);
  }
  // ---- the round tail (wags about the peduncle)
  const trs = [];
  const spread = 0.95;
  for (let i = 0; i <= 8; i++) {
    const u = i / 8, row = [];
    for (let j = 0; j <= 14; j++) {
      const v = j / 14 * 2 - 1, a = v * spread;
      const R = 0.5 * (1 - 0.07 * v * v) * (1 + 0.15 * P.puff);
      row.push([TAIL0[0] + 0.03 - Math.cos(a) * R * u, TAIL0[1] + v * 0.1 * (1 - u) + Math.sin(a) * R * u, 0, u, v]);
    }
    trs.push(row);
  }
  const wag = (q) => {
    let v = sub(q, TAIL0);
    v = rz(v, P.tailUp); v = ry(v, P.wag);
    return dB(add(TAIL0, v));
  };
  sheetMesh(mb, trs.map((r) => r.map((q) => q.slice(0, 3))), (q) => {
    const d = sub(q, TAIL0), u = clamp01(Math.hypot(d[0], d[1]) / 0.5), a = Math.atan2(d[1], -d[0]);
    const ray = Math.abs(((a * 3.4) % 1 + 1) % 1 - 0.5) * 2;
    return finCol(u, ray, spotD(q[0], q[1], 5, 0.09, 0.024, 11) < 1);
  }, wag, true);
  // ---- pectoral fins: rounded fans behind the gill seam (the near one gestures)
  const fw = [0.045, 0.1, 0.145, 0.175, 0.19, 0.17, 0.1], ft = [0.032, 0.028, 0.024, 0.021, 0.019, 0.017, 0.013];
  const shN = dB([0.2, 0.4, 0.37]), shF = dB([0.2, 0.4, -0.37]);
  const tipF = paddle(mb, shF, P.pf, [0.1, 0.3, -1], 0.38 * P.pfLen, fw, ft, paintFin, P.pfTw);
  const tipN = paddle(mb, shN, P.pn, [0.1, 0.3, 1], 0.38 * P.pnLen, fw, ft, paintFin, P.pnTw);
  // ---- toy bits: the brass wind-up key on its side, the screw on the battery hatch
  const KX = -0.42, KA = 1.2;
  const ks = bodyPt(KX, KA), kax = bodyN(KX, KA);
  sheetMesh(mb, tubeRows([add(ks, scl(kax, -0.06)), add(ks, scl(kax, 0.2))], 0.036, 6), () => C.brassD, dB);
  sheetMesh(mb, tubeRows([add(ks, scl(kax, -0.01)), add(ks, scl(kax, 0.035))], 0.075, 8), () => C.brassD, dB);
  const kc = add(ks, scl(kax, 0.24)), ka = P.key;
  const e1 = norm(cross(kax, [1, 0, 0])), e2 = cross(kax, e1);
  const kd = add(scl(e1, Math.cos(ka)), scl(e2, Math.sin(ka))), kn = add(scl(e1, -Math.sin(ka)), scl(e2, Math.cos(ka)));
  ellipsoid(mb, kc, [0.05, 0.05, 0.05], () => C.brass, dB, 8, 5);
  for (const sd of [1, -1]) {
    const lc = add(kc, scl(kd, 0.15 * sd));
    ellipsoid(mb, lc, [0.12, 0.095, 0.036], (q) => { const dq = sub(q, lc); const r = Math.hypot(dot(dq, kd) / 1.25, dot(dq, kn)); return r < 0.042 ? C.brassD : dot(dq, kn) > 0.05 ? C.brassHi : C.brass; }, dB, 12, 6, [kd, kn, kax]);
  }
  const hz = bodyPt(HATCH.x, Math.PI * 0.62);
  ellipsoid(mb, [HATCH.x, HATCH.y, hz[2] + 0.005], [0.03, 0.03, 0.02], (q) => (Math.abs(q[1] - HATCH.y) < 0.008 ? C.screwD : C.screw), dB, 8, 5);
  const raw = mb.build();
  const tv = performance.now();
  GSTAT.mesh += tv - tm0;
  const mesh = voxelizeMesh(raw, GROUPER_VOXEL, { jitter: 0.012, ao: 0.45 }) || raw;
  GSTAT.vox += performance.now() - tv;
  if (mesh !== raw) raw.dispose?.();
  // ---- anchors (posed)
  const nrmD = (p, n, part) => norm(sub(def(add(p, scl(n, 0.05)), part), def(p, part)));
  const A = {
    eyes: [1, -1].map((sd) => {
      const c = add(eyeC(sd), scl(eyeN(sd), 0.03 * P.eyePop));
      return { p: dH(c), up: dH(add(c, [0, er, 0])), n: nrmD(c, eyeN(sd), 'head'), side: sd };
    }),
    cheeks: [1, -1].map((sd) => dH([0.68, 0.5, 0.26 * sd])), cheekN: [1, -1].map((sd) => nrmD([0.68, 0.5, 0.26 * sd], norm([0.4, 0, sd]), 'head')),
    mouth: (() => { const a = dH([1.02, mouthY(1.0) + 0.02, 0]), b = dJ([1.07, mouthY(1.0) - 0.03, 0]); return scl(add(a, b), 0.5); })(),
    lipL: dJ([1.11, mouthY(1.0) - 0.03, 0]), nose: dH([1.0, 0.48, 0]), faceN: nrmD([1.0, 0.45, 0], [1, 0, 0], 'head'),
    top: dH([0.5, 1.12, 0]), head: dH([0.62, 0.62, 0]), hand: tipN, hand2: tipF,
    tail: wag([-1.36, 0.39, 0]), bottom: dB([0.05, -0.12, 0]), key: dB(kc),
    gloss: dH([0.3, 0.96, 0.17]), lipGloss: dH([0.9, mouthY(0.9) + 0.1, 0.12]),
  };
  return { mesh, A };
}

// ------------------------------------------------------------------------------------------------ animations
// n frames per cycle, dur seconds per cycle, buckets (point: 7 elevations), jl (jaw levels: talk positions baked),
// fn(P, k, bucket) mutates the pose.
const S = Math.sin, CO = Math.cos;
const POINT_E = [-90, -60, -30, 0, 30, 60, 90].map((d) => (d * Math.PI) / 180);
const finDir = (fx, fy, fz) => norm([fx, fy, fz]);
export const GROUPER_ANIMS = {
  idle: { n: 12, dur: 2.4, jl: 3, fn(P, k) {
    const a = k * TAU, s = S(a);
    P.rz = 0.03 * S(a + 0.5); P.head = [0, 0.02 * s, 0];
    P.wag = 0.28 * S(a * 2); P.tailUp = 0.04 * s;
    P.pn = finDir(-0.78 + 0.22 * S(a * 2), -0.3 + 0.16 * CO(a * 2), 0.55); P.pf = finDir(-0.78 + 0.22 * S(a * 2 + 2), -0.3, -0.55);
    P.pnTw = 0.3 * S(a * 2); P.key = k * Math.PI; P.dors = 1 + 0.06 * s; P.jaw = 0.04 + 0.03 * Math.max(0, s);
  } },
  swim: { n: 10, dur: 0.62, jl: 2, fn(P, k) {
    const a = k * TAU;
    P.wave = 0.12; P.wph = a; P.wag = 0.5 * S(a - 1.2);
    P.sq = [1.04, 0.98, 0.98]; P.head = [0.06 * S(a + 1.4), 0, 0];
    P.pn = finDir(-0.95, -0.25, 0.3); P.pf = finDir(-0.95, -0.25, -0.3); P.pnLen = P.pfLen = 0.9;
    P.key = k * Math.PI; P.dors = 0.85; P.jaw = 0.1;
  } },
  wiggle: { n: 8, dur: 0.5, jl: 2, fn(P, k) {
    const s = S(k * TAU);
    P.side = 0.2 * s; P.head = [0.25 * s, 0.05, 0.12 * s]; P.dy = 0.05 * Math.abs(s);
    P.pn = finDir(0.1, -0.2 + 0.6 * s, 0.9); P.pf = finDir(0.1, -0.2 - 0.6 * s, -0.9);
    P.wag = 0.55 * s; P.jaw = 0.42; P.key = k * Math.PI; P.dors = 1.15;
  } },
  wave: { n: 8, dur: 0.9, jl: 3, fn(P, k) {
    GROUPER_ANIMS.idle.fn(P, k);
    const s = S(k * TAU);
    P.pn = finDir(0.25 + 0.5 * s, 0.95, 0.55); P.pnLen = 1.25; P.pnTw = 0.6 * s;
    P.head = [-0.12, 0.08, 0.06]; P.rz = 0.05; P.jaw = Math.max(P.jaw, 0.3);
  } },
  point: { n: 4, dur: 1.1, buckets: 7, jl: 2, fn(P, k, b) {
    GROUPER_ANIMS.idle.fn(P, k * 0.5);
    const e = POINT_E[b];
    P.rz = clamp(e, -1.2, 1.2) * 0.3;
    P.head = [-0.1, e * 0.15, 0];
    P.pn = solvePoint(P, e); P.pnTw = 0.6;
    P.pnLen = 1.55 + 0.1 * S(k * TAU) + 0.2 * Math.max(0, Math.sin(e));
    P.jaw = 0.18;
  } },
  // a dramatic limp flop: it rolls onto its side (belly + battery hatch to you), sags, then bobs back up
  flop: { n: 14, dur: 1.3, jl: 1, fn(P, k) {
    let r;
    if (k < 0.22) r = sm(k / 0.22);
    else if (k < 0.62) r = 1 + 0.06 * S((k - 0.22) / 0.4 * Math.PI * 3);
    else r = 1 - sm((k - 0.62) / 0.38);
    P.roll = -1.05 * r; P.bend = -0.25 * r; P.jaw = 0.55 * r; P.dors = 1 - 0.6 * r; P.dy = -0.06 * r;
    P.pn = finDir(-0.3, -0.9, 0.3 + 0.3 * r); P.pf = finDir(-0.3, -0.9, -0.3); P.wag = 0.1 * S(k * TAU * 2) * (1 - r * 0.5);
    P.tailUp = -0.2 * r; P.key = k * Math.PI * 0.5;
  } },
  spin: { n: 16, dur: 0.85, jl: 1, fn(P, k) {
    P.yaw = YAW0 - k * TAU;
    P.dy = S(k * Math.PI) * 0.16; P.jaw = 0.75; P.dors = 1.25;
    P.pn = finDir(0.1, 0.4, 0.95); P.pf = finDir(0.1, 0.4, -0.95); P.wag = 0.35 * S(k * TAU * 2); P.key = k * TAU;
  } },
  worried: { n: 8, dur: 0.5, jl: 2, fn(P, k) {
    const j = (Math.floor(k * 8) % 2 ? 1 : -1);
    P.sq = [0.97, 0.96, 0.98]; P.head = [0, -0.06, 0.035 * j]; P.side = 0.015 * j;
    P.pn = finDir(0.75, 0.15, 0.35); P.pf = finDir(0.75, 0.15, -0.35); P.pnLen = P.pfLen = 0.95;
    P.jaw = Math.floor(k * 8) % 2 ? 0.12 : 0.22; P.dors = 0.55; P.wag = 0.12 * j; P.tailUp = -0.06;
  } },
  clap: { n: 6, dur: 0.34, jl: 1, fn(P, k) {
    const open = 0.5 + 0.5 * CO(k * TAU);
    P.head = [0, 0.06, 0]; P.dy = 0.04 * (1 - open);
    P.pn = finDir(0.85, 0.05, -0.15 + open * 0.95); P.pf = finDir(0.85, 0.05, 0.15 - open * 0.95); P.pnLen = P.pfLen = 1.15;
    P.jaw = 0.55 + 0.2 * open; P.wag = 0.3 * open; P.dors = 1.15; P.key = k * Math.PI;
  } },
  think: { n: 8, dur: 2.2, jl: 2, fn(P, k) {
    GROUPER_ANIMS.idle.fn(P, k);
    P.pn = finDir(0.7, -0.25, -0.35); P.pnLen = 1.05; P.pnTw = 1.2; P.head = [-0.05, 0.14 + 0.02 * S(k * TAU), -0.1];
    P.jaw = 0.02; P.pucker = 0.6;
  } },
  blow: { n: 8, dur: 1.4, jl: 1, fn(P, k) {
    GROUPER_ANIMS.idle.fn(P, k);
    const c = S(clamp01(k / 0.8) * Math.PI) ** 0.6;
    P.cheek = c; P.pucker = 0.4 + 0.6 * c; P.jaw = 0.0; P.head = [0, 0.05, 0];
  } },
  cheer: { n: 8, dur: 0.6, jl: 1, fn(P, k) {
    const s = S(k * TAU);
    P.dy = 0.16 * Math.abs(s); P.bend = 0.12; P.head = [0, 0.12, 0];
    P.pn = finDir(0.2, 0.95, 0.4 + 0.2 * s); P.pf = finDir(0.2, 0.95, -0.4 - 0.2 * s); P.pnLen = P.pfLen = 1.2;
    P.jaw = 0.85; P.wag = 0.4 * s; P.tailUp = 0.12; P.dors = 1.3; P.key = k * TAU;
  } },
  sad: { n: 10, dur: 2.2, jl: 2, fn(P, k) {
    const s = S(k * TAU);
    P.bend = -0.3; P.rz = -0.12 + 0.02 * s; P.head = [0, -0.08, 0]; P.dy = -0.04;
    P.pn = finDir(-0.2, -0.95, 0.35); P.pf = finDir(-0.2, -0.95, -0.35); P.pnLen = P.pfLen = 0.9;
    P.jaw = 0.2; P.dors = 0.35; P.wag = 0.08 * s; P.tailUp = -0.18;
  } },
  sleep: { n: 10, dur: 3.2, jl: 1, fn(P, k) {
    const s = S(k * TAU);
    P.roll = -0.14; P.rz = -0.05 + 0.02 * s; P.sq = [1, 1 + 0.025 * s, 1 + 0.02 * s]; P.bend = -0.1;
    P.pn = finDir(-0.4, -0.85, 0.45); P.pf = finDir(-0.4, -0.85, -0.45);
    P.jaw = 0.22 + 0.08 * s; P.dors = 0.4; P.wag = 0.06 * s; P.tailUp = -0.1;
  } },
  // PUFFS UP like a beach ball: spines up, fins splayed, jaw wide in a big O
  surprised: { n: 10, dur: 0.9, jl: 1, fn(P, k) {
    const p = k < 0.18 ? sm(k / 0.18) * 1.08 : 1 + 0.06 * S((k - 0.18) * 14) * (1 - k);
    P.puff = p; P.eyePop = p; P.jaw = 0.75 * Math.min(1, p); P.dors = 1 + 0.5 * p; P.pucker = 0.4 * p;
    P.pn = finDir(0.1, 0.2, 1); P.pf = finDir(0.1, 0.2, -1); P.pnLen = P.pfLen = 1.1; P.wag = 0.05; P.tailUp = 0.1 * p;
    P.head = [0, 0.05 * p, 0];
  } },
  scared: { n: 8, dur: 0.4, jl: 1, fn(P, k) {
    const j = (Math.floor(k * 8) % 2 ? 1 : -1);
    P.puff = 0.7; P.eyePop = 0.8; P.jaw = 0.45 + 0.1 * j; P.dors = 1.4;
    P.side = 0.02 * j; P.head = [0, 0, 0.04 * j];
    P.pn = finDir(0.8, 0.2, 0.3); P.pf = finDir(0.8, 0.2, -0.3); P.wag = 0.15 * j; P.tailUp = -0.05;
  } },
  // the goofy toy head-turn: the head swivels on its seam to stare right at you, holds, grins, swivels back
  look: { n: 14, dur: 2.0, jl: 2, fn(P, k) {
    GROUPER_ANIMS.idle.fn(P, k);
    const r = k < 0.18 ? sm(k / 0.18) : k < 0.78 ? 1 : 1 - sm((k - 0.78) / 0.22);
    const tw = k > 0.18 && k < 0.78 ? 0.04 * S((k - 0.18) * TAU * 3) : 0;
    P.head = [-1.0 * r, 0.06 * r + tw, 0.08 * r];
    P.jaw = 0.04 + 0.4 * r * (k > 0.4 && k < 0.7 ? 1 : 0.4);
    P.wag = 0.15 * S(k * TAU * 2); P.dors = 1 + 0.15 * r;
  } },
  laugh: { n: 8, dur: 0.42, jl: 1, fn(P, k) {
    const s = S(k * TAU);
    P.dy = 0.03 * Math.abs(s); P.head = [0, 0.12 + 0.05 * s, 0]; P.bend = 0.06;
    P.jaw = 0.55 + 0.4 * Math.abs(s); P.wag = 0.3 * s; P.dors = 1.2;
    P.pn = finDir(0.6, -0.2 + 0.3 * s, 0.6); P.pf = finDir(0.6, -0.2 - 0.3 * s, -0.6);
    P.sq = [1 - 0.02 * s, 1 + 0.03 * s, 1];
  } },
};
// other pose / mood names -> grouper animations
export const GROUPER_ALIAS = {
  talk: 'idle', happy: 'idle', nod: 'idle', ride: 'idle', bend: 'worried', excited: 'wiggle', love: 'wiggle', dance: 'wiggle',
  celebrate: 'spin', cry: 'sad', droop: 'sad', sleepy: 'sleep', puff: 'surprised', bounce: 'cheer', jump: 'cheer', flex: 'cheer',
  goofy: 'look', headturn: 'look', stare: 'look', giggle: 'laugh', swimming: 'swim',
};

// near pectoral direction (model space) that points at screen elevation e (rad, up = +), out in front of the body
function solvePoint(P, e) {
  const m = T4.rot(P.tilt, P.yaw, P.rz);
  const q = norm([Math.cos(e) + 0.4 * Math.max(0, Math.sin(e)), Math.sin(e), 0.5 + 0.55 * Math.max(0, Math.sin(e)) + 0.25 * Math.max(0, -Math.sin(e))]);
  return norm([m[0] * q[0] + m[1] * q[1] + m[2] * q[2], m[4] * q[0] + m[5] * q[1] + m[6] * q[2], m[8] * q[0] + m[9] * q[1] + m[10] * q[2]]);
}

function pose(anim, k, b, view, jaw) {
  const P = P0();
  if (view === 'front') { P.yaw = YAW_FRONT; P.tilt = TILT_FRONT; }
  GROUPER_ANIMS[anim].fn(P, k, b);
  if (view === 'front' && anim !== 'spin') P.yaw = YAW_FRONT;
  if (jaw) P.jaw = clamp01(Math.max(P.jaw, jaw) + jaw * 0.15);
  return P;
}

// ------------------------------------------------------------------------------------------------ sheets (cache)
const SHEETS = new Map();
const SIZES = [16, 20, 24, 28, 32, 36, 40, 44, 48, 56, 64, 72, 80, 96, 112, 128];
export function grouperSize(s) { for (const z of SIZES) if (z >= s - 1.5) return z; return SIZES[SIZES.length - 1]; }
const JAW_LV = (A) => A.jl || 1;
const jawOf = (lv, nl) => (nl <= 1 || !lv ? 0 : nl === 2 ? 0.6 : lv * 0.5);

function project(A, o, m) {
  const pr = (p) => lpProject(p, o);
  const rot = (n) => [m[0] * n[0] + m[4] * n[1] + m[8] * n[2], m[1] * n[0] + m[5] * n[1] + m[9] * n[2], m[2] * n[0] + m[6] * n[1] + m[10] * n[2]];
  return {
    eyes: A.eyes.map((e) => {
      const n = rot(e.n), p = pr(e.p), u = pr(e.up);
      return { p, R: Math.hypot(u[0] - p[0], u[1] - p[1]), nx: n[0], ny: -n[1], nz: n[2], side: e.side };
    }),
    cheeks: A.cheeks.map(pr), cheekZ: A.cheekN.map((n) => rot(n)[2]),
    mouth: pr(A.mouth), lipL: pr(A.lipL), nose: pr(A.nose), faceZ: rot(A.faceN)[2],
    top: pr(A.top), head: pr(A.head), hand: pr(A.hand), hand2: pr(A.hand2), tail: pr(A.tail), bottom: pr(A.bottom), key: pr(A.key), gloss: pr(A.gloss), lipGloss: pr(A.lipGloss),
  };
}

// crisp dark ink outline around the silhouette, baked into each cached cell once: every transparent pixel touching an
// opaque one in the cell turns ink; big sheets get 2 px so the line still reads once scaled down. Before that, the
// eye domes are measured in the rendered pixels (how much of each white dome shows, and where), so the live pupils
// only go where the dome really is (the far eye peeks over the head in the side view).
const INK = [16, 12, 8];
export const GROUPER_OUTLINE = (size) => (size >= 52 ? 2 : 1);
function finishCell(canvas, x0, y0, cw, ch, passes, F) {
  let g;
  try { g = canvas.getContext('2d', { willReadFrequently: true }); } catch { return; }
  if (!g) return;
  let img;
  try { img = g.getImageData(x0, y0, cw, ch); } catch { return; }
  const d = img.data, W = cw, H = ch;
  for (const E of F.eyes) {
    let n = 0, w = 0, sx = 0, sy = 0;
    const R = E.R * 0.88, st = Math.max(1, R / 6);
    for (let yy = -R; yy <= R; yy += st) for (let xx = -R; xx <= R; xx += st) {
      if (xx * xx + yy * yy > R * R) continue;
      n++;
      const px = Math.round(E.p[0] + xx), py = Math.round(E.p[1] + yy);
      if (px < 0 || py < 0 || px >= W || py >= H) continue;
      const j = (py * W + px) * 4, r = d[j], gg = d[j + 1], b = d[j + 2];
      if (d[j + 3] > 200 && r > 150 && gg > 145 && b > 125 && Math.max(r, gg, b) - Math.min(r, gg, b) < 60) { w++; sx += px; sy += py; }
    }
    E.vis = n ? w / n : 0;
    E.vc = w ? [sx / w, sy / w] : E.p;
  }
  const solid = new Uint8Array(W * H);
  for (let i = 0, j = 3; i < solid.length; i++, j += 4) solid[i] = d[j] > 110 ? 1 : 0;
  for (let pass = 0; pass < passes; pass++) {
    const adds = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (solid[i]) continue;
      if ((x > 0 && solid[i - 1]) || (x < W - 1 && solid[i + 1]) || (y > 0 && solid[i - W]) || (y < H - 1 && solid[i + W])) {
        const j = i * 4;
        d[j] = INK[0]; d[j + 1] = INK[1]; d[j + 2] = INK[2]; d[j + 3] = 255;
        adds.push(i);
      }
    }
    for (const i of adds) solid[i] = 1;
  }
  g.putImageData(img, x0, y0);
}

// A sheet is built as a JOB, one cell (pose mesh -> voxels -> render -> outline) at a time, a cell or two per frame,
// so a new animation never freezes the game; the nearest finished sheet stands in meanwhile.
const JOBS = new Map();
function startJob(key, anim, size, view, lv) {
  const A = GROUPER_ANIMS[anim];
  const n = A.n * (A.buckets || 1);
  const cw = Math.ceil(CELL_W * size), ch = Math.ceil(CELL_H * size);
  const cols = Math.max(1, Math.min(n, Math.floor(2048 / cw)));
  const canvas = document.createElement('canvas');
  canvas.width = cols * cw; canvas.height = Math.ceil(n / cols) * ch;
  try { canvas.getContext('2d', { willReadFrequently: true }); } catch { /* fine */ }
  const J = { key, anim, size, view, lv, A, n, cw, ch, cols, canvas, i: 0, frames: [], jaw: jawOf(lv, JAW_LV(A)), base: { w: cw, h: ch, center: C0, scale: size, radius: 2.3, ...LOOK }, ok: true };
  JOBS.set(key, J);
  return J;
}
function stepJob(J) {
  const i = J.i++, A = J.A;
  const b = Math.floor(i / A.n), k = (i % A.n) / A.n;
  const P = pose(J.anim, k, b, J.view, J.jaw);
  const { mesh, A: an } = buildGrouper(P);
  const matrix = T4.rot(P.tilt, P.yaw, P.rz);
  const F = project(an, { ...J.base, matrix }, matrix);
  F.dy = P.dy; F.jaw = P.jaw; F.puff = P.puff;
  J.frames.push(F);
  const x0 = (i % J.cols) * J.cw, y0 = Math.floor(i / J.cols) * J.ch;
  const tr = performance.now();
  try { renderSheet([{ mesh, matrix }], { ...J.base, cols: 1, out: J.canvas, outX: x0, outY: y0 }); } catch (e) { J.ok = false; }
  const to = performance.now();
  GSTAT.render += to - tr;
  mesh.dispose?.();
  if (J.ok) finishCell(J.canvas, x0, y0, J.cw, J.ch, GROUPER_OUTLINE(J.size), F);
  GSTAT.outline += performance.now() - to;
  if (J.i >= J.n) {
    JOBS.delete(J.key);
    const sh = { canvas: J.ok ? J.canvas : null, cw: J.cw, ch: J.ch, cols: J.cols, n: J.n, frames: J.frames, size: J.size, anim: J.anim, lv: J.lv, view: J.view, used: performance.now() };
    SHEETS.set(J.key, sh);
    if (SHEETS.size > 72) {
      let old = null;
      for (const [kk, s] of SHEETS) if (!old || s.used < old[1].used) old = [kk, s];
      if (old) SHEETS.delete(old[0]);
    }
    return sh;
  }
  return null;
}
// advance the running jobs: one cell every other frame or so (more while cells are quick)
let pumpT = -1e9;
function pump() {
  const now = performance.now();
  if (now - pumpT < 24 || !JOBS.size) return;
  pumpT = now;
  for (const J of JOBS.values()) {
    stepJob(J);
    if (performance.now() - now > 6) return;
  }
}
function runJob(key, anim, size, view, lv) {
  const J = JOBS.get(key) || startJob(key, anim, size, view, lv);
  let sh = null;
  while (!sh) sh = stepJob(J);
  return sh;
}

function sheet(anim, size, view, lv, force) {
  const key = anim + '|' + size + '|' + view + '|' + lv;
  const sh = SHEETS.get(key);
  if (sh) { sh.used = performance.now(); return sh; }
  if (force) return runJob(key, anim, size, view, lv);
  if (!JOBS.has(key)) startJob(key, anim, size, view, lv);
  // meanwhile: another jaw level of this cycle, this cycle at another size, the idle cycle, anything in this view
  for (let l = lv - 1; l >= 0; l--) { const s2 = SHEETS.get(anim + '|' + size + '|' + view + '|' + l); if (s2) return s2; }
  let best = null;
  for (const s of SHEETS.values()) {
    if (s.view !== view) continue;
    const score = (s.anim === anim ? 0 : s.anim === 'idle' ? 1000 : 2000) + Math.abs(s.size - size) + s.lv * 0.1;
    if (!best || score < best[0]) best = [score, s];
  }
  if (best) return best[1];
  // nothing at all to show yet: the idle cycle right now
  return runJob('idle|' + size + '|' + view + '|0', 'idle', size, view, 0);
}

export function warmGrouper(size = 40, anims = ['idle', 'swim', 'point'], view = 'side') {
  if (!lpAvailable()) return true;
  const z = grouperSize(size);
  for (const a of anims) {
    const A = GROUPER_ANIMS[a] ? a : GROUPER_ALIAS[a];
    if (!GROUPER_ANIMS[A]) continue;
    const nl = A === 'idle' ? JAW_LV(GROUPER_ANIMS[A]) : 1;
    for (let l = 0; l < nl; l++) sheet(A, z, view, l, true);
  }
  return true;
}
export function grouperBusy() { return JOBS.size; }
export function grouperReady(size = 40, view = 'side') { return SHEETS.has('idle|' + grouperSize(size) + '|' + view + '|0'); }

// ------------------------------------------------------------------------------------------------ the live face
const FACESTATE = new Map();
function faceState(id, t, anim) {
  let s = FACESTATE.get(id);
  if (!s || t < s.t - 1) { s = { t, next: t + 1.5 + Math.random() * 2, until: -1, gx: 0, gy: 0, tx: 0, ty: 0, glance: t + 1, roll: -9, anim, dizzy: -9 }; FACESTATE.set(id, s); }
  const dt = clamp(t - s.t, 0, 0.1);
  s.dt = dt; s.t = t;
  if (t > s.next) { s.until = t + 0.12; s.next = t + 2 + Math.random() * 3.5; if (Math.random() < 0.18) s.next = t + 0.3; }
  // idle glances: the pupils dart somewhere new now and then; a rare eye roll
  if (t > s.glance) {
    s.glance = t + 0.8 + Math.random() * 2.2;
    const a = Math.random() * TAU, r = Math.random() < 0.3 ? 0 : 0.5 + Math.random() * 0.5;
    s.tx = Math.cos(a) * r; s.ty = Math.sin(a) * r * 0.8;
    if (Math.random() < 0.06) s.roll = t;
  }
  if (anim !== s.anim) { if (s.anim === 'spin') s.dizzy = t; s.anim = anim; }
  if (FACESTATE.size > 40) FACESTATE.delete(FACESTATE.keys().next().value);
  return s;
}

let FPX = 1; // the face is drawn at voxel resolution: one face pixel = FPX sprite px
function ellipse(g, x, y, rxx, ryy, rot = 0) { g.beginPath(); g.ellipse(x, y, Math.max(0.3, rxx), Math.max(0.3, ryy), rot, 0, TAU); }
// a filled ellipse snapped to whole face pixels (round even when it is only a few voxels across)
function pixDisc(g, x, y, rxx, ryy) {
  const ix = x / FPX, iy = y / FPX, ax = rxx / FPX + 0.35, ay = ryy / FPX + 0.35;
  for (let j = Math.floor(iy - ay); j <= Math.ceil(iy + ay); j++) for (let i = Math.floor(ix - ax); i <= Math.ceil(ix + ax); i++) {
    const dx = (i + 0.5 - ix) / ax, dy = (j + 0.5 - iy) / ay;
    if (dx * dx + dy * dy <= 1) g.fillRect(i * FPX, j * FPX, FPX, FPX);
  }
}
function heart(g, x, y, k) {
  g.beginPath();
  g.moveTo(x, y + k * 0.85);
  g.bezierCurveTo(x - k * 1.25, y - k * 0.05, x - k * 0.55, y - k * 1.0, x, y - k * 0.35);
  g.bezierCurveTo(x + k * 0.55, y - k * 1.0, x + k * 1.25, y - k * 0.05, x, y + k * 0.85);
  g.fill();
}

// one toy eye: E {p, R, nx, ny, nz, side}; the white dome is voxels, this draws the pupil and the lids on it
function drawEye(g, E, o) {
  const { mood, blink, gx, gy, front } = o;
  const R = E.R, [cx, cy] = E.p, vis = E.vis ?? 1;
  // a dome partly hidden behind the head: work inside the part that shows
  const part = vis < 0.8, cr0 = part ? R * Math.sqrt(vis) * 0.95 : R * 0.97;
  const ccx = part ? E.vc[0] : cx, ccy = part ? E.vc[1] : cy;
  g.save();
  ellipse(g, ccx, ccy, cr0, cr0); g.clip();
  // pupil: rests where the eye faces, swivels with the gaze, stays on the dome
  let pr = R * 0.5;
  if (mood === 'surprised' || mood === 'scared') pr = R * 0.28;
  else if (mood === 'excited' || mood === 'love') pr = R * 0.56;
  let ox = E.nx * R * 0.3 + gx * R * 0.45, oy = E.ny * R * 0.3 + gy * R * 0.45;
  if (part) { pr = Math.min(pr, cr0 * 0.8); ox = gx * cr0 * 0.3; oy = gy * cr0 * 0.3; }
  const lim = cr0 - pr * 0.95, ol = Math.hypot(ox, oy);
  if (ol > lim) { ox *= Math.max(0, lim) / ol; oy *= Math.max(0, lim) / ol; }
  const px = ccx + ox, py = ccy + oy;
  if (mood === 'love') {
    g.fillStyle = '#ff3f78'; heart(g, px, py, pr * 1.1);
    g.fillStyle = '#ffffff'; g.fillRect(Math.round((px - pr * 0.5) / FPX) * FPX, Math.round((py - pr * 0.5) / FPX) * FPX, FPX, FPX);
  } else if (mood === 'dizzy') {
    g.strokeStyle = '#140d06'; g.lineWidth = Math.max(FPX, pr * 0.32); g.lineCap = 'round';
    g.beginPath();
    for (let i = 0; i <= 18; i++) { const a = i * 0.7 + o.t * 9 * E.side, r = pr * (i / 18) * 1.1; const X = px + Math.cos(a) * r, Y = py + Math.sin(a) * r; if (i) g.lineTo(X, Y); else g.moveTo(X, Y); }
    g.stroke();
  } else {
    g.fillStyle = '#140d06'; pixDisc(g, px, py, pr * Math.max(0.7, 0.8 + 0.2 * E.nz), pr);
    const d = Math.max(FPX, Math.round(pr * 0.42 / FPX) * FPX);
    g.fillStyle = '#ffffff';
    g.fillRect(Math.round((px - pr * 0.45) / FPX) * FPX, Math.round((py - pr * 0.55) / FPX) * FPX, d, d);
    if (pr > FPX * 3) g.fillRect(Math.round((px + pr * 0.3) / FPX) * FPX, Math.round((py + pr * 0.3) / FPX) * FPX, FPX, FPX);
  }
  // lids: plastic eyelids slide over the dome (h 0 open .. 1 shut; slope tilts the lid edge, + = lower toward the front)
  let h = 0, slope = 0, arc = 0;
  if (blink > 0.5) h = 1.05;
  else if (mood === 'sleep') h = 1.05;
  else if (mood === 'joy' || mood === 'laugh') { h = 1.05; arc = 1; }
  else if (mood === 'sleepy' || mood === 'tired') h = 0.55;
  else if (mood === 'smug') h = 0.42;
  else if (mood === 'sad' || mood === 'worried' || mood === 'cry') { h = 0.3; slope = -0.5; }
  else if (mood === 'angry' || mood === 'determined') { h = 0.36; slope = 0.55; }
  else if (blink > 0.05) h = blink;
  if (h > 0.01) {
    const yl = (x) => cy - R + 2 * R * h + slope * (x - cx) * front;
    g.fillStyle = LID;
    g.beginPath(); g.moveTo(cx - R * 1.2, cy - R * 1.3); g.lineTo(cx + R * 1.2, cy - R * 1.3); g.lineTo(cx + R * 1.2, yl(cx + R * 1.2)); g.lineTo(cx - R * 1.2, yl(cx - R * 1.2)); g.closePath(); g.fill();
    g.fillStyle = 'rgba(255,228,160,0.35)'; ellipse(g, cx - R * 0.3, cy - R * 0.65, R * 0.4, R * 0.18, -0.3); g.fill();
    g.strokeStyle = LID_D; g.lineWidth = Math.max(FPX, R * 0.16); g.lineCap = 'round';
    g.beginPath();
    if (arc) { g.arc(cx, cy + R * 0.25, R * 0.62, 1.15 * Math.PI, 1.85 * Math.PI); }
    else if (h >= 1) { g.moveTo(cx - R * 0.8, cy + R * 0.12); g.quadraticCurveTo(cx, cy + R * 0.45, cx + R * 0.8, cy + R * 0.12); }
    else { g.moveTo(cx - R * 1.2, yl(cx - R * 1.2)); g.lineTo(cx + R * 1.2, yl(cx + R * 1.2)); }
    g.stroke();
  }
  g.restore();
}

function drawFace(g, F, o, s, st) {
  const mood0 = o.mood || 'happy', t = o.t || 0;
  let mood = mood0;
  if (o.anim === 'sleep') mood = 'sleep';
  else if (t - st.dizzy < 1.1) mood = 'dizzy';
  else if ((o.anim === 'surprised' || o.anim === 'scared') && mood !== 'love') mood = 'surprised';
  else if ((o.anim === 'laugh' || o.anim === 'cheer') && mood === 'happy') mood = 'joy';
  else if (mood === 'happy' && (o.talk || 0) < 0.05 && Math.sin(t * 0.8) > 0.94) mood = 'joy';
  // gaze (sprite-local; o.look is already mirrored by facing)
  let gx = st.tx, gy = st.ty;
  if (o.look) { const l = Math.hypot(o.look[0], o.look[1]) || 1, k = Math.min(1, l / 30); gx = (o.look[0] / l) * k; gy = (o.look[1] / l) * k; }
  if (mood === 'think') { gx = 0.3; gy = -0.95; }
  if (o.anim === 'look') { gx = 0; gy = 0; }
  const rollK = (t - st.roll) / 0.9;
  if (rollK >= 0 && rollK < 1 && mood !== 'think') { const a = -Math.PI / 2 + rollK * TAU * 0.9; gx = Math.cos(a) * 0.9; gy = Math.sin(a) * 0.9; }
  st.gx += (gx - st.gx) * Math.min(1, st.dt * 14); st.gy += (gy - st.gy) * Math.min(1, st.dt * 14);
  const blink = o.blink ?? (t < st.until ? 1 : 0);
  const a0 = g.globalAlpha;
  const vis = F.eyes.filter((E) => (E.vis ?? 1) > 0.5);
  const front = (E) => { const other = vis.find((q) => q !== E); return other && Math.abs(other.p[0] - E.p[0]) > E.R * 0.8 ? Math.sign(other.p[0] - E.p[0]) : 1; };
  // blush on the cheeks
  if ((mood === 'love' || mood === 'excited' || mood === 'joy') && F.faceZ > -0.2) {
    g.fillStyle = 'rgba(255,110,140,0.5)';
    F.cheeks.forEach((c, i) => {
      const z = F.cheekZ[i];
      if (z < 0.1) return;
      g.globalAlpha = a0 * clamp01((z - 0.1) / 0.3);
      ellipse(g, c[0], c[1], s * 0.09 * Math.max(0.4, z), s * 0.05); g.fill();
    });
    g.globalAlpha = a0;
  }
  // eyes (the far one only while its dome faces us)
  for (const E of F.eyes) {
    if ((E.vis ?? 1) < 0.1) continue;
    drawEye(g, E, { mood, blink, gx: st.gx, gy: st.gy, front: front(E), t });
  }
  g.globalAlpha = a0;
  // thick painted eyebrows (they waggle while it talks)
  const talk = clamp01(o.talk || 0);
  for (const E of F.eyes) {
    if ((E.vis ?? 1) < 0.15) continue;
    const R = E.R, fr = front(E);
    let lift = R * 0.42 + talk * R * 0.25 * (0.5 + 0.5 * Math.sin(t * 7.3)), ang = 0;
    if (mood === 'surprised' || mood === 'excited' || mood === 'dizzy') lift = R * 0.75;
    else if (mood === 'worried' || mood === 'sad' || mood === 'cry' || mood === 'scared') { ang = -0.42; lift = R * 0.3; }
    else if (mood === 'angry' || mood === 'determined') { ang = 0.45; lift = R * 0.02; }
    else if (mood === 'think' || mood === 'smug') { ang = E.side > 0 ? -0.3 : 0.2; lift = E.side > 0 ? R * 0.5 : R * 0.12; }
    else if (mood === 'sleep') lift = R * 0.05;
    const bx = E.p[0] - fr * R * 0.05, by = E.p[1] - R - lift - R * 0.18;
    g.save();
    g.translate(bx, by); g.rotate(ang * fr);
    g.strokeStyle = BROW; g.lineCap = 'round'; g.lineWidth = Math.max(FPX * 2, R * 0.4);
    const arch = ang ? 0.12 : 0.35;
    g.beginPath(); g.moveTo(-R * 0.68, R * arch * 0.5); g.quadraticCurveTo(0, -R * arch, R * 0.68, R * arch * 0.5); g.stroke();
    g.restore();
  }
  g.globalAlpha = a0;
  // tears / a sweat drop
  if (mood === 'cry' || o.anim === 'sad' && mood === 'sad') {
    g.fillStyle = '#7fdcff';
    for (const E of F.eyes) {
      if (E.nz < 0.1) continue;
      for (let i = 0; i < 2; i++) {
        const k = ((t * 1.3 + i * 0.5) % 1);
        const x = E.p[0] - E.R * 0.4 * (i ? -1 : 1), y = E.p[1] + E.R * 0.8 + k * s * 0.35;
        g.globalAlpha = a0 * (1 - k);
        ellipse(g, x, y, Math.max(FPX, s * 0.022), Math.max(FPX, s * 0.034)); g.fill();
      }
    }
    g.globalAlpha = a0;
  }
  if (mood === 'worried' || mood === 'scared' || o.anim === 'worried') {
    const E = F.eyes[0], dx = E.p[0] - E.R * 1.4, dy = E.p[1] - E.R * 0.9 + ((t * 2) % 1) * s * 0.08, s2 = s * 0.9;
    g.fillStyle = '#7fdcff';
    g.beginPath(); g.moveTo(dx, dy - s2 * 0.12); g.quadraticCurveTo(dx + s2 * 0.08, dy, dx, dy + s2 * 0.05); g.quadraticCurveTo(dx - s2 * 0.08, dy, dx, dy - s2 * 0.12); g.fill();
    g.fillStyle = '#ffffff'; g.fillRect(dx - FPX * 0.5, dy - s2 * 0.04, FPX, FPX);
  }
}

// glossy painted-plastic shine as crisp voxel pixels: a short streak on the forehead and a glint on the lips
function drawGloss(g, F, s) {
  if (s < 20) return;
  const px = (x, y) => g.fillRect(Math.round(x / FPX) * FPX, Math.round(y / FPX) * FPX, FPX, FPX);
  g.fillStyle = 'rgba(255,252,236,0.85)';
  for (let i = -2; i <= 2; i++) px(F.gloss[0] + i * FPX, F.gloss[1] + Math.round(i * 0.35) * FPX);
  g.fillStyle = 'rgba(255,255,255,0.95)';
  px(F.gloss[0] - FPX, F.gloss[1] - FPX);
  if (F.faceZ > -0.4) { px(F.lipGloss[0], F.lipGloss[1]); px(F.lipGloss[0] + FPX, F.lipGloss[1]); }
}
// snap the face layer to whole voxels: no soft half-transparent edges
function crisp(g, w, h) {
  let img;
  try { img = g.getImageData(0, 0, w, h); } catch { return; }
  const d = img.data;
  for (let i = 3; i < d.length; i += 4) d[i] = d[i] < 96 ? 0 : 255;
  g.putImageData(img, 0, 0);
}

// ------------------------------------------------------------------------------------------------ bubbles (2D)
const RIDE = new Map();
function rideBubble(r) {
  r = Math.max(4, Math.round(r));
  let c = RIDE.get(r);
  if (c) return c;
  const S2 = r * 2 + 4;
  c = document.createElement('canvas');
  c.width = c.height = S2;
  const g = c.getContext('2d'), m = S2 / 2;
  const fill = g.createRadialGradient(m - r * 0.3, m - r * 0.35, r * 0.1, m, m, r);
  fill.addColorStop(0, 'rgba(255,255,255,0.10)'); fill.addColorStop(0.7, 'rgba(170,236,255,0.16)'); fill.addColorStop(1, 'rgba(120,214,255,0.42)');
  g.fillStyle = fill; g.beginPath(); g.arc(m, m, r, 0, TAU); g.fill();
  const cols = ['rgba(255,150,220,0.55)', 'rgba(255,236,140,0.5)', 'rgba(140,255,200,0.5)', 'rgba(120,200,255,0.6)'];
  g.lineWidth = Math.max(1, r * 0.06);
  cols.forEach((cl, i) => { g.strokeStyle = cl; g.beginPath(); g.arc(m, m, r - g.lineWidth * 0.5, 0.15 * Math.PI + i * 0.32, 0.15 * Math.PI + i * 0.32 + 0.4); g.stroke(); });
  g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = 1;
  g.beginPath(); g.arc(m, m, r - 0.5, 0.95 * Math.PI, 1.75 * Math.PI); g.stroke();
  g.fillStyle = 'rgba(255,255,255,0.85)';
  g.beginPath(); g.ellipse(m - r * 0.42, m - r * 0.45, r * 0.26, r * 0.13, -0.75, 0, TAU); g.fill();
  g.beginPath(); g.arc(m + r * 0.45, m + r * 0.42, Math.max(0.8, r * 0.06), 0, TAU); g.fill();
  RIDE.set(r, c);
  return c;
}
export function drawSoapBubble(ctx, x, y, r, sq = 0) {
  const c = rideBubble(r);
  const w = c.width * (1 + sq * 0.12), h = c.height * (1 - sq * 0.1);
  ctx.drawImage(c, Math.round(x - w / 2), Math.round(y - h / 2), Math.round(w), Math.round(h));
}

// ------------------------------------------------------------------------------------------------ the 2D fallback
function flatFrame(size) {
  const s = size, w = Math.ceil(CELL_W * s), h = Math.ceil(CELL_H * s);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  const X = (x) => w / 2 + (x - C0[0]) * s, Y = (y) => h / 2 - (y - C0[1]) * s;
  g.fillStyle = '#7a5c2a';
  g.beginPath(); g.moveTo(X(-0.86), Y(0.39)); g.lineTo(X(-1.32), Y(0.85)); g.lineTo(X(-1.36), Y(-0.05)); g.closePath(); g.fill();
  g.beginPath(); g.moveTo(X(-0.6), Y(0.75)); g.lineTo(X(0.3), Y(1.22)); g.lineTo(X(0.32), Y(0.9)); g.closePath(); g.fill();
  const body = g.createLinearGradient(0, Y(1), 0, Y(-0.05));
  body.addColorStop(0, '#5a4920'); body.addColorStop(0.5, '#a37a34'); body.addColorStop(1, '#f0d68e');
  g.fillStyle = body;
  g.beginPath(); g.ellipse(X(0.08), Y(0.47), 0.95 * s, 0.52 * s, 0, 0, TAU); g.fill();
  g.fillStyle = '#f08a68'; g.beginPath(); g.ellipse(X(1.0), Y(0.32), 0.12 * s, 0.09 * s, 0, 0, TAU); g.fill();
  g.fillStyle = '#fdfbf3'; g.beginPath(); g.arc(X(0.55), Y(0.85), EYE_R * s, 0, TAU); g.fill();
  const F = {
    eyes: [{ p: [X(0.58), Y(0.86)], R: EYE_R * s, nx: 0.3, ny: -0.2, nz: 0.8, side: 1 }, { p: [X(0.5), Y(0.88)], R: EYE_R * s, nx: 0.3, ny: -0.2, nz: -0.5, side: -1 }],
    cheeks: [[X(0.7), Y(0.5)], [X(0.6), Y(0.5)]], cheekZ: [0.7, -0.3], mouth: [X(1.04), Y(0.32)], lipL: [X(1.08), Y(0.28)], nose: [X(1.0), Y(0.48)], faceZ: 0.5,
    top: [X(0.5), Y(1.12)], head: [X(0.62), Y(0.62)], hand: [X(0.1), Y(0.2)], hand2: [X(0.1), Y(0.2)], tail: [X(-1.36), Y(0.39)], bottom: [X(0.05), Y(-0.12)], key: [X(-0.44), Y(0.5)], gloss: [X(0.3), Y(0.96)], lipGloss: [X(0.95), Y(0.38)], dy: 0, jaw: 0, puff: 0,
  };
  finishCell(c, 0, 0, w, h, GROUPER_OUTLINE(s), F);
  return { canvas: c, cw: w, ch: h, cols: 1, n: 1, frames: [F], size, anim: 'flat', lv: 0 };
}
const FLAT = new Map();

// ------------------------------------------------------------------------------------------------ drawGrouper
export function pointBucket(ex, ey) { return clamp(Math.round(Math.atan2(-ey, Math.max(1, ex)) / (Math.PI / 6)) + 3, 0, 6); }

// A stiff plastic squash spring per toy id (kicked by vertical acceleration, animation changes and each jaw snap).
const JIG = new Map();
function jiggle(id, t, x, y, anim, lv) {
  let j = JIG.get(id);
  if (!j || t < j.t - 1 || t - j.t > 1) { j = { t, x, y, vy: 0, s: 0, v: 0, anim, lv }; JIG.set(id, j); if (JIG.size > 40) JIG.delete(JIG.keys().next().value); }
  const dt = clamp(t - j.t, 0, 0.05);
  if (dt > 0) {
    const vy = (y - j.y) / dt, ay = (vy - j.vy) / Math.max(dt, 1 / 60);
    let f = -260 * j.s - 12 * j.v + clamp(-ay * 0.0008, -5, 5);
    if (anim !== j.anim) { j.v += anim === 'flop' ? -1.6 : anim === 'surprised' ? 2 : 0.9; j.anim = anim; }
    if (lv !== j.lv) { j.v += (lv > j.lv ? -0.5 : 0.35); j.lv = lv; }
    j.v += f * dt; j.s = clamp(j.s + j.v * dt, -0.12, 0.12);
    j.vy = vy;
  }
  j.t = t; j.x = x; j.y = y;
  return j;
}

// per-toy scratch canvases: the composited frame (body + pixel face) and the low-res face layer
const COMP = new Map();
function scratch(id, w, h) {
  let c = COMP.get(id);
  if (!c) {
    c = { a: document.createElement('canvas'), f: document.createElement('canvas') };
    try { c.f.getContext('2d', { willReadFrequently: true }); } catch { /* fine */ }
    COMP.set(id, c); if (COMP.size > 24) COMP.delete(COMP.keys().next().value);
  }
  if (c.a.width !== w || c.a.height !== h) { c.a.width = w; c.a.height = h; }
  return c;
}

const talkLevel = (talk, nl) => (nl <= 1 || !(talk > 0.22) ? 0 : nl === 2 ? 1 : talk > 0.66 ? 2 : 1);

export function drawGrouper(ctx, o = {}) {
  const size = grouperSize(o.size ?? 40);
  const view = o.view === 'front' ? 'front' : 'side';
  let anim = GROUPER_ANIMS[o.anim] ? o.anim : GROUPER_ALIAS[o.anim] || 'idle';
  const t = o.t ?? 0, facing = (o.facing ?? 1) < 0 ? -1 : 1, k = o.k ?? 1, tilt = o.tilt || 0;
  let x = o.x ?? 0, y = o.y ?? 0;
  const id = o.id ?? 'grouper';
  // pointing: elevation bucket from the target (in the facing frame, tilt removed)
  let bucket = 0;
  if (anim === 'point') {
    if (o.point) {
      const dx = (o.point[0] - x) * facing, dy = o.point[1] - y;
      const c = Math.cos(-tilt * facing), s = Math.sin(-tilt * facing);
      bucket = pointBucket(dx * c - dy * s, dx * s + dy * c);
    } else bucket = 4;
  }
  const lv = talkLevel(o.talk || 0, JAW_LV(GROUPER_ANIMS[anim]));
  let sh = null;
  if (lpAvailable()) { pump(); sh = sheet(anim, size, view, lv, false); }
  if (!sh || !sh.canvas) {
    sh = FLAT.get(size) || (FLAT.set(size, flatFrame(size)), FLAT.get(size));
    anim = 'flat';
  }
  const A = GROUPER_ANIMS[sh.anim] || { n: 1, dur: 1 };
  const ph = o.phase != null ? o.phase : t / A.dur;
  let fi = ((Math.floor(ph * A.n) % A.n) + A.n) % A.n;
  if (sh.anim === 'point') fi += bucket * A.n;
  fi = Math.min(fi, sh.n - 1);
  const F = sh.frames[fi];
  const sk = (k * size) / sh.size; // the stand-in sheet may be another size
  const cw = sh.cw, ch = sh.ch;
  // it floats: a gentle bob (and, sitting on something, a little gap under it)
  const hov = o.hover === false ? 0 : Math.sin(t * 1.9 + (id.length % 5)) * size * k * 0.035;
  if (o.base === 'bottom') y -= (F.bottom[1] - ch / 2) * sk + size * k * 0.12;
  y += hov;
  const lift = (F.dy || 0) * sh.size * sk;
  const J = jiggle(id, t, x, y, sh.anim, sh.lv || 0);
  const sqY = 1 + J.s, sqX = 1 - J.s * 0.6;
  const bY = F.bottom[1], cX = cw / 2;
  const ct = Math.cos(tilt), st = Math.sin(tilt);
  const toScreen = (p0) => {
    const p = [cX + (p0[0] - cX) * sqX, bY + (p0[1] - bY) * sqY];
    const lx = (p[0] - cw / 2) * facing * sk, ly = (p[1] - ch / 2) * sk - lift;
    return [x + lx * ct - ly * st, y + lx * st + ly * ct];
  };
  const a0 = ctx.globalAlpha;
  if (o.alpha != null) ctx.globalAlpha = a0 * o.alpha;
  const bot = toScreen([F.bottom[0], F.bottom[1] + lift / Math.max(0.01, sk)]);
  // a trickle of bubbles under it while it hovers in place
  const ride = clamp01(o.ride || 0);
  if (ride > 0.05) {
    const u = size * k / 40;
    for (let i = 0; i < 4; i++) {
      const q = (t * 0.7 + i * 0.25) % 1;
      drawAeroBubble(ctx, bot[0] + Math.sin(t * 3 + i * 2.1) * 3 * u + (i - 1.5) * 4 * u, bot[1] + (1 - q) * 16 * u, (1 + (i % 2) * 0.8) * u, ctx.globalAlpha * ride * Math.sin(q * Math.PI) * 0.8);
    }
  }
  // ---- composite the frame: voxel body + a pixel-art face drawn at voxel resolution
  const q = Math.max(1, GROUPER_VOXEL * sh.size);
  const SC = scratch(id, cw, ch);
  const g = SC.a.getContext('2d');
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, cw, ch);
  g.drawImage(sh.canvas, (fi % sh.cols) * cw, Math.floor(fi / sh.cols) * ch, cw, ch, 0, 0, cw, ch);
  const fw = Math.ceil(cw / q), fh = Math.ceil(ch / q);
  if (SC.f.width !== fw || SC.f.height !== fh) { SC.f.width = fw; SC.f.height = fh; }
  const gf = SC.f.getContext('2d');
  gf.setTransform(1, 0, 0, 1, 0, 0);
  gf.clearRect(0, 0, fw, fh);
  gf.setTransform(1 / q, 0, 0, 1 / q, 0, 0);
  FPX = q;
  const state = faceState(id, t, sh.anim);
  let look = null;
  if (o.lookAt) {
    const hd = toScreen(F.head);
    look = [(o.lookAt[0] - hd[0]) * facing, o.lookAt[1] - hd[1]];
  }
  drawFace(gf, F, { mood: o.mood, talk: o.talk, t, look, blink: o.blink, anim: sh.anim }, sh.size, state);
  crisp(gf, fw, fh);
  gf.setTransform(1 / q, 0, 0, 1 / q, 0, 0);
  drawGloss(gf, F, sh.size);
  g.imageSmoothingEnabled = false;
  g.drawImage(SC.f, 0, 0, fw * q, fh * q);
  // ---- draw it: a stiff plastic squash about the bottom
  ctx.save();
  ctx.translate(Math.round(x), Math.round(y));
  if (tilt) ctx.rotate(tilt);
  ctx.translate(0, -Math.round(lift));
  ctx.scale(facing * sk, sk);
  ctx.translate(-cw / 2, -ch / 2);
  const smooth = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = sk < 0.99;
  if (Math.abs(J.s) < 0.003) ctx.drawImage(SC.a, 0, 0);
  else ctx.drawImage(SC.a, 0, 0, cw, ch, cX - cX * sqX, bY - bY * sqY, cw * sqX, ch * sqY);
  ctx.imageSmoothingEnabled = smooth;
  ctx.restore();
  // a bubble on its lips (thrilled), a slow snore bubble (asleep)
  const mouth = toScreen(F.mouth);
  const nb = clamp01(o.noseBubble || 0);
  if (sh.anim === 'sleep' || o.mood === 'sleep') {
    const r = size * k * (0.06 + 0.1 * (0.5 + 0.5 * Math.sin(t * 1.9)));
    drawSoapBubble(ctx, mouth[0] + facing * r * 0.9, mouth[1] - r * 0.2, r, 0);
  } else if (nb > 0.02 && F.faceZ > -0.3) {
    const r = size * k * 0.1 * nb;
    drawSoapBubble(ctx, mouth[0] + facing * r * 1.1 + Math.sin(t * 3.1) * r * 0.15, mouth[1] - r * 0.6 - Math.abs(Math.sin(t * 3.1)) * r * 0.25, r, 0);
  }
  ctx.globalAlpha = a0;
  const pts = [F.top, F.bottom, F.tail, F.head, F.mouth].map(toScreen);
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const rx0 = Math.min(...xs) - size * k * 0.08, ry0 = Math.min(...ys) - size * k * 0.06;
  return {
    head: toScreen(F.head), top: toScreen(F.top), mouth, nose: toScreen(F.nose), hand: toScreen(F.hand),
    tail: toScreen(F.tail), bottom: bot, center: [x, y], key: toScreen(F.key),
    rect: { x: rx0, y: ry0, w: Math.max(...xs) - rx0 + size * k * 0.08, h: Math.max(...ys) - ry0 + size * k * 0.08 },
  };
}

// A stream of tiny glossy bubbles flowing from the pointing fin to the target (makes the gesture unmistakable).
export function drawPointStream(ctx, from, to, t, u = 1) {
  const dx = to[0] - from[0], dy = to[1] - from[1], d = Math.hypot(dx, dy);
  if (d < 18 * u) return;
  const stop = Math.min(150 * u, Math.max(10 * u, d - 16 * u)), n = Math.max(3, Math.min(9, Math.round(stop / (16 * u))));
  const a0 = ctx.globalAlpha;
  for (let i = 0; i < n; i++) {
    const k = ((i + (t * 1.6) % 1) / n);
    const L = k * stop, wob = Math.sin(t * 5 + i * 1.7) * 2 * u;
    const x = from[0] + (dx / d) * L - (dy / d) * wob, y = from[1] + (dy / d) * L + (dx / d) * wob;
    const r = (1.2 + 1.6 * Math.sin(k * Math.PI)) * u;
    drawAeroBubble(ctx, x, y, r, a0 * Math.min(1, k * 4) * (1 - k * 0.5));
  }
  ctx.globalAlpha = a0;
  if (Math.sin(t * 7) > 0.2) {
    ctx.fillStyle = '#ffffff';
    const s2 = Math.round(1 + u);
    ctx.fillRect(Math.round(from[0]) - s2, Math.round(from[1]), s2 * 2 + 1, 1);
    ctx.fillRect(Math.round(from[0]), Math.round(from[1]) - s2, 1, s2 * 2 + 1);
  }
}

// ------------------------------------------------------------------------------------------------ the floater
// A screen-space guide: smooth physics (tail-beat thrust, water drag, a buoyant float bob), heading tilt, bubbles.
const MOOD_EMOTE = { surprised: ['surprised', 0.9], scared: ['scared', 0.8], sad: ['sad', 1.6], cry: ['sad', 2], love: ['wiggle', 1.2], laugh: ['laugh', 1.2] };
export class GrouperGuide {
  constructor(o = {}) {
    this.x = o.x ?? -80; this.y = o.y ?? 200; this.vx = 0; this.vy = 0;
    this.tx = this.x; this.ty = this.y;
    this.size = o.size || 40;
    this.audio = o.audio || null;
    this.id = o.id || 'guide';
    this.facing = 1; this.tilt = 0;
    this.pointP = null;
    this.emoteA = null; this.emoteT = 0; this.emoteDur = 0;
    this.swimPh = 0; this.animT = 0; this.t = 0;
    this.ride = 0; this.settleT = 0; this.idleT = 0;
    this.blowT = 4 + Math.random() * 3; this.blowB = null;
    this.lookT = 9 + Math.random() * 6;
    this.bubbles = []; this.drops = [];
    this.shy = [0, 0];
    this.trailT = 0;
    this.anim = 'idle';
    this.anchors = null;
    this.noseB = 0;
    this.lastMood = null;
  }

  get speed() { return Math.hypot(this.vx, this.vy); }
  get u() { return this.size / 40; }
  get settled() { return Math.hypot(this.tx - this.x, this.ty - this.y) < 16 * this.u && this.speed < 40 * this.u; }

  goTo(x, y, o = {}) {
    this.tx = x; this.ty = y;
    if (o.snap) { this.x = x; this.y = y; this.vx = this.vy = 0; }
    return this;
  }
  pointAt(p) { this.pointP = p ? [p[0], p[1]] : null; return this; }
  emote(anim, secs) {
    anim = GROUPER_ANIMS[anim] ? anim : GROUPER_ALIAS[anim];
    if (!GROUPER_ANIMS[anim]) return this;
    this.emoteA = anim; this.emoteT = 0;
    this.emoteDur = secs ?? GROUPER_ANIMS[anim].dur * (anim === 'clap' ? 4 : anim === 'wiggle' || anim === 'laugh' ? 3 : anim === 'cheer' ? 2 : 1);
    if (anim === 'surprised' || anim === 'spin') { try { this.audio?.play?.('bubble', { vol: 0.3, pitch: anim === 'surprised' ? 0.8 : 1.4 }); } catch (e) { /* audio is optional */ } }
    return this;
  }
  popRide() { this.ride = 0; }

  update(dt, env = {}) {
    dt = clamp(dt || 0, 0, 0.05);
    const u = this.u, W = env.W || 960, H = env.H || 540;
    this.t += dt; this.animT += dt;
    // shy away from the cursor when resting
    let shx = 0, shy = 0;
    const cur = env.cursor;
    if (cur && this.speed < 80 * u && !env.noShy) {
      const dx = this.x - cur[0], dy = this.y - cur[1], d = Math.hypot(dx, dy) || 1, R = 50 * u;
      if (d < R) { const k = (R - d) / R; shx = (dx / d) * k * 44 * u; shy = (dy / d) * k * 30 * u; }
    }
    this.shy[0] += (shx - this.shy[0]) * Math.min(1, dt * 3);
    this.shy[1] += (shy - this.shy[1]) * Math.min(1, dt * 3);
    const m = 30 * u;
    const gx = clamp(this.tx + this.shy[0], m, W - m), gy = clamp(this.ty + this.shy[1], m, H - m * 0.6);
    // arrive steering with tail-beat thrust and water drag
    const dx = gx - this.x, dy = gy - this.y, d = Math.hypot(dx, dy);
    const maxV = 250 * u * (env.fast ? 1.5 : 1);
    const want = Math.min(maxV, d * 2.7);
    const dvx = d > 0.5 ? (dx / d) * want : 0, dvy = d > 0.5 ? (dy / d) * want : 0;
    const swimming = d > 14 * u || this.speed > 40 * u;
    this.swimPh += dt * (swimming ? 1.2 + this.speed / (140 * u) : 0.4);
    const stroke = swimming ? 0.5 + 1.0 * Math.max(0, Math.sin(this.swimPh * TAU)) ** 2 : 1;
    const gain = 4.2 * stroke;
    this.vx += (dvx - this.vx) * Math.min(1, gain * dt);
    this.vy += (dvy - this.vy) * Math.min(1, gain * dt);
    const drag = Math.exp(-0.5 * dt);
    this.vx *= drag; this.vy *= drag;
    this.x += this.vx * dt; this.y += this.vy * dt;
    const sp = this.speed;
    // facing / heading tilt
    if (sp > 45 * u && Math.abs(this.vx) > 22 * u) this.facing = this.vx > 0 ? 1 : -1;
    else if (this.pointP && sp < 45 * u && Math.abs(this.pointP[0] - this.x) > 12 * u) this.facing = this.pointP[0] > this.x ? 1 : -1;
    const tt = sp > 45 * u ? clamp(Math.atan2(this.vy, Math.abs(this.vx) + 20 * u) * 0.75, -0.55, 0.55) * this.facing : 0;
    this.tilt += (tt - this.tilt) * Math.min(1, dt * 6);
    // emotes
    if (this.emoteA) { this.emoteT += dt; if (this.emoteT > this.emoteDur) this.emoteA = null; }
    // the animation
    let anim = 'idle';
    if (this.emoteA) anim = this.emoteA;
    else if (sp > 50 * u) anim = 'swim';
    else if (this.pointP && d < 40 * u) anim = 'point';
    else if (this.blowB && this.blowB.grow) anim = 'blow';
    if (anim !== this.anim) { this.anim = anim; this.animT = 0; }
    // bubble trail from the tail
    this.trailT -= dt;
    if (sp > 45 * u && this.trailT <= 0 && this.anchors) {
      this.trailT = 0.035 + Math.random() * 0.05;
      const tl = this.anchors.tail;
      this.bubbles.push({ x: tl[0] + (Math.random() - 0.5) * 6 * u, y: tl[1] + (Math.random() - 0.5) * 6 * u, vx: -this.vx * 0.12, vy: -10 - Math.random() * 25, r: (1 + Math.random() * 2.4) * Math.max(0.8, u), t: 0, life: 0.8 + Math.random() * 1.0, ph: Math.random() * 9 });
    }
    // resting: blows a bubble now and then, and sometimes swivels its head round to stare at you
    this.idleT = anim === 'idle' && !env.talk ? this.idleT + dt : 0;
    this.blowT -= dt; this.lookT -= dt;
    if (this.lookT <= 0 && this.idleT > 2.5 && !this.blowB && !this.pointP) { this.emote('look'); this.lookT = 10 + Math.random() * 9; }
    if (this.blowT <= 0 && this.idleT > 2 && !this.blowB) { this.blowB = { r: 0.5, grow: true, t: 0 }; this.blowT = 6 + Math.random() * 6; }
    if (this.blowB) {
      const B = this.blowB;
      B.t += dt;
      if (B.grow) {
        B.r = Math.min(5.5 * u, B.r + dt * 5 * u);
        if (B.t > 1.15 || (anim !== 'blow' && B.t > 0.3)) {
          B.grow = false;
          const m2 = this.anchors?.mouth || [this.x, this.y];
          this.bubbles.push({ x: m2[0] + this.facing * B.r, y: m2[1], vx: this.facing * 14, vy: -18, r: B.r, t: 0, life: 2.4, ph: 0, big: true });
          this.blowB = null;
        }
      }
    }
    // a lip bubble when it is thrilled; a trickle of bubbles under it while it hovers in place
    this.noseB += ((env.excited || anim === 'clap' || anim === 'wiggle') && sp < 40 * u ? 1 : -1) * dt * 3;
    this.noseB = clamp01(this.noseB);
    this.settleT = sp < 22 * u ? this.settleT + dt : 0;
    this.ride += ((this.settleT > 0.6 && !env.noRide ? 1 : 0) - this.ride) * Math.min(1, dt * 3);
    // particles
    for (const b of this.bubbles) { b.t += dt; b.vy -= 28 * dt; b.x += (b.vx + Math.sin(b.t * 7 + b.ph) * 8) * dt; b.y += b.vy * dt; b.vx *= Math.exp(-dt * 2); }
    for (const b of this.bubbles) if (b.t > b.life) for (let i = 0; i < 4; i++) { const a = i * 1.57 + 0.6; this.drops.push({ x: b.x, y: b.y, vx: Math.cos(a) * 30, vy: Math.sin(a) * 30, t: 0, life: 0.18 }); }
    this.bubbles = this.bubbles.filter((b) => b.t <= b.life && b.y > -10);
    if (this.bubbles.length > 60) this.bubbles.splice(0, this.bubbles.length - 60);
    for (const p of this.drops) { p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 120 * dt; }
    this.drops = this.drops.filter((p) => p.t < p.life);
  }

  rect() {
    const r = this.anchors?.rect;
    if (r) return { ...r };
    const s = this.size;
    return { x: this.x - s * 1.25, y: this.y - s * 0.9, w: s * 2.5, h: s * 1.6 };
  }
  hit(x, y) { const r = this.rect(); return x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h; }

  drawBubbles(ctx) {
    for (const b of this.bubbles) {
      const a = clamp01((b.life - b.t) / 0.3) * clamp01(b.t * 6);
      if (b.big) drawSoapBubble(ctx, b.x, b.y, b.r);
      else drawAeroBubble(ctx, b.x, b.y, b.r, a);
    }
    ctx.fillStyle = '#e8fbff';
    for (const p of this.drops) { const a = ctx.globalAlpha; ctx.globalAlpha = a * (1 - p.t / p.life); ctx.fillRect(Math.round(p.x), Math.round(p.y), 1, 1); ctx.globalAlpha = a; }
  }

  draw(ctx, o = {}) {
    const t = o.t ?? this.t;
    // mood changes kick off a reaction (puff up when surprised, droop when sad ...)
    if (o.mood !== this.lastMood) {
      const e = MOOD_EMOTE[o.mood];
      if (e && this.lastMood !== null && !this.emoteA && this.speed < 60 * this.u) this.emote(e[0], e[1]);
      this.lastMood = o.mood;
    }
    const bob = Math.sin(this.t * 1.7) * 3 * this.u * (this.speed < 60 * this.u ? 1 : 0.3);
    const a0 = ctx.globalAlpha;
    ctx.globalAlpha = a0 * (o.alpha ?? 1);
    this.drawBubbles(ctx);
    const anim = GROUPER_ANIMS[o.anim] ? o.anim : GROUPER_ALIAS[o.anim] || this.anim;
    const phase = anim === 'swim' ? this.swimPh : this.animT / (GROUPER_ANIMS[anim]?.dur || 1);
    const A = drawGrouper(ctx, {
      x: this.x, y: this.y + bob, t, size: this.size, facing: this.facing, tilt: this.tilt, anim, phase, hover: false,
      point: this.pointP, mood: o.mood, talk: o.talk, lookAt: o.lookAt || this.pointP, ride: this.ride, noseBubble: this.noseB, id: this.id,
    });
    if (A && anim === 'point' && this.pointP && o.stream !== false) drawPointStream(ctx, A.hand, this.pointP, this.t, this.u);
    // the bubble it is blowing
    if (this.blowB && A) drawSoapBubble(ctx, A.mouth[0] + this.facing * this.blowB.r * 0.9, A.mouth[1] - this.blowB.r * 0.2, this.blowB.r);
    ctx.globalAlpha = a0;
    this.anchors = A;
    return A;
  }
}
