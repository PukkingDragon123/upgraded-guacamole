// [phase9:ui] Cinematic 3D pop-ups: floating extruded-Alagard voxel text (src/gfx/text3d.js) rendered crisply on the
// full-res UI layer (a 2x render as the `.hi` twin), with a pop-in squash, a gentle sway (cached yaw steps), a bob,
// a soft light behind it and a glint of sparkles travelling along the letters. No 2D text boxes.
//   text3dCanvas(text, {palette, size, depth, yaw}) -> canvas | null   (logical size, `.hi` twin; null until the font loads)
//   drawPop3D(ctx, text, cx, cy, {t, pop 0..1, alpha, palette, size, depth, wobble, glow, sparkle}) -> {w, h} | null
//   POP_PALETTE[iconName] -> palette name for a toast icon (cross -> coral, star -> gold ...)
import { text3dSprite } from '../gfx/text3d.js';
import { HI } from '../gfx/hires.js';
import { makeCanvas, ctxOf } from '../core/canvas.js';
import { drawAeroGlow, drawSparkle } from './aero.js';

const cache = new Map();
export function text3dCanvas(text, o = {}) {
  const yaw = Math.round(o.yaw ?? 0), sc = o.scale ?? 1;
  const opt = { size: o.size ?? 16, px: 1, depth: o.depth ?? 3, outline: 1, palette: o.palette || 'aqua' };
  const key = `${text}|${opt.size}|${opt.depth}|${opt.palette}|${yaw}|${sc}`;
  let c = cache.get(key);
  if (c !== undefined) return c;
  const lo = text3dSprite(text, { ...opt, scale: sc, yaw, pitch: 12 });
  if (!lo) return null; // the font is still loading
  const hi = text3dSprite(text, { ...opt, scale: sc * HI, yaw, pitch: 12 });
  c = makeCanvas(lo.w, lo.h);
  ctxOf(c).drawImage(lo.canvas, 0, 0);
  if (hi) {
    const hc = makeCanvas(lo.w * HI, lo.h * HI);
    ctxOf(hc).drawImage(hi.canvas, Math.round((hc.width - hi.w) / 2), Math.round((hc.height - hi.h) / 2));
    Object.defineProperty(c, 'hi', { value: hc, configurable: true });
  }
  cache.set(key, c);
  if (cache.size > 160) cache.delete(cache.keys().next().value);
  return c;
}

export const POP_PALETTE = { cross: 'coral', skull: 'coral', anger: 'coral' }; // everything else: crisp white letters

const backOut = (k) => { const s = 1.70158; k -= 1; return 1 + (s + 1) * k * k * k + s * k * k; };

export function drawPop3D(ctx, text, cx, cy, o = {}) {
  const t = o.t ?? 0, wob = o.wobble ?? 1;
  const yaw = Math.round((Math.sin(t * 1.5 + (o.phase || 0)) * 8 * wob) / 4) * 4;
  const c = text3dCanvas(text, { palette: o.palette, size: o.size, depth: o.depth, yaw, scale: o.scale });
  if (!c) return null;
  const pop = Math.max(0, Math.min(1, o.pop ?? 1));
  const k = pop < 1 ? Math.max(0, backOut(pop)) : 1;
  const sx = k * (pop < 1 ? 1 + (1 - pop) * 0.25 : 1), sy = k * (pop < 1 ? 1 - (1 - pop) * 0.2 : 1);
  const w = c.width * sx, h = c.height * sy;
  if (w < 1 || h < 1) return { w: c.width, h: c.height };
  const bob = Math.sin(t * 2.2 + (o.phase || 0)) * 1.2 * wob;
  const ga = ctx.globalAlpha;
  ctx.globalAlpha = ga * (o.alpha ?? 1);
  if (o.glow !== false) drawAeroGlow(ctx, cx, cy, Math.max(w, h) * 0.6, o.glowColor || '#06264e', o.glowA ?? 0.42);
  ctx.drawImage(c, Math.round((cx - w / 2) * 2) / 2, Math.round((cy - h / 2 + bob) * 2) / 2, Math.round(w * 2) / 2, Math.round(h * 2) / 2);
  // a glint of light running along the letters every couple of seconds
  if (o.sparkle !== false) {
    const q = ((t * 0.55 + (o.phase || 0) * 0.1) % 1.6);
    if (q < 1) drawSparkle(ctx, cx - w / 2 + q * w, cy - h * 0.28 + bob, q > 0.15 && q < 0.85 ? 2 : 1, 0.95);
  }
  ctx.globalAlpha = ga;
  return { w: c.width, h: c.height };
}
