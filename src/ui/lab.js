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
import { ecoOrb, drawRays, roundRectPath } from './labart.js';
import { voxBudget, roomChunk, floorChunk, ROOM_CHUNK, windowView, windowFrame, bench, flask, pipe, shelf, clock, plant, sprig, drawPiece } from './labvox.js';
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
    this.openedAt = performance.now();
    this.lastData = d;
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

  close() {
    this.tree.drag = null;
    // A desktop icon toggle can race a script that opened the Lab in the same click (the tutorial opens it from
    // 'iconOpen', then the icon toggles it shut). A close within a few ms of opening is that race: reopen.
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
    voxBudget(14);
    this.drawRoom(ctx, Lo);
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

  // ------------------------------------------------------------------ room pieces (voxel models, src/ui/labvox.js)
  roomOpts(Lo) {
    const bodyH = Lo.P.h - Lo.HEAD;
    return { h: bodyH, tileY: Math.round(bodyH * 0.6), floorY: Math.round(bodyH * 0.88) };
  }

  // Builds missing scenery a piece at a time (called while idle so the Lab opens with everything ready).
  warm(ms = 4) {
    voxBudget(ms);
    const Lo = this.layout(), ro = this.roomOpts(Lo);
    const reqs = [
      () => roomChunk(ro.h, ro), () => floorChunk(ro.h - ro.floorY), () => windowView(Lo.win.w, Lo.win.h), () => windowFrame(Lo.win.w, Lo.win.h),
      () => bench(Lo.lw - 16), () => pipe(this.pipeGeom(Lo).h, this.pipeGeom(Lo).len), () => shelf(Math.round(Lo.win.w * 0.62)), () => clock(), () => plant(),
      ...LEAVES.map((l) => () => sprig(l.len, l.ang, l.seed)), () => flask('md', 0.15, '#9fe0f8'),
    ];
    for (const r of reqs) if (!r()) return true;
    return false;
  }

  // the glass pipe rises from behind the bench up to just under the window shelf, then runs into the dome
  pipeGeom(Lo) {
    const { P, win, lw, dome } = Lo;
    const x0 = P.x + lw - 24, y0 = P.y + win.y + win.h + 24;
    return { x0, y0, h: P.y + P.h - 64 - y0 + 4, len: dome.x - x0 + 6 };
  }
  pipeH(Lo) { return this.pipeGeom(Lo).h; }

  drawRoom(ctx, Lo) {
    const { P, HEAD, win } = Lo;
    const ro = this.roomOpts(Lo);
    const top = P.y + HEAD;
    const ch = roomChunk(ro.h, ro);
    if (ch?.canvas) for (let x = P.x; x < P.x + P.w; x += ROOM_CHUNK) ctx.drawImage(ch.canvas, x - 1, top - 1);
    else { ctx.fillStyle = '#eef9ff'; ctx.fillRect(P.x, top, P.w, ro.floorY); }
    const fl = floorChunk(ro.h - ro.floorY);
    if (fl?.canvas) for (let x = P.x; x < P.x + P.w; x += ROOM_CHUNK) ctx.drawImage(fl.canvas, x - 1, top + ro.floorY - 2);
    else { ctx.fillStyle = '#c8ecf8'; ctx.fillRect(P.x, top + ro.floorY, P.w, ro.h - ro.floorY); }
    // the window: eco world outside, sun rays + glass glints (2D light), voxel frame
    const wx = P.x + win.x, wy = P.y + win.y;
    const v = windowView(win.w, win.h);
    ctx.save();
    ctx.beginPath(); ctx.rect(wx, wy, win.w, win.h); ctx.clip();
    if (v?.canvas) {
      drawPiece(ctx, v, wx, wy, 0, v.ny, 0);
      if (v.sun) {
        const [sx, sy] = v.project(...v.sun), [ox, oy] = v.project(0, v.ny, 0);
        drawRays(ctx, wx + sx - ox, wy + sy - oy, win.w * 1.1, this.t, 0.22, 16);
      }
    } else { ctx.fillStyle = '#5cb8fa'; ctx.fillRect(wx, wy, win.w, win.h); }
    ctx.fillStyle = rgba('#ffffff', 0.16);
    ctx.beginPath(); ctx.moveTo(wx, wy); ctx.lineTo(wx + win.w * 0.35, wy); ctx.lineTo(wx, wy + win.h * 0.55); ctx.closePath(); ctx.fill();
    ctx.restore();
    const f = windowFrame(win.w, win.h);
    if (f?.canvas) drawPiece(ctx, f, wx, wy, f.inner.x0, f.inner.y1 + 1, 0);
    // sunlight falling into the room (2D light)
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const lg = ctx.createLinearGradient(wx, wy + win.h, wx + win.w * 1.2, P.y + P.h);
    lg.addColorStop(0, rgba('#fffbe0', 0.2)); lg.addColorStop(1, rgba('#fffbe0', 0));
    ctx.fillStyle = lg;
    ctx.beginPath(); ctx.moveTo(wx + win.w * 0.1, wy + win.h + 6); ctx.lineTo(wx + win.w * 0.95, wy + win.h + 6); ctx.lineTo(wx + win.w * 1.9, P.y + P.h); ctx.lineTo(wx + win.w * 0.55, P.y + P.h); ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  drawDomeFrame(ctx, d) {
    ctx.save();
    ctx.fillStyle = rgba('#0a4a7a', 0.18); roundRectPath(ctx, d.x + 2, d.y + 4, d.w, d.h, 16); ctx.fill();
    const fg = ctx.createLinearGradient(0, d.y, 0, d.y + d.h);
    fg.addColorStop(0, '#ffffff'); fg.addColorStop(0.5, '#e4f4fc'); fg.addColorStop(1, '#c4e4f4');
    ctx.fillStyle = fg; roundRectPath(ctx, d.x, d.y, d.w, d.h, 16); ctx.fill();
    ctx.strokeStyle = '#6fb4d8'; ctx.lineWidth = 1; roundRectPath(ctx, d.x + 0.5, d.y + 0.5, d.w - 1, d.h - 1, 16); ctx.stroke();
    ctx.strokeStyle = rgba('#ffffff', 1); roundRectPath(ctx, d.x + 1.5, d.y + 1.5, d.w - 3, d.h - 3, 15); ctx.stroke();
    ctx.restore();
  }

  drawWallPipes(ctx, Lo) {
    const busy = ensureLab(this.game.state).slots.length > 0;
    const t = this.t;
    const { x0, y0, h, len } = this.pipeGeom(Lo);
    const p = pipe(h, len);
    if (!p?.canvas) return;
    drawPiece(ctx, p, x0, y0, 0, p.ny, 3);
    // bubbles rising up the column and racing along the top into the dome (2D effect)
    const n = busy ? 7 : 2;
    for (let i = 0; i < n; i++) {
      const k = (t * (busy ? 0.35 : 0.12) + i / n) % 1;
      const up = h * 0.86;
      const along = k < 0.8 ? null : (k - 0.8) / 0.2;
      const bx = along === null ? x0 + 7 + Math.sin(t * 4 + i) * 1.2 : x0 + 7 + along * (len - 4);
      const by = along === null ? y0 + h - 12 - (k / 0.8) * (up - 6) : y0 + 7;
      drawAeroBubble(ctx, bx, by, busy ? 1.8 : 1.4, 0.9);
    }
  }

  drawShelf(ctx, Lo) {
    const { P, win } = Lo;
    const t = this.t;
    const sy = P.y + win.y + win.h + 52;
    const sx = P.x + 12, sw = win.w;
    const s = shelf(Math.round(sw * 0.62));
    if (s?.canvas) drawPiece(ctx, s, sx, sy, 0, 2, 7);
    for (let i = 0; i < 3; i++) { const k = (t * 0.4 + i / 3) % 1; drawAeroBubble(ctx, sx + 12 + i * 34 + Math.sin(t * 2 + i) * 2, sy - 22 - k * 16, 1 + k, 1 - k); }
    const pl = plant();
    if (pl?.canvas) drawPiece(ctx, pl, sx + sw - 26, sy + 2, 15, 0, 10);
    const room = P.y + P.h - 64 - 84 - (sy + 10);
    const ck = clock();
    if (ck?.canvas && room > 30) drawPiece(ctx, ck, sx + sw * 0.3, sy + 16 + Math.min(30, room / 2), 8.5, 8.5, 2);
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
    // bench (voxel): its worktop surface sits at benchTop
    const b = bench(bw);
    if (b?.canvas) drawPiece(ctx, b, bx - 4, benchTop, 0, b.top, b.front * 0.5);
    else { ctx.fillStyle = '#f4fbff'; ctx.fillRect(bx, benchTop, bw, 54); }
    // research benches = voxel flasks on the counter (+ 2D bubbles and steam)
    const slots = labSlots(st, g.stats);
    const sp = (bw - 24) / Math.max(1, slots);
    for (let i = 0; i < slots; i++) {
      const s = L.slots[i];
      const nd = s && LAB_BY_ID[s.id];
      const fx = bx + 12 + sp * (i + 0.5);
      const col = nd ? mix(BRANCHES[nd.branch]?.color || '#35c8ff', '#4fd2ff', 0.25) : '#9fe0f8';
      const k = nd ? labProgress(st, s.id) : 0;
      if (nd) drawAeroGlow(ctx, fx, flaskY - 12, 22, col, 0.45 + 0.15 * Math.sin(t * 4 + i));
      const fl = flask('md', nd ? 0.25 + 0.7 * k : 0.15, col);
      if (fl?.canvas) drawPiece(ctx, fl, fx, flaskY + 1, fl.c, 0, fl.c);
      if (nd) {
        for (let j = 0; j < 3; j++) { const q = (t * 0.7 + j / 3) % 1; drawAeroBubble(ctx, fx + Math.sin(t * 2 + j * 2) * 3 * q, flaskY - 34 - q * 14, 1 + q * 1.4, 1 - q); }
        const ic = icon(nd.icon, 14);
        if (ic) ctx.drawImage(ic, Math.round(fx - ic.width / 2), Math.round(flaskY - 52 + Math.sin(t * 2 + i) * 2));
      }
      const rr = { x: fx - 14, y: flaskY - 50, w: 28, h: 52 };
      if (ui.hover(rr)) ui.tip = nd ? `${nd.name}: ${fmtTime(labRemaining(st, s.id))}` : 'Free bench';
      if (ui.clicked(rr)) { this.setTab('tree'); if (nd) this.tree.focus(nd.id); else this.tree.sel = 'core'; }
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

  // glossy voxel leaf sprigs framing the panel (they grow from just outside its edges)
  drawLeaves(ctx, P) {
    for (const l of LEAVES) {
      const sp = sprig(l.len, l.ang, l.seed);
      if (!sp?.canvas) continue;
      const y = P.y + P.h * l.ay + Math.sin(this.t * 0.9 + l.seed) * 1;
      drawPiece(ctx, sp, Math.round(l.right ? P.x + P.w + l.dx : P.x + l.dx), Math.round(y), ...sp.anchor);
    }
  }
}

// leaf sprigs: len px, growth angle (deg, 0 = right, 90 = down), anchor (dx from the left or right edge, ay of height)
const LEAVES = [
  { len: 104, ang: -84, seed: 3, dx: 2, ay: 0.72 },
  { len: 80, ang: -14, seed: 5, dx: -4, ay: 0.99 },
  { len: 84, ang: 100, seed: 7, dx: -2, ay: 0.52, right: true },
  { len: 70, ang: 150, seed: 9, dx: 2, ay: 0.12, right: true },
];

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
