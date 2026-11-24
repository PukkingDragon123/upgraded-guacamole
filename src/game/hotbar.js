// [hot26] Hotbar button unlocks: a new game starts with only three hotbar buttons (Bait Shop, Quests, Aquarium, plus
// Settings, which is always there); every other button is unlocked by BUILDING its little voxel prop in the tank
// (src/aquarium/build2d.js, catalog tab "Unlocks"; the props live in src/gfx/unlockprops.js or are existing decor).
// Unlocks are permanent: storing or moving the prop afterwards never locks the button again.
//
//   HOTBAR_START                 ids unlocked on a new game        HOTBAR_ALWAYS  never locked (settings)
//   HOTBAR_UNLOCKS[btnId]        {prop, build (the prop's name), price (Aero while the button is still locked), label}
//   UNLOCK_BY_PROP[propId]       -> btnId
//   ensureHotbar(state)          state.hotbar = {v, unlocked: {btnId: ts}, fresh: {btnId: ts}} (+ old-save migration)
//   hotbarUnlocked(state, id)    true for start / always / unlocked ids and anything without an unlock rule
//   hotbarLock(state, id)        null when unlocked, else {id, prop, build, price, label, tip}
//   unlockHotbar(game, id, o)    grants it, marks it fresh (the HUD plays its pop) and emits 'hotbarUnlocked' {id, label}
//   unlockByProp(game, propId)   called when a prop is placed in the tank (build2d 'tankBuilt') -> btnId | null
//   unlockPrice(state, propId)   the unlock price of a prop whose button is still locked, else null
//   unlockAll(game)              debug / smoke helper: every button
// Old saves (no state.hotbar yet): every button the save shows it has already used is granted (see migrate()).
// Keyboard shortcuts of locked buttons are ignored (game.js handleKeys, aquarium.js F); a locked HUD slot shows a
// padlock and opens the tank's build mode with its prop picked (src/ui/hud.js).

export const HOTBAR_START = ['baitshop', 'quests', 'aquarium'];
export const HOTBAR_ALWAYS = ['settings'];
const ALIAS = { appsea: 'baitshop', store: 'baitshop', shop: 'baitshop', skills: 'lab', tank: 'aquarium', friends: 'multiplayer', quest: 'quests', questlog: 'quests', crafting: 'workshop', research: 'lab' };

export const HOTBAR_UNLOCKS = {
  lab: { prop: 'research_bench', build: 'Research Bench', price: 5, label: 'The Lab' },
  inventory: { prop: 'treasure_chest', build: 'Treasure Chest', price: 10, label: 'Satchel' },
  journal: { prop: 'bookshelf', build: 'Bookshelf', price: 15, label: 'FishDex' },
  bait: { prop: 'tackle_box', build: 'Tackle Box', price: 15, label: 'Bait' },
  wardrobe: { prop: 'vanity_mirror', build: 'Mirror', price: 20, label: 'Wardrobe' },
  fishmgr: { prop: 'net_rack', build: 'Net Rack', price: 20, label: 'My Fish' },
  map: { prop: 'map_table', build: 'Treasure Map Table', price: 40, label: 'Map' },
  multiplayer: { prop: 'phone_booth', build: 'Phone Booth', price: 50, label: 'Multiplayer' },
  workshop: { prop: 'workbench', build: 'Workbench', price: 60, label: 'Workshop' },
};
export const HOTBAR_ORDER = Object.keys(HOTBAR_UNLOCKS);
export const UNLOCK_BY_PROP = Object.fromEntries(Object.entries(HOTBAR_UNLOCKS).map(([id, u]) => [u.prop, id]));

const canon = (id) => ALIAS[id] || id;

export function ensureHotbar(state) {
  if (!state) return { unlocked: {}, fresh: {} };
  let H = state.hotbar;
  if (!H || typeof H !== 'object') { H = state.hotbar = { v: 1, unlocked: {}, fresh: {} }; migrate(state, H); }
  H.unlocked ||= {};
  H.fresh ||= {};
  return H;
}

// A save from before hotbar unlocks: grant what it has already used. A brand-new game has nothing to grant.
function migrate(st, H) {
  const now = Date.now();
  const give = (id) => { H.unlocked[id] = now; };
  const Q = st.quests || {}, done = Q.done || {}, L = st.lab || {};
  const labDone = Object.keys(L.done || {}).some((id) => id !== 'root' && id !== 'core');
  const caught = (st.stats?.caught | 0) > 0 || Object.values(st.journal || {}).some((j) => j?.caught > 0);
  const old = !!st.tutorialDone || caught || labDone || (st.coins | 0) > 0 || (st.totalCoins | 0) > 0;
  if (!old) return; // a new game
  H.migrated = now;
  if (st.tutorialDone || labDone) give('lab'); // the old tutorial ended with the first research
  if (caught || st.tutorialDone) { give('journal'); give('bait'); } // every catch fills the FishDex; the bait pod was always there
  const inv = st.inventory || {};
  if ((inv.packages || []).length || Object.values(inv.items || {}).some((n) => n > 0) || done.c1_chest) give('inventory');
  if ((st.fish || []).some((f) => f.inTank) && st.tutorialDone) give('fishmgr');
  if (done.s1_dress || (Q.life?.dress | 0) > 0 || (st.cosmetics && Object.keys(st.cosmetics).length) || st.character?.changed) give('wardrobe');
  if ((st.unlockedBiomes || []).length > 1 || Object.keys(Q.visited || {}).length > 1 || Object.keys(Q.dests || {}).length || (Q.ch | 0) >= 1) give('map');
  if (done.c2_workshop || L.unlocks?.['feature:workshop'] || Q.dests?.workshop) give('workshop');
  if (st.net?.enabled || st.net?.name || st.online?.enabled || Q.flags?.online) give('multiplayer');
  for (const d of st.tank?.decor || []) if (UNLOCK_BY_PROP[d?.id]) give(UNLOCK_BY_PROP[d.id]); // already built it
  // an established save (past chapter 1) has been through every system: keep them all
  if ((Q.ch | 0) >= 2) for (const id of HOTBAR_ORDER) give(id);
}

export function hotbarUnlocked(state, id) {
  id = canon(id);
  if (HOTBAR_START.includes(id) || HOTBAR_ALWAYS.includes(id) || !HOTBAR_UNLOCKS[id]) return true;
  return !!ensureHotbar(state).unlocked[id];
}

export function hotbarLock(state, id) {
  id = canon(id);
  if (hotbarUnlocked(state, id)) return null;
  const u = HOTBAR_UNLOCKS[id];
  return { id, ...u, tip: `Build a ${u.build} to unlock ${u.label}` };
}

export function unlockHotbar(game, id, o = {}) {
  id = canon(id);
  const st = game?.state;
  if (!st || !HOTBAR_UNLOCKS[id]) return false;
  const H = ensureHotbar(st);
  if (H.unlocked[id]) return false;
  H.unlocked[id] = Date.now();
  if (!o.quiet) H.fresh[id] = Date.now();
  try { game.emit?.('hotbarUnlocked', { id, label: HOTBAR_UNLOCKS[id].label, quiet: !!o.quiet }); } catch (e) { console.error(e); }
  game.save?.();
  return true;
}

export function unlockByProp(game, propId) {
  const id = UNLOCK_BY_PROP[propId];
  if (!id || hotbarUnlocked(game?.state, id)) return null;
  return unlockHotbar(game, id) ? id : null;
}

export function unlockPrice(state, propId) {
  const id = UNLOCK_BY_PROP[propId];
  if (!id || hotbarUnlocked(state, id)) return null;
  return HOTBAR_UNLOCKS[id].price;
}

export function unlockAll(game) {
  for (const id of HOTBAR_ORDER) unlockHotbar(game, id, { quiet: true });
}
