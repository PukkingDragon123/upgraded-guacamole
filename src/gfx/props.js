// Voxel props for every biome, the aquarium and the shop. Each prop is a hand-built,
// seeded voxel model rendered once (cached) by voxel.js into a pixel-art sprite.
//
// getProp(id, {scale, variant, frame}) -> {canvas, glow, ox, oy, w, h, screens, lights, anchors?, front?}
//   (ox, oy) = ground contact point (footprint centre); draw at (x - ox, y - oy).
//   screens: [{x, y, w, h}] emissive screen faces (largest inner rect) for animated content.
//   lights:  [{x, y, r, color}] suggested light sources, canvas-relative.
//   shop_stall also returns `front` (counter-only overlay to draw after the shopkeeper) and
//   `anchors.keeper` (where the shopkeeper's feet go), both canvas-relative.
// PROPS[id] = {name, biome, tags, decor: {price, size: 1 small | 2 medium | 3 large} | null}
// PROP_VARIANTS[id] = [{variant, frame, label}] notable variants/frames (for galleries and shops).

import { VoxelModel, renderVoxels } from './voxel.js';
import { RNG } from '../core/rng.js';
import { hash3, clamp } from '../core/math.js';

// ---------- noise (fast permutation-table value noise) ----------
const PERM = new Uint8Array(512);
const NVAL = new Float32Array(256);
{
  const r = new RNG(1337);
  const p = [...Array(256).keys()];
  r.shuffle(p);
  for (let i = 0; i < 512; i++) PERM[i] = p[i & 255];
  for (let i = 0; i < 256; i++) NVAL[i] = r.next();
}
const sm = (t) => t * t * (3 - 2 * t);
export function noise3(x, y, z, seed = 0) {
  x += seed * 17.13; y += seed * 7.71; z += seed * 3.37;
  const fx0 = Math.floor(x), fy0 = Math.floor(y), fz0 = Math.floor(z);
  const ix = fx0 & 255, iy = fy0 & 255, iz = fz0 & 255;
  const ix1 = (ix + 1) & 255, iy1 = (iy + 1) & 255, iz1 = (iz + 1) & 255;
  const fx = sm(x - fx0), fy = sm(y - fy0), fz = sm(z - fz0);
  const a0 = PERM[ix], a1 = PERM[ix1];
  const b00 = PERM[a0 + iy], b01 = PERM[a0 + iy1], b10 = PERM[a1 + iy], b11 = PERM[a1 + iy1];
  const v = (b, k) => NVAL[PERM[b + k]];
  const x00 = v(b00, iz) + (v(b10, iz) - v(b00, iz)) * fx;
  const x10 = v(b01, iz) + (v(b11, iz) - v(b01, iz)) * fx;
  const x01 = v(b00, iz1) + (v(b10, iz1) - v(b00, iz1)) * fx;
  const x11 = v(b01, iz1) + (v(b11, iz1) - v(b01, iz1)) * fx;
  const y0 = x00 + (x10 - x00) * fy, y1 = x01 + (x11 - x01) * fy;
  return y0 + (y1 - y0) * fz;
}
export function fbm3(x, y, z, oct = 3, seed = 0) {
  let v = 0, a = 0.5, f = 1, n = 0;
  for (let i = 0; i < oct; i++) { v += noise3(x * f, y * f, z * f, seed + i * 13) * a; n += a; a *= 0.5; f *= 2; }
  return v / n;
}
const h3 = (x, y, z, s = 0) => hash3(x, y, z, s);

// ---------- modelling helpers ----------

// Generic implicit shape over a bounding box: test(x, y, z) at voxel centres.
function shape(m, x0, y0, z0, x1, y1, z1, test, c) {
  for (let y = Math.floor(y0); y <= Math.ceil(y1); y++) for (let z = Math.floor(z0); z <= Math.ceil(z1); z++) for (let x = Math.floor(x0); x <= Math.ceil(x1); x++) {
    if (test(x + 0.5, y + 0.5, z + 0.5)) m.put(x, y, z, c);
  }
}

// A sub-model sharing the parent's palette (for building parts that get rotated in).
function part(m, nx, ny, nz) {
  const p = new VoxelModel(nx, ny, nz);
  p.palette = m.palette;
  return p;
}

function rotMat(rx, ry, rz) {
  const a = rx * Math.PI / 180, b = ry * Math.PI / 180, c = rz * Math.PI / 180;
  const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b), cc = Math.cos(c), sc = Math.sin(c);
  const Rz = [[cc, -sc, 0], [sc, cc, 0], [0, 0, 1]];
  const Rx = [[1, 0, 0], [0, ca, -sa], [0, sa, ca]];
  const Ry = [[cb, 0, sb], [0, 1, 0], [-sb, 0, cb]];
  const mul = (A, B) => A.map((row, i) => [0, 1, 2].map((j) => row[0] * B[0][j] + row[1] * B[1][j] + row[2] * B[2][j]));
  return mul(Ry, mul(Rx, Rz));
}

// Stamp `src` into `dst` rotated (degrees, applied z, then x, then y) so that src point `sp` lands on dst point `dp`.
function stampRot(dst, src, sp, dp, rx = 0, ry = 0, rz = 0) {
  const R = rotMat(rx, ry, rz);
  const b = src.bounds();
  if (!b) return;
  let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < 8; i++) {
    const q = [(i & 1 ? b.x1 + 1 : b.x0) - sp[0], (i & 2 ? b.y1 + 1 : b.y0) - sp[1], (i & 4 ? b.z1 + 1 : b.z0) - sp[2]];
    for (let k = 0; k < 3; k++) {
      const v = R[k][0] * q[0] + R[k][1] * q[1] + R[k][2] * q[2] + dp[k];
      lo[k] = Math.min(lo[k], v); hi[k] = Math.max(hi[k], v);
    }
  }
  for (let y = Math.floor(lo[1]); y <= Math.ceil(hi[1]); y++) for (let z = Math.floor(lo[2]); z <= Math.ceil(hi[2]); z++) for (let x = Math.floor(lo[0]); x <= Math.ceil(hi[0]); x++) {
    const px = x + 0.5 - dp[0], py = y + 0.5 - dp[1], pz = z + 0.5 - dp[2];
    // R^T * p
    const qx = R[0][0] * px + R[1][0] * py + R[2][0] * pz + sp[0];
    const qy = R[0][1] * px + R[1][1] * py + R[2][1] * pz + sp[1];
    const qz = R[0][2] * px + R[1][2] * py + R[2][2] * pz + sp[2];
    const v = src.get(Math.floor(qx), Math.floor(qy), Math.floor(qz));
    if (v) dst.put(x, y, z, v);
  }
  // Forward-splat source voxel centres too, so thin shells stay watertight after rotation.
  for (let z = b.z0; z <= b.z1; z++) for (let y = b.y0; y <= b.y1; y++) for (let x = b.x0; x <= b.x1; x++) {
    const v = src.get(x, y, z);
    if (!v) continue;
    const px = x + 0.5 - sp[0], py = y + 0.5 - sp[1], pz = z + 0.5 - sp[2];
    const tx = Math.floor(R[0][0] * px + R[0][1] * py + R[0][2] * pz + dp[0]);
    const ty = Math.floor(R[1][0] * px + R[1][1] * py + R[1][2] * pz + dp[1]);
    const tz = Math.floor(R[2][0] * px + R[2][1] * py + R[2][2] * pz + dp[2]);
    if (!dst.get(tx, ty, tz)) dst.put(tx, ty, tz, v);
  }
}

// Prism/crystal shaft from p0 along dir, polygonal cross-section, pointed tip.
function shaft(m, p0, dir, len, r, tip, c, sides = 6, rot = 0) {
  const dl = Math.hypot(...dir);
  const d = dir.map((v) => v / dl);
  const up = Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  let a = [d[1] * up[2] - d[2] * up[1], d[2] * up[0] - d[0] * up[2], d[0] * up[1] - d[1] * up[0]];
  const al = Math.hypot(...a); a = a.map((v) => v / al);
  const bv = [d[1] * a[2] - d[2] * a[1], d[2] * a[0] - d[0] * a[2], d[0] * a[1] - d[1] * a[0]];
  const end = [p0[0] + d[0] * len, p0[1] + d[1] * len, p0[2] + d[2] * len];
  const R = r + 1;
  const apo = Math.cos(Math.PI / sides);
  const sector = (Math.PI * 2) / sides;
  shape(m, Math.min(p0[0], end[0]) - R, Math.min(p0[1], end[1]) - R, Math.min(p0[2], end[2]) - R,
    Math.max(p0[0], end[0]) + R, Math.max(p0[1], end[1]) + R, Math.max(p0[2], end[2]) + R, (x, y, z) => {
      const px = x - p0[0], py = y - p0[1], pz = z - p0[2];
      const t = px * d[0] + py * d[1] + pz * d[2];
      if (t < -0.5 || t > len) return false;
      const u = px * a[0] + py * a[1] + pz * a[2], v = px * bv[0] + py * bv[1] + pz * bv[2];
      const ang = Math.atan2(v, u) - rot;
      const k = ((ang % sector) + sector) % sector - sector / 2;
      const dist = Math.hypot(u, v) * Math.cos(k) / apo;
      const rr = t > len - tip ? r * (len - t) / tip : r;
      return dist <= rr;
    }, c);
}

// Faceted convex rock: intersection of planes tangent to an ellipsoid (reads as chiselled stone).
function facetRock(m, rng, cx, cy, cz, rx, ry, rz, c, planes = 16, floor = 0, cut = 0.82) {
  const P = [];
  const off = rng.float(0, Math.PI * 2);
  for (let i = 0; i < planes; i++) {
    const t = (i + 0.5) / planes;
    const yy = 1 - 2 * t * 0.92 - 0.04;
    const rr = Math.sqrt(Math.max(0, 1 - yy * yy));
    const th = off + i * 2.39996 + rng.float(-0.3, 0.3);
    let nx = Math.cos(th) * rr, ny = yy + rng.float(-0.12, 0.12), nz = Math.sin(th) * rr;
    const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    const h = Math.sqrt((rx * nx) ** 2 + (ry * ny) ** 2 + (rz * nz) ** 2) * rng.float(cut, 1);
    P.push(nx, ny, nz, h);
  }
  shape(m, cx - rx, Math.max(floor, cy - ry), cz - rz, cx + rx, cy + ry, cz + rz, (x, y, z) => {
    if (y < floor) return false;
    const dx = x - cx, dy = y - cy, dz = z - cz;
    if ((dx / rx) ** 2 + (dy / ry) ** 2 + (dz / rz) ** 2 > 1.05) return false;
    for (let i = 0; i < P.length; i += 4) if (dx * P[i] + dy * P[i + 1] + dz * P[i + 2] > P[i + 3]) return false;
    return true;
  }, c);
}

// Organic blob: ellipsoid displaced by fbm noise.
function blob(m, cx, cy, cz, rx, ry, rz, amp, freq, seed, c, flatBottom = -Infinity) {
  shape(m, cx - rx * (1 + amp), Math.max(flatBottom, cy - ry * (1 + amp)), cz - rz * (1 + amp), cx + rx * (1 + amp), cy + ry * (1 + amp), cz + rz * (1 + amp), (x, y, z) => {
    if (y < flatBottom) return false;
    const dx = (x - cx) / rx, dy = (y - cy) / ry, dz = (z - cz) / rz;
    const d = dx * dx + dy * dy + dz * dz;
    if (d > (1 + amp) * (1 + amp)) return false;
    const n = fbm3(x * freq, y * freq, z * freq, 2, seed) - 0.5;
    return Math.sqrt(d) <= 1 + n * amp * 2;
  }, c);
}

// Torus around `axis` ('x' | 'y' | 'z') centred at (cx, cy, cz).
function torus(m, cx, cy, cz, R, r, c, axis = 'y', arc = null) {
  const e = R + r + 1;
  shape(m, cx - e, cy - e, cz - e, cx + e, cy + e, cz + e, (x, y, z) => {
    let a, b, h;
    const dx = x - cx, dy = y - cy, dz = z - cz;
    if (axis === 'y') { a = dx; b = dz; h = dy; } else if (axis === 'x') { a = dy; b = dz; h = dx; } else { a = dx; b = dy; h = dz; }
    if (arc && !arc(Math.atan2(b, a))) return false;
    const q = Math.hypot(a, b) - R;
    return q * q + h * h <= r * r;
  }, c);
}

// Noise-picked tone from a list (patchy material variation).
function patch(list, freq, seed, bias = 0) {
  return (x, y, z) => {
    const n = clamp(fbm3(x * freq, y * freq, z * freq, 2, seed) * 1.6 - 0.3 + bias, 0, 0.999);
    return list[Math.floor(n * list.length)];
  };
}

// Recolour exposed voxels: fn(x, y, z, prev) -> idx | null.
function surface(m, fn) {
  m.recolor((x, y, z, prev) => (m.exposed(x, y, z) ? fn(x, y, z, prev) : null));
}

const topOpen = (m, x, y, z) => !m.get(x, y + 1, z);

// Collect exposed voxels matching `on` and facing ('top' | 'side' | 'front' | 'any').
function candidates(m, on, facing) {
  const set = on == null ? null : new Set(Array.isArray(on) ? on : [on]);
  const out = [];
  const { nx, ny, nz } = m;
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    const v = m.get(x, y, z);
    if (!v || (set && !set.has(v)) || m.palette[v].emissive || m.palette[v].noDecal) continue;
    const top = !m.get(x, y + 1, z);
    const front = !m.get(x, y, z + 1) || !m.get(x + 1, y, z);
    const side = front || !m.get(x - 1, y, z) || !m.get(x, y, z - 1);
    if (facing === 'top' && !top) continue;
    if (facing === 'side' && (!side || top)) continue;
    if (facing === 'front' && (!front || top)) continue;
    if (facing === 'any' && !top && !side) continue;
    out.push([x, y, z]);
  }
  return out;
}

function scatter(m, rng, count, on, facing, place) {
  const cand = candidates(m, on, facing);
  for (let i = 0; i < count && cand.length; i++) {
    const k = Math.floor(rng.next() * cand.length);
    const [x, y, z] = cand[k];
    cand[k] = cand[cand.length - 1];
    cand.pop();
    let nx = 0, nz = 0;
    if (!m.get(x, y, z + 1)) nz = 1; else if (!m.get(x + 1, y, z)) nx = 1; else if (!m.get(x - 1, y, z)) nx = -1; else if (!m.get(x, y, z - 1)) nz = -1;
    place(x, y, z, nx, nz, i);
  }
}

// Moss / algae carpet on upward-facing surfaces, with a few tufts.
function moss(m, rng, seed, colors, amount = 0.5, freq = 0.14, on = null) {
  const idx = colors.map((c) => m.color(c, { jitter: 0.12, smooth: 0.3 }));
  const set = on ? new Set(on) : null;
  m.recolor((x, y, z, p) => {
    if (set && !set.has(p)) return null;
    if (m.palette[p].emissive || m.palette[p].noDecal) return null;
    if (!topOpen(m, x, y, z)) return null;
    const n = fbm3(x * freq, y * freq * 0.7, z * freq, 2, seed + 31);
    if (n < 1 - amount) return null;
    return n > 1 - amount * 0.45 ? idx[0] : idx[1];
  });
  // Moss edge creeping one voxel down the sides.
  m.recolor((x, y, z, p) => {
    if (set && !set.has(p)) return null;
    if (p === idx[0] || p === idx[1] || p === idx[2]) return null;
    const up = m.get(x, y + 1, z);
    return (up === idx[0] || up === idx[1]) && h3(x, y, z, seed) < 0.55 ? idx[2] : null;
  });
  scatter(m, rng, Math.round(m.nx * amount * 0.25), [idx[0], idx[1]], 'top', (x, y, z) => {
    m.set(x, y + 1, z, idx[1]);
    if (rng.chance(0.4)) m.set(x, y + 2, z, idx[0]);
  });
  return idx;
}

// Barnacle clusters on side faces.
function barnacles(m, rng, count, on = null) {
  const b0 = m.color('#efe4d2', { jitter: 0.12 });
  const b1 = m.color('#c9b9a8', { jitter: 0.12 });
  const hole = m.color('#4a3a52', { jitter: 0 });
  scatter(m, rng, count, on, 'front', (x, y, z, nx, nz) => {
    const ox = x + nx, oz = z + nz;
    const tx = nz ? 1 : 0, tz = nx ? 1 : 0;
    m.set(ox, y, oz, hole);
    m.set(ox - tx, y, oz - tz, b0); m.set(ox + tx, y, oz + tz, b1);
    m.set(ox, y + 1, oz, b0); m.set(ox, y - 1, oz, b1);
    if (rng.chance(0.5)) { m.set(ox + 2 * tx, y + 1, oz + 2 * tz, b0); m.set(ox + 2 * tx, y, oz + 2 * tz, b1); }
  });
}

// Sand drift (irregular, noisy low mound), returns sand indices.
function sandMound(m, cx, cz, rx, rz, hgt, seed, cols = SAND) {
  const idx = cols.map((c, i) => m.color(c, { jitter: 0.12, smooth: 0.6, light: i === 2 ? 0.2 : 0 }));
  shape(m, cx - rx - 2, 0, cz - rz - 2, cx + rx + 2, hgt + 2, cz + rz + 2, (x, y, z) => {
    const a = Math.atan2(z - cz, x - cx);
    const edge = 0.72 + 0.28 * noise3(Math.cos(a) * 1.6 + seed, Math.sin(a) * 1.6, 0.5, seed);
    const d = Math.sqrt(((x - cx) / rx) ** 2 + ((z - cz) / rz) ** 2) / edge;
    if (d > 1) return false;
    const hh = hgt * (1 - d * d) * (0.7 + 0.6 * noise3(x * 0.12, 3, z * 0.12, seed)) + 0.5;
    return y <= hh;
  }, (x, y, z) => {
    const r = h3(x, y, z, seed + 4);
    return r < 0.1 ? idx[2] : r < 0.35 ? idx[1] : idx[0];
  });
  return idx;
}

// Transform a point the same way stampRot does (src point -> dst point).
function xformPt(p, sp, dp, rx = 0, ry = 0, rz = 0) {
  const R = rotMat(rx, ry, rz);
  const q = [p[0] - sp[0], p[1] - sp[1], p[2] - sp[2]];
  return [0, 1, 2].map((k) => R[k][0] * q[0] + R[k][1] * q[1] + R[k][2] * q[2] + dp[k]);
}

// Chain of alternating links along a polyline of points.
function chain(m, pts, c, c2) {
  let k = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0, z0] = pts[i], [x1, y1, z1] = pts[i + 1];
    const L = Math.hypot(x1 - x0, y1 - y0, z1 - z0);
    const n = Math.max(1, Math.round(L / 2.2));
    for (let j = 0; j < n; j++, k++) {
      const t = (j + 0.5) / n;
      const x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t, z = z0 + (z1 - z0) * t;
      if (k % 2) m.box(x - 1, y - 0.5, z - 0.5, x + 1, y + 0.5, z + 0.5, c);
      else { m.set(x - 1, y, z, c2); m.set(x + 1, y, z, c2); m.set(x, y + 1, z, c2); m.set(x, y - 1, z, c2); }
    }
  }
}

// Recursive branching coral built from capsules.
function branchCoral(m, rng, p, dir, len, r, depth, colFn, tipFn, opts = {}) {
  const spread = opts.spread ?? 0.55, shrink = opts.shrink ?? 0.74, lenK = opts.lenK ?? 0.78;
  const steps = 3;
  let q = p.slice();
  let d = dir.slice();
  for (let i = 0; i < steps; i++) {
    // Slight wander + upward pull.
    d = [d[0] + rng.float(-0.18, 0.18), d[1] + (opts.up ?? 0.12), d[2] + rng.float(-0.18, 0.18)];
    const l = Math.hypot(...d); d = d.map((v) => v / l);
    const n = [q[0] + d[0] * len / steps, q[1] + d[1] * len / steps, q[2] + d[2] * len / steps];
    m.line(q[0], q[1], q[2], n[0], n[1], n[2], colFn, r * (1 - i * 0.06));
    q = n;
  }
  if (depth <= 0 || r * shrink < (opts.minR ?? 0.7)) {
    m.sphere(q[0], q[1] + 0.3, q[2], r * (opts.tipK ?? 1.15) + 0.2, tipFn);
    return;
  }
  const kids = depth > 1 && rng.chance(opts.three ?? 0.35) ? 3 : 2;
  for (let k = 0; k < kids; k++) {
    const ang = (k / kids) * Math.PI * 2 + rng.float(-0.6, 0.6);
    const nd = [d[0] + Math.cos(ang) * spread, d[1], d[2] + Math.sin(ang) * spread * (opts.flat ? 0.25 : 1)];
    branchCoral(m, rng, q, nd, len * lenK * rng.float(0.85, 1.1), r * shrink, depth - 1, colFn, tipFn, opts);
  }
}

function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

// ---------- shared palettes ----------
const SAND = ['#e8cf96', '#d8ba80', '#f6e4b4'];
const REEF_ROCK = ['#9a8a92', '#857789', '#ad9c96'];
const MOSS = ['#7fcf8c', '#4fa58a', '#3b8a82'];
const WOOD = ['#9c6136', '#8a532f', '#ae7140'];
const IRON = ['#5d6275', '#4b4f62'];
const RUST = ['#a4552f', '#c27840', '#7d3f2c'];

// ---------- prop definitions ----------
const DEFS = {};
function def(id, meta, build) {
  DEFS[id] = { meta: { name: meta.name, biome: meta.biome, tags: meta.tags || [], decor: meta.decor || null, decorOnly: !!meta.decorOnly }, build };
}

// ===================== SUNNY SHALLOWS =====================

function reefRock(m, rng, cols = REEF_ROCK) {
  return cols.map((c, i) => m.color(c, { jitter: 0.16, smooth: 0.8, light: i === 2 ? 0.15 : 0 }));
}
function stoneTex(m, idx, seed, freq = 0.12) {
  const set = new Set(idx);
  const pick = patch(idx, freq, seed);
  m.recolor((x, y, z, p) => (set.has(p) ? pick(x, y, z) : null));
  // Light flecks.
  m.recolor((x, y, z, p) => (set.has(p) && m.exposed(x, y, z) && h3(x, y, z, seed + 1) < 0.03 ? idx[2] : null));
}

def('rock_small', { name: 'Pebble Rock', biome: 'shallows', tags: ['rock'], decor: { price: 20, size: 1 } }, ({ rng }) => {
  const m = new VoxelModel(34, 18, 26);
  const st = reefRock(m, rng);
  const seed = rng.int(0, 999);
  facetRock(m, rng, 15, 4, 13, 12, 13, 10, st[0], 14);
  facetRock(m, rng, 26, 2, 15, 6.5, 7, 6, st[0], 10);
  facetRock(m, rng, 6, 1, 18, 3.5, 3, 3, st[1], 8);
  stoneTex(m, st, seed);
  moss(m, rng, seed, MOSS, 0.42);
  barnacles(m, rng, 2, st);
  return { m, yaw: 30 };
});

def('rock_big', { name: 'Reef Boulder', biome: 'shallows', tags: ['rock'], decor: { price: 60, size: 2 } }, ({ rng }) => {
  const m = new VoxelModel(60, 40, 44);
  const st = reefRock(m, rng);
  const seed = rng.int(0, 999);
  facetRock(m, rng, 26, 10, 22, 20, 26, 17, st[0], 18);
  facetRock(m, rng, 42, 6, 24, 14, 17, 14, st[0], 16);
  facetRock(m, rng, 13, 4, 27, 10, 10, 10, st[0], 14);
  facetRock(m, rng, 50, 2, 32, 6, 5, 6, st[1], 10);
  stoneTex(m, st, seed);
  // A dark crevice.
  m.sub(() => m.line(30, 4, 40, 36, 16, 40, 0, 1.2));
  moss(m, rng, seed, MOSS, 0.5);
  barnacles(m, rng, 7, st);
  // Small purple coral nubs on top.
  const nub = m.color('#b46bd6', { smooth: 0.5 }), nubT = m.color('#f0c4ff', { smooth: 0.5 });
  scatter(m, rng, 3, null, 'top', (x, y, z) => {
    m.line(x, y + 1, z, x + rng.float(-1, 1), y + 4, z, nub, 0.7);
    m.set(x, y + 4, z, nubT);
  });
  return { m, yaw: 30 };
});

def('rock_arch', { name: 'Rock Arch', biome: 'shallows', tags: ['rock', 'swimthrough'], decor: { price: 180, size: 3 } }, ({ rng }) => {
  const m = new VoxelModel(96, 66, 36);
  const st = reefRock(m, rng);
  const seed = rng.int(0, 999);
  const cx = 48, R = 31;
  for (let i = 0; i <= 10; i++) {
    const a = Math.PI * (i / 10);
    const x = cx + Math.cos(a) * R, y = Math.sin(a) * R * 1.02 + 6;
    const s = 12 - Math.sin(a) * 3 + rng.float(-1, 1);
    facetRock(m, rng, x, y, 18 + rng.float(-2, 2), s * 1.1, s, s * 0.95, st[0], 13, 0);
  }
  facetRock(m, rng, cx - R - 2, 7, 18, 15, 12, 15, st[0], 14);
  facetRock(m, rng, cx + R + 2, 6, 18, 14, 11, 14, st[0], 14);
  facetRock(m, rng, cx + R + 13, 3, 24, 6, 5, 6, st[1], 9);
  facetRock(m, rng, cx - R - 12, 2, 26, 4, 3.5, 4, st[1], 8);
  facetRock(m, rng, cx + 6, R + 12, 16, 8, 6, 8, st[0], 10);
  stoneTex(m, st, seed);
  const mi = moss(m, rng, seed, MOSS, 0.55);
  // Hanging kelp strands under the arch.
  const kelp = [m.color('#5fae6a', { smooth: 0.4 }), m.color('#8fd27a', { smooth: 0.4 })];
  for (let k = 0; k < 6; k++) {
    const x = cx + rng.float(-16, 16);
    const z = 18 + rng.int(-4, 4);
    let y = 0;
    for (let yy = 20; yy < 65; yy++) if (m.get(Math.round(x), yy, z)) { y = yy; break; }
    if (!y) continue;
    const len = rng.int(6, 14);
    for (let j = 1; j <= len; j++) m.set(Math.round(x + Math.sin(j * 0.9 + k) * 0.8), y - j, z, kelp[j % 3 === 0 ? 1 : 0]);
  }
  barnacles(m, rng, 8, st);
  void mi;
  return { m, yaw: 28 };
});

const CORAL_SCHEMES = [
  ['#ff7d55', '#ffd3a1', '#d9503f'], // coral orange
  ['#ff6fa6', '#ffd2e6', '#c94080'], // pink
  ['#9d7bf0', '#e6d8ff', '#6a4bc2'], // purple
  ['#ffc14d', '#fff0b5', '#d98a2b'], // yellow
];

def('coral_branch', { name: 'Tree Coral', biome: 'shallows', tags: ['coral'], decor: { price: 50, size: 1 } }, ({ rng, variant }) => {
  const sc = CORAL_SCHEMES[variant % CORAL_SCHEMES.length];
  const m = new VoxelModel(56, 50, 40);
  const body = m.color(sc[0], { smooth: 0.55, jitter: 0.12 });
  const dk = m.color(sc[2], { smooth: 0.55, jitter: 0.1 });
  const tip = m.color(sc[1], { smooth: 0.5, jitter: 0.08 });
  const st = reefRock(m, rng);
  facetRock(m, rng, 28, 2, 20, 9, 5, 8, st[0], 10);
  stoneTex(m, st, 3);
  const col = (x, y, z) => (h3(x, y, z, 2) < 0.12 ? tip : y < 10 ? dk : body);
  branchCoral(m, rng, [28, 4, 20], [0, 1, 0], 13, 3.1, 4, col, tip, { spread: 0.75, shrink: 0.72, lenK: 0.8 });
  // Polyp dots on the surface.
  surface(m, (x, y, z, p) => (p === body && h3(x, y, z, 9) < 0.07 ? tip : null));
  return { m, yaw: 32 };
});

def('coral_fan', { name: 'Sea Fan', biome: 'shallows', tags: ['coral'], decor: { price: 70, size: 1 } }, ({ rng, variant }) => {
  const schemes = [['#c24fd0', '#f2a6ff', '#7e2f9a'], ['#e8475d', '#ffb0b0', '#9c2440'], ['#f2b53c', '#fff1a6', '#b0702a']];
  const sc = schemes[variant % schemes.length];
  const W = 60, H = 56, D = 14;
  const m = new VoxelModel(W, H, D);
  const vein = m.color(sc[0], { jitter: 0.1 });
  const rim = m.color(sc[1], { jitter: 0.1 });
  const trunk = m.color(sc[2], { jitter: 0.1, smooth: 0.4 });
  const seed = rng.int(0, 999);
  const cx = W / 2;
  const zOf = (x, y) => 6 + ((x - cx) / 30) ** 2 * 4 - y * 0.02;
  // Fan outline (rounded fan) and lace field.
  const inFan = (x, y) => {
    const dx = (x - cx) / 28, dy = (y - 8) / 46;
    return dy > 0 && dx * dx + dy * dy < 1 && y > 6 + Math.abs(x - cx) * 0.35;
  };
  for (let y = 4; y < H; y++) for (let x = 0; x < W; x++) {
    if (!inFan(x + 0.5, y + 0.5)) continue;
    const a = Math.atan2(x + 0.5 - cx, y + 0.5 - 4);
    const r = Math.hypot(x + 0.5 - cx, y + 0.5 - 4);
    const n = noise3(x * 0.16, y * 0.16, 0, seed);
    // Radial ribs + meandering cross veins form a lace net.
    const rib = Math.abs(((a * 7 + n * 2.2) % 1 + 1) % 1 - 0.5) < 0.14;
    const cross = Math.abs(((r * 0.22 + n * 1.6) % 1 + 1) % 1 - 0.5) < 0.12;
    const edge = !inFan(x + 2, y + 0.5) || !inFan(x - 1, y + 0.5) || !inFan(x + 0.5, y + 2.5);
    if (rib || cross || edge) {
      const z = Math.round(zOf(x, y));
      m.set(x, y, z, edge ? rim : vein);
      if (!edge && r < 18) m.set(x, y, z + 1, vein);
    }
  }
  // Main branches thicker.
  for (let k = -2; k <= 2; k++) {
    const a = k * 0.42;
    const x1 = cx + Math.sin(a) * 34, y1 = 4 + Math.cos(a) * 44;
    m.line(cx, 3, zOf(cx, 3), cx + (x1 - cx) * 0.55, 4 + (y1 - 4) * 0.55, zOf(x1, y1 * 0.55), trunk, 1.1);
  }
  m.line(cx, 0, 6, cx, 8, 6.5, trunk, 2.2);
  const st = reefRock(m, rng);
  facetRock(m, rng, cx, 1.5, 7, 7, 4, 6, st[0], 9);
  // Polyp sparkle on the lace.
  m.recolor((x, y, z, p) => (p === vein && h3(x, y, z, 5) < 0.08 ? rim : null));
  return { m, yaw: 22, pitch: 22 };
});

def('coral_brain', { name: 'Brain Coral', biome: 'shallows', tags: ['coral'], decor: { price: 45, size: 1 } }, ({ rng, variant }) => {
  const W = 46, H = 26, D = 40;
  const m = new VoxelModel(W, H, D);
  const schemes = [['#ee8f62', '#a8463c', '#ffd08a'], ['#b9d65e', '#557f36', '#eef59a'], ['#e07fb4', '#86397a', '#ffc4de']];
  const sc = schemes[variant % schemes.length];
  const body = m.color(sc[0], { jitter: 0.1, smooth: 0.75 });
  const groove = m.color(sc[1], { jitter: 0.08, smooth: 0.6 });
  const ridge = m.color(sc[2], { jitter: 0.1, smooth: 0.75 });
  const seed = rng.int(0, 999);
  blob(m, W / 2, 1, D / 2, 20, 22, 17.5, 0.05, 0.08, seed, body, 0);
  // Meandering grooves: several contour lines of a low-frequency noise field (like a topo map).
  const g = (x, y, z) => {
    const f = fbm3(x * 0.07, y * 0.09, z * 0.07, 2, seed + 5) * 6;
    return Math.abs(f - Math.floor(f) - 0.5);
  };
  const shell = [];
  m.recolor((x, y, z) => { if (m.exposed(x, y, z)) shell.push([x, y, z]); return null; });
  for (const [x, y, z] of shell) {
    const d = g(x + 0.5, y + 0.5, z + 0.5);
    if (d < 0.1) m.set(x, y, z, 0);
    else if (d < 0.17) m.set(x, y, z, groove);
    else if (d > 0.4) m.set(x, y, z, ridge);
  }
  m.recolor((x, y, z, p) => (p === body && m.exposed(x, y, z) && g(x + 0.5, y + 0.5, z + 0.5) < 0.2 ? groove : null));
  return { m, yaw: 30 };
});

def('coral_tube', { name: 'Tube Sponge', biome: 'shallows', tags: ['coral'], decor: { price: 55, size: 1 } }, ({ rng, variant }) => {
  const schemes = [['#f2b84b', '#ffe49a', '#9a4f2c', '#c97f2e'], ['#8f6ad8', '#d7c2ff', '#3c2668', '#6c4bb0'], ['#3fbfaa', '#a8f0d8', '#1d4f5a', '#2a8f88']];
  const sc = schemes[variant % schemes.length];
  const m = new VoxelModel(48, 50, 40);
  const body = m.color(sc[0], { smooth: 0.6, jitter: 0.12 });
  const lip = m.color(sc[1], { smooth: 0.3, jitter: 0.08 });
  const inner = m.color(sc[2], { jitter: 0.05, light: -0.6 });
  const pore = m.color(sc[3], { smooth: 0.6, jitter: 0.05 });
  const tubes = [[22, 20, 5.5, 44, 0, 0], [13, 22, 4.2, 30, -0.35, 0.1], [31, 17, 4.6, 34, 0.3, -0.15], [28, 28, 3.6, 22, 0.25, 0.35], [15, 12, 3.4, 20, -0.3, -0.35], [36, 27, 3, 14, 0.5, 0.2]];
  const st = reefRock(m, rng);
  facetRock(m, rng, 23, 2, 20, 15, 5, 12, st[0], 12);
  stoneTex(m, st, 5);
  for (const [x, z, r, hgt, tx, tz] of tubes) {
    const h = hgt * rng.float(0.9, 1.05);
    const top = [x + tx * h * 0.5, h, z + tz * h * 0.5];
    // Slight bulge in the middle.
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      const rr = r * (0.88 + 0.18 * Math.sin(t * Math.PI)) * (t > 0.92 ? 1.08 : 1);
      m.sphere(x + (top[0] - x) * t, 2 + (top[1] - 2) * t, z + (top[2] - z) * t, rr, body);
    }
    m.sub(() => m.line(top[0], top[1] - 7, top[2], top[0], top[1] + 3, top[2], 0, r - 1.4));
    m.paint(() => shape(m, top[0] - r - 2, top[1] - 3, top[2] - r - 2, top[0] + r + 2, top[1] + 3, top[2] + r + 2, (xx, yy, zz) => yy > top[1] - 2.2, lip));
    m.box(top[0] - 0.5, top[1] - 7, top[2] - 0.5, top[0] + 0.5, top[1] - 7, top[2] + 0.5, inner);
    m.paint(() => m.cylinder(top[0], top[2], top[1] - 6, top[1] - 2.5, r - 1, inner));
  }
  m.recolor((x, y, z, p) => (p === body && m.exposed(x, y, z) && h3(x, y, z, 3) < 0.09 ? pore : null));
  return { m, yaw: 30 };
});

def('coral_staghorn', { name: 'Staghorn Coral', biome: 'shallows', tags: ['coral'], decor: { price: 65, size: 2 } }, ({ rng, variant }) => {
  const schemes = [['#d9a36f', '#fbead0', '#a8714c'], ['#a98ad8', '#f0e2ff', '#7559a8'], ['#7ec8c0', '#e0fff6', '#4f8f96']];
  const sc = schemes[variant % schemes.length];
  const m = new VoxelModel(62, 44, 46);
  const body = m.color(sc[0], { smooth: 0.5, jitter: 0.12 });
  const tip = m.color(sc[1], { smooth: 0.45, jitter: 0.06 });
  const dk = m.color(sc[2], { smooth: 0.5, jitter: 0.1 });
  const col = (x, y, z) => (y < 6 ? dk : body);
  const n = 7;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rng.float(-0.3, 0.3);
    const out = rng.float(0.55, 0.95);
    branchCoral(m, rng, [31 + Math.cos(a) * 3, 1, 23 + Math.sin(a) * 3], [Math.cos(a) * out, 0.75, Math.sin(a) * out], rng.float(11, 14), 1.9, 2, col, tip, { spread: 0.55, shrink: 0.8, lenK: 0.82, up: 0.16, three: 0.1, tipK: 0.75 });
  }
  m.sphere(31, 1, 23, 5, dk);
  // Little corallite bumps.
  surface(m, (x, y, z, p) => (p === body && h3(x, y, z, 6) < 0.1 ? dk : null));
  return { m, yaw: 30 };
});

def('anemone_base', { name: 'Anemone', biome: 'shallows', tags: ['coral', 'home'], decor: { price: 90, size: 1 } }, ({ rng, variant }) => {
  const schemes = [['#e66aa0', '#ffb2d4', '#fff0f7', '#8f3f8a'], ['#5bc7b4', '#a8f5e0', '#f0fff8', '#2f7a84'], ['#f08a4b', '#ffc78f', '#fff2d8', '#a24a3a']];
  const sc = schemes[variant % schemes.length];
  const m = new VoxelModel(46, 34, 42);
  const st = reefRock(m, rng);
  facetRock(m, rng, 23, 3, 21, 14, 7, 12, st[0], 12);
  stoneTex(m, st, 2);
  moss(m, rng, 4, MOSS, 0.3);
  const column = m.color(sc[3], { smooth: 0.7, jitter: 0.08 });
  const tent = m.color(sc[0], { smooth: 0.6, jitter: 0.1 });
  const tentL = m.color(sc[1], { smooth: 0.6, jitter: 0.08 });
  const bulb = m.color(sc[2], { smooth: 0.6, jitter: 0.05, emissive: 0.15 });
  const mouth = m.color('#5a2350', { jitter: 0 });
  m.cone(23, 21, 6, 13, 6, 7.5, column);
  m.ellipsoid(23, 13.5, 21, 9, 2.5, 8, tentL);
  const N = 30;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2 * 2.618 + rng.float(-0.2, 0.2);
    const rr = 2.5 + (i / N) * 5.5;
    const sx = 23 + Math.cos(a) * rr, sz = 21 + Math.sin(a) * rr * 0.9;
    const out = 0.35 + (rr / 8) * 0.7;
    const len = rng.float(8, 13) * (1.1 - rr / 20);
    const ex = sx + Math.cos(a) * out * len, ez = sz + Math.sin(a) * out * len, ey = 14 + len * (1 - out * 0.45);
    const mx = (sx + ex) / 2 + rng.float(-1, 1), my = (14 + ey) / 2 + 1.5, mz = (sz + ez) / 2 + rng.float(-1, 1);
    m.tube([[sx, 14, sz, 1.4], [mx, my, mz, 1.25], [ex, ey, ez, 1.1]], (x, y) => (y > ey - 3 ? tentL : tent), 3);
    m.sphere(ex, ey + 0.4, ez, 1.7, bulb);
  }
  m.ellipsoid(23, 15, 21, 2, 1, 2, mouth);
  return { m, yaw: 30 };
});

def('sandcastle', { name: 'Sandcastle', biome: 'shallows', tags: ['build'], decor: { price: 120, size: 2 } }, ({ rng }) => {
  const m = new VoxelModel(64, 64, 48);
  const sand = [m.color('#e9cf92', { jitter: 0.16 }), m.color('#dcbd7c', { jitter: 0.16 }), m.color('#f4e0aa', { jitter: 0.14 })];
  const wet = m.color('#c69e66', { jitter: 0.12 });
  const dark = m.color('#5a3b33', { jitter: 0, light: -0.5 });
  const flag = m.color('#ff5a5f', { jitter: 0.05 });
  const flag2 = m.color('#fff4e0', { jitter: 0.05 });
  const pole = m.color('#8a5a3a', { jitter: 0 });
  const shellP = m.color('#ffb0c8', { jitter: 0.05, smooth: 0.4 });
  const shellW = m.color('#fff3e6', { jitter: 0.05, smooth: 0.4 });
  const tex = (x, y, z) => (y % 6 === 0 ? sand[1] : h3(x, y, z, 1) < 0.18 ? sand[2] : h3(x, y, z, 2) < 0.18 ? sand[1] : sand[0]);
  // Mound.
  shape(m, 2, 0, 2, 61, 6, 45, (x, y, z) => {
    const d = ((x - 32) / 30) ** 2 + ((z - 24) / 22) ** 2;
    return d < 1 && y < 6 * (1 - d) ** 0.6 + 1;
  }, (x, y, z) => (y < 2 ? wet : tex(x, y, z)));
  // Keep.
  m.box(19, 4, 14, 44, 24, 33, tex);
  for (let x = 19; x <= 44; x++) for (const z of [14, 33]) if (x % 4 < 2) m.box(x, 25, z, x, 27, z, tex);
  for (let z = 14; z <= 33; z++) for (const x of [19, 44]) if (z % 4 < 2) m.box(x, 25, z, x, 27, z, tex);
  // Towers.
  const tower = (cx, cz, r, h, roof) => {
    m.cylinder(cx, cz, 3, h, r, tex);
    m.cylinder(cx, cz, h - 1, h, r + 1, tex);
    if (roof) {
      m.cone(cx, cz, h + 1, h + 1 + r * 2.2, r + 0.8, 0.4, (x, y, z) => (y % 3 === 0 ? sand[1] : sand[2]));
    } else {
      m.sub(() => m.cylinder(cx, cz, h, h, r - 0.6));
      for (let a = 0; a < 8; a++) {
        const ang = (a / 8) * Math.PI * 2;
        if (a % 2) m.box(cx + Math.cos(ang) * r, h + 1, cz + Math.sin(ang) * r, cx + Math.cos(ang) * r, h + 2, cz + Math.sin(ang) * r, tex);
      }
    }
    // Window slit.
    m.box(cx, h - 7, cz + r - 0.5, cx, h - 4, cz + r + 0.5, dark);
  };
  tower(17, 31, 6, 30, false);
  tower(46, 31, 6, 33, false);
  tower(18, 15, 5, 26, false);
  tower(45, 15, 5, 28, false);
  tower(32, 22, 6.5, 38, true);
  // Gate arch.
  m.sub(() => { m.box(28, 4, 30, 35, 11, 35); m.cylinder(31.5, 33, 11, 14, 3.6, 0, 'y'); });
  m.sub(() => m.cylinder(4, 31.5, 30, 35, 3.6, 0, 'z'));
  m.box(28, 4, 31, 35, 14, 31, (x, y, z) => (m.get(x, y, z + 1) === 0 && m.get(x, y, z) ? null : null));
  shape(m, 27, 4, 30, 36, 15, 30, (x, y) => true, (x, y, z, p) => (p ? null : dark));
  m.sub(() => m.box(28, 4, 31, 35, 15, 35));
  m.recolor((x, y, z, p) => (p === dark && (x < 28 || x > 35 || y > 13 && Math.hypot(x + 0.5 - 31.5, y + 0.5 - 11) > 4) ? tex(x, y, z) : null));
  // Keep windows.
  for (const wx of [22, 40]) m.box(wx, 15, 33, wx + 1, 18, 34, dark);
  // Flag.
  m.box(32, 52, 22, 32, 60, 22, pole);
  for (let y = 0; y < 5; y++) for (let x = 0; x < 8; x++) m.set(33 + x, 55 + y + Math.round(Math.sin(x * 0.8) * 0.6), 22, (x + y) % 4 < 2 ? flag : flag2);
  // Shells & starfish.
  const seeds = [[22, 9, 34], [41, 12, 34], [12, 3, 38], [50, 3, 40], [26, 20, 34]];
  seeds.forEach(([x, y, z], i) => {
    const c = i % 2 ? shellW : shellP;
    m.set(x, y, z, c); m.set(x + 1, y, z, c); m.set(x, y + 1, z, c); m.set(x + 1, y + 1, z, i % 2 ? shellP : shellW);
  });
  const star = m.color('#ff8a3d', { jitter: 0.05 });
  for (let k = 0; k < 5; k++) {
    const a = k / 5 * Math.PI * 2 - Math.PI / 2;
    m.line(10, 3.6, 40, 10 + Math.cos(a) * 3.5, 3.6, 40 + Math.sin(a) * 3.5, star, 0.6);
  }
  m.set(10, 4, 40, star);
  return { m, yaw: 30 };
});

def('treasure_chest', { name: 'Treasure Chest', biome: 'shallows', tags: ['wreck', 'treasure'], decor: { price: 250, size: 1 } }, ({ frame, rng }) => {
  const W = 46, H = 44, D = 52;
  const m = new VoxelModel(W, H, D);
  const plank = [m.color('#8e512c', { jitter: 0.14 }), m.color('#a0602f', { jitter: 0.14 }), m.color('#7c4428', { jitter: 0.14 })];
  const grain = m.color('#6a3622', { jitter: 0.06 });
  const gold = m.color('#eab23c', { jitter: 0.08, spec: 1.2 });
  const goldDk = m.color('#b97a22', { jitter: 0.08 });
  const rivet = m.color('#fff0a8', { jitter: 0 });
  const lockC = m.color('#f2d16b', { jitter: 0.04, spec: 1.5 });
  const hole = m.color('#2a1a22', { jitter: 0 });
  const coin = m.color('#ffd45e', { jitter: 0.1, emissive: 0.2 });
  const coinL = m.color('#fff2a8', { jitter: 0.05, emissive: 0.4 });
  const coinD = m.color('#d99a2b', { jitter: 0.08, emissive: 0.1 });
  const gems = [m.color('#ff5b7a', { emissive: 0.7, jitter: 0 }), m.color('#5be0ff', { emissive: 0.7, jitter: 0 }), m.color('#a8ff6b', { emissive: 0.7, jitter: 0 })];
  const inner = m.color('#3e1e18', { jitter: 0.05 });
  const x0 = 3, x1 = 42, z0 = 22, z1 = 47, yTop = 17;
  const pl = (x, y, z) => (h3(x, Math.floor(y / 4), 0, 3) < 0.25 && (x * 7 + y) % 5 === 0 ? grain : plank[Math.floor(y / 4) % 3]);
  m.box(x0, 0, z0, x1, yTop, z1, pl);
  m.sub(() => m.box(x0 + 2, 3, z0 + 2, x1 - 2, yTop, z1 - 2));
  m.box(x0 + 2, 3, z0 + 2, x1 - 2, 3, z1 - 2, inner);
  const bandX = [x0, x0 + 1, x0 + 9, x0 + 10, x1 - 10, x1 - 9, x1 - 1, x1];
  const isEdge = (x) => x === x0 || x === x1 || x === x0 + 1 || x === x1 - 1;
  const bands = (ya, yb) => {
    for (const bx of bandX) m.paint(() => m.box(bx, ya, 0, bx, yb, D - 1, isEdge(bx) ? goldDk : gold));
  };
  bands(0, yTop);
  m.paint(() => m.box(0, 0, 0, W - 1, 1, D - 1, goldDk));
  // Rivets on the bands (front face).
  for (const bx of [x0 + 9, x1 - 9]) for (let y = 3; y < yTop; y += 4) m.set(bx, y, z1 + 1, rivet);
  if (frame === 0) {
    const zc = (z0 + z1 + 1) / 2, rz = (z1 - z0 + 1) / 2;
    shape(m, x0, yTop + 1, z0, x1, yTop + 14, z1, (x, y, z) => ((z - zc) / rz) ** 2 + ((y - yTop - 1) / 12) ** 2 <= 1, (x, y) => plank[Math.floor((y + 1) / 3) % 3]);
    bands(yTop + 1, yTop + 14);
    m.paint(() => m.box(x0, yTop + 1, z0, x1, yTop + 1, z1, goldDk));
    const lx = Math.floor((x0 + x1) / 2);
    m.box(lx - 3, yTop - 5, z1 + 1, lx + 4, yTop + 4, z1 + 1, lockC);
    m.box(lx, yTop - 3, z1 + 2, lx + 1, yTop - 1, z1 + 2, hole);
    m.box(lx - 3, yTop - 5, z1 + 2, lx + 4, yTop - 5, z1 + 2, goldDk);
    m.box(lx, yTop + 5, z1 - 1, lx + 1, yTop + 7, z1, lockC);
  } else {
    const cx = (x0 + x1 + 1) / 2, cz = (z0 + z1 + 1) / 2;
    shape(m, x0 + 2, 3, z0 + 2, x1 - 2, yTop + 8, z1 - 2, (x, y, z) => {
      const d = ((x - cx) / 19) ** 2 + ((z - cz) / 12) ** 2;
      return y < yTop + 6 * (1 - d) + noise3(x * 0.4, 0, z * 0.4, 3) * 2;
    }, (x, y, z) => {
      const r = h3(x, y, z, 2);
      return r < 0.04 ? gems[(h3(x, z, y, 5) * 3) | 0] : r < 0.25 ? coinL : r < 0.45 ? coinD : coin;
    });
    // Open lid leaning back: built closed (hinge at back-bottom), rotated about x.
    const lid = part(m, W, 16, 28);
    const zc = 13, rz = 13;
    shape(lid, x0, 0, 0, x1, 15, 27, (x, y, z) => ((z - zc) / rz) ** 2 + (y / 12) ** 2 <= 1, (x, y) => plank[Math.floor((y + 1) / 3) % 3]);
    for (const bx of bandX) lid.paint(() => lid.box(bx, 0, 0, bx, 15, 27, isEdge(bx) ? goldDk : gold));
    lid.sub(() => shape(lid, x0 + 2, 0, 0, x1 - 2, 10, 27, (x, y, z) => ((z - zc) / (rz - 2)) ** 2 + (y / 10) ** 2 <= 1, 0));
    lid.paint(() => lid.box(x0 + 2, 0, 0, x1 - 2, 12, 27, (x, y, z) => (lid.exposed(x, y, z) && y < 10 ? inner : null)));
    stampRot(m, lid, [0, 0, 0], [0, yTop + 1, z0], -104, 0, 0);
    // Spilled coins.
    for (let i = 0; i < 12; i++) {
      const x = 4 + ((h3(i, 1, 1, 9) * 36) | 0), z = Math.min(D - 1, z1 + 2 + ((h3(i, 2, 1, 9) * 3) | 0));
      m.set(x, 0, z, i % 3 ? coin : coinL);
      if (i % 4 === 0) m.set(x + 1, 0, z, coinD);
    }
    m.set(x0 + 5, yTop + 4, cz, gems[0]);
  }
  barnacles(m, rng, 3, plank);
  return { m, yaw: 28, light: '#ffd45e' };
});

def('clam_pearl', { name: 'Pearl Clam', biome: 'shallows', tags: ['treasure'], decor: { price: 300, size: 1 } }, ({ rng }) => {
  const m = new VoxelModel(54, 44, 46);
  const shell = [m.color('#c7a3d8', { smooth: 0.45, jitter: 0.1 }), m.color('#e2c4ec', { smooth: 0.45, jitter: 0.1 }), m.color('#9d78b8', { smooth: 0.45, jitter: 0.1 })];
  const mantle = [m.color('#2fa7c9', { smooth: 0.6, jitter: 0.1 }), m.color('#7fe0f0', { smooth: 0.6, jitter: 0.05 }), m.color('#1f6f9f', { smooth: 0.6, jitter: 0.08 })];
  const pearl = m.color('#fff1f6', { smooth: 1, spec: 2.4, specPow: 14, emissive: 0.35, jitter: 0 });
  const cx = 27, cz = 22, RX = 22, RZ = 18, RY = 12;
  const ribs = (x, z) => 1 + 0.07 * Math.cos(Math.atan2(z - cz, x - cx) * 14);
  const shellCol = (x, y, z) => {
    const a = Math.atan2(z - cz, x - cx) * 14;
    return Math.cos(a) > 0.6 ? shell[1] : Math.cos(a) < -0.5 ? shell[2] : shell[0];
  };
  // Bottom bowl.
  shape(m, cx - RX - 2, 0, cz - RZ - 2, cx + RX + 2, RY, cz + RZ + 2, (x, y, z) => {
    const k = ribs(x, z);
    const d = ((x - cx) / (RX * k)) ** 2 + ((y - RY) / RY) ** 2 + ((z - cz) / (RZ * k)) ** 2;
    return d <= 1 && y <= RY;
  }, shellCol);
  // Mantle filling.
  m.sub(() => shape(m, cx - RX, 4, cz - RZ, cx + RX, RY + 1, cz + RZ, (x, y, z) => ((x - cx) / (RX - 2.5)) ** 2 + ((y - RY) / (RY - 2.5)) ** 2 + ((z - cz) / (RZ - 2.5)) ** 2 <= 1, 0));
  shape(m, cx - RX, 3, cz - RZ, cx + RX, RY - 2, cz + RZ, (x, y, z) => ((x - cx) / (RX - 2)) ** 2 + ((y - RY) / (RY - 2)) ** 2 + ((z - cz) / (RZ - 2)) ** 2 <= 1 && y <= RY - 3 + Math.sin(x * 0.6) * 0.8, (x, y, z) => {
    const n = h3(x, y, z, 4);
    return n < 0.12 ? mantle[1] : noise3(x * 0.3, y * 0.3, z * 0.3, 2) < 0.4 ? mantle[2] : mantle[0];
  });
  // Top shell: same bowl, flipped and opened back around the hinge.
  const top = part(m, 54, 20, 46);
  shape(top, cx - RX - 2, 0, cz - RZ - 2, cx + RX + 2, RY, cz + RZ + 2, (x, y, z) => {
    const k = ribs(x, z);
    const d = ((x - cx) / (RX * k)) ** 2 + (y / RY) ** 2 + ((z - cz) / (RZ * k)) ** 2;
    return d <= 1 && y >= 0;
  }, shellCol);
  top.sub(() => shape(top, cx - RX, 0, cz - RZ, cx + RX, RY - 2.5, cz + RZ, (x, y, z) => ((x - cx) / (RX - 2.5)) ** 2 + (y / (RY - 2.5)) ** 2 + ((z - cz) / (RZ - 2.5)) ** 2 <= 1, 0));
  stampRot(m, top, [cx, 0, cz - RZ], [cx, RY + 0.5, cz - RZ + 1], -62, 0, 0);
  m.sphere(cx, RY - 1, cz + 3, 5.2, pearl);
  sandMound(m, cx, cz + 3, 24, 20, 2.5, 7);
  barnacles(m, rng, 3, shell);
  return { m, yaw: 30, light: '#ffe8f4' };
});

def('message_bottle', { name: 'Message in a Bottle', biome: 'shallows', tags: ['treasure'], decor: { price: 80, size: 1 } }, ({ rng }) => {
  const m = new VoxelModel(52, 22, 30);
  const glass = m.color('#79d6b2', { smooth: 0.85, spec: 2.2, specPow: 16, light: 0.3, jitter: 0.04 });
  const glassD = m.color('#3f9e8c', { smooth: 0.85, jitter: 0.04 });
  const paper = m.color('#e9e2bf', { smooth: 0.7, jitter: 0.04, light: 0.1 });
  const ribbon = m.color('#e0505a', { jitter: 0 });
  const cork = m.color('#b58358', { jitter: 0.12, smooth: 0.4 });
  // Bottle along a diagonal axis lying on the sand, neck slightly raised.
  const p0 = [8, 6.5, 19], dir = [1, 0.12, -0.42];
  const L = Math.hypot(...dir); const d = dir.map((v) => v / L);
  const prof = (u) => (u < 0 ? -1 : u < 22 ? 6 : u < 27 ? 6 - (u - 22) * 0.75 : u < 33 ? 2.3 : u < 34.5 ? 2.9 : u < 38 ? 2.2 : -1);
  shape(m, 0, 0, 0, 51, 21, 29, (x, y, z) => {
    const px = x - p0[0], py = y - p0[1], pz = z - p0[2];
    const u = px * d[0] + py * d[1] + pz * d[2];
    const r = prof(u);
    if (r < 0) return false;
    const qx = px - d[0] * u, qy = py - d[1] * u, qz = pz - d[2] * u;
    return qx * qx + qy * qy + qz * qz <= r * r;
  }, (x, y, z) => {
    const px = x - p0[0], py = y - p0[1], pz = z - p0[2];
    const u = px * d[0] + py * d[1] + pz * d[2];
    if (u > 34.5) return cork;
    const qy = py - d[1] * u;
    if (u > 4 && u < 19 && qy > 1) return u > 10 && u < 12 ? ribbon : paper;
    return qy < -2 ? glassD : glass;
  });
  const sand = sandMound(m, 24, 16, 24, 12, 4.5, 3);
  void sand;
  // Tiny shell next to it.
  const sh = m.color('#ffc0cf', { smooth: 0.4 });
  m.box(40, 3, 20, 41, 3, 21, sh);
  void rng;
  return { m, yaw: 26 };
});

def('anchor', { name: 'Old Anchor', biome: 'shallows', tags: ['wreck', 'metal'], decor: { price: 140, size: 2 } }, ({ rng }) => {
  const m = new VoxelModel(70, 76, 44);
  const iron = [m.color('#5a6074', { jitter: 0.1, smooth: 0.35 }), m.color('#4a4e62', { jitter: 0.1, smooth: 0.35 }), m.color('#737a8e', { jitter: 0.08, smooth: 0.35 })];
  const rust = [m.color('#a4552f', { jitter: 0.12, smooth: 0.35 }), m.color('#c47c42', { jitter: 0.1, smooth: 0.35 }), m.color('#7a3f2e', { jitter: 0.1, smooth: 0.35 })];
  const a = part(m, 54, 68, 32);
  const cx = 26.5, zc = 16;
  // Shank, ring, stock, crown, arms, flukes.
  a.box(cx - 2, 9, zc - 2, cx + 1, 54, zc + 1, iron[0]);
  a.box(cx - 2.5, 50, zc - 2.5, cx + 1.5, 53, zc + 1.5, iron[1]);
  torus(a, cx - 0.5, 60, zc - 0.5, 5.2, 1.7, iron[0], 'z');
  a.box(cx - 1.5, 46, zc - 13, cx + 0.5, 48, zc + 12, iron[1]);
  a.sphere(cx - 0.5, 47, zc - 13.5, 2.2, iron[0]);
  a.sphere(cx - 0.5, 47, zc + 12.5, 2.2, iron[0]);
  a.sphere(cx - 0.5, 9, zc - 0.5, 4.2, iron[0]);
  torus(a, cx - 0.5, 25, zc - 0.5, 16, 2.4, iron[0], 'z', (ang) => ang < -0.25 && ang > -Math.PI + 0.25);
  for (const sx of [-1, 1]) {
    const ex = cx - 0.5 + sx * 16 * Math.cos(0.25), ey = 25 - 16 * Math.sin(0.25);
    const tri = [[ex - sx * 1.5, ey + 12], [ex - sx * 5.5, ey - 2], [ex + sx * 4.5, ey + 1]];
    shape(a, ex - 8, ey - 4, zc - 3, ex + 8, ey + 13, zc + 2, (x, y, z) => {
      if (Math.abs(z - zc + 0.5) > 1.6 - (y - ey) * 0.04) return false;
      let inside = true;
      for (let i = 0; i < 3; i++) {
        const [x1, y1] = tri[i], [x2, y2] = tri[(i + 1) % 3];
        const cr = (x2 - x1) * (y - y1) - (y2 - y1) * (x - x1);
        if ((cr < 0) !== (sx < 0)) inside = false;
      }
      return inside;
    }, iron[1]);
  }
  // Highlights on upper edges, then sparse rust patches.
  a.recolor((x, y, z, p) => (!a.get(x, y + 1, z) && p === iron[0] ? iron[2] : null));
  a.recolor((x, y, z) => {
    const n = fbm3(x * 0.12, y * 0.12, z * 0.12, 2, 4);
    return n > 0.68 ? rust[0] : n > 0.645 ? rust[2] : null;
  });
  const sp = [cx, 9, zc], dp = [34, 4, 20], rot = [0, 24, -16];
  stampRot(m, a, sp, dp, ...rot);
  // Chain from the ring down to the sand and trailing off.
  const ring = xformPt([cx - 0.5, 55, zc], sp, dp, ...rot);
  chain(m, [ring, [ring[0] - 6, ring[1] - 16, ring[2] + 6], [ring[0] - 14, 4, 34], [6, 2, 38]], iron[1], rust[0]);
  sandMound(m, 34, 22, 22, 15, 6, 5);
  barnacles(m, rng, 3, [...iron, ...rust]);
  moss(m, rng, 8, MOSS, 0.2, 0.2, [...iron, ...rust]);
  return { m, yaw: 30 };
});

def('barrel', { name: 'Old Barrel', biome: 'shallows', tags: ['wreck'], decor: { price: 70, size: 1 } }, ({ rng }) => {
  const m = new VoxelModel(34, 44, 34);
  const wood = WOOD.map((c) => m.color(c, { jitter: 0.12, smooth: 0.5 }));
  const seam = m.color('#5a3120', { jitter: 0.05, smooth: 0.5 });
  const band = m.color('#6d6a7c', { jitter: 0.08, smooth: 0.5, spec: 0.8 });
  const rust = m.color('#a5532d', { jitter: 0.15, smooth: 0.5 });
  const lid = m.color('#7c4a2a', { jitter: 0.1 });
  const lidD = m.color('#5e3524', { jitter: 0.05 });
  const cx = 17, cz = 17;
  for (let y = 0; y < 38; y++) {
    const t = (y - 18.5) / 19;
    const r = 11.5 + 2.5 * (1 - t * t);
    m.cylinder(cx, cz, y, y, r, (x, yy, z) => {
      const a = Math.atan2(z + 0.5 - cz, x + 0.5 - cx);
      const f = (a + Math.PI) / (Math.PI * 2) * 18;
      const st = Math.floor(f);
      if (f - st < 0.12) return seam;
      return wood[(st * 7) % 3];
    });
  }
  for (const by of [4, 5, 32, 33, 13, 24]) m.paint(() => m.cylinder(cx, cz, by, by, 16, (x, y, z) => (h3(x, y, z, 3) < 0.25 ? rust : band)));
  m.paint(() => m.box(0, 37, 0, 33, 37, 33, lid));
  m.sub(() => m.cylinder(cx, cz, 37, 37, 10));
  m.paint(() => m.box(0, 36, 0, 33, 36, 33, (x, y, z) => (Math.hypot(x + 0.5 - cx, z + 0.5 - cz) < 10.5 ? ((x >> 2) % 2 ? lid : lidD) : null)));
  barnacles(m, rng, 5, wood);
  moss(m, rng, 3, MOSS, 0.35, 0.25, [lid, lidD, ...wood]);
  sandMound(m, cx, cz, 17, 17, 3, 2);
  return { m, yaw: 30 };
});

function starfish(m, cx, cy, cz, R, col, dot, rot = 0) {
  for (let k = 0; k < 5; k++) {
    const a = rot + k / 5 * Math.PI * 2;
    for (let t = 0; t <= R; t += 0.5) {
      const r = 1.9 * (1 - t / R) + 0.6;
      const x = cx + Math.cos(a) * t, z = cz + Math.sin(a) * t;
      m.cylinder(x, z, cy, cy + (t < R * 0.5 ? 1 : 0), r, (xx, yy, zz) => (h3(xx, yy, zz, 1) < 0.18 ? dot : col));
    }
  }
  m.cylinder(cx, cz, cy, cy + 1, 2.6, col);
  m.set(Math.floor(cx), cy + 2, Math.floor(cz), dot);
}

def('starfish_rock', { name: 'Starfish Rock', biome: 'shallows', tags: ['rock'], decor: { price: 75, size: 1 } }, ({ rng }) => {
  const m = new VoxelModel(46, 34, 38);
  const st = reefRock(m, rng);
  const seed = rng.int(0, 999);
  facetRock(m, rng, 22, 9, 18, 16, 15, 13, st[0], 16);
  facetRock(m, rng, 34, 3, 24, 8, 7, 8, st[0], 10);
  stoneTex(m, st, seed);
  moss(m, rng, seed, MOSS, 0.3);
  const orange = m.color('#ff7f3a', { smooth: 0.4, jitter: 0.06 });
  const orangeD = m.color('#ffd08a', { smooth: 0.4, jitter: 0.04 });
  const purple = m.color('#a05fe0', { smooth: 0.4, jitter: 0.06 });
  const purpleD = m.color('#efd0ff', { smooth: 0.4, jitter: 0.04 });
  // One starfish on top.
  let ty = 0;
  for (let y = 33; y > 0; y--) if (m.get(21, y, 17)) { ty = y + 1; break; }
  starfish(m, 21, ty, 17, 7.5, orange, orangeD, 0.3);
  // One clinging to the front face (built flat, rotated upright).
  const sf = part(m, 20, 4, 20);
  starfish(sf, 10, 0, 10, 6.5, purple, purpleD, -0.2);
  let fz = 0;
  for (let z = 37; z > 0; z--) if (m.get(24, 9, z)) { fz = z + 1; break; }
  stampRot(m, sf, [10, 0, 10], [26, 9, fz], 80, 0, 0);
  sandMound(m, 24, 20, 23, 18, 2, 9);
  barnacles(m, rng, 3, st);
  return { m, yaw: 30 };
});

def('sunken_boat', { name: 'Sunken Sloop', biome: 'shallows', tags: ['wreck', 'hero'] }, ({ rng }) => {
  const m = new VoxelModel(132, 116, 76);
  const hull = part(m, 108, 96, 40);
  const wood = [m.color('#8e5a36', { jitter: 0.1, smooth: 0.3 }), m.color('#a0683c', { jitter: 0.1, smooth: 0.3 }), m.color('#7c4c2e', { jitter: 0.1, smooth: 0.3 })];
  const seamC = m.color('#4e2e22', { jitter: 0.05, smooth: 0.3 });
  const woodWet = m.color('#5f4a3c', { jitter: 0.1, smooth: 0.3 });
  const keelC = m.color('#4a3328', { jitter: 0.08 });
  const rail = m.color('#c9925a', { jitter: 0.06 });
  const deck = [m.color('#b07d4c', { jitter: 0.08 }), m.color('#9c6c40', { jitter: 0.08 })];
  const dark = m.color('#26161f', { jitter: 0.02, light: -0.6 });
  const rib = m.color('#6b4129', { jitter: 0.06 });
  const mast = m.color('#80583a', { jitter: 0.06, smooth: 0.5 });
  const sail = [m.color('#ecdfc2', { jitter: 0.05, smooth: 0.5 }), m.color('#d6c4a0', { jitter: 0.05, smooth: 0.5 })];
  const sailStripe = m.color('#c8574a', { jitter: 0.05, smooth: 0.5 });
  const rope = m.color('#cdb27a', { jitter: 0.04 });
  const brass = m.color('#e0ad4c', { jitter: 0.04, spec: 1.2 });
  const glassC = m.color('#2b6f86', { jitter: 0.02, spec: 1.5 });
  const L = 92, X0 = 6, zc = 20;
  const T = (x) => (x - X0) / L;
  const sheer = (t) => 24 + 10 * Math.max(0, (t - 0.62) / 0.38) ** 2 + 3 * Math.max(0, (0.18 - t) / 0.18) ** 2;
  const keel = (t) => 2 + 16 * Math.max(0, (t - 0.72) / 0.28) ** 2.2 + 4 * Math.max(0, (0.08 - t) / 0.08) ** 2;
  const beam = (t) => {
    if (t < 0 || t > 1) return 0;
    if (t < 0.1) return 13 + 2 * (t / 0.1);
    if (t < 0.5) return 15;
    return 15 * Math.pow(Math.max(0, 1 - ((t - 0.5) / 0.5) ** 1.8), 0.62);
  };
  const halfAt = (x, y, shrink = 0) => {
    const t = T(x);
    const B = beam(t) - shrink;
    if (B <= 0) return -1;
    const yk = keel(t) + shrink, ys = sheer(t);
    if (y < yk || y > ys) return -1;
    return B * Math.min(1, Math.pow((y - yk) / Math.max(1, 20 - yk * 0.5), 0.42));
  };
  const inHull = (x, y, z, shrink = 0) => {
    const hw = halfAt(x, y, shrink);
    return hw > 0 && Math.abs(z - zc) <= hw;
  };
  // Planked shell with dark seams between strakes and a waterline of grime.
  shape(hull, 0, 0, 0, 107, 40, 39, (x, y, z) => inHull(x, y, z), (x, y, z) => {
    const strake = Math.floor((y + Math.abs(z - zc) * 0.25) / 3.2);
    const f = (y + Math.abs(z - zc) * 0.25) / 3.2 - strake;
    if (f < 0.22) return seamC;
    if (y < 9 + noise3(x * 0.2, 0, z * 0.2, 3) * 3) return woodWet;
    return wood[(strake + ((x + strake * 13) >> 4)) % 3];
  });
  hull.sub(() => shape(hull, 0, 0, 0, 107, 40, 39, (x, y, z) => inHull(x, y, z, 1.6) && y > keel(T(x)) + 2, 0));
  // Keel and stem post.
  shape(hull, X0, 0, zc - 1.5, X0 + L + 2, 36, zc + 1.5, (x, y, z) => {
    const t = T(x);
    return t >= 0 && t <= 1.02 && y >= keel(Math.min(1, t)) - 1.5 && y <= keel(Math.min(1, t)) + 0.5;
  }, keelC);
  hull.line(X0 + L - 1, keel(0.99), zc, X0 + L + 3, sheer(1) + 4, zc, keelC, 1.3);
  // Ribs.
  for (let x = 14; x < 92; x += 6) shape(hull, x, 0, 0, x + 1, 40, 39, (xx, y, z) => inHull(xx, y, z) && !inHull(xx, y, z, 2.8), rib);
  // Gunwale cap.
  shape(hull, 0, 0, 0, 107, 42, 39, (x, y, z) => {
    const t = T(x);
    const ys = sheer(t);
    return y >= ys && y < ys + 2 && inHull(x, ys - 0.5, z) && !inHull(x, ys - 0.5, z, 2);
  }, rail);
  // Deck (with a caved-in hole).
  shape(hull, 0, 0, 0, 107, 40, 39, (x, y, z) => {
    const t = T(x);
    const yd = Math.floor(sheer(t)) - 3;
    if (y !== yd || !inHull(x, y, z)) return false;
    const hole = ((x - 54) / 11) ** 2 + ((z - zc + 3) / 7) ** 2 + noise3(x * 0.3, 0, z * 0.3, 5) * 0.8 < 1;
    return !hole;
  }, (x, y, z) => (z % 3 === 0 ? deck[1] : deck[0]));
  // Stern cabin.
  hull.box(10, 22, zc - 9, 27, 31, zc + 8, (x, y, z) => (z === zc + 8 && (x - 10) % 6 === 0 ? seamC : wood[(y >> 1) % 2 ? 1 : 0]));
  hull.box(9, 32, zc - 10, 28, 32, zc + 9, rail);
  hull.box(10, 33, zc - 9, 27, 33, zc + 8, deck[1]);
  for (const wx of [13, 21]) { hull.box(wx, 25, zc + 9, wx + 3, 28, zc + 9, glassC); hull.box(wx - 1, 24, zc + 9, wx + 4, 24, zc + 9, rail); }
  // Portholes.
  for (const px of [40, 52, 72]) {
    const hw = halfAt(px, 16);
    if (hw <= 0) continue;
    const zz = zc + hw + 0.3;
    torus(hull, px + 0.5, 16, zz, 1.9, 0.75, brass, 'z');
    hull.box(px, 16, Math.floor(zz) - 1, px, 16, Math.floor(zz), glassC);
  }
  // Smashed hole in the hull side, showing the ribs inside.
  hull.sub(() => shape(hull, 52, 4, 26, 72, 20, 39, (x, y, z) => ((x - 62) / 8) ** 2 + ((y - 11) / 5.5) ** 2 + noise3(x * 0.4, y * 0.4, 2, 6) * 0.7 < 1 && z > zc + 6, 0));
  shape(hull, 52, 4, 0, 72, 20, 39, (x, y, z) => ((x - 62) / 7) ** 2 + ((y - 11) / 4.5) ** 2 < 1 && inHull(x, y, z, 1.6) && !inHull(x, y, z, 3) && z < zc, dark);
  // Mast (snapped), a slipped yard and a torn sail hanging from it.
  hull.cylinder(50, zc, 6, 72, 1.9, mast);
  hull.sub(() => shape(hull, 46, 64, zc - 3, 54, 74, zc + 3, (x, y) => y > 68 + (x - 50) * 0.9, 0));
  hull.cylinder(50, zc, 60, 61, 2.6, rope);
  const yard = (x) => 50 + (x - 34) * 0.32;
  hull.line(34, yard(34), zc + 2, 72, yard(72), zc + 2, mast, 1.1);
  for (let x = 36; x <= 70; x++) {
    const top = Math.floor(yard(x)) - 1;
    const bottom = 30 + noise3(x * 0.3, 0, 0, 9) * 8 + (x > 60 ? (x - 60) * 0.8 : 0);
    for (let y = top; y >= bottom; y--) {
      if (noise3(x * 0.25, y * 0.25, 1, 7) > 0.7) continue;
      const bil = Math.round(Math.sin((x - 36) / 34 * Math.PI) * 2.5 + (top - y) * 0.06);
      hull.set(x, y, zc + 3 + bil, (y >> 2) % 3 === 0 ? sailStripe : sail[h3(x, y, 2, 1) < 0.3 ? 1 : 0]);
    }
  }
  // Rigging.
  hull.line(50, 66, zc, 98, 34, zc, rope, 0.45);
  hull.line(50, 66, zc, 16, 34, zc - 6, rope, 0.45);
  // Bowsprit.
  hull.line(X0 + L, sheer(1) + 1, zc, X0 + L + 12, sheer(1) + 8, zc, mast, 1.2);
  // Weathering.
  barnacles(hull, rng, 22, [...wood, woodWet]);
  moss(hull, rng, 7, MOSS, 0.4, 0.16, [...deck, rail, ...wood]);
  // Lay it in the sand: slightly rolled toward the camera, bow raised.
  stampRot(m, hull, [54, 0, zc], [64, 6, 34], 8, -16, 4);
  sandMound(m, 62, 36, 50, 22, 9, 12);
  // Kelp with little leaf blades.
  const kelp = [m.color('#4fa25e', { smooth: 0.3 }), m.color('#86cf74', { smooth: 0.3 }), m.color('#2f7a58', { smooth: 0.3 })];
  for (let k = 0; k < 4; k++) {
    const x = 20 + k * 26 + rng.int(-4, 4), z = 50 + rng.int(-2, 4);
    const h = rng.int(22, 40);
    let y0 = 0;
    while (m.get(x, y0, z) && y0 < 20) y0++;
    for (let y = y0 - 1; y < y0 + h; y++) {
      const xx = x + Math.round(Math.sin(y * 0.3 + k) * 1.5);
      m.set(xx, y, z, kelp[0]);
      if (y % 5 === 2 && y > y0 + 2) { const sd = (y >> 1) % 2 ? 1 : -1; m.set(xx + sd, y, z, kelp[1]); m.set(xx + sd * 2, y + 1, z, kelp[1]); m.set(xx + sd, y - 1, z, kelp[2]); }
    }
  }
  return { m, yaw: 30, vs: 1.6 };
});

// ===================== JUNKYARD REEF =====================

const JUNK_SAND = ['#9a8f7c', '#857a6a', '#b0a58e'];
const GUN = ['#555c6e', '#434859', '#6c7488'];
const BEIGE = ['#d9cfb2', '#c2b796', '#ece3c8'];

// Rust weathering: patches + streaks running down from them.
function rustify(m, on, rust, seed, amount = 0.5, freq = 0.13) {
  const set = new Set(on);
  m.recolor((x, y, z, p) => {
    if (!set.has(p)) return null;
    const n = fbm3(x * freq, y * freq * 0.8, z * freq, 2, seed);
    if (n > 1 - amount * 0.42) return rust[0];
    if (n > 1 - amount * 0.5) return rust[2];
    // Vertical streaks.
    if (h3(x, 0, z, seed) < amount * 0.1 && fbm3(x * freq, (y + 4) * freq * 0.8, z * freq, 2, seed) > 0.5) return rust[1];
    return null;
  });
}

// Junk-strewn seabed patch: grey silt with scraps of metal and glints.
function junkMound(m, cx, cz, rx, rz, hgt, seed) {
  const sand = sandMound(m, cx, cz, rx, rz, hgt, seed, JUNK_SAND);
  const scrap = [m.color('#6a7184', { jitter: 0.1 }), m.color('#a4552f', { jitter: 0.1 }), m.color('#3c8f6a', { jitter: 0.1 })];
  m.recolor((x, y, z, p) => (sand.includes(p) && !m.get(x, y + 1, z) && h3(x, y, z, seed + 8) < 0.06 ? scrap[(h3(z, x, y, 3) * 3) | 0] : null));
  return sand;
}

// A CRT monitor model in its own part (front faces +z). Returns {part, screen}.
function crtPart(m, screenIdx, opts = {}) {
  const p = part(m, 38, 36, 36);
  const shell = opts.shell || [m.color(BEIGE[0], { jitter: 0.08 }), m.color(BEIGE[1], { jitter: 0.08 }), m.color(BEIGE[2], { jitter: 0.06 })];
  const dark = m.color('#2a2730', { jitter: 0.04 });
  const vent = m.color('#7d735e', { jitter: 0.04 });
  const led = m.color('#7dff6a', { emissive: 1, jitter: 0 });
  // Bezel block, tapered back tube, stand.
  p.box(2, 6, 20, 35, 33, 27, shell[0]);
  shape(p, 4, 8, 4, 33, 31, 20, (x, y, z) => {
    const t = (20 - z) / 16;
    return Math.abs(x - 18.5) <= 14 - t * 5 && Math.abs(y - 19.5) <= 11.5 - t * 4;
  }, shell[1]);
  p.box(10, 2, 10, 27, 5, 24, shell[1]);
  p.box(7, 0, 8, 30, 1, 26, shell[0]);
  // Screen inset with a darker bezel lip.
  p.box(5, 10, 27, 32, 30, 27, dark);
  p.box(6, 11, 27, 31, 29, 27, screenIdx);
  p.sub(() => p.box(6, 11, 28, 31, 29, 35));
  // Chin details: badge, button, LED, vents on top.
  p.box(8, 7, 28, 13, 8, 28, shell[2]);
  p.box(29, 7, 28, 30, 8, 28, dark);
  p.set(27, 7, 28, led);
  for (let x = 8; x < 30; x += 3) p.box(x, 31, 10, x + 1, 31, 18, vent);
  p.recolor((x, y, z, v) => (v === shell[0] && !p.get(x, y + 1, z) ? shell[2] : null));
  return p;
}

def('crt_monitor', { name: 'Old CRT', biome: 'junkyard', tags: ['computer', 'screen'], decor: null }, ({ rng }) => {
  const m = new VoxelModel(52, 46, 48);
  const screen = m.color('#2d6b5e', { emissive: 0.6, jitter: 0.03 });
  const crt = crtPart(m, screen);
  const rust = RUST.map((c) => m.color(c, { jitter: 0.12 }));
  stampRot(m, crt, [19, 0, 18], [26, 3, 22], 0, 0, -4);
  rustify(m, m.palette.map((p, i) => i).filter((i) => i && m.palette[i].color === BEIGE[1]), rust, 3, 0.35);
  junkMound(m, 26, 24, 20, 16, 3, 4);
  moss(m, rng, 5, MOSS, 0.3, 0.18);
  barnacles(m, rng, 3);
  return { m, yaw: 18, screens: [screen], light: '#7fffd0' };
});

def('crt_pile', { name: 'CRT Pile', biome: 'junkyard', tags: ['computer', 'screen', 'hero'] }, ({ rng }) => {
  const m = new VoxelModel(96, 84, 64);
  const scr = [m.color('#2d6b5e', { emissive: 0.6, jitter: 0.03 }), m.color('#3a4f7a', { emissive: 0.55, jitter: 0.03 }), m.color('#5a3a6a', { emissive: 0.5, jitter: 0.03 })];
  const grey = [m.color('#9a9a9e', { jitter: 0.08 }), m.color('#7c7c84', { jitter: 0.08 }), m.color('#b8b8bc', { jitter: 0.06 })];
  const black = [m.color('#3a3a44', { jitter: 0.08 }), m.color('#2c2c34', { jitter: 0.08 }), m.color('#55555f', { jitter: 0.06 })];
  const rust = RUST.map((c) => m.color(c, { jitter: 0.12 }));
  const cable = [m.color('#2a2a30', { jitter: 0.04, smooth: 0.4 }), m.color('#d0c040', { jitter: 0.04 })];
  stampRot(m, crtPart(m, scr[0]), [19, 0, 18], [26, 2, 30], 0, 14, 0);
  stampRot(m, crtPart(m, scr[1], { shell: grey }), [19, 0, 18], [66, 2, 28], 0, -18, 0);
  stampRot(m, crtPart(m, scr[2], { shell: black }), [19, 0, 18], [46, 36, 26], 0, 6, -9);
  // Cables snaking off the pile.
  m.tube([[30, 34, 44, 0.9], [20, 26, 52, 0.9], [12, 10, 50, 0.9], [6, 2, 56, 0.9]], cable[0]);
  m.tube([[70, 36, 40, 0.8], [84, 24, 46, 0.8], [90, 8, 40, 0.8], [92, 2, 52, 0.8]], cable[0]);
  m.box(4, 1, 55, 7, 3, 58, cable[1]);
  rustify(m, [...grey, ...black], rust, 6, 0.3);
  junkMound(m, 46, 32, 38, 24, 5, 9);
  moss(m, rng, 6, MOSS, 0.3, 0.16);
  barnacles(m, rng, 6);
  return { m, yaw: 22, screens: scr, vs: 1.7, light: '#8fd8ff' };
});

def('keyboard_slab', { name: 'Keyboard Slab', biome: 'junkyard', tags: ['computer'] }, ({ rng }) => {
  const m = new VoxelModel(70, 22, 40);
  const kb = part(m, 62, 8, 24);
  const body = [m.color('#3c3d48', { jitter: 0.06 }), m.color('#2c2d36', { jitter: 0.06 })];
  const key = [m.color('#e6dec6', { jitter: 0.05 }), m.color('#cfc6ab', { jitter: 0.05 })];
  const keyD = m.color('#9a9284', { jitter: 0.05 });
  const keyR = m.color('#e0604a', { jitter: 0.04 });
  const hole = m.color('#3a332c', { jitter: 0 });
  kb.box(0, 0, 0, 61, 2, 23, body[0]);
  kb.box(0, 3, 0, 61, 3, 23, body[1]);
  for (let r = 0; r < 5; r++) for (let c = 0; c < 15; c++) {
    const x = 2 + c * 4, z = 2 + r * 4;
    if (r === 4 && c > 3 && c < 11) { if (c === 4) kb.box(x, 4, z, x + 26, 5, z + 2, key[0]); continue; }
    if (h3(r, c, 0, 4) < 0.08) { kb.box(x, 3, z, x + 2, 3, z + 2, hole); continue; }
    const col = r === 0 && c === 0 ? keyR : c > 12 ? keyD : key[(r + c) % 5 === 0 ? 1 : 0];
    kb.box(x, 4, z, x + 2, 5, z + 2, col);
  }
  const rust = RUST.map((c) => m.color(c, { jitter: 0.12 }));
  rustify(kb, [body[0]], rust, 2, 0.3);
  stampRot(m, kb, [31, 0, 12], [35, 4, 20], 14, -10, 6);
  const cable = m.color('#2a2a30', { smooth: 0.4 });
  m.tube([[18, 8, 12, 0.8], [10, 4, 6, 0.8], [3, 2, 14, 0.8]], cable);
  junkMound(m, 35, 21, 27, 13, 4, 2);
  moss(m, rng, 3, MOSS, 0.2, 0.2, [body[0], body[1]]);
  return { m, yaw: 26 };
});

def('vending_machine', { name: 'Vending Machine', biome: 'junkyard', tags: ['machine', 'glow'] }, ({ rng }) => {
  const m = new VoxelModel(50, 74, 46);
  const vm = part(m, 34, 64, 26);
  const red = [m.color('#c8423f', { jitter: 0.08 }), m.color('#a3343a', { jitter: 0.08 }), m.color('#e2645a', { jitter: 0.06 })];
  const white = m.color('#e8e2d6', { jitter: 0.06 });
  const dark = m.color('#25202a', { jitter: 0.03 });
  const panel = m.color('#bff6ff', { emissive: 0.9, jitter: 0.02 });
  const glassC = m.color('#7fd8e8', { emissive: 0.65, jitter: 0.03 });
  const shelf = m.color('#9aa6b0', { jitter: 0.04, emissive: 0.3 });
  const cans = ['#ff5a5a', '#5ad1ff', '#ffd84a', '#7dff7a', '#ff8ad8', '#ffffff'].map((c) => m.color(c, { jitter: 0.04, emissive: 0.45 }));
  const btn = [m.color('#ffe066', { emissive: 1, jitter: 0 }), m.color('#66ffcc', { emissive: 1, jitter: 0 })];
  const metal = m.color('#9aa0ac', { jitter: 0.05, spec: 1 });
  vm.box(0, 0, 0, 33, 63, 23, red[0]);
  vm.box(0, 0, 0, 33, 3, 23, red[1]);
  vm.box(0, 60, 0, 33, 63, 23, red[1]);
  vm.box(0, 61, 24, 33, 62, 24, white);
  // Glass window with shelves of cans.
  vm.sub(() => vm.box(2, 16, 21, 23, 58, 23));
  vm.box(2, 16, 20, 23, 58, 20, glassC);
  for (let r = 0; r < 5; r++) {
    const y = 18 + r * 8;
    vm.box(2, y, 18, 23, y, 22, shelf);
    for (let c = 0; c < 6; c++) {
      const col = cans[(r * 2 + c + (r > 2 ? 1 : 0)) % cans.length];
      vm.box(3 + c * 3.5, y + 1, 20, 4 + c * 3.5, y + 5, 21, col);
      vm.set(3 + c * 3.5, y + 5, 21, white);
    }
  }
  vm.box(1, 15, 23, 24, 15, 23, metal);
  vm.box(1, 59, 23, 24, 59, 23, metal);
  // Button panel + coin slot.
  vm.box(26, 30, 24, 31, 56, 24, dark);
  vm.box(27, 50, 25, 30, 55, 25, panel);
  for (let i = 0; i < 6; i++) vm.box(27 + (i % 2) * 2, 34 + Math.floor(i / 2) * 4, 25, 27 + (i % 2) * 2, 35 + Math.floor(i / 2) * 4, 25, btn[i % 2]);
  vm.box(28, 26, 24, 29, 28, 24, metal);
  // Pickup flap.
  vm.box(4, 5, 24, 22, 11, 24, dark);
  vm.box(4, 11, 24, 22, 12, 24, metal);
  // Logo stripe on the side.
  vm.box(34, 40, 3, 34, 46, 20, white);
  vm.recolor((x, y, z, p) => (p === red[0] && !vm.get(x, y + 1, z) ? red[2] : null));
  const rust = RUST.map((c) => m.color(c, { jitter: 0.12 }));
  rustify(vm, red, rust, 7, 0.45);
  stampRot(m, vm, [17, 0, 12], [24, 2, 22], 0, 0, 5);
  junkMound(m, 25, 24, 20, 17, 4, 5);
  moss(m, rng, 9, MOSS, 0.3, 0.2);
  barnacles(m, rng, 4, red);
  return { m, yaw: 24, light: '#bff6ff', screens: [glassC] };
});

def('server_rack', { name: 'Server Rack', biome: 'junkyard', tags: ['computer', 'glow'] }, ({ rng, frame }) => {
  const m = new VoxelModel(44, 80, 40);
  const frameC = [m.color(GUN[1], { jitter: 0.06 }), m.color(GUN[0], { jitter: 0.06 }), m.color(GUN[2], { jitter: 0.05 })];
  const unit = [m.color('#2e3240', { jitter: 0.05 }), m.color('#3a3f50', { jitter: 0.05 }), m.color('#252834', { jitter: 0.04 })];
  const bezel = m.color('#8d97aa', { jitter: 0.04, spec: 1 });
  const vent = m.color('#191b24', { jitter: 0 });
  const ledOn = [m.color('#5dff7a', { emissive: 1, jitter: 0 }), m.color('#ffb84a', { emissive: 1, jitter: 0 }), m.color('#59c8ff', { emissive: 1, jitter: 0 })];
  const ledOff = m.color('#2b3a2f', { jitter: 0 });
  const cable = [m.color('#e0c040', { smooth: 0.4 }), m.color('#3a9ad9', { smooth: 0.4 }), m.color('#d04a4a', { smooth: 0.4 })];
  const x0 = 8, x1 = 33, z0 = 8, z1 = 29;
  m.box(x0, 0, z0, x1, 70, z1, unit[2]);
  // Frame posts and top/bottom.
  for (const [x, z] of [[x0, z1], [x1, z1], [x0, z0], [x1, z0]]) m.box(x, 0, z, x, 70, z, frameC[1]);
  m.box(x0, 68, z0, x1, 71, z1, frameC[0]);
  m.box(x0, 0, z0, x1, 2, z1, frameC[0]);
  m.box(x0 - 1, 0, z0 - 1, x1 + 1, 0, z1 + 1, frameC[1]);
  // Rack units on the front.
  let y = 4, u = 0;
  while (y < 66) {
    const h = [3, 3, 5, 3, 7, 3][u % 6];
    if (y + h > 67) break;
    m.box(x0 + 1, y, z1, x1 - 1, y + h - 1, z1, unit[u % 2]);
    m.box(x0 + 1, y, z1 + 1, x0 + 2, y + h - 1, z1 + 1, bezel);
    m.box(x1 - 2, y, z1 + 1, x1 - 1, y + h - 1, z1 + 1, bezel);
    if (h >= 5) for (let x = x0 + 5; x < x1 - 8; x += 2) m.box(x, y + 1, z1, x, y + h - 2, z1, vent);
    else for (let x = x0 + 5; x < x1 - 8; x += 3) m.set(x, y + 1, z1, vent);
    // LEDs: blink pattern flips between frames.
    for (let k = 0; k < 3; k++) {
      const on = h3(u, k, frame, 11) < 0.62;
      m.set(x1 - 4 - k * 2, y + Math.floor(h / 2), z1 + 1, on ? ledOn[(u + k) % 3] : ledOff);
    }
    y += h + 1;
    u++;
  }
  // Open mesh door hanging off its hinge.
  const door = part(m, 30, 70, 4);
  for (let yy = 0; yy < 68; yy++) for (let xx = 0; xx < 26; xx++) {
    const edge = xx < 2 || xx > 23 || yy < 2 || yy > 65;
    if (edge || (xx + yy) % 4 === 0 || (xx - yy + 400) % 4 === 0) door.set(xx, yy, 1, edge ? frameC[2] : frameC[1]);
  }
  stampRot(m, door, [0, 0, 1], [x0 - 1, 1, z1 + 2], 0, 115, 0);
  // Cables spilling from the top.
  m.tube([[14, 71, 20, 0.8], [10, 74, 26, 0.8], [4, 60, 34, 0.8], [3, 30, 36, 0.8], [2, 2, 38, 0.8]], cable[0]);
  m.tube([[28, 71, 18, 0.8], [36, 72, 22, 0.8], [40, 50, 30, 0.8], [41, 20, 36, 0.8], [42, 1, 38, 0.8]], cable[1]);
  m.tube([[22, 71, 14, 0.7], [24, 75, 10, 0.7], [30, 66, 6, 0.7]], cable[2]);
  const rust = RUST.map((c) => m.color(c, { jitter: 0.12 }));
  rustify(m, frameC, rust, 4, 0.4);
  junkMound(m, 21, 21, 20, 18, 3, 6);
  moss(m, rng, 2, MOSS, 0.3, 0.2);
  return { m, yaw: 30, light: '#5dff7a' };
});

def('tire', { name: 'Old Tire', biome: 'junkyard', tags: ['junk'] }, ({ rng }) => {
  const m = new VoxelModel(48, 34, 40);
  const t = part(m, 34, 34, 16);
  const rub = [m.color('#33313a', { jitter: 0.08, smooth: 0.6 }), m.color('#26252c', { jitter: 0.06, smooth: 0.6 }), m.color('#4a4752', { jitter: 0.06, smooth: 0.6 })];
  const rim = [m.color('#9aa0ac', { jitter: 0.06, smooth: 0.5, spec: 1.2 }), m.color('#6c7280', { jitter: 0.06, smooth: 0.5 })];
  torus(t, 17, 17, 8, 11, 5.4, (x, y, z) => {
    const a = Math.atan2(y - 17, x - 17);
    const rr = Math.hypot(x - 17, y - 17);
    if (rr > 14.5) return Math.floor(a * 9 + (z > 8 ? 0.5 : 0)) % 2 ? rub[1] : rub[0];
    return rr > 12.5 ? rub[2] : rub[0];
  }, 'z');
  t.cylinder(17, 17, 5, 11, 7, (x, y, z) => (z === 5 || z === 11 ? rim[0] : rim[1]), 'z');
  t.sub(() => t.cylinder(17, 17, 4, 12, 2.5, 0, 'z'));
  for (let k = 0; k < 5; k++) { const a = k / 5 * Math.PI * 2; t.sub(() => t.cylinder(17 + Math.cos(a) * 4.6, 17 + Math.sin(a) * 4.6, 10, 12, 1.1, 0, 'z')); }
  const rust = RUST.map((c) => m.color(c, { jitter: 0.12 }));
  rustify(t, rim, rust, 5, 0.6);
  stampRot(m, t, [17, 0, 8], [24, 0, 20], 0, -30, 0);
  junkMound(m, 24, 21, 17, 13, 5, 1);
  moss(m, rng, 4, MOSS, 0.4, 0.2);
  return { m, yaw: 30 };
});

def('rusty_barrel', { name: 'Toxic Drum', biome: 'junkyard', tags: ['junk', 'glow'] }, ({ rng }) => {
  const m = new VoxelModel(52, 42, 44);
  const d = part(m, 26, 34, 26);
  const paint = [m.color('#3f7a8c', { jitter: 0.08, smooth: 0.55 }), m.color('#35687a', { jitter: 0.08, smooth: 0.55 })];
  const rust = RUST.map((c) => m.color(c, { jitter: 0.12, smooth: 0.55 }));
  const hazard = m.color('#f2c230', { jitter: 0.05, smooth: 0.55 });
  const blk = m.color('#2a2620', { jitter: 0.03, smooth: 0.55 });
  const goo = [m.color('#9dff4a', { emissive: 0.85, jitter: 0.05, smooth: 0.6 }), m.color('#5fd43a', { emissive: 0.6, jitter: 0.05, smooth: 0.6 })];
  d.cylinder(13, 13, 0, 31, 11, (x, y, z) => (y === 10 || y === 21 ? paint[1] : paint[0]));
  for (const y of [10, 21]) d.cylinder(13, 13, y, y, 11.8, paint[1]);
  d.cylinder(13, 13, 31, 31, 10, paint[1]);
  d.sub(() => d.cylinder(13, 13, 31, 31, 9));
  d.cylinder(17, 13, 31, 32, 1.6, blk);
  // Hazard label on the front.
  d.paint(() => shape(d, 0, 12, 0, 25, 19, 25, (x, y, z) => z > 18 && Math.abs(x - 13) < 6, (x, y, z) => (Math.abs(x - 13) < 1.5 && y > 14 && y < 18 ? blk : hazard)));
  // Dents.
  d.sub(() => { d.sphere(4, 25, 21, 2.6); d.sphere(22, 6, 21, 2.2); });
  rustify(d, paint, rust, 9, 0.6);
  stampRot(m, d, [13, 0, 13], [20, 0, 22], 0, 15, -78);
  // Spilled goo pool + drips glowing.
  shape(m, 30, 0, 12, 51, 3, 40, (x, y, z) => {
    const r = ((x - 41) / 10) ** 2 + ((z - 26) / 12) ** 2 + noise3(x * 0.25, 0, z * 0.25, 3) * 0.6;
    return r < 1 && y <= 1.5 - r;
  }, (x, y, z) => (h3(x, y, z, 2) < 0.3 ? goo[0] : goo[1]));
  junkMound(m, 24, 22, 23, 19, 4, 7);
  moss(m, rng, 2, MOSS, 0.25, 0.2);
  return { m, yaw: 30, light: '#9dff4a' };
});

def('shopping_cart', { name: 'Shopping Cart', biome: 'junkyard', tags: ['junk'] }, ({ rng }) => {
  const m = new VoxelModel(64, 56, 50);
  const c = part(m, 48, 40, 28);
  const wire = [m.color('#b4bac6', { jitter: 0.05, spec: 1 }), m.color('#8c93a0', { jitter: 0.05 })];
  const red = m.color('#d8453f', { jitter: 0.05 });
  const redD = m.color('#a8323a', { jitter: 0.05 });
  const wheel = m.color('#2b2a30', { jitter: 0.04 });
  const bx0 = (y) => Math.round(6 + (30 - y) * 0.22), bx1 = 40;
  const z0 = 4, z1 = 23;
  for (let y = 12; y <= 30; y++) {
    const xa = bx0(y);
    const rimY = y === 30 || y === 12;
    for (let x = xa; x <= bx1; x++) for (const z of [z0, z1]) if ((x - xa) % 4 === 0 || y % 6 === 0 || rimY) c.set(x, y, z, rimY ? wire[0] : wire[1]);
    for (let z = z0; z <= z1; z++) for (const x of [xa, bx1]) if ((z - z0) % 4 === 0 || y % 6 === 0 || rimY) c.set(x, y, z, rimY ? wire[0] : wire[1]);
  }
  for (let x = bx0(12); x <= bx1; x++) for (let z = z0; z <= z1; z++) if ((x - bx0(12)) % 4 === 0 || (z - z0) % 4 === 0) c.set(x, 12, z, wire[1]);
  // Handle with red grip.
  c.line(bx1, 30, z0, 44, 35, z0, wire[0], 0.5); c.line(bx1, 30, z1, 44, 35, z1, wire[0], 0.5);
  c.box(44, 35, z0 - 1, 45, 36, z1 + 1, red);
  c.box(44, 35, z0 - 1, 45, 35, z1 + 1, redD);
  // Chassis + castor wheels.
  c.line(8, 5, z0 + 1, 40, 5, z0 + 1, wire[0], 0.6); c.line(8, 5, z1 - 1, 40, 5, z1 - 1, wire[0], 0.6);
  for (const [x, z] of [[9, z0 + 1], [9, z1 - 1], [38, z0 + 1], [38, z1 - 1]]) {
    c.line(x, 5, z, x, 12, z, wire[0], 0.5);
    c.box(x - 1, 1, z - 1, x + 1, 4, z + 1, wheel);
  }
  // Leaning, one wheel sunk into the silt.
  stampRot(m, c, [24, 0, 14], [32, 2, 24], 8, 22, -10);
  const rust = RUST.map((cc) => m.color(cc, { jitter: 0.12 }));
  rustify(m, wire, rust, 3, 0.3);
  junkMound(m, 32, 25, 24, 16, 4, 3);
  // Kelp caught in the basket.
  const kelp = [m.color('#4fa25e', { smooth: 0.3 }), m.color('#86cf74', { smooth: 0.3 })];
  m.tube([[20, 30, 22, 0.6], [24, 34, 26, 0.6], [22, 42, 24, 0.6], [26, 48, 26, 0.6]], kelp[0]);
  m.tube([[30, 30, 18, 0.6], [34, 37, 20, 0.6], [32, 44, 22, 0.6]], kelp[1]);
  return { m, yaw: 30 };
});

def('satellite_dish', { name: 'Satellite Dish', biome: 'junkyard', tags: ['machine'] }, ({ rng }) => {
  const m = new VoxelModel(64, 70, 54);
  const dish = part(m, 50, 50, 20);
  const white = [m.color('#d2d7de', { jitter: 0.04, smooth: 0.75 }), m.color('#c3c9d2', { jitter: 0.04, smooth: 0.75 }), m.color('#e9ecef', { jitter: 0.03, smooth: 0.5 })];
  const metal = [m.color(GUN[0], { jitter: 0.06 }), m.color(GUN[2], { jitter: 0.05, spec: 1 })];
  const rust = RUST.map((c) => m.color(c, { jitter: 0.12, smooth: 0.5 }));
  const ledC = m.color('#ff5a4a', { emissive: 1, jitter: 0 });
  const R = 22, cx = 25, cy = 25;
  // Paraboloid shell (axis +z), 2 voxels thick.
  shape(dish, 0, 0, 0, 49, 49, 19, (x, y, z) => {
    const r2 = (x - cx) ** 2 + (y - cy) ** 2;
    if (r2 > R * R) return false;
    const zs = 2 + r2 / (R * R) * 9;
    return z >= zs && z <= zs + 1.8;
  }, (x, y, z) => {
    const r = Math.hypot(x - cx, y - cy);
    return r > R - 1.5 ? white[2] : Math.abs(r - 11) < 0.6 ? white[1] : white[0];
  });
  // Feed arm + horn at focus.
  dish.line(cx, cy - R + 2, 11, cx, cy, 30, metal[0], 0.7);
  dish.line(cx - R + 3, cy + 6, 11, cx, cy, 30, metal[0], 0.7);
  dish.box(cx - 2, cy - 2, 29, cx + 2, cy + 2, 33, metal[1]);
  dish.set(cx, cy + 3, 33, ledC);
  dish.cylinder(cx, cy, 0, 3, 4, metal[0], 'z');
  rustify(dish, white, rust, 5, 0.22);
  // Mount: base box + pole + yoke.
  const base = [m.color('#7d838f', { jitter: 0.06 }), m.color('#5c616d', { jitter: 0.06 })];
  m.box(20, 0, 18, 40, 5, 36, base[1]);
  m.box(21, 6, 19, 39, 6, 35, base[0]);
  m.cylinder(30, 27, 6, 30, 2.4, metal[0]);
  stampRot(m, dish, [cx, cy, 0], [30, 36, 28], -38, -28, 12);
  rustify(m, base, rust, 8, 0.45);
  junkMound(m, 30, 28, 22, 17, 4, 6);
  moss(m, rng, 7, MOSS, 0.3, 0.2, base);
  barnacles(m, rng, 4, base);
  return { m, yaw: 30 };
});

def('gear_big', { name: 'Giant Gear', biome: 'junkyard', tags: ['machine', 'metal'] }, ({ rng }) => {
  const m = new VoxelModel(70, 60, 44);
  const g = part(m, 56, 56, 10);
  const steel = [m.color('#7a8292', { jitter: 0.06, smooth: 0.3 }), m.color('#626a7a', { jitter: 0.06, smooth: 0.3 }), m.color('#98a0ae', { jitter: 0.05, smooth: 0.3, spec: 0.8 })];
  const rust = RUST.map((c) => m.color(c, { jitter: 0.12, smooth: 0.3 }));
  const cx = 28, cy = 28, teeth = 16;
  shape(g, 0, 0, 0, 55, 55, 9, (x, y, z) => {
    const dx = x - cx, dy = y - cy;
    const r = Math.hypot(dx, dy), a = Math.atan2(dy, dx);
    const tooth = ((a / (Math.PI * 2)) * teeth % 1 + 1) % 1;
    const outer = 22 + (tooth > 0.25 && tooth < 0.75 ? 4.5 : 0);
    if (r > outer) return false;
    if (r < 4) return false;
    // Rim and hub are full thickness; web between is thinner with 6 round windows.
    const web = r > 8 && r < 18;
    if (web && (z < 3 || z > 6)) return false;
    if (web) {
      for (let k = 0; k < 6; k++) {
        const ka = k / 6 * Math.PI * 2;
        if (Math.hypot(dx - Math.cos(ka) * 13, dy - Math.sin(ka) * 13) < 3.6) return false;
      }
    }
    return true;
  }, (x, y, z) => {
    const r = Math.hypot(x - cx, y - cy);
    return r > 22.5 ? steel[2] : r < 8 ? steel[1] : steel[0];
  });
  g.cylinder(cx, cy, 0, 9, 4.2, steel[1], 'z');
  g.sub(() => g.cylinder(cx, cy, 0, 9, 2.2, 0, 'z'));
  g.box(cx - 0.5, cy + 1.5, 0, cx + 0.5, cy + 3, 9, 0);
  rustify(g, steel, rust, 3, 0.55);
  stampRot(m, g, [cx, 0, 5], [35, -6, 20], 0, -24, 10);
  junkMound(m, 35, 22, 26, 15, 7, 4);
  moss(m, rng, 3, MOSS, 0.3, 0.2);
  barnacles(m, rng, 5, steel);
  return { m, yaw: 30 };
});

def('circuit_coral', { name: 'Circuit Coral', biome: 'junkyard', tags: ['coral', 'glow'], decor: { price: 220, size: 1 } }, ({ rng, variant }) => {
  const m = new VoxelModel(60, 72, 50);
  const pcb = [m.color('#2f8a4e', { jitter: 0.05 }), m.color('#257040', { jitter: 0.05 }), m.color('#47b86c', { jitter: 0.04 })];
  const trace = m.color('#e8c050', { jitter: 0.03, spec: 1.2 });
  const chip = m.color('#25232c', { jitter: 0.04 });
  const chipT = m.color('#3a3844', { jitter: 0.03 });
  const pin = m.color('#c9ccd4', { jitter: 0.03, spec: 1 });
  const comp = [m.color('#d8b080', { jitter: 0.03 }), m.color('#3a6ad8', { jitter: 0.03 }), m.color('#222', { jitter: 0.02 })];
  const ledSets = [['#ff4a6b', '#4affc8', '#ffd84a'], ['#59c8ff', '#b46bff', '#4affc8'], ['#9dff4a', '#ffd84a', '#ff8a4a']];
  const leds = ledSets[variant % ledSets.length].map((c) => m.color(c, { emissive: 1, jitter: 0 }));
  // Base: a big socketed chip with pins.
  m.box(16, 0, 14, 43, 4, 35, chip);
  m.box(16, 5, 14, 43, 5, 35, chipT);
  for (let x = 17; x <= 42; x += 2) { m.box(x, 0, 13, x, 2, 13, pin); m.box(x, 0, 36, x, 2, 36, pin); }
  m.box(18, 6, 16, 19, 6, 17, pin);
  const tips = [];
  // Manhattan branches: rise, step sideways, rise again; tips carry LEDs.
  const grow = (x, y, z, len, w, depth) => {
    const up = Math.round(len * rng.float(0.7, 1));
    m.box(x - w, y, z - w, x + w - 1, y + up, z + w - 1, pcb[depth % 2]);
    const top = y + up;
    if (depth <= 0) { tips.push([x, top, z, w]); return; }
    const n = depth >= 2 ? 3 : 2;
    const dirs = rng.shuffle([[1, 0], [-1, 0], [0, 1], [0, -1]]);
    for (let i = 0; i < n; i++) {
      const [dx, dz] = dirs[i];
      const side = rng.int(4, 8) - (3 - depth);
      const nx = x + dx * side, nz = z + dz * side;
      const ww = Math.max(1, w - 1);
      m.box(Math.min(x, nx) - ww, top - ww * 2 + 1, Math.min(z, nz) - ww, Math.max(x, nx) + ww - 1, top, Math.max(z, nz) + ww - 1, pcb[(depth + 1) % 2]);
      grow(nx, top, nz, Math.round(len * 0.72), ww, depth - 1);
    }
  };
  grow(30, 6, 25, 18, 3, 3);
  for (const [x, y, z, w] of tips) {
    const led = leds[(h3(x, y, z, 1) * 3) | 0];
    m.box(x - w, y + 1, z - w, x + w - 1, y + 2, z + w - 1, led);
    m.set(x, y + 3, z, led);
  }
  // Gold traces, bright top edges and little components.
  m.recolor((x, y, z, p) => {
    if (p !== pcb[0] && p !== pcb[1]) return null;
    if (!m.get(x, y + 1, z)) return pcb[2];
    return (y % 5 === 0 || (x + z) % 6 === 0) && m.exposed(x, y, z) && h3(x, y, z, 2) < 0.7 ? trace : null;
  });
  scatter(m, rng, 10, [pcb[0], pcb[1]], 'front', (x, y, z, nx, nz) => {
    const c = comp[(h3(x, y, z, 4) * 3) | 0];
    m.set(x + nx, y, z + nz, c);
    m.set(x + nx, y + 1, z + nz, c);
  });
  junkMound(m, 30, 25, 20, 16, 2, 5);
  return { m, yaw: 30, light: m.palette[leds[0]].color };
});

def('floppy_pile', { name: 'Floppy Pile', biome: 'junkyard', tags: ['computer'] }, ({ rng }) => {
  const m = new VoxelModel(60, 26, 50);
  const bodies = ['#2d2f3a', '#3a5bd1', '#d84a4a', '#d9cfb2', '#3aa86a', '#e2b84a'].map((c) => m.color(c, { jitter: 0.05 }));
  const shutter = m.color('#b8bec8', { jitter: 0.04, spec: 1.2 });
  const label = m.color('#f2efe6', { jitter: 0.03 });
  const stripe = m.color('#e05a5a', { jitter: 0.03 });
  const hole = m.color('#1a1a22', { jitter: 0 });
  const disk = (col) => {
    const p = part(m, 20, 3, 20);
    p.box(0, 0, 0, 17, 1, 17, col);
    p.box(5, 2, 0, 12, 2, 6, shutter);
    p.box(7, 2, 1, 9, 2, 4, hole);
    p.box(3, 2, 9, 14, 2, 17, label);
    p.box(3, 2, 15, 14, 2, 15, stripe);
    p.set(16, 2, 1, hole);
    return p;
  };
  for (let i = 0; i < 7; i++) {
    stampRot(m, disk(bodies[i % bodies.length]), [9, 0, 9], [28 + rng.float(-2.5, 2.5), 2 + i * 2.6, 24 + rng.float(-2, 2)], 0, rng.float(-25, 25), 0);
  }
  stampRot(m, disk(bodies[1]), [9, 0, 9], [48, 2, 34], 0, 40, 8);
  stampRot(m, disk(bodies[5]), [9, 0, 9], [10, 3, 34], 18, -20, 0);
  junkMound(m, 30, 27, 27, 20, 3, 8);
  return { m, yaw: 28 };
});

def('broken_robot', { name: 'Broken Robot', biome: 'junkyard', tags: ['machine', 'glow', 'hero'] }, ({ rng }) => {
  const m = new VoxelModel(76, 80, 58);
  const body = [m.color('#d2a24a', { jitter: 0.07, smooth: 0.25 }), m.color('#b8862f', { jitter: 0.07, smooth: 0.25 }), m.color('#e8c46e', { jitter: 0.05, smooth: 0.25 })];
  const joint = [m.color(GUN[1], { jitter: 0.06, smooth: 0.5 }), m.color(GUN[0], { jitter: 0.06, smooth: 0.5 })];
  const dark = m.color('#1f1d26', { jitter: 0.02 });
  const eye = m.color('#5ff4ff', { emissive: 1, jitter: 0 });
  const eyeDead = m.color('#3a3440', { jitter: 0 });
  const screen = m.color('#ff6a5a', { emissive: 0.7, jitter: 0.02 });
  const bolt = m.color('#f0e0b0', { jitter: 0 });
  const rust = RUST.map((c) => m.color(c, { jitter: 0.12, smooth: 0.25 }));
  const cx = 38, cz = 26;
  // Seat / hips.
  m.box(cx - 10, 4, cz - 8, cx + 10, 13, cz + 6, body[1]);
  // Legs stretched forward.
  for (const s of [-1, 1]) {
    const lx = cx + s * 6;
    m.cylinder(lx, 8, cz + 4, cz + 20, 3.2, joint[0], 'z');
    m.sphere(lx, 8, cz + 21, 3.8, joint[1]);
    m.cylinder(lx, 6, cz + 22, cz + 34, 3.6, body[0], 'z');
    m.box(lx - 4, 0, cz + 33, lx + 4, 8, cz + 38, body[1]);
  }
  // Torso.
  m.box(cx - 12, 14, cz - 9, cx + 12, 38, cz + 7, body[0]);
  m.box(cx - 13, 36, cz - 10, cx + 13, 39, cz + 8, body[1]);
  m.box(cx - 7, 20, cz + 8, cx + 7, 32, cz + 8, dark);
  m.box(cx - 6, 21, cz + 8, cx + 6, 31, cz + 8, screen);
  for (const [bx, by] of [[cx - 11, 16], [cx + 11, 16], [cx - 11, 35], [cx + 11, 35]]) m.set(bx, by, cz + 8, bolt);
  // Head tilted.
  const head = part(m, 30, 26, 26);
  head.box(3, 0, 3, 26, 18, 22, body[0]);
  head.box(2, 18, 2, 27, 20, 23, body[1]);
  head.box(6, 6, 23, 12, 12, 23, dark); head.box(7, 7, 23, 11, 11, 23, eye);
  head.box(17, 6, 23, 23, 12, 23, dark); head.box(18, 7, 23, 22, 11, 23, eyeDead);
  head.line(19, 8, 24, 22, 11, 24, rust[0], 0.4);
  head.box(10, 2, 23, 19, 3, 23, dark);
  for (let x = 11; x < 19; x += 2) head.set(x, 2, 23, bolt);
  head.line(20, 21, 12, 23, 25, 12, joint[0], 0.6);
  head.line(23, 25, 12, 27, 25, 14, joint[0], 0.6);
  head.sphere(27, 25, 14, 1.4, screen);
  m.cylinder(cx, cz - 1, 39, 42, 3, joint[0]);
  stampRot(m, head, [14.5, 0, 12.5], [cx, 42, cz - 1], 6, 10, -14);
  // Arms: left resting on the ground, right detached and lying in front.
  m.sphere(cx - 14, 34, cz - 1, 4.2, joint[1]);
  m.line(cx - 15, 33, cz - 1, cx - 19, 18, cz + 3, joint[0], 2.6);
  m.line(cx - 19, 18, cz + 3, cx - 21, 4, cz + 9, body[0], 3.2);
  m.box(cx - 24, 0, cz + 7, cx - 17, 4, cz + 14, joint[1]);
  m.sphere(cx + 14, 34, cz - 1, 4.2, joint[1]);
  m.line(cx + 22, 3, cz + 16, cx + 34, 3, cz + 26, body[0], 3.2);
  m.box(cx + 33, 0, cz + 24, cx + 38, 6, cz + 30, joint[1]);
  m.tube([[cx + 15, 33, cz - 1, 0.6], [cx + 18, 26, cz + 4, 0.6], [cx + 21, 6, cz + 12, 0.6]], m.color('#d04a4a', { smooth: 0.4 }));
  m.recolor((x, y, z, p) => (p === body[0] && !m.get(x, y + 1, z) ? body[2] : null));
  rustify(m, body, rust, 6, 0.55);
  junkMound(m, cx, cz + 6, 28, 22, 4, 3);
  moss(m, rng, 5, MOSS, 0.35, 0.18);
  // A tiny coral sprout on its shoulder.
  const sprout = m.color('#ff7aa8', { smooth: 0.4 });
  m.line(cx + 12, 40, cz - 4, cx + 13, 46, cz - 4, sprout, 0.8);
  m.line(cx + 13, 44, cz - 4, cx + 16, 47, cz - 3, sprout, 0.7);
  barnacles(m, rng, 5, body);
  return { m, yaw: 28, vs: 1.7, light: '#5ff4ff' };
});

def('pipe_bend', { name: 'Pipe Bend', biome: 'junkyard', tags: ['junk', 'metal'] }, ({ rng }) => {
  const m = new VoxelModel(64, 56, 40);
  const pipe = [m.color('#6f7a6c', { jitter: 0.07, smooth: 0.6 }), m.color('#5c6659', { jitter: 0.07, smooth: 0.6 })];
  const flange = [m.color('#8a8f98', { jitter: 0.05, smooth: 0.4 }), m.color('#5a5f6a', { jitter: 0.05 })];
  const bolt = m.color('#c9ccd4', { jitter: 0, spec: 1 });
  const inside = m.color('#1e2a22', { jitter: 0 });
  const ooze = m.color('#9dff4a', { emissive: 0.8, jitter: 0.04 });
  const rust = RUST.map((c) => m.color(c, { jitter: 0.12, smooth: 0.6 }));
  const R = 16, r = 7, cx = 22, cy = 23, zc = 20;
  // Quarter torus from horizontal (pointing -x) to vertical (pointing up).
  torus(m, cx + R, cy, zc, R, r, (x, y) => (Math.floor((x + y) / 4) % 2 ? pipe[0] : pipe[1]), 'z', (a) => a >= Math.PI / 2 - 0.02 && a <= Math.PI + 0.02);
  m.sub(() => torus(m, cx + R, cy, zc, R, r - 1.8, 0, 'z', (a) => a >= Math.PI / 2 - 0.2 && a <= Math.PI + 0.2));
  // Straight run going into the ground on the left, vertical stub on the right.
  m.cylinder(cy, zc, 0, cx, r, pipe[0], 'x');
  m.sub(() => m.cylinder(cy, zc, 0, cx, r - 1.8, 0, 'x'));
  m.cylinder(cx + R, zc, cy + R, cy + R + 8, r, pipe[1], 'y');
  m.sub(() => m.cylinder(cx + R, zc, cy + R - 2, cy + R + 9, r - 1.8, 0, 'y'));
  // Flanges with bolts.
  m.cylinder(cx + R, zc, cy + R + 8, cy + R + 10, r + 2.5, flange[0]);
  m.sub(() => m.cylinder(cx + R, zc, cy + R + 8, cy + R + 10, r - 1.8));
  for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2; m.set(cx + R + Math.cos(a) * (r + 1.3), cy + R + 11, zc + Math.sin(a) * (r + 1.3), bolt); }
  m.cylinder(cy, zc, cx - 2, cx, r + 2.5, flange[0], 'x');
  m.sub(() => m.cylinder(cy, zc, cx - 2, cx, r - 1.8, 0, 'x'));
  for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2; m.set(cx + 1, cy + Math.cos(a) * (r + 1.3), zc + Math.sin(a) * (r + 1.3), bolt); }
  // Dark interior + glowing ooze inside the mouth.
  m.cylinder(cx + R, zc, cy + R - 3, cy + R - 3, r - 1.8, inside);
  m.cylinder(cx + R, zc, cy + R - 2, cy + R - 2, r - 2.5, ooze);
  m.line(cx + R + r, cy + R + 9, zc + 2, cx + R + r + 0.5, cy + R - 6, zc + 3, ooze, 0.6);
  rustify(m, [...pipe, ...flange], rust, 4, 0.5);
  junkMound(m, 26, 21, 22, 15, 8, 4);
  moss(m, rng, 8, MOSS, 0.35, 0.2);
  barnacles(m, rng, 6, pipe);
  return { m, yaw: 30, light: '#9dff4a' };
});

// @@MORE_DEFS@@

const GEMS = [
  ['Amethyst', '#b46bff', '#7a3ad1', '#ecc8ff'],
  ['Emerald', '#3fe08f', '#1d9a63', '#c8ffd9'],
  ['Topaz', '#ffbe3d', '#d9781c', '#fff0b0'],
  ['Sapphire', '#4a8dff', '#2a4fd1', '#c4dcff'],
  ['Ruby', '#ff4a6b', '#c21f4a', '#ffc4cf'],
];

def('crystal_cluster', { name: 'Crystal Cluster', biome: 'abyss', tags: ['crystal', 'glow'], decor: { price: 400, size: 1 } }, ({ rng, variant }) => {
  const g = GEMS[variant % GEMS.length];
  const W = 40, H = 52, D = 34;
  const m = new VoxelModel(W, H, D);
  const rock = [m.color('#3a3560', { jitter: 0.3 }), m.color('#2c2a4c', { jitter: 0.3 }), m.color('#4a4472', { jitter: 0.25 })];
  const cA = m.color(g[1], { emissive: 0.35, jitter: 0.12 });
  const cB = m.color(g[2], { emissive: 0.45, jitter: 0.1 });
  const cC = m.color(g[1], { emissive: 0.25, jitter: 0.12, light: -0.4 });
  const seed = rng.int(0, 999);
  blob(m, W / 2, 1, D / 2, 16, 7, 13, 0.3, 0.2, seed, patch(rock, 0.18, seed), 0);
  const shafts = [
    [0, 1, 0, 40, 5.2], [-0.55, 1, 0.2, 28, 4], [0.6, 1, -0.15, 30, 4.2], [0.25, 1, 0.65, 20, 3.3], [-0.4, 1, -0.5, 22, 3.4], [-0.9, 0.7, 0.5, 13, 2.6], [0.9, 0.6, 0.45, 12, 2.4],
  ];
  shafts.forEach(([dx, dy, dz, len, r], i) => {
    const jx = rng.float(-1.5, 1.5), jz = rng.float(-1.5, 1.5);
    const p0 = [W / 2 + dx * 5 + jx, 3, D / 2 + dz * 5 + jz];
    shaft(m, p0, [dx, dy, dz], len * rng.float(0.88, 1.08), r, r * 1.6, i === 0 ? cB : i % 2 ? cA : cC, 6, rng.float(0, 1));
  });
  m.recolor((x, y, z, p) => (p === cA && !m.get(x - 1, y, z) && h3(x, y, z, 1) < 0.7 ? cB : null));
  return { m, yaw: 32, light: g[1] };
});

// ---------- public API ----------
export const PROPS = {};
for (const [id, d] of Object.entries(DEFS)) PROPS[id] = d.meta;

export const PROP_VARIANTS = {
  treasure_chest: [{ frame: 0, label: 'chest' }, { frame: 1, label: 'chest open' }],
  crystal_cluster: GEMS.map((g, i) => ({ variant: i, label: g[0] })),
  coral_brain: [{ variant: 0, label: 'brain coral' }, { variant: 1, label: 'brain lime' }, { variant: 2, label: 'brain pink' }],
  coral_branch: CORAL_SCHEMES.map((c, i) => ({ variant: i, label: 'tree coral ' + (i + 1) })),
  coral_fan: [0, 1, 2].map((i) => ({ variant: i, label: 'sea fan ' + (i + 1) })),
  coral_tube: [0, 1, 2].map((i) => ({ variant: i, label: 'tube sponge ' + (i + 1) })),
  coral_staghorn: [0, 1, 2].map((i) => ({ variant: i, label: 'staghorn ' + (i + 1) })),
  anemone_base: [0, 1, 2].map((i) => ({ variant: i, label: 'anemone ' + (i + 1) })),
};

const cache = new Map();
export function getProp(id, { scale = 1, variant = 0, frame = 0 } = {}) {
  const key = id + '|' + scale + '|' + variant + '|' + frame;
  let p = cache.get(key);
  if (p) return p;
  const d = DEFS[id];
  if (!d) throw new Error('unknown prop ' + id);
  const rng = new RNG((hashStr(id) ^ Math.imul(variant + 1, 0x9e3779b1)) >>> 0);
  const t0 = performance.now();
  const res = d.build({ rng, variant, frame });
  const t1 = performance.now();
  const r = renderVoxels(res.m, {
    scale: (res.vs ?? 1.75) * scale,
    yaw: res.yaw ?? 32,
    pitch: res.pitch ?? 27,
    track: res.screens || [],
    ...(res.render || {}),
  });
  const screens = (res.screens || []).map((k) => r.regions[k]?.inner).filter((q) => q && q.w > 0);
  let lights = [];
  if (res.lights) {
    lights = res.lights.map((l) => {
      const [x, y] = r.project(l.at[0], l.at[1], l.at[2]);
      return { x: Math.round(x), y: Math.round(y), r: Math.round(l.r * scale), color: l.color };
    });
  } else {
    for (const [k, reg] of Object.entries(r.regions)) {
      const pe = res.m.palette[k];
      if (!pe.emissive || reg.n < 6) continue;
      lights.push({ x: Math.round(reg.cx), y: Math.round(reg.cy), r: Math.round(Math.max(reg.w, reg.h) * 0.7 + 10 * scale), color: res.light || pe.color });
    }
  }
  p = { canvas: r.canvas, glow: r.glow, ox: r.ox, oy: r.oy, w: r.w, h: r.h, screens, lights, ms: [Math.round(t1 - t0), Math.round(performance.now() - t1)] };
  cache.set(key, p);
  return p;
}
