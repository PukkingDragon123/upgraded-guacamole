// Consumable bait (phase 3). OWNER: Online & AppSea agent (stub; contract below).
// Bait is downloaded from AppSea (or crafted/customised in the Lab) and is ONE-TIME USE: one bait is used up
// each time a fish is hooked. Desktop icons are no longer bait (they are the game's menu).
//   BAITS: {id: {id, name, type /* species bait-pref key: browser|folder|docs|music|image|game|mail|terminal|... */,
//               attract, rarity, size, luck, desc, art}}
//   ensureBait(state) -> state.bait = {inv:{baitId:count}, custom:[{id, name, base, mods, count}], equipped:id|null}
//   currentBait(state) -> {id, name, type, kind:'bait', mods:{attract, rarity, sizeBonus, giantMul}, mini /*small canvas*/}|null
//   consumeBait(state) -> bool             (called by fishing on hook-set)
//   addBait(state, id, n)
export const BAITS = {};
export function ensureBait(state) {
  state.bait ||= { inv: {}, custom: [], equipped: null };
  return state.bait;
}
export function currentBait(state) { ensureBait(state); return null; }
export function consumeBait(state) {
  const b = ensureBait(state);
  if (!b.equipped || !b.inv[b.equipped]) return false;
  if (--b.inv[b.equipped] <= 0) { delete b.inv[b.equipped]; b.equipped = null; }
  return true;
}
export function addBait(state, id, n = 1) { const b = ensureBait(state); b.inv[id] = (b.inv[id] || 0) + n; }
