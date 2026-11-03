// Fishing rods (phase 3, Fisch-style ladder). OWNER: Lab agent (data); the fishing agent reads rodStats().
// Rods are unlocked in the Lab and kept in state.rods = {owned:[ids], equipped:id, skins:{rodId: skinId}}.
//   RODS: [{id, name, desc, tier, rarity, stats:{lureSpeed, luck, control, resilience, strength, shock:{power, charges, cooldown}}, look:{...}}]
//     lureSpeed  1 = base; higher = fish bite sooner
//     luck       1 = base; multiplies rarity rolls
//     control    1 = base; size of the reel "sweet spot" / how forgiving the reel is
//     resilience 0..1; how much progress you keep when the fish fights back
//     strength   max fish weight (kg) before the line is at risk
//     shock      the rod's stun zap: power (stun seconds), charges per fight, cooldown (s)
//     look       {shaft, grip, reel, tip, glow?, kind}: colours for the rod icon / the character's rod
//                kind: 'stick' | 'wand' | 'carbon' | 'crystal' | 'trident' | 'coil'
//   ensureRods(state), equippedRod(state) -> rod, rodStats(state, stats) -> rod.stats merged with Lab bonuses
//     (stats = game.stats: rodLure, rodLuck, rodControl, rodResilience, rodStrength, shockPower, shockCharges, shockCooldown)
//   ownsRod(state, id), giveRod(state, id), equipRod(state, id) -> bool
//   ROD_STAT_KEYS: display order + max values for stat bars.

const R = (id, tier, rarity, name, desc, stats, look) => ({ id, tier, rarity, name, desc, stats, look });
const S = (lureSpeed, luck, control, resilience, strength, power, charges, cooldown) => ({ lureSpeed, luck, control, resilience, strength, shock: { power, charges, cooldown } });

export const RODS = [
  R('twig', 0, 'common', 'Twig & String', 'Everyone starts somewhere. Somewhere soggy.',
    S(1, 1, 1, 0.1, 6, 0.8, 1, 6), { kind: 'stick', shaft: '#b88a52', grip: '#7a5432', reel: '#c8c8c8', tip: '#e8e0c8' }),
  R('bubble', 1, 'common', 'Bubble Wand', 'Blows a bubble every cast. Fish find it adorable.',
    S(1.15, 1.05, 1.05, 0.12, 9, 0.9, 1, 6), { kind: 'wand', shaft: '#8ee8ff', grip: '#2fb8e8', reel: '#ffffff', tip: '#ff9ad0', glow: '#bff6ff' }),
  R('bamboo', 2, 'uncommon', 'Lucky Bamboo', 'Grown in a sunny pot. Each knot is a wish.',
    S(1.05, 1.3, 1, 0.12, 10, 0.8, 1, 6), { kind: 'stick', shaft: '#8be04a', grip: '#3fae2a', reel: '#f6d27a', tip: '#ffffff' }),
  R('glass', 2, 'uncommon', 'Glass Rod', 'Clear, glossy and surprisingly bendy.',
    S(1.2, 1.1, 1.15, 0.2, 15, 1, 2, 5), { kind: 'crystal', shaft: '#d8f6ff', grip: '#59c3ff', reel: '#bfeaff', tip: '#ffffff', glow: '#e8fbff' }),
  R('kelp', 3, 'uncommon', 'Kelp Whip', 'Floppy and forgiving. Fish never see it coming.',
    S(1.1, 1.05, 1.45, 0.3, 14, 0.9, 1, 5), { kind: 'stick', shaft: '#3fae6a', grip: '#1f7a4a', reel: '#c8f56a', tip: '#c8f56a' }),
  R('chrome', 3, 'rare', 'Chrome Caster', 'So shiny you can check your hair in it.',
    S(1.3, 1.12, 1.25, 0.25, 26, 1.1, 2, 5), { kind: 'carbon', shaft: '#e8eef4', grip: '#3c6f88', reel: '#a8c8dc', tip: '#ffffff' }),
  R('coral', 4, 'rare', 'Coral Crown', 'Grows back stronger every time a fish yanks it.',
    S(1.15, 1.15, 1.2, 0.5, 30, 1, 2, 5), { kind: 'wand', shaft: '#ff8a7a', grip: '#c84a5a', reel: '#ffd0c0', tip: '#ffe8a8' }),
  R('dolphin', 4, 'rare', 'Dolphin Spinner', 'Clicks and whistles. The fish come to chat.',
    S(1.55, 1.2, 1.2, 0.28, 32, 1.1, 2, 4.5), { kind: 'carbon', shaft: '#59c3ff', grip: '#1e8fe0', reel: '#ffffff', tip: '#bfeaff' }),
  R('volt', 5, 'epic', 'Voltaic Rod', 'A rod with a battery. Zaps fish into a polite daze.',
    S(1.3, 1.15, 1.25, 0.32, 38, 2.2, 4, 3), { kind: 'coil', shaft: '#ffe25a', grip: '#2a3a52', reel: '#bfeaff', tip: '#ffffff', glow: '#fff6a0' }),
  R('aurora', 5, 'epic', 'Aurora Rod', 'Shimmers green and violet. Rare fish swoon.',
    S(1.3, 1.75, 1.2, 0.3, 36, 1.2, 2, 4), { kind: 'crystal', shaft: '#8affc8', grip: '#7448b8', reel: '#d27bff', tip: '#ffffff', glow: '#b8ffe0' }),
  R('aero', 6, 'epic', 'Aero Carbon', 'Light as a bubble, strong as a dolphin.',
    S(1.5, 1.35, 1.45, 0.4, 60, 1.4, 3, 4), { kind: 'carbon', shaft: '#2fd3e8', grip: '#0c3a52', reel: '#ffffff', tip: '#c8f56a', glow: '#bff6ff' }),
  R('trident', 7, 'legendary', 'Sea King Trident', 'Three prongs, zero mercy. Hauls up giants.',
    S(1.35, 1.4, 1.35, 0.55, 140, 1.6, 3, 4), { kind: 'trident', shaft: '#f6d27a', grip: '#1fb3a6', reel: '#fff2b8', tip: '#ffffff', glow: '#fff2b8' }),
  R('prism', 7, 'legendary', 'Prism Rod', 'Splits sunlight into luck. Science says so.',
    S(1.6, 2.1, 1.4, 0.4, 90, 1.5, 3, 3.5), { kind: 'crystal', shaft: '#ffffff', grip: '#ff9ad0', reel: '#8ee8ff', tip: '#fff6a0', glow: '#ffffff' }),
  R('leviathan', 8, 'legendary', 'Leviathan Line', 'Forged from a sea serpent\'s whisker. Probably.',
    S(1.5, 1.6, 1.6, 0.7, 260, 2, 4, 3), { kind: 'coil', shaft: '#1fb3a6', grip: '#0c3a52', reel: '#8be04a', tip: '#c8f56a', glow: '#8affc8' }),
  R('aerolite', 9, 'legendary', 'Aerolite', 'A falling star caught on a fishing line. The best rod in any ocean.',
    S(1.9, 2.4, 1.8, 0.75, 400, 2.6, 5, 2.5), { kind: 'crystal', shaft: '#bff6ff', grip: '#1e8fe0', reel: '#ffffff', tip: '#fff6a0', glow: '#ffffff' }),
];
export const ROD_BY_ID = Object.fromEntries(RODS.map((r) => [r.id, r]));

// Stat bars in the Lab's rod rack: key, label, icon, max (bar = value / max).
export const ROD_STAT_KEYS = [
  { key: 'lureSpeed', label: 'Lure', icon: 'clock', max: 2 },
  { key: 'luck', label: 'Luck', icon: 'star', max: 2.5 },
  { key: 'control', label: 'Control', icon: 'mouse_l', max: 2 },
  { key: 'resilience', label: 'Resilience', icon: 'heart', max: 0.8 },
  { key: 'strength', label: 'Strength', icon: 'trophy', max: 400, log: true },
  { key: 'shock', label: 'Shock', icon: 'storm', max: 2.6 },
];

export function ensureRods(state) {
  const r = (state.rods ||= { owned: ['twig'], equipped: 'twig', skins: {} });
  r.owned ||= ['twig'];
  if (!r.owned.includes('twig')) r.owned.unshift('twig');
  r.skins ||= {};
  if (!ROD_BY_ID[r.equipped] || !r.owned.includes(r.equipped)) r.equipped = 'twig';
  return r;
}
export function ownsRod(state, id) { return ensureRods(state).owned.includes(id); }
export function giveRod(state, id) {
  const r = ensureRods(state);
  if (ROD_BY_ID[id] && !r.owned.includes(id)) r.owned.push(id);
}
export function equipRod(state, id) {
  const r = ensureRods(state);
  if (!r.owned.includes(id) || !ROD_BY_ID[id]) return false;
  r.equipped = id;
  return true;
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
