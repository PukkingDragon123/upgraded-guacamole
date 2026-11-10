// [phase10:ui] VOXEL icons: every 3D UI icon model (src/gfx/iconmeshes.js, icons3d.js, src/fishing/icons3d.js, rods,
// rarity gems) is turned into a real voxel model before it is rendered (src/gfx/bigicons.js renderDef): the low-poly
// surfaces are sampled into a grid (`res` voxels along the longest side), the inside is filled, and only the visible
// cube faces are meshed, with
//   - baked ambient occlusion in every crease (MagicaVoxel-style corner AO),
//   - bevel edge highlights on convex voxel edges (the lit "chunky block" edge of pixel-art voxels),
//   - a little per-voxel tone jitter (hand-placed feel) and a slight colour ramp (cool shadows, warm lights).
// Later geometry wins a voxel (details painted over their base), `over` layers stay separate overlays, `glass`
// shells stay hollow and translucent.
//
//   voxelizeIconMesh(mesh, res, o?) -> LPMesh | null   o: {hollow (glass shell), vs (voxel edge, overrides res), ao, hl}
//   voxelEdge(def, res) -> vs                          one voxel edge for every layer of a model (so they line up)
//   iconRes(px) -> voxels along the longest side for an icon drawn px (device) pixels wide
import { LPMesh } from './lowpoly.js';

const hash3 = (x, y, z) => { let h = (x * 374761393 + y * 668265263 + z * 1274126177) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

/** Voxels along the longest side for a sprite `px` device pixels wide: ~2.9 px per voxel, a few fixed steps. */
export function iconRes(px) {
  const r = px / 2.9;
  const steps = [14, 18, 22, 26, 30, 34, 40, 46, 52];
  for (const s of steps) if (r <= s) return s;
  return steps[steps.length - 1];
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
  const hollow = !!o.hollow;
  // hollow shells (glass): the sealed inside stays empty (4) and gets no faces, so only the outer skin shows
  for (let i = 0; i < N; i++) if (solid[i] === 0) solid[i] = hollow ? 4 : 3;
  const filled = (i) => solid[i] === 2 || solid[i] === 3;
  // ---- faces
  const aoK = o.ao ?? 1, hl = o.hl ?? 0.17, jit = o.jitter ?? 0.03, sat = o.sat ?? 1.22;
  const AO = [1 - 0.42 * aoK, 1 - 0.26 * aoK, 1 - 0.12 * aoK, 1];
  const ST = [1, NX, NXY];
  const out = [];
  let nf = 0;
  const cap = { a: new Float32Array(66 * 1024) };
  const emit = (vals) => {
    if ((nf + 1) * 66 > cap.a.length) { const na = new Float32Array(cap.a.length * 2); na.set(cap.a); cap.a = na; }
    cap.a.set(vals, nf * 66); nf++;
  };
  const F = new Float32Array(66);
  const cx = [0, 0, 0, 0], cy = [0, 0, 0, 0], cz = [0, 0, 0, 0], ca = [0, 0, 0, 0];
  for (let z = 1; z < NZ - 1; z++) for (let y = 1; y < NY - 1; y++) for (let x = 1; x < NX - 1; x++) {
    const i = x + y * NX + z * NXY;
    if (solid[i] !== 2) continue;
    // colour: per-voxel tone jitter
    const jj = 1 + (hash3(x + ox, y + oy, z + oz) - 0.5) * 2 * jit;
    // a voxel-art palette: saturation pushed up a little around the voxel's own luminance
    const lum = colR[i] * 0.3 + colG[i] * 0.59 + colB[i] * 0.11;
    const r = Math.max(0, lum + (colR[i] - lum) * sat) * jj, g = Math.max(0, lum + (colG[i] - lum) * sat) * jj, bl = Math.max(0, lum + (colB[i] - lum) * sat) * jj;
    for (let dd = 0; dd < 3; dd++) {
      const st = ST[dd];
      for (let sgn = -1; sgn <= 1; sgn += 2) {
        const j = i + sgn * st;
        if (solid[j] !== 1) continue; // only faces toward the outside
        const u = CU[dd], v = CV[dd];
        const su = u[0] + u[1] * NX + u[2] * NXY, sv = v[0] + v[1] * NX + v[2] * NXY;
        // AO from the open layer in front of the face; edge highlight where the voxel's own in-plane neighbour is open
        const um = filled(j - su), up = filled(j + su), vm = filled(j - sv), vp = filled(j + sv);
        const mm = filled(j - su - sv), pm = filled(j + su - sv), pp = filled(j + su + sv), mp = filled(j - su + sv);
        const eum = !filled(i - su) && !um, eup = !filled(i + su) && !up, evm = !filled(i - sv) && !vm, evp = !filled(i + sv) && !vp;
        const aoc = (a, bq, c) => AO[a && bq ? 0 : 3 - a - bq - c];
        const H = (e1, e2) => 1 + hl * ((e1 ? 1 : 0) + (e2 ? 1 : 0)) * (sgn > 0 && dd === 1 ? 1.25 : dd === 1 ? 0.4 : 1);
        ca[0] = aoc(um, vm, mm) * H(eum, evm);
        ca[1] = aoc(up, vm, pm) * H(eup, evm);
        ca[2] = aoc(up, vp, pp) * H(eup, evp);
        ca[3] = aoc(um, vp, mp) * H(eum, evp);
        let X = x, Y = y, Z = z;
        if (sgn > 0) { if (dd === 0) X++; else if (dd === 1) Y++; else Z++; }
        cx[0] = X; cy[0] = Y; cz[0] = Z;
        cx[1] = X + u[0]; cy[1] = Y + u[1]; cz[1] = Z + u[2];
        cx[2] = X + u[0] + v[0]; cy[2] = Y + u[1] + v[1]; cz[2] = Z + u[2] + v[2];
        cx[3] = X + v[0]; cy[3] = Y + v[1]; cz[3] = Z + v[2];
        const flip = ca[0] + ca[2] < ca[1] + ca[3];
        const ord = sgn > 0 ? (flip ? [1, 2, 3, 1, 3, 0] : [0, 1, 2, 0, 2, 3]) : (flip ? [1, 0, 3, 1, 3, 2] : [0, 3, 2, 0, 2, 1]);
        const nx = dd === 0 ? sgn : 0, ny = dd === 1 ? sgn : 0, nz = dd === 2 ? sgn : 0;
        let p = 0;
        for (let q = 0; q < 6; q++) {
          const k = ord[q], a = ca[k];
          F[p] = (cx[k] + ox) * vs; F[p + 1] = (cy[k] + oy) * vs; F[p + 2] = (cz[k] + oz) * vs;
          F[p + 3] = nx; F[p + 4] = ny; F[p + 5] = nz;
          F[p + 6] = r * a; F[p + 7] = g * a; F[p + 8] = bl * a;
          F[p + 9] = 0; F[p + 10] = 0;
          p += 11;
        }
        emit(F);
      }
    }
  }
  if (!nf) return null;
  const data = cap.a.slice(0, nf * 66);
  const bb = boundsOf([{ data }]);
  const center = [0, 1, 2].map((k) => (bb.min[k] + bb.max[k]) / 2);
  const radius = Math.hypot(bb.max[0] - bb.min[0], bb.max[1] - bb.min[1], bb.max[2] - bb.min[2]) / 2 || 1;
  out.length = 0;
  const mOut = new LPMesh(data, nf * 6, { min: bb.min, max: bb.max, center, radius });
  mOut.voxel = true; mOut.vs = vs;
  return mOut;
}
