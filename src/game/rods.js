// Fishing rods (phase 3, Fisch-style ladder; phase 8 Workshop rods, tackle and rod levels). OWNER: Progression agent
// (data); the fishing agent reads rodStats(). Lab rods are researched in the Lab; Workshop rods (src: 'workshop') are
// crafted at Marina's Workshop (src/build/workshop.js) and each has a unique PERK.
// State: state.rods = {owned:[ids], equipped:id, skins:{rodId: skinId}, lv:{rodId: 0..MAX_ROD_LEVEL},
//                      tackle:{owned:{partId: 1}, on:{reel, line, lure, charm}}}
//   RODS: [{id, name, desc, tier, rarity, src: 'lab'|'workshop', perk?, stats:{lureSpeed, luck, control, resilience,
//          strength, shock:{power, charges, cooldown}}, look:{...}}]
//     lureSpeed  1 = base; higher = fish bite sooner          luck  1 = base; multiplies rarity rolls
//     control    1 = base; sweet spot size / forgiveness      resilience 0..1; progress kept when the fish fights back
//     strength   max fish weight (kg) before the line is at risk
//     shock      the rod's stun zap: power (stun seconds), charges per fight, cooldown (s)
//     look       {shaft, grip, reel, tip, glow?, kind}: kind 'stick' | 'wand' | 'carbon' | 'crystal' | 'trident' | 'coil'
//   PERKS {id: {name, desc, icon}}: magnet (boxes drift to your hook), clover, glow (deep luck + lantern), frost (fish
//     tire fast), turbo (reel + lure), bouncy (keeps progress), bloom (shiny), retro (mutations), wish (a bit of all).
//   TACKLE [{id, slot, name, rarity, desc, mods:{lure, luck, control, strength (mults), resil, charges (adds)}, game:{statKey: v}}]
//   TACKLE_SLOTS ['reel', 'line', 'lure', 'charm']; ownsTackle, giveTackle, equipTackle(state, id | null, slot), equippedTackle(state)
//   rodLevel(state, id), setRodLevel(state, id, lv), MAX_ROD_LEVEL, levelMul(lv)
//   ensureRods(state), equippedRod(state) -> rod, rodStats(state, stats) -> equipped rod stats with level, tackle, Lab bonuses
//   rodStatsOf(state, id, stats, {lv, tackle: false}) -> same for any rod (previews)
//   perkStats(state, s)  mutates game.stats with the equipped rod's perk + tackle game effects (game.recomputeStats)
//   setRodContext({deep}) context for situational perks (the glow rod's deep-zone luck), set by progression.js
//   ownsRod(state, id), giveRod(state, id), equipRod(state, id) -> bool
//   ROD_STAT_KEYS: display order + max values for stat bars.
import { registerRods } from '../build/pixart.js';

const R = (id, tier, rarity, name, desc, stats, look, extra = {}) => ({ id, tier, rarity, name, desc, stats, look, src: 'lab', ...extra });
const S = (lureSpeed, luck, control, resilience, strength, power, charges, cooldown) => ({ lureSpeed, luck, control, resilience, strength, shock: { power, charges, cooldown } });
const W = { src: 'workshop' };

export const RODS = [
  R('twig', 0, 'common', 'Twig & String', 'Everyone starts somewhere. Somewhere soggy.',
    S(1, 1, 1, 0.1, 6, 0.8, 1, 6), { kind: 'stick', shaft: '#b88a52', grip: '#7a5432', reel: '#c8c8c8', tip: '#e8e0c8' }),
  R('bubble', 1, 'common', 'Bubble Wand', 'Blows a bubble every cast. Fish find it adorable.',
    S(1.15, 1.05, 1.05, 0.12, 9, 0.9, 1, 6), { kind: 'wand', shaft: '#8ee8ff', grip: '#2fb8e8', reel: '#ffffff', tip: '#ff9ad0', glow: '#bff6ff' }),
  R('duck', 1, 'common', 'Rubber Duck Rod', 'Squeak! A bouncy line that keeps your progress when fish yank.',
    S(1.1, 1.05, 1.15, 0.24, 11, 0.9, 1, 6), { kind: 'wand', shaft: '#ffe25a', grip: '#ff9d2e', reel: '#ffffff', tip: '#ff7a3a' }, { ...W, perk: 'bouncy' }),
  R('bamboo', 2, 'uncommon', 'Lucky Bamboo', 'Grown in a sunny pot. Each knot is a wish.',
    S(1.05, 1.3, 1, 0.12, 10, 0.8, 1, 6), { kind: 'stick', shaft: '#8be04a', grip: '#3fae2a', reel: '#f6d27a', tip: '#ffffff' }),
  R('glass', 2, 'uncommon', 'Glass Rod', 'Clear, glossy and surprisingly bendy.',
    S(1.2, 1.1, 1.15, 0.2, 15, 1, 2, 5), { kind: 'crystal', shaft: '#d8f6ff', grip: '#59c3ff', reel: '#bfeaff', tip: '#ffffff', glow: '#e8fbff' }),
  R('clover', 2, 'uncommon', 'Lucky Clover', 'Four leaves, zero bad days. Luckier fish AND luckier crates.',
    S(1.1, 1.6, 1.05, 0.15, 14, 0.9, 1, 6), { kind: 'stick', shaft: '#5ccf3a', grip: '#2e8a2a', reel: '#e8ffc0', tip: '#ffffff' }, { ...W, perk: 'clover' }),
  R('kelp', 3, 'uncommon', 'Kelp Whip', 'Floppy and forgiving. Fish never see it coming.',
    S(1.1, 1.05, 1.45, 0.3, 14, 0.9, 1, 5), { kind: 'stick', shaft: '#3fae6a', grip: '#1f7a4a', reel: '#c8f56a', tip: '#c8f56a' }),
  R('chrome', 3, 'rare', 'Chrome Caster', 'So shiny you can check your hair in it.',
    S(1.3, 1.12, 1.25, 0.25, 26, 1.1, 2, 5), { kind: 'carbon', shaft: '#e8eef4', grip: '#3c6f88', reel: '#a8c8dc', tip: '#ffffff' }),
  R('frost', 3, 'rare', 'Frost Rod', 'Chills the water. Fish slow down and tire out fast.',
    S(1.2, 1.12, 1.35, 0.3, 24, 1.1, 2, 5), { kind: 'crystal', shaft: '#bfeaff', grip: '#3a7ad0', reel: '#ffffff', tip: '#e8fbff', glow: '#c8f4ff' }, { ...W, perk: 'frost' }),
  R('magnet', 3, 'rare', 'Magnet Rod', 'Floating boxes and chests drift toward your hook. Clang!',
    S(1.25, 1.15, 1.2, 0.25, 22, 1.2, 2, 5), { kind: 'coil', shaft: '#c8d2e0', grip: '#ff4f5e', reel: '#3a8cff', tip: '#ff4f5e', glow: '#ffd0d0' }, { ...W, perk: 'magnet' }),
  R('coral', 4, 'rare', 'Coral Crown', 'Grows back stronger every time a fish yanks it.',
    S(1.15, 1.15, 1.2, 0.5, 30, 1, 2, 5), { kind: 'wand', shaft: '#ff8a7a', grip: '#c84a5a', reel: '#ffd0c0', tip: '#ffe8a8' }),
  R('dolphin', 4, 'rare', 'Dolphin Spinner', 'Clicks and whistles. The fish come to chat.',
    S(1.55, 1.2, 1.2, 0.28, 32, 1.1, 2, 4.5), { kind: 'carbon', shaft: '#59c3ff', grip: '#1e8fe0', reel: '#ffffff', tip: '#bfeaff' }),
  R('sakura', 4, 'rare', 'Sakura Rod', 'Petals drift with every cast. Shiny fish adore it.',
    S(1.3, 1.3, 1.3, 0.3, 30, 1, 2, 4.5), { kind: 'wand', shaft: '#ffd0e8', grip: '#c84a8a', reel: '#ffffff', tip: '#ff8ac8', glow: '#ffe0f0' }, { ...W, perk: 'bloom' }),
  R('pixel', 4, 'epic', '8-Bit Rod', 'Power-up! Mutated fish show up way more often.',
    S(1.35, 1.25, 1.35, 0.32, 34, 1.3, 3, 4.5), { kind: 'carbon', shaft: '#5a6aff', grip: '#14202c', reel: '#ff4f5e', tip: '#ffe25a' }, { ...W, perk: 'retro' }),
  R('volt', 5, 'epic', 'Voltaic Rod', 'A rod with a battery. Zaps fish into a polite daze.',
    S(1.3, 1.15, 1.25, 0.32, 38, 2.2, 4, 3), { kind: 'coil', shaft: '#ffe25a', grip: '#2a3a52', reel: '#bfeaff', tip: '#ffffff', glow: '#fff6a0' }),
  R('aurora', 5, 'epic', 'Aurora Rod', 'Shimmers green and violet. Rare fish swoon.',
    S(1.3, 1.75, 1.2, 0.3, 36, 1.2, 2, 4), { kind: 'crystal', shaft: '#8affc8', grip: '#7448b8', reel: '#d27bff', tip: '#ffffff', glow: '#b8ffe0' }),
  R('glow', 5, 'epic', 'Glow Rod', 'Lights up the deep. Big luck in the twilight zone and below.',
    S(1.3, 1.4, 1.3, 0.32, 45, 1.3, 3, 4), { kind: 'crystal', shaft: '#2a4a5a', grip: '#0c2a3a', reel: '#c8ff6a', tip: '#e8ff7a', glow: '#e8ff7a' }, { ...W, perk: 'glow' }),
  R('aero', 6, 'epic', 'Aero Carbon', 'Light as a bubble, strong as a dolphin.',
    S(1.5, 1.35, 1.45, 0.4, 60, 1.4, 3, 4), { kind: 'carbon', shaft: '#2fd3e8', grip: '#0c3a52', reel: '#ffffff', tip: '#c8f56a', glow: '#bff6ff' }),
  R('turbo', 6, 'epic', 'Turbo Reel Rod', 'Vroom! A lightning-fast lure and a reel that never stops.',
    S(1.85, 1.2, 1.4, 0.35, 70, 1.4, 3, 3.5), { kind: 'carbon', shaft: '#ff9d2e', grip: '#2a2a3a', reel: '#ffe25a', tip: '#ffffff', glow: '#fff27a' }, { ...W, perk: 'turbo' }),
  R('trident', 7, 'legendary', 'Sea King Trident', 'Three prongs, zero mercy. Hauls up giants.',
    S(1.35, 1.4, 1.35, 0.55, 140, 1.6, 3, 4), { kind: 'trident', shaft: '#f6d27a', grip: '#1fb3a6', reel: '#fff2b8', tip: '#ffffff', glow: '#fff2b8' }),
  R('prism', 7, 'legendary', 'Prism Rod', 'Splits sunlight into luck. Science says so.',
    S(1.6, 2.1, 1.4, 0.4, 90, 1.5, 3, 3.5), { kind: 'crystal', shaft: '#ffffff', grip: '#ff9ad0', reel: '#8ee8ff', tip: '#fff6a0', glow: '#ffffff' }),
  R('leviathan', 8, 'legendary', 'Leviathan Line', 'Forged from a sea serpent\'s whisker. Probably.',
    S(1.5, 1.6, 1.6, 0.7, 260, 2, 4, 3), { kind: 'coil', shaft: '#1fb3a6', grip: '#0c3a52', reel: '#8be04a', tip: '#c8f56a', glow: '#8affc8' }),
  R('starfish', 8, 'legendary', 'Starfish Scepter', 'A wishing star from the deep. A little of every perk.',
    S(1.7, 2.2, 1.7, 0.6, 220, 2.2, 4, 3), { kind: 'trident', shaft: '#ffb0c8', grip: '#7448b8', reel: '#ffd23a', tip: '#ffd23a', glow: '#fff2b8' }, { ...W, perk: 'wish' }),
  R('aerolite', 9, 'legendary', 'Aerolite', 'A falling star caught on a fishing line. The best rod in any ocean.',
    S(1.9, 2.4, 1.8, 0.75, 400, 2.6, 5, 2.5), { kind: 'crystal', shaft: '#bff6ff', grip: '#1e8fe0', reel: '#ffffff', tip: '#fff6a0', glow: '#ffffff' }),
];
export const ROD_BY_ID = Object.fromEntries(RODS.map((r) => [r.id, r]));
registerRods(RODS);

export const PERKS = {
  bouncy: { name: 'Bouncy Line', desc: 'Keep more progress when a fish yanks. Snaps less.', icon: 'heart' },
  clover: { name: 'Four-Leaf Luck', desc: 'Luckier fish, luckier crates, more shinies.', icon: 'clover' },
  frost: { name: 'Big Chill', desc: 'Fish tire out 30% faster and fight calmer.', icon: 'snow' },
  magnet: { name: 'Box Magnet', desc: 'Floating boxes and chests drift to your hook.', icon: 'magnet' },
  bloom: { name: 'Petal Shine', desc: 'Shiny fish 60% more often.', icon: 'sparkle' },
  retro: { name: 'Power-Up', desc: 'Mutated fish show up far more often.', icon: 'star' },
  glow: { name: 'Deep Glow', desc: 'Your hook glows. +50% luck in the Twilight Zone and deeper.', icon: 'lantern' },
  turbo: { name: 'Turbo', desc: 'Much faster reeling and bites.', icon: 'bolt' },
  wish: { name: 'Wishing Star', desc: 'A little bit of every perk, including the box magnet.', icon: 'star' },
};

// ---------------------------------------------------------------- tackle (crafted at the Workshop, one per slot)
export const TACKLE_SLOTS = ['reel', 'line', 'lure', 'charm'];
export const TACKLE_SLOT_NAMES = { reel: 'Reel', line: 'Line', lure: 'Lure', charm: 'Charm' };
const T = (id, slot, name, rarity, desc, mods, game = {}) => ({ id, slot, name, rarity, desc, mods, game });
export const TACKLE = [
  T('reel_spin', 'reel', 'Spin Reel', 'common', 'Smooth and steady.', { control: 1.06, lure: 1.04 }),
  T('reel_turbo', 'reel', 'Turbo Reel', 'rare', 'Brrrrr! Much faster reeling.', { lure: 1.12 }, { reelSpeed: 8 }),
  T('reel_gold', 'reel', 'Golden Reel', 'epic', 'Silky, shiny and a little lucky.', { control: 1.12, lure: 1.1, luck: 1.05 }, { reelSpeed: 6 }),
  T('line_braid', 'line', 'Braided Line', 'common', 'Holds heavier fish.', { strength: 1.2 }),
  T('line_glow', 'line', 'Glow Line', 'rare', 'Strong, and it glows in the dark.', { strength: 1.3, luck: 1.05 }, { lantern: 1 }),
  T('line_titan', 'line', 'Titan Line', 'epic', 'Rated for whales. And whale-sized memes.', { strength: 1.6, resil: 0.06 }),
  T('lure_spoon', 'lure', 'Shiny Spoon', 'common', 'Flash! Fish notice it sooner.', { lure: 1.08 }),
  T('lure_frog', 'lure', 'Froggy Popper', 'uncommon', 'Ribbit. Irresistible.', { lure: 1.12, luck: 1.04 }),
  T('lure_squid', 'lure', 'Glow Squid', 'rare', 'Rare fish love a glowing snack.', { luck: 1.12, lure: 1.06 }),
  T('charm_heart', 'charm', 'Heart Charm', 'common', 'Love keeps the line together.', { resil: 0.06 }),
  T('charm_clover', 'charm', 'Clover Charm', 'uncommon', 'A pocket of luck.', { luck: 1.12 }, { crateLuck: 0.05 }),
  T('charm_star', 'charm', 'Star Charm', 'rare', 'One extra shock per fight.', { luck: 1.08, charges: 1 }),
  T('charm_pearl', 'charm', 'Pearl Charm', 'epic', 'Calm, lucky, unbreakable.', { luck: 1.15, resil: 0.05, control: 1.05 }, { calm: 1.1 }),
];
export const TACKLE_BY_ID = Object.fromEntries(TACKLE.map((t) => [t.id, t]));

export const MAX_ROD_LEVEL = 5;
export const levelMul = (lv) => 1 + 0.06 * lv;

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
  if (!Array.isArray(r.owned)) r.owned = ['twig'];
  if (!r.owned.includes('twig')) r.owned.unshift('twig');
  r.skins ||= {};
  if (!r.lv || typeof r.lv !== 'object') r.lv = {};
  if (!r.tackle || typeof r.tackle !== 'object') r.tackle = {};
  r.tackle.owned ||= {};
  r.tackle.on ||= {};
  for (const s of TACKLE_SLOTS) { const id = r.tackle.on[s]; if (id && (!TACKLE_BY_ID[id] || !r.tackle.owned[id] || TACKLE_BY_ID[id].slot !== s)) delete r.tackle.on[s]; }
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
  if (state.character && typeof state.character === 'object') state.character.labRod = id; // [phase3:char] the 'auto' rod skin draws the Lab rod
  return true;
}
export function equippedRod(state) { return ROD_BY_ID[ensureRods(state).equipped] || RODS[0]; }

export function rodLevel(state, id) { return Math.max(0, Math.min(MAX_ROD_LEVEL, Math.floor(Number(ensureRods(state).lv[id]) || 0))); }
export function setRodLevel(state, id, lv) { ensureRods(state).lv[id] = Math.max(0, Math.min(MAX_ROD_LEVEL, lv | 0)); }

export function ownsTackle(state, id) { return !!ensureRods(state).tackle.owned[id]; }
export function giveTackle(state, id, equip = true) {
  const t = TACKLE_BY_ID[id];
  if (!t) return false;
  const r = ensureRods(state);
  r.tackle.owned[id] = 1;
  if (equip && !r.tackle.on[t.slot]) r.tackle.on[t.slot] = id;
  return true;
}
export function equipTackle(state, id, slot = null) {
  const r = ensureRods(state);
  if (id === null) { if (slot) delete r.tackle.on[slot]; return true; }
  const t = TACKLE_BY_ID[id];
  if (!t || !r.tackle.owned[id]) return false;
  r.tackle.on[t.slot] = id;
  return true;
}
export function equippedTackle(state) {
  const on = ensureRods(state).tackle.on;
  return TACKLE_SLOTS.map((s) => (on[s] ? TACKLE_BY_ID[on[s]] : null)).filter(Boolean);
}

// situational context (set every half second by src/build/progression.js)
const CTX = { deep: false };
export function setRodContext(o = {}) { Object.assign(CTX, o); }

// Stats of any rod with its level, the equipped tackle and Lab bonuses. opts: {lv, tackle (true), context (true)}
export function rodStatsOf(state, id, stats = null, opts = {}) {
  const rod = ROD_BY_ID[id] || RODS[0];
  const r = rod.stats, s = stats || {};
  const lv = opts.lv ?? rodLevel(state, rod.id);
  const L = levelMul(lv);
  const m = { lure: 1, luck: 1, control: 1, strength: 1, resil: 0, charges: 0 };
  if (opts.tackle !== false && state) for (const t of equippedTackle(state)) {
    for (const k of ['lure', 'luck', 'control', 'strength']) if (t.mods[k]) m[k] *= t.mods[k];
    m.resil += t.mods.resil || 0;
    m.charges += t.mods.charges || 0;
  }
  let luck = r.luck * L * m.luck * (s.rodLuck || 1);
  if (opts.context !== false && (rod.perk === 'glow' || rod.perk === 'wish') && CTX.deep) luck *= rod.perk === 'glow' ? 1.5 : 1.2;
  return {
    ...r,
    lureSpeed: r.lureSpeed * L * m.lure * (s.rodLure || 1), luck, control: r.control * L * m.control * (s.rodControl || 1),
    resilience: Math.min(0.9, r.resilience + lv * 0.015 + m.resil + (s.rodResilience || 0)), strength: r.strength * (1 + 0.1 * lv) * m.strength * (s.rodStrength || 1),
    shock: { ...r.shock, power: r.shock.power * (1 + 0.04 * lv) * (s.shockPower || 1), charges: r.shock.charges + m.charges + (s.shockCharges || 0), cooldown: r.shock.cooldown * (s.shockCooldown || 1) },
    perk: rod.perk || null, level: lv,
  };
}
export function rodStats(state, stats = null) { return rodStatsOf(state, equippedRod(state).id, stats); }

// The equipped rod's perk and the tackle's game-wide effects, folded into game.stats (game.recomputeStats).
const PERK_FX = {
  bouncy: { snapGrace: 0.2, slackGrace: 0.3 },
  clover: { crateLuck: 0.15, shinyChance: ['*', 1.2], rarityBoost: ['*', 1.03] },
  frost: { staminaDrain: ['*', 1.3], calm: ['*', 1.2] },
  magnet: { crateLuck: 0.05, collectRadius: 6 },
  bloom: { shinyChance: ['*', 1.6] },
  retro: { mutationChance: 0.04 },
  glow: { lantern: 1 },
  turbo: { reelSpeed: 16 },
  wish: { crateLuck: 0.15, shinyChance: ['*', 1.3], staminaDrain: ['*', 1.15], lantern: 1, reelSpeed: 6, mutationChance: 0.02 },
};
const MUL_GAME = new Set(['calm', 'staminaDrain', 'shinyChance', 'rarityBoost']);
export function perkStats(state, s) {
  if (!state || !s) return s;
  const fx = PERK_FX[equippedRod(state).perk] || {};
  for (const [k, v] of Object.entries(fx)) {
    if (Array.isArray(v)) s[k] = (s[k] ?? 1) * v[1];
    else s[k] = (s[k] || 0) + v;
  }
  for (const t of equippedTackle(state)) for (const [k, v] of Object.entries(t.game || {})) {
    if (MUL_GAME.has(k)) s[k] = (s[k] ?? 1) * v;
    else s[k] = (s[k] || 0) + v;
  }
  return s;
}
export function hasPerk(state, perk) { const p = equippedRod(state).perk; return p === perk || (p === 'wish' && (perk === 'magnet' || perk === 'glow')); }
