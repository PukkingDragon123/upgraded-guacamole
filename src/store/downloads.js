// AppSea runtime (game.store): download queue driven by wall-clock timestamps (continues across reloads),
// app installs, ISP purchases and the dial-up connection state of the store window.
//
// Save data: state.apps = {
//   installed: [appId...],          // desktop icons from the store, install order
//   tiers: {appId: 0..4},           // installed tier per app
//   downloads: [{uid, app, tier, kb, done, paid, state: 'confirm'|'queued'|'active', warn, at}],
//   isp: 0..5, lastTick: ms, stats: {downloaded (KB), completed}
// }
// Events (game.emit): 'appDownloadStart' (dl), 'appInstalled' ({id, tier, tierName, label, icon, type, power,
//   upgrade, title}), 'downloadCancelled' (dl), 'ispUpgraded' (tier index).

import { CATALOG_BY_ID, APP_DEF, MAX_TIER, TIERS, listing, installedTier, bindCatalogState, formatSize } from './catalog.js';
import { ISP_TIERS, ispTier, ispSpeed } from './isp.js';
import { storeSfx } from './sfx.js';

export const WARNINGS = [
  'Are you sure? This might contain fish.',
  'Warning: AppSea detected 3 fish in this file.',
  'Publisher could not be verified. It is a crab.',
  'This file is 12% water. Download anyway?',
];

// Apps a pre-store save already had on its desktop: keep them so veterans keep their bait.
const LEGACY_APPS = ['fishnet', 'documents', 'photos', 'music', 'games', 'mail', 'notes', 'terminal', 'settings', 'calculator', 'calendar', 'chat', 'paint', 'videos', 'fishtop'];

export function defaultAppsState() {
  return { installed: [], tiers: {}, downloads: [], isp: 0, lastTick: Date.now(), stats: { downloaded: 0, completed: 0 } };
}

export function ensureStoreState(state) {
  if (!state.apps || typeof state.apps !== 'object') {
    state.apps = defaultAppsState();
    if (state.tutorialDone) for (const id of LEGACY_APPS) { state.apps.installed.push(id); state.apps.tiers[id] = 0; }
  }
  const a = state.apps;
  a.installed ||= [];
  a.tiers ||= {};
  a.downloads ||= [];
  a.isp ??= 0;
  a.lastTick ||= Date.now();
  a.stats ||= { downloaded: 0, completed: 0 };
  a.installed = a.installed.filter((id) => APP_DEF[id]);
  a.downloads = a.downloads.filter((d) => d && CATALOG_BY_ID[d.app] && d.kb > 0);
  state.boat ||= { tier: 0 };
  state.boat.tier ??= 0;
  return a;
}

let uidN = 0;

export class Store {
  constructor(game) {
    this.game = game;
    ensureStoreState(game.state);
    bindCatalogState(game.state);
    this.recent = []; // finished this session: {app, tier, kb, secs, file, at}
    this.connected = false;
    this.connecting = null; // {t0, dur}
    this.jitter = 1;
    this.lastJ = 0;
    this.listeners = [];
    this.tick();
  }

  get st() { return this.game.state.apps; }
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
  downloadOf(appId) { return this.st.downloads.find((d) => d.app === appId) || null; }
  tierOf(appId) { return installedTier(appId, this.game.state); }
  isInstalled(appId) { return this.st.installed.includes(appId); }

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
  // Starts (or queues) the next tier of an app. Returns the download or null (with feedback).
  request(appId, opts = {}) {
    const g = this.game, st = this.st;
    const fam = CATALOG_BY_ID[appId];
    if (!fam) return null;
    if (this.downloadOf(appId)) { this.say(`${fam.name} is already downloading.`, 'clock'); return null; }
    const tier = opts.tier ?? this.nextTier(appId);
    if (tier < 0 || tier > MAX_TIER || tier <= this.tierOf(appId)) { this.say(`${fam.name} is fully installed.`, 'check'); return null; }
    const L = listing(appId, tier);
    if (L.price > 0) {
      if ((g.state.coins || 0) < L.price) {
        g.audio?.play('ui_error');
        this.say(`${L.title} costs ${L.price} coins. Catch more fish!`, 'coin');
        return null;
      }
      g.state.coins -= L.price;
      g.audio?.play('ui_buy');
    } else g.audio?.play('ui_click');
    this.tick();
    const firstEver = !st.stats.completed && !st.downloads.length;
    const warn = !opts.noWarn && !firstEver && (fam.alwaysWarn || Math.random() < 0.2);
    const dl = {
      uid: Date.now().toString(36) + (uidN++).toString(36), app: appId, tier, kb: L.kb, done: 0, paid: L.price,
      state: warn ? 'confirm' : 'queued', warn: warn ? (fam.alwaysWarn ? 2 : Math.floor(Math.random() * WARNINGS.length)) : -1, at: Date.now(),
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
    this.say(msg || (d.paid ? `Download cancelled. ${d.paid} coins refunded.` : 'Download cancelled.'), 'cross');
    g.emit?.('downloadCancelled', d);
    g.save?.();
  }

  finish(d) {
    const st = this.st;
    st.downloads = st.downloads.filter((x) => x !== d);
    st.stats.downloaded += d.kb;
    st.stats.completed++;
    const L = listing(d.app, d.tier);
    this.recent.unshift({ app: d.app, tier: d.tier, kb: d.kb, secs: d.secs || 0, file: L.file, at: Date.now() });
    this.recent.length = Math.min(this.recent.length, 6);
    this.install(d.app, d.tier);
  }

  install(appId, tier, quiet = false) {
    const g = this.game, st = this.st;
    const def = APP_DEF[appId];
    if (!def) return null;
    const prev = this.tierOf(appId);
    st.tiers[appId] = Math.max(prev, tier);
    const upgrade = st.installed.includes(appId);
    if (!upgrade) st.installed.push(appId);
    const L = listing(appId, st.tiers[appId]);
    const info = { id: appId, tier: st.tiers[appId], tierName: TIERS[st.tiers[appId]].name, label: def.label, icon: def.icon, type: def.type, power: L.power, upgrade, title: L.title };
    if (!quiet) {
      storeSfx('complete');
      g.toast?.(upgrade ? `Download complete: ${L.title}! Bait power is now x${L.power.toFixed(2)}.` : `Download complete: ${L.title} is on your desktop!`, 'check');
    }
    g.emit?.('appInstalled', info);
    g.save?.();
    return info;
  }

  buyIsp(i) {
    const g = this.game, st = this.st;
    const plan = ISP_TIERS[i];
    if (!plan || i <= st.isp) return false;
    if ((g.state.coins || 0) < plan.price) {
      g.audio?.play('ui_error');
      this.say(`${plan.name} costs ${plan.price} coins. SlowNet does not accept fish.`, 'coin');
      return false;
    }
    this.tick();
    g.state.coins -= plan.price;
    st.isp = i;
    this.connected = false;
    g.audio?.play('ui_buy');
    const x = Math.round(plan.speed / ISP_TIERS[0].speed);
    this.say(`Welcome to ${plan.name}! Downloads are ${x.toLocaleString('en')}x faster than dial-up.`, 'sparkle');
    g.emit?.('ispUpgraded', i);
    g.save?.();
    return true;
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
  }

  openDialog(near) {
    const desk = this.game.desktop;
    if (!desk?.openApp) return null;
    const ex = desk.windows?.find((w) => w.app === 'appsea_dl');
    if (ex) { ex.min = false; desk.focus?.(ex); return ex; }
    const sw = near || desk.windows?.find((w) => w.app === 'appsea');
    const W = this.game.screen?.W || 960, H = this.game.screen?.H || 540;
    const opts = sw ? { x: Math.max(4, Math.min(W - 280, sw.x + sw.w - 200)), y: Math.max(4, Math.min(H - 190, sw.y + sw.h - 110)) } : {};
    return desk.openApp('appsea_dl', opts);
  }

  say(text, icon) { this.game.toast?.(text, icon); }

  describe(d) {
    const L = listing(d.app, d.tier);
    return `${L.title} (${formatSize(d.kb)})`;
  }
}

export function installStore(game) {
  if (game.store) return game.store;
  const s = new Store(game);
  game.store = s;
  s.timer = setInterval(() => { try { s.tick(); } catch (e) { console.error(e); } }, 250);
  return s;
}
