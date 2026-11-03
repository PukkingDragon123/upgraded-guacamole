// AppSea runtime (game.store): download queue driven by wall-clock timestamps (continues across reloads) and the
// dial-up connection state of the store window. Phase 3: a finished download delivers a BAIT PACK into the bait
// inventory (src/store/bait.js) instead of a desktop icon; app tiers unlock in order; internet speed comes from
// Lab unlocks (src/store/isp.js).
//
// Save data: state.apps = {
//   installed: [appId...],          // apps downloaded at least once (no desktop icons any more)
//   tiers: {appId: 0..4},           // best tier downloaded per app (the next tier unlocks for download)
//   downloads: [{uid, app, tier, kb, done, paid, state: 'confirm'|'queued'|'active', warn, at}
//              | {uid, bait: specialId, kb, ...}],
//   isp: legacy bought plan, lastTick: ms, stats: {downloaded (KB), completed}
// }
// Events (game.emit): 'appDownloadStart' (dl), 'baitDownloaded' ({id, qty, app, tier, title, special}),
//   'appInstalled' (same info as before, kept for listeners), 'downloadCancelled' (dl).

import { CATALOG_BY_ID, APP_DEF, MAX_TIER, TIERS, listing, installedTier, bindCatalogState, formatSize } from './catalog.js';
import { ISP_TIERS, ispTier, ispSpeed } from './isp.js';
import { storeSfx } from './sfx.js';
import { BAITS, SPECIAL_SHOP, addBait, ensureBait } from './bait.js';
import { LAB_NODES, unlocked } from '../game/lab.js';
import { CURRENCY } from '../ui/aero.js';

export const WARNINGS = [
  'Are you sure? This might contain fish.',
  'Warning: AppSea detected 3 fish in this file.',
  'Publisher could not be verified. It is a crab.',
  'This file is 12% water. Download anyway?',
];

// Apps a pre-store save already had on its desktop: they count as downloaded (Lite) so tiers stay unlocked.
const LEGACY_APPS = ['fishnet', 'documents', 'photos', 'music', 'games', 'mail', 'notes', 'terminal', 'settings', 'calculator', 'calendar', 'chat', 'paint', 'videos', 'fishtop'];

export function defaultAppsState() {
  return { installed: [], tiers: {}, downloads: [], isp: 0, lastTick: Date.now(), stats: { downloaded: 0, completed: 0 } };
}

export function ensureStoreState(state) {
  if (!state.apps || typeof state.apps !== 'object') {
    state.apps = defaultAppsState();
    const veteran = (state.stats?.caught || 0) > 0 || (state.fish?.length || 0) > 0;
    if (veteran) for (const id of LEGACY_APPS) { state.apps.installed.push(id); state.apps.tiers[id] = 0; }
  }
  const a = state.apps;
  a.installed ||= [];
  a.tiers ||= {};
  a.downloads ||= [];
  a.isp ??= 0;
  a.lastTick ||= Date.now();
  a.stats ||= { downloaded: 0, completed: 0 };
  a.installed = a.installed.filter((id) => APP_DEF[id]);
  a.downloads = a.downloads.filter((d) => d && d.kb > 0 && (d.bait ? BAITS[d.bait] : CATALOG_BY_ID[d.app]));
  state.boat ||= { tier: 0 };
  state.boat.tier ??= 0;
  return a;
}

// Special bait is gated by Lab unlocks 'bait:<id>' when the Lab defines such a node; otherwise it is open.
export function specialAvailable(state, id) {
  if (!BAITS[id] || !SPECIAL_SHOP[id]) return false;
  let gated = false;
  try { gated = (LAB_NODES || []).some((n) => (n.unlock || []).some((u) => u.kind === 'bait' && u.id === id)); } catch { gated = false; }
  if (!gated) return true;
  try { return !!unlocked(state, 'bait', id); } catch { return true; }
}

// Uniform description of a download (app pack or special bait).
export function dlInfo(d) {
  if (d.bait) {
    const b = BAITS[d.bait], sh = SPECIAL_SHOP[d.bait] || {};
    const t = sh.title || b.name;
    const file = /\.(exe|zip|iso)$/i.test(t) ? t.toLowerCase().replace(/\s+/g, '_') : t.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') + '_setup.exe';
    return { title: sh.title || b.name, file, kb: d.kb, bait: d.bait, qty: b.pack, art: b.art, icon: null, special: true, name: b.name };
  }
  const L = listing(d.app, d.tier);
  return { title: L.title, file: L.file, kb: d.kb, bait: L.bait, qty: L.qty, art: BAITS[L.bait]?.art, icon: L.icon, tier: d.tier, app: d.app, name: BAITS[L.bait]?.name || L.title };
}

let uidN = 0;

export class Store {
  constructor(game) {
    this.game = game;
    ensureStoreState(game.state);
    bindCatalogState(game.state);
    this.recent = []; // finished this session: {app, tier, bait, qty, kb, secs, file, title, at}
    this.connected = false;
    this.connecting = null; // {t0, dur}
    this.jitter = 1;
    this.lastJ = 0;
    this.tick();
  }

  get st() {
    const state = this.game.state;
    if (state !== this.boundState) { this.boundState = state; ensureStoreState(state); bindCatalogState(state); }
    return state.apps || ensureStoreState(state);
  }
  speed() { return ispSpeed(this.game.state); }
  isp() { return ISP_TIERS[ispTier(this.game.state)]; }

  // Displayed transfer rate wobbles like a real modem (progress itself uses the steady rate).
  shownSpeed(now = Date.now()) {
    if (now - this.lastJ > 600) { this.lastJ = now; this.jitter = 0.86 + Math.random() * 0.2; }
    return this.speed() * this.jitter;
  }

  active() { return this.st.downloads.find((d) => d.state !== 'confirm') || null; }
  pending() { return this.st.downloads.find((d) => d.state === 'confirm') || null; }
  queued() { return this.st.downloads.filter((d) => d.state !== 'confirm'); }
  downloadOf(appId) { return this.st.downloads.find((d) => d.app === appId && !d.bait) || null; }
  downloadOfBait(id) { return this.st.downloads.find((d) => d.bait === id) || null; }
  tierOf(appId) { return installedTier(appId, this.game.state); }
  isInstalled(appId) { return this.st.installed.includes(appId); }
  // Highest tier that may be downloaded now (tiers unlock one at a time).
  maxTier(appId) { return Math.min(MAX_TIER, this.tierOf(appId) + 1); }

  nextTier(appId) {
    const t = this.tierOf(appId);
    return t >= MAX_TIER ? -1 : t + 1;
  }

  // Seconds of queue time before (and including) a download.
  eta(dl) {
    const sp = this.speed();
    let s = 0;
    for (const d of this.queued()) {
      s += (d.kb - d.done) / sp;
      if (d === dl) break;
    }
    return s;
  }

  // ------------------------------------------------------------ time
  tick(now = Date.now()) {
    const st = this.st;
    let el = (now - (st.lastTick || now)) / 1000;
    st.lastTick = now;
    if (!(el > 0)) return;
    el = Math.min(el, 60 * 86400);
    const sp = this.speed();
    const done = [];
    for (const d of st.downloads) {
      if (d.state === 'confirm') continue;
      if (el <= 0) { d.state = 'queued'; continue; }
      d.state = 'active';
      const need = (d.kb - d.done) / sp;
      if (need <= el) {
        el -= need;
        d.secs = (d.secs || 0) + need;
        d.done = d.kb;
        done.push(d);
      } else {
        d.done += el * sp;
        d.secs = (d.secs || 0) + el;
        el = 0;
      }
    }
    for (const d of done) this.finish(d);
  }

  update() { this.tick(); }

  // ------------------------------------------------------------ actions
  // Starts (or queues) a bait-pack download of an app (opts.tier, default: the best tier allowed).
  request(appId, opts = {}) {
    const g = this.game, st = this.st;
    const fam = CATALOG_BY_ID[appId];
    if (!fam) return null;
    if (this.downloadOf(appId)) { this.say(`${fam.name} is already downloading.`, 'clock'); return null; }
    const tier = Math.max(0, Math.min(this.maxTier(appId), opts.tier ?? this.maxTier(appId)));
    const L = listing(appId, tier);
    if (!this.pay(L.price, L.title)) return null;
    return this.enqueue({ app: appId, tier, kb: L.kb, paid: L.price }, fam.alwaysWarn, opts);
  }

  // Special bait (Bait & Tackle).
  requestBait(id, opts = {}) {
    const b = BAITS[id];
    if (!b || !SPECIAL_SHOP[id]) return null;
    if (!specialAvailable(this.game.state, id)) { this.say(`${b.name} is locked. Research it in The Lab!`, 'lock'); return null; }
    if (this.downloadOfBait(id)) { this.say(`${SPECIAL_SHOP[id].title} is already downloading.`, 'clock'); return null; }
    if (!this.pay(b.price, SPECIAL_SHOP[id].title)) return null;
    return this.enqueue({ bait: id, kb: b.kb, paid: b.price }, id === 'blackhole' || id === 'relic', opts);
  }

  pay(price, title) {
    const g = this.game;
    if (price > 0) {
      if ((g.state.coins || 0) < price) {
        g.audio?.play('ui_error');
        this.say(`${title} costs ${price} ${CURRENCY}. Catch more fish!`, 'coin');
        return false;
      }
      g.state.coins -= price;
      g.audio?.play('ui_buy');
    } else g.audio?.play('ui_click');
    return true;
  }

  enqueue(fields, alwaysWarn, opts) {
    const g = this.game, st = this.st;
    this.tick();
    const firstEver = !st.stats.completed && !st.downloads.length;
    const warn = !opts.noWarn && !firstEver && (alwaysWarn || Math.random() < 0.2);
    const dl = {
      uid: Date.now().toString(36) + (uidN++).toString(36), done: 0, ...fields,
      state: warn ? 'confirm' : 'queued', warn: warn ? (alwaysWarn ? 2 : Math.floor(Math.random() * WARNINGS.length)) : -1, at: Date.now(),
    };
    st.downloads.push(dl);
    this.tick();
    g.emit?.('appDownloadStart', dl);
    if (opts.dialog !== false) this.openDialog(opts.near);
    g.save?.();
    return dl;
  }

  confirm(uid, yes) {
    const d = this.st.downloads.find((x) => x.uid === uid);
    if (!d) return;
    if (!yes) { this.cancel(uid, 'Download cancelled. No fish were harmed.'); return; }
    this.tick();
    d.state = 'queued';
    this.tick();
    this.game.audio?.play('ui_click');
  }

  cancel(uid, msg) {
    const st = this.st, g = this.game;
    const d = st.downloads.find((x) => x.uid === uid);
    if (!d) return;
    this.tick();
    st.downloads = st.downloads.filter((x) => x !== d);
    if (d.paid) g.state.coins += d.paid;
    g.audio?.play('ui_close');
    this.say(msg || (d.paid ? `Download cancelled. ${d.paid} ${CURRENCY} refunded.` : 'Download cancelled.'), 'cross');
    g.emit?.('downloadCancelled', d);
    g.save?.();
  }

  finish(d) {
    const st = this.st;
    st.downloads = st.downloads.filter((x) => x !== d);
    st.stats.downloaded += d.kb;
    st.stats.completed++;
    const info = dlInfo(d);
    this.recent.unshift({ app: d.app, tier: d.tier, bait: info.bait, qty: info.qty, kb: d.kb, secs: d.secs || 0, file: info.file, title: info.title, at: Date.now() });
    this.recent.length = Math.min(this.recent.length, 6);
    if (d.bait) this.deliver(info);
    else this.install(d.app, d.tier);
  }

  deliver(info, quiet = false) {
    const g = this.game;
    ensureBait(g.state);
    addBait(g.state, info.bait, info.qty);
    if (!quiet) {
      storeSfx('complete');
      g.toast?.(`+${info.qty} ${info.name} bait!`, 'bait');
    }
    g.emit?.('baitDownloaded', { id: info.bait, qty: info.qty, app: info.app || null, tier: info.tier ?? -1, title: info.title, special: !!info.special });
    g.save?.();
  }

  // Records the downloaded tier (unlocking the next one) and delivers the bait pack.
  install(appId, tier, quiet = false) {
    const g = this.game, st = this.st;
    const def = APP_DEF[appId];
    if (!def || !CATALOG_BY_ID[appId]) return null;
    const prev = this.tierOf(appId);
    st.tiers[appId] = Math.max(prev, tier);
    const upgrade = st.installed.includes(appId);
    if (!upgrade) st.installed.push(appId);
    const L = listing(appId, tier);
    this.deliver({ bait: L.bait, qty: L.qty, name: BAITS[L.bait]?.name || L.title, title: L.title, app: appId, tier }, quiet);
    const info = { id: appId, tier: st.tiers[appId], tierName: TIERS[st.tiers[appId]].name, label: def.label, icon: def.icon, type: def.type, power: L.power, upgrade, title: L.title, bait: L.bait, qty: L.qty };
    g.emit?.('appInstalled', info);
    return info;
  }

  // Internet plans come from The Lab now.
  buyIsp() {
    const g = this.game;
    this.say('Faster internet is researched in The Lab!', 'info');
    if (g.ui?.panels?.lab) g.ui.open('lab', { focus: 'isp' });
    return false;
  }

  // ------------------------------------------------------------ store window helpers
  connect(now) {
    if (this.connected || this.connecting) return;
    const plan = this.isp();
    if (!plan.connect) { this.connected = true; return; }
    this.connecting = { t0: now, dur: plan.connect };
    storeSfx(plan.screech ? 'modem' : 'connect');
  }

  updateConnect(now) {
    if (this.connecting && now - this.connecting.t0 >= this.connecting.dur) {
      this.connecting = null;
      this.connected = true;
      storeSfx('blip');
    }
    // a faster plan researched while the window is open reconnects instantly
    if (this.connected && this.connectedTier !== ispTier(this.game.state)) this.connectedTier = ispTier(this.game.state);
  }

  openDialog(near) {
    const desk = this.game.desktop;
    if (!desk?.openApp) return null;
    const ex = desk.windows?.find((w) => w.app === 'appsea_dl');
    if (ex) { ex.min = false; desk.focus?.(ex); return ex; }
    const sw = near || desk.windows?.find((w) => w.app === 'appsea');
    const W = this.game.screen?.W || 960, H = this.game.screen?.H || 540;
    const opts = sw ? { x: Math.max(4, Math.min(W - 290, sw.x + sw.w - 210)), y: Math.max(4, Math.min(H - 200, sw.y + sw.h - 120)) } : {};
    return desk.openApp('appsea_dl', opts);
  }

  say(text, icon) { this.game.toast?.(text, icon); }

  describe(d) {
    const i = dlInfo(d);
    return `${i.title} (${formatSize(d.kb)})`;
  }
}

export function installStore(game) {
  if (game.store) return game.store;
  const s = new Store(game);
  game.store = s;
  s.timer = setInterval(() => { try { s.tick(); } catch (e) { console.error(e); } }, 250);
  return s;
}
