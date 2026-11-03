// Phase 3 arrivals for the (OS)cean (the flooded green-hill wallpaper). Same schema as species.js; authored at
// final size (no GROW pass), merged by species.js. Phase 4 renders them as realistic voxel animals
// (src/fish/anatomy.js): bubblepuff = a pufferfish whose skin turns into glossy soap-bubble film when it
// inflates, sneakerhead = a snakehead (no sneakers), hydrated = a green chromis that trails extra bubbles,
// porpoise = a harbour porpoise with horizontal flukes. The legacy look keys (vox.glass, sneakers, orb,
// paperclip) are ignored by the realistic renderer.

const S = [];
const add = (o) => S.push(o);
const fight = (phases, power, stamina, tricks, o = {}) => ({ phases, power, stamina, tricks, biteWindow: 0.8, nibbles: [1, 2], fakeBite: 0.1, ...o });
const spawn = (o = {}) => ({ weight: 1, weather: null, time: null, requires: null, hidden: null, ...o });

add({
  id: 'bubblepuff', name: 'Bubble Pufferfish', biome: 'oscean', rarity: 'uncommon',
  size: [10, 22], weight: [0.05, 0.2],
  look: {
    bubble: true, translucent: 0.4,
    body: { len: 36, h: 32, shape: 'round', tip: 0.32, wave: 0.3 },
    col: { body: '#8aeeff', belly: '#e8ffff', back: '#5ac8ff', fin: '#c0f8ff' },
    vox: { glass: 1, iri: 0.9, gloss: 1, finGlass: 0.45, finTint: 0.4 },
    tail: { type: 'fan', len: 10, spread: 9, color: '#c8f8ff' },
    dorsal: { type: 'round', from: 0.45, to: 0.72, h: 5, color: '#c8f8ff' }, anal: null,
    pectoral: { len: 7, color: '#e0fcff' },
    eye: { r: 5.2, u: 0.2, v: -0.22 },
    mouth: { type: 'small', v: 0.32 },
  },
  scale: 1,
  move: { style: 'drift', speed: 9, burst: 40, agility: 2, depth: [0.1, 0.7], school: 0 },
  activity: 'any',
  traits: { curiosity: 0.8, shyness: 0.4, greed: 0.5, aggression: 0 },
  bait: { image: 3, browser: 2, sugar: 2, bread: 2 },
  quirks: ['inflate', 'sparkle'],
  fight: fight(['tension', 'net'], 0.16, 2.6, ['jump']),
  spawn: spawn({ weight: 1.2 }),
  sound: 'bubble',
  desc: 'A pufferfish with skin like a soap bubble. Startle it and it swells up, shimmering every colour of the rainbow. Please do not poke.',
  behavior: 'Drifts in the light. Inflates into a huge shiny bubble when startled.',
  shinyHue: 300,
});

add({
  id: 'sneakerhead', name: 'Sneakerhead', biome: 'oscean', rarity: 'uncommon',
  size: [20, 34], weight: [0.4, 1.2],
  look: {
    body: { len: 48, h: 18, shape: 'torpedo', hump: 0.1, nose: 1.7, tip: 0.24, wave: 0.15 },
    col: { body: '#8ad8ff', belly: '#f4fcff', back: '#2a7aff', fin: '#bff0ff' },
    vox: { iri: 0.25 },
    pattern: [{ type: 'stripes', color: '#ffffff', at: [0.02], width: 0.08, from: 0.15, to: 0.9 }],
    tail: { type: 'fork', len: 13, spread: 11, color: '#7ae0ff' },
    dorsal: { type: 'tri', from: 0.42, to: 0.6, h: 7 }, anal: { type: 'tri', from: 0.66, to: 0.8, h: 4 },
    pectoral: { len: 6 },
    eye: { r: 3.6, u: 0.12, v: -0.2 },
    mouth: { type: 'small', v: 0.34 },
    sneakers: { u: 0.5, h: 14, len: 26, accent: '#22c8ff' },
  },
  scale: 1,
  move: { style: 'crawl', speed: 11, burst: 40, agility: 4, depth: [0.85, 1], school: 0 },
  activity: 'day',
  traits: { curiosity: 0.8, shyness: 0.2, greed: 0.6, aggression: 0.1 },
  bait: { image: 3, video: 2, music: 2, bread: 1 },
  quirks: ['hopper'],
  fight: fight(['timing', 'tension'], 0.26, 3.6, ['hop', 'dash']),
  spawn: spawn({ weight: 1 }),
  sound: 'squeak',
  desc: 'A rainbow snakehead that can walk on land and owns forty pairs of box-fresh high-tops. Has never once been seen wearing them.',
  behavior: 'Wriggles along the seabed and does little hops. Loves image bait.',
  shinyHue: 30,
});

add({
  id: 'hydrated', name: 'Stay-Hydrated Fish', biome: 'oscean', rarity: 'rare',
  size: [8, 16], weight: [0.08, 0.3],
  look: {
    body: { len: 30, h: 20, shape: 'oval', hump: 0.12, tip: 0.26 },
    col: { body: '#5aff6a', belly: '#f0ffe0', back: '#1ac85a', fin: '#5ad8ff' },
    pattern: [{ type: 'bands', color: '#ffffff', at: [0.36, 0.62], width: 0.07, wavy: 0.04 }],
    tail: { type: 'fan', len: 11, spread: 10, color: '#5ad8ff' },
    dorsal: { type: 'sail', from: 0.36, to: 0.7, h: 7, color: '#5ad8ff' }, anal: { type: 'round', from: 0.6, to: 0.8, h: 4, color: '#5ad8ff' },
    pectoral: { len: 5, color: '#9ae8ff' },
    eye: { r: 4, u: 0.16, v: -0.18 },
    mouth: { type: 'small', v: 0.34 },
    orb: { r: 27, color: '#c8f6ff' },
  },
  scale: 1,
  move: { style: 'swim', speed: 12, burst: 50, agility: 3, depth: [0.15, 0.7], school: 0 },
  activity: 'day',
  traits: { curiosity: 0.6, shyness: 0.4, greed: 0.5, aggression: 0 },
  bait: { browser: 2, chat: 3, image: 2, sugar: 1 },
  quirks: ['sparkle'],
  fight: fight(['tension', 'timing', 'net'], 0.3, 4.5, ['dash', 'fake'], { biteWindow: 0.6 }),
  spawn: spawn({ weight: 1 }),
  sound: 'bubble',
  desc: 'Takes "stay hydrated" extremely seriously and trails bubbles everywhere it goes. It lives in the sea.',
  behavior: 'Drifts about in a constant stream of its own bubbles.',
  shinyHue: 180,
});

add({
  id: 'porpoise', name: 'Paperclip Porpoise', biome: 'oscean', rarity: 'legendary',
  size: [140, 240], weight: [60, 150],
  look: {
    body: { len: 84, h: 28, shape: 'pointy', hump: 0.22, nose: 1.1, tip: 0.08, tailW: 0.2, peak: 0.42, wave: 0.6 },
    col: { body: '#1ae0d0', belly: '#f4fffd', back: '#00a8c8', fin: '#10c8c0' },
    shade: { back: -0.2, belly: 0.3 },
    vox: { gloss: 1, iri: 0.3 },
    tail: { type: 'moon', len: 16, spread: 15, color: '#00b8c0' },
    dorsal: { type: 'tri', from: 0.42, to: 0.6, h: 12, lean: 1 }, anal: null,
    pectoral: { len: 11, color: '#00b8c0' },
    eye: { r: 4.6, u: 0.15, v: -0.22, type: 'googly' },
    mouth: { type: 'small', v: 0.5, smile: 0.5 },
    extras: [{ type: 'paperclip', u: 0.28, w: 10, color: '#e8f4ff' }],
  },
  scale: 1,
  move: { style: 'swim', speed: 20, burst: 110, agility: 4, depth: [0.1, 0.6], school: 0 },
  activity: 'day',
  traits: { curiosity: 1, shyness: 0, greed: 0.6, aggression: 0.1 },
  bait: { docs: 3, mail: 3, calendar: 2, golden: 3 },
  quirks: ['sparkle', 'glow'],
  fight: { phases: ['tension', 'timing', 'dodge', 'mash', 'net'], power: 0.85, stamina: 14, tricks: ['dash', 'jump', 'fake'], biteWindow: 0.4, nibbles: [1, 2], fakeBite: 0.25 },
  spawn: spawn({ weight: 1 }),
  sound: 'chirp',
  desc: 'It looks like you are trying to fish! Would you like help? A glossy harbour porpoise that pops up whenever you least expect it.',
  behavior: 'Leaps through the flooded hills offering unsolicited help. Legendary.',
  shinyHue: 50,
});

export const OSCEAN_SPECIES = S;
