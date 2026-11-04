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
import { drawCharacter, faceFeatures, drawFaceLayer, cameraBasis, shadeBubble, TINTS, rasterFeature } from './character.js'; // [phase5:intro] rasterFeature (Clip's face)
import { clamp, TAU, hash3 } from '../core/math.js';

export const NPCS = {
  fizz: { id: 'fizz', name: 'Professor Fizz', role: 'Lab scientist', desc: 'A bubbly bubble-person scientist. Runs The Lab.', color: '#7affc8', h: 72 },
  goldie: { id: 'goldie', name: 'Goldie', role: 'Guide', desc: 'A chatty goldfish who lives in your starter jar.', color: '#ff9a2a', h: 40 },
  pinch: { id: 'pinch', name: 'Pinch', role: 'Helper', desc: 'A helpful little crab. Snip snip!', color: '#ff6a4a', h: 44 },
  dot: { id: 'dot', name: 'Dot', role: 'Bait Shop keeper', desc: 'A glossy orb robot who runs the Bait Shop.' /* [phase4:shell] */, color: '#59e0ff', h: 56 },
  marina: { id: 'marina', name: 'Marina', role: 'Pier keeper', desc: 'Keeps the pier tidy and the boats happy.', color: '#ffd23a', h: 74 },
  bloat: { id: 'bloat', name: 'Captain Bloat', role: 'Storyteller', desc: 'A retired pufferfish captain with a tale for every tide.', color: '#ffcf5a', h: 60 },
  clip: { id: 'clip', name: 'Clip', role: 'Guide', desc: 'A chrome-and-aqua paperclip with a glass-bubble face. Holds things together, mostly fishing lines.', color: '#5fe0f4', h: 58 }, // [phase5:intro]
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
  if (id === 'clip') return drawClip(ctx, o); // [phase5:intro]
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
  if (id === 'clip') return warmClip({ scale, facing }); // [phase5:intro]
  const D = VOX[id];
  if (!D) return true;
  const vs = Math.max(0.5, Math.round(1.6 * scale * 4) / 4);
  for (let fi = 0; fi < D.n; fi++) frameFor(id, fi, 0, facing < 0 ? -1 : 1, vs);
  return true;
}


// ====================================================================== [phase5:intro] Clip, the guide
// An ORIGINAL design (not an office assistant): a glossy chrome-and-aqua voxel paperclip whose top loop cradles a
// glass bubble face. No eyebrows. Tall glossy eyes (navy to aqua with catchlights), a talking mouth, and wire
// gestures: the free end of the outer loop is its arm (wave, point, cheer), the upper wire bends (bow, droop,
// laugh back) and leans (think); 'spin' turns it on the spot. It bounces on a little soap bubble.
//   drawNPC(ctx, 'clip', {x, y /* bottom of the bubble */, t, scale, facing, talk 0..1, mood, pose, yaw,
//                         lookAt [sx, sy], bubble (default true), id}) -> {head, mouth, top}
//   moods: happy | excited | surprised | smug | sad | love | angry | think | neutral
//   poses: idle | talk | wave | point | bend | think | cheer | laugh | sad | spin
const CLIP_K = kit();
const CLIP_N = 6;
const CLIP_DIMS = [46, 80, 34];
const CLIP_CX = 23, CLIP_CZ = 16, CLIP_Y0 = 4;
const CLIP_WIRE = ['#ffffff', '#c4f4ff', '#62d2f0', '#2b8cc8', '#123f78'];
const CLIP_ORB = ['#ffffff', '#eafeff', '#aaf0fb', '#62d4f0', '#2fa6dc'];
const CLIP_POSE = {
  idle: (k) => ({ bend: 0, lean: Math.sin(k) * 2, arm: 6 + Math.sin(k) * 4 }),
  talk: (k) => ({ bend: Math.sin(k * 2) * 4, lean: Math.sin(k) * 3, arm: 14 + Math.sin(k * 2) * 8 }),
  wave: (k) => ({ bend: 2, lean: -5, arm: 138 + Math.sin(k * 2) * 24 }),
  point: (k) => ({ bend: 4, lean: 7 + Math.sin(k) * 1.5, arm: 94 + Math.sin(k * 2) * 3 }),
  bend: (k) => ({ bend: 24 + Math.sin(k) * 3, lean: 0, arm: 16 }),
  think: (k) => ({ bend: 6, lean: -11 + Math.sin(k) * 1.5, arm: 152, curl: 1 }),
  cheer: (k) => ({ bend: -7, lean: Math.sin(k * 2) * 4, arm: 168 + Math.sin(k * 3) * 10, stretch: 1.06 }),
  laugh: (k) => ({ bend: -12 + Math.sin(k * 3) * 5, lean: Math.sin(k * 3) * 3, arm: 34 + Math.sin(k * 3) * 10 }),
  sad: (k) => ({ bend: 17, lean: 4, arm: 2, stretch: 0.97 }),
  spin: (k) => ({ bend: 0, lean: 0, arm: 40 + Math.sin(k * 2) * 6 }),
};

// Centre line of the wire (model x relative to the centre, y up): inner leg, small top bend, middle leg, bottom bend,
// outer leg, big top bend, outer-left leg + the arm (free end).
function clipCenterline(P) {
  const pts = [];
  const leg = (x, ya, yb) => { const n = Math.max(2, Math.ceil(Math.abs(yb - ya) / 0.8)); for (let i = 0; i <= n; i++) pts.push([x, ya + ((yb - ya) * i) / n]); };
  const arc = (cx, cy, r, a0, a1) => { const n = Math.ceil((Math.abs(a1 - a0) * r) / 0.8); for (let i = 0; i <= n; i++) { const a = a0 + ((a1 - a0) * i) / n; pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); } };
  leg(4, 24, 44);
  arc(0, 44, 4, 0, Math.PI);
  leg(-4, 44, 12);
  arc(2.5, 12, 6.5, Math.PI, Math.PI * 2);
  leg(9, 12, 50);
  arc(0, 50, 9, 0, Math.PI);
  leg(-9, 50, 34);
  const body = pts.length;
  // the arm: from the joint at (-9, 34), swinging out by P.arm degrees from straight down
  const th = (P.arm * Math.PI) / 180, L = 17;
  for (let i = 1; i <= 22; i++) {
    const k = (i / 22) * L;
    let dx = -Math.sin(th), dy = -Math.cos(th);
    // a little hooked curl at the tip (think / cheer)
    if (P.curl && k > L - 6) { const c = ((k - (L - 6)) / 6) * 1.6; const ca = Math.cos(c), sa = Math.sin(c); [dx, dy] = [dx * ca + dy * sa, -dx * sa + dy * ca]; }
    const prev = pts[pts.length - 1];
    pts.push(i === 1 ? [-9 + dx * (L / 22), 34 + dy * (L / 22)] : [prev[0] + dx * (L / 22), prev[1] + dy * (L / 22)]);
  }
  return { pts, body };
}

function clipDeform(P) {
  const b = (P.bend * Math.PI) / 180, l = (P.lean * Math.PI) / 180, st = P.stretch || 1;
  const s = (y) => { const k = Math.min(1, Math.max(0, (y - 18) / 40)); return k * k * (3 - 2 * k); };
  // (x, y, z) model-relative (x around 0, y absolute above base, z around 0) -> deformed
  return (x, y, z) => {
    y *= st;
    const k = s(y);
    // lean: rotate (x, y - 18) by l * k
    const al = l * k, ca = Math.cos(al), sa = Math.sin(al);
    let yy = y - 18;
    let xx = x * ca - yy * sa; yy = x * sa + yy * ca;
    // bend: rotate (yy, z) about the x axis by b * k (positive tips the top toward the viewer)
    const ab = b * k, cb = Math.cos(ab), sb = Math.sin(ab);
    const zz = z * cb + yy * sb;
    yy = yy * cb - z * sb;
    return [xx, yy + 18, zz];
  };
}

function buildClip(pose, fi, mirror) {
  const K = CLIP_K;
  const [NX, NY, NZ] = CLIP_DIMS;
  const m = K.model(NX, NY, NZ);
  const wire = CLIP_WIRE.map((c, i) => K.g(c, { spec: 1.5, specPow: i < 2 ? 22 : 14, light: i === 0 ? 0.35 : 0.08 }));
  const orb = CLIP_ORB.map((c, i) => K.g(c, { spec: 1.4, specPow: 16, light: i === 0 ? 0.5 : 0.18, jitter: 0.01 }));
  const P = (CLIP_POSE[pose] || CLIP_POSE.idle)((fi / CLIP_N) * TAU);
  const D = clipDeform(P);
  const sx = mirror ? -1 : 1;
  const { pts } = clipCenterline(P);
  const W = pts.map(([x, y]) => { const q = D(x * sx, y, 0); return [CLIP_CX + q[0], CLIP_Y0 + q[1], CLIP_CZ + q[2]]; });
  const R = 1.85;
  for (let i = 0; i < W.length - 1; i++) {
    const A = W[i], B = W[i + 1];
    const ab = [B[0] - A[0], B[1] - A[1], B[2] - A[2]];
    const l2 = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2] || 1;
    for (let z = Math.floor(Math.min(A[2], B[2]) - R); z <= Math.ceil(Math.max(A[2], B[2]) + R); z++)
      for (let y = Math.floor(Math.min(A[1], B[1]) - R); y <= Math.ceil(Math.max(A[1], B[1]) + R); y++)
        for (let x = Math.floor(Math.min(A[0], B[0]) - R); x <= Math.ceil(Math.max(A[0], B[0]) + R); x++) {
          const px = x + 0.5 - A[0], py = y + 0.5 - A[1], pz = z + 0.5 - A[2];
          const tt = Math.max(0, Math.min(1, (px * ab[0] + py * ab[1] + pz * ab[2]) / l2));
          const dx = px - ab[0] * tt, dy = py - ab[1] * tt, dz = pz - ab[2] * tt;
          const d = Math.hypot(dx, dy, dz);
          if (d > R) continue;
          // chrome bands: bright sky on the upper-left, a dark horizon line, aqua below
          const lt = d > 0.01 ? (-dx * 0.72 + dy * 0.5 + dz * 0.42) / d : 0.6;
          m.set(x, y, z, wire[lt > 0.62 ? 0 : lt > 0.28 ? 1 : lt > -0.02 ? 3 : lt > -0.4 ? 2 : 4]);
        }
  }
  // the glass bubble face, cradled in the top loop
  const oc = D(0, 49.5, 3.6);
  const C = [CLIP_CX + oc[0], CLIP_Y0 + oc[1], CLIP_CZ + oc[2]];
  const OR = 8.3;
  const bb = (P.bend * Math.PI) / 180, ll = (P.lean * Math.PI) / 180;
  for (let z = Math.floor(C[2] - OR - 1); z <= Math.ceil(C[2] + OR + 1); z++)
    for (let y = Math.floor(C[1] - OR - 1); y <= Math.ceil(C[1] + OR + 1); y++)
      for (let x = Math.floor(C[0] - OR - 1); x <= Math.ceil(C[0] + OR + 1); x++) {
        const dx = x + 0.5 - C[0], dy = y + 0.5 - C[1], dz = z + 0.5 - C[2];
        const d = Math.hypot(dx, dy, dz);
        if (d > OR) continue;
        const nx = dx / d, ny = dy / d, nz = dz / d;
        const hl = -0.42 * nx + 0.62 * ny + 0.66 * nz;
        let c = hl > 0.86 ? 0 : nz < 0.28 && ny > -0.6 ? 1 : ny > 0.3 ? 2 : ny > -0.35 ? 3 : 4;
        if (hl > 0.74 && hl <= 0.86 && hash3(x, y, z, 7) < 0.5) c = 1;
        m.set(x, y, z, orb[c]);
      }
  // head frame for the face features (follows the bend / lean of the top)
  const cb = Math.cos(bb), sb = Math.sin(bb), cl = Math.cos(ll), sl = Math.sin(ll);
  const Rm = [cl, -sl * cb, sl * sb, sl, cl * cb, -cl * sb, 0, sb, cb];
  const feats = { eyeL: { d: n3([0.34, 0.16, 0.93]), size: 3.0 }, eyeR: { d: n3([-0.34, 0.16, 0.93]), size: 3.0 }, mouth: { d: n3([0, -0.44, 0.9]), size: 2.5 } };
  const top = D(0, 60, 0), arm = W[W.length - 1];
  return { m, head: { C, R: OR, Rm, feats }, faceIds: new Set(orb), anchors: { top: [CLIP_CX + top[0], CLIP_Y0 + top[1] + 3, CLIP_CZ + top[2]], head: [C[0], C[1] + OR, C[2]], mouth: [C[0], C[1] - OR * 0.4, C[2] + OR], hand: arm }, ground: [CLIP_CX + D(2.5, 5.5, 0)[0] * sx, CLIP_Y0 + 3.6, CLIP_CZ] };
}

const CLIP_CACHE = new Map();
function clipFrame(pose, fi, facing, yaw, vs) {
  const key = `${pose}|${fi}|${facing}|${yaw}|${vs}`;
  let fr = CLIP_CACHE.get(key);
  if (fr) return fr;
  const B = buildClip(pose, fi, facing > 0);
  const pitch = 10;
  const r = renderVoxels(B.m, { scale: vs, yaw, pitch, ao: 0.9, edges: 0.55, sideEdges: 0.4, jitter: 0.05, glowRadius: 0 });
  const cam = cameraBasis(yaw, pitch);
  const proj = (g) => r.project(g[0], g[1], g[2]);
  const feats = faceFeatures((p) => p, proj, B.head.C, B.head.R, B.head.Rm, B.head.feats, cam);
  const mask = new Uint8Array(r.w * r.h);
  for (let i = 0; i < mask.length; i++) if (B.faceIds.has(r.ids[i])) mask[i] = 1;
  const [fx, fy] = proj(B.ground);
  const rel = (p) => { const q = proj(p); return [q[0] - fx, q[1] - fy]; };
  fr = { canvas: r.canvas, fx, fy, feats, mask: { d: mask, w: r.w, h: r.h }, hc: proj(B.head.C), anchors: { top: rel(B.anchors.top), head: rel(B.anchors.head), mouth: rel(B.anchors.mouth), hand: rel(B.anchors.hand) } };
  CLIP_CACHE.set(key, fr);
  if (CLIP_CACHE.size > 260) CLIP_CACHE.delete(CLIP_CACHE.keys().next().value);
  return fr;
}

const CINK = '#0a1a40';
const inE2 = (u, v, rx, ry) => (u / rx) ** 2 + (v / ry) ** 2 <= 1;
function heart2(u, v, s) { const x = (u / s) * 1.12, y = (-v / s) * 1.12 + 0.2; const a = x * x + y * y - 1; return a * a * a - x * x * y * y * y <= 0; }

// Clip's eye: a tall glossy capsule (navy -> aqua glow), two catchlights; lids for blink / moods.
function clipEye(E, u, v) {
  const th = Math.max(0.15, 1.05 / E.px);
  const md = E.mood;
  if (E.blink >= 0.85 || md === 'laugh') { const c = md === 'laugh' ? 0.15 - 0.55 * (1 - u * u) : 0.12 + 0.3 * u * u; return Math.abs(u) < 0.66 && Math.abs(v - c) < th * 1.1 ? CINK : null; }
  if (md === 'happy' && E.squint) { const c = 0.2 - 0.62 * (1 - u * u); return Math.abs(u) < 0.66 && Math.abs(v - c) < th * 1.15 ? CINK : null; }
  const wide = md === 'surprised';
  const ew = wide ? 0.74 : 0.62, eh = wide ? 1.08 : 1;
  const uu = u - E.gu * 0.2, vv = v - E.gv * 0.16;
  if (!inE2(uu, vv, ew, eh)) return null;
  // lids
  let lidY = -eh + 2 * eh * Math.max(E.lid, 0);
  const so = u * E.side; // + toward the outer side of the face
  if (md === 'smug') lidY = Math.max(lidY, -0.12 - 0.14 * so);
  else if (md === 'sad') lidY = Math.max(lidY, -0.62 + 0.42 * so);
  else if (md === 'angry') lidY = Math.max(lidY, -0.5 - 0.4 * so);
  else if (md === 'think') lidY = Math.max(lidY, -0.55);
  if (vv < lidY) return null;
  if (lidY > -eh + 0.05 && vv < lidY + th) return CINK;
  const rr = (uu / ew) ** 2 + (vv / eh) ** 2;
  if (rr > (1 - th * 0.95) ** 2) return CINK;
  if (md === 'love') {
    if (heart2(uu, vv + 0.05, 0.62)) return (uu + 0.2) ** 2 + (vv + 0.3) ** 2 < 0.05 ? '#ffffff' : vv < 0 ? '#ff7ab8' : '#ff3a86';
    return '#14306e';
  }
  const shine = (cx, cy, rx, ry) => ((uu - cx) / rx) ** 2 + ((vv - cy) / ry) ** 2 < 1 || (uu - cx) ** 2 + (vv - cy) ** 2 < (0.65 / E.px) ** 2;
  if (shine(-0.2 * ew, -0.45, wide ? 0.3 : 0.26, wide ? 0.34 : 0.3)) return '#ffffff';
  if (shine(0.24 * ew, 0.42, 0.12, 0.12)) return '#e8ffff';
  if (md === 'excited') { const a = Math.atan2(vv - 0.05, uu), r = Math.hypot(uu, vv - 0.05); if (r < 0.32 + 0.12 * Math.cos(a * 4 + E.t * 4)) return r < 0.12 ? '#ffffff' : '#fff2a0'; }
  return vv < -0.25 ? '#0c2052' : vv < 0.3 ? '#1748a0' : vv < 0.62 ? '#2a9ae0' : '#5ae8f4';
}

// Clip's mouth: rest smile, talking oval (with a tongue), moods.
function clipMouth(Mo, u, v) {
  const th = Math.max(0.16, 1.05 / Mo.px);
  const md = Mo.mood, open = Mo.open;
  if (open > 0.08 || md === 'excited' || md === 'laugh') {
    const o = Math.max(open, md === 'excited' || md === 'laugh' ? 0.75 : 0);
    if (md === 'surprised') { const r = (u / (0.32 + o * 0.12)) ** 2 + ((v - 0.1) / (0.34 + o * 0.3)) ** 2; return r <= 1 ? (r > (1 - th * 2.2) ** 2 ? CINK : '#3a0e2a') : null; }
    // a "D" shaped open smile, taller with talk
    const top = -0.08, bot = 0.12 + o * 0.62 * (1 - 0.55 * u * u);
    const half = 0.62 + o * 0.08;
    if (Math.abs(u) > half || v < top - th || v > bot + th * 0.5) return null;
    const curve = top + 0.12 * u * u;
    if (v < curve - th) return null;
    if (v < curve || v > bot - th * 0.5 || Math.abs(u) > half - th) return CINK;
    if (v > bot - 0.28 * o - th && Math.abs(u) < half * 0.62) return '#ff7aa8';
    return '#3a0e2a';
  }
  if (md === 'surprised') { const r = (u / 0.26) ** 2 + ((v - 0.1) / 0.3) ** 2; return r <= 1 && r > (1 - th * 2.6) ** 2 ? CINK : null; }
  let c;
  if (md === 'sad') c = 0.32 - 0.38 * (1 - u * u);
  else if (md === 'smug') c = 0.1 + 0.2 * (1 - u * u) - 0.22 * u * Mo.side;
  else if (md === 'angry' || md === 'think') c = 0.12 + 0.04 * u;
  else c = -0.06 + 0.32 * (1 - u * u);
  return Math.abs(u) < (md === 'think' ? 0.4 : 0.66) && Math.abs(v - c) < th ? CINK : null;
}

const CLIP_EYES = new Map();
function clipEyeState(id) {
  let s = CLIP_EYES.get(id);
  const tn = typeof performance !== 'undefined' ? performance.now() : Date.now();
  if (!s) { s = { last: tn, next: 1.4, blink: 0, gx: 0, gy: 0 }; CLIP_EYES.set(id, s); if (CLIP_EYES.size > 40) CLIP_EYES.delete(CLIP_EYES.keys().next().value); }
  const dt = Math.min(0.05, Math.max(0, (tn - s.last) / 1000));
  s.last = tn;
  s.next -= dt;
  if (s.next <= 0) { s.blink = 0.12; s.next = 2.2 + Math.random() * 3; if (Math.random() < 0.2) s.next = 0.22; }
  s.blink = Math.max(0, s.blink - dt);
  s.dt = dt;
  return s;
}

function drawClipBubble(ctx, cx, cy, rx, ry, t) {
  const a = ctx.globalAlpha;
  const g = ctx.createRadialGradient(cx - rx * 0.3, cy - ry * 0.35, 1, cx, cy, Math.max(rx, ry));
  g.addColorStop(0, 'rgba(255,255,255,0.32)'); g.addColorStop(0.6, 'rgba(170,240,255,0.18)'); g.addColorStop(1, 'rgba(90,210,255,0.42)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, TAU); ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(235,255,255,0.85)';
  ctx.beginPath(); ctx.ellipse(cx, cy, rx - 0.5, ry - 0.5, 0, 0, TAU); ctx.stroke();
  // iridescent sheen
  ctx.globalAlpha = a * 0.5;
  ctx.strokeStyle = `hsl(${(t * 60) % 360},90%,72%)`;
  ctx.beginPath(); ctx.ellipse(cx, cy, rx - 2, ry - 2, 0, 0.3, 1.5); ctx.stroke();
  ctx.strokeStyle = `hsl(${(t * 60 + 140) % 360},90%,72%)`;
  ctx.beginPath(); ctx.ellipse(cx, cy, rx - 2, ry - 2, 0, 3.4, 4.4); ctx.stroke();
  ctx.globalAlpha = a * 0.9;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath(); ctx.ellipse(cx - rx * 0.42, cy - ry * 0.45, rx * 0.22, ry * 0.12, -0.6, 0, TAU); ctx.fill();
  ctx.fillRect(Math.round(cx + rx * 0.45), Math.round(cy + ry * 0.35), 1, 1);
  ctx.globalAlpha = a;
}

function drawClip(ctx, o) {
  const x = o.x ?? 0, y = o.y ?? 0, t = o.t ?? 0, scale = o.scale ?? 1, facing = (o.facing ?? 1) < 0 ? -1 : 1;
  const pose = CLIP_POSE[o.pose] ? o.pose : 'idle';
  const mood = o.pose === 'laugh' ? 'laugh' : o.mood || 'happy';
  const vs = Math.max(0.5, Math.round(1.6 * scale * 4) / 4);
  let yaw = (facing > 0 ? 14 : -14) + (o.yaw ?? 0);
  if (pose === 'spin') yaw += (t * 400) % 360;
  yaw = ((Math.round(yaw / 15) * 15 + 540) % 360) - 180;
  const speed = mood === 'excited' || pose === 'cheer' || pose === 'laugh' ? 1.7 : 1;
  const fi = Math.floor(t * speed * CLIP_N) % CLIP_N;
  const fr = clipFrame(pose, (fi + CLIP_N) % CLIP_N, facing, yaw, vs);
  // bounce on the bubble
  const ph = t * 2.7;
  const hop = Math.abs(Math.sin(ph));
  const lift = o.bubble === false ? Math.round(Math.sin(t * 2.2) * 1.5 * vs) : Math.round(hop * 3.2 * vs);
  const sq = o.bubble === false ? 0 : Math.pow(1 - hop, 6);
  const br = 9 * vs;
  const brx = br * (1 + 0.14 * sq), bry = br * (1 - 0.16 * sq);
  const groundY = o.bubble === false ? y : y - bry * 2 + 3.5 * vs;
  if (o.bubble !== false) drawClipBubble(ctx, x, y - bry, brx, bry, t);
  const X = Math.round(x - fr.fx), Y = Math.round(groundY - fr.fy - lift);
  ctx.drawImage(fr.canvas, X, Y);
  // face
  const st = clipEyeState('clip:' + (o.id ?? 'main'));
  let gx = Math.sin(t * 0.6) * 0.3, gy = Math.sin(t * 0.37) * 0.2;
  if (o.lookAt) {
    const dx = o.lookAt[0] - (X + fr.hc[0]), dy = o.lookAt[1] - (Y + fr.hc[1]);
    const dl = Math.hypot(dx, dy) || 1, k = Math.min(1, dl / 40);
    gx = (dx / dl) * k; gy = (dy / dl) * k;
  }
  if (mood === 'think') { gx = 0.6 * facing; gy = -0.7; }
  st.gx += (gx - st.gx) * Math.min(1, (st.dt || 0.016) * 10);
  st.gy += (gy - st.gy) * Math.min(1, (st.dt || 0.016) * 10);
  const F = fr.feats;
  const px = Math.max(1, Math.hypot(F.eyeL.ax, F.eyeL.ay, F.eyeL.bx, F.eyeL.by) / Math.SQRT2);
  const squint = mood === 'happy' && (o.talk || 0) < 0.05 && Math.sin(t * 0.8) > 0.9;
  const a0 = ctx.globalAlpha;
  for (const k of ['eyeL', 'eyeR', 'mouth']) {
    const f = F[k];
    if (!f || f.z < 0.05) continue;
    ctx.globalAlpha = a0 * Math.min(1, f.z / 0.2);
    if (k === 'mouth') {
      const mpx = Math.hypot(f.ax, f.ay);
      rasterFeature(ctx, X, Y, f, 1, 1.25, fr.mask, (u, v) => clipMouth({ mood, open: Math.max(0, Math.min(1, o.talk || 0)), px: mpx, side: facing }, u, v));
    } else {
      const E = { mood, blink: st.blink > 0 ? 1 : 0, lid: mood === 'sad' ? 0.1 : 0, gu: st.gx, gv: st.gy, side: k === 'eyeL' ? 1 : -1, px, t, squint };
      rasterFeature(ctx, X, Y, f, 1, 1.3, fr.mask, (u, v) => clipEye(E, u, v));
    }
  }
  ctx.globalAlpha = a0;
  const A = fr.anchors;
  const at = (p) => [X + fr.fx + p[0], Y + fr.fy + p[1]];
  return { head: at(A.head), mouth: at(A.mouth), top: at(A.top), hand: at(A.hand), w: fr.canvas.width, h: fr.canvas.height + (o.bubble === false ? 0 : bry * 2) };
}

function warmClip({ scale = 1, facing = 1, poses = ['idle', 'talk'] } = {}) {
  const vs = Math.max(0.5, Math.round(1.6 * scale * 4) / 4);
  const yaw = facing > 0 ? 15 : -15;
  for (const p of poses) for (let fi = 0; fi < CLIP_N; fi++) clipFrame(p, fi, facing < 0 ? -1 : 1, yaw, vs);
  return true;
}
export { warmClip };
