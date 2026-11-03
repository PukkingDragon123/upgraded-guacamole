// Internet plans: the player's speed (KB/s) sets real download time = size / speed.
// Phase 3: plans are researched in The Lab (features 'isp2'..'isp5', see src/game/lab.js), never bought in AppSea.
// Dial-up is free and still screams.
//   ISP_TIERS[i] = {id, name, short, speed (KB/s), feature (Lab feature id), node (Lab node id), desc, connect (s of dial-in), screech, color}
//   ispTier(state) -> index (best unlocked plan; an old save's bought plan is kept), ispSpeed(state) -> KB/s incl. boat bonus
//   ispUnlocked(state, i) -> bool, nextIsp(state) -> the next plan to research or null

import { boatBonus } from './boats.js';
import { unlocked } from '../game/lab.js';

export const ISP_TIERS = [
  { id: 'dialup', name: '56k Dial-up', short: '56k', speed: 7, feature: null, node: null, connect: 2.8, screech: true, color: '#8a9aac',
    desc: 'Ties up the phone line. Screams at you. Classic.' },
  { id: 'buoy', name: 'Broadband Buoy', short: 'Buoy', speed: 96, feature: 'isp2', node: 'isp2', connect: 0.6, color: '#3ab0e0',
    desc: 'Always on! Bobs gently. 14x faster than dial-up.' },
  { id: 'fibre', name: 'Fibre Cable', short: 'Fibre', speed: 1600, feature: 'isp3', node: 'isp3', connect: 0, color: '#2fc8a0',
    desc: 'Pure light through glass. The fish are confused.' },
  { id: 'sat', name: 'Satellite Dish', short: 'Sat', speed: 24000, feature: 'isp4', node: 'isp4', connect: 0, color: '#6a7aff',
    desc: 'Downloads from space. Wave at the dish.' },
  { id: 'quantum', name: 'Quantum Link', short: 'Quantum', speed: 400000, feature: 'isp5', node: 'isp5', connect: 0, color: '#ffb02e',
    desc: 'Downloads finish before you click. Usually.' },
];

export function ispUnlocked(state, i) {
  const p = ISP_TIERS[i];
  if (!p) return false;
  if (!p.feature) return true;
  if (Math.min(ISP_TIERS.length - 1, state?.apps?.isp | 0) >= i) return true; // bought before phase 3
  try { return !!unlocked(state, 'feature', p.feature); } catch { return !!state?.lab?.unlocks?.['feature:' + p.feature]; }
}

export function ispTier(state) {
  let best = 0;
  for (let i = 1; i < ISP_TIERS.length; i++) if (ispUnlocked(state, i)) best = i;
  return best;
}

export function nextIsp(state) {
  const i = ispTier(state) + 1;
  return ISP_TIERS[i] || null;
}

export function ispSpeed(state) {
  return ISP_TIERS[ispTier(state)].speed * boatBonus(state, 'netBoost');
}
