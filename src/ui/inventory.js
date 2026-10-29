// Inventory ('inventory'): a collector's cabinet of everything you own. Tabs (All, Fish, Bait, Materials,
// Blueprints, Decor, Cosmetics, Packages), velvet display cards with rotating voxel previews, rarity frames,
// glows and NEW ribbons, sorting, and a showcase pane (pedestal + spotlight, stats, lore, uses, actions:
// open package, build blueprint, equip bait, send decor to the tank, wear cosmetic, hatch egg, sell).
// open({tab, id})

import { clamp, clamp01, lerp, ease, formatCommas, TAU, hash2 } from '../core/math.js';
import { rgba, RARITY, RARITY_ORDER, shade, mix } from '../core/color.js';
import { rng } from '../core/rng.js';
import { drawText, measureText, wrapText } from '../gfx/font.js';
import { drawWood, drawPaper, drawPlank, drawTab } from './panels.js';
import { getUiIcon } from '../gfx/uiicons.js';
import { SPECIES_BY_ID } from '../fish/species.js';
import { traitList, valueMultiplier } from '../fish/traits.js';
import { RELEASE_VALUE, BAITS } from '../game/shopdata.js';
import * as CHAR from '../gfx/character.js';
import { ITEMS, TIERS, TIER_ORDER, countItem, removeItem, sellValue, inventory, wardrobeItem, ownsWardrobe } from '../build/items.js';
import { BUILDINGS, DECOR_BUILDS, buildingDef, RECIPES } from '../build/buildings.js';
import { PROJECTS, PERK_NAMES } from '../build/research.js';
import { drawItem } from '../build/itemdraw.js';

const TABS = [
  { id: 'all', label: 'All', icon: 'star', color: '#8a6a4a' },
  { id: 'fish', label: 'Fish', icon: 'fish', color: '#3a8ab0' },
  { id: 'bait', label: 'Bait', icon: 'worm', color: '#c8503e' },
  { id: 'material', label: 'Materials', icon: 'gear', color: '#6a8a4a' },
  { id: 'blueprint', label: 'Blueprints', icon: 'home', color: '#2a6ab8' },
  { id: 'decor', label: 'Decor', icon: 'tank', color: '#3a9a8a' },
  { id: 'cosmetic', label: 'Cosmetics', icon: 'crown', color: '#a85ab0' },
  { id: 'package', label: 'Packages', icon: 'trophy', color: '#c88a26' },
];
const SORTS = [['rarity', 'Rarity'], ['count', 'Count'], ['name', 'Name'], ['new', 'Newest']];
const KIND_LABEL = { material: 'Material', egg: 'Fish Egg', blueprint: 'Blueprint', bait: 'Bait', decor: 'Decoration', cosmetic: 'Cosmetic', package: 'Package', fish: 'Fish' };
const rIdx = (r) => RARITY_ORDER.indexOf(r);

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
  for (const p of PROJECTS) if (p.cost.items?.[id]) out.push(`Research: ${p.name}`);
  for (const r of RECIPES) if (r.items[id]) out.push(`Craft ${BAITS[r.id]?.name || r.id}`);
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
      if (!it || q <= 0 || !want(it.kind)) continue;
      push({ key: id, id, kind: it.kind, qty: q, rarity: it.rarity, name: it.name, fresh: fresh[id] || 0 });
    }
    if (want('bait')) for (const [id, q] of Object.entries(st.baits || {})) if (q > 0 && ITEMS[id]) push({ key: id, id, kind: 'bait', qty: q, rarity: ITEMS[id].rarity, name: ITEMS[id].name, fresh: 0 });
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
    const W = Math.min(g.screen.W - 24, 800), H = Math.min(g.screen.H - 56, 440);
    const r = { x: Math.round((g.screen.W - W) / 2), y: Math.round((g.screen.H - H) / 2) + 10, w: W, h: H };
    this.rect = { x: r.x, y: r.y - 26, w: W, h: H + 26 };
    drawWood(ctx, r.x, r.y, W, H, { tone: 'dark' });
    drawPlank(ctx, r.x + W / 2 - 80, r.y - 20, 160, 22, { rope: 8, label: 'INVENTORY' });
    const sat = getUiIcon('book');
    void sat;
    if (ui.button(ctx, r.x + W - 25, r.y + 7, 18, 18, '', { icon: 'cross', style: 'shell', tip: 'Close (Esc)' })) { ui.close(this.id); return; }
    // ---- tabs
    let tx = r.x + 8;
    const all = this.entriesAllCounts ||= {};
    for (const tb of TABS) {
      const tw = measureText(tb.label) + 26;
      const tr = { x: tx, y: r.y + 9, w: tw, h: 20 };
      const hov = ui.hover(tr) && this.tab !== tb.id;
      drawTab(ctx, tr.x, tr.y, tr.w, tr.h, { label: tb.label, icon: tb.icon, active: this.tab === tb.id, hover: hov, color: tb.color });
      if (tb.id === 'package') {
        const n = inventory(st).packages.length;
        if (n) { const bx = tr.x + tr.w - 6, by = tr.y - 2; ctx.fillStyle = '#3a0a1a'; ctx.fillRect(bx - 1, by - 1, 11, 9); ctx.fillStyle = '#ff4a6a'; ctx.fillRect(bx, by, 9, 7); drawText(ctx, String(Math.min(99, n)), bx + 5, by + 1, { font: 'small', align: 'center', color: '#fff' }); }
      }
      if (hov) { ui.tip = tb.label; if (inp.pressed) { inp.pressed = false; g.audio.play('ui_tab'); this.tab = tb.id; this.scroll = this.scrollT = 0; } }
      tx += tw + 2;
    }
    void all;
    // ---- grid
    const list = this.entries();
    if (this.sel && !list.some((e) => e.key === this.sel)) this.sel = null;
    if (!this.sel && list.length) this.sel = list[0].key;
    const paneW = 262;
    const grid = { x: r.x + 8, y: r.y + 32, w: W - paneW - 24, h: H - 32 - 34 };
    drawWood(ctx, grid.x, grid.y, grid.w, grid.h, { tone: 'dark', inset: true, nails: false });
    const cw = 68, ch = 82, gap = 4;
    const cols = Math.max(1, Math.floor((grid.w - 14 + gap) / (cw + gap)));
    const rows = Math.ceil(list.length / cols);
    const viewH = grid.h - 10;
    const maxScroll = Math.max(0, rows * (ch + gap) - viewH);
    if (inp.wheel && ui.hover(grid)) { this.scrollT = clamp(this.scrollT + Math.sign(inp.wheel) * (ch + gap), 0, maxScroll); inp.wheel = 0; }
    this.scrollT = clamp(this.scrollT, 0, maxScroll);
    this.scroll = lerp(this.scroll, this.scrollT, Math.min(1, dt * 14));
    const ox = grid.x + 6 + Math.floor((grid.w - 14 - (cols * (cw + gap) - gap)) / 2);
    ctx.save();
    ctx.beginPath(); ctx.rect(grid.x + 3, grid.y + 3, grid.w - 6, grid.h - 6); ctx.clip();
    if (!list.length) {
      const msg = this.tab === 'package' ? 'No packages yet. Some fish carry crates - catch them!' : this.tab === 'fish' ? 'No fish kept yet. Catch some!' : 'Nothing here yet. Catch fish, open packages and build!';
      drawText(ctx, msg, grid.x + grid.w / 2, grid.y + grid.h / 2 - 4, { align: 'center', color: '#cdb89a', shadow: '#1a0e06' });
    }
    let hovered = null;
    list.forEach((e, i) => {
      const c = i % cols, rr = Math.floor(i / cols);
      const x = ox + c * (cw + gap), y = Math.round(grid.y + 5 + rr * (ch + gap) - this.scroll);
      if (y > grid.y + grid.h || y + ch < grid.y) return;
      const rect = { x, y, w: cw, h: ch };
      const hov = ui.hover(rect) && ui.hover(grid);
      if (hov) hovered = e;
      this.drawCard(ctx, e, rect, t, hov, this.sel === e.key, i);
      if (hov && inp.pressed) {
        inp.pressed = false;
        if (this.sel !== e.key) { this.sel = e.key; this.pop = 0; g.audio.play('ui_click', { pitch: 1 + rIdx(e.rarity) * 0.08 }); }
        if (inp.dblclick) this.primary(e);
        const fr = inventory(st).fresh;
        if (fr && e.id) delete fr[e.id];
      }
    });
    ctx.restore();
    if (maxScroll > 0) {
      const sx = grid.x + grid.w - 7, sh = grid.h - 12;
      ctx.fillStyle = '#1a0e08'; ctx.fillRect(sx, grid.y + 6, 3, sh);
      const kh = Math.max(16, sh * (viewH / (rows * (ch + gap))));
      ctx.fillStyle = '#c08550'; ctx.fillRect(sx, Math.round(grid.y + 6 + (sh - kh) * (this.scroll / maxScroll)), 3, Math.round(kh));
    }
    if (hovered && hovered.key !== this.sel) ui.tip = `${hovered.name}${hovered.qty > 1 ? ` x${hovered.qty}` : ''}`;
    // ---- bottom bar: sort + collection stats
    const bb = { x: grid.x, y: r.y + H - 30, w: grid.w, h: 22 };
    const sl = SORTS.find((q) => q[0] === this.sort)[1];
    if (ui.button(ctx, bb.x, bb.y, 104, 20, `Sort: ${sl}`, { icon: 'arrow_d', tip: 'Change the sort order' })) {
      const i = SORTS.findIndex((q) => q[0] === this.sort);
      this.sort = SORTS[(i + 1) % SORTS.length][0];
    }
    const kinds = Object.values(ITEMS).filter((it) => it.kind !== 'coins' && it.kind !== 'package');
    const found = kinds.filter((it) => countItem(st, it.id) > 0).length;
    drawText(ctx, `${list.length} ${this.tab === 'all' ? 'stacks' : 'entries'}  -  Collection ${found}/${kinds.length}`, bb.x + 112, bb.y + 7, { color: '#e6d6c0', shadow: '#1a0e06' });
    const pct = found / Math.max(1, kinds.length);
    ctx.fillStyle = '#1a0e08'; ctx.fillRect(bb.x + bb.w - 86, bb.y + 6, 84, 8);
    ctx.fillStyle = '#ffd25a'; ctx.fillRect(bb.x + bb.w - 85, bb.y + 7, Math.round(82 * pct), 6);
    ctx.fillStyle = '#fff2b8'; ctx.fillRect(bb.x + bb.w - 85, bb.y + 7, Math.round(82 * pct), 1);
    // ---- showcase pane
    const sel = list.find((e) => e.key === this.sel) || null;
    this.drawPane(ctx, ui, sel, { x: r.x + W - paneW - 8, y: r.y + 32, w: paneW, h: H - 40 }, t, dt);
    // sell sparkle numbers
    for (const f of this.sellFx) f.t += dt;
    this.sellFx = this.sellFx.filter((f) => f.t < 1);
  }

  drawCard(ctx, e, r, t, hov, sel, i) {
    const R = RARITY[e.rarity] || RARITY.common;
    const ri = rIdx(e.rarity);
    const lift = sel ? -2 : hov ? -1 : 0;
    const x = r.x, y = r.y + lift, w = r.w, h = r.h;
    // outer glow for epic / legendary
    if (ri >= 3) {
      ctx.globalCompositeOperation = 'lighter';
      const a = 0.18 + 0.1 * Math.sin(t * 3 + i);
      ctx.fillStyle = rgba(R.color, a);
      ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
      ctx.fillStyle = rgba(R.color, a * 0.5);
      ctx.fillRect(x - 3, y - 1, w + 6, h + 2);
      ctx.globalCompositeOperation = 'source-over';
    }
    // velvet display case
    ctx.fillStyle = '#100810';
    ctx.fillRect(x, y, w, h);
    const top = mix(R.dark, '#1a0e1a', 0.55), bot = '#120a14';
    for (let yy = 2; yy < h - 2; yy += 2) {
      const k = yy / h;
      ctx.fillStyle = mix(top, bot, k);
      ctx.fillRect(x + 2, y + yy, w - 4, 2);
    }
    // spotlight pool behind the item
    ctx.globalCompositeOperation = 'lighter';
    const pool = 0.12 + (hov || sel ? 0.1 : 0) + ri * 0.025;
    for (let k = 0; k < 4; k++) {
      ctx.fillStyle = rgba(R.color, pool * (1 - k / 4));
      const pw = 46 - k * 9, ph = 30 - k * 6;
      ctx.fillRect(Math.round(x + w / 2 - pw / 2), Math.round(y + 34 - ph / 2), pw, ph);
    }
    ctx.globalCompositeOperation = 'source-over';
    // frame
    ctx.fillStyle = R.dark;
    ctx.fillRect(x, y, w, 1); ctx.fillRect(x, y + h - 1, w, 1); ctx.fillRect(x, y, 1, h); ctx.fillRect(x + w - 1, y, 1, h);
    ctx.fillStyle = sel ? '#fff6c8' : R.color;
    ctx.fillRect(x + 1, y + 1, w - 2, 1); ctx.fillRect(x + 1, y + h - 2, w - 2, 1); ctx.fillRect(x + 1, y + 1, 1, h - 2); ctx.fillRect(x + w - 2, y + 1, 1, h - 2);
    if (ri >= 3) {
      // shimmer running around the frame
      const per = 2 * (w + h);
      const p = Math.floor((t * 60 + i * 17) % per);
      ctx.fillStyle = '#ffffff';
      for (let k = 0; k < 6; k++) {
        const q = (p + k) % per;
        const [px, py] = q < w ? [x + q, y + 1] : q < w + h ? [x + w - 2, y + q - w] : q < 2 * w + h ? [x + w - (q - w - h), y + h - 2] : [x + 1, y + h - (q - 2 * w - h)];
        ctx.fillRect(px, py, 1, 1);
      }
      ctx.fillStyle = '#ffe07a';
      for (const [cx, cy] of [[x + 1, y + 1], [x + w - 3, y + 1], [x + 1, y + h - 3], [x + w - 3, y + h - 3]]) ctx.fillRect(cx, cy, 2, 2);
    }
    if (sel) {
      const a = 0.5 + 0.5 * Math.sin(t * 6);
      ctx.fillStyle = rgba('#fff6c8', a);
      ctx.fillRect(x - 1, y - 1, w + 2, 1); ctx.fillRect(x - 1, y + h, w + 2, 1); ctx.fillRect(x - 1, y, 1, h); ctx.fillRect(x + w, y, 1, h);
    }
    // item
    ctx.save();
    ctx.beginPath(); ctx.rect(x + 2, y + 2, w - 4, h - 4); ctx.clip();
    const spinT = hov || sel ? t * 1.6 : t * 0.5 + i * 0.37;
    drawItem(ctx, e.id, Math.round(x + w / 2), y + 56, { box: [w - 10, 48], t: spinT, spin: true, rec: e.rec, look: this.game.state.character });
    ctx.restore();
    // name plate
    ctx.fillStyle = rgba('#000000', 0.55);
    ctx.fillRect(x + 2, y + h - 21, w - 4, 19);
    let name = e.name;
    while (name.length > 2 && measureText(name, 'small') > w - 8) name = name.slice(0, -1);
    if (name !== e.name) name = name.slice(0, -1) + '.';
    drawText(ctx, name.toUpperCase(), x + w / 2, y + h - 18, { font: 'small', align: 'center', color: '#fff6e2' });
    for (let s = 0; s < R.stars; s++) {
      ctx.fillStyle = R.color;
      ctx.fillRect(Math.round(x + w / 2 - R.stars * 3 + s * 6 + 1), y + h - 9, 3, 3);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(Math.round(x + w / 2 - R.stars * 3 + s * 6 + 1), y + h - 9, 1, 1);
    }
    // badges
    if (e.qty > 1 || e.kind === 'bait' || e.kind === 'material') {
      const txt = 'x' + formatCommas(e.qty);
      const tw = measureText(txt, 'small') + 5;
      ctx.fillStyle = '#1a0e08'; ctx.fillRect(x + w - tw - 3, y + 3, tw + 1, 9);
      ctx.fillStyle = '#fff6e2'; ctx.fillRect(x + w - tw - 2, y + 4, tw - 1, 7);
      drawText(ctx, txt, x + w - tw, y + 5, { font: 'small', color: '#2a1a10' });
    }
    if (e.kind === 'fish') {
      const inTank = e.rec.inTank;
      drawText(ctx, inTank ? 'TANK' : 'BUCKET', x + 4, y + 4, { font: 'small', color: inTank ? '#9af0ff' : '#ffd0a0', outline: '#100810' });
      if (e.rec.variant?.shiny && Math.sin(t * 5 + i) > 0.6) { ctx.fillStyle = '#fff6b0'; ctx.fillRect(x + w - 10, y + 16, 1, 3); ctx.fillRect(x + w - 11, y + 17, 3, 1); }
    }
    const fresh = e.id && inventory(this.game.state).fresh?.[e.id];
    if (fresh && Date.now() - fresh < 3 * 86400000) {
      ctx.fillStyle = '#d8283a'; ctx.fillRect(x + 2, y + 2, 17, 8);
      ctx.fillStyle = '#ff6a7a'; ctx.fillRect(x + 2, y + 2, 17, 1);
      drawText(ctx, 'NEW', x + 4, y + 3, { font: 'small', color: '#ffffff' });
    }
  }

  drawPane(ctx, ui, e, p, t, dt) {
    const g = this.game, st = g.state;
    this.pop = Math.min(1, this.pop + dt * 4);
    // showcase box
    const sc = { x: p.x, y: p.y, w: p.w, h: 132 };
    const R = e ? RARITY[e.rarity] || RARITY.common : RARITY.common;
    ctx.save();
    ctx.beginPath(); ctx.rect(sc.x, sc.y, sc.w, sc.h); ctx.clip();
    const grd = ctx.createLinearGradient(0, sc.y, 0, sc.y + sc.h);
    grd.addColorStop(0, mix(R.dark, '#0a0612', 0.35)); grd.addColorStop(1, '#0a0612');
    ctx.fillStyle = grd; ctx.fillRect(sc.x, sc.y, sc.w, sc.h);
    // rotating light rays
    ctx.globalCompositeOperation = 'lighter';
    const cx = sc.x + sc.w / 2, cy = sc.y + 78;
    for (let k = 0; k < 8; k++) {
      const a = t * 0.35 + (k / 8) * TAU;
      ctx.fillStyle = rgba(R.color, 0.06 + (e && rIdx(e.rarity) >= 3 ? 0.04 : 0));
      ctx.beginPath(); ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(a - 0.12) * 160, cy + Math.sin(a - 0.12) * 160);
      ctx.lineTo(cx + Math.cos(a + 0.12) * 160, cy + Math.sin(a + 0.12) * 160);
      ctx.fill();
    }
    // spotlight cone from above
    ctx.fillStyle = rgba('#fff6e0', 0.07);
    ctx.beginPath(); ctx.moveTo(cx - 10, sc.y); ctx.lineTo(cx + 10, sc.y); ctx.lineTo(cx + 46, cy + 22); ctx.lineTo(cx - 46, cy + 22); ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    // pedestal
    const py = sc.y + sc.h - 26;
    ctx.fillStyle = '#2a1a14'; ctx.fillRect(cx - 40, py + 4, 80, 18);
    ctx.fillStyle = '#5a3a24'; ctx.fillRect(cx - 38, py + 4, 76, 16);
    ctx.fillStyle = '#7a5434'; ctx.fillRect(cx - 38, py + 4, 76, 2);
    for (let k = 0; k < 76; k += 7) { ctx.fillStyle = '#4a2e1c'; ctx.fillRect(cx - 38 + k, py + 7, 1, 13); }
    ctx.fillStyle = mix(R.color, '#3a2a20', 0.5); ctx.fillRect(cx - 44, py, 88, 5);
    ctx.fillStyle = R.color; ctx.fillRect(cx - 44, py, 88, 1);
    ctx.fillStyle = rgba('#000000', 0.4); ctx.fillRect(cx - 30, py - 1, 60, 1);
    if (e) {
      const k = ease.outBack(this.pop);
      const bob = Math.round(Math.sin(t * 2) * 2);
      ctx.save();
      ctx.translate(cx, py);
      ctx.scale(k, k);
      ctx.translate(-cx, -py);
      drawItem(ctx, e.id, cx, py - 2 + bob, { box: [sc.w - 40, sc.h - 34], t: t * 1.2, spin: true, big: true, rec: e.rec, building: e.kind === 'blueprint', look: st.character });
      ctx.restore();
      if (rIdx(e.rarity) >= 2 && Math.random() < dt * (rIdx(e.rarity) * 3)) g.particles?.sparkle(cx + rng.float(-40, 40), sc.y + rng.float(20, 100), R.color, { layer: 'ui' });
    }
    ctx.restore();
    ctx.fillStyle = '#1a0e08';
    ctx.fillRect(sc.x - 1, sc.y - 1, sc.w + 2, 1); ctx.fillRect(sc.x - 1, sc.y + sc.h, sc.w + 2, 1); ctx.fillRect(sc.x - 1, sc.y, 1, sc.h); ctx.fillRect(sc.x + sc.w, sc.y, 1, sc.h);
    ctx.fillStyle = R.color; ctx.fillRect(sc.x, sc.y, sc.w, 1);
    // rarity banner
    if (e) {
      const lab = R.name.toUpperCase();
      const lw = measureText(lab, 'small') + 12;
      ctx.fillStyle = R.dark; ctx.fillRect(sc.x + 6, sc.y + 6, lw, 9);
      ctx.fillStyle = R.color; ctx.fillRect(sc.x + 6, sc.y + 6, lw, 1);
      drawText(ctx, lab, sc.x + 12, sc.y + 8, { font: 'small', color: '#ffffff' });
      drawText(ctx, (KIND_LABEL[e.kind] || e.kind).toUpperCase(), sc.x + sc.w - 6, sc.y + 8, { font: 'small', align: 'right', color: '#cdb89a' });
    }
    // info paper
    const ip = { x: p.x, y: sc.y + sc.h + 6, w: p.w, h: p.h - sc.h - 6 };
    drawPaper(ctx, ip.x, ip.y, ip.w - 1, ip.h - 2, { aged: true });
    if (!e) { drawText(ctx, 'Select an item.', ip.x + 10, ip.y + 10, { color: '#6b4f43' }); return; }
    let y = ip.y + 7;
    drawText(ctx, e.name, ip.x + 8, y, { color: shade(R.color, -0.45), shadow: '#fffaf0' });
    y += 11;
    const info = this.infoLines(e);
    for (const [k, v, c] of info.stats) {
      drawText(ctx, k, ip.x + 8, y, { font: 'small', color: '#8a6a4a' });
      drawText(ctx, v, ip.x + 70, y, { font: 'small', color: c || '#3a2a22' });
      y += 8;
    }
    y += 2;
    for (const l of wrapText(info.desc, ip.w - 18).slice(0, 4)) { drawText(ctx, l, ip.x + 8, y, { color: '#3a2a22' }); y += 10; }
    if (info.lore) for (const l of wrapText(info.lore, ip.w - 18).slice(0, 2)) { drawText(ctx, l, ip.x + 8, y, { color: '#8a6a5a' }); y += 10; }
    if (info.uses.length) {
      y += 2;
      drawText(ctx, 'USES', ip.x + 8, y, { font: 'small', color: '#8a5a32' });
      y += 8;
      const maxU = Math.max(1, Math.floor((ip.y + ip.h - 34 - y) / 8));
      info.uses.slice(0, maxU).forEach((u, i) => drawText(ctx, (i === maxU - 1 && info.uses.length > maxU ? `+${info.uses.length - i} more...` : '- ' + u), ip.x + 10, y + i * 8, { font: 'small', color: '#4a6a3a' }));
    }
    // actions
    const acts = this.actions(e);
    let bx = ip.x + 6;
    const by = ip.y + ip.h - 28;
    for (const a of acts) {
      const bw = Math.max(54, measureText(a.label) + (a.icon ? 24 : 14));
      if (ui.button(ctx, bx, by, bw, 20, a.label, { icon: a.icon, style: a.style || 'wood', disabled: a.disabled, tip: a.tip })) a.run();
      bx += bw + 4;
    }
  }

  infoLines(e) {
    const g = this.game, st = g.state;
    const it = ITEMS[e.id];
    const stats = [];
    let desc = it?.desc || '', lore = it?.lore || '';
    let uses = [];
    if (e.kind === 'fish') {
      const rec = e.rec, sp = e.sp;
      desc = sp.desc || '';
      lore = '';
      stats.push(['SPECIES', sp.name], ['SIZE', `${rec.sizeCm} cm, ${rec.weightKg} kg`], ['WHERE', rec.inTank ? 'In your aquarium' : 'Holding bucket', rec.inTank ? '#2a6a8a' : '#a8583a']);
      const tr = traitList(rec).map((q) => q.text).join(', ');
      if (tr) stats.push(['TRAITS', tr.length > 30 ? tr.slice(0, 29) + '.' : tr, '#8a3a8a']);
      stats.push(['VALUE', `${Math.round((RELEASE_VALUE[sp.rarity] || 4) * valueMultiplier(rec))} coins`]);
      return { stats, desc, lore, uses };
    }
    stats.push(['OWNED', formatCommas(e.qty)]);
    if (e.kind === 'package') {
      const T = TIERS[it.tier];
      stats.push(['CONTAINS', `${T.rolls[0]}-${T.rolls[1]} items`], ['COINS', `${T.coins[0]}-${T.coins[1]}`]);
      if (T.guarantee) stats.push(['ALWAYS', T.guarantee.join(' + '), '#8a3a8a']);
      const from = inventory(st).packages.find((p) => p.tier === it.tier)?.from;
      if (from?.species) stats.push(['FROM', SPECIES_BY_ID[from.species]?.name || from.species, '#2a6a8a']);
      return { stats, desc, lore, uses };
    }
    if (e.kind === 'blueprint') {
      const def = buildingDef(it.builds);
      const c = def?.cost || {};
      stats.push(['BUILD COST', `${c.coins || 0} coins + ${Object.values(c.items || {}).reduce((a, b) => a + b, 0)} mats`]);
      const bon = BUILDINGS[it.builds]?.bonus || {};
      const ks = Object.keys(bon).filter((k) => k !== 'light');
      if (ks.length) stats.push(['EFFECT', `${PERK_NAMES[ks[0]] || ks[0]} +${Math.round(bon[ks[0]][0] * 100)}%`, '#2a6a3a']);
      if (def?.unique) stats.push(['LIMIT', 'One per seabed', '#a8583a']);
      uses = Object.entries(c.items || {}).map(([id, q]) => `Needs ${q} ${ITEMS[id]?.name || id} (have ${countItem(st, id)})`);
      return { stats, desc, lore, uses };
    }
    const v = sellValue(st, e.id);
    if (v) stats.push(['SELLS FOR', `${v} coins each`, '#2a6a3a']);
    if (it?.biome) stats.push(['FOUND IN', { shallows: 'Sunny Shallows', junkyard: 'Junkyard Reef', abyss: 'Midnight Abyss' }[it.biome] || it.biome]);
    if (e.kind === 'material' || e.kind === 'egg') uses = usesOf(e.id);
    if (e.kind === 'egg') uses = ['Hatch into a baby fish', ...uses];
    if (e.kind === 'bait') {
      const b = BAITS[e.id];
      stats.push(['SHOP PRICE', `${b.price} for ${b.qty}`]);
      if (g.state.equipped?.kind === 'special' && g.state.equipped.id === e.id) stats.push(['STATUS', 'Equipped', '#2a6a8a']);
    }
    if (e.kind === 'decor') { uses = ['Place it in your aquarium', ...(DECOR_BUILDS[e.id] ? ['Or build its plans on the seabed'] : [])]; }
    if (e.kind === 'cosmetic') {
      const w = wardrobeItem(e.id);
      stats.push(['SLOT', (w?.slot || '').toUpperCase()]);
      if (w && CHAR.isEquipped?.(st.character, w)) stats.push(['STATUS', 'Wearing it!', '#2a6a8a']);
      if (e.qty > 1) stats.push(['DUPLICATES', `${e.qty - 1} (sell them)`]);
    }
    return { stats, desc, lore, uses };
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
      g.particles?.text(g.input.x, g.input.y - 10, `+${v * k}`, { color: '#9affc8' });
      g.save?.();
    };
    if (e.kind === 'package') out.push({ label: 'Open!', icon: 'star', style: 'coral', run: () => ui.open('package', { tier: ITEMS[e.id].tier }) });
    if (e.kind === 'blueprint') {
      const it = ITEMS[e.id];
      const def = buildingDef(it.builds);
      const done = def?.unique && st.buildings?.some((b) => b.id === it.builds);
      out.push({ label: done ? 'Already built' : 'Build', icon: 'home', style: 'coral', disabled: done || g.state.view !== 'ocean' && !g.setView, tip: 'Enter blueprint mode and place it on the seabed', run: () => { ui.close(this.id); g.build?.startPlacing?.(e.id); } });
      out.push({ label: 'Sell', icon: 'coin', run: () => sell(1) });
    }
    if (e.kind === 'material') { out.push({ label: 'Sell 1', icon: 'coin', run: () => sell(1) }); out.push({ label: 'Sell all', run: () => sell(e.qty) }); }
    if (e.kind === 'egg') { out.push({ label: 'Hatch', icon: 'heart', style: 'coral', run: () => g.build?.hatchEgg?.() }); out.push({ label: 'Sell', icon: 'coin', run: () => sell(1) }); }
    if (e.kind === 'bait') {
      const on = st.equipped?.kind === 'special' && st.equipped.id === e.id;
      out.push({ label: on ? 'Equipped' : 'Equip', icon: 'hook', style: 'coral', disabled: on, run: () => { g.equip?.('special', e.id); } });
      out.push({ label: 'Sell 1', icon: 'coin', run: () => sell(1) });
    }
    if (e.kind === 'decor') {
      out.push({ label: 'To aquarium', icon: 'tank', style: 'coral', tip: 'Place it in your aquarium', run: () => {
        if (!removeItem(st, e.id, 1)) return;
        if (!g.aquarium?.addDecor?.(e.id)) (st.tank.decor ||= []).push({ id: e.id, x: 0.2 + Math.random() * 0.6, z: 0.5 });
        g.audio.play('ui_buy'); g.toast?.(`${ITEMS[e.id].name} placed in your aquarium!`, 'tank'); g.save?.();
      } });
      out.push({ label: 'Sell', icon: 'coin', run: () => sell(1) });
    }
    if (e.kind === 'cosmetic') {
      const w = wardrobeItem(e.id);
      const wearing = w && CHAR.isEquipped?.(st.character, w);
      out.push({ label: wearing && w.slot !== 'acc' ? 'Wearing' : wearing ? 'Take off' : 'Wear', icon: 'crown', style: 'coral', disabled: !w || (wearing && w.slot !== 'acc'), run: () => {
        st.character = CHAR.equipItem ? CHAR.equipItem(st.character, w) : { ...(st.character || {}), [w.slot]: w.value };
        g.audio.play('magic', { vol: 0.6 }); g.emit?.('wardrobe', w.id); g.save?.();
      } });
      if (e.qty > 1) out.push({ label: 'Sell dupe', icon: 'coin', run: () => sell(1) });
    }
    if (e.kind === 'fish') {
      const rec = e.rec;
      out.push({ label: rec.inTank ? 'In your tank' : 'Sell', icon: 'coin', disabled: rec.inTank, tip: 'Release it for coins', run: () => {
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

void hash2; void clamp01; void drawPaper;
