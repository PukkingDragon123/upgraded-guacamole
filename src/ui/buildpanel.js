// Blueprint-mode tray ('buildtray', non-modal, bottom of the screen) and the building panel ('building').
//
// BuildTrayPanel: an unrolled blueprint scroll with every building (owned blueprints bright, undiscovered ones
//   as chalk silhouettes), decor plans, the cost of the selection, tools (Build / Move / Demolish / Flip),
//   a depth slider and Done. Closing it leaves blueprint mode.
// BuildingPanel: open({uid}) - level, effects, production + Collect, per-building actions (bait workshop
//   recipes, vault deposit/withdraw, arcade claw, totem blessing, lighthouse switch, hatchery eggs, lab door),
//   Upgrade / Move / Demolish.

import { clamp, clamp01, lerp, ease, formatCommas, TAU } from '../core/math.js';
import { rgba, RARITY, shade } from '../core/color.js';
import { rng } from '../core/rng.js';
import { drawText, measureText, wrapText } from '../gfx/font.js';
import { drawWood, drawPaper, drawPlank, drawBar, drawStamp } from './panels.js';
import { getUiIcon } from '../gfx/uiicons.js';
import { baitSprite } from '../fishing/baitart.js';
import { BAITS } from '../game/shopdata.js';
import { ITEMS, countItem, hasItems, takeItems, addItem, removeItem, addPackage, TIERS } from '../build/items.js';
import { BUILDINGS, BUILDING_ORDER, DECOR_BUILDS, buildingDef, levelOf, maxLevelFor, upgradeCost, produceInfo, bonusOf, MAX_LEVEL, RECIPES, vaultInfo, vaultAccrue, ARCADE_PRICE, arcadeRoll, BLESS_COOLDOWN, ZMIN, ZMAX } from '../build/buildings.js';
import { buildingSprite } from '../build/buildingmodels.js';
import { drawItem, itemIcon, blueprintSheet } from '../build/itemdraw.js';
import { PERK_NAMES } from '../build/research.js';

const pct = (v) => `+${Math.round(v * 100)}%`;

// cost row: coins + material icons with have/need colouring -> width used
export function drawCost(ctx, state, cost, x, y, o = {}) {
  let cx = x;
  const color = o.color || '#fff6e2', bad = o.bad || '#ff8a7a', shadow = o.shadow ?? '#1a0e06';
  if (cost.coins) {
    const ok = state.coins >= cost.coins;
    ctx.drawImage(getUiIcon('coin'), cx, y + 1);
    drawText(ctx, formatCommas(cost.coins), cx + 10, y + 1, { color: ok ? color : bad, shadow });
    cx += 14 + measureText(formatCommas(cost.coins)) + 6;
  }
  for (const [id, q] of Object.entries(cost.items || {})) {
    const have = countItem(state, id);
    const ic = itemIcon(id, 12);
    if (ic) ctx.drawImage(ic, cx, y - 2);
    const txt = `${Math.min(have, q)}/${q}`;
    drawText(ctx, txt, cx + 13, y + 1, { color: have >= q ? color : bad, shadow });
    if (o.ui && o.ui.hover({ x: cx, y: y - 3, w: 14 + measureText(txt), h: 12 })) o.ui.tip = `${ITEMS[id]?.name || id}: have ${have}, need ${q}`;
    cx += 15 + measureText(txt) + 6;
  }
  return cx - x;
}

// ====================================================================== blueprint tray

export class BuildTrayPanel {
  constructor() {
    this.id = 'buildtray';
    this.modal = false;
    this.replace = false;
    this.keep = true;
    this.closeOnOutside = false;
    this.sound = 'box_open';
    this.tab = 'buildings';
    this.scroll = 0;
    this.t = 0;
  }

  open() { this.t = 0; }

  close() {
    const b = this.game.build;
    if (b?.active) b.toggle(false);
  }

  entries() {
    const st = this.game.state;
    if (this.tab === 'buildings') {
      return BUILDING_ORDER.map((id) => {
        const item = 'bp_' + id;
        const n = countItem(st, item);
        const built = st.buildings.filter((b) => b.id === id).length;
        return { item, id, n, built, known: n > 0 || built > 0 };
      });
    }
    return Object.keys(DECOR_BUILDS).map((id) => ({ item: 'bp_' + id, id, n: countItem(st, 'bp_' + id), built: st.buildings.filter((b) => b.id === id).length })).filter((e) => e.n > 0 || e.built > 0).map((e) => ({ ...e, known: true }));
  }

  draw(ctx, ui, dt) {
    const g = this.game, st = g.state, B = g.build, inp = g.input;
    if (!B) return;
    this.t += dt;
    const t = this.t;
    const W = g.screen.W, H = g.screen.H;
    const h = 100, x = 14, w = W - 28;
    const rise = ease.outBack(clamp01((this.anim ?? 1)));
    const y = Math.round(H - h - 6 + (1 - rise) * 40);
    this.rect = { x: x - 8, y: y - 14, w: w + 16, h: h + 20 };
    this.drawPaperScroll(ctx, x, y, w, h, t);
    // tabs (chalk labels)
    const tabs = [['buildings', 'BUILDINGS'], ['decor', 'DECOR PLANS']];
    let tx = x + 12;
    for (const [id, label] of tabs) {
      const tw = measureText(label, 'small') + 12;
      const r = { x: tx, y: y - 10, w: tw, h: 12 };
      const on = this.tab === id, hov = ui.hover(r);
      ctx.fillStyle = on ? '#2a6ab8' : hov ? '#1f5aa8' : '#18488a';
      ctx.fillRect(r.x, r.y, r.w, r.h + 2);
      ctx.fillStyle = '#e8f6ff';
      ctx.fillRect(r.x, r.y, r.w, 1); ctx.fillRect(r.x, r.y, 1, r.h); ctx.fillRect(r.x + r.w - 1, r.y, 1, r.h);
      drawText(ctx, label, r.x + 6, r.y + 4, { font: 'small', color: on ? '#ffffff' : '#9ad0ff' });
      if (hov && inp.pressed) { inp.pressed = false; this.tab = id; this.scroll = 0; g.audio.play('ui_tab'); }
      tx += tw + 3;
    }
    // ---- cards
    const list = this.entries();
    const cw = 62, gap = 4;
    const area = { x: x + 12, y: y + 8, w: w - 330, h: h - 16 };
    const maxScroll = Math.max(0, list.length * (cw + gap) - area.w);
    if (inp.wheel && ui.hover(area)) { this.scroll = clamp(this.scroll + Math.sign(inp.wheel) * (cw + gap), 0, maxScroll); inp.wheel = 0; }
    this.scroll = clamp(this.scroll, 0, maxScroll);
    ctx.save();
    ctx.beginPath(); ctx.rect(area.x, area.y - 4, area.w, area.h + 8); ctx.clip();
    if (!list.length) {
      drawText(ctx, this.tab === 'decor' ? 'No decoration plans yet - research the Architecture Club or find plans in packages!' : 'No blueprints yet.', area.x + 6, area.y + 34, { color: '#bfe2ff' });
    }
    list.forEach((e, i) => {
      const cx = area.x + i * (cw + gap) - this.scroll;
      if (cx > area.x + area.w || cx + cw < area.x) return;
      this.drawCard(ctx, ui, e, { x: cx, y: area.y, w: cw, h: area.h }, t, B);
    });
    ctx.restore();
    if (maxScroll > 0) {
      const k = this.scroll / maxScroll;
      ctx.fillStyle = rgba('#e8f6ff', 0.25); ctx.fillRect(area.x, area.y + area.h + 3, area.w, 1);
      ctx.fillStyle = '#e8f6ff'; ctx.fillRect(Math.round(area.x + k * (area.w - 40)), area.y + area.h + 2, 40, 3);
    }
    // ---- selection + tools
    const px = x + w - 312, pw = 300;
    ctx.fillStyle = '#e8f6ff';
    for (let yy = y + 8; yy < y + h - 8; yy += 3) ctx.fillRect(px - 8, yy, 1, 2);
    const sel = B.sel;
    const it = ITEMS[sel];
    if (it && B.mode === 'place' && !B.moving) {
      const def = buildingDef(it.builds);
      drawText(ctx, def.name.toUpperCase(), px, y + 9, { color: '#ffffff', outline: '#0a2a5a' });
      drawText(ctx, `x${countItem(st, sel)} blueprint${countItem(st, sel) > 1 ? 's' : ''}${def.unique ? ' - unique' : ''}`, px + measureText(def.name.toUpperCase()) + 8, y + 10, { font: 'small', color: '#9ad0ff' });
      drawCost(ctx, st, def.cost, px, y + 23, { ui, color: '#e8f6ff', bad: '#ffb0a0', shadow: '#0a2a5a' });
    } else if (B.moving) {
      drawText(ctx, 'MOVING ' + (buildingDef(B.byUid(B.moving)?.id)?.name || '').toUpperCase(), px, y + 9, { color: '#ffe27a', outline: '#0a2a5a' });
      drawText(ctx, 'Free of charge. Click the seabed to set it down.', px, y + 23, { color: '#bfe2ff' });
    } else {
      drawText(ctx, B.mode === 'demolish' ? 'DEMOLISH MODE' : B.mode === 'move' ? 'MOVE MODE' : 'PICK A BLUEPRINT', px, y + 9, { color: B.mode === 'demolish' ? '#ffb0a0' : '#ffffff', outline: '#0a2a5a' });
      drawText(ctx, B.mode === 'demolish' ? 'Refunds the blueprint + half the cost.' : B.mode === 'move' ? 'Click a building to pick it up.' : 'Blueprints come from packages and research.', px, y + 23, { color: '#bfe2ff' });
    }
    // tool buttons
    const by = y + 38;
    const tools = [['place', 'Build', 'plus'], ['move', 'Move', 'arrow_r'], ['demolish', 'Demolish', 'trash']];
    let bx = px;
    for (const [id, label, icon] of tools) {
      const bw = measureText(label) + 26;
      if (ui.button(ctx, bx, by, bw, 19, label, { icon, style: 'glass', active: B.mode === id && !B.moving, tip: id === 'place' ? 'Place the selected blueprint' : id === 'move' ? 'Move a building (free)' : 'Demolish a building' })) {
        B.mode = id; B.moving = null; B.confirm = null;
      }
      bx += bw + 3;
    }
    if (ui.button(ctx, bx, by, 38, 19, 'Flip', { style: 'glass', active: B.flip, tip: 'Mirror the building (F)' })) B.flip = !B.flip;
    // depth slider
    drawText(ctx, 'DEPTH', px, by + 30, { font: 'small', color: '#9ad0ff' });
    const v = ui.slider(ctx, px + 30, by + 28, 150, (B.depth - ZMIN) / (ZMAX - ZMIN), 'build_depth');
    B.setDepth(ZMIN + v * (ZMAX - ZMIN));
    drawText(ctx, `${Math.round(8 + B.depth * 30)} m`, px + 188, by + 29, { font: 'small', color: '#ffe27a' });
    if (ui.button(ctx, px + pw - 66, by + 22, 62, 21, 'Done', { icon: 'check', style: 'coral', tip: 'Leave blueprint mode (Esc)' })) { ui.close(this.id); }
  }

  drawCard(ctx, ui, e, r, t, B) {
    const g = this.game, inp = g.input;
    const it = ITEMS[e.item];
    const def = buildingDef(e.id);
    const on = B.sel === e.item && B.mode === 'place' && !B.moving;
    const hov = ui.hover(r);
    const usable = e.n > 0;
    const rar = RARITY[def?.rarity || 'common'];
    ctx.fillStyle = on ? rgba('#ffe27a', 0.16) : hov ? rgba('#ffffff', 0.08) : rgba('#06204a', 0.35);
    ctx.fillRect(r.x, r.y, r.w, r.h);
    // chalk frame (dashed), rarity tick
    ctx.fillStyle = on ? '#ffe27a' : usable ? '#e8f6ff' : rgba('#e8f6ff', 0.35);
    for (let i = 0; i < r.w; i += 3) { ctx.fillRect(r.x + i, r.y, 2, 1); ctx.fillRect(r.x + i, r.y + r.h - 1, 2, 1); }
    for (let i = 0; i < r.h; i += 3) { ctx.fillRect(r.x, r.y + i, 1, 2); ctx.fillRect(r.x + r.w - 1, r.y + i, 1, 2); }
    ctx.fillStyle = rar.color; ctx.fillRect(r.x + 2, r.y + 2, 6, 2);
    const bob = on ? Math.round(Math.sin(t * 5) * 1) : 0;
    if (e.known) {
      const spr = buildingSprite(e.id, { scale: 0.22, force: true });
      if (spr) {
        const k = Math.min(1, (r.w - 8) / spr.w, (r.h - 26) / spr.h);
        const w = Math.round(spr.w * k), h = Math.round(spr.h * k);
        const dx = Math.round(r.x + r.w / 2 - w / 2), dy = r.y + r.h - 22 - h + bob;
        if (!usable) { ctx.globalAlpha = 0.45; ctx.drawImage(tinted2(spr.canvas), dx, dy, w, h); ctx.globalAlpha = 1; } else ctx.drawImage(spr.canvas, dx, dy, w, h);
      }
    } else {
      const spr = buildingSprite(e.id, { scale: 0.22, force: true });
      if (spr) {
        const k = Math.min(1, (r.w - 8) / spr.w, (r.h - 26) / spr.h);
        const w = Math.round(spr.w * k), h = Math.round(spr.h * k);
        ctx.globalAlpha = 0.55;
        ctx.drawImage(silhouette(spr.canvas), Math.round(r.x + r.w / 2 - w / 2), r.y + r.h - 22 - h, w, h);
        ctx.globalAlpha = 1;
      }
      drawText(ctx, '?', r.x + r.w / 2, r.y + 18, { align: 'center', scale: 2, color: '#e8f6ff', outline: '#0a2a5a' });
    }
    const name = e.known ? def.name : '???';
    const nm = wrapText(name, r.w - 4, 'small');
    nm.slice(0, 2).forEach((l, i) => drawText(ctx, l.toUpperCase(), r.x + r.w / 2, r.y + r.h - 18 + i * 7, { font: 'small', align: 'center', color: usable ? '#ffffff' : '#9ab8d8' }));
    if (e.n > 0) {
      const txt = 'x' + e.n;
      const tw = measureText(txt, 'small') + 4;
      ctx.fillStyle = '#ffe27a'; ctx.fillRect(r.x + r.w - tw - 2, r.y + 2, tw, 8);
      drawText(ctx, txt, r.x + r.w - tw, r.y + 3, { font: 'small', color: '#3a2a0a' });
    }
    if (e.built && !e.n) drawText(ctx, 'BUILT', r.x + r.w - 3, r.y + 3, { font: 'small', align: 'right', color: '#9affc8' });
    if (hov) {
      ui.tip = e.known ? `${def.name}: ${def.desc}${usable ? '' : ' (No blueprint left - find more in packages.)'}` : 'Undiscovered building. Fish up its blueprint in packages, or research it in the Lab!';
      if (inp.pressed) {
        inp.pressed = false;
        if (usable) { B.select(e.item); g.audio.play('ui_click'); } else g.audio.play('ui_error');
      }
    }
    void it;
  }

  drawPaperScroll(ctx, x, y, w, h, t) {
    // rolled ends
    for (const rx of [x - 8, x + w - 2]) {
      for (let i = 0; i < 10; i++) {
        const k = i / 9;
        ctx.fillStyle = shade('#3a7ad8', 0.35 - Math.abs(k - 0.35) * 0.9);
        ctx.fillRect(rx + i, y - 4, 1, h + 8);
      }
      ctx.fillStyle = '#0a2a5a'; ctx.fillRect(rx, y - 5, 10, 1); ctx.fillRect(rx, y + h + 4, 10, 1);
      ctx.fillStyle = '#c8a050'; ctx.fillRect(rx + 2, y - 8, 6, 3); ctx.fillRect(rx + 2, y + h + 5, 6, 3);
    }
    ctx.fillStyle = '#1f5aa8';
    ctx.fillRect(x + 2, y, w - 4, h);
    ctx.fillStyle = '#2866b4';
    for (let gx = x + 6; gx < x + w - 2; gx += 8) ctx.fillRect(gx, y, 1, h);
    for (let gy = y + 4; gy < y + h; gy += 8) ctx.fillRect(x + 2, gy, w - 4, 1);
    ctx.fillStyle = '#e8f6ff';
    ctx.fillRect(x + 5, y + 3, w - 10, 1); ctx.fillRect(x + 5, y + h - 4, w - 10, 1);
    ctx.fillRect(x + 5, y + 3, 1, h - 6); ctx.fillRect(x + w - 6, y + 3, 1, h - 6);
    ctx.fillStyle = rgba('#000000', 0.25); ctx.fillRect(x + 2, y + h, w - 4, 3);
    void t;
  }
}

const silCache = new WeakMap();
function silhouette(c) { let s = silCache.get(c); if (!s) { s = tintedLocal(c, '#0a2a5a'); silCache.set(c, s); } return s; }
const greyCache = new WeakMap();
function tinted2(c) { let s = greyCache.get(c); if (!s) { s = tintedLocal(c, '#7aa8e0'); greyCache.set(c, s); } return s; }
function tintedLocal(src, color) {
  const c = document.createElement('canvas');
  c.width = src.width; c.height = src.height;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.drawImage(src, 0, 0);
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = color;
  g.fillRect(0, 0, c.width, c.height);
  return c;
}

// ====================================================================== building panel

const ACTION_TITLE = { workshop: 'BAIT PRESS', vault: 'THE VAULT', arcade: 'CLAW MACHINE', bless: 'DAILY BLESSING', toggle: 'THE LAMP', research: 'LABORATORY', collect: 'PRODUCTION' };

export class BuildingPanel {
  constructor() {
    this.id = 'building';
    this.modal = true;
    this.sound = 'box_open';
    this.uid = null;
    this.t = 0;
    this.page = 0;
  }

  open(data) {
    this.uid = data?.uid ?? this.uid;
    this.t = 0;
    this.page = 0;
    this.claw = null;
    const st = this.game.state;
    const b = this.b();
    if (b?.id === 'vault') vaultAccrue(st);
  }

  b() { return this.game.state.buildings.find((q) => q.uid === this.uid) || null; }

  draw(ctx, ui, dt) {
    const g = this.game, st = g.state, inp = g.input;
    const b = this.b();
    if (!b) { ui.close(this.id); return; }
    this.t += dt;
    const t = this.t;
    const def = buildingDef(b.id);
    const W = 560, H = 292;
    const r = { x: Math.round((g.screen.W - W) / 2), y: Math.round((g.screen.H - H) / 2) + 6, w: W, h: H };
    this.rect = { x: r.x, y: r.y - 24, w: W, h: H + 24 };
    drawWood(ctx, r.x, r.y, W, H, { tone: 'dark' });
    const title = def.name.toUpperCase();
    const tw = Math.max(170, measureText(title) + 50);
    drawPlank(ctx, r.x + W / 2 - tw / 2, r.y - 18, tw, 22, { rope: 8, label: title });
    if (ui.button(ctx, r.x + W - 25, r.y + 7, 18, 18, '', { icon: 'cross', style: 'shell', tip: 'Close (Esc)' })) { ui.close(this.id); return; }
    // ---- preview diorama
    const pv = { x: r.x + 10, y: r.y + 10, w: 200, h: 182 };
    this.drawDiorama(ctx, b, def, pv, t);
    // level stars
    if (!def.decor) {
      const lv = levelOf(b);
      for (let i = 0; i < MAX_LEVEL; i++) {
        const ic = getUiIcon(i < lv ? 'star' : 'star_empty');
        if (ic) ctx.drawImage(ic, pv.x + 6 + i * 11, pv.y + 6);
      }
      drawText(ctx, `LEVEL ${lv}`, pv.x + 42, pv.y + 7, { font: 'small', color: '#fff6e2', outline: '#1a0e06' });
    }
    const rar = RARITY[def.rarity] || RARITY.common;
    drawText(ctx, rar.name.toUpperCase(), pv.x + pv.w - 6, pv.y + 7, { font: 'small', align: 'right', color: rar.color, outline: '#1a0e06' });
    // ---- info paper
    const ip = { x: r.x + 218, y: r.y + 10, w: W - 228, h: 182 };
    drawPaper(ctx, ip.x, ip.y, ip.w, ip.h, { aged: true });
    let y = ip.y + 7;
    const lines = wrapText(def.desc, ip.w - 16);
    lines.forEach((l, i) => drawText(ctx, l, ip.x + 8, y + i * 10, { color: '#3a2a22' }));
    y += lines.length * 10 + 4;
    // effects
    const bonus = BUILDINGS[b.id]?.bonus || {};
    const keys = Object.keys(bonus).filter((k) => k !== 'light');
    if (keys.length) {
      drawText(ctx, 'EFFECTS', ip.x + 8, y, { font: 'small', color: '#8a5a32' });
      y += 9;
      for (const k of keys) {
        const cur = bonusOf(b, k);
        const nxt = levelOf(b) < MAX_LEVEL ? BUILDINGS[b.id].bonus[k][levelOf(b)] : null;
        drawText(ctx, `${PERK_NAMES[k] || k}: ${pct(cur)}${nxt != null && nxt !== cur ? `  (next: ${pct(nxt)})` : ''}`, ip.x + 12, y, { color: '#2a5a3a' });
        y += 10;
      }
    }
    if (b.id === 'vault') { const v = vaultInfo(st); drawText(ctx, `Interest: ${(v.rate * 100).toFixed(1)}% per hour, holds up to ${formatCommas(v.cap)}`, ip.x + 12, y, { color: '#2a5a3a' }); y += 10; }
    y += 3;
    // ---- action area
    const act = { x: ip.x + 6, y, w: ip.w - 12, h: ip.y + ip.h - y - 6 };
    const kind = BUILDINGS[b.id]?.action || null;
    if (kind && ACTION_TITLE[kind]) drawText(ctx, ACTION_TITLE[kind], act.x + 2, act.y, { font: 'small', color: '#8a5a32' });
    act.y += 9; act.h -= 9;
    if (BUILDINGS[b.id]?.produce) this.drawProduction(ctx, ui, b, act, t);
    else if (kind === 'workshop') this.drawWorkshop(ctx, ui, b, act, t);
    else if (kind === 'vault') this.drawVault(ctx, ui, b, act, t);
    else if (kind === 'arcade') this.drawArcade(ctx, ui, b, act, t);
    else if (kind === 'bless') this.drawBless(ctx, ui, b, act, t);
    else if (kind === 'toggle') {
      const on = b.on !== false;
      drawText(ctx, on ? 'The lamp is lit. Rare night fish are drawn in.' : 'The lamp is dark. The keeper is sulking.', act.x + 2, act.y + 2, { color: '#3a2a22' });
      if (ui.button(ctx, act.x, act.y + 16, 120, 20, on ? 'Switch off' : 'Light the lamp', { style: on ? 'paper' : 'coral', icon: on ? 'moon' : 'sun' })) { b.on = !on; g.audio.play(on ? 'ui_toggle' : 'magic'); g.save?.(); }
    } else if (kind === 'research') {
      drawText(ctx, 'Professor Bubbles is waiting inside.', act.x + 2, act.y + 2, { color: '#3a2a22' });
      if (ui.button(ctx, act.x, act.y + 16, 120, 20, 'Enter the Lab', { style: 'coral', icon: 'book' })) { ui.close(this.id); ui.open('research'); return; }
    } else if (def.decor) {
      drawText(ctx, 'A lovely decoration. Your fish approve.', act.x + 2, act.y + 2, { color: '#3a2a22' });
    }
    // ---- bottom bar: upgrade / move / demolish
    const bb = { x: r.x + 10, y: r.y + H - 116, w: W - 20, h: 106 };
    this.drawBottom(ctx, ui, b, def, { x: bb.x, y: r.y + 200, w: bb.w, h: H - 210 }, t);
  }

  drawDiorama(ctx, b, def, pv, t) {
    const g = this.game;
    ctx.save();
    ctx.beginPath(); ctx.rect(pv.x, pv.y, pv.w, pv.h); ctx.clip();
    const grd = ctx.createLinearGradient(0, pv.y, 0, pv.y + pv.h);
    const deep = g.ocean?.biome?.id === 'abyss';
    grd.addColorStop(0, deep ? '#1a2050' : '#4ab8d0'); grd.addColorStop(1, deep ? '#0a0a20' : '#1a5578');
    ctx.fillStyle = grd; ctx.fillRect(pv.x, pv.y, pv.w, pv.h);
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 3; i++) {
      const x0 = pv.x + 30 + i * 60 + Math.sin(t * 0.4 + i) * 6;
      ctx.fillStyle = rgba('#e8fbff', 0.05);
      ctx.beginPath(); ctx.moveTo(x0, pv.y); ctx.lineTo(x0 + 14, pv.y); ctx.lineTo(x0 - 26, pv.y + pv.h); ctx.lineTo(x0 - 40, pv.y + pv.h); ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
    const ground = pv.y + pv.h - 18;
    ctx.fillStyle = '#c8a86a'; ctx.fillRect(pv.x, ground, pv.w, 18);
    ctx.fillStyle = '#e8cf95';
    for (let x = 0; x < pv.w; x += 2) ctx.fillRect(pv.x + x, ground - 1 + Math.round(Math.sin(x * 0.08) * 1), 2, 3);
    // gentle turntable: a few yaw steps around the hero angle
    const yaw = def.decor ? null : 30 + Math.round(Math.sin(t * 0.8) * 2) * 12;
    let spr = buildingSprite(b.id, { scale: 0.62, yaw, force: false }) || buildingSprite(b.id, { scale: 0.62, force: true });
    if (spr) {
      const k = Math.min(1, (pv.w - 16) / spr.w, (pv.h - 30) / spr.h) * (spr.approx || 1);
      const w = Math.round(spr.w * k), h = Math.round(spr.h * k);
      ctx.drawImage(b.flip ? spr.flipped() : spr.canvas, Math.round(pv.x + pv.w / 2 - spr.ox * k), Math.round(ground + 4 - spr.oy * k), w, h);
      if (spr.glow && deep) { ctx.globalCompositeOperation = 'lighter'; ctx.drawImage(spr.glow, Math.round(pv.x + pv.w / 2 - spr.ox * k), Math.round(ground + 4 - spr.oy * k), w, h); ctx.globalCompositeOperation = 'source-over'; }
    }
    if (Math.random() < 0.06) g.particles?.bubble(pv.x + 10 + Math.random() * (pv.w - 20), ground - 2, { layer: 'ui', life: 2.5, vy: -14 });
    ctx.restore();
    ctx.fillStyle = '#1a0e08';
    ctx.fillRect(pv.x - 1, pv.y - 1, pv.w + 2, 1); ctx.fillRect(pv.x - 1, pv.y + pv.h, pv.w + 2, 1);
    ctx.fillRect(pv.x - 1, pv.y, 1, pv.h); ctx.fillRect(pv.x + pv.w, pv.y, 1, pv.h);
  }

  drawProduction(ctx, ui, b, a, t) {
    const g = this.game;
    const P = produceInfo(b);
    const def = BUILDINGS[b.id];
    const gives = def.produce.coins ? 'coin bubbles' : def.produce.give.map((q) => ITEMS[q.id]?.name).join(', ');
    drawText(ctx, `Makes ${gives}.`, a.x + 2, a.y + 1, { color: '#3a2a22' });
    drawText(ctx, `Ready: ${P.ready}/${P.cap}`, a.x + 2, a.y + 13, { color: P.ready ? '#2a6a3a' : '#6b4f43' });
    drawBar(ctx, a.x + 70, a.y + 12, 120, 8, P.progress, { color: '#6ad46a' });
    if (P.ready < P.cap) drawText(ctx, fmtTime(P.next), a.x + 196, a.y + 13, { font: 'small', color: '#6b4f43' });
    if (ui.button(ctx, a.x, a.y + 26, 110, 20, P.ready ? `Collect (${P.ready})` : 'Nothing yet', { style: P.ready ? 'coral' : 'paper', icon: 'star', disabled: !P.ready })) g.build.collect(b);
    if (b.id === 'hatchery') {
      const eggs = countItem(g.state, 'fish_egg');
      if (ui.button(ctx, a.x + 116, a.y + 26, 110, 20, `Hatch egg (${eggs})`, { style: 'paper', icon: 'heart', disabled: !eggs, tip: 'Hatch a fish egg into a baby fish for your aquarium' })) g.build.hatchEgg?.();
    }
  }

  drawWorkshop(ctx, ui, b, a, t) {
    const g = this.game, st = g.state;
    const lv = levelOf(b);
    const list = RECIPES.filter((r) => !r.research || st.research?.done?.[r.research]);
    const per = 4;
    const pages = Math.ceil(list.length / per);
    this.page = clamp(this.page, 0, pages - 1);
    list.slice(this.page * per, this.page * per + per).forEach((rc, i) => {
      const y = a.y + i * 16;
      const s = baitSprite(rc.id, t + i);
      ctx.drawImage(s, a.x, y - 2);
      const locked = rc.lvl > lv;
      drawText(ctx, `${rc.qty}x ${BAITS[rc.id]?.name || rc.id}`, a.x + 16, y + 1, { color: locked ? '#9a8a7a' : '#3a2a22' });
      if (locked) { drawText(ctx, `needs Lv ${rc.lvl}`, a.x + 150, y + 1, { font: 'small', color: '#a8583a' }); return; }
      drawCost(ctx, st, { coins: rc.coins, items: rc.items }, a.x + 116, y, { ui, color: '#3a2a22', bad: '#c8382a', shadow: null });
      const ok = st.coins >= rc.coins && hasItems(st, rc.items);
      if (ui.button(ctx, a.x + a.w - 44, y - 3, 44, 15, 'Craft', { style: ok ? 'coral' : 'paper', font: 'small', disabled: !ok })) {
        if (rc.coins && !g.spendCoins(rc.coins)) return;
        takeItems(st, rc.items);
        addItem(st, rc.id, rc.qty);
        g.audio.play('ui_buy'); g.audio.play('worm_squish', { vol: 0.5 });
        g.particles?.text(a.x + a.w - 20, y - 6, `+${rc.qty}`, { color: '#9affc8' });
        g.save?.();
      }
    });
    if (pages > 1) {
      if (ui.button(ctx, a.x, a.y + per * 16, 16, 14, '', { icon: 'arrow_l', style: 'paper', disabled: this.page === 0 })) this.page--;
      drawText(ctx, `${this.page + 1}/${pages}`, a.x + 22, a.y + per * 16 + 4, { font: 'small', color: '#6b4f43' });
      if (ui.button(ctx, a.x + 44, a.y + per * 16, 16, 14, '', { icon: 'arrow_r', style: 'paper', disabled: this.page >= pages - 1 })) this.page++;
    }
  }

  drawVault(ctx, ui, b, a, t) {
    const g = this.game, st = g.state;
    vaultAccrue(st);
    const v = vaultInfo(st);
    drawText(ctx, `In the vault: ${formatCommas(Math.floor(v.coins))}{coin}`, a.x + 2, a.y + 1, { color: '#3a2a22' });
    drawText(ctx, `Interest earned: ${formatCommas(Math.floor(v.earned))}`, a.x + 2, a.y + 12, { font: 'small', color: '#2a6a3a' });
    drawBar(ctx, a.x + 150, a.y + 1, a.w - 152, 8, v.coins / Math.max(1, v.cap), { color: '#f0b83c' });
    const room = Math.max(0, v.cap - v.coins);
    const dep = (n) => {
      n = Math.floor(Math.min(n, st.coins, room));
      if (n <= 0) { g.audio.play('ui_error'); return; }
      if (!g.spendCoins(n)) return;
      st.vault.coins += n;
      g.audio.play('coin_pile'); g.save?.();
    };
    if (ui.button(ctx, a.x, a.y + 22, 70, 18, 'Deposit 100', { style: 'paper', font: 'small', disabled: st.coins < 1 || room < 1 })) dep(100);
    if (ui.button(ctx, a.x + 74, a.y + 22, 70, 18, 'Deposit half', { style: 'paper', font: 'small', disabled: st.coins < 2 || room < 1 })) dep(st.coins / 2);
    if (ui.button(ctx, a.x + 148, a.y + 22, 80, 18, 'Withdraw all', { style: 'coral', font: 'small', disabled: v.coins < 1 })) {
      const n = Math.floor(st.vault.coins);
      st.vault.coins -= n;
      const [sx, sy] = [a.x + 188, a.y + 30];
      g.addCoins(n, sx, sy);
      g.audio.play('coins_many'); g.save?.();
    }
  }

  drawArcade(ctx, ui, b, a, t) {
    const g = this.game, st = g.state;
    const lv = levelOf(b);
    const price = ARCADE_PRICE[lv - 1];
    const c = this.claw;
    drawText(ctx, `Grab a mystery package for ${price}{coin}. Better odds each level.`, a.x + 2, a.y + 1, { color: '#3a2a22' });
    // mini claw machine window
    const m = { x: a.x + a.w - 70, y: a.y + 10, w: 68, h: Math.min(44, a.h - 12) };
    ctx.fillStyle = '#2a1a4a'; ctx.fillRect(m.x, m.y, m.w, m.h);
    ctx.fillStyle = '#4af0ff'; ctx.fillRect(m.x, m.y, m.w, 1); ctx.fillRect(m.x, m.y + m.h - 1, m.w, 1);
    ctx.fillStyle = '#ff4ab8'; ctx.fillRect(m.x, m.y, 1, m.h); ctx.fillRect(m.x + m.w - 1, m.y, 1, m.h);
    for (let i = 0; i < 9; i++) { ctx.fillStyle = ['#ff7a5a', '#7aff9a', '#ffd84a', '#c8a0ff'][i % 4]; ctx.fillRect(m.x + 4 + i * 7, m.y + m.h - 7 - (i % 2) * 2, 5, 5); }
    let cxp = m.x + m.w / 2 + Math.sin(t * 1.7) * 22, cyp = m.y + 6;
    if (c) {
      c.t += 1 / 60;
      const k = c.t / 1.6;
      cxp = lerp(m.x + 10, c.x, Math.min(1, k * 2));
      cyp = m.y + 6 + Math.sin(Math.min(1, Math.max(0, (k - 0.4) / 0.6)) * Math.PI) * (m.h - 16);
      if (k >= 1 && !c.done) {
        c.done = true;
        const p = addPackage(st, c.tier, { arcade: true });
        g.audio.play(c.tier === 'crate' ? 'ui_buy' : 'golden_shimmer');
        g.save?.();
        this.claw = null;
        ui.close(this.id);
        ui.open('package', { uid: p.uid });
        return;
      }
    }
    ctx.fillStyle = '#c8ccd8'; ctx.fillRect(Math.round(cxp), m.y + 1, 1, Math.round(cyp - m.y));
    ctx.fillRect(Math.round(cxp) - 3, Math.round(cyp), 7, 2); ctx.fillRect(Math.round(cxp) - 3, Math.round(cyp) + 2, 1, 3); ctx.fillRect(Math.round(cxp) + 3, Math.round(cyp) + 2, 1, 3);
    if (ui.button(ctx, a.x, a.y + 18, 100, 22, c ? 'Grabbing...' : `Play (${price})`, { style: 'coral', icon: 'coin', disabled: !!c || st.coins < price })) {
      if (g.spendCoins(price)) {
        this.claw = { t: 0, x: m.x + 8 + rng.float(0, m.w - 16), tier: arcadeRoll(lv) };
        g.audio.play('vending'); g.audio.play('reel', { vol: 0.4 });
      }
    }
  }

  drawBless(ctx, ui, b, a, t) {
    const g = this.game, st = g.state;
    const left = (b.blessed || 0) + BLESS_COOLDOWN - Date.now();
    drawText(ctx, left > 0 ? `The totem is resting. Next blessing in ${fmtTime(left / 1000)}.` : 'The totem winks at you. A blessing awaits!', a.x + 2, a.y + 1, { color: '#3a2a22' });
    if (ui.button(ctx, a.x, a.y + 16, 140, 22, 'Receive blessing', { style: 'coral', icon: 'crown', disabled: left > 0 })) {
      b.blessed = Date.now();
      const lv = levelOf(b);
      const tier = rng.chance(0.08 * lv) ? 'orb' : rng.chance(0.3 + 0.1 * lv) ? 'golden' : 'iron';
      const p = addPackage(st, tier, { blessing: true });
      g.audio.play('magic'); g.audio.play('golden_shimmer');
      g.save?.();
      ui.close(this.id);
      ui.open('package', { uid: p.uid });
    }
  }

  drawBottom(ctx, ui, b, def, r, t) {
    const g = this.game, st = g.state;
    drawWood(ctx, r.x, r.y, r.w, r.h, { tone: 'light', nails: false, inset: true });
    const B = g.build;
    let x = r.x + 8;
    const y = r.y + 8;
    if (!def.decor) {
      const lv = levelOf(b), cap = maxLevelFor(st);
      const cost = upgradeCost(b);
      if (lv >= MAX_LEVEL) drawText(ctx, 'Fully upgraded!', x, y + 4, { color: '#fff6e2', shadow: '#1a0e06' });
      else {
        drawText(ctx, `Upgrade to level ${lv + 1}:`, x, y + 1, { color: '#fff6e2', shadow: '#1a0e06' });
        if (cost) drawCost(ctx, st, cost, x, y + 14, { ui });
        if (lv >= cap) drawText(ctx, lv === 1 ? 'Research "Reinforced Rafters" in the Lab first.' : 'Research "Titanium Trusses" in the Lab first.', x, y + 28, { font: 'small', color: '#ffd0a0', shadow: '#1a0e06' });
        const ok = lv < cap && cost && st.coins >= (cost.coins || 0) && hasItems(st, cost.items);
        if (ui.button(ctx, x, y + 40, 90, 20, 'Upgrade', { style: ok ? 'coral' : 'wood', icon: 'arrow_u', disabled: !ok })) B.upgrade(b);
      }
    } else drawText(ctx, 'Decorations cannot be upgraded.', x, y + 4, { color: '#fff6e2', shadow: '#1a0e06' });
    const bx = r.x + r.w - 200;
    if (ui.button(ctx, bx, y + 40, 92, 20, 'Move', { icon: 'arrow_r', tip: 'Pick it up and place it elsewhere (free)' })) { ui.close(this.id); B.startMove(b); return; }
    const conf = this.confirmT > 0;
    this.confirmT = Math.max(0, (this.confirmT || 0) - 1 / 60);
    if (ui.button(ctx, bx + 98, y + 40, 92, 20, conf ? 'Really?' : 'Demolish', { icon: 'trash', style: conf ? 'coral' : 'wood', tip: 'Refunds the blueprint and half the materials' })) {
      if (conf) { ui.close(this.id); B.demolish(b); return; }
      this.confirmT = 2;
      g.audio.play('slack_warn', { vol: 0.5 });
    }
    const placed = new Date(b.built || Date.now());
    drawText(ctx, `Built ${placed.toLocaleDateString()}`, r.x + r.w - 8, y + 1, { font: 'small', align: 'right', color: '#fff0d0', shadow: '#1a0e06' });
    void t;
  }
}

export function fmtTime(s) {
  s = Math.max(0, Math.ceil(s));
  if (s >= 3600) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  if (s >= 60) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${s}s`;
}

void TAU; void drawStamp; void removeItem; void itemIcon; void blueprintSheet; void drawItem; void TIERS;
