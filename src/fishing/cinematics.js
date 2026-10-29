// Fishing cinematics: animated titles (FISH ON!, banners, pops, I GOT IT!, SNAP!), the slow-motion
// landing finale (surface eruption -> arc into the angler's hands -> photo moment), the escape
// cutscene (line whip, comedic taunt) and the outro that hands control back to the game.
// World-space drawing goes through drawWorld(ctx); screen-space through drawHud(ctx).

import { TAU, clamp, clamp01, lerp, dist, damp, ease } from '../core/math.js';
import { rng } from '../core/rng.js';
import { rgba, RARITY } from '../core/color.js';
import { drawText, measureText } from '../gfx/font.js';
import { glowSprite } from '../gfx/particles.js';
import { HOOK } from './baitart.js';
import { drawAngler } from './hud.js';

// ------------------------------------------------------------------ text art helpers
const OUT8 = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]];

// Chunky title text: thick outline, drop shadow, fill with a lit top band and a shaded bottom band.
export function drawFancyText(ctx, text, x, y, scale, o = {}) {
  const fill = o.fill || '#ffe27a', light = o.light || '#fffbe0', dark = o.dark || '#c8781a';
  const outline = o.outline || '#2a0e04', ow = o.ow ?? Math.max(1, Math.round(scale * 0.5));
  const h = 7 * scale;
  if (o.align === 'center') x -= Math.floor(measureText(text, 'normal', scale) / 2);
  x = Math.round(x); y = Math.round(y);
  drawText(ctx, text, x + ow + 1, y + ow + 2, { scale, color: o.shadow || 'rgba(10,6,20,0.55)' });
  for (const [dx, dy] of OUT8) drawText(ctx, text, x + dx * ow, y + dy * ow, { scale, color: outline });
  drawText(ctx, text, x, y, { scale, color: fill });
  ctx.save();
  ctx.beginPath(); ctx.rect(x - 4, y - 4, 4000, Math.round(h * 0.42) + 4); ctx.clip();
  drawText(ctx, text, x, y, { scale, color: light });
  ctx.restore();
  ctx.save();
  ctx.beginPath(); ctx.rect(x - 4, y + Math.round(h * 0.72), 4000, h); ctx.clip();
  drawText(ctx, text, x, y, { scale, color: dark });
  ctx.restore();
}

export function drawRibbon(ctx, cx, y, text, color = '#c8283a', o = {}) {
  const w = Math.round(measureText(text, 'normal', o.scale || 1) + 28), h = o.h || 15;
  const x = Math.round(cx - w / 2);
  y = Math.round(y);
  const dark = o.dark || '#7a1020', light = o.light || '#ff6a6a';
  // tails
  ctx.fillStyle = dark;
  for (let i = 0; i < h; i++) {
    const notch = Math.abs(i - (h >> 1));
    ctx.fillRect(x - 10 + notch * 0.5, y + 3 + i, 12 - notch * 0.5, 1);
    ctx.fillRect(x + w - 2, y + 3 + i, 12 - notch * 0.5, 1);
  }
  ctx.fillStyle = '#1a0608'; ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
  ctx.fillStyle = color; ctx.fillRect(x, y, w, h);
  ctx.fillStyle = light; ctx.fillRect(x, y, w, 1);
  ctx.fillStyle = dark; ctx.fillRect(x, y + h - 2, w, 2);
  ctx.fillStyle = rgba('#ffffff', 0.25); ctx.fillRect(x + 2, y + 2, w - 4, 1);
  drawText(ctx, text, cx, y + Math.round((h - 7 * (o.scale || 1)) / 2), { align: 'center', color: o.color || '#fff6e0', outline: dark, scale: o.scale || 1 });
}

// Rotating burst of light wedges.
export function drawRays(ctx, x, y, r, n, t, color, alpha, width = 0.11) {
  if (alpha <= 0.01) return;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + t;
    const w = width * (i % 2 ? 0.6 : 1);
    ctx.fillStyle = rgba(color, alpha * (i % 2 ? 0.6 : 1));
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(a - w) * r, y + Math.sin(a - w) * r);
    ctx.lineTo(x + Math.cos(a + w) * r, y + Math.sin(a + w) * r);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function drawGlow(ctx, x, y, r, color, a) {
  if (a <= 0.01) return;
  const s = glowSprite(r, color);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = a;
  ctx.drawImage(s, Math.round(x - r), Math.round(y - r));
  ctx.restore();
}

// ------------------------------------------------------------------ titles
const DUR = { fishon: 1.5, banner: 1.25, pop: 0.85, igotit: 2.7, snap: 1.9, escape: 2.0 };

export class Titles {
  constructor(F) { this.F = F; this.list = []; }

  add(kind, text, opts = {}) {
    const it = { kind, text, t: 0, dur: opts.dur ?? DUR[kind] ?? 1, ...opts };
    if (kind === 'banner' || kind === 'fishon' || kind === 'igotit' || kind === 'snap' || kind === 'escape') {
      this.list = this.list.filter((o) => o.kind === 'pop' || (kind === 'banner' && o.kind !== 'banner'));
    }
    this.list.push(it);
    return it;
  }

  banner(text, color = '#ffe27a', sub = '') { return this.add('banner', text, { color, sub }); }
  pop(text, x, y, color = '#ffffff', opts = {}) {
    if (this.list.filter((o) => o.kind === 'pop').length > 5) this.list.splice(this.list.findIndex((o) => o.kind === 'pop'), 1);
    return this.add('pop', text, { x, y, color, scale: opts.scale || 1, ...opts });
  }

  clear() { this.list.length = 0; }
  has(kind) { return this.list.some((o) => o.kind === kind); }

  update(rdt) {
    for (const it of this.list) {
      it.t += rdt;
      if (it.kind === 'igotit') this.igotitFx(it);
    }
    this.list = this.list.filter((it) => it.t < it.dur);
  }

  igotitFx(it) {
    const F = this.F, fx = F.fx, W = F.W, H = F.H;
    const cy = H * 0.3;
    if (!it.burst && it.t > 0.12) {
      it.burst = true;
      fx.confetti(W * 0.5, cy, 70, { spread: Math.PI, speed: [120, 320], life: 3.2, w: 60 });
      fx.confetti(-4, H * 0.55, 30, { dir: -1.0, spread: 0.35, speed: [220, 380] });
      fx.confetti(W + 4, H * 0.55, 30, { dir: -Math.PI + 1.0, spread: 0.35, speed: [220, 380] });
      fx.lightStreaks(W * 0.5, cy, 22);
      fx.stars(W * 0.5, cy, 24, { speed: [80, 220], g: 40, w: 90, h: 10 });
      fx.shockwave(W * 0.5, cy + 10, 160, '#fff6c0', { life: 0.6 });
      F.cam?.flash?.('#fff8e0', 0.6);
    }
    if (it.t > 0.6 && it.t < 2.2 && rng.chance(0.4)) fx.stars(W * 0.5 + rng.float(-150, 150), cy + rng.float(-20, 30), 1, { speed: [5, 20], g: 0 });
    if (!it.rain && it.t > 0.9) { it.rain = true; fx.confetti(W * 0.5, -10, 40, { dir: Math.PI / 2, spread: 1.3, speed: [20, 90], w: W * 0.45, g: 60, life: 2.4 }); }
  }

  draw(ctx) {
    for (const it of this.list) {
      switch (it.kind) {
        case 'fishon': this.drawFishOn(ctx, it); break;
        case 'banner': this.drawBanner(ctx, it); break;
        case 'pop': this.drawPop(ctx, it); break;
        case 'igotit': this.drawIGotIt(ctx, it); break;
        case 'snap': this.drawSnap(ctx, it); break;
        case 'escape': this.drawEscape(ctx, it); break;
        default: break;
      }
    }
  }

  drawFishOn(ctx, it) {
    const W = this.F.W, H = this.F.H, t = it.t;
    const a = clamp01((it.dur - t) * 4);
    const s = Math.max(1, Math.round(lerp(7, 4, ease.outBack(clamp01(t * 5)))));
    const cy = Math.round(H * 0.24);
    ctx.globalAlpha = a;
    drawRays(ctx, W / 2, cy + 14, 220, 14, t * 0.8, '#ffffff', 0.08 * a);
    const jx = t < 0.25 ? rng.int(-2, 2) : 0;
    drawFancyText(ctx, it.text, W / 2 + jx, cy - (7 * s) / 2, s, { align: 'center', fill: '#ffffff', light: '#ffffff', dark: '#b8d8f0', outline: '#0b1622' });
    if (it.sub) {
      const k = ease.outCubic(clamp01((t - 0.2) * 4));
      const sx = lerp(-200, W / 2, k);
      drawRibbon(ctx, sx, cy + 26, it.sub, it.subColor || '#2a5aa8', { dark: '#0b1a3a', light: '#6aa8ff' });
    }
    ctx.globalAlpha = 1;
  }

  drawBanner(ctx, it) {
    const W = this.F.W, H = this.F.H, t = it.t;
    const a = clamp01((it.dur - t) * 5);
    const k = ease.outBack(clamp01(t * 6));
    const cy = Math.round(H * 0.2);
    const x = lerp(W + 200, W / 2, k);
    ctx.globalAlpha = a;
    // backing slash
    const bw = Math.round(measureText(it.text, 'normal', 3) + 40);
    ctx.fillStyle = rgba('#0b1622', 0.75);
    for (let i = 0; i < 30; i++) ctx.fillRect(Math.round(x - bw / 2 + (30 - i) * 0.4), cy - 6 + i, bw, 1);
    ctx.fillStyle = it.color; ctx.fillRect(Math.round(x - bw / 2), cy - 7, bw, 1); ctx.fillRect(Math.round(x - bw / 2 - 12), cy + 24, bw, 1);
    drawFancyText(ctx, it.text, x, cy, 3, { align: 'center', fill: it.color, light: '#ffffff', dark: shadeOf(it.color), outline: '#0b1622', ow: 1 });
    if (it.sub) drawText(ctx, it.sub, x, cy + 28, { align: 'center', color: '#ffffff', outline: '#0b1622' });
    ctx.globalAlpha = 1;
  }

  drawPop(ctx, it) {
    const t = it.t, k = t / it.dur;
    const s = it.scale;
    const pop = t < 0.1 ? 1 + (0.1 - t) * 6 : 1;
    ctx.globalAlpha = clamp01((1 - k) * 3);
    const y = it.y - ease.outCubic(clamp01(t * 2)) * 14;
    drawText(ctx, it.text, it.x, y, { align: 'center', color: it.color, outline: '#0b1622', scale: Math.max(1, Math.round(s * pop)) });
    ctx.globalAlpha = 1;
  }

  drawIGotIt(ctx, it) {
    const F = this.F, W = F.W, H = F.H, t = it.t;
    const aIn = clamp01(t * 5) * clamp01((it.dur - t) * 2.2);
    const cx = W / 2, cy = Math.round(H * 0.3);
    const scale = W < 700 ? 4 : 6;
    // backdrop rays + glow
    drawRays(ctx, cx, cy, Math.max(W, H) * 0.7, 18, t * 0.45, '#ffe27a', 0.08 * aIn, 0.09);
    drawRays(ctx, cx, cy, Math.max(W, H) * 0.5, 12, -t * 0.3, '#ffffff', 0.06 * aIn, 0.05);
    drawGlow(ctx, cx, cy, 90, '#fff2a8', 0.55 * aIn);
    // bouncy letters
    const text = it.text;
    let total = 0;
    const widths = [];
    for (const ch of text) { const w = measureText(ch, 'normal', scale) + scale; widths.push(w); total += w; }
    let x = cx - total / 2;
    const h = 7 * scale;
    const out = clamp01((it.dur - t) * 3);
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      const w = widths[i];
      if (ch !== ' ') {
        const lt = t - 0.1 - i * 0.06;
        if (lt > 0) {
          const k = clamp01(lt / 0.42);
          const drop = (1 - ease.outBounce(k)) * 140;
          let sx = 1, sy = 1;
          if (k >= 1) {
            const e = Math.exp(-(lt - 0.42) * 6) * Math.sin((lt - 0.42) * 26) * 0.22;
            sx = 1 + e; sy = 1 - e;
          }
          const wave = k >= 1 ? Math.sin(t * 6 + i * 0.8) * 3 : 0;
          const ly = cy - h / 2 - drop + wave - (1 - out) * 30;
          ctx.save();
          ctx.globalAlpha = out;
          ctx.translate(Math.round(x + w / 2), Math.round(ly + h));
          ctx.scale(sx, sy);
          drawFancyText(ctx, ch, -Math.round(w / 2), -h, scale, { fill: '#ffd23a', light: '#fff6b8', dark: '#e08a1a', outline: '#3a1206', ow: 3 });
          ctx.restore();
          if (Math.abs(lt - 0.42) < 0.02 && !it['land' + i]) {
            it['land' + i] = true;
            F.fx.stars(x + w / 2, cy + h / 2, 3, { speed: [30, 80], g: 60 });
            F.sfx('mash_pop', { pitch: 1 + i * 0.08, vol: 0.5 });
          }
        }
      }
      x += w;
    }
    // ribbon with the catch
    if (it.sub && t > 0.75) {
      const k = ease.outBack(clamp01((t - 0.75) * 4));
      ctx.save();
      ctx.globalAlpha = out;
      ctx.translate(cx, cy + h / 2 + 22);
      ctx.scale(k, k);
      drawRibbon(ctx, 0, 0, it.sub, it.color || '#c8283a', { dark: it.dark || '#7a1020', light: it.light || '#ff6a6a' });
      ctx.restore();
      if (it.size) drawText(ctx, it.size, cx, cy + h / 2 + 44, { align: 'center', color: '#ffffff', outline: '#0b1622', time: t });
    }
  }

  drawSnap(ctx, it) {
    const W = this.F.W, H = this.F.H, t = it.t;
    const a = clamp01((it.dur - t) * 3);
    const cy = Math.round(H * 0.28);
    const s = W < 700 ? 4 : 6;
    const j = t < 0.5 ? (0.5 - t) * 10 : 0;
    ctx.globalAlpha = a;
    drawFancyText(ctx, it.text, W / 2 + rng.float(-j, j), cy - (7 * s) / 2 + rng.float(-j, j), s, { align: 'center', fill: '#ff5a4a', light: '#ffc8b8', dark: '#a81a1a', outline: '#2a0404', ow: 3 });
    // crack zig-zag through the word
    if (t > 0.05) {
      const r = new SeedRng(it.seed || 7);
      ctx.fillStyle = rgba('#ffffff', 0.9 * a);
      let x = W / 2 - 70, y = cy - 4;
      for (let i = 0; i < 14; i++) {
        const nx = x + 10, ny = cy - 4 + (r.next() - 0.5) * 22;
        const n = 10;
        for (let k = 0; k <= n; k++) ctx.fillRect(Math.round(lerp(x, nx, k / n)), Math.round(lerp(y, ny, k / n)), 2, 2);
        x = nx; y = ny;
      }
    }
    if (it.sub) drawText(ctx, it.sub, W / 2, cy + 30, { align: 'center', color: '#ffd8d0', outline: '#2a0404' });
    ctx.globalAlpha = 1;
  }

  drawEscape(ctx, it) {
    const W = this.F.W, H = this.F.H, t = it.t;
    const a = clamp01((it.dur - t) * 3) * clamp01(t * 6);
    const s = W < 700 ? 3 : 4;
    const cy = Math.round(H * 0.26);
    const text = it.text;
    let total = 0;
    const ws = [];
    for (const ch of text) { const w = measureText(ch, 'normal', s) + s; ws.push(w); total += w; }
    let x = W / 2 - total / 2;
    ctx.globalAlpha = a;
    for (let i = 0; i < text.length; i++) {
      const droop = Math.max(0, t - 0.5 - i * 0.05);
      const y = cy + Math.min(14, droop * droop * 40) + Math.sin(t * 3 + i) * 1.5;
      if (text[i] !== ' ') drawFancyText(ctx, text[i], x, y, s, { fill: '#a8c8e8', light: '#e8f4ff', dark: '#5a7898', outline: '#0b1622', ow: 2 });
      x += ws[i];
    }
    if (it.sub) drawText(ctx, it.sub, W / 2, cy + 7 * s + 14, { align: 'center', color: '#d8e8f8', outline: '#0b1622' });
    ctx.globalAlpha = 1;
  }
}

class SeedRng {
  constructor(s) { this.s = s >>> 0 || 1; }
  next() { this.s = (this.s * 1664525 + 1013904223) >>> 0; return this.s / 4294967296; }
}

function shadeOf(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) * 0.6, g = ((n >> 8) & 255) * 0.6, b = (n & 255) * 0.6;
  return '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
}

// ------------------------------------------------------------------ landing finale
// Stages: surface (haul to the surface) -> erupt (slow-mo arc out of the water) -> catch (into the
// angler's hands) -> igotit (title) -> returns 'caught'. Without a boat/surface (desktop intro,
// browser overlay) the fish arcs to the middle of the screen and the angler pops up to hold it.
export class Finale {
  constructor(F, fish) {
    const g = F.game, w = F.world;
    this.F = F; this.fish = fish;
    this.t = 0; this.rt = 0; this.st = 0;
    this.surface = w.surfaceY !== null && w.surfaceY !== undefined ? w.surfaceY : null;
    this.hasBoat = !!(g.boat && this.surface !== null && g.boat.rodTip);
    // hosts without a cinematic camera (browser overlay) get a snappy version
    this.compact = !F.cam?.focus;
    this.stage = 'surface';
    this.from = { x: fish.x, y: fish.y };
    this.rays = 0;
    this.portrait = 0;
    fish.controlled = true;
    fish.forceAngle = undefined;
    F.cam?.release?.(2.4);
    if (this.hasBoat) F.scrollTo(this.surface - F.H * 0.58);
    F.setPose('pull');
    F.sfx('reel', { pitch: 1.3 });
    F.particles.speedLines(fish.x, fish.y, 14, { r0: 10, r1: 34, inward: true, color: '#ffffff' });
  }

  hands() {
    const g = this.F.game, b = g.boat;
    if (this.hasBoat) {
      const h = b.anchorsWorld?.hands || (typeof b.hands === 'function' ? b.hands() : null);
      if (h) return [h[0], h[1]];
      const rt = b.rodTip();
      return [lerp(b.x ?? rt[0], rt[0], 0.35), (b.y ?? this.surface) - 26];
    }
    // no boat: the angler pops up at the bottom centre of the screen (see drawPortrait)
    return this.F.toWorld(this.F.W / 2 + 8, this.F.H * 0.86 - 52);
  }

  go(stage) { this.stage = stage; this.st = 0; this.enter(stage); }

  enter(stage) {
    const F = this.F, f = this.fish, g = F.game;
    switch (stage) {
      case 'erupt': {
        F.setPose('yank');
        if (!this.compact) F.cam?.slowmo?.(0.28, 1.5);
        F.shake(7);
        F.cam?.flash?.('#ffffff', 0.25);
        const sy = this.surface ?? f.y;
        if (this.surface !== null) {
          F.particles.eruption(f.x, sy, 1.6);
          F.particles.foam(f.x, sy, 14, { spread: 24, scale: 1.3 });
        } else {
          F.particles.shockwave(f.x, f.y, 40, '#ffffff');
          F.particles.bubbles(f.x, f.y, 16);
        }
        F.particles.lightStreaks(f.x, sy - 4, 12, { dir: -Math.PI / 2, spread: 1.1 });
        F.sfx('splash_big');
        F.sfx('jump_out', { pitch: 0.9 });
        f.feel('surprised', 4);
        f.say('!!', 1.2);
        this.p0 = [f.x, this.surface !== null ? sy + 2 : f.y];
        this.flight = this.compact ? 0.6 : 1.05;
        break;
      }
      case 'catch': {
        const [hx, hy] = this.hands();
        f.x = hx; f.y = hy;
        f.forceAngle = undefined;
        if (this.hasBoat) {
          f.alpha = 0;
          g.boat.holdFish = { compiled: f.c, variant: f.rec?.variant, species: f.sp?.id };
        } else {
          f.alpha = 0;
          this.portraitOn = true;
        }
        F.setPose('hold');
        F.particles.droplets(hx, hy, 18, { spread: Math.PI, speed: [30, 110], g: 260 });
        F.particles.stars(hx, hy, 12, { speed: [30, 100] });
        F.particles.shockwave(hx, hy, 26, '#fff6c0');
        F.shake(4);
        F.sfx('splash_small');
        F.sfx('magic');
        if (this.hasBoat) F.focusCam(hx, hy - 36, 2.4, 3);
        break;
      }
      case 'igotit': {
        const sp = f.sp, rar = RARITY[sp.rarity] || RARITY.common;
        F.titles.add('igotit', 'I GOT IT!', {
          sub: sp.name, color: rar.dark, light: rar.color, dark: '#1a0a10',
          size: f.rec?.sizeCm ? `${f.rec.sizeCm} cm  -  ${f.rec.weightKg} kg` : '',
        });
        F.setPose('hold');
        const [hx, hy] = this.hands();
        F.particles.coins(hx, hy - 6, 10, { speed: [100, 200], floor: this.surface !== null ? this.surface - 1 : null });
        F.particles.confetti(hx, hy - 10, 26, { speed: [80, 200] });
        F.particles.lightStreaks(hx, hy, 14);
        F.sfx('timing_perfect');
        break;
      }
      default: break;
    }
  }

  update(dt, rdt) {
    const F = this.F, f = this.fish;
    this.t += dt; this.rt += rdt; this.st += this.stage === 'erupt' ? dt : rdt;
    f.controlled = true;
    switch (this.stage) {
      case 'surface': {
        // haul it right under the surface, thrashing
        const ty = this.surface !== null ? this.surface + 8 + 4 * f.scale : this.from.y - 14;
        f.x = damp(f.x, this.from.x + Math.sin(this.rt * 30) * 2, 10, dt);
        f.y = damp(f.y, ty, 7, dt);
        f.vx = Math.sin(this.rt * 9) * 60; f.vy = -40;
        f.wiggle = 0.8;
        f.feel('scared', 0.5);
        if (rng.chance(rdt * 20)) F.particles.bubbleTrail(f.x, f.y, 0, -80);
        if (this.surface !== null && rng.chance(rdt * 10)) F.particles.foam(f.x, this.surface, 1, { spread: 8 });
        if (this.hasBoat) F.focusCam(f.x, f.y - 20, 1.6, 3);
        if (this.st > (this.compact ? 0.2 : 0.55)) this.go('erupt');
        break;
      }
      case 'erupt': {
        const [hx, hy] = this.hands();
        const u = clamp01(this.st / this.flight);
        const p0 = this.p0;
        let apex = Math.min(p0[1], hy) - (this.hasBoat ? 70 : 60) - 20 * f.scale;
        if (!this.hasBoat) apex = Math.max(apex, this.F.toWorld(0, this.F.H * 0.2)[1]);
        const mx = (p0[0] + hx) / 2;
        const x = (1 - u) * (1 - u) * p0[0] + 2 * (1 - u) * u * mx + u * u * hx;
        const y = (1 - u) * (1 - u) * p0[1] + 2 * (1 - u) * u * apex + u * u * hy;
        const vx = x - f.x, vy = y - f.y;
        f.x = x; f.y = y;
        f.facing = hx >= p0[0] ? 1 : -1;
        f.vx = vx / Math.max(dt, 1e-3); f.vy = vy / Math.max(dt, 1e-3);
        f.forceAngle = clamp(Math.atan2(vy, Math.abs(vx) + 0.001), -1.3, 1.3) + Math.sin(this.rt * 22) * 0.15;
        f.wiggle = 0.8;
        f.z = 0;
        this.rays = Math.min(1, this.rays + rdt * 2);
        if (rng.chance(rdt * 40)) F.particles.droplets(f.x, f.y, 2, { dir: Math.PI / 2, spread: 1.2, speed: [10, 50], g: 260, w: 6 });
        if (rng.chance(rdt * 18)) F.particles.sparkle(f.x + rng.float(-10, 10) * f.scale, f.y + rng.float(-6, 6), '#ffffff');
        if (rng.chance(rdt * 8)) F.particles.stars(f.x, f.y, 1, { speed: [10, 30], g: 0 });
        const mxp = lerp(f.x, hx, 0.4), myp = lerp(f.y, hy, 0.4);
        if (this.hasBoat) F.focusCam(mxp, myp - 10, 1.35, 3.5);
        if (u >= 1) this.go('catch');
        break;
      }
      case 'catch':
        this.rays = Math.min(1, this.rays + rdt * 2);
        if (this.st > (this.compact ? 0.15 : 0.45)) this.go('igotit');
        break;
      case 'igotit':
        this.rays = Math.max(0, this.rays - rdt * 1.2);
        if (this.hasBoat) { const [hx, hy] = this.hands(); F.focusCam(hx, hy - 36, 2.4, 3); }
        if (this.st > (this.compact ? 0.05 : 2.4)) return 'caught';
        break;
      default: break;
    }
    if (this.portraitOn) this.portrait = Math.min(1, this.portrait + rdt * 3);
    return 'ok';
  }

  drawWorld(ctx) {
    const f = this.fish;
    if (this.rays > 0.01 && (this.stage === 'erupt' || this.stage === 'catch' || this.stage === 'igotit')) {
      const [x, y] = this.stage === 'erupt' ? [f.x, f.y] : this.hands();
      drawRays(ctx, x, y, 130, 12, this.rt * 0.9, '#fff6c0', 0.09 * this.rays, 0.08);
      drawGlow(ctx, x, y, 26, '#fff6c0', 0.4 * this.rays);
    }
  }

  drawHud(ctx) {
    if (this.portrait > 0.01) drawPortrait(ctx, this.F, this.fish, this.portrait, 'hold', this.rt);
  }
}

// The angler popping up to hold the catch when there is no boat on screen.
function drawPortrait(ctx, F, fish, k, pose, t) {
  const W = F.W, H = F.H;
  const cx = W / 2, by = H * 0.86;
  const a = ease.outBack(clamp01(k));
  drawGlow(ctx, cx, by - 40, 70, '#fff2a8', 0.45 * k);
  ctx.save();
  ctx.globalAlpha = clamp01(k * 2);
  ctx.translate(cx, by + (1 - a) * 80);
  drawAngler(ctx, F, 0, 0, { pose, t, scale: 2, fish: { compiled: fish.c, variant: fish.rec?.variant } });
  ctx.restore();
}

// ------------------------------------------------------------------ escape cutscene
const TAUNTS = ['nyeh~!', 'too slow!', 'bye bye!', 'lol', 'blub blub ha!', 'catch me never!', 'later, loser!', ':P', 'nice try!', 'smell ya later!'];

export class EscapeCine {
  constructor(F, fish, reason, line) {
    this.F = F; this.fish = fish; this.reason = reason;
    this.t = 0;
    this.blocksHook = true;
    this.taunt = rng.pick(TAUNTS);
    this.line = line; // {x0,y0,x1,y1} rod tip -> mouth at the moment it broke
    this.hook = reason !== 'snap' ? { x: line.x1, y: line.y1, vx: -(fish.facing || 1) * 50, vy: -150, a: 0 } : null;
    this.dirAway = fish.facing || 1;
    fish.controlled = true;
    fish.allowTurn = true;
    fish.forceAngle = undefined;
    fish.alpha = 1;
    fish.feel('smug', 3);
    F.setPose('sad');
    if (reason === 'snap') {
      F.titles.add('snap', 'SNAP!', { sub: 'The line snapped...', seed: rng.int(1, 9999) });
      F.shake(9);
      F.cam?.flash?.('#ff8a7a', 0.25);
      F.particles.sparks(line.x1, line.y1, 14, { speed: [40, 140], colors: ['#ffffff', '#e8f4ff', '#ffd25a'] });
    } else {
      const text = reason === 'throw' ? 'IT SPAT THE HOOK!' : reason === 'run' ? 'IT RAN OFF!' : 'IT GOT AWAY...';
      F.titles.add('escape', text, { sub: reason === 'throw' ? 'Keep the line tight!' : reason === 'run' ? 'Pull against it to stop it running!' : '' });
      F.shake(3);
    }
    F.cam?.slowmo?.(0.5, 0.7);
    F.focusCam(fish.x, fish.y, 2.3, 4);
  }

  update(dt, rdt) {
    const F = this.F, f = this.fish, t = (this.t += rdt);
    f.controlled = true;
    if (this.hook) {
      const h = this.hook;
      h.vy += 300 * dt; h.x += h.vx * dt; h.y += h.vy * dt; h.a += dt * 14;
    }
    if (t < 0.35) {
      // recoil
      f.x += -this.dirAway * 30 * dt; f.vx = this.dirAway * 10;
      f.squash = 0.2;
      F.focusCam(f.x, f.y, 2.3, 4);
    } else if (t < 1.55) {
      // the taunt: turn to the player, blabber, wiggle
      const [cxw] = F.toWorld(F.W / 2, F.H / 2);
      f.facing = cxw > f.x ? 1 : -1;
      f.vx = f.facing * 5; f.vy = 0;
      f.lookAt?.(cxw, f.y - 20);
      f.talkT = 0.2;
      f.y += Math.sin(t * 14) * 0.4;
      f.wiggle = 0.4;
      f.feel('smug', 0.5);
      if (!this.said) { this.said = true; F.sfx(f.sp?.sound || 'blub', { pitch: 1.3 }); f.say(rng.pick(['music', 'heart', 'anger', 'sweat']), 1.1); }
      F.focusCam(f.x, f.y - 4, 2.4, 4);
    } else {
      // zip away
      if (!this.zipped) {
        this.zipped = true;
        F.cam?.release?.(2.5);
        F.cam?.setLetterbox?.(false);
        F.restoreScroll();
        F.particles.speedLines(f.x, f.y, 10, { r0: 6, r1: 24, color: '#ffffff', add: false, len: [6, 14] });
        F.sfx('splash_small', { pitch: 1.4 });
      }
      f.vx = this.dirAway * 260; f.vy = -20;
      f.x += f.vx * dt; f.y += f.vy * dt * 0.3;
      if (rng.chance(dt * 30)) F.particles.bubbleTrail(f.x - this.dirAway * 10, f.y, f.vx, 0);
      if (rng.chance(dt * 20)) F.particles.wake(f.x, f.y, this.dirAway > 0 ? 0 : Math.PI, 2);
    }
    if (t > 2.05) {
      F.finishEscape(f, this.reason);
      return 'done';
    }
    return 'ok';
  }

  drawWorld(ctx) {
    const F = this.F;
    const L = this.line;
    if (this.reason === 'snap' && this.t < 0.9) {
      // the broken line whips back toward the rod
      const k = clamp01(this.t / 0.9);
      const n = 40;
      for (let i = 0; i <= n; i++) {
        const s = i / n;
        const bx = lerp(L.x0, L.x1, s), by = lerp(L.y0, L.y1, s);
        const tx = L.x0 + Math.sin(s * 3) * 10, ty = L.y0 + 20 + s * 30;
        const e = ease.outCubic(clamp01(k * 1.6 - s * 0.4));
        const wob = Math.sin(s * 12 - this.t * 30) * (1 - k) * 8 * s;
        const x = lerp(bx, tx, e * s) + wob, y = lerp(by, ty, e * s);
        ctx.fillStyle = rgba(i > n - 3 ? '#ff6a5a' : '#e8f4ff', (1 - k) * 0.9);
        ctx.fillRect(Math.round(x), Math.round(y), 1, 1);
      }
    }
    if (this.hook && this.t < 1.4) {
      const h = this.hook;
      ctx.save();
      ctx.translate(Math.round(h.x), Math.round(h.y));
      ctx.rotate(h.a);
      ctx.drawImage(HOOK, -3, -5);
      ctx.restore();
    }
    void F;
  }

  drawHud(ctx) {
    const F = this.F, f = this.fish, t = this.t;
    if (t > 0.4 && t < 1.6) {
      const [sx, sy] = F.toScreen(f.x, f.y);
      const k = ease.outBack(clamp01((t - 0.4) * 5));
      const text = this.taunt;
      const w = measureText(text, 'normal', 1) + 12, h = 15;
      const bx = Math.round(sx + 16), by = Math.round(sy - 46 - (1 - k) * 8);
      ctx.save();
      ctx.globalAlpha = clamp01((1.6 - t) * 5) * clamp01(k);
      ctx.fillStyle = '#0b1622'; ctx.fillRect(bx - 1, by - 1, w + 2, h + 2);
      ctx.fillStyle = '#ffffff'; ctx.fillRect(bx, by, w, h);
      ctx.fillStyle = '#d8e8f4'; ctx.fillRect(bx, by + h - 2, w, 2);
      for (let i = 0; i < 5; i++) { ctx.fillStyle = '#0b1622'; ctx.fillRect(bx + 4 - i, by + h + i, 2 + (i > 0 ? 1 : 0), 1); ctx.fillStyle = '#ffffff'; if (i < 4) ctx.fillRect(bx + 5 - i, by + h + i, 1, 1); }
      drawText(ctx, text, bx + 6, by + 4 + Math.round(Math.sin(t * 20) * 0.6), { color: '#1e2a38' });
      ctx.restore();
    }
  }
}

// ------------------------------------------------------------------ outro (state is idle again)
export class Outro {
  constructor(F, hasBoat, fish) {
    this.F = F; this.t = 0; this.hasBoat = hasBoat; this.fish = fish;
    this.blocksHook = true;
    this.portrait = hasBoat ? 0 : 1;
    this.released = false;
  }

  update(dt, rdt) {
    const F = this.F, g = F.game;
    this.t += rdt;
    const open = !!g.ui?.isOpen?.('reveal');
    if (open && !this.released) {
      // the reveal card takes over: drop the zoom, keep the photo-op on the boat behind it
      this.released = true;
      F.cam?.release?.(3);
      F.cam?.setLetterbox?.(false);
    }
    if (this.t > 0.6) this.portrait = Math.max(0, this.portrait - rdt * 3);
    if (F.boat && this.hasBoat && !F.poseHold) F.setPose('hold');
    if ((this.t > 0.9 && !open) || this.t > 60) {
      F.cam?.release?.(3);
      F.cam?.setLetterbox?.(false);
      F.restoreScroll();
      if (F.boat) { F.boat.holdFish = null; }
      F.setPose('idle');
      if (F.boat && this.hasBoat) F.setPose('cheer', 1.4);
      return 'done';
    }
    return 'ok';
  }

  drawWorld() {}

  drawHud(ctx) {
    if (this.portrait > 0.01 && this.fish) drawPortrait(ctx, this.F, this.fish, this.portrait, 'hold', this.t);
  }
}

export { drawGlow };
void dist;
