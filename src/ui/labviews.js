// The Lab's other tabs (OWNER: Lab agent): the rod rack (equip), the crafting bench and the boat dock.
// Each view draws into the dome rect and its own detail card; `panel` is the LabPanel (game, t, tree, setTab).
import { clamp, TAU, hash1 } from '../core/math.js';
import { rgba, mix, shade, RARITY } from '../core/color.js';
import { drawText, measureText, wrapText } from '../gfx/font.js';
import { getUiIcon } from '../gfx/uiicons.js';
import { drawAeroGlow, drawAeroBubble, drawSparkle, drawAeroLabel, drawAeroBadge } from './aero.js';
import { RODS, ROD_BY_ID, ROD_STAT_KEYS, ensureRods, equipRod } from '../game/rods.js';
import { BOAT_ORDER, BOAT_NAMES, BRANCHES, EFFECT_INFO, fmtEffect, unlocked, nodeFor, labStatus } from '../game/lab.js';
import { RECIPES, RECIPE_BY_ID, CRAFT_CATS, recipeUnlocked, recipeNode, craftCheck, craft } from '../build/crafting.js';
import { ITEMS, countItem } from '../build/items.js';
import { drawSplash, roundRectPath } from './labart.js';
import { drawLabRoom, labRoomScene, drawOrbitPad } from './labroom.js'; // [lab15] the space backdrop behind the Rods / Boats tabs
import { icon, anyIcon, glassCard, pill, costTiles, costTilesHeight, pedestal, chip, statBar, orbIcon, INK, INK_SOFT } from './labkit.js';

const rarityCol = (r) => RARITY[r]?.color || '#9fb4c8';

function tile(ctx, ui, x, y, w, h, o = {}) {
  const hov = ui.hover({ x, y, w, h });
  ctx.save();
  if (o.glow) drawAeroGlow(ctx, x + w / 2, y + h / 2, Math.max(w, h) * 0.75, o.glow, 0.55);
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, rgba('#ffffff', 0.98)); g.addColorStop(1, rgba(o.bottom || '#d9f2fc', 0.96)); // [lab13] solid over the lab room
  ctx.fillStyle = g; roundRectPath(ctx, x, y, w, h, 8); ctx.fill();
  ctx.fillStyle = rgba('#ffffff', 0.7); ctx.fillRect(x + 6, y + 2, w - 12, 2);
  ctx.strokeStyle = o.sel ? '#ffffff' : o.edge || rgba('#7fbedd', 0.9); ctx.lineWidth = o.sel ? 2.5 : 1;
  roundRectPath(ctx, x + 0.5, y + 0.5, w - 1, h - 1, 8); ctx.stroke();
  if (o.sel) { ctx.strokeStyle = '#35c8ff'; ctx.lineWidth = 1; roundRectPath(ctx, x - 1.5, y - 1.5, w + 3, h + 3, 9); ctx.stroke(); }
  if (hov && !o.sel) { ctx.strokeStyle = rgba('#35c8ff', 0.8); ctx.lineWidth = 1; roundRectPath(ctx, x - 0.5, y - 0.5, w + 1, h + 1, 8); ctx.stroke(); }
  ctx.restore();
  return hov;
}

// Tile grid centred in the view below `top` (vertically centred when it fits).
function grid(view, n, tw, th, gap = 6, top = 10) {
  const cols = Math.max(1, Math.floor((view.w - 16 + gap) / (tw + gap)));
  const rows = Math.ceil(n / cols);
  const ox = view.x + Math.round((view.w - (Math.min(n, cols) * (tw + gap) - gap)) / 2);
  const free = view.h - top - 10 - (rows * (th + gap) - gap);
  const oy = view.y + top + Math.max(0, Math.round(free * 0.35));
  return (i) => ({ x: ox + (i % cols) * (tw + gap), y: oy + Math.floor(i / cols) * (th + gap), cols });
}

function drawBlueprintBg(ctx, view, t, tone = 'craft') {
  const g = ctx.createLinearGradient(0, view.y, 0, view.y + view.h);
  if (tone === 'rods') { g.addColorStop(0, '#e9f9ff'); g.addColorStop(1, '#b8e6f8'); }
  else { g.addColorStop(0, '#2a8fe8'); g.addColorStop(1, '#5cc0f8'); }
  ctx.fillStyle = g; ctx.fillRect(view.x, view.y, view.w, view.h);
  ctx.fillStyle = tone === 'rods' ? rgba('#7fc8e8', 0.25) : rgba('#ffffff', 0.12);
  for (let x = view.x + 8; x < view.x + view.w; x += 16) ctx.fillRect(x, view.y, 1, view.h);
  for (let y = view.y + 8; y < view.y + view.h; y += 16) ctx.fillRect(view.x, y, view.w, 1);
  if (tone === 'rods') {
    // pegboard holes
    ctx.fillStyle = rgba('#5aa8cc', 0.25);
    for (let y = view.y + 16; y < view.y + view.h; y += 16) for (let x = view.x + 16; x < view.x + view.w; x += 16) ctx.fillRect(x - 1, y - 1, 2, 2);
  }
  for (let i = 0; i < 8; i++) {
    const k = (t * (0.05 + hash1(i, 6) * 0.05) + hash1(i, 7)) % 1;
    drawAeroBubble(ctx, view.x + hash1(i, 8) * view.w, view.y + view.h - k * view.h, 1.5 + hash1(i, 9) * 2.5, 0.7);
  }
}

// ================================================================== rods
export function drawRodsView(ctx, ui, panel, view) {
  const st = panel.game.state, t = panel.t;
  const R = ensureRods(st);
  ctx.save(); roundRectPath(ctx, view.x, view.y, view.w, view.h, 10); ctx.clip();
  drawLabRoom(ctx, view, t, undefined, 'rods'); // [lab13]
  const TW = view.w >= 480 ? 86 : 70, TH = TW - 6;
  const at = grid(view, RODS.length, TW, TH, 7, 14);
  RODS.forEach((rod, i) => {
    const { x, y } = at(i);
    const owned = R.owned.includes(rod.id), eq = R.equipped === rod.id, sel = panel.rodSel === rod.id;
    const hov = tile(ctx, ui, x, y, TW, TH, { sel, glow: eq ? '#b8ff7a' : null, bottom: owned ? mix(rarityCol(rod.rarity), '#ffffff', 0.65) : '#dde8f0' });
    const ic = icon('rod:' + rod.id, TW - 26);
    if (ic) {
      ctx.globalAlpha = owned ? 1 : 0.45;
      const bob = hov || sel ? Math.sin(t * 5) * 1.5 : 0;
      ctx.drawImage(ic, Math.round(x + TW / 2 - ic.width / 2), Math.round(y + TH * 0.42 - ic.height / 2 + bob));
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = rarityCol(rod.rarity); roundRectPath(ctx, x + 8, y + TH - 5, TW - 16, 3, 1.5); ctx.fill();
    const max = Math.floor((TW - 6) / 6);
    const nm = rod.name.length > max ? rod.name.slice(0, max - 1) + '.' : rod.name;
    drawText(ctx, nm, x + TW / 2, y + TH - 15, { font: 'small', align: 'center', color: owned ? INK : '#7a90a4' });
    if (eq) { const ck = getUiIcon('check'); ctx.fillStyle = '#4cc83a'; ctx.beginPath(); ctx.arc(x + TW - 8, y + 8, 6, 0, TAU); ctx.fill(); if (ck) ctx.drawImage(ck, x + TW - 8 - Math.floor(ck.width / 2), y + 8 - Math.floor(ck.height / 2)); }
    else if (!owned) { const lk = getUiIcon('lock'); if (lk) ctx.drawImage(lk, x + TW - 14, y + 4); }
    if (hov) ui.tip = rod.name;
    if (ui.clicked({ x, y, w: TW, h: TH })) { panel.rodSel = rod.id; panel.game.audio.play('ui_click'); }
  });
  ctx.restore();
}

export function drawRodCard(ctx, ui, panel, r) {
  const g = panel.game, st = g.state, t = panel.t;
  glassCard(ctx, r.x, r.y, r.w, r.h);
  const R = ensureRods(st);
  const rod = ROD_BY_ID[panel.rodSel] || ROD_BY_ID[R.equipped];
  if (!rod) return;
  const owned = R.owned.includes(rod.id), eq = R.equipped === rod.id;
  const cx = r.x + r.w / 2, hy = r.y + 46;
  pedestal(ctx, cx, hy, 80, t, mix(rarityCol(rod.rarity), '#ffffff', 0.4));
  drawAeroGlow(ctx, cx, hy, 44, mix(rarityCol(rod.rarity), '#ffffff', 0.4), 0.6);
  const ic = icon('rod:' + rod.id, 64);
  if (ic) { ctx.globalAlpha = owned ? 1 : 0.5; ctx.drawImage(ic, Math.round(cx - ic.width / 2), Math.round(hy - ic.height / 2 + Math.sin(t * 2) * 2)); ctx.globalAlpha = 1; }
  let y = hy + 50;
  drawText(ctx, rod.name, cx, y, { align: 'center', color: INK, shadow: '#ffffff' });
  y += 12;
  drawAeroLabel(ctx, rod.rarity.toUpperCase(), cx, y, { align: 'center', font: 'small', tone: { common: 'grey', uncommon: 'green', rare: 'aqua', epic: 'purple', legendary: 'orange' }[rod.rarity] || 'glass' });
  y += 16;
  for (const l of wrapText(rod.desc, r.w - 20).slice(0, 2)) { drawText(ctx, l, cx, y, { align: 'center', color: INK_SOFT }); y += 11; }
  y += 8;
  for (const k of ROD_STAT_KEYS) {
    const v = k.key === 'shock' ? rod.stats.shock.power : rod.stats[k.key];
    const kk = k.log ? Math.log(1 + v) / Math.log(1 + k.max) : v / k.max;
    const ai = anyIcon(k.icon, 10);
    if (ai) ctx.drawImage(ai, r.x + 10, y - 1);
    drawText(ctx, k.label.toUpperCase(), r.x + 24, y + 1, { font: 'small', color: INK_SOFT });
    statBar(ctx, r.x + 80, y, r.w - 120, kk, k.key === 'shock' ? '#ffd23a' : k.key === 'luck' ? '#6fd23f' : '#35c8ff', 7);
    const vt = k.key === 'strength' ? `${v}kg` : k.key === 'resilience' ? `${Math.round(v * 100)}%` : k.key === 'shock' ? `x${rod.stats.shock.charges}` : v.toFixed(2);
    drawText(ctx, vt, r.x + r.w - 10, y + 1, { font: 'small', align: 'right', color: INK });
    if (ui.hover({ x: r.x + 8, y: y - 2, w: r.w - 16, h: 11 })) ui.tip = k.key === 'shock' ? `Shock: ${rod.stats.shock.power}s stun, ${rod.stats.shock.charges} per fight, ${rod.stats.shock.cooldown}s recharge` : k.label;
    y += 14;
  }
  const by = r.y + r.h - 32;
  if (eq) drawAeroLabel(ctx, 'Equipped', cx, by + 6, { align: 'center', tone: 'green' });
  else if (owned) { if (pill(ui, ctx, r.x + 10, by, r.w - 20, 24, 'Equip', { tone: 'green', icon: getUiIcon('check'), sound: 'ui_unlock' })) { equipRod(st, rod.id); g.emit?.('rodEquipped', rod.id); g.save?.(); } }
  else {
    const nd = nodeFor('rod', rod.id);
    if (nd && pill(ui, ctx, r.x + 10, by, r.w - 20, 24, 'Research it', { tone: 'aqua', icon: icon(nd.icon, 14) })) panel.setTab('tree', { focus: nd.id });
  }
}

// ================================================================== crafting
export function drawCraftView(ctx, ui, panel, view) {
  const g = panel.game, st = g.state, t = panel.t;
  ctx.save(); roundRectPath(ctx, view.x, view.y, view.w, view.h, 10); ctx.clip();
  drawBlueprintBg(ctx, view, t, 'craft');
  // category pills
  let cx = view.x + 10;
  for (const c of CRAFT_CATS) {
    const ic = icon(c.icon, 16);
    const w = measureText(c.name) + (ic ? ic.width : 16) + 30;
    const on = panel.craftCat === c.id;
    if (pill(ui, ctx, cx, view.y + 8, w, 22, c.name, { tone: on ? 'green' : 'white', icon: ic, active: on })) { panel.craftCat = c.id; panel.recipeSel = null; }
    cx += w + 4;
  }
  const list = RECIPES.filter((r) => r.cat === panel.craftCat || (panel.craftCat === 'bait' && r.cat === 'special'));
  list.sort((a, b) => (recipeUnlocked(st, b.id) - recipeUnlocked(st, a.id)) || (a.cost.aero - b.cost.aero));
  if (!panel.recipeSel || !list.some((r) => r.id === panel.recipeSel)) panel.recipeSel = list.find((r) => recipeUnlocked(st, r.id))?.id || list[0]?.id || null;
  const TW = 74, TH = 74;
  const at = grid(view, list.length, TW, TH, 6, 40);
  list.forEach((rc, i) => {
    const { x, y } = at(i);
    if (y > view.y + view.h) return;
    const open = recipeUnlocked(st, rc.id), sel = panel.recipeSel === rc.id;
    const ok = open && craftCheck(st, rc).ok;
    const hov = tile(ctx, ui, x, y, TW, TH, { sel, glow: ok && rc.cat !== 'special' ? '#c8ff7a' : null, bottom: open ? '#d9f2fc' : '#c8d8e4' });
    const ic = icon(rc.icon, 44);
    if (ic) { ctx.globalAlpha = open ? 1 : 0.4; ctx.drawImage(ic, Math.round(x + TW / 2 - ic.width / 2), Math.round(y + 30 - ic.height / 2 + (hov || sel ? Math.sin(t * 5) * 1.5 : 0))); ctx.globalAlpha = 1; }
    const nm = rc.name.length > 12 ? rc.name.slice(0, 11) + '.' : rc.name;
    drawText(ctx, nm, x + TW / 2, y + TH - 13, { font: 'small', align: 'center', color: open ? INK : '#7a90a4' });
    if (!open) { const lk = getUiIcon('lock'); if (lk) ctx.drawImage(lk, x + TW - 14, y + 4); }
    else if (rc.out) { const n = countItem(st, rc.out.id); if (n) drawAeroBadge(ctx, x + TW + 2, y - 3, n, t); }
    if (hov) ui.tip = rc.name;
    if (ui.clicked({ x, y, w: TW, h: TH })) { panel.recipeSel = rc.id; g.audio.play('ui_click'); }
  });
  for (const f of panel.craftFx) drawSplash(ctx, f.x, f.y, f.t / 0.9, '#7ef0ff');
  ctx.restore();
}

export function drawCraftCard(ctx, ui, panel, r) {
  const g = panel.game, st = g.state, t = panel.t;
  glassCard(ctx, r.x, r.y, r.w, r.h);
  const rc = RECIPE_BY_ID[panel.recipeSel];
  if (!rc) return;
  const open = recipeUnlocked(st, rc.id);
  const cx = r.x + r.w / 2, hy = r.y + 46;
  pedestal(ctx, cx, hy, 80, t);
  drawAeroGlow(ctx, cx, hy, 44, '#bff6ff', 0.6);
  const ic = icon(rc.icon, 64);
  if (ic) { ctx.globalAlpha = open ? 1 : 0.45; ctx.drawImage(ic, Math.round(cx - ic.width / 2), Math.round(hy - ic.height / 2 + Math.sin(t * 2) * 1.5)); ctx.globalAlpha = 1; }
  let y = hy + 50;
  drawText(ctx, rc.name + (rc.out?.qty > 1 ? ` x${rc.out.qty}` : ''), cx, y, { align: 'center', color: INK, shadow: '#ffffff' });
  y += 12;
  const tag = { building: 'Blueprint', decor: 'Aquarium decor', plans: 'Tank plans', bait: 'Bait', special: 'Bait mixer' }[rc.cat]; // [phase10:tank]
  drawText(ctx, tag.toUpperCase(), cx, y, { font: 'small', align: 'center', color: INK_SOFT });
  y += 10;
  for (const l of wrapText(rc.desc || ITEMS[rc.out?.id]?.desc || '', r.w - 20).slice(0, 3)) { drawText(ctx, l, cx, y, { align: 'center', color: INK_SOFT }); y += 11; }
  y += 4;
  const by = r.y + r.h - 32;
  if (!open) {
    const nd = recipeNode(rc.id);
    const lk = getUiIcon('lock');
    if (lk) ctx.drawImage(lk, cx - 4, y + 4);
    if (nd && pill(ui, ctx, r.x + 10, by, r.w - 20, 24, 'Research it', { tone: 'aqua', icon: icon(nd.icon, 14) })) panel.setTab('tree', { focus: nd.id });
    return;
  }
  if (rc.cat === 'special') {
    if (pill(ui, ctx, r.x + 10, by, r.w - 20, 24, 'Open the mixer', { tone: 'green', icon: icon('beaker', 14) })) craft(g, rc.id);
    return;
  }
  const c = craftCheck(st, rc);
  const rows = [];
  if (c.aero.need) rows.push({ kind: 'aero', id: 'aero', ...c.aero });
  for (const it of c.items) rows.push({ kind: 'item', ...it });
  const chh = costTilesHeight(rows.length, r.w - 20);
  const cy0 = Math.min(y + 6, by - chh - 12);
  ctx.fillStyle = rgba('#dff4fc', 0.8); roundRectPath(ctx, r.x + 6, cy0 - 5, r.w - 12, chh + 10, 8); ctx.fill();
  costTiles(ctx, ui, rows, r.x + 10, cy0, r.w - 20);
  const owned = rc.out ? countItem(st, rc.out.id) : 0;
  const doCraft = (n) => {
    const res = craft(g, rc.id, n);
    if (res.ok) {
      g.audio.play('ui_unlock');
      panel.craftFx.push({ x: panel.view.x + panel.view.w / 2, y: panel.view.y + panel.view.h - 30, t: 0 });
      if (rc.cat === 'decor') g.toast?.(res.placed ? 'Added to your aquarium!' : 'Saved in your inventory.', 'tank');
      else if (rc.cat === 'bait') g.toast?.(`+${res.out[0].qty} ${rc.name}`, 'bait');
    } else { g.audio.play('ui_error'); g.toast?.(res.reason, 'cross'); }
  };
  const canPlace = (rc.cat === 'building' || rc.cat === 'plans') && owned > 0 && g.build;
  const multi = rc.cat === 'bait' || rc.cat === 'decor';
  const w1 = canPlace || multi ? Math.round((r.w - 24) * 0.58) : r.w - 20;
  if (pill(ui, ctx, r.x + 10, by, w1, 24, 'Craft', { tone: 'green', icon: icon('hammer', 14), disabled: !c.ok, sound: 'ui_unlock' })) doCraft(1);
  if (canPlace) { if (pill(ui, ctx, r.x + 14 + w1, by, r.w - 24 - w1, 24, 'Place', { tone: 'aqua', icon: getUiIcon('home'), tip: 'Place it in your tank' })) { ui.close(); g.build.startPlacing(rc.out.id); } } // [phase10:tank]
  else if (multi) { const c5 = craftCheck(st, rc, 5); if (pill(ui, ctx, r.x + 14 + w1, by, r.w - 24 - w1, 24, 'x5', { tone: 'aqua', disabled: !c5.ok })) doCraft(5); }
}

// ================================================================== boats
export function drawBoatsView(ctx, ui, panel, view) {
  const g = panel.game, st = g.state, t = panel.t;
  ctx.save(); roundRectPath(ctx, view.x, view.y, view.w, view.h, 10); ctx.clip();
  // [lab15] the Lab's space scene (src/ui/labroom.js): the boats float in orbit on a glowing orbit line above the
  // limb of an ocean planet, gently bobbing, each on a little stepped pixel hover glow
  drawLabRoom(ctx, view, t, undefined, 'boats');
  const sc = labRoomScene(view, 'boats');
  const cur = st.boat?.tier | 0;
  const n = BOAT_ORDER.length, sp = view.w / n;
  BOAT_ORDER.forEach((id, i) => {
    const has = i === 0 || unlocked(st, 'boat', id);
    const x = view.x + sp * (i + 0.5), line = view.y + sc.orbit(x - view.x);
    const y = line - 3 + Math.sin(t * 1.6 + i) * 1.5;
    const sel = (panel.boatSel ?? cur) === i;
    drawOrbitPad(ctx, x, line, sp * 0.3, t + i, { sel, cur: i === cur });
    const ic = icon('boat:' + id, Math.min(80, sp * 1.6));
    if (ic) { ctx.globalAlpha = has ? 1 : 0.5; ctx.drawImage(ic, Math.round(x - ic.width / 2), Math.round(y - ic.height + 6)); ctx.globalAlpha = 1; }
    if (!has) { const lk = getUiIcon('lock'); if (lk) ctx.drawImage(lk, Math.round(x - 4), Math.round(y - 46)); }
    if (i === cur) { const ck = getUiIcon('check'); ctx.fillStyle = '#4cc83a'; ctx.beginPath(); ctx.arc(x + 22, y - 46, 6, 0, TAU); ctx.fill(); if (ck) ctx.drawImage(ck, Math.round(x + 22 - ck.width / 2), Math.round(y - 46 - ck.height / 2)); }
    const nm = BOAT_NAMES[id];
    drawText(ctx, nm, x, line + 12, { font: 'small', align: 'center', color: has ? '#ffffff' : '#c8d6ff', outline: has ? '#1a2a7a' : '#2a2a6a' });
    const rr = { x: x - sp / 2, y: y - 60, w: sp, h: 72 };
    if (ui.hover(rr)) ui.tip = BOAT_NAMES[id];
    if (ui.clicked(rr)) { panel.boatSel = i; g.audio.play('ui_click'); }
  });
  ctx.restore();
}

export function drawBoatCard(ctx, ui, panel, r) {
  const g = panel.game, st = g.state, t = panel.t;
  glassCard(ctx, r.x, r.y, r.w, r.h);
  const cur = st.boat?.tier | 0;
  const i = clamp(panel.boatSel ?? cur, 0, BOAT_ORDER.length - 1), id = BOAT_ORDER[i];
  const has = i === 0 || unlocked(st, 'boat', id);
  const nd = nodeFor('boat', id);
  const cx = r.x + r.w / 2, hy = r.y + 48;
  pedestal(ctx, cx, hy, 96, t);
  drawAeroGlow(ctx, cx, hy, 46, '#bff6ff', 0.6);
  const ic = icon('boat:' + id, 80);
  if (ic) { ctx.globalAlpha = has ? 1 : 0.45; ctx.drawImage(ic, Math.round(cx - ic.width / 2), Math.round(hy - ic.height / 2 + Math.sin(t * 1.6) * 1.5)); ctx.globalAlpha = 1; }
  let y = hy + 56;
  drawText(ctx, BOAT_NAMES[id], cx, y, { align: 'center', color: INK, shadow: '#ffffff' });
  y += 12;
  drawText(ctx, `TIER ${i + 1}`, cx, y, { font: 'small', align: 'center', color: INK_SOFT });
  y += 10;
  for (const l of wrapText(nd?.desc || 'Your trusty first boat.', r.w - 20).slice(0, 2)) { drawText(ctx, l, cx, y, { align: 'center', color: INK_SOFT }); y += 11; }
  y += 4;
  // perks of the boat's Lab line (this node + the boat upgrades researched after it)
  let x = r.x + 10;
  if (nd) for (const [k, v] of Object.entries(nd.effect)) { const info = EFFECT_INFO[k]; x += chip(ctx, x, y, anyIcon(info?.[0] || 'star', 10), fmtEffect(k, v)) + 3; }
  const by = r.y + r.h - 32;
  if (i === cur) drawAeroLabel(ctx, 'Sailing', cx, by + 6, { align: 'center', tone: 'green' });
  else if (has) {
    if (pill(ui, ctx, r.x + 10, by, r.w - 20, 24, 'Sail this one', { tone: 'green', icon: getUiIcon('check'), sound: 'ui_unlock' })) {
      st.boat ||= { tier: 0, parts: {} };
      st.boat.tier = i;
      g.emit?.('boatUpgraded', i);
      g.save?.();
    }
  } else if (nd && pill(ui, ctx, r.x + 10, by, r.w - 20, 24, labStatus(st, nd.id) === 'researching' ? 'Brewing...' : 'Research it', { tone: 'aqua', icon: icon(nd.icon, 14) })) panel.setTab('tree', { focus: nd.id });
}

void shade; void drawSparkle; void BRANCHES; void orbIcon;
