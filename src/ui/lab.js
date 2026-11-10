// The Lab panel (id 'lab'; old ids 'skills', 'research', 'shop', 'crafting', 'boatyard' are LabAlias wrappers).
// OWNER: Lab agent. Phase 7/8: the Research tab is ONE tree that grows out of the middle (src/ui/labtree.js): a big
// zoomed-in camera, fog of war (black silhouettes for what you cannot unlock yet), a glossy detail card with a direct
// Research button. The footer holds the research benches + queue and the branch focus buttons. The Rods / Crafting /
// Boats tabs keep their views (src/ui/labviews.js); Crafting hides itself once the Workshop panel exists
// (ui.panels.workshop) and craft requests go there instead.
//   ui.open('lab', {tab: 'tree'|'rods'|'craft'|'boats', focus: nodeId|'custombait'|'isp'|'rod:<id>'..., highlight, cat, recipe})
//   panel.research(id)  start one research now (tests / scripts)     panel.tree (alias panel.rows): the LabTree view
//   panel.tileRect(id), panel.confirmRect (the card's Research button)   screen rects for pointers (tutorial)
import { clamp, TAU, hash1 } from '../core/math.js';
import { rgba, mix, shade } from '../core/color.js';
import { drawText, measureText } from '../gfx/font.js';
import { getUiIcon } from '../gfx/uiicons.js';
import { loadAlagard, alagardReady, alagardBitmap } from '../gfx/alagard.js';
import { aeroSurface, aeroCached, drawAeroCoin, fmtAero, drawAeroGlow, drawAeroBubble, drawAeroBadge, drawSparkle, drawLeafSprig, drawAeroBar, toneFrom } from './aero.js';
import * as CHAR from '../gfx/character.js';
import * as NPC from '../gfx/npcs.js';
import { LAB_NODES, LAB_BY_ID, BRANCHES, BRANCH_ORDER, ensureLab, labSlots, labProgress, labRemaining, labFocus, startResearch, instantFinish, labTick, labReadyCount, labCheck, labStatus, fmtTime } from '../game/lab.js';
import { ensureRods } from '../game/rods.js';
import { RECIPE_BY_ID, craft } from '../build/crafting.js';
import { ecoOrb, roundRectPath } from './labart.js';
import { iconBudget, icon, pill, INK, bucket } from './labkit.js';
import { labIconCached, labIcon } from './labicons.js';
import { drawAnimIcon } from './labrows.js';
import { LabTree } from './labtree.js';
import { drawRodsView, drawRodCard, drawCraftView, drawCraftCard, drawBoatsView, drawBoatCard } from './labviews.js';

const TABS = [
  { id: 'tree', label: 'Research', icon: 'beaker' },
  { id: 'rods', label: 'Rods', icon: 'rod:glass' },
  { id: 'craft', label: 'Crafting', icon: 'hammer' },
  { id: 'boats', label: 'Boats', icon: 'boat:skiff' },
];
const TAB_ALIAS = { shop: 'craft', crafting: 'craft', research: 'tree', skills: 'tree', boatyard: 'boats', boat: 'boats', rod: 'rods' };
const HEAD = 32, FOOT = 40;

export class LabPanel {
  constructor() {
    this.id = 'lab';
    this.openId = 'lab';
    this.modal = true;
    this.sound = 'ui_open';
    this.tab = 'tree';
    this.t = 0;
    this.tree = new LabTree(this);
    this.rows = this.tree; // older callers / the tutorial: panel.rows.plan, panel.tree.focus(id)
    this.craftCat = 'building';
    this.recipeSel = null;
    this.rodSel = null;
    this.boatSel = null;
    this.craftFx = [];
    this.first = true;
    this.confirmRect = null;
    this.view = { x: 0, y: 0, w: 1, h: 1 };
    try { loadAlagard(); } catch { /* the title falls back to the pixel font */ }
  }

  // The Workshop (Progression agent) takes over crafting once it exists.
  hasWorkshop() { return !!this.game?.ui?.panels?.workshop; }
  tabs() { return this.hasWorkshop() ? TABS.filter((t) => t.id !== 'craft') : TABS; }
  openCraft(recipe) {
    if (this.hasWorkshop()) { this.ui?.close?.(this.openId); this.game.ui.open('workshop', recipe ? { recipe } : {}); return; }
    this.setTab('craft', { recipe });
  }

  open(data) {
    const d = data || {};
    const st = this.game.state;
    this.openedAt = performance.now();
    this.lastData = d;
    ensureLab(st);
    this.rodSel = ensureRods(st).equipped;
    this.boatSel = null;
    this.tree.fresh = true;
    if (this.first) this.tree.pending.home = true;
    if (d.tab) this.setTab(TAB_ALIAS[d.tab] || d.tab, d);
    else if (this.first) this.tab = 'tree';
    this.prebuildGlyphs();
    const focus = labFocus(st, d.focus || d.highlight);
    if (focus) { this.tab = 'tree'; this.tree.pending.focus = { id: focus, highlight: true }; }
    this.first = false;
  }

  close() {
    this.tree.drag = null;
    // A HUD toggle can race a script that opened the Lab in the same click: a close within a few ms of opening reopens.
    if (performance.now() - (this.openedAt || 0) < 40 && !this.bounced) {
      this.bounced = true;
      const id = this.openId, d = this.lastData;
      setTimeout(() => { this.bounced = false; if (!this.ui?.isOpen?.(id)) this.ui?.open?.(id, d); }, 0);
    }
  }

  setTab(id, d = {}) {
    id = TAB_ALIAS[id] || id;
    if (id === 'craft' && this.hasWorkshop()) { this.openCraft(d.recipe); return; }
    if (!TABS.some((t) => t.id === id)) id = 'tree';
    this.tab = id;
    if (d.focus) { const f = labFocus(this.game.state, d.focus); if (f) this.tree.pending.focus = { id: f, highlight: true }; }
    if (d.cat) this.craftCat = d.cat === 'special' ? 'bait' : d.cat;
    if (d.recipe && RECIPE_BY_ID[d.recipe]) { const c = RECIPE_BY_ID[d.recipe].cat; this.craftCat = c === 'special' ? 'bait' : c; this.recipeSel = d.recipe; }
  }

  // Starts one research right away (the card's Research button, scripts, tests, the tutorial).
  research(id) {
    const g = this.game;
    const r = startResearch(g, id);
    if (!r.ok) { g.audio.play('ui_error'); g.toast?.(r.reason, 'cross'); this.tree.a(id).shake = 1; return false; }
    g.audio.play('ui_unlock');
    g.audio.play('bubbles', { vol: 0.6 });
    this.tree.a(id).pop = 1;
    this.tree.burst(id, 'start');
    return true;
  }

  finishNow(id) { return instantFinish(this.game, id); }
  craft(id, n = 1) { return craft(this.game, id, n); }
  tileRect(id) { return this.tab === 'tree' ? this.tree.tileRect(id) : null; }

  // Pixel-glyph icons are cheap: build them all at once so they never wait behind the slow voxel ones.
  prebuildGlyphs() {
    if (this.glyphsDone) return;
    this.glyphsDone = true;
    const keys = new Set([...LAB_NODES.map((nd) => nd.icon), 'beaker', 'hammer', 'star', 'clock', 'coin', 'eye', 'sonar', 'hook']);
    for (const k of keys) {
      if (k.includes(':')) continue;
      for (const px of [16, 32, 40]) { try { if (labIconCached(k, bucket(px)) === undefined) labIcon(k, bucket(px)); } catch { /* skip */ } }
    }
  }

  // Builds node icons a few at a time while the game idles (build.js calls this), so the Lab opens instantly.
  // Only revealed nodes ever show their icon (fog of war), so the frontier goes first.
  warm(n = 3) {
    if (!this.warmList) {
      const st = this.game?.state;
      const rank = (nd) => { try { return labStatus(st, nd.id) === 'locked' ? 1 : 0; } catch { return 1; } };
      const order = [...LAB_NODES].sort((a, b) => rank(b) - rank(a) || b.depth - a.depth);
      this.warmList = [...order.flatMap((nd) => [[nd.icon, 40], [nd.icon, 32], [nd.icon, 16]]), ...TABS.map((tb) => [tb.icon, 16]), ['beaker', 56], ['beaker', 24]];
    }
    let built = 0;
    const t0 = performance.now();
    while (this.warmList.length && built < n && performance.now() - t0 < 6) {
      const [k, px] = this.warmList.pop();
      if (labIconCached(k, bucket(px)) === undefined) { try { labIcon(k, bucket(px)); } catch { /* skip */ } built++; }
    }
    return this.warmList.length > 0;
  }

  layout() {
    const g = this.game, W = g.screen.W, H = g.screen.H;
    const pw = Math.min(W - 16, 944), ph = Math.min(H - 8, 534);
    const P = { x: Math.round((W - pw) / 2), y: Math.round((H - ph) / 2) + 2, w: pw, h: ph };
    const body = { x: P.x + 8, y: P.y + HEAD + 3, w: P.w - 16, h: P.h - HEAD - FOOT - 5 };
    const cardW = clamp(Math.round(body.w * 0.26), 184, 230);
    const card = { x: body.x + body.w - cardW - 6, y: body.y + 6, w: cardW, h: body.h - 12 };
    const view = { x: body.x + 6, y: body.y + 6, w: body.w - cardW - 18, h: body.h - 12 };
    const foot = { x: P.x + 8, y: P.y + P.h - FOOT - 2, w: P.w - 16, h: FOOT - 4 };
    return { P, body, card, view, foot };
  }

  // ------------------------------------------------------------------ frame
  draw(ctx, ui, dt) {
    const g = this.game;
    dt = Math.max(0, Math.min(dt, 0.1));
    this.t += dt;
    if (this.tab === 'craft' && this.hasWorkshop()) this.tab = 'tree';
    iconBudget(this.t < 0.2 ? 4 : 10);
    icon('beaker', 24); for (const tb of this.tabs()) icon(tb.icon, 16); // the header first, then the tiles
    try { labTick(g); } catch { /* ticked by game.build too */ }
    const Lo = this.layout();
    const { P, body, card, view, foot } = Lo;
    this.rect = P;
    this.view = view;
    if (ui.hover(P)) ui.markHot?.('lab');
    this.drawFrame(ctx, P);
    if (this.tab === 'tree') {
      this.tree.update(ui, body, dt);
      this.tree.draw(ctx, ui, body, dt);
    } else {
      this.confirmRect = null;
      ctx.save();
      ctx.drawImage(aeroSurface(body.w, body.h, { top: '#2a8fe0', mid: '#1468c0', bot: '#0b4a90', a: [0.9, 0.92], edge: '#06305e', r: 8, gloss: 0.15, rim: 0.5, glow: 0.4, glowColor: '#58c8ff' }), body.x, body.y);
      ctx.restore();
      if (this.tab === 'rods') { drawRodsView(ctx, ui, this, view); drawRodCard(ctx, ui, this, card); }
      else if (this.tab === 'craft') { drawCraftView(ctx, ui, this, view); drawCraftCard(ctx, ui, this, card); }
      else if (this.tab === 'boats') { drawBoatsView(ctx, ui, this, view); drawBoatCard(ctx, ui, this, card); }
    }
    for (const f of this.craftFx) f.t += dt;
    this.craftFx = this.craftFx.filter((f) => f.t < 0.9);
    this.drawFooter(ctx, ui, foot);
    this.drawHeader(ctx, ui, P);
    if (this.tab === 'tree') this.tree.drawCard(ctx, ui);
    // swallow clicks/wheel on the panel so the world below never gets them
    if (ui.inp.pressed && ui.hover(P)) ui.inp.pressed = false;
    if (ui.hover(P) && ui.inp.wheel) ui.inp.wheel = 0;
    const tabs = this.tabs();
    for (let i = 0; i < tabs.length; i++) if (g.input.keyPressed(String(i + 1))) this.setTab(tabs[i].id);
  }

  // glossy chrome-and-glass outer frame with eco leaves at the corners
  drawFrame(ctx, P) {
    ctx.fillStyle = rgba('#021a38', 0.3); roundRectPath(ctx, P.x + 3, P.y + 5, P.w, P.h, 14); ctx.fill();
    ctx.drawImage(aeroSurface(P.w, P.h, { top: '#f4fdff', mid: '#cdeefc', bot: '#8fd0f0', a: [0.97, 0.97], edge: '#0b4f8f', r: 14, gloss: 0.45, glossH: 24, curve: 3, rim: 0.95, glow: 0.6, glowColor: '#ffffff', streak: true, bubbles: 4, seed: 23 }), P.x, P.y);
    drawLeafSprig(ctx, P.x + P.w - 4, P.y + P.h - 6, 'br', 1);
    drawLeafSprig(ctx, P.x + 4, P.y + P.h - 6, 'bl', 0.85);
  }

  // ------------------------------------------------------------------ header: emblem, THE LAB, tabs, Aero, close
  drawHeader(ctx, ui, P) {
    const g = this.game, st = g.state, t = this.t;
    const bx = P.x + 6, by = P.y + 4, bw = P.w - 12, bh = HEAD - 4;
    ctx.drawImage(aeroSurface(bw, bh, { top: '#c8f4ff', mid: '#3cb8f4', bot: '#136cc4', a: [1, 1], edge: '#0a3f7a', r: 9, gloss: 0.75, glossH: 13, curve: 3, rim: 0.9, glow: 0.7, glowColor: '#8ff6ff', streak: true, sparkle: 0 }), bx, by);
    // the round emblem (an eco globe in a chrome ring) overlapping the bar, like the reference's medallion
    const ex = P.x + 28, ey = P.y + 17, R = 23;
    drawAeroGlow(ctx, ex, ey, R + 14, '#ffffff', 0.45 + 0.1 * Math.sin(t * 2));
    ctx.drawImage(aeroCached(`labemblem|${R}`, () => {
      const S = R * 2 + 6, c = document.createElement('canvas'); c.width = S; c.height = S;
      const g2 = c.getContext('2d'); g2.imageSmoothingEnabled = false;
      const cx = S / 2;
      const rg = g2.createLinearGradient(0, 0, 0, S);
      rg.addColorStop(0, '#ffffff'); rg.addColorStop(0.45, '#cfe6f4'); rg.addColorStop(0.55, '#8fb4cc'); rg.addColorStop(1, '#e8f6ff');
      g2.fillStyle = '#0a3f7a'; g2.beginPath(); g2.arc(cx, cx, R + 2, 0, TAU); g2.fill();
      g2.fillStyle = rg; g2.beginPath(); g2.arc(cx, cx, R + 1, 0, TAU); g2.fill();
      // little bubble studs around the ring
      for (let i = 0; i < 12; i++) { const a = (i / 12) * TAU; g2.fillStyle = 'rgba(255,255,255,0.95)'; g2.beginPath(); g2.arc(cx + Math.cos(a) * (R - 1.5), cx + Math.sin(a) * (R - 1.5), 1.1, 0, TAU); g2.fill(); }
      g2.fillStyle = '#0a3f7a'; g2.beginPath(); g2.arc(cx, cx, R - 4, 0, TAU); g2.fill();
      return c;
    }), Math.round(ex - R - 3), Math.round(ey - R - 3));
    const orb = ecoOrb(R - 5, '#4cc83a', 'done');
    ctx.drawImage(orb, Math.round(ex - orb.width / 2), Math.round(ey - orb.height / 2));
    // a twinkle + the beaker bubbling on top
    if (((t * 0.35) % 1) < 0.12) drawSparkle(ctx, ex + R * 0.55, ey - R * 0.6, 2, 1, '#fff6a0');
    drawAnimIcon(ctx, 'beaker', ex, ey + 1, 26, t, 0.5, { hover: 0.4 });
    for (let i = 0; i < 3; i++) { const q = (t * 0.5 + i / 3) % 1; drawAeroBubble(ctx, ex + Math.sin(t * 2 + i * 2) * 4, ey - 8 - q * 20, 1.2 + q * 1.4, 1 - q); }
    // the title
    let tx = ex + R + 10;
    const title = 'THE LAB';
    if (alagardReady()) {
      const key = 'labtitle';
      const bmp = aeroCached(key, () => {
        const w0 = alagardBitmap(title, { size: 22, color: '#ffffff' }), o = alagardBitmap(title, { size: 22, color: '#0a3a6e' });
        const c = document.createElement('canvas'); c.width = w0.width + 4; c.height = w0.height + 5;
        const g2 = c.getContext('2d');
        for (const [dx, dy] of [[0, 3], [1, 3], [2, 3], [0, 1], [2, 1], [1, 0], [1, 2], [0, 0], [2, 0], [0, 2], [2, 2]]) g2.drawImage(o, dx, dy);
        g2.drawImage(w0, 1, 1);
        return c;
      });
      ctx.drawImage(bmp, Math.round(tx), Math.round(by + bh / 2 - bmp.height / 2 + 1));
      tx += bmp.width + 12;
    } else {
      drawText(ctx, title, tx, by + 8, { scale: 2, color: '#ffffff', outline: '#0a3a6e' });
      tx += measureText(title, 'normal', 2) + 14;
    }
    // tabs
    for (const tb of this.tabs()) {
      const ic = icon(tb.icon, 16);
      const w = measureText(tb.label) + (ic ? ic.width : 16) + 30;
      const on = this.tab === tb.id;
      if (pill(ui, ctx, tx, by + 4, w, 22, tb.label, { tone: on ? 'green' : 'white', icon: ic, active: on })) this.setTab(tb.id);
      if (tb.id === 'tree') { const n = labReadyCount(st); if (n && !on) drawAeroBadge(ctx, tx + w + 2, by, n, t); }
      tx += w + 4;
    }
    // Aero + close
    const cw = 22, cx = P.x + P.w - cw - 12;
    const amt = fmtAero(st.coins);
    const aw = measureText(amt) + 30;
    const ax = cx - aw - 8;
    ctx.drawImage(aeroSurface(aw, 20, { tone: 'white', r: 'pill', gloss: 0.7, glossH: 9, curve: 1, rim: 0.8, glow: 0.4 }), ax, by + 5);
    drawAeroCoin(ctx, ax + 11, by + 15, 6, t);
    drawText(ctx, amt, ax + 21, by + 12, { color: INK });
    if (pill(ui, ctx, cx, by + 4, cw, 22, '', { tone: 'red', icon: getUiIcon('cross'), tip: 'Close (Esc)' })) ui.close(this.openId);
  }

  // ------------------------------------------------------------------ footer: research benches + queue | branch focus buttons
  drawFooter(ctx, ui, f) {
    const g = this.game, st = g.state, t = this.t;
    const L = ensureLab(st);
    ctx.drawImage(aeroSurface(f.w, f.h, { top: '#ffffff', mid: '#dff4fc', bot: '#a8d8f0', a: [0.98, 0.98], edge: '#2a6fa8', r: 7, gloss: 0.55, glossH: 12, curve: 2, rim: 0.9, glow: 0.5 }), f.x, f.y);
    // research benches (left): a capsule per bench with what brews + time left
    const slots = labSlots(st, g.stats);
    const bw = 136;
    let x = f.x + 6;
    for (let i = 0; i < slots; i++) {
      const s = L.slots[i];
      const nd = s && LAB_BY_ID[s.id];
      const r = { x, y: f.y + 4, w: bw, h: f.h - 8 };
      const hov = ui.hover(r);
      ctx.drawImage(aeroSurface(r.w, r.h, { tone: nd ? { top: '#fff8d8', mid: '#ffe08a', bot: '#ffb84a', edge: '#8a4a06', a: [1, 1] } : 'glass', r: 5, gloss: 0.6, glossH: 9, curve: 1, rim: 0.8, glow: 0.4, inset: !nd }), r.x, r.y);
      if (nd) {
        const k = labProgress(st, s.id);
        drawAnimIcon(ctx, nd.icon, r.x + 14, r.y + r.h / 2, 20, t, i, {});
        drawText(ctx, nd.name.length > 14 ? nd.name.slice(0, 13) + '.' : nd.name, r.x + 28, r.y + 3, { color: '#5a3206' });
        drawAeroBar(ctx, r.x + 28, r.y + 13, r.w - 34, 5, k, { color: '#5fd23a' });
        drawText(ctx, fmtTime(labRemaining(st, s.id)), r.x + 28, r.y + 20, { font: 'small', color: '#8a4a06' });
        for (let j = 0; j < 2; j++) { const q = (t * 0.7 + j / 2 + i * 0.3) % 1; drawAeroBubble(ctx, r.x + 14 + Math.sin(t * 3 + j) * 3, r.y + 7 - q * 8, 1 + q, 1 - q); }
        if (hov) ui.tip = `${nd.name}: ${fmtTime(labRemaining(st, s.id))} left (click to find it)`;
      } else {
        const bk = icon('beaker', 18);
        if (bk) { ctx.globalAlpha = 0.55; ctx.drawImage(bk, Math.round(r.x + 14 - bk.width / 2), Math.round(r.y + r.h / 2 - bk.height / 2)); ctx.globalAlpha = 1; }
        drawText(ctx, 'FREE BENCH', r.x + 30, r.y + Math.round(r.h / 2) - 3, { color: '#3c6f88' });
        if (hov) ui.tip = 'A free lab bench: pick a glowing tile and press Research';
      }
      if (ui.clicked(r)) { g.audio.play('ui_click'); this.setTab('tree'); if (nd) this.tree.focus(nd.id, { highlight: false }); }
      x += bw + 4;
    }
    if (L.queue.length) {
      const r = { x, y: f.y + 7, w: 48, h: f.h - 14 };
      ctx.drawImage(aeroSurface(r.w, r.h, { tone: 'purple', r: 5, gloss: 0.7, glossH: 8, curve: 1, rim: 0.8, glow: 0.5 }), r.x, r.y);
      const ci = getUiIcon('clock');
      if (ci) ctx.drawImage(ci, r.x + 5, Math.round(r.y + (r.h - ci.height) / 2));
      drawText(ctx, '+' + L.queue.length, r.x + 20, r.y + Math.round(r.h / 2) - 4, { font: 'big', color: '#ffffff', shadow: '#341670' });
      if (ui.hover(r)) ui.tip = `Queued: ${L.queue.map((q) => LAB_BY_ID[q.id]?.name).join(', ')}`;
      if (ui.clicked(r)) { this.setTab('tree'); this.tree.focus(L.queue[0].id, { highlight: false }); }
      x += r.w + 4;
    }
    // right: the branch focus buttons (glide the camera to that branch's frontier)
    let right = f.x + f.w - 6;
    try { const hr = g.tutorial?.helperRect?.(); if (hr && hr.y + hr.h > f.y && hr.x < right && hr.x > f.x + f.w * 0.5) right = Math.round(hr.x - 6); } catch { /* optional */ }
    const bs = f.h - 8, gap = 3;
    let bx = right - BRANCH_ORDER.length * (bs + gap);
    if (bx < x + 60) return;
    drawText(ctx, 'GO TO', bx - measureText('GO TO') - 6, f.y + Math.round(f.h / 2) - 3, { color: '#3c6f88' });
    for (const b of BRANCH_ORDER) {
      const B = BRANCHES[b];
      const r = { x: bx, y: f.y + 4, w: bs, h: bs };
      const hov = ui.hover(r);
      ctx.drawImage(aeroSurface(bs, bs, { tone: toneFrom(B.color), r: 5, gloss: 0.8, glossH: Math.round(bs * 0.45), curve: 1, rim: 0.85, glow: hov ? 0.9 : 0.5 }), r.x, r.y - (hov ? 1 : 0));
      const ic = icon(B.icon, 20);
      if (ic) ctx.drawImage(ic, Math.round(r.x + (bs - ic.width) / 2), Math.round(r.y + (bs - ic.height) / 2) - (hov ? 1 : 0));
      // how many can be researched right now in this branch
      let ready = 0, done = 0, all = 0;
      for (const nd of LAB_NODES) {
        if (nd.branch !== b) continue;
        all++;
        const s = labStatus(st, nd.id);
        if (s === 'done') done++;
        else if (s === 'available' && labCheck(st, nd, g.stats).paid) ready++;
      }
      if (ready) drawAeroBadge(ctx, r.x + bs + 2, r.y - 4, ready, t);
      if (hov) ui.tip = `${B.name}: ${done} / ${all} researched${ready ? `, ${ready} ready` : ''}`;
      if (ui.clicked(r)) { g.audio.play('ui_click', { pitch: 1.1 }); this.setTab('tree'); this.tree.focusBranch(b); }
      bx += bs + gap;
    }
  }
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
    this.lab.game?.emit?.('panelOpen', 'lab');
  }
  close() { this.lab.close(); this.lab.openId = 'lab'; }
  draw(ctx, ui, dt) { this.lab.anim = this.anim; this.lab.draw(ctx, ui, dt); }
}

void hash1; void mix; void rgba; void shade; void CHAR; void NPC; void drawSparkle; void drawLeafSprig;
