// Low-poly modelling kit for the 3D aquarium (phase 6), on top of src/gfx/lowpoly.js. Writes LPMesh vertex data
// directly so meshes can carry per-vertex colours (gradients) and smooth normals (glossy glass, bubbles), with a
// small transform stack for placing primitives. Units: centimetres, Y up.
//
//   const g = new Geo();  g.push(); g.at(x, y, z); g.rotY(a); g.scale(s); ... g.pop();
//   g.tri(a, b, c, col) / g.quad(a, b, c, d, col)          flat-shaded (col: '#hex' | [r, g, b])
//   g.triS(a, b, c, na, nb, nc, ca, cb?, cc?)               smooth (own normals / per-vertex colours)
//   g.box(x0, y0, z0, x1, y1, z1, col | {top, side, bottom, front})
//   g.cyl(r0, r1, h, seg, col, {caps, jit, seed, a0, smooth})   along +y from 0 to h
//   g.sphere(r, det, col, {smooth, jit, seed, sx, sy, sz, cut}) icosphere (det 0..3); cut = keep y >= cut*r
//   g.lathe([[r, y]...], seg, colFn(i, j) | col, {smooth, a0}) surface of revolution
//   g.rock(r, seed, col, {flat, sy, det})                   lumpy faceted rock (paint varies per face)
//   g.tube([[x,y,z]...], r | [r...], seg, col)               swept tube (stems, driftwood, airline)
//   g.blade([[x,y,z]...], widths, col, nrmSide)             double-sided ribbon (leaves, grass)
//   g.build() -> LPMesh  (null when empty)
//   DynMesh: per-frame rebuilt geometry (water surface, swaying plants, particle batches): g = dm.begin(); ... dm.end()
//   rgb(hex), mixc(a, b, t), shadec(col, k), hash01(n)

import { LPMesh } from '../gfx/lowpoly.js';

export const rgb = (c) => {
  if (Array.isArray(c)) return c;
  const h = String(c || '#ffffff').replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((x) => x + x).join('') : h.slice(0, 6), 16) || 0;
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};
export const mixc = (a, b, t) => { a = rgb(a); b = rgb(b); return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; };
export const shadec = (c, k) => { c = rgb(c); return k >= 0 ? [c[0] + (1 - c[0]) * k, c[1] + (1 - c[1]) * k, c[2] + (1 - c[2]) * k] : [c[0] * (1 + k), c[1] * (1 + k), c[2] * (1 + k)]; };
export function hash01(n) { n = Math.imul((n | 0) ^ 0x9e3779b9, 0x85ebca6b); n ^= n >>> 13; n = Math.imul(n, 0xc2b2ae35); n ^= n >>> 16; return (n >>> 0) / 4294967296; }
export function srand(seed) { let s = (seed | 0) || 1; return () => { s = Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x6d2b79f5 | 0; return ((s ^ (s >>> 13)) >>> 0) / 4294967296; }; }

const ident = () => [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]; // 3x3 (column major) + translation

const STRIDE = 11;

export class Geo {
  constructor(cap = 0) {
    this.d = new Float32Array(Math.max(1024, cap * STRIDE));
    this.n = 0; // floats used
    this.m = ident();
    this.stack = [];
    this.jit = 0; // per-face brightness variation (painterly low-poly look)
    this.seed = 1;
  }

  // ------------------------------------------------------------------ transform stack
  push() { this.stack.push(this.m.slice()); return this; }
  pop() { this.m = this.stack.pop() || ident(); return this; }
  // m = m * T
  apply(a) {
    const m = this.m, o = new Array(12);
    for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) o[c * 3 + r] = m[r] * a[c * 3] + m[3 + r] * a[c * 3 + 1] + m[6 + r] * a[c * 3 + 2];
    for (let r = 0; r < 3; r++) o[9 + r] = m[r] * a[9] + m[3 + r] * a[10] + m[6 + r] * a[11] + m[9 + r];
    this.m = o;
    return this;
  }
  at(x, y, z) { return this.apply([1, 0, 0, 0, 1, 0, 0, 0, 1, x, y, z]); }
  rotY(a) { const c = Math.cos(a), s = Math.sin(a); return this.apply([c, 0, -s, 0, 1, 0, s, 0, c, 0, 0, 0]); }
  rotX(a) { const c = Math.cos(a), s = Math.sin(a); return this.apply([1, 0, 0, 0, c, s, 0, -s, c, 0, 0, 0]); }
  rotZ(a) { const c = Math.cos(a), s = Math.sin(a); return this.apply([c, s, 0, -s, c, 0, 0, 0, 1, 0, 0, 0]); }
  scale(x, y = x, z = x) { return this.apply([x, 0, 0, 0, y, 0, 0, 0, z, 0, 0, 0]); }
  P(p) { const m = this.m; return [m[0] * p[0] + m[3] * p[1] + m[6] * p[2] + m[9], m[1] * p[0] + m[4] * p[1] + m[7] * p[2] + m[10], m[2] * p[0] + m[5] * p[1] + m[8] * p[2] + m[11]]; }
  N(n) {
    // inverse-transpose for non-uniform scales (cofactor matrix is enough before normalising)
    const m = this.m;
    const a = m[0], b = m[3], c = m[6], d = m[1], e = m[4], f = m[7], g = m[2], h = m[5], i = m[8];
    const x = (e * i - f * h) * n[0] + (f * g - d * i) * n[1] + (d * h - e * g) * n[2];
    const y = (c * h - b * i) * n[0] + (a * i - c * g) * n[1] + (b * g - a * h) * n[2];
    const z = (b * f - c * e) * n[0] + (c * d - a * f) * n[1] + (a * e - b * d) * n[2];
    const l = Math.sqrt(x * x + y * y + z * z) || 1;
    return [x / l, y / l, z / l];
  }

  // ------------------------------------------------------------------ raw writes
  grow(k) {
    if (this.n + k <= this.d.length) return;
    let cap = this.d.length * 2;
    while (cap < this.n + k) cap *= 2;
    const nd = new Float32Array(cap);
    nd.set(this.d.subarray(0, this.n));
    this.d = nd;
  }
  vert(p, nr, c, uv) {
    const d = this.d, i = this.n;
    d[i] = p[0]; d[i + 1] = p[1]; d[i + 2] = p[2];
    d[i + 3] = nr[0]; d[i + 4] = nr[1]; d[i + 5] = nr[2];
    d[i + 6] = c[0]; d[i + 7] = c[1]; d[i + 8] = c[2];
    d[i + 9] = uv ? uv[0] : 0; d[i + 10] = uv ? uv[1] : 0;
    this.n = i + STRIDE;
  }
  paint(col, a, b, c) {
    let k = rgb(col);
    if (this.jit) {
      const h = hash01(Math.round((a[0] + b[0] + c[0]) * 7.1) * 73856093 ^ Math.round((a[1] + b[1] + c[1]) * 7.3) * 19349663 ^ Math.round((a[2] + b[2] + c[2]) * 6.9) * 83492791 ^ this.seed);
      k = shadec(k, (h - 0.5) * this.jit);
    }
    return k;
  }
  // flat triangle (world-space via the stack), counter-clockwise seen from outside
  tri(a, b, c, col, ua, ub, uc) {
    this.grow(STRIDE * 3);
    a = this.P(a); b = this.P(b); c = this.P(c);
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    const nr = [nx / l, ny / l, nz / l];
    const k = this.paint(col, a, b, c);
    this.vert(a, nr, k, ua); this.vert(b, nr, k, ub); this.vert(c, nr, k, uc);
    return this;
  }
  quad(a, b, c, d, col, uv) {
    this.tri(a, b, c, col, uv?.[0], uv?.[1], uv?.[2]);
    return this.tri(a, c, d, col, uv?.[0], uv?.[2], uv?.[3]);
  }
  // both windings (thin sheets seen from either side)
  tri2(a, b, c, col) { this.tri(a, b, c, col); return this.tri(a, c, b, col); }
  quad2(a, b, c, d, col) { this.quad(a, b, c, d, col); return this.quad(a, d, c, b, col); }
  // smooth triangle with explicit (local) normals and optional per-vertex colours
  triS(a, b, c, na, nb, nc, ca, cb = ca, cc = ca, ua, ub, uc) {
    this.grow(STRIDE * 3);
    this.vert(this.P(a), this.N(na), rgb(ca), ua); this.vert(this.P(b), this.N(nb), rgb(cb), ub); this.vert(this.P(c), this.N(nc), rgb(cc), uc);
    return this;
  }
  // gradient quad (flat normal, per-vertex colours)
  quadG(a, b, c, d, ca, cb, cc, cd) {
    const A = this.P(a), B = this.P(b), C = this.P(c);
    const ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2], vx = C[0] - A[0], vy = C[1] - A[1], vz = C[2] - A[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    const nr = [nx / l, ny / l, nz / l];
    const D = this.P(d);
    this.grow(STRIDE * 6);
    const [k1, k2, k3, k4] = [ca, cb, cc, cd].map(rgb);
    this.vert(A, nr, k1); this.vert(B, nr, k2); this.vert(C, nr, k3);
    this.vert(A, nr, k1); this.vert(C, nr, k3); this.vert(D, nr, k4);
    return this;
  }

  // ------------------------------------------------------------------ primitives
  box(x0, y0, z0, x1, y1, z1, col) {
    const c = typeof col === 'object' && !Array.isArray(col) ? col : { top: col, side: col, bottom: col };
    const side = c.side ?? c.top, top = c.top ?? side, bot = c.bottom ?? side, front = c.front ?? side;
    const p = (x, y, z) => [x, y, z];
    this.quad(p(x0, y1, z1), p(x1, y1, z1), p(x1, y1, z0), p(x0, y1, z0), top);
    this.quad(p(x0, y0, z0), p(x1, y0, z0), p(x1, y0, z1), p(x0, y0, z1), bot);
    this.quad(p(x0, y0, z1), p(x1, y0, z1), p(x1, y1, z1), p(x0, y1, z1), front);
    this.quad(p(x1, y0, z0), p(x0, y0, z0), p(x0, y1, z0), p(x1, y1, z0), side);
    this.quad(p(x1, y0, z1), p(x1, y0, z0), p(x1, y1, z0), p(x1, y1, z1), side);
    this.quad(p(x0, y0, z0), p(x0, y0, z1), p(x0, y1, z1), p(x0, y1, z0), side);
    return this;
  }
  // rounded-ish slab: a box with chamfered vertical edges (hoods, plinths, desks)
  slab(x0, y0, z0, x1, y1, z1, ch, col) {
    const c = typeof col === 'object' && !Array.isArray(col) ? col : { top: col, side: col, bottom: col };
    const pts = [[x0 + ch, z0], [x1 - ch, z0], [x1, z0 + ch], [x1, z1 - ch], [x1 - ch, z1], [x0 + ch, z1], [x0, z1 - ch], [x0, z0 + ch]];
    const n = pts.length;
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      this.quad([b[0], y0, b[1]], [a[0], y0, a[1]], [a[0], y1, a[1]], [b[0], y1, b[1]], (a[1] === b[1] && a[1] === z1) ? (c.front ?? c.side) : c.side);
      this.tri([cx, y1, cz], [b[0], y1, b[1]], [a[0], y1, a[1]], c.top ?? c.side);
      this.tri([cx, y0, cz], [a[0], y0, a[1]], [b[0], y0, b[1]], c.bottom ?? c.side);
    }
    return this;
  }
  cyl(r0, r1, h, seg = 8, col = '#ffffff', o = {}) {
    const rnd = o.jit ? srand(o.seed || 7) : null;
    const ring = (r, y) => {
      const out = [];
      for (let j = 0; j < seg; j++) {
        const a = (o.a0 || 0) + (j / seg) * Math.PI * 2;
        const k = rnd ? 1 + (rnd() - 0.5) * o.jit : 1;
        out.push([Math.cos(a) * r * k, y, Math.sin(a) * r * k]);
      }
      return out;
    };
    const A = ring(r0, 0), B = ring(r1, h);
    const colAt = typeof col === 'function' ? col : () => col;
    for (let j = 0; j < seg; j++) {
      const j2 = (j + 1) % seg;
      if (o.smooth) {
        const na = [A[j][0], (r0 - r1) / h * r0, A[j][2]], nb = [A[j2][0], (r0 - r1) / h * r0, A[j2][2]];
        this.triS(A[j], B[j], B[j2], na, na, nb, colAt(j));
        this.triS(A[j], B[j2], A[j2], na, nb, nb, colAt(j));
      } else this.quad(A[j2], A[j], B[j], B[j2], colAt(j));
    }
    if (o.caps !== false) {
      for (let j = 0; j < seg; j++) {
        const j2 = (j + 1) % seg;
        if (r1 > 0.0001) this.tri([0, h, 0], B[j2], B[j], o.capCol ?? colAt(j));
        if (r0 > 0.0001 && o.bottom !== false) this.tri([0, 0, 0], A[j], A[j2], o.capCol ?? colAt(j));
      }
    }
    return this;
  }
  // icosphere; o.smooth uses sphere normals (glossy), o.jit displaces vertices (lumpy)
  sphere(r, det = 1, col = '#ffffff', o = {}) {
    const { verts, faces } = icosa(det);
    const rnd = o.jit ? srand(o.seed || 3) : null;
    const sx = o.sx ?? 1, sy = o.sy ?? 1, sz = o.sz ?? 1;
    const P = verts.map((v) => {
      const k = rnd ? 1 + (rnd() - 0.5) * o.jit : 1;
      return [v[0] * r * k * sx, v[1] * r * k * sy, v[2] * r * k * sz];
    });
    const colAt = typeof col === 'function' ? col : () => col;
    for (let i = 0; i < faces.length; i++) {
      const [a, b, c] = faces[i];
      if (o.cut !== undefined && Math.min(verts[a][1], verts[b][1], verts[c][1]) < o.cut) continue;
      if (o.cutTop !== undefined && Math.max(verts[a][1], verts[b][1], verts[c][1]) > o.cutTop) continue;
      const cc = colAt(i, verts[a], verts[b], verts[c]);
      if (o.smooth) {
        const nn = (v) => [v[0] / sx, v[1] / sy, v[2] / sz];
        if (o.inside) this.triS(P[a], P[c], P[b], nn(verts[a]).map((x) => -x), nn(verts[c]).map((x) => -x), nn(verts[b]).map((x) => -x), cc);
        else this.triS(P[a], P[b], P[c], nn(verts[a]), nn(verts[b]), nn(verts[c]), cc);
      } else if (o.inside) this.tri(P[a], P[c], P[b], cc);
      else this.tri(P[a], P[b], P[c], cc);
    }
    return this;
  }
  // profile [[r, y], ...] bottom to top; colFn(i, j) or a colour
  lathe(prof, seg = 10, col = '#ffffff', o = {}) {
    const colAt = typeof col === 'function' ? col : () => col;
    const rings = prof.map(([r, y]) => {
      const out = [];
      for (let j = 0; j < seg; j++) { const a = (o.a0 || 0) + (j / seg) * Math.PI * 2; out.push([Math.cos(a) * r, y, Math.sin(a) * r]); }
      return out;
    });
    for (let i = 0; i < prof.length - 1; i++) {
      for (let j = 0; j < seg; j++) {
        const j2 = (j + 1) % seg;
        const a = rings[i][j], b = rings[i][j2], c = rings[i + 1][j2], d = rings[i + 1][j];
        const cc = colAt(i, j);
        if (o.smooth) {
          const nr = (k, jj) => {
            const [r0, y0] = prof[Math.max(0, k - 1)], [r1, y1] = prof[Math.min(prof.length - 1, k + 1)];
            const dy = y1 - y0, dr = r1 - r0;
            const ang = (o.a0 || 0) + (jj / seg) * Math.PI * 2;
            return [Math.cos(ang) * dy, -dr, Math.sin(ang) * dy];
          };
          const s = o.inside ? -1 : 1;
          const N = (k, jj) => nr(k, jj).map((x) => x * s);
          if (o.inside) { this.triS(a, c, b, N(i, j), N(i + 1, j2), N(i, j2), cc); this.triS(a, d, c, N(i, j), N(i + 1, j), N(i + 1, j2), cc); }
          else { this.triS(a, d, c, N(i, j), N(i + 1, j), N(i + 1, j2), cc); this.triS(a, c, b, N(i, j), N(i + 1, j2), N(i, j2), cc); }
        } else if (o.inside) this.quad(a, b, c, d, cc);
        else this.quad(b, a, d, c, cc);
      }
    }
    if (o.capTop) for (let j = 0; j < seg; j++) { const r = rings[rings.length - 1]; const y = prof[prof.length - 1][1]; this.tri([0, y, 0], r[(j + 1) % seg], r[j], o.capTop === true ? colAt(prof.length - 2, j) : o.capTop); }
    if (o.capBot) for (let j = 0; j < seg; j++) { const r = rings[0]; const y = prof[0][1]; this.tri([0, y, 0], r[j], r[(j + 1) % seg], o.capBot === true ? colAt(0, j) : o.capBot); }
    return this;
  }
  rock(r, seed = 1, col = '#8a8f9a', o = {}) {
    const old = this.jit, os = this.seed;
    this.jit = o.paint ?? 0.22; this.seed = seed;
    const rnd = srand(seed * 31 + 5);
    this.push();
    this.scale(1, o.sy ?? 0.7, o.sz ?? 1);
    this.sphere(r, o.det ?? 1, col, { jit: o.lump ?? 0.45, seed, cut: o.flat ?? -0.35 });
    this.pop();
    void rnd;
    this.jit = old; this.seed = os;
    return this;
  }
  // swept tube through points (local coords); r: number or per-point array
  tube(pts, r, seg = 6, col = '#ffffff', o = {}) {
    const n = pts.length;
    const R = (i) => (Array.isArray(r) ? r[i] : r);
    const colAt = typeof col === 'function' ? col : () => col;
    const rings = [];
    let prevN = null;
    for (let i = 0; i < n; i++) {
      const p = pts[i], q = pts[Math.min(n - 1, i + 1)], pp = pts[Math.max(0, i - 1)];
      let t = [q[0] - pp[0], q[1] - pp[1], q[2] - pp[2]];
      const tl = Math.hypot(...t) || 1; t = t.map((x) => x / tl);
      let nrm = prevN || (Math.abs(t[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]);
      // make nrm perpendicular to t
      const dt = nrm[0] * t[0] + nrm[1] * t[1] + nrm[2] * t[2];
      nrm = [nrm[0] - t[0] * dt, nrm[1] - t[1] * dt, nrm[2] - t[2] * dt];
      const nl = Math.hypot(...nrm) || 1; nrm = nrm.map((x) => x / nl);
      prevN = nrm;
      const b = [t[1] * nrm[2] - t[2] * nrm[1], t[2] * nrm[0] - t[0] * nrm[2], t[0] * nrm[1] - t[1] * nrm[0]];
      const ring = [];
      for (let j = 0; j < seg; j++) {
        const a = (j / seg) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
        ring.push([p[0] + (nrm[0] * c + b[0] * s) * R(i), p[1] + (nrm[1] * c + b[1] * s) * R(i), p[2] + (nrm[2] * c + b[2] * s) * R(i)]);
      }
      rings.push(ring);
    }
    for (let i = 0; i < n - 1; i++) for (let j = 0; j < seg; j++) {
      const j2 = (j + 1) % seg;
      this.quad(rings[i][j], rings[i][j2], rings[i + 1][j2], rings[i + 1][j], colAt(i, j));
    }
    if (o.caps !== false) {
      for (let j = 0; j < seg; j++) {
        const j2 = (j + 1) % seg;
        if (R(0) > 0.001) this.tri(pts[0], rings[0][j2], rings[0][j], colAt(0, j));
        if (R(n - 1) > 0.001) this.tri(pts[n - 1], rings[n - 1][j], rings[n - 1][j2], colAt(n - 2, j));
      }
    }
    return this;
  }
  // double-sided ribbon along a spine; side = direction the width spreads in (local)
  blade(pts, widths, col, side = [1, 0, 0], col2 = null) {
    const n = pts.length;
    const colAt = typeof col === 'function' ? col : () => col;
    for (let i = 0; i < n - 1; i++) {
      const w0 = (Array.isArray(widths) ? widths[i] : widths) / 2, w1 = (Array.isArray(widths) ? widths[i + 1] : widths) / 2;
      const a = pts[i], b = pts[i + 1];
      const s0 = Array.isArray(side[0]) ? side[i] : side, s1 = Array.isArray(side[0]) ? side[i + 1] : side;
      const A = [a[0] - s0[0] * w0, a[1] - s0[1] * w0, a[2] - s0[2] * w0], B = [a[0] + s0[0] * w0, a[1] + s0[1] * w0, a[2] + s0[2] * w0];
      const C = [b[0] + s1[0] * w1, b[1] + s1[1] * w1, b[2] + s1[2] * w1], D = [b[0] - s1[0] * w1, b[1] - s1[1] * w1, b[2] - s1[2] * w1];
      const c = colAt(i);
      if (w1 < 0.0001) { this.tri(A, B, C, c); this.tri(A, C, B, col2 ? col2 : c); }
      else { this.quad(A, B, C, D, c); this.quad(A, D, C, B, col2 ? col2 : c); }
    }
    return this;
  }
  // flat polygon fan (outline in local x/y at z), double sided
  fan(outline, col) {
    for (let i = 1; i < outline.length - 1; i++) this.tri2(outline[0], outline[i], outline[i + 1], col);
    return this;
  }

  // fast per-frame instancing: copy a template (raw vertex data) translated, scaled and turned about y, with an
  // optional flat colour override (no allocations; batches of bubbles, drops, food)
  stamp(tpl, x, y, z, s = 1, yaw = 0, col = null) {
    const n = tpl.length;
    this.grow(n);
    const d = this.d;
    let o = this.n;
    const c = Math.cos(yaw), sn = Math.sin(yaw);
    for (let i = 0; i < n; i += STRIDE) {
      const px = tpl[i], pz = tpl[i + 2], nx = tpl[i + 3], nz = tpl[i + 5];
      d[o] = x + (px * c + pz * sn) * s; d[o + 1] = y + tpl[i + 1] * s; d[o + 2] = z + (-px * sn + pz * c) * s;
      d[o + 3] = nx * c + nz * sn; d[o + 4] = tpl[i + 4]; d[o + 5] = -nx * sn + nz * c;
      if (col) { d[o + 6] = col[0]; d[o + 7] = col[1]; d[o + 8] = col[2]; } else { d[o + 6] = tpl[i + 6]; d[o + 7] = tpl[i + 7]; d[o + 8] = tpl[i + 8]; }
      d[o + 9] = tpl[i + 9]; d[o + 10] = tpl[i + 10];
      o += STRIDE;
    }
    this.n = o;
    return this;
  }

  // append another Geo's raw data (already in world space)
  merge(other) {
    this.grow(other.n);
    this.d.set(other.d.subarray(0, other.n), this.n);
    this.n += other.n;
    return this;
  }

  bounds() {
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    const d = this.d;
    for (let i = 0; i < this.n; i += STRIDE) for (let k = 0; k < 3; k++) { const v = d[i + k]; if (v < min[k]) min[k] = v; if (v > max[k]) max[k] = v; }
    const center = [0, 1, 2].map((k) => (min[k] + max[k]) / 2);
    const radius = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2 || 1;
    return { min, max, center, radius };
  }

  build() {
    if (!this.n) return null;
    const data = this.d.slice(0, this.n);
    return new LPMesh(data, this.n / STRIDE, this.bounds());
  }
}

// Geometry rebuilt every frame into one LPMesh (re-uploaded on change).
export class DynMesh {
  constructor(cap = 4096) { this.g = new Geo(cap); this.mesh = null; }
  begin() { const g = this.g; g.n = 0; g.m = ident(); g.stack.length = 0; g.jit = 0; return g; }
  end() {
    const g = this.g;
    if (!g.n) return null;
    if (!this.mesh) this.mesh = new LPMesh(null, 0, { min: [0, 0, 0], max: [0, 0, 0], center: [0, 0, 0], radius: 1 });
    const m = this.mesh;
    m.dispose();
    m.data = g.d.subarray(0, g.n);
    m.count = g.n / STRIDE;
    return m;
  }
}

// template meshes (raw vertex data) for stamp(): unit sphere (det 0 / 1), unit coin, unit flake
const TPL = {};
export function template(name) {
  if (TPL[name]) return TPL[name];
  const g = new Geo();
  if (name === 'ball0') g.sphere(1, 0, '#ffffff', { smooth: true });
  else if (name === 'ball1') g.sphere(1, 1, '#ffffff', { smooth: true });
  else if (name === 'coin') { g.rotX(Math.PI / 2); g.at(0, -0.11, 0); g.cyl(0.62, 0.62, 0.22, 10, '#22b4ec', { capCol: '#9af0ff' }); }
  else if (name === 'flake') g.box(-1, -0.35, -0.7, 1, 0.35, 0.7, '#ffffff');
  TPL[name] = g.d.slice(0, g.n);
  return TPL[name];
}

// ------------------------------------------------------------------ icosphere cache
const ICO = new Map();
function icosa(det) {
  let c = ICO.get(det);
  if (c) return c;
  const t = (1 + Math.sqrt(5)) / 2;
  let verts = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map(nrm);
  let faces = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  for (let k = 0; k < det; k++) {
    const mid = new Map();
    const m = (a, b) => {
      const key = a < b ? a * 65536 + b : b * 65536 + a;
      let i = mid.get(key);
      if (i === undefined) { i = verts.length; verts.push(nrm([(verts[a][0] + verts[b][0]) / 2, (verts[a][1] + verts[b][1]) / 2, (verts[a][2] + verts[b][2]) / 2])); mid.set(key, i); }
      return i;
    };
    const nf = [];
    for (const [a, b, cc] of faces) { const ab = m(a, b), bc = m(b, cc), ca = m(cc, a); nf.push([a, ab, ca], [b, bc, ab], [cc, ca, bc], [ab, bc, ca]); }
    faces = nf;
  }
  c = { verts, faces };
  ICO.set(det, c);
  return c;
}
function nrm(v) { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }
