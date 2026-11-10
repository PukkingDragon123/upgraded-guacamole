// Small drawing/input helpers shared by the Lab panel views (OWNER: Lab agent).
//   iconBudget(n)                 per-frame budget for rendering new icons (voxel icons are slow to build)
//   warmLabIcons()                builds one not-yet-cached Lab icon (call while idle so the Lab opens instantly)
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
import * as FISH from '../fish/species.js';
import { compiled } from '../gfx/spritecache.js';
import { drawFishRig } from '../gfx/fishrig.js';

export const INK = '#0c3a52', INK_SOFT = '#3c6f88', OK = '#1f9a3a', BAD = '#e0384a';

const BUCKETS = [8, 10, 12, 14, 16, 18, 20, 24, 28, 32, 40, 48, 56, 64];
export const bucket = (px) => { let b = BUCKETS[0]; for (const q of BUCKETS) if (q <= px) b = q; return b; };
let budget = 6, spent = 0;
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
// n new icons per frame at most, and no more than ~7 ms of icon building per frame (voxel icons are slow)
// [phase9:ui] counts the time spent building, not the time since the frame began (a busy frame no longer starves them)
export function iconBudget(n = 6) { budget = n; spent = 0; }
export function icon(key, px) {
  if (!key) return null;
  const b = bucket(px);
  const c = labIconCached(key, b);
  if (c !== undefined) return c;
  if (budget <= 0 || spent > 7) {
    // a smaller one that is ready is better than nothing
    for (let i = BUCKETS.indexOf(b) - 1; i >= 0; i--) { const s = labIconCached(key, BUCKETS[i]); if (s) return s; }
    return null;
  }
  budget--;
  const t0 = now();
  const c2 = labIcon(key, b);
  spent += now() - t0;
  return c2;
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
      if (k.kind === 'biome') { const ic = icon('biome:' + k.id, 10); if (ic) ctx.drawImage(ic, tx + 2, ty + 2); }
      drawFishThumb(ctx, c.id, tx + 10, ty + 11, 15, ui.time);
      if (k.kind === 'rarity') { ctx.fillStyle = RARITY[k.id]?.color || '#ffffff'; ctx.beginPath(); ctx.arc(tx + 15, ty + 15, 2.5, 0, Math.PI * 2); ctx.fill(); }
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

// Idle pre-warming: the tree's node icons at the default zoom buckets, the tab icons and the rod rack.
let warmList = null, warmI = 0;
export function warmLabIcons(keys) {
  if (!warmList) warmList = keys || [];
  if (warmI >= warmList.length) return false;
  const [k, px] = warmList[warmI++];
  if (labIconCached(k, bucket(px)) === undefined) labIcon(k, bucket(px));
  return true;
}

// A little voxel fish (the game's own fish renderer) standing for a fish cost key: a species, a species of that
// rarity, or one from that ocean. Guarded: the roster can change under us.
const thumbSp = new Map();
function speciesFor(key) {
  if (thumbSp.has(key)) return thumbSp.get(key);
  let sp = null;
  try {
    const all = (FISH.SPECIES || []).filter((s) => s?.look && s.look.kind !== 'chain' && !s.spawn?.hidden);
    const k = fishKeyInfo(key);
    if (k.kind === 'species') sp = k.sp;
    else if (k.kind === 'biome') sp = all.find((s) => s.biome === k.id && s.rarity === 'common') || all.find((s) => s.biome === k.id) || null;
    else sp = all.find((s) => s.rarity === k.id && s.biome === 'oscean') || all.find((s) => s.rarity === k.id) || null;
    sp ||= all[0] || null;
  } catch { sp = null; }
  thumbSp.set(key, sp);
  return sp;
}
export function drawFishThumb(ctx, key, cx, cy, size, t = 0) {
  const sp = speciesFor(key);
  if (!sp) return false;
  try {
    const c = compiled(sp.look, null, sp.id);
    const len = (c.L || 16) * 1.45;
    const s = Math.max(0.12, size / len);
    drawFishRig(ctx, c, {
      x: cx, y: cy, facing: 1, turn: 1, angle: 0, scale: s, squash: 0, bob: 0, swimPhase: (t * 0.8) % 1, tailPhase: (t * 1.5) % 1,
      finPhase: (t * 2) % 1, speed01: 0.3, inflate: 0, lookX: null, lookY: null, blink: 0, emotion: 'happy', mouth: 0, time: t, pri: 2,
    });
    return true;
  } catch { return false; }
}
