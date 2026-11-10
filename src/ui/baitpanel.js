// Bait panel (id 'bait', phase 3 Aero; OWNER: Online & AppSea agent).
// Tab 1 "Bait Box": consumable bait inventory (glass bubbles with counts), click to put one on the hook.
// Tab 2 "Customize": the custom bait builder (Lab recipe 'custombait'): base + scent + colour + charm + size,
// a live glossy voxel preview, the resulting mods and a batch craft paid in materials (+ a little Aero).

import { drawText, wrapText, measureText } from '../gfx/font.js';
import { rgba } from '../core/color.js';
import { getMiniIcon } from '../desktop/icons.js';
import { getUiIcon } from '../gfx/uiicons.js';
import { drawAeroPanel, drawGlossOrb, drawAeroCoin, fmtAero, drawPixelBrackets } from './aero.js';
import { centerRect } from './ui.js';
import {
  BAITS, ensureBait, baitList, equipBait, totalBait, currentBait, baitDef, craftBases, customRecipe, customCost, canCraft, craftCustom,
  SCENTS, COLOURS, CHARMS, SIZES, BATCHES, DEFAULT_RECIPE,
} from '../store/bait.js';
import { APP_DEF } from '../store/catalog.js';
import { openStore } from '../store/index.js';
import { drawBaitGloss, baitIcon } from '../fishing/baitart.js';
import { pill, glassCard, statBar, button, orbButton, wordArt, tag, INK, INK_SOFT, GRASS, rrect } from '../store/aerokit.js';
import { unlocked } from '../game/lab.js';
import { ITEMS, countItem, takeItems } from '../build/items.js';
import { itemSprite } from '../build/itemart.js';
import { ecoBand, ecoCorners, splashButton } from '../store/ecoart.js';

const DEPS = {
  unlocked: (s) => { try { return !!unlocked(s, 'recipe', 'custombait'); } catch { return false; } },
  known: (id) => !!ITEMS[id],
  count: (s, id) => countItem(s, id),
  take: (s, items) => takeItems(s, items),
};

const STATS = [
  ['attract', 'LURE', (m) => (m.attract - 0.8) / 1.6, '#2fc0e8'],
  ['rarity', 'RARE', (m) => (m.rarity - 1) / 1.2, '#b06aff'],
  ['sizeBonus', 'SIZE', (m) => (m.sizeBonus + 0.05) / 0.35, '#5cc832'],
  ['giantMul', 'GIANT', (m) => (m.giantMul - 1) / 3, '#ff9d2e'],
];
const TYPE_LABEL = {
  docs: 'Docs', folder: 'Folders', calc: 'Maths', calendar: 'Dates', music: 'Music', image: 'Pictures', video: 'Video', paint: 'Paint',
  game: 'Games', chat: 'Chat', mail: 'Mail', browser: 'Web', terminal: 'Code', settings: 'Gears', computer: 'Tech', trash: 'Junk',
  bread: 'Bread', worm: 'Worm', sugar: 'Sweet', chip: 'Chip', popup: 'Spam', flood: 'Flood', lantern: 'Light', golden: 'Gold', blackhole: 'Void', relic: 'Relic',
};

function modsOfDef(d) {
  return { attract: d.attract ?? 1, rarity: d.rarity ?? 1, sizeBonus: d.size ?? 0, giantMul: d.giant ?? 1, luck: d.luck ?? 0 };
}

export class BaitPanel {
  constructor() {
    this.id = 'bait';
    this.modal = true;
    this.sound = 'box_open';
    this.tab = 'inv';
    this.recipe = { ...DEFAULT_RECIPE };
    this.batch = 5;
    this.scroll = 0;
    this.baseScroll = 0;
    this.t = 0;
  }

  open(data) {
    this.t = 0;
    if (data?.tab) this.tab = data.tab;
    ensureBait(this.game.state);
  }

  draw(ctx, ui, dt) {
    const g = this.game, st = g.state;
    ensureBait(st);
    this.t += dt;
    const W = 456, H = 296;
    const r = centerRect(g, W, H);
    this.rect = r;
    drawAeroPanel(ctx, r.x, r.y, W, H, { tone: 'glass', radius: 12 });
    // eco header: sky band, title bubble, tabs, total, close
    ecoBand(ctx, r.x + 3, r.y + 3, W - 6, 28, this.t, { sun: [0.45, 0.15] });
    ecoCorners(ctx, r.x, r.y, W, H, this.t, 0.72);
    drawBaitGloss(ctx, BAITS.worm.art, r.x + 20, r.y + 17, 24, this.t, { tint: '#d8f8ff' });
    ctx.drawImage(wordArt('Bait', { scale: 2, top: '#ffffff', bottom: '#ffb02e', edge: '#7a3a06' }), r.x + 36, r.y + 6);
    const tabs = [['inv', 'Bait Box'], ['craft', 'Customize']];
    let tx = r.x + 98;
    for (const [id, label] of tabs) {
      const locked = id === 'craft' && !DEPS.unlocked(st);
      const w = measureText(label) + 26 + (locked ? 12 : 0);
      if (button(ui, ctx, tx, r.y + 8, w, 18, label, { tone: this.tab === id ? 'green' : 'glass', active: this.tab === id, icon: locked ? getUiIcon('lock') : null })) { this.tab = id; }
      tx += w + 6;
    }
    const total = totalBait(st);
    const tw = measureText(String(total)) + 26;
    pill(ctx, r.x + W - 40 - tw, r.y + 9, tw, 16, { color: '#3ab0e0' });
    drawBaitGloss(ctx, BAITS.crumbs.art, r.x + W - 40 - tw + 8, r.y + 17, 13, 0, { bubble: false, bob: false });
    drawText(ctx, String(total), r.x + W - 46, r.y + 13, { align: 'right', color: '#ffffff', shadow: rgba(INK, 0.5) });
    if (orbButton(ui, ctx, r.x + W - 18, r.y + 17, 8, '#ff6a5a', { glyph: 'x', sound: 'ui_close' })) { ui.close(this.id); return; }
    if (this.tab === 'craft') this.drawCraft(ctx, ui, r, W, H);
    else this.drawInventory(ctx, ui, r, W, H);
  }

  // ---------------------------------------------------------------- inventory
  drawInventory(ctx, ui, r, W, H) {
    const g = this.game, st = g.state, t = this.t;
    const cur = currentBait(st);
    // left: what's on the hook
    const lx = r.x + 10, ly = r.y + 34, lw = 140, lh = H - 44;
    glassCard(ctx, lx, ly, lw, lh, { r: 8 });
    const cx = lx + lw / 2;
    if (cur) {
      drawBaitGloss(ctx, cur.art, cx, ly + 44, 70, t, { tint: '#e8fbff' });
      pill(ctx, cx + 14, ly + 66, 30, 12, { color: GRASS });
      drawText(ctx, 'x' + cur.count, cx + 29, ly + 69, { align: 'center', color: '#ffffff', font: 'small' });
      const lines = wrapText(cur.name, lw - 12);
      lines.slice(0, 2).forEach((l, i) => drawText(ctx, l, cx, ly + 86 + i * 10, { align: 'center', color: INK }));
      this.drawStats(ctx, lx + 10, ly + 110, lw - 20, cur.mods);
      if (cur.effect) {
        tag(ctx, lx + 10, ly + 158, 'SPECIAL: ' + (TYPE_LABEL[cur.effect] || cur.effect).toUpperCase(), '#b06aff');
      } else tag(ctx, lx + 10, ly + 158, 'LIKES: ' + (TYPE_LABEL[cur.type] || cur.type || '').toUpperCase(), '#2fa8d8');
    } else {
      drawGlossOrb(ctx, cx, ly + 44, 30, '#bfefff');
      const hk = getUiIcon('hook');
      if (hk) ctx.drawImage(hk, Math.round(cx - hk.width / 2), Math.round(ly + 40 - hk.height / 2));
      drawText(ctx, 'Empty hook', cx, ly + 86, { align: 'center', color: INK_SOFT });
    }
    if (splashButton(ui, ctx, lx + 10, ly + lh - 26, lw - 20, 18, 'Get bait', { tone: 'green', tip: 'Bait Shop: buy bait packs' })) this.openStore(); // [phase4:shell]
    // right: bait grid
    const list = baitList(st);
    const gx = r.x + 160, gy = r.y + 34, gw = W - 170, gh = H - 80;
    glassCard(ctx, gx, gy, gw, gh, { r: 8, top: 'rgba(240,252,255,0.75)', bottom: 'rgba(200,236,250,0.7)' });
    const cell = 47, cols = Math.floor((gw - 8) / cell), rows = Math.floor((gh - 8) / cell);
    const maxScroll = Math.max(0, Math.ceil(list.length / cols) - rows);
    if (ui.hover({ x: gx, y: gy, w: gw, h: gh }) && g.input.wheel) this.scroll = Math.max(0, Math.min(maxScroll, this.scroll + Math.sign(g.input.wheel)));
    this.scroll = Math.min(this.scroll, maxScroll);
    let hover = null;
    const x0 = gx + Math.round((gw - cols * cell) / 2), y0 = gy + 5;
    for (let i = this.scroll * cols; i < list.length && i < (this.scroll + rows) * cols; i++) {
      const e = list[i], k = i - this.scroll * cols;
      const x = x0 + (k % cols) * cell, y = y0 + Math.floor(k / cols) * cell;
      const rr = { x: x + 1, y: y + 1, w: cell - 2, h: cell - 2 };
      const hov = ui.hover(rr), on = cur?.id === e.id;
      if (on || hov) { rrect(ctx, rr.x, rr.y, rr.w, rr.h, 8); ctx.fillStyle = on ? 'rgba(120,230,90,0.35)' : 'rgba(255,255,255,0.45)'; ctx.fill(); }
      drawBaitGloss(ctx, e.def.art, x + cell / 2, y + cell / 2 - 1, 38, this.t + i * 0.37, { tint: on ? '#e2ffd0' : '#e8fbff', rim: on ? '#4cc830' : '#2fb8e0', bob: hov || on });
      if (e.def.app) { const mi = getMiniIcon(APP_DEF[e.def.app]?.icon || 'notes'); if (mi) ctx.drawImage(mi, x + 2, y + 2, 11, 11); }
      if (e.custom) tag(ctx, x + 2, y + 2, 'MY', '#ff7ab4');
      const cnt = 'x' + e.count, cw = measureText(cnt, 'small') + 6;
      pill(ctx, x + cell - cw - 3, y + cell - 12, cw, 9, { color: on ? GRASS : '#2f9ed8', r: 4 });
      drawText(ctx, cnt, x + cell - 6, y + cell - 10, { font: 'small', align: 'right', color: '#ffffff' });
      if (e.def.tier >= 0) for (let d = 0; d <= e.def.tier; d++) drawGlossOrb(ctx, x + 5 + d * 4, y + cell - 7, 1.6, ['#9aa8b8', '#2c9c5c', '#2a64d0', '#8a34d0', '#e8a62a'][e.def.tier]);
      if (hov) hover = e;
      if (ui.clicked(rr)) this.equip(e.id);
    }
    if (!list.length) {
      drawText(ctx, 'No bait left!', gx + gw / 2, gy + gh / 2 - 14, { align: 'center', color: INK, scale: 1 });
      drawText(ctx, 'Buy some at the Bait Shop', gx + gw / 2, gy + gh / 2, { align: 'center', color: INK_SOFT });
    }
    if (maxScroll > 0) {
      const sh = gh - 12, th = Math.max(12, sh * (rows / (rows + maxScroll)));
      pill(ctx, gx + gw - 6, gy + 6 + (sh - th) * (this.scroll / maxScroll), 4, th, { color: '#7ad0f0', gloss: false });
    }
    // info strip
    const iy = r.y + H - 42;
    glassCard(ctx, gx, iy, gw, 32, { r: 8 });
    const e = hover || (cur ? { def: baitDef(st, cur.id), count: cur.count } : null);
    if (e?.def) {
      drawText(ctx, e.def.name, gx + 8, iy + 5, { color: INK });
      const desc = wrapText(e.def.desc || '', gw - 16, 'small')[0] || '';
      drawText(ctx, desc.toUpperCase(), gx + 8, iy + 18, { font: 'small', color: INK_SOFT });
      if (hover) drawText(ctx, hover.id === cur?.id ? 'ON HOOK' : 'CLICK TO EQUIP', gx + gw - 8, iy + 6, { font: 'small', align: 'right', color: hover.id === cur?.id ? '#3a9a20' : '#2a8ac0' });
    } else drawText(ctx, 'One bait is used per fish hooked.', gx + 8, iy + 11, { color: INK_SOFT });
  }

  drawStats(ctx, x, y, w, m, base = null) {
    STATS.forEach(([key, label, norm, color], i) => {
      const yy = y + i * 11;
      drawText(ctx, label, x, yy + 1, { font: 'small', color: INK_SOFT });
      statBar(ctx, x + 30, yy, w - 30, 7, norm(m), color);
      if (base) {
        const d = norm(m) - norm(base);
        if (Math.abs(d) > 0.005) drawText(ctx, d > 0 ? '+' : '-', x + w + 2, yy, { font: 'small', color: d > 0 ? '#2a9a20' : '#d04040' });
      }
    });
  }

  equip(id) {
    const g = this.game;
    if (!equipBait(g.state, id)) return;
    g.audio.play('ui_click');
    try { g.baitFx?.onEquip?.(g.currentBait?.()); } catch (e) { /* bait fx optional */ }
    g.emit?.('baitEquipped', id);
    g.save?.();
  }

  openStore() {
    const g = this.game;
    g.ui.close(this.id);
    try { openStore(g, { page: 'home' }); } catch (e) { g.toast?.('The Bait Shop is closed.', 'info'); } // [phase4:shell]
  }

  // ---------------------------------------------------------------- custom builder
  drawCraft(ctx, ui, r, W, H) {
    const g = this.game, st = g.state, t = this.t;
    const unlockedNow = DEPS.unlocked(st);
    const bases = craftBases(st);
    if (!bases.includes(this.recipe.base)) this.recipe.base = bases[0] || 'crumbs';
    const rec = customRecipe(st, this.recipe);
    const base = BAITS[rec.base];
    const art = { ...base.art, custom: true, color: COLOURS.find((c) => c.id === rec.color)?.hex, charm: rec.charm, scale: SIZES.find((s) => s.id === rec.size)?.scale, scent: SCENTS.find((s) => s.id === rec.scent)?.color };
    // preview
    const lx = r.x + 10, ly = r.y + 34, lw = 140, lh = H - 44;
    glassCard(ctx, lx, ly, lw, lh, { r: 8 });
    const cx = lx + lw / 2;
    drawBaitGloss(ctx, art, cx, ly + 46, 78, t, { tint: '#fff6e8', rim: art.color || '#2fb8e0' });
    const lines = wrapText(rec.name, lw - 12);
    lines.slice(0, 2).forEach((l, i) => drawText(ctx, l, cx, ly + 90 + i * 10, { align: 'center', color: INK }));
    this.drawStats(ctx, lx + 10, ly + 114, lw - 26, rec.mods, modsOfDef(base));
    // option rows
    const ox = r.x + 160, ow = W - 170;
    glassCard(ctx, ox, ly, ow, lh, { r: 8, top: 'rgba(240,252,255,0.75)', bottom: 'rgba(200,236,250,0.7)' });
    let y = ly + 6;
    const label = (txt) => drawText(ctx, txt, ox + 8, y + 6, { font: 'small', color: INK_SOFT });
    // base chips
    label('BASE');
    const per = Math.floor((ow - 70) / 26);
    const maxB = Math.max(0, bases.length - per);
    this.baseScroll = Math.max(0, Math.min(maxB, this.baseScroll));
    if (maxB > 0) {
      if (orbButton(ui, ctx, ox + 46, y + 9, 5, '#7ab8e0', { glyph: '<' })) this.baseScroll = Math.max(0, this.baseScroll - 3);
      if (orbButton(ui, ctx, ox + ow - 10, y + 9, 5, '#7ab8e0', { glyph: '>' })) this.baseScroll = Math.min(maxB, this.baseScroll + 3);
    }
    bases.slice(this.baseScroll, this.baseScroll + per).forEach((id, i) => {
      const bx = ox + 56 + i * 26 + 12, by = y + 9;
      const on = id === rec.base, rr = { x: bx - 12, y: by - 12, w: 24, h: 24 };
      const hov = ui.hover(rr);
      drawBaitGloss(ctx, BAITS[id].art, bx, by, 22, t, { tint: on ? '#e2ffd0' : '#ffffff', rim: on ? '#4cc830' : '#7ac8e8', bob: on });
      if (hov) ui.tip = BAITS[id].name;
      if (ui.clicked(rr)) { this.recipe.base = id; g.audio.play('ui_click'); }
    });
    y += 26;
    // scent
    label('SCENT');
    SCENTS.forEach((s, i) => {
      const bx = ox + 68 + i * 26, by = y + 9, on = s.id === rec.scent, rr = { x: bx - 10, y: by - 10, w: 20, h: 20 };
      if (on) drawPixelBrackets(ctx, bx - 9, by - 9, 18, 18, t, { col: GRASS, ink: '#1a5e12' }); // [phase8:ui] selected marker, no ring
      drawGlossOrb(ctx, bx, by, 7, s.id === 'none' ? '#e8f0f4' : s.color);
      if (s.id !== 'none') for (let k = 0; k < 3; k++) { ctx.fillStyle = rgba(s.color, 0.8); ctx.fillRect(Math.round(bx + 6 + k * 2), Math.round(by - 8 - Math.abs(Math.sin(t * 2 + k)) * 3 - k), 1, 1); }
      if (ui.hover(rr)) ui.tip = s.name;
      if (ui.clicked(rr)) { this.recipe.scent = s.id; g.audio.play('ui_click'); }
    });
    y += 24;
    // colour
    label('COLOUR');
    COLOURS.forEach((c, i) => {
      const bx = ox + 68 + i * 26, by = y + 9, on = c.id === rec.color, rr = { x: bx - 10, y: by - 10, w: 20, h: 20 };
      if (on) drawPixelBrackets(ctx, bx - 9, by - 9, 18, 18, t, { col: GRASS, ink: '#1a5e12' }); // [phase8:ui] selected marker, no ring
      drawGlossOrb(ctx, bx, by, 7.5, c.hex);
      if (ui.hover(rr)) ui.tip = c.name;
      if (ui.clicked(rr)) { this.recipe.color = c.id; g.audio.play('ui_click'); }
    });
    y += 24;
    // charm
    label('CHARM');
    CHARMS.forEach((c, i) => {
      const bx = ox + 68 + i * 26, by = y + 9, on = c.id === rec.charm, rr = { x: bx - 11, y: by - 11, w: 22, h: 22 };
      drawGlossOrb(ctx, bx, by, 9.5, on ? '#c8f5a0' : '#dff4ff');
      if (c.id !== 'none') { const sp = baitIcon({ shape: 'charm', charm: c.id }, 12); ctx.drawImage(sp.canvas, Math.round(bx - sp.w / 2), Math.round(by - sp.h / 2)); }
      else drawText(ctx, '-', bx, by - 3, { align: 'center', color: INK_SOFT });
      if (ui.hover(rr)) ui.tip = c.name;
      if (ui.clicked(rr)) { this.recipe.charm = c.id; g.audio.play('ui_click'); }
    });
    y += 26;
    // size
    label('SIZE');
    SIZES.forEach((s, i) => {
      const bw = 40, bx = ox + 58 + i * (bw + 6);
      if (button(ui, ctx, bx, y + 1, bw, 16, s.name.slice(0, 1) === 'M' ? 'M' : s.name.slice(0, 1), { tone: s.id === rec.size ? 'green' : 'glass', active: s.id === rec.size, tip: s.name })) this.recipe.size = s.id;
    });
    y += 24;
    // cost + batch + craft
    const cost = customCost(st, rec, this.batch, DEPS);
    ctx.fillStyle = 'rgba(12,58,82,0.12)'; ctx.fillRect(ox + 8, y, ow - 16, 1);
    y += 5;
    let cxp = ox + 10;
    for (const [id, q] of Object.entries(cost.items)) {
      const have = countItem(st, id);
      const ok = have >= q;
      pill(ctx, cxp, y, 46, 18, { color: ok ? '#e8f8ff' : '#ffe0dc', edge: ok ? 'rgba(120,190,225,0.9)' : 'rgba(230,110,100,0.9)' });
      let spr = null;
      try { spr = itemSprite(id, { scale: 0.5 }); } catch { spr = null; }
      if (spr) ctx.drawImage(spr.canvas, Math.round(cxp + 9 - spr.w / 2), Math.round(y + 9 - spr.h / 2));
      else drawGlossOrb(ctx, cxp + 9, y + 9, 5, '#9ad8f0');
      drawText(ctx, `${Math.min(have, 99)}/${q}`, cxp + 19, y + 6, { font: 'small', color: ok ? INK : '#c03030' });
      const rr = { x: cxp, y, w: 46, h: 18 };
      if (ui.hover(rr)) ui.tip = ITEMS[id]?.name || id;
      cxp += 50;
      if (cxp > ox + ow - 60) break;
    }
    const aeroOk = (st.coins || 0) >= cost.aero;
    pill(ctx, cxp, y, 46, 18, { color: aeroOk ? '#e8f8ff' : '#ffe0dc' });
    drawAeroCoin(ctx, cxp + 9, y + 9, 5, t);
    drawText(ctx, fmtAero(cost.aero), cxp + 17, y + 6, { font: 'small', color: aeroOk ? INK : '#c03030' });
    y += 24;
    BATCHES.forEach((b, i) => {
      if (button(ui, ctx, ox + 10 + i * 36, y, 32, 18, 'x' + b, { tone: this.batch === b ? 'green' : 'glass', active: this.batch === b })) this.batch = b;
    });
    const chk = canCraft(st, rec, this.batch, DEPS);
    if (splashButton(ui, ctx, ox + ow - 92, y - 1, 84, 20, 'Craft!', { tone: 'orange', disabled: !chk.ok, sound: 'ui_buy', tip: chk.ok ? `Make ${this.batch}` : chk.reason === 'items' ? 'Need more materials' : chk.reason === 'aero' ? 'Need more Aero' : null })) {
      const res = craftCustom(st, rec, this.batch, DEPS);
      if (res.ok) {
        g.toast?.(`Crafted ${this.batch}x ${res.bait.name}!`, 'sparkle');
        g.particles?.burst?.(r.x + 80, r.y + 80, 14, { colors: ['#ffffff', art.color || '#8ff3ff', '#ffe27a'], speed: 70, g: 0, life: 0.6, layer: 'ui' });
        g.emit?.('baitCrafted', res.bait);
        g.save?.();
      } else g.audio.play('ui_error');
    }
    if (!unlockedNow) this.drawLocked(ctx, ui, ox, ly, ow, lh);
  }

  drawLocked(ctx, ui, x, y, w, h) {
    const g = this.game;
    ctx.save();
    rrect(ctx, x, y, w, h, 8);
    ctx.fillStyle = 'rgba(225,245,255,0.82)'; ctx.fill();
    ctx.restore();
    drawGlossOrb(ctx, x + w / 2, y + h / 2 - 34, 20, '#ffd27a');
    const lk = getUiIcon('lock');
    if (lk) ctx.drawImage(lk, Math.round(x + w / 2 - lk.width / 2), Math.round(y + h / 2 - 34 - lk.height / 2));
    drawText(ctx, 'Custom Bait', x + w / 2, y + h / 2 - 6, { align: 'center', color: INK, scale: 1 });
    drawText(ctx, 'RESEARCH IT IN THE LAB', x + w / 2, y + h / 2 + 8, { align: 'center', font: 'small', color: INK_SOFT });
    if (splashButton(ui, ctx, x + w / 2 - 50, y + h / 2 + 22, 100, 20, 'The Lab', { tone: 'green' })) {
      if (g.ui.panels.lab) { g.ui.close(this.id); g.ui.open('lab', { focus: 'custombait' }); } else g.toast?.('The Lab is being built. Check back soon!', 'info');
    }
  }
}
