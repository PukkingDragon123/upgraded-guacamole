// Satchel ('inventory'): everything you own, in a glossy Frutiger Aero bag. Icon tabs (All, Fish, Bait, Materials,
// Blueprints, Decor, Cosmetics, Crates), glass tiles with spinning voxel previews and rarity tints, and a sunny
// showcase bubble with a frosted info card (icon stats, short text) and actions: open crate, build blueprint,
// equip bait, send decor to the tank, wear cosmetic, hatch egg, sell for Aero.
// open({tab, id})

import { clamp, lerp, ease, formatCommas, TAU } from '../core/math.js';
import { rgba, RARITY, RARITY_ORDER, shade, mix, luminance } from '../core/color.js';
import { rng } from '../core/rng.js';
import { drawText, measureText, wrapText } from '../gfx/font.js';
import { drawTab } from './panels.js';
import { getUiIcon } from '../gfx/uiicons.js';
import { getBigIcon, gemIcon } from '../gfx/bigicons.js';
import { SPECIES_BY_ID } from '../fish/species.js';
import { traitList, valueMultiplier } from '../fish/traits.js';
import { RELEASE_VALUE } from '../game/shopdata.js';
import * as CHAR from '../gfx/character.js';
import { ITEMS, TIERS, TIER_ORDER, countItem, removeItem, sellValue, inventory, wardrobeItem, ownsWardrobe } from '../build/items.js';
import { BUILDINGS, DECOR_BUILDS, buildingDef, RECIPES } from '../build/buildings.js';
import { PROJECTS, PERK_NAMES } from '../build/research.js';
import { drawItem } from '../build/itemdraw.js';
import { BAITS, baitList, ensureBait, equipBait } from '../store/bait.js';
import { drawBaitGloss } from '../fishing/baitart.js';
import { AERO, aeroCached, aeroSurface, drawAeroFrame, drawAeroCard, drawAeroBar, drawAeroBadge, drawAeroGlow, drawSparkle, ecoBackdrop, toneFrom, fmtAero, uiFont, capH, uiScaleMode } from './aero.js';
import { panelRect } from './ui.js';

const BIGUI = () => uiScaleMode() !== 'normal'; // [phase6:ui] bigger text + tiles on the Big / Huge UI sizes

const TABS = [
  { id: 'all', label: 'All', icon: 'star', color: '#2f9ef0' },
  { id: 'fish', label: 'Fish', icon: 'fish', color: '#22b0d8' },
  { id: 'bait', label: 'Bait', icon: 'worm', color: '#ff8a3a' },
  { id: 'material', label: 'Materials', icon: 'gear', color: '#58b03a' },
  { id: 'blueprint', label: 'Blueprints', icon: 'home', color: '#3a7ae0' },
  { id: 'decor', label: 'Decor', icon: 'tank', color: '#2ac0a8' },
  { id: 'cosmetic', label: 'Cosmetics', icon: 'crown', color: '#a85ad8' },
  { id: 'package', label: 'Crates', icon: 'trophy', color: '#f0a020' },
];
const SORTS = [['rarity', 'Rarity', 'star'], ['count', 'Count', 'plus'], ['name', 'Name', 'book'], ['new', 'Newest', 'clock']];
const KIND_LABEL = { material: 'Material', egg: 'Fish Egg', blueprint: 'Blueprint', bait: 'Bait', decor: 'Decoration', cosmetic: 'Cosmetic', package: 'Crate', fish: 'Fish' };
const rIdx = (r) => Math.max(0, RARITY_ORDER.indexOf(r));
const BAIT_RARITY = ['common', 'uncommon', 'rare', 'epic', 'legendary'];

// where an item is used (cached)
const usesCache = new Map();
function usesOf(id) {
  if (usesCache.has(id)) return usesCache.get(id);
  const out = [];
  for (const [bid, b] of Object.entries(BUILDINGS)) {
    if (b.cost.items?.[id]) out.push(`Build ${b.name}`);
    else if (b.upgrades?.some((u) => u.items?.[id])) out.push(`Upgrade ${b.name}`);
    void bid;
  }
  for (const p of PROJECTS || []) if (p.cost?.items?.[id]) out.push(`Research: ${p.name}`);
  for (const r of RECIPES || []) if (r.items?.[id]) out.push(`Craft ${BAITS[r.id]?.name || r.id}`);
  usesCache.set(id, out);
  return out;
}

export class InventoryPanel {
  constructor() {
    this.id = 'inventory';
    this.modal = true;
    this.sound = 'box_open';
    this.tab = 'all';
    this.sort = 'rarity';
    this.scroll = 0;
    this.scrollT = 0;
    this.sel = null;
    this.t = 0;
    this.pop = 0;
  }

  open(data) {
    this.t = 0;
    if (data?.tab) this.tab = data.tab;
    if (data?.id) this.sel = data.id;
    this.scroll = this.scrollT = 0;
    this.pop = 0;
    this.sellFx = [];
  }

  // ---- entries
  entries() {
    const g = this.game, st = g.state;
    const inv = inventory(st);
    const fresh = inv.fresh || {};
    const out = [];
    const push = (e) => out.push(e);
    const want = (k) => this.tab === 'all' || this.tab === k || (this.tab === 'material' && k === 'egg');
    for (const [id, q] of Object.entries(inv.items)) {
      const it = ITEMS[id];
      if (!it || q <= 0 || !want(it.kind) || it.kind === 'bait') continue;
      push({ key: id, id, kind: it.kind, qty: q, rarity: it.rarity, name: it.name, fresh: fresh[id] || 0 });
    }
    if (want('bait')) {
      let bl = [];
      try { bl = baitList(st); } catch { bl = []; }
      for (const b of bl) {
        const tier = b.def?.tier ?? -1;
        const rarity = BAIT_RARITY[clamp(tier < 0 ? Math.round(((b.def?.rarity || 1) - 1) * 12) : tier, 0, 4)];
        push({ key: 'bait:' + b.id, id: b.id, kind: 'bait', qty: b.count, rarity, name: b.def?.name || b.id, def: b.def, fresh: 0 });
      }
    }
    if (want('package')) {
      for (const tier of TIER_ORDER) {
        const n = inv.packages.filter((p) => p.tier === tier).length;
        if (n) push({ key: 'pkg_' + tier, id: 'pkg_' + tier, kind: 'package', qty: n, rarity: TIERS[tier].rarity, name: TIERS[tier].name, fresh: Math.max(0, ...inv.packages.filter((p) => p.tier === tier).map((p) => p.at || 0)) });
      }
    }
    if (want('cosmetic')) {
      for (const w of CHAR.WARDROBE || []) {
        const id = 'cos_' + w.id;
        if (!ITEMS[id] || !ownsWardrobe(st, id)) continue;
        const dupes = inv.items[id] || 0;
        const idx = out.findIndex((e) => e.key === id);
        if (idx >= 0) out.splice(idx, 1);
        push({ key: id, id, kind: 'cosmetic', qty: 1 + dupes, rarity: ITEMS[id].rarity, name: ITEMS[id].name, fresh: fresh[id] || 0 });
      }
    }
    if (want('fish')) {
      for (const rec of st.fish || []) {
        const sp = SPECIES_BY_ID[rec.species];
        if (!sp) continue;
        push({ key: 'fish:' + rec.uid, id: null, rec, sp, kind: 'fish', qty: 1, rarity: sp.rarity, name: rec.name || sp.name, fresh: rec.caughtAt || 0 });
      }
    }
    const s = this.sort;
    out.sort((a, b) => {
      if (s === 'rarity') return rIdx(b.rarity) - rIdx(a.rarity) || a.name.localeCompare(b.name);
      if (s === 'count') return b.qty - a.qty || rIdx(b.rarity) - rIdx(a.rarity);
      if (s === 'name') return a.name.localeCompare(b.name);
      return (b.fresh || 0) - (a.fresh || 0) || rIdx(b.rarity) - rIdx(a.rarity);
    });
    return out;
  }

  draw(ctx, ui, dt) {
    const g = this.game, st = g.state, inp = g.input;
    this.t += dt;
    const t = this.t;
    const big = BIGUI(), f1 = uiFont('normal');
    const r = panelRect(g, big ? 790 : 720, big ? 470 : 430);
    const W = r.w, H = r.h;
    this.rect = r;
    const F = drawAeroFrame(ctx, r.x, r.y, W, H, { title: 'Satchel', icon: getBigIcon('inventory', { size: big ? 30 : 'small' }).canvas, seed: 13 });
    if (ui.button(ctx, F.close.x, F.close.y, F.close.w, F.close.h, '', { icon: 'cross', tip: 'Close (Esc)' })) { ui.close(this.id); return; }
    // ---- icon tabs (names in tooltips)
    let tx = F.content.x;
    const tabH = big ? 26 : 20;
    for (const tb of TABS) {
      const tw = big ? 40 : 30;
      const tr = { x: tx, y: F.content.y, w: tw, h: tabH };
      const hov = ui.hover(tr) && this.tab !== tb.id;
      drawTab(ctx, tr.x, tr.y, tr.w, tr.h, { icon: getUiIcon(tb.icon, big ? 2 : 1), active: this.tab === tb.id, hover: hov, color: tb.color });
      if (tb.id === 'package') {
        const n = inventory(st).packages.length;
        if (n) drawAeroBadge(ctx, tr.x + tr.w + 2, tr.y - 4, n, t);
      }
      if (ui.hover(tr)) ui.tip = tb.label;
      if (hov && inp.pressed) { inp.pressed = false; g.audio.play('ui_tab'); this.tab = tb.id; this.scroll = this.scrollT = 0; }
      tx += tw + 2;
    }
    // ---- grid
    const list = this.entries();
    if (this.sel && !list.some((e) => e.key === this.sel)) this.sel = null;
    if (!this.sel && list.length) this.sel = list[0].key;
    const paneW = big ? 282 : 250, barH = big ? 30 : 26;
    const grid = { x: F.content.x, y: F.content.y + tabH, w: F.content.w - paneW - 6, h: F.content.h - tabH - barH };
    drawAeroCard(ctx, grid.x, grid.y, grid.w, grid.h, { seed: 6 });
    const gap = big ? 6 : 5;
    const cols = Math.max(1, Math.floor((grid.w - 14 + gap) / ((big ? 64 : 58) + gap)));
    const cw = Math.floor((grid.w - 14 - (cols - 1) * gap) / cols), ch = cw;
    const rows = Math.ceil(list.length / cols);
    const viewH = grid.h - 12;
    const maxScroll = Math.max(0, rows * (ch + gap) - viewH);
    if (inp.wheel && ui.hover(grid)) { this.scrollT = clamp(this.scrollT + Math.sign(inp.wheel) * (ch + gap), 0, maxScroll); inp.wheel = 0; }
    this.scrollT = clamp(this.scrollT, 0, maxScroll);
    this.scroll = lerp(this.scroll, this.scrollT, Math.min(1, dt * 14));
    const ox = grid.x + 7 + Math.floor((grid.w - 14 - (cols * (cw + gap) - gap)) / 2);
    ctx.save();
    ctx.beginPath(); ctx.rect(grid.x + 3, grid.y + 3, grid.w - 6, grid.h - 6); ctx.clip();
    if (!list.length) {
      const cx = grid.x + grid.w / 2, cy = grid.y + grid.h / 2;
      const ic = getBigIcon('inventory', { size: 'menu' }).canvas;
      ctx.globalAlpha = 0.5 + 0.1 * Math.sin(t * 2);
      ctx.drawImage(ic, Math.round(cx - ic.width / 2), Math.round(cy - ic.height / 2 - 6 + Math.sin(t * 1.5) * 2));
      ctx.globalAlpha = 1;
      drawText(ctx, 'Empty!', cx, cy + 18, { font: f1, align: 'center', color: AERO.inkSoft });
    }
    let hovered = null;
    list.forEach((e, i) => {
      const c = i % cols, rr = Math.floor(i / cols);
      const x = ox + c * (cw + gap), y = Math.round(grid.y + 6 + rr * (ch + gap) - this.scroll);
      if (y > grid.y + grid.h || y + ch < grid.y) return;
      const rect = { x, y, w: cw, h: ch };
      const hov = ui.hover(rect) && ui.hover(grid);
      if (hov) hovered = e;
      this.drawCard(ctx, e, rect, t, hov, this.sel === e.key, i);
      if (hov && inp.pressed) {
        inp.pressed = false;
        if (this.sel !== e.key) { this.sel = e.key; this.pop = 0; g.audio.play('bubble', { pitch: 1 + rIdx(e.rarity) * 0.08, vol: 0.6 }); }
        if (inp.dblclick) this.primary(e);
        const fr = inventory(st).fresh;
        if (fr && e.id) delete fr[e.id];
      }
    });
    ctx.restore();
    if (maxScroll > 0) {
      const sx = grid.x + grid.w - 7, sh = grid.h - 12;
      drawAeroBar(ctx, sx - 1, grid.y + 6, 5, sh, 0, {});
      const kh = Math.max(16, sh * (viewH / (rows * (ch + gap))));
      ctx.drawImage(aeroCached(`satknob|${Math.round(kh)}`, () => aeroSurface(5, Math.round(kh), { tone: 'aqua', r: 2, gloss: 0.7, glossH: 3, rim: 0.5, glow: 0.5 })), sx - 1, Math.round(grid.y + 6 + (sh - kh) * (this.scroll / maxScroll)));
    }
    if (hovered) ui.tip = `${hovered.name}${hovered.qty > 1 ? ` x${hovered.qty}` : ''}`;
    // ---- bottom bar: sort + collection
    const bb = { x: grid.x, y: grid.y + grid.h + 5, w: grid.w, h: barH - 6 };
    const so = SORTS.find((q) => q[0] === this.sort);
    if (ui.button(ctx, bb.x, bb.y, big ? 96 : 74, bb.h, so[1], { icon: so[2], style: 'white', font: 'small', tip: 'Sort' })) {
      const i = SORTS.findIndex((q) => q[0] === this.sort);
      this.sort = SORTS[(i + 1) % SORTS.length][0];
    }
    const kinds = Object.values(ITEMS).filter((it) => it.kind !== 'coins' && it.kind !== 'package');
    const found = kinds.filter((it) => countItem(st, it.id) > 0).length;
    const pct = found / Math.max(1, kinds.length);
    const ctxt = `${found}/${kinds.length}`, ctw = measureText(ctxt, f1);
    const tro = getUiIcon('trophy', big ? 2 : 1);
    const barX = bb.x + bb.w - ctw - 10 - 96;
    ctx.drawImage(tro, barX - tro.width - 4, bb.y + Math.round((bb.h - tro.height) / 2));
    drawAeroBar(ctx, barX, bb.y + Math.round((bb.h - 9) / 2), 96, big ? 9 : 8, pct, { color: '#ffd24a' });
    drawText(ctx, ctxt, bb.x + bb.w - 4, bb.y + Math.round((bb.h - capH(f1)) / 2), { font: f1, align: 'right', color: '#ffffff', shadow: '#0a3e74' });
    if (ui.hover({ x: barX - tro.width - 6, y: bb.y, w: bb.x + bb.w - barX + tro.width + 6, h: bb.h })) ui.tip = 'Collection';
    // ---- showcase pane
    const sel = list.find((e) => e.key === this.sel) || null;
    this.drawPane(ctx, ui, sel, { x: F.content.x + F.content.w - paneW, y: F.content.y, w: paneW, h: F.content.h }, t, dt);
    for (const f of this.sellFx) f.t += dt;
    this.sellFx = this.sellFx.filter((f) => f.t < 1);
    F.finish();
  }

  drawCard(ctx, e, r, t, hov, sel, i) {
    const R = RARITY[e.rarity] || RARITY.common;
    const ri = rIdx(e.rarity);
    const lift = sel ? -2 : hov ? -1 : 0;
    const x = r.x, y = r.y + lift, w = r.w, h = r.h;
    if (ri >= 3 || sel) drawAeroGlow(ctx, x + w / 2, y + h / 2, w * 0.75, sel ? '#8ff6ff' : R.color, sel ? 0.6 : 0.3 + 0.1 * Math.sin(t * 3 + i));
    // glossy glass tile, tinted by rarity along the bottom
    ctx.drawImage(aeroCached(`satcard|${w}|${h}|${e.rarity}`, () => aeroSurface(w, h, { top: '#ffffff', mid: '#eef9ff', bot: mix('#cfeaf8', R.color, 0.35), edge: shade(R.color, -0.35), r: 8, gloss: 0.55, glossH: Math.round(h * 0.42), curve: 3, rim: 0.9, glow: 0.6, glowColor: mix(R.color, '#ffffff', 0.5), a: [0.96, 0.96] })), x, y);
    if (sel) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x + 3, y - 2, w - 6, 2); ctx.fillRect(x + 3, y + h, w - 6, 2); ctx.fillRect(x - 2, y + 3, 2, h - 6); ctx.fillRect(x + w, y + 3, 2, h - 6);
    }
    ctx.save();
    ctx.beginPath(); ctx.rect(x + 2, y + 2, w - 4, h - 4); ctx.clip();
    const spinT = hov || sel ? t * 1.6 : t * 0.5 + i * 0.37;
    if (e.kind === 'bait' && e.def) drawBaitGloss(ctx, e.def.art, x + w / 2, y + h / 2 + 1, 34, t + i, { bubble: false });
    else drawItem(ctx, e.id, Math.round(x + w / 2), y + h - 8, { box: [w - 10, h - 14], t: spinT, spin: true, rec: e.rec, look: this.game.state.character });
    ctx.restore();
    // rarity gem (glossy 3D) or pips
    const gem = gemIcon(R.color, BIGUI() ? 13 : 10);
    if (gem) ctx.drawImage(gem, x + 2, y + 2);
    else for (let s = 0; s < R.stars; s++) {
      ctx.fillStyle = shade(R.color, -0.4); ctx.fillRect(x + 4 + s * 4, y + 4, 3, 3);
      ctx.fillStyle = R.color; ctx.fillRect(x + 4 + s * 4, y + 4, 2, 2);
    }
    if (e.qty > 1 || e.kind === 'bait' || e.kind === 'material') {
      const txt = 'x' + formatCommas(e.qty);
      const qf = uiFont('small'), qh = capH(qf) + 5;
      const tw = measureText(txt, qf) + 8;
      ctx.drawImage(aeroCached(`satqty|${tw}|${qh}`, () => aeroSurface(tw, qh, { tone: 'aqua', r: 'pill', gloss: 0.8, glossH: Math.round(qh * 0.42), curve: 1, rim: 0.6, glow: 0.5 })), x + w - tw - 2, y + h - qh - 2);
      drawText(ctx, txt, x + w - tw + 2, y + h - qh - 2 + Math.round((qh - capH(qf)) / 2), { font: qf, color: '#ffffff', shadow: '#0a4680' });
    }
    if (e.kind === 'fish') {
      ctx.drawImage(getUiIcon(e.rec.inTank ? 'tank' : 'bubble'), x + w - 12, y + 3);
      if (e.rec.variant?.shiny && (t * 1.3 + i) % 2 < 0.3) drawSparkle(ctx, x + w - 10, y + 16, 2, 1);
    }
    if (e.kind === 'bait' && this.isEquipped(e)) ctx.drawImage(getUiIcon('hook'), x + w - 12, y + 3);
    const fresh = e.id && inventory(this.game.state).fresh?.[e.id];
    if (fresh && Date.now() - fresh < 3 * 86400000) drawAeroBadge(ctx, x + w + 2, y - 3, '!', t);
  }

  isEquipped(e) {
    try { return ensureBait(this.game.state).equipped === e.id; } catch { return false; }
  }

  drawPane(ctx, ui, e, p, t, dt) {
    const g = this.game, st = g.state;
    this.pop = Math.min(1, this.pop + dt * 4);
    const R = e ? RARITY[e.rarity] || RARITY.common : RARITY.common;
    // showcase: a sunny glass bubble on a glossy aqua pedestal
    const BU = BIGUI(), f1 = uiFont('normal'), f2 = uiFont('small');
    const sc = { x: p.x, y: p.y, w: p.w, h: BU ? 136 : 128 };
    ctx.drawImage(aeroCached(`satsc|${sc.w}|${sc.h}`, () => ecoBackdrop(sc.w, sc.h, { seed: 21, r: 8 })), sc.x, sc.y);
    const cx = sc.x + sc.w / 2, cy = sc.y + 60;
    ctx.save();
    ctx.beginPath(); ctx.rect(sc.x + 2, sc.y + 2, sc.w - 4, sc.h - 4); ctx.clip();
    drawAeroGlow(ctx, cx, cy, 56, mix(R.color, '#ffffff', 0.55), 0.55 + 0.1 * Math.sin(t * 2));
    ctx.globalCompositeOperation = 'lighter';
    for (let k = 0; k < 10; k++) {
      const a = t * 0.3 + (k / 10) * TAU;
      ctx.fillStyle = rgba('#ffffff', 0.05);
      ctx.beginPath(); ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(a - 0.1) * 140, cy + Math.sin(a - 0.1) * 140);
      ctx.lineTo(cx + Math.cos(a + 0.1) * 140, cy + Math.sin(a + 0.1) * 140);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
    const py = sc.y + sc.h - 22;
    ctx.drawImage(aeroCached('satped', () => aeroSurface(64, 12, { tone: 'aqua', r: 'pill', gloss: 0.8, glossH: 5, curve: 2, rim: 0.85, glow: 0.7 })), Math.round(cx - 32), py + 2);
    if (e) {
      const k = ease.outBack(this.pop);
      const bob = Math.round(Math.sin(t * 2) * 2);
      ctx.save();
      ctx.translate(cx, py);
      ctx.scale(k, k);
      ctx.translate(-cx, -py);
      if (e.kind === 'bait' && e.def) drawBaitGloss(ctx, e.def.art, cx, py - 36 + bob, 64, t, {});
      else drawItem(ctx, e.id, cx, py + 2 + bob, { box: [sc.w - 60, sc.h - 34], t: t * 1.2, spin: true, big: true, rec: e.rec, building: e.kind === 'blueprint', look: st.character });
      ctx.restore();
      if (rIdx(e.rarity) >= 2 && Math.random() < dt * (rIdx(e.rarity) * 3)) g.particles?.sparkle(cx + rng.float(-50, 50), sc.y + rng.float(14, 96), '#ffffff', { layer: 'ui' });
    }
    ctx.restore();
    // info card
    const ip = { x: p.x, y: sc.y + sc.h + 5, w: p.w, h: p.h - sc.h - 5 };
    drawAeroCard(ctx, ip.x, ip.y, ip.w, ip.h, { seed: 8 });
    if (!e) return;
    let y = ip.y + 7;
    const rf = BU ? 'normal' : 'small';
    const lab = BU ? R.name : R.name.toUpperCase();
    const gem = gemIcon(R.color, BU ? 15 : 11), gw = gem ? gem.width - 2 : 0;
    const rh = capH(rf) + 6, lw = measureText(lab, rf) + 12 + gw;
    ctx.drawImage(aeroCached(`satrar|${lw}|${rh}|${e.rarity}`, () => aeroSurface(lw, rh, { tone: toneFrom(R.color), r: 'pill', gloss: 0.8, glossH: Math.round(rh * 0.45), curve: 1, rim: 0.7, glow: 0.6 })), ip.x + ip.w - lw - 7, y);
    if (gem) ctx.drawImage(gem, ip.x + ip.w - lw - 5, y + Math.round((rh - gem.height) / 2));
    const light = luminance(R.color) > 0.62;
    drawText(ctx, lab, ip.x + ip.w - lw - 1 + gw, y + Math.round((rh - capH(rf)) / 2), { font: rf, color: light ? AERO.ink : '#ffffff', shadow: light ? null : shade(R.color, -0.6) });
    let nf = f1;
    if (measureText(e.name, nf) > ip.w - lw - 24) nf = 'normal';
    let nm = e.name;
    while (nm.length > 3 && measureText(nm, nf) > ip.w - lw - 24) nm = nm.slice(0, -1);
    if (nm !== e.name) nm = nm.slice(0, -1) + '.';
    drawText(ctx, nm, ip.x + 8, y + Math.round((rh - capH(nf)) / 2), { font: nf, color: AERO.ink, shadow: '#ffffff' });
    if (nm !== e.name && ui.hover({ x: ip.x + 4, y, w: ip.w - lw - 16, h: rh })) ui.tip = e.name;
    y += rh + (BU ? 6 : 4);
    const info = this.infoLines(e);
    const sl = BU ? 15 : 11;
    for (const [ic, v, c] of info.stats.slice(0, 3)) {
      const icn = getUiIcon(ic);
      ctx.drawImage(icn, ip.x + 8, y + Math.round((capH(f1) - icn.height) / 2));
      drawText(ctx, v, ip.x + 22, y, { font: f1, color: c || AERO.inkSoft });
      y += sl;
    }
    y += 2;
    const dl = BU ? 13 : 10;
    const by = ip.y + ip.h - (BU ? 30 : 26);
    const descRows = Math.max(1, Math.min(2, Math.floor((by - 4 - y) / dl)));
    const dlines = wrapText(info.desc, ip.w - 16, f1);
    dlines.slice(0, descRows).forEach((l, i) => {
      if (i === descRows - 1 && dlines.length > descRows) { while (l.length > 4 && measureText(l + '...', f1) > ip.w - 16) l = l.slice(0, -1); l = l.replace(/[\s,.;:]*$/, '') + '...'; }
      drawText(ctx, l, ip.x + 8, y, { font: f1, color: AERO.inkSoft });
      y += dl;
    });
    if (dlines.length > descRows && ui.hover({ x: ip.x, y: y - dl * descRows, w: ip.w, h: dl * descRows })) ui.tip = info.desc;
    if (info.uses.length) {
      y += 2;
      const ul = capH(f2) + 4;
      const maxU = Math.max(0, Math.min(3, Math.floor((by - 2 - y) / ul)));
      info.uses.slice(0, maxU).forEach((u, i) => drawText(ctx, (i === maxU - 1 && info.uses.length > maxU ? `+${info.uses.length - i} more` : '- ' + u), ip.x + 10, y + i * ul, { font: f2, color: '#2a8a3a' }));
    }
    // actions
    const acts = this.actions(e);
    let bx = ip.x + 6;
    const bh = BU ? 24 : 20;
    for (const a of acts) {
      const bw = Math.max(48, measureText(a.label, f1) + (a.icon ? 34 : 20));
      if (bx + bw > ip.x + ip.w - 4) break;
      if (ui.button(ctx, bx, by, bw, bh, a.label, { icon: a.icon, style: a.style || 'aqua', disabled: a.disabled, tip: a.tip })) a.run();
      bx += bw + 4;
    }
  }

  // stats: [uiIcon, text, color?] rows (icons instead of labels)
  infoLines(e) {
    const g = this.game, st = g.state;
    const it = ITEMS[e.id];
    const stats = [];
    let desc = it?.desc || '';
    let uses = [];
    if (e.kind === 'fish') {
      const rec = e.rec, sp = e.sp;
      desc = sp.desc || '';
      stats.push(['fish', `${rec.sizeCm} cm  ${rec.weightKg} kg`], [rec.inTank ? 'tank' : 'bubble', rec.inTank ? 'In the tank' : 'In the bucket', rec.inTank ? '#1a7ab8' : '#c8582a']);
      const tr = traitList(rec).map((q) => q.text).join(', ');
      if (tr) stats.push(['sparkle', tr.length > 28 ? tr.slice(0, 27) + '.' : tr, '#8a3ab8']);
      stats.push(['aero', fmtAero(Math.round((RELEASE_VALUE[sp.rarity] || 4) * valueMultiplier(rec)))]);
      return { stats, desc, uses };
    }
    if (e.kind === 'bait') {
      const d = e.def || BAITS[e.id] || {};
      desc = d.desc || '';
      stats.push(['bait', `x${formatCommas(e.qty)}`]);
      if (d.attract) stats.push(['heart', `Lure x${(Math.round(d.attract * 100) / 100).toFixed(2)}`]);
      if (d.rarity > 1) stats.push(['star', `Rare x${(Math.round(d.rarity * 100) / 100).toFixed(2)}`, '#8a3ab8']);
      if (this.isEquipped(e)) stats.push(['hook', 'On the hook', '#1a7ab8']);
      return { stats, desc, uses };
    }
    stats.push(['check', `x${formatCommas(e.qty)}`]);
    if (e.kind === 'package') {
      const T = TIERS[it.tier];
      stats.push(['star', `${T.rolls[0]}-${T.rolls[1]} items`], ['aero', `${T.coins[0]}-${T.coins[1]}`]);
      const from = inventory(st).packages.find((p) => p.tier === it.tier)?.from;
      if (from?.species) stats.push(['fish', SPECIES_BY_ID[from.species]?.name || from.species, '#1a7ab8']);
      return { stats, desc, uses };
    }
    if (e.kind === 'blueprint') {
      const def = buildingDef(it.builds);
      const c = def?.cost || {};
      stats.push(['aero', `${fmtAero(c.coins || 0)} + ${Object.values(c.items || {}).reduce((a, b) => a + b, 0)} mats`]);
      const bon = BUILDINGS[it.builds]?.bonus || {};
      const ks = Object.keys(bon).filter((k) => k !== 'light');
      if (ks.length) stats.push(['arrow_u', `${PERK_NAMES[ks[0]] || ks[0]} +${Math.round(bon[ks[0]][0] * 100)}%`, '#2a8a3a']);
      uses = Object.entries(c.items || {}).map(([id, q]) => `${q} ${ITEMS[id]?.name || id} (${countItem(st, id)})`);
      return { stats, desc, uses };
    }
    const v = sellValue(st, e.id);
    if (v) stats.push(['aero', `${fmtAero(v)} each`, '#2a8a3a']);
    if (it?.biome) stats.push(['map', { oscean: '(OS)cean', shallows: 'Sunny Shallows', fjord: 'Frosty Fjord', junkyard: 'Junkyard Reef', metropolis: 'Sunken Metropolis', volcano: 'Lava Rift', abyss: 'The Deep Ocean' }[it.biome] || it.biome]);
    if (e.kind === 'material' || e.kind === 'egg') uses = usesOf(e.id);
    if (e.kind === 'egg') uses = ['Hatch a baby fish', ...uses];
    if (e.kind === 'decor') uses = ['Aquarium decor', ...(DECOR_BUILDS[e.id] ? ['Tank plans'] : [])]; // [phase10:tank]
    if (e.kind === 'cosmetic') {
      const w = wardrobeItem(e.id);
      if (w?.slot) stats.push(['crown', w.slot[0].toUpperCase() + w.slot.slice(1)]);
      if (w && CHAR.isEquipped?.(st.character, w)) stats.push(['heart', 'Wearing it!', '#1a7ab8']);
    }
    return { stats, desc, uses };
  }

  actions(e) {
    const g = this.game, st = g.state, ui = g.ui;
    const out = [];
    const sell = (n) => {
      const v = sellValue(st, e.id);
      let k = 0;
      for (let i = 0; i < n; i++) if (removeItem(st, e.id, 1)) k++;
      if (!k) return;
      g.addCoins(v * k, g.input.x, g.input.y);
      g.audio.play('coin_collect');
      g.particles?.text(g.input.x, g.input.y - 10, `+${v * k}`, { color: '#bff6ff' });
      g.save?.();
    };
    if (e.kind === 'package') out.push({ label: 'Open!', icon: 'star', style: 'green', run: () => ui.open(ui.panels?.crate ? 'crate' : 'package', { tier: ITEMS[e.id].tier }) });
    if (e.kind === 'blueprint') {
      const it = ITEMS[e.id];
      const def = buildingDef(it.builds);
      const done = def?.unique && st.buildings?.some((b) => b.id === it.builds);
      out.push({ label: done ? 'Built' : 'Build', icon: 'home', style: 'green', disabled: done || (g.state.view !== 'ocean' && !g.setView), tip: 'Place it in your tank', run: () => { ui.close(this.id); g.build?.startPlacing?.(e.id); } }); // [phase10:tank]
      out.push({ label: 'Sell', icon: 'aero', run: () => sell(1) });
    }
    if (e.kind === 'material') { out.push({ label: 'Sell', icon: 'aero', run: () => sell(1) }); out.push({ label: 'All', icon: 'aero', tip: 'Sell all', run: () => sell(e.qty) }); }
    if (e.kind === 'egg') { out.push({ label: 'Hatch', icon: 'heart', style: 'green', run: () => g.build?.hatchEgg?.() }); out.push({ label: 'Sell', icon: 'aero', run: () => sell(1) }); }
    if (e.kind === 'bait') {
      const on = this.isEquipped(e);
      out.push({ label: on ? 'Equipped' : 'Equip', icon: 'hook', style: 'green', disabled: on, run: () => {
        try { if (equipBait(st, e.id)) { g.audio.play('ui_toggle'); g.baitFx?.onEquip?.(g.currentBait?.()); g.save?.(); } } catch (err) { console.error(err); }
      } });
    }
    if (e.kind === 'decor') {
      out.push({ label: 'To tank', icon: 'tank', style: 'green', tip: 'Place it in your aquarium', run: () => {
        if (!removeItem(st, e.id, 1)) return;
        if (!g.aquarium?.addDecor?.(e.id)) (st.tank.decor ||= []).push({ id: e.id, x: 0.2 + Math.random() * 0.6, z: 0.5 });
        g.audio.play('ui_buy'); g.toast?.(ITEMS[e.id].name, 'tank'); g.save?.();
      } });
      out.push({ label: 'Sell', icon: 'aero', run: () => sell(1) });
    }
    if (e.kind === 'cosmetic') {
      const w = wardrobeItem(e.id);
      const wearing = w && CHAR.isEquipped?.(st.character, w);
      out.push({ label: wearing && w.slot !== 'acc' ? 'Wearing' : wearing ? 'Off' : 'Wear', icon: 'crown', style: 'green', disabled: !w || (wearing && w.slot !== 'acc'), run: () => {
        st.character = CHAR.equipItem ? CHAR.equipItem(st.character, w) : { ...(st.character || {}), [w.slot]: w.value };
        g.audio.play('magic', { vol: 0.6 }); g.emit?.('wardrobe', w.id); g.save?.();
      } });
      if (e.qty > 1) out.push({ label: 'Sell', icon: 'aero', tip: 'Sell a duplicate', run: () => sell(1) });
    }
    if (e.kind === 'fish') {
      const rec = e.rec;
      out.push({ label: rec.inTank ? 'In tank' : 'Release', icon: rec.inTank ? 'tank' : 'aero', disabled: rec.inTank, tip: 'Release it for Aero', run: () => {
        const i = st.fish.indexOf(rec);
        if (i < 0) return;
        st.fish.splice(i, 1);
        g.releaseFish?.(rec, g.input.x, g.input.y);
        g.save?.();
      } });
    }
    return out;
  }

  // double-click: the obvious action
  primary(e) {
    const a = this.actions(e)[0];
    if (a && !a.disabled) a.run();
  }
}

void KIND_LABEL; void rgba;
