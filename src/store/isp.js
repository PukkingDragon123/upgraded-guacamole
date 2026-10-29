// SlowNet ISP plans: the player's internet speed (KB/s) sets real download time = size / speed.
//   ISP_TIERS[i] = {id, name, short, speed (KB/s), price, desc, connect (s of dial-in animation), screech}
//   ispTier(state) -> index, ispSpeed(state) -> KB/s incl. boat satellite bonus

import { boatBonus } from './boats.js';

export const ISP_TIERS = [
  { id: 'dialup', name: '56k Dial-up', short: '56k', speed: 7, price: 0, connect: 2.8, screech: true, color: '#8a6a4a',
    desc: 'Ties up the phone line. Screams at you. Classic.' },
  { id: 'isdn', name: 'ISDN 128k', short: 'ISDN', speed: 16, price: 45, connect: 1.2, color: '#6a8a4a',
    desc: 'Two phone lines taped together. Twice the screaming.' },
  { id: 'dsl', name: 'DSL 1.5M', short: 'DSL', speed: 192, price: 200, connect: 0.5, color: '#3a8aa8',
    desc: 'Always on! Like a fridge light. 12x faster than ISDN.' },
  { id: 'cable', name: 'Cable 20M', short: 'Cable', speed: 2560, price: 700, connect: 0, color: '#3a5ad0',
    desc: 'Shared with every crab on your street. Still fast.' },
  { id: 'fiber', name: 'Fiber 1G', short: 'Fiber', speed: 128000, price: 2400, connect: 0, color: '#9a3ad0',
    desc: 'Pure light through glass. The fish are confused.' },
  { id: 'quantum', name: 'Quantum Kelp-Link', short: 'QKL', speed: 1048576, price: 7500, connect: 0, color: '#e0a024',
    desc: 'Downloads finish before you click. Usually.' },
];

export function ispTier(state) {
  return Math.max(0, Math.min(ISP_TIERS.length - 1, state?.apps?.isp | 0));
}

export function ispSpeed(state) {
  return ISP_TIERS[ispTier(state)].speed * boatBonus(state, 'netBoost');
}
