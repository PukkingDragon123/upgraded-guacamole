// Junkyard Reef: murky green-teal water where old computers go to sleep. An oily rainbow film under
// the surface, dim rays, far silhouettes of junk mountains, a sunken freighter and a crane, voxel silt
// and circuit-board floor, CRTs with live screens, blinking server racks, a glowing vending machine,
// sagging cables, glowing algae and drifting data bits. Weathers: murky, static, oil, datarain.

import { Biome } from './base.js';
import { clamp, clamp01, lerp, smoothstep, ease, hash2, fbm2, TAU } from '../../core/math.js';
import { RNG } from '../../core/rng.js';
import { mix, rgba, pack, hslToHex } from '../../core/color.js';
import { makeCanvas, ctxOf, makeLayer, tinted } from '../../core/canvas.js';
import { getProp } from '../../gfx/props.js';
import { drawText } from '../../gfx/font.js';
import { BAITS } from '../../game/shopdata.js';
import {
  paint, dpack, lerpStops, gradientStrip, stopPalette, ditherPick, Blend, FogLayer, fillWith, drawWobble, makeRays,
  drawGlow, twinkle, waveLine, waveRuns, Strands, Motes, Bubbles, Mask, ridge, todWeights, voxelGround, quality, inRect,
  catenary, drawCable, SwayAnim, Caustics, lumaMask, streakTile,
} from '../scenery.js';

const SKY = {
  day: [[0, '#768670'], [0.6, '#a2aa86'], [1, '#cdcaa0']],
  dusk: [[0, '#3a2a40'], [0.55, '#8a4a50'], [1, '#e2925c']],
  night: [[0, '#04070a'], [1, '#121a1c']],
};
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
    this.fogAmount = 0.78;
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
    this.ys = new Int16Array(W + 2);
    this.skyH = this.base + 10;
    this.air = makeLayer(W, this.skyH);
    this.skyBlend = new Blend(); this.waterBlend = new Blend();
    this.buildSky();
    const wo = { y0: this.base - 2, y1: H, levels: 24 };
    this.water = { day: gradientStrip(H, WATER.day, wo), dusk: gradientStrip(H, WATER.dusk, wo), night: gradientStrip(H, WATER.night, wo) };
    this.fx = new ScreenFX();
    this.buildGround();
    this.buildLayers();
    const rh = H - this.base;
    this.rays = new FogLayer(makeRays(W, rh, { seed: 14, count: 7, sunX: W * 0.35, sunY: -H * 0.9, minW: 8, maxW: 26, len: 0.7, color: '#ffffff', alpha: 0.45, levels: 4 }));
    this.sheen = this.makeSheen();
    this.caustics = new Caustics({ tw: 128, th: 40, cx: 8, cy: 4, seed: 6, color: '#e8ffd8', thick: 0.6, core: 0.6, rim: 0.2 });
    this.buildLife();
    this.fresh = true;
  }

  buildSky() {
    const W = this.W, h = this.skyH, base = this.base;
    const m = new Mask(W, h);
    const r = new RNG(17);
    // industrial skyline: hills of junk, smokestacks, cranes, a pier
    const rg = ridge(W, base - 3, 3, 0.02, 4, 3);
    m.below((x) => rg[x]);
    this.stacks = [];
    for (const xf of [0.2, 0.23, 0.71]) { const x = Math.round(xf * W), hh = r.int(10, 15); m.rect(x, base - hh, 3, hh); m.rect(x - 1, base - hh, 5, 1); this.stacks.push({ x: x + 1, y: base - hh - 1 }); }
    this.blinkers = [];
    for (const xf of [0.43, 0.86]) {
      const x = Math.round(xf * W), top = base - 18;
      m.rect(x, top, 2, 18); m.line(x, top, x + 26, top - 3, 0.6); m.line(x - 8, top + 1, x, top, 0.6); m.line(x + 22, top - 2, x + 22, top + 8, 0.4);
      this.blinkers.push({ x: x + 26, y: top - 4 }, { x, y: top - 1 });
    }
    m.rect(Math.round(W * 0.55), base - 4, 60, 2); for (let i = 0; i < 7; i++) m.rect(Math.round(W * 0.55) + i * 9, base - 4, 1, 5);
    this.windows = [];
    for (let i = 0; i < 18; i++) { const x = r.int(10, W - 10); this.windows.push({ x, y: Math.round(rg[x]) + r.int(1, 2), ph: r.float(0, TAU) }); }
    const mk = (kind) => {
      const st = SKY[kind];
      const c = paint(W, h, (x, y) => {
        const [rr, gg, bb] = lerpStops(st, clamp01(y / base));
        return dpack(rr, gg, bb, x, y, 6);
      });
      const sil = { day: ['#4a5446', '#5c6654'], dusk: ['#2a1c2a', '#3a2834'], night: ['#020405', '#080c0e'] }[kind];
      ctxOf(c).drawImage(m.toCanvas((x, y, v, up) => pack(up <= 1 ? sil[1] : sil[0])), 0, 0);
      return c;
    };
    this.sky = { day: mk('day'), dusk: mk('dusk'), night: mk('night') };
    this.smoke = [];
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

  buildGround() {
    const W = this.W, H = this.H;
    const backY = H - 70;
    const dockX = W - 270;
    const g = voxelGround(W, H, {
      vs: 2, backY, baseH: 5, ny: 22, pitch: 27, render: { depthLines: false, edges: 0.7, sideEdges: 0.3 },
      height: (x, z) => {
        const sx = x * 2;
        let h = 5 + (fbm2(sx * 0.008, z * 0.03, 3, 21) - 0.5) * 6;
        h += Math.max(0, fbm2(sx * 0.03, z * 0.07, 2, 22) - 0.62) * 14;
        h += (1 - smoothstep(0, W * 0.12, sx)) * 3;
        h = lerp(h, 5 + (fbm2(sx * 0.01, z * 0.03, 2, 4) - 0.5) * 2, smoothstep(dockX - 40, dockX + 20, sx));
        return h;
      },
      palette: (m) => ({
        mud: m.color('#5e5c46', { jitter: 0.22 }), mud2: m.color('#4c4c3c', { jitter: 0.22 }), silt: m.color('#72705a', { jitter: 0.18 }),
        rust: m.color('#8a5634', { jitter: 0.2 }), pcb: m.color('#2c6a40', { jitter: 0.08 }), trace: m.color('#d6b040', { jitter: 0.05, spec: 0.8 }),
        chip: m.color('#202028', { jitter: 0.05 }), pin: m.color('#b8bcc8', { jitter: 0.05 }), bolt: m.color('#8c929c', { jitter: 0.15 }),
        algae: m.color('#8aff5a', { emissive: 0.85, jitter: 0.1 }), red: m.color('#c83a3a', { jitter: 0.08 }), blue: m.color('#3a6ac8', { jitter: 0.08 }), yel: m.color('#e0c040', { jitter: 0.08 }),
      }),
      color: (x, y, z, h, p) => {
        if (y < h - 1) return p.mud2;
        const pc = fbm2(x * 0.03 + 5, z * 0.05, 2, 31);
        if (pc > 0.66) {
          if (((x % 7 === 0) || (z % 6 === 0)) && hash2(x >> 2, z >> 2, 2) < 0.7) return p.trace;
          return p.pcb;
        }
        const n = fbm2(x * 0.06, z * 0.09, 2, 33);
        if (n > 0.68) return p.rust;
        if (n < 0.3) return p.mud2;
        return n > 0.55 ? p.silt : p.mud;
      },
      decorate: (m, p, H2) => {
        const r = new RNG(55);
        const nz = Math.round(m.nz * 0.62);
        for (let i = 0; i < 26; i++) {
          // microchips with pins
          const x = r.int(4, m.nx - 8), z = r.int(2, nz - 4), h = H2(x, z), w = r.int(2, 4), d = r.int(2, 3);
          for (let a = 0; a < w; a++) for (let b = 0; b < d; b++) m.set(x + a, h, z + b, p.chip);
          for (let a = 0; a < w; a++) { m.set(x + a, h, z - 1, p.pin); m.set(x + a, h, z + d, p.pin); }
        }
        for (let i = 0; i < 80; i++) { const x = r.int(2, m.nx - 3), z = r.int(1, nz), h = H2(x, z); m.set(x, h, z, r.pick([p.bolt, p.bolt, p.rust, p.pin])); if (r.chance(0.4)) m.set(x + 1, h, z, p.bolt); }
        for (let i = 0; i < 14; i++) {
          // stray wires
          let x = r.int(4, m.nx - 20), z = r.int(2, nz - 3);
          const c = r.pick([p.red, p.blue, p.yel]);
          for (let k = 0; k < r.int(8, 20); k++) { m.set(x, H2(x, z), z, c); x++; if (r.chance(0.3)) z += r.pick([-1, 1]); }
        }
        for (let i = 0; i < 22; i++) {
          const x = r.int(4, m.nx - 4), z = r.int(1, nz - 2), h = H2(x, z);
          for (let k = 0; k < r.int(2, 5); k++) m.set(x + r.int(-2, 2), h, z + r.int(-1, 1), p.algae);
        }
      },
    });
    this.ground = g;
    this.floor = g.floor;
    const P = [
      ['tire', 0.045, 0.24, 0.75, 0], ['floppy_pile', 0.13, 0.4, 0.7, 0], ['pipe_bend', 0.22, 0.12, 0.8, 0], ['crt_pile', 0.315, 0.0, 0.85, 0],
      ['server_rack', 0.425, 0.0, 0.85, 0], ['crt_monitor', 0.375, 0.34, 0.75, 0], ['broken_robot', 0.525, 0.08, 0.85, 0], ['circuit_coral', 0.465, 0.38, 0.7, 0],
      ['vending_machine', 0.638, 0.0, 0.85, 0], ['circuit_coral', 0.588, 0.4, 0.6, 1], ['rusty_barrel', 0.7, 0.24, 0.75, 0], ['keyboard_slab', 0.255, 0.42, 0.6, 0],
      ['circuit_coral', 0.705, 0.0, 0.55, 2], ['tire', 0.955, 0.12, 0.55, 0], ['floppy_pile', 0.86, 0.36, 0.55, 0],
    ];
    const placed = P.map(([id, xf, zf, scale, variant]) => {
      const p = getProp(id, { scale, variant });
      const x = Math.round(xf * W), y = Math.round(g.surfaceY(x, zf)) + 1;
      return { id, p, x, y, zf, top: y - p.oy, left: x - p.ox };
    }).sort((a, b) => a.zf - b.zf);
    this.placed = placed;
    let top = Math.min(...placed.map((q) => q.top));
    for (let x = 0; x <= W; x++) top = Math.min(top, g.floor[x] - 2);
    top = Math.floor(top) - 4;
    this.bedY = top;
    const bed = makeCanvas(W, H - top);
    const bg = ctxOf(bed);
    bg.drawImage(g.canvas, g.x, g.y - top);
    const fy = Math.round(backY - top - 8);
    const hz = bg.createLinearGradient(0, fy, 0, fy + 24);
    hz.addColorStop(0, 'rgba(50,110,100,0.6)');
    hz.addColorStop(1, 'rgba(50,110,100,0)');
    bg.globalCompositeOperation = 'source-atop';
    bg.fillStyle = hz;
    bg.fillRect(0, fy, W, 24);
    bg.globalCompositeOperation = 'source-over';
    const find = (id) => placed.find((q) => q.id === id);
    const pile = find('crt_pile'), rack = find('server_rack'), robot = find('broken_robot'), vend = find('vending_machine'), barrel = find('rusty_barrel'), mon = find('crt_monitor');
    // sagging cables between the junk (behind the front props)
    const cables = [
      [[-10, H * 0.5], [pile.left + 30, pile.top + 40], 40, '#24242c', 2],
      [[rack.x - 10, rack.top + 6], [pile.x + 30, pile.top + 34], 22, '#c8a040', 1],
      [[rack.x + 18, rack.top + 10], [robot.x - 20, robot.top + 40], 30, '#2a2a34', 2],
      [[robot.x + 24, robot.top + 36], [vend.x - 14, vend.top + 10], 34, '#3a5ac0', 1],
      [[vend.x + 16, vend.top + 8], [barrel.x + 10, barrel.top + 14], 26, '#b83a3a', 1],
      [[vend.x + 20, vend.top + 14], [W * 0.82, backY - 6], 34, '#24242c', 2],
    ];
    const drawCables = (gg) => {
      for (const [a, b, sag, col, w] of cables) {
        const pts = catenary(a[0], a[1] - top, b[0], b[1] - top, sag, 30);
        drawCable(gg, pts, col, w, '#0a0c10', w >= 2 ? mix(col, '#ffffff', 0.35) : null);
      }
    };
    let cablesDone = false;
    for (const q of placed) {
      if (!cablesDone && q.zf > 0.05) { drawCables(bg); cablesDone = true; }
      bg.drawImage(q.p.canvas, q.left, q.top - top);
    }
    if (!cablesDone) drawCables(bg);
    this.bed = bed;
    this.bedMask = lumaMask(bed, { gamma: 2, gain: 1.1 });
    this.groundGlow = g.glow;
    // glowing bits: prop glow layers, screens, LEDs, lights
    this.glows = placed.filter((q) => q.p.glow).map((q) => ({ c: q.p.glow, x: q.left, y: q.top, id: q.id, ph: hash2(q.x, 1, 9) * TAU }));
    this.screens = [];
    const modes = ['text', 'fish', 'static'];
    let si = 0;
    for (const q of placed) {
      if (q.id === 'crt_pile' || q.id === 'crt_monitor') {
        for (const s of q.p.screens) {
          const scr = { x: q.left + s.x, y: q.top + s.y, w: s.w, h: s.h, mode: q.id === 'crt_monitor' ? 'off' : modes[si++ % 3], secret: q.id === 'crt_monitor' };
          this.screens.push(scr);
        }
      }
    }
    this.crt = this.screens.find((s) => s.secret);
    this.leds = [];
    if (rack.p.glow) {
      const gd = ctxOf(rack.p.glow).getImageData(0, 0, rack.p.w, rack.p.h).data;
      for (let y = 0; y < rack.p.h; y++) for (let x = 0; x < rack.p.w; x++) if (gd[(y * rack.p.w + x) * 4 + 3] === 255 && this.leds.length < 140) this.leds.push({ x: rack.left + x, y: rack.top + y, k: hash2(x, y, 3) });
    }
    this.propLights = [];
    for (const q of placed) {
      const ls = q.p.lights.slice().sort((a, b) => b.r - a.r).slice(0, 2);
      for (const l of ls) this.propLights.push({ x: q.left + l.x, y: q.top + l.y, r: Math.min(80, l.r + 10), color: l.color, id: q.id });
    }
    this.vend = { x: vend.x, y: vend.y, rect: { x: vend.left + 8, y: vend.top + 8, w: vend.p.w - 16, h: vend.p.h - 12 }, tray: { x: vend.x - 6, y: vend.y - 18 }, t: 9, item: null, cool: 0 };
    this.monRect = { x: this.crt.x - 4, y: this.crt.y - 4, w: this.crt.w + 8, h: this.crt.h + 10 };
    this.rack = rack; this.robot = robot; this.barrel = barrel; this.pile = pile; this.mon = mon;
    // algae spots along junk top edges
    this.algae = [];
    const bd = bg.getImageData(0, 0, W, H - top).data;
    const r = new RNG(12);
    for (let i = 0; i < 500 && this.algae.length < 34; i++) {
      const x = r.int(20, W - 20);
      if (x > W - 260 && r.chance(0.7)) continue;
      for (let y = 2; y < H - top - 30; y++) {
        if (bd[(y * W + x) * 4 + 3] > 0) {
          if (top + y < g.floor[x] - 6) this.algae.push({ x, y: top + y, ph: r.float(0, TAU), c: r.pick(['#7aff5a', '#5affb0', '#c8ff5a']) });
          break;
        }
      }
    }
  }

  buildLayers() {
    const W = this.W, H = this.H, pad = 28;
    this.pad = pad;
    const LW = W + pad * 2;
    const r = new RNG(8);
    const junk = (m, x, y, s, v = 1) => {
      const k = r.next();
      if (k < 0.25) { const w = r.float(10, 26) * s, h = r.float(8, 18) * s, a = r.float(-0.4, 0.4); const c = Math.cos(a), sn = Math.sin(a); m.poly([[-w, -h], [w, -h], [w, h], [-w, h]].map(([px, py]) => [x + px * c - py * sn, y + px * sn + py * c])); }
      else if (k < 0.45) { const rr = r.float(5, 11) * s; m.ellipse(x, y, rr, rr, v); m.ellipse(x, y, rr * 0.45, rr * 0.45, 0); }
      else if (k < 0.62) { const w = r.float(9, 14) * s; m.rect(x - w, y - w * 0.8, w * 2, w * 1.6, v); m.rect(x - w * 0.6, y - w * 0.45, w * 1.2, w * 0.9, 0); m.rect(x - w * 0.4, y + w * 0.8, w * 0.8, 3, v); }
      else if (k < 0.75) { m.line(x, y, x + r.float(-14, 14) * s, y - r.float(16, 34) * s, r.float(1, 2)); }
      else { const w = r.float(14, 22) * s; m.ellipse(x, y, w, w * 0.45); m.ellipse(x - w * 0.55, y + w * 0.3, w * 0.22, w * 0.22); m.ellipse(x + w * 0.55, y + w * 0.3, w * 0.22, w * 0.22); }
    };
    // --- far A: junk mountains, a sunken freighter and a crane
    const yA = Math.round(H * 0.28), hA = H - yA;
    const mA = new Mask(LW, hA);
    const rA = ridge(LW, hA * 0.58, hA * 0.2, 0.0075, 1.4, 4, 0.2);
    mA.below((x) => rA[x]);
    for (let i = 0; i < 70; i++) { const x = r.float(0, LW); junk(mA, x, rA[Math.round(x)] + r.float(-2, 8), 1.1); }
    // freighter
    const sx = LW * 0.64, sy = rA[Math.round(sx)] + 10;
    const tilt = -0.12;
    const hull = [[-170, 0], [-160, -46], [150, -60], [190, -78], [196, -60], [178, 10]].map(([px, py]) => [sx + px, sy + py + px * tilt * 0.3]);
    mA.poly(hull);
    mA.rect(sx - 140, sy - 100 + 14, 52, 50); mA.rect(sx - 130, sy - 118 + 14, 30, 20); mA.rect(sx - 118, sy - 140 + 14, 8, 24);
    for (let k = 0; k < 4; k++) mA.rect(sx - 70 + k * 50, sy - 70 - k * 4, 34, 18);
    mA.line(sx + 120, sy - 70, sx + 132, sy - 150, 2); mA.line(sx + 104, sy - 128, sx + 160, sy - 136, 1);
    for (let k = 0; k < 9; k++) mA.ellipse(sx - 140 + k * 34, sy - 30 + k * -1.5, 2.5, 2.5, 0);
    mA.rect(sx - 136, sy - 96 + 14, 44, 4, 0); mA.rect(sx - 136, sy - 84 + 14, 44, 4, 0);
    // crane
    const cx = LW * 0.2, cy = rA[Math.round(cx)] + 4, ct = hA * 0.06;
    for (const dx of [-8, 8]) mA.line(cx + dx, cy, cx + dx * 0.5, ct, 1.2);
    for (let y = cy; y > ct + 10; y -= 14) { mA.line(cx - 8 + (cy - y) * 0.02, y, cx + 8 - (cy - y) * 0.02, y - 14, 0.7); mA.line(cx + 8 - (cy - y) * 0.02, y, cx - 8 + (cy - y) * 0.02, y - 14, 0.7); }
    const bx1 = cx + 170, by1 = ct + 40;
    mA.line(cx, ct, bx1, by1, 1.2); mA.line(cx, ct + 10, bx1, by1 + 4, 1);
    for (let k = 0; k < 10; k++) { const u = k / 10; mA.line(lerp(cx, bx1, u), lerp(ct, by1, u), lerp(cx, bx1, u + 0.1), lerp(ct + 10, by1 + 4, u + 0.1), 0.5); }
    mA.line(cx - 40, ct + 6, cx, ct, 1.2); mA.rect(cx - 50, ct + 4, 14, 10);
    mA.line(bx1 - 10, by1 + 2, bx1 - 10, by1 + 120, 0.5); mA.ellipse(bx1 - 10, by1 + 124, 4, 3); mA.ellipse(bx1 - 10, by1 + 124, 2, 1.5, 0);
    this.craneHook = { x: bx1 - 10 - pad, y: yA + by1 + 124 };
    const palA = stopPalette([[0, '#0e2420'], [1, '#2a4a40']], 6);
    this.farA = new FogLayer(mA.toCanvas((x, y, v, up) => (up <= 1 ? pack('#6aa48a') : ditherPick(palA, 0.7 - Math.min(1, up / 60) * 0.5 + (fbm2(x * 0.06, y * 0.06, 2, 3) - 0.5) * 0.4, x, y))), -pad, yA);
    this.farAY = yA;
    // --- far B: container stacks, utility poles with sagging wires, junk piles
    const yB = H - 250, hB = 250;
    const mB = new Mask(LW, hB);
    const rB = ridge(LW, hB * 0.66, 14, 0.012, 9.3, 3);
    mB.below((x) => rB[x]);
    for (let i = 0; i < 60; i++) { const x = r.float(0, LW); junk(mB, x, rB[Math.round(x)] + r.float(0, 6), 0.85); }
    for (const xf of [0.12, 0.47, 0.83]) {
      const x0 = LW * xf, y0 = rB[Math.round(x0)] + 4;
      for (let k = 0; k < 3; k++) {
        const w = 46, h = 18, yy = y0 - h * (k + 1) + 2, xx = x0 + (k % 2) * 8 - (k === 2 ? 14 : 0);
        mB.rect(xx, yy, w, h - 2);
        for (let q = 4; q < w - 2; q += 4) mB.rect(xx + q, yy + 2, 1, h - 7, 0);
      }
    }
    const poles = [];
    for (let i = 0; i < 6; i++) {
      const x = LW * (0.06 + i * 0.18) + r.float(-10, 10), y0 = rB[Math.round(clamp(x, 0, LW))] + 4, hgt = r.float(80, 100), lean = r.float(-0.12, 0.12);
      const tx = x + lean * hgt, ty = y0 - hgt;
      mB.line(x, y0, tx, ty, 1.6); mB.line(tx - 9, ty + 6, tx + 9, ty + 4, 1); mB.line(tx - 7, ty + 12, tx + 7, ty + 11, 0.8);
      poles.push([tx, ty + 5]);
    }
    for (let i = 0; i + 1 < poles.length; i++) {
      for (const dy of [0, 6]) {
        const pts = catenary(poles[i][0] - 8, poles[i][1] + dy, poles[i + 1][0] - 8, poles[i + 1][1] + dy, 22 + dy * 1.5, 40);
        for (let k = 0; k + 1 < pts.length; k++) mB.line(pts[k][0], pts[k][1], pts[k + 1][0], pts[k + 1][1], 0.5);
      }
    }
    const palB = stopPalette([[0, '#0c201c'], [1, '#26443c']], 6);
    this.farB = new FogLayer(mB.toCanvas((x, y, v, up) => (up <= 1 ? pack('#7ab496') : up === 2 ? pack('#3e6a5a') : ditherPick(palB, 0.7 - Math.min(1, up / 40) * 0.5 + (fbm2(x * 0.08, y * 0.08, 2, 5) - 0.5) * 0.4, x, y))), -pad, yB);
    this.farBY = yB;
    // --- mid: junk bank with real props, fogged
    const yC = H - 160, hC = 160;
    const mC = new Mask(LW, hC);
    const rC = ridge(LW, 62, 12, 0.012, 3.3, 3);
    mC.below((x) => rC[x]);
    for (let i = 0; i < 40; i++) { const x = r.float(0, LW); junk(mC, x, rC[Math.round(x)] + r.float(2, 8), 0.6); }
    const palC = stopPalette([[0, '#2a3a34'], [0.6, '#4a5a4c'], [1, '#6a786a']], 6);
    const cC = mC.toCanvas((x, y, v, up) => (up <= 1 ? pack('#9ab8a0') : ditherPick(palC, 0.85 - Math.min(1, up / 26) * 0.7 + (fbm2(x * 0.1, y * 0.1, 2, 11) - 0.5) * 0.4, x, y)));
    const gC = ctxOf(cC);
    const mids = [['server_rack', 0.06, 0.5], ['satellite_dish', 0.17, 0.55], ['shopping_cart', 0.36, 0.45], ['gear_big', 0.56, 0.55], ['crt_pile', 0.78, 0.45], ['pipe_bend', 0.92, 0.5], ['satellite_dish', 0.99, 0.45]];
    for (const [id, xf, sc] of mids) {
      const p = getProp(id, { scale: sc });
      const x = Math.round(xf * W + pad), y = Math.round(rC[clamp(x, 0, LW)] + 8);
      gC.drawImage(p.canvas, x - p.ox, y - p.oy);
    }
    this.mid = new FogLayer(cC, -pad, yC);
    this.midY = yC;
  }

  buildLife() {
    const W = this.W, H = this.H, g = this.ground;
    const r = new RNG(19);
    // limp seaweed growing out of the junk
    this.tufts = [];
    const sets = [['#2a4a2a', '#3e5e2e', '#5a7a34', '#7a9a44'], ['#3a4a22', '#566a2a', '#748a34', '#98ac48']];
    for (const [xf, zf] of [[0.08, 0.36], [0.17, 0.3], [0.27, 0.36], [0.42, 0.42], [0.49, 0.2], [0.56, 0.44], [0.61, 0.3], [0.75, 0.38], [0.8, 0.2], [0.92, 0.4], [0.995, 0.3]]) {
      const x0 = Math.round(xf * W), y0 = Math.round(g.surfaceY(x0, zf)) + 1;
      const st = new Strands();
      const k = r.int(3, 5), tall = r.chance(0.5), set = r.pick(sets);
      for (let i = 0; i < k; i++) {
        const lean = (i / Math.max(1, k - 1) - 0.5) * 0.8;
        st.add({ x: x0 + Math.round(lean * 7), y: y0, n: tall ? r.int(9, 14) : r.int(5, 8), seg: 2, w: tall ? 2 : 1, amp: 0.22, speed: 1.1, sec: 1, phase: r.float(0, TAU), wave: 0.4, lean, curl: lean * 0.5, cols: set, out: tall ? '#0c1a14' : null, hl: false, taper: 0.3 });
      }
      this.tufts.push({ anim: new SwayAnim(st, { frames: 16 }), off: r.int(0, 15) });
    }
    // a long dangling cable with a plug
    const s = this.base;
    this.dangle = new Strands();
    for (const [xf, n] of [[0.18, 26], [0.585, 18]]) this.dangle.add({ x: Math.round(xf * W), y: s + 2, n, seg: -5, w: 2, amp: 0.1, speed: 0.5, phase: xf * 9, wave: 0.12, cols: ['#2a2a32', '#34343e'], out: '#0a0c10', hl: false });
    // floating trash at the surface
    this.duck = getProp('rubber_duck', { scale: 0.45 });
    this.bottle = bottleSprite();
    this.can = canSprite();
    this.floaters = [[0.3, 'duck'], [0.52, 'bottle'], [0.68, 'can'], [0.9, 'bottle']].map(([xf, k], i) => ({ x: xf * W, k, v: 2 + i, ph: i * 1.7 }));
    // particles
    this.silt = new Motes(120, { x0: 0, y0: s + 4, x1: W, y1: H - 50 }, { seed: 4, vx: [-2, 2], vy: [-1.5, 1.5], sizes: [1, 1, 2], colors: ['#a8c8a0', '#c8d8b0', '#8aa890'], alpha: [0.2, 0.55], wob: 4 });
    this.nearSilt = new Motes(22, { x0: 0, y0: s + 10, x1: W, y1: H - 30 }, { seed: 9, vx: [-3, 3], vy: [-2, 2], sizes: [2, 3], colors: ['#b8d8b0'], alpha: [0.08, 0.2], wob: 7 });
    this.bits = [];
    const bc = ['#5affb0', '#7affea', '#b8ff7a'];
    this.glyphs = { 0: bc.map((c) => glyphSprite(0, c)), 1: bc.map((c) => glyphSprite(1, c)) };
    for (let i = 0; i < 40; i++) this.bits.push({ x: r.float(0, W), y: r.float(s + 20, H - 60), vy: -r.float(2, 6), ch: r.int(0, 1), c: r.int(0, 2), ph: r.float(0, TAU), sq: r.chance(0.35) });
    this.streams = [];
    for (let i = 0; i < 6; i++) this.streams.push(streamTex(100 + i, 14 + i * 3));
    this.rain = [];
    for (let i = 0; i < 34; i++) this.rain.push({ x: Math.round(r.float(0, W) / 4) * 4, y: r.float(-200, H), v: r.float(50, 110), tex: r.int(0, 5) });
    this.oilBlobs = [];
    for (let i = 0; i < 14; i++) this.oilBlobs.push({ x: r.float(0, W), y: r.float(s + 30, H - 80), v: -r.float(3, 8), ph: r.float(0, TAU), s: r.int(2, 4) });
    this.bubbles = new Bubbles(60, '#d8f0e0');
    this.emitT = 1;
    this.tear = null;
    this.hint = 0;
  }

  // ------------------------------------------------------------------ update
  update(dt, env) {
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
    const tx = c && c.x > -50 ? (c.x / W - 0.5) * -2 : 0, ty = c && c.y > -50 ? (c.y / H - 0.5) * -2 : 0;
    const kp = snap ? 1 : 1 - Math.exp(-dt * 2.5);
    this.par.x += (tx - this.par.x) * kp;
    this.par.y += (ty - this.par.y) * kp;
    this.fresh = false;
    this.cols.crest = tri('#d0f4dc', '#ffd8b0', '#7aa8a0', tod);
    this.cols.sub = tri('#86c4a8', '#c0a080', '#3a6a66', tod);
    this.fogColor = qmix(tri('#2f6e64', '#4a5a50', '#1c4448', tod), '#141a14', wx.oil * 0.35);
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
  drawAir(env) {
    const g = this.air.ctx, W = this.W, h = this.skyH, t = this.t, tod = this.tod;
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    g.drawImage(this.skyBlend.get([[this.sky.day, tod.day], [this.sky.dusk, tod.dusk], [this.sky.night, tod.night]]), 0, 0);
    // smoke from the stacks
    g.fillStyle = tod.night > 0.5 ? '#1a2224' : '#8a9080';
    for (const st of this.stacks) {
      for (let i = 0; i < 5; i++) {
        const k = ((t * 0.15 + i / 5) % 1);
        g.globalAlpha = (1 - k) * 0.45;
        const r = 1 + Math.round(k * 4);
        g.fillRect(Math.round(st.x + k * 14 + Math.sin(t + i) * 1.5) - r, Math.round(st.y - k * 12) - r, r * 2, r * 2);
      }
    }
    g.globalAlpha = 1;
    if (tod.night > 0.3) {
      for (const wdw of this.windows) { if (Math.sin(t * 0.2 + wdw.ph) > -0.3) { g.fillStyle = '#ffd27a'; g.globalAlpha = tod.night * 0.8; g.fillRect(wdw.x, wdw.y, 1, 1); } }
      g.globalAlpha = 1;
    }
    for (const b of this.blinkers) if (Math.sin(t * 2.5 + b.x) > 0.4) { g.fillStyle = '#ff4a3a'; g.fillRect(b.x, b.y, 1, 1); }
  }

  drawBack(ctx, env) {
    const W = this.W, H = this.H, t = this.t, tod = this.tod, wx = this.wx;
    const sy = this.surfaceAt(env);
    const ys = this.ys;
    waveLine(ys, W, sy, t * 0.7, 1.1, 0.2, 0.8);
    let top = H;
    for (let x = 0; x <= W; x++) if (ys[x] < top) top = ys[x];
    const water = this.waterBlend.get([[this.water.day, tod.day], [this.water.dusk, tod.dusk], [this.water.night, tod.night]]);
    const hasAir = top > -3;
    if (hasAir) {
      this.drawAir(env);
      ctx.drawImage(this.air.canvas, 0, 0);
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
    drawWobble(ctx, this.farA.tint(water, 0.74, key), -this.pad + px * 1.5, this.farAY + py, t, wob, 4, 0.8, 0.07);
    // crane hook swings in the far fog
    drawWobble(ctx, this.farB.tint(water, 0.52, key), -this.pad + px * 3, this.farBY + py * 1.5, t + 2, wob, 4, 1, 0.09);
    ctx.drawImage(this.mid.tint(water, 0.4, key), Math.round(-this.pad + px * 6), Math.round(this.midY + py * 2.5));
    // murk & oil darkening
    const murk = 0.08 + wx.murk * 0.06 + wx.oil * 0.16;
    ctx.fillStyle = rgba(wx.oil > 0.3 ? '#0e1410' : '#2a4a40', murk);
    ctx.fillRect(0, Math.max(0, top), W, H - Math.max(0, top));
    // data rain behind the junk
    if (wx.data > 0.05) this.drawDataRain(ctx, wx.data * 0.7, 0, 0.5);
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
    ctx.globalAlpha = a;
    for (let i = 0; i < n; i++) {
      const d = this.rain[(i * 7 + (x0 ? 3 : 0)) % this.rain.length];
      ctx.drawImage(this.streams[d.tex], d.x + x0, Math.round(d.y));
    }
    ctx.globalAlpha = 1;
  }

  drawSeabed(ctx, env) {
    const W = this.W, H = this.H, t = this.t, tod = this.tod, wx = this.wx;
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
    this.dangle.draw(ctx, t, Math.sin(t * 0.3) * 0.05);
    ctx.drawImage(this.bed, 0, this.bedY);
    const ca = (tod.day * 0.28 + tod.dusk * 0.2 + tod.night * 0.06) * (1 - wx.oil * 0.6);
    if (q >= 0.75) this.caustics.draw(ctx, this.bedMask, 0, this.bedY, t, ca, { fps: 7, drift: 3 });
    // screen tear (static storm)
    if (this.tear) {
      const tr = this.tear, yy = Math.round(tr.y - this.bedY);
      if (yy > 0 && yy < this.bed.height) ctx.drawImage(this.bed, 0, yy, W, Math.min(tr.h, this.bed.height - yy), tr.dx, this.bedY + yy, W, Math.min(tr.h, this.bed.height - yy));
    }
    // emissive glows (bloom)
    const flick = 1 - this.flicker;
    ctx.globalCompositeOperation = 'lighter';
    for (const gl of this.glows) {
      ctx.globalAlpha = (0.35 + 0.15 * Math.sin(t * 1.3 + gl.ph) + tod.night * 0.25) * flick;
      ctx.drawImage(gl.c, gl.x, gl.y);
    }
    if (this.groundGlow) { ctx.globalAlpha = (0.4 + 0.3 * Math.sin(t * 0.9)) * flick; ctx.drawImage(this.groundGlow, this.ground.x, this.ground.y); }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    // CRT screens
    const glitch = wx.static;
    for (const s of this.screens) {
      let mode = s.mode;
      if (s.secret) mode = this.secrets().crt ? 'hello' : 'off';
      this.fx.draw(ctx, s, mode, t + s.x * 0.01, mode === 'off' ? 0 : glitch);
      if (mode !== 'off') drawGlow(ctx, s.x + s.w / 2, s.y + s.h / 2, Math.max(s.w, s.h) * 0.75, mode === 'fish' ? '#4a8aff' : mode === 'static' ? '#a8b8c8' : '#4aff8a', 0.18 * flick);
    }
    // server LEDs blink
    const lt = Math.floor(t * 6);
    for (const l of this.leds) {
      const v = hash2(l.x * 7 + l.y, lt + Math.floor(l.k * 5), 11);
      if (v < 0.22) { ctx.fillStyle = '#0a1a10'; ctx.fillRect(l.x, l.y, 1, 1); } else if (v > 0.9) { ctx.fillStyle = '#eaffea'; ctx.fillRect(l.x, l.y, 1, 1); }
    }
    // glowing algae
    for (const a of this.algae) {
      const k = 0.5 + 0.5 * Math.sin(t * 1.1 + a.ph);
      drawGlow(ctx, a.x, a.y, 3, a.c, (0.35 + k * 0.4 + tod.night * 0.3) * flick);
      ctx.fillStyle = a.c;
      ctx.fillRect(a.x, a.y, 1, 1);
    }
    for (const tf of this.tufts) tf.anim.draw(ctx, t, tf.off);
    // vending machine: delivered item in the tray
    const v = this.vend;
    if (v.item && v.t < 3.5) {
      const k = clamp01(v.t / 0.35);
      const yy = Math.round(lerp(v.tray.y - 26, v.tray.y, ease.outBounce(k)));
      ctx.drawImage(v.item, v.tray.x - 2, yy - 6);
      if (v.t < 0.6) drawGlow(ctx, v.tray.x, v.tray.y - 10, 22, '#fff0f8', (0.6 - v.t) * 1.5);
    }
    this.bubbles.draw(ctx, t);
    // secret hints
    const hk = (period, off) => { const p = ((this.hint + off) % period) / period; return p < 0.12 ? Math.sin((p / 0.12) * Math.PI) : 0; };
    if (!this.secrets().crt) twinkle(ctx, this.crt.x + this.crt.w - 3, this.crt.y + 2, hk(6, 1), '#c8fff0');
    twinkle(ctx, v.rect.x + v.rect.w - 6, v.rect.y + 30, hk(8, 4), '#ffe0f0');
    // oil blobs rising
    if (wx.oil > 0.05) {
      for (const o of this.oilBlobs) {
        const x = Math.round(o.x + Math.sin(t + o.ph) * 3), y = Math.round(o.y);
        ctx.globalAlpha = wx.oil * 0.8;
        ctx.fillStyle = '#14100a'; ctx.fillRect(x - o.s, y - o.s + 1, o.s * 2, o.s * 2 - 1);
        ctx.fillStyle = hslToHex((t * 60 + o.ph * 50) % 360, 0.7, 0.6); ctx.fillRect(x - o.s + 1, y - o.s + 1, 2, 1);
      }
      ctx.globalAlpha = 1;
    }
  }

  drawFront(ctx, env) {
    const t = this.t, wx = this.wx, q = quality(env);
    this.nearSilt.draw(ctx, t, 0.7 + wx.murk * 0.4, q);
    if (wx.data > 0.05) this.drawDataRain(ctx, wx.data * 0.55, 2, 0.3 * q);
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
    for (const l of this.propLights) lights.push({ x: l.x, y: l.y, r: l.r, color: l.color, a: 0.55 * n * flick });
    for (const s of this.screens) {
      const on = !s.secret || this.secrets().crt;
      if (on) lights.push({ x: s.x + s.w / 2, y: s.y + s.h / 2, r: 46, color: s.secret ? '#8ab8ff' : s.mode === 'fish' ? '#6aa8ff' : '#7affc0', a: 0.6 * n * flick });
    }
    for (let i = 0; i < this.algae.length; i += 3) { const a = this.algae[i]; lights.push({ x: a.x, y: a.y, r: 22, color: a.c, a: 0.4 * n }); }
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
