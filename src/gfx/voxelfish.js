// Voxel fish: every species becomes a chunky 3D voxel sculpture built from its 2D look, so fish turn
// smoothly in 3D instead of flipping.
//
// Source model per (look+variant, swim frame, inflate, mouth): each rig layer of fishart.js is
// rasterised at native scale and downsampled (VOX px -> 1 voxel, outline pixels ignored). The body is
// extruded with an elliptical cross-section (laterally compressed per body shape); jellies, puddings,
// octopuses and blobs become solids of revolution; fins are 1-voxel slabs (pectorals hug both flanks);
// painted eyes and mouth are stamped on both sides and protrude. Swim frames sweep the tail sideways
// (in depth); pitch is a model rotation. Frames are rendered with voxel.js (AO, hue-shifted ramps,
// smoothed normals, specular sheen, outline) per yaw step (24 around), swim frame, pitch bucket and
// on-screen scale bucket, cached lazily under a per-frame time budget with nearest-frame fallback.
//
// drawVoxelFish(ctx, fish, {scale, wash, glow, time}) draws a Fish (fish/fish.js) and returns anchors
// {top, mouth, eyes}; beginVoxelFishFrame() resets the budget; voxelFishStats() for profiling.

import { VoxelModel, renderVoxels } from './voxel.js';
import { rigLayers, rigGeom, rasterLayer, paintEye, eyeBox, paintMouth, mouthBox, isKind, chainSegment, chainHeadSprite } from './fishart.js';
import { PixelBuffer } from './pixel.js';
import { ctxOf } from '../core/canvas.js';
import { pack, unpack, shade, mix, rgba } from '../core/color.js';
import { clamp, clamp01, lerp, smoothstep, TAU } from '../core/math.js';

export const VOX = 2;          // look pixels per voxel: chunky
export const YAW_N = 24;
const SWIM_N = 4;
const PITCH_STEP = 16;         // degrees per model pitch bucket (-1..1)
const CAM_PITCH = 11;          // we look slightly down onto the fish
const SCALE_STEP = 1.14;       // geometric on-screen scale buckets
const MAX_FRAMES = 6000;

const SHAPE_K = { oval: 0.5, torpedo: 0.58, round: 0.8, disc: 0.3, long: 0.62, box: 0.72, blunt: 0.6, pointy: 0.46 };
const KIND_K = { crab: 0.72, seahorse: 0.55, ray: 0.16, squid: 0.62, isopod: 0.78, iconfish: 0.42, octopus: 1, jelly: 1, pudding: 1, blob: 1, chain: 0.85 };
const REVOLVE = new Set(['jelly', 'pudding', 'octopus', 'blob']);

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
let budgetMs = 2, spent = 0, windowStart = 0;
let statBuilt = 0, statFallback = 0;
export function setVoxelFishBudget(ms) { budgetMs = ms; }
export function beginVoxelFishFrame() { spent = 0; windowStart = now(); }
export function voxelFishStats() { return { frames: frames.size, sources: sources.size, built: statBuilt, fallbacks: statFallback, spent }; }
function overBudget() {
  const t = now();
  if (t - windowStart > 15) { windowStart = t; spent = 0; }
  return spent >= budgetMs;
}

// ------------------------------------------------------------------ raster -> voxel cells

function pixelsOf(canvas) {
  const d = ctxOf(canvas).getImageData(0, 0, canvas.width, canvas.height).data;
  return new Uint32Array(d.buffer.slice(0));
}

// Downsample a layer raster (placed at ox, oy in grid px) into VOX x VOX cells.
// Returns Map cellIndex -> {col (packed), glow}. Outline pixels (opaque next to transparent) are only
// used when a cell has nothing else (keeps thin fin rays, drops the dark rim of solid bodies).
function cellsOf(r, ox, oy, GW, GH, keepRim) {
  const out = new Map();
  if (!r?.canvas) return out;
  const w = r.canvas.width, h = r.canvas.height;
  const px = pixelsOf(r.canvas);
  const gl = r.glowCanvas ? pixelsOf(r.glowCanvas) : null;
  const A = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : px[y * w + x] >>> 24);
  const acc = new Map();
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = px[y * w + x];
    if ((c >>> 24) < 90) continue;
    const rim = A(x - 1, y) < 90 || A(x + 1, y) < 90 || A(x, y - 1) < 90 || A(x, y + 1) < 90;
    const gx = Math.floor((x + ox) / VOX), gy = Math.floor((y + oy) / VOX);
    if (gx < 0 || gy < 0 || gx >= GW || gy >= GH) continue;
    const k = gy * GW + gx;
    let a = acc.get(k);
    if (!a) acc.set(k, (a = { n: 0, inner: new Map(), rim: new Map(), glow: 0 }));
    a.n++;
    const m = rim ? a.rim : a.inner;
    const cc = (c | 0xff000000) >>> 0;
    m.set(cc, (m.get(cc) || 0) + 1);
    if (gl && gl[y * w + x] >>> 24) a.glow++;
  }
  const need = Math.ceil((VOX * VOX) / 2);
  for (const [k, a] of acc) {
    if (a.n < need && !(keepRim && a.n >= 1 && a.inner.size)) continue;
    let src = a.inner.size ? a.inner : keepRim ? a.rim : null;
    if (!src) continue;
    let best = 0, bn = -1;
    for (const [c, n] of src) if (n > bn) { bn = n; best = c; }
    out.set(k, { col: best, glow: a.glow > 0, rim: !a.inner.size });
  }
  return out;
}

// Palette: near-identical colours share an entry; each entry carries a material role.
class Pal {
  constructor(model) { this.m = model; this.map = new Map(); }
  idx(col, role, glow = false) {
    const [r, g, b] = unpack(col);
    const q = this.map.size > 170 ? 4 : 3;
    const key = (r >> q) + ',' + (g >> q) + ',' + (b >> q) + role + (glow ? 'g' : '');
    let i = this.map.get(key);
    if (i !== undefined) return i;
    if (this.m.palette.length >= 250) {
      // palette full: nearest existing colour
      let bi = 1, bd = Infinity;
      for (let k = 1; k < this.m.palette.length; k++) {
        const [r2, g2, b2] = this.m.palette[k]._rgb;
        const d = (r - r2) ** 2 + (g - g2) ** 2 + (b - b2) ** 2;
        if (d < bd) { bd = d; bi = k; }
      }
      return bi;
    }
    const hex = '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
    const opt = role === 'body' ? { smooth: 0.6, jitter: 0.035, spec: 0.55, specPow: 16, edge: 0.35 }
      : role === 'fin' ? { smooth: 0.1, jitter: 0.02, light: 0.35, edge: 0.3, aoMul: 0.5 }
        : role === 'eye' ? { smooth: 0.4, jitter: 0, spec: 1.3, specPow: 10, aoMul: 0.3 }
          : { smooth: 0.3, jitter: 0.03 };
    if (glow) opt.emissive = 0.75;
    i = this.m.color(hex, opt);
    this.m.palette[i]._rgb = [r, g, b];
    this.map.set(key, i);
    return i;
  }
}

// ------------------------------------------------------------------ source model

// A source is the unrotated voxel sculpture: grid + palette + face anchors (in voxel coords).
function buildSource(c, sw, inflate, mouthOpen) {
  const kind = c.kind || 'fish';
  if (kind === 'chain') return buildChainHead(c);
  const kindLook = isKind(c);
  const ph = sw / SWIM_N;
  const q = { sw: 0, angle: 0, scale: 1, inflate, still: true };
  const geo = rigGeom(c, q);
  const GW = Math.ceil(geo.w / VOX) + 2, GH = Math.ceil(geo.h / VOX) + 2;
  const layers = rigLayers(c);
  const L = {};
  for (const ly of layers) {
    const r = rasterLayer(c, ly.id, { ph: ly.id === 'tail' || (kindLook && ly.id === 'back') ? ph : 0, angle: 0, scale: 1, inflate, still: true });
    const off = geo.offsets?.[ly.id] || [0, 0];
    L[ly.id] = cellsOf(r, r.x + off[0], r.y + off[1], GW, GH, ly.id !== 'body');
  }
  const body = L.body || new Map();
  let k = kindLook ? KIND_K[kind] ?? 0.6 : SHAPE_K[c.look.body?.shape || 'oval'] ?? 0.5;
  if (c.look.body?.thick) k = c.look.body.thick;
  if (inflate > 0) k = lerp(k, 0.96, inflate);
  const revolve = REVOLVE.has(kind);

  // Rounded thickness from a distance transform: t = k * sqrt(d (2 Dm - d)), where d is the distance
  // to the silhouette edge and Dm the ridge depth (min of the row / column maxima), so horizontal fish,
  // vertical seahorses and little hats all get elliptical cross-sections of their own narrow width.
  const D = new Float32Array(GW * GH);
  {
    const edge = [];
    for (let gy = -1; gy <= GH; gy++) for (let gx = -1; gx <= GW; gx++) {
      if (gx >= 0 && gy >= 0 && gx < GW && gy < GH && body.has(gy * GW + gx)) continue;
      const nb = (x, y) => x >= 0 && y >= 0 && x < GW && y < GH && body.has(y * GW + x);
      if (nb(gx + 1, gy) || nb(gx - 1, gy) || nb(gx, gy + 1) || nb(gx, gy - 1)) edge.push(gx, gy);
    }
    for (const key of body.keys()) {
      const gx = key % GW, gy = (key / GW) | 0;
      let best = 1e9;
      for (let i = 0; i < edge.length; i += 2) {
        const dx = edge[i] - gx, dy = edge[i + 1] - gy;
        const d2 = dx * dx + dy * dy;
        if (d2 < best) best = d2;
      }
      D[key] = Math.sqrt(best) - 0.5;
    }
  }
  const colMax = new Float32Array(GW * GH), rowMax = new Float32Array(GW * GH);
  for (let gx = 0; gx < GW; gx++) {
    let a = -1;
    for (let gy = 0; gy <= GH; gy++) {
      const on = gy < GH && body.has(gy * GW + gx);
      if (on && a < 0) a = gy;
      if (!on && a >= 0) { let mx = 0; for (let y = a; y < gy; y++) mx = Math.max(mx, D[y * GW + gx]); for (let y = a; y < gy; y++) colMax[y * GW + gx] = mx; a = -1; }
    }
  }
  for (let gy = 0; gy < GH; gy++) {
    let a = -1;
    for (let gx = 0; gx <= GW; gx++) {
      const on = gx < GW && body.has(gy * GW + gx);
      if (on && a < 0) a = gx;
      if (!on && a >= 0) { let mx = 0; for (let x = a; x < gx; x++) mx = Math.max(mx, D[gy * GW + x]); for (let x = a; x < gx; x++) rowMax[gy * GW + x] = mx; a = -1; }
    }
  }
  const T = new Float32Array(GW * GH).fill(-1);
  let maxW = 1;
  for (const key of body.keys()) {
    const d = Math.max(0, D[key]), dm = Math.max(0.5, Math.min(colMax[key], rowMax[key]));
    const t = k * Math.sqrt(Math.max(0, d * (2 * dm - d))) * 1.05;
    T[key] = t;
    if (t > maxW) maxW = t;
  }
  // main body run per column (pectoral fins attach to it)
  const mainRun = new Int32Array(GW * 2).fill(-1);
  for (let gx = 0; gx < GW; gx++) {
    let best = null, run = null;
    for (let gy = 0; gy <= GH; gy++) {
      const on = gy < GH && body.has(gy * GW + gx);
      if (on && !run) run = [gy, gy];
      else if (on) run[1] = gy;
      else if (run) { if (!best || run[1] - run[0] > best[1] - best[0]) best = run; run = null; }
    }
    if (best) { mainRun[gx * 2] = best[0]; mainRun[gx * 2 + 1] = best[1]; }
  }
  const NZ = Math.ceil(maxW * 2 + 6 + (kindLook ? 4 : GW * 0.2));
  const zc = Math.floor(NZ / 2);
  // nose / tail ends for the swim sweep
  let nose = 0, tailEnd = GW;
  for (const m of [body, L.tail || new Map()]) for (const key of m.keys()) { const gx = key % GW; nose = Math.max(nose, gx); tailEnd = Math.min(tailEnd, gx); }
  const len = Math.max(1, nose - tailEnd);
  const bendA = kindLook ? 0 : len * 0.16 * Math.sin(ph * TAU);
  const bend = (gx) => {
    const u = clamp01((nose - gx) / len);
    return Math.round(bendA * Math.pow(smoothstep(0.32, 1, u), 1.5));
  };

  const m = new VoxelModel(GW, GH, NZ);
  const pal = new Pal(m);
  const vy = (gy) => GH - 1 - gy;
  const surf = (gx, gy) => {
    if (gx < 0 || gy < 0 || gx >= GW || gy >= GH) return -1;
    if (revolve) return revolveT(gx, gy);
    return T[gy * GW + gx];
  };
  // solids of revolution: per row, radius from the run containing the creature's axis
  let axis = 0, rowRun = null;
  if (revolve) {
    let sx = 0, n = 0;
    for (const key of body.keys()) { sx += key % GW; n++; }
    axis = n ? sx / n + 0.5 : GW / 2;
    rowRun = new Float32Array(GH * 2).fill(-1);
    for (let gy = 0; gy < GH; gy++) {
      let a = -1, b = -1;
      for (let gx = Math.floor(axis); gx >= 0 && body.has(gy * GW + gx); gx--) a = gx;
      for (let gx = Math.floor(axis); gx < GW && body.has(gy * GW + gx); gx++) b = gx;
      if (a >= 0 && b >= 0) { rowRun[gy * 2] = a; rowRun[gy * 2 + 1] = b; }
    }
  }
  function revolveT(gx, gy) {
    const a = rowRun[gy * 2], b = rowRun[gy * 2 + 1];
    if (a < 0 || gx < a || gx > b) return -1;
    const mid = (a + b + 1) / 2, r = (b - a + 1) / 2;
    const d = gx + 0.5 - mid;
    return Math.sqrt(Math.max(0, r * r - d * d)) * 0.92;
  }

  // body voxels
  for (const [key, cell] of body) {
    const gx = key % GW, gy = (key / GW) | 0;
    let t = surf(gx, gy);
    const pi = pal.idx(cell.col, 'body', cell.glow);
    const off = bend(gx);
    if (t < 0) t = 0.6;
    const zt = Math.round(t);
    for (let z = -zt; z <= zt; z++) m.set(gx, vy(gy), zc + z + off, pi);
  }
  // fins / limbs
  const finZ = (layer, gx, gy) => {
    if (kindLook) {
      if (layer === 'back') return kind === 'ray' || kind === 'squid' ? [0] : [-Math.max(1, Math.round(maxW * 0.6))];
      if (layer === 'front') return [Math.max(1, Math.round(maxW * 0.6))];
      return [0];
    }
    if (layer === 'front') {
      // pectorals lie against both flanks
      let gyb = clamp(gy, mainRun[gx * 2], mainRun[gx * 2 + 1]);
      if (mainRun[gx * 2] < 0) gyb = gy;
      const t = Math.max(0, surf(gx, gyb));
      const z = Math.round(t) + 1;
      return [z, -z];
    }
    return [0];
  };
  for (const id of ['tail', 'back', 'front']) {
    const cells = L[id];
    if (!cells) continue;
    for (const [key, cell] of cells) {
      const gx = key % GW, gy = (key / GW) | 0;
      if (!kindLook && id !== 'front' && surf(gx, gy) >= 0 && body.has(key)) continue; // inside the body
      const col = cell.rim && !kindLook ? pack(mix(hexOf(cell.col), c.finHex, 0.45)) : cell.col;
      const pi = pal.idx(col, kindLook ? 'body' : 'fin', cell.glow);
      const off = bend(gx);
      for (const z of finZ(id, gx, gy)) {
        m.set(gx, vy(gy), zc + z + off, pi);
        if (kindLook && id !== 'tail') m.set(gx, vy(gy), zc + z + off + Math.sign(z || 1), pi);
      }
    }
  }
  // face: painted eyes and mouth stamped onto both flanks, protruding one voxel
  const eyes3 = [];
  const stamp = (buf, cx, cy, role, protrude) => {
    const w = buf.w, h = buf.h;
    const cells = new Map();
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const p = buf.data[y * w + x];
      if ((p >>> 24) < 90) continue;
      const gx = Math.floor((x + cx) / VOX), gy = Math.floor((y + cy) / VOX);
      if (gx < 0 || gy < 0 || gx >= GW || gy >= GH) continue;
      const kk = gy * GW + gx;
      let a = cells.get(kk);
      if (!a) cells.set(kk, (a = new Map()));
      const cc = (p | 0xff000000) >>> 0;
      a.set(cc, (a.get(cc) || 0) + 1);
    }
    // darkest-wins for pupils/mouth lines so tiny eyes stay readable
    for (const [kk, a] of cells) {
      let best = 0, score = -1;
      for (const [cc, n] of a) {
        const [r, g, b] = unpack(cc);
        const lum = (r * 0.3 + g * 0.59 + b * 0.11) / 255;
        const sc = n + (role === 'eye' ? (lum < 0.25 ? 2.2 : lum > 0.85 ? 0.8 : 0) : lum < 0.3 ? 1.5 : 0);
        if (sc > score) { score = sc; best = cc; }
      }
      const gx = kk % GW, gy = (kk / GW) | 0;
      const t = surf(gx, gy);
      const zt = t >= 0 ? Math.round(t) + protrude : 1;
      const pi = pal.idx(best, role);
      const off = bend(gx);
      m.set(gx, vy(gy), zc + zt + off, pi);
      m.set(gx, vy(gy), zc - zt + off, pi);
    }
  };
  const fstate = { emotion: 'neutral', blink: 0, lx: 0.25, ly: 0, gx: 0.15, gy: 0.5, time: 0, pupil: 1, dim: 0 };
  for (const ev of geo.eyes || []) {
    const R = Math.max(1, ev.r);
    const hb = eyeBox(R);
    const buf = new PixelBuffer(hb * 2, hb * 2);
    paintEye(buf, null, hb, hb, c, ev.e, { ...fstate, mirror: ev.mirror, cheek: false, main: ev.main }, 0, R);
    stamp(buf, ev.x - hb, ev.y - hb, 'eye', R >= 2.5 ? 1 : 0);
    const gx = Math.floor(ev.x / VOX), gy = Math.floor(ev.y / VOX);
    const t = surf(gx, gy);
    eyes3.push({ x: ev.x / VOX, y: GH - ev.y / VOX, z: (t >= 0 ? t + 1 : 1), r: R / VOX, zc });
  }
  if (geo.mouth && geo.mouth.m && geo.mouth.m.type !== 'none') {
    const mo = geo.mouth;
    const hb = mouthBox(mo.w);
    const buf = new PixelBuffer(hb * 2, hb * 2);
    paintMouth(buf, hb, hb, c, mo.m, { emotion: 'neutral', open: mouthOpen ? 1 : 0, time: 0 }, mo.angle || 0, mo.w, mo.front);
    stamp(buf, mo.x - hb, mo.y - hb, 'mouth', 0);
  }
  const anc = geo.anchors || {};
  return {
    m, zc, GW, GH, NZ,
    center: [geo.ox / VOX, GH - geo.oy / VOX, zc + 0.5],
    eyes: eyes3,
    mouth: anc.mouth ? [anc.mouth[0] / VOX, GH - anc.mouth[1] / VOX, zc + 0.5] : null,
    top: anc.top ? [anc.top[0] / VOX, GH - anc.top[1] / VOX, zc + 0.5] : null,
    lid: shade(c.bodyHex || '#888888', -0.15),
  };
}

function hexOf(cc) {
  const [r, g, b] = unpack(cc);
  return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
}

// Chain creatures: the head is an extruded voxel head; segments are voxel spheres (see chainFrame).
function buildChainHead(c) {
  const h = chainHeadSprite(c, 0, 1, 0);
  const cv = h.canvas || h.c || h;
  const w = cv.width, hgt = cv.height;
  const GW = Math.ceil(w / VOX) + 2, GH = Math.ceil(hgt / VOX) + 2;
  const cells = cellsOf({ canvas: cv }, 0, 0, GW, GH, false);
  const NZ = GH + 4, zc = Math.floor(NZ / 2);
  const m = new VoxelModel(GW, GH, NZ);
  const pal = new Pal(m);
  const cols = new Map();
  for (const key of cells.keys()) { const gx = key % GW, gy = (key / GW) | 0; const r = cols.get(gx) || [gy, gy]; r[0] = Math.min(r[0], gy); r[1] = Math.max(r[1], gy); cols.set(gx, r); }
  for (const [key, cell] of cells) {
    const gx = key % GW, gy = (key / GW) | 0;
    const [a, b] = cols.get(gx);
    const hh = (b - a + 1) / 2, e = (gy + 0.5 - (a + b + 1) / 2) / hh;
    const zt = Math.round(hh * 0.85 * Math.sqrt(Math.max(0, 1 - e * e)));
    const pi = pal.idx(cell.col, 'body', cell.glow);
    for (let z = -zt; z <= zt; z++) m.set(gx, GH - 1 - gy, zc + z, pi);
  }
  const ox = (h.o ?? h.ox ?? w / 2), oy = (h.o ?? h.oy ?? hgt / 2);
  return { m, zc, GW, GH, NZ, center: [ox / VOX, GH - oy / VOX, zc + 0.5], eyes: [], mouth: null, top: null, lid: shade(c.bodyHex, -0.15) };
}

// Rotate a source model about z (pitch, degrees; positive = nose down) by inverse nearest sampling.
function pitched(src, deg) {
  if (!deg) return src.m;
  const a = (-deg * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a);
  const { GW, GH, NZ } = src;
  const cx = src.center[0], cy = src.center[1];
  const R = Math.ceil(Math.hypot(GW, GH) / 2) + 2;
  const nx = R * 2, ny = R * 2;
  const out = new VoxelModel(nx, ny, NZ);
  out.palette = src.m.palette;
  const sm = src.m;
  for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    const dx = x + 0.5 - R, dy = y + 0.5 - R;
    const sx = Math.floor(cx + dx * ca + dy * sa), sy = Math.floor(cy - dx * sa + dy * ca);
    if (sx < 0 || sy < 0 || sx >= GW || sy >= GH) continue;
    for (let z = 0; z < NZ; z++) {
      const v = sm.data[sx + GW * (sy + GH * z)];
      if (v) out.data[x + nx * (y + ny * z)] = v;
    }
  }
  out._shift = [R - cx, R - cy];
  return out;
}

// ------------------------------------------------------------------ frame cache

const sources = new Map();
const frames = new Map();
const families = new Map();

function sourceFor(c, sw, infl, mouth) {
  const key = c.id + '|' + sw + '|' + infl + '|' + mouth;
  let s = sources.get(key);
  if (!s) { s = buildSource(c, sw, infl, mouth); s.pitched = new Map(); sources.set(key, s); }
  return s;
}

function render(c, sw, infl, mouth, pitch, yawI, sb) {
  const src = sourceFor(c, sw, infl, mouth);
  let pm = src.pitched.get(pitch);
  if (!pm) { pm = pitched(src, pitch * PITCH_STEP); src.pitched.set(pitch, pm); }
  const shift = pm._shift || [0, 0];
  const scale = Math.pow(SCALE_STEP, sb) * VOX;
  const yaw = (yawI / YAW_N) * 360;
  const r = renderVoxels(pm, { scale, yaw, pitch: CAM_PITCH, groundAO: false, ao: 0.9, edges: 0.55, sideEdges: 0.35, depthThreshold: 3 });
  const P = (p) => r.project(p[0] + shift[0], p[1] + shift[1], p[2]);
  const [ax, ay] = P(src.center);
  // visible eye: the flank facing the camera
  const cy = Math.cos((yaw * Math.PI) / 180);
  const eyes = [];
  for (const e of src.eyes) {
    if (Math.abs(cy) < 0.25) continue;
    const z = cy > 0 ? e.zc + e.z + 0.5 : e.zc - e.z + 0.5;
    const [ex, ey] = P([e.x, e.y, z]);
    eyes.push({ x: ex - ax, y: ey - ay, r: Math.max(1, e.r * scale) });
  }
  const mouthP = src.mouth ? P(src.mouth) : null;
  const topP = src.top ? P(src.top) : null;
  return {
    canvas: r.canvas, glow: r.glow, ax, ay, w: r.w, h: r.h, eyes, lid: src.lid,
    mouth: mouthP ? [mouthP[0] - ax, mouthP[1] - ay] : null, top: topP ? [topP[0] - ax, topP[1] - ay] : [0, -r.h / 2],
  };
}

function famKey(c, sw, infl, mouth, pitch, sb) { return c.id + '|' + sw + '|' + infl + '|' + mouth + '|' + pitch + '|' + sb; }

function getFrame(c, sw, infl, mouth, pitch, yawI, sb, force = false) {
  const fk = famKey(c, sw, infl, mouth, pitch, sb);
  const key = fk + '#' + yawI;
  let f = frames.get(key);
  if (f) return { f, sc: 1 };
  if (force || !overBudget()) {
    const t0 = now();
    try { f = render(c, sw, infl, mouth, pitch, yawI, sb); } catch (e) { console.warn('voxelfish', e); f = null; }
    spent += now() - t0;
    statBuilt++;
    if (f) {
      frames.set(key, f);
      let fam = families.get(fk);
      if (!fam) families.set(fk, (fam = new Set()));
      fam.add(yawI);
      if (frames.size > MAX_FRAMES) evict();
      return { f, sc: 1 };
    }
  }
  statFallback++;
  // nearest yaw in this family, then relax swim / mouth / pitch, then neighbouring scales
  const tries = [[sw, infl, mouth, pitch, sb], [0, infl, 0, pitch, sb], [sw, infl, 0, 0, sb], [0, infl, 0, 0, sb], [0, 0, 0, 0, sb]];
  for (let d = 1; d <= 6; d++) { tries.push([0, infl, 0, 0, sb - d], [0, infl, 0, 0, sb + d], [0, 0, 0, 0, sb - d], [0, 0, 0, 0, sb + d]); }
  for (const [s2, i2, m2, p2, b2] of tries) {
    const fam = families.get(famKey(c, s2, i2, m2, p2, b2));
    if (!fam || !fam.size) continue;
    let best = -1, bd = 99;
    for (const y of fam) { const d = Math.min(Math.abs(y - yawI), YAW_N - Math.abs(y - yawI)); if (d < bd) { bd = d; best = y; } }
    const ff = frames.get(famKey(c, s2, i2, m2, p2, b2) + '#' + best);
    if (ff) return { f: ff, sc: Math.pow(SCALE_STEP, sb - b2) };
  }
  // nothing cached at all for this creature: build it anyway (once)
  const t0 = now();
  f = render(c, 0, infl, 0, 0, yawI, sb);
  spent += now() - t0;
  frames.set(famKey(c, 0, infl, 0, 0, sb) + '#' + yawI, f);
  let fam = families.get(famKey(c, 0, infl, 0, 0, sb));
  if (!fam) families.set(famKey(c, 0, infl, 0, 0, sb), (fam = new Set()));
  fam.add(yawI);
  return { f, sc: 1 };
}

function evict() {
  const it = frames.keys();
  for (let i = 0; i < 600; i++) {
    const k = it.next().value;
    if (k === undefined) break;
    frames.delete(k);
    const bar = k.lastIndexOf('#');
    families.get(k.slice(0, bar))?.delete(Number(k.slice(bar + 1)));
  }
}

export function scaleBucket(s) { return Math.round(Math.log(Math.max(0.05, s)) / Math.log(SCALE_STEP)); }

// Pre-build frames for a creature (e.g. while the tank is loading): both facings at one scale.
export function warmVoxelFish(c, scale) {
  const sb = scaleBucket(scale);
  for (const y of [0, YAW_N / 2]) for (let sw = 0; sw < SWIM_N; sw++) getFrame(c, sw, 0, 0, 0, y, sb, true);
}

// ------------------------------------------------------------------ chain creatures

const segCache = new Map();
function chainSeg(c, r) {
  const rq = Math.max(1, Math.round(r * 2) / 2);
  const key = c.id + '|' + rq;
  let s = segCache.get(key);
  if (s) return s;
  const disc = chainSegment(c, rq);
  const cv = disc.canvas;
  const n = Math.ceil(cv.width / VOX) + 2;
  const cells = cellsOf({ canvas: cv }, 0, 0, n, n, false);
  const m = new VoxelModel(n, n, n);
  const pal = new Pal(m);
  const mid = (cv.width / 2) / VOX;
  for (const [key2, cell] of cells) {
    const gx = key2 % n, gy = (key2 / n) | 0;
    const R = Math.max(0.6, rq / VOX);
    const dx = gx + 0.5 - mid, dy = gy + 0.5 - mid;
    const t = Math.round(Math.sqrt(Math.max(0, R * R - dx * dx - dy * dy)));
    const pi = pal.idx(cell.col, 'body', cell.glow);
    for (let z = -t; z <= t; z++) m.set(gx, n - 1 - gy, Math.floor(n / 2) + z, pi);
  }
  const r2 = renderVoxels(m, { scale: VOX, yaw: 20, pitch: CAM_PITCH, groundAO: false, ao: 0.8, edges: 0.4 });
  const [ax, ay] = r2.project(mid, n - mid, Math.floor(n / 2) + 0.5);
  s = { canvas: r2.canvas, ax, ay };
  segCache.set(key, s);
  return s;
}

// ------------------------------------------------------------------ drawing

const LIDS = new Map();
function lidColor(hex) { let v = LIDS.get(hex); if (!v) LIDS.set(hex, (v = rgba(hex, 1))); return v; }

// Draw a Fish as a voxel sculpture. opts: {scale (on-screen, incl. depth), glow 0..1, alpha}.
export function drawVoxelFish(ctx, f, opts = {}) {
  const c = f.c;
  const S = opts.scale ?? f.scale;
  const x = Math.round(f.x), y = Math.round(f.y + (f.bob || 0));
  if (c.kind === 'chain' && f.chain) return drawChain(ctx, f, S, opts);
  // yaw: facing + turn-around through the front, plus heading into / out of the tank
  const turn = clamp(f.turn ?? f.facing, -1, 1);
  let yaw = (Math.acos(turn) * 180) / Math.PI; // 0 = facing right, 90 = toward the viewer, 180 = left
  const vz = f.vz || 0, sp = Math.abs(f.vx || 0) + 6;
  const into = clamp((Math.atan2(vz * 260, sp) * 180) / Math.PI, -55, 55); // moving back -> head turns away
  yaw += (f.facing >= 0 ? -into : into);
  f._vyaw = f._vyaw === undefined ? yaw : f._vyaw + angDelta(f._vyaw, yaw) * 0.25;
  const yawI = ((Math.round((f._vyaw / 360) * YAW_N) % YAW_N) + YAW_N) % YAW_N;
  const isKindC = isKind(c);
  const sw = isKindC && !REVOLVE.has(c.kind) ? 0 : Math.floor(((f.tailPhase ?? f.swimPhase ?? 0) % 1) * SWIM_N) % SWIM_N;
  const pitch = isKindC ? 0 : clamp(Math.round((((f.angle || 0) * 180) / Math.PI) / PITCH_STEP), -1, 1) * (f.facing >= 0 ? 1 : -1);
  const infl = f.quirks?.has('inflate') ? Math.round(clamp01(f.inflate || 0) * 2) / 2 : 0;
  const sb = scaleBucket(S);
  const { f: fr, sc } = getFrame(c, sw, infl, 0, pitch, yawI, sb);
  const sq = clamp(f.squash || 0, -0.5, 0.5);
  const kx = sc * (1 + 0.18 * sq), ky = sc * (1 - 0.16 * sq);
  const alpha = opts.alpha ?? 1;
  if (alpha < 1) ctx.globalAlpha = alpha;
  if (kx === 1 && ky === 1) ctx.drawImage(fr.canvas, x - Math.round(fr.ax), y - Math.round(fr.ay));
  else ctx.drawImage(fr.canvas, Math.round(x - fr.ax * kx), Math.round(y - fr.ay * ky), Math.round(fr.canvas.width * kx), Math.round(fr.canvas.height * ky));
  // expressive face overlays: blinking / sleepy lids and an open mouth
  const lid = f.emotion === 'sleepy' ? 0.55 : f.blink || 0;
  if (lid > 0.3 && fr.eyes.length) {
    ctx.fillStyle = lidColor(fr.lid);
    for (const e of fr.eyes) {
      const r = Math.max(1, Math.round(e.r * kx));
      const hgt = lid > 0.8 ? r * 2 : r;
      ctx.fillRect(Math.round(x + e.x * kx - r), Math.round(y + e.y * ky - r), r * 2, Math.max(1, hgt));
    }
  }
  // open mouth (talking / chomping): a dark gap at the snout
  if ((f.mouth || 0) > 0.45 && fr.mouth && fr.eyes.length) {
    const ms = Math.max(1, Math.round(1.6 * kx * (S / Math.max(0.3, S)) * Math.min(2, S * 1.6)));
    ctx.fillStyle = '#2a0a12';
    ctx.fillRect(Math.round(x + fr.mouth[0] * kx - ms / 2), Math.round(y + fr.mouth[1] * ky - ms / 2), ms, ms);
  }
  if (fr.glow && (opts.glow ?? 0) > 0.02) {
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = Math.min(1, opts.glow) * 0.7 * alpha;
    ctx.drawImage(fr.glow, Math.round(x - fr.ax * kx), Math.round(y - fr.ay * ky), Math.round(fr.glow.width * kx), Math.round(fr.glow.height * ky));
    ctx.globalCompositeOperation = 'source-over';
  }
  ctx.globalAlpha = 1;
  const top = [x + fr.top[0] * kx, y + fr.top[1] * ky];
  return {
    top, mouth: fr.mouth ? [x + fr.mouth[0] * kx, y + fr.mouth[1] * ky] : [x + f.facing * fr.canvas.width * 0.4, y],
    eyes: fr.eyes.map((e) => ({ x: x + e.x * kx, y: y + e.y * ky, r: e.r * kx })),
    w: fr.canvas.width * kx, h: fr.canvas.height * ky,
  };
}

function drawChain(ctx, f, S, opts) {
  const c = f.c, ch = f.chain;
  const n = ch.length;
  const r0 = (c.chain?.r || 4) * S;
  for (let i = n - 1; i >= 1; i--) {
    const t = i / n;
    const r = Math.max(1, r0 * (1 - 0.55 * t * t));
    const s = chainSeg(c, r);
    ctx.drawImage(s.canvas, Math.round(ch[i].x - s.ax), Math.round(ch[i].y - s.ay));
  }
  // head: voxel head model, turned toward the travel direction
  const ang = Math.atan2(ch[0].y - ch[1].y, ch[0].x - ch[1].x);
  const facing = Math.cos(ang) >= 0 ? 1 : -1;
  const yawI = facing > 0 ? 0 : YAW_N / 2;
  const pitch = clamp(Math.round(((facing > 0 ? ang : Math.PI - ang) * 180 / Math.PI) / PITCH_STEP), -2, 2) * facing;
  const { f: fr, sc } = getFrame(c, 0, 0, 0, pitch, yawI, scaleBucket(S));
  ctx.drawImage(fr.canvas, Math.round(ch[0].x - fr.ax * sc), Math.round(ch[0].y - fr.ay * sc), Math.round(fr.canvas.width * sc), Math.round(fr.canvas.height * sc));
  return { top: [ch[0].x, ch[0].y - r0 * 2], mouth: [ch[0].x + facing * r0 * 1.5, ch[0].y], eyes: [], w: fr.canvas.width, h: fr.canvas.height };
}

function angDelta(a, b) {
  let d = (b - a) % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}
