// AppSea store: public entry point for the orchestrator.
//
//   installStore(game) -> Store (game.store). Idempotent. Creates/migrates state.apps + state.boat and ticks
//     downloads every 250 ms on wall-clock time (finished-while-away downloads install on load).
//   STORE_RENDERERS  window renderers to merge into APP_RENDERERS: appsea (the website), appsea_dl (download
//     dialog), moreram, notavirus (two new Weird apps).
//   desktopIconDefs(state) -> APPS entries that belong on the desktop now (system + installed), each with
//     {id, label, type, icon (with '@tier' badge suffix), app, tier, nobait}.
//   syncDesktopIcons(desktop, state) adds/removes/updates Desktop icon objects to match (call after
//     constructing the Desktop and on 'appInstalled'); new icons pop in with a shake.
//   openStore(game, {page, highlight}) opens the AppSea window (page: 'home'|category id|'isp'|'downloads').
//   baitPower(appId) / baitMods(appId) -> bait strength of an installed app icon (see catalog.js):
//     mods = {power 1..~3.8, attract (x interest), sizeBonus (+rollMods.sizeBonus), rarity (x rarityBoost),
//     giantMul (x rollMods.giantChance)}.
//   boatBonus(state, key) boat perks (see boats.js), BOAT_TIERS, ISP_TIERS, CATALOG, TIERS.

import { APPS } from '../desktop/icons.js';
import { ensureStoreState, installStore } from './downloads.js';
import { STORE_RENDERERS } from './storeapp.js';

export { Store, ensureStoreState, defaultAppsState, installStore, WARNINGS } from './downloads.js';
export { CATALOG, CATALOG_BY_ID, CATEGORIES, TIERS, MAX_TIER, listing, baitPower, baitPowerAt, baitMods, installedTier, formatSize, formatSpeed, formatTime } from './catalog.js';
export { ISP_TIERS, ispSpeed, ispTier } from './isp.js';
export { BOAT_TIERS, BOAT_PERKS, boatBonus, boatTier, buyBoat } from './boats.js';
export { STORE_RENDERERS } from './storeapp.js';
export { storeSfx } from './sfx.js';

export const TUTORIAL_APP = 'notes';

export function desktopIconDefs(state) {
  ensureStoreState(state);
  const a = state.apps;
  return APPS.filter((d) => !d.hidden && (d.system || a.installed.includes(d.id))).map((d) => {
    const tier = d.system ? 0 : a.tiers[d.id] || 0;
    return { id: d.id, label: d.label, type: d.type, icon: tier ? `${d.icon}@${tier}` : d.icon, app: d.app || d.id, tier, nobait: !!d.nobait };
  });
}

export function syncDesktopIcons(desktop, state) {
  const defs = desktopIconDefs(state);
  const want = new Map(defs.map((d) => [d.id, d]));
  let changed = false;
  const keep = desktop.icons.filter((ic) => {
    if (want.has(ic.id)) return true;
    if (ic.thief) ic.thief.carry = null;
    changed = true;
    return false;
  });
  for (const ic of keep) {
    const d = want.get(ic.id);
    if (ic.icon !== d.icon) { ic.icon = d.icon; ic.shake = 0.6; changed = true; }
    ic.tier = d.tier;
    ic.nobait = d.nobait;
  }
  for (const d of defs) {
    if (keep.some((ic) => ic.id === d.id)) continue;
    keep.push({
      id: d.id, label: d.label, type: d.type, icon: d.icon, app: d.app, tier: d.tier, nobait: d.nobait,
      gx: 0, gy: keep.length, x: 0, y: 0, w: (desktop.constructor.CELL_W || 74) - 8, h: 58,
      state: 'normal', offX: 0, offY: 0, shake: 0.8, hover: 0, sel: false, chewed: 0, alpha: 0,
    });
    changed = true;
  }
  if (changed) {
    desktop.icons = keep;
    desktop.layoutDirty = true;
    const ids = new Set(keep.map((i) => i.id));
    state.baitBox = (state.baitBox || []).filter((id) => ids.has(id) || String(id).startsWith('file:'));
    if (state.equipped?.kind === 'icon' && !ids.has(state.equipped.id)) state.equipped = null;
  }
  return changed;
}

export function openStore(game, opts = {}) {
  installStore(game);
  const desk = game.desktop;
  if (!desk?.openApp) return null;
  const w = desk.openApp('appsea', opts.x !== undefined ? { x: opts.x, y: opts.y } : {
    x: Math.max(8, Math.round((game.screen.W - 420) / 2) - 40), y: Math.max(8, Math.round((game.screen.H - 300) / 2) - 30),
  });
  if (w && (opts.page || opts.highlight)) STORE_RENDERERS.appsea.navigate(w, game, opts.page || 'home', { highlight: opts.highlight });
  return w;
}
