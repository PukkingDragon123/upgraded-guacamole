// [phase10:ui] TOY-BLOCK VOXEL icons: every 3D UI icon model (src/gfx/iconmeshes.js, icons3d.js, src/fishing/icons3d.js,
// rods, gems, decor) and every VoxelModel item / bait is turned into a LOW-RES chunky voxel model (9..16 voxels along
// the longest side) before src/gfx/bigicons.js renders it: bold saturated colours, flat faces split into 2-3 flat shades
// (a bright band along convex top edges, a darker band along the bottom edge of sides), no gradients. bigicons adds the
// slight isometric 3/4 view, a thick dark outline and a soft drop shadow (finishToy).
// Later geometry wins a voxel (details painted over their base), `over` layers stay separate overlays, `glass`
// shells stay hollow and translucent.
//
//   voxelizeIconMesh(mesh, res, o?) -> LPMesh | null   o: {hollow (glass shell), vs (voxel edge, overrides res), sat, bands}
//   voxelModelMesh(voxelModel, maxRes = 16) -> LPMesh   a VoxelModel downsampled (majority colour) and meshed the same way
//   voxelEdge(def, res) -> vs                          one voxel edge for every layer of a model (so they line up)
//   iconRes(px) -> voxels along the longest side for an icon drawn px (device) pixels wide
import { LPMesh } from './lowpoly.js';

const hash3 = (x, y, z) => { let h = (x * 374761393 + y * 668265263 + z * 1274126177) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

/** Voxels along the longest side for a sprite `px` device pixels wide: LOW-RES chunky toy blocks, 9..16 voxels. */
export function iconRes(px) {
  return px <= 40 ? 9 : px <= 80 ? 11 : px <= 130 ? 13 : 16;
}

function boundsOf(meshes) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const m of meshes) {
    if (!m) continue;
    const d = m.data;
    for (let i = 0; i < d.length; i += 11) for (let k = 0; k < 3; k++) { const q = d[i + k]; if (q < min[k]) min[k] = q; if (q > max[k]) max[k] = q; }
  }
  return { min, max };
}

export function voxelEdge(def, res) {
  const b = boundsOf([def.mesh, def.over, def.glass]);
  const ext = Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2], 1e-3);
  return ext / res;
}

// scratch
let CAP = 0, own, colR, colG, colB, solid, queue;
function ensure(n) {
  if (n > CAP) {
    CAP = Math.ceil(n * 1.3);
    own = new Int32Array(CAP); colR = new Float32Array(CAP); colG = new Float32Array(CAP); colB = new Float32Array(CAP);
    solid = new Uint8Array(CAP); queue = new Int32Array(CAP);
  }
  own.fill(-1, 0, n); solid.fill(0, 0, n);
}

const CU = [[0, 1, 0], [0, 0, 1], [1, 0, 0]], CV = [[0, 0, 1], [1, 0, 0], [0, 1, 0]];

/**
 * One icon layer -> a voxel LPMesh (plain float vertex data, 11 floats per vertex like MeshBuilder output).
 * Voxel positions are aligned to multiples of vs in model space, so layers of the same model line up.
 */
export const VOXICON_STATS = { n: 0, ms: 0, max: 0 };
export function voxelizeIconMesh(mesh, res, o = {}) {
  const t0 = performance.now();
  const r = voxelizeIconMesh0(mesh, res, o);
  const dt = performance.now() - t0;
  VOXICON_STATS.n++; VOXICON_STATS.ms += dt; VOXICON_STATS.max = Math.max(VOXICON_STATS.max, dt);
  return r;
}
function voxelizeIconMesh0(mesh, res, o = {}) {
  const d = mesh?.data;
  if (!d || !d.length) return null;
  const b = boundsOf([mesh]);
  const vs = o.vs || Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2], 1e-3) / res;
  const iv = 1 / vs;
  const ox = Math.floor(b.min[0] * iv) - 2, oy = Math.floor(b.min[1] * iv) - 2, oz = Math.floor(b.min[2] * iv) - 2;
  const NX = Math.ceil(b.max[0] * iv) - ox + 3, NY = Math.ceil(b.max[1] * iv) - oy + 3, NZ = Math.ceil(b.max[2] * iv) - oz + 3;
  if (NX * NY * NZ > 2.2e6) return null;
  const NXY = NX * NY, N = NXY * NZ;
  ensure(N);
  // ---- surface sampling: the latest triangle touching a voxel paints it (details drawn after their base win)
  const nTri = d.length / 33;
  for (let t = 0; t < nTri; t++) {
    const i = t * 33;
    const ax = d[i] * iv - ox, ay = d[i + 1] * iv - oy, az = d[i + 2] * iv - oz;
    const bx = d[i + 11] * iv - ox, by = d[i + 12] * iv - oy, bz = d[i + 13] * iv - oz;
    const cx = d[i + 22] * iv - ox, cy = d[i + 23] * iv - oy, cz = d[i + 24] * iv - oz;
    const e = Math.max(Math.abs(bx - ax), Math.abs(by - ay), Math.abs(bz - az), Math.abs(cx - ax), Math.abs(cy - ay), Math.abs(cz - az), Math.abs(cx - bx), Math.abs(cy - by), Math.abs(cz - bz));
    const m = Math.max(1, Math.ceil(e * 2.2));
    const im = 1 / m;
    for (let a = 0; a <= m; a++) for (let bb = 0; a + bb <= m; bb++) {
      const u = a * im, v = bb * im, w = 1 - u - v;
      const gx = (ax * w + bx * u + cx * v) | 0, gy = (ay * w + by * u + cy * v) | 0, gz = (az * w + bz * u + cz * v) | 0;
      const idx = gx + gy * NX + gz * NXY;
      if (own[idx] === t) {
        colR[idx] += d[i + 6] * w + d[i + 17] * u + d[i + 28] * v; colG[idx] += d[i + 7] * w + d[i + 18] * u + d[i + 29] * v; colB[idx] += d[i + 8] * w + d[i + 19] * u + d[i + 30] * v;
        solid[idx]++;
      } else {
        own[idx] = t;
        colR[idx] = d[i + 6] * w + d[i + 17] * u + d[i + 28] * v; colG[idx] = d[i + 7] * w + d[i + 18] * u + d[i + 29] * v; colB[idx] = d[i + 8] * w + d[i + 19] * u + d[i + 30] * v;
        solid[idx] = 1;
      }
    }
  }
  // normalise the colours (samples of the owning triangle averaged), mark surface voxels (2)
  for (let i = 0; i < N; i++) if (own[i] >= 0) { const n = solid[i] || 1; colR[i] /= n; colG[i] /= n; colB[i] /= n; solid[i] = 2; }
  // ---- outside = flood fill from the border (6-connected); solid = surface + sealed inside (not for hollow glass)
  // solid codes: 0 unknown, 1 outside, 2 surface, 3 inside
  let qh = 0, qt = 0;
  const push = (i) => { if (solid[i] === 0) { solid[i] = 1; queue[qt++] = i; } };
  for (let z = 0; z < NZ; z++) for (let y = 0; y < NY; y++) { push(y * NX + z * NXY); push(NX - 1 + y * NX + z * NXY); }
  for (let z = 0; z < NZ; z++) for (let x = 0; x < NX; x++) { push(x + z * NXY); push(x + (NY - 1) * NX + z * NXY); }
  for (let y = 0; y < NY; y++) for (let x = 0; x < NX; x++) { push(x + y * NX); push(x + y * NX + (NZ - 1) * NXY); }
  while (qh < qt) {
    const i = queue[qh++];
    const x = i % NX, y = ((i / NX) | 0) % NY, z = (i / NXY) | 0;
    if (x > 0) push(i - 1); if (x < NX - 1) push(i + 1);
    if (y > 0) push(i - NX); if (y < NY - 1) push(i + NX);
    if (z > 0) push(i - NXY); if (z < NZ - 1) push(i + NXY);
  }
  return meshGrid(NX, NY, NZ, ox, oy, oz, vs, o);
}

// ---------------------------------------------------------------------------------------------- the toy-block mesher
// Every exposed cube face is split into up to 3 x 3 flat sub-quads: a plain face, a bright highlight band along its
// convex top edges (all convex edges on top faces) and a darker band along the bottom edge of side faces, so each
// voxel reads as a little bevelled toy block with 2-3 flat shades and no gradients. Colours are pushed to a bold,
// saturated palette.
const W_HL = 0.2, K_HL = 1.3, K_SH = 0.74;
function meshGrid(NX, NY, NZ, ox, oy, oz, vs, o = {}) {
  const NXY = NX * NY, N = NXY * NZ;
  const hollow = !!o.hollow;
  // outside = flood fill from the border (6-connected); solid codes: 0 unknown, 1 outside, 2 surface, 3 inside
  let qh = 0, qt = 0;
  const push = (i) => { if (solid[i] === 0) { solid[i] = 1; queue[qt++] = i; } };
  for (let z = 0; z < NZ; z++) for (let y = 0; y < NY; y++) { push(y * NX + z * NXY); push(NX - 1 + y * NX + z * NXY); }
  for (let z = 0; z < NZ; z++) for (let x = 0; x < NX; x++) { push(x + z * NXY); push(x + (NY - 1) * NX + z * NXY); }
  for (let y = 0; y < NY; y++) for (let x = 0; x < NX; x++) { push(x + y * NX); push(x + y * NX + (NZ - 1) * NXY); }
  while (qh < qt) {
    const i = queue[qh++];
    const x = i % NX, y = ((i / NX) | 0) % NY, z = (i / NXY) | 0;
    if (x > 0) push(i - 1); if (x < NX - 1) push(i + 1);
    if (y > 0) push(i - NX); if (y < NY - 1) push(i + NX);
    if (z > 0) push(i - NXY); if (z < NZ - 1) push(i + NXY);
  }
  // hollow shells (glass): the sealed inside stays empty (4) and gets no faces, so only the outer skin shows
  for (let i = 0; i < N; i++) if (solid[i] === 0) solid[i] = hollow ? 4 : 3;
  const filled = (i) => solid[i] === 2 || solid[i] === 3;
  const jit = o.jitter ?? 0.025, sat = o.sat ?? 1.38, bands = o.bands !== false;
  const ST = [1, NX, NXY];
  let nf = 0;
  let A = new Float32Array(66 * 512);
  const quad = (P0, U, V, u0, u1, v0, v1, n, sgn, r, g, b) => {
    if ((nf + 1) * 66 > A.length) { const na = new Float32Array(A.length * 2); na.set(A); A = na; }
    const C = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
    const ord = sgn > 0 ? [0, 1, 2, 0, 2, 3] : [0, 3, 2, 0, 2, 1];
    let p = nf * 66;
    for (const k of ord) {
      const [a, c] = C[k];
      A[p] = (P0[0] + U[0] * a + V[0] * c) * vs; A[p + 1] = (P0[1] + U[1] * a + V[1] * c) * vs; A[p + 2] = (P0[2] + U[2] * a + V[2] * c) * vs;
      A[p + 3] = n[0]; A[p + 4] = n[1]; A[p + 5] = n[2];
      A[p + 6] = r; A[p + 7] = g; A[p + 8] = b; A[p + 9] = 0; A[p + 10] = 0;
      p += 11;
    }
    nf++;
  };
  const P0 = [0, 0, 0];
  for (let z = 1; z < NZ - 1; z++) for (let y = 1; y < NY - 1; y++) for (let x = 1; x < NX - 1; x++) {
    const i = x + y * NX + z * NXY;
    if (solid[i] !== 2) continue;
    const jj = 1 + (hash3(x + ox, y + oy, z + oz) - 0.5) * 2 * jit;
    const lum = colR[i] * 0.3 + colG[i] * 0.59 + colB[i] * 0.11;
    const r = Math.max(0, lum + (colR[i] - lum) * sat) * jj, g = Math.max(0, lum + (colG[i] - lum) * sat) * jj, bl = Math.max(0, lum + (colB[i] - lum) * sat) * jj;
    for (let dd = 0; dd < 3; dd++) {
      const st = ST[dd];
      for (let sgn = -1; sgn <= 1; sgn += 2) {
        const j = i + sgn * st;
        if (solid[j] !== 1) continue; // only faces toward the outside
        const U = CU[dd], V = CV[dd];
        const su = U[0] + U[1] * NX + U[2] * NXY, sv = V[0] + V[1] * NX + V[2] * NXY;
        const conv = (s) => !filled(i + s) && !filled(j + s); // a convex edge of this face toward in-plane step s
        // edge kinds per side (0 none, 1 highlight, 2 shade): -u, +u, -v, +v
        const ek = [0, 0, 0, 0];
        if (bands) {
          const top = dd === 1 && sgn > 0, side = dd !== 1;
          const sides = [[-su, U, -1], [su, U, 1], [-sv, V, -1], [sv, V, 1]];
          for (let e = 0; e < 4; e++) {
            const [s, ax, dir] = sides[e];
            if (!conv(s)) continue;
            if (top) ek[e] = 1;
            else if (side && ax[1]) ek[e] = dir > 0 ? 1 : 2; // the in-plane axis is y: top edge lit, bottom edge shaded
          }
        }
        const uu = [0, ek[0] ? W_HL : 0, ek[1] ? 1 - W_HL : 1, 1], vv = [0, ek[2] ? W_HL : 0, ek[3] ? 1 - W_HL : 1, 1];
        P0[0] = x + ox; P0[1] = y + oy; P0[2] = z + oz;
        if (sgn > 0) P0[dd] += 1;
        const n = [dd === 0 ? sgn : 0, dd === 1 ? sgn : 0, dd === 2 ? sgn : 0];
        for (let a = 0; a < 3; a++) for (let c = 0; c < 3; c++) {
          const u0 = uu[a], u1 = uu[a + 1], v0 = vv[c], v1 = vv[c + 1];
          if (u1 - u0 < 1e-4 || v1 - v0 < 1e-4) continue;
          const kinds = [a === 0 ? ek[0] : 0, a === 2 ? ek[1] : 0, c === 0 ? ek[2] : 0, c === 2 ? ek[3] : 0];
          const k = kinds.includes(1) ? K_HL : kinds.includes(2) ? K_SH : 1;
          const lift = k > 1 ? 0.06 : 0;
          quad(P0, U, V, u0, u1, v0, v1, n, sgn, r * k + lift, g * k + lift, bl * k + lift);
        }
      }
    }
  }
  if (!nf) return null;
  const data = A.slice(0, nf * 66);
  const bb = boundsOf([{ data }]);
  const center = [0, 1, 2].map((k) => (bb.min[k] + bb.max[k]) / 2);
  const radius = Math.hypot(bb.max[0] - bb.min[0], bb.max[1] - bb.min[1], bb.max[2] - bb.min[2]) / 2 || 1;
  const mOut = new LPMesh(data, nf * 6, { min: bb.min, max: bb.max, center, radius });
  mOut.voxel = true; mOut.vs = vs;
  return mOut;
}

/**
 * A VoxelModel (src/gfx/voxel.js: item, bait art) -> a toy-block LPMesh about -1..1, downsampled (majority colour) so
 * the longest side has at most maxRes voxels.
 */
export function voxelModelMesh(m, maxRes = 16) {
  const big = Math.max(m.nx, m.ny, m.nz);
  const f = Math.max(1, Math.ceil(big / maxRes));
  const bx = Math.ceil(m.nx / f), by = Math.ceil(m.ny / f), bz = Math.ceil(m.nz / f);
  const NX = bx + 4, NY = by + 4, NZ = bz + 4, NXY = NX * NY;
  ensure(NXY * NZ);
  const cols = m.palette.map((pe) => (pe ? hexRGB(pe.color, pe.emissive ? 1.25 : 1) : null));
  const need = Math.max(1, Math.round(f * f * f * 0.3));
  const cnt = new Map();
  for (let z = 0; z < bz; z++) for (let y = 0; y < by; y++) for (let x = 0; x < bx; x++) {
    cnt.clear();
    let tot = 0;
    for (let dz = 0; dz < f; dz++) for (let dy = 0; dy < f; dy++) for (let dx = 0; dx < f; dx++) {
      const c = m.get(x * f + dx, y * f + dy, z * f + dz);
      if (c) { tot++; cnt.set(c, (cnt.get(c) || 0) + 1); }
    }
    if (tot < need) continue;
    let best = 0, bc = 0;
    for (const [c, n] of cnt) if (n > bc) { bc = n; best = c; }
    const col = cols[best];
    if (!col) continue;
    const i = (x + 2) + (y + 2) * NX + (z + 2) * NXY;
    colR[i] = col[0]; colG[i] = col[1]; colB[i] = col[2]; solid[i] = 2;
  }
  const vs = 2 / Math.max(bx, by, bz);
  const ox = -2 - bx / 2, oy = -2 - by / 2, oz = -2 - bz / 2;
  return meshGrid(NX, NY, NZ, ox, oy, oz, vs, {});
}
function hexRGB(h, k = 1) {
  const n = parseInt(String(h).replace('#', '').slice(0, 6), 16);
  return [Math.min(1.4, (((n >> 16) & 255) / 255) * k), Math.min(1.4, (((n >> 8) & 255) / 255) * k), Math.min(1.4, ((n & 255) / 255) * k)];
}
