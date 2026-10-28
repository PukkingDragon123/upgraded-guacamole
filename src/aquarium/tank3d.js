// The aquarium as a 3D glass box seen in one-point perspective.
//
// Tank space: X in [0, W] and Y in [0, H] are front-glass pixels (Y down); depth z in [0, 1]
// (0 = front glass, 1 = back glass), D = z * DEPTH in front-plane pixels for physics.
// Projection: s(z) = 1 - K z (K = 0.5, the same scale the fish rig uses for depth), screen
// x = vpx + (X - vpx) s, y = vpy + (Y - vpy) s, all relative to the inner (glass) rect.
//
// TankSpace also owns the voxel sand heightfield (cells of `cell` px, heights in `step` px) and
// renders the static backdrop: back wall painting, receding side walls, the underside of the water
// surface and the ray-marched voxel floor, with depth fog baked in per pixel.

import { makeCanvas, ctxOf } from '../core/canvas.js';
import { PixelBuffer, selOut } from '../gfx/pixel.js';
import { pack, mix, rgba, shade } from '../core/color.js';
import { bayer, hash2, fbm1, fbm2, clamp, clamp01, smoothstep, lerp, TAU } from '../core/math.js';
import { ramp7 } from '../gfx/voxel.js';
import { UI_COLORS } from '../ui/panels.js';

export const K = 0.5;
export const FOG_SLABS = [0.8, 0.6, 0.4, 0.2];
export const fogAmt = (z) => 1 - Math.pow(0.885, z * 5);

// Water: deep -> light.
export const WATER = ['#0b1f36', '#0f2c46', '#123955', '#154764', '#185572', '#1c6480', '#22748e', '#29869a', '#3398a6', '#40aab0', '#52bcb8', '#6ccec2', '#92e0cc'];
const WATER_P = WATER.map((h) => pack(h));
export const FOG_COLOR = WATER[6];
const SAND = ramp7('#df8a48', 1.05);
const MOSS = ramp7('#4a9a3c', 1.1);
const MOSS2 = ramp7('#78b840', 1.05);
const PEBBLES = ['#9c98a6', '#e6e0d4', '#d88a8a', '#5c5266', '#b8a27a', '#8fb0b8'].map((c) => ramp7(c, 0.9));
const SHELL = ramp7('#f2d8cc', 0.8);
const SOIL = ramp7('#6a3a26', 1);

const MAT_SAND = 0, MAT_MOSS = 1, MAT_PEBBLE = 2, MAT_SHELL = 3, MAT_MOSS2 = 4;

export class TankSpace {
  // opts: {vpy (fraction of H), surf, floorFront, slope, cell, step, seed}
  constructor(W, H, opts) {
    this.W = W; this.H = H;
    this.vpx = W / 2;
    this.vpy = Math.round(H * opts.vpy);
    this.surf = opts.surf;
    this.floorFront = opts.floorFront;
    this.slope = opts.slope;
    this.DEPTH = Math.round(W * 0.5);
    this.cs = opts.cell;
    this.qs = opts.step;
    this.seed = opts.seed ?? 7;
    this.NX = Math.ceil(W / this.cs) + 1;
    this.NZ = Math.max(8, Math.round(this.DEPTH / this.cs));
    this.buildTerrain();
  }

  s(z) { return 1 - K * z; }
  sx(X, z) { return this.vpx + (X - this.vpx) * (1 - K * z); }
  sy(Y, z) { return this.vpy + (Y - this.vpy) * (1 - K * z); }
  X(sx, z) { return this.vpx + (sx - this.vpx) / (1 - K * z); }
  Y(sy, z) { return this.vpy + (sy - this.vpy) / (1 - K * z); }

  // Smooth sand height above floorFront (px, positive up) before voxel quantisation.
  hSmooth(X, z) {
    const W = this.W, sd = this.seed;
    let h = this.slope * Math.pow(z, 0.85);
    h += (fbm2(X * 0.011, z * 2.4, 3, sd) - 0.5) * this.slope * 0.55 * (0.25 + 0.75 * smoothstep(0.12, 0.6, z));
    // a shallow bowl toward the front centre: loose coins roll together there and heap up
    h += this.slope * 0.4 * Math.pow(Math.abs(X / W - 0.5) * 2, 1.6) * (1 - smoothstep(0.2, 0.75, z));
    const edge = smoothstep(0.28, 0, X / W) + smoothstep(0.72, 1, X / W);
    h += edge * smoothstep(0.35, 1, z) * this.slope * 0.75;
    return Math.max(0, h * (0.35 + 0.65 * smoothstep(0, 0.12, z)));
  }

  buildTerrain() {
    const { NX, NZ, cs, qs, seed } = this;
    const N = NX * NZ;
    this.hq = new Int16Array(N);
    this.mat = new Uint8Array(N);
    this.var = new Uint8Array(N);
    this.gx = new Float32Array(N);
    this.gz = new Float32Array(N);
    for (let k = 0; k < NZ; k++) {
      const z = (k + 0.5) / NZ;
      for (let i = 0; i < NX; i++) {
        const X = (i + 0.5) * cs;
        const idx = k * NX + i;
        const h = this.hSmooth(X, z);
        let q = Math.round(h / qs);
        const m = fbm2(i * 0.11 + 3, k * 0.22, 2, seed + 5);
        const r = hash2(i, k, seed + 9);
        let mat = MAT_SAND;
        if (m > 0.69 && z > 0.12) { mat = r > 0.5 ? MAT_MOSS : MAT_MOSS2; q += r > 0.8 ? 2 : 1; }
        else if (r > 0.968) { mat = MAT_PEBBLE; q += r > 0.99 ? 2 : 1; this.var[idx] = Math.floor(hash2(i, k, seed + 11) * PEBBLES.length); }
        else if (r < 0.006) { mat = MAT_SHELL; q += 1; }
        else this.var[idx] = Math.floor(hash2(i >> 1, k, seed + 13) * 4);
        this.hq[idx] = q;
        this.mat[idx] = mat;
        // smooth gradient (dY/dX, dY/dD) for rolling coins
        const e = cs;
        this.gx[idx] = -(this.hSmooth(X + e, z) - this.hSmooth(X - e, z)) / (2 * e);
        this.gz[idx] = -(this.hSmooth(X, z + e / this.DEPTH) - this.hSmooth(X, Math.max(0, z - e / this.DEPTH))) / (2 * e);
        // physics-only nudge toward the front centre so loose coins gather into a heap there
        const near = 1 - smoothstep(0.08, 0.45, z);
        this.gx[idx] += -(X / this.W - 0.5) * 0.06 * near;
        this.gz[idx] -= 0.012 * near;
      }
    }
  }

  cellIdx(X, z) {
    const i = clamp(Math.floor(X / this.cs), 0, this.NX - 1);
    const k = clamp(Math.floor(z * this.NZ), 0, this.NZ - 1);
    return k * this.NX + i;
  }

  // Top of the sand (front-plane Y) at X, depth z.
  groundZ(X, z) { return this.floorFront - this.hq[this.cellIdx(X, z)] * this.qs; }
  ground(X, D) { return this.groundZ(X, D / this.DEPTH); }
  slopeAt(X, D) { const i = this.cellIdx(X, D / this.DEPTH); return [this.gx[i], this.gz[i]]; }
  // Screen-space floor height at screen column sx and depth z (what fish call floorAt).
  floorAt(sx, z = 0) { return this.sy(this.groundZ(this.X(sx, z), z), z); }
  // Screen bounds of the water volume at depth z.
  left(z) { return this.sx(0, z); }
  right(z) { return this.sx(this.W, z); }
  top(z) { return this.sy(this.surf, z); }

  // Screen point on the floor -> {X, z}.
  pickFloor(sx, sy) {
    let lo = 0, hi = 1;
    if (this.floorAt(sx, 0) <= sy) return { X: this.X(sx, 0), z: 0 };
    if (this.floorAt(sx, 1) >= sy) return { X: this.X(sx, 1), z: 1 };
    for (let it = 0; it < 18; it++) {
      const m = (lo + hi) / 2;
      if (this.floorAt(sx, m) > sy) lo = m; else hi = m;
    }
    const z = (lo + hi) / 2;
    return { X: this.X(sx, z), z };
  }
}

// ------------------------------------------------------------------ static backdrop

function wpx(t, x, y) {
  const i = clamp(Math.floor(t * 12.4 + (bayer(x, y) - 0.5) * 0.9), 0, 12);
  return WATER_P[i];
}

function mixP(hexA, hexB, t) { return pack(mix(hexA, hexB, clamp01(t))); }

const mixCache = new Map();
function fogged(hex, f) {
  const q = Math.round(f * 24);
  const key = hex + q;
  let v = mixCache.get(key);
  if (v === undefined) { v = mixP(hex, FOG_COLOR, q / 24); mixCache.set(key, v); }
  return v;
}

// Returns {canvas, mask (floor+ceiling light mask), floorTop: Int16Array per column, backRect}.
export function renderBackdrop(T, opts = {}) {
  const { W, H, vpx, vpy, surf } = T;
  const buf = new PixelBuffer(W, H);
  const mask = new PixelBuffer(W, H);
  const floorTop = new Int16Array(W).fill(H);
  const isFloor = new Uint8Array(W * H);
  const sd = T.seed;
  const sc = H / 520;
  const floorBack = T.floorFront - T.slope * 0.9;

  // ---- floor: per-column voxel ray march, front to back
  const dz = 1 / Math.max(240, Math.round((T.floorFront - vpy) * K * 3));
  for (let x = 0; x < W; x++) {
    let ybuf = H;
    // cross-section through the front glass
    const X0 = x + 0.5;
    const top0 = T.groundZ(X0, 0);
    const y0 = Math.max(0, Math.ceil(top0));
    const grain = Math.max(1, Math.round(T.cs / 2));
    for (let y = y0; y < H; y++) {
      const d = y - top0;
      let c;
      const gx = Math.floor(x / grain), gy = Math.floor(y / grain);
      const j = hash2(gx, gy, sd + 31);
      if (d < 1.2) c = SAND[6];
      else if (d < 9 * sc + 3) c = SAND[j > 0.75 ? 4 : j > 0.3 ? 3 : 2];
      else if (d < 22 * sc + 6) {
        // gravel band: rounded pebbles
        // irregular rounded pebbles: nearest jittered seed in a small cell grid
        const cw = 4 * sc + 2, ch = 3 * sc + 2;
        const cx0 = Math.floor(x / cw), cy0 = Math.floor(y / ch);
        let best = 9, bx = 0, by = 0, bi = 0;
        for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
          const qx = cx0 + ox, qy = cy0 + oy;
          const px = (qx + 0.2 + hash2(qx, qy, sd + 3) * 0.6) * cw, py = (qy + 0.2 + hash2(qx, qy, sd + 4) * 0.6) * ch;
          const rr = (0.75 + hash2(qx, qy, sd + 5) * 0.6) * cw * 0.55;
          const dd = Math.hypot(x + 0.5 - px, (y + 0.5 - py) * 1.25) / rr;
          if (dd < best) { best = dd; bx = (x + 0.5 - px) / rr; by = (y + 0.5 - py) / rr; bi = qx * 7 + qy * 13; }
        }
        const pr = PEBBLES[Math.floor(hash2(bi, 1, sd + 6) * PEBBLES.length)];
        c = best > 1 ? SOIL[best > 1.25 ? 0 : 1] : pr[bx + by < -0.5 ? 5 : bx + by > 0.6 ? 2 : 3];
      } else c = SOIL[j > 0.8 ? 2 : j > 0.4 ? 1 : 0];
      // looking through glass: a faint teal cast and darkening toward the bottom
      buf.set(x, y, mixP(c, '#1f6a80', 0.1 + clamp01((d - 6) / 60) * 0.25));
      isFloor[y * W + x] = 1;
    }
    ybuf = y0;
    let prevCell = -1, prevTop = top0;
    let edge = false;
    for (let z = 0; z <= 1; z += dz) {
      const s = 1 - K * z;
      const X = vpx + (x + 0.5 - vpx) / s;
      if (X < 0 || X >= W) break;
      const ci = T.cellIdx(X, z);
      const topY = T.floorFront - T.hq[ci] * T.qs;
      const ys = vpy + (topY - vpy) * s;
      const yi = Math.max(0, Math.ceil(ys));
      let face = 'top';
      if (ci !== prevCell) {
        if (prevCell >= 0 && topY < prevTop - 0.01) face = (Math.floor(ci / T.NX) !== Math.floor(prevCell / T.NX)) ? 'front' : 'side';
      }
      if (yi < ybuf) {
        const mat = T.mat[ci], v = T.var[ci];
        let R;
        if (mat === MAT_MOSS) R = MOSS; else if (mat === MAT_MOSS2) R = MOSS2;
        else if (mat === MAT_PEBBLE) R = PEBBLES[v]; else if (mat === MAT_SHELL) R = SHELL; else R = SAND;
        const f = fogAmt(z) * 0.9;
        const nearWall = Math.min(X / W, 1 - X / W);
        const ao = smoothstep(0.06, 0, nearWall) * 0.8 + smoothstep(0.9, 1, z) * 0.6;
        for (let y = yi; y < ybuf; y++) {
          let tone;
          if (face === 'front') tone = 3.3 - (y - yi) * 0.12;
          else if (face === 'side') tone = X > vpx ? 3.4 : 2.6;
          else {
            tone = 4.1 + (mat === MAT_SAND ? (v - 1.5) * 0.18 : 0);
            if (edge && y === ybuf - 1) tone += 0.5; // lit voxel edge above a riser
          }
          tone -= ao;
          const ti = clamp(Math.round(tone + (bayer(x, y) - 0.5) * 0.7), 0, 6);
          buf.set(x, y, fogged(R[ti], f));
          isFloor[y * W + x] = 1;
          if (face === 'top') mask.set(x, y, pack('#ffffff', Math.round(200 * (1 - z * 0.65))));
        }
        edge = face !== 'top' ? true : false;
        ybuf = yi;
      }
      prevCell = ci; prevTop = topY;
    }
    floorTop[x] = ybuf;
  }

  // ---- back wall painting, side walls, ceiling
  const bl = T.sx(0, 1), br = T.sx(W, 1), bt = T.sy(surf, 1);
  const rockA = (Xb) => floorBack - (34 + 62 * fbm1(Xb * 0.006 + 2, 3, sd)) * sc - 18 * sc * Math.max(0, Math.sin(Xb * 0.012 + 1));
  const rockB = (Xb) => floorBack - (12 + 40 * fbm1(Xb * 0.011 + 9, 3, sd + 4)) * sc;
  const kelp = (Xb, Yb) => {
    for (let k = 0; k < 9; k++) {
      const kx = (hash2(k, 1, sd) * 0.9 + 0.05) * W;
      const kh = (90 + hash2(k, 2, sd) * 140) * sc;
      if (Yb < floorBack - kh) continue;
      const off = Math.sin((Yb / sc) * 0.05 + k) * 5 * sc;
      if (Math.abs(Xb - kx - off) < 2.2 * sc + 0.6) return 1;
    }
    return 0;
  };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (isFloor[y * W + x]) continue;
      // which inner face does the ray from (x, y) reach first?
      let z = 1, face = 'back';
      if (x < bl) { const s = (vpx - x) / vpx; const zz = (1 - s) / K; if (zz < z) { z = zz; face = 'left'; } }
      if (x > br) { const s = (x - vpx) / (W - vpx); const zz = (1 - s) / K; if (zz < z) { z = zz; face = 'right'; } }
      if (y < bt && y >= surf) { const s = (y - vpy) / (surf - vpy); const zz = (1 - s) / K; if (zz < z) { z = zz; face = 'ceil'; } }
      if (y < surf) { face = 'air'; z = 0; }
      const s = 1 - K * z;
      const Yw = vpy + (y - vpy) / s;
      const Xw = vpx + (x - vpx) / s;
      let t = 0.8 - 0.44 * clamp01((Yw - surf) / (T.floorFront - surf));
      if (face === 'back') {
        const ra = rockA(Xw), rb = rockB(Xw);
        if (Yw > rb) t -= Yw < rb + 2.5 * sc ? 0.02 : 0.15 + hash2(Math.floor(Xw / 9), Math.floor(Yw / 9), sd) * 0.03;
        else if (Yw > ra) t -= Yw < ra + 2.5 * sc ? -0.02 : 0.09;
        else if (kelp(Xw, Yw)) t -= 0.07;
        t += 0.07 * Math.pow(Math.max(0, Math.sin(Xw * 0.017 + 1.3)), 3) * (1 - clamp01((Yw - surf) / (floorBack - surf)));
      } else if (face === 'left' || face === 'right') {
        t -= 0.05 + 0.05 * (1 - z);
        // soft vertical light bands seen through the side glass
        t += 0.035 * Math.max(0, Math.sin(z * 11 + (face === 'left' ? 0 : 2))) * (1 - clamp01((Yw - surf) / (T.floorFront - surf)));
      } else if (face === 'ceil') {
        // the underside of the surface: a little brighter, with sparse broken glints
        t += 0.03 + 0.05 * (1 - z);
        const ph = Xw * 0.045 + Math.sin(z * 14 + Xw * 0.01) * 1.6;
        if (Math.sin(ph) > 0.94 && hash2(Math.floor(Xw / 6), Math.floor(z * 40), sd) > 0.45) t += 0.05;
      } else if (face === 'air') {
        t = 0.95;
      }
      // vignette toward the corners
      const vx = (x - vpx) / vpx, vy = (y - vpy) / H;
      t -= (vx * vx * 0.08 + vy * vy * 0.12);
      t = lerp(t, 0.5, fogAmt(z) * 0.55);
      if (face === 'ceil') mask.set(x, y, pack('#ffffff', Math.round(70 * (1 - z * 0.6))));
      buf.set(x, y, face === 'air' ? pack(mix(WATER[12], '#e8f8f4', 0.3)) : wpx(t, x, y));
    }
  }
  // tank edges: glass seams where walls meet (drawn into the backdrop; the front edges are in the glass overlay)
  const seam = (x0, y0, x1, y1, a) => {
    const n = Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)));
    for (let i = 0; i <= n; i++) {
      const x = Math.round(x0 + (x1 - x0) * i / n), y = Math.round(y0 + (y1 - y0) * i / n);
      if (x < 0 || y < 0 || x >= W || y >= H || isFloor[y * W + x]) continue;
      buf.set(x, y, pack(mix(WATER[10], '#d8fff4', a)));
    }
  };
  seam(bl, bt, br, bt, 0.25);
  seam(bl, bt, bl, T.sy(floorBack, 1), 0.2);
  seam(br, bt, br, T.sy(floorBack, 1), 0.2);
  seam(0, surf, bl, bt, 0.3);
  seam(W - 1, surf, br, bt, 0.3);
  // outline polygons of the lit floor (top faces) and of the surface underside, for clipped caustics
  const floorPoly = [];
  const stepX = Math.max(8, Math.round(W / 60));
  for (let x = 0; x <= W + stepX - 1; x += stepX) {
    const xx = Math.min(W, x);
    let m = H;
    for (let k = Math.max(0, xx - stepX); k < Math.min(W, xx + stepX); k++) m = Math.min(m, floorTop[k]);
    floorPoly.push([xx, m]);
  }
  for (let x = W; x >= 0; x -= stepX) floorPoly.push([x, Math.ceil(T.groundZ(x, 0))]);
  const ceilPoly = [[0, surf], [W, surf], [br, bt], [bl, bt]];
  return { canvas: buf.toCanvas(), mask: mask.toCanvas(), floorTop, floorPoly, ceilPoly, back: { x: bl, y: bt, w: br - bl } };
}

// ------------------------------------------------------------------ light

// Soft volumetric light shaft (white, dithered alpha), drawn scaled with 'lighter'.
let shaftCv = null;
export function shaftSprite() {
  if (shaftCv) return shaftCv;
  const w = 24, h = 160;
  const b = new PixelBuffer(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const u = Math.abs(x + 0.5 - w / 2) / (w / 2);
    const a = Math.pow(1 - u, 1.6) * (1 - Math.pow(y / h, 0.8) * 0.85);
    const q = Math.floor(a * 4 + bayer(x, y) * 0.9);
    if (q > 0) b.set(x, y, pack('#ffffff', [0, 26, 48, 70, 92][Math.min(4, q)]));
  }
  shaftCv = b.toCanvas();
  return shaftCv;
}

// Animated tileable caustic network (additive), N frames of 64 x 32.
let caustics = null;
export function causticFrames() {
  if (caustics) return caustics;
  const N = 16, w = 64, h = 32;
  const pts = [];
  for (let i = 0; i < 9; i++) pts.push({ x: hash2(i, 0, 3) * w, y: hash2(i, 1, 3) * h, r: 3 + hash2(i, 2, 3) * 4, p: hash2(i, 3, 3) * TAU });
  caustics = [];
  for (let f = 0; f < N; f++) {
    const b = new PixelBuffer(w, h);
    const ph = (f / N) * TAU;
    const P = pts.map((p) => ({ x: p.x + Math.cos(ph + p.p) * p.r, y: p.y + Math.sin(ph * 1 + p.p) * p.r * 0.6 }));
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let d1 = 1e9, d2 = 1e9;
      for (const p of P) {
        for (let ox = -w; ox <= w; ox += w) for (let oy = -h; oy <= h; oy += h) {
          const dx = x + 0.5 - p.x - ox, dy = (y + 0.5 - p.y - oy) * 1.6;
          const d = dx * dx + dy * dy;
          if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
        }
      }
      const e = Math.sqrt(d2) - Math.sqrt(d1);
      if (e < 1.1) b.set(x, y, pack('#d8fff0', 150));
      else if (e < 2.1 && bayer(x, y) > 0.4) b.set(x, y, pack('#bff4ff', 70));
    }
    caustics.push(b.toCanvas());
  }
  return caustics;
}

// ------------------------------------------------------------------ glass overlay

// Static front-glass layer: receding box edges, front waterline, air gap, reflections.
export function renderGlass(T, opts = {}) {
  const { W, H, surf } = T;
  const cv = makeCanvas(W, H);
  const g = ctxOf(cv);
  const line = (x0, y0, x1, y1, color, a0, a1 = a0) => {
    const n = Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)));
    for (let i = 0; i <= n; i++) {
      const t = i / Math.max(1, n);
      g.fillStyle = rgba(color, lerp(a0, a1, t));
      g.fillRect(Math.round(x0 + (x1 - x0) * t), Math.round(y0 + (y1 - y0) * t), 1, 1);
    }
  };
  const bl = T.sx(0, 1), br = T.sx(W, 1), bt = T.sy(surf, 1);
  // receding top edges + back rectangle (glass edges catch the light)
  line(0, surf, bl, bt, '#e8fff8', 0.55, 0.25);
  line(W - 1, surf, br, bt, '#e8fff8', 0.55, 0.25);
  line(bl, bt, br, bt, '#e8fff8', 0.3);
  // front waterline: meniscus highlight and a darker underside
  g.fillStyle = rgba('#ffffff', 0.7); g.fillRect(0, surf, W, 1);
  g.fillStyle = rgba('#c8fff4', 0.35); g.fillRect(0, surf + 1, W, 1);
  g.fillStyle = rgba('#0e3a52', 0.18); g.fillRect(0, surf + 2, W, 1);
  // front glass reflections: two soft diagonal streaks in the upper left, one on the right
  const streak = (x0, w, a) => {
    for (let y = 0; y < H; y++) {
      const xs = Math.round(x0 + y * 0.55);
      for (let i = 0; i < w; i++) {
        if ((i + y) % 2 === 0 && i > 0 && i < w - 1) continue;
        g.fillStyle = rgba('#ffffff', a * (1 - y / H) * (i === 0 || i === w - 1 ? 0.5 : 1));
        g.fillRect(xs + i, y, 1, 1);
      }
    }
  };
  streak(W * 0.08, Math.max(3, Math.round(W * 0.018)), 0.07);
  streak(W * 0.08 + W * 0.035, Math.max(2, Math.round(W * 0.008)), 0.06);
  streak(W * 0.78, Math.max(2, Math.round(W * 0.01)), 0.045);
  if (opts.edges) {
    // front glass side edges (green glass thickness) for frameless views
    g.fillStyle = rgba('#7fe0c0', 0.5); g.fillRect(0, 0, 1, H); g.fillRect(W - 1, 0, 1, H);
    g.fillStyle = rgba('#2a8a7a', 0.35); g.fillRect(1, 0, 1, H); g.fillRect(W - 2, 0, 1, H);
  }
  return cv;
}

// ------------------------------------------------------------------ frames (window + mini)

const WOOD = UI_COLORS.woodDark, BR = UI_COLORS.brass;

// Wooden lid with a brass trim, posts with brass corner caps, and a cabinet base.
// Returns {canvas, ix, iy, w, h, lid, base} where (ix, iy) is the glass rect offset.
export function renderFrame(iw, ih, opts = {}) {
  const lid = opts.lid ?? 16, side = opts.side ?? 5, base = opts.base ?? 15;
  const w = iw + side * 2, h = ih + lid + base;
  const b = new PixelBuffer(w, h);
  const P = (c) => pack(c);
  const woodAt = (x, y, tone) => {
    const g = Math.sin(x * 0.09 + Math.sin(y * 0.7) * 1.4 + hash2(Math.floor(x / 37), y, 5) * 3);
    let t = tone + (g > 0.55 ? -1 : g < -0.7 ? 0.5 : 0) + (hash2(x, y, 9) > 0.93 ? -0.6 : 0);
    return P(WOOD[clamp(Math.round(t), 0, 5)]);
  };
  const brass = (t) => P(BR[clamp(Math.round(t), 0, 5)]);
  // lid
  for (let y = 0; y < lid; y++) for (let x = 0; x < w; x++) {
    const r = 3;
    if (y < r) { const dx = Math.min(x, w - 1 - x); if (dx < r && Math.hypot(r - dx - 0.5, r - y - 0.5) > r) continue; }
    let c;
    if (y === 0) c = P(WOOD[1]);
    else if (y === 1) c = P(WOOD[5]);
    else if (y >= lid - 4) {
      const k = y - (lid - 4);
      c = brass([1, 4, 3, 1][k]);
      if (k === 1 && x % 24 === 6) c = P(BR[5]);
    } else c = woodAt(x, y, 3.4 - (y / lid) * 1.2);
    if (x === 0 || x === w - 1) c = P(WOOD[0]);
    b.set(x, y, c);
  }
  // posts
  for (let y = lid; y < lid + ih; y++) for (let s2 = 0; s2 < 2; s2++) for (let i = 0; i < side; i++) {
    const x = s2 ? w - side + i : i;
    const edge = s2 ? i === side - 1 : i === 0;
    const inner = s2 ? i === 0 : i === side - 1;
    let c = woodAt(x, y, 2.6 + (i === 1 ? 0.8 : 0));
    if (edge) c = P(WOOD[0]);
    if (inner) c = P(WOOD[1]);
    b.set(x, y, c);
  }
  // base cabinet
  for (let y = lid + ih; y < h; y++) for (let x = 0; x < w; x++) {
    const k = y - (lid + ih);
    let c;
    if (k < 3) c = brass([4, 2, 1][k]);
    else if (k === base - 1) c = P(WOOD[0]);
    else if (k === base - 2) c = P(WOOD[1]);
    else c = woodAt(x, y, 3 - (k / base) * 1.5);
    if (x === 0 || x === w - 1) c = P(WOOD[0]);
    if (k >= 3 && (x === 1 || x === w - 2)) c = P(WOOD[3]);
    b.set(x, y, c);
  }
  // brass corner caps
  const cap = (cx, cy) => {
    for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) {
      const e = x === 0 || y === 0 || x === 4 || y === 4;
      b.set(cx + x, cy + y, e ? brass(1) : brass(x + y < 4 ? 5 : x + y > 5 ? 2 : 3));
    }
  };
  cap(0, lid - 2); cap(w - 5, lid - 2); cap(0, lid + ih - 2); cap(w - 5, lid + ih - 2);
  b.outline(selOut(0.7));
  return { canvas: b.toCanvas(), ix: side, iy: lid, w, h, lid, base, side };
}

// Round brass button with an icon slot.
const btnCache = new Map();
export function brassButton(size, hover) {
  const key = size + '|' + hover;
  let c = btnCache.get(key);
  if (c) return c;
  const b = new PixelBuffer(size, size);
  const r = size / 2;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = x + 0.5 - r, dy = y + 0.5 - r, d = Math.hypot(dx, dy);
    if (d > r - 0.2) continue;
    let t = 3 - (dx + dy) / r * 1.2 + (hover ? 0.6 : 0);
    if (d > r - 1.3) t = (dx + dy) < 0 ? 4.4 : 1.2;
    b.set(x, y, pack(BR[clamp(Math.round(t + (bayer(x, y) - 0.5) * 0.5), 0, 5)]));
  }
  b.outline(() => pack(BR[0]));
  c = b.toCanvas();
  btnCache.set(key, c);
  return c;
}

export { shade };
