// Pinch's bait shop catalogue. Decorations come from PROPS metadata (decor field).

export const BAITS = {
  bread: { name: 'Breadcrumbs', price: 6, qty: 5, desc: 'Cheap and cheerful. Common fish love it.', effect: null },
  worm: { name: 'Glowing Worm', price: 24, qty: 3, desc: 'Wiggles over your icons. Most fish find it irresistible.', effect: 'worm' },
  sugar: { name: 'Sugar Cube', price: 35, qty: 2, desc: 'Sweet-toothed fish (and puddings) adore it.', effect: null },
  golden: { name: 'Golden Bait', price: 140, qty: 1, desc: 'Everything glitters. Rare fish come running.', effect: 'golden' },
  flood: { name: 'Flood Bait', price: 90, qty: 1, desc: 'Raises the water over your whole desktop for a while.', effect: 'flood' },
  blackhole: { name: 'Black Hole Bait', price: 320, qty: 1, desc: 'Pulls icons and deep fish toward your hook. Icons spring back after.', effect: 'blackhole' },
  chip: { name: 'Overclocked Chip', price: 70, qty: 2, desc: 'Sparks attract mechanical and digital fish.', effect: null },
  popup: { name: 'Pop-up Ad', price: 45, qty: 3, desc: '"YOU WON A FREE FISH!" Spam fish can\'t resist.', effect: null },
  lantern: { name: 'Lantern Pearl', price: 160, qty: 2, desc: 'A glowing pearl for the deep. Abyss fish follow the light.', effect: 'lantern' },
  relic: { name: 'Ancient Relic', price: 1250, qty: 1, desc: 'Something ancient answers. Use only in the Abyss.', effect: 'relic' },
};

export const BAIT_ORDER = ['bread', 'worm', 'sugar', 'golden', 'flood', 'blackhole', 'chip', 'popup', 'lantern', 'relic'];

// Coin values when releasing a fish (before size/mutation multipliers).
export const RELEASE_VALUE = { common: 4, uncommon: 9, rare: 22, epic: 60, legendary: 220 };
// Coins per minute produced in the aquarium (before multipliers).
export const COIN_RATE = { common: 2, uncommon: 3.5, rare: 6, epic: 10, legendary: 20 };
// Coins awarded immediately on a catch.
export const CATCH_BONUS = { common: 2, uncommon: 4, rare: 10, epic: 25, legendary: 100 };
