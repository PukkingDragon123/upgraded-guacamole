// Quest cutscene set dressing [cine21]: hand-built VOXEL props, floating set platforms and little critters that the
// quest cutscenes (src/ui/questcine.js) bring on stage. Every model is a VoxelModel rendered once per screen height by
// renderVoxels (a logical sprite + a 2x `.hi` twin for the full-res UI layer) and cached; prepProps() is a generator
// the director steps during idle frames (one render per step), so a cutscene never builds art while it plays.
//
//   PROP_DEFS[id]                         {n (frames), vs (px per voxel at H 720), yaw, pitch, sink (voxel row at the
//                                          waterline), anchors: {name: [x, y, z]}}
//   propSprite(id, frame, variant, H)    -> {c, ox, oy, A: {name: [dx, dy] from the ground point}, w, h} | null (not built)
//   propNow(id, frame, variant, H)       same, building it right away when it is missing
//   *prepProps([[id, variant], ...], H)  pre-render every frame of these (one render per yield)
//   drawProp(ctx, id, frame, variant, x, y, k, H, {flip, alpha}) -> anchors in screen space | null
//     (x, y) = the ground / waterline point on screen, k = extra draw scale (camera zoom relative to the stage zoom)
//
// Props: bench (Professor Fizz's portable lab bench: bubbling flasks, a coil, test tubes, a burner), workshop
// (Marina's anvil on a stump, hammer, open toolbox, life ring), captain (Captain Bloat's tiny ship wheel, a sea chart
// on an easel, a barrel of scrolls). Platforms, one per ocean: islet (oscean), pier (shallows), floe (fjord, with a
// snowman), scrap (junkyard: tyre, cog, glowing CRT), pontoon (metropolis: neon fish sign, street lamp), basalt
// (volcano: columns with lava cracks), glowrock (abyss: bioluminescent mushrooms and crystals). Critters: gull,
// penguin, crab (variant colours per ocean), jelly (bioluminescent).
import { VoxelModel, renderVoxels } from '../gfx/voxel.js';
import { makeCanvas, ctxOf } from '../core/canvas.js';
import { hash3, TAU } from '../core/math.js';

function palette(m) {
  const memo = new Map();
  return (hex, o = {}) => {
    const k = hex + JSON.stringify(o);
    let i = memo.get(k);
    if (i === undefined) { i = m.color(hex, { jitter: 0.05, smooth: 0.45, ...o }); memo.set(k, i); }
    return i;
  };
}
const glossy = { spec: 1.2, specPow: 12, smooth: 0.8, jitter: 0.02 };
const glass = { spec: 1.5, specPow: 14, smooth: 1, jitter: 0, light: 0.25 };
// ring of capsules in the x-y plane at depth z
function ring(m, cx, cy, z, R, r, c, n = 40) {
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * TAU, a1 = ((i + 1) / n) * TAU;
    m.line(cx + Math.cos(a0) * R, cy + Math.sin(a0) * R, z, cx + Math.cos(a1) * R, cy + Math.sin(a1) * R, z, typeof c === 'function' ? c(a0) : c, r);
  }
}

// ------------------------------------------------------------------ Professor Fizz's portable lab bench
function buildBench(f) {
  const m = new VoxelModel(62, 54, 22), C = palette(m);
  const white = C('#f4fbff', glossy), white2 = C('#dbe9f4', glossy), mint = C('#46e0a8', glossy), chrome = C('#b8c8d8', { ...glossy, spec: 1.6 });
  const wood = C('#c8925a'), woodD = C('#a8703e'), copper = C('#e08a4a', glossy), dark = C('#2a3448', glossy);
  const glassC = C('#d8f6ff', glass), glassD = C('#a8e4f8', glass);
  const green = C('#7aff6a', { ...glossy, emissive: 0.35 }), greenL = C('#d6ffb0', { emissive: 0.6, jitter: 0 });
  const pink = C('#ff6ab8', { ...glossy, emissive: 0.35 }), pinkL = C('#ffd0ec', { emissive: 0.6, jitter: 0 });
  const aqua = C('#3ad8ff', { ...glossy, emissive: 0.3 }), yel = C('#ffe04a', { ...glossy, emissive: 0.3 }), purp = C('#b47aff', { ...glossy, emissive: 0.3 });
  const flame = C('#8ae8ff', { emissive: 1, jitter: 0 }), flameW = C('#ffffff', { emissive: 1, jitter: 0 });
  // table top with a mint trim, chrome legs, a cross bar, a lower shelf and a drawer
  m.box(3, 21, 3, 58, 23, 18, white);
  m.box(3, 20, 3, 58, 20, 18, mint);
  m.box(3, 23, 18, 58, 23, 18, C('#ffffff', glossy));
  for (const [x, z] of [[6, 5], [55, 5], [6, 16], [55, 16]]) m.cylinder(x, z, 0, 19, 1.3, chrome);
  m.box(6, 7, 4, 55, 8, 17, wood);
  for (let x = 6; x <= 55; x += 4) m.box(x, 8, 4, x, 8, 17, woodD);
  m.box(36, 14, 15, 54, 19, 18, white2);
  m.box(43, 16, 19, 47, 17, 19, mint);
  // on the shelf: a stack of books and a jar of glowing pellets
  m.box(10, 9, 8, 18, 10, 14, C('#ff7a5a')); m.box(11, 11, 8, 17, 12, 14, C('#4aa8ff')); m.box(10, 13, 9, 16, 13, 13, C('#ffd23a'));
  m.cylinder(26, 11, 9, 14, 2.6, glassD); m.box(25, 9, 10, 27, 11, 12, yel);
  // flask A (Erlenmeyer, green, bubbling)
  const lvl = 30 + [0, 1, 0, -1][f % 4] * 0.5;
  m.cone(13, 11, 24, 36, 6.2, 1.7, (x, y) => (y < lvl ? green : glassC));
  m.cylinder(13, 11, 36, 41, 1.6, glassC);
  m.cylinder(13, 11, 41, 41, 2.3, glassD);
  // flask B (round bottom, pink) on a little tripod over a burner
  const lvlB = 31 + [0, -1, 0, 1][f % 4] * 0.5;
  m.sphere(29, 32, 11, 5.4, (x, y) => (y < lvlB ? pink : glassC));
  m.cylinder(29, 11, 36, 45, 1.4, glassC);
  m.cylinder(29, 11, 45, 45, 2.1, glassD);
  for (const [dx, dz] of [[-4, -3], [4, -3], [0, 4]]) m.line(29 + dx, 24, 11 + dz, 29 + dx * 0.7, 27.5, 11 + dz * 0.7, dark, 0.5);
  m.cylinder(29, 11, 24, 25, 2.4, dark);
  m.cone(29, 11, 25, 27 + (f % 2), 1.3, 0.3, (x, y) => (y < 26 ? flameW : flame));
  // the copper coil from flask A over to flask B
  m.tube([[13, 41, 11, 0.6], [16, 47, 11, 0.6], [22, 49, 11, 0.6], [27, 48, 11, 0.6], [29, 45, 11, 0.6]], copper);
  // test tube rack (three colours)
  m.box(40, 24, 7, 55, 26, 14, wood);
  m.box(40, 30, 9, 55, 30, 12, woodD);
  [[43, aqua], [47, yel], [51, purp]].forEach(([x, col], i) => {
    const top = 33 + (i === 1 ? 1 : 0);
    m.cylinder(x, 10.5, 24, top, 1.2, (xx, y) => (y < 28 + ((f + i) % 2) ? col : glassC));
  });
  // bubbles inside the liquids (move up each frame)
  const bub = (x, y, z, c) => m.set(x, y, z, c);
  for (let i = 0; i < 3; i++) {
    const ya = 25 + ((f + i * 2) % 5), yb = 28 + ((f * 2 + i * 3) % 4);
    bub(11 + i * 2, ya, 16, greenL); bub(27 + i * 2, yb, 15, pinkL);
  }
  return { m, anchors: { mouthA: [13, 42, 11], mouthB: [29, 46, 11], flame: [29, 27, 11], top: [30, 50, 11] } };
}

// ------------------------------------------------------------------ Marina's anvil, hammer, toolbox and life ring
function buildWorkshop() {
  const m = new VoxelModel(66, 34, 26), C = palette(m);
  const wood = C('#b07a48'), woodL = C('#d8a468'), woodD = C('#7a4e2a'), steel = C('#5a6a80', { spec: 1.4, specPow: 10, smooth: 0.6 }), steelL = C('#a8b8cc', { spec: 1.6 });
  const red = C('#e8443a', glossy), redD = C('#b02a24', glossy), yel = C('#ffd23a', glossy), white = C('#f6fbff', glossy), grip = C('#2a8ae0', glossy);
  // tree stump with growth rings and the anvil on it
  m.cylinder(15, 12, 0, 10, 7.2, (x, y, z) => (y === 10 ? (Math.round(Math.hypot(x - 15, z - 12)) % 2 ? woodL : wood) : (x + z) % 3 ? wood : woodD));
  m.box(9, 11, 8, 22, 13, 16, steel);
  m.box(12, 14, 9, 19, 16, 15, steel);
  m.box(5, 17, 7, 25, 20, 17, steel);
  m.box(5, 20, 7, 25, 20, 17, steelL);
  m.cone(18, 12, 25, 33, 2.6, 0.4, steel, 'x');
  // hammer resting across the anvil
  m.line(9, 21, 13, 1, 25, 15, woodD, 0.9);
  m.box(8, 20, 10, 13, 24, 16, C('#3a4458', { spec: 1.4 }));
  m.box(8, 24, 10, 13, 24, 16, steelL);
  // toolbox: red box, white band, yellow latches, open lid, tools sticking out
  m.box(36, 0, 7, 62, 11, 19, (x, y) => (y === 5 || y === 6 ? white : y < 2 ? redD : red));
  for (const x of [40, 58]) m.box(x, 8, 20, x + 1, 10, 20, yel);
  m.box(36, 12, 4, 62, 13, 7, redD);
  m.line(42, 12, 13, 42, 17, 13, yel, 0.9); m.line(42, 17, 13, 56, 17, 13, yel, 0.9); m.line(56, 17, 13, 56, 12, 13, yel, 0.9);
  m.line(46, 11, 10, 50, 23, 10, steel, 0.8);
  m.sphere(50.6, 24.4, 10, 2, steel);
  m.sub(() => m.box(50, 25, 8, 52, 27, 12));
  m.line(54, 11, 11, 55, 18, 11, grip, 1.1);
  m.line(55, 18, 11, 56, 24, 11, steelL, 0.5);
  // life ring leaning on the box (red and white quarters)
  ring(m, 31, 8.5, 22, 6.2, 1.7, (a) => (Math.floor((a / TAU) * 8) % 2 ? red : white), 36);
  return { m, anchors: { anvil: [15, 21, 12], top: [48, 26, 12] } };
}

// ------------------------------------------------------------------ Captain Bloat's ship wheel, sea chart and barrel
function buildCaptain() {
  const m = new VoxelModel(66, 50, 26), C = palette(m);
  const wood = C('#a86a3a'), woodL = C('#d0945a'), woodD = C('#6e4222'), brass = C('#ffcf4a', { spec: 1.6, specPow: 10, smooth: 0.7 });
  const parch = C('#f8e6b8', { smooth: 0.2 }), parchD = C('#e0c088'), sea = C('#5ab8f0', { smooth: 0.2 }), seaD = C('#3a8ad8', { smooth: 0.2 }), isle = C('#6ad04a', { smooth: 0.2 }), sand = C('#ffe08a', { smooth: 0.2 }), ink = C('#e8342a', { smooth: 0.1 });
  // the helm: base, post, wheel with eight spokes and handles, brass hub
  m.box(10, 0, 7, 26, 2, 17, woodD);
  m.cylinder(18, 12, 2, 22, 2, wood);
  const wy = 32, wz = 15;
  ring(m, 18, wy, wz, 9.5, 1.3, (a) => (Math.floor((a / TAU) * 16) % 2 ? wood : woodL), 48);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU + 0.2;
    m.line(18, wy, wz, 18 + Math.cos(a) * 13, wy + Math.sin(a) * 13, wz, woodD, 0.7);
    m.sphere(18 + Math.cos(a) * 13.6, wy + Math.sin(a) * 13.6, wz, 1.3, woodL);
  }
  m.sphere(18, wy, wz + 0.6, 2.4, brass);
  // a barrel with rolled-up charts
  m.cylinder(36, 20, 0, 10, 4.8, (x, y) => (y === 2 || y === 8 ? woodD : (x + y) % 4 ? wood : woodL));
  m.line(34, 9, 20, 32, 16, 18, parch, 1.2); m.line(37, 9, 21, 39, 17, 21, parchD, 1.2);
  // the sea chart on an easel (islands, a dotted route, an X)
  m.line(47, 0, 9, 46, 30, 13, woodD, 0.8); m.line(61, 0, 9, 60, 30, 13, woodD, 0.8); m.line(54, 0, 3, 54, 28, 12, woodD, 0.8);
  for (let y = 14; y <= 38; y++) for (let x = 42; x <= 64; x++) {
    const z = 14 - (y - 14) * 0.14;
    const u = (x - 42) / 22, v = (y - 14) / 24;
    let c = (hash3(x >> 1, y >> 1, 3) < 0.5 ? sea : seaD);
    const dI1 = Math.hypot(u - 0.3, v - 0.35), dI2 = Math.hypot(u - 0.72, v - 0.7);
    if (dI1 < 0.17 || dI2 < 0.14) c = dI1 < 0.12 || dI2 < 0.1 ? isle : sand;
    if (x < 44 || x > 62 || y < 16 || y > 36) c = parch;
    if (x === 42 || x === 64) c = parchD;
    m.set(x, y, z, c);
  }
  // dotted route from the first island to the X
  for (let i = 0; i <= 8; i++) { const k = i / 8; if (i % 2 === 0) m.set(48.6 + k * 8, 22.4 + k * 6 + Math.sin(k * 3) * 2, 14 - (22.4 + k * 6 - 14) * 0.14 + 1, ink); }
  for (const [dx, dy] of [[0, 0], [1, 1], [-1, -1], [1, -1], [-1, 1]]) m.set(58 + dx, 31 + dy, 14 - (31 - 14) * 0.14 + 1, ink);
  m.cylinder(39, 10.8, 41, 65, 1.4, parchD, 'x');
  m.cylinder(14, 14.4, 41, 65, 1.4, parchD, 'x');
  return { m, anchors: { wheel: [18, wy, wz], chart: [53, 26, 12], top: [30, 46, 12] } };
}

// ------------------------------------------------------------------ set platforms (one per ocean)
function slabOutline(x, z, cx, cz, rx, rz, seed) {
  const a = Math.atan2(z - cz, x - cx);
  const wob = 1 + (hash3(Math.round(a * 3), 0, seed) - 0.5) * 0.18;
  return ((x - cx) / (rx * wob)) ** 2 + ((z - cz) / (rz * wob)) ** 2 <= 1;
}
function buildIslet() {
  const m = new VoxelModel(70, 34, 30), C = palette(m);
  const soil = C('#8a5a34'), soilD = C('#6a3e22'), grass = C('#5ad03a', { smooth: 0.3 }), grassL = C('#9af064', { smooth: 0.3 }), grassD = C('#3aa828');
  const petals = [C('#ffffff', glossy), C('#ffd23a', glossy), C('#ff8ac8', glossy), C('#8ad8ff', glossy)], stem = C('#2a8a1a');
  const post = C('#f4f8ff', glossy), board = C('#ffffff', glossy), leaf = C('#46c22e', glossy);
  for (let y = 0; y <= 9; y++) for (let z = 0; z < 30; z++) for (let x = 0; x < 70; x++) {
    const shrink = y < 6 ? 1 - (6 - y) * 0.07 : 1;
    if (!slabOutline(x + 0.5, z + 0.5, 35, 15, 32 * shrink, 13 * shrink, 5)) continue;
    m.set(x, y, z, y >= 8 ? (hash3(x, z, 1) < 0.3 ? grassL : grass) : y === 7 ? grassD : (x + y * 2) % 5 ? soil : soilD);
  }
  // grass tufts and flowers
  for (let i = 0; i < 70; i++) {
    const x = 6 + Math.floor(hash3(i, 1, 2) * 58), z = 4 + Math.floor(hash3(i, 2, 2) * 22);
    if (!m.get(x, 9, z)) continue;
    const h = 1 + Math.floor(hash3(i, 3, 2) * 3);
    for (let y = 10; y < 10 + h; y++) m.set(x, y, z, i % 3 ? grass : grassL);
    if (i % 4 === 0) { m.set(x, 10 + h, z, stem); const p = petals[i % 4]; for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) m.set(x + dx, 11 + h, z + dz, p); m.set(x, 11 + h, z, petals[1]); }
  }
  // a little welcome sign with a leaf painted on it
  m.box(55, 10, 12, 56, 26, 13, post);
  m.box(48, 20, 13, 63, 28, 14, board);
  for (let i = 0; i < 6; i++) { m.set(52 + i, 22 + Math.round(Math.sin(i * 0.6) * 2 + i * 0.4), 15, leaf); m.set(53 + i, 24 + Math.round(i * 0.4), 15, leaf); }
  return { m, sink: 6, anchors: { stage: [30, 10, 15], sign: [55, 28, 13], top: [35, 30, 15] } };
}
function buildPier() {
  const m = new VoxelModel(72, 30, 28), C = palette(m);
  const p1 = C('#c8904e'), p2 = C('#b07a3e'), p3 = C('#d8a868'), beam = C('#7a4e2a'), algae = C('#4aa83a'), rope = C('#f0dca0'), bucket = C('#3aa0f0', glossy), bucketD = C('#2a78c8', glossy), worm = C('#ff8aa8', glossy), buoy = C('#ff7a2a', glossy), white = C('#ffffff', glossy);
  for (const [x, z] of [[6, 6], [6, 22], [64, 6], [64, 22], [35, 6], [35, 22]]) m.cylinder(x, z, 0, 9, 2.2, (xx, y) => (y < 5 ? algae : beam));
  m.box(2, 8, 5, 69, 8, 23, beam);
  for (let x = 1; x <= 70; x++) for (let z = 3; z <= 25; z++) m.set(x, 9 + (hash3(x >> 2, 0, 9) < 0.2 ? 0 : 0), z, [p1, p2, p3][(x >> 2) % 3]);
  for (let x = 4; x <= 68; x += 4) for (let z = 3; z <= 25; z++) if (z % 2 === 0) m.set(x, 9, z, beam);
  // rope coil, a bait bucket full of worms, a buoy
  for (let k = 0; k < 3; k++) ring({ line: (...a) => m.line(a[0], a[2], a[1], a[3], a[5], a[4], a[6], a[7]) }, 14, 19, 10.5 + k, 3.2 - k * 0.6, 0.6, rope, 24);
  m.cylinder(52, 16, 10, 17, 4, (x, y) => (y === 16 || y === 11 ? bucketD : bucket));
  m.sub(() => m.cylinder(52, 16, 13, 17, 3.1, 1));
  for (let i = 0; i < 8; i++) m.set(50 + (i % 4), 16 + (i >> 2) * 0.6, 14 + (i % 3), worm);
  m.line(49, 18, 15, 50, 20, 16, worm, 0.6);
  m.line(48.5, 16, 16, 52, 22, 16, bucketD, 0.4); m.line(52, 22, 16, 55.5, 16, 16, bucketD, 0.4);
  m.sphere(64, 13, 24, 3.4, (x, y) => (y > 13 ? white : buoy));
  return { m, sink: 4, anchors: { stage: [30, 10, 15], bucket: [52, 18, 16], top: [36, 24, 15] } };
}
function buildFloe() {
  const m = new VoxelModel(74, 40, 32), C = palette(m);
  const ice = C('#9ae0ff', { spec: 1.3, specPow: 12, smooth: 0.6 }), iceD = C('#5ab0e8', { spec: 1.2 }), snow = C('#ffffff', { smooth: 0.7 }), snowB = C('#e0f0ff', { smooth: 0.7 });
  const coal = C('#26303c'), carrot = C('#ff8a2a', glossy), scarf = C('#ff4a6a', glossy), stick = C('#7a4e2a');
  for (let y = 0; y <= 7; y++) for (let z = 0; z < 32; z++) for (let x = 0; x < 74; x++) {
    if (!slabOutline(x + 0.5, z + 0.5, 37, 16, 34 - (7 - y) * 0.4, 14 - (7 - y) * 0.3, 11)) continue;
    m.set(x, y, z, y >= 6 ? (hash3(x, z, 4) < 0.25 ? snowB : snow) : y < 3 ? iceD : ice);
  }
  // snow drifts and a pile
  for (let i = 0; i < 6; i++) m.ellipsoid(8 + i * 11 + hash3(i, 0, 1) * 4, 7, 6 + hash3(i, 1, 1) * 18, 5 + hash3(i, 2, 1) * 3, 2.2, 4, snow);
  m.ellipsoid(14, 8, 12, 8, 6, 7, (x, y) => (y > 11 ? snow : snowB));
  // a snowman with a scarf, coal eyes and a carrot nose
  m.sphere(56, 12, 15, 5.6, snow); m.sphere(56, 20, 15, 4.2, snow); m.sphere(56, 26.5, 15, 3.2, snow);
  m.set(55, 27, 18, coal); m.set(57, 27, 18, coal); m.line(56, 26, 18, 56, 26, 21, carrot, 0.6);
  for (const y of [14, 18, 21]) m.set(56, y, 20, coal);
  m.cylinder(56, 15, 23, 23.6, 3.6, scarf); m.line(58, 23, 17, 60, 18, 18, scarf, 0.8);
  m.line(52, 20, 15, 46, 25, 15, stick, 0.5); m.line(60, 20, 15, 66, 24, 15, stick, 0.5);
  // icicle shards along the front edge
  for (let x = 6; x < 70; x += 5) m.cone(x, 29, 2, 5, 0.3, 1.2, iceD);
  return { m, sink: 4, anchors: { stage: [32, 8, 16], snowman: [56, 30, 15], top: [36, 32, 15] } };
}
function buildScrap(f) {
  const m = new VoxelModel(72, 48, 30), C = palette(m);
  const rust = C('#b0603a'), rustD = C('#7a3e26'), plate = C('#6a7a88', { spec: 1.2 }), rivet = C('#c8d4e0', { spec: 1.5 }), tyre = C('#2a2e36'), tyreL = C('#4a505c');
  const cog = C('#e8b43a', { spec: 1.4, specPow: 10 }), cogD = C('#b0801e'), beige = C('#e8dcc0', glossy), beigeD = C('#b8a888'), pipe = C('#8aa0b4', { spec: 1.4 });
  const scr = C(f % 2 ? '#4aff8a' : '#2ad870', { emissive: 0.9, jitter: 0 }), scrD = C('#0a3a20', { emissive: 0.3, jitter: 0 }), can = C('#e8463a', glossy);
  for (let y = 0; y <= 4; y++) for (let z = 1; z < 29; z++) for (let x = 1; x < 71; x++) if (slabOutline(x + 0.5, z + 0.5, 36, 15, 34, 13.5, 2)) m.set(x, y, z, y === 4 ? ((x + z) % 7 === 0 ? rivet : plate) : (x * 3 + y) % 5 ? rust : rustD);
  // the heap: a tyre, a cog, a CRT with a glowing screen, pipes and a can
  ring(m, 20, 10, 16, 5, 2.4, (a) => (Math.floor(a * 3) % 2 ? tyre : tyreL), 30);
  for (let i = 0; i < 12; i++) { const a = (i / 12) * TAU; m.box(44 + Math.cos(a) * 8, 14 + Math.sin(a) * 8, 8, 44 + Math.cos(a) * 9.5, 14 + Math.sin(a) * 9.5, 10, cog); }
  m.cylinder(44, 14, 7, 11, 8, cogD, 'z'); m.cylinder(44, 14, 7, 11, 7.4, cog, 'z'); m.sub(() => m.cylinder(44, 14, 6, 12, 2.4, 1, 'z'));
  m.box(28, 5, 12, 46, 21, 26, beige);
  m.box(31, 8, 26, 43, 18, 26, beigeD);
  m.box(32, 9, 27, 42, 17, 27, (x, y) => (y % 2 ? scr : scrD));
  m.box(29, 5, 12, 45, 6, 25, beigeD);
  m.line(36, 21, 19, 33, 30, 19, pipe, 0.4); m.line(38, 21, 19, 42, 29, 19, pipe, 0.4);
  m.cylinder(12, 24, 5, 30, 1.8, pipe, 'x'); m.line(58, 5, 8, 66, 22, 10, pipe, 1.6);
  m.cylinder(62, 22, 5, 10, 2, can);
  return { m, sink: 3, anchors: { screen: [37, 13, 28], stage: [20, 6, 16], top: [36, 34, 16], antenna: [33, 30, 19] } };
}
function buildPontoon(f) {
  const m = new VoxelModel(74, 64, 28), C = palette(m);
  const deck = C('#3a4a68', { spec: 1.1 }), deckD = C('#26304a'), stripe = C('#ffd23a'), stripeD = C('#2a2a30'), post = C('#2a3448', { spec: 1.3 }), board = C('#141a30', glossy);
  const pinkN = C(f % 3 === 2 ? '#a83a78' : '#ff5ad8', { emissive: f % 3 === 2 ? 0.2 : 1, jitter: 0 }), aquaN = C('#4af0ff', { emissive: 1, jitter: 0 }), yelN = C('#fff07a', { emissive: 1, jitter: 0 });
  const lampG = C('#fff2b0', { emissive: 1, jitter: 0 }), lampC = C('#3a4458', { spec: 1.4 });
  for (let y = 0; y <= 5; y++) for (let z = 2; z <= 25; z++) for (let x = 1; x <= 72; x++) m.set(x, y, z, y === 5 ? ((x >> 2) % 2 ? deck : deckD) : y === 4 && (z === 25 || z === 2) ? ((x >> 2) % 2 ? stripe : stripeD) : deckD);
  // neon fish sign on two posts
  m.box(14, 6, 10, 15, 30, 11, post); m.box(43, 6, 10, 44, 30, 11, post);
  m.box(10, 30, 9, 48, 52, 10, board);
  const tube = (x0, y0, x1, y1, c) => m.line(x0, y0, 11.5, x1, y1, 11.5, c, 0.6);
  // fish outline: body ellipse + tail
  for (let i = 0; i < 28; i++) { const a0 = (i / 28) * TAU, a1 = ((i + 1) / 28) * TAU; tube(26 + Math.cos(a0) * 9, 41 + Math.sin(a0) * 6, 26 + Math.cos(a1) * 9, 41 + Math.sin(a1) * 6, pinkN); }
  tube(17, 41, 12, 46, pinkN); tube(12, 46, 12, 36, pinkN); tube(12, 36, 17, 41, pinkN);
  m.sphere(31, 43, 11.5, 1.1, aquaN);
  // waves and a star
  for (let x = 36; x < 46; x++) { m.set(x, 34 + Math.round(Math.sin(x * 0.9) * 1), 11, aquaN); m.set(x, 49 + Math.round(Math.sin(x * 0.9 + 1) * 1), 11, yelN); }
  // street lamp
  m.cylinder(62, 14, 6, 50, 1.2, lampC);
  m.line(62, 50, 14, 57, 54, 14, lampC, 0.9);
  m.box(54, 50, 12, 59, 52, 16, lampC);
  m.box(55, 48, 13, 58, 49, 15, lampG);
  return { m, sink: 3, anchors: { sign: [29, 41, 12], lamp: [56, 48, 14], stage: [30, 6, 18], top: [36, 56, 14] } };
}
function buildBasalt(f) {
  const m = new VoxelModel(70, 36, 30), C = palette(m);
  const rock = C('#2e2a36', { spec: 0.6 }), rockL = C('#4a4454', { spec: 0.6 }), rockD = C('#1a1620');
  const lava = C(f % 2 ? '#ff8a2a' : '#ff6a1a', { emissive: 1, jitter: 0 }), lavaY = C('#ffd24a', { emissive: 1, jitter: 0 }), crack = C('#ff5a1a', { emissive: 0.8, jitter: 0 });
  // hexagonal columns of different heights
  const cols = [[10, 14, 10], [20, 10, 14], [30, 16, 18], [40, 12, 12], [50, 15, 20], [60, 14, 9], [24, 22, 8], [46, 21, 9], [36, 8, 22]];
  for (const [cx, cz, h] of cols) for (let y = 0; y <= h; y++) for (let z = cz - 6; z <= cz + 6; z++) for (let x = cx - 6; x <= cx + 6; x++) {
    const dx = Math.abs(x + 0.5 - cx), dz = Math.abs(z + 0.5 - cz);
    if (dx > 5.6 || dz > 5 || dx * 0.5 + dz > 5.6) continue;
    const edge = dx > 4.8 || dz > 4.3 || dx * 0.5 + dz > 4.9;
    m.set(x, y, z, y === h ? (edge ? rockL : rock) : edge ? rockD : (hash3(x, y, z) < 0.06 ? crack : rock));
  }
  // a lava pool in the middle and glowing cracks down the faces
  m.ellipsoid(30, 18.6, 16, 3.6, 1, 3.2, (x, y, z) => (hash3(x, z, f) < 0.3 ? lavaY : lava));
  for (let y = 2; y < 16; y++) { m.set(29 + (y % 3 === 0 ? 1 : 0), y, 22, lava); m.set(50 + (y % 4 === 0 ? -1 : 0), Math.min(y, 14), 25, crack); }
  return { m, sink: 4, anchors: { pool: [30, 20, 16], vent: [50, 16, 20], stage: [30, 19, 16], top: [36, 26, 16] } };
}
function buildGlowrock(f) {
  const m = new VoxelModel(70, 34, 30), C = palette(m);
  const rock = C('#2a2448', { spec: 0.6 }), rockL = C('#3e3666'), cap1 = C(f % 2 ? '#5af0ff' : '#3ad8f0', { emissive: 0.9, jitter: 0 }), cap2 = C(f % 2 ? '#c87aff' : '#b05aff', { emissive: 0.9, jitter: 0 }), dot = C('#ffffff', { emissive: 1, jitter: 0 }), stalk = C('#d8f0ff', { emissive: 0.3 }), crys = C('#8affd8', { emissive: 0.7, spec: 1.5 });
  for (let y = 0; y <= 10; y++) for (let z = 0; z < 30; z++) for (let x = 0; x < 70; x++) {
    const s = y > 6 ? 1 - (y - 6) * 0.13 : 1;
    if (slabOutline(x + 0.5, z + 0.5, 35, 15, 31 * s, 13 * s, 8) && hash3(x >> 2, y, z >> 2) < 0.94) m.set(x, y, z, y > 8 || hash3(x, y, z) < 0.2 ? rockL : rock);
  }
  // bioluminescent mushrooms, anemone tips and crystals
  const shrooms = [[14, 14, 7, cap1], [20, 18, 5, cap2], [48, 12, 8, cap2], [56, 18, 5, cap1], [40, 20, 4, cap1]];
  for (const [x, z, h, c] of shrooms) {
    m.cylinder(x, z, 9, 9 + h, 0.9, stalk);
    m.ellipsoid(x, 10 + h, z, 3.4, 1.6, 3.4, c);
    m.set(x - 1, 11 + h, z + 2, dot); m.set(x + 2, 11 + h, z, dot);
  }
  for (let i = 0; i < 4; i++) m.line(28 + i * 2, 10, 10 + i, 26 + i * 3, 20 + i * 2, 10 + i, crys, 1);
  for (let i = 0; i < 9; i++) { const x = 6 + i * 7, z = 22 + (i % 3); m.line(x, 9, z, x + Math.sin(i + f) * 1.5, 13, z, cap2, 0.4); m.set(x, 14, z, dot); }
  return { m, sink: 4, anchors: { stage: [32, 11, 15], top: [36, 28, 15] } };
}


// a little log raft (a second prop floats in on it, on the other side of the boat)
function buildRaft() {
  const m = new VoxelModel(40, 8, 26), C = palette(m);
  const logs = [C('#c8904e'), C('#b07a3e'), C('#d8a868')], rope = C('#f0dca0'), end = C('#e8c088');
  for (let i = 0; i < 6; i++) {
    const z = 3 + i * 3.6;
    m.cylinder(4, z, 2, 37, 1.9, (x) => (x === 2 || x === 37 ? end : logs[i % 3]), 'x');
  }
  for (const x of [8, 31]) for (let z = 1; z < 25; z++) m.set(x, 4, z, rope);
  return { m, sink: 3, anchors: { stage: [20, 6, 13] } };
}

// ------------------------------------------------------------------ critters
function buildGull(f) {
  const m = new VoxelModel(30, 22, 12), C = palette(m);
  const white = C('#ffffff', { smooth: 0.8 }), grey = C('#b8c4d4', { smooth: 0.8 }), black = C('#2a3040'), beak = C('#ffc83a', glossy), red = C('#ff4a3a'), leg = C('#ff9a3a');
  const cy = f === 0 ? 8 : 10;
  m.ellipsoid(13, cy, 6, 7, 3.4, 3, white);
  m.ellipsoid(10, cy + 1.6, 6, 6, 1.6, 2.6, grey);
  m.sphere(20, cy + 2.4, 6, 2.6, white);
  m.cone(cy + 2.2, 6, 22, 25, 1, 0.4, beak, 'x');
  m.set(24, cy + 1.8, 6, red);
  m.set(21, cy + 3.2, 8, black); m.set(21, cy + 3.2, 3, black);
  m.line(6, cy + 0.5, 6, 2, cy + 2, 6, white, 1);
  if (f === 0) { m.line(12, cy - 3, 6, 12, 1, 6, leg, 0.4); m.line(15, cy - 3, 6, 15, 1, 6, leg, 0.4); m.box(11, 0, 5, 16, 0, 7, leg); m.line(7, cy + 1, 8, 15, cy + 2, 9, grey, 0.9); m.set(6, cy + 1, 8, black); }
  else {
    const up = f === 1;
    for (const z of [9, 3]) {
      const tip = up ? [9, cy + 11, z + (z > 6 ? 2 : -2)] : [9, cy - 7, z + (z > 6 ? 2 : -2)];
      m.line(14, cy + 1, z > 6 ? 8 : 4, 11, up ? cy + 6 : cy - 2, z, grey, 1);
      m.line(11, up ? cy + 6 : cy - 2, z, tip[0], tip[1], tip[2], grey, 0.8);
      m.set(tip[0], tip[1], tip[2], black); m.set(tip[0] + 1, tip[1] + (up ? -1 : 1), tip[2], black);
    }
  }
  return { m, anchors: { feet: [13, 0, 6] } };
}
function buildPenguin(f) {
  const m = new VoxelModel(20, 26, 16), C = palette(m);
  const black = C('#1e2638', { spec: 1.2, specPow: 10, smooth: 0.8 }), white = C('#ffffff', { smooth: 0.8 }), orange = C('#ffa02a', glossy), eye = C('#0a0c14'), shine = C('#ffffff', { emissive: 0.5 }), blush = C('#ff9ab8');
  const lean = f === 1 ? -1 : f === 2 ? 1 : 0;
  m.ellipsoid(10 + lean * 0.6, 9, 8, 6, 8.5, 5.6, (x, y, z) => (z > 9.4 && Math.abs(x - 10) < 4.4 && y < 14 ? white : black));
  m.sphere(10 + lean, 18, 8.4, 4.6, (x, y, z) => (z > 10.4 && y < 19.5 && Math.abs(x - 10 - lean) < 3.2 ? white : black));
  m.cone(17.6, 10 + lean, 12, 15, 1.4, 0.4, orange, 'z');
  m.set(8 + lean, 19, 12, eye); m.set(12 + lean, 19, 12, eye); m.set(8 + lean, 20, 12, shine); m.set(12 + lean, 20, 12, shine);
  m.set(7 + lean, 17, 12, blush); m.set(13 + lean, 17, 12, blush);
  const fl = f === 3 ? 5 : 0;
  m.line(4, 12, 8, 2 - fl * 0.4, 6 + fl, 9, black, 1); m.line(16, 12, 8, 18 + fl * 0.4, 6 + fl, 9, black, 1);
  m.box(6 + (f === 1 ? -1 : 0), 0, 8, 8 + (f === 1 ? -1 : 0), 0, 11, orange); m.box(12 + (f === 2 ? 1 : 0), 0, 8, 14 + (f === 2 ? 1 : 0), 0, 11, orange);
  return { m, anchors: { head: [10, 23, 8] } };
}
const CRAB_COL = [['#ff5a3a', '#ff9a6a'], ['#bfe8ff', '#ffffff'], ['#8a9aae', '#c8d4e0'], ['#ffd23a', '#fff2a0'], ['#3a3040', '#ff7a2a'], ['#8a5aff', '#5af0ff']];
function buildCrab(f, v) {
  const m = new VoxelModel(26, 16, 16), C = palette(m);
  const [c0, c1] = CRAB_COL[v % CRAB_COL.length];
  const shell = C(c0, glossy), light = C(c1, glossy), eye = C('#ffffff'), pup = C('#141820');
  m.ellipsoid(13, 5, 8, 6.4, 3.4, 4.6, (x, y) => (y > 6.6 ? light : shell));
  for (const s of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const lift = (i + f) % 2 ? 1 : 0, z = 5.5 + i * 2.5;
      m.line(13 + s * 5, 4, z, 13 + s * 8.6, 3 + lift, z, shell, 0.5);
      m.line(13 + s * 8.6, 3 + lift, z, 13 + s * 10, 0, z, shell, 0.4);
    }
    const up = f % 2 && s > 0 ? 1.5 : 0;
    m.line(13 + s * 5, 5, 11, 13 + s * 8, 7 + up, 13, shell, 0.8);
    m.ellipsoid(13 + s * 8.6, 8.4 + up, 13.4, 2.2, 1.8, 1.6, light);
    m.line(13 + s * 1.6, 7.5, 11, 13 + s * 2, 10.5, 11.5, shell, 0.4);
    m.sphere(13 + s * 2, 11.2, 11.6, 1.2, eye); m.set(13 + s * 2, 11, 12.7, pup);
  }
  return { m, anchors: { top: [13, 12, 8] } };
}
function buildJelly(f) {
  const m = new VoxelModel(20, 30, 20), C = palette(m);
  const bell = C('#7af0ff', { emissive: 0.45, jitter: 0, spec: 1.2 }), bell2 = C('#d0a0ff', { emissive: 0.5, jitter: 0 }), rim = C('#ffffff', { emissive: 1, jitter: 0 }), ten = C('#a8f8ff', { emissive: 0.8, jitter: 0 });
  const pulse = [0, 0.8, 1.4, 0.6][f % 4];
  for (let y = 18; y <= 27; y++) for (let z = 0; z < 20; z++) for (let x = 0; x < 20; x++) {
    const yy = (y - 18) / 9, r = (7.6 - pulse * 0.6) * Math.sqrt(Math.max(0, 1 - yy * yy)) + 0.4;
    const d = Math.hypot(x + 0.5 - 10, z + 0.5 - 10);
    if (d <= r && (y > 18 || d > r - 1.6)) m.set(x, y, z, y === 18 ? rim : d < r * 0.5 && y < 23 ? bell2 : bell);
  }
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU, x0 = 10 + Math.cos(a) * 5, z0 = 10 + Math.sin(a) * 5;
    let px = x0, pz = z0;
    for (let y = 17; y > 2; y -= 2) { const nx = x0 + Math.sin(y * 0.4 + f * 1.6 + i) * 1.5, nz = z0 + Math.cos(y * 0.3 + f + i) * 1; m.line(px, y + 2, pz, nx, y, nz, ten, 0.3); px = nx; pz = nz; }
  }
  return { m, anchors: { top: [10, 28, 10] } };
}

// ------------------------------------------------------------------ registry, rendering, cache
export const PROP_DEFS = {
  bench: { build: buildBench, n: 4, vs: 2.3, yaw: 18, pitch: 20 },
  workshop: { build: buildWorkshop, n: 1, vs: 2.3, yaw: 20, pitch: 20 },
  captain: { build: buildCaptain, n: 1, vs: 2.3, yaw: -18, pitch: 18 },
  islet: { build: buildIslet, n: 1, vs: 2.2, yaw: 10, pitch: 24 },
  pier: { build: buildPier, n: 1, vs: 2.2, yaw: 10, pitch: 24 },
  floe: { build: buildFloe, n: 1, vs: 2.2, yaw: 10, pitch: 24 },
  scrap: { build: buildScrap, n: 2, vs: 2.2, yaw: 12, pitch: 22 },
  pontoon: { build: buildPontoon, n: 3, vs: 2.2, yaw: 8, pitch: 20 },
  basalt: { build: buildBasalt, n: 2, vs: 2.2, yaw: 10, pitch: 24 },
  glowrock: { build: buildGlowrock, n: 2, vs: 2.2, yaw: 10, pitch: 24 },
  raft: { build: buildRaft, n: 1, vs: 2.2, yaw: 10, pitch: 24 },
  gull: { build: buildGull, n: 3, vs: 1.6, yaw: 0, pitch: 8, side: true },
  penguin: { build: buildPenguin, n: 4, vs: 2, yaw: 14, pitch: 12 },
  crab: { build: buildCrab, n: 2, vs: 1.8, yaw: 0, pitch: 26 },
  jelly: { build: buildJelly, n: 4, vs: 2, yaw: 0, pitch: 16 },
};

const SPR = new Map();
const vsFor = (def, H) => Math.max(1, Math.round(def.vs * (H / 720) * 8) / 8);
const keyOf = (id, f, v, H) => `${id}|${f}|${v}|${vsFor(PROP_DEFS[id], H)}`;

function renderOne(id, f, v, H) {
  const def = PROP_DEFS[id];
  const B = def.build(f, v);
  const vs = vsFor(def, H);
  const opt = { yaw: def.yaw, pitch: def.pitch, ao: 1, edges: 0.75, sideEdges: 0.5, jitter: 0.06, glowRadius: 2 };
  const lo = renderVoxels(B.m, { ...opt, scale: vs });
  const c = makeCanvas(lo.canvas.width, lo.canvas.height);
  const g = ctxOf(c);
  g.drawImage(lo.canvas, 0, 0);
  if (lo.glow) { g.globalCompositeOperation = 'lighter'; g.globalAlpha = 0.55; g.drawImage(lo.glow, 0, 0); }
  // the 2x twin for the full-res UI layer (aligned on the ground point)
  try {
    const hi = renderVoxels(B.m, { ...opt, scale: vs * 2, outline: true });
    const hc = makeCanvas(c.width * 2, c.height * 2);
    const hg = ctxOf(hc);
    const dx = Math.round(lo.ox * 2 - hi.ox), dy = Math.round(lo.oy * 2 - hi.oy);
    hg.drawImage(hi.canvas, dx, dy);
    if (hi.glow) { hg.globalCompositeOperation = 'lighter'; hg.globalAlpha = 0.55; hg.drawImage(hi.glow, dx, dy); }
    Object.defineProperty(c, 'hi', { value: hc, configurable: true });
  } catch { /* the logical sprite is enough */ }
  // the waterline row and the named anchors, relative to the ground point
  const A = {};
  const [gx, gy] = lo.project(B.m.nx / 2, 0, B.m.nz / 2);
  for (const [k, p] of Object.entries(B.anchors || {})) { const q = lo.project(p[0], p[1], p[2]); A[k] = [q[0] - lo.ox, q[1] - lo.oy]; }
  let sinkDy = 0;
  if (B.sink) { const q = lo.project(B.m.nx / 2, B.sink, B.m.nz * 0.8); sinkDy = q[1] - lo.oy; }
  void gx; void gy;
  return { c, ox: lo.ox, oy: lo.oy + sinkDy, A: Object.fromEntries(Object.entries(A).map(([k, a]) => [k, [a[0], a[1] - sinkDy]])), w: c.width, h: c.height };
}

export function propSprite(id, f = 0, v = 0, H = 720) {
  if (!PROP_DEFS[id]) return null;
  return SPR.get(keyOf(id, f % PROP_DEFS[id].n, v, H)) || null;
}
export function propNow(id, f = 0, v = 0, H = 720) {
  const def = PROP_DEFS[id];
  if (!def) return null;
  const key = keyOf(id, f % def.n, v, H);
  let s = SPR.get(key);
  if (!s) {
    try { s = renderOne(id, f % def.n, v, H); } catch (e) { console.warn('cine prop', id, e); s = null; }
    SPR.set(key, s);
    if (SPR.size > 160) SPR.delete(SPR.keys().next().value);
  }
  return s;
}
export function* prepProps(list, H) {
  for (const [id, v = 0] of list) {
    const def = PROP_DEFS[id];
    if (!def) continue;
    for (let f = 0; f < def.n; f++) {
      if (SPR.has(keyOf(id, f, v, H))) continue;
      propNow(id, f, v, H);
      yield;
    }
  }
}
export function propsReady(list, H) {
  return list.every(([id, v = 0]) => !PROP_DEFS[id] || SPR.has(keyOf(id, 0, v, H)));
}

export function drawProp(ctx, id, f, v, x, y, k, H, o = {}) {
  const s = propSprite(id, f, v, H) || (o.build ? propNow(id, f, v, H) : null);
  if (!s || k <= 0.01) return null;
  const w = s.w * k, h = s.h * k;
  const flip = o.flip ? -1 : 1;
  const a0 = ctx.globalAlpha;
  if (o.alpha != null) ctx.globalAlpha = a0 * o.alpha;
  if (flip < 0) {
    ctx.save();
    ctx.translate(Math.round(x), 0);
    ctx.scale(-1, 1);
    ctx.drawImage(s.c, Math.round(-s.ox * k), Math.round(y - s.oy * k), Math.round(w), Math.round(h));
    ctx.restore();
  } else ctx.drawImage(s.c, Math.round(x - s.ox * k), Math.round(y - s.oy * k), Math.round(w), Math.round(h));
  ctx.globalAlpha = a0;
  const A = {};
  for (const [n, p] of Object.entries(s.A)) A[n] = [x + p[0] * k * flip, y + p[1] * k];
  A.w = w; A.h = h;
  return A;
}
