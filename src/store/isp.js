// Bait Shop levels (phase 4, Shell agent). The old "internet speed" Lab features isp2..isp6 are repurposed as
// Bait Shop upgrades researched in The Lab: each level opens a better bait grade, restocks Dot's shelves faster
// and gives a loyalty discount. Feature ids stay the same so existing saves keep their progress.
//   SHOP_LEVELS[i] = {id, name, short, feature (Lab feature id | null), grade (best grade sold), restock (s),
//                     discount (0..1), stock (+packs per offer), color, desc}
//   shopLevel(state) -> index of the best researched level, shopInfo(state) -> SHOP_LEVELS entry,
//   shopUnlocked(state, i) -> bool, nextShopLevel(state) -> the next level to research or null
// Legacy aliases (old imports keep working): ISP_TIERS, ispTier, ispUnlocked, nextIsp, ispSpeed.

import { unlocked } from '../game/lab.js';

export const SHOP_LEVELS = [
  { id: 'stall', name: 'Bait Stall', short: 'Stall', feature: null, grade: 1, restock: 300, discount: 0, stock: 0, color: '#8a9aac',
    desc: 'A cosy little stall. Lite and Plus bait.' },
  { id: 'pro', name: 'Pro Shelf', short: 'Pro', feature: 'isp2', grade: 2, restock: 240, discount: 0, stock: 0, color: '#3ab0e0',
    desc: 'Pro-grade bait and quicker restocks.' },
  { id: 'ultra', name: 'Ultra Shelf', short: 'Ultra', feature: 'isp3', grade: 3, restock: 180, discount: 0.05, stock: 1, color: '#2fc8a0',
    desc: 'Ultra-grade bait, fuller shelves, 5% off.' },
  { id: 'mega', name: 'Mega Shelf', short: 'Mega', feature: 'isp4', grade: 4, restock: 150, discount: 0.1, stock: 1, color: '#6a7aff',
    desc: 'Mega-grade bait and 10% off everything.' },
  { id: 'loyal', name: 'Loyalty Card', short: 'Loyal', feature: 'isp5', grade: 4, restock: 120, discount: 0.15, stock: 2, color: '#ffb02e',
    desc: 'Dot knows your name. 15% off, bigger stock.' },
  { id: 'express', name: 'Express Restock', short: 'Express', feature: 'isp6', grade: 4, restock: 60, discount: 0.2, stock: 2, color: '#ff7ab4',
    desc: 'Shelves refill every minute. 20% off.' },
];

export function shopUnlocked(state, i) {
  const p = SHOP_LEVELS[i];
  if (!p) return false;
  if (!p.feature) return true;
  try { return !!unlocked(state, 'feature', p.feature); } catch { return !!state?.lab?.unlocks?.['feature:' + p.feature]; }
}

export function shopLevel(state) {
  let best = 0;
  for (let i = 1; i < SHOP_LEVELS.length; i++) if (shopUnlocked(state, i)) best = i;
  return best;
}

export function shopInfo(state) { return SHOP_LEVELS[shopLevel(state)]; }

export function nextShopLevel(state) {
  return SHOP_LEVELS[shopLevel(state) + 1] || null;
}

// ---------------------------------------------------------------- legacy aliases
export const ISP_TIERS = SHOP_LEVELS;
export const ispUnlocked = shopUnlocked;
export const ispTier = shopLevel;
export const nextIsp = nextShopLevel;
export function ispSpeed() { return Infinity; }
