// Boat tiers bought at Barnaby's Boatyard (panel 'boatyard'). The voxel boat itself is rendered elsewhere
// from game.state.boat.tier. Perks are plain data read with boatBonus(state, key):
//   baitSlots  (add)  extra bait box slots                     -> stats.boxSlots += value
//   reel       (mul)  reel speed multiplier                     -> stats.reelSpeed *= value
//   depth      (add)  extra world px the camera may scroll below the default view (deeper water)
//   coinMagnet (mul)  coin collect radius multiplier            -> stats.collectRadius *= value
//   rarity     (mul)  rare fish spawn multiplier (sonar)        -> world.rarityBoost *= value
//   netBoost   (mul)  satellite internet: download speed multiplier (applied by the store itself)

export const BOAT_PERKS = {
  baitSlots: { label: 'Bait box slots', kind: 'add', fmt: (v) => '+' + v },
  reel: { label: 'Reel speed', kind: 'mul', fmt: (v) => '+' + Math.round((v - 1) * 100) + '%' },
  depth: { label: 'Dive depth', kind: 'add', fmt: (v) => '+' + Math.round(v / 8) + ' m' },
  coinMagnet: { label: 'Coin magnet', kind: 'mul', fmt: (v) => '+' + Math.round((v - 1) * 100) + '%' },
  rarity: { label: 'Rare fish sonar', kind: 'mul', fmt: (v) => '+' + Math.round((v - 1) * 100) + '%' },
  netBoost: { label: 'Satellite internet', kind: 'mul', fmt: (v) => 'x' + v },
};

export const BOAT_TIERS = [
  { id: 'dinghy', name: 'Rusty Dinghy', price: 0, desc: 'It floats. Mostly. Bring a bucket.',
    perks: { baitSlots: 0, reel: 1, depth: 0, coinMagnet: 1, rarity: 1, netBoost: 1 } },
  { id: 'fishing', name: 'Fishing Boat', price: 150, desc: 'A real cabin! With a real leak!',
    perks: { baitSlots: 1, reel: 1.1, depth: 0, coinMagnet: 1.15, rarity: 1, netBoost: 1 } },
  { id: 'trawler', name: 'Trawler', price: 900, desc: 'Big nets, bigger dreams. Smells like both.',
    perks: { baitSlots: 2, reel: 1.2, depth: 80, coinMagnet: 1.3, rarity: 1.05, netBoost: 1 } },
  { id: 'yacht', name: 'Luxury Yacht', price: 3200, desc: 'Satellite internet, hot tub, zero fish knowledge.',
    perks: { baitSlots: 3, reel: 1.3, depth: 160, coinMagnet: 1.6, rarity: 1.1, netBoost: 1.5 } },
  { id: 'research', name: 'Research Vessel', price: 9000, desc: 'Sonar, cranes and a tiny submarine. SCIENCE!',
    perks: { baitSlots: 5, reel: 1.45, depth: 320, coinMagnet: 2, rarity: 1.25, netBoost: 2 } },
];

export function boatTier(state) {
  return Math.max(0, Math.min(BOAT_TIERS.length - 1, state?.boat?.tier | 0));
}

export function boatBonus(state, key) {
  const v = BOAT_TIERS[boatTier(state)].perks[key];
  if (v !== undefined) return v;
  return BOAT_PERKS[key]?.kind === 'mul' ? 1 : 0;
}

// Buys the next boat tier. Returns true on success (emits 'boatUpgraded' with the new tier).
export function buyBoat(game, tier) {
  const st = game.state;
  st.boat ||= { tier: 0 };
  const cur = boatTier(st);
  const b = BOAT_TIERS[tier];
  if (!b || tier !== cur + 1) return false;
  if (st.coins < b.price) return false;
  st.coins -= b.price;
  st.boat.tier = tier;
  game.emit?.('boatUpgraded', tier);
  game.save?.();
  return true;
}
