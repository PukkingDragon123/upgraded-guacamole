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
import { drawAeroButton, drawGlossOrb } from '../ui/aero.js';

export const INK = '#0c3a52';
export const INK_SOFT = '#3c6f88';
export const SKY = '#59c3ff';
export const AQUA = '#2fd3e8';
export const GRASS = '#5cc832';
export const ORANGE = '#ff9d2e';

export function rrect(ctx, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
}

export function pill(ctx, x, y, w, h, o = {}) {
  const c = o.color || AQUA;
  const r = o.r ?? h / 2;
  ctx.save();
  if (o.alpha !== undefined) ctx.globalAlpha *= o.alpha;
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, shade(c, 0.32));
  g.addColorStop(0.5, c);
  g.addColorStop(1, o.color2 || shade(c, -0.22));
  rrect(ctx, x, y, w, h, r); ctx.fillStyle = g; ctx.fill();
  if (o.gloss !== false) {
    ctx.save(); rrect(ctx, x, y, w, h, r); ctx.clip();
    const s = ctx.createLinearGradient(0, y, 0, y + h * 0.5);
    s.addColorStop(0, 'rgba(255,255,255,0.75)'); s.addColorStop(1, 'rgba(255,255,255,0.12)');
    rrect(ctx, x + 1.5, y + 1, w - 3, h * 0.48, Math.max(0, r - 1.5)); ctx.fillStyle = s; ctx.fill();
    ctx.restore();
  }
  rrect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, r); ctx.strokeStyle = o.edge || 'rgba(255,255,255,0.85)'; ctx.lineWidth = 1; ctx.stroke();
  ctx.restore();
}

export function glassCard(ctx, x, y, w, h, o = {}) {
  const r = o.r ?? 6;
  ctx.save();
  if (o.shadow !== false) { rrect(ctx, x + 1, y + 2, w, h, r); ctx.fillStyle = 'rgba(8,50,80,0.16)'; ctx.fill(); }
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, o.top || 'rgba(255,255,255,0.92)');
  g.addColorStop(1, o.bottom || 'rgba(214,240,252,0.88)');
  rrect(ctx, x, y, w, h, r); ctx.fillStyle = g; ctx.fill();
  if (o.gloss !== false) {
    ctx.save(); rrect(ctx, x, y, w, h, r); ctx.clip();
    const s = ctx.createLinearGradient(0, y, 0, y + Math.min(h, 30) * 0.6);
    s.addColorStop(0, 'rgba(255,255,255,0.7)'); s.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = s; ctx.fillRect(x, y, w, Math.min(h, 30) * 0.6);
    ctx.restore();
  }
  rrect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, r); ctx.strokeStyle = o.edge || 'rgba(120,190,225,0.9)'; ctx.lineWidth = 1; ctx.stroke();
  ctx.restore();
}

export function burst(ctx, cx, cy, r, text, t = 0, o = {}) {
  const n = o.points || 12;
  const rot = (o.rot ?? -0.22) + Math.sin(t * 2) * 0.04;
  const c = o.color || '#ff8a1e';
  ctx.save();
  ctx.translate(Math.round(cx), Math.round(cy));
  ctx.rotate(rot);
  const pulse = 1 + Math.sin(t * 5) * 0.04;
  ctx.scale(pulse, pulse);
  ctx.beginPath();
  for (let i = 0; i < n * 2; i++) {
    const a = (i / (n * 2)) * TAU, rr = i % 2 ? r * 0.8 : r;
    ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  ctx.closePath();
  const g = ctx.createRadialGradient(-r * 0.3, -r * 0.4, 1, 0, 0, r);
  g.addColorStop(0, shade(c, 0.45)); g.addColorStop(1, shade(c, -0.1));
  ctx.fillStyle = g; ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 1; ctx.stroke();
  ctx.beginPath(); ctx.ellipse(-r * 0.15, -r * 0.42, r * 0.55, r * 0.22, 0, 0, TAU); ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fill();
  drawText(ctx, text, 0, -3, { align: 'center', font: o.font || 'small', color: o.ink || '#ffffff', shadow: rgba(shade(c, -0.5), 0.8) });
  ctx.restore();
}

export function tag(ctx, x, y, text, color = AQUA, ink = '#ffffff') {
  const w = measureText(text, 'small') + 7;
  pill(ctx, x, y, w, faceOf('small') === 'small' ? 9 : 11, { color, r: 3 }); // [phase8:ui] fits the bigger small text
  drawText(ctx, text, x + 4, y + 2, { font: 'small', color: ink });
  return w;
}

export function statBar(ctx, x, y, w, h, k, color = GRASS) {
  k = Math.max(0, Math.min(1, k || 0));
  ctx.save();
  rrect(ctx, x, y, w, h, h / 2); ctx.fillStyle = 'rgba(12,58,82,0.18)'; ctx.fill();
  if (k > 0.01) {
    const ww = Math.max(h, w * k);
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, shade(color, 0.35)); g.addColorStop(1, shade(color, -0.1));
    rrect(ctx, x, y, ww, h, h / 2); ctx.fillStyle = g; ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.fillRect(x + 2, y + 1, Math.max(0, ww - 4), Math.max(1, Math.floor(h / 3)));
  }
  rrect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, h / 2); ctx.strokeStyle = 'rgba(255,255,255,0.75)'; ctx.lineWidth = 1; ctx.stroke();
  ctx.restore();
}

export function toggle(ctx, x, y, on, k = on ? 1 : 0) {
  const w = 34, h = 16;
  pill(ctx, x, y, w, h, { color: mix('#9aaab8', GRASS, k) });
  drawText(ctx, on ? 'ON' : 'OFF', on ? x + 7 : x + w - 7, y + 5, { font: 'small', color: '#ffffff', align: on ? 'left' : 'right' });
  const cx = x + 8 + k * (w - 16);
  drawGlossOrb(ctx, cx, y + h / 2, 6.5, '#f4fbff');
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
  const g = mg.createLinearGradient(0, 2, 0, h - 2);
  g.addColorStop(0, top); g.addColorStop(0.48, mix(top, bottom, 0.35)); g.addColorStop(0.52, bottom); g.addColorStop(1, shade(bottom, -0.2));
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
  if (o.active) { rrect(ctx, x - 1.5, y - 1.5, w + 3, h + 3, (h + 3) / 2); ctx.strokeStyle = 'rgba(255,255,255,0.95)'; ctx.lineWidth = 1; ctx.stroke(); }
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
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(cx - r * 0.38, cy - r * 0.38); ctx.lineTo(cx + r * 0.38, cy + r * 0.38);
    ctx.moveTo(cx + r * 0.38, cy - r * 0.38); ctx.lineTo(cx - r * 0.38, cy + r * 0.38); ctx.stroke();
  } else if (o.glyph) drawText(ctx, o.glyph, cx, cy - 3, { align: 'center', font: 'small', color: '#ffffff' });
  if (hov && o.tip) ui.tip = o.tip;
  if (ui.clicked(rect)) { ui.game?.audio?.play(o.sound || 'ui_click'); return true; }
  return false;
}
