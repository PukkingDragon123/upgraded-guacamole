// Bubbles, the guide (phase 8, Creatures agent): a chubby PLUSH SEAL in high-resolution VOXEL art (after the user's
// plush reference): an almost round, squishy loaf with no neck, soft grey-white fur dappled with darker grey spots, a
// small flat face on the front (puffy muzzle pads, a tiny nose), tiny side flippers and a little tail flipper pair. Each
// pose is modelled as a smooth painted mesh and then VOXELISED (src/fish/voxelize.js: fine voxels, soft baked AO) and
// rendered with plush shading + a glossy Aero rim. The small dark eyes (with a sparkle), blush, the talking mouth,
// whisker dots and moods are drawn live on top AT VOXEL RESOLUTION (a low-res layer scaled up crisp), so blinking,
// gaze and lip-sync cost nothing. It is BOUNCY and JIGGLY: a per-seal squash spring (kicked by acceleration, landings,
// animation changes and talking) squashes and stretches it about its bottom, and the frame is drawn in voxel rows with
// a ripple travelling through the body and a belly wobble. A subtle soap bubble seat (ride) and a little bubble on its
// nose remain optional extras.
//
// Frames are CACHED: every animation cycle is rendered once per size into one sprite sheet (lowpoly renderSheet: one
// GL pass + one readback), at most one new sheet per frame (otherwise the nearest cached sheet stands in).
//
//   SEAL_INFO                          {id: 'seal', name: 'Bubbles', role, desc, color, h}
//   SEAL_ANIMS                         idle talk swim wiggle wave point flop spin worried clap think blow
//   drawSeal(ctx, o) -> anchors        o: {x, y (body centre; o.base = 'bottom' -> y is the bottom), t, size (px per
//       model unit, bucketed), k (extra draw scale, smoothed), facing (1 right / -1 left), anim, phase (0..1 override),
//       point: [sx, sy] (the flipper points there), tilt (rad), mood, talk 0..1, lookAt [sx, sy], blink, ride 0..1
//       (the soap bubble under it), noseBubble 0..1, view: 'side' | 'front' (portrait), id (blink/gaze state), alpha}
//     anchors: {head, top, mouth, nose, hand (pointing flipper tip), tail, bottom, rect {x, y, w, h}} (screen)
//   warmSeal(size, anims)               pre-render sheets (call from a loading step)
//   sealReady(size)                     the idle sheet exists
//   new SealGuide({x, y, size, audio, id})  a screen-space swimmer with smooth physics:
//       .goTo(x, y, {snap}) .pointAt([sx, sy] | null) .emote(anim, secs) .update(dt, {W, H, cursor, talk})
//       .draw(ctx, {t, talk, mood, lookAt, alpha}) -> anchors .rect() .hit(x, y) .settled .speed .anim
//       swims with paddle strokes, tilts with its heading, faces its target, points when it arrives, rides a
//       bubble when it rests (pops it when it leaves), shies away from the cursor, trails bubbles, blows bubbles.

import { LPMesh, renderSheet, lpProject, lpAvailable, T4 } from './lowpoly.js';
import { voxelizeMesh } from '../fish/voxelize.js';
import { clamp, clamp01, lerp, TAU } from '../core/math.js';
import { drawAeroBubble } from '../ui/aero.js';

export const SEAL_INFO = {
  id: 'seal', name: 'Bubbles', role: 'Guide', color: '#bfefff', h: 56,
  desc: 'A round, squishy, very jiggly seal pup who blows bubbles and knows every fish in the sea (by smell).',
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

// ------------------------------------------------------------------------------------------------ palette
// (phase 8) the chubby plush seal: soft grey-white fur dappled with grey spots, a cream belly and muzzle, slate flippers
const C = {
  fur: rgb('#eef0f4'), furMid: rgb('#dfe2e9'), belly: rgb('#f8f7f3'), back: rgb('#d3d7df'),
  spot: rgb('#8d95a5'), spotD: rgb('#646c7d'), muzzle: rgb('#fafaf7'), chin: rgb('#f1efea'),
  flip: rgb('#9aa1ad'), flipTip: rgb('#747b88'), nose: rgb('#2b2d35'), noseHi: rgb('#4c5060'),
};
// the look (lowpoly shader options): soft plush shading with a glossy Frutiger Aero rim and sky sheen
const LOOK = { ambient: 0.62, spec: 0.22, shine: 20, soft: 0.5, softColor: '#ffd8e0', rim: 0.45, rimColor: '#c4f2ff', env: 0.12, iri: 0.05, sky: '#f2fdff', ground: '#a8d4ee', light: [-0.42, 0.72, 0.75] };
// voxel edge in model units (the body is ~2 units long: ~45 voxels nose to tail)
export const SEAL_VOXEL = 0.043;

// ------------------------------------------------------------------------------------------------ geometry
// Model space: x forward (the face), y up, z toward the near (+z) side. One fat, almost round loaf (no neck): the face
// sits on its front, tiny flippers under its sides and a small tail flipper pair at the back.
const LOAF = { x0: -0.94, x1: 0.84, xc: -0.05, a: 0.89, hy: 0.66, hz: 0.68, cy: 0.46 };
const BODY_SEG = 26, BODY_ROWS = 28;
const PIV = [-0.1, 0.0, 0];             // squash pivot (bottom centre)
const HEADP = [0.12, 0.44, 0];          // the face region pivots here (no neck: a soft weighted twist)
const HEAD_C = [0.55, 0.56, 0];           // "head" anchor (centre of the face region)
const EYE_R = 0.1;
const FACE = { eyeX: 0.775, eyeA: 0.66, eyeY: 0.0, nose: [0.862, 0.535, 0], mouth: [0.85, 0.4, 0], muzzle: [0.8, 0.465, 0.08], cheekX: 0.72, cheekA: 1.12, top: [0.2, 1.12, 0] };
const SHOULDER = [0.3, 0.12, 0.6];
const HIP = [-0.87, 0.36, 0.07];
const C0 = [-0.1, 0.42, 0];             // sprite centre (model point at the sheet cell centre)
const CELL_W = 3.0, CELL_H = 2.5;      // cell size in model units
// rest body section at x: [centre y, half height, half width]
function loafAt(x) {
  const t = clamp((x - LOAF.xc) / LOAF.a, -1, 1);
  let f = Math.pow(Math.max(0, 1 - Math.pow(Math.abs(t), 2.5)), 1 / 2.5);
  if (t < 0) f *= 1 - 0.1 * t * t;      // a softly tapering rear
  return [LOAF.cy + 0.035 * Math.max(0, t) - 0.04 * Math.max(0, -t) * Math.max(0, -t), LOAF.hy * f, LOAF.hz * f];
}
// surface point of the rest loaf at x and section angle a (0 = top, PI/2 = +z flank, PI = bottom); pillowy sections
function loafPt(x, a) {
  const [cy, hy, hz] = loafAt(x);
  const c = Math.cos(a), s = Math.sin(a);
  let y = Math.sign(c) * Math.pow(Math.abs(c), 0.8) * hy;
  if (y < 0) { y *= 0.92; if (y < -0.72 * hy) y = -0.72 * hy + (y + 0.72 * hy) * 0.35; } // sits flat on its belly
  return [x, cy + y, Math.sign(s) * Math.pow(Math.abs(s), 0.8) * hz];
}
function loafN(x, a) {
  const e = 0.01;
  const p0 = loafPt(x, a), px = loafPt(x + e, a), pa = loafPt(x, a + e);
  let n = norm(cross(sub(px, p0), sub(pa, p0)));
  const out = sub(p0, [x, loafAt(x)[0], 0]);
  if (dot(n, out) < 0) n = scl(n, -1);
  return n;
}

// A tiny builder with PER-VERTEX colours (the painted look: colours blend across a facet, lighting stays faceted),
// producing the shared renderer's LPMesh (11 floats per vertex: position, flat normal, colour, uv).
class PaintMesh {
  constructor() { this.buf = new Float32Array(33 * 1400); this.n = 0; }
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
  const col = rows.map((r) => r.map(paint));
  const pos = rows.map((r) => r.map(deform));
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
  const P = ring.map(deform), K = ring.map(paint);
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
  const n = vnoise(p[0] * 9 * scale + 3.1, p[1] * 9 * scale, p[2] * 9 * scale + 7.7) * 0.7 + vnoise(p[0] * 21 * scale, p[1] * 21 * scale + 4.2, p[2] * 21 * scale) * 0.3;
  return n;
}
function paintBody(p) {
  const [cy, hy] = loafAt(p[0]);
  const up = clamp((p[1] - cy) / Math.max(0.05, hy), -1, 1);
  let c = up < -0.25 ? mixC(C.fur, C.belly, clamp01((-up - 0.25) * 2)) : mixC(C.fur, C.back, clamp01(up) * 0.75);
  c = mixC(c, C.furMid, clamp01((-p[0] - 0.3) / 0.7) * 0.5);
  // the face: a clean pale mask around the muzzle, finer freckles toward the eyes
  const face = clamp01((p[0] - 0.5) / 0.25) * clamp01(1 - Math.abs(p[2]) / 0.4) * clamp01(1 - Math.abs(p[1] - 0.5) / 0.3);
  const d = dapple(p, 1 + face * 0.8);
  const th = 0.56 + 0.1 * clamp01(-up * 1.5) + face * 0.12;
  if (d > th) c = mixC(c, d > th + 0.06 ? C.spotD : C.spot, 1 - 0.4 * clamp01(-up));
  return lit(c, 1 + (h3(Math.round(p[0] * 23), Math.round(p[1] * 23), Math.round(p[2] * 23)) - 0.5) * 0.04);
}
const paintMuzzle = (q) => lit(mixC(C.muzzle, C.chin, clamp01((0.45 - q[1]) * 6)), 1 + (h3(Math.round(q[0] * 30), Math.round(q[1] * 30), Math.round(q[2] * 30)) - 0.5) * 0.03);
const paintNose = (q) => (q[1] > 0.545 && q[0] > 0.875 ? C.noseHi : C.nose);
function paintFlip(t) { return (q) => { const c = mixC(C.flip, C.flipTip, clamp01((q[0] / t - 0.4) * 1.5)); return lit(c, dapple(q, 2) > 0.62 ? 0.88 : 1); }; }

// ---- the pose
function P0() {
  return {
    yaw: -0.88, tilt: 0.22, rz: 0, sq: [1, 1, 1], bend: 0, wave: 0, wph: 0, side: 0,
    head: [0, -0.22, 0], hdy: 0, hsq: 1, fl: [-0.5, -0.6, 0.62], fr: [-0.5, -0.6, -0.62], flLen: 1, frLen: 1,
    flTw: 0, frTw: 0, shN: 0, shF: 0, tail: 0.12, spread: 0.45, flap: 0, cheek: 0, dy: 0,
  };
}

// body deformation: squash about the bottom, swim wave, sway; then the face region twists softly (no neck)
function bodyDeform(P) {
  const [sx, sy, sz] = P.sq;
  const [hp0, hy0, hr0] = P.head;
  const hp = hp0 * 0.55, hyw = (hy0 + 0.22) * 0.6, hr = hr0 * 0.6;
  return (p) => {
    // the face twist first (rest coordinates), weighted toward the front
    let q = p;
    const w = clamp01((p[0] - HEADP[0]) / 0.6);
    const ww = w * w * (3 - 2 * w);
    if (ww > 0 && (hp || hyw || hr || P.hdy || P.hsq !== 1)) {
      let v = sub(p, HEADP);
      v = [v[0], v[1] * (1 + (P.hsq - 1) * ww), v[2]];
      v = rx(v, hr * ww); v = rz(v, hp * ww); v = ry(v, hyw * ww);
      q = add(add(HEADP, v), [0, P.hdy * ww, 0]);
    }
    let x = PIV[0] + (q[0] - PIV[0]) * sx, y = PIV[1] + (q[1] - PIV[1]) * sy, z = q[2] * sz;
    const u = q[0] - PIV[0];
    y += P.bend * u * u * 0.5;
    if (P.wave) y += P.wave * Math.sin(P.wph - (q[0] - 0.4) * 3.0) * Math.pow(clamp01((0.35 - q[0]) / 1.4), 1.1);
    if (P.side) z += P.side * Math.sign(u) * u * u * 0.6;
    return [x, y, z];
  };
}

// a flattened paddle along +x of length L in local space, oriented with direction D (and broad-face hint T)
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

// ---- [phase9:seal] cute round GLASSES: voxel rims floating just in front of each eye, a little arched bridge over
// the snout and temple arms running back along the sides of the head (all in rest space, so they follow the pose's
// face twist and squash; the voxeliser turns the thin tubes into crisp 1-2 voxel frames)
const GLASS = { R: 0.182, tube: 0.021, lift: 0.036, armX: 0.42, col: rgb('#1b1f2d'), hi: rgb('#3c4560') };
const eyeRest = (sd) => { const q = loafPt(FACE.eyeX, FACE.eyeA * sd); return [q[0], q[1] + FACE.eyeY, q[2]]; };
// tube rows along a polyline (closed: a ring): each row is a small circle around the path
function tubeRows(pts, r, M = 6, closed = false) {
  const n = pts.length, rows = [];
  for (let i = 0; i < n; i++) {
    const a = closed ? pts[(i - 1 + n) % n] : pts[Math.max(0, i - 1)], b = closed ? pts[(i + 1) % n] : pts[Math.min(n - 1, i + 1)];
    const T = norm(sub(b, a));
    let b1 = cross(T, Math.abs(T[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0]);
    b1 = norm(b1);
    const b2 = cross(T, b1), row = [];
    for (let j = 0; j < M; j++) { const f = (j / M) * TAU; row.push(add(pts[i], add(scl(b1, Math.cos(f) * r), scl(b2, Math.sin(f) * r)))); }
    rows.push(row);
  }
  if (closed) rows.push(rows[0]);
  return rows;
}
// rim geometry of the eye on side sd: centre, plane basis (u, v), normal
function lensOf(sd) {
  const q = eyeRest(sd), n = loafN(FACE.eyeX, FACE.eyeA * sd);
  const c = add(q, scl(n, GLASS.lift));
  const u = norm(cross(n, [0, 1, 0])), v = norm(cross(u, n));
  return { c, n, u, v };
}
// the point on the rim of lens L in the in-plane direction closest to `dir`
function rimToward(L, dir) {
  const a = dot(dir, L.u), b = dot(dir, L.v), l = Math.hypot(a, b) || 1;
  return add(L.c, scl(add(scl(L.u, a / l), scl(L.v, b / l)), GLASS.R));
}
function addGlasses(mb, def) {
  const L = [lensOf(1), lensOf(-1)];
  const paint = (L0) => (q) => (q[1] > L0.c[1] + GLASS.R * 0.72 ? GLASS.hi : GLASS.col);
  // rims
  for (const Lk of L) {
    const ring = [];
    for (let i = 0; i < 22; i++) { const f = (i / 22) * TAU; ring.push(add(Lk.c, add(scl(Lk.u, Math.cos(f) * GLASS.R), scl(Lk.v, Math.sin(f) * GLASS.R)))); }
    sheetMesh(mb, tubeRows(ring, GLASS.tube, 6, true), paint(Lk), def);
  }
  // the bridge: a little arch over the top of the snout, pushed forward so it clears the face
  const a = rimToward(L[0], sub(L[1].c, L[0].c)), b = rimToward(L[1], sub(L[0].c, L[1].c));
  const k = [Math.max(a[0], b[0]) + 0.05, (a[1] + b[1]) / 2 + 0.035, 0];
  const br = [];
  for (let i = 0; i <= 8; i++) { const t = i / 8, s = 1 - t; br.push(add(add(scl(a, s * s), scl(k, 2 * s * t)), scl(b, t * t))); }
  sheetMesh(mb, tubeRows(br, GLASS.tube * 0.9, 6), () => GLASS.col, def);
  // temple arms: from the outer edge of each rim back along the side of the head, just above the fur
  for (const sd of [1, -1]) {
    const Lk = L[sd > 0 ? 0 : 1];
    const p0 = rimToward(Lk, [-0.6, 0.05, sd]);
    const yT = p0[1] - 0.02, pts = [p0];
    for (let i = 1; i <= 6; i++) {
      const x = lerp(p0[0] - 0.04, GLASS.armX, i / 6);
      let best = 0, bd = Infinity;
      for (let s = 0; s <= 48; s++) { const an = (s / 48) * Math.PI * 0.6 * sd; const d = Math.abs(loafPt(x, an)[1] - yT); if (d < bd) { bd = d; best = an; } }
      pts.push(add(loafPt(x, best), scl(loafN(x, best), GLASS.lift * 0.8)));
    }
    sheetMesh(mb, tubeRows(pts, GLASS.tube * 0.8, 5), () => GLASS.col, def);
  }
}

// Build the (voxel) seal for pose P -> {mesh, A (model-space anchors)}
function buildSeal(P) {
  const mb = new PaintMesh();
  const def = bodyDeform(P);
  // the loaf: rows of pillowy sections, denser toward the round ends
  const rows = [];
  for (let i = 0; i <= BODY_ROWS; i++) {
    const k = i / BODY_ROWS, x = LOAF.x0 + (LOAF.x1 - LOAF.x0) * (0.5 - 0.5 * Math.cos(k * Math.PI));
    const row = [];
    for (let j = 0; j < BODY_SEG; j++) row.push(loafPt(x, (j / BODY_SEG) * TAU));
    rows.push(row);
  }
  sheetMesh(mb, rows, paintBody, def);
  capFan(mb, rows[0], [LOAF.x0 - 0.005, loafAt(LOAF.x0)[0], 0], paintBody, def, false);
  capFan(mb, rows[rows.length - 1], [LOAF.x1 + 0.005, loafAt(LOAF.x1)[0], 0], paintBody, def, true);
  // the face: two puffy muzzle pads (puff out when blowing), a little chin, the tiny nose
  const pk = 1 + P.cheek * 0.35;
  for (const sd of [1, -1]) sheetMesh(mb, ellRows([FACE.muzzle[0], FACE.muzzle[1], FACE.muzzle[2] * sd * (1 + P.cheek * 0.2)], [0.095 * pk, 0.085 * pk, 0.1 * pk], 10, 6), paintMuzzle, def);
  sheetMesh(mb, ellRows([0.785, 0.395, 0], [0.07, 0.05, 0.085], 8, 5), paintMuzzle, def);
  sheetMesh(mb, ellRows(FACE.nose, [0.034, 0.03, 0.05], 8, 5), paintNose, def);
  addGlasses(mb, def); // [phase9:seal]
  // tiny front flippers under the sides
  const shN = def([SHOULDER[0] + 0.12 * P.shN, SHOULDER[1] + 0.22 * P.shN, SHOULDER[2] + 0.2 * P.shN]);
  const shF = def([SHOULDER[0] + 0.12 * P.shF, SHOULDER[1] + 0.22 * P.shF, -SHOULDER[2] - 0.2 * P.shF]);
  const fw = [0.08, 0.12, 0.13, 0.1, 0.04], ft = [0.06, 0.05, 0.042, 0.034, 0.022];
  const tipF = paddle(mb, shF, P.fr, [0.1, 0.3, -1], 0.34 * P.frLen * (1 + 0.4 * P.shF), fw, ft, paintFlip(0.34 * P.frLen * (1 + 0.4 * P.shF)), P.frTw);
  const tipN = paddle(mb, shN, P.fl, [0.1, 0.3, 1], 0.34 * P.flLen * (1 + 0.4 * P.shN), fw, ft, paintFlip(0.34 * P.flLen * (1 + 0.4 * P.shN)), P.flTw);
  // the tail flipper pair follows the rear's slope
  const t0 = def([-0.75, 0.38, 0]), t1 = def([-0.9, 0.38, 0]);
  const slope = Math.atan2(t1[1] - t0[1], t0[0] - t1[0]);
  for (const sd of [1, -1]) {
    const base = def([HIP[0], HIP[1], HIP[2] * sd]);
    const ang = P.tail + 0.1 + slope * 0.8 + P.flap * sd * 0.5 + P.flap;
    const D = [-Math.cos(ang) * Math.cos(P.spread * 0.8), Math.sin(ang), Math.sin(P.spread * 0.8) * sd];
    paddle(mb, base, D, [0, 1, 0], 0.3, [0.06, 0.1, 0.15, 0.17, 0.12], [0.05, 0.04, 0.032, 0.026, 0.018], paintFlip(0.3));
  }
  const raw = mb.build();
  const mesh = voxelizeMesh(raw, SEAL_VOXEL, { jitter: 0.015, ao: 0.4 }) || raw;
  if (mesh !== raw) raw.dispose?.();
  // anchors (posed)
  const eyeP = (sd) => { const a = FACE.eyeA * sd; const q = loafPt(FACE.eyeX, a); return [q[0], q[1] + FACE.eyeY, q[2]]; };
  const nrmD = (p, n) => norm(sub(def(add(p, scl(n, 0.05))), def(p)));
  const A = {
    eyes: [1, -1].map((sd) => { const q = eyeP(sd); return { p: def(q), n: nrmD(q, loafN(FACE.eyeX, FACE.eyeA * sd)), side: sd }; }),
    brows: [1, -1].map((sd) => { const q = eyeP(sd); return def([q[0] - 0.03, q[1] + 0.225, q[2] * 0.97]); }), // [phase9:seal] above the frames
    lens: [1, -1].map((sd) => { const L = lensOf(sd); return { p: def(L.c), n: nrmD(L.c, L.n), side: sd }; }),
    nose: def(FACE.nose), mouth: def(FACE.mouth), faceN: nrmD(FACE.nose, [1, -0.1, 0]),
    muzzle: [1, -1].map((sd) => def([FACE.muzzle[0] + 0.03, FACE.muzzle[1], FACE.muzzle[2] * sd * (1 + P.cheek * 0.3)])),
    cheeks: [1, -1].map((sd) => def(loafPt(FACE.cheekX, FACE.cheekA * sd))),
    cheekN: [1, -1].map((sd) => nrmD(loafPt(FACE.cheekX, FACE.cheekA * sd), loafN(FACE.cheekX, FACE.cheekA * sd))),
    top: def(FACE.top), head: def(HEAD_C), hand: tipN, hand2: tipF, tail: def([-1.08, 0.38, 0]),
    bottom: def([-0.1, -0.05, 0]),
  };
  return { mesh, A };
}

// ------------------------------------------------------------------------------------------------ animations
// n frames per cycle, dur seconds per cycle, buckets (point: 7 elevations), fn(P, k, bucket) mutates the pose.
const S = Math.sin, CO = Math.cos;
const POINT_E = [-90, -60, -30, 0, 30, 60, 90].map((d) => (d * Math.PI) / 180);
export const SEAL_ANIMS = {
  idle: { n: 12, dur: 2.6, fn(P, k) {
    const s = S(k * TAU);
    P.sq = [1 - 0.012 * s, 1 + 0.03 * s, 1 + 0.015 * s];
    P.head = [0.06 + 0.04 * S(k * TAU + 0.7), -0.24, 0.04 * s];
    P.hdy = 0.012 * s;
    P.fl = [-0.5 + 0.14 * S(k * TAU), -0.6, 0.62]; P.fr = [-0.5 + 0.14 * S(k * TAU + 1), -0.6, -0.62];
    P.tail = 0.14 + 0.07 * S(k * TAU + 1.3);
  } },
  swim: { n: 12, dur: 0.72, fn(P, k) {
    const a = k * TAU;
    P.wave = 0.075; P.wph = a;
    P.sq = [1.05, 0.97, 0.98];
    P.head = [-0.08 + 0.05 * S(a + 1.2), -0.16, 0];
    const st = 0.5 + 0.5 * S(a);
    P.fl = norm([lerp(0.35, -0.85, st), lerp(-0.75, -0.25, st), 0.55]); P.fr = norm([lerp(0.35, -0.85, st), lerp(-0.75, -0.25, st), -0.55]);
    P.flTw = P.frTw = 0.4 * CO(a);
    P.tail = 0.05; P.flap = 0.32 * S(a - 1.4); P.spread = 0.3;
  } },
  wiggle: { n: 8, dur: 0.55, fn(P, k) {
    const s = S(k * TAU);
    P.side = 0.16 * s; P.head = [0.1, -0.26, -0.16 * s]; P.dy = 0.05 * Math.abs(S(k * TAU));
    P.fl = [0.1, -0.25 + 0.5 * s, 0.9]; P.fr = [0.1, -0.25 - 0.5 * s, -0.9];
    P.tail = 0.25; P.flap = 0.25 * s; P.spread = 0.6;
  } },
  wave: { n: 8, dur: 0.9, fn(P, k) {
    SEAL_ANIMS.idle.fn(P, k);
    const s = S(k * TAU);
    P.fl = norm([0.15 + 0.42 * s, 0.95, 0.55]); P.shN = 0.9;
    P.head = [0.12, -0.32, 0.13]; P.flLen = 1.3;
  } },
  point: { n: 4, dur: 1.1, buckets: 7, fn(P, k, b) {
    SEAL_ANIMS.idle.fn(P, k * 0.5);
    const e = POINT_E[b];
    P.rz = clamp(e, -1.2, 1.2) * 0.26;
    P.head = [e * 0.22, -0.2, 0.05];
    P.shN = 1;
    P.fl = solvePoint(P, e);
    P.flTw = 0.5;
    P.flLen = 1.6 + 0.1 * S(k * TAU) + 0.25 * Math.max(0, Math.sin(e));
  } },
  flop: { n: 14, dur: 1.15, fn(P, k) {
    if (k < 0.16) { const q = k / 0.16; P.sq = [1 + 0.08 * q, 1 - 0.13 * q, 1 + 0.05 * q]; P.fl = [-0.5, -0.6, 0.6]; P.fr = [-0.5, -0.6, -0.6]; }
    else if (k < 0.5) {
      const q = (k - 0.16) / 0.34;
      P.dy = S(q * Math.PI) * 0.62; P.sq = [0.94, 1.1, 0.96]; P.rz = 0.25 - q * 0.45;
      P.fl = [0.2, 0.8, 0.7]; P.fr = [0.2, 0.8, -0.7]; P.tail = 0.5; P.head = [0.2 - q * 0.3, -0.2, 0];
    } else if (k < 0.62) {
      const q = (k - 0.5) / 0.12;
      P.sq = [1 + 0.18 * q, 1 - 0.27 * q, 1 + 0.16 * q]; P.bend = -0.1 * q;
      P.fl = [0.15, 0.05, 1]; P.fr = [0.15, 0.05, -1]; P.tail = 0.3; P.spread = 0.8; P.head = [-0.08, -0.22, 0];
    } else {
      const q = (k - 0.62) / 0.38, j = S(q * Math.PI * 3) * (1 - q);
      P.sq = [1 + 0.18 * (1 - q) * 0.6 + 0.05 * j, 1 - 0.27 * (1 - q) * 0.6 - 0.08 * j, 1 + 0.1 * (1 - q)];
      P.fl = [lerp(0.15, -0.5, q), lerp(0.05, -0.6, q), lerp(1, 0.62, q)]; P.fr = [lerp(0.15, -0.5, q), lerp(0.05, -0.6, q), -lerp(1, 0.62, q)];
      P.spread = lerp(0.8, 0.45, q); P.head = [0.05 * j, -0.24, 0.06 * j];
    }
  } },
  spin: { n: 16, dur: 0.85, fn(P, k) {
    P.yaw = -0.88 - k * TAU;
    P.dy = S(k * Math.PI) * 0.14; P.sq = [0.97, 1.05, 0.97];
    P.fl = [0.05, 0.3, 0.95]; P.fr = [0.05, 0.3, -0.95]; P.head = [0.12, -0.15, 0]; P.tail = 0.3; P.spread = 0.7;
  } },
  worried: { n: 8, dur: 0.5, fn(P, k) {
    const j = (Math.floor(k * 8) % 2 ? 1 : -1);
    P.sq = [0.97, 0.94, 0.98]; P.head = [-0.1, -0.24, 0.035 * j]; P.hdy = -0.03; P.hsq = 0.97;
    P.fl = [0.6, 0.62, -0.25]; P.fr = [0.6, 0.62, 0.25]; P.shN = P.shF = 0.7; P.flLen = P.frLen = 0.95; P.tail = 0.05; P.spread = 0.25;
  } },
  clap: { n: 6, dur: 0.34, fn(P, k) {
    const open = 0.5 + 0.5 * CO(k * TAU);
    P.head = [0.2, -0.25, 0]; P.dy = 0.03 * (1 - open);
    P.fl = norm([0.85, 0.3, -0.25 + open * 0.95]); P.fr = norm([0.85, 0.3, 0.25 - open * 0.95]); P.shN = P.shF = 0.6; P.flLen = P.frLen = 1.15;
    P.tail = 0.3 + 0.1 * open; P.flap = 0.15 * open;
  } },
  think: { n: 8, dur: 2.2, fn(P, k) {
    SEAL_ANIMS.idle.fn(P, k);
    P.fl = [0.72, 0.5, -0.4]; P.shN = 0.8; P.flLen = 1.0; P.head = [0.14, -0.3, 0.2 + 0.03 * S(k * TAU)];
  } },
  blow: { n: 8, dur: 1.4, fn(P, k) {
    SEAL_ANIMS.idle.fn(P, k);
    P.cheek = S(clamp01(k / 0.8) * Math.PI) ** 0.6; P.head = [0.16, -0.22, 0];
  } },
};
// old guide poses / moods -> seal animations
export const SEAL_ALIAS = { talk: 'idle', cheer: 'clap', laugh: 'wiggle', sad: 'worried', bend: 'worried', excited: 'wiggle', happy: 'idle', love: 'wiggle', surprised: 'idle' };

// near flipper direction (model space) that points at screen elevation e (rad, up = +) and comes out in front of
// the body (toward the viewer), so the gesture reads clearly
function solvePoint(P, e) {
  const m = T4.rot(P.tilt, P.yaw, P.rz);
  const q = norm([Math.cos(e) + 0.55 * Math.max(0, Math.sin(e)), Math.sin(e), 0.45 + 0.6 * Math.max(0, Math.sin(e)) + 0.2 * Math.max(0, -Math.sin(e))]);
  return norm([m[0] * q[0] + m[1] * q[1] + m[2] * q[2], m[4] * q[0] + m[5] * q[1] + m[6] * q[2], m[8] * q[0] + m[9] * q[1] + m[10] * q[2]]);
}

function pose(anim, k, b, view) {
  const P = P0();
  if (view === 'front') { P.yaw = -1.15; P.tilt = 0.16; }
  SEAL_ANIMS[anim].fn(P, k, b);
  if (view === 'front' && anim !== 'spin') P.yaw = -1.15;
  return P;
}

// ------------------------------------------------------------------------------------------------ sheets (cache)
const SHEETS = new Map();
let budgetT = -1e9, budgetN = 0;
const SIZES = [16, 20, 24, 28, 32, 36, 40, 44, 48, 56, 64, 72, 80, 96, 112, 128];
export function sealSize(s) { for (const z of SIZES) if (z >= s - 1.5) return z; return SIZES[SIZES.length - 1]; }

function project(A, o, m) {
  const pr = (p) => lpProject(p, o);
  const rot = (n) => [m[0] * n[0] + m[4] * n[1] + m[8] * n[2], m[1] * n[0] + m[5] * n[1] + m[9] * n[2], m[2] * n[0] + m[6] * n[1] + m[10] * n[2]];
  return {
    eyes: A.eyes.map((e) => { const n = rot(e.n); return { p: pr(e.p), nz: n[2], ang: Math.atan2(-n[1], n[0]), side: e.side }; }),
    lens: A.lens.map((e) => { const n = rot(e.n); return { p: pr(e.p), nz: n[2], ang: Math.atan2(-n[1], n[0]), side: e.side }; }),
    brows: A.brows.map(pr), nose: pr(A.nose), mouth: pr(A.mouth), muzzle: A.muzzle.map(pr), cheeks: A.cheeks.map(pr), cheekZ: A.cheekN.map((n) => rot(n)[2]),
    faceZ: rot(A.faceN)[2], top: pr(A.top), head: pr(A.head), hand: pr(A.hand), hand2: pr(A.hand2), tail: pr(A.tail), bottom: pr(A.bottom),
  };
}

// [phase9:seal] crisp dark ink outline around the silhouette, baked into the cached sheet once (like the fish's
// outlineSheet): every transparent pixel touching an opaque one in the same cell turns ink; big sheets get 2 px so
// the line still reads once scaled down. The jiggle / squash draw the outlined frame, so the line follows them.
const INK = [14, 16, 28];
export const SEAL_OUTLINE = (size) => (size >= 52 ? 2 : 1);
function outlineCells(canvas, cw, ch, passes) {
  const W = canvas.width, H = canvas.height;
  if (!W || !H) return;
  let g;
  try { g = canvas.getContext('2d', { willReadFrequently: true }); } catch { return; }
  if (!g) return;
  let img;
  try { img = g.getImageData(0, 0, W, H); } catch { return; }
  const d = img.data, solid = new Uint8Array(W * H);
  for (let i = 0, j = 3; i < solid.length; i++, j += 4) solid[i] = d[j] > 110 ? 1 : 0;
  for (let pass = 0; pass < passes; pass++) {
    const add = [];
    for (let y = 0; y < H; y++) {
      const cy0 = Math.floor(y / ch) * ch, cy1 = cy0 + ch - 1;
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (solid[i]) continue;
        const cx0 = Math.floor(x / cw) * cw, cx1 = cx0 + cw - 1;
        if ((x > cx0 && solid[i - 1]) || (x < cx1 && solid[i + 1]) || (y > cy0 && solid[i - W]) || (y < cy1 && solid[i + W])) {
          const j = i * 4;
          d[j] = INK[0]; d[j + 1] = INK[1]; d[j + 2] = INK[2]; d[j + 3] = 255;
          add.push(i);
        }
      }
    }
    for (const i of add) solid[i] = 1;
  }
  g.putImageData(img, 0, 0);
}

function buildSheet(anim, size, view) {
  const A = SEAL_ANIMS[anim];
  const n = A.n * (A.buckets || 1);
  const cw = Math.ceil(CELL_W * size), ch = Math.ceil(CELL_H * size);
  const base = { w: cw, h: ch, center: C0, scale: size, radius: 2.2, ...LOOK };
  const cells = [], frames = [];
  for (let i = 0; i < n; i++) {
    const b = Math.floor(i / A.n), k = (i % A.n) / A.n;
    const P = pose(anim, k, b, view);
    const { mesh, A: an } = buildSeal(P);
    const matrix = T4.rot(P.tilt, P.yaw, P.rz);
    cells.push({ mesh, matrix });
    const F = project(an, { ...base, matrix }, matrix);
    F.dy = P.dy; F.cheek = P.cheek;
    frames.push(F);
  }
  const cols = Math.max(1, Math.min(n, Math.floor(2048 / cw)));
  let canvas = null;
  try { canvas = renderSheet(cells, { ...base, cols }); } catch (e) { canvas = null; }
  if (canvas) outlineCells(canvas, cw, ch, SEAL_OUTLINE(size)); // [phase9:seal]
  for (const c of cells) c.mesh.dispose?.();
  return { canvas, cw, ch, cols, n, frames, size, anim };
}

function sheet(anim, size, view, force) {
  const key = anim + '|' + size + '|' + view;
  let sh = SHEETS.get(key);
  if (sh) { sh.used = performance.now(); return sh; }
  const now = performance.now();
  if (now - budgetT > 14) { budgetT = now; budgetN = 0; }
  if (!force && budgetN >= 1) {
    // over budget this frame: the idle cycle stands in (any size as a last resort)
    const alt = SHEETS.get('idle|' + size + '|' + view) || [...SHEETS.values()].find((s) => s.anim === anim && s.view === view);
    if (alt) return alt;
  }
  budgetN++;
  sh = buildSheet(anim, size, view);
  sh.view = view; sh.used = now;
  SHEETS.set(key, sh);
  if (SHEETS.size > 48) {
    let old = null;
    for (const [k, s] of SHEETS) if (!old || s.used < old[1].used) old = [k, s];
    if (old) SHEETS.delete(old[0]);
  }
  return sh;
}

export function warmSeal(size = 40, anims = ['idle', 'swim', 'point'], view = 'side') {
  if (!lpAvailable()) return true;
  const z = sealSize(size);
  for (const a of anims) sheet(a, z, view, true);
  return true;
}
export function sealReady(size = 40, view = 'side') { return SHEETS.has('idle|' + sealSize(size) + '|' + view); }

// ------------------------------------------------------------------------------------------------ the live face
const FACESTATE = new Map();
function faceState(id, t) {
  let s = FACESTATE.get(id);
  if (!s || t < s.t - 1) { s = { t, next: t + 1.5 + Math.random() * 2, until: -1, gx: 0, gy: 0 }; FACESTATE.set(id, s); }
  const dt = clamp(t - s.t, 0, 0.1);
  s.dt = dt; s.t = t;
  if (t > s.next) { s.until = t + 0.13; s.next = t + 2.2 + Math.random() * 3.5; if (Math.random() < 0.18) s.next = t + 0.3; }
  if (FACESTATE.size > 40) FACESTATE.delete(FACESTATE.keys().next().value);
  return s;
}

let FPX = 1; // the face is drawn at voxel resolution: one face pixel = FPX sprite px
function ellipse(ctx, x, y, rx, ry, rot = 0) { ctx.beginPath(); ctx.ellipse(x, y, Math.max(0.3, rx), Math.max(0.3, ry), rot, 0, TAU); }

// one eye in its own upright frame (radius r): big dark glossy Aero eye, moods
function drawEye(ctx, r, o) {
  const { mood, blink, gx, gy, side } = o;
  const ink = '#141a2a';
  ctx.lineCap = 'round';
  if (blink > 0.5 || mood === 'happy-closed') {
    ctx.strokeStyle = ink; ctx.lineWidth = Math.max(FPX, r * 0.34);
    ctx.beginPath(); ctx.arc(0, -r * 0.1, r * 0.8, 0.25 * Math.PI, 0.75 * Math.PI); ctx.stroke();
    return;
  }
  if (mood === 'laugh' || mood === 'joy') {
    ctx.strokeStyle = ink; ctx.lineWidth = Math.max(FPX, r * 0.36);
    ctx.beginPath(); ctx.arc(0, r * 0.35, r * 0.75, 1.15 * Math.PI, 1.85 * Math.PI); ctx.stroke();
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
    ctx.fillStyle = 'rgba(255,255,255,0.9)'; ellipse(ctx, -k * 0.38, -k * 0.38, k * 0.2, k * 0.13, -0.6); ctx.fill();
    return;
  }
  let rx = r * 1.05, ry = r * 0.8;
  if (mood === 'surprised' || mood === 'excited') { rx *= 1.12; ry *= 1.12; }
  const ox = gx * r * 0.16, oy = gy * r * 0.14;
  ctx.save();
  // the lid line for sad / smug / determined (clip away the top)
  if (mood === 'sad' || mood === 'smug' || mood === 'angry' || mood === 'determined' || mood === 'tired') {
    ctx.beginPath();
    const tiltA = mood === 'sad' ? -0.45 * side : mood === 'smug' || mood === 'tired' ? 0 : 0.45 * side;
    const cut = mood === 'smug' || mood === 'tired' ? -ry * 0.05 : -ry * 0.35;
    ctx.save(); ctx.rotate(tiltA); ctx.rect(-r * 3, cut, r * 6, r * 6); ctx.restore();
    ctx.clip();
  }
  const g = ctx.createLinearGradient(0, -ry, 0, ry);
  g.addColorStop(0, '#0b0c12'); g.addColorStop(0.7, '#191c27'); g.addColorStop(1, '#2c3346');
  ctx.fillStyle = g;
  ellipse(ctx, ox, oy, rx, ry, 0.12 * side); ctx.fill();
  // glassy aqua bounce light along the bottom
  ctx.strokeStyle = 'rgba(120,200,240,0.3)'; ctx.lineWidth = Math.max(FPX, r * 0.16);
  ctx.beginPath(); ctx.ellipse(ox, oy, rx * 0.78, ry * 0.8, 0, 0.18 * Math.PI, 0.82 * Math.PI); ctx.stroke();
  // catchlights
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(Math.round((ox - rx * 0.32) / FPX - 0.5) * FPX, Math.round((oy - ry * 0.4) / FPX - 0.5) * FPX, FPX * (r > FPX * 2.2 ? 2 : 1), FPX * (r > FPX * 2.2 ? 2 : 1));
  ctx.globalAlpha *= 0.9;
  ellipse(ctx, ox + rx * 0.34, oy + ry * 0.32, rx * 0.15, ry * 0.13); ctx.fill();
  if (mood === 'excited' || mood === 'surprised') { ellipse(ctx, ox + rx * 0.05, oy - ry * 0.62, rx * 0.11, ry * 0.09); ctx.fill(); }
  ctx.restore();
  if (blink > 0.05) { // half-closed
    ctx.fillStyle = 'rgba(232,236,246,0.95)';
    ctx.fillRect(-r * 1.3, -ry * 1.2, r * 2.6, ry * 2.2 * blink);
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
  const blink = o.blink ?? (t < st.until ? 1 : 0);
  let em = mood;
  if (mood === 'happy' && (o.talk || 0) < 0.05 && Math.sin(t * 0.8) > 0.93) em = 'joy';
  if (mood === 'worried' || mood === 'scared') em = 'sad';
  const a0 = ctx.globalAlpha;
  // glossy Aero highlight on the crown + a wet-nose glint
  if (s >= 18) {
    const hx = F.head[0] - s * 0.14, hy = F.head[1] - s * 0.27;
    const gg = ctx.createRadialGradient(hx, hy, 0, hx, hy, s * 0.2);
    gg.addColorStop(0, 'rgba(255,255,255,0.55)'); gg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gg;
    ellipse(ctx, hx, hy, s * 0.2, s * 0.11, -0.45); ctx.fill();
  }
  if (F.faceZ > 0.1) {
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ellipse(ctx, F.nose[0] - s * 0.018, F.nose[1] - s * 0.02, Math.max(0.6, s * 0.018), Math.max(0.5, s * 0.012), -0.4); ctx.fill();
  }
  // blush
  if (F.faceZ > 0.05 && s >= 18) {
    const bk = mood === 'love' || mood === 'excited' ? 0.55 : mood === 'sad' || mood === 'angry' ? 0.15 : 0.32;
    ctx.fillStyle = `rgba(255,130,170,${bk})`;
    F.cheeks.forEach((c, i) => {
      const z = F.cheekZ ? F.cheekZ[i] : 1;
      if (z < 0.15) return;
      ctx.globalAlpha = a0 * clamp01((z - 0.15) / 0.3);
      ellipse(ctx, c[0], c[1], er * 1.05 * Math.max(0.4, z), er * 0.55); ctx.fill();
    });
    ctx.globalAlpha = a0;
  }
  // eyes
  for (const E of F.eyes) {
    if (E.nz < 0.06) continue;
    ctx.globalAlpha = a0 * clamp01(E.nz / 0.22);
    ctx.save();
    ctx.translate(E.p[0], E.p[1]);
    ctx.rotate(E.ang); ctx.scale(Math.max(0.35, E.nz), 1); ctx.rotate(-E.ang);
    drawEye(ctx, er, { mood: em, blink, gx: st.gx, gy: st.gy, side: E.side });
    ctx.restore();
  }
  ctx.globalAlpha = a0;
  // [phase9:seal] the glasses' lenses (the rims are voxels in the sheet): a faint glassy tint, a glossy glint at the
  // upper left and a sparkle dot at the lower right of each lens
  if (F.lens) for (const E of F.lens) {
    if (E.nz < 0.08) continue;
    const R = GLASS.R * s * 0.8;
    ctx.globalAlpha = a0 * clamp01(E.nz / 0.25);
    ctx.save();
    ctx.translate(E.p[0], E.p[1]);
    ctx.rotate(E.ang); ctx.scale(Math.max(0.35, E.nz), 1); ctx.rotate(-E.ang);
    ctx.fillStyle = 'rgba(196,238,255,0.13)';
    ellipse(ctx, 0, 0, R, R); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.92)'; ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(FPX, R * 0.17);
    ctx.beginPath(); ctx.arc(0, 0, R * 0.7, 1.06 * Math.PI, 1.36 * Math.PI); ctx.stroke();
    if (R > FPX * 2.5) { ctx.fillStyle = 'rgba(255,255,255,0.8)'; const d = Math.max(FPX, R * 0.13); ctx.fillRect(R * 0.42 - d / 2, R * 0.42 - d / 2, d, d); }
    ctx.restore();
  }
  ctx.globalAlpha = a0;
  // worried / determined brows
  if ((mood === 'worried' || mood === 'scared' || mood === 'angry' || mood === 'determined' || mood === 'sad') && F.faceZ > 0.1) {
    ctx.strokeStyle = '#59607a'; ctx.lineWidth = Math.max(FPX, er * 0.32); ctx.lineCap = 'round';
    const up = mood === 'angry' || mood === 'determined' ? -1 : 1;
    F.brows.forEach((b, i) => {
      if (F.eyes[i].nz < 0.15) return;
      const inner = F.eyes[i].side * -1;
      ctx.beginPath(); ctx.moveTo(b[0] - er * 0.9, b[1] + er * 0.25 * up * -inner); ctx.lineTo(b[0] + er * 0.9, b[1] + er * 0.25 * up * inner); ctx.stroke();
    });
  }
  if (F.faceZ < 0.05) return;
  // whiskers (twitch while talking)
  if (s >= 22) {
    ctx.strokeStyle = 'rgba(150,156,176,0.45)'; ctx.lineWidth = FPX * 0.7;
    const tw = (o.talk || 0) * 0.25 * Math.sin(t * 30);
    const cx = (F.muzzle[0][0] + F.muzzle[1][0]) / 2;
    for (const m of F.muzzle) {
      const dir = m[0] >= cx ? 1 : -1;
      for (let i = -1; i <= 1; i++) {
        const a = i * 0.22 + tw + (i === 0 ? 0.05 : 0);
        const L = s * (0.3 - Math.abs(i) * 0.04);
        ctx.beginPath(); ctx.moveTo(m[0] + dir * er * 0.4, m[1] + i * er * 0.25);
        ctx.lineTo(m[0] + dir * (er * 0.4 + Math.cos(a) * L), m[1] + i * er * 0.25 + Math.sin(a) * L * 0.6);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(96,100,118,0.75)';
      for (let i = 0; i < 3; i++) ctx.fillRect(m[0] - dir * er * (0.1 + i * 0.45) - FPX / 2, m[1] - er * 0.2 + (i % 2) * er * 0.45, FPX, FPX);
    }
  }
  // mouth: the little omega, opening while talking
  const [mx, my] = F.mouth;
  const w = s * 0.06, talk = clamp01(o.talk || 0);
  ctx.strokeStyle = '#4a4458'; ctx.lineWidth = Math.max(FPX, s * 0.03); ctx.lineCap = 'round';
  if (talk > 0.06 || mood === 'surprised' || mood === 'excited' || em === 'joy') {
    const open = Math.max(talk, mood === 'surprised' ? 0.6 : mood === 'excited' || em === 'joy' ? 0.3 : 0);
    const oh = s * (0.022 + open * 0.045), ow = s * (mood === 'surprised' ? 0.04 : 0.05);
    ctx.fillStyle = '#5b2238';
    ellipse(ctx, mx, my - s * 0.01 + oh * 0.5, ow, oh); ctx.fill();
    ctx.fillStyle = '#ff7f9f';
    ellipse(ctx, mx, my - s * 0.01 + oh * 0.95, ow * 0.62, oh * 0.42); ctx.fill();
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
  // iridescent soap-film rim
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
  const g = c.getContext('2d');
  const X = (x) => w / 2 + (x - C0[0]) * s, Y = (y) => h / 2 - (y - C0[1]) * s;
  const body = g.createLinearGradient(0, Y(0.8), 0, Y(-0.4));
  body.addColorStop(0, '#dfe3ef'); body.addColorStop(1, '#fbf6ec');
  g.fillStyle = body;
  g.beginPath(); g.ellipse(X(-0.3), Y(0.17), 0.85 * s, 0.48 * s, 0, 0, TAU); g.fill();
  g.beginPath(); g.ellipse(X(0.52), Y(0.62), 0.42 * s, 0.42 * s, 0, 0, TAU); g.fill();
  g.fillStyle = '#272c3a'; g.beginPath(); g.ellipse(X(0.9), Y(0.6), 0.06 * s, 0.045 * s, 0, 0, TAU); g.fill();
  // [phase9:seal] round glasses + the ink outline
  g.strokeStyle = '#1b1f2d'; g.lineWidth = Math.max(1, 0.05 * s);
  for (const ex of [0.78, 0.6]) { g.beginPath(); g.ellipse(X(ex), Y(0.75), GLASS.R * s * (ex > 0.7 ? 1 : 0.75), GLASS.R * s, 0, 0, TAU); g.stroke(); }
  g.beginPath(); g.moveTo(X(0.6) + GLASS.R * s * 0.75, Y(0.77)); g.quadraticCurveTo(X(0.69), Y(0.82), X(0.78) - GLASS.R * s, Y(0.77)); g.stroke();
  outlineCells(c, w, h, SEAL_OUTLINE(s));
  const F = {
    eyes: [{ p: [X(0.78), Y(0.75)], nz: 0.9, ang: 0, side: 1 }, { p: [X(0.6), Y(0.75)], nz: 0.7, ang: 0, side: -1 }],
    lens: [{ p: [X(0.78), Y(0.75)], nz: 0.9, ang: 0, side: 1 }, { p: [X(0.6), Y(0.75)], nz: 0.7, ang: 0, side: -1 }],
    brows: [[X(0.78), Y(0.98)], [X(0.6), Y(0.98)]], nose: [X(0.9), Y(0.6)], mouth: [X(0.88), Y(0.47)],
    muzzle: [[X(0.94), Y(0.53)], [X(0.8), Y(0.53)]], cheeks: [[X(0.72), Y(0.55)], [X(0.5), Y(0.55)]], faceZ: 0.8,
    top: [X(0.5), Y(1.05)], head: [X(0.52), Y(0.62)], hand: [X(0.4), Y(-0.1)], hand2: [X(0.3), Y(-0.1)], tail: [X(-1.1), Y(0.1)], bottom: [X(-0.15), Y(-0.3)], dy: 0, cheek: 0,
  };
  return { canvas: c, cw: w, ch: h, cols: 1, n: 1, frames: [F], size, anim: 'flat' };
}
const FLAT = new Map();

// ------------------------------------------------------------------------------------------------ drawSeal
export function pointBucket(ex, ey) { return clamp(Math.round(Math.atan2(-ey, Math.max(1, ex)) / (Math.PI / 6)) + 3, 0, 6); }

// Soft-body state per seal id: a squash spring (kicked by vertical acceleration, landings, animation changes and
// talking) and a travelling ripple across the voxel rows (belly jiggle).
const JIG = new Map();
function jiggle(id, t, x, y, anim, talk) {
  let j = JIG.get(id);
  if (!j || t < j.t - 1 || t - j.t > 1) { j = { t, x, y, vx: 0, vy: 0, s: 0, v: 0, anim, rip: 0, talk: 0 }; JIG.set(id, j); if (JIG.size > 40) JIG.delete(JIG.keys().next().value); }
  const dt = clamp(t - j.t, 0, 0.05);
  if (dt > 0) {
    const vx = (x - j.x) / dt, vy = (y - j.y) / dt;
    const ay = (vy - j.vy) / Math.max(dt, 1 / 60), ax = (vx - j.vx) / Math.max(dt, 1 / 60);
    // spring: stiff enough to snap back, soft enough to wobble a few times
    let f = -170 * j.s - 9 * j.v;
    f += clamp(-ay * 0.0011, -6, 6) + clamp(Math.abs(ax) * 0.0004, 0, 3);
    if (anim !== j.anim) { j.v += anim === 'flop' ? -2.2 : 1.1; j.anim = anim; }
    j.talk += ((talk || 0) - j.talk) * Math.min(1, dt * 10);
    f += j.talk * Math.sin(t * 17) * 9;
    j.v += f * dt; j.s = clamp(j.s + j.v * dt, -0.22, 0.22);
    const sp = Math.hypot(vx, vy);
    j.rip += ((clamp(sp / 300, 0, 1) * 0.6 + Math.abs(j.v) * 0.6 + j.talk * 0.8 + 0.18) - j.rip) * Math.min(1, dt * 4);
    j.vx = vx; j.vy = vy;
  }
  j.t = t; j.x = x; j.y = y;
  return j;
}

// per-seal scratch canvases: the composited frame (body + pixel face) and the low-res face layer
const COMP = new Map();
function scratch(id, w, h) {
  let c = COMP.get(id);
  if (!c) { c = { a: document.createElement('canvas'), f: document.createElement('canvas') }; COMP.set(id, c); if (COMP.size > 24) COMP.delete(COMP.keys().next().value); }
  if (c.a.width !== w || c.a.height !== h) { c.a.width = w; c.a.height = h; }
  return c;
}

export function drawSeal(ctx, o = {}) {
  const size = sealSize(o.size ?? 40);
  const view = o.view === 'front' ? 'front' : 'side';
  let anim = SEAL_ANIMS[o.anim] ? o.anim : SEAL_ALIAS[o.anim] || 'idle';
  const t = o.t ?? 0, facing = (o.facing ?? 1) < 0 ? -1 : 1, k = o.k ?? 1, tilt = o.tilt || 0;
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
  if (lpAvailable()) sh = sheet(anim, size, view, false);
  if (!sh || !sh.canvas) {
    sh = FLAT.get(size) || (FLAT.set(size, flatFrame(size)), FLAT.get(size));
    anim = 'flat';
  }
  const A = SEAL_ANIMS[sh.anim] || { n: 1, dur: 1 };
  const ph = o.phase != null ? o.phase : t / A.dur;
  let fi = ((Math.floor(ph * A.n) % A.n) + A.n) % A.n;
  if (sh.anim === 'point') fi += bucket * A.n;
  fi = Math.min(fi, sh.n - 1);
  const F = sh.frames[fi];
  const sk = (k * size) / sh.size; // the stand-in sheet may be another size
  const cw = sh.cw, ch = sh.ch;
  const ride = clamp01(o.ride || 0);
  const rideR = size * k * 0.5 * (0.35 + 0.65 * ride);
  if (o.base === 'bottom') y -= (F.bottom[1] - ch / 2) * sk + (ride ? rideR * 1.5 : 0);
  const lift = (F.dy || 0) * sh.size * sk;
  // soft body: squash spring about the bottom + ripple
  const id = o.id ?? 'seal';
  const J = jiggle(id, t, x, y, anim, o.talk);
  const sqY = 1 + J.s, sqX = 1 - J.s * 0.7;
  const bY = F.bottom[1], cX = cw / 2;
  const sqp = (p) => [cX + (p[0] - cX) * sqX, bY + (p[1] - bY) * sqY];
  // screen transform of a sprite-local point
  const ct = Math.cos(tilt), st = Math.sin(tilt);
  const toScreen = (p0) => {
    const p = sqp(p0);
    const lx = (p[0] - cw / 2) * facing * sk, ly = (p[1] - ch / 2) * sk - lift;
    return [x + lx * ct - ly * st, y + lx * st + ly * ct];
  };
  const a0 = ctx.globalAlpha;
  if (o.alpha != null) ctx.globalAlpha = a0 * o.alpha;
  // the (subtle) soap bubble it may sit in
  const bot = toScreen([F.bottom[0], F.bottom[1] + lift / Math.max(0.01, sk)]);
  if (ride > 0.02) {
    const sq = ride * (0.5 + 0.5 * Math.sin(t * 2.2));
    const ga = ctx.globalAlpha;
    ctx.globalAlpha = ga * 0.7;
    drawSoapBubble(ctx, bot[0], bot[1] + rideR * 0.55, rideR, sq);
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
  const state = faceState(id, t);
  let look = null;
  if (o.lookAt) {
    const hd = toScreen(F.head);
    look = [(o.lookAt[0] - hd[0]) * facing, o.lookAt[1] - hd[1]];
  }
  drawFace(gf, F, { mood: o.mood, talk: o.talk, t, state, look, blink: o.blink, facing }, sh.size);
  // a glossy sweat drop when it is worried
  if (sh.anim === 'worried' || o.mood === 'worried' || o.mood === 'scared') {
    const s2 = sh.size, dx = F.top[0] - s2 * 0.32, dy = F.top[1] + s2 * 0.12 + ((t * 2) % 1) * s2 * 0.08;
    gf.fillStyle = '#7fdcff';
    gf.beginPath(); gf.moveTo(dx, dy - s2 * 0.12); gf.quadraticCurveTo(dx + s2 * 0.08, dy, dx, dy + s2 * 0.05); gf.quadraticCurveTo(dx - s2 * 0.08, dy, dx, dy - s2 * 0.12); gf.fill();
    gf.fillStyle = '#ffffff'; gf.fillRect(dx - q * 0.5, dy - s2 * 0.04, q, q);
  }
  g.imageSmoothingEnabled = false;
  g.drawImage(SC.f, 0, 0, fw * q, fh * q);
  // ---- draw it in voxel rows: squash-and-stretch about the bottom, a ripple travelling through the rows and a
  // belly jiggle (rows below the middle sway wider)
  ctx.save();
  ctx.translate(Math.round(x), Math.round(y));
  if (tilt) ctx.rotate(tilt);
  ctx.translate(0, -Math.round(lift));
  ctx.scale(facing * sk, sk);
  ctx.translate(-cw / 2, -ch / 2);
  const smooth = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = sk < 0.99; // voxels stay crisp when scaled up
  const rows = Math.max(1, Math.round(ch / (q * 2)));
  const rh = ch / rows;
  const amp = J.rip * q * 0.9;
  const ripple = amp > 0.05 || Math.abs(J.s) > 0.004;
  if (!ripple) ctx.drawImage(SC.a, 0, 0);
  else {
    const mid = (F.top[1] + bY) / 2;
    for (let r = 0; r < rows; r++) {
      const y0 = r * rh, yc = y0 + rh / 2;
      const belly = clamp01((yc - mid) / Math.max(1, bY - mid));
      const dxr = amp * Math.sin(t * 8.5 - (yc / q) * 0.55) * (0.4 + 0.6 * clamp01((bY - yc) / (bY - F.top[1] + 1) + 0.3));
      const wob = 1 + J.talk * 0.035 * belly * Math.sin(t * 17) + belly * J.s * 0.25;
      const w = cw * sqX * wob;
      const dy0 = bY + (y0 - bY) * sqY, dh = rh * sqY;
      ctx.drawImage(SC.a, 0, y0, cw, rh, cX - w / 2 + dxr, dy0, w, dh + 0.6);
    }
  }
  ctx.imageSmoothingEnabled = smooth;
  ctx.restore();
  // the little bubble balanced on its nose
  const nb = clamp01(o.noseBubble || 0);
  if (nb > 0.02 && F.faceZ > 0) {
    const nz = toScreen(F.nose);
    const r = size * k * 0.11 * nb;
    // a little bubble bobbing on the tip of its nose (clear of the eyes)
    drawSoapBubble(ctx, nz[0] + facing * r * 1.25 + Math.sin(t * 3.1) * r * 0.15, nz[1] - r * 0.15 - Math.abs(Math.sin(t * 3.1)) * r * 0.25, r, 0);
  }
  ctx.globalAlpha = a0;
  const pts = [F.top, F.bottom, F.tail, F.head, F.nose].map(toScreen);
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const rx0 = Math.min(...xs) - size * k * 0.1, ry0 = Math.min(...ys) - size * k * 0.08;
  return {
    head: toScreen(F.head), top: toScreen(F.top), mouth: toScreen(F.mouth), nose: toScreen(F.nose), hand: toScreen(F.hand),
    tail: toScreen(F.tail), bottom: bot, center: [x, y],
    rect: { x: rx0, y: ry0, w: Math.max(...xs) - rx0 + size * k * 0.1, h: Math.max(...ys) - ry0 + size * k * 0.1 + (ride > 0.1 ? rideR * 1.2 : 0) },
  };
}

// A stream of tiny glossy bubbles flowing from the pointing flipper to the target (makes the gesture unmistakable).
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
