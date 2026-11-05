// Frutiger Aero NPCs (phase 3). OWNER: Character agent. All voxel, all with cute glossy CARTOON eyes.
//   NPCS: {id: {id, name, role, desc, color, h (approx px height at scale 1)}}
//   drawNPC(ctx, id, {x, y /* feet / float point */, t, scale, facing (1 right, -1 left), talk (0..1 mouth),
//                     mood ('happy'|'sad'|'surprised'|'angry'|'love'|'excited'), pose ('idle'|'talk'|'wave'|'think'|'cheer'), id})
//     -> {head:[x,y], mouth:[x,y], top:[x,y]}  (screen anchors for speech bubbles)
//   warmNPC(id, {scale, facing}) pre-builds frames.
// Fizz and Marina are bubble people built with drawCharacter (NPC-only outfit values). Goldie (goldfish), Pinch
// (crab), Dot (orb robot) and Captain Bloat (pufferfish) are voxel models with a few animation frames each
// (fins, claws, legs, tail), rendered by voxel.js and cached per (id, frame, variant, facing, scale). Idle motion
// (bob, sway), blinking, gaze, the talking mouth and moods are drawn live through the shared face layer.

import { VoxelModel, renderVoxels } from './voxel.js';
import { drawCharacter, faceFeatures, drawFaceLayer, cameraBasis, shadeBubble, TINTS } from './character.js';
import { drawSeal, warmSeal, SEAL_INFO } from './seal.js'; // [phase6:guide]
import { clamp, TAU, hash3 } from '../core/math.js';

export const NPCS = {
  fizz: { id: 'fizz', name: 'Professor Fizz', role: 'Lab scientist', desc: 'A bubbly bubble-person scientist. Runs The Lab.', color: '#7affc8', h: 72 },
  goldie: { id: 'goldie', name: 'Goldie', role: 'Guide', desc: 'A chatty goldfish who lives in your starter jar.', color: '#ff9a2a', h: 40 },
  pinch: { id: 'pinch', name: 'Pinch', role: 'Helper', desc: 'A helpful little crab. Snip snip!', color: '#ff6a4a', h: 44 },
  dot: { id: 'dot', name: 'Dot', role: 'Bait Shop keeper', desc: 'A glossy orb robot who runs the Bait Shop.' /* [phase4:shell] */, color: '#59e0ff', h: 56 },
  marina: { id: 'marina', name: 'Marina', role: 'Pier keeper', desc: 'Keeps the pier tidy and the boats happy.', color: '#ffd23a', h: 74 },
  bloat: { id: 'bloat', name: 'Captain Bloat', role: 'Storyteller', desc: 'A retired pufferfish captain with a tale for every tide.', color: '#ffcf5a', h: 60 },
  seal: { ...SEAL_INFO }, // [phase6:guide] Bubbles, the seal guide (replaces Clip)
};

const LOOKS = {
  fizz: { tint: 'mint', eyes: 'sparkle', mouth: 'grin', hat: 'none', hair: 'fluff', face: 'goggles', top: 'labcoat', bottom: 'navy', gloves: 'rubber', shoes: 'sneakers', back: 'none', trail: 'none', rod: 'none' },
  marina: { tint: 'sky', eyes: 'anime', mouth: 'smile', hat: 'sailor', hair: 'pony', face: 'lashes', top: 'coat', bottom: 'navy', gloves: 'none', shoes: 'boots', back: 'none', trail: 'none', rod: 'none' },
};
const BUBBLE_POSE = { idle: 'stand', talk: 'chat', wave: 'wave', think: 'think', cheer: 'cheer', sad: 'sad', point: 'chat', laugh: 'laugh' };

// ------------------------------------------------------------------ small voxel kit

function kit() {
  const m = new VoxelModel(1, 1, 1);
  const memo = new Map();
  const isBub = new Uint8Array(256), isGlass = new Uint8Array(256);
  const k = {
    m, isBub, isGlass,
    c(hex, o = {}) { const key = hex + JSON.stringify(o); let i = memo.get(key); if (i === undefined) { i = m.color(hex, { jitter: 0.04, smooth: 0.6, ...o }); memo.set(key, i); } return i; },
    g(hex, o = {}) { return k.c(hex, { smooth: 0.9, jitter: 0.02, spec: 1.2, specPow: 12, ...o }); },
    glass(hex, ga = 175) { const i = k.c(hex, { smooth: 1, jitter: 0, spec: 1.3, specPow: 12, light: 0.2, glass: 1 }); isGlass[i] = ga; return i; },
    model(nx, ny, nz) { const mm = new VoxelModel(nx, ny, nz); mm.palette = m.palette; return mm; },
  };
  return k;
}
function shapeIn(m, x0, y0, z0, x1, y1, z1, test, c) {
  for (let y = Math.floor(y0); y <= Math.ceil(y1); y++) for (let z = Math.floor(z0); z <= Math.ceil(z1); z++) for (let x = Math.floor(x0); x <= Math.ceil(x1); x++) if (test(x + 0.5, y + 0.5, z + 0.5)) m.put(x, y, z, c);
}
const n3 = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const I3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const rotY = (deg) => { const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a); return [c, 0, s, 0, 1, 0, -s, 0, c]; };

// ------------------------------------------------------------------ Goldie: a round voxel goldfish (model faces +x)

const GOLDIE_K = kit();
function buildGoldie(fi) {
  const K = GOLDIE_K;
  const m = K.model(48, 36, 26);
  const or = K.g('#ff8a1a'), orL = K.g('#ffb03a'), belly = K.g('#fff0b0'), fin = K.g('#ffb860', { light: 0.1 }), finL = K.g('#ffd8a0', { light: 0.15 }), finW = K.g('#fff8ec', { light: 0.2 }), cheek = K.g('#ff9ab0'), lip = K.g('#ff6a5a');
  const cx = 26, cy = 17, cz = 13;
  const sw = Math.sin((fi / 6) * TAU);
  // chubby round body, bigger head end
  shapeIn(m, 10, 6, 3, 40, 28, 23, (x, y, z) => {
    const dx = x - cx, rx = dx > 0 ? 9.6 : 10.2;
    return (dx / rx) ** 2 + ((y - cy) / 8.2) ** 2 + ((z - cz) / 6.8) ** 2 <= 1;
  }, (x, y) => (y < cy - 3.4 + (x - cx) * 0.12 ? belly : (Math.floor(x * 0.5) + Math.floor(y * 0.5)) % 3 === 0 && x < cx + 5 ? orL : or));
  // fancy double fan tail: two rounded lobes sweeping back (sways)
  for (const s2 of [-1, 1]) {
    const ang = Math.PI + s2 * 0.62, dx = Math.cos(ang), dy = Math.sin(ang);
    for (let k = 0; k <= 12; k += 0.5) {
      const w = 1 + k * 0.35 + Math.sin((k / 12) * Math.PI) * 1.8;
      for (let j = -w; j <= w; j += 0.5) {
        const x = cx - 9 + dx * k - dy * j * 0.6, y = cy + dy * k + dx * j * 0.6 * -1;
        const z = cz + sw * k * 0.32 + Math.sin(j * 0.6) * 0.4;
        const edge = k > 11 - Math.abs(j) * 0.25 || Math.abs(j) > w - 0.7;
        m.set(x, y, z, edge ? finW : Math.round(j) % 2 ? fin : finL);
      }
    }
  }
  // rounded dorsal fin, flapping pectorals, little lips
  for (let k = 0; k <= 9; k += 0.5) { const h = 2 + Math.sin((k / 9) * Math.PI) * 2.6; for (let y = 0; y <= h; y += 0.5) m.set(cx + 4 - k, cy + 7.4 + y - k * 0.12, cz, y > h - 0.8 ? finW : fin); }
  const fl = Math.sin((fi / 6) * TAU * 2);
  for (const s2 of [-1, 1]) for (let k = 0; k < 4; k += 0.5) for (let j = 0; j < 3 - k * 0.4; j += 0.5) m.set(cx + 1 - k, cy - 3 - j - fl * 0.3 * k, cz + s2 * (6.8 + k * 0.5 + fl * 0.3), j > 2 - k * 0.4 ? finW : finL);
  for (const s2 of [-1, 1]) m.set(cx + 6.4, cy - 2.4, cz + s2 * 5.2, cheek);
  m.sphere(cx + 9.8, cy - 1.4, cz, 1.5, lip);
  const head = { C: [cx + 4.4, cy + 1, cz], R: 7.4, Rm: I3, feats: { eyeL: { d: n3([0.55, 0.4, 0.72]), size: 2.9 }, eyeR: { d: n3([0.55, 0.4, -0.72]), size: 2.9 }, mouth: { d: n3([1, -0.3, 0]), size: 1.6, lift: 1.06 } } };
  return { m, head, faceIds: new Set([or, orL, belly, cheek]), anchors: { top: [cx, cy + 14, cz], head: [cx + 4, cy + 7, cz], mouth: [cx + 10, cy - 1, cz] }, ground: [cx, cy - 2, cz], n: 6 };
}

// ------------------------------------------------------------------ Pinch: crab with eyes on stalks (faces +z)

const PINCH_K = kit();
function buildPinch(fi, variant) {
  const K = PINCH_K;
  const m = K.model(52, 34, 30);
  const shell = K.g('#ff5a3a'), shellL = K.g('#ff8a5a'), belly = K.g('#ffe2c0'), spot = K.g('#fff2e0'), leg = K.g('#e8482a'), claw = K.g('#ff6a3a'), clawL = K.g('#ffb08a'), stalk = K.g('#ff7a52'), eyeW = K.g('#ffffff', { light: 0.3 });
  const cx = 26, cy = 9, cz = 14;
  const step = fi % 2;
  // legs (three per side, alternating step)
  for (const s of [-1, 1]) for (let i = 0; i < 3; i++) {
    const lift = (i + step) % 2 ? 1.2 : 0;
    const z0 = cz - 3 + i * 3.2, x0 = cx + s * 9;
    const kx = cx + s * 14, ky = cy - 1 + lift + 2;
    m.line(x0, cy - 2, z0, kx, ky, z0, leg, 0.85);
    m.line(kx, ky, z0, kx + s * 2.4, 0.5 + lift * 0.5, z0, leg, 0.75);
  }
  // shell: wide rounded dome
  shapeIn(m, cx - 13, 0, cz - 9, cx + 13, cy + 9, cz + 9, (x, y, z) => ((x - cx) / 11.5) ** 2 + ((y - cy) / 7.2) ** 2 + ((z - cz) / 8) ** 2 <= 1, (x, y, z) => (y < cy - 3.5 ? belly : y > cy + 4 && z > cz - 2 ? shellL : shell));
  m.recolor((x, y, z, p) => (p === shell || p === shellL) && hash3(x >> 1, y >> 1, z >> 1, 3) < 0.07 ? spot : null);
  // claws: arm + big round pincer (variant 1 = raised / waving, frames snap)
  const snap = fi % 4 < 2 ? 0 : 1;
  const raise = variant === 1;
  for (const s of [-1, 1]) {
    const up = raise && s < 0 ? 7 + (fi % 2) * 1.5 : 0;
    const ax = cx + s * 10, ay = cy - 1, az = cz + 5;
    const hx = cx + s * 15, hy = cy + 3 + up, hz = cz + 9;
    m.line(ax, ay, az, hx, hy - 2, hz - 1, claw, 1.3);
    m.ellipsoid(hx, hy, hz, 3.6, 3.2, 3.2, claw);
    const open = snap ? 1.6 : 0.4;
    m.sub(() => shapeIn(m, hx - 1, hy - open * 0.6, hz + 1, hx + s * 6, hy + open * 0.6, hz + 6, (x, y, z) => (x - hx) * s > -0.5, 1));
    m.ellipsoid(hx + s * 1.2, hy + 1.6, hz + 2.2, 1.6, 1.2, 1.4, clawL);
  }
  // eye stalks + eyeballs
  const bob = Math.sin((fi / 4) * TAU) * 0.4;
  const eyes = {};
  for (const [s, k] of [[1, 'eyeL'], [-1, 'eyeR']]) {
    const ex = cx + s * 3.6, ey = cy + 15 + bob * s, ez = cz + 4;
    m.line(cx + s * 2.6, cy + 6, cz + 3, ex, ey - 2.2, ez, stalk, 0.9);
    m.sphere(ex, ey, ez, 2.9, eyeW);
    eyes[k] = { C: [ex, ey, ez], R: 2.9 };
  }
  const head = { C: [cx, cy + 1, cz], R: 8, Rm: I3, feats: { mouth: { d: n3([0, -0.25, 1]), size: 1.8 }, cheekL: { d: n3([0.55, -0.2, 0.8]), size: 1.6 }, cheekR: { d: n3([-0.55, -0.2, 0.8]), size: 1.6 } }, eyes };
  return { m, head, faceIds: new Set([shell, shellL, belly, spot, eyeW]), anchors: { top: [cx, cy + 19, cz], head: [cx, cy + 15, cz], mouth: [cx, cy, cz + 8] }, ground: [cx, 0, cz], n: 4 };
}

// ------------------------------------------------------------------ Dot: glossy orb robot (faces +z)

const DOT_K = kit();
function buildDot(fi) {
  const K = DOT_K;
  const m = K.model(34, 40, 34);
  const white = K.g('#f6fbff', { spec: 1.5, specPow: 10, light: 0.12 }), whiteD = K.g('#d6e8f4', { spec: 1.2 }), screen = K.g('#0c2246', { spec: 1.6, specPow: 16 }), rim = K.g('#2fd3e8', { spec: 1.4 });
  const fin = K.g('#59e0ff', { spec: 1.3 }), lime = K.c('#a8ff5a', { emissive: 0.6, jitter: 0 }), ring = K.c('#7affff', { emissive: 0.9, jitter: 0 }), grey = K.g('#a8bccc');
  const cx = 17, cy = 18, cz = 17, R = 9.5;
  m.sphere(cx, cy, cz, R, (x, y) => (y < cy - 6.5 ? whiteD : white));
  // face screen: a dark glass oval inset on the front
  shapeIn(m, cx - 9, cy - 7, cz, cx + 9, cy + 7, cz + R + 1, (x, y, z) => ((x - cx) / 6.8) ** 2 + ((y - cy - 0.6) / 5) ** 2 <= 1 && z > cz + 5, (x, y, z) => (((x - cx) / 6.8) ** 2 + ((y - cy - 0.6) / 5) ** 2 > 0.8 ? rim : screen));
  // antenna
  const sw = Math.sin((fi / 6) * TAU) * 1.2;
  m.line(cx, cy + R - 0.5, cz, cx + sw, cy + R + 4.5, cz, grey, 0.45);
  m.sphere(cx + sw, cy + R + 5.6, cz, 1.6, lime);
  // side fins (flap)
  const fl = Math.sin((fi / 6) * TAU * 2) * 1.4;
  for (const s of [-1, 1]) for (let k = 0; k < 5; k++) for (let j = -1.5; j <= 1.5; j += 0.5) m.set(cx + s * (R + 0.4 + k), cy + 1 + j + k * 0.4 + fl * (k / 5), cz - 1 + j * 0.3, k > 3 ? rim : fin);
  // hover ring + jets
  for (let a = 0; a < TAU; a += 0.06) m.set(cx + Math.cos(a) * 5.6, 3, cz + Math.sin(a) * 5.6, ring);
  m.cylinder(cx, cz, 5, 8.4, 2.4, grey);
  const head = { C: [cx, cy, cz], R, Rm: I3, feats: { eyeL: { d: n3([0.32, 0.12, 0.94]), size: 2.4 }, eyeR: { d: n3([-0.32, 0.12, 0.94]), size: 2.4 }, mouth: { d: n3([0, -0.24, 0.97]), size: 2.0 } } };
  return { m, head, faceIds: new Set([screen]), anchors: { top: [cx, cy + R + 7, cz], head: [cx, cy + R, cz], mouth: [cx, cy - 2, cz + R] }, ground: [cx, 0, cz], n: 6, eyes: 'led', mouth: 'led' };
}

// ------------------------------------------------------------------ Captain Bloat: retired pufferfish (faces +z), variant 1 = puffed

const BLOAT_K = kit();
function buildBloat(fi, variant) {
  const K = BLOAT_K;
  const m = K.model(44, 50, 44);
  const body = K.g('#ffd26a'), bodyD = K.g('#e8aa3a'), belly = K.g('#fff6d8'), spot = K.g('#a8702a'), spike = K.g('#fff0c0'), fin = K.g('#ffb84a', { light: 0.1 }), whisk = K.c('#ffffff', { smooth: 0.9, jitter: 0.1, light: 0.2 });
  const capW = K.g('#ffffff'), capN = K.g('#1a2a5a'), visor = K.g('#141a2a', { spec: 1.6 }), gold = K.g('#ffd23a', { spec: 1.6 });
  const puff = variant === 1;
  const cx = 22, cy = 18, cz = 20, R = puff ? 12.6 : 10.2;
  m.sphere(cx, cy, cz, R, (x, y, z) => (y < cy - R * 0.35 + (z - cz) * 0.1 ? belly : y > cy + R * 0.4 ? bodyD : body));
  m.recolor((x, y, z, p) => (p === body || p === bodyD) && hash3(x >> 1, y >> 1, z >> 1, 9) < 0.08 ? spot : null);
  // spikes
  const N = puff ? 70 : 44;
  for (let i = 0; i < N; i++) {
    const a = i * 2.39996, yy = 1 - (i + 0.5) * (2 / N), r = Math.sqrt(1 - yy * yy);
    const d = [Math.cos(a) * r, yy, Math.sin(a) * r];
    if (d[2] > 0.55 && d[1] > -0.4 && d[1] < 0.55 && Math.abs(d[0]) < 0.6) continue; // keep the face clear
    if (d[1] > 0.7) continue; // under the cap
    const L = puff ? 3.4 : 1.8;
    m.line(cx + d[0] * R, cy + d[1] * R, cz + d[2] * R, cx + d[0] * (R + L), cy + d[1] * (R + L), cz + d[2] * (R + L), spike, 0.4);
  }
  // fins + tail (flap)
  const fl = Math.sin((fi / 6) * TAU) * 1.5;
  for (const s of [-1, 1]) for (let k = 0; k < 4; k++) for (let j = -2; j <= 2; j += 0.5) m.set(cx + s * (R + k * 0.8), cy - 1 + j + fl * (k / 4) * s, cz + 1 - k * 0.6, fin);
  for (let k = 0; k < 5; k++) for (let j = -k - 1; j <= k + 1; j += 0.5) m.set(cx + j + fl * 0.4, cy + 1, cz - R - k, fin);
  // bushy white brows + captain's mustache
  for (const s of [-1, 1]) {
    for (let k = 0; k < 6; k++) m.sphere(cx + s * (2 + k * 0.85), cy + R * 0.5 + 1.2 - k * 0.15 + (k > 3 ? -0.5 : 0), cz + R * 0.78 - k * 0.3, 1.05, whisk);
    for (let k = 0; k < 6; k++) m.sphere(cx + s * (0.8 + k * 0.95), cy - 2.6 - Math.sin(k * 0.6) * 1.2 + (k > 4 ? 0.8 : 0), cz + R * 0.94 - k * 0.32, 1.15, whisk);
  }
  // captain's cap
  const ct = cy + R * 0.72;
  shapeIn(m, cx - 10, ct, cz - 10, cx + 10, ct + 7, cz + 10, (x, y, z) => { const yy = y - ct; if (yy < 2.6) return Math.hypot(x - cx, z - cz + 0.6) <= 7.2; return ((x - cx) / 8.6) ** 2 + ((z - cz + 1) / 8.6) ** 2 <= 1 && yy < 5.2; }, (x, y) => (y - ct < 2.6 ? capN : capW));
  shapeIn(m, cx - 6, ct - 0.6, cz + 4, cx + 6, ct + 0.8, cz + 11, (x, y, z) => ((x - cx) / 5.4) ** 2 + ((z - cz - 5) / 5.4) ** 2 <= 1 && z > cz + 5.4, visor);
  for (const [ox, oy] of [[0, 0], [0, 1], [0, 2], [-1, 1], [1, 1]]) m.set(cx + ox, ct + oy, Math.floor(cz + 7.6), gold);
  const head = { C: [cx, cy, cz], R, Rm: I3, feats: { eyeL: { d: n3([0.36, 0.2, 0.91]), size: 2.6 }, eyeR: { d: n3([-0.36, 0.2, 0.91]), size: 2.6 }, mouth: { d: n3([0, -0.38, 0.92]), size: 1.6 }, cheekL: { d: n3([0.62, -0.1, 0.77]), size: 1.8 }, cheekR: { d: n3([-0.62, -0.1, 0.77]), size: 1.8 } } };
  return { m, head, faceIds: new Set([body, bodyD, belly, spot]), anchors: { top: [cx, ct + 8, cz], head: [cx, cy + R, cz], mouth: [cx, cy - 4, cz + R] }, ground: [cx, cy - R - 2, cz], n: 6 };
}

const VOX = {
  goldie: { build: buildGoldie, kit: GOLDIE_K, yaw: 45, n: 6, dur: 0.9, float: 3, eyes: 'bean', mouth: 'smile', side: true },
  pinch: { build: buildPinch, kit: PINCH_K, yaw: 28, n: 4, dur: 0.8, float: 0, eyes: 'bean', mouth: 'cat' },
  dot: { build: buildDot, kit: DOT_K, yaw: 26, n: 6, dur: 1.2, float: 4, eyes: 'led', mouth: 'led' },
  bloat: { build: buildBloat, kit: BLOAT_K, yaw: 28, n: 6, dur: 1.6, float: 3, eyes: 'bean', mouth: 'o' },
};

// ------------------------------------------------------------------ rendering + cache

const CACHE = new Map();
function frameFor(id, fi, variant, facing, vs) {
  const key = `${id}|${fi}|${variant}|${facing}|${vs}`;
  let fr = CACHE.get(key);
  if (fr) return fr;
  const D = VOX[id];
  const B = D.build(fi, variant);
  // fish (side view): yaw so its +x nose points along the facing direction; others face the viewer, turned a little
  const yaw = D.side ? (facing > 0 ? D.yaw : 180 - D.yaw) : facing > 0 ? D.yaw : -D.yaw;
  const pitch = 14;
  const r = renderVoxels(B.m, { scale: vs, yaw, pitch, ao: 1, edges: 0.7, sideEdges: 0.5, jitter: 0.08, glowRadius: 2 });
  const cam = cameraBasis(yaw, pitch);
  const id3 = (p) => p;
  const proj = (g) => r.project(g[0], g[1], g[2]);
  if (D.kit.isGlass.some((v) => v)) shadeBubble(r, D.kit.isBub, D.kit.isGlass, TINTS.aqua, { hc: [0, 0], hr: 1, mx: 1, cam });
  const H = B.head;
  const feats = faceFeatures(id3, proj, H.C, H.R, H.Rm, H.feats, cam);
  if (H.eyes) for (const [k, e] of Object.entries(H.eyes)) Object.assign(feats, faceFeatures(id3, proj, e.C, e.R, I3, { [k]: { d: [0, 0.05, 1], size: e.R * 0.92 } }, cam));
  const mask = new Uint8Array(r.w * r.h);
  for (let i = 0; i < mask.length; i++) if (B.faceIds.has(r.ids[i])) mask[i] = 1;
  const [fx, fy] = proj(B.ground);
  const rel = (p) => { const q = proj(p); return [q[0] - fx, q[1] - fy]; };
  const hc = proj(H.C);
  fr = { canvas: r.canvas, glow: r.glow, fx, fy, face: { feats, mask: { d: mask, w: r.w, h: r.h }, hc }, anchors: { top: rel(B.anchors.top), head: rel(B.anchors.head), mouth: rel(B.anchors.mouth) } };
  CACHE.set(key, fr);
  if (CACHE.size > 300) CACHE.delete(CACHE.keys().next().value);
  return fr;
}

const P0 = { gaze: [0, 0], lid: 0, squint: 0, mouth: 'rest', wobble: 0, eyeMode: null };

export function drawNPC(ctx, id, o = {}) {
  if (id === 'seal' || id === 'clip') return drawSealNPC(ctx, o); // [phase6:guide]
  const x = o.x ?? 0, y = o.y ?? 0, t = o.t ?? 0, scale = o.scale ?? 1, facing = (o.facing ?? 1) < 0 ? -1 : 1;
  const pose = o.pose || 'idle';
  if (LOOKS[id]) {
    let bp = BUBBLE_POSE[pose] || 'stand';
    if ((o.talk || 0) > 0.05 && bp === 'stand') bp = 'chat';
    const a = drawCharacter(ctx, x, y, { pose: bp, t, facing, scale: scale * 0.95, look: LOOKS[id], id: 'npc:' + (o.id ?? id), talk: o.talk, mood: o.mood, rod: false, lookAt: o.lookAt, shadow: o.shadow, trail: false });
    return { head: a.head, mouth: a.mouth, top: [a.head[0], a.head[1] - 2] };
  }
  const D = VOX[id];
  if (!D) {
    ctx.fillStyle = '#7fd8ff';
    ctx.fillRect(Math.round(x - 4), Math.round(y - 14), 8, 14);
    return { head: [x, y - 14], mouth: [x, y - 8], top: [x, y - 16] };
  }
  const vs = Math.max(0.5, Math.round(1.6 * scale * 4) / 4);
  const excited = o.mood === 'excited' || o.mood === 'surprised' || pose === 'cheer';
  const variant = id === 'bloat' ? (excited ? 1 : 0) : id === 'pinch' ? (pose === 'wave' || pose === 'cheer' || (o.talk || 0) > 0.05 ? 1 : 0) : 0;
  const speed = excited ? 1.6 : 1;
  const fi = Math.floor(((t * speed) / D.dur) * D.n) % D.n;
  const fr = frameFor(id, (fi + D.n) % D.n, variant, facing, vs);
  const bob = D.float ? Math.round(Math.sin(t * 2.2) * D.float * vs * 0.5) - Math.round(D.float * vs) : pose === 'cheer' ? -Math.round(Math.abs(Math.sin(t * 8)) * 4 * vs) : 0;
  const X = Math.round(x - fr.fx), Y = Math.round(y - fr.fy + bob);
  if (o.shadow !== false) {
    const w = Math.round(fr.canvas.width * 0.28), h = Math.max(1, Math.round(1.4 * vs));
    ctx.fillStyle = 'rgba(10,40,80,0.18)';
    for (let i = -h; i <= h; i++) { const hw = Math.round(w * Math.sqrt(1 - (i / (h + 0.5)) ** 2)); ctx.fillRect(Math.round(x) - hw, Math.round(y) + i, hw * 2, 1); }
  }
  ctx.drawImage(fr.canvas, X, Y);
  if (fr.glow) { const g = ctx.globalCompositeOperation, a = ctx.globalAlpha; ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = a * 0.6; ctx.drawImage(fr.glow, X, Y); ctx.globalAlpha = a; ctx.globalCompositeOperation = g; }
  const p = { ...P0, gaze: [Math.sin(t * 0.7) * 0.4 * facing, Math.sin(t * 0.43) * 0.2], eyeMode: o.mood === 'happy' && Math.sin(t * 0.9) > 0.85 ? 'happy' : null };
  drawFaceLayer(ctx, fr.face, X, Y, { id: 'npc:' + (o.id ?? id), eyes: D.eyes, mouth: D.mouth, faceAcc: 'none', p, lookAt: o.lookAt, talk: o.talk, mood: id === 'dot' && o.mood !== 'love' ? null : o.mood, t, sx: facing, opaque: true });
  const A = fr.anchors;
  return { head: [X + fr.fx + A.head[0], Y + fr.fy + A.head[1]], mouth: [X + fr.fx + A.mouth[0], Y + fr.fy + A.mouth[1]], top: [X + fr.fx + A.top[0], Y + fr.fy + A.top[1]] };
}

export function warmNPC(id, { scale = 1, facing = 1 } = {}) {
  if (id === 'seal' || id === 'clip') return warmSeal((scale || 1) * 40); // [phase6:guide]
  const D = VOX[id];
  if (!D) return true;
  const vs = Math.max(0.5, Math.round(1.6 * scale * 4) / 4);
  for (let fi = 0; fi < D.n; fi++) frameFor(id, fi, 0, facing < 0 ? -1 : 1, vs);
  return true;
}


// ====================================================================== [phase6:guide] Bubbles, the seal guide
// The guide is now Bubbles, a fat low-poly bubble seal pup (src/gfx/seal.js); 'clip' is kept as an alias.
//   drawNPC(ctx, 'seal', {x, y /* bottom (or body centre with base: 'center') */, t, scale | size, facing, talk, mood,
//                         pose|anim, lookAt, point, ride, id})  -> {head, mouth, top, hand, ...}
//   drawNPC(ctx, 'seal', {portrait: true, x, y, r, ...}) head and shoulders filling a portrait orb of radius r
function drawSealNPC(ctx, o) {
  const t = o.t ?? 0;
  if (o.portrait) {
    const r = o.r || 30;
    return drawSeal(ctx, { x: o.x - r * 0.82, y: o.y + r * 0.62, t, size: r * 1.5, view: 'front', anim: o.pose === 'wave' ? 'wave' : 'idle', mood: o.mood, talk: o.talk, lookAt: o.lookAt || [o.x + r * 3, o.y + r], id: o.id ?? 'portrait' });
  }
  const size = o.size ?? (o.scale ?? 1) * 40;
  return drawSeal(ctx, {
    x: o.x ?? 0, y: o.y ?? 0, base: o.base === 'center' ? undefined : 'bottom', t, size, k: o.k, facing: o.facing, tilt: o.tilt,
    anim: o.anim || o.pose || 'idle', phase: o.phase, point: o.point, mood: o.mood, talk: o.talk, lookAt: o.lookAt, ride: o.ride ?? (o.bubble === false ? 0 : 1),
    noseBubble: o.noseBubble, view: o.view, id: o.id ?? 'npc-seal', alpha: o.alpha,
  });
}

