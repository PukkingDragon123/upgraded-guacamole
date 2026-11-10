// Chests (phase 8, OWNER: Progression agent): tiered chests you crack open with a minigame (src/ui/chest.js, panel
// 'crate'). Chests come from floating boxes (iron and better boxes land in the Satchel as chests), quest rewards
// (ITEMS 'pkg_<tier>') and the deep zones (deeper boxes are higher tiers, see src/world/floaters.js).
//
//   CHESTS {tier: {name, game, hits, color, glow, desc}}   game: 'tap' (weak points) | 'timing' (moving marker)
//                                                            | 'lock' (pick the lock) | 'whack' (catch the cracks)
//   chestOf(tier) -> CHESTS entry (unknown tiers fall back to the crate)
//   boxToChest(game, f) -> pkg | null   a fished-up floating box of tier iron+ becomes a chest in the Satchel
//   crackChest(game, pkg, {bonus}) -> [{id, qty}]   removes the chest, rolls + grants its loot ('coins' = Aero),
//                                       bonus (0..2) = extra loot rolls for a great minigame; emits 'chestOpened' {tier, bonus}
import { rng } from '../core/rng.js';
import { RARITY_ORDER } from '../core/color.js';
import { ITEMS, TIERS, inventory, addPackage, rollCrate, grantLoot } from './items.js';

export const CHESTS = {
  crate: { name: 'Driftwood Crate', game: 'tap', hits: 6, color: '#c8925a', glow: '#ffe2a8', hint: 'Tap the glowing knots!' },
  iron: { name: 'Iron Crate', game: 'timing', hits: 4, color: '#7a8094', glow: '#bfe8ff', hint: 'Hit when the marker is in the zone!' },
  golden: { name: 'Golden Chest', game: 'lock', hits: 3, color: '#f0b83c', glow: '#fff2b8', hint: 'Circle the lock to find the sweet spot, then click!' },
  orb: { name: 'Mystery Orb', game: 'whack', hits: 7, color: '#a46aff', glow: '#ff9ae8', hint: 'Catch the cracks before they fade!' },
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
