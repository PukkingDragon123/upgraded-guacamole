// AppSea store: public entry point for the orchestrator.
//
//   installStore(game) -> Store (game.store). Idempotent. Creates/migrates state.apps + state.boat and ticks
//     downloads every 250 ms on wall-clock time (finished-while-away downloads deliver their bait on load).
//   STORE_RENDERERS  window renderers to merge into APP_RENDERERS: appsea (the website), appsea_dl (download
//     dialog), moreram, notavirus (two Weird apps).
//   Phase 3: downloads deliver consumable BAIT PACKS (src/store/bait.js); the desktop no longer gets an icon per
//     download (desktop icons are the game menu). desktopIconDefs(state) therefore lists only system APPS and
//     syncDesktopIcons(desktop, state) only REMOVES leftover store-app icons (it never adds or touches others).
//   openStore(game, {page, highlight}) opens the AppSea window (page: 'home'|category id|'bait'|'isp'|'downloads').
//   baitPower(appId) / baitMods(appId) -> legacy app-tier bait strength (see catalog.js).
//   boatBonus(state, key) boat perks (see boats.js), BOAT_TIERS, ISP_TIERS (Lab-gated), CATALOG, TIERS.

import { APPS } from '../desktop/icons.js';
import { installStore } from './downloads.js';
import { STORE_RENDERERS } from './storeapp.js';

export { Store, ensureStoreState, defaultAppsState, installStore, WARNINGS, specialAvailable, dlInfo } from './downloads.js';
export { CATALOG, CATALOG_BY_ID, CATEGORIES, TIERS, MAX_TIER, PACK_QTY, appBaitId, listing, baitPower, baitPowerAt, baitMods, installedTier, formatSize, formatSpeed, formatTime } from './catalog.js';
export { ISP_TIERS, ispSpeed, ispTier, ispUnlocked, nextIsp } from './isp.js';
export { BOAT_TIERS, BOAT_PERKS, boatBonus, boatTier, buyBoat } from './boats.js';
export { STORE_RENDERERS } from './storeapp.js';
export { storeSfx } from './sfx.js';

export const TUTORIAL_APP = 'notes';

export function desktopIconDefs() {
  return APPS.filter((d) => !d.hidden && d.system).map((d) => ({ id: d.id, label: d.label, type: d.type, icon: d.icon, app: d.app || d.id, tier: 0, nobait: !!d.nobait }));
}

// Harmless: drops icons of store apps (left over from older saves); everything else on the desktop is untouched.
export function syncDesktopIcons(desktop, state) {
  if (!desktop || !Array.isArray(desktop.icons)) return false;
  const storeIds = new Set(APPS.filter((d) => d.store && !d.system).map((d) => d.id));
  const keep = desktop.icons.filter((ic) => !storeIds.has(ic?.id));
  if (keep.length === desktop.icons.length) return false;
  for (const ic of desktop.icons) if (storeIds.has(ic?.id) && ic.thief) ic.thief.carry = null;
  desktop.icons = keep;
  desktop.layoutDirty = true;
  if (state) {
    state.baitBox = (state.baitBox || []).filter((id) => !storeIds.has(id));
    if (state.equipped?.kind === 'icon' && storeIds.has(state.equipped.id)) state.equipped = null;
  }
  return true;
}

export function openStore(game, opts = {}) {
  installStore(game);
  const desk = game.desktop;
  if (!desk?.openApp) return null;
  const sw = STORE_RENDERERS.appsea.size;
  const w = desk.openApp('appsea', opts.x !== undefined ? { x: opts.x, y: opts.y } : {
    x: Math.max(8, Math.round((game.screen.W - sw[0]) / 2)), y: Math.max(8, Math.round((game.screen.H - sw[1]) / 2) - 12),
  });
  if (w && (opts.page || opts.highlight)) STORE_RENDERERS.appsea.navigate(w, game, opts.page || 'home', { highlight: opts.highlight });
  return w;
}
