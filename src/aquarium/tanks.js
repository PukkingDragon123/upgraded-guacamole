// Aquarium tank tiers and tank gear (phase 6: a real 3D tank).
//
//   TANK_IDS / TANK_TIERS[i]   {id, name, shape: 'round'|'lamp'|'box'|'wall', cap (extra fish over stats.tankCap),
//                               rate (income multiplier), offlineH (offline earnings cap, hours), plants, water}
//   TANK3D[i]                  3D size of the tier in centimetres (inner glass): round {R, cy, open, water, gravel}
//                              or box {W, H, D, water, gravel, slope, hood, stand}; the tank's base sits at y = 0
//   tankTier(state)            0..5 (state.tank.tier, raised to the best Lab unlock 'tank:<id>')
//   tierCapBonus(state)        extra tank capacity of the current tier (skills.js computeStats adds it to tankCap)
//   aeroRate(rec, sp, stats, tier, bonus, gearMul) -> Aero per minute for one fish
//   GEAR / gearLevel(state, id) / gearMul(state) / gearHappy(state) / gearCost(id, level)
//                              tank equipment bought with Aero in the aquarium (filter, heater, light, air,
//                              substrate); every level is a visible 3D change and a small income/happiness boost

import { clamp, clamp01 } from '../core/math.js';
import { unlocked } from '../game/lab.js';
import { valueMultiplier } from '../fish/traits.js';
import * as shop from '../game/shopdata.js';

export const TANK_IDS = ['jar', 'bowl', 'smalltank', 'bigtank', 'reeftank', 'wallaquarium'];

export const TANK_TIERS = [
  { id: 'jar', name: 'Goldfish Jar', shape: 'round', cap: 0, rate: 1, offlineH: 3, plants: 3, water: 'aero' },
  { id: 'bowl', name: 'Bubble Bowl', shape: 'round', cap: 1, rate: 1.15, offlineH: 4, plants: 5, water: 'aero' },
  { id: 'smalltank', name: 'Aqua Lamp', shape: 'lamp', cap: 2, rate: 1.3, offlineH: 5, plants: 8, water: 'aero' },
  { id: 'bigtank', name: 'Big Tank', shape: 'box', cap: 3, rate: 1.5, offlineH: 6, plants: 13, water: 'aero' },
  { id: 'reeftank', name: 'Reef Tank', shape: 'box', cap: 4, rate: 1.75, offlineH: 7, plants: 18, water: 'reef' },
  { id: 'wallaquarium', name: 'Wall Aquarium', shape: 'wall', cap: 5, rate: 2.1, offlineH: 8, plants: 26, water: 'aero' },
];

// Inner glass dimensions (cm). Round tanks: a glass globe of radius R centred at cy (cut flat at y = 0), open at
// `open`, water up to `water`, gravel up to `gravel`. Box tanks: W x H x D centred on x / z, base at y = 0.
export const TANK3D = [
  // the jar: a mason-jar profile [[inner radius, y], ...] with a screw neck; the bowl: a glass globe
  { shape: 'round', kind: 'jar', R: 9.2, cy: 8, open: 21, water: 15.6, gravel: 2.4, fish: 4.4,
    prof: [[6.4, 0.6], [8.2, 1.2], [9.0, 2.6], [9.2, 5], [9.2, 12.4], [8.8, 14.6], [7.6, 16.6], [6.2, 18.0], [5.9, 18.8], [5.9, 21]] },
  { shape: 'round', kind: 'bowl', R: 17, cy: 14.2, open: 26.6, water: 23.2, gravel: 3.6, fish: 5.4 },
  { shape: 'box', W: 50, H: 27, D: 20, water: 25.2, gravel: 3.2, slope: 2.5, hood: 'lamp', stand: 'desk', fish: 6.2 },
  { shape: 'box', W: 80, H: 42, D: 34, water: 39.5, gravel: 4.5, slope: 5, hood: 'lid', stand: 'cabinet', fish: 7.2 },
  { shape: 'box', W: 104, H: 52, D: 46, water: 49, gravel: 5, slope: 7, hood: 'reef', stand: 'cabinet', fish: 8.2 },
  { shape: 'box', W: 176, H: 72, D: 46, water: 68, gravel: 6, slope: 9, hood: 'wall', stand: 'wall', fish: 9.4 },
];

// Aero per minute by rarity (falls back to the shop table when the Lab rebalances it).
const RATE = { common: 2, uncommon: 3.5, rare: 6, epic: 10, legendary: 20 };

export function tankTier(state) {
  let t = clamp(Math.floor(Number(state?.tank?.tier) || 0), 0, TANK_TIERS.length - 1);
  try {
    for (let i = TANK_IDS.length - 1; i > t; i--) if (unlocked(state, 'tank', TANK_IDS[i])) { t = i; break; }
  } catch { /* lab not ready */ }
  return t;
}

export function tierCapBonus(state) { return TANK_TIERS[tankTier(state)].cap; }

export function aeroRate(rec, sp, stats = {}, tier = 0, bonus = 1, gm = 1) {
  const base = shop.COIN_RATE?.[sp?.rarity] ?? RATE[sp?.rarity] ?? 2;
  const happy = clamp01(rec.happiness ?? 0.7);
  return base * valueMultiplier(rec) * (0.6 + 0.8 * happy) * (TANK_TIERS[tier]?.rate || 1) * (stats.coinMul || 1) * bonus * gm;
}

// ------------------------------------------------------------------ gear (bought with Aero in the aquarium)
export const GEAR = [
  { id: 'filter', name: 'Filter', icon: 'bubble', levels: ['Sponge Filter', 'Hang-on Filter', 'Canister Filter', 'Turbo Aero Filter'], cost: [0, 120, 480, 1800], desc: 'Crystal-clear water. Happier fish.' },
  { id: 'heater', name: 'Heater', icon: 'sun', levels: ['No Heater', 'Glass Heater', 'Smart Heater'], cost: [0, 90, 650], desc: 'Cosy water. Tropical fish love it.' },
  { id: 'light', name: 'Lid Light', icon: 'star', levels: ['Basic LED', 'Aero LED', 'Rainbow LED', 'Sunrise Array'], cost: [0, 150, 700, 2400], desc: 'Brighter light, light shafts, plant growth.' },
  { id: 'air', name: 'Air Stones', icon: 'bubble', levels: ['One Air Stone', 'Twin Stones', 'Bubble Wall', 'Geyser Stones'], cost: [0, 80, 400, 1500], desc: 'More bubbles. Fish play in the stream.' },
  { id: 'sand', name: 'Substrate', icon: 'coral', levels: ['Aqua Gravel', 'Beach Sand', 'Snow Pebbles', 'Rainbow Gravel', 'Black Sand'], cost: [0, 60, 120, 250, 250], desc: 'A new floor. Pure style.', cosmetic: true },
];
export const GEAR_BY_ID = Object.fromEntries(GEAR.map((g) => [g.id, g]));

export function gearLevel(state, id) {
  const g = GEAR_BY_ID[id];
  const v = Math.floor(Number(state?.tank?.gear?.[id]) || 0);
  return g ? clamp(v, 0, g.levels.length - 1) : 0;
}
export function gearCost(id, level) { return GEAR_BY_ID[id]?.cost[level] ?? Infinity; }
// income multiplier from equipment (cosmetics excluded)
export function gearMul(state) {
  let n = 0;
  for (const g of GEAR) if (!g.cosmetic) n += gearLevel(state, g.id);
  return 1 + n * 0.04;
}
// happiness target bonus from equipment
export function gearHappy(state) {
  return gearLevel(state, 'filter') * 0.03 + gearLevel(state, 'heater') * 0.035 + gearLevel(state, 'light') * 0.015 + gearLevel(state, 'air') * 0.02;
}
