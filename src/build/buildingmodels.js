// Hand-built voxel models for the seabed buildings, rendered by voxel.js into pixel-art sprites.
//
// buildingSprite(id, {scale, yaw, force}) -> {canvas, glow, flipped(), ox, oy, w, h, anchors: {top, smoke, lamp, door, ...}, lights: [{x, y, r, color}]}
//   Rendered front-facing (yaw 0, pitch BUILD_PITCH). (ox, oy) = footprint centre on the ground; anchors / lights
//   are canvas-relative.
//   Decor builds (PROPS ids) go through getProp. Renders are budgeted per 16 ms window; when over budget the
//   nearest cached scale is returned with `approx` = scale ratio (draw it scaled).
// MODEL_IDS: building ids that have a model.

import { VoxelModel, renderVoxels } from '../gfx/voxel.js';
import { getProp, PROPS } from '../gfx/props.js';
import { hash3 } from '../core/math.js';
import { makeCanvas, ctxOf } from '../core/canvas.js';

const h3 = (x, y, z, s = 0) => hash3(x, y, z, s);

function shape(m, x0, y0, z0, x1, y1, z1, test, c) {
  for (let y = Math.floor(y0); y <= Math.ceil(y1); y++) for (let z = Math.floor(z0); z <= Math.ceil(z1); z++) for (let x = Math.floor(x0); x <= Math.ceil(x1); x++) {
    if (test(x + 0.5, y + 0.5, z + 0.5)) m.put(x, y, z, c);
  }
}
const pal = (m, hexes, o = {}) => hexes.map((h) => m.color(h, o));

// Window on a +z face: glass sits in the wall plane `z`, a proud frame at z+1, mullions and a sill.
function winZ(m, x0, y0, x1, y1, z, glass, frame, o = {}) {
  m.box(x0 - 1, y0 - 1, z + 1, x1 + 1, y1 + 1, z + 1, frame);
  m.sub(() => m.box(x0, y0, z + 1, x1, y1, z + 1));
  m.box(x0, y0, z, x1, y1, z, glass);
  if (o.cross !== false) {
    const mx = Math.floor((x0 + x1) / 2), my = Math.floor((y0 + y1) / 2);
    m.box(mx, y0, z + 1, mx, y1, z + 1, frame);
    m.box(x0, my, z + 1, x1, my, z + 1, frame);
  }
  m.box(x0 - 2, y0 - 2, z + 1, x1 + 2, y0 - 2, z + 2, o.sill ?? frame);
  if (o.shutter) {
    m.box(x0 - 4, y0 - 1, z + 1, x0 - 2, y1 + 1, z + 1, o.shutter);
    m.box(x1 + 2, y0 - 1, z + 1, x1 + 4, y1 + 1, z + 1, o.shutter);
  }
  if (o.flowers) {
    m.box(x0 - 1, y0 - 4, z + 1, x1 + 1, y0 - 3, z + 3, o.flowers[0]);
    for (let x = x0; x <= x1; x++) if (h3(x, y0, z, 4) < 0.7) m.set(x, y0 - 2, z + 2, o.flowers[1 + ((x * 7) % (o.flowers.length - 1))]);
  }
}
// Window on a +x face.
function winX(m, z0, y0, z1, y1, x, glass, frame) {
  m.box(x + 1, y0 - 1, z0 - 1, x + 1, y1 + 1, z1 + 1, frame);
  m.sub(() => m.box(x + 1, y0, z0, x + 1, y1, z1));
  m.box(x, y0, z0, x, y1, z1, glass);
  const mz = Math.floor((z0 + z1) / 2);
  m.box(x + 1, y0, mz, x + 1, y1, mz, frame);
  m.box(x + 1, y0 - 2, z0 - 1, x + 2, y0 - 2, z1 + 1, frame);
}
// Round porthole on a +z face.
function portZ(m, cx, cy, z, r, glass, rim) {
  m.cylinder(cx, cy, z, z + 1, r + 1.2, rim, 'z');
  m.sub(() => m.cylinder(cx, cy, z + 1, z + 1, r, 0, 'z'));
  m.cylinder(cx, cy, z, z, r, glass, 'z');
}
// Gable roof with its ridge along x. Shingle rows + staggered seams, trim on the edges.
function gableX(m, x0, x1, y0, zc, half, rise, cols, trim) {
  shape(m, x0, y0, zc - half - 1, x1, y0 + rise, zc + half + 1, (x, y, z) => {
    const hw = half * (1 - (y - y0) / rise);
    return Math.abs(z - zc) <= hw + 0.5;
  }, (x, y, z) => {
    const hw = half * (1 - (y - y0 - 0.5) / rise);
    const d = hw - Math.abs(z + 0.5 - zc);
    const row = Math.floor((y - y0) / 2);
    if (x === x0 || x === x1 || d < 0.6 && (y - y0) < 1) return trim;
    if ((y - y0) % 2 === 0) return cols[2];
    if ((x + (row % 2) * 2) % 4 === 0) return cols[1];
    return h3(x >> 1, y, z, 3) < 0.12 ? cols[3] : cols[0];
  });
  m.box(x0, y0 + rise, zc - 1, x1, y0 + rise + 1, zc, trim);
}
function planks(cols, horiz = true) {
  return (x, y, z) => {
    const k = horiz ? y : x;
    if (k % 4 === 0) return cols[1];
    return h3(horiz ? x >> 2 : x, horiz ? y >> 2 : y >> 2, z, 7) < 0.12 ? cols[2] : cols[0];
  };
}
function stoneBase(m, x0, z0, x1, z1, h, cols) {
  m.box(x0, 0, z0, x1, h, z1, (x, y, z) => {
    const brick = ((x + (y % 2) * 3) % 6 === 0) || y % 3 === 0;
    return brick ? cols[1] : h3(x >> 1, y, z >> 1, 2) < 0.2 ? cols[2] : cols[0];
  });
}
function sandPad(m, cx, cz, rx, rz, cols) {
  shape(m, cx - rx, 0, cz - rz, cx + rx, 1, cz + rz, (x, y, z) => ((x - cx) / rx) ** 2 + ((z - cz) / rz) ** 2 < 1 - y * 0.35, (x, y, z) => (h3(x, y, z, 11) < 0.3 ? cols[1] : cols[0]));
}
function kelp(m, x, z, h, cols, seed = 0) {
  for (let y = 0; y < h; y++) m.set(Math.round(x + Math.sin(y * 0.45 + seed) * 1.2), y, z, cols[(y + seed) % 5 === 0 ? 1 : 0]);
}
function coralTree(m, x, y, z, len, col, tip, seed) {
  const br = (px, py, pz, ang, l, d) => {
    if (d > 3 || l < 2) return;
    const ex = px + Math.cos(ang) * l * 0.5, ey = py + l, ez = pz + Math.sin(ang * 1.7 + seed) * l * 0.3;
    m.line(px, py, pz, ex, ey, ez, col, Math.max(0.6, 1.4 - d * 0.3));
    m.sphere(ex, ey, ez, 1.1, tip);
    br(ex, ey, ez, ang + 0.7, l * 0.7, d + 1);
    br(ex, ey, ez, ang - 0.7, l * 0.65, d + 1);
  };
  br(x, y, z, Math.PI / 2 + (h3(seed, 1, 2) - 0.5), len, 0);
}

const SAND = ['#e8cf96', '#d8ba80'];
const STONE = ['#9a8f9e', '#7a7088', '#b0a6b2'];
const KELP = ['#4f9a52', '#7ac85a'];

// ---------------------------------------------------------------- models

const MODELS = {
  research_lab() {
    const m = new VoxelModel(68, 86, 56);
    const wall = pal(m, ['#e8dcc0', '#c8b898', '#f4ead2'], { jitter: 0.05, smooth: 0.2 });
    const trimC = m.color('#3a7a8a', { jitter: 0.04 });
    const roof = pal(m, ['#d8583a', '#a83a2a', '#b84630', '#e8704a'], { jitter: 0.06 });
    const roofTrim = m.color('#5a2a1e', { jitter: 0.04 });
    const st = pal(m, STONE, { jitter: 0.12 });
    const glass = m.color('#ffd86a', { emissive: 1, jitter: 0.03 });
    const glass2 = m.color('#7affe8', { emissive: 1, jitter: 0.03 });
    const frame = m.color('#f6f0e0', { jitter: 0.03 });
    const door = pal(m, ['#8a5634', '#6a4028']);
    const brass = m.color('#f2c84a', { spec: 1 });
    const shutter = m.color('#3a8a9a', { jitter: 0.04 });
    const brick = pal(m, ['#a8584a', '#8a4038']);
    const metal = pal(m, ['#b8c2d0', '#6a7286'], { spec: 0.8 });
    const red = m.color('#ff3a3a', { emissive: 1 });
    const domeG = m.color('#9af0ff', { emissive: 0.45, smooth: 1, spec: 1 });
    const flowers = [m.color('#7a4a2a'), m.color('#ff7aa8'), m.color('#ffe85a'), m.color('#ff5a5a'), m.color('#9a7aff')];
    const sand = pal(m, SAND, { jitter: 0.08 });
    const kc = pal(m, KELP, { smooth: 0.4 });
    sandPad(m, 32, 30, 33, 25, sand);
    // stone foundation + walls (plank siding with corner posts)
    stoneBase(m, 6, 8, 52, 44, 4, st);
    m.box(8, 5, 10, 50, 34, 42, planks(wall));
    for (const [x, z] of [[8, 10], [50, 10], [8, 42], [50, 42]]) m.box(x, 5, z, x, 34, z, trimC);
    m.box(8, 34, 10, 50, 35, 42, trimC);
    // roof (ridge along x) with a gable triangle visible on the +x side
    gableX(m, 5, 53, 36, 26, 21, 20, roof, roofTrim);
    m.sub(() => shape(m, 8, 36, 10, 50, 54, 42, (x, y, z) => x > 9 && x < 49 && Math.abs(z - 26) < 21 * (1 - (y - 36) / 20) - 1.5));
    shape(m, 50, 36, 8, 50, 55, 44, (x, y, z) => Math.abs(z - 26) <= 20 * (1 - (y - 36) / 20), planks(wall));
    // attic porthole on the gable
    shape(m, 50, 40, 22, 51, 48, 30, (x, y, z) => Math.hypot(y - 44, z - 26) < 4.2, frame);
    shape(m, 50, 40, 22, 51, 48, 30, (x, y, z) => Math.hypot(y - 44, z - 26) < 3, (x, y) => (x === 51 ? 0 : glass2));
    // dormer on the front roof slope with a round lit window
    m.box(23, 38, 36, 35, 47, 41, planks(wall));
    shape(m, 21, 47, 34, 37, 54, 43, (x, y, z) => Math.abs(x - 29) <= 8 * (1 - (y - 47) / 7) + 0.5 && z < 42.5, (x, y) => ((y - 47) % 2 === 0 ? roof[2] : roof[0]));
    m.box(21, 47, 42, 37, 47, 43, roofTrim);
    m.cylinder(29, 43, 41, 42, 3.6, frame, 'z');
    m.cylinder(29, 43, 42, 42, 2.4, glass2, 'z');
    m.set(29, 43, 42, frame); m.box(26.5, 43, 42, 31.5, 43, 42, frame);
    // front: round-top door, two lit windows with shutters and flower boxes
    const fz = 42;
    m.sub(() => m.box(25, 5, fz, 33, 20, fz));
    shape(m, 24, 5, fz - 1, 34, 22, fz, (x, y) => (y < 16 ? x > 24 && x < 34 : Math.hypot(x - 29, y - 16) < 5), (x) => ((x >> 1) % 2 ? door[0] : door[1]));
    shape(m, 23, 5, fz + 1, 35, 23, fz + 1, (x, y) => (y < 16 ? x < 24.5 || x > 33.5 : Math.hypot(x - 29, y - 16) >= 5 && Math.hypot(x - 29, y - 16) < 6.3), trimC);
    m.set(31, 12, fz, brass);
    m.box(22, 4, fz + 1, 36, 5, fz + 4, st[2]);
    winZ(m, 12, 15, 19, 25, fz, glass, frame, { shutter, flowers });
    winZ(m, 39, 15, 46, 25, fz, glass, frame, { shutter, flowers });
    // sign above the door: a flask emblem
    m.box(25, 25, fz + 1, 33, 30, fz + 1, door[1]);
    shape(m, 26, 26, fz + 2, 32, 29, fz + 2, (x, y) => (y < 28 ? Math.abs(x - 29) < 3 - (y - 26) * 0.2 : Math.abs(x - 29) < 1.2), (x, y) => (y < 27.5 ? glass2 : frame));
    // side windows (+x)
    winX(m, 16, 15, 22, 25, 50, glass, frame);
    winX(m, 31, 15, 37, 25, 50, glass, frame);
    // chimney
    m.box(14, 40, 16, 19, 60, 21, (x, y) => (y % 3 === 0 ? brick[1] : brick[0]));
    m.box(13, 60, 15, 20, 61, 22, brick[1]);
    // antenna mast + dish + blinking tip
    m.box(39, 52, 25, 40, 76, 26, metal[0]);
    m.line(39.5, 60, 25.5, 46, 54, 30, metal[1], 0.5);
    m.line(39.5, 60, 25.5, 33, 54, 30, metal[1], 0.5);
    for (const y of [64, 70]) m.box(36, y, 25, 43, y, 26, metal[0]);
    shape(m, 41, 64, 20, 49, 72, 32, (x, y, z) => { const dx = x - 44, dy = y - 68, dz = z - 26; const r = Math.hypot(dy, dz); return r < 4.2 && Math.abs(dx - (r * r) * 0.12) < 0.7; }, metal[0]);
    m.set(46, 68, 26, metal[1]);
    m.box(39, 77, 25, 40, 78, 26, red);
    // little glass observatory dome annex on the +x side
    stoneBase(m, 53, 14, 64, 28, 6, st);
    shape(m, 53, 6, 14, 64, 14, 28, (x, y, z) => Math.hypot(x - 58.5, y - 7, (z - 21) * 0.8) < 6.5, domeG);
    m.line(58, 9, 21, 63, 15, 21, metal[0], 0.7);
    // garden bits
    kelp(m, 3, 36, 18, kc, 1); kelp(m, 5, 40, 12, kc, 3); kelp(m, 60, 44, 14, kc, 2);
    m.box(56, 1, 40, 58, 9, 41, door[1]); m.box(55, 9, 39, 59, 12, 42, metal[1]); // mailbox
    return { m, yaw: 30, pitch: 26, anchors: { top: [32, 80, 26], smoke: [16.5, 62, 18.5], door: [29, 4, 44], tip: [39.5, 78, 25.5] }, light: '#ffd86a' };
  },

  bait_workshop() {
    const m = new VoxelModel(70, 60, 52);
    const wood = pal(m, ['#9c6136', '#7a4a28', '#b27848'], { jitter: 0.1 });
    const tin = pal(m, ['#8a9aa8', '#6a7888', '#a8b8c4', '#a4552f'], { jitter: 0.06, spec: 0.5 });
    const st = pal(m, STONE, { jitter: 0.12 });
    const bench = pal(m, ['#c8925a', '#93603a']);
    const metal = pal(m, ['#5d6275', '#b8c2d0'], { spec: 0.7 });
    const brass = pal(m, ['#e0a844', '#fff2b8'], { spec: 1 });
    const worm = pal(m, ['#ff8aa8', '#ffc0d0', '#d85a7a'], { smooth: 0.7 });
    const lamp = m.color('#ffd27a', { emissive: 1 });
    const glass = m.color('#ffd86a', { emissive: 1 });
    const barrel = pal(m, ['#8a5a32', '#5d6275']);
    const bait = pal(m, ['#ff6a3a', '#ffe85a', '#7aff9a'], { emissive: 0.3 });
    const sand = pal(m, SAND, { jitter: 0.08 });
    sandPad(m, 34, 26, 35, 25, sand);
    stoneBase(m, 6, 6, 56, 40, 2, st);
    // back + side walls, open front with a workbench
    m.box(8, 3, 8, 54, 34, 11, planks(wood, false));
    m.box(8, 3, 8, 11, 32, 38, planks(wood, false));
    m.box(51, 3, 8, 54, 32, 38, planks(wood, false));
    for (const x of [8, 31, 54]) m.box(x - 1, 3, 37, x + 1, 34, 39, wood[1]);
    m.box(7, 32, 36, 55, 34, 40, wood[1]);
    // lean-to tin roof, corrugated, rusty in places
    shape(m, 4, 34, 4, 58, 44, 46, (x, y, z) => Math.abs(y - (44 - (z - 4) * 0.22)) < 0.9, (x, y, z) => (h3(x >> 2, 1, z >> 2, 5) < 0.15 ? tin[3] : x % 3 === 0 ? tin[1] : x % 3 === 1 ? tin[2] : tin[0]));
    // workbench with tools, a bait press with gears, glowing bait jars
    m.box(14, 3, 26, 46, 13, 34, bench[1]);
    m.box(13, 14, 25, 47, 15, 35, bench[0]);
    m.box(15, 3, 27, 16, 12, 28, wood[1]); m.box(44, 3, 27, 45, 12, 28, wood[1]);
    for (let i = 0; i < 4; i++) { const x = 17 + i * 4; m.cylinder(x, 30, 16, 19, 1.5, i % 2 ? glass : bait[i % 3]); m.set(x, 20, 30, metal[1]); }
    m.box(34, 16, 27, 42, 26, 33, metal[0]);
    m.cylinder(38, 30, 26, 32, 1, metal[1]);
    m.box(33, 32, 29, 43, 33, 31, metal[0]);
    shape(m, 41, 16, 33, 50, 28, 35, (x, y, z) => { const r = Math.hypot(x - 45.5, y - 22); return r < 4.5 + (Math.cos(Math.atan2(y - 22, x - 45.5) * 8) > 0.3 ? 1 : 0) && r > 1.4; }, brass[0]);
    m.set(45, 22, 35, brass[1]);
    // hanging lamp
    m.box(30, 26, 22, 31, 32, 23, metal[0]); m.box(28, 23, 20, 33, 26, 25, lamp);
    // a giant worm sign on the roof
    const pts = [];
    for (let i = 0; i <= 8; i++) pts.push([16 + i * 4.2, 49 + Math.sin(i * 1.1) * 3, 22, 2.2]);
    m.tube(pts, (x, y, z) => ((x >> 1) % 3 === 0 ? worm[2] : y > 50 ? worm[1] : worm[0]));
    m.set(51, 51, 24, metal[0]); m.set(51, 52, 24, metal[0]);
    m.box(18, 41, 21, 19, 47, 22, metal[0]); m.box(46, 41, 21, 47, 47, 22, metal[0]);
    // barrels and a crate outside
    for (const [x, z, h] of [[60, 30, 12], [62, 40, 10]]) { m.cylinder(x, z, 1, h, 4.2, (xx, y) => (y % 5 === 1 ? barrel[1] : barrel[0])); m.cylinder(x, z, h, h, 3, bait[(x + z) % 3]); }
    m.box(2, 1, 40, 9, 8, 47, bench[0]); m.box(2, 8, 40, 9, 8, 47, bench[1]);
    // window in the back wall
    winZ(m, 40, 20, 47, 26, 11, glass, wood[1], { cross: true });
    return { m, yaw: 30, pitch: 26, anchors: { top: [32, 56, 24], door: [30, 2, 38], smoke: [50, 44, 10] }, light: '#ffd27a' };
  },

  hatchery() {
    const m = new VoxelModel(66, 62, 58);
    const st = pal(m, STONE, { jitter: 0.12 });
    const dome = m.color('#a8f0ff', { emissive: 0.35, smooth: 1, spec: 1, specPow: 6 });
    const domeB = m.color('#e8ffff', { emissive: 0.5, smooth: 1, spec: 1 });
    const rib = pal(m, ['#e0a844', '#a86a2a'], { spec: 0.8 });
    const egg = pal(m, ['#ffb04a', '#ffd88a'], { emissive: 0.7, smooth: 1, spec: 1 });
    const water = m.color('#5ad8ff', { emissive: 0.4, smooth: 1 });
    const pipe = pal(m, ['#5d6275', '#7a8094'], { spec: 0.6 });
    const nest = pal(m, ['#6aa84a', '#4a8a3a'], { jitter: 0.15 });
    const pink = m.color('#ff9ac8', { emissive: 0.6 });
    const sand = pal(m, SAND, { jitter: 0.08 });
    sandPad(m, 32, 30, 33, 27, sand);
    // round stone ring base
    m.cylinder(30, 28, 0, 7, 22, (x, y, z) => ((Math.floor(Math.atan2(z - 28, x - 30) * 6) + (y >> 1)) % 2 ? st[0] : y === 7 ? st[2] : st[1]));
    // eggs on a nest inside, then the ribbed glass dome over them
    m.cylinder(30, 28, 8, 9, 15, nest[0]);
    for (const [x, y, z, r] of [[26, 12, 26, 3.4], [33, 12, 25, 3.2], [30, 12, 32, 3.3], [30, 17, 28, 3], [22, 11, 32, 2.6], [37, 11, 32, 2.6], [36, 11, 21, 2.4]]) m.sphere(x, y, z, r, (xx, yy) => (yy > y ? egg[1] : egg[0]));
    shape(m, 8, 8, 6, 52, 34, 50, (x, y, z) => { const d = Math.hypot(x - 30, (y - 8) * 0.85, z - 28); return d < 21.5 && d > 20; }, (x, y, z) => {
      const a = Math.atan2(z - 28, x - 30);
      if (Math.abs(Math.sin(a * 4)) < 0.12 || (y - 8) % 7 === 0) return rib[0];
      return h3(x, y, z, 2) < 0.05 ? domeB : dome;
    });
    m.sub(() => shape(m, 8, 10, 30, 52, 26, 50, (x, y, z) => z - 28 > 9 && Math.abs(x - 30) < 10 && m.get(Math.floor(x), Math.floor(y), Math.floor(z)) === dome, 0));
    m.cylinder(30, 28, 33, 36, 3, rib[0]); m.cylinder(30, 28, 37, 38, 1.5, rib[1]);
    // side nursery tanks with water and tiny fry
    for (const [x, z] of [[56, 22], [57, 38]]) {
      m.cylinder(x, z, 0, 2, 5.5, pipe[0]);
      m.cylinder(x, z, 3, 20, 5, dome);
      m.cylinder(x, z, 3, 16, 4.4, water);
      m.cylinder(x, z, 21, 22, 5.5, pipe[1]);
      m.set(x, 9, z + 4, pink); m.set(x + 2, 12, z + 3, pink); m.set(x - 1, 6, z + 4, egg[0]);
    }
    m.line(52, 18, 30, 56, 18, 26, pipe[1], 1); m.line(52, 14, 32, 57, 14, 36, pipe[1], 1);
    // entrance arch on the front
    shape(m, 24, 0, 46, 36, 16, 52, (x, y, z) => { const r = Math.hypot(x - 30, y - 8); return y < 8 ? Math.abs(x - 30) > 4 && Math.abs(x - 30) < 6.5 : r > 4 && r < 6.5; }, st[2]);
    m.box(25, 0, 50, 35, 1, 54, st[1]);
    return { m, yaw: 30, pitch: 26, anchors: { top: [30, 40, 28], door: [30, 2, 52] }, light: '#ffb04a' };
  },

  lighthouse() {
    const m = new VoxelModel(48, 132, 48);
    const rock = pal(m, ['#7a7088', '#5c5470', '#9a90a8'], { jitter: 0.15, smooth: 0.6 });
    const white = m.color('#f4f0ea', { jitter: 0.04, smooth: 0.5 });
    const red = m.color('#d8383a', { jitter: 0.04, smooth: 0.5 });
    const iron = pal(m, ['#3a3e4e', '#5d6275'], { spec: 0.6 });
    const glass = m.color('#fff6b0', { emissive: 1, spec: 1 });
    const lampC = m.color('#ffffff', { emissive: 1 });
    const win = m.color('#ffd86a', { emissive: 1 });
    const door = pal(m, ['#5a3a22', '#3a2416']);
    const moss = pal(m, ['#5aa85a', '#3a7a46'], { jitter: 0.1 });
    const cx = 24, cz = 24;
    // craggy rock base
    for (const [x, y, z, r] of [[24, 4, 24, 18], [14, 3, 30, 10], [34, 2, 32, 9], [20, 7, 16, 11]]) shape(m, x - r, 0, z - r, x + r, y + r * 0.6, z + r, (xx, yy, zz) => Math.hypot(xx - x, (yy - y) * 1.5, zz - z) < r + (h3(xx >> 1, yy >> 1, zz >> 1, 4) - 0.5) * 3, (xx, yy, zz) => (h3(xx >> 1, yy, zz >> 1, 1) < 0.25 ? rock[1] : rock[0]));
    m.recolor((x, y, z, p) => ((p === rock[0] || p === rock[1]) && !m.get(x, y + 1, z) && h3(x, y, z, 6) < 0.4 ? moss[h3(x, y, z, 2) < 0.5 ? 0 : 1] : null));
    // striped tapered tower
    for (let y = 12; y < 98; y++) {
      const r = 9.5 - (y - 12) * 0.035;
      m.cylinder(cx, cz, y, y, r, Math.floor((y - 12) / 14) % 2 ? red : white);
    }
    // door + little windows spiralling up
    m.sub(() => m.box(cx - 2, 12, cz + 7, cx + 2, 21, cz + 10));
    shape(m, cx - 3, 12, cz + 8, cx + 3, 23, cz + 9, (x, y) => (y < 20 ? Math.abs(x - cx) < 2.6 : Math.hypot(x - cx, y - 20) < 2.6), (x) => (x % 2 ? door[0] : door[1]));
    for (const [y, a] of [[36, 0.3], [56, 1.1], [76, 0.5]]) {
      const x = Math.round(cx + Math.sin(a) * 8.8), z = Math.round(cz + Math.cos(a) * 8.8);
      m.box(x - 1, y, z - 1, x + 1, y + 4, z + 1, win);
    }
    // gallery deck + railing, lantern room, dome, vane
    m.cylinder(cx, cz, 98, 100, 12.5, iron[0]);
    shape(m, cx - 13, 101, cz - 13, cx + 13, 104, cz + 13, (x, y, z) => { const r = Math.hypot(x - cx, z - cz); return r > 11.5 && r < 12.6 && (y === 104.5 || Math.floor(Math.atan2(z - cz, x - cx) * 6) % 2 === 0); }, iron[1]);
    m.cylinder(cx, cz, 101, 112, 7, (x, y, z) => (Math.abs(Math.sin(Math.atan2(z - cz, x - cx) * 3)) < 0.2 || y === 101 || y === 112 ? iron[0] : glass));
    m.cylinder(cx, cz, 103, 110, 3, lampC);
    shape(m, cx - 9, 112, cz - 9, cx + 9, 122, cz + 9, (x, y, z) => Math.hypot(x - cx, (y - 112) * 0.9, z - cz) < 8.5, red);
    m.box(cx, 122, cz, cx, 129, cz, iron[1]);
    m.line(cx - 4, 127, cz, cx + 5, 127, cz, iron[1], 0.6);
    m.set(cx + 5, 128, cz, iron[1]);
    return { m, yaw: 30, pitch: 22, vs: 1.5, anchors: { top: [cx, 130, cz], lamp: [cx, 106, cz], door: [cx, 12, cz + 10] }, light: '#fff6b0' };
  },

  vault() {
    const m = new VoxelModel(62, 54, 50);
    const iron = pal(m, ['#5d6275', '#4b4f62', '#7a8094', '#3a3e4e'], { jitter: 0.06, spec: 0.5 });
    const rivet = m.color('#c8ccd8', { spec: 1 });
    const gold = pal(m, ['#f0b83c', '#c88a26', '#fff2b8'], { spec: 1, specPow: 5 });
    const stripeY = m.color('#ffd84a'), stripeK = m.color('#2a2a36');
    const lamp = m.color('#ffb43a', { emissive: 1 });
    const coin = pal(m, ['#5fbf98', '#b8f0d8'], { spec: 0.9 });
    const clam = pal(m, ['#c8a8e8', '#8a6ab0', '#fff6fa'], { smooth: 0.8, spec: 0.6 });
    const st = pal(m, STONE, { jitter: 0.12 });
    const sand = pal(m, SAND, { jitter: 0.08 });
    sandPad(m, 31, 26, 31, 24, sand);
    stoneBase(m, 6, 6, 54, 42, 3, st);
    // squat armoured bunker with a rounded top
    shape(m, 8, 4, 8, 52, 40, 40, (x, y, z) => y < 30 || Math.hypot((y - 30) * 1.6, z - 24) < 17, (x, y, z) => {
      if (x % 9 === 3 || (y - 4) % 9 === 0) return iron[1];
      return h3(x >> 2, y >> 2, z, 5) < 0.12 ? iron[3] : iron[0];
    });
    for (let x = 8; x <= 52; x += 3) for (const y of [4, 13, 22, 31]) { if (m.get(x, y, 40)) m.set(x, y, 41, rivet); }
    // hazard stripes along the base
    m.box(8, 4, 41, 52, 6, 41, (x, y) => (((x + y) >> 2) % 2 ? stripeY : stripeK));
    // the big round vault door: rings, bolts and a spoked wheel
    const dx = 30, dy = 21, dz = 41;
    m.cylinder(dx, dy, dz, dz + 1, 13, iron[2], 'z');
    m.cylinder(dx, dy, dz + 2, dz + 2, 11, iron[0], 'z');
    m.paint(() => m.cylinder(dx, dy, dz + 2, dz + 2, 11, (x, y) => (Math.abs(Math.hypot(x + 0.5 - dx, y + 0.5 - dy) - 8.5) < 0.6 ? iron[1] : null), 'z'));
    for (let k = 0; k < 12; k++) { const a = (k / 12) * Math.PI * 2; m.set(Math.round(dx + Math.cos(a) * 12), Math.round(dy + Math.sin(a) * 12), dz + 2, gold[1]); }
    m.cylinder(dx, dy, dz + 3, dz + 3, 2.2, gold[0], 'z');
    for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2 + 0.3; m.line(dx, dy, dz + 4, dx + Math.cos(a) * 7, dy + Math.sin(a) * 7, dz + 4, gold[0], 0.6); m.sphere(dx + Math.cos(a) * 7, dy + Math.sin(a) * 7, dz + 4, 1, gold[2]); }
    m.set(dx, dy, dz + 4, gold[2]);
    // warning lamps
    m.box(9, 33, 37, 12, 36, 40, lamp); m.box(48, 33, 37, 51, 36, 40, lamp);
    // gold + coin pile at the side, a sleepy clam guard
    for (let i = 0; i < 26; i++) m.sphere(50 + h3(i, 1, 1) * 9, 1 + h3(i, 2, 1) * 4, 40 + h3(i, 3, 1) * 8, 1.6, i % 3 ? coin[0] : gold[0]);
    m.set(54, 6, 44, coin[1]);
    shape(m, 2, 0, 38, 16, 8, 50, (x, y, z) => Math.hypot((x - 9) / 6.5, (z - 44) / 5.5) < 1 && y < 1 + (1 - Math.hypot((x - 9) / 6.5, (z - 44) / 5.5)) * 7, (x, y, z) => (y === 3 ? clam[2] : (Math.floor(Math.atan2(z - 44, x - 9) * 4) & 1 ? clam[0] : clam[1])));
    m.sub(() => m.box(3, 3, 49, 15, 3, 50));
    return { m, yaw: 30, pitch: 26, anchors: { top: [30, 50, 24], door: [30, 4, 44] }, light: '#ffb43a' };
  },

  coral_garden() {
    const m = new VoxelModel(80, 50, 54);
    const st = pal(m, ['#b8aa96', '#968872', '#d0c4ae'], { jitter: 0.12 });
    const soil = pal(m, ['#6a5040', '#544030']);
    const corals = [['#ff7a8a', '#ffd0c0'], ['#b46bd6', '#f0c4ff'], ['#ffb04a', '#fff0a8'], ['#5ad8c8', '#c8fff4']].map(([a, b]) => [m.color(a, { smooth: 0.5, jitter: 0.06 }), m.color(b, { smooth: 0.5 })]);
    const brain = pal(m, ['#8acf5a', '#5a9a3a'], { smooth: 0.8 });
    const fan = m.color('#d85aa8', { smooth: 0.3 });
    const kc = pal(m, KELP, { smooth: 0.4 });
    const wood = pal(m, ['#9c6136', '#7a4a28']);
    const lamp = m.color('#ffd27a', { emissive: 1 });
    const sand = pal(m, SAND, { jitter: 0.08 });
    sandPad(m, 40, 28, 40, 26, sand);
    // three terraced stone planters
    const beds = [[8, 32, 72, 48, 5], [12, 18, 62, 32, 10], [20, 6, 54, 18, 15]];
    for (const [x0, z0, x1, z1, h] of beds) {
      m.box(x0, 0, z0, x1, h, z1, (x, y, z) => ((x + (y % 2) * 2) % 5 === 0 || y === h ? st[1] : h3(x >> 1, y, z >> 1, 4) < 0.2 ? st[2] : st[0]));
      m.box(x0 + 1, h, z0 + 1, x1 - 1, h, z1 - 1, soil[0]);
    }
    // corals planted in rows
    let k = 0;
    for (const [x0, z0, x1, z1, h] of beds) {
      for (let x = x0 + 5; x < x1 - 3; x += 9) {
        const z = (z0 + z1) / 2 + ((k % 2) - 0.5) * 3;
        const kind = k % 5;
        if (kind === 3) m.ellipsoid(x, h + 3, z, 3.5, 3, 3, (xx, yy, zz) => ((xx + yy + zz) % 3 ? brain[0] : brain[1]));
        else if (kind === 4) shape(m, x - 5, h, z, x + 5, h + 11, z + 1, (xx, yy) => Math.hypot(xx - x, (yy - h) * 0.9) < 6 && (Math.floor(xx + yy) % 2 === 0 || Math.hypot(xx - x, yy - h) < 2), fan);
        else coralTree(m, x, h + 1, z, 5 + (k % 3), corals[kind][0], corals[kind][1], k);
        k++;
      }
    }
    // kelp at the back corners, a wooden trellis arch with lanterns
    for (const [x, z, h] of [[3, 10, 30], [6, 6, 22], [76, 12, 26], [73, 7, 34]]) kelp(m, x, z, h, kc, x);
    m.box(66, 0, 40, 67, 28, 41, wood[0]); m.box(76, 0, 40, 77, 28, 41, wood[0]);
    shape(m, 66, 26, 40, 77, 34, 41, (x, y) => Math.abs(Math.hypot(x - 71.5, y - 26) - 5.5) < 1, wood[1]);
    m.box(65, 22, 42, 67, 25, 43, lamp); m.box(76, 22, 42, 78, 25, 43, lamp);
    // stepping stones
    for (const [x, z] of [[40, 51], [34, 50], [46, 50]]) m.cylinder(x, z, 0, 1, 2.6, st[2]);
    return { m, yaw: 30, pitch: 28, anchors: { top: [40, 36, 12] }, light: '#ffd27a' };
  },

  shell_shack() {
    const m = new VoxelModel(62, 76, 50);
    const wood = pal(m, ['#c8a070', '#a8825a', '#dcb888'], { jitter: 0.1 });
    const post = m.color('#7a5634', { jitter: 0.06 });
    const straw = pal(m, ['#e8c870', '#c8a050', '#f6dc90'], { jitter: 0.14 });
    const shell = pal(m, ['#f6c0b0', '#ffe8dc', '#e88a86', '#b8d8f0'], { smooth: 0.5 });
    const conch = pal(m, ['#ffd0b0', '#e89a7a', '#fff4ec', '#ff8a8a'], { smooth: 0.7, spec: 0.6 });
    const awn = pal(m, ['#3ab8a8', '#f4f0e0']);
    const glass = m.color('#ffd86a', { emissive: 1 });
    const crab = pal(m, ['#e8583a', '#ffb08a']);
    const eye = m.color('#1a1020');
    const sand = pal(m, SAND, { jitter: 0.08 });
    sandPad(m, 30, 26, 30, 23, sand);
    // stilts + platform deck
    for (const [x, z] of [[10, 10], [48, 10], [10, 38], [48, 38]]) m.box(x, 0, z, x + 1, 10, z + 1, post);
    m.box(7, 10, 7, 52, 11, 42, (x) => (x % 3 === 0 ? wood[1] : wood[0]));
    // shell-studded walls
    m.box(10, 12, 10, 48, 34, 38, planks(wood));
    m.recolor((x, y, z, p) => ((p === wood[0] || p === wood[1]) && m.exposed(x, y, z) && y > 13 && y < 33 && h3(x, y, z, 21) < 0.06 ? shell[Math.floor(h3(x, y, z, 3) * 4)] : null));
    // shop window with an awning and a counter
    m.sub(() => m.box(16, 18, 38, 40, 28, 38));
    m.box(16, 18, 36, 40, 28, 36, wood[2]);
    m.box(18, 22, 37, 22, 27, 37, glass);
    m.box(14, 17, 38, 42, 17, 42, wood[1]);
    shape(m, 13, 29, 38, 43, 33, 46, (x, y, z) => Math.abs(y - (33 - (z - 38) * 0.5)) < 0.8, (x) => (Math.floor(x / 3) % 2 ? awn[0] : awn[1]));
    // thatched roof, shaggy edge
    shape(m, 5, 34, 5, 53, 54, 44, (x, y, z) => { const hw = 23 * (1 - (y - 34) / 20); return Math.abs(z - 24.5) <= hw && x > 5 + (y - 34) * 0.3 && x < 53 - (y - 34) * 0.3; }, (x, y, z) => ((y + (x % 2)) % 3 === 0 ? straw[1] : h3(x, y, z, 2) < 0.2 ? straw[2] : straw[0]));
    for (let x = 5; x <= 53; x += 2) if (h3(x, 0, 1, 3) < 0.6) { m.set(x, 33, 44, straw[1]); m.set(x, 33, 5, straw[1]); }
    // a giant conch on the roof
    const pts = [];
    for (let i = 0; i <= 12; i++) { const t = i / 12; pts.push([22 + t * 18, 56 + Math.sin(t * 3) * 2 + t * 6, 24, 6 * (1 - t) + 1]); }
    m.tube(pts, (x, y, z) => ((x + y) % 4 === 0 ? conch[1] : y > 60 ? conch[2] : conch[0]));
    for (let i = 0; i < 4; i++) m.sphere(26 + i * 4, 60 + i * 1.6, 24, 1.4, conch[1]);
    m.ellipsoid(20, 55, 24, 3, 3, 3, conch[3]);
    // ladder and the hermit crab owner by the door
    for (let y = 1; y < 10; y += 2) m.box(52, y, 26, 56, y, 26, post);
    m.box(52, 0, 25, 52, 10, 25, post); m.box(56, 0, 25, 56, 10, 25, post);
    m.ellipsoid(44, 14, 41, 3, 2.5, 2.5, crab[0]);
    m.sphere(46, 17, 40, 3.2, conch[0]);
    m.set(42, 16, 43, eye); m.set(44, 16, 43, eye);
    m.line(41, 14, 42, 39, 15, 44, crab[1], 0.6);
    return { m, yaw: 30, pitch: 26, anchors: { top: [30, 70, 24], door: [28, 10, 42] }, light: '#ffd86a' };
  },

  arcade() {
    const m = new VoxelModel(66, 80, 50);
    const wall = pal(m, ['#4a3a8a', '#3a2a6a', '#5a4aa8'], { jitter: 0.05 });
    const neonP = m.color('#ff4ab8', { emissive: 1 });
    const neonC = m.color('#4af0ff', { emissive: 1 });
    const neonY = m.color('#ffe84a', { emissive: 1 });
    const bulbs = [m.color('#ffe84a', { emissive: 1 }), m.color('#ff8a3a', { emissive: 0.6 })];
    const glass = m.color('#8ae8ff', { emissive: 0.5, smooth: 1 });
    const claw = pal(m, ['#c8ccd8', '#8a8e9a'], { spec: 0.8 });
    const prize = [m.color('#ff7a5a'), m.color('#7aff9a'), m.color('#ffd84a'), m.color('#c8a0ff')];
    const st = pal(m, STONE, { jitter: 0.12 });
    const door = m.color('#2a1a4a');
    const metal = pal(m, ['#5d6275', '#b8c2d0'], { spec: 0.7 });
    const sand = pal(m, SAND, { jitter: 0.08 });
    sandPad(m, 32, 26, 32, 24, sand);
    stoneBase(m, 6, 6, 58, 42, 2, st);
    m.box(8, 3, 8, 56, 44, 40, (x, y, z) => (y % 6 === 0 ? wall[1] : h3(x >> 2, y >> 2, z, 9) < 0.1 ? wall[2] : wall[0]));
    // stepped retro facade + marquee
    m.box(6, 44, 36, 58, 56, 42, wall[1]);
    m.box(14, 56, 36, 50, 64, 42, wall[1]);
    m.box(24, 64, 36, 40, 68, 42, wall[1]);
    for (let x = 7; x <= 57; x += 2) m.set(x, 45, 43, bulbs[(x >> 1) % 2]);
    for (let x = 7; x <= 57; x += 2) m.set(x, 55, 43, bulbs[((x >> 1) + 1) % 2]);
    // neon "fish" sign on the marquee
    const fish = ['....######.....##', '..##########..###', '.#############.##', '##@###########...', '.#############.##', '..##########..###', '....######.....##'];
    fish.forEach((row, j) => [...row].forEach((ch, i) => { if (ch !== '.') m.set(23 + i, 58 + 3 - j + 3, 43, ch === '@' ? neonY : (i + j) % 7 ? neonP : neonC); }));
    m.box(14, 50, 43, 50, 50, 43, neonC);
    // open shop front: a claw machine and a game cabinet inside a recess
    m.sub(() => m.box(12, 10, 31, 41, 38, 40));
    m.box(12, 10, 31, 41, 38, 31, wall[1]);
    m.box(12, 9, 31, 41, 9, 40, metal[0]);
    for (let x = 12; x <= 41; x += 3) m.set(x, 9, 40, neonC);
    // claw machine: glass sides/top, open brass-framed front, prizes in a heap
    m.box(14, 10, 33, 28, 37, 38, glass);
    m.sub(() => m.box(15, 14, 33, 27, 34, 38));
    m.box(14, 10, 38, 28, 13, 38, wall[2]);
    m.box(14, 10, 33, 28, 13, 37, wall[1]);
    for (const x of [14, 28]) m.box(x, 14, 38, x, 37, 38, claw[0]);
    m.box(14, 34, 38, 28, 37, 38, neonP);
    for (let i = 0; i < 18; i++) m.sphere(16 + h3(i, 1, 0) * 11, 14.5 + h3(i, 2, 0) * 2.5 + (i > 11 ? 2 : 0), 34.5 + h3(i, 3, 0) * 3, 1.5, prize[i % 4]);
    m.box(21, 28, 35, 21, 33, 35, claw[1]);
    m.line(21, 28, 35, 19, 25, 35, claw[0], 0.6); m.line(21, 28, 35, 23, 25, 35, claw[0], 0.6);
    m.box(17, 11, 38, 19, 12, 39, neonY);
    // game cabinet with a glowing screen
    m.box(31, 10, 33, 39, 32, 38, wall[2]);
    m.box(32, 22, 38, 38, 29, 38, neonC);
    m.box(33, 23, 38, 37, 28, 38, m.color('#1a3a6a', { emissive: 0.8 }));
    m.set(34, 26, 38, neonY); m.set(36, 24, 38, neonP); m.set(35, 25, 38, neonC);
    m.box(31, 17, 38, 39, 18, 41, metal[0]);
    m.set(33, 19, 40, neonP); m.set(36, 19, 40, neonY); m.set(37, 19, 39, neonC);
    // neon edge trims
    m.box(7, 3, 41, 7, 43, 41, neonC); m.box(57, 3, 41, 57, 43, 41, neonP);
    // door
    m.box(44, 3, 40, 52, 22, 40, door);
    m.box(43, 22, 40, 53, 23, 41, neonP);
    m.box(43, 3, 41, 43, 22, 41, neonC); m.box(53, 3, 41, 53, 22, 41, neonC);
    // giant claw on the roof
    m.box(31, 68, 38, 33, 76, 40, claw[1]);
    m.box(27, 76, 37, 37, 77, 41, claw[0]);
    for (const s of [-1, 1]) m.line(32 + s * 1, 68, 39, 32 + s * 5, 64, 40, claw[0], 0.8);
    return { m, yaw: 30, pitch: 24, anchors: { top: [32, 78, 39], door: [48, 2, 42] }, light: '#ff4ab8' };
  },

  totem() {
    const m = new VoxelModel(40, 108, 34);
    const wood = pal(m, ['#9a6038', '#83502e', '#b27848'], { jitter: 0.1, smooth: 0.35 });
    const deep = m.color('#3a2018');
    const teal = m.color('#3ab8a8', { jitter: 0.05 });
    const red = m.color('#d84a3a', { jitter: 0.05 });
    const white = m.color('#f2ead8');
    const gold = pal(m, ['#ffd04a', '#c88a26'], { spec: 1, emissive: 0.2 });
    const gem = m.color('#7aff6a', { emissive: 1, spec: 1 });
    const candle = m.color('#fff4d8'), flame = m.color('#ffb43a', { emissive: 1 });
    const st = pal(m, STONE, { jitter: 0.12 });
    const leaf = pal(m, ['#5ad85a', '#3a9a3a']);
    const cx = 20, cz = 16, fz = 27;
    m.cylinder(cx, cz, 0, 4, 15, (x, y, z) => (h3(x >> 1, y, z >> 1, 3) < 0.25 ? st[1] : st[0]));
    m.cylinder(cx, cz, 5, 92, 10, (x, y, z) => wood[Math.floor((y + (x >> 2)) / 3) % 2]);
    const face = (y0, mood) => {
      m.box(cx - 10, y0 + 22, cz + 6, cx + 9, y0 + 25, fz, wood[2]);
      for (const s of [-1, 1]) {
        const ex = cx + s * 5 - (s > 0 ? 1 : 0);
        m.box(ex - 3, y0 + 14, fz - 1, ex + 3, y0 + 20, fz, deep);
        m.box(ex - 2, y0 + 15, fz, ex + 2, y0 + 19, fz, white);
        m.box(ex - (mood === 'wink' && s > 0 ? 2 : 0.5), y0 + (mood === 'wink' && s > 0 ? 17 : 15), fz, ex + (mood === 'wink' && s > 0 ? 2 : 0.5), y0 + 17, fz, deep);
      }
      m.box(cx - 3, y0 + 8, fz - 1, cx + 2, y0 + 14, fz + 1, wood[2]);
      m.box(cx - 7, y0 + 2, fz - 1, cx + 6, y0 + 6, fz, deep);
      if (mood === 'grin') m.box(cx - 5, y0 + 4, fz, cx + 4, y0 + 5, fz, white);
      else m.box(cx - 5, y0 + 3, fz, cx + 4, y0 + 4, fz, red);
      m.box(cx - 11, y0 + 1, cz - 2, cx - 10, y0 + 12, cz + 6, teal);
      m.box(cx + 9, y0 + 1, cz - 2, cx + 10, y0 + 12, cz + 6, teal);
    };
    face(6, 'grin'); face(36, 'wink'); face(64, 'grin');
    // glowing four-leaf clover gem between faces
    m.cylinder(cx - 0.5, 34, fz - 1, fz + 1, 3.4, gold[0], 'z');
    for (const [dx, dy] of [[-2, 0], [2, 0], [0, -2], [0, 2]]) m.sphere(cx - 0.5 + dx, 34 + dy, fz + 1.5, 1.6, leaf[0]);
    m.set(cx, 34, fz + 3, gem);
    // wings + crown
    for (const s of [-1, 1]) shape(m, cx + s * 10 - 10, 82, cz - 1, cx + s * 10 + 10, 100, cz + 2, (x, y) => { const dx = (x - cx) * s; return dx > 8 && dx < 20 && y < 100 - (dx - 8) * 0.9 && y > 84 + (dx - 8) * 0.3; }, (x, y) => ((y + x) % 4 === 0 ? teal : red));
    m.box(cx - 11, 92, cz - 11, cx + 10, 94, cz + 10, gold[1]);
    for (let k = 0; k < 7; k++) { const a = k / 7 * Math.PI; m.line(cx, 94, cz, cx + Math.cos(a) * 9, 103, cz + Math.sin(a) * 3 + 4, k % 2 ? gold[0] : gold[1], 1); m.set(Math.round(cx + Math.cos(a) * 9), 104, Math.round(cz + Math.sin(a) * 3 + 4), gem); }
    // candles on the base
    for (const [x, z] of [[8, 27], [32, 26], [6, 12], [34, 10]]) { m.box(x, 5, z, x + 1, 9, z + 1, candle); m.set(x, 10, z, flame); m.set(x + 1, 10, z + 1, flame); }
    return { m, yaw: 28, pitch: 22, vs: 1.5, anchors: { top: [cx, 104, cz], gem: [cx, 34, fz + 3] }, light: '#7aff6a' };
  },

  bubble_tower() {
    const m = new VoxelModel(46, 122, 46);
    const glass = m.color('#a8f0ff', { emissive: 0.3, smooth: 1, spec: 1, specPow: 6 });
    const glassB = m.color('#e8ffff', { emissive: 0.5, smooth: 1, spec: 1 });
    const coral = pal(m, ['#ff8a7a', '#ffc0a8', '#d85a5a'], { jitter: 0.1, smooth: 0.5 });
    const brass = pal(m, ['#e0a844', '#a86a2a'], { spec: 1 });
    const water = m.color('#5ad8ff', { emissive: 0.5, smooth: 1 });
    const pearl = m.color('#fff6fa', { emissive: 0.4, spec: 1 });
    const st = pal(m, STONE, { jitter: 0.12 });
    const cx = 23, cz = 23;
    // coral rock base
    shape(m, 4, 0, 4, 42, 14, 42, (x, y, z) => Math.hypot(x - cx, (y - 2) * 1.6, z - cz) < 17 + (h3(x >> 1, y >> 1, z >> 1, 8) - 0.5) * 4, (x, y, z) => (h3(x >> 1, y >> 1, z >> 1, 2) < 0.4 ? coral[0] : h3(x, y, z, 3) < 0.15 ? coral[1] : st[0]));
    // stacked glass bubbles with brass rings, wobbling up the spine
    let y = 12;
    const rs = [11, 9.5, 8.5, 7.5, 6.5, 5.5];
    rs.forEach((r, i) => {
      const ox = Math.sin(i * 1.3) * 2.2, oz = Math.cos(i * 1.1) * 1.6;
      const yc = y + r;
      shape(m, cx + ox - r - 1, yc - r - 1, cz + oz - r - 1, cx + ox + r + 1, yc + r + 1, cz + oz + r + 1, (x, yy, z) => { const d = Math.hypot(x - cx - ox, yy - yc, z - cz - oz); return d < r && d > r - 1.3; }, (x, yy, z) => (h3(x, yy, z, i) < 0.04 ? glassB : glass));
      shape(m, cx + ox - r + 2, yc - r, cz + oz - r + 2, cx + ox + r - 2, yc - r * 0.2, cz + oz + r - 2, (x, yy, z) => Math.hypot(x - cx - ox, yy - yc, z - cz - oz) < r - 1.5, water);
      m.sphere(cx + ox, yc - r * 0.4, cz + oz, 1.6, pearl);
      m.cylinder(cx + ox, cz + oz, yc + r - 1, yc + r, r * 0.45, brass[0]);
      y = Math.round(yc + r - 1);
    });
    // a spiral brass ribbon wraps the bubbles
    for (let t = 0; t < 1; t += 0.004) {
      const a = t * Math.PI * 9, yy = 14 + t * (y - 14), r = 12 - t * 6;
      m.set(Math.round(cx + Math.cos(a) * r), Math.round(yy), Math.round(cz + Math.sin(a) * r), brass[1]);
    }
    // bubble-blowing nozzle on top
    m.cylinder(cx, cz, y, y + 6, 1.6, brass[0]);
    shape(m, cx - 5, y + 6, cz - 5, cx + 5, y + 10, cz + 5, (x, yy, z) => Math.hypot(x - cx, z - cz) < 1.6 + (yy - y - 6) * 1.1, brass[0]);
    m.sub(() => m.cylinder(cx, cz, y + 8, y + 10, 3, 0));
    m.sphere(cx + 1, y + 14, cz, 2.6, glassB);
    return { m, yaw: 30, pitch: 22, vs: 1.5, anchors: { top: [cx, y + 16, cz], nozzle: [cx, y + 10, cz] }, light: '#8ae8ff' };
  },
};

export const MODEL_IDS = new Set(Object.keys(MODELS));

// Base building scale in the world (at depth z = 0); the perspective scale multiplies this.
export const WORLD_SCALE = 0.85;
// Buildings face the viewer square-on (yaw 0) and are seen slightly from above, like the 3D seabed:
// they sit level on the floor with horizontal edges parallel to the screen.
export const BUILD_YAW = 0, BUILD_PITCH = 24;

// ---------------------------------------------------------------- rendering + caches

let winStart = 0, spent = 0;
function canRender(budget = 9) {
  const now = performance.now();
  if (now - winStart > 16) { winStart = now; spent = 0; }
  return spent < budget;
}

const built = new Map();
function modelOf(id) {
  let b = built.get(id);
  if (!b && MODELS[id]) { b = MODELS[id](); built.set(id, b); }
  return b;
}

function flipCanvas(c) {
  const f = makeCanvas(c.width, c.height);
  const g = ctxOf(f);
  g.translate(c.width, 0);
  g.scale(-1, 1);
  g.drawImage(c, 0, 0);
  return f;
}

const cache = new Map();
const scalesOf = new Map(); // id -> Set of rendered scale keys (for nearest fallback)

function renderBuilding(id, scale, yaw) {
  if (!MODELS[id]) {
    // seabed decor: PROPS sprite
    if (!PROPS[id]) return null;
    const p = getProp(id, { scale: Math.max(0.1, Math.round(scale * 1.4 * 20) / 20) });
    const top = { x: p.ox, y: 0 };
    return { canvas: p.canvas, glow: p.glow, ox: p.ox, oy: p.oy, w: p.w, h: p.h, anchors: { top }, lights: p.lights || [], decor: true };
  }
  const b = modelOf(id);
  const r = renderVoxels(b.m, { scale: (b.vs ?? 1.6) * scale, yaw: yaw ?? BUILD_YAW, pitch: BUILD_PITCH, glowRadius: 3 });
  const anchors = {};
  for (const [k, a] of Object.entries(b.anchors || {})) {
    const [x, y] = r.project(a[0], a[1], a[2]);
    anchors[k] = { x: Math.round(x), y: Math.round(y) };
  }
  // emissive regions become light suggestions
  const lights = [];
  for (const [k, reg] of Object.entries(r.regions)) {
    const pe = b.m.palette[k];
    if (!pe?.emissive || pe.emissive < 0.9 || reg.n < 4) continue;
    lights.push({ x: Math.round(reg.cx), y: Math.round(reg.cy), r: Math.round(Math.max(reg.w, reg.h) * 0.6 + 16 * scale), color: pe.color });
  }
  return { canvas: r.canvas, glow: r.glow, ox: r.ox, oy: r.oy, w: r.w, h: r.h, anchors, lights, ids: r.ids, light: b.light };
}

// Quantised scale keys keep the cache small (perspective depths share renders).
export function qScale(s) { return Math.max(0.12, Math.round(s * 20) / 20); }

export function buildingSprite(id, { scale = WORLD_SCALE, yaw = null, force = false } = {}) {
  scale = qScale(scale);
  const key = id + '|' + scale + '|' + (yaw ?? '');
  let s = cache.get(key);
  if (s) return s;
  if (!force && !canRender()) {
    // nearest rendered scale, drawn scaled by the caller
    const set = scalesOf.get(id + '|' + (yaw ?? ''));
    if (set && set.size) {
      let best = null, bd = 1e9;
      for (const k of set) { const d = Math.abs(k - scale); if (d < bd) { bd = d; best = k; } }
      const q = cache.get(id + '|' + best + '|' + (yaw ?? ''));
      if (q) return { ...q, approx: scale / best };
    }
    return null;
  }
  const t0 = performance.now();
  s = renderBuilding(id, scale, yaw);
  spent += performance.now() - t0;
  if (!s) return null;
  let fl = null;
  s.flipped = () => (fl ||= flipCanvas(s.canvas));
  let gfl = null;
  s.glowFlipped = () => (s.glow ? (gfl ||= flipCanvas(s.glow)) : null);
  cache.set(key, s);
  const sk = id + '|' + (yaw ?? '');
  if (!scalesOf.has(sk)) scalesOf.set(sk, new Set());
  scalesOf.get(sk).add(scale);
  return s;
}

export function modelInfo(id) {
  const b = modelOf(id);
  return b ? { nx: b.m.nx, ny: b.m.ny, nz: b.m.nz, light: b.light } : null;
}
