// Floating boxes (phase 3): hover the hook over a box drifting in the water and click to snag it, then a
// short, light reel (circle the mouse; no fish fighting back) hauls it up, bobbing and splashing, until it
// pops out of the water; fishing then calls game.onBoxCaught(f) (game.js: floaters.take + build.onBoxCaught
// rolls/grants via items.rollCrate, then Fishing.showBoxLoot(f, loot) -> the glossy Aero loot pop-up).
// Without a host onBoxCaught, landBoxLoot rolls (items.rollCrate / openPackage) and grants it itself.
// The World floaters keep drawing a hooked box (f.hooked: fishing owns f.x / f.y); when a host has no
// floater renderer (f.selfDraw) this module draws a glossy pixel box instead.
//
//   new BoxReel(F, f) -> update(dt) 'ok' | 'caught'; drawWorld(ctx); drawHud(ctx); drawBands(ctx); crankHint(); cancel()
//   landBoxLoot(F, f, loot?) -> loot list [{id, qty}]   drawBoxHover(ctx, F, f)    boxSprite(kind, tier)

import { TAU, clamp, clamp01, lerp, damp, ease } from '../core/math.js';
import { rng } from '../core/rng.js';
import { rgba, RARITY } from '../core/color.js';
import { makeCanvas, ctxOf } from '../core/canvas.js';
import { drawText } from '../gfx/font.js';
import { glowSprite, gbubbleSprite } from '../gfx/particles.js';
import * as ITEMS from '../build/items.js';
import { drawGlassPill, drawRays, glossText } from './cinematics.js';

// ------------------------------------------------------------------ box art (glossy pixel sprites)
const TIER_COL = {
  crate: { a: '#c8925a', b: '#7a4a24', hi: '#ffe2b0', band: '#59c3ff', glow: '#bff8ff' },
  iron: { a: '#9aaabc', b: '#4a5868', hi: '#f0f8ff', band: '#2fd3e8', glow: '#bfe8ff' },
  golden: { a: '#ffd04a', b: '#b8780e', hi: '#fff8c8', band: '#ffffff', glow: '#fff2b8' },
  orb: { a: '#b48aff', b: '#5a2ab0', hi: '#f4e8ff', band: '#ff9ae8', glow: '#ff9ae8' },
};
const ART = new Map();
const hexRgb = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
function mixRgb(a, b, t) { const A = hexRgb(a), B = hexRgb(b); return [0, 1, 2].map((i) => Math.round(A[i] + (B[i] - A[i]) * t)); }

function paint(w, h, fn) {
  const c = makeCanvas(w, h), g = ctxOf(c);
  const img = g.createImageData(w, h), d = img.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = fn(x, y);
    if (!v) continue;
    const i = (y * w + x) * 4;
    d[i] = v[0]; d[i + 1] = v[1]; d[i + 2] = v[2]; d[i + 3] = v[3] ?? 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}

// 'crate' (glossy banded crate), 'capsule' (glass pill with a glowing core), 'bottle' (message in a
// bottle), 'orb' (mystery orb). Tier sets the palette.
export function boxSprite(kind = 'crate', tier = 'crate') {
  const key = kind + '|' + tier;
  let c = ART.get(key);
  if (c) return c;
  const T = TIER_COL[tier] || TIER_COL.crate;
  const ink = [12, 58, 82];
  if (kind === 'orb' || kind === 'capsule') {
    const r = kind === 'orb' ? 8 : 7, w = kind === 'orb' ? 17 : 21, h = 17;
    c = paint(w, h, (x, y) => {
      const cx = (w - 1) / 2, cy = (h - 1) / 2;
      const ex = kind === 'capsule' ? Math.max(0, Math.abs(x - cx) - 3) : Math.abs(x - cx);
      const d = Math.hypot(ex, y - cy);
      if (d > r + 0.5) return null;
      if (d > r - 0.6) return [...ink, 255];
      const nx = (x - cx) / r, ny = (y - cy) / r;
      if ((nx + 0.35) ** 2 / 0.08 + (ny + 0.45) ** 2 / 0.03 < 1) return [255, 255, 255, 255];
      const core = Math.hypot(x - cx, y - cy) < r * 0.45;
      const l = clamp01(0.55 - ny * 0.35 - nx * 0.15);
      const col = core ? mixRgb(T.a, '#ffffff', 0.35 + l * 0.4) : mixRgb(T.b, T.a, l);
      return [...col, core ? 255 : 210];
    });
  } else if (kind === 'bottle') {
    c = paint(13, 22, (x, y) => {
      const neck = y < 6, cx = 6;
      const hw = neck ? 2 : y < 8 ? 3 + (y - 6) : 5;
      if (y < 1 || y > 20 || Math.abs(x - cx) > hw) return null;
      if (Math.abs(x - cx) === hw || y === 20 || (neck && y === 1)) return [...ink, 255];
      if (y < 3) return [...hexRgb('#c8925a'), 255]; // cork
      if (x === cx - hw + 1 && y > 7 && y < 17) return [255, 255, 255, 230];
      const paper = !neck && y > 10 && y < 17 && Math.abs(x - cx) < 3;
      if (paper) return (y === 12 || y === 14) && Math.abs(x - cx) < 2 ? [120, 140, 160, 255] : [248, 240, 220, 255];
      return [...mixRgb('#7ff0c8', '#2fa89a', (y - 3) / 18), 170];
    });
  } else {
    c = paint(18, 16, (x, y) => {
      if (x === 0 || x === 17 || y === 0 || y === 15) return (x === 0 || x === 17) && (y === 0 || y === 15) ? null : [...ink, 255];
      const band = y === 7 || y === 8 || x === 8 || x === 9;
      if (band) return [...hexRgb(T.band), 255];
      if (y === 1 || x === 1) return [...hexRgb(T.hi), 255];
      if (y === 14 || x === 16) return [...hexRgb(T.b), 255];
      const plank = tier === 'crate' && y % 4 === 3;
      const l = 0.6 - (y / 16) * 0.3;
      const col = mixRgb(T.b, T.a, plank ? l - 0.25 : l + 0.2);
      if (y < 5 && x > 2 && x < 7) return [...mixRgb(T.a, '#ffffff', 0.55), 255]; // gloss
      return [...col, 255];
    });
  }
  ART.set(key, c);
  return c;
}

// Pulsing glossy ring + glints around a box under the idle hook ("click to snag").
export function drawBoxHover(ctx, F, f) {
  const t = F.t;
  const r = 13 + Math.sin(t * 6) * 1.5;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 0.35 + 0.2 * Math.sin(t * 6);
  ctx.drawImage(glowSprite(18, '#bff8ff'), Math.round(f.x - 18), Math.round(f.y - 18));
  ctx.restore();
  ctx.fillStyle = rgba('#ffffff', 0.9);
  for (let i = 0; i < 24; i++) {
    if (i % 3 === 2) continue;
    const a = (i / 24) * TAU + t * 2;
    ctx.fillRect(Math.round(f.x + Math.cos(a) * r), Math.round(f.y + Math.sin(a) * r), 1, 1);
  }
  if (rng.chance(0.08)) F.particles.glint?.(f.x + rng.float(-8, 8), f.y + rng.float(-6, 6), { len: 3 });
}

// ------------------------------------------------------------------ the light reel
export class BoxReel {
  constructor(F, f) {
    this.F = F; this.f = f;
    f.hooked = true;
    this.t = 0;
    this.kind = f.kind || 'crate';
    this.tier = ITEMS.TIERS?.[f.tier] ? f.tier : 'crate';
    this.progress = 0; this.tension = 0.25; this.reelRate = 0; this.snapT = 0; this.grace = 1;
    this.zone = { lo: 0.2, hi: 1.3 }; this.heavy = 0;
    this.gearMode = 'box'; this.band = { lo: 30, hi: 195 }; this.canCharge = false; this.charge = null;
    this.shockReady = false; this.shockMax = 0; this.charges = 0; this.shockCd = 0; this.shockCdMax = 1;
    this.stunned = false; this.surging = false;
    this.start = { x: f.x, y: f.y };
    this.stage = 'reel';
    this.ang = 0;
    this.hudIn = 0;
    const w = F.world;
    this.surface = w.surfaceY !== null && w.surfaceY !== undefined ? w.surfaceY : null;
    const [rx] = F.rodTip();
    this.target = this.surface !== null ? { x: lerp(f.x, rx, 0.55), y: this.surface + 6 } : { x: f.x, y: F.toWorld(0, F.H * 0.3)[1] };
    this.need = clamp(Math.hypot(this.target.x - f.x, this.target.y - f.y) / 160, 0.8, 2.2) * (this.tier === 'crate' ? 1 : this.tier === 'iron' ? 1.2 : 1.4);
    F.sfx('hookset', { pitch: 1.4, vol: 0.7 });
    F.sfx('click', { pitch: 0.8 });
    F.particles.ringWave?.(f.x, f.y, 18, '#ffffff', { life: 0.35, w: 2 });
    F.particles.aeroBubbles?.(f.x, f.y, 5, { w: 5 });
    F.particles.glints?.(f.x, f.y, 3, { w: 8, h: 6 });
    F.cam?.punch?.(f.x, f.y, 0.05, 0.25);
    F.setPose('yank', 0.3);
    F.setPose('reel');
  }

  crankHint() {
    const [sx, sy] = this.F.toScreen(this.f.x, this.f.y);
    return [clamp(sx - 80, 50, this.F.W - 200), clamp(sy, 60, this.F.H - 80)];
  }

  cancel() { this.f.hooked = false; }

  update(dt) {
    const F = this.F, f = this.f, G = F.gear;
    this.t += dt;
    this.hudIn = Math.min(1, this.hudIn + F.rdt * 3);
    G.load = this.stage === 'reel' ? 12 : 0; G.brake = true;
    if (this.stage === 'reel') {
      const p = G.p;
      const rate = (Math.min(p, 1.1) * 0.75) / this.need;
      this.reelRate = rate;
      this.progress = Math.min(1, this.progress + rate * dt);
      this.tension = damp(this.tension, 0.18 + Math.min(p, 1.2) * 0.32 + Math.sin(this.t * 3) * 0.04, 4, dt);
      const k = ease.inOutQuad(this.progress);
      const bob = Math.sin(this.t * 3.1) * 3 + Math.sin(this.t * 7.3) * 1;
      const sway = Math.sin(this.t * 1.7) * 4 * (1 - k);
      f.x = lerp(this.start.x, this.target.x, k) + sway;
      f.y = lerp(this.start.y, this.target.y, k) + bob * (0.4 + 0.6 * (1 - k));
      this.ang = Math.sin(this.t * 2.4) * 0.18 + (p > 0.2 ? Math.sin(this.t * 14) * 0.05 : 0);
      if (rng.chance(dt * (4 + p * 10))) F.particles.bubbleTrail(f.x, f.y + 5, 0, -60, { n: 1 });
      if (p > 0.3 && rng.chance(dt * 6)) F.particles.aeroBubbles?.(f.x, f.y, 1, { w: 5, sizes: [2, 2, 3] });
      // near the surface it splashes and foams
      if (this.surface !== null && f.y - this.surface < 18) {
        if (rng.chance(dt * 10)) F.particles.foam?.(f.x, this.surface, 1, { spread: 8 });
        if (rng.chance(dt * 5)) F.particles.splash(f.x + rng.float(-6, 6), this.surface, 0.18);
      }
      F.focusCam(lerp(f.x, this.target.x, 0.3), f.y - 10, 1.6, 3);
      if (!F.poseHold) F.setPose(p > 0.08 ? 'reel' : 'pull');
      if (this.progress >= 1) {
        this.stage = 'pop'; this.st = 0;
        this.p0 = [f.x, f.y];
        const sy = this.surface ?? f.y;
        F.particles.eruption?.(f.x, sy, 0.9);
        F.particles.splashBurst?.(f.x, sy, 1);
        F.particles.lightStreaks?.(f.x, sy - 4, 8, { dir: -Math.PI / 2, spread: 1, colors: ['#ffffff', '#bff8ff'] });
        F.sfx('splash_big', { vol: 0.7 });
        F.sfx('jump_out', { pitch: 1.2 });
        F.shake(4);
        F.setPose('yank', 0.35);
      }
    } else if (this.stage === 'pop') {
      this.st += dt;
      this.reelRate = 0;
      this.tension = damp(this.tension, 0.1, 6, dt);
      const u = clamp01(this.st / 0.75);
      const [rx, ry] = F.rodTip();
      const hx = lerp(this.p0[0], rx, 0.6), hy = (this.surface ?? this.p0[1]) - 30;
      const apex = Math.min(this.p0[1], hy) - 46;
      const mx = (this.p0[0] + hx) / 2;
      f.x = (1 - u) * (1 - u) * this.p0[0] + 2 * (1 - u) * u * mx + u * u * hx;
      f.y = (1 - u) * (1 - u) * this.p0[1] + 2 * (1 - u) * u * apex + u * u * hy;
      this.ang += dt * 9;
      if (rng.chance(dt * 30)) F.particles.droplets?.(f.x, f.y, 1, { dir: Math.PI / 2, spread: 1, speed: [10, 40], g: 260 });
      F.focusCam(f.x, f.y, 1.7, 4);
      void ry;
      if (u >= 1) return 'caught';
    }
    return 'ok';
  }

  drawWorld(ctx) {
    const F = this.F, f = this.f;
    const [rx, ry] = F.rodTip();
    if (this.stage === 'reel') F.drawRope(ctx, rx, ry, f.x, f.y - 7, this.tension, true);
    const spr = boxSprite(this.kind, this.tier);
    const T = TIER_COL[this.tier] || TIER_COL.crate;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.3 + 0.15 * Math.sin(this.t * 5);
    ctx.drawImage(glowSprite(16, T.glow), Math.round(f.x - 16), Math.round(f.y - 16));
    ctx.restore();
    f.roll = this.ang * 57.3;
    if (!f.selfDraw) return;
    ctx.save();
    ctx.translate(Math.round(f.x), Math.round(f.y));
    ctx.rotate(this.ang);
    ctx.drawImage(spr, -Math.floor(spr.width / 2), -Math.floor(spr.height / 2));
    ctx.restore();
    // underwater shimmer line
    if (this.surface !== null && f.y > this.surface) {
      ctx.fillStyle = rgba('#ffffff', 0.25);
      ctx.fillRect(Math.round(f.x - spr.width / 2), Math.round(f.y - spr.height / 2) + 1, spr.width, 1);
    }
  }

  drawHud(ctx) {
    // a soft crank-loop hint at the cursor until the player starts circling
    const F = this.F, t = F.t;
    if (F.gear.p > 0.08) return;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU + t * 5;
      ctx.fillStyle = rgba('#ffffff', 0.08 + (i / 12) * 0.6);
      ctx.fillRect(Math.round(F.input.x + Math.cos(a) * 14) - 1, Math.round(F.input.y + Math.sin(a) * 14) - 1, 2, 2);
    }
  }

  drawBands(ctx) {
    const k = clamp01(this.hudIn * 1.2);
    this.F.gear.draw(ctx, this, 1 - Math.pow(1 - k, 3));
  }
}

// ------------------------------------------------------------------ loot
let itemDraw = null, itemDrawLoading = false;
function loadItemDraw() {
  if (itemDraw || itemDrawLoading) return;
  itemDrawLoading = true;
  import('../build/itemdraw.js').then((m) => { itemDraw = m; }).catch(() => { itemDraw = null; });
}

// loot: what the host already rolled and granted ({aero, items} or [{id, qty}]); omitted -> roll + grant here.
export function landBoxLoot(F, f, loot) {
  const g = F.game;
  const tier = ITEMS.TIERS?.[f.tier] ? f.tier : 'crate';
  const biome = g.ocean?.biome?.id || F.world.biome || null;
  const luck = Math.max(0, F.luckMul() - 1);
  const [sx, sy] = F.toScreen(f.x, f.y);
  if (loot) {
    const list = Array.isArray(loot) ? loot : [...(loot.aero ? [{ id: 'coins', qty: loot.aero }] : []), ...(loot.items || [])];
    loadItemDraw();
    F.lootPop = new LootPop(F, list.length ? list : [{ id: 'coins', qty: 0 }], sx, sy, loot.tier || tier);
    return list;
  }
  let list = null;
  try {
    if (typeof ITEMS.rollCrate === 'function') {
      const r = ITEMS.rollCrate(tier, biome, luck);
      if (Array.isArray(r)) list = r;
      else if (r) list = [...(r.aero ? [{ id: 'coins', qty: r.aero }] : []), ...(Array.isArray(r.items) ? r.items : [])];
    }
    if (!list && typeof ITEMS.openPackage === 'function') list = ITEMS.openPackage({ tier, biome });
  } catch (e) { console.error(e); }
  if (!list || !list.length) list = [{ id: 'coins', qty: 5 + rng.int(0, 10) }];
  try {
    if (typeof ITEMS.grantLoot === 'function') ITEMS.grantLoot(g, list, sx, sy);
    else for (const it of list) if (it.id === 'coins') g.addCoins?.(it.qty, sx, sy);
  } catch (e) { console.error(e); }
  loadItemDraw();
  F.lootPop = new LootPop(F, list, sx, sy, tier);
  F.sfx('treasure_open');
  F.sfx('coin_pile', { vol: 0.6 });
  g.emit?.('boxLoot', { box: f, loot: list });
  g.save?.();
  return list;
}

// Glossy Aero loot pop-up: rises from the box, a row of item bubbles with counts; minimal text.
class LootPop {
  constructor(F, list, x, y, tier) {
    this.F = F; this.list = list.slice(0, 6); this.x = x; this.y = y; this.tier = tier;
    this.t = 0; this.dur = 3.2;
    const fx = F.fx;
    fx.aeroConfetti(x, y, 26, { speed: [80, 200] });
    fx.ringWave(x, y, 40, '#bff8ff', { life: 0.5, w: 4 });
    fx.lensFlare(x, y, { cx: F.W / 2, cy: F.H / 2, life: 1, scale: 0.8 });
    fx.coins(x, y, 8, { speed: [100, 200] });
  }

  update(dt) {
    this.t += dt;
    const inp = this.F.input;
    if (this.t > 0.8 && inp.pressed) this.t = Math.max(this.t, this.dur - 0.3);
    if (this.t > 0.3 && this.t < 2.4 && rng.chance(dt * 6)) {
      const [cx, cy] = this.pos();
      this.F.fx.glint(cx + rng.float(-60, 60), cy + rng.float(-14, 14), { len: rng.pick([3, 4, 5]) });
    }
    return this.t >= this.dur ? 'done' : 'ok';
  }

  pos() {
    const F = this.F;
    const k = ease.outCubic(clamp01(this.t / 0.5));
    return [lerp(this.x, F.W / 2, k), lerp(this.y, F.H * 0.36, k)];
  }

  draw(ctx) {
    const F = this.F, t = this.t;
    const a = clamp01(t * 6) * clamp01((this.dur - t) * 3);
    if (a <= 0) return;
    const [cx, cy] = this.pos();
    const n = this.list.length, cell = 46;
    const w = n * cell + 28, h = 62;
    const T = TIER_COL[this.tier] || TIER_COL.crate;
    const pop = ease.outBack(clamp01(t * 3));
    ctx.save();
    ctx.globalAlpha = a;
    drawRays(ctx, cx, cy, 190, 16, t * 0.6, T.glow, 0.1, 0.09);
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.4 * a; ctx.drawImage(glowSprite(90, T.glow), Math.round(cx - 90), Math.round(cy - 90)); ctx.restore();
    ctx.translate(cx, cy);
    ctx.scale(pop, pop);
    // glass tray
    drawGlassPill(ctx, 0, -h / 2, w, h, T.band === '#ffffff' ? '#ffd04a' : T.band, 0.85);
    // header: the box itself on top of the tray
    const spr = boxSprite('crate', this.tier);
    ctx.drawImage(spr, Math.round(-spr.width), Math.round(-h / 2 - spr.height * 2 + 6), spr.width * 2, spr.height * 2);
    for (let i = 0; i < n; i++) {
      const it = this.list[i];
      const ix = Math.round(-w / 2 + 14 + i * cell + cell / 2), iy = 2;
      const k = ease.outBack(clamp01((t - 0.25 - i * 0.12) * 4));
      if (k <= 0) continue;
      ctx.save();
      ctx.translate(ix, iy);
      ctx.scale(k, k);
      const rar = ITEMS.ITEMS?.[it.id]?.rarity || 'common';
      const b = gbubbleSprite(18);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = a * 0.55;
      ctx.drawImage(glowSprite(21, RARITY[rar]?.color || '#bff8ff'), -21, -21);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = a;
      this.drawIcon(ctx, it.id, 0, 0);
      ctx.drawImage(b, -18, -18);
      const label = it.id === 'coins' ? '+' + it.qty : it.qty > 1 ? 'x' + it.qty : '';
      if (label) drawText(ctx, label, 0, 12, { align: 'center', color: '#ffffff', outline: '#0c3a52' });
      ctx.restore();
    }
    ctx.restore();
  }

  drawIcon(ctx, id, x, y) {
    if (id === 'coins') {
      const g = glossText('A', 2, 'aqua');
      ctx.drawImage(gbubbleSprite(9), x - 9, y - 12);
      ctx.drawImage(g.c, Math.round(x - g.w / 2 - g.ox), Math.round(y - 10 - g.oy));
      return;
    }
    let ic = null;
    try { ic = itemDraw?.itemIcon?.(id, 24) || null; } catch (e) { ic = null; }
    if (ic) { ctx.drawImage(ic, Math.round(x - ic.width / 2), Math.round(y - ic.height / 2 - 2)); return; }
    const col = RARITY[ITEMS.ITEMS?.[id]?.rarity || 'common']?.color || '#bff8ff';
    ctx.fillStyle = '#0c3a52'; ctx.fillRect(x - 5, y - 7, 10, 10);
    ctx.fillStyle = col; ctx.fillRect(x - 4, y - 6, 8, 8);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(x - 4, y - 6, 3, 1);
  }
}
