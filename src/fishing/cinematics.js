// Fishing cinematics, Frutiger Aero: glossy jelly titles (FISH ON!, event banners, pops, I GOT IT!,
// SNAP!), the slow-motion landing finale (surface eruption -> arc into the angler's hands -> lens flare,
// bubbles and confetti), the escape cutscene (line whip, comedic taunt) and the outro that hands
// control back to the game. World-space drawing goes through drawWorld(ctx); screen-space through drawHud(ctx).

import { TAU, clamp, clamp01, lerp, damp, ease } from '../core/math.js';
import { rng } from '../core/rng.js';
import { rgba, RARITY } from '../core/color.js';
import { drawText, measureText } from '../gfx/font.js';
import { makeCanvas, ctxOf } from '../core/canvas.js';
import { glowSprite, gbubbleSprite } from '../gfx/particles.js';
import { getUiIcon } from '../gfx/uiicons.js';
import { HOOK } from './baitart.js';
import { drawText3D, text3dSprite } from '../gfx/text3d.js'; // [phase9:fishing] 3D voxel titles
import { gemIcon } from '../gfx/bigicons.js';
import { drawAngler } from './hud.js';

// ------------------------------------------------------------------ glossy jelly text
// Palettes: vertical gradient stops (top -> bottom), outline, outer glow.
export const GLOSS = {
  aqua: { stops: ['#ffffff', '#c8f8ff', '#59c3ff', '#1e8fe0', '#0d6fb8'], outline: '#0c3a52', glow: '#bff8ff' },
  lime: { stops: ['#ffffff', '#ecffc0', '#a6ec5a', '#4fbe2a', '#2a8a1a'], outline: '#0c3a52', glow: '#e2ffb0' },
  sun: { stops: ['#ffffff', '#fff6c0', '#ffd23a', '#ff9d2e', '#e0701a'], outline: '#3a1e06', glow: '#fff2b8' },
  red: { stops: ['#ffffff', '#ffd0c8', '#ff6a5a', '#e0303a', '#a81a2a'], outline: '#2a0610', glow: '#ffb0a8' },
  frost: { stops: ['#ffffff', '#f0f8ff', '#c8dcf0', '#8aa8c8', '#5a7898'], outline: '#0c2a3e', glow: '#e8f4ff' },
  violet: { stops: ['#ffffff', '#f0dcff', '#c89aff', '#8a5ae0', '#5a2ab0'], outline: '#1e0a3a', glow: '#ecd8ff' },
};
const RARITY_GLOSS = { common: 'aqua', uncommon: 'lime', rare: 'aqua', epic: 'violet', legendary: 'sun' };
export function glossFor(rarity) { return RARITY_GLOSS[rarity] || 'aqua'; }

const glossCache = new Map();
// Cached glossy text sprite: gradient fill, specular band, chunky outline, soft glow. Returns {c, ox, oy, w, h}.
export function glossText(text, scale, pal = 'aqua') {
  const key = text + '|' + scale + '|' + pal;
  let s = glossCache.get(key);
  if (s) return s;
  const P = GLOSS[pal] || GLOSS.aqua;
  const ow = Math.max(1, Math.round(scale * 0.55));
  const gw = Math.max(2, Math.round(scale * 1.2));
  const pad = ow + gw + 2;
  const tw = Math.max(1, measureText(text, 'normal', scale)), th = 7 * scale;
  const W = tw + pad * 2, H = th + pad * 2 + 2 * scale;
  // mask
  const m = makeCanvas(W, H), mg = ctxOf(m);
  drawText(mg, text, pad, pad, { scale, color: '#ffffff' });
  // fill: gradient + gloss band + bottom bounce
  const f = makeCanvas(W, H), fg = ctxOf(f);
  fg.drawImage(m, 0, 0);
  fg.globalCompositeOperation = 'source-in';
  const gr = fg.createLinearGradient(0, pad, 0, pad + th);
  P.stops.forEach((c, i) => gr.addColorStop(i / (P.stops.length - 1), c));
  fg.fillStyle = gr;
  fg.fillRect(0, 0, W, H);
  fg.globalCompositeOperation = 'source-atop';
  fg.fillStyle = 'rgba(255,255,255,0.55)';
  fg.fillRect(0, pad, W, Math.round(th * 0.42));
  fg.fillStyle = 'rgba(255,255,255,0.9)';
  fg.fillRect(0, pad + Math.max(1, Math.round(scale * 0.5)), W, Math.max(1, Math.round(scale * 0.5)));
  fg.fillStyle = rgba(P.glow, 0.45);
  fg.fillRect(0, pad + Math.round(th * 0.82), W, Math.round(th * 0.18));
  // outline + glow composite
  const c = makeCanvas(W, H), g = ctxOf(c);
  const tint = (col) => { const t = makeCanvas(W, H), tg = ctxOf(t); tg.drawImage(m, 0, 0); tg.globalCompositeOperation = 'source-in'; tg.fillStyle = col; tg.fillRect(0, 0, W, H); return t; };
  const glowC = tint(P.glow), outC = tint(P.outline), shadow = tint('rgba(6,30,50,0.45)');
  g.globalAlpha = 0.35;
  for (let r = gw + ow; r > ow; r--) for (let a = 0; a < 8; a++) g.drawImage(glowC, Math.round(Math.cos((a / 8) * TAU) * r), Math.round(Math.sin((a / 8) * TAU) * r));
  g.globalAlpha = 1;
  g.drawImage(shadow, ow, ow + Math.max(2, scale));
  for (let dy = -ow; dy <= ow; dy++) for (let dx = -ow; dx <= ow; dx++) if (dx * dx + dy * dy <= ow * ow + 1) g.drawImage(outC, dx, dy);
  g.drawImage(f, 0, 0);
  s = { c, ox: pad, oy: pad, w: tw, h: th };
  if (glossCache.size > 160) glossCache.clear();
  glossCache.set(key, s);
  return s;
}

// Draws glossy text with its top-left (or centre with align) at x, y.
export function drawGlossText(ctx, text, x, y, scale, pal = 'aqua', o = {}) {
  const s = glossText(text, scale, pal);
  if (o.align === 'center') x -= s.w / 2;
  ctx.drawImage(s.c, Math.round(x - s.ox), Math.round(y - s.oy));
  return s;
}

// Old name kept for other modules: chunky title text, now glossy.
export function drawFancyText(ctx, text, x, y, scale, o = {}) {
  drawGlossText(ctx, text, x, y, scale, o.pal || 'aqua', { align: o.align });
}

// Glossy Aero pill with optional rarity stars / icon.
export function drawGlassPill(ctx, cx, y, w, h, col = '#59c3ff', a = 0.92) {
  const x = Math.round(cx - w / 2); y = Math.round(y);
  const r = Math.floor(h / 2);
  ctx.save();
  ctx.globalAlpha *= a;
  for (let i = 0; i < h; i++) {
    const dy = i < r ? r - i - 0.5 : i >= h - r ? i - (h - r) + 0.5 : 0;
    const inset = dy > 0 ? Math.round(r - Math.sqrt(Math.max(0, r * r - dy * dy))) : 0;
    const k = i / Math.max(1, h - 1);
    ctx.fillStyle = '#0c3a52'; ctx.fillRect(x + inset - 1, y + i, w - inset * 2 + 2, 1);
    ctx.fillStyle = k < 0.5 ? rgba('#ffffff', 0.92 - k * 0.6) : rgba(col, 0.55 + k * 0.4);
    ctx.fillRect(x + inset, y + i, w - inset * 2, 1);
    if (k >= 0.5) { ctx.fillStyle = rgba(col, 0.9); ctx.fillRect(x + inset, y + i, w - inset * 2, 1); }
  }
  ctx.fillStyle = '#0c3a52'; ctx.fillRect(x + r, y - 1, w - 2 * r, 1); ctx.fillRect(x + r, y + h, w - 2 * r, 1);
  ctx.fillStyle = 'rgba(255,255,255,0.95)'; ctx.fillRect(x + r, y + 1, w - 2 * r, 1);
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

// Rarity as a row of spinning 3D gems (no 2D pixel stars).
function drawStars(ctx, cx, y, n, t, k = 1, col = '#59c3ff') {
  const px = 14, sw = px + 4;
  for (let i = 0; i < n; i++) {
    const kk = ease.outBack(clamp01((k - i * 0.12) * 3));
    if (kk <= 0) continue;
    const g = gemIcon(col, px);
    if (!g) continue;
    const x = Math.round(cx - (n * sw) / 2 + i * sw + sw / 2), yy = Math.round(y + Math.sin(t * 5 + i) * 1.5);
    ctx.save();
    ctx.translate(x, yy);
    ctx.scale(kk, kk);
    ctx.drawImage(g, -Math.round(g.width / 2), -Math.round(g.height / 2));
    ctx.restore();
  }
}

// ------------------------------------------------------------------ 3D voxel words ([phase9:fishing])
// Every fishing / boss pop-up is extruded Alagard voxel lettering (src/gfx/text3d.js): it pops in with a squash,
// sways in 3D (cached yaw steps), tilts, bobs and throws pixel sparkles. No flat 2D text pop-ups.
const VIOLET3D = { face: ['#fbf0ff', '#d8a8ff', '#a066f0'], bevelL: '#ffffff', bevelD: '#7a3ad0', side: '#5a2ab0', back: '#3a1a7a', outline: '#ffffff' };
const RED3D = { face: ['#fff0ec', '#ff8a7a', '#e8303a'], bevelL: '#ffffff', bevelD: '#b81e2a', side: '#8a1020', back: '#5a0a14', outline: '#ffffff' };
export function pal3d(p) {
  if (p && typeof p === 'object') return p;
  return { aqua: 'aqua', lime: 'leaf', leaf: 'leaf', sun: 'gold', gold: 'gold', red: RED3D, coral: 'coral', frost: 'white', white: 'white', violet: VIOLET3D, sky: 'sky' }[p] || 'aqua';
}

// One 3D word centred on (x, y). o: {t, pop 0..1, scale (screen scale), pal, rot (rad), alpha, wobble, size}
export function word3D(ctx, text, x, y, o = {}) {
  const s = o.scale ?? 1;
  ctx.save();
  ctx.translate(Math.round(x), Math.round(y));
  if (o.rot) ctx.rotate(o.rot);
  if (s !== 1) ctx.scale(s, s);
  const ok = drawText3D(ctx, text, 0, 0, { t: o.t ?? 0, pop: o.pop ?? 1, palette: pal3d(o.pal), size: o.size ?? 16, depth: o.depth ?? 4, wobble: o.wobble ?? 1, alpha: o.alpha, scale: 2 });
  ctx.restore();
  return ok;
}

// Width (screen px at scale 1) of a 3D word, for laying out letters.
export function word3DWidth(text, o = {}) {
  const sp = text3dSprite(text, { size: o.size ?? 16, px: 1, depth: o.depth ?? 4, outline: 1, palette: pal3d(o.pal), scale: 2, yaw: 0, pitch: 14 });
  return sp ? sp.w : text.length * 18;
}

// A word made of separately bouncing 3D letters: they drop in one by one with a jelly squash and keep waving.
export function letters3D(ctx, text, cx, cy, t, o = {}) {
  const s = o.scale ?? 1, gap = 2;
  const ws = [...text].map((ch) => (ch === ' ' ? 14 : word3DWidth(ch, o) - 6) * s);
  const total = ws.reduce((a, w) => a + w + gap, -gap);
  let x = cx - total / 2;
  const landed = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i], w = ws[i];
    if (ch !== ' ') {
      const lt = t - (o.delay ?? 0.1) - i * (o.stagger ?? 0.06);
      if (lt > 0) {
        const k = clamp01(lt / 0.42);
        const drop = (1 - ease.outBounce(k)) * (o.drop ?? 140);
        let sx = 1, sy = 1;
        if (k >= 1) { const e = Math.exp(-(lt - 0.42) * 6) * Math.sin((lt - 0.42) * 26) * 0.22; sx = 1 + e; sy = 1 - e; }
        const wave = k >= 1 ? Math.sin(t * 6 + i * 0.8) * 3 : 0;
        ctx.save();
        ctx.translate(Math.round(x + w / 2), Math.round(cy - drop + wave));
        ctx.rotate(Math.sin(t * 3 + i) * 0.05 * (o.sway ?? 1));
        ctx.scale(sx * s, sy * s);
        drawText3D(ctx, ch, 0, 0, { t: t + i * 0.7, pop: 1, palette: pal3d(o.pal), size: o.size ?? 16, depth: o.depth ?? 5, wobble: 1.4, alpha: o.alpha, scale: 2 });
        ctx.restore();
        if (Math.abs(lt - 0.42) < 0.03) landed.push([x + w / 2, cy, i]);
      }
    }
    x += w + gap;
  }
  return landed;
}

// ------------------------------------------------------------------ titles
const DUR = { fishon: 1.5, banner: 1.5, pop: 1.0, igotit: 2.7, snap: 1.9, escape: 2.0 };

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

  banner(text, color = '#8ff0ff', sub = '', opts = {}) { return this.add('banner', text, { color, sub, ...opts }); }
  pop(text, x, y, color = '#ffffff', opts = {}) {
    if (this.list.filter((o) => o.kind === 'pop').length > 4) this.list.splice(this.list.findIndex((o) => o.kind === 'pop'), 1);
    return this.add('pop', text, { x, y, color, scale: opts.scale || 1, ...opts });
  }

  clear() { this.list.length = 0; }
  has(kind) { return this.list.some((o) => o.kind === kind); }

  update(rdt) {
    const F = this.F, W = F.W, H = F.H;
    for (const it of this.list) {
      it.t += rdt;
      if (it.kind === 'igotit') this.igotitFx(it);
      if (!it.fx) {
        it.fx = true;
        if (it.kind === 'fishon') {
          F.fx.aeroBubbles(W / 2, H * 0.24 + 30, 10, { w: 90, h: 6, speed: [30, 80], sizes: [2, 3, 3, 4, 5] });
          F.fx.pixelBurst?.('sparkle', W / 2, H * 0.22, 12, { ramp: 'white', w: 80, h: 14, layer: 'fg' });
          F.fx.pixelBurst?.('star', W / 2, H * 0.22, 8, { ramp: it.rarity === 'legendary' ? 'gold' : 'aqua', speed: [80, 200], layer: 'fg' });
        } else if (it.kind === 'pop') {
          F.fx.pixelBurst?.('sparkle', it.x, it.y, 5, { ramp: palRamp(it), w: 14, h: 6, layer: 'fg', size: 0 });
        } else if (it.kind === 'banner') {
          F.fx.pixelBurst?.('sparkle', W / 2, H * 0.18, 8, { ramp: palRamp(it), w: 70, h: 8, layer: 'fg' });
        } else if (it.kind === 'snap') {
          F.fx.pixelBurst?.('shard', W / 2, H * 0.28, 14, { ramp: 'red', speed: [80, 220], layer: 'fg' });
        } else if (it.kind === 'escape') {
          F.fx.pixelBurst?.('puff', W / 2, H * 0.26, 8, { ramp: 'white', w: 60, layer: 'fg' });
        }
      }
    }
    this.list = this.list.filter((it) => it.t < it.dur);
  }

  igotitFx(it) {
    const F = this.F, fx = F.fx, W = F.W, H = F.H;
    const cy = H * 0.3;
    if (!it.burst && it.t > 0.12) {
      it.burst = true;
      fx.aeroConfetti(W * 0.5, cy, 80, { spread: Math.PI, speed: [120, 320], life: 3.2, w: 60 });
      fx.confetti(-4, H * 0.55, 30, { dir: -1.0, spread: 0.35, speed: [220, 380], colors: undefined });
      fx.confetti(W + 4, H * 0.55, 30, { dir: -Math.PI + 1.0, spread: 0.35, speed: [220, 380] });
      fx.stars(W * 0.5, cy, 24, { speed: [80, 220], g: 40, w: 90, h: 10 });
      fx.hearts?.(W * 0.5, cy, 8, { speed: [80, 200], w: 40 });
      fx.pixelBurst?.('scale', W * 0.5, cy, 14, { speed: [100, 240], w: 30 });
      fx.pixelBurst?.('ribbon', W * 0.5, cy, 12, { speed: [120, 280], w: 50 });
      fx.splashBurst(W * 0.5, H * 0.62, 2.2, { g: 300 });
      fx.aeroBubbles(W * 0.5, H + 10, 26, { w: W * 0.45, speed: [60, 160], sizes: [3, 4, 5, 6, 8, 10], life: [2, 3.5] });
      F.cam?.flash?.('#f0fcff', 0.6);
    }
    if (it.t > 0.6 && it.t < 2.2 && rng.chance(0.4)) fx.glint(W * 0.5 + rng.float(-150, 150), cy + rng.float(-20, 30), { len: rng.pick([3, 4, 6]) });
    if (it.t > 0.4 && it.t < 2.3 && rng.chance(0.25)) fx.aeroBubbles(rng.float(0, W), H + 8, 1, { speed: [50, 120], sizes: [3, 5, 7, 9] });
    if (!it.rain && it.t > 0.9) { it.rain = true; fx.confetti(W * 0.5, -10, 40, { dir: Math.PI / 2, spread: 1.3, speed: [20, 90], w: W * 0.45, g: 60, life: 2.4, colors: ['#59c3ff', '#2fd3e8', '#bfeaff', '#8be04a', '#c8f56a', '#ffffff', '#ffe27a'] }); }
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

  // FISH ON!: the word slams in from huge, shakes, then sways in 3D.
  drawFishOn(ctx, it) {
    const W = this.F.W, H = this.F.H, t = it.t;
    const a = clamp01((it.dur - t) * 4);
    const k = ease.outBack(clamp01(t * 5));
    const cy = Math.round(H * 0.22);
    ctx.save();
    ctx.globalAlpha = a;
    const jx = t < 0.25 ? rng.int(-3, 3) : 0;
    const big = W < 700 ? 1.6 : 2;
    word3D(ctx, it.text, W / 2 + jx, cy, { t, pop: clamp01(t * 4), scale: lerp(big * 2.2, big, k), pal: glossFor(it.rarity), rot: Math.sin(t * 2.2) * 0.05, wobble: 1.5 });
    ctx.restore();
  }

  // Event banners: a 3D word sweeping in from the right and tilting to a stop.
  drawBanner(ctx, it) {
    const W = this.F.W, H = this.F.H, t = it.t;
    const a = clamp01((it.dur - t) * 5);
    const k = ease.outBack(clamp01(t * 5));
    const cy = Math.round(H * 0.18);
    const x = lerp(W + 240, W / 2, k);
    ctx.save();
    ctx.globalAlpha = a;
    drawGlow(ctx, x, cy, 70, it.color || '#8ff0ff', 0.3 * a);
    word3D(ctx, it.text, x, cy, { t, pal: it.pal || palOf(it.color), scale: W < 700 ? 1 : 1.25, rot: (1 - k) * -0.25 + Math.sin(t * 3) * 0.03 });
    ctx.restore();
  }

  // Small pops (PERFECT!, x3, TOO SLOW!): a 3D word bounces up out of the action and fades.
  drawPop(ctx, it) {
    const t = it.t, k = t / it.dur;
    const s = Math.max(1, it.scale);
    const y = it.y - ease.outCubic(clamp01(t * 2)) * 16;
    ctx.save();
    ctx.globalAlpha = clamp01((1 - k) * 3);
    word3D(ctx, it.text, it.x, y, { t: t * 2, pop: clamp01(t * 6), scale: 0.45 + s * 0.22, pal: palOf(it.color), rot: Math.sin(t * 5) * 0.06 });
    ctx.restore();
  }

  // I GOT IT!: big 3D voxel letters drop in one by one and bounce, in a shower of confetti.
  drawIGotIt(ctx, it) {
    const F = this.F, W = F.W, H = F.H, t = it.t;
    const aIn = clamp01(t * 5) * clamp01((it.dur - t) * 2.2);
    const cx = W / 2, cy = Math.round(H * 0.3);
    const out = clamp01((it.dur - t) * 3);
    ctx.save();
    ctx.globalAlpha = out;
    const landed = letters3D(ctx, it.text, cx, cy - (1 - out) * 30, t, { pal: it.pal || 'lime', scale: W < 700 ? 2 : 2.6 });
    for (const [lx, ly, i] of landed) {
      if (it['land' + i]) continue;
      it['land' + i] = true;
      F.fx.stars(lx, ly + 20, 3, { speed: [30, 80], g: 60 });
      F.fx.aeroBubbles(lx, ly + 20, 2, { w: 4, speed: [30, 60] });
      F.sfx('mash_pop', { pitch: 1 + i * 0.08, vol: 0.5 });
    }
    if (t > 0.75) drawStars(ctx, cx, cy + 46, RARITY[it.rarity]?.stars || 1, t, clamp01((t - 0.75) * 3), RARITY[it.rarity]?.color || '#59c3ff');
    ctx.restore();
  }

  // SNAP!: a red 3D word that cracks in two and falls apart.
  drawSnap(ctx, it) {
    const W = this.F.W, H = this.F.H, t = it.t;
    const a = clamp01((it.dur - t) * 3);
    const cy = Math.round(H * 0.28);
    const j = t < 0.5 ? (0.5 - t) * 10 : 0;
    const split = ease.outCubic(clamp01((t - 0.15) * 3)) * 10;
    const fall = Math.max(0, t - 0.9) * Math.max(0, t - 0.9) * 120;
    const sc = W < 700 ? 1.8 : 2.3;
    ctx.save();
    ctx.globalAlpha = a;
    for (const side of [-1, 1]) {
      ctx.save();
      ctx.beginPath(); ctx.rect(side < 0 ? 0 : W / 2, 0, W / 2, H); ctx.clip();
      word3D(ctx, it.text, W / 2 + side * split + rng.float(-j, j), cy - side * split * 0.4 + fall + rng.float(-j, j), { t, pal: 'red', scale: sc, rot: side * split * 0.012, wobble: 0.5 });
      ctx.restore();
    }
    if (t > 0.05 && t < 0.6) {
      const r = new SeedRng(it.seed || 7);
      ctx.fillStyle = rgba('#ffffff', 0.9 * a * (1 - t / 0.6));
      let y = cy - 30, x = W / 2;
      for (let i = 0; i < 8; i++) {
        const ny = y + 8, nx = W / 2 + (r.next() - 0.5) * 12;
        for (let k = 0; k <= 6; k++) ctx.fillRect(Math.round(lerp(x, nx, k / 6)), Math.round(lerp(y, ny, k / 6)), 2, 2);
        x = nx; y = ny;
      }
    }
    ctx.restore();
  }

  // Escape: frosty 3D letters that droop and sag.
  drawEscape(ctx, it) {
    const W = this.F.W, H = this.F.H, t = it.t;
    const a = clamp01((it.dur - t) * 3) * clamp01(t * 6);
    const cy = Math.round(H * 0.26);
    ctx.save();
    ctx.globalAlpha = a;
    const sc = W < 700 ? 1.5 : 1.9;
    const text = it.text;
    const ws = [...text].map((ch) => (ch === ' ' ? 14 : word3DWidth(ch, { pal: 'frost' }) - 6) * sc);
    let x = W / 2 - ws.reduce((s, w) => s + w + 2, -2) / 2;
    for (let i = 0; i < text.length; i++) {
      const droop = Math.max(0, t - 0.5 - i * 0.05);
      const y = cy + Math.min(16, droop * droop * 40) + Math.sin(t * 3 + i) * 1.5;
      if (text[i] !== ' ') word3D(ctx, text[i], x + ws[i] / 2, y, { t: t + i, pal: 'frost', scale: sc, rot: Math.min(0.3, droop * 0.4) * (i % 2 ? 1 : -1) });
      x += ws[i] + 2;
    }
    ctx.restore();
  }
}

function palOf(color) {
  return color === '#c8f56a' || color === '#7dff9a' || color === '#8be04a' ? 'lime' : color === '#ff8a7a' || color === '#ff9a8a' || color === '#ff6a5a' ? 'red' : color === '#ffe27a' || color === '#ffd0b0' || color === '#fff6c0' ? 'sun' : color === '#c89aff' ? 'violet' : 'aqua';
}
function palRamp(it) {
  const p = it.pal || palOf(it.color);
  return { lime: 'lime', red: 'red', sun: 'gold', violet: 'purple' }[p] || 'cyan';
}

class SeedRng {
  constructor(s) { this.s = s >>> 0 || 1; }
  next() { this.s = (this.s * 1664525 + 1013904223) >>> 0; return this.s / 4294967296; }
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
    this.portrait = 0;
    fish.controlled = true;
    fish.forceAngle = undefined;
    F.cam?.release?.(2.4);
    if (this.hasBoat) F.scrollTo(this.surface - F.H * 0.58);
    F.setPose('pull');
    F.sfx('reel', { pitch: 1.3 });
    F.particles.aeroBubbles?.(fish.x, fish.y, 8, { w: 8 });
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
          F.particles.ringWave?.(f.x, f.y, 40, '#ffffff', { w: 3 });
          F.particles.bubbles(f.x, f.y, 16);
        }
        F.particles.aeroBubbles?.(f.x, sy, 14, { w: 12, speed: [40, 120], sizes: [2, 3, 4, 5, 6] });
        F.particles.splashBurst?.(f.x, sy, 1.4);
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
        F.particles.ringWave?.(hx, hy, 26, '#bff8ff', { w: 3 });
        F.particles.glints?.(hx, hy, 5, { w: 14, h: 10 });
        F.shake(4);
        F.sfx('splash_small');
        F.sfx('magic');
        if (this.hasBoat) F.focusCam(hx, hy - 36, 2.4, 3);
        break;
      }
      case 'igotit': {
        const sp = f.sp;
        if (!F.bossWin) F.titles.add('igotit', 'I GOT IT!', { rarity: sp.rarity, pal: sp.rarity === 'legendary' ? 'sun' : sp.rarity === 'epic' ? 'violet' : 'lime' }); // [phase9:fishing] a boss gets VICTORY!
        F.setPose('hold');
        const [hx, hy] = this.hands();
        F.particles.coins(hx, hy - 6, 10, { speed: [100, 200], floor: this.surface !== null ? this.surface - 1 : null });
        F.particles.aeroConfetti?.(hx, hy - 10, 30, { speed: [80, 200] });
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
        if (rng.chance(rdt * 40)) F.particles.droplets(f.x, f.y, 2, { dir: Math.PI / 2, spread: 1.2, speed: [10, 50], g: 260, w: 6 });
        if (rng.chance(rdt * 18)) F.particles.glint?.(f.x + rng.float(-10, 10) * f.scale, f.y + rng.float(-6, 6), { len: rng.pick([3, 4, 5]) });
        if (rng.chance(rdt * 14)) F.particles.aeroBubbles?.(f.x, f.y, 1, { w: 6, speed: [10, 30], sizes: [2, 3, 4] });
        const mxp = lerp(f.x, hx, 0.4), myp = lerp(f.y, hy, 0.4);
        if (this.hasBoat) F.focusCam(mxp, myp - 10, 1.35, 3.5);
        if (u >= 1) this.go('catch');
        break;
      }
      case 'catch':
        if (this.st > (this.compact ? 0.15 : 0.45)) this.go('igotit');
        break;
      case 'igotit':
        if (this.hasBoat) { const [hx, hy] = this.hands(); F.focusCam(hx, hy - 36, 2.4, 3); }
        if (this.st > (this.compact ? 0.05 : F.bossWin ? 5.2 : 2.4)) return 'caught';
        break;
      default: break;
    }
    if (this.portraitOn) this.portrait = Math.min(1, this.portrait + rdt * 3);
    return 'ok';
  }

  // [catch fx] no light rays / spotlight glow around the catch: the fish, splash and particles carry the moment
  drawWorld() {}

  drawHud(ctx) {
    if (this.portrait > 0.01) drawPortrait(ctx, this.F, this.fish, this.portrait, 'hold', this.rt);
  }
}

// The angler popping up to hold the catch when there is no boat on screen.
function drawPortrait(ctx, F, fish, k, pose, t) {
  const W = F.W, H = F.H;
  const cx = W / 2, by = H * 0.86;
  const a = ease.outBack(clamp01(k));
  ctx.save();
  ctx.globalAlpha = clamp01(k * 2);
  ctx.translate(cx, by + (1 - a) * 80);
  drawAngler(ctx, F, 0, 0, { pose, t, scale: 2, fish: { compiled: fish.c, variant: fish.rec?.variant } });
  ctx.restore();
}

// ------------------------------------------------------------------ escape cutscene
const TAUNTS = ['nyeh~!', 'lol', 'bye!', ':P', 'blub ha!', 'nope!', 'later!', 'ez'];

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
    F.reel.snapped = reason === 'snap' ? 1 : 0;
    if (reason === 'snap') {
      F.titles.add('snap', 'SNAP!', { seed: rng.int(1, 9999) });
      F.shake(9);
      F.cam?.flash?.('#ff8a7a', 0.25);
      F.particles.sparks(line.x1, line.y1, 14, { speed: [40, 140], colors: ['#ffffff', '#e8f4ff', '#ffd25a'] });
    } else {
      const text = reason === 'throw' ? 'SPAT IT!' : reason === 'run' ? 'GONE!' : 'BYE...';
      F.titles.add('escape', text, { icon: reason === 'throw' ? '{crank}' : '' });
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
        F.particles.aeroBubbles?.(f.x, f.y, 6, { w: 6 });
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
  }

  drawHud(ctx) {
    const F = this.F, f = this.fish, t = this.t;
    if (t > 0.4 && t < 1.6) {
      const [sx, sy] = F.toScreen(f.x, f.y);
      const k = ease.outBack(clamp01((t - 0.4) * 5));
      // the taunt: a cheeky 3D word wobbling over the fish, with a trail of bubbles up to it
      const bx = Math.round(sx + 30), by = Math.round(sy - 50 - (1 - k) * 10);
      ctx.save();
      ctx.globalAlpha = clamp01((1.6 - t) * 5) * clamp01(k);
      for (let i = 0; i < 3; i++) { const b = gbubbleSprite(2 + (i > 1 ? 1 : 0)); ctx.drawImage(b, Math.round(sx + 6 + i * 7), Math.round(sy - 14 - i * 10)); }
      word3D(ctx, this.taunt, bx, by, { t: t * 3, pop: clamp01((t - 0.4) * 5), scale: 0.9, pal: 'white', rot: Math.sin(t * 9) * 0.1 });
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
