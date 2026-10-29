// Fishing rods (phase 3, Fisch-style ladder). OWNER: Lab agent (data); the fishing agent reads rodStats().
// Rods are unlocked in the Lab and kept in state.rods = {owned:[ids], equipped:id, skins:{rodId: skinId}}.
//   RODS: [{id, name, desc, tier, rarity, stats:{lureSpeed, luck, control, resilience, strength, shock:{power, charges, cooldown}}, look:{...}}]
//     lureSpeed  1 = base; higher = fish bite sooner
//     luck       1 = base; multiplies rarity rolls
//     control    1 = base; size of the reel "sweet spot" / how forgiving the reel is
//     resilience 0..1; how much progress you keep when the fish fights back
//     strength   max fish weight (kg) before the line is at risk
//     shock      the rod's stun zap: power (stun seconds), charges per fight, cooldown (s)
//   ensureRods(state), equippedRod(state) -> rod, rodStats(state) -> rod.stats merged with Lab bonuses (stats.rodLuck etc.)
export const RODS = [
  { id: 'twig', name: 'Twig & String', desc: 'Everyone starts somewhere. Somewhere soggy.', tier: 0, rarity: 'common',
    stats: { lureSpeed: 1, luck: 1, control: 1, resilience: 0.1, strength: 6, shock: { power: 0.8, charges: 1, cooldown: 6 } } },
  { id: 'glass', name: 'Glass Rod', desc: 'Clear, glossy and surprisingly bendy.', tier: 1, rarity: 'uncommon',
    stats: { lureSpeed: 1.2, luck: 1.1, control: 1.15, resilience: 0.2, strength: 15, shock: { power: 1, charges: 2, cooldown: 5 } } },
  { id: 'aero', name: 'Aero Carbon', desc: 'Light as a bubble, strong as a dolphin.', tier: 2, rarity: 'rare',
    stats: { lureSpeed: 1.35, luck: 1.25, control: 1.3, resilience: 0.3, strength: 40, shock: { power: 1.2, charges: 2, cooldown: 4 } } },
];
export const ROD_BY_ID = Object.fromEntries(RODS.map((r) => [r.id, r]));

export function ensureRods(state) {
  state.rods ||= { owned: ['twig'], equipped: 'twig', skins: {} };
  return state.rods;
}
export function equippedRod(state) { return ROD_BY_ID[ensureRods(state).equipped] || RODS[0]; }
export function rodStats(state, stats = null) {
  const r = equippedRod(state).stats;
  const s = stats || {};
  return {
    ...r,
    lureSpeed: r.lureSpeed * (s.rodLure || 1), luck: r.luck * (s.rodLuck || 1), control: r.control * (s.rodControl || 1),
    resilience: Math.min(0.9, r.resilience + (s.rodResilience || 0)), strength: r.strength * (s.rodStrength || 1),
    shock: { ...r.shock, power: r.shock.power * (s.shockPower || 1), charges: r.shock.charges + (s.shockCharges || 0), cooldown: r.shock.cooldown * (s.shockCooldown || 1) },
  };
}
