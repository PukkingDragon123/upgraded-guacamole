// The Lab (phase 3): the ONE progression system. OWNER: Lab agent (this file is a stub; the contract is below).
// Everything is unlocked by researching nodes on a radial tree that branches out in every direction:
// rods, boat upgrades, aquarium tiers, crafting recipes (buildings, bait, decor), oceans, features, stat boosts.
// Research costs Aero + materials + fish, takes real time, and shows a waiting widget.
//
//   LAB_NODES: [{id, name, branch, pos:[x,y], req:[ids], cost:{aero, items:{matId:n}, fish:{speciesId|'rarity:<r>':n}},
//               time /*seconds*/, effect:{statKey:value}, unlock:[{kind, id}], desc, icon}]
//   ensureLab(state) -> state.lab = {done:{id:true}, active:{id,start,end}|null, unlocks:{'kind:id':true}}
//   labHas(state, nodeId) -> bool
//   labStatus(state, nodeId) -> 'done'|'researching'|'available'|'locked'
//   unlocked(state, kind, id) -> bool      kind: 'rod'|'boat'|'tank'|'recipe'|'biome'|'bait'|'cosmetic'|'feature'
//   grantUnlock(state, kind, id)           (also used by loot/cosmetic grants)
//   computeLabStats(state) -> partial stat bonuses merged by game.recomputeStats()
// Events (game.emit): 'labStarted' {id}, 'labDone' {id}, 'unlocked' {kind, id}
export const STARTER_UNLOCKS = ['rod:twig', 'tank:jar', 'boat:raft', 'biome:oscean', 'bait:crumbs', 'feature:aquarium'];

export const LAB_NODES = [];

export function ensureLab(state) {
  state.lab ||= { done: {}, active: null, unlocks: {} };
  for (const k of STARTER_UNLOCKS) state.lab.unlocks[k] = true;
  return state.lab;
}
export function labHas(state, id) { return !!ensureLab(state).done[id]; }
export function labStatus(state, id) {
  const L = ensureLab(state);
  if (L.done[id]) return 'done';
  if (L.active?.id === id) return 'researching';
  return 'locked';
}
export function unlocked(state, kind, id) { return !!ensureLab(state).unlocks[kind + ':' + id]; }
export function grantUnlock(state, kind, id) { ensureLab(state).unlocks[kind + ':' + id] = true; }
export function computeLabStats(state) { ensureLab(state); return {}; }
