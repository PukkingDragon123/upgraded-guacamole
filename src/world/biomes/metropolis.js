// Sunken Metropolis (450 m): a drowned neon city. A cracked avenue runs into the dark between canyon walls of
// office blocks (lit and dead windows, coral creeping up the facades), a derailed subway car, coral-crusted cars,
// traffic lights still cycling, street lamps, billboards with animated pixel screens and flickering neon signs full
// of fishy puns. Far away an elevated train still runs; the tallest towers rise all the way to the surface, where
// their crowns and antennas poke out of the sea.
// Weathers: still, neon storm (signs flicker and arc), rush hour (schools of fish stream down the lanes), blackout.
// Secrets: the soggy ATM (cash!), the dead "OH MY COD" sign (percussive maintenance), the subway car door
// (a ghostly conductor hands over the Key to the City, which the Mayor has been waiting for).

import { Biome, worldTop } from './base.js';
import { clamp, clamp01, lerp, smoothstep, hash2, fbm2, TAU } from '../../core/math.js';
import { RNG } from '../../core/rng.js';
import { mix, rgba, pack } from '../../core/color.js';
import { makeCanvas, ctxOf, makeLayer } from '../../core/canvas.js';
import { VoxelModel } from '../../gfx/voxel.js';
import { worldProp } from '../voxkit.js';
import { drawText, measureText } from '../../gfx/font.js';
import {
  paint, dpack, lerpStops, stopPalette, ditherPick, Blend, FogLayer, fillWith, drawWobble, makeRays, drawGlow, twinkle,
  waveLine, waveRuns, Strands, Motes, Bubbles, Mask, ridge, todWeights, quality, inRect, SwayAnim, DepthScene, BandSet,
  DepthDecor, qscale, hazeMask,
} from '../scenery.js';
import { worldStrip, vshape, vblob, voxSprite, placeSprite, px, skyward, qmix } from './fjord.js';

const WATER = [[0, '#5a7a9a'], [0.12, '#34507a'], [0.32, '#202e5a'], [0.6, '#161c44'], [1, '#100f30']];
const SKY = {
  day: [[0, '#5a7aa8'], [0.6, '#98b0cc'], [1, '#d4dce4']],
  dusk: [[0, '#1e1a4a'], [0.5, '#6a3a7a'], [0.85, '#e0708a'], [1, '#ffb08a']],
  night: [[0, '#03040e'], [0.6, '#0a1030'], [1, '#1a2048']],
};
const FACADES = [[104, 108, 122], [132, 80, 70], [64, 98, 126], [150, 132, 104], [74, 112, 112], [110, 96, 130]];
const NEON = ['#ff4ab0', '#4af0ff', '#ffd23a', '#ff4a4a', '#6aff7a', '#b46aff', '#ff9a3a'];
// [text, side, z, height above the floor (front px), colour index, vertical]
const SIGNS = [
  ['OH MY COD', -1, 0.3, 128, 0, false], ['SUSHI', 1, 0.2, 150, 1, true], ['THE CODFATHER', -1, 0.64, 168, 2, false],
  ['KRILL BILL', 1, 0.52, 118, 3, false], ['HOTEL', -1, 0.96, 230, 4, true], ['BASS PRO', 1, 0.9, 180, 5, false],
  ['EEL-ECTRONICS', 1, 1.32, 120, 1, false], ['OPEN 24/7', -1, 0.1, 74, 6, false], ['HOLY MACKEREL', -1, 1.38, 140, 6, false],
  ['FIN-TECH', 1, 0.08, 210, 5, false],
];
const ADS = ['FISH TV', 'KELP 50% OFF', 'SEA-NN NEWS', 'JAWS 19 NOW', 'SWIM SAFE', 'GILL-ETTE'];

// ====================================================================== voxel models

function subwayModel() {
  const m = new VoxelModel(118, 40, 30);
  const steel = [m.color('#8a94a6', { jitter: 0.06, spec: 1.2 }), m.color('#a8b2c2', { jitter: 0.05, spec: 1.2 }), m.color('#5e6678', { jitter: 0.06 })];
  const stripe = m.color('#d83a4a', { jitter: 0.05 });
  const win = m.color('#ffe8a8', { emissive: 0.85, jitter: 0 });
  const dark = m.color('#141822', { jitter: 0 }), door = m.color('#6a7486', { jitter: 0.05 });
  const rust = m.color('#8a4a2a', { jitter: 0.12 }), coral = [m.color('#ff6a8a', { smooth: 0.6 }), m.color('#ffa04a', { smooth: 0.6 }), m.color('#c86aff', { smooth: 0.6 })];
  const tilt = 0.07;
  const y0 = (x) => 6 + (x - 59) * tilt;
  vshape(m, 4, 0, 4, 113, 39, 25, (x, y, z) => {
    const b = y0(x), k = y - b;
    if (k < 0 || k > 24) return false;
    const r = k > 19 ? 11 - (k - 19) * 0.9 : 11;
    return Math.abs(z - 14.5) <= r;
  }, steel[0]);
  m.recolor((x, y, z) => {
    const k = y - y0(x);
    if (!m.exposed(x, y, z)) return null;
    if (k > 8 && k < 9.6) return stripe;
    if (k > 11 && k < 17 && z > 22 && (x - 4) % 13 > 2 && (x - 4) % 13 < 10) return (x > 50 && x < 66) ? door : win;
    if (k > 11 && k < 17 && z > 22 && (x - 4) % 13 <= 2) return steel[2];
    if (k > 22) return steel[1];
    return null;
  });
  m.recolor((x, y, z, p) => (p === steel[0] && m.exposed(x, y, z) && fbm2(x * 0.12, y * 0.2 + z, 2, 3) > 0.66 ? rust : null));
  // bogies
  for (const bx of [20, 98]) { m.box(bx - 9, y0(bx) - 5, 6, bx + 9, y0(bx) - 1, 23, dark); for (const wx of [-6, 6]) m.cylinder(bx + wx, y0(bx) - 3, 3, 26, 3.2, steel[2], 'z'); }
  // coral crust on the roof
  for (let i = 0; i < 9; i++) { const cx = 10 + i * 11 + (i % 3), top = y0(cx) + 24; vblob(m, cx, top + 1.5, 10 + (i % 4) * 3, 3 + (i % 2), 2.5, 3, 0.4, 0.4, i + 3, coral[i % 3]); }
  return { m, yaw: 18, pitch: 22, light: '#ffe8a8', anchors: { door: [58, 6 + 14, 26] } };
}

function carModel(seed, color) {
  const r = new RNG(seed);
  const m = new VoxelModel(50, 24, 26);
  const paintC = [m.color(color, { jitter: 0.08, spec: 1.1 }), m.color(mix(color, '#ffffff', 0.25), { jitter: 0.06 })];
  const glass = m.color('#1a2a3a', { jitter: 0.04, spec: 1.6 }), tire = m.color('#141418', { jitter: 0.04 }), chrome = m.color('#b8c0cc', { spec: 1.4 });
  const rust = m.color('#7a4a2a', { jitter: 0.12 });
  const coral = [m.color('#ff7a5a', { smooth: 0.6 }), m.color('#5ad8c8', { smooth: 0.6 }), m.color('#ffd060', { smooth: 0.6 })];
  m.box(4, 4, 4, 45, 11, 21, paintC[0]);
  vshape(m, 12, 11, 5, 36, 19, 20, (x, y) => { const k = (y - 11) / 8; return x > 13 + k * 4 && x < 35 - k * 5; }, glass);
  m.recolor((x, y, z, p) => (p === glass && !m.get(x, y + 1, z) ? paintC[1] : null));
  for (const wx of [11, 38]) for (const wz of [4, 21]) m.cylinder(wx, 4, wz - 1, wz + 1, 4, tire, 'z');
  m.box(3, 6, 6, 3, 8, 19, chrome); m.box(46, 6, 6, 46, 8, 19, chrome);
  m.recolor((x, y, z, p) => (p === paintC[0] && fbm2(x * 0.15, y * 0.2 + z * 0.1, 2, seed) > 0.62 ? rust : null));
  for (let i = 0; i < 6; i++) vblob(m, r.float(8, 42), r.float(12, 20), r.float(6, 20), r.float(2, 3.5), r.float(1.5, 3), r.float(2, 3.5), 0.4, 0.5, seed + i, coral[i % 3], 10);
  return { m, yaw: 24 };
}

function trafficLightModel() {
  const m = new VoxelModel(30, 74, 12);
  const pole = m.color('#3a4250', { jitter: 0.06, spec: 1 }), house = m.color('#e0b830', { jitter: 0.05 }), lens = m.color('#0e1014', { jitter: 0 });
  const coral = m.color('#ff8a6a', { smooth: 0.6 });
  m.cylinder(6, 6, 0, 62, 1.6, pole);
  m.box(6, 60, 5, 24, 61, 7, pole);
  m.box(18, 38, 4, 25, 60, 9, house);
  for (const ly of [42, 49, 56]) m.box(19, ly, 9, 24, ly + 4, 10, lens);
  vblob(m, 6, 2, 6, 4, 3, 4, 0.4, 0.4, 3, coral, 0);
  return { m, yaw: 10, pitch: 18, anchors: { r: [21.5, 58, 10], y: [21.5, 51, 10], g: [21.5, 44, 10] } };
}

function lampModel() {
  const m = new VoxelModel(30, 70, 10);
  const pole = m.color('#2e3644', { jitter: 0.05, spec: 1 }), head = m.color('#48505e', { jitter: 0.05 }), bulb = m.color('#fff0b0', { emissive: 1, jitter: 0 });
  m.cylinder(5, 5, 0, 58, 1.4, pole);
  m.cylinder(5, 5, 0, 4, 2.4, head);
  for (let i = 0; i <= 14; i++) { const a = (i / 14) * Math.PI * 0.5; m.set(5 + Math.sin(a) * 12, 58 + Math.cos(a) * 6 - 6 + 6, 5, pole); m.set(5 + Math.sin(a) * 12, 58 + Math.cos(a) * 6 - 5 + 6, 5, pole); }
  m.box(14, 59, 2, 22, 61, 8, head);
  m.box(15, 57, 3, 21, 58, 7, bulb);
  return { m, yaw: 12, pitch: 20, light: '#ffe8a8', anchors: { bulb: [18, 57, 5] } };
}

function billboardModel() {
  const m = new VoxelModel(70, 64, 10);
  const leg = m.color('#3a3e4a', { jitter: 0.06 }), frame = m.color('#5a5e6c', { jitter: 0.05 }), screen = m.color('#2a3a6a', { emissive: 0.6, jitter: 0 });
  const rust = m.color('#7a4a2a', { jitter: 0.1 }), coral = [m.color('#ff6a8a', { smooth: 0.6 }), m.color('#6ad8ff', { smooth: 0.6 })];
  for (const lx of [16, 52]) m.box(lx, 0, 4, lx + 2, 30, 6, leg);
  m.box(6, 28, 3, 63, 62, 7, frame);
  m.box(8, 30, 7, 61, 60, 7, screen);
  m.recolor((x, y, z, p) => (p === frame && fbm2(x * 0.2, y * 0.2, 2, 5) > 0.65 ? rust : null));
  for (let i = 0; i < 5; i++) vblob(m, 10 + i * 12, 63, 5, 3, 2, 3, 0.4, 0.5, i, coral[i % 2]);
  return { m, yaw: 8, pitch: 16, screens: [3] };
}

function atmModel() {
  const m = new VoxelModel(20, 34, 16);
  const body = m.color('#4a6a8a', { jitter: 0.06, spec: 0.8 }), dark = m.color('#1a2230', { jitter: 0 }), screen = m.color('#3affa0', { emissive: 0.7, jitter: 0 });
  const keys = m.color('#c8ccd4', { jitter: 0.04 }), algae = m.color('#4a8a5a', { smooth: 0.6 });
  m.box(2, 0, 2, 17, 30, 13, body);
  m.box(4, 18, 13, 15, 26, 13, dark);
  m.box(5, 19, 14, 14, 25, 14, screen);
  m.box(6, 12, 14, 13, 15, 14, keys);
  m.box(6, 8, 14, 13, 8, 14, dark);
  m.recolor((x, y, z, p) => (p === body && !m.get(x, y + 1, z) ? algae : p === body && y < 4 && hash2(x, z, 2) < 0.5 ? algae : null));
  return { m, yaw: 20, screens: [3] };
}

function hydrantModel() {
  const m = new VoxelModel(14, 18, 14);
  const red = m.color('#d8382a', { jitter: 0.08, spec: 0.9 }), cap = m.color('#e8c040', { jitter: 0.05 }), coral = m.color('#ff9a6a', { smooth: 0.6 });
  m.cylinder(7, 7, 0, 11, 3.6, red);
  m.cylinder(7, 7, 12, 14, 2.6, cap);
  m.cylinder(7, 8, 1, 13, 1.6, red, 'z');
  vblob(m, 7, 1, 7, 5, 2, 5, 0.4, 0.5, 2, coral, 0);
  return { m, yaw: 24 };
}

// ====================================================================== small sprites

function signSprites(text, color, small, vertical) {
  const font = small ? 'small' : 'normal';
  const core = mix(color, '#ffffff', 0.6), dim = mix(color, '#141020', 0.72);
  const lines = vertical ? text.split('') : [text];
  const lh = small ? 7 : 10;
  const tw = Math.max(...lines.map((l) => measureText(l, font)));
  const w = tw + 8, h = lines.length * lh + 6;
  const mk = (on) => {
    const c = makeCanvas(w, h), g = ctxOf(c);
    g.fillStyle = '#0c0a16'; g.fillRect(1, 1, w - 2, h - 2);
    g.fillStyle = '#2a2838'; g.fillRect(0, 1, 1, h - 2); g.fillRect(w - 1, 1, 1, h - 2); g.fillRect(1, h - 1, w - 2, 1);
    g.fillStyle = '#4a4858'; g.fillRect(1, 0, w - 2, 1);
    lines.forEach((l, i) => {
      const x = Math.round((w - measureText(l, font)) / 2), y = 3 + i * lh + (small ? 0 : 1);
      drawText(g, l, x, y, on ? { font, color: core, outline: color } : { font, color: dim });
    });
    return c;
  };
  const on = mk(true), off = mk(false);
  // the broken variant: lit except the last letter's columns
  const broken = makeCanvas(w, h), bg = ctxOf(broken);
  bg.drawImage(on, 0, 0);
  if (!vertical) {
    const lx = Math.round((w - measureText(text, font)) / 2) + measureText(text.slice(0, -1), font);
    bg.clearRect(lx, 0, w - lx - 1, h);
    bg.drawImage(off, lx, 0, w - lx - 1, h, lx, 0, w - lx - 1, h);
  }
  return { on, off, broken, w, h };
}

function fishSprite(c) {
  return paint(7, 4, (x, y) => {
    const rows = ['..###.#', '.######', '.#####.', '..##..#'];
    if (rows[y][x] !== '#') return 0;
    return pack(x === 5 && y === 1 ? '#0a0a14' : y === 0 ? mix(c, '#ffffff', 0.4) : c);
  });
}

// ====================================================================== the biome

export class MetropolisBiome extends Biome {
  constructor(ocean) {
    super(ocean);
    this.id = 'metropolis'; this.name = 'Sunken Metropolis'; this.subtitle = 'The city that never sleeps, 450 m down'; this.music = 'metropolis';
    this.weathers = [{ id: 'still', name: 'Still Streets', weight: 4 }, { id: 'neonstorm', name: 'Neon Storm', weight: 1.2, icon: 'warning' }, { id: 'rushhour', name: 'Rush Hour', weight: 1.6, icon: 'fish' }, { id: 'blackout', name: 'Blackout', weight: 0.8, icon: 'info' }];
    this.ambient = 'metropolis';
    this.fogColor = '#1e2450';
    this.fogAmount = 0.66;
    this.t = 0;
    this.tod = { day: 1, dusk: 0, night: 0 };
    this.wx = { storm: 0, rush: 0, black: 0 };
    this.par = { x: 0, y: 0 };
    this.fresh = true;
    this.arc = null; this.arcT = 3;
    this.hint = 0;
  }

  baseSurface() { return null; }
  surfY() { return -Math.round(this.H * 0.34); }
  boatLevel() { return this.surfY(); }
  waveAt(x) { return this.ys ? this.ys[clamp(Math.round(x), 0, this.W)] : null; }
  floorAt(x, z = 0) { return this.D ? this.D.floorAt(x, z) : super.floorAt(x); }
  secrets() { return this.game?.state?.secrets || {}; }
  waterLook() { return { refract: 12, caustic: 4, foamColor: '#e8f0ff', causticColor: '#2a1a4a', crestColor: '#e8f0ff' }; }

  // ------------------------------------------------------------------ build
  build(W, H) {
    this.W = W; this.H = H;
    this.top = worldTop(H);
    const sy = this.surfY();
    this.ys = new Int16Array(W + 2).fill(sy);
    this.water = worldStrip(H, this.top, WATER, (y) => clamp01((y - sy) / (H - sy)), 24);
    this.skyBlend = new Blend(); this.mtnBlend = new Blend();
    this.buildTowers();
    this.buildDepth();
    this.buildLayers();
    this.rays = makeRays(W, H - sy, { seed: 41, count: 9, sunX: W * 0.4, sunY: -H, minW: 6, maxW: 22, len: 0.7, color: '#b8c8ff', alpha: 0.35, levels: 3 });
    this.buildLife();
    this.fresh = true;
  }

  // The tallest towers: underwater bodies (a fogged far layer) and crowns above the surface (in the sky canvas).
  buildTowers() {
    const W = this.W, H = this.H, top = this.top, sy = this.surfY();
    const skyY = top - 12, sh = sy + 14 - skyY;
    this.skyY = skyY; this.skyH = sh;
    const r = new RNG(77);
    const T = [[0.09, 46, sy - 96, 0], [0.2, 30, sy - 30, 1], [0.33, 38, sy + 40, 2], [0.47, 54, sy - 128, 3], [0.62, 34, sy - 52, 1], [0.74, 44, sy + 10, 0], [0.86, 40, sy - 78, 2], [0.95, 26, sy + 60, 1]];
    this.towers = T.map(([xf, w, tp, st]) => ({ x: Math.round(xf * W), w, top: tp, st, ant: tp < sy ? r.int(14, 30) : 0 }));
    const yBot = Math.round(H * 0.55);
    const hT = yBot - skyY;
    const m = new Mask(W, hT);
    const shapeOf = (tw, x, y) => {
      const dx = Math.abs(x - tw.x), k = y - tw.top;
      if (k < 0) return tw.ant && dx < 1 && k > -tw.ant ? 3 : 0;
      let hw = tw.w / 2;
      if (tw.st === 0) hw *= k < 18 ? 0.55 : k < 36 ? 0.78 : 1;            // wedding cake
      else if (tw.st === 1) hw *= Math.min(1, 0.35 + k / 40);               // tapered spire
      else if (tw.st === 3) { hw *= k < 26 ? 0.4 + (k / 26) * 0.35 : 1; if (k < 26 && Math.abs(dx - hw) < 1.2 && k % 4 < 2) return 4; } // art-deco crown
      return dx <= hw ? (k < 3 ? 2 : 1) : 0;
    };
    for (let y = 0; y < hT; y++) for (let x = 0; x < W; x++) {
      for (const tw of this.towers) { const v = shapeOf(tw, x, y + skyY); if (v) { m.d[y * W + x] = v; break; } }
    }
    this.towerMask = m;
    // windows hash per tower cell
    const winAt = (x, y) => (((x + 300) % 4) < 2 && ((y + 300) % 5) < 3);
    // underwater bodies: dark silhouettes with faint lit windows, fogged at draw time
    const yU = sy + 2;
    const under = paint(W, yBot - yU, (x, row) => {
      const y = row + yU, v = m.d[(y - skyY) * W + x];
      if (!v) return 0;
      if (v === 3) return pack('#3a4060');
      if (winAt(x, y)) return hash2(x >> 2, Math.floor(y / 5), 9) < 0.18 ? pack('#ffe0a0') : pack('#1a2240');
      return pack(v === 2 ? '#4a5478' : (x % 9 === 0 ? '#1e2440' : '#2a3254'));
    });
    this.towerFar = new FogLayer(under, 0, yU);
    this.towerY = yU;
    // sky + crowns above water per time of day
    const skyOf = (kind) => paint(W, sh, (x, row) => {
      const y = row + skyY;
      let [rr, g, b] = lerpStops(SKY[kind], clamp01((y - top) / (sy - top)));
      if (kind === 'night' && y < sy - 40 && hash2(x, row, 61) < 0.003) { rr = 210; g = 220; b = 255; }
      return dpack(rr, g, b, x, row, 5);
    });
    const crownOf = (kind) => {
      const C = { day: ['#5a6070', '#7a8294', '#9aa4b4', '#2a3040', '#c8b070'], dusk: ['#2a2238', '#4a3a58', '#a86a7a', '#1a1424', '#ffb070'], night: ['#0c1020', '#141a30', '#2a3456', '#05060c', '#ffd890'] }[kind];
      return paint(W, sh, (x, row) => {
        const y = row + skyY;
        if (y > sy + 1) return 0;
        const v = m.d[row * W + x];
        if (!v) return 0;
        if (v === 3) return pack(C[1]);
        if (v === 4) return pack(C[4]);
        const tw = this.towers.find((q) => Math.abs(x - q.x) <= q.w / 2 + 1);
        const lit = tw && x < tw.x;
        if (y > sy - 6 && hash2(x, y, 3) < 0.5) return pack('#3a6a4a');                          // seaweed at the waterline
        if (winAt(x, y)) return kind !== 'day' && hash2(x >> 2, Math.floor(y / 5), 9) < 0.3 ? pack(C[4]) : pack(C[3]);
        return pack(v === 2 ? C[2] : lit ? C[1] : C[0]);
      });
    };
    this.sky = { day: skyOf('day'), dusk: skyOf('dusk'), night: skyOf('night') };
    this.mtn = { day: crownOf('day'), dusk: crownOf('dusk'), night: crownOf('night') };
    this.beacons = this.towers.filter((tw) => tw.ant).map((tw) => ({ x: tw.x, y: tw.top - tw.ant, ph: r.float(0, TAU) }));
  }

  buildDepth() {
    const W = this.W, H = this.H;
    const D = new DepthScene(W, H, { yFront: H - 66, yFar: H - 162, pad: 24, zFar: 1.9, fogStart: -0.2, fog: 0.92 });
    this.D = D;
    const cx = D.cx;
    const road = W * 0.2, curb = W * 0.215;
    const edge = (z) => W * 0.33 + Math.sin(z * 2.2) * W * 0.006;
    this.edge = edge;
    const block = (z, side) => Math.floor((z + (side > 0 ? 0.07 : 0)) / 0.2);
    const alley = (z, side) => { const f = ((z + (side > 0 ? 0.07 : 0)) / 0.2) % 1; return f < 0.16; };
    const floorH = (X, z) => {
      const ax = Math.abs(X - cx);
      let h = ax > curb ? 4 : ax > road ? 4 : 0;
      if (ax <= road) {
        const slab = fbm2(X * 0.02, z * 4, 2, 201);
        if (slab > 0.66) h += 2;                                   // heaved asphalt
        h += Math.max(0, fbm2(X * 0.008 + 3, z * 2, 2, 202) - 0.62) * 24; // sand drifts
      }
      return h;
    };
    const cap = (z, rimY) => D.K - (rimY - D.hz) / D.s(z);
    const bldg = (X, z) => {
      const side = X < cx ? -1 : 1;
      const over = Math.abs(X - cx) - edge(z);
      if (over <= 0 || alley(z, side)) return null;
      const b = block(z, side);
      const bh = 120 + hash2(b, side, 203) * 280 + (over > 30 ? 40 : 0);
      const rimY = 14 + hash2(b, side, 204) * 110;
      return Math.round(Math.min(bh, cap(z, rimY)) / 2) * 2;
    };
    D.terrain({
      cell: 2, dz: 0.02, hstep: 2, ambient: 0.68, diffuse: 0.45, ao: 0.07, jitter: 0.04, wall: 0.82, side: 0.9, crest: 1.2, wallMin: 20, fullHeight: true,
      height: (X, z) => bldg(X, z) ?? floorH(X, z),
      floorHeight: floorH,
      color: (X, z, h) => {
        const ax = Math.abs(X - cx);
        if (h >= 20) { const n = fbm2(X * 0.05, z * 6, 2, 205); return n > 0.6 ? [150, 120, 150] : [90, 94, 108]; }
        const hs = hash2(Math.floor(X / 2), Math.floor(z * 50), 206);
        if (hs < 0.006) return [255, 120, 150];
        if (hs < 0.01) return [255, 170, 80];
        if (fbm2(X * 0.008 + 3, z * 2, 2, 202) > 0.62 && ax <= road) return [150, 140, 116];
        if (Math.abs(fbm2(X * 0.015, z * 3, 3, 207) - 0.5) < 0.008) return [24, 24, 32]; // cracks
        if (ax > curb) {
          const gx = ((X % 10) + 10) % 10 < 1, gz = ((z * 40) % 1) < 0.08;
          return gx || gz ? [96, 96, 108] : [128, 128, 138];
        }
        if (ax > road) return [168, 164, 160];
        if (z > 0.0 && z < 0.12 && ((X + 400) % 14) < 7 && ax < road - 4) return [196, 196, 200];   // crosswalk
        if (ax < 3.5 && ax > 1) return [214, 180, 56];                                           // double yellow
        if (Math.abs(ax - road * 0.5) < 1.5 && ((z * 9) % 1) < 0.45) return [196, 196, 200];     // lane dashes
        const n = fbm2(X * 0.03, z * 5, 2, 208);
        return n < 0.35 ? [52, 52, 62] : n > 0.66 ? [74, 74, 84] : [62, 62, 72];
      },
      wallColor: (X, z, hp, h) => {
        const side = X < cx ? -1 : 1, b = block(z, side);
        const f = FACADES[Math.floor(hash2(b, side, 209) * FACADES.length)];
        const u = X * 0.55 + z * 300;
        const col = Math.floor(u / 5), row = Math.floor(hp / 9);
        const inWin = ((u % 5) + 5) % 5 > 1.2 && ((u % 5) + 5) % 5 < 4 && hp % 9 > 2 && hp % 9 < 7 && hp > 12 && hp < h - 6;
        let k = 1 - smoothstep(40, 520, hp) * 0.35;
        if (hp > h - 3 && h < 400) return [f[0] * 1.3, f[1] * 1.3, f[2] * 1.3];
        if (hp < 8 + fbm2(u * 0.1, z, 2, 210) * 10) return hash2(col, Math.floor(hp), 211) < 0.2 ? [255, 120, 150] : [70, 104, 80];
        if (inWin) {
          const lit = hash2(col, row, b * 7 + side);
          if (lit < 0.16) return [255, 214, 140];
          if (lit < 0.2) return [140, 232, 255];
          if (lit < 0.22) return [255, 140, 220];
          return [26, 34, 56];
        }
        if (hp % 9 < 1) k *= 0.82;
        return [f[0] * k, f[1] * k, f[2] * k];
      },
    });
    const S = (key, build, xf, z, base) => placeSprite(D, W, voxSprite(key, build, { scale: qscale(base * D.s(z)) }), xf, z, { id: key });
    const P = (id, xf, z, base, variant = 0) => placeSprite(D, W, worldProp(id, { scale: qscale(base * D.s(z)), variant }), xf, z, { id });
    this.subway = S('me_subway', subwayModel, 0.37, 0.44, 1.05);
    S('me_car0', () => carModel(5, '#3a7ad8'), 0.6, 0.12, 0.85);
    S('me_car1', () => carModel(9, '#e8c040'), 0.6, 0.66, 0.95);
    S('me_car2', () => carModel(13, '#d83a3a'), 0.45, 1.05, 1.05);
    this.tlights = [S('me_tl', trafficLightModel, 0.715, 0.3, 1.0), S('me_tl', trafficLightModel, 0.3, 0.74, 1.0)];
    this.lamps = [S('me_lamp', lampModel, 0.235, 0.14, 1.0), S('me_lamp', lampModel, 0.745, 0.42, 1.0), S('me_lamp', lampModel, 0.285, 0.6, 1.0), S('me_lamp', lampModel, 0.69, 0.95, 1.0)];
    this.boards = [S('me_board', billboardModel, 0.66, 0.6, 1.0), S('me_board', billboardModel, 0.5, 1.28, 1.25)];
    S('me_hydrant', hydrantModel, 0.765, 0.04, 0.8);
    P('coral_brain', 0.53, 0.02, 0.6, 1); P('coral_fan', 0.42, 0.2, 0.8, 0); P('coral_tube', 0.83, 0.24, 0.7, 2); P('coral_staghorn', 0.25, 0.35, 0.8, 1);
    P('coral_brain', 0.62, 0.36, 0.7, 2); P('coral_fan', 0.71, 0.82, 1.0, 2); P('coral_tube', 0.35, 0.92, 1.0, 1); P('coral_staghorn', 0.55, 0.85, 0.9, 0);
    P('coral_brain', 0.42, 0.62, 0.8, 0); P('anemone_base', 0.47, 0.05, 0.6, 1);
    const atm = S('me_atm', atmModel, 0.215, 0.04, 0.9);
    this.atm = { it: atm, rect: { x: atm.left + 2, y: atm.top + 2, w: atm.p.w - 4, h: atm.p.oy - 2 }, msg: 'INSERT CARD', t: 0 };
    D.render([{ key: 'day', strip: this.water }]);
    this.bands = new BandSet(D);
    this.hazeY = Math.round(D.hz - 30);
    this.haze = new FogLayer(hazeMask(W, 76, { peak: 0.5, alpha: 0.8 }), 0, this.hazeY);
    this.floor = new Float32Array(W + 1);
    for (let x = 0; x <= W; x++) this.floor[x] = D.floorAt(x, 0);
    // neon signs on the facades
    this.signs = SIGNS.map(([text, side, z, hgt, ci, vert], i) => {
      const s = D.s(z), small = s < 0.72;
      const spr = signSprites(text, NEON[ci], small, vert);
      const fx = Math.round(cx + side * (edge(z) - 2) * s);
      const x = side < 0 ? fx + 2 : fx - spr.w - 2;
      const y = Math.round(D.y(z, hgt) - spr.h / 2);
      return { text, x, y, z, w: spr.w, h: spr.h, spr, color: NEON[ci], band: D.band(z), on: 1, fl: 0, ph: hash2(i, 3, 7) * TAU, broken: i === 0, fog: D.fog(z) };
    });
    this.brokenSign = this.signs[0];
    this.screens = [];
    for (const b of [...this.boards, atm]) for (const sc of b.p.screens) this.screens.push({ x: b.left + sc.x, y: b.top + sc.y, w: sc.w, h: sc.h, band: b.band, atm: b === atm, ad: this.screens.length % ADS.length, fog: D.fog(b.z) });
    // light anchors
    this.lampL = this.lamps.map((l) => ({ x: l.left + l.p.anchors.bulb.x, y: l.top + l.p.anchors.bulb.y, s: l.s, band: l.band, fog: D.fog(l.z), ph: Math.random() * TAU }));
    this.tl = this.tlights.map((l, i) => ({ x: l.left, y: l.top, a: l.p.anchors, s: l.s, band: l.band, off: i * 4 }));
    const sw = this.subway;
    this.subDoor = { x: sw.left + sw.p.anchors.door.x, y: sw.top + sw.p.anchors.door.y, knocks: 0, t: 9 };
    this.subDoor.rect = { x: this.subDoor.x - 12, y: this.subDoor.y - 14, w: 24, h: 22 };
    this.glows = D.items.filter((q) => q.p?.glow && q.id !== 'me_board' && q.id !== 'me_atm').map((q) => ({ c: q.p.glow, x: q.left, y: q.top, band: q.band, a: 1 - D.fog(q.z) * 0.7, id: q.id }));
  }

  buildLayers() {
    const W = this.W, H = this.H, pad = 30, D = this.D;
    this.pad = pad;
    const LW = W + pad * 2;
    const r = new RNG(9);
    const hz = D.hz;
    // far A: the skyline at the end of the avenue
    const yA = Math.round(hz - H * 0.4), hA = H - yA;
    const mA = new Mask(LW, hA);
    const baseA = hz - yA + 8;
    mA.rect(0, baseA - 6, LW, hA);
    const lit = [];
    for (let i = 0; i < 34; i++) {
      const x = r.float(0, LW), w = r.float(10, 30), hh = r.float(30, Math.min(baseA - 10, 200));
      mA.rect(x - w / 2, baseA - hh, w, hh);
      if (r.chance(0.3)) mA.rect(x - 1, baseA - hh - r.float(6, 16), 2, 16);
      for (let k = 0; k < hh / 6; k++) if (r.chance(0.25)) lit.push([x - w / 2 + 2 + r.int(0, Math.max(1, w - 4)), baseA - hh + 4 + k * 6]);
    }
    const palA = stopPalette([[0, '#0a0c22'], [1, '#22284e']], 5);
    const cA = mA.toCanvas((x, y, v, up) => (up <= 1 ? pack('#4a5288') : ditherPick(palA, 0.6 - Math.min(1, up / 80) * 0.4 + (x % 7 === 0 ? -0.15 : 0), x, y)));
    const gA = ctxOf(cA);
    for (const [x, y] of lit) { gA.fillStyle = r.pick(['#ffd890', '#9ae8ff', '#ffd890', '#ff9ad8']); gA.fillRect(Math.round(x), Math.round(y), 1, 2); }
    this.farA = new FogLayer(cA, -pad, yA);
    this.farAY = yA;
    // far B: an elevated railway across the avenue + low buildings
    const yB = Math.round(hz - 120), hB = H - yB;
    const mB = new Mask(LW, hB);
    const baseB = hz - yB + 14;
    const rB = ridge(LW, baseB - 4, 6, 0.01, 4.2, 2);
    mB.below((x) => rB[x]);
    const trackY = 34;
    this.trackY = yB + trackY;
    mB.rect(0, trackY, LW, 4);
    mB.rect(0, trackY + 4, LW, 1);
    for (let x = 20; x < LW; x += 70) { mB.rect(x, trackY + 4, 4, baseB - trackY); mB.rect(x - 6, trackY + 4, 16, 2); }
    for (let i = 0; i < 16; i++) { const x = r.float(0, LW), w = r.float(16, 40), hh = r.float(14, 50); mB.rect(x, baseB - hh, w, hh); }
    const palB = stopPalette([[0, '#0a0a1e'], [1, '#262c50']], 5);
    this.farB = new FogLayer(mB.toCanvas((x, y, v, up) => (up <= 1 ? pack('#5a62a0') : ditherPick(palB, 0.6 - Math.min(1, up / 40) * 0.4, x, y))), -pad, yB);
    this.farBY = yB;
    this.train = null; this.trainT = 4;
  }

  buildLife() {
    const W = this.W, H = this.H, D = this.D, sy = this.surfY();
    const r = new RNG(31);
    this.decor = new DepthDecor(D);
    // seagrass in the cracks and kelp growing out of the sidewalks
    for (const [xf, z, tall] of [[0.33, 0.02, 0], [0.48, 0.16, 0], [0.56, -0.08, 0], [0.4, 0.3, 0], [0.64, 0.24, 0], [0.5, 0.5, 0], [0.43, 0.8, 0], [0.57, 0.95, 0], [0.24, 0.24, 1], [0.79, 0.12, 1], [0.27, 0.86, 1], [0.73, 0.7, 1], [0.21, 0.5, 1]]) {
      const s = D.s(z), x0 = Math.round(xf * W), y0 = Math.round(D.floorAt(x0, z)) + 1;
      const st = new Strands();
      const k = tall ? 1 : r.int(3, 6);
      for (let i = 0; i < k; i++) {
        const lean = (i / Math.max(1, k - 1) - 0.5) * 0.8;
        st.add({ x: x0 + Math.round(lean * 6 * s), y: y0, n: Math.max(3, Math.round((tall ? r.int(22, 34) : r.int(4, 8)) * Math.min(1.1, s))), seg: tall ? Math.max(2, Math.round(3 * s)) : 2, w: tall && s > 0.7 ? 2 : 1, amp: tall ? 0.14 : 0.25, speed: tall ? 0.7 : 1.3, sec: tall ? 1 : 2, phase: r.float(0, TAU), wave: tall ? 0.2 : 0.5, lean: tall ? r.float(-0.05, 0.05) : lean, curl: lean * 0.3,
          cols: tall ? ['#1e3a2a', '#2a5236', '#3a6a42', '#5a8a52'] : ['#24503a', '#2e6a46', '#448a58', '#6aae74'], out: tall && s > 0.7 ? '#0c1a14' : null, hl: false, taper: 0.3, leaf: tall ? 'kelp' : null, leafEvery: 3, leafLen: 4 });
      }
      this.decor.add({ anim: new SwayAnim(st, { frames: 16 }), z, off: r.int(0, 15) });
    }
    this.decor.refog(() => '#1e2450', 'k');
    // rush-hour fish traffic lanes
    const cols = ['#ff9a5a', '#5ad8ff', '#ffd25a', '#c88aff', '#7aff9a', '#ff6a8a'];
    this.fishSpr = cols.map((c) => fishSprite(c));
    this.fishSprL = this.fishSpr.map((c) => { const o = makeCanvas(c.width, c.height), g = ctxOf(o); g.translate(c.width, 0); g.scale(-1, 1); g.drawImage(c, 0, 0); return o; });
    this.lanes = [[0.18, 1, 46], [0.3, -1, 40], [0.5, 1, 34], [0.62, -1, 30], [0.85, 1, 24], [1.05, -1, 20]].map(([z, dir, sp], i) => {
      const s = D.s(z);
      return { z, dir, sp: sp * (0.8 + 0.4 * s), y: Math.round(D.y(z, 26 + i * 6)), band: D.band(z), s, fish: Array.from({ length: 14 }, (_, k) => ({ o: k * 41 + r.float(0, 30), c: r.int(0, 5), dy: r.int(-4, 4) })) };
    });
    // particles
    this.silt = new Motes(110, { x0: 0, y0: sy, x1: W, y1: H - 40 }, { seed: 3, vx: [-2, 2], vy: [-1, 2], sizes: [1, 1, 2], colors: ['#8a9ac8', '#aab4e0', '#6a7aaa'], alpha: [0.2, 0.6], wob: 4 });
    this.neonMotes = new Motes(40, { x0: 0, y0: 30, x1: W, y1: H - 40 }, { seed: 7, vx: [-2, 2], vy: [-2, 1], sizes: [1], colors: NEON, alpha: [0.5, 1], wob: 6 });
    this.nearSilt = new Motes(22, { x0: 0, y0: sy, x1: W, y1: H }, { seed: 9, vx: [-3, 3], vy: [-2, 2], sizes: [2, 3], colors: ['#aab4e0'], alpha: [0.08, 0.2], wob: 7 });
    this.bubbles = new Bubbles(60, '#d8e0ff');
    this.emitT = 1;
  }

  // ------------------------------------------------------------------ update
  update(dt, env) {
    dt = Math.max(0, Math.min(dt, 0.1));
    this.t += dt;
    const t = this.t, W = this.W, H = this.H;
    const tod = todWeights(env);
    this.tod = tod;
    const snap = this.fresh;
    const k = snap ? 1 : 1 - Math.exp(-dt * 0.8);
    const w = env.weather, wx = this.wx;
    wx.storm += ((w === 'neonstorm' ? 1 : 0) - wx.storm) * k;
    wx.rush += ((w === 'rushhour' ? 1 : 0) - wx.rush) * k;
    wx.black += ((w === 'blackout' ? 1 : 0) - wx.black) * k;
    const c = env.cursor;
    const tx = c && c.x > -50 ? (c.x / W - 0.5) * -2 : 0, ty = c && c.y > -50 ? (c.y / H - 0.5) * -2 : 0;
    const kp = snap ? 1 : 1 - Math.exp(-dt * 2.5);
    this.par.x += (tx - this.par.x) * kp;
    this.par.y += (ty - this.par.y) * kp;
    this.fresh = false;
    this.fogColor = qmix(qmix('#1e2450', '#2a1a50', wx.storm * 0.5), '#0a0c1e', wx.black * 0.7);
    const sy = this.surfY();
    waveLine(this.ys, W, sy, t * 0.6, 1.1 + wx.storm * 1.2, 0.3 + wx.storm * 0.6, 0.9);
    // neon: steady hum with the odd flicker; storms make them stutter; blackouts kill them
    for (const s of this.signs) {
      s.fl = Math.max(0, s.fl - dt);
      if (s.fl <= 0 && Math.random() < dt * (0.08 + wx.storm * 3)) s.fl = Math.random() * (0.1 + wx.storm * 0.4);
      const flick = s.fl > 0 ? (Math.random() < 0.5 ? 0.15 : 1) : 1;
      s.on = flick * (1 - wx.black) * (0.85 + 0.15 * Math.sin(t * 60 + s.ph));
    }
    // electric arcs between signs during neon storms
    if (wx.storm > 0.4) {
      this.arcT -= dt;
      if (this.arcT <= 0) {
        this.arcT = 0.6 + Math.random() * 2.2;
        const a = this.signs[Math.floor(Math.random() * this.signs.length)], b = this.signs[Math.floor(Math.random() * this.signs.length)];
        if (a !== b && Math.abs(a.z - b.z) < 0.5) {
          const pts = [[a.x + a.w / 2, a.y + a.h / 2]];
          const n = 8;
          for (let i = 1; i < n; i++) pts.push([lerp(a.x + a.w / 2, b.x + b.w / 2, i / n) + (Math.random() - 0.5) * 20, lerp(a.y + a.h / 2, b.y + b.h / 2, i / n) + (Math.random() - 0.5) * 20]);
          pts.push([b.x + b.w / 2, b.y + b.h / 2]);
          this.arc = { pts, t: 0.25, c: a.color };
          try { this.game?.audio?.play?.('neon_buzz', { vol: 0.35 }); } catch { /* optional */ }
        }
      }
    }
    if (this.arc) { this.arc.t -= dt; if (this.arc.t <= 0) this.arc = null; }
    // train on the elevated track
    if (this.train) { this.train.x += this.train.dir * 70 * dt; if (this.train.x < -400 || this.train.x > W + 400) { this.train = null; this.trainT = 20 + Math.random() * 30; } }
    else if ((this.trainT -= dt) <= 0) { const dir = Math.random() < 0.5 ? 1 : -1; this.train = { dir, x: dir > 0 ? -320 : W + 320 }; }
    // particles
    this.silt.update(dt, Math.sin(t * 0.2) * 2, 0);
    this.neonMotes.update(dt, 0, 0);
    this.nearSilt.update(dt, Math.sin(t * 0.2) * 3, 0);
    this.bubbles.update(dt, sy);
    this.emitT -= dt;
    if (this.emitT <= 0) {
      this.emitT = 0.6 + Math.random() * 1.4;
      const q = Math.random() < 0.5 ? this.subway : this.lamps[Math.floor(Math.random() * this.lamps.length)];
      this.bubbles.emit(q.x + (Math.random() - 0.5) * 30 * q.s, q.top + q.p.oy * 0.4, { r: Math.random() < 0.3 ? 2 : 1 });
    }
    this.atm.t = Math.max(0, this.atm.t - dt);
    this.subDoor.t += dt;
    this.hint += dt;
  }

  // traffic light phase: 0 green, 1 yellow, 2 red, -1 off (blinking red in a blackout)
  lightPhase(i) {
    const wx = this.wx;
    if (wx.black > 0.5) return Math.sin(this.t * 4) > 0 ? 2 : -1;
    if (wx.storm > 0.5 && Math.sin(this.t * 13 + i) > 0.6) return Math.floor(this.t * 8 + i) % 3;
    const cyc = wx.rush > 0.5 ? 6 : 14;
    const p = ((this.t + this.tl[i].off) % cyc) / cyc;
    return p < 0.45 ? 0 : p < 0.55 ? 1 : 2;
  }

  // ------------------------------------------------------------------ draw
  drawBack(ctx, env) {
    this.nearHooked = !!this.nearSeen;
    this.nearSeen = false;
    const W = this.W, H = this.H, t = this.t, tod = this.tod, wx = this.wx;
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
    } else fillWith(ctx, this.water, 0, y0, W, y1 - y0);
    const px0 = this.par.x, py0 = this.par.y;
    // pale light from far above
    const rayA = (0.35 + tod.day * 0.4) * (1 - wx.black * 0.6);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = rayA * (0.7 + 0.3 * Math.sin(t * 0.3));
    ctx.drawImage(this.rays, Math.round(Math.sin(t * 0.05) * 14), sy);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    // the tall towers rising to the surface, deep in the fog
    if (y0 < this.D.hz) ctx.drawImage(this.towerFar.tint(this.water, 0.72, 't'), Math.round(px0 * 0.5), this.towerY + Math.round(py0 * 0.3));
    if (wx.black < 0.6 && y0 < this.D.hz) this.drawBeacons(ctx, true);
    const wob = quality(env) >= 1 ? 1 : 0;
    drawWobble(ctx, this.farA.tint(this.water, 0.5, 'a'), -this.pad + px0 * 0.8, this.farAY + py0 * 0.4, t, wob, 4, 0.7, 0.06);
    drawWobble(ctx, this.farB.tint(this.water, 0.4, 'b'), -this.pad + px0 * 1.4, this.farBY + py0 * 0.5, t + 2, wob, 4, 0.9, 0.08);
    this.drawTrain(ctx, px0 * 1.4, py0 * 0.5);
    this.paintBand(ctx, 2, px0 * 2, py0 * 0.6);
    ctx.drawImage(this.haze.tint(this.water, 1, 'h'), 0, this.hazeY);
    if (wx.black > 0.05) { ctx.fillStyle = rgba('#05060e', wx.black * 0.35); ctx.fillRect(0, Math.max(y0, sy), W, y1 - Math.max(y0, sy)); }
  }

  drawSky(ctx, env, y0) {
    const W = this.W, t = this.t, tod = this.tod, skyY = this.skyY, sy = this.surfY();
    const w3 = (o) => [[o.day, tod.day], [o.dusk, tod.dusk], [o.night, tod.night]];
    const r0 = clamp(Math.floor(y0) - skyY, 0, this.skyH - 1), rh = this.skyH - r0;
    ctx.drawImage(this.skyBlend.get(w3(this.sky)), 0, r0, W, rh, 0, skyY + r0, W, rh);
    ctx.drawImage(this.mtnBlend.get(w3(this.mtn)), 0, r0, W, rh, 0, skyY + r0, W, rh);
    this.drawBeacons(ctx, false);
    // gulls perched on the antennas by day
    if (tod.day > 0.3) {
      ctx.fillStyle = '#e8ecf0';
      for (const b of this.beacons.slice(0, 2)) { ctx.fillRect(b.x - 2, b.y + 4, 4, 2); ctx.fillStyle = '#ff9a3a'; ctx.fillRect(b.x + 2, b.y + 4, 1, 1); ctx.fillStyle = '#e8ecf0'; }
    }
    // surface line
    const ys = this.ys;
    const crest = new Path2D();
    waveRuns(ys, W, (x0, len, y) => crest.rect(x0, y, len, 1));
    ctx.fillStyle = tod.night > 0.5 ? '#6a7aa8' : '#d8e4f0';
    ctx.fill(crest);
    void sy; void t;
  }

  drawBeacons(ctx, under) {
    const t = this.t, sy = this.surfY();
    for (const b of this.beacons) {
      if (under !== (b.y > sy)) continue;
      const on = Math.sin(t * 2.4 + b.ph) > 0.3;
      if (!on) continue;
      ctx.fillStyle = '#ff3a3a';
      ctx.fillRect(b.x - 1, b.y - 1, 2, 2);
      drawGlow(ctx, b.x, b.y, 6, '#ff3a3a', under ? 0.4 : 0.8);
    }
  }

  drawTrain(ctx, dx, dy) {
    const tr = this.train;
    if (!tr) return;
    const y = this.trackY - 7 + Math.round(dy), wx = this.wx;
    for (let c = 0; c < 6; c++) {
      const x = Math.round(tr.x - tr.dir * c * 46 + dx);
      if (x < -50 || x > this.W + 10) continue;
      ctx.fillStyle = '#2a3054'; ctx.fillRect(x, y, 44, 7);
      ctx.fillStyle = '#3a4270'; ctx.fillRect(x, y, 44, 1);
      if (wx.black < 0.5) { ctx.fillStyle = '#ffe8a8'; for (let k = 0; k < 7; k++) ctx.fillRect(x + 3 + k * 6, y + 2, 3, 2); }
    }
    if (wx.black < 0.5) drawGlow(ctx, tr.x + tr.dir * 46 + dx, y + 3, 6, '#fff0c0', 0.6);
  }

  drawSeabed(ctx, env) {
    const t = this.t, wx = this.wx, q = quality(env);
    this.silt.draw(ctx, t, 0.6, q, 0.3);
    this.paintBand(ctx, 1, this.par.x * 3, this.par.y * 0.8);
    if (!this.nearHooked) this.paintNear(ctx, env);
    void wx;
  }

  drawNear(ctx, env) {
    this.nearSeen = true;
    if (this.nearHooked) this.paintNear(ctx, env);
  }

  paintNear(ctx) {
    this.paintBand(ctx, 0, this.par.x * 4, this.par.y);
    this.bubbles.draw(ctx, this.t);
  }

  paintBand(ctx, b, dx, dy) {
    const t = this.t, wx = this.wx, tod = this.tod;
    this.bands.draw(ctx, b, null, dx, dy);
    ctx.save();
    ctx.translate(Math.round(dx), Math.round(dy));
    const powered = 1 - wx.black;
    // emissive bits (subway windows, bulbs)
    ctx.globalCompositeOperation = 'lighter';
    for (const gl of this.glows) {
      if (gl.band !== b) continue;
      ctx.globalAlpha = clamp01((0.45 + 0.1 * Math.sin(t * 3 + gl.x)) * gl.a * powered * (gl.id === 'me_subway' ? (Math.sin(t * 9) > -0.9 ? 1 : 0.3) : 1));
      ctx.drawImage(gl.c, gl.x, gl.y);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    for (const sc of this.screens) if (sc.band === b) this.drawScreen(ctx, sc);
    for (let i = 0; i < this.tl.length; i++) {
      const L = this.tl[i];
      if (L.band !== b) continue;
      const ph = this.lightPhase(i);
      if (ph < 0) continue;
      const a = L.a[['g', 'y', 'r'][ph]];
      const col = ['#5aff8a', '#ffd23a', '#ff3a3a'][ph];
      ctx.fillStyle = col;
      ctx.fillRect(L.x + a.x - 1, L.y + a.y - 1, 3, 3);
      drawGlow(ctx, L.x + a.x, L.y + a.y, Math.round(8 * L.s), col, 0.75);
    }
    for (const l of this.lampL) {
      if (l.band !== b) continue;
      const fl = wx.storm > 0.3 && Math.sin(t * 17 + l.ph) > 0.7 ? 0.2 : 1;
      drawGlow(ctx, l.x, l.y + 2, Math.round(14 * l.s), '#ffe8a8', 0.55 * powered * fl * (1 - l.fog * 0.6));
    }
    for (const s of this.signs) if (s.band === b) this.drawSign(ctx, s);
    // rush-hour fish traffic
    if (wx.rush > 0.05) {
      for (const L of this.lanes) {
        if (L.band !== b) continue;
        const span = this.W + 120;
        ctx.globalAlpha = clamp01(wx.rush * (1 - this.D.fog(L.z) * 0.6));
        for (const f of L.fish) {
          const x = ((((f.o + t * L.sp * (1 + wx.rush)) % span) + span) % span) - 60;
          const xx = L.dir > 0 ? x : this.W - x;
          const spr = (L.dir > 0 ? this.fishSpr : this.fishSprL)[f.c];
          const sc = L.s > 0.7 ? 2 : 1;
          ctx.drawImage(spr, Math.round(xx), Math.round(L.y + f.dy * L.s + Math.sin(t * 6 + f.o) * 1.5), spr.width * sc * (L.s > 0.7 ? 0.7 : 1), spr.height * sc * (L.s > 0.7 ? 0.7 : 1));
        }
        ctx.globalAlpha = 1;
      }
    }
    if (b === 1) this.drawSubwayDoor(ctx);
    if (b === 0) this.drawAtmHint(ctx);
    ctx.restore();
    this.decor.draw(ctx, b, t, dx, dy);
    void tod;
  }

  drawSign(ctx, s) {
    const on = s.on * (1 - s.fog * 0.5);
    const fixed = !s.broken || this.secrets().metro_sign;
    ctx.drawImage(on > 0.3 ? (fixed ? s.spr.on : s.spr.broken) : s.spr.off, s.x, s.y);
    if (on > 0.3) {
      const n = Math.max(1, Math.round(s.w / 18));
      for (let i = 0; i < n; i++) drawGlow(ctx, s.x + (s.w * (i + 0.5)) / n, s.y + s.h / 2, Math.round(Math.min(16, s.h * 0.9)), s.color, 0.32 * on);
    }
    if (s.broken && !fixed) {
      const hk = ((this.hint + 1) % 9) / 9;
      if (hk < 0.12) twinkle(ctx, s.x + s.w - 6, s.y + 3, Math.sin((hk / 0.12) * Math.PI), '#ffffff');
    }
  }

  drawScreen(ctx, sc) {
    const t = this.t, wx = this.wx;
    const { x, y, w, h } = sc;
    ctx.save();
    ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
    if (wx.black > 0.5 && !sc.atm) { ctx.fillStyle = '#0a0c14'; ctx.fillRect(x, y, w, h); ctx.restore(); return; }
    if (sc.atm) {
      ctx.fillStyle = '#062a18'; ctx.fillRect(x, y, w, h);
      if (Math.sin(t * 3) > -0.3 || this.atm.t > 0) drawText(ctx, this.atm.t > 0 ? this.atm.msg.slice(0, 6) : '$', x + w / 2, y + 1, { font: 'small', align: 'center', color: '#5affa0' });
      ctx.restore();
      return;
    }
    const glitch = wx.storm > 0.3 && hash2(x, Math.floor(t * 8), 3) < wx.storm * 0.4;
    if (glitch) {
      for (let yy = 0; yy < h; yy += 2) { ctx.fillStyle = hash2(yy, Math.floor(t * 20), x) < 0.5 ? '#c8c8d8' : '#3a3a4a'; ctx.fillRect(x, y + yy, w, 2); }
      ctx.restore();
      return;
    }
    const mode = Math.floor(t / 6 + sc.ad) % 3;
    if (mode === 0) {
      ctx.fillStyle = '#10306a'; ctx.fillRect(x, y, w, h);
      ctx.fillStyle = '#1a4a8a'; ctx.fillRect(x, y + h - 4, w, 4);
      const fx = x + ((t * 14) % (w + 16)) - 10, fy = y + h * 0.45 + Math.sin(t * 2) * 2;
      ctx.drawImage(this.fishSpr[0], Math.round(fx), Math.round(fy), 14, 8);
      drawText(ctx, ADS[sc.ad], x + w / 2, y + 2, { font: 'small', align: 'center', color: '#ffe27a' });
    } else if (mode === 1) {
      ctx.fillStyle = '#3a0a2a'; ctx.fillRect(x, y, w, h);
      const msg = ADS[(sc.ad + 1) % ADS.length] + '   ';
      const mw = measureText(msg, 'small');
      const ox = -((t * 24) % mw);
      for (let k = 0; k < 3; k++) drawText(ctx, msg, x + ox + k * mw, y + h / 2 - 3, { font: 'small', color: '#ff7ad8' });
    } else {
      ctx.fillStyle = '#0a1a1a'; ctx.fillRect(x, y, w, h);
      const k = Math.floor(t * 2) % 2;
      ctx.fillStyle = '#5affd0';
      const cx = x + w / 2, cy = y + h / 2;
      ctx.fillRect(cx - 8, cy - (k ? 1 : 4), 16, k ? 2 : 8);
      ctx.fillStyle = '#0a1a1a'; if (!k) ctx.fillRect(cx - 2, cy - 2, 4, 4);
    }
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    for (let yy = 0; yy < h; yy += 2) ctx.fillRect(x, y + yy, w, 1);
    ctx.restore();
    drawGlow(ctx, x + w / 2, y + h / 2, Math.max(w, h) * 0.6, '#6a8aff', 0.18 * (1 - sc.fog * 0.6));
  }

  drawSubwayDoor(ctx) {
    const d = this.subDoor, t = this.t, sec = this.secrets();
    if (d.t < 2.5) {
      // the conductor's ghostly lantern
      drawGlow(ctx, d.x, d.y - 6, 10, '#9affe0', (1 - d.t / 2.5) * 0.9);
    }
    if (!sec.metro_key) {
      const hk = ((this.hint + 5) % 10) / 10;
      if (hk < 0.1) twinkle(ctx, d.x + 4, d.y - 10, Math.sin((hk / 0.1) * Math.PI), '#c8fff0');
    }
    void t;
  }

  drawAtmHint(ctx) {
    if (this.secrets().metro_atm) return;
    const hk = ((this.hint + 3) % 8) / 8;
    if (hk < 0.12) twinkle(ctx, this.atm.rect.x + this.atm.rect.w - 3, this.atm.rect.y + 4, Math.sin((hk / 0.12) * Math.PI), '#c8ffe0');
  }

  drawFront(ctx, env) {
    const t = this.t, wx = this.wx, q = quality(env), W = this.W;
    this.nearSilt.draw(ctx, t, 0.6, q);
    // stray neon motes
    const n = Math.round(this.neonMotes.list.length * q * (1 - wx.black) * (0.4 + wx.storm * 0.6));
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < n; i++) {
      const p = this.neonMotes.list[i];
      const k = 0.5 + 0.5 * Math.sin(t * p.tw + p.ph);
      if (k < 0.4) continue;
      ctx.globalAlpha = k * 0.7;
      ctx.fillStyle = p.c;
      ctx.fillRect(Math.round(p.x), Math.round(p.y), 1, 1);
    }
    ctx.globalAlpha = 1;
    if (this.arc) {
      const a = this.arc;
      ctx.fillStyle = '#ffffff';
      for (let i = 0; i + 1 < a.pts.length; i++) {
        const [x0, y0] = a.pts[i], [x1, y1] = a.pts[i + 1];
        const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0));
        for (let s = 0; s <= steps; s++) ctx.fillRect(Math.round(lerp(x0, x1, s / steps)), Math.round(lerp(y0, y1, s / steps)), 1, 1);
        drawGlow(ctx, x0, y0, 8, a.c, a.t * 3);
      }
    }
    ctx.globalCompositeOperation = 'source-over';
    if (wx.storm > 0.05 && this.arc) { ctx.fillStyle = rgba('#d8c8ff', 0.06); ctx.fillRect(0, env.view ? env.view.y0 : 0, W, this.H + 400); }
  }

  // ------------------------------------------------------------------ lighting
  lighting(env) {
    const tod = todWeights(env), wx = this.wx, t = this.t;
    let dark = 0.5 + tod.night * 0.16 + wx.black * 0.22 - wx.storm * 0.04;
    dark *= 1 - skyward(env, this.H) * 0.6;
    const tint = qmix(qmix('#100c2e', '#1a0a30', wx.storm * 0.5), '#04040c', wx.black * 0.6);
    const lights = [];
    const pw = 1 - wx.black;
    for (const s of this.signs) if (s.on > 0.3 && s.z < 1.2) lights.push({ x: s.x + s.w / 2, y: s.y + s.h / 2, r: Math.max(s.w, 30) * 0.9, color: s.color, a: clamp01(s.on * (1 - s.fog * 0.7) * 0.9) });
    for (const l of this.lampL) lights.push({ x: l.x, y: l.y + 4, r: 70 * l.s, color: '#ffe0a0', a: 0.75 * pw * (1 - l.fog * 0.6) });
    for (let i = 0; i < this.tl.length; i++) {
      const ph = this.lightPhase(i);
      if (ph < 0) continue;
      const L = this.tl[i], a = L.a[['g', 'y', 'r'][ph]];
      lights.push({ x: L.x + a.x, y: L.y + a.y, r: 40 * L.s, color: ['#5aff8a', '#ffd23a', '#ff3a3a'][ph], a: 0.7 });
    }
    for (const sc of this.screens) if (pw > 0.5 || sc.atm) lights.push({ x: sc.x + sc.w / 2, y: sc.y + sc.h / 2, r: Math.max(sc.w, sc.h) * 1.2, color: sc.atm ? '#5affa0' : '#7a9aff', a: 0.6 * (1 - sc.fog * 0.6) });
    const sw = this.subway;
    lights.push({ x: sw.x, y: sw.top + sw.p.oy * 0.5, r: 90 * sw.s, color: '#ffe8a8', a: 0.5 * pw });
    if (this.arc) lights.push({ x: this.arc.pts[4][0], y: this.arc.pts[4][1], r: 120, color: '#e0d0ff', a: this.arc.t * 3 });
    if (wx.black > 0.3) for (const l of this.lampL.slice(0, 2)) lights.push({ x: l.x, y: l.y + 10, r: 24, color: '#ff3a3a', a: wx.black * (Math.sin(t * 3) > 0 ? 0.6 : 0.2) });
    return { dark: clamp(dark, 0, 0.85), tint, lights };
  }

  // ------------------------------------------------------------------ secrets
  secretAt(x, y) {
    if (inRect(x, y, this.atm.rect, 2)) return 'atm';
    const s = this.brokenSign;
    if (inRect(x, y, { x: s.x, y: s.y, w: s.w, h: s.h }, 2)) return 'sign';
    if (inRect(x, y, this.subDoor.rect, 2)) return 'door';
    return null;
  }

  onSecret(id, game) {
    const st = game.state;
    st.secrets ||= {};
    const audio = game.audio, fx = game.particles;
    if (id === 'atm') {
      const a = this.atm;
      if (a.t > 0) return;
      a.t = 2.5;
      audio?.play?.('vending', { vol: 0.5 });
      if (!st.secrets.metro_atm) {
        st.secrets.metro_atm = true;
        a.msg = 'CASH!';
        const coins = 60 + Math.floor(Math.random() * 40);
        setTimeout(() => audio?.play?.('coins_many'), 400);
        game.addCoins?.(coins, a.rect.x + a.rect.w / 2, a.rect.y);
        game.toast?.(`The ATM wheezes, gurgles and spits out a wad of soggy cash. +${coins} coins`, 'coin');
        game.save?.();
      } else {
        const msgs = [['NO FUNDS', 'INSUFFICIENT FUNDS. TRY A BANK THAT IS NOT UNDERWATER.'], ['PIN?', 'INCORRECT PIN. HINT: IT IS NOT 1234. IT IS 4321.'], ['SORRY', 'THIS ATM IS CURRENTLY 450 M BELOW SEA LEVEL.'], ['BALANCE', 'YOUR BALANCE: 3 SHELLS AND A BUTTON.']];
        const [m, txt] = msgs[Math.floor(Math.random() * msgs.length)];
        a.msg = m;
        game.toast?.(`The ATM beeps: "${txt}"`, 'computer');
      }
      return;
    }
    if (id === 'sign') {
      if (st.secrets.metro_sign) { audio?.play?.('neon_buzz', { vol: 0.4 }); game.toast?.('OH MY COD indeed.', 'info'); return; }
      const s = this.brokenSign;
      s.knocks = (s.knocks || 0) + 1;
      s.fl = 0.5;
      audio?.play?.('click', { vol: 0.6, pitch: 0.7 });
      fx?.sparks?.(s.x + s.w - 6, s.y + s.h / 2, 5, { colors: ['#ff9ad8', '#ffffff', '#ff4ab0'] });
      if (s.knocks >= 3) {
        st.secrets.metro_sign = true;
        const coins = 45;
        audio?.play?.('neon_buzz', { vol: 0.6 });
        setTimeout(() => audio?.play?.('sparkle'), 250);
        game.addCoins?.(coins, s.x + s.w / 2, s.y);
        game.toast?.(`Percussive maintenance! "OH MY COD" blazes back to life and the whole street hums brighter. +${coins} coins`, 'star');
        game.save?.();
      } else game.toast?.(s.knocks === 1 ? 'Bzzt. The last letter of the sign sputters.' : 'BZZZT! Almost there...', 'info');
      return;
    }
    if (id === 'door') {
      const d = this.subDoor;
      d.knocks++;
      d.t = 0;
      audio?.play?.('train_ding', { vol: 0.6 });
      if (st.secrets.metro_key) { game.toast?.('"Stand clear of the closing doors, please." Nobody is there.', 'info'); return; }
      if (d.knocks >= 3) {
        st.secrets.metro_key = true;
        audio?.play?.('magic');
        game.addCoins?.(30, d.x, d.y - 10);
        game.toast?.('A ghostly conductor tips his cap and hands you the KEY TO THE CITY. Someone important may want to meet you now... +30 coins', 'star');
        game.save?.();
      } else game.toast?.(d.knocks === 1 ? 'Ding-dong. "This train is out of service." The voice came from inside...' : '"Tickets, please." A pale lantern sways in the dark car...', 'info');
    }
  }
}
