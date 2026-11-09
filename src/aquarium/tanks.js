// Aquarium tank tiers and tank gear (phase 6: a real 3D tank; phase 7: YOUR TANK IS A CUBE).
//
//   TANK_IDS / TANK_TIERS[i]   {id, name, shape: 'cube', cap (extra fish over stats.tankCap), rate (income
//                               multiplier), offlineH (offline earnings cap, hours), plants, water}
//   TANK3D[i]                  3D size of the tier in centimetres (inner glass): a glass cube {W = H = D, water, gravel,
//                               slope, glass (pane thickness), stand: 'desk' (on a glossy plinth on the desk) |
//                               'pedestal' (a tall Aero pedestal on the floor), light: 'arm' | 'halo', fish}; the
//                               tank's base sits at y = 0. The ids are the Lab's (tank:jar ... tank:wallaquarium).
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
  { id: 'jar', name: 'Nano Cube', shape: 'cube', cap: 0, rate: 1, offlineH: 3, plants: 4, water: 'aero' },
  { id: 'bowl', name: 'Bubble Cube', shape: 'cube', cap: 1, rate: 1.15, offlineH: 4, plants: 6, water: 'aero' },
  { id: 'smalltank', name: 'Aqua Cube', shape: 'cube', cap: 2, rate: 1.3, offlineH: 5, plants: 9, water: 'aero' },
  { id: 'bigtank', name: 'Big Cube', shape: 'cube', cap: 3, rate: 1.5, offlineH: 6, plants: 13, water: 'aero' },
  { id: 'reeftank', name: 'Reef Cube', shape: 'cube', cap: 4, rate: 1.75, offlineH: 7, plants: 18, water: 'reef' },
  { id: 'wallaquarium', name: 'Mega Cube', shape: 'cube', cap: 5, rate: 2.1, offlineH: 8, plants: 26, water: 'aero' },
];

// Inner glass dimensions (cm): every tier is a glass cube (W = H = D) centred on x / z with its base at y = 0.
const cube = (S, o) => ({ shape: 'box', cube: true, W: S, H: S, D: S, water: Math.round(S * 0.9 * 10) / 10, ...o });
export const TANK3D = [
  cube(24, { gravel: 2.6, slope: 1.2, glass: 0.7, stand: 'desk', light: 'arm', fish: 4.4 }),
  cube(32, { gravel: 3.1, slope: 1.8, glass: 0.8, stand: 'desk', light: 'arm', fish: 5.2 }),
  cube(42, { gravel: 3.7, slope: 2.6, glass: 0.95, stand: 'desk', light: 'arm', fish: 6.1 }),
  cube(54, { gravel: 4.4, slope: 3.8, glass: 1.1, stand: 'pedestal', light: 'halo', fish: 7.1 }),
  cube(68, { gravel: 5.2, slope: 5.2, glass: 1.3, stand: 'pedestal', light: 'halo', fish: 8.1 }),
  cube(86, { gravel: 6, slope: 6.8, glass: 1.55, stand: 'pedestal', light: 'halo', fish: 9.4 }),
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
