// Big glossy icons for the game menu / HUD hotbar. [icons15] Every icon is DETAILED VOXEL PIXEL ART in the bait-art
// style: hand-built VoxelModels (src/gfx/iconvox.js) or low-poly meshes (src/gfx/iconmeshes.js, icons3d.js) voxelised
// at ~1 voxel per 2 device px by src/gfx/voxicon.js and rendered with voxel.js renderVoxels (hue-shifted ramps, glossy
// normals, AO, dark outline, soft shadow), cached per (size, angle). Hover animations spin ('full', 12 angles) or wobble
// ('wobble', 5 angles) through baked frames. The phase 3 voxel models below are the last fallback (same pipeline).
//
//   BIG_ICON_IDS, MENU_ICON_IDS
//   getBigIcon(id, {state = 'normal', small = false, size}) -> {canvas, cx, by}  (cx, by = bottom-centre anchor)
//     size: 'big' (44, default) | 'menu' (32, fits a 44 px bubble) | 'small' (24) | a number (target px)
//   iconFrame(id, px, turn = 0) -> {canvas, ox, oy} | null   the 3D icon turned by `turn` (0..1 = one full spin for
//     'full' models, -1..1 = the wobble range for 'wobble' ones), centred at (ox, oy). Same centre for every turn.
//   iconSpinMode(id) -> 'full' | 'wobble' | null
//   rodIcon(rod, px) / gemIcon(color, px) -> canvas | null      3D rod (gear pod, Lab) and rarity gem sprites
//   modelFrame(key, make, px, turn, force) / voxelModelFrame(key, make, px, turn, force) -> {canvas, ox, oy} | null
//   drawBigIcon(ctx, id, x, y, {state, small, size, badge, t, squash}) draws with the bottom-centre at (x, y);
//     badge: number | '!' | null (glossy pill, top-right), squash: -1..1 (press squash / hop stretch)
//   drawBadge(ctx, x, y, badge, t) (right edge at x, top at y)

import { HI, withHi, fitHi } from './hires.js'; // [phase9:ui]
import { makeCanvas, ctxOf } from '../core/canvas.js';
import { VoxelModel, renderVoxels } from './voxel.js';
import { unpack, pack, mix, rgbToHex } from '../core/color.js';
import { hash2, clamp } from '../core/math.js';
import { drawAeroBadge, setCoinRenderer, setDecorRenderer } from '../ui/aero.js';
import { ICON_MODELS, ROD_MODEL, GEM_MODEL, DECOR_MODELS, CUT_GEM_MODEL, ORB_MODEL } from './iconmeshes.js';
import { itemPixel, itemPixelScaled } from '../build/itempix.js'; // [phase8:ui]
import { voxelizeLayers, modelLayers, layersExtent, renderLayers, iconRes } from './voxicon.js'; // [icons15] detailed voxel icons
import { ICON_VOX, ROD_VOX, GEM_VOX } from './iconvox.js'; // [icons15] hand-built detailed models

export const MENU_ICON_IDS = ['lab', 'aquarium', 'journal', 'inventory', 'wardrobe', 'map', 'bait', 'appsea', 'multiplayer', 'settings', 'quests', 'shop', 'coin'];
export const BIG_ICON_IDS = [...MENU_ICON_IDS, 'skills', 'build', 'research', 'store', 'boatyard', 'mycomputer', 'recycle'];

const BIG = 44, SMALL = 24, MENU = 32, PAD = 3;
const SIZES = { big: BIG, small: SMALL, menu: MENU };

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


// ---------------------------------------------------------------- Aero menu models (phase 3)

// Goldfish bowl: a glossy water sphere with an orange goldfish, pebbles, a weed and a glass rim.
function aeroAquarium() {
  const m = new VoxelModel(30, 28, 30);
  const water = m.color('#38b6f2', { smooth: 0.85, spec: 1.6, specPow: 18, jitter: 0.02 }), waterD = m.color('#1f86d6', { smooth: 0.85, spec: 1.2 });
  const glass = m.color('#e4fbff', { smooth: 0.9, spec: 2.2, light: 0.3 }), surf = m.color('#b8f4ff', { light: 0.4, spec: 1.5 });
  const fish = m.color('#ff8a1e', { spec: 1.4, smooth: 0.4 }), fishL = m.color('#ffd060', { spec: 1.4 }), fin = m.color('#ff5a2a');
  const eyeW = m.color('#ffffff', { light: 0.4 }), eyeK = m.color('#10182a'), peb = [m.color('#ffd08a'), m.color('#ff9ab8'), m.color('#9af08a'), m.color('#fff4c8')];
  const weed = m.color('#3ed05a', { jitter: 0.08 }), weedD = m.color('#22a040');
  const cx = 15, cy = 13, cz = 15, R = 13;
  m.fill((x, y, z) => {
    const d = Math.hypot(x + 0.5 - cx, (y + 0.5 - cy) * 1.05, z + 0.5 - cz);
    if (d > R || y > 23) return null;
    if (y <= 17) return y < 4 ? peb[(x * 3 + z * 7) % 4] : y < 8 ? waterD : water;
    return d > R - 1.2 ? glass : null;
  });
  // water surface + glass rim at the opening
  for (let x = 0; x < 30; x++) for (let z = 0; z < 30; z++) {
    const d = Math.hypot(x + 0.5 - cx, z + 0.5 - cz);
    if (d < 11.5 && m.get(x, 17, z)) m.set(x, 17, z, surf);
    if (d > 6.2 && d < 8.6) { m.set(x, 23, z, glass); m.set(x, 24, z, glass); }
  }
  // goldfish on the front of the water
  const fx = 14, fy = 11, fz = 27;
  for (let x = -4; x <= 4; x++) for (let y = -3; y <= 3; y++) if ((x / 4.5) ** 2 + (y / 3.1) ** 2 <= 1) for (let z = -1; z <= 0; z++) m.set(fx + x, fy + y, fz + z, y > 0 ? fishL : fish);
  for (const [x, y] of [[-5, 0], [-6, 1], [-6, -1], [-7, 2], [-7, -2], [-7, 0]]) m.set(fx + x, fy + y, fz, fin);
  m.set(fx + 0, fy + 4, fz, fin); m.set(fx - 1, fy + 4, fz, fin);
  m.set(fx + 2, fy + 1, fz + 1, eyeW); m.set(fx + 3, fy + 1, fz + 1, eyeK);
  // weed
  for (let y = 4; y < 15; y++) { m.set(6 + ((y >> 2) & 1), y, 24, y % 3 ? weed : weedD); m.set(23 - ((y >> 2) & 1), y - 1, 25, y % 3 ? weedD : weed); }
  return { m, yaw: 24, pitch: 18 };
}

// FishDex: a glossy aqua handheld with a screen showing a fish.
function aeroFishDex() {
  const m = new VoxelModel(26, 32, 8);
  const shell = m.color('#2fb4f0', { smooth: 0.6, spec: 1.8, specPow: 16, jitter: 0.02 }), shellD = m.color('#1a86d0', { smooth: 0.5, spec: 1.2 });
  const bezel = m.color('#0e3a66', { spec: 0.8 }), screen = m.color('#dcfbff', { emissive: 0.35, light: 0.2 }), sea = m.color('#5cd0ff', { emissive: 0.35 });
  const fish = m.color('#ff8a2a', { emissive: 0.3 }), fishL = m.color('#ffd06a', { emissive: 0.3 }), eye = m.color('#10182a');
  const btnG = m.color('#6ee04a', { spec: 2, smooth: 0.8 }), btnW = m.color('#ffffff', { spec: 2, light: 0.2 }), led = m.color('#7dffc8', { emissive: 0.9, spec: 2 });
  const inShell = (x, y) => {
    const rx = Math.max(0, Math.abs(x + 0.5 - 13) - 8), ry = Math.max(0, Math.abs(y + 0.5 - 16) - 11);
    return rx * rx + ry * ry <= 16;
  };
  m.fill((x, y, z) => (inShell(x, y) && z >= 1 && z <= 6 ? (z <= 2 ? shellD : shell) : null));
  // screen
  for (let x = 4; x <= 21; x++) for (let y = 12; y <= 27; y++) m.set(x, y, 7, x === 4 || x === 21 || y === 12 || y === 27 ? bezel : y < 18 ? sea : screen);
  const cx = 13, cy = 20;
  for (let x = -4; x <= 4; x++) for (let y = -2; y <= 2; y++) if ((x / 4.3) ** 2 + (y / 2.6) ** 2 <= 1) m.set(cx + x, cy + y, 7, y < 0 ? fishL : fish);
  for (const [x, y] of [[-5, 0], [-6, 1], [-6, -1]]) m.set(cx + x, cy + y, 7, fish);
  m.set(cx + 2, cy + 1, 7, eye);
  // buttons + status light
  m.sphere(8.5, 7.5, 7, 2.2, btnG);
  m.box(14, 6, 7, 18, 7, 7, btnW);
  m.box(14, 9, 7, 18, 9, 7, btnW);
  m.sphere(6, 29.5, 6.5, 1.4, led);
  return { m, yaw: 22, pitch: 16 };
}

// Satchel: a glossy grass-green bag with a white strap, chrome buckle and a fish tail peeking out.
function aeroSatchel() {
  const m = new VoxelModel(28, 28, 14);
  const lea = m.color('#5cc83a', { jitter: 0.04, smooth: 0.6, spec: 1.4 }), leaD = m.color('#3a9a24', { smooth: 0.5 }), flapC = m.color('#86e04a', { smooth: 0.6, spec: 1.6, specPow: 16 });
  const stitch = m.color('#ffffff'), chrome = m.color('#e8f4fa', { spec: 2.2, smooth: 0.6 }), hole = m.color('#1a5a2a');
  const strap = m.color('#f4fbff', { smooth: 0.6, spec: 1.2 }), fish = m.color('#ff8a2a'), fishD = m.color('#e05a1a');
  const inBody = (x, y, z) => {
    const dx = Math.max(0, Math.abs(x + 0.5 - 14) - 8), dy = Math.max(0, Math.abs(y + 0.5 - 9) - 6), dz = Math.max(0, Math.abs(z + 0.5 - 7) - 2.5);
    return dx * dx + dy * dy + dz * dz <= 9;
  };
  m.fill((x, y, z) => (inBody(x, y, z) ? (y < 2 ? leaD : lea) : null));
  m.fill((x, y, z) => {
    if (!inBody(x, y, z) && !inBody(x, y - 1, z) && !inBody(x, y, z - 1)) return null;
    const hem = 9 + ((x + 0.5 - 14) / 9) ** 2 * 4;
    if (y >= 15 || (z >= 10 && y >= hem)) return Math.abs(y - hem) < 1 && z >= 10 ? stitch : flapC;
    return null;
  });
  m.box(12, 8, 12, 15, 11, 12, chrome);
  m.box(13, 9, 12, 14, 10, 12, hole);
  m.tube([[5, 15, 7, 0.9], [6, 21, 7, 0.9], [14, 25, 7, 0.9], [22, 21, 7, 0.9], [23, 15, 7, 0.9]], strap);
  m.box(19, 17, 8, 20, 19, 9, fish);
  m.box(20, 19, 8, 22, 20, 9, fishD);
  m.box(17, 19, 8, 18, 20, 9, fishD);
  return { m, yaw: 28, pitch: 20 };
}

// Wardrobe: an aqua-and-white sailor shirt on a chrome hanger.
function aeroWardrobe() {
  const m = new VoxelModel(30, 30, 10);
  const chrome = m.color('#e4f2fa', { spec: 2.2, smooth: 0.6 });
  const shirt = m.color('#2fb0f0', { jitter: 0.03, smooth: 0.4, spec: 1.2 }), stripe = m.color('#ffffff', { light: 0.1 }), collar = m.color('#0e4a8a');
  const star = m.color('#ffe24a', { spec: 1.6 }), tie = m.color('#ff5a5a', { spec: 1.2 });
  m.tube([[14.5, 21, 5, 0.6], [14.5, 25, 5, 0.6], [16, 28, 5, 0.6], [18, 27.5, 5, 0.6], [18.5, 26, 5, 0.6]], chrome);
  m.tube([[3, 18, 5, 0.9], [9, 20.5, 5, 0.9], [14.5, 21.5, 5, 0.9], [20, 20.5, 5, 0.9], [26, 18, 5, 0.9]], chrome);
  m.fill((x, y, z) => {
    if (z < 3 || z > 7) return null;
    const torso = x >= 8 && x <= 21 && y >= 1 && y <= 19;
    const sl = y >= 12 && y <= 19 && ((x >= 3 && x < 8 && y - 12 >= (8 - x) * 0.9) || (x > 21 && x <= 26 && y - 12 >= (x - 21) * 0.9));
    if (!torso && !sl) return null;
    return y % 4 === 1 && y < 11 ? stripe : shirt;
  });
  for (let k = 0; k < 5; k++) { m.set(12 + k, 19 - k, 8, collar); m.set(17 - k, 19 - k, 8, collar); }
  m.box(14, 11, 8, 15, 13, 8, tie);
  m.set(18, 8, 8, star); m.set(17, 8, 8, star); m.set(19, 8, 8, star); m.set(18, 9, 8, star); m.set(18, 7, 8, star);
  return { m, yaw: 26, pitch: 18 };
}

// Map: a glossy globe (blue ocean, green continents) on a chrome stand.
function aeroGlobe() {
  const m = new VoxelModel(28, 31, 28);
  const sea = m.color('#2a90e8', { smooth: 0.9, spec: 1.8, specPow: 20 }), seaL = m.color('#5cc4ff', { smooth: 0.9, spec: 1.6 });
  const land = m.color('#5cc83a', { smooth: 0.8, spec: 1.2 }), landL = m.color('#a8ec6a', { smooth: 0.8 }), ice = m.color('#ffffff', { smooth: 0.8, light: 0.2 });
  const chrome = m.color('#dcecf6', { spec: 2.2, smooth: 0.6 }), chromeD = m.color('#8ab0c8', { spec: 1.6 });
  const cx = 14, cy = 17, cz = 14, R = 11;
  m.fill((x, y, z) => {
    const dx = x + 0.5 - cx, dy = y + 0.5 - cy, dz = z + 0.5 - cz;
    const d = Math.hypot(dx, dy, dz);
    if (d > R) return null;
    const lat = dy / R, lon = Math.atan2(dz, dx);
    if (Math.abs(lat) > 0.86) return ice;
    const n = Math.sin(lon * 2 + lat * 3.1) + Math.sin(lon * 3.7 - lat * 1.3 + 1.2) * 0.8 + Math.sin(lat * 5.3 + 0.4) * 0.5;
    if (n > 0.55) return n > 1.45 ? landL : land;
    return lat > 0.2 && n < -0.6 ? seaL : sea;
  });
  // meridian half-ring behind the globe + stand
  for (let a = -Math.PI / 2 - 0.3; a <= Math.PI / 2 + 0.3; a += 0.02) {
    const rr = R + 1.6;
    const x = cx - Math.cos(a) * rr * 0.72, y = cy + Math.sin(a) * rr, z = cz - Math.cos(a) * rr * 0.69;
    if (y < 4) continue;
    m.set(Math.floor(x), Math.floor(y), Math.floor(z), chrome);
    m.set(Math.floor(x), Math.floor(y), Math.floor(z) + 1, chrome);
  }
  m.cylinder(14, 14, 2, 5, 1.2, chromeD);
  m.cylinder(14, 14, 0, 1, 5, chrome);
  return { m, yaw: 40, pitch: 14 };
}

// Bait: a glossy fishing lure (crankbait) with a clear lip, a voxel eye and chrome hooks.
function aeroLure() {
  const m = new VoxelModel(34, 24, 12);
  const top = m.color('#ff6a2a', { smooth: 0.8, spec: 2, specPow: 18 }), mid = m.color('#ffc23a', { smooth: 0.8, spec: 1.8 }), belly = m.color('#fff6d8', { smooth: 0.8, spec: 1.4 });
  const stripe = m.color('#e83a3a', { smooth: 0.8, spec: 1.6 }), lip = m.color('#c8f6ff', { smooth: 0.9, spec: 2.4, light: 0.3 });
  const eyeW = m.color('#ffffff', { spec: 2, smooth: 0.8 }), eyeK = m.color('#0a1424', { spec: 2.4 }), chrome = m.color('#e4f2fa', { spec: 2.4, smooth: 0.5 });
  const cy = 14;
  m.ellipsoid(16, cy, 6, 12, 6.2, 4.6, (x, y) => (y > cy + 2.5 ? top : y > cy - 1.5 ? (((x >> 1) & 3) === 0 && x < 22 ? stripe : mid) : belly));
  // tail taper
  m.ellipsoid(4.5, cy + 0.5, 6, 3.5, 3.5, 2.6, top);
  m.box(1, cy - 2, 5, 2, cy + 3, 7, stripe);
  // lip
  m.fill((x, y, z) => (x >= 27 && x <= 31 && y >= cy - 5 + (31 - x) * 0.4 && y <= cy - 1 && z >= 3 && z <= 9 ? lip : null));
  // eye (front face)
  m.sphere(23.5, cy + 1.5, 10.2, 2.1, eyeW);
  m.box(24, cy + 1, 11, 25, cy + 2, 11, eyeK);
  // split ring + treble hooks
  m.tube([[31, cy - 3, 6, 0.6], [32.5, cy - 4, 6, 0.6], [32, cy - 6, 6, 0.6]], chrome);
  m.line(15, cy - 6, 6, 15, cy - 9, 6, chrome);
  m.tube([[15, cy - 9, 6, 0.5], [13.5, cy - 11.5, 6, 0.5], [12, cy - 10, 6, 0.5]], chrome);
  m.tube([[15, cy - 9, 6, 0.5], [16.5, cy - 11.5, 6, 0.5], [18, cy - 10, 6, 0.5]], chrome);
  return { m, yaw: 22, pitch: 16 };
}

// AppSea: an aqua shopping bag with white handles and a download arrow.
function aeroAppSea() {
  const m = new VoxelModel(26, 30, 14);
  const aqua = m.color('#2fc4f0', { smooth: 0.6, spec: 1.8, specPow: 16 }), aquaD = m.color('#1a8ad8', { smooth: 0.5, spec: 1.2 }), wave = m.color('#0e66c0', { smooth: 0.4 });
  const crest = m.color('#e4fbff', { light: 0.3 }), white = m.color('#ffffff', { light: 0.3, spec: 1.6 }), handle = m.color('#f4fbff', { smooth: 0.6, spec: 1.6 });
  m.box(3, 0, 3, 22, 19, 10, (x, y, z) => {
    const c = 4.5 + Math.sin(x * 0.75 + z * 0.4) * 1.3;
    if (y < c - 0.6) return wave;
    if (y < c + 0.6) return crest;
    return z <= 4 ? aquaD : aqua;
  });
  for (const z of [9, 4]) m.tube([[7, 19, z, 0.8], [7.5, 24, z, 0.8], [12.5, 27, z, 0.8], [17.5, 24, z, 0.8], [18, 19, z, 0.8]], handle);
  for (let y = 9; y <= 15; y++) { m.set(12, y, 11, white); m.set(13, y, 11, white); }
  for (let k = 0; k < 4; k++) for (let x = 12 - 3 + k; x <= 13 + 3 - k; x++) m.set(x, 9 - k, 11, white);
  return { m, yaw: 28, pitch: 20 };
}

// Multiplayer: two bubble people (one aqua, one green) side by side, waving.
function aeroFriends() {
  const m = new VoxelModel(32, 28, 16);
  const aqua = m.color('#4ac8ff', { smooth: 0.9, spec: 2, specPow: 16, light: 0.1 }), aquaD = m.color('#1a8ad8', { smooth: 0.8, spec: 1.2 });
  const green = m.color('#7ee04a', { smooth: 0.9, spec: 2, specPow: 16, light: 0.1 }), greenD = m.color('#3aa224', { smooth: 0.8, spec: 1.2 });
  const eyeW = m.color('#ffffff', { spec: 2, light: 0.3 }), eyeK = m.color('#0a1424', { spec: 2.4 }), cheek = m.color('#ff9ab8');
  const front = (x, y) => { x = Math.floor(x); y = Math.floor(y); for (let z = m.nz - 1; z >= 0; z--) if (m.get(x, y, z)) return z; return 0; };
  const person = (x, z, head, body, s) => {
    m.ellipsoid(x, 6, z, 5.5 * s, 6 * s, 4 * s, body);
    m.sphere(x, 15 * s + 1, z, 6.2 * s, head);
    const hy = 15 * s + 1;
    for (const ex of [-2.2, 1.8]) {
      const X = x + ex, Y = hy + 0.5;
      const fz = front(X, Y);
      m.set(X, Y, fz + 1, eyeW); m.set(X, Y - 1, fz + 1, eyeW); m.set(X + (ex < 0 ? 0 : 0), Y - 1, fz + 1, eyeK);
    }
    m.set(x - 3.6, hy - 2.5, front(x - 3.6, hy - 2.5) + 1, cheek); m.set(x + 3.2, hy - 2.5, front(x + 3.2, hy - 2.5) + 1, cheek);
  };
  person(11, 8, aqua, aquaD, 1);
  person(22, 6, green, greenD, 0.9);
  // waving arm
  m.tube([[26, 8, 6, 1.2], [28.5, 12, 6, 1.1], [29.5, 16, 6, 1.1]], green);
  return { m, yaw: 18, pitch: 14 };
}

// The Lab: an Erlenmeyer flask of glowing green liquid with rising bubbles on a chrome stand.
function aeroLab() {
  const m = new VoxelModel(30, 30, 30);
  const glass = m.color('#d8f8ff', { smooth: 0.9, spec: 2.4, specPow: 14, light: 0.3 });
  const liquid = m.color('#62f05a', { emissive: 0.7, smooth: 0.7 }), liquidL = m.color('#d4ffb0', { emissive: 0.9 });
  const bub = m.color('#f0fff0', { emissive: 0.5, spec: 2 }), cap = m.color('#2fb4f0', { spec: 1.8, smooth: 0.6 });
  m.cone(15, 15, 0, 13, 13.5, 4.2, glass);
  m.cylinder(15, 15, 14, 19, 3.6, glass);
  m.cylinder(15, 15, 20, 20, 4.4, glass);
  m.recolor((x, y, z, v) => (v === glass && y <= 8 ? (y === 8 ? liquidL : liquid) : null));
  m.recolor((x, y, z, v) => (v === liquid && (x * 3 + y + z * 5) % 7 === 0 && y > 2 ? liquidL : null));
  m.sphere(14, 23.5, 15, 1.7, bub);
  m.sphere(17.5, 26.5, 16, 1.3, bub);
  m.sphere(13, 29, 14, 1, bub);
  m.box(12, 21, 12, 18, 22, 18, cap);
  return { m, yaw: 30, pitch: 18 };
}

// Settings: a chrome gear with an aqua gear behind it.
function aeroSettings() {
  const m = new VoxelModel(28, 28, 9);
  const metal = m.color('#d4e6f2', { spec: 2.2, jitter: 0.02, smooth: 0.4 }), metalD = m.color('#7aa0bc'), hub = m.color('#2fb4f0', { spec: 2.2, smooth: 0.8 });
  const aqua = m.color('#4ad0ff', { spec: 1.8, jitter: 0.03 });
  const gear = (cx, cy, ro, ri, n, hole, z0, z1, c, rot = 0) => m.fill((x, y, z) => {
    if (z < z0 || z > z1) return null;
    const dx = x + 0.5 - cx, dy = y + 0.5 - cy, d = Math.hypot(dx, dy);
    if (d < hole || d > ro) return null;
    const a = Math.atan2(dy, dx) + rot;
    if (d > ri && Math.cos(n * a) < -0.1 + 0.5 * clamp((d - ri) / (ro - ri), 0, 1)) return null;
    return c;
  });
  gear(21, 8, 6.5, 4.8, 7, 1.6, 1, 4, aqua, 0.3);
  gear(12, 15, 11.5, 8.6, 8, 3.2, 3, 7, metal, 0.2);
  m.recolor((x, y, z, v) => {
    if (v !== metal) return null;
    const d = Math.hypot(x + 0.5 - 12, y + 0.5 - 15);
    if (z === 7 && d < 5.6) return hub;
    if (z === 7 && Math.abs(d - 7) < 0.6) return metalD;
    return null;
  });
  return { m, yaw: 26, pitch: 20 };
}

// My Computer: a glossy white flat screen showing the (OS)cean hills wallpaper, on a chrome stand.
function aeroComputer() {
  const m = new VoxelModel(30, 28, 10);
  const shell = m.color('#f6fcff', { smooth: 0.75, spec: 2, specPow: 16, light: 0.12 }), shellD = m.color('#b4d2e6', { smooth: 0.6, spec: 1.2 });
  const bezel = m.color('#123a62', { spec: 1.4 });
  const sky = m.color('#3aa8f0', { emissive: 0.45 }), skyL = m.color('#a8e4ff', { emissive: 0.5 }), cloud = m.color('#ffffff', { emissive: 0.6 });
  const hill = m.color('#4cbc34', { emissive: 0.4 }), hillL = m.color('#a4ec5a', { emissive: 0.45 });
  const chrome = m.color('#e0eef8', { spec: 2.4, smooth: 0.6 }), chromeD = m.color('#8ab0c8', { spec: 1.6 }), led = m.color('#7dff9a', { emissive: 1 });
  m.box(10, 0, 2, 19, 1, 8, chromeD);
  m.box(11, 1, 3, 18, 1, 7, chrome);
  m.box(13, 2, 4, 16, 6, 5, chrome);
  const inBody = (x, y) => {
    const rx = Math.max(0, Math.abs(x + 0.5 - 14.5) - 11.5), ry = Math.max(0, Math.abs(y + 0.5 - 16.5) - 8.5);
    return rx * rx + ry * ry <= 6.5;
  };
  m.fill((x, y, z) => (inBody(x, y) && z >= 3 && z <= 7 ? (z <= 4 ? shellD : shell) : null));
  for (let x = 4; x <= 25; x++) for (let y = 10; y <= 24; y++) {
    const edge = x === 4 || x === 25 || y === 10 || y === 24;
    const h1 = 14 + Math.sin((x - 4) * 0.28) * 2.2, h2 = 12.5 + Math.sin((x - 4) * 0.2 + 2.2) * 1.6;
    let c = y > 19 ? skyL : sky;
    if (y <= h1) c = y >= h1 - 1 ? hillL : hill;
    if (y <= h2) c = hill;
    if ((y === 21 && x >= 8 && x <= 12) || (y === 22 && x >= 9 && x <= 11) || (y === 19 && x >= 18 && x <= 21) || (y === 20 && x >= 19 && x <= 20)) c = cloud;
    m.set(x, y, 8, edge ? bezel : c);
  }
  m.set(14, 8, 8, led); m.set(15, 8, 8, led);
  return { m, yaw: 24, pitch: 14 };
}

// Recycle Bin: a clear aqua glass bin with a grass-green rim and crumpled paper peeking out.
function aeroRecycle() {
  const m = new VoxelModel(26, 30, 26);
  const glass = m.color('#bff0ff', { smooth: 0.9, spec: 2.4, specPow: 14, light: 0.25 }), glassD = m.color('#6cc8ee', { smooth: 0.9, spec: 1.6 });
  const rim = m.color('#5cc83a', { smooth: 0.7, spec: 1.8 }), rimL = m.color('#a8ec6a', { smooth: 0.7, spec: 1.6 });
  const paper = m.color('#ffffff', { light: 0.2, jitter: 0.05 }), paperD = m.color('#d8e8f2', { jitter: 0.05 }), arrow = m.color('#3aa82a', { spec: 1.2 });
  const cx = 13, cz = 13;
  m.fill((x, y, z) => {
    if (y > 21) return null;
    const r = 8.2 + y * 0.14, d = Math.hypot(x + 0.5 - cx, z + 0.5 - cz);
    if (d > r) return null;
    return (x + y) % 5 === 0 ? glassD : glass;
  });
  for (let x = 0; x < 26; x++) for (let z = 0; z < 26; z++) {
    const d = Math.hypot(x + 0.5 - cx, z + 0.5 - cz);
    if (d <= 11.6 && d > 9.6) { m.set(x, 22, z, rim); m.set(x, 23, z, d > 10.6 ? rim : rimL); }
  }
  m.sphere(10.5, 23.5, 12, 3.2, paper);
  m.sphere(15.5, 24.5, 14, 3, paperD);
  m.sphere(13, 26, 11, 2.6, paper);
  // recycle chevrons on the front
  const fz = (x, y) => { for (let z = 25; z >= 0; z--) if (m.get(x, y, z)) return z + 1; return 0; };
  for (const [x, y] of [[12, 15], [13, 15], [11, 14], [14, 14], [10, 13], [15, 13], [9, 11], [16, 11], [9, 10], [10, 10], [15, 10], [16, 10], [11, 9], [12, 9], [13, 9], [14, 9], [10, 12], [15, 12]]) m.set(x, y, fz(x, y), arrow);
  return { m, yaw: 22, pitch: 18 };
}

const MODELS = {
  lab: aeroLab, aquarium: aeroAquarium, journal: aeroFishDex, inventory: aeroSatchel, wardrobe: aeroWardrobe, map: aeroGlobe,
  bait: aeroLure, appsea: aeroAppSea, multiplayer: aeroFriends, settings: aeroSettings,
  skills, shop, build, research: aeroLab, store: aeroAppSea, boatyard,
  tank: aeroAquarium, fishdex: aeroFishDex, satchel: aeroSatchel, mycomputer: aeroComputer, recycle: aeroRecycle,
  quests: aeroFishDex, baitshop: aeroAppSea, // [phase6] voxel stand-ins when WebGL2 (the 3D icons) is unavailable
};

// ---------------------------------------------------------------- rendering & variants

function fitRender(def, target) {
  const base = { yaw: def.yaw, pitch: def.pitch, outline: true };
  const probe = renderVoxels(def.m, { ...base, scale: 1 });
  const s = clamp(Math.min((target - 2) / Math.max(1, probe.w - 2), (target - 2) / Math.max(1, probe.h - 2)), 0.5, 4);
  return renderVoxels(def.m, { ...base, scale: Math.floor(s * 20) / 20 });
}

// Copy into a padded canvas; optional brighten (hover / active looks; no halo ring).
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
  g.putImageData(img, 0, 0);
  return c;
}

const cache = new Map();

function fallbackDef() {
  const m = new VoxelModel(8, 8, 8);
  m.box(0, 0, 0, 7, 7, 7, m.color('#8a9ab0'));
  return { m, yaw: 30, pitch: 25 };
}

function voxelIcon(id, opts = {}) {
  const state = opts.state === 'hover' || opts.state === 'active' ? opts.state : 'normal';
  const small = typeof opts.size === 'number' ? opts.size : SIZES[opts.size] || (opts.small ? SMALL : BIG);
  const key = id + '|' + state + '|' + small;
  let e = cache.get(key);
  if (e) return e;
  const baseKey = id + '|base|' + small;
  let base = cache.get(baseKey);
  if (!base) {
    let r;
    try { r = fitRender((MODELS[id] || fallbackDef)(), small); } catch (err) { console.error(err); r = fitRender(fallbackDef(), small); }
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

// ---------------------------------------------------------------- low-poly 3D icons (phase 6)

// ---------------------------------------------------------------- [icons15] detailed voxel icons
// Every model (low-poly meshes from iconmeshes / icons3d, hand-built VoxelModels from src/gfx/iconvox.js, items, bait)
// is voxelised at ~1 voxel per 2 device px (src/gfx/voxicon.js) and rendered by renderVoxels in the bait-art style.
// Defs: {mesh, over?, glass?, glassAlpha?, yaw, pitch (radians), spin, spinAxis?} or {vm: VoxelModel, yaw, pitch, spin}.

const lpDefs = new Map();
function lpReady() { return true; } // CPU voxel renderer: always available

// Build (once) a model: recentre its vertices on the origin so spins turn about the object's own axis.
function prepModel(key, make) {
  let d = lpDefs.get(key);
  if (d !== undefined) return d;
  try {
    d = make();
    if (d && d.vm === undefined && d.nx && d.palette) d = { vm: d }; // a bare VoxelModel
    // a 3/4 view like the bait art (tiny icons keep a flatter, more frontal view so they stay readable)
    d.view0 = { yaw: d.yaw || 0, pitch: d.pitch || 0 };
    if (!d.keepView) {
      if (!d.spinAxis) {
        const y0 = d.yaw || 0;
        d.yaw = Math.abs(y0) < 0.3 ? (y0 < 0 ? -0.42 : 0.42) : Math.sign(y0) * Math.min(0.66, Math.abs(y0));
        d.pitch = Math.max(0.3, Math.min(0.52, d.pitch || 0));
      }
      d.view0 = { yaw: Math.sign(d.yaw || 1) * Math.min(Math.abs(d.yaw || 0), 0.3), pitch: Math.min(d.pitch || 0, 0.3) };
    }
    if (!d.vm) {
      const meshes = [d.mesh, d.over, d.glass].filter(Boolean);
      const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
      for (const m of meshes) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], m.bounds.min[k]); max[k] = Math.max(max[k], m.bounds.max[k]); }
      const c = [0, 1, 2].map((k) => (min[k] + max[k]) / 2);
      for (const m of meshes) {
        for (let i = 0; i < m.data.length; i += 11) { m.data[i] -= c[0]; m.data[i + 1] -= c[1]; m.data[i + 2] -= c[2]; }
      }
    }
    d.fits = new Map();
    d.vox = new Map();
  } catch (e) {
    console.error(e);
    d = null;
  }
  lpDefs.set(key, d);
  return d;
}

let voxOn = true;
export function setVoxelIcons(on) { voxOn = !!on; frameCache.clear(); hiFrames.clear(); cache.clear(); }

// the voxel layers of a model at `res` voxels along its longest side (cached on the def; z spins voxelise per roll)
function voxOf(def, res, roll = 0) {
  const k = res + '|' + (roll ? roll.toFixed(3) : 0);
  let v = def.vox.get(k);
  if (v !== undefined) return v;
  try { v = def.vm ? modelLayers(def, res) : voxelizeLayers(def, res, roll); } catch (e) { console.error('voxel icon', e); v = null; }
  def.vox.set(k, v);
  if (def.vox.size > 40) def.vox.delete(def.vox.keys().next().value);
  return v;
}

// One frame of a model, `px` device pixels across, turned by `turn` radians -> canvas (S x S, model centre at the middle)
function renderDef(def, px, turn, S) {
  if (def.view0 && px < 52) def = { ...def, yaw: def.view0.yaw, pitch: def.view0.pitch };
  const res = def.vm ? Math.max(14, Math.round(px / 1.9)) : iconRes(px);
  const T = px >= 64 ? 2 : 1;
  const fk = px + '|' + res + '|' + (def.yaw || 0).toFixed(2);
  let fit = def.fits.get(fk);
  if (!fit) {
    const L0 = voxOf(def, res, 0);
    if (!L0) return null;
    const e = layersExtent(L0, def.yaw || 0, def.pitch || 0);
    const s = (px - 2 * T - 2) / Math.max(e.w, e.h, 1);
    fit = { s, dx: -e.cx * s, dy: -e.cy * s };
    def.fits.set(fk, fit);
  }
  const zs = def.spinAxis === 'z';
  const L = voxOf(def, res, zs ? turn : 0);
  if (!L) return null;
  return renderLayers(L, {
    S: S || Math.round(px * 1.3) + 8, s: fit.s, dx: fit.dx, dy: fit.dy, yaw: (def.yaw || 0) + (zs ? 0 : turn), pitch: def.pitch || 0,
    glassAlpha: def.glassAlpha ?? 0.4, T,
  });
}

// new frames are built within a per-frame budget (~7 ms per 16 ms); while over it the nearest cached turn of the
// same icon stands in (or null: callers draw their fallback and ask again next frame)
let vbWin = 0, vbSpent = 0;
let vbMiss = 0;
function vBudget() { const n = performance.now(); if (n - vbWin > 16) { vbWin = n; vbSpent = 0; } if (vbSpent < 7) return true; vbMiss++; return false; }
/** Count of frame builds deferred by the budget (callers that cache their own results compare before / after). */
export function voxMisses() { return vbMiss; }
function nearestTurn(map, key, px, q, steps) {
  for (let d = 1; d <= steps; d++) for (const s of [q - d, q + d]) { const e = map.get(key + '|' + px + '|' + s); if (e) return e; }
  return null;
}
// the full-res `.hi` twins are built lazily (the 1x frame shows meanwhile), at most ~5 ms of them per frame
let hiWin = 0, hiSpent = 0;
function hiBudget() { const n = performance.now(); if (n - hiWin > 16) { hiWin = n; hiSpent = 0; } return hiSpent < 5; }

const SPIN_FULL = 12, SPIN_WOB = 4;
function turnStep(def, turn) {
  const full = def.spin === 'full';
  const steps = full ? SPIN_FULL : SPIN_WOB;
  const q = full ? Math.round((((turn % 1) + 1) % 1) * steps) % steps : Math.round(Math.max(-1, Math.min(1, turn)) * (steps / 2));
  const ang = full ? (q / steps) * Math.PI * 2 : (q / (steps / 2)) * 0.5;
  return { q, steps, ang };
}

function detailFrame(map, key, make, px, turn, force, minPx, eager = false) {
  px = Math.max(minPx, Math.round(px));
  const def = prepModel(key, make);
  if (!def) return null;
  const { q, steps, ang } = turnStep(def, turn);
  const k = key + '|' + px + '|' + q;
  let e = map.get(k);
  if (e !== undefined) return e;
  if (!force && !vBudget()) return nearestTurn(map, key, px, q, steps);
  const tb = performance.now();
  let canvas = null;
  const S = Math.round(px * 1.3) + 8;
  try { canvas = renderDef(def, px, ang, S); } catch (err) { console.error('voxel icon ' + key, err); canvas = null; }
  e = canvas ? { canvas, ox: S / 2, oy: S / 2 } : null;
  if (canvas && eager) {
    // modelFrame callers read `.hi` straight away: render the full-res twin now
    let big = null;
    try { big = renderDef(def, px * HI, ang, S * HI); } catch { big = null; }
    if (big) Object.defineProperty(canvas, 'hi', { value: big, configurable: true });
  } else if (canvas) {
    withHi(canvas, () => {
      if (!force && !hiBudget()) return undefined;
      const t0 = performance.now();
      let big = null;
      try { big = renderDef(def, px * HI, ang, S * HI); } catch { big = null; }
      hiSpent += performance.now() - t0;
      return big;
    });
  }
  vbSpent += performance.now() - tb;
  map.set(k, e);
  if (map.size > 1500) map.delete(map.keys().next().value);
  return e;
}

const frameCache = new Map();
function frameOf(key, make, px, turn) { return detailFrame(frameCache, key, make, px, turn, false, 8); }

//   modelFrame(key, make, px, turn, force) -> {canvas (logical, `.hi` twin), ox, oy} | null     (turn as in iconFrame)
const hiFrames = new Map();
export function modelFrame(key, make, px, turn = 0, force = false) { return detailFrame(hiFrames, key, make, px, turn, force, 6, true); }
export function modelSpin(key, make) { const d = prepModel(key, make); return d?.spin || null; }

const legacyMake = new Map();
// hand-built model, else the low-poly mesh, else the phase 3 voxel model (all through the detailed pipeline)
const iconMake = (id) => ICON_VOX[id] || ICON_MODELS[id] || (MODELS[id] ? (legacyMake.get(id) || legacyMake.set(id, () => {
  const d = MODELS[id]();
  return { vm: d.m, yaw: -(d.yaw ?? 30) / 57.2958, pitch: (d.pitch ?? 25) / 57.2958, spin: 'wobble', keepView: true };
}).get(id)) : null);
export function iconSpinMode(id) {
  if (!iconMake(id)) return null;
  return prepModel(id, iconMake(id))?.spin || null;
}

export function iconFrame(id, px, turn = 0) {
  if (!iconMake(id)) return null;
  return frameOf(id, iconMake(id), px, turn);
}
setCoinRenderer((px, turn) => iconFrame('coin', px, turn)); // drawAeroCoin's 3D drop

// crop a centred square of `px + pad` from a frame (static icons keep their old tight footprint)
function cropFrame(f, px, pad = 6) {
  const S = Math.min(f.canvas.width, px + pad);
  const c = makeCanvas(S, S);
  ctxOf(c).drawImage(f.canvas, Math.round(S / 2 - f.ox), Math.round(S / 2 - f.oy));
  return withHi(c, () => { const h = f.canvas.hi; if (!h) return undefined; const c2 = makeCanvas(S * HI, S * HI); ctxOf(c2).drawImage(h, Math.round((S / 2 - f.ox) * HI), Math.round((S / 2 - f.oy) * HI)); return c2; }); // [phase9:ui]
}

export function rodIcon(rod, px = 32) {
  if (!rod) return null;
  const k = 'rod:' + (rod.id || rod.color || 'x') + '|' + px;
  let c = frameCache.get(k);
  if (c === undefined) {
    const f = frameOf('rod:' + (rod.id || 'x'), () => ROD_VOX(rod) || ROD_MODEL(rod), px, 0);
    if (!f) return null; // over the build budget: ask again next frame
    c = cropFrame(f, px);
    frameCache.set(k, c);
  }
  return c;
}

export function gemIcon(color, px = 16) {
  const k = 'gemc:' + color + '|' + px;
  let c = frameCache.get(k);
  if (c === undefined) {
    const f = frameOf('gem:' + color, () => GEM_VOX(color) || GEM_MODEL(color), px, 0);
    if (!f) return null;
    c = cropFrame(f, px, 4);
    frameCache.set(k, c);
  }
  return c;
}

// voxel ornaments for the chrome (leaves, shell, starfish, bubbles, pearl, coral) and Lab cut gems
//   decorFrame(name, px, turn) -> {canvas (`.hi`), ox, oy} | null
//   cutGemFrame(color, cut, px, dim, turn) -> {canvas (`.hi`), ox, oy} | null
export function decorFrame(name, px, turn = 0) {
  if (name.startsWith('orb:')) return modelFrame('decor:' + name, () => ORB_MODEL(name.slice(4)), px, turn);
  const make = DECOR_MODELS[name];
  return make ? modelFrame('decor:' + name, make, px, turn) : null;
}
export function cutGemFrame(color, cut = 'round', px = 12, dim = false, turn = 0) {
  return modelFrame('cutgem:' + color + '|' + cut + '|' + (dim ? 1 : 0), () => CUT_GEM_MODEL(color, cut, dim), px, turn, true);
}
setDecorRenderer(decorFrame);

// VoxelModel art (items, bait, Lab boats / tanks / globes) in the same detailed style, at the model's own resolution:
//   voxelModelFrame(key, make () -> VoxelModel | {m, yaw, pitch (degrees, renderVoxels convention)}, px, turn, force)
//     -> {canvas (`.hi`), ox, oy} | null
export function voxelModelFrame(key, make, px, turn = 0, force = false) {
  return modelFrame('vm:' + key, () => {
    const r = make();
    const m = r && r.m ? r.m : r;
    if (!m || !m.bounds()) throw new Error('empty voxel model ' + key);
    const yaw = r && r.m && r.yaw !== undefined ? -r.yaw / 57.2958 : 0.55, pitch = r && r.m && r.pitch !== undefined ? r.pitch / 57.2958 : 0.46;
    return { vm: m, yaw, pitch, spin: 'full', keepView: !!(r && r.m) };
  }, px, turn, force);
}

export function getBigIcon(id, opts = {}) {
  const px = typeof opts.size === 'number' ? opts.size : SIZES[opts.size] || (opts.small ? SMALL : BIG);
  if (iconMake(id)) {
    const state = opts.state === 'hover' || opts.state === 'active' ? opts.state : 'normal';
    const key = 'lp|' + id + '|' + state + '|' + px;
    let e = cache.get(key);
    if (e) return e;
    const f = frameOf(id, iconMake(id), px, 0);
    if (f) {
      const base = cropFrame(f, px);
      const vc = state === 'normal' ? base : variant(base, state);
      const canvas = vc === base ? base : withHi(vc, () => { const h = base.hi; return h ? fitHi(vc, variant(h, state)) : undefined; }); // [phase9:ui]
      const g = ctxOf(canvas);
      const data = g.getImageData(0, 0, canvas.width, canvas.height).data;
      let by = canvas.height;
      outer: for (let y = canvas.height - 1; y >= 0; y--) for (let x = 0; x < canvas.width; x++) if (data[(y * canvas.width + x) * 4 + 3] > 100) { by = y + 1; break outer; }
      e = { canvas, cx: Math.round(canvas.width / 2), by };
      cache.set(key, e);
      return e;
    }
  }
  if (!MODELS[id] && itemPixel('icon_' + id)) { // [phase8:ui] hand-drawn pixel icon for ids without a model
    const key = 'pix|' + id + '|' + px;
    let e = cache.get(key);
    if (!e) {
      const b = itemPixel('icon_' + id);
      const k = Math.max(1, Math.floor(px / Math.max(b.w, b.h)));
      const c = itemPixelScaled('icon_' + id, k);
      e = { canvas: c, cx: Math.round(c.width / 2), by: c.height };
      cache.set(key, e);
    }
    return e;
  }
  return voxelIcon(id, opts);
}

export function drawBadge(ctx, x, y, badge, t = 0) {
  drawAeroBadge(ctx, x, y, badge, t);
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
