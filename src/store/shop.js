// Bait Shop runtime (phase 4, Shell agent; replaces the AppSea download queue). Dot runs a little Aero bait shop:
// consumable bait packs bought with Aero, limited stock that restocks on a timer, one discounted deal per restock.
// Shop levels researched in The Lab (src/store/isp.js) open better grades, restock faster and give a discount.
//
// Offers: classics use the bait id ('crumbs', 'worm', ...); flavour lines use '<lineId>:<grade>' ('notes:0').
// Save: state.shop = {stock: {offerId: packsLeft}, restockAt: ms, deal: offerId | null, sold: n, seen: restockAt}
//       state.apps.tiers[lineId] keeps the best grade bought (baitMods / old saves).
//
//   new BaitShop(game) -> game.store (installStore(game) is idempotent)
//   store.offer(id) -> {id, kind: 'special'|'line', bait, def, name, qty, price, base, stock, max, free, deal,
//                       grade, line, locked: null | {reason: 'lab'|'grade', node, label}}
//   store.classics() -> [offer], store.lines() -> [{line, grades: [offer x5]}]
//   store.buy(id) -> {ok, reason?: 'locked'|'soldout'|'aero', offer}
//   store.restockIn() -> seconds, store.level() -> SHOP_LEVELS entry, store.tick()
// Events (game.emit): 'baitBought' ({id, offer, bait, qty, price}), 'baitDownloaded' (same payload as phase 3:
//   {id, qty, app, tier, title, special} - kept for listeners), 'shopRestock'.
// Phase-3 compat for scripts: request(lineId, {tier}), requestBait(id), confirm(), cancel(), active(), pending().

import { CATALOG, CATALOG_BY_ID, TIERS, MAX_TIER, listing, bindCatalogState } from './catalog.js';
import { SHOP_LEVELS, shopLevel } from './isp.js';
import { BAITS, SPECIAL_ORDER, addBait, ensureBait } from './bait.js';
import { LAB_NODES, unlocked, nodeFor } from '../game/lab.js';
import { CURRENCY } from '../ui/aero.js';

const DEAL_OFF = 0.3;
const SPECIAL_STOCK = { crumbs: 1, bread: 4, worm: 3, sugar: 3, chip: 3, popup: 3, flood: 1, lantern: 2, golden: 1, blackhole: 1, relic: 1 };
const GRADE_STOCK = [1, 3, 3, 2, 1];

export function defaultAppsState() {
  return { installed: [], tiers: {}, downloads: [], isp: 0, lastTick: Date.now(), stats: { downloaded: 0, completed: 0 } };
}

export function ensureStoreState(state) {
  if (!state.apps || typeof state.apps !== 'object') state.apps = defaultAppsState();
  const a = state.apps;
  a.installed ||= [];
  a.tiers ||= {};
  a.downloads = []; // the download queue is gone; nothing waits on it
  a.stats ||= { downloaded: 0, completed: 0 };
  a.installed = a.installed.filter((id) => CATALOG_BY_ID[id]);
  state.boat ||= { tier: 0 };
  state.boat.tier ??= 0;
  const s = (state.shop && typeof state.shop === 'object') ? state.shop : (state.shop = {});
  if (!s.stock || typeof s.stock !== 'object') s.stock = {};
  s.restockAt = Number.isFinite(s.restockAt) ? s.restockAt : 0;
  s.sold = s.sold | 0;
  if (s.deal !== null && typeof s.deal !== 'string') s.deal = null;
  return a;
}

// Classic bait is gated by a Lab unlock 'bait:<id>' when the Lab defines one; otherwise it is always sold.
let GATED = null; // bait ids some Lab node unlocks (LAB_NODES is static)
export function specialAvailable(state, id) {
  if (!BAITS[id] || BAITS[id].app) return false;
  if (!GATED) {
    GATED = new Set();
    try { for (const n of LAB_NODES || []) for (const u of n.unlock || []) if (u.kind === 'bait') GATED.add(u.id); } catch { /* no Lab */ }
  }
  if (!GATED.has(id)) return true;
  try { return !!unlocked(state, 'bait', id); } catch { return true; }
}

function labNode(kind, id) {
  try { return nodeFor(kind, id) || null; } catch { return null; }
}

export class BaitShop {
  constructor(game) {
    this.game = game;
    this.recent = [];
    this.st; // ensure state
    this.tick();
  }

  get state() { return this.game.state; }

  get st() {
    const state = this.game.state;
    if (state !== this.boundState || !state.shop || !state.apps) { this.boundState = state; bindCatalogState(state); ensureStoreState(state); }
    return state.shop;
  }

  level() { return SHOP_LEVELS[shopLevel(this.game.state)]; }
  levelIndex() { return shopLevel(this.game.state); }

  // ------------------------------------------------------------ offers
  maxStock(id) {
    const lv = this.level();
    if (BAITS[id] && !BAITS[id].app) {
      const n = SPECIAL_STOCK[id] ?? 2;
      return BAITS[id].price > 0 ? n + lv.stock : n;
    }
    const g = Number(String(id).split(':')[1]) | 0;
    return g === 0 ? GRADE_STOCK[0] : (GRADE_STOCK[g] ?? 1) + lv.stock;
  }

  stockOf(id) {
    const s = this.st;
    if (typeof s.stock[id] !== 'number') s.stock[id] = this.maxStock(id);
    return Math.max(0, s.stock[id] | 0);
  }

  priceFor(base, id) {
    if (!(base > 0)) return 0;
    const lv = this.level();
    let p = base * (1 - lv.discount);
    if (this.st.deal === id) p *= 1 - DEAL_OFF;
    return Math.max(1, Math.round(p));
  }

  offer(id) {
    const state = this.game.state;
    if (BAITS[id] && !BAITS[id].app) {
      const def = BAITS[id];
      let locked = null;
      if (!specialAvailable(state, id)) {
        const nd = labNode('bait', id);
        locked = { reason: 'lab', node: nd?.id || null, label: nd?.name || 'The Lab' };
      }
      const base = def.price || 0;
      return {
        id, kind: 'special', bait: id, def, name: def.name, qty: def.pack, base, price: this.priceFor(base, id),
        stock: this.stockOf(id), max: this.maxStock(id), free: base <= 0, deal: this.st.deal === id, locked, grade: -1, line: null,
      };
    }
    const [line, gs] = String(id).split(':');
    const fam = CATALOG_BY_ID[line];
    if (!fam) return null;
    const grade = Math.max(0, Math.min(MAX_TIER, Number(gs) | 0));
    const L = listing(line, grade);
    const def = BAITS[L.bait];
    let locked = null;
    if (grade > this.level().grade) {
      const need = SHOP_LEVELS.find((lv) => lv.grade >= grade) || SHOP_LEVELS[SHOP_LEVELS.length - 1];
      const nd = need.feature ? labNode('feature', need.feature) : null;
      locked = { reason: 'grade', node: nd?.id || null, label: need.name, level: need };
    }
    const oid = `${line}:${grade}`;
    return {
      id: oid, kind: 'line', bait: L.bait, def, name: def?.name || L.title, qty: L.qty, base: L.price, price: this.priceFor(L.price, oid),
      stock: this.stockOf(oid), max: this.maxStock(oid), free: L.price <= 0, deal: this.st.deal === oid, locked, grade, line, fam,
    };
  }

  classics() { return SPECIAL_ORDER.map((id) => this.offer(id)).filter(Boolean); }

  lines() { return CATALOG.map((fam) => ({ line: fam, grades: TIERS.map((_, g) => this.offer(`${fam.id}:${g}`)) })); }

  // the best grade of a line the player can buy right now (for its tile)
  bestGrade(lineId) {
    const max = this.level().grade;
    for (let g = max; g >= 0; g--) { const o = this.offer(`${lineId}:${g}`); if (o && !o.locked && o.stock > 0) return g; }
    return 0;
  }

  // ------------------------------------------------------------ restock
  restockIn(now = Date.now()) { return Math.max(0, (this.st.restockAt - now) / 1000); }

  restock(now = Date.now(), quiet = false) {
    const s = this.st;
    s.stock = {};
    const pool = [...this.classics(), ...this.lines().flatMap((l) => l.grades)].filter((o) => o && !o.locked && !o.free);
    s.deal = pool.length ? pool[Math.floor(Math.random() * pool.length)].id : null;
    s.restockAt = now + this.level().restock * 1000;
    if (!quiet) this.game.emit?.('shopRestock', { deal: s.deal });
  }

  tick(now = Date.now()) {
    const s = this.st;
    if (!s.restockAt) { this.restock(now, true); return; }
    if (now >= s.restockAt) this.restock(now);
  }

  update() { this.tick(); }

  // ------------------------------------------------------------ buying
  buy(id, opts = {}) {
    const g = this.game, state = g.state;
    this.tick();
    const o = this.offer(id);
    if (!o) return { ok: false, reason: 'unknown' };
    if (o.locked) { if (!opts.quiet) g.audio?.play('ui_error'); return { ok: false, reason: 'locked', offer: o }; }
    if (o.stock <= 0) { if (!opts.quiet) g.audio?.play('ui_error'); return { ok: false, reason: 'soldout', offer: o }; }
    if ((state.coins || 0) < o.price) { if (!opts.quiet) g.audio?.play('ui_error'); return { ok: false, reason: 'aero', offer: o }; }
    state.coins -= o.price;
    this.st.stock[o.id] = o.stock - 1;
    this.st.sold++;
    ensureBait(state);
    addBait(state, o.bait, o.qty);
    if (o.kind === 'line') {
      const a = state.apps;
      a.tiers[o.line] = Math.max(a.tiers[o.line] ?? -1, o.grade);
      if (!a.installed.includes(o.line)) a.installed.push(o.line);
    }
    this.recent.unshift({ id: o.id, bait: o.bait, qty: o.qty, price: o.price, at: Date.now() });
    this.recent.length = Math.min(this.recent.length, 6);
    if (!opts.quiet) {
      g.audio?.play(o.price > 0 ? 'ui_buy' : 'ui_unlock');
      g.toast?.(`+${o.qty} ${o.name}`, 'bait');
    }
    const info = { id: o.bait, offer: o.id, bait: o.bait, qty: o.qty, price: o.price, app: o.line, tier: o.grade, title: o.name, special: o.kind === 'special' };
    g.emit?.('baitBought', info);
    g.emit?.('baitDownloaded', info);
    g.save?.();
    return { ok: true, offer: o };
  }

  // ------------------------------------------------------------ phase-3 compat (scripts, tutorial)
  request(appId, opts = {}) {
    const g = Math.max(0, Math.min(MAX_TIER, opts.tier ?? 0));
    const r = this.buy(`${appId}:${g}`, opts);
    return r.ok ? { uid: 'shop' + Date.now().toString(36), app: appId, tier: g, state: 'done', done: 1, kb: 1 } : null;
  }

  requestBait(id, opts = {}) {
    const r = this.buy(id, opts);
    return r.ok ? { uid: 'shop' + Date.now().toString(36), bait: id, state: 'done', done: 1, kb: 1 } : null;
  }

  confirm() {}
  cancel() {}
  active() { return null; }
  pending() { return null; }
  queued() { return []; }
  say(text, icon) { this.game.toast?.(text, icon); }
  describe(o) { return o?.name || ''; }
  get currency() { return CURRENCY; }
}

export function installStore(game) {
  if (game.store) return game.store;
  const s = new BaitShop(game);
  game.store = s;
  return s;
}
