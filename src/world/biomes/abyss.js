// The Midnight Abyss: no surface, near-black deep blue. Enormous strata cliffs frame the view, ancient
// ruins (pillars, archway, the elder statue head), a giant whale skeleton, crystals, glow shrooms and
// tube worms light the dark, a black smoker vent shimmers, marine snow falls and leviathans glide
// through the far fog. Art is authored "lit": the lighting pass (dark ~0.85) hides it except where
// the many glowing things shine. Weathers: still, snow, current, glowtide.

import { Biome } from './base.js';
import { clamp, clamp01, lerp, smoothstep, hash2, fbm2, TAU } from '../../core/math.js';
import { RNG } from '../../core/rng.js';
import { mix, rgba, pack } from '../../core/color.js';
import { makeCanvas, ctxOf, tinted } from '../../core/canvas.js';
import { getProp } from '../../gfx/props.js';
import {
  paint, gradientStrip, stopPalette, ditherPick, FogLayer, fillWith, drawWobble, makeRays, drawGlow, twinkle, Motes,
  Bubbles, Mask, ridge, voxelGround, quality, inRect, Strands, SwayAnim, cloudTile, glowSprite,
} from '../scenery.js';

const WATER = [[0, '#1a2c5c'], [0.3, '#22386e'], [0.5, '#26407a'], [0.75, '#1a2c5a'], [1, '#101c40']];
const GLYPHS = {
  moon: ['..###..', '.##....', '##.....', '##.....', '##.....', '.##....', '..###..'],
  eye: ['.......', '..###..', '.#...#.', '#..#..#', '.#...#.', '..###..', '.......'],
  wave: ['.......', '.##..##', '#..##..', '.......', '.##..##', '#..##..', '.......'],
  star: ['...#...', '...#...', '#######', '.#####.', '..###..', '.##.##.', '.#...#.'],
};
const GLYPH_IDS = ['moon', 'eye', 'wave', 'star'];
const ORDER = [2, 0, 3, 1]; // wave, moon, star, eye

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
    this.fogAmount = 0.8;
    this.t = 0;
    this.wx = { snow: 0, current: 0, glow: 0 };
    this.par = { x: 0, y: 0 };
    this.fresh = true;
    this.seq = [];
    this.solveT = 0;
  }

  baseSurface() { return null; }
  secrets() { return this.game?.state?.secrets || {}; }

  // ------------------------------------------------------------------ build
  build(W, H) {
    this.W = W; this.H = H;
    this.waterStrip = gradientStrip(H, WATER, { levels: 22 });
    this.buildGround();
    this.buildLayers();
    this.rays = makeRays(W, H, { seed: 31, count: 6, sunX: W * 0.45, sunY: -H * 1.5, minW: 14, maxW: 40, len: 0.8, color: '#6a8ae0', alpha: 0.3, levels: 3 });
    this.buildLife();
    this.fresh = true;
  }

  buildGround() {
    const W = this.W, H = this.H;
    const backY = H - 70;
    const dockX = W - 270;
    const g = voxelGround(W, H, {
      vs: 2, backY, baseH: 5, ny: 22, pitch: 27, render: { depthLines: false, edges: 0.7, sideEdges: 0.2 },
      height: (x, z) => {
        const sx = x * 2;
        let h = 5 + (fbm2(sx * 0.007, z * 0.025, 3, 41) - 0.5) * 7;
        h += (1 - smoothstep(0, W * 0.16, sx)) * 5 + smoothstep(W * 0.86, W, sx) * 4;
        h = lerp(h, 5.5 + (fbm2(sx * 0.01, z * 0.03, 2, 4) - 0.5) * 2, smoothstep(dockX - 40, dockX + 20, sx) * (1 - smoothstep(W * 0.9, W, sx)));
        const rp = Math.sin(z * 0.5 + fbm2(sx * 0.02, z * 0.04, 2, 43) * 5);
        if (rp > 0.7) h += 1;
        return h;
      },
      palette: (m) => ({
        silt: m.color('#414a72', { jitter: 0.18 }), silt2: m.color('#363e62', { jitter: 0.2 }), pale: m.color('#545e88', { jitter: 0.15 }),
        dark: m.color('#2a3050', { jitter: 0.2 }), rock: m.color('#3a3858', { jitter: 0.3 }), bone: m.color('#c8c0a8', { jitter: 0.1 }),
        cyan: m.color('#5affff', { emissive: 0.9, jitter: 0.05 }), violet: m.color('#c87aff', { emissive: 0.9, jitter: 0.05 }), moss: m.color('#2a5a6a', { jitter: 0.2 }),
      }),
      color: (x, y, z, h, p) => {
        if (y < h - 1) return p.dark;
        const n = fbm2(x * 0.05, z * 0.08, 2, 45);
        if (fbm2(x * 0.02 + 3, z * 0.05, 2, 46) > 0.72) return p.moss;
        if (n < 0.34) return p.silt2;
        if (n > 0.68) return p.pale;
        return p.silt;
      },
      decorate: (m, p, H2) => {
        const r = new RNG(91);
        const nz = Math.round(m.nz * 0.62);
        for (let i = 0; i < 60; i++) { const x = r.int(2, m.nx - 3), z = r.int(1, nz), h = H2(x, z); m.set(x, h, z, p.rock); if (r.chance(0.6)) m.set(x + 1, h, z, p.rock); if (r.chance(0.3)) m.set(x, h + 1, z, p.rock); }
        for (let i = 0; i < 26; i++) { const x = r.int(2, m.nx - 6), z = r.int(1, nz), h = H2(x, z); const L = r.int(2, 5); for (let k = 0; k < L; k++) m.set(x + k, h, z + (k > 2 ? 1 : 0), p.bone); }
        for (let i = 0; i < 46; i++) { const x = r.int(2, m.nx - 3), z = r.int(1, nz), h = H2(x, z); m.set(x, h, z, r.chance(0.6) ? p.cyan : p.violet); }
      },
    });
    this.ground = g;
    this.floor = g.floor;
    const P = [
      ['pillar_ruin', 0.245, 0.0, 0.85, 0], ['pillar_broken', 0.15, 0.1, 0.75, 0], ['arch_ruin', 0.5, 0.0, 0.8, 0], ['pillar_ruin', 0.77, 0.0, 0.62, 0],
      ['statue_head', 0.345, 0.12, 0.85, 0], ['vent_chimney', 0.455, 0.08, 0.8, 0], ['ribcage', 0.6, 0.04, 0.85, 0], ['giant_skull', 0.7, 0.2, 0.7, 0],
      ['tube_worms', 0.425, 0.3, 0.6, 0], ['tube_worms', 0.49, 0.34, 0.5, 1], ['crystal_cluster', 0.19, 0.34, 0.85, 0], ['crystal_cluster', 0.545, 0.4, 0.7, 3],
      ['crystal_cluster', 0.865, 0.12, 0.55, 1], ['crystal_cluster', 0.095, 0.44, 0.5, 4], ['glow_mushroom', 0.285, 0.42, 0.7, 1], ['glow_mushroom', 0.655, 0.4, 0.65, 0],
      ['glow_mushroom', 0.93, 0.3, 0.5, 2], ['glow_mushroom', 0.04, 0.2, 0.55, 0],
    ];
    const placed = P.map(([id, xf, zf, scale, variant]) => {
      const p = getProp(id, { scale, variant });
      const x = Math.round(xf * W), y = Math.round(g.surfaceY(x, zf)) + 1;
      return { id, p, x, y, zf, variant, top: y - p.oy, left: x - p.ox };
    });
    // glyph stones (secret) join the depth sort
    this.stones = [[0.235, 0.47, 0], [0.385, 0.44, 1], [0.505, 0.48, 2], [0.6, 0.46, 0]].map(([xf, zf, v], i) => {
      const p = getProp('glyph_stone', { scale: 0.42, variant: v });
      const x = Math.round(xf * W), y = Math.round(g.surfaceY(x, zf)) + 1;
      const q = { id: 'glyph_stone', p, x, y, zf, top: y - p.oy, left: x - p.ox, glyph: i, lit: 0 };
      placed.push(q);
      return q;
    });
    placed.sort((a, b) => a.zf - b.zf);
    this.placed = placed;
    let top = Math.min(...placed.map((q) => q.top));
    for (let x = 0; x <= W; x++) top = Math.min(top, g.floor[x] - 2);
    top = Math.floor(top) - 4;
    this.bedY = top;
    const bed = makeCanvas(W, H - top);
    const bg = ctxOf(bed);
    bg.drawImage(g.canvas, g.x, g.y - top);
    const fy = Math.round(backY - top - 8);
    const hz = bg.createLinearGradient(0, fy, 0, fy + 26);
    hz.addColorStop(0, 'rgba(30,48,100,0.65)');
    hz.addColorStop(1, 'rgba(30,48,100,0)');
    bg.globalCompositeOperation = 'source-atop';
    bg.fillStyle = hz;
    bg.fillRect(0, fy, W, 26);
    bg.globalCompositeOperation = 'source-over';
    for (const q of placed) bg.drawImage(q.p.canvas, q.left, q.top - top);
    this.bed = bed;
    this.groundGlow = g.glow;
    this.glows = placed.filter((q) => q.p.glow).map((q) => ({ c: q.p.glow, x: q.left, y: q.top, id: q.id, ph: hash2(q.x, 2, 9) * TAU }));
    // lights from emissive props
    this.propLights = [];
    for (const q of placed) {
      if (q.id === 'glyph_stone') continue;
      const ls = q.p.lights.slice().sort((a, b) => b.r - a.r).slice(0, q.id === 'arch_ruin' || q.id === 'statue_head' ? 2 : 1);
      for (const l of ls) this.propLights.push({ x: q.left + l.x, y: q.top + l.y, r: clamp(l.r * 1.4 + 18, 30, 96), color: l.color, id: q.id, ph: hash2(q.x, l.x, 3) * TAU });
    }
    const find = (id) => placed.find((q) => q.id === id);
    this.statue = find('statue_head');
    this.vent = find('vent_chimney');
    this.pillar = find('pillar_ruin');
    this.skull = find('giant_skull');
    // glyph symbols on the pillar (sequence hint) and on each stone
    const gcol = '#7affff';
    this.glyphSpr = GLYPH_IDS.map((n) => glyphSprite(n, gcol));
    this.glyphDim = GLYPH_IDS.map((n) => glyphSprite(n, '#3a7a9a'));
    const pl = this.pillar;
    this.pillarGlyphs = ORDER.map((gi, k) => ({ gi, x: pl.x - 3, y: pl.top + 18 + k * 11 }));
    for (const s of this.stones) {
      s.cx = s.x; s.cy = s.top + Math.round(s.p.h * 0.22);
      s.rect = { x: s.left + 2, y: s.top + 2, w: s.p.w - 4, h: s.p.oy - 2 };
    }
    this.statueRect = { x: this.statue.left + 14, y: this.statue.top + 10, w: this.statue.p.w - 28, h: this.statue.p.oy - 16 };
  }

  buildLayers() {
    const W = this.W, H = this.H, pad = 30;
    this.pad = pad;
    const LW = W + pad * 2;
    const r = new RNG(13);
    // --- far A: distant ridges, a stepped temple and a colonnade
    const yA = Math.round(H * 0.32), hA = H - yA;
    const mA = new Mask(LW, hA);
    const rA = ridge(LW, hA * 0.5, hA * 0.16, 0.006, 5.1, 4, 0.3);
    mA.below((x) => rA[x]);
    const tx = LW * 0.62, ty = rA[Math.round(tx)] + 6;
    for (let k = 0; k < 6; k++) mA.rect(tx - 90 + k * 14, ty - (k + 1) * 14, 180 - k * 28, 15);
    mA.rect(tx - 12, ty - 112, 24, 30); mA.rect(tx - 6, ty - 104, 12, 22, 0);
    for (let k = 0; k < 9; k++) { const cx = LW * 0.2 + k * 16, cy = rA[Math.round(cx)] + 4, hh = k % 3 === 1 ? 26 : 52; mA.rect(cx, cy - hh, 7, hh); mA.rect(cx - 2, cy - hh - 3, 11, 3); }
    mA.rect(LW * 0.2 - 4, rA[Math.round(LW * 0.2)] - 58, 150, 4);
    for (let i = 0; i < 5; i++) { const px = r.float(0, LW), top = hA * r.float(0.15, 0.32); mA.poly([[px - 22, hA * 0.6], [px - 6, top + 10], [px + 2, top], [px + 9, top + 14], [px + 24, hA * 0.6]]); }
    const palA = stopPalette([[0, '#0a1230'], [1, '#1c2a58']], 5);
    this.farA = new FogLayer(mA.toCanvas((x, y, v, up) => (up <= 1 ? pack('#4a6ab0') : ditherPick(palA, 0.7 - Math.min(1, up / 60) * 0.5 + (fbm2(x * 0.05, y * 0.05, 2, 2) - 0.5) * 0.35, x, y))), -pad, yA);
    this.farAY = yA;
    // --- far B: rock arches & broken pillars
    const yB = H - 280, hB = 280;
    const mB = new Mask(LW, hB);
    const rB = ridge(LW, hB * 0.7, 18, 0.01, 2.6, 3);
    mB.below((x) => rB[x]);
    for (let i = 0; i < 7; i++) {
      const px = r.float(0.05, 0.95) * LW, base = rB[Math.round(px)] + 4, hh = r.float(40, 90);
      if (r.chance(0.5)) { mB.rect(px - 5, base - hh, 10, hh); mB.rect(px - 8, base - hh - 4, 16, 4); if (r.chance(0.5)) mB.rect(px - 7, base - hh * 0.4, 14, 3); }
      else { const aw = r.float(26, 40); mB.ellipse(px, base - hh * 0.8, aw, hh * 0.55); mB.ellipse(px, base - hh * 0.72, aw * 0.6, hh * 0.42, 0); mB.rect(px - aw * 0.6, base - hh * 0.72, aw * 1.2, hh, 0); mB.rect(px - aw, base - hh * 0.8, aw * 0.4, hh * 0.8 + 4); mB.rect(px + aw * 0.6, base - hh * 0.8, aw * 0.4, hh * 0.8 + 4); }
    }
    for (let i = 0; i < 30; i++) { const px = r.float(0, LW); mB.ellipse(px, rB[Math.round(px)] + 4, r.float(6, 16), r.float(4, 10)); }
    const palB = stopPalette([[0, '#080e26'], [1, '#18244c']], 5);
    this.farB = new FogLayer(mB.toCanvas((x, y, v, up) => (up <= 1 ? pack('#5a7ac0') : up === 2 ? pack('#2a3a70') : ditherPick(palB, 0.7 - Math.min(1, up / 40) * 0.5 + (fbm2(x * 0.08, y * 0.08, 2, 5) - 0.5) * 0.4, x, y))), -pad, yB);
    this.farBY = yB;
    // --- giant strata cliffs framing both sides (mid layer)
    const mC = new Mask(LW, H);
    const eL = new Float32Array(H + 1), eR = new Float32Array(H + 1);
    for (let y = 0; y <= H; y++) {
      eL[y] = pad + W * 0.1 + Math.sin(y * 0.012 + 1) * 22 + (fbm2(1, y * 0.03, 3, 7) - 0.5) * 40 + smoothstep(H * 0.5, 0, y) * 46 + smoothstep(H * 0.7, H, y) * 30;
      eR[y] = pad + W * 0.89 - Math.sin(y * 0.01 + 3) * 18 - (fbm2(5, y * 0.03, 3, 9) - 0.5) * 34 - smoothstep(H * 0.45, 0, y) * 52 - smoothstep(H * 0.7, H, y) * 26;
    }
    const edgeL = (y) => eL[clamp(Math.round(y), 0, H)];
    const edgeR = (y) => eR[clamp(Math.round(y), 0, H)];
    this.ledges = [];
    for (let y = 0; y < H; y++) {
      const a = edgeL(y), b = edgeR(y);
      for (let x = 0; x < Math.min(LW, a); x++) mC.d[y * LW + x] = 1;
      for (let x = Math.max(0, Math.floor(b)); x < LW; x++) mC.d[y * LW + x] = 2;
    }
    // ledges jutting out of the walls
    for (const [side, yf, len] of [[1, 0.26, 26], [1, 0.47, 34], [1, 0.68, 22], [2, 0.2, 30], [2, 0.42, 24], [2, 0.62, 36]]) {
      const y = Math.round(H * yf);
      const e = side === 1 ? edgeL(y) : edgeR(y);
      for (let k = 0; k < 7; k++) {
        const w = len * (1 - k / 9);
        if (side === 1) mC.rect(e - 6, y + k, w + 6, 1, 1); else mC.rect(e - w, y + k, w + 6, 1, 2);
      }
      this.ledges.push({ x: side === 1 ? e + len * 0.6 - pad : e - len * 0.6 - pad, y: y - 1, side });
    }
    const palR = stopPalette([[0, '#0c1024'], [0.4, '#1e2646'], [0.75, '#343e6a'], [1, '#56689a']], 7);
    const cliff = mC.toCanvas((x, y, v, up, left, right) => {
      const e = v === 1 ? edgeL(y) : edgeR(y);
      const d = v === 1 ? e - x : x - e; // distance from the open-water edge
      if (d < 1.5) return pack('#6a86c8');
      const strata = Math.sin(y * 0.42 + fbm2(x * 0.02, y * 0.05, 2, 17) * 5);
      let lv = 0.55 - Math.min(1, d / 70) * 0.4 + strata * 0.12 + (fbm2(x * 0.07, y * 0.07, 2, 19) - 0.5) * 0.3;
      if (up <= 1) lv += 0.35;
      else if (up <= 3) lv += 0.15;
      if (hash2(Math.floor(x / 3), Math.floor(y / 9), 23) < 0.04) lv -= 0.3;
      return ditherPick(palR, clamp01(lv), x, y);
    });
    this.cliffs = new FogLayer(cliff, -pad, 0);
    this.edgeL = (y) => edgeL(y) - pad;
    this.edgeR = (y) => edgeR(y) - pad;
  }

  buildLife() {
    const W = this.W, H = this.H;
    const r = new RNG(29);
    this.snow = new Motes(150, { x0: 0, y0: -10, x1: W, y1: H }, { seed: 5, vx: [-1.5, 1.5], vy: [5, 11], sizes: [1, 1, 1, 2], colors: ['#c8d4f0', '#a8b8e0', '#e8eeff'], alpha: [0.25, 0.7], wob: 3 });
    this.nearSnow = new Motes(40, { x0: 0, y0: -10, x1: W, y1: H }, { seed: 6, vx: [-2, 2], vy: [8, 16], sizes: [2, 2, 3], colors: ['#c8d4f0', '#e8eeff'], alpha: [0.12, 0.35], wob: 5 });
    this.sparks = new Motes(70, { x0: 0, y0: 20, x1: W, y1: H - 40 }, { seed: 7, vx: [-1, 1], vy: [-1.5, 1], sizes: [1], colors: ['#5affff', '#c87aff', '#7affb0', '#7aa8ff'], alpha: [0.5, 1], wob: 6 });
    this.bubbles = new Bubbles(50, '#c8d8ff');
    this.smoke = [];
    for (let i = 0; i < 18; i++) this.smoke.push({ k: i / 18, ph: r.float(0, TAU), s: r.float(0.7, 1.3) });
    this.puff = [2, 3, 4, 5, 6, 7, 8].map((rr) => tinted(discSprite(rr), '#0a0a12'));
    // ledge plants: small glowing shrooms / worms
    this.ledgePlants = this.ledges.map((l, i) => ({ ...l, c: ['#5affff', '#c87aff', '#7affb0', '#ff7ab0', '#7aa8ff', '#5affd0'][i % 6], ph: r.float(0, TAU) }));
    // hanging bioluminescent tendrils from the overhangs
    this.tendrils = [];
    for (const [x, y, n] of [[this.edgeL(H * 0.08) - 6, H * 0.08, 16], [this.edgeL(H * 0.16) - 4, H * 0.16, 11], [this.edgeR(H * 0.1) + 6, H * 0.1, 14], [this.edgeR(H * 0.18) + 4, H * 0.18, 9]]) {
      const st = new Strands();
      st.add({ x: Math.round(x), y: Math.round(y), n, seg: 4, down: true, w: 1, amp: 0.12, speed: 0.7, sec: 1, phase: x * 0.1, wave: 0.2, cols: ['#2a4a7a', '#3a7aaa', '#5ac8e8'], out: null, hl: false, tip: '#bfffff', tipR: 1 });
      this.tendrils.push({ anim: new SwayAnim(st, { frames: 20 }), tip: { x, y: y + n * 4 }, off: Math.round(x) % 20 });
    }
    // leviathans gliding in the far fog
    this.disc = [];
    for (let rr = 1; rr <= 30; rr++) this.disc.push(discSprite(rr));
    this.levi = { x: W * 0.3, y: H * 0.36, dir: 1, v: 7, len: 640, rmax: 22, ph: 0 };
    this.leviT = 0;
    this.current = cloudTile(320, 120, '#8aa8e8', { seed: 4, alpha: 0.12, scale: 0.03, bias: 0.55, levels: 3 });
    this.glowCloud = cloudTile(320, 200, '#5affe0', { seed: 8, alpha: 0.18, scale: 0.025, bias: 0.55, levels: 3 });
    this.hint = 0;
  }

  // ------------------------------------------------------------------ update
  update(dt, env) {
    dt = Math.max(0, Math.min(dt, 0.1));
    this.t += dt;
    const t = this.t, W = this.W, H = this.H;
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
    // leviathan
    const L = this.levi;
    if (L) {
      L.x += L.dir * L.v * dt * (1 + wx.current * 0.5);
      L.ph += dt * 0.5;
      if ((L.dir > 0 && L.x - L.len > W + 60) || (L.dir < 0 && L.x + L.len < -60)) { this.levi = null; this.leviT = 30 + Math.random() * 50; }
    } else {
      this.leviT -= dt;
      if (this.leviT <= 0) {
        const dir = Math.random() < 0.5 ? 1 : -1, len = 500 + Math.random() * 300;
        this.levi = { x: dir > 0 ? -40 : W + 40, y: H * (0.26 + Math.random() * 0.18), dir, v: 6 + Math.random() * 4, len, rmax: 16 + Math.random() * 10, ph: 0 };
      }
    }
    for (const s of this.stones) s.lit = Math.max(this.secrets().glyphs ? 1 : 0, s.lit - dt * 0.15 * (this.seq.length ? 0 : 1));
    this.solveT = Math.max(0, this.solveT - dt);
    this.hint += dt;
    env.flash = 0;
  }

  // ------------------------------------------------------------------ draw
  drawBack(ctx, env) {
    const W = this.W, H = this.H, t = this.t, wx = this.wx;
    fillWith(ctx, this.waterStrip, 0, -10, W, H + 10);
    const px = this.par.x, py = this.par.y;
    const wob = quality(env) >= 1 ? 1 : 0;
    // faint light from impossibly far above
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.5 + 0.2 * Math.sin(t * 0.2);
    ctx.drawImage(this.rays, Math.round(Math.sin(t * 0.03) * 20), -20);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    drawWobble(ctx, this.farA.tint(this.waterStrip, 0.62, 'a'), -this.pad + px * 1.5, this.farAY + py, t, wob, 4, 0.6, 0.06);
    this.drawLeviathan(ctx);
    drawWobble(ctx, this.farB.tint(this.waterStrip, 0.42, 'b'), -this.pad + px * 3, this.farBY + py * 1.5, t + 2, wob, 4, 0.8, 0.08);
    // drifting current veils
    if (wx.current > 0.05) {
      const pat = ctx.createPattern(this.current, 'repeat');
      pat.setTransform(new DOMMatrix([1, 0, 0, 1, Math.round(t * 60), 0]));
      ctx.globalAlpha = wx.current;
      ctx.fillStyle = pat;
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
    }
    ctx.drawImage(this.cliffs.tint('#1a2a5a', 0.12, 'c'), Math.round(-this.pad + px * 5), Math.round(py * 2));
    // hanging tendrils and ledge glows on the cliffs
    for (const td of this.tendrils) td.anim.draw(ctx, t, td.off, Math.round(px * 5), Math.round(py * 2));
  }

  drawLeviathan(ctx) {
    const L = this.levi;
    if (!L) return;
    const n = 46;
    const col = '#080e24';
    const t = this.t;
    ctx.globalAlpha = 0.85;
    const pts = [];
    for (let i = 0; i < n; i++) {
      const u = i / (n - 1);
      const x = L.x - L.dir * u * L.len + this.par.x * 2;
      const y = L.y + Math.sin(L.ph * 2 - u * 5.5) * 18 * (0.3 + u) + this.par.y;
      const rr = Math.max(1, Math.round(L.rmax * (u < 0.12 ? 0.75 + u * 2 : 1 - Math.pow((u - 0.12) / 0.88, 1.4) * 0.92)));
      pts.push([x, y, rr]);
    }
    for (let i = n - 1; i >= 0; i--) {
      const [x, y, rr] = pts[i];
      const d = tinted(this.disc[Math.min(29, rr - 1)], col);
      ctx.drawImage(d, Math.round(x - rr), Math.round(y - rr));
    }
    // fins & jaw
    const [hx, hy, hr] = pts[0];
    ctx.fillStyle = col;
    for (let k = 0; k < 3; k++) { const [fx, fy, fr] = pts[6 + k * 9]; ctx.fillRect(Math.round(fx - 3), Math.round(fy - fr - 6 + k), 6, 7); }
    ctx.fillRect(Math.round(hx + L.dir * hr * 0.6), Math.round(hy + 2), Math.round(L.dir * 10), 3);
    ctx.globalAlpha = 1;
    // glowing lure & photophores
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 3; i < n - 6; i += 4) {
      const [x, y, rr] = pts[i];
      const k = 0.5 + 0.5 * Math.sin(t * 2 + i * 0.6);
      ctx.globalAlpha = 0.25 + k * 0.35;
      ctx.fillStyle = '#5affff';
      ctx.fillRect(Math.round(x), Math.round(y + rr * 0.45), 1, 1);
    }
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = '#c8ffff';
    ctx.fillRect(Math.round(hx + L.dir * hr * 0.5), Math.round(hy - hr * 0.3), 2, 2);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  drawSeabed(ctx, env) {
    const W = this.W, H = this.H, t = this.t, wx = this.wx, q = quality(env);
    this.snow.draw(ctx, t, 0.75 + wx.snow * 0.3, q * (0.55 + wx.snow * 0.45), 0.2);
    ctx.drawImage(this.bed, 0, this.bedY);
    // emissive bloom
    const gk = 1 + wx.glow * 0.8;
    ctx.globalCompositeOperation = 'lighter';
    for (const gl of this.glows) {
      ctx.globalAlpha = clamp01((0.38 + 0.18 * Math.sin(t * 1.1 + gl.ph)) * gk);
      ctx.drawImage(gl.c, gl.x, gl.y);
    }
    if (this.groundGlow) { ctx.globalAlpha = clamp01((0.5 + 0.3 * Math.sin(t * 0.8)) * gk); ctx.drawImage(this.groundGlow, this.ground.x, this.ground.y); }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    this.drawVent(ctx);
    this.drawGlyphs(ctx);
    this.bubbles.draw(ctx, t);
  }

  drawVent(ctx) {
    const v = this.vent, t = this.t, wx = this.wx;
    const x0 = v.x + 2, y0 = v.top + 6;
    // black smoke plume rising and spreading
    for (const s of this.smoke) {
      const k = (s.k + t * 0.07) % 1;
      const y = y0 - k * 150;
      const x = x0 + Math.sin(t * 0.8 + s.ph + k * 4) * (3 + k * 14) + wx.current * k * 60;
      const ri = Math.min(6, Math.floor(k * 7 * s.s));
      ctx.globalAlpha = (1 - k) * 0.7;
      const spr = this.puff[ri];
      ctx.drawImage(spr, Math.round(x - spr.width / 2), Math.round(y - spr.height / 2));
    }
    ctx.globalAlpha = 1;
    // heat shimmer: wavy light threads
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = '#ff9a5a';
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 22; j++) {
        const k = ((j / 22) + t * 0.4 + i * 0.25) % 1;
        const y = y0 - k * 70;
        const x = x0 - 6 + i * 4 + Math.sin(y * 0.25 + t * 4 + i) * 2;
        ctx.globalAlpha = (1 - k) * 0.22;
        ctx.fillRect(Math.round(x), Math.round(y), 1, 2);
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    drawGlow(ctx, x0, y0 + 2, 9, '#ffb060', 0.5 + 0.2 * Math.sin(t * 7));
  }

  drawGlyphs(ctx) {
    const t = this.t, solved = !!this.secrets().glyphs;
    // the pillar replays the order: each symbol flares in turn
    const cyc = 6;
    const ph = t % cyc;
    for (let k = 0; k < this.pillarGlyphs.length; k++) {
      const pg = this.pillarGlyphs[k];
      const on = solved ? 0.8 + 0.2 * Math.sin(t * 2 + k) : ph > k * 1 + 0.5 && ph < k * 1 + 1.4 ? 1 : 0.25;
      ctx.globalAlpha = on;
      ctx.drawImage(on > 0.5 ? this.glyphSpr[pg.gi] : this.glyphDim[pg.gi], pg.x, pg.y);
      if (on > 0.5) drawGlow(ctx, pg.x + 3, pg.y + 3, 8, '#5affff', on * 0.7);
    }
    ctx.globalAlpha = 1;
    for (const s of this.stones) {
      const k = solved ? 1 : s.lit;
      ctx.globalAlpha = 0.35 + k * 0.65;
      ctx.drawImage(k > 0.3 ? this.glyphSpr[s.glyph] : this.glyphDim[s.glyph], s.cx - 3, s.cy - 3);
      ctx.globalAlpha = 1;
      if (k > 0.05) drawGlow(ctx, s.cx, s.cy, 10, '#5affff', k * 0.8);
    }
    if (!solved) {
      const p = ((this.hint % 7) / 7);
      if (p < 0.1) twinkle(ctx, this.pillarGlyphs[0].x + 8, this.pillarGlyphs[0].y - 4, Math.sin((p / 0.1) * Math.PI), '#c8ffff');
    }
  }

  drawFront(ctx, env) {
    const t = this.t, wx = this.wx, q = quality(env), W = this.W, H = this.H;
    this.nearSnow.draw(ctx, t, 0.8 + wx.snow * 0.5, q * (0.4 + wx.snow * 0.6));
    // bioluminescent sparks (brighter in a glow tide)
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
    // glow tide: luminous veils sweeping through
    if (wx.glow > 0.05) {
      const pat = ctx.createPattern(this.glowCloud, 'repeat');
      pat.setTransform(new DOMMatrix([1, 0, 0, 1, Math.round(t * 8), Math.round(Math.sin(t * 0.2) * 20)]));
      ctx.globalAlpha = wx.glow * (0.35 + 0.15 * Math.sin(t * 0.7));
      ctx.fillStyle = pat;
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
    }
    // the elder head's eyes burn after the glyphs are solved
    if (this.secrets().glyphs || this.solveT > 0) {
      const s = this.statue;
      const k = this.solveT > 0 ? 1 : 0.5 + 0.2 * Math.sin(t * 1.5);
      for (const l of this.propLights) if (l.id === 'statue_head' && l.r < 60) drawGlow(ctx, l.x, l.y, 8, '#9affff', k);
      void s;
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  // ------------------------------------------------------------------ lighting
  lighting(env) {
    const wx = this.wx, t = this.t;
    const g = wx.glow;
    const dark = 0.86 - g * 0.12;
    const lights = [];
    const W = this.W, H = this.H;
    // the faint far-fog band
    lights.push({ x: W * 0.5, y: H * 0.42, r: W * 0.55, color: '#22388a', a: 0.32 + g * 0.2 });
    for (const l of this.propLights) {
      const pulse = 0.85 + 0.15 * Math.sin(t * 1.3 + l.ph);
      lights.push({ x: l.x, y: l.y, r: l.r * (1 + g * 0.35), color: l.color, a: clamp01((0.8 + g * 0.3) * pulse) });
    }
    const v = this.vent;
    lights.push({ x: v.x + 2, y: v.top + 10, r: 70, color: '#ff8a3a', a: 0.75 + 0.15 * Math.sin(t * 6.3) });
    for (const lp of this.ledgePlants) lights.push({ x: lp.x, y: lp.y, r: 46, color: lp.c, a: 0.6 + 0.2 * Math.sin(t + lp.ph) + g * 0.2 });
    for (const td of this.tendrils) lights.push({ x: td.tip.x, y: td.tip.y, r: 26, color: '#5ac8ff', a: 0.5 + g * 0.3 });
    const solved = !!this.secrets().glyphs;
    for (const s of this.stones) lights.push({ x: s.cx, y: s.cy, r: 24 + s.lit * 20, color: '#5affff', a: solved ? 0.7 : 0.25 + s.lit * 0.6 });
    const pg = this.pillarGlyphs[1];
    lights.push({ x: pg.x + 3, y: pg.y + 10, r: 34, color: '#5affff', a: 0.45 });
    if (this.levi) lights.push({ x: this.levi.x, y: this.levi.y, r: 40, color: '#5affff', a: 0.25 });
    if (solved || this.solveT > 0) lights.push({ x: this.statue.x, y: this.statue.top + this.statue.p.h * 0.45, r: 90, color: '#9affff', a: this.solveT > 0 ? 1 : 0.5 });
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
    const i = Number(id.slice(5));
    const s = this.stones[i];
    if (st.secrets.glyphs) { s.lit = 1; audio?.play?.('sparkle', { vol: 0.4 }); return; }
    const want = ORDER[this.seq.length];
    if (s.glyph === want) {
      this.seq.push(i);
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
