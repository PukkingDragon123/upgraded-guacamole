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
// Canonical yaw is -90..90 (0 = facing right, 90 = toward the viewer); left-facing fish are mirrored.
// Composition (face overlays, wash, glow, silhouette) lives in fishrig.js (drawFishRig, style 'voxel').
// drawVoxelFish(ctx, fish, {scale, glow, alpha}) remains for the aquarium (fish objects in tank space).

import { rigLayers, rigGeom, rasterLayerVox, voxAlbedo, paintEye, eyeBox, paintMouth, mouthBox, isKind, chainHeadVox, chainSegColor } from './fishart.js';
import { PixelBuffer } from './pixel.js';
import { makeCanvas, ctxOf } from '../core/canvas.js';
import { drawFishRig } from './fishrig.js';

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
const KIND_K = { crab: 0.72, seahorse: 0.55, ray: 0.16, squid: 0.62, isopod: 0.78, iconfish: 0.42, octopus: 1, jelly: 1, pudding: 1, blob: 0.9, chain: 0.85 };
const REVOLVE = new Set(['jelly', 'pudding', 'octopus']);

// ------------------------------------------------------------------ budget

let budgetMs = 3.2, spent = 0, forceSpent = 0, rafOn = false, lastReset = 0;
let statBuilt = 0, statFallback = 0, statJobs = 0, statPx = 0, workTotal = 0;
const FORCE_MS = 14;               // extra per-frame allowance to get a creature's very first frame
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

class Pal {
  constructor() {
    this.map = new Map();
    this.rgb = [0]; this.alpha = [1]; this.role = [0]; this.em = [0];
    this.ramps = [null];
  }
  // role: 0 body, 1 fin, 2 eye, 3 mouth, 4 thin extra
  idx(col, role, glow) {
    const a = col >>> 24;
    const aq = a >= 235 ? 4 : a >= 170 ? 3 : a >= 110 ? 2 : 1;
    const key = (col & 0xffffff) + 16777216 * (role + 8 * aq + (glow ? 64 : 0));
    let i = this.map.get(key);
    if (i !== undefined) return i;
    if (this.rgb.length >= 65000) return 1;
    i = this.rgb.length;
    this.rgb.push(col & 0xffffff);
    this.alpha.push(aq === 4 ? 1 : aq === 3 ? 0.86 : aq === 2 ? 0.7 : 0.55);
    this.role.push(role);
    this.em.push(glow ? 1 : 0);
    this.ramps.push(null);
    this.map.set(key, i);
    return i;
  }
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
  // face: eyes + closed mouth painted at model resolution
  const eyeCol = new Uint32Array(N), eyeGlow = new Uint8Array(N);
  const eyes = [];
  for (const ev of geo.eyes || []) {
    const R = Math.max(0.8, ev.r);
    const hb = eyeBox(R);
    const buf = new PixelBuffer(hb * 2, hb * 2);
    const gb = ev.e.type === 'glow' ? new PixelBuffer(hb * 2, hb * 2) : null;
    voxAlbedo(() => paintEye(buf, gb, hb, hb, c, ev.e, { emotion: 'neutral', blink: 0, lx: 0.2, ly: 0, gx: 0.15, gy: 0.5, time: 0, mirror: ev.mirror, cheek: false, main: ev.main, pupil: 1, dim: 0 }, 0, R));
    const ox = Math.round(ev.x) - hb + PAD, oy = Math.round(ev.y) - hb + PAD;
    for (let y = 0; y < buf.h; y++) for (let x = 0; x < buf.w; x++) {
      const p = buf.data[y * buf.w + x];
      if ((p >>> 24) < 100) continue;
      const gx = x + ox, gy = y + oy;
      if (gx < 0 || gy < 0 || gx >= GW || gy >= GH) continue;
      eyeCol[gy * GW + gx] = p | 0xff000000;
      if (gb && gb.data[y * buf.w + x]) eyeGlow[gy * GW + gx] = 1;
    }
    eyes.push({ x: ev.x + PAD, y: ev.y + PAD, rv: R, rLook: R / r, e: ev.e, idx: ev.idx, mirror: ev.mirror, cheek: ev.cheek, main: ev.main });
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
  return {
    c, kind, revolve, r, GW, GH, PAD, L, mask, T, Tx, Ty, maxT, eyeCol, eyeGlow, mouthCol, eyes, mouth, anchors,
    origin: [geo.ox + PAD, geo.oy + PAD], nose, bodyTail, tailEnd, pecRoot, pecLen: Math.max(0, pecRoot - pecMin),
    wave: c.wave ?? 0.5, pal: new Pal(), bytes: N * 40,
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
  const eyes = hv.face.eyes.map((ev) => ({ x: ev.x + PAD, y: ev.y + PAD, rv: ev.r, rLook: ev.r / r, e: ev.e, idx: ev.idx, mirror: ev.mirror, cheek: ev.cheek, main: ev.main }));
  const mo = hv.face.mouth;
  return {
    c, kind: 'chain', revolve: false, r, GW, GH, PAD, L: { body: { col, glow: null } }, mask, T, Tx, Ty, maxT,
    eyeCol: new Uint32Array(N), eyeGlow: new Uint8Array(N), mouthCol: new Uint32Array(N), eyes,
    mouth: mo ? { x: mo.x + PAD, y: mo.y + PAD, wLook: mo.w / r, m: mo.m, front: mo.front } : null,
    anchors: { mouth: [hv.face.nose[0] + PAD, hv.face.nose[1] + PAD], top: [o, o - c.chain.r * r * 1.2], bottom: [o, o + c.chain.r * r * 1.2], tail: [o - c.chain.r * r, o] },
    origin: [o, o], nose: GW - 1, bodyTail: 0, tailEnd: 0, pecRoot: -1, wave: 0, pal: new Pal(), bytes: N * 30,
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
  const pecA = 0.42 + 0.32 * Math.sin(TAU * ph + 1.1);
  const pecReach = Lo.pecRoot >= 0 && L.front ? Lo.pecLen || 0 : 0;
  const NZ = 2 * (Math.ceil(maxT) + bendMax + 4 + Math.ceil(pecReach * 0.6)) + 3;
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
  const tAt = (gx, gy) => (gx < 0 || gy < 0 || gx >= GW || gy >= GH ? -1 : T[gy * GW + gx]);
  const glowOf = (ly, i) => !!(ly.glow && ly.glow[i]);
  // body
  const bcol = L.body?.col;
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
      const pv = pal.idx(bcol[i] | 0xff000000, thin && !kind ? 4 : 0, glowOf(L.body, i));
      for (let z = -zr; z <= zr; z++) set(tx, gy, zc + z + zo, pv);
      // face stamps on both flanks
      const ec = eyeCol[i];
      if (ec) {
        const pe = pal.idx(ec, 2, !!eyeGlow[i]);
        const ev = nearestEye(Lo, gx, gy);
        let dome = 1;
        if (ev && ev.rv >= 2.6) {
          const d2 = ((gx + 0.5 - ev.x) ** 2 + (gy + 0.5 - ev.y) ** 2) / (ev.rv * ev.rv);
          dome = 1 + Math.round(Math.max(0, 1 - d2) * Math.min(2, ev.rv * 0.28));
        }
        for (let z = zr + 1; z <= zr + dome; z++) { set(tx, gy, zc + z + zo, pe); set(tx, gy, zc - z + zo, pe); }
        if (dome > 1) { set(tx, gy, zc + zr + zo, pe); set(tx, gy, zc - zr + zo, pe); }
      }
      const mc = mouthCol[i];
      if (mc) {
        const pm = pal.idx(mc, 3, false);
        set(tx, gy, zc + zr + zo, pm); set(tx, gy, zc - zr + zo, pm);
      }
    }
  }
  // eyes / mouth outside the body mask (eye stalks, faces on thin parts): stamp on the centre plane
  for (let gy = 0; gy < GH; gy++) for (let gx = 0; gx < GW; gx++) {
    const i = gy * GW + gx;
    if (mask[i]) continue;
    const ec = eyeCol[i], mc = mouthCol[i];
    if (!ec && !mc) continue;
    const pv = ec ? pal.idx(ec, 2, !!eyeGlow[i]) : pal.idx(mc, 3, false);
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
    Lo, data, NX, NY, NZ, NXY, zmin, zmax, pal, x0, x1, y0, y1, z0, z1, srcOf, zOf, zc,
    center: [Lo.origin[0], NY - Lo.origin[1], zc + 0.5],
    eyes, mouth, anchors, bytes: data.byteLength + NXY * 4,
  };
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
                transA = a; transT = t;
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
        out[p] = ((transC & 0xffffff) | (Math.round(transA * 255) << 24)) >>> 0;
        depth[p] = transT;
        if (transG) (this.glow ||= new Uint32Array(W * cam.H))[p] = transC;
      }
    }
  }

  // Shade one voxel face (cached): returns a packed colour; sets this.lastGlow.
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
    const fn = FN[face];
    let nx = fn[0], ny = fn[1], nz = fn[2];
    // smoothed normal from the occupancy gradient (opaque voxels)
    let gx = 0, gy = 0, gz = 0;
    const Lo = G.Lo;
    if ((role === 0 || role === 3) && Lo.Tx && G.srcOf) {
      // analytic flank normal of the extruded body: F = |z - zc| - T(x, y)
      const sxi = G.srcOf[ix];
      const li = (NY - 1 - iy) * Lo.GW + sxi;
      if (sxi >= 0 && Lo.mask[li]) {
        const side = iz + 0.5 - (G.zc + 0.5 + G.zOf[ix]) >= 0 ? 1 : -1;
        let ax = -Lo.Tx[li], ay = Lo.Ty[li], az = side;
        const al = Math.hypot(ax, ay, az);
        ax /= al; ay /= al; az /= al;
        gx = ax; gy = ay; gz = az;
        const wf = role === 3 ? 0.3 : FACET;
        nx = nx * wf + ax * (1 - wf); ny = ny * wf + ay * (1 - wf); nz = nz * wf + az * (1 - wf);
        const l = Math.hypot(nx, ny, nz) || 1;
        nx /= l; ny /= l; nz /= l;
      } else gx = NaN;
    } else gx = NaN;
    if (gx !== gx && role !== 1) {
      gx = 0;
      for (let k = 0; k < KN; k++) {
        const x = ix + KX[k], y = iy + KY[k], z = iz + KZ[k];
        if (x < 0 || y < 0 || z < 0 || x >= NX || y >= NY || z >= NZ) continue;
        const w = data[x + y * NX + z * NXY];
        if (w && pal.alpha[w] >= 1) { gx -= KX[k] * KW[k]; gy -= KY[k] * KW[k]; gz -= KZ[k] * KW[k]; }
      }
      const gl = Math.hypot(gx, gy, gz);
      if (gl > 0.4) {
        const wf = role === 2 ? 0.25 : role === 4 ? 0.6 : 0.42;
        nx = nx * wf + (gx / gl) * (1 - wf); ny = ny * wf + (gy / gl) * (1 - wf); nz = nz * wf + (gz / gl) * (1 - wf);
        const l = Math.hypot(nx, ny, nz) || 1;
        nx /= l; ny /= l; nz /= l;
        gx /= gl; gy /= gl; gz /= gl;
      } else { gx = nx; gy = ny; gz = nz; }
    } else if (gx !== gx || role === 1) { gx = nx; gy = ny; gz = nz; }
    const { R0, R1, R2 } = cam;
    const cx = R0[0] * nx + R0[1] * ny + R0[2] * nz;
    const cy = R1[0] * nx + R1[1] * ny + R1[2] * nz;
    const cz = R2[0] * nx + R2[1] * ny + R2[2] * nz;
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
    let tone;
    if (role === 1) {
      // thin membrane: lit through from both sides
      const d = Math.abs(lam);
      tone = (0.34 + 0.4 * d + 0.18 * (0.5 + 0.5 * cy)) * (0.75 + 0.25 * ao);
      tone = (tone - 0.6) * 2.1;
    } else {
      const diff = clamp01((lam + 0.22) / 1.22);
      const sky = 0.5 + 0.5 * cy;
      let lit = 0.2 + 0.52 * diff + 0.2 * sky;
      lit *= 0.52 + 0.48 * ao;
      tone = (lit - 0.6) * 2.1;
      if (tone > 0) tone *= 0.72;
      // glints on the smooth surface, rim light from the water above
      const scx = R0[0] * gx + R0[1] * gy + R0[2] * gz, scy = R1[0] * gx + R1[1] * gy + R1[2] * gz, scz = R2[0] * gx + R2[1] * gy + R2[2] * gz;
      const hd = scx * HALF[0] + scy * HALF[1] + scz * HALF[2];
      const specK = role === 2 ? 1.6 : role === 0 ? 0.75 : 0.4;
      if (hd > 0.8) tone += Math.pow((hd - 0.8) / 0.2, 3) * specK;
      const rim = Math.pow(1 - clamp01(scz), 2.6) * clamp01(scy * 1.4 + 0.25);
      tone += rim * 0.3;
    }
    tone += (hash3(ix, iy, iz) - 0.5) * 0.045;
    const em = pal.em[v];
    if (em) tone = Math.max(tone, 0.3) * 0.5 + 0.32;
    const ti = clamp(Math.round(tone * 10), -10, 10) + 10;
    const col = rampOf(pal, v)[ti];
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
        out[p] = darkPacked(c, 0.62);
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
  return ((c & 0xff000000) | (Math.round(b * k + 10 * (1 - k)) << 16) | (Math.round(g * k * 0.96) << 8) | Math.round(r * k * 0.92)) >>> 0;
}
function outlinePacked(n) {
  const r = n & 255, g = (n >>> 8) & 255, b = (n >>> 16) & 255;
  return (0xff000000 | (Math.round(b * 0.26 + 22) << 16) | (Math.round(g * 0.2 + 8) << 8) | Math.round(r * 0.22 + 10)) >>> 0;
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
  if (alpha < 1) ctx.globalAlpha = alpha;
  const a = drawFishRig(ctx, f.c, {
    x: f.x, y: f.y, bob: f.bob || 0, facing: f.facing ?? 1, turn: f.turn ?? f.facing ?? 1, angle: f.angle || 0, scale: S,
    squash: f.squash || 0, swimPhase: f.swimPhase ?? f.tailPhase ?? 0, tailPhase: f.tailPhase ?? 0, finPhase: f.finPhase ?? 0,
    speed01: f.speed01 ?? 0.4, inflate: f.quirks?.has?.('inflate') ? f.inflate || 0 : 0,
    lookX: f.lookX ?? null, lookY: f.lookY ?? null, blink: f.blink || 0, emotion: f.emotion || 'neutral', mouth: f.mouth || 0,
    time: f.age ?? 0, glow: opts.glow ?? 0, heading, chain: f.chain, style: 'voxel', voxAlpha: alpha,
  });
  ctx.globalAlpha = 1;
  return a;
}
