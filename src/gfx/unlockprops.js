// [hot26] Little buildable voxel props that unlock hotbar buttons (src/game/hotbar.js). Registered into PROPS by
// props.js (UNLOCK_PROPS: id -> {meta, build}), so they render, thumbnail and place like any other tank decor.
//   research_bench  The Lab        a glossy lab desk: bubbling green flask, microscope, test-tube rack
//   bookshelf       FishDex        a wooden shelf of colourful books, a fish trophy on top
//   tackle_box      Bait           an open green tackle box with trays of lures
//   vanity_mirror   Wardrobe       an oval standing mirror on a gold frame
//   net_rack        My Fish        a wooden rack with a hanging landing net and a bucket
//   workbench       Workshop       a wooden bench with a vise, a pegboard of tools
// Models face +z (the front) like every prop; the tank renders them at yaw 0. decor.price = the price of another copy
// once the button is unlocked (the unlock price itself is HOTBAR_UNLOCKS[id].price).

import { VoxelModel } from './voxel.js';

// rounded box from its signed distance (r = corner radius)
function rbox(m, x0, y0, z0, x1, y1, z1, r, c) {
  const cx = (x0 + x1 + 1) / 2, cy = (y0 + y1 + 1) / 2, cz = (z0 + z1 + 1) / 2;
  const hx = (x1 + 1 - x0) / 2 - r, hy = (y1 + 1 - y0) / 2 - r, hz = (z1 + 1 - z0) / 2 - r;
  for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
    const qx = Math.abs(x + 0.5 - cx) - hx, qy = Math.abs(y + 0.5 - cy) - hy, qz = Math.abs(z + 0.5 - cz) - hz;
    if (Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0) <= r) m.put(x, y, z, c);
  }
}
const h3 = (x, y, z, s = 0) => {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647 + s * 1442695041) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

const DEFS = {};
const def = (id, meta, build) => { DEFS[id] = { meta: { biome: 'aquarium', decorOnly: true, ...meta }, build }; };

// ------------------------------------------------------------------ Research Bench (The Lab)
def('research_bench', {
  name: 'Research Bench', tags: ['unlock', 'glow', 'machine'], decor: { price: 90, size: 2 },
  desc: 'Professor Fizz\'s travel lab. Bubbling flasks, a microscope and a very serious clipboard.',
}, () => {
  const m = new VoxelModel(60, 54, 30);
  const top = [m.color('#f4fbff', { smooth: 0.7, spec: 1.6, specPow: 9 }), m.color('#d8eef8', { smooth: 0.6 })];
  const body = m.color('#3ab8e8', { smooth: 0.65, spec: 1.8, specPow: 10, jitter: 0.02 });
  const bodyD = m.color('#2486c4', { smooth: 0.5 });
  const leg = m.color('#c8d4e0', { smooth: 0.6, spec: 2.2, specPow: 12 });
  const knob = m.color('#ffd84a', { smooth: 0.6, spec: 2 });
  const glass = m.color('#e8fbff', { smooth: 0.8, spec: 2.6, specPow: 14, light: 0.2 });
  const goo = m.color('#7aff6a', { emissive: 0.7, smooth: 0.5 });
  const gooD = m.color('#3ad84a', { emissive: 0.45 });
  const bub = m.color('#e8ffe0', { emissive: 0.8 });
  const dark = m.color('#2a3442', { smooth: 0.5 });
  const scope = m.color('#ffffff', { smooth: 0.7, spec: 2 });
  const tubes = ['#ff6a8a', '#ffd23a', '#5ad0ff', '#b88aff'].map((c) => m.color(c, { emissive: 0.35, smooth: 0.5 }));
  const paper = m.color('#fffbe8', { smooth: 0.4 });
  const ink = m.color('#4a6aa8');
  // the desk: a glossy aqua cabinet with a drawer on the left, open legs on the right, a white worktop
  rbox(m, 4, 3, 6, 26, 22, 25, 2, body);
  m.box(6, 13, 26, 24, 13, 26, bodyD); // drawer seam
  m.box(13, 17, 26, 17, 18, 27, knob); m.box(13, 7, 26, 17, 8, 27, knob);
  for (const [x, z] of [[50, 8], [50, 23], [30, 8], [30, 23]]) m.box(x, 0, z, x + 2, 22, z + 2, leg);
  m.box(4, 0, 7, 26, 2, 24, bodyD);
  m.box(30, 6, 8, 52, 7, 25, leg); // a low shelf
  rbox(m, 2, 23, 4, 56, 26, 27, 1, top[0]);
  m.box(2, 23, 27, 56, 23, 27, top[1]);
  // a round-bottom flask of glowing goo with a stopper and bubbles rising out of the neck
  m.sphere(13, 33, 15, 6.5, glass);
  m.paint(() => { for (let y = 27; y <= 33; y++) for (let z = 8; z <= 22; z++) for (let x = 6; x <= 20; x++) m.put(x, y, z, y >= 33 ? gooD : goo); });
  m.cylinder(13, 15, 38, 44, 2, glass);
  m.cylinder(13, 15, 45, 46, 2.4, dark);
  m.sphere(12, 49, 16, 1.2, bub); m.sphere(15, 52, 15, 0.9, bub);
  // microscope: base, arm, tube, eyepiece
  m.box(24, 27, 10, 32, 28, 18, dark);
  m.box(29, 29, 12, 31, 40, 14, scope);
  m.line(29, 40, 13, 24, 44, 15, scope, 1.3);
  m.cylinder(24, 15, 37, 44, 1.6, dark);
  m.box(23, 31, 13, 26, 31, 17, glass); // stage slide
  m.cylinder(24, 15, 45, 46, 2, dark);
  // a test-tube rack with four coloured tubes
  m.box(38, 27, 12, 52, 28, 18, leg);
  m.box(38, 32, 12, 52, 32, 18, leg);
  tubes.forEach((c, i) => {
    const x = 40 + i * 3.4;
    m.cylinder(x, 15, 29, 38 - (i % 2) * 2, 1.1, glass);
    m.cylinder(x, 15, 29, 33 - (i % 2) * 1, 1.1, c);
  });
  // a clipboard leaning at the front edge
  m.box(42, 27, 21, 51, 27, 25, paper);
  for (let i = 0; i < 3; i++) m.box(44, 27, 22 + i, 49 - (i % 2) * 2, 27, 22 + i, ink);
  void h3;
  return { m, yaw: 24, pitch: 24, ground: [29, 0, 16], anchors: { top: [13, 47, 15] }, light: '#7aff6a' };
});

// ------------------------------------------------------------------ Bookshelf (FishDex)
def('bookshelf', {
  name: 'Bookshelf', tags: ['unlock', 'home'], decor: { price: 80, size: 1 },
  desc: 'Every fish book ever written. Mostly picture books. Fish cannot read.',
}, () => {
  const m = new VoxelModel(42, 70, 20);
  const wood = [m.color('#b0703c', { jitter: 0.05, smooth: 0.4 }), m.color('#8e5630', { jitter: 0.04 }), m.color('#cf9258', { smooth: 0.5 })];
  const back = m.color('#6a4428', { jitter: 0.04 });
  const cols = ['#ff6a6a', '#3ab8e8', '#ffd23a', '#7ad84a', '#b88aff', '#ff9a3a', '#ffffff', '#38c8b8'].map((c) => m.color(c, { smooth: 0.55, spec: 1.2 }));
  const gold = m.color('#ffd23a', { smooth: 0.7, spec: 2.6, specPow: 12 });
  const fish = m.color('#ff9a3a', { smooth: 0.6, spec: 1.6 });
  // the case: sides, back, shelves, a crown moulding
  m.box(3, 0, 3, 38, 54, 4, back);
  for (const x of [2, 37]) m.box(x, 0, 3, x + 2, 55, 17, wood[0]);
  for (const y of [0, 18, 36, 53]) m.box(2, y, 3, 39, y + 1, 17, y === 53 ? wood[2] : wood[0]);
  m.box(1, 56, 2, 40, 57, 18, wood[2]);
  m.box(2, 0, 17, 39, 1, 17, wood[1]);
  // books: varied heights and colours, a couple leaning
  for (const [y0, seed] of [[2, 1], [20, 2], [38, 3]]) {
    let x = 5;
    let i = 0;
    while (x < 35) {
      const w = 2 + Math.floor(h3(x, y0, seed) * 2.2);
      const h = 10 + Math.floor(h3(x, seed, y0) * 6);
      const c = cols[Math.floor(h3(i, seed, 7) * cols.length)];
      if (x + w > 36) break;
      if (h3(x, y0, seed + 9) < 0.12 && x < 30) { // a leaning book
        for (let k = 0; k < h; k++) m.box(x + Math.floor(k * 0.4), y0 + k, 6, x + Math.floor(k * 0.4) + w - 1, y0 + k, 15, c);
        x += w + 5;
      } else {
        m.box(x, y0, 6, x + w - 1, y0 + h - 1, 15, c);
        m.box(x, y0 + h - 3, 16, x + w - 1, y0 + h - 3, 16, gold); // a gilt band on the spine
        x += w;
      }
      i++;
    }
  }
  // a little gold fish trophy on top
  m.box(17, 58, 7, 24, 59, 13, gold);
  m.box(19, 60, 9, 22, 61, 11, gold);
  m.ellipsoid(20, 65, 10, 4, 2.6, 2, fish);
  m.box(24, 64, 10, 26, 67, 10, fish);
  return { m, yaw: 22, pitch: 22, ground: [20, 0, 10] };
});

// ------------------------------------------------------------------ Tackle Box (Bait)
def('tackle_box', {
  name: 'Tackle Box', tags: ['unlock', 'toy'], decor: { price: 60, size: 1 },
  desc: 'Trays of shiny lures and squishy worms. Organised by vibe.',
}, () => {
  const m = new VoxelModel(48, 40, 30);
  const shell = m.color('#4ac85a', { smooth: 0.65, spec: 1.8, specPow: 10, jitter: 0.02 });
  const shellD = m.color('#2e9a48', { smooth: 0.5 });
  const tray = m.color('#e8f6ff', { smooth: 0.6, spec: 1.4 });
  const latch = m.color('#ffd23a', { smooth: 0.7, spec: 2.4 });
  const handle = m.color('#2a3442', { smooth: 0.5 });
  const lures = ['#ff4a6a', '#ffd23a', '#3ab8e8', '#ff9a3a', '#b88aff', '#ffffff'].map((c) => m.color(c, { smooth: 0.6, spec: 2, emissive: 0.15 }));
  const hook = m.color('#c8d4e0', { spec: 2.6, specPow: 14 });
  const worm = m.color('#ff8aa8', { smooth: 0.5 });
  // the box: body, a lid flipped open at the back, a handle
  rbox(m, 4, 0, 6, 43, 14, 25, 2, shell);
  m.box(4, 0, 25, 43, 1, 25, shellD);
  m.box(20, 10, 26, 27, 12, 26, latch);
  rbox(m, 4, 15, 1, 43, 33, 5, 2, shell); // the open lid stands up at the back
  m.box(8, 18, 6, 39, 30, 6, shellD);
  m.box(16, 34, 2, 31, 35, 4, handle); m.box(16, 31, 2, 17, 34, 4, handle); m.box(30, 31, 2, 31, 34, 4, handle);
  // cantilever trays fanned out over the front, full of lures
  for (const [y, z0] of [[15, 9], [19, 15]]) {
    m.box(6, y, z0, 41, y + 1, z0 + 8, tray);
    for (let x = 6; x <= 41; x += 7) m.box(x, y + 2, z0, x, y + 3, z0 + 8, tray);
    for (let c = 0; c < 5; c++) {
      const col = lures[(c + y) % lures.length];
      const lx = 9 + c * 7;
      m.ellipsoid(lx, y + 3, z0 + 4, 2.2, 1.3, 1.3, col);
      m.set(lx + 2, y + 3, z0 + 4, hook); m.set(lx + 3, y + 2, z0 + 4, hook);
    }
  }
  // a wriggly worm hanging over the edge
  m.tube([[36, 20, 24, 0.9], [38, 17, 27, 0.9], [37, 12, 28, 0.9], [39, 9, 28, 0.9]], worm, 4);
  return { m, yaw: 22, pitch: 26, ground: [24, 0, 15] };
});

// ------------------------------------------------------------------ Mirror (Wardrobe)
def('vanity_mirror', {
  name: 'Mirror', tags: ['unlock', 'fancy'], decor: { price: 90, size: 1 },
  desc: 'Mirror, mirror, in the tank. Who is the shiniest? (It is always you.)',
}, () => {
  const m = new VoxelModel(36, 64, 16);
  const gold = [m.color('#ffd23a', { smooth: 0.75, spec: 2.8, specPow: 12 }), m.color('#e0a020', { smooth: 0.6, spec: 1.8 })];
  const glass = m.color('#d8f6ff', { smooth: 0.95, spec: 3, specPow: 18, light: 0.25 });
  const glint = m.color('#ffffff', { emissive: 0.6, smooth: 0.9 });
  const wood = m.color('#b0703c', { jitter: 0.04, smooth: 0.4 });
  const gem = m.color('#ff7ab4', { emissive: 0.35, smooth: 0.8, spec: 2.4 });
  const cx = 18, cy = 38, rx = 12.5, ry = 19;
  // oval frame + glass
  for (let y = 0; y < 64; y++) for (let x = 0; x < 36; x++) {
    const d = ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2;
    if (d <= 1) {
      const rim = ((x + 0.5 - cx) / (rx - 2.2)) ** 2 + ((y + 0.5 - cy) / (ry - 2.2)) ** 2 > 1;
      if (rim) m.box(x, y, 6, x, y, 9, h3(x, y, 3) < 0.15 ? gold[1] : gold[0]);
      else {
        m.box(x, y, 6, x, y, 8, wood);
        const s = x - cx + (y - cy) * 0.55; // two diagonal highlight streaks
        m.set(x, y, 9, (s > -6 && s < -3) || (s > 1 && s < 2.5) ? glint : glass);
      }
    }
  }
  m.sphere(cx, cy + ry + 1, 8, 2.2, gem); // a heart gem on the crest
  m.box(cx - 3, cy + ry - 1, 7, cx + 3, cy + ry, 9, gold[0]);
  // the stand: two gold legs on little feet
  for (const s of [-1, 1]) {
    m.line(cx + s * 8, cy - 15, 7, cx + s * 11, 1, 7, gold[0], 1.1);
    m.box(cx + s * 11 - 2, 0, 4, cx + s * 11 + 2, 1, 11, gold[1]);
  }
  return { m, yaw: 18, pitch: 18, ground: [cx, 0, 8] };
});

// ------------------------------------------------------------------ Net Rack (My Fish)
def('net_rack', {
  name: 'Net Rack', tags: ['unlock', 'home'], decor: { price: 70, size: 1 },
  desc: 'A landing net and a bucket. For gently moving fish about. Very gently.',
}, () => {
  const m = new VoxelModel(46, 58, 22);
  const wood = [m.color('#b0703c', { jitter: 0.05, smooth: 0.4 }), m.color('#8e5630', { jitter: 0.04 })];
  const rope = m.color('#f0e0b0', { smooth: 0.3 });
  const hoop = m.color('#3ab8e8', { smooth: 0.7, spec: 2.2, specPow: 10 });
  const mesh = m.color('#e8f6ff', { smooth: 0.4, light: 0.1 });
  const pail = m.color('#ff9a3a', { smooth: 0.65, spec: 1.8 });
  const pailD = m.color('#d86a20', { smooth: 0.5 });
  const water = m.color('#5ad8ff', { emissive: 0.25, smooth: 0.8, spec: 2 });
  const fin = m.color('#ffd23a', { smooth: 0.6 });
  // the rack: a post on a cross foot with an arm and a peg
  m.box(6, 0, 8, 9, 52, 11, wood[0]);
  m.box(1, 0, 8, 14, 2, 11, wood[1]); m.box(6, 0, 3, 9, 2, 16, wood[1]);
  m.box(6, 50, 8, 30, 53, 11, wood[0]);
  m.box(28, 46, 9, 29, 49, 10, rope);
  // the landing net hangs from the arm: handle down to a hoop, a mesh bag below it
  m.line(28.5, 46, 10, 28.5, 34, 10, wood[1], 0.9);
  for (let a = 0; a < 64; a++) {
    const t = (a / 64) * Math.PI * 2;
    m.set(28.5 + Math.cos(t) * 8, 26 + Math.sin(t) * 7, 10, hoop);
    m.set(28.5 + Math.cos(t) * 8, 26 + Math.sin(t) * 7, 11, hoop);
  }
  for (let y = 9; y <= 26; y++) {
    const r = 7.5 * Math.sqrt(Math.max(0, (y - 8) / 18));
    for (let x = Math.ceil(28.5 - r); x <= Math.floor(28.5 + r); x++) if ((x + y) % 2 === 0) m.set(x, y, 10, mesh);
  }
  // a bucket with water and a happy fish tail poking out
  m.cylinder(38, 15, 0, 11, 6, pail);
  m.cylinder(38, 15, 0, 1, 6, pailD);
  m.cylinder(38, 15, 10, 11, 6.5, pailD);
  m.cylinder(38, 15, 9, 10, 5, water);
  m.box(37, 11, 15, 39, 14, 15, fin); m.box(36, 14, 15, 40, 14, 15, fin);
  return { m, yaw: 22, pitch: 24, ground: [22, 0, 12] };
});

// ------------------------------------------------------------------ Workbench (Workshop)
def('workbench', {
  name: 'Workbench', tags: ['unlock', 'build'], decor: { price: 120, size: 2 },
  desc: 'Marina\'s spare bench: a vise, a mallet and a pegboard of very organised tools.',
}, () => {
  const m = new VoxelModel(60, 56, 28);
  const wood = [m.color('#c8884a', { jitter: 0.05, smooth: 0.45 }), m.color('#9a6236', { jitter: 0.04 }), m.color('#e0a868', { smooth: 0.5 })];
  const board = m.color('#e8d8b8', { smooth: 0.3 });
  const hole = m.color('#a89878');
  const steel = m.color('#c8d4e0', { smooth: 0.7, spec: 2.6, specPow: 12 });
  const red = m.color('#ff5a4a', { smooth: 0.6, spec: 1.8 });
  const blue = m.color('#3ab8e8', { smooth: 0.6, spec: 1.8 });
  const yel = m.color('#ffd23a', { smooth: 0.6, spec: 1.8 });
  const dark = m.color('#2a3442', { smooth: 0.5 });
  // legs, a stretcher shelf, a thick top
  for (const [x, z] of [[5, 7], [5, 22], [52, 7], [52, 22]]) m.box(x, 0, z, x + 3, 21, z + 3, wood[1]);
  m.box(5, 6, 8, 55, 7, 24, wood[0]);
  for (let x = 2; x <= 57; x++) m.box(x, 22, 4, x, 25, 26, (x % 9 === 0) ? wood[1] : wood[x % 2 ? 0 : 2]);
  // a pegboard at the back with tools hanging on it
  m.box(6, 26, 3, 53, 52, 4, board);
  for (let y = 29; y <= 50; y += 3) for (let x = 9; x <= 51; x += 3) m.set(x, y, 5, hole);
  m.box(6, 52, 3, 53, 53, 5, wood[1]);
  // wrench, saw, screwdriver and a hammer on the pegboard
  m.line(12, 46, 5, 12, 33, 5, steel, 0.9); m.box(10, 46, 5, 14, 49, 5, steel); m.box(11, 48, 5, 13, 49, 6, board);
  m.box(19, 36, 5, 31, 41, 5, steel); m.box(31, 35, 5, 35, 42, 6, red);
  for (let x = 19; x <= 31; x += 2) m.set(x, 35, 5, steel);
  m.line(41, 47, 5, 41, 39, 5, steel, 0.6); m.box(40, 32, 5, 42, 38, 6, blue);
  m.box(46, 45, 5, 51, 48, 6, steel); m.line(48.5, 44, 5, 48.5, 32, 5, yel, 0.9);
  // a vise on the front left corner
  m.box(6, 26, 18, 16, 29, 25, steel);
  m.box(6, 30, 18, 8, 34, 25, steel); m.box(14, 30, 18, 16, 34, 25, steel);
  m.line(11, 28, 26, 11, 28, 28, dark, 0.7); m.box(8, 27, 28, 14, 28, 28, dark);
  // a mallet and a few nails on the top
  m.box(30, 26, 14, 36, 30, 20, wood[2]); m.line(33, 28, 20, 33, 28, 26, wood[1], 0.8);
  for (const x of [42, 45, 47]) m.box(x, 26, 18 + (x % 3), x, 27, 18 + (x % 3), steel);
  return { m, yaw: 24, pitch: 24, ground: [30, 0, 15] };
});

export const UNLOCK_PROPS = DEFS;
