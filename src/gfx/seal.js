// Bubbles, the guide [seal19]: a chubby seal pup MADE OF SOAP BUBBLES, in a candy-striped party cone hat (a pom-pom
// of little lime bubbles on its tip, a fluffy bubble brim) and round dark glasses. Every part is a glossy,
// translucent Frutiger Aero bubble: a big round head bubble, a plump cluster of body bubbles (belly, chest, rear,
// hips, a bubble hump on the back), flippers and tail flippers made of chains of smaller bubbles, puffy milky
// whisker-pad bubbles and a glossy nose. It is rendered in real 3D by an analytic sphere ray-caster
// (src/gfx/bubblegl.js: WebGL2, Canvas2D fallback): per-pixel lighting, pearl volume, iridescent soap-film rims, the
// rims of the bubbles behind showing through, bright creases where bubbles meet, glossy reflections and a soft dark
// ink outline. Frames are CACHED: each animation cycle is baked once per size (one GL pass + one readback per
// atlas page, at most one new sheet per frame; the nearest cached sheet stands in meanwhile) and drawn at device
// resolution on the hi-res UI layer. Each body bubble wobbles on its own phase inside the baked cycle (jelly).
//
// The head is its own layer, baked per 10-degree yaw / 0.1-rad pitch bucket (lazily, a few at a time) and
// cross-faded between buckets, so it really TURNS toward lookAt (and glances at the viewer now and then), lags
// behind the body on a spring and bobs while it talks. The eyes (blink, gaze, moods), blush, mouth, whiskers and lens
// glints are drawn live on the head in 3D-projected positions. Little bubbles bud off its body, float up and pop.
//
//   SEAL_INFO                          {id: 'seal', name: 'Bubbles', role, desc, color, h}
//   SEAL_ANIMS                         idle swim wiggle wave point flop spin worried clap think blow cheer sad sleep
//   SEAL_ALIAS                         talk, laugh, excited, happy, love, surprised, ride, bend, sleepy, celebrate ...
//   drawSeal(ctx, o) -> anchors        o: {x, y (body centre; o.base = 'bottom' -> y is the bottom; o.anchor = 'head'
//       -> x, y is the head centre), t, size (logical px per model unit), k (extra draw scale), facing (1 right /
//       -1 left), anim, phase (0..1 override), point: [sx, sy] (the flipper points there), tilt (rad), mood, talk 0..1,
//       lookAt [sx, sy], blink, ride 0..1 (the soap bubble under it), noseBubble 0..1, view: 'side' | 'front'
//       (portrait), id (per-seal state: blink, gaze, jiggle, floating bubbles), alpha, floaters (false = none)}
//     anchors: {head, top, mouth, nose, hand (pointing flipper tip), tail, bottom, center, rect {x, y, w, h}} (screen)
//   warmSeal(size, anims, view)         pre-render sheets (call from a loading step)
//   sealReady(size, view)               the idle sheet exists
//   sealSize(s)                         the logical size bucket
//   drawSoapBubble(ctx, x, y, r, sq)    the glossy soap bubble it rides on
//   new SealGuide({x, y, size, audio, id})  a screen-space swimmer with smooth physics:
//       .goTo(x, y, {snap}) .pointAt([sx, sy] | null) .emote(anim, secs) .update(dt, {W, H, cursor, talk})
//       .draw(ctx, {t, talk, mood, lookAt, alpha}) -> anchors .rect() .hit(x, y) .settled .speed .anim

import { clamp, clamp01, lerp, TAU } from '../core/math.js';
import { drawAeroBubble } from '../ui/aero.js';
import { HI, HI_ON } from './hires.js';
import { renderBubbleCells, bubbleGLAvailable } from './bubblegl.js';

export const SEAL_INFO = {
  id: 'seal', name: 'Bubbles', role: 'Guide', color: '#bfefff', h: 56,
  desc: 'A chubby seal pup made entirely of soap bubbles, in a party hat and round glasses. Knows every fish in the sea (by smell).',
};

// ------------------------------------------------------------------------------------------------ small math
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scl = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const hash = (i) => { const n = Math.sin(i * 127.1 + 31.7) * 43758.5453; return n - Math.floor(n); };
const S_ = Math.sin, C_ = Math.cos;

// camera: yaw a turns the model's forward (+x) toward the viewer (0 = profile facing right, PI/2 = facing us),
// tilt tau leans its top toward the viewer (we look down on it a little). Camera space: x right, y up, z to us.
function camRot(a, tau) {
  const ca = C_(a), sa = S_(a), ct = C_(tau), st = S_(tau);
  return (p) => {
    const x = p[0] * ca - p[2] * sa, z0 = p[0] * sa + p[2] * ca;
    return [x, p[1] * ct - z0 * st, p[1] * st + z0 * ct];
  };
}

// ------------------------------------------------------------------------------------------------ palette
const T = { body: 0, back: 1, belly: 2, head: 3, flip: 4, muzzle: 5, nose: 6, glass: 7, hatA: 8, hatB: 9, pom: 10, brim: 11 };
const TINTS = [
  [0.8, 0.93, 1.0],    // body: pearl with an aqua heart
  [0.66, 0.83, 1.0],   // back: a cooler blue pearl
  [0.93, 0.98, 1.0],   // belly / chest
  [0.88, 0.96, 1.0],   // head
  [0.56, 0.82, 1.0],   // flippers: aqua
  [1.0, 1.0, 1.0],     // whisker pads
  [0.2, 0.12, 0.25],   // nose
  [0.06, 0.08, 0.16],  // glasses
  [0.1, 0.6, 1.0],     // hat: Aero blue
  [0.99, 1.0, 1.0],    // hat: white stripe
  [0.56, 0.94, 0.26],  // pom-pom: lime
  [1.0, 1.0, 1.0],     // brim
];
const INK = [0.04, 0.08, 0.19, 0.95];

// ------------------------------------------------------------------------------------------------ the model
// Model space: x forward (the face), y up, z toward the near (+z) side. K scales the model to the old guide's size.
const K = 0.9;
const A_SIDE = (40 * Math.PI) / 180, A_FRONT = (70 * Math.PI) / 180;
const TAU_SIDE = 0.3, TAU_FRONT = 0.2;
const YSTEP = (10 * Math.PI) / 180, PSTEP = 0.1, NY = 36;
const HEAD_TURN = (20 * Math.PI) / 180; // the head faces us a little more than the body (both eyes show)
// body bubbles [x, y, z, r, tint, density (opacity per unit depth), film phase]
const BODY = [
  [-0.04, 0.42, 0, 0.47, T.body, 2.4, 0.05],
  [0.3, 0.47, 0, 0.41, T.belly, 2.4, 0.32],
  [-0.46, 0.35, 0, 0.34, T.back, 2.4, 0.6],
  [-0.75, 0.28, 0, 0.23, T.back, 2.6, 0.85],
  [-0.95, 0.26, 0, 0.14, T.back, 2.8, 0.15],
  [-0.08, 0.3, 0.25, 0.32, T.body, 2.4, 0.45],
  [-0.08, 0.3, -0.25, 0.32, T.body, 2.4, 0.72],
  [-0.3, 0.68, 0.0, 0.24, T.back, 2.4, 0.9],
];
const NECK = [0.56, 0.88, 0];          // the head centre in body space
const ANCHOR = [-0.1, 0.42, 0];        // the body sprite's reference point
const BOTTOM = [-0.05, -0.04, 0];
// head bubbles (head space: centre at the origin) [x, y, z, r, tint, density, film]
const HR = 0.47;
const HEAD = [
  [0, 0, 0, HR, T.head, 3.2, 0.42],
  [0.37, -0.14, 0.115, 0.15, T.muzzle, 7, 0.2],
  [0.37, -0.14, -0.115, 0.15, T.muzzle, 7, 0.55],
  [0.3, -0.28, 0, 0.1, T.muzzle, 6, 0.8],
];
const NOSE = [0.505, -0.035, 0, 0.06];
const eyeDir = (sd) => norm([0.8, 0.15, 0.5 * sd]);
const LENS = { R: 0.158, rr: 0.024, lift: 0.035 };
const HAT = { up: norm([-0.26, 1, -0.12]), sink: 0.36, R: 0.25, H: 0.64 };
const MOUTH = [0.455, -0.215, 0];

// ---- the pose
function P0(view) {
  return {
    a: view === 'front' ? A_FRONT : A_SIDE, tau: view === 'front' ? TAU_FRONT : TAU_SIDE, pitch: 0, sq: [1, 1, 1], dy: 0,
    wave: 0, wph: 0, side: 0, hYaw: 0, hNod: 0, hRoll: 0, hDx: 0, hDy: 0, hSq: 1, cheek: 0,
    fl: norm([0.25, -0.8, 0.55]), fr: norm([0.25, -0.8, -0.55]), flLen: 1, frLen: 1, shN: 0, shF: 0,
    tail: 0.3, flap: 0, spread: 0.45, wob: 0.014, wm: 1, k: 0, eyes: null,
  };
}

function deformer(P) {
  const [sx, sy, sz] = P.sq, cp = C_(P.pitch), sp = S_(P.pitch);
  return (p) => {
    let x = -0.1 + (p[0] + 0.1) * sx, y = p[1] * sy, z = p[2] * sz;
    const u = p[0] + 0.1;
    if (P.wave) y += P.wave * S_(P.wph - p[0] * 3.2) * clamp01((0.3 - p[0]) / 1.3);
    if (P.side) z += P.side * u * u * 0.55 * Math.sign(u);
    if (P.pitch) { const dx = x, dy = y - 0.35; x = dx * cp - dy * sp; y = 0.35 + dx * sp + dy * cp; }
    return [x, y, z];
  };
}

// a chain of bubbles from base along dir: [{p, r}]
function chain(base, dir, len, steps, radii) { return steps.map((s, i) => ({ p: add(base, scl(dir, s * len)), r: radii[i] })); }

// body bubbles for pose P (model space, deformed): {main: [...], near: [...], far tip, near tip, tail tip}
function bodyModel(P) {
  const def = deformer(P);
  const avg = (P.sq[0] + P.sq[1] + P.sq[2]) / 3;
  const ph = P.k * TAU * P.wm;
  const wob = (i, p, r) => {
    const f = hash(i + 1) * TAU, w = P.wob;
    return { p: add(def(p), [w * S_(ph + f), w * 0.7 * C_(ph * (i % 2 ? 1 : -1) + f), w * 0.5 * S_(ph + f + 1)]), r: r * avg * (1 + w * 0.9 * S_(ph + f + 2.1)) };
  };
  const main = [], near = [];
  BODY.forEach((b, i) => { const q = wob(i, [b[0], b[1], b[2]], b[3]); main.push({ ...q, tint: b[4], dens: b[5], film: b[6] }); });
  // tail flippers: a splayed pair of 3-bubble chains
  const tips = {};
  for (const sd of [1, -1]) {
    const up = P.tail + P.flap * 0.6, spr = P.spread + sd * P.flap * 0.35;
    const dir = norm([-C_(spr) * C_(up), S_(up), sd * S_(spr) * C_(up)]);
    const ch = chain([-1.02, 0.27, 0.05 * sd], dir, 1, [0.1, 0.21, 0.31], [0.105, 0.088, 0.066]);
    ch.forEach((c, j) => { const q = wob(20 + j + (sd > 0 ? 0 : 5), c.p, c.r); main.push({ ...q, tint: T.flip, dens: 2.8, film: 0.3 + j * 0.2 }); });
    if (sd > 0) tips.tail = def(add(ch[2].p, scl(dir, 0.06)));
  }
  // front flippers (near = +z, a separate layer so it can pass in front of the head)
  for (const sd of [1, -1]) {
    const sh = sd > 0 ? P.shN : P.shF, dir = norm(sd > 0 ? P.fl : P.fr), len = sd > 0 ? P.flLen : P.frLen;
    const base = [0.27 + 0.1 * sh, 0.2 + 0.22 * sh, (0.36 + 0.1 * sh) * sd];
    const ch = chain(base, dir, len, [0.06, 0.18, 0.295], [0.12, 0.1, 0.078]);
    const list = sd > 0 ? near : main;
    ch.forEach((c, j) => { const q = wob(40 + j + (sd > 0 ? 0 : 5), c.p, c.r); list.push({ ...q, tint: T.flip, dens: 2.8, film: 0.55 + j * 0.15 }); });
    tips[sd > 0 ? 'hand' : 'hand2'] = def(add(ch[2].p, scl(dir, 0.07)));
  }
  return { main, near, tips, def };
}

// ------------------------------------------------------------------------------------------------ cells
// prims in camera px -> a cell (bounds + shift into cell coordinates); anchor = the projected reference point
function makeCell(spheres, cone, tori, pad) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const ext = (x, y, r) => { x0 = Math.min(x0, x - r); y0 = Math.min(y0, y - r); x1 = Math.max(x1, x + r); y1 = Math.max(y1, y + r); };
  for (const s of spheres) ext(s.x, s.y, s.r);
  if (cone) { ext(cone.apex[0], cone.apex[1], 1); const b = add(cone.apex, scl(cone.dir, cone.h)); ext(b[0], b[1], cone.r); }
  for (const t of tori || []) ext(t.c[0], t.c[1], t.R + t.rr);
  if (!Number.isFinite(x0)) { x0 = y0 = 0; x1 = y1 = 1; }
  const ox = Math.floor(x0) - pad, oy = Math.floor(y0) - pad;
  const w = Math.ceil(x1) + pad - ox, h = Math.ceil(y1) + pad - oy;
  const sh = (p) => [p[0] - ox, p[1] - oy, p[2]];
  return {
    w, h, ax: -ox, ay: -oy,
    spheres: spheres.map((s) => ({ ...s, x: s.x - ox, y: s.y - oy })),
    cone: cone ? { ...cone, apex: sh(cone.apex) } : null,
    tori: (tori || []).map((t) => ({ ...t, c: sh(t.c) })),
  };
}
const outlineW = (U) => clamp(Math.round(U / 46), 1, 3);

// one body frame for pose P at U device px per unit -> {cells, meta}
function bodyFrame(P, U) {
  const M = bodyModel(P), rot = camRot(P.a, P.tau), S = U * K;
  const O = rot(M.def(ANCHOR));
  const pr = (p) => { const q = rot(p); return [(q[0] - O[0]) * S, -(q[1] - O[1]) * S, (q[2] - O[2]) * S]; };
  const toS = (b) => { const q = pr(b.p); return { x: q[0], y: q[1], z: q[2], r: b.r * S, kind: 0, dens: b.dens, film: b.film, tint: b.tint }; };
  const pad = outlineW(U) + 2;
  const main = makeCell(M.main.map(toS), null, null, pad);
  const nearS = M.near.map(toS);
  const near = makeCell(nearS, null, null, pad);
  const head = pr(M.def(NECK));
  // emitters: the tops of a few body bubbles (floating bubbles bud off there)
  const emit = M.main.slice(0, 8).map((b) => { const q = pr(add(b.p, [0, b.r * 0.92, 0])); return [q[0], q[1]]; });
  return {
    cells: [main, near],
    meta: {
      head: [head[0], head[1]], headZ: head[2], flipZ: Math.max(...nearS.map((s) => s.z + s.r * 0.3)),
      bottom: pr(M.def(BOTTOM)), tail: pr(M.tips.tail), hand: pr(M.tips.hand), hand2: pr(M.tips.hand2),
      a: P.a, tau: P.tau, hYaw: P.hYaw, hNod: P.hNod, hRoll: P.hRoll, hDx: P.hDx, hDy: P.hDy, hSq: P.hSq, cheek: P.cheek,
      dy: P.dy, emit, eyes: P.eyes,
    },
  };
}

// the head layer at absolute yaw / pitch -> cell (anchor = the head centre)
function headModelCell(yaw, pitch, cheek, U) {
  const rot = camRot(yaw, pitch), S = U * K;
  const pr = (p) => { const q = rot(p); return [q[0] * S, -q[1] * S, q[2] * S]; };
  const dr = (d) => { const q = rot(d); return norm([q[0], -q[1], q[2]]); };
  const sph = [];
  const put = (p, r, tint, dens, film, kind = 0) => { const q = pr(p); sph.push({ x: q[0], y: q[1], z: q[2], r: r * S, kind, dens, film, tint }); };
  HEAD.forEach((b, i) => {
    let p = [b[0], b[1], b[2]], r = b[3];
    if (i === 1 || i === 2) { p = [p[0] + 0.02 * cheek, p[1] - 0.01 * cheek, p[2] * (1 + 0.3 * cheek)]; r *= 1 + 0.32 * cheek; }
    put(p, r, b[4], b[5], b[6]);
  });
  put(NOSE.slice(0, 3), NOSE[3], T.nose, 0, 1, 2);
  // glasses: two lens rims (tori), a beaded bridge and temple arms of tiny dark beads
  const tori = [];
  const lens = [1, -1].map((sd) => { const e = eyeDir(sd); return { c: scl(e, HR + LENS.lift), n: e, sd }; });
  for (const L of lens) tori.push({ c: pr(L.c), n: dr(L.n), R: LENS.R * S, rr: LENS.rr * S, tint: T.glass });
  const inner = (L, other) => { const d = sub(other.c, L.c); const u = norm(sub(d, scl(L.n, dot(d, L.n)))); return add(L.c, scl(u, LENS.R)); };
  const a0 = inner(lens[0], lens[1]), a1 = inner(lens[1], lens[0]);
  const mid = [Math.max(a0[0], a1[0]) + 0.05, (a0[1] + a1[1]) / 2 + 0.03, 0];
  for (let i = 1; i < 10; i++) { const q = i / 10, s = 1 - q; put(add(add(scl(a0, s * s), scl(mid, 2 * s * q)), scl(a1, q * q)), 0.021, T.glass, 0, 1, 2); }
  for (const L of lens) {
    // the temple arm: a continuous bar of overlapping dark beads hugging the head back toward the ear
    const e = L.n, az = Math.atan2(e[2], e[0]), el = Math.asin(e[1]) + 0.03;
    for (let i = 0; i <= 11; i++) {
      const a = az + L.sd * (0.34 + i * 0.06), rr = HR + 0.014 - i * 0.0008;
      put([C_(a) * C_(el) * rr, S_(el) * rr, S_(a) * C_(el) * rr], 0.018, T.glass, 0, 1, 2);
    }
  }
  // the party hat: a striped cone on a fluffy bubble brim, a pom-pom of little lime bubbles on its tip
  const U_ = HAT.up, base = scl(U_, HR * 0.78), apex = add(base, scl(U_, HAT.H));
  const e1m = norm(cross(U_, [0, 0, 1])), e2m = cross(U_, e1m);
  const cone = { apex: pr(apex), dir: dr(scl(U_, -1)), h: HAT.H * S, r: HAT.R * S, e1: dr(e1m), tintA: T.hatA, tintB: T.hatB };
  for (let i = 0; i < 12; i++) {
    const f = (i / 12) * TAU + 0.2;
    put(add(base, add(scl(e1m, C_(f) * (HAT.R + 0.01)), scl(e2m, S_(f) * (HAT.R + 0.01)))), 0.068 + 0.008 * (i % 2), T.brim, 6, 0.1 + i * 0.07);
  }
  put(add(apex, scl(U_, 0.05)), 0.085, T.pom, 5, 0.3);
  put(add(apex, add(scl(U_, 0.015), scl(e1m, 0.075))), 0.055, T.pom, 5, 0.6);
  put(add(apex, add(scl(U_, 0.1), scl(e2m, -0.06))), 0.05, T.pom, 5, 0.85);
  put(add(apex, add(scl(U_, 0.02), scl(e2m, 0.07))), 0.045, T.pom, 5, 0.1);
  return makeCell(sph, cone, tori, outlineW(U) + 2);
}

// ------------------------------------------------------------------------------------------------ animations
// n frames per cycle, dur seconds per cycle, buckets (point: 7 elevations), fn(P, k, bucket) mutates the pose.
// Head yaw / nod (hYaw, hNod) select baked head buckets: keep them constant within a cycle (roll, dx, dy are 2D).
const POINT_E = [-90, -60, -30, 0, 30, 60, 90].map((d) => (d * Math.PI) / 180);
const qn = (v, s) => Math.round(v / s) * s;
export const SEAL_ANIMS = {
  idle: { n: 12, dur: 2.6, fn(P, k) {
    const s = S_(k * TAU);
    P.sq = [1 - 0.012 * s, 1 + 0.03 * s, 1 + 0.015 * s];
    P.hDy = 0.016 * s; P.hRoll = 0.045 * S_(k * TAU + 0.7); P.hDx = 0.01 * S_(k * TAU + 1.4);
    P.fl = norm([0.25 + 0.14 * S_(k * TAU), -0.8, 0.55]); P.fr = norm([0.25 + 0.14 * S_(k * TAU + 1), -0.8, -0.55]);
    P.tail = 0.3 + 0.08 * S_(k * TAU + 1.3); P.wm = 2;
  } },
  swim: { n: 12, dur: 0.72, fn(P, k) {
    const a = k * TAU;
    P.wave = 0.06; P.wph = a;
    P.sq = [1.05, 0.97, 0.98];
    P.hRoll = 0.05 * S_(a + 1.2); P.hDy = -0.02;
    const st = 0.5 + 0.5 * S_(a);
    P.fl = norm([lerp(0.4, -0.85, st), lerp(-0.75, -0.2, st), 0.55]); P.fr = norm([lerp(0.4, -0.85, st), lerp(-0.75, -0.2, st), -0.55]);
    P.tail = 0.12; P.flap = 0.32 * S_(a - 1.4); P.spread = 0.3; P.wob = 0.022;
  } },
  wiggle: { n: 8, dur: 0.55, fn(P, k) {
    const s = S_(k * TAU);
    P.side = 0.16 * s; P.hRoll = -0.16 * s; P.dy = 0.05 * Math.abs(s);
    P.fl = norm([0.1, -0.25 + 0.5 * s, 0.9]); P.fr = norm([0.1, -0.25 - 0.5 * s, -0.9]);
    P.tail = 0.4; P.flap = 0.25 * s; P.spread = 0.6; P.wob = 0.03;
  } },
  wave: { n: 8, dur: 0.9, fn(P, k) {
    SEAL_ANIMS.idle.fn(P, k);
    const s = S_(k * TAU);
    P.fl = norm([0.15 + 0.42 * s, 0.95, 0.55]); P.shN = 0.9; P.flLen = 1.2;
    P.hRoll = 0.13; P.hYaw = qn(0.17, YSTEP);
  } },
  point: { n: 4, dur: 1.1, buckets: 7, fn(P, k, b) {
    SEAL_ANIMS.idle.fn(P, k * 0.5);
    const e = POINT_E[b];
    P.pitch = clamp(e, -1.2, 1.2) * 0.18;
    P.hNod = qn(-e * 0.22, PSTEP);
    P.shN = 1;
    P.fl = solvePoint(P, e);
    P.flLen = 1.45 + 0.1 * S_(k * TAU) + 0.2 * Math.max(0, S_(e));
  } },
  flop: { n: 14, dur: 1.15, fn(P, k) {
    if (k < 0.16) { const q = k / 0.16; P.sq = [1 + 0.08 * q, 1 - 0.13 * q, 1 + 0.05 * q]; }
    else if (k < 0.5) {
      const q = (k - 0.16) / 0.34;
      P.dy = S_(q * Math.PI) * 0.62; P.sq = [0.94, 1.1, 0.96]; P.pitch = 0.25 - q * 0.45;
      P.fl = norm([0.2, 0.8, 0.7]); P.fr = norm([0.2, 0.8, -0.7]); P.tail = 0.6; P.hRoll = 0.1 - q * 0.2;
    } else if (k < 0.62) {
      const q = (k - 0.5) / 0.12;
      P.sq = [1 + 0.18 * q, 1 - 0.27 * q, 1 + 0.16 * q]; P.hDy = -0.06 * q;
      P.fl = norm([0.15, 0.05, 1]); P.fr = norm([0.15, 0.05, -1]); P.tail = 0.4; P.spread = 0.8;
    } else {
      const q = (k - 0.62) / 0.38, j = S_(q * Math.PI * 3) * (1 - q);
      P.sq = [1 + 0.18 * (1 - q) * 0.6 + 0.05 * j, 1 - 0.27 * (1 - q) * 0.6 - 0.08 * j, 1 + 0.1 * (1 - q)];
      P.fl = norm([lerp(0.15, 0.25, q), lerp(0.05, -0.8, q), lerp(1, 0.55, q)]); P.fr = norm([lerp(0.15, 0.25, q), lerp(0.05, -0.8, q), -lerp(1, 0.55, q)]);
      P.spread = lerp(0.8, 0.45, q); P.hRoll = 0.08 * j; P.hDy = -0.04 * (1 - q) + 0.02 * j;
    }
    P.wob = 0.03;
  } },
  spin: { n: 16, dur: 0.85, fn(P, k) {
    P.a += k * TAU;
    P.dy = S_(k * Math.PI) * 0.14; P.sq = [0.97, 1.05, 0.97];
    P.fl = norm([0.05, 0.3, 0.95]); P.fr = norm([0.05, 0.3, -0.95]); P.tail = 0.4; P.spread = 0.7; P.wob = 0.025;
  } },
  worried: { n: 8, dur: 0.5, fn(P, k) {
    const j = (Math.floor(k * 8) % 2 ? 1 : -1);
    P.sq = [0.97, 0.94, 0.98]; P.hRoll = 0.04 * j; P.hDy = -0.03; P.hSq = 0.97;
    P.fl = norm([0.6, 0.62, -0.25]); P.fr = norm([0.6, 0.62, 0.25]); P.shN = P.shF = 0.7; P.flLen = P.frLen = 0.95; P.tail = 0.1; P.spread = 0.25;
    P.wob = 0.02;
  } },
  clap: { n: 6, dur: 0.34, fn(P, k) {
    const open = 0.5 + 0.5 * C_(k * TAU);
    P.dy = 0.03 * (1 - open); P.hRoll = 0.04 * (open - 0.5);
    P.fl = norm([0.85, 0.3, -0.25 + open * 0.95]); P.fr = norm([0.85, 0.3, 0.25 - open * 0.95]); P.shN = P.shF = 0.6; P.flLen = P.frLen = 1.15;
    P.tail = 0.35 + 0.1 * open; P.flap = 0.15 * open; P.wob = 0.022; P.wm = 1;
  } },
  think: { n: 8, dur: 2.2, fn(P, k) {
    SEAL_ANIMS.idle.fn(P, k);
    P.fl = norm([0.72, 0.5, -0.4]); P.shN = 0.8; P.flLen = 1.0; P.hRoll = 0.16 + 0.03 * S_(k * TAU); P.hNod = -PSTEP;
  } },
  blow: { n: 8, dur: 1.4, fn(P, k) {
    SEAL_ANIMS.idle.fn(P, k);
    P.cheek = Math.round(S_(clamp01(k / 0.8) * Math.PI) ** 0.6 * 2) / 2;
  } },
  cheer: { n: 8, dur: 0.62, fn(P, k) {
    const s = S_(k * TAU), air = S_(k * Math.PI);
    P.dy = 0.16 * air;
    P.sq = air < 0.25 ? [1.07, 0.91, 1.05] : [0.96, 1.06, 0.97];
    P.fl = norm([0.3, 0.9, 0.5 + 0.25 * s]); P.fr = norm([0.3, 0.9, -0.5 + 0.25 * s]); P.shN = P.shF = 0.9; P.flLen = P.frLen = 1.2;
    P.tail = 0.5; P.flap = 0.2 * s; P.spread = 0.65; P.hRoll = 0.08 * s; P.wob = 0.03; P.hNod = -PSTEP;
  } },
  sad: { n: 8, dur: 2.6, fn(P, k) {
    const s = S_(k * TAU);
    P.sq = [1.03, 0.95 + 0.012 * s, 1.02]; P.hDy = -0.05 + 0.01 * s; P.hRoll = -0.07; P.hNod = PSTEP;
    P.fl = norm([0.12, -0.95, 0.4]); P.fr = norm([0.12, -0.95, -0.4]); P.tail = 0.05; P.spread = 0.3; P.wob = 0.008;
  } },
  sleep: { n: 12, dur: 3.2, fn(P, k) {
    const s = S_(k * TAU);
    P.sq = [1.05, 0.93 + 0.025 * s, 1.04]; P.hDy = -0.07 - 0.015 * s; P.hRoll = -0.12; P.hNod = 2 * PSTEP;
    P.fl = norm([-0.2, -0.6, 0.75]); P.fr = norm([-0.2, -0.6, -0.75]); P.tail = 0.1; P.spread = 0.35; P.wob = 0.008; P.wm = 1;
    P.eyes = 'sleep';
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
function solvePoint(P, e) {
  const q = norm([C_(e) + 0.5 * Math.max(0, S_(e)), S_(e), 0.5 + 0.45 * Math.max(0, S_(e)) + 0.2 * Math.max(0, -S_(e))]);
  const ca = C_(P.a), sa = S_(P.a), ct = C_(P.tau), st = S_(P.tau);
  const z0 = -q[1] * st + q[2] * ct, y = q[1] * ct + q[2] * st;
  const x = q[0] * ca + z0 * sa, z = -q[0] * sa + z0 * ca;
  const cp = C_(P.pitch), sp = S_(P.pitch);
  return norm([x * cp + y * sp, -x * sp + y * cp, z]);
}

function pose(anim, k, b, view) {
  const P = P0(view);
  P.k = k;
  SEAL_ANIMS[anim].fn(P, k, b);
  return P;
}

// ------------------------------------------------------------------------------------------------ caches
const SHEETS = new Map(), HEADS = new Map();
let totalPx = 0;
const PX_CAP = 22e6;
const SIZES = [16, 20, 24, 28, 32, 36, 40, 44, 48, 56, 64, 72, 80, 96, 112, 128];
export function sealSize(s) { for (const z of SIZES) if (z >= s - 1.5) return z; return SIZES[SIZES.length - 1]; }
const DEV = [12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 44, 48, 56, 64, 72, 80, 88, 96, 104, 112, 120, 128, 144, 160, 176, 192, 224, 256];
function devSize(s) {
  if (!bubbleGLAvailable()) s = Math.min(s, 72); // the Canvas2D fallback renders in JS: keep its sheets small
  for (const z of DEV) if (z >= s - 1.5) return z;
  return DEV[DEV.length - 1];
}
function devScale(ctx) {
  try { const m = ctx.getTransform?.(); if (m) { const s = Math.hypot(m.a, m.b); if (s > 0.05 && Number.isFinite(s)) return s; } } catch (e) { /* plain */ }
  return ctx?.__hi || 1;
}

// build budget: at most ~one new sheet / head group per frame (forced builds aside)
let budT = -1e9, budN = 0;
function mayBuild() {
  const now = performance.now();
  if (now - budT > 14) { budT = now; budN = 0; }
  return budN < 1;
}
function spent() { budN++; }

function evict() {
  if (totalPx <= PX_CAP) return;
  const all = [...[...SHEETS].map(([k, v]) => ['s', k, v]), ...[...HEADS].map(([k, v]) => ['h', k, v])].sort((a, b) => a[2].used - b[2].used);
  for (const [kind, key, v] of all) {
    if (totalPx <= PX_CAP * 0.8) break;
    if (performance.now() - v.used < 1500) continue;
    (kind === 's' ? SHEETS : HEADS).delete(key);
    totalPx -= v.px || 0;
  }
}

function buildSheet(anim, U, view) {
  const A = SEAL_ANIMS[anim];
  const n = A.n * (A.buckets || 1);
  const cells = [], frames = [];
  for (let i = 0; i < n; i++) {
    const b = Math.floor(i / A.n), k = (i % A.n) / A.n;
    const { cells: cs, meta } = bodyFrame(pose(anim, k, b, view), U);
    cells.push(...cs);
    frames.push({ ...meta, body: cs[0], flip: cs[1] });
  }
  const pages = renderBubbleCells(cells, { U: U * K, outline: outlineW(U), ink: INK, tints: TINTS });
  const px = pages.reduce((s, c) => s + c.width * c.height, 0);
  totalPx += px;
  const sh = { anim, U, view, n, frames, px, used: performance.now() };
  SHEETS.set(anim + '|' + U + '|' + view, sh);
  evict();
  return sh;
}

function bodySheet(anim, U, view, force) {
  const key = anim + '|' + U + '|' + view;
  let sh = SHEETS.get(key);
  if (sh) { sh.used = performance.now(); return sh; }
  // a cached sheet of a close size (preferably bigger) is used as is: zoom-ins and other transient scales must not
  // bake a new sheet for every size bucket they pass through
  let near = null;
  for (const s of SHEETS.values()) {
    if (s.anim !== anim || s.view !== view || s.U < U * 0.85 || s.U > U * 1.6) continue;
    if (!near || Math.abs(Math.log(s.U / U)) < Math.abs(Math.log(near.U / U))) near = s;
  }
  if (near && !force) { near.used = performance.now(); return near; }
  if (!force && !mayBuild()) {
    // over budget this frame: the nearest cached sheet stands in
    let best = null, bs = Infinity;
    for (const s of SHEETS.values()) {
      const score = (s.anim === anim ? 0 : s.anim === 'idle' ? 2000 : 4000) + (s.view === view ? 0 : 8000) + Math.abs(Math.log(s.U / U)) * 300;
      if (score < bs) { bs = score; best = s; }
    }
    if (best) { best.used = performance.now(); return best; }
  }
  spent();
  try { return buildSheet(anim, U, view); } catch (e) { console.error(e); return null; }
}

const headKey = (U, iy, ip, cq) => U + '|' + iy + '|' + ip + '|' + cq;
const wrapY = (i) => ((i % NY) + NY) % NY;
function buildHeads(U, list) {
  const todo = list.filter(([iy, ip, cq]) => !HEADS.has(headKey(U, iy, ip, cq)));
  if (!todo.length) return;
  const cells = todo.map(([iy, ip, cq]) => headModelCell(iy * YSTEP, ip * PSTEP, cq / 2, U));
  const pages = renderBubbleCells(cells, { U: U * K, outline: outlineW(U), ink: INK, tints: TINTS });
  const px = pages.reduce((s, c) => s + c.width * c.height, 0) / Math.max(1, todo.length);
  totalPx += px * todo.length;
  todo.forEach(([iy, ip, cq], i) => HEADS.set(headKey(U, iy, ip, cq), { cell: cells[i], px, used: performance.now() }));
  evict();
}
function headCell(U, iy, ip, cq, force) {
  iy = wrapY(iy);
  let h = HEADS.get(headKey(U, iy, ip, cq));
  if (h) { h.used = performance.now(); return h.cell; }
  if (force || mayBuild()) {
    spent();
    try { buildHeads(U, [[iy, ip, cq], [wrapY(iy - 1), ip, cq], [wrapY(iy + 1), ip, cq]]); } catch (e) { console.error(e); }
    h = HEADS.get(headKey(U, iy, ip, cq));
    if (h) { h.used = performance.now(); return h.cell; }
  }
  // nearest cached bucket stands in
  let best = null, bs = Infinity;
  for (const [k, v] of HEADS) {
    const [u, y2, p2, c2] = k.split('|').map(Number);
    if (u !== U) continue;
    const dy = Math.min(Math.abs(y2 - iy), NY - Math.abs(y2 - iy));
    const sc = dy * 10 + Math.abs(p2 - ip) * 6 + Math.abs(c2 - cq) * 3;
    if (sc < bs) { bs = sc; best = v; }
  }
  if (best) { best.used = performance.now(); return best.cell; }
  spent();
  try { buildHeads(U, [[iy, ip, cq]]); } catch (e) { console.error(e); return null; }
  return HEADS.get(headKey(U, iy, ip, cq))?.cell || null;
}

export function warmSeal(size = 40, anims = ['idle', 'swim', 'point'], view = 'side') {
  if (typeof document === 'undefined') return true;
  const U = devSize(sealSize(size) * (HI_ON.on ? HI : 1));
  for (const a of anims) if (SEAL_ANIMS[animOf(a)]) bodySheet(animOf(a), U, view, true);
  const a0 = view === 'front' ? A_FRONT : A_SIDE, t0 = view === 'front' ? TAU_FRONT : TAU_SIDE;
  headCell(U, Math.round((a0 + HEAD_TURN) / YSTEP), Math.round(t0 / PSTEP), 0, true);
  return true;
}
export function sealReady(size = 40, view = 'side') { return SHEETS.has('idle|' + devSize(sealSize(size) * (HI_ON.on ? HI : 1)) + '|' + view); }

// ------------------------------------------------------------------------------------------------ per-seal state
const ST = new Map();
function stateOf(id, t, x, y) {
  let s = ST.get(id);
  if (!s || t < s.t - 1 || t - s.t > 2) {
    s = {
      t, x, y, vx: 0, vy: 0, sq: 0, sqv: 0, hx: 0, hy: 0, hvx: 0, hvy: 0, talk: 0, anim: null,
      ly: 0, lp: 0, blinkNext: t + 1.5 + Math.random() * 2, blinkUntil: -1, gx: 0, gy: 0,
      glanceNext: t + 3 + Math.random() * 4, glanceUntil: -1, floats: [], pops: [], floatNext: t + 0.6 + Math.random() * 1.2, dt: 0,
    };
    ST.set(id, s);
    if (ST.size > 40) ST.delete(ST.keys().next().value);
  }
  s.dt = clamp(t - s.t, 0, 0.05);
  return s;
}

function updateJiggle(s, t, x, y, anim, talk, size) {
  const dt = s.dt;
  if (dt > 0) {
    const vx = (x - s.x) / dt, vy = (y - s.y) / dt;
    const ax = (vx - s.vx) / Math.max(dt, 1 / 60), ay = (vy - s.vy) / Math.max(dt, 1 / 60);
    // body: a squash spring, stiff enough to snap back, soft enough to wobble a few times
    let f = -170 * s.sq - 9 * s.sqv + clamp(-ay * 0.0011, -6, 6) + clamp(Math.abs(ax) * 0.0004, 0, 3);
    if (anim !== s.anim) { s.sqv += anim === 'flop' ? -2.2 : 1.1; s.hvy -= 0.35; s.anim = anim; }
    s.talk += ((talk || 0) - s.talk) * Math.min(1, dt * 10);
    f += s.talk * S_(t * 17) * 9;
    s.sqv += f * dt; s.sq = clamp(s.sq + s.sqv * dt, -0.2, 0.2);
    // the head lags behind the body on a jelly spring and bobs while it talks
    const u = Math.max(8, size * K);
    const fx = -150 * s.hx - 7 * s.hvx - clamp(ax / u, -60, 60) * 0.22;
    const fy = -150 * s.hy - 7 * s.hvy - clamp(ay / u, -60, 60) * 0.22 + s.talk * S_(t * 15) * 2.4;
    s.hvx += fx * dt; s.hvy += fy * dt;
    s.hx = clamp(s.hx + s.hvx * dt, -0.09, 0.09); s.hy = clamp(s.hy + s.hvy * dt, -0.09, 0.09);
    s.vx = vx; s.vy = vy;
  }
  s.t = t; s.x = x; s.y = y;
}

// ------------------------------------------------------------------------------------------------ the live face
function ellipse(ctx, x, y, rx, ry, rot = 0) { ctx.beginPath(); ctx.ellipse(x, y, Math.max(0.3, rx), Math.max(0.3, ry), rot, 0, TAU); }

// one eye in its own upright frame (radius r): a big dark glossy Aero eye, moods
function drawEye(ctx, r, o) {
  const { mood, blink, gx, gy, side, px } = o;
  const ink = '#101626';
  ctx.lineCap = 'round';
  if (blink > 0.5 || mood === 'happy-closed' || mood === 'sleep') {
    ctx.strokeStyle = ink; ctx.lineWidth = Math.max(px, r * 0.32);
    ctx.beginPath();
    if (mood === 'sleep') ctx.arc(0, -r * 0.35, r * 0.75, 0.2 * Math.PI, 0.8 * Math.PI);
    else ctx.arc(0, -r * 0.1, r * 0.8, 0.25 * Math.PI, 0.75 * Math.PI);
    ctx.stroke();
    return;
  }
  if (mood === 'laugh' || mood === 'joy') {
    ctx.strokeStyle = ink; ctx.lineWidth = Math.max(px, r * 0.34);
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
  let rx = r * 0.86, ry = r * 1.02;
  if (mood === 'surprised' || mood === 'excited') { rx *= 1.12; ry *= 1.12; }
  const ox = gx * r * 0.2, oy = gy * r * 0.16;
  ctx.save();
  if (mood === 'sad' || mood === 'smug' || mood === 'angry' || mood === 'determined' || mood === 'tired') {
    ctx.beginPath();
    const tiltA = mood === 'sad' ? -0.45 * side : mood === 'smug' || mood === 'tired' ? 0 : 0.45 * side;
    const cut = mood === 'smug' || mood === 'tired' ? -ry * 0.05 : -ry * 0.35;
    ctx.save(); ctx.rotate(tiltA); ctx.rect(-r * 3, cut, r * 6, r * 6); ctx.restore();
    ctx.clip();
  }
  const g = ctx.createLinearGradient(0, oy - ry, 0, oy + ry);
  g.addColorStop(0, '#05070d'); g.addColorStop(0.62, '#141a2a'); g.addColorStop(1, '#2e3d63');
  ctx.fillStyle = g;
  ellipse(ctx, ox, oy, rx, ry, 0.1 * side); ctx.fill();
  // glassy aqua bounce light along the bottom
  ctx.strokeStyle = 'rgba(110,210,255,0.5)'; ctx.lineWidth = Math.max(px * 0.8, r * 0.14);
  ctx.beginPath(); ctx.ellipse(ox, oy, rx * 0.72, ry * 0.76, 0, 0.2 * Math.PI, 0.8 * Math.PI); ctx.stroke();
  // catchlights: a big soft one up-left, a small sharp one down-right
  ctx.fillStyle = '#ffffff';
  ellipse(ctx, ox - rx * 0.3, oy - ry * 0.38, rx * 0.34, ry * 0.28, -0.5); ctx.fill();
  ctx.globalAlpha *= 0.92;
  ellipse(ctx, ox + rx * 0.34, oy + ry * 0.3, rx * 0.14, ry * 0.12); ctx.fill();
  if (mood === 'excited' || mood === 'surprised') { ellipse(ctx, ox + rx * 0.12, oy - ry * 0.66, rx * 0.1, ry * 0.08); ctx.fill(); }
  ctx.restore();
  if (blink > 0.05) { // half-closed: a pearly lid slides down
    ctx.save();
    ellipse(ctx, ox, oy, rx * 1.08, ry * 1.08); ctx.clip();
    ctx.fillStyle = '#dff4ff';
    ctx.fillRect(-r * 1.4, oy - ry * 1.2, r * 2.8, ry * 2.3 * blink);
    ctx.restore();
  }
}

// face features in head space (projected with the live head yaw / pitch): eyes, lens glints, blush, brows, mouth,
// whiskers, sweat drop. S = px per model unit (incl. K), rot = camRot(yaw, pitch).
function drawFace(ctx, o) {
  const { rot, S, st, t } = o;
  const mood = o.mood || 'happy';
  const P2 = (p) => { const q = rot(p); return [q[0] * S, -q[1] * S, q[2]]; };
  const N2 = (n) => { const q = rot(n); return [q[0], -q[1], q[2]]; };
  const px = Math.max(1, S / 60);
  const er = 0.098 * S;
  // gaze (head-local, mirrored by facing already)
  let gx = Math.sin(t * 0.6) * 0.25, gy = Math.sin(t * 0.37) * 0.2;
  if (o.look) { const l = Math.hypot(o.look[0], o.look[1]) || 1, k = Math.min(1, l / 30); gx = (o.look[0] / l) * k; gy = (o.look[1] / l) * k; }
  if (mood === 'think') { gx = 0.6; gy = -0.8; }
  st.gx += (gx - st.gx) * Math.min(1, st.dt * 9); st.gy += (gy - st.gy) * Math.min(1, st.dt * 9);
  if (t > st.blinkNext) { st.blinkUntil = t + 0.13; st.blinkNext = t + 2.2 + Math.random() * 3.5; if (Math.random() < 0.18) st.blinkNext = t + 0.3; }
  const blink = o.blink ?? (t < st.blinkUntil ? 1 : 0);
  let em = mood;
  if (mood === 'happy' && (o.talk || 0) < 0.05 && Math.sin(t * 0.8) > 0.93) em = 'joy';
  if (mood === 'worried' || mood === 'scared') em = 'sad';
  if (o.eyes === 'sleep' || mood === 'sleepy') em = 'sleep';
  const a0 = ctx.globalAlpha;
  const faceN = N2(norm([1, -0.15, 0]));
  // blush on the cheeks (below and outside the eyes)
  if (faceN[2] > -0.2) {
    const bk = mood === 'love' || mood === 'excited' ? 0.6 : mood === 'sad' || mood === 'angry' ? 0.18 : 0.38;
    for (const sd of [1, -1]) {
      const n = N2(norm([0.52, -0.16, 0.72 * sd]));
      if (n[2] < 0.12) continue;
      const c = P2(scl(norm([0.52, -0.16, 0.72 * sd]), HR));
      ctx.globalAlpha = a0 * clamp01((n[2] - 0.12) / 0.3);
      const g = ctx.createRadialGradient(c[0], c[1], 0, c[0], c[1], er * 1.3);
      g.addColorStop(0, `rgba(255,120,170,${bk})`); g.addColorStop(1, 'rgba(255,120,170,0)');
      ctx.fillStyle = g;
      ellipse(ctx, c[0], c[1], er * 1.3 * Math.max(0.45, n[2]), er * 0.8); ctx.fill();
    }
    ctx.globalAlpha = a0;
  }
  // eyes (behind the lens rims, which are baked in the head layer)
  for (const sd of [1, -1]) {
    const e = eyeDir(sd), n = N2(e);
    if (n[2] < 0.06) continue;
    const p = P2(scl(e, HR + 0.006));
    ctx.globalAlpha = a0 * clamp01(n[2] / 0.22);
    ctx.save();
    ctx.translate(p[0], p[1]);
    const ang = Math.atan2(n[1], n[0]);
    ctx.rotate(ang); ctx.scale(Math.max(0.35, n[2]), 1); ctx.rotate(-ang);
    drawEye(ctx, er, { mood: em, blink, gx: st.gx, gy: st.gy, side: sd, px });
    ctx.restore();
  }
  ctx.globalAlpha = a0;
  // lens glints: a glossy arc at the upper left of each lens and a sparkle dot
  for (const sd of [1, -1]) {
    const e = eyeDir(sd), n = N2(e);
    if (n[2] < 0.08) continue;
    const p = P2(scl(e, HR + LENS.lift)), R = LENS.R * S * 0.78;
    ctx.globalAlpha = a0 * clamp01(n[2] / 0.25);
    ctx.save();
    ctx.translate(p[0], p[1]);
    const ang = Math.atan2(n[1], n[0]);
    ctx.rotate(ang); ctx.scale(Math.max(0.35, n[2]), 1); ctx.rotate(-ang);
    ctx.fillStyle = 'rgba(200,240,255,0.12)';
    ellipse(ctx, 0, 0, R * 1.15, R * 1.15); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(px, R * 0.16);
    ctx.beginPath(); ctx.arc(0, 0, R * 0.82, 1.08 * Math.PI, 1.38 * Math.PI); ctx.stroke();
    ctx.restore();
  }
  ctx.globalAlpha = a0;
  // worried / determined brows (above the frames)
  if ((mood === 'worried' || mood === 'scared' || mood === 'angry' || mood === 'determined' || mood === 'sad') && faceN[2] > 0.1) {
    ctx.strokeStyle = '#3c4a72'; ctx.lineWidth = Math.max(px, er * 0.3); ctx.lineCap = 'round';
    const up = mood === 'angry' || mood === 'determined' ? -1 : 1;
    for (const sd of [1, -1]) {
      const n = N2(eyeDir(sd));
      if (n[2] < 0.15) continue;
      const b = P2(scl(norm([0.62, 0.56, 0.44 * sd]), HR * 1.02));
      const inner = -sd;
      ctx.beginPath(); ctx.moveTo(b[0] - er * 0.9, b[1] + er * 0.28 * up * -inner); ctx.lineTo(b[0] + er * 0.9, b[1] + er * 0.28 * up * inner); ctx.stroke();
    }
  }
  if (faceN[2] < 0.02) return;
  // whiskers (twitch while talking): three fine lines from each whisker pad
  if (S >= 30) {
    const tw = (o.talk || 0) * 0.25 * Math.sin(t * 30);
    ctx.lineCap = 'round';
    for (const sd of [1, -1]) {
      const c0 = P2([0.37, -0.14, 0.115 * sd]), c1 = P2([0.37, -0.14, 0.265 * sd]);
      let dx = c1[0] - c0[0], dy = c1[1] - c0[1];
      const dl = Math.hypot(dx, dy);
      if (dl < S * 0.02) continue;
      dx /= dl; dy /= dl;
      ctx.strokeStyle = 'rgba(40,70,120,0.55)'; ctx.lineWidth = Math.max(px * 0.8, S * 0.012);
      for (let i = -1; i <= 1; i++) {
        const a = i * 0.24 + tw * sd, ca = Math.cos(a), sa = Math.sin(a);
        const wx = dx * ca - dy * sa, wy = dx * sa + dy * ca;
        const L = S * (0.26 - Math.abs(i) * 0.04);
        const x0 = c1[0] - dx * S * 0.04 + i * 0, y0 = c1[1] + i * S * 0.03;
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.quadraticCurveTo(x0 + wx * L * 0.55, y0 + wy * L * 0.55 - S * 0.012, x0 + wx * L, y0 + wy * L + S * 0.01); ctx.stroke();
      }
      // whisker dots on the pad
      ctx.fillStyle = 'rgba(70,96,150,0.55)';
      for (let i = 0; i < 3; i++) { const q = P2([0.45, -0.1 - (i % 2) * 0.05, (0.1 + i * 0.04) * sd]); if (rot([0.8, 0, 0.55 * sd])[2] > 0) { ellipse(ctx, q[0], q[1], S * 0.011, S * 0.011); ctx.fill(); } }
    }
  }
  // mouth: a little "w" under the nose, opening while talking
  const mn = N2(norm([0.85, -0.45, 0]));
  if (mn[2] > 0.02) {
    const [mx, my] = P2(MOUTH);
    const w = S * 0.055, talk = clamp01(o.talk || 0);
    const k = Math.max(0.4, mn[2]);
    if (talk > 0.06 || mood === 'surprised' || mood === 'excited' || em === 'joy') {
      const open = Math.max(talk, mood === 'surprised' ? 0.6 : mood === 'excited' || em === 'joy' ? 0.3 : 0);
      const oh = S * (0.02 + open * 0.05), ow = S * (mood === 'surprised' ? 0.038 : 0.05) * k;
      ctx.fillStyle = '#4d1a34';
      ellipse(ctx, mx, my + oh * 0.5, ow, oh); ctx.fill();
      ctx.fillStyle = '#ff7fa6';
      ellipse(ctx, mx, my + oh * 0.95, ow * 0.62, oh * 0.42); ctx.fill();
    }
    ctx.strokeStyle = '#3c3456'; ctx.lineWidth = Math.max(px, S * 0.022); ctx.lineCap = 'round';
    ctx.beginPath();
    if (mood === 'sad' || mood === 'worried' || mood === 'scared') {
      ctx.moveTo(mx - w * k, my + w * 0.45); ctx.quadraticCurveTo(mx - w * 0.5 * k, my - w * 0.25, mx, my + w * 0.1);
      ctx.quadraticCurveTo(mx + w * 0.5 * k, my - w * 0.25, mx + w * k, my + w * 0.45);
    } else {
      ctx.moveTo(mx - w * k, my - w * 0.15); ctx.quadraticCurveTo(mx - w * 0.5 * k, my + w * 0.7, mx, my);
      ctx.quadraticCurveTo(mx + w * 0.5 * k, my + w * 0.7, mx + w * k, my - w * 0.15);
    }
    ctx.stroke();
  }
  // a glossy sweat drop when it is worried
  if (mood === 'worried' || mood === 'scared' || o.anim === 'worried') {
    const q = P2(scl(norm([0.1, 0.6, 0.8]), HR * 1.05));
    const s2 = S, dx = q[0], dy = q[1] + ((t * 2) % 1) * s2 * 0.08;
    ctx.fillStyle = '#7fdcff';
    ctx.beginPath(); ctx.moveTo(dx, dy - s2 * 0.12); ctx.quadraticCurveTo(dx + s2 * 0.08, dy, dx, dy + s2 * 0.05); ctx.quadraticCurveTo(dx - s2 * 0.08, dy, dx, dy - s2 * 0.12); ctx.fill();
    ctx.fillStyle = '#ffffff'; ellipse(ctx, dx - s2 * 0.015, dy - s2 * 0.02, s2 * 0.015, s2 * 0.02); ctx.fill();
  }
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
// [seal19] the soap bubble is a real 3D bubble (the same renderer as Bubbles), cached per device radius
const SOAP = new Map();
function soapCell(R) {
  let c = SOAP.get(R);
  if (c !== undefined) return c;
  c = null;
  try {
    const cell = makeCell([{ x: 0, y: 0, z: 0, r: R, kind: 0, dens: 0.16, film: 0.15, tint: T.belly }], null, null, 2);
    renderBubbleCells([cell], { U: R * 1.2, outline: 1, ink: [0.1, 0.3, 0.5, 0.3], tints: TINTS });
    c = cell;
  } catch (e) { c = null; }
  SOAP.set(R, c);
  if (SOAP.size > 40) SOAP.delete(SOAP.keys().next().value);
  return c;
}
export function drawSoapBubble(ctx, x, y, r, sq = 0) {
  if (r >= 3 && typeof document !== 'undefined') {
    const ds = devScale(ctx), q = r * ds > 24 ? 4 : 2, R = Math.max(4, Math.round((r * ds) / q) * q);
    const cell = soapCell(R);
    if (cell) {
      const k = r / R, w = cell.w * k * (1 + sq * 0.12), h = cell.h * k * (1 - sq * 0.1);
      const sm = ctx.imageSmoothingEnabled;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(cell.page, cell.sx, cell.sy, cell.w, cell.h, x - w / 2, y - h / 2, w, h);
      ctx.imageSmoothingEnabled = sm;
      return;
    }
  }
  const c = rideBubble(r);
  const w = c.width * (1 + sq * 0.12), h = c.height * (1 - sq * 0.1);
  ctx.drawImage(c, Math.round(x - w / 2), Math.round(y - h / 2), Math.round(w), Math.round(h));
}


// ------------------------------------------------------------------------------------------------ floating bubbles
// Little bubbles bud off the body, float up wobbling and pop into a few droplet pixels and a tiny sparkle.
function updateFloaters(st, t, emit, size, on, toScreen) {
  const dt = st.dt, u = size / 40;
  if (on && t > st.floatNext && emit.length) {
    st.floatNext = t + 1.1 + Math.random() * 1.9;
    st.floats.push({ ei: Math.floor(Math.random() * emit.length), x: 0, y: 0, r: size * K * (0.045 + 0.04 * Math.random()), t: 0, life: 1.5 + Math.random() * 1.3, vx: (Math.random() - 0.5) * 8 * u, vy: -(9 + Math.random() * 9) * u, ph: Math.random() * 9, free: false });
  }
  for (const b of st.floats) {
    b.t += dt;
    if (!b.free) { const e = emit[b.ei % emit.length]; if (e) { const q = toScreen(e); b.x = q[0]; b.y = q[1] - b.r * Math.min(1, b.t / 0.35); } if (b.t > 0.35) b.free = true; continue; }
    b.vy -= 7 * u * dt;
    b.x += (b.vx + Math.sin(b.t * 4.2 + b.ph) * 7 * u) * dt; b.y += b.vy * dt;
    if (b.t > b.life) {
      for (let i = 0; i < 5; i++) { const a = (i / 5) * TAU + b.ph; st.pops.push({ x: b.x + Math.cos(a) * b.r, y: b.y + Math.sin(a) * b.r, vx: Math.cos(a) * 34 * u, vy: Math.sin(a) * 34 * u - 6 * u, t: 0, life: 0.24 }); }
      st.pops.push({ x: b.x, y: b.y, t: 0, life: 0.12, spark: true, s: Math.max(1, Math.min(3, Math.round(b.r * 0.45))) });
    }
  }
  st.floats = st.floats.filter((b) => b.t <= b.life);
  if (st.floats.length > 8) st.floats.splice(0, st.floats.length - 8);
  for (const p of st.pops) { p.t += dt; if (!p.spark) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 60 * u * dt; } }
  st.pops = st.pops.filter((p) => p.t < p.life);
}
function drawFloaters(ctx, st) {
  const a0 = ctx.globalAlpha;
  for (const b of st.floats) {
    const grow = Math.min(1, b.t / 0.35);
    drawAeroBubble(ctx, b.x, b.y, Math.max(1.2, b.r * (0.4 + 0.6 * grow)), clamp01((b.life - b.t) / 0.25 + 0.4) * clamp01(b.t * 8));
  }
  for (const p of st.pops) {
    const k = 1 - p.t / p.life;
    ctx.globalAlpha = a0 * k;
    ctx.fillStyle = p.spark ? '#ffffff' : '#dff8ff';
    if (p.spark) {
      const s = p.s, x = Math.round(p.x), y = Math.round(p.y);
      ctx.fillRect(x - s, y, s * 2 + 1, 1); ctx.fillRect(x, y - s, 1, s * 2 + 1);
    } else ctx.fillRect(Math.round(p.x), Math.round(p.y), 1, 1);
  }
  ctx.globalAlpha = a0;
}

// ------------------------------------------------------------------------------------------------ drawSeal
export function pointBucket(ex, ey) { return clamp(Math.round(Math.atan2(-ey, Math.max(1, ex)) / (Math.PI / 6)) + 3, 0, 6); }

// per-seal scratch canvases: two cross-fade layers and the composite
const COMP = new Map();
function scratch(id) {
  let c = COMP.get(id);
  if (!c) {
    const mk = () => document.createElement('canvas');
    c = { a: mk(), l: mk() };
    COMP.set(id, c);
    if (COMP.size > 24) COMP.delete(COMP.keys().next().value);
  }
  return c;
}
function fit(c, w, h) {
  if (c.width < w || c.height < h || c.width > w * 2 + 96 || c.height > h * 2 + 96) { c.width = Math.max(1, w + 16); c.height = Math.max(1, h + 16); }
  const g = c.getContext('2d');
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
  g.clearRect(0, 0, w + 1, h + 1);
  return g;
}
const cellRect = (c, ox, oy) => [ox - c.ax, oy - c.ay, ox - c.ax + c.w, oy - c.ay + c.h];
// cell A cross-faded into B (premultiplied linear blend through 'lighter') with both anchors at (ox, oy)
function blendInto(g, A, B, f, ox, oy) {
  const two = B && B !== A && f > 0.02;
  g.globalCompositeOperation = 'source-over';
  g.globalAlpha = two ? 1 - f : 1;
  g.drawImage(A.page, A.sx, A.sy, A.w, A.h, ox - A.ax, oy - A.ay, A.w, A.h);
  if (two) {
    g.globalCompositeOperation = 'lighter'; g.globalAlpha = f;
    g.drawImage(B.page, B.sx, B.sy, B.w, B.h, ox - B.ax, oy - B.ay, B.w, B.h);
  }
  g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
}

export function drawSeal(ctx, o = {}) {
  if (typeof document === 'undefined') return null;
  const view = o.view === 'front' ? 'front' : 'side';
  const want = animOf(o.anim);
  const t = o.t ?? 0, facing = (o.facing ?? 1) < 0 ? -1 : 1, kk = o.k ?? 1, tilt = o.tilt || 0;
  const size = Math.max(4, o.size ?? 40);
  let x = o.x ?? 0, y = o.y ?? 0;
  // pointing: elevation bucket from the target (in the facing frame, tilt removed)
  let bucket = 0;
  if (want === 'point') {
    if (o.point) {
      const dx = (o.point[0] - x) * facing, dy = o.point[1] - y;
      const c = Math.cos(-tilt * facing), s = Math.sin(-tilt * facing);
      bucket = pointBucket(dx * c - dy * s, dx * s + dy * c);
    } else bucket = 4;
  }
  const sh = bodySheet(want, devSize(size * devScale(ctx)), view, SHEETS.size === 0);
  if (!sh) return null;
  const anim = sh.anim, A = SEAL_ANIMS[anim];
  const ph = o.phase != null ? o.phase : t / A.dur;
  const fp = ph * A.n, i0 = Math.floor(fp), fr = fp - i0;
  const base = anim === 'point' ? clamp(bucket, 0, (A.buckets || 1) - 1) * A.n : 0;
  const F = sh.frames[base + ((i0 % A.n) + A.n) % A.n], F1 = sh.frames[base + (((i0 + 1) % A.n) + A.n) % A.n];
  const U = sh.U, S = U * K, sc = (size * kk) / U;
  const L2 = (a, b) => [a[0] + (b[0] - a[0]) * fr, a[1] + (b[1] - a[1]) * fr];
  const Lf = (k) => F[k] + (F1[k] - F[k]) * fr;
  const lift = Lf('dy') * S;
  const bottom = L2(F.bottom, F1.bottom);
  let headP = L2(F.head, F1.head);
  const ride = clamp01(o.ride || 0);
  const rideR = size * kk * 0.5 * (0.35 + 0.65 * ride);
  if (o.anchor === 'head') { x -= headP[0] * sc * facing; y -= (headP[1] - lift) * sc; }
  else if (o.base === 'bottom') y -= bottom[1] * sc + (ride ? rideR * 1.5 : 0);
  const id = o.id ?? 'seal';
  const st = stateOf(id, t, x, y);
  updateJiggle(st, t, x, y, anim, o.talk, size * kk);
  // where the head looks: lookAt -> yaw / nod offsets quantised to the baked buckets and eased (a short cross-fade)
  const hs = [x + headP[0] * sc * facing, y + (headP[1] - lift) * sc];
  let yT = 0, pT = 0, look = null;
  if (o.lookAt && anim !== 'spin' && anim !== 'sleep') {
    const lx = ((o.lookAt[0] - hs[0]) * facing) / (size * kk * K), ly = (o.lookAt[1] - hs[1]) / (size * kk * K);
    if (Math.hypot(lx, ly) > 0.3) { yT = lx > 0 ? -0.55 * Math.tanh(lx * 0.8) : 0.95 * Math.tanh(-lx * 0.6); pT = 0.3 * Math.tanh(ly * 0.7); }
    look = [(o.lookAt[0] - hs[0]) * facing, o.lookAt[1] - hs[1]];
  } else if ((anim === 'idle' || anim === 'blow') && view === 'side' && !o.portrait) {
    if (t > st.glanceNext) { st.glanceUntil = t + 1.1 + Math.random() * 1.3; st.glanceNext = t + 4 + Math.random() * 5; }
    if (t < st.glanceUntil) yT = Math.PI / 2 - A_SIDE - HEAD_TURN - 0.17; // a friendly look at the viewer
  }
  yT = qn(yT, YSTEP); pT = qn(pT, PSTEP);
  const ease = Math.min(1, st.dt * 7);
  st.ly += (yT - st.ly) * ease; st.lp += (pT - st.lp) * ease;
  if (Math.abs(yT - st.ly) < 0.004) st.ly = yT;
  if (Math.abs(pT - st.lp) < 0.003) st.lp = pT;
  const fa = Math.abs(F1.a - F.a) < Math.PI ? Lf('a') : F.a;
  const hyaw = fa + HEAD_TURN + F.hYaw + st.ly, hpitch = F.tau + F.hNod + st.lp;
  const fy = hyaw / YSTEP, iy0 = Math.floor(fy + 1e-6), yf = fy - iy0;
  const ip = Math.round(hpitch / PSTEP), cq = Math.round(Lf('cheek') * 2);
  const HA = headCell(U, iy0, ip, cq, HEADS.size === 0);
  const HB = yf > 0.02 ? headCell(U, iy0 + 1, ip, cq, false) : null;
  // head placement (sheet px, relative to the body anchor): the attach point + 2D nod / bob + the jelly lag
  headP = [headP[0] + (Lf('hDx') + st.hx) * S, headP[1] - (Lf('hDy') + st.hy) * S];
  const hRoll = Lf('hRoll'), hSq = Lf('hSq');
  const zHead = Lf('headZ'), zFlip = Lf('flipZ');
  // ---- composite: body, head (+ live face) and the near flipper, ordered by depth
  const SC = scratch(id);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const grow = (r) => { x0 = Math.min(x0, r[0]); y0 = Math.min(y0, r[1]); x1 = Math.max(x1, r[2]); y1 = Math.max(y1, r[3]); };
  for (const c of [F.body, F1.body, F.flip, F1.flip]) grow(cellRect(c, 0, 0));
  for (const Hc of [HA, HB]) {
    if (!Hc) continue;
    const m = Math.hypot(Math.max(Hc.ax, Hc.w - Hc.ax), Math.max(Hc.ay, Hc.h - Hc.ay)) * 1.06 + 4;
    grow([headP[0] - m, headP[1] - m, headP[0] + m, headP[1] + m]);
  }
  x0 = Math.floor(x0); y0 = Math.floor(y0);
  const W = Math.ceil(x1 - x0), H = Math.ceil(y1 - y0);
  const g = fit(SC.a, W, H);
  g.translate(-x0, -y0);
  const rot = camRot(hyaw, hpitch);
  const mood = o.mood || (anim === 'sad' ? 'sad' : anim === 'worried' ? 'worried' : anim === 'cheer' ? 'excited' : 'happy');
  const layer = (A0, A1, f, ox, oy) => {
    const r = [Math.min(cellRect(A0, ox, oy)[0], A1 ? cellRect(A1, ox, oy)[0] : Infinity), Math.min(cellRect(A0, ox, oy)[1], A1 ? cellRect(A1, ox, oy)[1] : Infinity)];
    const r2 = [Math.max(cellRect(A0, ox, oy)[2], A1 ? cellRect(A1, ox, oy)[2] : -Infinity), Math.max(cellRect(A0, ox, oy)[3], A1 ? cellRect(A1, ox, oy)[3] : -Infinity)];
    const lx = Math.floor(r[0]), ly = Math.floor(r[1]), lw = Math.ceil(r2[0] - lx), lh = Math.ceil(r2[1] - ly);
    if (!(A1 && A1 !== A0 && f > 0.02)) { g.drawImage(A0.page, A0.sx, A0.sy, A0.w, A0.h, ox - A0.ax, oy - A0.ay, A0.w, A0.h); return; }
    const gl2 = fit(SC.l, lw, lh);
    blendInto(gl2, A0, A1, f, ox - lx, oy - ly);
    g.drawImage(SC.l, 0, 0, lw, lh, lx, ly, lw, lh);
  };
  const drawBody = () => layer(F.body, F1.body, fr, 0, 0);
  const drawFlip = () => layer(F.flip, F1.flip, fr, 0, 0);
  const drawHead = () => {
    if (!HA) return;
    g.save();
    g.translate(headP[0], headP[1]);
    const pv = HR * 0.55 * S;
    g.translate(0, pv); g.rotate(hRoll); g.scale(1 / Math.sqrt(hSq), hSq); g.translate(0, -pv);
    if (HB && HB !== HA) {
      const r0 = cellRect(HA, 0, 0), r1 = cellRect(HB, 0, 0);
      const lx = Math.floor(Math.min(r0[0], r1[0])), ly = Math.floor(Math.min(r0[1], r1[1]));
      const lw = Math.ceil(Math.max(r0[2], r1[2]) - lx), lh = Math.ceil(Math.max(r0[3], r1[3]) - ly);
      const gl2 = fit(SC.l, lw, lh);
      blendInto(gl2, HA, HB, yf, -lx, -ly);
      g.drawImage(SC.l, 0, 0, lw, lh, lx, ly, lw, lh);
    } else g.drawImage(HA.page, HA.sx, HA.sy, HA.w, HA.h, -HA.ax, -HA.ay, HA.w, HA.h);
    drawFace(g, { rot, S, st, t, mood, talk: o.talk, look, blink: o.blink, eyes: F.eyes, anim });
    g.restore();
  };
  const items = [[0, drawBody], [zHead + 0.02 * S, drawHead], [zFlip, drawFlip]].sort((a, b) => a[0] - b[0]);
  for (const [, fn] of items) fn();
  // ---- the composite onto the target: squash spring about the bottom, facing, tilt, lift
  const sqX = 1 - st.sq * 0.7, sqY = 1 + st.sq;
  const ct = Math.cos(tilt), sn = Math.sin(tilt);
  const toScreen = (p) => {
    const px = p[0] * sqX, py = bottom[1] + (p[1] - bottom[1]) * sqY - lift;
    const lx = px * facing * sc, ly = py * sc;
    return [x + lx * ct - ly * sn, y + lx * sn + ly * ct];
  };
  // head-space point -> sheet px (with the head's 2D roll / squash)
  const headPt = (q) => {
    const c = rot(q), pv = HR * 0.55 * S;
    let hx = c[0] * S, hy = -c[1] * S - pv;
    hx /= Math.sqrt(hSq); hy *= hSq;
    const cr = Math.cos(hRoll), sr = Math.sin(hRoll);
    return [headP[0] + hx * cr - hy * sr, headP[1] + pv + hx * sr + hy * cr];
  };
  const a0 = ctx.globalAlpha;
  if (o.alpha != null) ctx.globalAlpha = a0 * o.alpha;
  const bot = toScreen([bottom[0], bottom[1] + lift]);
  if (ride > 0.02) {
    const sq = ride * (0.5 + 0.5 * Math.sin(t * 2.2));
    const ga = ctx.globalAlpha;
    ctx.globalAlpha = ga * 0.7;
    drawSoapBubble(ctx, bot[0], bot[1] + rideR * 0.55, rideR, sq);
    ctx.globalAlpha = ga;
  }
  ctx.save();
  ctx.translate(x, y);
  if (tilt) ctx.rotate(tilt);
  ctx.scale(facing * sc, sc);
  ctx.translate(0, bottom[1] - lift); ctx.scale(sqX, sqY); ctx.translate(0, -bottom[1]);
  const smooth = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(SC.a, 0, 0, W, H, x0, y0, W, H);
  ctx.imageSmoothingEnabled = smooth;
  ctx.restore();
  // little bubbles budding off the body, floating up and popping
  const emit = F.emit;
  updateFloaters(st, t, emit, size * kk, o.floaters !== false && anim !== 'swim', toScreen);
  drawFloaters(ctx, st);
  // the bubble on its nose (thrilled) / the sleepy snot bubble
  const nose = toScreen(headPt(NOSE.slice(0, 3)));
  let nb = clamp01(o.noseBubble || 0);
  if (anim === 'sleep' && o.noseBubble == null) nb = 0.45 + 0.4 * Math.sin((t / A.dur) * TAU);
  if (nb > 0.02 && rot([1, 0, 0])[2] > -0.2) {
    const r = size * kk * 0.11 * nb;
    drawSoapBubble(ctx, nose[0] + facing * r * 1.15 + Math.sin(t * 3.1) * r * 0.12, nose[1] - r * 0.1 - Math.abs(Math.sin(t * 3.1)) * r * 0.2, r, 0);
  }
  ctx.globalAlpha = a0;
  const U_ = HAT.up, apex = add(scl(U_, HR * 0.78 + HAT.H), scl(U_, 0.1));
  const out = {
    head: toScreen(headP), top: toScreen(headPt(apex)), mouth: toScreen(headPt(MOUTH)), nose,
    hand: toScreen(L2(F.hand, F1.hand)), tail: toScreen(L2(F.tail, F1.tail)), bottom: bot, center: [x, y],
  };
  const hr = HR * S * sc;
  const pts = [out.top, out.bottom, out.tail, out.nose, out.hand, [out.head[0] - hr, out.head[1] - hr], [out.head[0] + hr, out.head[1] + hr]];
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const m = size * kk * 0.06;
  const rx0 = Math.min(...xs) - m, ry0 = Math.min(...ys) - m;
  out.rect = { x: rx0, y: ry0, w: Math.max(...xs) - rx0 + m, h: Math.max(...ys) - ry0 + m + (ride > 0.1 ? rideR * 1.2 : 0) };
  return out;
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
