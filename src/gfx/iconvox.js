// [icons15] Hand-built, DETAILED voxel models for the UI icons, in the bait-art style (src/fishing/baitmodels.js):
// ~40-50 voxels across, glossy palettes, painted details (stitches, grain, stripes, glints). Rendered by
// src/gfx/bigicons.js through src/gfx/voxicon.js (renderVoxels, dark outline, soft shadow).
//
//   ICON_VOX { id: () => def }   menu / HUD icons (override the low-poly meshes of src/gfx/iconmeshes.js)
//   UI3D_VOX { name: () => def } the same models for icons3d names (getUiIcon / tank rail glyphs)
//   [vicons30] the generic FISH is a grouper (grouperIcon / grouperInto: Bubbles' olive-gold spotted kind, pink lips,
//   googly eye, spiny dorsal; also in the fishbowl, the cube tank, the FishDex emblem and the multiplayer pair);
//   currencies: 'aerobuck' (glossy water drop) and 'gem' (the faceted violet Byte Gem with cyan byte pixels)
//   ROD_VOX(rod) -> def          a fishing rod from rod.look {kind, shaft, grip, reel, tip, glow}
//   CHEST_VOX(kind) -> def       a treasure chest (crate | iron | golden | orb): planks, domed lid, straps, lock
//   GEM_VOX(color) -> null       (gems keep the low-poly cut; voxelised at full detail)
// def = {vm: VoxelModel, vmOver?: VoxelModel (drawn over vm), vmGlass?: VoxelModel (translucent shell), yaw, pitch
//   (radians, voxicon convention), spin: 'full' | 'wobble'}; every layer of a def has the same dimensions.
// y is up, z points toward the viewer; models stand on y = 0.
import { VoxelModel } from './voxel.js';
import { shade, mix } from '../core/color.js';

const GL = { spec: 0.85, specPow: 9, smooth: 0.75, jitter: 0.03 };
const SOFT = { spec: 0.35, specPow: 10, smooth: 0.6, jitter: 0.05 };
const MATTE = { smooth: 0.35, jitter: 0.07 };
const METAL = { spec: 1, specPow: 5, smooth: 0.55, jitter: 0.02 };
const GLASS = { smooth: 0.85, spec: 1.3, specPow: 12, jitter: 0, aoMul: 0.4 };
const WOOD = { smooth: 0.3, jitter: 0.06, spec: 0.2 };
const TAU = Math.PI * 2;
const h3 = (x, y, z, s = 0) => {
  let h = (x * 374761393 + y * 668265263 + z * 1274126177 + s * 2246822519) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

// memoised palette: pal(hex, opts) -> index
function palOf(m) {
  const map = new Map();
  return (hex, o = {}) => {
    const k = hex + '|' + JSON.stringify(o);
    let c = map.get(k);
    if (c === undefined) { c = m.color(hex, o); map.set(k, c); }
    return c;
  };
}
const layer = (src) => new VoxelModel(src.nx, src.ny, src.nz);

// Catmull-Rom samples of [x, y, z, r] points with u (0..1 along the arc)
function spline(P, step = 0.35) {
  const at = (i) => P[Math.max(0, Math.min(P.length - 1, i))];
  const raw = [];
  for (let i = 0; i < P.length - 1; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    const n = Math.max(2, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1], p2[2] - p1[2]) / step));
    for (let s = 0; s < n; s++) {
      const t = s / n, t2 = t * t, t3 = t2 * t;
      raw.push([0, 1, 2, 3].map((k) => 0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3)));
    }
  }
  raw.push(P[P.length - 1].slice());
  let L = 0;
  const out = raw.map((q, i) => { if (i) L += Math.hypot(q[0] - raw[i - 1][0], q[1] - raw[i - 1][1], q[2] - raw[i - 1][2]); return { p: q, l: L }; });
  for (const o of out) o.u = L ? o.l / L : 0;
  return out;
}
// a tube along a spline; col(u, x, y, z, dist01) -> palette index (the nearest sample paints each voxel)
function tube(m, P, col, step = 0.35) {
  const S = spline(P, step);
  const best = new Map();
  for (const s of S) {
    const [cx, cy, cz, r] = s.p;
    for (let z = Math.floor(cz - r); z <= Math.ceil(cz + r); z++) for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy, dz = z + 0.5 - cz, d = Math.sqrt(dx * dx + dy * dy + dz * dz) / r;
      if (d > 1 || !m.inside(x, y, z)) continue;
      const k = x + m.nx * (y + m.ny * z), b = best.get(k);
      if (b && b[0] <= d) continue;
      best.set(k, [d, s.u, dx / r, dy / r, dz / r]);
    }
  }
  for (const [k, [d, u, nx, ny, nz]] of best) {
    const x = k % m.nx, y = ((k / m.nx) | 0) % m.ny, z = (k / (m.nx * m.ny)) | 0;
    const c = typeof col === 'function' ? col(u, x, y, z, d, nx, ny, nz) : col;
    if (c) m.put(x, y, z, c);
  }
  return m;
}
// a torus around an axis ('x' | 'y' | 'z') through (cx, cy, cz): major radius R, tube radius r
function torus(m, cx, cy, cz, R, r, axis, col, keep) {
  const E = R + r + 1;
  for (let z = Math.floor(cz - E); z <= Math.ceil(cz + E); z++) for (let y = Math.floor(cy - E); y <= Math.ceil(cy + E); y++) for (let x = Math.floor(cx - E); x <= Math.ceil(cx + E); x++) {
    const dx = x + 0.5 - cx, dy = y + 0.5 - cy, dz = z + 0.5 - cz;
    const [a, b, n] = axis === 'y' ? [dx, dz, dy] : axis === 'x' ? [dy, dz, dx] : [dx, dy, dz];
    const q = Math.hypot(a, b) - R;
    if (q * q + n * n > r * r) continue;
    if (keep && !keep(x, y, z, Math.atan2(b, a))) continue;
    m.put(x, y, z, typeof col === 'function' ? col(x, y, z, Math.atan2(b, a)) : col);
  }
  return m;
}
// an ellipsoid shell of thickness t (voxels)
function shellE(m, cx, cy, cz, rx, ry, rz, t, col, keep) {
  for (let z = Math.floor(cz - rz); z <= Math.ceil(cz + rz); z++) for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
    const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry, dz = (z + 0.5 - cz) / rz;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const rIn = 1 - t / Math.min(rx, ry, rz);
    if (d > 1 || d < rIn) continue;
    if (keep && !keep(x, y, z, dx, dy, dz)) continue;
    m.put(x, y, z, typeof col === 'function' ? col(x, y, z, dx, dy, dz) : col);
  }
  return m;
}
// rounded box (superellipse power p)
function rbox(m, cx, cy, cz, rx, ry, rz, p, col) {
  for (let z = Math.floor(cz - rz); z <= Math.ceil(cz + rz); z++) for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
    const dx = Math.abs(x + 0.5 - cx) / rx, dy = Math.abs(y + 0.5 - cy) / ry, dz = Math.abs(z + 0.5 - cz) / rz;
    if (dx ** p + dy ** p + dz ** p > 1) continue;
    m.put(x, y, z, typeof col === 'function' ? col(x, y, z) : col);
  }
  return m;
}
// extrude a 2D test(x, y) between z0 and z1 (zf(x, y) -> [z0, z1] optional)
function slab(m, x0, y0, x1, y1, z0, z1, test, col) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    if (!test(x + 0.5, y + 0.5)) continue;
    const [a, b] = typeof z0 === 'function' ? z0(x + 0.5, y + 0.5) : [z0, z1];
    for (let z = Math.round(a); z <= Math.round(b); z++) m.put(x, y, z, typeof col === 'function' ? col(x, y, z) : col);
  }
  return m;
}
// paint only voxels on the visible skin
const skin = (m, fn) => m.recolor((x, y, z, v) => (m.exposed(x, y, z) ? fn(x, y, z, v) : null));
// a little 4-point sparkle of emissive voxels at (x, y, z)
function glint(m, x, y, z, c, big = false) {
  m.set(x, y, z, c); m.set(x - 1, y, z, c); m.set(x + 1, y, z, c); m.set(x, y - 1, z, c); m.set(x, y + 1, z, c);
  if (big) { m.set(x - 2, y, z, c); m.set(x + 2, y, z, c); m.set(x, y + 2, z, c); m.set(x, y - 2, z, c); }
}

// ---------------------------------------------------------------- The Lab: a round-bottom flask of bubbling potion
function flask(liquid = '#58e04a') {
  const m = new VoxelModel(40, 50, 40), p = palOf(m);
  const G = layer(m), gp = palOf(G);
  const cx = 20, cz = 20, cy = 16, R = 14.2, top = 19;
  const liq = p(liquid, GL), liqD = p(shade(liquid, -0.32), GL), liqL = p(mix(liquid, '#f4ffb0', 0.5), { ...GL, light: 0.4 }), bub = p(mix(liquid, '#ffffff', 0.8), { ...GL, emissive: 0.35 });
  m.ellipsoid(cx, cy, cz, R - 1.5, R - 1.5, R - 1.5, (x, y) => (y > top ? null : y === top ? liqL : y < 8 ? liqD : liq));
  // bubbles rising on the skin of the potion and floating above it
  m.paint(() => { for (const [x, y, z, r] of [[14, 12, 32, 1.8], [25, 9, 31, 1.3], [21, 15, 33, 1.1], [30, 14, 27, 1.4], [11, 7, 29, 1.2], [18, 6, 33, 1]]) m.sphere(x, y, z, r, bub); });
  m.recolor((x, y, z, v) => (y === top && h3(x, y, z, 3) < 0.18 ? bub : null));
  for (const [x, y, z, r] of [[17, 23, 22, 1.4], [22, 26, 19, 1], [19, 30, 21, 0.9], [23, 22, 24, 1.1]]) m.sphere(x, y, z, r, bub);
  // cork + string
  const cork = p('#c8925a', WOOD), corkD = p('#94643a', WOOD), corkL = p('#e8bc84', WOOD), twine = p('#f2e2b8', MATTE), twineD = p('#b89a6a', MATTE);
  m.cylinder(cx, cz, 35, 44, 4.3, (x, y, z) => (y === 44 ? corkL : h3(x, y, z, 9) < 0.22 ? corkD : cork));
  m.cylinder(cx, cz, 44, 45, 3.6, corkL);
  torus(m, cx, 38.5, cz, 5.4, 0.9, 'y', (x, y, z, a) => ((Math.floor(a * 4) & 1) ? twineD : twine));
  tube(m, [[cx - 5, 38, cz + 3, 0.7], [cx - 7, 34, cz + 5, 0.7], [cx - 8, 30, cz + 7, 0.8]], twine);
  m.box(cx - 10, 26, cz + 6, cx - 7, 30, cz + 8, p('#ffe9b8', MATTE)); // little paper tag
  m.box(cx - 9, 27, cz + 8, cx - 8, 28, cz + 8, p('#d8483a', MATTE));
  // glass: bulb + neck + lip
  const glass = gp('#dcf6ff', GLASS), gw = gp('#ffffff', { ...GLASS, emissive: 0.6 }), rim = gp('#b8e8ff', GLASS);
  shellE(G, cx, cy, cz, R, R, R, 1.3, (x, y, z, dx, dy, dz) => (dx < -0.25 && dy > 0.25 && dz > 0.45 && dx > -0.7 ? gw : glass), (x, y) => y < 28);
  for (let y = 25; y <= 36; y++) for (let z = cz - 7; z <= cz + 7; z++) for (let x = cx - 7; x <= cx + 7; x++) {
    const d = Math.hypot(x + 0.5 - cx, z + 0.5 - cz);
    if (d <= 5.6 && d >= 4.4) G.put(x, y, z, x < cx - 2 && z > cz + 2 && y > 27 && y < 34 ? gw : glass);
  }
  torus(G, cx, 36.5, cz, 5.4, 1.3, 'y', rim);
  return { vm: m, vmGlass: G, yaw: 0.4, pitch: 0.36, spin: 'wobble' };
}

// ---------------------------------------------------------------- Quests: a parchment scroll with a wax seal
function scroll() {
  const m = new VoxelModel(46, 50, 18), p = palOf(m);
  const paper = p('#f6e4b4', SOFT), paperD = p('#e2c88e', SOFT), paperE = p('#c9a46a', SOFT), ink = p('#7a4a2e', MATTE), inkL = p('#3a7ad0', MATTE);
  const bend = (x) => 7 + Math.round(1.6 * Math.sin(((x - 8) / 30) * Math.PI));
  // the sheet, gently curved
  slab(m, 9, 8, 36, 42, (x) => [bend(x), bend(x) + 1], 0, () => true, (x, y, z) => (x <= 9 || x >= 36 ? paperE : h3(x, y, z, 5) < 0.12 ? paperD : paper));
  // writing: a title line in blue, then lines of brown text
  const fz = (x) => bend(x) + 2;
  for (let x = 13; x <= 30; x++) if (h3(x, 0, 0, 2) > 0.18) m.set(x, 37, fz(x), inkL);
  for (const [y, len] of [[33, 20], [30, 18], [27, 21], [24, 15], [21, 19], [18, 11]]) for (let x = 13; x < 13 + len; x++) if (h3(x, y, 0, 7) > 0.22) m.set(x, y, fz(x), ink);
  // rollers with wooden knobs
  const roll = (y) => {
    m.cylinder(y, 9, 7, 38, 4.4, (x, yy, z) => { const a = Math.atan2(yy + 0.5 - y, z + 0.5 - 9); return ((Math.floor(a * 1.6 + x * 0.25) & 3) === 0) ? paperD : x === 7 || x === 38 ? paperE : paper; }, 'x');
    for (const x of [4.5, 41.5]) { m.sphere(x, y, 9, 3.3, (xx, yy) => (yy > y + 1 ? p('#c8844a', WOOD) : p('#8a4a26', WOOD))); m.cylinder(y, 9, x < 20 ? 6 : 39, x < 20 ? 7 : 40, 2.4, p('#6a3a1e', WOOD), 'x'); }
  };
  roll(44); roll(6);
  // the wax seal and its ribbon tails
  const wax = p('#e02a3e', GL), waxD = p('#a8182c', GL), waxL = p('#ff7a7a', { ...GL, light: 0.3 }), rib = p('#d8283a', SOFT), ribD = p('#9a1828', SOFT);
  tube(m, [[30, 14, 11, 1.4], [28, 8, 12, 1.4], [26, 2, 12, 1.4]], (u, x, y) => (y % 3 === 0 ? ribD : rib));
  tube(m, [[31, 14, 11, 1.4], [34, 8, 12, 1.4], [36, 3, 12, 1.4]], (u, x, y) => (y % 3 === 0 ? ribD : rib));
  for (let y = 7; y <= 21; y++) for (let x = 23; x <= 37; x++) {
    const dx = x + 0.5 - 30, dy = y + 0.5 - 14, a = Math.atan2(dy, dx), r = 5.6 + 0.6 * Math.sin(a * 7);
    const d = Math.hypot(dx, dy);
    if (d > r) continue;
    for (let z = 10; z <= 12 + (d < 3.2 ? 1 : 0); z++) m.put(x, y, z, d > r - 1 ? waxD : d < 3.2 ? waxL : wax);
  }
  for (const [x, y] of [[30, 16], [29, 15], [30, 15], [31, 15], [28, 14], [32, 14], [30, 14], [29, 13], [31, 13], [30, 12]]) m.set(x, y, 14, waxD); // a little star stamp
  return { vm: m, yaw: 0.38, pitch: 0.3, spin: 'wobble' };
}

// ---------------------------------------------------------------- FishDex: a blue hardcover book with a gold grouper emblem
function book() {
  const m = new VoxelModel(38, 48, 18), p = palOf(m);
  const cov = p('#2f7ae8', GL), covD = p('#1d58b8', GL), covL = p('#5aa4ff', GL);
  const pg = p('#fbf2d8', SOFT), pgD = p('#e2d2a8', SOFT);
  const gold = p('#ffc83a', METAL), goldD = p('#c8861a', METAL), goldL = p('#fff2a0', { ...METAL, emissive: 0.2 });
  // covers + rounded spine
  m.box(5, 1, 2, 33, 44, 3, cov); m.box(5, 1, 13, 33, 44, 14, cov);
  for (let y = 1; y <= 44; y++) for (let z = 2; z <= 14; z++) for (let x = 1; x <= 6; x++) {
    const dx = (x + 0.5 - 6.5) / 5.4, dz = (z + 0.5 - 8.5) / 6.6;
    if (dx * dx + dz * dz <= 1) m.put(x, y, z, cov);
  }
  // pages
  m.box(6, 3, 4, 32, 42, 12, (x, y, z) => (x === 32 && z % 2 === 0 ? pgD : y === 42 && z % 2 === 0 ? pgD : pg));
  // spine bands
  m.recolor((x, y, z, v) => (v === cov && x <= 5 && (y === 6 || y === 7 || y === 38 || y === 39) ? gold : null));
  // gold corner caps
  for (const y0 of [1, 41]) for (let y = y0; y <= y0 + 3; y++) for (let x = 30; x <= 33; x++) for (const z of [2, 3, 13, 14]) if ((y0 === 1 ? y - y0 : y0 + 3 - y) + (33 - x) <= 3) m.set(x, y, z, goldD);
  // front cover: a gold-framed window with a fish, a title bar
  for (let y = 15; y <= 37; y++) for (let x = 10; x <= 29; x++) {
    const edge = x === 10 || x === 29 || y === 15 || y === 37;
    if (edge) { m.set(x, y, 15, gold); m.set(x, y, 16, gold); }
    else m.set(x, y, 14, (x + y) % 7 === 0 ? p('#c8ecff', SOFT) : p('#8ad0ff', SOFT));
  }
  // [vicons30] the emblem: a gold grouper (chunky head, spiny dorsal, fan tail, spots, big pink lips, googly eye)
  const fish = p('#ffcf4a', GL), fishD = p('#d8901e', GL), spotC = p('#8a5418', GL), lipC = p('#ff8a8a', GL), lipD = p('#d8566a', GL);
  const eye = p('#1a1430', MATTE), white = p('#ffffff', { emissive: 0.4 });
  for (let y = 17; y <= 35; y++) for (let x = 11; x <= 28; x++) {
    const X = x + 0.5, Y = y + 0.5;
    const body = ((X - 19.5) / 5.6) ** 2 + ((Y - 25.6) / 4.6) ** 2 <= 1 || ((X - 23.2) / 3.8) ** 2 + ((Y - 25.9) / 4.6) ** 2 <= 1;
    const tail = X < 14.6 && X > 11 && Math.abs(Y - 25.8) < (14.8 - X) * 1.25 + 1.1;
    const dors = X > 16 && X < 23.5 && Y > 29.4 && Y < 32 - Math.abs(X - 19.5) * 0.3 && (x & 1) === 0;
    const lip = X > 26.4 && X < 28.6 && Y > 22.6 && Y < 26.4;
    const at = (c) => { m.set(x, y, 15, c); m.set(x, y, 16, c); }; // 2 voxels thick: survives the small-size downsample
    if (lip) at(Math.abs(Y - 24.5) < 0.6 ? lipD : lipC);
    else if (body || tail || dors) at(dors || tail && (X < 12.4 || Math.abs(Y - 25.8) > (14.8 - X) * 1.25) ? fishD : body && h3(x, y, 2, 31) > 0.82 && Y < 28 ? spotC : Y > 28.6 ? fishD : fish);
  }
  m.box(24, 27, 16, 25, 28, 17, white); m.set(25, 27, 17, eye); // googly eye
  m.box(13, 8, 15, 26, 10, 16, gold); m.box(15, 9, 17, 24, 9, 17, goldL);
  glint(m, 27, 40, 15, p('#ffffff', { emissive: 0.7 }));
  // ribbon bookmark
  const rib = p('#ff4a5a', SOFT);
  m.box(24, 45, 8, 25, 47, 8, rib); m.set(24, 47, 8, 0);
  return { vm: m, yaw: 0.42, pitch: 0.3, spin: 'wobble' };
}

// ---------------------------------------------------------------- Satchel: a leafy green bag with a brass buckle
function satchel() {
  const m = new VoxelModel(48, 42, 28), p = palOf(m);
  const bag = p('#58c23a', SOFT), bagD = p('#3a8e2a', SOFT), bagL = p('#86e05a', SOFT), st = p('#d4ffa8', MATTE);
  const flapC = p('#6cd64a', GL), strap = p('#2f7a22', SOFT);
  rbox(m, 24, 14.5, 13.5, 20.5, 13, 9.5, 3.2, (x, y) => (y < 4 ? bagD : bag));
  // stitched seam around the body sides
  skin(m, (x, y, z, v) => (Math.abs(z + 0.5 - 13.5) < 0.6 && (x < 7 || x > 40) && y % 2 === 0 ? st : null));
  // the flap over the front with a stitched edge
  for (let y = 9; y <= 28; y++) for (let x = 6; x <= 41; x++) {
    const dx = Math.abs(x + 0.5 - 23.5), r = y < 15 ? Math.sqrt(Math.max(0, 1 - ((15 - y) / 6.5) ** 2)) * 17.5 : 17.5;
    if (dx > r) continue;
    const zb = y > 24 ? 22 - (y - 24) : 22;
    const edge = dx > r - 1.2 || y === 9;
    const stitch = !edge && (dx > r - 2.6 && dx < r - 1.5 || y === 10 + 1) && (x + y) % 2 === 0;
    m.box(x, y, zb, x, y, zb + 1, edge ? bagD : stitch ? st : flapC);
  }
  // strap + brass buckle
  m.box(21, 4, 23, 26, 13, 23, strap);
  const brass = p('#ffc83a', METAL), brassD = p('#b87a1a', METAL), hole = p('#1a2a10', MATTE);
  m.box(19, 8, 24, 28, 15, 25, brass); m.box(21, 10, 25, 26, 13, 25, brassD); m.box(22, 11, 26, 25, 12, 26, brass); m.set(23, 9, 26, hole);
  glint(m, 20, 14, 26, p('#fffbe0', { emissive: 0.8 }));
  // handle
  tube(m, [[10, 26, 13.5, 2.3], [14, 35, 13.5, 2.3], [24, 38.5, 13.5, 2.3], [34, 35, 13.5, 2.3], [38, 26, 13.5, 2.3]], (u, x, y) => (y > 36 ? bagL : strap));
  for (const x of [10, 38]) { m.box(x - 2, 25, 11, x + 2, 27, 16, brassD); m.box(x - 1, 26, 17, x + 1, 26, 17, brass); }
  // leaf charm
  const leaf = p('#9af05a', GL);
  tube(m, [[37, 25, 18, 0.6], [40, 21, 20, 0.6]], strap);
  m.ellipsoid(41.5, 18.5, 20.5, 2.6, 3.4, 1.2, leaf);
  return { vm: m, yaw: 0.4, pitch: 0.34, spin: 'wobble' };
}

// ---------------------------------------------------------------- Wardrobe: a striped tee on a hanger
function shirt() {
  const m = new VoxelModel(46, 48, 14), p = palOf(m);
  const tee = p('#3aa4f4', SOFT), teeD = p('#2478d0', SOFT), teeL = p('#7accff', SOFT), wh = p('#f6fbff', SOFT), col = p('#ffd23a', GL);
  const shape = (x, y) => {
    const body = x >= 12 && x <= 34 && y >= 2 && y <= 33;
    const sl = (x0, dir) => { const t = (x - x0) * dir; return t >= 0 && t <= 10 && y >= 22 - t * 0.45 && y <= 33 - t * 0.8; };
    const neck = Math.hypot(x - 23, y - 34.5) < 5.2;
    return (body || sl(34, 1) || sl(12, -1)) && !neck;
  };
  slab(m, 1, 1, 45, 36, (x, y) => { const c = Math.abs(x - 23) < 10 && y > 6 && y < 30 ? 1 : 0; return [5 - c, 8 + c]; }, 0, shape, (x, y, z) => {
    if (y >= 12 && y <= 15 && x > 10 && x < 36) return wh;
    if (y >= 6 && y <= 7 && x > 10 && x < 36) return wh;
    if ((x <= 4 || x >= 42) && y < 26) return wh; // sleeve cuffs
    return (x - y + 60) % 11 === 0 && y > 16 && y < 30 ? teeD : tee;
  });
  // collar
  torus(m, 23, 34.5, 7, 5.6, 1.2, 'z', col, (x, y) => y < 35);
  // fold shading + a pocket
  m.box(27, 20, 9, 31, 24, 9, teeL); m.box(27, 24, 10, 31, 24, 10, teeD);
  // hanger
  const hook = p('#d4dce8', METAL), hookD = p('#8a98ac', METAL);
  tube(m, [[23, 34, 6, 1], [23, 40, 6, 1], [25, 44, 6, 1], [28.5, 42, 6, 1], [27.5, 38.5, 6, 1]], (u) => (u > 0.5 ? hook : hookD));
  tube(m, [[9, 31, 4, 1], [23, 36.5, 4, 1], [37, 31, 4, 1]], hookD);
  return { vm: m, yaw: 0.34, pitch: 0.28, spin: 'wobble' };
}

// ---------------------------------------------------------------- Map: a desk globe on a brass stand
function globe() {
  const m = new VoxelModel(46, 52, 46), p = palOf(m);
  const cx = 23, cy = 30, cz = 23, R = 15.5;
  const sea = p('#2f8ef0', GL), seaD = p('#1d68d0', GL), seaL = p('#6ac4ff', GL), land = p('#5cd240', SOFT), landL = p('#a4ec64', SOFT), sand = p('#f2dc94', SOFT), ice = p('#f4fbff', SOFT), mtn = p('#3a9a3a', SOFT);
  m.ellipsoid(cx, cy, cz, R, R, R, (x, y, z) => {
    const dx = (x + 0.5 - cx) / R, dy = (y + 0.5 - cy) / R, dz = (z + 0.5 - cz) / R;
    if (Math.abs(dy) > 0.84) return ice;
    const n = Math.sin(dx * 3.4 + 1.1) * Math.sin(dy * 3.1 + 0.4) + Math.sin(dz * 4.1 + dx * 1.7 + 2.2) * 0.65 + Math.sin(dx * 7.3 - dz * 5.1) * 0.22;
    if (n > 0.3) return h3(x, y, z, 4) < 0.2 ? mtn : n > 0.75 ? landL : land;
    if (n > 0.18) return sand;
    return n < -0.6 ? seaD : n > 0.25 ? seaL : sea;
  });
  // brass meridian (half ring) and axis pins
  const brass = p('#f0b43a', METAL), brassD = p('#b07018', METAL), brassL = p('#fff0a0', { ...METAL, emissive: 0.2 });
  torus(m, cx, cy, cz - 0.5, R + 2.2, 1.1, 'z', brass, (x, y, z, a) => Math.cos(a) < 0.15);
  m.sphere(cx, cy + R + 2.2, cz - 0.5, 1.7, brassL); m.sphere(cx, cy - R - 2.2, cz - 0.5, 1.7, brass);
  // stand
  m.cylinder(cx, cz, 4, 12, 2, brassD);
  m.cylinder(cx, cz, 0, 3, 9, (x, y, z) => (y === 3 ? brass : brassD));
  m.cylinder(cx, cz, 3, 4, 7, brassL);
  glint(m, cx - 7, cy + 7, cz + 13, p('#ffffff', { emissive: 0.8 }), true);
  return { vm: m, yaw: 0.35, pitch: 0.3, spin: 'full' };
}

// ---------------------------------------------------------------- Bait Shop: a market stall with a striped awning
function stall() {
  const m = new VoxelModel(50, 52, 34), p = palOf(m);
  const wood = p('#d8944a', WOOD), woodD = p('#a8622e', WOOD), woodL = p('#f2c27a', WOOD);
  const red = p('#ff3e52', SOFT), redD = p('#c8203a', SOFT), wh = p('#fff6ee', SOFT), whD = p('#e8d4cc', SOFT);
  // counter (vertical planks) with a top slab
  m.box(5, 1, 9, 44, 17, 29, (x, y, z) => (x % 5 === 0 ? woodD : y === 17 ? woodL : h3(x, y >> 2, z, 3) < 0.15 ? woodD : wood));
  m.box(3, 18, 7, 46, 20, 31, (x, y, z) => (y === 20 ? woodL : wood));
  m.box(5, 0, 9, 44, 0, 29, woodD);
  // posts
  for (const x of [5, 42]) for (const z of [10, 27]) m.box(x, 21, z, x + 2, 42, z + 2, (xx, y) => (y % 4 < 2 ? wh : red));
  // awning sloping toward the front, red / white stripes, scalloped front edge
  for (let z = 4; z <= 33; z++) {
    const yt = Math.round(49 - (z - 4) * 0.3);
    for (let x = 1; x <= 48; x++) {
      const s = Math.floor((x - 1) / 6) & 1;
      for (let y = yt - 1; y <= yt; y++) m.put(x, y, z, s ? (y === yt ? wh : whD) : (y === yt ? red : redD));
    }
  }
  for (let x = 1; x <= 48; x++) {
    const s = Math.floor((x - 1) / 6) & 1, u = ((x - 1) % 6) + 0.5 - 3;
    const drop = Math.round(Math.sqrt(Math.max(0, 9 - u * u)) * 1.1);
    for (let y = 39 - drop; y <= 39; y++) m.put(x, y, 33, s ? wh : red);
  }
  // goods on the counter: a fish, a jar of worms, a blue bottle, a price sign
  const fish = p('#ff9a3a', GL), fishL = p('#ffd08a', GL), eye = p('#1a1430', MATTE);
  m.ellipsoid(14, 23, 22, 5, 2.6, 2.4, (x, y) => (y < 22 ? fishL : fish));
  for (let k = 0; k < 3; k++) m.box(8 - k, 21 + 0 - k, 22, 8 - k, 25 + k, 22, fish);
  m.set(17, 24, 24, eye);
  const jar = p('#c8f0ff', GLASS), worm = p('#ff7ab0', GL), lid = p('#ffd23a', METAL);
  m.cylinder(26, 22, 21, 28, 3.6, (x, y, z) => ((x + y + z) % 3 === 0 ? worm : jar));
  m.cylinder(26, 22, 29, 30, 4, lid);
  const bot = p('#3a8cff', GL), botL = p('#9ad4ff', { ...GL, emissive: 0.3 });
  m.cylinder(35, 21, 21, 27, 2.8, (x, y, z) => (x < 35 && z > 22 ? botL : bot)); m.cylinder(35, 21, 28, 31, 1.3, bot); m.cylinder(35, 21, 32, 33, 1.5, woodD);
  m.box(39, 21, 25, 45, 27, 25, wh); m.box(40, 24, 26, 44, 24, 26, red); m.box(41, 22, 26, 43, 22, 26, red);
  return { vm: m, yaw: 0.42, pitch: 0.36, spin: 'wobble' };
}

// ---------------------------------------------------------------- Bait: a pink worm curled on a silver hook
function baitHook() {
  const m = new VoxelModel(40, 52, 22), p = palOf(m);
  const st = p('#d8e2f0', METAL), stD = p('#8a9ab0', METAL), line = p('#ffffff', { emissive: 0.4 });
  tube(m, [[22, 44, 11, 1.3], [22, 30, 11, 1.3], [22, 16, 11, 1.4], [20, 9, 11, 1.4], [14, 7, 11, 1.4], [9, 10, 11, 1.4], [8, 16, 11, 1.3], [9, 20, 11, 1.1]], (u, x, y, z, d, nx) => (nx < -0.2 ? st : stD));
  tube(m, [[9, 20, 11, 1.1], [11, 17, 11, 0.8]], stD); // barb
  torus(m, 22, 46.5, 11, 2.4, 0.9, 'z', st);
  m.box(22, 49, 11, 22, 51, 11, line);
  // the worm: wrapped around the shank, tail dangling
  const w = p('#ff7aa8', GL), wD = p('#d8487a', GL), wL = p('#ffb4cc', GL), band = p('#ff9ab8', { ...GL, light: 0.4 });
  tube(m, [[30, 40, 9, 2.8], [27, 37, 15, 3], [19, 34, 15, 3], [15, 31, 8, 3], [21, 28, 5, 3], [28, 26, 9, 3], [27, 22, 16, 3], [19, 20, 16, 3], [15, 17, 11, 2.8], [17, 12, 16, 2.6], [24, 9, 17, 2.4], [30, 6, 15, 2.1], [33, 3, 13, 1.8]],
    (u, x, y, z, d, nx, ny) => { if (u > 0.36 && u < 0.43) return band; const k = Math.floor(u * 70); return k % 3 === 0 ? wD : ny > 0.45 ? wL : w; });
  m.sphere(30.5, 41, 9, 2.2, wL); // head
  m.set(31, 42, 11, p('#2a1428', MATTE));
  return { vm: m, yaw: 0.3, pitch: 0.24, spin: 'wobble' };
}

// ---------------------------------------------------------------- the generic FISH: a grouper (Bubbles' kind) [vicons30]
// A chunky olive-gold grouper: deep body with a big head, dark chocolate spots and saddles on golden flanks, a pale
// belly, gold-freckled head, spiny dorsal (gold-tipped spines over an olive membrane), a soft rear dorsal, a gold-rimmed
// fan tail, big pink pouty lips and a googly eye (white dome, off-centre pupil, glint). Faces +x (dir = -1 flips).
//   grouperInto(m, p, cx, cy, cz, k, dir, o?)   k = scale (1 = ~46 voxels from tail tip to lips); o.noFar = no far eye,
//                                               o.lite = no pelvic / anal fins (small sizes), o.short = chibi (shorter trunk + tail)
const GR = {
  back: '#76602a', side: '#c4943e', sideL: '#e2b65a', belly: '#f6e2a4', spot: '#2c1d0c', saddle: '#5a4018', fresh: '#ffd65a',
  fin: '#806226', finD: '#4a3816', finE: '#ffc94a', spine: '#ffe27a', lip: '#fb8a94', lipL: '#ffc4c4', lipD: '#d0566c',
  mouth: '#3a0a14', eye: '#fdfbf3', eyeD: '#e2dccb', pupil: '#120a06', gill: '#5a3e18',
};
function grouperInto(m, p, cx, cy, cz, k = 1, dir = 1, o = {}) {
  const X = (d) => cx + dir * d * k, Y = (d) => cy + d * k, Z = (d) => cz + d * k;
  const c = {}; for (const key in GR) c[key] = p(GR[key], key === 'eye' || key === 'lip' || key === 'lipL' ? GL : key.startsWith('fin') || key === 'spine' ? SOFT : GL);
  const shine = p('#ffffff', { emissive: 0.8 });
  const g = 4.2; // spot grid (body units)
  const bodyCol = (x, y, z) => {
    const u = dir * (x + 0.5 - cx) / k, v = (y + 0.5 - cy) / k;
    if (v < -5.2 + u * 0.12) return c.belly;
    // round dark spots on a jittered grid over the flank (projected along z, so they read as dots from the side)
    const gx = Math.floor(u / g), gy = Math.floor(v / g), jx = (gx + 0.2 + 0.6 * h3(gx, gy, 0, 11)) * g, jy = (gy + 0.2 + 0.6 * h3(gx, gy, 1, 11)) * g;
    if (v > -4.4 && u < 15 && h3(gx, gy, 2, 11) > 0.52 && Math.hypot(u - jx, v - jy) < 1.15 + 0.35 * h3(gx, gy, 3, 11)) return c.spot;
    if (v > 5.8 && Math.abs(((u + 40) % 8) - 4) < 0.8) return c.saddle; // soft saddles over the back
    if (u > 8 && h3(x, y, z, 13) > 0.9) return c.fresh; // gold freckles on the head
    return v > 4.4 ? c.back : v < -2.5 ? c.sideL : c.side;
  };
  // tail fan (flat, gold rim, spotted membrane) on a thick peduncle
  const sh = o.short ? 3.5 : 0, tl = o.short ? 6 : 7.5; // chibi proportions for small groups
  for (let i = 0; i <= 12; i++) {
    const t = i / 12, hx = -17 + sh - t * tl, hh = 2.6 + t * 6.2, hw = 1.3;
    for (let y = Math.floor(Y(-hh - 0.5)); y <= Math.ceil(Y(hh + 0.5)); y++) {
      const v = (y + 0.5 - cy) / k - 0.3;
      if (Math.abs(v) > hh - (t > 0.85 ? Math.abs(v) * 0.08 : 0)) continue;
      const edge = t > 0.82 || Math.abs(v) > hh - 1.4;
      for (let z = Math.floor(Z(-hw)); z <= Math.ceil(Z(hw)); z++) {
        const x = Math.round(X(hx));
        m.put(x, y, z, edge ? c.finE : h3(x, y, z, 5) > 0.82 ? c.spot : c.fin);
      }
    }
  }
  tube(m, [[X(-11 + sh), Y(0.4), cz, 5.4 * k], [X(-15 + sh), Y(0.3), cz, 3.6 * k], [X(-18 + sh), Y(0.3), cz, 2.6 * k]], (u, x, y, z) => bodyCol(x, y, z));
  // the body: a deep rounded trunk + a big blunt head
  m.ellipsoid(X(-2 + sh / 2), Y(0), cz, (13.5 - sh / 2) * k, 9.6 * k, 6.8 * k, bodyCol);
  m.ellipsoid(X(7.5), Y(0.4), cz, 9.5 * k, 9.2 * k, 7.2 * k, bodyCol);
  // gill cover line
  skin(m, (x, y, z, v) => { const u = dir * (x + 0.5 - cx) / k, w = (y + 0.5 - cy) / k; return Math.abs(u - (4.2 + 0.03 * w * w)) < 0.55 && w > -5 && w < 5 && Math.abs(z + 0.5 - cz) > 4 * k ? c.gill : null; });
  // top of the body per x (for the fins)
  const topAt = (x) => { for (let y = m.ny - 1; y >= 0; y--) if (m.get(x, y, Math.floor(cz))) return y; return Math.floor(cy); };
  const botAt = (x) => { for (let y = 0; y < m.ny; y++) if (m.get(x, y, Math.floor(cz))) return y; return Math.floor(cy); };
  // spiny dorsal: gold-tipped spines with olive membrane between them
  for (let d = -6; d <= 7; d++) {
    const x = Math.round(X(d)), y0 = topAt(x), s = (d + 6) / 13;
    const hgt = Math.max(1, Math.round((3.2 + 2.6 * Math.sin(Math.min(1, s * 1.4) * Math.PI * 0.9)) * k));
    const spine = (d & 1) === 0;
    for (let y = y0; y <= y0 + hgt - (spine ? 0 : 1); y++) m.put(x, y, Math.round(cz), spine ? (y >= y0 + hgt - Math.max(1, Math.round(k)) + 1 ? c.spine : c.finE) : c.fin);
  }
  // soft rear dorsal + anal fin (rounded, spotted, gold edge)
  for (const [a, b, H, top] of (o.lite ? [[-15, -7, 4.8, true]] : [[-15, -7, 4.8, true], [-14, -8, 3.6, false]]).map(([a, b, H, t]) => [a + sh, b + sh * 0.5, H, t])) for (let d = a; d <= b; d++) {
    const x = Math.round(X(d)), s = (d - a) / (b - a), hgt = Math.round(H * k * Math.sqrt(Math.max(0, Math.sin(s * Math.PI))) + 0.4);
    const y0 = top ? topAt(x) : botAt(x);
    for (let i = 0; i <= hgt; i++) { const y = top ? y0 + i : y0 - i; for (let z = Math.round(cz - 0.6 * k); z <= Math.round(cz + 0.6 * k); z++) m.put(x, y, z, i >= hgt - 0.5 ? c.finE : h3(x, y, z, 9) > 0.8 ? c.spot : c.fin); }
  }
  // pelvic fin under the head (not on the small pair: it reads as legs), pectoral fin on the near flank
  if (!o.lite) m.ellipsoid(X(4.5), Y(-8.6), Z(1.5), 2.4 * k, 1.3 * k, 1.1 * k, (x) => (dir * (x + 0.5 - X(4)) < -1.2 * k ? c.finE : c.fin));
  m.ellipsoid(X(1), Y(-2.2), Z(6.6), 3.6 * k, 2.6 * k, 1 * Math.max(1, k), (x, y) => (dir * (x + 0.5 - X(1)) < -2.2 * k || y + 0.5 < Y(-4.2) ? c.finE : c.fin));
  // big pouty pink lips (upper smaller, lower bigger and pushed out) with a dark mouth line
  m.ellipsoid(X(16.6), Y(-0.3), cz, 3.4 * k, 2.5 * k, 5 * k, (x, y) => (y + 0.5 > Y(1) ? c.lipL : c.lip));
  m.ellipsoid(X(17.6), Y(-4), cz, 4 * k, 2.9 * k, 5.6 * k, (x, y) => (y + 0.5 < Y(-5.6) ? c.lipD : y + 0.5 > Y(-2.6) ? c.lipL : c.lip));
  m.box(Math.min(X(14.6), X(21)), Y(-2.2), Z(-4), Math.max(X(14.6), X(21)), Y(-2.2), Z(4), c.mouth);
  // the googly eye: a white dome bulging from the head, a big pupil looking forward-down, a glint
  const ex = X(8.8), ey = Y(5), ez = Z(4.9), er = 4.2 * k;
  m.sphere(ex, ey, ez, er, (x, y, z) => (y + 0.5 < ey - er * 0.55 ? c.eyeD : c.eye));
  const D = [dir * 0.48, -0.3, 0.83], dl = Math.hypot(...D);
  m.recolor((x, y, z, v) => {
    if (v !== c.eye && v !== c.eyeD) return null;
    const nx = x + 0.5 - ex, ny = y + 0.5 - ey, nz = z + 0.5 - ez, n = Math.hypot(nx, ny, nz) || 1;
    return (nx * D[0] + ny * D[1] + nz * D[2]) / (n * dl) > 0.78 ? c.pupil : null;
  });
  m.set(Math.floor(ex + dir * er * 0.2), Math.floor(ey + er * 0.25), Math.floor(ez + er * 0.95), shine);
  if (!o.noFar) m.sphere(ex - dir * 0.3 * k, ey + 0.4 * k, Z(-4.4), er * 0.86, c.eye); // the far eye peeking over the head
  return m;
}
function grouperIcon() {
  const m = new VoxelModel(54, 34, 26), p = palOf(m);
  grouperInto(m, p, 27, 15.5, 12.5, 1, 1);
  return { vm: m, yaw: 0.42, pitch: 0.26, spin: 'wobble' };
}

// Multiplayer: two groupers puckering up at each other under a little heart
function heartInto(m, p, cx, cy, cz, r, t = 1.4) {
  const ht = p('#ff4a7a', { ...GL, emissive: 0.25 }), htL = p('#ff9ab4', { ...GL, emissive: 0.35 }), htD = p('#c8204e', GL);
  for (let y = Math.floor(cy - r * 1.2); y <= Math.ceil(cy + r); y++) for (let x = Math.floor(cx - r * 1.2); x <= Math.ceil(cx + r * 1.2); x++) {
    const u = (x + 0.5 - cx) / r, v = (y + 0.5 - cy) / r;
    // two round lobes over a point (a clear notch on top, so it reads as a heart at small sizes)
    const lobe = Math.hypot(Math.abs(u) - 0.5, v - 0.28) < 0.56;
    const point = v <= 0.3 && v >= -1.05 && Math.abs(u) <= (v + 1.05) * 0.95;
    if (!lobe && !point) continue;
    const th = Math.round(t * Math.sqrt(Math.max(0.15, 1 - (u * u + v * v) / 2)));
    for (let z = Math.round(cz - th); z <= Math.round(cz + th); z++) m.put(x, y, z, v > 0.35 && u < -0.15 ? htL : v < -0.7 ? htD : ht);
  }
}
// build into a scratch layer (sharing dst's palette) and stamp it turned by `ang` radians about z through (px, py)
function tiltInto(dst, build, px, py, ang) {
  const T = new VoxelModel(dst.nx, dst.ny, dst.nz);
  T.palette = dst.palette;
  build(T);
  const c = Math.cos(ang), s = Math.sin(ang);
  for (let z = 0; z < dst.nz; z++) for (let y = 0; y < dst.ny; y++) for (let x = 0; x < dst.nx; x++) {
    const dx = x + 0.5 - px, dy = y + 0.5 - py;
    const v = T.get(Math.floor(px + dx * c + dy * s), Math.floor(py - dx * s + dy * c), z);
    if (v) dst.set(x, y, z, v);
  }
}
function friends() {
  const m = new VoxelModel(64, 46, 22), p = palOf(m), k = 0.74, a = 0.14, o = { lite: true, short: true };
  tiltInto(m, (T) => grouperInto(T, p, 17.5, 15, 10.5, k, 1, o), 17.5, 15, a);
  tiltInto(m, (T) => grouperInto(T, p, 46.5, 15, 10.5, k, -1, o), 46.5, 15, -a);
  heartInto(m, p, 32, 33, 11, 6.6, 1.8);
  return { vm: m, yaw: 0.3, pitch: 0.22, spin: 'wobble' };
}

// ---------------------------------------------------------------- Byte Gem (currency): a faceted violet crystal with
// cyan "byte" pixels glowing under the crown [vicons30]
function byteGem() {
  const m = new VoxelModel(40, 34, 40), p = palOf(m);
  const cx = 20, cz = 20, R = 18.5, g = 21, top = 30; // girdle at y = g, table at y = top, culet at y = 0
  const F = { ...GL, spec: 1.2, specPow: 12, smooth: 0.45 };
  const cols = ['#b07cff', '#8a4ef0', '#d4a8ff', '#6a32c8', '#9c62f6', '#7a40dc', '#c494ff', '#5c2aa8'].map((h) => p(h, F));
  const tab = p('#e2c8ff', F), tabL = p('#f6ecff', { ...F, emissive: 0.2 }), gir = p('#4a1e94', F);
  const cyan = p('#7ff4ff', { ...GL, emissive: 0.75 }), cyanD = p('#30c8e8', { ...GL, emissive: 0.45 }), wh = p('#ffffff', { emissive: 0.9 });
  const oct = (dx, dz) => Math.max(Math.abs(dx), Math.abs(dz), (Math.abs(dx) + Math.abs(dz)) * 0.7071);
  for (let y = 0; y <= top; y++) {
    const r = y <= g ? 1.2 + (R - 1.2) * Math.pow(y / g, 0.95) : R - (R - R * 0.6) * ((y - g) / (top - g));
    for (let z = 0; z < 40; z++) for (let x = 0; x < 40; x++) {
      const dx = x + 0.5 - cx, dz = z + 0.5 - cz;
      if (oct(dx, dz) > r) continue;
      const a = Math.atan2(dz, dx), sec = ((Math.round((a / TAU) * 8) % 8) + 8) % 8;
      const half = ((Math.floor((a / TAU) * 16 + 0.5) % 2) + 2) % 2; // star / bezel facets split each sector
      let c;
      if (y === top) c = oct(dx, dz) < r * 0.45 ? tabL : tab;
      else if (y === g || y === g + 1) c = gir;
      else if (y > g) c = cols[(sec + half * 2) % 8];
      else c = cols[(sec + 3 + half) % 8];
      m.put(x, y, z, c);
    }
  }
  // the "byte" glints: little square cyan pixels on the crown + a 2x2 bit on the table, and a white sparkle
  skin(m, (x, y, z) => (y > g + 1 && y < top && h3(x >> 1, y >> 1, z >> 1, 21) > 0.86 ? (h3(x, y, z, 22) > 0.5 ? cyan : cyanD) : null));
  for (const [x, z] of [[14, 24], [15, 24], [14, 25], [15, 25], [24, 16], [25, 16]]) m.set(x, top, z, cyan);
  glint(m, 12, top - 2, 30, wh, true);
  return { vm: m, yaw: 0.4, pitch: 0.42, spin: 'full' };
}

// ---------------------------------------------------------------- Settings: a steel-blue cog with a small green one
function cog(m, p, cx, cy, z0, z1, R, r0, teeth, base, hub, holes = 0) {
  const c = p(base, METAL), cD = p(shade(base, -0.3), METAL), cL = p(mix(base, '#ffffff', 0.4), METAL), h = p(hub, METAL);
  for (let y = Math.floor(cy - R - 1); y <= cy + R + 1; y++) for (let x = Math.floor(cx - R - 1); x <= cx + R + 1; x++) {
    const dx = x + 0.5 - cx, dy = y + 0.5 - cy, d = Math.hypot(dx, dy), a = Math.atan2(dy, dx);
    const ph = ((a / TAU) * teeth % 1 + 1) % 1;
    const tooth = Math.abs(ph - 0.5) < 0.22 ? 1 : Math.abs(ph - 0.5) < 0.3 ? 0.5 : 0;
    const rr = r0 + (R - r0) * tooth;
    if (d > rr || d < R * 0.22) continue;
    if (holes && Math.abs(d - R * 0.56) < R * 0.13 && (((a / TAU) * holes % 1 + 1) % 1) < 0.5) continue;
    for (let z = z0; z <= z1; z++) {
      const face = z === z1;
      m.put(x, y, z, d < R * 0.36 ? h : face && d > rr - 1.2 ? cL : face && d < R * 0.42 ? cD : c);
    }
  }
  // raised hub ring
  for (let y = Math.floor(cy - R * 0.4); y <= cy + R * 0.4; y++) for (let x = Math.floor(cx - R * 0.4); x <= cx + R * 0.4; x++) {
    const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
    if (d <= R * 0.38 && d >= R * 0.22) m.put(x, y, z1 + 1, cL);
  }
}
function settingsCog() {
  const m = new VoxelModel(48, 48, 14), p = palOf(m);
  cog(m, p, 21, 26, 4, 9, 19.5, 15.4, 10, '#4a8cf0', '#2a4a8a', 5);
  cog(m, p, 39, 9, 2, 6, 8.2, 6, 8, '#5ad040', '#2a6a2a');
  glint(m, 13, 37, 10, p('#ffffff', { emissive: 0.8 }));
  return { vm: m, yaw: 0.42, pitch: 0.34, spin: 'wobble' };
}

// ---------------------------------------------------------------- Workshop: a claw hammer crossed with a wrench
function tools() {
  const m = new VoxelModel(48, 48, 16), p = palOf(m);
  const st = p('#c8d4e4', METAL), stD = p('#7a8aa0', METAL), stL = p('#f4f8ff', { ...METAL, emissive: 0.15 });
  // wrench (behind): shaft + open jaw + ring end
  tube(m, [[10, 38, 6, 2.3], [38, 9, 6, 2.3]], (u, x, y, z, d, nx, ny) => (ny + nx * -0.2 > 0.3 ? stL : st));
  torus(m, 8.5, 40, 6, 4.4, 2.1, 'z', st, (x, y, z, a) => { const q = ((a - Math.PI * 0.72) % TAU + TAU) % TAU; return q > 1.1; });
  torus(m, 39.5, 7.5, 6, 3.6, 1.6, 'z', stD);
  // hammer (front): wooden handle with a red grip, steel head with a claw
  const wood = p('#d8944a', WOOD), woodD = p('#a8622e', WOOD), grip = p('#ff4a5a', SOFT), gripD = p('#c82a3a', SOFT);
  tube(m, [[9, 7, 10, 2.5], [33, 35, 10, 2.2]], (u, x, y, z) => (u < 0.32 ? ((Math.floor(u * 30) & 1) ? gripD : grip) : h3(x, y, z, 6) < 0.25 ? woodD : wood));
  // head: a box along the perpendicular (-1, 1)/sqrt2 centred at (35, 37)
  for (let t = -8; t <= 8; t += 0.5) {
    const cx = 35 - t * 0.707, cy = 37 + t * 0.707;
    const r = t > 5 ? 3.4 : t < -3 ? 2.2 : 3;
    m.sphere(cx, cy, 10, r, t > 6.5 ? stL : st);
  }
  for (const s of [-1, 1]) tube(m, [[35 + 6 * 0.707, 37 - 6 * 0.707, 10 + s * 1.2, 1.4], [35 + 9 * 0.707 + 1, 37 - 9 * 0.707 - 2, 10 + s * 1.6, 1]], stD); // claw prongs
  return { vm: m, yaw: 0.34, pitch: 0.3, spin: 'wobble' };
}

// ---------------------------------------------------------------- Aquarium: a fishbowl (glass) with sand, weed and a grouper
function fishbowl() {
  const m = new VoxelModel(50, 44, 46), p = palOf(m);
  const F = layer(m), fp = palOf(F), G = layer(m), gp = palOf(G);
  const cx = 25, cz = 23, cy = 18, rx = 21, ry = 17.5;
  const wat = p('#3ab4f0', GL), watD = p('#2486d8', GL), watL = p('#a8ecff', { ...GL, light: 0.3 });
  const sand = p('#f2d48e', MATTE), sandD = p('#d4ac64', MATTE), peb = [p('#ff9a8a', SOFT), p('#9ad8ff', SOFT), p('#fff0a0', SOFT)];
  m.ellipsoid(cx, cy, cz, rx - 1.6, ry - 1.6, rx - 1.6, (x, y, z) => (y > 27 ? null : y === 27 ? watL : y < 8 ? (h3(x, y, z, 1) < 0.2 ? peb[(h3(x, y, z, 2) * 3) | 0] : h3(x, y, z, 3) < 0.3 ? sandD : sand) : y < 13 ? watD : wat));
  const weed = p('#3cc85a', SOFT), weedD = p('#228a44', SOFT);
  for (const [x, z, h, ph] of [[14, 16, 18, 0], [18, 13, 14, 1.5], [33, 15, 16, 3], [36, 19, 11, 2]]) tube(m, Array.from({ length: 5 }, (_, i) => [x + Math.sin(i * 1.3 + ph) * 1.6, 7 + (i / 4) * h, z, 1.3]), (u, xx, y) => (y % 3 === 0 ? weedD : weed));
  glint(m, 31, 27, 34, p('#ffffff', { emissive: 0.6 }));
  grouperInto(F, fp, 26, 17, 33, 0.5, 1, { lite: true }); // [vicons30] the generic fish is a grouper
  for (const [x, y, z] of [[34, 23, 36], [35, 26, 35], [33, 29, 34]]) F.sphere(x, y, z, 0.9, fp('#e8fbff', { ...GL, emissive: 0.5 }));
  const gl = gp('#d8f6ff', GLASS), gw = gp('#ffffff', { ...GLASS, emissive: 0.6 }), rim = gp('#c4ecff', GLASS);
  shellE(G, cx, cy, cz, rx, ry, rx, 1.3, (x, y, z, dx, dy, dz) => (dx < -0.3 && dy > 0.1 && dz > 0.5 && dx > -0.75 ? gw : gl), (x, y) => y <= 30 && y >= 2);
  torus(G, cx, 30.5, cz, Math.sqrt(1 - ((30.5 - cy) / ry) ** 2) * rx + 0.4, 1.3, 'y', rim);
  return { vm: m, vmOver: F, vmGlass: G, yaw: 0.3, pitch: 0.36, spin: 'wobble' };
}

// ---------------------------------------------------------------- My Fish: a glass cube tank
function cubeTank() {
  const m = new VoxelModel(48, 44, 36), p = palOf(m);
  const F = layer(m), fp = palOf(F), G = layer(m), gp = palOf(G);
  const x0 = 4, x1 = 43, z0 = 4, z1 = 31, y0 = 4, y1 = 38;
  const wat = p('#3ab4f0', GL), watD = p('#2486d8', GL), watL = p('#a8ecff', { ...GL, light: 0.3 }), sand = p('#f2d48e', MATTE), sandD = p('#d4ac64', MATTE);
  m.box(x0 + 1, y0, z0 + 1, x1 - 1, y1 - 5, z1 - 1, (x, y, z) => (y === y1 - 5 ? watL : y < y0 + 4 ? (h3(x, y, z, 3) < 0.3 ? sandD : sand) : y < y0 + 10 ? watD : wat));
  const weed = p('#3cc85a', SOFT), weedD = p('#228a44', SOFT), rock = p('#9aa4b8', SOFT);
  for (const [x, z, h, ph] of [[10, 10, 20, 0], [13, 8, 15, 2], [37, 9, 17, 1]]) tube(m, Array.from({ length: 5 }, (_, i) => [x + Math.sin(i * 1.3 + ph) * 1.6, y0 + 3 + (i / 4) * h, z, 1.3]), (u, xx, y) => (y % 3 === 0 ? weedD : weed));
  m.ellipsoid(30, y0 + 5, 12, 5, 4, 4, rock);
  // frame: navy base and lid, corner posts
  const fr = p('#2a5ab0', GL), frL = p('#4a86e0', GL), frD = p('#1a3a80', GL);
  m.box(x0 - 1, 0, z0 - 1, x1 + 1, y0 - 1, z1 + 1, (x, y) => (y === y0 - 1 ? frL : fr));
  m.box(x0 - 1, y1, z0 - 1, x1 + 1, y1 + 2, z1 + 1, (x, y) => (y === y1 + 2 ? frL : fr));
  for (const x of [x0 - 1, x1]) for (const z of [z0 - 1, z1]) m.box(x, y0, z, x + 1, y1 - 1, z + 1, frD);
  grouperInto(F, fp, 24, 20, z1 - 1, 0.56, 1, { lite: true }); // [vicons30]
  const gl = gp('#d8f6ff', GLASS), gw = gp('#ffffff', { ...GLASS, emissive: 0.6 });
  G.box(x0, y0, z1, x1, y1 - 1, z1, (x, y) => (x - y > -20 && x - y < -14 ? gw : gl));
  G.box(x0, y0, z0, x0, y1 - 1, z1, gl); G.box(x1, y0, z0, x1, y1 - 1, z1, gl); G.box(x0, y0, z0, x1, y1 - 1, z0, gl);
  return { vm: m, vmOver: F, vmGlass: G, yaw: 0.42, pitch: 0.34, spin: 'wobble' };
}

// ---------------------------------------------------------------- Aero (currency): a glossy water drop
function aeroDrop() {
  const m = new VoxelModel(32, 42, 32), p = palOf(m);
  const c = p('#2fb4f8', GL), cD = p('#1a78d8', GL), cL = p('#8ae0ff', { ...GL, light: 0.3 }), w = p('#ffffff', { emissive: 0.8 });
  const cx = 16, cz = 16, R = 12.5, yc = 13;
  for (let y = 0; y <= 40; y++) {
    const r = y <= yc ? Math.sqrt(Math.max(0, R * R - (y + 0.5 - yc - 0.5) ** 2)) : R * Math.pow(Math.max(0, 1 - (y - yc) / (40 - yc)), 1.25);
    if (r <= 0.3) continue;
    for (let z = 0; z < 32; z++) for (let x = 0; x < 32; x++) {
      const d = Math.hypot(x + 0.5 - cx, z + 0.5 - cz);
      if (d > r) continue;
      m.put(x, y, z, y < 5 ? cD : (x + 0.5 - cx) < -r * 0.2 && y > yc - 2 ? cL : c);
    }
  }
  // highlight streak + sparkle
  for (let y = 15; y <= 26; y++) { const x = Math.round(10 - (y - 15) * -0.25), z = 27 - Math.max(0, y - 22); m.set(x, y, z, w); m.set(x, y, z + 1, w); }
  m.sphere(10.5, 10, 27, 1.2, w);
  return { vm: m, yaw: 0, pitch: 0.2, spin: 'full', keepView: true };
}

// ---------------------------------------------------------------- rods
export function ROD_VOX(rod = {}) {
  const L = rod.look || {};
  const m = new VoxelModel(52, 52, 14), p = palOf(m);
  const blank = L.shaft || '#2f9ef0', gripC = L.grip || '#d8a868', reelC = L.reel || '#dfeefa', tipC = L.tip || '#ffffff';
  const A = [6, 8, 7], B = [45, 47, 7];
  const at = (k) => [A[0] + (B[0] - A[0]) * k, A[1] + (B[1] - A[1]) * k, A[2]];
  const kind = L.kind || 'stick';
  const fat = kind === 'trident' || kind === 'coil' ? 1.15 : 1;
  const bl = p(blank, GL), blD = p(shade(blank, -0.3), GL), blL = p(mix(blank, '#ffffff', 0.45), GL);
  const gr = p(gripC, kind === 'stick' ? WOOD : SOFT), grD = p(shade(gripC, -0.3), MATTE), grL = p(mix(gripC, '#ffffff', 0.3), SOFT);
  const metal = p('#d4dce8', METAL), metalD = p('#7a8aa0', METAL), wrap = p(mix(tipC, gripC, 0.3), SOFT);
  // butt cap, grip, reel seat, fore-grip
  m.sphere(...at(0), 2.6 * fat, grD);
  tube(m, [[...at(0.02), 2.5 * fat], [...at(0.26), 2.3 * fat]], (u, x, y, z) => (h3(x, y, z, 5) < 0.2 ? grD : (Math.floor(u * 9) & 1) && kind !== 'stick' ? grL : gr));
  tube(m, [[...at(0.26), 1.9 * fat], [...at(0.33), 1.9 * fat]], (u, x, y, z, d, nx, ny) => (ny > 0.3 ? metal : metalD));
  tube(m, [[...at(0.33), 2 * fat], [...at(0.38), 1.7 * fat]], gr);
  // the blank, tapering, with thread wraps at each guide
  const guides = [0.5, 0.64, 0.77, 0.88];
  tube(m, [[...at(0.38), 1.55 * fat], [...at(0.7), 1.1 * fat], [...at(0.98), 0.7 * fat]], (u, x, y, z, d, nx, ny) => {
    const k = 0.38 + u * 0.6;
    if (guides.some((g) => Math.abs(g - k) < 0.012)) return wrap;
    if (kind === 'bamboo' || (kind === 'stick' && blank === '#8be04a')) { if ((Math.floor(k * 40) % 6) === 0) return blD; }
    return ny - nx > 0.6 ? blL : nx - ny > 0.7 ? blD : bl;
  });
  // guides: little rings hanging under the blank
  for (const g of guides) { const c = at(g); torus(m, c[0] + 1.7, c[1] - 1.7, c[2], 1.1, 0.5, 'z', metal); }
  // tip
  if (kind === 'trident') for (const d of [-1, 1]) tube(m, [[...at(0.9), 0.8], [B[0] + d * 3 - 1, B[1] + 1 - d * 3, 7, 0.7], [B[0] + d * 3 + 1, B[1] + 3 - d * 3, 7, 0.5]], p(tipC, METAL));
  m.sphere(B[0], B[1], B[2], kind === 'wand' || L.glow ? 2.2 : 1.2, p(tipC, L.glow ? { ...GL, emissive: 0.7 } : GL));
  if (L.glow) m.sphere(B[0], B[1], B[2] + 1, 1.2, p('#ffffff', { emissive: 1 }));
  // spinning reel under the seat
  const s = at(0.3), rc = [s[0] + 5.5, s[1] - 5.5, 7];
  tube(m, [[s[0] + 1.2, s[1] - 1.2, 7, 1], [rc[0] - 1, rc[1] + 1, 7, 1]], metalD);
  const reel = p(reelC, METAL), reelD = p(shade(reelC, -0.3), METAL), lineC = p('#f0f6ff', SOFT);
  m.cylinder(rc[0], rc[1], 3, 11, 4.2, (x, y, z) => (z === 11 ? reel : z === 3 ? reelD : Math.hypot(x + 0.5 - rc[0], y + 0.5 - rc[1]) > 3.2 ? lineC : reel), 'z');
  m.cylinder(rc[0], rc[1], 11, 12, 1.4, reelD, 'z');
  tube(m, [[rc[0], rc[1], 12.5, 0.8], [rc[0] + 3, rc[1] - 3.5, 12.5, 0.8]], metalD);
  m.sphere(rc[0] + 3.4, rc[1] - 3.9, 12.5, 1.3, p('#ffd23a', GL));
  // line down to a red / white bobber
  const ln = p('#ffffff', { emissive: 0.4 });
  for (let y = B[1] - 2; y > 25; y--) m.set(B[0] + 2, y, 7, ln);
  m.sphere(B[0] + 2, 21, 7, 3.6, (x, y) => (y >= 21 ? p('#ff3a4a', GL) : p('#ffffff', GL)));
  m.box(B[0] + 1, 21, 4, B[0] + 3, 21, 10, p('#1a1a2a', MATTE));
  m.set(B[0] + 1, 23, 10, p('#ffffff', { emissive: 0.8 }));
  return { vm: m, yaw: 0.22, pitch: 0.16, spin: 'wobble', keepView: true };
}

// ---------------------------------------------------------------- treasure chests (fishing box catches, chest tiers)
// kind: 'crate' (driftwood) | 'iron' (wood + steel bands) | 'golden' | 'orb' (mystic purple)
export function CHEST_VOX(kind = 'iron') {
  const m = new VoxelModel(48, 42, 32), p = palOf(m);
  const woodC = kind === 'golden' ? '#c8782e' : kind === 'orb' ? '#6a3ab0' : kind === 'iron' ? '#a8642e' : '#b8844a';
  const bandC = kind === 'golden' ? '#ffd23a' : kind === 'orb' ? '#ff8ae0' : kind === 'iron' ? '#aab8cc' : '#8a6a44';
  const wd = p(woodC, WOOD), wdD = p(shade(woodC, -0.32), WOOD), wdL = p(mix(woodC, '#ffe0b0', 0.3), WOOD);
  const bd = p(bandC, METAL), bdD = p(shade(bandC, -0.35), METAL), bdL = p(mix(bandC, '#ffffff', 0.5), { ...METAL, emissive: 0.15 });
  const x0 = 4, x1 = 43, z0 = 5, z1 = 27, yTop = 21;
  // body: horizontal planks with dark seams and grain
  m.box(x0, 1, z0, x1, yTop, z1, (x, y, z) => (y % 5 === 0 ? wdD : h3(x >> 2, y, z, 5) < 0.12 ? wdD : (y % 5 === 4 ? wdL : wd)));
  // domed lid (half cylinder along x) with plank seams
  const cy = yTop + 1, cz = (z0 + z1 + 1) / 2, R = (z1 - z0 + 1) / 2;
  m.cylinder(cy, cz, x0, x1, R, (x, y, z) => {
    if (y < cy) return null;
    const a = Math.atan2(y + 0.5 - cy, z + 0.5 - cz);
    return (Math.floor(a * 3.2) & 1) ? wdL : ((a * 3.2) % 1 < 0.12 ? wdD : wd);
  }, 'x');
  // metal: rim band where lid meets body, two vertical straps over body + lid, corner caps
  m.box(x0 - 1, yTop - 1, z0 - 1, x1 + 1, yTop + 1, z1 + 1, (x, y) => (y === yTop + 1 ? bdL : bd));
  for (const xs of [x0 + 6, x1 - 8]) {
    m.box(xs, 1, z0 - 1, xs + 2, yTop, z1 + 1, bd);
    m.cylinder(cy, cz, xs, xs + 2, R + 1, (x, y) => (y < cy ? null : bd), 'x');
    for (const [y, z] of [[4, z1 + 2], [12, z1 + 2], [cy + 6, z1]]) m.set(xs + 1, y, z, bdL); // rivets
  }
  for (const x of [x0 - 1, x1 - 1]) for (const z of [z0 - 1, z1 - 1]) m.box(x, 0, z, x + 2, 4, z + 2, bdD);
  // lock plate with keyhole + glint
  const lock = kind === 'iron' || kind === 'crate' ? p('#ffd23a', METAL) : bdL;
  m.box(20, yTop - 5, z1 + 1, 27, yTop + 3, z1 + 2, lock);
  m.box(22, yTop - 3, z1 + 3, 25, yTop + 1, z1 + 3, bdD);
  m.box(23, yTop - 2, z1 + 3, 24, yTop, z1 + 3, p('#140c1a', MATTE)); m.set(23, yTop - 3, z1 + 3, p('#140c1a', MATTE));
  if (kind === 'orb') m.sphere(24, cy + R + 2, cz, 3, p('#d8a8ff', { ...GL, emissive: 0.6 }));
  if (kind === 'golden' || kind === 'orb') for (const [x, y] of [[10, 36], [38, 33]]) glint(m, x, y, cz + 8, p('#ffffff', { emissive: 0.9 }));
  return { vm: m, yaw: -0.42, pitch: 0.34, spin: 'wobble' };
}

export function GEM_VOX() { return null; }

export const ICON_VOX = {
  lab: () => flask(), quests: scroll, journal: book, inventory: satchel, wardrobe: shirt, map: globe, shop: stall, bait: baitHook,
  multiplayer: friends, settings: settingsCog, build: tools, aquarium: fishbowl, fishmgr: cubeTank, coin: aeroDrop,
  skills: () => flask(), research: () => flask(), tank: fishbowl, fishdex: book, satchel, friends, baitshop: stall, appsea: stall, store: stall,
  crafting: tools, fish: grouperIcon, grouper: grouperIcon, aerobuck: aeroDrop, aerobucks: aeroDrop, gem: byteGem, bytegem: byteGem,
};

// icons3d names that use the same detailed models
export const UI3D_VOX = {
  beaker: () => flask(), book: book, map: globe, globe, shop: stall, tank: fishbowl, settings: settingsCog, hammer: tools,
  scroll, bait: baitHook, people: friends, box: () => CHEST_VOX('crate'), coin: aeroDrop, aero: aeroDrop, coins: aeroDrop, coin_big: aeroDrop, aero_big: aeroDrop,
  aerobuck: aeroDrop, aerobucks: aeroDrop, gem: byteGem, bytegem: byteGem, fish: grouperIcon, grouper: grouperIcon, friends, multiplayer: friends, // [vicons30]
};
