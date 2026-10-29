// Junkyard Reef: murky green-teal water where old computers go to sleep. An oily rainbow film under
// the surface, dim rays, far silhouettes of junk mountains, a sunken freighter and a crane, voxel silt
// and circuit-board floor, CRTs with live screens, blinking server racks, a glowing vending machine,
// sagging cables, glowing algae and drifting data bits. Weathers: murky, static, oil, datarain.

import { Biome, worldTop } from './base.js';
import { SkyDome, puffSprites } from '../sky.js';
import { factory, gantryCrane, containerStack, junkRidge } from '../horizon.js';
import { render, strip, ridgeStrip, junkHeap, freighter, latticeCrane, containerStackModel, utilityPole, propSprite } from '../farvox.js';
import { clamp, clamp01, lerp, smoothstep, ease, hash2, fbm2, TAU } from '../../core/math.js';
import { RNG } from '../../core/rng.js';
import { mix, rgba, pack, hslToHex } from '../../core/color.js';
import { makeCanvas, ctxOf, makeLayer } from '../../core/canvas.js';
import { PROPS } from '../../gfx/props.js';
import { worldProp } from '../voxkit.js';
import { drawText } from '../../gfx/font.js';
import { BAITS } from '../../game/shopdata.js';
import {
  paint, dpack, lerpStops, gradientStrip, stopPalette, ditherPick, Blend, FogLayer, fillWith, drawWobble, makeRays,
  drawGlow, twinkle, waveLine, waveRuns, Strands, Motes, Bubbles, Mask, ridge, todWeights, quality, inRect, catenary,
  drawCable, SwayAnim, Caustics, lumaMask, cloudTile, DepthScene, BandSet, DepthDecor, qscale, waterColorAt,
  hazeMask,
} from '../scenery.js';

const SKY = {
  day: [[0, '#4e6058'], [0.45, '#6a7c66'], [0.8, '#98a27e'], [0.94, '#b8b88e'], [1, '#d2cca2']],
  dusk: [[0, '#1c1828'], [0.45, '#3c2a40'], [0.78, '#7a4048'], [0.93, '#c2704e'], [1, '#e8965c']],
  night: [[0, '#010203'], [0.6, '#05080a'], [1, '#121a1c']],
};
const SKYHZ = { day: '#b8b88e', dusk: '#c2704e', night: '#0c1214' };
const WATER = {
  day: [[0, '#86c0a4'], [0.05, '#52a08a'], [0.3, '#357a6e'], [0.65, '#225a56'], [1, '#143e40']],
  dusk: [[0, '#d0a874'], [0.05, '#82907a'], [0.35, '#40645e'], [1, '#18343a']],
  night: [[0, '#447672'], [0.08, '#326664'], [0.5, '#204c4e'], [1, '#123236']],
};
const qmix = (a, b, t) => mix(a, b, Math.round(clamp01(t) * 32) / 32);
const tri = (a, b, c, w) => qmix(qmix(a, b, w.dusk / Math.max(0.001, w.day + w.dusk)), c, w.night);

const SCREEN_TEXT = [
  'C:\\> DIR /FISH', 'SCANNING REEF..', 'FOUND 3 BASS', 'LOADING...', '0xDEADBEEF', 'BLUB BLUB OK', 'ERR 404 FISH', 'REBOOT? Y/N',
  'PING 127.0.0.1', '> FEED.EXE', 'MEM: 640K', 'SALT LVL 98%', 'HELLO WORLD', 'SYNC KELP', '>_ ', 'BAUD 2400',
  'CRC OK', 'UNDERWATER', 'MODE 13H', 'TRY AGAIN', 'WAKE UP', '* * *', 'FILE.BAK', 'COPY A: B:',
];
const VEND = [['bread', 5], ['worm', 3], ['sugar', 2.2], ['chip', 2], ['popup', 2], ['golden', 0.5]];

// ------------------------------------------------------------------ small sprites

function glyphSprite(ch, color) {
  const G = { 0: ['111', '101', '101', '101', '111'], 1: ['010', '110', '010', '010', '111'] };
  const rows = G[ch];
  return paint(3, 5, (x, y) => (rows[y][x] === '1' ? pack(color) : 0));
}

function streamTex(seed, len, head = '#e8ffe8', body = '#4aff7a') {
  const r = new RNG(seed);
  const h = len * 6;
  const c = makeCanvas(3, h);
  const g = ctxOf(c);
  for (let i = 0; i < len; i++) {
    const k = i / (len - 1);
    g.globalAlpha = Math.pow(k, 1.6);
    g.drawImage(glyphSprite(r.chance(0.5) ? 0 : 1, i === len - 1 ? head : body), 0, i * 6);
  }
  return c;
}

function bottleSprite() {
  return paint(12, 5, (x, y) => {
    if (x < 3 && (y === 0 || y === 4)) return 0;
    if (x >= 8 && (y === 0 || y === 4)) return 0;
    if (x >= 10 && (y === 1 || y === 3)) return 0;
    if (x === 11) return pack('#3a7a4a');
    return pack(y === 1 ? '#bff0c8' : y === 3 ? '#4a9a5a' : '#78c088');
  });
}

function canSprite(c = '#d8343a') {
  return paint(5, 7, (x, y) => {
    if ((y === 0 || y === 6) && (x === 0 || x === 4)) return 0;
    if (y === 0 || y === 6) return pack('#c8ccd4');
    return pack(x === 1 ? mix(c, '#ffffff', 0.4) : x === 4 ? mix(c, '#200810', 0.4) : y === 3 ? '#f0f0f0' : c);
  });
}

// ------------------------------------------------------------------ CRT screen effects

class ScreenFX {
  constructor() {
    this.noise = new Map();
    const tw = 64, lines = SCREEN_TEXT.length;
    this.textH = lines * 7;
    this.text = makeCanvas(tw, this.textH * 2);
    const g = ctxOf(this.text);
    for (let k = 0; k < 2; k++) SCREEN_TEXT.forEach((l, i) => drawText(g, l, 2, k * this.textH + i * 7 + 1, { font: 'small', color: i % 5 === 0 ? '#d8ffe0' : '#6cff9a' }));
    this.scan = paint(4, 2, (x, y) => (y ? pack('#000000', 70) : 0));
    this.fish = paint(7, 4, (x, y) => {
      const rows = ['..###.#', '.#####.', '.####.#', '..##...'];
      if (rows[y][x] !== '#') return 0;
      return pack(y === 0 ? '#ffd27a' : x === 5 && y === 1 ? '#1a1010' : '#ff8a3a');
    });
  }
  noiseFrame(w, h, f) {
    const key = w + 'x' + h;
    let fr = this.noise.get(key);
    if (!fr) {
      fr = [];
      for (let k = 0; k < 6; k++) {
        const r = new RNG(k * 77 + w * 3 + h);
        fr.push(paint(w, h, (x, y) => { const v = Math.floor(r.next() * 4) * 50 + 40 + (y % 2 ? 0 : 20); return pack('#' + [v, v, Math.min(255, v + 10)].map((q) => q.toString(16).padStart(2, '0')).join('')); }));
      }
      this.noise.set(key, fr);
    }
    return fr[f % 6];
  }
  draw(ctx, s, mode, t, glitch = 0) {
    const { x, y, w, h } = s;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    let m = mode;
    if (glitch > 0 && hash2(x, Math.floor(t * 8), 3) < glitch * 0.5) m = 'static';
    const jx = glitch > 0 && hash2(y, Math.floor(t * 12), 4) < glitch * 0.3 ? Math.round((hash2(x, Math.floor(t * 12), 5) - 0.5) * 6) : 0;
    if (m === 'off') {
      ctx.fillStyle = '#0e1614'; ctx.fillRect(x, y, w, h);
      ctx.fillStyle = '#24302e'; for (let i = 0; i < 4; i++) ctx.fillRect(x + 3 + i, y + 2 + i, 2, 1);
      ctx.fillRect(x + w - 6, y + h - 3, 3, 1);
    } else if (m === 'static') {
      ctx.drawImage(this.noiseFrame(w, h, Math.floor(t * 18)), x + jx, y);
    } else if (m === 'text') {
      ctx.fillStyle = '#06140e'; ctx.fillRect(x, y, w, h);
      const off = Math.floor(t * 5) % this.textH;
      ctx.drawImage(this.text, 0, off, Math.min(w, 64), h, x + 1 + jx, y, Math.min(w, 64), h);
      if (Math.sin(t * 6) > 0) { ctx.fillStyle = '#9affb8'; ctx.fillRect(x + 3, y + h - 6, 3, 4); }
    } else if (m === 'fish') {
      ctx.fillStyle = '#0c2a5a'; ctx.fillRect(x, y, w, h);
      ctx.fillStyle = '#123a74'; ctx.fillRect(x, y + Math.floor(h / 2), w, Math.ceil(h / 2));
      ctx.fillStyle = '#2a5a3a'; ctx.fillRect(x, y + h - 2, w, 2);
      const fx = x + ((t * 9) % (w + 10)) - 8, fy = y + Math.round(h * 0.4 + Math.sin(t * 2) * 2);
      ctx.drawImage(this.fish, Math.round(fx) + jx, fy);
      ctx.fillStyle = '#8ad8ff';
      for (let i = 0; i < 3; i++) { const by = y + h - 3 - ((t * 6 + i * 5) % (h - 3)); ctx.fillRect(x + 4 + i * 7, Math.round(by), 1, 1); }
    } else if (m === 'hello') {
      ctx.fillStyle = '#10204a'; ctx.fillRect(x, y, w, h);
      const k = Math.floor(t * 2) % 2;
      drawText(ctx, k ? 'HI!' : 'HELLO', x + w / 2, y + 2, { font: 'small', align: 'center', color: '#ffe27a' });
      ctx.drawImage(this.fish, Math.round(x + w / 2 - 3), y + h - 7);
    }
    // scanlines + glass sheen
    ctx.fillStyle = ctx.createPattern(this.scan, 'repeat');
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(x, y, w, 1);
    ctx.restore();
  }
}

// ------------------------------------------------------------------ biome

export class JunkyardBiome extends Biome {
  constructor(ocean) {
    super(ocean);
    this.id = 'junkyard'; this.name = 'Junkyard Reef'; this.subtitle = 'Where old computers go to sleep'; this.music = 'junkyard';
    this.weathers = [{ id: 'murky', name: 'Murky', weight: 4 }, { id: 'static', name: 'Static Storm', weight: 1.5 }, { id: 'oil', name: 'Oil Slick', weight: 1.5 }, { id: 'datarain', name: 'Data Rain', weight: 1 }];
    this.ambient = 'junkyard';
    this.fogColor = '#2e6a62';
    this.fogAmount = 0.62;
    this.t = 0;
    this.tod = { day: 1, dusk: 0, night: 0 };
    this.wx = { static: 0, oil: 0, data: 0, murk: 1 };
    this.par = { x: 0, y: 0 };
    this.flicker = 0;
    this.fresh = true;
    this.cols = { crest: '#c8f0d8', sub: '#7ab8a0' };
  }

  baseSurface(H) { return Math.round(H * 0.05); }
  surfaceAt(env) { return Math.round(lerp(this.baseSurface(this.H), -6, ease.inOutCubic(clamp01(env?.flood || 0)))); }
  secrets() { return this.game?.state?.secrets || {}; }

  // ------------------------------------------------------------------ build
  build(W, H) {
    this.W = W; this.H = H;
    this.base = this.baseSurface(H);
    this.top = worldTop(H);
    this.ys = new Int16Array(W + 2);
    this.ys.fill(this.base);
    this.waterBlend = new Blend();
    this.buildSky();
    const wo = { y0: this.base - 2, y1: H, levels: 24 };
    this.water = { day: gradientStrip(H, WATER.day, wo), dusk: gradientStrip(H, WATER.dusk, wo), night: gradientStrip(H, WATER.night, wo) };
    this.fx = new ScreenFX();
    this.buildDepth();
    this.buildLayers();
    const rh = H - this.base;
    this.rays = new FogLayer(makeRays(W, rh, { seed: 14, count: 7, sunX: W * 0.35, sunY: -H * 0.9, minW: 8, maxW: 26, len: 0.7, color: '#ffffff', alpha: 0.45, levels: 4 }));
    this.sheen = this.makeSheen();
    this.caustics = new Caustics({ tw: 128, th: 40, cx: 8, cy: 4, seed: 6, color: '#e8ffd8', thick: 0.6, core: 0.6, rim: 0.2 });
    this.buildLife();
    this.fresh = true;
  }

  buildSky() {
    const W = this.W, base = this.base, top = this.top;
    this.sky = new SkyDome({ W, top, base, seed: 17, stops: SKY, stars: 24, haze: 0.12, clouds: { n: 11, size: [26, 64], y: [top + 30, base - 26], scale: 2, speed: 0.8, pals: ['smog', 'dusk', 'night', 'rain'] } });
    this.sky.clouds.forEach((c) => { c.spr.day = c.spr.smog; });
    const hz = (k) => ({ day: [SKYHZ.day, k], dusk: [SKYHZ.dusk, k + 0.08], night: [SKYHZ.night, Math.min(0.85, k + 0.32)] });
    this.horizon = [
      { spr: junkRidge(W, 27, hz(0.34)), x: -12, y: base + 3, full: true },
      { spr: factory(21, hz(0.3)), x: Math.round(W * 0.22), y: base + 2, factory: true },
      { spr: gantryCrane(23, hz(0.36)), x: Math.round(W * 0.52), y: base + 2, crane: true },
      { spr: containerStack(25, hz(0.32)), x: Math.round(W * 0.8), y: base + 2 },
    ];
    for (const h of this.horizon) { h.blend = new Blend(); if (h.full) h.x = h.spr.ox - 12; }
    const f = this.horizon[1];
    this.stacks = Object.entries(f.spr.anchors).filter(([k]) => k.startsWith('stack')).map(([, a]) => ({ x: f.x - f.spr.ox + a[0], y: f.y - f.spr.oy + a[1] }));
    const c = this.horizon[2];
    this.blinkers = ['lampL', 'lampR'].map((k) => ({ x: c.x - c.spr.ox + c.spr.anchors[k][0], y: c.y - c.spr.oy + c.spr.anchors[k][1] }));
    this.smoke = [];
    const r = new RNG(17);
    for (let i = 0; i < 60; i++) this.smoke.push({ s: i % this.stacks.length, k: r.next(), ph: r.float(0, TAU), w: r.float(0.7, 1.3) });
  }

  makeSheen() {
    const W = this.W + 256, h = 10;
    return paint(W, h, (x, y) => {
      const n = fbm2(x * 0.03, y * 0.3, 2, 5);
      if (n < 0.38) return 0;
      const hue = (x * 1.3 + n * 260 + y * 25) % 360;
      const a = (1 - y / h) * smoothstep(0.38, 0.6, n);
      if (a < 0.08) return 0;
      const q = Math.floor(a * 4 + ((x * 3 + y * 5) % 4) / 4) / 4;
      if (q <= 0) return 0;
      return pack(hslToHex(hue, 0.7, 0.62), Math.round(q * 200));
    });
  }

  // Perspective voxel silt / circuit-board floor rising into voxel junk hills, junk props at many depths.
  buildDepth() {
    const W = this.W, H = this.H;
    const D = new DepthScene(W, H, { yFront: H - 70, yFar: H - 164, pad: 24, zFar: 1.85, fogStart: -0.3, fog: 0.84 });
    this.D = D;
    const dockX = W - 260;
    const JUNK = [[138, 86, 52], [112, 116, 124], [60, 62, 70], [196, 186, 156], [70, 96, 150], [150, 60, 54], [96, 120, 90], [168, 150, 96]];
    D.terrain({
      cell: 2, dz: 0.02, hstep: 2, ambient: 0.74, diffuse: 0.48, ao: 0.08, jitter: 0.08, wall: 0.78, side: 0.88, crest: 1.1,
      height: (X, z) => {
        let h = (fbm2(X * 0.005, z * 1.4, 3, 21) - 0.5) * 12;
        h += Math.max(0, fbm2(X * 0.02, z * 4, 2, 22) - 0.6) * 28;
        h += smoothstep(0.78, 1.4, z) * Math.max(0, fbm2(X * 0.0045 + 3, z * 0.9, 3, 23) * 100 - 30);
        const front = 1 - smoothstep(0.05, 0.45, z);
        h *= 1 - front * (X > dockX ? 0.75 : 0.55);
        return Math.max(-2, h);
      },
      color: (X, z, h) => {
        const bx = Math.floor(X / 6), bz = Math.floor(z * 22);
        if (h >= 14) {
          const k = hash2(bx, bz, 7);
          const c = JUNK[Math.floor(k * JUNK.length)];
          const v = 0.85 + hash2(Math.floor(X / 2), Math.floor(z * 50), 8) * 0.3;
          return [c[0] * v, c[1] * v, c[2] * v];
        }
        if (fbm2(X * 0.01 + 5, z * 2.2, 2, 31) > 0.7) {
          if ((Math.floor(X / 2) % 7 === 0 || Math.floor(z * 50) % 6 === 0) && hash2(bx, bz, 2) < 0.7) return [176, 146, 66];
          return [44, 86, 60];
        }
        const hs = hash2(Math.floor(X / 2), Math.floor(z * 50), 5);
        if (hs < 0.01) return [140, 146, 158];
        if (hs < 0.016) return [34, 34, 42];
        if (hs < 0.019) return [200, 60, 60];
        if (hs < 0.022) return [60, 106, 200];
        const n = fbm2(X * 0.025, z * 4, 2, 33);
        if (n > 0.72) return [138, 88, 54];
        if (n < 0.32) return [78, 78, 62];
        return n > 0.55 ? [116, 112, 90] : [96, 94, 72];
      },
      glow: (X, z, h) => (h < 14 && hash2(Math.floor(X / 2), Math.floor(z * 50), 13) < 0.003 ? [140, 255, 90] : null),
    });
    const place = (id, xf, z, base, variant = 0) => {
      const p = worldProp(id, { scale: qscale(base * D.s(z)), variant });
      return D.add({ sprite: p, x: Math.round(xf * W), z, id });
    };
    const P = [
      // near
      ['crt_monitor', 0.375, 0.12, 0.85], ['circuit_coral', 0.47, 0.2, 0.75, 0], ['circuit_coral', 0.585, 0.27, 0.65, 1], ['keyboard_slab', 0.255, 0.04, 0.6],
      ['floppy_pile', 0.13, 0.08, 0.7], ['tire', 0.045, 0.16, 0.8], ['pipe_bend', 0.2, 0.3, 0.85], ['floppy_pile', 0.86, 0.04, 0.55], ['tire', 0.955, 0.22, 0.6],
      // mid
      ['crt_pile', 0.31, 0.4, 1.0], ['server_rack', 0.432, 0.45, 1.0], ['broken_robot', 0.532, 0.37, 1.0], ['vending_machine', 0.645, 0.42, 1.0], ['rusty_barrel', 0.715, 0.52, 0.9],
      ['circuit_coral', 0.74, 0.36, 0.6, 2], ['shopping_cart', 0.15, 0.56, 1.0], ['gear_big', 0.835, 0.62, 1.0],
      // far
      ['satellite_dish', 0.06, 0.9, 1.2], ['crt_pile', 0.215, 1.1, 1.35], ['gear_big', 0.4, 0.95, 1.3], ['server_rack', 0.585, 1.05, 1.3], ['shopping_cart', 0.72, 0.86, 1.1],
      ['satellite_dish', 0.905, 1.0, 1.35], ['pipe_bend', 0.48, 1.3, 1.5], ['tire', 0.335, 0.76, 1.0], ['rusty_barrel', 0.275, 0.82, 1.0], ['crt_monitor', 0.665, 0.78, 1.0],
      ['broken_robot', 0.985, 1.25, 1.4], ['vending_machine', 0.03, 1.3, 1.4], ['circuit_coral', 0.79, 0.74, 0.9, 0], ['keyboard_slab', 0.54, 0.7, 0.8],
    ];
    for (const e of [['phone_booth', 0.255, 0.5, 0.8], ['retro_tv', 0.585, 0.58, 0.7], ['toilet', 0.47, 0.64, 0.7], ['arcade_cabinet', 0.12, 0.96, 0.95], ['bathtub', 0.8, 1.14, 1.0],
      ['traffic_cone', 0.37, 0.72, 0.65], ['giant_sneaker', 0.69, 0.08, 0.55], ['toaster', 0.315, 0.16, 0.5], ['jukebox', 0.94, 0.8, 0.9], ['sunken_pc', 0.06, 0.62, 0.8]]) if (PROPS[e[0]]) P.push(e);
    const placed = P.map(([id, xf, z, base, v]) => place(id, xf, z, base, v || 0));
    for (const q of placed) { q.left = q.x - q.sprite.ox; q.top = q.y - q.sprite.oy; q.p = q.sprite; q.s = D.s(q.z); }
    this.placed = placed;
    const find = (id, band) => placed.find((q) => q.id === id && (band === undefined || q.band === band));
    const pile = find('crt_pile', 1), rack = find('server_rack', 1), robot = find('broken_robot', 1), vend = find('vending_machine', 1), barrel = find('rusty_barrel', 1), mon = find('crt_monitor', 0);
    // sagging cables between the mid-depth junk, baked as one overlay
    const cab = makeCanvas(W, H), cg = ctxOf(cab);
    const cables = [
      [[-10, H * 0.55], [pile.left + 30, pile.top + 36], 40, '#24242c', 2],
      [[rack.x - 10, rack.top + 6], [pile.x + 26, pile.top + 30], 22, '#c8a040', 1],
      [[rack.x + 16, rack.top + 10], [robot.x - 18, robot.top + 36], 28, '#2a2a34', 2],
      [[robot.x + 22, robot.top + 32], [vend.x - 12, vend.top + 10], 30, '#3a5ac0', 1],
      [[vend.x + 14, vend.top + 8], [barrel.x + 8, barrel.top + 12], 24, '#b83a3a', 1],
    ];
    let cTop = H;
    for (const [a, b, sag, col, w] of cables) {
      const pts = catenary(a[0], a[1], b[0], b[1], sag, 30);
      for (const p of pts) cTop = Math.min(cTop, p[1]);
      drawCable(cg, pts, col, w, '#0a0c10', w >= 2 ? mix(col, '#ffffff', 0.35) : null);
    }
    D.items.push({ abs: true, absTop: Math.floor(cTop) - 4, z: 0.47, band: 1, sprite: { canvas: cab, ox: 0, oy: 0 }, x: 0, y: 0 });
    D.render([{ key: 'day', strip: this.water.day }, { key: 'dusk', strip: this.water.dusk }, { key: 'night', strip: this.water.night }]);
    this.bands = new BandSet(D);
    this.hazeY = Math.round(D.hz - 26);
    this.haze = new FogLayer(hazeMask(W, 70, { peak: 0.55, alpha: 0.8 }), 0, this.hazeY);
    this.masks = [0, 1].map((b) => lumaMask(D.bands[b].canvases.day, { gamma: 2, gain: 1.05 }));
    this.floor = new Float32Array(W + 1);
    for (let x = 0; x <= W; x++) this.floor[x] = D.floorAt(x, 0);
    // glowing bits: prop glow layers (bloom), screens, LEDs, lights
    this.glows = placed.filter((q) => q.p.glow).map((q) => ({ c: q.p.glow, x: q.left, y: q.top, id: q.id, band: q.band, a: 1 - D.fog(q.z) * 0.8, ph: hash2(q.x, 1, 9) * TAU }));
    this.screens = [];
    const modes = ['text', 'fish', 'static'];
    let si = 0;
    for (const q of placed) {
      if (q.id !== 'crt_pile' && q.id !== 'crt_monitor') continue;
      for (const sc of q.p.screens) {
        const secret = q === mon;
        this.screens.push({ x: q.left + sc.x, y: q.top + sc.y, w: sc.w, h: sc.h, band: q.band, mode: secret ? 'off' : modes[si++ % 3], secret, a: 1 - D.fog(q.z) * 0.85, z: q.z });
      }
    }
    this.crt = this.screens.find((sc) => sc.secret);
    this.leds = [];
    for (const q of placed) {
      if (q.id !== 'server_rack' || !q.p.glow) continue;
      const gd = ctxOf(q.p.glow).getImageData(0, 0, q.p.w, q.p.h).data;
      for (let y = 0; y < q.p.h; y++) for (let x = 0; x < q.p.w; x++) if (gd[(y * q.p.w + x) * 4 + 3] === 255 && this.leds.length < 200) this.leds.push({ x: q.left + x, y: q.top + y, k: hash2(x, y, 3), band: q.band });
    }
    this.propLights = [];
    for (const q of placed) {
      if (q.id === 'crt_pile' || q.id === 'crt_monitor') continue;
      const l = q.p.lights.slice().sort((a, b) => b.r - a.r)[0];
      if (l && q.z < 1.2) this.propLights.push({ x: q.left + l.x, y: q.top + l.y, r: Math.min(64, l.r * 0.9 + 8 * q.s), color: l.color, a: 1 - D.fog(q.z) * 0.7, id: q.id });
    }
    this.vend = { x: vend.x, y: vend.y, rect: { x: vend.left + 6, y: vend.top + 6, w: vend.p.w - 12, h: vend.p.oy - 8 }, tray: { x: vend.x - 5, y: vend.y - 16 }, t: 9, item: null, cool: 0 };
    this.monRect = { x: this.crt.x - 4, y: this.crt.y - 4, w: this.crt.w + 8, h: this.crt.h + 10 };
    this.rack = rack; this.robot = robot; this.barrel = barrel; this.pile = pile; this.mon = mon;
    // glowing algae along junk top edges (near & mid bands)
    this.algae = [];
    const r = new RNG(12);
    for (const b of [0, 1]) {
      const B = D.bands[b], cv = B.canvases.day, bw = cv.width, bh = cv.height;
      const bd = ctxOf(cv).getImageData(0, 0, bw, bh).data;
      let n = 0;
      for (let i = 0; i < 400 && n < 18; i++) {
        const x = r.int(30, bw - 30);
        if (x - D.pad > W - 260 && r.chance(0.75)) continue;
        for (let y = 2; y < bh - 30; y++) {
          if (bd[(y * bw + x) * 4 + 3] > 0) {
            const sx = x - D.pad, sy = B.y + y;
            if (sy < D.floorAt(sx, b === 0 ? 0.1 : 0.45) - 8) { this.algae.push({ x: sx, y: sy, band: b, ph: r.float(0, TAU), c: r.pick(['#7aff5a', '#5affb0', '#c8ff5a']) }); n++; }
            break;
          }
        }
      }
    }
  }

  floorAt(x, z = 0) { return this.D ? this.D.floorAt(x, z) : super.floorAt(x); }

  waveAt(x) {
    const i = Math.max(0, Math.min(this.W, Math.round(x)));
    return this.ys ? this.ys[i] : this.base;
  }

  waterLook() {
    const tod = this.tod, wx = this.wx;
    return {
      refract: 12 + wx.static * 8, caustic: 6 * (0.3 + tod.day * 0.7) * (1 - wx.oil * 0.6), chroma: true, foam: 0.9,
      causticColor: tri('#24382a', '#30261c', '#0c1a1a', tod), foamColor: this.cols.crest, crestColor: tri('#e8ffe8', '#ffe0c0', '#90b0a8', tod),
    };
  }

  buildLayers() {
    const W = this.W, H = this.H, pad = 28, D = this.D;
    this.pad = pad;
    const LW = W + pad * 2;
    const r = new RNG(8);
    const hz = D.hz;
    // --- far A: voxel junk mountains, a sunken freighter and a lattice dock crane beyond the horizon
    const yA = Math.round(hz - H * 0.36), hA = H - yA;
    const baseA = hz - yA + 14;
    const A = [];
    [[0.08, 58, 40], [0.33, 46, 30], [0.92, 64, 46], [0.6, 34, 22]].forEach(([xf, w, h], i) => A.push({ spr: render(junkHeap(70 + i, { w, h, d: 22 }), { yaw: i % 2 ? 14 : -14, pitch: 18 }), x: xf * LW, y: baseA + 6, z: 1 - i * 0.02 }));
    A.push({ spr: render(freighter(71), { yaw: -12, pitch: 14 }), x: LW * 0.64, y: baseA + 4, z: 0.97 });
    A.push({ spr: render(latticeCrane(72, 84), { yaw: 18, pitch: 12 }), x: LW * 0.2, y: baseA + 2, z: 0.99 });
    const ridgeA = ridgeStrip(73, LW, { amp: 9, base: 7, d: 16, cols: ['#6a6a58', '#5a5a4a', '#4a4a3e'], rocks: { cols: ['#6a5a4a', '#5a6066', '#7a4a34', '#4a5a6a'] } });
    this.farA = new FogLayer(strip(LW, hA, A, { canvas: ridgeA.canvas, x: Math.round(LW / 2 - ridgeA.ox), y: Math.round(baseA + 16 - ridgeA.oy) }), -pad, yA);
    this.farAY = yA;
    // --- far B: container stacks, utility poles with sagging wires, small junk on the horizon
    const yB = Math.round(hz - 130), hB = H - yB;
    const baseB = hz - yB + 22;
    const B = [];
    for (const [xf, c, rw] of [[0.13, 3, 2], [0.48, 4, 3], [0.84, 3, 3]]) B.push({ spr: render(containerStackModel(80 + c + rw, c, rw), { scale: 1, yaw: 20, pitch: 14 }), x: xf * LW, y: baseB + 2, z: 0.8 });
    const poles = [];
    for (let i = 0; i < 6; i++) {
      const x = LW * (0.06 + i * 0.18) + r.float(-10, 10);
      const sp = render(utilityPole(90 + i, r.int(56, 70)), { scale: 1, yaw: 0, pitch: 6 });
      B.push({ spr: sp, x, y: baseB + 4, z: 0.7 });
      poles.push([x, baseB + 4 - sp.oy + 6]);
    }
    const junk = ['crt_pile', 'tire', 'shopping_cart', 'satellite_dish', 'gear_big', 'server_rack', 'rusty_barrel', 'crt_monitor', 'toilet', 'bathtub', 'traffic_cone', 'phone_booth', 'retro_tv', 'giant_sneaker', 'arcade_cabinet', 'broken_robot'];
    for (let i = 0; i < 46; i++) {
      const sp = propSprite(r.pick(junk), r.pick([0.38, 0.46, 0.55]));
      if (sp) B.push({ spr: sp, x: r.float(0, LW), y: baseB + r.int(-2, 4), z: r.next() * 0.9 });
    }
    for (let i = 0; i < 6; i++) B.push({ spr: render(junkHeap(100 + i, { w: r.int(14, 24), h: r.int(8, 14), d: 12 }), { scale: 1, yaw: 10, pitch: 16 }), x: r.float(0, LW), y: baseB + 4, z: 0.95 });
    const ridgeB = ridgeStrip(74, LW, { amp: 5, base: 5, d: 12, cols: ['#7a7660', '#6a6652', '#5a5644'], rocks: { cols: ['#8a5a3e', '#5a6a7a', '#6a6a6a'] } });
    const cB = strip(LW, hB, B, { canvas: ridgeB.canvas, x: Math.round(LW / 2 - ridgeB.ox), y: Math.round(baseB + 10 - ridgeB.oy) });
    const g = ctxOf(cB);
    for (let i = 0; i + 1 < poles.length; i++) {
      for (const dy of [0, 7]) {
        const pts = catenary(poles[i][0] - 9, poles[i][1] + dy, poles[i + 1][0] - 9, poles[i + 1][1] + dy, 16 + dy, 40);
        drawCable(g, pts, '#3a3e3a', 1);
      }
    }
    this.farB = new FogLayer(cB, -pad, yB);
    this.farBY = yB;
  }

  buildLife() {
    const W = this.W, H = this.H, D = this.D;
    const r = new RNG(19);
    this.decor = new DepthDecor(D);
    const sets = [['#2a4a2a', '#3e5e2e', '#5a7a34', '#7a9a44'], ['#3a4a22', '#566a2a', '#748a34', '#98ac48']];
    for (const [xf, z] of [[0.08, -0.12], [0.17, 0.0], [0.27, -0.15], [0.42, 0.25], [0.49, 0.02], [0.56, -0.18], [0.61, 0.1], [0.75, -0.08], [0.8, 0.2], [0.92, -0.1], [0.995, 0.1],
      [0.05, 0.5], [0.22, 0.62], [0.38, 0.55], [0.6, 0.6], [0.77, 0.66], [0.9, 0.5], [0.12, 0.85], [0.46, 0.8], [0.7, 0.95]]) {
      const s = D.s(z), x0 = Math.round(xf * W), y0 = Math.round(D.floorAt(x0, z)) + 1;
      const st = new Strands();
      const k = r.int(3, 5), tall = r.chance(0.5), set = r.pick(sets);
      for (let i = 0; i < k; i++) {
        const lean = (i / Math.max(1, k - 1) - 0.5) * 0.8;
        st.add({ x: x0 + Math.round(lean * 7 * s), y: y0, n: Math.max(3, Math.round((tall ? r.int(9, 14) : r.int(5, 8)) * Math.min(1.1, s))), seg: 2, w: tall && s > 0.7 ? 2 : 1, amp: 0.22, speed: 1.1, sec: 1, phase: r.float(0, TAU), wave: 0.4, lean, curl: lean * 0.5, cols: set, out: tall && s > 0.7 ? '#0c1a14' : null, hl: false, taper: 0.3 });
      }
      this.decor.add({ anim: new SwayAnim(st, { frames: 16 }), z, off: r.int(0, 15) });
    }
    // long cables dangling from the surface with plugs
    const s0 = this.base;
    for (const [xf, n, col, z] of [[0.18, 30, '#2a2a34', 0.5], [0.585, 22, '#3a3a48', 0.85], [0.79, 13, '#b83a3a', 0.6], [0.36, 26, '#2a2a34', 1.1]]) {
      const st = new Strands();
      const sc = D.s(z);
      st.add({ x: Math.round(xf * W), y: s0 + 1, n, seg: Math.max(2, Math.round(4 * sc + 1)), down: true, w: sc > 0.7 ? 2 : 1, amp: 0.12, speed: 0.6, sec: 1, phase: xf * 9, wave: 0.15, cols: [col, mix(col, '#ffffff', 0.15)], out: '#0a0c10', hl: false, tip: '#c8c8d0', tipR: sc > 0.7 ? 2 : 1 });
      this.decor.add({ anim: new SwayAnim(st, { frames: 24 }), z, off: Math.round(xf * 30), fy: s0 + 60 });
    }
    this.murk = cloudTile(480, 240, '#a8c8b0', { seed: 3, alpha: 0.13, scale: 0.016, bias: 0.5, levels: 3 });
    this.murk2 = cloudTile(400, 200, '#0e2420', { seed: 9, alpha: 0.16, scale: 0.02, bias: 0.5, levels: 3 });
    // floating trash at the surface
    this.duck = worldProp('rubber_duck', { scale: 0.45 });
    this.bottle = bottleSprite();
    this.can = canSprite();
    this.floaters = [[0.3, 'duck'], [0.52, 'bottle'], [0.68, 'can'], [0.9, 'bottle']].map(([xf, k], i) => ({ x: xf * W, k, v: 2 + i, ph: i * 1.7 }));
    // particles
    const s = this.base;
    this.silt = new Motes(120, { x0: 0, y0: s + 4, x1: W, y1: H - 50 }, { seed: 4, vx: [-2, 2], vy: [-1.5, 1.5], sizes: [1, 1, 2], colors: ['#a8c8a0', '#c8d8b0', '#8aa890'], alpha: [0.2, 0.55], wob: 4 });
    this.nearSilt = new Motes(22, { x0: 0, y0: s + 10, x1: W, y1: H - 30 }, { seed: 9, vx: [-3, 3], vy: [-2, 2], sizes: [2, 3], colors: ['#b8d8b0'], alpha: [0.08, 0.2], wob: 7 });
    this.bits = [];
    const bc = ['#5affb0', '#7affea', '#b8ff7a'];
    this.glyphs = { 0: bc.map((c) => glyphSprite(0, c)), 1: bc.map((c) => glyphSprite(1, c)) };
    for (let i = 0; i < 40; i++) this.bits.push({ x: r.float(0, W), y: r.float(s + 20, H - 60), vy: -r.float(2, 6), ch: r.int(0, 1), c: r.int(0, 2), ph: r.float(0, TAU), sq: r.chance(0.35) });
    this.streams = [];
    for (let i = 0; i < 6; i++) this.streams.push(streamTex(100 + i, 14 + i * 3));
    this.rain = [];
    for (let i = 0; i < 56; i++) this.rain.push({ x: Math.round(r.float(0, W) / 4) * 4, y: r.float(-200, H), v: r.float(50, 110), tex: r.int(0, 5) });
    this.oilBlobs = [];
    for (let i = 0; i < 14; i++) this.oilBlobs.push({ x: r.float(0, W), y: r.float(s + 30, H - 80), v: -r.float(3, 8), ph: r.float(0, TAU), s: r.int(2, 4) });
    this.bubbles = new Bubbles(60, '#d8f0e0');
    this.emitT = 1;
    this.tear = null;
    this.hint = 0;
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
    wx.static += ((w === 'static' ? 1 : 0) - wx.static) * k;
    wx.oil += ((w === 'oil' ? 1 : 0) - wx.oil) * k;
    wx.data += ((w === 'datarain' ? 1 : 0) - wx.data) * k;
    wx.murk += ((w === 'murky' ? 1 : 0.4) - wx.murk) * k;
    const c = env.cursor;
    const tx = c && c.x > -50 ? clamp((c.x / W - 0.5) * -2, -1, 1) : 0, ty = c && c.y > -50 ? clamp((c.y / H - 0.5) * -2, -1, 1) : 0;
    const kp = snap ? 1 : 1 - Math.exp(-dt * 2.5);
    this.par.x += (tx - this.par.x) * kp;
    this.par.y += (ty - this.par.y) * kp;
    this.fresh = false;
    this.cols.crest = tri('#d0f4dc', '#ffd8b0', '#7aa8a0', tod);
    this.cols.sub = tri('#86c4a8', '#c0a080', '#3a6a66', tod);
    this.fogColor = qmix(tri('#2f6e64', '#4a5a50', '#1c4448', tod), '#141a14', wx.oil * 0.35);
    this.decor.refog((y) => waterColorAt(WATER, tod, y, this.base - 2, H), Math.round(tod.day * 40) + ',' + Math.round(tod.dusk * 40));
    // static storm flicker & screen tears
    this.flicker = wx.static > 0.2 && Math.random() < 0.06 * wx.static ? Math.random() * 0.5 : this.flicker * Math.exp(-dt * 12);
    if (wx.static > 0.3 && !this.tear && Math.random() < dt * 0.8 * wx.static) this.tear = { y: Math.random() * H, h: 4 + Math.random() * 16, dx: Math.round((Math.random() - 0.5) * 12), t: 0.12 };
    if (this.tear) { this.tear.t -= dt; if (this.tear.t <= 0) this.tear = null; }
    env.flash = this.flicker;
    const s = this.surfaceAt(env);
    this.silt.update(dt, Math.sin(t * 0.2) * 2, 0);
    this.nearSilt.update(dt, Math.sin(t * 0.2) * 3, 0);
    for (const b of this.bits) { b.y += b.vy * dt; b.x += Math.sin(t * 0.5 + b.ph) * dt * 3; if (b.y < s + 10) { b.y = H - 60; b.x = Math.random() * W; } }
    for (const d of this.rain) { d.y += d.v * dt; if (d.y > H) { d.y = -120 - Math.random() * 100; d.x = Math.round((Math.random() * W) / 4) * 4; } }
    for (const o of this.oilBlobs) { o.y += o.v * dt; if (o.y < s + 6) { o.y = H - 70; o.x = Math.random() * W; } }
    for (const f of this.floaters) { f.x += f.v * dt * 0.6; if (f.x > W + 20) f.x = -20; }
    this.sky.update(dt, 0.8 + wx.static * 0.6);
    waveLine(this.ys, W, s, t * 0.7, 1.1, 0.2, 0.8);
    this.applySimLift(this.ys);
    this.bubbles.update(dt, s);
    this.emitT -= dt;
    if (this.emitT <= 0) {
      this.emitT = 0.7 + Math.random() * 1.6;
      const src = Math.random() < 0.5 ? this.barrel : Math.random() < 0.5 ? this.robot : this.rack;
      this.bubbles.emit(src.x + (Math.random() - 0.5) * 20, src.top + 10, { r: Math.random() < 0.3 ? 2 : 1 });
    }
    const v = this.vend;
    v.t += dt;
    v.cool = Math.max(0, v.cool - dt);
    this.hint += dt;
  }

  // ------------------------------------------------------------------ draw
  // Smoggy sky, voxel smog clouds, the industrial voxel skyline with smoke plumes and blinking crane lights.
  drawAir(g, env) {
    const W = this.W, t = this.t, tod = this.tod, sky = this.sky, wx = this.wx;
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
    const clear = 0.55 - wx.oil * 0.3;
    sky.drawBodies(g, env, tod, clear, scroll, ref);
    sky.drawClouds(g, tod, scroll, ref, wx.static * 0.5, 0.92, view);
    // smoke plumes from the factory stacks (dithered puffs drifting downwind)
    const puffs = puffSprites(tod.night > 0.5 ? '#2a3032' : tod.dusk > 0.5 ? '#8a6a62' : '#8e8e7c');
    for (const p of this.smoke) {
      const st = this.stacks[p.s];
      if (!st) continue;
      const k = (p.k + t * 0.035 * p.w) % 1;
      const s = puffs[Math.min(5, Math.floor(k * 6 * p.w))];
      const x = Math.round(st.x + k * 70 + Math.sin(t * 0.6 + p.ph + k * 5) * (2 + k * 6)), y = Math.round(st.y - k * 150);
      g.globalAlpha = (1 - k) * 0.6;
      g.drawImage(s, x - (s.width >> 1), y - (s.height >> 1));
    }
    g.globalAlpha = 1;
    for (const h of this.horizon) {
      const c = h.blend.get([[h.spr.day, tod.day], [h.spr.dusk, tod.dusk], [h.spr.night, tod.night]]);
      g.drawImage(c, h.x - h.spr.ox, h.y - h.spr.oy);
      if (h.spr.glow && tod.night + tod.dusk * 0.4 > 0.1) {
        g.globalCompositeOperation = 'lighter';
        g.globalAlpha = clamp01(tod.night + tod.dusk * 0.4) * (0.6 + 0.2 * Math.sin(t * 0.7 + h.x));
        g.drawImage(h.spr.glow, h.x - h.spr.ox, h.y - h.spr.oy);
        g.globalCompositeOperation = 'source-over';
        g.globalAlpha = 1;
      }
    }
    for (const b of this.blinkers) if (Math.sin(t * 2.5 + b.x) > 0.4) { drawGlow(g, b.x, b.y, 3, '#ff4a3a', 0.8); g.fillStyle = '#ff6a5a'; g.fillRect(b.x, b.y, 1, 1); }
    if (wx.static > 0.05 && this.flicker > 0.02) { g.fillStyle = rgba('#e0fff0', this.flicker * 0.2); g.fillRect(0, y0, W, y1 - y0); }
    g.restore();
  }

  drawBack(ctx, env) {
    this.nearHooked = !!this.nearSeen;
    this.nearSeen = false;
    const W = this.W, H = this.H, t = this.t, tod = this.tod, wx = this.wx;
    const sy = this.surfaceAt(env);
    const ys = this.ys;
    let top = H;
    for (let x = 0; x <= W; x++) if (ys[x] < top) top = ys[x];
    const water = this.waterBlend.get([[this.water.day, tod.day], [this.water.dusk, tod.dusk], [this.water.night, tod.night]]);
    const view = env.view;
    const hasAir = !view || view.y0 < top + 2;
    if (hasAir) {
      this.drawAir(ctx, env);
      const wp = new Path2D();
      wp.moveTo(0, H);
      waveRuns(ys, W, (x0, len, y) => { wp.lineTo(x0, y); wp.lineTo(x0 + len, y); });
      wp.lineTo(W, H);
      wp.closePath();
      ctx.fillStyle = ctx.createPattern(water, 'repeat');
      ctx.fill(wp);
    } else fillWith(ctx, water, 0, -10, W, H + 10);
    const key = this.waterBlend.key;
    const px = this.par.x, py = this.par.y;
    const wob = quality(env) >= 1 ? 1 : 0;
    drawWobble(ctx, this.farA.tint(water, 0.68, key), -this.pad + px * 0.8, this.farAY + py * 0.4, t, wob, 4, 0.8, 0.07);
    drawWobble(ctx, this.farB.tint(water, 0.6, key), -this.pad + px * 1.4, this.farBY + py * 0.5, t + 2, wob, 4, 1, 0.09);
    // far band of the perspective junk field
    this.bands.draw(ctx, 2, tod, px * 2, py * 0.6);
    ctx.drawImage(this.haze.tint(water, 1, key), 0, this.hazeY);
    this.decor.draw(ctx, 2, t, px * 2, py * 0.6);
    // drifting turbidity over the distance
    const tv = Math.max(0, top);
    for (const [tile, sp, a] of [[this.murk2, 3, 0.5 + wx.oil * 0.4], [this.murk, 5, 0.4 + wx.murk * 0.4 - tod.night * 0.3]]) {
      const pat = ctx.createPattern(tile, 'repeat');
      pat.setTransform(new DOMMatrix([1, 0, 0, 1, Math.round(t * sp + px * 4), Math.round(Math.sin(t * 0.07) * 6)]));
      ctx.globalAlpha = clamp01(a);
      ctx.fillStyle = pat;
      ctx.fillRect(0, tv, W, H - tv);
    }
    ctx.globalAlpha = 1;
    // murk & oil darkening
    const murk = 0.04 + wx.murk * 0.05 + wx.oil * 0.16;
    ctx.fillStyle = rgba(wx.oil > 0.3 ? '#0e1410' : '#2a4a40', murk);
    ctx.fillRect(0, Math.max(0, top), W, H - Math.max(0, top));
    // data rain behind the junk
    if (wx.data > 0.05) {
      ctx.fillStyle = rgba('#103a20', wx.data * 0.12);
      ctx.fillRect(0, Math.max(0, top), W, H - Math.max(0, top));
      this.drawDataRain(ctx, wx.data * 0.85, 0, 0.6);
    }
    this.drawSurface(ctx, env, sy);
  }

  drawSurface(ctx, env, sy) {
    if (sy < -8) return;
    const W = this.W, ys = this.ys, t = this.t, wx = this.wx, tod = this.tod;
    const crest = new Path2D(), sub = new Path2D(), band = new Path2D();
    const sh = this.sheen, shH = sh.height;
    const thick = wx.oil;
    waveRuns(ys, W, (x0, len, y) => { crest.rect(x0, y, len, 1); sub.rect(x0, y + 1, len, 2); band.rect(x0, y + 1, len, shH + 1 + Math.round(thick * 14)); });
    ctx.fillStyle = this.cols.sub;
    ctx.globalAlpha = 0.5;
    ctx.fill(sub);
    // oily rainbow film
    const o1 = Math.floor((t * 6) % 256);
    const p1 = ctx.createPattern(sh, 'repeat');
    p1.setTransform(new DOMMatrix([1, 0, 0, 1 + thick * 1.6, -o1, sy + 1]));
    ctx.globalCompositeOperation = wx.oil > 0.5 ? 'source-over' : 'lighter';
    ctx.globalAlpha = (0.32 + thick * 0.5) * (1 - tod.night * 0.4);
    ctx.fillStyle = p1;
    ctx.fill(band);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = this.cols.crest;
    ctx.fill(crest);
    // floating trash bobbing on the surface
    for (const f of this.floaters) {
      const x = Math.round(f.x);
      if (x < 2 || x > W - 2) continue;
      const y = ys[x] + Math.round(Math.sin(t * 1.4 + f.ph));
      if (f.k === 'duck') ctx.drawImage(this.duck.canvas, x - this.duck.ox, y - this.duck.oy + 3);
      else if (f.k === 'bottle') ctx.drawImage(this.bottle, x - 6, y - 2);
      else ctx.drawImage(this.can, x - 2, y - 3);
    }
  }

  drawDataRain(ctx, a, x0, density) {
    const n = Math.round(this.rain.length * density);
    for (let i = 0; i < n; i++) {
      const d = this.rain[(i * 7 + (x0 ? 3 : 0)) % this.rain.length];
      const tex = this.streams[d.tex];
      const y = Math.round(d.y);
      ctx.globalAlpha = a;
      ctx.drawImage(tex, d.x + x0, y);
      drawGlow(ctx, d.x + x0 + 1, y + tex.height - 3, 4, '#5aff8a', a * 0.7);
    }
    ctx.globalAlpha = 1;
  }

  drawSeabed(ctx, env) {
    const t = this.t, tod = this.tod, wx = this.wx;
    const sy = this.surfaceAt(env);
    const q = quality(env);
    const rayA = (tod.day * 0.5 + tod.dusk * 0.4 + tod.night * 0.12) * (1 - wx.oil * 0.7) * (1 - wx.murk * 0.25);
    if (rayA > 0.02) {
      const rc = tri('#e8ffd0', '#ffc080', '#9ad8c8', tod);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = rayA * (0.75 + 0.25 * Math.sin(t * 0.3));
      ctx.drawImage(this.rays.tint(rc, 1, rc), Math.round(Math.sin(t * 0.05) * 12), sy - 2);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    }
    this.silt.draw(ctx, t, 0.5 + wx.murk * 0.4, q, 0.3);
    // data bits drifting up
    for (const b of this.bits) {
      const k = 0.45 + 0.55 * Math.sin(t * 1.7 + b.ph);
      if (k < 0.15) continue;
      ctx.globalAlpha = k * (0.6 + tod.night * 0.4);
      if (b.sq) { ctx.fillStyle = ['#5affb0', '#7affea', '#b8ff7a'][b.c]; ctx.fillRect(Math.round(b.x), Math.round(b.y), 2, 2); }
      else ctx.drawImage(this.glyphs[b.ch][b.c], Math.round(b.x), Math.round(b.y));
    }
    ctx.globalAlpha = 1;
    this.paintBand(ctx, 1, this.par.x * 3, this.par.y * 0.8, q);
    if (!this.nearHooked) this.paintNear(ctx, env);
  }

  drawNear(ctx, env) {
    this.nearSeen = true;
    if (this.nearHooked) this.paintNear(ctx, env);
  }

  paintNear(ctx, env) {
    const t = this.t, wx = this.wx;
    this.paintBand(ctx, 0, this.par.x * 4, this.par.y, quality(env));
    ctx.save();
    ctx.translate(Math.round(this.par.x * 4), Math.round(this.par.y));
    const hk = (period, off) => { const p = ((this.hint + off) % period) / period; return p < 0.12 ? Math.sin((p / 0.12) * Math.PI) : 0; };
    if (!this.secrets().crt) twinkle(ctx, this.crt.x + this.crt.w - 3, this.crt.y + 2, hk(6, 1), '#c8fff0');
    ctx.restore();
    this.bubbles.draw(ctx, t);
    // oil blobs rising
    if (wx.oil > 0.05) {
      for (const o of this.oilBlobs) {
        const x = Math.round(o.x + Math.sin(t + o.ph) * 3), y = Math.round(o.y), r = o.s;
        ctx.globalAlpha = wx.oil * 0.85;
        ctx.fillStyle = '#16120c';
        ctx.fillRect(x - r + 1, y - r, r * 2 - 2, r * 2); ctx.fillRect(x - r, y - r + 1, r * 2, r * 2 - 2);
        ctx.fillStyle = hslToHex((t * 60 + o.ph * 50) % 360, 0.75, 0.62); ctx.fillRect(x - r + 1, y - r + 1, 2, 1);
        ctx.fillStyle = hslToHex((t * 60 + o.ph * 50 + 120) % 360, 0.75, 0.55); ctx.fillRect(x + r - 2, y + r - 2, 1, 1);
      }
      ctx.globalAlpha = 1;
    }
  }

  // One depth band: baked floor + props, caustics, bloom, screens, LEDs, algae, decor.
  paintBand(ctx, b, dx, dy, q) {
    const t = this.t, tod = this.tod, wx = this.wx, D = this.D, W = this.W;
    this.bands.draw(ctx, b, tod, dx, dy);
    const B = D.bands[b];
    const ca = (tod.day * 0.28 + tod.dusk * 0.2 + tod.night * 0.06) * (1 - wx.oil * 0.6) * (b === 1 ? 0.7 : 1);
    if (q >= 0.75 && ca > 0.01) this.caustics.draw(ctx, this.masks[b], -D.pad + dx, B.y + dy, t, ca, { fps: 7, drift: 3, offset: b * 5 });
    if (this.tear && b === 0) {
      const tr = this.tear, cv = this.bands.canvas(0, tod), yy = Math.round(tr.y - B.y);
      if (yy > 0 && yy < cv.height) ctx.drawImage(cv, 0, yy, cv.width, Math.min(tr.h, cv.height - yy), -D.pad + dx + tr.dx, B.y + yy + dy, cv.width, Math.min(tr.h, cv.height - yy));
    }
    ctx.save();
    ctx.translate(Math.round(dx), Math.round(dy));
    const flick = 1 - this.flicker;
    ctx.globalCompositeOperation = 'lighter';
    for (const gl of this.glows) {
      if (gl.band !== b) continue;
      ctx.globalAlpha = clamp01(((gl.id === 'circuit_coral' ? 0.12 : 0.32) + 0.12 * Math.sin(t * 1.3 + gl.ph) + tod.night * 0.22) * flick * gl.a);
      ctx.drawImage(gl.c, gl.x, gl.y);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    const glitch = wx.static;
    for (const s of this.screens) {
      if (s.band !== b) continue;
      const mode = s.secret ? (this.secrets().crt ? 'hello' : 'off') : s.mode;
      this.fx.draw(ctx, s, mode, t + s.x * 0.01, mode === 'off' ? 0 : glitch);
      if (mode !== 'off') drawGlow(ctx, s.x + s.w / 2, s.y + s.h / 2, Math.max(s.w, s.h) * 0.75, mode === 'fish' ? '#4a8aff' : mode === 'static' ? '#a8b8c8' : '#4aff8a', 0.18 * flick * s.a);
    }
    const lt = Math.floor(t * 6);
    for (const l of this.leds) {
      if (l.band !== b) continue;
      const v = hash2(l.x * 7 + l.y, lt + Math.floor(l.k * 5), 11);
      if (v < 0.22) { ctx.fillStyle = '#0a1a10'; ctx.fillRect(l.x, l.y, 1, 1); } else if (v > 0.9) { ctx.fillStyle = '#eaffea'; ctx.fillRect(l.x, l.y, 1, 1); }
    }
    for (const a of this.algae) {
      if (a.band !== b) continue;
      const k = 0.5 + 0.5 * Math.sin(t * 1.1 + a.ph);
      drawGlow(ctx, a.x, a.y, 3, a.c, (0.35 + k * 0.4 + tod.night * 0.3) * flick);
      ctx.fillStyle = a.c;
      ctx.fillRect(a.x, a.y, 1, 1);
    }
    if (b === 1) {
      const v = this.vend;
      if (v.item && v.t < 3.5) {
        const k = clamp01(v.t / 0.35);
        const yy = Math.round(lerp(v.tray.y - 24, v.tray.y, ease.outBounce(k)));
        ctx.drawImage(v.item, v.tray.x - 2, yy - 6);
        if (v.t < 0.6) drawGlow(ctx, v.tray.x, v.tray.y - 10, 22, '#fff0f8', (0.6 - v.t) * 1.5);
      }
      const hk = ((this.hint + 4) % 8) / 8;
      if (hk < 0.12) twinkle(ctx, v.rect.x + v.rect.w - 6, v.rect.y + 26, Math.sin((hk / 0.12) * Math.PI), '#ffe0f0');
    }
    ctx.restore();
    this.decor.draw(ctx, b, t, dx, dy);
    void W;
  }

  drawFront(ctx, env) {
    const t = this.t, wx = this.wx, q = quality(env);
    this.nearSilt.draw(ctx, t, 0.7 + wx.murk * 0.4, q);
    if (wx.data > 0.05) this.drawDataRain(ctx, wx.data * 0.75, 2, 0.35 * q);
    if (wx.static > 0.05) {
      // rolling scan band + flicker
      const y = Math.round(((t * 70) % (this.H + 40)) - 20);
      ctx.fillStyle = rgba('#d8ffe8', 0.05 * wx.static);
      ctx.fillRect(0, y, this.W, 3);
      if (this.flicker > 0.02) { ctx.fillStyle = rgba('#e0fff0', this.flicker * 0.12); ctx.fillRect(0, 0, this.W, this.H); }
    }
  }

  // ------------------------------------------------------------------ lighting
  lighting(env) {
    const tod = todWeights(env);
    const wx = this.wx;
    let dark = 0.16 + tod.night * 0.42 + tod.dusk * 0.12 + wx.oil * 0.14 + wx.murk * 0.04;
    dark = clamp(dark + this.flicker * 0.2, 0, 0.7);
    let tint = qmix('#3a5a48', '#6a4a3a', tod.dusk / Math.max(0.001, tod.day + tod.dusk));
    tint = qmix(tint, '#12283a', tod.night);
    if (wx.oil > 0.1) tint = qmix(tint, '#1a1a10', wx.oil * 0.5);
    const lights = [];
    const flick = 1 - this.flicker;
    const n = 0.45 + tod.night * 0.55;
    const few = tod.night < 0.3;
    for (const l of this.propLights) if (!few || l.id === 'vending_machine' || l.id === 'server_rack' || l.id === 'broken_robot') lights.push({ x: l.x, y: l.y, r: l.r, color: l.color, a: 0.55 * n * flick * l.a });
    for (const s of this.screens) {
      const on = !s.secret || this.secrets().crt;
      if (on) lights.push({ x: s.x + s.w / 2, y: s.y + s.h / 2, r: 40 * (1 - s.z * 0.4), color: s.secret ? '#8ab8ff' : s.mode === 'fish' ? '#6aa8ff' : '#7affc0', a: 0.6 * n * flick * s.a });
    }
    if (tod.night > 0.3) for (let i = 0; i < this.algae.length; i += 5) { const a = this.algae[i]; lights.push({ x: a.x, y: a.y, r: 20, color: a.c, a: 0.4 * n }); }
    const v = this.vend;
    if (v.item && v.t < 1) lights.push({ x: v.tray.x, y: v.tray.y - 10, r: 60, color: '#fff0f8', a: 1 - v.t });
    return { dark, tint, lights };
  }

  // ------------------------------------------------------------------ secrets
  secretAt(x, y) {
    if (inRect(x, y, this.monRect)) return 'crt';
    if (inRect(x, y, this.vend.rect)) return 'vending';
    return null;
  }

  onSecret(id, game) {
    const st = game.state;
    st.secrets ||= {};
    const audio = game.audio;
    if (id === 'crt') {
      if (!st.secrets.crt) {
        st.secrets.crt = true;
        audio?.play?.('crt_on');
        game.toast?.('The old monitor flickers to life: "HELLO, FISHER." Something digital stirs in the reef...', 'computer');
        game.save?.();
      } else {
        audio?.play?.('crt_on', { vol: 0.4, pitch: 1.3 });
        game.toast?.(['"HAVE YOU TRIED TURNING THE OCEAN OFF AND ON?"', '"PRESS ANY FISH TO CONTINUE."', '"404: SHORE NOT FOUND."', '"LOW BATTERY. HIGH TIDE."'][Math.floor(Math.random() * 4)], 'computer');
      }
      return;
    }
    if (id === 'vending') {
      const v = this.vend;
      if (v.cool > 0) return;
      v.cool = 0.8;
      if (!game.spendCoins(5)) { game.toast?.('The vending machine blinks: INSERT 5 COINS.', 'coin'); return; }
      let total = 0;
      for (const [, w] of VEND) total += w;
      let roll = Math.random() * total, pick = VEND[0][0];
      for (const [b, w] of VEND) { roll -= w; if (roll <= 0) { pick = b; break; } }
      st.baits ||= {};
      st.baits[pick] = (st.baits[pick] || 0) + 1;
      v.t = 0;
      v.item = canSprite({ bread: '#e0b060', worm: '#ff7ab0', sugar: '#f0f0ff', chip: '#3ad08a', popup: '#ff4a6a', golden: '#ffd040' }[pick] || '#d8343a');
      audio?.play?.('vending');
      if (pick === 'golden') setTimeout(() => audio?.play?.('sparkle'), 400);
      game.toast?.(`*clunk* The vending machine drops 1 ${BAITS[pick]?.name || pick}!`, 'bait');
      game.save?.();
    }
  }
}
