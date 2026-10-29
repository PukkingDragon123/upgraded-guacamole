// Sunny Shallows: a crystal turquoise reef under a living sky (sun, sunset, moon and stars, clouds,
// gulls, rain and storms). Static art (sky, water gradients, parallax reef silhouettes, voxel sand and
// coral props) is pre-rendered in build(); per frame we blit layers and animate the surface, rays,
// caustics, kelp, anemones, crabs, bubbles, plankton and the occasional distant whale or turtle.

import { Biome, worldTop } from './base.js';
import { SkyDome, skyBodies } from '../sky.js';
import { palmIsland, lighthouseIslet, sailboat, seaStacks, markerBuoy } from '../horizon.js';
import { render, strip, spire, mesa, rockArch, ridgeStrip, kelpColumn, propSprite } from '../farvox.js';
import { clamp, clamp01, lerp, smoothstep, ease, hash2, fbm2, TAU } from '../../core/math.js';
import { RNG } from '../../core/rng.js';
import { mix, rgba, pack } from '../../core/color.js';
import { ctxOf, makeLayer, tinted } from '../../core/canvas.js';
import { PixelBuffer, selOut, flipCanvas } from '../../gfx/pixel.js';
import { getProp } from '../../gfx/props.js';
import {
  paint, dpack, lerpStops, gradientStrip, stopPalette, ditherPick, Blend, FogLayer, fillWith, drawWobble, makeRays,
  drawGlow, twinkle, Caustics, lumaMask, waveLine, waveRuns, Strands, Motes, Bubbles, Mask, ridge, todWeights,
  quality, inRect, bladeSprites, SwayAnim, streakTile, DepthScene, BandSet, DepthDecor, qscale, waterColorAt,
  hazeMask,
} from '../scenery.js';

const SKY = {
  day: [[0, '#2468c0'], [0.45, '#3f94e0'], [0.78, '#62b8ee'], [0.92, '#9edcf6'], [1, '#e2f8ff']],
  dusk: [[0, '#161a4a'], [0.42, '#3a2a72'], [0.7, '#8a3e7c'], [0.86, '#e2667a'], [0.95, '#ff9a58'], [1, '#ffd47a']],
  night: [[0, '#01030c'], [0.55, '#060e2a'], [0.85, '#0e1c44'], [1, '#1b2e5e']],
};
const SKYHZ = { day: '#c8ecf8', dusk: '#f0a882', night: '#18284e' };
const OVERCAST = {
  day: [[0, '#7e8ca0'], [1, '#c6d0da']],
  dusk: [[0, '#40344e'], [1, '#a47c7a']],
  night: [[0, '#04060c'], [1, '#141a28']],
};
const WATER = {
  day: [[0, '#86f2e6'], [0.06, '#56dcdc'], [0.3, '#2db6d0'], [0.62, '#1b8ec0'], [1, '#146ea6']],
  dusk: [[0, '#f2b48a'], [0.03, '#b0a8a8'], [0.1, '#4a92b4'], [0.42, '#2c649c'], [1, '#1e3a74']],
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

function turtleFrames(L = 70) {
  const frames = [];
  for (let f = 0; f < 12; f++) {
    const ph = (f / 12) * TAU;
    const m = new Mask(L * 1.5, L * 1.1);
    const cx = L * 0.62, cy = L * 0.45;
    // domed shell (flat plastron)
    for (let x = -L * 0.38; x <= L * 0.38; x++) {
      const u = x / (L * 0.38);
      const top = cy - Math.sqrt(Math.max(0, 1 - u * u)) * L * 0.2 - (1 - u * u) * L * 0.02;
      const bot = cy + L * 0.05 - Math.abs(u) * L * 0.03;
      for (let y = Math.round(top); y < Math.round(bot); y++) m.set(cx + x, y, 1);
    }
    // head on a short neck
    m.line(cx + L * 0.34, cy + L * 0.01, cx + L * 0.46, cy - L * 0.02, L * 0.06);
    m.ellipse(cx + L * 0.5, cy - L * 0.03, L * 0.08, L * 0.065);
    // front flipper: a long wing that sweeps down and back
    const a = 0.25 + (Math.sin(ph) * 0.5 + 0.5) * 1.05;
    const bx = cx + L * 0.2, by = cy + L * 0.04;
    const len = L * 0.5;
    const tx = bx - Math.cos(a) * len, ty = by + Math.sin(a) * len;
    m.line(bx, by, (bx + tx) / 2 + 2, (by + ty) / 2, L * 0.075, 1, L * 0.05);
    m.line((bx + tx) / 2 + 2, (by + ty) / 2, tx, ty, L * 0.05, 1, L * 0.012);
    // rear flipper
    const b2 = Math.sin(ph + 2) * 0.35;
    m.line(cx - L * 0.3, cy + L * 0.04, cx - L * 0.46, cy + L * 0.1 + b2 * L * 0.12, L * 0.045, 1, L * 0.015);
    m.poly([[cx - L * 0.36, cy - L * 0.02], [cx - L * 0.45, cy + L * 0.01], [cx - L * 0.36, cy + L * 0.04]]);
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
    this.fogAmount = 0.55;
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
    this.top = worldTop(H);
    this.ys = new Int16Array(W + 2);
    this.ys.fill(this.base);
    this.ocBlend = new Blend(); this.waterBlend = new Blend();
    this.buildSky();
    const wo = { y0: this.base - 2, y1: H, levels: 24 };
    this.water = { day: gradientStrip(H, WATER.day, wo), dusk: gradientStrip(H, WATER.dusk, wo), night: gradientStrip(H, WATER.night, wo) };
    this.buildDepth();
    this.buildLayers();
    const rh = H - this.base;
    this.raysA = new FogLayer(makeRays(W, rh, { seed: 4, count: 8, sunX: W * 0.78, sunY: -H * 0.8, minW: 10, maxW: 34, len: 0.95, color: '#ffffff', alpha: 0.5, levels: 5 }));
    this.raysB = new FogLayer(makeRays(W, rh, { seed: 9, count: 14, sunX: W * 0.74, sunY: -H * 0.7, minW: 3, maxW: 9, len: 0.75, color: '#ffffff', alpha: 0.6, levels: 4 }));
    this.caustics = new Caustics({ tw: 150, th: 44, cx: 11, cy: 5, seed: 11, color: '#fffbe2', thick: 0.65, core: 0.75, rim: 0.22 });
    this.shimmer = this.makeShimmer();
    this.buildLife();
    this.fresh = true;
  }

  buildSky() {
    const W = this.W, base = this.base, top = this.top;
    this.sky = new SkyDome({ W, top, base, seed: 5, stops: SKY, stars: 70, haze: 0.18, clouds: { n: 14, size: [20, 58], y: [top + 26, base - 22], scale: 2 } });
    const so = { levels: 10, y0: 0, y1: base + 4 - top };
    const oh = this.sky.h;
    this.overcast = { day: gradientStrip(oh, OVERCAST.day, so), dusk: gradientStrip(oh, OVERCAST.dusk, so), night: gradientStrip(oh, OVERCAST.night, so) };
    // voxel horizon: palm island, lighthouse islet, sea stacks, a sailboat drifting far out, a channel buoy
    const hz = (k) => ({ day: [SKYHZ.day, k], dusk: [SKYHZ.dusk, k + 0.08], night: [SKYHZ.night, Math.min(0.85, k + 0.3)] });
    this.horizon = [
      { spr: seaStacks(12, hz(0.42)), x: Math.round(W * 0.07), y: base + 1, blend: new Blend() },
      { spr: palmIsland(4, hz(0.16)), x: Math.round(W * 0.36), y: base + 3, blend: new Blend() },
      { spr: lighthouseIslet(7, hz(0.3)), x: Math.round(W * 0.86), y: base + 2, blend: new Blend(), lighthouse: true },
    ];
    this.sail = { spr: sailboat(9, hz(0.4)), x: W * 0.62, v: 1.6, blend: new Blend() };
    this.buoy = { spr: markerBuoy('#e2483a'), x: Math.round(W * 0.2) };
    const cr = new RNG(51);
    this.gulls = [0, 1, 2, 3, 4, 5].map((i) => ({ x: cr.float(0, W), y: cr.float(top + 40, base - 12), v: cr.float(10, 18) * (i % 2 ? -1 : 1), ph: cr.float(0, TAU), s: i < 2 ? 2 : 1 }));
    this.rainTile = { day: streakTile(96, 48, 22, '#dce6f0', { seed: 3, alpha: 0.8 }), night: streakTile(96, 48, 22, '#7a8aa0', { seed: 3, alpha: 0.8 }) };
    this.rainTile2 = streakTile(128, 64, 14, '#ffffff', { seed: 8, len: [4, 8], alpha: 0.6 });
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

  // Perspective voxel seabed + props at many depths, baked into near / mid / far bands.
  buildDepth() {
    const W = this.W, H = this.H;
    const D = new DepthScene(W, H, { yFront: H - 72, yFar: H - 166, pad: 24, zFar: 1.85, fogStart: -0.3, fog: 0.9 });
    this.D = D;
    const dockX = W - 260;
    D.terrain({
      cell: 2, dz: 0.02, hstep: 2, ambient: 0.66, diffuse: 0.42, ao: 0.07, jitter: 0.05, wall: 0.86, side: 0.92, crest: 1.06,
      height: (X, z) => {
        let h = (fbm2(X * 0.004, z * 1.3, 3, 11) - 0.45) * 16;
        h += smoothstep(0.75, 1.35, z) * Math.max(0, fbm2(X * 0.0035 + 7, z * 0.8, 2, 12) * 70 - 22);
        const front = 1 - smoothstep(0.05, 0.5, z);
        h *= 1 - front * 0.65;
        if (X > dockX) h *= 1 - front * 0.3;
        const rp = Math.sin(z * 58 + fbm2(X * 0.02, z * 2.2, 2, 7) * 9 + Math.sin(X * 0.045) * 1.6);
        if (rp > 0.6 && fbm2(X * 0.011 + 3, z * 2.5, 2, 8) > 0.47) h += 2;
        return Math.max(-2, h);
      },
      color: (X, z, h) => {
        if (h >= 18) {
          const m = fbm2(X * 0.05, z * 4, 2, 31);
          return m > 0.6 ? [96, 146, 112] : m < 0.35 ? [104, 100, 128] : [128, 122, 144];
        }
        const hs = hash2(Math.floor(X / 2), Math.floor(z * 50), 5);
        if (hs < 0.006) return [138, 136, 152];
        if (hs < 0.009) return [255, 244, 232];
        if (hs < 0.0105) return [255, 178, 184];
        const al = fbm2(X * 0.008 + 9, z * 1.8, 2, 5);
        if (al > 0.66 && hash2(Math.floor(X / 2), Math.floor(z * 50), 9) < (al - 0.66) * 4) return [168, 186, 128];
        const n = fbm2(X * 0.02, z * 3.5, 2, 3);
        if (n < 0.34) return [216, 184, 130];
        if (n > 0.66) return [238, 216, 170];
        return [228, 200, 146];
      },
    });
    const place = (id, xf, z, base, variant = 0, extra = {}) => {
      const p = getProp(id, { scale: qscale(base * D.s(z)), variant });
      return D.add({ sprite: p, x: Math.round(xf * W), z, id, ...extra });
    };
    const P = [
      // near (in front of the mid fish)
      ['rock_small', 0.035, 0.12, 0.9], ['coral_brain', 0.11, 0.2, 0.6, 1], ['rock_big', 0.235, 0.22, 1.0], ['coral_fan', 0.305, 0.3, 0.95, 0],
      ['coral_branch', 0.338, 0.18, 1.0, 1], ['coral_tube', 0.4, 0.31, 0.95, 2], ['coral_staghorn', 0.432, 0.2, 0.9, 1], ['coral_brain', 0.36, 0.04, 0.85, 0],
      ['coral_brain', 0.468, 0.06, 0.62, 2], ['message_bottle', 0.6, -0.1, 0.8], ['starfish_rock', 0.71, 0.05, 0.62], ['coral_fan', 0.268, 0.06, 0.5, 2],
      // mid
      ['sunken_boat', 0.655, 0.44, 1.08], ['coral_branch', 0.462, 0.44, 0.95, 3], ['coral_fan', 0.185, 0.5, 1.1, 1], ['coral_brain', 0.535, 0.6, 0.9, 1],
      ['rock_big', 0.865, 0.72, 1.2], ['coral_tube', 0.945, 0.9, 1.0, 0], ['anchor', 0.785, 0.62, 0.9], ['coral_staghorn', 0.065, 0.46, 1.0, 2], ['barrel', 0.375, 0.56, 0.8],
      // far
      ['rock_arch', 0.13, 0.92, 1.3], ['coral_branch', 0.29, 0.96, 1.2, 0], ['rock_big', 0.455, 1.18, 1.5], ['coral_staghorn', 0.585, 0.82, 1.15, 0],
      ['coral_fan', 0.745, 0.96, 1.25, 1], ['coral_tube', 0.885, 1.06, 1.25, 1], ['rock_small', 0.635, 1.32, 1.6], ['coral_brain', 0.04, 1.22, 1.3, 2],
      ['coral_fan', 0.985, 0.76, 1.0, 2], ['coral_branch', 0.705, 1.36, 1.3, 2], ['rock_big', 0.22, 1.42, 1.7], ['coral_staghorn', 0.385, 0.74, 0.95, 2],
      ['coral_tube', 0.52, 0.9, 1.1, 0], ['coral_brain', 0.33, 1.3, 1.4, 0], ['rock_arch', 0.82, 1.5, 1.8],
    ];
    const placed = P.map(([id, xf, z, base, v]) => place(id, xf, z, base, v || 0));
    const find = (id, band) => placed.find((q) => q.id === id && (band === undefined || q.band === band));
    // the hidden cave: a dark crevice painted at the foot of the near boulder
    const rock = find('rock_big', 0);
    const rs = D.s(rock.z);
    this.cave = { cx: Math.round(rock.x + 4 * rs), cy: Math.round(rock.y - 8 * rs) };
    rock.painted = (g, dx, dy) => this.paintCave(g, dx + rock.sprite.ox + 4 * rs, dy + rock.sprite.oy - 8 * rs);
    this.cave.rect = { x: this.cave.cx - 6, y: this.cave.cy - 5, w: 12, h: 10 };
    const bottle = find('message_bottle');
    this.bottle = { x: bottle.x - 14, y: bottle.y - 14, w: 28, h: 16, cx: bottle.x, cy: bottle.y - 8 };
    const boat = find('sunken_boat');
    const bs = D.s(boat.z);
    this.lantern = { x: Math.round(boat.x + 30 * bs), y: Math.round(boat.y - 58 * bs), z: boat.z };
    this.vent = { x: Math.round(boat.x - 40 * bs), y: boat.y - 4 };
    // the sandcastle secret (drawn live in the near band)
    const cz = 0.1, cxp = Math.round(W * 0.545);
    this.castleProp = getProp('sandcastle', { scale: qscale(0.75 * D.s(cz)) });
    const cy = Math.round(D.floorAt(cxp, cz)) + 1, cp = this.castleProp;
    this.castle = { x: cxp, y: cy, z: cz, rect: { x: cxp - cp.ox + 8, y: cy - cp.oy + 4, w: cp.w - 16, h: cp.oy - 6 }, clicks: 0, shake: 0, state: 'intact', t: 0 };
    this.chest = getProp('treasure_chest', { scale: 0.6, frame: 1 });
    this.heap = this.makeHeap();
    D.render([{ key: 'day', strip: this.water.day }, { key: 'dusk', strip: this.water.dusk }, { key: 'night', strip: this.water.night }]);
    this.bands = new BandSet(D);
    this.hazeY = Math.round(D.hz - 26);
    this.haze = new FogLayer(hazeMask(W, 70, { peak: 0.55, alpha: 0.75 }), 0, this.hazeY);
    this.masks = [0, 1].map((b) => lumaMask(D.bands[b].canvases.day, { gamma: 2.2, gain: 1.1 }));
    this.floor = new Float32Array(W + 1);
    for (let x = 0; x <= W; x++) this.floor[x] = D.floorAt(x, 0);
  }

  floorAt(x, z = 0) { return this.D ? this.D.floorAt(x, z) : super.floorAt(x); }

  paintCave(g, cx, cy) {
    const m = new Mask(16, 12);
    m.ellipse(8, 7, 5.5, 4.2);
    m.ellipse(5.5, 8.5, 3.5, 2.8);
    m.ellipse(10.5, 8, 3, 3.4);
    const c = m.toCanvas((x, y, v, up) => {
      if (up <= 1) return pack('#4a4460');
      const d = Math.hypot(x - 8, (y - 8) * 1.3);
      return pack(d < 2.5 ? '#0c1018' : d < 4.5 ? '#18202c' : '#2a2c40');
    });
    g.drawImage(c, Math.round(cx - 8), Math.round(cy - 7));
    g.fillStyle = '#3e7a56';
    for (const [dx, dy] of [[-6, -5], [-4, -6], [-1, -6], [2, -6], [4, -5]]) g.fillRect(Math.round(cx + dx), Math.round(cy + dy), 2, 1);
    g.fillStyle = '#6ab474';
    for (const [dx, dy] of [[-3, -7], [1, -7], [5, -6]]) g.fillRect(Math.round(cx + dx), Math.round(cy + dy), 1, 1);
  }

  makeHeap() {
    const w = 60, h = 20;
    const pal = stopPalette([[0, '#b08a5a'], [0.5, '#e2c48a'], [1, '#fff0c8']], 6);
    return paint(w, h, (x, y) => {
      const dx = (x - w / 2) / (w / 2), top = h - (1 - dx * dx) * (h - 2) - Math.sin(x * 0.7) * 1.2;
      if (y < top) return 0;
      const lv = 0.85 - ((y - top) / h) * 0.9 - dx * 0.25 + (hash2(x, y, 3) - 0.5) * 0.25;
      return ditherPick(pal, lv, x, y);
    });
  }

  // Far reef walls & coral silhouettes behind the floor's foggy horizon.
  buildLayers() {
    const W = this.W, H = this.H, pad = 28, D = this.D;
    this.pad = pad;
    const LW = W + pad * 2;
    const r = new RNG(5);
    const hz = D.hz;
    const ROCK = ['#5a6a92', '#6c7ea2', '#4c5a80', '#7e8eae', '#5e6e8c'];
    const CORAL = { cols: ['#e86a8a', '#f0a050', '#f0d060', '#6ac070', '#a070d0', '#ff8aa8'], density: 0.55, blobs: 14, ledge: 0.16, branch: true };
    // --- far A: a distant reef massif of voxel pinnacles, mesas and a great arch crowned with coral
    const yA = Math.round(hz - H * 0.3), hA = H - yA;
    const baseA = hz - yA + 12;
    const A = [];
    const spires = [[0.04, 46, 8], [0.17, 70, 10], [0.3, 40, 7], [0.78, 76, 11], [0.9, 52, 9], [0.99, 38, 7], [0.44, 34, 6]];
    spires.forEach(([xf, h, w], i) => A.push({ spr: render(spire(40 + i, { h, w, d: 16, lean: r.float(-0.08, 0.08), cols: ROCK, crown: CORAL }), { yaw: i % 2 ? 22 : -22 }), x: xf * LW, y: baseA + r.int(-2, 4), z: 1 + r.next() * 0.1 }));
    A.push({ spr: render(rockArch(51, { span: 46, h: 58, th: 7, d: 14, cols: ROCK, crown: CORAL }), { yaw: 18 }), x: LW * 0.6, y: baseA + 2, z: 0.95 });
    A.push({ spr: render(mesa(52, { h: 26, w: 30, d: 18, cols: ROCK, crown: CORAL }), { yaw: -16 }), x: LW * 0.35, y: baseA + 4, z: 0.9 });
    A.push({ spr: render(mesa(53, { h: 18, w: 22, d: 16, cols: ROCK, crown: CORAL }), { yaw: 20 }), x: LW * 0.69, y: baseA + 6, z: 0.4 });
    const ridgeA = ridgeStrip(54, LW, { amp: 8, base: 7, d: 14, cols: ['#8a9ab4', '#7a8aa6', '#6a7a98'], rocks: { cols: ROCK } });
    this.farA = new FogLayer(strip(LW, hA, A, { canvas: ridgeA.canvas, x: Math.round(LW / 2 - ridgeA.ox), y: Math.round(baseA + 14 - ridgeA.oy) }), -pad, yA);
    this.farAY = yA;
    // --- far B: the horizon coral garden: voxel corals, sea fans, boulders and kelp columns on a sand ridge
    const yB = Math.round(hz - 130), hB = H - yB;
    const baseB = hz - yB + 22;
    const B = [];
    const kinds = [['coral_branch', 4], ['coral_fan', 3], ['coral_brain', 3], ['coral_tube', 3], ['coral_staghorn', 3], ['rock_big', 1], ['rock_small', 1], ['anemone_base', 3], ['starfish_rock', 1]];
    for (let i = 0; i < 60; i++) {
      const [id, nv] = kinds[r.int(0, kinds.length - 1)];
      const sp = propSprite(id, r.pick([0.4, 0.5, 0.6]), r.int(0, nv - 1));
      if (sp) B.push({ spr: sp, x: r.float(0, LW), y: baseB + r.int(-3, 3), z: r.next() });
    }
    for (let i = 0; i < 10; i++) B.push({ spr: kelpColumn(60 + i, r.int(30, 60), ['#3e6a2a', '#5a8a34', '#86b048'], 1), x: r.float(0, LW), y: baseB + r.int(-2, 2), z: r.float(0.6, 1) });
    const ridgeB = ridgeStrip(55, LW, { amp: 6, base: 5, d: 12, cols: ['#e2cc98', '#d0b884', '#bca674'], rocks: { cols: ['#8a8a9a', '#a09aa8'] } });
    this.farB = new FogLayer(strip(LW, hB, B, { canvas: ridgeB.canvas, x: Math.round(LW / 2 - ridgeB.ox), y: Math.round(baseB + 10 - ridgeB.oy) }), -pad, yB);
    this.farBY = yB;
    // giants
    this.whale = whaleFrames(230);
    this.whaleL = this.whale.map(flipCanvas);
    this.turtle = turtleFrames(70);
    this.turtleL = this.turtle.map(flipCanvas);
    this.giant = { kind: 'turtle', x: W * 0.62, y: H * 0.36, dir: -1, v: 11, ph: 0, s: 0.8 };
    this.giantT = 0;
  }

  buildLife() {
    const W = this.W, H = this.H, D = this.D;
    const r = new RNG(9);
    this.decor = new DepthDecor(D);
    // kelp forests at several depths (pre-rendered sway, fog tinted per depth)
    const bladesBig = bladeSprites({ len: 13, w: 2.6, cols: ['#36561f', '#52742a', '#749634', '#9cb446', '#c4d064'], curl: 0.5, outline: 0.5 });
    const bladesSmall = bladeSprites({ len: 8, w: 1.8, cols: ['#36561f', '#52742a', '#749634', '#9cb446'], curl: 0.5, outline: 0.4 });
    for (const [xf, z, n] of [[0.03, 0.78, 34], [0.07, 0.92, 38], [0.115, 0.72, 28], [0.83, 0.82, 32], [0.875, 0.7, 36], [0.93, 0.95, 28], [0.56, 1.02, 30], [0.5, 0.86, 22], [0.62, 0.68, 26], [0.075, 0.4, 30], [0.905, 0.42, 26], [0.25, 1.1, 34], [0.4, 1.25, 30]]) {
      const s = D.s(z), x = Math.round(xf * W);
      const st = new Strands();
      st.add({ x, y: Math.round(D.floorAt(x, z)) + 3, n, seg: Math.max(2, Math.round(4 * s)), w: s > 0.6 ? 2 : 1, amp: 0.15, speed: 0.7, sec: 1, phase: r.float(0, TAU), wave: 0.2, lean: r.float(-0.06, 0.06),
        cols: ['#2c461c', '#44662a', '#5a7e30'], out: '#162a16', blades: s > 0.62 ? bladesBig : bladesSmall, leafEvery: 2, bulb: s > 0.6 ? '#d0b850' : null, bulbEvery: 6, hl: false });
      this.decor.add({ anim: new SwayAnim(st, { frames: 20 }), z, off: r.int(0, 19) });
    }
    // sea grass & seaweed tufts at many depths
    const weedSets = [
      ['#1e6a46', '#2e8a52', '#4aaa5e', '#86d27a'], ['#2a7a3a', '#3e9a46', '#62bc5a', '#a2e07e'], ['#6a2a5a', '#943a6e', '#c4588a', '#f08ab0'], ['#7a4a1e', '#a8682a', '#d0903a', '#f0c060'],
    ];
    const spots = [[0.06, -0.12], [0.15, -0.15], [0.2, 0.05], [0.248, 0.16], [0.285, 0.1], [0.322, 0.26], [0.4, 0.12], [0.447, -0.05], [0.505, -0.18], [0.585, 0.15], [0.62, 0.0], [0.735, 0.14], [0.77, -0.1], [0.83, 0.02], [0.9, -0.12], [0.96, 0.2], [0.69, -0.2],
      [0.12, 0.42], [0.27, 0.5], [0.41, 0.4], [0.58, 0.55], [0.72, 0.48], [0.97, 0.5], [0.2, 0.8], [0.35, 0.9], [0.48, 0.75], [0.66, 0.9], [0.8, 0.75], [0.9, 0.85]];
    for (const [xf, z] of spots) {
      const s = D.s(z), x0 = Math.round(xf * W), y0 = Math.round(D.floorAt(x0, z)) + 1;
      const set = weedSets[r.chance(0.75) ? r.int(0, 1) : r.int(2, 3)];
      const tall = r.chance(0.4);
      const st = new Strands();
      const k = r.int(4, 7);
      for (let i = 0; i < k; i++) {
        const lean = (i / (k - 1) - 0.5) * 0.9 + r.float(-0.15, 0.15);
        st.add({ x: x0 + Math.round(lean * 8 * s) + r.int(-1, 1), y: y0 + r.int(-1, 0), n: Math.max(3, Math.round((tall ? r.int(8, 13) : r.int(4, 8)) * Math.min(1.15, s))), seg: 2, w: tall && s > 0.7 ? 2 : 1, amp: 0.28, speed: 1.6, sec: 2, phase: r.float(0, TAU), wave: 0.5, lean, curl: lean * 0.4,
          cols: set, out: tall && s > 0.7 ? '#0e2a24' : null, hl: false, taper: 0.3 });
      }
      this.decor.add({ anim: new SwayAnim(st, { frames: 16 }), z, off: r.int(0, 15) });
    }
    // anemones with swaying tentacles (near band)
    this.anemones = [];
    for (const [xf, z, cols, tip, glow, baseC] of [
      [0.385, 0.02, ['#b03272', '#de4e92', '#ff7cb4', '#ffb4d6'], '#fff0f6', '#ff7ab0', ['#5a1e46', '#8a3462', '#b4507e']],
      [0.18, -0.08, ['#1e8090', '#2aaab6', '#5ae2e2', '#b0fff6'], '#ffffff', '#5affea', ['#3e2a5a', '#5a3e7a', '#7a5a9a']],
      [0.79, 0.1, ['#b0602a', '#e2803a', '#ffaa5e', '#ffdcac'], '#fff4e0', '#ffb070', ['#5a2e1e', '#7a4a2a', '#9a6a3a']],
      [0.56, 0.5, ['#7a3ab0', '#9a5ad8', '#c08aff', '#e4c8ff'], '#ffffff', '#c08aff', ['#3a1e5a', '#5a2e7a', '#7a4a9a']]]) {
      const x = Math.round(xf * W), y = Math.round(D.floorAt(x, z)) + 1, s = D.s(z);
      const st = new Strands();
      const N = 17;
      for (let i = 0; i < N; i++) {
        const u = i / (N - 1) - 0.5;
        const lean = u * 2.3 + r.float(-0.08, 0.08);
        st.add({ x: x + Math.round(u * 10 * s), y: y - Math.round(7 * s) + Math.round(Math.abs(u) * 3 * s), n: Math.max(3, Math.round((5 + ((i * 7) % 3)) * Math.min(1.1, s))), seg: 2, w: s > 0.8 ? 2 : 1, amp: 0.32, speed: 1.5, sec: 2, phase: i * 0.45, wave: 0.6, lean, curl: lean * 0.45,
          cols, out: null, hl: false, tip, tipR: 1 });
      }
      const under = (gg) => {
        const bh = Math.round(8 * s);
        for (let yy = -bh; yy <= 0; yy++) {
          const hw = Math.round((6 - (yy + bh) * 0.12 + (yy > -2 ? 1 : 0)) * s);
          gg.fillStyle = baseC[yy < -bh * 0.75 ? 2 : yy < -2 ? 1 : 0];
          gg.fillRect(x - hw, y + yy, hw * 2 + 1, 1);
          gg.fillStyle = baseC[2];
          gg.fillRect(x - hw + 1, y + yy, 2, 1);
        }
        gg.fillStyle = '#2a1424';
        gg.fillRect(x - Math.round(7 * s), y + 1, Math.round(14 * s) + 1, 1);
      };
      const anim = new SwayAnim(st, { frames: 16, under, bounds: { x0: x - 9, y0: y - 9, x1: x + 9, y1: y + 2 } });
      this.decor.add({ anim, z, off: r.int(0, 15) });
      this.anemones.push({ x, y, z, glow });
    }
    // critters
    this.crabSpr = [crabFrames('#e8603a'), crabFrames('#f0a040')];
    this.crabs = [[0.52, -0.05], [0.86, 0.06], [0.25, -0.2]].map(([xf, z], i) => ({ x: xf * W, z, dir: i % 2 ? -1 : 1, state: 'walk', t: r.float(1, 4), f: 0, kind: i % 2, ft: 0 }));
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
    dt = Math.max(0, Math.min(dt, 0.1));
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
    const tx = c && c.x > -50 ? clamp((c.x / W - 0.5) * -2, -1, 1) : 0, ty = c && c.y > -50 ? clamp((c.y / H - 0.5) * -2, -1, 1) : 0;
    const kp = snap ? 1 : 1 - Math.exp(-dt * 2.5);
    this.par.x += (tx - this.par.x) * kp;
    this.par.y += (ty - this.par.y) * kp;
    this.fresh = false;
    // colours
    this.cols.crest = tri('#eafffb', '#ffe2c0', '#a8c8ee', tod);
    this.cols.sub = tri('#8eece8', '#d0a8a8', '#4a80b0', tod);
    this.fogColor = tri('#33b2cc', '#2e6e98', '#1c5284', tod);
    if (wx.rain > 0.05) this.fogColor = qmix(this.fogColor, '#5a7484', wx.rain * 0.35);
    const fkey = Math.round(tod.day * 40) + ',' + Math.round(tod.dusk * 40);
    this.decor.refog((y) => waterColorAt(WATER, tod, y, this.base - 2, H), fkey);
    // weather motion
    const q = quality(env);
    const sy = this.surfaceAt(env);
    if (wx.rain > 0.05) {
      const rate = (25 + wx.storm * 50) * wx.rain * q;
      let n = rate * dt;
      const water = this.game?.water;
      while (n > 0) {
        if (Math.random() < n) {
          const d = { x: Math.random() * W, t: 0, big: Math.random() < 0.25 };
          this.drops.push(d);
          if (water) { water.surf.impulse(d.x, d.big ? -14 : -7, 4); if (Math.random() < 0.5) water.disturb(d.x, sy + 4 + Math.random() * 20, d.big ? 0.22 : 0.12, 3); }
        }
        n -= 1;
      }
    }
    for (const d of this.drops) d.t += dt;
    this.drops = this.drops.filter((d) => d.t < 0.6);
    this.sky.update(dt, 1 + wx.storm * 2 + wx.rain * 0.6);
    for (const gl of this.gulls) { gl.x += gl.v * dt; gl.ph += dt * 6; if (gl.x > W + 20) gl.x = -20; if (gl.x < -20) gl.x = W + 20; }
    const sb = this.sail;
    sb.x += sb.v * dt * (1 + wx.storm);
    if (sb.x > W + 60) sb.x = -60;
    // live waterline (biome waves); the water sim adds its lift on top
    const amp = 1.4 + wx.cloud * 0.4 + wx.rain * 0.6 + wx.storm * 2.6;
    waveLine(this.ys, W, sy, t, amp, 0.4 + wx.storm * 1.6, 1 + wx.storm * 0.7);
    // lightning
    this.flash = Math.max(0, this.flash - dt * 2.6);
    if (wx.storm > 0.5) {
      this.flashT -= dt;
      if (this.flashT <= 0) {
        this.flashT = 4 + Math.random() * 9;
        this.flash = 1;
        const bx = W * (0.15 + Math.random() * 0.7);
        const pts = [[bx, this.top + 20]];
        let x = bx, y = this.top + 20;
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
        this.giant = { kind: whale ? 'whale' : 'turtle', dir, x: dir > 0 ? -260 : W + 260, y: H * (whale ? 0.26 + Math.random() * 0.1 : 0.3 + Math.random() * 0.14), v: whale ? 7 : 10, ph: 0, s: whale ? 0.75 + Math.random() * 0.2 : 0.65 + Math.random() * 0.25 };
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
  // Sky, sun/moon, voxel clouds, the voxel horizon, gulls and weather, drawn straight into world space for the
  // visible part of the sky (the default view only shows a sliver; the surface view shows most of it).
  drawAir(g, env) {
    const W = this.W, t = this.t, tod = this.tod, wx = this.wx, sky = this.sky;
    const view = env.view;
    const sp = sky.span(view);
    if (!sp) return;
    const [y0, y1] = sp;
    const scroll = env.scroll ?? 0, ref = env.ref ?? 0;
    g.save();
    g.beginPath();
    g.rect(0, y0, W, y1 - y0);
    g.clip();
    sky.drawGradient(g, tod, view);
    const oc = clamp01(wx.cloud * 0.6 + wx.rain * 0.85 + wx.storm * 0.12);
    const clear = 1 - oc * 0.85;
    sky.drawBodies(g, env, tod, clear, scroll, ref);
    sky.drawClouds(g, tod, scroll, ref, clamp01(wx.rain * 0.9 + wx.storm * 0.4), 1, view);
    // overcast veil
    if (oc > 0.01) {
      g.globalAlpha = oc;
      const strip = this.ocBlend.get([[this.overcast.day, tod.day], [this.overcast.dusk, tod.dusk], [this.overcast.night, tod.night]]);
      const pat = g.createPattern(strip, 'repeat');
      pat.setTransform(new DOMMatrix([1, 0, 0, 1, 0, this.top]));
      g.fillStyle = pat;
      g.fillRect(0, y0, W, y1 - y0);
      g.globalAlpha = 1;
    }
    // voxel horizon features (hazed per time of day)
    const keys = (b, spr) => b.get([[spr.day, tod.day], [spr.dusk, tod.dusk], [spr.night, tod.night]]);
    const sb = this.sail;
    g.drawImage(keys(sb.blend, sb.spr), Math.round(sb.x - sb.spr.ox), this.base + 2 - sb.spr.oy + Math.round(Math.sin(t * 0.9) * 0.6));
    for (const h of this.horizon) {
      const c = keys(h.blend, h.spr);
      g.drawImage(c, h.x - h.spr.ox, h.y - h.spr.oy);
      if (h.lighthouse && tod.night + tod.dusk * 0.5 > 0.2) this.drawBeam(g, h, tod);
    }
    // gulls
    const gullA = (tod.day + tod.dusk) * (1 - wx.storm) * (1 - wx.rain * 0.7);
    if (gullA > 0.05) {
      g.fillStyle = tod.dusk > 0.5 ? '#3a2438' : '#3c4658';
      g.globalAlpha = gullA;
      for (const gl of this.gulls) {
        const x = Math.round(gl.x), y = Math.round(gl.y + Math.sin(gl.ph * 0.2) * 3 + 0.12 * (scroll - ref));
        const f = Math.sin(gl.ph) > 0.3 ? 0 : Math.sin(gl.ph) > -0.4 ? 1 : 2;
        const s = gl.s;
        const R = (dx, dy, w) => g.fillRect(x + dx * s, y + dy * s, w * s, s);
        if (f === 0) { R(-3, -2, 1); R(-2, -1, 2); R(0, 0, 1); R(1, -1, 2); R(3, -2, 1); }
        else if (f === 1) { R(-3, 0, 3); R(0, 0, 1); R(1, 0, 3); }
        else { R(-3, 1, 1); R(-2, 0, 2); R(0, 0, 1); R(1, 0, 2); R(3, 1, 1); }
      }
      g.globalAlpha = 1;
    }
    if (wx.storm > 0.05) { g.fillStyle = rgba('#10161e', wx.storm * 0.5); g.fillRect(0, y0, W, y1 - y0); }
    // rain streaks (two scrolling sheets)
    if (wx.rain > 0.05) {
      const sp2 = 1 + wx.storm * 0.6;
      for (const [tile, a, v] of [[tod.night > 0.5 ? this.rainTile.night : this.rainTile.day, 0.6, 170], [this.rainTile2, 0.3 * (1 - tod.night * 0.6), 230]]) {
        const oy = Math.floor((t * v * sp2) % tile.height), ox = Math.floor((oy / 3) % tile.width);
        const pat = g.createPattern(tile, 'repeat');
        pat.setTransform(new DOMMatrix([1, 0, 0, 1, -ox, oy]));
        g.globalAlpha = wx.rain * a;
        g.fillStyle = pat;
        g.fillRect(0, y0, W, y1 - y0);
      }
      g.globalAlpha = 1;
    }
    // lightning
    if (this.flash > 0.01) {
      g.fillStyle = rgba('#e8f0ff', this.flash * 0.55);
      g.fillRect(0, y0, W, y1 - y0);
    }
    if (this.bolt) {
      const pts = this.bolt.pts;
      g.fillStyle = '#c8b8ff';
      for (let i = 0; i + 1 < pts.length; i++) this.pxLine(g, pts[i], pts[i + 1], 3, -1);
      g.fillStyle = '#ffffff';
      for (let i = 0; i + 1 < pts.length; i++) this.pxLine(g, pts[i], pts[i + 1], 1, 0);
    }
    g.restore();
  }

  // Sweeping lighthouse beam (dithered fan) at dusk and night.
  drawBeam(g, h, tod) {
    const a = h.spr.anchors.lamp;
    if (!a) return;
    const lx = h.x - h.spr.ox + a[0], ly = h.y - h.spr.oy + a[1];
    const k = clamp01(tod.night + tod.dusk * 0.5);
    const ang = Math.sin(this.t * 0.7);
    const dir = ang > 0 ? 1 : -1;
    const len = 60 + Math.abs(ang) * 260;
    g.fillStyle = '#fff4c0';
    for (let i = 4; i < len; i += 2) {
      const spread = 1 + i * 0.07;
      const al = k * 0.35 * (1 - i / len) * Math.abs(ang);
      if (al < 0.02) break;
      g.globalAlpha = al;
      g.fillRect(Math.round(lx + dir * i), Math.round(ly - spread / 2), 2, Math.max(1, Math.round(spread)));
    }
    g.globalAlpha = 1;
    drawGlow(g, lx, ly, 7, '#fff0b0', k * 0.9);
  }

  pxLine(g, a, b, w, o) {
    const n = Math.max(1, Math.ceil(Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]))));
    for (let k = 0; k <= n; k++) g.fillRect(Math.round(a[0] + ((b[0] - a[0]) * k) / n) + o, Math.round(a[1] + ((b[1] - a[1]) * k) / n), w, 1);
  }

  drawBack(ctx, env) {
    this.nearHooked = !!this.nearSeen;
    this.nearSeen = false;
    const W = this.W, H = this.H, tod = this.tod;
    const sy = this.surfaceAt(env);
    const ys = this.ys;
    let top = H;
    for (let x = 0; x <= W; x++) if (ys[x] < top) top = ys[x];
    const water = this.waterBlend.get([[this.water.day, tod.day], [this.water.dusk, tod.dusk], [this.water.night, tod.night]]);
    const view = env.view;
    const hasAir = !view || view.y0 < top + 2;
    if (hasAir) {
      this.drawAir(ctx, env);
      // water body below the wave: a pixel-aligned staircase path (no anti-aliasing)
      const wp = new Path2D();
      wp.moveTo(0, H);
      waveRuns(ys, W, (x0, len, y) => { wp.lineTo(x0, y); wp.lineTo(x0 + len, y); });
      wp.lineTo(W, H);
      wp.closePath();
      ctx.fillStyle = ctx.createPattern(water, 'repeat');
      ctx.fill(wp);
      this.drawBuoy(ctx, env);
    } else fillWith(ctx, water, 0, -10, W, H + 10);
    // parallax layers (fogged toward the live water gradient)
    const key = this.waterBlend.key;
    const px = this.par.x, py = this.par.y;
    const wob = quality(env) >= 1 ? 1 : 0;
    const t = this.t, wx = this.wx;
    drawWobble(ctx, this.farA.tint(water, 0.64, key), -this.pad + px * 0.8, this.farAY + py * 0.4, t, wob, 4, 0.9, 0.07);
    this.drawGiant(ctx);
    drawWobble(ctx, this.farB.tint(water, 0.66, key), -this.pad + px * 1.4, this.farBY + py * 0.5, t + 2, wob, 4, 1.1, 0.09);
    // far band of the perspective seabed (behind the far fish)
    this.bands.draw(ctx, 2, tod, px * 2, py * 0.6);
    ctx.drawImage(this.haze.tint(water, 1, key), 0, this.hazeY);
    this.decor.draw(ctx, 2, t, px * 2, py * 0.6, 1 + wx.storm * 0.8);
    // weather murk
    const murk = wx.cloud * 0.08 + wx.rain * 0.14 + wx.storm * 0.1;
    if (murk > 0.01) { ctx.fillStyle = rgba(tod.night > 0.5 ? '#0a1424' : '#5a6c7c', murk); ctx.fillRect(0, Math.max(0, top), W, H - Math.max(0, top)); }
    this.drawSurface(ctx, env, sy);
  }

  // A channel buoy riding the biome waves (the water shader adds the simulated lift).
  drawBuoy(ctx, env) {
    const b = this.buoy;
    if (!b) return;
    const s = b.spr, a = s.anchors.water;
    const y = this.waveAt(b.x) + Math.round(Math.sin(this.t * 1.7) * 1.2);
    ctx.drawImage(s.day, Math.round(b.x - a[0]), Math.round(y - a[1]));
    b.lamp = [b.x - a[0] + s.anchors.lamp[0], y - a[1] + s.anchors.lamp[1]];
    void env;
  }

  waveAt(x) {
    const i = Math.max(0, Math.min(this.W, Math.round(x)));
    return this.ys ? this.ys[i] : this.base;
  }

  waterLook() {
    const tod = this.tod, wx = this.wx;
    return {
      refract: 14 + wx.storm * 6, caustic: 10 * (0.35 + tod.day * 0.65) * (0.4 + wx.clear * 0.6), chroma: true, foam: 1,
      causticColor: tri('#2e463c', '#3c2e24', '#0e1830', tod), foamColor: this.cols.crest, crestColor: tri('#ffffff', '#ffe8c8', '#b8d0f0', tod),
    };
  }

  drawGiant(ctx) {
    const gi = this.giant;
    if (!gi) return;
    const fr = gi.kind === 'whale' ? (gi.dir > 0 ? this.whale : this.whaleL) : gi.dir > 0 ? this.turtle : this.turtleL;
    const spr = fr[Math.floor(((gi.ph / TAU) * fr.length) % fr.length + fr.length) % fr.length];
    const c = tinted(spr, '#08304a');
    ctx.globalAlpha = gi.kind === 'whale' ? 0.26 : 0.3;
    const s = gi.s || 1, w = Math.round(spr.width * s), h = Math.round(spr.height * s);
    ctx.drawImage(c, Math.round(gi.x - w / 2 + this.par.x * 1.1), Math.round(gi.y - h / 2 + this.par.y * 0.5), w, h);
    ctx.globalAlpha = 1;
  }

  drawSurface(ctx, env, sy) {
    if (sy < -8) return;
    const W = this.W, ys = this.ys, t = this.t, tod = this.tod, wx = this.wx;
    const crest = new Path2D(), sub = new Path2D(), band = new Path2D();
    const sh = this.shimmer, shH = sh.height;
    waveRuns(ys, W, (x0, len, y) => { crest.rect(x0, y, len, 1); sub.rect(x0, y + 1, len, 2); band.rect(x0, y + 2, len, shH + 2); });
    ctx.fillStyle = this.cols.sub;
    ctx.globalAlpha = 0.55;
    ctx.fill(sub);
    ctx.globalAlpha = 1;
    // underside shimmer (two scrolling copies, clipped to just below the wave)
    ctx.globalCompositeOperation = 'lighter';
    const a1 = (0.55 - tod.night * 0.3) * (1 - wx.storm * 0.4);
    const o1 = Math.floor((t * 9) % 256), o2 = Math.floor((256 - ((t * 5) % 256)) % 256);
    const p1 = ctx.createPattern(sh, 'repeat-x');
    p1.setTransform(new DOMMatrix([1, 0, 0, 1, -o1, sy + 2]));
    ctx.globalAlpha = a1;
    ctx.fillStyle = p1;
    ctx.fill(band);
    const p2 = ctx.createPattern(sh, 'repeat-x');
    p2.setTransform(new DOMMatrix([1, 0, 0, 1, -o2, sy + 1]));
    ctx.globalAlpha = a1 * 0.6;
    ctx.fillStyle = p2;
    ctx.fill(band);
    // sun / moon glitter column on the surface
    const B = skyBodies(env.hour ?? 12, W, this.top, this.base);
    const s = tod.night > 0.5 ? B.moon : B.sun;
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
    ctx.fill(crest);
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
    const t = this.t, tod = this.tod, wx = this.wx;
    const sy = this.surfaceAt(env);
    const q = quality(env);
    const px = this.par.x, py = this.par.y;
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
    this.plankton.draw(ctx, t, 0.6 + tod.day * 0.4, q, 0.6);
    // mid band
    const dx = px * 3, dy = py * 0.8;
    this.bands.draw(ctx, 1, tod, dx, dy);
    const ca = this.causticA(q);
    if (ca > 0.01) this.caustics.draw(ctx, this.masks[1], -this.D.pad + dx, this.D.bands[1].y + dy, t, ca * 0.75, { fps: 8, drift: 3, offset: 5 });
    this.decor.draw(ctx, 1, t, dx, dy, 1 + wx.storm * 0.8);
    if (tod.night > 0.4) drawGlow(ctx, this.lantern.x + dx, this.lantern.y + dy, 5, '#ffd27a', tod.night * (0.7 + 0.2 * Math.sin(t * 5)));
    if (!this.nearHooked) this.paintNear(ctx, env);
  }

  causticA(q) {
    const tod = this.tod, wx = this.wx;
    if (q < 0.75) return 0;
    return (tod.day * 0.5 + tod.dusk * 0.32 + tod.night * 0.16) * (0.2 + wx.clear * 0.8);
  }

  // Near band: called by the game after the mid fish (falls back to drawSeabed when not hooked).
  drawNear(ctx, env) {
    this.nearSeen = true;
    if (this.nearHooked) this.paintNear(ctx, env);
  }

  paintNear(ctx, env) {
    const t = this.t, tod = this.tod, wx = this.wx, q = quality(env);
    const dx = this.par.x * 4, dy = this.par.y;
    this.bands.draw(ctx, 0, tod, dx, dy);
    const ca = this.causticA(q);
    if (ca > 0.01) this.caustics.draw(ctx, this.masks[0], -this.D.pad + dx, this.D.bands[0].y + dy, t, ca, { fps: 8, drift: 4 });
    ctx.save();
    ctx.translate(Math.round(dx), Math.round(dy));
    this.drawCastle(ctx);
    this.decor.draw(ctx, 0, t, 0, 0, 1 + wx.storm * 0.8);
    for (const cr of this.crabs) {
      const y = Math.round(this.D.floorAt(cr.x, cr.z));
      const spr = this.crabSpr[cr.kind][cr.state === 'walk' ? 1 + (Math.floor(cr.ft) % 2) : 0];
      ctx.drawImage(spr, Math.round(cr.x) - 8, y - 10);
    }
    // secret hints
    const s = this.secrets();
    const hk = (period, off) => { const p = ((this.hint.t + off) % period) / period; return p < 0.12 ? Math.sin((p / 0.12) * Math.PI) : 0; };
    twinkle(ctx, this.bottle.cx + 6, this.bottle.cy - 2, hk(5.5, 0), '#ffffff');
    if (this.castle.state === 'intact' && !s.sandcastle) twinkle(ctx, this.castle.x + 2, this.castle.rect.y + 4, hk(7, 2.5), '#fff6c0');
    if (!s.cave) twinkle(ctx, this.cave.cx + 5, this.cave.cy - 6, hk(9, 4.5) * 0.7, '#c8fff0');
    else if (tod.night > 0.3 || Math.sin(t * 0.7) > 0.6) {
      if (Math.sin(t * 1.3) > -0.9) { ctx.fillStyle = '#ffe27a'; ctx.fillRect(this.cave.cx - 3, this.cave.cy - 1, 1, 1); ctx.fillRect(this.cave.cx + 1, this.cave.cy - 1, 1, 1); }
    }
    if (tod.night > 0.4 && this.castle.state === 'intact' && !s.sandcastle) drawGlow(ctx, this.castle.x, this.castle.y - 24, 5, '#ffcc66', tod.night * 0.6);
    ctx.restore();
    this.bubbles.draw(ctx, t);
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
    if (this.buoy?.lamp && (tod.night + tod.dusk * 0.6) > 0.15 && Math.sin(t * 3.1) > -0.2) drawGlow(ctx, this.buoy.lamp[0], this.buoy.lamp[1], 6, '#ffe27a', clamp01(tod.night + tod.dusk * 0.6) * 0.9);
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
    let tint = qmix('#b06a64', '#1e2c6a', tod.night / Math.max(0.001, tod.night + tod.dusk));
    tint = qmix(tint, '#3c4a5c', clamp01((wx.rain * 0.5 + wx.storm * 0.4) * (1 - tod.night * 0.5)));
    const lights = [];
    if (dark > 0.04) {
      const n = tod.night;
      const sy = this.surfaceAt(env);
      const m = skyBodies(env.hour ?? 23, this.W, this.top, this.base).moon;
      if (n > 0.2 && wx.clear > 0.2) lights.push({ x: m.x, y: Math.max(0, sy) + 10, r: 150, color: '#7a9ad8', a: 0.45 * n * wx.clear });
      for (const a of this.anemones) lights.push({ x: a.x, y: a.y - 14, r: 30, color: a.glow, a: 0.55 * n + 0.1 });
      if (this.castle.state === 'intact' && !this.secrets().sandcastle) lights.push({ x: this.castle.x, y: this.castle.y - 26, r: 26, color: '#ffc870', a: 0.6 * n });
      else lights.push({ x: this.castle.x + 4, y: this.castle.y - 16, r: 30, color: '#ffe27a', a: 0.5 * n + 0.15 });
      lights.push({ x: this.lantern.x, y: this.lantern.y, r: 44, color: '#ffc870', a: 0.7 * n });
      if (this.secrets().cave) lights.push({ x: this.cave.cx, y: this.cave.cy, r: 22, color: '#7affd8', a: 0.5 * n + 0.1 });
    }
    return { dark: clamp(dark, 0, 0.64), tint, lights };
  }

  // ------------------------------------------------------------------ secrets
  secretAt(x, y) {
    if (this.castle.state === 'intact' && !this.secrets().sandcastle && inRect(x, y, this.castle.rect)) return 'sandcastle';
    if (inRect(x, y, this.bottle, 2)) return 'bottle';
    if (inRect(x, y, this.cave.rect, 3)) return 'cave';
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
