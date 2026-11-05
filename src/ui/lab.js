// The Lab panel (id 'lab'; old ids 'skills', 'research', 'shop', 'crafting', 'boatyard' are LabAlias wrappers).
// OWNER: Lab+Quests agent. Phase 6: laid out like the user's row-based skill-tree reference (images/10.jpg), in
// cute Frutiger Aero: a glossy header bar with a round eco-globe emblem and the title THE LAB, one horizontal row of
// framed glass tiles per branch (src/ui/labrows.js) on deep aqua glass, and a footer bar with the research benches,
// an "AERO LEFT" counter and Undo / Confirm (tiles are planned first, then confirmed). Professor Fizz cheers on
// from the corner. The Rods / Crafting / Boats tabs keep their views (src/ui/labviews.js).
//   ui.open('lab', {tab: 'tree'|'rods'|'craft'|'boats', focus: nodeId|'custombait'|'isp'|'rod:<id>'..., highlight, cat, recipe})
//   panel.research(id)  start one research now (tests / scripts)     panel.rows: the LabRows view (plan, confirm, undo)
//   panel.tileRect(id), panel.confirmRect   screen rects for pointers (tutorial)
import { clamp, TAU, hash1 } from '../core/math.js';
import { rgba, mix, shade } from '../core/color.js';
import { drawText, measureText } from '../gfx/font.js';
import { getUiIcon } from '../gfx/uiicons.js';
import { loadAlagard, alagardReady, alagardBitmap } from '../gfx/alagard.js';
import { aeroSurface, aeroCached, drawAeroCoin, fmtAero, drawAeroGlow, drawAeroBubble, drawAeroBadge, drawSparkle, drawLeafSprig, drawAeroBar } from './aero.js';
import * as CHAR from '../gfx/character.js';
import * as NPC from '../gfx/npcs.js';
import { LAB_NODES, LAB_BY_ID, BRANCHES, ensureLab, labSlots, labProgress, labRemaining, labFocus, startResearch, instantFinish, labTick, labReadyCount, fmtTime, planCost, planAfford, labTime } from '../game/lab.js';
import { ensureRods } from '../game/rods.js';
import { RECIPE_BY_ID, craft } from '../build/crafting.js';
import { ecoOrb, roundRectPath } from './labart.js';
import { iconBudget, icon, pill, INK, bucket } from './labkit.js';
import { labIconCached, labIcon } from './labicons.js';
import { LabRows, drawAnimIcon } from './labrows.js';
import { drawRodsView, drawRodCard, drawCraftView, drawCraftCard, drawBoatsView, drawBoatCard } from './labviews.js';

const TABS = [
  { id: 'tree', label: 'Research', icon: 'beaker' },
  { id: 'rods', label: 'Rods', icon: 'rod:glass' },
  { id: 'craft', label: 'Crafting', icon: 'hammer' },
  { id: 'boats', label: 'Boats', icon: 'boat:skiff' },
];
const TAB_ALIAS = { shop: 'craft', crafting: 'craft', research: 'tree', skills: 'tree', boatyard: 'boats', boat: 'boats', rod: 'rods' };
const HEAD = 32, FOOT = 38;

const LINES = {
  idle: ['Click a tile to plan it!', 'Then press Confirm!', 'Double-click: brew it now!', 'Chains? Unlock the tile before it.', 'More benches = more brewing!', 'Quests pay for science too!'],
  plan: ['Ooh, good pick!', 'Science!', 'Yes yes YES!', 'Bubbly choice!', 'I like it!'],
  undo: ['Changed your mind?', 'Back on the shelf!'],
  nope: ['Hmm, not yet...', 'We need more stuff!', 'Patience, bubble!'],
  confirm: ['To the beakers!', 'Eureka incoming!', 'Brewing now!'],
  done: ['EUREKA!', 'It worked!', 'Fizz-tastic!'],
};

export class LabPanel {
  constructor() {
    this.id = 'lab';
    this.openId = 'lab';
    this.modal = true;
    this.sound = 'ui_open';
    this.tab = 'tree';
    this.t = 0;
    this.rows = new LabRows(this);
    this.tree = this.rows; // older callers: panel.tree.focus(id)
    this.craftCat = 'building';
    this.recipeSel = null;
    this.rodSel = null;
    this.boatSel = null;
    this.craftFx = [];
    this.first = true;
    this.cheer = 0;
    this.speech = { text: LINES.idle[0], t: 0, kind: 'idle' };
    this.view = { x: 0, y: 0, w: 1, h: 1 };
    try { loadAlagard(); } catch { /* the title falls back to the pixel font */ }
  }

  open(data) {
    const d = data || {};
    const st = this.game.state;
    this.openedAt = performance.now();
    this.lastData = d;
    ensureLab(st);
    this.rodSel = ensureRods(st).equipped;
    this.boatSel = null;
    if (d.tab) this.setTab(TAB_ALIAS[d.tab] || d.tab, d);
    else if (this.first) this.tab = 'tree';
    this.prebuildGlyphs();
    const focus = labFocus(st, d.focus || d.highlight);
    if (focus) { this.tab = 'tree'; this.rows.focus(focus, { highlight: true }); this.say('focus'); }
    this.first = false;
  }

  close() {
    this.rows.drag = null;
    this.rows.pinned = null;
    // A HUD toggle can race a script that opened the Lab in the same click: a close within a few ms of opening reopens.
    if (performance.now() - (this.openedAt || 0) < 40 && !this.bounced) {
      this.bounced = true;
      const id = this.openId, d = this.lastData;
      setTimeout(() => { this.bounced = false; if (!this.ui?.isOpen?.(id)) this.ui?.open?.(id, d); }, 0);
    }
  }

  setTab(id, d = {}) {
    id = TAB_ALIAS[id] || id;
    if (!TABS.some((t) => t.id === id)) id = 'tree';
    this.tab = id;
    if (d.focus) { const f = labFocus(this.game.state, d.focus); if (f) this.rows.focus(f); }
    if (d.cat) this.craftCat = d.cat === 'special' ? 'bait' : d.cat;
    if (d.recipe && RECIPE_BY_ID[d.recipe]) { const c = RECIPE_BY_ID[d.recipe].cat; this.craftCat = c === 'special' ? 'bait' : c; this.recipeSel = d.recipe; }
  }

  say(kind) {
    if (kind === 'focus') { this.speech = { text: 'Start with this one!', t: 0, kind }; return; }
    const L = LINES[kind] || LINES.idle;
    this.speech = { text: L[Math.floor(Math.random() * L.length)], t: 0, kind };
  }

  // Starts one research right away (scripts, tests, the tutorial). The tiles plan + confirm instead.
  research(id) {
    const g = this.game;
    const r = startResearch(g, id);
    if (!r.ok) { g.audio.play('ui_error'); g.toast?.(r.reason, 'cross'); return false; }
    g.audio.play('ui_unlock');
    this.rows.plan = this.rows.plan.filter((q) => q !== id);
    this.rows.a(id).pop = 1;
    this.rows.burst(id, 'confirm');
    this.cheer = 1.6;
    this.say('confirm');
    return true;
  }

  finishNow(id) { return instantFinish(this.game, id); }
  craft(id, n = 1) { return craft(this.game, id, n); }
  tileRect(id) { return this.tab === 'tree' ? this.rows.tileRect(id) : null; }

  // Pixel-glyph icons are cheap: build them all at once so they never wait behind the slow voxel ones.
  prebuildGlyphs() {
    if (this.glyphsDone) return;
    this.glyphsDone = true;
    const keys = new Set([...LAB_NODES.map((nd) => nd.icon), 'beaker', 'hammer', 'star', 'clock', 'coin', 'eye', 'sonar', 'hook']);
    for (const k of keys) {
      if (k.includes(':')) continue;
      for (const px of [16, 24, 28]) { try { if (labIconCached(k, bucket(px)) === undefined) labIcon(k, bucket(px)); } catch { /* skip */ } }
    }
  }

  // Builds tile icons a few at a time while the game idles (build.js calls this), so the Lab opens instantly.
  warm(n = 3) {
    if (!this.warmList) this.warmList = [...LAB_NODES.flatMap((nd) => [[nd.icon, 28], [nd.icon, 24], [nd.icon, 16]]), ...TABS.map((tb) => [tb.icon, 16]), ['beaker', 24]];
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
    this.speech.t += dt;
    if (this.speech.t > 6 && this.speech.kind !== 'idle') this.speech = { text: LINES.idle[Math.floor(this.t / 7) % LINES.idle.length], t: 0, kind: 'idle' };
    else if (this.speech.kind === 'idle' && this.speech.t > 7) this.speech = { text: LINES.idle[Math.floor(this.t / 7) % LINES.idle.length], t: 0, kind: 'idle' };
    iconBudget(this.t < 0.2 ? 4 : 10);
    icon('beaker', 24); for (const tb of TABS) icon(tb.icon, 16); // the header first, then the tiles
    let done = [];
    try { done = labTick(g); } catch { /* ticked by game.build too */ }
    if (done.length) { this.cheer = 2; this.say('done'); }
    const Lo = this.layout();
    const { P, body, card, view, foot } = Lo;
    this.rect = P;
    this.view = view;
    if (ui.hover(P)) ui.markHot?.('lab');
    this.drawFrame(ctx, P);
    if (this.tab === 'tree') {
      this.rows.update(ui, body, dt);
      this.rows.draw(ctx, ui, body, dt);
    } else {
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
    if (this.tab === 'tree') this.rows.drawCard(ctx, ui);
    // swallow clicks/wheel on the panel so the world below never gets them
    if (ui.inp.pressed && ui.hover(P)) ui.inp.pressed = false;
    if (ui.hover(P) && ui.inp.wheel) ui.inp.wheel = 0;
    if (g.input.keyPressed('1')) this.setTab('tree');
    if (g.input.keyPressed('2')) this.setTab('rods');
    if (g.input.keyPressed('3')) this.setTab('craft');
    if (g.input.keyPressed('4')) this.setTab('boats');
    this.cheer = Math.max(0, this.cheer - dt);
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
    // a turning sparkle ring + the beaker bubbling on top
    for (let i = 0; i < 3; i++) { const a = t * 1.2 + (i / 3) * TAU; drawSparkle(ctx, ex + Math.cos(a) * (R - 1.5), ey + Math.sin(a) * (R - 1.5), 1, 0.8); }
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
    for (const tb of TABS) {
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

  // ------------------------------------------------------------------ footer: benches, AERO LEFT, Undo / Confirm
  drawFooter(ctx, ui, f) {
    const g = this.game, st = g.state, t = this.t;
    const L = ensureLab(st);
    ctx.drawImage(aeroSurface(f.w, f.h, { top: '#ffffff', mid: '#dff4fc', bot: '#a8d8f0', a: [0.98, 0.98], edge: '#2a6fa8', r: 9, gloss: 0.55, glossH: 12, curve: 2, rim: 0.9, glow: 0.5 }), f.x, f.y);
    // research benches (left): a capsule per bench with what brews + time left
    const slots = labSlots(st, g.stats);
    const bw = 104;
    let x = f.x + 8;
    for (let i = 0; i < slots; i++) {
      const s = L.slots[i];
      const nd = s && LAB_BY_ID[s.id];
      const r = { x, y: f.y + 5, w: bw, h: f.h - 10 };
      const hov = ui.hover(r);
      ctx.drawImage(aeroSurface(r.w, r.h, { tone: nd ? { top: '#fff8d8', mid: '#ffe08a', bot: '#ffb84a', edge: '#8a4a06', a: [1, 1] } : 'glass', r: 7, gloss: 0.6, glossH: 9, curve: 1, rim: 0.8, glow: 0.4, inset: !nd }), r.x, r.y);
      if (nd) {
        const k = labProgress(st, s.id);
        drawAeroGlow(ctx, r.x + 13, r.y + r.h / 2, 12, '#ffffff', 0.5 + 0.2 * Math.sin(t * 4 + i));
        drawAnimIcon(ctx, nd.icon, r.x + 13, r.y + r.h / 2, 18, t, i, {});
        drawText(ctx, nd.name.length > 13 ? nd.name.slice(0, 12) + '.' : nd.name, r.x + 26, r.y + 4, { font: 'small', color: '#5a3206' });
        drawAeroBar(ctx, r.x + 26, r.y + 12, r.w - 32, 5, k, { color: '#5fd23a' });
        drawText(ctx, fmtTime(labRemaining(st, s.id)), r.x + 26, r.y + 19, { font: 'small', color: '#8a4a06' });
        for (let j = 0; j < 2; j++) { const q = (t * 0.7 + j / 2 + i * 0.3) % 1; drawAeroBubble(ctx, r.x + 13 + Math.sin(t * 3 + j) * 3, r.y + 6 - q * 8, 1 + q, 1 - q); }
        if (hov) ui.tip = `${nd.name}: ${fmtTime(labRemaining(st, s.id))} left (click to find it)`;
      } else {
        const bk = icon('beaker', 18);
        if (bk) { ctx.globalAlpha = 0.55; ctx.drawImage(bk, Math.round(r.x + 13 - bk.width / 2), Math.round(r.y + r.h / 2 - bk.height / 2)); ctx.globalAlpha = 1; }
        drawText(ctx, 'FREE BENCH', r.x + 27, r.y + 11, { font: 'small', color: '#3c6f88' });
        if (hov) ui.tip = 'A free lab bench: plan research and Confirm';
      }
      if (ui.clicked(r)) { g.audio.play('ui_click'); this.setTab('tree'); if (nd) { this.rows.focus(nd.id); this.rows.pinned = nd.id; } }
      x += bw + 4;
    }
    if (L.queue.length) {
      const r = { x, y: f.y + 9, w: 44, h: f.h - 18 };
      ctx.drawImage(aeroSurface(r.w, r.h, { tone: 'purple', r: 'pill', gloss: 0.7, glossH: 8, curve: 1, rim: 0.8, glow: 0.5 }), r.x, r.y);
      const ci = getUiIcon('clock');
      if (ci) ctx.drawImage(ci, r.x + 5, Math.round(r.y + (r.h - ci.height) / 2));
      drawText(ctx, '+' + L.queue.length, r.x + 19, r.y + Math.round(r.h / 2) - 3, { color: '#ffffff', shadow: '#341670' });
      if (ui.hover(r)) ui.tip = `Queued: ${L.queue.map((q) => LAB_BY_ID[q.id]?.name).join(', ')}`;
      x += r.w + 4;
    }
    // right: Undo / Confirm
    const plan = this.rows.plan;
    const cbw = 108, ubw = 84, bh = f.h - 10;
    // keep clear of the guide seal's hint helper when it rests over the bottom right corner
    let right = f.x + f.w - 8;
    try { const hr = g.tutorial?.helperRect?.(); if (hr && hr.y + hr.h > f.y && hr.x < right && hr.x > f.x + f.w * 0.6) right = Math.round(hr.x - 6); } catch { /* optional */ }
    const cx = right - cbw, ux = cx - ubw - 6;
    this.confirmRect = { x: cx, y: f.y + 5, w: cbw, h: bh };
    if (pill(ui, ctx, ux, f.y + 5, ubw, bh, 'Undo', { tone: 'glass', icon: getUiIcon('arrow_l') || getUiIcon('cross'), disabled: !plan.length, tip: 'Undo the last pick (Backspace)' })) this.rows.undo();
    if (plan.length) drawAeroGlow(ctx, cx + cbw / 2, f.y + f.h / 2, cbw * 0.6, '#d6ff8a', 0.35 + 0.2 * Math.sin(t * 5));
    if (pill(ui, ctx, cx, f.y + 5, cbw, bh, 'Confirm', { tone: 'green', icon: getUiIcon('check'), disabled: !plan.length, tip: 'Start the planned research (Enter)', sound: 'ui_unlock' })) this.rows.confirm();
    if (plan.length) {
      drawAeroBadge(ctx, cx + cbw + 3, f.y + 1, plan.length, t);
      const ar = getUiIcon('arrow_d');
      if (ar) ctx.drawImage(ar, Math.round(cx + cbw / 2 - ar.width / 2), Math.round(f.y - ar.height - 3 - Math.abs(Math.sin(t * 5)) * 5));
    }
    // centre: the "points left" plate
    const pc = planCost(st, plan), left = Math.floor(st.coins || 0) - pc.aero;
    const pw = 210, px = Math.round(Math.max(x + 6, (x + ux) / 2 - pw / 2)), pr = { x: px, y: f.y + 4, w: Math.min(pw, ux - px - 8), h: f.h - 8 };
    if (pr.w > 120) {
      ctx.drawImage(aeroSurface(pr.w, pr.h, { top: '#0e3e64', mid: '#164e7e', bot: '#1f6a9c', a: [0.95, 0.95], edge: '#04223e', r: 7, gloss: 0.18, glossH: 8, curve: 1, rim: 0.5, glow: 0.5, glowColor: '#58c8ff', inset: true }), pr.x, pr.y);
      drawAeroCoin(ctx, pr.x + 15, pr.y + pr.h / 2, 7.5, t);
      const num = fmtAero(left);
      drawText(ctx, num, pr.x + 28, pr.y + 7, { scale: 2, color: left < 0 ? '#ff8a8a' : '#ffffff', shadow: '#04223e' });
      const nw = measureText(num, 'normal', 2);
      drawText(ctx, 'AERO LEFT', pr.x + 34 + nw, pr.y + 7, { color: '#bff6ff', shadow: '#04223e' });
      const sub = plan.length ? `${plan.length} PLANNED  ${fmtTime(plan.reduce((a, id) => a + labTime(st, LAB_BY_ID[id], g.stats), 0))}` : 'PICK TILES TO PLAN';
      drawText(ctx, sub, pr.x + 34 + nw, pr.y + 18, { font: 'small', color: plan.length ? '#d6ff8a' : '#7fb8d8' });
      if (ui.hover(pr)) {
        const af = planAfford(st, plan);
        const mats = af.items.map((it) => `${it.need} ${it.id.replace(/_/g, ' ')}`).join(', ');
        ui.tip = plan.length ? `Plan costs ${fmtAero(pc.aero)} Aero${mats ? ' + ' + mats : ''}` : 'Your Aero after the planned research';
      }
    }
  }

  // ------------------------------------------------------------------ Professor Fizz, cheering from the corner
  drawFizzCorner(ctx, ui, view, G) {
    if (!G.fizzW) return;
    const t = this.t;
    const x = view.x + view.w - G.fizzW / 2 - 4, feet = Math.round(view.y + view.h * 0.5);
    // a little glass ledge
    ctx.drawImage(aeroSurface(G.fizzW - 8, 10, { tone: 'clear', r: 'pill', gloss: 0.7, glossH: 4, curve: 1, rim: 0.8, glow: 0.6 }), Math.round(x - (G.fizzW - 8) / 2), Math.round(feet - 4));
    drawAeroGlow(ctx, x, feet - 30, 40, '#bff6ff', 0.25);
    const talk = this.speech.t < 1.6 ? 0.5 + 0.5 * Math.sin(t * 16) : 0;
    const cheer = this.cheer > 0;
    let drawn = false;
    if (NPC.NPCS?.fizz && typeof NPC.drawNPC === 'function' && !this.npcErr) {
      try {
        NPC.drawNPC(ctx, 'fizz', { x, y: feet, t, scale: 1.05, facing: -1, talk: talk > 0.5 ? talk : 0, mood: cheer ? 'excited' : 'happy', pose: cheer ? 'cheer' : talk ? 'talk' : (t % 6) < 3 ? 'idle' : 'think', id: 'lab-fizz', lookAt: [view.x + view.w * 0.4, view.y + view.h * 0.5], shadow: false });
        drawn = true;
      } catch (e) { this.npcErr = true; console.error(e); }
    }
    if (!drawn) drawBubblePerson(ctx, x, feet, t, { body: '#ffffff', head: '#9effd2', coat: true, goggles: true, cheer, facing: -1 });
    // the speech bubble
    const txt = this.speech.text;
    const lines = txt.length > 14 ? splitTwo(txt) : [txt];
    const bw = Math.max(...lines.map((l) => measureText(l, 'small'))) + 12, bh = lines.length * 8 + 8;
    const k = Math.min(1, this.speech.t * 5);
    const bx = Math.round(clamp(x - bw / 2, view.x + view.w - G.fizzW - 30, view.x + view.w - bw - 4)), byy = Math.round(feet - 104 - bh + (1 - k) * 6);
    ctx.globalAlpha = k;
    ctx.drawImage(aeroSurface(bw, bh, { tone: 'white', r: 6, gloss: 0.5, glossH: 6, curve: 1, rim: 0.8, glow: 0.3 }), bx, byy);
    ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.moveTo(x - 3, byy + bh - 1); ctx.lineTo(x + 4, byy + bh - 1); ctx.lineTo(x + 1, byy + bh + 5); ctx.closePath(); ctx.fill();
    lines.forEach((l, i) => drawText(ctx, l, bx + 6, byy + 5 + i * 8, { font: 'small', color: INK }));
    ctx.globalAlpha = 1;
    if (cheer) for (let i = 0; i < 5; i++) { const a = t * 3 + i * 1.3; drawSparkle(ctx, x + Math.cos(a) * 22, feet - 50 + Math.sin(a) * 18, 2, 0.8, i % 2 ? '#fff6a0' : '#ffffff'); }
    void ui;
  }
}

function splitTwo(s) {
  const w = s.split(' ');
  let best = [s], bd = 1e9;
  for (let i = 1; i < w.length; i++) { const a = w.slice(0, i).join(' '), b = w.slice(i).join(' '); const d = Math.abs(a.length - b.length); if (d < bd) { bd = d; best = [a, b]; } }
  return best;
}

// A simple glossy bubble person (fallback while the character / NPC art is not available).
export function drawBubblePerson(ctx, x, feet, t, o = {}) {
  const f = o.facing || 1;
  const hop = o.cheer ? Math.abs(Math.sin(t * 8)) * 4 : Math.sin(t * 2) * 0.8;
  const by = feet - 20 - hop, hy = by - 26;
  ctx.save();
  const bg = ctx.createRadialGradient(x - 4, by - 6, 1, x, by, 14);
  bg.addColorStop(0, '#ffffff'); bg.addColorStop(1, o.body || '#7fd8ff');
  ctx.fillStyle = bg; ctx.beginPath(); ctx.ellipse(x, by, 12, 15, 0, 0, TAU); ctx.fill();
  ctx.strokeStyle = '#4f9cc4'; ctx.lineWidth = 1; ctx.stroke();
  if (o.coat) { ctx.strokeStyle = '#7ec8e8'; ctx.beginPath(); ctx.moveTo(x, by - 14); ctx.lineTo(x, by + 12); ctx.stroke(); ctx.fillStyle = '#35c8ff'; ctx.fillRect(x + 3 * f, by - 6, 3, 4); }
  ctx.strokeStyle = '#4f9cc4'; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
  const wave = o.cheer ? -10 : Math.sin(t * 3) * 2;
  ctx.beginPath(); ctx.moveTo(x - 10, by - 4); ctx.lineTo(x - 15, by + 2 + wave); ctx.moveTo(x + 10, by - 4); ctx.lineTo(x + 15, by + 2 + (o.cheer ? -12 : -wave)); ctx.stroke();
  const hg = ctx.createRadialGradient(x - 4, hy - 5, 1, x, hy, 13);
  hg.addColorStop(0, '#ffffff'); hg.addColorStop(0.5, o.head || '#bff6ff'); hg.addColorStop(1, shade(o.head || '#bff6ff', -0.25));
  ctx.fillStyle = hg; ctx.beginPath(); ctx.arc(x, hy, 12, 0, TAU); ctx.fill();
  ctx.strokeStyle = '#4f9cc4'; ctx.lineWidth = 1; ctx.stroke();
  if (o.goggles) {
    ctx.fillStyle = '#7fe0ff'; for (const gx of [-5, 5]) { ctx.beginPath(); ctx.arc(x + gx, hy - 11, 3, 0, TAU); ctx.fill(); }
    ctx.strokeStyle = '#2f6f9c'; ctx.beginPath(); ctx.moveTo(x - 12, hy - 11); ctx.lineTo(x + 12, hy - 11); ctx.stroke();
  }
  const lx = o.look ? Math.sign(o.look[0] - x) : f;
  const blink = (t % 3.3) < 0.12;
  for (const ex of [-4, 4]) {
    ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.ellipse(x + ex, hy, 3.2, blink ? 0.6 : 3.8, 0, 0, TAU); ctx.fill();
    if (!blink) { ctx.fillStyle = '#0c2a44'; ctx.beginPath(); ctx.arc(x + ex + lx * 1.2, hy + 1, 2.1, 0, TAU); ctx.fill(); ctx.fillStyle = '#ffffff'; ctx.fillRect(Math.round(x + ex + lx * 1.2 - 1), Math.round(hy - 1), 1, 1); }
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
    this.lab.game?.emit?.('panelOpen', 'lab');
  }
  close() { this.lab.close(); this.lab.openId = 'lab'; }
  draw(ctx, ui, dt) { this.lab.anim = this.anim; this.lab.draw(ctx, ui, dt); }
}

void hash1; void mix; void BRANCHES; void CHAR;
