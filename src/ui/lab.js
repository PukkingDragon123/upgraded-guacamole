// The Lab panel (id 'lab'; old ids 'skills', 'research', 'shop', 'crafting', 'boatyard' are LabAlias wrappers).
// OWNER: Lab agent. A bright Frutiger Aero lab interior: a window onto an eco wallpaper world, glass tubes of
// bubbling water, Professor Fizz and your bubble person at the bench (beakers = research benches), and a big glossy
// "dome" screen with the radial research tree (src/ui/labtree.js) or the rod rack / crafting bench / boat dock
// (src/ui/labviews.js). The detail card sits on the right of the dome.
//   ui.open('lab', {tab: 'tree'|'rods'|'craft'|'boats', focus: nodeId|'custombait'|'isp'|'rod:<id>'..., highlight, cat, recipe})
import { clamp, TAU, hash1, damp } from '../core/math.js';
import { rgba, mix, shade } from '../core/color.js';
import { drawText, measureText } from '../gfx/font.js';
import { getUiIcon } from '../gfx/uiicons.js';
import { drawAeroCoin, fmtAero, drawAeroGlow, drawAeroBubble, drawAeroBadge, drawSparkle } from './aero.js';
import * as CHAR from '../gfx/character.js';
import * as NPC from '../gfx/npcs.js';
import { LAB_BY_ID, BRANCHES, ensureLab, labSlots, labProgress, labRemaining, labFocus, startResearch, instantFinish, labTick, labReadyCount, fmtTime } from '../game/lab.js';
import { ensureRods } from '../game/rods.js';
import { RECIPE_BY_ID, craft } from '../build/crafting.js';
import { labRoom, leafSprig, drawTube, drawFlask, ecoOrb, roundRectPath } from './labart.js';
import { iconBudget, icon, pill, INK } from './labkit.js';
import { LabTree, drawNodeCard } from './labtree.js';
import { drawRodsView, drawRodCard, drawCraftView, drawCraftCard, drawBoatsView, drawBoatCard } from './labviews.js';

const TABS = [
  { id: 'tree', label: 'Research', icon: 'beaker' },
  { id: 'rods', label: 'Rods', icon: 'rod:glass' },
  { id: 'craft', label: 'Crafting', icon: 'hammer' },
  { id: 'boats', label: 'Boats', icon: 'boat:skiff' },
];
const TAB_ALIAS = { shop: 'craft', crafting: 'craft', research: 'tree', skills: 'tree', boatyard: 'boats', boat: 'boats', rod: 'rods' };

export class LabPanel {
  constructor() {
    this.id = 'lab';
    this.openId = 'lab';
    this.modal = true;
    this.sound = 'ui_open';
    this.tab = 'tree';
    this.t = 0;
    this.tree = new LabTree(this);
    this.craftCat = 'building';
    this.recipeSel = null;
    this.rodSel = null;
    this.boatSel = null;
    this.craftFx = [];
    this.first = true;
    this.cheer = 0;
    this.view = { x: 0, y: 0, w: 1, h: 1 };
  }

  open(data) {
    const d = data || {};
    const st = this.game.state;
    ensureLab(st);
    this.rodSel = ensureRods(st).equipped;
    this.boatSel = null;
    if (d.tab) this.setTab(TAB_ALIAS[d.tab] || d.tab, d);
    else if (this.first) this.tab = 'tree';
    const focus = labFocus(st, d.focus || d.highlight);
    if (focus) { this.tab = 'tree'; this.tree.focus(focus, Math.max(this.tree.camT.z, 0.95), this.first); }
    else if (this.first) {
      // start around the root with tier 1-4 in view
      this.tree.cam = { x: 0, y: 0, z: 0.85 }; this.tree.camT = { x: 0, y: 0, z: 0.85 };
    }
    this.first = false;
  }

  close() { this.tree.drag = null; }

  setTab(id, d = {}) {
    id = TAB_ALIAS[id] || id;
    if (!TABS.some((t) => t.id === id)) id = 'tree';
    this.tab = id;
    if (d.focus) { const f = labFocus(this.game.state, d.focus); if (f) this.tree.focus(f); }
    if (d.cat) this.craftCat = d.cat === 'special' ? 'bait' : d.cat;
    if (d.recipe && RECIPE_BY_ID[d.recipe]) { const c = RECIPE_BY_ID[d.recipe].cat; this.craftCat = c === 'special' ? 'bait' : c; this.recipeSel = d.recipe; }
  }

  research(id) {
    const g = this.game;
    const r = startResearch(g, id);
    if (!r.ok) { g.audio.play('ui_error'); g.toast?.(r.reason, 'cross'); return false; }
    g.audio.play('ui_unlock');
    this.tree.sel = id;
    this.cheer = 1.6;
    return true;
  }

  // scripting / test hooks (the card buttons call the same functions)
  finishNow(id) { return instantFinish(this.game, id); }
  craft(id, n = 1) { return craft(this.game, id, n); }

  layout() {
    const g = this.game, W = g.screen.W, H = g.screen.H;
    const pw = Math.min(W - 20, 940), ph = Math.min(H - 20, 540);
    const P = { x: Math.round((W - pw) / 2), y: Math.round((H - ph) / 2), w: pw, h: ph };
    const HEAD = 32;
    const body = { x: P.x, y: P.y + HEAD, w: P.w, h: P.h - HEAD };
    const lw = clamp(Math.round(P.w * 0.23), 176, 236);
    const win = { x: 16, y: HEAD + 14, w: lw - 26, h: clamp(Math.round(body.h * 0.3), 92, 156) };
    const dome = { x: P.x + lw + 2, y: body.y + 10, w: P.w - lw - 14, h: body.h - 20 };
    const cardW = clamp(Math.round(dome.w * 0.31), 184, 224);
    const card = { x: dome.x + dome.w - cardW - 8, y: dome.y + 8, w: cardW, h: dome.h - 16 };
    const view = { x: dome.x + 8, y: dome.y + 8, w: dome.w - cardW - 24, h: dome.h - 16 };
    return { P, HEAD, body, lw, win, dome, card, view };
  }

  // ------------------------------------------------------------------ frame
  draw(ctx, ui, dt) {
    const g = this.game, st = g.state;
    dt = Math.max(0, Math.min(dt, 0.1));
    this.t += dt;
    const t = this.t;
    iconBudget(this.t < 0.2 ? 3 : 8);
    try { labTick(g); } catch { /* ticked by game.build too */ }
    const Lo = this.layout();
    const { P, HEAD, win, dome, card, view } = Lo;
    this.rect = P;
    this.view = view;
    if (ui.hover(P)) ui.markHot?.('lab');
    // panel body: glossy frame + the room
    ctx.save();
    ctx.fillStyle = rgba('#04304e', 0.28); roundRectPath(ctx, P.x + 2, P.y + 4, P.w, P.h, 14); ctx.fill();
    roundRectPath(ctx, P.x, P.y, P.w, P.h, 14); ctx.clip();
    ctx.drawImage(labRoom(P.w, P.h, win), P.x, P.y);
    this.drawWallPipes(ctx, Lo);
    this.drawShelf(ctx, Lo);
    this.drawBench(ctx, ui, Lo, dt);
    this.drawDomeFrame(ctx, dome);
    ctx.restore();
    // dome content
    if (this.tab === 'tree') { this.tree.update(ui, view, dt); this.tree.draw(ctx, ui, view, dt); drawNodeCard(ctx, ui, this, card, this.tree.sel); }
    else if (this.tab === 'rods') { drawRodsView(ctx, ui, this, view); drawRodCard(ctx, ui, this, card); }
    else if (this.tab === 'craft') { drawCraftView(ctx, ui, this, view); drawCraftCard(ctx, ui, this, card); }
    else if (this.tab === 'boats') { drawBoatsView(ctx, ui, this, view); drawBoatCard(ctx, ui, this, card); }
    for (const f of this.craftFx) f.t += dt;
    this.craftFx = this.craftFx.filter((f) => f.t < 0.9);
    this.drawHeader(ctx, ui, P, HEAD);
    this.drawLeaves(ctx, P);
    // outer rim
    ctx.save();
    ctx.strokeStyle = '#2f8fc8'; ctx.lineWidth = 1; roundRectPath(ctx, P.x + 0.5, P.y + 0.5, P.w - 1, P.h - 1, 14); ctx.stroke();
    ctx.strokeStyle = rgba('#ffffff', 0.9); roundRectPath(ctx, P.x + 1.5, P.y + 1.5, P.w - 3, P.h - 3, 13); ctx.stroke();
    ctx.restore();
    // swallow clicks on the panel so the world below never gets them
    if (ui.inp.pressed && ui.hover(P)) ui.inp.pressed = false;
    if (ui.hover(P) && ui.inp.wheel) ui.inp.wheel = 0;
    if (g.input.keyPressed('1')) this.setTab('tree');
    if (g.input.keyPressed('2')) this.setTab('rods');
    if (g.input.keyPressed('3')) this.setTab('craft');
    if (g.input.keyPressed('4')) this.setTab('boats');
    this.cheer = Math.max(0, this.cheer - dt);
  }

  // ------------------------------------------------------------------ header
  drawHeader(ctx, ui, P, HEAD) {
    const g = this.game, st = g.state, t = this.t;
    ctx.save();
    roundRectPath(ctx, P.x, P.y, P.w, P.h, 14); ctx.clip();
    const hg = ctx.createLinearGradient(0, P.y, 0, P.y + HEAD);
    hg.addColorStop(0, '#8fe0ff'); hg.addColorStop(0.48, '#38b4f4'); hg.addColorStop(0.52, '#1e94e6'); hg.addColorStop(1, '#2fb0f0');
    ctx.fillStyle = hg; ctx.fillRect(P.x, P.y, P.w, HEAD);
    ctx.fillStyle = rgba('#ffffff', 0.45); ctx.fillRect(P.x, P.y + 1, P.w, Math.round(HEAD * 0.42));
    ctx.fillStyle = '#0b5a9a'; ctx.fillRect(P.x, P.y + HEAD - 1, P.w, 1);
    ctx.fillStyle = rgba('#ffffff', 0.8); ctx.fillRect(P.x, P.y + HEAD, P.w, 1);
    ctx.restore();
    // logo: a sun orb with the beaker
    const lx = P.x + 20, ly = P.y + 16;
    drawAeroGlow(ctx, lx, ly, 18, '#ffffff', 0.6);
    const o = ecoOrb(11, '#ffe27a', 'sun');
    ctx.drawImage(o, Math.round(lx - o.width / 2), Math.round(ly - o.height / 2));
    const bk = icon('beaker', 14);
    if (bk) ctx.drawImage(bk, Math.round(lx - bk.width / 2), Math.round(ly - bk.height / 2 + Math.sin(t * 3)));
    drawText(ctx, 'The Lab', P.x + 36, P.y + 9, { scale: 2, color: '#ffffff', outline: '#0b5a9a' });
    // tabs
    let tx = P.x + 36 + measureText('The Lab', 'normal', 2) + 16;
    for (const tb of TABS) {
      const ic = icon(tb.icon, 16);
      const w = measureText(tb.label) + (ic ? ic.width : 16) + 30;
      const on = this.tab === tb.id;
      if (pill(ui, ctx, tx, P.y + 5, w, 22, tb.label, { tone: on ? 'green' : 'white', icon: ic, active: on })) this.setTab(tb.id);
      if (tb.id === 'tree') { const n = labReadyCount(st); if (n && !on) drawAeroBadge(ctx, tx + w + 2, P.y + 1, n, t); }
      tx += w + 4;
    }
    // Aero + close
    const cw = 22, cx = P.x + P.w - cw - 8;
    const amt = fmtAero(st.coins);
    const aw = measureText(amt) + 30;
    const ax = cx - aw - 8;
    ctx.fillStyle = rgba('#ffffff', 0.92); roundRectPath(ctx, ax, P.y + 6, aw, 20, 10); ctx.fill();
    ctx.strokeStyle = '#2f8fc8'; ctx.lineWidth = 1; roundRectPath(ctx, ax + 0.5, P.y + 6.5, aw - 1, 19, 10); ctx.stroke();
    drawAeroCoin(ctx, ax + 11, P.y + 16, 6, t);
    drawText(ctx, amt, ax + 21, P.y + 13, { color: INK });
    if (pill(ui, ctx, cx, P.y + 5, cw, 22, '', { tone: 'red', icon: getUiIcon('cross'), tip: 'Close (Esc)' })) ui.close(this.openId);
  }

  // ------------------------------------------------------------------ room pieces
  drawDomeFrame(ctx, d) {
    ctx.save();
    ctx.fillStyle = rgba('#0a4a7a', 0.18); roundRectPath(ctx, d.x + 2, d.y + 4, d.w, d.h, 16); ctx.fill();
    const fg = ctx.createLinearGradient(0, d.y, 0, d.y + d.h);
    fg.addColorStop(0, '#ffffff'); fg.addColorStop(0.5, '#e4f4fc'); fg.addColorStop(1, '#c4e4f4');
    ctx.fillStyle = fg; roundRectPath(ctx, d.x, d.y, d.w, d.h, 16); ctx.fill();
    ctx.strokeStyle = '#6fb4d8'; ctx.lineWidth = 1; roundRectPath(ctx, d.x + 0.5, d.y + 0.5, d.w - 1, d.h - 1, 16); ctx.stroke();
    ctx.strokeStyle = rgba('#ffffff', 1); roundRectPath(ctx, d.x + 1.5, d.y + 1.5, d.w - 3, d.h - 3, 15); ctx.stroke();
    // chrome screws
    for (const [sx, sy] of [[d.x + 8, d.y + d.h - 5], [d.x + d.w - 8, d.y + d.h - 5]]) { ctx.fillStyle = '#9fc8dc'; ctx.beginPath(); ctx.arc(sx, sy, 1.6, 0, TAU); ctx.fill(); }
    ctx.restore();
  }

  drawWallPipes(ctx, Lo) {
    const { P, win, dome } = Lo;
    const L = ensureLab(this.game.state);
    const busy = L.slots.length > 0;
    const t = this.t;
    const x0 = P.x + win.x + win.w + 4;
    const top = P.y + win.y - 6;
    const benchTop = P.y + P.h - 64;
    // a tall column on the right wall of the bench zone feeding the dome
    const pts = [[x0, benchTop - 6], [x0, top + 20], [x0 + 3, top + 8], [dome.x - 2, top + 8]];
    drawTube(ctx, pts, { t, water: busy ? 1 : 0.35, color: '#4fd2ff', width: 8, flow: busy ? 40 : 10, bubbles: busy ? 9 : 3 });
    // a second slim line along the floor of the window
    const y2 = P.y + win.y + win.h + 30;
    drawTube(ctx, [[P.x + 10, y2], [x0 - 4, y2]], { t: t * 0.8, water: busy ? 1 : 0.6, color: '#7ee85a', width: 5, flow: 22 });
  }

  drawShelf(ctx, Lo) {
    const { P, win } = Lo;
    const t = this.t;
    const sy = P.y + win.y + win.h + 52;
    const sx = P.x + 12, sw = win.w;
    ctx.fillStyle = rgba('#5aa8cc', 0.25); ctx.fillRect(sx + 2, sy + 4, sw, 3);
    const sg = ctx.createLinearGradient(0, sy, 0, sy + 5);
    sg.addColorStop(0, '#ffffff'); sg.addColorStop(1, '#bfe4f4');
    ctx.fillStyle = sg; roundRectPath(ctx, sx, sy, sw, 5, 2); ctx.fill();
    ctx.strokeStyle = '#7fb8d6'; ctx.lineWidth = 1; roundRectPath(ctx, sx + 0.5, sy + 0.5, sw - 1, 4, 2); ctx.stroke();
    const cols = ['#ff74b4', '#ffd23a', '#6fd23f', '#35c8ff', '#a98aff'];
    const n = Math.max(3, Math.floor(sw / 34));
    for (let i = 0; i < n; i++) drawFlask(ctx, sx + 14 + i * ((sw - 28) / Math.max(1, n - 1)), sy, { t: t + i, level: 0.4 + hash1(i, 3) * 0.4, color: cols[i % cols.length], w: 12 + (i % 2) * 4, h: 16 + (i % 3) * 3 });
    // wall clock (real time) and a fish blueprint poster
    const benchTop = P.y + P.h - 64;
    const room = benchTop - 84 - (sy + 10);
    if (room > 40) {
      const ccx = sx + 22, ccy = sy + 12 + Math.min(34, room / 2);
      const cr = 15;
      ctx.fillStyle = rgba('#0a4a7a', 0.15); ctx.beginPath(); ctx.arc(ccx + 1, ccy + 2, cr, 0, TAU); ctx.fill();
      const cg = ctx.createRadialGradient(ccx - 4, ccy - 5, 1, ccx, ccy, cr);
      cg.addColorStop(0, '#ffffff'); cg.addColorStop(1, '#d4eef8');
      ctx.fillStyle = cg; ctx.beginPath(); ctx.arc(ccx, ccy, cr, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#35b4e8'; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = '#7fb8d6';
      for (let i = 0; i < 12; i++) { const a = (i / 12) * TAU; ctx.fillRect(Math.round(ccx + Math.cos(a) * (cr - 3)), Math.round(ccy + Math.sin(a) * (cr - 3)), 1, 1); }
      const d = new Date(), hr = (d.getHours() % 12 + d.getMinutes() / 60) / 12, mn = d.getMinutes() / 60;
      ctx.strokeStyle = '#0c3a52'; ctx.lineCap = 'round';
      ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(ccx, ccy); ctx.lineTo(ccx + Math.sin(hr * TAU) * 7, ccy - Math.cos(hr * TAU) * 7); ctx.stroke();
      ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(ccx, ccy); ctx.lineTo(ccx + Math.sin(mn * TAU) * 11, ccy - Math.cos(mn * TAU) * 11); ctx.stroke();
      ctx.fillStyle = '#ff74b4'; ctx.beginPath(); ctx.arc(ccx, ccy, 1.5, 0, TAU); ctx.fill();
      ctx.fillStyle = rgba('#ffffff', 0.8); ctx.beginPath(); ctx.ellipse(ccx - 5, ccy - 8, 5, 2, -0.5, 0, TAU); ctx.fill();
      // poster
      const pw = Math.min(86, sw - 60), ph = Math.min(56, room - 6), px = sx + sw - pw - 4, py = sy + 14;
      ctx.fillStyle = rgba('#0a4a7a', 0.15); ctx.fillRect(px + 2, py + 3, pw, ph);
      ctx.fillStyle = '#ffffff'; ctx.fillRect(px - 2, py - 2, pw + 4, ph + 4);
      const pg = ctx.createLinearGradient(0, py, 0, py + ph);
      pg.addColorStop(0, '#3aa8f4'); pg.addColorStop(1, '#1f78d8');
      ctx.fillStyle = pg; ctx.fillRect(px, py, pw, ph);
      ctx.fillStyle = rgba('#ffffff', 0.15);
      for (let gx = px + 4; gx < px + pw; gx += 6) ctx.fillRect(gx, py, 1, ph);
      for (let gy = py + 4; gy < py + ph; gy += 6) ctx.fillRect(px, gy, pw, 1);
      // a chalk fish with dimension lines
      const fx = px + pw * 0.46, fy = py + ph * 0.5, fl = pw * 0.3, fh = ph * 0.26;
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.ellipse(fx, fy, fl, fh, 0, 0, TAU); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(fx - fl, fy); ctx.lineTo(fx - fl - 10, fy - 8); ctx.lineTo(fx - fl - 10, fy + 8); ctx.closePath(); ctx.stroke();
      ctx.beginPath(); ctx.arc(fx + fl * 0.55, fy - 2, 2, 0, TAU); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(fx - fl, py + ph - 6); ctx.lineTo(fx + fl, py + ph - 6); ctx.moveTo(fx - fl, py + ph - 8); ctx.lineTo(fx - fl, py + ph - 4); ctx.moveTo(fx + fl, py + ph - 8); ctx.lineTo(fx + fl, py + ph - 4); ctx.stroke();
      ctx.fillStyle = '#ffe27a'; ctx.fillRect(px + 4, py + 4, 10, 2); ctx.fillRect(px + 4, py + 8, 6, 1);
      ctx.fillStyle = rgba('#ffffff', 0.25); ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + pw * 0.4, py); ctx.lineTo(px, py + ph * 0.6); ctx.closePath(); ctx.fill();
      // pin
      ctx.fillStyle = '#ff5a6a'; ctx.beginPath(); ctx.arc(px + pw / 2, py - 1, 2, 0, TAU); ctx.fill();
    }
  }

  drawBench(ctx, ui, Lo, dt) {
    const g = this.game, st = g.state, t = this.t;
    const { P, lw } = Lo;
    const L = ensureLab(st);
    const benchTop = P.y + P.h - 64;
    const bx = P.x + 10, bw = lw - 16;
    const busy = L.slots.length > 0;
    const feet = benchTop + 8;
    // the player (left) and Professor Fizz (right) stand behind the bench
    const fizzX = bx + bw * 0.74, plX = bx + bw * 0.27;
    const flaskY = benchTop;
    const lookAt = [bx + bw / 2, flaskY - 10];
    const pose = this.cheer > 0 ? 'cheer' : busy ? ((t % 6) < 4 ? 'reel' : 'idle') : 'idle';
    this.drawPlayer(ctx, plX, feet, pose, lookAt);
    this.drawFizz(ctx, fizzX, feet, busy, lookAt);
    // bench
    ctx.save();
    ctx.fillStyle = rgba('#0a4a7a', 0.15); ctx.fillRect(bx + 2, benchTop + 4, bw, 50);
    const fg = ctx.createLinearGradient(0, benchTop, 0, benchTop + 50);
    fg.addColorStop(0, '#ffffff'); fg.addColorStop(1, '#d4eef8');
    ctx.fillStyle = fg; roundRectPath(ctx, bx, benchTop + 3, bw, 50, 6); ctx.fill();
    ctx.strokeStyle = '#7fb8d6'; ctx.lineWidth = 1; roundRectPath(ctx, bx + 0.5, benchTop + 3.5, bw - 1, 49, 6); ctx.stroke();
    const tg = ctx.createLinearGradient(0, benchTop - 2, 0, benchTop + 5);
    tg.addColorStop(0, '#bff6ff'); tg.addColorStop(0.5, '#38c0f0'); tg.addColorStop(1, '#1f8ad0');
    ctx.fillStyle = tg; roundRectPath(ctx, bx - 4, benchTop - 2, bw + 8, 7, 3); ctx.fill();
    ctx.fillStyle = rgba('#ffffff', 0.85); ctx.fillRect(bx, benchTop - 1, bw, 1);
    ctx.fillStyle = '#7ee85a'; ctx.fillRect(bx + 6, benchTop + 14, bw - 12, 2);
    for (const hx of [bx + bw * 0.2, bx + bw * 0.8]) { ctx.fillStyle = '#9fc8dc'; roundRectPath(ctx, hx - 8, benchTop + 28, 16, 3, 1.5); ctx.fill(); }
    // control panel: status lights + a bubble gauge
    const cpx = bx + bw / 2 - 26, cpy = benchTop + 21;
    ctx.fillStyle = '#e4f6fc'; roundRectPath(ctx, cpx, cpy, 52, 16, 5); ctx.fill();
    ctx.strokeStyle = '#7fb8d6'; ctx.lineWidth = 1; roundRectPath(ctx, cpx + 0.5, cpy + 0.5, 51, 15, 5); ctx.stroke();
    for (let i = 0; i < 3; i++) {
      const on = busy ? ((this.t * 3 + i) % 3) < 1.5 : i === 0;
      ctx.fillStyle = on ? ['#5fd23a', '#ffd23a', '#35c8ff'][i] : '#b8d0dc';
      ctx.beginPath(); ctx.arc(cpx + 9 + i * 9, cpy + 8, 3, 0, TAU); ctx.fill();
      if (on) { ctx.fillStyle = rgba('#ffffff', 0.9); ctx.fillRect(cpx + 8 + i * 9, cpy + 6, 1, 1); }
    }
    ctx.fillStyle = '#ffffff'; roundRectPath(ctx, cpx + 34, cpy + 3, 14, 10, 3); ctx.fill();
    ctx.fillStyle = busy ? '#4fd2ff' : '#bfe8f4'; roundRectPath(ctx, cpx + 35, cpy + 4 + (busy ? 0 : 5), 12, busy ? 8 : 3, 2); ctx.fill();
    ctx.restore();
    // research benches = flasks on the counter
    const slots = labSlots(st, g.stats);
    const sp = (bw - 24) / Math.max(1, slots);
    for (let i = 0; i < slots; i++) {
      const s = L.slots[i];
      const nd = s && LAB_BY_ID[s.id];
      const fx = bx + 12 + sp * (i + 0.5);
      const col = nd ? mix(BRANCHES[nd.branch]?.color || '#35c8ff', '#4fd2ff', 0.25) : '#9fe0f8';
      const k = nd ? labProgress(st, s.id) : 0;
      drawFlask(ctx, fx, flaskY, { t: t + i * 1.3, level: nd ? 0.25 + 0.7 * k : 0.12, color: col, w: 24, h: 30, glow: nd ? 1 : 0, active: !!nd });
      if (nd) {
        const ic = icon(nd.icon, 14);
        if (ic) ctx.drawImage(ic, Math.round(fx - ic.width / 2), Math.round(flaskY - 46 + Math.sin(t * 2 + i) * 2));
      }
      const rr = { x: fx - 14, y: flaskY - 50, w: 28, h: 52 };
      if (ui.hover(rr)) ui.tip = nd ? `${nd.name}: ${fmtTime(labRemaining(st, s.id))}` : 'Free bench';
      if (ui.clicked(rr)) { this.setTab('tree'); if (nd) this.tree.focus(nd.id); else this.tree.sel = 'core'; }
    }
    // a tiny test-tube rack at the end of the bench
    const rx = bx + bw - 14;
    for (let i = 0; i < 3; i++) {
      const tx = rx - i * 5, col = ['#ff74b4', '#ffd23a', '#6fd23f'][i];
      ctx.fillStyle = rgba('#ffffff', 0.7); ctx.fillRect(tx - 1, flaskY - 16, 3, 14);
      ctx.fillStyle = col; ctx.fillRect(tx - 1, flaskY - 9 + Math.round(Math.sin(t * 2 + i)), 3, 7);
    }
    void dt;
  }

  drawPlayer(ctx, x, feet, pose, lookAt) {
    const g = this.game, t = this.t;
    if (typeof CHAR.drawCharacter === 'function' && !this.charErr) {
      try { CHAR.drawCharacter(ctx, x, feet, { pose, t, facing: 1, scale: 1.25, look: g.state.character, id: 'lab-player', lookAt, shadow: false }); return; } catch (e) { this.charErr = true; console.error(e); }
    }
    drawBubblePerson(ctx, x, feet, t, { body: '#7fd8ff', head: '#bff6ff', cheer: pose === 'cheer', look: lookAt });
  }

  drawFizz(ctx, x, feet, busy, lookAt) {
    const t = this.t;
    if (NPC.NPCS?.fizz && typeof NPC.drawNPC === 'function' && !this.npcErr) {
      try {
        const talk = busy ? 0.5 + 0.5 * Math.sin(t * 9) : 0;
        NPC.drawNPC(ctx, 'fizz', { x, y: feet, t, scale: 1.25, facing: -1, talk: talk > 0.6 ? talk : 0, mood: this.cheer > 0 ? 'excited' : busy ? 'happy' : 'happy', pose: this.cheer > 0 ? 'cheer' : busy ? ((t % 5) < 2.5 ? 'think' : 'talk') : 'idle', id: 'lab-fizz', lookAt });
        return;
      } catch (e) { this.npcErr = true; console.error(e); }
    }
    drawBubblePerson(ctx, x, feet, t, { body: '#ffffff', head: '#9effd2', coat: true, goggles: true, cheer: this.cheer > 0, look: lookAt, facing: -1 });
  }

  drawLeaves(ctx, P) {
    const put = (s, x, y, ang) => {
      ctx.save(); ctx.translate(Math.round(x), Math.round(y)); ctx.rotate(ang);
      ctx.drawImage(s.canvas, -s.ox, -s.oy);
      ctx.restore();
    };
    const sway = Math.sin(this.t * 0.9) * 0.03;
    put(leafSprig(118, 3, false, 0.5), P.x - 10, P.y + P.h * 0.62, -1.42 + sway);
    put(leafSprig(84, 5, false, 0.3), P.x - 6, P.y + P.h - 10, -0.2 - sway);
    put(leafSprig(96, 7, false, 0.45), P.x + P.w - 6, P.y + P.h * 0.6, 0.45 + sway);
    put(leafSprig(76, 9, true, 0.3), P.x + P.w + 10, P.y + 70, -0.62 - sway);
  }
}

// A simple glossy bubble person (fallback while the character / NPC art is not available).
export function drawBubblePerson(ctx, x, feet, t, o = {}) {
  const s = 1, f = o.facing || 1;
  const hop = o.cheer ? Math.abs(Math.sin(t * 8)) * 4 : Math.sin(t * 2) * 0.8;
  const by = feet - 20 - hop, hy = by - 26;
  ctx.save();
  // body bubble / lab coat
  const bg = ctx.createRadialGradient(x - 4, by - 6, 1, x, by, 14);
  bg.addColorStop(0, '#ffffff'); bg.addColorStop(1, o.body || '#7fd8ff');
  ctx.fillStyle = bg; ctx.beginPath(); ctx.ellipse(x, by, 12 * s, 15 * s, 0, 0, TAU); ctx.fill();
  ctx.strokeStyle = '#4f9cc4'; ctx.lineWidth = 1; ctx.stroke();
  if (o.coat) { ctx.strokeStyle = '#7ec8e8'; ctx.beginPath(); ctx.moveTo(x, by - 14); ctx.lineTo(x, by + 12); ctx.stroke(); ctx.fillStyle = '#35c8ff'; ctx.fillRect(x + 3 * f, by - 6, 3, 4); }
  // arms
  ctx.strokeStyle = '#4f9cc4'; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
  const wave = o.cheer ? -10 : Math.sin(t * 3) * 2;
  ctx.beginPath(); ctx.moveTo(x - 10, by - 4); ctx.lineTo(x - 15, by + 2 + wave); ctx.moveTo(x + 10, by - 4); ctx.lineTo(x + 15, by + 2 + (o.cheer ? -12 : -wave)); ctx.stroke();
  // head bubble
  const hg = ctx.createRadialGradient(x - 4, hy - 5, 1, x, hy, 13);
  hg.addColorStop(0, '#ffffff'); hg.addColorStop(0.5, o.head || '#bff6ff'); hg.addColorStop(1, shade(o.head || '#bff6ff', -0.25));
  ctx.fillStyle = hg; ctx.beginPath(); ctx.arc(x, hy, 12, 0, TAU); ctx.fill();
  ctx.strokeStyle = '#4f9cc4'; ctx.lineWidth = 1; ctx.stroke();
  if (o.goggles) {
    ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(x - 9, hy - 9, 4, 0, TAU); ctx.arc(x + 9, hy - 10, 4, 0, TAU); ctx.fill();
    ctx.fillStyle = '#7fe0ff'; for (const gx of [-5, 5]) { ctx.beginPath(); ctx.arc(x + gx, hy - 11, 3, 0, TAU); ctx.fill(); }
    ctx.strokeStyle = '#2f6f9c'; ctx.beginPath(); ctx.moveTo(x - 12, hy - 11); ctx.lineTo(x + 12, hy - 11); ctx.stroke();
  }
  // cartoon eyes (look toward the bench)
  const lx = o.look ? Math.sign(o.look[0] - x) : f;
  const blink = (t % 3.3) < 0.12;
  for (const ex of [-4, 4]) {
    ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.ellipse(x + ex, hy, 3.2, blink ? 0.6 : 3.8, 0, 0, TAU); ctx.fill();
    if (!blink) {
      ctx.fillStyle = '#0c2a44'; ctx.beginPath(); ctx.arc(x + ex + lx * 1.2, hy + 1, 2.1, 0, TAU); ctx.fill();
      ctx.fillStyle = '#ffffff'; ctx.fillRect(Math.round(x + ex + lx * 1.2 - 1), Math.round(hy - 1), 1, 1);
    }
  }
  ctx.strokeStyle = '#0c2a44'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(x + lx, hy + 5, o.cheer ? 3 : 2, 0.15, Math.PI - 0.15); ctx.stroke();
  ctx.fillStyle = rgba('#ffffff', 0.9); ctx.beginPath(); ctx.ellipse(x - 5, hy - 7, 3, 1.6, -0.5, 0, TAU); ctx.fill();
  ctx.restore();
}

// Old panel ids ('skills', 'research', 'shop', 'crafting', 'boatyard') open the Lab on a matching tab, but stay on
// the UI stack under their own id so ui.isOpen(alias) keeps working.
export class LabAlias {
  constructor(id, lab, defaults = {}) { this.id = id; this.lab = lab; this.defaults = defaults; this.modal = true; this.sound = 'ui_open'; }
  get rect() { return this.lab.rect; }
  get closeOnOutside() { return this.lab.closeOnOutside; }
  open(data) {
    this.lab.openId = this.id;
    const d = { ...this.defaults, ...(data || {}) };
    if (d.focus || d.highlight) delete d.tab;
    this.lab.open(d);
    this.lab.game?.emit?.('panelOpen', 'lab'); // listeners (desktop badge) know the Lab itself is open
  }
  close() { this.lab.close(); this.lab.openId = 'lab'; }
  draw(ctx, ui, dt) { this.lab.anim = this.anim; this.lab.draw(ctx, ui, dt); }
}

void damp; void drawAeroBubble; void drawSparkle;
