// [icons15] DETAILED VOXEL icons, in the same style as the bait art (src/fishing/baitart.js): every 3D UI icon model
// (src/gfx/iconmeshes.js, icons3d.js, src/fishing/icons3d.js, rods, gems, decor, hand-built src/gfx/iconvox.js models)
// and every VoxelModel item / bait is turned into a HIGH-RES VoxelModel (about one voxel per 2 device pixels, up to
// 60 voxels along the longest side) and rendered by src/gfx/voxel.js renderVoxels: 7-step hue-shifted ramps, smooth
// glossy normals with a specular glint, vertex AO, crisp convex-edge highlights, interior depth lines, a dark outline
// and a soft drop shadow. Later mesh geometry wins a voxel (details painted over their base), `over` layers render as
// separate overlays, `glass` shells stay hollow and are composited translucent on top.
//
//   iconRes(px) -> voxels along the longest side for an icon drawn px device pixels wide
//   voxelizeLayers(def, res, rollZ = 0) -> {base, over, glass, c, vs} | null   mesh layers -> VoxelModels on one grid
//                                         (c = the model centre in grid units; rollZ turns the meshes about z first)
//   fitModel(m, res) -> VoxelModel     a VoxelModel majority-downsampled so its longest side is ~res (or m itself)
//   modelLayers(def, res) -> layers    the same layers object for VoxelModel sources (def.vm, vmOver?, vmGlass?)
//   layersExtent(L, yaw, pitch) -> {w, h}  projected extent (voxel units) at a view (radians, voxicon convention)
//   renderLayers(L, o) -> canvas       o: {S, s (px per voxel), yaw, pitch (radians), glassAlpha, T (outline px), shadow}
// View convention (as the mesh renderer): yaw turns x toward +z (renderVoxels yaw = -yaw), pitch > 0 looks down.
import { VoxelModel, renderVoxels } from './voxel.js';
import { makeCanvas, ctxOf } from '../core/canvas.js';
import { shade, mix, pack, unpack } from '../core/color.js';

const DEG = 180 / Math.PI;

/** Voxels along the longest side for a sprite `px` device pixels wide (~2.1 device px per voxel). */
export function iconRes(px) {
  return Math.max(10, Math.min(60, Math.round(px / 2.1)));
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

export const VOXICON_STATS = { n: 0, ms: 0, max: 0 };

// rotate vertex data about z (a copy) for z-axis spins
function rolled(mesh, a) {
  if (!mesh || !a) return mesh;
  const src = mesh.data, d = new Float32Array(src);
  const c = Math.cos(a), s = Math.sin(a);
  for (let i = 0; i < d.length; i += 11) for (const o of [0, 3]) {
    const x = src[i + o], y = src[i + o + 1];
    d[i + o] = x * c - y * s; d[i + o + 1] = x * s + y * c;
  }
  return { data: d };
}

// surface sampling of one mesh into the scratch grid: the latest triangle touching a voxel paints it
function sample(d, G) {
  const { iv, ox, oy, oz, NX, NXY } = G;
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
      const r = d[i + 6] * w + d[i + 17] * u + d[i + 28] * v, g = d[i + 7] * w + d[i + 18] * u + d[i + 29] * v, b = d[i + 8] * w + d[i + 19] * u + d[i + 30] * v;
      if (own[idx] === t) { colR[idx] += r; colG[idx] += g; colB[idx] += b; solid[idx]++; }
      else { own[idx] = t; colR[idx] = r; colG[idx] = g; colB[idx] = b; solid[idx] = 1; }
    }
  }
}

// outside = flood fill from the border (6-connected); solid codes: 0 unknown, 1 outside, 2 surface, 3 inside
function flood(NX, NY, NZ) {
  const NXY = NX * NY, N = NXY * NZ;
  for (let i = 0; i < N; i++) if (own[i] >= 0) { const n = solid[i] || 1; colR[i] /= n; colG[i] /= n; colB[i] /= n; solid[i] = 2; }
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
}

const hex2 = (v) => Math.max(0, Math.min(255, Math.round(v * 255))).toString(16).padStart(2, '0');

// the scratch grid -> a VoxelModel with a quantised palette (material per layer kind)
function toModel(NX, NY, NZ, kind, look = {}) {
  const N = NX * NY * NZ;
  const hollow = kind === 'glass';
  const sat = kind === 'glass' ? 1 : look.sat ?? 1.18;
  // palette: bucket colours (5 bits per channel, coarser when there are too many), bucket average = entry colour
  for (let i = 0; i < N; i++) {
    if (solid[i] !== 2) continue;
    const lum = colR[i] * 0.3 + colG[i] * 0.59 + colB[i] * 0.11;
    colR[i] = Math.min(1, Math.max(0, lum + (colR[i] - lum) * sat)); colG[i] = Math.min(1, Math.max(0, lum + (colG[i] - lum) * sat)); colB[i] = Math.min(1, Math.max(0, lum + (colB[i] - lum) * sat));
  }
  // bilateral colour smoothing over surface neighbours: the low-poly facet jitter melts into clean painted surfaces,
  // distinct details (eyes, stripes, labels) stay crisp
  if (kind !== 'glass' && look.smoothCol !== false) {
    const NXY = NX * NY, tr = new Float32Array(N), tg = new Float32Array(N), tb = new Float32Array(N);
    const thr = 0.1;
    for (let z = 1; z < NZ - 1; z++) for (let y = 1; y < NY - 1; y++) for (let x = 1; x < NX - 1; x++) {
      const i = x + y * NX + z * NXY;
      if (solid[i] !== 2) continue;
      const r0 = colR[i], g0 = colG[i], b0 = colB[i];
      let sr = r0 * 2, sg = g0 * 2, sb = b0 * 2, n = 2;
      for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const j = i + dx + dy * NX + dz * NXY;
        if (j === i || solid[j] !== 2) continue;
        const r = colR[j], g = colG[j], b = colB[j];
        if (Math.abs(r - r0) > thr || Math.abs(g - g0) > thr || Math.abs(b - b0) > thr) continue;
        sr += r; sg += g; sb += b; n++;
      }
      tr[i] = sr / n; tg[i] = sg / n; tb[i] = sb / n;
    }
    for (let i = 0; i < N; i++) if (solid[i] === 2 && tr[i] + tg[i] + tb[i] > 0) { colR[i] = tr[i]; colG[i] = tg[i]; colB[i] = tb[i]; }
  }
  let bits = 5, buckets;
  const keys = new Int32Array(N);
  for (;;) {
    buckets = new Map();
    const sh = 8 - bits;
    for (let i = 0; i < N; i++) {
      if (solid[i] !== 2) continue;
      const r = colR[i], g = colG[i], b = colB[i];
      const k = ((Math.round(r * 255) >> sh) << 16) | ((Math.round(g * 255) >> sh) << 8) | (Math.round(b * 255) >> sh);
      keys[i] = k;
      let e = buckets.get(k);
      if (!e) { e = [0, 0, 0, 0]; buckets.set(k, e); }
      e[0] += r; e[1] += g; e[2] += b; e[3]++;
    }
    if (buckets.size <= 240 || bits <= 2) break;
    bits--;
  }
  const m = new VoxelModel(NX, NY, NZ);
  const mat = kind === 'glass' ? { smooth: 0.85, spec: 1.3, specPow: 12, jitter: 0, aoMul: 0.4 }
    : { smooth: look.smooth ?? 0.55, spec: Math.max(0.75, look.spec ?? 0.85), specPow: look.specPow ?? 8, jitter: look.jitter ?? 0.04, edge: look.edge ?? 0.7 };
  const idx = new Map();
  for (const [k, e] of buckets) {
    if (idx.size >= 250) break;
    const n = e[3];
    idx.set(k, m.color('#' + hex2(e[0] / n) + hex2(e[1] / n) + hex2(e[2] / n), mat));
  }
  const data = m.data;
  let last = 1;
  for (let i = 0; i < N; i++) {
    const s = solid[i];
    if (s === 2) { last = idx.get(keys[i]) || last; data[i] = last; }
    else if (s === 0 && !hollow) data[i] = last; // sealed inside (never seen; keeps AO / normals solid)
  }
  return m;
}

/**
 * Mesh layers (def.mesh, def.over, def.glass) -> VoxelModels on one shared grid with `res` voxels along the longest
 * side of the whole model. rollZ (radians) turns the meshes about z first (z-axis spins).
 */
export function voxelizeLayers(def, res, rollZ = 0) {
  const t0 = performance.now();
  const meshes = [def.mesh, def.over, def.glass].map((m) => rolled(m, rollZ));
  const b0 = boundsOf([def.mesh, def.over, def.glass]); // unrolled bounds: the grid size stays the same for every roll
  const ext = Math.max(b0.max[0] - b0.min[0], b0.max[1] - b0.min[1], b0.max[2] - b0.min[2], 1e-3);
  const b = rollZ ? boundsOf(meshes) : b0;
  const vs = ext / res, iv = 1 / vs;
  const ox = Math.floor(b.min[0] * iv) - 2, oy = Math.floor(b.min[1] * iv) - 2, oz = Math.floor(b.min[2] * iv) - 2;
  const NX = Math.ceil(b.max[0] * iv) - ox + 3, NY = Math.ceil(b.max[1] * iv) - oy + 3, NZ = Math.ceil(b.max[2] * iv) - oz + 3;
  if (NX * NY * NZ > 2.2e6) return null;
  const NXY = NX * NY, N = NXY * NZ;
  const G = { iv, ox, oy, oz, NX, NXY };
  const out = { base: null, over: null, glass: null, vs };
  ['base', 'over', 'glass'].forEach((kind, li) => {
    const mesh = meshes[li];
    if (!mesh || !mesh.data || !mesh.data.length) return;
    ensure(N);
    sample(mesh.data, G);
    flood(NX, NY, NZ);
    out[kind] = toModel(NX, NY, NZ, kind, def.look || {});
  });
  // the model centre (the mesh origin: prepModel centres the meshes) in grid units
  out.c = [-ox, -oy, -oz];
  const dt = performance.now() - t0;
  VOXICON_STATS.n++; VOXICON_STATS.ms += dt; VOXICON_STATS.max = Math.max(VOXICON_STATS.max, dt);
  return out.base || out.over || out.glass ? out : null;
}

/** A VoxelModel majority-downsampled (integer factor) so its longest side is about `res` voxels. */
export function fitModel(m, res) {
  const big = Math.max(m.nx, m.ny, m.nz);
  if (big <= res * 1.3) return m;
  const f = Math.max(2, Math.floor(big / res));
  const bx = Math.ceil(m.nx / f), by = Math.ceil(m.ny / f), bz = Math.ceil(m.nz / f);
  const o = new VoxelModel(bx, by, bz);
  o.palette = m.palette.slice();
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
    o.data[x + bx * (y + by * z)] = best;
  }
  o.scaleF = f;
  return o;
}

/** Layers for VoxelModel sources: def.vm (+ optional def.vmOver / def.vmGlass of the same size), centred together. */
export function modelLayers(def, res) {
  const base = fitModel(def.vm, res);
  const over = def.vmOver ? fitModel(def.vmOver, res) : null, glass = def.vmGlass ? fitModel(def.vmGlass, res) : null;
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (const m of [base, over, glass]) {
    const b = m && m.bounds();
    if (!b) continue;
    x0 = Math.min(x0, b.x0); y0 = Math.min(y0, b.y0); z0 = Math.min(z0, b.z0); x1 = Math.max(x1, b.x1); y1 = Math.max(y1, b.y1); z1 = Math.max(z1, b.z1);
  }
  if (x1 < x0) { x0 = y0 = z0 = 0; x1 = base.nx - 1; y1 = base.ny - 1; z1 = base.nz - 1; }
  return { base, over, glass, c: [(x0 + x1 + 1) / 2, (y0 + y1 + 1) / 2, (z0 + z1 + 1) / 2] };
}

// projected 2D extent (voxel units) of all filled voxels at a view, about the layers' centre
export function layersExtent(L, yaw, pitch) {
  const Y = -yaw, cy = Math.cos(Y), sy = Math.sin(Y), cp = Math.cos(pitch), sp = Math.sin(pitch);
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const m of [L.base, L.over, L.glass]) {
    if (!m) continue;
    const { nx, ny, nz, data } = m;
    for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) {
      const row = nx * (y + ny * z);
      for (let x = 0; x < nx; x++) {
        if (!data[row + x]) continue;
        const px = x + 0.5 - L.c[0], py = y + 0.5 - L.c[1], pz = z + 0.5 - L.c[2];
        const X = px * cy - pz * sy;
        const V = -(px * -sp * sy + py * cp + pz * -sp * cy);
        if (X < x0) x0 = X; if (X > x1) x1 = X; if (V < y0) y0 = V; if (V > y1) y1 = V;
      }
    }
  }
  if (x1 < x0) return { w: 1, h: 1, cx: 0, cy: 0 };
  return { w: x1 - x0 + 1.2, h: y1 - y0 + 1.2, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
}

// one layer rendered and placed so the layers' centre lands at (ax, ay) of an S x S canvas
function place(g, m, L, o, extra = {}) {
  const r = renderVoxels(m, {
    scale: o.s, yaw: -o.yaw * DEG, pitch: o.pitch * DEG, outline: false, groundAO: false, glowRadius: 0,
    ao: 0.9, edges: 0.75, sideEdges: 0.45, ...extra,
  });
  const [px, py] = r.project(L.c[0], L.c[1], L.c[2]);
  g.drawImage(r.canvas, Math.round(o.ax - px), Math.round(o.ay - py));
}

const outlineCache = new Map();
function outlineOf(c) {
  let o = outlineCache.get(c);
  if (o === undefined) {
    const [r, g, b] = unpack(c);
    const hex = '#' + [r, g, b].map((q) => q.toString(16).padStart(2, '0')).join('');
    o = pack(mix(shade(hex, -0.8), '#120a26', 0.4)) >>> 0;
    if (outlineCache.size > 4096) outlineCache.clear();
    outlineCache.set(c, o);
  }
  return o;
}

/** Render the layers into an S x S canvas: base, `over` overlay, translucent glass, a dark outline, a soft shadow. */
export function renderLayers(L, o) {
  const S = o.S;
  const c = makeCanvas(S, S), g = ctxOf(c);
  const oo = { ...o, ax: S / 2 + (o.dx || 0), ay: S / 2 + (o.dy || 0) };
  if (L.base) place(g, L.base, L, oo);
  if (L.glass) {
    // clear glass: faint body, bright glints nearly opaque
    const gc = makeCanvas(S, S), gg = ctxOf(gc);
    place(gg, L.glass, L, oo, { depthLines: false, edges: 0.5, sideEdges: 0 });
    const gi = gg.getImageData(0, 0, S, S), gd = gi.data, a0 = Math.max(0.2, Math.min(0.36, (o.glassAlpha ?? 0.4) * 0.7));
    // glints = the brightest ~12% of the glass, the rim (silhouette edge) stays visible
    const hist = new Uint32Array(256);
    let tot = 0;
    for (let i = 0; i < gd.length; i += 4) if (gd[i + 3]) { hist[Math.round(gd[i] * 0.3 + gd[i + 1] * 0.59 + gd[i + 2] * 0.11)]++; tot++; }
    let acc = 0, thr = 255;
    for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc > tot * 0.12) { thr = v; break; } }
    for (let i = 0; i < gd.length; i += 4) {
      if (!gd[i + 3]) continue;
      const l = gd[i] * 0.3 + gd[i + 1] * 0.59 + gd[i + 2] * 0.11;
      const edge = !gd[i - 1] || !gd[i + 7] || !gd[i + 3 - S * 4] || !gd[i + 3 + S * 4];
      gd[i + 3] = Math.round(255 * (l >= thr ? 0.88 : edge ? 0.7 : a0));
    }
    gg.putImageData(gi, 0, 0);
    g.drawImage(gc, 0, 0);
  }
  // overlays (a fish in a bowl) read through the glass: drawn last with their own outline
  if (L.over) place(g, L.over, L, oo, { outline: true });
  // dark outline: ring 1 = the neighbour's colour deepened toward ink, ring 2+ (big renders) thickens it
  const img = g.getImageData(0, 0, S, S);
  const d = new Uint32Array(img.data.buffer);
  let cur = new Uint8Array(S * S);
  for (let i = 0; i < d.length; i++) { if ((d[i] >>> 24) > 60) cur[i] = 1; else d[i] = 0; }
  const T = o.T ?? 1;
  for (let ring = 0; ring < T; ring++) {
    const next = new Uint8Array(cur);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const i = y * S + x;
      if (cur[i]) continue;
      let n = -1;
      if (y > 0 && cur[i - S]) n = i - S; else if (x > 0 && cur[i - 1]) n = i - 1; else if (x < S - 1 && cur[i + 1]) n = i + 1; else if (y < S - 1 && cur[i + S]) n = i + S;
      if (n < 0) continue;
      d[i] = ring === 0 ? outlineOf((d[n] | 0xff000000) >>> 0) : d[n];
      next[i] = 1;
    }
    cur = next;
  }
  g.putImageData(img, 0, 0);
  if (o.shadow === false) return c;
  // soft drop shadow below-right
  const sh = makeCanvas(S, S), sg = ctxOf(sh);
  const sil = makeCanvas(S, S), sl = ctxOf(sil);
  sl.drawImage(c, 0, 0);
  sl.globalCompositeOperation = 'source-in'; sl.fillStyle = 'rgba(4,24,56,0.3)'; sl.fillRect(0, 0, S, S);
  const off = Math.max(1, T);
  try { sg.filter = `blur(${Math.max(1, T * 0.8)}px)`; } catch { /* no filter: hard shadow */ }
  sg.drawImage(sil, Math.round(off * 0.5), off + 1);
  sg.filter = 'none';
  sg.drawImage(c, 0, 0);
  return sh;
}
