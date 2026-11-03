// SlowNet ISP plans: the player's internet speed (KB/s) sets real download time = size / speed.
// Phase 3: plans are no longer bought in AppSea; they are researched in The Lab as features 'isp2'..'isp6'
// (isp2 = ISDN, isp3 = DSL, isp4 = Cable, isp5 = Fiber, isp6 = Quantum). Dial-up is free.
//   ISP_TIERS[i] = {id, name, short, speed (KB/s), feature (Lab feature id), desc, connect (s of dial-in), screech}
//   ispTier(state) -> index (best unlocked plan; an old save's bought plan is kept), ispSpeed(state) -> KB/s incl. boat bonus
//   ispUnlocked(state, i) -> bool

import { boatBonus } from './boats.js';
import { unlocked } from '../game/lab.js';

export const ISP_TIERS = [
  { id: 'dialup', name: '56k Dial-up', short: '56k', speed: 7, feature: null, connect: 2.8, screech: true, color: '#8a6a4a',
    desc: 'Ties up the phone line. Screams at you. Classic.' },
  { id: 'isdn', name: 'ISDN 128k', short: 'ISDN', speed: 16, feature: 'isp2', connect: 1.2, color: '#6a8a4a',
    desc: 'Two phone lines taped together. Twice the screaming.' },
  { id: 'dsl', name: 'DSL 1.5M', short: 'DSL', speed: 192, feature: 'isp3', connect: 0.5, color: '#3a8aa8',
    desc: 'Always on! Like a fridge light. 12x faster than ISDN.' },
  { id: 'cable', name: 'Cable 20M', short: 'Cable', speed: 2560, feature: 'isp4', connect: 0, color: '#3a5ad0',
    desc: 'Shared with every crab on your street. Still fast.' },
  { id: 'fiber', name: 'Fiber 1G', short: 'Fiber', speed: 128000, feature: 'isp5', connect: 0, color: '#9a3ad0',
    desc: 'Pure light through glass. The fish are confused.' },
  { id: 'quantum', name: 'Quantum Kelp-Link', short: 'QKL', speed: 1048576, feature: 'isp6', connect: 0, color: '#e0a024',
    desc: 'Downloads finish before you click. Usually.' },
];

export function ispUnlocked(state, i) {
  const p = ISP_TIERS[i];
  if (!p) return false;
  if (!p.feature) return true;
  if ((state?.apps?.isp | 0) >= i) return true; // bought before phase 3
  try { return !!unlocked(state, 'feature', p.feature); } catch { return !!state?.lab?.unlocks?.['feature:' + p.feature]; }
}

export function ispTier(state) {
  let best = 0;
  for (let i = 1; i < ISP_TIERS.length; i++) if (ispUnlocked(state, i)) best = i;
  return best;
}

export function ispSpeed(state) {
  return ISP_TIERS[ispTier(state)].speed * boatBonus(state, 'netBoost');
}
