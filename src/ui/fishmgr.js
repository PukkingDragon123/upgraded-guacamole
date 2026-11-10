// Fish management (phase 7, Tank agent): a big glossy Aero panel listing every fish you own, in the cube tank and in
// storage (the holding bucket), with hand-made-looking pixel thumbnails (the fish API's icon, shrunk to logical pixels
// with a dark outline), name, species, rarity, size, mutation / shiny, happiness and hunger bars and Aero per minute.
//   - sort (rarity, Aero/min, size, happiness, hunger, name, newest, species) and filter (tank / storage, rarity,
//     favourites, special)
//   - rename (type in place), favourite, move between tank and storage (capacity respected), release with confirm,
//     feed all, breed (pick a partner), "See" (the tank camera glides to the fish and follows it)
//   - bulk actions on checked fish (to tank, to storage, favourite, release; favourites are never bulk-released)
// Panel id 'fishmgr' (key F, the tank dock's Fish button, the HUD's My Fish button). Uses game.aquarium: fishOf,
// moveFish, releaseFish, feedAll, canBreed, breedPair, focusFish, rateOf, capacity, tankCount.
//
//   registerFishManager(ui)   registers the panel and its HUD icon model

import { clamp, clamp01, rectContains } from '../core/math.js';
import { RARITY, RARITY_ORDER } from '../core/color.js';
import { drawText, measureText } from '../gfx/font.js';
import { getUiIcon } from '../gfx/uiicons.js';
import { SPECIES_BY_ID } from '../fish/species.js';
import { MUTATIONS, valueMultiplier } from '../fish/traits.js';
import * as FISHICON from '../fish/fishicon.js';
import { MeshBuilder } from '../gfx/lowpoly.js';
import { ICON_MODELS } from '../gfx/iconmeshes.js';
import { AERO, fmtAero, drawAeroSurface, drawAeroButton, drawAeroBar, drawAeroCoin, drawSparkle, uiK } from './aero.js';
import { panelRect } from './ui.js';

const SORTS = [
  ['rarity', 'Rarity'], ['aero', 'Aero/min'], ['size', 'Size'], ['happy', 'Happiness'], ['hunger', 'Hunger'], ['name', 'Name'], ['newest', 'Newest'], ['species', 'Species'],
];
const PLACES = [['all', 'All'], ['tank', 'Tank'], ['storage', 'Storage']];
const INK = AERO.ink || '#0c3a52', SOFT = '#3c6f88';
const RELEASE_VALUE = { common: 4, uncommon: 10, rare: 30, epic: 90, legendary: 300 };

// ------------------------------------------------------------------ pixel-art fish thumbnails
const THUMBS = new Map();
let budget = 0;
function fishThumb(rec, w, h) {
  const sp = SPECIES_BY_ID[rec.species];
  if (!sp) return null;
  const v = rec.variant || {};
  const key = `${sp.id}|${v.mutation || ''}|${v.shiny ? 1 : 0}|${w}x${h}`;
  let c = THUMBS.get(key);
  if (c !== undefined) return c;
  if (budget <= 0) return null;
  budget--;
  try {
    const make = FISHICON.voxelFishIcon || FISHICON.lowpolyFishIcon;
    const src = make ? make(sp, w - 2, h - 2, { variant: rec.variant || null, yaw: 14 }) : null;
    c = src ? pixelOutline(src, w, h) : null;
  } catch (e) { console.warn('fish thumb', sp.id, e); c = null; }
  THUMBS.set(key, c);
  if (THUMBS.size > 300) THUMBS.delete(THUMBS.keys().next().value);
  return c;
}
// shrink to logical pixels (no smoothing), snap alpha, add a dark selective outline: reads as hand-made pixel art
function pixelOutline(src, w, h) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = true;
  g.drawImage(src, 1, 1, w - 2, h - 2);
  const img = g.getImageData(0, 0, w, h), d = img.data;
  const a = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) a[i] = d[i * 4 + 3] > 100 ? 1 : 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, o = i * 4;
    if (a[i]) { d[o + 3] = 255; continue; }
    const n = (x > 0 && a[i - 1]) || (x < w - 1 && a[i + 1]) || (y > 0 && a[i - w]) || (y < h - 1 && a[i + w]);
    if (n) { d[o] = 14; d[o + 1] = 40; d[o + 2] = 64; d[o + 3] = 240; } else d[o + 3] = 0;
  }
  g.putImageData(img, 0, 0);
  return c;
}

// ------------------------------------------------------------------ the HUD icon: a glossy glass cube with a fish
function cubeFishIcon() {
  const mb = new MeshBuilder(), glass = new MeshBuilder(), over = new MeshBuilder();
  const q = (a, b, c, d, col) => mb.quad(a, b, c, d, col);
  const s = 0.72, w = -0.45;
  // water block (front, top, right faces) + sand
  q([-s, -s, s], [s, -s, s], [s, w, s], [-s, w, s], '#e8d8a8');
  q([s, -s, s], [s, -s, -s], [s, w, -s], [s, w, s], '#d4c08e');
  q([-s, w, s], [s, w, s], [s, s * 0.7, s], [-s, s * 0.7, s], '#3ab8f0');
  q([s, w, s], [s, w, -s], [s, s * 0.7, -s], [s, s * 0.7, s], '#2a98d8');
  q([-s, s * 0.7, s], [s, s * 0.7, s], [s, s * 0.7, -s], [-s, s * 0.7, -s], '#8ae8ff');
  // an orange fish on the front glass
  const f = (pts, col) => { for (let i = 1; i < pts.length - 1; i++) over.tri(pts[0], pts[i], pts[i + 1], col); };
  const z = s + 0.05;
  f([[-0.42, 0.05, z], [-0.2, 0.25, z], [0.18, 0.22, z], [0.3, 0.05, z], [0.18, -0.13, z], [-0.2, -0.15, z]], '#ff8a2a');
  f([[0.26, 0.05, z], [0.5, 0.26, z], [0.46, 0.05, z], [0.5, -0.16, z]], '#ff6a1a');
  f([[-0.3, 0.1, z + 0.01], [-0.26, 0.14, z + 0.01], [-0.22, 0.1, z + 0.01]], '#14202e');
  // glass shell with thick edges
  const g = 0.8;
  glass.quad([-g, -g, g], [g, -g, g], [g, g, g], [-g, g, g], '#e8fcff');
  glass.quad([g, -g, g], [g, -g, -g], [g, g, -g], [g, g, g], '#d8f6ff');
  glass.quad([-g, g, g], [g, g, g], [g, g, -g], [-g, g, -g], '#f4ffff');
  return { mesh: mb.build(), over: over.build(), glass: glass.build(), glassAlpha: 0.3, yaw: -0.5, pitch: 0.38, spin: 'wobble' };
}

// ------------------------------------------------------------------ text entry (rename)
class TextEdit {
  constructor(text, max = 18) { this.text = text; this.max = max; this.done = null; this.on = (e) => this.key(e); window.addEventListener('keydown', this.on, true); }
  key(e) {
    e.stopPropagation(); e.preventDefault();
    if (e.key === 'Enter') this.done = 'ok';
    else if (e.key === 'Escape') this.done = 'cancel';
    else if (e.key === 'Backspace') this.text = this.text.slice(0, -1);
    else if (e.key.length === 1 && this.text.length < this.max && /[\w \-'!?.&]/.test(e.key)) this.text += e.key;
  }
  close() { window.removeEventListener('keydown', this.on, true); }
}

export class FishManagerPanel {
  constructor() {
    this.id = 'fishmgr';
    this.modal = true;
    this.place = 'all'; this.sort = 'rarity'; this.rar = null; this.favOnly = false; this.special = false;
    this.scroll = 0; this.sel = null; this.checked = new Set();
    this.breedFor = null; this.confirm = null; this.edit = null; this.t = 0;
  }
  open() { this.scroll = 0; this.breedFor = null; this.confirm = null; this.checked.clear(); }
  close() { if (this.edit) { this.edit.close(); this.edit = null; } }

  get aq() { return this.game.aquarium; }
  list() {
    const st = this.game.state, aq = this.aq;
    let L = (st.fish || []).filter((r) => SPECIES_BY_ID[r.species]);
    if (this.place === 'tank') L = L.filter((r) => r.inTank); else if (this.place === 'storage') L = L.filter((r) => !r.inTank);
    if (this.rar) L = L.filter((r) => SPECIES_BY_ID[r.species].rarity === this.rar);
    if (this.favOnly) L = L.filter((r) => r.fav);
    if (this.special) L = L.filter((r) => r.variant?.shiny || r.variant?.mutation);
    const sp = (r) => SPECIES_BY_ID[r.species];
    const name = (r) => (r.name || sp(r).name).toLowerCase();
    const key = {
      rarity: (r) => -RARITY_ORDER.indexOf(sp(r).rarity) * 1000 - (r.variant?.shiny ? 500 : 0) - (r.sizeCm || 0) / 1000,
      aero: (r) => -(aq?.rateOf?.(r) || 0) * (r.inTank ? 1 : 0.001),
      size: (r) => -(r.sizeCm || 0), happy: (r) => -(r.happiness ?? 0.7), hunger: (r) => -(r.hunger ?? 0.3),
      newest: (r) => -(r.caughtAt || r.bornAt || 0), species: (r) => sp(r).name, name,
    }[this.sort];
    return L.slice().sort((a, b) => { const x = key(a), y = key(b); return (x < y ? -1 : x > y ? 1 : 0) || ((b.fav ? 1 : 0) - (a.fav ? 1 : 0)); });
  }

  layout() {
    const g = this.game, W = g.screen.W;
    const R = panelRect(g, Math.min(W - 16, 860), 470);
    const head = { x: R.x + 6, y: R.y + 5, w: R.w - 12, h: 28 };
    const bar = { x: R.x + 10, y: R.y + 38, w: R.w - 20, h: 16 };
    const dw = Math.round(clamp(R.w * 0.33, 200, 270));
    const list = { x: R.x + 10, y: R.y + 60, w: R.w - dw - 26, h: R.h - 60 - 34 };
    const det = { x: list.x + list.w + 8, y: list.y, w: dw, h: R.h - 70 };
    const bulk = { x: list.x, y: list.y + list.h + 6, w: list.w, h: 20 };
    return { R, head, bar, list, det, bulk, rowH: 30 };
  }

  // ------------------------------------------------------------------ actions
  toast(t, icon = 'fish') { this.game.toast?.(t, icon, 2.6); }
  move(rec, toTank) { const r = this.aq?.moveFish?.(rec, toTank); if (r && !r.ok) { this.toast(r.why, 'tank'); this.game.audio.play('ui_error'); return false; } return true; }
  value(rec) { const sp = SPECIES_BY_ID[rec.species]; return Math.round((RELEASE_VALUE[sp?.rarity] || 4) * valueMultiplier(rec)); }
  release(recs) {
    let total = 0;
    for (const r of recs) total += this.aq?.releaseFish?.(r) || 0;
    for (const r of recs) this.checked.delete(r);
    if (recs.includes(this.sel)) this.sel = null;
    this.toast(`Released ${recs.length} fish  +${fmtAero(total)} Aero`, 'coin');
  }
  breed(a, b) {
    const r = this.aq?.breedPair?.(a, b);
    if (!r?.ok) { this.toast(r?.why || 'They are not in the mood.', 'heart'); this.game.audio.play('ui_error'); return; }
    this.toast('Love is in the water! Watch them court...', 'heart');
    this.breedFor = null;
  }
  see(rec) {
    if (!rec.inTank) { this.toast('That fish is in storage: move it to the tank first.', 'tank'); return; }
    this.ui.close(this.id);
    this.aq?.focusFish?.(rec);
  }

  // ------------------------------------------------------------------ drawing + input (immediate mode)
  draw(ctx, ui, dt) {
    const g = this.game, st = g.state, aq = this.aq, inp = ui.inp;
    this.t += dt;
    budget = 3;
    const L = this.layout(), R = L.R;
    this.rect = R;
    // keyboard: the game's hotkeys stay quiet while the panel is open
    for (const k of ['f', 'q', 'w', 's', 'b', 't', 'j', 'l', 'k', 'o', 'p', 'i', 'u', 'a']) g.input.keysPressed?.delete?.(k);
    if (this.edit) {
      if (this.edit.done) { const e = this.edit; e.close(); this.edit = null; if (e.done === 'ok') { e.rec.name = e.text.trim() || undefined; if (!e.rec.name) delete e.rec.name; g.save?.(); g.audio.play('ui_click'); } }
      g.input.keysPressed?.clear?.();
    }
    drawAeroSurface(ctx, R.x, R.y, R.w, R.h, { top: '#f4fdff', mid: '#cdeefc', bot: '#8fd0f0', a: [0.98, 0.98], edge: '#0b4f8f', r: 12, gloss: 0.45, glossH: 24, curve: 3, rim: 0.95, glow: 0.6, streak: true, bubbles: 4 });
    // ---- header
    const H = L.head;
    drawAeroSurface(ctx, H.x, H.y, H.w, H.h, { top: '#d8f6ff', mid: '#5cc8f4', bot: '#1f86c8', a: [1, 1], edge: '#0b4f8f', r: 9, gloss: 0.75, glossH: 12, curve: 3, rim: 0.9, glow: 0.7, streak: true });
    const fi = getUiIcon('fish');
    if (fi) ctx.drawImage(fi, H.x + 8, H.y + 8, fi.width * 2, fi.height * 2);
    drawText(ctx, 'My Fish', H.x + 8 + (fi ? fi.width * 2 + 6 : 0), H.y + 9, { font: 'big', color: '#ffffff', shadow: '#0a3e74' });
    const all = (st.fish || []).filter((r) => SPECIES_BY_ID[r.species]);
    const inTank = all.filter((r) => r.inTank).length, cap = aq?.capacity?.() || st.tankCap || 4;
    const rate = aq?.ratePerMin?.() || 0;
    let hx = H.x + 150;
    const stat = (icon, text) => { const ic = getUiIcon(icon); if (ic) { ctx.drawImage(ic, hx, H.y + 10); hx += ic.width + 3; } drawText(ctx, text, hx, H.y + 11, { color: '#ffffff', shadow: '#0a3e74' }); hx += measureText(text) + 14; };
    stat('tank', `Tank ${inTank}/${cap}`);
    stat('home', `Storage ${all.length - inTank}`);
    drawAeroCoin(ctx, hx + 4, H.y + 14, 4.5, this.t); hx += 11;
    drawText(ctx, `${rate.toFixed(1)}/min`, hx, H.y + 11, { color: '#ffffff', shadow: '#0a3e74' });
    if (this.btn(ui, ctx, { x: H.x + H.w - 26, y: H.y + 4, w: 22, h: 20 }, '', { icon: 'cross', tone: 'red', tip: 'Close (Esc)' })) { ui.close(this.id); return; }
    if (this.btn(ui, ctx, { x: H.x + H.w - 112, y: H.y + 4, w: 82, h: 20 }, 'Feed all', { icon: 'food', tone: 'green', tip: 'Sprinkle food for every fish in the tank', dis: !inTank })) { aq?.feedAll?.(); this.toast('Dinner time!', 'food'); }
    // ---- filters
    const B = L.bar;
    let bx = B.x;
    for (const [id, label] of PLACES) {
      const w = measureText(label, 'small') + 18;
      if (this.btn(ui, ctx, { x: bx, y: B.y, w, h: B.h }, label, { tone: this.place === id ? 'green' : 'glass', on: this.place === id, font: 'small' })) { this.place = id; this.scroll = 0; }
      bx += w + 3;
    }
    bx += 8;
    const sl = SORTS.find((s) => s[0] === this.sort)[1];
    if (this.btn(ui, ctx, { x: bx, y: B.y, w: 96, h: B.h }, 'Sort: ' + sl, { tone: 'aqua', font: 'small', tip: 'Change the sort order' })) { const i = SORTS.findIndex((s) => s[0] === this.sort); this.sort = SORTS[(i + 1) % SORTS.length][0]; }
    bx += 100;
    const rl = this.rar ? RARITY[this.rar].name : 'Any rarity';
    if (this.btn(ui, ctx, { x: bx, y: B.y, w: 84, h: B.h }, rl, { tone: 'glass', font: 'small', tip: 'Filter by rarity' })) { const i = this.rar ? RARITY_ORDER.indexOf(this.rar) + 1 : 0; this.rar = RARITY_ORDER[i] || null; this.scroll = 0; }
    bx += 88;
    if (this.btn(ui, ctx, { x: bx, y: B.y, w: 64, h: B.h }, 'Faves', { icon: this.favOnly ? 'star' : 'star_empty', tone: this.favOnly ? 'orange' : 'glass', on: this.favOnly, font: 'small', tip: 'Only favourites' })) { this.favOnly = !this.favOnly; this.scroll = 0; }
    bx += 68;
    if (this.btn(ui, ctx, { x: bx, y: B.y, w: 70, h: B.h }, 'Special', { icon: 'sparkle', tone: this.special ? 'orange' : 'glass', on: this.special, font: 'small', tip: 'Only shiny or mutated fish' })) { this.special = !this.special; this.scroll = 0; }
    // ---- list
    const list = this.list();
    if (this.sel && !all.includes(this.sel)) this.sel = null;
    if (!this.sel && list.length) this.sel = list[0];
    for (const r of [...this.checked]) if (!all.includes(r)) this.checked.delete(r);
    const LR = L.list, rh = L.rowH;
    ctx.fillStyle = 'rgba(255,255,255,0.45)'; ctx.fillRect(LR.x, LR.y, LR.w, LR.h);
    ctx.fillStyle = '#7fbedd'; ctx.fillRect(LR.x, LR.y, LR.w, 1); ctx.fillRect(LR.x, LR.y + LR.h - 1, LR.w, 1);
    if (ui.hover(LR) && inp.wheel) this.scroll += inp.wheel * rh * 1.5;
    this.scroll = clamp(this.scroll, 0, Math.max(0, list.length * rh - LR.h + 4));
    ctx.save(); ctx.beginPath(); ctx.rect(LR.x, LR.y + 1, LR.w, LR.h - 2); ctx.clip();
    const bf = this.breedFor;
    list.forEach((rec, i) => {
      const y = LR.y + 2 + i * rh - this.scroll;
      if (y + rh < LR.y || y > LR.y + LR.h) return;
      this.row(ctx, ui, rec, { x: LR.x + 2, y, w: LR.w - 4, h: rh - 2 }, bf);
    });
    ctx.restore();
    if (!list.length) drawText(ctx, all.length ? 'No fish match these filters.' : 'No fish yet: catch some and keep them!', LR.x + LR.w / 2, LR.y + 30, { align: 'center', color: SOFT });
    // ---- bulk bar / breed banner
    const BK = L.bulk;
    if (bf) {
      drawAeroSurface(ctx, BK.x, BK.y, BK.w, BK.h, { tone: 'pink', r: 'pill', gloss: 0.6, glossH: 7, rim: 0.8 });
      drawText(ctx, `Pick a partner for ${bf.name || SPECIES_BY_ID[bf.species].name} (both in the tank)`, BK.x + 10, BK.y + 7, { font: 'small', color: '#ffffff', shadow: '#8a2a5a' });
      if (this.btn(ui, ctx, { x: BK.x + BK.w - 66, y: BK.y + 2, w: 62, h: BK.h - 4 }, 'Cancel', { tone: 'glass', font: 'small' })) this.breedFor = null;
    } else if (this.checked.size) {
      const sel = [...this.checked];
      drawText(ctx, `${sel.length} checked`, BK.x + 4, BK.y + 7, { color: INK });
      let x = BK.x + 70;
      const b = (label, icon, tone, f, tip) => { const w = measureText(label, 'small') + 30; if (this.btn(ui, ctx, { x, y: BK.y, w, h: BK.h }, label, { icon, tone, font: 'small', tip })) f(); x += w + 4; };
      b('To tank', 'tank', 'aqua', () => { let n = 0; for (const r of sel) if (!r.inTank && this.move(r, true)) n++; if (n) this.toast(`${n} fish moved into the tank.`, 'tank'); }, 'Move into the tank (as many as fit)');
      b('To storage', 'home', 'aqua', () => { for (const r of sel) this.move(r, false); }, 'Move to storage');
      b('Favourite', 'star', 'orange', () => { const on = !sel.every((r) => r.fav); for (const r of sel) r.fav = on || undefined; g.save?.(); });
      b('Release', 'coin', 'red', () => { const rel = sel.filter((r) => !r.fav); if (!rel.length) { this.toast('Favourites are never bulk-released.', 'star'); return; } this.confirm = { recs: rel, value: rel.reduce((a, r) => a + this.value(r), 0) }; }, 'Release for Aero (favourites are skipped)');
      b('Clear', 'cross', 'glass', () => this.checked.clear());
    } else {
      drawText(ctx, 'Tick fish for bulk actions   Wheel: scroll   F: open / close', BK.x + 4, BK.y + 7, { font: 'small', color: SOFT });
      if (list.length && this.btn(ui, ctx, { x: BK.x + BK.w - 70, y: BK.y, w: 70, h: BK.h }, 'Tick all', { tone: 'glass', font: 'small' })) for (const r of list) this.checked.add(r);
    }
    // ---- details
    this.details(ctx, ui, L.det);
    // ---- confirm dialog
    if (this.confirm) this.drawConfirm(ctx, ui, R);
    if (inp.pressed && rectContains(R, inp.x, inp.y)) inp.pressed = false;
    if (g.input.keyPressed('Escape') && this.edit) g.input.keysPressed.delete('Escape');
  }

  btn(ui, ctx, r, label, o = {}) {
    const hov = !o.dis && ui.hover(r);
    drawAeroButton(ctx, r.x, r.y, r.w, r.h, { label, icon: o.icon ? getUiIcon(o.icon) : null, tone: o.tone || 'aqua', font: o.font, state: o.dis ? 'disabled' : o.on ? 'down' : hov ? (ui.inp.down ? 'down' : 'hover') : 'normal' });
    if (hov && o.tip) ui.tip = o.tip;
    if (!o.dis && ui.clicked(r)) { this.game.audio.play('ui_click'); return true; }
    if (o.dis && ui.hover(r) && ui.inp.pressed) ui.inp.pressed = false;
    return false;
  }

  row(ctx, ui, rec, r, bf) {
    const g = this.game, sp = SPECIES_BY_ID[rec.species], rar = RARITY[sp.rarity] || RARITY.common;
    const hov = ui.hover(r), sel = rec === this.sel;
    const partnerOk = bf && bf !== rec && rec.inTank;
    ctx.fillStyle = sel ? 'rgba(120,214,255,0.55)' : partnerOk && hov ? 'rgba(255,170,210,0.6)' : hov ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.35)';
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.fillStyle = rar.color; ctx.fillRect(r.x, r.y, 3, r.h);
    // checkbox
    const cb = { x: r.x + 6, y: r.y + r.h / 2 - 5, w: 10, h: 10 };
    ctx.fillStyle = '#ffffff'; ctx.fillRect(cb.x, cb.y, cb.w, cb.h);
    ctx.fillStyle = '#4a8ab0'; ctx.fillRect(cb.x, cb.y, cb.w, 1); ctx.fillRect(cb.x, cb.y + 9, cb.w, 1); ctx.fillRect(cb.x, cb.y, 1, 10); ctx.fillRect(cb.x + 9, cb.y, 1, 10);
    if (this.checked.has(rec)) { const ck = getUiIcon('check'); if (ck) ctx.drawImage(ck, cb.x + 1, cb.y + 1); else { ctx.fillStyle = '#2fae3a'; ctx.fillRect(cb.x + 2, cb.y + 2, 6, 6); } }
    // thumbnail
    const th = fishThumb(rec, 44, 26);
    if (th) ctx.drawImage(th, r.x + 20, r.y + 1);
    if (rec.variant?.shiny && (this.t * 3 + r.y) % 2 < 0.5) drawSparkle(ctx, r.x + 58, r.y + 5, 1, 1);
    // name, species
    let x = r.x + 68;
    const nm = rec.name || sp.name;
    drawText(ctx, nm.length > 16 ? nm.slice(0, 15) + '..' : nm, x, r.y + 4, { color: INK });
    if (rec.fav) { const st = getUiIcon('star'); if (st) ctx.drawImage(st, x + measureText(nm.slice(0, 16)) + 3, r.y + 2); }
    const tag = rec.variant?.shiny ? 'SHINY ' : rec.variant?.mutation ? (MUTATIONS[rec.variant.mutation]?.name || rec.variant.mutation).toUpperCase() + ' ' : '';
    drawText(ctx, tag + (rec.name ? sp.name : rar.name), x, r.y + 16, { font: 'small', color: tag ? '#a8389a' : SOFT });
    // size
    x = r.x + Math.round(r.w * 0.38);
    drawText(ctx, `${(rec.sizeCm || 0).toFixed(1)}cm`, x, r.y + 10, { font: 'small', color: INK });
    // bars
    x += 40;
    const bw = Math.max(30, Math.round(r.w * 0.16));
    const hi = getUiIcon('heart'), fo = getUiIcon('food');
    if (hi) ctx.drawImage(hi, x, r.y + 3);
    drawAeroBar(ctx, x + 10, r.y + 4, bw, 6, rec.happiness ?? 0.7, { color: '#ff7aa8' });
    if (fo) ctx.drawImage(fo, x, r.y + 15);
    drawAeroBar(ctx, x + 10, r.y + 16, bw, 6, 1 - (rec.hunger ?? 0.3), { color: (rec.hunger ?? 0) > 0.6 ? '#ff9a3a' : '#7ee07a' });
    // Aero/min + place
    x += bw + 16;
    if (rec.inTank) { drawAeroCoin(ctx, x + 3, r.y + 9, 3.5, this.t); drawText(ctx, (this.aq?.rateOf?.(rec) || 0).toFixed(1), x + 9, r.y + 6, { font: 'small', color: INK }); }
    else drawText(ctx, '--', x + 4, r.y + 6, { font: 'small', color: SOFT });
    const pl = rec.inTank ? 'TANK' : 'STORE';
    const pw = measureText(pl, 'small') + 8, px = r.x + r.w - pw - 4;
    ctx.fillStyle = rec.inTank ? '#3ac4f8' : '#9aaabb'; ctx.fillRect(px, r.y + 17, pw, 9);
    drawText(ctx, pl, px + 4, r.y + 19, { font: 'small', color: '#ffffff' });
    if (hov) ui.tip = null;
    // clicks
    if (ui.clicked({ x: cb.x - 3, y: r.y, w: 18, h: r.h })) { if (this.checked.has(rec)) this.checked.delete(rec); else this.checked.add(rec); g.audio.play('ui_toggle'); return; }
    if (ui.clicked(r)) {
      if (bf) { if (rec === bf) this.breedFor = null; else this.breed(bf, rec); return; }
      if (this.sel === rec && this.lastClick && this.t - this.lastClick < 0.35) this.see(rec);
      this.sel = rec; this.lastClick = this.t; g.audio.play('ui_page');
    }
  }

  details(ctx, ui, D) {
    const g = this.game, rec = this.sel;
    drawAeroSurface(ctx, D.x, D.y, D.w, D.h, { tone: 'frost', r: 9, gloss: 0.5, glossH: 16, rim: 0.85, glow: 0.4 });
    if (!rec) { drawText(ctx, 'Pick a fish', D.x + D.w / 2, D.y + 40, { align: 'center', color: SOFT }); return; }
    const sp = SPECIES_BY_ID[rec.species], rar = RARITY[sp.rarity] || RARITY.common;
    // portrait on a little pedestal of light
    const tw = D.w - 40, thh = Math.round(tw * 0.5);
    ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.fillRect(D.x + 10, D.y + 8, D.w - 20, thh + 8);
    ctx.fillStyle = rar.color; ctx.fillRect(D.x + 10, D.y + thh + 14, D.w - 20, 2);
    const th = fishThumb(rec, tw, thh);
    if (th) ctx.drawImage(th, D.x + 20, D.y + 12 + Math.round(Math.sin(this.t * 2) * 1.5));
    if (rec.variant?.shiny) for (let i = 0; i < 3; i++) if ((this.t * 2 + i * 0.33) % 1 < 0.4) drawSparkle(ctx, D.x + 24 + ((i * 53) % (tw - 8)), D.y + 14 + ((i * 29) % thh), 2, 1);
    let y = D.y + thh + 22;
    // name (click the pencil to rename)
    if (this.edit?.rec === rec) {
      const caret = (this.t * 2) % 1 < 0.5 ? '|' : '';
      ctx.fillStyle = '#ffffff'; ctx.fillRect(D.x + 10, y - 2, D.w - 20, 14);
      ctx.fillStyle = '#3ac4f8'; ctx.fillRect(D.x + 10, y + 11, D.w - 20, 1);
      drawText(ctx, this.edit.text + caret, D.x + 13, y + 1, { color: INK });
      drawText(ctx, 'Enter: save   Esc: cancel', D.x + 10, y + 15, { font: 'small', color: SOFT });
      y += 24;
    } else {
      drawText(ctx, rec.name || sp.name, D.x + 10, y, { font: 'big', color: INK });
      y += 14;
      drawText(ctx, `${sp.name}  -  ${rar.name}`, D.x + 10, y, { font: 'small', color: rar.dark });
      y += 10;
    }
    const tags = [];
    if (rec.variant?.shiny) tags.push('SHINY');
    if (rec.variant?.mutation) tags.push((MUTATIONS[rec.variant.mutation]?.name || rec.variant.mutation).toUpperCase());
    if (rec.bred) tags.push('BRED');
    drawText(ctx, `${(rec.sizeCm || 0).toFixed(1)} cm   ${tags.join('  ')}`, D.x + 10, y, { font: 'small', color: tags.length ? '#a8389a' : INK });
    y += 12;
    const bw = D.w - 74;
    drawText(ctx, 'Happy', D.x + 10, y + 1, { font: 'small', color: INK }); drawAeroBar(ctx, D.x + 56, y, bw, 7, rec.happiness ?? 0.7, { color: '#ff7aa8' }); y += 11;
    drawText(ctx, 'Fed', D.x + 10, y + 1, { font: 'small', color: INK }); drawAeroBar(ctx, D.x + 56, y, bw, 7, 1 - (rec.hunger ?? 0.3), { color: (rec.hunger ?? 0) > 0.6 ? '#ff9a3a' : '#7ee07a' }); y += 12;
    if (rec.inTank) { drawAeroCoin(ctx, D.x + 14, y + 4, 4, this.t); drawText(ctx, `${(this.aq?.rateOf?.(rec) || 0).toFixed(1)} Aero / min`, D.x + 22, y + 1, { font: 'small', color: INK }); }
    else drawText(ctx, 'In storage: earns nothing', D.x + 10, y + 1, { font: 'small', color: SOFT });
    y += 12;
    // actions: a 2-column grid
    const cw = Math.floor((D.w - 24) / 2), ch = 18;
    const A = [
      ['See in tank', 'eye', 'aqua', () => this.see(rec), !rec.inTank, 'The camera follows it (double-click a row too)'],
      [rec.inTank ? 'To storage' : 'To tank', rec.inTank ? 'home' : 'tank', 'aqua', () => this.move(rec, !rec.inTank), false, rec.inTank ? 'Move to storage' : 'Move into the tank'],
      [rec.fav ? 'Unfavourite' : 'Favourite', rec.fav ? 'star' : 'star_empty', 'orange', () => { rec.fav = rec.fav ? undefined : true; if (!rec.fav) delete rec.fav; g.save?.(); }, false],
      ['Rename', 'book', 'glass', () => { if (this.edit) this.edit.close(); this.edit = new TextEdit(rec.name || ''); this.edit.rec = rec; }, false],
      ['Breed...', 'heart', 'pink', () => { const why = this.aq?.canBreed?.(rec); if (why) { this.toast(why, 'heart'); g.audio.play('ui_error'); } else this.breedFor = rec; }, false, 'Pick a partner in the list'],
      [`Release +${fmtAero(this.value(rec))}`, 'coin', 'red', () => { this.confirm = { recs: [rec], value: this.value(rec) }; }, false, 'Let it go for Aero'],
    ];
    A.forEach(([label, icon, tone, f, dis, tip], i) => {
      const r = { x: D.x + 8 + (i % 2) * (cw + 8), y: y + Math.floor(i / 2) * (ch + 4), w: cw, h: ch };
      if (r.y + r.h > D.y + D.h - 4) return;
      if (this.btn(ui, ctx, r, label, { icon, tone, font: 'small', dis, tip })) f();
    });
  }

  drawConfirm(ctx, ui, R) {
    const c = this.confirm;
    ctx.fillStyle = 'rgba(4,48,78,0.35)'; ctx.fillRect(R.x, R.y, R.w, R.h);
    const w = 280, h = 92, x = Math.round(R.x + R.w / 2 - w / 2), y = Math.round(R.y + R.h / 2 - h / 2);
    drawAeroSurface(ctx, x, y, w, h, { tone: 'frost', r: 10, gloss: 0.5, glossH: 20, rim: 0.9, glow: 0.6, streak: true });
    const n = c.recs.length;
    const nm = n === 1 ? (c.recs[0].name || SPECIES_BY_ID[c.recs[0].species]?.name) : `${n} fish`;
    drawText(ctx, `Release ${nm}?`, x + w / 2, y + 14, { align: 'center', font: 'big', color: INK });
    drawText(ctx, `They swim back to the ocean.  +${fmtAero(c.value)} Aero`, x + w / 2, y + 34, { align: 'center', font: 'small', color: SOFT });
    if (this.btn(ui, ctx, { x: x + 20, y: y + h - 32, w: 110, h: 22 }, 'Release', { icon: 'check', tone: 'red' })) { this.confirm = null; this.release(c.recs); }
    if (this.btn(ui, ctx, { x: x + w - 130, y: y + h - 32, w: 110, h: 22 }, 'Keep', { icon: 'cross', tone: 'green' })) this.confirm = null;
    if (ui.inp.pressed) ui.inp.pressed = false;
  }
}

export function registerFishManager(ui) {
  try { if (ICON_MODELS && !ICON_MODELS.fishmgr) ICON_MODELS.fishmgr = cubeFishIcon; } catch { /* icons optional */ }
  ui.register(new FishManagerPanel());
}
void clamp01; void uiK;
