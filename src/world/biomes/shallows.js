// Sunny Shallows: a crystal turquoise reef under a living sky (sun, sunset, moon and stars, clouds,
// gulls, rain and storms). Static art (sky, water gradients, parallax reef silhouettes, voxel sand and
// coral props) is pre-rendered in build(); per frame we blit layers and animate the surface, rays,
// caustics, kelp, anemones, crabs, bubbles, plankton and the occasional distant whale or turtle.

import { Biome } from './base.js';
import { clamp, clamp01, lerp, smoothstep, ease, hash2, fbm2, TAU } from '../../core/math.js';
import { RNG } from '../../core/rng.js';
import { mix, rgba, pack } from '../../core/color.js';
import { makeCanvas, ctxOf, makeLayer, tinted } from '../../core/canvas.js';
import { PixelBuffer, selOut, flipCanvas } from '../../gfx/pixel.js';
import { getProp } from '../../gfx/props.js';
import {
  paint, dpack, lerpStops, gradientStrip, stopPalette, ditherPick, Blend, FogLayer, fillWith, drawWobble, makeRays,
  drawGlow, twinkle, Caustics, lumaMask, waveLine, waveRuns, Strands, Motes, Bubbles, Mask, ridge, todWeights,
  voxelGround, quality, inRect,
} from '../scenery.js';

const SKY = {
  day: [[0, '#3c9fe6'], [0.45, '#68c2f2'], [0.8, '#a6e2f8'], [1, '#e2f8ff']],
  dusk: [[0, '#2a2c6c'], [0.32, '#64398a'], [0.62, '#d45a7c'], [0.84, '#ff9858'], [1, '#ffd47a']],
  night: [[0, '#03061a'], [0.55, '#0a1538'], [1, '#1b2e5e']],
};
const OVERCAST = {
  day: [[0, '#7e8ca0'], [1, '#c6d0da']],
  dusk: [[0, '#40344e'], [1, '#a47c7a']],
  night: [[0, '#04060c'], [1, '#141a28']],
};
const WATER = {
  day: [[0, '#86f2e6'], [0.06, '#56dcdc'], [0.3, '#2db6d0'], [0.62, '#1b8ec0'], [1, '#146ea6']],
  dusk: [[0, '#6ac0c8'], [0.08, '#3c9ab8'], [0.4, '#2a6c9e'], [1, '#1c3e78']],
  night: [[0, '#3a86a8'], [0.1, '#2a6e98'], [0.5, '#1c5088'], [1, '#12346c']],
};
const RIDDLES = [
  'A soggy note: "Knock thrice upon the sandy keep, and gold will wake from salty sleep."',
  'A soggy note: "Where bubbles sigh from a mossy stone, a hidden door waits, overgrown."',
  'A soggy note: "Old machines dream where the junk reefs lie. Feed one five coins and see what you buy."',
  'A soggy note: "A dead screen sleeps in the scrap. Wake it with a gentle tap."',
  'A soggy note: "In the deepest dark the pillar remembers. Follow its light, stone by stone."',
];

const qmix = (a, b, t) => mix(a, b, Math.round(clamp01(t) * 32) / 32);
const tri = (a, b, c, w) => qmix(qmix(a, b, w.dusk / Math.max(0.001, w.day + w.dusk)), c, w.night);

// ------------------------------------------------------------------ sprites

function crabFrames(body = '#e8603a') {
  const out = [];
  const cBody = pack(body), cLight = pack(mix(body, '#ffd0a0', 0.45)), cDark = pack(mix(body, '#5a1430', 0.45));
  const eye = pack('#16101c'), stalk = pack(mix(body, '#5a1430', 0.3)), white = pack('#fff6e8');
  for (let f = 0; f < 3; f++) {
    const b = new PixelBuffer(17, 11);
    // legs
    for (let i = 0; i < 3; i++) {
      const o = f === 0 ? 0 : (i % 2 ? 1 : -1) * (f === 1 ? 1 : -1);
      b.line(5 + i * 1.5, 7, 3 + i * 1.5 + o, 10, cDark);
      b.line(11 - i * 1.5, 7, 13 - i * 1.5 + o, 10, cDark);
    }
    b.fillEllipse(8.5, 6.5, 5, 2.6, cBody);
    for (let x = 5; x <= 11; x++) b.set(x, 4, cLight);
    b.set(7, 5, white);
    for (let x = 4; x <= 13; x++) b.set(x, 8, cDark);
    // claws
    const cy = f === 0 ? 3 : 4;
    for (const [cx, dir] of [[2, -1], [15, 1]]) {
      b.fillCircle(cx + 0.5, cy + 1.5, 1.7, cBody);
      b.set(cx - dir, cy - 1, cBody); b.set(cx + dir * 0, cy - 1, cLight);
      b.line(cx + (dir < 0 ? 1 : -1), cy + 2, cx + (dir < 0 ? 3 : -3), 6, cBody);
    }
    // eye stalks
    b.set(7, 3, stalk); b.set(10, 3, stalk);
    b.set(7, 2, eye); b.set(10, 2, eye);
    b.outline(selOut(0.75));
    out.push(b.toCanvas());
  }
  return out;
}

function cloudSprite(seed, w, h, pal) {
  const r = new RNG(seed);
  const m = new Mask(w, h);
  const n = r.int(4, 6);
  for (let i = 0; i < n; i++) {
    const u = i / (n - 1);
    const big = 1 - Math.abs(u - 0.45) * 1.4;
    const rx = w * r.float(0.12, 0.2) * (0.7 + big * 0.6), ry = h * r.float(0.3, 0.42) * (0.6 + big * 0.7);
    m.ellipse(lerp(w * 0.16, w * 0.84, u) + r.float(-3, 3), h - ry * 0.85 - 1, rx, ry);
  }
  m.rect(Math.round(w * 0.12), h - 3, Math.round(w * 0.76), 2);
  const cols = pal.map((c) => pack(c));
  return m.toCanvas((x, y, v, up) => {
    const k = y / h;
    let lv = up <= 1 ? 4 : up <= 3 ? 3 : 2.6 - k * 2.2;
    lv += (bayer4(x, y) - 0.5) * 0.9;
    return cols[clamp(Math.round(lv), 0, 4)];
  });
}
const B4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const bayer4 = (x, y) => B4[(y & 3) * 4 + (x & 3)] / 16;

// Side-view silhouettes for the distant giants (white masks, tinted at draw time).
function whaleFrames(L = 230) {
  const H = Math.round(L * 0.36);
  const frames = [];
  for (let f = 0; f < 8; f++) {
    const ph = (f / 8) * TAU;
    const m = new Mask(L + 4, H + 20);
    const cy = H * 0.55 + 6;
    for (let x = 0; x < L; x++) {
      const u = x / L;
      const th = H * (0.12 + smoothstep(0.04, 0.5, u) * 0.82) * (1 - smoothstep(0.86, 1.02, u) * 0.45);
      const dy = Math.sin(ph) * Math.pow(clamp01(0.45 - u), 1.4) * 22;
      const top = cy - th * 0.58 + dy + smoothstep(0.75, 1, u) * th * 0.12, bot = cy + th * 0.42 + dy - smoothstep(0.7, 1, u) * th * 0.06;
      for (let y = Math.round(top); y < Math.round(bot); y++) m.set(x + 2, y, 1);
    }
    // flukes
    const fy = cy + Math.sin(ph) * 0.45 * 22 * Math.pow(0.45, 0.4);
    const fa = Math.cos(ph) * 0.35;
    m.poly([[2, fy - 2], [-2 + 2, fy - 14 - fa * 20], [16, fy - 1], [-2 + 2, fy + 12 - fa * 20], [2, fy + 2]].map(([x, y]) => [x, y]));
    // pectoral fin
    const px = L * 0.66, py = cy + H * 0.25;
    m.poly([[px, py], [px + 14, py], [px - 26, py + 18 + Math.sin(ph + 1) * 3], [px - 30, py + 17 + Math.sin(ph + 1) * 3]]);
    // dorsal nub
    m.poly([[L * 0.32, cy - H * 0.38], [L * 0.38, cy - H * 0.47], [L * 0.41, cy - H * 0.4]]);
    frames.push(m.toCanvas(() => pack('#ffffff')));
  }
  return frames;
}

function turtleFrames(L = 64) {
  const frames = [];
  for (let f = 0; f < 8; f++) {
    const ph = (f / 8) * TAU;
    const m = new Mask(L + 30, L);
    const cx = L * 0.5 + 6, cy = L * 0.5;
    // shell dome + plastron
    m.ellipse(cx, cy, L * 0.36, L * 0.2);
    m.rect(cx - L * 0.33, cy, L * 0.66, L * 0.06);
    // head & neck
    m.line(cx + L * 0.3, cy + 1, cx + L * 0.43, cy - 1, L * 0.07);
    m.ellipse(cx + L * 0.47, cy - 2, L * 0.085, L * 0.07);
    // front flipper: long sweeping blade
    const a = Math.sin(ph) * 0.9 - 0.3;
    const bx = cx + L * 0.12, by = cy + L * 0.08;
    const tx = bx - Math.cos(a) * L * 0.42, ty = by + Math.sin(a) * L * 0.42 + L * 0.06;
    m.line(bx, by, tx, ty, L * 0.06, 1, L * 0.02);
    // rear flipper
    const b2 = Math.sin(ph + 1.4) * 0.5;
    m.line(cx - L * 0.3, cy + L * 0.06, cx - L * 0.44, cy + L * 0.1 + b2 * 6, L * 0.045, 1, L * 0.02);
    frames.push(m.toCanvas(() => pack('#ffffff')));
  }
  return frames;
}

// ------------------------------------------------------------------ biome

export class ShallowsBiome extends Biome {
  constructor(ocean) {
    super(ocean);
    this.id = 'shallows'; this.name = 'Sunny Shallows'; this.subtitle = 'Crystal-clear tropical water'; this.music = 'shallows';
    this.weathers = [{ id: 'sunny', name: 'Sunny', weight: 5 }, { id: 'cloudy', name: 'Cloudy', weight: 2 }, { id: 'rain', name: 'Rain', weight: 2 }, { id: 'storm', name: 'Storm', weight: 0.6 }];
    this.ambient = 'shallows';
    this.fogColor = '#2fb2cc';
    this.fogAmount = 0.7;
    this.t = 0;
    this.tod = { day: 1, dusk: 0, night: 0 };
    this.wx = { cloud: 0, rain: 0, storm: 0, clear: 1 };
    this.par = { x: 0, y: 0 };
    this.flash = 0; this.flashT = 5; this.bolt = null;
    this.riddle = 0;
    this.cols = { crest: '#e8fffa', sub: '#9df0ec', shim: 0.5 };
    this.fresh = true;
  }

  baseSurface(H) { return Math.round(H * 0.12); }

  surfaceAt(env) {
    return Math.round(lerp(this.baseSurface(this.H), -6, ease.inOutCubic(clamp01(env?.flood || 0))));
  }

  // ------------------------------------------------------------------ build
  build(W, H) {
    this.W = W; this.H = H;
    this.base = this.baseSurface(H);
    this.ys = new Int16Array(W + 2);
    this.skyH = this.base + 14;
    this.air = makeLayer(W, this.skyH);
    this.skyBlend = new Blend(); this.ocBlend = new Blend(); this.waterBlend = new Blend();
    this.buildSky();
    const wo = { y0: this.base - 2, y1: H, levels: 24 };
    this.water = { day: gradientStrip(H, WATER.day, wo), dusk: gradientStrip(H, WATER.dusk, wo), night: gradientStrip(H, WATER.night, wo) };
    this.buildGround();
    this.buildLayers();
    const rh = H - this.base;
    this.raysA = new FogLayer(makeRays(W, rh, { seed: 4, count: 8, sunX: W * 0.78, sunY: -H * 0.8, minW: 10, maxW: 34, len: 0.95, color: '#ffffff', alpha: 0.5, levels: 5 }));
    this.raysB = new FogLayer(makeRays(W, rh, { seed: 9, count: 14, sunX: W * 0.74, sunY: -H * 0.7, minW: 3, maxW: 9, len: 0.75, color: '#ffffff', alpha: 0.6, levels: 4 }));
    this.caustics = new Caustics({ tw: 192, th: 60, cx: 9, cy: 4, seed: 11, color: '#fffbe2', thick: 1.0 });
    this.shimmer = this.makeShimmer();
    this.buildLife();
    this.fresh = true;
  }

  buildSky() {
    const W = this.W, h = this.skyH, base = this.base;
    this.sun = { day: { x: Math.round(W * 0.8), y: Math.round(base * 0.3) }, dusk: { x: Math.round(W * 0.7), y: base - 9 }, night: { x: Math.round(W * 0.6), y: Math.round(base * 0.34) } };
    const glow = { day: [[255, 252, 225], 72, 0.6], dusk: [[255, 200, 120], 170, 0.55], night: [[150, 180, 255], 46, 0.3] };
    const island = this.islandMask();
    const mk = (kind) => {
      const st = SKY[kind], s = this.sun[kind], [gc, R, ga] = glow[kind];
      const c = paint(W, h, (x, y) => {
        let [r, g, b] = lerpStops(st, clamp01(y / base));
        const dx = x - s.x, dy = (y - s.y) * (kind === 'dusk' ? 1.8 : 1.1);
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < R) {
          const k = Math.pow(1 - d / R, 2.2) * ga;
          r += (gc[0] - r) * k; g += (gc[1] - g) * k; b += (gc[2] - b) * k;
        }
        if (kind === 'day') { const hz = smoothstep(base * 0.6, base, y) * 0.25; r += (255 - r) * hz; g += (255 - g) * hz; b += (255 - b) * hz; }
        if (kind === 'night' && y < base - 6) {
          const hs = hash2(x, y, 77);
          if (hs < 0.004) { const k = 0.35 + (hs / 0.004) * 0.6; r = lerp(r, 230, k); g = lerp(g, 236, k); b = lerp(b, 255, k); }
        }
        return dpack(r, g, b, x, y, 5);
      });
      const g = ctxOf(c);
      this.drawSunMoon(g, kind, s);
      g.drawImage(this.paintIsland(island, kind), island.x, island.y);
      return c;
    };
    this.sky = { day: mk('day'), dusk: mk('dusk'), night: mk('night') };
    const so = { levels: 10, y0: 0, y1: base + 4 };
    this.overcast = { day: gradientStrip(h, OVERCAST.day, so), dusk: gradientStrip(h, OVERCAST.dusk, so), night: gradientStrip(h, OVERCAST.night, so) };
    // twinkling stars (bright ones drawn per frame)
    const r = new RNG(31);
    this.stars = [];
    for (let i = 0; i < 26; i++) this.stars.push({ x: r.int(4, W - 4), y: r.int(3, base - 10), f: r.float(1, 3), ph: r.float(0, TAU), c: r.pick(['#ffffff', '#fff2c8', '#c8dcff']) });
    // clouds in three palettes
    const pals = {
      day: ['#a9b6de', '#cad6f0', '#eef5ff', '#ffffff', '#ffffff'],
      dusk: ['#6c3c74', '#a8607e', '#ec9c88', '#ffcf9e', '#ffeac4'],
      night: ['#0e1430', '#18223f', '#22304f', '#2f3f62', '#5a6c98'],
      rain: ['#3c4452', '#4a5464', '#5c6676', '#727c8c', '#8a94a2'],
    };
    this.clouds = [];
    const cr = new RNG(51);
    for (let i = 0; i < 7; i++) {
      const w = cr.int(34, 76), ch = Math.round(w * cr.float(0.28, 0.4));
      const seed = 100 + i;
      this.clouds.push({ x: cr.float(0, W), y: cr.int(2, Math.max(4, base - ch - 10)), v: cr.float(1.2, 3.2), spr: { day: cloudSprite(seed, w, ch, pals.day), dusk: cloudSprite(seed, w, ch, pals.dusk), night: cloudSprite(seed, w, ch, pals.night) }, w });
    }
    this.rainClouds = [];
    for (let i = 0; i < 6; i++) {
      const w = cr.int(70, 130), ch = Math.round(w * 0.32);
      this.rainClouds.push({ x: cr.float(0, W), y: cr.int(-6, Math.max(0, base * 0.25)), v: cr.float(4, 9), spr: cloudSprite(300 + i, w, ch, pals.rain), w });
    }
    this.gulls = [0, 1, 2].map((i) => ({ x: cr.float(0, W), y: cr.float(8, base * 0.55), v: cr.float(10, 18) * (i % 2 ? -1 : 1), ph: cr.float(0, TAU) }));
    this.rainLines = [];
    for (let i = 0; i < 90; i++) this.rainLines.push({ x: cr.float(0, W), y: cr.float(0, h), l: cr.int(3, 6), v: cr.float(140, 200) });
  }

  drawSunMoon(g, kind, s) {
    const disc = (cx, cy, r, fn) => {
      for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        if (d <= r) { const c = fn(x, y, d / r); if (c) { g.fillStyle = c; g.fillRect(x, y, 1, 1); } }
      }
    };
    if (kind === 'day') {
      disc(s.x, s.y, 8.5, (x, y, d) => (d > 0.86 ? '#fff1b8' : d > 0.6 ? '#fffbe0' : '#ffffff'));
    } else if (kind === 'dusk') {
      disc(s.x, s.y, 13, (x, y, d) => {
        const k = (y - (s.y - 13)) / 26;
        if (y > s.y + 2 && [4, 7, 9, 11].includes(Math.round(y - s.y))) return null;
        return k < 0.3 ? '#fff0b0' : k < 0.55 ? '#ffd27a' : k < 0.8 ? '#ffac5a' : '#ff8a4a';
      });
    } else {
      disc(s.x, s.y, 8, (x, y, d) => {
        const dx = x + 0.5 - s.x;
        if (dx > 4.5 && d > 0.55) return '#b4c0e6';
        return d > 0.88 ? '#d6deff' : '#f2f5ff';
      });
      for (const [ox, oy, r] of [[-3, -2, 1.6], [2, 2, 2], [-1, 4, 1.1], [3, -4, 1]]) disc(s.x + ox, s.y + oy, r, () => '#c8d0ee');
    }
  }

  islandMask() {
    const ix = Math.round(this.W * 0.4), base = this.base;
    const m = new Mask(110, 50);
    const ox = 55, oy = 44; // waterline inside the mask
    m.ellipse(ox - 4, oy + 4, 34, 13, 1);
    m.ellipse(ox + 14, oy + 3, 20, 8, 1);
    m.rect(ox - 44, oy - 2, 82, 4, 2);
    m.ellipse(ox - 4, oy + 1, 40, 4, 2);
    const palm = (bx, by, hgt, lean, dir) => {
      let x = bx, y = by;
      for (let i = 0; i < hgt; i++) { const k = i / hgt; x += lean * (0.4 + k); y -= 1; m.set(Math.round(x), Math.round(y), 3); if (i % 3 === 0) m.set(Math.round(x) + 1, Math.round(y), 3); }
      const tx = Math.round(x), ty = Math.round(y);
      for (const [a, len] of [[-2.7, 13], [-2.2, 15], [-0.5, 14], [-0.9, 12], [0.1, 11], [-1.6, 9], [3.3, 10]]) {
        for (let j = 1; j <= len; j++) {
          const k = j / len;
          const fx = tx + Math.cos(a) * j * dir, fy = ty + Math.sin(a) * j * 0.55 + k * k * 6;
          m.set(Math.round(fx), Math.round(fy), 4);
          if (k < 0.6) m.set(Math.round(fx), Math.round(fy) + 1, 4);
        }
      }
      m.ellipse(tx, ty + 1, 2, 1.6, 5);
    };
    palm(ox - 10, oy - 4, 22, -0.18, 1);
    palm(ox + 6, oy - 3, 16, 0.22, -1);
    return { m, x: ix - ox, y: base - oy };
  }

  paintIsland(isl, kind) {
    const col = {
      day: { 1: ['#1f6a4a', '#2f8a58', '#4aa868'], 2: ['#e0c088', '#f4dca4', '#fff0c8'], 3: ['#6a4a34', '#8a6444', '#a8805a'], 4: ['#1f7a3e', '#2f9a4a', '#5ac060'], 5: ['#7a5a2a', '#a07a3a', '#c89a4a'] },
      dusk: { 1: ['#2a1e3c', '#38264a', '#ff9a6a'], 2: ['#3a2a44', '#4a3450', '#ffb47a'], 3: ['#2a1e34', '#2a1e34', '#3a2840'], 4: ['#2a1e3c', '#342648', '#ff9a6a'], 5: ['#2a1e34', '#2a1e34', '#2a1e34'] },
      night: { 1: ['#060a18', '#0a1022', '#24325c'], 2: ['#0a1022', '#0e1428', '#2a3a66'], 3: ['#060a18', '#060a18', '#0a1022'], 4: ['#060a18', '#0a1022', '#24325c'], 5: ['#060a18', '#060a18', '#060a18'] },
    }[kind];
    return isl.m.toCanvas((x, y, v, up, left, right) => {
      const c = col[v];
      if (up <= 1) return pack(c[2]);
      if (v === 1 && (right || x > 66)) return pack(c[0]);
      return pack(c[(x + y) % 5 === 0 && v === 1 ? 0 : 1]);
    });
  }

  makeShimmer() {
    const W = this.W + 256, h = 16;
    const r = new RNG(21);
    const acc = new Float32Array(W * h);
    for (let i = 0; i < W * 0.5; i++) {
      const y = Math.floor(Math.pow(r.next(), 1.7) * h);
      const len = r.int(3, 16 - Math.min(10, y));
      const x = r.int(0, W - 1);
      const a = (1 - y / h) * r.float(0.4, 1);
      for (let k = 0; k < len; k++) acc[y * W + ((x + k) % W)] = Math.max(acc[y * W + ((x + k) % W)], a * (k === 0 || k === len - 1 ? 0.5 : 1));
    }
    return paint(W, h, (x, y) => {
      const v = acc[y * W + x];
      if (v < 0.05) return 0;
      return pack(v > 0.6 ? '#ffffff' : '#b8fff4', Math.round(Math.min(1, v) * 200));
    });
  }

  // Voxel sand floor + baked coral props.
  buildGround() {
    const W = this.W, H = this.H;
    const backY = H - 72;
    const dockX = W - 270;
    const g = voxelGround(W, H, {
      vs: 2, backY, baseH: 5, ny: 20, pitch: 27,
      height: (x, z) => {
        const sx = x * 2;
        let h = 5 + (fbm2(sx * 0.0065, z * 0.025, 3, 11) - 0.5) * 7;
        h += (1 - smoothstep(0, W * 0.14, sx)) * 3.5;
        h += smoothstep(W * 0.24, W * 0.3, sx) * (1 - smoothstep(W * 0.42, W * 0.5, sx)) * 2.5 * (1 - smoothstep(10, 50, z));
        h = lerp(h, 5.5 + (fbm2(sx * 0.01, z * 0.03, 2, 4) - 0.5) * 2.2, smoothstep(dockX - 40, dockX + 20, sx));
        const rp = Math.sin(z * 1.2 + fbm2(sx * 0.018, z * 0.05, 2, 7) * 5.5 + sx * 0.025);
        if (rp > 0.45) h += 1;
        return h;
      },
      palette: (m) => ({
        sand: m.color('#e4c992', { jitter: 0.16 }), light: m.color('#efdaa8', { jitter: 0.14 }), warm: m.color('#d8b882', { jitter: 0.18 }),
        dark: m.color('#c2a274', { jitter: 0.2 }), algae: m.color('#aebc84', { jitter: 0.22 }), pink: m.color('#ecc2a8', { jitter: 0.15 }),
        stone: m.color('#8e8c9e', { jitter: 0.3 }), stone2: m.color('#6e6a84', { jitter: 0.3 }), shell: m.color('#fff4e6', { jitter: 0.05 }),
        shellP: m.color('#ffb2b8', { jitter: 0.08 }), star: m.color('#ff7448', { jitter: 0.1 }), star2: m.color('#b06aff', { jitter: 0.1 }), grass: m.color('#5aa05a', { jitter: 0.2 }),
      }),
      color: (x, y, z, h, p) => {
        if (y < h - 1) return p.dark;
        const n = fbm2(x * 0.05, z * 0.08, 2, 3);
        if (fbm2(x * 0.021 + 9, z * 0.05, 2, 5) > 0.7) return p.algae;
        if (n < 0.34) return p.warm;
        if (n > 0.66) return p.light;
        if (hash2(x, z, 4) < 0.012) return p.pink;
        return p.sand;
      },
      decorate: (m, p, H2) => {
        const r = new RNG(77);
        const nz = Math.round(m.nz * 0.62);
        for (let i = 0; i < 70; i++) {
          const x = r.int(2, m.nx - 3), z = r.int(1, nz), h = H2(x, z);
          const c = r.chance(0.5) ? p.stone : p.stone2;
          m.set(x, h, z, c);
          if (r.chance(0.6)) m.set(x + 1, h, z, c);
          if (r.chance(0.3)) m.set(x, h, z + 1, c);
          if (r.chance(0.25)) m.set(x, h + 1, z, c);
        }
        for (let i = 0; i < 46; i++) {
          const x = r.int(2, m.nx - 3), z = r.int(1, nz), h = H2(x, z);
          const c = r.chance(0.6) ? p.shell : p.shellP;
          m.set(x, h, z, c); if (r.chance(0.5)) m.set(x + 1, h, z, c);
        }
        for (let i = 0; i < 7; i++) {
          const x = r.int(10, m.nx - 10), z = r.int(4, nz - 6), h = H2(x, z);
          const c = r.chance(0.6) ? p.star : p.star2;
          const a0 = r.float(0, TAU);
          m.set(x, h, z, c);
          for (let k = 0; k < 5; k++) { const a = a0 + (k * TAU) / 5; for (let j = 1; j <= 2; j++) m.set(x + Math.round(Math.cos(a) * j * 1.2), Math.max(h, H2(x + Math.round(Math.cos(a) * j), z)), z + Math.round(Math.sin(a) * j * 1.6), c); }
        }
      },
    });
    this.ground = g;
    this.floor = g.floor;
    // props baked onto the sand, back to front
    const P = [
      ['rock_small', 0.035, 0.18, 0.9, 0], ['coral_brain', 0.1, 0.06, 0.55, 1], ['rock_big', 0.235, 0.02, 1, 0],
      ['coral_fan', 0.305, 0.0, 0.85, 0], ['coral_tube', 0.395, 0.0, 0.85, 2], ['coral_branch', 0.335, 0.08, 0.95, 1],
      ['coral_branch', 0.458, 0.02, 0.8, 3], ['coral_staghorn', 0.425, 0.14, 0.85, 1], ['coral_brain', 0.36, 0.3, 0.85, 0],
      ['coral_brain', 0.468, 0.3, 0.62, 2], ['sunken_boat', 0.655, 0.0, 0.88, 0], ['message_bottle', 0.6, 0.42, 0.8, 0],
      ['starfish_rock', 0.71, 0.34, 0.62, 0], ['coral_fan', 0.265, 0.34, 0.5, 2], ['rock_small', 0.94, 0.04, 0.7, 0],
      ['coral_tube', 0.985, 0.0, 0.45, 0],
    ];
    const placed = P.map(([id, xf, zf, scale, variant]) => {
      const p = getProp(id, { scale, variant });
      const x = Math.round(xf * W), y = Math.round(g.surfaceY(x, zf)) + 1;
      return { id, p, x, y, zf };
    }).sort((a, b) => a.zf - b.zf);
    let top = Math.min(...placed.map((q) => q.y - q.p.oy));
    for (let x = 0; x <= W; x++) top = Math.min(top, g.floor[x] - 2);
    top = Math.floor(top) - 2;
    const castle = { x: Math.round(W * 0.545), zf: 0.2 };
    castle.y = Math.round(g.surfaceY(castle.x, castle.zf)) + 1;
    this.castleProp = getProp('sandcastle', { scale: 0.7 });
    top = Math.min(top, castle.y - this.castleProp.oy - 4);
    this.bedY = top;
    const bed = makeCanvas(W, H - top);
    const bg = ctxOf(bed);
    bg.drawImage(g.canvas, g.x, g.y - top);
    for (const q of placed) bg.drawImage(q.p.canvas, q.x - q.p.ox, q.y - q.p.oy - top);
    // the hidden cave: a dark crevice at the foot of the big boulder
    const rock = placed.find((q) => q.id === 'rock_big');
    const cave = { x: rock.x - 16, y: rock.y - 14 };
    this.paintCave(bg, cave.x, cave.y - top);
    this.cave = { x: cave.x - 7, y: cave.y - 6, w: 15, h: 12, cx: cave.x, cy: cave.y };
    this.bed = bed;
    this.bedMask = lumaMask(bed, { gamma: 1.8, gain: 1.5 });
    // secrets & interactive props
    const bottle = placed.find((q) => q.id === 'message_bottle');
    this.bottle = { x: bottle.x - 14, y: bottle.y - 14, w: 28, h: 16, cx: bottle.x, cy: bottle.y - 8 };
    const cp = this.castleProp;
    this.castle = { x: castle.x, y: castle.y, rect: { x: castle.x - cp.ox + 8, y: castle.y - cp.oy + 4, w: cp.w - 16, h: cp.oy - 6 }, clicks: 0, shake: 0, state: 'intact', t: 0 };
    this.chest = getProp('treasure_chest', { scale: 0.62, frame: 1 });
    this.heap = this.makeHeap();
    const boat = placed.find((q) => q.id === 'sunken_boat');
    this.lantern = { x: boat.x + 30, y: boat.y - 58 };
    this.vent = { x: boat.x - 40, y: boat.y - 6 };
  }

  paintCave(g, cx, cy) {
    const m = new Mask(22, 16);
    m.ellipse(11, 9, 8, 6.5);
    m.ellipse(7, 11, 5, 4);
    m.ellipse(15, 10, 4, 5);
    const c = m.toCanvas((x, y, v, up, left, right) => {
      if (up <= 1) return pack('#3a3048');
      const d = Math.hypot(x - 11, (y - 10) * 1.3);
      return pack(d < 3.5 ? '#04040a' : d < 6 ? '#0e0c18' : '#1e1a2a');
    });
    g.drawImage(c, Math.round(cx - 11), Math.round(cy - 9));
    // moss lip
    g.fillStyle = '#4a8a5a';
    for (const [dx, dy] of [[-8, -6], [-6, -7], [-3, -8], [0, -8], [2, -7], [5, -7], [7, -6]]) g.fillRect(Math.round(cx + dx), Math.round(cy + dy), 2, 1);
    g.fillStyle = '#7ac07a';
    for (const [dx, dy] of [[-5, -8], [1, -9], [6, -8]]) g.fillRect(Math.round(cx + dx), Math.round(cy + dy), 1, 1);
  }

  makeHeap() {
    const w = 64, h = 22;
    const pal = stopPalette([[0, '#b08a5a'], [0.5, '#e2c48a'], [1, '#fff0c8']], 6);
    return paint(w, h, (x, y) => {
      const dx = (x - w / 2) / (w / 2), top = h - (1 - dx * dx) * (h - 2) - Math.sin(x * 0.7) * 1.2;
      if (y < top) return 0;
      const lv = 0.85 - (y - top) / h * 0.9 - dx * 0.25 + (hash2(x, y, 3) - 0.5) * 0.25;
      return ditherPick(pal, lv, x, y);
    });
  }

  // Far reef walls, nearer coral silhouettes and a fogged mid bank with real (shrunken) props.
  buildLayers() {
    const W = this.W, H = this.H, pad = 28;
    this.pad = pad;
    const LW = W + pad * 2;
    const r = new RNG(5);
    // --- far A: distant reef wall with pinnacles & an arch
    const yA = Math.round(H * 0.3), hA = H - yA;
    const mA = new Mask(LW, hA);
    const rA = ridge(LW, hA * 0.5, hA * 0.16, 0.0065, 3.1, 4, 0.25);
    mA.below((x) => rA[x]);
    for (let i = 0; i < 6; i++) {
      const px = r.float(0.05, 0.95) * LW, top = hA * r.float(0.12, 0.34), w = r.float(9, 20);
      mA.poly([[px - w * 1.6, hA * 0.6], [px - w * 0.6, top + 18], [px - w * 0.25, top + 4], [px + w * 0.35, top], [px + w * 0.7, top + 14], [px + w * 1.5, hA * 0.6]]);
    }
    const ax = LW * 0.58, ay = hA * 0.42;
    mA.ellipse(ax, ay, 46, 30); mA.ellipse(ax, ay + 6, 30, 22, 0); mA.rect(ax - 30, ay + 6, 60, 40, 0);
    mA.rect(ax - 46, ay + 20, 16, 60); mA.rect(ax + 30, ay + 20, 16, 60);
    const palA = stopPalette([[0, '#0c3650'], [1, '#2a7a98']], 6);
    this.farA = new FogLayer(mA.toCanvas((x, y, v, up) => {
      if (up <= 1) return pack('#64c4d4');
      return ditherPick(palA, 0.75 - Math.min(1, up / 70) * 0.6 + (fbm2(x * 0.05, y * 0.05, 2, 2) - 0.5) * 0.35, x, y);
    }), -pad, yA);
    this.farAY = yA;
    // --- far B: coral heads, branching coral, sea fans, kelp silhouettes
    const yB = H - 270, hB = 270;
    const mB = new Mask(LW, hB);
    const rB = ridge(LW, hB * 0.62, 16, 0.011, 7.7, 3);
    mB.below((x) => rB[x]);
    for (let i = 0; i < 26; i++) {
      const px = r.float(0, LW), by = rB[Math.round(clamp(px, 0, LW))] + 4;
      const k = r.next();
      if (k < 0.35) mB.ellipse(px, by - 4, r.float(10, 22), r.float(7, 14));
      else if (k < 0.7) mB.branch(px, by, r.float(-0.2, 0.2), r.float(14, 24), r.float(2, 3.5), 3, r, 1, 0.6);
      else if (k < 0.85) { const fr = r.float(16, 26); for (let a = -1.1; a <= 1.1; a += 0.22) mB.line(px, by, px + Math.sin(a) * fr, by - Math.cos(a) * fr * 1.1, 1.1); mB.ellipse(px, by - fr * 0.6, fr * 0.85, fr * 0.55); }
      else { let x = px, y = by; for (let j = 0; j < 30; j++) { const nx = x + Math.sin(j * 0.4 + i) * 1.4, ny = y - 4; mB.line(x, y, nx, ny, 1.5); x = nx; y = ny; } }
    }
    const palB = stopPalette([[0, '#0a3246'], [1, '#2a6e88']], 6);
    this.farB = new FogLayer(mB.toCanvas((x, y, v, up) => {
      if (up <= 1) return pack('#7ed4dc');
      if (up === 2) return pack('#3e8ea4');
      return ditherPick(palB, 0.72 - Math.min(1, up / 40) * 0.55 + (fbm2(x * 0.08, y * 0.08, 2, 6) - 0.5) * 0.4, x, y);
    }), -pad, yB);
    this.farBY = yB;
    // --- mid: sandy bank with real props shrunk & fogged
    const yC = H - 150, hC = 150;
    const mC = new Mask(LW, hC);
    const rC = ridge(LW, 46, 9, 0.009, 2.2, 3);
    mC.below((x) => rC[x]);
    const palC = stopPalette([[0, '#8a7a68'], [0.6, '#c8b088'], [1, '#e8d4a6']], 5);
    const cC = mC.toCanvas((x, y, v, up) => (up <= 1 ? pack('#f4e4bc') : ditherPick(palC, 0.85 - Math.min(1, up / 30) * 0.6 + (fbm2(x * 0.1, y * 0.2, 2, 9) - 0.5) * 0.3, x, y)));
    const gC = ctxOf(cC);
    const mids = [['rock_arch', 0.13, 0.6, 0], ['coral_fan', 0.29, 0.55, 1], ['coral_branch', 0.51, 0.6, 2], ['coral_staghorn', 0.6, 0.6, 0], ['rock_big', 0.79, 0.55, 0], ['coral_branch', 0.885, 0.55, 0], ['coral_fan', 0.97, 0.5, 2], ['coral_tube', 0.04, 0.55, 1]];
    for (const [id, xf, sc, v] of mids) {
      const p = getProp(id, { scale: sc, variant: v });
      const x = Math.round(xf * W + pad), y = Math.round(rC[clamp(x, 0, LW)] + 6);
      gC.drawImage(p.canvas, x - p.ox, y - p.oy);
    }
    this.mid = new FogLayer(cC, -pad, yC);
    this.midY = yC;
    // giants
    this.whale = whaleFrames(230);
    this.whaleL = this.whale.map(flipCanvas);
    this.turtle = turtleFrames(60);
    this.turtleL = this.turtle.map(flipCanvas);
    this.giant = { kind: 'turtle', x: W * 0.62, y: H * 0.42, dir: -1, v: 11, ph: 0 };
    this.giantT = 0;
  }

  buildLife() {
    const W = this.W, H = this.H, g = this.ground;
    const r = new RNG(9);
    // tall kelp (behind the seabed), seaweed & sea grass (in front), anemone tentacles
    this.kelp = new Strands();
    const kelpCols = ['#3e5a24', '#5a7a2a', '#7e9a36', '#a8b84a'];
    for (const [xf, n, a] of [[0.035, 34, 0.9], [0.075, 40, 0.92], [0.12, 28, 0.85], [0.82, 30, 0.8], [0.875, 38, 0.82], [0.935, 26, 0.78], [0.56, 18, 0.7]]) {
      const x = Math.round(xf * W);
      this.kelp.add({ x, y: g.floor[x] + 3, n, seg: 4, w: 3, amp: 0.16, speed: 0.7 + r.float(0, 0.3), phase: r.float(0, TAU), wave: 0.22, lean: r.float(-0.08, 0.08), cols: kelpCols, out: '#1a2e1c', leaf: 'kelp', leafEvery: 3, leafLen: 6, leafCol: ['#4a6a26', '#6e8e30', '#94ac40', '#bcc858'], bulb: '#c8b84a', bulbEvery: 5, alpha: a, taper: 0.3 });
    }
    this.weed = new Strands();
    const weedSets = [
      ['#1e6a46', '#2e8a52', '#4aaa5e', '#86d27a'], ['#6a2a5a', '#943a6e', '#c4588a', '#f08ab0'], ['#7a4a1e', '#a8682a', '#d0903a', '#f0c060'],
    ];
    const spots = [[0.07, 0.36], [0.15, 0.4], [0.2, 0.3], [0.285, 0.12], [0.322, 0.3], [0.4, 0.2], [0.447, 0.36], [0.505, 0.4], [0.585, 0.1], [0.62, 0.32], [0.735, 0.14], [0.77, 0.38], [0.83, 0.32], [0.9, 0.4], [0.96, 0.28]];
    for (const [xf, zf] of spots) {
      const x0 = Math.round(xf * W), y0 = Math.round(g.surfaceY(x0, zf)) + 1;
      const set = r.pick(weedSets.slice(0, r.chance(0.7) ? 1 : 3));
      const tall = r.chance(0.35);
      const k = r.int(3, 6);
      for (let i = 0; i < k; i++) {
        this.weed.add({ x: x0 + r.int(-5, 5), y: y0 + r.int(-1, 1), n: tall ? r.int(8, 14) : r.int(4, 8), seg: 2, w: tall ? 2 : 1, amp: 0.3, speed: 1.4 + r.float(0, 0.6), phase: r.float(0, TAU), wave: 0.5, lean: r.float(-0.35, 0.35), cols: set, out: tall ? '#0e2a24' : null, hl: false, taper: 0.2, zf });
      }
    }
    this.anemones = [];
    for (const [xf, zf, cols, tip, glow] of [[0.385, 0.38, ['#a8306a', '#d84a8a', '#ff7ab0', '#ffc0dc'], '#fff0f6', '#ff7ab0'], [0.18, 0.44, ['#1e7a8a', '#2aa8b4', '#5ae0e0', '#c0fff8'], '#ffffff', '#5affea'], [0.79, 0.44, ['#a8582a', '#e07a3a', '#ffa860', '#ffe0b0'], '#fff4e0', '#ffb070']]) {
      const x = Math.round(xf * W), y = Math.round(g.surfaceY(x, zf)) + 1;
      const s = new Strands();
      for (let i = 0; i < 15; i++) {
        const a = -1.15 + (i / 14) * 2.3;
        s.add({ x: x + Math.round(a * 4.5), y: y - 6, n: 5 + (i % 3), seg: 2, w: 2, amp: 0.4, speed: 1.6, phase: i * 0.5, wave: 0.6, lean: a * 0.85, cols, out: '#3a1030', hl: false, tip, tipR: 1 });
      }
      this.anemones.push({ x, y, s, glow, base: cols });
    }
    // critters
    this.crabSpr = [crabFrames('#e8603a'), crabFrames('#f0a040')];
    this.crabs = [0.52, 0.86, 0.25].map((xf, i) => ({ x: xf * W, zf: [0.46, 0.4, 0.5][i], dir: i % 2 ? -1 : 1, state: 'walk', t: r.float(1, 4), f: 0, kind: i % 2, ft: 0 }));
    // particles
    const sy = this.base;
    this.plankton = new Motes(110, { x0: 0, y0: sy + 4, x1: W, y1: H - 60 }, { seed: 3, vx: [-3, 3], vy: [-2.5, 1.5], sizes: [1, 1, 1, 2], colors: ['#d8fff4', '#ffffff', '#b8f0ff', '#fff6c8'], alpha: [0.25, 0.75], wob: 5 });
    this.nearMotes = new Motes(26, { x0: 0, y0: sy + 10, x1: W, y1: H - 30 }, { seed: 8, vx: [-5, 5], vy: [-3, 3], sizes: [2, 2, 3], colors: ['#e8fff8', '#c8f4ff'], alpha: [0.12, 0.3], wob: 8 });
    this.glowPlankton = new Motes(34, { x0: 0, y0: sy + 20, x1: W, y1: H - 50 }, { seed: 12, vx: [-4, 4], vy: [-2, 2], sizes: [1], colors: ['#7affea', '#9ad8ff', '#c8ff9a'], alpha: [0.5, 1], wob: 6 });
    this.bubbles = new Bubbles(90);
    this.emitT = { cave: 1, boat: 2, anem: 3, sand: 1.5 };
    this.drops = [];
    this.hint = { t: 0 };
  }

  // ------------------------------------------------------------------ update
  update(dt, env) {
    this.t += dt;
    const t = this.t, W = this.W, H = this.H;
    const tod = todWeights(env);
    this.tod = tod;
    const snap = this.fresh;
    const k = snap ? 1 : 1 - Math.exp(-dt * 0.6);
    const w = env.weather;
    const wx = this.wx;
    wx.cloud += ((w === 'cloudy' ? 1 : w === 'rain' ? 0.6 : w === 'storm' ? 0.4 : 0) - wx.cloud) * k;
    wx.rain += ((w === 'rain' ? 1 : w === 'storm' ? 1 : 0) - wx.rain) * k;
    wx.storm += ((w === 'storm' ? 1 : 0) - wx.storm) * k;
    wx.clear = clamp01(1 - wx.cloud * 0.6 - wx.rain * 0.75 - wx.storm * 0.2);
    // parallax from the cursor
    const c = env.cursor;
    const tx = c && c.x > -50 ? (c.x / W - 0.5) * -2 : 0, ty = c && c.y > -50 ? (c.y / H - 0.5) * -2 : 0;
    const kp = snap ? 1 : 1 - Math.exp(-dt * 2.5);
    this.par.x += (tx - this.par.x) * kp;
    this.par.y += (ty - this.par.y) * kp;
    this.fresh = false;
    // colours
    this.cols.crest = tri('#eafffb', '#ffe2c0', '#a8c8ee', tod);
    this.cols.sub = tri('#8eece8', '#d0a8a8', '#4a80b0', tod);
    this.fogColor = tri('#33b2cc', '#2e6e98', '#1c5284', tod);
    if (wx.rain > 0.05) this.fogColor = qmix(this.fogColor, '#5a7484', wx.rain * 0.35);
    // weather motion
    const q = quality(env);
    const sy = this.surfaceAt(env);
    if (wx.rain > 0.05 && sy > -4) {
      const rate = (25 + wx.storm * 50) * wx.rain * q;
      let n = rate * dt;
      while (n > 0) { if (Math.random() < n) this.drops.push({ x: Math.random() * W, t: 0, big: Math.random() < 0.25 }); n -= 1; }
    }
    for (const d of this.drops) d.t += dt;
    this.drops = this.drops.filter((d) => d.t < 0.6);
    for (const l of this.rainLines) { l.y += l.v * dt; l.x -= l.v * dt * 0.25 * (1 + wx.storm); if (l.y > this.skyH) { l.y -= this.skyH + 6; l.x = Math.random() * W; } if (l.x < 0) l.x += W; }
    for (const cl of this.clouds) { cl.x += cl.v * dt * (1 + wx.storm * 2); if (cl.x > W + 10) cl.x = -cl.w - 10; }
    for (const cl of this.rainClouds) { cl.x += cl.v * dt * (1 + wx.storm); if (cl.x > W + 10) cl.x = -cl.w - 10; }
    for (const gl of this.gulls) { gl.x += gl.v * dt; gl.ph += dt * 6; if (gl.x > W + 20) gl.x = -20; if (gl.x < -20) gl.x = W + 20; }
    // lightning
    this.flash = Math.max(0, this.flash - dt * 2.6);
    if (wx.storm > 0.5) {
      this.flashT -= dt;
      if (this.flashT <= 0) {
        this.flashT = 4 + Math.random() * 9;
        this.flash = 1;
        const bx = W * (0.15 + Math.random() * 0.7);
        const pts = [[bx, -2]];
        let x = bx, y = -2;
        while (y < this.base) { y += 3 + Math.random() * 5; x += (Math.random() - 0.5) * 9; pts.push([x, Math.min(y, this.base)]); }
        this.bolt = { pts, t: 0 };
        try { this.game?.audio?.play?.('thunder', { vol: 0.6 }); } catch { /* optional sound */ }
      }
    }
    if (this.bolt) { this.bolt.t += dt; if (this.bolt.t > 0.35) this.bolt = null; }
    env.flash = this.flash;
    // particles & critters
    const cur = (Math.sin(t * 0.21) * 3 + wx.storm * 8);
    this.plankton.update(dt, cur, 0);
    this.nearMotes.update(dt, cur * 1.4, 0);
    this.glowPlankton.update(dt, cur, 0);
    this.bubbles.update(dt, sy);
    const e = this.emitT;
    e.cave -= dt; e.boat -= dt; e.anem -= dt; e.sand -= dt;
    if (e.cave <= 0) { e.cave = this.secrets().cave ? 1.6 : 3.2; for (let i = 0; i < 3; i++) this.bubbles.emit(this.cave.cx + (Math.random() - 0.5) * 3, this.cave.cy - 3 - i * 4, { r: i === 0 ? 2 : 1 }); }
    if (e.boat <= 0) { e.boat = 1.2 + Math.random() * 2; this.bubbles.emit(this.vent.x + (Math.random() - 0.5) * 30, this.vent.y, { r: Math.random() < 0.3 ? 2 : 1 }); }
    if (e.sand <= 0) { e.sand = 0.8 + Math.random() * 1.5; const x = Math.random() * W; this.bubbles.emit(x, this.floorAt(x) + 4 + Math.random() * 16, { r: Math.random() < 0.15 ? 3 : 1 }); }
    if (e.anem <= 0) { e.anem = 2.5 + Math.random() * 3; const a = this.anemones[Math.floor(Math.random() * this.anemones.length)]; this.bubbles.emit(a.x, a.y - 14, { r: 1 }); }
    for (const cr of this.crabs) {
      cr.t -= dt;
      if (cr.state === 'walk') {
        cr.x += cr.dir * dt * 9;
        cr.ft += dt * 10;
        if (cr.x < 30 || cr.x > W - 30) cr.dir *= -1;
      }
      if (cr.t <= 0) {
        if (cr.state === 'walk') { cr.state = 'idle'; cr.t = 1 + Math.random() * 3; } else { cr.state = 'walk'; cr.t = 1.5 + Math.random() * 4; if (Math.random() < 0.4) cr.dir *= -1; }
      }
    }
    // distant giants
    const gi = this.giant;
    if (gi) {
      gi.x += gi.dir * gi.v * dt;
      gi.ph += dt * (gi.kind === 'whale' ? 0.9 : 1.6);
      gi.y += Math.sin(t * 0.3) * dt * 2;
      if (gi.x < -300 || gi.x > W + 300) { this.giant = null; this.giantT = 25 + Math.random() * 50; }
    } else {
      this.giantT -= dt;
      if (this.giantT <= 0) {
        const whale = Math.random() < 0.4;
        const dir = Math.random() < 0.5 ? 1 : -1;
        this.giant = { kind: whale ? 'whale' : 'turtle', dir, x: dir > 0 ? -260 : W + 260, y: H * (whale ? 0.28 + Math.random() * 0.12 : 0.32 + Math.random() * 0.2), v: whale ? 8 : 12, ph: 0 };
      }
    }
    // sandcastle collapse animation
    const cs = this.castle;
    cs.shake = Math.max(0, cs.shake - dt * 3);
    if (cs.state === 'collapsing') { cs.t += dt; if (cs.t > 1.4) cs.state = 'collapsed'; }
    this.hint.t += dt;
  }

  secrets() { return this.game?.state?.secrets || {}; }

  // ------------------------------------------------------------------ draw
  drawAir(env) {
    const g = this.air.ctx, W = this.W, h = this.skyH, t = this.t, tod = this.tod, wx = this.wx;
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    g.drawImage(this.skyBlend.get([[this.sky.day, tod.day], [this.sky.dusk, tod.dusk], [this.sky.night, tod.night]]), 0, 0);
    const oc = clamp01(wx.cloud * 0.6 + wx.rain * 0.85 + wx.storm * 0.12);
    if (tod.night > 0.15) for (const s of this.stars) twinkle(g, s.x, s.y, (0.4 + 0.6 * Math.sin(t * s.f + s.ph)) * tod.night * (1 - oc), s.c);
    // clouds: blend the three palettes
    for (const cl of this.clouds) {
      const x = Math.round(cl.x), y = cl.y;
      let acc = 0;
      for (const [key, wgt] of [['day', tod.day], ['dusk', tod.dusk], ['night', tod.night]]) {
        if (wgt <= 0.01) continue;
        acc += wgt;
        g.globalAlpha = wgt / acc;
        g.drawImage(cl.spr[key], x, y);
      }
    }
    g.globalAlpha = 1;
    // gulls
    const gullA = (tod.day + tod.dusk) * (1 - wx.storm) * (1 - wx.rain * 0.7);
    if (gullA > 0.05) {
      g.fillStyle = tod.dusk > 0.5 ? '#3a2438' : '#3c4658';
      g.globalAlpha = gullA;
      for (const gl of this.gulls) {
        const x = Math.round(gl.x), y = Math.round(gl.y + Math.sin(gl.ph * 0.2) * 3);
        const f = Math.sin(gl.ph) > 0.3 ? 0 : Math.sin(gl.ph) > -0.4 ? 1 : 2;
        if (f === 0) { g.fillRect(x - 3, y - 2, 1, 1); g.fillRect(x - 2, y - 1, 2, 1); g.fillRect(x, y, 1, 1); g.fillRect(x + 1, y - 1, 2, 1); g.fillRect(x + 3, y - 2, 1, 1); }
        else if (f === 1) { g.fillRect(x - 3, y, 3, 1); g.fillRect(x, y, 1, 1); g.fillRect(x + 1, y, 3, 1); }
        else { g.fillRect(x - 3, y + 1, 1, 1); g.fillRect(x - 2, y, 2, 1); g.fillRect(x, y, 1, 1); g.fillRect(x + 1, y, 2, 1); g.fillRect(x + 3, y + 1, 1, 1); }
      }
      g.globalAlpha = 1;
    }
    // overcast
    if (oc > 0.01) {
      g.globalAlpha = oc;
      fillWith(g, this.ocBlend.get([[this.overcast.day, tod.day], [this.overcast.dusk, tod.dusk], [this.overcast.night, tod.night]]), 0, 0, W, h);
      g.globalAlpha = 1;
    }
    const rc = clamp01(wx.rain * 0.9 + wx.storm * 0.3);
    if (rc > 0.02) {
      g.globalAlpha = rc * (1 - tod.night * 0.6);
      for (const cl of this.rainClouds) g.drawImage(cl.spr, Math.round(cl.x), cl.y);
      g.globalAlpha = 1;
    }
    if (wx.storm > 0.05) { g.fillStyle = rgba('#141c26', wx.storm * 0.35); g.fillRect(0, 0, W, h); }
    // rain streaks
    if (wx.rain > 0.05) {
      g.fillStyle = tod.night > 0.5 ? '#6a7a90' : '#d4e0ec';
      g.globalAlpha = wx.rain * 0.55;
      const n = Math.round(this.rainLines.length * wx.rain * quality(env));
      for (let i = 0; i < n; i++) {
        const l = this.rainLines[i];
        const x = Math.round(l.x), y = Math.round(l.y);
        for (let j = 0; j < l.l; j++) g.fillRect(x - Math.floor(j / 3), y + j, 1, 1);
      }
      g.globalAlpha = 1;
    }
    // lightning
    if (this.flash > 0.01) {
      g.fillStyle = rgba('#e8f0ff', this.flash * 0.55);
      g.fillRect(0, 0, W, h);
    }
    if (this.bolt) {
      const pts = this.bolt.pts;
      g.fillStyle = '#c8b8ff';
      for (let i = 0; i + 1 < pts.length; i++) this.pxLine(g, pts[i], pts[i + 1], 3, -1);
      g.fillStyle = '#ffffff';
      for (let i = 0; i + 1 < pts.length; i++) this.pxLine(g, pts[i], pts[i + 1], 1, 0);
    }
  }

  pxLine(g, a, b, w, o) {
    const n = Math.max(1, Math.ceil(Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]))));
    for (let k = 0; k <= n; k++) g.fillRect(Math.round(a[0] + ((b[0] - a[0]) * k) / n) + o, Math.round(a[1] + ((b[1] - a[1]) * k) / n), w, 1);
  }

  drawBack(ctx, env) {
    const W = this.W, H = this.H, t = this.t, tod = this.tod, wx = this.wx;
    const sy = this.surfaceAt(env);
    const ys = this.ys;
    const amp = 1.4 + wx.cloud * 0.4 + wx.rain * 0.6 + wx.storm * 2.6;
    waveLine(ys, W, sy, t, amp, 0.4 + wx.storm * 1.6, 1 + wx.storm * 0.7);
    let top = H;
    for (let x = 0; x <= W; x++) if (ys[x] < top) top = ys[x];
    const water = this.waterBlend.get([[this.water.day, tod.day], [this.water.dusk, tod.dusk], [this.water.night, tod.night]]);
    const hasAir = top > -3;
    if (hasAir) {
      this.drawAir(env);
      ctx.drawImage(this.air.canvas, 0, 0);
    }
    fillWith(ctx, water, 0, Math.max(top, -10), W, H - Math.max(top, -10));
    if (hasAir) {
      const air = this.air.canvas;
      waveRuns(ys, W, (x0, len, y) => {
        const h = Math.min(y, this.skyH) - top;
        if (h > 0) ctx.drawImage(air, x0, top, len, h, x0, top, len, h);
      });
    }
    // parallax layers (fogged toward the live water gradient)
    const key = this.waterBlend.key;
    const px = this.par.x, py = this.par.y;
    const wob = quality(env) >= 1 ? 1 : 0;
    drawWobble(ctx, this.farA.tint(water, 0.72, key), -this.pad + px * 1.5, this.farAY + py, t, wob, 3, 0.9, 0.07);
    this.drawGiant(ctx);
    drawWobble(ctx, this.farB.tint(water, 0.5, key), -this.pad + px * 3, this.farBY + py * 1.5, t + 2, wob, 3, 1.1, 0.09);
    ctx.drawImage(this.mid.tint(water, 0.3, key), Math.round(-this.pad + px * 6), Math.round(this.midY + py * 2.5));
    // weather murk
    const murk = wx.cloud * 0.08 + wx.rain * 0.14 + wx.storm * 0.1;
    if (murk > 0.01) { ctx.fillStyle = rgba(tod.night > 0.5 ? '#0a1424' : '#5a6c7c', murk); ctx.fillRect(0, Math.max(0, top), W, H - Math.max(0, top)); }
    this.drawSurface(ctx, env, sy);
  }

  drawGiant(ctx) {
    const gi = this.giant;
    if (!gi) return;
    const fr = gi.kind === 'whale' ? (gi.dir > 0 ? this.whale : this.whaleL) : gi.dir > 0 ? this.turtle : this.turtleL;
    const spr = fr[Math.floor(((gi.ph / TAU) * fr.length) % fr.length + fr.length) % fr.length];
    const c = tinted(spr, '#08304a');
    ctx.globalAlpha = gi.kind === 'whale' ? 0.32 : 0.36;
    ctx.drawImage(c, Math.round(gi.x - spr.width / 2 + this.par.x * 2), Math.round(gi.y - spr.height / 2 + this.par.y));
    ctx.globalAlpha = 1;
  }

  drawSurface(ctx, env, sy) {
    if (sy < -8) return;
    const W = this.W, ys = this.ys, t = this.t, tod = this.tod, wx = this.wx;
    ctx.fillStyle = this.cols.sub;
    ctx.globalAlpha = 0.55;
    waveRuns(ys, W, (x0, len, y) => ctx.fillRect(x0, y + 1, len, 2));
    ctx.globalAlpha = 1;
    // underside shimmer (two scrolling copies)
    ctx.globalCompositeOperation = 'lighter';
    const sh = this.shimmer, shH = sh.height;
    const a1 = (0.55 - tod.night * 0.3) * (1 - wx.storm * 0.4);
    const o1 = Math.floor((t * 9) % 256), o2 = Math.floor((256 - ((t * 5) % 256)) % 256);
    ctx.globalAlpha = a1;
    waveRuns(ys, W, (x0, len, y) => ctx.drawImage(sh, x0 + o1, 0, len, shH, x0, y + 2, len, shH));
    ctx.globalAlpha = a1 * 0.6;
    waveRuns(ys, W, (x0, len, y) => ctx.drawImage(sh, x0 + o2, 3, len, shH - 3, x0, y + 4, len, shH - 3));
    // sun / moon glitter column on the surface
    const s = tod.night > 0.5 ? this.sun.night : tod.dusk > 0.4 ? this.sun.dusk : this.sun.day;
    const gc = tod.night > 0.5 ? '#c8dcff' : tod.dusk > 0.4 ? '#ffd090' : '#ffffff';
    ctx.fillStyle = gc;
    const ga = wx.clear;
    for (let i = 0; i < 26; i++) {
      const ph = Math.floor(t * 3 + i * 0.61);
      const x = Math.round(s.x + (hash2(i, ph, 5) - 0.5) * (40 + i * 3));
      if (x < 0 || x >= W) continue;
      const k = Math.sin(((t * 3 + i * 0.61) % 1) * Math.PI);
      ctx.globalAlpha = k * ga * 0.9;
      ctx.fillRect(x, ys[x] + 1 + Math.floor(hash2(i, ph, 6) * 6), 2 + Math.floor(hash2(i, ph, 7) * 4), 1);
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    // crest line
    ctx.fillStyle = this.cols.crest;
    waveRuns(ys, W, (x0, len, y) => ctx.fillRect(x0, y, len, 1));
    // whitecaps in storms
    if (wx.storm > 0.2) {
      ctx.fillStyle = '#ffffff';
      ctx.globalAlpha = wx.storm;
      for (let x = 1; x < W; x++) if (ys[x] < ys[x - 1] && ys[x] <= ys[x + 1] && hash2(x, Math.floor(t * 4), 1) < 0.6) ctx.fillRect(x - 1, ys[x] - 1, 3, 1);
      ctx.globalAlpha = 1;
    }
    // raindrop dimples
    if (this.drops.length) {
      for (const d of this.drops) {
        const x = Math.round(d.x), y = ys[clamp(x, 0, W)];
        const k = d.t / 0.6;
        ctx.fillStyle = this.cols.crest;
        ctx.globalAlpha = 1 - k;
        if (d.t < 0.12) ctx.fillRect(x, y - 2 - Math.round(d.t * 20), 1, d.big ? 2 : 1);
        const rr = Math.round(1 + k * (d.big ? 6 : 4));
        ctx.fillRect(x - rr, y + 1, 1, 1); ctx.fillRect(x + rr, y + 1, 1, 1);
        ctx.globalAlpha = (1 - k) * 0.6;
        ctx.fillRect(x - rr + 1, y + 2 + Math.round(k * 2), rr * 2 - 1, 1);
      }
      ctx.globalAlpha = 1;
    }
  }

  drawSeabed(ctx, env) {
    const W = this.W, H = this.H, t = this.t, tod = this.tod, wx = this.wx;
    const sy = this.surfaceAt(env);
    const q = quality(env);
    // god rays
    const rayA = (tod.day * 0.95 + tod.dusk * 0.8 + tod.night * 0.35) * (0.15 + wx.clear * 0.85) * (1 - wx.storm * 0.6);
    if (rayA > 0.02) {
      const rc = tri('#fff6d8', '#ffb87a', '#a8c8ff', tod);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = rayA * (0.8 + 0.2 * Math.sin(t * 0.37));
      ctx.drawImage(this.raysA.tint(rc, 1, rc), Math.round(Math.sin(t * 0.06) * 16), sy - 2);
      ctx.globalAlpha = rayA * (0.65 + 0.35 * Math.sin(t * 0.53 + 2));
      ctx.drawImage(this.raysB.tint(rc, 1, rc), Math.round(Math.sin(t * 0.045 + 1) * 24), sy - 2);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    }
    // plankton motes catching the light
    this.plankton.draw(ctx, t, 0.6 + tod.day * 0.4, q, 0.6);
    // tall kelp behind the sand
    this.kelp.draw(ctx, t, Math.sin(t * 0.25) * 0.05 + wx.storm * 0.18);
    ctx.drawImage(this.bed, 0, this.bedY);
    // caustics
    const ca = (tod.day * 0.75 + tod.dusk * 0.45 + tod.night * 0.22) * (0.2 + wx.clear * 0.8);
    if (q >= 0.75 || ca > 0.3) this.caustics.draw(ctx, this.bedMask, 0, this.bedY, t, ca, { fps: 8, drift: 4 });
    this.drawCastle(ctx);
    // anemones, seaweed, crabs
    for (const a of this.anemones) {
      ctx.fillStyle = '#3a1030';
      ctx.fillRect(a.x - 7, a.y - 7, 15, 8);
      ctx.fillStyle = a.base[0];
      ctx.fillRect(a.x - 6, a.y - 6, 13, 6);
      ctx.fillStyle = a.base[1];
      ctx.fillRect(a.x - 5, a.y - 6, 9, 2);
      a.s.draw(ctx, t, Math.sin(t * 0.4 + a.x) * 0.1);
    }
    this.weed.draw(ctx, t, Math.sin(t * 0.3) * 0.08 + wx.storm * 0.25);
    for (const cr of this.crabs) {
      const y = Math.round(this.ground.surfaceY(cr.x, cr.zf));
      const spr = this.crabSpr[cr.kind][cr.state === 'walk' ? 1 + (Math.floor(cr.ft) % 2) : 0];
      ctx.drawImage(spr, Math.round(cr.x) - 8, y - 10);
    }
    this.bubbles.draw(ctx, t);
    // secret hints
    const s = this.secrets();
    const hk = (period, off) => { const p = ((this.hint.t + off) % period) / period; return p < 0.12 ? Math.sin((p / 0.12) * Math.PI) : 0; };
    twinkle(ctx, this.bottle.cx + 6, this.bottle.cy - 2, hk(5.5, 0), '#ffffff');
    if (this.castle.state === 'intact') twinkle(ctx, this.castle.x + 2, this.castle.rect.y + 4, hk(7, 2.5), '#fff6c0');
    if (!s.cave) twinkle(ctx, this.cave.cx + 5, this.cave.cy - 6, hk(9, 4.5) * 0.7, '#c8fff0');
    else if (tod.night > 0.3 || Math.sin(t * 0.7) > 0.6) {
      // something blinks inside the cave
      const blink = Math.sin(t * 1.3) > -0.9;
      if (blink) { ctx.fillStyle = '#ffe27a'; ctx.fillRect(this.cave.cx - 3, this.cave.cy - 1, 1, 1); ctx.fillRect(this.cave.cx + 1, this.cave.cy - 1, 1, 1); }
    }
    if (tod.night > 0.4) {
      // sandcastle windows & boat lantern glow at night
      if (this.castle.state === 'intact') drawGlow(ctx, this.castle.x, this.castle.y - 26, 5, '#ffcc66', tod.night * 0.6);
      drawGlow(ctx, this.lantern.x, this.lantern.y, 6, '#ffd27a', tod.night * (0.7 + 0.2 * Math.sin(t * 5)));
    }
  }

  drawCastle(ctx) {
    const c = this.castle, p = this.castleProp, t = this.t;
    const collapsed = c.state === 'collapsed' || this.secrets().sandcastle;
    if (!collapsed && c.state === 'intact') {
      const sx = Math.round(Math.sin(t * 60) * c.shake * 2);
      ctx.drawImage(p.canvas, c.x - p.ox + sx, c.y - p.oy);
      return;
    }
    const hp = this.heap;
    if (c.state === 'collapsing') {
      const k = clamp01(c.t / 1.1);
      const sink = Math.round(ease.inQuad(k) * p.oy);
      const visH = p.oy - sink;
      if (visH > 0) ctx.drawImage(p.canvas, 0, 0, p.w, visH, c.x - p.ox + Math.round(Math.sin(t * 40) * 2 * (1 - k)), c.y - p.oy + sink, p.w, visH);
      ctx.globalAlpha = k;
      ctx.drawImage(hp, c.x - (hp.width >> 1), c.y - hp.height + 3);
      ctx.globalAlpha = 1;
      return;
    }
    const ch = this.chest;
    ctx.drawImage(ch.canvas, c.x + 4 - ch.ox, c.y - 10 - ch.oy);
    ctx.drawImage(hp, c.x - (hp.width >> 1), c.y - hp.height + 3);
    // glints on the chest
    const k = ((t % 3) / 3);
    if (k < 0.15) twinkle(ctx, c.x + 6, c.y - 20, Math.sin((k / 0.15) * Math.PI), '#fff6b0');
  }

  drawFront(ctx, env) {
    const t = this.t, tod = this.tod, q = quality(env);
    this.nearMotes.draw(ctx, t, 0.8 + tod.day * 0.3, q);
    if (tod.night > 0.3) {
      // bioluminescent plankton
      ctx.globalCompositeOperation = 'lighter';
      const n = Math.round(this.glowPlankton.list.length * q);
      for (let i = 0; i < n; i++) {
        const p = this.glowPlankton.list[i];
        const k = 0.5 + 0.5 * Math.sin(t * p.tw + p.ph);
        if (k < 0.2) continue;
        const x = p.x + Math.sin(t * 0.7 + p.ph) * 6, y = p.y + Math.cos(t * 0.5 + p.ph) * 3;
        drawGlow(ctx, x, y, 3, p.c, k * tod.night * 0.8);
        ctx.fillStyle = '#ffffff';
        ctx.globalAlpha = k * tod.night;
        ctx.fillRect(Math.round(x), Math.round(y), 1, 1);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
    if (this.flash > 0.02) {
      ctx.fillStyle = rgba('#e8f2ff', this.flash * 0.16);
      ctx.fillRect(0, 0, this.W, this.H);
    }
  }

  // ------------------------------------------------------------------ lighting
  lighting(env) {
    const tod = todWeights(env);
    const wx = this.wx;
    let dark = tod.night * 0.52 + tod.dusk * 0.14 + wx.cloud * 0.06 + wx.rain * 0.1 + wx.storm * 0.16;
    dark *= 1 - this.flash * 0.6;
    let tint = qmix('#8a5a80', '#1e2c6a', tod.night / Math.max(0.001, tod.night + tod.dusk));
    tint = qmix(tint, '#3c4a5c', clamp01((wx.rain * 0.5 + wx.storm * 0.4) * (1 - tod.night * 0.5)));
    const lights = [];
    if (dark > 0.04) {
      const n = tod.night;
      const sy = this.surfaceAt(env);
      const m = this.sun.night;
      if (n > 0.2 && wx.clear > 0.2) lights.push({ x: m.x, y: Math.max(0, sy) + 10, r: 150, color: '#7a9ad8', a: 0.45 * n * wx.clear });
      for (const a of this.anemones) lights.push({ x: a.x, y: a.y - 14, r: 30, color: a.glow, a: 0.55 * n + 0.1 });
      if (this.castle.state === 'intact' && !this.secrets().sandcastle) lights.push({ x: this.castle.x, y: this.castle.y - 26, r: 26, color: '#ffc870', a: 0.6 * n });
      else lights.push({ x: this.castle.x + 4, y: this.castle.y - 16, r: 30, color: '#ffe27a', a: 0.5 * n + 0.15 });
      lights.push({ x: this.lantern.x, y: this.lantern.y, r: 44, color: '#ffc870', a: 0.7 * n });
      if (this.secrets().cave) lights.push({ x: this.cave.cx, y: this.cave.cy, r: 22, color: '#7affd8', a: 0.5 * n + 0.1 });
      if (n > 0.3) for (let i = 0; i < 6; i++) { const p = this.glowPlankton.list[i]; lights.push({ x: p.x, y: p.y, r: 20, color: '#5affe0', a: 0.35 * n }); }
    }
    return { dark: clamp(dark, 0, 0.75), tint, lights };
  }

  // ------------------------------------------------------------------ secrets
  secretAt(x, y) {
    if (this.castle.state === 'intact' && !this.secrets().sandcastle && inRect(x, y, this.castle.rect)) return 'sandcastle';
    if (inRect(x, y, this.bottle, 2)) return 'bottle';
    if (inRect(x, y, this.cave, 3)) return 'cave';
    return null;
  }

  onSecret(id, game) {
    const st = game.state;
    st.secrets ||= {};
    const audio = game.audio;
    const fx = game.particles;
    if (id === 'sandcastle') {
      const c = this.castle;
      c.clicks++;
      c.shake = 1;
      audio?.play?.('sand', { vol: 0.6 });
      for (let i = 0; i < 6; i++) fx?.burst?.(c.x + (Math.random() - 0.5) * 30, c.y - 20, 1, { colors: ['#f2dcae', '#e4c992'], g: 80, speed: 30 });
      if (c.clicks >= 3) {
        c.state = 'collapsing';
        c.t = 0;
        st.secrets.sandcastle = true;
        const coins = 40 + Math.floor(Math.random() * 30);
        audio?.play?.('treasure_open');
        setTimeout(() => audio?.play?.('sparkle'), 300);
        game.addCoins(coins, c.x, c.y - 20);
        for (let i = 0; i < 10; i++) fx?.sparkle?.(c.x + (Math.random() - 0.5) * 40, c.y - 10 - Math.random() * 30, '#fff2a0');
        game.toast?.(`The sandcastle crumbled... revealing buried treasure! +${coins} coins`, 'coin');
        game.save?.();
      } else if (c.clicks === 1) game.toast?.('The sandcastle wobbles.', 'info');
      return;
    }
    if (id === 'bottle') {
      const txt = RIDDLES[this.riddle % RIDDLES.length];
      this.riddle++;
      st.secrets.bottle = true;
      audio?.play?.('sparkle', { vol: 0.5 });
      game.toast?.(txt, 'scroll');
      return;
    }
    if (id === 'cave') {
      if (st.secrets.cave) { game.toast?.('Something watches you from the hidden cave...', 'eye'); audio?.play?.('blub'); return; }
      st.secrets.cave = true;
      audio?.play?.('magic');
      for (let i = 0; i < 8; i++) this.bubbles.emit(this.cave.cx + (Math.random() - 0.5) * 8, this.cave.cy - Math.random() * 6, { r: 1 + Math.floor(Math.random() * 3) });
      game.toast?.('You found a hidden cave! Shy creatures may now come out to play.', 'star');
      game.save?.();
    }
  }
}
