// [deep28] More deep-sea arrivals: scarier fish for the midnight zone, the abyss and its new bottom band, the Hadal Zone
// (depthzones.js HADAL_K: the last stretch above the abyss floor, only in reach of a maxed-out line). Same schema as
// species-deep.js (zone, valueMul, oceans; final size, no GROW pass). Anatomy: src/fish/anatomy.js ('fish' plans)
// and realvox.js SOLIDS (teuthid squids, sea pig, atolla, bobbit worm).
// fight.twist names a small fight personality on the meter (src/fishing/deeptwist.js): slime, blink, frenzy, wrap,
// dazzle, ambush, alarm, waddle, vanta, thrash, bite, reverse, dive. `scary: true` makes the deep zones favour it
// (ZoneSpawner.rarityMul) and lets the ambience borrow it for ambushes and passing packs.

const S = [];
const add = (o) => S.push({ scary: true, ...o });
const fight = (phases, power, stamina, tricks, twist, o = {}) => ({ phases, power, stamina, tricks, twist, biteWindow: 0.6, nibbles: [1, 2], fakeBite: 0.15, ...o });
const spawn = (o = {}) => ({ weight: 1, weather: null, time: null, requires: null, hidden: null, ...o });
const DEEP = { twilight: 1.15, midnight: 1.3, abyss: 1.5, hadal: 1.8 };
const ALL = ['oscean', 'shallows', 'fjord', 'junkyard', 'metropolis', 'volcano', 'abyss'];
const others = (home) => ALL.filter((o) => o !== home);

// ===========================================================================
// THE DEEP OCEAN (abyss)

add({
  id: 'giantsquid', name: 'Release-the-Kraken Giant Squid', biome: 'abyss', oceans: ['shallows', 'metropolis'], rarity: 'legendary', zone: ['midnight', 'abyss'], valueMul: DEEP.abyss * 1.3,
  size: [600, 1300], weight: [100, 275],
  look: { kind: 'squid', glow: true, body: { len: 110, h: 28 }, col: { body: '#c8584a', back: '#a83a34', belly: '#e8a490', fin: '#9a3430' } },
  scale: 1,
  move: { style: 'swim', speed: 7, burst: 70, agility: 1, depth: [0.2, 0.85], school: 0 },
  activity: 'any',
  traits: { curiosity: 0.6, shyness: 0.4, greed: 0.7, aggression: 0.7 },
  bait: { relic: 3, blackhole: 3, lantern: 3, golden: 2 },
  quirks: ['lunge', 'ink'],
  fight: fight(['tension', 'unwrap', 'trace', 'dodge', 'net'], 0.9, 14, ['wrap', 'ink', 'dash'], 'wrap', { biteWindow: 0.45, nibbles: [2, 4], fakeBite: 0.3 }),
  spawn: spawn({ weight: 0.6 }),
  sound: 'roar',
  desc: 'Architeuthis, the real kraken: up to 13 m long, two feeding tentacles lined with toothed suckers, and eyes as big as dinner plates to spot sperm whales in the dark. Nobody filmed one alive until 2012.',
  behavior: 'Cruises the midnight water. On the line it wraps its arms round everything, your zone included.',
  shinyHue: 200,
});

add({
  id: 'dana', name: 'Flashbang Octopus Squid', biome: 'abyss', oceans: ['metropolis'], rarity: 'epic', zone: ['midnight', 'abyss'], valueMul: DEEP.abyss,
  size: [100, 230], weight: [20, 160],
  look: { kind: 'squid', glow: true, body: { len: 78, h: 26 }, col: { body: '#a8404e', back: '#8a2a3a', belly: '#e0a0a8', fin: '#7a2232' } },
  scale: 1,
  move: { style: 'swim', speed: 8, burst: 80, agility: 2, depth: [0.2, 0.85], school: 0 },
  activity: 'any',
  traits: { curiosity: 0.5, shyness: 0.3, greed: 0.7, aggression: 0.7 },
  bait: { lantern: 3, video: 3, image: 2, blackhole: 2 },
  quirks: ['glow', 'lunge'],
  fight: fight(['tension', 'dodge', 'trace', 'net'], 0.75, 10, ['dash', 'fake', 'ink'], 'dazzle'),
  spawn: spawn({ weight: 0.8 }),
  sound: 'click',
  desc: 'The Dana octopus squid (Taningia danae) drops its two feeding tentacles as it grows up, and keeps the biggest light organs known: lemon-sized lamps on two arm tips that it flashes in your face mid-attack. Flashbang out.',
  behavior: 'Blinks its arm-tip lamps in the dark. On the line it dazzles you: your reel barely bites for a moment.',
  shinyHue: 50,
});

add({
  id: 'seapig', name: 'Hog Wild Sea Pig', biome: 'abyss', oceans: others('abyss'), rarity: 'common', zone: ['abyss'], valueMul: DEEP.abyss,
  size: [4, 15], weight: [0.02, 0.1],
  look: { kind: 'crab', body: { len: 34, h: 20 }, col: { body: '#f6c0cc', back: '#f0a8b8', belly: '#fcdce2', fin: '#f8d0d8' } },
  scale: 1,
  move: { style: 'crawl', speed: 3, burst: 18, agility: 1, depth: [0.9, 1], school: 0.5 },
  activity: 'any',
  traits: { curiosity: 0.7, shyness: 0.2, greed: 0.8, aggression: 0 },
  bait: { worm: 3, bread: 3, trash: 2, sugar: 2 },
  quirks: ['crawler'],
  fight: fight(['tension', 'net'], 0.15, 3, [], 'waddle'),
  spawn: spawn({ weight: 1.2 }),
  sound: 'squeak',
  scary: false,
  desc: 'Scotoplanes, a sea cucumber that walks. Herds of hundreds trot across the abyssal plain on inflated tube feet, hoovering up the freshest mud. Somehow the cutest thing down here. Oink.',
  behavior: 'Waddles over the abyss floor in little herds. Fights like a pig on ice.',
  shinyHue: 300,
});

add({
  id: 'cuskeel', name: 'Rock Bottom Cusk Eel', biome: 'abyss', oceans: others('abyss'), rarity: 'rare', zone: ['hadal'], valueMul: DEEP.hadal,
  size: [10, 17], weight: [0.01, 0.05],
  look: { glow: true, body: { len: 46, h: 9, shape: 'long' }, col: { body: '#dcc6be', back: '#b89a92', belly: '#f2e4de', fin: '#d4bcb4' } },
  scale: 1,
  move: { style: 'swim', speed: 5, burst: 45, agility: 2, depth: [0.55, 1], school: 0 },
  activity: 'any',
  traits: { curiosity: 0.6, shyness: 0.4, greed: 0.6, aggression: 0.1 },
  bait: { worm: 3, lantern: 2, docs: 2, sugar: 1 },
  quirks: [],
  fight: fight(['tension', 'trace', 'net'], 0.45, 7, ['dive'], 'dive'),
  spawn: spawn({ weight: 1.2 }),
  sound: 'blub',
  desc: 'Abyssobrotula galatheae, the deepest fish ever caught: hauled up from 8,370 m in the Puerto Rico Trench. Pale, soft and fused into one long fin. Hit rock bottom and kept digging.',
  behavior: 'Only lives in the Hadal Zone above the abyss floor. Dives hard for the bottom when hooked.',
  shinyHue: 160,
});

add({
  id: 'matriarch', name: 'Mother of All Anglers', biome: 'abyss', rarity: 'legendary', zone: ['hadal'], valueMul: DEEP.hadal * 1.4,
  size: [80, 120], weight: [8, 20],
  look: { glow: true, body: { len: 120, h: 70, shape: 'blunt' }, col: { body: '#1c1218', back: '#100a0e', belly: '#2a1c22', fin: '#160e12' } },
  scale: 1,
  move: { style: 'hover', speed: 3, burst: 70, agility: 1, depth: [0.35, 0.95], school: 0 },
  activity: 'any',
  traits: { curiosity: 0.4, shyness: 0.1, greed: 1, aggression: 0.9 },
  bait: { relic: 3, lantern: 3, blackhole: 3, golden: 2 },
  quirks: ['glow', 'lure', 'lunge'],
  fight: fight(['tension', 'mash', 'trace', 'dodge', 'net'], 1, 16, ['fake', 'dive', 'dash'], 'dazzle', { biteWindow: 0.4, nibbles: [2, 4], fakeBite: 0.4 }),
  spawn: spawn({ weight: 0.5 }),
  sound: 'roar',
  desc: 'After Ceratias holboelli, the biggest anglerfish (over a metre) and the triplewart seadevil: three glowing warts on her back and tiny males fused to her belly for life, sharing her blood. The trench is her house. You are a guest.',
  behavior: 'Hangs in the Hadal Zone under her glowing bait. The trophy at the very bottom of the Deep Ocean.',
  shinyHue: 190,
});

// ===========================================================================
// FROSTY FJORD (the Southern-Ocean cold deep)

add({
  id: 'colossal', name: 'Hooked On You Colossal Squid', biome: 'fjord', rarity: 'legendary', zone: ['abyss'], valueMul: DEEP.abyss * 1.4,
  size: [300, 1000], weight: [150, 500],
  look: { kind: 'squid', glow: true, body: { len: 100, h: 36 }, col: { body: '#d86a5a', back: '#b8443a', belly: '#f0b8a8', fin: '#a83c34' } },
  scale: 1,
  move: { style: 'swim', speed: 5, burst: 55, agility: 1, depth: [0.25, 0.85], school: 0 },
  activity: 'any',
  traits: { curiosity: 0.5, shyness: 0.4, greed: 0.8, aggression: 0.7 },
  bait: { relic: 3, blackhole: 3, golden: 2, lantern: 2 },
  quirks: ['lunge', 'ink'],
  fight: fight(['tension', 'unwrap', 'mash', 'dodge', 'net'], 1, 16, ['wrap', 'ink', 'dive'], 'wrap', { biteWindow: 0.4, nibbles: [2, 4], fakeBite: 0.3 }),
  spawn: spawn({ weight: 0.6 }),
  sound: 'roar',
  desc: 'Mesonychoteuthis, the heaviest invertebrate on Earth (one weighed 495 kg) with the biggest eyes ever measured, and swivelling HOOKS on its arms and clubs. Only filmed alive in the wild in 2025: a 30 cm baby.',
  behavior: 'Drifts in the cold abyss of the fjord. On the line its hooked arms squeeze your zone tight.',
  shinyHue: 190,
});

add({
  id: 'hagfish', name: 'Slime Season Hagfish', biome: 'fjord', oceans: ['oscean', 'shallows', 'junkyard', 'metropolis', 'abyss'], rarity: 'common', zone: ['abyss'], valueMul: DEEP.abyss,
  size: [30, 80], weight: [0.1, 1.5],
  look: { body: { len: 60, h: 8, shape: 'long' }, col: { body: '#a88894', back: '#7a5a68', belly: '#dcc4c8', fin: '#b0909a' } },
  scale: 1,
  move: { style: 'swim', speed: 6, burst: 40, agility: 3, depth: [0.75, 1], school: 0 },
  activity: 'any',
  traits: { curiosity: 0.5, shyness: 0.3, greed: 1, aggression: 0.2 },
  bait: { trash: 3, worm: 3, bread: 2, blackhole: 1 },
  quirks: [],
  fight: fight(['tension', 'unwrap', 'net'], 0.3, 5, ['wrap'], 'slime'),
  spawn: spawn({ weight: 1.2 }),
  sound: 'gulp',
  desc: 'A hagfish: no jaws, barely any eyes, a skull but no backbone, and 300 million years of practice. Grabbed, it turns a bucket of water into slime in under a second, then ties itself in a knot to wipe it off.',
  behavior: 'Noses around the abyss floor for whale falls. Hooked, it slimes your hook: the marker gets slippery.',
  shinyHue: 120,
});

// ===========================================================================
// JUNKYARD REEF

add({
  id: 'fireflysquid', name: 'Rave Mode Firefly Squid', biome: 'junkyard', oceans: ['oscean', 'shallows', 'metropolis', 'abyss'], rarity: 'common', zone: ['twilight', 'midnight'], valueMul: DEEP.twilight,
  size: [5, 8], weight: [0.01, 0.03],
  look: { kind: 'squid', glow: true, body: { len: 22, h: 9 }, col: { body: '#7a5aa8', back: '#5a3a8a', belly: '#c8b8e8', fin: '#4a2e78' } },
  scale: 1,
  move: { style: 'swim', speed: 9, burst: 55, agility: 4, depth: [0.15, 0.85], school: 0.9 },
  activity: 'any',
  traits: { curiosity: 0.7, shyness: 0.4, greed: 0.5, aggression: 0 },
  bait: { music: 3, video: 2, lantern: 2, sugar: 1 },
  quirks: ['glow', 'school'],
  fight: fight(['tension', 'net'], 0.2, 3, ['fake'], 'blink'),
  spawn: spawn({ weight: 1.3 }),
  sound: 'chirp',
  scary: false,
  desc: 'Watasenia scintillans, a thumb-sized squid wearing hundreds of blue lights, three extra-bright ones on the tips of its arms. Every spring millions spawn in Toyama Bay, Japan, and the whole shoreline glows. The party never stops.',
  behavior: 'Swarms through the dark in glittering schools. On the line it blinks: the zone goes dark for a moment.',
  shinyHue: 280,
});

add({
  id: 'sabertooth', name: 'Tooth Be Told Sabertooth', biome: 'junkyard', oceans: ['abyss', 'fjord'], rarity: 'uncommon', zone: ['midnight'], valueMul: DEEP.midnight,
  size: [8, 18], weight: [0.01, 0.06],
  look: { glow: true, body: { len: 34, h: 12 }, col: { body: '#2c2028', back: '#1a1418', belly: '#4a3a46', fin: '#221a20' } },
  scale: 1,
  move: { style: 'swim', speed: 7, burst: 80, agility: 3, depth: [0.2, 0.9], school: 0 },
  activity: 'any',
  traits: { curiosity: 0.5, shyness: 0.3, greed: 0.8, aggression: 0.8 },
  bait: { chip: 3, worm: 2, lantern: 2, trash: 1 },
  quirks: ['lunge'],
  fight: fight(['tension', 'dodge', 'net'], 0.4, 5, ['dash', 'fake'], 'bite'),
  spawn: spawn(),
  sound: 'click',
  desc: 'A sabertooth fish (Coccorella / Evermannella): a stubby little ambusher with tube eyes staring straight up and two tusks from its lower jaw so long they overlap its snout. Tooth be told, it is mostly teeth.',
  behavior: 'Hangs still, eyes up, then lunges. Every lunge on the line takes a bite of your catch bar.',
  shinyHue: 30,
});

// ===========================================================================
// SUNKEN METROPOLIS

add({
  id: 'atolla', name: 'Wee-Woo Atolla Jelly', biome: 'metropolis', oceans: ['abyss', 'fjord', 'oscean'], rarity: 'uncommon', zone: ['midnight', 'abyss'], valueMul: DEEP.midnight,
  size: [2, 17], weight: [0.01, 0.3],
  look: { kind: 'jelly', glow: true, body: { len: 36, h: 36 }, col: { body: '#c01828', back: '#7a0814', belly: '#ff7a88', fin: '#c01828' } },
  scale: 1,
  move: { style: 'drift', speed: 3, burst: 18, agility: 1, depth: [0.15, 0.8], school: 0 },
  activity: 'any',
  traits: { curiosity: 0.4, shyness: 0.5, greed: 0.3, aggression: 0 },
  bait: { lantern: 3, music: 2, video: 2, sugar: 1 },
  quirks: ['glow', 'pulse'],
  fight: fight(['trace', 'net'], 0.25, 4, [], 'alarm'),
  spawn: spawn(),
  sound: 'bell',
  desc: 'Atolla wyvillei, the alarm jelly. Blood red (invisible down here), with one weirdly long tentacle. Grab it and blue lights chase round its rim like a siren, calling a bigger predator to eat whatever grabbed it. A copy of that alarm lured in the first giant squid ever filmed in US waters.',
  behavior: 'Pulses in the midnight water. On the line its alarm goes off and the fight gets wild.',
  shinyHue: 210,
});

add({
  id: 'blackdragon', name: 'Shadow Realm Blackdragon', biome: 'metropolis', oceans: ['abyss', 'volcano'], rarity: 'rare', zone: ['midnight'], valueMul: DEEP.midnight,
  size: [20, 40], weight: [0.02, 0.1],
  look: { glow: true, body: { len: 70, h: 8, shape: 'long' }, col: { body: '#0b0910', back: '#060509', belly: '#110d16', fin: '#09070d' } },
  scale: 1,
  move: { style: 'swim', speed: 8, burst: 85, agility: 4, depth: [0.2, 0.9], school: 0 },
  activity: 'night',
  traits: { curiosity: 0.4, shyness: 0.4, greed: 0.8, aggression: 0.8 },
  bait: { lantern: 3, video: 2, image: 2, worm: 1 },
  quirks: ['glow', 'lure', 'lunge'],
  fight: fight(['tension', 'trace', 'dodge', 'net'], 0.55, 6, ['dash', 'fake'], 'vanta'),
  spawn: spawn(),
  sound: 'click',
  desc: 'A female Pacific blackdragon: a black eel-shaped hunter whose ultra-black skin swallows over 99.5 % of the light that hits it, with fangs too long to close over and a glowing bulb on her chin. The males are tiny and toothless. Sent to the shadow realm.',
  behavior: 'Invisible except for her chin light. On the line she vanishes: the marker goes ultra-black.',
  shinyHue: 300,
});

add({
  id: 'lasiognathus', name: 'Uno Reverse Anglerfish', biome: 'metropolis', oceans: ['abyss'], rarity: 'epic', zone: ['midnight', 'abyss'], valueMul: DEEP.abyss,
  size: [5, 10], weight: [0.01, 0.04],
  look: { glow: true, body: { len: 34, h: 22, shape: 'blunt' }, col: { body: '#2c1c24', back: '#1e1218', belly: '#3a2830', fin: '#24161c' } },
  scale: 1,
  move: { style: 'hover', speed: 4, burst: 60, agility: 2, depth: [0.25, 0.9], school: 0 },
  activity: 'any',
  traits: { curiosity: 0.6, shyness: 0.2, greed: 0.9, aggression: 0.6 },
  bait: { lantern: 3, worm: 3, golden: 2, chat: 1 },
  quirks: ['glow', 'lure', 'lunge'],
  fight: fight(['tension', 'trace', 'mash', 'net'], 0.6, 8, ['fake', 'dive'], 'reverse', { fakeBite: 0.35 }),
  spawn: spawn({ weight: 0.9 }),
  sound: 'grunt',
  desc: 'Lasiognathus, the angler that went full angler: a rod, a dangling LINE, a glowing bait and three bony hooks on it. Its overbite of long teeth does the rest. You are not the only one fishing down here.',
  behavior: 'Dangles its line in the dark. On the line it reels YOU in: stop spinning when it pulls back.',
  shinyHue: 160,
});

// ===========================================================================
// LAVA RIFT (volcano)

add({
  id: 'humboldt', name: 'Rage Bait Humboldt Squid', biome: 'volcano', oceans: ['abyss', 'shallows'], rarity: 'rare', zone: ['twilight', 'midnight'], valueMul: DEEP.midnight,
  size: [50, 150], weight: [5, 50],
  look: { kind: 'squid', body: { len: 56, h: 18 }, col: { body: '#e8424a', back: '#c81e2a', belly: '#f8b0a8', fin: '#b81a26' } },
  scale: 1,
  move: { style: 'swim', speed: 12, burst: 110, agility: 4, depth: [0.15, 0.85], school: 0.6 },
  activity: 'night',
  traits: { curiosity: 0.6, shyness: 0.1, greed: 1, aggression: 1 },
  bait: { worm: 3, chip: 2, trash: 2, bread: 2 },
  quirks: ['lunge', 'ink', 'school'],
  fight: fight(['tension', 'dodge', 'mash', 'net'], 0.65, 7, ['dash', 'ink', 'fake'], 'frenzy'),
  spawn: spawn(),
  sound: 'click',
  desc: 'Humboldt squid, the "diablo rojo": pack hunters up to 1.5 m that flicker red and white at each other in the dark, a light show that looks a lot like yelling. Rage bait, but make it cephalopod.',
  behavior: 'Hunts in packs at night, flashing red. On the line it lunges again and again with almost no warning.',
  shinyHue: 0,
});

add({
  id: 'bobbit', name: 'Trap Card Bobbit Worm', biome: 'volcano', oceans: ['junkyard', 'shallows'], rarity: 'rare', zone: ['abyss'], valueMul: DEEP.abyss,
  size: [50, 300], weight: [0.2, 1.5],
  look: { kind: 'crab', body: { len: 50, h: 34 }, col: { body: '#a07a2a', back: '#4a2a6a', belly: '#d8b880', fin: '#e8603a' } },
  scale: 1,
  move: { style: 'crawl', speed: 1.5, burst: 140, agility: 2, depth: [0.92, 1], school: 0 },
  activity: 'any',
  traits: { curiosity: 0.3, shyness: 0.2, greed: 1, aggression: 1 },
  bait: { worm: 3, chip: 2, trash: 2, blackhole: 2 },
  quirks: ['crawler', 'lunge'],
  fight: fight(['tension', 'mash', 'net'], 0.6, 7, ['dive', 'fake'], 'ambush'),
  spawn: spawn({ weight: 0.9 }),
  sound: 'click',
  desc: 'Eunice aphroditois: up to 3 m of iridescent worm buried in the seabed, only five antennae showing. Touch one and scissor jaws strike so fast they can cut a fish in half. It usually lives in warm sand; this one followed the dark all the way down. You activated its trap card.',
  behavior: 'Waits in the floor with its antennae up and strikes from below. Hooked, it ambushes before you are ready.',
  shinyHue: 140,
});

// ===========================================================================
// SUNNY SHALLOWS

add({
  id: 'lancetfish', name: 'Full Inventory Lancetfish', biome: 'shallows', oceans: ['oscean', 'junkyard', 'abyss'], rarity: 'uncommon', zone: ['twilight', 'midnight'], valueMul: DEEP.midnight,
  size: [100, 215], weight: [3, 9],
  look: { glow: true, body: { len: 90, h: 10, shape: 'long' }, col: { body: '#8aa0b8', back: '#22304e', belly: '#dce6f0', fin: '#22304e' } },
  scale: 1,
  move: { style: 'swim', speed: 10, burst: 90, agility: 3, depth: [0.15, 0.85], school: 0 },
  activity: 'any',
  traits: { curiosity: 0.6, shyness: 0.3, greed: 1, aggression: 0.7 },
  bait: { trash: 3, popup: 2, chip: 2, worm: 1 },
  quirks: ['lunge'],
  fight: fight(['tension', 'dodge', 'trace', 'net'], 0.55, 7, ['dash', 'fake'], 'thrash'),
  spawn: spawn(),
  sound: 'click',
  desc: 'A longnose lancetfish: two metres of silver blade with a sail for a back fin and a mouth full of daggers. It swallows things whole and digests slowly, so scientists open its stomach to see what lives (and what plastic drifts) in the deep. Inventory: full.',
  behavior: 'Slices through the dark mid-water. On the line it thrashes wildly side to side.',
  shinyHue: 230,
});

add({
  id: 'lizardfish', name: 'Lizard Brain Lizardfish', biome: 'shallows', oceans: ['fjord', 'metropolis', 'abyss', 'volcano'], rarity: 'uncommon', zone: ['abyss'], valueMul: DEEP.abyss,
  size: [30, 64], weight: [0.5, 3],
  look: { glow: true, body: { len: 60, h: 10, shape: 'long' }, col: { body: '#9a9284', back: '#625a52', belly: '#dcd6c8', fin: '#7a7266' } },
  scale: 1,
  move: { style: 'crawl', speed: 2, burst: 130, agility: 3, depth: [0.92, 1], school: 0 },
  activity: 'any',
  traits: { curiosity: 0.3, shyness: 0.3, greed: 1, aggression: 0.9 },
  bait: { worm: 3, bread: 2, docs: 2, trash: 1 },
  quirks: ['crawler', 'lunge'],
  fight: fight(['tension', 'dodge', 'net'], 0.5, 6, ['dash', 'dive'], 'ambush'),
  spawn: spawn(),
  sound: 'grunt',
  desc: 'Bathysaurus ferox, one of the deepest top predators: it lies on the abyssal plain propped on its fins, facing the current, a flat crocodile head full of needle teeth. Every one is male and female at once. Pure lizard brain: see it, bite it.',
  behavior: 'Lies in ambush on the abyss floor and strikes at anything that drifts past.',
  shinyHue: 90,
});

for (const sp of S) if (sp.quirks.includes('glow') || sp.quirks.includes('lure')) sp.glow = true;

export const DEEP28_SPECIES = S;
