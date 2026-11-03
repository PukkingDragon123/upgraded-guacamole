// Small drawing/input helpers shared by the Lab panel views (OWNER: Lab agent).
//   iconBudget(n)                 per-frame budget for rendering new icons (voxel icons are slow to build)
//   icon(key, px) -> canvas|null  labIcon with size buckets + the budget (null while not built yet)
//   anyIcon(name, px)             getUiIcon(name) or a Lab glyph
//   glassCard(ctx, x, y, w, h, o)  frosted white glass card
//   pill(ui, ctx, x, y, w, h, label, o) -> clicked   glossy Aero pill button (o: tone, icon, disabled, tip, active, font)
//   costTiles(ctx, ui, rows, x, y, w) -> height      have/need tiles: rows [{kind:'aero'|'item'|'fish', id, have, need, ok}]
//   statBar(ctx, x, y, w, k, color)
//   orbIcon(ctx, key, cx, cy, r, color, look)      eco orb + icon on top
import { drawText, measureText } from '../gfx/font.js';
import { getUiIcon } from '../gfx/uiicons.js';
import { rgba, mix, shade, RARITY } from '../core/color.js';
import { drawAeroButton, drawAeroCoin, fmtAero, AERO } from './aero.js';
import { labIcon, labIconCached, GLYPHS } from './labicons.js';
import { ecoOrb, roundRectPath } from './labart.js';
import { ITEMS } from '../build/items.js';
import { fishKeyInfo, fishLabel } from '../game/lab.js';

export const INK = '#0c3a52', INK_SOFT = '#3c6f88', OK = '#1f9a3a', BAD = '#e0384a';

const BUCKETS = [8, 10, 12, 14, 16, 18, 20, 24, 28, 32, 40, 48, 56, 64];
export const bucket = (px) => { let b = BUCKETS[0]; for (const q of BUCKETS) if (q <= px) b = q; return b; };
let budget = 6;
export function iconBudget(n = 6) { budget = n; }
export function icon(key, px) {
  if (!key) return null;
  const b = bucket(px);
  const c = labIconCached(key, b);
  if (c !== undefined) return c;
  if (budget <= 0) {
    // a smaller one that is ready is better than nothing
    for (let i = BUCKETS.indexOf(b) - 1; i >= 0; i--) { const s = labIconCached(key, BUCKETS[i]); if (s) return s; }
    return null;
  }
  budget--;
  return labIcon(key, b);
}

export function anyIcon(name, px = 12) {
  return getUiIcon(name) || (GLYPHS.includes(name) ? icon(name, px) : null);
}

export function glassCard(ctx, x, y, w, h, o = {}) {
  ctx.save();
  ctx.fillStyle = rgba('#0a4a7a', 0.12);
  roundRectPath(ctx, x + 1, y + 2, w, h, o.r ?? 8); ctx.fill();
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, rgba('#ffffff', o.alpha ?? 0.96)); g.addColorStop(0.5, rgba('#f2fbff', o.alpha ?? 0.93)); g.addColorStop(1, rgba(o.bottom || '#d6f0fb', o.alpha ?? 0.92));
  ctx.fillStyle = g;
  roundRectPath(ctx, x, y, w, h, o.r ?? 8); ctx.fill();
  // gloss
  ctx.save(); roundRectPath(ctx, x, y, w, h, o.r ?? 8); ctx.clip();
  const gl = ctx.createLinearGradient(0, y, 0, y + Math.min(26, h * 0.4));
  gl.addColorStop(0, rgba('#ffffff', 0.9)); gl.addColorStop(1, rgba('#ffffff', 0));
  ctx.fillStyle = gl; ctx.fillRect(x, y, w, Math.min(26, h * 0.4));
  ctx.restore();
  ctx.strokeStyle = o.edge || '#7fbedd'; ctx.lineWidth = 1;
  roundRectPath(ctx, x + 0.5, y + 0.5, w - 1, h - 1, o.r ?? 8); ctx.stroke();
  ctx.strokeStyle = rgba('#ffffff', 0.9);
  roundRectPath(ctx, x + 1.5, y + 1.5, w - 3, h - 3, Math.max(0, (o.r ?? 8) - 1)); ctx.stroke();
  ctx.restore();
}

export function pill(ui, ctx, x, y, w, h, label, o = {}) {
  const r = { x, y, w, h };
  const hov = !o.disabled && ui.hover(r);
  const down = hov && ui.inp.down;
  drawAeroButton(ctx, x, y, w, h, { label, icon: o.icon || null, tone: o.tone || 'aqua', font: o.font, state: o.disabled ? 'disabled' : down ? 'down' : hov ? 'hover' : o.active ? 'down' : 'normal' });
  if (hov && o.tip) ui.tip = o.tip;
  if (hov) ui.markHot?.('lab' + label + x + y);
  if (!o.disabled && ui.clicked(r)) { ui.game.audio.play(o.sound || 'ui_click'); return true; }
  if (o.disabled && ui.hover(r) && ui.inp.pressed) { ui.inp.pressed = false; ui.game.audio.play('ui_error'); if (o.onDisabled) o.onDisabled(); }
  return false;
}

// One tile per cost: icon + amount (have/need colouring). Returns the height used.
export function costTiles(ctx, ui, rows, x, y, w, o = {}) {
  const tw = o.tileW || 58, th = 20, gap = 3;
  const per = Math.max(1, Math.floor((w + gap) / (tw + gap)));
  rows.forEach((c, i) => {
    const tx = x + (i % per) * (tw + gap), ty = y + Math.floor(i / per) * (th + gap);
    ctx.fillStyle = c.ok ? rgba('#e8fff0', 0.95) : rgba('#ffe8ea', 0.95);
    roundRectPath(ctx, tx, ty, tw, th, 6); ctx.fill();
    ctx.strokeStyle = c.ok ? rgba('#5ac87a', 0.9) : rgba('#ff7a8a', 0.9); ctx.lineWidth = 1;
    roundRectPath(ctx, tx + 0.5, ty + 0.5, tw - 1, th - 1, 6); ctx.stroke();
    let tip = '';
    if (c.kind === 'aero') { drawAeroCoin(ctx, tx + 9, ty + 10, 5, ui.time); tip = 'Aero'; }
    else if (c.kind === 'item') {
      const ic = icon('mat:' + c.id, 14);
      if (ic) ctx.drawImage(ic, Math.round(tx + 9 - ic.width / 2), Math.round(ty + 10 - ic.height / 2));
      tip = ITEMS[c.id]?.name || c.id;
    } else if (c.kind === 'fish') {
      const k = fishKeyInfo(c.id);
      const ic = k.kind === 'biome' ? icon('biome:' + k.id, 14) : icon('fish', 12);
      if (ic) ctx.drawImage(ic, Math.round(tx + 9 - ic.width / 2), Math.round(ty + 10 - ic.height / 2));
      if (k.kind === 'rarity') { ctx.fillStyle = RARITY[k.id]?.color || '#ffffff'; ctx.fillRect(tx + 12, ty + 13, 4, 4); ctx.fillStyle = '#ffffff'; ctx.fillRect(tx + 12, ty + 13, 4, 1); }
      else if (k.kind === 'biome') { const f = icon('fish', 10); if (f) ctx.drawImage(f, tx + 9, ty + 9); }
      tip = fishLabel(c.id) + ' (kept, not in the tank)';
    }
    const txt = c.kind === 'aero' ? fmtAero(c.need) : `${Math.min(c.have, 999)}/${c.need}`;
    const font = measureText(txt) > tw - 22 ? 'small' : 'normal';
    drawText(ctx, txt, tx + 19, ty + (font === 'small' ? 8 : 7), { font, color: c.ok ? OK : BAD });
    if (ui.hover({ x: tx, y: ty, w: tw, h: th })) ui.tip = `${tip}: ${c.kind === 'aero' ? fmtAero(c.need) + ' (you have ' + fmtAero(c.have) + ')' : c.have + ' / ' + c.need}`;
  });
  return Math.ceil(rows.length / per) * (th + gap) - gap;
}

export function statBar(ctx, x, y, w, k, color = AERO.aqua, h = 6) {
  ctx.fillStyle = rgba('#0c3a52', 0.15); roundRectPath(ctx, x, y, w, h, h / 2); ctx.fill();
  const fw = Math.max(h, Math.round(w * Math.max(0, Math.min(1, k))));
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, mix(color, '#ffffff', 0.5)); g.addColorStop(0.5, color); g.addColorStop(1, shade(color, -0.2));
  ctx.fillStyle = g; roundRectPath(ctx, x, y, fw, h, h / 2); ctx.fill();
  ctx.fillStyle = rgba('#ffffff', 0.7); ctx.fillRect(x + 2, y + 1, Math.max(0, fw - 4), 1);
}

export function orbIcon(ctx, key, cx, cy, r, color, look = 'done', alpha = 1) {
  const o = ecoOrb(r, color, look);
  ctx.drawImage(o, Math.round(cx - o.width / 2), Math.round(cy - o.height / 2));
  const ic = icon(key, r * 1.3);
  if (ic) {
    const ga = ctx.globalAlpha;
    if (alpha < 1) ctx.globalAlpha = ga * alpha;
    ctx.drawImage(ic, Math.round(cx - ic.width / 2), Math.round(cy - ic.height / 2));
    ctx.globalAlpha = ga;
  }
}

// Effect / unlock chip: icon + short value. Returns width.
export function chip(ctx, x, y, ic, text, o = {}) {
  const tw = text ? measureText(text, 'small') : 0;
  const w = (ic ? ic.width + 3 : 0) + tw + 8, h = 14;
  ctx.fillStyle = o.bg || rgba('#e6f7ff', 0.95); roundRectPath(ctx, x, y, w, h, 7); ctx.fill();
  ctx.strokeStyle = o.edge || rgba('#7fbedd', 0.9); ctx.lineWidth = 1; roundRectPath(ctx, x + 0.5, y + 0.5, w - 1, h - 1, 7); ctx.stroke();
  let cx = x + 4;
  if (ic) { ctx.drawImage(ic, Math.round(cx), Math.round(y + (h - ic.height) / 2)); cx += ic.width + 3; }
  if (text) drawText(ctx, text, cx, y + 5, { font: 'small', color: o.color || INK });
  return w;
}

// Height costTiles() will use for n rows in width w.
export function costTilesHeight(n, w, tileW = 58) {
  if (!n) return 0;
  const per = Math.max(1, Math.floor((w + 3) / (tileW + 3)));
  return Math.ceil(n / per) * 23 - 3;
}

// Card hero: a glossy display pedestal with a soft glow (draw the icon on top at (cx, cy)).
export function pedestal(ctx, cx, cy, w, t = 0, color = '#bff6ff') {
  const py = cy + Math.round(w * 0.42);
  ctx.save();
  ctx.fillStyle = rgba('#0a4a7a', 0.12);
  ctx.beginPath(); ctx.ellipse(cx, py + 3, w * 0.55, w * 0.13, 0, 0, Math.PI * 2); ctx.fill();
  const g = ctx.createLinearGradient(0, py - 4, 0, py + 6);
  g.addColorStop(0, '#ffffff'); g.addColorStop(1, '#a8dcf2');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.ellipse(cx, py, w * 0.5, w * 0.12, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#6fb4d8'; ctx.lineWidth = 1; ctx.stroke();
  ctx.fillStyle = rgba(color, 0.55);
  ctx.beginPath(); ctx.ellipse(cx, py - 1, w * 0.36, w * 0.07, 0, 0, Math.PI * 2); ctx.fill();
  // light beam up from the pedestal
  const lg = ctx.createLinearGradient(0, py, 0, cy - w * 0.6);
  lg.addColorStop(0, rgba(color, 0.35)); lg.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = lg;
  ctx.beginPath(); ctx.moveTo(cx - w * 0.36, py); ctx.lineTo(cx + w * 0.36, py); ctx.lineTo(cx + w * 0.22, cy - w * 0.6); ctx.lineTo(cx - w * 0.22, cy - w * 0.6); ctx.closePath(); ctx.fill();
  ctx.restore();
  void t;
}
