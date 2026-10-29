// Lava Rift (900 m): a dark basalt canyon split by glowing magma. Hexagonal basalt columns step up both walls,
// the floor is cracked with live magma seams and lava pools, magma vents boil bubble columns, obsidian spires
// gleam, sulfur chimneys smoke yellow and heat shimmers above every vent. Far away, lava falls pour down the rift
// walls and something long and molten glides through the haze. Far above, a volcanic island erupts on the horizon.
// Art is authored "lit": the darkness pass hides it except where magma, vents and embers shine.
// Weathers: calm, eruption (ash, embers, lava bombs, rumbles that shake the camera), sulfur haze, magma bloom.
// Secrets: the obsidian-plugged vent (pop it), the warm egg (hatch it), the marshmallow on a stick (toast it).

import { Biome, worldTop } from './base.js';
import { clamp, clamp01, lerp, smoothstep, hash2, fbm2, bayer, TAU } from '../../core/math.js';
import { RNG } from '../../core/rng.js';
import { rgba, pack } from '../../core/color.js';
import { makeCanvas, ctxOf, makeLayer, tinted } from '../../core/canvas.js';
import { VoxelModel } from '../../gfx/voxel.js';
import { getProp, fbm3 } from '../../gfx/props.js';
import {
  paint, dpack, lerpStops, stopPalette, ditherPick, Blend, FogLayer, fillWith, drawWobble, makeRays, drawGlow, twinkle,
  waveLine, waveRuns, Strands, Motes, Bubbles, Mask, ridge, todWeights, quality, inRect, SwayAnim, cloudTile, DepthScene,
  BandSet, DepthDecor, qscale, hazeMask,
} from '../scenery.js';
import { worldStrip, vshape, vblob, vprism, voxSprite, placeSprite, px, skyward, qmix, tri } from './fjord.js';

const WATER = [[0, '#56605e'], [0.1, '#323a40'], [0.3, '#1e1e28'], [0.55, '#1c1420'], [0.8, '#26141a'], [1, '#3a1a14']];
const SKY = {
  day: [[0, '#4a4650'], [0.5, '#8a7a78'], [0.85, '#c8a088'], [1, '#e8b890']],
  dusk: [[0, '#1a1024'], [0.4, '#4a1a30'], [0.75, '#a83a2a'], [1, '#ff8a4a']],
  night: [[0, '#05030a'], [0.6, '#140810'], [1, '#3a1010']],
};
const VOLC = {
  day: { rock: ['#1a1418', '#2a2228', '#3e343a', '#5a4c50', '#7a6a68'], lava: ['#a8280a', '#e8501a', '#ff8a2a', '#ffd060'], smoke: ['#3a3438', '#5a5458', '#7a7478', '#9a9494'] },
  dusk: { rock: ['#0e080e', '#1a0e16', '#2a1620', '#40202a', '#5a2e34'], lava: ['#b8280a', '#ff5a1a', '#ff9a3a', '#ffe070'], smoke: ['#2a1418', '#4a2228', '#6a3434', '#8a4a44'] },
  night: { rock: ['#030204', '#08050a', '#100a10', '#1a1018', '#261620'], lava: ['#c8300a', '#ff621e', '#ffa040', '#fff080'], smoke: ['#100808', '#1e1010', '#2e1818', '#402020'] },
};
const MAGMA = ['#ff5a14', '#ff8a2a', '#ffc04a', '#fff0a0'];

// ====================================================================== voxel models

function basaltModel(seed, big = 1) {
  const r = new RNG(seed);
  const m = new VoxelModel(Math.round(48 * big), Math.round(64 * big), Math.round(40 * big));
  const side = [m.color('#2e2c36', { jitter: 0.1 }), m.color('#3a3844', { jitter: 0.1 }), m.color('#24222c', { jitter: 0.1 })];
  const topc = [m.color('#56545e', { jitter: 0.08 }), m.color('#6a6672', { jitter: 0.06 })];
  const ember = m.color('#ff6a1a', { emissive: 1, jitter: 0 });
  const cx = m.nx / 2, cz = m.nz / 2, rr = 3.6 * big;
  const cells = [];
  for (let q = -3; q <= 3; q++) for (let s = -3; s <= 3; s++) {
    const x = cx + (q + s * 0.5) * rr * 1.75, z = cz + s * rr * 1.5;
    const d = Math.hypot((x - cx) / (m.nx * 0.42), (z - cz) / (m.nz * 0.42));
    if (d > 1) continue;
    cells.push([x, z, (1 - d * 0.75) * (50 * big) * r.float(0.45, 1)]);
  }
  for (const [x, z, h] of cells) vprism(m, [x, 0, z], [0, 1, 0], Math.max(3, h), rr * 0.92, 0.01, side[r.int(0, 2)], 6, 0);
  m.recolor((x, y, z, p) => (!m.get(x, y + 1, z) ? (hash2(x, z, seed) < 0.25 ? topc[1] : topc[0]) : null));
  // glowing seams near the ground
  m.recolor((x, y, z, p) => (y < 3 && m.exposed(x, y, z) && hash2(x * 3 + z, y, seed + 1) < 0.18 ? ember : null));
  return { m, yaw: 30, light: '#ff6a1a' };
}

function obsidianModel(seed, big = 1) {
  const r = new RNG(seed);
  const m = new VoxelModel(Math.round(40 * big), Math.round(92 * big), Math.round(34 * big));
  const glass = [m.color('#120e18', { jitter: 0.04, spec: 2.4, specPow: 18 }), m.color('#1e1828', { jitter: 0.04, spec: 2, specPow: 18 })];
  const sheen = [m.color('#5a4a8a', { jitter: 0.03, spec: 1.6 }), m.color('#3a6a8a', { jitter: 0.03, spec: 1.6 })];
  const base = m.color('#2a2228', { jitter: 0.14, smooth: 0.6 });
  const vein = m.color('#ff4a2a', { emissive: 0.85, jitter: 0 });
  const cx = m.nx / 2, cz = m.nz / 2;
  vblob(m, cx, 2, cz, 12 * big, 5 * big, 10 * big, 0.35, 0.18, seed, base, 0);
  const shards = [[0.05, 1, 0, 80, 5.5], [-0.35, 1, 0.12, 50, 3.6], [0.32, 1, -0.1, 58, 4], [0.15, 1, 0.45, 30, 3], [-0.55, 0.85, -0.35, 22, 2.6]];
  shards.forEach(([dx, dy, dz, len, rad], i) => vprism(m, [cx + dx * 6 * big, 2, cz + dz * 6 * big], [dx, dy, dz], len * big * r.float(0.85, 1), rad * big, rad * big * 2.6, glass[i % 2], 5, r.float(0, 1)));
  m.recolor((x, y, z, p) => ((p === glass[0] || p === glass[1]) && !m.get(x - 1, y, z) && !m.get(x, y, z + 1) ? sheen[hash2(x, y, z) < 0.5 ? 0 : 1] : null));
  m.recolor((x, y, z, p) => ((p === glass[0] || p === glass[1]) && m.exposed(x, y, z) && Math.abs(fbm3(x * 0.2, y * 0.06, z * 0.2, 2, seed) - 0.5) < 0.02 ? vein : null));
  return { m, yaw: 24, light: '#ff4a2a' };
}

function sulfurModel(seed, big = 1) {
  const r = new RNG(seed);
  const m = new VoxelModel(Math.round(50 * big), Math.round(84 * big), Math.round(44 * big));
  const rock = [m.color('#3a3030', { smooth: 0.55, jitter: 0.12 }), m.color('#4a3c38', { smooth: 0.55, jitter: 0.12 })];
  const sul = [m.color('#e8d040', { smooth: 0.5, jitter: 0.08 }), m.color('#f6ec9a', { smooth: 0.5, jitter: 0.06 }), m.color('#c89a28', { smooth: 0.5, jitter: 0.08 }), m.color('#d8702a', { smooth: 0.5, jitter: 0.08 })];
  const throat = m.color('#d8ff6a', { emissive: 0.9, jitter: 0 });
  let y = 0, rr = 13 * big, x = m.nx / 2, z = m.nz / 2;
  const top = 64 * big;
  const segs = [];
  while (y < top) {
    const h = r.float(6, 10) * big;
    vblob(m, x, y + h * 0.5, z, rr, h * 0.75, rr * 0.9, 0.28, 0.22, seed + y, rock[0], 0);
    segs.push([x, y, z, rr]);
    y += h * 0.82; rr = Math.max(4 * big, rr * 0.85); x += r.float(-1, 1); z += r.float(-0.7, 0.7);
  }
  m.recolor((x2, y2, z2) => {
    if (!m.exposed(x2, y2, z2)) return null;
    const band = Math.sin(y2 * 0.5 + fbm3(x2 * 0.1, y2 * 0.1, z2 * 0.1, 2, seed) * 5);
    const n = fbm3(x2 * 0.14, y2 * 0.1, z2 * 0.14, 2, seed + 3);
    if (n > 0.62) return band > 0.3 ? sul[0] : sul[2];
    if (n > 0.52) return band > 0.6 ? sul[3] : rock[1];
    return null;
  });
  m.recolor((x2, y2, z2, p) => (p === sul[0] && !m.get(x2, y2 + 1, z2) ? sul[1] : null));
  const [tx, ty, tz, tr] = segs[segs.length - 1];
  m.sub(() => m.cylinder(tx, tz, ty + 2, ty + 14, Math.max(1.8, tr * 0.42)));
  m.cylinder(tx, tz, ty + 2, ty + 3, Math.max(1.8, tr * 0.42), throat);
  return { m, yaw: 26, light: '#d8ff6a', top: [tx, ty + 4, tz] };
}

function ventModel(seed, big = 1, plugged = false) {
  const m = new VoxelModel(Math.round(64 * big), Math.round(40 * big), Math.round(54 * big));
  const rock = [m.color('#2a2226', { smooth: 0.6, jitter: 0.12 }), m.color('#3a2e30', { smooth: 0.6, jitter: 0.12 }), m.color('#4e3c3a', { smooth: 0.6, jitter: 0.1 })];
  const crust = m.color('#5a2a1a', { smooth: 0.5, jitter: 0.1 });
  const lava = [m.color('#ff5a14', { emissive: 1, jitter: 0.03 }), m.color('#ffc04a', { emissive: 1, jitter: 0.02 }), m.color('#fff0a0', { emissive: 1, jitter: 0 })];
  const cx = m.nx / 2, cz = m.nz / 2, R = 28 * big, Hh = 30 * big;
  vshape(m, 0, 0, 0, m.nx, Hh + 2, m.nz, (x, y, z) => {
    const d = Math.hypot(x - cx, (z - cz) * 1.1) / R;
    const hgt = Hh * Math.pow(Math.max(0, 1 - d), 0.9) * (0.85 + 0.3 * fbm2(x * 0.15, z * 0.15, 2, seed));
    return y < hgt;
  }, rock[0]);
  // crater
  m.sub(() => m.cone(cx, cz, Hh * 0.55, Hh + 3, 2.5 * big, 8 * big));
  m.cylinder(cx, cz, Hh * 0.55, Hh * 0.62, 6 * big, plugged ? crust : lava[1]);
  if (!plugged) m.cylinder(cx, cz, Hh * 0.63, Hh * 0.64, 3 * big, lava[2]);
  // glowing cracks running down the flanks
  m.recolor((x, y, z, p) => {
    if (!m.exposed(x, y, z)) return null;
    const a = Math.atan2(z - cz, x - cx);
    const crack = Math.abs(Math.sin(a * 5 + fbm3(x * 0.1, y * 0.1, z * 0.1, 2, seed) * 3)) < 0.06 && y > 2;
    if (crack && !plugged) return y > Hh * 0.5 ? lava[1] : lava[0];
    if (crack && plugged) return crust;
    const n = fbm3(x * 0.12, y * 0.12, z * 0.12, 2, seed + 4);
    return n > 0.62 ? rock[2] : n < 0.38 ? rock[1] : null;
  });
  return { m, yaw: 28, light: '#ff7a2a', crater: [cx, Hh * 0.62, cz] };
}

function lavaRockModel(seed, big = 1) {
  const m = new VoxelModel(Math.round(40 * big), Math.round(26 * big), Math.round(32 * big));
  const rock = [m.color('#2a2028', { smooth: 0.7, jitter: 0.14 }), m.color('#3a2c30', { smooth: 0.7, jitter: 0.12 })];
  const lava = m.color('#ff6a1a', { emissive: 1, jitter: 0 });
  vblob(m, m.nx / 2, 8 * big, m.nz / 2, 16 * big, 10 * big, 12 * big, 0.3, 0.12, seed, rock[0], 0);
  m.recolor((x, y, z, p) => {
    if (!m.exposed(x, y, z)) return null;
    if (Math.abs(fbm3(x * 0.14, y * 0.14, z * 0.14, 2, seed + 1) - 0.5) < 0.025) return lava;
    return fbm3(x * 0.1, y * 0.1, z * 0.1, 2, seed + 2) > 0.58 ? rock[1] : null;
  });
  return { m, yaw: 30, light: '#ff6a1a' };
}

function eggModel() {
  const m = new VoxelModel(14, 18, 12);
  const sh = [m.color('#3a2028', { smooth: 0.9, jitter: 0.05, spec: 1 }), m.color('#5a3038', { smooth: 0.9, jitter: 0.05 })];
  const spot = m.color('#ff8a2a', { emissive: 0.9, jitter: 0 });
  const nest = m.color('#1e1418', { smooth: 0.6, jitter: 0.1 });
  m.ellipsoid(7, 8, 6, 5, 7.5, 4.5, sh[0]);
  m.recolor((x, y, z, p) => (m.exposed(x, y, z) && hash2(x * 3 + z, y, 5) < 0.12 ? spot : hash2(x, y + z, 6) < 0.3 ? sh[1] : null));
  vblob(m, 7, 1, 6, 7, 2, 5.5, 0.3, 0.4, 3, nest, 0);
  return { m, yaw: 30 };
}

// ====================================================================== small sprites

function salamanderFrames() {
  const out = [];
  for (let f = 0; f < 4; f++) {
    const c = makeCanvas(16, 7), g = ctxOf(c);
    const B = '#ff6a2a', D = '#b83a14', H = '#ffd06a', K = '#1a0a08';
    const s = f % 2 ? 1 : 0;
    px(g, 0, 3, 3, 1, D); px(g, 2, 2, 3, 2, B); px(g, 4, 2, 7, 3, B); px(g, 11, 1, 4, 3, B);
    px(g, 5, 2, 5, 1, H); px(g, 12, 1, 2, 1, H); px(g, 13, 2, 1, 1, K); px(g, 6, 3, 1, 1, K); px(g, 9, 3, 1, 1, K);
    px(g, 5 - s, 5, 1, 2, D); px(g, 9 + s, 5, 1, 2, D); px(g, 12 - s, 4, 1, 2, D); px(g, 3 + s, 4, 1, 2, D);
    out.push(c);
  }
  return out;
}

// ====================================================================== the biome

export class VolcanoBiome extends Biome {
  constructor(ocean) {
    super(ocean);
    this.id = 'volcano'; this.name = 'Lava Rift'; this.subtitle = 'The sea floor is cracking open, 900 m down'; this.music = 'volcano';
    this.weathers = [{ id: 'calm', name: 'Calm Rift', weight: 4 }, { id: 'eruption', name: 'Eruption', weight: 1.2, icon: 'warning' }, { id: 'sulfur', name: 'Sulfur Haze', weight: 1.6, icon: 'cloud' }, { id: 'magma', name: 'Magma Bloom', weight: 1, icon: 'star' }];
    this.ambient = 'volcano';
    this.fogColor = '#2a1a1e';
    this.fogAmount = 0.7;
    this.t = 0;
    this.tod = { day: 1, dusk: 0, night: 0 };
    this.wx = { erupt: 0, sulfur: 0, magma: 0 };
    this.par = { x: 0, y: 0 };
    this.fresh = true;
    this.rumble = 0; this.rumbleT = 4; this.flash = 0;
    this.hint = 0;
  }

  baseSurface() { return null; }
  surfY() { return -Math.round(this.H * 0.34); }
  boatLevel() { return this.surfY(); }
  waveAt(x) { return this.ys ? this.ys[clamp(Math.round(x), 0, this.W)] : null; }
  floorAt(x, z = 0) { return this.D ? this.D.floorAt(x, z) : super.floorAt(x); }
  secrets() { return this.game?.state?.secrets || {}; }
  waterLook() { return { refract: 10, caustic: 3, foamColor: '#a8a0a0', causticColor: '#3a1408', crestColor: '#d8c8c0' }; }

  // ------------------------------------------------------------------ build
  build(W, H) {
    this.W = W; this.H = H;
    this.top = worldTop(H);
    const sy = this.surfY();
    this.ys = new Int16Array(W + 2).fill(sy);
    this.water = worldStrip(H, this.top, WATER, (y) => clamp01((y - sy) / (H - sy)), 26);
    this.skyBlend = new Blend(); this.mtnBlend = new Blend();
    this.buildSky();
    this.buildDepth();
    this.buildLayers();
    this.rays = makeRays(W, H - sy, { seed: 33, count: 7, sunX: W * 0.55, sunY: -H * 1.2, minW: 10, maxW: 30, len: 0.75, color: '#ff9a6a', alpha: 0.3, levels: 3 });
    this.buildLife();
    this.fresh = true;
  }

  buildSky() {
    const W = this.W, top = this.top, sy = this.surfY();
    const skyY = top - 12, h = sy + 14 - skyY;
    this.skyY = skyY; this.skyH = h;
    const N = W * h;
    const mat = new Uint8Array(N), tone = new Float32Array(N);
    // the volcano: a broad cone with a notched crater, lava rivers down the flanks; basalt sea stacks in front
    const vx = W * 0.6, vTop = sy - 118, vW = W * 0.27;
    this.crater = { x: vx, y: vTop + 6 };
    const cone = (x) => {
      const d = Math.abs(x - vx) / vW;
      if (d > 1.3) return 1e9;
      let y = vTop + Math.pow(d, 1.5) * 150 + (fbm2(x * 0.05, 1, 3, 7) - 0.5) * 10;
      if (Math.abs(x - vx) < 14) y += 6 - Math.abs(x - vx) * 0.2;
      return y;
    };
    const far = ridge(W, sy - 40, 26, 0.013, 3.3, 3, 0.4);
    const stacks = [[0.12, 70, 20], [0.2, 44, 14], [0.86, 90, 22], [0.93, 56, 16], [0.36, 26, 12]];
    const rivers = [[-0.25, 1.1], [0.18, 0.8], [0.42, 1.3], [-0.6, 0.9]];
    for (let row = 0; row < h; row++) {
      const y = row + skyY;
      if (y > sy + 1) continue;
      for (let x = 0; x < W; x++) {
        const i = row * W + x;
        let stack = false;
        for (const [xf, sh, sw] of stacks) {
          const d = Math.abs(x - xf * W) / sw;
          const tY = sy - sh * (1 - Math.pow(d, 3)) + (hash2(Math.floor(x / 3), xf * 99, 3) < 0.4 ? 2 : 0);
          if (d < 1 && y >= tY) {
            mat[i] = 3;
            const col = Math.floor((x - xf * W + 40) / 4);
            tone[i] = clamp01(0.45 + (hash2(col, 1, 9) - 0.5) * 0.5 + ((x - xf * W + 40) % 4 === 0 ? -0.35 : 0) + (x < xf * W ? 0.15 : -0.1) + (y < tY + 2 ? 0.35 : 0));
            stack = true;
            break;
          }
        }
        if (stack) continue;
        const cy = cone(x);
        if (y >= cy) {
          const u = (x - vx) / vW;
          let lava = false;
          for (const [ru, wid] of rivers) {
            const dy = (y - vTop) / 150;
            const rx = ru * 0.25 + Math.sin(dy * 9 + ru * 7) * 0.025 + (fbm2(y * 0.08, ru * 9, 2, 6) - 0.5) * 0.05 + dy * ru * 0.65;
            const wv = wid * 0.007 * (0.5 + dy) * (0.6 + fbm2(y * 0.2, ru * 3, 2, 8) * 0.8);
            if (Math.abs(u - rx) < wv && dy < 0.35 + wid * 0.55) lava = true;
          }
          if (lava && y > cy + 2) { mat[i] = 2; tone[i] = clamp01(0.75 - (y - vTop) / 260 + (fbm2(x * 0.3, y * 0.2, 2, 4) - 0.5) * 0.9); continue; }
          mat[i] = 1;
          const R = 1 - Math.abs(fbm2((x + (x < vx ? 1 : -1) * (y - vTop) * 0.6) * 0.04, y * 0.012, 3, 11) * 2 - 1);
          const dR = 1 - Math.abs(fbm2((x + 1 + (x < vx ? 1 : -1) * (y - vTop) * 0.6) * 0.04, y * 0.012, 3, 11) * 2 - 1) - R;
          tone[i] = clamp01(0.4 + dR * 6 + (x < vx ? 0.12 : -0.12) + (R - 0.5) * 0.3 + (y < cy + 2 ? 0.25 : 0));
          continue;
        }
        if (y >= far[x]) { mat[i] = 4; tone[i] = clamp01(0.4 - (y - far[x]) / 80 + (fbm2(x * 0.06, y * 0.06, 2, 13) - 0.5) * 0.4); }
      }
    }
    const skyOf = (kind) => paint(W, h, (x, row) => {
      const y = row + skyY;
      let [r, g, b] = lerpStops(SKY[kind], clamp01((y - top) / (sy - top)));
      const d = Math.hypot(x - vx, (y - vTop) * 1.3);
      const gl = kind === 'night' ? 0.45 : kind === 'dusk' ? 0.35 : 0.2;
      if (d < 160) { const k = Math.pow(1 - d / 160, 2) * gl; r += (255 - r) * k; g += (120 - g) * k; b += (50 - b) * k; }
      if (kind === 'night' && y < sy - 120 && hash2(x, row, 71) < 0.0025) { r = 200; g = 190; b = 210; }
      return dpack(r, g, b, x, row, 5);
    });
    const mtnOf = (kind) => {
      const P = VOLC[kind];
      const rock = P.rock.map((c) => pack(c) >>> 0), lava = P.lava.map((c) => pack(c) >>> 0);
      return paint(W, h, (x, row) => {
        const i = row * W + x, tn = tone[i];
        switch (mat[i]) {
          case 1: return ditherPick(rock, tn, x, row);
          case 2: return ditherPick(lava, tn, x, row);
          case 3: return ditherPick(rock, tn * 0.9, x, row);
          case 4: return ditherPick(rock, 0.2 + tn * 0.5, x, row);
          default: return 0;
        }
      });
    };
    this.sky = { day: skyOf('day'), dusk: skyOf('dusk'), night: skyOf('night') };
    this.mtn = { day: mtnOf('day'), dusk: mtnOf('dusk'), night: mtnOf('night') };
    this.lavaMask = paint(W, h, (x, row) => (mat[row * W + x] === 2 ? pack('#ffffff') : 0));
    // ash plume puffs and lava bombs above the crater
    this.plume = [];
    const r = new RNG(5);
    for (let i = 0; i < 26; i++) this.plume.push({ k: i / 26, ph: r.float(0, TAU), s: r.float(0.7, 1.4), dx: r.float(-1, 1) });
    this.puff = [3, 5, 7, 9, 12, 15, 18, 22].map((rr) => paint(rr * 2 + 1, rr * 2 + 1, (x, y) => {
      const d = Math.hypot(x - rr, y - rr) / rr;
      if (d > 1) return 0;
      const n = fbm2(x * 0.3 + rr, y * 0.3, 2, rr);
      if (d > 0.75 + n * 0.3) return 0;
      return pack(y < rr * 0.7 ? '#ffffff' : '#c8c8c8');
    }));
    this.bombs = [];
    this.ashTile = cloudTile(320, 140, '#3a3036', { seed: 4, alpha: 0.5, scale: 0.03, bias: 0.5, levels: 3 });
  }

  buildDepth() {
    const W = this.W, H = this.H;
    const D = new DepthScene(W, H, { yFront: H - 68, yFar: H - 160, pad: 24, zFar: 1.9, fogStart: -0.2, fog: 0.94 });
    this.D = D;
    const cx = D.cx;
    const edge = (z, side) => W * (side < 0 ? 0.36 : 0.355) + Math.sin(z * 3.4 + side * 2) * W * 0.03 + (fbm2(z * 2.4, 5.1 + side, 2, 101) - 0.5) * W * 0.07;
    this.edge = edge;
    const crackN = (X, z) => fbm2(X * 0.011, z * 2.6, 3, 102);
    const floorH = (X, z) => {
      let h = (fbm2(X * 0.005, z * 1.4, 3, 103) - 0.45) * 12;
      h += Math.max(0, fbm2(X * 0.03, z * 5, 2, 104) - 0.64) * 34;
      const c = Math.abs(crackN(X, z) - 0.5);
      if (c < 0.03) h -= (0.03 - c) * 120;     // magma channels sink into the floor
      const front = 1 - smoothstep(0.05, 0.5, z);
      h *= 1 - front * 0.6;
      return Math.max(-4, h);
    };
    // hexagonal basalt causeway along the rift walls
    const hexH = (X, z) => {
      const gx = X / 9, gz = z * 34;
      const q = Math.round(gx - gz * 0.5), s = Math.round(gz);
      return hash2(q, s, 105);
    };
    const cliff = (X, z) => {
      const side = X < cx ? -1 : 1;
      const over = Math.abs(X - cx) - edge(z, side) - (fbm2(z * 7, side * 3, 2, 106) - 0.5) * 18;
      if (over <= 0) return null;
      const hx = hexH(X, z);
      if (over < 16) return 24 + Math.round(hx * 10) * 2;
      if (over < 34) return 70 + Math.round(hx * 12) * 2;
      if (over < 50) return 128 + Math.round(hx * 10) * 2;
      const rimY = 26 + fbm2(z * 5, side * 2, 2, 114) * 50;
      return Math.min(560, D.K - (rimY - D.hz) / D.s(z)) + Math.round(hx * 4) * 2;
    };
    D.terrain({
      cell: 2, dz: 0.02, hstep: 2, ambient: 0.66, diffuse: 0.5, ao: 0.08, jitter: 0.06, wall: 0.78, side: 0.9, crest: 1.18, wallMin: 22, fullHeight: true,
      height: (X, z) => cliff(X, z) ?? floorH(X, z),
      floorHeight: floorH,
      color: (X, z, h) => {
        if (h >= 22) { const k = 0.8 + hexH(X, z) * 0.4; return [64 * k, 60 * k, 72 * k]; }
        const hs = hash2(Math.floor(X / 2), Math.floor(z * 50), 107);
        if (hs < 0.008) return [200, 176, 70];
        if (hs < 0.012) return [110, 100, 104];
        const ash = fbm2(X * 0.01 + 4, z * 2, 2, 108);
        if (ash > 0.64) return [96, 90, 92];
        const n = fbm2(X * 0.03, z * 5, 2, 109);
        return n < 0.35 ? [38, 34, 42] : n > 0.66 ? [66, 58, 64] : [50, 44, 52];
      },
      glow: (X, z, h) => {
        if (h >= 22) return null;
        const c = Math.abs(crackN(X, z) - 0.5);
        if (c < 0.012) return c < 0.005 ? [255, 210, 110] : [255, 110, 30];
        if (h <= -3) return [255, 80, 20];
        const hs = hash2(Math.floor(X / 2), Math.floor(z * 50), 110);
        if (hs < 0.003) return [255, 120, 40];
        return null;
      },
      wallColor: (X, z, hp, h) => {
        const col = Math.floor(X / 6);
        const seam = ((X % 6) + 6) % 6 < 1;
        const joint = Math.abs(Math.sin(hp * 0.12 + hash2(col, 2, 111) * 6)) < 0.06;
        let k = 0.85 + hash2(col, Math.floor(z * 20), 112) * 0.35;
        if (seam || joint) k *= 0.55;
        k *= 1 - smoothstep(30, 520, hp) * 0.45;
        if (hp > h - 2 && h < 300) k *= 1.35;
        // a few lava falls glowing down the walls
        const fall = Math.abs(fbm2(X * 0.012 + Math.sin(hp * 0.05) * 0.06, z * 2.5, 2, 113) - 0.5) < 0.006 && hp < h - 2 && fbm2(X * 0.01, z * 3, 2, 115) > 0.55;
        if (fall) return [255, 120 + hash2(Math.floor(hp / 3), col, 3) * 80, 40];
        return [58 * k, 54 * k, 66 * k];
      },
    });
    const S = (key, build, xf, z, base) => placeSprite(D, W, voxSprite(key, build, { scale: qscale(base * D.s(z)) }), xf, z);
    const P = (id, xf, z, base, variant = 0) => placeSprite(D, W, getProp(id, { scale: qscale(base * D.s(z)), variant }), xf, z, { id });
    const vents = [], chimneys = [];
    // near
    S('vo_basalt0', () => basaltModel(3, 1), 0.2, 0.22, 0.85);
    S('vo_rock0', () => lavaRockModel(5, 1), 0.65, 0.08, 0.8);
    S('vo_obsid0', () => obsidianModel(7, 0.9), 0.77, 0.24, 0.85);
    P('tube_worms', 0.405, 0.27, 0.6, 0);
    S('vo_rock1', () => lavaRockModel(9, 0.7), 0.3, 0.05, 0.7);
    // mid
    vents.push(S('vo_vent0', () => ventModel(11, 1), 0.45, 0.46, 1.05));
    chimneys.push(S('vo_sulfur0', () => sulfurModel(13, 1), 0.31, 0.5, 1.0));
    S('vo_obsid1', () => obsidianModel(17, 1.1), 0.62, 0.42, 1.0);
    S('vo_basalt1', () => basaltModel(19, 1.2), 0.72, 0.56, 1.0);
    P('vent_chimney', 0.555, 0.6, 0.85);
    P('tube_worms', 0.53, 0.52, 0.55, 1);
    S('vo_rock2', () => lavaRockModel(21, 1.2), 0.24, 0.44, 0.9);
    // far
    vents.push(S('vo_vent1', () => ventModel(23, 1.3), 0.56, 1.0, 1.25));
    chimneys.push(S('vo_sulfur1', () => sulfurModel(29, 1.2), 0.66, 0.86, 1.15));
    S('vo_obsid2', () => obsidianModel(31, 1.4), 0.38, 0.9, 1.3);
    S('vo_obsid3', () => obsidianModel(37, 1.2), 0.47, 1.25, 1.5);
    S('vo_basalt2', () => basaltModel(41, 1.4), 0.3, 1.15, 1.4);
    S('vo_basalt3', () => basaltModel(43, 1.2), 0.62, 1.35, 1.6);
    vents.push(S('vo_vent2', () => ventModel(47, 1.5), 0.42, 1.5, 1.8));
    chimneys.push(S('vo_sulfur2', () => sulfurModel(53, 1.3), 0.53, 0.78, 1.0));
    // secrets: plugged vent (near), the egg in an ember nest, the marshmallow stick
    const pz = 0.06, pxx = Math.round(W * 0.53);
    this.plugOpen = voxSprite('vo_plugvent_open', () => ventModel(61, 0.8, false), { scale: qscale(0.8 * D.s(pz)) });
    this.plugShut = voxSprite('vo_plugvent_shut', () => ventModel(61, 0.8, true), { scale: qscale(0.8 * D.s(pz)) });
    const py = Math.round(D.floorAt(pxx, pz)) + 1;
    const pv = this.plugShut;
    this.plug = { x: pxx, y: py, knocks: 0, shake: 0, t: 9, rect: { x: pxx - pv.ox + 8, y: py - pv.oy, w: pv.w - 16, h: pv.oy }, top: py - pv.oy + Math.round(pv.h * 0.12) };
    const ez = 0.0, ex = Math.round(W * 0.385);
    this.eggSpr = voxSprite('vo_egg', eggModel, { scale: qscale(1.1 * D.s(ez)) });
    const ey = Math.round(D.floorAt(ex, ez)) + 1;
    this.egg = { x: ex, y: ey, warmth: 0, wob: 0, rect: { x: ex - 9, y: ey - this.eggSpr.oy - 2, w: 18, h: this.eggSpr.oy + 4 } };
    const mz = 0.14, mx = Math.round(W * 0.465);
    this.mallow = { x: mx, y: Math.round(D.floorAt(mx, mz)), toast: 0, eaten: false, t: 0 };
    this.mallow.rect = { x: mx - 4, y: this.mallow.y - 30, w: 22, h: 30 };
    D.render([{ key: 'day', strip: this.water }]);
    this.bands = new BandSet(D);
    this.hazeY = Math.round(D.hz - 30);
    this.haze = new FogLayer(hazeMask(W, 76, { peak: 0.5, alpha: 0.8 }), 0, this.hazeY);
    this.floor = new Float32Array(W + 1);
    for (let x = 0; x <= W; x++) this.floor[x] = D.floorAt(x, 0);
    this.vents = vents.map((v) => ({ it: v, x: v.x, y: v.top + Math.round(v.p.h * 0.18), s: v.s, z: v.z, band: v.band, ph: Math.random() * TAU }));
    this.chimneys = chimneys.map((c) => ({ it: c, x: c.x + 1, y: c.top + 3, s: c.s, z: c.z, band: c.band }));
    this.glows = D.items.filter((q) => q.p?.glow).map((q) => ({ c: q.p.glow, x: q.left, y: q.top, band: q.band, a: 1 - D.fog(q.z) * 0.6, ph: hash2(q.x, 2, 9) * TAU }));
    // light sources clustered from the glowing terrain pixels (magma seams and pools)
    this.crackLights = [];
    const cell = 40, gw = Math.ceil(D.LW / cell), gh = Math.ceil(D.TH / cell);
    const acc = new Float32Array(gw * gh * 3);
    for (let y = 0; y < D.TH; y++) for (let x = 0; x < D.LW; x++) {
      const c = D.pc[y * D.LW + x];
      if (!c || !((c >>> 24) & 1)) continue;
      const k = Math.floor(y / cell) * gw + Math.floor(x / cell);
      acc[k * 3] += 1; acc[k * 3 + 1] += x; acc[k * 3 + 2] += y;
    }
    for (let k = 0; k < gw * gh; k++) {
      const n = acc[k * 3];
      if (n < 6) continue;
      const lx = acc[k * 3 + 1] / n - D.pad, ly = acc[k * 3 + 2] / n + D.top;
      const z = D.zAt(ly);
      this.crackLights.push({ x: lx, y: ly, r: clamp(14 + Math.sqrt(n) * 3.2, 18, 64) * (1 - clamp01(z) * 0.4), n, a: clamp01(0.3 + n / 120) * (1 - D.fog(z) * 0.7), ph: hash2(k, 3, 7) * TAU });
    }
    this.crackLights.sort((a, b) => b.n - a.n);
    this.crackLights.length = Math.min(this.crackLights.length, 22);
    this.propLights = [];
    for (const q of D.items) {
      if (!q.p?.lights?.length || q.z > 1.2) continue;
      const l = q.p.lights.slice().sort((a, b) => b.r - a.r)[0];
      this.propLights.push({ x: q.left + l.x, y: q.top + l.y, r: clamp(l.r * 0.9 + 10, 22, 70) * (0.6 + 0.4 * q.s), color: l.color, a: 1 - D.fog(q.z) * 0.75 });
    }
    this.propLights.sort((a, b) => b.r * b.a - a.r * a.a);
    this.propLights.length = Math.min(this.propLights.length, 10);
  }

  buildLayers() {
    const W = this.W, H = this.H, pad = 30, D = this.D;
    this.pad = pad;
    const LW = W + pad * 2;
    const r = new RNG(17);
    const hz = D.hz;
    // far A: towering rift walls with lava falls, spires at the rift's end
    const yA = Math.round(hz - H * 0.42), hA = H - yA;
    const mA = new Mask(LW, hA);
    const baseA = hz - yA + 10;
    const rA = ridge(LW, baseA - 40, 24, 0.008, 6.1, 4, 0.4);
    mA.below((x) => rA[x]);
    for (let i = 0; i < 9; i++) { const px0 = r.float(0.25, 0.75) * LW, tp = r.float(10, baseA - 110), w = r.float(6, 16); mA.poly([[px0 - w * 1.4, baseA], [px0 - w * 0.3, tp + 10], [px0, tp], [px0 + w * 0.4, tp + 14], [px0 + w * 1.5, baseA]]); }
    for (const side of [0, 1]) for (let x = 0; x < LW * 0.3; x++) { const xx = side ? LW - 1 - x : x; const tp = baseA - 260 + x * 0.6 + (fbm2(x * 0.03, side, 2, 3) - 0.5) * 60; for (let y = Math.max(0, Math.round(tp)); y < baseA; y++) mA.set(xx, y, 1); }
    this.falls = [];
    for (const fxf of [0.12, 0.23, 0.8, 0.9]) {
      const fx = Math.round(fxf * LW);
      for (let y = 0; y < baseA; y++) if (mA.get(fx, y)) { this.falls.push({ x: fx - pad, y0: yA + y, y1: yA + baseA - 6, w: 2 + (fxf * 10 % 2 > 1 ? 1 : 0) }); break; }
    }
    const palA = stopPalette([[0, '#0a0608'], [1, '#2a1a1e']], 5);
    this.farA = new FogLayer(mA.toCanvas((x, y, v, up) => (up <= 1 ? pack('#6a3a30') : ditherPick(palA, 0.6 - Math.min(1, up / 70) * 0.45 + (fbm2(x * 0.05, y * 0.05, 2, 2) - 0.5) * 0.3, x, y))), -pad, yA);
    this.farAY = yA;
    // far B: the rift horizon dotted with distant vents and spires
    const yB = Math.round(hz - 110), hB = H - yB;
    const mB = new Mask(LW, hB);
    const baseB = hz - yB + 16;
    const rB = ridge(LW, baseB - 6, 9, 0.012, 2.9, 3);
    mB.below((x) => rB[x]);
    this.farVents = [];
    for (let i = 0; i < 14; i++) {
      const px0 = r.float(0.08, 0.92) * LW, b = rB[Math.round(px0)] + 2;
      if (r.chance(0.5)) { const hh = r.float(14, 34); mB.poly([[px0 - hh * 0.7, b], [px0 - 2, b - hh], [px0 + 2, b - hh], [px0 + hh * 0.7, b]]); this.farVents.push({ x: px0 - pad, y: yB + b - hh, ph: r.float(0, TAU) }); }
      else { const hh = r.float(24, 60); mB.poly([[px0 - 5, b], [px0, b - hh], [px0 + 4, b]]); }
    }
    const palB = stopPalette([[0, '#0e0808'], [1, '#2e1a1a']], 5);
    this.farB = new FogLayer(mB.toCanvas((x, y, v, up) => (up <= 1 ? pack('#8a4030') : up === 2 ? pack('#4a2420') : ditherPick(palB, 0.6 - Math.min(1, up / 40) * 0.45 + (fbm2(x * 0.08, y * 0.08, 2, 5) - 0.5) * 0.35, x, y))), -pad, yB);
    this.farBY = yB;
    // the molten leviathan's silhouette in the far haze
    this.disc = [];
    for (let rr = 1; rr <= 26; rr++) this.disc.push(paint(rr * 2 + 1, rr * 2 + 1, (x, y) => (Math.hypot(x - rr, y - rr) <= rr + 0.2 ? pack('#ffffff') : 0)));
    this.levi = null; this.leviT = 12;
  }

  buildLife() {
    const W = this.W, H = this.H, D = this.D, sy = this.surfY();
    const r = new RNG(23);
    this.decor = new DepthDecor(D);
    // heat-loving bacterial mats & red "tube" filaments swaying near vents
    for (const [xf, z, cols] of [[0.36, 0.05, ['#4a1a14', '#7a2a1a', '#b84a2a', '#ff8a4a']], [0.58, 0.2, ['#3a2a14', '#6a4a1a', '#a87a2a', '#e8c04a']], [0.71, -0.05, ['#4a1a14', '#7a2a1a', '#b84a2a', '#ff8a4a']], [0.27, 0.55, ['#3a2a14', '#6a4a1a', '#a87a2a', '#e8c04a']], [0.5, 0.7, ['#4a1a14', '#7a2a1a', '#b84a2a', '#ff8a4a']], [0.8, 0.45, ['#3a2a14', '#6a4a1a', '#a87a2a', '#e8c04a']], [0.13, 0.12, ['#4a1a14', '#7a2a1a', '#b84a2a', '#ff8a4a']]]) {
      const s = D.s(z), x0 = Math.round(xf * W), y0 = Math.round(D.floorAt(x0, z)) + 1;
      const st = new Strands();
      const k = r.int(5, 8);
      for (let i = 0; i < k; i++) {
        const lean = (i / (k - 1) - 0.5) * 0.7 + r.float(-0.1, 0.1);
        st.add({ x: x0 + Math.round(lean * 9 * s), y: y0, n: Math.max(3, Math.round(r.int(4, 9) * Math.min(1.1, s))), seg: 2, w: 1, amp: 0.22, speed: 1.8, sec: 2, phase: r.float(0, TAU), wave: 0.6, lean, curl: lean * 0.3, cols, out: null, hl: false, tip: '#ffe0a0', tipR: 1 });
      }
      this.decor.add({ anim: new SwayAnim(st, { frames: 16 }), z, off: r.int(0, 15) });
    }
    this.decor.refog(() => '#2a1a1e', 'k');
    this.sal = salamanderFrames();
    this.salL = this.sal.map((c) => { const o = makeCanvas(c.width, c.height), g = ctxOf(o); g.translate(c.width, 0); g.scale(-1, 1); g.drawImage(c, 0, 0); return o; });
    this.baby = null;
    // particles
    this.embers = new Motes(90, { x0: 0, y0: sy, x1: W, y1: H - 30 }, { seed: 3, vx: [-2, 2], vy: [-14, -5], sizes: [1, 1, 2], colors: ['#ff8a2a', '#ffc04a', '#ff5a1a', '#fff0a0'], alpha: [0.5, 1], wob: 5 });
    this.ash = new Motes(140, { x0: 0, y0: sy, x1: W, y1: H }, { seed: 5, vx: [-3, 3], vy: [4, 10], sizes: [1, 1, 2], colors: ['#5a5054', '#7a7074', '#3a3438', '#9a9094'], alpha: [0.3, 0.8], wob: 4 });
    this.sulfur = new Motes(70, { x0: 0, y0: sy, x1: W, y1: H }, { seed: 7, vx: [-2, 2], vy: [-3, 2], sizes: [1, 2], colors: ['#d8e05a', '#c8c040', '#e8f08a'], alpha: [0.2, 0.6], wob: 6 });
    this.nearAsh = new Motes(24, { x0: 0, y0: sy, x1: W, y1: H }, { seed: 9, vx: [-4, 4], vy: [3, 8], sizes: [2, 3], colors: ['#6a6064'], alpha: [0.15, 0.35], wob: 7 });
    this.bubbles = new Bubbles(140, '#ffd8b0');
    this.lavaBlobs = [];
    for (let i = 0; i < 16; i++) this.lavaBlobs.push({ x: r.float(0, W), y: r.float(0, H), v: -r.float(6, 16), ph: r.float(0, TAU), s: r.int(2, 4) });
    this.smoke = [];
    for (let i = 0; i < 16; i++) this.smoke.push({ k: i / 16, ph: r.float(0, TAU), s: r.float(0.7, 1.3) });
    this.puffS = [2, 3, 4, 5, 6, 7, 8, 9].map((rr) => paint(rr * 2 + 1, rr * 2 + 1, (x, y) => (Math.hypot(x - rr, y - rr) <= rr + 0.2 ? pack('#ffffff') : 0)));
    this.puffY = this.puffS.map((c) => tinted(c, '#c8c050'));
    this.puffK = this.puffS.map((c) => tinted(c, '#16100e'));
  }

  // ------------------------------------------------------------------ update
  update(dt, env) {
    dt = Math.max(0, Math.min(dt, 0.1));
    this.t += dt;
    const t = this.t, W = this.W, H = this.H;
    const tod = todWeights(env);
    this.tod = tod;
    const snap = this.fresh;
    const k = snap ? 1 : 1 - Math.exp(-dt * 0.6);
    const w = env.weather, wx = this.wx;
    wx.erupt += ((w === 'eruption' ? 1 : 0) - wx.erupt) * k;
    wx.sulfur += ((w === 'sulfur' ? 1 : 0) - wx.sulfur) * k;
    wx.magma += ((w === 'magma' ? 1 : 0) - wx.magma) * k;
    const c = env.cursor;
    const tx = c && c.x > -50 ? (c.x / W - 0.5) * -2 : 0, ty = c && c.y > -50 ? (c.y / H - 0.5) * -2 : 0;
    const kp = snap ? 1 : 1 - Math.exp(-dt * 2.5);
    this.par.x += (tx - this.par.x) * kp;
    this.par.y += (ty - this.par.y) * kp;
    this.fresh = false;
    this.fogColor = qmix(qmix('#2a1a1e', '#3a3020', wx.sulfur), '#3a1a12', wx.magma * 0.5);
    const sy = this.surfY();
    waveLine(this.ys, W, sy, t * 0.5, 1 + wx.erupt * 1.6, 0.3 + wx.erupt * 0.8, 0.8);
    // eruption rumbles: shake, flash, lava bombs from the far vents, a burst of embers
    this.flash = Math.max(0, this.flash - dt * 2);
    this.rumble = Math.max(0, this.rumble - dt * 0.8);
    if (wx.erupt > 0.5) {
      this.rumbleT -= dt;
      if (this.rumbleT <= 0) {
        this.rumbleT = 6 + Math.random() * 8;
        this.rumble = 1; this.flash = 0.6;
        try { this.game?.camera?.shake?.(5 + Math.random() * 3); this.game?.audio?.play?.('eruption_boom', { vol: 0.7 }); } catch { /* optional */ }
        for (let i = 0; i < 5; i++) this.bombs.push({ x: this.crater.x + (Math.random() - 0.5) * 10, y: this.crater.y, vx: (Math.random() - 0.5) * 120, vy: -90 - Math.random() * 90, t: 0 });
      }
    }
    for (const b of this.bombs) { b.t += dt; b.vy += 120 * dt; b.x += b.vx * dt; b.y += b.vy * dt; }
    this.bombs = this.bombs.filter((b) => b.t < 4 && b.y < sy);
    // particles
    const heat = 1 + wx.magma * 0.8 + wx.erupt * 0.6;
    this.embers.update(dt * heat, Math.sin(t * 0.3) * 2, 0);
    this.ash.update(dt * (0.4 + wx.erupt * 1.2), Math.sin(t * 0.2) * 3, 0);
    this.sulfur.update(dt, Math.sin(t * 0.15) * 4, 0);
    this.nearAsh.update(dt * (0.5 + wx.erupt), 2, 0);
    this.bubbles.update(dt, sy);
    for (const b of this.lavaBlobs) { b.y += b.v * dt * (0.5 + wx.magma); if (b.y < sy) { b.y = H - 40; b.x = Math.random() * W; } }
    // boiling bubble columns from the vents (and the popped plug)
    const rate = 5 * heat;
    for (const v of this.vents) {
      if (Math.random() < dt * rate * (v.z < 1 ? 1 : 0.4)) this.bubbles.emit(v.x + (Math.random() - 0.5) * 6 * v.s, v.y, { r: Math.random() < 0.35 ? 2 : 1, vy: -30 - Math.random() * 20, wob: 2.2 });
    }
    const pl = this.plug;
    pl.shake = Math.max(0, pl.shake - dt * 3);
    pl.t += dt;
    const open = this.secrets().volcano_plug;
    if (open && Math.random() < dt * rate * 1.2) this.bubbles.emit(pl.x + (Math.random() - 0.5) * 8, pl.top, { r: Math.random() < 0.4 ? 2 : 1, vy: -40 - Math.random() * 30, wob: 2.5 });
    if (pl.t < 2) for (let i = 0; i < 3; i++) this.bubbles.emit(pl.x + (Math.random() - 0.5) * 16, pl.top - Math.random() * 10, { r: 1 + Math.floor(Math.random() * 3), vy: -60 - Math.random() * 60 });
    // egg & baby salamander
    const e = this.egg;
    e.wob = Math.max(0, e.wob - dt * 2);
    e.warmth = Math.max(this.secrets().volcano_egg ? 0 : 0, e.warmth - dt * 0.02);
    if (this.secrets().volcano_egg && !this.baby) this.baby = { x: e.x + 10, dir: 1, t: 2, state: 'walk', f: 0 };
    if (this.baby) {
      const b = this.baby;
      b.t -= dt;
      if (b.state === 'walk') { b.x += b.dir * dt * 10; b.f += dt * 8; if (b.x < W * 0.3 || b.x > W * 0.62) b.dir *= -1; }
      if (b.t <= 0) { b.state = b.state === 'walk' ? 'rest' : 'walk'; b.t = 1 + Math.random() * 3; if (Math.random() < 0.4) b.dir *= -1; }
    }
    const m = this.mallow;
    if (m.toast > 0 && m.toast < 3 && !m.eaten) m.t += dt;
    // far giant
    const L = this.levi;
    if (L) {
      L.x += L.dir * L.v * dt; L.ph += dt * 0.6;
      if ((L.dir > 0 && L.x - L.len > W + 60) || (L.dir < 0 && L.x + L.len < -60)) { this.levi = null; this.leviT = 35 + Math.random() * 50; }
    } else if ((this.leviT -= dt * (1 + wx.erupt + wx.magma)) <= 0) {
      const dir = Math.random() < 0.5 ? 1 : -1;
      this.levi = { x: dir > 0 ? -40 : W + 40, y: this.D.hz - 100 - Math.random() * 80, dir, v: 10 + Math.random() * 5, len: 360 + Math.random() * 180, rmax: 9 + Math.random() * 4, ph: 0 };
    }
    this.hint += dt;
    env.flash = this.flash;
  }

  // ------------------------------------------------------------------ draw
  drawBack(ctx, env) {
    this.nearHooked = !!this.nearSeen;
    this.nearSeen = false;
    const W = this.W, H = this.H, t = this.t, wx = this.wx, tod = this.tod;
    const sy = this.surfY(), ys = this.ys;
    const view = env.view;
    const y0 = view ? Math.floor(view.y0) - 2 : -10, y1 = view ? Math.ceil(view.y1) + 2 : H;
    if (y0 < sy + 16) {
      this.drawSky(ctx, env, y0);
      const wp = new Path2D();
      wp.moveTo(0, y1);
      waveRuns(ys, W, (x0, len, y) => { wp.lineTo(x0, y); wp.lineTo(x0 + len, y); });
      wp.lineTo(W, y1);
      wp.closePath();
      ctx.fillStyle = ctx.createPattern(this.water, 'repeat');
      ctx.fill(wp);
      this.drawSurface(ctx);
    } else fillWith(ctx, this.water, 0, y0, W, y1 - y0);
    // dim red light from far above (only noticeable while scrolled up / in daylight)
    const rayA = (0.25 + tod.day * 0.35) * (1 - wx.sulfur * 0.5);
    if (y0 < 100) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = rayA * (0.7 + 0.3 * Math.sin(t * 0.3));
      ctx.drawImage(this.rays, Math.round(Math.sin(t * 0.04) * 16), sy);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    }
    const px0 = this.par.x, py0 = this.par.y;
    const wob = quality(env) >= 1 ? 1.4 : 0;
    drawWobble(ctx, this.farA.tint(this.water, 0.55, 'a'), -this.pad + px0 * 0.8, this.farAY + py0 * 0.4, t, wob, 3, 1.4, 0.11);
    this.drawFalls(ctx, px0 * 0.8, py0 * 0.4);
    this.drawLeviathan(ctx);
    drawWobble(ctx, this.farB.tint(this.water, 0.45, 'b'), -this.pad + px0 * 1.4, this.farBY + py0 * 0.5, t + 2, wob, 3, 1.6, 0.13);
    ctx.globalCompositeOperation = 'lighter';
    for (const v of this.farVents) drawGlow(ctx, v.x + px0 * 1.4, v.y + py0 * 0.5, 5, '#ff7a2a', 0.35 + 0.25 * Math.sin(t * 2 + v.ph) + wx.magma * 0.3);
    ctx.globalCompositeOperation = 'source-over';
    this.paintBand(ctx, 2, px0 * 2, py0 * 0.6);
    ctx.drawImage(this.haze.tint(this.water, 1, 'h'), 0, this.hazeY);
    if (wx.sulfur > 0.05) { ctx.fillStyle = rgba('#6a6a2a', wx.sulfur * 0.18); ctx.fillRect(0, Math.max(y0, sy), W, y1 - Math.max(y0, sy)); }
  }

  drawSky(ctx, env, y0) {
    const W = this.W, t = this.t, tod = this.tod, wx = this.wx, skyY = this.skyY, sy = this.surfY();
    const w3 = (o) => [[o.day, tod.day], [o.dusk, tod.dusk], [o.night, tod.night]];
    ctx.drawImage(this.skyBlend.get(w3(this.sky)), 0, skyY);
    // ash plume rising and leaning in the wind
    const cr = this.crater, act = 0.55 + wx.erupt * 0.45;
    for (const p of this.plume) {
      const k = (p.k + t * (0.03 + wx.erupt * 0.04)) % 1;
      const x = cr.x + k * k * 160 * (1 + wx.erupt * 0.4) + Math.sin(t * 0.4 + p.ph + k * 3) * 10 * k + p.dx * 8 * k;
      const y = cr.y - k * 150 * (0.6 + act * 0.6);
      const ri = clamp(Math.floor(k * 8 * p.s), 0, 7);
      const spr = this.puff[ri];
      ctx.globalAlpha = (1 - k) * 0.85 * act;
      ctx.drawImage(tinted(spr, tod.night > 0.5 ? '#1a1214' : tod.dusk > 0.5 ? '#4a2a2a' : '#4a4246'), Math.round(x - spr.width / 2), Math.round(y - spr.height / 2));
    }
    ctx.globalAlpha = 1;
    ctx.drawImage(this.mtnBlend.get(w3(this.mtn)), 0, skyY);
    // glowing lava rivers pulse, crater glow, lava bombs
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.25 + 0.15 * Math.sin(t * 1.3) + wx.erupt * 0.3 + tod.night * 0.25;
    ctx.drawImage(tinted(this.lavaMask, '#ff6a1a'), 0, skyY);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    drawGlow(ctx, cr.x, cr.y + 2, 14 + wx.erupt * 10, '#ff7a2a', 0.6 + 0.2 * Math.sin(t * 3) + wx.erupt * 0.3);
    ctx.fillStyle = '#ffd060';
    for (const b of this.bombs) { ctx.fillRect(Math.round(b.x), Math.round(b.y), 2, 2); drawGlow(ctx, b.x, b.y, 4, '#ff7a2a', 0.8); }
    // falling ash over the sky
    if (wx.erupt > 0.05 || wx.sulfur > 0.05) {
      const pat = ctx.createPattern(this.ashTile, 'repeat');
      pat.setTransform(new DOMMatrix([1, 0, 0, 1, Math.round(t * 12), Math.round(t * 20)]));
      ctx.globalAlpha = clamp01(wx.erupt * 0.7 + wx.sulfur * 0.4);
      ctx.fillStyle = pat;
      ctx.fillRect(0, skyY, W, sy - skyY);
      ctx.globalAlpha = 1;
    }
    if (this.flash > 0.02) { ctx.fillStyle = rgba('#ff8a4a', this.flash * 0.25); ctx.fillRect(0, skyY, W, sy - skyY); }
  }

  drawSurface(ctx) {
    const W = this.W, ys = this.ys, t = this.t;
    const crest = new Path2D(), sub = new Path2D();
    waveRuns(ys, W, (x0, len, y) => { crest.rect(x0, y, len, 1); sub.rect(x0, y + 1, len, 2); });
    ctx.fillStyle = '#7a6a64';
    ctx.globalAlpha = 0.6;
    ctx.fill(sub);
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#c8b8b0';
    ctx.fill(crest);
    // pumice rafts and steam where hot water meets the air
    ctx.fillStyle = '#8a7a70';
    for (let i = 0; i < 9; i++) {
      const x = Math.round(((i * 137 + t * (3 + i % 3)) % (W + 40)) - 20);
      if (x < 0 || x >= W) continue;
      ctx.fillRect(x, ys[x] - 1, 3 + (i % 3) * 2, 2);
    }
    ctx.fillStyle = '#e8e0dc';
    for (let i = 0; i < 14; i++) {
      const ph = (t * 0.4 + i * 0.37) % 1;
      const x = Math.round((i * 71.3) % W);
      ctx.globalAlpha = (1 - ph) * 0.35;
      ctx.fillRect(x + Math.round(Math.sin(ph * 6 + i) * 3), ys[x] - 2 - Math.round(ph * 18), 2 + Math.round(ph * 3), 1 + Math.round(ph * 2));
    }
    ctx.globalAlpha = 1;
  }

  drawFalls(ctx, dx, dy) {
    const t = this.t, wx = this.wx;
    for (const f of this.falls) {
      const x = Math.round(f.x + dx);
      ctx.fillStyle = '#ff6a1a';
      ctx.globalAlpha = 0.6;
      ctx.fillRect(x, Math.round(f.y0 + dy), f.w, Math.round(f.y1 - f.y0));
      ctx.fillStyle = '#ffd060';
      ctx.globalAlpha = 0.9;
      for (let k = 0; k < 5; k++) {
        const y = f.y0 + ((t * 40 + k * 37) % (f.y1 - f.y0));
        ctx.fillRect(x, Math.round(y + dy), 1, 4);
      }
      ctx.globalAlpha = 1;
      drawGlow(ctx, x + 1, f.y1 + dy, 10, '#ff6a1a', 0.45 + wx.magma * 0.3);
    }
  }

  drawLeviathan(ctx) {
    const L = this.levi;
    if (!L) return;
    const W = this.W, t = this.t, n = 46;
    if (!this.leviLayer) this.leviLayer = makeLayer(W, 110);
    const g = this.leviLayer.ctx, oy = Math.round(L.y - 55);
    g.globalCompositeOperation = 'source-over';
    g.clearRect(0, 0, W, 110);
    const pts = [];
    for (let i = 0; i < n; i++) {
      const u = i / (n - 1);
      const x = L.x - L.dir * u * L.len + this.par.x;
      const y = 55 + Math.sin(L.ph * 2 - u * 8) * 14 * (0.3 + u) + this.par.y * 0.4;
      const rr = Math.max(1, Math.round(L.rmax * (u < 0.08 ? 0.8 + u * 2.5 : 1 - Math.pow((u - 0.08) / 0.92, 1.2) * 0.9)));
      pts.push([x, y, rr]);
    }
    for (let i = n - 1; i >= 0; i--) { const [x, y, rr] = pts[i]; if (x < -40 || x > W + 40) continue; g.drawImage(this.disc[Math.min(25, rr - 1)], Math.round(x - rr), Math.round(y - rr)); }
    g.globalCompositeOperation = 'source-in';
    g.fillStyle = '#120808';
    g.fillRect(0, 0, W, 110);
    g.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 0.55;
    ctx.drawImage(this.leviLayer.canvas, 0, oy);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 2; i < n - 6; i += 3) {
      const [x, y, rr] = pts[i];
      ctx.globalAlpha = 0.35 + 0.35 * Math.sin(t * 3 + i * 0.5);
      ctx.fillStyle = i % 2 ? '#ff7a2a' : '#ffc04a';
      ctx.fillRect(Math.round(x), Math.round(oy + y - rr * 0.3), 2, 1);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    drawGlow(ctx, pts[0][0] + L.dir * pts[0][2] * 0.5, oy + pts[0][1] - 2, 5, '#ffb04a', 0.6);
  }

  drawSeabed(ctx, env) {
    const t = this.t, wx = this.wx, q = quality(env);
    this.ash.draw(ctx, t, 0.6 + wx.erupt * 0.4, q * (0.35 + wx.erupt * 0.65), 0.2);
    if (wx.sulfur > 0.05) this.sulfur.draw(ctx, t, wx.sulfur, q, 0.4);
    this.paintBand(ctx, 1, this.par.x * 3, this.par.y * 0.8);
    if (!this.nearHooked) this.paintNear(ctx, env);
  }

  drawNear(ctx, env) {
    this.nearSeen = true;
    if (this.nearHooked) this.paintNear(ctx, env);
  }

  paintNear(ctx) {
    const t = this.t;
    this.paintBand(ctx, 0, this.par.x * 4, this.par.y);
    ctx.save();
    ctx.translate(Math.round(this.par.x * 4), Math.round(this.par.y));
    this.drawSecrets(ctx);
    ctx.restore();
    this.bubbles.draw(ctx, t);
  }

  paintBand(ctx, b, dx, dy) {
    const t = this.t, wx = this.wx;
    this.bands.draw(ctx, b, null, dx, dy);
    ctx.save();
    ctx.translate(Math.round(dx), Math.round(dy));
    const gk = 1 + wx.magma * 0.7 + wx.erupt * 0.3;
    ctx.globalCompositeOperation = 'lighter';
    for (const gl of this.glows) {
      if (gl.band !== b) continue;
      ctx.globalAlpha = clamp01((0.4 + 0.2 * Math.sin(t * 1.4 + gl.ph)) * gk * gl.a);
      ctx.drawImage(gl.c, gl.x, gl.y);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    for (const v of this.vents) if (v.band === b) this.drawVentFx(ctx, v);
    for (const c of this.chimneys) if (c.band === b) this.drawChimneySmoke(ctx, c);
    ctx.restore();
    this.decor.draw(ctx, b, t, dx, dy, 1 + wx.magma);
  }

  drawVentFx(ctx, v) {
    const t = this.t, wx = this.wx, s = v.s;
    drawGlow(ctx, v.x, v.y, Math.round(12 * s) + 2, '#ff8a2a', 0.5 + 0.25 * Math.sin(t * 4 + v.ph) + wx.magma * 0.3);
    // shimmering hot water column
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = '#ff8a4a';
    for (let i = 0; i < 3; i++) for (let j = 0; j < 16; j++) {
      const k = (j / 16 + t * 0.5 + i * 0.33) % 1;
      const y = v.y - k * 70 * s;
      const x = v.x - 4 * s + i * 4 * s + Math.sin(y * 0.3 + t * 5 + i) * 2;
      ctx.globalAlpha = (1 - k) * 0.18 * (1 + wx.magma);
      ctx.fillRect(Math.round(x), Math.round(y), 1, 2);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  drawChimneySmoke(ctx, c) {
    const t = this.t, wx = this.wx, s = c.s;
    for (const p of this.smoke) {
      const k = (p.k + t * 0.06) % 1;
      const y = c.y - k * 130 * s;
      const x = c.x + Math.sin(t * 0.7 + p.ph + k * 4) * (2 + k * 12) * s + k * 20 * s;
      const ri = clamp(Math.floor(k * 8 * p.s * s), 0, 7);
      ctx.globalAlpha = (1 - k) * (0.45 + wx.sulfur * 0.3);
      const spr = (p.k * 16) % 3 < 1 ? this.puffK[ri] : this.puffY[ri];
      ctx.drawImage(spr, Math.round(x - spr.width / 2), Math.round(y - spr.height / 2));
    }
    ctx.globalAlpha = 1;
    drawGlow(ctx, c.x, c.y + 1, 6, '#d8ff6a', 0.5 + 0.2 * Math.sin(t * 5));
  }

  drawSecrets(ctx) {
    const t = this.t, sec = this.secrets();
    // plugged vent
    const p = this.plug, open = sec.volcano_plug;
    const spr = open ? this.plugOpen : this.plugShut;
    const sx = Math.round(Math.sin(t * 60) * p.shake * 2);
    ctx.drawImage(spr.canvas, p.x - spr.ox + sx, p.y - spr.oy);
    if (open) {
      if (spr.glow) { ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.5 + 0.2 * Math.sin(t * 3); ctx.drawImage(spr.glow, p.x - spr.ox, p.y - spr.oy); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; }
      drawGlow(ctx, p.x, p.top, 10, '#ffb04a', 0.6 + 0.2 * Math.sin(t * 5));
    } else {
      // the obsidian plug
      ctx.fillStyle = '#120e18'; ctx.fillRect(p.x - 5 + sx, p.top - 4, 10, 6); ctx.fillRect(p.x - 3 + sx, p.top - 6, 6, 2);
      ctx.fillStyle = '#5a4a8a'; ctx.fillRect(p.x - 4 + sx, p.top - 4, 3, 1); ctx.fillRect(p.x - 2 + sx, p.top - 6, 2, 1);
      if (p.knocks > 0) { ctx.fillStyle = '#ff8a2a'; for (let i = 0; i < p.knocks * 3; i++) ctx.fillRect(p.x - 4 + i + sx, p.top - 2 + (i % 2), 1, 1); }
      const hk = ((this.hint + 2) % 8) / 8;
      if (hk < 0.12) twinkle(ctx, p.x + 3, p.top - 6, Math.sin((hk / 0.12) * Math.PI), '#ffd0a0');
    }
    // egg / hatched shell
    const e = this.egg, es = this.eggSpr;
    if (!sec.volcano_egg) {
      const wob = Math.round(Math.sin(t * 30) * e.wob * 1.5);
      ctx.drawImage(es.canvas, e.x - es.ox + wob, e.y - es.oy);
      drawGlow(ctx, e.x, e.y - es.oy * 0.5, 9, '#ff7a2a', 0.25 + e.warmth * 0.5 + 0.1 * Math.sin(t * 2));
    } else {
      ctx.fillStyle = '#3a2028'; ctx.fillRect(e.x - 5, e.y - 4, 3, 3); ctx.fillRect(e.x + 2, e.y - 3, 4, 2); ctx.fillRect(e.x - 1, e.y - 2, 2, 2);
    }
    if (this.baby) {
      const b = this.baby, fr = b.dir > 0 ? this.sal : this.salL;
      const y = Math.round(this.D.floorAt(b.x, 0.02));
      ctx.drawImage(fr[b.state === 'walk' ? Math.floor(b.f) % 4 : 0], Math.round(b.x) - 8, y - 7);
      drawGlow(ctx, b.x, y - 3, 5, '#ff8a2a', 0.4);
    }
    // marshmallow on a stick, propped against a rock near a crack
    const m = this.mallow;
    ctx.fillStyle = '#6a4a2a';
    for (let i = 0; i < 22; i++) ctx.fillRect(m.x + Math.round(i * 0.55), m.y - i, 1, 1);
    if (!m.eaten) {
      const tc = m.toast >= 2 ? (m.t > 2.5 ? '#2a1a14' : '#c8803a') : m.toast === 1 ? '#f0d8b0' : '#ffffff';
      ctx.fillStyle = '#1a1010'; ctx.fillRect(m.x + 9, m.y - 27, 7, 7);
      ctx.fillStyle = tc; ctx.fillRect(m.x + 10, m.y - 26, 5, 5);
      ctx.fillStyle = m.toast >= 2 ? '#e8a860' : '#ffffff'; ctx.fillRect(m.x + 10, m.y - 26, 2, 1);
      if (m.toast >= 1) for (let i = 0; i < 3; i++) { const k = (t * 0.6 + i / 3) % 1; ctx.globalAlpha = (1 - k) * 0.5; ctx.fillStyle = '#d8d0c8'; ctx.fillRect(m.x + 11 + Math.round(Math.sin(k * 6 + i) * 2), m.y - 28 - Math.round(k * 12), 1, 2); }
      ctx.globalAlpha = 1;
    }
  }

  drawFront(ctx, env) {
    const t = this.t, wx = this.wx, q = quality(env), W = this.W;
    this.nearAsh.draw(ctx, t, 0.6 + wx.erupt * 0.5, q * (0.4 + wx.erupt * 0.6));
    // embers rising
    const n = Math.round(this.embers.list.length * q * (0.35 + wx.erupt * 0.5 + wx.magma * 0.3));
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < n; i++) {
      const p = this.embers.list[i];
      const k = 0.5 + 0.5 * Math.sin(t * p.tw * 2 + p.ph);
      if (k < 0.25) continue;
      const x = p.x + Math.sin(t * 0.9 + p.ph) * 4, y = p.y;
      ctx.globalAlpha = k * 0.9;
      ctx.fillStyle = p.c;
      ctx.fillRect(Math.round(x), Math.round(y), p.s, p.s);
      if (i % 4 === 0) drawGlow(ctx, x, y, 3, '#ff6a1a', k * 0.5);
    }
    ctx.globalAlpha = 1;
    // magma bloom: glowing blobs drifting up
    if (wx.magma > 0.05) {
      for (const b of this.lavaBlobs) {
        const x = Math.round(b.x + Math.sin(t + b.ph) * 4), y = Math.round(b.y);
        ctx.globalAlpha = wx.magma * 0.8;
        ctx.fillStyle = '#ff7a2a';
        ctx.fillRect(x - b.s + 1, y - b.s, b.s * 2 - 2, b.s * 2); ctx.fillRect(x - b.s, y - b.s + 1, b.s * 2, b.s * 2 - 2);
        ctx.fillStyle = '#ffe080'; ctx.fillRect(x - b.s + 1, y - b.s + 1, 1, 1);
        drawGlow(ctx, x, y, b.s + 4, '#ff6a1a', wx.magma * 0.5);
      }
      ctx.globalAlpha = 1;
    }
    ctx.globalCompositeOperation = 'source-over';
    if (q >= 1) this.heatShimmer(ctx);
    if (wx.sulfur > 0.05) {
      const pat = ctx.createPattern(this.ashTile, 'repeat');
      pat.setTransform(new DOMMatrix([1, 0, 0, 1, Math.round(t * 6), Math.round(Math.sin(t * 0.2) * 12)]));
      ctx.globalAlpha = wx.sulfur * 0.3;
      ctx.fillStyle = rgba('#a8a040', 1);
      ctx.fillRect(0, env.view ? env.view.y0 : 0, W, this.H + 400);
      ctx.globalAlpha = 1;
    }
    if (this.flash > 0.02) { ctx.fillStyle = rgba('#ff7a3a', this.flash * 0.12); ctx.fillRect(0, env.view ? env.view.y0 : 0, W, this.H + 400); }
  }

  // Heat shimmer: copy the finished pixels above each near/mid vent once, then lay them back in 2 px rows with a
  // travelling sine x-offset.
  heatShimmer(ctx) {
    const m = ctx.getTransform(), t = this.t;
    const cw = ctx.canvas.width, ch = ctx.canvas.height;
    const list = this.vents.filter((v) => v.z < 0.8).map((v) => [v.x, v.y, 22 * v.s, 64 * v.s]);
    if (this.secrets().volcano_plug) list.push([this.plug.x, this.plug.top, 14, 40]);
    if (!this.shimmerL) this.shimmerL = makeLayer(64, 160);
    const L = this.shimmerL;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    for (const [wx0, wy0, hw, hh] of list) {
      const sx = Math.round(m.a * (wx0 - hw) + m.e), sy = Math.round(m.d * (wy0 - hh) + m.f);
      const w = Math.min(64, Math.round(hw * 2 * m.a)), h = Math.min(160, Math.round(hh * m.d));
      if (sx < 2 || sy < 0 || sx + w > cw - 2 || sy + h > ch || w < 4 || h < 4) continue;
      L.ctx.clearRect(0, 0, w, h);
      L.ctx.drawImage(ctx.canvas, sx, sy, w, h, 0, 0, w, h);
      for (let r = 0; r < h; r += 2) {
        const o = Math.round(Math.sin(t * 7 + (sy + r) * 0.35) * 1.4 * (0.4 + 0.6 * r / h));
        if (o) ctx.drawImage(L.canvas, 0, r, w, 2, sx + o, sy + r, w, 2);
      }
    }
    ctx.restore();
  }

  // ------------------------------------------------------------------ lighting
  lighting(env) {
    const tod = todWeights(env), wx = this.wx, t = this.t;
    let dark = 0.66 + tod.night * 0.12 - wx.magma * 0.08 + wx.sulfur * 0.06;
    dark *= 1 - skyward(env, this.H) * 0.62;
    const tint = qmix(qmix('#1c0c10', '#1e1c08', wx.sulfur * 0.6), '#2a0a06', wx.magma * 0.5);
    const lights = [];
    const gk = 1 + wx.magma * 0.5 + wx.erupt * 0.25;
    for (const l of this.crackLights) lights.push({ x: l.x, y: l.y, r: l.r * (1 + wx.magma * 0.3), color: '#ff6a1a', a: clamp01(l.a * (0.75 + 0.25 * Math.sin(t * 1.3 + l.ph)) * gk) });
    for (const l of this.propLights) lights.push({ x: l.x, y: l.y, r: l.r, color: l.color, a: clamp01(0.7 * l.a * gk) });
    for (const v of this.vents) lights.push({ x: v.x, y: v.y, r: 70 * v.s, color: '#ff8a3a', a: clamp01((0.75 + 0.2 * Math.sin(t * 5 + v.ph)) * (1 - this.D.fog(v.z) * 0.6) * gk) });
    for (const c of this.chimneys) if (c.z < 1) lights.push({ x: c.x, y: c.y, r: 36 * c.s, color: '#c8e05a', a: 0.5 });
    const p = this.plug;
    if (this.secrets().volcano_plug) lights.push({ x: p.x, y: p.top, r: 60, color: '#ffa04a', a: 0.85 });
    lights.push({ x: this.egg.x, y: this.egg.y - 6, r: 26 + this.egg.warmth * 20, color: '#ff7a2a', a: 0.45 + this.egg.warmth * 0.4 });
    if (this.baby) lights.push({ x: this.baby.x, y: this.floorAt(this.baby.x) - 4, r: 22, color: '#ff8a2a', a: 0.5 });
    if (this.flash > 0.05) lights.push({ x: this.W / 2, y: this.H * 0.3, r: this.W * 0.7, color: '#ff6a2a', a: this.flash * 0.6 });
    return { dark: clamp(dark, 0, 0.82), tint, lights };
  }

  // ------------------------------------------------------------------ secrets
  secretAt(x, y) {
    if (!this.secrets().volcano_plug && inRect(x, y, this.plug.rect, 2)) return 'plug';
    if (!this.secrets().volcano_egg && inRect(x, y, this.egg.rect, 2)) return 'egg';
    if (!this.mallow.eaten && inRect(x, y, this.mallow.rect, 2)) return 'mallow';
    return null;
  }

  onSecret(id, game) {
    const st = game.state;
    st.secrets ||= {};
    const audio = game.audio, fx = game.particles;
    if (id === 'plug') {
      const p = this.plug;
      p.knocks++; p.shake = 1;
      audio?.play?.('click', { vol: 0.6, pitch: 0.6 });
      fx?.sparks?.(p.x, p.top, 6, { colors: ['#ffb04a', '#ff6a1a', '#fff0a0'] });
      if (p.knocks >= 3) {
        st.secrets.volcano_plug = true;
        p.t = 0;
        const coins = 70 + Math.floor(Math.random() * 40);
        audio?.play?.('eruption_boom', { vol: 0.6, pitch: 1.3 });
        setTimeout(() => audio?.play?.('treasure_open'), 250);
        try { game.camera?.shake?.(4); } catch { /* optional */ }
        game.addCoins?.(coins, p.x, p.top - 20);
        game.toast?.(`POP! The obsidian plug blasts free and the vent coughs up a molten gold nugget. +${coins} coins`, 'coin');
        game.save?.();
      } else game.toast?.(p.knocks === 1 ? 'The obsidian plug is hot and humming. Something wants out.' : 'It rattles. One more good knock...', 'info');
      return;
    }
    if (id === 'egg') {
      const e = this.egg;
      e.warmth = Math.min(1, e.warmth + 0.4); e.wob = 1;
      audio?.play?.('boing', { vol: 0.4, pitch: 0.6 + e.warmth * 0.5 });
      if (e.warmth >= 1) {
        st.secrets.volcano_egg = true;
        audio?.play?.('magic');
        for (let i = 0; i < 8; i++) fx?.sparkle?.(e.x + (Math.random() - 0.5) * 16, e.y - Math.random() * 14, '#ffb04a');
        game.addCoins?.(40, e.x, e.y - 16);
        game.toast?.('Crack! A baby lava salamander hatches, sneezes a tiny spark and adopts you. +40 coins', 'star');
        game.save?.();
      } else game.toast?.(e.warmth < 0.5 ? 'The egg is warm. Something inside purrs.' : 'The egg wobbles happily. Keep it cozy...', 'info');
      return;
    }
    if (id === 'mallow') {
      const m = this.mallow;
      if (m.toast === 0) { m.toast = 1; audio?.play?.('sparkle', { vol: 0.4, pitch: 0.7 }); game.toast?.('Someone left a marshmallow on a stick next to the magma. It starts to toast...', 'info'); return; }
      if (m.toast === 1) { m.toast = 2; m.t = 0; audio?.play?.('puff', { vol: 0.5 }); game.toast?.('Golden brown and bubbling. Perfect timing is everything.', 'info'); return; }
      m.eaten = true;
      const burnt = m.t > 2.5;
      audio?.play?.(burnt ? 'ui_error' : 'gulp', { vol: 0.6 });
      if (!st.secrets.volcano_mallow && !burnt) { st.secrets.volcano_mallow = true; game.addCoins?.(25, m.x + 12, m.y - 26); }
      game.toast?.(burnt ? 'Charcoal. You eat it anyway, out of respect.' : 'Mmm. A perfect undersea marshmallow. Nine hundred metres of flavour. +25 coins', burnt ? 'info' : 'coin');
      setTimeout(() => { m.eaten = false; m.toast = 0; m.t = 0; }, 30000);
    }
  }
}
