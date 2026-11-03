// Voxel fish engine: every creature becomes a 3D voxel sculpture built from its procedural look, rendered
// by a fish-specialised orthographic ray-caster, so fish turn smoothly through yaw instead of flipping.
//
// Model resolution follows the on-screen size (~VP screen px per voxel), so big fish get finer voxels.
//  1. Layout: the look's rig layers are rasterised in voxel-albedo mode (fishart.rasterLayerVox: clean
//     tones, no 2D lighting) at the model resolution, one pixel per voxel column.
//  2. Grid (per swim frame): the body is extruded with an elliptical cross-section from a Euclidean
//     distance transform (laterally compressed per shape); the spine bends along a travelling wave with
//     arc-length compression (the tail visibly sweeps even side-on); fins are translucent 1-voxel
//     membranes with opaque rays; pectorals hinge out from the flanks; eyes/mouth are stamped on both
//     flanks (eyes domed). Kinds (crab, jelly, ray...) use their 2D animation frames; jellies, puddings,
//     octopuses and blobs are solids of revolution.
//  3. Render (per yaw / pitch / scale bucket): camera-space light from the upper left, blend of smoothed
//     and per-face normals (visible voxel facets), per-face AO, sky/bounce ambient, Blinn glints, an
//     underwater rim light, a hue-shifted 21-tone ramp, translucent membranes over the body, interior
//     depth lines, a selective dark outline and an emissive glow halo. Frames render progressively
//     (row slices) under a per-frame time budget, with nearest-frame fallback, LRU caches and warm-up.
//
// Phase 3 Frutiger Aero styling: vivid tropical saturation, translucent aqua-tinted fins that keep their hue,
// glossy sheen and glints, and CARTOON voxel eyes (white ball, big dark pupil, a white shine voxel; lids for
// blink / squint / sad / angry, a pink heart pupil for love, a swirl for dizzy). Outfits and gadgets:
// look.rotor (spinning wind turbine), look.sneakers {u, h, len, accent} (white high-tops that walk with the
// swim cycle), look.orb {r, color} (a glass water bubble around the fish), glasses extras (lenses / patch
// stamped over the eye), look.vox.glass >= 0.5 (see-through iridescent soap-bubble body).
// Canonical yaw is -90..90 (0 = facing right, 90 = toward the viewer); left-facing fish are mirrored.
// Composition (face overlays, wash, glow, silhouette) lives in fishrig.js (drawFishRig, style 'voxel').
// drawVoxelFish(ctx, fish, {scale, glow, alpha}) remains for the aquarium (fish objects in tank space; it also
// draws a Wakka fish's pellet bubbles).

import { rigLayers, rigGeom, rasterLayerVox, voxAlbedo, paintMouth, mouthBox, isKind, chainHeadVox, chainSegColor, emotionParams } from './fishart.js';
import { PixelBuffer } from './pixel.js';
import { makeCanvas, ctxOf } from '../core/canvas.js';
import { drawFishRig } from './fishrig.js';
import { drawPellets, wakkaRig } from '../fish/wakka.js';

export const VP = 2;               // target on-screen pixels per voxel
const SCALE_STEP = 1.09;           // on-screen scale buckets (drawn scaled to the exact size)
export const YAW_STEP = 15;        // degrees per canonical yaw bucket (-90..90)
const PITCH_STEP = 10;             // degrees per pitch bucket
const PITCH_MAX = 3;
const CHAIN_PITCH_STEP = 15;
const CHAIN_PITCH_MAX = 6;
const CAM_TILT = 16;               // we look slightly down onto the fish
export const SWIM_N = 6;           // tail-beat frames
const KIND_N = 6;                  // animation frames for kinds (legs, tentacles...)
const INFL_N = 3;                  // inflate steps: 0, 1/3, 2/3, 1
const MAX_VOX_LEN = 120;           // cap on model length (voxels): giants get chunkier voxels
const FRAME_PX_MAX = 16e6;         // frame cache budget (pixels)
const GRID_BYTES_MAX = 64e6;
const LAYOUT_MAX = 260;
const TAIL_NEUTRAL = 1 - 0.7 / (Math.PI * 2); // tail painter phase with no 2D flap

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const fract = (v) => v - Math.floor(v);
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

const SHAPE_K = { oval: 0.52, torpedo: 0.6, round: 0.8, disc: 0.3, long: 0.62, box: 0.72, blunt: 0.62, pointy: 0.48 };
const KIND_K = { star: 0.34, crab: 0.72, seahorse: 0.55, ray: 0.16, squid: 0.62, isopod: 0.78, iconfish: 0.42, octopus: 1, jelly: 1, pudding: 1, blob: 0.9, chain: 0.85 };
const REVOLVE = new Set(['jelly', 'pudding', 'octopus']);
const FRONT_KINDS = new Set(['crab', 'jelly', 'pudding', 'octopus', 'star', 'ray']);

// ------------------------------------------------------------------ budget

let budgetMs = 3.2, spent = 0, forceSpent = 0, rafOn = false, lastReset = 0;
let statBuilt = 0, statFallback = 0, statJobs = 0, statPx = 0, workTotal = 0;
const FORCE_MS = 20;               // extra per-frame allowance to get a creature's very first frame
let syncAll = false;
/** Build every requested frame synchronously (dev stills / one-shot renders). */
export function setVoxelSync(on) { syncAll = !!on; }
const WARM_MS = 1;                 // idle warm-up per animation frame

export function setVoxelFishBudget(ms) { budgetMs = ms; }
export function beginVoxelFishFrame() { if (!rafOn) { spent = 0; forceSpent = 0; } }
if (typeof window !== 'undefined') window.__voxStats = () => voxelFishStats();
export function voxelFishStats() {
  return { workMs: +workTotal.toFixed(1), frames: frames.size, framePx: statPx, grids: grids.size, layouts: layouts.size, jobs: jobs.size, built: statBuilt, fallbacks: statFallback, jobsStarted: statJobs, spent: +spent.toFixed(2), warm: warmQ.length };
}
function ensureTick() {
  if (rafOn || typeof requestAnimationFrame === 'undefined') return;
  rafOn = true;
  const tick = () => {
    requestAnimationFrame(tick);
    spent = 0; forceSpent = 0; lastReset = now();
    try { runWants(); runWarm(); } catch (e) { console.warn('voxelfish', e); wants.clear(); warmQ.length = 0; }
  };
  requestAnimationFrame(tick);
}
function overBudget() {
  if (!rafOn) { const t = now(); if (t - lastReset > 15) { lastReset = t; spent = 0; forceSpent = 0; } }
  return spent >= budgetMs;
}

// ------------------------------------------------------------------ ids / keys

let nextVid = 1;
const vidOf = (c) => c._vid || (c._vid = nextVid++);

function lookLen(c) {
  if (c.kind === 'chain') return (c.chain?.r || 4) * 5;
  return Math.max(c.L || 30, c.H || 20) * 1.5;
}

// Model resolution level (voxels per look px = 2^(rk/2)) for a scale bucket.
function resLevel(c, Sb) {
  let rk = Math.round(2 * Math.log2(Sb / VP));
  const cap = Math.floor(2 * Math.log2(MAX_VOX_LEN / lookLen(c)));
  return clamp(Math.min(rk, cap), -6, 4);
}
export const scaleBucket = (S) => Math.round(Math.log(Math.max(0.05, S)) / Math.log(SCALE_STEP));
const bucketScale = (sb) => Math.pow(SCALE_STEP, sb);

// ------------------------------------------------------------------ palette

// Voxel roles: shading model per voxel.
export const R_BODY = 0, R_FIN = 1, R_EYE = 2, R_MOUTH = 3, R_THIN = 4, R_LIMB = 5, R_SPEC = 6, R_GLASS = 7, R_PUPIL = 8, R_CHROME = 9;

class Pal {
  constructor(mat) {
    this.map = new Map();
    this.rgb = [0]; this.alpha = [1]; this.role = [0]; this.em = [0];
    this.ramps = [null];
    this.mat = mat || DEF_MAT;
  }
  // role: see R_* above. Fins become glassy membranes (rays/edges stay solid); glass bodies are see-through.
  idx(col, role, glow) {
    const a = col >>> 24;
    let aq = a >= 235 ? 4 : a >= 170 ? 3 : a >= 110 ? 2 : 1;
    if (role === R_FIN && aq < 4) aq = 2;
    if (role === R_GLASS) aq = 1;
    const key = (col & 0xffffff) + 16777216 * (role + 16 * aq + (glow ? 128 : 0));
    let i = this.map.get(key);
    if (i !== undefined) return i;
    if (this.rgb.length >= 65000) return 1;
    i = this.rgb.length;
    this.rgb.push(col & 0xffffff);
    const m = this.mat;
    this.alpha.push(role === R_GLASS ? 0.5 : role === R_FIN ? (aq === 4 ? 0.9 : m.finGlass) : aq === 4 ? 1 : aq === 3 ? 0.86 : aq === 2 ? 0.7 : 0.55);
    this.role.push(role);
    this.em.push(glow ? 1 : 0);
    this.ramps.push(null);
    this.map.set(key, i);
    return i;
  }
}

// Creature material (look.vox): Frutiger Aero gloss, iridescent sheen, glassy aqua fins, chrome, glass bodies.
const DEF_MAT = { gloss: 0.8, iri: 0.14, chrome: 0, glass: 0, finGlass: 0.84, finTint: 0.14, sheen: 1, scales: false, rim: 1 };
const VIVID = 0.32;
export function matOf(c) {
  if (c._vmat) return c._vmat;
  const v = c.look.vox || {};
  const kind = c.kind;
  const m = {
    ...DEF_MAT,
    gloss: v.gloss ?? (kind === 'isopod' || kind === 'crab' ? 0.9 : kind === 'blob' ? 0.55 : 0.75),
    iri: v.iri ?? (c.variant?.shiny ? 0.5 : 0.16),
    chrome: v.chrome ?? 0,
    glass: v.glass ?? 0,
    finGlass: v.finGlass ?? DEF_MAT.finGlass,
    finTint: v.finTint ?? DEF_MAT.finTint,
    sheen: v.sheen ?? 1,
    rim: v.rim ?? 1,
    scales: !!c.scales,
  };
  if (c.variant?.mutation === 'ghost') { m.glass = Math.max(m.glass, 0.45); m.iri = Math.max(m.iri, 0.4); }
  c._vmat = m;
  return m;
}

// Hue-shifted tone ramp: shadows drift cool/purple, highlights warm. t in -1..1, 21 steps.
function rampOf(pal, v) {
  let r = pal.ramps[v];
  if (r) return r;
  r = new Uint32Array(21);
  const c = pal.rgb[v];
  const R = c & 255, G = (c >>> 8) & 255, B = (c >>> 16) & 255;
  for (let i = 0; i < 21; i++) {
    const t = (i - 10) / 10;
    let r2, g2, b2;
    if (t < 0) {
      const k = Math.pow(-t, 0.92);
      r2 = R + (R * 0.26 + 12 - R) * k; g2 = G + (G * 0.3 + 10 - G) * k; b2 = B + (B * 0.46 + 40 - B) * k;
    } else {
      const k = Math.pow(t, 1.12);
      r2 = R + (Math.min(255, R + (255 - R) * 0.66 + 8) - R) * k;
      g2 = G + (Math.min(255, G + (255 - G) * 0.64 + 6) - G) * k;
      b2 = B + (Math.min(255, B + (255 - B) * 0.58) - B) * k;
      // mid-light tones get a touch more saturation
      const sat = 0.12 * Math.sin(Math.PI * Math.min(1, t * 1.6));
      const m = (r2 + g2 + b2) / 3;
      r2 += (r2 - m) * sat; g2 += (g2 - m) * sat; b2 += (b2 - m) * sat;
    }
    r[i] = (0xff000000 | (clamp(Math.round(b2), 0, 255) << 16) | (clamp(Math.round(g2), 0, 255) << 8) | clamp(Math.round(r2), 0, 255)) >>> 0;
  }
  pal.ramps[v] = r;
  return r;
}

// ------------------------------------------------------------------ layout (2D, per res level)

function place(ras, ox, oy, GW, GH) {
  const col = new Uint32Array(GW * GH);
  const glow = ras.glow ? new Uint8Array(GW * GH) : null;
  for (let y = 0; y < ras.h; y++) {
    const gy = y + oy;
    if (gy < 0 || gy >= GH) continue;
    for (let x = 0; x < ras.w; x++) {
      const gx = x + ox;
      if (gx < 0 || gx >= GW) continue;
      const p = ras.data[y * ras.w + x];
      if ((p >>> 24) < 40) continue;
      col[gy * GW + gx] = p;
      if (glow && ras.glow[y * ras.w + x]) glow[gy * GW + gx] = 1;
    }
  }
  return { col, glow };
}

// Squared Euclidean distance transform (Felzenszwalb-Huttenlocher), in place on f (0 outside, INF inside).
function edt1d(f, n, d, v, z) {
  let k = 0;
  v[0] = 0; z[0] = -1e20; z[1] = 1e20;
  for (let q = 1; q < n; q++) {
    let s;
    for (;;) {
      const p = v[k];
      s = ((f[q] + q * q) - (f[p] + p * p)) / (2 * q - 2 * p);
      if (s <= z[k] && k > 0) k--; else break;
    }
    if (s <= z[k]) { k = 0; v[0] = q; z[0] = -1e20; z[1] = 1e20; continue; }
    k++; v[k] = q; z[k] = s; z[k + 1] = 1e20;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const p = v[k];
    d[q] = (q - p) * (q - p) + f[p];
  }
}
function distanceField(mask, W, H) {
  const INF = 1e12;
  const g = new Float64Array(W * H);
  for (let i = 0; i < W * H; i++) g[i] = mask[i] ? INF : 0;
  const n = Math.max(W, H) + 2;
  const f = new Float64Array(n), d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) f[y] = g[y * W + x];
    edt1d(f, H, d, v, z);
    for (let y = 0; y < H; y++) g[y * W + x] = d[y];
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) f[x] = g[y * W + x];
    edt1d(f, W, d, v, z);
    for (let x = 0; x < W; x++) g[y * W + x] = d[x];
  }
  const D = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) D[i] = mask[i] ? Math.sqrt(g[i]) - 0.5 : -1;
  return D;
}

// Rasterising the procedural look is the expensive part: it runs once per creature at a source
// resolution (one layer per step, so it spreads over frames) and lower levels are resampled from it.
class RasterJob {
  constructor(c, r, infl, pose, kf) {
    this.c = c; this.r = r; this.infl = infl; this.pose = pose; this.kf = kf;
    this.kind = isKind(c) ? c.kind : null;
    this.ph = this.kind ? kf / KIND_N : 0;
    this.geo = rigGeom(c, { sw: this.ph, angle: 0, scale: r, inflate: this.kind ? 0 : infl, still: true, pose });
    this.PAD = 2;
    this.GW = this.geo.w + 4; this.GH = this.geo.h + 4;
    this.L = {};
    this.todo = rigLayers(c).map((ly) => ly.id);
    this.done = false;
  }
  step() {
    const id = this.todo.shift();
    if (id) {
      const lp = this.kind ? this.ph : id === 'tail' ? TAIL_NEUTRAL : 0;
      const ras = rasterLayerVox(this.c, id, { ph: lp, angle: 0, scale: this.r, inflate: this.kind ? 0 : this.infl, still: true, pose: this.pose });
      if (ras.data) this.L[id] = place(ras, ras.x + this.PAD, ras.y + this.PAD, this.GW, this.GH);
    }
    if (!this.todo.length) this.done = true;
    return this.done;
  }
}

// Resample a raster set to a lower resolution (footprint mode of opaque colours).
function resampleRaster(R, f) {
  const PAD = 2;
  const sw = R.GW - 4, sh = R.GH - 4;
  const tw = Math.max(1, Math.round(sw * f)), th = Math.max(1, Math.round(sh * f));
  const GW = tw + 4, GH = th + 4;
  const fx = sw / tw, fy = sh / th;
  const L = {};
  const counts = new Map();
  for (const [id, ly] of Object.entries(R.L)) {
    const col = new Uint32Array(GW * GH);
    const glow = ly.glow ? new Uint8Array(GW * GH) : null;
    for (let ty = 0; ty < th; ty++) {
      const y0 = Math.floor(ty * fy), y1 = Math.max(y0 + 1, Math.floor((ty + 1) * fy));
      for (let tx = 0; tx < tw; tx++) {
        const x0 = Math.floor(tx * fx), x1 = Math.max(x0 + 1, Math.floor((tx + 1) * fx));
        counts.clear();
        let n = 0, tot = 0, gl = false, best = 0, bn = 0;
        for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
          const i = (y + PAD) * R.GW + x + PAD;
          tot++;
          const p = ly.col[i];
          if (!p) continue;
          n++;
          if (glow && ly.glow[i]) gl = true;
          const k = counts.get(p) || 0;
          counts.set(p, k + 1);
          if (k + 1 > bn) { bn = k + 1; best = p; }
        }
        if (!n || n < tot * 0.4) continue;
        const o = (ty + PAD) * GW + tx + PAD;
        col[o] = best;
        if (gl) glow[o] = 1;
      }
    }
    L[id] = { col, glow };
  }
  const geo = R.geo;
  const sc = (v) => v * f;
  return {
    r: R.r * f, GW, GH, PAD, L,
    geo: {
      w: tw, h: th, ox: sc(geo.ox), oy: sc(geo.oy),
      eyes: (geo.eyes || []).map((e) => ({ ...e, x: sc(e.x), y: sc(e.y), r: e.r * f })),
      gill: geo.gill ? { ...geo.gill, pts: geo.gill.pts.map(([x, y]) => [sc(x), sc(y)]) } : null,
      mouth: geo.mouth ? { ...geo.mouth, x: sc(geo.mouth.x), y: sc(geo.mouth.y), w: geo.mouth.w * f } : null,
      anchors: Object.fromEntries(Object.entries(geo.anchors || {}).map(([k, v]) => [k, Array.isArray(v) ? [sc(v[0]), sc(v[1])] : v])),
    },
  };
}

function buildLayout(c, R, infl, kf) {
  const kind = isKind(c) ? c.kind : null;
  const { r, geo, PAD, GW, GH, L } = R;
  const N = GW * GH;
  const body = L.body?.col || new Uint32Array(N);
  const mask = new Uint8Array(N);
  const thr = kind ? 60 : Math.min(110, Math.round((c.alpha ?? 255) * 0.75));
  for (let i = 0; i < N; i++) if ((body[i] >>> 24) >= thr) mask[i] = 1;
  // thickness
  let k = kind ? KIND_K[kind] ?? 0.6 : SHAPE_K[c.look.body?.shape || 'oval'] ?? 0.5;
  if (c.look.body?.thick) k = c.look.body.thick;
  if (c.look.vox?.thick) k = c.look.vox.thick;
  if (infl > 0) k = k + (0.96 - k) * infl;
  const T = new Float32Array(N).fill(-1);
  const revolve = REVOLVE.has(kind);
  if (revolve) {
    let sx = 0, n = 0;
    for (let i = 0; i < N; i++) if (mask[i]) { sx += i % GW; n++; }
    const axis = n ? sx / n + 0.5 : GW / 2;
    for (let gy = 0; gy < GH; gy++) {
      let a = -1, b = -1;
      for (let gx = Math.floor(axis); gx >= 0 && mask[gy * GW + gx]; gx--) a = gx;
      for (let gx = Math.floor(axis); gx < GW && mask[gy * GW + gx]; gx++) b = gx;
      if (a < 0 || b < 0) {
        // rows that miss the axis (e.g. tentacle tips): plain thin slab
        for (let gx = 0; gx < GW; gx++) if (mask[gy * GW + gx]) T[gy * GW + gx] = 0.6;
        continue;
      }
      const mid = (a + b + 1) / 2, rr = (b - a + 1) / 2;
      for (let gx = 0; gx < GW; gx++) {
        if (!mask[gy * GW + gx]) continue;
        const d = gx + 0.5 - mid;
        T[gy * GW + gx] = gx >= a && gx <= b ? Math.sqrt(Math.max(0, rr * rr - d * d)) * 0.94 : 0.6;
      }
    }
  } else {
    const D = distanceField(mask, GW, GH);
    // ridge depth: min of the row / column run maxima -> elliptical cross-section of the narrow width
    const colMax = new Float32Array(N), rowMax = new Float32Array(N);
    for (let gx = 0; gx < GW; gx++) {
      let a = -1;
      for (let gy = 0; gy <= GH; gy++) {
        const on = gy < GH && mask[gy * GW + gx];
        if (on && a < 0) a = gy;
        if (!on && a >= 0) { let mx = 0; for (let y = a; y < gy; y++) mx = Math.max(mx, D[y * GW + gx]); for (let y = a; y < gy; y++) colMax[y * GW + gx] = mx; a = -1; }
      }
    }
    for (let gy = 0; gy < GH; gy++) {
      let a = -1;
      for (let gx = 0; gx <= GW; gx++) {
        const on = gx < GW && mask[gy * GW + gx];
        if (on && a < 0) a = gx;
        if (!on && a >= 0) { let mx = 0; for (let x = a; x < gx; x++) mx = Math.max(mx, D[gy * GW + x]); for (let x = a; x < gx; x++) rowMax[gy * GW + x] = mx; a = -1; }
      }
    }
    for (let i = 0; i < N; i++) {
      if (!mask[i]) continue;
      const d = Math.max(0, D[i]), dm = Math.max(0.5, Math.min(colMax[i], rowMax[i]));
      T[i] = k * Math.sqrt(Math.max(0, d * (2 * dm - d))) * 1.06;
    }
  }
  let maxT = 0;
  for (let i = 0; i < N; i++) if (T[i] > maxT) maxT = T[i];
  const [Tx, Ty] = thicknessGradient(T, mask, GW, GH);
  // eyes: real voxel eyeballs (no painted faces). The grid bakes a neutral eyeball dome; up close the rig
  // draws dynamic voxel eye parts (lids, gaze, pupils) over it, see eyePart().
  const eyeCol = null, eyeGlow = null;
  const eyes = [];
  const sampleBody = (x, y) => {
    const bc = L.body?.col;
    if (bc) for (let d = 0; d < 6; d++) for (const [ax, ay] of [[0, -d], [0, d], [-d, 0], [d, 0]]) {
      const gx = Math.round(x + ax), gy = Math.round(y + ay);
      if (gx < 0 || gy < 0 || gx >= GW || gy >= GH) continue;
      const p = bc[gy * GW + gx];
      if ((p >>> 24) >= 120) {
        // cartoon lids use the skin colour; skip dark pattern bands / outlines
        const lum = (p & 255) * 0.3 + ((p >>> 8) & 255) * 0.59 + ((p >>> 16) & 255) * 0.11;
        if (lum < 70 && c.bodyR?.[2]) return c.bodyR[2] | 0xff000000;
        return p | 0xff000000;
      }
    }
    return c.bodyR?.[2] ?? 0xff8899aa;
  };
  const frontKind = FRONT_KINDS.has(kind) || (!!kind && (geo.eyes || []).some((e) => e.mirror));
  for (const ev of geo.eyes || []) {
    const R = Math.max(0.6, ev.r);
    const ex = ev.x + PAD, ey = ev.y + PAD;
    const gi = Math.floor(ey) * GW + Math.floor(ex);
    const inMask = gi >= 0 && gi < N && !!mask[gi];
    eyes.push({
      x: ex, y: ey, rv: R, rLook: R / r, e: ev.e, idx: ev.idx, mirror: ev.mirror, cheek: ev.cheek, main: ev.main,
      front: frontKind, stalk: !inMask,
      lidU: sampleBody(ex, ey - R * 1.35), lidL: sampleBody(ex, ey + R * 1.35), skin: sampleBody(ex + R * 1.4, ey),
    });
  }
  const mouthCol = new Uint32Array(N);
  let mouth = null;
  if (geo.mouth && geo.mouth.m && geo.mouth.m.type !== 'none' && geo.mouth.w >= 1) {
    const mo = geo.mouth;
    const hb = mouthBox(mo.w);
    const buf = new PixelBuffer(hb * 2, hb * 2);
    voxAlbedo(() => paintMouth(buf, hb, hb, c, mo.m, { emotion: 'neutral', open: 0, time: 0 }, 0, mo.w, mo.front));
    const ox = Math.round(mo.x) - hb + PAD, oy = Math.round(mo.y) - hb + PAD;
    for (let y = 0; y < buf.h; y++) for (let x = 0; x < buf.w; x++) {
      const p = buf.data[y * buf.w + x];
      if ((p >>> 24) < 100) continue;
      const gx = x + ox, gy = y + oy;
      if (gx >= 0 && gy >= 0 && gx < GW && gy < GH) mouthCol[gy * GW + gx] = p | 0xff000000;
    }
    mouth = { x: mo.x + PAD, y: mo.y + PAD, wLook: mo.w / r, m: mo.m, front: mo.front };
  }
  const anchors = {};
  for (const [k2, v] of Object.entries(geo.anchors || {})) if (Array.isArray(v)) anchors[k2] = [v[0] + PAD, v[1] + PAD];
  // spine extents for the swim bend
  let nose = -1, bodyTail = GW, tailEnd = GW;
  for (let i = 0; i < N; i++) if (mask[i]) { const gx = i % GW; if (gx > nose) nose = gx; if (gx < bodyTail) bodyTail = gx; }
  if (L.tail) for (let i = 0; i < N; i++) if (L.tail.col[i]) { const gx = i % GW; if (gx < tailEnd) tailEnd = gx; }
  tailEnd = Math.min(tailEnd, bodyTail);
  // pectoral hinge (front layer, generic fish): its front-most column
  let pecRoot = -1, pecMin = GW;
  if (!kind && L.front) for (let i = 0; i < N; i++) if (L.front.col[i]) { pecRoot = Math.max(pecRoot, i % GW); pecMin = Math.min(pecMin, i % GW); }
  const gill = !kind && geo.gill && c.gills && !c.look.noGill ? geo.gill.pts.map(([x, y]) => [x + PAD, y + PAD]) : null;
  // wind-turbine rotors (look.rotor): mast from the back at u (0 nose .. 1 tail), hub h px above it
  const rotors = [];
  for (const q of [].concat(c.look.rotor || [])) {
    const x = Math.round(nose - (q.u ?? 0.45) * (nose - bodyTail));
    let top = -1;
    for (let gy = 0; gy < GH && x >= 0 && x < GW; gy++) if (mask[gy * GW + x]) { top = gy; break; }
    if (top < 0) continue;
    const R = (q.r ?? 12) * r, h = (q.h ?? 10) * r;
    const front = Math.max(2, Math.round(R * 0.16 + 1.5));
    rotors.push({
      x, top: top + 1, hy: Math.max(1, top - h), R, rm: Math.max(0.6, (q.mastW ?? 2) * r * 0.5), rn: Math.max(0.9, R * 0.12), front,
      blades: q.blades ?? 3, speed: q.speed ?? 1.2, chord: q.chord ?? 0.13,
      mastP: hexP(c.vc(q.mast || '#eef4fa')), hubP: hexP(c.vc(q.hub || '#e2eaf2')), bladeP: hexP(c.vc(q.color || '#f7fafd')), tipP: q.tip ? hexP(c.vc(q.tip)) : 0,
      zReach: front + 3,
    });
  }
  const mat = matOf(c);
  return {
    c, kind, revolve, r, GW, GH, PAD, L, mask, T, Tx, Ty, maxT, eyeCol, eyeGlow, mouthCol, eyes, mouth, anchors, gill, mat, rotors: rotors.length ? rotors : null,
    origin: [geo.ox + PAD, geo.oy + PAD], nose, bodyTail, tailEnd, pecRoot, pecLen: Math.max(0, pecRoot - pecMin),
    wave: c.wave ?? 0.5, pal: new Pal(mat), bytes: N * 40,
  };
}

// Gradient of the (lightly blurred) thickness field: analytic flank normals n ~ (-Tx, Ty, +-1).
function thicknessGradient(T, mask, W, H) {
  const N = W * H;
  const at = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : Math.max(0, T[y * W + x]));
  const B = new Float32Array(N);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (!mask[i]) continue;
    B[i] = (at(x, y) * 4 + at(x - 1, y) + at(x + 1, y) + at(x, y - 1) + at(x, y + 1)) / 8;
  }
  const b = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : B[y * W + x]);
  const Tx = new Float32Array(N), Ty = new Float32Array(N);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (!mask[i]) continue;
    Tx[i] = (b(x + 1, y) - b(x - 1, y)) / 2;
    Ty[i] = (b(x, y + 1) - b(x, y - 1)) / 2;
  }
  return [Tx, Ty];
}

// Chain head: painted head extruded with per-column elliptical thickness.
function buildChainLayout(c, r) {
  const hv = chainHeadVox(c, r);
  const PAD = 2;
  const GW = hv.w + PAD * 2, GH = hv.h + PAD * 2, N = GW * GH;
  const col = new Uint32Array(N);
  const mask = new Uint8Array(N);
  for (let y = 0; y < hv.h; y++) for (let x = 0; x < hv.w; x++) {
    const p = hv.data[y * hv.w + x];
    if ((p >>> 24) < 60) continue;
    col[(y + PAD) * GW + x + PAD] = p;
    mask[(y + PAD) * GW + x + PAD] = 1;
  }
  const T = new Float32Array(N).fill(-1);
  let maxT = 0;
  for (let gx = 0; gx < GW; gx++) {
    let a = -1, b = -1;
    for (let gy = 0; gy < GH; gy++) if (mask[gy * GW + gx]) { if (a < 0) a = gy; b = gy; }
    if (a < 0) continue;
    const hh = (b - a + 1) / 2, mid = (a + b + 1) / 2;
    for (let gy = a; gy <= b; gy++) {
      if (!mask[gy * GW + gx]) continue;
      const e = (gy + 0.5 - mid) / hh;
      const t = hh * 0.85 * Math.sqrt(Math.max(0, 1 - e * e));
      T[gy * GW + gx] = t;
      if (t > maxT) maxT = t;
    }
  }
  const o = hv.o + PAD;
  const [Tx, Ty] = thicknessGradient(T, mask, GW, GH);
  const skin = c.bodyR?.[2] ?? 0xff8899aa;
  const eyes = hv.face.eyes.map((ev) => ({ x: ev.x + PAD, y: ev.y + PAD, rv: ev.r, rLook: ev.r / r, e: ev.e, idx: ev.idx, mirror: ev.mirror, cheek: ev.cheek, main: ev.main, front: false, stalk: false, lidU: skin, lidL: c.bellyR?.[3] ?? skin, skin }));
  const mo = hv.face.mouth;
  return {
    c, kind: 'chain', revolve: false, r, GW, GH, PAD, L: { body: { col, glow: null } }, mask, T, Tx, Ty, maxT,
    eyeCol: new Uint32Array(N), eyeGlow: new Uint8Array(N), mouthCol: new Uint32Array(N), eyes,
    mouth: mo ? { x: mo.x + PAD, y: mo.y + PAD, wLook: mo.w / r, m: mo.m, front: mo.front } : null,
    anchors: { mouth: [hv.face.nose[0] + PAD, hv.face.nose[1] + PAD], top: [o, o - c.chain.r * r * 1.2], bottom: [o, o + c.chain.r * r * 1.2], tail: [o - c.chain.r * r, o] },
    origin: [o, o], nose: GW - 1, bodyTail: 0, tailEnd: 0, pecRoot: -1, wave: 0, mat: matOf(c), pal: new Pal(matOf(c)), bytes: N * 30,
  };
}

// ------------------------------------------------------------------ grid (3D, per swim frame)

function buildGrid(Lo, sw) {
  const { c, kind, GW, GH, L, mask, T, maxT, eyeCol, eyeGlow, mouthCol, pal } = Lo;
  const fish = !kind;
  const ph = sw / SWIM_N;
  // spine: travelling wave, arc-length compressed so the tail sweep reads side-on
  const bodyLen = Math.max(4, Lo.nose - Lo.bodyTail);
  const amp = fish ? (0.05 + 0.1 * clamp01(Lo.wave)) * bodyLen : 0;
  const total = Math.max(1, Lo.nose - Lo.tailEnd + 2);
  const off = (u) => {
    if (u <= 1) return amp * u * u * Math.sin(TAU * ph - u * 3.2);
    const o1 = amp * Math.sin(TAU * ph - 3.2);
    const d1 = amp * (2 * Math.sin(TAU * ph - 3.2) - 3.2 * Math.cos(TAU * ph - 3.2));
    return o1 + d1 * (u - 1);
  };
  const srcOf = new Int32Array(GW), zOf = new Int16Array(GW);
  for (let gx = 0; gx < GW; gx++) { srcOf[gx] = gx; zOf[gx] = 0; }
  if (fish && amp > 0.3) {
    // integrate the spine from the nose backwards
    const X = new Float32Array(total + 1), Z = new Float32Array(total + 1);
    X[0] = Lo.nose + 0.5; Z[0] = 0;
    for (let s = 0; s < total; s++) {
      const u0 = s / bodyLen, u1 = (s + 1) / bodyLen;
      const dz = off(u1) - off(u0);
      const th = Math.atan(dz);
      X[s + 1] = X[s] - Math.cos(th);
      Z[s + 1] = Z[s] + Math.sin(th);
    }
    let s = 0;
    for (let tx = Lo.nose; tx >= 0; tx--) {
      const cx = tx + 0.5;
      while (s < total && Math.abs(X[s + 1] - cx) <= Math.abs(X[s] - cx)) s++;
      if (s >= total && X[total] - cx > 0.75) { srcOf[tx] = -1; continue; }
      srcOf[tx] = Lo.nose - s;
      zOf[tx] = Math.round(Z[s]);
    }
  }
  let bendMax = 0;
  for (let gx = 0; gx < GW; gx++) bendMax = Math.max(bendMax, Math.abs(zOf[gx]));
  // pectoral hinge flap (generic fish)
  const pecA = 0.42 + 0.32 * Math.sin(TAU * ph + 1.1) + (Lo.c.look.vox?.pecFlare ?? 0);
  const pecReach = Lo.pecRoot >= 0 && L.front ? Lo.pecLen || 0 : 0;
  let eyeOut = 0;
  for (const e of Lo.eyes) eyeOut = Math.max(eyeOut, e.rv * (e.stalk ? 1.1 : 0.75) + 1);
  const rot = Lo.rotors;
  const rotOut = rot ? Math.max(...rot.map((q) => q.zReach)) : 0;
  const orbOut = Lo.c.look.orb ? (Lo.c.look.orb.r ?? Math.max(Lo.c.L * 0.62, Lo.c.H * 1.1)) * Lo.r + 1 : 0;
  const NZ = 2 * (Math.ceil(Math.max(maxT + eyeOut, rotOut, orbOut)) + bendMax + 4 + Math.ceil(pecReach * 0.6)) + 3;
  const zc = NZ >> 1;
  const NX = GW, NY = GH, NXY = NX * NY;
  const data = new Uint16Array(NXY * NZ);
  const zmin = new Int16Array(NXY).fill(32767), zmax = new Int16Array(NXY).fill(-1);
  const set = (x, gy, z, v) => {
    if (x < 0 || x >= NX || z < 0 || z >= NZ) return;
    const y = NY - 1 - gy;
    const col = x + y * NX;
    data[col + z * NXY] = v;
    if (z < zmin[col]) zmin[col] = z;
    if (z > zmax[col]) zmax[col] = z;
  };
  const clear = (x, gy, z) => {
    if (x < 0 || x >= NX || z < 0 || z >= NZ) return;
    data[x + (NY - 1 - gy) * NX + z * NXY] = 0;
  };
  const tAt = (gx, gy) => (gx < 0 || gy < 0 || gx >= GW || gy >= GH ? -1 : T[gy * GW + gx]);
  const glowOf = (ly, i) => !!(ly.glow && ly.glow[i]);
  // body (soap-bubble creatures: a see-through iridescent glass body)
  const bcol = L.body?.col;
  const glassBody = (Lo.mat.glass ?? 0) >= 0.5;
  for (let tx = 0; tx < GW; tx++) {
    const gx = srcOf[tx];
    if (gx < 0) continue;
    const zo = zOf[tx];
    for (let gy = 0; gy < GH; gy++) {
      const i = gy * GW + gx;
      if (!mask[i]) continue;
      const t = T[i];
      const zr = Math.max(0, Math.round(t));
      const thin = t < 0.9;
      const pv = pal.idx(bcol[i] | 0xff000000, glassBody ? R_GLASS : thin && !kind ? 4 : 0, glowOf(L.body, i));
      for (let z = -zr; z <= zr; z++) set(tx, gy, zc + z + zo, pv);
      // closed mouth: a groove cut into both flanks
      const mc = mouthCol[i];
      if (mc) {
        const pm = pal.idx(mc, R_MOUTH, false);
        if (zr >= 2 && !kind) {
          set(tx, gy, zc + zr - 1 + zo, pm); set(tx, gy, zc - zr + 1 + zo, pm);
          clear(tx, gy, zc + zr + zo); clear(tx, gy, zc - zr + zo);
        } else { set(tx, gy, zc + zr + zo, pm); set(tx, gy, zc - zr + zo, pm); }
      }
    }
  }
  // mouths outside the body mask (faces on thin parts): stamp on the centre plane
  for (let gy = 0; gy < GH; gy++) for (let gx = 0; gx < GW; gx++) {
    const i = gy * GW + gx;
    if (mask[i] || !mouthCol[i]) continue;
    const pv = pal.idx(mouthCol[i], R_MOUTH, false);
    for (let z = -1; z <= 1; z++) set(gx, gy, zc + z + zOfSrc(srcOf, zOf, gx), pv);
  }
  // fins and limbs
  const kindZ = Math.max(1, Math.round(maxT * 0.6));
  for (const id of ['tail', 'back', 'front']) {
    const ly = L[id];
    if (!ly) continue;
    const colA = ly.col;
    if (fish && id === 'front') {
      // pectoral: hinged at its front edge, swung out from both flanks
      const root = Lo.pecRoot;
      const ca = Math.cos(pecA), sa = Math.sin(pecA);
      for (let gy = 0; gy < GH; gy++) for (let gx = 0; gx < GW; gx++) {
        const i = gy * GW + gx;
        const p = colA[i];
        if (!p) continue;
        const d = root - gx;
        const tx = Math.round(root - d * ca);
        // body thickness under the fin's root, at this height
        let tb = tAt(root, gy);
        if (tb < 0) { for (let k2 = 1; k2 < 8 && tb < 0; k2++) tb = Math.max(tAt(root - k2, gy), tAt(root, gy - k2), tAt(root, gy + k2)); }
        if (tb < 0) tb = maxT * 0.5;
        const zo = zOfSrc(srcOf, zOf, tx);
        const zz = Math.round(tb) + 1 + Math.round(d * sa * 0.85);
        const pv = pal.idx(p, 1, glowOf(ly, i));
        set(tx, gy, zc + zz + zo, pv);
        set(tx, gy, zc - zz + zo, pv);
      }
      continue;
    }
    for (let tx = 0; tx < GW; tx++) {
      const gx = fish ? srcOf[tx] : tx;
      if (gx < 0) continue;
      const zo = fish ? zOf[tx] : 0;
      for (let gy = 0; gy < GH; gy++) {
        const i = gy * GW + gx;
        const p = colA[i];
        if (!p) continue;
        if (fish) {
          if (mask[i] && T[i] >= 0.9) continue; // inside the body
          set(tx, gy, zc + zo, pal.idx(p, 1, glowOf(ly, i)));
          continue;
        }
        // kinds: back layer behind, front layer in front (on the body surface where they overlap it)
        const pv = pal.idx(p | ((p >>> 24) >= 200 ? 0xff000000 : 0), (p >>> 24) >= 200 ? 5 : 1, glowOf(ly, i));
        const t = mask[i] ? Math.round(T[i]) + 1 : 0;
        if (id === 'tail' || ((kind === 'ray' || kind === 'squid') && id === 'back')) { set(tx, gy, zc, pv); continue; }
        const sgn = id === 'back' ? -1 : 1;
        const z0 = mask[i] ? t : kindZ;
        set(tx, gy, zc + sgn * z0, pv);
        set(tx, gy, zc + sgn * (z0 + 1), pv);
      }
    }
  }
  // wind-turbine masts + nacelles (rotors spin as dynamic parts, see rotorPart)
  for (const q of Lo.rotors || []) {
    const tx = clamp(Math.round(q.x), 0, NX - 1), zo = zOf[tx];
    const pm = pal.idx(q.mastP, R_BODY, false), ph = pal.idx(q.hubP, R_BODY, false);
    for (let gy = Math.floor(q.top); gy >= Math.floor(q.hy); gy--) {
      const f = (q.top - gy) / Math.max(1, q.top - q.hy);
      const rm = q.rm * (1 - 0.4 * f);
      for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) if (dx * dx + dz * dz <= rm * rm + 0.3) set(tx + dx, gy, zc + zo + dz, pm);
    }
    for (let z = -Math.round(q.rn); z <= q.front - 1; z++) {
      const tip = z < 0 ? Math.sqrt(Math.max(0, 1 - (z / (q.rn + 0.5)) ** 2)) : 1;
      for (let dx = -3; dx <= 3; dx++) for (let dy = -3; dy <= 3; dy++) if (dx * dx + dy * dy <= (q.rn * tip) ** 2 + 0.3) set(tx + dx, Math.round(q.hy) + dy, zc + zo + z, ph);
    }
  }
  // silly outfits and gadgets
  if (fish && c.look.sneakers) stampSneakers(Lo, c.look.sneakers, ph, { set, NY, zc, maxT, mask, GW, GH, NZ });
  if (c.look.orb) stampOrb(Lo, c.look.orb, { set, NX, NY, NZ, zc, maxT, mask, GW, GH });
  // voxel eyeballs: neutral domes set into the head (dynamic eye parts are drawn over them up close)
  const eyes3 = [];
  for (const e of Lo.eyes) {
    const gx = clamp(Math.floor(e.x), 0, GW - 1), gy = clamp(Math.floor(e.y), 0, GH - 1);
    let tx = gx;
    if (fish) { let bd = 1e9; for (let x = 0; x < NX; x++) { const d = Math.abs(srcOf[x] - gx); if (srcOf[x] >= 0 && d < bd) { bd = d; tx = x; } } }
    const zo = zOf[tx];
    const T0 = Math.max(0, tAt(gx, gy));
    const rb = Math.max(0.7, e.rv * 0.95);
    const flanks = e.stalk ? [0] : e.front ? [1] : [1, -1];
    const cx = tx + (e.x - gx), cy = NY - e.y;
    const out = { ...e, rb, flanks: [] };
    for (const fl of flanks) {
      const cz = zc + 0.5 + zo + fl * Math.max(0, Math.round(T0) + 0.5 - rb * (e.front ? 0.35 : 0.42));
      const n = fl === 0 ? norm3(0.35, 0.25, 1) : e.front ? [0, 0, 1] : norm3(0.24, 0.06, fl);
      out.flanks.push({ fl, c: [cx, cy, cz], n });
      stampEyeball(e, rb, [cx, cy, cz], n, fl, (x, y, z, v) => { if (y >= 0 && y < NY) set(x, NY - 1 - y, z, v); }, pal, NX, NZ);
      const gl = c.glasses;
      if (gl && (e.main || gl.both || e.front)) stampGlasses(gl, rb, [cx, cy, cz], n, (x, y, z, v) => { if (y >= 0 && y < NY) set(x, NY - 1 - y, z, v); }, pal);
    }
    eyes3.push(out);
  }
  // occupied bounds
  let x0 = NX, x1 = -1, y0 = NY, y1 = -1, z0 = NZ, z1 = -1;
  for (let y = 0; y < NY; y++) for (let x = 0; x < NX; x++) {
    const col = x + y * NX;
    if (zmax[col] < 0) continue;
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
    if (zmin[col] < z0) z0 = zmin[col];
    if (zmax[col] > z1) z1 = zmax[col];
  }
  if (x1 < 0) { x0 = y0 = z0 = 0; x1 = y1 = z1 = 0; }
  // 3D anchor points (grid coords, y up)
  const P3 = (p, zExtra = 0) => {
    const tx = clamp(Math.floor(p[0]), 0, NX - 1);
    return [p[0], NY - p[1], zc + 0.5 + zExtra + zOf[tx]];
  };
  const eyes = Lo.eyes.map((e) => {
    const gx = clamp(Math.floor(e.x), 0, GW - 1), gy = clamp(Math.floor(e.y), 0, GH - 1);
    const t = Math.max(0, Math.round(tAt(gx, gy)));
    return { ...e, p: P3([e.x, e.y], t + 1.2) };
  });
  const mouth = Lo.mouth ? (() => {
    const gx = clamp(Math.floor(Lo.mouth.x), 0, GW - 1), gy = clamp(Math.floor(Lo.mouth.y), 0, GH - 1);
    return { ...Lo.mouth, p: P3([Lo.mouth.x, Lo.mouth.y], Math.max(0, Math.round(tAt(gx, gy))) + 0.8) };
  })() : null;
  const anchors = {};
  for (const [k2, v] of Object.entries(Lo.anchors)) anchors[k2] = P3(v);
  return {
    Lo, data, NX, NY, NZ, NXY, zmin, zmax, pal, x0, x1, y0, y1, z0, z1, srcOf, zOf, zc, mat: Lo.mat,
    center: [Lo.origin[0], NY - Lo.origin[1], zc + 0.5],
    eyes, eyes3, mouth, anchors, bytes: data.byteLength + NXY * 4,
  };
}

const norm3 = (x, y, z) => { const l = Math.hypot(x, y, z) || 1; return [x / l, y / l, z / l]; };

// A pair of generic white high-top sneakers under the belly (look.sneakers {u, h, len, sole, accent}):
// rubber sole with an aqua stripe, toe cap, canvas upper, criss-cross laces, eyelets and a heel tab.
// The feet take alternating steps over the swim cycle (ph), so a crawling sneakerhead walks.
function stampSneakers(Lo, q, ph, G) {
  const { c, r, nose, bodyTail } = Lo;
  const { set, zc, maxT, mask, GW, GH } = G;
  const pal = Lo.pal;
  const Hs = Math.max(3, (q.h ?? c.H * 0.55) * r), Ls = Math.max(4, (q.len ?? c.H * 0.85) * r), Ws = Math.max(2, Ls * 0.42);
  const hipX = Math.round(nose - (q.u ?? 0.45) * (nose - bodyTail));
  let belly = -1;
  for (let gy = GH - 1; gy >= 0 && belly < 0; gy--) for (let dx = -1; dx <= 1; dx++) if (mask[gy * GW + clamp(hipX + dx, 0, GW - 1)]) { belly = gy; break; }
  if (belly < 0) return;
  const sole = Math.min(GH - 1, Math.round(belly + Hs * 0.92));
  const P = (hex, role = R_BODY) => pal.idx(hexP(hex), role, false);
  const vW = P(q.color || '#fbfdff'), vW2 = P('#e4ecf4'), vSole = P(q.sole || '#f2f4f6'), vStripe = P(q.accent || '#22c8ff');
  const vToe = P('#eef2f6'), vLace = P('#ffffff'), vLace2 = P('#b8c4d0'), vEye = P('#4a5868', R_LIMB), vCollar = P('#d8e2ec'), vTab = P(q.accent || '#22c8ff');
  const zf = Math.max(1, Math.round(maxT * 0.5 + Ws * 0.15));
  for (const side of [-1, 1]) {
    const p = ph + (side > 0 ? 0 : 0.5);
    const fx = hipX + side * Ls * 0.2 + Math.sin(TAU * p) * Ls * 0.18;
    const lift = Math.max(0, -Math.cos(TAU * p)) * Hs * 0.22;
    const zC = zc + side * zf;
    const hw = Ws / 2;
    for (let lx = -Ls / 2 - 1; lx <= Ls / 2 + 1; lx += 1) {
      const t = (lx + Ls / 2) / Ls; // 0 heel .. 1 toe
      // side profile: tall rounded ankle shaft at the back, a low rounded toe box at the front
      const toeT = clamp01((t - 0.48) / 0.52);
      const top = Hs * (t < 0.48 ? 1 - 0.1 * Math.pow(1 - t / 0.48, 3) : 0.34 + 0.66 * Math.sqrt(Math.max(0, 1 - toeT * toeT)) * (1 - toeT * 0.25));
      const soleH = Math.max(1.5, Hs * 0.2);
      for (let ly = 0; ly <= top; ly += 1) {
        const inSole = ly < soleH;
        // plan view: rounded toe and heel; the sole flares a little wider than the canvas upper
        const half = hw * (inSole ? 1.12 : 1) * (ly > Hs * 0.6 ? 0.86 : 1) * Math.sqrt(Math.max(0, 1 - Math.pow(Math.max(0, ly - soleH) / (top + 1), 4) * 0.5));
        const tipD = lx - (Ls / 2 - half), heelD = -lx - (Ls / 2 - half * 0.9);
        for (let lz = -Math.ceil(half); lz <= Math.ceil(half); lz += 1) {
          if (Math.abs(lz) > half) continue;
          if (tipD > 0 && tipD * tipD + lz * lz > half * half) continue;
          if (heelD > 0 && heelD * heelD + lz * lz > (half * 0.9) ** 2) continue;
          if (!inSole && (lx > Ls / 2 || lx < -Ls / 2)) continue;
          const surfTop = ly > top - 1.2, outer = Math.abs(lz) > half - 1.1;
          let v = vW;
          if (inSole) v = Math.abs(ly - soleH * 0.55) < 0.6 && outer ? vStripe : vSole;
          else if (t > 0.8 && ly < Hs * 0.45) v = vToe;
          else if (surfTop && t < 0.5 && ly > Hs * 0.8) v = vCollar;
          else if (surfTop && t >= 0.4 && t < 0.86 && Math.abs(lz) < half * 0.55) v = ((Math.round(lx) + Math.round(lz)) & 1) ? vLace : vLace2;
          else if (outer && t > 0.4 && t < 0.62 && ly > top - 2.6 && ly <= top - 1.2 && (Math.round(lx) % 2 === 0)) v = vEye;
          else if (t < 0.07 && ly > Hs * 0.4) v = vTab;
          else if (outer && ly < Hs * 0.42) v = vW2;
          set(Math.round(fx + lx), sole - Math.round(ly + lift), zC + Math.round(lz), v);
        }
      }
    }
    // a stubby leg from the belly into the shoe while the foot is lifted
    for (let ly = Math.round(Hs + lift); ly <= sole - belly + 1; ly++) set(Math.round(fx - Ls * 0.12), sole - ly, zC, pal.idx(c.bodyR?.[2] ?? 0xff8899aa, R_LIMB, false));
  }
}

// A water bubble around the creature (look.orb {r, color}): a thin iridescent glass shell plus a few
// floating droplets inside.
function stampOrb(Lo, q, G) {
  const { set, NX, NY, NZ, zc } = G;
  const pal = Lo.pal;
  const [ox, oy] = Lo.origin;
  const R = Math.max(4, (q.r ?? Math.max(Lo.c.L * 0.62, Lo.c.H * 1.1)) * Lo.r);
  const v = pal.idx(hexP(q.color || '#c8f6ff'), R_GLASS, false), vD = pal.idx(0xffffffff, R_GLASS, false);
  const cy = NY - oy, cx = ox;
  const th = Math.max(1, R * 0.06);
  for (let z = Math.max(0, Math.floor(zc - R)); z <= Math.min(NZ - 1, Math.ceil(zc + R)); z++) {
    for (let y = Math.max(0, Math.floor(cy - R)); y <= Math.min(NY - 1, Math.ceil(cy + R)); y++) {
      for (let x = Math.max(0, Math.floor(cx - R)); x <= Math.min(NX - 1, Math.ceil(cx + R)); x++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy, z + 0.5 - zc);
        if (d > R || d < R - th) continue;
        set(x, NY - 1 - y, z, (hash3(x, y, z) > 0.97) ? vD : v);
      }
    }
  }
}

// Eye surface colour for a unit direction (dx, dy, dz) from the eyeball centre, gaze axis g.
// Returns [packed colour, role, glow]. Cute glossy CARTOON eyes only: a white ball and a big dark pupil
// (the white shine voxel is added by the eye builders); love = a pink heart pupil, dizzy = a swirl.
const SCLERA_P = 0xfffffcfa, PUPIL_P = 0xff3a1a10, GOOGLY_P = 0xff1c1014, HEART_P = 0xff8a4aff, HEART_HI = 0xffc8b4ff;
function eyeColor(e, dx, dy, dz, g, pupMul, love, dizzy) {
  const t = e.type;
  const cosA = dx * g[0] + dy * g[1] + dz * g[2];
  let rho;
  if (t === 'pixel') {
    // square pupil on a cube eye: Chebyshev distance in the plane across the gaze
    const ux = dx - g[0] * cosA, uy = dy - g[1] * cosA, uz = dz - g[2] * cosA;
    rho = Math.max(Math.abs(uy), Math.hypot(ux, uz));
  } else rho = Math.sqrt(Math.max(0, 1 - cosA * cosA));
  const front = cosA > 0;
  if (t === 'dot') return [front && rho < 0.62 ? (e.pupil | 0xff000000) : 0xff2a2030, R_PUPIL, 0];
  if (t === 'glow') {
    if (front && rho < 0.3 * pupMul) return [0xffffffff, R_EYE, 1];
    return [hexP(e.glowHex || '#9ffcff'), R_EYE, 1];
  }
  const pr = clamp((e.pupilSize ?? 0.6) * pupMul, 0.18, 0.82);
  if (front && (love || dizzy)) {
    // gaze-plane coordinates: right / up across the gaze axis
    let rx = g[2], rz = -g[0];
    const rl = Math.hypot(rx, rz) || 1;
    rx /= rl; rz /= rl;
    const pu = dx * rx + dz * rz;
    const ux = g[1] * rz, uy = g[2] * rx - g[0] * rz, uz = -g[1] * rx;
    const pv = dx * ux + dy * uy + dz * uz;
    if (love) {
      const hx = pu / (pr * 1.25), hy = pv / (pr * 1.25) + 0.25;
      if ((hx * hx + hy * hy - 1) ** 3 - hx * hx * hy * hy * hy < 0) return [hx < -0.25 && hy > 0.35 ? HEART_HI : HEART_P, R_PUPIL, 0];
      return [SCLERA_P, R_EYE, 0];
    }
    const rr = rho / pr, th = Math.atan2(pv, pu);
    if (rr < 1.15 && (rr < 0.22 || ((rr * 2.2 - th / (Math.PI * 2)) % 1 + 1) % 1 < 0.38)) return [PUPIL_P, R_PUPIL, 0];
    return [SCLERA_P, R_EYE, 0];
  }
  if (front && rho < pr) return [t === 'googly' ? GOOGLY_P : (e.pupil | 0xff000000) || PUPIL_P, R_PUPIL, 0];
  return [SCLERA_P, R_EYE, 0];
}
function hexP(hex) {
  const n = parseInt(hex.slice(1, 7), 16);
  return (0xff000000 | ((n & 255) << 16) | (n & 0xff00) | (n >> 16)) >>> 0;
}
function mixP(a, b, t) {
  const ar = a & 255, ag = (a >>> 8) & 255, ab = (a >>> 16) & 255;
  const br = b & 255, bg = (b >>> 8) & 255, bb = (b >>> 16) & 255;
  return (0xff000000 | (Math.round(ab + (bb - ab) * t) << 16) | (Math.round(ag + (bg - ag) * t) << 8) | Math.round(ar + (br - ar) * t)) >>> 0;
}

// Voxel eyewear over an eyeball (look extras glasses {style: shades|round|square|patch}): glossy dark lenses
// or a pirate patch hovering just in front of the eye, a frame rim and an arm back toward the ear.
function stampGlasses(g, rb, C, n, put, pal) {
  const style = g.style || 'shades';
  let up = [0, 1, 0];
  const dn = n[1];
  up = norm3(up[0] - n[0] * dn, up[1] - n[1] * dn, up[2] - n[2] * dn);
  const fw = norm3(up[1] * n[2] - up[2] * n[1], up[2] * n[0] - up[0] * n[2], up[0] * n[1] - up[1] * n[0]);
  const vLens = pal.idx(hexP(style === 'patch' ? '#14121c' : '#141a2a'), R_PUPIL, false);
  const vGlint = pal.idx(hexP('#9ab8e8'), R_SPEC, false), vFrame = pal.idx(g.P || hexP(style === 'round' ? '#3a2a18' : '#0e1018'), R_CHROME, false);
  const R = style === 'patch' ? rb * 1.15 : style === 'shades' ? rb * 1.5 : rb * 1.35;
  const off = rb * (style === 'patch' ? 0.85 : 1.05);
  const step = 0.45;
  for (let a = -R - 1; a <= R + 1; a += step) for (let b = -R - 1; b <= R + 1; b += step) {
    let v = 0;
    const shadesCut = style === 'shades' && b > R * 0.62;
    const d = style === 'square' ? Math.max(Math.abs(a), Math.abs(b) * 1.25) : Math.hypot(a, b * (style === 'shades' ? 1.15 : 1));
    if (d <= R && !shadesCut) {
      const rim = d > R - 0.9 || (style === 'shades' && b > R * 0.62 - 0.9);
      if (style === 'round' || style === 'square') v = rim ? vFrame : 0;
      else v = rim ? vFrame : Math.abs(a - b + R * 0.2) < 0.5 && b > 0 ? vGlint : vLens;
    } else if (style !== 'patch' && a < -R && a > -R * 2.2 && Math.abs(b - R * 0.2) < 0.6) v = vFrame;
    else if (style === 'patch' && Math.abs(b - R * 0.75 - (a + R) * -0.6) < 0.55 && a < 0 && a > -R * 2.4) v = vFrame;
    if (!v) continue;
    const curve = -Math.hypot(a, b) * 0.12;
    put(Math.floor(C[0] + n[0] * (off + curve) + fw[0] * a + up[0] * b), Math.floor(C[1] + n[1] * (off + curve) + fw[1] * a + up[1] * b), Math.floor(C[2] + n[2] * (off + curve) + fw[2] * a + up[2] * b), v);
  }
}

// Baked neutral eyeball (body grid resolution): the outer part of a sphere, gaze along its axis.
function stampEyeball(e, rb, C, n, fl, put, pal, NX, NZ) {
  const R = Math.ceil(rb + 1);
  const g = norm3(n[0] + 0.12, n[1], n[2]);
  const cube = e.e.type === 'pixel';
  const sd = norm3(g[0] + 0.3, g[1] + 0.45, g[2]);
  let best = -2, bx = 0, by = 0, bz = 0;
  for (let dz = -R; dz <= R; dz++) for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
    const x = Math.floor(C[0]) + dx, y = Math.floor(C[1]) + dy, z = Math.floor(C[2]) + dz;
    const qx = (x + 0.5 - C[0]) / rb, qy = (y + 0.5 - C[1]) / rb, qz = (z + 0.5 - C[2]) / rb;
    const d = cube ? Math.max(Math.abs(qx), Math.abs(qy), Math.abs(qz)) : Math.hypot(qx, qy, qz);
    if (d > 1) continue;
    if (fl && qz * fl < -0.35) continue;
    if (x < 0 || x >= NX || z < 0 || z >= NZ) continue;
    const dd = Math.hypot(qx, qy, qz) || 1;
    const [col, role, gl] = eyeColor(e.e, qx / dd, qy / dd, qz / dd, g, 1, false, false);
    put(x, y, z, pal.idx(col, role, !!gl));
    // the shine: the surface voxel facing up-front-out
    if (d > 1 - 1.2 / rb && role === R_PUPIL && e.e.type !== 'dot') {
      const sh = (qx * sd[0] + qy * sd[1] + qz * sd[2]) / dd;
      if (sh > best) { best = sh; bx = x; by = y; bz = z; }
    }
  }
  if (best > -1) put(bx, by, bz, pal.idx(0xffffffff, R_SPEC, false));
}

function zOfSrc(srcOf, zOf, tx) { return tx >= 0 && tx < zOf.length ? zOf[tx] : 0; }

function nearestEye(Lo, gx, gy) {
  let best = null, bd = Infinity;
  for (const e of Lo.eyes) {
    const d = (gx + 0.5 - e.x) ** 2 + (gy + 0.5 - e.y) ** 2;
    if (d < bd) { bd = d; best = e; }
  }
  return best;
}

// ------------------------------------------------------------------ renderer

// Kernel for smoothed normals: 26 neighbours + 6 at distance 2.
const KX = [], KY = [], KZ = [], KW = [];
for (let z = -1; z <= 1; z++) for (let y = -1; y <= 1; y++) for (let x = -1; x <= 1; x++) {
  if (!x && !y && !z) continue;
  KX.push(x); KY.push(y); KZ.push(z); KW.push(1 / (x * x + y * y + z * z));
}
for (const [x, y, z] of [[2, 0, 0], [-2, 0, 0], [0, 2, 0], [0, -2, 0], [0, 0, 2], [0, 0, -2]]) { KX.push(x); KY.push(y); KZ.push(z); KW.push(0.25); }
const KN = KX.length;
const FACET = 0.16;                // share of the per-face normal (visible voxel facets) on the body
const FN = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
// light (camera space, from the upper left front) and the Blinn half vector
const LIGHT = (() => { const v = [-0.5, 0.74, 0.46]; const l = Math.hypot(...v); return v.map((a) => a / l); })();
const HALF = (() => { const v = [LIGHT[0], LIGHT[1], LIGHT[2] + 1]; const l = Math.hypot(...v); return v.map((a) => a / l); })();

// Rainbow thin-film colour channel (0..1) for a phase.
function irid(ph, ch) { return 0.5 + 0.5 * Math.cos(TAU * (ph - ch * 0.333)); }
// Bright Aero sky environment for a reflected camera-space direction (y up, z toward the viewer).
const ENV_OUT = [0, 0, 0];
function envSky(ry, rz) {
  if (ry > -0.04) {
    const t = clamp01(ry);
    const band = ry > 0.18 && ry < 0.62 ? 0.12 : 0; // a soft window / cloud band (glass reflection)
    ENV_OUT[0] = 0.72 + 0.26 * t + band; ENV_OUT[1] = 0.9 + 0.1 * t + band; ENV_OUT[2] = 1;
  } else {
    const t = clamp01(-ry * 1.6);
    ENV_OUT[0] = 0.28 - 0.18 * t; ENV_OUT[1] = 0.58 - 0.3 * t; ENV_OUT[2] = 0.7 - 0.32 * t;
  }
  void rz;
  return ENV_OUT;
}

function hash3(x, y, z) {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function camera(G, yawDeg, pitchDeg, s, extraPad = 0) {
  // M = Tilt * Ry(yaw) * Rz(-pitch): rows are the camera axes expressed in model space
  const xf = (v) => {
    const cp = Math.cos(-pitchDeg * DEG), sp = Math.sin(-pitchDeg * DEG);
    let x = v[0] * cp - v[1] * sp, y = v[0] * sp + v[1] * cp, z = v[2];
    const cy = Math.cos(yawDeg * DEG), sy = Math.sin(yawDeg * DEG);
    const x2 = x * cy - z * sy, z2 = x * sy + z * cy;
    x = x2; z = z2;
    const ct = Math.cos(CAM_TILT * DEG), st = Math.sin(CAM_TILT * DEG);
    const y2 = y * ct - z * st, z3 = y * st + z * ct;
    return [x, y2, z3];
  };
  const ex = xf([1, 0, 0]), ey = xf([0, 1, 0]), ez = xf([0, 0, 1]);
  const R0 = [ex[0], ey[0], ez[0]], R1 = [ex[1], ey[1], ez[1]], R2 = [ex[2], ey[2], ez[2]];
  const C = G.center;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < 8; i++) {
    const px = (i & 1 ? G.x1 + 1 : G.x0) - C[0], py = (i & 2 ? G.y1 + 1 : G.y0) - C[1], pz = (i & 4 ? G.z1 + 1 : G.z0) - C[2];
    const X = px * R0[0] + py * R0[1] + pz * R0[2], Y = px * R1[0] + py * R1[1] + pz * R1[2];
    if (X < minX) minX = X; if (X > maxX) maxX = X; if (Y < minY) minY = Y; if (Y > maxY) maxY = Y;
  }
  const pad = 2 + extraPad;
  const W = Math.max(1, Math.ceil((maxX - minX) * s) + pad * 2), H = Math.max(1, Math.ceil((maxY - minY) * s) + pad * 2);
  const project = (p) => {
    const px = p[0] - C[0], py = p[1] - C[1], pz = p[2] - C[2];
    const X = px * R0[0] + py * R0[1] + pz * R0[2], Y = px * R1[0] + py * R1[1] + pz * R1[2], Z = px * R2[0] + py * R2[1] + pz * R2[2];
    return [(X - minX) * s + pad, (maxY - Y) * s + pad, Z];
  };
  return { R0, R1, R2, minX, maxY, s, pad, W, H, project };
}

// A render job: rows are traced/shaded in slices (resumable), then finished with the post passes.
class Job {
  constructor(G, yaw, pitch, s, opts) {
    this.G = G; this.yaw = yaw; this.pitch = pitch; this.s = s; this.opts = opts;
    this.glowR = G.pal.em.some((e) => e) ? Math.max(2, Math.round(s * 1.4)) : 0;
    const cam = camera(G, yaw, pitch, s, this.glowR);
    this.cam = cam;
    const N = cam.W * cam.H;
    this.out = new Uint32Array(N);
    this.depth = new Float32Array(N).fill(1e9);
    this.glow = null;
    this.row = 0;
    this.done = false;
    let hs = 1024;
    while (hs < N * 0.7) hs <<= 1;
    this.hk = new Int32Array(hs).fill(-1);
    this.hv = new Uint32Array(hs);
    this.hg = new Uint8Array(hs);
    this.hmask = hs - 1;
    this.cost = N;
  }

  step(deadline) {
    const { cam } = this;
    while (this.row < cam.H) {
      this.traceRow(this.row++);
      if ((this.row & 3) === 0 && now() > deadline) return false;
    }
    this.finish();
    this.done = true;
    return true;
  }

  traceRow(py) {
    const { G, cam, out, depth } = this;
    const { R0, R1, R2, s, pad, minX, maxY, W } = cam;
    const { data, NX, NXY, zmin, zmax, pal } = G;
    const C = G.center;
    const dx = -R2[0], dy = -R2[1], dz = -R2[2];
    const bx0 = G.x0, by0 = G.y0, bz0 = G.z0, bx1 = G.x1 + 1, by1 = G.y1 + 1, bz1 = G.z1 + 1;
    const BIG = 1e30;
    const zx = Math.abs(dx) < 1e-9, zy = Math.abs(dy) < 1e-9, zz = Math.abs(dz) < 1e-9;
    const idx = zx ? BIG : 1 / dx, idy = zy ? BIG : 1 / dy, idz = zz ? BIG : 1 / dz;
    const sx = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1, sz = dz > 0 ? 1 : -1;
    const tdx = Math.abs(idx), tdy = Math.abs(idy), tdz = Math.abs(idz);
    const fX = sx > 0 ? 1 : 0, fY = sy > 0 ? 3 : 2, fZ = sz > 0 ? 5 : 4; // face hit when stepping along +axis is the -axis face
    const Y = maxY - (py - pad + 0.5) / s;
    const alphaArr = pal.alpha;
    for (let px = 0; px < W; px++) {
      const X = minX + (px - pad + 0.5) / s;
      const ox = C[0] + X * R0[0] + Y * R1[0], oy = C[1] + X * R0[1] + Y * R1[1], oz = C[2] + X * R0[2] + Y * R1[2];
      let t0x, t1x, t0y, t1y, t0z, t1z;
      if (zx) { if (ox < bx0 || ox >= bx1) continue; t0x = -BIG; t1x = BIG; } else { t0x = (bx0 - ox) * idx; t1x = (bx1 - ox) * idx; if (t0x > t1x) { const q = t0x; t0x = t1x; t1x = q; } }
      if (zy) { if (oy < by0 || oy >= by1) continue; t0y = -BIG; t1y = BIG; } else { t0y = (by0 - oy) * idy; t1y = (by1 - oy) * idy; if (t0y > t1y) { const q = t0y; t0y = t1y; t1y = q; } }
      if (zz) { if (oz < bz0 || oz >= bz1) continue; t0z = -BIG; t1z = BIG; } else { t0z = (bz0 - oz) * idz; t1z = (bz1 - oz) * idz; if (t0z > t1z) { const q = t0z; t0z = t1z; t1z = q; } }
      const tEnter = Math.max(t0x, t0y, t0z), tExit = Math.min(t1x, t1y, t1z);
      if (tEnter >= tExit) continue;
      let face = tEnter === t0x ? fX : tEnter === t0y ? fY : fZ;
      let t = tEnter;
      let te = t + 1e-5;
      let ix = clamp(Math.floor(ox + dx * te), bx0, bx1 - 1);
      let iy = clamp(Math.floor(oy + dy * te), by0, by1 - 1);
      let iz = clamp(Math.floor(oz + dz * te), bz0, bz1 - 1);
      let tmx = zx ? BIG : (ix + (sx > 0 ? 1 : 0) - ox) * idx;
      let tmy = zy ? BIG : (iy + (sy > 0 ? 1 : 0) - oy) * idy;
      let tmz = zz ? BIG : (iz + (sz > 0 ? 1 : 0) - oz) * idz;
      let transC = 0, transA = 0, transT = 0, hitC = 0, hitT = 0, hitG = 0, transG = 0;
      for (let guard = 0; guard < 4096; guard++) {
        const col = ix + iy * NX;
        const zmn = zmin[col];
        const tCol = tmx < tmy ? tmx : tmy;
        let inspect = zmn !== 32767;
        if (inspect) {
          const tEnd = tCol < tExit ? tCol : tExit;
          const za = oz + dz * t, zb = oz + dz * tEnd;
          const lo = za < zb ? za : zb, hi = za < zb ? zb : za;
          if (hi < zmn || lo >= zmax[col] + 1) inspect = false;
        }
        if (inspect) {
          let found = false;
          for (;;) {
            const vi = col + iz * NXY;
            const v = data[vi];
            if (v) {
              const a = alphaArr[v];
              if (a >= 1) {
                hitC = this.shade(vi, face, ix, iy, iz);
                hitG = this.lastGlow;
                hitT = t;
                found = true;
                break;
              }
              if (!transA) {
                transC = this.shade(vi, face, ix, iy, iz);
                transG = this.lastGlow;
                transA = Math.max(0.02, (transC >>> 24) / 255); transT = t;
              }
            }
            if (tmz < tCol) {
              iz += sz; t = tmz; tmz += tdz; face = fZ;
              if (iz < bz0 || iz >= bz1 || t >= tExit) break;
            } else break;
          }
          if (found) break;
        }
        // next column
        if (tmx < tmy) { ix += sx; t = tmx; tmx += tdx; face = fX; if (ix < bx0 || ix >= bx1) break; }
        else { iy += sy; t = tmy; tmy += tdy; face = fY; if (iy < by0 || iy >= by1) break; }
        if (t >= tExit) break;
        te = t + 1e-5;
        iz = clamp(Math.floor(oz + dz * te), bz0, bz1 - 1);
        tmz = zz ? BIG : (iz + (sz > 0 ? 1 : 0) - oz) * idz;
      }
      const p = py * W + px;
      if (hitC) {
        let cOut = hitC;
        if (transA) cOut = mixPacked(hitC, transC, transA);
        out[p] = cOut;
        depth[p] = transA ? transT : hitT;
        const g = transA && transG ? transC : hitG ? hitC : 0;
        if (g) (this.glow ||= new Uint32Array(W * cam.H))[p] = g;
      } else if (transA) {
        out[p] = transC;
        depth[p] = transT;
        if (transG) (this.glow ||= new Uint32Array(W * cam.H))[p] = transC;
      }
    }
  }

  // Shade one voxel face (cached): returns a packed colour (alpha byte = coverage); sets this.lastGlow.
  // Frutiger Aero look: soft sun + aqua sky ambient, cool blue shadows, glossy coat (sky reflection +
  // Blinn glints + a glass sheen band on the upper flank), soft aqua rim light, iridescent thin film,
  // glassy aqua fin membranes, chrome and see-through glass materials, crisp glossy eyes.
  shade(vi, face, ix, iy, iz) {
    const key = vi * 6 + face;
    const hk = this.hk, m = this.hmask;
    let h = Math.imul(key, 0x9e3779b1) >>> 0 & m;
    for (;;) {
      const k = hk[h];
      if (k === key) { this.lastGlow = this.hg[h]; return this.hv[h]; }
      if (k === -1) break;
      h = (h + 1) & m;
    }
    const G = this.G, pal = G.pal, cam = this.cam;
    const { data, NX, NY, NZ, NXY } = G;
    const v = data[vi];
    const role = pal.role[v];
    const em = pal.em[v];
    const mat = G.mat || pal.mat || DEF_MAT;
    const fn = FN[face];
    let nx = fn[0], ny = fn[1], nz = fn[2];
    let gx = NaN, gy = 0, gz = 0;
    const Lo = G.Lo;
    if (G.nf) {
      const an = G.nf(ix, iy, iz, v);
      if (an) {
        gx = an[0]; gy = an[1]; gz = an[2];
        const wf = role === R_LIMB ? 0.3 : 0.12;
        nx = nx * wf + gx * (1 - wf); ny = ny * wf + gy * (1 - wf); nz = nz * wf + gz * (1 - wf);
        const l = Math.hypot(nx, ny, nz) || 1;
        nx /= l; ny /= l; nz /= l;
      }
    }
    if (gx !== gx && (role === R_BODY || role === R_MOUTH || role === R_GLASS || role === R_CHROME) && Lo.Tx && G.srcOf) {
      // analytic flank normal of the extruded body: F = |z - zc| - T(x, y)
      const sxi = G.srcOf[ix];
      const li = (NY - 1 - iy) * Lo.GW + sxi;
      if (sxi >= 0 && Lo.mask[li]) {
        const side = iz + 0.5 - (G.zc + 0.5 + G.zOf[ix]) >= 0 ? 1 : -1;
        let ax = -Lo.Tx[li], ay = Lo.Ty[li], az = side;
        const al = Math.hypot(ax, ay, az);
        ax /= al; ay /= al; az /= al;
        gx = ax; gy = ay; gz = az;
        const wf = role === R_MOUTH ? 0.3 : FACET;
        nx = nx * wf + ax * (1 - wf); ny = ny * wf + ay * (1 - wf); nz = nz * wf + az * (1 - wf);
        const l = Math.hypot(nx, ny, nz) || 1;
        nx /= l; ny /= l; nz /= l;
      }
    }
    if (gx !== gx && role !== R_FIN) {
      gx = 0;
      for (let k = 0; k < KN; k++) {
        const x = ix + KX[k], y = iy + KY[k], z = iz + KZ[k];
        if (x < 0 || y < 0 || z < 0 || x >= NX || y >= NY || z >= NZ) continue;
        const w = data[x + y * NX + z * NXY];
        if (w && pal.alpha[w] >= 1) { gx -= KX[k] * KW[k]; gy -= KY[k] * KW[k]; gz -= KZ[k] * KW[k]; }
      }
      const gl = Math.hypot(gx, gy, gz);
      if (gl > 0.4) {
        const wf = role === R_EYE || role === R_PUPIL ? 0.25 : role === R_THIN ? 0.6 : 0.4;
        nx = nx * wf + (gx / gl) * (1 - wf); ny = ny * wf + (gy / gl) * (1 - wf); nz = nz * wf + (gz / gl) * (1 - wf);
        const l = Math.hypot(nx, ny, nz) || 1;
        nx /= l; ny /= l; nz /= l;
        gx /= gl; gy /= gl; gz /= gl;
      } else { gx = nx; gy = ny; gz = nz; }
    } else if (gx !== gx) { gx = nx; gy = ny; gz = nz; }
    const { R0, R1, R2 } = cam;
    // camera space: blended (faceted) normal c*, smooth normal s*
    const cx = R0[0] * nx + R0[1] * ny + R0[2] * nz;
    const cy = R1[0] * nx + R1[1] * ny + R1[2] * nz;
    const cz = R2[0] * nx + R2[1] * ny + R2[2] * nz;
    const sx = R0[0] * gx + R0[1] * gy + R0[2] * gz, sy = R1[0] * gx + R1[1] * gy + R1[2] * gz, sz = R2[0] * gx + R2[1] * gy + R2[2] * gz;
    const lam = cx * LIGHT[0] + cy * LIGHT[1] + cz * LIGHT[2];
    // per-face AO: occupancy of the 8 cells around the face, in the layer in front of it
    const ax = face >> 1;
    const fx = ix + fn[0], fy = iy + fn[1], fz = iz + fn[2];
    let occ = 0;
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      if (!a && !b) continue;
      let x = fx, y = fy, z = fz;
      if (ax === 0) { y += a; z += b; } else if (ax === 1) { x += a; z += b; } else { x += a; y += b; }
      if (x < 0 || y < 0 || z < 0 || x >= NX || y >= NY || z >= NZ) continue;
      const w = data[x + y * NX + z * NXY];
      if (w && pal.alpha[w] >= 1) occ += a && b ? 0.55 : 1;
    }
    const ao = 1 - Math.min(1, occ / 5.2);
    const c0 = pal.rgb[v];
    let r = (c0 & 255) / 255, g = ((c0 >>> 8) & 255) / 255, b = ((c0 >>> 16) & 255) / 255;
    let alpha = 1;
    const fr = 1 - clamp01(sz);                       // grazing factor (0 facing us .. 1 edge-on)
    const hd = sx * HALF[0] + sy * HALF[1] + sz * HALF[2];
    if (role === R_SPEC) {
      r = 1; g = 1; b = 1;
      if (c0 !== 0xffffff) { r = 0.9 + r * 0.1; g = 0.96; b = 1; }
    } else if (em) {
      const k = 0.9 + 0.25 * clamp01(lam + 0.5);
      r = Math.min(1, r * k + 0.12); g = Math.min(1, g * k + 0.12); b = Math.min(1, b * k + 0.12);
    } else if (role === R_FIN) {
      // glassy aqua membrane: pastel glass tone, lit through from both sides, frosted bright edges
      // keep the fin's own vivid hue, lifted and tinted toward bright aqua glass
      const tn = mat.finTint;
      r = r * 0.95 + 0.05; g = g * 0.95 + 0.05; b = b * 0.95 + 0.06;
      g += (0.96 - g) * tn * 0.35; b += (1.0 - b) * tn * 0.7;
      const d = Math.abs(lam);
      const lit = (0.88 + 0.26 * d + 0.12 * cy) * (0.9 + 0.1 * ao);
      r *= lit; g *= lit; b *= lit;
      const sp = Math.pow(Math.max(0, Math.abs(hd)), 20) * 0.55 * mat.gloss;
      r += sp; g += sp; b += sp;
      const rim = Math.pow(fr, 2) * 0.4;
      r += (0.85 - r) * rim; g += (1 - g) * rim; b += (1 - b) * rim;
      if (mat.iri) { const ph = cy * 0.6 + cx * 0.3 + (ix + iy) * 0.04; const w = mat.iri * 0.35; r += (irid(ph, 0) - 0.5) * w; g += (irid(ph, 1) - 0.5) * w; b += (irid(ph, 2) - 0.5) * w; }
    } else if (role === R_GLASS) {
      // soap-bubble / glass body: mostly reflection + thin-film colour, more opaque toward the rim
      const ry = 2 * sz * sy, rr = 2 * sz * sz - 1;
      const env = envSky(ry, rr);
      const tint = 0.35;
      r = r * tint + env[0] * 0.45; g = g * tint + env[1] * 0.45; b = b * tint + env[2] * 0.45;
      const ph = fr * 1.7 + sy * 0.45 + sx * 0.25;
      const w = 0.25 + 0.6 * mat.iri * (0.3 + fr);
      r += (irid(ph, 0) - 0.45) * w; g += (irid(ph, 1) - 0.45) * w; b += (irid(ph, 2) - 0.45) * w;
      const sp = Math.pow(Math.max(0, hd), 60) * 1.4 + Math.pow(Math.max(0, hd), 12) * 0.25;
      r += sp; g += sp; b += sp;
      alpha = clamp01(pal.alpha[v] * 0.45 + 0.12 + 0.75 * fr * fr + sp * 0.5);
    } else {
      const diff = clamp01((lam + 0.3) / 1.3);
      const sky = 0.5 + 0.5 * cy;
      const aoF = 0.5 + 0.5 * ao;
      const chrome = role === R_CHROME ? 1 : mat.chrome;
      // light colours: warm sun, aqua sky fill, sea-green bounce from below
      const lr = (0.44 + 0.2 * sky) * 0.86 + (1 - sky) * 0.12 + diff * 0.84;
      const lg = (0.44 + 0.2 * sky) * 0.9 + (1 - sky) * 0.11 + diff * 0.82;
      const lb = (0.44 + 0.2 * sky) * 0.98 + (1 - sky) * 0.12 + diff * 0.78;
      r *= lr * aoF; g *= lg * aoF; b *= lb * aoF;
      // Frutiger gloss: a glass sheen band on the upper flank (crisp lower edge), sky reflection by fresnel
      const gloss = role === R_EYE || role === R_PUPIL ? 1 : role === R_LIMB ? mat.gloss * 0.9 : role === R_THIN ? mat.gloss * 0.6 : mat.gloss;
      if (mat.sheen && role !== R_PUPIL) {
        const band = sy > 0.42 ? clamp01((sy - 0.42) * 4) * clamp01(0.35 + sz) : 0;
        const sh = band * 0.26 * gloss * mat.sheen;
        r += (1 - r) * sh; g += (1 - g) * sh; b += (1 - b) * sh;
      }
      const F = 0.05 + 0.95 * Math.pow(fr, 5);
      const env = envSky(2 * sz * sy, 2 * sz * sz - 1);
      const kr = chrome ? 0.55 + 0.4 * F : F * 0.4 * gloss;
      if (chrome) { const lum = 0.3 * r + 0.5 * g + 0.2 * b; r = r * 0.35 + lum * 0.2; g = g * 0.35 + lum * 0.2; b = b * 0.35 + lum * 0.2; }
      r += (env[0] * (chrome ? (c0 & 255) / 255 * 0.5 + 0.55 : 1) - r) * kr;
      g += (env[1] * (chrome ? ((c0 >>> 8) & 255) / 255 * 0.5 + 0.55 : 1) - g) * kr;
      b += (env[2] * (chrome ? ((c0 >>> 16) & 255) / 255 * 0.5 + 0.55 : 1) - b) * kr;
      // glints
      const pk = role === R_EYE || role === R_PUPIL ? 1.6 : role === R_MOUTH ? 0.3 : 1;
      const sp = (Math.pow(Math.max(0, hd), 26) * 0.32 + Math.pow(Math.max(0, hd), 140) * 0.95) * gloss * pk;
      r += sp; g += sp; b += sp * 0.98;
      // soft aqua rim light from the bright water above
      const rim = Math.pow(fr, 2.6) * clamp01(sy * 0.9 + 0.55) * 0.5 * mat.rim;
      r += (0.72 - r) * rim; g += (0.96 - g) * rim; b += (1 - b) * rim;
      // iridescent sheen (thin film), strongest at glancing angles
      if (mat.iri && role !== R_PUPIL && role !== R_MOUTH) {
        const ph = fr * 1.5 + sy * 0.4 + sx * 0.3 + (role === R_EYE ? 0.3 : 0);
        const w = mat.iri * (0.12 + 0.5 * fr) * (role === R_EYE ? 0.3 : 1);
        r += (irid(ph, 0) - 0.5) * w; g += (irid(ph, 1) - 0.5) * w; b += (irid(ph, 2) - 0.5) * w;
      }
      // scale texture: staggered scale rows catch the light
      if (mat.scales && role === R_BODY && Math.abs(sz) > 0.35) {
        const row = iy >> 1, sc = (ix + (row & 1) * 2) % 4;
        const k = (iy & 1) === 0 ? (sc === 0 ? 0.07 : sc === 1 ? 0.03 : 0) : sc === 0 ? -0.05 : 0;
        r *= 1 + k; g *= 1 + k; b *= 1 + k;
      }
    }
    if (role === R_BODY || role === R_LIMB || role === R_THIN || role === R_FIN) {
      // vivid tropical colour (aquarium-lamp saturation)
      const mm = (r + g + b) / 3, kv = role === R_FIN ? 0.2 : VIVID;
      r = mm + (r - mm) * (1 + kv); g = mm + (g - mm) * (1 + kv); b = mm + (b - mm) * (1 + kv);
    }
    const nse = 1 + (hash3(ix, iy, iz) - 0.5) * 0.04;
    r = clamp01(r * nse); g = clamp01(g * nse); b = clamp01(b * nse);
    if (pal.alpha[v] < 1 && role !== R_GLASS) alpha = pal.alpha[v];
    const col = ((Math.round(alpha * 255) << 24) | (Math.round(b * 255) << 16) | (Math.round(g * 255) << 8) | Math.round(r * 255)) >>> 0;
    // store
    hk[h] = key; this.hv[h] = col; this.hg[h] = em;
    this.lastGlow = em;
    return col;
  }

  finish() {
    const { cam, out, depth } = this;
    const { W, H } = cam;
    const N = W * H;
    // interior depth lines: a nearer surface overlapping a farther one darkens the far pixel
    const thr = 2.4;
    const src = out.slice();
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const p = y * W + x;
      const c = src[p];
      if (!c) continue;
      const d = depth[p] - thr;
      if ((x > 0 && src[p - 1] && depth[p - 1] < d) || (x + 1 < W && src[p + 1] && depth[p + 1] < d) || (y > 0 && src[p - W] && depth[p - W] < d) || (y + 1 < H && src[p + W] && depth[p + W] < d)) {
        out[p] = darkPacked(c, 0.7);
      }
    }
    // selective outline around opaque silhouettes
    if (this.opts.outline !== false) {
      const src2 = out.slice();
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const p = y * W + x;
        if (src2[p] >>> 24) continue;
        let n = 0;
        if (y > 0 && (src2[p - W] >>> 24) >= 200) n = src2[p - W];
        else if (x > 0 && (src2[p - 1] >>> 24) >= 200) n = src2[p - 1];
        else if (x + 1 < W && (src2[p + 1] >>> 24) >= 200) n = src2[p + 1];
        else if (y + 1 < H && (src2[p + W] >>> 24) >= 200) n = src2[p + W];
        if (n) out[p] = outlinePacked(n);
      }
    }
    this.canvas = toCanvas(out, W, H);
    if (this.glow) this.glowCanvas = glowCanvas(this.glow, W, H, this.glowR || 2);
    statPx += N;
    // free scratch
    this.hk = this.hv = this.hg = null;
    this.depth = null;
  }
}

function mixPacked(a, b, t) {
  const ar = a & 255, ag = (a >>> 8) & 255, ab = (a >>> 16) & 255;
  const br = b & 255, bg = (b >>> 8) & 255, bb = (b >>> 16) & 255;
  return (0xff000000 | (Math.round(ab + (bb - ab) * t) << 16) | (Math.round(ag + (bg - ag) * t) << 8) | Math.round(ar + (br - ar) * t)) >>> 0;
}
function darkPacked(c, k) {
  const r = c & 255, g = (c >>> 8) & 255, b = (c >>> 16) & 255;
  return ((c & 0xff000000) | (Math.round(b * k + 26 * (1 - k)) << 16) | (Math.round(g * k + 8 * (1 - k)) << 8) | Math.round(r * k * 0.94)) >>> 0;
}
// Selective outline: a deep, saturated, slightly blue version of the neighbour (glass edge, never black).
function outlinePacked(n) {
  const r = n & 255, g = (n >>> 8) & 255, b = (n >>> 16) & 255;
  return (0xff000000 | (Math.round(b * 0.42 + 34) << 16) | (Math.round(g * 0.3 + 12) << 8) | Math.round(r * 0.26 + 8)) >>> 0;
}

function glowHalo(g, W, H, R) {
  // emissive core + a soft halo (two box blurs) carrying the emissive colour
  const N = W * H;
  const r = new Float32Array(N), gg = new Float32Array(N), b = new Float32Array(N), a = new Float32Array(N);
  for (let p = 0; p < N; p++) {
    const c = g[p];
    if (!c) continue;
    r[p] = c & 255; gg[p] = (c >>> 8) & 255; b[p] = (c >>> 16) & 255; a[p] = 1;
  }
  const tmp = new Float32Array(N);
  const blur = (ch) => {
    for (let pass = 0; pass < 2; pass++) {
      for (let y = 0; y < H; y++) {
        let acc = 0;
        const row = y * W;
        for (let x = -R; x < W + R; x++) {
          if (x + R < W) acc += ch[row + x + R];
          if (x - R - 1 >= 0) acc -= ch[row + x - R - 1];
          if (x >= 0 && x < W) tmp[row + x] = acc / (2 * R + 1);
        }
      }
      for (let x = 0; x < W; x++) {
        let acc = 0;
        for (let y = -R; y < H + R; y++) {
          if (y + R < H) acc += tmp[(y + R) * W + x];
          if (y - R - 1 >= 0) acc -= tmp[(y - R - 1) * W + x];
          if (y >= 0 && y < H) ch[y * W + x] = acc / (2 * R + 1);
        }
      }
    }
  };
  const core = g.slice();
  blur(r); blur(gg); blur(b); blur(a);
  const outB = new Uint32Array(N);
  for (let p = 0; p < N; p++) {
    if (core[p]) { outB[p] = core[p] | 0xff000000; continue; }
    const al = a[p];
    if (al < 0.01) continue;
    const k = 1 / al;
    const A = Math.min(255, Math.round(Math.pow(al, 0.8) * 230));
    outB[p] = ((A << 24) | (clamp(Math.round(b[p] * k), 0, 255) << 16) | (clamp(Math.round(gg[p] * k), 0, 255) << 8) | clamp(Math.round(r[p] * k), 0, 255)) >>> 0;
  }
  return outB;
}

// Emissive core + soft halo (GPU canvas blur when available).
function glowCanvas(core, W, H, R) {
  const c0 = toCanvas(core, W, H);
  const out = makeCanvas(W, H);
  const g = ctxOf(out);
  if ('filter' in g) {
    g.filter = `blur(${Math.max(1, R * 0.7)}px)`;
    g.drawImage(c0, 0, 0);
    g.drawImage(c0, 0, 0);
    g.filter = 'none';
    g.drawImage(c0, 0, 0);
    return out;
  }
  return toCanvas(glowHalo(core, W, H, R), W, H);
}

function toCanvas(buf, W, H) {
  const c = makeCanvas(W, H);
  const g = ctxOf(c);
  const img = g.createImageData(W, H);
  new Uint32Array(img.data.buffer).set(buf);
  g.putImageData(img, 0, 0);
  return c;
}

// ------------------------------------------------------------------ caches

const layouts = new Map();   // lkey -> layout
const grids = new Map();     // gkey -> grid
const frames = new Map();    // fkey -> frame
const jobs = new Map();      // fkey -> {job, meta, gkey, last}
const byCreature = new Map(); // vid -> Map(fkey -> meta)
let gridBytes = 0;

function touch(map, k, v) { map.delete(k); map.set(k, v); }

const rasters = new Map();   // source rasters (RasterJob, done or in progress)
function rasterFor(c, srcK, infl, pose, kf, deadline) {
  const key = vidOf(c) + '|' + srcK + '|' + infl + '|' + (pose ? 1 : 0) + '|' + kf;
  let R = rasters.get(key);
  if (!R) {
    R = new RasterJob(c, Math.pow(2, srcK / 2), infl / INFL_N, pose, kf);
    rasters.set(key, R);
    if (rasters.size > LAYOUT_MAX) rasters.delete(rasters.keys().next().value);
  }
  while (!R.done) {
    if (now() >= deadline) return null;
    const t0 = now();
    R.step();
    const dt = now() - t0;
    spent += dt; workTotal += dt;
  }
  return R;
}

function layoutFor(c, rk, infl, pose, kf, deadline) {
  const key = vidOf(c) + '|' + rk + '|' + infl + '|' + (pose ? 1 : 0) + '|' + kf;
  let L = layouts.get(key);
  if (L) { touch(layouts, key, L); return L; }
  const t0 = now();
  if (c.kind === 'chain') L = buildChainLayout(c, Math.pow(2, rk / 2));
  else {
    // one source raster per creature for every level up to 1 voxel / look px
    const srcK = Math.max(rk, 0);
    const R = rasterFor(c, srcK, infl, pose, kf, deadline);
    if (!R) return null;
    L = buildLayout(c, srcK === rk ? R : resampleRaster(R, Math.pow(2, (rk - srcK) / 2)), infl / INFL_N, kf);
  }
  spent += now() - t0; workTotal += now() - t0;
  L.key = key;
  layouts.set(key, L);
  if (layouts.size > LAYOUT_MAX) { const k = layouts.keys().next().value; layouts.delete(k); }
  return L;
}

function gridFor(c, rk, infl, pose, sw, deadline) {
  const kind = isKind(c) || c.kind === 'chain';
  const kf = kind && c.kind !== 'chain' ? sw : 0;
  const lkey = vidOf(c) + '|' + rk + '|' + infl + '|' + (pose ? 1 : 0) + '|' + kf;
  const gkey = lkey + '#' + (kind ? 0 : sw);
  let G = grids.get(gkey);
  if (G) { touch(grids, gkey, G); return G; }
  const Lo = layoutFor(c, rk, infl, pose, kf, deadline);
  if (!Lo) return null;
  const t0 = now();
  G = buildGrid(Lo, kind ? 0 : sw);
  spent += now() - t0; workTotal += now() - t0;
  grids.set(gkey, G);
  gridBytes += G.bytes;
  while (gridBytes > GRID_BYTES_MAX && grids.size > 4) {
    const k = grids.keys().next().value;
    gridBytes -= grids.get(k).bytes;
    grids.delete(k);
  }
  return G;
}

let framePx = 0;
function storeFrame(fkey, meta, fr) {
  frames.set(fkey, fr);
  framePx += fr.W * fr.H;
  let m = byCreature.get(meta.vid);
  if (!m) byCreature.set(meta.vid, (m = new Map()));
  m.set(fkey, meta);
  while (framePx > FRAME_PX_MAX && frames.size > 8) {
    const k = frames.keys().next().value;
    const f = frames.get(k);
    framePx -= f.W * f.H;
    frames.delete(k);
    byCreature.get(f.vid)?.delete(k);
  }
}

function makeFrame(job, meta, up = 1) {
  const Sf = meta.Sb / up;
  const { cam, G } = job;
  const C = cam.project(G.center);
  const ax = C[0], ay = C[1];
  const rel = (p) => { const q = cam.project(p); return [q[0] - ax, q[1] - ay, q[2]]; };
  const anchors = {};
  for (const [k, p] of Object.entries(G.anchors)) anchors[k] = rel(p);
  return {
    canvas: job.canvas, glow: job.glowCanvas || null, W: cam.W, H: cam.H, ax, ay, s: job.s, Sb: Sf, up, vid: meta.vid,
    yaw: meta.yawI * YAW_STEP, pitch: meta.pitchI * (G.Lo.kind === 'chain' ? CHAIN_PITCH_STEP : PITCH_STEP), r: G.Lo.r,
    eyes: G.eyes.map((e) => { const q = rel(e.p); return { x: q[0], y: q[1], z: q[2], r: e.rLook * Sf, e: e.e, idx: e.idx, mirror: e.mirror, cheek: e.cheek, main: e.main }; }),
    mouth: G.mouth ? (() => { const q = rel(G.mouth.p); return { x: q[0], y: q[1], w: G.mouth.wLook * Sf, m: G.mouth.m, front: G.mouth.front }; })() : null,
    anchors,
    // everything the dynamic voxel parts need to line up with this frame (no grid reference kept)
    pc: {
      Lo: G.Lo, NY: G.NY, zc: G.zc, zOf: G.zOf, srcOf: G.srcOf, center: G.center, eyes3: G.eyes3 || [], mouth: G.mouth,
      yaw: job.yaw, pitch: job.pitch, s: job.s, up,
      pkey: meta.vid + '|' + meta.rk + '|' + meta.infl + '|' + meta.pose + '|' + meta.yawI + '|' + meta.pitchI + '|' + meta.sb,
    },
  };
}

function fkeyOf(m) { return m.vid + '|' + m.rk + '|' + m.infl + '|' + m.pose + '|' + m.sw + '|' + m.yawI + '|' + m.pitchI + '|' + m.sb; }

// Advance (or start) the job for a frame; returns the frame when complete.
function work(c, m, fkey, deadline) {
  let J = jobs.get(fkey);
  if (!J) {
    const G = gridFor(c, m.rk, m.infl, m.pose, m.sw, deadline);
    if (!G) return null;
    const yaw = m.yawI * YAW_STEP, pitch = m.pitchI * (c.kind === 'chain' ? CHAIN_PITCH_STEP : PITCH_STEP);
    // chunky voxels (giants at capped resolution) render at an integer fraction and upscale when drawn
    const s = m.Sb / G.Lo.r;
    const up = s > 2.6 ? Math.ceil(s / 2.2) : 1;
    J = { job: new Job(G, yaw, pitch, s / up, { outline: true }), meta: m, up };
    jobs.set(fkey, J);
    statJobs++;
  }
  J.last = now();
  const t0 = now();
  const done = J.job.step(deadline);
  const dt = now() - t0;
  spent += dt; workTotal += dt;
  if (!done) return null;
  jobs.delete(fkey);
  const fr = makeFrame(J.job, m, J.up);
  storeFrame(fkey, m, fr);
  statBuilt++;
  return fr;
}

// Nearest cached frame of the same creature (yaw first, then pitch, scale, swim frame).
function fallback(m) {
  const list = byCreature.get(m.vid);
  if (!list || !list.size) return null;
  let best = null, bd = Infinity;
  for (const [k, q] of list) {
    let d = Math.abs(q.yawI - m.yawI) * 4 + Math.abs(q.pitchI - m.pitchI) * 1.5 + Math.abs(q.sb - m.sb) * 0.9 + Math.abs(q.infl - m.infl) * 3 + (q.pose !== m.pose ? 20 : 0);
    const ds = Math.abs(q.sw - m.sw);
    d += Math.min(ds, SWIM_N - ds) * 0.5;
    if (d < bd) { const f = frames.get(k); if (f) { bd = d; best = f; } }
  }
  return best;
}

// ------------------------------------------------------------------ warm-up queue

const warmQ = [];
const warmed = new Set();
function queueWarm(c, m) {
  const key = m.vid + '|' + m.rk + '|' + m.infl + '|' + m.pose;
  if (warmed.has(key)) return;
  m = { ...m, pitchI: 0 };
  warmed.add(key);
  if (warmed.size > 4000) warmed.clear();
  const isK = isKind(c) || c.kind === 'chain';
  // the turn-around sweep first (so turning never pops), then the swim cycle side-on
  for (const y of [3, 6, 1, 2, 4, 5, -1, -2]) warmQ.push({ c, m: { ...m, yawI: y, sw: 0 } });
  if (!isK) for (let s = 1; s < SWIM_N; s++) warmQ.push({ c, m: { ...m, yawI: 0, sw: s } });
  else for (let s = 1; s < KIND_N; s++) warmQ.push({ c, m: { ...m, yawI: 0, sw: s } });
  if (warmQ.length > 600) warmQ.splice(0, warmQ.length - 600);
}
// Frames requested last frame, biggest on-screen creatures first, within the per-frame budget.
const wants = new Map();
function runWants() {
  const t = now();
  for (const [k, J] of jobs) if (t - J.last > 4000) jobs.delete(k);
  if (!wants.size) return;
  const list = [...wants.values()].sort((a, b) => b.pri - a.pri);
  wants.clear();
  const deadline = t + budgetMs;
  for (const w of list) {
    if (now() >= deadline) break;
    const fkey = fkeyOf(w.m);
    if (!frames.has(fkey)) work(w.c, w.m, fkey, deadline);
  }
}
function runWarm() {
  if (!warmQ.length || spent > budgetMs + WARM_MS) return;
  const deadline = now() + WARM_MS;
  let n = 0;
  while (warmQ.length && now() < deadline && n < 40) {
    const { c, m } = warmQ[0];
    const fkey = fkeyOf(m);
    if (frames.has(fkey)) { warmQ.shift(); n++; continue; }
    const fr = work(c, m, fkey, deadline);
    if (fr) warmQ.shift();
    n++;
  }
}

// ------------------------------------------------------------------ public frame API

/**
 * Best available voxel frame for a creature. req: {S (on-screen scale), yaw (canonical deg), pitch (deg),
 * sw (frame index), infl (0..INFL_N), pose, lod}. Returns {f, k} (k = extra draw scale) or null.
 */
export function voxelFrame(c, req) {
  ensureTick();
  if (syncAll) req = { ...req, force: true };
  const sb = scaleBucket(req.S);
  const Sb = bucketScale(sb);
  const rk = resLevel(c, Sb);
  const chain = c.kind === 'chain';
  const pStep = chain ? CHAIN_PITCH_STEP : PITCH_STEP, pMax = chain ? CHAIN_PITCH_MAX : PITCH_MAX;
  const m = {
    vid: vidOf(c), rk, Sb, sb,
    infl: req.infl || 0, pose: req.pose ? 1 : 0, sw: req.sw || 0,
    yawI: clamp(Math.round(req.yaw / YAW_STEP), -6, 6),
    pitchI: clamp(Math.round((req.pitch || 0) / pStep), -pMax, pMax),
  };
  const fkey = fkeyOf(m);
  let f = frames.get(fkey);
  if (f) { touch(frames, fkey, f); return { f, k: req.S / f.Sb }; }
  if (req.force) { f = work(c, m, fkey, now() + 1e6); if (f) return { f, k: req.S / f.Sb }; }
  // a neighbouring scale bucket of the same pose is close enough (drawn <= ~9% scaled): no rebuild
  for (const d of [1, -1]) {
    const sb2 = sb + d, Sb2 = bucketScale(sb2);
    const k2 = fkeyOf({ ...m, sb: sb2, rk: resLevel(c, Sb2) });
    const f2 = frames.get(k2);
    if (f2) { touch(frames, k2, f2); return { f: f2, k: req.S / f2.Sb }; }
  }
  if (rafOn) {
    const pri = req.S * lookLen(c) * (req.lod ? 0.35 : 1) * (req.pri ?? 1);
    const w = wants.get(fkey);
    if (!w || w.pri < pri) wants.set(fkey, { c, m, pri });
  } else if (!overBudget()) {
    f = work(c, m, fkey, now() + Math.max(0.5, budgetMs - spent));
    if (f) return { f, k: req.S / f.Sb };
  }
  queueWarm(c, m);
  const fb = fallback(m);
  if (fb) { statFallback++; return { f: fb, k: req.S / fb.Sb }; }
  // nothing at all for this creature yet: build one frame now within a separate allowance
  if (forceSpent < FORCE_MS || req.force) {
    const t0 = now();
    f = work(c, m, fkey, req.force ? t0 + 1e6 : t0 + Math.max(2, FORCE_MS - forceSpent));
    forceSpent += now() - t0;
    if (f) return { f, k: req.S / f.Sb };
  }
  return null;
}

/** Pre-build frames for a creature at one on-screen scale (both swim halves, side-on, and the turn). */
export function warmVoxelFish(c, scale) {
  const sb = scaleBucket(scale);
  const Sb = bucketScale(sb);
  const m = { vid: vidOf(c), rk: resLevel(c, Sb), Sb, sb, infl: 0, pose: 0, sw: 0, yawI: 0, pitchI: 0 };
  const fkey = fkeyOf(m);
  if (!frames.has(fkey)) work(c, m, fkey, now() + 1e6);
  queueWarm(c, m);
}

// Dev benchmark: time layout / grid / trace+shade / finish for one creature at scale S.
export function benchVoxel(c, S, yaw = 15, pitch = 0) {
  const Sb = bucketScale(scaleBucket(S)), rk = resLevel(c, Sb);
  const t0 = now();
  const Lo = layoutFor(c, rk, 0, false, 0, Infinity);
  const t1 = now();
  const G = buildGrid(Lo, 1);
  const t2 = now();
  const s = Sb / Lo.r, up = s > 2.6 ? Math.ceil(s / 2.2) : 1;
  const job = new Job(G, yaw, pitch, s / up, { outline: true });
  for (let y = 0; y < job.cam.H; y++) job.traceRow(y);
  const t3 = now();
  job.finish();
  const t4 = now();
  return { layout: +(t1 - t0).toFixed(2), grid: +(t2 - t1).toFixed(2), trace: +(t3 - t2).toFixed(2), finish: +(t4 - t3).toFixed(2), px: job.cam.W * job.cam.H, W: job.cam.W, H: job.cam.H, vox: G.NX + 'x' + G.NY + 'x' + G.NZ, r: +Lo.r.toFixed(2) };
}

export function clearVoxelFishCache() {
  rasters.clear(); layouts.clear(); grids.clear(); frames.clear(); jobs.clear(); byCreature.clear(); warmQ.length = 0; warmed.clear();
  gridBytes = 0; framePx = 0;
}

// ------------------------------------------------------------------ chain segments (voxel balls)

const balls = new Map();
export function chainBall(c, rScreen) {
  const rq = Math.max(1, Math.round(rScreen * 2) / 2);
  const key = vidOf(c) + '|' + rq;
  let b = balls.get(key);
  if (b) return b;
  const Rv = Math.max(1.5, rq / VP);
  const n = Math.ceil(Rv * 2) + 2;
  const NXY = n * n;
  const data = new Uint16Array(NXY * n);
  const zmin = new Int16Array(NXY).fill(32767), zmax = new Int16Array(NXY).fill(-1);
  const pal = new Pal();
  const m = n / 2;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const dx = (x + 0.5 - m) / Rv, dy = (y + 0.5 - m) / Rv; // 2D painter coords: y down
    const d2 = dx * dx + dy * dy;
    if (d2 > 1) continue;
    const col = chainSegColor(c, dx, dy, x, y) | 0xff000000;
    const pv = pal.idx(col, 0, false);
    const t = Math.round(Rv * Math.sqrt(1 - d2));
    const gy = n - 1 - y;
    for (let z = -t; z <= t; z++) {
      const zz = Math.floor(m) + z;
      if (zz < 0 || zz >= n) continue;
      const cc = x + gy * n;
      data[cc + zz * NXY] = pv;
      if (zz < zmin[cc]) zmin[cc] = zz;
      if (zz > zmax[cc]) zmax[cc] = zz;
    }
  }
  const G = { Lo: { r: 1 }, data, NX: n, NY: n, NZ: n, NXY, zmin, zmax, pal, x0: 0, y0: 0, z0: 0, x1: n - 1, y1: n - 1, z1: n - 1, center: [m, m, m], eyes: [], mouth: null, anchors: {} };
  const job = new Job(G, 0, 0, rq / Rv, { outline: true });
  job.step(Infinity);
  const C = job.cam.project(G.center);
  b = { canvas: job.canvas, ax: C[0], ay: C[1] };
  balls.set(key, b);
  if (balls.size > 400) balls.delete(balls.keys().next().value);
  return b;
}

// ------------------------------------------------------------------ dynamic voxel parts
// Small voxel models rendered with the frame's own camera (same rotation, scale and centre), so they line
// up with the cached body frame exactly: eyeballs (sclera, iris, pupil, glossy specular voxel) with lid
// voxels for blinks / squints / emotions, a dropping jaw, flaring gill covers and spinning turbine rotors.

const parts = new Map();
let partPx = 0;
const PART_PX_MAX = 3e6;
function partGet(key) { const p = parts.get(key); if (p) { parts.delete(key); parts.set(key, p); } return p; }
function partPut(key, p) {
  parts.set(key, p);
  partPx += p.W * p.H;
  while (partPx > PART_PX_MAX && parts.size > 16) {
    const k = parts.keys().next().value;
    partPx -= parts.get(k).W * parts.get(k).H;
    parts.delete(k);
  }
}

const rotCache = new Map();
function camRot(yaw, pitch) {
  const key = yaw * 1000 + pitch;
  let r = rotCache.get(key);
  if (!r) { const cam = camera({ center: [0, 0, 0], x0: 0, x1: 0, y0: 0, y1: 0, z0: 0, z1: 0 }, yaw, pitch, 1); r = [cam.R0, cam.R1, cam.R2]; rotCache.set(key, r); }
  return r;
}

// A part grid in body-grid coordinates: origin o (min corner, body voxels), n cells per axis, fe cells per voxel.
class PartGrid {
  constructor(o, n, fe, mat) {
    this.o = o; this.n = n; this.fe = fe;
    this.NX = n[0]; this.NY = n[1]; this.NZ = n[2]; this.NXY = n[0] * n[1];
    this.data = new Uint16Array(this.NXY * n[2]);
    this.zmin = new Int16Array(this.NXY).fill(32767); this.zmax = new Int16Array(this.NXY).fill(-1);
    this.pal = new Pal(mat);
    this.mat = mat;
    this.count = 0;
  }
  // body coords of a cell centre
  bx(i) { return this.o[0] + (i + 0.5) / this.fe; }
  by(j) { return this.o[1] + (j + 0.5) / this.fe; }
  bz(k) { return this.o[2] + (k + 0.5) / this.fe; }
  put(i, j, k, v) {
    if (i < 0 || j < 0 || k < 0 || i >= this.NX || j >= this.NY || k >= this.NZ) return;
    const col = i + j * this.NX;
    if (!this.data[col + k * this.NXY]) this.count++;
    this.data[col + k * this.NXY] = v;
    if (k < this.zmin[col]) this.zmin[col] = k;
    if (k > this.zmax[col]) this.zmax[col] = k;
  }
  // render with the frame camera; returns a draw-ready sprite or null when empty
  render(F, nf) {
    if (!this.count) return null;
    let x0 = this.NX, x1 = -1, y0 = this.NY, y1 = -1, z0 = this.NZ, z1 = -1;
    for (let y = 0; y < this.NY; y++) for (let x = 0; x < this.NX; x++) {
      const col = x + y * this.NX;
      if (this.zmax[col] < 0) continue;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (this.zmin[col] < z0) z0 = this.zmin[col]; if (this.zmax[col] > z1) z1 = this.zmax[col];
    }
    const fe = this.fe, C = F.center;
    const G = {
      Lo: { r: 1 }, data: this.data, NX: this.NX, NY: this.NY, NZ: this.NZ, NXY: this.NXY, zmin: this.zmin, zmax: this.zmax,
      pal: this.pal, mat: this.mat, x0, x1, y0, y1, z0, z1, nf,
      center: [(C[0] - this.o[0]) * fe, (C[1] - this.o[1]) * fe, (C[2] - this.o[2]) * fe], eyes: [], mouth: null, anchors: {},
    };
    const pu = F.up || 1;
    const job = new Job(G, F.yaw, F.pitch, (F.s * pu) / fe, { outline: false });
    const t0 = now();
    job.step(Infinity);
    const dt = now() - t0;
    spent += dt; workTotal += dt;
    const P = job.cam.project(G.center);
    return { canvas: job.canvas, glow: job.glowCanvas || null, ax: P[0], ay: P[1], pu, W: job.cam.W, H: job.cam.H };
  }
}

// Is the body-grid point inside the body (deeper than its outermost voxel layer by `inset`)?
function inBody(F, bx, by, bz, inset) {
  const Lo = F.Lo;
  if (!Lo.T || !Lo.mask) return false;
  const x = Math.floor(bx);
  if (x < 0 || x >= F.zOf.length) return false;
  const gx = F.srcOf ? F.srcOf[x] : x;
  const gy = F.NY - 1 - Math.floor(by);
  if (gx < 0 || gy < 0 || gx >= Lo.GW || gy >= Lo.GH) return false;
  const i = gy * Lo.GW + gx;
  if (!Lo.mask[i]) return false;
  return Math.abs(bz - (F.zc + 0.5 + F.zOf[x])) < Math.max(0, Math.round(Lo.T[i])) + 0.5 - inset;
}

// Lid apertures per emotion: u = upper-lid edge height, l = lower-lid edge (eye-local, -1 bottom .. 1 top),
// s = slant (+ lowers the lid toward the snout: angry; - lowers it toward the back: sad).
const LIDS = {
  open: { u: 1.2, l: -1.2, s: 0 },
  neutral: { u: 1.05, l: -1.05, s: 0 }, happy: { u: 0.18, l: -0.05, s: 0 }, sad: { u: 0.4, l: -1.05, s: -0.45 },
  angry: { u: 0.12, l: -0.6, s: 0.5 }, scared: { u: 1.05, l: -1.05, s: 0 }, surprised: { u: 1.1, l: -1.1, s: 0 },
  love: { u: 1.05, l: -1.05, s: 0 }, sleepy: { u: -0.02, l: -0.62, s: -0.1 }, dizzy: { u: 1.05, l: -1.05, s: 0 },
  smug: { u: 0.1, l: -0.45, s: -0.12 }, determined: { u: 0.22, l: -0.62, s: 0.35 }, tired: { u: 0.05, l: -0.66, s: -0.22 },
  disgust: { u: 0.15, l: -0.32, s: 0.25 },
};
const q6 = (v) => Math.round(v * 6) / 6;

function eyeState(c, fs, st, e) {
  const toon = !!c.toon || e.type === 'googly' || e.type === 'pixel';
  const emo = fs.emotion || 'neutral';
  const L0 = toon ? LIDS.neutral : LIDS.open, L1 = LIDS[emo] || L0;
  const k = toon ? 1 : 0.75;
  let u = L0.u + (L1.u - L0.u) * k, l = L0.l + (L1.l - L0.l) * k;
  if (!toon && emo === 'neutral') { u = L0.u; l = L0.l; }
  const s = L1.s * k;
  const bl = clamp01(fs.blink || 0);
  u = u + (-0.12 - u) * bl;
  l = l + (-0.16 - l) * bl * bl * 0.6;
  let lx = fs.lx || 0, ly = fs.ly || 0;
  if (e.type === 'googly') { lx = fs.gx; ly = fs.gy; }
  const pup = toon ? (emotionParams(emo).pupil ?? 1) : fs.pupil || 1;
  return {
    u: q6(u), l: q6(l), s: Math.round(s * 4) / 4, lx: Math.round(clamp(lx, -1, 1) * 3) / 3, ly: Math.round(clamp(ly, -1, 1) * 3) / 3,
    pup: Math.round(clamp(pup, 0.4, 1.6) * 6) / 6, love: toon && emo === 'love', dizzy: toon && emo === 'dizzy',
  };
}

function buildEyePart(F, e3, fl, S, fe) {
  const rb = e3.rb, C = fl.c, n = fl.n;
  const m = rb * 1.42 + 1.5 / fe;
  const N = Math.ceil(2 * m * fe) + 1;
  const o = [C[0] - N / (2 * fe), C[1] - N / (2 * fe), C[2] - N / (2 * fe)];
  const P = new PartGrid(o, [N, N, N], fe, F.Lo.mat || DEF_MAT);
  // eye frame: n outward, up = world up orthogonalised, fw = forward (toward the snout / screen right)
  let up = [0, 1, 0];
  const dn = n[1];
  up = norm3(up[0] - n[0] * dn, up[1] - n[1] * dn, up[2] - n[2] * dn);
  const fw = norm3(up[1] * n[2] - up[2] * n[1], up[2] * n[0] - up[0] * n[2], up[0] * n[1] - up[1] * n[0]);
  const fsg = fl.fl === -1 ? -1 : 1; // forward is +x on both flanks
  const fwx = fw[0] * fsg >= 0 ? fw : [-fw[0], -fw[1], -fw[2]];
  const gz = 0.62;
  const g = norm3(n[0] + (fwx[0] * S.lx - up[0] * S.ly) * gz + 0.1, n[1] + (fwx[1] * S.lx - up[1] * S.ly) * gz, n[2] + (fwx[2] * S.lx - up[2] * S.ly) * gz);
  const [R0, R1, R2] = camRot(F.yaw, F.pitch);
  const hM = norm3(HALF[0] * R0[0] + HALF[1] * R1[0] + HALF[2] * R2[0], HALF[0] * R0[1] + HALF[1] * R1[1] + HALF[2] * R2[1], HALF[0] * R0[2] + HALF[1] * R1[2] + HALF[2] * R2[2]);
  const hn = hM[0] * n[0] + hM[1] * n[1] + hM[2] * n[2];
  const h2 = norm3(2 * hn * n[0] - hM[0], 2 * hn * n[1] - hM[1], 2 * hn * n[2] - hM[2]);
  const Re = rb * fe;
  const cosS = Math.cos(Math.min(0.55, 1.2 / Re)), cosS2 = Math.cos(Math.min(0.32, 0.7 / Re));
  const lt = Math.max(0.16, 1.25 / Re);
  const pal = P.pal, e = e3.e;
  const cube = e.type === 'pixel';
  const lidU = e3.lidU, lidL = e3.lidL, skin = e3.skin;
  const lash = (p) => mixP(p, 0xff3a2018, 0.55);
  const vSkinU = pal.idx(lidU, R_BODY, false), vSkinL = pal.idx(lidL, R_BODY, false);
  const vLashU = pal.idx(lash(lidU), R_BODY, false), vLashL = pal.idx(lash(lidL), R_BODY, false);
  const vRim = pal.idx(mixP(skin, 0xff3a1810, 0.55), R_PUPIL, false);
  const vSpec = pal.idx(0xffffffff, R_SPEC, false), vSpec2 = pal.idx(0xfffff0d8, R_SPEC, false);
  const stalk = fl.fl === 0;
  let best = -2, bestAt = -1, best2 = -2, best2At = -1;
  for (let k = 0; k < N; k++) for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const bx = P.bx(i), by = P.by(j), bz = P.bz(k);
    const qx = (bx - C[0]) / rb, qy = (by - C[1]) / rb, qz = (bz - C[2]) / rb;
    const d = cube ? Math.max(Math.abs(qx), Math.abs(qy), Math.abs(qz)) : Math.hypot(qx, qy, qz);
    if (d > 1 + lt + 0.4) continue;
    const a = qx * n[0] + qy * n[1] + qz * n[2];
    if (!stalk && a < -0.2) continue;
    if (!stalk && inBody(F, bx, by, bz, 0.55)) continue;
    const dd = Math.hypot(qx, qy, qz) || 1;
    const ux = qx / dd, uy = qy / dd, uz = qz / dd;
    const qu = ux * up[0] + uy * up[1] + uz * up[2];
    const qf = ux * fwx[0] + uy * fwx[1] + uz * fwx[2];
    const eU = S.u - S.s * qf, eL = S.l + 0.12 * qf * qf;
    if (d <= 1) {
      // eyeball (parts under closed lids are hidden by the lid shell in front)
      const [col, role, gl] = eyeColor(e, ux, uy, uz, g, S.pup, S.love, S.dizzy);
      P.put(i, j, k, pal.idx(col, role, !!gl));
      if (d > 1 - 1.5 / Re && qu < eU - 0.08 && qu > eL + 0.08 && role === R_PUPIL) {
        const h1 = ux * hM[0] + uy * hM[1] + uz * hM[2], h2d = ux * h2[0] + uy * h2[1] + uz * h2[2];
        if (h1 > best) { best = h1; bestAt = i + j * N + k * N * N; }
        if (h2d > best2) { best2 = h2d; best2At = i + j * N + k * N * N; }
      }
      continue;
    }
    if (d <= 1 + lt && a > -0.05 && (qu > eU || qu < eL)) {
      // lid shell, darker lash line along its edge
      const upper = qu > eU;
      const edge = upper ? qu - eU < lt * 1.6 + 0.08 : eL - qu < lt * 1.6 + 0.08;
      P.put(i, j, k, upper ? (edge ? vLashU : vSkinU) : edge ? vLashL : vSkinL);
      continue;
    }
    if (!stalk) {
      // socket crease: a thin dark ring where the eyeball meets the skin
      const rho = Math.sqrt(Math.max(0, dd * dd - a * a));
      if (rho >= 0.98 && rho <= 1.0 + Math.max(0.12, 1.1 / Re) && !inBody(F, bx, by, bz, 0.2) && inBody(F, bx, by, bz - (fl.fl || 1) * 1.1, -0.1)) P.put(i, j, k, vRim);
    }
  }
  // glossy specular voxel(s): the eyeball surface voxels facing the light's half vector
  const setAt = (at, v) => { if (at < 0) return; const i = at % N, j = Math.floor(at / N) % N, k = Math.floor(at / (N * N)); P.data[i + j * N + k * N * N] = v; };
  setAt(bestAt, vSpec);
  if (Re >= 4.5 && best2At !== bestAt) setAt(best2At, vSpec2);
  const cx = (C[0] - o[0]) * fe, cy = (C[1] - o[1]) * fe, cz = (C[2] - o[2]) * fe;
  const nf = (ix, iy, iz, v) => {
    if (v === vRim) return null;
    return norm3(ix + 0.5 - cx, iy + 0.5 - cy, iz + 0.5 - cz);
  };
  return P.render(F, nf);
}

// Jaw gape: the lower jaw drops, opening a dark mouth (side view), or a round mouth opens (front faces).
function buildGapePart(F, open) {
  const G3 = F.mouth, Lo = F.Lo;
  if (!G3 || !G3.p) return null;
  const W = Math.max(1.5, G3.wLook * Lo.r);
  const mx = G3.p[0], my = G3.p[1];
  const fe = W < 6 ? 2 : 1;
  const front = !!G3.front;
  const drop = open * W * (front ? 0.5 : 0.55);
  const o = [mx - W * 1.1 - 1, my - drop - W * 0.45 - 2, F.zc - Lo.maxT - 3];
  const N = [Math.ceil((W * 1.3 + 3) * fe), Math.ceil((drop + W * 0.6 + 4) * fe), Math.ceil((2 * Lo.maxT + 7) * fe)];
  const P = new PartGrid(o, N, fe, Lo.mat || DEF_MAT);
  const pal = P.pal;
  const belly = Lo.eyes?.[0]?.lidL || (Lo.c.bellyR?.[3] ?? 0xffd8e0e8);
  const vIn0 = pal.idx(hexP('#2a0a16'), R_MOUTH, false), vIn1 = pal.idx(hexP('#6a1e30'), R_MOUTH, false), vTongue = pal.idx(hexP('#d4566a'), R_MOUTH, false);
  const vJaw = pal.idx(belly | 0xff000000, R_BODY, false), vLip = pal.idx((Lo.c.mouth?.R?.[2] ?? belly) | 0xff000000, R_BODY, false);
  const vTooth = pal.idx(0xfff8fcff, R_EYE, false);
  const teeth = Lo.c.mouth?.type === 'fangs' || Lo.c.mouth?.teeth;
  for (let k = 0; k < N[2]; k++) for (let j = 0; j < N[1]; j++) for (let i = 0; i < N[0]; i++) {
    const bx = P.bx(i), by = P.by(j), bz = P.bz(k);
    const x = Math.floor(bx);
    if (x < 0 || x >= F.zOf.length) continue;
    const zcm = F.zc + 0.5 + F.zOf[x];
    if (front) {
      const ry = Math.max(0.6, drop), rx = W * 0.42;
      const ex = (bx - mx) / rx, ey = (by - (my - ry * 0.5)) / ry;
      const e2 = ex * ex + ey * ey;
      if (e2 > 1.35) continue;
      const surf = inBody(F, bx, by, bz, 0.4) ? 1 : 0;
      if (!surf || inBody(F, bx, by, bz, 1.6)) continue;
      P.put(i, j, k, e2 > 1 ? vLip : ey > 0.45 && Math.abs(ex) < 0.5 ? vTongue : e2 > 0.6 ? vIn1 : vIn0);
      continue;
    }
    const t = (bx - (mx - W)) / W; // 0 at the mouth corner .. 1 at the tip
    if (t < 0 || t > 1.08) continue;
    const gy = F.NY - 1 - Math.floor(my);
    const sx = F.srcOf ? F.srcOf[x] : x;
    const ti = gy >= 0 && sx >= 0 && gy < Lo.GH && sx < Lo.GW ? Lo.T[gy * Lo.GW + sx] : -1;
    const Tm = Math.max(0.8, ti * 0.86);
    if (Math.abs(bz - zcm) > Tm) continue;
    const dr = drop * Math.pow(clamp01(t), 1.15);
    const jw = Math.max(1, W * 0.2);
    if (by <= my && by > my - dr) {
      const deep = (my - by) / Math.max(0.5, dr);
      let v = t > 0.75 || deep < 0.25 ? vIn1 : vIn0;
      if (deep > 0.62 && t > 0.3 && t < 0.85) v = vTongue;
      if (teeth && (deep < 0.2 || deep > 0.85) && ((Math.floor(bx * 1.2) & 1) === 0) && t > 0.35) v = vTooth;
      P.put(i, j, k, v);
    } else if (by <= my - dr && by > my - dr - jw) {
      P.put(i, j, k, by > my - dr - 0.8 && t > 0.6 ? vLip : vJaw);
    }
  }
  return P.render(F, null);
}

// Gill flare: the operculum edge lifts off the flank and a crescent of red gill filaments shows under it.
function buildGillPart(F, w, fl) {
  const Lo = F.Lo;
  if (!Lo.gill || Lo.gill.length < 3) return null;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [x, y] of Lo.gill) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const fe = 2;
  const o = [x0 - w - 3, F.NY - y1 - 3, F.zc - Lo.maxT - w - 4];
  const N = [Math.ceil((x1 - x0 + w + 6) * fe), Math.ceil((y1 - y0 + 6) * fe), Math.ceil((2 * Lo.maxT + 2 * w + 9) * fe)];
  const P = new PartGrid(o, N, fe, Lo.mat || DEF_MAT);
  const pal = P.pal;
  const reds = ['#5a0a1a', '#a01c34', '#e0485a'].map((h) => pal.idx(hexP(h), R_MOUTH, false));
  const skin = pal.idx((Lo.eyes?.[0]?.skin ?? 0xff8899aa) | 0xff000000, R_BODY, false);
  for (const [gx, gy] of Lo.gill) {
    const x = Math.round(gx);
    const sx = F.srcOf ? F.srcOf[clamp(x, 0, F.srcOf.length - 1)] : x;
    const li = Math.floor(gy) * Lo.GW + sx;
    if (sx < 0 || li < 0 || li >= Lo.T.length || !Lo.mask[li]) continue;
    const T0 = Math.max(0, Math.round(Lo.T[li]));
    const zs = F.zc + 0.5 + (F.zOf[clamp(x, 0, F.zOf.length - 1)] || 0) + fl * (T0 + 0.5);
    const by = F.NY - gy;
    // filaments behind the edge, the lifted cover plate on it
    for (let a = 0; a < Math.max(1, w * fe); a++) {
      const bx = gx - a / fe;
      const i = Math.floor((bx - o[0]) * fe), j = Math.floor((by - o[1]) * fe), k = Math.floor((zs + fl * 0.3 - o[2]) * fe);
      P.put(i, j, k, reds[a === 0 ? 0 : a < w * fe * 0.5 ? 1 : 2]);
    }
    for (let a = 0; a <= Math.ceil(w * 0.8 * fe); a++) {
      const bz = zs + fl * (0.3 + a / fe);
      const i = Math.floor((gx + 0.4 - o[0]) * fe), j = Math.floor((by - o[1]) * fe), k = Math.floor((bz - o[2]) * fe);
      P.put(i, j, k, skin); P.put(i + 1, j, k, skin);
    }
  }
  return P.render(F, null);
}

// Wind-turbine rotor (look.rotor): hub + tapered blades spinning about the axis toward the viewer.
function buildRotorPart(F, q, step, RS) {
  const R = q.R, fe = R < 10 ? 2 : 1;
  const x = clamp(Math.round(q.x), 0, F.zOf.length - 1);
  const H = [q.x + 0.5, F.NY - q.hy - 0.5, F.zc + 0.5 + F.zOf[x] + q.front];
  const o = [H[0] - R - 2, H[1] - R - 2, H[2] - q.rn * 1.8 - 2];
  const N = [Math.ceil((2 * R + 4) * fe), Math.ceil((2 * R + 4) * fe), Math.ceil((q.rn * 3.6 + 5) * fe)];
  const P = new PartGrid(o, N, fe, { ...(F.Lo.mat || DEF_MAT), iri: 0.08, gloss: 1 });
  const pal = P.pal;
  const vB = pal.idx(q.bladeP, R_BODY, false), vB2 = pal.idx(mixP(q.bladeP, 0xff9a8a80, 0.25), R_BODY, false);
  const vT = q.tipP ? pal.idx(q.tipP, R_BODY, false) : vB, vH = pal.idx(q.hubP, R_BODY, false);
  const th0 = (step / RS) * (TAU / q.blades);
  for (let k = 0; k < N[2]; k++) for (let j = 0; j < N[1]; j++) for (let i = 0; i < N[0]; i++) {
    const dx = P.bx(i) - H[0], dy = P.by(j) - H[1], dz = P.bz(k) - H[2];
    // hub spinner: an ellipsoid nosecone toward the viewer
    const hr = q.rn * 1.05;
    if ((dx * dx + dy * dy) / (hr * hr) + (dz > 0 ? (dz / (hr * 1.5)) ** 2 : (dz / hr) ** 2) <= 1) { P.put(i, j, k, vH); continue; }
    if (dz < -1.1 || dz > 0.6) continue;
    const rho = Math.hypot(dx, dy);
    if (rho < hr * 0.7 || rho > R) continue;
    const t = rho / R;
    const ang = Math.atan2(dy, dx);
    for (let b = 0; b < q.blades; b++) {
      let da = ang - (th0 + (b * TAU) / q.blades);
      da = Math.atan2(Math.sin(da), Math.cos(da));
      if (Math.abs(da) > 1.2) continue;
      const perp = rho * Math.sin(da);
      const wdt = R * (q.chord * Math.pow(1 - t, 0.55) * (t < 0.2 ? 0.6 + 2 * t : 1) + 0.02) + 0.35;
      if (Math.abs(perp) > wdt) continue;
      // twisted blade: leading edge toward the viewer, trailing edge set back
      const zt = perp / wdt > 0.2 ? 0 : -0.6;
      if (dz < zt - 0.5 || dz > zt + 0.6) continue;
      P.put(i, j, k, t > 0.86 && q.tipP ? vT : perp / wdt < -0.55 ? vB2 : vB);
      break;
    }
  }
  return P.render(F, null);
}

/**
 * Push the dynamic voxel parts of a voxel frame into a draw list (items in frame canvas units, relative to
 * the body centre): [canvas, dx, dy, w, h]. fs = face state from fishrig (emotion, blink, look, pupil, open).
 */
export function voxelParts(items, glows, c, f, st, fs, lod = 0) {
  const F = f.pc;
  if (!F) return;
  const Lo = F.Lo;
  const [, , R2] = camRot(F.yaw, F.pitch);
  const scr = F.s * (F.up || 1); // screen px per body voxel
  const push = (p) => {
    if (!p) return;
    items.push([p.canvas, -p.ax / p.pu, -p.ay / p.pu, p.W / p.pu, p.H / p.pu]);
    if (p.glow) glows.push([p.glow, -p.ax / p.pu, -p.ay / p.pu, p.W / p.pu, p.H / p.pu, true]);
  };
  const build = (key, fn, fbKey) => {
    let p = partGet(key);
    if (p !== undefined) return p;
    if (overBudget() && !syncAll) {
      if (fbKey) { const q = partGet(fbKey); if (q !== undefined) return q; }
      if (forceSpent > FORCE_MS) return null;
    }
    const t0 = now();
    p = fn();
    forceSpent += overBudget() ? now() - t0 : 0;
    partPut(key, p || { canvas: null, W: 0, H: 0 });
    return p;
  };
  const time = st.time || 0;
  // eyes (skip tiny / far ones: their baked eyeball reads fine)
  if (lod < 1 || st.pri > 1) {
    const gl = c.glasses, lens = gl && (gl.style || 'shades') !== 'round' && gl.style !== 'square';
    for (const e3 of F.eyes3) {
      if (e3.rb * scr < 1.6) continue;
      if (lens && (e3.main || gl.both || e3.front)) continue; // behind dark lenses / an eye patch
      const S = eyeState(c, fs, st, e3.e);
      const fe = clamp(Math.min(Math.round(scr), Math.floor(9 / e3.rb)), 1, 3);
      for (const fl of e3.flanks) {
        const vis = fl.n[0] * R2[0] + fl.n[1] * R2[1] + fl.n[2] * R2[2];
        if (fl.fl !== 0 && vis < -0.12) continue;
        const base = F.pkey + '|e' + e3.idx + '|' + fl.fl + '|' + fe;
        const key = base + '|' + S.u + ',' + S.l + ',' + S.s + ',' + S.lx + ',' + S.ly + ',' + S.pup + (S.love ? 'L' : '') + (S.dizzy ? 'D' : '');
        const nS = eyeState(c, { emotion: 'neutral', blink: 0, lx: 0, ly: 0, pupil: 1, gx: 0, gy: 0.5 }, st, e3.e);
        const fbKey = base + '|' + nS.u + ',' + nS.l + ',' + nS.s + ',' + nS.lx + ',' + nS.ly + ',' + nS.pup;
        const p = build(key, () => buildEyePart(F, e3, fl, S, fe), fbKey);
        if (p && p.canvas) push(p);
      }
    }
  }
  // jaw gape
  const open = clamp01(fs.open || 0);
  if (F.mouth && F.mouth.m && F.mouth.m.type !== 'none' && open > 0.14 && lod < 1 && F.mouth.wLook * Lo.r * scr >= 3) {
    const oq = Math.max(1, Math.round(open * 3)) / 3;
    const nm = F.mouth.front ? [0, 0, 1] : [1, 0, 0];
    if (nm[0] * R2[0] + nm[2] * R2[2] > -0.3 || !F.mouth.front) {
      const p = build(F.pkey + '|gape|' + oq, () => buildGapePart(F, oq));
      if (p && p.canvas) push(p);
    }
  }
  // breathing gill flare (faster / wider when stressed)
  if (Lo.gill && lod < 1 && !c.toon) {
    const cue = fs.cue || {};
    const rate = 0.6 * (cue.breath || 1);
    const b = 0.5 + 0.5 * Math.sin(time * TAU * rate + (c.id || 0));
    let w = b > 0.82 ? 2 : b > 0.5 ? 1 : 0;
    if (w && (cue.breath || 1) >= 2) w++;
    if (w) {
      for (const fl of [1, -1]) {
        if (fl * R2[2] < 0.15) continue;
        const p = build(F.pkey + '|gill|' + fl + '|' + w, () => buildGillPart(F, w * 0.6, fl));
        if (p && p.canvas) push(p);
      }
    }
  }
  // spinning turbine rotors
  for (const [qi, q] of (Lo.rotors || []).entries()) {
    const RS = 8;
    const step = Math.floor(fract(time * q.speed * q.blades) * RS) % RS;
    const p = build(F.pkey + '|rot' + qi + '|' + step + '|' + (st.swimPhase != null ? 0 : 0), () => buildRotorPart(F, q, step, RS));
    if (p && p.canvas) push(p);
  }
}

// ------------------------------------------------------------------ aquarium API

/**
 * Draw a fish object (aquarium / tank space) as a voxel sculpture. f: {c, x, y, facing, turn, vx, vz,
 * angle, tailPhase, swimPhase, finPhase, bob, squash, blink, mouth, emotion, inflate, quirks, chain}.
 * opts: {scale, glow, alpha}. Returns anchors {top, mouth, eyes, w, h}.
 */
export function drawVoxelFish(ctx, f, opts = {}) {
  const S = opts.scale ?? f.scale ?? 1;
  const vz = f.vz || 0, sp = Math.abs(f.vx || 0) + 6;
  const heading = clamp(Math.atan2(vz * 260, sp) / DEG, -55, 55);
  const alpha = opts.alpha ?? 1;
  if (f.wk) drawPellets(ctx, f, alpha);
  if (alpha < 1) ctx.globalAlpha = alpha;
  const a = drawFishRig(ctx, f.c, {
    x: f.x, y: f.y, bob: f.bob || 0, facing: f.facing ?? 1, turn: f.turn ?? f.facing ?? 1, angle: f.angle || 0, scale: S,
    squash: f.squash || 0, swimPhase: f.swimPhase ?? f.tailPhase ?? 0, tailPhase: f.tailPhase ?? 0, finPhase: f.finPhase ?? 0,
    speed01: f.speed01 ?? 0.4, inflate: f.quirks?.has?.('inflate') ? f.inflate || 0 : 0,
    lookX: f.lookX ?? null, lookY: f.lookY ?? null, blink: f.blink || 0, emotion: f.emotion || 'neutral', mouth: f.mouth || 0,
    time: f.age ?? 0, glow: opts.glow ?? 0, heading, chain: f.chain, voxAlpha: alpha, ...(f.wk ? wakkaRig(f) : null),
  });
  ctx.globalAlpha = 1;
  return a;
}
