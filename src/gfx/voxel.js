// Tiny voxel modeller + orthographic ray-cast renderer that turns voxel models
// into crisp pixel-art sprites (per-face light, smooth vertex AO, per-voxel jitter,
// palette-ramp quantisation, convex edge highlights, selective outlines, emissive glow).
//
//   const m = new VoxelModel(32, 40, 24);           // x, y (up), z (toward viewer)
//   const stone = m.color('#6a5acd', { jitter: 0.2, smooth: 0.6 });
//   m.box(0, 0, 0, 31, 5, 23, stone);               // inclusive integer ranges
//   m.sub(() => m.sphere(16, 20, 12, 8));           // CSG-style carve (also m.paint / m.under)
//   const r = renderVoxels(m, { scale: 1.75, yaw: 30, pitch: 27 });
//   ctx.drawImage(r.canvas, x - r.ox, y - r.oy);     // (ox, oy) = footprint centre on the ground
//
// Shape colour arguments may be a palette index or a function (x, y, z, prev) -> index|null.
// Shapes: box, ellipsoid, sphere, cylinder, cone, line (capsule), tube (spline), fill, recolor,
// mirrorX, stamp, subtract(model | fn). renderVoxels traces one orthographic ray per output pixel
// (3D DDA with empty-brick skipping), so cost scales with sprite area, not voxel count.

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
    const { nx, ny, nz, data } = this;
    if (x <= 0 || y <= 0 || z <= 0 || x >= nx - 1 || y >= ny - 1 || z >= nz - 1) {
      return !this.get(x + 1, y, z) || !this.get(x - 1, y, z) || !this.get(x, y + 1, z) || !this.get(x, y - 1, z) || !this.get(x, y, z + 1) || !this.get(x, y, z - 1);
    }
    const i = x + nx * (y + ny * z), SZ = nx * ny;
    return !data[i + 1] || !data[i - 1] || !data[i + nx] || !data[i - nx] || !data[i + SZ] || !data[i - SZ];
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

// Scratch buffers reused across renders (large per-render allocations trigger costly GCs).
const POOL = new Map();
function pooled(name, Type, size) {
  let a = POOL.get(name);
  if (!a || a.length < size) {
    a = new Type(Math.max(size, a ? Math.floor(a.length * 1.5) : 0));
    POOL.set(name, a);
  }
  return a.subarray(0, size);
}

// Normals: 0 +x, 1 -x, 2 +y, 3 -y, 4 +z, 5 -z
const NRM = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const AO_CURVE = new Float32Array([0, 0.42, 0.75, 1]);
const PD = 2; // occupancy padding

/**
 * renderVoxels(model, opts) -> {canvas, glow, ox, oy, w, h, regions, ids, project}
 * opts: scale (px per voxel), yaw, pitch (degrees), outline, edges / sideEdges (highlight strength),
 *       ao (strength in ramp steps), jitter (ramp steps), smooth (default normal smoothing), groundAO,
 *       depthLines, depthThreshold, track: [palette idx], light: {top, lit, dark, bottom} tones (ramp
 *       index space 0..6), glowRadius, keepVoxel(x, y, z) -> bool (mask for layered renders).
 * Palette entry options: emissive (bool | 0..1), jitter, light (tone offset), smooth (0..1 blend toward
 *   smoothed normals), spec / specPow (glint), edge (edge-highlight multiplier), aoMul, contrast, ramp.
 * regions[idx] = {x, y, w, h, n, cx, cy, inner: {x, y, w, h}} for tracked indices (and all emissive ones).
 */
export function renderVoxels(model, opts = {}) {
  const b = model.bounds();
  if (!b) return { canvas: makeCanvas(1, 1), glow: null, ox: 0, oy: 0, w: 1, h: 1, regions: {}, ids: new Uint8Array(1), project: () => [0, 0] };
  const { palette } = model;
  const cam = setupCamera(model, b, opts);
  const { W, H, N } = cam;
  const vol = buildVolumes(model, opts.groundAO ?? true);

  const hitVox = pooled('hitVox', Int32Array, N).fill(-1);
  const hitN = pooled('hitN', Int8Array, N).fill(-1);
  const depth = pooled('depth', Float32Array, N);
  const hitU = pooled('hitU', Float32Array, N), hitV = pooled('hitV', Float32Array, N);
  traceRays(model, b, cam, vol, hitVox, hitN, depth, hitU, hitV);

  const tone = pooled('tone', Float32Array, N), edgeMul = pooled('edgeMul', Float32Array, N);
  const faceTone = faceTones(cam, opts.light);
  shadeHits(model, cam, vol, opts, faceTone, hitVox, hitN, hitU, hitV, tone, edgeMul);

  const edgeBoost = pooled('edgeBoost', Float32Array, N).fill(0);
  const sideMark = pooled('sideMark', Uint8Array, N).fill(0);
  edgeHighlights(cam, opts, hitN, depth, edgeMul, edgeBoost, sideMark);

  const ramps = palette.map((pe) => (pe ? Uint32Array.from((pe.ramp || ramp7(pe.color, pe.contrast ?? 1)).map((h) => pack(h) >>> 0)) : null));
  const out = new Uint32Array(N);
  const glowBuf = cam.hasEmissive ? new Uint32Array(N) : null;
  const ids = new Uint8Array(N);
  const level = pooled('level', Int8Array, N).fill(-1);
  quantize(model, N, hitVox, hitN, tone, edgeBoost, ramps, out, glowBuf, ids, level);

  if (opts.keepVoxel) {
    const { nx, ny } = model;
    for (let p = 0; p < N; p++) {
      const vi = hitVox[p];
      if (vi >= 0 && !opts.keepVoxel(vi % nx, ((vi / nx) | 0) % ny, (vi / (nx * ny)) | 0)) {
        hitVox[p] = -1; out[p] = 0; ids[p] = 0; if (glowBuf) glowBuf[p] = 0;
      }
    }
  }
  if (opts.depthLines ?? true) depthLinePass(palette, W, H, opts.depthThreshold ?? 2.2, hitVox, depth, ids, level, ramps, out);
  if (opts.outline ?? true) outlinePass(W, H, out);

  const canvas = toCanvas(out, W, H);
  const glow = glowBuf ? toCanvas(glowHalo(glowBuf, W, H, cam.glowR), W, H) : null;

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

  // Ground anchor: footprint centre at the base.
  const fx = (b.x0 + b.x1 + 1) / 2, fy = b.y0, fz = (b.z0 + b.z1 + 1) / 2;
  const [ax, ay] = cam.project(fx, fy, fz);
  return { canvas, glow, ox: Math.round(ax), oy: Math.round(ay), w: W, h: H, regions, ids, project: cam.project };
}

function setupCamera(model, b, opts) {
  const s = opts.scale ?? 2;
  const yaw = (opts.yaw ?? 32) * DEG, pitch = (opts.pitch ?? 27) * DEG;
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  const R = [cy, 0, -sy];
  const C = [sy * cp, sp, cy * cp];                  // towards the camera
  const D = [-C[0], -C[1], -C[2]];                   // view direction
  const U = [-sp * sy, cp, -sp * cy];                // screen up (R x D)
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < 8; i++) {
    const px = i & 1 ? b.x1 + 1 : b.x0, py = i & 2 ? b.y1 + 1 : b.y0, pz = i & 4 ? b.z1 + 1 : b.z0;
    const X = px * R[0] + py * R[1] + pz * R[2];
    const Y = -(px * U[0] + py * U[1] + pz * U[2]);
    minX = Math.min(minX, X); maxX = Math.max(maxX, X); minY = Math.min(minY, Y); maxY = Math.max(maxY, Y);
  }
  let hasEmissive = false;
  for (let i = 1; i < model.palette.length; i++) if (model.palette[i].emissive) hasEmissive = true;
  const glowR = hasEmissive ? opts.glowRadius ?? 3 : 0;
  const pad = 1 + glowR;
  const W = Math.ceil((maxX - minX) * s) + pad * 2;
  const H = Math.ceil((maxY - minY) * s) + pad * 2;
  const project = (x, y, z) => [(x * R[0] + y * R[1] + z * R[2] - minX) * s + pad, (-(x * U[0] + y * U[1] + z * U[2]) - minY) * s + pad];
  return { s, R, C, D, U, minX, minY, W, H, N: W * H, pad, glowR, hasEmissive, project };
}

// Padded occupancy grid (for AO / normals) + 4^3 brick distance field (for empty-space skipping).
function buildVolumes(model, groundAO) {
  const { nx, ny, nz, data } = model;
  const ox2 = nx + 2 * PD, oy2 = ny + 2 * PD, oz2 = nz + 2 * PD;
  const SY = ox2, SZ = ox2 * oy2;
  const occ = pooled('occ', Uint8Array, ox2 * oy2 * oz2).fill(0);
  const bnx = (nx >> 2) + 1, bny = (ny >> 2) + 1, bnz = (nz >> 2) + 1, nb = bnx * bny * bnz;
  const bdist = pooled('bdist', Uint8Array, nb).fill(255);
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) {
    const row = nx * (y + ny * z), orow = PD + (y + PD) * SY + (z + PD) * SZ, brow = bnx * ((y >> 2) + bny * (z >> 2));
    for (let x = 0; x < nx; x++) if (data[row + x]) { occ[orow + x] = 1; bdist[brow + (x >> 2)] = 0; }
  }
  if (groundAO) for (let z = 0; z < oz2; z++) for (let y = 0; y < PD; y++) for (let x = 0; x < ox2; x++) occ[x + y * SY + z * SZ] = 1;
  // Chebyshev brick distance by repeated separable 3x3x3 dilation.
  let cur = pooled('bcur', Uint8Array, nb), tmp = pooled('btmp', Uint8Array, nb);
  for (let i = 0; i < nb; i++) cur[i] = bdist[i] === 0 ? 1 : 0;
  const SYB = bnx, SZB = bnx * bny;
  for (let pass = 1; pass < 8; pass++) {
    for (let i = 0; i < nb; i++) { const x = i % bnx; tmp[i] = cur[i] | (x > 0 ? cur[i - 1] : 0) | (x < bnx - 1 ? cur[i + 1] : 0); }
    for (let i = 0; i < nb; i++) { const y = ((i / SYB) | 0) % bny; cur[i] = tmp[i] | (y > 0 ? tmp[i - SYB] : 0) | (y < bny - 1 ? tmp[i + SYB] : 0); }
    let changed = false;
    for (let i = 0; i < nb; i++) {
      const z = (i / SZB) | 0;
      const v = cur[i] | (z > 0 ? cur[i - SZB] : 0) | (z < bnz - 1 ? cur[i + SZB] : 0);
      tmp[i] = v;
      if (v && bdist[i] === 255) { bdist[i] = pass; changed = true; }
    }
    const q = cur; cur = tmp; tmp = q;
    if (!changed) break;
  }
  return { occ, SY, SZ, bdist, bnx, bny };
}

// Pass 1: orthographic rays, 3D DDA with brick skipping.
function traceRays(model, b, cam, vol, hitVox, hitN, depth, hitU, hitV) {
  const { nx, ny, data } = model;
  const { s, R, U, D, minX, minY, W, H, pad } = cam;
  const { bdist, bnx, bny } = vol;
  const R0 = R[0], R1 = R[1], R2 = R[2], U0 = U[0], U1 = U[1], U2 = U[2];
  const bx0 = b.x0, by0 = b.y0, bz0 = b.z0, bx1 = b.x1 + 1, by1 = b.y1 + 1, bz1 = b.z1 + 1;
  const dx = D[0], dy = D[1], dz = D[2];
  // Axis-parallel components (e.g. yaw 0) never step along that axis: tMax stays effectively infinite.
  const zx = Math.abs(dx) < 1e-9, zy = Math.abs(dy) < 1e-9, zz = Math.abs(dz) < 1e-9;
  const idx = zx ? 1e12 : 1 / dx, idy = zy ? 1e12 : 1 / dy, idz = zz ? 1e12 : 1 / dz;
  const stepX = dx > 0 ? 1 : -1, stepY = dy > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
  const offX = stepX > 0 ? 1 : 0, offY = stepY > 0 ? 1 : 0, offZ = stepZ > 0 ? 1 : 0;
  const tdx = Math.abs(idx), tdy = Math.abs(idy), tdz = Math.abs(idz);
  const BIG = 1e30;
  const nX = stepX > 0 ? 1 : 0, nY = stepY > 0 ? 3 : 2, nZ = stepZ > 0 ? 5 : 4;
  for (let py = 0; py < H; py++) {
    const Y = minY + (py - pad + 0.5) / s;
    for (let px = 0; px < W; px++) {
      const X = minX + (px - pad + 0.5) / s;
      const ox = X * R0 - Y * U0, oy = X * R1 - Y * U1, oz = X * R2 - Y * U2;
      let t0x, t1x, t0y, t1y, t0z, t1z;
      if (zx) { if (ox < bx0 || ox >= bx1) continue; t0x = -BIG; t1x = BIG; } else { t0x = (bx0 - ox) * idx; t1x = (bx1 - ox) * idx; if (t0x > t1x) { const q = t0x; t0x = t1x; t1x = q; } }
      if (zy) { if (oy < by0 || oy >= by1) continue; t0y = -BIG; t1y = BIG; } else { t0y = (by0 - oy) * idy; t1y = (by1 - oy) * idy; if (t0y > t1y) { const q = t0y; t0y = t1y; t1y = q; } }
      if (zz) { if (oz < bz0 || oz >= bz1) continue; t0z = -BIG; t1z = BIG; } else { t0z = (bz0 - oz) * idz; t1z = (bz1 - oz) * idz; if (t0z > t1z) { const q = t0z; t0z = t1z; t1z = q; } }
      const tEnter = Math.max(t0x, t0y, t0z), tExit = Math.min(t1x, t1y, t1z);
      if (tEnter >= tExit) continue;
      let axis = tEnter === t0x ? 0 : tEnter === t0y ? 1 : 2;
      let t = tEnter, te = t + 1e-5;
      let ix = clamp(Math.floor(ox + dx * te), bx0, bx1 - 1);
      let iy = clamp(Math.floor(oy + dy * te), by0, by1 - 1);
      let iz = clamp(Math.floor(oz + dz * te), bz0, bz1 - 1);
      let tmx = zx ? BIG : (ix + offX - ox) * idx, tmy = zy ? BIG : (iy + offY - oy) * idy, tmz = zz ? BIG : (iz + offZ - oz) * idz;
      for (let guard = 0; guard < 4096; guard++) {
        const vi = ix + nx * (iy + ny * iz);
        if (data[vi]) {
          const p = py * W + px;
          hitVox[p] = vi;
          hitN[p] = axis === 0 ? nX : axis === 1 ? nY : nZ;
          depth[p] = t;
          const hx = ox + dx * t - ix, hy = oy + dy * t - iy, hz = oz + dz * t - iz;
          hitU[p] = axis === 0 ? hy : hx;
          hitV[p] = axis === 2 ? hy : hz;
          break;
        }
        const bd = bdist[(ix >> 2) + bnx * ((iy >> 2) + bny * (iz >> 2))];
        if (bd >= 2) {
          // Skip through guaranteed-empty space, then restart the DDA.
          t += (bd - 1) * 4;
          if (t >= tExit) break;
          te = t + 1e-5;
          ix = clamp(Math.floor(ox + dx * te), bx0, bx1 - 1);
          iy = clamp(Math.floor(oy + dy * te), by0, by1 - 1);
          iz = clamp(Math.floor(oz + dz * te), bz0, bz1 - 1);
          tmx = zx ? BIG : (ix + offX - ox) * idx; tmy = zy ? BIG : (iy + offY - oy) * idy; tmz = zz ? BIG : (iz + offZ - oz) * idz;
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
}

// Tone per face orientation: top brightest, light from the camera's upper front-left.
function faceTones(cam, lightOpt) {
  const light = { top: 4.3, lit: 3.1, dark: 1.75, bottom: 1, ...(lightOpt || {}) };
  const { R, C } = cam;
  let hlx = -0.62 * R[0] + 0.78 * C[0], hlz = -0.62 * R[2] + 0.78 * C[2];
  const hl = Math.hypot(hlx, hlz) || 1;
  hlx /= hl; hlz /= hl;
  return Float32Array.from(NRM.map((n) => {
    if (n[1] > 0) return light.top;
    if (n[1] < 0) return light.bottom;
    return light.dark + (light.lit - light.dark) * ((n[0] * hlx + n[2] * hlz + 1) / 2);
  }));
}

// Pass 2: per-hit tone = face light (blended toward smoothed normals) + spec + jitter - vertex AO.
function shadeHits(model, cam, vol, opts, faceTone, hitVox, hitN, hitU, hitV, tone, edgeMul) {
  const { nx, ny, nz, data, palette } = model;
  const { occ, SY, SZ } = vol;
  const N = cam.N;
  const aoAmt = opts.ao ?? 1.15, jitterDef = opts.jitter ?? 0.22, smoothDef = opts.smooth ?? 0;
  const { R, U, C } = cam;
  const LV = [-0.45 * R[0] + 0.85 * U[0] + 0.55 * C[0], -0.45 * R[1] + 0.85 * U[1] + 0.55 * C[1], -0.45 * R[2] + 0.85 * U[2] + 0.55 * C[2]];
  let hvx = LV[0] + C[0], hvy = LV[1] + C[1], hvz = LV[2] + C[2];
  { const l = Math.hypot(hvx, hvy, hvz); hvx /= l; hvy /= l; hvz /= l; }
  // Palette lookups flattened into typed arrays.
  const P = palette.length;
  const pJit = new Float32Array(P), pSmooth = new Float32Array(P), pSpec = new Float32Array(P), pPow = new Float32Array(P), pLight = new Float32Array(P), pAo = new Float32Array(P), pEdge = new Float32Array(P);
  for (let i = 1; i < P; i++) {
    const pe = palette[i];
    pJit[i] = pe.jitter ?? jitterDef;
    pSmooth[i] = pe.smooth ?? smoothDef;
    pSpec[i] = pe.spec || 0;
    pPow[i] = pe.specPow ?? 24;
    pLight[i] = pe.light || 0;
    pAo[i] = (pe.aoMul ?? 1) * aoAmt;
    pEdge[i] = pe.edge ?? (pSmooth[i] >= 0.35 ? 0 : 1);
  }
  // Per-face AO neighbour offsets in the padded grid: [u0, u1, v0, v1, c00, c10, c01, c11].
  const faceOff = new Int32Array(48);
  NRM.forEach((n, nid) => {
    const ax = nid >> 1;
    const u = ax === 0 ? [0, 1, 0] : [1, 0, 0];
    const v = ax === 2 ? [0, 1, 0] : [0, 0, 1];
    const o = (a) => a[0] + a[1] * SY + a[2] * SZ;
    const nO = o(n), uO = o(u), vO = o(v);
    faceOff.set([nO - uO, nO + uO, nO - vO, nO + vO, nO - uO - vO, nO + uO - vO, nO - uO + vO, nO + uO + vO], nid * 8);
  });
  // Smoothed-normal kernel (radius 2, 1/r^2 weights) and a per-voxel cache.
  const kOff = [], kxs = [], kys = [], kzs = [];
  for (let k = -2; k <= 2; k++) for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) {
    if (!i && !j && !k) continue;
    const w = 1 / (i * i + j * j + k * k);
    kOff.push(i + j * SY + k * SZ); kxs.push(-i * w); kys.push(-j * w); kzs.push(-k * w);
  }
  const KN = kOff.length;
  const KO = Int32Array.from(kOff), KX = Float32Array.from(kxs), KY = Float32Array.from(kys), KZ = Float32Array.from(kzs);
  const snCache = pooled('snCache', Int32Array, nx * ny * nz);
  let snStore = pooled('snStore', Float32Array, 3 * 16384), snKeys = pooled('snKeys', Int32Array, 16384), snCount = 0;
  const NX = Float32Array.from(NRM.map((n) => n[0])), NY = Float32Array.from(NRM.map((n) => n[1])), NZ = Float32Array.from(NRM.map((n) => n[2]));
  const nxy = nx * ny;
  for (let p = 0; p < N; p++) {
    const vi = hitVox[p];
    if (vi < 0) continue;
    const nid = hitN[p];
    const ix = vi % nx, iy = ((vi / nx) | 0) % ny, iz = (vi / nxy) | 0;
    const base = (ix + PD) + (iy + PD) * SY + (iz + PD) * SZ;
    const f = nid * 8;
    const sU0 = occ[base + faceOff[f]], sU1 = occ[base + faceOff[f + 1]], sV0 = occ[base + faceOff[f + 2]], sV1 = occ[base + faceOff[f + 3]];
    const c00 = occ[base + faceOff[f + 4]], c10 = occ[base + faceOff[f + 5]], c01 = occ[base + faceOff[f + 6]], c11 = occ[base + faceOff[f + 7]];
    const a00 = AO_CURVE[sU0 && sV0 ? 0 : 3 - sU0 - sV0 - c00], a10 = AO_CURVE[sU1 && sV0 ? 0 : 3 - sU1 - sV0 - c10];
    const a01 = AO_CURVE[sU0 && sV1 ? 0 : 3 - sU0 - sV1 - c01], a11 = AO_CURVE[sU1 && sV1 ? 0 : 3 - sU1 - sV1 - c11];
    const fu = clamp(hitU[p], 0, 1), fv = clamp(hitV[p], 0, 1);
    const ao = (a00 * (1 - fu) + a10 * fu) * (1 - fv) + (a01 * (1 - fu) + a11 * fu) * fv;
    const v = data[vi];
    const hj = (hash3(ix, iy, iz, 7) - 0.5) * 2 * pJit[v];
    let ft = faceTone[nid];
    const smooth = pSmooth[v];
    if (smooth > 0 || pSpec[v] > 0) {
      let k3 = snCache[vi] - 1;
      if (k3 < 0) {
        let gx = 0, gy = 0, gz = 0;
        for (let k = 0; k < KN; k++) if (occ[base + KO[k]]) { gx += KX[k]; gy += KY[k]; gz += KZ[k]; }
        const l = Math.hypot(gx, gy, gz) || 1;
        if (snCount * 3 + 3 > snStore.length) { const n2 = new Float32Array(snStore.length * 2); n2.set(snStore); snStore = n2; POOL.set('snStore', n2); }
        if (snCount >= snKeys.length) { const k2 = new Int32Array(snKeys.length * 2); k2.set(snKeys); snKeys = k2; POOL.set('snKeys', k2); }
        snKeys[snCount] = vi;
        k3 = snCount++ * 3;
        snStore[k3] = gx / l; snStore[k3 + 1] = gy / l; snStore[k3 + 2] = gz / l;
        snCache[vi] = k3 + 1;
      }
      const sx = snStore[k3], sy = snStore[k3 + 1], sz = snStore[k3 + 2];
      if (smooth > 0) {
        const st = sx * sx * (sx > 0 ? faceTone[0] : faceTone[1]) + sy * sy * (sy > 0 ? faceTone[2] : faceTone[3]) + sz * sz * (sz > 0 ? faceTone[4] : faceTone[5]);
        ft += (st - ft) * smooth;
      }
      if (pSpec[v] > 0) {
        const hd = smooth > 0 ? sx * hvx + sy * hvy + sz * hvz : NX[nid] * hvx + NY[nid] * hvy + NZ[nid] * hvz;
        if (hd > 0) ft += Math.pow(hd, pPow[v]) * pSpec[v];
      }
    }
    tone[p] = ft + pLight[v] + hj - (1 - ao) * pAo[v];
    edgeMul[p] = pEdge[v];
  }
  for (let i = 0; i < snCount; i++) snCache[snKeys[i]] = 0;
}

// Screen-space convex edge highlights (crease between two faces with continuous depth).
function edgeHighlights(cam, opts, hitN, depth, edgeMul, edgeBoost, sideMark) {
  const edgeAmt = opts.edges ?? 0.9, sideEdges = opts.sideEdges ?? 0.7;
  if (!edgeAmt && !sideEdges) return;
  const { W, H, N, R, U } = cam;
  const nDotR = Float32Array.from(NRM.map((n) => n[0] * R[0] + n[1] * R[1] + n[2] * R[2]));
  const nDotU = Float32Array.from(NRM.map((n) => n[0] * U[0] + n[1] * U[1] + n[2] * U[2]));
  const edgeThr = 1.6;
  for (let py = 0; py < H; py++) for (let px = 0; px < W; px++) {
    const p = py * W + px;
    const na = hitN[p];
    if (na < 0) continue;
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
  for (let p = 2 * W; p < N - W; p++) {
    if (sideMark[p] && (sideMark[p - W] || sideMark[p + W]) && sideMark[p - W] + sideMark[p + W] + sideMark[p - 2 * W] >= 2) {
      edgeBoost[p] = Math.max(edgeBoost[p], sideEdges * edgeMul[p]);
    }
  }
}

// Quantise tones to each palette entry's 7-step hue-shifted ramp; emissive entries self-light.
function quantize(model, N, hitVox, hitN, tone, edgeBoost, ramps, out, glowBuf, ids, level) {
  const { data, palette } = model;
  const P = palette.length;
  const pEm = new Float32Array(P), pLight = new Float32Array(P);
  for (let i = 1; i < P; i++) { const e = palette[i].emissive; pEm[i] = e === true ? 1 : e || 0; pLight[i] = palette[i].light || 0; }
  for (let p = 0; p < N; p++) {
    const hv = hitVox[p];
    if (hv < 0) continue;
    const v = data[hv];
    ids[p] = v;
    let tn = tone[p] + edgeBoost[p];
    const em = pEm[v];
    if (em > 0) {
      const nid = hitN[p];
      const et = (nid === 2 ? 5 : nid === 4 || nid === 1 ? 4.4 : 3.8) + pLight[v] + edgeBoost[p] * 0.5;
      tn += (et - tn) * em;
    }
    const li = tn < 0 ? 0 : tn > 6 ? 6 : Math.round(tn);
    level[p] = li;
    out[p] = ramps[v][li];
    if (em > 0 && glowBuf) glowBuf[p] = out[p];
  }
}

// Darken the far pixel where a nearer surface sits next to it (interior silhouette lines).
function depthLinePass(palette, W, H, thr, hitVox, depth, ids, level, ramps, out) {
  for (let py = 0; py < H; py++) for (let px = 0; px < W; px++) {
    const p = py * W + px;
    if (hitVox[p] < 0) continue;
    const d = depth[p] - thr;
    const jump = (px > 0 && hitVox[p - 1] >= 0 && d > depth[p - 1]) || (px + 1 < W && hitVox[p + 1] >= 0 && d > depth[p + 1]) ||
      (py > 0 && hitVox[p - W] >= 0 && d > depth[p - W]) || (py + 1 < H && hitVox[p + W] >= 0 && d > depth[p + W]);
    if (!jump) continue;
    const v = ids[p];
    if (palette[v].emissive) continue;
    out[p] = ramps[v][Math.max(0, Math.min(level[p], 3) - 2)];
  }
}

// Selective 1 px outer outline: darkened, hue-shifted version of the neighbouring colour.
const outlineCache = new Map();
function outlineColor(c) {
  let o = outlineCache.get(c);
  if (o === undefined) {
    const [r, g, bb] = unpack(c);
    const hex = '#' + [r, g, bb].map((q) => q.toString(16).padStart(2, '0')).join('');
    o = pack(mix(shade(hex, -0.78), '#140c22', 0.35)) >>> 0;
    if (outlineCache.size > 4096) outlineCache.clear();
    outlineCache.set(c, o);
  }
  return o;
}
function outlinePass(W, H, out) {
  const src = out.slice();
  for (let py = 0; py < H; py++) for (let px = 0; px < W; px++) {
    const p = py * W + px;
    if (src[p]) continue;
    let n = 0;
    if (py > 0 && src[p - W]) n = src[p - W];
    else if (px > 0 && src[p - 1]) n = src[p - 1];
    else if (px + 1 < W && src[p + 1]) n = src[p + 1];
    else if (py + 1 < H && src[p + W]) n = src[p + W];
    if (n) out[p] = outlineColor(n);
  }
}

// Glow layer: emissive pixels at full strength plus a soft halo of glowR pixels.
function glowHalo(glowBuf, W, H, glowR) {
  const N = W * H;
  const gb = new Uint32Array(N);
  const dist = pooled('gdist', Uint8Array, N).fill(99);
  const col = pooled('gcol', Uint32Array, N).fill(0);
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
  return gb;
}

function toCanvas(buf, W, H) {
  const c = makeCanvas(W, H);
  const g = ctxOf(c);
  const img = g.createImageData(W, H);
  new Uint32Array(img.data.buffer).set(buf);
  g.putImageData(img, 0, 0);
  return c;
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
