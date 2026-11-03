// Compatibility layer over The Lab (src/game/lab.js). The old coral skill tree is gone; these exports keep
// older callers working:
//   SKILLS / SKILL_BY_ID   Lab nodes in the old shape ({id, branch, name, cost: aeroNumber, req, pos, effect, desc, icon})
//   BRANCHES               Lab branches {id: {name, color}}
//   BASE_STATS             every stat key the game reads (fishing, aquarium, desktop, rods, lab)
//   computeStats(stateOrOwned) -> stats: BASE_STATS merged with finished Lab nodes. Accepts the whole save
//                          (preferred: game.recomputeStats passes this.state) or an old {skillId: true} map.
//   skillStatus(sk, state, speciesFound) -> {status: 'owned'|'available'|'locked', reason}
import { LAB_NODES, LAB_BY_ID, BRANCHES as LAB_BRANCHES, MULT_KEYS, ensureLab, computeLabStats, labStatus, unlocked, ROOT_ID } from './lab.js';

export const BRANCHES = Object.fromEntries(Object.entries(LAB_BRANCHES).map(([id, b]) => [id, { name: b.name, color: b.color }]));

export const SKILLS = LAB_NODES.filter((nd) => nd.id !== ROOT_ID).map((nd) => {
  const biome = nd.unlock.find((u) => u.kind === 'biome')?.id;
  return { ...nd, cost: nd.cost.aero || 0, labCost: nd.cost, effect: biome ? { ...nd.effect, unlockBiome: biome } : nd.effect };
});
export const SKILL_BY_ID = Object.fromEntries(SKILLS.map((s) => [s.id, s]));

export const BASE_STATS = {
  biteWindow: 1, lineStrength: 1, snapGrace: 0.35, slackGrace: 1.6, reelSpeed: 34, staminaDrain: 1,
  traceRadius: 1, traceForgive: 1, mashPower: 1, timingWindow: 1, timingMisses: 2, dodgeHits: 2,
  netTolerance: 1, netTime: 1, calm: 1, autoHook: 0, baitRadius: 1, rarityBoost: 1,
  mutationChance: 0.05, shinyChance: 1 / 220, boxSlots: 4, tankCap: 4, coinMul: 1, collectRadius: 14,
  focus: 0, autoCollect: 0, feeder: 0, breeding: 0, hatchSpeed: 1, sonar: 0, lantern: 0, forecast: 0, offlineMul: 0.35,
  // phase 3: rod bonuses (rods.rodStats), shock, lab, crates
  rodLure: 1, rodLuck: 1, rodControl: 1, rodResilience: 0, rodStrength: 1,
  shockPower: 1, shockCharges: 0, shockCooldown: 1, labSlots: 0, labSpeed: 1, crateLuck: 0,
};

const isState = (o) => !!o && typeof o === 'object' && ('coins' in o || 'lab' in o || 'journal' in o || 'fish' in o);

export function computeStats(arg = {}) {
  const st = isState(arg) ? arg : { skills: arg || {}, coins: 0, fish: [] };
  const lab = computeLabStats(st);
  const s = { ...BASE_STATS };
  for (const [k, v] of Object.entries(lab)) {
    if (MULT_KEYS.has(k)) s[k] = (s[k] ?? 1) * v;
    else s[k] = (s[k] || 0) + v;
  }
  // bait / biome unlock sets (old shop + map callers)
  s.unlockBait = new Set(['bread']);
  s.unlockBiome = new Set(['shallows']);
  const L = ensureLab(st);
  for (const k in L.unlocks) {
    const [kind, id] = k.split(':');
    if (kind === 'biome') s.unlockBiome.add(id);
    else if (kind === 'bait') s.unlockBait.add(id);
  }
  return s;
}

export function skillStatus(sk, state, speciesFound) {
  if (state?.skills?.[sk.id]) return { status: 'owned' };
  const st = labStatus(state, sk.id);
  if (st === 'done') return { status: 'owned' };
  if (st === 'available') return { status: 'available' };
  if (st === 'researching') return { status: 'locked', reason: 'Researching in the Lab...' };
  const node = LAB_BY_ID[sk.id];
  const missing = (node?.req || []).filter((r) => labStatus(state, r) !== 'done');
  return { status: 'locked', reason: 'Requires ' + missing.map((m) => LAB_BY_ID[m]?.name || m).join(' + ') };
}

export { unlocked };
