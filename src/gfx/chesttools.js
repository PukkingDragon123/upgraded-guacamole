// [chest16] The tools the bubble person cracks chests with, and the poses that swing them (registered into
// src/gfx/character.js through registerTool / registerPose, so they are lit and composed with the character's
// voxels like the fishing rod). Importing this module registers everything.
//
//   CHEST_TOOL {crate: 'hammer', iron: 'crowbar', golden: 'mallet', orb: 'tapper'}
//   Poses (per tool kind k): `ck_walk_k` (carried on the shoulder), `ck_ready_k` (idle stance), `ck_wipe_k`
//   (wipes the bubble, phew), `ck_cheer_k` (hop + tool raised). Minigame poses:
//     ck_wind   hammer wind-up, frame = power 0..1 (8 frames)      ck_smash  overhead smash (6 frames, impact = 3)
//     ck_buzz   the hammer bounced off and rings (loop)            ck_pry    crowbar strain, frame = force 0..1
//     ck_chisel mallet taps the chisel (6 frames, impact = 3)      ck_tap    tapper taps the orb (6 frames, impact = 3)
//     ck_ouch   hops holding a thumped hand (loop)                 ck_slip   lands on the bum (non-loop)
//   frameT(pose, k01) -> t for drawCharacter that shows frame round(k01 * (n - 1)) of a non-loop pose.
import { registerTool, registerPose } from './character.js';

export const CHEST_TOOL = { crate: 'hammer', iron: 'crowbar', golden: 'mallet', orb: 'tapper' };

// ---------------------------------------------------------------- tool models (pivot = grip, +y = handle, +z = head face)

registerTool('hammer', (tk) => {
  const m = tk.model(13, 34, 17);
  const ax = 6, az = 8, gy = 3;
  const wood = tk.col('#d49a5c', { smooth: 0.5 }), woodD = tk.col('#a8703e', { smooth: 0.5 }), woodL = tk.col('#ecc088', { smooth: 0.5 });
  const tape = tk.gloss('#ff5a4a'), tapeL = tk.gloss('#ffd0c0'), knob = tk.gloss('#7a4a2a');
  const steel = tk.gloss('#8c9cb4', { spec: 1.4, specPow: 8 }), steelD = tk.gloss('#5d6a84', { spec: 1 }), face = tk.gloss('#eef4fa', { spec: 1.6, specPow: 6 });
  const band = tk.gloss('#ffd23a', { spec: 1.4 }), fish = tk.gloss('#ff9a3a');
  // handle with grain, a red grip wrap and a round knob
  for (let y = 0; y <= 26; y++) m.cylinder(ax, az, y, y, y < 9 ? 1.25 : 1.0, y < 9 ? ((y >> 1) % 2 ? tape : tapeL) : y % 5 === 0 ? woodD : y % 3 === 0 ? woodL : wood);
  m.sphere(ax, 0.5, az, 1.6, knob);
  // the big head (a cartoon sledge): steel block, polished faces, a gold band, a little fish sticker
  m.box(ax - 3, 24, az - 7, ax + 3, 31, az + 7, (x, y, z) => ((x === ax - 3 || x === ax + 3) && (y === 24 || y === 31) ? null : (z === az - 7 || z === az + 7) ? face : y === 24 ? steelD : steel));
  m.paint(() => m.box(ax - 3, 24, az - 1, ax + 3, 31, az, band));
  for (const [dx, dy] of [[0, 0], [1, 0], [2, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-2, 1], [-2, -1]]) m.set(ax + 3, 27 + dy, az + 3 + dx, fish);
  return { m, pivot: [ax, gy, az], anchors: { head: [ax + 0.5, 27.5, az + 7.5], grip2: [ax, gy + 6, az] } };
});

registerTool('crowbar', (tk) => {
  const m = tk.model(9, 36, 16);
  const ax = 4, az = 4, gy = 3;
  const red = tk.gloss('#ff4a3a', { spec: 1.2 }), redD = tk.gloss('#c82a2a'), steel = tk.gloss('#dfe8f0', { spec: 1.6, specPow: 6 }), grip = tk.col('#2a2a3a'), gripL = tk.col('#4a4a5e');
  for (let y = 0; y <= 27; y++) m.cylinder(ax, az, y, y, 0.95, y < 8 ? (y % 2 ? grip : gripL) : y % 6 === 0 ? redD : red);
  m.cylinder(ax, az, -1, 0, 1.2, steel);
  // the claw: curls toward +z, forked tip
  const P = [[ax, 27, az], [ax, 30, az + 1], [ax, 31.5, az + 3.5], [ax, 31, az + 6.5], [ax, 29.5, az + 9]];
  for (let i = 0; i < P.length - 1; i++) m.line(...P[i], ...P[i + 1], i < 2 ? red : steel, 0.95);
  m.sub(() => m.box(ax, 29, az + 8, ax, 30, az + 10, 1));
  return { m, pivot: [ax, gy, az], anchors: { head: [ax + 0.5, 29.5, az + 9.5], grip2: [ax, gy + 5, az] } };
});

registerTool('mallet', (tk) => {
  const m = tk.model(17, 28, 17);
  const ax = 8, az = 8, gy = 2;
  const wood = tk.col('#c8925a', { smooth: 0.5 }), woodD = tk.col('#93603a'), head = tk.gloss('#f6dcaa', { spec: 0.7 }), ring = tk.gloss('#ffd23a', { spec: 1.6 }), headD = tk.col('#d8b070'), gem = tk.glow('#ff5a8a', 0.5);
  for (let y = 0; y <= 18; y++) m.cylinder(ax, az, y, y, y < 6 ? 1.2 : 1.0, y < 6 ? (y % 2 ? woodD : wood) : wood);
  m.cylinder(ax, 22, az - 6, az + 6, 4.2, (x, y, z) => (z === az - 6 || z === az + 6 ? headD : Math.abs(z - az) === 4 ? ring : head), 'z');
  m.set(ax + 4, 22, az, gem); m.set(ax + 4, 23, az, gem); m.set(ax + 4, 22, az + 1, gem); m.set(ax + 4, 23, az + 1, gem);
  return { m, pivot: [ax, gy, az], anchors: { head: [ax + 0.5, 22, az + 6.5], grip2: [ax, gy + 5, az] } };
});

registerTool('chisel', (tk) => {
  const m = tk.model(7, 26, 7);
  const ax = 3, az = 3, gy = 3;
  const wood = tk.gloss('#ff8a3a', { spec: 0.8 }), woodD = tk.gloss('#d8602a'), cap = tk.gloss('#ffd23a', { spec: 1.4 }), steel = tk.gloss('#e8eef4', { spec: 1.6, specPow: 6 }), edge = tk.glow('#ffffff', 0.5);
  for (let y = 0; y <= 7; y++) m.cylinder(ax, az, y, y, 1.3, y % 3 === 0 ? woodD : wood);
  m.cylinder(ax, az, 8, 9, 1.1, cap);
  m.box(ax - 1, 10, az, ax + 1, 21, az, steel);
  m.box(ax, 10, az - 1, ax, 16, az + 1, steel);
  m.box(ax - 1, 22, az, ax + 1, 22, az, edge);
  return { m, pivot: [ax, gy, az], anchors: { head: [ax + 0.5, 22.5, az + 0.5], grip2: [ax, gy, az] } };
});

registerTool('tapper', (tk) => {
  const m = tk.model(13, 30, 19);
  const ax = 6, az = 9, gy = 2;
  const shaft = tk.gloss('#f4f8ff', { spec: 1.4 }), wrap = tk.gloss('#5ad0ff'), gold = tk.gloss('#ffd23a', { spec: 1.5 });
  const pink = tk.gloss('#ff8ae0', { spec: 1.6, specPow: 10 }), pinkD = tk.gloss('#c85ab8'), pinkL = tk.glow('#ffe0f8', 0.75), star = tk.glow('#fff6a0', 0.95);
  for (let y = 0; y <= 21; y++) m.cylinder(ax, az, y, y, y < 7 ? 1.2 : 0.9, y < 7 ? (y % 2 ? wrap : shaft) : y % 4 === 0 ? gold : shaft);
  m.cylinder(ax, az, 21, 22, 1.7, gold);
  // a crystal hammer head, faceted and tapering, with a glowing striking tip
  for (let z = az - 7; z <= az + 7; z++) { const r = 3.0 - Math.abs(z - az) * 0.2; m.cylinder(ax, 25, z, z, Math.max(1, r), z >= az + 6 ? pinkL : (z + 25) % 3 === 0 ? pinkD : pink, 'z'); }
  for (const [dx, dy] of [[0, 0], [0, 1], [0, -1], [1, 0], [-1, 0]]) m.set(ax + dx, 29 + dy, az - 5, star);
  return { m, pivot: [ax, gy, az], anchors: { head: [ax + 0.5, 25, az + 7.5], grip2: [ax, gy + 5, az] } };
});

// ---------------------------------------------------------------- poses
// Hand targets are written in the bubble person's own body units (x + = its left, y up from the hips, z forward)
// and converted to the rig's legacy units here.
const R = ([x, y, z]) => [-7.3 + (x + 4.9) / 0.7, 11.4 + (y - 6.9) / 0.7, -0.2 + z / 0.7];
const L = ([x, y, z]) => [7.3 + (x - 4.9) / 0.7, 11.4 + (y - 6.9) / 0.7, -0.2 + z / 0.7];
const S = Math.sin, TAU = Math.PI * 2;
const mixA = (a, b, k) => a.map((v, i) => v + (b[i] - v) * k);
const smooth = (k) => k * k * (3 - 2 * k);

// where each tool rests (shoulder carry / ready stance)
const REST = {
  hammer: { hand: [-2.2, 5.6, 5.0], pitch: 64, yaw: -18, two: true, walk: 118 },
  crowbar: { hand: [-2.6, 5.0, 4.8], pitch: 70, yaw: -10, two: false, walk: 112 },
  mallet: { hand: [-3.0, 5.0, 4.6], pitch: 80, yaw: -8, two: false, chisel: true, walk: 100 },
  tapper: { hand: [-2.8, 6.0, 5.6], pitch: 40, yaw: -10, two: false, walk: 96 },
};

for (const [k, r] of Object.entries(REST)) {
  const tool = (o = {}) => ({ kind: k, pitch: r.pitch, yaw: r.yaw, ...o });
  const left = (u) => (r.two ? 'tool' : L([4.4 + 0.3 * S(u * TAU), 2.6, 3.2]));
  const tool2 = r.chisel ? { kind: 'chisel', pitch: 14, yaw: -12 } : null;
  registerPose('ck_walk_' + k, { n: 8, dur: 0.56, loop: true, fn: (u) => {
    const s = S(u * TAU), b = Math.abs(S(u * TAU));
    return { off: [0, 0.5 * b, 0], spine: [4, -4 * s, 0], neck: [-3, 0, 3 * s], hipL: [-26 * s, 0, 3], knL: [Math.max(0, 30 * s), 0, 0], hipR: [26 * s, 0, -3], knR: [Math.max(0, -30 * s), 0, 0],
      handR: R(mixA(r.hand, [-2.6, 6.2, 2.4], 0.6)), tool: tool({ pitch: r.walk }), handL: L([4.6, 2.4 - 0.6 * s, 2.6 + 1.5 * s]), mouth: 'grin', gaze: [0.4, 0] };
  } });
  registerPose('ck_ready_' + k, { n: 8, dur: 1.5, loop: true, fn: (u) => {
    const b = S(u * TAU);
    return { off: [0, -0.25 + 0.25 * b, 0], spine: [3 + 1.5 * b, 0, 0], neck: [-2 + 1.5 * b, 4, 2 * S(u * TAU + 1)], knL: [8 + 3 * b, 0, 0], knR: [8 + 3 * b, 0, 0], hipL: [-6, 0, 6], hipR: [-4, 0, -8],
      handR: R(r.hand), tool: tool({ pitch: r.pitch + 4 * b }), handL: tool2 ? L([2.4, 5.6, 6.2]) : left(u), tool2, gaze: [0.6, 0.1] };
  } });
  registerPose('ck_wipe_' + k, { n: 8, dur: 1.3, loop: true, fn: (u) => {
    const s = S(u * TAU * 2);
    return { off: [0, -0.1, 0], spine: [-4, 0, 2 * s], neck: [-10, -6, 4 * s], handR: R([-2.6, 6.0, 2.6]), tool: tool({ pitch: r.walk + 6 }),
      handL: L([1.2 + 2.2 * s, 11.6, 5.8]), mouth: 'o', lid: 0.35, gaze: [0.2, -0.5] };
  } });
  registerPose('ck_cheer_' + k, { n: 8, dur: 0.7, loop: true, fn: (u, i) => {
    const j = S(u * Math.PI), f = S(u * TAU * 2);
    return { off: [0, 5 * j, 0], spine: [-6 * j, 0, 3 * f], neck: [-10, 8 * f, 6 * f], hipL: [-36 * j, 0, 10], knL: [70 * j, 0, 0], hipR: [-14 * j, 0, -12 * j], knR: [50 * j, 0, 0],
      handR: R([-3.6, 10.2 + 1.2 * j, 2.4]), tool: tool({ pitch: 92 + 10 * f, yaw: -20 }), shL: [0, -28, 140 + 20 * f], elL: [0, 0, 20 + 30 * f], handL: null,
      mouth: 'open', wobble: 1, eyeMode: i % 4 < 2 ? 'happy' : null, gaze: [0.2, -0.4] };
  } });
}

// hammer: wind-up follows the high-striker puck (frame = power)
registerPose('ck_wind', { n: 8, dur: 1, loop: false, fn: (u) => {
  const k = smooth(u);
  return { off: [0, -0.9 * k, -0.4 * k], spine: [-14 * k, -10 * k, 0], hips: [0, -8 * k, 0], neck: [6 * k, 6, 0],
    hipL: [-10 - 10 * k, 0, 8], knL: [10 + 26 * k, 0, 0], hipR: [8, 0, -8], knR: [8 + 22 * k, 0, 0],
    handR: R(mixA([-2.2, 5.6, 5.0], [-2.0, 10.6, 1.2], k)), tool: { kind: 'hammer', pitch: 64 + 50 * k, yaw: -18 + 12 * k }, handL: 'tool',
    mouth: k > 0.55 ? 'grit' : 'rest', squint: 0.5 * k, gaze: [0.7, 0.2], wobble: k > 0.8 ? 1 : 0 };
} });
const SMASH = [
  { h: [-2.0, 10.6, 1.2], p: 114, sp: -14, off: [0, -0.9, -0.4], kn: 34, m: 'grit' },
  { h: [-1.8, 10.4, 3.8], p: 84, sp: -2, off: [0, -0.2, 0], kn: 16, m: 'grit' },
  { h: [-1.3, 9.0, 6.0], p: 42, sp: 12, off: [0, -0.6, 0.6], kn: 20, m: 'open' },
  { h: [-1.0, 7.6, 6.6], p: 10, sp: 22, off: [0, -1.6, 1.0], kn: 34, m: 'open' },
  { h: [-1.2, 8.0, 6.4], p: 22, sp: 15, off: [0, -1.0, 0.6], kn: 24, m: 'grit' },
  { h: [-1.6, 8.4, 5.8], p: 36, sp: 8, off: [0, -0.5, 0.3], kn: 14, m: 'rest' },
];
registerPose('ck_smash', { n: 6, dur: 0.3, loop: false, fn: (u, i) => {
  const K = SMASH[i];
  return { off: K.off, spine: [K.sp, 0, 0], neck: [-K.sp * 0.4, 6, 0], hipL: [-18, 0, 8], knL: [K.kn, 0, 0], hipR: [14, 0, -8], knR: [K.kn * 0.8, 0, 0],
    handR: R(K.h), tool: { kind: 'hammer', pitch: K.p, yaw: -6 }, handL: 'tool', mouth: K.m, squint: i === 3 ? 0.8 : 0.4, gaze: [0.8, 0.4] };
} });
registerPose('ck_buzz', { n: 4, dur: 0.16, loop: true, fn: (u, i) => {
  const j = i % 2 ? 1 : -1;
  return { off: [0.15 * j, -1.2, 0.8], spine: [20, 2 * j, 2 * j], neck: [-6, 4 * j, 5 * j], hipL: [-18, 0, 8], knL: [30, 0, 0], hipR: [14, 0, -8], knR: [26, 0, 0],
    handR: R([-1.0 + 0.3 * j, 7.6, 6.5]), tool: { kind: 'hammer', pitch: 12 + 8 * j, yaw: -6 + 3 * j }, handL: 'tool', mouth: 'o', squint: 0.9, wobble: 1, gaze: [0.3 * j, 0] };
} });

// crowbar: frame = force (hands push the long end down, the body leans in, legs brace)
registerPose('ck_pry', { n: 8, dur: 1, loop: false, fn: (u, i) => {
  const k = u;
  const j = i % 2 ? 1 : -1;
  return { off: [0.1 * j * k, -0.4 - 1.1 * k, 0.6 * k], spine: [10 + 20 * k, 0, 2 * j * k], neck: [-8 - 6 * k, 6, 3 * j * k], hipL: [-24 - 10 * k, 0, 8], knL: [20 + 16 * k, 0, 0], hipR: [26 + 10 * k, 0, -10], knR: [6, 0, 0],
    handR: R(mixA([-1.2, 8.6, 5.6], [-1.0, 4.8, 6.4], k)), tool: { kind: 'crowbar', pitch: 15 + 16 * k, yaw: -4, roll: 180 }, handL: 'tool',
    mouth: k > 0.3 ? 'grit' : 'rest', squint: 0.25 + 0.6 * k, wobble: k > 0.6 ? 1 : 0, gaze: [0.8, 0.5] };
} });

// golden: the mallet taps the chisel held in the seam
const CHIS = [
  { h: [-2.6, 9.4, 3.0], p: 122 }, { h: [-2.4, 9.8, 3.6], p: 108 }, { h: [-1.6, 8.4, 5.2], p: 60 },
  { h: [-0.6, 6.6, 6.0], p: 8 }, { h: [-1.0, 7.2, 5.8], p: 26 }, { h: [-1.8, 8.4, 4.8], p: 64 },
];
registerPose('ck_chisel', { n: 6, dur: 0.24, loop: false, fn: (u, i) => {
  const K = CHIS[i];
  return { off: [0, -0.6, 0.3], spine: [12 + (i === 3 ? 6 : 0), 0, 0], neck: [-6, 4, 0], hipL: [-14, 0, 8], knL: [18, 0, 0], hipR: [10, 0, -8], knR: [14, 0, 0],
    handR: R(K.h), tool: { kind: 'mallet', pitch: K.p, yaw: -4 }, handL: L([2.4, 5.6, 6.2]), tool2: { kind: 'chisel', pitch: 14, yaw: -12 },
    mouth: i === 3 ? 'grin' : 'rest', squint: i === 3 ? 0.6 : 0.2, gaze: [0.9, 0.4] };
} });
registerPose('ck_ouch', { n: 6, dur: 0.48, loop: true, fn: (u) => {
  const j = Math.abs(S(u * TAU)), s = S(u * TAU);
  return { off: [0, 2.2 * j, 0], spine: [-4, 6 * s, 0], neck: [-8, 10 * s, 8 * s], hipL: [-30, 0, 6], knL: [60, 0, 0], hipR: [-6 * j, 0, -4], knR: [16 * j, 0, 0],
    handR: R([-3.4, 4.0, 3.0]), tool: { kind: 'mallet', pitch: -30, yaw: 10 }, handL: L([0.4 + 0.6 * s, 8.6, 6.4]), tool2: null,
    mouth: 'o', squint: 0.9, wobble: 1, gaze: [0, 0] };
} });

// orb: a dainty tap with the crystal tapper
const TAPS = [
  { h: [-2.8, 9.0, 3.4], p: 112 }, { h: [-2.6, 9.6, 3.8], p: 96 }, { h: [-1.8, 8.4, 5.4], p: 52 },
  { h: [-1.2, 7.4, 6.4], p: 14 }, { h: [-1.6, 7.8, 6.0], p: 30 }, { h: [-2.2, 8.6, 5.0], p: 62 },
];
registerPose('ck_tap', { n: 6, dur: 0.26, loop: false, fn: (u, i) => {
  const K = TAPS[i];
  return { off: [0, -0.3, 0.2], spine: [6 + (i === 3 ? 6 : 0), 0, 0], neck: [-6, 4, 0], hipL: [-10, 0, 8], knL: [12, 0, 0], hipR: [8, 0, -8], knR: [10, 0, 0],
    handR: R(K.h), tool: { kind: 'tapper', pitch: K.p, yaw: -4 }, shL: [-10, -20, 40], elL: [-30, 0, 0], handL: null,
    mouth: i === 3 ? 'o' : 'rest', squint: 0.2, gaze: [0.9, -0.1] };
} });

// a bonk sends you onto your bum (any tool; the tool is dropped)
registerPose('ck_slip', { n: 6, dur: 0.5, loop: false, fn: (u, i) => {
  const k = smooth(u);
  return { off: [0, -6.2 * k + (i === 2 ? 1.6 : 0), -2.4 * k], offAbs: false, spine: [-18 * k, 0, 0], neck: [10 * k, -10, 8 * k], hipL: [-80 * k, 0, 10], knL: [70 * k, 0, 0], hipR: [-74 * k, 0, -10], knR: [60 * k, 0, 0],
    shL: [0, -30, 90 * k], elL: [-20, 0, 0], shR: [0, 30, -90 * k], elR: [-20, 0, 0], mouth: 'o', eyeMode: null, squint: 0, gaze: [0, -0.6], wobble: 1 };
} });

export function frameT(n, k, dur) { const fi = Math.max(0, Math.min(n - 1, Math.round(k * (n - 1)))); return ((fi + 0.5) / n) * dur; }
export const POSE_N = { ck_wind: [8, 1], ck_smash: [6, 0.3], ck_pry: [8, 1], ck_chisel: [6, 0.24], ck_tap: [6, 0.26], ck_slip: [6, 0.5] };
export const IMPACT = { ck_smash: 3, ck_chisel: 3, ck_tap: 3 };
export function poseT(pose, k) { const [n, d] = POSE_N[pose] || [8, 1]; return frameT(n, k, d); }
export function poseFrameT(pose, fi) { const [n, d] = POSE_N[pose] || [8, 1]; return ((fi + 0.5) / n) * d; }
export const CHEST_POSES = (k) => ['ck_walk_' + k, 'ck_ready_' + k, 'ck_wipe_' + k, 'ck_cheer_' + k, ...(k === 'hammer' ? ['ck_wind', 'ck_smash', 'ck_buzz'] : k === 'crowbar' ? ['ck_pry', 'ck_slip'] : k === 'mallet' ? ['ck_chisel', 'ck_ouch'] : ['ck_tap'])];
