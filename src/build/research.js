// Research projects run in the Research Lab. Timed with wall-clock timestamps, so they keep going while away.
//
// PROJECTS[] = {id, name, desc, icon, cost: {coins, items}, time (s), req: [ids], reward: {blueprints, items, perk, upgrade, plans}}
// state.research = {active: [{id, start, end}], done: {id: ts}, perks: {key: value}}
// researchStatus(state, id, now) -> 'done' | 'ready' | 'running' | 'available' | 'locked'
// startResearch(game, id) -> {ok, reason}    claimResearch(game, id) -> [{id, qty}] | null
// researchSlots(state), researchTime(state, project), researchProgress(state, id, now) -> 0..1

import { addItem, hasItems, takeItems, ITEMS } from './items.js';
import { buildingBonus, findBuilding, levelOf, DECOR_BUILDS } from './buildings.js';

export const PROJECTS = [
  { id: 'marine_bio', name: 'Marine Biology 101', icon: 'fish', time: 120, req: [], cost: { coins: 50, items: { fish_sample: 2 } },
    desc: 'Study your catches under the microscope. Rare fish get a little more curious.', reward: { perk: { rarity: 0.02 }, items: { fish_sample: 1 } } },
  { id: 'coral_prop', name: 'Coral Propagation', icon: 'coral', time: 300, req: [], cost: { coins: 120, items: { coral_chunk: 2, kelp_fibre: 3 } },
    desc: 'Grow reef from cuttings. Unlocks the Coral Garden blueprint.', reward: { blueprints: ['bp_coral_garden'] } },
  { id: 'crab_diplomacy', name: 'Crab Diplomacy', icon: 'shop', time: 360, req: [], cost: { coins: 180, items: { shell: 5 } },
    desc: 'Negotiate with the local hermit crabs. Unlocks the Shell Shack blueprint.', reward: { blueprints: ['bp_shell_shack'] } },
  { id: 'tinkering', name: 'Bait Tinkering', icon: 'worm', time: 480, req: [], cost: { coins: 220, items: { scrap_metal: 3, driftwood: 3 } },
    desc: 'Bolt a bait press together. Unlocks the Bait Workshop blueprint and a few worms.', reward: { blueprints: ['bp_bait_workshop'], items: { worm: 4 } } },
  { id: 'bubble_physics', name: 'Bubble Physics', icon: 'bubble', time: 480, req: ['marine_bio'], cost: { coins: 200, items: { sea_glass: 3, fish_sample: 3 } },
    desc: 'Why do bubbles go up? (Science!) Unlocks the Bubble Tower blueprint.', reward: { blueprints: ['bp_bubble_tower'] } },
  { id: 'eng1', name: 'Reinforced Rafters', icon: 'gear', time: 900, req: ['marine_bio'], cost: { coins: 400, items: { driftwood: 8, gear: 2 } },
    desc: 'Better joinery for everything you build. Buildings can be upgraded to level 2.', reward: { upgrade: 2 } },
  { id: 'embryology', name: 'Fish Embryology', icon: 'heart', time: 1200, req: ['marine_bio'], cost: { coins: 500, items: { fish_sample: 8, coral_chunk: 3 } },
    desc: 'Where do little fish come from? Unlocks the Fish Hatchery blueprint.', reward: { blueprints: ['bp_hatchery'], items: { fish_egg: 1 } } },
  { id: 'glow_bait', name: 'Bioluminescent Bait', icon: 'sparkle', time: 720, req: ['tinkering'], cost: { coins: 350, items: { sea_glass: 4, fish_sample: 4 } },
    desc: 'Bait that glows in the dark. Lantern Pearls, and your bait pulls from further away.', reward: { items: { lantern: 3 }, perk: { baitRadius: 0.05 } } },
  { id: 'overclock', name: 'Overclocked Lures', icon: 'gear', time: 600, req: ['tinkering'], cost: { coins: 300, items: { circuit_board: 1, scrap_metal: 4 } },
    desc: 'More volts, more fish. Overclocked Chips, and fish carry packages a little more often.', reward: { items: { chip: 5 }, perk: { luck: 0.04 } } },
  { id: 'decor_plans', name: 'Architecture Club', icon: 'home', time: 1200, req: ['eng1'], cost: { coins: 600, items: { driftwood: 6, shell: 4 } },
    desc: 'Sketch fancy seabed decorations. Grants two random decoration plans.', reward: { plans: 2 } },
  { id: 'claw_theory', name: 'Claw Machine Theory', icon: 'trophy', time: 1500, req: ['bubble_physics'], cost: { coins: 700, items: { circuit_board: 2, gear: 3 } },
    desc: 'The claw is rigged, but science can rig it back. Unlocks the Sunken Arcade blueprint.', reward: { blueprints: ['bp_arcade'] } },
  { id: 'optics', name: 'Deep Optics', icon: 'eye', time: 1800, req: ['glow_bait'], cost: { coins: 900, items: { sea_glass: 6, ancient_stone: 2 } },
    desc: 'Lenses that see in the abyss. Unlocks the Lighthouse blueprint.', reward: { blueprints: ['bp_lighthouse'] } },
  { id: 'economics', name: 'Clam Economics', icon: 'coin', time: 1800, req: ['crab_diplomacy'], cost: { coins: 1000, items: { pearl: 2, gear: 3 } },
    desc: 'Compound interest, explained by a clam. Unlocks the Treasure Vault blueprint and better selling.', reward: { blueprints: ['bp_vault'], perk: { sellMul: 0.05 } } },
  { id: 'genetics', name: 'Shiny Genetics', icon: 'star', time: 2400, req: ['embryology'], cost: { coins: 1200, items: { rare_specimen: 2, pearl: 1 } },
    desc: 'Sequence the sparkle gene. Shiny and mutated fish turn up more often.', reward: { perk: { shiny: 0.25, mutation: 0.1 } } },
  { id: 'eng2', name: 'Titanium Trusses', icon: 'gear', time: 2700, req: ['eng1'], cost: { coins: 1500, items: { circuit_board: 3, ancient_stone: 3, gear: 4 } },
    desc: 'Space-age building materials (found in a bin). Buildings can be upgraded to level 3.', reward: { upgrade: 3 } },
  { id: 'deep_sonar', name: 'Deep-Sea Sonar', icon: 'sound', time: 2400, req: ['optics'], cost: { coins: 1500, items: { circuit_board: 3, rare_specimen: 1 } },
    desc: 'Ping! Rare fish ping back. Rarity bonus, stronger at night.', reward: { perk: { rarity: 0.05, nightRarity: 0.1 } } },
  { id: 'relic_lore', name: 'Relic Lore', icon: 'skull', time: 3600, req: ['optics'], cost: { coins: 2000, items: { ancient_stone: 5, abyss_crystal: 2 } },
    desc: 'Decipher the glyph stones. The Bait Workshop learns to craft Ancient Relics.', reward: { items: { relic: 1 } } },
  { id: 'luck_theory', name: 'Applied Superstition', icon: 'crown', time: 3600, req: ['claw_theory', 'genetics'], cost: { coins: 2500, items: { abyss_crystal: 2, golden_scale: 1 } },
    desc: 'Rigorous science about four-leaf clovers. Unlocks the Totem of Luck blueprint.', reward: { blueprints: ['bp_totem'] } },
];
export const PROJECT_BY_ID = Object.fromEntries(PROJECTS.map((p) => [p.id, p]));

export function researchState(state) {
  const r = (state.research ||= { active: [], done: {}, perks: {} });
  r.active ||= []; r.done ||= {}; r.perks ||= {};
  return r;
}

export function researchSlots(state) {
  const lab = findBuilding(state, 'research_lab');
  return lab ? levelOf(lab) >= 3 ? 3 : levelOf(lab) >= 2 ? 2 : 1 : 0;
}

export function researchTime(state, p) {
  return Math.round(p.time / (1 + buildingBonus(state, 'researchSpeed')));
}

export function researchStatus(state, id, now = Date.now()) {
  const r = researchState(state);
  if (r.done[id]) return 'done';
  const a = r.active.find((q) => q.id === id);
  if (a) return now >= a.end ? 'ready' : 'running';
  const p = PROJECT_BY_ID[id];
  if (!p || p.req.some((q) => !r.done[q])) return 'locked';
  return 'available';
}

export function researchProgress(state, id, now = Date.now()) {
  const a = researchState(state).active.find((q) => q.id === id);
  if (!a) return researchState(state).done[id] ? 1 : 0;
  return Math.min(1, Math.max(0, (now - a.start) / Math.max(1, a.end - a.start)));
}

export function canAfford(game, p) {
  return game.state.coins >= (p.cost.coins || 0) && hasItems(game.state, p.cost.items);
}

export function startResearch(game, id) {
  const st = game.state, r = researchState(st);
  const p = PROJECT_BY_ID[id];
  if (!p) return { ok: false, reason: 'Unknown project.' };
  if (!findBuilding(st, 'research_lab')) return { ok: false, reason: 'Build a Research Lab first.' };
  const status = researchStatus(st, id);
  if (status !== 'available') return { ok: false, reason: status === 'locked' ? 'Research the earlier projects first.' : 'Already researching.' };
  if (r.active.length >= researchSlots(st)) return { ok: false, reason: 'All lab benches are busy. Upgrade the lab for more.' };
  if (!canAfford(game, p)) return { ok: false, reason: 'Not enough coins or materials.' };
  if (p.cost.coins && !game.spendCoins(p.cost.coins)) return { ok: false, reason: 'Not enough coins.' };
  takeItems(st, p.cost.items);
  const now = Date.now();
  r.active.push({ id, start: now, end: now + researchTime(st, p) * 1000 });
  game.save?.();
  return { ok: true };
}

export function claimResearch(game, id) {
  const st = game.state, r = researchState(st);
  if (researchStatus(st, id) !== 'ready') return null;
  const p = PROJECT_BY_ID[id];
  r.active = r.active.filter((q) => q.id !== id);
  r.done[id] = Date.now();
  const got = [];
  const rw = p.reward || {};
  for (const bp of rw.blueprints || []) { addItem(st, bp, 1); got.push({ id: bp, qty: 1 }); }
  for (const [iid, q] of Object.entries(rw.items || {})) { addItem(st, iid, q); got.push({ id: iid, qty: q }); }
  for (const [k, v] of Object.entries(rw.perk || {})) r.perks[k] = (r.perks[k] || 0) + v;
  if (rw.plans) {
    const ids = Object.keys(DECOR_BUILDS).filter((d) => ITEMS['bp_' + d]);
    for (let i = 0; i < rw.plans && ids.length; i++) {
      const pick = ids.splice(Math.floor(Math.random() * ids.length), 1)[0];
      addItem(st, 'bp_' + pick, 1);
      got.push({ id: 'bp_' + pick, qty: 1 });
    }
  }
  game.save?.();
  return got;
}

// Projects that finished while you were away (for a welcome toast).
export function readyCount(state, now = Date.now()) {
  return researchState(state).active.filter((a) => now >= a.end).length;
}

export const PERK_NAMES = {
  rarity: 'Rare fish odds', nightRarity: 'Night rarity', coinMul: 'Coin income', baitRadius: 'Bait pull radius', luck: 'Package chance',
  shiny: 'Shiny odds', mutation: 'Mutation odds', sellMul: 'Sell prices', eggChance: 'Bonus egg chance', baitSave: 'Bait saving', researchSpeed: 'Research speed', light: 'Lighthouse beam',
};
