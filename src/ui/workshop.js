// Marina's Workshop panel (phase 8, OWNER: Progression agent). id 'workshop':
//   ui.open('workshop', {cat, recipe})   cat: src/build/workshop.js WS_CATS id; recipe: a recipe id to select
// A cute crafting bench: a recipe book down the left (category tabs with pixel-art icons), a grid of recipe tiles,
// and a detail card with the big item art, stats, have/need materials, the Craft button and the anvil where Marina
// hammers it together (sparks + pixel particles). Big items go into a timed craft queue (bottom strip, Rush with
// Aero). The Tackle tab doubles as the Rod Bench (equip reels, lines, lures and charms); Rods and Upgrades show
// before/after stat bars. While the Workshop is locked the panel shows Marina's quest instead.
import { clamp, clamp01, lerp, ease, TAU } from '../core/math.js';
import { rgba, RARITY, mix, shade } from '../core/color.js';
import { drawText, measureText, wrapText } from '../gfx/font.js';
import { getUiIcon } from '../gfx/uiicons.js';
import * as NPC from '../gfx/npcs.js';
import { ITEMS, countItem } from '../build/items.js';
import { drawItem, itemIcon } from '../build/itemdraw.js';
import { pixIcon, rodPix, PixFx, partSprite } from '../build/pixart.js';
import {
  WS_CATS, ensureWorkshop, workshopUnlocked, recipesFor, wsRecipe, wsUnlocked, wsCheck, wsCraft, wsSlots, wsRemaining, wsProgress, wsRushCost, wsRush, wsTick,
} from '../build/workshop.js';
import { ROD_BY_ID, ROD_STAT_KEYS, TACKLE_BY_ID, TACKLE_SLOTS, TACKLE_SLOT_NAMES, PERKS, ensureRods, equipRod, equipTackle, ownsRod, ownsTackle, rodStatsOf, rodLevel, MAX_ROD_LEVEL } from '../game/rods.js';
import { aeroSurface, aeroCached, drawAeroFrame, drawAeroCard, drawAeroCoin, fmtAero, drawAeroGlow, drawAeroBadge } from './aero.js';
import { panelRect } from './ui.js';

const BENCH_CATS = new Set(['build', 'decor', 'bait']);
const CAT_ALIAS = { building: 'build', plans: 'decor', special: 'bait' }; // src/build/crafting.js categories
const INK = '#0c3a52', INK_SOFT = '#3c6f88', OK = '#1f9a3a', BAD = '#e0384a';
const fmtT = (s) => { s = Math.ceil(s); return s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : `${s}s`; };

// Draws a recipe/item icon reference centred at (cx, cy) inside a size box.
export function drawRef(ctx, ref, cx, cy, size, t = 0) {
  if (!ref) return;
  const [kind, id] = [ref.slice(0, ref.indexOf(':')), ref.slice(ref.indexOf(':') + 1)];
  if (kind === 'rod') {
    const rod = ROD_BY_ID[id];
    const base = rodPix(rod, 1);
    if (!base) return;
    const k = Math.max(1, Math.floor(size / 16));
    const c = rodPix(rod, k);
    ctx.drawImage(c, Math.round(cx - c.width / 2), Math.round(cy - c.height / 2));
    return;
  }
  if (kind === 'pix') {
    const base = pixIcon(id, 1);
    if (!base) return;
    const k = Math.max(1, Math.floor(size / Math.max(base.width, base.height)));
    const c = pixIcon(id, k);
    ctx.drawImage(c, Math.round(cx - c.width / 2), Math.round(cy - c.height / 2));
    return;
  }
  if (kind === 'item') drawItem(ctx, id, cx, Math.round(cy + size / 2), { box: [size, size], t, big: size > 48 });
}

export class WorkshopPanel {
  constructor() {
    this.id = 'workshop';
    this.modal = true;
    this.sound = 'ui_page';
    this.cat = 'rods';
    this.sel = null;
    this.t = 0;
    this.fx = new PixFx(300);
    this.hammer = null;
    this.scroll = 0;
  }

  open(data) {
    const st = this.game.state;
    ensureWorkshop(st);
    ensureRods(st);
    this.limited = !workshopUnlocked(st);
    this.showMarina = false;
    const cat = CAT_ALIAS[data?.cat] || data?.cat;
    if (cat && WS_CATS.some((c) => c.id === cat)) this.cat = cat;
    if (data?.recipe) { const r = wsRecipe(st, data.recipe); if (r) { this.cat = r.cat; this.sel = r.id; if (this.limited && !r.lab) this.showMarina = true; } }
    if (!this.sel || wsRecipe(st, this.sel)?.cat !== this.cat) this.sel = this.firstOf(this.cat);
    this.scroll = 0;
    this.t = 0;
    this.fx.list = [];
    this.game.emit?.('workshopOpen', {});
  }

  cats() { return this.limited ? WS_CATS.filter((c) => BENCH_CATS.has(c.id)) : WS_CATS; }

  firstOf(cat) {
    const st = this.game.state;
    const list = recipesFor(st, cat).filter((rc) => !this.limited || rc.lab);
    return (list.find((r) => wsUnlocked(st, r) && wsCheck(st, r).ok) || list.find((r) => wsUnlocked(st, r)) || list[0])?.id || null;
  }

  layout() {
    const r = panelRect(this.game, 930, 492);
    const c = { x: r.x + 10, y: r.y + 36, w: r.w - 20, h: r.h - 46 };
    const tabs = { x: c.x, y: c.y, w: 58, h: c.h };
    const detW = Math.min(318, Math.round(c.w * 0.36));
    const det = { x: c.x + c.w - detW, y: c.y, w: detW, h: c.h };
    const mid = { x: tabs.x + tabs.w + 8, y: c.y, w: det.x - (tabs.x + tabs.w + 16), h: c.h };
    const queue = { x: mid.x, y: mid.y + mid.h - 58, w: mid.w, h: 58 };
    const grid = { x: mid.x, y: mid.y, w: mid.w, h: queue.y - mid.y - 6 };
    return { r, c, tabs, det, mid, grid, queue };
  }

  draw(ctx, ui, dt) {
    const g = this.game, st = g.state;
    dt = Math.max(0, Math.min(0.05, dt || 0.016));
    this.t += dt;
    const L = this.layout();
    this.rect = L.r;
    try { wsTick(g); } catch (e) { console.error(e); }
    const FR = drawAeroFrame(ctx, L.r.x, L.r.y, L.r.w, L.r.h, { title: 'Marina\'s Workshop', icon: pixIcon('hammer', 2), seed: 31 });
    // until Marina's quest opens the Workshop, only the Lab's workbench recipes (buildings, decor, bait) are here
    this.limited = !workshopUnlocked(st);
    if (this.limited && !BENCH_CATS.has(this.cat)) { this.cat = 'build'; this.sel = this.firstOf('build'); }
    if (this.showMarina) this.drawLocked(ctx, ui, L);
    else {
      this.drawTabs(ctx, ui, L.tabs);
      this.drawGrid(ctx, ui, L.grid);
      this.drawQueue(ctx, ui, L.queue);
      this.drawDetail(ctx, ui, L.det, dt);
    }
    this.fx.update(dt);
    this.fx.draw(ctx);
    FR.finish();
    // Aero balance chip in the header
    const coinTxt = fmtAero(st.coins);
    const cw = measureText(coinTxt, 'big') + 34;
    const cx = L.r.x + L.r.w - 34 - cw;
    ctx.drawImage(aeroCached(`wscoin|${cw}`, () => aeroSurface(cw, 22, { tone: 'white', r: 'pill', gloss: 0.7, glossH: 9, rim: 0.9 })), cx, L.r.y + 4);
    drawAeroCoin(ctx, cx + 12, L.r.y + 15, 7, this.t);
    drawText(ctx, coinTxt, cx + cw - 9, L.r.y + 10, { font: 'big', align: 'right', color: INK });
    if (ui.button(ctx, FR.close.x, FR.close.y, FR.close.w, FR.close.h, '', { icon: 'cross', tip: 'Close (Esc)' })) ui.close(this.id);
  }

  // ------------------------------------------------------------------ locked
  drawLocked(ctx, ui, L) {
    const g = this.game, c = L.c, t = this.t;
    drawAeroCard(ctx, c.x + 40, c.y + 20, c.w - 80, c.h - 40, { tone: 'frost' });
    NPC.drawNPC(ctx, 'marina', { x: c.x + 170, y: c.y + c.h - 50, t, scale: 1.6, pose: 'wave', talk: (Math.sin(t * 3) + 1) * 0.3, mood: 'happy' });
    const tx = c.x + 290;
    drawText(ctx, 'The Workshop is still a mess!', tx, c.y + 70, { font: 'big', scale: 2, color: INK });
    const lines = wrapText('Marina needs a hand fixing up her crafting dock. Finish her Chapter 2 quest "Marina\'s Workshop" (bring her 8 Driftwood and 3 Shells) and it opens up: rods, tackle, boat parts, tank gear and more!', c.w - 360, 'big');
    lines.forEach((l, i) => drawText(ctx, l, tx, c.y + 110 + i * 15, { font: 'big', color: INK_SOFT }));
    [['driftwood', 8], ['shell', 3]].forEach(([id, n], i) => {
      const have = countItem(g.state, id);
      drawText(ctx, `${ITEMS[id]?.name}: ${Math.min(n, have)} / ${n}`, tx, c.y + 120 + (lines.length + i) * 15, { font: 'big', color: have >= n ? OK : BAD });
    });
    if (g.ui.panels.quests && ui.button(ctx, tx, c.y + c.h - 100, 200, 32, 'Open Quests', { style: 'orange', icon: 'star' })) { ui.close(this.id); ui.open('quests'); }
    if (ui.button(ctx, tx + 214, c.y + c.h - 100, 200, 32, 'Workbench', { style: 'aqua', icon: 'arrow_l', tip: 'Lab recipes you can already make' })) this.showMarina = false;
  }

  // ------------------------------------------------------------------ category tabs
  drawTabs(ctx, ui, R) {
    const st = this.game.state, t = this.t;
    const h = Math.min(56, Math.floor((R.h - 4) / WS_CATS.length));
    if (this.limited) {
      const r = { x: R.x, y: R.y + R.h - 58, w: R.w, h: 54 };
      ctx.drawImage(aeroCached(`wstab|${r.w}|${r.h}|purple`, () => aeroSurface(r.w, r.h, { tone: 'purple', r: 9, gloss: 0.7, glossH: 22, rim: 0.9, glow: 0.6 })), r.x, r.y);
      const lk = getUiIcon('lock');
      if (lk) ctx.drawImage(lk, Math.round(r.x + r.w / 2 - lk.width / 2), r.y + 12);
      drawText(ctx, 'More', r.x + r.w / 2, r.y + r.h - 13, { font: 'small', align: 'center', color: '#ffffff' });
      if (ui.hover(r)) ui.tip = 'Rods, tackle, boat parts and tank gear: finish Marina\'s quest!';
      if (ui.clicked(r)) { this.showMarina = true; this.game.audio.play('ui_click'); }
    }
    const cats = this.cats();
    cats.forEach((cat, i) => {
      const y = R.y + i * h, r = { x: R.x, y, w: R.w, h: h - 4 };
      const act = this.cat === cat.id, hov = ui.hover(r);
      const tone = act ? 'orange' : hov ? 'white' : 'glass';
      ctx.drawImage(aeroCached(`wstab|${r.w}|${r.h}|${tone}`, () => aeroSurface(r.w, r.h, { tone, r: 9, gloss: 0.7, glossH: Math.round(r.h * 0.42), rim: 0.9, glow: act ? 0.7 : 0.4 })), r.x, r.y);
      const ic = pixIcon(cat.icon, 2);
      if (ic) { const bob = act ? Math.round(Math.sin(t * 4) * 1.5) : 0; ctx.drawImage(ic, Math.round(r.x + r.w / 2 - ic.width / 2), Math.round(r.y + r.h / 2 - ic.height / 2) - 4 + bob); }
      const lbl = cat.short || cat.name;
      drawText(ctx, lbl, r.x + r.w / 2, r.y + r.h - 11, { font: 'small', align: 'center', color: act ? '#ffffff' : INK, shadow: act ? '#7a2a06' : null });
      const n = recipesFor(st, cat.id).filter((rc) => (!this.limited || rc.lab) && !st.workshop.seen[rc.id] && wsUnlocked(st, rc) && wsCheck(st, rc).ok).length;
      if (n) drawAeroBadge(ctx, r.x + r.w + 2, r.y - 2, n, t);
      if (hov) ui.tip = cat.name;
      if (ui.clicked(r) && !act) { this.cat = cat.id; this.sel = this.firstOf(cat.id); this.scroll = 0; this.game.audio.play('ui_tab'); }
    });
  }

  // ------------------------------------------------------------------ recipe grid
  drawGrid(ctx, ui, R) {
    const g = this.game, st = g.state, t = this.t, inp = ui.inp;
    drawAeroCard(ctx, R.x, R.y, R.w, R.h, { tone: 'frost', inset: true });
    let y0 = R.y + 8;
    const cat = WS_CATS.find((c) => c.id === this.cat);
    drawText(ctx, cat?.name || '', R.x + 10, y0, { font: 'big', scale: 1, color: INK });
    y0 += 16;
    if (this.cat === 'tackle' || this.cat === 'rods' || this.cat === 'upgrade') y0 = this.drawBench(ctx, ui, { x: R.x + 6, y: y0, w: R.w - 12 }) + 4;
    const list = recipesFor(st, this.cat).filter((rc) => !this.limited || rc.lab).sort((a, b) => (wsUnlocked(st, b) ? 1 : 0) - (wsUnlocked(st, a) ? 1 : 0));
    const TW = 74, TH = 82, gap = 6;
    const cols = Math.max(1, Math.floor((R.w - 12 + gap) / (TW + gap)));
    const area = { x: R.x + 6, y: y0, w: R.w - 12, h: R.y + R.h - 6 - y0 };
    const rows = Math.ceil(list.length / cols);
    const maxScroll = Math.max(0, rows * (TH + gap) - area.h);
    if (ui.hover(area) && inp.wheel) { this.scroll = clamp(this.scroll + Math.sign(inp.wheel) * (TH + gap), 0, maxScroll); inp.wheel = 0; }
    this.scroll = clamp(this.scroll, 0, maxScroll);
    const ox = area.x + Math.round((area.w - (cols * (TW + gap) - gap)) / 2);
    ctx.save();
    ctx.beginPath(); ctx.rect(area.x, area.y, area.w, area.h); ctx.clip();
    list.forEach((rc, i) => {
      const x = ox + (i % cols) * (TW + gap), y = area.y + Math.floor(i / cols) * (TH + gap) - this.scroll;
      if (y + TH < area.y || y > area.y + area.h) return;
      const open = wsUnlocked(st, rc), chk = open ? wsCheck(st, rc) : null;
      const sel = this.sel === rc.id, r = { x, y, w: TW, h: TH };
      const hov = ui.hover(r) && ui.hover(area);
      const col = RARITY[rc.rarity]?.color || '#c9d4dc';
      const tone = sel ? 'aqua' : hov ? 'white' : 'frost';
      if (open && chk.ok) drawAeroGlow(ctx, x + TW / 2, y + TH / 2, 42, '#c8ff7a', 0.25 + 0.15 * Math.sin(t * 3 + i));
      ctx.drawImage(aeroCached(`wstile|${TW}|${TH}|${tone}`, () => aeroSurface(TW, TH, { tone, r: 8, gloss: 0.6, glossH: 16, rim: 0.9, glow: 0.4 })), x, y);
      ctx.fillStyle = open ? col : '#aab8c6'; ctx.fillRect(x + 4, y + TH - 7, TW - 8, 3);
      ctx.globalAlpha = open ? 1 : 0.35;
      const bob = sel ? Math.round(Math.sin(t * 3) * 1.5) : 0;
      drawRef(ctx, rc.icon, x + TW / 2, y + 30 + bob, 40, t);
      ctx.globalAlpha = 1;
      if (!open) { const lk = getUiIcon('lock'); if (lk) ctx.drawImage(lk, Math.round(x + TW / 2 - lk.width / 2), y + 24); }
      let nm = rc.name;
      while (measureText(nm, 'small') > TW - 6 && nm.length > 3) nm = nm.slice(0, -1);
      if (nm !== rc.name) nm = nm.trimEnd() + '.';
      drawText(ctx, nm, x + TW / 2, y + TH - 22, { font: 'small', align: 'center', color: open ? INK : '#7a90a4' });
      if (open) {
        const owned = chk.owned || (rc.out?.type === 'rodlevel' && rc.maxed);
        if (owned) { const ic = getUiIcon('check'); if (ic) ctx.drawImage(ic, x + TW - 14, y + 4); }
        else if (chk.queued) { const ic = getUiIcon('clock'); if (ic) ctx.drawImage(ic, x + TW - 14, y + 4); }
        else if (chk.ok) { ctx.fillStyle = '#4cd06a'; ctx.fillRect(x + TW - 11, y + 5, 6, 6); ctx.fillStyle = '#c8ffb0'; ctx.fillRect(x + TW - 11, y + 5, 3, 2); }
        if (!st.workshop.seen[rc.id] && !owned) { drawText(ctx, 'NEW', x + 5, y + 4, { font: 'small', color: '#ff5a3a', shadow: '#ffffff' }); }
        if (rc.time) drawText(ctx, fmtT(rc.time), x + 5, y + TH - 34, { font: 'small', color: INK_SOFT });
      }
      if (hov && inp.pressed) { inp.pressed = false; this.sel = rc.id; st.workshop.seen[rc.id] = 1; g.audio.play('ui_click'); }
    });
    ctx.restore();
    if (maxScroll > 0) {
      const k = this.scroll / maxScroll, bh = Math.max(20, area.h * (area.h / (rows * (TH + gap))));
      ctx.fillStyle = 'rgba(12,58,82,0.2)'; ctx.fillRect(R.x + R.w - 6, area.y, 3, area.h);
      ctx.fillStyle = '#2fb8e8'; ctx.fillRect(R.x + R.w - 6, Math.round(area.y + (area.h - bh) * k), 3, Math.round(bh));
    }
    if (!list.length) drawText(ctx, 'Nothing here yet!', R.x + R.w / 2, R.y + R.h / 2, { font: 'big', align: 'center', color: INK_SOFT });
  }

  // The rod bench strip: the equipped rod + its four tackle slots (click a slot to see that tackle).
  drawBench(ctx, ui, R) {
    const g = this.game, st = g.state, t = this.t;
    const rods = ensureRods(st);
    const rod = ROD_BY_ID[rods.equipped];
    const h = 44;
    ctx.drawImage(aeroCached(`wsbench|${R.w}|${h}`, () => aeroSurface(R.w, h, { tone: 'sky', r: 8, gloss: 0.6, glossH: 16, rim: 0.85, glow: 0.4 })), R.x, R.y);
    const ic = rodPix(rod, 2);
    if (ic) ctx.drawImage(ic, R.x + 6, R.y + 6);
    const lv = rodLevel(st, rod.id);
    drawText(ctx, rod.name, R.x + 44, R.y + 8, { font: 'normal', color: '#ffffff', shadow: '#0a3e74' });
    if (lv) for (let i = 0; i < lv; i++) ctx.drawImage(partSprite('star', '#ffd23a', 1), R.x + 44 + i * 7, R.y + 21);
    else drawText(ctx, 'equipped', R.x + 44, R.y + 22, { font: 'small', color: '#fff6b0', shadow: '#0a3e74' });
    if (rod.perk) drawText(ctx, PERKS[rod.perk]?.name || '', R.x + 44, R.y + 31, { font: 'small', color: '#c8ffb0', shadow: '#0a3e74' });
    const sw = 38, x0 = R.x + R.w - TACKLE_SLOTS.length * (sw + 4) - 2;
    TACKLE_SLOTS.forEach((slot, i) => {
      const x = x0 + i * (sw + 4), y = R.y + 3, r = { x, y, w: sw, h: sw };
      const id = rods.tackle.on[slot];
      const hov = ui.hover(r);
      ctx.drawImage(aeroCached(`wsslot|${sw}|${hov}`, () => aeroSurface(sw, sw, { tone: hov ? 'white' : 'frost', r: 7, gloss: 0.5, glossH: 12, rim: 0.9 })), x, y);
      if (id) drawRef(ctx, 'pix:' + id, x + sw / 2, y + sw / 2 - 2, 32, t);
      else { ctx.globalAlpha = 0.25; drawRef(ctx, 'pix:' + { reel: 'reel_spin', line: 'line_braid', lure: 'lure_spoon', charm: 'charm_heart' }[slot], x + sw / 2, y + sw / 2 - 2, 32, t); ctx.globalAlpha = 1; }
      drawText(ctx, TACKLE_SLOT_NAMES[slot], x + sw / 2, y + sw - 8, { font: 'small', align: 'center', color: INK });
      if (hov) ui.tip = id ? `${TACKLE_SLOT_NAMES[slot]}: ${TACKLE_BY_ID[id]?.name}` : `${TACKLE_SLOT_NAMES[slot]}: empty (craft one!)`;
      if (ui.clicked(r)) { this.cat = 'tackle'; if (id) this.sel = 'ws_tk_' + id; g.audio.play('ui_click'); }
    });
    return R.y + h;
  }

  // ------------------------------------------------------------------ craft queue
  drawQueue(ctx, ui, R) {
    const g = this.game, st = g.state, t = this.t;
    const W = ensureWorkshop(st), n = wsSlots(st);
    ctx.drawImage(aeroCached(`wsq|${R.w}|${R.h}`, () => aeroSurface(R.w, R.h, { tone: 'dark', r: 9, gloss: 0.5, glossH: 16, rim: 0.8, glow: 0.4 })), R.x, R.y);
    drawText(ctx, 'CRAFTING', R.x + 10, R.y + 6, { font: 'small', color: '#bfeaff' });
    const sw = Math.floor((R.w - 20 - (n - 1) * 6) / n);
    for (let i = 0; i < n; i++) {
      const x = R.x + 10 + i * (sw + 6), y = R.y + 16, h = R.h - 22;
      const e = W.queue[i];
      ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(x, y, sw, h);
      if (!e) { drawText(ctx, 'empty bench', x + sw / 2, y + h / 2 - 3, { font: 'small', align: 'center', color: 'rgba(191,234,255,0.6)' }); continue; }
      const k = wsProgress(e), rem = wsRemaining(e);
      // the little hammering animation
      const ham = pixIcon('hammer', 1);
      const ang = Math.sin(t * 9 + i) > 0.6 ? -0.6 : 0.2;
      drawRef(ctx, e.icon, x + 18, y + h / 2, 28, t);
      if (ham) { ctx.save(); ctx.translate(x + 34, y + 10); ctx.rotate(ang); ctx.drawImage(ham, -4, -12); ctx.restore(); }
      if (ang < 0 && Math.random() < 0.3) this.fx.add({ x: x + 28, y: y + 14, vx: (Math.random() - 0.5) * 80, vy: -60 - Math.random() * 40, g: 300, life: 0.4, kind: 'spark', color: '#ffe27a' });
      let nm = e.name || '';
      while (measureText(nm, 'small') > sw - 100 && nm.length > 3) nm = nm.slice(0, -1);
      drawText(ctx, nm, x + 44, y + 4, { font: 'small', color: '#ffffff' });
      ctx.fillStyle = '#0a2440'; ctx.fillRect(x + 44, y + 15, sw - 100, 7);
      ctx.fillStyle = '#ffb43c'; ctx.fillRect(x + 45, y + 16, Math.round((sw - 102) * k), 5);
      ctx.fillStyle = '#ffe8b0'; ctx.fillRect(x + 45, y + 16, Math.round((sw - 102) * k), 1);
      drawText(ctx, fmtT(rem), x + 44, y + 25, { font: 'small', color: '#bfeaff' });
      const cost = wsRushCost(e);
      if (ui.button(ctx, x + sw - 52, y + 4, 48, h - 8, `${cost}`, { style: 'orange', icon: 'clock', disabled: st.coins < cost, tip: `Rush it for ${cost} Aero` })) { if (wsRush(g, i)) this.celebrate(wsRecipe(st, e.rid)); }
    }
  }

  // ------------------------------------------------------------------ detail card + anvil
  drawDetail(ctx, ui, R, dt) {
    const g = this.game, st = g.state, t = this.t;
    drawAeroCard(ctx, R.x, R.y, R.w, R.h, { tone: 'frost' });
    const rc = this.sel ? wsRecipe(st, this.sel) : null;
    if (!rc) { drawText(ctx, 'Pick a recipe!', R.x + R.w / 2, R.y + R.h / 2, { font: 'big', align: 'center', color: INK_SOFT }); return; }
    st.workshop.seen[rc.id] = 1;
    const open = wsUnlocked(st, rc), chk = wsCheck(st, rc);
    const x = R.x + 12, w = R.w - 24;
    let y = R.y + 10;
    const col = RARITY[rc.rarity]?.color || '#c9d4dc';
    // anvil stage with the big art (Marina hammers here)
    const stH = 112;
    ctx.drawImage(aeroCached(`wsstage|${w}|${stH}`, () => aeroSurface(w, stH, { tone: 'sky', r: 10, gloss: 0.5, glossH: 30, rim: 0.9, glow: 0.5, sparkle: 2 })), x, y);
    drawAeroGlow(ctx, x + w / 2, y + stH / 2, 70, col, 0.45);
    this.drawAnvil(ctx, x, y, w, stH, rc, dt);
    y += stH + 8;
    drawText(ctx, rc.name, x, y, { font: 'big', scale: measureText(rc.name, 'big', 2) <= w ? 2 : 1, color: INK });
    y += measureText(rc.name, 'big', 2) <= w ? 22 : 13;
    const rn = RARITY[rc.rarity]?.name || '';
    ctx.fillStyle = col; ctx.fillRect(x, y, measureText(rn, 'small') + 10, 11);
    drawText(ctx, rn.toUpperCase(), x + 5, y + 3, { font: 'small', color: '#ffffff', shadow: shade(col, -0.6) });
    if (rc.time) drawText(ctx, `${fmtT(rc.time)} craft`, x + w, y + 2, { font: 'normal', align: 'right', color: INK_SOFT });
    y += 16;
    const lines = wrapText(rc.desc || '', w, 'normal').slice(0, 3);
    lines.forEach((l, i) => drawText(ctx, l, x, y + i * 11, { color: INK_SOFT }));
    y += lines.length * 11 + 4;
    y = this.drawStats(ctx, ui, rc, x, y, w);
    // materials: have / need
    const btnY = R.y + R.h - 42;
    const rows = [];
    if (rc.cost?.aero) rows.push({ aero: true, have: chk.aero.have, need: chk.aero.need, ok: chk.aero.ok });
    for (const it of chk.items) rows.push(it);
    const rowH = 15, avail = btnY - y - 6, perCol = Math.max(1, Math.floor(avail / rowH));
    const cols = rows.length > perCol ? 2 : 1, cw = Math.floor(w / cols);
    rows.forEach((m, i) => {
      const cx = x + Math.floor(i / perCol) * cw, cy = y + (i % perCol) * rowH;
      if (cy + rowH > btnY) return;
      if (m.aero) drawAeroCoin(ctx, cx + 6, cy + 6, 5, t);
      else { const ic = itemIcon(m.id, 13); if (ic) ctx.drawImage(ic, cx, cy); }
      let nm = m.aero ? 'Aero' : ITEMS[m.id]?.name || m.id;
      const qty = `${m.aero ? fmtAero(m.have) : Math.min(m.have, 999)}/${m.aero ? fmtAero(m.need) : m.need}`;
      while (measureText(nm, 'normal') > cw - measureText(qty, 'normal') - 24 && nm.length > 3) nm = nm.slice(0, -1);
      drawText(ctx, nm, cx + 16, cy + 2, { color: INK });
      drawText(ctx, qty, cx + cw - 6, cy + 2, { align: 'right', color: m.ok ? OK : BAD });
      if (ui.hover({ x: cx, y: cy, w: cw, h: rowH }) && !m.aero) ui.tip = `${ITEMS[m.id]?.name}: ${ITEMS[m.id]?.desc || ''}`;
    });
    // the craft / equip button
    const bx = x, bw = w, bh = 32;
    const o = rc.out || {};
    if (open && chk.owned && o.type === 'rod') {
      const eq = ensureRods(st).equipped === o.id;
      if (ui.button(ctx, bx, btnY, bw, bh, eq ? 'Equipped' : 'Equip rod', { style: 'green', icon: 'check', disabled: eq })) { equipRod(st, o.id); g.emit?.('rodEquipped', o.id); g.recomputeStats?.(); if (g.fishing) g.fishing.rodC = null; g.save?.(); }
    } else if (open && chk.owned && o.type === 'tackle') {
      const on = ensureRods(st).tackle.on[TACKLE_BY_ID[o.id]?.slot] === o.id;
      if (ui.button(ctx, bx, btnY, bw, bh, on ? 'Unequip' : 'Equip on rod', { style: on ? 'glass' : 'green', icon: 'check' })) {
        equipTackle(st, on ? null : o.id, TACKLE_BY_ID[o.id]?.slot);
        g.audio.play('reel_tick'); g.recomputeStats?.(); if (g.fishing) g.fishing.rodC = null; g.emit?.('tackleEquipped', { id: o.id }); g.save?.();
      }
    } else if (!open) {
      ui.button(ctx, bx, btnY, bw, bh, 'Locked', { style: 'grey', icon: 'lock', disabled: true, tip: chk.reason });
      wrapText(chk.reason, w, 'small').slice(0, 2).forEach((l, i) => drawText(ctx, l, x + w / 2, btnY - 18 + i * 8, { font: 'small', align: 'center', color: BAD }));
    } else {
      const label = chk.ok ? (rc.time ? `Craft (${fmtT(rc.time)})` : 'Craft!') : chk.reason;
      const busy = this.hammer && this.hammer.t < 0.9;
      if (ui.button(ctx, bx, btnY, bw, bh, label, { style: chk.ok ? 'green' : 'grey', icon: chk.ok ? 'star' : null, disabled: !chk.ok || busy, sound: 'ui_buy', tip: chk.ok ? 'Hammer it together!' : chk.reason })) this.doCraft(rc);
    }
  }

  drawStats(ctx, ui, rc, x, y, w) {
    const st = this.game.state, o = rc.out || {};
    if (o.type === 'rod' || o.type === 'rodlevel') {
      const id = o.id;
      const cur = rodStatsOf(st, id, null, { tackle: false, context: false, lv: o.type === 'rodlevel' ? o.lv - 1 : 0 });
      const nxt = o.type === 'rodlevel' ? rodStatsOf(st, id, null, { tackle: false, context: false, lv: Math.min(MAX_ROD_LEVEL, o.lv) }) : null;
      const eq = o.type === 'rod' ? rodStatsOf(st, ensureRods(st).equipped, null, { tackle: false, context: false }) : null;
      for (const k of ROD_STAT_KEYS) {
        const v = k.key === 'shock' ? cur.shock.power : cur[k.key];
        const v2 = nxt ? (k.key === 'shock' ? nxt.shock.power : nxt[k.key]) : null;
        const ve = eq ? (k.key === 'shock' ? eq.shock.power : eq[k.key]) : null;
        const kk = (q) => clamp01(k.log ? Math.log(1 + q) / Math.log(1 + k.max) : q / k.max);
        const ic = getUiIcon(k.icon);
        if (ic) ctx.drawImage(ic, x, y - 1);
        drawText(ctx, k.label, x + 13, y, { font: 'small', color: INK_SOFT });
        const bx = x + 70, bw = w - 116;
        ctx.fillStyle = '#d4e6f2'; ctx.fillRect(bx, y + 1, bw, 6);
        if (v2 !== null) { ctx.fillStyle = '#8ae84a'; ctx.fillRect(bx, y + 1, Math.round(bw * kk(v2)), 6); }
        ctx.fillStyle = '#2fb8e8'; ctx.fillRect(bx, y + 1, Math.round(bw * kk(v)), 6);
        ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.fillRect(bx, y + 1, Math.round(bw * kk(v)), 2);
        if (ve !== null) { ctx.fillStyle = '#ff5a3a'; ctx.fillRect(bx + Math.round(bw * kk(ve)) - 1, y - 1, 2, 10); }
        const fmt = (q) => (k.key === 'strength' ? `${Math.round(q)}kg` : k.key === 'resilience' ? `${Math.round(q * 100)}%` : q.toFixed(2));
        drawText(ctx, v2 !== null ? fmt(v2) : fmt(v), x + w, y, { font: 'small', align: 'right', color: v2 !== null ? OK : INK });
        y += 10;
      }
      const perk = ROD_BY_ID[id]?.perk;
      if (perk && PERKS[perk]) {
        y += 2;
        const p = PERKS[perk];
        ctx.fillStyle = '#fff2c8'; ctx.fillRect(x, y - 2, w, 22);
        drawText(ctx, `PERK: ${p.name}`, x + 4, y, { font: 'small', color: '#a8680e' });
        drawText(ctx, wrapText(p.desc, w - 8, 'small')[0] || '', x + 4, y + 9, { font: 'small', color: INK });
        y += 24;
      }
      if (eq) { drawText(ctx, 'red mark = your equipped rod', x, y, { font: 'small', color: '#ff5a3a' }); y += 9; }
      return y + 4;
    }
    if (o.type === 'tackle') {
      const tk = TACKLE_BY_ID[o.id];
      const chips = [];
      const M = tk?.mods || {};
      if (M.lure) chips.push(`Lure +${Math.round((M.lure - 1) * 100)}%`);
      if (M.luck) chips.push(`Luck +${Math.round((M.luck - 1) * 100)}%`);
      if (M.control) chips.push(`Control +${Math.round((M.control - 1) * 100)}%`);
      if (M.strength) chips.push(`Strength +${Math.round((M.strength - 1) * 100)}%`);
      if (M.resil) chips.push(`Resilience +${Math.round(M.resil * 100)}`);
      if (M.charges) chips.push(`+${M.charges} shock`);
      for (const [k, v] of Object.entries(tk?.game || {})) chips.push(k === 'reelSpeed' ? `Reel +${v}` : k === 'lantern' ? 'Glowing hook' : k === 'crateLuck' ? 'Crate luck' : k === 'calm' ? 'Calmer fish' : k);
      let cx = x;
      drawText(ctx, `${TACKLE_SLOT_NAMES[tk?.slot] || ''} slot`, x, y, { font: 'small', color: INK_SOFT });
      y += 10;
      for (const c of chips) {
        const cw = measureText(c, 'small') + 10;
        if (cx + cw > x + w) { cx = x; y += 13; }
        ctx.fillStyle = '#d8f5c8'; ctx.fillRect(cx, y, cw, 11);
        drawText(ctx, c, cx + 5, y + 3, { font: 'small', color: OK });
        cx += cw + 4;
      }
      return y + 16;
    }
    return y;
  }

  drawAnvil(ctx, x, y, w, h, rc, dt) {
    const t = this.t, A = this.hammer;
    const anvil = pixIcon('anvil', 2);
    const ax = Math.round(x + w / 2 - (anvil?.width || 40) / 2), ay = y + h - (anvil?.height || 28) - 6;
    // Marina watching from the side
    try { NPC.drawNPC(ctx, 'marina', { x: x + 34, y: y + h - 6, t, scale: 0.9, pose: A && A.t > 0.9 && A.t < 2 ? 'cheer' : 'idle', mood: 'happy', facing: 1, shadow: false }); } catch { /* npc optional */ }
    if (anvil) ctx.drawImage(anvil, ax, ay);
    const hammering = A && A.t < 0.9;
    const pop = A && A.t >= 0.9 ? ease.outBack(clamp01((A.t - 0.9) / 0.35)) : 1;
    const ref = A ? A.icon : rc.icon;
    const bob = hammering ? 0 : Math.round(Math.sin(t * 2.4) * 2);
    ctx.save();
    const cx = x + w / 2, cy = ay - 22 + bob - (A && A.t >= 0.9 && A.t < 1.6 ? Math.sin(clamp01((A.t - 0.9) / 0.7) * Math.PI) * 14 : 0);
    ctx.translate(cx, cy);
    const sq = hammering ? 1 - Math.max(0, Math.sin(A.t * 3 * TAU)) * 0.12 : pop;
    ctx.scale(hammering ? 1 + (1 - sq) : sq, sq);
    drawRef(ctx, ref, 0, 0, 64, t);
    ctx.restore();
    // the hammer swings three times, sparks on each strike
    if (A) {
      A.t += dt;
      const ham = pixIcon('hammer', 3);
      if (hammering && ham) {
        const ph = (A.t * 3) % 1;
        const ang = ph < 0.55 ? -1.1 + ph * 0.6 : -0.8 + ((ph - 0.55) / 0.45) * 1.25;
        ctx.save(); ctx.translate(cx + 54, cy + 16); ctx.rotate(ang); ctx.drawImage(ham, -ham.width + 6, -ham.height + 8); ctx.restore();
        const strike = Math.floor(A.t * 3 - 0.98);
        if (strike >= 0 && strike !== A.last) {
          A.last = strike;
          this.fx.burst(cx + 10, cy + 10, 14, { kinds: ['spark', 'spark', 'star'], colors: ['#ffe27a', '#ffffff', '#ff9d2e'], speed: 220, speedMin: 60, g: 500, life: 0.6, up: 120, scale: 2 });
          this.game.audio.play('click', { vol: 0.6, pitch: 0.7 + strike * 0.15 }); this.game.audio.play('coin_bounce', { vol: 0.3, pitch: 0.6 });
          this.game.particles?.pixelBurst?.('spark', cx + 10, cy + 10, 6, { layer: 'ui' });
        }
      }
      if (A.t >= 0.9 && !A.popped) {
        A.popped = true;
        this.fx.burst(cx, cy, 30, { kinds: ['sparkle', 'star', 'confetti', 'heart'], colors: ['#ffffff', '#ffe27a', '#8ae8ff', '#ff9ad0', '#8ae84a'], speed: 240, speedMin: 50, g: 160, life: 1.2, up: 80, scale: 2 });
        this.game.audio.play(A.queued ? 'ui_unlock' : 'sparkle', { vol: 0.7 });
        try { this.game.particles?.[A.queued ? 'purchase' : 'celebrate']?.(cx, cy); } catch { /* optional */ }
      }
      if (A.t >= 0.9 && A.t < 2.2) {
        const txt = A.queued ? 'On the bench!' : 'Crafted!';
        drawText(ctx, txt, cx, y + 8, { font: 'big', align: 'center', color: '#ffffff', shadow: '#0a3e74', outline: 'rgba(10,62,116,0.5)' });
      }
      if (A.t > 2.4) this.hammer = null;
    } else if (Math.random() < 0.04) this.fx.add({ x: cx + (Math.random() - 0.5) * 50, y: cy + (Math.random() - 0.5) * 30, vx: 0, vy: -10, g: 0, life: 0.8, kind: 'sparkle', color: '#ffffff' });
  }

  doCraft(rc) {
    const g = this.game;
    const res = wsCraft(g, rc.id);
    if (!res.ok) { g.audio.play('ui_error'); g.toast?.(res.reason || 'Cannot craft that yet.', 'lock'); return; }
    this.hammer = { t: 0, icon: rc.icon, queued: !!res.queued, last: -1 };
    if (!res.queued) this.celebrate(rc, true);
  }
  celebrate(rc, quiet = false) {
    if (!rc) return;
    if (!quiet) this.hammer = { t: 0.9, icon: rc.icon, queued: false, last: 5 };
    const o = rc.out || {};
    if (o.type === 'rod') this.game.toast?.(`New rod: ${ROD_BY_ID[o.id]?.name}! Equipped.`, 'star');
  }
}
