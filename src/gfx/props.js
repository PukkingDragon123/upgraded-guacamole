// Voxel props for every biome, the aquarium and the shop. Each prop is a hand-built,
// seeded voxel model rendered once (cached) by voxel.js into a pixel-art sprite.
//
// getProp(id, {scale, variant, frame}) -> {canvas, glow, ox, oy, w, h, screens, lights, anchors?, front?}
//   (ox, oy) = ground contact point (footprint centre); draw at (x - ox, y - oy).
//   screens: [{x, y, w, h}] emissive screen faces (largest inner rect) for animated content.
//   lights:  [{x, y, r, color}] suggested light sources, canvas-relative.
//   shop_stall also returns `front` (counter-only overlay to draw after the shopkeeper) and
//   `anchors.keeper` (where the shopkeeper's feet go), both canvas-relative.
// PROPS[id] = {name, biome, tags, decor: {price, size: 1 small | 2 medium | 3 large} | null, decorOnly}
//   biome is 'shallows' | 'junkyard' | 'abyss', or 'aquarium' (decor-only items) / 'shop' (shop_stall).
// PROP_VARIANTS[id] = [{variant, frame, label}] notable variants/frames (for galleries and shops).
//   Animated: treasure_chest frame 0 closed / 1 open, server_rack frame 0/1 LED blink.
//   Coloured variants: crystal_cluster 0-4 (amethyst, emerald, topaz, sapphire, ruby), corals,
//   anemone, glow_mushroom, circuit_coral, glyph_stone, lava_lamp; other ids reseed per variant.
// Sprites are built lazily and cached per (id, scale, variant, frame); `ms` = [build, render] timing.

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
  const { nx: snx, ny: sny, nz: snz, data: sd } = src;
  const xa = Math.floor(lo[0]), xb = Math.ceil(hi[0]);
  // Inverse mapping, stepping linearly along x: q(x + 1) = q(x) + R^T e_x.
  const ix = R[0][0], iy = R[0][1], iz = R[0][2];
  for (let y = Math.floor(lo[1]); y <= Math.ceil(hi[1]); y++) for (let z = Math.floor(lo[2]); z <= Math.ceil(hi[2]); z++) {
    const px = xa + 0.5 - dp[0], py = y + 0.5 - dp[1], pz = z + 0.5 - dp[2];
    let qx = R[0][0] * px + R[1][0] * py + R[2][0] * pz + sp[0];
    let qy = R[0][1] * px + R[1][1] * py + R[2][1] * pz + sp[1];
    let qz = R[0][2] * px + R[1][2] * py + R[2][2] * pz + sp[2];
    for (let x = xa; x <= xb; x++, qx += ix, qy += iy, qz += iz) {
      if (qx < 0 || qy < 0 || qz < 0 || qx >= snx || qy >= sny || qz >= snz) continue;
      const v = sd[(qx | 0) + snx * ((qy | 0) + sny * (qz | 0))];
      if (v) dst.put(x, y, z, v);
    }
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

// Implicit shape tested in a rotated local frame: test(lx, ly, lz) with local coords relative to `c`.
function shapeRot(m, c, rad, rot, test, col) {
  const R = rotMat(...rot);
  shape(m, c[0] - rad, c[1] - rad, c[2] - rad, c[0] + rad, c[1] + rad, c[2] + rad, (x, y, z) => {
    const px = x - c[0], py = y - c[1], pz = z - c[2];
    return test(R[0][0] * px + R[1][0] * py + R[2][0] * pz, R[0][1] * px + R[1][1] * py + R[2][1] * pz, R[0][2] * px + R[1][2] * py + R[2][2] * pz);
  }, col);
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
  const { nx, ny, nz, data, palette } = m;
  const SY = nx, SZ = nx * ny;
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) {
    const row = SY * y + SZ * z;
    for (let x = 0; x < nx; x++) {
      const i = row + x;
      const v = data[i];
      if (!v || (set && !set.has(v)) || palette[v].emissive || palette[v].noDecal) continue;
      const top = y + 1 >= ny || !data[i + SY];
      const front = z + 1 >= nz || !data[i + SZ] || x + 1 >= nx || !data[i + 1];
      const side = front || x === 0 || !data[i - 1] || z === 0 || !data[i - SZ];
      if (facing === 'top' && !top) continue;
      if (facing === 'side' && (!side || top)) continue;
      if (facing === 'front' && (!front || top)) continue;
      if (facing === 'any' && !top && !side) continue;
      out.push(i);
    }
  }
  return out;
}

// Unpack a voxel index from candidates().
const unpackIdx = (m, i) => [i % m.nx, Math.floor(i / m.nx) % m.ny, Math.floor(i / (m.nx * m.ny))];

function scatter(m, rng, count, on, facing, place) {
  const cand = candidates(m, on, facing);
  for (let i = 0; i < count && cand.length; i++) {
    const k = Math.floor(rng.next() * cand.length);
    const [x, y, z] = unpackIdx(m, cand[k]);
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
  const idx = cols.map((c, i) => m.color(c, { jitter: 0.1, smooth: 0.8, light: i === 2 ? 0.2 : 0 }));
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

// Tabulate a hull half-width function f(x, y, shrink) on the voxel grid (per distinct shrink).
function tabulate(nx, ny, f) {
  const tables = new Map();
  return (x, y, shrink = 0) => {
    let t = tables.get(shrink);
    if (!t) {
      t = new Float32Array(nx * ny);
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) t[i + j * nx] = f(i + 0.5, j + 0.5, shrink);
      tables.set(shrink, t);
    }
    const i = Math.floor(x), j = Math.floor(y);
    if (i < 0 || j < 0 || i >= nx || j >= ny) return -1;
    return t[i + j * nx];
  };
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
const INTERACT = {};
function def(id, meta, build) {
  DEFS[id] = { meta: { name: meta.name, biome: meta.biome, tags: meta.tags || [], decor: meta.decor || null, decorOnly: !!meta.decorOnly }, build };
  if (meta.desc) DEFS[id].meta.desc = meta.desc;
  if (meta.interact) INTERACT[id] = meta.interact;
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
  const halfAt = tabulate(108, 48, (x, y, shrink) => {
    const t = T(x);
    const B = beam(t) - shrink;
    if (B <= 0) return -1;
    const yk = keel(t) + shrink, ys = sheer(t);
    if (y < yk || y > ys) return -1;
    return B * Math.min(1, Math.pow((y - yk) / Math.max(1, 20 - yk * 0.5), 0.42));
  });
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
  const m = new VoxelModel(70, 16, 44);
  const body = [m.color('#3c3d48', { jitter: 0.05 }), m.color('#2c2d36', { jitter: 0.05 }), m.color('#555665', { jitter: 0.04 })];
  const key = [m.color('#e8e0c8', { jitter: 0.04 }), m.color('#d4cbb0', { jitter: 0.04 })];
  const keyD = m.color('#a09888', { jitter: 0.04 });
  const keyR = m.color('#e0604a', { jitter: 0.03 });
  const keyB = m.color('#5aa0d8', { jitter: 0.03 });
  const x0 = 4, z0 = 8;
  m.box(x0, 1, z0, x0 + 61, 3, z0 + 29, body[0]);
  m.box(x0, 1, z0, x0 + 61, 1, z0 + 29, body[1]);
  m.box(x0 + 1, 4, z0 + 1, x0 + 60, 4, z0 + 28, body[1]);
  m.box(x0, 4, z0 + 28, x0 + 61, 4, z0 + 29, body[2]);
  // Five rows of chunky keys (3 deep with 2-voxel gutters so rows read from above).
  for (let r = 0; r < 5; r++) for (let c = 0; c < 15; c++) {
    const x = x0 + 2 + c * 4, z = z0 + 2 + r * 5;
    if (r === 4 && c > 3 && c < 11) { if (c === 4) m.box(x, 5, z, x + 26, 6, z + 2, key[0]); continue; }
    if (h3(r, c, 0, 4) < 0.05) continue;
    const col = r === 0 && c === 0 ? keyR : r === 3 && c === 13 ? keyB : c > 12 ? keyD : key[(r + c) % 5 === 0 ? 1 : 0];
    m.box(x, 5, z, x + 2, 6, z + 2, col);
  }
  // Coiled cable.
  const cable = m.color('#2a2a30', { smooth: 0.4 });
  m.tube([[x0 + 30, 3, z0 - 1, 0.8], [x0 + 26, 2, z0 - 5, 0.8], [x0 + 16, 2, z0 - 6, 0.8], [x0 + 8, 2, z0 - 3, 0.8], [2, 2, z0 - 6, 0.8]], cable);
  junkMound(m, 36, 24, 34, 19, 2, 2);
  moss(m, rng, 3, MOSS, 0.2, 0.2, body);
  barnacles(m, rng, 2, body);
  return { m, yaw: 18, pitch: 30 };
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
  const m = new VoxelModel(64, 72, 56);
  const white = [m.color('#d2d7de', { jitter: 0.04, smooth: 0.8 }), m.color('#bfc5ce', { jitter: 0.04, smooth: 0.8 }), m.color('#eceef2', { jitter: 0.03, smooth: 0.6 })];
  const metal = [m.color(GUN[0], { jitter: 0.06 }), m.color(GUN[2], { jitter: 0.05, spec: 1 })];
  const rust = RUST.map((c) => m.color(c, { jitter: 0.12, smooth: 0.6 }));
  const ledC = m.color('#ff5a4a', { emissive: 1, jitter: 0 });
  const base = [m.color('#7d838f', { jitter: 0.06 }), m.color('#5c616d', { jitter: 0.06 })];
  const R = 22, c = [30, 40, 30], rot = [-40, -30, 0];
  // Paraboloid shell (local axis +z = facing direction), 2.4 voxels thick, tested analytically.
  shapeRot(m, c, R + 3, rot, (x, y, z) => {
    const r2 = x * x + y * y;
    if (r2 > R * R) return false;
    const zs = -6 + r2 / (R * R) * 9;
    return z >= zs && z <= zs + 2.4;
  }, (x, y, z) => white[h3(x >> 2, y >> 2, z >> 2, 3) < 0.3 ? 1 : 0]);
  // Rim highlight.
  shapeRot(m, c, R + 3, rot, (x, y, z) => {
    const r = Math.hypot(x, y);
    return r > R - 1.2 && r <= R + 0.3 && z >= 2.2 && z <= 4.2;
  }, white[2]);
  // Feed arm + horn at the focus.
  const P = (lx, ly, lz) => xformPt([lx, ly, lz], [0, 0, 0], c, ...rot);
  const a0 = P(0, -R + 2, 3), a1 = P(-R + 3, 6, 3), f = P(0, 0, 18);
  m.line(...a0, ...f, metal[0], 0.7);
  m.line(...a1, ...f, metal[0], 0.7);
  m.sphere(...f, 2.6, metal[1]);
  m.set(Math.floor(f[0]), Math.floor(f[1]) + 3, Math.floor(f[2]), ledC);
  const back = P(0, 0, -7);
  m.sphere(...back, 4, metal[0]);
  rustify(m, white, rust, 5, 0.25);
  // Mount: base box + pole into the back of the dish.
  m.box(20, 0, 20, 40, 5, 38, base[1]);
  m.box(21, 6, 21, 39, 6, 37, base[0]);
  m.line(30, 6, 29, back[0], back[1], back[2], metal[0], 2.3);
  rustify(m, base, rust, 8, 0.45);
  junkMound(m, 30, 29, 22, 17, 4, 6);
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
  const m = new VoxelModel(64, 70, 54);
  const pcb = [m.color('#2f8a4e', { jitter: 0.05 }), m.color('#236e3e', { jitter: 0.05 }), m.color('#4cbd70', { jitter: 0.04 })];
  const trace = m.color('#e8c050', { jitter: 0.03, spec: 1.2 });
  const chipC = m.color('#25232c', { jitter: 0.04 });
  const chipT = m.color('#3a3844', { jitter: 0.03 });
  const pin = m.color('#c9ccd4', { jitter: 0.03, spec: 1 });
  const capC = [m.color('#3a6ad8', { jitter: 0.03 }), m.color('#d8b080', { jitter: 0.03 })];
  const ledSets = [['#ff4a6b', '#4affc8', '#ffd84a'], ['#59c8ff', '#b46bff', '#4affc8'], ['#9dff4a', '#ffd84a', '#ff8a4a']];
  const leds = ledSets[variant % ledSets.length].map((c) => m.color(c, { emissive: 1, jitter: 0 }));
  const cx = 32, cz = 27;
  // Socketed chip as the holdfast.
  m.box(cx - 13, 0, cz - 10, cx + 12, 4, cz + 9, chipC);
  m.box(cx - 13, 5, cz - 10, cx + 12, 5, cz + 9, chipT);
  for (let x = cx - 12; x <= cx + 11; x += 2) { m.box(x, 0, cz - 11, x, 2, cz - 11, pin); m.box(x, 0, cz + 10, x, 2, cz + 10, pin); }
  // Trunk of stacked boards.
  m.box(cx - 3, 6, cz - 3, cx + 2, 46, cz + 2, (x, y) => (y % 6 === 0 ? trace : pcb[1]));
  // Plates (table-coral tiers), each a rounded square board with an LED-studded rim.
  const tiers = [[16, 15, 1.5, 0], [27, 12.5, -2, 0.6], [37, 10, 1, 1.3], [46, 7, -1, 2]];
  for (const [y, r, off, ang] of tiers) {
    const ox = cx + off * 2, oz = cz + off;
    shape(m, ox - r - 1, y, oz - r - 1, ox + r + 1, y + 1, oz + r + 1, (x, yy, z) => {
      const dx = x - ox, dz = z - oz;
      const ux = dx * Math.cos(ang) - dz * Math.sin(ang), uz = dx * Math.sin(ang) + dz * Math.cos(ang);
      return Math.abs(ux) ** 3 + Math.abs(uz) ** 3 <= r ** 3;
    }, (x, yy, z) => (yy === y + 1 ? pcb[0] : pcb[1]));
    m.box(ox - 1, y - 6, oz - 1, ox, y, oz, pcb[1]);
  }
  // Top-side detail: gold traces, chips, capacitors; rim LEDs.
  const tops = candidates(m, [pcb[0]], 'top');
  for (const i of tops) {
    const [x, y, z] = unpackIdx(m, i);
    const edge = !m.get(x + 1, y, z) || !m.get(x - 1, y, z) || !m.get(x, y, z + 1) || !m.get(x, y, z - 1);
    if (edge) {
      m.set(x, y, z, pcb[2]);
      if ((x + z) % 3 === 0) { const l = leds[(h3(z, x, y, 2) * 3) | 0]; m.set(x, y + 1, z, l); m.set(x, y + 2, z, l); }
    }
    else if ((x + z) % 5 === 0 || (x - z + 100) % 7 === 0) m.set(x, y, z, trace);
  }
  scatter(m, rng, 9, [pcb[0], trace], 'top', (x, y, z, nx, nz, i) => {
    if (i % 3 === 0) { m.box(x - 1, y + 1, z - 1, x + 1, y + 1, z + 1, chipC); m.set(x, y + 2, z, chipT); }
    else m.box(x, y + 1, z, x, y + 2, z, capC[i % 2]);
  });
  junkMound(m, cx, cz, 18, 15, 2, 5);
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
  const R = 16, r = 7, cx = 22, cy = 7, zc = 20;
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
  junkMound(m, 20, 21, 22, 15, 5, 4);
  moss(m, rng, 8, MOSS, 0.35, 0.2);
  barnacles(m, rng, 6, pipe);
  return { m, yaw: 30, light: '#9dff4a' };
});

// ===================== MIDNIGHT ABYSS =====================

const ABYSS_STONE = ['#4a4880', '#3a386a', '#5c5a98'];
const ABYSS_SILT = ['#3c3a5e', '#302e4e', '#4c4a72'];
const BONE = ['#d8d0c0', '#bfb4a2', '#ece6d8'];
const RUNES = [
  '####|#...|###.|#...|#...', '#..#|#.##|##.#|#..#|#..#', '.##.|#..#|.##.|..#.|.##.', '#...|##..|#.#.|#..#|####',
  '####|...#|.##.|#...|####', '.#..|###.|.#..|.#.#|.###', '#..#|.##.|.##.|#..#|#..#', '###.|..#.|.###|..#.|###.',
  '#.##|#..#|####|#...|##.#', '..#.|.###|#.#.|..#.|.#.#',
].map((r) => r.split('|'));

// Glyph texture lookup on a 2D lattice (cells 5 wide x 6 tall incl. 1-voxel gutters).
function rune(u, v, seed) {
  const cu = Math.floor(u / 5), cv = Math.floor(v / 6);
  const lu = ((u % 5) + 5) % 5, lv = ((v % 6) + 6) % 6;
  if (lu > 3 || lv > 4) return false;
  const g = RUNES[Math.floor(h3(cu, cv, 0, seed) * RUNES.length)];
  return g[4 - lv][lu] === '#';
}

function abyssStone(m, cols = ABYSS_STONE) {
  return cols.map((c, i) => m.color(c, { jitter: 0.14, smooth: 0.5, light: i === 2 ? 0.1 : 0 }));
}

// Bioluminescent speckles (small emissive dots) on exposed surfaces.
function biolum(m, rng, count, on, color = '#5ff4ff') {
  const g = m.color(color, { emissive: 1, jitter: 0 });
  scatter(m, rng, count, on, 'any', (x, y, z, nx, nz) => {
    m.set(x, y, z, g);
    if (rng.chance(0.3)) m.set(x + (nz ? 1 : 0), y, z + (nx ? 1 : 0), g);
  });
  return g;
}

// Chip damage: carve small random bites out of exposed edges.
function chip(m, rng, count, on, size = 1.6) {
  const cand = candidates(m, on, 'any');
  for (let i = 0; i < count && cand.length; i++) {
    const [x, y, z] = unpackIdx(m, cand[Math.floor(rng.next() * cand.length)]);
    m.sub(() => m.sphere(x + 0.5, y + 0.5, z + 0.5, size * rng.float(0.7, 1.3)));
  }
}

// Classical column with flutes, base, capital; glyph band; returns palette.
function column(m, rng, cx, cz, y0, height, r, st, glow, opts = {}) {
  const dark = opts.dark;
  m.box(cx - r - 3, y0, cz - r - 3, cx + r + 2, y0 + 2, cz + r + 2, st[1]);
  m.box(cx - r - 2, y0 + 3, cz - r - 2, cx + r + 1, y0 + 4, cz + r + 1, st[0]);
  const top = y0 + 5 + height;
  for (let y = y0 + 5; y < top; y++) {
    const rr = r * (1 - (y - y0) / (height * 9));
    m.cylinder(cx, cz, y, y, rr, (x, yy, z) => {
      const a = Math.atan2(z + 0.5 - cz, x + 0.5 - cx);
      const fl = ((a / (Math.PI * 2)) * 14 % 1 + 1) % 1;
      return fl < 0.22 ? null : st[0];
    });
    m.cylinder(cx, cz, y, y, rr - 0.9, st[1]);
  }
  if (!opts.broken) {
    m.cylinder(cx, cz, top, top + 1, r + 1.2, st[2]);
    m.box(cx - r - 3, top + 2, cz - r - 3, cx + r + 2, top + 4, cz + r + 2, st[0]);
    m.box(cx - r - 2, top + 5, cz - r - 2, cx + r + 1, top + 5, cz + r + 1, st[2]);
  }
  // Glowing glyph band around the shaft.
  if (glow) {
    const by = y0 + 5 + Math.round(height * (opts.bandAt ?? 0.55));
    m.paint(() => m.cylinder(cx, cz, by, by + 6, r + 1, (x, y, z) => {
      if (!m.exposed(x, y, z)) return null;
      const a = Math.atan2(z + 0.5 - cz, x + 0.5 - cx);
      const u = Math.round((a + Math.PI) * r);
      return rune(u, y - by, 3) ? glow : dark;
    }));
  }
  return top;
}

def('pillar_ruin', { name: 'Ancient Pillar', biome: 'abyss', tags: ['ruin', 'glow'], decor: { price: 260, size: 1 } }, ({ rng }) => {
  const m = new VoxelModel(40, 96, 40);
  const st = abyssStone(m);
  const dark = m.color('#262447', { jitter: 0.05 });
  const glow = m.color('#5ff4ff', { emissive: 1, jitter: 0 });
  column(m, rng, 20, 20, 0, 74, 7.5, st, glow, { dark, bandAt: 0.42 });
  chip(m, rng, 26, st, 1.5);
  // Cracks.
  for (let k = 0; k < 3; k++) {
    const y = rng.int(12, 70), a = rng.float(-0.6, 1.2);
    m.paint(() => m.line(20 + Math.cos(a) * 7.5, y, 20 + Math.sin(a) * 7.5, 20 + Math.cos(a + 0.4) * 7.5, y - rng.int(6, 12), 20 + Math.sin(a + 0.4) * 7.5, dark, 0.6));
  }
  moss(m, rng, 4, ['#4a7aa8', '#3a5a8a', '#2a3f6a'], 0.45, 0.2);
  biolum(m, rng, 14, st);
  sandMound(m, 20, 20, 16, 16, 2, 3, ABYSS_SILT);
  return { m, yaw: 30, light: '#5ff4ff' };
});

def('pillar_broken', { name: 'Broken Pillar', biome: 'abyss', tags: ['ruin'], decor: { price: 160, size: 2 } }, ({ rng }) => {
  const m = new VoxelModel(80, 54, 50);
  const st = abyssStone(m);
  const dark = m.color('#262447', { jitter: 0.05 });
  const glow = m.color('#b46bff', { emissive: 1, jitter: 0 });
  column(m, rng, 22, 22, 0, 40, 7.5, st, glow, { dark, broken: true, bandAt: 0.3 });
  // Jagged break.
  m.sub(() => shape(m, 10, 20, 10, 34, 50, 34, (x, y, z) => y > 34 + (x - 22) * 0.45 + noise3(x * 0.4, 0, z * 0.4, 2) * 7, 0));
  // Fallen drum lying on its side.
  const drum = part(m, 20, 26, 20);
  column(drum, rng, 10, 10, 0, 18, 7, st, null, { broken: true });
  drum.sub(() => drum.box(0, 0, 0, 19, 4, 19));
  stampRot(m, drum, [10, 5, 10], [52, 8, 30], 0, 25, 90);
  // Rubble.
  for (let i = 0; i < 6; i++) facetRock(m, rng, 30 + rng.float(-20, 40), 1, 38 + rng.float(-6, 8), rng.float(2, 4), rng.float(2, 3.5), rng.float(2, 4), st[1], 8);
  chip(m, rng, 20, st, 1.5);
  moss(m, rng, 4, ['#4a7aa8', '#3a5a8a', '#2a3f6a'], 0.4, 0.2);
  biolum(m, rng, 10, st, '#b46bff');
  sandMound(m, 38, 26, 36, 20, 2, 5, ABYSS_SILT);
  return { m, yaw: 30, light: '#b46bff' };
});

def('arch_ruin', { name: 'Sunken Archway', biome: 'abyss', tags: ['ruin', 'swimthrough', 'glow'], decor: { price: 700, size: 3 } }, ({ rng }) => {
  const m = new VoxelModel(92, 92, 34);
  const st = abyssStone(m);
  const seam = m.color('#2a2850', { jitter: 0.04 });
  const glow = m.color('#5ff4ff', { emissive: 1, jitter: 0 });
  const glowV = m.color('#b46bff', { emissive: 1, jitter: 0 });
  const zc = 17;
  // Block-built piers with seams.
  const blockCol = (x, y, z) => ((y % 8 === 0) || ((x + (Math.floor(y / 8) % 2) * 5) % 10 === 0) ? seam : st[(h3(x >> 3, y >> 3, z >> 3, 2) * 3) | 0]);
  m.box(6, 0, zc - 9, 23, 58, zc + 8, blockCol);
  m.box(68, 0, zc - 9, 85, 58, zc + 8, blockCol);
  m.box(4, 0, zc - 11, 25, 3, zc + 10, st[1]);
  m.box(66, 0, zc - 11, 87, 3, zc + 10, st[1]);
  // Arch of voussoirs.
  const ax = 45.5, ay = 58, R0 = 22.5, R1 = 34;
  shape(m, 6, ay - 2, zc - 9, 85, ay + R1 + 2, zc + 8, (x, y) => {
    const d = Math.hypot(x - ax, y - ay);
    return y >= ay && d >= R0 && d <= R1;
  }, (x, y, z) => {
    const a = Math.atan2(y - ay, x - ax);
    const d = Math.hypot(x - ax, y - ay);
    const seg = (a / Math.PI) * 11;
    if (Math.abs(seg - Math.round(seg)) < 0.08 || Math.abs(d - (R0 + R1) / 2) < 0.4 && false) return seam;
    if (Math.abs(seg - 5.5) < 0.5 && d > R0 + 2 && d < R1 - 2 && z >= zc + 7) {
      return rune(Math.round(x - ax + 3), Math.round(y - ay - R0), 5) ? glowV : st[2];
    }
    return st[(Math.floor(seg) + (d > 28 ? 1 : 0)) % 3];
  });
  // Lintel ledge across the piers.
  m.box(4, 56, zc - 10, 25, 58, zc + 9, st[2]);
  m.box(66, 56, zc - 10, 87, 58, zc + 9, st[2]);
  // Glyph column panels on the pier fronts.
  for (const px of [10, 72]) for (let y = 14; y < 48; y++) for (let x = px; x < px + 10; x++) if (rune(x - px, y - 14, px)) m.set(x, y, zc + 8, glow);
  // Damage: a missing chunk, cracks, chips.
  m.sub(() => blob(m, 84, 40, zc + 6, 6, 9, 6, 0.3, 0.3, 3, 0));
  chip(m, rng, 40, st, 1.6);
  moss(m, rng, 6, ['#4a7aa8', '#3a5a8a', '#2a3f6a'], 0.45, 0.18);
  // Hanging glow strands from the arch.
  const strand = m.color('#7fe8ff', { emissive: 0.7, jitter: 0 });
  for (let k = 0; k < 7; k++) {
    const x = Math.round(ax + rng.float(-18, 18));
    let y = 0;
    for (let yy = 40; yy < 92; yy++) if (m.get(x, yy, zc)) { y = yy; break; }
    if (!y) continue;
    const len = rng.int(6, 16);
    const sz = zc + rng.int(-6, 6);
    for (let j = 1; j <= len; j++) m.set(x + (j > len * 0.6 ? 1 : 0), y - j, sz, j === len ? glow : strand);
  }
  for (let i = 0; i < 5; i++) facetRock(m, rng, rng.float(20, 75), 1, zc + 10 + rng.float(0, 5), rng.float(2.5, 5), rng.float(2, 4), rng.float(2.5, 4.5), st[1], 8);
  biolum(m, rng, 18, st);
  return { m, yaw: 26, vs: 1.7, light: '#5ff4ff' };
});

def('statue_head', { name: 'Elder Head', biome: 'abyss', tags: ['ruin', 'glow', 'hero'] }, ({ rng }) => {
  const m = new VoxelModel(96, 100, 80);
  const st = [m.color('#56548e', { jitter: 0.12, smooth: 0.65 }), m.color('#454378', { jitter: 0.12, smooth: 0.65 }), m.color('#6a68a6', { jitter: 0.1, smooth: 0.65 })];
  const deep = m.color('#2a2850', { jitter: 0.05, smooth: 0.4 });
  const glow = m.color('#5ff4ff', { emissive: 1, jitter: 0 });
  const glowV = m.color('#c07bff', { emissive: 1, jitter: 0 });
  const eyeC = m.color('#aef9ff', { emissive: 1, jitter: 0 });
  const h = part(m, 70, 92, 64);
  const cx = 35, cz = 30;
  // Skull/face volume.
  h.ellipsoid(cx, 46, cz, 25, 34, 24, st[0]);
  h.box(cx - 22, 10, cz - 14, cx + 21, 46, cz + 20, st[0]);
  h.sub(() => h.box(0, 0, cz + 22, 69, 91, 63));
  // Flatten the face plane a little and carve features.
  h.sub(() => shape(h, 0, 0, cz + 18, 69, 91, 63, (x, y, z) => z > cz + 20 - Math.abs(x - cx) * 0.18, 0));
  // Brow ridge, nose, lips, chin.
  h.box(cx - 19, 52, cz + 15, cx + 18, 56, cz + 21, st[2]);
  shape(h, cx - 6, 28, cz + 14, cx + 5, 54, cz + 28, (x, y, z) => {
    const t = (54 - y) / 26;
    return Math.abs(x - cx + 0.5) <= 2.2 + t * 4 && z <= cz + 19 + t * 7;
  }, st[0]);
  h.box(cx - 7, 28, cz + 22, cx + 6, 30, cz + 26, st[1]);
  h.box(cx - 11, 18, cz + 17, cx + 10, 22, cz + 22, st[2]);
  h.box(cx - 10, 21, cz + 17, cx + 9, 21, cz + 22, deep);
  h.box(cx - 8, 9, cz + 14, cx + 7, 14, cz + 19, st[0]);
  // Eye sockets with glowing slits.
  for (const s of [-1, 1]) {
    const ex = cx + s * 10 - (s > 0 ? 1 : 0);
    h.sub(() => h.ellipsoid(ex + 0.5, 46, cz + 21, 6.5, 4, 4));
    h.box(ex - 5, 45, cz + 17, ex + 5, 46, cz + 18, eyeC);
    h.box(ex - 6, 43, cz + 17, ex + 6, 44, cz + 17, deep);
  }
  // Ears.
  for (const s of [-1, 1]) h.ellipsoid(cx + s * 25, 42, cz + 2, 3.5, 11, 6, st[1]);
  // Crown / headdress band with runes.
  h.cylinder(cx, cz, 66, 76, 23, st[1]);
  h.cone(cx, cz, 77, 86, 22, 12, st[0]);
  h.paint(() => h.cylinder(cx, cz, 67, 75, 24, (x, y, z) => {
    if (!h.exposed(x, y, z)) return null;
    const a = Math.atan2(z + 0.5 - cz, x + 0.5 - cx);
    return rune(Math.round((a + Math.PI) * 23), y - 67, 7) ? glow : null;
  }));
  // Cheek glyph lines.
  for (const s of [-1, 1]) for (let y = 24; y < 40; y++) {
    const x = cx + s * (14 - (40 - y) * 0.15);
    if (y % 6 !== 0) h.paint(() => h.box(x, y, cz + 15, x + s, y, cz + 22, (xx, yy, zz) => (h.exposed(xx, yy, zz) ? glowV : null)));
  }
  // Cracks and chips.
  h.paint(() => h.line(cx + 8, 80, cz + 10, cx + 14, 58, cz + 20, deep, 0.7));
  h.paint(() => h.line(cx + 14, 58, cz + 20, cx + 10, 48, cz + 22, deep, 0.6));
  chip(h, rng, 40, st, 1.8);
  // Tilt and sink into the silt.
  stampRot(m, h, [cx, 0, cz], [48, -8, 38], -6, 14, 9);
  sandMound(m, 48, 40, 42, 32, 9, 4, ABYSS_SILT);
  moss(m, rng, 9, ['#4a7aa8', '#3a5a8a', '#2a3f6a'], 0.4, 0.15, st);
  // Tube worms and anemones colonising the crown.
  const worm = m.color('#e9e2d6', { smooth: 0.4 }), plume = m.color('#ff4a6b', { emissive: 0.4 });
  for (let i = 0; i < 6; i++) {
    const x = 34 + rng.int(-10, 14), z = 34 + rng.int(-8, 8);
    let y = 99;
    while (y > 0 && !m.get(x, y, z)) y--;
    if (y < 40) continue;
    const hh = rng.int(4, 8);
    m.box(x, y + 1, z, x, y + hh, z, worm);
    m.set(x, y + hh + 1, z, plume); m.set(x + 1, y + hh + 1, z, plume); m.set(x, y + hh + 2, z, plume);
  }
  biolum(m, rng, 20, st);
  return { m, yaw: 24, vs: 1.6, light: '#5ff4ff' };
});

const GEMS = [
  ['Amethyst', '#b46bff', '#7a3ad1', '#f0d4ff'],
  ['Emerald', '#3fe08f', '#1d9a63', '#d0ffe2'],
  ['Topaz', '#ffbe3d', '#d9781c', '#fff2b8'],
  ['Sapphire', '#4a8dff', '#2a4fd1', '#cfe2ff'],
  ['Ruby', '#ff4a6b', '#c21f4a', '#ffd0d8'],
];

def('crystal_cluster', { name: 'Crystal Cluster', biome: 'abyss', tags: ['crystal', 'glow'], decor: { price: 400, size: 1 } }, ({ rng, variant }) => {
  const g = GEMS[variant % GEMS.length];
  const m = new VoxelModel(54, 72, 46);
  const st = abyssStone(m);
  const cA = m.color(g[1], { emissive: 0.4, jitter: 0.06, smooth: 0.3 });
  const cB = m.color(g[3], { emissive: 0.75, jitter: 0.04, smooth: 0.3 });
  const cC = m.color(g[2], { emissive: 0.3, jitter: 0.06, smooth: 0.3 });
  const seed = rng.int(0, 999);
  facetRock(m, rng, 27, 3, 23, 19, 8, 15, st[0], 14);
  facetRock(m, rng, 40, 2, 28, 8, 5, 7, st[1], 9);
  stoneTex(m, st, seed);
  const shafts = [
    [0.05, 1, 0.05, 50, 6.2], [-0.5, 1, 0.15, 36, 4.6], [0.55, 1, -0.1, 38, 4.8], [0.25, 1, 0.6, 26, 3.8], [-0.4, 1, -0.5, 28, 3.8],
    [-0.95, 0.65, 0.45, 16, 2.8], [0.95, 0.6, 0.4, 15, 2.6], [0.1, 0.8, 0.9, 12, 2.4],
  ];
  shafts.forEach(([dx, dy, dz, len, r], i) => {
    const p0 = [27 + dx * 6 + rng.float(-1, 1), 4, 23 + dz * 5 + rng.float(-1, 1)];
    shaft(m, p0, [dx, dy, dz], len * rng.float(0.9, 1.06), r, r * 1.7, i % 3 === 2 ? cC : cA, 6, rng.float(0, 1));
  });
  // Facets toward the light glow brighter; a bright core streak on the big one.
  m.recolor((x, y, z, p) => ((p === cA || p === cC) && !m.get(x - 1, y, z) && !m.get(x - 1, y, z + 1) ? cB : null));
  shaft(m, [27.5, 6, 23.5], [0.05, 1, 0.05], 44, 1.2, 4, (x, y, z, p) => (p ? cB : null), 6);
  // Small shards scattered around the base.
  for (let i = 0; i < 5; i++) {
    const a = rng.float(0, Math.PI * 2);
    shaft(m, [27 + Math.cos(a) * 15, 1, 23 + Math.sin(a) * 12], [Math.cos(a) * 0.6, 1, Math.sin(a) * 0.6], rng.float(5, 9), 1.5, 2.5, cA, 6);
  }
  sandMound(m, 27, 24, 22, 18, 2, seed, ABYSS_SILT);
  return { m, yaw: 32, light: g[1] };
});

def('glow_mushroom', { name: 'Glow Shrooms', biome: 'abyss', tags: ['plant', 'glow'], decor: { price: 180, size: 1 } }, ({ rng, variant }) => {
  const schemes = [['#4ae0ff', '#c8faff', '#2a7fb8'], ['#c07bff', '#f2dcff', '#6a3ab0'], ['#7dff9a', '#e2ffe8', '#2f9a5a']];
  const sc = schemes[variant % schemes.length];
  const m = new VoxelModel(58, 60, 50);
  const stem = [m.color('#d8d4e8', { smooth: 0.6, jitter: 0.06 }), m.color('#b8b2d0', { smooth: 0.6, jitter: 0.06 })];
  const cap = m.color(sc[2], { smooth: 0.7, jitter: 0.06, emissive: 0.25 });
  const capL = m.color(sc[0], { smooth: 0.7, jitter: 0.05, emissive: 0.6 });
  const spot = m.color(sc[1], { emissive: 1, jitter: 0 });
  const gill = m.color('#3a2f5a', { jitter: 0.04, emissive: 0.15 });
  const st = abyssStone(m);
  facetRock(m, rng, 29, 2, 25, 16, 6, 14, st[0], 12);
  stoneTex(m, st, 3);
  const shrooms = [[29, 25, 34, 9.5, 0], [17, 22, 22, 7, -0.25], [40, 28, 24, 7.5, 0.3], [24, 34, 14, 5, -0.15], [38, 15, 15, 5.5, 0.2], [12, 32, 9, 3.5, -0.4], [46, 35, 9, 3.6, 0.45]];
  for (const [x, z, hgt, r, lean] of shrooms) {
    const tx = x + lean * hgt * 0.5, ty = hgt;
    m.tube([[x, 3, z, r * 0.32 + 0.6], [x + lean * hgt * 0.2, hgt * 0.5, z, r * 0.26 + 0.5], [tx, ty, z, r * 0.24 + 0.5]], stem[0]);
    // Cap: flattened dome with an underside of gills.
    shape(m, tx - r - 1, ty - 2, z - r - 1, tx + r + 1, ty + r, z + r + 1, (xx, yy, zz) => {
      const d = ((xx - tx) / r) ** 2 + ((yy - ty + 0.5) / (r * 0.62)) ** 2 + ((zz - z) / r) ** 2;
      return d <= 1 && yy >= ty - 0.5 - r * 0.12 * (1 - Math.hypot(xx - tx, zz - z) / r);
    }, (xx, yy, zz) => (yy < ty + 0.6 ? gill : yy > ty + r * 0.35 ? capL : cap));
  }
  // Glowing spots on the caps.
  m.recolor((x, y, z, p) => ((p === cap || p === capL) && !m.get(x, y + 1, z) && h3(x >> 1, y, z >> 1, 3) < 0.16 ? spot : null));
  // Tiny sprouts on the rock.
  scatter(m, rng, 8, st, 'top', (x, y, z) => { m.set(x, y + 1, z, stem[1]); m.set(x, y + 2, z, capL); });
  sandMound(m, 29, 25, 22, 19, 2, 6, ABYSS_SILT);
  return { m, yaw: 30, light: sc[0] };
});

def('tube_worms', { name: 'Tube Worms', biome: 'abyss', tags: ['plant', 'vent'], decor: { price: 150, size: 1 } }, ({ rng }) => {
  const m = new VoxelModel(54, 66, 48);
  const tube = [m.color('#ece6da', { smooth: 0.55, jitter: 0.06 }), m.color('#cfc6b6', { smooth: 0.55, jitter: 0.06 }), m.color('#a89e8e', { smooth: 0.55, jitter: 0.05 })];
  const plume = [m.color('#ff3d5a', { smooth: 0.4, jitter: 0.08, emissive: 0.35 }), m.color('#ff8a9a', { smooth: 0.4, jitter: 0.06, emissive: 0.5 }), m.color('#b8203e', { smooth: 0.4, jitter: 0.06, emissive: 0.2 })];
  const st = [m.color('#2e2b40', { smooth: 0.5, jitter: 0.1 }), m.color('#3c3852', { smooth: 0.5, jitter: 0.1 }), m.color('#5a4a52', { smooth: 0.5, jitter: 0.1 })];
  facetRock(m, rng, 27, 3, 24, 17, 8, 15, st[0], 12);
  stoneTex(m, st, 2);
  const N = 16;
  for (let i = 0; i < N; i++) {
    const a = i * 2.4 + rng.float(-0.3, 0.3), rr = Math.sqrt(i / N) * 11;
    const x = 27 + Math.cos(a) * rr, z = 24 + Math.sin(a) * rr * 0.8;
    const hgt = 22 + (1 - rr / 11) * 26 + rng.float(-5, 5);
    const lean = [Math.cos(a) * rr * 0.04, Math.sin(a) * rr * 0.04];
    const r = rng.float(1.3, 2);
    const top = [x + lean[0] * hgt, hgt, z + lean[1] * hgt];
    m.tube([[x, 3, z, r + 0.3], [x + lean[0] * hgt * 0.5, hgt * 0.5, z + lean[1] * hgt * 0.5, r], top.concat(r)], (xx, yy) => (yy % 5 === 0 ? tube[2] : yy % 5 === 1 ? tube[1] : tube[0]), 3);
    // Feathery plume.
    for (let k = 0; k < 10; k++) {
      const pa = k / 10 * Math.PI * 2, len = rng.float(2.5, 4.5);
      m.line(top[0], top[1] + 1, top[2], top[0] + Math.cos(pa) * len * 0.6, top[1] + len, top[2] + Math.sin(pa) * len * 0.6, k % 3 ? plume[0] : plume[2], 0.6);
      m.set(top[0] + Math.cos(pa) * len * 0.6, top[1] + len, top[2] + Math.sin(pa) * len * 0.6, plume[1]);
    }
  }
  // Little white vent crabs.
  const crab = m.color('#f2ece0', { smooth: 0.3 });
  scatter(m, rng, 3, st, 'top', (x, y, z) => { m.box(x, y + 1, z, x + 2, y + 1, z + 1, crab); m.set(x - 1, y + 1, z, crab); m.set(x + 3, y + 1, z, crab); });
  sandMound(m, 27, 25, 22, 19, 2, 9, ABYSS_SILT);
  return { m, yaw: 30, light: '#ff4a6b' };
});

def('ribcage', { name: 'Leviathan Ribs', biome: 'abyss', tags: ['bone', 'hero', 'swimthrough'], decor: { price: 900, size: 3 } }, ({ rng }) => {
  const m = new VoxelModel(122, 82, 96);
  const rc = part(m, 124, 70, 64);
  const bone = BONE.map((c, i) => m.color(c, { smooth: 0.55, jitter: 0.08, light: i === 2 ? 0.1 : 0 }));
  const boneD = m.color('#8f8478', { smooth: 0.5, jitter: 0.06 });
  const crack = m.color('#5a5060', { jitter: 0.03 });
  const zc = 30;
  // Spine of vertebrae along x, dipping into the silt at both ends.
  const spineY = (x) => 6 + Math.sin(x / 124 * Math.PI) * 9;
  for (let x = 4; x < 120; x += 7) {
    const y = spineY(x);
    const s = 1 - Math.abs(x - 60) / 140;
    rc.ellipsoid(x + 3, y, zc, 3.4 * s, 4.6 * s, 4.6 * s, bone[0]);
    rc.box(x + 2, y + 3, zc - 1, x + 3, y + 9 * s, zc, bone[1]);
    rc.line(x + 3, y, zc - 3, x + 3, y - 2, zc - 9 * s, bone[1], 1.2);
    rc.line(x + 3, y, zc + 3, x + 3, y - 2, zc + 9 * s, bone[1], 1.2);
    rc.ellipsoid(x + 6.5, y, zc, 1.2, 3 * s, 3 * s, boneD);
  }
  // Ribs arching up and over to the near side; a couple snapped.
  for (let i = 0; i < 8; i++) {
    const x = 12 + i * 13.5 + rng.float(-1, 1);
    const y0 = spineY(x) + 2;
    const H = 56 - Math.abs(i - 3.5) * 6 + rng.float(-3, 3);
    const W = 26 - Math.abs(i - 3.5) * 1.5;
    const broken = i === 2 || i === 6;
    const pts = [];
    for (let k = 0; k <= 12; k++) {
      const t = k / 12;
      if (broken && t > 0.58) break;
      const ang = t * Math.PI * 0.92;
      pts.push([x + t * 5, y0 + Math.sin(ang) * H * 0.86, zc + 2 + (1 - Math.cos(ang)) * W * 0.62, 2.7 - t * 1.5]);
    }
    rc.tube(pts, (xx, yy, zz) => (h3(xx, yy, zz, 1) < 0.07 ? bone[2] : bone[0]), 3);
    const back = pts.slice(0, 7).map(([px, py, pz, pr]) => [px, py, zc - (pz - zc) * 0.85 - 2, pr]);
    rc.tube(back, bone[1], 3);
    if (broken) rc.tube([[x + 10, 2, zc + 32, 1.6], [x + 16, 2, zc + 28, 1.4], [x + 22, 2, zc + 30, 1.2]], bone[1]);
  }
  rc.recolor((x, y, z, p) => (bone.includes(p) && rc.exposed(x, y, z) && Math.abs(noise3(x * 0.3, y * 0.3, z * 0.3, 2) - 0.5) < 0.02 ? crack : null));
  stampRot(m, rc, [62, 0, zc], [60, 0, 46], 0, -28, 0);
  biolum(m, rng, 14, bone, '#5ff4ff');
  biolum(m, rng, 6, bone, '#c07bff');
  sandMound(m, 60, 50, 46, 36, 6, 8, ABYSS_SILT);
  return { m, yaw: 30, vs: 1.6, light: '#5ff4ff' };
});

def('giant_skull', { name: 'Giant Skull', biome: 'abyss', tags: ['bone', 'glow'], decor: { price: 550, size: 2 } }, ({ rng }) => {
  const m = new VoxelModel(90, 60, 58);
  const bone = BONE.map((c, i) => m.color(c, { smooth: 0.6, jitter: 0.08, light: i === 2 ? 0.1 : 0 }));
  const deep = m.color('#1c1830', { jitter: 0.02, light: -0.5 });
  const crack = m.color('#5a5060', { jitter: 0.03 });
  const tooth = m.color('#f2ead8', { smooth: 0.4, jitter: 0.04 });
  const eye = m.color('#ffd84a', { emissive: 1, jitter: 0 });
  const sk = part(m, 86, 52, 48);
  const zc = 24;
  // Long fishy cranium: cranial dome + tapering snout.
  sk.ellipsoid(22, 26, zc, 20, 20, 19, bone[0]);
  shape(sk, 20, 6, 4, 84, 40, 44, (x, y, z) => {
    const t = (x - 20) / 64;
    const hw = 16 * (1 - t * 0.65), top = 34 - t * 16, bot = 12 + t * 2;
    return Math.abs(z - zc) <= hw && y <= top && y >= bot;
  }, bone[0]);
  sk.recolor((x, y, z, p) => (!sk.get(x, y + 1, z) ? bone[2] : null));
  // Big eye socket with two lurking eyes.
  sk.sub(() => sk.ellipsoid(30, 30, zc + 14, 9, 8, 9));
  sk.ellipsoid(30, 30, zc + 9, 8, 7, 3, deep);
  sk.set(28, 31, zc + 12, eye); sk.set(33, 31, zc + 12, eye);
  // Nostril, cheek window, brow ridge.
  sk.sub(() => sk.ellipsoid(72, 26, zc + 10, 4, 3, 4));
  sk.sub(() => sk.ellipsoid(50, 22, zc + 15, 8, 5, 5));
  sk.ellipsoid(50, 22, zc + 10, 7, 4, 2, deep);
  sk.box(18, 38, zc + 6, 44, 41, zc + 17, bone[1]);
  // Lower jaw dropped open, lying on the silt, with teeth.
  sk.box(30, 2, zc - 13, 82, 7, zc + 13, bone[1]);
  sk.sub(() => sk.box(32, 5, zc - 10, 84, 8, zc + 10));
  for (let x = 34; x < 82; x += 4) for (const s of [-1, 1]) {
    sk.line(x, 7, zc + s * 11, x + 1, 12, zc + s * 11, tooth, 0.7);
    sk.line(x + 2, 13, zc + s * 12, x + 2, 9, zc + s * 12, tooth, 0.6);
  }
  sk.recolor((x, y, z, p) => (p === bone[0] && sk.exposed(x, y, z) && Math.abs(noise3(x * 0.25, y * 0.25, z * 0.25, 4) - 0.5) < 0.02 ? crack : null));
  chip(sk, rng, 20, bone, 1.4);
  stampRot(m, sk, [43, 0, zc], [44, 2, 28], 0, -14, -6);
  sandMound(m, 44, 30, 36, 20, 5, 3, ABYSS_SILT);
  biolum(m, rng, 8, bone, '#5ff4ff');
  return { m, yaw: 28, light: '#ffd84a' };
});

def('vent_chimney', { name: 'Black Smoker', biome: 'abyss', tags: ['vent', 'glow'] }, ({ rng }) => {
  const m = new VoxelModel(56, 92, 50);
  const rock = [m.color('#2a2634', { smooth: 0.55, jitter: 0.12 }), m.color('#3a3442', { smooth: 0.55, jitter: 0.12 }), m.color('#4c4250', { smooth: 0.55, jitter: 0.1 })];
  const crust = [m.color('#c8963a', { smooth: 0.5, jitter: 0.1 }), m.color('#e2c25a', { smooth: 0.5, jitter: 0.08 }), m.color('#8a5a3a', { smooth: 0.5, jitter: 0.1 })];
  const lava = [m.color('#ff7a2a', { emissive: 1, jitter: 0.04 }), m.color('#ffd06a', { emissive: 1, jitter: 0.03 })];
  const seed = rng.int(0, 999);
  // Stacked lumpy segments narrowing upwards.
  let y = 0, r = 15, x = 28, z = 24;
  const segs = [];
  while (y < 76) {
    const h = rng.float(7, 11);
    blob(m, x, y + h * 0.5, z, r, h * 0.75, r * 0.92, 0.25, 0.2, seed + y, rock[0], 0);
    segs.push([x, y, z, r]);
    y += h * 0.85; r = Math.max(5, r * 0.86); x += rng.float(-1.2, 1.2); z += rng.float(-0.8, 0.8);
  }
  // Side spire.
  let sy = 0, sr = 7, sx = 12, sz = 30;
  while (sy < 34) { blob(m, sx, sy + 3, sz, sr, 4, sr, 0.25, 0.25, seed + 100 + sy, rock[1], 0); sy += 5; sr *= 0.86; sx -= 0.4; }
  // Mineral crusts and glowing fissures.
  m.recolor((x2, y2, z2, p) => {
    if (!m.exposed(x2, y2, z2)) return null;
    const n = fbm3(x2 * 0.14, y2 * 0.1, z2 * 0.14, 2, seed + 3);
    if (Math.abs(noise3(x2 * 0.16, y2 * 0.07, z2 * 0.16, seed + 9) - 0.5) < 0.018) return lava[0];
    return n > 0.7 ? crust[0] : n > 0.665 ? crust[2] : n < 0.34 ? rock[2] : null;
  });
  m.recolor((x2, y2, z2, p) => (p === crust[0] && !m.get(x2, y2 + 1, z2) ? crust[1] : null));
  // Glowing throat at the top.
  const [tx, ty, tz, tr] = segs[segs.length - 1];
  m.sub(() => m.cylinder(tx, tz, ty + 2, ty + 14, Math.max(2.2, tr * 0.45)));
  m.cylinder(tx, tz, ty + 2, ty + 3, Math.max(2.2, tr * 0.45), lava[1]);
  m.cylinder(tx, tz, ty + 4, ty + 4, Math.max(1.5, tr * 0.3), lava[0]);
  // Tube worms at the base.
  const worm = m.color('#ece6da', { smooth: 0.4 }), plume = m.color('#ff3d5a', { emissive: 0.4 });
  for (let i = 0; i < 9; i++) {
    const a = rng.float(-0.5, 2.6), rr = rng.float(14, 19);
    const wx = 28 + Math.cos(a) * rr, wz = 24 + Math.sin(a) * rr;
    const hh = rng.int(6, 14);
    m.line(wx, 0, wz, wx + rng.float(-1, 1), hh, wz, worm, 0.8);
    m.sphere(wx, hh + 1, wz, 1.3, plume);
  }
  sandMound(m, 28, 25, 24, 21, 3, 5, ABYSS_SILT);
  return { m, yaw: 30, light: '#ff9a3a' };
});

def('glyph_stone', { name: 'Glyph Stone', biome: 'abyss', tags: ['ruin', 'glow'], decor: { price: 320, size: 1 } }, ({ rng, variant }) => {
  const glows = ['#5ff4ff', '#c07bff', '#7dff9a'];
  const m = new VoxelModel(44, 70, 34);
  const st = abyssStone(m);
  const deep = m.color('#24223f', { jitter: 0.04 });
  const glow = m.color(glows[variant % glows.length], { emissive: 1, jitter: 0 });
  const slab = part(m, 30, 64, 14);
  // Monolith with a rounded top and bevelled edges.
  shape(slab, 0, 0, 0, 29, 63, 13, (x, y, z) => {
    const dx = Math.abs(x - 15), dz = Math.abs(z - 7);
    if (dx > 13 || dz > 5.5) return false;
    if (y > 48 && ((x - 15) / 13) ** 2 + ((y - 48) / 14) ** 2 > 1) return false;
    return dx + dz < 17.5;
  }, (x, y, z) => st[(h3(x >> 2, y >> 2, 0, 3) * 2) | 0]);
  // Carved border and rune grid on the face.
  for (let y = 6; y < 56; y++) for (let x = 4; x < 27; x++) {
    if (!slab.get(x, y, 12)) continue;
    const border = x === 4 || x === 26 || y === 6;
    if (border) slab.set(x, y, 12, deep);
    else if (x > 6 && x < 25 && y > 9 && y < 40 && Math.floor((y - 10) / 6) % 2 === 0 && rune(x - 7, y - 10, 11 + variant)) slab.set(x, y, 12, glow);
  }
  // Central eye sigil.
  slab.paint(() => slab.ellipsoid(15, 46, 12.5, 5, 2.6, 1.2, deep));
  slab.paint(() => slab.ellipsoid(15, 46, 12.5, 2, 1.8, 1.2, glow));
  chip(slab, rng, 18, st, 1.4);
  stampRot(m, slab, [15, 0, 7], [22, 0, 17], -4, 16, 5);
  for (let i = 0; i < 4; i++) facetRock(m, rng, 22 + rng.float(-16, 16), 1, 26 + rng.float(-2, 6), rng.float(2, 4), rng.float(2, 3), rng.float(2, 4), st[1], 8);
  moss(m, rng, 4, ['#4a7aa8', '#3a5a8a', '#2a3f6a'], 0.45, 0.2, st);
  sandMound(m, 22, 18, 18, 14, 3, 7, ABYSS_SILT);
  return { m, yaw: 22, light: glows[variant % glows.length] };
});

// ===================== AQUARIUM DECOR =====================

const CASTLE_STONE = ['#b9b2c9', '#a39bb6', '#cdc7da'];

// Masonry texture: staggered blocks with dark mortar lines.
function masonry(m, cols, mortar, bw = 6, bh = 4) {
  return (x, y, z) => {
    const row = Math.floor(y / bh);
    if (y % bh === 0) return mortar;
    const off = row % 2 ? bw >> 1 : 0;
    if ((x + z + off) % bw === 0) return mortar;
    return cols[(h3(Math.floor((x + z + off) / bw), row, 0, 3) * cols.length) | 0];
  };
}

def('castle', { name: 'Fairy Castle', biome: 'aquarium', tags: ['build', 'glow'], decor: { price: 600, size: 3 }, decorOnly: true }, ({ rng }) => {
  const m = new VoxelModel(84, 104, 60);
  const st = CASTLE_STONE.map((c) => m.color(c, { jitter: 0.08 }));
  const mortar = m.color('#7c7492', { jitter: 0.04 });
  const roof = [m.color('#4a78d8', { jitter: 0.06, smooth: 0.3 }), m.color('#6a98f0', { jitter: 0.05, smooth: 0.3 })];
  const roofR = [m.color('#d8504a', { jitter: 0.06, smooth: 0.3 }), m.color('#f07a6a', { jitter: 0.05, smooth: 0.3 })];
  const gold = m.color('#f2c84a', { jitter: 0.04, spec: 1.2 });
  const dark = m.color('#2a2238', { jitter: 0.02 });
  const win = m.color('#ffd86a', { emissive: 1, jitter: 0.02 });
  const wood = m.color('#8a5634', { jitter: 0.08 });
  const flagC = [m.color('#ff5a7a', { jitter: 0.04 }), m.color('#ffd84a', { jitter: 0.04 })];
  const tex = masonry(m, st, mortar);
  // Rocky base.
  const rk = reefRock(m, rng);
  facetRock(m, rng, 42, 3, 30, 38, 8, 26, rk[0], 16);
  stoneTex(m, rk, 4);
  // Curtain walls with crenellations.
  m.box(16, 6, 14, 67, 34, 45, tex);
  for (let x = 16; x <= 67; x++) for (const z of [14, 45]) if (x % 4 < 2) m.box(x, 35, z, x, 37, z, st[2]);
  for (let z = 14; z <= 45; z++) for (const x of [16, 67]) if (z % 4 < 2) m.box(x, 35, z, x, 37, z, st[2]);
  // Keep.
  m.box(28, 34, 20, 55, 62, 40, tex);
  for (let x = 28; x <= 55; x++) for (const z of [20, 40]) if (x % 4 < 2) m.box(x, 63, z, x, 65, z, st[2]);
  for (let z = 20; z <= 40; z++) for (const x of [28, 55]) if (z % 4 < 2) m.box(x, 63, z, x, 65, z, st[2]);
  // Towers with cone roofs.
  const tower = (cx, cz, r, h, rc) => {
    m.cylinder(cx, cz, 6, h, r, tex);
    m.cylinder(cx, cz, h - 2, h, r + 1.2, st[2]);
    m.cone(cx, cz, h + 1, h + 1 + r * 2.4, r + 2, 0.5, (x, y) => ((y - h) % 4 === 0 ? rc[1] : rc[0]));
    m.box(cx, h + 2 + r * 2.4, cz, cx, h + 8 + r * 2.4, cz, gold);
    // Arched glowing window.
    const wz = Math.round(cz + r);
    m.box(cx - 1, h - 12, wz, cx, h - 8, wz, win);
    m.box(cx - 1, h - 13, wz, cx, h - 13, wz, mortar);
    return h + 8 + r * 2.4;
  };
  tower(17, 44, 7, 46, roof);
  tower(66, 44, 7, 48, roof);
  tower(18, 15, 6, 42, roofR);
  tower(65, 15, 6, 44, roofR);
  const top = tower(42, 30, 8, 76, roof);
  // Flags.
  for (const [fx, fy, fz, c] of [[42, top, 30, flagC[0]], [17, 77, 44, flagC[1]], [66, 79, 44, flagC[0]]]) {
    for (let y = 0; y < 5; y++) for (let x = 1; x <= 7; x++) m.set(fx + x, fy - 1 - y + Math.round(Math.sin(x * 0.9) * 0.6), fz, c);
  }
  // Gate with portcullis + wooden door, windows on the keep.
  m.sub(() => { m.box(37, 6, 44, 46, 18, 46); m.cylinder(41.5, 45, 18, 22, 4.5, 0, 'y'); });
  m.sub(() => m.cylinder(18, 41.5, 44, 46, 5, 0, 'z'));
  shape(m, 36, 6, 44, 47, 24, 44, () => true, (x, y, z, p) => (p ? null : y < 22 && (x - 37) % 3 === 0 ? gold : wood));
  m.box(36, 6, 45, 47, 24, 46, (x, y, z, p) => null);
  for (const wx of [33, 47]) { m.box(wx, 46, 40, wx + 2, 52, 40, win); m.box(wx, 53, 40, wx + 2, 53, 40, gold); }
  for (const wx of [24, 58]) { m.box(wx, 20, 45, wx + 1, 25, 45, win); }
  // Drawbridge chains + little moat stones.
  m.line(36, 22, 46, 34, 8, 52, gold, 0.4);
  m.line(47, 22, 46, 49, 8, 52, gold, 0.4);
  m.box(36, 5, 46, 47, 6, 55, wood);
  moss(m, rng, 3, MOSS, 0.4, 0.2, [...rk, ...st]);
  return { m, yaw: 30, vs: 1.6, light: '#ffd86a' };
});

def('moai_head', { name: 'Moai Head', biome: 'aquarium', tags: ['statue'], decor: { price: 350, size: 2 }, decorOnly: true }, ({ rng }) => {
  const m = new VoxelModel(54, 92, 54);
  const st = [m.color('#9a8e80', { jitter: 0.1, smooth: 0.55 }), m.color('#837768', { jitter: 0.1, smooth: 0.55 }), m.color('#b2a696', { jitter: 0.08, smooth: 0.55 })];
  const deep = m.color('#3e3436', { jitter: 0.04, smooth: 0.3 });
  const hat = [m.color('#b85a48', { jitter: 0.1, smooth: 0.65 }), m.color('#9a4a3c', { jitter: 0.1, smooth: 0.65 })];
  const cx = 27, cz = 24;
  // Rounded-rectangle cross sections stacked up: shoulders, then the long head.
  shape(m, 0, 0, 0, 53, 74, 53, (x, y, z) => {
    let a, c;
    if (y < 16) { a = 15; c = 12; } else if (y < 72) { a = 12.5 - (y - 16) * 0.02; c = 10.5 - Math.max(0, y - 60) * 0.1; } else return false;
    const dx = Math.abs(x - cx) / a, dz = Math.abs(z - cz) / c;
    return dx ** 4 + dz ** 4 <= 1;
  }, (x, y, z) => (y < 16 ? st[1] : st[0]));
  const fz = cz + 10.5;
  // Heavy brow ridge.
  shape(m, cx - 13, 52, fz - 3, cx + 13, 58, fz + 4, (x, y, z) => Math.abs(x - cx) < 12 && z < fz + 3 - Math.abs(y - 55) * 0.6 - (Math.abs(x - cx) / 12) ** 2 * 2, st[2]);
  // Deep eye hollows.
  for (const sx of [-1, 1]) {
    m.sub(() => m.ellipsoid(cx + sx * 6, 48, fz + 1, 4.2, 3, 3));
    m.paint(() => m.ellipsoid(cx + sx * 6, 48, fz - 1, 4.4, 3.2, 1.6, deep));
  }
  // Long nose: ridge widening and protruding toward the tip.
  shape(m, cx - 7, 28, fz - 2, cx + 7, 54, fz + 10, (x, y, z) => {
    const t = (54 - y) / 26;
    const w = 1.6 + t * 3.6, p = 1 + t * 7;
    return Math.abs(x - cx) <= w && z <= fz + p - (Math.abs(x - cx) / w) * 1.5;
  }, st[2]);
  for (const sx of [-1, 1]) m.paint(() => m.ellipsoid(cx + sx * 2.6, 29.5, fz + 6, 1.4, 0.8, 1.6, deep));
  // Pouting lips and jutting chin.
  shape(m, cx - 8, 21, fz - 2, cx + 8, 28, fz + 5, (x, y, z) => ((x - cx) / 7.5) ** 2 + ((y - 24.5) / 3.6) ** 2 <= 1 && z < fz + 4, st[0]);
  m.box(cx - 6, 24, fz, cx + 5, 24, fz + 4, deep);
  shape(m, cx - 10, 13, fz - 2, cx + 10, 21, fz + 4, (x, y, z) => ((x - cx) / 9.5) ** 2 + ((y - 17) / 4.5) ** 2 <= 1 && z < fz + 3, st[0]);
  // Long ears.
  for (const sx of [-1, 1]) shape(m, cx + sx * 13 - 3, 30, cz - 6, cx + sx * 13 + 3, 60, cz + 4, (x, y, z) => Math.abs(x - cx - sx * 12.5) < 1.6 && ((y - 45) / 15) ** 2 + ((z - cz + 1) / 4.5) ** 2 <= 1, st[1]);
  // Pukao topknot.
  m.cylinder(cx, cz, 72, 82, 11, (x, y) => (y % 3 === 0 ? hat[1] : hat[0]));
  m.cylinder(cx, cz, 82, 83, 8, hat[0]);
  chip(m, rng, 14, st, 1.2);
  moss(m, rng, 5, MOSS, 0.35, 0.2, st);
  sandMound(m, cx, cz + 2, 21, 19, 3, 3);
  return { m, yaw: 24 };
});

def('diver_helmet', { name: 'Diver Helmet', biome: 'aquarium', tags: ['wreck', 'metal'], decor: { price: 280, size: 1 }, decorOnly: true }, ({ rng }) => {
  const m = new VoxelModel(50, 50, 46);
  const brass = [m.color('#d6a046', { jitter: 0.06, smooth: 0.8, spec: 1.8, specPow: 12 }), m.color('#b8822f', { jitter: 0.06, smooth: 0.8, spec: 1 })];
  const copper = [m.color('#c0704a', { jitter: 0.06, smooth: 0.7, spec: 1.2 }), m.color('#9a5638', { jitter: 0.05, smooth: 0.7 })];
  const glassC = m.color('#2a5a6a', { jitter: 0.02, smooth: 0.8, spec: 2.5, specPow: 10, light: -0.3 });
  const bolt = m.color('#f2e2a0', { jitter: 0, spec: 1 });
  const verd = m.color('#5fb89a', { jitter: 0.08, smooth: 0.7 });
  const cx = 25, cz = 22;
  // Corselet (shoulder plate).
  m.ellipsoid(cx, 6, cz, 19, 9, 16, copper[0]);
  m.sub(() => m.box(0, 0, 0, 49, 2, 45));
  for (let k = 0; k < 12; k++) { const a = k / 12 * Math.PI * 2; m.set(cx + Math.cos(a) * 17.5, 6, cz + Math.sin(a) * 14.5, bolt); }
  // Bonnet sphere.
  m.sphere(cx, 24, cz, 15.5, brass[0]);
  m.cylinder(cx, cz, 11, 14, 13, brass[1]);
  // Front viewport.
  m.cylinder(cx, 24, cz + 13, cz + 17, 7.5, brass[1], 'z');
  m.cylinder(cx, 24, cz + 16, cz + 17, 6, glassC, 'z');
  m.sub(() => m.cylinder(cx, 24, cz + 17, cz + 17, 5.5, 0, 'z'));
  for (const gx of [-2, 2]) m.box(cx + gx, 19, cz + 17, cx + gx, 29, cz + 17, brass[1]);
  m.box(cx - 6, 24, cz + 17, cx + 5, 24, cz + 17, brass[1]);
  // Side ports.
  for (const s of [-1, 1]) {
    m.cylinder(24, cz + 2, cx + s * 14, cx + s * 17, 4.8, brass[1], 'x');
    m.cylinder(24, cz + 2, s > 0 ? cx + 17 : cx - 17, s > 0 ? cx + 17 : cx - 17, 3.6, glassC, 'x');
  }
  // Top valve.
  m.cylinder(cx, cz - 3, 38, 41, 2.4, copper[0]);
  m.cylinder(cx, cz - 3, 41, 42, 3.5, copper[1]);
  // Verdigris patina in the crevices.
  m.recolor((x, y, z, p) => ((p === brass[0] || p === brass[1]) && fbm3(x * 0.18, y * 0.18, z * 0.18, 2, 6) > 0.66 ? verd : null));
  sandMound(m, cx, cz, 22, 19, 3, 5);
  barnacles(m, rng, 3, [...brass, ...copper]);
  return { m, yaw: 30 };
});

def('pirate_ship', { name: 'Pirate Ship', biome: 'aquarium', tags: ['ship', 'glow'], decor: { price: 1500, size: 3 }, decorOnly: true }, ({ rng }) => {
  const m = new VoxelModel(124, 126, 56);
  const wood = [m.color('#5a3a2a', { jitter: 0.08 }), m.color('#6b4530', { jitter: 0.08 }), m.color('#4a2e22', { jitter: 0.08 })];
  const seam = m.color('#2e1c18', { jitter: 0.03 });
  const stripe = m.color('#c8423a', { jitter: 0.05 });
  const gold = m.color('#f0c050', { jitter: 0.04, spec: 1.2 });
  const deck = [m.color('#a87848', { jitter: 0.06 }), m.color('#94683e', { jitter: 0.06 })];
  const dark = m.color('#1e1418', { jitter: 0.02 });
  const cannon = m.color('#2a2a32', { jitter: 0.04, spec: 1 });
  const win = m.color('#ffd06a', { emissive: 1, jitter: 0.02 });
  const sail = [m.color('#2f2a36', { jitter: 0.05, smooth: 0.45 }), m.color('#3c3644', { jitter: 0.05, smooth: 0.45 })];
  const skull = m.color('#efe8da', { jitter: 0.02 });
  const mastC = m.color('#6a4a32', { jitter: 0.05, smooth: 0.4 });
  const rope = m.color('#c8b07a', { jitter: 0.03 });
  const lamp = m.color('#ffb84a', { emissive: 1, jitter: 0 });
  const zc = 26, X0 = 8, L = 104;
  const T = (x) => (x - X0) / L;
  const sheer = (t) => 26 + 12 * Math.max(0, (0.2 - t) / 0.2) ** 1.5 + 8 * Math.max(0, (t - 0.75) / 0.25) ** 2;
  const keel = (t) => 3 + 14 * Math.max(0, (t - 0.76) / 0.24) ** 2;
  const beam = (t) => (t < 0 || t > 1 ? 0 : t < 0.08 ? 12 + 4 * t / 0.08 : t < 0.55 ? 16 : 16 * Math.pow(Math.max(0, 1 - ((t - 0.55) / 0.45) ** 1.8), 0.62));
  const halfAt = tabulate(124, 56, (x, y, shrink) => {
    const t = T(x), B = beam(t) - shrink;
    if (B <= 0) return -1;
    const yk = keel(t) + shrink, ys = sheer(t);
    if (y < yk || y > ys) return -1;
    return B * Math.min(1, Math.pow((y - yk) / Math.max(1, 18 - yk * 0.4), 0.45));
  });
  const inHull = (x, y, z, sh = 0) => { const hw = halfAt(x, y, sh); return hw > 0 && Math.abs(z - zc) <= hw; };
  shape(m, 0, 0, 0, 123, 50, 55, (x, y, z) => inHull(x, y, z), (x, y, z) => {
    const v = y + Math.abs(z - zc) * 0.2;
    if (Math.abs(v - 18) < 1.2) return stripe;
    if (Math.abs(v - 20) < 0.6) return gold;
    if ((v % 3.2) < 0.6) return seam;
    return wood[Math.floor(v / 3.2) % 3];
  });
  m.sub(() => shape(m, 0, 0, 0, 123, 50, 55, (x, y, z) => inHull(x, y, z, 1.6) && y > keel(T(x)) + 2, 0));
  // Deck + raised stern castle with glowing windows.
  shape(m, 0, 0, 0, 123, 50, 55, (x, y, z) => y === Math.floor(Math.min(sheer(T(x)), 30)) - 2 && inHull(x, y, z), (x, y, z) => deck[z % 3 === 0 ? 1 : 0]);
  m.box(10, 24, zc - 13, 30, 38, zc + 12, (x, y, z) => (y % 4 === 0 ? seam : wood[1]));
  m.box(9, 39, zc - 14, 31, 40, zc + 13, gold);
  for (const wx of [13, 19, 25]) { m.box(wx, 29, zc + 13, wx + 2, 33, zc + 13, win); m.box(wx - 1, 34, zc + 13, wx + 3, 34, zc + 13, gold); }
  for (const wz of [zc - 8, zc - 2, zc + 4]) m.box(9, 29, wz, 9, 33, wz + 2, win);
  // Gun ports with cannons.
  for (const gx of [40, 52, 64, 76]) {
    const hw = halfAt(gx, 14);
    const zz = Math.floor(zc + hw);
    m.box(gx - 1, 12, zz - 1, gx + 2, 15, zz + 1, dark);
    m.cylinder(13.5, zz, gx, gx + 1, 0, cannon, 'x');
    m.cylinder(gx + 0.5, 13.5, zz, zz + 4, 1.3, cannon, 'z');
  }
  // Masts, yards and black sails with a skull.
  const masts = [[46, 96], [76, 84]];
  for (const [mx, mh] of masts) {
    m.cylinder(mx, zc, 10, mh, 1.8, mastC);
    for (const [yy, w] of [[mh - 12, 18], [mh - 34, 22]]) m.line(mx, yy, zc + 2, mx, yy, zc + 2, mastC, 0.6) && m.box(mx - w, yy, zc + 2, mx + w, yy + 1, zc + 3, mastC);
    // Sail panels billowing towards the camera.
    for (const [ya, yb, w] of [[mh - 32, mh - 13, 17], [mh - 54, mh - 35, 20]]) {
      for (let y = ya; y <= yb; y++) for (let x = mx - w; x <= mx + w; x++) {
        const t = (x - mx) / w, s = (y - ya) / (yb - ya);
        const bil = Math.round((1 - t * t) * 4 * Math.sin(s * Math.PI) + 3);
        m.set(x, y, zc + bil, (x + y) % 9 === 0 ? sail[1] : sail[0]);
      }
    }
    m.box(mx - 1, mh, zc - 1, mx + 1, mh + 2, zc + 1, gold);
  }
  // Skull & crossbones on the main sail.
  const [sx, sy] = [46, 96 - 22];
  const skullRows = ['..####..', '.######.', '##.##.##', '########', '.##..##.', '..####..', '#..##..#', '.#....#.', '#......#'];
  skullRows.forEach((row, j) => { for (let i = 0; i < row.length; i++) if (row[i] === '#') m.set(sx - 4 + i, sy + 5 - j, zc + 8, skull); });
  // Jolly roger flag.
  for (let y = 0; y < 6; y++) for (let x = 1; x <= 9; x++) m.set(46 + x, 96 + 1 - y + Math.round(Math.sin(x * 0.8) * 0.6), zc, y === 2 && x > 3 && x < 7 ? skull : sail[0]);
  // Bowsprit, rigging, stern lantern.
  m.line(X0 + L - 2, 34, zc, X0 + L + 12, 44, zc, mastC, 1.1);
  m.line(46, 94, zc, X0 + L + 10, 43, zc, rope, 0.4);
  m.line(46, 94, zc, 12, 41, zc, rope, 0.4);
  m.line(76, 82, zc, X0 + L + 4, 40, zc, rope, 0.4);
  m.box(6, 40, zc - 1, 8, 43, zc + 1, lamp);
  m.box(5, 44, zc - 1, 9, 44, zc + 1, gold);
  // Wave-shaped sand base so it sits in the tank.
  sandMound(m, 60, 28, 56, 22, 6, 5);
  return { m, yaw: 30, vs: 1.55, light: '#ffd06a' };
});

def('sunken_pc', { name: 'Sunken PC', biome: 'aquarium', tags: ['computer', 'screen'], decor: { price: 420, size: 2 }, decorOnly: true }, ({ rng }) => {
  const m = new VoxelModel(84, 58, 60);
  const screen = m.color('#2d6b5e', { emissive: 0.6, jitter: 0.03 });
  const crt = crtPart(m, screen);
  stampRot(m, crt, [19, 0, 18], [34, 4, 26], 0, 8, 0);
  // Desk-less: tower case beside the monitor.
  const tower = part(m, 18, 40, 30);
  const beige = BEIGE.map((c) => m.color(c, { jitter: 0.07 }));
  const dark = m.color('#2a2730', { jitter: 0.03 });
  const led = m.color('#ff6a4a', { emissive: 1, jitter: 0 });
  const led2 = m.color('#7dff6a', { emissive: 1, jitter: 0 });
  tower.box(0, 0, 0, 15, 37, 27, beige[0]);
  tower.box(1, 30, 28, 14, 32, 28, beige[1]);
  tower.box(2, 31, 28, 13, 31, 28, dark);
  tower.box(1, 24, 28, 14, 27, 28, beige[1]);
  tower.box(4, 25, 28, 11, 25, 28, dark);
  tower.set(3, 18, 28, led); tower.set(5, 18, 28, led2);
  tower.box(10, 16, 28, 12, 19, 28, beige[2]);
  for (let y = 4; y < 14; y += 2) tower.box(3, y, 28, 12, y, 28, dark);
  tower.recolor((x, y, z, p) => (p === beige[0] && !tower.get(x, y + 1, z) ? beige[2] : null));
  stampRot(m, tower, [8, 0, 14], [66, 3, 26], 0, -12, 0);
  // Keyboard in front.
  const kb = part(m, 40, 6, 14);
  const key = m.color('#ece4cc', { jitter: 0.05 });
  kb.box(0, 0, 0, 37, 1, 12, beige[1]);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 9; c++) kb.box(2 + c * 4, 2, 2 + r * 4, 4 + c * 4, 2, 4 + r * 4, key);
  stampRot(m, kb, [19, 0, 6], [36, 3, 50], 6, -6, 0);
  // Mouse with cable.
  m.ellipsoid(62, 4, 50, 2.5, 1.6, 3.5, beige[0]);
  m.tube([[62, 4, 46, 0.5], [60, 3, 40, 0.5], [66, 4, 34, 0.5]], dark);
  sandMound(m, 44, 32, 40, 26, 4, 6);
  // Seaweed growing behind.
  const kelp = [m.color('#4fa25e', { smooth: 0.3 }), m.color('#86cf74', { smooth: 0.3 })];
  for (let k = 0; k < 3; k++) {
    const x = 14 + k * 4, z = 20 + k * 3;
    for (let y = 2; y < 30 + k * 6; y++) m.set(x + Math.round(Math.sin(y * 0.35 + k) * 1.3), y, z, kelp[y % 6 === 0 ? 1 : 0]);
  }
  moss(m, rng, 4, MOSS, 0.3, 0.2, beige);
  return { m, yaw: 22, screens: [screen], light: '#7fffd0' };
});

const LAVA = [['#ff4a8a', '#ffd84a'], ['#2ac8d8', '#e0ff6a'], ['#8a4aff', '#ffa0e0'], ['#3ac83a', '#e8ff5a'], ['#ff6a2a', '#ffd0e0'], ['#1a2a6a', '#a8c0ff']];
def('lava_lamp', { name: 'Lava Lamp', biome: 'aquarium', tags: ['glow', 'retro'], decor: { price: 240, size: 1 }, decorOnly: true }, ({ variant, frame }) => lavaLamp(LAVA[variant % LAVA.length], frame));

def('rubber_duck', { name: 'Rubber Duck', biome: 'aquarium', tags: ['toy'], decor: { price: 30, size: 1 }, decorOnly: true }, () => {
  const m = new VoxelModel(40, 36, 30);
  const yel = [m.color('#ffd23a', { smooth: 0.85, jitter: 0.03, spec: 1.6, specPow: 14 }), m.color('#f2b42a', { smooth: 0.85, jitter: 0.03 })];
  const beak = m.color('#ff8a2a', { smooth: 0.7, jitter: 0.02 });
  const eye = m.color('#1a1a22', { jitter: 0 });
  const glint = m.color('#ffffff', { jitter: 0 });
  m.ellipsoid(18, 8, 15, 13, 8.5, 10.5, yel[0]);
  m.sub(() => m.box(0, 0, 0, 39, 1, 29));
  m.ellipsoid(6, 13, 15, 4, 4, 5, yel[0]); // tail
  m.sphere(25, 21, 15, 7.5, yel[0]);
  m.ellipsoid(32, 19.5, 15, 4.5, 1.6, 3.4, beak);
  m.ellipsoid(31.5, 17.8, 15, 3.6, 1, 2.6, beak);
  for (const s of [-1, 1]) { m.box(27, 23, 15 + s * 5.5, 28, 24, 15 + s * 5.5, eye); m.set(28, 24, 15 + s * 5.5 + (s > 0 ? 1 : -1) * 0, glint); }
  m.ellipsoid(15, 11, 23.5, 6, 3.5, 2, yel[1]); // wing
  m.ellipsoid(15, 11, 6.5, 6, 3.5, 2, yel[1]);
  return { m, yaw: 30 };
});

def('pagoda_lantern', { name: 'Stone Lantern', biome: 'aquarium', tags: ['glow', 'statue'], decor: { price: 320, size: 1 }, decorOnly: true }, ({ rng }) => {
  const m = new VoxelModel(44, 84, 44);
  const st = [m.color('#9a9a8c', { jitter: 0.1, smooth: 0.3 }), m.color('#85857a', { jitter: 0.1, smooth: 0.3 }), m.color('#b0b0a2', { jitter: 0.08, smooth: 0.3 })];
  const lightC = m.color('#ffcf6a', { emissive: 1, jitter: 0.02 });
  const deep = m.color('#3a3530', { jitter: 0.02 });
  const cx = 22, cz = 22;
  m.box(cx - 12, 0, cz - 12, cx + 11, 3, cz + 11, st[1]);
  m.box(cx - 9, 4, cz - 9, cx + 8, 6, cz + 8, st[0]);
  m.cylinder(cx - 0.5, cz - 0.5, 7, 30, 4.2, st[0]);
  for (const y of [12, 22]) m.cylinder(cx - 0.5, cz - 0.5, y, y, 5, st[2]);
  m.box(cx - 10, 31, cz - 10, cx + 9, 34, cz + 9, st[1]);
  // Light chamber with open windows.
  m.box(cx - 8, 35, cz - 8, cx + 7, 50, cz + 7, st[0]);
  m.sub(() => { m.box(cx - 4, 38, cz - 9, cx + 3, 47, cz + 8); m.box(cx - 9, 38, cz - 4, cx + 8, 47, cz + 3); });
  m.box(cx - 6, 37, cz - 6, cx + 5, 48, cz + 5, lightC);
  for (let x = cx - 4; x <= cx + 3; x += 3) m.box(x, 38, cz + 7, x, 47, cz + 7, deep);
  // Wide curved roof.
  for (let y = 51; y <= 60; y++) {
    const t = (y - 51) / 9;
    const r = 17 - t * 13 + (y === 51 ? 1 : 0);
    m.box(cx - r, y, cz - r, cx + r - 1, y, cz + r - 1, y === 51 ? st[2] : st[(y % 2)]);
  }
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) m.box(cx + sx * 17 - (sx > 0 ? 1 : 0), 52, cz + sz * 17 - (sz > 0 ? 1 : 0), cx + sx * 17 - (sx > 0 ? 1 : 0), 53, cz + sz * 17 - (sz > 0 ? 1 : 0), st[2]);
  m.sphere(cx - 0.5, 63, cz - 0.5, 3.4, st[2]);
  m.cone(cx - 0.5, cz - 0.5, 66, 69, 2, 0.4, st[2]);
  chip(m, rng, 14, st, 1.2);
  moss(m, rng, 6, MOSS, 0.5, 0.2, st);
  sandMound(m, cx, cz, 17, 17, 2, 3);
  return { m, yaw: 30, light: '#ffcf6a' };
});

def('mushroom_house', { name: 'Mushroom House', biome: 'aquarium', tags: ['build', 'glow'], decor: { price: 480, size: 2 }, decorOnly: true }, ({ rng }) => {
  const m = new VoxelModel(70, 90, 64);
  const stem = [m.color('#f2e6cc', { jitter: 0.06, smooth: 0.65 }), m.color('#e0d0b0', { jitter: 0.06, smooth: 0.65 })];
  const cap = [m.color('#e0443a', { jitter: 0.06, smooth: 0.8, spec: 0.8 }), m.color('#c2343a', { jitter: 0.06, smooth: 0.8 })];
  const spot = m.color('#fff6e8', { jitter: 0.03, smooth: 0.8 });
  const gill = m.color('#d8b890', { jitter: 0.05 });
  const door = [m.color('#8a5634', { jitter: 0.06 }), m.color('#6a4028', { jitter: 0.06 })];
  const knob = m.color('#f2c84a', { jitter: 0, spec: 1 });
  const win = m.color('#ffd86a', { emissive: 1, jitter: 0.02 });
  const frameC = m.color('#7a4a2a', { jitter: 0.04 });
  const brick = m.color('#a8584a', { jitter: 0.06 });
  const cx = 35, cz = 30;
  // Bulbous stem/house.
  for (let y = 0; y < 44; y++) {
    const t = y / 44;
    const r = 15 + Math.sin(t * Math.PI) * 4 - t * 3;
    m.cylinder(cx, cz, y, y, r, (x, yy, z) => (h3(x, yy, z, 3) < 0.08 ? stem[1] : stem[0]));
  }
  // Cap.
  shape(m, cx - 32, 38, cz - 30, cx + 32, 80, cz + 30, (x, y, z) => {
    const d = ((x - cx) / 31) ** 2 + ((y - 42) / 30) ** 2 + ((z - cz) / 28) ** 2;
    return d <= 1 && y >= 42 - Math.hypot(x - cx, z - cz) * 0.12;
  }, (x, y, z) => (y < 44 ? gill : cap[0]));
  m.recolor((x, y, z, p) => (p === cap[0] && !m.get(x, y + 1, z) === false && h3(x, y, z, 1) < 0.05 ? cap[1] : null));
  // White spots.
  const spots = [[cx - 14, 64, cz + 12, 4], [cx + 10, 68, cz + 14, 5], [cx + 2, 74, cz - 2, 4], [cx - 22, 56, cz - 4, 3.5], [cx + 22, 58, cz + 2, 3.5], [cx - 6, 60, cz + 22, 3.5], [cx + 18, 52, cz + 18, 3]];
  for (const [x, y, z, r] of spots) m.paint(() => m.sphere(x, y, z, r, (xx, yy, zz) => (m.exposed(xx, yy, zz) ? spot : null)));
  // Round door, windows, chimney.
  const dz = cz + 18;
  m.sub(() => { m.box(cx - 5, 0, dz - 3, cx + 4, 12, dz + 4); m.cylinder(cx - 0.5, dz, 12, 16, 5, 0, 'y'); });
  m.cylinder(cx - 0.5, 10, dz - 2, dz - 1, 7, frameC, 'z');
  m.sub(() => m.cylinder(cx - 0.5, 10, dz - 2, dz + 2, 5.6, 0, 'z'));
  shape(m, cx - 6, 0, dz - 2, cx + 6, 17, dz - 2, (x, y) => y < 10 ? Math.abs(x - cx + 0.5) < 5.6 : Math.hypot(x - cx + 0.5, y - 10) < 5.6, (x) => ((x >> 1) % 2 ? door[0] : door[1]));
  m.set(cx + 2, 8, dz - 1, knob);
  for (const [wx, wy, wz] of [[cx - 14, 24, cz + 13], [cx + 12, 28, cz + 14]]) {
    m.cylinder(wx, wy, wz, wz + 3, 3.4, frameC, 'z');
    m.cylinder(wx, wy, wz + 3, wz + 3, 2.4, win, 'z');
    m.box(wx - 0.5, wy - 2.4, wz + 4, wx, wy + 2.4, wz + 4, frameC);
  }
  m.box(cx + 14, 70, cz - 8, cx + 18, 82, cz - 4, brick);
  m.box(cx + 13, 82, cz - 9, cx + 19, 83, cz - 3, brick);
  // Steps and a little lantern post.
  m.box(cx - 6, 0, dz + 2, cx + 5, 1, dz + 7, stem[1]);
  m.cylinder(cx + 16, dz + 6, 0, 14, 0.8, frameC);
  m.box(cx + 15, 14, dz + 5, cx + 17, 17, dz + 7, win);
  m.box(cx + 15, 18, dz + 5, cx + 17, 18, dz + 7, frameC);
  moss(m, rng, 6, MOSS, 0.25, 0.25, [...stem]);
  sandMound(m, cx, cz + 2, 26, 24, 3, 5);
  return { m, yaw: 28, vs: 1.6, light: '#ffd86a' };
});

def('tiki_head', { name: 'Tiki Totem', biome: 'aquarium', tags: ['statue'], decor: { price: 260, size: 1 }, decorOnly: true }, ({ rng }) => {
  const m = new VoxelModel(36, 82, 32);
  const wood = [m.color('#9a6038', { jitter: 0.1, smooth: 0.35 }), m.color('#83502e', { jitter: 0.1, smooth: 0.35 }), m.color('#b27848', { jitter: 0.08, smooth: 0.35 })];
  const deep = m.color('#3a2018', { jitter: 0.03 });
  const teal = m.color('#3ab8a8', { jitter: 0.05 });
  const red = m.color('#d84a3a', { jitter: 0.05 });
  const white = m.color('#f2ead8', { jitter: 0.03 });
  const cx = 18, cz = 15, fz = 26;
  // Two stacked faces on a pole.
  m.cylinder(cx, cz, 0, 72, 11, (x, y, z) => wood[Math.floor((y + (x >> 2)) / 3) % 2]);
  m.box(cx - 13, 70, cz - 13, cx + 12, 74, cz + 12, wood[2]);
  for (let k = 0; k < 9; k++) { const a = k / 9 * Math.PI; m.line(cx, 74, cz, cx + Math.cos(a) * 14, 80, cz + Math.sin(a) * 4 + 4, k % 2 ? teal : red, 1); }
  const face = (y0) => {
    // Brow band.
    m.box(cx - 10, y0 + 22, cz + 7, cx + 9, y0 + 25, fz, wood[2]);
    // Big eyes.
    for (const s of [-1, 1]) {
      const ex = cx + s * 5 - (s > 0 ? 1 : 0);
      m.box(ex - 3, y0 + 15, fz - 1, ex + 3, y0 + 20, fz, deep);
      m.box(ex - 2, y0 + 16, fz, ex + 2, y0 + 19, fz, white);
      m.box(ex - 0.5, y0 + 16, fz, ex + 0.5, y0 + 18, fz, deep);
    }
    // Nose.
    m.box(cx - 3, y0 + 9, fz - 1, cx + 2, y0 + 15, fz + 1, wood[2]);
    m.box(cx - 4, y0 + 9, fz, cx + 3, y0 + 10, fz + 2, wood[2]);
    // Wide grinning mouth with teeth.
    m.box(cx - 8, y0 + 2, fz - 2, cx + 7, y0 + 7, fz, deep);
    for (let x = cx - 7; x <= cx + 6; x += 2) m.box(x, y0 + 5, fz, x, y0 + 6, fz, white);
    m.box(cx - 9, y0 + 1, fz - 1, cx + 8, y0 + 1, fz, red);
  };
  face(36);
  face(2);
  m.box(cx - 11, 33, cz - 11, cx + 10, 34, cz + 11, (x, y, z) => ((x + z) % 4 < 2 ? teal : red));
  chip(m, rng, 10, wood, 1.1);
  moss(m, rng, 5, MOSS, 0.3, 0.22, wood);
  sandMound(m, cx, cz, 14, 14, 2, 8);
  return { m, yaw: 24 };
});

def('bridge', { name: 'Moon Bridge', biome: 'aquarium', tags: ['build', 'swimthrough'], decor: { price: 380, size: 3 }, decorOnly: true }, ({ rng }) => {
  const m = new VoxelModel(110, 50, 34);
  const red = [m.color('#d8463a', { jitter: 0.05 }), m.color('#b8343a', { jitter: 0.05 }), m.color('#ee6a52', { jitter: 0.04 })];
  const plank = [m.color('#a87848', { jitter: 0.06 }), m.color('#94683e', { jitter: 0.06 })];
  const gold = m.color('#f2c84a', { jitter: 0.03, spec: 1.2 });
  const stone = [m.color('#8e8e86', { jitter: 0.1 }), m.color('#7a7a72', { jitter: 0.1 })];
  const zc = 17, ax = 55, R = 46;
  const arcY = (x) => { const d = (x - ax) / R; return Math.abs(d) >= 1 ? 0 : Math.sqrt(1 - d * d) * 24; };
  // Arched deck with plank seams.
  for (let x = ax - R; x <= ax + R; x++) {
    const y = arcY(x + 0.5);
    m.box(x, Math.max(0, y - 3), zc - 8, x, y, zc + 7, (xx, yy, z) => (yy >= Math.floor(y) - 0 ? plank[(xx >> 1) % 2] : red[1]));
  }
  // Side beams.
  for (let x = ax - R; x <= ax + R; x++) {
    const y = arcY(x + 0.5);
    for (const z of [zc - 9, zc + 8]) m.box(x, Math.max(0, y - 4), z, x, y - 1, z, red[0]);
  }
  // Railings: posts with gold caps + top rail.
  for (let x = ax - R + 4; x <= ax + R - 4; x += 9) {
    const y = arcY(x + 0.5);
    for (const z of [zc - 9, zc + 8]) { m.box(x, y, z, x + 1, y + 9, z, red[0]); m.box(x, y + 10, z, x + 1, y + 11, z, gold); }
  }
  for (let x = ax - R + 4; x <= ax + R - 4; x++) {
    const y = arcY(x + 0.5);
    for (const z of [zc - 9, zc + 8]) { m.set(x, y + 8, z, red[2]); m.set(x, y + 4, z, red[1]); }
  }
  // Stone footings.
  for (const fx of [ax - R, ax + R]) facetRock(m, rng, fx, 2, zc, 7, 4, 10, stone[0], 10);
  moss(m, rng, 3, MOSS, 0.2, 0.2, stone);
  return { m, yaw: 24, pitch: 26 };
});

// ===================== FUN & FANCY DECOR (interactive, aquarium) =====================
// Every piece here is animated: build({frame}) changes geometry per frame (lids, lights, poses).
// `ground` pins the sprite anchor so frames with different bounds stay aligned, `anchors` are voxel
// points (projected per frame) used by the aquarium for particles and fish behaviours, `split`
// marks voxels rendered into a separate movable layer (`part`, e.g. a launching rocket).

// Rounded box from its signed distance (r = corner radius).
function rbox(m, x0, y0, z0, x1, y1, z1, r, c) {
  const cx = (x0 + x1 + 1) / 2, cy = (y0 + y1 + 1) / 2, cz = (z0 + z1 + 1) / 2;
  const hx = (x1 + 1 - x0) / 2 - r, hy = (y1 + 1 - y0) / 2 - r, hz = (z1 + 1 - z0) / 2 - r;
  shape(m, x0, y0, z0, x1, y1, z1, (x, y, z) => {
    const qx = Math.abs(x - cx) - hx, qy = Math.abs(y - cy) - hy, qz = Math.abs(z - cz) - hz;
    return Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0) <= r;
  }, c);
}

// Solid of revolution around y: rf(t, y) -> radius for t = 0..1 over [y0, y1].
function lathe(m, cx, cz, y0, y1, rf, c) {
  for (let y = y0; y <= y1; y++) {
    const r = rf((y - y0) / Math.max(1, y1 - y0), y);
    if (r > 0.2) m.cylinder(cx, cz, y, y, r, c);
  }
}

// Elliptic column: rf(t) -> [rx, rz].
function ellCol(m, cx, cz, y0, y1, rf, c) {
  for (let y = y0; y <= y1; y++) {
    const [rx, rz] = rf((y - y0) / Math.max(1, y1 - y0));
    shape(m, cx - rx - 1, y, cz - rz - 1, cx + rx + 1, y, cz + rz + 1, (x, yy, z) => ((x - cx) / rx) ** 2 + ((z - cz) / rz) ** 2 <= 1, c);
  }
}

// Front surface z of a sphere at (x, y), or null outside it.
function frontZ(cx, cy, cz, r, x, y) {
  const q = r * r - (x - cx) ** 2 - (y - cy) ** 2;
  return q >= 0 ? Math.floor(cz + Math.sqrt(q) - 0.3) : null;
}

// A little rubber duck facing +x (face = -1 faces -x).
function miniDuck(m, x, y, z, s, yel, beak, eye, face = 1) {
  m.ellipsoid(x, y + 1.6 * s, z, 3 * s, 2 * s, 2.4 * s, yel);
  m.ellipsoid(x - 2.6 * s * face, y + 2.7 * s, z, 1.3 * s, 1.3 * s, 1.5 * s, yel);
  m.sphere(x + 1.5 * s * face, y + 4.3 * s, z, 1.8 * s, yel);
  m.ellipsoid(x + 3.3 * s * face, y + 4 * s, z, 1.3 * s, 0.6 * s, 1 * s, beak);
  m.set(x + 2.1 * s * face, y + 4.9 * s, z + 1.4 * s, eye);
  m.set(x + 2.1 * s * face, y + 4.9 * s, z - 1.4 * s, eye);
}

// Tiny 3x5 pixel font written in the x-y plane at depth z (top-left at x, y).
const GLYPH = {
  A: ['.#.', '#.#', '###', '#.#', '#.#'], E: ['###', '#..', '##.', '#..', '###'], F: ['###', '#..', '##.', '#..', '#..'],
  H: ['#.#', '#.#', '###', '#.#', '#.#'], I: ['###', '.#.', '.#.', '.#.', '###'], O: ['###', '#.#', '#.#', '#.#', '###'],
  P: ['##.', '#.#', '##.', '#..', '#..'], S: ['.##', '#..', '.#.', '..#', '##.'], T: ['###', '.#.', '.#.', '.#.', '.#.'],
  U: ['#.#', '#.#', '#.#', '#.#', '###'], X: ['#.#', '#.#', '.#.', '#.#', '#.#'], 1: ['.#.', '##.', '.#.', '.#.', '###'],
  2: ['##.', '..#', '.#.', '#..', '###'], 3: ['##.', '..#', '.#.', '..#', '##.'], 0: ['###', '#.#', '#.#', '#.#', '###'],
};
function glyphs(m, text, x, y, z, c, s = 1) {
  for (const ch of text) {
    const g = GLYPH[ch];
    if (g) for (let r = 0; r < 5; r++) for (let k = 0; k < 3; k++) if (g[r][k] === '#') m.box(x + k * s, y - r * s - s + 1, z, x + k * s + s - 1, y - r * s, z, c);
    x += 4 * s;
  }
}

def('toilet', {
  name: 'Toilet', biome: 'aquarium', tags: ['dumb', 'home'], decor: { price: 150, size: 1 }, decorOnly: true,
  desc: 'Fully plumbed. Fish keep diving in. Nobody knows where it goes.',
  interact: {
    verb: 'Flush', frames: 4, seq: [1, 1, 2, 3, 2, 3, 2, 3, 1, 0], fps: 6,
    sfx: [['ui_toggle', 0, { vol: 0.5 }], ['click', 0.3, { pitch: 0.6 }], ['flood_rush', 0.35, { vol: 0.55 }], ['bubbles', 0.5], ['gulp', 1.35, { pitch: 0.7 }]],
    fx: [{ at: 0.4, kind: 'swirl', from: 'bowl', n: 14 }, { at: 0.45, kind: 'bubbles', from: 'bowl', n: 16 }, { at: 0.85, kind: 'bubbles', from: 'bowl', n: 10 }],
    fish: 'flee', use: { kind: 'hide', at: 'bowl', exitPlay: true, seq: [1], fps: 1, loop: true },
  },
}, ({ frame }) => {
  const m = new VoxelModel(48, 56, 46);
  const por = m.color('#f4f1ea', { smooth: 0.75, jitter: 0.03, spec: 1.1, specPow: 16 });
  const porD = m.color('#d8d2c6', { smooth: 0.75, jitter: 0.03 });
  const seatC = m.color('#fffdf8', { smooth: 0.6, jitter: 0.02, spec: 0.9 });
  const chrome = m.color('#c8d2de', { smooth: 0.5, spec: 2.2, specPow: 10 });
  const water = m.color(frame >= 2 ? '#8ae0f4' : '#56b8dc', { emissive: frame >= 2 ? 0.45 : 0.15, smooth: 0.4, jitter: 0.02 });
  const swirl = m.color('#effcff', { emissive: 0.7, jitter: 0 });
  const paper = m.color('#fbfaf6', { smooth: 0.8, jitter: 0.03 });
  const core = m.color('#b8905e', { jitter: 0.03 });
  const cx = 20, cz = 28;
  sandMound(m, cx, 25, 19, 18, 2, 6);
  // Pedestal flaring at the foot, bowl widening to the rim.
  ellCol(m, cx, cz - 1, 0, 12, (t) => [7.6 - Math.sin(t * Math.PI) * 1.4 + (t < 0.15 ? 1.2 : 0), 9 - Math.sin(t * Math.PI) * 1.2 + (t < 0.15 ? 1.2 : 0)], por);
  ellCol(m, cx, cz, 12, 23, (t) => [8 + Math.sqrt(t) * 3.4, 10.5 + Math.sqrt(t) * 4], por);
  m.sub(() => ellCol(m, cx, cz + 0.5, 16, 24, (t) => [6.5 + t * 2, 9 + t * 2.5], 1));
  ellCol(m, cx, cz + 0.5, 16, 17, () => [7, 9.6], water);
  m.recolor((x, y, z, p) => (p === por && y < 2 ? porD : null));
  // Seat ring and lid (closed on frame 0, leaning on the cistern otherwise).
  shape(m, cx - 13, 24, cz - 16, cx + 13, 25, cz + 16, (x, y, z) => ((x - cx) / 11.6) ** 2 + ((z - cz) / 14.8) ** 2 <= 1 && ((x - cx) / 7.4) ** 2 + ((z - cz - 0.5) / 10) ** 2 > 1, seatC);
  if (frame === 0) {
    ellCol(m, cx, cz, 26, 26, () => [11.4, 14.6], seatC);
    ellCol(m, cx, cz + 0.5, 27, 27, () => [10.4, 13.4], seatC);
  } else {
    shape(m, cx - 12, 24, 12, cx + 12, 56, 14, (x, y, z) => ((x - cx) / 11.4) ** 2 + ((y - 39.6) / 14.6) ** 2 <= (z > 13 ? 0.86 : 1), seatC);
  }
  // Cistern with lid, side lever (pressed on frame 3) and a pipe to the bowl.
  rbox(m, 7, 23, 3, 33, 44, 11, 2.2, por);
  rbox(m, 6, 45, 2, 34, 48, 12, 1.4, por);
  m.box(8, 44, 11, 32, 44, 11, porD);
  m.box(cx - 2, 20, 11, cx + 1, 24, 14, por);
  const ly = frame === 3 ? 38 : 41;
  m.box(34, 40, 6, 35, 41, 7, chrome);
  m.line(35, 41, 7, 36, ly, 11, chrome, 0.6);
  m.box(35, ly - 1, 10, 37, ly + 1, 12, chrome);
  // Swirling flush.
  if (frame >= 2) {
    m.recolor((x, y, z, p) => {
      if (p !== water || m.get(x, y + 1, z)) return null;
      const a = Math.atan2(z + 0.5 - cz, x + 0.5 - cx), r = Math.hypot(x + 0.5 - cx, (z + 0.5 - cz) / 1.3);
      return Math.sin(a * 2 + r * 0.9 - frame * 1.7) > 0.4 ? swirl : null;
    });
  }
  // A spare loo roll with a trailing sheet.
  m.cylinder(40, 4, 27, 35, 3.8, paper, 'z');
  m.cylinder(40, 4, 35, 35, 1.5, core, 'z');
  m.box(38, 0, 36, 42, 0, 43, paper);
  const front = (x, y, z) => { const v = m.get(x, y, z); return z + 0.5 > cz && y < 28 && v !== water && v !== swirl; };
  return { m, yaw: 30, ground: [cx, 0, 25], front, anchors: { bowl: [cx, 18, cz + 2], top: [cx, 49, 7] } };
});

def('garden_gnome', {
  name: 'Garden Gnome', biome: 'aquarium', tags: ['dumb', 'statue'], decor: { price: 90, size: 1 }, decorOnly: true,
  desc: 'Gone fishing. Permanently. He seems happy about it.',
  interact: {
    verb: 'Tickle', frames: 3, seq: [1, 2, 2, 2, 1, 0], fps: 6,
    sfx: [['squeak', 0, { pitch: 1.5 }], ['chirp', 0.35, { pitch: 1.25 }]],
    fx: [{ at: 0.3, kind: 'hearts', from: 'hat', n: 3 }, { at: 0.2, kind: 'sparkle', from: 'face', n: 4 }],
    fish: 'gather',
  },
}, ({ frame }) => {
  const m = new VoxelModel(40, 60, 34);
  const coat = m.color('#3a7ad8', { smooth: 0.45, jitter: 0.05 });
  const coatL = m.color('#5a9af0', { smooth: 0.45, jitter: 0.04 });
  const belt = m.color('#2a2028', { jitter: 0.02 });
  const gold = m.color('#f2c84a', { spec: 1.4 });
  const boot = m.color('#5a3424', { smooth: 0.6, jitter: 0.04 });
  const skin = m.color('#f4c49a', { smooth: 0.8, jitter: 0.02 });
  const nose = m.color('#f08a72', { smooth: 0.9, jitter: 0.02, spec: 0.8 });
  const beard = m.color('#f6f4ee', { smooth: 0.7, jitter: 0.06 });
  const hat = m.color('#e03e3a', { smooth: 0.6, jitter: 0.04 });
  const hatD = m.color('#b82e34', { smooth: 0.6, jitter: 0.04 });
  const eye = m.color('#1e1a24', { jitter: 0 });
  const blush = m.color('#ff9aa8', { jitter: 0, smooth: 0.8 });
  const rod = m.color('#8a5a34', { jitter: 0.04 });
  const line = m.color('#d8e4ec', { jitter: 0 });
  const bob = [m.color('#ff4a4a', { smooth: 0.9 }), m.color('#ffffff', { smooth: 0.9 })];
  const cx = 20, cz = 16;
  sandMound(m, cx, cz + 2, 15, 13, 2, 4);
  for (const s of [-1, 1]) m.ellipsoid(cx + s * 3.5, 2.6, cz + 2, 3, 2.6, 4.6, boot);
  lathe(m, cx, cz, 4, 23, (t) => 9.6 - t * 3.4 + Math.sin(t * Math.PI) * 0.6, (x, y) => (y < 6 ? coatL : coat));
  lathe(m, cx, cz, 11, 12, () => 9, belt);
  m.box(cx - 1, 10, cz + 8, cx + 1, 13, cz + 9, gold);
  // Arms: the left holds a fishing rod, the right rests (frame 0) or lifts the hat.
  const sh = 20;
  m.line(cx - 6.5, sh, cz, cx - 7.5, 13, cz + 5, coat, 2.2);
  m.sphere(cx - 7.5, 12.5, cz + 6, 1.9, skin);
  m.line(cx - 8, 11, cz + 7, cx - 18, 44, cz + 6, rod, 0.6);
  m.line(cx - 18, 44, cz + 6, cx - 17, 4, cz + 12, line, 0);
  m.sphere(cx - 17, 4, cz + 12, 1.6, (x, y) => (y >= 4 ? bob[0] : bob[1]));
  const up = frame > 0;
  const hand = up ? [cx + 9, 31 + frame * 2, cz + 3] : [cx + 6, 13, cz + 7];
  m.line(cx + 6.5, sh, cz, hand[0], hand[1] - 1, hand[2], coat, 2.2);
  m.sphere(hand[0], hand[1], hand[2], 1.9, skin);
  // Head, beard, moustache, nose, eyes (wink while tickled).
  m.sphere(cx, 27, cz + 1, 5.6, skin);
  m.ellipsoid(cx, 22, cz + 4.4, 6, 6.6, 3.6, beard);
  m.ellipsoid(cx, 17.4, cz + 5, 3.6, 3.2, 2.6, beard);
  for (const s of [-1, 1]) m.ellipsoid(cx + s * 2.2, 24.8, cz + 6.6, 2.2, 1.1, 1.2, beard);
  m.sphere(cx, 26.4, cz + 6.6, 1.9, nose);
  const ez = cz + 6;
  if (frame === 0) { m.box(cx - 3, 28, ez, cx - 2, 29, ez, eye); m.box(cx + 2, 28, ez, cx + 3, 29, ez, eye); } else {
    m.box(cx - 3, 28, ez, cx - 2, 28, ez, eye); m.box(cx + 2, 28, ez, cx + 3, 29, ez, eye);
    m.box(cx + 1, 31, ez - 1, cx + 3, 31, ez - 1, beard);
  }
  m.set(cx - 4, 26, ez - 1, blush); m.set(cx + 4, 26, ez - 1, blush);
  // Floppy hat (lifted while tickled), tip bent to the side.
  const hy = 30 + (frame === 1 ? 4 : frame === 2 ? 7 : 0), hx = frame ? 1.5 : 0;
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    const px = cx + hx + Math.pow(t, 2.2) * 7, py = hy + t * 19 - Math.pow(t, 3) * 3;
    m.sphere(px, py, cz + 1, 6.6 * Math.pow(1 - t, 0.85) + 0.6, (x, y) => (y < hy + 2 ? hatD : hat));
  }
  return { m, yaw: 28, ground: [cx, 0, cz + 2], anchors: { hat: [cx + 4, hy + 18, cz + 1], face: [cx, 27, cz + 7] } };
});

def('plastic_flamingo', {
  name: 'Plastic Flamingo', biome: 'aquarium', tags: ['dumb'], decor: { price: 70, size: 1 }, decorOnly: true,
  desc: 'A lawn classic. Honks when poked, which real flamingos would never do.',
  interact: {
    verb: 'Honk', frames: 3, seq: [1, 0, 1, 0, 2, 2, 2, 0], fps: 6,
    sfx: [['honk', 0, { pitch: 1.4 }], ['honk', 0.34, { pitch: 1.55 }]],
    fx: [{ at: 0.05, kind: 'burst', from: 'head', n: 8, colors: ['#ff7eb6', '#ffc2dc', '#ffffff'] }],
    fish: 'flee',
  },
}, ({ frame }) => {
  const m = new VoxelModel(44, 72, 26);
  const pink = m.color('#ff80b8', { smooth: 0.75, jitter: 0.03, spec: 1.3, specPow: 14 });
  const pinkD = m.color('#f2589e', { smooth: 0.75, jitter: 0.03 });
  const beakW = m.color('#ffe2ec', { smooth: 0.5 });
  const beakB = m.color('#2a2228', { jitter: 0 });
  const eye = m.color('#1a1420', { jitter: 0 });
  const white = m.color('#ffffff', { jitter: 0 });
  const steel = m.color('#70747e', { spec: 1, jitter: 0.02 });
  const cz = 13;
  sandMound(m, 20, cz, 11, 9, 2, 9);
  // Wire legs (one tucked up on frame 2).
  m.line(18, 0, cz, 18, 27, cz, steel, 0);
  if (frame === 2) { m.line(22, 27, cz, 26, 20, cz + 1, steel, 0); m.line(26, 20, cz + 1, 22, 16, cz + 1, steel, 0); } else m.line(22, 0, cz, 22, 27, cz, steel, 0);
  // Body, upturned tail and wing.
  m.ellipsoid(19, 32, cz, 10.5, 6.6, 6.2, pink);
  m.ellipsoid(9, 36, cz, 4.4, 3.6, 4.2, pink);
  m.ellipsoid(18, 33.5, cz, 7.4, 4.2, 6.8, pinkD);
  m.ellipsoid(10, 38, cz, 2.4, 2, 2.6, pinkD);
  // S-curved neck, head and the bent black-tipped beak.
  const peck = frame === 1;
  const neck = peck ? [[27, 35, cz, 2.6], [32, 38, cz, 2.3], [36, 33, cz, 2.1], [37, 26, cz, 2]] : [[27, 35, cz, 2.6], [31, 42, cz, 2.3], [28, 50, cz, 2.1], [27, 57, cz, 2], [30, 62, cz, 2.2]];
  m.tube(neck, pink, 5);
  const [hx, hy] = peck ? [37.5, 24] : [31, 63];
  m.sphere(hx, hy, cz, 3.7, pink);
  const dir = peck ? [0.35, -1] : [1, -0.25];
  const b0 = [hx + dir[0] * 2.8, hy + dir[1] * 2.8], b1 = [hx + dir[0] * 5.2, hy + dir[1] * 5.2 - 0.6], b2 = [b1[0] + (peck ? -0.2 : 1.2), b1[1] - 2.6];
  m.line(b0[0], b0[1], cz, b1[0], b1[1], cz, beakW, 1.2);
  m.line(b1[0], b1[1], cz, b2[0], b2[1], cz, beakB, 0.9);
  for (const s of [-1, 1]) { m.set(hx + (peck ? 1 : 0.5), hy + 1, cz + s * 3.4, eye); m.set(hx + (peck ? 1 : 0.5), hy + 2, cz + s * 3.4, white); }
  return { m, yaw: 26, ground: [20, 0, cz], anchors: { head: [hx, hy, cz] } };
});

def('toaster', {
  name: 'Toaster', biome: 'aquarium', tags: ['dumb', 'retro'], decor: { price: 110, size: 1 }, decorOnly: true,
  desc: 'Pops out soggy toast. The fish think it is a snack dispenser. They are right.',
  interact: {
    verb: 'Pop', frames: 3, seq: [1, 2, 2, 2, 1, 0], fps: 7,
    sfx: [['boing', 0, { pitch: 1.5 }], ['click', 0.7]],
    fx: [{ at: 0.18, kind: 'food', from: 'slot', n: 5 }, { at: 0.15, kind: 'burst', from: 'slot', n: 8, colors: ['#e0a860', '#a86a30', '#f4d8a0'] }],
    fish: 'gather',
  },
}, ({ frame }) => {
  const m = new VoxelModel(48, 52, 34);
  const chrome = m.color('#cfd5df', { smooth: 0.65, spec: 2.4, specPow: 10, jitter: 0.02 });
  const black = m.color('#24222a', { smooth: 0.3, jitter: 0.02 });
  const slot = m.color('#141218', { jitter: 0 });
  const crust = m.color('#b8783a', { jitter: 0.06 });
  const toast = m.color('#e8b46a', { jitter: 0.08 });
  const burnt = m.color('#9a5a2a', { jitter: 0.05 });
  const red = m.color('#e04a3a', { smooth: 0.5 });
  const cord = m.color('#2e2a30', { smooth: 0.5 });
  const cx = 20;
  rbox(m, 5, 0, 7, 35, 2, 23, 1, black);
  rbox(m, 6, 2, 8, 34, 25, 22, 4, chrome);
  for (const z of [11, 17]) m.sub(() => m.box(10, 19, z, 30, 25, z + 2));
  for (const z of [11, 17]) m.box(10, 18, z, 30, 18, z + 2, slot);
  // Two slices; frame 0 down, 1 popping, 2 airborne.
  const top = 25 + [0, 9, 19][frame];
  for (const z of [11, 17]) {
    for (let y = top - 15; y <= top; y++) {
      const k = Math.max(0, y - (top - 3)) * 1.3;
      for (let x = Math.ceil(10 + k); x <= Math.floor(30 - k); x++) {
        const edge = y === top || x <= 10 + k + 0.6 || x >= 29 - k;
        for (let zz = z; zz <= z + 2; zz++) m.set(x, y, zz, edge ? crust : zz === z + 1 ? burnt : (x + y) % 5 === 0 ? burnt : toast);
      }
    }
  }
  if (frame === 0) m.sub(() => m.box(6, 9, 8, 34, 17, 22));
  if (frame === 0) rbox(m, 6, 2, 8, 34, 17, 22, 4, chrome);
  // Lever on the side (down while toasting), browning dial, a little cord.
  const ly = frame === 0 ? 8 : 18;
  m.box(35, 5, 13, 35, 21, 16, black);
  m.box(36, ly, 12, 38, ly + 2, 17, black);
  m.cylinder(13, 8, 23, 24, 2.2, black, 'z');
  m.set(13, 9, 24, red);
  m.box(22, 6, 23, 30, 7, 23, black);
  m.tube([[cx, 3, 8, 0.9], [cx - 6, 1, 4, 0.9], [cx - 14, 1, 3, 0.9], [cx - 17, 1, 9, 0.9]], cord, 3);
  return { m, yaw: 30, ground: [cx, 0, 15], anchors: { slot: [cx, 27, 15] } };
});

def('disco_ball', {
  name: 'Disco Ball', biome: 'aquarium', tags: ['glow', 'party'], decor: { price: 320, size: 1 }, decorOnly: true,
  desc: 'Saturday Night Fin. Spins gently, then really spins.',
  interact: {
    verb: 'Party', frames: 4, idle: [0, 1, 2, 3], idleFps: 3, seq: [0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3], fps: 13,
    sfx: [['magic', 0], ['sparkle', 0.35], ['sparkle', 0.9]],
    fx: [0, 0.3, 0.6, 0.9, 1.2].map((at) => ({ at, kind: 'lights', from: 'ball', n: 18 })).concat([{ at: 0.1, kind: 'sparkle', from: 'ball', n: 8 }]),
    fish: 'dance', use: { kind: 'orbit', at: 'ball' },
  },
}, ({ frame }) => {
  const m = new VoxelModel(36, 68, 36);
  const base = m.color('#26222e', { smooth: 0.4, spec: 1.4 });
  const pole = m.color('#c8d0dc', { smooth: 0.5, spec: 2.2, specPow: 10 });
  const grout = m.color('#4a4e5e', { jitter: 0 });
  const tiles = ['#eef2f8', '#c4ccda', '#9aa6ba', '#b8d4f8', '#f4c4e8', '#d8e0ec'].map((c) => m.color(c, { jitter: 0.02, spec: 2.4, specPow: 8 }));
  const flash = [m.color('#ffffff', { emissive: 1, jitter: 0 }), m.color('#ffe8a8', { emissive: 1, jitter: 0 }), m.color('#a8f0ff', { emissive: 1, jitter: 0 })];
  const cx = 18, cz = 18, by = 52, R = 12.5;
  lathe(m, cx, cz, 0, 3, (t) => 10 - t * 3, base);
  m.cylinder(cx, cz, 4, 38, 1.4, pole);
  m.cylinder(cx, cz, 38, 39, 2.6, pole);
  m.line(cx, 39, cz, cx, by - R + 1, cz, pole, 0.8);
  const LAT = Math.PI / 11, LON = (Math.PI * 2) / 22;
  const rot = (frame * LON) / 4;
  m.sphere(cx, by, cz, R, (x, y, z) => {
    const dx = x + 0.5 - cx, dy = y + 0.5 - by, dz = z + 0.5 - cz;
    const lat = Math.asin(clamp(dy / R, -1, 1)) + Math.PI / 2, lon = Math.atan2(dz, dx) + Math.PI + rot;
    const fa = lat / LAT, fo = lon / LON;
    if (fa % 1 < 0.14 || fo % 1 < 0.12) return grout;
    const ti = Math.floor(fa), to = Math.floor(fo) % 22;
    const h = h3(ti, to, 3, 7);
    if (h3(ti, to, frame, 11) < 0.07) return flash[(ti + to) % 3];
    return tiles[Math.floor(h * tiles.length)];
  });
  m.sub(() => m.sphere(cx, by, cz, R - 2.2));
  return { m, yaw: 30, ground: [cx, 0, cz], light: '#ffe8f0', anchors: { ball: [cx, by, cz] } };
});

const PIANO_TUNE = [[0.2, 0.5], [0.42, 0.63], [0.64, 0.75], [0.86, 1], [1.08, 0.84], [1.3, 0.75], [1.52, 0.63], [1.74, 0.75], [1.96, 1]];
def('tiny_piano', {
  name: 'Tiny Grand Piano', biome: 'aquarium', tags: ['music', 'fancy'], decor: { price: 520, size: 2 }, decorOnly: true,
  desc: 'A concert grand, shrunk in the wash. Plays one song. Beautifully.',
  interact: {
    verb: 'Play', frames: 4, seq: [1, 2, 3, 2, 3, 2, 3, 2, 3, 2, 3, 2, 1, 0], fps: 5.5,
    sfx: PIANO_TUNE.map(([at, p]) => ['bell', at, { pitch: p, vol: 0.55 }]),
    fx: [0.2, 0.64, 1.08, 1.52, 1.96].map((at) => ({ at, kind: 'notes', from: 'lid', n: 2 })),
    fish: 'dance',
  },
}, ({ frame }) => {
  const m = new VoxelModel(60, 56, 58);
  const lac = m.color('#1c1a24', { spec: 1.8, specPow: 18, smooth: 0.2, jitter: 0.02 });
  const lacL = m.color('#2c2a38', { spec: 1.4, smooth: 0.2, jitter: 0.02 });
  const gold = m.color('#e0b048', { spec: 1.6, jitter: 0.03 });
  const ivory = m.color('#f6f0e0', { jitter: 0.02 });
  const ivoryD = m.color('#cfc6b0', { jitter: 0.02 });
  const ebony = m.color('#141218', { jitter: 0 });
  const felt = m.color('#a8302a', { jitter: 0.03 });
  const paper = m.color('#f8f4e8', { jitter: 0 });
  const ink = m.color('#3a3440', { jitter: 0 });
  const velvet = m.color('#c03a4a', { smooth: 0.6, jitter: 0.04 });
  const X0 = 8, ZF = 38, ZB = 6, W = 38;
  const half = (z) => {
    const u = (ZF - z) / (ZF - ZB);
    if (u < 0 || u > 1) return -1;
    return W - 16 * Math.pow(u, 1.4) - 7 * Math.sin(u * Math.PI) - (u > 0.85 ? (u - 0.85) * 40 : 0);
  };
  const inside = (x, z, inset = 0) => { const w = half(z); return w > 0 && x >= X0 + inset && x <= X0 + w - inset && z >= ZB + inset && z <= ZF - inset * 0.3; };
  // Case (rim), harp + strings visible when open, legs, lyre and pedals.
  shape(m, X0, 18, ZB, X0 + W, 26, ZF, (x, y, z) => inside(x, z), (x, y) => (y === 18 ? lacL : lac));
  m.sub(() => shape(m, X0, 21, ZB, X0 + W, 26, ZF, (x, y, z) => inside(x, z, 1.6), 1));
  shape(m, X0, 21, ZB, X0 + W, 21, ZF, (x, y, z) => inside(x, z, 1.6), (x, y, z) => (x % 2 === 0 ? gold : (z % 7 === 0 ? gold : felt)));
  m.box(X0, 26, ZF - 1, X0 + W, 26, ZF, gold);
  for (const [lx, lz] of [[X0 + 3, ZF - 3], [X0 + W - 4, ZF - 3], [X0 + 10, ZB + 6]]) {
    lathe(m, lx, lz, 1, 17, (t) => 2.1 - t * 0.5 + (t > 0.9 ? 0.6 : 0), lac);
    m.cylinder(lx, lz, 0, 1, 1.6, gold);
  }
  m.box(X0 + 17, 2, ZF - 6, X0 + 20, 16, ZF - 5, lac);
  for (const px of [X0 + 15, X0 + 18, X0 + 21]) m.box(px, 2, ZF - 4, px + 1, 2, ZF - 2, gold);
  // Keyboard (pressed keys change per frame) and cheek blocks.
  const KZ0 = ZF + 1, KZ1 = ZF + 6;
  m.box(X0, 14, KZ0, X0 + W, 16, KZ1, lac);
  for (let x = X0 + 2; x <= X0 + W - 2; x++) {
    const key = Math.floor((x - X0 - 2) / 2);
    const pressed = frame >= 2 && h3(key, frame, 1, 5) < 0.28;
    m.box(x, pressed ? 16 : 17, KZ0, x, pressed ? 16 : 17, KZ1, (x - X0 - 2) % 2 === 1 ? ivoryD : ivory);
    const b = key % 7;
    if ((x - X0 - 2) % 2 === 1 && b !== 2 && b !== 6) m.box(x, 18, KZ0, x, 18, KZ0 + 3, ebony);
  }
  m.box(X0, 17, KZ0, X0 + 1, 19, KZ1, lac);
  m.box(X0 + W - 1, 17, KZ0, X0 + W, 19, KZ1, lac);
  // Lid: closed flat, or propped open along the spine with a stick and a music stand.
  if (frame === 0) shape(m, X0, 27, ZB, X0 + W, 27, ZF, (x, y, z) => inside(x, z), lac);
  else {
    const a = (38 * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a);
    for (let z = ZB; z <= ZF; z++) {
      const w = half(z);
      if (w <= 0) continue;
      for (let s = 0; s <= w; s += 0.5) { m.set(X0 + s * ca, 27 + s * sa, z, lac); m.set(X0 + s * ca - sa, 27 + s * sa + ca * 0.6, z, lacL); }
    }
    m.line(X0 + W - 6, 26, 20, X0 + (W - 8) * ca, 27 + (W - 8) * sa - 1, 20, gold, 0.5);
    m.box(X0 + 10, 27, ZF - 3, X0 + 28, 33, ZF - 3, lac);
    m.box(X0 + 12, 28, ZF - 2, X0 + 26, 32, ZF - 2, paper);
    for (const y of [29, 31]) m.box(X0 + 13, y, ZF - 2, X0 + 25, y, ZF - 2, ink);
  }
  // Bench.
  m.box(X0 + 12, 8, KZ1 + 4, X0 + 26, 10, KZ1 + 9, lac);
  m.box(X0 + 12, 11, KZ1 + 4, X0 + 26, 11, KZ1 + 9, velvet);
  for (const [bx, bz] of [[X0 + 13, KZ1 + 5], [X0 + 25, KZ1 + 5], [X0 + 13, KZ1 + 8], [X0 + 25, KZ1 + 8]]) m.box(bx, 0, bz, bx, 7, bz, lac);
  return { m, yaw: 30, pitch: 28, ground: [X0 + W / 2, 0, 30], anchors: { lid: [X0 + 22, 40, 22], keys: [X0 + W / 2, 18, KZ0 + 3] } };
});

// Retro TV screen pictures per frame: 0 off, 1-2 static, 3 colour bars, 4-5 fish show.
const TV_BARS = ['#f4f4f4', '#f4e04a', '#4ae0f0', '#4ad84a', '#e84ae0', '#e84a4a', '#4a5ae8'];
def('retro_tv', {
  name: 'Retro TV', biome: 'aquarium', tags: ['retro', 'screen', 'glow'], decor: { price: 260, size: 1 }, decorOnly: true,
  desc: 'Only gets one channel: fish. The fish love it.',
  interact: {
    verb: 'Switch on', frames: 6, seq: [1, 2, 1, 2, 3, 3, 4, 5, 4, 5, 4, 5, 4, 5, 1, 0], fps: 5,
    sfx: [['crt_on', 0], ['static_burst', 0.1, { vol: 0.6 }], ['blub', 1.3, { pitch: 1.2 }], ['blub', 1.9, { pitch: 1.4 }]],
    fx: [{ at: 0.05, kind: 'sparkle', from: 'screen', n: 6, colors: ['#ffffff', '#c8f8ff'] }],
    fish: 'gather', use: { kind: 'watch', at: 'front', seq: [4, 5], fps: 3 },
  },
}, ({ frame }) => {
  const m = new VoxelModel(48, 60, 38);
  const wood = m.color('#8a5632', { jitter: 0.05 });
  const woodD = m.color('#6e4228', { jitter: 0.05 });
  const bezel = m.color('#e8dcc0', { jitter: 0.03, smooth: 0.3 });
  const knob = m.color('#2a2628', { smooth: 0.6, spec: 1 });
  const chrome = m.color('#c8d0dc', { spec: 2, smooth: 0.5 });
  const grille = m.color('#4a3a30', { jitter: 0.02 });
  const glass = m.color('#2a3e3a', { spec: 2.2, specPow: 10, jitter: 0.02 });
  const glint = m.color('#5a7a74', { spec: 1, jitter: 0 });
  const leaf = m.color('#5ab85a', { smooth: 0.4 });
  const pot = m.color('#d8704a', { smooth: 0.5 });
  const em = (c) => m.color(c, { emissive: 0.95, jitter: 0 });
  const stat = ['#f2f6f6', '#a8b4b8', '#5a6670', '#2a3038'].map(em);
  const bars = TV_BARS.map(em);
  const sea = [em('#2a7ad0'), em('#3a9ae0'), em('#5ac0f0')];
  const fishC = [em('#ff8a2a'), em('#ffd04a'), em('#1a1a2a'), em('#ffffff')];
  // Splayed legs and cabinet with wood grain.
  for (const [x, z, dx, dz] of [[9, 9, -2, -2], [38, 9, 2, -2], [9, 26, -2, 2], [38, 26, 2, 2]]) m.line(x + dx, 0, z + dz, x, 9, z, woodD, 0.9);
  rbox(m, 4, 9, 6, 43, 42, 29, 3, (x, y) => (y % 3 === 0 ? woodD : wood));
  m.box(6, 11, 30, 41, 40, 30, bezel);
  // Screen: slightly bulging rounded rectangle.
  const sx0 = 8, sx1 = 30, sy0 = 14, sy1 = 37;
  const scr = (x, y) => {
    const u = (x - sx0) / (sx1 - sx0), v = (y - sy0) / (sy1 - sy0);
    if (frame === 0) return (u + v > 1.1 && u + v < 1.3) || (u + v > 1.4 && u + v < 1.48) ? glint : glass;
    if (frame <= 2) return stat[Math.floor(h3(x, y, frame, 9) * 4)];
    if (frame === 3) return v < 0.75 ? bars[Math.min(6, Math.floor(u * 7))] : bars[6 - Math.min(6, Math.floor(u * 7))];
    const fx = 0.3 + (frame === 5 ? 0.25 : 0), fy = 0.5 + (frame === 5 ? 0.06 : 0);
    const du = (u - fx) / 0.2, dv = (v - fy) / 0.13;
    if (du * du + dv * dv < 1) return Math.abs(du - 0.25) < 0.18 ? fishC[3] : du > 0.45 && dv > -0.1 && dv < 0.4 && du < 0.75 ? fishC[2] : fishC[0];
    if (u < fx - 0.15 && u > fx - 0.32 && Math.abs(v - fy) < (fx - 0.15 - u) * 1.2) return fishC[1];
    if (h3(x, Math.floor(y + frame * 3), 4, 3) < 0.03) return fishC[3];
    return sea[Math.min(2, Math.floor((1 - v) * 3))];
  };
  for (let y = sy0; y <= sy1; y++) for (let x = sx0; x <= sx1; x++) {
    const ex = Math.min(x - sx0, sx1 - x), ey = Math.min(y - sy0, sy1 - y);
    if (ex + ey < 2) continue;
    m.set(x, y, 31, scr(x, y));
    if (ex > 3 && ey > 3) m.set(x, y, 32, scr(x, y));
  }
  // Knobs, speaker grille, antenna and a little plant on top.
  for (const ky of [33, 27]) { m.cylinder(36, ky, 31, 32, 2.2, knob, 'z'); m.set(36, ky + 1, 33, chrome); }
  for (let y = 14; y <= 22; y += 2) m.box(33, y, 31, 39, y, 31, grille);
  m.line(24, 43, 16, 13, 57, 12, chrome, 0.5);
  m.line(24, 43, 16, 37, 56, 19, chrome, 0.5);
  m.sphere(13, 57, 12, 1.3, chrome);
  m.sphere(37, 56, 19, 1.3, chrome);
  m.box(22, 43, 14, 26, 44, 18, knob);
  lathe(m, 10, 13, 43, 47, (t) => 2.6 + t * 0.6, pot);
  for (let k = 0; k < 5; k++) { const a = k * 1.3; m.line(10, 47, 13, 10 + Math.cos(a) * 4, 52 + (k % 2) * 2, 13 + Math.sin(a) * 3, leaf, 0.6); }
  return { m, yaw: 30, ground: [24, 0, 18], anchors: { screen: [19, 26, 33], front: [22, 22, 46] } };
});

def('bathtub', {
  name: 'Bubble Bath', biome: 'aquarium', tags: ['dumb', 'home'], decor: { price: 380, size: 2 }, decorOnly: true,
  desc: 'A clawfoot tub brimming with foam and suspiciously many rubber ducks.',
  interact: {
    verb: 'Splash', frames: 3, idle: [0, 1], idleFps: 0.9, seq: [1, 2, 1, 2, 1, 2, 0], fps: 5,
    sfx: [['squeak', 0, { pitch: 1.2 }], ['squeak', 0.25, { pitch: 1 }], ['squeak', 0.5, { pitch: 1.4 }], ['bubbles', 0.1]],
    fx: [{ at: 0.1, kind: 'bubbles', from: 'foam', n: 16 }, { at: 0.5, kind: 'foam', from: 'foam', n: 12 }],
    fish: 'gather', use: { kind: 'sit', at: 'water' },
  },
}, ({ frame }) => {
  const m = new VoxelModel(66, 44, 42);
  const enamel = m.color('#f6aac4', { smooth: 0.75, spec: 1.1, jitter: 0.03 });
  const white = m.color('#fbf8f4', { smooth: 0.7, spec: 0.9, jitter: 0.02 });
  const gold = m.color('#e8b848', { spec: 1.6, smooth: 0.5 });
  const chrome = m.color('#d0d8e2', { spec: 2.2, smooth: 0.5 });
  const water = m.color('#7ad0f0', { emissive: 0.2, smooth: 0.4 });
  const foam = [m.color('#ffffff', { smooth: 0.9, jitter: 0.02 }), m.color('#e8f4fc', { smooth: 0.9, jitter: 0.02 })];
  const yel = m.color('#ffd23a', { smooth: 0.85, spec: 1.4 });
  const beak = m.color('#ff8a2a', { smooth: 0.6 });
  const eye = m.color('#1a1a22', { jitter: 0 });
  const mat = [m.color('#5ab0e8', { jitter: 0.04 }), m.color('#f4f8fc', { jitter: 0.03 })];
  const stream = m.color('#c8f4ff', { emissive: 0.5, jitter: 0 });
  const cx = 32, cz = 20, rx = 24, rz = 12;
  const lvl = (x, z, k = 1) => Math.pow(Math.abs(x - cx) / (rx * k), 2.6) + Math.pow(Math.abs(z - cz) / (rz * k), 2);
  shape(m, cx - rx, 6, cz - rz, cx + rx, 23, cz + rz, (x, y, z) => lvl(x, z, 1 + (y - 6) * 0.004) <= 1 && y >= 6 + 3.5 * Math.pow(Math.abs(x - cx) / rx, 3), (x, y) => (y >= 21 ? white : enamel));
  m.sub(() => shape(m, cx - rx, 9, cz - rz, cx + rx, 23, cz + rz, (x, y, z) => lvl(x, z, 0.86) <= 1, 1));
  shape(m, cx - rx, 18, cz - rz, cx + rx, 18, cz + rz, (x, y, z) => lvl(x, z, 0.86) <= 1, water);
  // Feet.
  for (const [fx, fz] of [[cx - 17, cz - 7], [cx + 17, cz - 7], [cx - 17, cz + 7], [cx + 17, cz + 7]]) {
    m.ellipsoid(fx, 4, fz, 2.4, 3.6, 2.4, gold);
    m.ellipsoid(fx + Math.sign(fx - cx) * 1.5, 1, fz + Math.sign(fz - cz) * 1.2, 2.4, 1.2, 2.2, gold);
  }
  // Foam heap (grows with the frame) and the duck flotilla.
  const N = 26 + frame * 8;
  for (let i = 0; i < N; i++) {
    const a = h3(i, 1, 2, 3) * Math.PI * 2, r = Math.sqrt(h3(i, 2, 2, 3)) * 0.8;
    const x = cx + Math.cos(a) * r * rx * 0.86, z = cz + Math.sin(a) * r * rz * 0.86;
    const y = 19 + (1 - r) * (4 + frame * 1.5) + h3(i, 3, 2, 3) * 2;
    m.sphere(x, y, z, 1.6 + h3(i, 4, 2, 3) * 2.2 + frame * 0.2, foam[i % 2]);
  }
  const bobY = [0, 1, 2][frame];
  miniDuck(m, cx - 9, 22 + bobY, cz + 3, 1, yel, beak, eye, 1);
  miniDuck(m, cx + 6, 23 + (2 - bobY), cz - 2, 0.85, yel, beak, eye, -1);
  miniDuck(m, cx + 1 + frame, 24 + bobY, cz + 6, 0.75, yel, beak, eye, 1);
  // Faucet with a stream on the busiest frame.
  m.tube([[5, 12, cz, 1.1], [5, 26, cz, 1.1], [9, 28, cz, 1.1], [12, 26, cz, 1]], chrome, 4);
  for (const s of [-1, 1]) m.sphere(5, 23, cz + s * 2.6, 1.3, chrome);
  if (frame === 2) m.line(12, 25, cz, 13, 19, cz, stream, 0.6);
  m.box(cx - 10, 0, 34, cx + 10, 0, 40, (x) => mat[x % 4 < 2 ? 0 : 1]);
  const inner = new Set([water, foam[0], foam[1], yel, beak, eye, stream]);
  const front = (x, y, z) => z + 0.5 > cz - 1 && !inner.has(m.get(x, y, z));
  return { m, yaw: 30, ground: [cx, 0, cz + 4], front, anchors: { water: [cx + 2, 21, cz], foam: [cx, 26, cz] } };
});

def('traffic_cone', {
  name: 'Traffic Cone', biome: 'aquarium', tags: ['dumb', 'junk'], decor: { price: 25, size: 1 }, decorOnly: true,
  desc: 'Marks the spot where absolutely nothing is happening.',
  interact: {
    verb: 'Bonk', frames: 3, seq: [1, 2, 1, 2, 1, 0], fps: 10,
    sfx: [['boing', 0, { pitch: 0.7 }], ['mash_pop', 0.08]],
    fx: [{ at: 0, kind: 'text', from: 'top', text: 'BONK' }, { at: 0, kind: 'burst', from: 'base', n: 8, colors: ['#e8cf96', '#d8ba80'] }],
    fish: 'flee',
  },
}, ({ frame }) => {
  const m = new VoxelModel(44, 46, 32);
  const P = part(m, 30, 44, 30);
  const rub = m.color('#2a2a30', { jitter: 0.04 });
  const orange = m.color('#ff7a1a', { smooth: 0.5, spec: 0.7, jitter: 0.03 });
  const refl = m.color('#f6f6f2', { emissive: 0.15, spec: 1.4, jitter: 0.02 });
  rbox(P, 3, 0, 3, 26, 2, 26, 1.4, rub);
  lathe(P, 15, 15, 3, 38, (t) => 9.6 - t * 8.2, (x, y) => ((y >= 12 && y <= 16) || (y >= 23 && y <= 26) ? refl : orange));
  P.sphere(15, 38.5, 15, 1.6, orange);
  const rz = [0, 13, -13][frame], pv = frame === 2 ? [27, 0, 15] : [3, 0, 15];
  stampRot(m, P, pv, [pv[0] + 7, 0, 16], 0, 0, rz);
  sandMound(m, 22, 16, 15, 14, 1, 2);
  const tip = xformPt([15, 39, 15], pv, [pv[0] + 7, 0, 16], 0, 0, rz);
  return { m, yaw: 30, ground: [22, 0, 16], anchors: { top: tip, base: [22, 2, 26] } };
});

def('phone_booth', {
  name: 'Phone Booth', biome: 'aquarium', tags: ['dumb', 'glow', 'build'], decor: { price: 450, size: 2 }, decorOnly: true,
  desc: 'It rings. Nobody ever answers. It is always for the crab.',
  interact: {
    verb: 'Ring', frames: 3, seq: [1, 0, 1, 0, 1, 0, 2, 2, 2, 2, 2, 1, 0], fps: 5,
    sfx: [['bell', 0, { pitch: 1.5 }], ['bell', 0.12, { pitch: 1.5 }], ['bell', 0.42, { pitch: 1.5 }], ['bell', 0.54, { pitch: 1.5 }], ['bell', 0.84, { pitch: 1.5 }], ['click', 1.25]],
    fx: [{ at: 0, kind: 'text', from: 'top', text: 'RING!' }, { at: 1.25, kind: 'sparkle', from: 'door', n: 6 }],
    shake: 1.2, fish: 'gather', use: { kind: 'hide', at: 'door', seq: [2, 2], fps: 2 },
  },
}, ({ frame }) => {
  const m = new VoxelModel(52, 84, 66);
  const red = m.color('#d8282a', { spec: 0.7, jitter: 0.03 });
  const redD = m.color('#a81e24', { jitter: 0.03 });
  const con = m.color('#a8a49c', { jitter: 0.06 });
  const lit = frame > 0;
  const glass = m.color(lit ? '#ffe8a0' : '#2c4a68', lit ? { emissive: 0.75, jitter: 0.02 } : { spec: 2, specPow: 10, jitter: 0.02 });
  const sign = m.color('#f4f4ec', { emissive: 0.6, jitter: 0 });
  const ink = m.color('#2a2a32', { jitter: 0 });
  const chrome = m.color('#c8d0dc', { spec: 2 });
  const lamp = m.color('#fff0b0', { emissive: 1, jitter: 0 });
  const phone = m.color('#1e1c22', { spec: 1 });
  const X0 = 8, X1 = 35, Z0 = 8, Z1 = 35, Y0 = 3, Y1 = 66;
  m.box(X0 - 3, 0, Z0 - 3, X1 + 3, 2, Z1 + 3, con);
  // One wall panel: kick plate, glazing grid, sign band.
  const panel = (u, y) => {
    if (y < 10) return u % 9 === 0 ? redD : red;
    if (y > 59) return y === 60 || y === 66 ? red : (y >= 62 && y <= 64 && u > 3 && u < 25 && (u % 3 !== 0 || y === 63)) ? ink : sign;
    if ((u - 2) % 7 === 0 || (y - 10) % 7 === 0 || u < 2 || u > 25) return red;
    return glass;
  };
  for (let y = Y0; y <= Y1; y++) for (let u = 0; u <= X1 - X0; u++) {
    m.set(X0 + u, y, Z0, panel(u, y));
    m.set(X0, y, Z0 + u, panel(u, y));
    m.set(X1, y, Z0 + u, panel(u, y));
    if (frame < 2) m.set(X0 + u, y, Z1, panel(u, y));
  }
  // Door swings open on frame 2 (hinged at the right edge).
  if (frame === 2) {
    const a = 1.35, ca = Math.cos(a), sa = Math.sin(a);
    for (let y = Y0; y <= Y1; y++) for (let d = 0; d <= X1 - X0; d += 0.5) m.set(X0 + d * ca, y, Z1 + d * sa, panel(Math.round(d), y));
    m.box(X0 + 8, 34, Z0 + 1, X0 + 12, 42, Z0 + 3, phone);
    m.line(X0 + 10, 34, Z0 + 3, X0 + 13, 26, Z0 + 8, phone, 0.6);
    m.box(X0 + 12, 24, Z0 + 7, X0 + 15, 26, Z0 + 9, phone);
  } else m.box(X0 + 3, 34, Z1 + 1, X0 + 3, 38, Z1 + 1, chrome);
  for (const [x, z] of [[X0, Z0], [X1, Z0], [X0, Z1], [X1, Z1]]) m.box(x - 1, Y0, z - 1, x + 1, Y1 + 1, z + 1, red);
  // Crown roof with a little lamp.
  m.box(X0 - 2, Y1 + 1, Z0 - 2, X1 + 2, Y1 + 3, Z1 + 2, red);
  shape(m, X0 - 1, Y1 + 4, Z0 - 1, X1 + 1, Y1 + 10, Z1 + 1, (x, y, z) => ((x - 21.5) / 15) ** 2 + ((y - Y1 - 3) / 7) ** 2 + ((z - 21.5) / 15) ** 2 <= 1, red);
  m.box(20, Y1 + 10, 20, 23, Y1 + 13, 23, lamp);
  m.box(19, Y1 + 14, 19, 24, Y1 + 14, 24, red);
  return { m, yaw: 30, ground: [21.5, 0, 21.5], light: '#ffe8a0', anchors: { door: [24, 22, 40], top: [21.5, 80, 21.5] } };
});

def('mini_volcano', {
  name: 'Mini Volcano', biome: 'aquarium', tags: ['glow', 'rock'], decor: { price: 480, size: 2 }, decorOnly: true,
  desc: 'A real, tiny, slightly dangerous volcano. Comes with its own palm tree.',
  interact: {
    verb: 'Erupt', frames: 4, seq: [1, 1, 2, 3, 2, 3, 2, 3, 2, 1, 0], fps: 5,
    sfx: [['roar', 0, { pitch: 0.55, vol: 0.6 }], ['thunder', 0.3, { vol: 0.55 }], ['puff', 0.5], ['puff', 0.95]],
    fx: [{ at: 0.1, kind: 'smoke', from: 'crater', n: 10 }, { at: 0.35, kind: 'lava', from: 'crater', n: 24 }, { at: 0.8, kind: 'lava', from: 'crater', n: 18 }, { at: 1.25, kind: 'lava', from: 'crater', n: 12 }],
    ambient: [{ kind: 'smoke', from: 'crater', every: 2.8, n: 2 }], shake: 0.8, fish: 'flee',
  },
}, ({ frame }) => {
  const m = new VoxelModel(66, 62, 58);
  const rock = ['#5a4a4c', '#4a3c42', '#6c5a54', '#7a4a3a'].map((c) => m.color(c, { jitter: 0.12, smooth: 0.4 }));
  const ash = m.color('#3a3036', { jitter: 0.08 });
  const glowC = frame === 0 ? m.color('#b8482a', { emissive: 0.45, jitter: 0.04 }) : m.color('#ffb03a', { emissive: 1, jitter: 0.03 });
  const lava = m.color('#ff7a1a', { emissive: 1, jitter: 0.04 });
  const core = m.color('#ffe46a', { emissive: 1, jitter: 0.02 });
  const crack = m.color('#ff5a2a', { emissive: 0.9, jitter: 0 });
  const trunk = m.color('#9a6a3a', { jitter: 0.05 });
  const leaf = [m.color('#4ab85a', { smooth: 0.3 }), m.color('#7ad86a', { smooth: 0.3 })];
  const cx = 34, cz = 28, seed = 11;
  const Rat = (y, a) => 27 - y * 0.5 + (noise3(Math.cos(a) * 2 + 5, y * 0.12, Math.sin(a) * 2, seed) - 0.5) * 7;
  shape(m, 0, 0, 0, 65, 44, 57, (x, y, z) => {
    const dx = x - cx, dz = z - cz, r = Math.hypot(dx, dz);
    if (y > 41) return false;
    if (r > Rat(y, Math.atan2(dz, dx))) return false;
    return !(y > 33 && r < (y - 33) * 0.75 + 3.5);
  }, (x, y, z) => (y > 34 && h3(x, y, z, 2) < 0.4 ? rock[3] : rock[Math.floor(fbm3(x * 0.15, y * 0.15, z * 0.15, 2, seed) * 2.99 * 1.2) % 3]));
  // Crater pool, glowing cracks, lava streams growing down the visible flanks.
  shape(m, cx - 9, 33, cz - 9, cx + 9, 35, cz + 9, (x, y, z) => Math.hypot(x - cx, z - cz) < 4 + (y - 33) * 0.75, (x, y, z, p) => (p ? null : glowC));
  m.recolor((x, y, z, p) => (y > 32 && Math.hypot(x + 0.5 - cx, z + 0.5 - cz) < 8 && m.exposed(x, y, z) && p !== glowC ? ash : null));
  if (frame >= 1) surface(m, (x, y, z, p) => (y < 30 && y > 3 && h3(x, y, z, 7) < 0.025 && p !== glowC ? crack : null));
  if (frame >= 2) {
    const reach = frame === 2 ? 22 : 6;
    for (const a0 of [0.35, 1.05, 1.7]) {
      const pts = [];
      for (let y = 38; y >= reach; y -= 1) {
        const a = a0 + Math.sin(y * 0.2 + a0 * 3) * 0.12, r = Rat(y, a) - 0.4;
        pts.push([cx + Math.cos(a) * r, y, cz + Math.sin(a) * r]);
      }
      m.recolor((x, y, z, p) => {
        if (y < reach - 1 || y > 40 || !m.exposed(x, y, z)) return null;
        for (const q of pts) { const d = Math.hypot(x + 0.5 - q[0], y + 0.5 - q[1], z + 0.5 - q[2]); if (d < 2.2) return d < 1.1 ? core : lava; }
        return null;
      });
    }
    // Fountain of lava blobs above the crater.
    const top = frame === 2 ? 58 : 52;
    for (let i = 0; i < 12; i++) {
      const t = i / 11, y = 40 + t * (top - 40);
      m.sphere(cx + Math.sin(i * 2.1) * (1 + t * 3), y, cz + Math.cos(i * 1.7) * (1 + t * 2), 2.6 - t * 1.2 + h3(i, frame, 1, 2), t < 0.5 ? core : lava);
    }
  }
  // A tiny palm tree on the beach.
  const px = 9, pz = 46;
  sandMound(m, px + 2, pz - 2, 9, 8, 2, 3);
  const tp = [[px, 1, pz, 1.4], [px + 1, 8, pz, 1.2], [px + 3, 15, pz - 1, 1.1], [px + 6, 20, pz - 1, 1]];
  m.tube(tp, trunk, 3);
  for (let k = 0; k < 6; k++) {
    const a = k * 1.05;
    m.tube([[px + 6, 21, pz - 1, 0.9], [px + 6 + Math.cos(a) * 4, 23, pz - 1 + Math.sin(a) * 4, 0.8], [px + 6 + Math.cos(a) * 8, 19, pz - 1 + Math.sin(a) * 8, 0.6]], leaf[k % 2], 3);
  }
  m.sphere(px + 6, 20, pz, 1.3, trunk);
  return { m, yaw: 30, ground: [cx, 0, cz], light: '#ff9a3a', anchors: { crater: [cx, 42, cz] } };
});

def('windmill', {
  name: 'Windmill', biome: 'aquarium', tags: ['build'], decor: { price: 420, size: 2 }, decorOnly: true,
  desc: 'Powered entirely by current. Grinds absolutely nothing. Very peaceful.',
  interact: {
    verb: 'Spin', frames: 4, idle: [0, 1, 2, 3], idleFps: 3, seq: Array.from({ length: 24 }, (_, i) => i % 4), fps: 16,
    sfx: [['travel_whoosh', 0, { vol: 0.35, pitch: 1.3 }], ['bubbles', 0.3]],
    fx: [{ at: 0.1, kind: 'bubbles', from: 'hub', n: 12 }, { at: 0.7, kind: 'bubbles', from: 'hub', n: 10 }],
    fish: 'gather', use: { kind: 'orbit', at: 'hub' },
  },
}, ({ frame, rng }) => {
  const m = new VoxelModel(64, 98, 48);
  const plaster = m.color('#f2e8d4', { jitter: 0.05, smooth: 0.3 });
  const plasterD = m.color('#dccfb6', { jitter: 0.05 });
  const stone = m.color('#9a948c', { jitter: 0.1 });
  const thatch = [m.color('#8a5a34', { jitter: 0.06 }), m.color('#6e4428', { jitter: 0.06 })];
  const wood = m.color('#7a4a2a', { jitter: 0.04 });
  const lattice = m.color('#c89a60', { jitter: 0.03 });
  const cloth = m.color('#f8f0de', { jitter: 0.03, smooth: 0.2 });
  const win = m.color('#ffd86a', { emissive: 0.8, jitter: 0.02 });
  const tul = ['#ff4a5a', '#ffd84a', '#ff8ad0'].map((c) => m.color(c, { smooth: 0.6 }));
  const stem = m.color('#4aa84a', { jitter: 0 });
  const cx = 32, cz = 20;
  sandMound(m, cx, cz + 6, 26, 20, 2, 5);
  const oct = (x, z, r) => { const dx = Math.abs(x - cx), dz = Math.abs(z - cz); return Math.max(dx, dz, (dx + dz) * 0.7071) <= r; };
  shape(m, cx - 14, 0, cz - 14, cx + 14, 58, cz + 14, (x, y, z) => oct(x, z, 12.5 - y * 0.07), (x, y) => (y < 6 ? stone : y % 6 === 0 ? plasterD : plaster));
  // Door and windows on the front.
  m.box(cx - 3, 6, cz + 11, cx + 2, 15, cz + 13, wood);
  m.box(cx - 2, 16, cz + 11, cx + 1, 16, cz + 12, wood);
  for (const wy of [28, 42]) { m.box(cx - 2, wy, cz + 9, cx + 1, wy + 4, cz + 11, wood); m.box(cx - 1, wy + 1, cz + 11, cx, wy + 3, cz + 11, win); }
  m.box(cx + 9, 34, cz - 1, cx + 10, 37, cz + 1, win);
  // Thatched cap.
  shape(m, cx - 12, 56, cz - 12, cx + 12, 72, cz + 12, (x, y, z) => ((x - cx) / 11) ** 2 + ((y - 56) / 15) ** 2 + ((z - cz) / 11) ** 2 <= 1, (x, y) => thatch[(y >> 1) % 2]);
  // Hub and four lattice sails at the current angle.
  const hy = 62, hz = cz + 13;
  m.cylinder(cx, hy, cz + 8, hz + 1, 2.4, wood, 'z');
  m.cylinder(cx, hy, hz + 2, hz + 2, 1.6, lattice, 'z');
  for (let k = 0; k < 4; k++) {
    const a = frame * (Math.PI / 8) + k * (Math.PI / 2) + 0.3;
    const ca = Math.cos(a), sa = Math.sin(a);
    m.line(cx, hy, hz + 2, cx + ca * 31, hy + sa * 31, hz + 2, wood, 0.7);
    for (let s = 6; s <= 30; s += 0.5) for (let w = 0.5; w <= 6.5; w += 0.5) {
      const x = cx + ca * s - sa * w, y = hy + sa * s + ca * w;
      const lat = Math.abs(s % 3) < 0.5 || w < 1 || w > 6;
      m.set(x, y, hz + 1, lat ? lattice : cloth);
    }
  }
  // Tulips around the base.
  for (let i = 0; i < 7; i++) {
    const a = 0.4 + i * 0.42, r = 17 + rng.float(-1, 2);
    const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
    m.line(x, 1, z, x, 5, z, stem, 0);
    m.box(x - 0.5, 5, z - 0.5, x + 0.5, 6, z + 0.5, tul[i % 3]);
  }
  return { m, yaw: 30, ground: [cx, 0, cz], anchors: { hub: [cx, hy, hz + 3], top: [cx, 74, cz] } };
});

def('drawbridge_keep', {
  name: 'Drawbridge Keep', biome: 'aquarium', tags: ['build', 'glow', 'swimthrough'], decor: { price: 900, size: 3 }, decorOnly: true,
  desc: 'A proper stone keep with a moat and a working drawbridge. Fish only.',
  interact: {
    verb: 'Lower bridge', frames: 3, seq: [1, 2, 2, 2, 2, 2, 2, 2, 2, 1, 0], fps: 3,
    sfx: [['treasure_open', 0, { pitch: 0.7 }], ['box_close', 0.62, { pitch: 0.7 }], ['ui_unlock', 0.9], ['box_close', 3.4, { pitch: 0.8 }]],
    fx: [{ at: 0.65, kind: 'burst', from: 'gate', n: 10, colors: ['#c8b090', '#e8d8b0'] }, { at: 0.95, kind: 'confetti', from: 'top', n: 20 }],
    fish: 'gather', use: { kind: 'hide', at: 'gate', seq: [1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 1], fps: 3 },
  },
}, ({ frame, rng }) => {
  const m = new VoxelModel(86, 86, 74);
  const st = CASTLE_STONE.map((c) => m.color(c, { jitter: 0.08 }));
  const mortar = m.color('#7c7492', { jitter: 0.04 });
  const tex = masonry(m, st, mortar);
  const dark = m.color('#1e1828', { jitter: 0.02 });
  const water = m.color('#3a9ad0', { emissive: 0.12, smooth: 0.5, jitter: 0.03 });
  const plank = [m.color('#8a5634', { jitter: 0.06 }), m.color('#6e4428', { jitter: 0.06 })];
  const iron = m.color('#3a3a44', { spec: 1, jitter: 0.03 });
  const chainC = m.color('#9aa0ac', { spec: 1.2 });
  const banner = m.color('#d83a4a', { jitter: 0.04 }), gold = m.color('#f2c84a', { spec: 1.2 });
  const torch = m.color('#ffb84a', { emissive: 1, jitter: 0 });
  const slit = m.color('#ffd86a', { emissive: 0.8, jitter: 0 });
  const rk = reefRock(m, rng);
  // Rock platform with a moat in front.
  facetRock(m, rng, 43, 3, 34, 42, 7, 34, rk[0], 16);
  stoneTex(m, rk, 6);
  m.sub(() => m.box(24, 3, 54, 62, 9, 66));
  m.box(24, 3, 54, 62, 4, 66, water);
  // Walls, front towers, keep, central tower.
  m.box(12, 6, 12, 74, 34, 52, tex);
  for (let x = 12; x <= 74; x++) for (const z of [12, 52]) if (x % 4 < 2) m.box(x, 35, z, x, 37, z, st[2]);
  for (let z = 12; z <= 52; z++) for (const x of [12, 74]) if (z % 4 < 2) m.box(x, 35, z, x, 37, z, st[2]);
  for (const tx of [22, 64]) {
    m.cylinder(tx, 52, 4, 48, 8, tex);
    m.cylinder(tx, 52, 48, 50, 9.4, st[2]);
    for (let k = 0; k < 10; k++) if (k % 2) { const a = (k / 10) * Math.PI * 2; m.box(tx + Math.cos(a) * 8.6, 51, 52 + Math.sin(a) * 8.6, tx + Math.cos(a) * 8.6, 53, 52 + Math.sin(a) * 8.6, st[2]); }
    m.box(tx - 1, 30, 60, tx, 34, 60, slit);
    // Banner.
    m.box(tx - 3, 22, 61, tx + 2, 42, 61, (x, y) => (Math.abs(x - tx + 0.5) < 1 ? gold : banner));
    for (let x = tx - 3; x <= tx + 2; x++) m.set(x, 21 - (Math.abs(x - tx + 0.5) < 1.5 ? 1 : 0), 61, banner);
  }
  m.box(30, 34, 18, 56, 60, 38, tex);
  for (let x = 30; x <= 56; x++) for (const z of [18, 38]) if (x % 4 < 2) m.box(x, 61, z, x, 63, z, st[2]);
  m.cylinder(43, 28, 60, 74, 6, tex);
  m.cone(43, 28, 75, 84, 7.5, 0.5, (x, y) => (y % 3 ? banner : gold));
  for (const wx of [36, 48]) m.box(wx, 46, 39, wx + 1, 51, 39, slit);
  // Gate with portcullis (raised on frame 2).
  m.sub(() => { m.box(36, 6, 46, 50, 24, 53); m.cylinder(43, 50, 24, 27, 7, 0, 'y'); });
  m.box(36, 6, 46, 50, 27, 46, dark);
  const pcY = frame === 2 ? 21 : 6;
  for (let x = 37; x <= 49; x += 3) m.box(x, pcY, 51, x, 26, 51, iron);
  for (let y = pcY + 2; y <= 26; y += 4) m.box(36, y, 51, 50, y, 51, iron);
  // Drawbridge hinged at the gate sill: up / half / down.
  const ang = [Math.PI / 2, Math.PI / 4, 0][frame], cs = Math.cos(ang), sn = Math.sin(ang);
  const L = 14;
  for (let u = 0; u <= L; u += 0.5) for (let t = 0; t <= 1.5; t += 0.5) for (let x = 36; x <= 50; x++) {
    const y = 6 + u * sn + t * cs, z = 53 + u * cs - t * sn;
    m.set(x, y, z, (Math.abs(u - 2) < 0.6 || Math.abs(u - 12) < 0.6) && t > 1 ? iron : plank[x % 3 === 0 ? 1 : 0]);
  }
  const ex = 6 + L * sn, ez = 53 + L * cs;
  m.line(35, 26, 53, 36, ex, ez, chainC, 0.5);
  m.line(51, 26, 53, 50, ex, ez, chainC, 0.5);
  for (const tx of [32, 54]) { m.box(tx, 18, 55, tx, 21, 55, plank[1]); m.box(tx, 22, 55, tx, 23, 55, torch); }
  moss(m, rng, 3, MOSS, 0.3, 0.2, [...rk]);
  return { m, yaw: 30, vs: 1.5, ground: [43, 0, 38], light: '#ffd86a', anchors: { gate: [43, 12, 60], top: [43, 84, 28] } };
});

def('dance_robot', {
  name: 'Disco Robot', biome: 'aquarium', tags: ['machine', 'glow', 'party'], decor: { price: 340, size: 1 }, decorOnly: true,
  desc: 'A wind-up tin robot with exactly four dance moves. All of them bangers.',
  interact: {
    verb: 'Dance', frames: 4, seq: [1, 2, 1, 2, 3, 0, 3, 0, 1, 2, 1, 2, 3, 0], fps: 6,
    sfx: [['glitch', 0, { vol: 0.35 }], ['click', 0.17], ['click', 0.5], ['click', 0.83], ['click', 1.17], ['chirp', 0.33, { pitch: 0.8 }], ['chirp', 1.0, { pitch: 1 }], ['chirp', 1.67, { pitch: 1.2 }]],
    fx: [{ at: 0.2, kind: 'notes', from: 'head', n: 2 }, { at: 1.0, kind: 'notes', from: 'head', n: 2 }, { at: 1.6, kind: 'sparkle', from: 'chest', n: 6 }],
    fish: 'dance', use: { kind: 'dance', at: 'chest', seq: [1, 2, 1, 2, 3, 0, 3, 0], fps: 4 },
  },
}, ({ frame }) => {
  const m = new VoxelModel(50, 68, 32);
  const tin = m.color('#d8463a', { spec: 1.3, specPow: 14, smooth: 0.3, jitter: 0.03 });
  const tinB = m.color('#3a7ad8', { spec: 1.3, specPow: 14, smooth: 0.3, jitter: 0.03 });
  const steel = m.color('#b8c0cc', { spec: 1.8, smooth: 0.6 });
  const dark = m.color('#2a2a34', { jitter: 0.03 });
  const gold = m.color('#f2c84a', { spec: 1.2 });
  const eyeC = m.color(frame % 2 ? '#ff6ad8' : '#5af4ff', { emissive: 1, jitter: 0 });
  const lights = ['#ff4a5a', '#ffd84a', '#5aff8a', '#5ab8ff'].map((c, i) => m.color(c, { emissive: (i + frame) % 2 ? 1 : 0.2, jitter: 0 }));
  const ant = m.color('#ff4a4a', { emissive: frame % 2 ? 1 : 0.4 });
  const cx = 25, cz = 15;
  const dy = frame === 3 ? 3 : 0;
  // Feet and accordion legs (knees bend on frame 3).
  for (const fx of [18, 32]) {
    m.box(fx - 4, 0, cz - 5, fx + 3, 3, cz + 7, dark);
    for (let y = 4; y < 18 - dy; y++) m.cylinder(fx - 0.5, cz + 1, y, y, y % 2 ? 2.4 : 2, steel);
  }
  // Body with chest panel.
  rbox(m, 12, 18 - dy, 7, 37, 40 - dy, 24, 2.5, tin);
  m.box(15, 22 - dy, 25, 34, 36 - dy, 25, steel);
  for (let i = 0; i < 4; i++) m.box(17 + i * 4, 32 - dy, 26, 18 + i * 4, 33 - dy, 26, lights[i]);
  for (const kx of [19, 29]) m.cylinder(kx, 27 - dy, 26, 26, 2.2, dark, 'z');
  m.set(19, 28 - dy, 27, gold); m.set(30, 27 - dy, 27, gold);
  for (let y = 23; y <= 25; y += 2) m.box(16, y - dy, 26, 33, y - dy, 26, dark);
  // Arms per pose.
  const poses = [[[-3, 21, 4], [3, 21, 4]], [[-3, 21, 4], [6, 54, 3]], [[-6, 54, 3], [3, 21, 4]], [[-8, 52, 4], [8, 52, 4]]];
  for (const s of [0, 1]) {
    const sx = s ? 39.5 : 9.5, sy = 36 - dy;
    const [hx, hy, hz] = poses[frame][s];
    const hand = [sx + hx, hy - dy * 0.5, cz + hz];
    const elbow = [(sx + hand[0]) / 2 + (s ? 2 : -2), (sy + hand[1]) / 2, cz + 2];
    m.sphere(sx, sy, cz, 3, steel);
    m.line(sx, sy, cz, elbow[0], elbow[1], elbow[2], steel, 1.9);
    m.line(elbow[0], elbow[1], elbow[2], hand[0], hand[1], hand[2], steel, 1.7);
    m.sphere(elbow[0], elbow[1], elbow[2], 2.1, dark);
    m.box(hand[0] - 1.5, hand[1] - 1.5, hand[2] - 1, hand[0] + 1.5, hand[1] + 1.5, hand[2] + 1, dark);
  }
  // Head (tilts with the beat) on a neck.
  m.cylinder(cx, cz + 0.5, 40 - dy, 43 - dy, 2.2, steel);
  const H = part(m, 24, 24, 20);
  rbox(H, 2, 0, 2, 21, 13, 17, 2, tinB);
  for (const ex of [7, 15]) { H.cylinder(ex, 8, 17, 18, 2.4, steel, 'z'); H.cylinder(ex, 8, 18, 18, 1.5, eyeC, 'z'); }
  for (let x = 7; x <= 15; x += 2) H.box(x, 3, 18, x, 4, 18, dark);
  for (const ex of [1, 22]) H.cylinder(7, 9, ex === 1 ? 0 : 22, ex === 1 ? 1 : 23, 2, steel, 'x');
  H.line(11, 13, 9, 11, 19, 9, steel, 0);
  H.sphere(11, 20, 9, 1.6, ant);
  const tilt = [0, 9, -9, 0][frame];
  stampRot(m, H, [11.5, 0, 9.5], [cx, 43 - dy, cz], 0, 0, tilt);
  return { m, yaw: 28, ground: [cx, 0, cz + 1], light: '#5af4ff', anchors: { head: [cx, 62, cz], chest: [cx, 28, cz + 10] } };
});

def('ufo', {
  name: 'Little UFO', biome: 'aquarium', tags: ['glow', 'machine'], decor: { price: 650, size: 2 }, decorOnly: true,
  desc: 'Crash-landed. The pilot refuses to leave. Occasionally borrows a fish.',
  interact: {
    verb: 'Beam up', frames: 4, idle: [0, 1], idleFps: 2, seq: [2, 3, 2, 3, 2, 3, 2, 3, 2, 3, 0, 1], fps: 4,
    sfx: [['sonar', 0], ['glitch', 0.3, { vol: 0.45 }], ['magic', 1.2], ['sonar', 2.0, { pitch: 1.3 }]],
    fx: [{ at: 0.2, kind: 'rise', from: 'beam', n: 14, colors: ['#b8ffd0', '#ffffff'] }, { at: 1.0, kind: 'rise', from: 'beam', n: 12, colors: ['#b8ffd0', '#ffffff'] }, { at: 1.8, kind: 'rise', from: 'beam', n: 10, colors: ['#b8ffd0', '#ffffff'] }],
    fish: 'abduct', use: { kind: 'orbit', at: 'dome' },
  },
}, ({ frame }) => {
  const m = new VoxelModel(64, 58, 64);
  const hull = m.color('#c8d0dc', { spec: 2, specPow: 12, smooth: 0.8, jitter: 0.02 });
  const hullD = m.color('#7a8496', { smooth: 0.7, jitter: 0.02 });
  const glass = m.color('#9ae8ff', { spec: 2.5, specPow: 10, smooth: 0.9, light: 0.2, jitter: 0.01 });
  const alien = m.color('#7ad84a', { smooth: 0.6, light: 0.1 });
  const eyeC = m.color('#141822', { jitter: 0 });
  const lc = [m.color('#ff5a8a', { emissive: 1, jitter: 0 }), m.color('#5affd8', { emissive: 1, jitter: 0 }), m.color('#ffe46a', { emissive: 1, jitter: 0 })];
  const beamOn = frame >= 2;
  const emit = m.color('#c8ffe0', { emissive: beamOn ? 1 : 0.4, jitter: 0 });
  const beam = m.color('#7affb8', { emissive: 0.7, jitter: 0 });
  const beam2 = m.color('#e8fff0', { emissive: 1, jitter: 0 });
  const leg = m.color('#8a94a6', { spec: 1 });
  const scorch = m.color('#b89a6a', { jitter: 0.06 });
  const cx = 32, cz = 32, cy = 30;
  sandMound(m, cx, cz, 28, 26, 2, 7);
  m.recolor((x, y, z, p) => { const r = Math.hypot(x + 0.5 - cx, z + 0.5 - cz); return y <= 3 && r > 15 && r < 18 && m.exposed(x, y, z) ? scorch : null; });
  // Landing legs.
  for (const a of [Math.PI / 2, (Math.PI * 7) / 6, (Math.PI * 11) / 6]) {
    m.line(cx + Math.cos(a) * 13, cy - 3, cz + Math.sin(a) * 13, cx + Math.cos(a) * 19, 2, cz + Math.sin(a) * 19, leg, 0.9);
    m.cylinder(cx + Math.cos(a) * 19, cz + Math.sin(a) * 19, 1, 2, 2.2, leg);
  }
  // Saucer lens with a light ring.
  shape(m, cx - 27, cy - 6, cz - 27, cx + 27, cy + 6, cz + 27, (x, y, z) => {
    const r = Math.hypot(x - cx, z - cz) / 26.5;
    return r <= 1 && Math.abs(y - cy) <= 5.4 * Math.pow(1 - r * r, 0.7) + 0.6;
  }, (x, y) => (y < cy ? hullD : hull));
  for (let k = 0; k < 14; k++) {
    const a = (k / 14) * Math.PI * 2;
    m.box(cx + Math.cos(a) * 24.5, cy, cz + Math.sin(a) * 24.5, cx + Math.cos(a) * 25.5, cy + 1, cz + Math.sin(a) * 25.5, lc[(k + frame) % 3]);
  }
  // Dome with the little pilot painted on the glass.
  m.sphere(cx, cy + 3, cz, 10, (x, y, z) => {
    if (y < cy + 3) return null;
    const front = z + 0.5 - cz > 5;
    if (front && Math.abs(x + 0.5 - cx) < 4.5 && y > cy + 5 && y < cy + 13) {
      if ((y === cy + 10 || y === cy + 9) && (Math.abs(x + 0.5 - cx - 2) < 1.2 || Math.abs(x + 0.5 - cx + 2) < 1.2)) return eyeC;
      return alien;
    }
    return glass;
  });
  m.cylinder(cx, cz, cy + 2, cy + 3, 11, hull);
  m.cylinder(cx, cz, cy - 6, cy - 5, 4.5, emit);
  // Tractor beam: a dithered glowing cone shell.
  if (beamOn) {
    for (let y = 3; y <= cy - 7; y++) {
      const R = 4.5 + (cy - 7 - y) * 0.42;
      shape(m, cx - R - 1, y, cz - R - 1, cx + R + 1, y, cz + R + 1, (x, yy, z) => {
        const r = Math.hypot(x - cx, z - cz);
        return r <= R && r > R - 1.3 && (Math.floor(x) + Math.floor(z) * 2 + y + frame) % 3 === 0;
      }, (x, yy, z) => ((x + z + y) % 7 === 0 ? beam2 : beam));
    }
  }
  return { m, yaw: 30, ground: [cx, 0, cz], light: '#9affd8', anchors: { dome: [cx, cy + 12, cz], beam: [cx, 6, cz], under: [cx, cy - 7, cz] } };
});

def('pizza_slice', {
  name: 'Giant Pizza Slice', biome: 'aquarium', tags: ['dumb', 'food'], decor: { price: 120, size: 1 }, decorOnly: true,
  desc: 'Pepperoni, extra cheese, extra soggy. Regrows overnight.',
  interact: {
    verb: 'Nom', frames: 3, seq: [1, 1, 1, 2, 2, 2, 2, 0], fps: 4,
    sfx: [['worm_squish', 0], ['gulp', 0.75], ['grunt', 1.1, { pitch: 1.4 }]],
    fx: [{ at: 0.75, kind: 'food', from: 'tip', n: 6 }, { at: 0.75, kind: 'burst', from: 'tip', n: 10, colors: ['#ffd060', '#e8c890', '#c83a2a'] }],
    fish: 'gather',
  },
}, ({ frame }) => {
  const m = new VoxelModel(60, 30, 54);
  const plate = m.color('#f8f8f4', { smooth: 0.6, spec: 0.6 });
  const plateR = m.color('#d8dce4', { smooth: 0.6 });
  const dough = m.color('#e8c890', { jitter: 0.05 });
  const crust = m.color('#d8954a', { jitter: 0.08, smooth: 0.5 });
  const bake = m.color('#a8642a', { jitter: 0.06 });
  const sauce = m.color('#d8402a', { jitter: 0.04 });
  const cheese = m.color('#ffd060', { jitter: 0.05, smooth: 0.4 });
  const melt = m.color('#ffe8a0', { jitter: 0.03, smooth: 0.4, spec: 0.6 });
  const pep = m.color('#c8382a', { jitter: 0.05, smooth: 0.5 });
  const pepD = m.color('#8a2a20', { jitter: 0.03 });
  const olive = m.color('#2a2228', { spec: 1 });
  const green = m.color('#4aa83a', { jitter: 0.05 });
  const A = [7, 46], dir = [Math.SQRT1_2, -Math.SQRT1_2], LEN = 46, HALF = 0.36;
  const polar = (x, z) => { const dx = x - A[0], dz = z - A[1]; const r = Math.hypot(dx, dz); return [r, Math.atan2(dx * dir[1] - dz * dir[0], dx * dir[0] + dz * dir[1])]; };
  lathe(m, 30, 26, 0, 1, () => 25, (x, y) => (y === 1 ? plate : plateR));
  m.recolor((x, y, z, p) => (p === plate && Math.hypot(x + 0.5 - 30, z + 0.5 - 26) > 22 ? plateR : null));
  const bite = frame === 2;
  const lift = (r) => (frame === 1 && r < 14 ? (14 - r) * 0.45 : 0);
  const hgt = (r) => 3 + r * 0.06;
  for (let x = 0; x < 60; x++) for (let z = 0; z < 54; z++) {
    const [r, a] = polar(x + 0.5, z + 0.5);
    if (r > LEN + 3 || Math.abs(a) > HALF) continue;
    if (bite && Math.hypot(r - 1, a * 22) < 11) continue;
    const y0 = Math.round(2 + lift(r)), top = Math.round(hgt(r) + lift(r));
    if (r > LEN - 3) {
      const ch = top + 3 + Math.round(Math.sin(((r - LEN + 3) / 6) * Math.PI) * 3);
      for (let y = y0; y <= ch; y++) m.set(x, y, z, h3(x, y, z, 4) < 0.15 ? bake : crust);
      continue;
    }
    for (let y = y0; y < top; y++) m.set(x, y, z, Math.abs(a) > HALF - 0.04 ? sauce : dough);
    m.set(x, top, z, h3(x, 0, z, 6) < 0.18 ? melt : cheese);
  }
  // Toppings at fixed polar spots.
  for (const [r, a] of [[12, 0.05], [22, -0.18], [24, 0.2], [33, 0.02], [36, -0.24], [38, 0.24]]) {
    if (bite && r < 10) continue;
    const x = A[0] + (dir[0] * Math.cos(a) - dir[1] * Math.sin(a)) * r, z = A[1] + (dir[1] * Math.cos(a) + dir[0] * Math.sin(a)) * r;
    const y = Math.round(hgt(r) + lift(r)) + 1;
    m.cylinder(x, z, y, y, 3.4, (xx, yy, zz) => (h3(xx, yy, zz, 2) < 0.18 ? pepD : pep));
  }
  for (const [r, a, c] of [[17, -0.1, olive], [29, 0.14, green], [30, -0.1, olive], [41, -0.05, green], [18, 0.2, green]]) {
    const x = A[0] + (dir[0] * Math.cos(a) - dir[1] * Math.sin(a)) * r, z = A[1] + (dir[1] * Math.cos(a) + dir[0] * Math.sin(a)) * r;
    const y = Math.round(hgt(r)) + 1;
    if (c === olive) torus(m, x, y, z, 1.3, 0.6, olive); else m.box(x - 1, y, z, x + 1, y, z, green);
  }
  // Cheese strings on the pull frame, drips over the edge.
  if (frame === 1) for (const k of [-1, 0, 1]) m.line(A[0] + 10, 4 + k * 0.5, A[1] - 8 + k * 2, A[0] + 16, 3, A[1] - 13 + k * 2, melt, 0.5);
  for (const [r, s] of [[20, 1], [32, -1], [27, 1]]) {
    const a = HALF * s;
    const x = A[0] + (dir[0] * Math.cos(a) - dir[1] * Math.sin(a)) * r, z = A[1] + (dir[1] * Math.cos(a) + dir[0] * Math.sin(a)) * r;
    m.box(x, 2, z, x, Math.round(hgt(r)), z, cheese);
  }
  return { m, yaw: 30, pitch: 32, ground: [30, 0, 26], anchors: { tip: [A[0] + 6, 8, A[1] - 6], center: [30, 8, 26] } };
});

def('burger', {
  name: 'Mega Burger', biome: 'aquarium', tags: ['dumb', 'food'], decor: { price: 130, size: 1 }, decorOnly: true,
  desc: 'Triple-stacked, structurally unsound, and it talks. Well, it chomps.',
  interact: {
    verb: 'Chomp', frames: 3, seq: [1, 2, 1, 2, 1, 2, 0], fps: 7,
    sfx: [['gulp', 0, { pitch: 0.8 }], ['boing', 0.3, { pitch: 1.2 }], ['gulp', 0.6]],
    fx: [{ at: 0.3, kind: 'food', from: 'top', n: 5 }, { at: 0.3, kind: 'burst', from: 'top', n: 6, colors: ['#fff0c8', '#e8a050'] }],
    fish: 'gather',
  },
}, ({ frame }) => {
  const m = new VoxelModel(50, 64, 50);
  const bun = m.color('#e0a050', { smooth: 0.65, spec: 0.4, jitter: 0.03 });
  const bunT = m.color('#e8943a', { smooth: 0.7, spec: 0.9, jitter: 0.03 });
  const bunD = m.color('#c08038', { smooth: 0.6, jitter: 0.03 });
  const patty = m.color('#5a3020', { jitter: 0.1 });
  const char = m.color('#3a2018', { jitter: 0.05 });
  const cheese = m.color('#ffc030', { smooth: 0.4, jitter: 0.03 });
  const lettuce = [m.color('#6ac040', { jitter: 0.05 }), m.color('#8ad860', { jitter: 0.05 })];
  const tomato = m.color('#e04030', { smooth: 0.5, jitter: 0.04 });
  const seed = m.color('#fff0c8', { jitter: 0 });
  const pick = m.color('#d8b078', { jitter: 0 });
  const flag = m.color('#ff4a5a', { jitter: 0 });
  const cx = 25, cz = 25;
  lathe(m, cx, cz, 0, 6, (t) => 16 + Math.sin(t * Math.PI * 0.5) * 2, (x, y) => (y < 2 ? bunD : bun));
  lathe(m, cx, cz, 7, 12, () => 19, (x, y, z) => (y === 12 && (x + z) % 5 === 0 ? char : h3(x, y, z, 3) < 0.25 ? char : patty));
  m.recolor((x, y, z, p) => (p === patty && Math.hypot(x + 0.5 - cx, z + 0.5 - cz) > 18.2 + noise3(x * 0.4, y, z * 0.4, 3) ? 0 : null));
  // Cheese diamond with drooping corners.
  shape(m, cx - 22, 11, cz - 22, cx + 22, 13, cz + 22, (x, y, z) => {
    const d = Math.abs(x - cx) + Math.abs(z - cz);
    if (d > 21) return false;
    return d > 18 ? Math.floor(y) === 11 : Math.floor(y) === 13;
  }, cheese);
  shape(m, cx - 22, 14, cz - 22, cx + 22, 16, cz + 22, (x, y, z) => {
    const a = Math.atan2(z - cz, x - cx), r = Math.hypot(x - cx, z - cz);
    return r < 20.5 + Math.sin(a * 9) * 1.2 && Math.floor(y) === 14 + (Math.sin(a * 9) > 0.3 && r > 17 ? 1 : 0);
  }, (x, y, z) => lettuce[h3(x, y, z, 5) < 0.4 ? 1 : 0]);
  lathe(m, cx, cz, 16, 17, () => 17, tomato);
  // Top bun (lifted / tilted while chomping) with sesame seeds and a flag.
  const T = part(m, 40, 30, 40);
  shape(T, 0, 0, 0, 39, 18, 39, (x, y, z) => ((x - 20) / 18) ** 2 + (y / 15) ** 2 + ((z - 20) / 18) ** 2 <= 1, (x, y) => (y < 2 ? bunD : bunT));
  for (let i = 0; i < 26; i++) {
    const a = i * 2.4, r = Math.sqrt((i + 0.5) / 26) * 15;
    const x = 20 + Math.cos(a) * r, z = 20 + Math.sin(a) * r;
    let y = 0; while (y < 18 && T.get(Math.floor(x), y + 1, Math.floor(z))) y++;
    T.set(x, y + 1, z, seed);
  }
  T.line(20, 14, 20, 21, 25, 20, pick, 0);
  T.box(22, 21, 20, 26, 24, 20, flag);
  const lift = [0, 6, 11][frame], tilt = [0, -6, -16][frame];
  stampRot(m, T, [20, 0, 4], [cx, 18 + lift, cz - 16], tilt, 0, 0);
  return { m, yaw: 30, ground: [cx, 0, cz], anchors: { top: [cx, 34 + lift, cz] } };
});

def('cactus_pot', {
  name: 'Potted Cactus', biome: 'aquarium', tags: ['dumb', 'plant'], decor: { price: 85, size: 1 }, decorOnly: true,
  desc: 'Smiles a lot. Hugs are discouraged.',
  interact: {
    verb: 'Pet (ouch)', frames: 3, seq: [1, 1, 2, 2, 2, 2, 2, 0], fps: 4,
    sfx: [['puff', 0, { pitch: 1.3 }], ['sparkle', 0.5]],
    fx: [{ at: 0.05, kind: 'text', from: 'top', text: 'OUCH' }, { at: 0.5, kind: 'burst', from: 'top', n: 10, colors: ['#ff7ab0', '#ffd0e8', '#fff6c8'] }, { at: 0.55, kind: 'hearts', from: 'top', n: 2 }],
    fish: 'flee',
  },
}, ({ frame }) => {
  const m = new VoxelModel(40, 66, 38);
  const terra = m.color('#d0704a', { smooth: 0.5, jitter: 0.04 });
  const terraL = m.color('#e48a5e', { smooth: 0.5, jitter: 0.04 });
  const teal = m.color('#3ab8a8', { jitter: 0.02 });
  const soil = m.color('#4a3020', { jitter: 0.1 });
  const pebble = m.color('#e8e0d0', { jitter: 0.05 });
  const g = [m.color('#4a9a48', { jitter: 0.04, smooth: 0.5 }), m.color('#7ac860', { jitter: 0.04, smooth: 0.5 })];
  const spine = m.color('#fff6c8', { jitter: 0 });
  const eye = m.color('#1e2a1e', { jitter: 0 });
  const blush = m.color('#ff9aa8', { jitter: 0 });
  const petal = [m.color('#ff7ab0', { smooth: 0.6 }), m.color('#ffb0d4', { smooth: 0.6 })];
  const yel = m.color('#ffe04a', { smooth: 0.5 });
  const cx = 20, cz = 18;
  lathe(m, cx, cz, 0, 13, (t) => 9.4 + t * 2, terra);
  lathe(m, cx, cz, 14, 17, () => 12.6, terraL);
  m.recolor((x, y, z, p) => (p === terra && y >= 5 && y <= 8 && m.exposed(x, y, z) && (Math.floor(Math.atan2(z - cz, x - cx) * 6) + y) % 2 === 0 ? teal : null));
  m.sub(() => m.cylinder(cx, cz, 16, 17, 11));
  m.cylinder(cx, cz, 16, 16, 11.2, (x, y, z) => (h3(x, y, z, 3) < 0.08 ? pebble : soil));
  const col = (x, y, z) => (Math.cos(Math.atan2(z + 0.5 - cz, x + 0.5 - cx) * 8) > 0.55 ? g[1] : g[0]);
  lathe(m, cx, cz, 17, 49, () => 5.6, col);
  m.sphere(cx, 49, cz, 5.6, col);
  // Arms: waving on frames 1-2.
  const armL = frame ? [[cx - 5, 30, cz, 3], [cx - 11, 31, cz, 3], [cx - 12, 37, cz, 3], [cx - 11, 45, cz + 1, 2.8]] : [[cx - 5, 30, cz, 3], [cx - 11, 30, cz, 3], [cx - 11, 36, cz, 3], [cx - 11, 42, cz, 2.8]];
  const armR = frame ? [[cx + 5, 36, cz, 3], [cx + 10, 39, cz, 3], [cx + 14, 46, cz + 1, 2.8], [cx + 15, 52, cz + 2, 2.6]] : [[cx + 5, 36, cz, 3], [cx + 11, 36, cz, 3], [cx + 11, 42, cz, 3], [cx + 11, 47, cz, 2.8]];
  m.tube(armL, col, 3); m.tube(armR, col, 3);
  for (const a of [armL, armR]) m.sphere(a[3][0], a[3][1], a[3][2], a[3][3], col);
  surface(m, (x, y, z, p) => ((p === g[1]) && y > 18 && y % 3 === 0 && h3(x, y, z, 8) < 0.5 ? spine : null));
  // Smiley face.
  const fz = cz + 5;
  m.box(cx - 3, 40, fz, cx - 2, 41, fz + 1, eye); m.box(cx + 2, 40, fz, cx + 3, 41, fz + 1, eye);
  m.box(cx - 1, 37, fz + 1, cx + 1, 37, fz + 1, eye); m.set(cx - 2, 38, fz + 1, eye); m.set(cx + 2, 38, fz + 1, eye);
  m.set(cx - 4, 38, fz, blush); m.set(cx + 4, 38, fz, blush);
  // Flower: bud on frame 1, bloom on frame 2.
  if (frame === 1) m.sphere(cx, 56, cz, 1.8, petal[0]);
  if (frame === 2) {
    for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2; m.ellipsoid(cx + Math.cos(a) * 3, 56, cz + Math.sin(a) * 3, 2.4, 1.2, 2.4, petal[k % 2]); }
    m.sphere(cx, 57, cz, 1.5, yel);
  }
  return { m, yaw: 28, ground: [cx, 0, cz], anchors: { top: [cx, 58, cz] } };
});

def('snowman', {
  name: 'Snowman', biome: 'aquarium', tags: ['dumb'], decor: { price: 150, size: 1 }, decorOnly: true,
  desc: 'Should have melted ages ago. Refuses on principle.',
  interact: {
    verb: 'Say hi', frames: 3, seq: [1, 2, 1, 2, 1, 0], fps: 5,
    sfx: [['chirp', 0, { pitch: 1.1 }], ['sparkle', 0.2], ['chirp', 0.5, { pitch: 1.4 }]],
    fx: [{ at: 0.1, kind: 'snow', from: 'top', n: 30 }],
    fish: 'gather',
  },
}, ({ frame }) => {
  const m = new VoxelModel(48, 72, 42);
  const snow = m.color('#f4f8ff', { smooth: 0.85, jitter: 0.04, ramp: ['#7a88b8', '#9aa8d4', '#c0cce8', '#e4ecfa', '#f4f8ff', '#ffffff', '#ffffff'] });
  const coal = m.color('#24242e', { jitter: 0.04, smooth: 0.4 });
  const carrot = m.color('#ff8a2a', { smooth: 0.5, jitter: 0.03 });
  const black = m.color('#1e1c24', { spec: 0.8, smooth: 0.3 });
  const band = m.color('#d83a3a', { jitter: 0.02 });
  const scarf = [m.color('#e04040', { jitter: 0.03, smooth: 0.4 }), m.color('#fff4e8', { jitter: 0.03, smooth: 0.4 })];
  const twig = m.color('#7a4a2a', { jitter: 0.04 });
  const cx = 22, cz = 20;
  const drift = SAND.map(() => '#f4f8ff');
  sandMound(m, cx, cz, 18, 16, 2, 8, drift);
  m.sphere(cx, 12, cz, 12, snow);
  m.sphere(cx, 31, cz, 9.5, snow);
  const turn = frame === 2 ? 0.5 : 0;
  m.sphere(cx, 45, cz, 7.2, snow);
  // Coal buttons, eyes and smile on the sphere fronts.
  for (const by of [35, 31, 27]) { const z = frontZ(cx, 31, cz, 9.5, cx, by); m.box(cx - 0.5, by, z, cx + 0.5, by + 1, z + 1, coal); }
  const fx = (dx) => cx + dx + turn * 3;
  for (const dx of [-2.5, 2.5]) { const x = fx(dx), z = frontZ(cx, 45, cz, 7.2, x, 47); m.box(x, 47, z, x + 1, 48, z + 1, coal); }
  for (let i = -2; i <= 2; i++) { const x = fx(i * 1.3), y = 42 - (i * i <= 1 ? 1 : 0), z = frontZ(cx, 45, cz, 7.2, x, y); m.set(x, y, z + 1, coal); }
  // Carrot nose (turns with the head).
  const nz = frontZ(cx, 45, cz, 7.2, fx(0), 45);
  m.cone(fx(0) + 0.5, 45, nz, nz + 6, 1.7, 0.3, carrot, 'z');
  // Scarf.
  torus(m, cx, 39, cz, 6.8, 1.6, (x, y, z) => scarf[Math.floor((Math.atan2(z - cz, x - cx) + 4) * 2) % 2], 'y');
  m.box(cx + 3, 30, cz + 7, cx + 5, 38, cz + 8, (x, y) => scarf[(y >> 1) % 2]);
  // Top hat (lifted on frame 1).
  const hy = 51 + (frame === 1 ? 5 : 0), hx = frame === 1 ? 2 : 0;
  m.cylinder(cx + hx, cz, hy, hy + 1, 6.6, black);
  m.cylinder(cx + hx, cz, hy + 2, hy + 9, 4.6, black);
  m.cylinder(cx + hx, cz, hy + 2, hy + 3, 4.8, band);
  // Twig arms (the right one waves).
  m.line(cx - 8, 32, cz, cx - 19, 38, cz + 2, twig, 0.6);
  m.line(cx - 16, 36, cz + 1, cx - 18, 41, cz + 1, twig, 0);
  const hand = [[cx + 19, 36, cz + 2], [cx + 13, 53, cz + 2], [cx + 18, 47, cz + 3]][frame];
  m.line(cx + 8, 32, cz, hand[0], hand[1], hand[2], twig, 0.6);
  m.line((cx + 8 + hand[0] * 2) / 3, (32 + hand[1] * 2) / 3, cz + 1, hand[0] + 2, hand[1] + 3, cz + 1, twig, 0);
  return { m, yaw: 28, ground: [cx, 0, cz], anchors: { top: [cx, 64, cz], head: [cx, 48, cz + 6] } };
});

def('telescope', {
  name: 'Brass Telescope', biome: 'aquarium', tags: ['fancy', 'metal'], decor: { price: 220, size: 1 }, decorOnly: true,
  desc: 'For spotting stars, boats, and the occasional suspicious seagull.',
  interact: {
    verb: 'Stargaze', frames: 3, seq: [1, 1, 2, 2, 2, 1, 0], fps: 2.5,
    sfx: [['click', 0], ['click', 0.4], ['ui_unlock', 0.9, { vol: 0.6 }]],
    fx: [{ at: 0.9, kind: 'stars', from: 'lens', n: 8 }, { at: 1.6, kind: 'sparkle', from: 'lens', n: 6 }],
    fish: 'gather',
  },
}, ({ frame }) => {
  const m = new VoxelModel(56, 64, 44);
  const wood = m.color('#8a5634', { jitter: 0.05 });
  const brass = m.color('#e0b048', { spec: 1.8, specPow: 12, smooth: 0.6 });
  const navy = m.color('#2a3a6a', { spec: 1.2, smooth: 0.6, jitter: 0.02 });
  const lens = m.color('#9ae8ff', { emissive: 0.5, spec: 2 });
  const cx = 26, cz = 20;
  sandMound(m, cx, cz + 2, 18, 15, 2, 4);
  const apex = [cx, 28, cz];
  for (const [fx, fz] of [[cx - 13, cz - 6], [cx + 13, cz - 6], [cx, cz + 14]]) {
    m.line(apex[0], apex[1], apex[2], fx, 1, fz, wood, 0.9);
    m.sphere(fx, 1, fz, 1.3, brass);
  }
  torus(m, cx, 12, cz + 0.5, 4.6, 0.5, brass);
  m.sphere(cx, 29, cz, 2.6, brass);
  // Tube aims left / up / right per frame.
  const dirs = [[-0.62, 0.74, 0.25], [0.08, 0.95, 0.3], [0.66, 0.7, 0.28]];
  let d = dirs[frame];
  const l = Math.hypot(...d); d = d.map((v) => v / l);
  const P = (k) => [cx + d[0] * k, 31 + d[1] * k, cz + d[2] * k];
  const seg = (a, b, r, c) => { const p = P(a), q = P(b); m.line(p[0], p[1], p[2], q[0], q[1], q[2], c, r); };
  seg(-11, -7, 1.3, brass);
  seg(-7, 21, 3, navy);
  seg(21, 25, 4, navy);
  for (const k of [-6, 4, 14, 22]) seg(k, k + 1, k === 22 ? 4.4 : 3.5, brass);
  const e = P(25.5);
  m.sphere(e[0], e[1], e[2], 2.6, lens);
  // Finder scope riding on top.
  const up = [0, 1, 0];
  const side = [d[1] * up[2] - d[2] * up[1], d[2] * up[0] - d[0] * up[2], d[0] * up[1] - d[1] * up[0]];
  const o = side.map((v) => v * 4.4);
  const f0 = P(2), f1 = P(10);
  m.line(f0[0] + o[0], f0[1] + o[1] + 1, f0[2] + o[2], f1[0] + o[0], f1[1] + o[1] + 1, f1[2] + o[2], brass, 1);
  return { m, yaw: 30, ground: [cx, 0, cz + 2], anchors: { lens: P(27) } };
});

def('campfire', {
  name: 'Campfire', biome: 'aquarium', tags: ['dumb', 'glow'], decor: { price: 160, size: 1 }, decorOnly: true,
  desc: 'An underwater campfire. Physics has filed a complaint. Marshmallow included.',
  interact: {
    verb: 'Stoke', frames: 4, idle: [0, 1, 2, 1], idleFps: 7, seq: [3, 3, 2, 3, 3, 1, 3, 0], fps: 8,
    sfx: [['puff', 0, { pitch: 0.8 }], ['click', 0.12, { vol: 0.4 }], ['click', 0.3, { vol: 0.3, pitch: 1.3 }], ['click', 0.5, { vol: 0.4, pitch: 0.9 }]],
    fx: [{ at: 0.05, kind: 'embers', from: 'flame', n: 16 }],
    ambient: [{ kind: 'embers', from: 'flame', every: 0.9, n: 1 }], fish: 'gather', use: { kind: 'sit', at: 'side' },
  },
}, ({ frame, rng }) => {
  const m = new VoxelModel(46, 52, 46);
  const stone = reefRock(m, rng, ['#8a8690', '#74707c', '#a29ea6']);
  const bark = m.color('#6a4228', { jitter: 0.06 });
  const cut = m.color('#d0a46a', { jitter: 0.04 });
  const ash = m.color('#3a3438', { jitter: 0.08 });
  const ember = m.color('#ff6a2a', { emissive: 0.9, jitter: 0 });
  const fl = ['#e8402a', '#ff7a2a', '#ffc04a', '#fff4b0'].map((c) => m.color(c, { emissive: 1, jitter: 0 }));
  const stick = m.color('#8a6a40', { jitter: 0.03 });
  const mallow = m.color(frame === 3 ? '#c8803a' : '#fffaf0', { smooth: 0.8 });
  const cx = 22, cz = 22;
  sandMound(m, cx, cz, 19, 19, 2, 3);
  for (let k = 0; k < 9; k++) { const a = (k / 9) * Math.PI * 2 + 0.2; facetRock(m, rng, cx + Math.cos(a) * 11.5, 2, cz + Math.sin(a) * 11.5, 3.4, 2.8, 3, stone[k % 2], 9); }
  stoneTex(m, stone, 5);
  m.cylinder(cx, cz, 1, 2, 7.5, (x, y, z) => (h3(x, y, z, 4) < 0.2 ? ember : ash));
  for (let k = 0; k < 4; k++) {
    const a = k * Math.PI / 2 + 0.4;
    m.line(cx + Math.cos(a) * 8.5, 2.5, cz + Math.sin(a) * 8.5, cx + Math.cos(a) * 1.5, 13, cz + Math.sin(a) * 1.5, bark, 1.7);
    m.sphere(cx + Math.cos(a) * 8.9, 2.2, cz + Math.sin(a) * 8.9, 1.8, cut);
  }
  // Flickering flame tongues (frame 3 flares up).
  const H = [20, 23, 19, 31][frame], W = frame === 3 ? 7.6 : 6;
  shape(m, cx - 10, 3, cz - 10, cx + 10, 3 + H, cz + 10, (x, y, z) => {
    const t = (y - 3) / H;
    if (t > 1) return false;
    const a = Math.atan2(z - cz, x - cx);
    const wob = 0.6 + 0.4 * Math.sin(a * 3 + frame * 2.1 + y * 0.45);
    const sway = Math.sin(t * 3 + frame) * t * 2;
    return Math.hypot(x - cx - sway, z - cz) <= W * Math.pow(1 - t, 0.75) * (t > 0.35 ? wob : 1);
  }, (x, y, z) => {
    const k = ((y - 3) / H) * 0.9 + (Math.hypot(x + 0.5 - cx, z + 0.5 - cz) / W) * 0.7 + h3(x, y, z, frame) * 0.15;
    return fl[k < 0.45 ? 3 : k < 0.75 ? 2 : k < 1.05 ? 1 : 0];
  });
  // Marshmallow on a stick (toasted when the fire flares).
  m.line(cx + 16, 1, cz + 14, cx + 6, 12, cz + 6, stick, 0.5);
  m.box(cx + 4, 11, cz + 4, cx + 6, 13, cz + 6, mallow);
  return { m, yaw: 30, ground: [cx, 0, cz], light: '#ff9a3a', anchors: { flame: [cx, 3 + H * 0.6, cz], side: [cx + 16, 9, cz + 9] } };
});

def('arcade_cabinet', {
  name: 'Arcade Cabinet', biome: 'aquarium', tags: ['retro', 'screen', 'glow'], decor: { price: 520, size: 2 }, decorOnly: true,
  desc: 'FISH: The Game. High score held by a clownfish named Gary.',
  interact: {
    verb: 'Play', frames: 4, idle: [0, 1], idleFps: 1.5, seq: [2, 1, 2, 1, 1, 1, 3, 3, 3, 3, 0], fps: 5,
    sfx: [['ui_unlock', 0], ['glitch', 0.4, { vol: 0.35 }], ['timing_good', 0.7], ['timing_perfect', 1.2], ['coins_many', 1.3, { vol: 0.25 }]],
    fx: [{ at: 1.2, kind: 'text', from: 'top', text: 'HI-SCORE!' }, { at: 1.2, kind: 'stars', from: 'screen', n: 8 }],
    fish: 'gather', use: { kind: 'watch', at: 'front', seq: [1, 0], fps: 2 },
  },
}, ({ frame }) => {
  const m = new VoxelModel(40, 80, 40);
  const purple = m.color('#4a2478', { jitter: 0.04 });
  const purpleL = m.color('#6a34a8', { jitter: 0.04 });
  const neon = m.color('#ff4ad8', { emissive: 0.7, jitter: 0 });
  const trim = m.color('#4af4ff', { emissive: 0.6, jitter: 0 });
  const black = m.color('#1a1820', { jitter: 0.02 });
  const chrome = m.color('#c8d0dc', { spec: 2 });
  const slotC = m.color('#ff4a4a', { emissive: 1, jitter: 0 });
  const stick = m.color('#e83a3a', { smooth: 0.8, spec: 1.2 });
  const btn = ['#ffd84a', '#4af4ff', '#ff6ad8'].map((c) => m.color(c, { smooth: 0.6, spec: 1 }));
  const em = (c) => m.color(c, { emissive: 1, jitter: 0 });
  const bg = em('#10184a'), star = em('#8aa0ff'), yel = em('#ffd84a'), org = em('#ff8a2a'), wht = em('#ffffff'), red = em('#ff4a5a'), grn = em('#5aff8a'), cyan = em('#4af4ff'), pnk = em('#ff6ad8');
  const marq = em('#ffd84a');
  const front = (y) => (y <= 30 ? 30 : y <= 37 ? 30 + (y - 30) * 0.6 : y <= 61 ? 25 : y <= 73 ? 29 : y <= 75 ? 28 : -1);
  shape(m, 6, 0, 6, 33, 75, 34, (x, y, z) => z <= front(Math.floor(y)) + 1, (x, y, z) => (x <= 7 || x >= 32 ? purpleL : purple));
  // Side art: neon stripes and a glowing edge trim.
  m.recolor((x, y, z, p) => ((x === 33 || x === 6) && ((y - z * 0.8 + 400) % 22) < 2 ? neon : null));
  for (let y = 0; y <= 75; y++) { const f = Math.floor(front(y)); if (f > 0) { m.set(33, y, f + 1, trim); m.set(6, y, f + 1, trim); } }
  // Coin door, control panel with joystick and buttons.
  m.box(15, 9, 31, 24, 20, 31, chrome);
  m.box(17, 15, 32, 18, 17, 32, slotC); m.box(21, 15, 32, 22, 17, 32, slotC);
  m.box(8, 36, 30, 31, 37, 34, black);
  m.line(13, 37, 32, 13, 41, 32, black, 0.5);
  m.sphere(13, 42, 32, 1.6, stick);
  [[19, 32], [23, 33], [27, 32]].forEach(([bx, bz], i) => m.cylinder(bx, bz, 38, 38, 1.3, btn[i]));
  // Screen pictures: attract, gameplay, flash, high scores.
  const pix = (u, v) => {
    if (frame === 2) return u === 0 || v === 0 || u === 19 || v === 19 ? pnk : yel;
    if (frame === 3) {
      if (v >= 1 && v <= 5) { const g = GLYPH[['H', 'I'][Math.floor((u - 6) / 4)]]; const k = (u - 6) % 4; if (u >= 6 && u < 14 && k < 3 && g && g[v - 1][k] === '#') return yel; }
      if (v >= 8 && v % 3 === 2 && u > 2 && u < 17) return [cyan, pnk, grn, wht][Math.floor((v - 8) / 3) % 4];
      return bg;
    }
    if (frame === 0) {
      if (v >= 1 && v <= 5 && u >= 2) { const i = Math.floor((u - 2) / 4), k = (u - 2) % 4; const g = GLYPH['FISH'[i]]; if (g && k < 3 && g[v - 1][k] === '#') return yel; }
      const fu = u - 6, fv = v - 11;
      if (fu >= 0 && fu <= 7 && Math.abs(fv) <= 2 - (fu === 0 || fu === 7 ? 1 : 0)) return fu === 5 && fv === -1 ? wht : org;
      if (fu === -1 && Math.abs(fv) <= 2) return org;
      if (v === 17 && u % 3 !== 0 && u > 2 && u < 17) return wht;
      return h3(u, v, 1, 2) < 0.04 ? star : bg;
    }
    if (v === 0) return u < 8 ? cyan : bg;
    if (v >= 3 && v <= 4 && (u % 6 === 2 || u % 6 === 3)) return v === 3 ? red : grn;
    if (u === 9 && v >= 7 && v <= 12 && v % 2) return wht;
    const fu = u - 6, fv = v - 15;
    if (fu >= 0 && fu <= 6 && Math.abs(fv) <= 1) return fu === 4 && fv === -1 ? wht : org;
    return h3(u, v, 2, 2) < 0.05 ? star : bg;
  };
  for (let v = 0; v < 20; v++) for (let u = 0; u < 20; u++) m.set(10 + u, 59 - v, 26, pix(u, v));
  m.box(8, 38, 26, 31, 39, 26, black); m.box(8, 60, 26, 31, 61, 26, black);
  m.box(8, 38, 26, 9, 61, 26, black); m.box(30, 38, 26, 31, 61, 26, black);
  // Marquee with FISH in pink.
  m.box(8, 63, 30, 31, 72, 30, marq);
  glyphs(m, 'FISH', 12, 70, 31, pnk);
  m.box(8, 62, 30, 31, 62, 30, black);
  return { m, yaw: 28, ground: [20, 0, 20], light: '#ff6ad8', anchors: { screen: [20, 50, 28], top: [20, 76, 20], front: [20, 22, 44] } };
});

const JUKE = ['#ff4ad8', '#ffd84a', '#4af4ff'];
def('jukebox', {
  name: 'Jukebox', biome: 'aquarium', tags: ['retro', 'music', 'glow'], decor: { price: 420, size: 1 }, decorOnly: true,
  desc: 'Bubble tubes, chrome and exactly one record: "Under the Sea (Club Mix)".',
  interact: {
    verb: 'Play a tune', frames: 3, idle: [0, 1, 2], idleFps: 1.5, seq: Array.from({ length: 18 }, (_, i) => i % 3), fps: 8,
    sfx: [[0.1, 0.75], [0.32, 0.84], [0.54, 1], [0.76, 0.84], [0.98, 0.75], [1.2, 0.63], [1.42, 0.75], [1.64, 1]].map(([at, p]) => ['bell', at, { pitch: p, vol: 0.5 }]).concat([['click', 0], ['click', 0.54], ['click', 1.08], ['click', 1.62]]),
    fx: [0.1, 0.54, 0.98, 1.42].map((at) => ({ at, kind: 'notes', from: 'top', n: 2 })),
    fish: 'dance', use: { kind: 'dance', at: 'front', seq: [0, 1, 2], fps: 4 },
  },
}, ({ frame }) => {
  const m = new VoxelModel(46, 60, 32);
  const wood = m.color('#8a3424', { jitter: 0.04, spec: 0.6 });
  const chrome = m.color('#d0d8e2', { spec: 2.2, smooth: 0.5 });
  const chromeD = m.color('#8a94a4', { spec: 1.2 });
  const glass = m.color('#1a2a3a', { spec: 2.2, specPow: 10 });
  const rec = m.color('#141218', { spec: 1 });
  const card = m.color('#f4ecd0', { jitter: 0 });
  const tubes = JUKE.map((c) => m.color(c, { emissive: 1, jitter: 0 }));
  const label = m.color(JUKE[frame], { emissive: 0.6 });
  const cx = 22.5, cz = 15, ay = 34;
  rbox(m, 5, 0, 3, 40, 3, 27, 1, chromeD);
  rbox(m, 6, 3, 4, 39, ay + 1, 26, 2, wood);
  shape(m, 5, ay, 4, 40, ay + 18, 26, (x, y, z) => Math.hypot(x - cx, y - ay) <= 17, wood);
  // Bubble-tube arch and side pilasters cycling colours.
  shape(m, 5, ay, 27, 40, ay + 18, 27, (x, y) => { const r = Math.hypot(x - cx, y - ay); return r >= 13.4 && r <= 15.6; }, (x, y) => tubes[(Math.floor((Math.atan2(y + 0.5 - ay, x + 0.5 - cx) / Math.PI) * 9) + frame) % 3]);
  shape(m, 5, ay, 27, 40, ay + 18, 27, (x, y) => Math.hypot(x - cx, y - ay) < 13.4, glass);
  for (const px of [7, 36]) m.box(px, 4, 27, px + 2, ay, 27, (x, y) => tubes[(Math.floor(y / 4) + frame + (px > 20 ? 1 : 0)) % 3]);
  // A record spinning behind the window, plus tone arm.
  m.cylinder(cx, ay + 6, 28, 28, 7.4, rec, 'z');
  torus(m, cx, ay + 6, 28.5, 4.6, 0.4, chromeD, 'z');
  m.cylinder(cx, ay + 6, 28, 29, 2.4, label, 'z');
  m.line(cx + 10, ay + 12, 28, cx + 4, ay + 8, 29, chrome, 0.4);
  // Grille, buttons, title strip, chrome top ornament.
  for (let x = 12; x <= 33; x += 2) m.box(x, 7, 27, x, 21, 27, chrome);
  for (let x = 12; x <= 33; x += 2) m.box(x, 25, 27, x, 26, 28, card);
  m.box(12, 29, 27, 33, 31, 27, card);
  m.box(14, 30, 28, 31, 30, 28, chromeD);
  m.ellipsoid(cx, ay + 18, cz, 4, 2, 3, chrome);
  return { m, yaw: 28, ground: [cx, 0, cz], light: JUKE[frame], anchors: { top: [cx, ay + 22, cz], front: [cx, 18, 36] } };
});

def('beach_set', {
  name: 'Beach Day', biome: 'aquarium', tags: ['dumb', 'home'], decor: { price: 300, size: 2 }, decorOnly: true,
  desc: 'Umbrella, deck chair, beach ball. Forgot the sunscreen. And the beach.',
  interact: {
    verb: 'Spin', frames: 4, seq: [0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3, 0], fps: 10,
    sfx: [['chirp', 0, { pitch: 1.3 }], ['boing', 0.25, { pitch: 1.3 }]],
    fx: [{ at: 0.1, kind: 'sparkle', from: 'top', n: 8, colors: ['#fff6b0'] }, { at: 0.25, kind: 'confetti', from: 'ball', n: 8 }],
    fish: 'gather', use: { kind: 'sit', at: 'chair', emote: 'sun' },
  },
}, ({ frame }) => {
  const m = new VoxelModel(66, 58, 54);
  const red = m.color('#e84a5a', { jitter: 0.03, smooth: 0.3 });
  const white = m.color('#fff4e8', { jitter: 0.03, smooth: 0.3 });
  const wood = m.color('#c89058', { jitter: 0.04 });
  const blue = m.color('#3a8ad8', { jitter: 0.03 });
  const ball = ['#ff4a4a', '#ffffff', '#3a8ad8', '#ffd84a', '#ffffff', '#5ac85a'].map((c) => m.color(c, { smooth: 0.85, spec: 1.2 }));
  const bucket = m.color('#ff5a3a', { smooth: 0.5, spec: 0.6 });
  const handle = m.color('#ffd84a', { jitter: 0 });
  const spade = m.color('#3ab8e8', { smooth: 0.4 });
  const shades = m.color('#1a1820', { spec: 1.5 });
  sandMound(m, 32, 27, 31, 24, 3, 6);
  // Umbrella: striped pole, sloping canopy that spins with the frame.
  m.line(23, 0, 24, 25, 46, 25, (x, y) => ((y >> 2) % 2 ? red : white), 0.8);
  const ucx = 25, ucz = 25;
  for (let x = 0; x < 52; x++) for (let z = 0; z < 52; z++) {
    const dx = x + 0.5 - ucx, dz = z + 0.5 - ucz, r = Math.hypot(dx, dz);
    if (r > 23) continue;
    const a = Math.atan2(dz, dx) + frame * (Math.PI / 16);
    const sec = Math.floor(((a + Math.PI * 4) / (Math.PI / 4))) % 2;
    const scallop = r > 21 && Math.abs(((a / (Math.PI / 4)) % 1 + 1) % 1 - 0.5) < 0.25 ? 1 : 0;
    const y = Math.round(48 - Math.pow(r / 23, 1.6) * 8) - scallop;
    m.set(x, y, z, sec ? red : white);
    m.set(x, y + 1, z, sec ? red : white);
  }
  m.sphere(ucx, 50, ucz, 1.6, red);
  // Deck chair with a striped sling and sunglasses.
  const rail = (u) => (u < 0.6 ? [38 + u / 0.6 * 14, 6] : [52 + (u - 0.6) / 0.4 * 8, 6 + (u - 0.6) / 0.4 * 12]);
  for (let u = 0; u <= 1; u += 0.02) {
    const [x, y] = rail(u);
    for (const z of [30, 43]) m.set(x, y, z, wood);
    for (let z = 31; z <= 42; z++) m.set(x, y - (u < 0.6 ? Math.sin((u / 0.6) * Math.PI) * 1.5 : 0), z, ((z - 31) >> 1) % 2 ? blue : white);
  }
  for (const [x0, x1] of [[38, 39], [52, 50], [59, 56]]) for (const z of [30, 43]) m.line(x0, 0, z, x1, x0 === 59 ? 16 : 6, z, wood, 0);
  m.box(54, 12, 35, 55, 13, 36, shades); m.box(54, 12, 38, 55, 13, 39, shades); m.box(54, 13, 37, 54, 13, 37, shades);
  // Beach ball, bucket and spade.
  m.sphere(12, 5, 41, 4.6, (x, y, z) => (y > 8 ? ball[1] : ball[Math.floor(((Math.atan2(z + 0.5 - 41, x + 0.5 - 12) + Math.PI) / (Math.PI * 2)) * 6) % 6]));
  lathe(m, 8, 28, 1, 6, (t) => 2.6 + t * 0.8, bucket);
  m.sub(() => m.cylinder(8, 28, 4, 6, 2.4));
  m.line(5, 6, 28, 8, 9, 28, handle, 0); m.line(8, 9, 28, 11, 6, 28, handle, 0);
  m.line(13, 1, 31, 16, 10, 29, spade, 0.4);
  m.box(12, 0, 31, 14, 2, 33, spade);
  return { m, yaw: 30, ground: [32, 0, 27], anchors: { chair: [47, 10, 37], top: [ucx, 52, ucz], ball: [12, 8, 41] } };
});

def('trampoline', {
  name: 'Trampoline', biome: 'aquarium', tags: ['dumb', 'toy'], decor: { price: 280, size: 2 }, decorOnly: true,
  desc: 'Boing. Boing. Boing. The fish have discovered joy.',
  interact: {
    verb: 'Bounce', frames: 3, seq: [1, 2, 0, 1, 2, 0], fps: 9,
    sfx: [['boing', 0], ['boing', 0.33, { pitch: 1.2 }]],
    fx: [{ at: 0, kind: 'ring', from: 'mat' }, { at: 0.1, kind: 'bubbles', from: 'mat', n: 8 }, { at: 0.33, kind: 'ring', from: 'mat' }],
    fish: 'launch', use: { kind: 'bounce', at: 'mat' },
  },
}, ({ frame }) => {
  const m = new VoxelModel(60, 26, 56);
  const steel = m.color('#9aa4b0', { spec: 1.4, smooth: 0.4 });
  const pad = m.color('#3a8ad8', { smooth: 0.7, jitter: 0.03 });
  const padY = m.color('#ffd84a', { smooth: 0.7, jitter: 0.03 });
  const mat = m.color('#26262e', { jitter: 0.02 });
  const matL = m.color('#3a3a46', { jitter: 0.02 });
  const spring = m.color('#e0e4ec', { spec: 1.6 });
  const cx = 30, cz = 28, R = 22, MR = 16;
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2 + 0.3;
    m.line(cx + Math.cos(a) * R, 15, cz + Math.sin(a) * R, cx + Math.cos(a) * (R + 1.5), 0, cz + Math.sin(a) * (R + 1.5), steel, 0.7);
  }
  torus(m, cx, 15, cz, R, 1.1, steel);
  torus(m, cx, 16.5, cz, R - 2, 1.8, (x, y, z) => (Math.floor((Math.atan2(z - cz, x - cx) + Math.PI) / (Math.PI / 6)) % 2 ? pad : padY));
  const off = (r) => (frame === 1 ? -5 : frame === 2 ? 2.5 : 0) * (1 - (r / MR) ** 2);
  for (let x = cx - MR - 1; x <= cx + MR + 1; x++) for (let z = cz - MR - 1; z <= cz + MR + 1; z++) {
    const r = Math.hypot(x + 0.5 - cx, z + 0.5 - cz);
    if (r > MR) continue;
    m.set(x, Math.round(15 + off(r)), z, r % 4 < 0.7 ? matL : mat);
  }
  for (let k = 0; k < 30; k++) {
    const a = (k / 30) * Math.PI * 2;
    m.line(cx + Math.cos(a) * (MR + 0.3), 15, cz + Math.sin(a) * (MR + 0.3), cx + Math.cos(a) * (R - 3.5), 15.5, cz + Math.sin(a) * (R - 3.5), spring, 0);
  }
  return { m, yaw: 30, pitch: 30, ground: [cx, 0, cz], anchors: { mat: [cx, 17 + off(0), cz] } };
});

def('fish_statue', {
  name: 'Golden Fish Statue', biome: 'aquarium', tags: ['statue', 'fancy'], decor: { price: 700, size: 2 }, decorOnly: true,
  desc: 'Erected in honour of the greatest fish. Every fish believes it is about them.',
  interact: {
    verb: 'Admire', frames: 3, seq: [1, 2, 1, 2, 1, 2, 0], fps: 5,
    sfx: [['splash_small', 0], ['golden_shimmer', 0.2], ['bell', 0.5, { pitch: 1.5, vol: 0.5 }]],
    fx: [{ at: 0.2, kind: 'sparkle', from: 'fish', n: 12, colors: ['#ffe27a', '#fff6c8'] }, { at: 0.1, kind: 'bubbles', from: 'mouth', n: 8 }, { at: 0.6, kind: 'hearts', from: 'fish', n: 2 }],
    fish: 'gather', use: { kind: 'orbit', at: 'fish' },
  },
}, ({ frame }) => {
  const m = new VoxelModel(52, 92, 44);
  const marble = m.color('#ece8e0', { jitter: 0.04 });
  const vein = m.color('#b8b4c4', { jitter: 0.02 });
  const teal = m.color('#5ab8a8', { smooth: 0.7, jitter: 0.04 });
  const tealL = m.color('#9ae8d8', { smooth: 0.7, jitter: 0.03 });
  const gold = m.color('#f0c040', { spec: 2, specPow: 12, smooth: 0.7, jitter: 0.02 });
  const goldL = m.color('#ffe27a', { spec: 2, specPow: 12, smooth: 0.7, jitter: 0.02 });
  const goldD = m.color('#b8862a', { spec: 1, smooth: 0.6 });
  const eye = m.color('#2a1a10', { jitter: 0 });
  const water = m.color('#bff4ff', { emissive: 0.55, smooth: 0.6, jitter: 0 });
  const cx = 26, cz = 22;
  m.box(6, 0, 3, 45, 4, 41, marble);
  m.box(9, 5, 6, 42, 24, 38, marble);
  m.box(7, 25, 4, 44, 28, 40, marble);
  m.recolor((x, y, z, p) => (p === marble && Math.abs(fbm3(x * 0.09, y * 0.12, z * 0.09, 3, 5) - 0.5) < 0.025 ? vein : null));
  m.box(17, 10, 39, 34, 19, 39, goldD);
  m.box(18, 11, 39, 33, 18, 39, gold);
  for (const [u, v] of [[3, 2], [4, 1], [4, 2], [4, 3], [5, 1], [5, 2], [5, 3], [6, 2], [7, 2], [8, 1], [8, 3], [2, 2]]) m.set(20 + u, 12 + v, 40, goldD);
  // Wave crest the fish leaps out of.
  for (const [x, y, z, r] of [[cx - 3, 30.5, cz, 4.4], [cx + 2, 30, cz + 1, 3.6], [cx - 8, 30, cz - 1, 3.4], [cx + 6, 29.5, cz, 3]]) m.sphere(x, y, z, r, (xx, yy) => (yy > y + r * 0.35 ? tealL : teal));
  // Leaping golden fish along a curved spine (thin tail stem, fat body, blunt head).
  const P = (t) => [cx - 12 + 20 * t + Math.sin(Math.PI * t) * 3, 38 + 29 * t + Math.sin(Math.PI * t) * 4, cz];
  const rad = (t) => (t < 0.25 ? 1.6 + (t / 0.25) * 3 : t < 0.8 ? 4.6 + Math.sin(((t - 0.25) / 0.55) * Math.PI) * 2.4 : 4.6 - ((t - 0.8) / 0.2) ** 2 * 1.8);
  for (let t = 0; t <= 1; t += 0.01) {
    const [x, y, z] = P(t), r = rad(t);
    m.ellipsoid(x, y, z, r, r, r * 0.74, (xx, yy, zz) => (yy < y - r * 0.3 && xx > x ? goldL : h3(xx, yy, zz, 3) < 0.1 ? goldL : gold));
  }
  const tri = (a, b, c, z0, z1, col) => {
    const minx = Math.min(a[0], b[0], c[0]), maxx = Math.max(a[0], b[0], c[0]), miny = Math.min(a[1], b[1], c[1]), maxy = Math.max(a[1], b[1], c[1]);
    shape(m, minx, miny, z0, maxx, maxy, z1, (x, y) => {
      const s = (p, q) => (q[0] - p[0]) * (y - p[1]) - (q[1] - p[1]) * (x - p[0]);
      const d1 = s(a, b), d2 = s(b, c), d3 = s(c, a);
      return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
    }, col);
  };
  const T0 = P(0), T1 = P(0.06);
  const dx = T1[0] - T0[0], dy = T1[1] - T0[1], dl = Math.hypot(dx, dy), ux = dx / dl, uy = dy / dl;
  const tb = [T0[0] + ux, T0[1] + uy];
  tri(tb, [tb[0] - ux * 9 - uy * 7, tb[1] - uy * 9 + ux * 7], [tb[0] - ux * 4, tb[1] - uy * 4], cz - 1, cz + 1, goldD);
  tri(tb, [tb[0] - ux * 9 + uy * 7, tb[1] - uy * 9 - ux * 7], [tb[0] - ux * 4, tb[1] - uy * 4], cz - 1, cz + 1, goldD);
  const D0 = P(0.4), D1 = P(0.68);
  tri([D0[0] - 4, D0[1] + 3], [D1[0] - 5, D1[1] + 3], [(D0[0] + D1[0]) / 2 - 11, (D0[1] + D1[1]) / 2 + 8], cz, cz, goldD);
  const A0 = P(0.35), A1 = P(0.5);
  tri([A0[0] + 4, A0[1] - 3], [A1[0] + 5, A1[1] - 4], [(A0[0] + A1[0]) / 2 + 9, (A0[1] + A1[1]) / 2 - 7], cz, cz, goldD);
  for (const s of [-1, 1]) m.ellipsoid(P(0.72)[0] + 2, P(0.72)[1] - 3, cz + s * 4.6, 3.2, 1.6, 1, goldD);
  const H = P(0.92);
  m.box(H[0] - 1, H[1] + 1, cz + 3, H[0] + 1, H[1] + 3, cz + 3, goldL);
  m.box(H[0], H[1] + 1, cz + 4, H[0], H[1] + 2, cz + 4, eye);
  const M = P(1);
  m.sub(() => m.sphere(M[0] + 1.5, M[1] + 1.5, cz, 1.6));
  // Fountain from the mouth.
  if (frame > 0) {
    const k = frame === 2 ? 1.5 : 1;
    for (let s = 0; s <= 16; s += 0.25) {
      const x = M[0] + 2 + s * 0.55, y = M[1] + 2 + s * 1.3 * k - s * s * 0.07 * (frame === 2 ? 0.8 : 1.3);
      if (y < 30) break;
      m.sphere(x, y, cz, 0.9, water);
    }
    for (let i = 0; i < 6; i++) m.set(M[0] + 8 + i * 1.5, M[1] - 2 - i * 3 + frame, cz + (i % 3) - 1, water);
  }
  return { m, yaw: 30, ground: [cx, 0, cz], anchors: { mouth: [M[0] + 2, M[1] + 2, cz], fish: P(0.5) } };
});

def('giant_sneaker', {
  name: 'Lost Sneaker', biome: 'aquarium', tags: ['dumb', 'junk', 'home'], decor: { price: 260, size: 2 }, decorOnly: true,
  desc: 'Size 97. Still has the other one somewhere. Squeaks when tapped.',
  interact: {
    verb: 'Tap', frames: 3, seq: [1, 0, 1, 0, 2, 0, 2, 0], fps: 9,
    sfx: [['squeak', 0, { pitch: 0.9 }], ['squeak', 0.22, { pitch: 1.1 }], ['squeak', 0.44, { pitch: 0.8 }], ['squeak', 0.66, { pitch: 1.2 }]],
    fx: [{ at: 0, kind: 'burst', from: 'toe', n: 8, colors: ['#e8cf96', '#ffffff'] }],
    fish: 'flee', use: { kind: 'hide', at: 'opening' },
  },
}, ({ frame }) => {
  const m = new VoxelModel(74, 50, 36);
  const S = part(m, 64, 38, 28);
  const rubber = m.color('#f4f4ee', { jitter: 0.03, smooth: 0.3 });
  const tread = m.color('#b0b0ba', { jitter: 0.02 });
  const mid = m.color('#3ac8b8', { jitter: 0.02 });
  const leather = m.color('#f8f8f4', { jitter: 0.03, smooth: 0.45 });
  const pink = m.color('#ff5a9a', { jitter: 0.02, smooth: 0.4 });
  const cap = m.color('#dadae4', { jitter: 0.02, smooth: 0.4 });
  const tab = m.color('#e84a4a', { jitter: 0.02 });
  const collar = m.color('#2a2a48', { jitter: 0.03, smooth: 0.5 });
  const lining = m.color('#3a3048', { jitter: 0.02 });
  const lace = m.color('#ffffff', { jitter: 0 });
  const eyelet = m.color('#9aa0ac', { spec: 1.4 });
  const zc = 14;
  const wAt = (x) => {
    const u = (x - 2) / 58;
    if (u < 0 || u > 1) return -1;
    let w = 7.2 + 3.2 * Math.sin(u * Math.PI * 0.95);
    if (u > 0.86) w *= Math.sqrt(Math.max(0, 1 - ((u - 0.86) / 0.14) ** 2));
    if (u < 0.05) w *= Math.sqrt(Math.max(0, 1 - ((0.05 - u) / 0.05) ** 2));
    return w;
  };
  const hu = (u) => 25 - 16 * smoothT(0.22, 1, u);
  for (let x = 0; x < 64; x++) {
    const w = wAt(x + 0.5), u = (x + 0.5 - 2) / 58;
    if (w <= 0) continue;
    for (let z = 0; z < 28; z++) {
      const dz = z + 0.5 - zc;
      if (Math.abs(dz) > w) continue;
      for (let y = 0; y <= 4; y++) S.set(x, y, z, y === 4 ? mid : y === 1 && x % 3 === 0 ? tread : rubber);
      if (Math.abs(dz) > w - 0.6) continue;
      const top = 4 + (hu(u) - 4) * Math.sqrt(Math.max(0, 1 - (dz / w) ** 2 * 0.75));
      for (let y = 5; y <= top; y++) {
        let c = leather;
        const ys = 8 + 9 * Math.sin(u * Math.PI * 0.8 + 0.3);
        if (u > 0.15 && u < 0.82 && Math.abs(y - ys + (u - 0.5) * 6) < 1.5 && Math.abs(dz) > w - 2.5) c = pink;
        if (u > 0.86 && y < 10) c = cap;
        if (u < 0.06 && y > 15) c = tab;
        S.set(x, y, z, c);
      }
    }
  }
  // Opening with padded collar, tongue, laces.
  S.recolor((x, y, z, p) => (x < 21 && y >= 12 && Math.abs(z + 0.5 - zc) > wAt(x + 0.5) - 3 && p === leather ? collar : null));
  S.sub(() => shape(S, 2, 13, 0, 20, 37, 27, (x, y, z) => Math.abs(z - zc) < wAt(x) - 2.4 && x > 3.5, 1));
  shape(S, 2, 12, 0, 20, 12, 27, (x, y, z) => Math.abs(z - zc) < wAt(x) - 2.4 && x > 3.5, lining);
  S.box(19, 18, zc - 4, 22, 29, zc + 4, leather);
  S.box(21, 26, zc - 2, 22, 28, zc + 2, mid);
  for (let x = 24; x <= 38; x += 3) {
    const u = (x - 2) / 58, yt = Math.round(hu(u)) + 1;
    S.set(x, yt - 1, zc - 4, eyelet); S.set(x, yt - 1, zc + 4, eyelet);
    S.line(x, yt, zc - 4, x + 3, yt - 0.5, zc + 4, lace, 0);
    S.line(x, yt, zc + 4, x + 3, yt - 0.5, zc - 4, lace, 0);
  }
  S.line(26, 22, zc + 5, 31, 6, zc + 11, lace, 0);
  S.line(31, 6, zc + 11, 36, 1, zc + 12, lace, 0);
  const rz = [0, 9, -7][frame], pv = frame === 2 ? [60, 0, zc] : [2, 0, zc];
  const dp = [pv[0] + 5, 0, 17];
  stampRot(m, S, pv, dp, 0, 0, rz);
  const X = (p) => xformPt(p, pv, dp, 0, 0, rz);
  return { m, yaw: 30, ground: [36, 0, 17], anchors: { opening: X([11, 20, zc]), toe: X([58, 3, zc]) } };
});
function smoothT(a, b, v) { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }

def('bowling_pins', {
  name: 'Bowling Set', biome: 'aquarium', tags: ['dumb', 'toy'], decor: { price: 140, size: 1 }, decorOnly: true,
  desc: 'Strike every time. The pins reset themselves out of pure professionalism.',
  interact: {
    verb: 'Strike!', frames: 3, seq: [2, 1, 1, 1, 1, 1, 1, 0], fps: 5,
    sfx: [['thunder', 0, { vol: 0.35, pitch: 1.7 }], ['box_close', 0.15], ['mash_pop', 0.18], ['mash_pop', 0.24], ['timing_perfect', 0.5]],
    fx: [{ at: 0.2, kind: 'text', from: 'top', text: 'STRIKE!' }, { at: 0.2, kind: 'confetti', from: 'pins', n: 18 }],
    fish: 'flee',
  },
}, ({ frame }) => {
  const m = new VoxelModel(58, 46, 50);
  const P = part(m, 12, 34, 12);
  const white = m.color('#f8f6f0', { smooth: 0.8, spec: 1.2, jitter: 0.02 });
  const stripe = m.color('#d83a3a', { smooth: 0.8, spec: 1, jitter: 0.02 });
  const maple = m.color('#e8c890', { jitter: 0.04 });
  const mapleD = m.color('#d0aa70', { jitter: 0.04 });
  const arrow = m.color('#5a3a2a', { jitter: 0 });
  const ballA = m.color('#3a2a7a', { spec: 2.4, specPow: 14, smooth: 0.9 });
  const ballB = m.color('#7a5ad8', { spec: 2.4, specPow: 14, smooth: 0.9 });
  const hole = m.color('#120c20', { jitter: 0 });
  const K = [[0, 2.4], [0.25, 4.1], [0.62, 1.7], [0.82, 2.7], [1, 0.4]];
  lathe(P, 6, 6, 0, 30, (t) => {
    let i = 0; while (i < K.length - 2 && t > K[i + 1][0]) i++;
    const [t0, r0] = K[i], [t1, r1] = K[i + 1], k = (t - t0) / (t1 - t0);
    return r0 + (r1 - r0) * (0.5 - Math.cos(k * Math.PI) / 2);
  }, (x, y) => ((y >= 17 && y <= 18) || (y >= 20 && y <= 21) ? stripe : white));
  m.box(4, 0, 4, 53, 1, 47, (x, y, z) => (x % 4 === 0 ? mapleD : maple));
  for (const ax of [14, 28, 42]) { m.set(ax, 2, 44, arrow); m.set(ax - 1, 2, 45, arrow); m.set(ax + 1, 2, 45, arrow); }
  const spots = [[28, 34], [23, 27], [33, 27], [18, 20], [28, 20], [38, 20]];
  spots.forEach(([px, pz], k) => {
    if (frame === 0) stampRot(m, P, [6, 0, 6], [px, 2, pz]);
    else if (frame === 2) stampRot(m, P, [6, 0, 6], [px, 2, pz], k % 2 ? 40 : -30, k * 40, k % 2 ? 0 : 38);
    else stampRot(m, P, [6, 0, 6], [px + (k % 3 - 1) * 6, 6, pz + (k % 2 ? 3 : -4)], k % 2 ? 88 : 0, k * 47, k % 2 ? 0 : 88);
  });
  const [bx, bz] = frame === 0 ? [46, 41] : [28, 28];
  m.sphere(bx, 8, bz, 6, (x, y, z) => (fbm3(x * 0.25, y * 0.25, z * 0.25, 2, 9) > 0.52 ? ballB : ballA));
  for (const [hx, hy] of [[-1.6, 3], [1.6, 3], [0, 0.5]]) { const z = frontZ(bx, 8, bz, 6, bx + hx, 8 + hy); if (z !== null) m.box(bx + hx, 8 + hy, z - 1, bx + hx, 8 + hy, z + 1, hole); }
  return { m, yaw: 30, ground: [28, 0, 26], anchors: { top: [28, 38, 26], pins: [28, 14, 27] } };
});

def('hot_tub', {
  name: 'Hot Tub', biome: 'aquarium', tags: ['home', 'glow'], decor: { price: 550, size: 2 }, decorOnly: true,
  desc: 'Bubbling cedar hot tub with a tiny cocktail. Fish-only, no splashing (they splash).',
  interact: {
    verb: 'Jets on', frames: 3, idle: [1, 2], idleFps: 2.5, seq: [1, 2, 1, 2, 1, 2, 1, 2, 1, 2], fps: 8,
    sfx: [['bubbles', 0], ['bubbles', 0.35], ['flood_rush', 0.1, { vol: 0.2, pitch: 1.6 }]],
    fx: [{ at: 0, kind: 'bubbles', from: 'water', n: 20 }, { at: 0.4, kind: 'bubbles', from: 'water', n: 14 }, { at: 0.2, kind: 'steam', from: 'top', n: 10 }],
    ambient: [{ kind: 'bubbles', from: 'water', every: 1.5, n: 2 }], fish: 'gather', use: { kind: 'sit', at: 'water', emote: 'heart' },
  },
}, ({ frame }) => {
  const m = new VoxelModel(62, 32, 60);
  const cedar = [m.color('#b8703a', { jitter: 0.05 }), m.color('#a0602e', { jitter: 0.05 })];
  const band = m.color('#4a4a52', { spec: 1 });
  const rim = m.color('#d8a868', { jitter: 0.04 });
  const water = m.color('#4ad8e0', { emissive: 0.35, smooth: 0.4, jitter: 0.02 });
  const foam = m.color('#f4fcff', { smooth: 0.9, emissive: 0.15 });
  const step = [m.color('#c8884a', { jitter: 0.04 }), m.color('#a86e3a', { jitter: 0.04 })];
  const towel = [m.color('#ff7ab0', { smooth: 0.4 }), m.color('#fff4f8', { smooth: 0.4 })];
  const glass = m.color('#d8f4ff', { spec: 2 });
  const drink = m.color('#ff9a3a', { emissive: 0.2 });
  const umb = m.color('#ff4a8a', { smooth: 0.3 });
  const yel = m.color('#ffd23a', { smooth: 0.85, spec: 1.4 }), beak = m.color('#ff8a2a'), eye = m.color('#1a1a22', { jitter: 0 });
  const cx = 31, cz = 28, R = 22;
  const oct = (x, z, r) => { const dx = Math.abs(x - cx), dz = Math.abs(z - cz); return Math.max(dx, dz, (dx + dz) * 0.7071) <= r; };
  shape(m, cx - R, 0, cz - R, cx + R, 18, cz + R, (x, y, z) => oct(x, z, R), (x, y, z) => (y === 4 || y === 14 ? band : cedar[Math.floor((Math.atan2(z + 0.5 - cz, x + 0.5 - cx) + Math.PI) * 6) % 2]));
  shape(m, cx - R - 1, 19, cz - R - 1, cx + R + 1, 20, cz + R + 1, (x, y, z) => oct(x, z, R + 0.8) && !oct(x, z, R - 3.5), rim);
  m.sub(() => shape(m, cx - R, 5, cz - R, cx + R, 20, cz + R, (x, y, z) => oct(x, z, R - 3.2), 1));
  shape(m, cx - R, 15, cz - R, cx + R, 15, cz + R, (x, y, z) => oct(x, z, R - 3.2), water);
  const nb = frame === 0 ? 6 : 22;
  for (let i = 0; i < nb; i++) {
    const a = h3(i, frame, 1, 4) * Math.PI * 2, r = Math.sqrt(h3(i, frame, 2, 4)) * (R - 6);
    m.sphere(cx + Math.cos(a) * r, 16, cz + Math.sin(a) * r, 0.9 + h3(i, frame, 3, 4) * (frame ? 1.1 : 0.4), foam);
  }
  miniDuck(m, cx - 6, 15, cz + 6, 0.9, yel, beak, eye, 1);
  // Steps in front, towel over the side, a cocktail on the rim.
  m.box(cx - 8, 0, cz + R + 1, cx + 8, 5, cz + R + 7, (x, y, z) => step[z % 3 === 0 ? 1 : 0]);
  m.box(cx - 8, 6, cz + R + 1, cx + 8, 11, cz + R + 3, (x, y, z) => step[z % 3 === 0 ? 1 : 0]);
  m.box(cx + R - 3, 21, cz - 6, cx + R + 1, 21, cz + 4, (x, y, z) => towel[(z >> 1) % 2]);
  m.box(cx + R + 1, 9, cz - 6, cx + R + 1, 21, cz + 4, (x, y, z) => towel[(z >> 1) % 2]);
  const gx = cx + 14, gz = cz - 14;
  m.cylinder(gx, gz, 21, 21, 1.4, glass); m.box(gx, 22, gz, gx, 23, gz, glass);
  m.cone(gx, gz, 24, 26, 0.8, 2.2, drink);
  m.line(gx, 26, gz, gx + 1, 30, gz, glass, 0);
  m.cone(gx + 1, gz, 30, 31, 2.4, 0.3, umb);
  // Front walls only: drawn over a fish soaking in the tub.
  const inner = new Set([water, foam, yel, beak, eye]);
  const front = (x, y, z) => z + 0.5 > cz - 2 && !inner.has(m.get(x, y, z));
  return { m, yaw: 30, pitch: 30, ground: [cx, 0, cz], light: '#4ad8e0', front, anchors: { water: [cx, 17, cz], top: [cx, 24, cz] } };
});

def('map_table', {
  name: 'Treasure Map Table', biome: 'aquarium', tags: ['treasure', 'wreck'], decor: { price: 360, size: 2 }, decorOnly: true,
  desc: 'X marks the spot. The spot is, annoyingly, this table.',
  interact: {
    verb: 'Read map', frames: 3, seq: [1, 2, 2, 2, 2, 2, 1, 0], fps: 3,
    sfx: [['ui_page', 0], ['magic', 0.7], ['sparkle', 0.9]],
    fx: [{ at: 0.7, kind: 'sparkle', from: 'x', n: 10, colors: ['#ffe27a', '#ff7a5a'] }, { at: 0.9, kind: 'text', from: 'top', text: 'X MARKS THE SPOT' }],
    fish: 'gather',
  },
}, ({ frame }) => {
  const m = new VoxelModel(58, 40, 46);
  const wood = [m.color('#8a5a34', { jitter: 0.06 }), m.color('#74482a', { jitter: 0.06 })];
  const parch = m.color('#f0dca8', { jitter: 0.04 });
  const parchD = m.color('#d4b67a', { jitter: 0.04 });
  const land = m.color('#8ab060', { jitter: 0.04 });
  const inkC = m.color('#6a4a2a', { jitter: 0 });
  const path = m.color('#c83a2a', { jitter: 0 });
  const xC = frame === 2 ? m.color('#ff4a2a', { emissive: 1, jitter: 0 }) : m.color('#c82a2a', { jitter: 0 });
  const gold = m.color('#f0c040', { spec: 1.6 });
  const wax = m.color('#f8f0dc', { smooth: 0.6 });
  const flame = m.color('#ffc84a', { emissive: 1, jitter: 0 });
  const steel = m.color('#d0d8e4', { spec: 2 });
  const ribbon = m.color('#d83a4a', { jitter: 0 });
  m.box(4, 18, 6, 53, 20, 39, (x, y, z) => (z % 6 === 0 ? wood[1] : wood[0]));
  for (const [lx, lz] of [[7, 9], [50, 9], [7, 36], [50, 36]]) lathe(m, lx, lz, 0, 17, (t) => 1.6 + Math.sin(t * Math.PI * 3) * 0.6, wood[1]);
  m.box(8, 5, 9, 49, 5, 9, wood[1]); m.box(8, 5, 36, 49, 5, 36, wood[1]);
  if (frame === 0) {
    m.cylinder(22.5, 22, 14, 42, 2.4, parch, 'x');
    m.cylinder(22.5, 22, 13, 13, 2.8, parchD, 'x'); m.cylinder(22.5, 22, 43, 43, 2.8, parchD, 'x');
    m.cylinder(22.5, 22, 28, 29, 2.6, ribbon, 'x');
    m.cylinder(36, 30, 21, 21, 2.4, gold); m.line(34.5, 22, 30, 37.5, 22, 30, path, 0);
  } else {
    // Flat map: parchment, islands, dotted path, X, compass rose, curled corners.
    for (let x = 10; x <= 46; x++) for (let z = 10; z <= 34; z++) {
      const edge = x === 10 || x === 46 || z === 10 || z === 34;
      const isl = fbm3(x * 0.13, 0, z * 0.13, 2, 4) > 0.58;
      m.set(x, 21, z, edge ? parchD : isl ? land : parch);
    }
    for (const [x, z] of [[10, 10], [46, 10], [10, 34], [46, 34]]) m.set(x, 22, z, parchD);
    for (let t = 0; t <= 1; t += 0.035) {
      if (Math.floor(t * 28) % 2) continue;
      m.set(14 + t * 24, 22, 30 - t * 14 + Math.sin(t * 6) * 3, path);
    }
    for (let k = -2; k <= 2; k++) { m.set(38 + k, 22, 16 + k, xC); m.set(38 + k, 22, 16 - k, xC); }
    for (const [dx, dz] of [[0, -2], [0, 2], [-2, 0], [2, 0], [0, 0]]) m.set(16 + dx, 22, 14 + dz, inkC);
    m.line(44, 21, 24, 44, 26, 25, steel, 0); m.box(42, 27, 25, 46, 27, 25, gold); m.box(44, 28, 25, 44, 30, 25, wood[1]); m.set(44, 31, 25, gold);
  }
  m.cylinder(49, 12, 21, 21, 2.6, gold);
  lathe(m, 49, 12, 22, 28, () => 1.3, wax);
  m.box(49, 29, 12, 49, 30, 12, flame);
  for (let i = 0; i < 4; i++) m.cylinder(8, 30, 21 + i, 21 + i, 1.6, gold);
  m.cylinder(11, 33, 21, 21, 1.6, gold);
  return { m, yaw: 30, pitch: 32, ground: [28, 0, 22], light: '#ffc84a', anchors: { x: [38, 23, 16], top: [28, 32, 22] } };
});

// Lava lamps: shared builder (k scales the whole lamp), frames shift the blobs.
function lavaLamp(sc, frame, k = 1, opts = {}) {
  const N = Math.round(26 * k);
  const m = new VoxelModel(N, Math.round(70 * k), N);
  const metal = [m.color(opts.metal || '#b8c0cc', { jitter: 0.04, smooth: 0.7, spec: 2, specPow: 10 }), m.color(opts.metal2 || '#8e96a4', { jitter: 0.04, smooth: 0.7 })];
  const liquid = m.color(sc[0], { emissive: 0.75, jitter: 0.02, smooth: 0.6 });
  const blobC = m.color(sc[1], { emissive: 1, jitter: 0.02, smooth: 0.6 });
  const starC = opts.stars ? m.color('#ffffff', { emissive: 1, jitter: 0 }) : 0;
  const cx = N / 2, cz = N / 2;
  m.cone(cx, cz, 0, 18 * k, 9 * k, 5 * k, metal[1]);
  m.cylinder(cx, cz, 0, Math.max(1, k), 9.5 * k, metal[0]);
  m.cylinder(cx, cz, 17 * k, 18 * k, 5.6 * k, metal[0]);
  const y0 = Math.round(19 * k), y1 = Math.round(56 * k);
  for (let y = y0; y < y1; y++) {
    const t = (y - y0) / (y1 - y0);
    const r = (5.2 + Math.sin(t * Math.PI * 0.9 + 0.2) * 2.2 - t * 1.6) * k;
    m.cylinder(cx, cz, y, y, r, (x, yy, z) => (starC && h3(x, yy, z, 3 + frame) < 0.04 ? starC : liquid));
  }
  const blobs = [[22, 4.6, 0, 3], [32, 3.2, 2, 4.5], [40, 3.4, -1.5, 3.5], [49, 2.6, 1, 3], [28, 2.2, -3.5, 3.5], [45, 2, 3, 2]];
  blobs.forEach(([by, br, bx, bz], i) => {
    const y = clamp(by + (Math.sin((frame / 4) * Math.PI * 2 + i * 1.7) - Math.sin(i * 1.7)) * (i % 2 ? 3 : 4), 21, 53);
    m.sphere(cx + bx * k, y * k, cz + bz * k, br * k, (x, yy, z, p) => (p || Math.hypot(x + 0.5 - cx, z + 0.5 - cz) < 7.6 * k ? blobC : null));
  });
  m.cone(cx, cz, 56 * k, 62 * k, 4 * k, 2.6 * k, metal[0]);
  m.cylinder(cx, cz, 62 * k, 63 * k, 2.2 * k, metal[1]);
  return { m, yaw: 30, light: sc[0], ground: [cx, 0, cz], anchors: { top: [cx, 58 * k, cz], center: [cx, 36 * k, cz] } };
}
const LAMP_INTERACT = {
  verb: 'Swirl', frames: 4, idle: [0, 1, 2, 3], idleFps: 1.2, seq: [0, 1, 2, 3, 0, 1, 2, 3, 0], fps: 8,
  sfx: [['bubble', 0, { pitch: 0.6 }], ['magic', 0.15, { vol: 0.4 }]],
  fx: [{ at: 0.1, kind: 'sparkle', from: 'top', n: 6 }, { at: 0.3, kind: 'bubbles', from: 'top', n: 6 }], fish: 'gather',
};
def('lava_lamp_giant', { name: 'Giant Lava Lamp', biome: 'aquarium', tags: ['glow', 'retro'], decor: { price: 520, size: 2 }, decorOnly: true, desc: 'The same groovy lamp, but taller than most of your fish.', interact: LAMP_INTERACT },
  ({ variant, frame }) => lavaLamp(LAVA[(variant + 4) % LAVA.length], frame, 1.5));
def('lava_lamp_slime', { name: 'Slime Lamp', biome: 'aquarium', tags: ['glow', 'retro'], decor: { price: 260, size: 1 }, decorOnly: true, desc: 'Toxic-green goo in a lamp. Probably fine.', interact: LAMP_INTERACT },
  ({ frame }) => lavaLamp(LAVA[3], frame, 1, { metal: '#4a4e5a', metal2: '#2e323c' }));
def('lava_lamp_galaxy', { name: 'Galaxy Lamp', biome: 'aquarium', tags: ['glow', 'retro'], decor: { price: 300, size: 1 }, decorOnly: true, desc: 'A pocket universe with drifting nebula blobs.', interact: LAMP_INTERACT },
  ({ frame }) => lavaLamp(LAVA[5], frame, 1, { stars: true, metal: '#d8c890', metal2: '#a89060' }));

def('plasma_globe', {
  name: 'Plasma Globe', biome: 'aquarium', tags: ['glow', 'machine'], decor: { price: 380, size: 1 }, decorOnly: true,
  desc: 'Crackling lightning in a ball. Do not lick. (The fish lick it.)',
  interact: {
    verb: 'Zap', frames: 4, idle: [0, 1, 2, 3], idleFps: 5, seq: Array.from({ length: 16 }, (_, i) => i % 4), fps: 14,
    sfx: [['static_burst', 0, { vol: 0.5 }], ['glitch', 0.2, { vol: 0.35 }], ['magic', 0.4, { pitch: 1.4, vol: 0.5 }]],
    fx: [{ at: 0.1, kind: 'sparkle', from: 'orb', n: 12, colors: ['#ff9aff', '#d8b0ff', '#ffffff'] }, { at: 0.5, kind: 'sparkle', from: 'orb', n: 8, colors: ['#ff9aff', '#ffffff'] }],
    fish: 'gather',
  },
}, ({ frame }) => {
  const m = new VoxelModel(44, 48, 44);
  const base = m.color('#1e1c26', { spec: 1.4, smooth: 0.5 });
  const chrome = m.color('#c8d0dc', { spec: 2 });
  const back = m.color('#2a1a4a', { emissive: 0.15, smooth: 0.8 });
  const glass = m.color('#c8e8ff', { spec: 2, light: 0.3, jitter: 0 });
  const orb = m.color('#f4d0ff', { emissive: 1, jitter: 0, smooth: 0.8 });
  const arc = m.color('#ff7aff', { emissive: 1, jitter: 0 });
  const tip = m.color('#ffe8ff', { emissive: 1, jitter: 0 });
  const cx = 22, cz = 22, cy = 28, R = 14;
  lathe(m, cx, cz, 0, 12, (t) => (t < 0.3 ? 10 - t * 6 : 8.2 - t * 3.2), base);
  m.cylinder(cx, cz, 13, 13, 5.6, chrome);
  shape(m, cx - R, cy - R, cz - R, cx + R, cy + R, cz - 2, (x, y, z) => { const d = Math.hypot(x - cx, y - cy, z - cz); return d <= R && d > R - 0.9; }, back);
  torus(m, cx, cy, cz, R, 0.5, glass);
  torus(m, cx, cy, cz, R, 0.5, glass, 'z');
  for (let a = 2.1; a < 2.7; a += 0.06) m.set(cx + Math.cos(a) * (R - 1.5), cy + Math.sin(a) * (R - 1.5), cz + 6, glass);
  m.sphere(cx, cy, cz, 3.2, orb);
  for (let k = 0; k < 7; k++) {
    const th = (k / 7) * Math.PI * 2 + frame * 0.45 + Math.sin(k * 3.1 + frame) * 0.3;
    const ph = (h3(k, frame, 1, 6) - 0.5) * 1.5;
    let ez = Math.cos(ph) * Math.sin(th);
    if (ez < -0.3) ez = -ez;
    const E = [cx + R * 0.92 * Math.cos(ph) * Math.cos(th), cy + R * 0.92 * Math.sin(ph), cz + R * 0.92 * ez];
    let prev = [cx, cy, cz];
    for (let i = 1; i <= 6; i++) {
      const t = i / 6, j = i < 6 ? 1.3 : 0;
      const p = [cx + (E[0] - cx) * t + (h3(k, i, frame, 1) - 0.5) * 2 * j, cy + (E[1] - cy) * t + (h3(k, i, frame, 2) - 0.5) * 2 * j, cz + (E[2] - cz) * t + (h3(k, i, frame, 3) - 0.5) * 2 * j];
      m.line(prev[0], prev[1], prev[2], p[0], p[1], p[2], arc, 0);
      prev = p;
    }
    m.sphere(E[0], E[1], E[2], 1.2, tip);
  }
  return { m, yaw: 30, ground: [cx, 0, cz], light: '#ff9aff', anchors: { orb: [cx, cy, cz], top: [cx, cy + R, cz] } };
});

def('crystal_throne', {
  name: 'Crystal Throne', biome: 'aquarium', tags: ['crystal', 'glow', 'fancy'], decor: { price: 1200, size: 2 }, decorOnly: true,
  desc: 'Carved from one enormous amethyst. Whoever sits here is the fish king. For a bit.',
  interact: {
    verb: 'Glow', frames: 3, seq: [1, 2, 1, 2, 1, 2, 0], fps: 4,
    sfx: [['magic', 0], ['golden_shimmer', 0.2], ['bell', 0.5, { pitch: 0.6, vol: 0.5 }]],
    fx: [{ at: 0.1, kind: 'sparkle', from: 'back', n: 14, colors: ['#e0b0ff', '#ffffff', '#b46bff'] }, { at: 0.5, kind: 'icons', icon: 'crown', from: 'seat', n: 1 }],
    fish: 'gather', use: { kind: 'sit', at: 'seat', emote: 'crown' },
  },
}, ({ frame }) => {
  const m = new VoxelModel(64, 90, 52);
  const stoneD = m.color('#3a3456', { jitter: 0.06 });
  const stone = m.color('#4a4468', { jitter: 0.06 });
  const gold = m.color('#f2c84a', { spec: 1.6 });
  const velvet = m.color('#8a2a6a', { smooth: 0.65, jitter: 0.03 });
  const glowK = [0.25, 0.65, 0.95][frame];
  const cr = [m.color(frame === 2 ? '#c88aff' : '#9a5af0', { emissive: glowK, smooth: 0.2 }), m.color('#e0b8ff', { emissive: glowK, smooth: 0.2 }), m.color('#5a2aa8', { emissive: glowK * 0.6, smooth: 0.2 })];
  const rune = m.color('#5af4ff', { emissive: frame === 2 ? 1 : 0.2, jitter: 0 });
  const cx = 32, cz = 26;
  m.box(6, 0, 4, 57, 3, 49, stoneD);
  m.box(10, 4, 8, 53, 7, 45, stone);
  for (let x = 12; x <= 51; x += 3) m.box(x, 5, 46, x + 1, 6, 46, rune);
  // Crystal shards fanning out behind the backrest.
  for (const [dx, len, r, tilt] of [[0, 30, 5, 0], [-7, 24, 4, -0.26], [7, 25, 4, 0.26], [-12, 18, 3.4, -0.55], [12, 19, 3.4, 0.55], [-3, 20, 3, -0.1], [4, 22, 3, 0.12]]) {
    shaft(m, [cx + dx, 44, 12], [Math.sin(tilt), Math.cos(tilt), -0.12], len, r, 7, (x, y) => (y > 44 + len * 0.8 ? cr[1] : h3(x, y, 0, 2) < 0.15 ? cr[2] : cr[0]), 6, dx * 0.1);
  }
  m.box(17, 8, 12, 46, 19, 38, stone);
  m.box(17, 19, 38, 46, 19, 38, gold);
  rbox(m, 18, 20, 14, 45, 23, 37, 1.6, velvet);
  for (const ax of [12, 46]) { m.box(ax, 20, 14, ax + 5, 29, 38, stone); m.box(ax, 30, 14, ax + 5, 30, 38, gold); m.sphere(ax + 2.5, 33, 35, 3, cr[1]); }
  m.box(17, 20, 10, 46, 54, 15, stone);
  for (let y = 20; y <= 54; y++) { m.set(17, y, 15, gold); m.set(46, y, 15, gold); }
  m.box(17, 54, 15, 46, 54, 15, gold);
  for (const [x, y] of [[cx - 4, 56], [cx, 58], [cx + 4, 56], [cx - 4, 55], [cx + 4, 55], [cx - 2, 55], [cx + 2, 55], [cx, 55], [cx, 57]]) m.box(x, y, 12, x, y, 14, gold);
  for (const [x, z] of [[8, 6], [55, 6], [8, 47], [55, 47]]) shaft(m, [x, 3, z], [0.1 * Math.sign(x - cx), 1, 0.1 * Math.sign(z - cz)], 9, 1.8, 3, cr[0], 6);
  return { m, yaw: 30, ground: [cx, 0, cz], light: '#c88aff', anchors: { seat: [cx, 26, 30], back: [cx, 62, 12] } };
});

def('sunken_car', {
  name: 'Sunken Beetle', biome: 'aquarium', tags: ['wreck', 'metal', 'home'], decor: { price: 800, size: 3 }, decorOnly: true,
  desc: 'A rusty little car that drove off a pier in 1972. The horn still works.',
  interact: {
    verb: 'Honk', frames: 3, seq: [1, 2, 1, 2, 1, 0], fps: 4,
    sfx: [['honk', 0, { pitch: 0.7 }], ['honk', 0.28, { pitch: 0.75 }]],
    fx: [{ at: 0.1, kind: 'bubbles', from: 'exhaust', n: 10 }, { at: 0, kind: 'text', from: 'front', text: 'BEEP BEEP' }],
    fish: 'flee', use: { kind: 'hide', at: 'window' },
  },
}, ({ frame, rng }) => {
  const m = new VoxelModel(92, 50, 54);
  const paint = m.color('#7ad8b8', { smooth: 0.55, spec: 0.7, jitter: 0.04 });
  const paintD = m.color('#5ab89a', { smooth: 0.55, jitter: 0.04 });
  const glass = m.color('#2a3a4a', { spec: 2, specPow: 10 });
  const tire = m.color('#24242a', { smooth: 0.5 });
  const chrome = m.color('#d0d8e2', { spec: 2.2, smooth: 0.5 });
  const head = m.color(frame === 1 ? '#fff6c0' : '#d8e8f0', frame === 1 ? { emissive: 1, jitter: 0 } : { spec: 2 });
  const tail = m.color('#ff3a3a', { emissive: frame === 1 ? 1 : 0.15 });
  const ind = m.color('#ffa83a', { emissive: frame === 2 ? 1 : 0.1 });
  const kelp = [m.color('#4fa25e', { smooth: 0.3 }), m.color('#86cf74', { smooth: 0.3 })];
  const cz = 26;
  const H = (x) => { const u = (x - 44) / 36; if (Math.abs(u) >= 1) return 0; return 24 * Math.sqrt(1 - u * u) * (x > 56 ? 1 - (x - 56) / 70 : 1); };
  const W = (x) => 16 * Math.sqrt(Math.max(0, 1 - ((x - 44) / 39) ** 4));
  shape(m, 6, 7, 8, 82, 34, 44, (x, y, z) => { const h = H(x), w = W(x); return h > 0 && w > 0 && ((z - cz) / w) ** 2 + ((y - 7) / h) ** 2 <= 1; }, paint);
  for (const [fx, fz] of [[22, 10], [68, 10], [22, 42], [68, 42]]) shape(m, fx - 10, 7, fz - 5, fx + 10, 16, fz + 5, (x, y, z) => ((x - fx) / 9.5) ** 2 + ((y - 9) / 7) ** 2 + ((z - fz) / 4.5) ** 2 <= 1, paintD);
  m.box(28, 7, 8, 60, 8, 10, paintD); m.box(28, 7, 42, 60, 8, 44, paintD);
  // Windows: windscreen, side windows split by the B-pillar, rear window.
  surface(m, (x, y, z, p) => {
    if (p !== paint || y < 21 || y > 29) return null;
    if (x >= 52 && x <= 58) return glass;
    if (x >= 22 && x <= 27) return glass;
    if (Math.abs(z + 0.5 - cz) > 9 && x > 29 && x < 51 && (x < 40 || x > 42)) return glass;
    return null;
  });
  // Rust patches.
  const rust = [m.color('#c27840', { jitter: 0.08 }), m.color('#a4552f', { jitter: 0.08 })];
  m.recolor((x, y, z, p) => ((p === paint || p === paintD) && fbm3(x * 0.12, y * 0.12, z * 0.12, 2, 7) > 0.64 ? rust[h3(x, y, z, 2) < 0.5 ? 0 : 1] : null));
  for (const wx of [22, 68]) for (const [z0, z1, hz] of [[5, 10, 5], [42, 47, 47]]) { m.cylinder(wx, 7, z0, z1, 7, tire, 'z'); m.cylinder(wx, 7, hz, hz, 3.4, chrome, 'z'); }
  m.box(80, 8, 12, 81, 10, 40, chrome); m.box(9, 8, 12, 10, 10, 40, chrome);
  for (const hz of [13, 39]) { m.cylinder(15, hz, 76, 78, 2.6, head, 'x'); m.box(12, 13, hz - 1, 13, 15, hz + 1, tail); m.box(74, 10, hz - 2, 75, 11, hz - 2 + (hz > 20 ? 4 : 0), ind); }
  m.cylinder(8, 36, 5, 9, 1, chrome, 'x');
  starfish(m, 68, Math.round(7 + H(68)), cz + 2, 4, m.color('#ff7a4a', { smooth: 0.5 }), m.color('#ffd0a0'));
  for (let k = 0; k < 3; k++) {
    const kx = 36 + k * 5, kz = cz - 4 + k * 3;
    let ky = 0; for (let y = 40; y > 10; y--) if (m.get(kx, y, kz)) { ky = y; break; }
    for (let y = 1; y < 12 + k * 4; y++) m.set(kx + Math.round(Math.sin(y * 0.5 + k) * 1.2), ky + y, kz, kelp[y % 5 === 0 ? 1 : 0]);
  }
  sandMound(m, 46, cz, 44, 25, 5, 3);
  barnacles(m, rng, 6, [paint, paintD]);
  return { m, yaw: 30, light: '#fff6c0', ground: [46, 0, cz], anchors: { window: [42, 26, 44], exhaust: [5, 8, 36], front: [84, 18, cz] } };
});

const ROCKET_SEQ = [1, 1, 2, 2, ...Array(29).fill(2), 2, 1, 1, 0];
def('rocket_ship', {
  name: 'Retro Rocket', biome: 'aquarium', tags: ['machine', 'glow'], decor: { price: 950, size: 2 }, decorOnly: true,
  desc: 'Fully functional. Goes up, comes back down. The pilot is a goldfish named Major Tom.',
  interact: {
    verb: 'Launch', frames: 4, seq: ROCKET_SEQ, fps: 6,
    motion: { t0: 0.6, t1: 5.4, base: 3, part: 2, path: [[0.6, 0], [1.1, -8], [1.7, -80], [2.4, -640], [3.4, -640], [4.6, -110], [5.4, 0]] },
    sfx: [['click', 0], ['puff', 0.2, { pitch: 0.7 }], ['travel_whoosh', 0.6, { vol: 0.7 }], ['thunder', 0.7, { vol: 0.45, pitch: 1.3 }], ['travel_whoosh', 3.7, { vol: 0.4, pitch: 0.7 }], ['box_close', 5.4], ['puff', 5.45]],
    fx: [{ at: 0.25, kind: 'smoke', from: 'pad', n: 10 }, { at: 0.65, kind: 'smoke', from: 'pad', n: 16 }, { at: 0.9, kind: 'embers', from: 'nozzle', n: 10, track: true }, { at: 1.3, kind: 'embers', from: 'nozzle', n: 10, track: true },
      { at: 1.7, kind: 'smoke', from: 'nozzle', n: 8, track: true }, { at: 4.4, kind: 'embers', from: 'nozzle', n: 8, track: true }, { at: 4.9, kind: 'embers', from: 'nozzle', n: 8, track: true }, { at: 5.4, kind: 'smoke', from: 'pad', n: 12 }],
    fish: 'flee', shake: 0.6,
  },
}, ({ frame }) => {
  const m = new VoxelModel(52, 98, 52);
  const con = m.color('#9a9aa2', { jitter: 0.06 });
  const hz = [m.color('#ffd84a', { jitter: 0.02 }), m.color('#24242a', { jitter: 0.02 })];
  const pit = m.color('#2a2a30', { jitter: 0 });
  const red = m.color('#d83a2a', { spec: 0.8, jitter: 0.03 });
  const grey = m.color('#7a7e88', { spec: 1 });
  const beacon = m.color('#ff3a3a', { emissive: 1, jitter: 0 });
  const white = m.color('#f2f2f6', { smooth: 0.7, spec: 1.2, jitter: 0.02 });
  const rRed = m.color('#e04a3a', { smooth: 0.7, spec: 1.2, jitter: 0.02 });
  const brass = m.color('#e0b048', { spec: 1.6 });
  const nozzle = m.color('#3a3a44', { spec: 1 });
  const portF = m.color('#ff9a3a', { emissive: 0.5 });
  const portB = m.color('#9ae8ff', { emissive: 0.5 });
  const eye = m.color('#1a1420', { jitter: 0 });
  const fl = ['#ff6a2a', '#ffb04a', '#fff4b0'].map((c) => m.color(c, { emissive: 1, jitter: 0 }));
  const cx = 26, cz = 26, rx = 27, rz = 27;
  lathe(m, cx, cz, 0, 3, () => 23, con);
  shape(m, cx - 22, 3, cz - 22, cx + 22, 3, cz + 22, (x, y, z) => { const r = Math.hypot(x - cx, z - cz); return r >= 18.5 && r <= 21.5; }, (x, y, z) => hz[Math.floor((Math.atan2(z + 0.5 - cz, x + 0.5 - cx) + Math.PI) * 5) % 2]);
  m.sub(() => m.cylinder(rx, rz, 2, 3, 5));
  m.cylinder(rx, rz, 1, 1, 5, pit);
  // Gantry tower (always taller than the rocket so every frame keeps the same bounds).
  for (const [px, pz] of [[5, 5], [11, 5], [5, 11], [11, 11]]) m.box(px, 3, pz, px, 92, pz, red);
  for (let y = 4; y < 92; y += 6) { m.line(5, y, 11, 11, y + 6, 11, red, 0); m.line(11, y, 5, 11, y + 6, 11, red, 0); }
  for (const y of [30, 50, 70, 90]) m.box(4, y, 4, 12, y, 12, grey);
  m.box(7, 93, 7, 9, 94, 9, beacon);
  for (const [sx, sz] of [[rx - 5, rz - 5], [rx + 5, rz - 5], [rx - 5, rz + 5], [rx + 5, rz + 5]]) m.box(sx, 4, sz, sx, 13, sz, grey);
  if (frame === 0) m.line(11, 62, 9, rx - 6, 62, rz - 4, grey, 0.8); else m.box(11, 62, 8, 14, 62, 10, grey);
  if (frame === 3) {
    // Launched: a lingering exhaust column (also keeps the model dense enough for the ray caster's brick skipping).
    const smoke = [m.color('#d8dce4', { smooth: 0.9, jitter: 0.04 }), m.color('#b8bcc8', { smooth: 0.9, jitter: 0.04 })];
    for (let y = 6; y <= 88; y += 3) m.sphere(rx + Math.sin(y * 0.3) * 1.5, y, rz + Math.cos(y * 0.23), 4.6 - y * 0.03 + h3(y, 1, 1, 3) * 1.4, smoke[(y / 3) % 2]);
    return { m, yaw: 30, ground: [cx, 0, cz], anchors: { nozzle: [rx, 8, rz], pad: [cx, 5, 40], top: [rx, 86, rz] } };
  }
  // The rocket (and its exhaust) lives in its own layer so it can fly.
  const R = part(m, 52, 98, 52);
  lathe(R, rx, rz, 14, 17, (t) => 4.8 + t * 1.7, white);
  lathe(R, rx, rz, 18, 64, () => 6.5, (x, y) => ((y >= 30 && y <= 32) || (y >= 56 && y <= 58) ? rRed : white));
  lathe(R, rx, rz, 65, 82, (t) => 6.5 * Math.pow(Math.cos((t * Math.PI) / 2), 0.7), rRed);
  R.line(rx, 82, rz, rx, 86, rz, grey, 0);
  lathe(R, rx, rz, 11, 14, (t) => 4.4 - t * 1.4, nozzle);
  for (const [py, c] of [[48, portF], [39, portB]]) {
    torus(R, rx, py, rz + 6.4, 2.6, 0.6, brass, 'z');
    R.cylinder(rx, py, rz + 6, rz + 6.6, 2.1, c, 'z');
    if (c === portF) { R.set(rx + 1, py + 1, rz + 7, eye); R.set(rx - 1, py, rz + 7, portF); }
  }
  for (const a of [Math.PI / 2, (Math.PI * 7) / 6, (Math.PI * 11) / 6]) {
    const ca = Math.cos(a), sa = Math.sin(a);
    for (let s = 6; s <= 13; s += 0.5) for (let y = 12; y <= 31; y++) {
      const u = (s - 6) / 7;
      if (y < 12 + u * 1 || y > 31 - u * 13) continue;
      R.set(rx + ca * s, y, rz + sa * s, rRed);
      R.set(rx + ca * s - sa * 0.6, y, rz + sa * s + ca * 0.6, rRed);
    }
  }
  if (frame >= 1) {
    const y0 = frame === 2 ? 2 : 7;
    for (let y = y0; y <= 10; y++) {
      const t = (10 - y) / (10 - y0 + 0.01), r = (frame === 2 ? 4.2 : 3) * (1 - t * 0.7);
      R.cylinder(rx, rz, y, y, r, (x, yy, z) => { const d = Math.hypot(x + 0.5 - rx, z + 0.5 - rz) / r; return fl[d < 0.4 && t < 0.7 ? 2 : d < 0.75 ? 1 : 0]; });
    }
  }
  for (let i = 0; i < R.data.length; i++) if (R.data[i]) m.data[i] = R.data[i];
  return { m, yaw: 30, ground: [cx, 0, cz], light: '#ffb04a', split: (x, y, z) => R.get(x, y, z) !== 0, anchors: { nozzle: [rx, 8, rz], pad: [cx, 5, 40], top: [rx, 86, rz] } };
});

def('cuckoo_clock', {
  name: 'Cuckoo Clock', biome: 'aquarium', tags: ['retro', 'home'], decor: { price: 240, size: 1 }, decorOnly: true,
  desc: 'Keeps perfect time. Unfortunately it is the wrong timezone.',
  interact: {
    verb: 'Cuckoo', frames: 4, idle: [0, 1], idleFps: 1.5, seq: [2, 3, 2, 3, 2, 3, 0, 1], fps: 4,
    sfx: [['chirp', 0, { pitch: 0.8 }], ['chirp', 0.25, { pitch: 0.62 }], ['chirp', 0.5, { pitch: 0.8 }], ['chirp', 0.75, { pitch: 0.62 }], ['click', 1.5]],
    fx: [{ at: 0, kind: 'text', from: 'door', text: 'CUCKOO!' }, { at: 0.2, kind: 'burst', from: 'door', n: 6, colors: ['#5ab8ff', '#ffffff'] }],
    fish: 'flee',
  },
}, ({ frame }) => {
  const m = new VoxelModel(42, 78, 34);
  const stone = m.color('#9a948c', { jitter: 0.08 });
  const wood = m.color('#7a4a2a', { jitter: 0.05 });
  const woodL = m.color('#9a643a', { jitter: 0.05 });
  const roof = [m.color('#4a2e1c', { jitter: 0.04 }), m.color('#5e3a22', { jitter: 0.04 })];
  const leaf = m.color('#5a8a3a', { jitter: 0.05 });
  const face = m.color('#f4ecd0', { jitter: 0.02 });
  const ink = m.color('#2a2028', { jitter: 0 });
  const gold = m.color('#e8b848', { spec: 1.6 });
  const dark = m.color('#1e1418', { jitter: 0 });
  const bird = m.color('#5ab8ff', { smooth: 0.7 });
  const beak = m.color('#ff9a2a', { jitter: 0 });
  const cone = [m.color('#5a3a22', { jitter: 0.04 }), m.color('#7a5230', { jitter: 0.04 })];
  const cx = 20.5, fz = 18;
  rbox(m, 13, 0, 5, 28, 3, 21, 1, stone);
  m.cylinder(cx, 12, 3, 36, 2.2, wood);
  m.box(7, 36, 6, 34, 62, fz, (x, y, z) => (z === fz && (x - 7) % 4 === 0 ? woodL : wood));
  shape(m, 2, 60, 3, 39, 73, 21, (x, y, z) => { const hw = (73 - y) * 1.5 + 1; const d = Math.abs(x - cx); return d <= hw && d > hw - 2.5; }, (x, y) => roof[(Math.floor(y) >> 1) % 2]);
  shape(m, 7, 62, fz, 34, 72, fz, (x, y) => Math.abs(x - cx) <= (73 - y) * 1.5 - 2, woodL);
  for (const [lx, ly] of [[cx - 4, 64], [cx + 4, 64], [cx, 67], [cx - 2, 65], [cx + 2, 65]]) m.box(lx - 1, ly, fz + 1, lx + 1, ly + 1, fz + 1, leaf);
  m.ellipsoid(cx, 75, 12, 2.4, 1.6, 1.6, woodL);
  // Clock face with hands.
  m.cylinder(cx, 45, fz + 1, fz + 1, 6.6, face, 'z');
  torus(m, cx, 45, fz + 1.5, 6.8, 0.5, gold, 'z');
  for (let k = 0; k < 12; k++) { const a = (k / 12) * Math.PI * 2; m.set(cx + Math.cos(a) * 5.3, 45 + Math.sin(a) * 5.3, fz + 2, ink); }
  m.line(cx, 45, fz + 2, cx - 3, 47, fz + 2, ink, 0);
  m.line(cx, 45, fz + 2, cx + 3, 49.5, fz + 2, ink, 0);
  // Little door and the bird.
  m.box(cx - 2.5, 53, fz + 1, cx + 2.5, 59, fz + 1, dark);
  if (frame < 2) { m.box(cx - 2.5, 53, fz + 2, cx - 0.5, 59, fz + 2, woodL); m.box(cx + 0.5, 53, fz + 2, cx + 2.5, 59, fz + 2, woodL); }
  else {
    m.box(cx - 3, 53, fz + 2, cx - 3, 59, fz + 5, woodL); m.box(cx + 3, 53, fz + 2, cx + 3, 59, fz + 5, woodL);
    const out = frame === 3 ? 2 : 0;
    m.line(cx, 55, fz + 1, cx, 55, fz + 5 + out, gold, 0);
    m.ellipsoid(cx, 56.5, fz + 4 + out, 2.4, 1.8, 2.6, bird);
    m.sphere(cx + 1, 58.5, fz + 5 + out, 1.6, bird);
    m.set(cx + 2, 59, fz + 6 + out, dark);
    if (frame === 3) { m.line(cx + 2, 58.5, fz + 6 + out, cx + 4, 59.5, fz + 8 + out, beak, 0); m.line(cx + 2, 58, fz + 6 + out, cx + 4, 57, fz + 8 + out, beak, 0); } else m.line(cx + 2, 58.5, fz + 6 + out, cx + 3.5, 58.5, fz + 7.5 + out, beak, 0);
  }
  // Pendulum ticks left / right, pine-cone weights on chains.
  const a = (frame % 2 ? 16 : -16) * (Math.PI / 180);
  const bx = cx + Math.sin(a) * 13, by = 36 - Math.cos(a) * 13;
  m.line(cx, 36, fz + 1, bx, by, fz + 1, gold, 0);
  m.cylinder(bx, by, fz + 1, fz + 1, 2.8, gold, 'z');
  m.set(bx, by, fz + 2, leaf);
  for (const [wx, wy] of [[14, 22], [27, 27]]) {
    m.line(wx, 36, fz - 2, wx, wy + 3, fz - 2, gold, 0);
    m.ellipsoid(wx, wy, fz - 2, 1.9, 3.6, 1.9, (x, y) => cone[y % 2]);
  }
  return { m, yaw: 28, ground: [cx, 0, 13], anchors: { door: [cx, 58, fz + 6], top: [cx, 76, 12] } };
});

def('gumball_machine', {
  name: 'Gumball Machine', biome: 'aquarium', tags: ['dumb', 'retro', 'treasure'], decor: { price: 200, size: 1 }, decorOnly: true,
  desc: 'Turn the crank! Sometimes it gives a gumball. Sometimes it gives you money. Nobody knows why.',
  interact: {
    verb: 'Turn crank', frames: 3, seq: [1, 1, 2, 2, 2, 0], fps: 5,
    sfx: [['reel_tick', 0], ['reel_tick', 0.1], ['reel_tick', 0.2], ['click', 0.4]],
    fx: [{ at: 0.55, kind: 'gumball', from: 'chute', n: 1 }],
    coin: { at: 0.6, from: 'chute', cooldown: 150 }, fish: 'gather',
  },
}, ({ frame }) => {
  const m = new VoxelModel(38, 62, 38);
  const red = m.color('#e03a3a', { spec: 1.4, smooth: 0.6, jitter: 0.02 });
  const redD = m.color('#b02a30', { smooth: 0.6 });
  const chrome = m.color('#d0d8e2', { spec: 2.2, smooth: 0.5 });
  const white = m.color('#ffffff', { jitter: 0 });
  const glint = m.color('#f4fbff', { spec: 2, light: 0.4 });
  const gums = ['#ff4a5a', '#ffd84a', '#4ac8ff', '#7ad84a', '#ff8ad8', '#ffffff', '#ff9a3a'].map((c) => m.color(c, { smooth: 0.6, spec: 1.5, specPow: 12 }));
  const cx = 19, cz = 19, gy = 41;
  lathe(m, cx, cz, 0, 4, (t) => 10 - t * 1.5, redD);
  lathe(m, cx, cz, 5, 17, (t) => 5 + t * 1.2, red);
  rbox(m, 10, 17, 10, 28, 30, 28, 3, red);
  torus(m, cx, 31, cz, 7, 0.8, chrome);
  m.sphere(cx, gy, cz, 11.5, (x, y, z) => {
    const nx = (x + 0.5 - cx) / 11.5, ny = (y + 0.5 - gy) / 11.5, nz = (z + 0.5 - cz) / 11.5;
    if (nz > 0.45 && ny > 0.1 && ny < 0.75 && nx < -0.15 && nx > -0.55) return glint;
    return gums[Math.floor(h3(Math.floor(x / 2.5), Math.floor(y / 2.5), Math.floor(z / 2.5), 5) * gums.length)];
  });
  lathe(m, cx, cz, 51, 55, (t) => 6.4 - t * 2.4, red);
  m.sphere(cx, 56.5, cz, 1.8, chrome);
  // Coin plate, crank (turned on frame 1), chute with a gumball on frame 2.
  m.box(13, 20, 29, 25, 28, 29, chrome);
  m.box(16, 26, 30, 18, 27, 30, white);
  if (frame === 1) { m.line(cx, 20, 30, cx, 28, 30, chrome, 0.7); m.sphere(cx, 20, 31, 1.3, chrome); m.sphere(cx, 28, 31, 1.3, chrome); }
  else { m.line(15, 24, 30, 23, 24, 30, chrome, 0.7); m.sphere(15, 24, 31, 1.3, chrome); m.sphere(23, 24, 31, 1.3, chrome); }
  m.box(16, 16, 29, 22, 18, 32, chrome);
  m.sub(() => m.box(17, 17, 31, 21, 18, 32));
  if (frame === 2) m.sphere(cx, 18, 31.5, 1.6, gums[4]);
  return { m, yaw: 30, ground: [cx, 0, cz], anchors: { chute: [cx, 18, 34], top: [cx, 58, cz] } };
});

// ===================== SHOP =====================

def('shop_stall', { name: 'Bait Stall', biome: 'shop', tags: ['shop', 'glow'] }, ({ rng }) => {
  const m = new VoxelModel(96, 96, 60);
  const wood = [m.color('#a06a3c', { jitter: 0.08 }), m.color('#8a5a32', { jitter: 0.08 }), m.color('#b88050', { jitter: 0.06 })];
  const seam = m.color('#5a3420', { jitter: 0.03 });
  const awnA = m.color('#e84a5a', { jitter: 0.04, smooth: 0.4 }), awnB = m.color('#fff0d8', { jitter: 0.04, smooth: 0.4 });
  const trim = m.color('#f2c84a', { jitter: 0.03, spec: 1 });
  const glassC = m.color('#bfe8e0', { jitter: 0.03, smooth: 0.6, spec: 1.8, specPow: 10, light: 0.2 });
  const lid = [m.color('#d84a3a', { jitter: 0.03 }), m.color('#3a8ad8', { jitter: 0.03 }), m.color('#5ac85a', { jitter: 0.03 }), m.color('#f2c84a', { jitter: 0.03 })];
  const contents = [m.color('#ff8aa8', { jitter: 0.1 }), m.color('#e2b878', { jitter: 0.1 }), m.color('#7dff9a', { emissive: 0.8, jitter: 0.05 }), m.color('#ffd84a', { emissive: 0.6, jitter: 0.05 }), m.color('#8a6a4a', { jitter: 0.1 }), m.color('#b46bff', { emissive: 0.7, jitter: 0.05 })];
  const lamp = m.color('#ffcf6a', { emissive: 1, jitter: 0 });
  const signC = m.color('#2a4a5a', { jitter: 0.03 });
  const letter = m.color('#fff6d8', { jitter: 0, emissive: 0.4 });
  const rope = m.color('#d8c08a', { jitter: 0.03 });
  const x0 = 10, x1 = 85, zb = 12, zf = 44;
  // Floor planks.
  m.box(x0 - 2, 0, zb - 2, x1 + 2, 2, zf + 4, (x, y, z) => (z % 4 === 0 ? seam : wood[(x >> 3) % 2]));
  // Back wall + shelves of bait jars.
  m.box(x0, 3, zb, x1, 62, zb + 2, (x, y, z) => ((x - x0) % 8 === 0 ? seam : wood[1]));
  for (const sy of [14, 28, 42]) {
    m.box(x0 + 2, sy, zb + 3, x1 - 2, sy + 1, zb + 9, wood[2]);
    for (let jx = x0 + 4, k = 0; jx < x1 - 6; jx += 7, k++) {
      const h = 6 + ((h3(jx, sy, 0, 3) * 3) | 0);
      m.box(jx, sy + 2, zb + 4, jx + 4, sy + 1 + h, zb + 8, glassC);
      m.box(jx + 1, sy + 2, zb + 5, jx + 3, sy + h - 1, zb + 8, contents[(k + sy) % contents.length]);
      m.box(jx, sy + 2 + h, zb + 4, jx + 4, sy + 3 + h, zb + 8, lid[(k + (sy >> 2)) % lid.length]);
    }
  }
  // Posts.
  for (const [px, pz] of [[x0, zf], [x1 - 1, zf], [x0, zb + 3], [x1 - 1, zb + 3]]) m.box(px, 3, pz, px + 1, 66, pz + 1, wood[0]);
  // Striped awning sloping toward the front with a scalloped edge.
  for (let z = zb - 1; z <= zf + 8; z++) {
    const y = 68 - (z - zb) * 0.28;
    for (let x = x0 - 4; x <= x1 + 4; x++) m.box(x, y, z, x, y + 1, z, Math.floor((x - x0 + 4) / 6) % 2 ? awnB : awnA);
  }
  for (let x = x0 - 4; x <= x1 + 4; x++) {
    const sc = Math.floor((x - x0 + 4) / 6) % 2 ? awnB : awnA;
    const k = (x - x0 + 4) % 6;
    const drop = k === 0 || k === 5 ? 1 : k === 1 || k === 4 ? 3 : 4;
    const y = 68 - (zf + 8 - zb) * 0.28;
    m.box(x, y - drop, zf + 8, x, y, zf + 8, sc);
  }
  m.box(x0 - 4, 68 - (zf + 8 - zb) * 0.28 + 2, zf + 8, x1 + 4, 68 - (zf + 8 - zb) * 0.28 + 2, zf + 8, trim);
  // Sign board on top: "BAIT".
  const signY = 72;
  m.box(30, signY, zb + 4, 65, signY + 12, zb + 6, signC);
  m.box(29, signY - 1, zb + 4, 66, signY - 1, zb + 6, trim);
  m.box(29, signY + 13, zb + 4, 66, signY + 13, zb + 6, trim);
  const font = { B: ['###.', '#..#', '###.', '#..#', '###.'], A: ['.##.', '#..#', '####', '#..#', '#..#'], I: ['###', '.#.', '.#.', '.#.', '###'], T: ['###', '.#.', '.#.', '.#.', '.#.'] };
  let lx = 35;
  for (const ch of 'BAIT') {
    const g = font[ch];
    for (let r = 0; r < 5; r++) for (let c = 0; c < g[r].length; c++) if (g[r][c] === '#') m.box(lx + c * 2, signY + 10 - r * 2, zb + 7, lx + c * 2 + 1, signY + 11 - r * 2, zb + 7, letter);
    lx += g[0].length * 2 + 2;
  }
  // Hanging lantern + a little fish sign.
  m.line(x1 - 6, 64, zf + 4, x1 - 6, 56, zf + 4, rope, 0.4);
  m.box(x1 - 8, 50, zf + 2, x1 - 4, 55, zf + 6, lamp);
  m.box(x1 - 8, 56, zf + 2, x1 - 4, 56, zf + 6, trim);
  m.box(x1 - 8, 49, zf + 2, x1 - 4, 49, zf + 6, trim);
  // Counter at the front (the shopkeeper stands between it and the shelves).
  const cz0 = zf - 6, cz1 = zf + 1, ct = 17;
  const counter = (x, y, z) => x >= x0 - 1 && x <= x1 + 1 && y >= 3 && y <= ct + 12 && z >= cz0 && z <= cz1 + 1;
  m.box(x0, 3, cz0, x1 - 1, ct, cz1, (x, y, z) => ((x - x0) % 6 === 0 ? seam : y > ct - 3 ? wood[2] : wood[(Math.floor((x - x0) / 6)) % 2]));
  m.box(x0 - 1, ct + 1, cz0 - 1, x1, ct + 3, cz1 + 1, wood[2]);
  m.box(x0 - 1, ct + 1, cz1 + 1, x1, ct + 1, cz1 + 1, trim);
  // Goodies on the counter: a jar of worms, a bell, a coin dish.
  m.box(x0 + 6, ct + 4, cz0 + 1, x0 + 11, ct + 10, cz0 + 5, glassC);
  m.box(x0 + 7, ct + 4, cz0 + 2, x0 + 10, ct + 8, cz0 + 5, contents[0]);
  m.box(x0 + 6, ct + 11, cz0 + 1, x0 + 11, ct + 11, cz0 + 5, lid[1]);
  m.cylinder(x1 - 12, cz0 + 3, ct + 4, ct + 5, 3, trim);
  m.sphere(x1 - 12, ct + 7, cz0 + 3, 2, trim);
  m.cylinder(x1 - 22, cz0 + 3, ct + 4, ct + 4, 3.5, wood[1]);
  m.box(x1 - 23, ct + 5, cz0 + 2, x1 - 22, ct + 5, cz0 + 3, lid[3]);
  // A crate behind the counter for the shopkeeper to stand on.
  const kx = (x0 + x1) / 2, kz = (zb + 10 + cz0) / 2;
  m.box(kx - 9, 3, kz - 5, kx + 8, 9, kz + 4, (x, y, z) => (y === 6 || x === kx - 9 || x === kx + 8 ? seam : wood[0]));
  // Kelp at the corner.
  const kelp = [m.color('#4fa25e', { smooth: 0.3 }), m.color('#86cf74', { smooth: 0.3 })];
  for (let y = 2; y < 40; y++) m.set(4 + Math.round(Math.sin(y * 0.35) * 1.3), y, zf + 2, kelp[y % 6 === 0 ? 1 : 0]);
  void rng;
  return {
    m, yaw: 22, pitch: 24, vs: 1.6, light: '#ffcf6a',
    front: counter,
    anchors: { keeper: [kx, 10, kz] },
  };
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
  server_rack: [{ frame: 0, label: 'server rack' }, { frame: 1, label: 'server rack f1' }],
  circuit_coral: [0, 1, 2].map((i) => ({ variant: i, label: 'circuit coral ' + (i + 1) })),
  glow_mushroom: [0, 1, 2].map((i) => ({ variant: i, label: 'glow shrooms ' + (i + 1) })),
  glyph_stone: [0, 1, 2].map((i) => ({ variant: i, label: 'glyph stone ' + (i + 1) })),
  lava_lamp: LAVA.map((c, i) => ({ variant: i, label: 'lava lamp ' + (i + 1) })),
  lava_lamp_giant: LAVA.map((c, i) => ({ variant: i, label: 'giant lamp ' + (i + 1) })),
};

// ---------- interactions ----------
// propInteract(id) -> normalised click/animation spec (every prop has one; decor-only pieces are
// hand-tuned, the rest get a tag-based default):
//   { verb, frames, seq: [frame...], fps, idle: [frame...] | null, idleFps, dur (s),
//     sfx: [{name, at, vol?, pitch?}], fx: [{at, kind, from (anchor), n, colors?, text?, icon?, track?}],
//     ambient: [{kind, from, every, n}], fish: 'flee'|'gather'|'dance'|'abduct'|'launch'|null,
//     use: {kind: 'hide'|'sit'|'bounce'|'orbit'|'watch'|'dance', at, seq?, fps?, emote?} | null,
//     motion: {t0, t1, base, part, path: [[t, dy]]} | null  (draw frame `base` + `part` layer of frame `part` offset by dy),
//     coin: {at, from, cooldown (s)} | null, squash, shake }
// Frames are getProp(id, {frame}); anchors (getProp(...).anchors[name]) locate fx sources ('top' and
// 'center' fall back to the sprite bounds). fx kinds: bubbles, sparkle, burst, notes, hearts, icons, smoke,
// lava, embers, confetti, lights, snow, steam, rise, swirl, foam, ring, text, food, gumball, stars.
const TAG_INTERACT = [
  ['toy', { verb: 'Squeeze', sfx: [['squeak', 0, { pitch: 1.2 }]], fx: [{ kind: 'bubbles', from: 'top', n: 4 }], squash: 0.2, fish: 'gather' }],
  ['bone', { verb: 'Rattle', sfx: [['roar', 0, { pitch: 0.5, vol: 0.35 }], ['click', 0.1]], fx: [{ kind: 'smoke', from: 'top', n: 6 }], fish: 'flee' }],
  ['crystal', { verb: 'Chime', sfx: [['bell', 0, { pitch: 1.3, vol: 0.5 }], ['sparkle', 0.1]], fx: [{ kind: 'sparkle', from: 'top', n: 10 }], fish: 'gather' }],
  ['ruin', { verb: 'Touch', sfx: [['magic', 0, { pitch: 0.8, vol: 0.5 }]], fx: [{ kind: 'sparkle', from: 'top', n: 8, colors: ['#9affff', '#ffffff'] }], fish: 'gather' }],
  ['coral', { verb: 'Tickle', sfx: [['blub', 0, { pitch: 1.2 }]], fx: [{ kind: 'bubbles', from: 'top', n: 6 }, { kind: 'sparkle', from: 'top', n: 3 }], fish: 'gather' }],
  ['plant', { verb: 'Shake', sfx: [['puff', 0, { pitch: 1.4, vol: 0.5 }]], fx: [{ kind: 'sparkle', from: 'top', n: 8, colors: ['#9affc8', '#ffffff'] }], fish: 'gather' }],
  ['treasure', { verb: 'Polish', sfx: [['sparkle', 0]], fx: [{ kind: 'sparkle', from: 'top', n: 8 }], fish: 'gather' }],
  ['wreck', { verb: 'Knock', sfx: [['bell', 0, { pitch: 0.45, vol: 0.4 }]], fx: [{ kind: 'bubbles', from: 'top', n: 8 }] }],
  ['metal', { verb: 'Knock', sfx: [['bell', 0, { pitch: 0.45, vol: 0.4 }]], fx: [{ kind: 'bubbles', from: 'top', n: 8 }] }],
  ['glow', { verb: 'Glow', sfx: [['magic', 0, { vol: 0.5 }]], fx: [{ kind: 'sparkle', from: 'top', n: 8 }], fish: 'gather' }],
  ['rock', { verb: 'Pat', sfx: [['bubble', 0, { pitch: 0.8 }]], fx: [{ kind: 'bubbles', from: 'top', n: 5 }], squash: 0.05 }],
];
const EXTRA_INTERACT = {
  treasure_chest: { verb: 'Open', frames: 2, seq: [1, 1, 1, 1, 1, 1, 1, 0], fps: 3, sfx: [['treasure_open', 0], ['coins_many', 0.3, { vol: 0.5 }]], fx: [{ at: 0.25, kind: 'sparkle', from: 'top', n: 14 }, { at: 0.3, kind: 'burst', from: 'top', n: 10, colors: ['#ffe27a', '#fff6c8', '#f0b030'] }], fish: 'gather', squash: 0 },
  rubber_duck: { verb: 'Squeak', sfx: [['squeak', 0, { pitch: 1.1 }], ['squeak', 0.22, { pitch: 1.3 }]], fx: [{ kind: 'bubbles', from: 'top', n: 4 }, { at: 0.1, kind: 'hearts', from: 'top', n: 1 }], squash: 0.25, fish: 'gather' },
  castle: { verb: 'Fanfare', sfx: [['ui_unlock', 0], ['bell', 0.3, { pitch: 0.75 }]], fx: [{ at: 0.1, kind: 'confetti', from: 'top', n: 18 }], fish: 'gather', use: { kind: 'hide', at: 'center' } },
  pirate_ship: { verb: 'Fire!', sfx: [['thunder', 0, { vol: 0.5, pitch: 1.4 }], ['puff', 0.05], ['thunder', 0.4, { vol: 0.4, pitch: 1.6 }]], fx: [{ at: 0, kind: 'smoke', from: 'center', n: 12 }, { at: 0.4, kind: 'smoke', from: 'center', n: 10 }, { at: 0.1, kind: 'text', from: 'top', text: 'ARRR!' }], fish: 'flee', squash: 0.04, shake: 0.4 },
  sunken_pc: { verb: 'Reboot', sfx: [['crt_on', 0], ['glitch', 0.3, { vol: 0.4 }]], fx: [{ at: 0.3, kind: 'text', from: 'top', text: 'ERROR: FISH' }, { at: 0.1, kind: 'sparkle', from: 'center', n: 6, colors: ['#7fffd0'] }], fish: 'gather', squash: 0.04 },
  diver_helmet: { verb: 'Knock', sfx: [['bell', 0, { pitch: 0.55, vol: 0.4 }], ['bubbles', 0.15]], fx: [{ at: 0.1, kind: 'bubbles', from: 'top', n: 12 }], use: { kind: 'hide', at: 'center' } },
  moai_head: { verb: 'Poke', sfx: [['grunt', 0, { pitch: 0.55 }]], fx: [{ at: 0.2, kind: 'text', from: 'top', text: '...' }], squash: 0.03 },
  tiki_head: { verb: 'Drum', sfx: [['thunder', 0, { pitch: 2.2, vol: 0.3 }], ['thunder', 0.25, { pitch: 2.4, vol: 0.3 }], ['roar', 0.4, { pitch: 1.6, vol: 0.4 }]], fx: [{ at: 0.4, kind: 'embers', from: 'top', n: 8 }], fish: 'dance' },
  mushroom_house: { verb: 'Knock', sfx: [['boing', 0, { pitch: 0.9 }], ['click', 0.15]], fx: [{ at: 0.1, kind: 'sparkle', from: 'top', n: 12, colors: ['#fff6b0', '#ffffff', '#ffb0b0'] }], squash: 0.12, fish: 'gather', use: { kind: 'hide', at: 'center' } },
  pagoda_lantern: { verb: 'Ring', sfx: [['bell', 0, { pitch: 0.7, vol: 0.6 }]], fx: [{ at: 0.1, kind: 'embers', from: 'center', n: 10 }], fish: 'gather' },
  bridge: { verb: 'Stomp', sfx: [['box_close', 0, { pitch: 1.3 }], ['splash_small', 0.1]], fx: [{ kind: 'bubbles', from: 'center', n: 10 }], squash: 0.05 },
  anemone_base: { verb: 'Tickle', sfx: [['blub', 0, { pitch: 1.4 }]], fx: [{ kind: 'hearts', from: 'top', n: 2 }, { kind: 'bubbles', from: 'top', n: 6 }], fish: 'gather', squash: 0.15, use: { kind: 'sit', at: 'top' } },
  clam_pearl: { verb: 'Tickle', sfx: [['bubbles', 0], ['sparkle', 0.2]], fx: [{ kind: 'bubbles', from: 'top', n: 10 }, { at: 0.2, kind: 'sparkle', from: 'center', n: 8 }], fish: 'gather' },
  message_bottle: { verb: 'Uncork', sfx: [['puff', 0, { pitch: 1.6 }], ['ui_page', 0.2]], fx: [{ at: 0.1, kind: 'bubbles', from: 'top', n: 8 }, { at: 0.3, kind: 'text', from: 'top', text: 'HELP. -FISH' }] },
  lava_lamp: { verb: 'Swirl', frames: 4, idle: [0, 1, 2, 3], idleFps: 1.2, seq: [0, 1, 2, 3, 0, 1, 2, 3, 0], fps: 8, sfx: [['bubble', 0, { pitch: 0.6 }], ['magic', 0.15, { vol: 0.4 }]], fx: [{ at: 0.1, kind: 'sparkle', from: 'top', n: 6 }], fish: 'gather' },
};
function defaultInteract(id, meta) {
  if (EXTRA_INTERACT[id]) return EXTRA_INTERACT[id];
  for (const [tag, s] of TAG_INTERACT) if (meta.tags.includes(tag)) return s;
  return { verb: 'Poke', sfx: [['bubble', 0]], fx: [{ kind: 'bubbles', from: 'top', n: 5 }] };
}
const interactCache = new Map();
export function propInteract(id) {
  let s = interactCache.get(id);
  if (s) return s;
  const meta = PROPS[id];
  if (!meta) return null;
  const raw = INTERACT[id] || defaultInteract(id, meta);
  const frames = raw.frames || 1;
  s = {
    verb: raw.verb || 'Poke', frames, seq: raw.seq || [], fps: raw.fps || 8, idle: raw.idle || null, idleFps: raw.idleFps || 4,
    sfx: (raw.sfx || []).map(([name, at = 0, o = {}]) => ({ name, at, ...o })),
    fx: (raw.fx || []).map((f) => ({ at: 0, n: 6, from: 'top', ...f })),
    ambient: raw.ambient || [], fish: raw.fish || null, use: raw.use || null, motion: raw.motion || null, coin: raw.coin || null,
    squash: raw.squash ?? (frames > 1 ? 0.04 : 0.1), shake: raw.shake || 0, custom: !!INTERACT[id],
  };
  s.dur = Math.max(0.5, s.seq.length / s.fps, ...s.sfx.map((e) => e.at + 0.25), ...s.fx.map((f) => f.at + 0.25), s.motion ? s.motion.t1 : 0, s.coin ? s.coin.at + 0.2 : 0);
  interactCache.set(id, s);
  return s;
}
// Decor-only ids that carry hand-built multi-frame animations (for galleries / dev pages).
export const ANIMATED_DECOR = Object.keys(INTERACT);

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
  const opts = {
    scale: (res.vs ?? 1.75) * scale,
    yaw: res.yaw ?? 32,
    pitch: res.pitch ?? 27,
    track: res.screens || [],
    ...(res.render || {}),
  };
  const r = renderVoxels(res.m, opts);
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
  let ox = r.ox, oy = r.oy;
  if (res.ground) {
    // Pinned anchor: every frame of an animated prop lines up regardless of its bounds.
    const [gx, gy] = r.project(res.ground[0], res.ground[1], res.ground[2]);
    ox = Math.round(gx); oy = Math.round(gy);
  }
  p = { canvas: r.canvas, glow: r.glow, ox, oy, w: r.w, h: r.h, screens, lights, ms: [Math.round(t1 - t0), Math.round(performance.now() - t1)] };
  if (res.split) {
    // Movable layer (same framing) holding only the voxels the prop marks as split.
    const pr = renderVoxels(res.m, { ...opts, keepVoxel: res.split });
    p.part = { canvas: pr.canvas, glow: pr.glow };
  }
  if (res.anchors) {
    p.anchors = {};
    for (const [k, a] of Object.entries(res.anchors)) {
      const [x, y] = r.project(a[0], a[1], a[2]);
      p.anchors[k] = { x: Math.round(x), y: Math.round(y) };
    }
  }
  if (res.front) {
    // Foreground layer: same framing/lighting, only the voxels the prop marks as front.
    p.front = renderVoxels(res.m, { ...opts, keepVoxel: res.front }).canvas;
  }
  cache.set(key, p);
  return p;
}
