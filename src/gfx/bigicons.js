// Big chunky voxel icons (~44 px) for the floating tab bar, rendered with the voxel ray-caster so they
// match the world's props. Every icon has 'normal' | 'hover' | 'active' variants (same canvas size and
// anchor) plus a small re-render for the compact strip.
//
//   BIG_ICON_IDS
//   getBigIcon(id, {state = 'normal', small = false}) -> {canvas, cx, by}  (cx, by = bottom-centre anchor)
//   drawBigIcon(ctx, id, x, y, {state, small, badge, t, squash}) draws with the bottom-centre at (x, y);
//     badge: number | '!' | null (red pill, top-right), squash: -1..1 (press squash / hop stretch)
//   drawBadge(ctx, x, y, badge, t) (right edge at x, top at y)

import { makeCanvas, ctxOf } from '../core/canvas.js';
import { VoxelModel, renderVoxels } from './voxel.js';
import { unpack, pack, mix, rgbToHex } from '../core/color.js';
import { hash2, clamp } from '../core/math.js';
import { drawText, measureText } from './font.js';

export const BIG_ICON_IDS = ['aquarium', 'journal', 'skills', 'shop', 'map', 'inventory', 'build', 'research', 'wardrobe', 'store', 'boatyard', 'settings'];

const BIG = 44, SMALL = 24, PAD = 3;

const h3 = (x, y, z, s) => hash2(x * 31 + z * 17, y, s);

// ---------------------------------------------------------------- models

function aquarium() {
  const m = new VoxelModel(28, 26, 16);
  const wood = m.color('#9a5a2e', { jitter: 0.12 }), woodL = m.color('#c08550', { jitter: 0.1 });
  const frame = m.color('#33475e', { spec: 1.2 }), rim = m.color('#5a7690', { spec: 1.4 });
  const water = m.color('#3ab4e6', { smooth: 0.3, light: 0.25, jitter: 0.03 }), deep = m.color('#2584c4', { jitter: 0.03 });
  const surf = m.color('#9ae8ff', { light: 0.4 }), glint = m.color('#ffffff', { spec: 2 });
  const sand = m.color('#f0d08e', { jitter: 0.12 }), plant = m.color('#3fc26e', { jitter: 0.1 }), plantD = m.color('#22905a');
  const fish = m.color('#ff8a3a', { jitter: 0.05 }), fishL = m.color('#ffd0a0'), eye = m.color('#1a1226'), bub = m.color('#e6fbff', { light: 0.6 });
  m.box(0, 0, 1, 27, 4, 14, wood);
  m.box(0, 4, 1, 27, 4, 14, woodL);
  m.box(2, 1, 15, 4, 3, 15, woodL);
  m.box(23, 1, 15, 25, 3, 15, woodL);
  m.box(1, 5, 2, 26, 21, 13, (x, y, z) => (y >= 20 ? surf : y < 9 ? deep : water));
  m.box(2, 5, 13, 25, 7, 13, sand);
  m.recolor((x, y, z, v) => {
    const ex = x === 1 || x === 26, ey = y === 5 || y === 21, ez = z === 2 || z === 13;
    if ((ex && ez) || (ex && ey) || (ey && ez)) return frame;
    return null;
  });
  m.box(0, 22, 1, 27, 22, 14, rim);
  m.box(1, 23, 2, 26, 23, 13, frame);
  // details on the front glass
  for (const [x, h] of [[5, 7], [7, 5], [21, 6], [23, 8]]) for (let y = 8; y < 8 + h; y++) m.set(x + ((y >> 1) & 1), y, 14, y % 3 ? plant : plantD);
  const fx = 14, fy = 14;
  for (let x = -4; x <= 4; x++) for (let y = -2; y <= 2; y++) if ((x / 4.4) ** 2 + (y / 2.6) ** 2 <= 1) m.set(fx + x, fy + y, 14, y > 0 ? fishL : fish);
  for (const [x, y] of [[-5, 0], [-6, 1], [-6, -1], [-7, 2], [-7, -2]]) m.set(fx + x, fy + y, 14, fish);
  m.set(fx + 2, fy + 1, 15, eye);
  m.set(fx + 1, fy - 3, 14, fish);
  for (const [x, y] of [[18, 18], [19, 20], [10, 19]]) m.set(x, y, 14, bub);
  for (let k = 0; k < 5; k++) m.set(3 + k, 18 - k, 14, glint);
  return { m, yaw: 28, pitch: 24 };
}

function journal() {
  const m = new VoxelModel(24, 32, 11);
  const cover = m.color('#b2402e', { jitter: 0.1 }), coverD = m.color('#7e2a26', { jitter: 0.08 });
  const pages = m.color('#f6ead0', { light: 0.2 }), pageL = m.color('#d8c8a0');
  const gold = m.color('#eab23c', { spec: 1.6, jitter: 0.04 }), goldL = m.color('#fff0a0', { spec: 2 });
  const ribbon = m.color('#3a7ad8'), eye = m.color('#3a1a1a');
  m.box(2, 0, 2, 21, 27, 8, cover);
  m.box(4, 1, 3, 21, 26, 7, (x, y) => (y % 3 === 0 ? pageL : pages));
  m.box(2, 0, 2, 4, 27, 8, coverD);
  for (const y of [3, 4, 23, 24]) m.box(2, y, 2, 3, y, 8, gold);
  for (const [x, y] of [[19, 0], [19, 25]]) { m.box(x, y, 8, x + 2, y + 2, 9, gold); m.set(x + 2, y + (y ? 2 : 0), 9, goldL); }
  // embossed fish emblem
  const cx = 13, cy = 14;
  for (let x = -4; x <= 4; x++) for (let y = -3; y <= 3; y++) if ((x / 4.3) ** 2 + (y / 2.8) ** 2 <= 1) m.set(cx + x, cy + y, 9, y < 0 ? goldL : gold);
  for (const [x, y] of [[-5, 0], [-6, 1], [-6, -1], [-7, 2], [-7, -2]]) m.set(cx + x, cy + y, 9, gold);
  m.set(cx + 2, cy + 1, 10, eye);
  m.box(8, 20, 9, 17, 21, 9, gold);
  m.box(9, 7, 9, 16, 7, 9, gold);
  m.line(16, 27, 5, 16, 31, 5, ribbon);
  m.line(17, 27, 5, 17, 30, 5, ribbon);
  return { m, yaw: 30, pitch: 22 };
}

function skills() {
  const m = new VoxelModel(28, 31, 18);
  const rock = m.color('#6a7a90', { jitter: 0.15 }), rockD = m.color('#4a5670');
  const coral = m.color('#ff7a86', { smooth: 0.5, jitter: 0.08 }), coralD = m.color('#d8506e', { smooth: 0.5 });
  const nodes = [m.color('#7dffb8', { emissive: 0.85, spec: 1.5 }), m.color('#ffe27a', { emissive: 0.85, spec: 1.5 }), m.color('#7ad8ff', { emissive: 0.85, spec: 1.5 }), m.color('#ff9ad0', { emissive: 0.85 })];
  m.ellipsoid(14, 1.5, 9, 10, 3.2, 7, (x, y, z) => (h3(x, y, z, 3) < 0.3 ? rockD : rock));
  const col = (x, y, z) => (h3(x, y, z, 5) < 0.25 ? coralD : coral);
  m.tube([[14, 3, 9, 3.0], [14, 9, 9, 2.5], [13.5, 15, 9, 2.1], [13, 21, 9, 1.8], [13.5, 25, 9, 1.5]], col);
  m.tube([[14, 8, 9, 2.1], [10, 12, 9, 1.9], [7, 16, 9, 1.7], [5.5, 20, 9, 1.5]], col);
  m.tube([[14, 11, 9, 2.0], [18, 14, 9, 1.8], [21, 17, 9, 1.6], [22, 21, 9, 1.4]], col);
  m.tube([[9, 13, 9, 1.4], [8, 16, 12, 1.2], [9, 18, 13.5, 1.1]], col);
  m.tube([[19, 15, 9, 1.4], [18, 18, 5, 1.2], [17, 20, 4, 1.1]], col);
  m.sphere(5.5, 22.5, 9, 3, nodes[0]);
  m.sphere(22, 23.5, 9, 3, nodes[1]);
  m.sphere(13.5, 27.5, 9, 3.1, nodes[2]);
  m.sphere(9, 20, 14, 2.1, nodes[3]);
  m.sphere(17, 22, 4, 2.1, nodes[0]);
  return { m, yaw: 30, pitch: 22 };
}

function shop() {
  const m = new VoxelModel(30, 30, 19);
  const wood = m.color('#a8683a', { jitter: 0.12 }), woodL = m.color('#d09a5e', { jitter: 0.1 }), woodD = m.color('#6e4024', { jitter: 0.1 });
  const red = m.color('#e0463e', { jitter: 0.05 }), white = m.color('#fff4e6', { jitter: 0.03 });
  const glass = m.color('#8ee6d0', { spec: 2, smooth: 0.8, light: 0.2 }), lid = m.color('#e0463e', { spec: 1 });
  const worm = m.color('#ff8ab0'), fish = m.color('#4ab4e8'), fishL = m.color('#c8f0ff'), gold = m.color('#f4c040', { spec: 1.8 });
  m.box(3, 0, 5, 26, 9, 15, (x, y) => (y % 3 === 2 ? woodD : wood));
  m.box(2, 10, 4, 27, 11, 16, woodL);
  m.box(4, 12, 5, 5, 23, 6, woodD);
  m.box(24, 12, 5, 25, 23, 6, woodD);
  // striped awning sloping toward the viewer
  for (let z = 2; z <= 18; z++) {
    const y = Math.round(27 - (z - 2) * 0.42);
    for (let x = 1; x <= 28; x++) {
      const c = Math.floor((x - 1) / 4) % 2 ? white : red;
      m.set(x, y, z, c);
      m.set(x, y - 1, z, c);
      if (z === 18 && (x + 1) % 4 < 2) m.set(x, y - 2, z, c);
    }
  }
  // goods on the counter: bait jar with worms, a fish and a coin stack
  m.cylinder(9, 11, 12, 18, 2.6, (x, y, z) => (y < 16 && h3(x, y, z, 2) < 0.35 ? worm : glass));
  m.cylinder(9, 11, 19, 19, 3, lid);
  m.ellipsoid(17, 13.5, 12, 3.6, 1.6, 1.8, (x, y) => (y < 13 ? fishL : fish));
  m.box(20, 13, 12, 21, 14, 12, fish);
  m.cylinder(22.5, 13, 12, 14, 1.6, gold);
  return { m, yaw: 28, pitch: 24 };
}

function map() {
  const m = new VoxelModel(30, 8, 22);
  const parch = m.color('#efdcb0', { jitter: 0.06 }), parchD = m.color('#cdb07a', { jitter: 0.06 });
  const sea = m.color('#4aa8dc', { jitter: 0.04 }), seaL = m.color('#7ad0f0'), isl = m.color('#5ac060', { jitter: 0.06 }), sand = m.color('#f2d896');
  const red = m.color('#e0383a', { light: 0.2 }), gold = m.color('#f4c040', { spec: 1.6 }), white = m.color('#ffffff');
  m.box(4, 1, 2, 25, 1, 19, parch);
  const islands = [[10, 7, 3, 2.2], [19, 13, 2.6, 3], [9, 15, 2.2, 1.6]];
  m.recolor((x, y, z) => {
    if (y !== 1) return null;
    if (x < 6 || x > 23 || z < 4 || z > 17) return parch;
    let d = 9;
    for (const [ix, iz, rx, rz] of islands) d = Math.min(d, Math.hypot((x + 0.5 - ix) / rx, (z + 0.5 - iz) / rz));
    if (d < 0.75) return isl;
    if (d < 1.1) return sand;
    if (d < 1.5) return seaL;
    return (x * 3 + z * 5) % 11 === 0 ? seaL : sea;
  });
  for (const [x, z] of [[11, 9], [13, 10], [15, 11], [17, 11]]) m.set(x, 2, z, red);
  for (const [x, z] of [[18, 12], [20, 14], [20, 12], [18, 14], [19, 13]]) m.set(x, 2, z, red);
  for (const [x, z, c] of [[21, 5, gold], [22, 5, white], [20, 5, gold], [21, 4, white], [21, 6, gold]]) m.set(x, 2, z, c);
  m.cylinder(3.5, 2.5, 1, 20, 2.4, (x, y, z) => (y > 2 ? parch : parchD), 'z');
  m.cylinder(26.5, 2.5, 1, 20, 2.4, (x, y, z) => (y > 2 ? parch : parchD), 'z');
  return { m, yaw: 26, pitch: 46 };
}

function inventory() {
  const m = new VoxelModel(28, 28, 14);
  const lea = m.color('#a0602f', { jitter: 0.12, smooth: 0.3 }), leaD = m.color('#7a4426', { jitter: 0.1 }), flapC = m.color('#bc7a3e', { jitter: 0.1, smooth: 0.3 });
  const stitch = m.color('#f4d8a0'), gold = m.color('#f2c040', { spec: 1.8 }), hole = m.color('#3a2010');
  const strap = m.color('#6a3622', { jitter: 0.08 }), fish = m.color('#ff8a3a'), fishD = m.color('#c8522a');
  const inBody = (x, y, z) => {
    const dx = Math.max(0, Math.abs(x + 0.5 - 14) - 8), dy = Math.max(0, Math.abs(y + 0.5 - 9) - 6), dz = Math.max(0, Math.abs(z + 0.5 - 7) - 2.5);
    return dx * dx + dy * dy + dz * dz <= 9;
  };
  m.fill((x, y, z) => (inBody(x, y, z) ? (y < 2 ? leaD : lea) : null));
  // flap over the top and down the front with a curved hem
  m.fill((x, y, z) => {
    if (!inBody(x, y, z) && !inBody(x, y - 1, z) && !inBody(x, y, z - 1)) return null;
    const hem = 9 + ((x + 0.5 - 14) / 9) ** 2 * 4;
    if (y >= 15 || (z >= 10 && y >= hem)) return Math.abs(y - hem) < 1 && z >= 10 ? stitch : flapC;
    return null;
  });
  m.box(12, 8, 12, 15, 11, 12, gold);
  m.box(13, 9, 12, 14, 10, 12, hole);
  m.tube([[5, 15, 7, 0.9], [6, 21, 7, 0.9], [14, 25, 7, 0.9], [22, 21, 7, 0.9], [23, 15, 7, 0.9]], strap);
  // a fish tail poking out
  m.box(19, 17, 8, 20, 19, 9, fish);
  m.box(20, 19, 8, 22, 20, 9, fishD);
  m.box(17, 19, 8, 18, 20, 9, fishD);
  return { m, yaw: 30, pitch: 22 };
}

function build() {
  const m = new VoxelModel(30, 9, 27);
  const bp = m.color('#2f6ad0', { jitter: 0.04 }), bpD = m.color('#2452a8'), grid = m.color('#4a86e2'), line = m.color('#eef8ff', { light: 0.5 });
  const bpL = m.color('#7ab0ff'), pencil = m.color('#f8c040', { jitter: 0.04 }), pencilD = m.color('#d08a2a'), eraser = m.color('#f39aa6');
  const metal = m.color('#c8ccd8', { spec: 1.5 }), wood = m.color('#f0d0a0'), lead = m.color('#3a3448');
  m.box(3, 1, 2, 26, 1, 20, (x, y, z) => ((x - 3) % 5 === 0 || (z - 2) % 5 === 0 ? grid : bp));
  // bold chalk house drawing (raised strokes so they catch the light)
  const stroke = (x, z) => { m.set(x, 2, z, line); };
  for (let x = 8; x <= 21; x++) { stroke(x, 10); stroke(x, 18); }
  for (let z = 10; z <= 18; z++) { stroke(8, z); stroke(21, z); }
  for (let k = 0; k <= 7; k++) { stroke(8 + k, 10 - Math.round(k * 0.86)); stroke(21 - k, 10 - Math.round(k * 0.86)); }
  for (let z = 14; z <= 18; z++) { stroke(13, z); stroke(16, z); }
  for (let x = 13; x <= 16; x++) stroke(x, 14);
  for (const [x, z] of [[10, 12], [11, 12], [10, 13], [11, 13], [18, 12], [19, 12], [18, 13], [19, 13]]) stroke(x, z);
  // the roll along the front edge
  m.cylinder(3, 23, 1, 28, 3, (x, y, z) => (x <= 1 || x >= 28 ? (Math.hypot(y + 0.5 - 3, z + 0.5 - 23) < 1.5 ? bpD : bpL) : y > 3 ? bpL : y > 1 ? bp : bpD), 'x');
  // pencil resting on the sheet
  const P0 = [17, 3, 3], P1 = [26, 3, 11];
  m.line(...P0, ...P1, (x, y, z) => {
    const t = Math.hypot(x - P0[0], z - P0[2]) / Math.hypot(P1[0] - P0[0], P1[2] - P0[2]);
    return t < 0.14 ? eraser : t < 0.24 ? metal : y >= 3 ? pencil : pencilD;
  }, 0.9);
  m.line(26, 3, 11, 27.5, 3, 13, wood, 0.6);
  m.set(28, 3, 14, lead);
  return { m, yaw: 22, pitch: 44 };
}

function research() {
  const m = new VoxelModel(24, 31, 22);
  const glass = m.color('#c8f2ff', { smooth: 0.9, spec: 2.2, specPow: 14, light: 0.3 });
  const liquid = m.color('#5aff98', { emissive: 0.75, smooth: 0.7 }), liquidL = m.color('#c8ffd8', { emissive: 0.9 });
  const bub = m.color('#e6fff0', { emissive: 0.5, spec: 2 }), cork = m.color('#b58358', { jitter: 0.12 });
  const stand = m.color('#6a7488', { spec: 1.2 });
  m.cylinder(12, 11, 0, 1, 10.5, stand);
  m.cone(12, 11, 2, 14, 10.5, 3.4, glass);
  m.cylinder(12, 11, 15, 20, 2.8, glass);
  m.cylinder(12, 11, 21, 21, 3.5, glass);
  m.recolor((x, y, z, v) => (v === glass && y >= 2 && y <= 8 ? (y === 8 ? liquidL : liquid) : null));
  m.recolor((x, y, z, v) => (v === glass && y < 9 && (x + y + z) % 5 === 0 && y > 3 ? liquidL : null));
  m.sphere(11, 24, 11, 1.5, bub);
  m.sphere(14, 27, 12, 1.1, bub);
  m.sphere(10, 29, 10, 0.9, bub);
  m.box(11, 22, 18, 13, 23, 19, cork);
  return { m, yaw: 30, pitch: 22 };
}

function wardrobe() {
  const m = new VoxelModel(30, 33, 12);
  const brass = m.color('#e8b84a', { spec: 1.8 }), wood = m.color('#b07040', { jitter: 0.1 });
  const shirt = m.color('#3e6cb4', { jitter: 0.06, smooth: 0.3 }), stripe = m.color('#f4f0e8'), collar = m.color('#ffffff', { light: 0.2 }), tie = m.color('#e0463e');
  const green = m.color('#5ad06a', { smooth: 0.6, jitter: 0.06 }), greenD = m.color('#2e9a50'), eyeW = m.color('#ffffff'), eyeK = m.color('#1a1226'), fin = m.color('#8ae878');
  m.tube([[14.5, 23, 6, 0.6], [14.5, 27, 6, 0.6], [16, 30, 6, 0.6], [18, 29.5, 6, 0.6], [18.5, 28, 6, 0.6]], brass);
  m.tube([[3, 20, 6, 0.9], [9, 22.5, 6, 0.9], [14.5, 23.5, 6, 0.9], [20, 22.5, 6, 0.9], [26, 20, 6, 0.9]], wood);
  // striped sailor shirt
  m.fill((x, y, z) => {
    if (z < 4 || z > 8) return null;
    const torso = x >= 8 && x <= 21 && y >= 2 && y <= 20;
    const sl = y >= 13 && y <= 20 && ((x >= 3 && x < 8 && y - 13 >= (8 - x) * 0.9) || (x > 21 && x <= 26 && y - 13 >= (x - 21) * 0.9));
    if (!torso && !sl) return null;
    return y % 4 === 1 ? stripe : shirt;
  });
  for (let k = 0; k < 4; k++) { m.set(13 + k, 20 - k, 9, collar); m.set(16 - k, 20 - k, 9, collar); }
  m.box(14, 12, 9, 15, 16, 9, tie);
  // green fish-head hat hooked on the hanger end
  m.ellipsoid(24.5, 25.5, 6, 4.6, 3.6, 3.6, (x, y) => (y < 24 ? greenD : green));
  m.box(19, 24, 5, 20, 28, 7, fin);
  m.box(18, 23, 5, 18, 29, 7, fin);
  m.set(26, 26, 9, eyeW); m.set(27, 26, 9, eyeW); m.set(26, 27, 9, eyeW); m.set(27, 27, 9, eyeK);
  m.box(27, 24, 8, 28, 24, 9, eyeK);
  m.box(23, 29, 5, 25, 30, 7, fin);
  return { m, yaw: 30, pitch: 20 };
}

function store() {
  const m = new VoxelModel(26, 29, 14);
  const aqua = m.color('#3ad0e0', { jitter: 0.04, smooth: 0.2 }), aquaL = m.color('#8ef0f6'), deep = m.color('#2a8ac8', { jitter: 0.04 }), deepD = m.color('#1e5ea8');
  const crest = m.color('#e6fbff', { light: 0.3 }), navy = m.color('#1e3a7a', { jitter: 0.06 }), white = m.color('#ffffff', { light: 0.3 });
  m.box(3, 0, 3, 22, 18, 10, (x, y, z) => {
    const c = 6 + Math.sin(x * 0.75 + z * 0.4) * 1.3;
    if (y < c - 0.6) return y < 2 ? deepD : deep;
    if (y < c + 0.6) return crest;
    return aqua;
  });
  m.box(3, 19, 3, 22, 19, 10, aquaL);
  for (const z of [9, 4]) m.tube([[7, 19, z, 0.75], [7.5, 24, z, 0.75], [12.5, 27, z, 0.75], [17.5, 24, z, 0.75], [18, 19, z, 0.75]], navy);
  for (let y = 9; y <= 15; y++) { m.set(12, y, 11, white); m.set(13, y, 11, white); }
  for (let k = 0; k < 4; k++) for (let x = 12 - 3 + k; x <= 13 + 3 - k; x++) m.set(x, 9 - k, 11, white);
  return { m, yaw: 30, pitch: 22 };
}

function boatyard() {
  const m = new VoxelModel(34, 28, 14);
  const red = m.color('#d8483a', { jitter: 0.06 }), white = m.color('#f4f0e8', { jitter: 0.03 }), deck = m.color('#c08a52', { jitter: 0.1 });
  const cabin = m.color('#fff8ee', { light: 0.1 }), roof = m.color('#2a6ab8', { spec: 1 }), win = m.color('#8ae0ff', { emissive: 0.4, spec: 2 });
  const mast = m.color('#8a5a34'), flag = m.color('#ffd23a', { light: 0.2 }), water = m.color('#3ab4e6', { light: 0.2, smooth: 0.5 }), foam = m.color('#e6fbff');
  m.ellipsoid(17, 1, 7, 16, 1.6, 6.5, (x, y, z) => ((x + z) % 5 === 0 ? foam : water));
  m.fill((x, y, z) => {
    if (y < 1 || y > 8) return null;
    const bow = 30 - Math.max(0, 8 - y) * 0.9;
    const stern = 3 + Math.max(0, 4 - y) * 0.6;
    if (x < stern || x > bow) return null;
    const half = 3 + Math.min(1, (y - 1) / 4) * 2.5 - Math.max(0, (x - 24) / 6) * 2.5;
    if (Math.abs(z + 0.5 - 7) > Math.max(1, half)) return null;
    return y === 8 ? deck : y >= 6 ? white : red;
  });
  m.box(8, 9, 4, 16, 15, 10, cabin);
  m.box(7, 16, 3, 17, 17, 11, roof);
  m.box(10, 11, 11, 11, 13, 11, win);
  m.box(13, 11, 11, 14, 13, 11, win);
  m.cylinder(22, 7, 9, 25, 0.6, mast);
  m.box(23, 20, 7, 27, 23, 7, flag);
  return { m, yaw: 30, pitch: 22 };
}

function settings() {
  const m = new VoxelModel(28, 28, 9);
  const metal = m.color('#9aaac0', { spec: 1.6, jitter: 0.04 }), metalD = m.color('#5c6a86'), hub = m.color('#c8d4e2', { spec: 2 });
  const brass = m.color('#e0a844', { spec: 1.6, jitter: 0.05 });
  const gear = (cx, cy, ro, ri, n, hole, z0, z1, c, rot = 0) => m.fill((x, y, z) => {
    if (z < z0 || z > z1) return null;
    const dx = x + 0.5 - cx, dy = y + 0.5 - cy, d = Math.hypot(dx, dy);
    if (d < hole || d > ro) return null;
    const a = Math.atan2(dy, dx) + rot;
    if (d > ri && Math.cos(n * a) < -0.1 + 0.5 * clamp((d - ri) / (ro - ri), 0, 1)) return null;
    return c;
  });
  gear(21, 8, 6.5, 4.8, 7, 1.6, 1, 4, brass, 0.3);
  gear(12, 15, 11.5, 8.6, 8, 3.2, 3, 7, metal, 0.2);
  m.recolor((x, y, z, v) => {
    if (v !== metal) return null;
    const d = Math.hypot(x + 0.5 - 12, y + 0.5 - 15);
    if (z === 7 && d < 5.6) return hub;
    if (z === 7 && Math.abs(d - 7) < 0.6) return metalD;
    return null;
  });
  return { m, yaw: 28, pitch: 22 };
}

const MODELS = { aquarium, journal, skills, shop, map, inventory, build, research, wardrobe, store, boatyard, settings };

// ---------------------------------------------------------------- rendering & variants

function fitRender(def, target) {
  const base = { yaw: def.yaw, pitch: def.pitch, outline: true };
  const probe = renderVoxels(def.m, { ...base, scale: 1 });
  const s = clamp(Math.min((target - 2) / Math.max(1, probe.w - 2), (target - 2) / Math.max(1, probe.h - 2)), 0.5, 4);
  return renderVoxels(def.m, { ...base, scale: Math.floor(s * 20) / 20 });
}

// Copy into a padded canvas; optional brighten + halo ring (hover / active looks).
function variant(src, kind) {
  const W = src.width + PAD * 2, H = src.height + PAD * 2;
  const c = makeCanvas(W, H);
  const g = ctxOf(c);
  g.drawImage(src, PAD, PAD);
  if (kind === 'normal') return c;
  const img = g.getImageData(0, 0, W, H);
  const d = new Uint32Array(img.data.buffer);
  const solid = new Uint8Array(W * H);
  for (let i = 0; i < d.length; i++) solid[i] = d[i] >>> 24 > 100 ? 1 : 0;
  const tint = kind === 'hover' ? '#fff6dc' : '#dcfbff';
  for (let i = 0; i < d.length; i++) {
    if (!solid[i]) continue;
    const [r, gg, b, a] = unpack(d[i]);
    if (r + gg + b < 150) continue;
    d[i] = pack(mix(rgbToHex(r, gg, b), tint, kind === 'hover' ? 0.16 : 0.1), a);
  }
  const ring1 = pack(kind === 'hover' ? '#fff3b0' : '#8ef0ff', 230), ring2 = pack(kind === 'hover' ? '#ffd86a' : '#3ac8e8', 110);
  const near = (x, y, r) => {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.abs(dx) + Math.abs(dy) > r) continue;
      const xx = x + dx, yy = y + dy;
      if (xx >= 0 && yy >= 0 && xx < W && yy < H && solid[yy * W + xx]) return true;
    }
    return false;
  };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (solid[i]) continue;
    if (near(x, y, 1)) d[i] = ring1;
    else if (near(x, y, 2)) d[i] = ring2;
  }
  g.putImageData(img, 0, 0);
  return c;
}

const cache = new Map();

function fallbackDef() {
  const m = new VoxelModel(8, 8, 8);
  m.box(0, 0, 0, 7, 7, 7, m.color('#8a9ab0'));
  return { m, yaw: 30, pitch: 25 };
}

export function getBigIcon(id, opts = {}) {
  const state = opts.state === 'hover' || opts.state === 'active' ? opts.state : 'normal';
  const small = !!opts.small;
  const key = id + '|' + state + '|' + small;
  let e = cache.get(key);
  if (e) return e;
  const baseKey = id + '|base|' + small;
  let base = cache.get(baseKey);
  if (!base) {
    let r;
    try { r = fitRender((MODELS[id] || fallbackDef)(), small ? SMALL : BIG); } catch (err) { console.error(err); r = fitRender(fallbackDef(), small ? SMALL : BIG); }
    base = { canvas: r.canvas };
    cache.set(baseKey, base);
  }
  const canvas = variant(base.canvas, state);
  // bottom-centre anchor: lowest opaque row of the silhouette
  const g = ctxOf(canvas);
  const data = g.getImageData(0, 0, canvas.width, canvas.height).data;
  let by = canvas.height - PAD;
  outer: for (let y = canvas.height - 1; y >= 0; y--) for (let x = 0; x < canvas.width; x++) if (data[(y * canvas.width + x) * 4 + 3] > 100) { by = y + 1; break outer; }
  e = { canvas, cx: Math.round(canvas.width / 2), by };
  cache.set(key, e);
  return e;
}

export function drawBadge(ctx, x, y, badge, t = 0) {
  if (badge === null || badge === undefined || badge === 0 || badge === false) return;
  const txt = badge === '!' ? '!' : badge > 99 ? '99+' : String(badge);
  const tw = measureText(txt, 'small');
  const w = Math.max(9, tw + 6), h = 9;
  const bx = Math.round(x - w), by = Math.round(y + (Math.sin(t * 5) > 0.7 ? -1 : 0));
  ctx.fillStyle = '#2a0e16';
  ctx.fillRect(bx + 1, by, w - 2, h);
  ctx.fillRect(bx, by + 1, w, h - 2);
  ctx.fillStyle = badge === '!' ? '#ffb02e' : '#e8403a';
  ctx.fillRect(bx + 1, by + 1, w - 2, h - 2);
  ctx.fillStyle = badge === '!' ? '#ffe08a' : '#ff8a76';
  ctx.fillRect(bx + 2, by + 1, w - 4, 1);
  ctx.fillStyle = badge === '!' ? '#c8701a' : '#a82838';
  ctx.fillRect(bx + 2, by + h - 2, w - 4, 1);
  drawText(ctx, txt, bx + Math.round((w - tw) / 2), by + 2, { font: 'small', color: '#ffffff', shadow: badge === '!' ? '#8a4a10' : '#6a1420' });
}

export function drawBigIcon(ctx, id, x, y, opts = {}) {
  const ic = getBigIcon(id, opts);
  const sq = clamp(opts.squash || 0, -1, 1);
  if (sq === 0) {
    ctx.drawImage(ic.canvas, Math.round(x - ic.cx), Math.round(y - ic.by));
  } else {
    const sx = 1 - sq * 0.12, sy = 1 + sq * 0.14;
    const w = Math.round(ic.canvas.width * sx), h = Math.round(ic.canvas.height * sy);
    ctx.drawImage(ic.canvas, Math.round(x - ic.cx * sx), Math.round(y - ic.by * sy), w, h);
  }
  if (opts.badge !== undefined && opts.badge !== null) {
    const right = Math.round(x - ic.cx + ic.canvas.width - PAD + 2);
    drawBadge(ctx, right, Math.round(y - ic.by + PAD - 2), opts.badge, opts.t || 0);
  }
  return ic;
}
