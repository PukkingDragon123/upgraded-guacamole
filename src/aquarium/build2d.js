// Build mode for the side-view tank (phase 10: building happens ONLY in the tank). A clean decorating mode:
//   - a catalog tray (bottom): tabs (All, Owned, Buildings, Nature, Ruins, Glow, Fun), voxel thumbnails, counts (tank
//     storage + Satchel), Aero prices, blueprints from The Lab / Workshop, or a padlock (research it / find it in crates)
//   - a ghost preview that snaps to the floor of the chosen depth plane (front / mid / back) or to the back glass
//     (wall pieces sit on a little stone ledge); Q / E or the wheel change the plane, F flips
//   - select a piece and drag it to move it; flip, change its plane, store it (decor -> tank storage, buildings -> their
//     blueprint back to the Satchel), undo (Ctrl+Z), Esc / Done to leave
//   - buildings placed here are seabed buildings (state.buildings with b.tank) and keep their bonuses
//
//   new Build2D(aq)  .on  .enter({place: itemId, select: rec})  .exit()  .input(inp, tip)  .update(dt)  .draw(ctx, cam)
//   .ghostPiece() -> a translucent piece for the scene (or null)

import { clamp, clamp01, rectContains } from '../core/math.js';
import { drawText, measureText } from '../gfx/font.js';
import { getUiIcon } from '../gfx/uiicons.js';
import { PROPS, getPropSteps } from '../gfx/props.js';
import { AERO, fmtAero, drawAeroSurface, drawAeroButton, drawAeroCoin, drawSparkle, drawPixelBrackets } from '../ui/aero.js';
import { ITEMS, countItem, removeItem, addItem } from '../build/items.js';
import { buildingSprite } from '../build/buildingmodels.js';
import { buildingDef } from '../build/buildings.js';
import { unlocked, nodeFor } from '../game/lab.js';

const CATS = [
  { id: 'all', label: 'All' }, { id: 'owned', label: 'Owned' }, { id: 'build', label: 'Buildings' }, { id: 'nature', label: 'Nature' },
  { id: 'ruin', label: 'Ruins' }, { id: 'glow', label: 'Glow' }, { id: 'fun', label: 'Fun' },
];
const catOf = (id) => {
  const t = PROPS[id]?.tags || [];
  if (t.includes('rock') || t.includes('bone') || t.includes('coral') || t.includes('plant')) return 'nature';
  if (t.includes('ruin') || t.includes('treasure') || t.includes('wreck') || t.includes('ship')) return 'ruin';
  if (t.includes('glow') || t.includes('crystal')) return 'glow';
  return 'fun';
};
const DECOR_IDS = Object.keys(PROPS).filter((id) => PROPS[id]?.decor).sort((a, b) => (PROPS[a].decor.price || 0) - (PROPS[b].decor.price || 0));
const LAYERS = [{ id: 0, label: 'Front' }, { id: 1, label: 'Mid' }, { id: 2, label: 'Back' }, { id: 3, label: 'Wall' }];
const UNDO_MAX = 40;
const SNAP = 4;

export class Build2D {
  constructor(aq) {
    this.aq = aq;
    this.on = false;
    this.cat = 'all';
    this.scroll = 0; this.scrollT = 0;
    this.layer = 1;
    this.flip = false;
    this.entry = null;  // catalog entry being placed
    this.ghost = null;  // {x, l, wy, ok}
    this.sel = null;    // selected piece
    this.held = null;   // {p, from, dx}
    this.press = null;
    this.undoStack = [];
    this.hoverBtn = null; this.hoverTile = null;
    this.t = 0;
  }

  get game() { return this.aq.game; }
  get st() { return this.aq.st; }

  enter(o = {}) {
    const aq = this.aq;
    aq.panel = null; aq.follow = null;
    if (!this.on) { this.on = true; this.ghost = null; this.sel = null; this.held = null; this.press = null; aq.sfx('ui_open', { vol: 0.6 }); this.game.emit?.('buildMode', true); }
    if (o.place) {
      const it = ITEMS[o.place];
      const key = it?.kind === 'blueprint' ? 'bp:' + o.place : 'decor:' + (it?.prop || o.place);
      const e = this.entries().find((q) => q.key === key);
      if (e) { this.pick(e); this.cat = e.kind === 'blueprint' ? 'build' : 'all'; this.revealTile(e); }
    }
    if (o.select) {
      const p = aq.pieceOf(o.select);
      if (p) { this.sel = p; this.layer = p.l; this.flip = p.flip; aq.camX = clamp(p.x, -aq.scene.scrollMax(), aq.scene.scrollMax()); }
    }
  }
  exit() {
    if (this.held) this.dropHeld(true);
    this.on = false; this.entry = null; this.ghost = null; this.sel = null; this.press = null;
    this.game.save?.();
    this.aq.sfx('ui_close', { vol: 0.6 });
    this.game.emit?.('buildMode', false);
  }

  // ------------------------------------------------------------------ catalog
  owned(id) { return this.st.tank.stored.filter((x) => x === id).length + (countItem(this.st, id) || 0); }
  offer(id) {
    const n = this.owned(id);
    if (n > 0) return { kind: 'owned', n };
    const price = PROPS[id]?.decor?.price || 100;
    let ok = price < 220;
    try { if (!ok && unlocked(this.st, 'recipe', 'decor_' + id)) ok = true; } catch { /* lab not ready */ }
    if (ok) return { kind: 'buy', price };
    let why = 'Find it in floating crates.';
    try { const nd = nodeFor('recipe', 'decor_' + id); if (nd) why = `Research ${nd.name} in The Lab.`; } catch { /* lab not ready */ }
    return { kind: 'locked', why };
  }
  entries() {
    const items = this.st.inventory?.items || {};
    const out = [];
    for (const iid of Object.keys(items)) {
      const it = ITEMS[iid];
      if (it?.kind !== 'blueprint' || !(items[iid] > 0)) continue;
      const def = buildingDef(it.builds);
      if (!def) continue;
      out.push({ key: 'bp:' + iid, kind: 'blueprint', item: iid, id: it.builds, name: def.name, offer: { kind: 'owned', n: items[iid] }, cat: 'build' });
    }
    for (const id of DECOR_IDS) out.push({ key: 'decor:' + id, kind: 'decor', id, name: PROPS[id].name, offer: this.offer(id), cat: catOf(id) });
    return out;
  }
  visibleEntries() {
    const rank = { owned: 0, buy: 1, locked: 2 };
    return this.entries().filter((e) => this.cat === 'all' || (this.cat === 'owned' ? e.offer.kind === 'owned' : e.cat === this.cat))
      .sort((a, b) => rank[a.offer.kind] - rank[b.offer.kind] || (a.kind === 'blueprint' ? -1 : 0) - (b.kind === 'blueprint' ? -1 : 0));
  }
  pick(e) {
    if (e.offer.kind === 'locked') { this.game.toast?.(e.offer.why, 'lock'); this.aq.sfx('ui_error'); return; }
    this.entry = e; this.sel = null;
    if (e.kind === 'blueprint' && this.layer === 3) this.layer = 2;
    this.aq.sfx('ui_click', { vol: 0.5 });
  }
  // take one decoration: tank storage first, then the Satchel, then Aero
  acquire(id) {
    const tk = this.st.tank;
    const i = tk.stored.indexOf(id);
    if (i >= 0) { tk.stored.splice(i, 1); return { kind: 'stored' }; }
    if ((countItem(this.st, id) || 0) > 0 && removeItem(this.st, id, 1)) return { kind: 'satchel' };
    const o = this.offer(id);
    if (o.kind !== 'buy') { this.game.toast?.(o.why || 'Locked.', 'lock'); return null; }
    if (!this.game.spendCoins?.(o.price)) { this.game.toast?.('Not enough Aero.', 'coin'); this.aq.sfx('ui_error'); return null; }
    return { kind: 'aero', value: o.price };
  }
  refund(id, paid) {
    if (!paid) return;
    if (paid.kind === 'stored') this.st.tank.stored.push(id);
    else if (paid.kind === 'satchel') addItem(this.st, id, 1);
    else if (paid.kind === 'aero') this.game.addCoins?.(paid.value);
  }

  // ------------------------------------------------------------------ placement maths
  plOf(p) { return p.kind === 'building' ? (p.rec.tank ||= { u: 0.5, l: 2, h: 0.5, f: false }) : p.rec; }
  uOf(x) { return clamp01(x / (this.aq.shape.W - 40) + 0.5); }
  hOf(x, wy) { const T = this.aq.shape, lo = T.planeH(2, x) + 16, hi = T.waterY - 30; return clamp01((wy - lo) / Math.max(1, hi - lo)); }
  // cursor -> placement on the current plane
  spotAt(sx, sy, l) {
    const aq = this.aq, T = aq.shape, S = aq.scene, cam = aq.fullCam();
    const z = S.layerZ(l);
    let [x, wy] = S.unproj(sx, sy, z, cam);
    x = Math.round(x / SNAP) * SNAP;
    const lim = T.W / 2 - 22;
    const ok = Math.abs(x) <= lim + 30;
    x = clamp(x, -lim, lim);
    if (l === 3) wy = clamp(wy, T.planeH(2, x) + 16, T.waterY - 30);
    return { x, l, wy, ok };
  }
  ghostPiece() {
    if (!this.on) return null;
    const e = this.entry, g = this.ghost;
    if (!e || !g?.show) return null;
    const a = 0.72 + 0.18 * Math.sin(this.t * 6);
    const gp = (this.gp ||= { ghost: true, order: 999, squash: 0, hop: 0, v: 0 });
    Object.assign(gp, { kind: e.kind === 'blueprint' ? 'building' : 'decor', id: e.id, l: g.l, x: g.x, wy: g.wy, flip: this.flip, ghostA: g.ok ? a : 0.35 });
    return gp;
  }

  place() {
    const e = this.entry, g = this.ghost, aq = this.aq;
    if (!e || !g?.ok) { aq.sfx('ui_error'); return; }
    const pl = { u: this.uOf(g.x), l: g.l, h: this.hOf(g.x, g.wy), f: this.flip };
    if (e.kind === 'blueprint') {
      const b = this.game.build?.placeInTank?.(e.item, pl);
      if (!b) return;
      aq.syncPieces();
      const p = aq.pieceOf(b);
      if (p) { p.lift = aq.shape.H * 0.5; p.vy = 0; }
      this.push({ op: 'placeB', b, item: e.item });
      if (!countItem(this.st, e.item)) this.entry = null;
    } else {
      const paid = this.acquire(e.id);
      if (!paid) return;
      const rec = { id: e.id, ...pl };
      const p = aq.insertDecorRec(rec, { drop: true });
      if (p) p.lift = Math.min(aq.shape.H * 0.4, 120);
      this.push({ op: 'place', rec, paid });
      if (paid.kind !== 'aero' && this.owned(e.id) <= 0 && this.offer(e.id).kind === 'locked') this.entry = null;
    }
    aq.sfx('icon_drop', { vol: 0.6 });
    this.game.emit?.('tankBuilt', { id: e.id, kind: e.kind });
    this.game.save?.();
  }

  // ------------------------------------------------------------------ edit ops (with undo)
  snap(p) { const pl = this.plOf(p); return { u: pl.u, l: pl.l, h: pl.h, f: pl.f }; }
  apply(p, s) { Object.assign(this.plOf(p), s); this.aq.syncPieces(); }
  push(op) { this.undoStack.push(op); if (this.undoStack.length > UNDO_MAX) this.undoStack.shift(); }
  setLayer(l) {
    if (this.sel) {
      const p = this.sel;
      if (p.kind === 'building' && l === 3) l = 2;
      const from = this.snap(p);
      this.apply(p, { l });
      this.push({ op: 'move', rec: p.rec, from });
      this.sel = this.aq.pieceOf(p.rec);
    }
    this.layer = l;
    this.aq.sfx('ui_toggle', { vol: 0.5 });
  }
  doFlip() {
    if (this.sel) { const p = this.sel, from = this.snap(p); this.apply(p, { f: !from.f }); this.push({ op: 'move', rec: p.rec, from }); this.sel = this.aq.pieceOf(p.rec); this.sel && (this.sel.squashV += 4); }
    else this.flip = !this.flip;
    this.aq.sfx('ui_toggle', { vol: 0.5 });
  }
  store(p = this.sel) {
    if (!p) return;
    const aq = this.aq;
    if (p.kind === 'building') {
      const b = p.rec;
      if (!this.game.build?.removeFromTank?.(b)) return;
      this.push({ op: 'storeB', b, item: 'bp_' + b.id });
    } else {
      const index = this.st.tank.decor.indexOf(p.rec);
      aq.storeDecor(p);
      this.push({ op: 'store', rec: p.rec, index });
    }
    aq.syncPieces();
    this.sel = null;
  }
  undo() {
    const op = this.undoStack.pop();
    const aq = this.aq, tk = this.st.tank;
    if (!op) { aq.sfx('ui_error', { vol: 0.4 }); return; }
    if (op.op === 'place') { aq.removeDecorRec(op.rec, 'burst'); this.refund(op.rec.id, op.paid); }
    else if (op.op === 'placeB') this.game.build?.removeFromTank?.(op.b, { quiet: true });
    else if (op.op === 'move') { const p = aq.pieceOf(op.rec); if (p) this.apply(p, op.from); }
    else if (op.op === 'store') { const i = tk.stored.indexOf(op.rec.id); if (i >= 0) tk.stored.splice(i, 1); tk.decor.splice(clamp(op.index, 0, tk.decor.length), 0, op.rec); aq.syncPieces(); }
    else if (op.op === 'storeB') this.game.build?.restoreToTank?.(op.b);
    aq.syncPieces();
    this.sel = null;
    aq.sfx('ui_back', { vol: 0.5 });
    this.game.save?.();
  }

  pickUp(p, sx) {
    this.held = { p, from: this.snap(p), dx: (p.screen ? p.screen.x + p.screen.w / 2 : sx) - sx };
    p.lift = 6;
    this.aq.sfx('icon_pickup', { vol: 0.5 });
  }
  dropHeld(cancel = false) {
    const h = this.held;
    this.held = null;
    if (!h) return;
    const p = h.p;
    if (cancel) { this.apply(p, h.from); return; }
    const now = this.snap(p);
    if (now.u !== h.from.u || now.l !== h.from.l || now.h !== h.from.h) this.push({ op: 'move', rec: p.rec, from: h.from });
    const q = this.aq.pieceOf(p.rec);
    if (q) { q.lift = Math.max(q.lift, 10); q.vy = -60; }
    this.aq.sfx('icon_drop', { vol: 0.5 });
    this.game.save?.();
  }

  // ------------------------------------------------------------------ layout
  k() { return this.aq.hudK(); }
  trayRect() {
    const { W, H } = this.game.screen, k = this.k();
    const h = Math.round(84 * k);
    return { x: 8, y: H - h - 6, w: W - 16, h, k };
  }
  tabs() {
    const r = this.trayRect(), k = r.k, font = k >= 1.4 ? 'normal' : 'small';
    let x = r.x + Math.round(10 * k);
    const out = [];
    for (const c of CATS) {
      const w = measureText(c.label, font) + Math.round(14 * k);
      out.push({ id: 'cat:' + c.id, cat: c.id, label: c.label, x, y: r.y + Math.round(5 * k), w, h: Math.round(14 * k), font });
      x += w + 3;
    }
    return out;
  }
  tiles() {
    const r = this.trayRect(), k = r.k;
    const tw = Math.round(46 * k), th = Math.round(54 * k), gap = Math.round(4 * k);
    const x0 = r.x + Math.round(24 * k), x1 = r.x + r.w - Math.round(24 * k);
    const y = r.y + Math.round(23 * k);
    const per = Math.max(1, Math.floor((x1 - x0 + gap) / (tw + gap)));
    const list = this.visibleEntries();
    this.scroll = clamp(this.scroll, 0, Math.max(0, list.length - per));
    const out = [];
    for (let i = 0; i < per && this.scroll + i < list.length; i++) out.push({ e: list[this.scroll + i], x: x0 + i * (tw + gap), y, w: tw, h: th });
    return { out, per, n: list.length, prev: { id: 'prev', x: r.x + 4, y, w: Math.round(16 * k), h: th }, next: { id: 'next', x: r.x + r.w - 4 - Math.round(16 * k), y, w: Math.round(16 * k), h: th } };
  }
  revealTile(e) {
    const list = this.visibleEntries();
    const i = list.findIndex((q) => q.key === e.key);
    if (i >= 0) this.scroll = Math.max(0, i - 2);
  }
  toolButtons() {
    const { W } = this.game.screen, k = this.k();
    const h = Math.round(20 * k), y = 6;
    const defs = [
      ...LAYERS.map((l) => ({ id: 'layer' + l.id, label: l.label, on: (this.sel ? this.sel.l : this.layer) === l.id, run: () => this.setLayer(l.id), tip: l.id === 3 ? 'Mount on the back glass' : `${l.label} plane (Q / E)`, w: 44 })),
      { gap: true },
      { id: 'flip', label: 'Flip', icon: 'arrow_r', run: () => this.doFlip(), tip: 'Flip (F)', w: 46 },
      { id: 'store', label: 'Store', icon: 'minus', run: () => this.store(), tip: 'Pack the selected piece away (Del)', w: 52, disabled: !this.sel, tone: 'orange' },
      { id: 'undo', label: 'Undo', icon: 'arrow_l', run: () => this.undo(), tip: 'Undo (Ctrl+Z)', w: 50, disabled: !this.undoStack.length },
      { gap: true },
      { id: 'done', label: 'Done', icon: 'check', run: () => this.exit(), tip: 'Leave build mode (Esc)', w: 54, tone: 'green' },
    ];
    let tw = 0;
    for (const d of defs) tw += d.gap ? Math.round(8 * k) : Math.round(d.w * k) + 3;
    let x = Math.round(W / 2 - tw / 2);
    const out = [];
    for (const d of defs) {
      if (d.gap) { x += Math.round(8 * k); continue; }
      const w = Math.round(d.w * k);
      out.push({ ...d, x, y, w, h });
      x += w + 3;
    }
    return out;
  }

  // ------------------------------------------------------------------ update / input
  update(dt) {
    this.t += dt;
    if (this.sel && !this.aq.decor.includes(this.sel)) this.sel = this.aq.pieceOf(this.sel.rec);
    if (this.entry) {
      const e = this.entries().find((q) => q.key === this.entry.key);
      if (!e || e.offer.kind === 'locked') this.entry = null; else this.entry = e;
    }
  }

  input(inp, tip) {
    const g = this.game, aq = this.aq, I = g.input;
    this.hoverBtn = null; this.hoverTile = null;
    // keys
    const kp = (k) => I?.keyPressed?.(k);
    if (kp('Escape')) {
      I.keysPressed.delete('Escape');
      if (this.held) this.dropHeld(true);
      else if (this.entry) this.entry = null;
      else if (this.sel) this.sel = null;
      else { this.exit(); return; }
    }
    if (kp('q')) this.setLayer(Math.max(0, (this.sel ? this.sel.l : this.layer) - 1));
    if (kp('e')) this.setLayer(Math.min(this.entry?.kind === 'blueprint' || this.sel?.kind === 'building' ? 2 : 3, (this.sel ? this.sel.l : this.layer) + 1));
    if (kp('f')) { I.keysPressed.delete('f'); this.doFlip(); }
    if ((kp('Delete') || kp('Backspace')) && this.sel) this.store();
    if (kp('z') && (I.key('Control') || I.key('Meta'))) this.undo();
    const W = g.screen.W;
    void W;
    // toolbar
    for (const b of this.toolButtons()) {
      if (!rectContains(b, inp.x, inp.y)) continue;
      this.hoverBtn = b.id; tip(b.tip);
      if (inp.pressed) { inp.consume(); if (!b.disabled) b.run(); }
      this.ghost = null;
      return;
    }
    // catalog tray
    const tr = this.trayRect();
    if (rectContains(tr, inp.x, inp.y) && !this.held) {
      this.ghost = null;
      for (const t of this.tabs()) if (rectContains(t, inp.x, inp.y)) { this.hoverBtn = t.id; if (inp.pressed) { inp.consume(); this.cat = t.cat; this.scroll = 0; aq.sfx('ui_click', { vol: 0.4 }); } return; }
      const T = this.tiles();
      for (const b of [T.prev, T.next]) if (rectContains(b, inp.x, inp.y)) { this.hoverBtn = b.id; if (inp.pressed) { inp.consume(); this.scroll += (b.id === 'next' ? 1 : -1) * Math.max(1, T.per - 1); } return; }
      if (inp.wheel) { this.scroll += inp.wheel > 0 ? 2 : -2; inp.wheel = 0; }
      for (const t of T.out) {
        if (!rectContains(t, inp.x, inp.y)) continue;
        this.hoverTile = t.e.key;
        const o = t.e.offer;
        tip(`${t.e.name}\n${t.e.kind === 'blueprint' ? `Blueprint x${o.n}` : o.kind === 'owned' ? `You own ${o.n}` : o.kind === 'buy' ? `{coin} ${fmtAero(o.price)} Aero` : o.why}`);
        if (inp.pressed) { inp.consume(); this.pick(t.e); }
        return;
      }
      if (inp.pressed) inp.consume();
      return;
    }
    // ---- in the tank
    if (inp.wheel) { this.setLayer(clamp((this.sel ? this.sel.l : this.layer) + (inp.wheel > 0 ? 1 : -1), 0, this.entry?.kind === 'blueprint' || this.sel?.kind === 'building' ? 2 : 3)); inp.wheel = 0; }
    if (inp.rpressed) {
      inp.rpressed = false;
      if (this.held) this.dropHeld(true); else if (this.entry) this.entry = null; else this.sel = null;
      aq.sfx('ui_close', { vol: 0.4 });
    }
    if (this.held) {
      const p = this.held.p;
      const s = this.spotAt(inp.x + this.held.dx, inp.y, p.l);
      const pl = this.plOf(p);
      pl.u = this.uOf(s.x); if (p.l === 3) pl.h = this.hOf(s.x, s.wy);
      aq.syncPieces();
      this.held.p = aq.pieceOf(p.rec) || p;
      this.sel = this.held.p;
      if (!inp.down) this.dropHeld();
      if (inp.pressed) inp.consume();
      return;
    }
    if (this.entry) {
      const s = this.spotAt(inp.x, inp.y, this.layer);
      this.ghost = { ...s, show: inp.inside };
      tip(`${this.entry.name}\n{mouse_l} Place   Q/E plane   F flip   {mouse_r} Cancel`);
      if (inp.pressed) { inp.consume(); this.place(); }
      return;
    }
    this.ghost = null;
    const hp = aq.pickPiece(inp.x, inp.y);
    aq.hoverDecor = hp;
    if (hp) tip(`${hp.kind === 'building' ? aq.buildingName(hp) : PROPS[hp.id]?.name || 'Decoration'}\n{mouse_hold} Drag to move   F flip   Del store`);
    const pr = this.press;
    if (pr) {
      if (Math.hypot(inp.x - pr.x, inp.y - pr.y) > 4 && pr.p && inp.down) { this.press = null; this.sel = pr.p; this.layer = pr.p.l; this.pickUp(pr.p, pr.x); return; }
      if (!inp.down) this.press = null;
    }
    if (inp.pressed) {
      inp.consume();
      this.sel = hp || null;
      if (hp) { this.layer = hp.l; this.flip = hp.flip; hp.squashV += 3; aq.sfx('ui_click', { vol: 0.4 }); }
      this.press = { x: inp.x, y: inp.y, p: hp };
    }
  }

  // ------------------------------------------------------------------ drawing
  draw(ctx, cam) {
    const g = this.game, aq = this.aq, S = aq.scene, T = aq.shape, t = this.t;
    const { W } = g.screen;
    const k = this.k();
    // the target plane: a dotted chalk line along its surface (or the back glass outline)
    const l = this.sel ? this.sel.l : this.layer;
    if (this.entry || this.sel) {
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      if (l === 3) {
        const a = S.proj(-T.W / 2, T.planeH(2, 0) + 16, -T.D / 2, cam), b = S.proj(T.W / 2, T.waterY - 30, -T.D / 2, cam);
        for (let x = Math.max(0, Math.round(a.x)); x < Math.min(W, b.x); x += 6) { ctx.fillRect(x, Math.round(a.y), 3, 1); ctx.fillRect(x, Math.round(b.y), 3, 1); }
      } else {
        const z = S.layerZ(l);
        for (let sx = 0; sx < W; sx += 6) {
          const [x] = S.unproj(sx, 0, z, cam);
          if (Math.abs(x) > T.W / 2) continue;
          const p = S.proj(x, T.planeH(l, x), z, cam);
          ctx.fillStyle = 'rgba(10,60,110,0.35)'; ctx.fillRect(sx, Math.round(p.y), 3, 1);
          ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.fillRect(sx, Math.round(p.y) - 1, 3, 1);
        }
      }
    }
    // selection / ghost brackets
    const mark = (s, col) => s && drawPixelBrackets(ctx, s.x - 2, s.y - 2, s.w + 4, s.h + 4, t, { col, k: k >= 1.4 ? 2 : 1 });
    if (this.sel?.screen) mark(this.sel.screen, '#9af0ff');
    if (this.ghost?.show && this.entry && this.gp?.screen) mark(this.gp.screen, this.ghost.ok ? '#7aff8a' : '#ff6a6a');
    // toolbar
    for (const b of this.toolButtons()) {
      drawAeroButton(ctx, b.x, b.y, b.w, b.h, { label: b.label, icon: b.icon ? getUiIcon(b.icon) : null, tone: b.on ? 'green' : b.tone || 'glass', state: b.disabled ? 'disabled' : b.on ? 'down' : this.hoverBtn === b.id ? 'hover' : 'normal' });
    }
    // hint line
    const hint = this.held ? 'Drag to move - Q/E plane - Esc cancel' : this.entry ? `Placing ${this.entry.name} - click the tank - Q/E plane - F flip - right-click cancel` : this.sel ? 'Drag to move - Q/E plane - F flip - Del store - Ctrl+Z undo' : 'Pick something from the tray, or click a piece in the tank to edit it';
    const tr = this.trayRect();
    const font = k >= 1.4 ? 'normal' : 'small';
    const hw = measureText(hint, font) + 20;
    drawAeroSurface(ctx, Math.round(W / 2 - hw / 2), tr.y - Math.round(18 * k), hw, Math.round(14 * k), { tone: 'frost', r: 'pill', gloss: 0.6, rim: 0.8 });
    drawText(ctx, hint, Math.round(W / 2), tr.y - Math.round(18 * k) + Math.round((14 * k - (font === 'normal' ? 7 : 5)) / 2), { font, align: 'center', color: AERO.ink });
    this.drawTray(ctx, tr, t);
  }

  drawTray(ctx, tr, t) {
    const k = tr.k, aq = this.aq, ink = AERO.ink;
    drawAeroSurface(ctx, tr.x, tr.y, tr.w, tr.h, { tone: 'glass', r: 10, gloss: 0.6, glossH: Math.round(16 * k), rim: 0.9, glow: 0.4 });
    for (const tb of this.tabs()) {
      const on = this.cat === tb.cat;
      drawAeroButton(ctx, tb.x, tb.y, tb.w, tb.h, { label: tb.label, font: tb.font, tone: on ? 'aqua' : 'glass', state: on ? 'down' : this.hoverBtn === tb.id ? 'hover' : 'normal', radius: 5 });
    }
    // stored counter on the right of the tabs
    const st = this.st.tank.stored.length;
    if (st) drawText(ctx, `${st} stored`, tr.x + tr.w - 12, tr.y + Math.round(8 * k), { align: 'right', font: k >= 1.4 ? 'normal' : 'small', color: ink });
    const T = this.tiles();
    for (const b of [T.prev, T.next]) {
      const dis = b.id === 'prev' ? this.scroll <= 0 : this.scroll + T.per >= T.n;
      drawAeroButton(ctx, b.x, b.y, b.w, b.h, { icon: getUiIcon(b.id === 'prev' ? 'arrow_l' : 'arrow_r'), tone: 'glass', state: dis ? 'disabled' : this.hoverBtn === b.id ? 'hover' : 'normal', radius: 5 });
    }
    for (const tl of T.out) {
      const e = tl.e, o = e.offer;
      const on = this.entry?.key === e.key, hov = this.hoverTile === e.key;
      drawAeroSurface(ctx, tl.x, tl.y, tl.w, tl.h, { tone: on ? 'aqua' : e.kind === 'blueprint' ? 'clear' : 'frost', r: 6, gloss: 0.5, rim: on || hov ? 1 : 0.7, glow: on ? 0.8 : 0 });
      const th = this.thumb(e, tl.w - 6, tl.h - 16);
      if (th) {
        const sc = Math.min(1, (tl.w - 6) / th.width, (tl.h - 16) / th.height);
        const w = Math.round(th.width * sc), h = Math.round(th.height * sc);
        if (o.kind === 'locked') ctx.globalAlpha = 0.35;
        ctx.drawImage(th, Math.round(tl.x + (tl.w - w) / 2), Math.round(tl.y + tl.h - 13 - h + (hov ? -1 : 0)), w, h);
        ctx.globalAlpha = 1;
      } else drawSparkle(ctx, tl.x + tl.w / 2, tl.y + tl.h / 2 - 4, (t * 4) % 1 < 0.5 ? 2 : 1, 0.8);
      if (o.kind === 'locked') { const ic = getUiIcon('lock'); if (ic) ctx.drawImage(ic, Math.round(tl.x + tl.w / 2 - ic.width / 2), Math.round(tl.y + tl.h / 2 - ic.height / 2 - 4)); }
      const sy = tl.y + tl.h - 10;
      if (e.kind === 'blueprint') drawText(ctx, `{home}x${o.n}`, tl.x + 4, sy, { font: 'small', color: ink });
      else if (o.kind === 'owned') drawText(ctx, `x${o.n}`, tl.x + 4, sy, { font: 'small', color: ink });
      else if (o.kind === 'buy') { drawAeroCoin(ctx, tl.x + 7, sy + 3, 3, 0); drawText(ctx, fmtAero(o.price), tl.x + 12, sy, { font: 'small', color: (this.st.coins || 0) >= o.price ? ink : '#c03040' }); }
      if (on) drawPixelBrackets(ctx, tl.x - 2, tl.y - 2, tl.w + 4, tl.h + 4, t, { col: '#ffffff', k: 1 });
    }
    void aq;
  }

  // voxel thumbnails (built by the scene's job queue)
  thumb(e, w, h) {
    const S = this.aq.scene;
    if (e.kind === 'blueprint') {
      const s = buildingSprite(e.id, { scale: 0.26, yaw: 0 });
      return s ? s.canvas : null;
    }
    const size = PROPS[e.id]?.decor?.size || 1;
    const sc = [0.5, 0.5, 0.36, 0.26][size] || 0.4;
    const s = S.sprite(`thumb|${e.id}|${sc}`, () => getPropSteps(e.id, { scale: sc, yaw: 0, pitch: 18 }));
    void w; void h;
    return s ? s.canvas : null;
  }
}
