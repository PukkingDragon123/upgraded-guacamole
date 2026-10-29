// Voxel item art: tiny hand-built models for materials, samples, eggs, coins, blueprint scrolls and the
// package tiers (crate / iron crate / golden chest / mystery orb), rendered by voxel.js into crisp sprites.
//
// itemSprite(artId, {scale, frame}) -> {canvas, glow, ox, oy, w, h} | null   (frame 0..SPIN-1 = turntable yaw)
//   Renders are budgeted (a few ms per 16 ms window); while over budget the nearest cached frame is returned.
// packageParts(tier, scale, frame) -> {body, lid, ox, oy, w, h, lidY}  same framing, lid split for unboxing.
// ART_IDS: ids with a model. SPIN: number of turntable frames.

import { VoxelModel, renderVoxels } from '../gfx/voxel.js';
import { hash3, clamp } from '../core/math.js';

export const SPIN = 16;
const h3 = (x, y, z, s = 0) => hash3(x, y, z, s);

function shape(m, x0, y0, z0, x1, y1, z1, test, c) {
  for (let y = Math.floor(y0); y <= Math.ceil(y1); y++) for (let z = Math.floor(z0); z <= Math.ceil(z1); z++) for (let x = Math.floor(x0); x <= Math.ceil(x1); x++) {
    if (test(x + 0.5, y + 0.5, z + 0.5)) m.put(x, y, z, c);
  }
}

// ---------------------------------------------------------------- materials

const MODELS = {
  driftwood() {
    const m = new VoxelModel(22, 9, 12);
    const wood = [m.color('#a89078', { jitter: 0.12, smooth: 0.6 }), m.color('#8a7460', { jitter: 0.12, smooth: 0.6 }), m.color('#c8b49a', { jitter: 0.08, smooth: 0.6 })];
    const knot = m.color('#5a4636', { jitter: 0.05 });
    const pts = [[1.5, 3.5, 6, 2.6], [6, 4, 5.5, 3.2], [11, 4.2, 6.5, 3.3], [16, 3.8, 6, 2.8], [20.5, 4.6, 5, 2]];
    m.tube(pts, (x, y, z) => (h3(x >> 1, y, z, 3) < 0.25 ? wood[1] : (y + (x >> 2)) % 4 === 0 ? wood[2] : wood[0]));
    m.line(13, 6, 6, 15, 8, 4, wood[0], 1);
    m.set(8, 7, 7, knot); m.set(9, 7, 7, knot); m.set(17, 6, 8, knot);
    m.sub(() => { m.set(0, 3, 6, 0); m.set(0, 4, 6, 0); });
    m.recolor((x, y, z, p) => (p === wood[0] && x === 0 ? wood[2] : null));
    return { m, yaw: 24 };
  },
  kelp_fibre() {
    const m = new VoxelModel(16, 14, 16);
    const g = [m.color('#4f9a52', { jitter: 0.1, smooth: 0.5 }), m.color('#6cbf5a', { jitter: 0.1, smooth: 0.5 }), m.color('#3a7a46', { jitter: 0.1 })];
    const tie = m.color('#d8b878', { jitter: 0.05 });
    for (let y = 0; y < 12; y++) {
      const r = 5.2 - Math.abs(y - 5.5) * 0.25;
      m.cylinder(8, 8, y, y, r, (x, yy, z) => {
        const a = Math.atan2(z - 8, x - 8);
        const k = Math.floor((a * 3 + yy * 0.7) * 1.2) & 3;
        return k === 0 ? g[1] : k === 2 ? g[2] : g[0];
      });
    }
    m.sub(() => m.cylinder(8, 8, 0, 11, 2, 0));
    for (const y of [3, 8]) m.paint(() => m.cylinder(8, 8, y, y, 6, (x, yy, z) => (m.exposed(x, yy, z) ? tie : null)));
    m.line(13, 11, 8, 15, 13, 9, g[1], 0.6); m.line(4, 11, 6, 2, 13, 5, g[0], 0.6);
    return { m, yaw: 30, pitch: 34 };
  },
  shell() {
    const m = new VoxelModel(16, 8, 15);
    const c = [m.color('#f6c0b0', { smooth: 0.7, spec: 0.4 }), m.color('#e88a86', { smooth: 0.7 }), m.color('#fff0e6', { smooth: 0.7 })];
    shape(m, 0, 0, 0, 15, 7, 14, (x, y, z) => {
      const dx = x - 8, dz = z - 2;
      const r = Math.hypot(dx, dz);
      if (dz < -0.5 || r > 7.5) return false;
      const a = Math.atan2(dz, dx);
      if (a < 0.1 || a > Math.PI - 0.1) return false;
      const ridge = Math.cos(a * 11) * 0.7;
      return y < 1 + (7.5 - r) * 0.55 + ridge * (r / 7.5) && y >= 0;
    }, (x, y, z) => {
      const a = Math.atan2(z - 2, x - 8);
      return Math.cos(a * 11) > 0.3 ? c[2] : Math.hypot(x - 8, z - 2) > 6 ? c[1] : c[0];
    });
    m.box(6, 0, 0, 10, 2, 2, c[1]);
    return { m, yaw: 18, pitch: 40 };
  },
  sea_glass() {
    const m = new VoxelModel(16, 8, 14);
    const cols = [['#5ad0b4', '#9af0d8'], ['#6aa8e8', '#b0dcff'], ['#a8e86a', '#dcffa8']];
    const pieces = [[5, 2.2, 6, 4, 2.2, 3.2, 0], [11, 1.8, 8, 3, 1.8, 2.6, 1], [7, 1.5, 11, 2.4, 1.5, 2, 2]];
    for (const [x, y, z, rx, ry, rz, k] of pieces) {
      const a = m.color(cols[k][0], { smooth: 0.9, spec: 1, specPow: 6, emissive: 0.15 }), b = m.color(cols[k][1], { smooth: 0.9, spec: 1, emissive: 0.2 });
      m.ellipsoid(x, y, z, rx, ry, rz, (xx, yy, zz) => (yy > y && h3(xx, yy, zz, k) < 0.3 ? b : a));
    }
    return { m, yaw: 26, pitch: 38 };
  },
  coral_chunk() {
    const m = new VoxelModel(16, 16, 14);
    const c = [m.color('#ff7a8a', { smooth: 0.6, jitter: 0.08 }), m.color('#ffb0a0', { smooth: 0.6 }), m.color('#d8505e', { smooth: 0.5 })];
    const base = m.color('#c8b090', { jitter: 0.12 });
    m.ellipsoid(8, 1.5, 7, 6, 2, 5, base);
    const br = [[8, 2, 7, 6, 13, 6], [8, 6, 7, 12, 11, 8], [7, 8, 6, 3, 14, 5], [9, 4, 7, 13, 6, 10], [6, 4, 8, 2, 8, 10]];
    for (const [x0, y0, z0, x1, y1, z1] of br) {
      m.line(x0, y0, z0, x1, y1, z1, c[0], 1.3);
      m.sphere(x1, y1, z1, 1.5, c[1]);
    }
    m.recolor((x, y, z, p) => (p === c[0] && h3(x, y, z, 2) < 0.15 ? c[2] : null));
    return { m, yaw: 30 };
  },
  pearl() {
    const m = new VoxelModel(16, 10, 14);
    const shell = [m.color('#d8c8e8', { smooth: 0.8 }), m.color('#a890c0', { smooth: 0.7 })];
    const pearl = m.color('#fff6fa', { smooth: 1, spec: 1, specPow: 5, light: 0.2 });
    shape(m, 0, 0, 0, 15, 3, 13, (x, y, z) => Math.hypot((x - 8) / 7, (z - 7) / 6) < 1 && y < 1 + (1 - Math.hypot((x - 8) / 7, (z - 7) / 6)) * 2.5, (x, y, z) => (Math.floor(Math.atan2(z - 7, x - 8) * 4) & 1 ? shell[0] : shell[1]));
    m.sub(() => m.ellipsoid(8, 3, 7, 5.5, 2, 4.5));
    m.sphere(8, 4.5, 7, 3.4, pearl);
    return { m, yaw: 22, pitch: 36 };
  },
  scrap_metal() {
    const m = new VoxelModel(16, 10, 14);
    const steel = [m.color('#8a94a8', { jitter: 0.1, spec: 0.5 }), m.color('#6a7286', { jitter: 0.1 }), m.color('#b8c2d0', { spec: 0.8 })];
    const rust = [m.color('#b0602e', { jitter: 0.15 }), m.color('#d8884a', { jitter: 0.1 })];
    const rivet = m.color('#dfe6ee', { spec: 1 });
    // two bent plates and a bolt
    shape(m, 1, 0, 1, 12, 3, 12, (x, y, z) => y < 1.6 + Math.sin(x * 0.4) * 0.8 && y > Math.sin(x * 0.4) * 0.8, steel[0]);
    shape(m, 5, 2, 4, 14, 8, 11, (x, y, z) => Math.abs((y - 2) - (x - 5) * 0.55 - 0.5) < 0.9 && z > 4.5 && z < 10.5, steel[1]);
    m.cylinder(10, 3, 8, 9, 1.4, steel[2], 'z');
    m.box(9, 2, 3, 11, 4, 4, steel[1]);
    m.recolor((x, y, z, p) => ((p === steel[0] || p === steel[1]) && h3(x >> 1, y, z >> 1, 7) < 0.3 ? (h3(x, y, z, 1) < 0.5 ? rust[0] : rust[1]) : null));
    for (const [x, z] of [[3, 3], [3, 10], [10, 3]]) m.set(x, 2, z, rivet);
    return { m, yaw: 34, pitch: 34 };
  },
  gear() {
    const m = new VoxelModel(16, 16, 6);
    const b = [m.color('#e0a844', { spec: 0.9, smooth: 0.4 }), m.color('#b8782a', { smooth: 0.4 }), m.color('#fff2b8', { spec: 1 })];
    shape(m, 0, 0, 1, 15, 15, 4, (x, y, z) => {
      const dx = x - 8, dy = y - 8, r = Math.hypot(dx, dy), a = Math.atan2(dy, dx);
      const tooth = Math.cos(a * 8) > 0.25 ? 7.4 : 6;
      return r < tooth && r > 2.2;
    }, (x, y, z) => (z === 4 && Math.hypot(x - 8, y - 8) < 5 && Math.hypot(x - 8, y - 8) > 3.4 ? b[2] : z === 1 ? b[1] : b[0]));
    m.sub(() => { for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2 + 0.78; m.cylinder(8 + Math.cos(a) * 4.2, 8 + Math.sin(a) * 4.2, 1, 4, 1.1, 0, 'z'); } });
    return { m, yaw: 28, pitch: 20 };
  },
  circuit_board() {
    const m = new VoxelModel(16, 5, 13);
    const pcb = [m.color('#2a8a4a', { jitter: 0.04 }), m.color('#1e6a3a', { jitter: 0.04 })];
    const gold = m.color('#f0c84a', { spec: 1 });
    const chip = m.color('#2a2a36', { spec: 0.4 });
    const pin = m.color('#c8ccd8', { spec: 0.8 });
    const led = m.color('#ff4a5a', { emissive: 1 });
    const led2 = m.color('#5aff9a', { emissive: 1 });
    m.box(0, 0, 0, 15, 0, 12, pcb[1]); m.box(0, 1, 0, 15, 1, 12, pcb[0]);
    for (let x = 1; x < 15; x++) if (x % 3) m.set(x, 1, 3, gold);
    for (let z = 3; z < 11; z++) m.set(12, 1, z, gold);
    for (let x = 2; x < 12; x++) m.set(x, 1, 10, gold);
    m.box(3, 2, 5, 8, 3, 8, chip);
    for (let x = 3; x <= 8; x += 1) { m.set(x, 2, 4, pin); m.set(x, 2, 9, pin); }
    m.box(10, 2, 7, 11, 2, 8, chip);
    m.set(13, 2, 1, led); m.set(13, 2, 11, led2);
    m.box(1, 2, 1, 2, 4, 1, pin);
    return { m, yaw: 30, pitch: 42 };
  },
  ancient_stone() {
    const m = new VoxelModel(14, 14, 12);
    const st = [m.color('#6a6898', { jitter: 0.12, smooth: 0.3 }), m.color('#55537e', { jitter: 0.12 }), m.color('#8482b4', { jitter: 0.1 })];
    const rune = m.color('#5ff4ff', { emissive: 1 });
    m.box(1, 0, 1, 12, 11, 10, (x, y, z) => (h3(x >> 1, y >> 1, z >> 1, 5) < 0.3 ? st[1] : st[0]));
    m.sub(() => { m.box(0, 9, 0, 3, 13, 3); m.box(10, 0, 8, 13, 3, 11); m.set(12, 11, 10, 0); m.set(1, 0, 10, 0); });
    m.recolor((x, y, z, p) => (y === 11 && p !== 0 ? st[2] : null));
    const R = ['..#..', '.###.', '#.#.#', '..#..', '.#.#.'];
    R.forEach((row, j) => [...row].forEach((ch, i) => { if (ch === '#') m.set(4 + i, 8 - j, 10, rune); }));
    return { m, yaw: 24 };
  },
  abyss_crystal() {
    const m = new VoxelModel(16, 20, 14);
    const cr = [m.color('#a46aff', { emissive: 0.5, smooth: 0.2, spec: 1 }), m.color('#d8b0ff', { emissive: 0.7, spec: 1 }), m.color('#6a3ac8', { emissive: 0.3 })];
    const rock = m.color('#3a386a', { jitter: 0.15 });
    m.ellipsoid(8, 1, 7, 7, 2, 6, rock);
    const shard = (x, z, h, r, lx, lz) => {
      for (let y = 0; y < h; y++) {
        const t = y / h, rr = r * (t < 0.75 ? 1 : (1 - t) * 4);
        m.cylinder(x + lx * y, z + lz * y, y + 1, y + 1, Math.max(0.5, rr), (xx, yy, zz) => (xx - x - lx * y < -0.3 ? cr[1] : h3(xx, yy, zz, 9) < 0.2 ? cr[2] : cr[0]));
      }
    };
    shard(8, 7, 17, 2.4, 0, 0); shard(4.5, 8, 10, 1.7, -0.18, 0.05); shard(11.5, 6, 12, 1.8, 0.16, -0.05); shard(8, 10.5, 8, 1.4, 0.05, 0.2);
    return { m, yaw: 30 };
  },
  golden_scale() {
    const m = new VoxelModel(15, 16, 5);
    const g = [m.color('#ffd04a', { spec: 1, specPow: 4, emissive: 0.15 }), m.color('#e0a020', { spec: 0.6 }), m.color('#fff6c0', { spec: 1, emissive: 0.3 })];
    shape(m, 0, 0, 1, 14, 15, 3, (x, y, z) => {
      const dx = (x - 7.5) / 7, dy = (y - 9) / 7;
      return (dy < 0 ? dx * dx + dy * dy : dx * dx + Math.pow(dy, 4) * 0.2 + dy * 0.3) < 1 && y > 0;
    }, (x, y, z) => (z === 3 && Math.abs(x - 7.5) < 1 ? g[2] : (Math.floor(Math.hypot(x - 7.5, y - 15) / 2.2) & 1) ? g[1] : g[0]));
    return { m, yaw: 20, pitch: 18 };
  },
  fish_sample() {
    const m = new VoxelModel(8, 18, 8);
    const glass = m.color('#d8f4ff', { smooth: 1, spec: 1 });
    const liquid = m.color('#5ad8ff', { emissive: 0.35, smooth: 1 });
    const cork = m.color('#c08a50', { jitter: 0.1 });
    const fish = m.color('#ff9a3a', { emissive: 0.2 });
    m.cylinder(4, 4, 1, 15, 2.6, glass);
    m.sphere(4, 2.2, 4, 2.6, glass);
    m.cylinder(4, 4, 1, 10, 2.6, liquid);
    m.sphere(4, 2.2, 4, 2.6, liquid);
    m.set(4, 6, 6, fish); m.set(5, 6, 6, fish); m.set(3, 7, 6, fish);
    m.cylinder(4, 4, 15, 17, 2.2, cork);
    return { m, yaw: 30, pitch: 22 };
  },
  rare_specimen() {
    const m = new VoxelModel(14, 18, 14);
    const glass = m.color('#c8eeff', { smooth: 1, spec: 1 });
    const liquid = m.color('#7affc8', { emissive: 0.45, smooth: 1 });
    const lid = [m.color('#e0a844', { spec: 0.8 }), m.color('#8a5418')];
    const fish = m.color('#ff5aa8', { emissive: 0.6 });
    m.cylinder(7, 7, 0, 13, 5.5, glass);
    m.cylinder(7, 7, 1, 11, 5.5, liquid);
    m.cylinder(7, 7, 14, 16, 4.6, lid[0]);
    m.cylinder(7, 7, 17, 17, 2.4, lid[1]);
    for (const [x, y] of [[6, 6], [7, 6], [8, 6], [5, 7], [6, 7], [7, 7], [8, 7], [9, 7], [6, 8], [7, 8], [4, 6], [4, 8]]) m.set(x, y, 12, fish);
    return { m, yaw: 26, pitch: 24 };
  },
  fish_egg() {
    const m = new VoxelModel(16, 10, 14);
    const egg = [m.color('#ffb04a', { emissive: 0.25, smooth: 1, spec: 1 }), m.color('#ffd88a', { emissive: 0.35, smooth: 1, spec: 1 })];
    const yolk = m.color('#e8582a', { emissive: 0.4 });
    const nest = m.color('#7aa85a', { jitter: 0.15 });
    m.ellipsoid(8, 1, 7, 7, 1.6, 6, nest);
    for (const [x, y, z, r] of [[6, 3.5, 6, 2.6], [10, 3.2, 7, 2.4], [8, 3.2, 10, 2.3], [8, 6, 7.5, 2.3], [4.5, 3, 9.5, 1.8]]) {
      m.sphere(x, y, z, r, (xx, yy, zz) => (yy > y ? egg[1] : egg[0]));
      m.set(Math.floor(x), Math.floor(y), Math.floor(z + r - 0.5), yolk);
    }
    return { m, yaw: 30, pitch: 34 };
  },
  coins() {
    const m = new VoxelModel(16, 10, 14);
    const c = [m.color('#5fbf98', { spec: 0.8 }), m.color('#3a8a6a'), m.color('#b8f0d8', { spec: 1 })];
    const stack = (x, z, n) => { for (let i = 0; i < n; i++) m.cylinder(x, z, i * 1.5, i * 1.5 + 0.9, 3.2, (xx, yy, zz) => (Math.hypot(xx + 0.5 - x, zz + 0.5 - z) > 2.6 ? c[1] : c[0])); m.cylinder(x, z, n * 1.5 - 0.6, n * 1.5 - 0.6, 1.4, c[2]); };
    stack(5, 6, 5); stack(11, 8, 3); stack(7, 11, 2);
    return { m, yaw: 30, pitch: 32 };
  },
  satchel() {
    const m = new VoxelModel(18, 18, 12);
    const lea = [m.color('#a8603a', { jitter: 0.08, smooth: 0.5 }), m.color('#83482a', { jitter: 0.08 }), m.color('#c47a4a', { smooth: 0.5 })];
    const strap = m.color('#5a3020');
    const buckle = m.color('#f2c84a', { spec: 1 });
    const stitch = m.color('#f4dcb0');
    const fish = m.color('#ff8a3a', { spec: 0.6 }), fishE = m.color('#1a1020');
    shape(m, 1, 0, 2, 16, 11, 10, (x, y, z) => { const dx = (x - 8.5) / 7.8, dz = (z - 6) / 4.4; return dx * dx * 0.6 + dz * dz < 1 && y < 11 - Math.max(0, Math.abs(x - 8.5) - 5) * 0.8; }, (x, y) => (y < 1 ? lea[1] : lea[0]));
    // flap over the front with stitching and a buckle
    shape(m, 1, 6, 6, 16, 12, 11, (x, y, z) => z > 8.6 && z < 10.6 && Math.abs(x - 8.5) < 7.2 - Math.max(0, 8 - y) * 0.6, (x, y) => (y === 6 || x === 2 || x === 15 ? stitch : lea[2]));
    m.box(7, 5, 10, 10, 7, 10, buckle); m.box(8, 6, 10, 9, 6, 10, lea[1]);
    // strap arch
    for (let i = 0; i <= 16; i++) { const a = Math.PI * (i / 16); m.set(Math.round(8.5 - Math.cos(a) * 7), Math.round(11 + Math.sin(a) * 6), 6, strap); m.set(Math.round(8.5 - Math.cos(a) * 7), Math.round(11 + Math.sin(a) * 6), 5, strap); }
    // fish keychain
    m.set(14, 8, 11, buckle); m.box(13, 4, 11, 15, 6, 11, fish); m.set(12, 5, 11, fish); m.set(16, 4, 11, fish); m.set(16, 6, 11, fish); m.set(14, 5, 11, fishE);
    return { m, yaw: 22, pitch: 22 };
  },
  scroll() {
    const m = new VoxelModel(20, 8, 8);
    const paper = [m.color('#3a7ad8', { smooth: 0.8 }), m.color('#5a9cf0', { smooth: 0.8 }), m.color('#e8f4ff')];
    const string = m.color('#e84a4a');
    const wax = m.color('#c82a3a', { spec: 0.6 });
    m.cylinder(4, 4, 1, 18, 3, (x, y, z) => (Math.hypot(y - 4, z - 4) < 2 ? paper[2] : (x % 5 === 0 ? paper[1] : paper[0])), 'x');
    m.sub(() => m.cylinder(4, 4, 0, 1, 1.2, 0, 'x'));
    m.cylinder(4, 4, 9, 10, 3.5, string, 'x');
    m.sphere(10, 4, 7.4, 1.6, wax);
    // a sliver of unrolled sheet
    m.box(14, 0, 4, 19, 0, 7, paper[1]);
    m.set(16, 1, 5, paper[2]); m.set(17, 1, 5, paper[2]); m.set(16, 1, 6, paper[2]);
    return { m, yaw: 24, pitch: 30 };
  },
};

// ---------------------------------------------------------------- packages

// Each returns {m, lidY} (voxels with y >= lidY form the lid).
const PKG = {
  crate() {
    const m = new VoxelModel(16, 15, 14);
    const w = [m.color('#b07a48', { jitter: 0.12 }), m.color('#93603a', { jitter: 0.12 }), m.color('#c8925a', { jitter: 0.1 })];
    const dark = m.color('#5a3a22', { jitter: 0.05 });
    const rope = m.color('#e0c890', { jitter: 0.06 });
    const nail = m.color('#c8ccd8', { spec: 1 });
    m.box(1, 0, 1, 14, 9, 12, (x, y, z) => ((y >> 1) % 2 ? w[0] : w[1]));
    m.box(0, 10, 0, 15, 11, 13, (x, y, z) => (x % 4 === 0 ? w[1] : w[2]));
    // corner posts + cross brace
    for (const [x, z] of [[1, 1], [14, 1], [1, 12], [14, 12]]) m.box(x, 0, z, x, 9, z, dark);
    for (let i = 0; i < 10; i++) { m.set(2 + Math.round(i * 1.2), i, 12, w[2]); m.set(2 + Math.round(i * 1.2), i, 13, dark); }
    for (const [x, y] of [[2, 1], [13, 1], [2, 8], [13, 8]]) m.set(x, y, 13, nail);
    // rope cross-tie and the top loop
    m.box(7, 0, 0, 8, 12, 0, rope); m.box(7, 12, 0, 8, 12, 13, rope); m.box(7, 0, 13, 8, 12, 13, rope);
    m.line(7.5, 12, 6.5, 7.5, 14.5, 6.5, rope, 0.8);
    m.set(6, 14, 6, rope); m.set(9, 14, 6, rope);
    return { m, lidY: 10 };
  },
  iron() {
    const m = new VoxelModel(16, 15, 14);
    const ir = [m.color('#5d6275', { jitter: 0.08, spec: 0.4 }), m.color('#4b4f62', { jitter: 0.08 }), m.color('#7a8094', { spec: 0.7 })];
    const band = m.color('#b8782a', { spec: 0.8 });
    const rivet = m.color('#ffe8a8', { spec: 1 });
    const rust = m.color('#a4552f', { jitter: 0.15 });
    const lock = m.color('#e0a844', { spec: 1 });
    m.box(1, 0, 1, 14, 9, 12, (x, y, z) => (h3(x >> 1, y, z >> 1, 4) < 0.12 ? rust : ir[0]));
    m.box(0, 10, 0, 15, 12, 13, ir[2]);
    m.box(1, 13, 1, 14, 13, 12, ir[1]);
    for (const y of [2, 7]) m.paint(() => m.box(0, y, 0, 15, y, 13, band));
    m.box(0, 2, 0, 0, 2, 13, band); m.box(15, 2, 0, 15, 2, 13, band); m.box(0, 7, 0, 0, 7, 13, band); m.box(15, 7, 0, 15, 7, 13, band);
    for (let x = 2; x < 14; x += 3) { m.set(x, 2, 13, rivet); m.set(x, 7, 13, rivet); m.set(x, 11, 14 - 1, rivet); }
    m.box(6, 8, 13, 9, 11, 13, lock); m.set(7, 9, 13, ir[1]); m.set(8, 9, 13, ir[1]);
    // chain ring on top
    m.line(5, 14, 6.5, 10, 14, 6.5, ir[2], 0.7);
    m.box(7, 14, 6, 8, 14, 7, ir[2]);
    return { m, lidY: 10 };
  },
  golden() {
    const m = new VoxelModel(18, 17, 14);
    const wood = [m.color('#8a3a2a', { jitter: 0.1 }), m.color('#6e2a20', { jitter: 0.1 })];
    const gold = [m.color('#f0b83c', { spec: 1, specPow: 5 }), m.color('#c88a26', { spec: 0.6 }), m.color('#fff2b8', { spec: 1 })];
    const gem = m.color('#5ad8ff', { emissive: 0.8, spec: 1 });
    const ruby = m.color('#ff3a6a', { emissive: 0.6, spec: 1 });
    m.box(1, 0, 1, 16, 8, 12, (x, y, z) => ((x >> 1) % 2 ? wood[0] : wood[1]));
    // curved lid
    shape(m, 0, 9, 0, 17, 15, 13, (x, y, z) => { const dz = (z - 7) / 7.2, dy = (y - 9) / 6; return dz * dz + dy * dy < 1; }, wood[0]);
    // gold trims
    m.paint(() => { m.box(0, 0, 0, 1, 15, 13, gold[1]); m.box(16, 0, 0, 17, 15, 13, gold[1]); m.box(0, 8, 0, 17, 9, 13, gold[0]); m.box(8, 0, 0, 9, 15, 13, gold[0]); });
    m.box(0, 0, 0, 1, 8, 13, gold[1]); m.box(16, 0, 0, 17, 8, 13, gold[1]);
    m.box(7, 6, 13, 10, 10, 13, gold[2]);
    m.set(8, 8, 13, gem); m.set(9, 8, 13, gem);
    m.set(4, 12, 12, ruby); m.set(13, 12, 12, ruby);
    m.box(7, 15, 6, 10, 16, 7, gold[0]);
    m.set(8, 16, 6, 0); m.set(9, 16, 6, 0);
    return { m, lidY: 9 };
  },
  orb() {
    const m = new VoxelModel(16, 19, 16);
    const glass = m.color('#7a5ad8', { emissive: 0.5, smooth: 1, spec: 1, specPow: 4 });
    const swirl = [m.color('#ff9ae8', { emissive: 1 }), m.color('#9ae8ff', { emissive: 1 }), m.color('#ffffff', { emissive: 1 })];
    const deep = m.color('#2a1a5a', { emissive: 0.3, smooth: 1 });
    const cage = [m.color('#e0a844', { spec: 1 }), m.color('#8a5418')];
    m.sphere(8, 8, 8, 7.2, (x, y, z) => {
      const a = Math.atan2(z - 8, x - 8) + (y - 8) * 0.35;
      const s = Math.sin(a * 3) * Math.cos((y - 8) * 0.5);
      return s > 0.75 ? swirl[(Math.floor(y / 4) + 3) % 2] : h3(x, y, z, 2) < 0.04 ? swirl[2] : s < -0.6 ? deep : glass;
    });
    for (let k = 0; k < 4; k++) {
      const a = k * Math.PI / 2 + 0.4;
      for (let t = 0; t <= 14; t++) {
        const b = -0.2 + (t / 14) * 1.6;
        const y = 8 + Math.sin(b) * 7.6, r = Math.cos(b) * 7.6;
        if (y < 10) continue;
        m.set(Math.round(8 + Math.cos(a) * r), Math.round(y), Math.round(8 + Math.sin(a) * r), cage[0]);
      }
    }
    m.cylinder(8, 8, 14, 15, 2.6, cage[0]);
    m.cylinder(8, 8, 16, 17, 1.2, cage[1]);
    m.line(6.5, 18, 8, 9.5, 18, 8, cage[0], 0.6);
    return { m, lidY: 13 };
  },
};

export const ART_IDS = new Set(Object.keys(MODELS));
export const PACKAGE_ART = Object.keys(PKG);

// ---------------------------------------------------------------- render budget + caches

let winStart = 0, spent = 0;
const BUDGET = 7;
function canRender() {
  const now = performance.now();
  if (now - winStart > 16) { winStart = now; spent = 0; }
  return spent < BUDGET;
}
function timed(fn) {
  const t0 = performance.now();
  const r = fn();
  spent += performance.now() - t0;
  return r;
}

const built = new Map();
function modelOf(id) {
  let b = built.get(id);
  if (!b) {
    const mk = MODELS[id] || (PKG[id.replace(/^pkg_/, '')] ? () => ({ ...PKG[id.replace(/^pkg_/, '')](), yaw: 30 }) : null);
    if (!mk) return null;
    b = mk();
    built.set(id, b);
  }
  return b;
}

const cache = new Map();
// force = render even when over budget (used for one-off large previews)
export function itemSprite(id, { scale = 1, frame = 0, force = false } = {}) {
  frame = ((frame % SPIN) + SPIN) % SPIN;
  const key = id + '|' + scale + '|' + frame;
  let s = cache.get(key);
  if (s) return s;
  if (!force && !canRender()) {
    for (let d = 1; d < SPIN; d++) {
      const q = cache.get(id + '|' + scale + '|' + ((frame + d) % SPIN)) || cache.get(id + '|' + scale + '|' + ((frame - d + SPIN) % SPIN));
      if (q) return q;
    }
    return null;
  }
  const b = modelOf(id);
  if (!b) return null;
  s = timed(() => {
    const r = renderVoxels(b.m, { scale: 2 * scale * (b.vs ?? 1), yaw: (b.yaw ?? 30) + (frame * 360) / SPIN, pitch: b.pitch ?? 28, glowRadius: 2 });
    return { canvas: r.canvas, glow: r.glow, ox: r.ox, oy: r.oy, w: r.w, h: r.h };
  });
  cache.set(key, s);
  return s;
}

const pkgCache = new Map();
// Package body + lid rendered with identical framing (lid drawn on top at the same offset).
export function packageParts(tier, scale = 1, frame = 0, force = true) {
  const key = tier + '|' + scale + '|' + frame;
  let p = pkgCache.get(key);
  if (p) return p;
  if (!force && !canRender()) return null;
  const mk = PKG[tier] || PKG.crate;
  const b = built.get('pkgparts_' + tier) || mk();
  built.set('pkgparts_' + tier, b);
  p = timed(() => {
    const opts = { scale: 2 * scale, yaw: 30 + (frame * 360) / SPIN, pitch: 26, glowRadius: 2 };
    const full = renderVoxels(b.m, opts);
    const body = renderVoxels(b.m, { ...opts, keepVoxel: (x, y) => y < b.lidY }).canvas;
    const lid = renderVoxels(b.m, { ...opts, keepVoxel: (x, y) => y >= b.lidY }).canvas;
    const top = full.project(b.m.nx / 2, b.m.ny, b.m.nz / 2);
    const lidC = full.project(b.m.nx / 2, b.lidY + 2, b.m.nz / 2);
    return { full: full.canvas, glow: full.glow, body, lid, ox: full.ox, oy: full.oy, w: full.w, h: full.h, top: [Math.round(top[0]), Math.round(top[1])], lidAt: [Math.round(lidC[0]), Math.round(lidC[1])] };
  });
  pkgCache.set(key, p);
  return p;
}

export function clampFrame(f) { return clamp(Math.floor(f), 0, SPIN - 1); }
