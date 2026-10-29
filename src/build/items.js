// Items, inventory and packages.
//
// ITEMS[id] = {id, name, kind: material|blueprint|decor|bait|cosmetic|package|egg, rarity, desc, lore, value,
//              art (itemart id), biome?, builds? (blueprint -> building/decor id), prop? (decor), slot/look (cosmetic), tier (package)}
//   Materials: driftwood, kelp_fibre, shell, sea_glass, coral_chunk, pearl, scrap_metal, gear, circuit_board,
//   ancient_stone, abyss_crystal, golden_scale, fish_sample, rare_specimen (+ fish_egg).
//   Blueprints: bp_<building id> (BUILDINGS) and bp_<prop id> (seabed decor). Bait ids mirror BAITS (stored in
//   state.baits). Decor ids are PROPS ids with a decor field. Cosmetics: cos_<slot>_<id> from WARDROBE.
//   Packages: pkg_crate, pkg_iron, pkg_golden, pkg_orb (the package objects live in state.inventory.packages).
// addItem(state, id, qty) / removeItem(state, id, qty) -> bool / countItem(state, id)
// rollPackage(species, biome, luck = 0) -> null | {tier}      ~8-15% per fish, rarer fish -> better tiers
// openPackage(pkg) -> [{id, qty}]                              loot ('coins' = coin amount)
// grantLoot(game, loot) applies loot to the save (coins via game.addCoins).
// drawPackage(ctx, x, y, tier, t, opts) draws the crate hanging under the rope point (x, y).
// sellValue(state, id) coins for one item (Shell Shack bonus applied).

import { rng, uid } from '../core/rng.js';
import { RARITY_ORDER } from '../core/color.js';
import { BAITS, BAIT_ORDER } from '../game/shopdata.js';
import { PROPS } from '../gfx/props.js';
import * as CHAR from '../gfx/character.js';
import { BUILDINGS, BUILDING_ORDER, DECOR_BUILDS, buildingBonus } from './buildings.js';
import { packageParts } from './itemart.js';

const RVAL = { common: 1, uncommon: 2.5, rare: 6, epic: 18, legendary: 60 };

export const ITEMS = {};
function add(id, o) { ITEMS[id] = { id, art: id, lore: '', biome: null, ...o }; return ITEMS[id]; }

// ---------------------------------------------------------------- materials
const MATS = [
  ['driftwood', 'Driftwood', 'common', 'shallows', 'Sun-bleached wood, perfect for planks and frames.', 'Washed up from a ship called "Probably Fine".'],
  ['kelp_fibre', 'Kelp Fibre', 'common', 'shallows', 'Tough woven kelp. Rope, nets, bait binding.', 'Smells like the sea and slightly like soup.'],
  ['shell', 'Pretty Shell', 'common', 'shallows', 'A pastel scallop shell. Decor, tiles and trade.', 'You can hear a tiny ocean inside. It is complaining.'],
  ['sea_glass', 'Sea Glass', 'uncommon', 'shallows', 'Frosted glass pebbles. Windows, lamps and lenses.', 'Every piece used to be a bottle with a message.'],
  ['coral_chunk', 'Coral Chunk', 'uncommon', 'shallows', 'A living branch of reef. Gardens and hatcheries.', 'Please water it. It is underwater. It is fine.'],
  ['pearl', 'Pearl', 'rare', 'shallows', 'A flawless pearl. Prized by builders and clams alike.', 'The clam wants it back. The clam is not getting it back.'],
  ['scrap_metal', 'Scrap Metal', 'common', 'junkyard', 'Bent plates and bolts. Frames, hulls and machines.', 'Possibly part of a fridge. Possibly part of a submarine.'],
  ['gear', 'Brass Gear', 'uncommon', 'junkyard', 'A sturdy brass cog for anything that turns.', 'Still spins when nobody is watching.'],
  ['circuit_board', 'Circuit Board', 'rare', 'junkyard', 'A salvaged board with blinking LEDs. Electronics.', 'Contains 4 GB of fish memes.'],
  ['ancient_stone', 'Ancient Stone', 'rare', 'abyss', 'Carved abyssal stone with a faint glowing rune.', 'The rune translates roughly to "do not lick".'],
  ['abyss_crystal', 'Abyss Crystal', 'epic', 'abyss', 'A humming crystal from the deep. Powers strange things.', 'It glows brighter when you think about snacks.'],
  ['golden_scale', 'Golden Scale', 'legendary', null, 'A scale shed by a legendary fish. Pure luck, solidified.', 'Finders keepers. Losers weepers. Fish sleepers.'],
  ['fish_sample', 'Fish Sample', 'common', null, 'A vial of fish DNA from your catches. Used in research.', 'Labelled "DEFINITELY NOT SUSHI".'],
  ['rare_specimen', 'Rare Specimen', 'rare', null, 'A preserved rare fish sample. Advanced research.', 'It winked at you. Specimens do not wink.'],
];
const MAT_VAL = { common: 3, uncommon: 8, rare: 22, epic: 65, legendary: 220 };
for (const [id, name, rarity, biome, desc, lore] of MATS) add(id, { name, kind: 'material', rarity, biome, desc, lore, value: MAT_VAL[rarity] });
export const MATERIAL_IDS = MATS.map((m) => m[0]);

add('fish_egg', { name: 'Fish Egg', kind: 'egg', rarity: 'uncommon', desc: 'A warm egg from the Hatchery. Hatch it into a baby fish for your aquarium.', lore: 'Something inside is doing a little dance.', value: 15 });

// ---------------------------------------------------------------- blueprints
const BP_VAL = { common: 30, uncommon: 70, rare: 160, epic: 420, legendary: 1000 };
for (const id of BUILDING_ORDER) {
  const b = BUILDINGS[id];
  add('bp_' + id, { name: b.name + ' Blueprint', kind: 'blueprint', rarity: b.rarity, builds: id, art: 'scroll', desc: b.desc, lore: b.lore, value: BP_VAL[b.rarity], building: true });
}
for (const [id, d] of Object.entries(DECOR_BUILDS)) {
  add('bp_' + id, { name: d.name + ' Plans', kind: 'blueprint', rarity: d.rarity, builds: id, art: 'scroll', desc: d.desc, lore: 'Some assembly required. Some fish required to hold the ladder.', value: Math.round(BP_VAL[d.rarity] * 0.5), building: false });
}

// ---------------------------------------------------------------- bait (stored in state.baits)
for (const id of BAIT_ORDER) {
  const b = BAITS[id];
  const r = b.price < 30 ? 'common' : b.price < 80 ? 'uncommon' : b.price < 200 ? 'rare' : b.price < 600 ? 'epic' : 'legendary';
  add(id, { name: b.name, kind: 'bait', rarity: r, desc: b.desc, art: null, value: Math.max(1, Math.round((b.price / b.qty) * 0.4)), bait: id });
}

// ---------------------------------------------------------------- decor (PROPS with a decor field)
for (const [id, p] of Object.entries(PROPS)) {
  if (!p.decor || ITEMS[id]) continue;
  const pr = p.decor.price;
  const r = pr < 80 ? 'common' : pr < 220 ? 'uncommon' : pr < 450 ? 'rare' : pr < 900 ? 'epic' : 'legendary';
  add(id, { name: p.name, kind: 'decor', rarity: r, prop: id, art: null, biome: p.biome === 'aquarium' ? null : p.biome, desc: `Decoration for your aquarium${DECOR_BUILDS[id] ? ' or the seabed' : ''}. Size: ${['', 'small', 'medium', 'large'][p.decor.size] || 'medium'}.`, value: Math.round(pr * 0.4) });
}

// ---------------------------------------------------------------- cosmetics (WARDROBE from character.js)
// Cosmetics are ownership flags (state.cosmetics via grantCosmetic); duplicates stack in the inventory to sell.
const COS_VAL = { common: 40, uncommon: 100, rare: 260, epic: 700, legendary: 1800 };
function wardrobeEntries() {
  const W = CHAR.WARDROBE;
  const out = [];
  if (Array.isArray(W)) for (const e of W) if (e && e.id && e.slot) out.push(e);
  return out;
}
for (const w of wardrobeEntries()) {
  if (w.price === 0 || w.unlock === 'skill') continue; // starter gear and skill rewards never drop
  const r = RARITY_ORDER.includes(w.rarity) ? w.rarity : 'uncommon';
  add('cos_' + w.id, { name: w.name || w.id, kind: 'cosmetic', rarity: r, wardrobe: w.id, slot: w.slot, art: null, packageOnly: w.unlock === 'package', desc: w.desc || 'A cosmetic for your fisher.', lore: w.unlock === 'package' ? 'Only found inside packages.' : 'Also sold at the wardrobe.', value: COS_VAL[r] });
}
export const COSMETIC_IDS = Object.keys(ITEMS).filter((id) => ITEMS[id].kind === 'cosmetic');
export function wardrobeItem(id) { return CHAR.WARDROBE_BY_ID?.[ITEMS[id]?.wardrobe] || null; }
export function ownsWardrobe(state, id) {
  const w = wardrobeItem(id);
  if (!w) return false;
  return typeof CHAR.ownsCosmetic === 'function' ? CHAR.ownsCosmetic(state, w) : !!state.cosmetics?.[w.id];
}

// ---------------------------------------------------------------- packages
export const TIERS = {
  crate: { name: 'Driftwood Crate', rarity: 'uncommon', rolls: [2, 3], coins: [8, 30], color: '#c8925a', glow: '#ffe2a8',
    cat: { material: 58, bait: 16, coins: 18, decor: 4, blueprint: 7, cosmetic: 2 }, rar: { common: 64, uncommon: 30, rare: 6 },
    desc: 'A soggy wooden crate tied to a fish. Something rattles inside.' },
  iron: { name: 'Iron Crate', rarity: 'rare', rolls: [3, 4], coins: [30, 90], color: '#7a8094', glow: '#bfe8ff',
    cat: { material: 46, bait: 14, coins: 16, decor: 10, blueprint: 16, cosmetic: 6 }, rar: { common: 30, uncommon: 40, rare: 24, epic: 6 },
    desc: 'A riveted iron crate. Heavy. Promising. Slightly rusty.' },
  golden: { name: 'Golden Chest', rarity: 'epic', rolls: [4, 5], coins: [120, 320], color: '#f0b83c', glow: '#fff2b8', guarantee: ['blueprint'],
    cat: { material: 36, bait: 12, coins: 14, decor: 14, blueprint: 18, cosmetic: 10 }, rar: { uncommon: 22, rare: 46, epic: 26, legendary: 6 },
    desc: 'A gilded treasure chest. A fish was very proud to carry this.' },
  orb: { name: 'Mystery Orb', rarity: 'legendary', rolls: [5, 6], coins: [300, 900], color: '#a46aff', glow: '#ff9ae8', guarantee: ['blueprint', 'cosmetic'],
    cat: { material: 30, bait: 8, coins: 12, decor: 16, blueprint: 22, cosmetic: 14 }, rar: { rare: 30, epic: 46, legendary: 24 },
    desc: 'A swirling orb from beyond the abyss. It hums your favourite song.' },
};
export const TIER_ORDER = ['crate', 'iron', 'golden', 'orb'];
for (const t of TIER_ORDER) add('pkg_' + t, { name: TIERS[t].name, kind: 'package', rarity: TIERS[t].rarity, tier: t, art: 'pkg_' + t, desc: TIERS[t].desc, lore: 'Open it from your inventory.', value: 0 });
add('coins', { name: 'Coins', kind: 'coins', rarity: 'common', art: 'coins', desc: 'Oxidized Coins.', value: 1 });

// ---------------------------------------------------------------- inventory ops

export function inventory(state) {
  const inv = (state.inventory ||= { items: {}, packages: [] });
  inv.items ||= {};
  inv.packages ||= [];
  return inv;
}

export function addItem(state, id, qty = 1) {
  if (!id || qty <= 0) return;
  const it = ITEMS[id];
  if (it?.kind === 'bait') { state.baits[id] = (state.baits[id] || 0) + qty; return; }
  if (it?.kind === 'package') { for (let i = 0; i < qty; i++) addPackage(state, it.tier); return; }
  if (it?.kind === 'cosmetic' && !ownsWardrobe(state, id)) {
    if (typeof CHAR.grantCosmetic === 'function') CHAR.grantCosmetic(state, it.wardrobe);
    else (state.cosmetics ||= {})[it.wardrobe] = true;
    (inventory(state).fresh ||= {})[id] = Date.now();
    if (--qty <= 0) return;
  }
  const inv = inventory(state);
  inv.items[id] = (inv.items[id] || 0) + qty;
  (inv.fresh ||= {})[id] = Date.now();
}

export function removeItem(state, id, qty = 1) {
  const it = ITEMS[id];
  if (it?.kind === 'bait') {
    if ((state.baits[id] || 0) < qty) return false;
    state.baits[id] -= qty;
    if (state.baits[id] <= 0) delete state.baits[id];
    return true;
  }
  const inv = inventory(state);
  if ((inv.items[id] || 0) < qty) return false;
  inv.items[id] -= qty;
  if (inv.items[id] <= 0) delete inv.items[id];
  return true;
}

export function countItem(state, id) {
  const it = ITEMS[id];
  if (it?.kind === 'bait') return state.baits?.[id] || 0;
  if (it?.kind === 'package') return (state.inventory?.packages || []).filter((p) => p.tier === it.tier).length;
  if (it?.kind === 'cosmetic') return (ownsWardrobe(state, id) ? 1 : 0) + (state.inventory?.items?.[id] || 0);
  return state.inventory?.items?.[id] || 0;
}

export function addPackage(state, tier, from = null) {
  const inv = inventory(state);
  const pkg = { uid: uid(), tier: TIERS[tier] ? tier : 'crate', from, at: Date.now() };
  inv.packages.push(pkg);
  return pkg;
}

export function hasItems(state, items = {}) {
  return Object.entries(items).every(([id, q]) => countItem(state, id) >= q);
}
export function takeItems(state, items = {}) {
  if (!hasItems(state, items)) return false;
  for (const [id, q] of Object.entries(items)) removeItem(state, id, q);
  return true;
}

export function sellValue(state, id) {
  const it = ITEMS[id];
  if (!it || !it.value) return 0;
  return Math.max(1, Math.round(it.value * (1 + buildingBonus(state, 'sellMul'))));
}

// ---------------------------------------------------------------- packages: roll + open

const FISH_CHANCE = { common: 0.08, uncommon: 0.095, rare: 0.115, epic: 0.135, legendary: 0.15 };
const FISH_TIERS = {
  common: [82, 16, 2, 0], uncommon: [66, 28, 5.5, 0.5], rare: [46, 38, 14, 2], epic: [24, 40, 28, 8], legendary: [0, 30, 48, 22],
};

export function rollPackage(species, biome, luck = 0) {
  const r = species?.rarity || 'common';
  const deep = biome === 'abyss' ? 1.15 : biome === 'junkyard' ? 1.05 : 1;
  if (!rng.chance((FISH_CHANCE[r] ?? 0.08) * deep * (1 + luck))) return null;
  const w = FISH_TIERS[r] || FISH_TIERS.common;
  const shift = biome === 'abyss' ? 1 : 0;
  const tiers = TIER_ORDER.map((t, i) => [t, w[i] * (i >= 2 ? 1 + shift * 0.5 + luck : 1)]);
  const tier = rng.weighted(tiers, (x) => x[1])[0];
  return { tier, species: species?.id || null, biome: biome || null };
}

function pickRarity(table) {
  return rng.weighted(Object.entries(table), (e) => e[1])[0];
}

// Picks an item of a category close to the wanted rarity.
function pickOf(cat, rarity, biome) {
  const pool = Object.values(ITEMS).filter((it) => {
    if (cat === 'material') return it.kind === 'material' || it.kind === 'egg';
    if (cat === 'blueprint') return it.kind === 'blueprint' && it.builds !== 'research_lab';
    return it.kind === cat;
  });
  if (!pool.length) return null;
  const want = RARITY_ORDER.indexOf(rarity);
  for (let d = 0; d < 5; d++) {
    const cands = pool.filter((it) => Math.abs(RARITY_ORDER.indexOf(it.rarity) - want) === d && (d > 0 || RARITY_ORDER.indexOf(it.rarity) <= want));
    if (cands.length) return rng.weighted(cands, (it) => (cat === 'material' && biome && it.biome === biome ? 3 : 1) * (cat === 'blueprint' && it.building ? 1.6 : 1) * (cat === 'cosmetic' && it.packageOnly ? 2.5 : 1));
  }
  return rng.pick(pool);
}

function qtyFor(it, tier) {
  const ti = TIER_ORDER.indexOf(tier);
  if (it.kind === 'material') {
    const base = { common: [2, 5], uncommon: [1, 3], rare: [1, 2], epic: [1, 1], legendary: [1, 1] }[it.rarity] || [1, 1];
    return rng.int(base[0], base[1] + (it.rarity === 'common' || it.rarity === 'uncommon' ? ti : 0));
  }
  if (it.kind === 'bait') return Math.max(1, Math.round((BAITS[it.id]?.qty || 1) * (0.6 + ti * 0.35)));
  return 1;
}

export function openPackage(pkg) {
  const T = TIERS[pkg?.tier] || TIERS.crate;
  const n = rng.int(T.rolls[0], T.rolls[1]);
  const cats = [...(T.guarantee || [])];
  while (cats.length < n) cats.push(rng.weighted(Object.entries(T.cat), (e) => e[1])[0]);
  const out = new Map();
  for (const cat of cats) {
    if (cat === 'coins') { out.set('coins', (out.get('coins') || 0) + rng.int(T.coins[0], T.coins[1])); continue; }
    let it = pickOf(cat, pickRarity(T.rar), pkg?.biome);
    if (!it && cat === 'cosmetic') it = pickOf('decor', pickRarity(T.rar));
    if (!it) { out.set('coins', (out.get('coins') || 0) + rng.int(T.coins[0], T.coins[1])); continue; }
    out.set(it.id, (out.get(it.id) || 0) + qtyFor(it, pkg?.tier || 'crate'));
  }
  // the fish's own DNA always comes along
  if (pkg?.species) out.set('fish_sample', (out.get('fish_sample') || 0) + 1);
  const list = [...out.entries()].map(([id, qty]) => ({ id, qty }));
  const rank = (e) => (e.id === 'coins' ? -1 : RARITY_ORDER.indexOf(ITEMS[e.id]?.rarity || 'common'));
  list.sort((a, b) => rank(a) - rank(b));
  return list;
}

export function grantLoot(game, loot, x, y) {
  for (const { id, qty } of loot) {
    if (id === 'coins') game.addCoins?.(qty, x, y);
    else addItem(game.state, id, qty);
  }
}

// ---------------------------------------------------------------- package art

// Crate hanging below the rope attachment point (x, y). opts: {scale, rope (px), swing}
export function drawPackage(ctx, x, y, tier, t = 0, opts = {}) {
  const scale = opts.scale ?? 0.7;
  const p = packageParts(TIERS[tier] ? tier : 'crate', scale, 0, true);
  if (!p) return null;
  const rope = Math.round(opts.rope ?? 6 * scale + 3);
  const sw = opts.swing ?? Math.sin(t * 2.3) * 1.6;
  const bx = Math.round(x + sw), by = Math.round(y + rope);
  // rope: a little catenary of pixels from the attachment point to the crate's top loop
  ctx.fillStyle = '#3a2614';
  for (let i = 0; i <= rope; i++) {
    const k = i / rope;
    ctx.fillRect(Math.round(x + sw * k + Math.sin(k * Math.PI) * 0.6), Math.round(y + i), 1, 1);
  }
  ctx.fillStyle = '#e0c890';
  ctx.fillRect(Math.round(x) - 1, Math.round(y) - 1, 2, 2);
  const dx = bx - p.top[0], dy = by - p.top[1];
  if (p.glow && tier !== 'crate') {
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.6 + 0.3 * Math.sin(t * 4);
    ctx.drawImage(p.glow, dx, dy);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }
  ctx.drawImage(p.full, dx, dy);
  return { x: dx, y: dy, w: p.w, h: p.h };
}
