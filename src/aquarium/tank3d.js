// The aquarium interior as a 3D volume seen in one-point perspective.
//
// Tank space: X in [0, W] and Y in [0, H] are front-glass pixels (Y down); depth z in [0, 1]
// (0 = front glass, 1 = back glass), D = z * DEPTH in front-plane pixels for physics.
// Projection: s(z) = 1 - K z, screen x = vpx + (X - vpx) s, y = vpy + (Y - vpy) s, relative to the
// inner (glass) rect. Box tanks use K = 0.5 and look up at the surface; round tanks (jar, bowl) use a
// weak perspective seen from above, so the water surface and the gravel read as ellipses.
//
// Round tanks: `ell` = the glass silhouette ellipse {cx, cy, rx, ry} in screen (tank-local) space. Swimmers
// and Aero drops are kept inside it (shrunk toward the front and back like a sphere) via clampSwim/clampTank.
//
// TankSpace also owns the voxel gravel/sand heightfield (cells of `cell` px, heights in `step` px) and
// renders the static backdrop: water body, receding walls (box) or the curved water volume (round), the
// water surface and the ray-marched voxel floor, with depth fog baked in per pixel.

import { drawGlossOrb } from '../ui/aero.js';
import { makeCanvas, ctxOf } from '../core/canvas.js';
import { PixelBuffer } from '../gfx/pixel.js';
import { pack, mix, rgba } from '../core/color.js';
import { bayer, hash2, fbm1, fbm2, clamp, clamp01, smoothstep, lerp, TAU } from '../core/math.js';
import { ramp7 } from '../gfx/voxel.js';

export const FOG_SLABS = [0.8, 0.6, 0.4, 0.2];
export const fogAmt = (z) => 1 - Math.pow(0.885, z * 5);

// Water ramps: deep -> light (13 steps). Aero = clear bright aqua; reef = sapphire under blue LEDs.
export const WATERS = {
  aero: ['#0d3f7a', '#0f4d8c', '#125d9c', '#166eac', '#1b80ba', '#2192c6', '#28a4d0', '#32b5d9', '#40c5e1', '#53d3e8', '#6ddfee', '#8fe9f4', '#b8f4fa'],
  reef: ['#071a4c', '#0a2462', '#0d2e78', '#11398c', '#16459e', '#1c52b0', '#2361c0', '#2c72ce', '#3884da', '#4898e4', '#5fadec', '#7cc3f3', '#a2d9f9'],
};
export const WATER = WATERS.aero;

// Floor materials: bright sand, moss, Aero glass pebbles (white / aqua / lime / sky / pink), shells.
const SAND = ramp7('#f0c890', 0.95);
const MOSS = ramp7('#4fb43a', 1.05);
const MOSS2 = ramp7('#8ad446', 1);
const PEBBLES = ['#e8f4f8', '#5fd6e8', '#9be05a', '#6aa8f0', '#f6b8d0', '#ffffff', '#3cc0b0', '#c8e86a'].map((c) => ramp7(c, 0.85));
const SHELL = ramp7('#f8e2d8', 0.8);
const SOIL = ramp7('#4a6a8a', 0.9);

const MAT_SAND = 0, MAT_MOSS = 1, MAT_PEBBLE = 2, MAT_SHELL = 3, MAT_MOSS2 = 4;

export class TankSpace {
  // opts: {shape, K, vpy (fraction of H), surf, floorFront, slope, cell, step, seed, edgeRise, bowl, water, ell}
  constructor(W, H, opts) {
    this.W = W; this.H = H;
    this.shape = opts.shape || 'box';
    this.round = this.shape === 'round';
    this.K = opts.K ?? 0.5;
    this.vpx = W / 2;
    this.vpy = Math.round(H * opts.vpy);
    this.surf = opts.surf;
    this.floorFront = opts.floorFront;
    this.slope = opts.slope;
    this.DEPTH = Math.round(W * (this.round ? 0.6 : 0.5));
    this.cs = opts.cell;
    this.qs = opts.step;
    this.seed = opts.seed ?? 7;
    this.edgeRise = opts.edgeRise ?? 0.75;
    this.bowlK = opts.bowl ?? 0.4;
    this.water = WATERS[opts.water] || WATERS.aero;
    this.waterP = this.water.map((h) => pack(h));
    this.fogColor = this.water[6];
    this.ell = opts.ell || null;
    this.NX = Math.ceil(W / this.cs) + 1;
    this.NZ = Math.max(8, Math.round(this.DEPTH / this.cs));
    this.buildTerrain();
  }

  s(z) { return 1 - this.K * z; }
  sx(X, z) { return this.vpx + (X - this.vpx) * (1 - this.K * z); }
  sy(Y, z) { return this.vpy + (Y - this.vpy) * (1 - this.K * z); }
  X(sx, z) { return this.vpx + (sx - this.vpx) / (1 - this.K * z); }
  Y(sy, z) { return this.vpy + (sy - this.vpy) / (1 - this.K * z); }

  // Smooth sand height above floorFront (px, positive up) before voxel quantisation.
  hSmooth(X, z) {
    const W = this.W, sd = this.seed;
    let h = this.slope * Math.pow(z, 0.85);
    h += (fbm2(X * 0.011, z * 2.4, 3, sd) - 0.5) * this.slope * 0.55 * (0.25 + 0.75 * smoothstep(0.12, 0.6, z));
    // a shallow bowl toward the front centre
    h += this.slope * this.bowlK * Math.pow(Math.abs(X / W - 0.5) * 2, 1.6) * (1 - smoothstep(0.2, 0.75, z));
    const edge = smoothstep(0.28, 0, X / W) + smoothstep(0.72, 1, X / W);
    h += edge * smoothstep(0.35, 1, z) * this.slope * this.edgeRise;
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
    const gravel = this.round;
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
        if (gravel) {
          // a jar of glossy glass gravel: mostly pebbles, the odd shell
          mat = r < 0.02 ? MAT_SHELL : MAT_PEBBLE;
          if (r > 0.86) q += 1;
          this.var[idx] = Math.floor(hash2(i, k, seed + 11) * PEBBLES.length);
        } else if (m > 0.69 && z > 0.12) { mat = r > 0.5 ? MAT_MOSS : MAT_MOSS2; q += r > 0.7 ? 2 : 1; }
        else if (r > 0.94 && r < 0.958) { mat = MAT_MOSS2; q += 2; }
        else if (r > 0.95) { mat = MAT_PEBBLE; q += r > 0.99 ? 2 : 1; this.var[idx] = Math.floor(hash2(i, k, seed + 11) * PEBBLES.length); }
        else if (r < 0.006) { mat = MAT_SHELL; q += 1; }
        else this.var[idx] = Math.floor(hash2(i >> 1, k, seed + 13) * 4);
        this.hq[idx] = q;
        this.mat[idx] = mat;
        const e = cs;
        this.gx[idx] = -(this.hSmooth(X + e, z) - this.hSmooth(X - e, z)) / (2 * e);
        this.gz[idx] = -(this.hSmooth(X, z + e / this.DEPTH) - this.hSmooth(X, Math.max(0, z - e / this.DEPTH))) / (2 * e);
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
  left(z) { return this.round ? this.ell.cx - this.ell.rx * this.shrink(z) : this.sx(0, z); }
  right(z) { return this.round ? this.ell.cx + this.ell.rx * this.shrink(z) : this.sx(this.W, z); }
  top(z) { return this.sy(this.surf, z); }

  // Round tanks: the sphere's cross-section factor at depth z (softened so the front and back stay usable).
  shrink(z) { const d = (z - 0.45) / 0.55; return Math.sqrt(Math.max(0.3, 1 - d * d * 0.5)); }

  // Clamp a screen-space point at depth z into the swim volume with margin m (returns [x, y, hitX, hitY]).
  clampSwim(x, y, z, m = 0) {
    let hx = 0, hy = 0;
    const top = this.top(z) + m;
    if (this.round) {
      const e = this.ell, k = this.shrink(z);
      const rx = Math.max(4, e.rx * k - m), ry = Math.max(4, e.ry * k - m);
      const dx = (x - e.cx) / rx, dy = (y - e.cy) / ry;
      const d = Math.hypot(dx, dy);
      if (d > 1) { x = e.cx + (dx / d) * rx; y = e.cy + (dy / d) * ry; hx = Math.sign(dx); hy = Math.sign(dy); }
    } else {
      const L = this.sx(0, z) + m, R = this.sx(this.W, z) - m;
      if (x < L) { x = L; hx = -1; } else if (x > R) { x = R; hx = 1; }
    }
    if (y < top) { y = top; hy = -1; }
    const fl = this.floorAt(x, z) - m * 0.5;
    if (y > fl) { y = fl; hy = 1; }
    return [x, y, hx, hy];
  }

  // Tank-space X range at height Y, depth z (whole width for box tanks).
  span(Y, z, m = 0) {
    if (!this.round) return [m, this.W - m];
    const e = this.ell, k = this.shrink(z);
    const sy = this.sy(Y, z);
    const dy = (sy - e.cy) / (e.ry * k);
    const hw = Math.max(2, e.rx * k * Math.sqrt(Math.max(0, 1 - dy * dy)) - m);
    return [this.X(e.cx - hw, z), this.X(e.cx + hw, z)];
  }

  // Keep a tank-space point (X, Y at depth z) inside the round glass; returns [X, Y] or null if inside.
  clampTank(X, Y, z, m = 0) {
    if (!this.round) return null;
    const e = this.ell, k = this.shrink(z);
    const sx = this.sx(X, z), sy = this.sy(Y, z);
    const rx = Math.max(3, e.rx * k - m), ry = Math.max(3, e.ry * k - m);
    const dx = (sx - e.cx) / rx, dy = (sy - e.cy) / ry;
    const d = Math.hypot(dx, dy);
    if (d <= 1) return null;
    return [this.X(e.cx + (dx / d) * rx, z), this.Y(e.cy + (dy / d) * ry, z)];
  }

  // Screen point inside the visible water (glass shape, below the surface)?
  inWater(x, y) {
    if (this.round) {
      const e = this.ell;
      if (((x - e.cx) / e.rx) ** 2 + ((y - e.cy) / e.ry) ** 2 > 1) return false;
      return y >= this.top(1) - 2;
    }
    return x >= 0 && y >= this.surf && x < this.W && y < this.H;
  }

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

function mixP(hexA, hexB, t) { return pack(mix(hexA, hexB, clamp01(t))); }

const mixCache = new Map();
function fogged(hex, fogHex, f) {
  const q = Math.round(f * 24);
  const key = hex + fogHex + q;
  let v = mixCache.get(key);
  if (v === undefined) { v = mixP(hex, fogHex, q / 24); mixCache.set(key, v); }
  return v;
}

// Returns {canvas, floorTop: Int16Array per column, floorPoly, ceilPoly, surfPoly}.
export function renderBackdrop(T) {
  const { W, H, vpx, vpy, surf } = T;
  const K = T.K;
  const buf = new PixelBuffer(W, H);
  const floorTop = new Int16Array(W).fill(H);
  const isFloor = new Uint8Array(W * H);
  const sd = T.seed;
  const sc = H / 520;
  const floorBack = T.floorFront - T.slope * 0.9;
  const WP = T.waterP, WH = T.water;
  const fogHex = T.fogColor;
  const wpx = (t, x, y) => WP[clamp(Math.floor(t * 12.4 + (bayer(x, y) - 0.5) * 0.9), 0, 12)];
  const cross = T.round ? '#2a7aa8' : '#1f6a80';

  // ---- floor: per-column voxel ray march, front to back
  const dz = 1 / Math.max(240, Math.round(Math.abs(T.floorFront - vpy) * K * 3));
  for (let x = 0; x < W; x++) {
    let ybuf = H;
    const X0 = x + 0.5;
    const top0 = T.groundZ(X0, 0);
    const y0 = Math.max(0, Math.ceil(top0));
    const grain = Math.max(1, Math.round(T.cs / 2));
    for (let y = y0; y < H; y++) {
      // cross-section through the front glass: sand on top of a band of rounded glass pebbles
      const d = y - top0;
      let c;
      const gx = Math.floor(x / grain), gy = Math.floor(y / grain);
      const j = hash2(gx, gy, sd + 31);
      if (d < 1.2) c = T.round ? PEBBLES[0][6] : SAND[6];
      else if (!T.round && d < 9 * sc + 3) c = SAND[j > 0.75 ? 4 : j > 0.3 ? 3 : 2];
      else {
        const cw = (T.round ? 3 : 4) * Math.max(0.6, sc) + 2, ch = (T.round ? 2.4 : 3) * Math.max(0.6, sc) + 2;
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
        c = best > 1 ? SOIL[best > 1.25 ? 1 : 2] : pr[bx + by < -0.5 ? 6 : bx + by > 0.6 ? 2 : bx + by < -0.1 ? 5 : 3];
      }
      buf.set(x, y, mixP(c, cross, 0.08 + clamp01((d - 6) / 60) * 0.22));
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
        const f = fogAmt(z) * (T.round ? 0.5 : 0.9);
        const ci_i = ci % T.NX, ci_k = (ci / T.NX) | 0;
        const hq0 = T.hq[ci];
        const back = ci_k + 1 < T.NZ ? T.hq[ci + T.NX] - hq0 : 0;
        const lft = ci_i > 0 ? T.hq[ci - 1] - hq0 : 0, rgt = ci_i + 1 < T.NX ? T.hq[ci + 1] - hq0 : 0;
        const fz = z * T.NZ - ci_k, fx = X / T.cs - ci_i;
        const vao = (back > 0 ? smoothstep(0.45, 1, fz) * Math.min(1.2, back * 0.6) : 0) + (lft > 0 ? smoothstep(0.4, 0, fx) * 0.7 : 0) + (rgt > 0 ? smoothstep(0.6, 1, fx) * 0.7 : 0);
        const nearWall = Math.min(X / W, 1 - X / W);
        const ao = (T.round ? 0 : smoothstep(0.06, 0, nearWall) * 0.8) + smoothstep(0.9, 1, z) * 0.6;
        // round gravel: every cell is a little rounded pebble (lit top-left, shaded bottom-right)
        const peb = T.round ? (fx - 0.5) * 1.3 + (fz - 0.5) * 1.1 : 0;
        for (let y = yi; y < ybuf; y++) {
          let tone;
          if (face === 'front') tone = 3.3 - (y - yi) * 0.12;
          else if (face === 'side') tone = X > vpx ? 3.4 : 2.6;
          else {
            tone = 4.1 + (mat === MAT_SAND ? (v - 1.5) * 0.18 : 0) - vao - peb;
            if (edge && y === ybuf - 1) tone += 0.6;
          }
          tone -= ao;
          const ti = clamp(Math.round(tone + (bayer(x, y) - 0.5) * 0.7), 0, 6);
          buf.set(x, y, fogged(R[ti], fogHex, f));
          isFloor[y * W + x] = 1;
        }
        edge = face !== 'top';
        ybuf = yi;
      }
      prevCell = ci; prevTop = topY;
    }
    floorTop[x] = ybuf;
  }

  if (T.round) renderRoundWater(T, buf, isFloor, wpx);
  else renderBoxWalls(T, buf, isFloor, wpx, sc, floorBack, sd);

  // outline polygons of the lit floor (top faces) and of the surface underside, for clipped caustics
  const floorPoly = [];
  const stepX = Math.max(8, Math.round(W / 60));
  for (let x = 0; x <= W + stepX - 1; x += stepX) {
    const xx = Math.min(W, x);
    floorPoly.push([xx, floorTop[Math.min(W - 1, xx)] + 1]);
  }
  for (let x = W; x >= 0; x -= stepX) floorPoly.push([x, Math.ceil(T.groundZ(x, 0))]);
  const bl = T.sx(0, 1), br = T.sx(W, 1), bt = T.sy(surf, 1);
  const ceilPoly = T.round ? null : [[0, surf], [W, surf], [br, bt], [bl, bt]];
  void WH;
  return { canvas: buf.toCanvas(), floorTop, floorPoly, ceilPoly };
}

// Box tanks: back wall with soft rock silhouettes, receding side walls, the underside of the surface.
function renderBoxWalls(T, buf, isFloor, wpx, sc, floorBack, sd) {
  const { W, H, vpx, vpy, surf } = T;
  const K = T.K;
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
  const airP = pack(mix(T.water[12], '#f4fcff', 0.45));
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (isFloor[y * W + x]) continue;
      let z = 1, face = 'back';
      if (x < bl) { const s = (vpx - x) / vpx; const zz = (1 - s) / K; if (zz < z) { z = zz; face = 'left'; } }
      if (x > br) { const s = (x - vpx) / (W - vpx); const zz = (1 - s) / K; if (zz < z) { z = zz; face = 'right'; } }
      if (y < bt && y >= surf) { const s = (y - vpy) / (surf - vpy); const zz = (1 - s) / K; if (zz < z) { z = zz; face = 'ceil'; } }
      if (y < surf) { face = 'air'; z = 0; }
      const s = 1 - K * z;
      const Yw = vpy + (y - vpy) / s;
      const Xw = vpx + (x - vpx) / s;
      const depth = clamp01((Yw - surf) / (T.floorFront - surf));
      let t = 0.8 - 0.42 * depth + 0.05 * (1 - clamp01(x / W)) * (1 - depth);
      if (face === 'back') {
        const ra = rockA(Xw), rb = rockB(Xw);
        if (Yw > rb) t -= Yw < rb + 2.5 * sc ? 0.02 : 0.13 + hash2(Math.floor(Xw / 9), Math.floor(Yw / 9), sd) * 0.03;
        else if (Yw > ra) t -= Yw < ra + 2.5 * sc ? -0.02 : 0.08;
        else if (kelp(Xw, Yw)) t -= 0.06;
        // bright sun-spots high on the back glass
        t += 0.08 * Math.pow(Math.max(0, Math.sin(Xw * 0.017 + 1.3)), 3) * (1 - clamp01((Yw - surf) / (floorBack - surf)));
      } else if (face === 'left' || face === 'right') {
        t -= 0.04 + 0.05 * (1 - z);
        t += 0.04 * Math.max(0, Math.sin(z * 11 + (face === 'left' ? 0 : 2))) * (1 - depth);
      } else if (face === 'ceil') {
        t += 0.03 * (1 - z);
        const ph = Xw * 0.045 + Math.sin(z * 14 + Xw * 0.01) * 1.6;
        if (Math.sin(ph) > 0.93 && hash2(Math.floor(Xw / 6), Math.floor(z * 40), sd) > 0.4) t += 0.06;
      }
      const vx = (x - vpx) / vpx, vy = (y - vpy) / H;
      t -= (vx * vx * 0.06 + vy * vy * 0.1);
      t = lerp(t, 0.55, fogAmt(z) * 0.5);
      buf.set(x, y, face === 'air' ? airP : wpx(t, x, y));
    }
  }
  const seam = (x0, y0, x1, y1, a) => {
    const n = Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)));
    for (let i = 0; i <= n; i++) {
      const x = Math.round(x0 + (x1 - x0) * i / n), y = Math.round(y0 + (y1 - y0) * i / n);
      if (x < 0 || y < 0 || x >= W || y >= H || isFloor[y * W + x]) continue;
      buf.set(x, y, pack(mix(T.water[10], '#ffffff', a)));
    }
  };
  seam(bl, bt, br, bt, 0.3);
  seam(bl, bt, bl, T.sy(floorBack, 1), 0.25);
  seam(br, bt, br, T.sy(floorBack, 1), 0.25);
  seam(0, surf, bl, bt, 0.35);
  seam(W - 1, surf, br, bt, 0.35);
}

// Round tanks: a curved water body inside the glass ellipse, the surface seen from above as a bright
// ellipse, transparent air above it (the room shows through the empty top of the jar).
function renderRoundWater(T, buf, isFloor, wpx) {
  const { W, H } = T;
  const e = T.ell;
  const top1 = T.top(1), sf = T.surf;
  const sC = (sf + top1) / 2, sH = Math.max(2, (sf - top1) / 2);
  const dyS = (sf - e.cy) / e.ry;
  const sW = e.rx * Math.sqrt(Math.max(0.05, 1 - dyS * dyS)) - 1;
  const rimP = pack(mix(T.water[12], '#ffffff', 0.6));
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (isFloor[y * W + x]) continue;
      const nx = (x + 0.5 - e.cx) / e.rx, ny = (y + 0.5 - e.cy) / e.ry;
      const r2 = nx * nx + ny * ny;
      if (r2 > 1) continue;
      const ex = (x + 0.5 - e.cx) / sW, ey = (y + 0.5 - sC) / sH;
      const es = ex * ex + ey * ey;
      if (es <= 1) {
        // the surface from above: bright, with a white meniscus ring and soft ripples
        if (es > 0.8) { buf.set(x, y, rimP); continue; }
        const rip = Math.sin(ex * 9 + ey * 3) * 0.03 + Math.sin(ex * 4 - ey * 7) * 0.02;
        const t = 0.9 - (ey + 1) * 0.06 + rip - es * 0.05;
        buf.set(x, y, wpx(t, x, y));
        continue;
      }
      if (y + 0.5 < sC) continue; // air inside the jar
      const depth = clamp01((y - sf) / (T.floorFront - sf));
      // lighter in the middle (light through the glass), darker toward the rim (refraction)
      let t = 0.84 - 0.36 * depth;
      t += 0.06 * (1 - r2) - smoothstep(0.78, 1, r2) * 0.14;
      t += 0.05 * Math.max(0, -nx - ny * 0.6) * (1 - depth);
      buf.set(x, y, wpx(t, x, y));
    }
  }
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
      if (e < 1.1) b.set(x, y, pack('#e8fff8', 160));
      else if (e < 2.1 && bayer(x, y) > 0.4) b.set(x, y, pack('#c8f6ff', 76));
    }
    caustics.push(b.toCanvas());
  }
  return caustics;
}

// ------------------------------------------------------------------ inner glass overlay (box tanks)

// Static inner layer for box tanks: receding box edges catching the light and the front waterline.
export function renderGlass(T) {
  const { W, H, surf } = T;
  const cv = makeCanvas(W, H);
  const g = ctxOf(cv);
  if (T.round) return cv;
  const line = (x0, y0, x1, y1, color, a0, a1 = a0) => {
    const n = Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)));
    for (let i = 0; i <= n; i++) {
      const t = i / Math.max(1, n);
      g.fillStyle = rgba(color, lerp(a0, a1, t));
      g.fillRect(Math.round(x0 + (x1 - x0) * t), Math.round(y0 + (y1 - y0) * t), 1, 1);
    }
  };
  const bl = T.sx(0, 1), br = T.sx(W, 1), bt = T.sy(surf, 1);
  line(0, surf, bl, bt, '#f4ffff', 0.6, 0.3);
  line(W - 1, surf, br, bt, '#f4ffff', 0.6, 0.3);
  line(bl, bt, br, bt, '#f4ffff', 0.35);
  g.fillStyle = rgba('#ffffff', 0.85); g.fillRect(0, surf, W, 1);
  g.fillStyle = rgba('#d8fffa', 0.4); g.fillRect(0, surf + 1, W, 1);
  g.fillStyle = rgba('#0e4a72', 0.16); g.fillRect(0, surf + 2, W, 1);
  void H;
  return cv;
}

// Round glossy Aero button sprite (kept under its old name for aquarium.js callers).
const btnCache = new Map();
export function brassButton(size, hover) {
  const key = size + '|' + hover;
  let c = btnCache.get(key);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = c.height = size;
  drawGlossOrb(c.getContext('2d'), size / 2, size / 2, size / 2 - 0.5, hover ? '#5fe6ff' : '#2fc3e0');
  btnCache.set(key, c);
  return c;
}
