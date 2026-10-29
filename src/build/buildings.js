// Seabed buildings: definitions, upgrade levels, production timers, the Treasure Vault, Bait Workshop
// recipes and the bonus hook the orchestrator reads.
//
// BUILDINGS[id] = {name, rarity, unique, desc, lore, cost: {coins, items}, action, bonus: {key: [lv1, lv2, lv3]},
//                  produce?: {every (s), cap: [..], give: [{id, qty, w}] | coins: [min, max]}, upgrades: [cost lv2, cost lv3]}
// DECOR_BUILDS[id] = seabed decor (a PROPS id) placed from a decor blueprint.
// buildingBonus(state, key) -> number (sum over placed buildings at their level + research perks; 0 when none).
//   Keys: rarity, nightRarity, coinMul, baitRadius, luck (package chance), shiny, mutation, sellMul,
//         eggChance, baitSave, researchSpeed, light (lighthouse beam strength). Multiplicative keys are
//         read as (1 + value).
// Placed record (state.buildings[]): {uid, id, x, z, flip, lvl, built, prod, on}.

import { PROPS } from '../gfx/props.js';

export const MAX_LEVEL = 3;
// Seabed depth range buildings can stand at (DepthScene z).
export const ZMIN = 0.04, ZMAX = 1.3;

export const BUILDINGS = {
  research_lab: {
    name: 'Research Lab', rarity: 'common', unique: true, size: 1,
    desc: 'A cosy house of science with a rooftop antenna. Enter to research blueprints, baits, upgrades and perks.',
    lore: 'Home of Professor Bubbles, who once proved fish can count (to three).',
    cost: { coins: 30, items: { driftwood: 6, kelp_fibre: 4, sea_glass: 2 } },
    action: 'research', bonus: { researchSpeed: [0, 0.15, 0.3] },
    upgrades: [{ coins: 400, items: { driftwood: 8, gear: 3, sea_glass: 4 } }, { coins: 1400, items: { circuit_board: 3, ancient_stone: 3, pearl: 2 } }],
  },
  coral_garden: {
    name: 'Coral Garden', rarity: 'common', size: 1,
    desc: 'Terraced coral beds that slowly grow coral, kelp and shells for you to harvest.',
    lore: 'The polyps unionised. They now demand ambient whale song.',
    cost: { coins: 150, items: { coral_chunk: 3, shell: 3, kelp_fibre: 2 } },
    action: 'collect', bonus: { coinMul: [0.03, 0.05, 0.08] },
    produce: { every: 20 * 60, cap: [3, 5, 8], give: [{ id: 'coral_chunk', qty: 1, w: 4 }, { id: 'kelp_fibre', qty: 2, w: 4 }, { id: 'shell', qty: 1, w: 3 }, { id: 'pearl', qty: 1, w: 0.4 }] },
    upgrades: [{ coins: 350, items: { coral_chunk: 6, shell: 4 } }, { coins: 1100, items: { coral_chunk: 10, pearl: 2 } }],
  },
  bubble_tower: {
    name: 'Bubble Tower', rarity: 'uncommon', size: 0.7,
    desc: 'A spiralling glass tower that blows coin bubbles and widens the pull of your bait.',
    lore: 'Built by a pufferfish with very strong opinions about architecture.',
    cost: { coins: 220, items: { sea_glass: 4, scrap_metal: 3, shell: 2 } },
    action: 'collect', bonus: { baitRadius: [0.08, 0.13, 0.2] },
    produce: { every: 12 * 60, cap: [3, 4, 6], coins: [8, 22] },
    upgrades: [{ coins: 500, items: { sea_glass: 6, gear: 2 } }, { coins: 1500, items: { sea_glass: 10, circuit_board: 2 } }],
  },
  bait_workshop: {
    name: 'Bait Workshop', rarity: 'uncommon', size: 1,
    desc: 'A tinkerer\'s shed with a bait press. Crafts special bait from materials, and sometimes saves a bait.',
    lore: 'Smells of worms and ambition.',
    cost: { coins: 260, items: { driftwood: 6, scrap_metal: 4, gear: 2 } },
    action: 'workshop', bonus: { baitSave: [0.06, 0.1, 0.15] },
    upgrades: [{ coins: 600, items: { scrap_metal: 6, gear: 4 } }, { coins: 1800, items: { circuit_board: 3, gear: 6 } }],
  },
  shell_shack: {
    name: 'Shell Shack', rarity: 'uncommon', size: 0.9,
    desc: 'A hermit crab\'s trading post. Gathers shells, glass and pearls, and haggles better prices when you sell.',
    lore: 'Shelly the hermit crab moved in and never moved out. She moves house a lot, just never out.',
    cost: { coins: 240, items: { driftwood: 5, shell: 6, pearl: 1 } },
    action: 'collect', bonus: { sellMul: [0.1, 0.18, 0.28] },
    produce: { every: 30 * 60, cap: [2, 4, 6], give: [{ id: 'shell', qty: 2, w: 4 }, { id: 'sea_glass', qty: 1, w: 3 }, { id: 'pearl', qty: 1, w: 1 }] },
    upgrades: [{ coins: 550, items: { shell: 8, pearl: 2 } }, { coins: 1600, items: { pearl: 4, golden_scale: 1 } }],
  },
  hatchery: {
    name: 'Fish Hatchery', rarity: 'rare', size: 1,
    desc: 'Warm nursery tanks. Lays fish eggs over time and sometimes gives a bonus egg when you catch a fish.',
    lore: 'Every egg has a name. Most of them are "Kevin".',
    cost: { coins: 450, items: { coral_chunk: 5, kelp_fibre: 6, fish_sample: 4 } },
    action: 'collect', bonus: { eggChance: [0.04, 0.07, 0.11] },
    produce: { every: 40 * 60, cap: [2, 3, 5], give: [{ id: 'fish_egg', qty: 1, w: 1 }] },
    upgrades: [{ coins: 900, items: { fish_sample: 8, coral_chunk: 6 } }, { coins: 2400, items: { rare_specimen: 3, pearl: 3 } }],
  },
  arcade: {
    name: 'Sunken Arcade', rarity: 'rare', size: 1,
    desc: 'A flickering claw machine parlour. Spend coins to grab mystery packages. Luck rubs off on your catches.',
    lore: 'The claw is rigged. The claw has always been rigged. Play anyway.',
    cost: { coins: 600, items: { circuit_board: 3, scrap_metal: 6, gear: 3, sea_glass: 3 } },
    action: 'arcade', bonus: { luck: [0.05, 0.09, 0.14] },
    upgrades: [{ coins: 1200, items: { circuit_board: 4, gear: 4 } }, { coins: 3200, items: { circuit_board: 6, abyss_crystal: 1 } }],
  },
  lighthouse: {
    name: 'Lighthouse', rarity: 'epic', unique: true, size: 0.8,
    desc: 'A sunken lighthouse whose lamp still turns. Lights the dark and draws rare night fish to your hook.',
    lore: 'The keeper is a lanternfish named Lumen. He is very proud of his job and his beard.',
    cost: { coins: 800, items: { ancient_stone: 4, sea_glass: 6, gear: 3, pearl: 1 } },
    action: 'toggle', bonus: { nightRarity: [0.15, 0.25, 0.4], light: [1, 1.35, 1.7] },
    upgrades: [{ coins: 1600, items: { sea_glass: 8, ancient_stone: 4 } }, { coins: 4000, items: { abyss_crystal: 2, golden_scale: 1 } }],
  },
  vault: {
    name: 'Treasure Vault', rarity: 'epic', unique: true, size: 1,
    desc: 'A riveted iron vault. Deposit coins and they earn interest every hour, even while you are away.',
    lore: 'Guarded by a very serious clam. The clam is not serious. The clam is asleep.',
    cost: { coins: 1200, items: { scrap_metal: 8, gear: 4, ancient_stone: 3, pearl: 2 } },
    action: 'vault', bonus: {},
    vault: { rate: [0.012, 0.016, 0.022], cap: [3000, 12000, 50000] },
    upgrades: [{ coins: 2500, items: { scrap_metal: 10, gear: 6 } }, { coins: 6000, items: { golden_scale: 2, ancient_stone: 6 } }],
  },
  totem: {
    name: 'Totem of Luck', rarity: 'legendary', unique: true, size: 0.6,
    desc: 'A grinning carved totem. Raises rare and shiny odds, and gives a blessing package once a day.',
    lore: 'It winks when nobody is looking. Everybody has seen it wink.',
    cost: { coins: 1500, items: { driftwood: 8, abyss_crystal: 2, golden_scale: 1, ancient_stone: 3 } },
    action: 'bless', bonus: { rarity: [0.05, 0.08, 0.12], shiny: [0.15, 0.25, 0.4], mutation: [0.05, 0.08, 0.12] },
    upgrades: [{ coins: 3000, items: { abyss_crystal: 2, driftwood: 10 } }, { coins: 8000, items: { golden_scale: 2, abyss_crystal: 3 } }],
  },
};

export const BUILDING_ORDER = ['research_lab', 'coral_garden', 'bubble_tower', 'bait_workshop', 'shell_shack', 'hatchery', 'arcade', 'lighthouse', 'vault', 'totem'];

// Seabed decor that can be built from decor blueprints (PROPS ids).
const DECOR_PICK = ['castle', 'moai_head', 'pagoda_lantern', 'mushroom_house', 'tiki_head', 'bridge', 'pirate_ship', 'sunken_pc', 'diver_helmet', 'anchor', 'treasure_chest', 'arch_ruin', 'crystal_cluster', 'giant_skull'];
export const DECOR_BUILDS = {};
for (const id of DECOR_PICK) {
  const p = PROPS[id];
  if (!p?.decor) continue;
  const price = p.decor.price;
  const rarity = price < 150 ? 'common' : price < 350 ? 'uncommon' : price < 650 ? 'rare' : price < 1200 ? 'epic' : 'legendary';
  DECOR_BUILDS[id] = { name: p.name, rarity, prop: id, size: p.decor.size, desc: `Seabed decoration: a ${p.name.toLowerCase()} for your underwater neighbourhood.`, cost: { coins: Math.round(price * 0.25), items: {} } };
}

export function buildingDef(id) {
  return BUILDINGS[id] || (DECOR_BUILDS[id] ? { ...DECOR_BUILDS[id], decor: true, bonus: {}, action: null } : null);
}

export function levelOf(b) { return Math.max(1, Math.min(MAX_LEVEL, b.lvl || 1)); }

// Max level the research unlocks allow (eng1 -> 2, eng2 -> 3).
export function maxLevelFor(state) {
  const d = state.research?.done || {};
  return d.eng2 ? 3 : d.eng1 ? 2 : 1;
}

export function upgradeCost(b) {
  const def = BUILDINGS[b.id];
  return def?.upgrades?.[levelOf(b) - 1] || null;
}

export function bonusOf(b, key) {
  const def = BUILDINGS[b.id];
  const arr = def?.bonus?.[key];
  if (!arr) return 0;
  return arr[levelOf(b) - 1] ?? arr[arr.length - 1];
}

// Research perks add to the same keys.
export function buildingBonus(state, key) {
  let v = 0;
  for (const b of state?.buildings || []) if (b.on !== false) v += bonusOf(b, key);
  const perks = state?.research?.perks;
  if (perks && perks[key]) v += perks[key];
  return v;
}

export function hasBuilding(state, id) { return (state?.buildings || []).some((b) => b.id === id); }
export function findBuilding(state, id) { return (state?.buildings || []).find((b) => b.id === id) || null; }

// ---------------------------------------------------------------- production

export function produceInfo(b, now = Date.now()) {
  const def = BUILDINGS[b.id];
  const P = def?.produce;
  if (!P) return null;
  const lv = levelOf(b);
  const cap = P.cap[lv - 1] ?? P.cap[P.cap.length - 1];
  const every = P.every / (1 + 0.15 * (lv - 1));
  const since = Math.max(0, (now - (b.prod || b.built || now)) / 1000);
  const ready = Math.min(cap, Math.floor(since / every));
  const next = ready >= cap ? 0 : every - (since % every);
  return { ready, cap, every, next, progress: ready >= cap ? 1 : (since % every) / every };
}

// Rolls the goods for `n` ready batches -> [{id, qty}] (id 'coins' for coin batches).
export function rollProduce(b, n, rnd = Math.random) {
  const P = BUILDINGS[b.id]?.produce;
  const out = {};
  const lv = levelOf(b);
  for (let i = 0; i < n; i++) {
    if (P.coins) out.coins = (out.coins || 0) + Math.round((P.coins[0] + rnd() * (P.coins[1] - P.coins[0])) * (1 + 0.5 * (lv - 1)));
    if (P.give) {
      let tot = 0;
      for (const g of P.give) tot += g.w;
      let r = rnd() * tot;
      const g = P.give.find((q) => (r -= q.w) <= 0) || P.give[0];
      out[g.id] = (out[g.id] || 0) + g.qty;
    }
  }
  return Object.entries(out).map(([id, qty]) => ({ id, qty }));
}

export function markCollected(b, n, now = Date.now()) {
  const info = produceInfo(b, now);
  if (!info) return;
  if (info.ready >= info.cap) b.prod = now;
  else b.prod = (b.prod || b.built || now) + n * info.every * 1000;
}

// ---------------------------------------------------------------- vault

export function vaultInfo(state, now = Date.now()) {
  const b = findBuilding(state, 'vault');
  const v = (state.vault ||= { coins: 0, last: now, earned: 0 });
  if (!b) return { built: false, coins: v.coins, rate: 0, cap: 0 };
  const lv = levelOf(b), def = BUILDINGS.vault.vault;
  const rate = def.rate[lv - 1], cap = def.cap[lv - 1];
  return { built: true, coins: v.coins, rate, cap, earned: v.earned || 0, last: v.last };
}

// Applies compound hourly interest since the last visit (capped at the vault capacity, max 3 days).
export function vaultAccrue(state, now = Date.now()) {
  const info = vaultInfo(state, now);
  const v = state.vault;
  if (!info.built) { v.last = now; return 0; }
  const hours = Math.min(72, Math.max(0, (now - (v.last || now)) / 3600000));
  v.last = now;
  if (v.coins <= 0 || hours <= 0) return 0;
  const grown = Math.min(Math.max(info.cap, v.coins), v.coins * Math.pow(1 + info.rate, hours));
  const gain = grown - v.coins;
  v.coins = grown;
  v.earned = (v.earned || 0) + gain;
  return gain;
}

// ---------------------------------------------------------------- bait workshop recipes

export const RECIPES = [
  { id: 'bread', qty: 6, items: { kelp_fibre: 2 }, coins: 0, lvl: 1 },
  { id: 'worm', qty: 4, items: { kelp_fibre: 2, coral_chunk: 1 }, coins: 5, lvl: 1 },
  { id: 'sugar', qty: 3, items: { shell: 2, sea_glass: 1 }, coins: 10, lvl: 1 },
  { id: 'chip', qty: 3, items: { circuit_board: 1, scrap_metal: 2 }, coins: 10, lvl: 1 },
  { id: 'popup', qty: 4, items: { scrap_metal: 1, sea_glass: 1 }, coins: 8, lvl: 1 },
  { id: 'golden', qty: 1, items: { pearl: 1, gear: 1 }, coins: 40, lvl: 2 },
  { id: 'lantern', qty: 2, items: { sea_glass: 3, abyss_crystal: 1 }, coins: 30, lvl: 2 },
  { id: 'flood', qty: 1, items: { kelp_fibre: 4, sea_glass: 2 }, coins: 30, lvl: 2 },
  { id: 'blackhole', qty: 1, items: { abyss_crystal: 2, circuit_board: 1 }, coins: 90, lvl: 3 },
  { id: 'relic', qty: 1, items: { ancient_stone: 4, golden_scale: 1, abyss_crystal: 2 }, coins: 300, lvl: 3, research: 'relic_lore' },
];

// ---------------------------------------------------------------- arcade / totem

export const ARCADE_PRICE = [60, 55, 50];
export function arcadeRoll(lvl, rnd = Math.random) {
  const w = [[78, 19, 3, 0], [70, 24, 5, 1], [60, 29, 9, 2]][lvl - 1];
  let r = rnd() * 100;
  const tiers = ['crate', 'iron', 'golden', 'orb'];
  for (let i = 0; i < 4; i++) { r -= w[i]; if (r <= 0) return tiers[i]; }
  return 'crate';
}

export const BLESS_COOLDOWN = 20 * 3600 * 1000;
