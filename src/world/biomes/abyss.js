// The Midnight Abyss: no surface, near-black deep blue. The seabed is a perspective voxel canyon: terraced
// strata cliffs close in on both sides and recede to a foggy vanishing point, with ancient ruins (pillars,
// archway, the elder statue head), a giant whale skeleton, crystals, glow shrooms and tube worms placed at
// many depths. A black smoker shimmers, marine snow falls and leviathans glide through the far fog.
// Art is authored "lit": the lighting pass (dark ~0.86) hides it except where the glowing things shine.
// Weathers: still, snow, current, glowtide.

import { Biome } from './base.js';
import { clamp, clamp01, smoothstep, hash2, fbm2, TAU } from '../../core/math.js';
import { RNG } from '../../core/rng.js';
import { pack } from '../../core/color.js';
import { tinted, makeLayer } from '../../core/canvas.js';
import { getProp } from '../../gfx/props.js';
import {
  paint, gradientStrip, stopPalette, ditherPick, FogLayer, fillWith, drawWobble, makeRays, drawGlow, twinkle, Motes,
  Bubbles, Mask, ridge, quality, inRect, Strands, SwayAnim, cloudTile, DepthScene, BandSet, DepthDecor, qscale, hazeMask,
} from '../scenery.js';

const WATER = [[0, '#1c2e60'], [0.3, '#2a4280'], [0.5, '#34529a'], [0.62, '#2c4686'], [0.8, '#1c2e60'], [1, '#101c40']];
const GLYPHS = {
  moon: ['..###..', '.##....', '##.....', '##.....', '##.....', '.##....', '..###..'],
  eye: ['.......', '..###..', '.#...#.', '#..#..#', '.#...#.', '..###..', '.......'],
  wave: ['.......', '.##..##', '#..##..', '.......', '.##..##', '#..##..', '.......'],
  star: ['...#...', '...#...', '#######', '.#####.', '..###..', '.##.##.', '.#...#.'],
};
const GLYPH_IDS = ['moon', 'eye', 'wave', 'star'];
const ORDER = [2, 0, 3, 1]; // wave, moon, star, eye
const STRATA = [[74, 84, 128], [92, 102, 150], [62, 70, 112], [104, 116, 164], [80, 88, 134], [68, 76, 120]];

function glyphSprite(name, color) {
  const rows = GLYPHS[name];
  return paint(7, 7, (x, y) => (rows[y][x] === '#' ? pack(color) : 0));
}

function discSprite(r) {
  const s = r * 2 + 1;
  return paint(s, s, (x, y) => (Math.hypot(x - r, y - r) <= r + 0.2 ? pack('#ffffff') : 0));
}

export class AbyssBiome extends Biome {
  constructor(ocean) {
    super(ocean);
    this.id = 'abyss'; this.name = 'The Midnight Abyss'; this.subtitle = 'Something down here is watching'; this.music = 'abyss';
    this.weathers = [{ id: 'still', name: 'Still Water', weight: 4 }, { id: 'snow', name: 'Marine Snow', weight: 2 }, { id: 'current', name: 'Deep Current', weight: 1.5 }, { id: 'glowtide', name: 'Glow Tide', weight: 0.8 }];
    this.ambient = 'abyss';
    this.fogColor = '#1a2a5a';
    this.fogAmount = 0.7;
    this.t = 0;
    this.wx = { snow: 0, current: 0, glow: 0 };
    this.par = { x: 0, y: 0 };
    this.fresh = true;
    this.seq = [];
    this.solveT = 0;
  }

  baseSurface() { return null; }
  secrets() { return this.game?.state?.secrets || {}; }
  floorAt(x, z = 0) { return this.D ? this.D.floorAt(x, z) : super.floorAt(x); }

  // ------------------------------------------------------------------ build
  build(W, H) {
    this.W = W; this.H = H;
    this.waterStrip = gradientStrip(H, WATER, { levels: 22 });
    this.buildDepth();
    this.buildLayers();
    this.rays = makeRays(W, H, { seed: 31, count: 6, sunX: W * 0.48, sunY: -H * 1.5, minW: 14, maxW: 40, len: 0.8, color: '#6a8ae0', alpha: 0.3, levels: 3 });
    this.buildLife();
    this.fresh = true;
  }

  buildDepth() {
    const W = this.W, H = this.H;
    const D = new DepthScene(W, H, { yFront: H - 68, yFar: H - 160, pad: 24, zFar: 1.9, fogStart: -0.2, fog: 0.95 });
    this.D = D;
    const cx = D.cx;
    const edge = (z, side) => W * (side < 0 ? 0.37 : 0.36) + Math.sin(z * 3.1 + side) * W * 0.025 + (fbm2(z * 2.3, 5.5 + side, 2, 61) - 0.5) * W * 0.07;
    this.edge = edge;
    const floorH = (X, z) => {
      let h = (fbm2(X * 0.005, z * 1.4, 3, 41) - 0.45) * 12;
      h += Math.max(0, fbm2(X * 0.025, z * 4, 2, 42) - 0.62) * 34;
      const rp = Math.sin(z * 40 + fbm2(X * 0.02, z * 2, 2, 43) * 6);
      if (rp > 0.7) h += 2;
      return Math.max(-2, h * (0.45 + 0.55 * smoothstep(0, 0.5, z)));
    };
    const cliff = (X, z) => {
      const side = X < cx ? -1 : 1;
      const over = Math.abs(X - cx) - edge(z, side) - (fbm2(z * 7, side * 3, 2, 62) - 0.5) * 18;
      if (over <= 0) return null;
      if (over < 14) return 36 + Math.round(fbm2(X * 0.05, z * 5, 2, 64) * 6) * 2;
      if (over < 30) return 84;
      if (over < 44) return 132;
      return 560;
    };
    D.terrain({
      cell: 2, dz: 0.02, hstep: 2, ambient: 0.62, diffuse: 0.5, ao: 0.08, jitter: 0.07, wall: 0.8, side: 0.9, crest: 1.15, wallMin: 30, fullHeight: true,
      height: (X, z) => cliff(X, z) ?? floorH(X, z),
      floorHeight: floorH,
      color: (X, z, h) => {
        if (h >= 30) {
          const m = fbm2(X * 0.04, z * 5, 2, 65);
          return m > 0.6 ? [58, 104, 120] : m > 0.4 ? [86, 96, 140] : [70, 78, 120];
        }
        const hs = hash2(Math.floor(X / 2), Math.floor(z * 50), 66);
        if (hs < 0.008) return [70, 66, 96];
        if (hs < 0.012) return [200, 192, 168];
        if (fbm2(X * 0.01 + 3, z * 2.5, 2, 46) > 0.7) return [44, 92, 108];
        const n = fbm2(X * 0.025, z * 4, 2, 45);
        return n < 0.34 ? [54, 62, 98] : n > 0.66 ? [84, 94, 136] : [66, 74, 114];
      },
      glow: (X, z, h) => {
        const hs = hash2(Math.floor(X / 2), Math.floor(z * 50), 67);
        if (h < 30 && hs < 0.004) return hs < 0.002 ? [90, 255, 255] : [200, 122, 255];
        if (h >= 30 && h < 200 && hs < 0.03) return hs < 0.015 ? [90, 255, 220] : [122, 168, 255];
        return null;
      },
      wallColor: (X, z, hp, h) => {
        const band = Math.floor((hp + fbm2(X * 0.015, z * 2, 2, 63) * 30) / 9);
        const c = STRATA[((band % STRATA.length) + STRATA.length) % STRATA.length];
        let k = 1 - smoothstep(40, 520, hp) * 0.45;
        if (hash2(Math.floor(X / 3), Math.floor(hp / 7), 68) < 0.05) k *= 0.6;
        if (hp > h - 3 && h < 300) k *= 1.25;
        return [c[0] * k, c[1] * k, c[2] * k];
      },
    });
    const place = (id, xf, z, base, variant = 0, extra = {}) => {
      const p = getProp(id, { scale: qscale(base * D.s(z)), variant });
      const it = D.add({ sprite: p, x: Math.round(xf * W), z, id, variant, ...extra });
      it.p = p; it.left = it.x - p.ox; it.top = it.y - p.oy; it.s = D.s(z);
      return it;
    };
    const P = [
      // near
      ['crystal_cluster', 0.19, 0.2, 0.85, 0], ['crystal_cluster', 0.82, 0.24, 0.5, 4], ['glow_mushroom', 0.295, 0.1, 0.7, 1], ['tube_worms', 0.43, 0.26, 0.6, 0],
      ['glow_mushroom', 0.76, 0.06, 0.55, 2], ['pillar_broken', 0.17, 0.32, 0.8, 0], ['crystal_cluster', 0.555, 0.3, 0.55, 3],
      // mid
      ['pillar_ruin', 0.285, 0.5, 1.0, 0], ['statue_head', 0.375, 0.44, 1.05, 0], ['vent_chimney', 0.48, 0.46, 0.95, 0], ['tube_worms', 0.515, 0.48, 0.55, 1],
      ['ribcage', 0.62, 0.38, 1.0, 0], ['giant_skull', 0.715, 0.52, 0.85, 0], ['crystal_cluster', 0.575, 0.6, 0.7, 1], ['glow_mushroom', 0.67, 0.62, 0.6, 0],
      ['crystal_cluster', 0.26, 0.64, 0.6, 2],
      // far
      ['arch_ruin', 0.5, 0.98, 1.25, 0], ['pillar_ruin', 0.395, 0.88, 1.2, 0], ['pillar_ruin', 0.61, 0.84, 1.2, 0], ['pillar_broken', 0.36, 1.12, 1.3, 0],
      ['pillar_broken', 0.645, 1.18, 1.3, 0], ['crystal_cluster', 0.44, 1.02, 0.9, 1], ['crystal_cluster', 0.575, 1.25, 1.0, 2], ['glow_mushroom', 0.33, 0.78, 0.8, 0],
      ['statue_head', 0.59, 1.42, 1.5, 0], ['pillar_ruin', 0.47, 1.4, 1.4, 0], ['glow_mushroom', 0.68, 0.95, 0.8, 1],
    ];
    const placed = P.map(([id, xf, z, base, v]) => place(id, xf, z, base, v || 0));
    // glowing growths on the canyon terraces
    this.ledges = [];
    const lr = new RNG(77);
    for (const z of [0.08, 0.36, 0.62, 0.9, 1.15]) {
      for (const side of [-1, 1]) {
        const e = edge(z, side);
        const X = cx + side * (e + 22), s = D.s(z);
        const x = cx + (X - cx) * s, y = D.y(z, 84);
        if (x < 8 || x > W - 8) continue;
        const kind = lr.pick(['glow_mushroom', 'tube_worms', 'crystal_cluster']);
        const it = place(kind, x / W, z, 0.45, lr.int(0, 4), { y: y + 1 });
        this.ledges.push({ x, y: y - 6 * s, z, c: lr.pick(['#5affff', '#c87aff', '#7affb0', '#ff7ab0', '#7aa8ff']), ph: lr.float(0, TAU), it });
      }
    }
    // glyph stones (the secret) near the front
    this.stones = [[0.245, 0.06, 0], [0.385, 0.12, 1], [0.5, 0.04, 2], [0.625, 0.1, 0]].map(([xf, z, v], i) => {
      const it = place('glyph_stone', xf, z, 0.45, v);
      it.glyph = i; it.lit = 0;
      it.cx = it.x; it.cy = it.top + Math.round(it.p.h * 0.22);
      it.rect = { x: it.left + 2, y: it.top + 2, w: it.p.w - 4, h: it.p.oy - 2 };
      return it;
    });
    D.render([{ key: 'day', strip: this.waterStrip }]);
    this.bands = new BandSet(D);
    this.hazeY = Math.round(D.hz - 30);
    this.haze = new FogLayer(hazeMask(W, 76, { peak: 0.5, alpha: 0.8 }), 0, this.hazeY);
    this.floor = new Float32Array(W + 1);
    for (let x = 0; x <= W; x++) this.floor[x] = D.floorAt(x, 0);
    const all = D.items;
    this.glows = all.filter((q) => q.p?.glow).map((q) => ({ c: q.p.glow, x: q.left, y: q.top, id: q.id, band: q.band, a: 1 - D.fog(q.z) * 0.75, ph: hash2(q.x, 2, 9) * TAU }));
    this.propLights = [];
    for (const q of all) {
      if (!q.p || q.id === 'glyph_stone' || q.z > 0.7 || this.ledges.some((lp) => lp.it === q)) continue;
      const ls = q.p.lights.slice().sort((a, b) => b.r - a.r).slice(0, q.id === 'statue_head' && q.z < 1 ? 2 : 1);
      for (const l of ls) this.propLights.push({ x: q.left + l.x, y: q.top + l.y, r: clamp(l.r * 1.2 + 14, 26, 70) * (0.55 + 0.45 * q.s), color: l.color, id: q.id, a: 1 - D.fog(q.z) * 0.8, ph: hash2(q.x, l.x, 3) * TAU, z: q.z });
    }
    // keep the strongest, nearest emitters as real lights (the rest glow via bloom sprites)
    this.propLights.sort((a, b) => b.r * b.a - a.r * a.a);
    this.propLights.length = Math.min(this.propLights.length, 11);
    const find = (id, band) => placed.find((q) => q.id === id && (band === undefined || q.band === band));
    this.statue = find('statue_head', 1);
    this.vent = find('vent_chimney');
    this.pillar = find('pillar_ruin', 1);
    this.glyphSpr = GLYPH_IDS.map((n) => glyphSprite(n, '#7affff'));
    this.glyphDim = GLYPH_IDS.map((n) => glyphSprite(n, '#3a7a9a'));
    const pl = this.pillar;
    this.pillarGlyphs = ORDER.map((gi, k) => ({ gi, x: pl.x - 3, y: Math.round(pl.top + 16 * pl.s + k * 9) }));
    this.statueRect = { x: this.statue.left + 12, y: this.statue.top + 8, w: this.statue.p.w - 24, h: this.statue.p.oy - 14 };
  }

  buildLayers() {
    const W = this.W, H = this.H, pad = 30, D = this.D;
    this.pad = pad;
    const LW = W + pad * 2;
    const r = new RNG(13);
    const hz = D.hz;
    // --- far A: a stepped temple and a colonnade at the canyon's end
    const yA = Math.round(hz - H * 0.36), hA = H - yA;
    const mA = new Mask(LW, hA);
    const baseA = hz - yA + 10;
    const rA = ridge(LW, baseA - 26, 16, 0.006, 5.1, 4, 0.3);
    mA.below((x) => rA[x]);
    const tx = LW * 0.52, ty = baseA - 18;
    for (let k = 0; k < 6; k++) mA.rect(tx - 80 + k * 13, ty - (k + 1) * 13, 160 - k * 26, 14);
    mA.rect(tx - 11, ty - 104, 22, 28); mA.rect(tx - 5, ty - 96, 10, 20, 0);
    for (let k = 0; k < 7; k++) { const cxx = LW * 0.3 + k * 15, cy = baseA - 16, hh = k % 3 === 1 ? 24 : 48; mA.rect(cxx, cy - hh, 6, hh); mA.rect(cxx - 2, cy - hh - 3, 10, 3); }
    mA.rect(LW * 0.3 - 4, baseA - 70, 112, 4);
    for (let i = 0; i < 4; i++) { const px = r.float(0.3, 0.75) * LW, top = r.float(20, baseA - 90); mA.poly([[px - 22, baseA], [px - 6, top + 10], [px + 2, top], [px + 9, top + 14], [px + 24, baseA]]); }
    const palA = stopPalette([[0, '#0a1230'], [1, '#1c2a58']], 5);
    this.farA = new FogLayer(mA.toCanvas((x, y, v, up) => (up <= 1 ? pack('#4a6ab0') : ditherPick(palA, 0.7 - Math.min(1, up / 60) * 0.5 + (fbm2(x * 0.05, y * 0.05, 2, 2) - 0.5) * 0.35, x, y))), -pad, yA);
    this.farAY = yA;
    // --- far B: broken arches & pillars on the horizon
    const yB = Math.round(hz - 120), hB = H - yB;
    const mB = new Mask(LW, hB);
    const baseB = hz - yB + 16;
    const rB = ridge(LW, baseB - 6, 8, 0.01, 2.6, 3);
    mB.below((x) => rB[x]);
    for (let i = 0; i < 6; i++) {
      const px = r.float(0.32, 0.72) * LW, base = rB[Math.round(px)] + 2, hh = r.float(30, 70);
      if (r.chance(0.5)) { mB.rect(px - 4, base - hh, 8, hh); mB.rect(px - 7, base - hh - 3, 14, 3); }
      else { const aw = r.float(20, 32); mB.ellipse(px, base - hh * 0.8, aw, hh * 0.55); mB.ellipse(px, base - hh * 0.72, aw * 0.6, hh * 0.42, 0); mB.rect(px - aw * 0.6, base - hh * 0.72, aw * 1.2, hh, 0); mB.rect(px - aw, base - hh * 0.8, aw * 0.4, hh * 0.8 + 2); mB.rect(px + aw * 0.6, base - hh * 0.8, aw * 0.4, hh * 0.8 + 2); }
    }
    const palB = stopPalette([[0, '#080e26'], [1, '#18244c']], 5);
    this.farB = new FogLayer(mB.toCanvas((x, y, v, up) => (up <= 1 ? pack('#5a7ac0') : up === 2 ? pack('#2a3a70') : ditherPick(palB, 0.7 - Math.min(1, up / 40) * 0.5 + (fbm2(x * 0.08, y * 0.08, 2, 5) - 0.5) * 0.4, x, y))), -pad, yB);
    this.farBY = yB;
  }

  buildLife() {
    const W = this.W, H = this.H, D = this.D;
    const r = new RNG(29);
    this.decor = new DepthDecor(D);
    this.snow = new Motes(150, { x0: 0, y0: -10, x1: W, y1: H }, { seed: 5, vx: [-1.5, 1.5], vy: [5, 11], sizes: [1, 1, 1, 2], colors: ['#c8d4f0', '#a8b8e0', '#e8eeff'], alpha: [0.25, 0.7], wob: 3 });
    this.nearSnow = new Motes(40, { x0: 0, y0: -10, x1: W, y1: H }, { seed: 6, vx: [-2, 2], vy: [8, 16], sizes: [2, 2, 3], colors: ['#c8d4f0', '#e8eeff'], alpha: [0.12, 0.35], wob: 5 });
    this.sparks = new Motes(70, { x0: 0, y0: 20, x1: W, y1: H - 40 }, { seed: 7, vx: [-1, 1], vy: [-1.5, 1], sizes: [1], colors: ['#5affff', '#c87aff', '#7affb0', '#7aa8ff'], alpha: [0.5, 1], wob: 6 });
    this.bubbles = new Bubbles(50, '#c8d8ff');
    this.smoke = [];
    for (let i = 0; i < 18; i++) this.smoke.push({ k: i / 18, ph: r.float(0, TAU), s: r.float(0.7, 1.3) });
    this.puff = [2, 3, 4, 5, 6, 7, 8].map((rr) => tinted(discSprite(rr), '#0a0a12'));
    // bioluminescent tendrils hanging from the cliff faces
    this.tendrils = [];
    for (const [side, yf, n, z] of [[-1, 0.12, 16, 0.12], [-1, 0.22, 11, 0.2], [1, 0.1, 14, 0.14], [1, 0.2, 9, 0.24], [-1, 0.3, 12, 0.55], [1, 0.32, 10, 0.6]]) {
      const s = D.s(z), X = D.cx + side * (this.edge(z, side) + 50), x = Math.round(D.cx + (X - D.cx) * s), y = Math.round(H * yf);
      if (x < 4 || x > W - 4) continue;
      const st = new Strands();
      st.add({ x, y, n, seg: Math.max(2, Math.round(4 * s)), down: true, w: 1, amp: 0.12, speed: 0.7, sec: 1, phase: x * 0.1, wave: 0.2, cols: ['#2a4a7a', '#3a7aaa', '#5ac8e8'], out: null, hl: false, tip: '#bfffff', tipR: 1 });
      const anim = new SwayAnim(st, { frames: 20 });
      this.decor.add({ anim, z, off: x % 20, fogMul: 0.5 });
      this.tendrils.push({ tip: { x, y: y + n * st.list[0].seg }, z });
    }
    this.decor.refog(() => '#1a2c5c', 'k');
    // leviathans gliding in the far fog
    this.disc = [];
    for (let rr = 1; rr <= 30; rr++) this.disc.push(discSprite(rr));
    this.levi = { x: W * 0.62, y: D.hz - 120, dir: 1, v: 6, len: 420, rmax: 11, ph: 0 };
    this.leviT = 0;
    this.current = cloudTile(320, 120, '#8aa8e8', { seed: 4, alpha: 0.12, scale: 0.03, bias: 0.55, levels: 3 });
    this.glowCloud = cloudTile(320, 200, '#5affe0', { seed: 8, alpha: 0.18, scale: 0.025, bias: 0.55, levels: 3 });
    this.hint = 0;
  }

  // ------------------------------------------------------------------ update
  update(dt, env) {
    dt = Math.max(0, Math.min(dt, 0.1));
    this.t += dt;
    const W = this.W, H = this.H;
    const snap = this.fresh;
    const k = snap ? 1 : 1 - Math.exp(-dt * 0.6);
    const w = env.weather, wx = this.wx;
    wx.snow += ((w === 'snow' ? 1 : 0) - wx.snow) * k;
    wx.current += ((w === 'current' ? 1 : 0) - wx.current) * k;
    wx.glow += ((w === 'glowtide' ? 1 : 0) - wx.glow) * k;
    const c = env.cursor;
    const tx = c && c.x > -50 ? (c.x / W - 0.5) * -2 : 0, ty = c && c.y > -50 ? (c.y / H - 0.5) * -2 : 0;
    const kp = snap ? 1 : 1 - Math.exp(-dt * 2.5);
    this.par.x += (tx - this.par.x) * kp;
    this.par.y += (ty - this.par.y) * kp;
    this.fresh = false;
    const drift = wx.current * 34;
    this.snow.update(dt * (1 + wx.snow * 0.6), drift, 0);
    this.nearSnow.update(dt * (1 + wx.snow * 0.6), drift * 1.4, 0);
    this.sparks.update(dt, drift * 0.6, 0);
    this.bubbles.update(dt, -20);
    for (const b of this.bubbles.list) b.x += drift * 0.5 * dt;
    if (Math.random() < dt * 2.2) this.bubbles.emit(this.vent.x + (Math.random() - 0.5) * 6, this.vent.top + 8, { r: Math.random() < 0.3 ? 2 : 1, vy: -26 });
    const L = this.levi;
    if (L) {
      L.x += L.dir * L.v * dt * (1 + wx.current * 0.5);
      L.ph += dt * 0.5;
      if ((L.dir > 0 && L.x - L.len > W + 60) || (L.dir < 0 && L.x + L.len < -60)) { this.levi = null; this.leviT = 30 + Math.random() * 50; }
    } else {
      this.leviT -= dt;
      if (this.leviT <= 0) {
        const dir = Math.random() < 0.5 ? 1 : -1, len = 420 + Math.random() * 260;
        this.levi = { x: dir > 0 ? -40 : W + 40, y: this.D.hz - 90 - Math.random() * 90, dir, v: 6 + Math.random() * 4, len, rmax: 9 + Math.random() * 5, ph: 0 };
      }
    }
    for (const s of this.stones) s.lit = Math.max(this.secrets().glyphs ? 1 : 0, s.lit - dt * 0.15 * (this.seq.length ? 0 : 1));
    this.solveT = Math.max(0, this.solveT - dt);
    this.hint += dt;
    env.flash = 0;
  }

  // ------------------------------------------------------------------ draw
  drawBack(ctx, env) {
    this.nearHooked = !!this.nearSeen;
    this.nearSeen = false;
    const W = this.W, H = this.H, t = this.t, wx = this.wx;
    fillWith(ctx, this.waterStrip, 0, -10, W, H + 10);
    const px = this.par.x, py = this.par.y;
    const wob = quality(env) >= 1 ? 1 : 0;
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.5 + 0.2 * Math.sin(t * 0.2);
    ctx.drawImage(this.rays, Math.round(Math.sin(t * 0.03) * 20), -20);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    drawWobble(ctx, this.farA.tint(this.waterStrip, 0.66, 'a'), -this.pad + px * 0.8, this.farAY + py * 0.4, t, wob, 4, 0.6, 0.06);
    this.drawLeviathan(ctx);
    drawWobble(ctx, this.farB.tint(this.waterStrip, 0.5, 'b'), -this.pad + px * 1.4, this.farBY + py * 0.5, t + 2, wob, 4, 0.8, 0.08);
    if (wx.current > 0.05) {
      const pat = ctx.createPattern(this.current, 'repeat');
      pat.setTransform(new DOMMatrix([1, 0, 0, 1, Math.round(t * 60), 0]));
      ctx.globalAlpha = wx.current;
      ctx.fillStyle = pat;
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
    }
    this.paintBand(ctx, 2, px * 2, py * 0.6);
    ctx.drawImage(this.haze.tint(this.waterStrip, 1, 'h'), 0, this.hazeY);
  }

  // The leviathan is composited opaque offscreen, then laid into the fog as one translucent silhouette.
  drawLeviathan(ctx) {
    const L = this.levi;
    if (!L) return;
    const W = this.W, t = this.t, n = 52;
    if (!this.leviLayer) this.leviLayer = makeLayer(W, 120);
    const g = this.leviLayer.ctx, oy = Math.round(L.y - 60);
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    g.clearRect(0, 0, W, 120);
    const pts = [];
    for (let i = 0; i < n; i++) {
      const u = i / (n - 1);
      const x = L.x - L.dir * u * L.len + this.par.x;
      const y = 60 + Math.sin(L.ph * 2 - u * 9) * 15 * (0.2 + u) + this.par.y * 0.4;
      const rr = Math.max(1, Math.round(L.rmax * (u < 0.1 ? 0.8 + u * 2 : 1 - Math.pow((u - 0.1) / 0.9, 1.3) * 0.9)));
      pts.push([x, y, rr]);
    }
    for (let i = n - 1; i >= 0; i--) {
      const [x, y, rr] = pts[i];
      if (x < -40 || x > W + 40) continue;
      g.drawImage(this.disc[Math.min(29, rr - 1)], Math.round(x - rr), Math.round(y - rr));
    }
    g.fillStyle = '#ffffff';
    for (let k = 0; k < 4; k++) {
      const [fx, fy, fr] = pts[5 + k * 9];
      const h = Math.round(fr * 0.9 + 3);
      for (let j = 0; j < h; j++) g.fillRect(Math.round(fx - L.dir * j * 0.6) - 2, Math.round(fy - fr - j), 4 - Math.floor(j / 3), 1);
    }
    const [hx, hy, hr] = pts[0];
    g.fillRect(Math.round(hx + L.dir * hr * 0.4), Math.round(hy + hr * 0.3), Math.round(L.dir * (hr + 4)), 2);
    // a long lure on a stalk
    for (let j = 0; j < 14; j++) g.fillRect(Math.round(hx + L.dir * (hr * 0.3 + j * 0.9)), Math.round(hy - hr - Math.sin((j / 14) * Math.PI) * 6 - j * 0.3), 1, 1);
    g.globalCompositeOperation = 'source-in';
    g.fillStyle = '#0a1230';
    g.fillRect(0, 0, W, 120);
    g.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 0.6;
    ctx.drawImage(this.leviLayer.canvas, 0, oy);
    ctx.globalAlpha = 1;
    // photophores and the lure glow
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = '#5affff';
    for (let i = 3; i < n - 8; i += 4) {
      const [x, y, rr] = pts[i];
      ctx.globalAlpha = 0.2 + (0.5 + 0.5 * Math.sin(t * 2 + i * 0.6)) * 0.4;
      ctx.fillRect(Math.round(x), Math.round(oy + y + rr * 0.4), 1, 1);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    const lx = hx + L.dir * (hr * 0.3 + 13 * 0.9), ly = oy + hy - hr - 4;
    drawGlow(ctx, lx, ly, 6, '#9affff', 0.5 + 0.3 * Math.sin(t * 3));
  }

  drawSeabed(ctx, env) {
    const t = this.t, wx = this.wx, q = quality(env);
    this.snow.draw(ctx, t, 0.75 + wx.snow * 0.3, q * (0.55 + wx.snow * 0.45), 0.2);
    this.paintBand(ctx, 1, this.par.x * 3, this.par.y * 0.8);
    if (!this.nearHooked) this.paintNear(ctx, env);
  }

  // Near band: called by the game after the mid fish (falls back to drawSeabed when not hooked).
  drawNear(ctx, env) {
    this.nearSeen = true;
    if (this.nearHooked) this.paintNear(ctx, env);
  }

  paintNear(ctx) {
    this.paintBand(ctx, 0, this.par.x * 4, this.par.y);
    this.bubbles.draw(ctx, this.t);
  }

  paintBand(ctx, b, dx, dy) {
    const t = this.t, wx = this.wx;
    this.bands.draw(ctx, b, null, dx, dy);
    ctx.save();
    ctx.translate(Math.round(dx), Math.round(dy));
    const gk = 1 + wx.glow * 0.8;
    ctx.globalCompositeOperation = 'lighter';
    for (const gl of this.glows) {
      if (gl.band !== b) continue;
      ctx.globalAlpha = clamp01((0.38 + 0.18 * Math.sin(t * 1.1 + gl.ph)) * gk * gl.a);
      ctx.drawImage(gl.c, gl.x, gl.y);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    for (const lp of this.ledges) if (lp.it.band === b) drawGlow(ctx, lp.x, lp.y, Math.round(6 * this.D.s(lp.z)) + 2, lp.c, (0.35 + 0.2 * Math.sin(t + lp.ph)) * gk * (1 - this.D.fog(lp.z) * 0.6));
    if (this.vent.band === b) this.drawVent(ctx);
    if (this.pillar.band === b) this.drawPillarGlyphs(ctx);
    if (b === 0) this.drawStones(ctx);
    ctx.restore();
    this.decor.draw(ctx, b, t, dx, dy);
  }

  drawVent(ctx) {
    const v = this.vent, t = this.t, wx = this.wx, s = v.s;
    const x0 = v.x + 2 * s, y0 = v.top + 6 * s;
    for (const p of this.smoke) {
      const k = (p.k + t * 0.07) % 1;
      const y = y0 - k * 150 * s;
      const x = x0 + Math.sin(t * 0.8 + p.ph + k * 4) * (3 + k * 14) * s + wx.current * k * 60;
      const ri = clamp(Math.floor(k * 7 * p.s * s), 0, 6);
      ctx.globalAlpha = (1 - k) * 0.7;
      const spr = this.puff[ri];
      ctx.drawImage(spr, Math.round(x - spr.width / 2), Math.round(y - spr.height / 2));
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = '#ff9a5a';
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 22; j++) {
        const k = (j / 22 + t * 0.4 + i * 0.25) % 1;
        const y = y0 - k * 70 * s;
        const x = x0 - 6 * s + i * 4 * s + Math.sin(y * 0.25 + t * 4 + i) * 2;
        ctx.globalAlpha = (1 - k) * 0.22;
        ctx.fillRect(Math.round(x), Math.round(y), 1, 2);
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    drawGlow(ctx, x0, y0 + 2, 8, '#ffb060', 0.5 + 0.2 * Math.sin(t * 7));
  }

  drawPillarGlyphs(ctx) {
    const t = this.t, solved = !!this.secrets().glyphs;
    const ph = t % 6;
    for (let k = 0; k < this.pillarGlyphs.length; k++) {
      const pg = this.pillarGlyphs[k];
      const on = solved ? 0.8 + 0.2 * Math.sin(t * 2 + k) : ph > k + 0.5 && ph < k + 1.4 ? 1 : 0.25;
      ctx.globalAlpha = on;
      ctx.drawImage(on > 0.5 ? this.glyphSpr[pg.gi] : this.glyphDim[pg.gi], pg.x, pg.y);
      if (on > 0.5) drawGlow(ctx, pg.x + 3, pg.y + 3, 8, '#5affff', on * 0.7);
    }
    ctx.globalAlpha = 1;
    if (!solved) {
      const p = (this.hint % 7) / 7;
      if (p < 0.1) twinkle(ctx, this.pillarGlyphs[0].x + 8, this.pillarGlyphs[0].y - 4, Math.sin((p / 0.1) * Math.PI), '#c8ffff');
    }
  }

  drawStones(ctx) {
    const solved = !!this.secrets().glyphs;
    for (const s of this.stones) {
      const k = solved ? 1 : s.lit;
      ctx.globalAlpha = 0.35 + k * 0.65;
      ctx.drawImage(k > 0.3 ? this.glyphSpr[s.glyph] : this.glyphDim[s.glyph], s.cx - 3, s.cy - 3);
      ctx.globalAlpha = 1;
      if (k > 0.05) drawGlow(ctx, s.cx, s.cy, 10, '#5affff', k * 0.8);
    }
  }

  drawFront(ctx, env) {
    const t = this.t, wx = this.wx, q = quality(env), W = this.W, H = this.H;
    this.nearSnow.draw(ctx, t, 0.8 + wx.snow * 0.5, q * (0.4 + wx.snow * 0.6));
    const n = Math.round(this.sparks.list.length * q * (0.35 + wx.glow * 0.65));
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < n; i++) {
      const p = this.sparks.list[i];
      const k = 0.5 + 0.5 * Math.sin(t * p.tw + p.ph);
      if (k < 0.3) continue;
      const x = p.x + Math.sin(t * 0.6 + p.ph) * 5, y = p.y + Math.cos(t * 0.4 + p.ph) * 3;
      ctx.globalAlpha = k * (0.4 + wx.glow * 0.6);
      ctx.fillStyle = p.c;
      ctx.fillRect(Math.round(x), Math.round(y), 1, 1);
      if (wx.glow > 0.3 && i % 3 === 0) drawGlow(ctx, x, y, 3, p.c, k * wx.glow * 0.6);
    }
    ctx.globalAlpha = 1;
    if (wx.glow > 0.05) {
      const pat = ctx.createPattern(this.glowCloud, 'repeat');
      pat.setTransform(new DOMMatrix([1, 0, 0, 1, Math.round(t * 8), Math.round(Math.sin(t * 0.2) * 20)]));
      ctx.globalAlpha = wx.glow * (0.35 + 0.15 * Math.sin(t * 0.7));
      ctx.fillStyle = pat;
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
    }
    if (this.secrets().glyphs || this.solveT > 0) {
      const k = this.solveT > 0 ? 1 : 0.5 + 0.2 * Math.sin(t * 1.5);
      for (const l of this.propLights) if (l.id === 'statue_head' && l.r < 60 && l.z < 1) drawGlow(ctx, l.x, l.y, 7, '#9affff', k);
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  // ------------------------------------------------------------------ lighting
  lighting() {
    const wx = this.wx, t = this.t, D = this.D;
    const g = wx.glow;
    const dark = 0.86 - g * 0.12;
    const W = this.W;
    const lights = [];
    void W;
    for (const l of this.propLights) {
      const pulse = 0.85 + 0.15 * Math.sin(t * 1.3 + l.ph);
      lights.push({ x: l.x, y: l.y, r: l.r, color: l.color, a: clamp01((0.8 + g * 0.45) * pulse * l.a) });
    }
    const v = this.vent;
    lights.push({ x: v.x + 2, y: v.top + 10, r: 70 * v.s, color: '#ff8a3a', a: (0.75 + 0.15 * Math.sin(t * 6.3)) * (1 - D.fog(v.z) * 0.6) });
    for (const lp of this.ledges) if (lp.z < 0.5) lights.push({ x: lp.x, y: lp.y, r: 40 * D.s(lp.z), color: lp.c, a: (0.6 + 0.2 * Math.sin(t + lp.ph) + g * 0.2) * (1 - D.fog(lp.z) * 0.7) });
    const solved = !!this.secrets().glyphs;
    for (const s of this.stones) if (solved || s.lit > 0.05) lights.push({ x: s.cx, y: s.cy, r: 24 + s.lit * 20, color: '#5affff', a: solved ? 0.7 : s.lit * 0.85 });
    const pg = this.pillarGlyphs[1];
    lights.push({ x: pg.x + 3, y: pg.y + 10, r: 30, color: '#5affff', a: 0.45 });
    if (solved || this.solveT > 0) lights.push({ x: this.statue.x, y: this.statue.top + this.statue.p.h * 0.45, r: 80, color: '#9affff', a: this.solveT > 0 ? 1 : 0.5 });
    return { dark, tint: '#060c26', lights };
  }

  // ------------------------------------------------------------------ secrets
  secretAt(x, y) {
    for (let i = 0; i < this.stones.length; i++) if (inRect(x, y, this.stones[i].rect)) return 'glyph' + i;
    if (inRect(x, y, this.statueRect)) return 'statue';
    return null;
  }

  onSecret(id, game) {
    const st = game.state;
    st.secrets ||= {};
    const audio = game.audio;
    if (id === 'statue') {
      audio?.play?.('magic', { vol: 0.4, pitch: 0.6 });
      game.toast?.(st.secrets.glyphs ? 'The elder head hums with ancient approval.' : 'The elder head murmurs: "The pillar remembers the way. Wake the stones as it shows."', 'eye');
      return;
    }
    if (!id.startsWith('glyph')) return;
    const s = this.stones[Number(id.slice(5))];
    if (!s) return;
    if (st.secrets.glyphs) { s.lit = 1; audio?.play?.('sparkle', { vol: 0.4 }); return; }
    const want = ORDER[this.seq.length];
    if (s.glyph === want) {
      this.seq.push(s.glyph);
      s.lit = 1;
      audio?.play?.('sparkle', { pitch: 0.8 + this.seq.length * 0.15 });
      if (this.seq.length === ORDER.length) {
        st.secrets.glyphs = true;
        st.baits ||= {};
        st.baits.relic = (st.baits.relic || 0) + 1;
        this.solveT = 3;
        this.seq = [];
        audio?.play?.('magic');
        game.toast?.('The glyphs blaze awake! An Ancient Relic rises from the silt...', 'star');
        game.save?.();
      }
    } else {
      this.seq = [];
      for (const q of this.stones) q.lit = 0;
      audio?.play?.('ui_error', { vol: 0.5 });
      game.toast?.('The stones fall dark again.', 'info');
    }
  }
}
