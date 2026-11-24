// [deep26] Deep-sea arrivals: scarier fish for the twilight, midnight and abyss zones of the oceans, modelled on real
// deep-sea animals (anatomy in src/fish/anatomy.js / realvox.js SOLIDS) with the game's pun names. Same schema as
// species.js; they ship at final size (no GROW pass). Every one declares its depth `zone` (depthzones.speciesZones)
// and a `valueMul` depth bonus (traits.valueMultiplier, on top of the ocean's OCEAN_VALUE).
// `oceans` lists other oceans whose deep water a cosmopolitan species also roams (spawning only; its FishDex page
// stays with its home `biome`).
// New quirks: 'lunge' (snaps at the hook from a distance, jaws open), 'lure' fish flash their lights now and then.
// Deep fish can be kept in the tank like any other catch; `glow: true` (set below for every glowing one) makes the
// tank draw their lures, photophores and eyeshine at full strength.

const S = [];
const add = (o) => S.push(o);
const fight = (phases, power, stamina, tricks, o = {}) => ({ phases, power, stamina, tricks, biteWindow: 0.6, nibbles: [1, 2], fakeBite: 0.15, ...o });
const spawn = (o = {}) => ({ weight: 1, weather: null, time: null, requires: null, hidden: null, ...o });
const DEEP = { twilight: 1.15, midnight: 1.3, abyss: 1.5 };

// ===========================================================================
// THE DEEP OCEAN (abyss)

add({
  id: 'cockeye', name: 'Dual Monitor Squid', biome: 'abyss', oceans: ['oscean', 'shallows', 'fjord'], rarity: 'common', zone: ['twilight', 'midnight'], valueMul: DEEP.twilight,
  size: [8, 20], weight: [0.2, 0.8],
  look: { kind: 'squid', glow: true, body: { len: 50, h: 26 }, col: { body: '#de3a50', back: '#c8203a', belly: '#f07888', fin: '#b81830' } },
  scale: 1,
  move: { style: 'drift', speed: 7, burst: 45, agility: 2, depth: [0.15, 0.7], school: 0 },
  activity: 'any',
  traits: { curiosity: 0.6, shyness: 0.3, greed: 0.5, aggression: 0.1 },
  bait: { lantern: 3, worm: 2, video: 2, image: 1 },
  quirks: ['glow', 'ink'],
  fight: fight(['tension', 'net'], 0.2, 3, ['ink']),
  spawn: spawn({ weight: 1.2 }),
  sound: 'squeak',
  desc: 'A cock-eyed (strawberry) squid. One huge yellow eye watches for silhouettes above, one small blue eye watches for glows below. Always has two tabs open.',
  behavior: 'Drifts tilted, studded with glowing photophores. Inks when hooked. Found in the deep of several oceans.',
  shinyHue: 300,
});

add({
  id: 'viperfish', name: 'Needle Drop Viperfish', biome: 'abyss', oceans: ['oscean', 'shallows', 'metropolis'], rarity: 'uncommon', zone: ['twilight', 'midnight'], valueMul: DEEP.midnight,
  size: [20, 35], weight: [0.1, 0.4],
  look: { glow: true, body: { len: 64, h: 10, shape: 'long' }, col: { body: '#2a3a66', back: '#141c3a', belly: '#3a4a7a', fin: '#1a2448' } },
  scale: 1,
  move: { style: 'swim', speed: 10, burst: 95, agility: 4, depth: [0.2, 0.9], school: 0 },
  activity: 'any',
  traits: { curiosity: 0.4, shyness: 0.3, greed: 0.8, aggression: 0.8 },
  bait: { lantern: 3, worm: 2, music: 2, blackhole: 1 },
  quirks: ['glow', 'lure', 'lunge'],
  fight: fight(['tension', 'dodge', 'net'], 0.45, 5, ['dash', 'fake']),
  spawn: spawn(),
  sound: 'click',
  desc: 'Sloane\'s viperfish. Its needle fangs are so long they do not fit in its mouth, so it just leaves them out. Drops the needle, then drops on you.',
  behavior: 'Hangs still under its glowing dorsal lure, then lunges. Roams the deep of several oceans.',
  shinyHue: 190,
});

add({
  id: 'loosejaw', name: 'Red Flag Loosejaw', biome: 'abyss', rarity: 'rare', zone: ['midnight'], valueMul: DEEP.midnight,
  size: [15, 25], weight: [0.05, 0.2],
  look: { glow: true, body: { len: 60, h: 12, shape: 'long' }, col: { body: '#1e1628', back: '#120c1a', belly: '#2a1e34', fin: '#1a1224' } },
  scale: 1,
  move: { style: 'swim', speed: 9, burst: 90, agility: 4, depth: [0.2, 0.9], school: 0 },
  activity: 'any',
  traits: { curiosity: 0.3, shyness: 0.4, greed: 0.8, aggression: 0.8 },
  bait: { lantern: 3, video: 2, worm: 2, blackhole: 1 },
  quirks: ['glow', 'lure', 'lunge'],
  fight: fight(['tension', 'trace', 'dodge', 'net'], 0.55, 6, ['dash', 'fake', 'dive']),
  spawn: spawn(),
  sound: 'click',
  desc: 'Stoplight loosejaw. Its jaw has no floor and hangs wide open, and it shines a red searchlight that nothing else down here can see. Huge red flag. Swims toward it anyway.',
  behavior: 'Sweeps the dark with its red light and snaps its open jaw shut.',
  shinyHue: 0,
});

add({
  id: 'seadevil', name: 'Sleep Paralysis Seadevil', biome: 'abyss', oceans: ['oscean', 'fjord', 'junkyard'], rarity: 'rare', zone: ['midnight', 'abyss'], valueMul: DEEP.abyss,
  size: [5, 18], weight: [0.05, 0.6],
  look: { glow: true, body: { len: 46, h: 34, shape: 'blunt' }, col: { body: '#18141e', back: '#0e0c14', belly: '#221c28', fin: '#16121c' } },
  scale: 1,
  move: { style: 'hover', speed: 4, burst: 70, agility: 2, depth: [0.3, 0.9], school: 0 },
  activity: 'any',
  traits: { curiosity: 0.3, shyness: 0.1, greed: 1, aggression: 0.7 },
  bait: { lantern: 3, worm: 2, blackhole: 2, image: 1 },
  quirks: ['glow', 'lure', 'lunge'],
  fight: fight(['tension', 'mash', 'net'], 0.5, 6, ['fake', 'dive'], { fakeBite: 0.3 }),
  spawn: spawn(),
  sound: 'grunt',
  desc: 'A black seadevil anglerfish. Shows up in the dark at 3 a.m., just a glowing dot and a grin full of glass needles, and you cannot move. It can swallow fish twice its size.',
  behavior: 'Hangs motionless, twitching its lure, and gulps whatever comes close. Lurks under several oceans.',
  shinyHue: 260,
});

add({
  id: 'frilledshark', name: 'Lore Accurate Frilled Shark', biome: 'abyss', rarity: 'epic', zone: ['midnight', 'abyss'], valueMul: DEEP.abyss,
  size: [110, 200], weight: [8, 25],
  look: { body: { len: 120, h: 14, shape: 'long' }, col: { body: '#544038', back: '#3c2c2a', belly: '#72584a', fin: '#3c2c2a' } },
  scale: 1,
  move: { style: 'swim', speed: 9, burst: 80, agility: 2, depth: [0.3, 0.95], school: 0 },
  activity: 'night',
  traits: { curiosity: 0.3, shyness: 0.5, greed: 0.7, aggression: 0.8 },
  bait: { worm: 3, lantern: 2, blackhole: 2, relic: 2 },
  quirks: ['lunge'],
  fight: fight(['tension', 'trace', 'dodge', 'mash', 'net'], 0.75, 9, ['dash', 'dive', 'wrap']),
  spawn: spawn(),
  sound: 'roar',
  desc: 'A frilled shark: 80 million years of lore, six frilly gill slits and 300 trident teeth. Bends like a snake and strikes like one. The lore was always accurate.',
  behavior: 'Coils, then lunges like a snake. Prefers the night.',
  shinyHue: 30,
});

add({
  id: 'snailfish', name: 'Ghost Mode Snailfish', biome: 'abyss', rarity: 'epic', zone: ['abyss'], valueMul: DEEP.abyss * 1.2,
  size: [15, 30], weight: [0.1, 0.3],
  look: { translucent: 0.7, body: { len: 58, h: 16 }, col: { body: '#f8ccd8', back: '#f4b8c8', belly: '#fde4ea', fin: '#f6d0dc' } },
  scale: 1,
  move: { style: 'swim', speed: 6, burst: 35, agility: 2, depth: [0.6, 1], school: 0 },
  activity: 'any',
  traits: { curiosity: 0.8, shyness: 0.2, greed: 0.5, aggression: 0 },
  bait: { worm: 3, sugar: 2, lantern: 1, chat: 1 },
  quirks: [],
  fight: fight(['tension', 'trace', 'net'], 0.3, 7, ['fake']),
  spawn: spawn({ weight: 0.8 }),
  sound: 'squeak',
  desc: 'The Mariana snailfish, the deepest fish ever filmed (8,336 m). Soft, see-through and unbothered by a pressure that would flatten a car. Left on read by the whole ocean.',
  behavior: 'Glides over the trench floor like a pink ghost, surprisingly curious.',
  shinyHue: 180,
});

add({
  id: 'tripodfish', name: 'Standing Desk Tripodfish', biome: 'abyss', rarity: 'uncommon', zone: ['abyss'], valueMul: DEEP.abyss,
  size: [20, 37], weight: [0.1, 0.4],
  look: { body: { len: 56, h: 10 }, stilts: 24, col: { body: '#7a7a84', back: '#4a4a52', belly: '#b0b0b8', fin: '#5a5a64' } },
  scale: 1,
  move: { style: 'crawl', speed: 3, burst: 40, agility: 2, depth: [0.9, 1], school: 0 },
  activity: 'any',
  traits: { curiosity: 0.4, shyness: 0.5, greed: 0.6, aggression: 0 },
  bait: { worm: 3, docs: 2, calendar: 2, bread: 1 },
  quirks: ['crawler'],
  fight: fight(['tension', 'net'], 0.25, 4, ['dive']),
  spawn: spawn(),
  sound: 'click',
  desc: 'A tripod fish. Stands on three metre-tall fin rays on the abyssal plain, facing the current, feelers up, waiting for lunch to drift by. Has not sat down since 2019.',
  behavior: 'Stands on its stilts on the abyss floor and waits.',
  shinyHue: 50,
});

add({
  id: 'bigfin', name: 'Backrooms Bigfin Squid', biome: 'abyss', rarity: 'legendary', zone: ['abyss'], valueMul: DEEP.abyss * 1.3,
  size: [400, 800], weight: [4, 15],
  look: { kind: 'squid', body: { len: 50, h: 50 }, col: { body: '#f2bca8', back: '#e8a48e', belly: '#f8dcd0', fin: '#f0b8a8' } },
  scale: 1,
  move: { style: 'drift', speed: 3, burst: 25, agility: 1, depth: [0.15, 0.6], school: 0 },
  activity: 'any',
  traits: { curiosity: 0.6, shyness: 0.5, greed: 0.4, aggression: 0.2 },
  bait: { relic: 3, blackhole: 3, lantern: 2, golden: 2 },
  quirks: ['glow'],
  fight: fight(['tension', 'unwrap', 'trace', 'dodge', 'net'], 0.7, 12, ['wrap', 'ink', 'fake'], { biteWindow: 0.45, nibbles: [2, 4], fakeBite: 0.35 }),
  spawn: spawn({ weight: 0.7 }),
  sound: 'bell',
  desc: 'A bigfin squid, seen alive only a handful of times. Ten arms bent at impossible elbows hang down for metres below it. You noclipped into the wrong level of the ocean.',
  behavior: 'Hovers motionless with its arms dangling far below. Trophy of the abyss.',
  shinyHue: 220,
});

// ===========================================================================
// LAVA RIFT (volcano): the vents' dark water

add({
  id: 'swallower', name: 'Big Back Swallower', biome: 'volcano', rarity: 'uncommon', zone: ['twilight', 'midnight'], valueMul: DEEP.midnight,
  size: [10, 25], weight: [0.05, 0.4],
  look: { glow: true, body: { len: 54, h: 20 }, col: { body: '#2c2632', back: '#1e1a24', belly: '#d8c8d8', fin: '#26202c' } },
  scale: 1,
  move: { style: 'swim', speed: 7, burst: 55, agility: 2, depth: [0.2, 0.9], school: 0 },
  activity: 'any',
  traits: { curiosity: 0.5, shyness: 0.2, greed: 1, aggression: 0.5 },
  bait: { worm: 3, sugar: 2, bread: 2, blackhole: 2 },
  quirks: ['glow', 'lunge'],
  fight: fight(['mash', 'tension', 'net'], 0.4, 5, ['dive']),
  spawn: spawn(),
  sound: 'gulp',
  desc: 'A black swallower. Eats fish twice its own length and stretches its see-through belly around them. Big back energy. Sometimes the meal is too big and they both float up.',
  behavior: 'Cruises with a swollen belly, always ready for one more.',
  shinyHue: 280,
});

add({
  id: 'whipnose', name: 'Selfie Stick Whipnose', biome: 'volcano', rarity: 'rare', zone: ['midnight', 'abyss'], valueMul: DEEP.abyss,
  size: [15, 40], weight: [0.1, 0.8],
  look: { glow: true, body: { len: 52, h: 14 }, col: { body: '#1c1626', back: '#14101c', belly: '#262030', fin: '#1a1424' } },
  scale: 1,
  move: { style: 'hover', speed: 5, burst: 60, agility: 2, depth: [0.2, 0.9], school: 0 },
  activity: 'any',
  traits: { curiosity: 0.5, shyness: 0.3, greed: 0.9, aggression: 0.6 },
  bait: { lantern: 3, image: 3, video: 2, worm: 1 },
  quirks: ['glow', 'lure', 'lunge'],
  fight: fight(['tension', 'trace', 'dodge', 'net'], 0.5, 6, ['fake', 'dash']),
  spawn: spawn(),
  sound: 'click',
  desc: 'A whipnose angler. Its lure rod is longer than its whole body and it holds it way out in front, glowing, at the perfect angle. Never once looked at the camera.',
  behavior: 'Swims upside down in the wild, trailing its huge rod. Lunges at the light.',
  shinyHue: 170,
});

add({
  id: 'yeticrab', name: 'No-Shave Yeti Crab', biome: 'volcano', rarity: 'uncommon', zone: ['abyss'], valueMul: DEEP.abyss,
  size: [12, 15], weight: [0.1, 0.3],
  look: { kind: 'crab', body: { len: 40, h: 22 }, col: { body: '#f6f0e2', back: '#f2ead8', belly: '#fbf8ee', fin: '#f0e6d2' } },
  scale: 1,
  move: { style: 'crawl', speed: 6, burst: 30, agility: 3, depth: [0.9, 1], school: 0 },
  activity: 'any',
  traits: { curiosity: 0.5, shyness: 0.5, greed: 0.6, aggression: 0.2 },
  bait: { chip: 3, worm: 2, trash: 2, sugar: 1 },
  quirks: ['crawler'],
  fight: fight(['tension', 'mash', 'net'], 0.3, 4, []),
  spawn: spawn({ weight: 1.1 }),
  sound: 'click',
  desc: 'A yeti crab from the hydrothermal vents. Farms bacteria in the silky hair on its arms and waves them over the vent to feed its crop. Has not shaved since it hatched.',
  behavior: 'Waves its hairy arms over the vents on the rift floor.',
  shinyHue: 30,
});

add({
  id: 'sixgill', name: 'Six-Seven Sixgill', biome: 'volcano', rarity: 'legendary', zone: ['abyss'], valueMul: DEEP.abyss * 1.3,
  size: [300, 550], weight: [200, 600],
  look: { body: { len: 170, h: 36 }, col: { body: '#5c564c', back: '#3e3a34', belly: '#8e877a', fin: '#3a3630' } },
  scale: 1,
  move: { style: 'swim', speed: 7, burst: 70, agility: 1, depth: [0.4, 0.95], school: 0 },
  activity: 'night',
  traits: { curiosity: 0.5, shyness: 0.3, greed: 0.8, aggression: 0.8 },
  bait: { relic: 3, blackhole: 3, worm: 2, golden: 2 },
  quirks: ['lunge'],
  fight: fight(['tension', 'dodge', 'trace', 'mash', 'net'], 0.95, 14, ['dash', 'dive', 'fake'], { biteWindow: 0.4, nibbles: [2, 4], fakeBite: 0.3 }),
  spawn: spawn({ weight: 0.7 }),
  sound: 'roar',
  desc: 'A bluntnose sixgill shark: six gill slits where most sharks have five, glowing green eyes and a body older than the dinosaurs. Six? Seven? It counts its gills differently every time.',
  behavior: 'Rises from the rift floor at night, green eyes first. Trophy of the vents.',
  shinyHue: 120,
});

// ===========================================================================
// FROSTY FJORD, SUNKEN METROPOLIS, JUNKYARD REEF, SUNNY SHALLOWS: their deep water

add({
  id: 'lanternshark', name: 'Low-Key Lanternshark', biome: 'fjord', rarity: 'uncommon', zone: ['twilight', 'midnight'], valueMul: DEEP.midnight,
  size: [30, 60], weight: [0.4, 1.6],
  look: { glow: true, body: { len: 50, h: 9 }, col: { body: '#3a2c2c', back: '#4c3a32', belly: '#121220', fin: '#3e3030' } },
  scale: 1,
  move: { style: 'swim', speed: 10, burst: 60, agility: 3, depth: [0.2, 0.9], school: 0.5 },
  activity: 'night',
  traits: { curiosity: 0.5, shyness: 0.4, greed: 0.7, aggression: 0.4 },
  bait: { lantern: 3, worm: 2, music: 1, bread: 1 },
  quirks: ['glow', 'school'],
  fight: fight(['tension', 'dodge', 'net'], 0.4, 5, ['dash']),
  spawn: spawn(),
  sound: 'grunt',
  desc: 'A velvet belly lanternshark. Its black belly glows blue to match the light from above, so from below it simply is not there. Low-key the best camouflage in the sea.',
  behavior: 'Hunts in small packs in the dark fjord water. Glows underneath.',
  shinyHue: 210,
});

add({
  id: 'telescope', name: 'Zoom Call Octopus', biome: 'metropolis', rarity: 'rare', zone: ['midnight'], valueMul: DEEP.midnight,
  size: [8, 15], weight: [0.02, 0.1],
  look: { kind: 'octopus', translucent: 0.8, body: { len: 36, h: 40 }, col: { body: '#d8f6fb', back: '#bfeaf4', belly: '#eefcff', fin: '#d8f6fb' } },
  scale: 1,
  move: { style: 'drift', speed: 4, burst: 25, agility: 1, depth: [0.15, 0.8], school: 0 },
  activity: 'any',
  traits: { curiosity: 0.8, shyness: 0.4, greed: 0.4, aggression: 0 },
  bait: { video: 3, chat: 2, lantern: 2, music: 1 },
  quirks: ['camouflage'],
  fight: fight(['trace', 'unwrap', 'net'], 0.2, 4, ['ink', 'wrap']),
  spawn: spawn(),
  sound: 'boing',
  desc: 'A telescope octopus. Clear as jelly, with two tube eyes standing up on its head. Camera on, face off: all you can see is its lunch.',
  behavior: 'Drifts nearly invisible, peering up through its tube eyes.',
  shinyHue: 140,
});

add({
  id: 'goblinshark', name: 'Goblin Mode Shark', biome: 'metropolis', rarity: 'epic', zone: ['midnight', 'abyss'], valueMul: DEEP.abyss,
  size: [250, 390], weight: [150, 210],
  look: { body: { len: 130, h: 26 }, col: { body: '#e8a6ae', back: '#c8848e', belly: '#f6cfd0', fin: '#b87482' } },
  scale: 1,
  move: { style: 'swim', speed: 8, burst: 85, agility: 2, depth: [0.3, 0.9], school: 0 },
  activity: 'any',
  traits: { curiosity: 0.4, shyness: 0.4, greed: 0.8, aggression: 0.8 },
  bait: { worm: 3, trash: 2, blackhole: 2, relic: 1 },
  quirks: ['lunge'],
  fight: fight(['tension', 'dodge', 'mash', 'trace', 'net'], 0.8, 10, ['dash', 'fake', 'dive']),
  spawn: spawn(),
  sound: 'roar',
  desc: 'A goblin shark: pink, flabby, with a blade of a snout and jaws that SLING out of its face to grab prey. Not in its main character era. Fully in goblin mode.',
  behavior: 'Drifts lazily, then its jaws shoot forward without warning.',
  shinyHue: 160,
});

add({
  id: 'cookiecutter', name: 'Just One Bite Cookiecutter', biome: 'junkyard', rarity: 'uncommon', zone: ['twilight', 'midnight'], valueMul: DEEP.midnight,
  size: [30, 56], weight: [0.3, 1.2],
  look: { glow: true, body: { len: 46, h: 8 }, col: { body: '#7a5640', back: '#6a4a38', belly: '#2a2e3a', fin: '#5a4030' } },
  scale: 1,
  move: { style: 'swim', speed: 10, burst: 75, agility: 4, depth: [0.2, 0.9], school: 0 },
  activity: 'night',
  traits: { curiosity: 0.7, shyness: 0.3, greed: 0.9, aggression: 0.7 },
  bait: { sugar: 3, chip: 2, popup: 2, worm: 1 },
  quirks: ['glow', 'lunge'],
  fight: fight(['tension', 'mash', 'net'], 0.45, 5, ['dash', 'fake']),
  spawn: spawn(),
  sound: 'gulp',
  desc: 'A cookiecutter shark. Glows from below except a dark collar that looks like a small fish, lures in whales and tuna, then takes one perfectly round bite. Just one. Every single time.',
  behavior: 'Rises at night, latches on with its suction lips and spins.',
  shinyHue: 40,
});

add({
  id: 'giantisopod', name: 'Final Form Isopod', biome: 'shallows', rarity: 'rare', zone: ['abyss'], valueMul: DEEP.abyss,
  size: [19, 50], weight: [1, 1.7],
  look: { kind: 'isopod', body: { len: 70, h: 30 }, col: { body: '#bcaea6', back: '#d8ccc0', belly: '#efe6de', fin: '#bcaea6' } },
  scale: 1,
  move: { style: 'crawl', speed: 5, burst: 25, agility: 2, depth: [0.9, 1], school: 0 },
  activity: 'any',
  traits: { curiosity: 0.3, shyness: 0.3, greed: 1, aggression: 0.1 },
  bait: { worm: 3, trash: 3, bread: 2, sugar: 1 },
  quirks: ['crawler'],
  fight: fight(['tension', 'mash', 'net'], 0.4, 6, ['dive']),
  spawn: spawn(),
  sound: 'click',
  desc: 'A giant isopod, the roly-poly\'s final boss form. Eats a whale fall, then goes five years without a snack. Its big compound eyes shine gold in your light.',
  behavior: 'Trundles across the abyss floor, eyes glinting.',
  shinyHue: 260,
});

for (const sp of S) if (sp.quirks.includes('glow') || sp.quirks.includes('lure')) sp.glow = true;

export const DEEP_SPECIES = S;
