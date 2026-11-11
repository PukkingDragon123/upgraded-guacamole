// Chests (phase 8, OWNER: Progression agent): tiered chests you crack open with a minigame (src/ui/chest.js, panel
// 'crate'). Chests come from floating boxes (iron and better boxes land in the Satchel as chests), quest rewards
// (ITEMS 'pkg_<tier>') and the deep zones (deeper boxes are higher tiers, see src/world/floaters.js).
//
//   CHESTS {tier: {name, game, color, glow, hint}}   game ([chest16], src/ui/chestgames.js): 'hammer' (crate: the
//                  high-striker) | 'pry' (iron: crowbar mash) | 'chisel' (golden: rhythm) | 'orb' (spin + tap the cracks)
//   chestOf(tier) -> CHESTS entry (unknown tiers fall back to the crate)
//   boxToChest(game, f) -> pkg | null   a fished-up floating box of tier iron+ becomes a chest in the Satchel
//   crackChest(game, pkg, {bonus}) -> [{id, qty}]   removes the chest, rolls + grants its loot ('coins' = Aero),
//                                       bonus (0..2) = extra loot rolls for a great minigame; emits 'chestOpened' {tier, bonus}
import { rng } from '../core/rng.js';
import { RARITY_ORDER } from '../core/color.js';
import { ITEMS, TIERS, inventory, addPackage, rollCrate, grantLoot } from './items.js';

export const CHESTS = {
  crate: { name: 'Driftwood Crate', game: 'hammer', hits: 6, color: '#c8925a', glow: '#ffe2a8', hint: 'Click when the puck is in the gold!' },
  iron: { name: 'Iron Crate', game: 'pry', hits: 4, color: '#7a8094', glow: '#bfe8ff', hint: 'MASH to lever the lid!' },
  golden: { name: 'Golden Chest', game: 'chisel', hits: 10, color: '#f0b83c', glow: '#fff2b8', hint: 'Tap when the glints reach the chisel!' },
  orb: { name: 'Mystery Orb', game: 'orb', hits: 5, color: '#a46aff', glow: '#ff9ae8', hint: 'Drag to spin, tap the crack while it shines!' },
};
export function chestOf(tier) { return CHESTS[tier] || CHESTS.crate; }

export function boxToChest(game, f) {
  const tier = TIERS[f?.tier] ? f.tier : 'crate';
  if (tier === 'crate') return null;
  return addPackage(game.state, tier, { box: true, biome: f?.biome || game.ocean?.biome?.id || null });
}

export function crackChest(game, pkg, o = {}) {
  const st = game.state;
  const inv = inventory(st);
  inv.packages = inv.packages.filter((p) => p !== pkg && p.uid !== pkg?.uid);
  const tier = TIERS[pkg?.tier] ? pkg.tier : 'crate';
  const biome = pkg?.from?.biome || pkg?.biome || game.ocean?.biome?.id || null;
  const luck = (game.stats?.crateLuck || 0) + (Number(game.build?.bonus?.('luck')) || 0);
  const roll = rollCrate(tier, biome, luck);
  const bonus = Math.max(0, Math.min(2, o.bonus | 0));
  const extra = bonus ? rollCrate(tier, biome, luck + 0.15 * bonus) : null;
  const map = new Map();
  const put = (id, q) => map.set(id, (map.get(id) || 0) + q);
  for (const it of roll.items) put(it.id, it.qty);
  if (extra) extra.items.slice(-bonus).forEach((it) => put(it.id, it.qty));
  // fish parts sprinkle: every chest has a few scales, better chests a ribbon or a glow bulb
  put('fish_scale', rng.int(1, 3));
  if (tier !== 'crate' && rng.chance(0.5)) put('fin_ribbon', 1);
  if ((tier === 'golden' || tier === 'orb') && rng.chance(0.4)) put('glow_bulb', 1);
  const aero = Math.round(roll.aero * (1 + bonus * 0.25));
  const loot = [...map.entries()].map(([id, qty]) => ({ id, qty })).filter((e) => ITEMS[e.id]);
  loot.sort((a, b) => RARITY_ORDER.indexOf(ITEMS[a.id]?.rarity || 'common') - RARITY_ORDER.indexOf(ITEMS[b.id]?.rarity || 'common'));
  const list = aero ? [{ id: 'coins', qty: aero }, ...loot] : loot;
  grantLoot(game, list.filter((e) => e.id !== 'coins'));
  if (aero) game.addCoins?.(aero);
  game.emit?.('chestOpened', { tier, bonus, loot: list });
  game.emit?.('boxOpened', { tier, aero, items: loot });
  game.save?.();
  return list;
}
