// Bait Shop (phase 4, Shell agent): public entry point. AppSea, the desktop download app, is gone: Dot now runs an
// in-game Aero bait shop (panel 'baitshop') where consumable bait packs are bought with Aero.
//
//   installStore(game) -> BaitShop (game.store), idempotent (src/store/shop.js)
//   ShopPanel                       the 'baitshop' panel (src/store/shoppanel.js), registered by the game
//   openStore(game, {tab, select, highlight}) opens the Bait Shop panel (tab: 'bait' | 'lines')
//   TUTORIAL_APP                    the flavour line whose Lite pack is the tutorial's free bait
//   baitPower(lineId) / baitMods(lineId) -> legacy grade bait strength (see catalog.js)
//   boatBonus(state, key) boat perks (see boats.js), SHOP_LEVELS (Lab-gated), CATALOG, TIERS

import { installStore } from './shop.js';

export { BaitShop, installStore, ensureStoreState, defaultAppsState, specialAvailable } from './shop.js';
export { ShopPanel } from './shoppanel.js';
export { CATALOG, CATALOG_BY_ID, CATEGORIES, TIERS, MAX_TIER, PACK_QTY, appBaitId, listing, baitPower, baitPowerAt, baitMods, installedTier, formatTime, formatShortTime } from './catalog.js';
export { SHOP_LEVELS, shopLevel, shopInfo, shopUnlocked, nextShopLevel, ISP_TIERS, ispTier, ispUnlocked, nextIsp } from './isp.js';
export { BOAT_TIERS, BOAT_PERKS, boatBonus, boatTier, buyBoat } from './boats.js';

export const TUTORIAL_APP = 'notes';

export function openStore(game, opts = {}) {
  installStore(game);
  const ui = game?.ui;
  if (!ui?.panels?.baitshop) return null;
  const data = {};
  if (opts.tab || opts.page) data.tab = opts.tab || (opts.page === 'bait' ? 'bait' : opts.page === 'home' ? undefined : 'lines');
  if (opts.select) data.select = opts.select;
  if (opts.highlight) data.highlight = opts.highlight;
  if (ui.isOpen('baitshop')) ui.panels.baitshop.open(data);
  else ui.open('baitshop', data);
  return ui.panels.baitshop;
}
