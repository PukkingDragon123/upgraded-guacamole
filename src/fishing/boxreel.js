// Floating boxes: art, the hover cue and the loot hand-off. [crate26] Hooking a box is now a full meter fight
// (cratefight.js CrateBattle, the same spin + SHOCK fight as a fish; legs crates and mimics included); the old light
// box reel and its gear gauge are gone. Once landed (cratefight.js CratePop) fishing calls game.onBoxCaught(f)
// (game.js: floaters.take + build.onBoxCaught rolls/grants via items.rollCrate, iron+ boxes become chests for the
// chest-cracking minigame, then Fishing.showBoxLoot(f, loot) -> the glossy Aero loot pop-up).
// Without a host onBoxCaught, landBoxLoot rolls (items.rollCrate / openPackage) and grants it itself.
// The World floaters keep drawing a hooked box (f.hooked: fishing owns f.x / f.y); when a host has no
// floater renderer (f.selfDraw) the crate fight draws a glossy pixel box instead.
//
//   landBoxLoot(F, f, loot?) -> loot list [{id, qty}]   drawBoxHover(ctx, F, f)    boxSprite(kind, tier)

import { TAU, clamp, clamp01, lerp, damp, ease } from '../core/math.js';
import { rng } from '../core/rng.js';
import { rgba, RARITY } from '../core/color.js';
import { makeCanvas, ctxOf } from '../core/canvas.js';
import { drawText } from '../gfx/font.js';
import { glowSprite, gbubbleSprite } from '../gfx/particles.js';
import * as ITEMS from '../build/items.js';
import { drawGlassPill, glossText, word3D } from './cinematics.js';
import { drawIcon3d, chestIconId } from './icons3d.js'; // [phase9:fishing] 3D loot pop-up
import { drawAeroCoin } from '../ui/aero.js';

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

// "Click to snag": four pixel corner brackets that breathe around the box under the idle hook, a soft glow and glints.
// [crate26] (was a dotted ring: no ring effects)
export function drawBoxHover(ctx, F, f) {
  const t = F.t;
  const r = Math.round(11 + Math.max(0, Math.sin(t * 6)) * 2);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 0.3 + 0.15 * Math.sin(t * 6);
  ctx.drawImage(glowSprite(18, '#bff8ff'), Math.round(f.x - 18), Math.round(f.y - 18));
  ctx.restore();
  const x = Math.round(f.x), y = Math.round(f.y);
  for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const cx = x + sx * r, cy = y + sy * r;
    ctx.fillStyle = '#0c3a52';
    ctx.fillRect(Math.min(cx, cx - sx * 4) - 1, cy - 1, 6, 3);
    ctx.fillRect(cx - 1, Math.min(cy, cy - sy * 4) - 1, 3, 6);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(Math.min(cx, cx - sx * 3), cy, 4, 1);
    ctx.fillRect(cx, Math.min(cy, cy - sy * 3), 1, 4);
  }
  if (rng.chance(0.08)) F.particles.glint?.(f.x + rng.float(-8, 8), f.y + rng.float(-6, 6), { len: 3 });
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
    fx.chestOpen?.(x, y, tier === 'golden' || tier === 'orb' ? 'epic' : tier === 'iron' ? 'rare' : 'uncommon', { layer: 'fg' }); // [phase8:ui] pixel chest pop (was a ring wave)
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
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.4 * a; ctx.drawImage(glowSprite(90, T.glow), Math.round(cx - 90), Math.round(cy - 90)); ctx.restore();
    ctx.translate(cx, cy);
    ctx.scale(pop, pop);
    // glass tray
    drawGlassPill(ctx, 0, -h / 2, w, h, T.band === '#ffffff' ? '#ffd04a' : T.band, 0.85);
    // header: the box itself on top of the tray
    if (!drawIcon3d(ctx, chestIconId('pkg_' + this.tier), 0, Math.round(-h / 2 - 16), 40, Math.sin(t * 2))) {
      const spr = boxSprite('crate', this.tier);
      ctx.drawImage(spr, Math.round(-spr.width), Math.round(-h / 2 - spr.height * 2 + 6), spr.width * 2, spr.height * 2);
    }
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
      if (label) word3D(ctx, label, 0, 16, { t: t + i, scale: 0.45, pal: 'white', wobble: 0.5 });
      ctx.restore();
    }
    ctx.restore();
  }

  drawIcon(ctx, id, x, y) {
    if (id === 'coins') {
      drawAeroCoin(ctx, x, y - 2, 9, this.t || 0);
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
