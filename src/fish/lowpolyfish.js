// PHASE 8 VOXEL CREATURES: every pose mesh built below is converted into a REAL VOXEL MODEL before it is cached
// (src/fish/voxelize.js: fine voxels, ~48 along small fish up to ~140 along giants via voxelSize(c, pose); colours
// sampled from the painted skin; natural stamped eyes with iris, pupil and catchlight; translucent fin voxels with
// denser rays; baked ambient occlusion; glow voxels), so sprite sheets, fishMesh (the 3D tank), lpTube (eel bodies)
// and lpOrb all show voxel art. Pose caches keep compact face lists (VoxMesh) and release the GL buffers once a sheet
// has been rendered. setVoxelMode(false) brings back the smooth anatomical meshes (debug / comparison).
//
// Low-poly fish & sea creatures (phase 6). Every fish and creature is a faceted, flat-shaded 3D mesh rendered
// with src/gfx/lowpoly.js (the look of the user's low-poly seal reference): realistic anatomy from
// src/fish/anatomy.js, a soft painted skin (countershading, stripes, spots, scale rows, gill and lateral lines,
// painted from realvox.realLayout), translucent ray-striped fins, small natural glossy eyes with a catchlight,
// glossy Frutiger Aero specular + sky reflection + rim light, iridescent sheen.
//
// Body plans
//  - 'fish' (realvox.fishModel): a lofted body (rings along the spine, superellipse cross-sections), unpaired
//    fins and the caudal fin as membranes in the centre plane (their outline comes from the painted skin's alpha),
//    thick fleshy fins (sharks, dolphins) as wedges, paired fins as cupped polygons, bills, cephalofoils, whip
//    tails, flukes, barbels, lures, teeth, puffer spines. Flatfish and rays are the same model rolled flat.
//  - 'solid' (realvox.solidPose): crabs, jellyfish, octopus, squid, starfish, isopod, seahorse and the Wakka
//    chomper: their primitives (ellipsoids, capsules, tubes) tessellated into low-poly meshes, face colours
//    from the primitives' own colour functions.
//  - chain creatures (eels): a low-poly head model + faceted body pills stamped along the game's path (fishrig.js).
//  - custom builds: turtle, penguin, resting seal (fjord); cetaceans and the other creatureMesh kinds are anatomy
//    specs (CREATURES below) in the same body plans.
// Animation: the mesh itself bends (a travelling tail wave along the spine; cetaceans undulate vertically, rays
// flap their wings), fins flutter, pectorals beat, barbels sway, the jaw drops on bites, puffers inflate.
// Pose meshes are cached per (creature, swim frame, inflate step, mouth); sprite frames are rendered into
// sheets (all LP_SWIM swim frames of one yaw / scale bucket in ONE GL pass + ONE readback) under a per-frame
// time budget with nearest-frame fallback and an LRU pixel budget. Nothing renders uncached per fish per frame.
//
// API
//   fishMesh(sp | id, rec?, {phase, inflate, mouth, frames}) -> LPMesh | null       (3D scenes: tank, intro)
//       mesh.texture (painted skin atlas, draw the mesh with {texture, emitTex: true}), mesh.fins (translucent
//       LPMesh, same texture: {texture, alpha: mesh.finAlpha, cull: false}), mesh.glow (LPMesh | null, {emit: 1}),
//       mesh.L (body length in model units; models face +x, y up, origin = body centre), mesh.anchors (3D points);
//       chain species (eels) come with their whole undulating body (head at the origin, body trailing along -x)
//   creatureMesh(kind, {phase, frames}) -> LPMesh | null   kinds: dolphin, whale, beluga, orca, seal, turtle, shark,
//       hammerhead, manta, stingray, crab, jelly, octopus, squid, seahorse, starfish, penguin, restseal (same fields)
//   addFishToScene(scene, mesh, model4x4, o?)  adds a fishMesh / creatureMesh with the right per-part options
//   lpFrame(c, req) -> {canvas, sx, sy, w, h, ax, ay, k, anchors, eyes} | null       (sprite frames, fishrig.js)
//       c = compiled look (spritecache.compiled); req {S (device px per look px), yaw (deg, 0 = side view facing
//       right, 90 = toward the viewer), sw (0..LP_SWIM-1), infl (0..3), mouth (0|1), pri (>= 3 hero close-up: a
//       capped extra build allowance), force (build now, whatever it costs)}
//   creatureFrame(kind, req) -> same as lpFrame for creatureMesh kinds (far giants)
//   lpTube(c, rPx) -> {canvas, ax, ay, r, w, h} faceted body pill for chain creatures (lpBall: a faceted ball)
//   lpOrb(r, hex, glow) -> {canvas, ax, ay} glossy faceted orb (Wakka pellets); lpCrabLook(color) seabed crab look
//   lpStill(c, req) -> one still frame (same shape as lpFrame) without building a whole sheet
//   lpFishIcon(sp | id, w, h, {dir, tint, tintA, yaw}) -> canvas      (UI icons, lists)
//   setLowpolyBudget(ms) (per-frame build time), setLowpolySync(on) (build everything immediately: tests),
//   warmFish(c, S), lowpolyStats(), clearLowpolyCache(), LP_SWIM (8 swim frames per sheet)
// Example (3D tank): const m = fishMesh('koi', rec, {phase: t * 1.2}); addFishToScene(scene, m, T4.trs(pos, 0, yaw,
//   0, 1.5 / m.L)); (phase is quantised to `frames` cached poses, default 8: never builds per frame once warm.)
// Fallback: without WebGL2, sprites render through lowpoly.js's Canvas2D software path (flat-shaded, slower, cached
// the same way; fewer swim frames are worth it there). 3D meshes (fishMesh) need WebGL2.

import { MeshBuilder, LPMesh, renderSheet, lpAvailable, lpCanRender, lpProject, M4, lpFreeTexture } from '../gfx/lowpoly.js';
import { fishModel, realLayoutJob, solidPose, finHeightFn, hexRGB } from './realvox.js';
import { resolveReal } from './anatomy.js';
import { compiled } from '../gfx/spritecache.js';
import { voxelizeParts, mergeVox, voxelizeMesh } from './voxelize.js';
import { SPECIES_BY_ID } from './species.js';
import { makeCanvas } from '../core/canvas.js';
import { hash2 } from '../core/math.js';

export const LP_SWIM = 8;
const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const YAW_STEP = 10;
const SCALE_STEP = 1.16;
const CAM_TILT = 13;
const TEX_LO = 150, TEX_HI = 320;  // skin texture px along the body length (hi: close-ups, catch card, tank)
const SHEET_PX_MAX = 20e6;        // sprite sheet cache (pixels)
const POSE_MAX = 900;             // cached pose meshes
const FORCE_MS = 10;              // extra allowance per frame for creatures that have nothing to show yet (and heroes)
const MAX_SPRITE = 1500;          // px: bigger creatures render at a lower scale and are drawn scaled up

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const norm = (x, y, z) => { const l = Math.hypot(x, y, z) || 1; return [x / l, y / l, z / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const rgb01 = (h) => { const c = hexRGB(h); return [c[0] / 255, c[1] / 255, c[2] / 255]; };
const unpack = (p) => [(p & 255) / 255, ((p >>> 8) & 255) / 255, ((p >>> 16) & 255) / 255];
const toneRGB = (c, k) => (k >= 0 ? c.map((v, i) => v + ([1, 0.99, 0.94][i] - v) * k) : c.map((v, i) => v + (v * [0.25, 0.3, 0.45][i] + [0.03, 0.05, 0.13][i] - v) * -k));
const mixRGB = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// ------------------------------------------------------------------------------------------------ budget

let budgetMs = 5, spent = 0, forceSpent = 0, syncAll = false, rafOn = false;
let stat = { sheets: 0, poses: 0, skins: 0, renders: 0, ms: 0, fallbacks: 0, misses: 0, skinMs: 0, poseMs: 0, glMs: 0, buildMs: 0 };
export function setLowpolyBudget(ms) { budgetMs = Math.max(1, ms); }
export function setLowpolySync(on) { syncAll = !!on; }
export function lowpolyStats() { return { ...stat, sheetPx: sheetPx, sheetCount: sheets.size, poseCount: poses.size, budgetMs, spent }; }
function tick() {
  spent = 0; forceSpent = 0;
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(tick);
}
function ensureTick() {
  if (rafOn || typeof requestAnimationFrame !== 'function') return;
  rafOn = true;
  requestAnimationFrame(tick);
}
const canSpend = () => syncAll || spent < budgetMs;

// ------------------------------------------------------------------------------------------------ skins

// Painted skin atlas of a 'fish' plan creature: row A = body albedo (side view, dilated; alpha 128 = glowing),
// row B = fin membranes (alpha = opacity, rays opaque), row C = cells: natural eye, pectoral, pelvic, white.
function skinOf(c, hi = false) {
  const slot = hi ? '_lpSkinHi' : '_lpSkin';
  if (!c[slot]) advanceSkin(c, hi, Infinity);
  return c[slot];
}

// Paint (part of) a skin before `deadline` (the side-view layout is resumable). Returns true once it is ready.
function advanceSkin(c, hi, deadline) {
  const slot = hi ? '_lpSkinHi' : '_lpSkin';
  if (c[slot]) return true;
  const jslot = slot + 'Job';
  const t0 = now();
  let job = c[jslot];
  if (!job) {
    const M0 = fishModel(c, 0);
    const r = clamp((hi ? TEX_HI : TEX_LO) / M0.L, 0.25, 16);
    job = c[jslot] = { it: realLayoutJob(c, r, 0), r };
  }
  let done = null;
  for (;;) {
    const st = job.it.next();
    if (st.done) { done = st.value; break; }
    if (now() > deadline) break;
  }
  stat.skinMs += now() - t0;
  if (!done) return false;
  c[jslot] = null;
  c[slot] = finishSkin(c, done, job.r);
  return true;
}

function finishSkin(c, Lo, r) {
  const t0 = now();
  const { GW, GH } = Lo;
  const Q = 40;
  const W = Math.max(GW, Q * 4), H = GH * 2 + Q;
  const cv = makeCanvas(W, H);
  const g = cv.getContext('2d');
  const img = g.createImageData(GW, GH * 2);
  const d = new Uint32Array(img.data.buffer);
  const N = GW * GH;
  const filled = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    if (Lo.mask[i]) { d[i] = ((Lo.col[i] & 0xffffff) | ((Lo.glow[i] ? 128 : 255) << 24)) >>> 0; filled[i] = 1; }
    const f = Lo.fin[i];
    if (f) {
      let a = f >>> 24;
      if (Lo.finGlow[i]) a = 255;
      d[N + i] = ((f & 0xffffff) | (a << 24)) >>> 0;
    }
  }
  // dilate the body albedo outward (silhouette UVs sample just outside the mask)
  for (let pass = 0; pass < 4; pass++) {
    const add = [];
    for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
      const i = y * GW + x;
      if (filled[i]) continue;
      let src = -1;
      if (x > 0 && filled[i - 1]) src = i - 1; else if (x < GW - 1 && filled[i + 1]) src = i + 1;
      else if (y > 0 && filled[i - GW]) src = i - GW; else if (y < GH - 1 && filled[i + GW]) src = i + GW;
      if (src >= 0) add.push(i, src);
    }
    for (let k = 0; k < add.length; k += 2) { d[add[k]] = (d[add[k + 1]] | 0xff000000) >>> 0; filled[add[k]] = 1; }
  }
  g.putImageData(img, 0, 0);
  // soften both rows a touch (a soft painted skin; 1 px ray lines would alias into moire when magnified)
  {
    const tmp = makeCanvas(GW, GH * 2);
    const tg = tmp.getContext('2d');
    tg.drawImage(cv, 0, 0, GW, GH * 2, 0, 0, GW, GH * 2);
    g.clearRect(0, 0, GW, GH * 2);
    g.filter = 'blur(0.5px)';
    g.drawImage(tmp, 0, 0, GW, GH, 0, 0, GW, GH);
    g.filter = 'blur(0.55px)';
    g.drawImage(tmp, 0, GH, GW, GH, 0, GH, GW, GH);
    g.filter = 'none';
  }
  const S = c.real;
  const cy = GH * 2;
  paintEye(g, 0, cy, Q, S.eye || {});
  paintPaired(g, Q, cy, Q, S.pec, S);
  paintPaired(g, Q * 2, cy, Q, S.pel, S);
  g.fillStyle = '#ffffff';
  g.fillRect(Q * 3, cy, Q, Q);
  cv._lpSmooth = true;
  const sk = {
    cv, Lo, r, W, H, GW, GH, Q, cy,
    uvB: (X, Y) => [Lo.toGX(X) / W, Lo.toGY(Y) / H],
    uvF: (X, Y) => [Lo.toGX(X) / W, (Lo.toGY(Y) + GH) / H],
    cell: (i, a, b) => [(Q * i + 1 + a * (Q - 2)) / W, (cy + 1 + b * (Q - 2)) / H],
  };
  sk.white = sk.cell(3, 0.5, 0.5);
  stat.skins++;
  stat.skinMs += now() - t0;
  return sk;
}

// Natural fish eye: a large glossy dark pupil, a thin metallic iris ring, a dark limbus, a soft catchlight.
function paintEye(g, x, y, Q, e) {
  const cx = x + Q / 2, cy = y + Q / 2, R = Q / 2;
  const iris = e.iris || '#c8a050';
  const pup = clamp(e.pupil ?? 0.6, 0.35, 0.8);
  g.save();
  g.beginPath(); g.rect(x, y, Q, Q); g.clip();
  g.fillStyle = shadeHex(iris, -0.55);
  g.fillRect(x, y, Q, Q);
  const gr = g.createRadialGradient(cx - R * 0.1, cy - R * 0.15, R * pup * 0.6, cx, cy, R * 0.98);
  gr.addColorStop(0, shadeHex(iris, 0.25));
  gr.addColorStop(0.55, iris);
  gr.addColorStop(0.86, shadeHex(iris, -0.45));
  gr.addColorStop(1, '#141418');
  g.fillStyle = gr;
  g.beginPath(); g.arc(cx, cy, R * 0.98, 0, TAU); g.fill();
  const pg = g.createRadialGradient(cx - R * 0.12, cy - R * 0.12, 0, cx, cy, R * pup);
  pg.addColorStop(0, '#22303e');
  pg.addColorStop(0.7, '#0a0d14');
  pg.addColorStop(1, '#05060a');
  g.fillStyle = pg;
  g.beginPath(); g.arc(cx, cy, R * pup, 0, TAU); g.fill();
  // catchlights (upper front + a faint bounce lower back)
  g.fillStyle = 'rgba(255,255,255,0.95)';
  g.beginPath(); g.ellipse(cx + R * 0.26, cy - R * 0.3, R * 0.2, R * 0.15, -0.5, 0, TAU); g.fill();
  g.fillStyle = 'rgba(220,250,255,0.5)';
  g.beginPath(); g.arc(cx - R * 0.3, cy + R * 0.3, R * 0.08, 0, TAU); g.fill();
  g.restore();
}

function shadeHex(h, k) {
  const c = toneRGB(rgb01(h), k);
  return '#' + c.map((v) => Math.round(clamp01(v) * 255).toString(16).padStart(2, '0')).join('');
}

// Paired fin paint: k (x) root -> tip, across the fin (y); rays radiate from the root (they follow the outline).
function paintPaired(g, x, y, Q, F, S) {
  if (!F) return;
  const img = g.createImageData(Q, Q);
  const d = new Uint32Array(img.data.buffer);
  const rgb = rgb01(F.col || S.col.fin || S.col.flank);
  const edge = F.edge ? rgb01(F.edge) : null, base = F.base ? rgb01(F.base) : null, spots = F.spots ? rgb01(F.spots) : null;
  const nR = F.rays ?? 12;
  for (let j = 0; j < Q; j++) for (let i = 0; i < Q; i++) {
    const k = (i + 0.5) / Q, tq = (j + 0.5) / Q;
    let o = rgb;
    if (base) o = mixRGB(base, o, smooth(0, 0.5, k));
    if (edge && k > 0.8) o = edge;
    if (spots && hash2(Math.floor(i / 3), Math.floor(j / 3), 47) > 0.72) o = spots;
    if (F.bands) for (const b of F.bands) if (Math.abs(k - b.at) < b.w / 2) o = rgb01(b.col);
    let a = F.opaque ? 255 : 150;
    if (!F.opaque && nR >= 3) {
      const fr = (tq * nR) % 1;
      if (Math.min(fr, 1 - fr) * (Q / nR) < 0.75) { o = F.rayBands ? rgb01(F.rayBands[Math.floor(k * F.rayBands.length * 2.5) % F.rayBands.length]) : toneRGB(o, F.rayTone ?? -0.1); a = 240; }
    }
    if (F.feather && k > F.feather && a < 200) a = 30;
    d[j * Q + i] = ((Math.round(o[0] * 255)) | (Math.round(o[1] * 255) << 8) | (Math.round(o[2] * 255) << 16) | (a << 24)) >>> 0;
  }
  g.putImageData(img, x, y);
}

// ------------------------------------------------------------------------------------------------ part builders

// A part under construction: vertex-coloured / textured triangles, emitted through a deform fn.
class Part {
  constructor() { this.mb = new MeshBuilder(); }
  tri(a, b, c, col, ua, ub, uc) { this.mb.tri(a, b, c, col, ua, ub, uc); }
  both(a, b, c, col, ua, ub, uc) { this.mb.tri(a, b, c, col, ua, ub, uc); this.mb.tri(a, c, b, col, ua, uc, ub); }
  quad(a, b, c, d, col, ua, ub, uc, ud) { this.mb.tri(a, b, c, col, ua, ub, uc); this.mb.tri(a, c, d, col, ua, uc, ud); }
  get empty() { return this.mb.n === 0; }
}

function materialOf(S) {
  const m = { gloss: 0.8, iri: 0.14, chrome: 0, glass: 0, finGlass: 0.84, sheen: 1, rim: 1, silver: 0, ...(S.mat || {}) };
  return {
    body: { spec: 0.22 + 0.4 * m.gloss, shine: 14 + 22 * m.gloss, env: 0.2 + 0.3 * m.gloss + 0.35 * m.chrome + 0.25 * m.silver, iri: 0.75 * m.iri, rim: 0.34 * m.rim, ambient: 0.4 },
    fins: { alpha: 1 - 0.38 * m.finGlass, spec: 0.5, shine: 46, env: 0.22, rim: 0.42, ambient: 0.55, cull: false },
    glass: m.glass >= 0.5,
  };
}

// ------------------------------------------------------------------------------------------------ fish plan

const US = [0, 0.015, 0.04, 0.075, 0.12, 0.175, 0.24, 0.32, 0.41, 0.5, 0.59, 0.68, 0.76, 0.83, 0.89, 0.94, 0.975, 1];

// Tail outline radius (as realvox.finAt) for tail type at angle th (s = -1 bottom .. 1 top).
function tailR(tf, th, s, len) {
  switch (tf.type) {
    case 'truncate': return len / Math.cos(th);
    case 'round': return len * (1.02 - 0.28 * s * s) / Math.cos(th * 0.5);
    case 'clavus': return len * (1 - 0.3 * s * s) * (1 + 0.07 * Math.cos(((s + 1) / 2) * (tf.lobes ?? 9) * TAU)) / Math.cos(th * 0.3);
    case 'fan': return len * (1.05 - 0.22 * s * s);
    case 'pointed': return len * (1 - 0.65 * Math.abs(s));
    case 'lunate': return len * (1 - (tf.fork ?? 0.6) * Math.max(0, 1 - s * s)) / Math.cos(th * 0.85);
    case 'hetero':
      // slender sickle: a concave trailing edge between the long upper lobe and the short lower lobe
      if (s > 0) return len * (0.42 + 0.72 * Math.pow(s, 2.2));
      return len * (0.42 + 0.22 * Math.pow(-s, 1.4)) * (1 - 0.35 * Math.pow(-s, 4));
    case 'emarginate': return len * (1 - (tf.fork ?? 0.15) * (1 - s * s)) / Math.cos(th);
    case 'lyre': return len * (1 - 0.35 * (1 - s * s)) * (Math.abs(s) > 0.85 ? 1.35 : 1) / Math.cos(th);
    default: return len * (1 - (tf.fork ?? 0.3) * (1 - Math.abs(s))) / Math.cos(th * 0.7);
  }
}

function buildFish(c, ph, inflStep, gape, hi) {
  const S = c.real;
  const infl = inflStep / 3;
  const M = fishModel(c, infl), M0 = infl ? fishModel(c, 0) : M;
  const L = M.L, xN = M.xN;
  const sk = skinOf(c, hi);
  const B = S.body || {};
  const xs = B.xs ?? 2, wy = B.wy ?? 0.46;
  const flat = M.flat;
  const P = TAU * ph;
  const mat = materialOf(S);
  const body = new Part(), fins = new Part(), eyes = new Part(), glow = new Part(), opaqueFins = body;
  const W = sk.white;
  // ---- deformation: travelling tail wave, vertical undulation (cetaceans), wing flap (rays)
  const wave = clamp01(S.wave ?? 0.5);
  const amp = S.wave === 0 ? 0 : (0.035 + 0.11 * wave) * L * (S.stiff ? 0.5 : 1);
  const k0 = S.waveK ?? 3.2, ex = S.stiff ? 3 : 2;
  const wf = (u, A, k, e) => {
    if (u <= 1) return A * Math.pow(Math.max(0, u), e) * Math.sin(P - u * k);
    return A * Math.sin(P - k) + A * (e * Math.sin(P - k) - k * Math.cos(P - k)) * (u - 1);
  };
  const vamp = S.vbend ? S.vbend * L : 0;
  const headShift = S.chainHead ? L * 0.35 : 0; // eel heads: the chain point sits at the back of the head
  const span = Math.max(1, (M.ymax - M.ymin) / 2);
  const flapA = S.flap ? S.flap * span : 0, flapK = S.flapK ?? 1.2;
  // wave offsets + slopes in lookup tables (every vertex goes through D)
  const NL = 192, U0 = -0.7, U1 = 2.3, du = (U1 - U0) / NL;
  const lut = (A, k, e) => {
    const o = new Float32Array(NL + 1), sl = new Float32Array(NL + 1);
    if (!A) return null;
    for (let i = 0; i <= NL; i++) { const u = U0 + i * du; o[i] = wf(u, A, k, e); sl[i] = -(wf(u + 0.005, A, k, e) - wf(u - 0.005, A, k, e)) / (0.01 * L); }
    return [o, sl];
  };
  const LW = lut(amp, k0, ex), LV = lut(vamp, 2.6, 2);
  const look = (T, u) => {
    let f = (u - U0) / du;
    if (f < 0) f = 0; else if (f > NL - 0.001) f = NL - 0.001;
    const i = f | 0, t = f - i;
    return [T[0][i] + (T[0][i + 1] - T[0][i]) * t, T[1][i] + (T[1][i + 1] - T[1][i]) * t];
  };
  const D = (p) => {
    let x = p[0], y = p[1], z = p[2];
    const u = (xN - x) / L;
    if (flapA) z += flapA * Math.pow(Math.min(1.4, Math.abs(y) / span), 1.6) * Math.sin(P - u * flapK);
    if (LW) {
      const [o, sl] = look(LW, u);
      const n = Math.sqrt(1 + sl * sl);
      x -= (z * sl) / n; z = o + z / n;
    }
    if (LV) {
      const [o, sl] = look(LV, u);
      const n = Math.sqrt(1 + sl * sl);
      x -= (y * sl) / n; y = o + y / n;
    }
    return [x + headShift, y, z];
  };
  // ---- mouth line (realLayout) + jaw gape
  const mouth = S.mouth ? { u: 0.1, v: 0.45, drop: 0, ...S.mouth } : null;
  let mTipY = 0, mCornerY = 0;
  if (mouth) {
    mTipY = M.botL(0.002) + (M.topL(0.002) - M.botL(0.002)) * mouth.v;
    if (mouth.type === 'inferior') mTipY = M.botL(mouth.u0 ?? 0.05) + 0.25;
    mCornerY = mTipY + mouth.drop * L;
  }
  const mouthY = (u) => {
    const k = clamp01(u / mouth.u);
    if (mouth.type === 'inferior') { const ub = (mouth.u0 ?? 0.05) + k * (mouth.u - (mouth.u0 ?? 0.05)); return M.botL(ub) + (mouth.lift ?? 0.012) * L * Math.sin(Math.PI * k); }
    return mTipY + (mCornerY - mTipY) * k - (mouth.curve ?? 0.006) * L * Math.sin(Math.PI * k);
  };
  const gAng = mouth && gape > 0 && mouth.type !== 'inferior' ? gape * (mouth.gapeK ?? 0.42) : 0;
  const hx = mouth ? xN - mouth.u * L : 0, hy = mouth ? mouthY(mouth.u) : 0;
  const jaw = (p) => {
    if (!gAng) return p;
    const u = (xN - p[0]) / L;
    if (u > mouth.u * 1.3 || p[1] >= mouthY(Math.min(u, mouth.u))) return p;
    const w = smooth(mouth.u * 1.3, mouth.u * 0.85, u) * gAng;
    const cs = Math.cos(-w), sn = Math.sin(-w), dx = p[0] - hx, dy = p[1] - hy;
    return [hx + dx * cs - dy * sn, hy + dx * sn + dy * cs, p[2]];
  };
  const blind = flat ? rgb01(flat.blind || '#f4f2ee') : null;
  // ---- body loft
  const nose = M.nose;
  const NV = 14;
  const surf = (u, Y, Mx = M) => {
    // half-thickness of the body at (u, Y) (superellipse cross-section, as realvox)
    const top = Mx.topL(u), bot = Mx.botL(u), hgt = top - bot;
    let hw = Mx.wid(u) * L;
    if (u < nose) hw *= Math.sqrt(Math.max(0, 1 - (1 - u / nose) ** 2));
    if (u > 0.93 && Mx.tail && Mx.tail.type !== 'whip') hw *= 0.35 + 0.65 * smooth(1.0, 0.93, u);
    const yw = bot + hgt * wy;
    const dd = Y >= yw ? (Y - yw) / Math.max(1e-3, top - yw) : (yw - Y) / Math.max(1e-3, yw - bot);
    return hw * Math.pow(Math.max(0, 1 - Math.min(1, dd) ** 2), 1 / xs);
  };
  const rings = [];
  for (const u of US) {
    const top = M.topL(u), bot = M.botL(u), hgt = top - bot;
    let hw = M.wid(u) * L;
    if (u < nose) hw *= Math.sqrt(Math.max(0, 1 - (1 - u / nose) ** 2));
    if (u > 0.93 && M.tail && M.tail.type !== 'whip') hw *= 0.35 + 0.65 * smooth(1.0, 0.93, u);
    const yw = bot + hgt * wy;
    const X = xN - u * L;
    const t0 = M0.topL(u), b0 = M0.botL(u);
    const ring = [];
    for (let j = 0; j < NV; j++) {
      const a = (j / NV) * TAU, cs = Math.cos(a), sn = Math.sin(a);
      const Y = yw + (cs >= 0 ? top - yw : yw - bot) * cs;
      const Z = hw * Math.sign(sn) * Math.pow(Math.abs(sn), 2 / xs);
      const v = hgt > 1e-6 ? (Y - bot) / hgt : 0.5;
      const rest = jaw([X, Y, Z]);
      ring.push({ p: D(rest), uv: sk.uvB(X, b0 + (t0 - b0) * v), z: Z });
    }
    rings.push(ring);
  }
  const bodyPart = mat.glass ? new Part() : body;
  const emitQuad = (part, a, b, c2, d) => {
    if (blind && a.z + b.z + c2.z + d.z < -1e-6) part.quad(a.p, b.p, c2.p, d.p, blind, W, W, W, W);
    else part.quad(a.p, b.p, c2.p, d.p, '#ffffff', a.uv, b.uv, c2.uv, d.uv);
  };
  for (let i = 0; i < rings.length - 1; i++) for (let j = 0; j < NV; j++) {
    const j2 = (j + 1) % NV;
    emitQuad(bodyPart, rings[i][j], rings[i + 1][j], rings[i + 1][j2], rings[i][j2]);
  }
  {
    // close the peduncle (or the eel neck) with a cap
    const last = rings[rings.length - 1];
    let cx = 0, cy = 0, cz = 0;
    for (const v of last) { cx += v.p[0]; cy += v.p[1]; cz += v.p[2]; }
    const C = { p: [cx / NV, cy / NV, cz / NV], uv: last[0].uv, z: 0 };
    for (let j = 0; j < NV; j++) { const a = last[j], b = last[(j + 1) % NV]; bodyPart.tri(a.p, b.p, C.p, '#ffffff', a.uv, b.uv, C.uv); }
  }
  // mouth interior when the jaw is open
  if (gAng > 0.02) {
    const n = 5, up = [], lo = [];
    for (let k = 0; k <= n; k++) {
      const u = (k / n) * mouth.u;
      const X = xN - u * L, Y = mouthY(u);
      up.push(D([X, Y + 0.002 * L, 0]));
      lo.push(D(jaw([X, Y - 0.002 * L, 0])));
    }
    for (let k = 0; k < n; k++) { body.both(up[k], lo[k], lo[k + 1], '#3a1622', W, W, W); body.both(up[k], lo[k + 1], up[k + 1], '#3a1622', W, W, W); }
  }
  // ---- bill (rostrum) ahead of the snout
  if (M.bill) {
    const bl = M.bill, n = 5, sides = 6;
    const yc = M.topL(0.004) * 0.5 + M.botL(0.004) * 0.5 + bl.y * L;
    const pts = [];
    for (let k = 0; k <= n; k++) {
      const t = k / n, X = xN + t * bl.len * L, kk = Math.max(0.02, 1 - t);
      pts.push({ X, hh: bl.h * L * Math.pow(kk, 0.8) + 0.004 * L, hw: bl.w * L * Math.pow(kk, 0.7) + 0.003 * L });
    }
    const R = pts.map((q) => Array.from({ length: sides }, (_, j) => {
      const a = (j / sides) * TAU;
      return { p: D([q.X, yc + Math.cos(a) * q.hh, Math.sin(a) * q.hw]), uv: sk.uvB(Math.min(q.X, xN), yc + Math.cos(a) * q.hh * 0.8) };
    }));
    for (let k = 0; k < n; k++) for (let j = 0; j < sides; j++) {
      const j2 = (j + 1) % sides, a = R[k][j], b = R[k][j2], c2 = R[k + 1][j2], d = R[k + 1][j];
      body.quad(a.p, b.p, c2.p, d.p, '#ffffff', a.uv, b.uv, c2.uv, d.uv);
    }
  }
  // ---- hammerhead cephalofoil: a flat wing across the head
  if (M.ceph) {
    const ce = M.ceph, u0 = 0, u1 = ce.u1;
    const yc = (M.topL(0.05) + M.botL(0.05)) / 2 + (ce.y ?? 0) * L;
    const nz = 7, nx = 4;
    const grid = [];
    for (let iz = 0; iz <= nz; iz++) {
      const zf = (iz / nz) * 2 - 1;
      const row = [];
      for (let ix = 0; ix <= nx; ix++) {
        const t = ix / nx;
        const span = Math.sqrt(Math.max(0, 1 - zf * zf * 0.92));
        const X = xN - (u0 + t * (u1 - u0) * (0.55 + 0.45 * span)) * L + (1 - span) * 0.02 * L;
        row.push([X, zf * ce.w * L]);
      }
      grid.push(row);
    }
    const hh = ce.h * L;
    for (const sd of [1, -1]) for (let iz = 0; iz < nz; iz++) for (let ix = 0; ix < nx; ix++) {
      const q = [grid[iz][ix], grid[iz][ix + 1], grid[iz + 1][ix + 1], grid[iz + 1][ix]];
      const pts = q.map(([X, Z]) => D([X, yc + sd * hh * (1 - 0.6 * Math.abs(Z) / (ce.w * L)), Z]));
      const uvs = q.map(([X]) => sk.uvB(X, yc + sd * hh * 0.5));
      if (sd > 0) body.quad(pts[0], pts[3], pts[2], pts[1], '#ffffff', uvs[0], uvs[3], uvs[2], uvs[1]);
      else body.quad(pts[0], pts[1], pts[2], pts[3], '#ffffff', uvs[0], uvs[1], uvs[2], uvs[3]);
    }
    // wing edge
    for (let iz = 0; iz <= nz; iz += nz) for (let ix = 0; ix < nx; ix++) {
      const [X0, Z0] = grid[iz][ix], [X1, Z1] = grid[iz][ix + 1];
      const a = D([X0, yc + hh * 0.4, Z0]), b = D([X1, yc + hh * 0.4, Z1]), c2 = D([X1, yc - hh * 0.4, Z1]), d = D([X0, yc - hh * 0.4, Z0]);
      body.both(a, b, c2, '#ffffff', sk.uvB(X0, yc), sk.uvB(X1, yc), sk.uvB(X1, yc)); body.both(a, c2, d, '#ffffff', sk.uvB(X0, yc), sk.uvB(X1, yc), sk.uvB(X0, yc));
    }
  }
  // ---- unpaired fins: membranes in the centre plane (outline from the skin alpha), fleshy wedges for thick fins
  const fl = (P * 1.6);
  for (const f of S.fins || []) {
    const top = f.at !== 'bot', sgn = top ? 1 : -1;
    const Hfn = finHeightFn(f);
    const rake = f.rake ?? 0.4;
    const thick = f.thick || f.adipose;
    const nk = clamp(Math.ceil((f.to - f.from) * 34), 3, 16);
    const finPt = (Mx, t, hf, inflX, exact) => {
      const ub = f.from + (f.to - f.from) * t;
      const yb = top ? Mx.topL(ub) : Mx.botL(ub);
      let H = (f.finlets ? 1 : Hfn(t)) * (f.h ?? 0.1) * L * (1 - 0.35 * inflX);
      if (!exact) H = H * 1.1 + 0.012 * L;
      const h = H * hf;
      return [Mx.xN - ub * L - rake * Math.max(0, h), yb + sgn * h];
    };
    if (!thick) {
      const rows = [-0.06, 0.5, 1];
      const grid = [];
      for (let k = 0; k <= nk; k++) {
        const t = k / nk;
        grid.push(rows.map((hf) => {
          const [X, Y] = finPt(M, t, hf, infl, false);
          const [X0, Y0] = finPt(M0, t, hf, 0, false);
          const z = 0.022 * L * Math.max(0, hf) * Math.sin(fl + t * 5 + (top ? 0 : 1.7));
          return { p: D([X, Y, z]), uv: sk.uvF(X0, Y0) };
        }));
      }
      for (let k = 0; k < nk; k++) for (let r = 0; r < rows.length - 1; r++) {
        const a = grid[k][r], b = grid[k + 1][r], c2 = grid[k + 1][r + 1], d = grid[k][r + 1];
        fins.quad(a.p, b.p, c2.p, d.p, '#ffffff', a.uv, b.uv, c2.uv, d.uv);
      }
    } else {
      // fleshy fin: a wedge whose two faces meet at the outline
      const rows = [-0.08, 0.35, 0.7, 1];
      const th0 = (f.thick || (f.h ?? 0.03) * 0.25) * L;
      const F2 = [], B2 = [];
      for (let k = 0; k <= nk; k++) {
        const t = k / nk;
        const fr = [], br = [];
        for (const hf of rows) {
          const [X, Y] = finPt(M, t, hf, infl, true);
          const [X0, Y0] = finPt(M0, t, Math.min(hf, 0.96), 0, true);
          const ht = Math.max(0, hf);
          const th = Math.max(0.004 * L, th0 * (1 - 0.75 * ht) * (1 - 0.4 * Math.abs(t - 0.4)));
          const uv = sk.uvB(X0, Y0);
          fr.push({ p: D([X, Y, th]), uv }); br.push({ p: D([X, Y, -th]), uv });
        }
        F2.push(fr); B2.push(br);
      }
      for (let k = 0; k < nk; k++) for (let r = 0; r < rows.length - 1; r++) {
        const a = F2[k][r], b = F2[k + 1][r], c2 = F2[k + 1][r + 1], d = F2[k][r + 1];
        if (top) opaqueFins.quad(a.p, d.p, c2.p, b.p, '#ffffff', a.uv, d.uv, c2.uv, b.uv); else opaqueFins.quad(a.p, b.p, c2.p, d.p, '#ffffff', a.uv, b.uv, c2.uv, d.uv);
        const e = B2[k][r], g2 = B2[k + 1][r], h2 = B2[k + 1][r + 1], i2 = B2[k][r + 1];
        if (top) opaqueFins.quad(e.p, g2.p, h2.p, i2.p, '#ffffff', e.uv, g2.uv, h2.uv, i2.uv); else opaqueFins.quad(e.p, i2.p, h2.p, g2.p, '#ffffff', e.uv, i2.uv, h2.uv, g2.uv);
      }
      // outline edge + leading / trailing edges
      const R = rows.length - 1;
      for (let k = 0; k < nk; k++) {
        const a = F2[k][R], b = F2[k + 1][R], c2 = B2[k + 1][R], d = B2[k][R];
        opaqueFins.both(a.p, b.p, c2.p, '#ffffff', a.uv, b.uv, c2.uv); opaqueFins.both(a.p, c2.p, d.p, '#ffffff', a.uv, c2.uv, d.uv);
      }
      for (const k of [0, nk]) for (let r = 0; r < R; r++) {
        const a = F2[k][r], b = F2[k][r + 1], c2 = B2[k][r + 1], d = B2[k][r];
        opaqueFins.both(a.p, b.p, c2.p, '#ffffff', a.uv, b.uv, c2.uv); opaqueFins.both(a.p, c2.p, d.p, '#ffffff', a.uv, c2.uv, d.uv);
      }
    }
  }
  // ---- caudal fin
  const tf = M.tail, tf0 = M0.tail;
  if (tf && tf.type === 'whip') {
    const n = 8, sides = 6;
    const yc0 = (M.topL(1) + M.botL(1)) / 2;
    const hb = Math.min((tf.w ?? 0.03) * L, (M.topL(1) - M.botL(1)) / 2);
    const R = [];
    for (let k = 0; k <= n; k++) {
      const t = k / n, X = -L / 2 - t * tf.len * L, yc = yc0 + (tf.y ?? 0) * L * t * t;
      const hh = Math.max(0.0025 * L, hb * Math.pow(1 - t, tf.taper ?? 1.4));
      R.push(Array.from({ length: sides }, (_, j) => {
        const a = (j / sides) * TAU;
        return { p: D([X, yc + Math.cos(a) * hh, Math.sin(a) * hh * (tf.flat ?? 0.8)]), uv: sk.uvB(X, yc) };
      }));
    }
    for (let k = 0; k < n; k++) for (let j = 0; j < sides; j++) {
      const j2 = (j + 1) % sides, a = R[k][j], b = R[k][j2], c2 = R[k + 1][j2], d = R[k + 1][j];
      body.quad(a.p, d.p, c2.p, b.p, '#ffffff', a.uv, d.uv, c2.uv, b.uv);
    }
  } else if (tf) {
    const tailPts = (Mx, tfx, row, exact) => {
      const xp = -L / 2;
      const yc = (Mx.topL(1) + Mx.botL(1)) / 2 + (tfx.y ?? 0) * L;
      const f0 = (tfx.focus ?? 0.05) * L;
      const len = tfx.len * L + f0, spr = tfx.spread * L, lobe = tfx.lobe ?? 0;
      const thU = Math.atan2(spr * (1 + Math.max(0, lobe)), len), thD = Math.atan2(spr * (1 + Math.min(0, lobe) * 0.6 - Math.max(0, lobe) * 0.35), len);
      const nt = 18;
      const out = [];
      for (let k = 0; k <= nt; k++) {
        const t = k / nt, th0 = -thD + t * (thU + thD), s = 2 * t - 1;
        const pad = exact ? 1 : 1.06;
        const th = exact ? th0 : th0 + (t - 0.5) * 0.08;
        let R = tailR(tfx, th0, s, len) * pad + (exact ? 0 : 0.012 * L);
        const dist = row === 0 ? f0 * 0.35 : row === 1 ? f0 + (R - f0) * 0.5 : R;
        out.push({ X: xp + f0 - dist * Math.cos(th), Y: yc + dist * Math.sin(th), s, ht: clamp01((dist - f0) / Math.max(1e-3, R - f0)), t });
      }
      return out;
    };
    if (!tf.thick) {
      const rows = [0, 1, 2].map((r) => [tailPts(M, tf, r, false), tailPts(M0, tf0, r, false)]);
      const G = rows.map(([g, g0]) => g.map((q, k) => ({ p: D([q.X, q.Y, 0.03 * L * q.ht * Math.sin(fl * 1.3 + q.t * 4)]), uv: sk.uvF(g0[k].X, g0[k].Y) })));
      for (let r = 0; r < 2; r++) for (let k = 0; k < G[r].length - 1; k++) {
        const a = G[r][k], b = G[r][k + 1], c2 = G[r + 1][k + 1], d = G[r + 1][k];
        fins.quad(a.p, b.p, c2.p, d.p, '#ffffff', a.uv, b.uv, c2.uv, d.uv);
      }
    } else {
      const rows = [0, 1, 2].map((r) => [tailPts(M, tf, r, true), tailPts(M0, tf0, r, true)]);
      const mk = (sd) => rows.map(([g, g0]) => g.map((q, k) => ({
        p: D([q.X, q.Y, sd * Math.max(0.004 * L, tf.thick * L * (1 - 0.8 * q.ht) * (1 - 0.3 * Math.abs(q.s)))]),
        uv: sk.uvB(g0[k].X + 0.004 * L * (1 - q.ht), g0[k].Y),
      })));
      const Fg = mk(1), Bg = mk(-1);
      for (let r = 0; r < 2; r++) for (let k = 0; k < Fg[r].length - 1; k++) {
        const a = Fg[r][k], b = Fg[r][k + 1], c2 = Fg[r + 1][k + 1], d = Fg[r + 1][k];
        opaqueFins.quad(a.p, d.p, c2.p, b.p, '#ffffff', a.uv, d.uv, c2.uv, b.uv);
        const e = Bg[r][k], g2 = Bg[r][k + 1], h2 = Bg[r + 1][k + 1], i2 = Bg[r + 1][k];
        opaqueFins.quad(e.p, g2.p, h2.p, i2.p, '#ffffff', e.uv, g2.uv, h2.uv, i2.uv);
      }
      for (let k = 0; k < Fg[2].length - 1; k++) {
        const a = Fg[2][k], b = Fg[2][k + 1], c2 = Bg[2][k + 1], d = Bg[2][k];
        opaqueFins.both(a.p, b.p, c2.p, '#ffffff', a.uv, b.uv, c2.uv); opaqueFins.both(a.p, c2.p, d.p, '#ffffff', a.uv, c2.uv, d.uv);
      }
    }
  }
  // ---- horizontal flukes (cetaceans)
  if (S.flukes) {
    const fk = S.flukes, len = fk.len * L, sp = fk.span * L;
    const yc = (M.topL(1) + M.botL(1)) / 2, X0 = -L / 2 + 0.01 * L;
    const n = 6;
    const lead = [], trail = [];
    for (let k = -n; k <= n; k++) {
      const a = (k / n) * sp, kk = Math.abs(k / n);
      lead.push([X0 - len * 0.12 - len * 0.62 * kk * kk, a]);
      trail.push([X0 - len * (0.66 + 0.24 * kk) + len * 0.2 * (1 - kk) * (kk < 0.25 ? 1 : 0), a * 1.02]);
    }
    const topC = rgb01(fk.col || S.col.back), botC = rgb01(S.col.belly);
    const th = (kk) => 0.016 * L * (1 - 0.8 * kk);
    for (let k = 0; k < 2 * n; k++) {
      const kk0 = Math.abs((k - n) / n), kk1 = Math.abs((k + 1 - n) / n);
      const q = [[lead[k], kk0], [lead[k + 1], kk1], [trail[k + 1], kk1], [trail[k], kk0]];
      const T = q.map(([[X, Z], kk]) => D([X, yc + th(kk), Z])), Bt = q.map(([[X, Z], kk]) => D([X, yc - th(kk), Z]));
      body.quad(T[0], T[3], T[2], T[1], topC, W, W, W, W);
      body.quad(Bt[0], Bt[1], Bt[2], Bt[3], botC, W, W, W, W);
      body.both(T[0], T[1], Bt[1], topC, W, W, W); body.both(T[0], Bt[1], Bt[0], topC, W, W, W);
      body.both(T[3], T[2], Bt[2], topC, W, W, W); body.both(T[3], Bt[2], Bt[3], topC, W, W, W);
    }
  }
  // ---- paired fins (pectorals beat, pelvics flutter), cupped polygons on both flanks
  const paired = (F, kind) => {
    if (!F) return;
    const isPec = kind === 'pec';
    const u = F.u, X = xN - u * L;
    const yTop = M.topL(u), yBot = M.botL(u);
    const Y = isPec ? yBot + (yTop - yBot) * (F.v ?? 0.3) : yBot + (F.v ?? 0.04) * (yTop - yBot);
    const len = (F.len || 0.12) * L, wmax = (F.w || 0.04) * L;
    const ang = (F.ang ?? (isPec ? -20 : -60)) * DEG;
    const flap = (F.flap ?? (isPec ? 1 : 0.4)) * Math.sin(P + (isPec ? 1.1 : 2.3));
    const spread = ((F.spread ?? (isPec ? 38 : 22)) + flap * (isPec ? 18 : 8)) * DEG;
    const dX = -Math.cos(ang), dY = Math.sin(ang), pX = -dY, pY = dX;
    const shape = F.shape || 'round';
    const T0 = surf(u, Y);
    const cellI = isPec ? 1 : 2;
    const part = F.opaque ? body : fins;
    const nk = 6;
    for (const side of [1, -1]) {
      if (flat && side < 0 && !F.both) continue;
      const pts = [];
      for (let k = 0; k <= nk; k++) {
        const kf = k / nk;
        let wk;
        if (shape === 'long') wk = Math.min(1, Math.sqrt(kf / 0.3)) * Math.pow(1 - kf, 0.6) * 0.9 + 0.1 * (1 - kf);
        else if (shape === 'fan') wk = Math.min(1, kf / 0.35 + 0.25) * Math.sqrt(Math.max(0, 1 - Math.pow(kf, 6)));
        else if (shape === 'wing') wk = Math.min(1, kf / 0.25 + 0.3) * Math.pow(Math.max(0, 1 - Math.pow(kf, 2.2)), 0.5);
        else wk = Math.min(1, Math.sqrt(kf / 0.45) * 0.85 + 0.15) * Math.sqrt(Math.max(0, 1 - Math.pow(kf, 3)));
        const w = Math.max(0.002 * L, wmax * wk);
        const s = kf * len;
        const row = [];
        for (const qf of [-1, 0, 1]) {
          const q = qf * w;
          const cup = qf === 0 ? 0.18 * w : 0;
          const px = X + s * Math.cos(spread) * dX + q * pX;
          const py = Y + s * Math.cos(spread) * dY + q * pY;
          const pz = side * (T0 * 0.92 + s * Math.sin(spread) + cup);
          row.push({ p: D([px, py, pz]), uv: sk.cell(cellI, kf, (qf + 1) / 2) });
        }
        pts.push(row);
      }
      for (let k = 0; k < nk; k++) for (let r = 0; r < 2; r++) {
        const a = pts[k][r], b = pts[k + 1][r], c2 = pts[k + 1][r + 1], d = pts[k][r + 1];
        if (F.opaque) { part.both(a.p, b.p, c2.p, '#ffffff', a.uv, b.uv, c2.uv); part.both(a.p, c2.p, d.p, '#ffffff', a.uv, c2.uv, d.uv); }
        else part.quad(a.p, b.p, c2.p, d.p, '#ffffff', a.uv, b.uv, c2.uv, d.uv);
      }
    }
  };
  paired(S.pec, 'pec');
  paired(S.pel, 'pel');
  // ---- eyes: small natural glossy domes set into the head
  const eyes3 = [], eyeVox = [];
  if (S.eye) {
    const e = S.eye;
    const list = [[e.u ?? 0.08, e.v ?? 0.62]];
    if (flat && e.second) list.push([(e.u ?? 0.08) + e.second[0], (e.v ?? 0.62) + e.second[1]]);
    for (const [eu, ev] of list) {
      const X = xN - eu * L, Y = M.botL(eu) + (M.topL(eu) - M.botL(eu)) * ev;
      const re = Math.max(0.006 * L, (e.r ?? 0.03) * L);
      let z0 = surf(eu, Y);
      let sides = flat ? [1] : [1, -1];
      if (M.ceph) z0 = M.ceph.w * L * 0.97;
      for (const sd of sides) {
        let n;
        if (M.ceph) n = norm(0.25, 0.1, sd);
        else if (e.top) n = norm(0.15, 0.85, sd * 0.5);
        else if (e.front) n = norm(0.75, 0.1, sd * 0.66);
        else n = norm(0.14, 0.06, sd);
        const bulge = e.bulge ?? 0.42;
        const C = [X, Y, sd * Math.max(0, z0 - re * (1 - bulge) * 0.5)];
        if (e.tube) {
          // barreleye: tubular eyes gazing up, glowing lenses
          const tb = [C[0], C[1], C[2] * 0.6], tt = [C[0] + re * 0.3, C[1] + re * 2.4, C[2] * 0.6];
          tubeInto(body, [tb, tt], () => re * 0.8, 7, rgb01(e.tubeCol || '#1a3a2a'), D);
          ellInto(glow, tt, [re * 0.8, re * 0.35, re * 0.8], 8, 4, rgb01(e.lens || '#3aff8a'), D);
          eyes3.push({ p: tt, r: re, sd });
          continue;
        }
        const t1 = norm(...cross([0, 1, 0], n)), t2 = cross(n, t1);
        const fwd = sd > 0 ? 1 : -1;
        const ring = (rk, hk) => Array.from({ length: 12 }, (_, j) => {
          const a = (j / 12) * TAU;
          const ca = Math.cos(a) * fwd, sa = Math.sin(a);
          return { p: D([C[0] + (t1[0] * ca + t2[0] * sa) * re * rk + n[0] * re * hk, C[1] + (t1[1] * ca + t2[1] * sa) * re * rk + n[1] * re * hk, C[2] + (t1[2] * ca + t2[2] * sa) * re * rk + n[2] * re * hk]), uv: sk.cell(0, 0.5 + Math.cos(a) * 0.5 * rk, 0.5 - Math.sin(a) * 0.5 * rk) };
        });
        const r0 = ring(1, -0.12), r1 = ring(0.62, 0.3);
        const apex = { p: D([C[0] + n[0] * re * 0.44, C[1] + n[1] * re * 0.44, C[2] + n[2] * re * 0.44]), uv: sk.cell(0, 0.5, 0.5) };
        for (let j = 0; j < 12; j++) {
          const j2 = (j + 1) % 12;
          const A = [r0[j], r0[j2], r1[j2], r1[j]];
          if (sd > 0) { eyes.quad(A[0].p, A[1].p, A[2].p, A[3].p, '#ffffff', A[0].uv, A[1].uv, A[2].uv, A[3].uv); eyes.tri(r1[j].p, r1[j2].p, apex.p, '#ffffff', r1[j].uv, r1[j2].uv, apex.uv); }
          else { eyes.quad(A[0].p, A[3].p, A[2].p, A[1].p, '#ffffff', A[0].uv, A[3].uv, A[2].uv, A[1].uv); eyes.tri(r1[j].p, apex.p, r1[j2].p, '#ffffff', r1[j].uv, apex.uv, r1[j2].uv); }
        }
        if (e.glow || e.type === 'glow') ellInto(glow, [C[0] + n[0] * re * 0.5, C[1], C[2] + n[2] * re * 0.5], [re * 0.4, re * 0.4, re * 0.4], 6, 4, rgb01(e.glowCol || '#9ffcff'), D);
        if (sd > 0) eyes3.push({ p: [C[0] + n[0] * re * 0.4, C[1], C[2] + n[2] * re * 0.4], r: re, sd });
        eyeVox.push({ c: D([C[0] + n[0] * re * 0.3, C[1] + n[1] * re * 0.3, C[2] + n[2] * re * 0.3]), n, r: re, iris: e.iris || '#c8a050', pupil: e.pupil, glow: e.glow || e.type === 'glow' ? e.glowCol || '#9ffcff' : null });
      }
    }
  }
  // ---- barbels (whiskers)
  for (const b of S.barbels || []) {
    const X = xN - b.u * L;
    const Y = b.top ? M.topL(b.u) : M.botL(b.u) + (M.topL(b.u) - M.botL(b.u)) * (b.v ?? 0.15);
    const T0 = b.mid ? 0 : surf(b.u, Y);
    const len = b.len * L;
    const a0 = (b.ang ?? -60) * DEG, curl = (b.curl ?? 0.6) * (1 + 0.25 * Math.sin(P + b.u * 9));
    const col = rgb01(b.col || S.col.flank), tip = b.tip ? rgb01(b.tip) : col;
    const outZ = b.mid ? 0 : (b.out ?? 0.35);
    for (const side of b.mid ? [0] : [1, -1]) {
      const pts = [];
      let px = X, py = Y, pz = side * (T0 + 0.002 * L), a = a0;
      const n = 7;
      pts.push(jaw([px, py, pz]));
      for (let k = 1; k <= n; k++) {
        const ds = len / n;
        a += (curl / n) * (b.ang > 0 ? -1 : 1) * (b.fwd ? -1 : 1);
        px += Math.cos(a) * ds * (b.fwd ? 1 : -1);
        py -= Math.sin(a) * ds;
        pz += side * outZ * ds * (1 - k / n);
        pts.push(jaw([px, py, pz]));
      }
      const rad = (t) => Math.max(0.0025 * L, (b.w ? 0.009 : 0.006) * L * (1 - 0.7 * t));
      tubeInto(b.glow ? glow : body, pts, rad, 5, (t) => (t > 0.85 ? tip : col), D, W);
      if (b.bulb) ellInto(b.glowTip ? glow : body, pts[n], [b.bulb * L, b.bulb * L, b.bulb * L], 7, 5, tip, D, W);
    }
  }
  // ---- angler lure: illicium rod + glowing esca
  let lureTip = null;
  if (S.lure) {
    const lu = S.lure;
    const X = xN - lu.u * L, Y = M.topL(lu.u);
    const len = lu.len * L;
    let px = X, py = Y, a = (lu.ang ?? 60) * DEG;
    const sway = 0.12 * Math.sin(P);
    const n = 8, pts = [[px, py, 0]];
    for (let k = 1; k <= n; k++) {
      a -= (lu.curve ?? 1.4) / n;
      px += Math.cos(a + sway) * len / n; py += Math.sin(a + sway) * len / n;
      pts.push([px, py, 0]);
    }
    tubeInto(body, pts, (t) => Math.max(0.003 * L, 0.009 * L * (1 - 0.6 * t)), 5, rgb01(lu.rod || S.col.back), D, W);
    const R = Math.max(0.008 * L, lu.bulb * L);
    ellInto(glow, [px, py, 0], [R, R, R], 9, 6, rgb01(lu.col || '#bff8ff'), D, W);
    if (lu.filaments) for (let k = 0; k < lu.filaments; k++) {
      const fa = -0.6 + (k / Math.max(1, lu.filaments - 1)) * 2.4;
      tubeInto(glow, [[px, py, 0], [px + Math.cos(fa) * R * 1.5, py + Math.sin(fa) * R * 1.5, 0]], (t) => 0.0035 * L * (1 - 0.6 * t), 4, rgb01(lu.col || '#bff8ff'), D, W);
    }
    lureTip = [px, py, 0];
  }
  // ---- teeth: fangs along the jaws
  if (S.mouth?.teeth && mouth) {
    const tt = S.mouth.teeth, n = tt.n ?? 6, mu = mouth.u;
    const tc = rgb01(tt.col || '#f4f8ff');
    for (let k = 0; k < n; k++) {
      const u = 0.012 + (mu - 0.02) * (k / Math.max(1, n - 1));
      const X = xN - u * L;
      const Y = mouthY(u);
      const tl = (tt.len ?? 0.03) * L * (k % 2 ? 0.6 : 1) * (1 - 0.4 * (k / n));
      const up = k % 2 === 0 ? 1 : -1;
      const z = surf(u, Y) * (tt.out ?? 0.8);
      const w = Math.max(0.004 * L, tl * 0.28);
      for (const sd of [1, -1]) {
        const base = [[X - w, Y + up * 0.002 * L, sd * z], [X + w, Y + up * 0.002 * L, sd * z], [X, Y + up * 0.002 * L, sd * (z - w)]];
        const tip = [X, Y - up * tl, sd * z * 0.95];
        const fix = (p) => D(up < 0 ? jaw(p) : p);
        const bb = base.map(fix), tp = fix(tip);
        part3(body, bb, tp, tc, W);
      }
    }
  }
  // ---- puffer spines (inflated)
  const spK = S.spines ? Math.max(infl, S.spines.always ? 0.6 : 0) : 0;
  if (spK > 0.05) {
    const sl = S.spines.len * L * spK;
    const sc = rgb01(S.spines.col || '#f0e8d0');
    for (let i = 3; i < rings.length - 3; i++) {
      const u = US[i];
      if (u > 0.85) continue;
      for (let j = (i & 1); j < NV; j += 2) {
        const v = rings[i][j];
        const q = v.p;
        const yc = (M.topL(u) + M.botL(u)) / 2;
        const n = norm(0.15, q[1] - yc, q[2] - (rings[i][0].p[2] + rings[i][NV >> 1].p[2]) / 2);
        const w = sl * 0.22;
        const t1 = norm(...cross(n, [1, 0, 0]));
        const t2 = cross(n, t1);
        const b0 = [q[0] + t1[0] * w, q[1] + t1[1] * w, q[2] + t1[2] * w], b1 = [q[0] + t2[0] * w, q[1] + t2[1] * w, q[2] + t2[2] * w], b2 = [q[0] - t1[0] * w, q[1] - t1[1] * w, q[2] - t1[2] * w];
        part3(body, [b0, b1, b2], [q[0] + n[0] * sl, q[1] + n[1] * sl, q[2] + n[2] * sl], sc, W);
      }
    }
  }
  // ---- glass body with an opaque core (glassfish skeleton): a spine rod
  if ((mat.glass || S.glassCore) && (S.glassCore?.spineV ?? 0.55) > 0 && (S.glassCore?.spineV ?? 0.55) < 1) {
    const g = S.glassCore || {};
    const pts = [];
    for (let k = 0; k <= 8; k++) {
      const u = (g.u0 ?? 0.15) + ((g.u1 ?? 0.97) - (g.u0 ?? 0.15)) * (k / 8);
      pts.push([xN - u * L, M.botL(u) + (M.topL(u) - M.botL(u)) * (g.spineV ?? 0.55), 0]);
    }
    tubeInto(body, pts, () => 0.012 * L, 5, rgb01(g.bone || '#e8f0f4'), D, W);
  }
  // ---- anchors (model space, posed)
  const midU = 0.45;
  const mY = mouth ? mTipY : (M.topL(0) + M.botL(0)) / 2;
  const anchors = {
    mouth: D([xN + (M.bill ? M.bill.len * L * 0.6 : 0), mY, 0]),
    top: D([xN - 0.4 * L, M.topL(0.4) + 0.02 * L, 0]),
    bottom: D([xN - midU * L, M.botL(midU) - 0.01 * L, 0]),
    tail: D([M.xmin + 0.02 * L, (M.topL(1) + M.botL(1)) / 2, 0]),
  };
  if (lureTip) anchors.lure = D(lureTip);
  const eyeA = eyes3.map((e) => ({ p: D(e.p), r: e.r }));
  const parts = [];
  if (!bodyPart.empty && bodyPart !== body) parts.push({ key: 'glass', mb: bodyPart.mb, texture: sk.cv, ...mat.body, alpha: 0.5, env: 0.55, cull: false, depthWrite: false });
  if (!body.empty) parts.unshift({ key: 'body', mb: body.mb, texture: sk.cv, emitTex: true, ...mat.body });
  if (!eyes.empty) parts.push({ key: 'eyes', mb: eyes.mb, texture: sk.cv, spec: 1.1, shine: 90, env: 0.35, rim: 0.05, ambient: 0.6 });
  if (!glow.empty) parts.push({ key: 'glow', mb: glow.mb, emit: 1, spec: 0.6, shine: 40 });
  if (!fins.empty) parts.push({ key: 'fins', mb: fins.mb, texture: sk.cv, ...mat.fins });
  // glass bodies: draw the see-through skin last
  parts.sort((a, b) => (a.key === 'glass') - (b.key === 'glass'));
  return { parts, anchors, eyes: eyeA, eyeVox, L, flatRoll: flat ? (flat.roll || 0) : 0, white: W };
}

// 3D eel for scenes (fishMesh of a chain species): the low-poly head + a faceted body tube that undulates.
function buildEel3D(c, sw, frames) {
  const head = buildFish(c, 0, 0, 0, true);
  const ph = sw / frames;
  const r = c.chain?.r || 4, segs = c.chain?.segs || 14;
  const len = segs * r * 1.25, N = 18, sides = 8;
  const g = c.real?.seg || {};
  const top = rgb01(g.top || c.real?.col?.back || '#666666'), side = rgb01(g.side || c.real?.col?.flank || '#888888'), bel = rgb01(g.belly || c.real?.col?.belly || '#dddddd');
  const c2 = g.col2 ? rgb01(g.col2) : null, finC = rgb01(g.fin || c.real?.col?.fin || '#888888');
  const body = new Part(), fins = new Part();
  const rad = (t) => r * (1.05 - 0.75 * Math.pow(t, 1.3));
  const P = (t) => [-t * len, 0, Math.sin(TAU * ph - t * 7.5) * r * 1.6 * Math.min(1, t * 3)];
  const rings = [];
  for (let k = 0; k <= N; k++) {
    const t = k / N, p = P(t), q = P(Math.min(1, t + 0.01)), q0 = P(Math.max(0, t - 0.01));
    const tx = q[0] - q0[0], tz = q[2] - q0[2], tl = Math.hypot(tx, tz) || 1;
    const nx = -tz / tl, nz = tx / tl; // horizontal normal (side direction)
    const rr = rad(t);
    rings.push(Array.from({ length: sides }, (_, j) => { const a = (j / sides) * TAU; return [p[0] + nx * Math.sin(a) * rr, p[1] + Math.cos(a) * rr, p[2] + nz * Math.sin(a) * rr]; }));
  }
  for (let k = 0; k < N; k++) for (let j = 0; j < sides; j++) {
    const j2 = (j + 1) % sides, ny = Math.cos(((j + 0.5) / sides) * TAU);
    let col = ny > 0.45 ? top : ny < -0.5 ? bel : side;
    if (c2 && g.pattern === 'stripes' && (Math.abs(ny - 0.62) < 0.2 || Math.abs(ny + 0.1) < 0.18)) col = c2;
    else if (c2 && (g.pattern === 'spots' || g.pattern === 'dots') && hash2(k, j, 7) > 0.75 && ny > -0.3) col = c2;
    const a = rings[k][j], b = rings[k][j2], cc = rings[k + 1][j2], d = rings[k + 1][j];
    body.quad(a, d, cc, b, toneRGB(col, (hash2(k * 3, j, 5) - 0.5) * 0.05));
  }
  const end = P(1);
  for (let j = 0; j < sides; j++) body.tri(rings[N][j], rings[N][(j + 1) % sides], [end[0] - r * 0.4, end[1], end[2]], side);
  // dorsal ridge along the back
  if (c.real) for (let k = 1; k < N; k++) {
    const a = P(k / N), b = P((k + 1) / N), ha = rad(k / N), hb = rad((k + 1) / N);
    fins.quad([a[0], ha * 0.8, a[2]], [b[0], hb * 0.8, b[2]], [b[0], hb * 1.6, b[2]], [a[0], ha * 1.6, a[2]], finC);
  }
  const parts = head.parts.slice();
  parts.push({ key: 'eelbody', mb: body.mb, spec: 0.55, shine: 28, env: 0.45, iri: 0.12, rim: 0.35, ambient: 0.45 });
  if (!fins.empty) parts.push({ key: 'fins', mb: fins.mb, alpha: 0.6, spec: 0.4, cull: false });
  // merge the ridge into the head's fin part when both exist (one translucent part)
  const fi = parts.findIndex((q) => q.key === 'fins');
  let fj = -1; parts.forEach((q, i) => { if (q.key === 'fins') fj = i; });
  if (fi !== fj) {
    const A = parts[fi], B = parts[fj];
    const v = B.mb.v; for (let i = 0; i < v.length; i += 33) A.mb.tri([v[i], v[i + 1], v[i + 2]], [v[i + 11], v[i + 12], v[i + 13]], [v[i + 22], v[i + 23], v[i + 24]], [v[i + 6], v[i + 7], v[i + 8]], A.texture ? head.white : undefined, A.texture ? head.white : undefined, A.texture ? head.white : undefined);
    parts.splice(fj, 1);
  }
  return { ...head, parts, L: c.L + len };
}

// small helpers that emit vertex-coloured geometry through deform D
function part3(part, base, tip, col, W) {
  part.tri(base[0], base[1], tip, col, W, W, W);
  part.tri(base[1], base[2], tip, col, W, W, W);
  part.tri(base[2], base[0], tip, col, W, W, W);
  part.tri(base[0], base[2], base[1], col, W, W, W);
}

function tubeInto(part, pts, rad, sides, col, D = null, W = [0, 0]) {
  const n = pts.length;
  if (n < 2) return;
  const rings = [];
  let prevN = null;
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    const t = norm(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    let nn;
    if (prevN) { const d = prevN[0] * t[0] + prevN[1] * t[1] + prevN[2] * t[2]; nn = norm(prevN[0] - d * t[0], prevN[1] - d * t[1], prevN[2] - d * t[2]); }
    else { const up = Math.abs(t[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]; const d = up[0] * t[0] + up[1] * t[1] + up[2] * t[2]; nn = norm(up[0] - d * t[0], up[1] - d * t[1], up[2] - d * t[2]); }
    prevN = nn;
    const bb = cross(t, nn);
    const r = rad(i / (n - 1));
    const ring = [];
    for (let s = 0; s < sides; s++) {
      const a2 = (s / sides) * TAU, ca = Math.cos(a2) * r, sa = Math.sin(a2) * r;
      const p = [pts[i][0] + nn[0] * ca + bb[0] * sa, pts[i][1] + nn[1] * ca + bb[1] * sa, pts[i][2] + nn[2] * ca + bb[2] * sa];
      ring.push(D ? D(p) : p);
    }
    rings.push(ring);
  }
  const cf = (t) => (typeof col === 'function' ? col(t) : col);
  for (let i = 0; i < n - 1; i++) {
    const k = cf((i + 0.5) / (n - 1));
    for (let s = 0; s < sides; s++) {
      const s2 = (s + 1) % sides;
      part.quad(rings[i][s], rings[i][s2], rings[i + 1][s2], rings[i + 1][s], k, W, W, W, W);
    }
  }
  const c0 = D ? D(pts[0]) : pts[0], c1 = D ? D(pts[n - 1]) : pts[n - 1];
  for (let s = 0; s < sides; s++) {
    const s2 = (s + 1) % sides;
    part.tri(c0, rings[0][s2], rings[0][s], cf(0), W, W, W);
    part.tri(c1, rings[n - 1][s], rings[n - 1][s2], cf(1), W, W, W);
  }
}

function ellInto(part, c, r, seg, rings, col, D = null, W = [0, 0]) {
  const P = (i, j) => {
    const th = (i / rings) * Math.PI, ph = (j / seg) * TAU;
    const p = [c[0] + Math.sin(th) * Math.cos(ph) * r[0], c[1] + Math.cos(th) * r[1], c[2] + Math.sin(th) * Math.sin(ph) * r[2]];
    return D ? D(p) : p;
  };
  const V = [];
  for (let i = 0; i <= rings; i++) { const row = []; for (let j = 0; j <= seg; j++) row.push(P(i, j)); V.push(row); }
  for (let i = 0; i < rings; i++) for (let j = 0; j < seg; j++) {
    const k = typeof col === 'function' ? col(i, j) : col;
    if (i > 0) part.tri(V[i][j], V[i][j + 1], V[i + 1][j + 1], k, W, W, W);
    if (i < rings - 1) part.tri(V[i][j], V[i + 1][j + 1], V[i + 1][j], k, W, W, W);
  }
}

// ------------------------------------------------------------------------------------------------ solid plan

const R_FIN = 1, R_EYE = 2, R_SPEC = 6, R_GLASS = 7;
const QV = [0, 0, 0, 1];

function buildSolid(c, ph) {
  const sp = solidPose(c, ph);
  const L = c.real.size ?? (c.real.kind === 'seahorse' ? Math.max(c.L, c.H) : c.L);
  const prims = sp.sol.prims;
  const body = new Part(), glass = new Part(), fins = new Part(), eyes = new Part(), glow = new Part();
  // facets about one voxel across (the voxeliser samples one flat colour per triangle: fine facets = fine detail)
  const vs = VOXEL ? voxelSize(c, { L }) : L / 40;
  const vk = 30 / L;
  const colorOf = (p, Q, x, y, z) => {
    let col = typeof p.col === 'function' ? p.col(Q, x, y, z, Math.floor(x * vk), Math.floor(y * vk), Math.floor(z * vk)) : p.col;
    if (col === null || col === undefined) return null;
    const role = typeof p.roleAt === 'function' ? p.roleAt(Q) : p.role ?? 0;
    const gl = typeof p.glow === 'function' ? p.glow(Q) : !!p.glow;
    return { rgb: unpack(col), role, glow: gl };
  };
  const route = (o) => (o.glow ? glow : o.role === R_GLASS ? glass : o.role === R_FIN ? fins : o.role === R_EYE || o.role === R_SPEC ? eyes : body);
  // (voxels: one side is enough, the voxeliser only samples the surface)
  const emit = (o, a, b, cc, twoSided) => { const pt = route(o); if (!VOXEL && (twoSided || pt === glass || pt === fins)) pt.both(a, b, cc, o.rgb); else pt.tri(a, b, cc, o.rgb); };
  // group capsule chains (tubes share point arrays) into continuous tubes
  const used = new Set();
  for (let pi = 0; pi < prims.length; pi++) {
    const p = prims[pi];
    if (used.has(pi)) continue;
    if (p.t === 0) { tessEll(p, L, colorOf, emit, vs); continue; }
    const chain = [p];
    used.add(pi);
    for (let q = pi + 1; q < prims.length; q++) {
      const nq = prims[q], last = chain[chain.length - 1];
      if (nq.t === 1 && nq.a === last.b && nq.col === last.col) { chain.push(nq); used.add(q); } else break;
    }
    tessTube(chain, L, colorOf, emit, vs);
  }
  const A = sp.anchors || {};
  const anchors = {};
  for (const [k, v] of Object.entries(A)) anchors[k] = [v[0], v[1], v[2] || 0];
  const eyesA = (sp.eyes || []).map((e) => ({ p: [e[0], e[1], e[2] || 0], r: e[3] || 0.03 * L }));
  const parts = [];
  if (!body.empty) parts.push({ key: 'body', mb: body.mb, spec: 0.5, shine: 34, env: 0.42, iri: 0.08, rim: 0.3, ambient: 0.48 });
  if (!eyes.empty) parts.push({ key: 'eyes', mb: eyes.mb, spec: 1.1, shine: 90, env: 0.35, rim: 0.05, ambient: 0.6 });
  if (!glow.empty) parts.push({ key: 'glow', mb: glow.mb, emit: 0.55, alpha: 0.85, spec: 0.8, shine: 50, env: 0.3, cull: false });
  if (!fins.empty) parts.push({ key: 'fins', mb: fins.mb, alpha: sp.finAlpha ?? 0.7, spec: 0.5, shine: 40, env: 0.2, cull: false });
  if (!glass.empty) parts.push({ key: 'glass', mb: glass.mb, alpha: sp.glassAlpha ?? 0.58, spec: 0.9, shine: 60, env: 0.6, iri: 0.3, rim: 0.7, cull: false, depthWrite: false });
  return { parts, anchors, eyes: eyesA, L, flatRoll: sp.roll || 0, yawBase: sp.yawBase || 0 };
}

const spow = (v, e) => (v < 0 ? -Math.pow(-v, e) : Math.pow(v, e));
// Ellipsoid (or superellipsoid: p.sq = [e horizontal, e vertical], < 1 boxier) tessellated so that facets are about
// one voxel (vs) across; p.warp(q) -> q bends the unit shape before it is scaled / rotated into place.
function tessEll(p, L, colorOf, emit, vs = L / 40) {
  const rmax = Math.max(p.r[0], p.r[1], p.r[2]);
  const isEye = p.role === R_EYE;
  const seg = clamp(Math.round((TAU * rmax) / (2.4 * vs)), isEye ? 12 : rmax < 1.5 * vs ? 6 : 8, 56), rings = Math.max(isEye ? 8 : rmax < 1.5 * vs ? 3 : 4, Math.round(seg * 0.5));
  const ax = p.axes || [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const det = ax[0][0] * (ax[1][1] * ax[2][2] - ax[1][2] * ax[2][1]) - ax[0][1] * (ax[1][0] * ax[2][2] - ax[1][2] * ax[2][0]) + ax[0][2] * (ax[1][0] * ax[2][1] - ax[1][1] * ax[2][0]);
  const flip = det < 0;
  const cu = p.cut;
  const shell = !!p.shell;
  const sq = p.sq, warp = p.warp;
  const qOf = (i, j) => {
    const th = (i / rings) * Math.PI, ph = (j / seg) * TAU;
    if (sq) {
      const st = Math.sin(th), ct = Math.cos(th), e1 = sq[1] ?? 1, e2 = sq[0] ?? 1;
      return [spow(st, e1) * spow(Math.cos(ph), e2), spow(ct, e1), spow(st, e1) * spow(Math.sin(ph), e2)];
    }
    return [Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph)];
  };
  const out = (q) => cu && ((cu.x0 != null && q[0] < cu.x0 - 1e-6) || (cu.x1 != null && q[0] > cu.x1 + 1e-6) || (cu.y0 != null && q[1] < cu.y0 - 1e-6) || (cu.y1 != null && q[1] > cu.y1 + 1e-6) || (cu.z0 != null && q[2] < cu.z0 - 1e-6) || (cu.z1 != null && q[2] > cu.z1 + 1e-6));
  const clampQ = (q) => {
    if (!cu) return q;
    return [clamp(q[0], cu.x0 ?? -2, cu.x1 ?? 2), clamp(q[1], cu.y0 ?? -2, cu.y1 ?? 2), clamp(q[2], cu.z0 ?? -2, cu.z1 ?? 2)];
  };
  const W = (q0) => {
    const q = warp ? warp(q0) : q0;
    return [
      p.c[0] + ax[0][0] * q[0] * p.r[0] + ax[1][0] * q[1] * p.r[1] + ax[2][0] * q[2] * p.r[2],
      p.c[1] + ax[0][1] * q[0] * p.r[0] + ax[1][1] * q[1] * p.r[1] + ax[2][1] * q[2] * p.r[2],
      p.c[2] + ax[0][2] * q[0] * p.r[0] + ax[1][2] * q[1] * p.r[1] + ax[2][2] * q[2] * p.r[2],
    ];
  };
  const face = (qa, qb, qc) => {
    if (shell && out(qa) && out(qb) && out(qc)) return;
    const ca = clampQ(qa), cb = clampQ(qb), cc = clampQ(qc);
    const m = norm(ca[0] + cb[0] + cc[0], ca[1] + cb[1] + cc[1], ca[2] + cb[2] + cc[2]);
    QV[0] = m[0]; QV[1] = m[1]; QV[2] = m[2]; QV[3] = 1;
    const wa = W(ca), wb = W(cb), wc = W(cc);
    const cx = (wa[0] + wb[0] + wc[0]) / 3, cy = (wa[1] + wb[1] + wc[1]) / 3, cz = (wa[2] + wb[2] + wc[2]) / 3;
    const o = colorOf(p, QV, cx, cy, cz);
    if (!o) return;
    if (flip) emit(o, wa, wc, wb, shell); else emit(o, wa, wb, wc, shell);
  };
  const Q = [];
  for (let i = 0; i <= rings; i++) { const row = []; for (let j = 0; j <= seg; j++) row.push(qOf(i, j)); Q.push(row); }
  for (let i = 0; i < rings; i++) for (let j = 0; j < seg; j++) {
    const a = Q[i][j], b = Q[i][j + 1], d = Q[i + 1][j], e = Q[i + 1][j + 1];
    if (i > 0) face(a, b, e);
    if (i < rings - 1) face(a, e, d);
  }
}

// Capsule chain -> one continuous tube: rings every ~voxel along the axis, sides about one voxel wide, rounded
// (hemispherical) ends. Colour functions get Q = [t within the capsule, 1, t along the whole tube, dy].
function tessTube(chain, L, colorOf, emit, vs = L / 40) {
  const P0 = [chain[0].a, ...chain.map((p) => p.b)];
  const R0 = [chain[0].ra, ...chain.map((p) => p.rb)];
  const rmax = Math.max(...R0);
  const sides = clamp(Math.round((TAU * rmax) / (2.4 * vs)), 6, 28);
  // refined samples: {p, r, pr (capsule), t (within capsule), k (along the tube)}
  const S = [];
  for (let i = 0; i < chain.length; i++) {
    const pr = chain[i], a = P0[i], b = P0[i + 1];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const n = clamp(Math.ceil(len / (2.4 * vs)), 1, 16);
    const k0 = pr.k0 ?? i / chain.length, k1 = pr.k1 ?? (i + 1) / chain.length;
    for (let s = i ? 1 : 0; s <= n; s++) {
      const t = s / n;
      S.push({ p: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t], r: Math.max(0.003 * L, R0[i] + (R0[i + 1] - R0[i]) * t), pr, t, k: k0 + (k1 - k0) * t });
    }
  }
  const n = S.length;
  let prevN = null;
  const rings = [], tans = [];
  for (let i = 0; i < n; i++) {
    const a = S[Math.max(0, i - 1)].p, b = S[Math.min(n - 1, i + 1)].p;
    const t = norm(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    let nn;
    if (prevN) { const d = prevN[0] * t[0] + prevN[1] * t[1] + prevN[2] * t[2]; nn = norm(prevN[0] - d * t[0], prevN[1] - d * t[1], prevN[2] - d * t[2]); }
    else { const up = Math.abs(t[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]; const d = up[0] * t[0] + up[1] * t[1] + up[2] * t[2]; nn = norm(up[0] - d * t[0], up[1] - d * t[1], up[2] - d * t[2]); }
    prevN = nn;
    const bb = cross(t, nn);
    const r = S[i].r, c0 = S[i].p;
    const ring = [];
    for (let s = 0; s < sides; s++) {
      const a2 = (s / sides) * TAU, ca = Math.cos(a2), sa = Math.sin(a2);
      const dir = [nn[0] * ca + bb[0] * sa, nn[1] * ca + bb[1] * sa, nn[2] * ca + bb[2] * sa];
      ring.push({ p: [c0[0] + dir[0] * r, c0[1] + dir[1] * r, c0[2] + dir[2] * r], dir });
    }
    rings.push(ring);
    tans.push(t);
  }
  const col = (sm, t, k, dy, x, y, z) => { QV[0] = t; QV[1] = 1; QV[2] = k; QV[3] = dy; return colorOf(sm.pr, QV, x, y, z); };
  for (let i = 0; i < n - 1; i++) {
    const A = S[i], B = S[i + 1];
    const pr = B.pr, tm = B.pr === A.pr ? (A.t + B.t) / 2 : B.t / 2, km = (A.k + B.k) / 2;
    for (let s = 0; s < sides; s++) {
      const s2 = (s + 1) % sides;
      const a = rings[i][s], b = rings[i][s2], c = rings[i + 1][s2], d = rings[i + 1][s];
      const o = col({ pr }, tm, km, (a.dir[1] + b.dir[1]) / 2, (a.p[0] + c.p[0]) / 2, (a.p[1] + c.p[1]) / 2, (a.p[2] + c.p[2]) / 2);
      if (!o) continue;
      emit(o, a.p, b.p, c.p); emit(o, a.p, c.p, d.p);
    }
  }
  // hemispherical ends
  for (const [i, sg] of [[0, -1], [n - 1, 1]]) {
    const t = tans[i], sm = S[i], r = sm.r, c0 = sm.p;
    const NR = clamp(Math.round((r * 1.6) / vs), 1, 6);
    let prev = rings[i].map((q) => q.p);
    for (let k = 1; k <= NR; k++) {
      const a = (k / NR) * Math.PI * 0.5, cr = Math.cos(a), sr = Math.sin(a);
      const ring = k === NR ? null : rings[i].map((q) => [c0[0] + q.dir[0] * r * cr + t[0] * sg * r * sr, c0[1] + q.dir[1] * r * cr + t[1] * sg * r * sr, c0[2] + q.dir[2] * r * cr + t[2] * sg * r * sr]);
      const tip = [c0[0] + t[0] * sg * r, c0[1] + t[1] * sg * r, c0[2] + t[2] * sg * r];
      for (let s = 0; s < sides; s++) {
        const s2 = (s + 1) % sides;
        const pa = prev[s], pb = prev[s2];
        const o = col(sm, i ? 1 : 0, sm.k, (rings[i][s].dir[1] * cr + t[1] * sg * sr), pa[0], pa[1], pa[2]);
        if (!o) continue;
        if (ring) {
          const qa = ring[s], qb = ring[s2];
          if (sg < 0) { emit(o, pa, qb, pb); emit(o, pa, qa, qb); } else { emit(o, pa, pb, qb); emit(o, pa, qb, qa); }
        } else if (sg < 0) emit(o, tip, pb, pa); else emit(o, tip, pa, pb);
      }
      if (ring) prev = ring;
    }
  }
}

// ------------------------------------------------------------------------------------------------ creatures

// Non-species creatures (far giants, 3D scenes): realistic anatomy specs in the same body plans.
const CREATURES = {
  dolphin: {
    L: 60, spec: {
      base: 'porpoise',
      body: { top: [[0, 0.004], [0.03, 0.018], [0.07, 0.026], [0.1, 0.05], [0.16, 0.085], [0.3, 0.11], [0.5, 0.1], [0.72, 0.06], [0.9, 0.03], [1, 0.02]], bot: [[0, -0.006], [0.05, -0.018], [0.1, -0.04], [0.2, -0.075], [0.38, -0.1], [0.6, -0.075], [0.85, -0.035], [1, -0.02]], wid: [[0, 0.01], [0.08, 0.04], [0.3, 0.095], [0.6, 0.075], [0.9, 0.03], [1, 0.02]], nose: 0.02, xs: 2.1, wy: 0.45 },
      eye: { u: 0.13, v: 0.42, r: 0.012, iris: '#2a2a30', pupil: 0.75 },
      mouth: { u: 0.1, v: 0.4, drop: -0.004, curve: -0.008, dark: 0.3 },
      fins: [{ at: 'top', from: 0.42, to: 0.56, h: 0.12, shape: 'sickle', rake: 0.9, rays: 1, thick: 0.012 }],
      pec: { u: 0.24, v: 0.3, len: 0.13, w: 0.04, ang: -35, spread: 30, shape: 'wing', rays: 1, opaque: true, flap: 0.3 },
      flukes: { len: 0.13, span: 0.13 },
      vbend: 0.07,
      col: { back: '#3a6ea8', flank: '#6aa6dc', belly: '#eef8ff', fin: '#34629a', vb: 0.5, vbel: 0.34, soft: 0.1 },
      mat: { iri: 0.15, gloss: 1, sheen: 1 },
    },
  },
  whale: {
    L: 200, spec: {
      base: 'porpoise',
      body: { top: [[0, 0.01], [0.04, 0.04], [0.12, 0.07], [0.3, 0.1], [0.5, 0.1], [0.7, 0.07], [0.88, 0.035], [1, 0.02]], bot: [[0, -0.01], [0.06, -0.05], [0.2, -0.1], [0.38, -0.11], [0.6, -0.08], [0.85, -0.035], [1, -0.02]], wid: [[0, 0.03], [0.1, 0.07], [0.35, 0.1], [0.7, 0.07], [1, 0.02]], nose: 0.03, xs: 2.1, wy: 0.42 },
      eye: { u: 0.17, v: 0.36, r: 0.008, iris: '#2a2a30' },
      mouth: { u: 0.2, v: 0.42, drop: -0.02, curve: -0.02, dark: 0.35 },
      fins: [{ at: 'top', from: 0.62, to: 0.67, h: 0.025, shape: 'tri', rake: 0.6, rays: 1, thick: 0.008 }],
      pec: { u: 0.3, v: 0.2, len: 0.32, w: 0.035, ang: -40, spread: 34, shape: 'long', rays: 1, opaque: true, flap: 0.25, col: '#d4dae4' },
      flukes: { len: 0.12, span: 0.16, col: '#2e3c54' },
      vbend: 0.05,
      col: { back: '#34445e', flank: '#4a5c7c', belly: '#c4ccd8', fin: '#3a4a66', vb: 0.45, vbel: 0.3, soft: 0.06 },
      pat: [{ type: 'lines', color: '#9aa4b8', vmax: 0.3, umax: 0.55, freq: 60, width: 0.25, slope: 0 }, { type: 'spots', color: '#d8d2c2', size: 0.008, density: 0.3, umax: 0.2, vmin: 0.55, seed: 4 }],
      mat: { iri: 0.05, gloss: 0.85 },
    },
  },
  beluga: {
    L: 110, spec: {
      base: 'porpoise',
      body: { top: [[0, 0.02], [0.04, 0.07], [0.1, 0.11], [0.2, 0.11], [0.35, 0.12], [0.55, 0.11], [0.8, 0.05], [1, 0.022]], bot: [[0, -0.02], [0.06, -0.06], [0.2, -0.1], [0.4, -0.12], [0.65, -0.08], [1, -0.022]], wid: [[0, 0.05], [0.12, 0.09], [0.4, 0.12], [0.75, 0.07], [1, 0.02]], nose: 0.06, xs: 2.2, wy: 0.45 },
      eye: { u: 0.14, v: 0.45, r: 0.011, iris: '#2a2a30' },
      mouth: { u: 0.08, v: 0.32, drop: 0, curve: -0.01, dark: 0.2 },
      fins: [],
      pec: { u: 0.24, v: 0.25, len: 0.12, w: 0.05, ang: -35, spread: 30, shape: 'fan', rays: 1, opaque: true, flap: 0.3, col: '#ccdde8' },
      flukes: { len: 0.12, span: 0.12, col: '#ccdce6' },
      vbend: 0.06,
      col: { back: '#d4e2ea', flank: '#e6f0f6', belly: '#f6fbff', fin: '#c6d8e4', vb: 0.6, vbel: 0.35, soft: 0.1 },
      mat: { iri: 0.2, gloss: 1 },
    },
  },
  orca: {
    L: 120, spec: {
      base: 'porpoise',
      body: { top: [[0, 0.01], [0.05, 0.045], [0.14, 0.08], [0.32, 0.11], [0.52, 0.105], [0.75, 0.06], [1, 0.022]], bot: [[0, -0.01], [0.06, -0.04], [0.2, -0.09], [0.4, -0.11], [0.65, -0.075], [1, -0.022]], wid: [[0, 0.03], [0.12, 0.08], [0.38, 0.11], [0.75, 0.06], [1, 0.02]], nose: 0.04, xs: 2.1, wy: 0.45 },
      eye: { u: 0.14, v: 0.5, r: 0.009, iris: '#2a2a30' },
      fins: [{ at: 'top', from: 0.4, to: 0.52, h: 0.2, shape: 'tri', rake: 0.25, rays: 1, thick: 0.012 }],
      pec: { u: 0.24, v: 0.22, len: 0.13, w: 0.06, ang: -40, spread: 32, shape: 'fan', rays: 1, opaque: true, flap: 0.3, col: '#141820' },
      flukes: { len: 0.12, span: 0.13, col: '#141820' },
      vbend: 0.06,
      col: { back: '#141820', flank: '#1a1e28', belly: '#f4f8fc', fin: '#141820', vb: 0.42, vbel: 0.38, soft: 0.03 },
      pat: [{ type: 'blotch', u: 0.17, v: 0.62, rx: 0.06, ry: 0.13, color: '#f4f8fc' }, { type: 'blotch', u: 0.6, v: 0.85, rx: 0.08, ry: 0.12, color: '#8a94a4', alpha: 0.6 }],
      mat: { iri: 0.05, gloss: 1 },
    },
  },
  seal: {
    L: 70, spec: {
      base: 'porpoise',
      body: { top: [[0, 0.012], [0.04, 0.05], [0.1, 0.085], [0.16, 0.09], [0.22, 0.12], [0.45, 0.15], [0.7, 0.11], [0.88, 0.05], [1, 0.03]], bot: [[0, -0.02], [0.05, -0.05], [0.14, -0.07], [0.22, -0.11], [0.45, -0.14], [0.72, -0.1], [0.9, -0.045], [1, -0.03]], wid: [[0, 0.03], [0.12, 0.08], [0.2, 0.08], [0.45, 0.14], [0.8, 0.08], [1, 0.03]], nose: 0.05, xs: 2.05, wy: 0.45 },
      eye: { u: 0.09, v: 0.66, r: 0.024, iris: '#1a1612', pupil: 0.8 },
      mouth: { u: 0.05, v: 0.3, drop: -0.004, curve: -0.006, dark: 0.3 },
      fins: [],
      barbels: [{ u: 0.03, v: 0.45, len: 0.06, ang: 10, curl: 0.2, fwd: true, out: 0.6, w: 0, col: '#e8e4dc' }, { u: 0.035, v: 0.38, len: 0.05, ang: -10, curl: -0.2, fwd: true, out: 0.6, w: 0, col: '#e8e4dc' }],
      pec: { u: 0.26, v: 0.15, len: 0.15, w: 0.05, ang: -55, spread: 26, shape: 'fan', rays: 1, opaque: true, flap: 0.4 },
      tail: { type: 'fan', len: 0.16, spread: 0.07, rays: 1, thick: 0.02, col: '#6a7480' },
      flukes: null, vbend: 0.04, wave: 0.4,
      col: { back: '#56606e', flank: '#7a8492', belly: '#c4ccd4', fin: '#4a525e', vb: 0.6, vbel: 0.32, soft: 0.12 },
      pat: [{ type: 'spots', color: '#48505c', size: 0.02, density: 0.32, vmin: 0.45, seed: 5 }],
      mat: { iri: 0.08, gloss: 0.85 },
    },
  },
  shark: { L: 110, spec: { base: 'shark' } },
  hammerhead: { L: 120, spec: { base: 'hammerhead' } },
  manta: { L: 90, spec: { base: 'manta' } },
  stingray: { L: 60, spec: { base: 'stingray' } },
  crab: { L: 26, spec: { plan: 'solid', kind: 'crab', col: { back: '#c84a2a', flank: '#e06a40', belly: '#f8dcc0', leg: '#d85a34', claw: '#c03e20', tip: '#2a1a18', eye: '#141414' }, chunk: 1.15 } },
  jelly: { L: 30, spec: { plan: 'solid', kind: 'jelly', col: { back: '#9ad8f0', flank: '#c8f0ff', belly: '#e8fbff', gonad: '#ff8ad8' }, tentLen: 1.6, glow: false } },
  octopus: { L: 30, spec: { plan: 'solid', kind: 'octopus', col: { back: '#e8704a', flank: '#f08a62', belly: '#ffc8a8', fin: '#f09070', eye: '#2a1a10' } } },
  squid: { L: 40, spec: { plan: 'solid', kind: 'squid', col: { back: '#d86a7a', flank: '#e88a98', belly: '#f8d0d8', fin: '#b84a5a', eye: '#2a3a5a' } } },
  seahorse: { L: 26, spec: { plan: 'solid', kind: 'seahorse', col: { back: '#d86a0e', flank: '#ff9a1e', belly: '#ffd25a', fin: '#ffe2a8', eye: '#c88a20' } } },
  starfish: { L: 26, spec: { plan: 'solid', kind: 'star', col: { back: '#e8602a', flank: '#f07a3a', belly: '#f8c8a8', spots: '#ffd0a0' } } },
};
const creatureC = new Map();
function creatureOf(kind) {
  if (kind === 'star') kind = 'starfish';
  let c = creatureC.get(kind);
  if (c) return c;
  const def = CREATURES[kind];
  if (def === 'turtle' || kind === 'turtle') { c = { id: 'cr:turtle', kind: 'turtle', turtle: true, L: 60, H: 30, real: { plan: 'turtle' } }; creatureC.set(kind, c); return c; }
  if (kind === 'penguin') { c = { id: 'cr:penguin', kind: 'penguin', custom: buildPenguin, L: 12, H: 12, real: { plan: 'custom' } }; creatureC.set(kind, c); return c; }
  if (kind === 'restseal') { c = { id: 'cr:restseal', kind: 'restseal', custom: buildRestSeal, L: 28, H: 10, real: { plan: 'custom' } }; creatureC.set(kind, c); return c; }
  if (!def) return null;
  const real = resolveReal({ real: def.spec }, (h) => h, null);
  if (def.spec.flukes === null) real.flukes = null;
  if (def.spec.wave != null) real.wave = def.spec.wave;
  c = { id: 'cr:' + kind, kind: real.plan === 'solid' ? real.kind : 'fish', real, L: def.L, H: def.L * 0.3, look: {}, vc: (h) => h, variant: null, alpha: 255 };
  creatureC.set(kind, c);
  return c;
}

// Green sea turtle: a domed carapace of faceted scutes, a pale plastron, a scaly head on a neck, front flippers
// that sweep in strokes and paddling rear flippers.
function buildTurtle(c, ph) {
  const L = c.L;
  const body = new Part(), eyes = new Part();
  const P = TAU * ph;
  const shellA = rgb01('#7a6436'), shellB = rgb01('#5e4c2a'), seam = rgb01('#3a2e1c'), plast = rgb01('#e0d0a0'), skin = rgb01('#7a9a62'), skinD = rgb01('#4e6a44'), spot = rgb01('#d0d8a8');
  // carapace: a dome (upper half ellipsoid) with per-face scute colours
  const cx = 0, cy = 0, R = [L * 0.36, L * 0.16, L * 0.28];
  const seg = 16, rings = 8;
  const dome = (th, phi) => [cx + Math.sin(th) * Math.cos(phi) * R[0], cy + Math.cos(th) * R[1], Math.sin(th) * Math.sin(phi) * R[2]];
  for (let i = 0; i < rings; i++) for (let j = 0; j < seg; j++) {
    const t0 = (i / rings) * Math.PI * 0.5, t1 = ((i + 1) / rings) * Math.PI * 0.5;
    const p0 = (j / seg) * TAU, p1 = ((j + 1) / seg) * TAU;
    const a = dome(t0, p0), b = dome(t0, p1), d = dome(t1, p0), e = dome(t1, p1);
    const scute = (Math.floor(i / 3) * 7 + Math.floor(j / 2)) % 2;
    const isSeam = i % 3 === 2 && j % 2 === 0;
    let col = isSeam ? seam : scute ? shellA : shellB;
    col = toneRGB(col, (hash2(i, j, 7) - 0.5) * 0.18 + (i < 2 ? 0.12 : 0));
    if (i > 0) body.tri(a, b, e, col); else body.tri(a, b, e, col);
    body.tri(a, e, d, col);
  }
  // shell rim + plastron (flat underside)
  for (let j = 0; j < seg; j++) {
    const p0 = (j / seg) * TAU, p1 = ((j + 1) / seg) * TAU;
    const a = dome(Math.PI / 2, p0), b = dome(Math.PI / 2, p1);
    const a2 = [a[0] * 0.95, -L * 0.04, a[2] * 0.95], b2 = [b[0] * 0.95, -L * 0.04, b[2] * 0.95];
    body.quad(a, b, b2, a2, toneRGB(shellB, -0.15));
    body.tri(a2, b2, [0, -L * 0.05, 0], plast);
  }
  // head + neck
  const hx = R[0] + L * 0.1, hy = L * 0.0 + Math.sin(P) * L * 0.01;
  tubeInto(body, [[R[0] * 0.8, -L * 0.01, 0], [hx - L * 0.06, hy, 0]], () => L * 0.055, 7, skinD);
  ellInto(body, [hx, hy + L * 0.01, 0], [L * 0.09, L * 0.06, L * 0.065], 10, 6, (i, j) => (hash2(i, j, 3) > 0.7 ? spot : skin));
  for (const sd of [1, -1]) {
    ellInto(eyes, [hx + L * 0.04, hy + L * 0.03, sd * L * 0.05], [L * 0.016, L * 0.016, L * 0.012], 8, 5, (i) => (i < 2 ? [0.9, 0.95, 1] : [0.04, 0.05, 0.07]));
  }
  // front flippers: sweep down and back; rear flippers paddle
  const a = 0.25 + (Math.sin(P) * 0.5 + 0.5) * 1.05;
  for (const sd of [1, -1]) {
    const root = [R[0] * 0.55, -L * 0.02, sd * R[2] * 0.75];
    const mid = [root[0] - Math.cos(a) * L * 0.16, root[1] - Math.sin(a) * L * 0.1, root[2] + sd * L * 0.14];
    const tip = [root[0] - Math.cos(a) * L * 0.36, root[1] - Math.sin(a) * L * 0.2, root[2] + sd * L * 0.22];
    flipper(body, root, mid, tip, L * 0.07, skin, skinD, sd);
    const b = Math.sin(P + 2) * 0.35;
    const rr = [-R[0] * 0.75, -L * 0.03, sd * R[2] * 0.55];
    flipper(body, rr, [rr[0] - L * 0.08, rr[1] + b * L * 0.04, rr[2] + sd * L * 0.05], [rr[0] - L * 0.15, rr[1] + b * L * 0.08, rr[2] + sd * L * 0.08], L * 0.05, skin, skinD, sd);
  }
  const parts = [
    { key: 'body', mb: body.mb, spec: 0.55, shine: 30, env: 0.35, iri: 0.05, rim: 0.3, ambient: 0.48 },
    { key: 'eyes', mb: eyes.mb, spec: 1.1, shine: 90, env: 0.3, ambient: 0.6 },
  ];
  return { parts, anchors: { mouth: [hx + L * 0.09, hy, 0], top: [0, R[1], 0], bottom: [0, -L * 0.05, 0], tail: [-R[0], 0, 0] }, eyes: [{ p: [hx + L * 0.04, hy + L * 0.03, L * 0.05], r: L * 0.016 }], L, flatRoll: 0 };
}

// Penguin (fjord): units = world px, feet at the origin, facing +x. Poses (sw): 0 stand, 1-2 waddle, 3 flap,
// 4-5 swim strokes (horizontal), 6 belly slide, 7 stand.
function buildPenguin(c, sw) {
  const body = new Part(), eyes = new Part();
  const K = rgb01('#1a1e2c'), K2 = rgb01('#2c3346'), Wt = rgb01('#f6f8fc'), Wb = rgb01('#cfd5e2'), O = rgb01('#ff9a2a'), O2 = rgb01('#e0701e');
  const pose = sw % 8;
  const swim = pose === 4 || pose === 5 || pose === 6;
  const lean = pose === 1 ? 0.12 : pose === 2 ? -0.12 : 0;
  const wing = pose === 3 ? 1.1 : swim ? (pose === 4 ? 0.9 : pose === 5 ? -0.5 : -1.2) : 0.15;
  const foot = pose === 1 ? 0.7 : pose === 2 ? -0.7 : 0;
  // model in a standing frame, then rotated: swimming / sliding penguins lie forward (head +x)
  const rotZ = swim ? -Math.PI / 2 : lean;
  const cz = Math.cos(rotZ), szn = Math.sin(rotZ);
  const pivot = swim ? [0, 5, 0] : [0, 0, 0];
  const R = (p) => { const x = p[0] - pivot[0], y = p[1] - pivot[1]; return [pivot[0] + x * cz - y * szn + (swim ? 1 : 0), pivot[1] + x * szn + y * cz - (swim ? 2.5 : 0), p[2]]; };
  const ell = (part, c0, r, seg, rings, colFn) => ellInto({ tri: (a, b2, c2, k) => part.tri(R(a), R(b2), R(c2), k) }, c0, r, seg, rings, colFn);
  // body: black back, white belly in front, a grey seam
  ell(body, [0, 5.2, 0], [3.0, 5.1, 2.8], 12, 8, (i, j) => {
    const ph = ((j + 0.5) / 12) * TAU, th = ((i + 0.5) / 8) * Math.PI;
    const nx = Math.sin(th) * Math.cos(ph);
    return nx > 0.35 ? Wt : nx > 0.1 ? Wb : i > 6 ? K2 : K;
  });
  // head + white cheek, beak, eyes
  // swimming: the head looks along the body axis (forward), standing: forward from the upright body
  const hc = swim ? [0.4, 10.8, 0] : [0.7, 10.2, 0];
  ell(body, hc, [2.3, 2.1, 2.1], 10, 6, (i, j) => {
    const ph = ((j + 0.5) / 10) * TAU, th = ((i + 0.5) / 6) * Math.PI;
    const nx = Math.sin(th) * Math.cos(ph), ny = Math.cos(th);
    return (swim ? ny > 0.3 && nx > 0.2 : nx > 0.55 && ny < 0.1) ? Wt : K;
  });
  const beak = swim ? [[1.2, 12.4, 0], [1.6, 14.6, 0]] : [[2.6, 9.9, 0], [4.8, 9.5, 0]];
  tubeInto({ quad: (a, b2, c2, d, k) => { body.tri(R(a), R(b2), R(c2), k); body.tri(R(a), R(c2), R(d), k); }, tri: (a, b2, c2, k) => body.tri(R(a), R(b2), R(c2), k) }, beak, (t) => 0.62 * (1 - 0.85 * t), 5, (t) => (t > 0.5 ? O2 : O));
  const ec = swim ? [1.6, 11.9] : [2.0, 10.7];
  for (const sd of [1, -1]) ell(eyes, [ec[0], ec[1], sd * 1.35], [0.42, 0.42, 0.32], 6, 4, (i) => (i === 0 ? [0.95, 0.97, 1] : [0.03, 0.04, 0.06]));
  // flippers (thin paddles at the shoulders)
  for (const sd of [1, -1]) {
    const a = wing;
    const root = [-0.4, 7.4, sd * 2.6];
    const tip = [-0.4 - Math.sin(a) * 0.4, 7.4 - Math.cos(a) * 4.0, sd * (2.9 + Math.sin(Math.abs(a)) * 1.6)];
    tubeInto({ quad: (p0, p1, p2, p3, k) => { body.tri(R(p0), R(p1), R(p2), k); body.tri(R(p0), R(p2), R(p3), k); }, tri: (p0, p1, p2, k) => body.tri(R(p0), R(p1), R(p2), k) }, [root, [(root[0] + tip[0]) / 2, (root[1] + tip[1]) / 2, (root[2] + tip[2]) / 2], tip], (t) => 0.8 * (1 - 0.6 * t), 5, K2);
  }
  // feet
  for (const sd of [1, -1]) ell(body, [0.9 + sd * foot * 0.6, 0.35, sd * 1.25], [1.45, 0.38, 0.8], 7, 4, O);
  const parts = [
    { key: 'body', mb: body.mb, spec: 0.55, shine: 30, env: 0.45, iri: 0.06, rim: 0.35, ambient: 0.5 },
    { key: 'eyes', mb: eyes.mb, spec: 1.1, shine: 90, env: 0.3, ambient: 0.6 },
  ];
  return { parts, anchors: { mouth: R(beak[1]), top: R([0, 12.3, 0]), bottom: R([0, 0, 0]), tail: R([-3, 1, 0]) }, eyes: [{ p: R([ec[0], ec[1], 1.35]), r: 0.42 }], L: 12, flatRoll: 0 };
}

// Harbour seal resting on an ice floe (fjord): units = world px, belly on y = 0, facing +x. sw: head lift 0..7.
function buildRestSeal(c, sw) {
  const body = new Part(), eyes = new Part();
  const lift = [0, 0, 0.6, 1, 1, 0.6, 0, 0][sw % 8];
  const B = rgb01('#5c6676'), B2 = rgb01('#7c8898'), B3 = rgb01('#3e4656'), S = rgb01('#b4bcc8'), N = rgb01('#14161c');
  const spot = (i, j, base) => (hash2(i * 7 + 3, j * 5 + 1, 11) > 0.8 ? B3 : base);
  // body: a fat spindle lying on its belly (tail -x .. neck +x)
  const pts = [], n = 9;
  for (let k = 0; k <= n; k++) { const t = k / n; pts.push([-13 + t * 22, 3.1 + Math.sin(Math.PI * Math.pow(t, 0.8)) * 1.2 - (1 - t) * 1.2, 0]); }
  const rad = (t) => 0.9 + 3.4 * Math.sin(Math.PI * Math.min(1, Math.pow(t, 0.75) * 0.98 + 0.02));
  let seg = 0;
  tubeInto({ quad: (a, b2, c2, d, k) => { body.tri(a, b2, c2, k); body.tri(a, c2, d, k); }, tri: (a, b2, c2, k) => body.tri(a, b2, c2, k) }, pts, rad, 10, (t) => { seg++; return spot(Math.round(t * 20), seg, t > 0.15 && t < 0.9 ? B : B2); });
  // belly underside (pale), flat on the ice
  ellInto(body, [-1.5, 1.4, 0], [9.5, 1.3, 3.0], 10, 4, S);
  // head + muzzle + nose, lifted
  const hy = 4.6 + lift * 1.6, hx = 10.2 + lift * 0.3;
  ellInto(body, [hx, hy, 0], [3.1, 2.8, 2.8], 10, 7, (i, j) => spot(i, j + 40, i < 2 ? B : B2));
  ellInto(body, [hx + 2.6, hy - 0.7, 0], [1.6, 1.3, 1.6], 8, 5, S);
  ellInto(eyes, [hx + 4.0, hy - 0.4, 0], [0.42, 0.36, 0.48], 6, 4, N);
  for (const sd of [1, -1]) {
    ellInto(eyes, [hx + 1.3, hy + 0.8, sd * 1.95], [0.55, 0.55, 0.45], 7, 5, (i) => (i === 0 ? [0.95, 0.97, 1] : [0.03, 0.04, 0.06]));
    for (const dy of [-0.3, 0.2]) tubeInto(body, [[hx + 3.2, hy - 0.6 + dy, sd * 1.1], [hx + 5.2, hy - 0.9 + dy * 2, sd * 2.4]], () => 0.08, 3, [0.92, 0.92, 0.9]);
    // fore flippers + hind flippers
    ellInto(body, [4.5, 1.0, sd * 3.6], [2.2, 0.45, 1.0], 7, 4, B3);
    ellInto(body, [-14.2, 2.0, sd * 0.9], [2.2, 0.5, 1.1], 7, 4, B3);
  }
  const parts = [
    { key: 'body', mb: body.mb, spec: 0.5, shine: 26, env: 0.4, iri: 0.05, rim: 0.32, ambient: 0.48 },
    { key: 'eyes', mb: eyes.mb, spec: 1.1, shine: 90, env: 0.3, ambient: 0.6 },
  ];
  return { parts, anchors: { mouth: [hx + 4.2, hy - 0.8, 0], top: [0, 8, 0], bottom: [0, 0, 0], tail: [-16, 1.5, 0] }, eyes: [{ p: [hx + 1.3, hy + 0.8, 1.95], r: 0.55 }], L: 28, flatRoll: 0 };
}

function flipper(part, a, b, c, w, col, colD, sd) {
  // a flat, tapering paddle through a -> b -> c (two faces, thin)
  const seg = [a, b, c];
  const th = w * 0.18;
  const pts = seg.map((p, i) => {
    const ww = w * [1, 0.85, 0.25][i];
    return [[p[0] + ww * 0.5, p[1] + th, p[2]], [p[0] - ww * 0.5, p[1] + th, p[2]], [p[0] - ww * 0.5, p[1] - th, p[2]], [p[0] + ww * 0.5, p[1] - th, p[2]]];
  });
  for (let i = 0; i < 2; i++) {
    const A = pts[i], B = pts[i + 1];
    part.both(A[0], A[1], B[1], col); part.both(A[0], B[1], B[0], col);
    part.both(A[3], A[2], B[2], colD); part.both(A[3], B[2], B[3], colD);
    part.both(A[0], A[3], B[3], colD); part.both(A[0], B[3], B[0], colD);
    part.both(A[1], A[2], B[2], colD); part.both(A[1], B[2], B[1], colD);
  }
  void sd;
}

// ------------------------------------------------------------------------------------------------ pose cache

const poses = new Map();
function vidOf(c) { return c._lpVid || (c._lpVid = 'v' + (c.id ?? Math.random().toString(36).slice(2))); }

// Built meshes for one pose: {parts: [{mesh, ...opts}], anchors, eyes, L, flatRoll, yawBase}
const poseKey = (c, sw, infl, mouth, frames, hi) => vidOf(c) + '|' + sw + '/' + frames + '|' + infl + '|' + mouth + (hi ? '|h' : '');
function poseCached(c, sw, infl, mouth, frames = LP_SWIM, hi = false) { return poses.has(poseKey(c, sw, infl, mouth, frames, !VOXEL && hi && c.real?.plan === 'fish' && !c.turtle)); }
let poseBytes = 0;
const POSE_BYTES = 90e6;
const poseSize = (p) => { let n = 0; for (const q of p.parts) n += q.mesh.bytes ?? q.mesh.data.byteLength; return n; };
// Voxel edge (model units) of a creature: ~48 voxels along small fish, up to ~140 along giants and bosses.
let VOXEL = true;
export function setVoxelMode(on) { VOXEL = !!on; clearLowpolyCache(); }
export function voxelSize(c, p) {
  const Lk = c.L || p.L || 30;
  const N = clamp(30 + Lk * 0.75, 48, 140) * (c.voxK || c.real?.voxK || 1);
  return (p.L || Lk) / N;
}
function poseOf(c, sw, infl, mouth, frames = LP_SWIM, hi = false, eel3d = false) {
  hi = !VOXEL && hi && c.real?.plan === 'fish' && !c.turtle;
  const key = poseKey(c, sw, infl, mouth, frames, hi) + (eel3d ? '|eel' : '');
  let p = poses.get(key);
  if (p) { poses.delete(key); poses.set(key, p); return p; }
  const t0 = now();
  const ph = sw / frames;
  let b;
  if (c.turtle) b = buildTurtle(c, ph);
  else if (c.custom) b = c.custom(c, sw);
  else if (eel3d && c.kind === 'chain') b = buildEel3D(c, sw, frames);
  else if (c.real?.plan === 'solid') b = buildSolid(c, ph);
  else b = buildFish(c, ph, infl, mouth, hi);
  p = { ...b, parts: b.parts.map((q) => { const { mb, key: k2, ...o } = q; return { key: k2, mesh: mb.build(), ...o }; }) };
  if (VOXEL) {
    // phase 8: the anatomical mesh becomes a real voxel model (fine voxels, baked AO, translucent fin voxels)
    const src = p.parts;
    p = { ...p, parts: voxelizeParts(src, voxelSize(c, p), { ao: 1, eyes: p.eyeVox, density: c.real?.plan === 'solid' ? 1.35 : 1.8 }) };
    for (const q of src) q.mesh.dispose?.();
  }
  poses.set(key, p);
  poseBytes += poseSize(p);
  stat.poses++;
  stat.tris = 0; for (const q of p.parts) stat.tris += q.mesh.count / 3;
  if (poses.size > POSE_MAX || poseBytes > POSE_BYTES) {
    const it = poses.keys();
    for (let i = 0; i < 60 || poseBytes > POSE_BYTES * 0.8; i++) { const k = it.next().value; if (k === undefined || k === key) break; const q = poses.get(k); poses.delete(k); poseBytes -= poseSize(q); for (const pt of q.parts) pt.mesh.dispose(); }
  }
  stat.poseMs += now() - t0;
  return p;
}

// ------------------------------------------------------------------------------------------------ sprites

const sheets = new Map();
const byVid = new Map();
let sheetPx = 0;
export const scaleBucket = (S) => Math.round(Math.log(Math.max(0.03, S)) / Math.log(SCALE_STEP));
const bucketScale = (b) => Math.pow(SCALE_STEP, b);

function viewMatrix(yawDeg, rollDeg, tiltDeg = CAM_TILT) {
  const T = M4.ident(), Y = M4.ident(), R = M4.ident();
  const t = tiltDeg * DEG, y = -yawDeg * DEG, r = rollDeg * DEG;
  T[5] = Math.cos(t); T[6] = Math.sin(t); T[9] = -Math.sin(t); T[10] = Math.cos(t);
  Y[0] = Math.cos(y); Y[2] = -Math.sin(y); Y[8] = Math.sin(y); Y[10] = Math.cos(y);
  R[5] = Math.cos(r); R[6] = Math.sin(r); R[9] = -Math.sin(r); R[10] = Math.cos(r);
  return M4.mul(T, M4.mul(Y, R));
}

function sheetKeyOf(vid, sb, yawI, infl, mouth, tilt) { return vid + '|' + sb + '|' + yawI + '|' + infl + '|' + mouth + '|' + tilt; }

// A crisp 1-pixel black outline around every creature in a sprite sheet (user request): any transparent pixel
// touching a solid one in the same cell turns into a dark ink pixel. Faint glass fins (low alpha) do not count as solid.
const OUTLINE_INK = [10, 14, 26];
// Bright, saturated creature sprites (user: "make fish bright"): a higher ambient floor and the renderer's vivid mode
// (saturation lift, brighter exposure, colour-keeping gloss, hue-tinted rim sheen).
const VIVID = { ambient: 0.54, vivid: 1 };
function outlineSheet(canvas, cols, w, h) {
  const W = canvas.width, H = canvas.height;
  if (!W || !H) return;
  let g;
  try { g = canvas.getContext('2d', { willReadFrequently: true }); } catch { return; }
  if (!g) return;
  const img = g.getImageData(0, 0, W, H), d = img.data;
  const solid = new Uint8Array(W * H);
  for (let i = 0, j = 3; i < solid.length; i++, j += 4) solid[i] = d[j] > 110 ? 1 : 0;
  // bigger sprites get a 2-pixel ink line so it still reads once the sheet is scaled down on screen
  const passes = h > 56 ? 2 : 1;
  for (let pass = 0; pass < passes; pass++) {
  const add = [];
  for (let y = 0; y < H; y++) {
    const cy0 = Math.floor(y / h) * h, cy1 = cy0 + h - 1;
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (solid[i]) continue;
      const cx0 = Math.floor(x / w) * w, cx1 = cx0 + w - 1;
      if ((x > cx0 && solid[i - 1]) || (x < cx1 && solid[i + 1]) || (y > cy0 && solid[i - W]) || (y < cy1 && solid[i + W])) {
        const j = i * 4;
        d[j] = OUTLINE_INK[0]; d[j + 1] = OUTLINE_INK[1]; d[j + 2] = OUTLINE_INK[2]; d[j + 3] = 255;
        add.push(i);
      }
    }
  }
  for (const i of add) solid[i] = 1;
  }
  g.putImageData(img, 0, 0);
}

function buildSheet(c, sb, yawI, infl, mouth, tilt, hi = false, only = null) {
  const t0 = now();
  const Sb = bucketScale(sb);
  const frames = [];
  for (const sw of only || [0, 1, 2, 3, 4, 5, 6, 7]) frames.push(poseOf(c, sw, infl, mouth, LP_SWIM, hi));
  const roll = frames[0].flatRoll || 0;
  const V = viewMatrix(yawI * YAW_STEP, roll, tilt);
  // projected bounds over every frame
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, R2 = 0;
  for (const f of frames) for (const pt of f.parts) {
    const d = pt.mesh.data;
    for (let i = 0; i < d.length; i += 11) {
      const x = d[i], y = d[i + 1], z = d[i + 2];
      const px = V[0] * x + V[4] * y + V[8] * z, py = V[1] * x + V[5] * y + V[9] * z;
      if (px < x0) x0 = px; if (px > x1) x1 = px; if (py < y0) y0 = py; if (py > y1) y1 = py;
      const r2 = x * x + y * y + z * z; if (r2 > R2) R2 = r2;
    }
  }
  if (!isFinite(x0)) return null;
  const blur = c.glow ? Math.max(1.5, Math.min(6, Sb * 1.1)) : 0;
  const pad = 3 + Math.ceil(blur * 2);
  const w = Math.max(4, Math.ceil((x1 - x0) * Sb) + pad * 2), h = Math.max(4, Math.ceil((y1 - y0) * Sb) + pad * 2);
  // model point projecting to the cell centre: V^T * (bx, by, 0)
  const bx = (x0 + x1) / 2, by = (y0 + y1) / 2;
  const center = [V[0] * bx + V[1] * by, V[4] * bx + V[5] * by, V[8] * bx + V[9] * by];
  const radius = Math.sqrt(R2) + 1;
  const o = { w, h, scale: Sb, matrix: V, center, radius, light: [-0.42, 0.82, 0.62], ambient: VIVID.ambient, vivid: VIVID.vivid, rimColor: '#c8f6ff', sky: '#f2fdff', ground: '#2a6a9a' };
  const cells = frames.map((f) => ({ parts: f.parts.map((pt) => ({ ...pt })) }));
  const cols = Math.max(1, Math.min(LP_SWIM, Math.floor(4096 / w)));
  const tg = now();
  const canvas = renderSheet(cells, { ...o, cols });
  stat.glMs += now() - tg;
  // voxel poses keep only their compact face lists between sheet builds
  if (!canvas) return null;
  outlineSheet(canvas, cols, w, h);
  // glow pass: emissive parts only (the rest renders black), blurred into a soft additive halo
  let glow = null;
  if (c.glow) {
    const gcells = frames.map((f) => ({ parts: f.parts.filter((p) => p.key !== 'fins' && p.key !== 'finrays' && p.key !== 'glass').map((p) => ({ ...p, ambient: 0, spec: 0, env: 0, rim: 0, iri: 0 })) }));
    const raw = renderSheet(gcells, { ...o, cols, light: [0, 0, -1], ambient: 0, vivid: 0 });
    if (raw) {
      glow = makeCanvas(raw.width, raw.height);
      const g = glow.getContext('2d');
      g.filter = `blur(${blur.toFixed(1)}px)`;
      g.drawImage(raw, 0, 0);
      g.filter = 'none';
      g.globalCompositeOperation = 'lighter';
      g.globalAlpha = 0.3;
      g.drawImage(raw, 0, 0);
    }
  }
  for (const f of frames) for (const pt of f.parts) pt.mesh.release?.();
  const proj = (p) => lpProject(p, o);
  const [ax, ay] = proj([0, 0, 0]);
  const meta = frames.map((f) => {
    const anchors = {};
    for (const [k, v] of Object.entries(f.anchors)) { const q = proj(v); anchors[k] = [q[0] - ax, q[1] - ay]; }
    const eyes = f.eyes.map((e) => { const q = proj(e.p); return { x: q[0] - ax, y: q[1] - ay, r: e.r * Sb }; });
    return { anchors, eyes };
  });
  const sh = { canvas, glow, w, h, cols, ax, ay, Sb, meta, vid: vidOf(c), px: canvas.width * canvas.height * (glow ? 2 : 1), yawI, sb, infl, mouth, tilt, lo: !VOXEL && !hi && (c.L || 30) * Sb > 300 && c.real?.plan === 'fish' };
  const dt = now() - t0;
  spent += dt; stat.ms += dt; stat.sheets++; stat.renders += LP_SWIM;
  return sh;
}

function storeSheet(key, sh) {
  sheets.set(key, sh);
  sheetPx += sh.px;
  let s = byVid.get(sh.vid);
  if (!s) byVid.set(sh.vid, (s = new Set()));
  s.add(key);
  if (sheetPx > SHEET_PX_MAX) {
    for (const [k, v] of sheets) {
      if (sheetPx <= SHEET_PX_MAX * 0.85) break;
      sheets.delete(k); sheetPx -= v.px;
      byVid.get(v.vid)?.delete(k);
    }
  }
}

// nearest cached sheet of the same creature (yaw first, then scale, then inflate / mouth)
function nearest(vid, sb, yawI, infl, mouth) {
  const s = byVid.get(vid);
  if (!s || !s.size) return null;
  let best = null, bd = Infinity;
  for (const k of s) {
    const v = sheets.get(k);
    if (!v) continue;
    const d = Math.abs(v.yawI - yawI) * 4 + Math.abs(v.sb - sb) * 1.5 + Math.abs(v.infl - infl) * 6 + Math.abs(v.mouth - mouth) * 3;
    if (d < bd) { bd = d; best = v; }
  }
  return best;
}

// Build a sheet step by step under a deadline: skin (resumable), the swim-frame pose meshes, then one GL pass.
function progress(c, sb, yawI, infl, mouth, tilt, deadline) {
  if (c._lpBroken) return null;
  const Sb = bucketScale(sb);
  const fishPlan = c.real?.plan === 'fish' && !c.turtle;
  const hi = !VOXEL && fishPlan && (c.L || 30) * Sb > 300 && (syncAll || !!c._lpSkinHi || !!c._lpSkin);
  if (fishPlan && !advanceSkin(c, hi, deadline)) return null;
  for (let sw = 0; sw < LP_SWIM; sw++) {
    if (poseCached(c, sw, infl, mouth, LP_SWIM, hi)) continue;
    if (now() > deadline) return null;
    poseOf(c, sw, infl, mouth, LP_SWIM, hi);
  }
  if (now() > deadline && deadline !== Infinity) return null;
  return buildSheet(c, sb, yawI, infl, mouth, tilt, hi);
}

/**
 * Sprite frame of a compiled creature. req: {S, yaw (deg), sw, infl (0..3), mouth (0|1), force, tilt}.
 * Returns {canvas, sx, sy, w, h, ax, ay, k, anchors, eyes} (draw the w x h cell at (x - ax * k, y - ay * k) scaled
 * by k) or null while nothing has been built yet.
 */
export function lpFrame(c, req) {
  if (!lpCanRender()) return null;
  ensureTick();
  const L = c.L || 30;
  let S = Math.max(0.03, req.S || 1);
  if (L * S > MAX_SPRITE) S = MAX_SPRITE / L;
  const sb = scaleBucket(S);
  const yawI = clamp(Math.round((req.yaw ?? 0) / YAW_STEP), -9, 9);
  const infl = req.infl | 0, mouth = req.mouth ? 1 : 0, tilt = req.tilt ?? CAM_TILT;
  const vid = vidOf(c);
  const key = sheetKeyOf(vid, sb, yawI, infl, mouth, tilt);
  let sh = sheets.get(key);
  if (sh) {
    sheets.delete(key); sheets.set(key, sh);
    // close-ups first appear with the low-res skin: refine them when there is time to spare
    if (sh.lo && !c._lpBroken && spent < budgetMs * 0.5 && !syncAll) {
      const t0 = now();
      try { const s2 = progress(c, sb, yawI, infl, mouth, tilt, t0 + (budgetMs - spent)); if (s2) { if (s2.lo) s2.lo = false; sheetPx -= sh.px; sheets.delete(key); byVid.get(vid)?.delete(key); storeSheet(key, s2); sh = s2; } } catch { sh.lo = false; }
      spent += now() - t0;
    }
  }
  else {
    const fb = nearest(vid, sb, yawI, infl, mouth);
    const force = req.force || syncAll;
    // creatures with nothing to show yet, and hero close-ups (pri >= 3), share a capped extra allowance per frame
    const first = (!fb || (req.pri ?? 1) >= 3) && forceSpent < FORCE_MS;
    if (force || canSpend() || first) {
      const t0 = now();
      const deadline = force ? Infinity : t0 + Math.max(0.6, first ? FORCE_MS - forceSpent : budgetMs - spent);
      try { sh = progress(c, sb, yawI, infl, mouth, tilt, deadline); } catch (e) { console.warn('lowpoly fish build failed', e); sh = null; c._lpBroken = true; }
      const dt = now() - t0;
      if (first && !force) forceSpent += dt; else spent += dt;
      if (sh) storeSheet(key, sh);
    }
    if (!sh) { sh = fb; if (sh) stat.fallbacks++; else { stat.misses++; return null; } }
  }
  const i = ((req.sw | 0) % LP_SWIM + LP_SWIM) % LP_SWIM;
  const m = sh.meta[i];
  return { canvas: sh.canvas, sx: (i % sh.cols) * sh.w, sy: Math.floor(i / sh.cols) * sh.h, w: sh.w, h: sh.h, ax: sh.ax, ay: sh.ay, k: (req.S || 1) / sh.Sb, anchors: m.anchors, eyes: m.eyes, sheet: sh };
}

/**
 * One still frame (UI icons, thumbnails): a single swim frame rendered on its own (not a whole sheet), cached by
 * key. Same result shape as lpFrame.
 */
const stills = new Map();
export function lpStill(c, req) {
  if (!lpCanRender()) return null;
  const L = c.L || 30;
  let S = Math.max(0.03, req.S || 1);
  if (L * S > MAX_SPRITE) S = MAX_SPRITE / L;
  const sb = scaleBucket(S);
  const yawI = clamp(Math.round((req.yaw ?? 0) / YAW_STEP), -9, 9), sw = (req.sw | 0) % LP_SWIM;
  const key = vidOf(c) + '|' + sb + '|' + yawI + '|' + sw;
  let sh = stills.get(key);
  if (!sh) {
    // a full sheet of this bucket already cached? use it
    const full = sheets.get(sheetKeyOf(vidOf(c), sb, yawI, 0, 0, CAM_TILT));
    if (full) return lpFrame(c, { ...req, S });
    try {
      const fishPlan = c.real?.plan === 'fish' && !c.turtle;
      if (fishPlan) advanceSkin(c, false, Infinity);
      sh = buildSheet(c, sb, yawI, 0, 0, CAM_TILT, false, [sw]);
    } catch (e) { console.warn('lowpoly still failed', e); sh = null; }
    if (!sh) return null;
    stills.set(key, sh);
    if (stills.size > 300) stills.delete(stills.keys().next().value);
  }
  const m = sh.meta[0];
  return { canvas: sh.canvas, sx: 0, sy: 0, w: sh.w, h: sh.h, ax: sh.ax, ay: sh.ay, k: (req.S || 1) / sh.Sb, anchors: m.anchors, eyes: m.eyes, sheet: sh };
}

/** Pre-build the side-on sheet of a creature at on-screen scale S (device px per look px). */
export function warmFish(c, S, yaw = 15) { return lpFrame(c, { S, yaw, sw: 0, force: true }); }

export function clearLowpolyCache() {
  sheets.clear(); byVid.clear(); sheetPx = 0; stills.clear?.();
  for (const p of poses.values()) for (const pt of p.parts) pt.mesh.dispose();
  poses.clear(); poseBytes = 0;
  for (const m of meshCache.values()) { m.dispose(); m.plain?.dispose(); m.glow?.dispose(); }
  meshCache.clear();
}

/** Far giants / non-species creatures as sprite frames (same contract as lpFrame). */
export function creatureFrame(kind, req) {
  const c = req.look || creatureOf(kind);
  return c ? lpFrame(c, req) : null;
}

// A seabed crab creature in a colour (world critters).
const crabLooks = new Map();
export function lpCrabLook(color = '#e0502e') {
  let c = crabLooks.get(color);
  if (c) return c;
  const spec = { plan: 'solid', kind: 'crab', col: { back: color, flank: shadeHex(color, 0.15), belly: shadeHex(color, 0.7), leg: shadeHex(color, 0.08), claw: shadeHex(color, -0.08), tip: '#2a1a18', eye: '#141414' }, chunk: 1.15 };
  const real = resolveReal({ real: spec }, (h) => h, null);
  c = { id: 'cr:crab:' + color, kind: 'crab', real, L: 26, H: 10, look: {}, vc: (h) => h, variant: null, alpha: 255 };
  crabLooks.set(color, c);
  return c;
}
export function creatureLook(kind) { return creatureOf(kind); }

// ------------------------------------------------------------------------------------------------ chain balls

const balls = new Map();
// Faceted segment ball of a chain creature (eel body), radius rPx device px; fin = dorsal ridge colour.
export function lpBall(c, rPx, fin = false) {
  const rb = Math.max(1, Math.round(rPx * 2) / 2);
  const key = vidOf(c) + '|' + rb + '|' + (fin ? 1 : 0);
  let b = balls.get(key);
  if (b) return b;
  if (!lpCanRender()) return null;
  const g = c.real?.seg || {};
  const col = rgb01(fin ? g.fin || c.real?.col?.fin || '#888888' : g.side || c.real?.col?.flank || '#888888');
  const top = rgb01(g.top || c.real?.col?.back || '#666666'), bel = rgb01(g.belly || c.real?.col?.belly || '#dddddd');
  const c2 = g.col2 ? rgb01(g.col2) : null;
  const mb = new MeshBuilder();
  const seg = rb > 6 ? 10 : 8, rings = rb > 6 ? 7 : 5;
  const P = (i, j) => { const th = (i / rings) * Math.PI, ph = (j / seg) * TAU; return [Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph)]; };
  for (let i = 0; i < rings; i++) for (let j = 0; j < seg; j++) {
    const a = P(i, j), bq = P(i, j + 1), d = P(i + 1, j), e = P(i + 1, j + 1);
    const ny = Math.cos(((i + 0.5) / rings) * Math.PI);
    let k = fin ? col : ny > 0.35 ? top : ny < -0.45 ? bel : col;
    if (!fin && c2) {
      if (g.pattern === 'stripes' && (i === 2 || i === rings - 2)) k = c2;
      else if ((g.pattern === 'spots' || g.pattern === 'dots') && hash2(i, j, 7) > 0.78 && ny > -0.3) k = c2;
    }
    k = toneRGB(k, (hash2(i * 3, j, 5) - 0.5) * 0.08);
    if (i > 0) mb.tri(a, bq, e, k);
    if (i < rings - 1) mb.tri(a, e, d, k);
  }
  const mesh = mb.build();
  const sz = Math.ceil(rb * 2 + 4);
  const glowOn = !!g.glow && !fin;
  const cv = renderSheet([{ mesh }], { w: sz, h: sz, scale: rb, center: [0, 0, 0], radius: 1.2, matrix: viewMatrix(0, 0), spec: 0.55, shine: 30, env: 0.45, iri: 0.1, rim: 0.35, emit: glowOn ? 0.3 : 0, light: [-0.42, 0.82, 0.62], sky: '#f2fdff', ground: '#2a6a9a', ambient: VIVID.ambient, vivid: VIVID.vivid });
  mesh.dispose();
  if (!cv) return null;
  b = { canvas: cv, ax: sz / 2, ay: sz / 2 };
  balls.set(key, b);
  if (balls.size > 600) balls.delete(balls.keys().next().value);
  return b;
}

// ------------------------------------------------------------------------------------------------ icons

const icons = new Map();
/** Low-poly fish thumbnail (UI icons / lists): the species fitted and centred in a w x h canvas, cached. */
export function lpFishIcon(sp, w, h = w, o = {}) {
  sp = (typeof sp === 'string' ? SPECIES_BY_ID[sp] : sp) || SPECIES_BY_ID.pixel;
  if (!sp) return null;
  w = Math.max(4, Math.round(w)); h = Math.max(4, Math.round(h));
  const dir = o.dir < 0 ? -1 : 1;
  const key = `${sp.id}|${w}x${h}|${dir}|${o.tint || ''}|${o.tintA ?? ''}|${o.yaw ?? 12}`;
  let cv = icons.get(key);
  if (cv !== undefined) return cv;
  const c = compiled(sp.look, o.variant || null, sp.id);
  const L = Math.max(c.L || 30, (c.H || 10) * 1.6);
  const f = lpStill(c, { S: (Math.min(w / 1.25, h * 2.2) / L), yaw: o.yaw ?? 12, sw: 1 });
  if (!f) return null;
  const k = Math.min(w / f.w, h / f.h) * 0.98;
  cv = makeCanvas(w, h);
  const g = cv.getContext('2d');
  g.imageSmoothingEnabled = true;
  const dw = f.w * k, dh = f.h * k;
  g.save();
  g.translate((w - dw) / 2 + (dir < 0 ? dw : 0), (h - dh) / 2);
  if (dir < 0) g.scale(-1, 1);
  g.drawImage(f.canvas, f.sx, f.sy, f.w, f.h, 0, 0, dw, dh);
  g.restore();
  if (o.tint) {
    g.globalCompositeOperation = 'source-atop';
    g.globalAlpha = o.tintA ?? 0.6;
    g.fillStyle = o.tint;
    g.fillRect(0, 0, w, h);
  }
  icons.set(key, cv);
  if (icons.size > 400) icons.delete(icons.keys().next().value);
  return cv;
}

// ------------------------------------------------------------------------------------------------ 3D API

function meshFromPose(c, p) {
  // merge the opaque parts (body, eyes, glow) into one mesh with the skin texture; fins stay separate
  const op = p.parts.filter((q) => q.key !== 'fins' && q.key !== 'finrays' && q.key !== 'glass');
  const merge = (list) => {
    if (!list.length) return null;
    if (list.every((q) => q.mesh.voxel)) return mergeVox(list.map((q) => q.mesh));
    let n = 0;
    for (const q of list) n += q.mesh.data.length;
    const data = new Float32Array(n);
    let o = 0;
    for (const q of list) { data.set(q.mesh.data, o); o += q.mesh.data.length; }
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < data.length; i += 11) for (let k = 0; k < 3; k++) { if (data[i + k] < min[k]) min[k] = data[i + k]; if (data[i + k] > max[k]) max[k] = data[i + k]; }
    const center = [0, 1, 2].map((k) => (min[k] + max[k]) / 2);
    return new LPMesh(data, data.length / 11, { min, max, center, radius: Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2 || 1 });
  };
  const textured = op.filter((q) => q.texture);
  const plain = op.filter((q) => !q.texture && q.key !== 'glow');
  const glowL = op.filter((q) => q.key === 'glow');
  const main = merge(textured.length ? textured : plain) || merge(plain);
  if (!main) return null;
  const finsP = p.parts.find((q) => q.key === 'fins');
  const glassP = p.parts.find((q) => q.key === 'glass');
  main.texture = textured.length ? textured[0].texture : null;
  main.emitTex = !!main.texture;
  main.plain = textured.length && plain.length ? merge(plain) : null;
  main.fins = finsP ? finsP.mesh : null;
  main.finsTex = !!finsP?.texture;
  main.finAlpha = finsP?.alpha ?? 0.7;
  const raysP = p.parts.find((q) => q.key === 'finrays');
  main.finRays = raysP ? raysP.mesh : null;
  main.rayAlpha = raysP?.alpha ?? 0.9;
  main.glass = glassP ? glassP.mesh : null;
  main.glow = merge(glowL);
  main.L = p.L;
  main.anchors = p.anchors;
  main.eyes = p.eyes;
  main.flatRoll = p.flatRoll || 0;
  main.mat = p.parts.find((q) => q.key === 'body') || {};
  return main;
}

const meshCache = new Map();
function cachedMesh(c, o) {
  const frames = o.frames || LP_SWIM;
  const sw = Math.round(((((o.phase || 0) % 1) + 1) % 1) * frames) % frames;
  const infl = Math.round(clamp01(o.inflate || 0) * 3), mouth = o.mouth ? 1 : 0;
  const key = vidOf(c) + '|' + sw + '/' + frames + '|' + infl + '|' + mouth;
  let m = meshCache.get(key);
  if (m) return m;
  if (!lpAvailable()) return null;
  const p = poseOf(c, sw, infl, mouth, frames, o.hi ?? true, true);
  m = meshFromPose(c, p);
  if (m) { meshCache.set(key, m); if (meshCache.size > 240) { const k = meshCache.keys().next().value; const q = meshCache.get(k); meshCache.delete(k); q.dispose(); q.plain?.dispose(); q.glow?.dispose(); } }
  return m;
}

/** Low-poly 3D mesh of a species (rec.variant applies mutation / shiny colours) at swim phase 0..1. */
export function fishMesh(sp, rec = null, o = {}) {
  sp = typeof sp === 'string' ? SPECIES_BY_ID[sp] : sp;
  if (!sp) return null;
  const c = compiled(sp.look, rec?.variant || null, sp.id);
  return cachedMesh(c, o);
}

/** Low-poly 3D mesh of a creature kind (dolphin, whale, beluga, orca, seal, turtle, shark, ...). */
export function creatureMesh(kind, o = {}) {
  const c = creatureOf(kind);
  return c ? cachedMesh(c, o) : null;
}

/** Add a fishMesh / creatureMesh to an LPScene with the right per-part options (o: extra options, e.g. fog). */
export function addFishToScene(scene, mesh, model, o = {}) {
  if (!mesh) return scene;
  const m = mesh.mat || {};
  const base = { spec: m.spec ?? 0.45, shine: m.shine ?? 34, env: m.env ?? 0.35, iri: m.iri ?? 0.1, rim: m.rim ?? 0.3, ...o };
  scene.add(mesh, model, { ...base, texture: mesh.texture, emitTex: mesh.emitTex });
  if (mesh.plain) scene.add(mesh.plain, model, base);
  if (mesh.glow) scene.add(mesh.glow, model, { ...base, emit: 1 });
  if (mesh.fins) scene.add(mesh.fins, model, { ...base, texture: mesh.finsTex === false ? undefined : mesh.texture, alpha: (o.alpha ?? 1) * mesh.finAlpha, cull: false, spec: 0.5, shine: 46 });
  if (mesh.finRays) scene.add(mesh.finRays, model, { ...base, alpha: (o.alpha ?? 1) * mesh.rayAlpha, cull: false, spec: 0.5, shine: 46 });
  if (mesh.glass) scene.add(mesh.glass, model, { ...base, texture: mesh.texture, alpha: 0.5, cull: false, env: 0.6 });
  return scene;
}

void lpFreeTexture;

// ------------------------------------------------------------------------------------------------ orbs

const orbs = new Map();
/** Glossy faceted orb sprite (Wakka pellets, bubbles): r = on-screen radius px. -> {canvas, ax, ay} | null */
export function lpOrb(r, hex = '#e6fdff', glow = false) {
  const rq = Math.max(1, Math.round(r * 2) / 2);
  const key = rq + hex + (glow ? 'g' : '');
  let b = orbs.get(key);
  if (b !== undefined) return b;
  if (!lpCanRender()) return null;
  const mb = new MeshBuilder();
  const col = rgb01(hex);
  ellInto({ tri: (a, bb, c2, k) => mb.tri(a, bb, c2, k) }, [0, 0, 0], [1, 1, 1], 10, 7, col);
  let mesh = mb.build();
  if (VOXEL) { const vm = voxelizeMesh(mesh, 2 / clamp(Math.round(rq * 0.9), 5, 12), { jitter: 0.02 }); if (vm) { mesh.dispose(); mesh = vm; } }
  const sz = Math.ceil(rq * 2 + 4);
  const cv = renderSheet([{ mesh }], { w: sz, h: sz, scale: rq, center: [0, 0, 0], radius: 1.2, matrix: viewMatrix(0, 0), spec: 1, shine: 40, env: 0.6, iri: 0.35, rim: 0.6, emit: glow ? 0.35 : 0, light: [-0.42, 0.82, 0.62], sky: '#f2fdff', ground: '#2a6a9a' });
  mesh.dispose();
  b = cv ? { canvas: cv, glow: null, ax: sz / 2, ay: sz / 2 } : null;
  orbs.set(key, b);
  return b;
}

// debug / benchmarks (dev pages, tools)
export const _lpDebug = { poseOf: (...a) => poseOf(...a), skinOf: (...a) => skinOf(...a), buildSolid: (...a) => buildSolid(...a) };

// ------------------------------------------------------------------------------------------------ chain tubes

const tubes = new Map();
/**
 * Faceted body pill of a chain creature (eel body): a horizontal low-poly capsule (axis along x, 4 r long, lit
 * from the top) for radius rPx device px. Stamp it along the path every ~0.6 r, rotated to the local direction
 * (flipped vertically when heading left so the lit side stays up). -> {canvas, ax, ay, r, w, h} | null
 */
export function lpTube(c, rPx) {
  const rb = Math.max(1, Math.round(rPx * 2) / 2);
  const key = vidOf(c) + '|' + rb;
  let b = tubes.get(key);
  if (b !== undefined) return b;
  if (!lpCanRender()) return null;
  const g = c.real?.seg || {};
  const side = rgb01(g.side || c.real?.col?.flank || '#888888');
  const top = rgb01(g.top || c.real?.col?.back || '#666666'), bel = rgb01(g.belly || c.real?.col?.belly || '#dddddd');
  const c2 = g.col2 ? rgb01(g.col2) : null;
  const mb = new MeshBuilder();
  const sides = rb > 5 ? 10 : 8, rings = 4;
  // a pill: cylinder |x| <= 1 with hemispherical caps (radius 1) along x
  const colAt = (ny, i, j) => {
    let k = ny > 0.45 ? top : ny < -0.5 ? bel : side;
    if (c2) {
      if (g.pattern === 'stripes' && (Math.abs(ny - 0.62) < 0.2 || Math.abs(ny + 0.1) < 0.18)) k = c2;
      else if ((g.pattern === 'spots' || g.pattern === 'dots') && hash2(i, j, 7) > 0.75 && ny > -0.3) k = c2;
    }
    return toneRGB(k, (hash2(i * 3, j, 5) - 0.5) * 0.05);
  };
  const prof = [];
  for (let i = 0; i <= rings; i++) { const a = (i / rings) * Math.PI / 2; prof.push([-1 - Math.cos(a), Math.sin(a)]); }
  prof.push([1, 1]);
  for (let i = rings; i >= 0; i--) { const a = (i / rings) * Math.PI / 2; prof.push([1 + Math.cos(a), Math.sin(a)]); }
  const P = (q, j) => { const a = (j / sides) * TAU; return [q[0], Math.cos(a) * q[1], Math.sin(a) * q[1]]; };
  for (let i = 0; i < prof.length - 1; i++) for (let j = 0; j < sides; j++) {
    const ny = Math.cos(((j + 0.5) / sides) * TAU);
    const k = colAt(ny, i, j);
    const a = P(prof[i], j), b2 = P(prof[i], j + 1), d = P(prof[i + 1], j), e = P(prof[i + 1], j + 1);
    mb.quad(a, d, e, b2, k);
  }
  let mesh = mb.build();
  if (VOXEL) {
    // voxel pill: as many voxels across as the head model has across the body
    const vsH = voxelSize(c, { L: c.L || 30 });
    const d = clamp(Math.round((2 * (c.chain?.r || 4) * 0.95) / vsH), 5, 16);
    const vm = voxelizeMesh(mesh, 2 / d, { jitter: 0.03 });
    if (vm) { mesh.dispose(); mesh = vm; }
  }
  const w = Math.ceil(rb * 4) + 2, h = Math.ceil(rb * 2) + 2;
  const cy = h / 2;
  const cv = renderSheet([{ mesh }], { w, h, scale: rb, center: [0, 0, 0], radius: 2.4, matrix: viewMatrix(0, 0, 0), spec: 0.6, shine: 26, env: 0.5, iri: 0.12, rim: 0.4, emit: g.glow ? 0.25 : 0, light: [-0.3, 0.9, 0.5], sky: '#f2fdff', ground: '#2a6a9a', ambient: VIVID.ambient, vivid: VIVID.vivid });
  mesh.dispose();
  b = cv ? { canvas: cv, ax: w / 2, ay: cy, r: rb, w, h } : null;
  tubes.set(key, b);
  if (tubes.size > 400) tubes.delete(tubes.keys().next().value);
  return b;
}
