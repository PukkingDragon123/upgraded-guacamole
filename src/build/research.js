// Compatibility layer: the old Research Lab projects are gone (phase 3). Everything is researched in The Lab
// (src/game/lab.js); this module keeps the old exports alive for older callers and saves.
//
// PROJECTS[] = Lab nodes in the old shape {id, name, desc, icon, cost: {coins, items}, time, req}
// state.research = {active, done, perks}: old saves keep their perks (buildings.buildingBonus still adds them).
// researchStatus / researchProgress / startResearch / claimResearch / readyCount delegate to the Lab.

import { LAB_NODES, LAB_BY_ID, ROOT_ID, labStatus, labProgress, labCheck, labTime, labSlots, ensureLab, startResearch as labStart } from '../game/lab.js';

export const PROJECTS = LAB_NODES.filter((nd) => nd.id !== ROOT_ID).map((nd) => ({
  id: nd.id, name: nd.name, desc: nd.desc, icon: nd.icon, time: nd.time, req: nd.req.filter((r) => r !== ROOT_ID),
  cost: { coins: nd.cost.aero || 0, items: nd.cost.items || {} }, reward: {},
}));
export const PROJECT_BY_ID = Object.fromEntries(PROJECTS.map((p) => [p.id, p]));

export function researchState(state) {
  const r = (state.research ||= { active: [], done: {}, perks: {} });
  r.active ||= []; r.done ||= {}; r.perks ||= {};
  return r;
}

export function researchSlots(state) { return labSlots(state); }
export function researchTime(state, p) { return labTime(state, LAB_BY_ID[p?.id] || p); }

export function researchStatus(state, id) {
  const s = labStatus(state, id);
  return s === 'researching' ? 'running' : s;
}
export function researchProgress(state, id) { return labProgress(state, id); }
export function canAfford(game, p) { const nd = LAB_BY_ID[p?.id]; return !!nd && labCheck(game.state, nd, game.stats).paid; }
export function startResearch(game, id) { return labStart(game, id); }
export function claimResearch() { return null; }
export function readyCount(state) { ensureLab(state); return 0; }

export const PERK_NAMES = {
  rarity: 'Rare fish odds', nightRarity: 'Night rarity', coinMul: 'Aero income', baitRadius: 'Bait pull radius', luck: 'Crate luck',
  shiny: 'Shiny odds', mutation: 'Mutation odds', sellMul: 'Sell prices', eggChance: 'Bonus egg chance', baitSave: 'Bait saving', researchSpeed: 'Research speed', light: 'Lighthouse beam',
};
