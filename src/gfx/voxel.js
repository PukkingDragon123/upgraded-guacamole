// Tiny voxel modeller + orthographic ray-cast renderer that turns voxel models
// into crisp pixel-art sprites (per-face light, smooth vertex AO, per-voxel jitter,
// palette-ramp quantisation, convex edge highlights, selective outlines, emissive glow).
//
//   const m = new VoxelModel(16, 20, 12);           // x, y (up), z (toward viewer)
//   const stone = m.color('#6a5acd', { jitter: 0.4 });
//   m.box(0, 0, 0, 15, 3, 11, stone);               // inclusive integer ranges
//   m.sub(() => m.sphere(8, 10, 6, 4));             // CSG-style carve
//   const r = renderVoxels(m, { scale: 2.5, yaw: 32, pitch: 27 });
//   ctx.drawImage(r.canvas, x - r.ox, y - r.oy);     // (ox, oy) = footprint centre on the ground
//
// Shape colour arguments may be a palette index or a function (x, y, z, prev) -> index|null.

import { makeCanvas, ctxOf } from '../core/canvas.js';
import { shade, pack, unpack, mix } from '../core/color.js';
import { hash3, clamp } from '../core/math.js';

const DEG = Math.PI / 180;

export class VoxelModel {
  constructor(nx, ny, nz) {
    this.nx = nx | 0;
    this.ny = ny | 0;
    this.nz = nz | 0;
    this.data = new Uint8Array(this.nx * this.ny * this.nz);
    this.palette = [null];
    this.mode = 'add';
  }

  // Register a palette entry: {color, emissive (bool|0..1), jitter, light, ramp: custom 7-step array}.
  color(hex, opts = {}) {
    if (this.palette.length >= 255) throw new Error('voxel palette full');
    this.palette.push({ color: hex, ...opts });
    return this.palette.length - 1;
  }

  inside(x, y, z) {
    return x >= 0 && y >= 0 && z >= 0 && x < this.nx && y < this.ny && z < this.nz;
  }

  get(x, y, z) {
    if (x < 0 || y < 0 || z < 0 || x >= this.nx || y >= this.ny || z >= this.nz) return 0;
    return this.data[x + this.nx * (y + this.ny * z)];
  }

  // Raw write (ignores mode).
  set(x, y, z, c) {
    x = Math.floor(x); y = Math.floor(y); z = Math.floor(z);
    if (x < 0 || y < 0 || z < 0 || x >= this.nx || y >= this.ny || z >= this.nz) return;
    this.data[x + this.nx * (y + this.ny * z)] = c;
  }

  // Mode-aware write used by every shape.
  put(x, y, z, c) {
    if (x < 0 || y < 0 || z < 0 || x >= this.nx || y >= this.ny || z >= this.nz) return;
    const i = x + this.nx * (y + this.ny * z);
    const prev = this.data[i];
    const mode = this.mode;
    if (mode === 'sub') { this.data[i] = 0; return; }
    if (mode === 'paint' && !prev) return;
    if (mode === 'under' && prev) return;
    const v = typeof c === 'function' ? c(x, y, z, prev) : c;
    if (v === null || v === undefined || v === false) return;
    this.data[i] = v;
  }

  withMode(mode, fn) {
    const old = this.mode;
    this.mode = mode;
    try { fn(this); } finally { this.mode = old; }
    return this;
  }

  sub(fn) { return this.withMode('sub', fn); }        // carve
  paint(fn) { return this.withMode('paint', fn); }    // recolour existing voxels only
  under(fn) { return this.withMode('under', fn); }    // fill empty voxels only

  // CSG subtract: remove voxels that are solid in `other` (offset by ox, oy, oz), or run fn in carve mode.
  subtract(other, ox = 0, oy = 0, oz = 0) {
    if (typeof other === 'function') return this.sub(other);
    for (let z = 0; z < other.nz; z++) for (let y = 0; y < other.ny; y++) for (let x = 0; x < other.nx; x++) {
      if (other.get(x, y, z)) this.set(x + ox, y + oy, z + oz, 0);
    }
    return this;
  }

  // Copy another model's voxels in (palette entries are re-registered).
  stamp(other, ox = 0, oy = 0, oz = 0) {
    const map = other.palette.map((p, i) => (i === 0 ? 0 : this.color(p.color, p)));
    for (let z = 0; z < other.nz; z++) for (let y = 0; y < other.ny; y++) for (let x = 0; x < other.nx; x++) {
      const v = other.get(x, y, z);
      if (v) this.put(x + ox, y + oy, z + oz, map[v]);
    }
    return this;
  }

  box(x0, y0, z0, x1, y1, z1, c) {
    if (x0 > x1) [x0, x1] = [x1, x0];
    if (y0 > y1) [y0, y1] = [y1, y0];
    if (z0 > z1) [z0, z1] = [z1, z0];
    x0 = Math.round(x0); y0 = Math.round(y0); z0 = Math.round(z0);
    x1 = Math.round(x1); y1 = Math.round(y1); z1 = Math.round(z1);
    for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) this.put(x, y, z, c);
    return this;
  }

  // Ellipsoid centred at (cx, cy, cz) in voxel-space units (voxel i spans [i, i+1)).
  ellipsoid(cx, cy, cz, rx, ry, rz, c) {
    const x0 = Math.floor(cx - rx), x1 = Math.ceil(cx + rx);
    const y0 = Math.floor(cy - ry), y1 = Math.ceil(cy + ry);
    const z0 = Math.floor(cz - rz), z1 = Math.ceil(cz + rz);
    for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
      const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry, dz = (z + 0.5 - cz) / rz;
      if (dx * dx + dy * dy + dz * dz <= 1) this.put(x, y, z, c);
    }
    return this;
  }

  sphere(cx, cy, cz, r, c) {
    return this.ellipsoid(cx, cy, cz, r, r, r, c);
  }

  // Frustum along `axis` from `from` to `to` (inclusive voxel layers), radius r0 -> r1.
  // (a, b) is the centre in the two remaining axes: y-axis -> (x, z), x-axis -> (y, z), z-axis -> (x, y).
  cone(a, b, from, to, r0, r1, c, axis = 'y') {
    if (from > to) { [from, to] = [to, from]; [r0, r1] = [r1, r0]; }
    const rm = Math.max(r0, r1);
    for (let k = Math.round(from); k <= Math.round(to); k++) {
      const t = to === from ? 0 : (k - from) / (to - from);
      const r = r0 + (r1 - r0) * t;
      const r2 = r * r;
      for (let j = Math.floor(b - rm); j <= Math.ceil(b + rm); j++) {
        for (let i = Math.floor(a - rm); i <= Math.ceil(a + rm); i++) {
          const di = i + 0.5 - a, dj = j + 0.5 - b;
          if (di * di + dj * dj > r2) continue;
          if (axis === 'y') this.put(i, k, j, c);
          else if (axis === 'x') this.put(k, i, j, c);
          else this.put(i, j, k, c);
        }
      }
    }
    return this;
  }

  cylinder(a, b, from, to, r, c, axis = 'y') {
    return this.cone(a, b, from, to, r, r, c, axis);
  }

  // Thick line (capsule) between two points in voxel-space units.
  line(x0, y0, z0, x1, y1, z1, c, r = 0) {
    if (r <= 0.6) {
      const n = Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0)) * 2) + 1;
      let last = -1;
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const x = Math.floor(x0 + (x1 - x0) * t), y = Math.floor(y0 + (y1 - y0) * t), z = Math.floor(z0 + (z1 - z0) * t);
        const k = x + 4096 * (y + 4096 * z);
        if (k !== last) this.put(x, y, z, c);
        last = k;
      }
      return this;
    }
    const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
    const L2 = dx * dx + dy * dy + dz * dz || 1;
    const r2 = r * r;
    for (let y = Math.floor(Math.min(y0, y1) - r); y <= Math.ceil(Math.max(y0, y1) + r); y++) {
      for (let z = Math.floor(Math.min(z0, z1) - r); z <= Math.ceil(Math.max(z0, z1) + r); z++) {
        for (let x = Math.floor(Math.min(x0, x1) - r); x <= Math.ceil(Math.max(x0, x1) + r); x++) {
          const px = x + 0.5 - x0, py = y + 0.5 - y0, pz = z + 0.5 - z0;
          const t = clamp((px * dx + py * dy + pz * dz) / L2, 0, 1);
          const ex = px - dx * t, ey = py - dy * t, ez = pz - dz * t;
          if (ex * ex + ey * ey + ez * ez <= r2) this.put(x, y, z, c);
        }
      }
    }
    return this;
  }

  // Smooth tube through a list of [x, y, z, r] points (Catmull-Rom sampled capsules).
  tube(points, c, steps = 4) {
    const P = points;
    const at = (i) => P[clamp(i, 0, P.length - 1)];
    let prev = null;
    for (let i = 0; i < P.length - 1; i++) {
      const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
      for (let s = 0; s <= steps; s++) {
        const t = s / steps, t2 = t * t, t3 = t2 * t;
        const q = [0, 1, 2, 3].map((k) => 0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3));
        if (prev) this.line(prev[0], prev[1], prev[2], q[0], q[1], q[2], c, Math.max(prev[3], q[3]));
        prev = q;
      }
    }
    return this;
  }

  // Call fn(x, y, z, prev) for every voxel; non-null results are written (respecting mode).
  fill(fn) {
    for (let y = 0; y < this.ny; y++) for (let z = 0; z < this.nz; z++) for (let x = 0; x < this.nx; x++) this.put(x, y, z, (xx, yy, zz, prev) => fn(xx, yy, zz, prev));
    return this;
  }

  // Recolour solid voxels: fn(x, y, z, prev) -> new index | null (keep).
  recolor(fn) {
    const { nx, ny, nz, data } = this;
    for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
      const i = x + nx * (y + ny * z);
      if (!data[i]) continue;
      const v = fn(x, y, z, data[i]);
      if (v !== null && v !== undefined) data[i] = v;
    }
    return this;
  }

  // Mirror one half onto the other along x (keep 'low' or 'high' half).
  mirrorX(keep = 'low') {
    const { nx } = this;
    for (let z = 0; z < this.nz; z++) for (let y = 0; y < this.ny; y++) for (let x = 0; x < nx >> 1; x++) {
      const a = x, b = nx - 1 - x;
      if (keep === 'low') this.set(b, y, z, this.get(a, y, z));
      else this.set(a, y, z, this.get(b, y, z));
    }
    return this;
  }

  // True when a voxel at (x, y, z) has an empty neighbour (useful for surface-only paint).
  exposed(x, y, z) {
    return !this.get(x + 1, y, z) || !this.get(x - 1, y, z) || !this.get(x, y + 1, z) || !this.get(x, y - 1, z) || !this.get(x, y, z + 1) || !this.get(x, y, z - 1);
  }

  bounds() {
    const { nx, ny, nz, data } = this;
    let x0 = nx, y0 = ny, z0 = nz, x1 = -1, y1 = -1, z1 = -1;
    for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
      if (!data[x + nx * (y + ny * z)]) continue;
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (z < z0) z0 = z; if (z > z1) z1 = z;
    }
    if (x1 < 0) return null;
    return { x0, y0, z0, x1, y1, z1 };
  }
}

// 7-step hue-shifted ramp, index 3 = base colour.
const RAMP_STEPS = [-0.8, -0.56, -0.3, 0, 0.24, 0.45, 0.66];
const rampCache = new Map();
export function ramp7(hex, contrast = 1) {
  const key = hex + '|' + contrast;
  let r = rampCache.get(key);
  if (!r) {
    r = RAMP_STEPS.map((a) => (a === 0 ? hex : shade(hex, a * contrast)));
    rampCache.set(key, r);
  }
  return r;
}

// Normals: 0 +x, 1 -x, 2 +y, 3 -y, 4 +z, 5 -z
const NRM = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const AO_CURVE = [0, 0.42, 0.75, 1];

/**
 * renderVoxels(model, opts) -> {canvas, glow, ox, oy, w, h, regions, ids}
 * opts: scale (px per voxel), yaw, pitch (degrees), outline (true|false), edges (highlight strength),
 *       ao (strength in ramp steps), jitter (ramp steps), groundAO, depthLines, track: [palette idx],
 *       light: {top, lit, dark} tones (ramp index space 0..6), glowRadius.
 * regions[idx] = {x, y, w, h, n, cx, cy, inner: {x, y, w, h}} for tracked indices (and all emissive ones).
 */
export function renderVoxels(model, opts = {}) {
  const s = opts.scale ?? 2.5;
  const yaw = (opts.yaw ?? 32) * DEG, pitch = (opts.pitch ?? 27) * DEG;
  const outline = opts.outline ?? true;
  const edgeAmt = opts.edges ?? 0.9;
  const aoAmt = opts.ao ?? 1.15;
  const jitterDef = opts.jitter ?? 0.22;
  const groundAO = opts.groundAO ?? true;
  const depthLines = opts.depthLines ?? true;
  const light = { top: 4.3, lit: 3.1, dark: 1.75, bottom: 1, ...(opts.light || {}) };
  const { nx, ny, nz, data, palette } = model;
  const b = model.bounds();
  const empty = () => ({ canvas: makeCanvas(1, 1), glow: null, ox: 0, oy: 0, w: 1, h: 1, regions: {} });
  if (!b) return empty();

  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  const R = [cy, 0, -sy];
  const C = [sy * cp, sp, cy * cp];                  // towards the camera
  const D = [-C[0], -C[1], -C[2]];                   // view direction
  const U = [-sp * sy, cp, -sp * cy];                // screen up (R x D)

  // Screen extents of the occupied bounds.
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < 8; i++) {
    const px = i & 1 ? b.x1 + 1 : b.x0, py = i & 2 ? b.y1 + 1 : b.y0, pz = i & 4 ? b.z1 + 1 : b.z0;
    const X = px * R[0] + py * R[1] + pz * R[2];
    const Y = -(px * U[0] + py * U[1] + pz * U[2]);
    minX = Math.min(minX, X); maxX = Math.max(maxX, X); minY = Math.min(minY, Y); maxY = Math.max(maxY, Y);
  }
  let hasEmissive = false;
  for (let i = 1; i < palette.length; i++) if (palette[i].emissive) hasEmissive = true;
  const glowR = hasEmissive ? opts.glowRadius ?? 3 : 0;
  const pad = 1 + glowR;
  const W = Math.ceil((maxX - minX) * s) + pad * 2;
  const H = Math.ceil((maxY - minY) * s) + pad * 2;
  const N = W * H;

  const hitVox = new Int32Array(N).fill(-1);
  const hitN = new Int8Array(N).fill(-1);
  const depth = new Float32Array(N);
  const tone = new Float32Array(N);
  const edgeMul = new Float32Array(N);
  const smoothDef = opts.smooth ?? 0;

  // Padded occupancy (pad 2, ground row below y=0 counts as solid when groundAO).
  const PD = 2, ox2 = nx + 2 * PD, oy2 = ny + 2 * PD, oz2 = nz + 2 * PD;
  const SX = 1, SY = ox2, SZ = ox2 * oy2;
  const occ = new Uint8Array(ox2 * oy2 * oz2);
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) {
    const row = nx * (y + ny * z), orow = PD + (y + PD) * SY + (z + PD) * SZ;
    for (let x = 0; x < nx; x++) if (data[row + x]) occ[orow + x] = 1;
  }
  if (groundAO) for (let z = 0; z < oz2; z++) for (let y = 0; y < PD; y++) for (let x = 0; x < ox2; x++) occ[x + y * SY + z * SZ] = 1;
  const oIdx = (x, y, z) => (x + PD) + (y + PD) * SY + (z + PD) * SZ;

  // Smoothed surface normal from the occupancy gradient around a voxel (cached per voxel).
  const SR = Math.min(PD, opts.smoothRadius ?? 2);
  const kOff = [], kx = [], ky = [], kz = [];
  for (let k = -SR; k <= SR; k++) for (let j = -SR; j <= SR; j++) for (let i = -SR; i <= SR; i++) {
    if (!i && !j && !k) continue;
    const w = 1 / (i * i + j * j + k * k);
    kOff.push(i * SX + j * SY + k * SZ); kx.push(-i * w); ky.push(-j * w); kz.push(-k * w);
  }
  const KN = kOff.length;
  const snCache = new Map();
  const smoothNormal = (key, x, y, z) => {
    let r = snCache.get(key);
    if (r) return r;
    let gx = 0, gy = 0, gz = 0;
    const base = oIdx(x, y, z);
    for (let k = 0; k < KN; k++) if (occ[base + kOff[k]]) { gx += kx[k]; gy += ky[k]; gz += kz[k]; }
    const l = Math.hypot(gx, gy, gz) || 1;
    r = [gx / l, gy / l, gz / l];
    snCache.set(key, r);
    return r;
  };

  // Light: horizontal direction from front-left of the camera.
  let hlx = -0.62 * R[0] + 0.78 * C[0], hlz = -0.62 * R[2] + 0.78 * C[2];
  const hl = Math.hypot(hlx, hlz) || 1;
  hlx /= hl; hlz /= hl;
  const faceTone = NRM.map((n) => {
    if (n[1] > 0) return light.top;
    if (n[1] < 0) return light.bottom;
    const k = (n[0] * hlx + n[2] * hlz + 1) / 2;
    return light.dark + (light.lit - light.dark) * k;
  });

  // Specular half-vector between the light (upper front-left) and the camera.
  const LV = [-0.45 * R[0] + 0.85 * U[0] + 0.55 * C[0], -0.45 * R[1] + 0.85 * U[1] + 0.55 * C[1], -0.45 * R[2] + 0.85 * U[2] + 0.55 * C[2]];
  const HV = [LV[0] + C[0], LV[1] + C[1], LV[2] + C[2]];
  { const l = Math.hypot(...HV); HV[0] /= l; HV[1] /= l; HV[2] /= l; }

  // Per-face AO neighbour offsets in the padded grid: [u0, u1, v0, v1, c00, c10, c01, c11].
  const faceOff = NRM.map((n, nid) => {
    const ax = nid >> 1;
    const u = ax === 0 ? [0, 1, 0] : [1, 0, 0];
    const v = ax === 2 ? [0, 1, 0] : [0, 0, 1];
    const o = (a) => a[0] * SX + a[1] * SY + a[2] * SZ;
    const nO = o(n), uO = o(u), vO = o(v);
    return [nO - uO, nO + uO, nO - vO, nO + vO, nO - uO - vO, nO + uO - vO, nO - uO + vO, nO + uO + vO];
  });

  // Coarse 4^3 bricks with a Chebyshev distance-to-solid (in bricks) for empty-space skipping.
  const BS = 4, bnx = (nx >> 2) + 1, bny = (ny >> 2) + 1, bnz = (nz >> 2) + 1;
  const bdist = new Uint8Array(bnx * bny * bnz).fill(255);
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    if (data[x + nx * (y + ny * z)]) bdist[(x >> 2) + bnx * ((y >> 2) + bny * (z >> 2))] = 0;
  }
  for (let pass = 1; pass < 8; pass++) {
    let changed = false;
    for (let z = 0; z < bnz; z++) for (let y = 0; y < bny; y++) for (let x = 0; x < bnx; x++) {
      const i = x + bnx * (y + bny * z);
      if (bdist[i] !== 255) continue;
      let near = false;
      for (let k = -1; k <= 1 && !near; k++) for (let j = -1; j <= 1 && !near; j++) for (let q = -1; q <= 1; q++) {
        const xx = x + q, yy = y + j, zz = z + k;
        if (xx < 0 || yy < 0 || zz < 0 || xx >= bnx || yy >= bny || zz >= bnz) continue;
        if (bdist[xx + bnx * (yy + bny * zz)] === pass - 1) { near = true; break; }
      }
      if (near) { bdist[i] = pass; changed = true; }
    }
    if (!changed) break;
  }

  const bx0 = b.x0, by0 = b.y0, bz0 = b.z0, bx1 = b.x1 + 1, by1 = b.y1 + 1, bz1 = b.z1 + 1;
  const dx = D[0], dy = D[1], dz = D[2];
  const inv = (v) => (Math.abs(v) < 1e-9 ? 1e9 : 1 / v);
  const idx = inv(dx), idy = inv(dy), idz = inv(dz);
  const stepX = dx > 0 ? 1 : -1, stepY = dy > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
  const tdx = Math.abs(idx), tdy = Math.abs(idy), tdz = Math.abs(idz);
  const hitU = new Float32Array(N), hitV = new Float32Array(N);

  const T0 = performance.now();
  // Pass 1: trace rays.
  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      const X = minX + (px - pad + 0.5) / s;
      const Y = minY + (py - pad + 0.5) / s;
      const ox = X * R[0] - Y * U[0], oy = X * R[1] - Y * U[1], oz = X * R[2] - Y * U[2];
      let t0x = (bx0 - ox) * idx, t1x = (bx1 - ox) * idx; if (t0x > t1x) { const q = t0x; t0x = t1x; t1x = q; }
      let t0y = (by0 - oy) * idy, t1y = (by1 - oy) * idy; if (t0y > t1y) { const q = t0y; t0y = t1y; t1y = q; }
      let t0z = (bz0 - oz) * idz, t1z = (bz1 - oz) * idz; if (t0z > t1z) { const q = t0z; t0z = t1z; t1z = q; }
      const tEnter = Math.max(t0x, t0y, t0z), tExit = Math.min(t1x, t1y, t1z);
      if (tEnter >= tExit) continue;
      let axis = tEnter === t0x ? 0 : tEnter === t0y ? 1 : 2;
      let t = tEnter;
      let ix, iy, iz, tmx, tmy, tmz;
      const init = (tt) => {
        const te = tt + 1e-5;
        ix = clamp(Math.floor(ox + dx * te), bx0, bx1 - 1);
        iy = clamp(Math.floor(oy + dy * te), by0, by1 - 1);
        iz = clamp(Math.floor(oz + dz * te), bz0, bz1 - 1);
        tmx = ((ix + (stepX > 0 ? 1 : 0)) - ox) * idx;
        tmy = ((iy + (stepY > 0 ? 1 : 0)) - oy) * idy;
        tmz = ((iz + (stepZ > 0 ? 1 : 0)) - oz) * idz;
      };
      init(t);
      for (let guard = 0; guard < 4096; guard++) {
        const vi = ix + nx * (iy + ny * iz);
        if (data[vi]) {
          const p = py * W + px;
          hitVox[p] = vi;
          hitN[p] = axis === 0 ? (stepX > 0 ? 1 : 0) : axis === 1 ? (stepY > 0 ? 3 : 2) : (stepZ > 0 ? 5 : 4);
          depth[p] = t;
          const hx = ox + dx * t - ix, hy = oy + dy * t - iy, hz = oz + dz * t - iz;
          hitU[p] = axis === 0 ? hy : hx;
          hitV[p] = axis === 2 ? hy : hz;
          break;
        }
        const bd = bdist[(ix >> 2) + bnx * ((iy >> 2) + bny * (iz >> 2))];
        if (bd >= 2) {
          // Skip through guaranteed-empty space, then restart the DDA.
          t += (bd - 1) * BS;
          if (t >= tExit) break;
          init(t);
          axis = -1;
          continue;
        }
        if (tmx < tmy) {
          if (tmx < tmz) { ix += stepX; t = tmx; tmx += tdx; axis = 0; if (ix < bx0 || ix >= bx1) break; }
          else { iz += stepZ; t = tmz; tmz += tdz; axis = 2; if (iz < bz0 || iz >= bz1) break; }
        } else if (tmy < tmz) { iy += stepY; t = tmy; tmy += tdy; axis = 1; if (iy < by0 || iy >= by1) break; }
        else { iz += stepZ; t = tmz; tmz += tdz; axis = 2; if (iz < bz0 || iz >= bz1) break; }
      }
    }
  }

  // Pass 2: shade hits (face light, smooth normals, AO, jitter, specular).
  for (let p = 0; p < N; p++) {
    const vi = hitVox[p];
    if (vi < 0) continue;
    const nid = hitN[p];
    const ix = vi % nx, iy = ((vi / nx) | 0) % ny, iz = (vi / (nx * ny)) | 0;
    const fo = faceOff[nid];
    const base = oIdx(ix, iy, iz);
    const sU0 = occ[base + fo[0]], sU1 = occ[base + fo[1]], sV0 = occ[base + fo[2]], sV1 = occ[base + fo[3]];
    const c00 = occ[base + fo[4]], c10 = occ[base + fo[5]], c01 = occ[base + fo[6]], c11 = occ[base + fo[7]];
    const a00 = AO_CURVE[sU0 && sV0 ? 0 : 3 - sU0 - sV0 - c00], a10 = AO_CURVE[sU1 && sV0 ? 0 : 3 - sU1 - sV0 - c10];
    const a01 = AO_CURVE[sU0 && sV1 ? 0 : 3 - sU0 - sV1 - c01], a11 = AO_CURVE[sU1 && sV1 ? 0 : 3 - sU1 - sV1 - c11];
    const fu = clamp(hitU[p], 0, 1), fv = clamp(hitV[p], 0, 1);
    const ao = (a00 * (1 - fu) + a10 * fu) * (1 - fv) + (a01 * (1 - fu) + a11 * fu) * fv;
    const v = data[vi];
    const pe = palette[v];
    const jit = pe.jitter ?? jitterDef;
    const hj = (hash3(ix, iy, iz, 7) - 0.5) * 2 * jit;
    let ft = faceTone[nid];
    const smooth = pe.smooth ?? smoothDef;
    if (smooth > 0 || pe.spec) {
      const sn = smoothNormal(vi, ix, iy, iz);
      if (smooth > 0) {
        const st = sn[0] * sn[0] * (sn[0] > 0 ? faceTone[0] : faceTone[1]) + sn[1] * sn[1] * (sn[1] > 0 ? faceTone[2] : faceTone[3]) + sn[2] * sn[2] * (sn[2] > 0 ? faceTone[4] : faceTone[5]);
        ft += (st - ft) * smooth;
      }
      if (pe.spec) {
        const nn = smooth > 0 ? sn : NRM[nid];
        const hd = nn[0] * HV[0] + nn[1] * HV[1] + nn[2] * HV[2];
        if (hd > 0) ft += Math.pow(hd, pe.specPow ?? 24) * pe.spec;
      }
    }
    tone[p] = ft + (pe.light || 0) + hj - (1 - ao) * aoAmt * (pe.aoMul ?? 1);
    edgeMul[p] = pe.edge ?? (smooth >= 0.35 ? 0 : 1);
  }

  globalThis.__T = [performance.now() - T0];
  // Screen-space convex edge highlights (crease between two faces with continuous depth).
  const nDotR = NRM.map((n) => n[0] * R[0] + n[1] * R[1] + n[2] * R[2]);
  const nDotU = NRM.map((n) => n[0] * U[0] + n[1] * U[1] + n[2] * U[2]);
  const edgeBoost = new Float32Array(N);
  const edgeThr = 1.6;
  const sideEdges = opts.sideEdges ?? 0.7;
  const sideMark = new Uint8Array(N);
  if (edgeAmt) {
    for (let py = 0; py < H; py++) for (let px = 0; px < W; px++) {
      const p = py * W + px;
      const na = hitN[p];
      if (na < 0) continue;
      // Below neighbour: upper face more upward-facing -> convex.
      if (py + 1 < H) {
        const q = p + W, nb = hitN[q];
        if (nb >= 0 && nb !== na && Math.abs(depth[p] - depth[q]) < edgeThr && nDotU[na] > nDotU[nb] + 0.2) edgeBoost[p] = Math.max(edgeBoost[p], edgeAmt * edgeMul[p]);
      }
      if (sideEdges && px + 1 < W) {
        const q = p + 1, nb = hitN[q];
        if (nb >= 0 && nb !== na && Math.abs(depth[p] - depth[q]) < edgeThr && nDotR[na] < nDotR[nb] - 0.2) sideMark[p] = 1;
      }
    }
    // Vertical creases only count when they form a run (avoids speckle on curved surfaces).
    for (let p = W; p < N - W; p++) {
      if (sideMark[p] && (sideMark[p - W] || sideMark[p + W]) && sideMark[p - W] + sideMark[p + W] + sideMark[p - 2 * W > 0 ? p - 2 * W : p] >= 2) {
        edgeBoost[p] = Math.max(edgeBoost[p], sideEdges * edgeMul[p]);
      }
    }
  }

  globalThis.__T.push(performance.now() - T0);
  // Quantise to palette ramps.
  const ramps = palette.map((pe) => (pe ? (pe.ramp || ramp7(pe.color, pe.contrast ?? 1)).map((h) => pack(h)) : null));
  const out = new Uint32Array(N);
  const glowBuf = hasEmissive ? new Uint32Array(N) : null;
  const ids = new Uint8Array(N);
  const level = new Int8Array(N).fill(-1);
  for (let p = 0; p < N; p++) {
    const hv = hitVox[p];
    if (hv < 0) continue;
    const v = data[hv];
    ids[p] = v;
    const pe = palette[v];
    let tn = tone[p] + edgeBoost[p];
    const em = pe.emissive === true ? 1 : pe.emissive || 0;
    if (em) {
      const nid = hitN[p];
      const et = (nid === 2 ? 5 : nid === 4 || nid === 1 ? 4.4 : 3.8) + (pe.light || 0) + edgeBoost[p] * 0.5;
      tn = tn + (et - tn) * em;
    }
    const li = clamp(Math.round(tn), 0, 6);
    level[p] = li;
    out[p] = ramps[v][li];
    if (em && glowBuf) glowBuf[p] = out[p];
  }

  // Depth-jump lines: darken the far pixel where a nearer surface sits next to it.
  if (depthLines) {
    const thr = opts.depthThreshold ?? 2.2;
    const src = out.slice();
    for (let py = 0; py < H; py++) for (let px = 0; px < W; px++) {
      const p = py * W + px;
      if (hitVox[p] < 0) continue;
      let jump = false;
      if (px > 0 && hitVox[p - 1] >= 0 && depth[p] - depth[p - 1] > thr) jump = true;
      else if (px + 1 < W && hitVox[p + 1] >= 0 && depth[p] - depth[p + 1] > thr) jump = true;
      else if (py > 0 && hitVox[p - W] >= 0 && depth[p] - depth[p - W] > thr) jump = true;
      else if (py + 1 < H && hitVox[p + W] >= 0 && depth[p] - depth[p + W] > thr) jump = true;
      if (!jump) continue;
      const v = ids[p], pe = palette[v];
      if (pe.emissive) continue;
      out[p] = ramps[v][Math.max(0, Math.min(level[p], 3) - 2)];
      void src;
    }
  }

  // Selective outer outline.
  if (outline) {
    const src = out.slice();
    const cache = new Map();
    const outCol = (c) => {
      let o = cache.get(c);
      if (o === undefined) {
        const [r, g, bb] = unpack(c);
        const hex = '#' + [r, g, bb].map((q) => q.toString(16).padStart(2, '0')).join('');
        o = pack(mix(shade(hex, -0.78), '#140c22', 0.35));
        cache.set(c, o);
      }
      return o;
    };
    for (let py = 0; py < H; py++) for (let px = 0; px < W; px++) {
      const p = py * W + px;
      if (src[p]) continue;
      // Prefer the neighbour below/right (shadow side) colour for a consistent outline.
      let n = 0;
      if (py > 0 && src[p - W]) n = src[p - W];
      else if (px > 0 && src[p - 1]) n = src[p - 1];
      else if (px + 1 < W && src[p + 1]) n = src[p + 1];
      else if (py + 1 < H && src[p + W]) n = src[p + W];
      if (n) out[p] = outCol(n);
    }
  }

  globalThis.__T.push(performance.now() - T0);
  const canvas = makeCanvas(W, H);
  {
    const g = ctxOf(canvas);
    const img = g.createImageData(W, H);
    new Uint32Array(img.data.buffer).set(out);
    g.putImageData(img, 0, 0);
  }

  // Glow: emissive pixels plus a soft halo.
  let glow = null;
  if (glowBuf) {
    const gb = new Uint32Array(N);
    const dist = new Float32Array(N).fill(99);
    const col = new Uint32Array(N);
    for (let p = 0; p < N; p++) if (glowBuf[p]) { dist[p] = 0; col[p] = glowBuf[p]; }
    for (let pass = 0; pass < glowR; pass++) {
      for (let py = 0; py < H; py++) for (let px = 0; px < W; px++) {
        const p = py * W + px;
        if (dist[p] <= pass) continue;
        let best = 99, bc = 0;
        if (px > 0 && dist[p - 1] + 1 < best) { best = dist[p - 1] + 1; bc = col[p - 1]; }
        if (px + 1 < W && dist[p + 1] + 1 < best) { best = dist[p + 1] + 1; bc = col[p + 1]; }
        if (py > 0 && dist[p - W] + 1 < best) { best = dist[p - W] + 1; bc = col[p - W]; }
        if (py + 1 < H && dist[p + W] + 1 < best) { best = dist[p + W] + 1; bc = col[p + W]; }
        if (best < dist[p]) { dist[p] = best; col[p] = bc; }
      }
    }
    for (let p = 0; p < N; p++) {
      if (dist[p] > glowR) continue;
      const a = dist[p] === 0 ? 255 : Math.round(150 * Math.pow(1 - dist[p] / (glowR + 1), 1.6));
      gb[p] = ((a & 255) << 24 | (col[p] & 0xffffff)) >>> 0;
    }
    glow = makeCanvas(W, H);
    const g = ctxOf(glow);
    const img = g.createImageData(W, H);
    new Uint32Array(img.data.buffer).set(gb);
    g.putImageData(img, 0, 0);
  }

  // Regions for tracked / emissive palette indices.
  const track = new Set(opts.track || []);
  for (let i = 1; i < palette.length; i++) if (palette[i].emissive) track.add(i);
  const regions = {};
  for (const k of track) {
    let x0 = W, y0 = H, x1 = -1, y1 = -1, n = 0, sx = 0, syy = 0;
    for (let p = 0; p < N; p++) {
      if (ids[p] !== k) continue;
      const x = p % W, y = (p / W) | 0;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      n++; sx += x; syy += y;
    }
    if (!n) continue;
    regions[k] = { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1, n, cx: sx / n, cy: syy / n, inner: largestRect(ids, W, H, k, x0, y0, x1, y1) };
  }

  globalThis.__T.push(performance.now() - T0);
  // Ground anchor: footprint centre at the base.
  const fx = (b.x0 + b.x1 + 1) / 2, fy = b.y0, fz = (b.z0 + b.z1 + 1) / 2;
  const aX = fx * R[0] + fy * R[1] + fz * R[2];
  const aY = -(fx * U[0] + fy * U[1] + fz * U[2]);
  const ox = Math.round((aX - minX) * s + pad);
  const oy = Math.round((aY - minY) * s + pad);

  // Project a voxel-space point to canvas pixels (for props placing lights etc.).
  const project = (x, y, z) => [(x * R[0] + y * R[1] + z * R[2] - minX) * s + pad, (-(x * U[0] + y * U[1] + z * U[2]) - minY) * s + pad];

  return { canvas, glow, ox, oy, w: W, h: H, regions, ids, project };
}

// Largest axis-aligned rectangle made only of pixels with id k (histogram method).
function largestRect(ids, W, H, k, x0, y0, x1, y1) {
  const w = x1 - x0 + 1;
  const hist = new Int32Array(w);
  let best = { x: x0, y: y0, w: 0, h: 0 }, bestA = 0;
  for (let y = y0; y <= y1; y++) {
    for (let i = 0; i < w; i++) hist[i] = ids[y * W + x0 + i] === k ? hist[i] + 1 : 0;
    const stack = [];
    for (let i = 0; i <= w; i++) {
      const hgt = i < w ? hist[i] : 0;
      let start = i;
      while (stack.length && stack[stack.length - 1][1] >= hgt) {
        const [si, sh] = stack.pop();
        const area = sh * (i - si);
        if (area > bestA) { bestA = area; best = { x: x0 + si, y: y - sh + 1, w: i - si, h: sh }; }
        start = si;
      }
      stack.push([start, hgt]);
    }
  }
  return best;
}
