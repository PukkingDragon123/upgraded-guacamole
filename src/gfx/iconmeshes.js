// Low-poly 3D models for the HUD / menu icons (phase 6, UI agent). Chunky, glossy Frutiger Aero objects built
// from a few faceted primitives; src/gfx/bigicons.js renders them once per (size, angle) with src/gfx/lowpoly.js
// and caches the sprites. Units: roughly -1..1, y up, x right, +z toward the camera.
//
//   ICON_MODELS { id: () => {mesh, over?: mesh (drawn on top), glass?: mesh (translucent, last), glassAlpha?, yaw, pitch,
//                 spin: 'full'|'wobble', spinAxis?: 'y'|'z', look?: {spec, shine, ...}} }
//   ROD_MODEL(rod) -> model           a fishing rod from rod.look {shaft, grip, reel, tip, glow, kind} (gear pod, Lab)
//   GEM_MODEL(color) -> model         a cut gem (rarity icons)
// Toolkit (exported for other icon makers): lathe, prism, ringPrism, sphere, tube, box, face

import { MeshBuilder } from './lowpoly.js';
import { mix, shade } from '../core/color.js';
import { hash1 } from '../core/math.js';

// ---------------------------------------------------------------- toolkit
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const crs = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const nrm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

// One flat polygon (3 or 4 points), wound so its normal points away from `inside`.
export function face(mb, pts, col, inside) {
  const n = crs(sub(pts[1], pts[0]), sub(pts[2], pts[0]));
  if (inside) {
    const c = pts.reduce((s, p) => [s[0] + p[0] / pts.length, s[1] + p[1] / pts.length, s[2] + p[2] / pts.length], [0, 0, 0]);
    if (dot(n, sub(c, inside)) < 0) pts = pts.slice().reverse();
  }
  if (pts.length === 3) mb.tri(pts[0], pts[1], pts[2], col);
  else mb.quad(pts[0], pts[1], pts[2], pts[3], col);
}

// small per-facet lightness wobble: the hand-painted low-poly look
export const jit = (hex, i, k = 0.06) => shade(hex, (hash1(i, 913) - 0.5) * 2 * k);

// Revolve a profile [[r, y], ...] (bottom to top) around a vertical axis at (x, z). col(i, j) | colour.
export function lathe(mb, prof, seg, col, o = {}) {
  const cx = o.x || 0, cy = o.y || 0, cz = o.z || 0, a0 = o.a0 ?? Math.PI / seg;
  const ring = ([r, y]) => Array.from({ length: seg }, (_, j) => {
    const a = a0 + (j / seg) * Math.PI * 2;
    return [cx + Math.cos(a) * r, cy + y, cz + Math.sin(a) * r];
  });
  const rings = prof.map(ring);
  const C = (i, j) => (typeof col === 'function' ? col(i, j) : col);
  for (let i = 0; i < prof.length - 1; i++) {
    const ym = cy + (prof[i][1] + prof[i + 1][1]) / 2;
    const inner = (o.inside ? -1 : 1);
    for (let j = 0; j < seg; j++) {
      const j2 = (j + 1) % seg;
      const a = rings[i][j], b = rings[i][j2], c = rings[i + 1][j2], d = rings[i + 1][j];
      const mid = [(a[0] + c[0]) / 2, ym, (a[2] + c[2]) / 2];
      const axis = [cx, ym, cz];
      // "inside" hint: a point on the axis (or outside it, for inward-facing walls)
      const hint = inner > 0 ? axis : [mid[0] * 2 - cx, ym, mid[2] * 2 - cz];
      if (prof[i][0] < 1e-4) face(mb, [a, c, d], C(i, j), hint);
      else if (prof[i + 1][0] < 1e-4) face(mb, [a, b, c], C(i, j), hint);
      else face(mb, [a, b, c, d], C(i, j), hint);
    }
  }
  if (o.capBottom && prof[0][0] > 0) for (let j = 0; j < seg; j++) face(mb, [[cx, cy + prof[0][1], cz], rings[0][j], rings[0][(j + 1) % seg]], C(0, j), [cx, cy + prof[0][1] + 1, cz]);
  const L = prof.length - 1;
  if (o.capTop && prof[L][0] > 0) for (let j = 0; j < seg; j++) face(mb, [[cx, cy + prof[L][1], cz], rings[L][j], rings[L][(j + 1) % seg]], o.capCol || C(L - 1, j), [cx, cy + prof[L][1] - 1, cz]);
  return mb;
}

function area2(p) { let a = 0; for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length]; a += p[i][0] * q[1] - q[0] * p[i][1]; } return a; }
function inTri(p, a, b, c) {
  const s = (p1, p2, p3) => (p1[0] - p3[0]) * (p2[1] - p3[1]) - (p2[0] - p3[0]) * (p1[1] - p3[1]);
  const d1 = s(p, a, b), d2 = s(p, b, c), d3 = s(p, c, a);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
}
// ear clipping for a simple CCW polygon -> index triples
function earcut(poly) {
  const idx = poly.map((_, i) => i), out = [];
  const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  let guard = 0;
  while (idx.length > 3 && guard++ < 4000) {
    let cut = false;
    for (let i = 0; i < idx.length; i++) {
      const i0 = idx[(i + idx.length - 1) % idx.length], i1 = idx[i], i2 = idx[(i + 1) % idx.length];
      const a = poly[i0], b = poly[i1], c = poly[i2];
      if (cross(a, b, c) <= 1e-9) continue;
      if (idx.some((j) => j !== i0 && j !== i1 && j !== i2 && inTri(poly[j], a, b, c))) continue;
      out.push([i0, i1, i2]); idx.splice(i, 1); cut = true; break;
    }
    if (!cut) break;
  }
  if (idx.length === 3) out.push(idx.slice());
  return out;
}

// Extrude a 2D outline [[x, y], ...] between z0 and z1. o: {front, side, back, sideFn(i)}
export function prism(mb, outline, z0, z1, col, o = {}) {
  let p = outline;
  if (area2(p) < 0) p = p.slice().reverse();
  const front = o.front || col, back = o.back || shade(col, -0.2), side = o.side || shade(col, -0.12);
  for (const [a, b, c] of earcut(p)) {
    mb.tri([p[a][0], p[a][1], z1], [p[b][0], p[b][1], z1], [p[c][0], p[c][1], z1], typeof front === 'function' ? front(a) : front);
    mb.tri([p[a][0], p[a][1], z0], [p[c][0], p[c][1], z0], [p[b][0], p[b][1], z0], back);
  }
  for (let i = 0; i < p.length; i++) {
    const q = p[(i + 1) % p.length], r = p[i];
    // CCW outline: outward normal of edge r->q is (dy, -dx)
    const out = [q[1] - r[1], -(q[0] - r[0])];
    const mid = [(r[0] + q[0]) / 2 - out[0], (r[1] + q[1]) / 2 - out[1], (z0 + z1) / 2];
    face(mb, [[r[0], r[1], z0], [q[0], q[1], z0], [q[0], q[1], z1], [r[0], r[1], z1]], o.sideFn ? o.sideFn(i) : side, mid);
  }
  return mb;
}

// A ring-shaped prism: outer and inner outlines with the same vertex count (e.g. a gear with a hole).
export function ringPrism(mb, outer, inner, z0, z1, col, o = {}) {
  const n = outer.length, front = o.front || col, side = o.side || shade(col, -0.14), back = shade(col, -0.25);
  for (let i = 0; i < n; i++) {
    const i2 = (i + 1) % n;
    const A = outer[i], B = outer[i2], C = inner[i2], D = inner[i];
    face(mb, [[A[0], A[1], z1], [B[0], B[1], z1], [C[0], C[1], z1], [D[0], D[1], z1]], typeof front === 'function' ? front(i) : front, [A[0], A[1], z1 - 1]);
    face(mb, [[A[0], A[1], z0], [B[0], B[1], z0], [C[0], C[1], z0], [D[0], D[1], z0]], back, [A[0], A[1], z0 + 1]);
    face(mb, [[A[0], A[1], z0], [B[0], B[1], z0], [B[0], B[1], z1], [A[0], A[1], z1]], side, [0, 0, (z0 + z1) / 2]);
    face(mb, [[D[0], D[1], z0], [C[0], C[1], z0], [C[0], C[1], z1], [D[0], D[1], z1]], shade(side, -0.1), [(C[0] + D[0]) * 3, (C[1] + D[1]) * 3, (z0 + z1) / 2]);
  }
  return mb;
}

// Icosphere (subdiv 0..2) at c with radii r (number or [rx, ry, rz]); col(centroid, i) | colour.
export function sphere(mb, c, r, subdiv, col) {
  const t = (1 + Math.sqrt(5)) / 2;
  let V = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map(nrm);
  let F = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  for (let s = 0; s < subdiv; s++) {
    const cache = new Map(), F2 = [];
    const midp = (a, b) => {
      const k = a < b ? a + ',' + b : b + ',' + a;
      if (!cache.has(k)) { V.push(nrm([(V[a][0] + V[b][0]) / 2, (V[a][1] + V[b][1]) / 2, (V[a][2] + V[b][2]) / 2])); cache.set(k, V.length - 1); }
      return cache.get(k);
    };
    for (const [a, b, d] of F) { const ab = midp(a, b), bd = midp(b, d), da = midp(d, a); F2.push([a, ab, da], [b, bd, ab], [d, da, bd], [ab, bd, da]); }
    F = F2;
  }
  const R = Array.isArray(r) ? r : [r, r, r];
  const P = V.map((v) => [c[0] + v[0] * R[0], c[1] + v[1] * R[1], c[2] + v[2] * R[2]]);
  F.forEach(([a, b, d], i) => {
    const cen = [(V[a][0] + V[b][0] + V[d][0]) / 3, (V[a][1] + V[b][1] + V[d][1]) / 3, (V[a][2] + V[b][2] + V[d][2]) / 3];
    face(mb, [P[a], P[b], P[d]], typeof col === 'function' ? col(cen, i) : col, c);
  });
  return mb;
}

// Sweep a seg-sided tube along a polyline of [x, y, z] points (radius r or r(i)).
export function tube(mb, path, r, seg, col, o = {}) {
  const rings = [];
  for (let i = 0; i < path.length; i++) {
    const p = path[i], a = path[Math.max(0, i - 1)], b = path[Math.min(path.length - 1, i + 1)];
    const T = nrm(sub(b, a));
    let up = Math.abs(T[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
    const N = nrm(crs(T, up)), Bn = crs(T, N);
    const rr = typeof r === 'function' ? r(i) : r;
    rings.push(Array.from({ length: seg }, (_, j) => {
      const ang = (j / seg) * Math.PI * 2;
      return [p[0] + (N[0] * Math.cos(ang) + Bn[0] * Math.sin(ang)) * rr, p[1] + (N[1] * Math.cos(ang) + Bn[1] * Math.sin(ang)) * rr, p[2] + (N[2] * Math.cos(ang) + Bn[2] * Math.sin(ang)) * rr];
    }));
  }
  const C = (i, j) => (typeof col === 'function' ? col(i, j) : col);
  for (let i = 0; i < path.length - 1; i++) for (let j = 0; j < seg; j++) {
    const j2 = (j + 1) % seg;
    const hint = [(path[i][0] + path[i + 1][0]) / 2, (path[i][1] + path[i + 1][1]) / 2, (path[i][2] + path[i + 1][2]) / 2];
    face(mb, [rings[i][j], rings[i][j2], rings[i + 1][j2], rings[i + 1][j]], C(i, j), hint);
  }
  if (o.caps !== false) {
    const L = path.length - 1;
    const d0 = nrm(sub(path[0], path[1])), d1 = nrm(sub(path[L], path[L - 1]));
    for (let j = 0; j < seg; j++) {
      face(mb, [path[0], rings[0][j], rings[0][(j + 1) % seg]], C(0, j), sub(path[0], d0));
      face(mb, [path[L], rings[L][j], rings[L][(j + 1) % seg]], C(L - 1, j), sub(path[L], d1));
    }
  }
  return mb;
}

// Axis-aligned box; col | {top, front, side, bottom, back}
export function box(mb, x0, y0, z0, x1, y1, z1, col) {
  const c = typeof col === 'string' ? { top: shade(col, 0.08), front: col, side: shade(col, -0.12), bottom: shade(col, -0.3), back: shade(col, -0.2) } : col;
  const cen = [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2];
  face(mb, [[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], c.top, cen);
  face(mb, [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], c.bottom || c.side, cen);
  face(mb, [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], c.front, cen);
  face(mb, [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0]], c.back || c.side, cen);
  face(mb, [[x0, y0, z0], [x0, y1, z0], [x0, y1, z1], [x0, y0, z1]], c.side, cen);
  face(mb, [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]], c.side, cen);
  return mb;
}

const circle = (n, r, cx = 0, cy = 0, a0 = 0, sy = 1) => Array.from({ length: n }, (_, i) => { const a = a0 + (i / n) * Math.PI * 2; return [cx + Math.cos(a) * r, cy + Math.sin(a) * r * sy]; });

// ---------------------------------------------------------------- models

// The Lab: a round-bottom flask of bubbling green potion with a cork, plus a tiny test tube
function lab() {
  const mb = new MeshBuilder(), glass = new MeshBuilder();
  const liquid = (i) => jit(i < 3 ? '#4cd83a' : '#8af04a', i);
  lathe(mb, [[0, -0.92], [0.42, -0.86], [0.66, -0.62], [0.72, -0.34], [0.62, -0.08], [0.3, 0.12]], 10, (i, j) => jit(i < 2 ? '#2fae2a' : i < 4 ? '#54d63a' : '#9ef25a', i * 10 + j, 0.05), { capTop: true, capCol: '#c8ff7a' });
  // bubbles rising out of the potion
  sphere(mb, [0.12, 0.28, 0.12], 0.11, 0, '#d6ffb0');
  sphere(mb, [-0.1, 0.5, 0.05], 0.08, 0, '#eaffd0');
  sphere(mb, [0.06, 0.72, 0.0], 0.06, 0, '#ffffff');
  // cork
  lathe(mb, [[0.17, 0.62], [0.2, 0.74], [0.18, 0.86]], 7, (i, j) => jit('#c88a4a', j), { capTop: true, capCol: '#e6a866' });
  // glass shell (rendered translucent over the potion)
  lathe(glass, [[0, -0.98], [0.46, -0.92], [0.74, -0.64], [0.8, -0.32], [0.7, -0.02], [0.3, 0.22], [0.2, 0.36], [0.2, 0.62], [0.26, 0.66]], 10, (i, j) => jit('#dff8ff', i + j * 3, 0.04));
  return { mesh: mb.build(), glass: glass.build(), glassAlpha: 0.42, yaw: 0.35, pitch: 0.28, spin: 'wobble' };
}

// Aquarium: a round fishbowl with water, sand and weed; the orange fish is an `over` layer (drawn on the water,
// under the glass) so it always reads.
function aquarium() {
  const mb = new MeshBuilder(), fish = new MeshBuilder(), glass = new MeshBuilder();
  lathe(mb, [[0.3, -0.84], [0.62, -0.7], [0.82, -0.36], [0.84, -0.02], [0.72, 0.26]], 10, (i, j) => jit(i < 1 ? '#f6d890' : i < 2 ? '#1e88e0' : '#36b4f4', i * 10 + j, 0.05), { capTop: true, capCol: '#8ae8ff', capBottom: true });
  tube(mb, [[-0.4, -0.66, 0.6], [-0.46, -0.4, 0.62], [-0.36, -0.16, 0.64], [-0.44, 0.06, 0.62]], 0.08, 4, '#3ccf5a');
  tube(mb, [[-0.22, -0.7, 0.7], [-0.18, -0.46, 0.72], [-0.26, -0.28, 0.7]], 0.07, 4, '#8ae84e');
  // fish: a lathe along y turned to lie along x
  const f = new MeshBuilder();
  lathe(f, [[0, -0.36], [0.15, -0.26], [0.22, -0.04], [0.2, 0.14], [0.11, 0.28], [0, 0.34]], 7, (i, j) => jit(j === 0 || j === 6 ? '#ffd28a' : '#ff8a2a', i * 7 + j, 0.06));
  const d = f.build().data;
  const P = (i) => [-d[i + 1] * 1.2 + 0.08, d[i] * 1.05 - 0.1, d[i + 2] * 0.8 + 0.5]; // turn the y-axis lathe to lie along x
  for (let i = 0; i < d.length; i += 33) fish.tri(P(i), P(i + 11), P(i + 22), [d[i + 6], d[i + 7], d[i + 8]]);
  face(fish, [[0.48, -0.1, 0.5], [0.76, 0.14, 0.5], [0.76, -0.34, 0.5]], '#ff6a1a', [0.6, -0.1, 0]);
  face(fish, [[0.48, -0.1, 0.5], [0.76, -0.34, 0.5], [0.76, 0.14, 0.5]], '#ff6a1a', [0.6, -0.1, 1]);
  face(fish, [[0.0, 0.18, 0.5], [0.2, 0.34, 0.5], [0.3, 0.14, 0.5]], '#ffb04a', [0.2, 0.2, 0]);
  face(fish, [[0.0, 0.18, 0.5], [0.3, 0.14, 0.5], [0.2, 0.34, 0.5]], '#ffb04a', [0.2, 0.2, 1]);
  sphere(fish, [-0.2, -0.04, 0.68], 0.06, 0, '#1a1a2e');
  sphere(fish, [-0.22, -0.02, 0.72], 0.022, 0, '#ffffff');
  lathe(glass, [[0.32, -0.9], [0.66, -0.76], [0.9, -0.4], [0.92, 0.0], [0.8, 0.32], [0.72, 0.4], [0.76, 0.44]], 10, (i, j) => jit('#e8fcff', i + j, 0.04));
  return { mesh: mb.build(), over: fish.build(), glass: glass.build(), glassAlpha: 0.22, yaw: 0, pitch: 0.3, spin: 'wobble' };
}

const FISH_OUTLINE = [[-0.5, 0], [-0.3, 0.24], [0, 0.32], [0.26, 0.22], [0.4, 0.04], [0.62, 0.24], [0.6, -0.22], [0.4, -0.04], [0.26, -0.22], [0, -0.3], [-0.3, -0.22]];

// FishDex: a chunky glossy blue field guide with a golden fish emblem and a red ribbon
function journal() {
  const mb = new MeshBuilder();
  const W = 0.72, H = 0.92, T = 0.24;
  box(mb, -W, -H, -T, W, H, -T + 0.08, { top: '#2e86e0', front: '#1d6cc8', side: '#1a5eb0', back: '#1a5eb0' }); // back cover
  box(mb, -W + 0.06, -H + 0.06, -T + 0.08, W - 0.02, H - 0.06, T - 0.08, { top: '#fffaf0', front: '#fff4dc', side: '#efe2c4', back: '#efe2c4' }); // pages
  box(mb, -W, -H, T - 0.08, W, H, T, { top: '#5cbcff', front: '#2f96f0', side: '#2272d0', back: '#2272d0' }); // front cover
  box(mb, -W - 0.04, -H, -T, -W + 0.12, H, T, { top: '#4aa8f8', front: '#1a64c0', side: '#1658a8' }); // spine
  // gold emblem + corner caps
  prism(mb, FISH_OUTLINE.map(([x, y]) => [x * 0.95 + 0.04, y * 0.95 + 0.08]), T, T + 0.07, '#ffd44a', { side: '#d89a1c' });
  sphere(mb, [-0.24, 0.12, T + 0.08], 0.05, 0, '#2a1a10');
  box(mb, -0.42, -0.6, T, 0.5, -0.5, T + 0.04, '#ffe27a');
  box(mb, W - 0.16, H - 0.16, T, W, H, T + 0.03, '#ffd44a');
  box(mb, W - 0.16, -H, T, W, -H + 0.16, T + 0.03, '#ffd44a');
  // ribbon
  box(mb, 0.28, -H - 0.22, 0.02, 0.4, -H + 0.04, 0.08, '#ff4a5a');
  return { mesh: mb.build(), yaw: -0.42, pitch: 0.18, spin: 'wobble' };
}

// Satchel: a leaf-green leather bag with a flap, a gold buckle and a strap
function inventory() {
  const mb = new MeshBuilder();
  const body = (i) => jit('#5ec23a', i, 0.05);
  prism(mb, [[-0.78, -0.62], [0.78, -0.62], [0.86, -0.4], [0.86, 0.3], [-0.86, 0.3], [-0.86, -0.4]], -0.36, 0.36, '#5ec23a', { front: body, side: '#3e9a28' });
  // flap (rounded bottom edge)
  const flap = [[-0.9, 0.36], [0.9, 0.36], [0.9, 0.12], ...circle(9, 0.5, 0, 0.12, Math.PI * 1.05, 0.62).slice(0).filter((p) => p[1] < 0.12).sort((a, b) => b[0] - a[0]), [-0.9, 0.12]];
  prism(mb, flap, 0.32, 0.44, '#8ae04e', { front: (i) => jit('#8ae04e', i, 0.05), side: '#4eac2c' });
  // buckle
  box(mb, -0.14, -0.38, 0.42, 0.14, -0.16, 0.5, { top: '#fff2a0', front: '#ffd23a', side: '#d8981a' });
  box(mb, -0.06, -0.32, 0.5, 0.06, -0.22, 0.53, '#7a4a10');
  // strap arc
  const strap = [];
  for (let i = 0; i <= 10; i++) { const a = Math.PI * (i / 10); strap.push([Math.cos(a) * 0.72, 0.34 + Math.sin(a) * 0.62, 0]); }
  tube(mb, strap, 0.07, 5, '#3e9a28');
  // stitched leaf pocket
  prism(mb, [[0.0, -0.1], [0.36, 0.04], [0.5, 0.2], [0.24, 0.14]].map(([x, y]) => [x - 0.62, y - 0.42]), 0.36, 0.4, '#c8f56a');
  return { mesh: mb.build(), yaw: -0.38, pitch: 0.2, spin: 'wobble' };
}

// Wardrobe: an aqua tee with a white stripe on a chrome hanger
function wardrobe() {
  const mb = new MeshBuilder();
  const tee = [[-0.56, -0.86], [0.56, -0.86], [0.56, 0.12], [0.86, 0.0], [1.0, 0.36], [0.5, 0.66], [0.24, 0.66], [0.12, 0.54], [0, 0.5], [-0.12, 0.54], [-0.24, 0.66], [-0.5, 0.66], [-1.0, 0.36], [-0.86, 0.0], [-0.56, 0.12]];
  prism(mb, tee, -0.14, 0.14, '#3ec0f4', { front: (i) => jit('#3ec0f4', i, 0.05), side: '#1e8ad0' });
  box(mb, -0.56, -0.38, 0.14, 0.56, -0.2, 0.18, '#ffffff');
  box(mb, -0.56, -0.62, 0.14, 0.56, -0.5, 0.17, '#bff0ff');
  // collar
  tube(mb, [[-0.26, 0.64, 0.12], [-0.12, 0.52, 0.16], [0, 0.48, 0.17], [0.12, 0.52, 0.16], [0.26, 0.64, 0.12]], 0.045, 4, '#e8fbff', { caps: false });
  // hanger
  tube(mb, [[-0.62, 0.66, 0.0], [0, 0.94, 0.0], [0.62, 0.66, 0.0]], 0.045, 5, '#d8e8f4');
  tube(mb, [[0, 0.94, 0], [0, 1.08, 0], [0.1, 1.2, 0], [0.2, 1.12, 0]], 0.04, 5, '#c4d8e8');
  return { mesh: mb.build(), yaw: 0.25, pitch: 0.1, spin: 'wobble' };
}

// Map: a glossy eco globe (green continents on an aqua sea) on a chrome stand
function map() {
  const mb = new MeshBuilder();
  const land = (c) => {
    const n = Math.sin(c[0] * 4.1 + 1.3) * Math.cos(c[1] * 3.3 - 0.4) + Math.sin(c[2] * 3.7 + c[0] * 2.1) * 0.7 + Math.sin(c[1] * 6.3 + c[2] * 2.2) * 0.3;
    return n > 0.35;
  };
  sphere(mb, [0, 0.12, 0], 0.74, 2, (c, i) => {
    if (Math.abs(c[1]) > 0.86) return '#f4fcff';
    return land(c) ? jit(c[1] > 0.3 ? '#8ae04a' : '#4cc23a', i, 0.08) : jit(c[1] > 0.2 ? '#4ac8f8' : '#2a98e8', i, 0.05);
  });
  // meridian ring + stand
  const ring = [];
  for (let i = 0; i <= 12; i++) { const a = -Math.PI * 0.62 + (i / 12) * Math.PI * 1.24; ring.push([Math.sin(a) * 0.86, 0.12 + Math.cos(a) * 0.86, -0.1]); }
  tube(mb, ring, 0.05, 5, '#dfeefa');
  tube(mb, [[0, -0.74, -0.1], [0, -0.86, -0.1]], 0.07, 6, '#b8cce0');
  lathe(mb, [[0.46, -1.0], [0.48, -0.94], [0.3, -0.86], [0.1, -0.84]], 8, (i, j) => jit('#c8dcee', j), { capTop: true, capCol: '#e8f4fc' });
  return { mesh: mb.build(), yaw: 0.6, pitch: 0.18, spin: 'full', center: [0, 0.0, 0] };
}

// Bait Shop: a little market stall with a striped awning, a counter and a fish sign
function shop() {
  const mb = new MeshBuilder();
  box(mb, -0.84, -0.94, -0.3, 0.84, -0.24, 0.36, { top: '#fff4dc', front: '#f6d8a8', side: '#d8a868', back: '#d8a868' }); // counter
  box(mb, -0.84, -0.4, 0.36, 0.84, -0.3, 0.42, '#ff9d2e');
  for (const x of [-0.78, 0.7]) box(mb, x, -0.24, -0.24, x + 0.08, 0.5, -0.16, '#ffffff');
  // awning: 6 alternating stripes, sloped toward the viewer, scalloped edge
  const n = 6;
  for (let i = 0; i < n; i++) {
    const x0 = -0.96 + (i / n) * 1.92, x1 = -0.96 + ((i + 1) / n) * 1.92;
    const col = i % 2 ? '#ffffff' : '#ff5a4a';
    face(mb, [[x0, 0.86, -0.3], [x1, 0.86, -0.3], [x1, 0.42, 0.46], [x0, 0.42, 0.46]], col, [0, 0, -1]);
    face(mb, [[x0, 0.42, 0.46], [x1, 0.42, 0.46], [(x0 + x1) / 2, 0.28, 0.5]], i % 2 ? '#f0f0f0' : '#e8403a', [0, 0.4, 0]);
  }
  box(mb, -0.98, 0.84, -0.34, 0.98, 0.94, -0.22, '#ffd44a');
  // goods on the counter: a worm jar and a glossy lure
  lathe(mb, [[0.16, -0.24], [0.18, -0.02], [0.14, 0.04]], 7, '#bff0ff', { capTop: true, capCol: '#ff8ab4', x: -0.42, z: 0.1 });
  sphere(mb, [0.38, -0.1, 0.12], [0.2, 0.14, 0.12], 1, (c, i) => jit(c[1] > 0 ? '#ffd44a' : '#ff8a2a', i, 0.05));
  // sign with a fish
  box(mb, -0.34, 0.04, -0.18, 0.34, 0.36, -0.12, '#3ec0f4');
  prism(mb, FISH_OUTLINE.map(([x, y]) => [x * 0.42, y * 0.42 + 0.2]), -0.12, -0.08, '#ffffff');
  return { mesh: mb.build(), yaw: -0.36, pitch: 0.2, spin: 'wobble' };
}

// Bait: a fat glossy pink worm with a happy face, wriggling on a chrome hook
function bait() {
  const mb = new MeshBuilder();
  const hook = [];
  for (let i = 0; i <= 14; i++) {
    const k = i / 14;
    if (k < 0.45) hook.push([0.42, 1.0 - k * 2.9, -0.1]);
    else { const a = ((k - 0.45) / 0.55) * Math.PI * 1.1; hook.push([0.42 - 0.4 + Math.cos(a) * 0.4, 1.0 - 0.45 * 2.9 - Math.sin(a) * 0.4, -0.1]); }
  }
  tube(mb, hook, 0.06, 5, '#e4f2fc');
  lathe(mb, [[0.1, 0.98], [0.12, 1.06], [0.0, 1.12]], 6, '#ffd44a', { x: 0.42, z: -0.1 });
  face(mb, [[-0.42, -0.18, -0.06], [-0.32, 0.02, -0.06], [-0.28, -0.16, -0.06]], '#e4f2fc', [0, 0, -1]);
  face(mb, [[-0.42, -0.18, -0.14], [-0.28, -0.16, -0.14], [-0.32, 0.02, -0.14]], '#b8cce0', [0, 0, 1]);
  // worm: an S curve in front of the hook, head top-left
  const worm = [];
  for (let i = 0; i <= 16; i++) {
    const k = i / 16;
    worm.push([-0.5 + k * 0.8 + Math.sin(k * Math.PI * 2) * 0.28, 0.62 - k * 1.3, 0.18 + Math.sin(k * Math.PI) * 0.1]);
  }
  tube(mb, worm, (i) => 0.17 * Math.pow(Math.sin(Math.min(1, (i + 1.5) / 18) * Math.PI), 0.45), 7, (i, j) => jit(i % 3 === 0 ? '#ff6ea4' : '#ff9ac2', i * 7 + j, 0.04));
  const h = worm[0];
  sphere(mb, [h[0] - 0.02, h[1] + 0.04, h[2]], 0.17, 1, (c, i) => jit('#ffa6c8', i, 0.04));
  sphere(mb, [h[0] - 0.09, h[1] + 0.09, h[2] + 0.15], 0.045, 0, '#1a1a2e');
  sphere(mb, [h[0] + 0.06, h[1] + 0.09, h[2] + 0.15], 0.045, 0, '#1a1a2e');
  sphere(mb, [h[0] - 0.14, h[1] - 0.0, h[2] + 0.12], 0.035, 0, '#ff5a8a');
  return { mesh: mb.build(), yaw: 0.0, pitch: 0.1, spin: 'wobble' };
}

// Multiplayer: two glossy bubble buddies, blue and green
function multiplayer() {
  const mb = new MeshBuilder();
  const buddy = (x, z, s, body, head) => {
    lathe(mb, [[0, -0.95], [0.4, -0.9], [0.5, -0.62], [0.44, -0.36], [0.18, -0.22], [0, -0.2]].map(([r, y]) => [r * s, y * s + (1 - s) * -0.9]), 9, (i, j) => jit(body, i * 9 + j, 0.05), { x, z });
    sphere(mb, [x, -0.02 * s + (1 - s) * -0.9 + 0.1, z], 0.3 * s, 1, (c, i) => jit(head, i, 0.04));
    sphere(mb, [x - 0.1 * s, 0.1 * s + (1 - s) * -0.9 + 0.08, z + 0.26 * s], 0.045 * s, 0, '#14284a');
    sphere(mb, [x + 0.08 * s, 0.1 * s + (1 - s) * -0.9 + 0.08, z + 0.27 * s], 0.045 * s, 0, '#14284a');
  };
  buddy(0.36, -0.2, 0.92, '#5cd03a', '#c8ff9a');
  buddy(-0.3, 0.2, 1.08, '#2f9ef0', '#bff0ff');
  return { mesh: mb.build(), yaw: 0, pitch: 0.16, spin: 'wobble' };
}

// Settings: a chunky chrome-aqua gear with a small gear behind it
function gearOutline(n, r0, r1, phase = 0) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = phase + (i / n) * Math.PI * 2, w = (Math.PI * 2) / n;
    pts.push([Math.cos(a - w * 0.3) * r0, Math.sin(a - w * 0.3) * r0], [Math.cos(a - w * 0.17) * r1, Math.sin(a - w * 0.17) * r1], [Math.cos(a + w * 0.17) * r1, Math.sin(a + w * 0.17) * r1], [Math.cos(a + w * 0.3) * r0, Math.sin(a + w * 0.3) * r0]);
  }
  return pts;
}
function settings() {
  const mb = new MeshBuilder();
  const o1 = gearOutline(8, 0.66, 0.9);
  ringPrism(mb, o1, circle(o1.length, 0.28, 0, 0, Math.atan2(o1[0][1], o1[0][0])), -0.2, 0.2, '#5cc8f8', { front: (i) => jit(i % 4 < 2 ? '#7ad8ff' : '#5cc8f8', i, 0.03), side: '#1e7ac0' });
  const o2 = gearOutline(6, 0.3, 0.44, 0.3).map(([x, y]) => [x + 0.62, y - 0.62]);
  ringPrism(mb, o2, circle(o2.length, 0.12, 0.62, -0.62, Math.atan2(o2[0][1] + 0.62, o2[0][0] - 0.62)), -0.34, -0.12, '#7ee04a', { side: '#3e9a28' });
  lathe(mb, [[0.3, -0.14], [0.3, 0.14]], 10, '#0e4a86', { inside: true, a0: 0 });
  return { mesh: mb.build(), yaw: 0.0, pitch: 0.42, spin: 'full', spinAxis: 'z' };
}

// Quests: a parchment scroll with wooden rolls and a red wax seal with a gold star
function quests() {
  const mb = new MeshBuilder();
  box(mb, -0.56, -0.7, -0.04, 0.56, 0.7, 0.04, { top: '#fff6d8', front: '#fff0c8', side: '#e8d0a0', back: '#e8d0a0' });
  for (const y of [0.74, -0.74]) {
    tube(mb, [[-0.66, y, 0.02], [0.66, y, 0.02]], 0.14, 7, (i, j) => jit('#f6e2b0', j, 0.05));
    tube(mb, [[-0.84, y, 0.02], [-0.66, y, 0.02]], 0.09, 6, '#c8843a');
    tube(mb, [[0.66, y, 0.02], [0.84, y, 0.02]], 0.09, 6, '#c8843a');
  }
  // text lines
  for (let i = 0; i < 4; i++) box(mb, -0.4, 0.42 - i * 0.18, 0.04, i === 3 ? 0.1 : 0.4, 0.48 - i * 0.18, 0.06, '#c8a878');
  // a red wax seal facing the viewer with a raised gold star
  prism(mb, circle(10, 0.27, 0.3, -0.36), 0.04, 0.16, '#e8303a', { front: (i) => jit('#f04848', i, 0.05), side: '#a81c28' });
  const star = [];
  for (let i = 0; i < 10; i++) { const a = Math.PI / 2 + (i / 10) * Math.PI * 2, r = i % 2 ? 0.07 : 0.17; star.push([Math.cos(a) * r + 0.3, Math.sin(a) * r - 0.36]); }
  prism(mb, star, 0.16, 0.22, '#ffd44a', { side: '#d89a1c' });
  return { mesh: mb.build(), yaw: -0.28, pitch: 0.16, spin: 'wobble' };
}

// Aero currency: a glossy water drop
function coin() {
  const mb = new MeshBuilder();
  const prof = [];
  for (let i = 0; i <= 12; i++) {
    const y = -0.86 + (i / 12) * 1.86;
    const r = y < -0.2 ? Math.sqrt(Math.max(0, 0.66 * 0.66 - (y + 0.2) * (y + 0.2))) : 0.66 * Math.pow(Math.max(0, 1 - (y + 0.2) / 1.2), 1.35);
    prof.push([r, y]);
  }
  prof[0][0] = 0; prof[12][0] = 0;
  lathe(mb, prof, 10, (i, j) => jit(i < 3 ? '#1690d0' : i < 7 ? '#2fc0ec' : '#7ee8ff', i * 10 + j, 0.04));
  return { mesh: mb.build(), yaw: 0, pitch: 0.1, spin: 'full', look: { spec: 0.9, shine: 22 } };
}

export const ICON_MODELS = {
  lab, aquarium, journal, inventory, wardrobe, map, shop, baitshop: shop, appsea: shop, store: shop, bait, multiplayer, settings, quests, coin,
  skills: lab, research: lab, tank: aquarium, fishdex: journal, satchel: inventory, friends: multiplayer,
};

// ---------------------------------------------------------------- rods & gems

// A fishing rod from a rod's look {shaft, grip, reel, tip, glow, kind}: grip, reel, tapered blank, guides, bobber.
export function ROD_MODEL(rod = {}) {
  const L = rod.look || {};
  const mb = new MeshBuilder();
  const blank = L.shaft || '#2f9ef0', grip = L.grip || '#d8a868', reel = L.reel || '#dfeefa', tip = L.tip || '#ffffff';
  const A = [-0.78, -0.82, 0], B = [0.82, 0.86, 0];
  const at = (k) => [A[0] + (B[0] - A[0]) * k, A[1] + (B[1] - A[1]) * k, 0];
  const thick = (L.kind === 'trident' || L.kind === 'coil' ? 1.25 : L.kind === 'wand' ? 1.15 : 1) * 1.55; // chunky enough to read at 32 px
  tube(mb, [at(0), at(0.26)], 0.095 * thick, 6, (i, j) => jit(grip, j, 0.08));
  tube(mb, [at(0.26), at(0.31)], 0.075 * thick, 6, mix(grip, '#ffffff', 0.35));
  tube(mb, [at(0.31), at(0.64), at(1)], (i) => [0.065, 0.048, 0.026][i] * thick, 6, (i, j) => jit(blank, i * 6 + j, 0.05));
  sphere(mb, at(1), 0.05 * thick, 0, tip);
  for (const k of [0.5, 0.7, 0.86]) { const p = at(k); tube(mb, [[p[0] - 0.05, p[1] + 0.05, 0], [p[0] - 0.1, p[1] + 0.1, 0]], 0.022, 4, '#e8f4fc'); }
  if (L.kind === 'trident') for (const d of [-0.12, 0.12]) tube(mb, [at(0.94), [B[0] + d - 0.06, B[1] + 0.06 + d * 0.5, 0]], 0.025, 4, tip);
  if (L.glow) sphere(mb, at(1), 0.11, 0, L.glow);
  const r = at(0.2);
  lathe(mb, [[0.24, -0.09], [0.27, 0.0], [0.24, 0.09]], 9, (i, j) => jit(reel, j, 0.05), { x: r[0] + 0.14, y: r[1] - 0.22, z: 0.03, capTop: true, capBottom: true, capCol: mix(reel, '#ffffff', 0.4) });
  tube(mb, [B, [B[0] + 0.02, B[1] - 0.6, 0.02]], 0.02, 3, '#ffffff', { caps: false });
  sphere(mb, [B[0] + 0.02, B[1] - 0.76, 0.02], 0.19, 1, (c) => (c[1] > 0.1 ? '#ff4a5a' : '#ffffff'));
  return { mesh: mb.build(), yaw: 0.25, pitch: 0.12, spin: 'wobble' };
}

// A brilliant-cut gem in a rarity colour.
export function GEM_MODEL(color = '#3ab4ff') {
  const mb = new MeshBuilder();
  const n = 8, top = 0.36, crown = 0.62, girdle = 0.9;
  const ring = (r, y, a0) => Array.from({ length: n }, (_, i) => { const a = a0 + (i / n) * Math.PI * 2; return [Math.cos(a) * r, y, Math.sin(a) * r]; });
  const T = ring(crown, top, Math.PI / n), G = ring(girdle, 0.12, 0), P = [0, -0.9, 0];
  const light = mix(color, '#ffffff', 0.55), mid = color, dark = shade(color, -0.35);
  for (let i = 0; i < n; i++) {
    const i2 = (i + 1) % n;
    face(mb, [[0, top, 0], T[i], T[i2]], jit(light, i, 0.06), [0, 0, 0]);
    face(mb, [T[i], G[i2], T[i2]], jit(mix(light, mid, 0.5), i, 0.08), [0, 0, 0]);
    face(mb, [T[i], G[i], G[i2]], jit(mid, i + 9, 0.08), [0, 0, 0]);
    face(mb, [G[i], P, G[i2]], jit(i % 2 ? dark : mid, i + 3, 0.06), [0, 0, 0]);
  }
  return { mesh: mb.build(), yaw: 0.2, pitch: 0.5, spin: 'full' };
}

// ---------------------------------------------------------------- [phase10:ui] voxel chrome decor & cut gems
// DECOR_MODELS { leaves | leaves_l | shell | starfish | bubbles | pearl | coral: () => model } little ornaments for the
// panel frames (rendered as voxel models by bigicons.decorFrame). CUT_GEM_MODEL(color, cut, dim) -> a gem in one of
// the Lab cuts (round | diamond | square | drop | heart | clover | oval | hex) built as stepped, terraced layers.
const TAU2 = Math.PI * 2;
const ring2 = (n, r, cx = 0, cy = 0, a0 = 0, sx = 1) => Array.from({ length: n }, (_, i) => { const a = a0 + (i / n) * TAU2; return [cx + Math.cos(a) * r * sx, cy + Math.sin(a) * r]; });
function leafInto(mb, bx, by, len, wid, ang, z, col) {
  const ca = Math.cos(ang), sa = Math.sin(ang), pts = [];
  const N = 10;
  for (let i = 0; i <= N; i++) { const u = i / N, hw = Math.pow(Math.sin(Math.PI * Math.min(1, u * 1.02)), 0.7) * wid * (1 - 0.15 * u); pts.push([u * len, hw]); }
  for (let i = N - 1; i >= 1; i--) { const u = i / N, hw = Math.pow(Math.sin(Math.PI * Math.min(1, u * 1.02)), 0.7) * wid * (1 - 0.15 * u); pts.push([u * len, -hw]); }
  const P = (p) => [bx + p[0] * ca - p[1] * sa, by + p[0] * sa + p[1] * ca];
  const lit = mix(col, '#e8ffa0', 0.35);
  prism(mb, pts.map(P), z - 0.04, z + 0.04, col, { front: (i) => jit(i % 3 ? lit : col, i, 0.05), side: shade(col, -0.3) });
  tube(mb, [[bx, by, z + 0.045], [bx + ca * len * 0.85, by + sa * len * 0.85, z + 0.045]], 0.018, 3, mix(col, '#f4ffc0', 0.7));
}
export const DECOR_MODELS = {
  leaves: () => {
    const mb = new MeshBuilder();
    tube(mb, [[0.95, 0.75, 0], [0.4, 0.55, 0.02], [-0.1, 0.25, 0.04], [-0.55, -0.2, 0.05]], (i) => [0.05, 0.045, 0.035, 0.025][i], 5, '#2c7a1c');
    leafInto(mb, 0.55, 0.6, 0.62, 0.2, 2.2, 0.08, '#4fbf2c');
    leafInto(mb, 0.3, 0.45, 0.7, 0.22, -2.6, 0.12, '#62d63a');
    leafInto(mb, 0.0, 0.2, 0.66, 0.21, 2.5, 0.16, '#3caa22');
    leafInto(mb, -0.2, 0.02, 0.6, 0.2, -2.0, 0.2, '#86e04a');
    leafInto(mb, -0.5, -0.18, 0.5, 0.17, -3.0, 0.22, '#52c830');
    return { mesh: mb.build(), yaw: 0.15, pitch: 0.2, spin: 'wobble', spinAxis: 'z' };
  },
  leaves_l: () => mirrorModel(DECOR_MODELS.leaves()),
  shell: () => {
    const mb = new MeshBuilder();
    const n = 9;
    for (let i = 0; i < n; i++) {
      const a0 = Math.PI * (0.08 + (0.84 * i) / n), a1 = Math.PI * (0.08 + (0.84 * (i + 1)) / n), am = (a0 + a1) / 2;
      const r = 0.92, d = 0.12 + 0.2 * Math.sin((i + 0.5) / n * Math.PI);
      const col = i % 2 ? '#ffb4a0' : '#ffd6c4';
      prism(mb, [[0, -0.55], [Math.cos(a0) * r, -0.55 + Math.sin(a0) * r], [Math.cos(am) * r * 1.04, -0.55 + Math.sin(am) * r * 1.04], [Math.cos(a1) * r, -0.55 + Math.sin(a1) * r]], -d * 0.6, d, col, { front: (k) => jit(col, i * 5 + k, 0.04), side: '#e0806a' });
    }
    prism(mb, [[-0.32, -0.75], [0.32, -0.75], [0.2, -0.5], [-0.2, -0.5]], -0.08, 0.14, '#ffc0aa', { side: '#d87460' });
    return { mesh: mb.build(), yaw: 0.2, pitch: 0.35, spin: 'wobble' };
  },
  starfish: () => {
    const mb = new MeshBuilder();
    const pts = Array.from({ length: 10 }, (_, i) => { const a = Math.PI / 2 + (i / 10) * TAU2, r = i % 2 ? 0.36 : 0.95; return [Math.cos(a) * r, Math.sin(a) * r]; });
    prism(mb, pts, -0.12, 0.14, '#ff8a3a', { front: (i) => jit('#ffa04a', i, 0.05), side: '#d8601c' });
    for (let k = 0; k < 5; k++) { const a = Math.PI / 2 + (k / 5) * TAU2; for (const t of [0.25, 0.45, 0.65]) sphere(mb, [Math.cos(a) * t, Math.sin(a) * t, 0.16], 0.06, 0, '#ffe0a0'); }
    sphere(mb, [0, 0, 0.17], 0.09, 0, '#ffd080');
    return { mesh: mb.build(), yaw: 0.1, pitch: 0.4, spin: 'wobble', spinAxis: 'z' };
  },
  bubbles: () => {
    const mb = new MeshBuilder(), glass = new MeshBuilder();
    for (const [x, y, r] of [[-0.35, -0.35, 0.5], [0.45, 0.2, 0.34], [0.05, 0.72, 0.22]]) {
      sphere(glass, [x, y, 0], r, 2, (c, i) => jit(c[1] > 0.3 ? '#ffffff' : '#bff0ff', i, 0.03));
      sphere(mb, [x - r * 0.4, y + r * 0.42, r * 0.55], r * 0.2, 1, '#ffffff');
      sphere(mb, [x + r * 0.35, y - r * 0.4, r * 0.6], r * 0.1, 0, '#e6fbff');
    }
    return { mesh: mb.build(), glass: glass.build(), glassAlpha: 0.38, yaw: 0, pitch: 0.1, spin: 'wobble' };
  },
  pearl: () => {
    const mb = new MeshBuilder();
    sphere(mb, [0, 0, 0], 0.9, 2, (c, i) => jit(c[1] > 0.35 && c[0] < 0.2 ? '#ffffff' : c[1] < -0.4 ? '#c8d4f0' : '#eef0ff', i, 0.03));
    return { mesh: mb.build(), yaw: 0, pitch: 0.1, spin: 'full' };
  },
  coral: () => {
    const mb = new MeshBuilder();
    const br = [[[0, -0.95, 0], [0, -0.3, 0], [-0.1, 0.2, 0], [-0.4, 0.7, 0]], [[0, -0.4, 0], [0.35, 0.05, 0.05], [0.5, 0.6, 0.05]], [[-0.05, 0.05, 0], [0.12, 0.45, -0.05], [0.1, 0.9, -0.05]], [[0, -0.6, 0], [-0.45, -0.2, 0.05], [-0.7, 0.15, 0.05]]];
    for (const p of br) tube(mb, p, (i) => 0.13 - i * 0.025, 6, (i, j) => jit(i > 1 ? '#ff9ec0' : '#ff6a96', i * 6 + j, 0.05));
    return { mesh: mb.build(), yaw: 0.2, pitch: 0.15, spin: 'wobble' };
  },
};

// mirror a model left-right (x -> -x, triangle winding kept)
function mirrorModel(md) {
  const d = md.mesh.data;
  for (let i = 0; i < d.length; i += 33) {
    for (let v = 0; v < 3; v++) { d[i + v * 11] = -d[i + v * 11]; d[i + v * 11 + 3] = -d[i + v * 11 + 3]; }
    for (let k = 0; k < 11; k++) { const a = d[i + 11 + k]; d[i + 11 + k] = d[i + 22 + k]; d[i + 22 + k] = a; }
  }
  const b = md.mesh.bounds, mn = b.min[0], mx = b.max[0];
  b.min[0] = -mx; b.max[0] = -mn; b.center[0] = -b.center[0];
  return { ...md, yaw: -(md.yaw || 0) };
}

function cutOutline(cut) {
  switch (cut) {
    case 'diamond': return [[0, 1], [-0.95, 0], [0, -1], [0.95, 0]];
    case 'square': { const p = []; for (const [cx, cy, a0] of [[0.62, 0.62, 0], [-0.62, 0.62, 0.25], [-0.62, -0.62, 0.5], [0.62, -0.62, 0.75]]) for (let i = 0; i <= 3; i++) { const a = (a0 + (i / 3) * 0.25) * TAU2; p.push([cx + Math.cos(a) * 0.2, cy + Math.sin(a) * 0.2]); } return p; }
    case 'drop': { const p = [[0, 1]]; for (let i = 0; i <= 14; i++) { const a = Math.PI * 0.18 + (i / 14) * Math.PI * 1.64; p.push([Math.cos(a + Math.PI / 2) * 0.72, -0.28 + Math.sin(a + Math.PI / 2) * 0.72]); } return p; }
    case 'heart': return Array.from({ length: 24 }, (_, i) => { const t = (i / 24) * TAU2; const x = 16 * Math.sin(t) ** 3, y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t); return [x / 17, y / 17 + 0.12]; });
    case 'clover': return Array.from({ length: 32 }, (_, i) => { const a = (i / 32) * TAU2, r = 0.5 + 0.48 * Math.pow(Math.abs(Math.cos(2 * a)), 0.6); return [Math.cos(a) * r, Math.sin(a) * r]; });
    case 'oval': return ring2(18, 1, 0, 0, 0, 0.72);
    case 'hex': return ring2(6, 0.98);
    default: return ring2(18, 1);
  }
}
export function CUT_GEM_MODEL(color = '#3ab4ff', cut = 'round', dim = false) {
  const mb = new MeshBuilder();
  const P = cutOutline(cut);
  const base = dim ? '#16243a' : color;
  const L = [[1, -0.3, 0.02, shade(base, -0.3)], [0.84, 0.02, 0.16, base], [0.62, 0.16, 0.3, mix(base, '#ffffff', dim ? 0.12 : 0.35)]];
  for (const [s, z0, z1, c] of L) prism(mb, P.map(([x, y]) => [x * s, y * s]), z0, z1, c, { front: (i) => jit(c, i, 0.05), side: shade(c, -0.25) });
  if (!dim) { sphere(mb, [-0.28, 0.3, 0.32], 0.1, 0, '#ffffff'); sphere(mb, [-0.14, 0.38, 0.31], 0.06, 0, '#ffffff'); }
  return { mesh: mb.build(), yaw: 0.28, pitch: 0.32, spin: 'wobble' };
}

// A glossy voxel bubble-orb in any colour (aero.drawGlossOrb): lit top-left, deeper below, a white glint cluster.
export function ORB_MODEL(color = '#2fd3e8') {
  const mb = new MeshBuilder();
  const lt = mix(color, '#ffffff', 0.5), dk = shade(color, -0.3);
  sphere(mb, [0, 0, 0], 0.92, 2, (c, i) => jit(c[1] - c[0] * 0.5 > 0.45 ? lt : c[1] < -0.45 ? dk : color, i, 0.03));
  sphere(mb, [-0.36, 0.42, 0.7], 0.17, 1, '#ffffff');
  sphere(mb, [-0.12, 0.6, 0.66], 0.09, 0, '#ffffff');
  sphere(mb, [0.42, -0.4, 0.72], 0.1, 0, mix(color, '#ffffff', 0.75));
  return { mesh: mb.build(), yaw: 0, pitch: 0.12, spin: 'full' };
}
