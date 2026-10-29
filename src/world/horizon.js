// Voxel features that sit on the horizon / sea surface of the surface view: a palm island with a hut, a
// lighthouse islet, a distant sailboat, sea stacks, a channel buoy, the junkyard's industrial skyline (factory,
// smokestacks, gantry cranes, container stacks, pier) and the abyss's dark rock spires and marker buoy.
// Each builder returns { day, dusk, night, ox, oy, w, h, anchors } with atmospheric haze baked per time of day
// (ox, oy = waterline contact point, anchors = canvas-relative points such as lamps and stack tops).

import { VoxelModel } from '../gfx/voxel.js';
import { makeCanvas, ctxOf } from '../core/canvas.js';
import { RNG } from '../core/rng.js';
import { TAU, clamp } from '../core/math.js';
import { renderModel } from './voxkit.js';

// Haze a sprite toward a colour (source-atop) -> new canvas.
export function hazed(src, color, a) {
  const c = makeCanvas(src.width, src.height);
  const g = ctxOf(c);
  g.drawImage(src, 0, 0);
  if (a > 0.004) {
    g.globalCompositeOperation = 'source-atop';
    g.globalAlpha = clamp(a, 0, 1);
    g.fillStyle = color;
    g.fillRect(0, 0, c.width, c.height);
  }
  return c;
}

function finish(m, opts, haze, anchors = {}) {
  const r = renderModel(m, opts);
  const out = { w: r.w, h: r.h, ox: r.ox, oy: r.oy, glow: r.glow, anchors: {} };
  for (const [k, p] of Object.entries(anchors)) { const q = r.project(p[0], p[1], p[2]); out.anchors[k] = [Math.round(q[0]), Math.round(q[1])]; }
  for (const [k, [col, a]] of Object.entries(haze)) out[k] = hazed(r.canvas, col, a);
  out.base = r.canvas;
  return out;
}

// Curved palm trunk with drooping fronds and coconuts.
function palm(m, x, z, h, lean, pal, r) {
  let px = x, py = 0;
  const pts = [];
  for (let i = 0; i <= h; i++) {
    const k = i / h;
    px = x + lean * k * k * h * 0.5;
    py = i;
    pts.push([px, py]);
    m.set(Math.round(px), py, z, i % 3 === 0 ? pal.trunkDark : pal.trunk);
    if (i < h * 0.4) m.set(Math.round(px) + 1, py, z, pal.trunkDark);
  }
  const [tx, ty] = pts[pts.length - 1];
  for (let f = 0; f < 7; f++) {
    const a = (f / 7) * TAU + r.float(-0.2, 0.2);
    const len = r.float(6, 9);
    for (let j = 1; j <= len; j++) {
      const k = j / len;
      const fx = tx + Math.cos(a) * j, fz = z + Math.sin(a) * j * 0.8, fy = ty + 1 + k * 2 - k * k * 5;
      m.set(Math.round(fx), Math.round(fy), Math.round(fz), k > 0.75 ? pal.leafTip : f % 2 ? pal.leaf : pal.leafDark);
    }
  }
  m.set(Math.round(tx), ty, z + 1, pal.coco); m.set(Math.round(tx) + 1, ty - 1, z, pal.coco);
}

export function palmIsland(seed = 4, haze) {
  const r = new RNG(seed);
  const m = new VoxelModel(64, 34, 26);
  const C = (c, o = {}) => m.color(c, o);
  const pal = {
    sand: C('#ecd29a', { jitter: 0.12 }), wetSand: C('#c8a46e', { jitter: 0.1 }), grass: C('#3f9a48', { jitter: 0.18 }), jungle: C('#2a7a3e', { jitter: 0.2 }),
    rock: C('#7c7a8c', { jitter: 0.16 }), trunk: C('#9a6a40', { jitter: 0.1 }), trunkDark: C('#6e4a2c', { jitter: 0.08 }),
    leaf: C('#4cb050', { jitter: 0.12 }), leafDark: C('#2f8a3e', { jitter: 0.1 }), leafTip: C('#8cd468', { jitter: 0.1 }), coco: C('#6a4a2a'),
    wall: C('#d8b47a', { jitter: 0.1 }), thatch: C('#c89a4a', { jitter: 0.18 }), thatchDark: C('#9a6e32', { jitter: 0.1 }), door: C('#4a3020'),
  };
  m.ellipsoid(30, 0, 13, 28, 5, 11, (x, y) => (y <= 1 ? pal.wetSand : pal.sand));
  m.ellipsoid(27, 2, 12, 17, 6, 8, (x, y) => (y > 5 ? pal.grass : pal.jungle));
  m.ellipsoid(44, 1, 10, 6, 4, 5, pal.rock); m.ellipsoid(8, 0, 15, 5, 3, 4, pal.rock); m.ellipsoid(50, 0, 18, 3, 2, 3, pal.rock);
  for (let i = 0; i < 14; i++) m.ellipsoid(r.float(16, 40), r.float(5, 8), r.float(8, 16), r.float(2, 3.5), r.float(1.5, 2.5), r.float(2, 3), pal.jungle);
  // little hut on stilts
  m.box(36, 6, 9, 42, 10, 14, (x, y, z) => (x === 39 && z === 14 && y < 9 ? pal.door : pal.wall));
  for (let y = 11; y <= 15; y++) { const k = y - 11; m.box(35 + k, y, 8 + k * 0.6, 43 - k, y, 15 - k * 0.6, k % 2 ? pal.thatchDark : pal.thatch); }
  palm(m, 22, 12, 22, -0.5, pal, r);
  palm(m, 30, 14, 17, 0.45, pal, r);
  palm(m, 16, 9, 14, -0.2, pal, r);
  return finish(m, { scale: 2, yaw: 24, pitch: 14, jitter: 0.16 }, haze);
}

export function lighthouseIslet(seed = 7, haze) {
  const m = new VoxelModel(34, 56, 22);
  const C = (c, o = {}) => m.color(c, o);
  const rock = C('#6e6c80', { jitter: 0.2 }), rockLight = C('#9a98aa', { jitter: 0.15 }), grass = C('#4a8a4a', { jitter: 0.2 });
  const red = C('#d84a3a', { jitter: 0.06 }), white = C('#f2eee4', { jitter: 0.04 }), metal = C('#3a3e4a'), glass = C('#fff2b0', { emissive: 0.9 }), cap = C('#b03a30');
  const house = C('#e8e2d0'), roof = C('#7a3a30', { jitter: 0.1 });
  m.ellipsoid(16, 0, 11, 15, 7, 10, (x, y) => (y > 5 ? grass : y > 3 ? rockLight : rock));
  m.ellipsoid(6, 0, 14, 6, 4, 5, rock); m.ellipsoid(27, 0, 9, 5, 5, 5, rock);
  m.cone(16, 11, 6, 40, 5, 3.4, (x, y) => (Math.floor((y - 6) / 6) % 2 ? white : red), 'y');
  m.cylinder(16, 11, 41, 41, 5, metal);
  m.cylinder(16, 11, 42, 46, 3, glass);
  m.cone(16, 11, 47, 51, 3.6, 0.5, cap, 'y');
  m.box(5, 6, 6, 11, 10, 14, house);
  for (let y = 11; y <= 13; y++) m.box(4 + (y - 11), y, 6, 12 - (y - 11), y, 14, roof);
  void seed;
  return finish(m, { scale: 1, yaw: 28, pitch: 12, jitter: 0.12 }, haze, { lamp: [16.5, 44, 11.5] });
}

export function sailboat(seed = 9, haze) {
  const m = new VoxelModel(30, 36, 10);
  const C = (c, o = {}) => m.color(c, o);
  const hull = C('#2a5a8a', { jitter: 0.06 }), trim = C('#f0ead8'), sail = C('#fbf6ea', { jitter: 0.04, smooth: 0.3 }), sail2 = C('#e86a4a', { jitter: 0.05 }), mast = C('#6a4a30');
  for (let x = 2; x < 28; x++) {
    const k = Math.abs(x - 14) / 14;
    const yb = Math.round(k * k * 3);
    for (let y = yb; y <= 4; y++) for (let z = 3; z <= 6; z++) m.set(x, y, z, y === 4 ? trim : hull);
  }
  m.box(14, 5, 4, 14, 33, 5, mast);
  for (let y = 7; y <= 31; y++) { const w = Math.round((31 - y) * 0.48); m.box(15, y, 4, 15 + w, y, 4, sail); }
  for (let y = 7; y <= 24; y++) { const w = Math.round((24 - y) * 0.42); m.box(13 - w, y, 5, 13, y, 5, sail2); }
  void seed;
  return finish(m, { scale: 1, yaw: 30, pitch: 8, jitter: 0.1 }, haze);
}

export function seaStacks(seed = 12, haze) {
  const r = new RNG(seed);
  const m = new VoxelModel(70, 44, 20);
  const rock = m.color('#7a7690', { jitter: 0.22 }), rockD = m.color('#5a5670', { jitter: 0.2 }), moss = m.color('#5a8a5a', { jitter: 0.2 }), bird = m.color('#f4f0e8');
  for (let i = 0; i < 4; i++) {
    const x = 10 + i * 16 + r.float(-3, 3), h = r.float(16, 40), w = r.float(4, 7);
    for (let y = 0; y < h; y++) {
      const k = y / h;
      const rr = w * (1 - k * 0.45) + Math.sin(y * 0.7 + i) * 0.8;
      m.cylinder(x, 10, y, y, rr, (xx, yy) => (yy > h - 3 ? moss : (yy + Math.floor(xx)) % 7 === 0 ? rockD : rock));
    }
    m.set(Math.round(x), Math.round(h), 10, bird);
  }
  return finish(m, { scale: 1, yaw: 22, pitch: 10, jitter: 0.18 }, haze);
}

// A tall channel-marker buoy with a light cage (floats near the boat in the surface view).
export function markerBuoy(color = '#e2483a', haze) {
  const m = new VoxelModel(14, 30, 14);
  const C = (c, o = {}) => m.color(c, o);
  const body = C(color, { jitter: 0.06 }), band = C('#f4f0e6'), metal = C('#3c404c'), lamp = C('#fff0a0', { emissive: 1 }), bottom = C('#2a2e3a');
  m.cylinder(7, 7, 0, 2, 5.5, bottom);
  m.cylinder(7, 7, 3, 7, 5.5, (x, y) => (y === 5 ? band : body));
  m.cone(7, 7, 8, 18, 4, 2, body, 'y');
  for (const [dx, dz] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) m.line(7 + dx, 18, 7 + dz, 7 + dx * 0.5, 24, 7 + dz * 0.5, metal, 0);
  m.box(6, 24, 6, 8, 26, 8, lamp);
  m.box(6, 27, 6, 8, 27, 8, metal);
  return finish(m, { scale: 2, yaw: 30, pitch: 14 }, haze || { day: ['#000', 0] }, { lamp: [7.5, 25.5, 7.5], water: [7, 4, 7] });
}

// ---------------------------------------------------------------- junkyard skyline

export function factory(seed = 21, haze) {
  const r = new RNG(seed);
  const m = new VoxelModel(120, 70, 24);
  const C = (c, o = {}) => m.color(c, o);
  const brick = C('#7a4a3a', { jitter: 0.16 }), brickD = C('#5a3a30', { jitter: 0.12 }), conc = C('#8a8a7e', { jitter: 0.14 }), rust = C('#9a5a2e', { jitter: 0.2 }),
    roof = C('#4a4e4a', { jitter: 0.12 }), win = C('#2a2e30'), winLit = C('#ffd27a', { emissive: 0.7 }), stripe = C('#e8e0c8'), metal = C('#5a5e66', { jitter: 0.1 }), tank = C('#a8a49a', { jitter: 0.1 });
  // main hall with sawtooth roof
  m.box(4, 0, 4, 60, 22, 18, (x, y, z) => ((x % 6 === 2) && y > 5 && y < 19 && y % 7 > 2 ? (hash(x, y) < 0.25 ? winLit : win) : y < 3 ? brickD : brick));
  for (let i = 0; i < 7; i++) for (let k = 0; k < 6; k++) m.box(4 + i * 8 + k, 23 + k, 4, 4 + i * 8 + k, 23 + k, 18, k === 5 ? stripe : roof);
  // office block
  m.box(62, 0, 6, 80, 30, 16, (x, y) => ((x % 4 === 1) && y % 6 > 2 && y > 3 ? (hash(x, y) < 0.35 ? winLit : win) : conc));
  m.box(61, 31, 5, 81, 31, 17, roof);
  // smokestacks with bands
  const stacks = [];
  for (const [sx, h] of [[16, 62], [26, 54], [86, 58]]) {
    m.cylinder(sx, 11, 0, h, 3, (x, y) => (y > h - 5 && y < h - 2 ? stripe : (y % 9 === 0 ? brickD : brick)));
    m.cylinder(sx, 11, h + 1, h + 1, 3.6, metal);
    stacks.push([sx + 0.5, h + 2, 11.5]);
  }
  // storage tanks + pipes
  m.cylinder(98, 12, 0, 16, 8, (x, y) => (y === 16 ? metal : tank));
  m.cylinder(112, 12, 0, 12, 6, (x, y) => (y === 12 ? metal : rust));
  m.line(80, 14, 11, 98, 14, 11, metal, 1);
  m.line(60, 8, 18, 96, 8, 18, rust, 0.8);
  void r;
  return finish(m, { scale: 1, yaw: 20, pitch: 10, jitter: 0.16 }, haze, Object.fromEntries(stacks.map((p, i) => ['stack' + i, p])));
}

function hash(x, y) { return (((x * 73856093) ^ (y * 19349663)) >>> 0) % 1000 / 1000; }

export function gantryCrane(seed = 23, haze) {
  const m = new VoxelModel(90, 70, 16);
  const C = (c, o = {}) => m.color(c, o);
  const yel = C('#e0a83a', { jitter: 0.1 }), yelD = C('#b07a2a', { jitter: 0.1 }), cab = C('#4a6a8a'), cable = C('#2a2a30'), hook = C('#3a3e48'), lamp = C('#ff4a3a', { emissive: 1 });
  // legs (A-frame) + boom
  for (const z of [3, 12]) { m.line(20, 0, z, 26, 54, z, yel, 1); m.line(40, 0, z, 30, 54, z, yel, 1); }
  for (let y = 6; y < 54; y += 8) m.line(20 + y * 0.11, y, 3, 20 + y * 0.11, y, 12, yelD, 0);
  m.box(4, 54, 3, 88, 57, 12, (x, y, z) => ((x % 4 === 0 || y === 54 || y === 57) && (z === 3 || z === 12) ? yel : (z === 3 || z === 12) && (x + y) % 4 === 0 ? yelD : null));
  m.box(4, 54, 4, 88, 54, 11, yelD);
  m.box(22, 58, 5, 32, 63, 10, cab);
  m.line(70, 54, 7, 70, 30, 7, cable, 0);
  m.box(68, 26, 6, 72, 29, 9, hook);
  m.set(88, 58, 7, lamp); m.set(4, 58, 7, lamp);
  void seed;
  return finish(m, { scale: 1, yaw: 16, pitch: 10, jitter: 0.12 }, haze, { lampR: [88.5, 58.5, 7.5], lampL: [4.5, 58.5, 7.5] });
}

export function containerStack(seed = 25, haze) {
  const r = new RNG(seed);
  const m = new VoxelModel(80, 30, 22);
  const cols = ['#c84a3a', '#3a7ac8', '#3aa86a', '#e0a83a', '#8a5ac8', '#d87a3a', '#5a6a7a'].map((c) => m.color(c, { jitter: 0.08 }));
  const dark = cols.map((c) => m.color(m.palette[c].color, { jitter: 0.04, light: -1.1 }));
  const pier = m.color('#5a4a3a', { jitter: 0.12 }), post = m.color('#3a2e26');
  m.box(0, 0, 2, 79, 2, 20, pier);
  for (let x = 2; x < 80; x += 8) m.box(x, 0, 18, x + 1, 2, 19, post);
  for (let row = 0; row < 3; row++) {
    const n = 4 - row;
    for (let i = 0; i < n; i++) {
      const ci = r.int(0, cols.length - 1);
      const x0 = 4 + i * 18 + row * 8 + r.int(-2, 2), y0 = 3 + row * 8, z0 = 4 + r.int(0, 3);
      m.box(x0, y0, z0, x0 + 16, y0 + 7, z0 + 9, (x, y, z) => ((x - x0) % 2 === 0 && x > x0 && x < x0 + 16 ? dark[ci] : cols[ci]));
    }
  }
  return finish(m, { scale: 1, yaw: 24, pitch: 12, jitter: 0.1 }, haze);
}

// ---------------------------------------------------------------- abyss surface

export function rockSpires(seed = 31, haze) {
  const r = new RNG(seed);
  const m = new VoxelModel(110, 60, 24);
  const rock = m.color('#2e3450', { jitter: 0.25 }), rockL = m.color('#46507a', { jitter: 0.2 }), ice = m.color('#9ab8e8', { jitter: 0.15 });
  for (let i = 0; i < 6; i++) {
    const x = 10 + i * 17 + r.float(-4, 4), h = r.float(18, 54), w = r.float(5, 9);
    for (let y = 0; y < h; y++) {
      const k = y / h;
      const rr = w * Math.pow(1 - k, 0.7) + 0.6;
      m.cylinder(x + Math.sin(y * 0.2 + i) * 1.5, 12, y, y, rr, (xx, yy) => (yy > h - 4 ? ice : (Math.floor(yy / 3) + i) % 4 === 0 ? rockL : rock));
    }
  }
  return finish(m, { scale: 1, yaw: 18, pitch: 8, jitter: 0.2 }, haze);
}

// A long low scrap-heap ridge for the junkyard horizon (yaw 0 so it stays level across the screen).
export function junkRidge(W, seed = 27, haze) {
  const r = new RNG(seed);
  const nx = W + 24, ny = 30, nz = 18;
  const m = new VoxelModel(nx, ny, nz);
  const cols = ['#7a6a5a', '#6a6e78', '#8a5a3e', '#5a6a5a', '#9a8a6a', '#4a5e7a', '#8a3e34', '#6e6a5e'].map((c) => m.color(c, { jitter: 0.2 }));
  const dirt = m.color('#5a5446', { jitter: 0.2 });
  const H = new Float32Array(nx);
  for (let x = 0; x < nx; x++) H[x] = 5 + Math.sin(x * 0.021 + 1.3) * 3 + Math.sin(x * 0.063 + 0.4) * 2 + Math.sin(x * 0.17) * 0.8;
  for (let x = 0; x < nx; x++) for (let z = 0; z < nz; z++) {
    const h = Math.round(H[x] * (0.6 + 0.4 * Math.sin((z / nz) * Math.PI)));
    for (let y = 0; y < h; y++) m.set(x, y, z, dirt);
  }
  for (let i = 0; i < nx / 5; i++) {
    const x = r.int(2, nx - 3), z = r.int(2, nz - 4), base = Math.round(H[x]) - 2;
    const c = r.pick(cols), k = r.next();
    if (k < 0.45) { const w = r.int(2, 6), h = r.int(2, 5), d = r.int(2, 4); m.box(x, base, z, x + w, base + h, z + d, c); }
    else if (k < 0.65) m.cylinder(x, z, base, base + r.int(3, 6), r.float(1.2, 2.2), c);
    else if (k < 0.8) { for (let a = 0; a < TAU; a += 0.4) m.set(x + Math.cos(a) * 2.2, base + 2 + Math.sin(a) * 2.2, z, cols[1]); }
    else m.line(x, base, z, x + r.int(-4, 4), base + r.int(5, 12), z + r.int(-2, 2), c, 0);
  }
  return finish(m, { scale: 1, yaw: 0, pitch: 14, jitter: 0.2 }, haze);
}
