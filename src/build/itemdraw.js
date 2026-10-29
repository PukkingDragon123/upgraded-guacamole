// Drawing any item (material, blueprint, bait, decor, cosmetic, package, coins, fish record) as a preview.
//
// drawItem(ctx, id, cx, by, {box: [w, h], t, spin, big, rec}) draws the item bottom-centred at (cx, by),
//   fitted inside box. spin = turntable for voxel art. Returns true when something was drawn.
// itemIcon(id, size) -> small cached canvas (cost lists, inline badges) or null while building.
// blueprintSheet(buildId, w, h) -> cached blue blueprint paper with the building drawn in chalk.

import { clamp } from '../core/math.js';
import { makeCanvas, ctxOf, tinted } from '../core/canvas.js';
import { getProp } from '../gfx/props.js';
import { baitSprite } from '../fishing/baitart.js';
import * as CHAR from '../gfx/character.js';
import { SPECIES_BY_ID } from '../fish/species.js';
import { drawFishFit, fitScale } from '../ui/journal.js';
import { ITEMS } from './items.js';
import { itemSprite, packageParts, SPIN } from './itemart.js';
import { buildingSprite } from './buildingmodels.js';

const propFit = new Map();
function fittedProp(id, w, h) {
  const key = id + '|' + w + '|' + h;
  let p = propFit.get(key);
  if (p) return p;
  let s = 0.5;
  let q = getProp(id, { scale: s });
  const k = Math.min(w / q.w, h / q.h);
  if (k < 1 || k > 1.6) { s = clamp(Math.floor(s * k * 20) / 20, 0.1, 1.2); q = getProp(id, { scale: s }); }
  p = q;
  propFit.set(key, p);
  return p;
}

const bldFit = new Map();
function fittedBuilding(id, w, h, yaw = null) {
  const key = id + '|' + w + '|' + h + '|' + yaw;
  let p = bldFit.get(key);
  if (p) return p;
  let s = buildingSprite(id, { scale: 0.3, force: true, yaw });
  if (!s) return null;
  const k = Math.min(w / s.w, h / s.h);
  const sc = clamp(Math.floor(0.3 * k * 40) / 40, 0.08, 2);
  s = buildingSprite(id, { scale: sc, force: true, yaw });
  bldFit.set(key, s);
  return s;
}

// Technical-drawing version of a sprite: chalk-white edges (silhouette + colour breaks), blue fills by tone.
const techCache = new WeakMap();
export function technical(src) {
  let c = techCache.get(src);
  if (c) return c;
  const w = src.width, h = src.height;
  const d = ctxOf(src).getImageData(0, 0, w, h).data;
  c = makeCanvas(w, h);
  const g = ctxOf(c);
  const img = g.createImageData(w, h);
  const o = img.data;
  const lum = (i) => (d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11);
  const A = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : d[(y * w + x) * 4 + 3]);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    if (d[i + 3] < 100) continue;
    const L = lum(i);
    let edge = A(x - 1, y) < 100 || A(x + 1, y) < 100 || A(x, y - 1) < 100 || A(x, y + 1) < 100;
    if (!edge) for (const [ox, oy] of [[1, 0], [0, 1]]) { const j = ((y + oy) * w + x + ox) * 4; if (Math.abs(lum(j) - L) > 52) edge = true; }
    let r, gg, b;
    if (edge) { r = 232; gg = 246; b = 255; } else { const k = L > 150 ? 2 : L > 90 ? 1 : 0; [r, gg, b] = [[34, 86, 160], [52, 110, 190], [84, 146, 216]][k]; }
    o[i] = r; o[i + 1] = gg; o[i + 2] = b; o[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  techCache.set(src, c);
  return c;
}

const sheets = new Map();
export function blueprintSheet(buildId, w, h) {
  const key = buildId + '|' + w + '|' + h;
  let c = sheets.get(key);
  if (c) return c;
  const spr = fittedBuilding(buildId, w - 10, h - 10);
  c = makeCanvas(w, h);
  const g = ctxOf(c);
  g.fillStyle = '#1f5aa8'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#2a68b8';
  for (let x = 3; x < w; x += 6) g.fillRect(x, 0, 1, h);
  for (let y = 3; y < h; y += 6) g.fillRect(0, y, w, 1);
  g.fillStyle = '#9ad0ff'; g.fillRect(1, 1, w - 2, 1); g.fillRect(1, h - 2, w - 2, 1); g.fillRect(1, 1, 1, h - 2); g.fillRect(w - 2, 1, 1, h - 2);
  g.fillStyle = '#163a78'; g.fillRect(0, 0, w, 1); g.fillRect(0, h - 1, w, 1); g.fillRect(0, 0, 1, h); g.fillRect(w - 1, 0, 1, h);
  if (spr) {
    const dx = Math.round(w / 2 - spr.w / 2), dy = Math.round(h - 4 - spr.h);
    g.drawImage(technical(spr.canvas), dx, dy);
  }
  // dog-eared corner
  g.fillStyle = '#0a0a14';
  g.clearRect(w - 5, 0, 5, 1); g.clearRect(w - 4, 1, 4, 1); g.clearRect(w - 3, 2, 3, 1); g.clearRect(w - 2, 3, 2, 1); g.clearRect(w - 1, 4, 1, 1);
  g.fillStyle = '#9ad0ff'; for (let i = 0; i < 5; i++) g.fillRect(w - 5 + i, i, 1, 1);
  g.fillStyle = '#5a8ad0'; g.fillRect(w - 5, 1, 1, 4); g.fillRect(w - 5, 4, 4, 1);
  sheets.set(key, c);
  return c;
}

const icons = new Map();
// Small square icon for cost rows.
export function itemIcon(id, size = 14) {
  const key = id + '|' + size;
  let c = icons.get(key);
  if (c) return c;
  const it = ITEMS[id];
  const art = it?.art || (id === 'coins' ? 'coins' : null);
  let src = null;
  if (art && !art.startsWith('pkg_')) src = itemSprite(art, { scale: 0.5, frame: 0, force: true })?.canvas;
  else if (art) src = packageParts(art.slice(4), 0.5, 0, true, true)?.full;
  else if (it?.kind === 'bait') src = baitSprite(id, 0);
  else if (it?.kind === 'decor') src = fittedProp(id, size * 2, size * 2)?.canvas;
  if (!src) return null;
  c = makeCanvas(size, size);
  const g = ctxOf(c);
  const k = Math.min(1, size / src.width, size / src.height);
  const w = Math.max(1, Math.round(src.width * k)), h = Math.max(1, Math.round(src.height * k));
  g.drawImage(src, Math.round((size - w) / 2), Math.round((size - h) / 2), w, h);
  icons.set(key, c);
  return c;
}

// Draws an item bottom-centred at (cx, by) within box [w, h].
export function drawItem(ctx, id, cx, by, o = {}) {
  const [bw, bh] = o.box || [40, 40];
  const t = o.t || 0;
  const it = ITEMS[id];
  const spinF = o.spin ? Math.floor(t * 7) % SPIN : 0;
  const big = o.big ? 2 : 1;
  if (o.rec) {
    const sp = SPECIES_BY_ID[o.rec.species];
    if (!sp) return false;
    const s = fitScale(sp, bw, bh, o.big ? 3 : 1.5);
    drawFishFit(ctx, sp, cx, by - bh / 2, s, t, { turn: o.spin ? Math.cos(t * 1.4) : 1, emotion: 'happy' }, o.rec.variant || null);
    return true;
  }
  if (!it && id !== 'coins') return false;
  const art = it?.art || (id === 'coins' ? 'coins' : null);
  if (it?.kind === 'package') {
    const psc = big === 2 ? 1.6 : 0.9;
    const p = packageParts(it.tier, psc, o.spin ? spinF : 0, false, true) || packageParts(it.tier, psc, 0, true, true);
    if (!p) return false;
    const k = Math.min(1, bw / p.w, bh / p.h);
    if (p.glow) { ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.5 + 0.3 * Math.sin(t * 3); ctx.drawImage(p.glow, Math.round(cx - p.ox * k), Math.round(by - p.oy * k), Math.round(p.w * k), Math.round(p.h * k)); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; }
    ctx.drawImage(p.full, Math.round(cx - p.ox * k), Math.round(by - p.oy * k), Math.round(p.w * k), Math.round(p.h * k));
    return true;
  }
  if (it?.kind === 'blueprint') {
    if (o.building) {
      const s = fittedBuilding(it.builds, bw, bh, null);
      if (!s) return false;
      ctx.drawImage(s.canvas, Math.round(cx - s.w / 2), Math.round(by - s.h));
      return true;
    }
    const w = Math.min(bw, Math.round(bh * 1.25)), h = Math.min(bh, Math.round(w * 0.82));
    const sheet = blueprintSheet(it.builds, w, h);
    const bob = o.spin ? Math.round(Math.sin(t * 2) * 1) : 0;
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(Math.round(cx - w / 2) + 2, by - h + 2 + bob, w, h);
    ctx.drawImage(sheet, Math.round(cx - w / 2), by - h + bob);
    return true;
  }
  if (art) {
    const sc = big === 2 ? 1.5 : 1;
    const s = itemSprite(art, { scale: sc, frame: spinF });
    if (!s) return false;
    const k = Math.min(1, bw / s.w, bh / s.h);
    if (s.glow) { ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.6; ctx.drawImage(s.glow, Math.round(cx - (s.w * k) / 2), Math.round(by - s.h * k), Math.round(s.w * k), Math.round(s.h * k)); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; }
    ctx.drawImage(s.canvas, Math.round(cx - (s.w * k) / 2), Math.round(by - s.h * k), Math.round(s.w * k), Math.round(s.h * k));
    return true;
  }
  if (it.kind === 'bait') {
    const s = baitSprite(id, t);
    const k = Math.max(1, Math.min(o.big ? 5 : 3, Math.floor(Math.min(bw / s.width, bh / s.height))));
    ctx.drawImage(s, Math.round(cx - (s.width * k) / 2), Math.round(by - s.height * k - (o.spin ? Math.abs(Math.sin(t * 3)) * 2 : 0)), s.width * k, s.height * k);
    return true;
  }
  if (it.kind === 'decor') {
    const p = fittedProp(id, bw, bh);
    if (!p) return false;
    const sw = o.spin ? 0.9 + 0.1 * Math.cos(t * 1.3) : 1;
    const w = Math.round(p.w * sw);
    ctx.drawImage(p.canvas, Math.round(cx - w / 2), Math.round(by - p.h), w, p.h);
    return true;
  }
  if (it.kind === 'cosmetic') {
    const w = CHAR.WARDROBE_BY_ID?.[it.wardrobe];
    if (!w) return false;
    if (w.slot === 'boat') {
      const sz = Math.min(bw, bh) - 6;
      ctx.fillStyle = '#1a1020'; ctx.fillRect(Math.round(cx - sz / 2) - 1, by - sz * 0.6 - 1, sz + 2, Math.round(sz * 0.4) + 2);
      ctx.fillStyle = w.color || '#c8583a'; ctx.fillRect(Math.round(cx - sz / 2), by - sz * 0.6, sz, Math.round(sz * 0.4));
      ctx.fillStyle = w.trim || '#ffffff'; ctx.fillRect(Math.round(cx - sz / 2), by - sz * 0.6, sz, 2);
      return true;
    }
    let pv = null;
    try { pv = CHAR.itemPreview?.(o.look || null, w, o.big ? 1.6 : 0.9, false); } catch { pv = null; }
    if (!pv) return false;
    const k = Math.min(1, bw / pv.w, bh / pv.h);
    const ww = Math.round(pv.w * k), hh = Math.round(pv.h * k);
    ctx.drawImage(pv.canvas, Math.round(cx - ww / 2), Math.round(by - hh), ww, hh);
    return true;
  }
  return false;
}
