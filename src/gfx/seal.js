// Bubbles, the guide [seal21]: a round, bubbly BALL of a seal in high-resolution VOXEL art (after the user: "make
// the seal bubbly and like a circle but fat and wears glasses"). The whole seal is one fat, squishy, nearly perfect
// sphere (a mochi ball sitting on a softly flattened bottom) whose front IS the face: no neck, no separate head.
// Soft grey-white plush fur dappled with grey spots, a cream tummy, a clean white face mask with puffy muzzle pads
// and whisker dots, a tiny dark nose, tiny side flippers and a little tail flipper pair poking out of the ball,
// prominent round black glasses and a small tilted candy-striped aqua / white VOXEL PARTY CONE HAT with a pink
// pom-pom. Each pose is modelled as a smooth painted mesh, VOXELISED (src/fish/voxelize.js: fine voxels, soft baked
// AO) and rendered with plush shading, a glossy blocky voxel SPECULAR PATCH on the upper ball (baked per frame,
// fixed to the light, so it stays put while the ball rolls) and a crisp black ink outline. The big shiny eyes (two
// catchlights), rosy blush, the tiny 'w' smile / talking mouth and the lens glints are drawn live on top AT VOXEL
// RESOLUTION (a low-res layer scaled up crisp), so blinking, gaze and lip-sync cost nothing. Facial "head" motions
// slide the face around the ball (rotations about the ball centre), so the silhouette always stays round.
// It BOUNCES like a ball: idle is a soft hop with contact squash and rising / falling stretch (the hop height is
// evaluated continuously, the squash per frame), cheer is a big bounce, flop squishes it flat, spin is a forward
// roll; a per-seal squash spring (kicked by acceleration, landings, animation changes and talking) adds jiggle, and
// the frame is drawn in voxel rows with a ripple and a tummy wobble. Little pixel bubbles now and then bud off its
// back, float up and pop.
//
// Frames are CACHED: the posed voxel meshes of an animation are built once (compact faces) and every cycle is
// rendered once per device size into one sprite sheet (lowpoly renderSheet: one GL pass + one readback), at most one
// new sheet per frame (otherwise the nearest cached sheet stands in). Sheets are baked at DEVICE resolution (the
// context's transform scale), so the hi-res UI layer gets crisp voxels and a crisp 1 logical px outline.
//
//   SEAL_INFO                          {id: 'seal', name: 'Bubbles', role, desc, color, h}
//   SEAL_ANIMS                         idle swim wiggle wave point flop spin worried clap think blow cheer sad sleep
//   SEAL_ALIAS                         talk, laugh, excited, happy, love, surprised, ride, bend, sleepy, celebrate ...
//   drawSeal(ctx, o) -> anchors        o: {x, y (body centre; o.base = 'bottom' -> y is the bottom; o.anchor = 'head'
//       -> x, y is the head centre), t, size (logical px per model unit), k (extra draw scale), facing (1 right /
//       -1 left), anim, phase (0..1 override), point: [sx, sy] (the flipper points there), tilt (rad), mood, talk 0..1,
//       lookAt [sx, sy], blink, ride 0..1 (the soap bubble under it), noseBubble 0..1, view: 'side' | 'front'
//       (portrait), id (per-seal state: blink, gaze, jiggle, floating bubbles), alpha, floaters (false = none)}
//     anchors: {head, top (hat tip), mouth, nose, hand (pointing flipper tip), tail, bottom, center, rect {x, y, w, h}}
//   warmSeal(size, anims, view)         pre-render sheets (call from a loading step)
//   sealReady(size, view)               the idle sheet exists
//   sealSize(s)                         the logical size bucket
//   drawSoapBubble(ctx, x, y, r, sq)    a pixel-art soap bubble (the one it rides on)
//   drawPointStream(ctx, from, to, t, u) tiny pixel bubbles flowing from the pointing flipper to the target
//   new SealGuide({x, y, size, audio, id})  a screen-space swimmer with smooth physics:
//       .goTo(x, y, {snap}) .pointAt([sx, sy] | null) .emote(anim, secs) .update(dt, {W, H, cursor, talk})
//       .draw(ctx, {t, talk, mood, lookAt, alpha}) -> anchors .rect() .hit(x, y) .settled .speed .anim

import { LPMesh, renderSheet, lpProject, lpAvailable, T4 } from './lowpoly.js';
import { voxelizeMesh } from '../fish/voxelize.js';
import { clamp, clamp01, lerp, TAU } from '../core/math.js';
import { drawAeroBubble } from '../ui/aero.js';
import { HI, HI_ON } from './hires.js';

export const SEAL_INFO = {
  id: 'seal', name: 'Bubbles', role: 'Guide', color: '#bfefff', h: 56,
  desc: 'A round, bubbly, very squishy ball of a plush seal pup in a party hat and round glasses who bounces everywhere, blows bubbles and knows every fish in the sea (by smell).',
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
const sstep = (a, b, v) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };

// ------------------------------------------------------------------------------------------------ palette
// soft grey-white plush fur dappled with grey spots, a cream belly, white muzzle, slate flippers
const C = {
  fur: rgb('#e8ecf3'), furMid: rgb('#d9dee8'), belly: rgb('#fbf9f4'), back: rgb('#cdd3df'),
  spot: rgb('#b9c0cd'), spotD: rgb('#9aa3b4'), muzzle: rgb('#ffffff'), chin: rgb('#f4f2ee'), whisk: rgb('#717689'),
  flip: rgb('#a2a9b6'), flipTip: rgb('#7c8391'), nose: rgb('#2b2733'), noseHi: rgb('#5a5468'),
  hatA: rgb('#33c4e6'), hatAD: rgb('#1d9fca'), hatB: rgb('#f8fdff'), pom: rgb('#ff8db4'), pomD: rgb('#f2679a'), pomL: rgb('#ffc2d8'),
  glass: rgb('#252b3e'), glassHi: rgb('#56618a'),
};
// the look (lowpoly shader options): soft plush shading with a glossy Aero rim and sky sheen
const LOOK = { ambient: 0.76, spec: 0.05, shine: 14, soft: 0.5, softColor: '#ffd8e0', rim: 0.32, rimColor: '#c4f2ff', env: 0.04, iri: 0.02, sky: '#f2fdff', ground: '#a8d4ee', light: [-0.42, 0.72, 0.75] };
// voxel edge in model units (the ball is ~1.7 units across: ~42 voxels)
export const SEAL_VOXEL = 0.04;

// ------------------------------------------------------------------------------------------------ geometry
// Model space: x forward (the face), y up, z toward the near (+z) side. ONE fat ball (BALL: a sphere, a hair wider
// than tall, its bottom softly flattened where it sits) whose front is the face: tiny flippers poke out of its lower
// sides, a little tail flipper pair out of its lower back and the party hat sits tilted on top.
const BALL = { a: 0.84, cy: 0.82, hy: 0.8, hz: 0.85, flat: 0.11 };
const X0 = -BALL.a, X1 = BALL.a;
const BODY_SEG = 34, BODY_ROWS = 34;
const PIV = [0, 0.07, 0];              // squash pivot (bottom centre)
const HPIV = [0, BALL.cy, 0];          // the face slides around the ball centre
const HEAD_C = [0.6, 0.96, 0];         // "head" anchor: the middle of the face
const EYE_R = 0.152;
const FACE = { eyeX: 0.655, eyeA: 1.0, nose: [0.852, 0.872, 0], mouth: [0.85, 0.71, 0], muzzle: [0.79, 0.775, 0.088], cheekX: 0.52, cheekA: 1.5 };
const SHOULDER = [0.02, 0.32, 0.6];     // the flippers sit on the sides of the ball (at the silhouette in the side view)
const HIP = [-0.58, 0.3, 0.15];
const C0 = [0, 0.86, 0];               // sprite centre (model point at the sheet cell centre; rolls turn about it)
const CELL_W = 3.1, CELL_H = 3.1;      // cell size in model units
// party hat: a small cone sitting on top of the ball, tilted jauntily (to the right in the side view)
const HAT = { axis: norm([0.12, 1, -0.3]), sink: 0.93, R: 0.19, H: 0.44, pom: 0.08 };
const hatBase = () => add([0.0, BALL.cy, 0], scl(norm([0.1, 1, -0.06]), BALL.hy * HAT.sink));
const hatApex = () => add(hatBase(), scl(HAT.axis, HAT.H));

// rest ball section at x: [centre y, half height, half width]
function loafAt(x) {
  const t = clamp(x / BALL.a, -1, 1), g = Math.sqrt(Math.max(0, 1 - t * t));
  return [BALL.cy, Math.max(0.01, BALL.hy * g), Math.max(0.01, BALL.hz * g)];
}
// surface point of the rest ball at x and section angle a (0 = top, PI/2 = +z flank, PI = bottom); round sections,
// the bottom softly flattened where the ball sits (mochi)
function loafPt(x, a) {
  const [cy, hy, hz] = loafAt(x);
  const c = Math.cos(a), s = Math.sin(a);
  let y = cy + c * hy;
  if (y < BALL.flat) y = BALL.flat - (BALL.flat - y) * 0.4;
  return [x, y, s * hz];
}
function loafN(x, a) {
  const e = 0.01;
  const p0 = loafPt(x, a), px = loafPt(x + e, a), pa = loafPt(x, a + e);
  let n = norm(cross(sub(px, p0), sub(pa, p0)));
  const out = sub(p0, [0, BALL.cy, 0]);
  if (dot(n, out) < 0) n = scl(n, -1);
  return n;
}

// A tiny builder with PER-VERTEX colours (the painted look), producing the shared renderer's LPMesh (11 floats per
// vertex: position, flat normal, colour, uv).
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
// grid of rest points -> painted + deformed quads (rows i, columns j wrap)
function sheetMesh(mb, rows, paint, deform) {
  const col = rows.map((r) => r.map((p) => paint(p)));
  const pos = rows.map((r) => r.map((p) => deform(p)));
  for (let i = 0; i < rows.length - 1; i++) {
    const n = rows[i].length;
    for (let j = 0; j < n; j++) {
      const j2 = (j + 1) % n;
      triV(mb, pos[i][j], pos[i][j2], pos[i + 1][j2], col[i][j], col[i][j2], col[i + 1][j2]);
      triV(mb, pos[i][j], pos[i + 1][j2], pos[i + 1][j], col[i][j], col[i + 1][j2], col[i + 1][j]);
    }
  }
}
// an end cap fan (closing a ring) toward point c; flip reverses the winding
function capFan(mb, ring, c, paint, deform, flip) {
  const pc = deform(c), cc = paint(c);
  const P = ring.map((p) => deform(p)), K = ring.map((p) => paint(p));
  for (let j = 0; j < ring.length; j++) {
    const j2 = (j + 1) % ring.length;
    if (flip) triV(mb, pc, P[j], P[j2], cc, K[j], K[j2]);
    else triV(mb, pc, P[j2], P[j], cc, K[j2], K[j]);
  }
}
// ellipsoid rows (top pole to bottom pole) in local space
function ellRows(c, r, seg, rings) {
  const rows = [];
  for (let i = 0; i <= rings; i++) {
    const th = (i / rings) * Math.PI, row = [];
    for (let j = 0; j < seg; j++) {
      const ph = (j / seg) * TAU;
      row.push([c[0] + Math.sin(th) * Math.cos(ph) * r[0], c[1] + Math.cos(th) * r[1], c[2] + Math.sin(th) * Math.sin(ph) * r[2]]);
    }
    rows.push(row);
  }
  return rows;
}

// ---- paint (rest positions -> colour): dappled plush fur
function vnoise(x, y, z) {
  const X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z), fx = x - X, fy = y - Y, fz = z - Z;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz);
  const L = (a, b, k) => a + (b - a) * k;
  return L(L(L(h3(X, Y, Z), h3(X + 1, Y, Z), u), L(h3(X, Y + 1, Z), h3(X + 1, Y + 1, Z), u), v),
    L(L(h3(X, Y, Z + 1), h3(X + 1, Y, Z + 1), u), L(h3(X, Y + 1, Z + 1), h3(X + 1, Y + 1, Z + 1), u), v), w);
}
function dapple(p, scale = 1) {
  return vnoise(p[0] * 8 * scale + 3.1, p[1] * 8 * scale, p[2] * 8 * scale + 7.7) * 0.7 + vnoise(p[0] * 19 * scale, p[1] * 19 * scale + 4.2, p[2] * 19 * scale) * 0.3;
}
function paintBody(p) {
  const up = clamp((p[1] - BALL.cy) / BALL.hy, -1, 1);
  let c = up < -0.25 ? mixC(C.fur, C.belly, clamp01((-up - 0.25) * 2)) : mixC(C.fur, C.back, clamp01(up - 0.1) * 0.75);
  c = mixC(c, C.furMid, clamp01((-p[0] - 0.2) / 0.6) * 0.5);
  // the face: a clean white mask on the front of the ball (no spots around the eyes and muzzle)
  const fd = Math.hypot((p[0] - 0.86) / 0.5, (p[1] - 0.92) / 0.42, p[2] / 0.62);
  const face = clamp01((1.2 - fd) / 0.35);
  c = mixC(c, C.belly, face * 0.75);
  const d = dapple(p);
  const th = 0.6 + 0.08 * clamp01(-up * 1.5) + face * 0.3;
  if (d > th) c = mixC(c, d > th + 0.07 ? C.spotD : C.spot, 0.7 - 0.35 * clamp01(-up));
  return lit(c, 1 + (h3(Math.round(p[0] * 25), Math.round(p[1] * 25), Math.round(p[2] * 25)) - 0.5) * 0.04);
}
// muzzle pads: white with three little grey whisker dots each
function paintMuzzle(q) {
  const sd = q[2] >= 0 ? 1 : -1;
  const c0 = [FACE.muzzle[0], FACE.muzzle[1], FACE.muzzle[2] * sd];
  let c = mixC(C.muzzle, C.chin, clamp01((0.72 - q[1]) * 8));
  for (const [dy, dz] of [[0.035, 0.035], [-0.01, 0.06], [0.0, 0.015]]) {
    if (Math.hypot(q[1] - (c0[1] + dy), q[2] - (c0[2] + dz * sd)) < 0.02 && q[0] > c0[0] + 0.025) c = C.whisk;
  }
  return c;
}
const paintChin = (q) => lit(mixC(C.muzzle, C.chin, 0.6), 1 + (h3(Math.round(q[0] * 30), Math.round(q[1] * 30), Math.round(q[2] * 30)) - 0.5) * 0.03);
const paintNose = (q) => (q[1] > FACE.nose[1] + 0.012 && q[0] > FACE.nose[0] + 0.01 ? C.noseHi : C.nose);
function paintFlip(t) { return (q) => { const c = mixC(C.flip, C.flipTip, clamp01((q[0] / t - 0.4) * 1.5)); return lit(c, dapple(q, 2) > 0.62 ? 0.9 : 1); }; }

// ---- the pose
// head: [nod (about z, + = nose up), yaw (about y), roll (about x, the cute head tilt)]
function P0() {
  return {
    yaw: -1.12, tilt: 0.2, rz: 0, sq: [1, 1, 1], bend: 0, wave: 0, wph: 0, side: 0,
    head: [0, 0, 0], hdy: 0, fl: [0.1, -0.5, 0.86], fr: [0.1, -0.5, -0.86], flLen: 1, frLen: 1,
    flTw: 0, frTw: 0, shN: 0, shF: 0, tail: 0.2, spread: 0.45, flap: 0, cheek: 0, dy: 0, belly: 0, closed: false,
  };
}

// how much a rest point follows the face (1 = the front of the ball, 0 = the back): the face's nods, turns and tilts
// are rotations about the ball centre, so the face slides around the ball and the silhouette stays round
function headW(p) { return sstep(-0.55, 0.45, p[0] / BALL.a); }
// body deformation: the face slides (weighted rotation about the centre), then the tummy squishes out, squash /
// stretch about the bottom, a little swim wave and sway
function bodyDeform(P) {
  const [sx, sy, sz] = P.sq;
  const [hn, hyw, hr] = P.head;
  const turn = hn || hyw || hr || P.hdy;
  return (p, wf) => {
    let q = p;
    const ww = wf ?? headW(p);
    if (ww > 0 && turn) {
      let v = sub(p, HPIV);
      v = rx(v, hr * ww); v = rz(v, hn * ww); v = ry(v, hyw * ww);
      q = add(add(HPIV, v), [0, P.hdy * ww, 0]);
    }
    if (P.belly) { // the round tummy squishes out sideways and a little forward, low down (mochi)
      const b = sstep(1.0, 0.15, Math.hypot(q[0] / 0.95, (q[1] - 0.22) / 0.62));
      q = [q[0] * (1 + P.belly * b * 0.55), q[1] - P.belly * b * 0.2 * Math.max(0, 0.45 - q[1]), q[2] * (1 + P.belly * b)];
    }
    let x = PIV[0] + (q[0] - PIV[0]) * sx, y = PIV[1] + (q[1] - PIV[1]) * sy, z = q[2] * sz;
    const u = q[0] - PIV[0];
    y += P.bend * u * u * 0.5;
    if (P.wave) y += P.wave * Math.sin(P.wph - q[0] * 3.0) * clamp01((0.2 - q[0]) / 1.0);
    if (P.side) z += P.side * Math.sign(u) * u * u * 0.6;
    return [x, y, z];
  };
}

// a flattened paddle along D of length L (broad-face hint T)
function paddle(mb, base, D, Thint, L, widths, thick, paint, twist = 0) {
  D = norm(D);
  let Wd = cross(D, norm(Thint));
  if (Math.hypot(Wd[0], Wd[1], Wd[2]) < 1e-3) Wd = cross(D, [0, 1, 0.01]);
  Wd = norm(Wd);
  let T = cross(Wd, D);
  if (twist) { const c = Math.cos(twist), s = Math.sin(twist); const W2 = add(scl(Wd, c), scl(T, s)); T = sub(scl(T, c), scl(Wd, s)); Wd = W2; }
  const seg = 8, n = widths.length;
  const rows = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1), row = [];
    for (let j = 0; j < seg; j++) {
      const a = (j / seg) * TAU;
      row.push([t * L, Math.cos(a) * thick[i], Math.sin(a) * widths[i]]);
    }
    rows.push(row);
  }
  const place = (q) => add(base, add(add(scl(D, q[0]), scl(T, q[1])), scl(Wd, q[2])));
  sheetMesh(mb, rows, paint, place);
  capFan(mb, rows[0], [-0.02, 0, 0], paint, place, false);
  capFan(mb, rows[n - 1], [L + 0.02, 0, 0], paint, place, true);
  return place([L + 0.02, 0, 0]);
}

// ---- round GLASSES: voxel rims floating just in front of each eye, a little bridge over the snout and temple arms
// running back along the sides of the head (rest space: they follow the head twist and squash)
const GLASS = { R: 0.205, tube: 0.024, lift: 0.045, armX: 0.2 };
const eyeRest = (sd) => loafPt(FACE.eyeX, FACE.eyeA * sd);
function tubeRows(pts, r, M = 6, closed = false) {
  const n = pts.length, rows = [];
  for (let i = 0; i < n; i++) {
    const a = closed ? pts[(i - 1 + n) % n] : pts[Math.max(0, i - 1)], b = closed ? pts[(i + 1) % n] : pts[Math.min(n - 1, i + 1)];
    const T = norm(sub(b, a));
    const b1 = norm(cross(T, Math.abs(T[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0]));
    const b2 = cross(T, b1), row = [];
    for (let j = 0; j < M; j++) { const f = (j / M) * TAU; row.push(add(pts[i], add(scl(b1, Math.cos(f) * r), scl(b2, Math.sin(f) * r)))); }
    rows.push(row);
  }
  if (closed) rows.push(rows[0]);
  return rows;
}
function lensOf(sd) {
  const q = eyeRest(sd), n = loafN(FACE.eyeX, FACE.eyeA * sd);
  const c = add(q, scl(n, GLASS.lift));
  const u = norm(cross(n, [0, 1, 0])), v = norm(cross(u, n));
  return { c, n, u, v };
}
function rimToward(L, dir) {
  const a = dot(dir, L.u), b = dot(dir, L.v), l = Math.hypot(a, b) || 1;
  return add(L.c, scl(add(scl(L.u, a / l), scl(L.v, b / l)), GLASS.R));
}
function addGlasses(mb, def) {
  const L = [lensOf(1), lensOf(-1)];
  const d1 = (p) => def(p, 1);
  const paint = (L0) => (q) => (q[1] > L0.c[1] + GLASS.R * 0.7 ? C.glassHi : C.glass);
  for (const Lk of L) {
    const ring = [];
    for (let i = 0; i < 24; i++) { const f = (i / 24) * TAU; ring.push(add(Lk.c, add(scl(Lk.u, Math.cos(f) * GLASS.R), scl(Lk.v, Math.sin(f) * GLASS.R)))); }
    sheetMesh(mb, tubeRows(ring, GLASS.tube, 6, true), paint(Lk), d1);
  }
  const a = rimToward(L[0], sub(L[1].c, L[0].c)), b = rimToward(L[1], sub(L[0].c, L[1].c));
  const k = [Math.max(a[0], b[0]) + 0.05, (a[1] + b[1]) / 2 + 0.03, 0];
  const br = [];
  for (let i = 0; i <= 8; i++) { const t = i / 8, s = 1 - t; br.push(add(add(scl(a, s * s), scl(k, 2 * s * t)), scl(b, t * t))); }
  sheetMesh(mb, tubeRows(br, GLASS.tube * 0.9, 6), () => C.glass, d1);
  for (const sd of [1, -1]) {
    const Lk = L[sd > 0 ? 0 : 1];
    const p0 = rimToward(Lk, [-0.6, 0.05, sd]);
    const yT = p0[1] - 0.01, pts = [p0];
    for (let i = 1; i <= 6; i++) {
      const x = lerp(p0[0] - 0.04, GLASS.armX, i / 6);
      let best = 0, bd = Infinity;
      for (let s = 0; s <= 48; s++) { const an = (s / 48) * Math.PI * 0.6 * sd; const d = Math.abs(loafPt(x, an)[1] - yT); if (d < bd) { bd = d; best = an; } }
      pts.push(add(loafPt(x, best), scl(loafN(x, best), GLASS.lift * 0.6)));
    }
    sheetMesh(mb, tubeRows(pts, GLASS.tube * 0.8, 5), () => C.glass, d1);
  }
}

// ---- the party hat: a small cone with spiral aqua / white candy stripes, a darker band at the brim and a fluffy
// pink pom-pom on the tip
function addHat(mb, def) {
  const ax = HAT.axis, base = hatBase();
  const u = norm(cross(ax, [0, 0, 1])), v = cross(u, ax);
  const d1 = (p) => def(p, 1);
  const N = 16, SEG = 18, rows = [];
  for (let i = 0; i <= N; i++) {
    const h = i / N, r = HAT.R * (1 - h) * (1 + 0.12 * Math.sin(h * Math.PI)) + 0.012, row = [];
    for (let j = 0; j < SEG; j++) { const f = (j / SEG) * TAU; row.push(add(add(base, scl(ax, h * HAT.H)), add(scl(u, Math.cos(f) * r), scl(v, Math.sin(f) * r)))); }
    rows.push(row);
  }
  const paint = (q) => {
    const w = sub(q, base), h = clamp01(dot(w, ax) / HAT.H), f = Math.atan2(dot(w, v), dot(w, u));
    if (h < 0.1) return C.hatAD;
    const s = h * 4.2 + f / TAU;
    return ((Math.floor(s) % 2) + 2) % 2 ? C.hatB : C.hatA;
  };
  sheetMesh(mb, rows, paint, d1);
  capFan(mb, rows[0], add(base, scl(ax, -0.02)), paint, d1, false);
  // a snug brim band
  const band = [];
  for (let i = 0; i < 20; i++) { const f = (i / 20) * TAU; band.push(add(add(base, scl(ax, 0.02)), add(scl(u, Math.cos(f) * (HAT.R + 0.01)), scl(v, Math.sin(f) * (HAT.R + 0.01))))); }
  sheetMesh(mb, tubeRows(band, 0.03, 6, true), (q) => (h3(Math.round(q[0] * 40), Math.round(q[1] * 40), Math.round(q[2] * 40)) > 0.6 ? C.hatB : mixC(C.hatB, C.hatA, 0.25)), d1);
  // the pom-pom
  const pc = add(hatApex(), scl(ax, HAT.pom * 0.55));
  const pomPaint = (q) => { const n = h3(Math.round(q[0] * 50), Math.round(q[1] * 50), Math.round(q[2] * 50)); return q[1] > pc[1] + HAT.pom * 0.3 ? (n > 0.5 ? C.pomL : C.pom) : n > 0.65 ? C.pomD : C.pom; };
  sheetMesh(mb, ellRows(pc, [HAT.pom, HAT.pom, HAT.pom], 12, 8), pomPaint, d1);
}

// Build the (voxel) seal for pose P -> {mesh, A (model-space anchors)}
function buildSeal(P) {
  const mb = new PaintMesh();
  const def = bodyDeform(P);
  // the ball: rows of round sections, denser toward the poles (the face front and the back)
  const rows = [];
  for (let i = 0; i <= BODY_ROWS; i++) {
    const k = i / BODY_ROWS, x = X0 + (X1 - X0) * (0.5 - 0.5 * Math.cos(k * Math.PI));
    const row = [];
    for (let j = 0; j < BODY_SEG; j++) row.push(loafPt(x, (j / BODY_SEG) * TAU));
    rows.push(row);
  }
  sheetMesh(mb, rows, paintBody, def);
  capFan(mb, rows[0], [X0 - 0.005, BALL.cy, 0], paintBody, def, false);
  capFan(mb, rows[rows.length - 1], [X1 + 0.005, BALL.cy, 0], paintBody, def, true);
  // the face: two puffy muzzle pads (puff out when blowing), a little chin, the tiny nose
  const pk = 1 + P.cheek * 0.35;
  for (const sd of [1, -1]) sheetMesh(mb, ellRows([FACE.muzzle[0], FACE.muzzle[1], FACE.muzzle[2] * sd * (1 + P.cheek * 0.2)], [0.1 * pk, 0.086 * pk, 0.108 * pk], 10, 6), paintMuzzle, def);
  sheetMesh(mb, ellRows([0.78, 0.695, 0], [0.07, 0.05, 0.085], 8, 5), paintChin, def);
  sheetMesh(mb, ellRows(FACE.nose, [0.05, 0.042, 0.072], 8, 5), paintNose, def);
  addGlasses(mb, def);
  addHat(mb, def);
  // tiny front flippers poking out of the lower sides of the ball
  const shN = def([SHOULDER[0] + 0.1 * P.shN, SHOULDER[1] + 0.24 * P.shN, SHOULDER[2] + 0.1 * P.shN]);
  const shF = def([SHOULDER[0] + 0.1 * P.shF, SHOULDER[1] + 0.24 * P.shF, -SHOULDER[2] - 0.1 * P.shF]);
  const fw = [0.08, 0.12, 0.13, 0.1, 0.045], ft = [0.065, 0.055, 0.045, 0.036, 0.024];
  const lF = 0.32 * P.frLen * (1 + 0.3 * P.shF), lN = 0.32 * P.flLen * (1 + 0.3 * P.shN);
  const tipF = paddle(mb, shF, P.fr, [0.1, 0.3, -1], lF, fw, ft, paintFlip(lF), P.frTw);
  const tipN = paddle(mb, shN, P.fl, [0.1, 0.3, 1], lN, fw, ft, paintFlip(lN), P.flTw);
  // the little tail flipper pair pokes out of the lower back, splayed
  for (const sd of [1, -1]) {
    const base = def([HIP[0], HIP[1], HIP[2] * sd], 0);
    const ang = P.tail + 0.18 + P.flap * sd * 0.5 + P.flap;
    const spr = Math.min(1.5, P.spread + 0.5) * 0.8;
    const D = [-Math.cos(ang) * Math.cos(spr), Math.sin(ang), Math.sin(spr) * sd];
    paddle(mb, base, D, [0, 1, 0], 0.3, [0.07, 0.11, 0.14, 0.15, 0.11], [0.055, 0.045, 0.036, 0.028, 0.02], paintFlip(0.3));
  }
  const raw = mb.build();
  const mesh = voxelizeMesh(raw, SEAL_VOXEL, { jitter: 0.01, ao: 0.3 }) || raw;
  if (mesh !== raw) raw.dispose?.();
  // anchors (posed)
  const nrmD = (p, n) => norm(sub(def(add(p, scl(n, 0.05)), 1), def(p, 1)));
  const A = {
    eyes: [1, -1].map((sd) => { const q = eyeRest(sd); return { p: def(q, 1), n: nrmD(q, loafN(FACE.eyeX, FACE.eyeA * sd)), side: sd }; }),
    brows: [1, -1].map((sd) => { const q = eyeRest(sd); return def([q[0] - 0.03, q[1] + 0.21, q[2] * 0.97], 1); }),
    lens: [1, -1].map((sd) => { const L = lensOf(sd); return { p: def(L.c, 1), n: nrmD(L.c, L.n), side: sd }; }),
    nose: def(FACE.nose, 1), mouth: def(FACE.mouth, 1), faceN: nrmD(FACE.nose, [1, -0.05, 0]),
    muzzle: [1, -1].map((sd) => def([FACE.muzzle[0] + 0.03, FACE.muzzle[1], FACE.muzzle[2] * sd * (1 + P.cheek * 0.3)], 1)),
    cheeks: [1, -1].map((sd) => def(loafPt(FACE.cheekX, FACE.cheekA * sd), 1)),
    cheekN: [1, -1].map((sd) => nrmD(loafPt(FACE.cheekX, FACE.cheekA * sd), loafN(FACE.cheekX, FACE.cheekA * sd))),
    top: def(add(hatApex(), scl(HAT.axis, HAT.pom * 1.5)), 1), crown: def([0.1, BALL.cy + BALL.hy, 0]), head: def(HEAD_C, 1),
    hand: P.pointFar ? tipF : tipN, hand2: P.pointFar ? tipN : tipF, tail: def([-1.02, 0.34, 0], 0), bottom: def([0, BALL.flat - 0.04, 0], 0),
    back: [def([-0.35, 1.45, 0.25], 0), def([0.05, 1.58, -0.1], 0), def([-0.6, 1.2, 0.3], 0)],
    ball: def([0, BALL.cy, 0], 0), ballTop: def([0, BALL.cy + BALL.hy, 0], 0), ballSide: def([0, BALL.cy, BALL.hz], 0),
  };
  return { mesh, A };
}

// ------------------------------------------------------------------------------------------------ animations
// n frames per cycle, dur seconds per cycle, buckets (point: 7 elevations), fn(P, k, bucket) mutates the pose;
// dy(k) (optional) is the hop height, evaluated continuously when drawing so a bounce is smooth between frames.
const S = Math.sin, CO = Math.cos;
const POINT_E = [-90, -60, -30, 0, 30, 60, 90].map((d) => (d * Math.PI) / 180);
const hop = (k, h) => h * 4 * k * (1 - k);
// a ball's bounce: squashed at contact (k = 0 / 1), stretched while rising and falling, round at the top
function bounceSq(P, k, amt) {
  const v = Math.abs(1 - 2 * k), c = Math.exp(-((Math.min(k, 1 - k) / 0.075) ** 2));
  const sy = 1 + amt * (0.5 * v * (1 - c) - 1.25 * c);
  const sx = 1 + (1 - sy) * 0.8;
  P.sq = [sx, sy, sx]; P.belly = amt * 1.3 * c;
}
// a gentle squishy breath (no hop) for the gestures
function breathe(P, k) {
  const s = S(k * TAU);
  P.sq = [1 + 0.022 * s, 1 - 0.03 * s, 1 + 0.022 * s]; P.belly = 0.035 * (1 + s);
  P.head = [0.03 * S(k * TAU + 0.7), 0.04 * s, 0.07 * S(k * TAU + 0.4)];
  P.fl = [0.1 + 0.14 * s, -0.5, 0.86]; P.fr = [0.1 + 0.14 * S(k * TAU + 1), -0.5, -0.86];
  P.tail = 0.22 + 0.08 * S(k * TAU + 1.3);
}
export const SEAL_ANIMS = {
  // a soft, happy bounce in place
  idle: { n: 14, dur: 1.5, dy: (k) => hop(k, 0.075), fn(P, k) {
    bounceSq(P, k, 0.1);
    const air = S(k * Math.PI);
    P.head = [0.05 * air - 0.02, 0.03 * S(k * TAU), 0.06 * S(k * TAU + 0.4)];
    P.fl = [0.15, -0.55 + 0.45 * air, 0.86]; P.fr = [0.15, -0.55 + 0.45 * air, -0.86];
    P.tail = 0.15 + 0.3 * air;
  } },
  // a bobbing, rocking ball paddling along (leaning into the stroke)
  swim: { n: 12, dur: 0.72, dy: (k) => 0.045 * S(k * TAU), fn(P, k) {
    const a = k * TAU;
    P.rz = -0.14 + 0.08 * S(a + 0.6);
    P.sq = [1.05 - 0.03 * S(a), 0.96 + 0.035 * S(a), 1.0];
    P.head = [0.08 + 0.04 * S(a + 1.2), 0, 0.04 * S(a)];
    const st = 0.5 + 0.5 * S(a);
    P.fl = norm([lerp(0.45, -0.8, st), lerp(-0.7, -0.15, st), 0.65]); P.fr = norm([lerp(0.45, -0.8, st), lerp(-0.7, -0.15, st), -0.65]);
    P.flTw = P.frTw = 0.4 * CO(a);
    P.tail = 0.2; P.flap = 0.34 * S(a - 1.4); P.spread = 0.3;
  } },
  // a happy side-to-side jiggle
  wiggle: { n: 8, dur: 0.55, dy: (k) => 0.05 * Math.abs(S(k * TAU)), fn(P, k) {
    const s = S(k * TAU), c = Math.abs(CO(k * TAU));
    P.rz = 0.14 * s; P.sq = [1.03 + 0.03 * c, 0.96 + 0.05 * (1 - c), 1.03 + 0.03 * c]; P.belly = 0.05 * c;
    P.head = [0.06, 0.12 * s, -0.12 * s];
    P.fl = vdir([-0.9, 0.1 + 0.6 * s, 0.2]); P.fr = vdir([0.9, 0.1 - 0.6 * s, 0.1]);
    P.tail = 0.35; P.flap = 0.25 * s; P.spread = 0.6;
  } },
  wave: { n: 8, dur: 0.9, fn(P, k) {
    breathe(P, k);
    const s = S(k * TAU);
    // the face-side flipper waves high beside the face
    P.fr = vdir([0.42 + 0.38 * s, 0.9, 0.12]); P.shF = 0.9;
    P.head = [0.08, 0.1, 0.16]; P.frLen = 1.4; P.rz = 0.04;
  } },
  point: { n: 4, dur: 1.1, buckets: 7, fn(P, k, b) {
    breathe(P, k * 0.5);
    const e = POINT_E[b];
    P.rz = clamp(e, -1.2, 1.2) * 0.16;
    P.head = [e * 0.22, 0.05, 0.05];
    // it points with the far flipper, which pokes out of the side of the ball the face is turned to (the near one
    // would cross in front of the face)
    P.shF = 1; P.pointFar = true;
    P.fr = solvePoint(P, e, 0.12);
    P.frTw = -0.5;
    P.frLen = 1.75 + 0.1 * S(k * TAU) + 0.25 * Math.max(0, Math.sin(e));
    P.fl = [0.35, -0.3, 0.9];
  } },
  // a hop that lands SPLAT: squished flat, then it wobbles back into a ball
  flop: { n: 14, dur: 1.15, dy: (k) => (k > 0.16 && k < 0.5 ? S(((k - 0.16) / 0.34) * Math.PI) * 0.6 : 0), fn(P, k) {
    if (k < 0.16) { const q = k / 0.16; P.sq = [1 + 0.12 * q, 1 - 0.18 * q, 1 + 0.12 * q]; P.belly = 0.12 * q; P.head = [-0.08 * q, 0, 0]; }
    else if (k < 0.5) {
      const q = (k - 0.16) / 0.34;
      P.sq = [0.92, 1.13 - 0.1 * q, 0.92]; P.rz = 0.2 - q * 0.35;
      P.fl = vdir([-0.6, 0.8, 0.2]); P.fr = vdir([0.6, 0.8, 0.1]); P.shN = P.shF = 0.6; P.tail = 0.6; P.head = [0.15 - q * 0.2, 0, 0];
    } else if (k < 0.62) {
      const q = (k - 0.5) / 0.12;
      P.sq = [1 + 0.3 * q, 1 - 0.42 * q, 1 + 0.3 * q]; P.belly = 0.3 * q;
      P.fl = vdir([-1, -0.05, 0.2]); P.fr = vdir([1, -0.05, 0.1]); P.tail = 0.4; P.spread = 0.9; P.head = [-0.08, 0, 0];
    } else {
      const q = (k - 0.62) / 0.38, j = S(q * Math.PI * 3) * (1 - q);
      P.sq = [1 + 0.3 * (1 - q) * 0.6 + 0.06 * j, 1 - 0.42 * (1 - q) * 0.6 - 0.1 * j, 1 + 0.3 * (1 - q) * 0.6 + 0.06 * j];
      P.belly = 0.3 * (1 - q) + 0.08 * j;
      P.fl = norm(lerp3(vdir([-1, -0.05, 0.2]), [0.1, -0.5, 0.86], q)); P.fr = norm(lerp3(vdir([1, -0.05, 0.1]), [0.1, -0.5, -0.86], q));
      P.spread = lerp(0.9, 0.45, q); P.head = [0.04 * j, 0, 0.08 * j];
    }
  } },
  // a forward roll with a little hop
  spin: { n: 16, dur: 0.85, dy: (k) => hop(k, 0.16), fn(P, k) {
    P.rz = -k * TAU;
    P.sq = [0.98, 1.03, 0.98];
    P.fl = [0.1, 0.3, 0.95]; P.fr = [0.1, 0.3, -0.95]; P.head = [0.05, 0, 0]; P.tail = 0.4; P.spread = 0.7;
  } },
  // shrinks a little and trembles, flippers up at its face
  worried: { n: 8, dur: 0.5, fn(P, k) {
    const j = (Math.floor(k * 8) % 2 ? 1 : -1);
    P.sq = [0.97 + 0.01 * j, 0.95, 0.97]; P.head = [-0.08, 0.04 * j, 0.03 * j]; P.rz = 0.02 * j;
    P.fl = vdir([-0.85, 0.55, 0.15]); P.fr = vdir([0.85, 0.55, 0.0]); P.shN = P.shF = 0.9; P.flLen = P.frLen = 1.3; P.tail = 0.05; P.spread = 0.25;
  } },
  clap: { n: 6, dur: 0.34, dy: (k) => 0.025 * (0.5 - 0.5 * CO(k * TAU)), fn(P, k) {
    const open = 0.5 + 0.5 * CO(k * TAU);
    P.sq = [1 + 0.03 * open, 1 - 0.04 * open, 1 + 0.03 * open];
    P.head = [0.12, 0, 0.05 * (open - 0.5)]; P.belly = 0.05 * open;
    P.fl = vdir([lerp(-0.15, -0.95, open), lerp(0.75, 0.3, open), lerp(0.7, 0.2, open)]); P.fr = vdir([lerp(0.2, 0.95, open), lerp(0.75, 0.3, open), lerp(0.55, 0.1, open)]);
    P.shN = P.shF = 0.7; P.flLen = P.frLen = 1.15;
    P.tail = 0.35 + 0.1 * open; P.flap = 0.15 * open;
  } },
  think: { n: 8, dur: 2.2, fn(P, k) {
    breathe(P, k);
    P.fr = vdir([0.8, 0.62, 0.05]); P.frTw = 0.6; P.shF = 1; P.frLen = 1.35; P.head = [0.1, 0.06, 0.22 + 0.03 * S(k * TAU)]; P.rz = 0.05;
  } },
  blow: { n: 8, dur: 1.4, fn(P, k) {
    breathe(P, k);
    P.cheek = S(clamp01(k / 0.8) * Math.PI) ** 0.6; P.head = [0.1, 0, 0];
    P.sq = [1 + 0.04 * P.cheek, 1 + 0.02 * P.cheek, 1 + 0.04 * P.cheek];
  } },
  // a BIG happy bounce, flippers up
  cheer: { n: 10, dur: 0.66, dy: (k) => hop(k, 0.36), fn(P, k) {
    bounceSq(P, k, 0.24);
    const s = S(k * TAU), air = S(k * Math.PI);
    P.fl = vdir([-0.6 - 0.2 * s, 0.8, 0.15]); P.fr = vdir([0.6 - 0.2 * s, 0.8, 0.05]); P.shN = P.shF = 0.5 + 0.4 * air; P.flLen = P.frLen = 1.35;
    P.tail = 0.3 + 0.4 * air; P.flap = 0.2 * s; P.spread = 0.65; P.head = [0.12 * air, 0, 0.1 * s];
  } },
  // a deflated, droopy mochi: the face slides down
  sad: { n: 8, dur: 2.6, fn(P, k) {
    const s = S(k * TAU);
    P.sq = [1.07, 0.89 + 0.012 * s, 1.07]; P.head = [-0.26, 0, -0.08]; P.belly = 0.1;
    P.fl = [0.15, -0.95, 0.45]; P.fr = [0.15, -0.95, -0.45]; P.tail = 0.0; P.spread = 0.3;
  } },
  sleep: { n: 12, dur: 3.2, fn(P, k) {
    const s = S(k * TAU);
    P.sq = [1.08 - 0.015 * s, 0.9 + 0.03 * s, 1.08 - 0.015 * s]; P.head = [-0.2, 0, -0.18]; P.belly = 0.1 + 0.05 * s;
    P.fl = [0.0, -0.6, 0.8]; P.fr = [0.0, -0.6, -0.8]; P.tail = 0.1; P.spread = 0.35;
    P.closed = true;
  } },
};
// old guide poses / moods -> seal animations
export const SEAL_ALIAS = {
  talk: 'idle', laugh: 'wiggle', bend: 'worried', excited: 'wiggle', happy: 'idle', love: 'wiggle', surprised: 'idle', ride: 'idle',
  sleepy: 'sleep', tired: 'sleep', celebrate: 'cheer', dance: 'wiggle', jump: 'flop', hop: 'flop', scared: 'worried', cry: 'sad', stand: 'idle', chat: 'idle',
};
const animOf = (a) => (SEAL_ANIMS[a] ? a : SEAL_ALIAS[a] || 'idle');

// near flipper direction (model space) that points at screen elevation e (rad, up = +) and comes out in front of
// the body (toward the viewer), so the gesture reads clearly
// a model-space direction for a view-space one (x right, y up, z toward the viewer) in the side view (the posed
// meshes are shared by both views; the front view is only ~15 degrees further round)
const lerp3 = (a, b, k) => [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];
let SIDE_M = null;
function vdir(v) {
  const m = SIDE_M || (SIDE_M = T4.rot(0.2, -1.12, 0)), q = norm(v);
  return norm([m[0] * q[0] + m[1] * q[1] + m[2] * q[2], m[4] * q[0] + m[5] * q[1] + m[6] * q[2], m[8] * q[0] + m[9] * q[1] + m[10] * q[2]]);
}
function solvePoint(P, e, toward = 0.45) {
  const m = T4.rot(P.tilt, P.yaw, P.rz);
  const q = norm([Math.cos(e) + 0.55 * Math.max(0, Math.sin(e)), Math.sin(e), toward + 0.6 * Math.max(0, Math.sin(e)) + 0.2 * Math.max(0, -Math.sin(e))]);
  return norm([m[0] * q[0] + m[1] * q[1] + m[2] * q[2], m[4] * q[0] + m[5] * q[1] + m[6] * q[2], m[8] * q[0] + m[9] * q[1] + m[10] * q[2]]);
}

function pose(anim, k, b, view) {
  const P = P0();
  if (view === 'front') { P.yaw = -1.38; P.tilt = 0.16; }
  SEAL_ANIMS[anim].fn(P, k, b);
  return P;
}

// ------------------------------------------------------------------------------------------------ caches
// POSES: the voxel meshes of every frame of an animation (model space, compact faces; shared by all sizes).
// SHEETS: one rendered sprite sheet per animation / device size / view.
const POSES = new Map(), SHEETS = new Map(), WANT = new Map();
let totalPx = 0, poseFaces = 0;
const PX_CAP = 22e6, FACE_CAP = 1.2e6;
const SIZES = [16, 20, 24, 28, 32, 36, 40, 44, 48, 56, 64, 72, 80, 96, 112, 128];
export function sealSize(s) { for (const z of SIZES) if (z >= s - 1.5) return z; return SIZES[SIZES.length - 1]; }
const DEV = [12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 44, 48, 56, 64, 72, 80, 88, 96, 104, 112, 120, 128, 144, 160, 176, 192];
function devSize(s) { for (const z of DEV) if (z >= s - 1.5) return z; return DEV[DEV.length - 1]; }
function devScale(ctx) {
  try { const m = ctx?.getTransform?.(); if (m) { const s = Math.hypot(m.a, m.b); if (s > 0.05 && Number.isFinite(s)) return s; } } catch (e) { /* plain */ }
  return ctx?.__hi || 1;
}
const hiScale = () => (HI_ON.on ? HI : 1);

// build budget: at most one new sheet per frame (forced builds aside)
let budT = -1e9, budN = 0;
function mayBuild() {
  const now = performance.now();
  if (now - budT > 14) { budT = now; budN = 0; }
  return budN < 1;
}

// (the meshes do not depend on the view, except the pointing flipper, which is aimed in screen space)
function poseSet(anim, view) {
  const key = anim + (anim === 'point' ? '|' + view : '');
  let ps = POSES.get(key);
  if (ps) { ps.used = performance.now(); return ps; }
  const A = SEAL_ANIMS[anim];
  const n = A.n * (A.buckets || 1);
  ps = { meshes: [], As: [], faces: 0, used: performance.now() };
  for (let i = 0; i < n; i++) {
    const b = Math.floor(i / A.n), k = (i % A.n) / A.n;
    const P = pose(anim, k, b, view);
    const { mesh, A: an } = buildSeal(P);
    ps.meshes.push(mesh); ps.As.push(an);
    ps.faces += mesh.nFaces || mesh.count / 6 || 0;
  }
  POSES.set(key, ps);
  poseFaces += ps.faces;
  if (poseFaces > FACE_CAP) {
    const all = [...POSES].filter(([k2]) => k2 !== key).sort((a, b) => a[1].used - b[1].used);
    for (const [k2, v] of all) {
      if (poseFaces <= FACE_CAP * 0.75) break;
      for (const m of v.meshes) m.dispose?.();
      POSES.delete(k2); poseFaces -= v.faces;
    }
  }
  return ps;
}

function project(A, o, m) {
  const pr = (p) => lpProject(p, o);
  const rot = (n) => [m[0] * n[0] + m[4] * n[1] + m[8] * n[2], m[1] * n[0] + m[5] * n[1] + m[9] * n[2], m[2] * n[0] + m[6] * n[1] + m[10] * n[2]];
  return {
    eyes: A.eyes.map((e) => { const n = rot(e.n); return { p: pr(e.p), nz: n[2], ang: Math.atan2(-n[1], n[0]), side: e.side }; }),
    lens: A.lens.map((e) => { const n = rot(e.n); return { p: pr(e.p), nz: n[2], ang: Math.atan2(-n[1], n[0]), side: e.side }; }),
    brows: A.brows.map(pr), nose: pr(A.nose), mouth: pr(A.mouth), muzzle: A.muzzle.map(pr), cheeks: A.cheeks.map(pr), cheekZ: A.cheekN.map((n) => rot(n)[2]),
    faceZ: rot(A.faceN)[2], top: pr(A.top), crown: pr(A.crown), head: pr(A.head), hand: pr(A.hand), hand2: pr(A.hand2), tail: pr(A.tail), bottom: pr(A.bottom),
    back: A.back.map(pr), ball: pr(A.ball), gR: Math.hypot(...[0, 1].map((i) => pr(A.ballTop)[i] - pr(A.ball)[i])),
    gRx: Math.hypot(...[0, 1].map((i) => pr(A.ballSide)[i] - pr(A.ball)[i])),
  };
}

// crisp dark ink outline around the silhouette, baked into the cached sheet once: every transparent pixel touching
// an opaque one in the same cell turns ink (more passes on big device sizes so it stays ~1 logical px)
const INK = [14, 16, 28];
export const SEAL_OUTLINE = (size) => (size >= 150 ? 3 : size >= 52 ? 2 : 1);
function outlineCells(canvas, cw, ch, passes, gloss) {
  const W = canvas.width, H = canvas.height;
  if (!W || !H) return;
  let g;
  try { g = canvas.getContext('2d', { willReadFrequently: true }); } catch { return; }
  if (!g) return;
  let img;
  try { img = g.getImageData(0, 0, W, H); } catch { return; }
  const d = img.data, solid = new Uint8Array(W * H);
  if (gloss) glossCells(d, W, H, cw, ch, gloss);
  for (let i = 0, j = 3; i < solid.length; i++, j += 4) solid[i] = d[j] > 110 ? 1 : 0;
  for (let pass = 0; pass < passes; pass++) {
    const addL = [];
    for (let y = 0; y < H; y++) {
      const cy0 = Math.floor(y / ch) * ch, cy1 = cy0 + ch - 1;
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (solid[i]) continue;
        const cx0 = Math.floor(x / cw) * cw, cx1 = cx0 + cw - 1;
        if ((x > cx0 && solid[i - 1]) || (x < cx1 && solid[i + 1]) || (y > cy0 && solid[i - W]) || (y < cy1 && solid[i + W])) {
          const j = i * 4;
          d[j] = INK[0]; d[j + 1] = INK[1]; d[j + 2] = INK[2]; d[j + 3] = 255;
          addL.push(i);
        }
      }
    }
    for (const i of addL) solid[i] = 1;
  }
  g.putImageData(img, 0, 0);
}

// The bubbly shine, baked per cell: a blocky voxel-grid specular patch on the upper-left of the ball (a white core in
// a pale sheen, a small sparkle further along the curve and a faint sheen arc along the lower right), fixed to the
// light so it stays put while the ball rolls. Only fur pixels (light, unsaturated) are lit, so the face, glasses,
// hat stripes and flippers keep their colours.
function glossCells(d, W, H, cw, ch, { frames, cols, q }) {
  const at = (x, y, k, tint) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const j = (y * W + x) * 4;
    if (d[j + 3] < 200) return;
    const r = d[j], g = d[j + 1], b = d[j + 2], mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    if (mx < 105 || mx - mn > 48) return;
    d[j] = r + (tint[0] - r) * k; d[j + 1] = g + (tint[1] - g) * k; d[j + 2] = b + (tint[2] - b) * k;
  };
  const WHITE = [255, 255, 255], SHEEN = [244, 252, 255], RIM = [214, 244, 255];
  frames.forEach((F, i) => {
    if (!F.ball || !(F.gR > 2)) return;
    const ox = (i % cols) * cw, oy = Math.floor(i / cols) * ch;
    const R = F.gR, Rx = Math.max(R * 0.8, F.gRx || R), bx = F.ball[0], by = F.ball[1];
    // ellipse in the tangent frame at the upper left of the ball (long axis along the curve)
    const blob = (ang, dist, la, lb, k, tint, k2 = k) => {
      const cx = bx + Math.cos(ang) * Rx * dist, cy = by + Math.sin(ang) * R * dist;
      const tx = -Math.sin(ang), ty = Math.cos(ang), E = Math.max(la, lb) * R + q;
      for (let y = Math.floor(cy - E); y <= cy + E; y += 1) for (let x = Math.floor(cx - E); x <= cx + E; x += 1) {
        // test at the centre of the voxel-grid block this pixel belongs to (blocky, pixel-art edges)
        const qx = (Math.floor(x / q) + 0.5) * q, qy = (Math.floor(y / q) + 0.5) * q;
        const ux = qx - cx, uy = qy - cy;
        const a = (ux * tx + uy * ty) / (la * R), b = (ux * Math.cos(ang) + uy * Math.sin(ang)) / (lb * R);
        const e = a * a + b * b;
        if (e > 1) continue;
        at(ox + x, oy + y, e < 0.4 ? k2 : k, tint);
      }
    };
    const A0 = -1.98; // up-left, above the glasses
    blob(A0, 0.71, 0.36, 0.17, 0.45, RIM, 0.85);
    blob(A0, 0.71, 0.3, 0.13, 0.85, SHEEN, 1);
    blob(A0 - 0.06, 0.73, 0.15, 0.07, 1, WHITE);
    blob(A0 - 0.55, 0.85, 0.06, 0.05, 1, WHITE);
    blob(A0 - 0.82, 0.88, 0.04, 0.04, 0.95, WHITE);
    blob(0.75, 0.87, 0.36, 0.05, 0.4, RIM);
  });
}

function buildSheet(anim, size, view) {
  const ps = poseSet(anim, view);
  const n = ps.meshes.length, AN = SEAL_ANIMS[anim];
  const cw = Math.ceil(CELL_W * size), ch = Math.ceil(CELL_H * size);
  const base = { w: cw, h: ch, center: C0, scale: size, radius: 2.4, ...LOOK };
  const cells = [], frames = [];
  for (let i = 0; i < n; i++) {
    const P = pose(anim, (i % AN.n) / AN.n, Math.floor(i / AN.n), view);
    const matrix = T4.rot(P.tilt, P.yaw, P.rz);
    cells.push({ mesh: ps.meshes[i], matrix });
    const F = project(ps.As[i], { ...base, matrix }, matrix);
    F.dy = P.dy; F.cheek = P.cheek; F.closed = P.closed;
    frames.push(F);
  }
  let cols = Math.max(1, Math.min(n, Math.floor(4096 / cw)));
  while (Math.ceil(n / cols) * ch > 4096 && cols < n) cols++;
  let canvas = null;
  try { canvas = renderSheet(cells, { ...base, cols }); } catch (e) { canvas = null; }
  if (canvas) outlineCells(canvas, cw, ch, SEAL_OUTLINE(size), { frames, cols, q: Math.max(1, SEAL_VOXEL * size) });
  for (const m of ps.meshes) m.release?.();
  const px = canvas ? canvas.width * canvas.height : 0;
  totalPx += px;
  return { canvas, cw, ch, cols, n, frames, size, anim, view, px };
}

function evict(keep) {
  if (totalPx <= PX_CAP) return;
  const all = [...SHEETS].filter(([k]) => k !== keep).sort((a, b) => a[1].used - b[1].used);
  for (const [k, v] of all) {
    if (totalPx <= PX_CAP * 0.75) break;
    if (performance.now() - v.used < 1000) continue;
    SHEETS.delete(k); totalPx -= v.px || 0;
  }
}

function sheet(anim, size, view, force) {
  const key = anim + '|' + size + '|' + view;
  let sh = SHEETS.get(key);
  if (sh) { sh.used = performance.now(); return sh; }
  // a cached sheet of a close size stands in: zoom-ins and other transient scales must not bake a new sheet for
  // every size bucket they pass through; a size that stays wanted for a while (~40 draws) gets its own crisp sheet
  if (!force) {
    let near = null;
    for (const s of SHEETS.values()) {
      if (s.anim !== anim || s.view !== view || s.size < size * 0.8 || s.size > size * 1.5) continue;
      if (!near || Math.abs(Math.log(s.size / size)) < Math.abs(Math.log(near.size / size))) near = s;
    }
    if (near) {
      const w = (WANT.get(key) || 0) + 1;
      WANT.set(key, w);
      if (WANT.size > 64) WANT.delete(WANT.keys().next().value);
      if (w < 40 || !mayBuild()) { near.used = performance.now(); return near; }
    }
  }
  if (!force && !mayBuild()) {
    // over budget this frame: the nearest cached sheet stands in
    let best = null, bs = Infinity;
    for (const s of SHEETS.values()) {
      const score = (s.anim === anim ? 0 : s.anim === 'idle' ? 2000 : 4000) + (s.view === view ? 0 : 8000) + Math.abs(Math.log(s.size / size)) * 300;
      if (score < bs) { bs = score; best = s; }
    }
    if (best) { best.used = performance.now(); return best; }
  }
  budN++;
  sh = buildSheet(anim, size, view);
  sh.used = performance.now();
  SHEETS.set(key, sh);
  evict(key);
  return sh;
}

export function warmSeal(size = 40, anims = ['idle', 'swim', 'point'], view = 'side') {
  if (typeof document === 'undefined' || !lpAvailable()) return true;
  const z = devSize(sealSize(size) * hiScale());
  for (const a of anims) if (SEAL_ANIMS[animOf(a)]) sheet(animOf(a), z, view, true);
  return true;
}
export function sealReady(size = 40, view = 'side') { return SHEETS.has('idle|' + devSize(sealSize(size) * hiScale()) + '|' + view); }

// ------------------------------------------------------------------------------------------------ per-seal state
// blink / gaze, the soft-body jiggle (squash spring + ripple) and the floating bubbles
const ST = new Map();
function stateOf(id, t, x, y, anim) {
  let s = ST.get(id);
  if (!s || t < s.t - 1 || t - s.t > 2) {
    s = {
      t, x, y, vx: 0, vy: 0, s: 0, v: 0, anim, rip: 0, talk: 0, dt: 0,
      next: t + 1.5 + Math.random() * 2, until: -1, gx: 0, gy: 0,
      floats: [], pops: [], floatNext: t + 1 + Math.random() * 2,
    };
    ST.set(id, s);
    if (ST.size > 40) ST.delete(ST.keys().next().value);
  }
  s.dt = clamp(t - s.t, 0, 0.05);
  if (t > s.next) { s.until = t + 0.13; s.next = t + 2.2 + Math.random() * 3.5; if (Math.random() < 0.18) s.next = t + 0.3; }
  return s;
}
function updateJiggle(j, t, x, y, anim, talk) {
  const dt = j.dt;
  if (dt > 0) {
    const vx = (x - j.x) / dt, vy = (y - j.y) / dt;
    const ay = (vy - j.vy) / Math.max(dt, 1 / 60), ax = (vx - j.vx) / Math.max(dt, 1 / 60);
    // spring: stiff enough to snap back, soft enough to wobble a few times
    let f = -150 * j.s - 7.5 * j.v;
    f += clamp(-ay * 0.0012, -6, 6) + clamp(Math.abs(ax) * 0.0004, 0, 3);
    if (anim !== j.anim) { j.v += anim === 'flop' ? -2.4 : 1.3; j.anim = anim; }
    j.talk += ((talk || 0) - j.talk) * Math.min(1, dt * 10);
    f += j.talk * Math.sin(t * 17) * 10;
    j.v += f * dt; j.s = clamp(j.s + j.v * dt, -0.24, 0.24);
    const sp = Math.hypot(vx, vy);
    j.rip += ((clamp(sp / 300, 0, 1) * 0.6 + Math.abs(j.v) * 0.6 + j.talk * 0.8 + 0.2) - j.rip) * Math.min(1, dt * 4);
    j.vx = vx; j.vy = vy;
  }
  j.t = t; j.x = x; j.y = y;
}

// ------------------------------------------------------------------------------------------------ the live face
let FPX = 1; // the face is drawn at voxel resolution: one face pixel = FPX sprite px
function ellipse(ctx, x, y, rx2, ry2, rot = 0) { ctx.beginPath(); ctx.ellipse(x, y, Math.max(0.3, rx2), Math.max(0.3, ry2), rot, 0, TAU); }
const dotPx = (ctx, x, y, n = 1) => ctx.fillRect(Math.round(x / FPX - n / 2) * FPX, Math.round(y / FPX - n / 2) * FPX, FPX * n, FPX * n);

// one eye in its own upright frame (radius r): a big, shiny, dark cartoon eye with two catchlights, moods
function drawEye(ctx, r, o) {
  const { mood, blink, gx, gy, side } = o;
  const ink = '#141a2a';
  ctx.lineCap = 'round';
  if (blink > 0.5 || mood === 'happy-closed' || mood === 'sleepy') {
    ctx.strokeStyle = ink; ctx.lineWidth = Math.max(FPX, r * 0.32);
    ctx.beginPath(); ctx.arc(0, -r * 0.15, r * 0.75, 0.2 * Math.PI, 0.8 * Math.PI); ctx.stroke();
    return;
  }
  if (mood === 'laugh' || mood === 'joy') {
    ctx.strokeStyle = ink; ctx.lineWidth = Math.max(FPX, r * 0.34);
    ctx.beginPath(); ctx.arc(0, r * 0.35, r * 0.72, 1.15 * Math.PI, 1.85 * Math.PI); ctx.stroke();
    return;
  }
  if (mood === 'love') {
    const k = r * 1.05;
    ctx.fillStyle = '#ff4f86';
    ctx.beginPath();
    ctx.moveTo(0, k * 0.85);
    ctx.bezierCurveTo(-k * 1.25, -k * 0.05, -k * 0.55, -k * 1.0, 0, -k * 0.35);
    ctx.bezierCurveTo(k * 0.55, -k * 1.0, k * 1.25, -k * 0.05, 0, k * 0.85);
    ctx.fill();
    ctx.fillStyle = '#ffffff'; dotPx(ctx, -k * 0.4, -k * 0.35, 1);
    return;
  }
  let rxe = r * 0.9, rye = r * 1.04;
  if (mood === 'surprised' || mood === 'excited') { rxe *= 1.1; rye *= 1.1; }
  const ox = gx * r * 0.14, oy = gy * r * 0.12;
  ctx.save();
  // the lid line for sad / smug / determined (clip away the top)
  if (mood === 'sad' || mood === 'smug' || mood === 'angry' || mood === 'determined' || mood === 'tired') {
    ctx.beginPath();
    const tiltA = mood === 'sad' ? -0.45 * side : mood === 'smug' || mood === 'tired' ? 0 : 0.45 * side;
    const cut = mood === 'smug' || mood === 'tired' ? -rye * 0.05 : -rye * 0.4;
    ctx.save(); ctx.rotate(tiltA); ctx.rect(-r * 3, cut, r * 6, r * 6); ctx.restore();
    ctx.clip();
  }
  // a dark glossy eye with a deep blue glow in its lower half
  ctx.fillStyle = '#10131d';
  ellipse(ctx, ox, oy, rxe, rye); ctx.fill();
  ctx.fillStyle = '#2b3f6e';
  ellipse(ctx, ox, oy + rye * 0.42, rxe * 0.72, rye * 0.42); ctx.fill();
  ctx.fillStyle = '#4f7fc0';
  ellipse(ctx, ox, oy + rye * 0.62, rxe * 0.42, rye * 0.2); ctx.fill();
  // catchlights: a big one up front and a small one below
  ctx.fillStyle = '#ffffff';
  const big = r > FPX * 2.4 ? 2 : 1;
  dotPx(ctx, ox - rxe * 0.32, oy - rye * 0.36, big);
  if (r > FPX * 1.6) dotPx(ctx, ox + rxe * 0.36, oy + rye * 0.3, 1);
  if ((mood === 'excited' || mood === 'surprised') && r > FPX * 2.4) dotPx(ctx, ox + rxe * 0.2, oy - rye * 0.62, 1);
  ctx.restore();
  if (blink > 0.05) { // half-closed
    ctx.fillStyle = 'rgba(236,239,246,1)';
    ctx.fillRect(-r * 1.3, -rye * 1.2, r * 2.6, rye * 2.2 * blink);
  }
}

function drawFace(ctx, F, o, s) {
  const st = o.state, mood = o.mood || 'happy', t = o.t || 0;
  const er = EYE_R * s;
  // gaze (sprite-local, mirrored by facing)
  let gx = Math.sin(t * 0.6) * 0.25, gy = Math.sin(t * 0.37) * 0.2;
  if (o.look) { const l = Math.hypot(o.look[0], o.look[1]) || 1, k = Math.min(1, l / 30); gx = (o.look[0] / l) * k; gy = (o.look[1] / l) * k; }
  if (mood === 'think') { gx = 0.6; gy = -0.8; }
  st.gx += (gx - st.gx) * Math.min(1, st.dt * 9); st.gy += (gy - st.gy) * Math.min(1, st.dt * 9);
  let blink = o.blink ?? (t < st.until ? 1 : 0);
  if (F.closed) blink = 1;
  let em = mood;
  if (mood === 'happy' && (o.talk || 0) < 0.05 && Math.sin(t * 0.8) > 0.93) em = 'joy';
  if (mood === 'worried' || mood === 'scared') em = 'sad';
  const a0 = ctx.globalAlpha;
  // rosy blush (pixel ovals at voxel resolution)
  if (F.faceZ > 0.0) {
    const bk = mood === 'love' || mood === 'excited' ? 0.85 : mood === 'sad' || mood === 'angry' ? 0.35 : 0.62;
    ctx.fillStyle = '#ff8fb2';
    F.cheeks.forEach((c, i) => {
      const z = F.cheekZ ? F.cheekZ[i] : 1;
      if (z < 0.08) return;
      ctx.globalAlpha = a0 * bk * clamp01((z - 0.08) / 0.3);
      ellipse(ctx, c[0], c[1], er * 1.0 * Math.max(0.45, z), er * 0.52); ctx.fill();
    });
    ctx.globalAlpha = a0;
  }
  // a wet-nose glint
  if (F.faceZ > 0.1) { ctx.fillStyle = 'rgba(255,255,255,0.9)'; dotPx(ctx, F.nose[0] - s * 0.012, F.nose[1] - s * 0.016, 1); }
  // eyes
  for (const E of F.eyes) {
    if (E.nz < 0.06) continue;
    ctx.globalAlpha = a0 * clamp01(E.nz / 0.22);
    ctx.save();
    ctx.translate(E.p[0], E.p[1]);
    ctx.rotate(E.ang); ctx.scale(Math.max(0.4, E.nz), 1); ctx.rotate(-E.ang);
    drawEye(ctx, er, { mood: em, blink, gx: st.gx, gy: st.gy, side: E.side });
    ctx.restore();
  }
  ctx.globalAlpha = a0;
  // the glasses' lenses (the rims are voxels in the sheet): a faint glassy tint and a glint at the upper left
  if (F.lens) for (const E of F.lens) {
    if (E.nz < 0.08) continue;
    const R = GLASS.R * s * 0.8;
    ctx.globalAlpha = a0 * clamp01(E.nz / 0.25);
    ctx.save();
    ctx.translate(E.p[0], E.p[1]);
    ctx.rotate(E.ang); ctx.scale(Math.max(0.35, E.nz), 1); ctx.rotate(-E.ang);
    ctx.fillStyle = 'rgba(196,238,255,0.12)';
    ellipse(ctx, 0, 0, R, R); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(FPX, R * 0.15);
    ctx.beginPath(); ctx.arc(0, 0, R * 0.78, 1.08 * Math.PI, 1.32 * Math.PI); ctx.stroke();
    ctx.restore();
  }
  ctx.globalAlpha = a0;
  // worried / determined brows
  if ((mood === 'worried' || mood === 'scared' || mood === 'angry' || mood === 'determined' || mood === 'sad') && F.faceZ > 0.1) {
    ctx.strokeStyle = '#59607a'; ctx.lineWidth = Math.max(FPX, er * 0.3); ctx.lineCap = 'round';
    const up = mood === 'angry' || mood === 'determined' ? -1 : 1;
    F.brows.forEach((b, i) => {
      if (F.eyes[i].nz < 0.15) return;
      const inner = F.eyes[i].side * -1;
      ctx.beginPath(); ctx.moveTo(b[0] - er * 0.8, b[1] + er * 0.25 * up * -inner); ctx.lineTo(b[0] + er * 0.8, b[1] + er * 0.25 * up * inner); ctx.stroke();
    });
  }
  if (F.faceZ < 0.05) return;
  // mouth: a tiny 'w' smile, opening while talking
  const [mx, my] = F.mouth;
  const w = s * 0.06, talk = clamp01(o.talk || 0);
  ctx.strokeStyle = '#4a4458'; ctx.lineWidth = Math.max(FPX, s * 0.026); ctx.lineCap = 'round';
  if (talk > 0.06 || mood === 'surprised' || mood === 'excited' || em === 'joy') {
    const open = Math.max(talk, mood === 'surprised' ? 0.6 : mood === 'excited' || em === 'joy' ? 0.3 : 0);
    const oh = s * (0.02 + open * 0.042), ow = s * (mood === 'surprised' ? 0.036 : 0.045);
    ctx.fillStyle = '#5b2238';
    ellipse(ctx, mx, my - s * 0.005 + oh * 0.5, ow, oh); ctx.fill();
    ctx.fillStyle = '#ff7f9f';
    ellipse(ctx, mx, my - s * 0.005 + oh * 0.95, ow * 0.6, oh * 0.42); ctx.fill();
  }
  ctx.beginPath();
  if (mood === 'sad' || mood === 'worried' || mood === 'scared') {
    ctx.moveTo(mx - w, my + w * 0.45); ctx.quadraticCurveTo(mx - w * 0.5, my - w * 0.25, mx, my + w * 0.1);
    ctx.quadraticCurveTo(mx + w * 0.5, my - w * 0.25, mx + w, my + w * 0.45);
  } else {
    ctx.moveTo(mx - w, my - w * 0.15); ctx.quadraticCurveTo(mx - w * 0.5, my + w * 0.7, mx, my);
    ctx.quadraticCurveTo(mx + w * 0.5, my + w * 0.7, mx + w, my - w * 0.15);
  }
  ctx.stroke();
}

// ------------------------------------------------------------------------------------------------ bubbles (pixel art)
// A pixel-art soap bubble (cached per device radius): a dark aqua rim, a faint dithered aqua body, a pink / gold /
// mint film band along the lower rim and a chunky white highlight at the upper left.
const SOAP = new Map();
function soapBubble(R) {
  let c = SOAP.get(R);
  if (c) return c;
  const S2 = R * 2 + 3;
  c = document.createElement('canvas');
  c.width = c.height = S2;
  const g = c.getContext('2d');
  const img = g.createImageData(S2, S2), d = img.data, m = S2 / 2;
  const put = (x, y, r2, g2, b2, a) => { const i = (y * S2 + x) * 4; d[i] = r2; d[i + 1] = g2; d[i + 2] = b2; d[i + 3] = a; };
  const film = [[255, 150, 214], [255, 230, 140], [150, 255, 210], [130, 210, 255]];
  const rimW = R > 14 ? 2 : 1;
  for (let y = 0; y < S2; y++) for (let x = 0; x < S2; x++) {
    const dx = x + 0.5 - m, dy = y + 0.5 - m, dd = Math.hypot(dx, dy);
    if (dd > R) continue;
    const a = Math.atan2(dy, dx);
    if (dd > R - rimW) {
      if (a > 0.1 && a < 2.9) { const f = film[Math.floor(((a - 0.1) / 2.8) * 4) % 4]; put(x, y, f[0], f[1], f[2], 220); }
      else put(x, y, 70, 160, 210, 230);
      continue;
    }
    const k = dd / R;
    // the faint body: denser near the rim, ordered dithering
    const bay = ((x & 1) * 2 + (y & 1) * 3) % 4 / 4;
    if (k > 0.78 && bay < (k - 0.7) * 2.5) put(x, y, 170, 232, 255, 150);
    else if ((x + y) % 2 === 0 && k > 0.55) put(x, y, 190, 240, 255, 50);
    else put(x, y, 200, 244, 255, 26);
    // the highlight crescent at the upper left
    const hl = Math.hypot(dx + R * 0.38, dy + R * 0.4);
    if (hl < R * 0.24 && dx < -R * 0.15 && dy < -R * 0.15) put(x, y, 255, 255, 255, 235);
  }
  // a little sparkle at the lower right
  const sx = Math.round(m + R * 0.45), sy = Math.round(m + R * 0.42);
  if (sx < S2 && sy < S2) put(sx, sy, 255, 255, 255, 230);
  g.putImageData(img, 0, 0);
  SOAP.set(R, c);
  if (SOAP.size > 48) SOAP.delete(SOAP.keys().next().value);
  return c;
}
export function drawSoapBubble(ctx, x, y, r, sq = 0) {
  if (typeof document === 'undefined' || !(r > 0)) return;
  const ds = clamp(devScale(ctx), 0.25, 4);
  const R = clamp(Math.round(r * ds), 2, 400);
  const c = soapBubble(R);
  const k = r / R, w = c.width * k * (1 + sq * 0.12), h = c.height * k * (1 - sq * 0.1);
  const sm = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(c, Math.round((x - w / 2) * ds) / ds, Math.round((y - h / 2) * ds) / ds, w, h);
  ctx.imageSmoothingEnabled = sm;
}

// little pixel bubbles bud off the seal's back, float up wobbling and pop into a few droplet pixels
function updateFloaters(st, t, emit, size, on, toScreen) {
  const dt = st.dt, u = size / 40;
  if (on && t > st.floatNext && emit.length) {
    st.floatNext = t + 1.6 + Math.random() * 2.6;
    st.floats.push({ ei: Math.floor(Math.random() * emit.length), x: 0, y: 0, r: Math.max(1.2, size * (0.035 + 0.03 * Math.random())), t: 0, life: 1.4 + Math.random() * 1.2, vx: (Math.random() - 0.5) * 8 * u, vy: -(9 + Math.random() * 9) * u, ph: Math.random() * 9, free: false });
  }
  for (const b of st.floats) {
    b.t += dt;
    if (!b.free) { const e = emit[b.ei % emit.length]; if (e) { const q = toScreen(e); b.x = q[0]; b.y = q[1] - b.r * Math.min(1, b.t / 0.3); } if (b.t > 0.3) b.free = true; continue; }
    b.vy -= 7 * u * dt;
    b.x += (b.vx + Math.sin(b.t * 4.2 + b.ph) * 7 * u) * dt; b.y += b.vy * dt;
    if (b.t > b.life) for (let i = 0; i < 4; i++) { const a = (i / 4) * TAU + b.ph; st.pops.push({ x: b.x + Math.cos(a) * b.r, y: b.y + Math.sin(a) * b.r, vx: Math.cos(a) * 30 * u, vy: Math.sin(a) * 30 * u - 6 * u, t: 0, life: 0.22 }); }
  }
  st.floats = st.floats.filter((b) => b.t <= b.life);
  if (st.floats.length > 6) st.floats.splice(0, st.floats.length - 6);
  for (const p of st.pops) { p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 60 * u * dt; }
  st.pops = st.pops.filter((p) => p.t < p.life);
}
function drawFloaters(ctx, st) {
  const a0 = ctx.globalAlpha;
  for (const b of st.floats) {
    const grow = Math.min(1, b.t / 0.3);
    drawAeroBubble(ctx, b.x, b.y, Math.max(1.2, b.r * (0.45 + 0.55 * grow)), clamp01((b.life - b.t) / 0.25 + 0.4) * clamp01(b.t * 8));
  }
  ctx.fillStyle = '#dff8ff';
  for (const p of st.pops) { ctx.globalAlpha = a0 * (1 - p.t / p.life); ctx.fillRect(Math.round(p.x), Math.round(p.y), 1, 1); }
  ctx.globalAlpha = a0;
}

// ------------------------------------------------------------------------------------------------ the 2D fallback
function flatFrame(size) {
  const s = size, w = Math.ceil(CELL_W * s), h = Math.ceil(CELL_H * s);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  const X = (x) => w / 2 + (x - C0[0]) * s, Y = (y) => h / 2 - (y - C0[1]) * s;
  const body = g.createLinearGradient(0, Y(1.62), 0, Y(0));
  body.addColorStop(0, '#dfe3ef'); body.addColorStop(1, '#fbf6ec');
  g.fillStyle = body;
  g.beginPath(); g.ellipse(X(0), Y(BALL.cy), BALL.a * s, BALL.hy * s, 0, 0, TAU); g.fill();
  g.fillStyle = '#ffffff'; g.beginPath(); g.ellipse(X(-0.32), Y(1.28), 0.2 * s, 0.1 * s, -0.7, 0, TAU); g.fill();
  g.fillStyle = '#272c3a'; g.beginPath(); g.ellipse(X(0.5), Y(0.87), 0.05 * s, 0.04 * s, 0, 0, TAU); g.fill();
  g.fillStyle = '#33c4e6'; g.beginPath(); g.moveTo(X(-0.08), Y(1.55)); g.lineTo(X(0.26), Y(1.55)); g.lineTo(X(0.2), Y(2.02)); g.fill();
  g.fillStyle = '#ff8db4'; g.beginPath(); g.arc(X(0.21), Y(2.06), 0.08 * s, 0, TAU); g.fill();
  g.strokeStyle = '#1b1f2d'; g.lineWidth = Math.max(1, 0.045 * s);
  for (const ex of [0.15, 0.72]) { g.beginPath(); g.ellipse(X(ex), Y(1.08), GLASS.R * s * (ex < 0.5 ? 1 : 0.8), GLASS.R * s, 0, 0, TAU); g.stroke(); }
  outlineCells(c, w, h, SEAL_OUTLINE(s));
  const F = {
    eyes: [{ p: [X(0.15), Y(1.08)], nz: 0.9, ang: 0, side: 1 }, { p: [X(0.72), Y(1.08)], nz: 0.75, ang: 0, side: -1 }],
    lens: [{ p: [X(0.15), Y(1.08)], nz: 0.9, ang: 0, side: 1 }, { p: [X(0.72), Y(1.08)], nz: 0.75, ang: 0, side: -1 }],
    brows: [[X(0.15), Y(1.3)], [X(0.72), Y(1.3)]], nose: [X(0.5), Y(0.87)], mouth: [X(0.5), Y(0.72)],
    muzzle: [[X(0.42), Y(0.78)], [X(0.58), Y(0.78)]], cheeks: [[X(0.02), Y(0.84)], [X(0.8), Y(0.84)]], faceZ: 0.8,
    top: [X(0.21), Y(2.1)], crown: [X(0.05), Y(1.62)], head: [X(0.45), Y(0.96)], hand: [X(0.5), Y(0.2)], hand2: [X(-0.5), Y(0.2)], tail: [X(-0.95), Y(0.3)], bottom: [X(0), Y(0.07)],
    back: [[X(-0.4), Y(1.45)]], dy: 0, cheek: 0,
  };
  return { canvas: c, cw: w, ch: h, cols: 1, n: 1, frames: [F], size, anim: 'flat' };
}
const FLAT = new Map();

// ------------------------------------------------------------------------------------------------ drawSeal
export function pointBucket(ex, ey) { return clamp(Math.round(Math.atan2(-ey, Math.max(1, ex)) / (Math.PI / 6)) + 3, 0, 6); }

// per-seal scratch canvases: the composited frame (body + pixel face) and the low-res face layer
const COMP = new Map();
function scratch(id, w, h) {
  let c = COMP.get(id);
  if (!c) { c = { a: document.createElement('canvas'), f: document.createElement('canvas') }; COMP.set(id, c); if (COMP.size > 24) COMP.delete(COMP.keys().next().value); }
  if (c.a.width !== w || c.a.height !== h) { c.a.width = w; c.a.height = h; }
  return c;
}

export function drawSeal(ctx, o = {}) {
  if (typeof document === 'undefined') return null;
  const view = o.view === 'front' ? 'front' : 'side';
  let anim = animOf(o.anim);
  const t = o.t ?? 0, facing = (o.facing ?? 1) < 0 ? -1 : 1, kk = o.k ?? 1, tilt = o.tilt || 0;
  const size = Math.max(4, o.size ?? 40);
  const ds = devScale(ctx);
  let x = o.x ?? 0, y = o.y ?? 0;
  // pointing: elevation bucket from the target (in the facing frame, tilt removed)
  let bucket = 0;
  if (anim === 'point') {
    if (o.point) {
      const dx = (o.point[0] - x) * facing, dy = o.point[1] - y;
      const c = Math.cos(-tilt * facing), s = Math.sin(-tilt * facing);
      bucket = pointBucket(dx * c - dy * s, dx * s + dy * c);
    } else bucket = 4;
  }
  let sh = null;
  if (lpAvailable()) sh = sheet(anim, devSize(size * kk * ds), view, SHEETS.size === 0);
  if (!sh || !sh.canvas) {
    const fz = sealSize(size);
    sh = FLAT.get(fz) || (FLAT.set(fz, flatFrame(fz)), FLAT.get(fz));
    anim = 'flat';
  }
  const A = SEAL_ANIMS[sh.anim] || { n: 1, dur: 1 };
  const ph = o.phase != null ? o.phase : t / A.dur;
  let fi = ((Math.floor(ph * A.n) % A.n) + A.n) % A.n;
  if (sh.anim === 'point') fi += clamp(bucket, 0, (A.buckets || 1) - 1) * A.n;
  fi = Math.min(fi, sh.n - 1);
  const F = sh.frames[fi];
  const sk = (kk * size) / sh.size; // context units per sheet px (the stand-in sheet may be another size)
  const cw = sh.cw, ch = sh.ch;
  const ride = clamp01(o.ride || 0);
  const rideR = size * kk * 0.55 * (0.35 + 0.65 * ride);
  const lift = (A.dy && sh.anim !== 'flat' ? A.dy((((ph % 1) + 1) % 1)) : F.dy || 0) * sh.size * sk;
  if (o.anchor === 'head') { x -= (F.head[0] - cw / 2) * sk * facing; y -= (F.head[1] - ch / 2) * sk - lift; }
  else if (o.base === 'bottom') y -= (F.bottom[1] - ch / 2) * sk + (ride ? rideR * 1.4 : 0);
  // soft body: squash spring about the bottom + ripple
  const id = o.id ?? 'seal';
  const J = stateOf(id, t, x, y, anim);
  updateJiggle(J, t, x, y, anim, o.talk);
  const sqY = 1 + J.s, sqX = 1 - J.s * 0.7;
  const bY = F.bottom[1], cX = cw / 2;
  const sqp = (p) => [cX + (p[0] - cX) * sqX, bY + (p[1] - bY) * sqY];
  // screen transform of a sprite-local point
  const ct = Math.cos(tilt), stn = Math.sin(tilt);
  const toScreen = (p0) => {
    const p = sqp(p0);
    const lx = (p[0] - cw / 2) * facing * sk, ly = (p[1] - ch / 2) * sk - lift;
    return [x + lx * ct - ly * stn, y + lx * stn + ly * ct];
  };
  const a0 = ctx.globalAlpha;
  if (o.alpha != null) ctx.globalAlpha = a0 * o.alpha;
  // the (subtle) soap bubble it may sit in
  const bot = toScreen([F.bottom[0], F.bottom[1] + lift / Math.max(0.01, sk)]);
  if (ride > 0.02) {
    const sq = ride * (0.5 + 0.5 * Math.sin(t * 2.2));
    const ga = ctx.globalAlpha;
    ctx.globalAlpha = ga * 0.75;
    drawSoapBubble(ctx, bot[0], bot[1] + rideR * 0.5, rideR, sq);
    ctx.globalAlpha = ga;
  }
  // ---- composite the frame: voxel body + a pixel-art face drawn at voxel resolution
  const q = Math.max(1, SEAL_VOXEL * sh.size);                  // sheet px per voxel
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
  let look = null;
  if (o.lookAt) {
    const hd = toScreen(F.head);
    look = [(o.lookAt[0] - hd[0]) * facing, o.lookAt[1] - hd[1]];
  }
  const mood = o.mood || (sh.anim === 'sad' ? 'sad' : sh.anim === 'worried' ? 'worried' : sh.anim === 'cheer' ? 'excited' : sh.anim === 'sleep' ? 'sleepy' : 'happy');
  drawFace(gf, F, { mood, talk: o.talk, t, state: J, look, blink: o.blink }, sh.size);
  // a glossy sweat drop when it is worried
  if (sh.anim === 'worried' || mood === 'worried' || mood === 'scared') {
    const s2 = sh.size, dx = F.crown[0] - s2 * 0.3, dy = F.crown[1] + s2 * 0.16 + ((t * 2) % 1) * s2 * 0.08;
    gf.fillStyle = '#7fdcff';
    gf.beginPath(); gf.moveTo(dx, dy - s2 * 0.12); gf.quadraticCurveTo(dx + s2 * 0.08, dy, dx, dy + s2 * 0.05); gf.quadraticCurveTo(dx - s2 * 0.08, dy, dx, dy - s2 * 0.12); gf.fill();
    gf.fillStyle = '#ffffff'; gf.fillRect(dx - q * 0.5, dy - s2 * 0.04, q, q);
  }
  g.imageSmoothingEnabled = false;
  g.drawImage(SC.f, 0, 0, fw * q, fh * q);
  // ---- draw it in voxel rows: squash-and-stretch about the bottom, a ripple travelling through the rows and a
  // belly jiggle (rows below the middle sway wider)
  ctx.save();
  ctx.translate(x, y);
  if (tilt) ctx.rotate(tilt);
  ctx.translate(0, -lift);
  ctx.scale(facing * sk, sk);
  ctx.translate(-cw / 2, -ch / 2);
  const smooth = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = sk * ds < 0.72; // voxels stay crisp (a stand-in sheet a little too big is drawn nearest too)
  const rows = Math.max(1, Math.round(ch / (q * 2)));
  const rh = ch / rows;
  const amp = J.rip * q * 0.65;
  const ripple = amp > 0.05 || Math.abs(J.s) > 0.004;
  if (!ripple) ctx.drawImage(SC.a, 0, 0);
  else {
    const mid = (F.crown[1] + bY) / 2;
    for (let r = 0; r < rows; r++) {
      const y0 = r * rh, yc = y0 + rh / 2;
      const belly = clamp01((yc - mid) / Math.max(1, bY - mid));
      const dxr = amp * Math.sin(t * 8.5 - (yc / q) * 0.55) * (0.4 + 0.6 * clamp01((bY - yc) / (bY - F.top[1] + 1) + 0.3));
      const wob = 1 + J.talk * 0.035 * belly * Math.sin(t * 17) + belly * J.s * 0.3;
      const w = cw * sqX * wob;
      const dy0 = bY + (y0 - bY) * sqY, dh = rh * sqY;
      ctx.drawImage(SC.a, 0, y0, cw, rh, cX - w / 2 + dxr, dy0, w, dh + 0.6);
    }
  }
  ctx.imageSmoothingEnabled = smooth;
  ctx.restore();
  // little bubbles budding off its back, floating up and popping
  updateFloaters(J, t, F.back || [], size * kk, o.floaters !== false && sh.anim !== 'swim' && sh.anim !== 'flat', toScreen);
  drawFloaters(ctx, J);
  // the little bubble on its nose (thrilled) / the sleepy snot bubble
  let nb = clamp01(o.noseBubble || 0);
  if (sh.anim === 'sleep' && o.noseBubble == null) nb = 0.45 + 0.4 * Math.sin((t / A.dur) * TAU);
  if (nb > 0.02 && F.faceZ > 0) {
    const nz = toScreen(F.nose);
    const r = size * kk * 0.11 * nb;
    drawSoapBubble(ctx, nz[0] + facing * r * 1.2 + Math.sin(t * 3.1) * r * 0.15, nz[1] - r * 0.1 - Math.abs(Math.sin(t * 3.1)) * r * 0.2, r, 0);
  }
  ctx.globalAlpha = a0;
  const out = {
    head: toScreen(F.head), top: toScreen(F.top), mouth: toScreen(F.mouth), nose: toScreen(F.nose), hand: toScreen(F.hand),
    tail: toScreen(F.tail), bottom: bot, center: [x, y],
  };
  const pts = [out.top, out.bottom, out.tail, out.head, out.nose, toScreen(F.crown)];
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const m = size * kk * 0.1;
  const rx0 = Math.min(...xs) - m, ry0 = Math.min(...ys) - m * 0.6;
  out.rect = { x: rx0, y: ry0, w: Math.max(...xs) - rx0 + m, h: Math.max(...ys) - ry0 + m + (ride > 0.1 ? rideR * 1.2 : 0) };
  return out;
}

// A stream of tiny pixel bubbles flowing from the pointing flipper to the target (makes the gesture unmistakable).
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

// ------------------------------------------------------------------------------------------------ the swimmer
// A screen-space guide: smooth physics (paddle strokes, water drag, buoyant bob), heading tilt, bubble trails.
export class SealGuide {
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
    this.bubbles = []; this.drops = [];
    this.shy = [0, 0];
    this.trailT = 0;
    this.anim = 'idle';
    this.anchors = null;
    this.noseB = 0;
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
    anim = SEAL_ANIMS[anim] ? anim : SEAL_ALIAS[anim];
    if (!SEAL_ANIMS[anim]) return this;
    this.emoteA = anim; this.emoteT = 0; this.emoteDur = secs ?? SEAL_ANIMS[anim].dur * (anim === 'clap' ? 4 : anim === 'wiggle' ? 3 : 1);
    if (anim === 'flop' || anim === 'spin') this.popRide();
    return this;
  }

  popRide() {
    if (this.ride < 0.3) return;
    const b = this.anchors?.bottom || [this.x, this.y + this.size * 0.4];
    const r = this.size * 0.62 * this.ride;
    for (let i = 0; i < 10; i++) { const a = (i / 10) * TAU; this.drops.push({ x: b[0] + Math.cos(a) * r, y: b[1] + r * 0.7 + Math.sin(a) * r, vx: Math.cos(a) * 60 * this.u, vy: Math.sin(a) * 60 * this.u - 20, t: 0, life: 0.35 }); }
    this.ride = 0;
    try { this.audio?.play?.('bubble', { vol: 0.35, pitch: 1.3 }); } catch (e) { /* audio is optional */ }
  }

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
    // arrive steering with paddle-stroke thrust and water drag
    const dx = gx - this.x, dy = gy - this.y, d = Math.hypot(dx, dy);
    const maxV = 250 * u * (env.fast ? 1.5 : 1);
    const want = Math.min(maxV, d * 2.7);
    const dvx = d > 0.5 ? (dx / d) * want : 0, dvy = d > 0.5 ? (dy / d) * want : 0;
    const swimming = d > 14 * u || this.speed > 40 * u;
    this.swimPh += dt * (swimming ? 1.1 + this.speed / (150 * u) : 0.4);
    const stroke = swimming ? 0.45 + 1.1 * Math.max(0, Math.sin(this.swimPh * TAU)) ** 2 : 1;
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
    // the ride bubble: rests on one, pops it when it swims off
    const rest = sp < 22 * u && (anim === 'idle' || anim === 'point' || anim === 'blow' || anim === 'wave' || anim === 'think' || anim === 'clap');
    this.settleT = rest ? this.settleT + dt : 0;
    if (this.settleT > 0.45 && !env.noRide) this.ride = Math.min(1, this.ride + dt * 2.5);
    if ((sp > 80 * u || env.noRide) && this.ride > 0.25) this.popRide();
    else if (sp > 80 * u) this.ride = 0;
    // bubble trail
    this.trailT -= dt;
    if (sp > 45 * u && this.trailT <= 0 && this.anchors) {
      this.trailT = 0.035 + Math.random() * 0.05;
      const tl = this.anchors.tail;
      this.bubbles.push({ x: tl[0] + (Math.random() - 0.5) * 6 * u, y: tl[1] + (Math.random() - 0.5) * 6 * u, vx: -this.vx * 0.12, vy: -10 - Math.random() * 25, r: (1 + Math.random() * 2.4) * Math.max(0.8, u), t: 0, life: 0.8 + Math.random() * 1.0, ph: Math.random() * 9 });
    }
    // blowing bubbles while it rests and is not talking
    this.idleT = anim === 'idle' && !env.talk ? this.idleT + dt : 0;
    this.blowT -= dt;
    if (this.blowT <= 0 && this.idleT > 2 && !this.blowB) { this.blowB = { r: 0.5, grow: true, t: 0 }; this.blowT = 6 + Math.random() * 6; }
    if (this.blowB) {
      const B = this.blowB;
      B.t += dt;
      if (B.grow) {
        B.r = Math.min(5.5 * u, B.r + dt * 5 * u);
        if (B.t > 1.15 || anim !== 'blow' && B.t > 0.3) {
          B.grow = false;
          const m2 = this.anchors?.mouth || [this.x, this.y];
          this.bubbles.push({ x: m2[0] + this.facing * B.r, y: m2[1], vx: this.facing * 14, vy: -18, r: B.r, t: 0, life: 2.4, ph: 0, big: true });
          this.blowB = null;
        }
      }
    }
    // nose bubble when it is thrilled
    this.noseB += ((env.excited || anim === 'clap' || anim === 'wiggle') && sp < 40 * u ? 1 : -1) * dt * 3;
    this.noseB = clamp01(this.noseB);
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
    return { x: this.x - s * 1.2, y: this.y - s * 0.9, w: s * 2.4, h: s * 1.6 };
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
    const bob = Math.sin(this.t * 1.7) * 2.2 * this.u * (this.speed < 60 * this.u ? 1 : 0.3);
    const a0 = ctx.globalAlpha;
    ctx.globalAlpha = a0 * (o.alpha ?? 1);
    this.drawBubbles(ctx);
    const anim = SEAL_ANIMS[o.anim] ? o.anim : SEAL_ALIAS[o.anim] || this.anim;
    const phase = anim === 'swim' ? this.swimPh : this.animT / (SEAL_ANIMS[anim]?.dur || 1);
    const A = drawSeal(ctx, {
      x: this.x, y: this.y + bob, t, size: this.size, facing: this.facing, tilt: this.tilt, anim, phase,
      point: this.pointP, mood: o.mood, talk: o.talk, lookAt: o.lookAt || this.pointP, ride: this.ride, noseBubble: this.noseB, id: this.id,
    });
    if (A && anim === 'point' && this.pointP && o.stream !== false) drawPointStream(ctx, A.hand, this.pointP, this.t, this.u);
    // the bubble it is blowing
    if (this.blowB && A) drawSoapBubble(ctx, A.mouth[0] + this.facing * this.blowB.r * 0.9, A.mouth[1] + this.blowB.r * 0.2, this.blowB.r);
    ctx.globalAlpha = a0;
    this.anchors = A;
    return A;
  }
}
