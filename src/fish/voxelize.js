// Voxel conversion (phase 8): turns the anatomical pose meshes of src/fish/lowpolyfish.js (and any LPMesh model)
// into REAL VOXEL MODELS: the surfaces are sampled into a fine voxel grid (colours from vertex colours x the
// painted skin texture, fin outlines from the skin's alpha), the inside is filled (flood fill from outside), and
// only the visible cube faces are meshed, with baked per-vertex ambient occlusion (soft MagicaVoxel-style contact
// shadows in every crease) and a whisper of per-voxel colour jitter (hand-placed feel). The result is a list of
// ordinary lowpoly.js parts, so the existing sprite-sheet cache, the 3D tank (fishMesh) and every caller keep working.
//
//   voxelizeParts(parts, vs, o?) -> parts            parts: [{key, mesh: LPMesh, texture?, emitTex?, alpha?, ...}]
//       vs = voxel edge (model units). Output parts (same option shapes): 'body' (opaque voxels), 'eyes' (glossy),
//       'glow' (emissive voxels), 'fins' (translucent membrane voxels), 'finrays' (denser fin rays / edges),
//       'glass' (see-through bodies). o: {ao (0..1, default 1), jitter (default 0.035), keepGlassCore}
//   voxelizeMesh(mesh, vs, opts) -> LPMesh            one mesh -> one voxel mesh (bubbles, props, the seal ...)
//   voxStats()                                        debug counters
// Parts are classified by key: 'eyes' (rank 6), 'glow' (5), anything opaque (4), 'glass' / depthWrite false (2),
// 'fins' / alpha < 1 (1). A voxel takes the highest-ranked class sampled into it; samples of equal rank average.

import { LPMesh } from '../gfx/lowpoly.js';

const STAT = { grids: 0, faces: 0, ms: 0, cells: 0, samples: 0, tS: 0, tF: 0, tM: 0 };
export function voxStats() { return { ...STAT }; }
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

// ---------------------------------------------------------------------------------------------- texture access
const texPix = new WeakMap();
function pixOf(tex) {
  let p = texPix.get(tex);
  if (!p || tex._lpDirtyVox) {
    try { p = { w: tex.width, h: tex.height, d: tex.getContext('2d').getImageData(0, 0, tex.width, tex.height).data }; } catch { p = { w: 1, h: 1, d: new Uint8ClampedArray([255, 255, 255, 255]) }; }
    texPix.set(tex, p);
    tex._lpDirtyVox = false;
  }
  return p;
}

// ---------------------------------------------------------------------------------------------- scratch grids
let CAP = 0;
let cls, rnk, acc, ext, queue;
function ensure(n) {
  if (n <= CAP) { cls.fill(0, 0, n); rnk.fill(0, 0, n); acc.fill(0, 0, n * 6); ext.fill(0, 0, n); return; }
  CAP = Math.ceil(n * 1.25);
  cls = new Uint8Array(CAP); rnk = new Uint8Array(CAP); acc = new Float32Array(CAP * 6); ext = new Uint8Array(CAP); queue = new Int32Array(CAP);
}

const RANK = { eyes: 6, glow: 5 };
// class codes: 1 opaque (body), 2 eye, 3 glow, 4 glass, 5 fin
function classify(p) {
  const k = p.key;
  if (k === 'eyes') return { cls: 2, rank: 6 };
  if (k === 'glow') return { cls: 3, rank: 5 };
  if (k === 'glass' || p.depthWrite === false) return { cls: 4, rank: 2 };
  if (k === 'fins' || k === 'finrays' || (p.alpha ?? 1) < 1) return { cls: 5, rank: 1 };
  return { cls: 1, rank: 4 };
}

const hash3 = (x, y, z) => { let h = (x * 374761393 + y * 668265263 + z * 2147483647) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

/**
 * Voxelize pose parts. Returns new parts (meshes owned by the caller: dispose them when dropping the pose).
 */
export function voxelizeParts(parts, vs, o = {}) {
  const t0 = now();
  // bounds
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (const p of parts) {
    const d = p.mesh?.data;
    if (!d) continue;
    for (let i = 0; i < d.length; i += 11) {
      const x = d[i], y = d[i + 1], z = d[i + 2];
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z;
    }
  }
  if (!isFinite(x0)) return [];
  // keep the grid modest: grow the voxel if a model is huge for its size budget
  const maxDim = o.maxDim || 320;
  vs = Math.max(vs, (x1 - x0) / maxDim, (y1 - y0) / maxDim, (z1 - z0) / maxDim);
  const iv = 1 / vs;
  // the grid is aligned to multiples of vs (stable voxel positions from frame to frame)
  const ox = Math.floor(x0 * iv) - 2, oy = Math.floor(y0 * iv) - 2, oz = Math.floor(z0 * iv) - 2;
  const NX = Math.ceil(x1 * iv) - ox + 3, NY = Math.ceil(y1 * iv) - oy + 3, NZ = Math.ceil(z1 * iv) - oz + 3;
  const NXY = NX * NY, N = NXY * NZ;
  ensure(N);
  STAT.cells += N;
  // material per class (the options of the first part of that class)
  const mats = {};
  const dens = o.density ?? 1.8; // surface samples per voxel along a triangle edge
  // ---- surface sampling
  for (const p of parts) {
    const d = p.mesh?.data;
    if (!d) continue;
    const C = classify(p);
    if (!mats[C.cls]) mats[C.cls] = p;
    const tex = p.texture ? pixOf(p.texture) : null;
    const emitTex = !!p.emitTex;
    const baseEmit = C.cls === 3 ? 1 : (p.emit ?? 0);
    const rank = C.rank;
    const cl = C.cls;
    for (let i = 0; i < d.length; i += 33) {
      const ax = d[i] * iv - ox, ay = d[i + 1] * iv - oy, az = d[i + 2] * iv - oz;
      const bx = d[i + 11] * iv - ox, by = d[i + 12] * iv - oy, bz = d[i + 13] * iv - oz;
      const cx = d[i + 22] * iv - ox, cy = d[i + 23] * iv - oy, cz = d[i + 24] * iv - oz;
      const e1 = Math.max(Math.abs(bx - ax), Math.abs(by - ay), Math.abs(bz - az));
      const e2 = Math.max(Math.abs(cx - ax), Math.abs(cy - ay), Math.abs(cz - az));
      const e3 = Math.max(Math.abs(cx - bx), Math.abs(cy - by), Math.abs(cz - bz));
      const m = Math.max(1, Math.ceil(Math.max(e1, e2, e3) * dens));
      const im = 1 / m;
      STAT.samples += (m + 1) * (m + 2) / 2;
      for (let a = 0; a <= m; a++) {
        for (let b = 0; a + b <= m; b++) {
          const u = a * im, v = b * im, w = 1 - u - v;
          const px = ax * w + bx * u + cx * v, py = ay * w + by * u + cy * v, pz = az * w + bz * u + cz * v;
          const gx = px | 0, gy = py | 0, gz = pz | 0;
          const idx = gx + gy * NX + gz * NXY;
          const r0 = rnk[idx];
          if (r0 > rank) continue;
          let r = d[i + 6] * w + d[i + 17] * u + d[i + 28] * v;
          let g = d[i + 7] * w + d[i + 18] * u + d[i + 29] * v;
          let bl = d[i + 8] * w + d[i + 19] * u + d[i + 30] * v;
          let al = 1, em = baseEmit;
          if (tex) {
            const tu = d[i + 9] * w + d[i + 20] * u + d[i + 31] * v, tv = d[i + 10] * w + d[i + 21] * u + d[i + 32] * v;
            let tx = (tu * tex.w) | 0, ty = (tv * tex.h) | 0;
            if (tx < 0) tx = 0; else if (tx >= tex.w) tx = tex.w - 1;
            if (ty < 0) ty = 0; else if (ty >= tex.h) ty = tex.h - 1;
            const q = (ty * tex.w + tx) * 4;
            const ta = tex.d[q + 3] / 255;
            r *= tex.d[q] / 255; g *= tex.d[q + 1] / 255; bl *= tex.d[q + 2] / 255;
            if (emitTex) { const e = (1 - ta) * 2; if (e > em) em = e > 1 ? 1 : e; }
            else al = ta;
          }
          if (cl === 5 && al < 0.22) continue; // outside the fin outline
          // colours are alpha-weighted (dense fin rays dominate their voxels), alpha / emission are averaged
          if (r0 < rank) {
            rnk[idx] = rank; cls[idx] = cl;
            const k = idx * 6;
            acc[k] = r * al; acc[k + 1] = g * al; acc[k + 2] = bl * al; acc[k + 3] = al; acc[k + 4] = em; acc[k + 5] = 1;
          } else {
            const k = idx * 6;
            acc[k] += r * al; acc[k + 1] += g * al; acc[k + 2] += bl * al; acc[k + 3] += al; acc[k + 4] += em; acc[k + 5] += 1;
          }
        }
      }
    }
  }
  const tA = now();
  STAT.tS += tA - t0;
  // ---- natural eyes stamped onto the surface voxels: a dark pupil, a coloured iris ring with a darker limbus,
  // a catchlight voxel (big enough eyes)
  if (o.eyes) for (const e of o.eyes) stampEye(e, iv, ox, oy, oz, NX, NXY, NZ);
  // ---- outside: axis scans (cells before the first / after the last opaque voxel of every x, y and z line),
  // then a few relaxation sweeps over the remaining candidates (pockets reachable around a corner)
  const opq = (c) => c >= 1 && c <= 3;
  for (let z = 0; z < NZ; z++) for (let y = 0; y < NY; y++) {
    const base = y * NX + z * NXY;
    let f = 0; while (f < NX && !opq(cls[base + f])) ext[base + f++] = 1;
    if (f < NX) { let l = NX - 1; while (l > f && !opq(cls[base + l])) ext[base + l--] = 1; }
  }
  for (let z = 0; z < NZ; z++) for (let x = 0; x < NX; x++) {
    const base = x + z * NXY;
    let f = 0; while (f < NY && !opq(cls[base + f * NX])) ext[base + NX * f++] = 1;
    if (f < NY) { let l = NY - 1; while (l > f && !opq(cls[base + l * NX])) ext[base + NX * l--] = 1; }
  }
  for (let y = 0; y < NY; y++) for (let x = 0; x < NX; x++) {
    const base = x + y * NX;
    let f = 0; while (f < NZ && !opq(cls[base + f * NXY])) ext[base + NXY * f++] = 1;
    if (f < NZ) { let l = NZ - 1; while (l > f && !opq(cls[base + l * NXY])) ext[base + NXY * l--] = 1; }
  }
  let nc = 0;
  for (let i = 0; i < N; i++) if (!ext[i] && !opq(cls[i])) queue[nc++] = i;
  for (let pass = 0; pass < 4; pass++) {
    let changed = 0;
    for (let q = pass & 1 ? nc - 1 : 0; pass & 1 ? q >= 0 : q < nc; pass & 1 ? q-- : q++) {
      const i = queue[q];
      if (ext[i]) continue;
      if (ext[i - 1] || ext[i + 1] || ext[i - NX] || ext[i + NX] || ext[i - NXY] || ext[i + NXY]) { ext[i] = 1; changed++; }
    }
    if (!changed) break;
  }
  const tB = now();
  STAT.tF += tB - tA;
  // solid (occludes faces, darkens AO): opaque voxels and everything sealed inside
  // (ext doubles as the solid map from here on: 0 = solid, 1 = open)
  for (let q = 0; q < nc; q++) { const i = queue[q]; if (!ext[i]) ext[i] = 0; }
  // ---- faces
  const jit = o.jitter ?? 0.035;
  const aoK = o.ao ?? 1;
  const builders = [];
  const AO = [1 - 0.4 * aoK, 1 - 0.25 * aoK, 1 - 0.12 * aoK, 1];
  const col = [0, 0, 0];
  const SU = [NX, NXY, 1], SV = [NXY, 1, NX]; // u x v = +d for d = x, y, z
  const ST = [1, NX, NXY];
  for (let z = 1; z < NZ - 1; z++) for (let y = 1; y < NY - 1; y++) {
    const row = y * NX + z * NXY;
    for (let x = 1; x < NX - 1; x++) {
      const i = row + x;
      const c = cls[i];
      if (!c) continue;
      const isOp = c <= 3;
      // quick reject: no open neighbour
      if (isOp) { if (ext[i - 1] !== 1 && ext[i + 1] !== 1 && ext[i - NX] !== 1 && ext[i + NX] !== 1 && ext[i - NXY] !== 1 && ext[i + NXY] !== 1) continue; }
      const k = i * 6, n = acc[k + 5], sa = acc[k + 3] || 1e-6;
      col[0] = acc[k] / sa; col[1] = acc[k + 1] / sa; col[2] = acc[k + 2] / sa;
      const al = sa / n, em = acc[k + 4] / n;
      let kind = c;
      if (c === 1 && em >= 0.5) kind = 3;
      if (c === 5 && al >= 0.86) kind = 6;
      if (jit) { const jj = 1 + (hash3(x + ox, y + oy, z + oz) - 0.5) * 2 * jit; col[0] *= jj; col[1] *= jj; col[2] *= jj; }
      const fb = builders[kind] || (builders[kind] = new FaceBuf());
      for (let d = 0; d < 3; d++) {
        const st = ST[d];
        for (let sgn = -1; sgn <= 1; sgn += 2) {
          const j = i + sgn * st;
          const cj = cls[j];
          // opaque faces toward anything open; translucent faces toward open water (fins also toward glass)
          if (isOp ? ext[j] !== 1 : !(cj === 0 ? ext[j] === 1 : c === 5 && cj === 4)) continue;
          let a00 = 1, a10 = 1, a11 = 1, a01 = 1;
          if (isOp && aoK > 0) {
            const su = SU[d], sv = SV[d];
            const um = ext[j - su] !== 1 ? 1 : 0, up = ext[j + su] !== 1 ? 1 : 0, vm = ext[j - sv] !== 1 ? 1 : 0, vp = ext[j + sv] !== 1 ? 1 : 0;
            const mm = ext[j - su - sv] !== 1 ? 1 : 0, pm = ext[j + su - sv] !== 1 ? 1 : 0, pp = ext[j + su + sv] !== 1 ? 1 : 0, mp = ext[j - su + sv] !== 1 ? 1 : 0;
            a00 = AO[um && vm ? 0 : 3 - um - vm - mm]; a10 = AO[up && vm ? 0 : 3 - up - vm - pm];
            a11 = AO[up && vp ? 0 : 3 - up - vp - pp]; a01 = AO[um && vp ? 0 : 3 - um - vp - mp];
          }
          fb.face(x + ox, y + oy, z + oz, d, sgn, vs, col, a00, a10, a11, a01);
        }
      }
    }
  }
  STAT.tM += now() - tB;
  // ---- parts out (material options carried over from the source parts)
  const res = [];
  const strip = (p) => { if (!p) return {}; const { mesh, mb, texture, emitTex, key, ...rest } = p; return rest; };
  const bodyM = strip(mats[1] || mats[2] || mats[3]);
  const finM = strip(mats[5]);
  if (builders[1]) res.push({ key: 'body', mesh: builders[1].build(), ...bodyM, emit: 0, alpha: 1 });
  if (builders[2]) res.push({ key: 'eyes', mesh: builders[2].build(), spec: 1.2, shine: 70, env: 0.45, rim: 0.05, ambient: 0.62, ...strip(mats[2]), alpha: 1 });
  if (builders[3]) res.push({ key: 'glow', mesh: builders[3].build(), ...(mats[3] ? strip(mats[3]) : bodyM), emit: Math.max(0.8, mats[3]?.emit ?? 1), alpha: 1 });
  // voxel fins are closed boxes: back faces culled, so the alpha is the real see-through amount
  if (builders[6]) res.push({ key: 'finrays', mesh: builders[6].build(), ...finM, alpha: Math.min(0.92, (finM.alpha ?? 0.7) + 0.2), cull: true });
  if (builders[5]) res.push({ key: 'fins', mesh: builders[5].build(), ...finM, alpha: Math.min(0.62, finM.alpha ?? 0.6), cull: true });
  if (builders[4]) res.push({ key: 'glass', mesh: builders[4].build(), ...strip(mats[4]), cull: false, depthWrite: false });
  STAT.grids++;
  STAT.ms += now() - t0;
  return res;
}

/** One mesh -> one voxel mesh (all classes merged into the opaque body). */
export function voxelizeMesh(mesh, vs, opts = {}) {
  const parts = voxelizeParts([{ key: 'body', mesh, texture: opts.texture, emitTex: opts.emitTex }], vs, opts);
  return parts[0]?.mesh || null;
}

// Compact face list (6 int16 + 8 bytes per face: corner, axis / sign, colour, 4 AO levels) that expands into an
// ordinary LPMesh vertex buffer on demand. Pose caches keep only the compact form: release() drops the expanded
// floats and the GL buffer once a sprite sheet has been rendered (they are rebuilt in ~1 ms when needed again).
const CU = [[0, 1, 0], [0, 0, 1], [1, 0, 0]], CV = [[0, 0, 1], [1, 0, 0], [0, 1, 0]];
const ORD_P = [0, 1, 2, 0, 2, 3], ORD_PF = [1, 2, 3, 1, 3, 0], ORD_M = [0, 3, 2, 0, 2, 1], ORD_MF = [1, 0, 3, 1, 3, 2];
const CX = [0, 0, 0, 0], CY = [0, 0, 0, 0], CZ = [0, 0, 0, 0], CA = [0, 0, 0, 0];
const q8 = (v) => (v <= 0 ? 0 : v >= 1 ? 255 : Math.round(v * 255));
class FaceBuf {
  constructor() { this.pos = new Int16Array(3 * 512); this.meta = new Uint8Array(8 * 512); this.n = 0; }
  face(x, y, z, d, sgn, vs, col, a00, a10, a11, a01) {
    if ((this.n + 1) * 3 > this.pos.length) {
      const np = new Int16Array(this.pos.length * 2); np.set(this.pos); this.pos = np;
      const nm = new Uint8Array(this.meta.length * 2); nm.set(this.meta); this.meta = nm;
    }
    STAT.faces++;
    const i = this.n++;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    const m = this.meta, o = i * 8;
    m[o] = d * 2 + (sgn > 0 ? 1 : 0);
    m[o + 1] = q8(col[0] / 1.5); m[o + 2] = q8(col[1] / 1.5); m[o + 3] = q8(col[2] / 1.5); // headroom for bright tones
    m[o + 4] = q8(a00); m[o + 5] = q8(a10); m[o + 6] = q8(a11); m[o + 7] = q8(a01);
    this.vs = vs;
  }
  build() {
    const n = this.n, vs = this.vs || 1;
    const pos = this.pos.slice(0, n * 3), meta = this.meta.slice(0, n * 8);
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) { const q = pos[i * 3 + k]; if (q < min[k]) min[k] = q; if (q + 1 > max[k]) max[k] = q + 1; }
    if (!n) { min.fill(0); max.fill(0); }
    for (let k = 0; k < 3; k++) { min[k] *= vs; max[k] *= vs; }
    const center = [0, 1, 2].map((k) => (min[k] + max[k]) / 2);
    const radius = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2 || 1;
    return new VoxMesh(pos, meta, n, vs, { min, max, center, radius });
  }
}

export class VoxMesh extends LPMesh {
  constructor(pos, meta, nFaces, vs, bounds) {
    super(null, nFaces * 6, bounds);
    this.pos = pos; this.meta = meta; this.nFaces = nFaces; this.vs = vs; this.voxel = true;
  }
  get data() { return this._d || (this._d = expandFaces(this.pos, this.meta, this.nFaces, this.vs)); }
  set data(v) { this._d = v; }
  get bytes() { return this.pos.byteLength + this.meta.byteLength; }
  // once on the GPU, the expanded floats are dropped (they re-expand on demand: software fallback, merges)
  upload() { super.upload(); if (this.vao) this._d = null; }
  /** Drop the expanded vertex floats and the GL buffer (the compact faces stay). */
  release() { this.dispose(); this._d = null; }
}

/** Merge voxel meshes of the same voxel size into one (compact concat). */
export function mergeVox(list) {
  list = list.filter(Boolean);
  if (!list.length) return null;
  let n = 0;
  for (const m of list) n += m.nFaces;
  const pos = new Int16Array(n * 3), meta = new Uint8Array(n * 8);
  let o = 0;
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const m of list) {
    pos.set(m.pos.subarray(0, m.nFaces * 3), o * 3); meta.set(m.meta.subarray(0, m.nFaces * 8), o * 8); o += m.nFaces;
    for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], m.bounds.min[k]); max[k] = Math.max(max[k], m.bounds.max[k]); }
  }
  const center = [0, 1, 2].map((k) => (min[k] + max[k]) / 2);
  return new VoxMesh(pos, meta, n, list[0].vs, { min, max, center, radius: Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2 || 1 });
}

function expandFaces(pos, meta, n, vs) {
  const B = new Float32Array(n * 66);
  let o = 0;
  for (let i = 0; i < n; i++) {
    const mo = i * 8, ds = meta[mo], d = ds >> 1, sgn = ds & 1 ? 1 : -1;
    let x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    if (sgn > 0) { if (d === 0) x++; else if (d === 1) y++; else z++; }
    const u = CU[d], v = CV[d];
    CX[0] = x; CY[0] = y; CZ[0] = z;
    CX[1] = x + u[0]; CY[1] = y + u[1]; CZ[1] = z + u[2];
    CX[2] = x + u[0] + v[0]; CY[2] = y + u[1] + v[1]; CZ[2] = z + u[2] + v[2];
    CX[3] = x + v[0]; CY[3] = y + v[1]; CZ[3] = z + v[2];
    CA[0] = meta[mo + 4] / 255; CA[1] = meta[mo + 5] / 255; CA[2] = meta[mo + 6] / 255; CA[3] = meta[mo + 7] / 255;
    const flip = CA[0] + CA[2] < CA[1] + CA[3];
    const order = sgn > 0 ? (flip ? ORD_PF : ORD_P) : (flip ? ORD_MF : ORD_M);
    const nx = d === 0 ? sgn : 0, ny = d === 1 ? sgn : 0, nz = d === 2 ? sgn : 0;
    const r = (meta[mo + 1] / 255) * 1.5, g = (meta[mo + 2] / 255) * 1.5, b = (meta[mo + 3] / 255) * 1.5;
    for (let q = 0; q < 6; q++) {
      const k = order[q], a = CA[k];
      B[o] = CX[k] * vs; B[o + 1] = CY[k] * vs; B[o + 2] = CZ[k] * vs;
      B[o + 3] = nx; B[o + 4] = ny; B[o + 5] = nz;
      B[o + 6] = r * a; B[o + 7] = g * a; B[o + 8] = b * a;
      B[o + 9] = 0; B[o + 10] = 0;
      o += 11;
    }
  }
  return B;
}

const hexRGB01 = (h) => { const n = parseInt(String(h).slice(1, 7), 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; };
// Natural eye stamped onto the surface voxels around e.c (model point) facing e.n: pupil, iris ring (shaded under the
// orbit), dark limbus, a catchlight voxel when the eye is big enough.
function stampEye(e, iv, ox, oy, oz, NX, NXY, NZ) {
  const C = [e.c[0] * iv - ox, e.c[1] * iv - oy, e.c[2] * iv - oz];
  const R = Math.max(1.55, e.r * iv);
  const l = Math.hypot(e.n[0], e.n[1], e.n[2]) || 1;
  const n = [e.n[0] / l, e.n[1] / l, e.n[2] / l];
  let up = [-n[0] * n[1], 1 - n[1] * n[1], -n[2] * n[1]];
  const ul = Math.hypot(up[0], up[1], up[2]) || 1; up = [up[0] / ul, up[1] / ul, up[2] / ul];
  const fw = [up[1] * n[2] - up[2] * n[1], up[2] * n[0] - up[0] * n[2], up[0] * n[1] - up[1] * n[0]];
  const fs = fw[0] >= 0 ? 1 : -1; // forward = toward the snout (+x)
  const iris = hexRGB01(e.iris || '#c8a050');
  const glow = e.glow ? hexRGB01(e.glow) : null;
  const pr = Math.min(0.72, Math.max(0.42, e.pupil ?? 0.52));
  const span = Math.ceil(R + 1.5);
  let best = -1e9, bi = -1;
  const NY = NXY / NX;
  for (let dz = -span; dz <= span; dz++) for (let dy = -span; dy <= span; dy++) for (let dx = -span; dx <= span; dx++) {
    const x = Math.floor(C[0]) + dx, y = Math.floor(C[1]) + dy, z = Math.floor(C[2]) + dz;
    if (x < 1 || y < 1 || z < 1 || x >= NX - 1 || y >= NY - 1 || z >= NZ - 1) continue;
    const i = x + y * NX + z * NXY;
    const c = cls[i];
    if (c < 1 || c > 3) continue;
    const qx = x + 0.5 - C[0], qy = y + 0.5 - C[1], qz = z + 0.5 - C[2];
    const a = qx * n[0] + qy * n[1] + qz * n[2];
    if (a < -R * 0.9) continue;
    const vu = qx * up[0] + qy * up[1] + qz * up[2], vf = (qx * fw[0] + qy * fw[1] + qz * fw[2]) * fs;
    const rho = Math.hypot(vu, vf) / R;
    if (rho > 1.02) continue;
    let col;
    if (rho < pr) col = glow || [0.03, 0.035, 0.05];
    else if (rho < 0.86) { const k = (rho - pr) / (0.86 - pr); const t = vu > R * 0.35 ? 0.62 : 1.1 - k * 0.35; col = [iris[0] * t, iris[1] * t, iris[2] * t]; }
    else col = [iris[0] * 0.22 + 0.02, iris[1] * 0.22 + 0.025, iris[2] * 0.22 + 0.04];
    const k6 = i * 6;
    acc[k6] = col[0]; acc[k6 + 1] = col[1]; acc[k6 + 2] = col[2]; acc[k6 + 3] = 1; acc[k6 + 4] = glow && rho < pr ? 1 : 0; acc[k6 + 5] = 1;
    cls[i] = 2; rnk[i] = 6;
    const sc = a * 2 - Math.hypot(vu - R * 0.32, vf - R * 0.3) * 1.5;
    if (R >= 1.9 && sc > best) { best = sc; bi = i; }
  }
  if (bi >= 0) { const k6 = bi * 6; acc[k6] = 1; acc[k6 + 1] = 1; acc[k6 + 2] = 1; acc[k6 + 4] = 0.35; }
}
