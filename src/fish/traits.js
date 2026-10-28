// Rolling individual fish: size, mutations, shiny, personality, nickname.

import { rng, uid } from '../core/rng.js';
import { clamp, lerp } from '../core/math.js';

export const MUTATIONS = {
  albino: { name: 'Albino', coin: 1.5, weight: 10 },
  melanistic: { name: 'Melanistic', coin: 1.5, weight: 10 },
  pastel: { name: 'Pastel', coin: 1.4, weight: 10 },
  neon: { name: 'Neon', coin: 1.8, weight: 6 },
  golden: { name: 'Golden', coin: 2.5, weight: 3 },
  crimson: { name: 'Crimson', coin: 1.5, weight: 7 },
  ocean: { name: 'Deep Blue', coin: 1.5, weight: 7 },
  ghost: { name: 'Ghostly', coin: 2, weight: 4 },
  inverted: { name: 'Inverted', coin: 2, weight: 3 },
  galaxy: { name: 'Galaxy', coin: 3, weight: 2 },
};

export const PATTERNS = {
  spots: { name: 'Spotted', coin: 1.2 },
  stripes: { name: 'Striped', coin: 1.2 },
  bands: { name: 'Banded', coin: 1.2 },
};

export const PERSONALITIES = [
  { id: 'bold', name: 'Bold', curiosity: 0.25, shyness: -0.3 },
  { id: 'shy', name: 'Shy', curiosity: -0.1, shyness: 0.35 },
  { id: 'greedy', name: 'Greedy', greed: 0.35 },
  { id: 'lazy', name: 'Lazy', energy: -0.35 },
  { id: 'hyper', name: 'Hyper', energy: 0.4 },
  { id: 'nosy', name: 'Nosy', curiosity: 0.4 },
  { id: 'grumpy', name: 'Grumpy', aggression: 0.35, curiosity: -0.15 },
  { id: 'dramatic', name: 'Dramatic', energy: 0.15, shyness: 0.15 },
  { id: 'romantic', name: 'Romantic', social: 0.4 },
  { id: 'sleepy', name: 'Sleepy', energy: -0.25 },
  { id: 'chill', name: 'Chill' },
  { id: 'clever', name: 'Clever', shyness: 0.1, curiosity: 0.1 },
];

const NAME_A = ['Bub', 'Fin', 'Gill', 'Sprat', 'Nemo', 'Puddle', 'Wib', 'Blorp', 'Squish', 'Pip', 'Mochi', 'Noodle', 'Kelp', 'Brine', 'Sushi', 'Dory', 'Splash', 'Pebble', 'Glub', 'Zappy', 'Bloop', 'Taco', 'Waffles', 'Biscuit', 'Gus', 'Marlo', 'Coral', 'Wiggles', 'Toast', 'Bean'];
const NAME_B = ['', '', '', ' Jr.', ' III', 'y', 'ster', 'o', ' the Great', 'ina', 'kins', 'bert'];

export function randomName() {
  return rng.pick(NAME_A) + rng.pick(NAME_B);
}

// mods: { mutationChance, shinyChance, sizeBonus, rarityBias }
export function rollIndividual(species, mods = {}) {
  const variant = {};
  const mutChance = (mods.mutationChance ?? 0.05) * (species.rarity === 'legendary' ? 0.5 : 1);
  if (rng.chance(mutChance)) {
    variant.mutation = rng.weighted(Object.entries(MUTATIONS), ([, m]) => m.weight)[0];
  }
  if (rng.chance((mods.patternChance ?? 0.04))) {
    variant.pattern = rng.pick(Object.keys(PATTERNS));
    variant.seed = rng.int(1, 999);
  }
  if (rng.chance(mods.shinyChance ?? 1 / 220)) {
    variant.shiny = true;
    variant.shinyHue = species.shinyHue ?? 150;
  }
  const [s0, s1] = species.size || [10, 20];
  // skewed size roll: most fish average, a few trophies
  let t = clamp(rng.gauss(0.45, 0.2) + (mods.sizeBonus || 0), 0, 1);
  if (rng.chance(0.04)) t = Math.min(1, t + 0.35);
  const giant = rng.chance(mods.giantChance ?? 0.015);
  const tiny = !giant && rng.chance(0.015);
  let sizeCm = lerp(s0, s1, t) * (giant ? 1.6 : tiny ? 0.6 : 1);
  const [w0, w1] = species.weight || [0.1, 1];
  const weightKg = lerp(w0, w1, t * t) * (giant ? 4 : tiny ? 0.2 : 1);
  const personality = rng.pick(PERSONALITIES).id;
  return {
    uid: uid(),
    species: species.id,
    sizeCm: Math.round(sizeCm * 10) / 10,
    weightKg: Math.round(weightKg * 100) / 100,
    sizeT: t,
    giant, tiny,
    variant: Object.keys(variant).length ? variant : null,
    personality,
    name: randomName(),
  };
}

// Visual scale multiplier for an individual (relative to species base sprite).
export function sizeScaleOf(rec, species) {
  const base = species.scale ?? 1;
  let s = 0.88 + (rec.sizeT ?? 0.5) * 0.28;
  if (rec.giant) s *= 1.45;
  if (rec.tiny) s *= 0.65;
  return base * s;
}

export function traitList(rec) {
  const out = [];
  if (rec.variant?.shiny) out.push({ text: 'Shiny', color: '#fff27a' });
  if (rec.variant?.mutation) out.push({ text: MUTATIONS[rec.variant.mutation]?.name || rec.variant.mutation, color: '#ff9ef0' });
  if (rec.variant?.pattern) out.push({ text: PATTERNS[rec.variant.pattern]?.name || rec.variant.pattern, color: '#9ef0ff' });
  if (rec.giant) out.push({ text: 'Giant', color: '#ffb36b' });
  if (rec.tiny) out.push({ text: 'Tiny', color: '#b6ff9e' });
  const p = PERSONALITIES.find((q) => q.id === rec.personality);
  if (p) out.push({ text: p.name, color: '#d8e6f0' });
  return out;
}

export function personalityOf(rec) {
  return PERSONALITIES.find((q) => q.id === rec.personality) || PERSONALITIES[10];
}

export function valueMultiplier(rec) {
  let m = 1;
  if (rec.variant?.mutation) m *= MUTATIONS[rec.variant.mutation]?.coin || 1.3;
  if (rec.variant?.pattern) m *= 1.2;
  if (rec.variant?.shiny) m *= 4;
  if (rec.giant) m *= 1.6;
  m *= 0.85 + (rec.sizeT ?? 0.5) * 0.4;
  return m;
}
