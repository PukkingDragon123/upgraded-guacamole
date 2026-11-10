// Build mode for the cube tank (phase 7 "better building", phase 8 voxel/pixel look). A clean decorating mode:
//   - a decor catalog (left): categories, hand-made-looking pixel thumbnails of the voxel models, ownership counts
//     (tank storage + satchel), Aero prices, or a padlock (research it in The Lab / find it in crates)
//   - a ghost preview that follows the cursor on the cube floor, grid snapping (toggle, G), rotate (R / Shift+R / wheel),
//     raise and lower (E / Q) with automatic stacking on top of other pieces, collision + valid-placement tint
//   - select, move (drag: pick-up lift, hover, drop with a sand puff), duplicate (D), store (Del), sell, undo (Ctrl+Z)
//   - brushes: paint plants or rocks onto the floor, erase them (also the tank's own plants)
//   - everything saves into state.tank: decor [{id, x, z, r, v, lift}], paint [{k, x, z, h, s}], baseOff, grid
//
//   new BuildMode(aq)  .on  .enter()  .exit()  .input(inp, tip) -> consumed  .update(dt)  .draw(ctx)
//   view hooks: .ghostView() -> {model, k, p, yaw, ok} | null  .marks() -> [{p, r, ok}]  .brushView() -> {p, r} | null

import { clamp, clamp01, lerp, rectContains } from '../core/math.js';
import { rng } from '../core/rng.js';
import { drawText, measureText } from '../gfx/font.js';
import { getUiIcon } from '../gfx/uiicons.js';
import { PROPS } from '../gfx/props.js';
import { renderMesh } from '../gfx/lowpoly.js';
import { AERO, fmtAero, drawAeroSurface, drawAeroButton, drawAeroCoin, drawSparkle } from '../ui/aero.js';
import { ITEMS, countItem, removeItem, sellValue } from '../build/items.js';
import { unlocked, nodeFor } from '../game/lab.js';
import { decorModel } from './lpdecor.js';
import { PLANT_KINDS, plantGeo } from './lpplants.js';
import { Geo, voxelize } from './lpkit.js';

export const ROCK_KINDS = { pebbles: 'Pebbles', stones: 'River Stones', boulder: 'Boulder', lava: 'Lava Rock', mossy: 'Mossy Rock' };
const CATS = [
  { id: 'all', label: 'All' }, { id: 'owned', label: 'Owned' }, { id: 'rock', label: 'Rocks' }, { id: 'coral', label: 'Coral' },
  { id: 'ruin', label: 'Ruins' }, { id: 'glow', label: 'Glow' }, { id: 'fun', label: 'Fun' },
];
const catOf = (id) => {
  const t = PROPS[id]?.tags || [];
  if (t.includes('rock') || t.includes('bone')) return 'rock';
  if (t.includes('coral') || t.includes('plant')) return 'coral';
  if (t.includes('ruin') || t.includes('treasure') || t.includes('wreck') || t.includes('ship')) return 'ruin';
  if (t.includes('glow') || t.includes('crystal')) return 'glow';
  return 'fun';
};
const DECOR_IDS = Object.keys(PROPS).filter((id) => PROPS[id]?.decor).sort((a, b) => (PROPS[a].decor.price || 0) - (PROPS[b].decor.price || 0));
const GRID = 12;
const UNDO_MAX = 40;

// ------------------------------------------------------------------ pixel thumbnails (voxel model -> tiny sprite + outline)
const THUMBS = new Map();
let thumbBudget = 0;
function outlined(src) {
  const w = src.width, h = src.height;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  const s = src.getContext('2d').getImageData(0, 0, w, h).data;
  const o = g.createImageData(w, h), d = o.data;
  const A = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : s[(y * w + x) * 4 + 3]);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    if (s[i + 3] > 90) { d[i] = s[i]; d[i + 1] = s[i + 1]; d[i + 2] = s[i + 2]; d[i + 3] = 255; continue; }
    if (A(x - 1, y) > 90 || A(x + 1, y) > 90 || A(x, y - 1) > 90 || A(x, y + 1) > 90) { d[i] = 12; d[i + 1] = 44; d[i + 2] = 70; d[i + 3] = 235; }
  }
  g.putImageData(o, 0, 0);
  return c;
}
// A hand-made-looking pixel sprite of a voxel mesh: rendered small (1 logical px = 1 sprite px, nearest-neighbour
// upscaled by the game) with a dark selective outline. Cached; a few new ones per frame.
export function pixelThumb(key, make, size) {
  const k = key + '|' + size;
  let c = THUMBS.get(k);
  if (c !== undefined) return c;
  if (thumbBudget <= 0) return null;
  thumbBudget--;
  try {
    const m = make();
    if (!m) { THUMBS.set(k, null); return null; }
    const r = renderMesh(m.mesh, { w: size - 2, h: size - 2, yaw: m.yaw ?? -0.62, pitch: m.pitch ?? 0.42, parts: m.parts || [], ambient: 0.55, spec: 0.3, rim: 0.25 });
    const pad = document.createElement('canvas'); pad.width = size; pad.height = size;
    if (r) pad.getContext('2d').drawImage(r, 1, 1);
    c = outlined(pad);
  } catch (e) { console.warn('thumb', key, e); c = null; }
  THUMBS.set(k, c);
  return c;
}
export function beginThumbs(n = 3) { thumbBudget = n; }
export function decorThumb(id, size = 30, v = 0) {
  return pixelThumb('decor:' + id + ':' + v, () => { const m = decorModel(id, v); return { mesh: m.mesh, parts: [...m.glow.map((gw) => ({ mesh: gw.mesh, tint: [...gw.col, 1] })), ...(m.part ? [{ mesh: m.part.mesh }] : [])] }; }, size);
}
function brushThumb(kind, size = 30) {
  return pixelThumb('brush:' + kind, () => {
    const g = new Geo();
    if (PLANT_KINDS[kind]) plantGeo(g, kind, kind === 'hair' || kind === 'moss' ? 5 : 14, 1, 77);
    else rockGeo(g, kind, 3, 1);
    const v = voxelize(g, kind === 'moss' || kind === 'pebbles' ? 0.25 : 0.4);
    return { mesh: v.build() };
  }, size);
}

// painted rocks: tiny voxel rock groups (root at the origin, size ~k * 3 cm)
export function rockGeo(g, kind, seed, k) {
  let s = seed | 0;
  const rnd = () => { s = Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x6d2b79f5 | 0; return ((s ^ (s >>> 13)) >>> 0) / 4294967296; };
  const greys = ['#8e98a8', '#a8b0bc', '#9aa2b0', '#7c8698', '#b4aa98'];
  if (kind === 'pebbles') {
    for (let i = 0; i < 7; i++) { g.push(); g.at((rnd() - 0.5) * 3 * k, 0, (rnd() - 0.5) * 3 * k); g.scale(1, 0.6, 1); g.sphere((0.35 + rnd() * 0.35) * k, 0, ['#e8f4ff', '#bff4ff', '#d8ccA0', '#8ae0d0', '#f4fbff'][i % 5], { jit: 0.3, seed: i }); g.pop(); }
  } else if (kind === 'stones') {
    for (let i = 0; i < 3; i++) { g.push(); g.at((rnd() - 0.5) * 3 * k, 0, (rnd() - 0.5) * 2.4 * k); g.rotY(rnd() * 6); g.rock((0.8 + rnd() * 0.6) * k, Math.floor(rnd() * 999), greys[i % greys.length], { sy: 0.55 }); g.pop(); }
  } else if (kind === 'boulder') {
    g.rock(2.2 * k, Math.floor(rnd() * 999), greys[Math.floor(rnd() * 4)], { sy: 0.85 });
    g.push(); g.at(1.6 * k, 0, 0.8 * k); g.rock(0.9 * k, Math.floor(rnd() * 999), greys[1]); g.pop();
  } else if (kind === 'lava') {
    for (let i = 0; i < 2; i++) { g.push(); g.at((rnd() - 0.5) * 2 * k, 0, (rnd() - 0.5) * 2 * k); g.rock((1 + rnd() * 0.8) * k, Math.floor(rnd() * 999), i ? '#3a3640' : '#4a3a3a', { sy: 0.7 }); g.pop(); }
  } else {
    g.rock(1.6 * k, Math.floor(rnd() * 999), '#8a94a4', { sy: 0.7 });
    g.push(); g.at(0, 1.05 * k, 0); g.scale(1, 0.45, 1); g.sphere(1.25 * k, 1, '#4ab85a', { jit: 0.3, seed: 3 }); g.pop();
  }
  return g;
}

export class BuildMode {
  constructor(aq) {
    this.aq = aq;
    this.on = false;
    this.tool = 'move'; // move | plant | rock | erase
    this.cat = 'all';
    this.scroll = 0;
    this.ghost = null; // {id, v, yaw, lift, at: {u, v}, ok, ev}
    this.sel = null;   // selected decor entry
    this.held = null;  // {d, from: {x, z, r, lift}, ok}
    this.press = null;
    this.undoStack = [];
    this.brush = { plant: 'hair', rock: 'pebbles', r: 0.09 };
    this.cursor = null;
    this.paintT = 0; this.stroke = null;
    this.hoverBtn = null;
    this.t = 0;
  }

  get st() { return this.aq.st.tank; }
  get game() { return this.aq.game; }
  get grid() { return this.st.grid !== false; }

  enter() {
    this.on = true; this.tool = 'move'; this.ghost = null; this.sel = null; this.held = null; this.press = null;
    this.aq.panel = null;
    this.aq.view.follow = null;
    this.aq.sfx('ui_open', { vol: 0.6 });
  }
  exit() {
    if (this.held) this.dropHeld(true);
    this.on = false; this.ghost = null; this.sel = null; this.press = null; this.cursor = null;
    this.aq.game.save?.();
    this.aq.sfx('ui_close', { vol: 0.6 });
  }

  // ------------------------------------------------------------------ ownership, prices
  owned(id) { return this.st.stored.filter((x) => x === id).length + (countItem(this.aq.st, id) || 0); }
  offer(id) {
    const n = this.owned(id);
    if (n > 0) return { kind: 'owned', n };
    const price = PROPS[id]?.decor?.price || 100;
    let ok = price < 220;
    try { if (!ok && unlocked(this.aq.st, 'recipe', 'decor_' + id)) ok = true; } catch { /* lab not ready */ }
    if (ok) return { kind: 'buy', price };
    let why = 'Find it in floating crates.';
    try { const nd = nodeFor('recipe', 'decor_' + id); if (nd) why = `Research ${nd.name} in The Lab.`; } catch { /* lab not ready */ }
    return { kind: 'locked', why };
  }
  // take one: tank storage first, then the satchel, then Aero
  acquire(id) {
    const st = this.st;
    const i = st.stored.indexOf(id);
    if (i >= 0) { st.stored.splice(i, 1); return { kind: 'stored' }; }
    if ((countItem(this.aq.st, id) || 0) > 0 && removeItem(this.aq.st, id, 1)) return { kind: 'satchel' };
    const o = this.offer(id);
    if (o.kind !== 'buy') { this.game.toast?.(o.why || 'Locked.', 'lock'); return null; }
    if (!this.game.spendCoins?.(o.price)) { this.game.toast?.('Not enough Aero.', 'coin'); this.aq.sfx('ui_error'); return null; }
    return { kind: 'aero', value: o.price };
  }

  // ------------------------------------------------------------------ placement maths
  S() { return this.aq.shape.size[1]; }
  probe(id, v) { const d = { rec: { id, v }, model: decorModel(id, v || 0) }; d.k = this.aq.decorScale(d); return d; }
  // where a piece with record r would sit (excluding entry ex): {p, base, r, h, ok, why, support}
  evaluate(r, ex = null) {
    const aq = this.aq, T = aq.shape;
    const pr = this.probe(r.id, r.v);
    const rad = pr.model.r * pr.k, h = pr.model.h * pr.k;
    const fp = T.floorPoint(clamp01(r.x), clamp01(r.z), rad * 0.6);
    let base = fp[1] - 0.25, support = null;
    for (const e of aq.decor) {
      if (e === ex || e.held || !e.p) continue;
      if (Math.hypot(e.p[0] - fp[0], e.p[2] - fp[2]) < e.r * 0.7 && e.ty + e.h * 0.92 > base) { base = e.ty + e.h * 0.92; support = e; }
    }
    base += (r.lift || 0) * this.S();
    let ok = true, why = '';
    if (r.out) { ok = false; why = 'Outside the tank'; }
    else if (base + h > T.waterY + h * 0.15) { ok = false; why = 'Too tall here'; }
    else {
      for (const e of aq.decor) {
        if (e === ex || e === support || e.held || !e.p) continue;
        const dd = Math.hypot(e.p[0] - fp[0], e.p[2] - fp[2]);
        if (dd < (rad + e.r) * 0.52 && base < e.ty + e.h * 0.85 && base + h > e.ty + 0.2) { ok = false; why = `Bumps into ${PROPS[e.rec.id]?.name || 'decor'}`; break; }
      }
    }
    return { p: [fp[0], base, fp[2]], base, r: rad, h, ok, why, support, k: pr.k, model: pr.model };
  }
  // cursor -> floor uv (stacks on a piece under the cursor), snapped to the grid
  aim(ray, ex) {
    const aq = this.aq, T = aq.shape;
    let fp = null;
    const hit = aq.pickDecor(ray, ex);
    if (hit && Math.abs(ray.d[1]) > 1e-3) {
      const top = hit.ty + hit.h * 0.92, t = (top - ray.o[1]) / ray.d[1];
      if (t > 0) { const q = [ray.o[0] + ray.d[0] * t, top, ray.o[2] + ray.d[2] * t]; if (Math.hypot(q[0] - hit.p[0], q[2] - hit.p[2]) < hit.r * 0.9) fp = q; }
    }
    fp ||= aq.floorHit(ray);
    if (!fp) return null;
    let u = fp[0] / T.W + 0.5, v = 0.5 - fp[2] / T.D;
    const out = u < -0.02 || u > 1.02 || v < -0.02 || v > 1.02;
    if (this.grid) { u = (Math.floor(clamp01(u) * GRID - 1e-6) + 0.5) / GRID; v = (Math.floor(clamp01(v) * GRID - 1e-6) + 0.5) / GRID; }
    return { u: clamp01(u), v: clamp01(v), out };
  }

  // ------------------------------------------------------------------ undo
  push(op) { this.undoStack.push(op); if (this.undoStack.length > UNDO_MAX) this.undoStack.shift(); }
  undo() {
    const op = this.undoStack.pop();
    const aq = this.aq, tk = this.st;
    if (!op) { this.game.toast?.('Nothing to undo.', 'info'); return; }
    const find = (rec) => aq.decor.find((d) => d.rec === rec);
    if (op.op === 'place') { aq.removeDecorRec(op.rec, 'burst'); tk.stored.push(op.rec.id); }
    else if (op.op === 'move') { Object.assign(op.rec, op.before); const d = find(op.rec); if (d) d.glide = { from: d.p.slice(), t: 0 }; aq.layoutDecor(); }
    else if (op.op === 'store') { const i = tk.stored.indexOf(op.rec.id); if (i >= 0) tk.stored.splice(i, 1); aq.insertDecorRec(op.rec, op.index); }
    else if (op.op === 'sell') {
      if (!this.game.spendCoins?.(op.value)) { this.game.toast?.('Not enough Aero to buy it back.', 'coin'); this.undoStack.push(op); return; }
      aq.insertDecorRec(op.rec, op.index);
    } else if (op.op === 'paint') {
      tk.paint = (tk.paint || []).filter((r) => !op.add.includes(r)).concat(op.del);
      if (op.hid?.length) { const b = aq.baseOff(); b.i = b.i.filter((i) => !op.hid.includes(i)); }
      aq.paintDirty = true;
    }
    if (this.sel && !aq.decor.includes(this.sel)) this.sel = null;
    aq.sfx('ui_close', { vol: 0.6 });
    this.game.save?.();
  }

  // ------------------------------------------------------------------ actions
  pick(id) {
    const o = this.offer(id);
    if (o.kind === 'locked') { this.game.toast?.(o.why, 'lock'); this.aq.sfx('ui_error'); return; }
    this.tool = 'move'; this.sel = null;
    this.ghost = { id, v: 0, yaw: this.ghost?.yaw ?? 0, lift: 0, at: null, ev: null };
    this.aq.sfx('icon_pickup', { vol: 0.5 });
  }
  placeGhost() {
    const gh = this.ghost, aq = this.aq;
    if (!gh?.at || !gh.ev) return;
    if (!gh.ev.ok) { this.game.toast?.(gh.ev.why || "Can't place it there.", 'cross'); aq.sfx('ui_error'); return; }
    const paid = this.acquire(gh.id);
    if (!paid) return;
    const rec = { id: gh.id, x: gh.at.u, z: gh.at.v, r: gh.yaw };
    if (gh.v) rec.v = gh.v;
    if (gh.lift) rec.lift = gh.lift;
    const d = aq.insertDecorRec(rec, -1, { dropFrom: gh.ev.base + this.S() * 0.1 });
    this.push({ op: 'place', rec, paid });
    aq.sfx('box_close', { vol: 0.5 });
    if (paid.kind === 'aero') this.game.toast?.(`${PROPS[gh.id]?.name}: -${fmtAero(paid.value)} Aero`, 'coin', 2);
    this.game.emit?.('decorPlaced', { id: gh.id });
    this.game.save?.();
    const shift = this.game.input.key('Shift');
    if (!shift && this.owned(gh.id) <= 0) { this.ghost = null; this.sel = d; }
  }
  duplicate(d) {
    if (!d) return;
    this.ghost = { id: d.rec.id, v: d.rec.v || 0, yaw: (d.rec.r || 0) + 0.4, lift: d.rec.lift || 0, at: null, ev: null };
    this.sel = null;
    this.aq.sfx('icon_pickup', { vol: 0.5 });
  }
  store(d) {
    if (!d) return;
    const index = this.aq.decor.indexOf(d);
    this.push({ op: 'store', rec: d.rec, index });
    this.aq.removeDecorRec(d.rec, 'puff');
    this.st.stored.push(d.rec.id);
    this.game.toast?.(`${PROPS[d.rec.id]?.name || 'Decoration'} stored.`, 'tank', 2);
    if (this.sel === d) this.sel = null;
    this.game.save?.();
  }
  sell(d) {
    if (!d) return;
    const v = Math.max(1, Math.round(sellValue(this.aq.st, d.rec.id) || (PROPS[d.rec.id]?.decor?.price || 20) * 0.4));
    if (this.confirm?.key !== 'sell' || this.confirm.d !== d) { this.confirm = { key: 'sell', d, t: 2.5 }; this.game.toast?.(`Click Sell again to sell for ${fmtAero(v)} Aero.`, 'coin', 2.5); return; }
    this.confirm = null;
    const index = this.aq.decor.indexOf(d);
    this.push({ op: 'sell', rec: d.rec, index, value: v });
    this.aq.removeDecorRec(d.rec, 'puff');
    this.game.addCoins?.(v, this.game.input.x, this.game.input.y);
    if (this.sel === d) this.sel = null;
    this.game.save?.();
  }
  nudge(d, f) {
    if (!d) return;
    const rec = d.rec, before = { x: rec.x, z: rec.z, r: rec.r, lift: rec.lift || 0 };
    f(rec);
    const ev = this.evaluate({ ...rec, out: false }, d);
    if (!ev.ok && ev.why === 'Too tall here') { Object.assign(rec, before); this.aq.sfx('ui_error'); return; }
    const last = this.undoStack.at(-1);
    if (!(last?.op === 'move' && last.rec === rec && this.t - last.t < 0.8)) this.push({ op: 'move', rec, before, t: this.t });
    else last.t = this.t;
    d.squashV = (d.squashV || 0) + 3;
    this.aq.layoutDecor();
    this.aq.sfx('click', { vol: 0.4, pitch: 1.3 });
    this.game.save?.();
  }
  rotate(d, a) { this.nudge(d, (r) => { r.r = (r.r || 0) + a; }); }
  raise(d, k) { this.nudge(d, (r) => { r.lift = clamp(Math.round(((r.lift || 0) + k) * 100) / 100, -0.03, 0.6); }); }

  startHold(d) {
    this.held = { d, from: { x: d.rec.x, z: d.rec.z, r: d.rec.r, lift: d.rec.lift || 0 }, ok: true };
    d.held = true; d.vy = 0;
    this.sel = d;
    this.aq.puff([d.p[0], d.ty, d.p[2]], d.r, 6);
    this.aq.sfx('icon_pickup', { vol: 0.55 });
  }
  dropHeld(cancel = false) {
    const h = this.held;
    if (!h) return;
    this.held = null;
    const d = h.d;
    d.held = false;
    if (cancel || !h.ok || !h.at) {
      Object.assign(d.rec, h.from);
      d.glide = { from: d.p.slice(), t: 0 };
      if (!cancel) { this.game.toast?.(h.why || "Can't drop it there.", 'cross', 2); this.aq.sfx('ui_error'); }
      this.aq.layoutDecor();
      return;
    }
    d.rec.x = h.at.u; d.rec.z = h.at.v;
    // a piece you put down goes on top of the stack order
    const i = this.aq.decor.indexOf(d), tk = this.st;
    if (i >= 0) { this.aq.decor.splice(i, 1); this.aq.decor.push(d); tk.decor = tk.decor.filter((r) => r !== d.rec); tk.decor.push(d.rec); }
    this.push({ op: 'move', rec: d.rec, before: h.from, t: -9 });
    this.aq.layoutDecor();
    this.aq.sfx('box_close', { vol: 0.45 });
    this.game.save?.();
  }

  // ------------------------------------------------------------------ brushes
  paintAt(c, dt) {
    const aq = this.aq, tk = this.st;
    tk.paint ||= [];
    this.paintT -= dt;
    if (this.paintT > 0) return;
    this.paintT = 0.06;
    const R = this.brush.r;
    const st = this.stroke ||= { op: 'paint', add: [], del: [], hid: [] };
    if (this.tool === 'erase') {
      const del = tk.paint.filter((r) => Math.abs(r.x - c.u) < R && Math.abs(r.z - c.v) < R);
      if (del.length) { tk.paint = tk.paint.filter((r) => !del.includes(r)); st.del.push(...del.filter((r) => !st.add.includes(r))); st.add = st.add.filter((r) => !del.includes(r)); aq.paintDirty = true; aq.puff(aq.shape.floorPoint(c.u, c.v, 1), aq.shape.minDim * R, 4); }
      else {
        const hid = aq.basePlantsIn(c.u, c.v, R);
        if (hid.length) { const b = aq.baseOff(); for (const i of hid) if (!b.i.includes(i)) { b.i.push(i); st.hid.push(i); } aq.paintDirty = true; aq.puff(aq.shape.floorPoint(c.u, c.v, 1), aq.shape.minDim * R, 4); }
      }
      return;
    }
    const cap = 40 + 26 * aq.tier;
    if (tk.paint.length >= cap) { if (!this.capWarned) { this.capWarned = true; this.game.toast?.('The brush is full: erase some to paint more.', 'info'); } return; }
    const plant = this.tool === 'plant';
    const kind = plant ? this.brush.plant : this.brush.rock;
    const space = plant ? (kind === 'hair' || kind === 'moss' ? 0.04 : 0.065) : (kind === 'pebbles' ? 0.045 : 0.07);
    for (let tries = 0; tries < 6; tries++) {
      const u = clamp(c.u + rng.float(-R, R), 0.02, 0.98), v = clamp(c.v + rng.float(-R, R), 0.02, 0.98);
      if (tk.paint.some((r) => Math.abs(r.x - u) < space && Math.abs(r.z - v) < space)) continue;
      const rec = { k: kind, x: Math.round(u * 1000) / 1000, z: Math.round(v * 1000) / 1000, h: plant ? Math.round(rng.float(...(PLANT_H[kind] || [0.2, 0.4])) * 100) / 100 : 1, s: rng.int(1, 99999) };
      tk.paint.push(rec); st.add.push(rec);
      aq.paintDirty = true;
      aq.puff(aq.shape.floorPoint(u, v, 1), aq.shape.fishLen * 0.3, 3);
      if (rng.chance(0.5)) aq.sfx('bubble', { vol: 0.25, pitch: 1.4 + rng.float(0, 0.4) });
      break;
    }
  }
  endStroke() {
    const s = this.stroke;
    this.stroke = null;
    if (s && (s.add.length || s.del.length || s.hid.length)) { this.push(s); this.game.save?.(); }
  }

  // ------------------------------------------------------------------ layout (2D)
  k() { return clamp(this.aq.hudK(), 1, 1.8); }
  toolbar() {
    const W = this.game.screen.W, k = this.k();
    const bh = Math.round(20 * k), bw = Math.round(52 * k), gap = Math.round(4 * k);
    const items = [
      { id: 'move', icon: 'cursor_hand', label: 'Build', tip: 'Place, move and arrange decorations' },
      { id: 'plant', icon: 'coral', label: 'Plants', tip: 'Plant brush: paint plants on the floor' },
      { id: 'rock', icon: 'home', label: 'Rocks', tip: 'Rock brush: paint pebbles and stones' },
      { id: 'erase', icon: 'trash', label: 'Erase', tip: 'Eraser: remove painted plants and rocks' },
      { gap: true },
      { id: 'grid', icon: 'plus', label: 'Grid', tip: 'Grid snapping (G)', on: this.grid },
      { id: 'undo', icon: 'arrow_l', label: 'Undo', tip: 'Undo (Ctrl+Z)', dis: !this.undoStack.length },
      { gap: true },
      { id: 'done', icon: 'check', label: 'Done', tip: 'Leave build mode (Esc)', tone: 'green' },
    ];
    const total = items.reduce((a, b) => a + (b.gap ? gap * 2 : bw + gap), -gap);
    let x = Math.round(W / 2 - total / 2);
    const y = Math.round(8);
    const out = [];
    for (const it of items) { if (it.gap) { x += gap * 2; continue; } out.push({ ...it, x, y, w: bw, h: bh }); x += bw + gap; }
    return out;
  }
  catRect() {
    const k = this.k(), H = this.game.screen.H;
    const w = Math.round(3 * 44 * k + 14);
    return { x: 6, y: Math.round(36 * k) + 4, w, h: H - Math.round(36 * k) - 12, k };
  }
  entries() {
    if (this.tool === 'plant') return Object.keys(PLANT_KINDS).map((id) => ({ brush: true, id, name: PLANT_KINDS[id] }));
    if (this.tool === 'rock') return Object.keys(ROCK_KINDS).map((id) => ({ brush: true, id, name: ROCK_KINDS[id] }));
    if (this.tool === 'erase') return [];
    let ids = DECOR_IDS;
    if (this.cat === 'owned') ids = ids.filter((id) => this.owned(id) > 0);
    else if (this.cat !== 'all') ids = ids.filter((id) => catOf(id) === this.cat);
    const list = ids.map((id) => ({ id, name: PROPS[id].name, offer: this.offer(id) }));
    const rank = { owned: 0, buy: 1, locked: 2 };
    return list.sort((a, b) => rank[a.offer.kind] - rank[b.offer.kind]);
  }
  catLayout() {
    const R = this.catRect(), k = R.k;
    const tabs = [];
    const tw = Math.floor((R.w - 12) / 4), th = Math.round(13 * k);
    if (this.tool === 'move') CATS.forEach((c, i) => tabs.push({ ...c, x: R.x + 6 + (i % 4) * tw, y: R.y + 22 * k + Math.floor(i / 4) * (th + 2), w: tw - 2, h: th }));
    const top = R.y + Math.round(22 * k) + (tabs.length ? 2 * (th + 2) + 4 : 4);
    const ts = Math.round(44 * k), cols = 3;
    const list = this.entries();
    const rows = Math.ceil(list.length / cols);
    const viewH = R.y + R.h - top - (this.tool !== 'move' ? Math.round(30 * k) : 6);
    this.scroll = clamp(this.scroll, 0, Math.max(0, rows * (ts + 4) - viewH));
    const tiles = list.map((e, i) => ({ ...e, x: R.x + 7 + (i % cols) * (ts + 2), y: top + Math.floor(i / cols) * (ts + 4) - this.scroll, w: ts, h: ts }));
    return { R, tabs, tiles, top, viewH, ts };
  }
  ctxButtons() {
    const d = this.sel;
    if (!d || this.held || this.ghost || this.tool !== 'move') return [];
    const sp = this.aq.view.project([d.p[0], d.p[1] + d.h + 1, d.p[2]]);
    if (!sp) return [];
    const k = this.k(), s = Math.round(18 * k), gap = 2;
    const items = [
      { id: 'rotl', icon: 'arrow_l', tip: 'Rotate left (Shift+R)' }, { id: 'rotr', icon: 'arrow_r', tip: 'Rotate right (R / wheel)' },
      { id: 'up', icon: 'arrow_u', tip: 'Raise (E)' }, { id: 'down', icon: 'arrow_d', tip: 'Lower (Q)' },
      { id: 'dup', icon: 'plus', tip: 'Duplicate (D)' }, { id: 'store', icon: 'tank', tip: 'Store it in the tank storage (Del)' },
      { id: 'sell', icon: 'coin', tip: `Sell for ${fmtAero(Math.max(1, Math.round(sellValue(this.aq.st, d.rec.id) || 8)))} Aero`, tone: 'orange' },
    ];
    const W = this.game.screen.W;
    const tw = items.length * (s + gap) - gap;
    const x0 = clamp(Math.round(sp[0] - tw / 2), 4, W - tw - 4), y0 = clamp(Math.round(sp[1] - s - 10), 34, this.game.screen.H - s - 4);
    return items.map((it, i) => ({ ...it, x: x0 + i * (s + gap), y: y0, w: s, h: s }));
  }

  // ------------------------------------------------------------------ input
  input(inp, tip) {
    const aq = this.aq, g = this.game, I = g.input, view = aq.view;
    this.hoverBtn = null;
    // keys (and keep the game's hotkeys quiet while building)
    if (!g.ui?.active) {
      const ctrl = I.key('Control') || I.key('Meta');
      const tgt = this.held?.d || this.sel;
      if (I.keyPressed('z') && ctrl) this.undo();
      if (I.keyPressed('g')) { this.st.grid = !this.grid; aq.sfx('ui_toggle'); }
      if (I.keyPressed('r')) { const a = (I.key('Shift') ? -1 : 1) * Math.PI / 4; if (this.ghost) this.ghost.yaw += a; else if (this.held) this.held.d.rec.r = (this.held.d.rec.r || 0) + a; else this.rotate(tgt, a); }
      if (I.keyPressed('e')) { if (this.ghost) this.ghost.lift = clamp((this.ghost.lift || 0) + 0.04, -0.03, 0.6); else this.raise(tgt, 0.04); }
      if (I.keyPressed('q')) { if (this.ghost) this.ghost.lift = clamp((this.ghost.lift || 0) - 0.04, -0.03, 0.6); else this.raise(tgt, -0.04); }
      if (I.keyPressed('d') && !ctrl) this.duplicate(this.sel);
      if (I.keyPressed('Delete') || I.keyPressed('Backspace')) this.store(this.sel);
      if (I.keyPressed('Escape')) { if (this.held) this.dropHeld(true); else if (this.ghost) this.ghost = null; else if (this.sel) this.sel = null; else this.exit(); }
      for (const k of ['q', 'e', 'r', 'g', 'd', 'z', 'w', 's', 'b', 't', 'j', 'l', 'k', 'o', 'p', 'i', 'u', 'Escape', '1', '2', '3', '4', '5']) I.keysPressed?.delete?.(k);
    }
    if (!this.on) return true;
    // ---- toolbar
    for (const b of this.toolbar()) {
      if (!rectContains(b, inp.x, inp.y)) continue;
      this.hoverBtn = b.id; tip(b.tip);
      if (inp.pressed) {
        inp.consume();
        if (b.id === 'done') this.exit();
        else if (b.id === 'grid') { this.st.grid = !this.grid; aq.sfx('ui_toggle'); }
        else if (b.id === 'undo') this.undo();
        else { this.tool = b.id; this.ghost = null; this.sel = null; this.scroll = 0; aq.sfx('ui_tab'); }
      }
      return true;
    }
    // ---- context buttons on the selection
    for (const b of this.ctxButtons()) {
      if (!rectContains(b, inp.x, inp.y)) continue;
      this.hoverBtn = 'ctx:' + b.id; tip(b.tip);
      if (inp.pressed) {
        inp.consume();
        const d = this.sel;
        ({ rotl: () => this.rotate(d, -Math.PI / 8), rotr: () => this.rotate(d, Math.PI / 8), up: () => this.raise(d, 0.04), down: () => this.raise(d, -0.04), dup: () => this.duplicate(d), store: () => this.store(d), sell: () => this.sell(d) })[b.id]?.();
      }
      return true;
    }
    // ---- catalog
    const L = this.tool === 'erase' ? null : this.catLayout();
    if (L && rectContains(L.R, inp.x, inp.y)) {
      if (inp.wheel) this.scroll += inp.wheel * 30;
      for (const t of L.tabs) if (rectContains(t, inp.x, inp.y)) { this.hoverBtn = 'cat:' + t.id; if (inp.pressed) { inp.consume(); this.cat = t.id; this.scroll = 0; aq.sfx('ui_tab'); } }
      for (const t of L.tiles) {
        if (t.y + t.h < L.top || t.y > L.top + L.viewH || !rectContains(t, inp.x, inp.y)) continue;
        this.hoverBtn = 'tile:' + t.id;
        if (t.brush) tip(`${t.name}\nPaint it on the floor (wheel over the tank: brush size)`);
        else {
          const o = t.offer;
          tip(`${t.name}\n${o.kind === 'owned' ? `You own ${o.n}` : o.kind === 'buy' ? `{coin} ${fmtAero(o.price)} Aero` : o.why}`);
        }
        if (inp.pressed) { inp.consume(); if (t.brush) { this.brush[this.tool] = t.id; aq.sfx('ui_click'); } else this.pick(t.id); }
      }
      if (this.tool === 'plant' || this.tool === 'rock') {
        const s = this.sizeSlider();
        if (rectContains({ x: s.x - 4, y: s.y - 6, w: s.w + 8, h: 14 }, inp.x, inp.y) && inp.pressed) { inp.consume(); this.dragSize = true; }
      }
      if (this.dragSize && inp.down) { const s = this.sizeSlider(); this.brush.r = lerp(0.04, 0.22, clamp01((inp.x - s.x) / s.w)); }
      if (!inp.down) this.dragSize = false;
      if (inp.pressed) inp.consume();
      this.cursor = null;
      return true;
    }
    if (this.dragSize) { if (inp.down) { const s = this.sizeSlider(); this.brush.r = lerp(0.04, 0.22, clamp01((inp.x - s.x) / s.w)); return true; } this.dragSize = false; }
    // ---- the scene
    const ray = view.ray(inp.x, inp.y);
    const brush = this.tool !== 'move';
    const pr = this.press;
    if (pr) {
      const dx = inp.x - pr.lx, dy = inp.y - pr.ly;
      if (Math.hypot(inp.x - pr.x, inp.y - pr.y) > 4) pr.moved = true;
      if (pr.button === 'r') {
        if (inp.rdown) { if (pr.moved) (brush ? view.orbit(dx, dy) : view.pan(dx, dy)); }
        else { this.press = null; if (!pr.moved) { if (this.ghost) this.ghost = null; else if (this.held) this.dropHeld(true); else this.sel = null; } }
      } else if (inp.down) {
        if (brush) { /* painting below */ } else if (pr.decor && pr.moved && !this.held) this.startHold(pr.decor);
        else if (!pr.decor && pr.moved && !this.ghost) view.orbit(dx, dy);
      } else {
        this.press = null;
        if (brush) this.endStroke();
        else if (this.held) this.dropHeld();
        else if (!pr.moved) {
          if (this.ghost) this.placeGhost();
          else if (pr.decor) { this.sel = pr.decor === this.sel ? this.sel : pr.decor; aq.interact(pr.decor, true); }
          else this.sel = null;
        }
      }
      if (this.press) { this.press.lx = inp.x; this.press.ly = inp.y; }
    }
    // ghost / held piece follow the cursor
    const moving = this.held?.d || null;
    if (this.ghost || this.held) {
      const at = this.aim(ray, moving);
      if (this.ghost) { this.ghost.at = at; this.ghost.ev = at ? this.evaluate({ id: this.ghost.id, v: this.ghost.v, x: at.u, z: at.v, lift: this.ghost.lift, out: at.out }, null) : null; }
      if (this.held) {
        const h = this.held, d = h.d;
        h.at = at;
        if (at) { const ev = this.evaluate({ ...d.rec, x: at.u, z: at.v, out: at.out }, d); h.ok = ev.ok; h.why = ev.why; h.ev = ev; }
      }
    }
    // brush cursor
    this.cursor = null;
    if (brush) {
      const fp = aq.floorHit(ray);
      if (fp) {
        const T = aq.shape, u = fp[0] / T.W + 0.5, v = 0.5 - fp[2] / T.D;
        if (u > -0.05 && u < 1.05 && v > -0.05 && v < 1.05) this.cursor = { u: clamp01(u), v: clamp01(v) };
      }
      if (this.cursor && inp.down && this.press?.button === 'l') this.paintAt(this.cursor, aq.dtLast || 1 / 60);
    }
    // hover
    const hd = !brush && !this.ghost && !this.held ? aq.pickDecor(ray) : null;
    aq.hoverDecor = hd;
    if (hd && !this.press) tip(`${PROPS[hd.rec.id]?.name || 'Decoration'}\n{mouse_l} select  {mouse_hold} move  R rotate`);
    else if (this.ghost?.ev && !this.ghost.ev.ok) tip(this.ghost.ev.why);
    else if (this.held && !this.held.ok) tip(this.held.why || '');
    // wheel: rotate the ghost / held / hovered-selected piece, brush size, else zoom
    if (inp.wheel) {
      const a = inp.wheel * Math.PI / 12;
      if (this.ghost) this.ghost.yaw += a;
      else if (this.held) this.held.d.rec.r = (this.held.d.rec.r || 0) + a;
      else if (brush && this.cursor) this.brush.r = clamp(this.brush.r - inp.wheel * 0.012, 0.04, 0.22);
      else if (hd && hd === this.sel) this.rotate(hd, a);
      else view.zoom(Math.pow(1.12, inp.wheel));
    }
    if (inp.pressed && !this.press) { inp.consume(); this.press = { x: inp.x, y: inp.y, lx: inp.x, ly: inp.y, button: 'l', decor: hd, moved: false }; if (brush) this.paintT = 0; }
    if (inp.rpressed && !this.press) { inp.rpressed = false; this.press = { x: inp.x, y: inp.y, lx: inp.x, ly: inp.y, button: 'r', moved: false }; }
    return true;
  }
  sizeSlider() { const L = this.catRect(), k = L.k; return { x: L.x + 12, y: L.y + L.h - Math.round(12 * k), w: L.w - 24 }; }

  update(dt) {
    this.t += dt;
    if (this.confirm && (this.confirm.t -= dt) <= 0) this.confirm = null;
    if (this.sel && !this.aq.decor.includes(this.sel)) this.sel = null;
    const h = this.held;
    if (h) {
      const d = h.d, at = h.at, T = this.aq.shape;
      if (at) {
        const ev = h.ev || this.evaluate({ ...d.rec, x: at.u, z: at.v }, d);
        const tgt = [ev.p[0], ev.base + this.S() * 0.06 + Math.sin(this.t * 4) * T.fishLen * 0.05, ev.p[2]];
        for (let i = 0; i < 3; i++) d.p[i] = lerp(d.p[i], tgt[i], Math.min(1, dt * 14));
        d.yaw = lerp(d.yaw, d.rec.r || 0, Math.min(1, dt * 12));
      }
    }
  }

  // ------------------------------------------------------------------ 3D view hooks
  ghostView() {
    const g = this.ghost;
    if (!this.on || !g?.ev || !g.at) return null;
    const T = this.aq.shape;
    return { model: g.ev.model, k: g.ev.k, p: [g.ev.p[0], g.ev.base + this.S() * 0.04 + Math.sin(this.t * 4) * T.fishLen * 0.04, g.ev.p[2]], yaw: g.yaw, ok: g.ev.ok };
  }
  // footprint markers: [{p (floor centre), r, ok, kind}]
  marks() {
    if (!this.on) return [];
    const out = [];
    if (this.ghost?.ev && this.ghost.at) out.push({ p: this.ghost.ev.p, r: this.ghost.ev.r, ok: this.ghost.ev.ok });
    if (this.held?.ev) out.push({ p: this.held.ev.p, r: this.held.d.r, ok: this.held.ok });
    else if (this.sel?.p) out.push({ p: [this.sel.p[0], this.sel.ty, this.sel.p[2]], r: this.sel.r, ok: true, sel: true });
    if (this.aq.hoverDecor && this.aq.hoverDecor !== this.sel && !this.ghost && !this.held) { const d = this.aq.hoverDecor; out.push({ p: [d.p[0], d.ty, d.p[2]], r: d.r, ok: true, hover: true }); }
    return out;
  }
  brushView() {
    if (!this.on || !this.cursor) return null;
    const T = this.aq.shape;
    return { p: T.floorPoint(this.cursor.u, this.cursor.v, 0), r: this.brush.r * T.W, erase: this.tool === 'erase' };
  }

  // ------------------------------------------------------------------ 2D UI
  draw(ctx) {
    if (!this.on) return;
    beginThumbs(3);
    const k = this.k(), t = this.t, ink = AERO.ink;
    const font = k >= 1.4 ? 'normal' : 'small';
    // toolbar
    for (const b of this.toolbar()) {
      const on = b.id === this.tool || b.on;
      drawAeroButton(ctx, b.x, b.y, b.w, b.h, { label: b.label, icon: getUiIcon(b.icon), tone: b.tone || (on ? 'green' : 'aqua'), state: b.dis ? 'disabled' : on ? 'down' : this.hoverBtn === b.id ? 'hover' : 'normal', font });
    }
    // catalog / brush palette
    if (this.tool !== 'erase') {
      const L = this.catLayout(), R = L.R;
      drawAeroSurface(ctx, R.x, R.y, R.w, R.h, { tone: 'frost', r: 8, gloss: 0.4, glossH: 18, rim: 0.85, glow: 0.4, streak: true });
      const title = this.tool === 'plant' ? 'Plant Brush' : this.tool === 'rock' ? 'Rock Brush' : 'Decor Catalog';
      drawText(ctx, title, R.x + 8, R.y + Math.round(7 * k), { color: ink, font: k >= 1.4 ? 'big' : 'normal' });
      for (const tb of L.tabs) {
        const on = tb.id === this.cat;
        drawAeroButton(ctx, tb.x, tb.y, tb.w, tb.h, { label: tb.label, tone: on ? 'green' : 'glass', state: on ? 'down' : this.hoverBtn === 'cat:' + tb.id ? 'hover' : 'normal', font: 'small', fixedFont: true });
      }
      ctx.save();
      ctx.beginPath(); ctx.rect(R.x + 2, L.top - 2, R.w - 4, L.viewH + 4); ctx.clip();
      for (const tl of L.tiles) {
        if (tl.y + tl.h < L.top - 2 || tl.y > L.top + L.viewH) continue;
        const hov = this.hoverBtn === 'tile:' + tl.id;
        const sel = tl.brush ? this.brush[this.tool] === tl.id : this.ghost?.id === tl.id;
        const lock = tl.offer?.kind === 'locked';
        ctx.fillStyle = sel ? 'rgba(120,230,120,0.55)' : hov ? 'rgba(255,255,255,0.75)' : 'rgba(255,255,255,0.42)';
        ctx.fillRect(tl.x, tl.y, tl.w, tl.h);
        ctx.fillStyle = sel ? '#2a8a3a' : '#7fbedd';
        ctx.fillRect(tl.x, tl.y, tl.w, 1); ctx.fillRect(tl.x, tl.y + tl.h - 1, tl.w, 1); ctx.fillRect(tl.x, tl.y, 1, tl.h); ctx.fillRect(tl.x + tl.w - 1, tl.y, 1, tl.h);
        const ts = Math.round(tl.w * 0.72);
        const th = tl.brush ? brushThumb(tl.id, ts) : decorThumb(tl.id, ts);
        if (th) {
          if (lock) ctx.globalAlpha = 0.35;
          ctx.drawImage(th, Math.round(tl.x + (tl.w - th.width) / 2), Math.round(tl.y + 1 + (hov ? -1 : 0)));
          ctx.globalAlpha = 1;
        } else if ((t * 8 + tl.x) % 2 < 1) drawSparkle(ctx, tl.x + tl.w / 2, tl.y + tl.h / 2 - 4, 1, 0.8);
        // price / ownership strip
        const o = tl.offer, sy = tl.y + tl.h - 9;
        if (!o) drawText(ctx, tl.name.slice(0, 9), tl.x + tl.w / 2, sy, { font: 'small', align: 'center', color: ink });
        else if (o.kind === 'owned') { ctx.fillStyle = '#2fae3a'; ctx.fillRect(tl.x + 2, sy - 1, tl.w - 4, 8); drawText(ctx, 'x' + o.n, tl.x + tl.w / 2, sy, { font: 'small', align: 'center', color: '#ffffff' }); }
        else if (o.kind === 'buy') { drawAeroCoin(ctx, tl.x + 7, sy + 3, 3, t); drawText(ctx, fmtAero(o.price), tl.x + 12, sy, { font: 'small', color: (this.aq.st.coins || 0) >= o.price ? ink : '#c03040' }); }
        else { const ic = getUiIcon('lock'); if (ic) ctx.drawImage(ic, Math.round(tl.x + tl.w / 2 - ic.width / 2), sy - 2); }
      }
      ctx.restore();
      if (!L.tiles.length) drawText(ctx, this.cat === 'owned' ? 'Nothing stored yet.' : 'Nothing here.', R.x + R.w / 2, L.top + 10, { font: 'small', align: 'center', color: '#3c6f88' });
      if (this.tool === 'plant' || this.tool === 'rock') {
        const s = this.sizeSlider();
        drawText(ctx, 'Brush size', s.x, s.y - 12, { font: 'small', color: ink });
        ctx.fillStyle = 'rgba(12,58,82,0.25)'; ctx.fillRect(s.x, s.y, s.w, 3);
        const kx = s.x + Math.round(s.w * (this.brush.r - 0.04) / 0.18);
        ctx.fillStyle = '#3ac4f8'; ctx.fillRect(s.x, s.y, kx - s.x, 3);
        ctx.fillStyle = '#ffffff'; ctx.fillRect(kx - 3, s.y - 3, 6, 9); ctx.fillStyle = '#0c3a52'; ctx.fillRect(kx - 3, s.y + 6, 6, 1);
      }
    }
    // the selection's context bar
    for (const b of this.ctxButtons()) {
      const conf = b.id === 'sell' && this.confirm?.key === 'sell';
      drawAeroButton(ctx, b.x, b.y, b.w, b.h, { icon: getUiIcon(b.icon), tone: conf ? 'red' : b.tone || 'glass', state: this.hoverBtn === 'ctx:' + b.id ? 'hover' : 'normal', radius: 5 });
    }
    // hint line
    const W = this.game.screen.W, H = this.game.screen.H;
    const msg = this.tool === 'move'
      ? (this.ghost ? 'Click: place   R / wheel: rotate   E / Q: raise / lower   Shift: keep placing   Right-click: cancel'
        : 'Click: select   Drag: move   R: rotate   D: duplicate   Del: store   Ctrl+Z: undo   Right-drag: pan')
      : this.tool === 'erase' ? 'Drag over the floor to erase plants and rocks   Wheel: brush size   Right-drag: orbit'
        : 'Drag over the floor to paint   Wheel: brush size   Right-drag: orbit';
    const mw = measureText(msg, 'small') + 16, mh = 13;
    drawAeroSurface(ctx, Math.round(W / 2 - mw / 2), H - mh - 6, mw, mh, { tone: 'frost', r: 'pill', gloss: 0.6, glossH: 5, rim: 0.8 });
    drawText(ctx, msg, Math.round(W / 2), H - mh - 2, { font: 'small', align: 'center', color: ink });
  }
}

// a sensible height range (fraction of the water column) per brush plant
const PLANT_H = { hair: [0.06, 0.12], moss: [0.05, 0.09], sword: [0.25, 0.4], fern: [0.2, 0.32], rotala: [0.3, 0.55], vallis: [0.45, 0.8], cabomba: [0.4, 0.7], kelp: [0.6, 0.9] };
