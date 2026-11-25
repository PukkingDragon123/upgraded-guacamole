// Frutiger Aero / Web 2.0 drawing kit shared by AppSea, the Bait panel and the Multiplayer panel
// (OWNER: Online & AppSea agent). Builds on src/ui/aero.js (drawAeroPanel/drawAeroButton/drawGlossOrb) and adds
// glossy pills, glass cards, starburst "beta" badges, reflections, gradient word-art, toggles and stat bars.
//   rrect(ctx, x, y, w, h, r)                       rounded-rect path
//   pill(ctx, x, y, w, h, {color, color2, gloss, edge, r, alpha})   glossy capsule fill
//   glassCard(ctx, x, y, w, h, {r, top, bottom, edge, shadow, gloss})
//   burst(ctx, cx, cy, r, text, t, {color, ink, points, rot})       Web 2.0 starburst sticker
//   tag(ctx, x, y, text, color, ink) -> width       small glossy rounded tag
//   statBar(ctx, x, y, w, h, k, color)               glossy meter
//   toggle(ctx, x, y, on, k)                         glossy on/off switch (34x16)
//   reflect(ctx, canvas, x, y, h, alpha)             fading mirror image under a sprite
//   wordArt(text, {scale, top, bottom, edge}) -> canvas (cached gradient pixel text)
//   button(ui, ctx, x, y, w, h, label, {tone, icon, disabled, tip, sound}) -> clicked   (Aero pill button widget)
//   INK, INK_SOFT, colours

import { drawText, measureText, faceOf } from '../gfx/font.js';
import { shade, rgba, mix } from '../core/color.js';
import { makeCanvas, ctxOf } from '../core/canvas.js';
import { TAU } from '../core/math.js';
import { drawAeroButton, drawGlossOrb, drawAeroSurface, drawAeroBar, pixelRectPath, pixelRect, pixelShadow, pixelHalo, notchOf, pixelGradient } from '../ui/aero.js';

export const INK = '#0c3a52';
export const INK_SOFT = '#3c6f88';
export const SKY = '#59c3ff';
export const AQUA = '#2fd3e8';
export const GRASS = '#5cc832';
export const ORANGE = '#ff9d2e';

// [pixui30] everything below is PIXEL ART: stepped corners, dark 1 px outline, light bevel, flat bands (aero.js)
export function rrect(ctx, x, y, w, h, r) { pixelRectPath(ctx, x, y, w, h, r); }

// '#rrggbb' or 'rgba(r,g,b,a)' -> ['#rrggbb', alpha]
function hexA(c, fb = '#ffffff') {
  if (!c) return [fb, 1];
  if (c[0] === '#') return [c.length === 4 ? '#' + c[1] + c[1] + c[2] + c[2] + c[3] + c[3] : c.slice(0, 7), 1];
  const m = c.match(/rgba?\(([^)]+)\)/);
  if (!m) return [fb, 1];
  const q = m[1].split(',').map((v) => parseFloat(v));
  const h2 = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return ['#' + h2(q[0]) + h2(q[1]) + h2(q[2]), q[3] ?? 1];
}

export function pill(ctx, x, y, w, h, o = {}) {
  const c = hexA(o.color || AQUA)[0];
  const ga = ctx.globalAlpha;
  if (o.alpha !== undefined) ctx.globalAlpha = ga * o.alpha;
  const r = o.r ?? 'pill';
  const edge = o.edge ? hexA(o.edge)[0] : shade(c, -0.6);
  drawAeroSurface(ctx, x, y, w, h, { top: shade(c, 0.32), mid: c, bot: hexA(o.color2 || shade(c, -0.22))[0], edge, r: typeof r === 'number' ? Math.round(r) : r, gloss: o.gloss === false ? 0 : 0.55, glossH: Math.round(h * 0.42), rim: h >= 6 ? 0.9 : 0, glow: 0.3 });
  ctx.globalAlpha = ga;
}

export function glassCard(ctx, x, y, w, h, o = {}) {
  const r = o.r ?? 6;
  const [top, a0] = hexA(o.top || 'rgba(255,255,255,0.92)'), [bot, a1] = hexA(o.bottom || 'rgba(214,240,252,0.88)');
  if (o.shadow !== false) pixelShadow(ctx, x, y, w, h, 1, 2, { n: notchOf(r, w, h), alpha: 0.16, color: '#083250' });
  drawAeroSurface(ctx, x, y, w, h, { top, mid: mix(top, bot, 0.4), bot, a: [a0, a1], edge: o.edge ? hexA(o.edge)[0] : '#4a8eb8', r, gloss: o.gloss === false ? 0 : 0.4, glossH: Math.min(18, Math.round(h * 0.3)), rim: 0.9, glow: 0.25 });
}

// a pixel 'sale' sticker: a stepped octagon (no star rays, no rotation) with a light bevel and the text
export function burst(ctx, cx, cy, r, text, t = 0, o = {}) {
  const c = o.color || '#ff8a1e';
  const s = Math.max(9, Math.round(r * 2));
  const bob = Math.sin(t * 5) > 0.6 ? -1 : 0;
  pixelRect(ctx, Math.round(cx - s / 2), Math.round(cy - s / 2) + bob, s, s, s >= 18 ? 12 : 4, c, { outline: shade(c, -0.55), hi: shade(c, 0.45), lo: shade(c, -0.2) });
  drawText(ctx, text, Math.round(cx), Math.round(cy - 3) + bob, { align: 'center', font: o.font || 'small', color: o.ink || '#ffffff', shadow: rgba(shade(c, -0.5), 0.8) });
}

export function tag(ctx, x, y, text, color = AQUA, ink = '#ffffff') {
  const w = measureText(text, 'small') + 7;
  pill(ctx, x, y, w, faceOf('small') === 'small' ? 9 : 11, { color, r: 3 }); // [phase8:ui] fits the bigger small text
  drawText(ctx, text, x + 4, y + 2, { font: 'small', color: ink });
  return w;
}

export function statBar(ctx, x, y, w, h, k, color = GRASS) {
  drawAeroBar(ctx, x, y, w, Math.max(4, h), k, { color });
}

export function toggle(ctx, x, y, on, k = on ? 1 : 0) {
  const w = 34, h = 16;
  pill(ctx, x, y, w, h, { color: mix('#9aaab8', GRASS, k) });
  drawText(ctx, on ? 'ON' : 'OFF', on ? x + 7 : x + w - 7, y + 5, { font: 'small', color: '#ffffff', align: on ? 'left' : 'right' });
  const kx = Math.round(x + 2 + k * (w - 16));
  drawAeroSurface(ctx, kx, y + 2, 12, 12, { tone: 'white', edge: '#3a6a8a', r: 2, gloss: 0.5, glossH: 5, rim: 1, glow: 0.2 }); // square pixel knob
  return { x, y, w, h };
}

export function reflect(ctx, canvas, x, y, h = 10, alpha = 0.3, sw = null) {
  if (!canvas) return;
  const H = canvas.height, W = canvas.width, dw = sw || W, k = dw / W;
  const base = ctx.globalAlpha;
  for (let i = 0; i < h; i++) {
    const sy = H - 1 - Math.floor(i / k);
    if (sy < 0) break;
    ctx.globalAlpha = base * alpha * (1 - i / h);
    ctx.drawImage(canvas, 0, sy, W, 1, Math.round(x), Math.round(y + i), dw, 1);
  }
  ctx.globalAlpha = base;
}

const WA = new Map();
export function wordArt(text, o = {}) {
  const scale = o.scale || 2, top = o.top || '#ffffff', bottom = o.bottom || '#38c8f0', edge = o.edge || '#0a5a8a';
  const key = [text, scale, top, bottom, edge, o.font || 'normal'].join('|');
  let c = WA.get(key);
  if (c) return c;
  const w = measureText(text, o.font || 'normal', scale) + 4, h = (o.font === 'small' ? 5 : 9) * scale + 4;
  const mask = makeCanvas(w, h), mg = ctxOf(mask);
  drawText(mg, text, 2, 2, { font: o.font, scale, color: '#ffffff' });
  mg.globalCompositeOperation = 'source-in';
  const g = pixelGradient(mg, 0, 2, 0, h - 2, [[0, top], [0.48, mix(top, bottom, 0.35)], [0.52, bottom], [1, shade(bottom, -0.2)]], 4); // [pixui30] banded
  mg.fillStyle = g; mg.fillRect(0, 0, w, h);
  c = makeCanvas(w, h);
  const cg = ctxOf(c);
  // outline
  const ol = makeCanvas(w, h), og = ctxOf(ol);
  drawText(og, text, 2, 2, { font: o.font, scale, color: edge, outline: edge });
  cg.drawImage(ol, 0, 0);
  cg.drawImage(mask, 0, 0);
  WA.set(key, c);
  return c;
}

// Aero pill button (immediate mode). Returns true when clicked.
export function button(ui, ctx, x, y, w, h, label, o = {}) {
  const r = { x, y, w, h };
  const hov = !o.disabled && ui.hover(r);
  const down = hov && ui.inp?.down;
  drawAeroButton(ctx, x, y, w, h, { label, icon: o.icon || null, tone: o.tone || 'aqua', state: o.disabled ? 'disabled' : down ? 'down' : hov || o.active ? 'hover' : 'normal' });
  if (o.active) pixelHalo(ctx, x, y, w, h, 2, '#ffffff', 0.95);
  if (hov && o.tip) ui.tip = o.tip;
  if (!o.disabled && ui.clicked(r)) { ui.game?.audio?.play(o.sound || 'ui_click'); return true; }
  if (o.disabled && ui.hover(r) && ui.inp?.pressed) { ui.inp.pressed = false; ui.game?.audio?.play('ui_error'); }
  return false;
}

// Small round glass icon button (e.g. close). Returns true when clicked.
export function orbButton(ui, ctx, cx, cy, r, color, o = {}) {
  const rect = { x: cx - r, y: cy - r, w: r * 2, h: r * 2 };
  const hov = ui.hover(rect);
  drawGlossOrb(ctx, cx, cy, r + (hov ? 0.5 : 0), hov ? shade(color, 0.12) : color);
  if (o.glyph === 'x') {
    // a pixel X (2 px wide diagonal runs)
    ctx.fillStyle = '#ffffff';
    const n = Math.max(2, Math.round(r * 0.4)), x0 = Math.round(cx), y0 = Math.round(cy);
    for (let i = -n; i <= n; i++) { ctx.fillRect(x0 + i - 1, y0 + i - 1, 2, 2); ctx.fillRect(x0 - i - 1, y0 + i - 1, 2, 2); }
  } else if (o.glyph) drawText(ctx, o.glyph, cx, cy - 3, { align: 'center', font: 'small', color: '#ffffff' });
  if (hov && o.tip) ui.tip = o.tip;
  if (ui.clicked(rect)) { ui.game?.audio?.play(o.sound || 'ui_click'); return true; }
  return false;
}
