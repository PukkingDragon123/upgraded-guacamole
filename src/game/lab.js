// The Lab (phase 3, rows in phase 6, centre-out tree in phase 7): the ONE progression system. OWNER: Lab+Quests agent.
// Everything is unlocked by researching nodes laid out as skill-tree ROWS (LAB_ROWS; src/ui/labrows.js draws them):
// rods, boat upgrades, aquarium tiers, crafting recipes (buildings, bait, decor), oceans, features, stat boosts.
// Quests (src/game/quests.js) also grant nodes for free (grantLabNode), e.g. the next ocean at each chapter's end.
// Research costs Aero + materials + fish, takes real time, and shows a waiting widget (src/ui/labwidget.js).
//
//   LAB_NODES: [{id, name, branch, tier, depth, lane, pos:[x,y], ang, rad, req:[ids], cost:{aero, items:{matId:n}, fish:{key:n}},
//               time /*seconds*/, effect:{statKey:value}, unlock:[{kind, id}], desc, icon}]
//     fish cost keys: 'rarity:<r>' (that rarity or better), 'biome:<oceanId>' (caught in that ocean), or a species id
//     (a species that no longer exists falls back to 'rarity:common'). Paid with kept fish NOT in the tank.
//     pos is in tree units around the root (0,0); ang (radians) / rad (units) are the same point in polar form.
//   120 nodes (root + 8 branches): rods (up), reel & shock, boats (right), oceans, aquarium (down), luck & idle,
//   bait (left), crafting. [phase7:lab] Centre-out layout: depth d sits on ring LAB_RING(d), each branch is a spoke
//   with its main row on the spoke and its side row forking LAB_FORK degrees clockwise; LAB_CHILDREN[id] -> ids that need it.
//   BRANCHES {id: {name, color, angle, icon}}, BRANCH_ORDER, LAB_BY_ID, ROOT_ID, BOAT_ORDER, TANK_ORDER, OCEAN_ORDER,
//   BOAT_NAMES, TANK_NAMES, OCEAN_NAMES, STARTER_UNLOCKS, DECOR_SETS (decor recipes per crafting node), EFFECT_INFO, MULT_KEYS
//   Unlock ids: rod:<rods.js id>, boat:<BOAT_ORDER> (sets state.boat.tier), tank:<TANK_ORDER> (sets state.tank.tier),
//   biome:<OCEAN_ORDER> (pushed to state.unlockedBiomes), recipe:<src/build/crafting.js id>, bait:<store bait id>
//   (sold at the Bait Shop), feature:isp2..isp6 (Bait Shop shelves/discounts) | multiplayer | autocollect | eng1 | eng2 | aquarium.
//   ensureLab(state) -> state.lab = {done:{id:ts}, active:{id,start,end}|null, slots:[{id,start,end,paid}], unlocks:{'kind:id':true}}
//   labHas(state, nodeId) -> bool
//   labStatus(state, nodeId) -> 'done'|'researching'|'available'|'locked'
//   unlocked(state, kind, id) -> bool      kind: 'rod'|'boat'|'tank'|'recipe'|'biome'|'bait'|'cosmetic'|'feature'
//   grantUnlock(state, kind, id)           (also used by loot/cosmetic grants; applies rods/boat/tank/biome side effects)
//   computeLabStats(state) -> combined effects of finished nodes {key: value} (MULT_KEYS multiply, others add);
//                             skills.computeStats() merges them into BASE_STATS for game.recomputeStats().
// Research flow (needs the game for events/coins):
//   labCheck(state, node) -> {ok, aero:{have,need,ok}, items:[{id,have,need,ok}], fish:[{key,have,need,ok}], slots, reqOk}
//   startResearch(game, id) -> {ok, reason}     finishResearch(game, id)     cancelResearch(game, id)
//   instantCost(state, slotOrId) -> Aero        instantFinish(game, id) -> bool
//   labTick(game) -> [finished ids]  (call every frame; finishes due research, also after being away)
//   labSlots(state), labTime(state, node), labProgress(state, id) -> 0..1, labRemaining(state, id) -> s
//   fishHave(state, key) -> count of kept fish (inTank false) matching a fish cost key; fishLabel(key), fishKeyInfo(key)
//   labFocus(state, key) -> node id for ui.open('lab', {focus}) keys ('custombait', 'isp', 'rod:<id>', 'biome:<id>', node id)
//   nodeFor(kind, id) -> the node that unlocks it (or null)
// Events (game.emit): 'labStarted' {id}, 'labDone' {id}, 'unlocked' {kind, id}; also 'skill' (id) for old listeners.
// [phase6:lab] Rows (LAB_ROWS, ROW_OF, node.row/col), plans and the queue (state.lab.queue = [{id, paid}]):
//   canPlan, planCost, planAfford, confirmResearch(game, ids), labQueued; grantLabNode(game, id) for quest rewards.
//   labStatus() reports a queued node as 'researching' (it is paid for); 'labQueued' {id} when Confirm queues one.
import * as SPECIES_MOD from '../fish/species.js';
import { giveRod } from './rods.js';

export const STARTER_UNLOCKS = ['rod:twig', 'tank:jar', 'boat:raft', 'biome:oscean', 'bait:crumbs', 'feature:aquarium', 'recipe:bp_research_lab', 'recipe:decor_rubber_duck'];
export const ROOT_ID = 'core';
export const BOAT_ORDER = ['raft', 'dinghy', 'skiff', 'hydrofoil', 'yacht', 'catamaran', 'submarine'];
export const TANK_ORDER = ['jar', 'bowl', 'smalltank', 'bigtank', 'reeftank', 'wallaquarium'];
export const OCEAN_ORDER = ['oscean', 'shallows', 'fjord', 'junkyard', 'metropolis', 'volcano', 'abyss'];
export const RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
const speciesById = (id) => { try { return SPECIES_MOD.SPECIES_BY_ID?.[id] || null; } catch { return null; } };

export const BOAT_NAMES = { raft: 'Bubble Raft', dinghy: 'Dinghy', skiff: 'Skiff', hydrofoil: 'Hydrofoil', yacht: 'Aero Yacht', catamaran: 'Catamaran', submarine: 'Submarine' };
export const TANK_NAMES = { jar: 'Nano Tank', bowl: 'Bubble Tank', smalltank: 'Aqua Tank', bigtank: 'Big Tank', reeftank: 'Reef Tank', wallaquarium: 'Mega Tank' };
export const OCEAN_NAMES = { oscean: '(OS)cean', shallows: 'Sunny Shallows', fjord: 'Frosty Fjord', junkyard: 'Junkyard Reef', metropolis: 'Sunken Metropolis', volcano: 'Lava Rift', abyss: 'The Deep Ocean' };

// Angles in degrees, screen space (0 = right, 90 = down). Rods point up.
export const BRANCHES = {
  rods: { name: 'Rods', color: '#35c8ff', angle: -90, icon: 'rod:glass' },
  reel: { name: 'Reel & Shock', color: '#ffc23a', angle: -45, icon: 'bolt' },
  boats: { name: 'Boats', color: '#3f8cff', angle: 0, icon: 'boat:skiff' },
  oceans: { name: 'Oceans', color: '#19c7a2', angle: 45, icon: 'globe' },
  aquarium: { name: 'Aquarium', color: '#ff74b4', angle: 90, icon: 'tank:bowl' },
  luck: { name: 'Luck & Idle', color: '#6fd23f', angle: 135, icon: 'clover' },
  bait: { name: 'Bait', color: '#ff9330', angle: 180, icon: 'bait:worm' },
  crafting: { name: 'Crafting', color: '#a98aff', angle: -135, icon: 'hammer' },
};
export const BRANCH_ORDER = ['rods', 'reel', 'boats', 'oceans', 'aquarium', 'luck', 'bait', 'crafting'];

// Effect keys that multiply (everything else adds).
export const MULT_KEYS = new Set(['biteWindow', 'staminaDrain', 'traceRadius', 'traceForgive', 'mashPower', 'timingWindow', 'netTolerance', 'netTime', 'calm',
  'baitRadius', 'rarityBoost', 'shinyChance', 'coinMul', 'hatchSpeed', 'rodLure', 'rodLuck', 'rodControl', 'rodStrength', 'shockPower', 'shockCooldown', 'labSpeed']);

// Short labels for effect chips: key -> [icon, label, format]
export const EFFECT_INFO = {
  biteWindow: ['hook', 'Bite window', 'mul'], lineStrength: ['line', 'Line strength', 'pct'], snapGrace: ['line', 'Snap grace', 'sec'],
  slackGrace: ['hook', 'Slack grace', 'sec'], reelSpeed: ['reel', 'Reel speed', 'add'], staminaDrain: ['reel', 'Tire fish', 'mul'],
  traceRadius: ['eye', 'Trace ring', 'mul'], traceForgive: ['eye', 'Trace forgive', 'mul'], mashPower: ['mouse_l', 'Mash power', 'mul'],
  timingWindow: ['music', 'Timing window', 'mul'], timingMisses: ['music', 'Timing misses', 'add'], dodgeHits: ['heart', 'Dodge hits', 'add'],
  netTolerance: ['net', 'Net tolerance', 'mul'], netTime: ['net', 'Net time', 'mul'], calm: ['bubble', 'Calm fish', 'mul'],
  autoHook: ['sparkle', 'Auto-hook', 'pct'], baitRadius: ['bait', 'Bait reach', 'mul'], rarityBoost: ['star', 'Rare fish', 'mul'],
  mutationChance: ['sparkle', 'Mutations', 'pct'], shinyChance: ['star', 'Shiny odds', 'mul'], boxSlots: ['bait', 'Bait slots', 'add'],
  tankCap: ['tank', 'Tank space', 'add'], coinMul: ['coin', 'Aero income', 'mul'], collectRadius: ['coin', 'Aero magnet', 'add'],
  focus: ['clock', 'Focus mode', 'flag'], autoCollect: ['coin', 'Auto-collect', 'add'], feeder: ['food', 'Auto-feeder', 'flag'],
  breeding: ['heart', 'Breeding', 'flag'], hatchSpeed: ['sun', 'Hatch speed', 'mul'], sonar: ['eye', 'Sonar', 'flag'],
  lantern: ['sun', 'Lantern', 'flag'], forecast: ['cloud', 'Forecast', 'flag'], offlineMul: ['zzz', 'Idle Aero', 'pct'],
  rodLure: ['clock', 'Rod lure', 'mul'], rodLuck: ['star', 'Rod luck', 'mul'], rodControl: ['mouse_l', 'Rod control', 'mul'],
  rodResilience: ['heart', 'Resilience', 'pct'], rodStrength: ['trophy', 'Rod strength', 'mul'], shockPower: ['storm', 'Shock power', 'mul'],
  shockCharges: ['storm', 'Shock charges', 'add'], shockCooldown: ['storm', 'Shock recharge', 'cd'], labSlots: ['plus', 'Lab slots', 'add'],
  labSpeed: ['clock', 'Lab speed', 'mul'], crateLuck: ['star', 'Crate luck', 'pct'],
};

// ---------------------------------------------------------------- costs by tier
const AERO_T = [0, 10, 30, 80, 200, 480, 1100, 2400, 5200, 11000];
const TIME_T = [0, 5, 15, 40, 90, 180, 360, 720, 1500, 3000];
// generic tier materials + branch flavour materials (tier bands 1-3, 4-6, 7-9)
const MAT_T = [null, { driftwood: 2 }, { kelp_fibre: 2 }, { sea_glass: 2 }, { coral_chunk: 3 }, { gear: 2 }, { pearl: 2 },
  { circuit_board: 3 }, { ancient_stone: 3 }, { abyss_crystal: 3 }];
// band 0 (tiers 2-3) only asks for common things every ocean's crates and catches give; tier 1 is Aero + driftwood
const FLAVOUR = {
  rods: ['driftwood', 'sea_glass', 'abyss_crystal'], reel: ['kelp_fibre', 'gear', 'circuit_board'], boats: ['driftwood', 'scrap_metal', 'gear'],
  oceans: ['fish_sample', 'fish_sample', 'rare_specimen'], aquarium: ['shell', 'coral_chunk', 'pearl'], luck: ['shell', 'pearl', 'golden_scale'],
  bait: ['kelp_fibre', 'fish_sample', 'rare_specimen'], crafting: ['driftwood', 'scrap_metal', 'ancient_stone'],
};
const FLAVOUR_Q = { common: [3, 5, 8], uncommon: [2, 3, 5], rare: [1, 2, 3], epic: [1, 1, 2], legendary: [1, 1, 1] };
const MAT_RARITY = { driftwood: 'common', kelp_fibre: 'common', shell: 'common', scrap_metal: 'common', fish_sample: 'common', sea_glass: 'uncommon',
  coral_chunk: 'uncommon', gear: 'uncommon', pearl: 'rare', circuit_board: 'rare', ancient_stone: 'rare', rare_specimen: 'rare', abyss_crystal: 'epic', golden_scale: 'legendary' };
const FISH_T = [null, null, null, { 'rarity:common': 1 }, { 'rarity:common': 2 }, { 'rarity:uncommon': 2 }, { 'rarity:rare': 1 },
  { 'rarity:rare': 2 }, { 'rarity:epic': 1 }, { 'rarity:epic': 2 }];

function autoCost(branch, tier, wantFish) {
  const items = {};
  const band = tier <= 3 ? 0 : tier <= 6 ? 1 : 2;
  const fl = tier > 1 ? FLAVOUR[branch]?.[band] : null;
  if (fl) items[fl] = FLAVOUR_Q[MAT_RARITY[fl] || 'common'][band] + (tier % 3 === 0 ? 1 : 0) - (tier === 2 ? 1 : 0);
  for (const [k, v] of Object.entries(MAT_T[tier] || {})) items[k] = (items[k] || 0) + v;
  const fish = wantFish && FISH_T[tier] ? { ...FISH_T[tier] } : {};
  return { aero: AERO_T[tier] || 0, items, fish };
}

// ---------------------------------------------------------------- the tree
// n(id, branch, tier, lane, name, icon, req, opts {effect, unlock, cost (merged), fish, time, desc})
const RAW = [];
function n(id, branch, tier, lane, name, icon, req, o = {}) { RAW.push({ id, branch, tier, lane, name, icon, req, ...o }); }
const U = (kind, id) => ({ kind, id });

// root
RAW.push({ id: ROOT_ID, branch: null, tier: 0, lane: 0, name: 'The Lab', icon: 'beaker', req: [], desc: 'Professor Fizz\'s lab. Every discovery grows from here.' });

// ---- Rods (up)
n('hook1', 'rods', 1, 0, 'Sharper Hook', 'hook', [ROOT_ID], { effect: { biteWindow: 1.2 }, desc: 'Bites stay hookable longer.', cost: { aero: 2, items: { driftwood: 1 } }, time: 3 });
n('rod_bubble', 'rods', 2, 0, 'Bubble Wand', 'rod:bubble', ['hook1'], { unlock: [U('rod', 'bubble')], desc: 'A rod that blows bubbles. Faster bites.' });
n('line1', 'rods', 2, 1, 'Braided Line', 'line', ['hook1'], { effect: { lineStrength: 0.15 }, desc: 'Line takes more tension.' });
n('rod_glass', 'rods', 3, 0, 'Glass Rod', 'rod:glass', ['rod_bubble'], { unlock: [U('rod', 'glass')], desc: 'Clear, glossy, bendy. Two shocks.' });
n('rod_bamboo', 'rods', 3, -1, 'Lucky Bamboo', 'rod:bamboo', ['rod_bubble'], { unlock: [U('rod', 'bamboo')], desc: 'Big luck, small everything else.' });
n('hook_lucky', 'rods', 3, 1, 'Lucky Hook', 'star', ['line1'], { effect: { rarityBoost: 1.08, calm: 1.1 }, desc: 'Rare fish a little more often.' });
n('rod_chrome', 'rods', 4, 0, 'Chrome Caster', 'rod:chrome', ['rod_glass'], { unlock: [U('rod', 'chrome')], desc: 'Fast, shiny and strong.' });
n('rod_kelp', 'rods', 4, -1, 'Kelp Whip', 'rod:kelp', ['rod_bamboo'], { unlock: [U('rod', 'kelp')], desc: 'Super forgiving control.' });
n('rod_tune', 'rods', 4, 1, 'Rod Tuning', 'gear', ['hook_lucky'], { effect: { rodLure: 1.08, rodLuck: 1.08, rodControl: 1.05 }, desc: 'Every rod lures faster and luckier.' });
n('rod_dolphin', 'rods', 5, 0, 'Dolphin Spinner', 'rod:dolphin', ['rod_chrome'], { unlock: [U('rod', 'dolphin')], desc: 'The fastest lure in the shallows.' });
n('rod_coral', 'rods', 5, -1, 'Coral Crown', 'rod:coral', ['rod_kelp'], { unlock: [U('rod', 'coral')], desc: 'Keeps your progress when fish fight back.' });
n('rod_aurora', 'rods', 5, 1, 'Aurora Rod', 'rod:aurora', ['rod_tune'], { unlock: [U('rod', 'aurora')], desc: 'Rare fish swoon for it.' });
n('rod_aero', 'rods', 6, 0, 'Aero Carbon', 'rod:aero', ['rod_dolphin'], { unlock: [U('rod', 'aero')], desc: 'Light as a bubble, strong as a dolphin.' });
n('line3', 'rods', 6, -2, 'Titanium Line', 'line', ['rod_coral'], { effect: { lineStrength: 0.25, rodStrength: 1.15 }, desc: 'Rated for whales.' });
n('rod_trident', 'rods', 7, -1, 'Sea King Trident', 'rod:trident', ['rod_aero', 'line3'], { unlock: [U('rod', 'trident')], desc: 'Hauls up giants.' });
n('rod_prism', 'rods', 7, 1, 'Prism Rod', 'rod:prism', ['rod_aero', 'rod_aurora'], { unlock: [U('rod', 'prism')], desc: 'Splits sunlight into luck.' });
n('rod_leviathan', 'rods', 8, 0, 'Leviathan Line', 'rod:leviathan', ['rod_trident'], { unlock: [U('rod', 'leviathan')], desc: 'Unbreakable. Probably.' });
n('rod_aerolite', 'rods', 9, 0, 'Aerolite', 'rod:aerolite', ['rod_leviathan', 'rod_prism'], { unlock: [U('rod', 'aerolite')], desc: 'A falling star on a line. The best rod.', fish: { 'rarity:legendary': 1 } });

// ---- Reel & Shock (up-right)
n('reel1', 'reel', 1, 0, 'Quick Reel', 'reel', [ROOT_ID], { effect: { reelSpeed: 8 }, desc: 'Reel in faster.' });
n('shock1', 'reel', 2, 0, 'Static Spark', 'bolt', ['reel1'], { effect: { shockPower: 1.15 }, desc: 'Your rod\'s zap stuns longer.' });
n('reel2', 'reel', 2, 1, 'Counter Grip', 'mouse', ['reel1'], { effect: { staminaDrain: 1.2, mashPower: 1.25 }, desc: 'Fish tire faster. Clicks hit harder.' });
n('shock2', 'reel', 3, 0, 'Capacitor', 'battery', ['shock1'], { effect: { shockCharges: 1 }, desc: '+1 shock per fight.' });
n('trace1', 'reel', 3, -1, 'Tracer Eyes', 'eye', ['shock1'], { effect: { traceRadius: 1.25, traceForgive: 1.2, netTolerance: 1.2 }, desc: 'Bigger rings when tracing and netting.' });
n('reel3', 'reel', 3, 1, 'Ball Bearings', 'reel', ['reel2'], { effect: { reelSpeed: 12, rodControl: 1.08 }, desc: 'Smooth, speedy reeling.' });
n('shock3', 'reel', 4, 0, 'Quick Recharge', 'bolt', ['shock2'], { effect: { shockCooldown: 0.8 }, desc: 'Shocks recharge faster.' });
n('timing1', 'reel', 4, -1, 'Rhythm Fins', 'music', ['trace1'], { effect: { timingWindow: 1.3, timingMisses: 1, netTime: 1.2 }, desc: 'Wider timing window.' });
n('reel4', 'reel', 4, 1, 'Drag System', 'reel', ['reel3'], { effect: { snapGrace: 0.3, slackGrace: 0.5, rodResilience: 0.05 }, desc: 'More forgiving tension.' });
n('rod_volt', 'reel', 5, 0, 'Voltaic Rod', 'rod:volt', ['shock3'], { unlock: [U('rod', 'volt')], desc: 'Four big zaps per fight.' });
n('dodge1', 'reel', 5, -1, 'Dodge Roll', 'heart', ['timing1'], { effect: { dodgeHits: 1 }, desc: 'One extra hit when dodging.' });
n('autohook1', 'reel', 5, 1, 'Auto-Hook Charm', 'sparkle', ['reel4'], { effect: { autoHook: 0.15 }, desc: '15% chance to hook by itself.' });
n('focus1', 'reel', 6, -1, 'Focus Mode', 'clock', ['dodge1', 'rod_volt'], { effect: { focus: 1 }, desc: 'Hold right mouse to slow time.' });
n('shock4', 'reel', 6, 0, 'Thunder Coil', 'bolt', ['rod_volt'], { effect: { shockPower: 1.3, shockCharges: 1 }, desc: 'Bigger, more frequent zaps.' });
n('reel5', 'reel', 6, 2, 'Overdrive Reel', 'reel', ['autohook1'], { effect: { staminaDrain: 1.3, reelSpeed: 14 }, desc: 'Wear down even legends.' });
n('shock5', 'reel', 7, 1, 'Storm Battery', 'battery', ['shock4', 'reel5'], { effect: { shockCharges: 2, shockCooldown: 0.75, rodResilience: 0.1 }, desc: 'Practically a lightning storm.' });

// ---- Boats (right)
n('boat_dinghy', 'boats', 1, 0, 'Dinghy', 'boat:dinghy', [ROOT_ID], { unlock: [U('boat', 'dinghy')], desc: 'A real little boat. With oars!' });
n('boat_locker', 'boats', 2, 0, 'Bait Locker', 'box', ['boat_dinghy'], { effect: { boxSlots: 1 }, desc: '+1 bait slot.' });
n('boat_magnet', 'boats', 2, 1, 'Deck Magnet', 'magnet', ['boat_dinghy'], { effect: { collectRadius: 4 }, desc: 'Grab Aero from further away.' });
n('boat_skiff', 'boats', 3, 0, 'Skiff', 'boat:skiff', ['boat_locker'], { unlock: [U('boat', 'skiff')], desc: 'Fast, sleek, and very blue.' });
n('boat_winch', 'boats', 3, -1, 'Power Winch', 'reel', ['boat_locker'], { effect: { reelSpeed: 6 }, desc: 'Reel speed boost.' });
n('boat_hydrofoil', 'boats', 4, 0, 'Hydrofoil', 'boat:hydrofoil', ['boat_skiff'], { unlock: [U('boat', 'hydrofoil')], desc: 'Flies over the waves.' });
n('boat_sonar', 'boats', 4, 1, 'Fish Finder', 'sonar', ['boat_skiff'], { effect: { sonar: 1, rarityBoost: 1.04 }, desc: 'Rare fish get a glint.' });
n('boat_yacht', 'boats', 5, 0, 'Aero Yacht', 'boat:yacht', ['boat_hydrofoil'], { unlock: [U('boat', 'yacht')], desc: 'Glossy white and full of style.' });
n('boat_cooler', 'boats', 5, -1, 'Bait Cooler', 'box', ['boat_hydrofoil'], { effect: { boxSlots: 1, baitRadius: 1.05 }, desc: '+1 bait slot, fresher bait.' });
n('boat_catamaran', 'boats', 6, 0, 'Catamaran', 'boat:catamaran', ['boat_yacht'], { unlock: [U('boat', 'catamaran')], desc: 'Two hulls, twice the fun.' });
n('boat_radar', 'boats', 6, 1, 'Weather Radar', 'radar', ['boat_yacht'], { effect: { forecast: 1, collectRadius: 4 }, desc: 'See rare-fish weather coming.' });
n('boat_lights', 'boats', 7, -1, 'Deck Lights', 'lantern', ['boat_catamaran'], { effect: { rarityBoost: 1.06, calm: 1.1 }, desc: 'Night fish love a party boat.' });
n('boat_sub', 'boats', 8, 0, 'Submarine', 'boat:submarine', ['boat_catamaran'], { unlock: [U('boat', 'submarine')], desc: 'Dive with the fish. Bubble windows!' });
n('boat_engine', 'boats', 9, 0, 'Fusion Engine', 'engine', ['boat_sub', 'boat_lights'], { effect: { reelSpeed: 10, boxSlots: 1, collectRadius: 6 }, desc: 'Clean, green, very fast.' });

// ---- Oceans (down-right). Each new ocean wants a few fish caught in the one before it (kept, not in the tank).
n('sea_shallows', 'oceans', 1, 0, 'Sunny Shallows', 'biome:shallows', [ROOT_ID], { unlock: [U('biome', 'shallows')], desc: 'Chart a course to the shallows.', fish: {} });
n('sea_fjord', 'oceans', 2, 0, 'Frosty Fjord', 'biome:fjord', ['sea_shallows'], { unlock: [U('biome', 'fjord')], desc: 'Sail north to the ice.', fish: { 'biome:shallows': 2 } });
n('sea_compass', 'oceans', 2, 1, 'Chrome Compass', 'compass', ['sea_shallows'], { effect: { rarityBoost: 1.04 }, desc: 'Points toward rare fish. Mostly.' });
n('sea_junkyard', 'oceans', 3, 0, 'Junkyard Reef', 'biome:junkyard', ['sea_fjord'], { unlock: [U('biome', 'junkyard')], desc: 'Dive the glitchy scrap reef.', fish: { 'biome:fjord': 2 } });
n('sea_multi', 'oceans', 3, -1, 'Friendly Seas', 'people', ['sea_fjord'], { unlock: [U('feature', 'multiplayer')], desc: 'Fish together with friends.', fish: {} });
n('sea_metropolis', 'oceans', 4, 0, 'Sunken Metropolis', 'biome:metropolis', ['sea_junkyard'], { unlock: [U('biome', 'metropolis')], desc: 'A drowned neon city.', fish: { 'biome:junkyard': 2, 'rarity:uncommon': 1 } });
n('sea_lantern', 'oceans', 4, -1, 'Lantern Hook', 'lantern', ['sea_junkyard'], { effect: { lantern: 1 }, desc: 'Your hook glows in the dark.' });
n('sea_forecast', 'oceans', 4, 1, 'Weather Radio', 'cloud', ['sea_compass'], { effect: { forecast: 1, rarityBoost: 1.03 }, desc: 'Know when rare weather hits.' });
n('sea_volcano', 'oceans', 5, 0, 'Lava Rift', 'biome:volcano', ['sea_metropolis'], { unlock: [U('biome', 'volcano')], desc: 'Brave the volcanic vents.', fish: { 'biome:metropolis': 2, 'rarity:rare': 1 } });
n('sea_sonar', 'oceans', 5, 1, 'Sonar Ping', 'sonar', ['sea_metropolis', 'sea_forecast'], { effect: { sonar: 1, rarityBoost: 1.05 }, desc: 'Rare fish ping back.' });
n('sea_abyss', 'oceans', 6, 0, 'The Deep Ocean', 'biome:abyss', ['sea_volcano', 'sea_lantern'], { unlock: [U('biome', 'abyss')], desc: 'Into the deep dark.', fish: { 'biome:volcano': 2, 'rarity:rare': 1 } });
n('sea_pressure', 'oceans', 7, -1, 'Pressure Suit', 'heart', ['sea_abyss'], { effect: { rodResilience: 0.08, calm: 1.1 }, desc: 'Deep fish fight less dirty.' });
n('sea_legend', 'oceans', 8, 0, 'Legend Hunter', 'crown', ['sea_abyss', 'sea_sonar'], { effect: { rarityBoost: 1.12, shinyChance: 1.25 }, desc: 'Legends sense a worthy angler.', fish: { 'biome:abyss': 2, 'rarity:epic': 1 } });

// ---- Aquarium (down)
n('tank_bowl', 'aquarium', 1, 0, 'Bubble Tank', 'tank:bowl', [ROOT_ID], { unlock: [U('tank', 'bowl')], effect: { tankCap: 1 }, desc: 'Grow your Nano Tank into a roomier Bubble Tank.' });
n('tank_small', 'aquarium', 2, 0, 'Aqua Tank', 'tank:smalltank', ['tank_bowl'], { unlock: [U('tank', 'smalltank')], effect: { tankCap: 2 }, desc: 'Room for more fish.' });
n('tank_feeder', 'aquarium', 2, 1, 'Auto-Feeder', 'food', ['tank_bowl'], { effect: { feeder: 1 }, desc: 'Fish get fed while you work.' });
n('tank_snail', 'aquarium', 3, -1, 'Snail Janitor', 'snail', ['tank_small'], { effect: { autoCollect: 1 }, desc: 'A snail collects Aero for you.' });
n('tank_happy', 'aquarium', 3, 1, 'Happy Water', 'heart', ['tank_feeder'], { effect: { coinMul: 1.2 }, desc: 'Happy fish make more Aero.' });
n('tank_big', 'aquarium', 4, 0, 'Big Tank', 'tank:bigtank', ['tank_small'], { unlock: [U('tank', 'bigtank')], effect: { tankCap: 3 }, desc: 'A big glossy tank.' });
n('tank_romance', 'aquarium', 4, 1, 'Fish Romance', 'heart', ['tank_happy'], { effect: { breeding: 1 }, desc: 'Happy pairs lay eggs.' });
n('tank_crab', 'aquarium', 5, -1, 'Coin Crab', 'crab', ['tank_snail', 'tank_big'], { effect: { autoCollect: 1, collectRadius: 4 }, desc: 'A greedy crab helps collect.' });
n('tank_nursery', 'aquarium', 5, 1, 'Warm Nursery', 'egg', ['tank_romance'], { effect: { hatchSpeed: 1.5 }, desc: 'Eggs hatch faster.' });
n('tank_reef', 'aquarium', 6, 0, 'Reef Tank', 'tank:reeftank', ['tank_big'], { unlock: [U('tank', 'reeftank')], effect: { tankCap: 3, coinMul: 1.1 }, desc: 'Living coral, happy fish.' });
n('tank_mutation', 'aquarium', 6, 2, 'Mutation Lab', 'dna', ['tank_nursery'], { effect: { mutationChance: 0.03 }, desc: 'More mutations.' });
n('tank_currents', 'aquarium', 7, -1, 'Treasure Currents', 'coin', ['tank_reef'], { effect: { coinMul: 1.3, offlineMul: 0.1 }, desc: 'More Aero, even while away.' });
n('tank_sparkle', 'aquarium', 7, 1, 'Sparkle Genes', 'star', ['tank_mutation', 'tank_reef'], { effect: { shinyChance: 1.6 }, desc: 'Shiny fish more often.' });
n('tank_wall', 'aquarium', 8, 0, 'Mega Tank', 'tank:wallaquarium', ['tank_currents'], { unlock: [U('tank', 'wallaquarium')], effect: { tankCap: 6, coinMul: 1.15 }, desc: 'A whole wall of ocean.' });

// ---- Luck & Idle (down-left): luck, idle Aero, lab benches, AppSea internet speed (store/isp.js features)
n('luck1', 'luck', 1, 0, 'Four-Leaf Kelp', 'clover', [ROOT_ID], { effect: { rarityBoost: 1.05 }, desc: 'A little luck for every cast.' });
n('offline1', 'luck', 2, -1, 'Night Shift', 'moon', ['luck1'], { effect: { offlineMul: 0.1 }, desc: 'More Aero while you\'re away.' });
n('lab_slot2', 'luck', 2, 0, 'Second Bench', 'beaker', ['luck1'], { effect: { labSlots: 1 }, desc: 'Research two things at once.', cost: { aero: 120, items: { driftwood: 4, sea_glass: 2 } }, time: 30 });
n('isp2', 'luck', 2, 1, 'Pro Shelf', 'box', ['luck1'], { unlock: [U('feature', 'isp2')], desc: 'Dot stocks better bait at the Bait Shop.' });
n('autocollect', 'luck', 3, -1, 'Auto-Collect', 'magnet', ['offline1'], { unlock: [U('feature', 'autocollect')], effect: { autoCollect: 1, collectRadius: 6 }, desc: 'Aero drops collect themselves.' });
n('luck2', 'luck', 3, 0, 'Lucky Charm', 'horseshoe', ['lab_slot2'], { effect: { rarityBoost: 1.06, crateLuck: 0.1 }, desc: 'Luckier fish and crates.' });
n('isp3', 'luck', 3, 1, 'Ultra Shelf', 'box', ['isp2'], { unlock: [U('feature', 'isp3')], desc: 'Ultra-grade bait on the shelf.' });
n('offline2', 'luck', 4, -1, 'Dream Engine', 'moon', ['autocollect'], { effect: { offlineMul: 0.2, coinMul: 1.1 }, desc: 'Sleep is profitable.' });
n('lab_speed1', 'luck', 4, 0, 'Lab Assistant', 'clock', ['luck2'], { effect: { labSpeed: 1.25 }, desc: 'Research runs faster.' });
n('isp4', 'luck', 4, 1, 'Mega Shelf', 'box', ['isp3'], { unlock: [U('feature', 'isp4')], desc: 'Mega bait for mega fish.' });
n('shiny1', 'luck', 5, 0, 'Sparkle Lens', 'sparkle', ['lab_speed1'], { effect: { shinyChance: 1.4 }, desc: 'Shiny fish more often.' });
n('isp5', 'luck', 5, 1, 'Loyalty Card', 'coin', ['isp4'], { unlock: [U('feature', 'isp5')], desc: 'Bait Shop discounts for regulars.' });
n('lab_slot3', 'luck', 6, -1, 'Third Bench', 'beaker', ['lab_speed1', 'offline2'], { effect: { labSlots: 1, labSpeed: 1.2 }, desc: 'Three experiments at once.' });
n('luck3', 'luck', 6, 0, 'Golden Horseshoe', 'horseshoe', ['shiny1'], { effect: { rarityBoost: 1.1, crateLuck: 0.15 }, desc: 'Rare fish come running.' });
n('isp6', 'luck', 7, 1, 'Express Restock', 'clock', ['isp5', 'luck3'], { unlock: [U('feature', 'isp6')], desc: 'The Bait Shop restocks much faster.' });
n('luck4', 'luck', 9, 0, 'Rainbow Clover', 'rainbow', ['lab_slot3', 'luck3'], { effect: { rarityBoost: 1.15, shinyChance: 1.5, crateLuck: 0.2 }, desc: 'Luck itself, distilled.' });

// ---- Bait (left): bait recipes (crafted on the Lab's crafting bench) + the custom Bait Mixer (store/bait.js)
const BU = (b) => [U('recipe', 'bait_' + b), U('bait', b)];
n('bait_worm', 'bait', 1, 0, 'Worm Farm', 'bait:worm', [ROOT_ID], { unlock: BU('worm'), desc: 'Craft Glowing Worms.' });
n('bait_sugar', 'bait', 2, 0, 'Sugar Rush', 'bait:sugar', ['bait_worm'], { unlock: BU('sugar'), desc: 'Craft Sugar Cubes.' });
n('bait_custom', 'bait', 2, 1, 'Bait Mixer', 'beaker', ['bait_worm'], { unlock: [U('recipe', 'custombait')], desc: 'Mix your own bait: scent, colour, charm.' });
n('bait_chip', 'bait', 3, 0, 'Overclocked Chips', 'bait:chip', ['bait_sugar'], { unlock: BU('chip'), desc: 'Craft chips for techy fish.' });
n('bait_popup', 'bait', 3, -1, 'Pop-up Ads', 'bait:popup', ['bait_sugar'], { unlock: BU('popup'), desc: 'Craft spammy bait.' });
n('bait_slots1', 'bait', 3, 1, 'Bigger Bait Box', 'box', ['bait_custom'], { effect: { boxSlots: 1 }, desc: '+1 bait slot.' });
n('bait_golden', 'bait', 4, 0, 'Golden Bait', 'bait:golden', ['bait_chip'], { unlock: BU('golden'), desc: 'Craft golden bait.' });
n('bait_potent', 'bait', 4, 1, 'Potent Bait', 'sparkle', ['bait_slots1'], { effect: { baitRadius: 1.2 }, desc: 'Bait smell travels further.' });
n('bait_lantern', 'bait', 5, 0, 'Lantern Pearls', 'bait:lantern', ['bait_golden'], { unlock: BU('lantern'), desc: 'Craft glowing deep bait.' });
n('bait_flood', 'bait', 5, -1, 'Flood Gates', 'bait:flood', ['bait_popup', 'bait_golden'], { unlock: BU('flood'), desc: 'Craft Flood Bait.' });
n('bait_slots2', 'bait', 5, 1, 'Bait Box XL', 'box', ['bait_potent'], { effect: { boxSlots: 1, baitRadius: 1.1 }, desc: '+1 bait slot.' });
n('bait_blackhole', 'bait', 6, 0, 'Black Hole Bait', 'bait:blackhole', ['bait_lantern'], { unlock: BU('blackhole'), desc: 'Handle with care.' });
n('bait_relic', 'bait', 7, 0, 'Relic Lore', 'bait:relic', ['bait_blackhole'], { unlock: BU('relic'), desc: 'Summon something ancient.' });
n('bait_master', 'bait', 8, 0, 'Bait Alchemy', 'beaker', ['bait_relic', 'bait_slots2'], { effect: { baitRadius: 1.3, rarityBoost: 1.06, boxSlots: 1 }, desc: 'Bait so good fish write songs.' });

// ---- Crafting (up-left): building blueprints, aquarium decor ('decor_<propId>') and seabed decor plans ('plans_<propId>').
// The recipes themselves (costs, outputs) live in src/build/crafting.js.
export const DECOR_SETS = {
  craft_decor1: { decor: ['rock_small', 'coral_brain', 'coral_branch', 'message_bottle', 'starfish_rock', 'barrel'], plans: ['anchor', 'treasure_chest', 'diver_helmet'] },
  craft_decor2: { decor: ['castle', 'mushroom_house', 'pagoda_lantern', 'tiki_head', 'lava_lamp', 'sandcastle', 'anemone_base', 'coral_fan'], plans: ['castle', 'mushroom_house', 'pagoda_lantern', 'tiki_head'] },
  craft_decor3: { decor: ['pirate_ship', 'moai_head', 'sunken_pc', 'bridge', 'crystal_cluster', 'lava_lamp_galaxy', 'lava_lamp_giant', 'glow_mushroom'], plans: ['pirate_ship', 'moai_head', 'sunken_pc', 'bridge', 'arch_ruin', 'crystal_cluster', 'giant_skull'] },
};
const DU = (set) => [...DECOR_SETS[set].decor.map((d) => U('recipe', 'decor_' + d)), ...DECOR_SETS[set].plans.map((d) => U('recipe', 'plans_' + d))];
n('craft_coral', 'crafting', 1, 0, 'Coral Garden', 'bp:coral_garden', [ROOT_ID], { unlock: [U('recipe', 'bp_coral_garden')], desc: 'Craft a garden that grows materials.' });
n('craft_decor1', 'crafting', 2, -1, 'Cute Decor', 'decor', ['craft_coral'], { unlock: DU('craft_decor1'), desc: 'Craft rocks, corals and treasure.' });
n('craft_shell', 'crafting', 2, 1, 'Shell Shack', 'bp:shell_shack', ['craft_coral'], { unlock: [U('recipe', 'bp_shell_shack')], desc: 'A crab trading post.' });
n('craft_bubble', 'crafting', 3, 0, 'Bubble Tower', 'bp:bubble_tower', ['craft_coral'], { unlock: [U('recipe', 'bp_bubble_tower')], desc: 'Blows Aero bubbles.' });
n('craft_eng1', 'crafting', 3, -2, 'Reinforced Rafters', 'gear', ['craft_decor1'], { unlock: [U('feature', 'eng1')], desc: 'Buildings upgrade to level 2.' });
n('craft_workshop', 'crafting', 4, 1, 'Bait Workshop', 'bp:bait_workshop', ['craft_bubble', 'craft_shell'], { unlock: [U('recipe', 'bp_bait_workshop')], desc: 'Sometimes saves your bait.' });
n('craft_hatchery', 'crafting', 4, 0, 'Fish Hatchery', 'bp:hatchery', ['craft_bubble'], { unlock: [U('recipe', 'bp_hatchery')], desc: 'Lays fish eggs over time.' });
n('craft_decor2', 'crafting', 4, -1, 'Fancy Decor', 'decor', ['craft_decor1'], { unlock: DU('craft_decor2'), desc: 'Castles, lanterns and lava lamps.' });
n('craft_arcade', 'crafting', 5, 0, 'Sunken Arcade', 'bp:arcade', ['craft_hatchery'], { unlock: [U('recipe', 'bp_arcade')], desc: 'Claw machines and luck.' });
n('craft_eng2', 'crafting', 5, -2, 'Titanium Trusses', 'gear', ['craft_eng1', 'craft_decor2'], { unlock: [U('feature', 'eng2')], desc: 'Buildings upgrade to level 3.' });
n('craft_lighthouse', 'crafting', 6, 0, 'Lighthouse', 'bp:lighthouse', ['craft_arcade'], { unlock: [U('recipe', 'bp_lighthouse')], desc: 'Lights the dark, draws night fish.' });
n('craft_decor3', 'crafting', 6, -1, 'Grand Decor', 'decor', ['craft_decor2'], { unlock: DU('craft_decor3'), desc: 'Ships, statues, ruins, crystals.' });
n('craft_vault', 'crafting', 7, -1, 'Treasure Vault', 'bp:vault', ['craft_lighthouse', 'craft_eng2'], { unlock: [U('recipe', 'bp_vault')], desc: 'Aero earns interest.' });
n('craft_totem', 'crafting', 8, 0, 'Totem of Luck', 'bp:totem', ['craft_vault'], { unlock: [U('recipe', 'bp_totem')], desc: 'Rare and shiny odds up.' });

// ---------------------------------------------------------------- [phase6:lab] the row layout (THE LAB skill-tree rows)
// Every node sits in exactly one ROW: a left-to-right chain. A row's first node needs `from` (a node in another row,
// drawn as an elbow connector) or nothing but the Lab itself; every later node needs the one before it.
//   LAB_ROWS: [{id, branch, label, from: nodeId|null, side: 'above'|'below', nodes: [ids]}] in display order (top->bottom)
//   ROW_BY_ID, ROW_OF[nodeId] -> row id; node.row, node.col (index in its row)
export const LAB_ROWS = [];
const row = (id, branch, label, from, side, nodes) => LAB_ROWS.push({ id, branch, label, from, side, nodes });
row('tackle', 'rods', 'Tackle', 'hook1', 'above', ['line1', 'rod_bamboo', 'hook_lucky', 'rod_kelp', 'rod_tune', 'rod_coral', 'rod_aurora', 'line3', 'rod_prism']);
row('rods', 'rods', 'Rods', null, 'below', ['hook1', 'rod_bubble', 'rod_glass', 'rod_chrome', 'rod_dolphin', 'rod_aero', 'rod_trident', 'rod_leviathan', 'rod_aerolite']);
row('reel', 'reel', 'Reel & Shock', null, 'below', ['reel1', 'reel2', 'trace1', 'reel3', 'timing1', 'reel4', 'dodge1', 'autohook1', 'focus1', 'reel5']);
row('shock', 'reel', 'Shock', 'reel1', 'below', ['shock1', 'shock2', 'shock3', 'rod_volt', 'shock4', 'shock5']);
row('deck', 'boats', 'Deck Gear', 'boat_dinghy', 'above', ['boat_locker', 'boat_magnet', 'boat_winch', 'boat_sonar', 'boat_cooler', 'boat_radar', 'boat_lights']);
row('boats', 'boats', 'Boats', null, 'below', ['boat_dinghy', 'boat_skiff', 'boat_hydrofoil', 'boat_yacht', 'boat_catamaran', 'boat_sub', 'boat_engine']);
row('oceans', 'oceans', 'Oceans', null, 'below', ['sea_shallows', 'sea_fjord', 'sea_junkyard', 'sea_metropolis', 'sea_volcano', 'sea_abyss', 'sea_legend']);
row('expedition', 'oceans', 'Expedition', 'sea_fjord', 'below', ['sea_compass', 'sea_multi', 'sea_forecast', 'sea_lantern', 'sea_sonar', 'sea_pressure']);
row('aquarium', 'aquarium', 'Aquarium', null, 'below', ['tank_bowl', 'tank_small', 'tank_snail', 'tank_big', 'tank_crab', 'tank_reef', 'tank_currents', 'tank_wall']);
row('tanklife', 'aquarium', 'Tank Life', 'tank_small', 'below', ['tank_feeder', 'tank_happy', 'tank_romance', 'tank_nursery', 'tank_mutation', 'tank_sparkle']);
row('bait', 'bait', 'Bait', null, 'below', ['bait_worm', 'bait_sugar', 'bait_chip', 'bait_popup', 'bait_golden', 'bait_lantern', 'bait_flood', 'bait_blackhole', 'bait_relic', 'bait_master']);
row('baitlab', 'bait', 'Bait Lab', 'bait_sugar', 'below', ['bait_custom', 'bait_slots1', 'bait_potent', 'bait_slots2']);
row('crafting', 'crafting', 'Crafting', null, 'below', ['craft_coral', 'craft_shell', 'craft_bubble', 'craft_workshop', 'craft_hatchery', 'craft_arcade', 'craft_lighthouse', 'craft_vault', 'craft_totem']);
row('decor', 'crafting', 'Decor', 'craft_shell', 'below', ['craft_decor1', 'craft_eng1', 'craft_decor2', 'craft_eng2', 'craft_decor3']);
row('luck', 'luck', 'Luck & Idle', null, 'below', ['luck1', 'offline1', 'lab_slot2', 'autocollect', 'luck2', 'offline2', 'lab_speed1', 'shiny1', 'lab_slot3', 'luck3', 'luck4']);
row('shop', 'luck', 'Bait Shop', 'luck1', 'below', ['isp2', 'isp3', 'isp4', 'isp5', 'isp6']);
export const ROW_BY_ID = Object.fromEntries(LAB_ROWS.map((r) => [r.id, r]));
export const ROW_OF = {};
{
  const rawById = Object.fromEntries(RAW.map((o) => [o.id, o]));
  for (const r of LAB_ROWS) {
    r.nodes = r.nodes.filter((id) => rawById[id]);
    r.nodes.forEach((id, i) => {
      const o = rawById[id];
      ROW_OF[id] = r.id;
      o.row = r.id; o.col = i; o.branch = r.branch;
      o.req = [i === 0 ? (r.from && rawById[r.from] ? r.from : ROOT_ID) : r.nodes[i - 1]];
    });
  }
  // a node that no row lists still hangs off the Lab itself
  for (const o of RAW) if (o.id !== ROOT_ID && !ROW_OF[o.id]) { o.req = [ROOT_ID]; o.row = null; o.col = 0; }
}

// ---------------------------------------------------------------- [phase7:lab] centre-out layout, costs, times
// The Lab is one tree that grows out of the middle. The root sits at (0,0); every branch is a straight spoke at
// BRANCHES[b].angle (8 spokes, 45 degrees apart). A branch's main row runs along its spoke (lane 0) and its side row
// forks off LAB_FORK degrees clockwise (lane 1), so each spoke reads as a tidy "V". A node's depth (steps from the
// root) puts it on ring LAB_RING(depth), so tiers are evenly spaced circles. Units are tree units (1 = 1 logical px
// at camera zoom 1); LAB_NODE is a node's diameter, LAB_ROOT the root hub's.
//   nd.depth, nd.lane (0 main | 1 side), nd.ang (radians), nd.rad, nd.pos [x, y]; LAB_EXTENT = the outermost ring
// (Reel & Shock and Oceans used to hang off the first rod / boat node; they now start at the root like the rest.)
export const LAB_R1 = 205, LAB_STEP = 96, LAB_FORK = 19, LAB_NODE = 52, LAB_ROOT = 88;
export const LAB_RING = (d) => (d <= 0 ? 0 : LAB_R1 + (d - 1) * LAB_STEP);
const LAYOUT = {};
{
  const rawById = Object.fromEntries(RAW.map((o) => [o.id, o]));
  const depth = (id, seen = 0) => {
    const o = rawById[id];
    if (!o || id === ROOT_ID || seen > 40) return 0;
    if (o.depth !== undefined) return o.depth;
    o.depth = 1 + Math.max(0, ...(o.req || []).map((r) => depth(r, seen + 1)));
    return o.depth;
  };
  for (const o of RAW) {
    const d = depth(o.id);
    const lane = o.row && ROW_BY_ID[o.row]?.from ? 1 : 0;
    const a = o.branch ? ((BRANCHES[o.branch].angle + lane * LAB_FORK) * Math.PI) / 180 : 0;
    const r = LAB_RING(d);
    LAYOUT[o.id] = { depth: d, lane, ang: a, rad: r, pos: [Math.round(Math.cos(a) * r), Math.round(Math.sin(a) * r)] };
  }
}
export const LAB_EXTENT = Math.max(...Object.values(LAYOUT).map((p) => p.rad)) + LAB_NODE;

export const LAB_NODES = RAW.map((o) => {
  const tier = o.tier;
  const unlockNode = !!o.unlock?.some((u) => u.kind !== 'recipe' || tier >= 3);
  const auto = o.branch ? autoCost(o.branch, tier, unlockNode ? tier >= 3 : tier >= 5) : { aero: 0, items: {}, fish: {} };
  const cost = { aero: o.cost?.aero ?? auto.aero, items: { ...(o.cost?.items || auto.items) }, fish: { ...(o.fish || auto.fish) } };
  const { depth, lane, ang, rad, pos } = LAYOUT[o.id];
  return {
    id: o.id, name: o.name, branch: o.branch, tier, depth, lane, ang, rad, pos, req: o.req || [],
    cost, time: o.time ?? (TIME_T[tier] || 0), effect: o.effect || {}, unlock: o.unlock || [], desc: o.desc || '', icon: o.icon || 'beaker',
    row: o.row ?? null, col: o.col ?? 0, // [phase6:lab]
  };
});
export const LAB_BY_ID = Object.fromEntries(LAB_NODES.map((nd) => [nd.id, nd]));
// children lists (for glow paths / "unlocks next")
export const LAB_CHILDREN = {};
for (const nd of LAB_NODES) for (const r of nd.req) (LAB_CHILDREN[r] ||= []).push(nd.id);

// ---------------------------------------------------------------- state
// Marks a node (and everything it needs) researched without paying; applies its unlocks. Used by save migration.
function grantNode(state, id, seen = new Set()) {
  const nd = LAB_BY_ID[id];
  if (!nd || seen.has(id)) return;
  seen.add(id);
  for (const r of nd.req) grantNode(state, r, seen);
  if (state.lab.done[id]) return;
  state.lab.done[id] = Date.now();
  (state.skills ||= {})[id] = true;
  for (const u of nd.unlock) applyUnlock(state, u.kind, u.id);
}

export function ensureLab(state) {
  if (!state || typeof state !== 'object') return { done: {}, unlocks: {}, slots: [], seen: {} };
  const L = (state.lab ||= { done: {}, active: null, unlocks: {} });
  L.done ||= {};
  L.unlocks ||= {};
  if (!Array.isArray(L.slots)) L.slots = L.active ? [L.active] : [];
  L.seen ||= {};
  if (!L.done[ROOT_ID]) L.done[ROOT_ID] = 1;
  if (!L.v) {
    L.v = 1;
    for (const k of STARTER_UNLOCKS) { const [kind, id] = k.split(':'); applyUnlock(state, kind, id); }
    // an existing player keeps the oceans they already reached (fresh saves start in the (OS)cean only)
    if ((state.stats?.caught || 0) > 0) {
      for (const b of state.unlockedBiomes || []) { const nd = nodeFor('biome', b); if (nd && b !== 'shallows') grantNode(state, nd.id); }
    }
  }
  // old skill-tree saves / game.unlockSkill(): ids that match Lab nodes count as researched
  const sk = state.skills;
  if (sk && typeof sk === 'object') {
    for (const id in sk) {
      if (!sk[id] || L.done[id] || !LAB_BY_ID[id]) continue;
      L.done[id] = Date.now();
      for (const u of LAB_BY_ID[id].unlock) applyUnlock(state, u.kind, u.id);
    }
  }
  // oceans that are already open (a default save may start with more than the (OS)cean) count as charted
  for (const b of state.unlockedBiomes || []) {
    const nd = nodeFor('biome', b);
    if (nd && !L.done[nd.id]) { L.done[nd.id] = Date.now(); (state.skills ||= {})[nd.id] = true; for (const u of nd.unlock) applyUnlock(state, u.kind, u.id); }
  }
  L.slots = L.slots.filter((s) => s && LAB_BY_ID[s.id] && !L.done[s.id]);
  if (!Array.isArray(L.queue)) L.queue = []; // [phase6:lab] confirmed (paid) research waiting for a bench
  L.queue = L.queue.filter((q) => q && LAB_BY_ID[q.id] && !L.done[q.id] && !L.slots.some((s) => s.id === q.id));
  L.active = L.slots[0] || null;
  return L;
}

export function labHas(state, id) { return !!ensureLab(state).done[id]; }

export function labStatus(state, id) {
  const L = ensureLab(state);
  if (L.done[id]) return 'done';
  if (L.slots.some((s) => s.id === id) || L.queue.some((q) => q.id === id)) return 'researching'; // queued = paid, waiting
  const nd = LAB_BY_ID[id];
  if (!nd) return 'locked';
  return nd.req.every((r) => L.done[r]) ? 'available' : 'locked';
}

export function unlocked(state, kind, id) { return !!ensureLab(state).unlocks[kind + ':' + id]; }

// The node that unlocks kind:id (first match), or null.
const UNLOCK_INDEX = {};
export function nodeFor(kind, id) {
  if (!Object.keys(UNLOCK_INDEX).length) for (const nd of LAB_NODES) for (const u of nd.unlock) UNLOCK_INDEX[u.kind + ':' + u.id] ||= nd;
  return UNLOCK_INDEX[kind + ':' + id] || null;
}

function applyUnlock(state, kind, id) {
  const L = state.lab;
  L.unlocks[kind + ':' + id] = true;
  if (kind === 'rod') giveRod(state, id);
  else if (kind === 'boat') {
    const i = BOAT_ORDER.indexOf(id);
    state.boat ||= { tier: 0, parts: {} };
    if (i > (state.boat.tier | 0)) state.boat.tier = i;
  } else if (kind === 'tank') {
    const i = TANK_ORDER.indexOf(id);
    state.tank ||= { decor: [], substrate: 'sand', theme: 'reef' };
    if (i > (state.tank.tier | 0) || state.tank.tier === undefined) state.tank.tier = Math.max(0, i);
  } else if (kind === 'biome') {
    state.unlockedBiomes ||= [];
    if (!state.unlockedBiomes.includes(id)) state.unlockedBiomes.push(id);
  } else if (kind === 'cosmetic') (state.cosmetics ||= {})[id] = true;
}

export function grantUnlock(state, kind, id) {
  ensureLab(state);
  applyUnlock(state, kind, id);
}

// Combined effects of every finished node.
export function computeLabStats(state) {
  const L = ensureLab(state);
  const out = {};
  for (const id in L.done) {
    const nd = LAB_BY_ID[id];
    if (!nd) continue;
    for (const [k, v] of Object.entries(nd.effect)) {
      if (MULT_KEYS.has(k)) out[k] = (out[k] ?? 1) * v;
      else out[k] = (out[k] || 0) + v;
    }
  }
  return out;
}

// For ui.open('lab', {focus}): which node to centre on.
export function labFocus(state, key) {
  if (!key) return null;
  if (LAB_BY_ID[key]) return key;
  if (key === 'custombait') return nodeFor('recipe', 'custombait')?.id || null;
  if (key === 'isp') {
    for (const f of ['isp2', 'isp3', 'isp4', 'isp5', 'isp6']) if (!unlocked(state, 'feature', f)) return nodeFor('feature', f)?.id || null;
    return nodeFor('feature', 'isp6')?.id || null;
  }
  if (key.includes(':')) { const [k, id] = key.split(':'); return nodeFor(k, id)?.id || null; }
  return null;
}

// ---------------------------------------------------------------- costs: materials + fish
const matCount = (state, id) => state.inventory?.items?.[id] || 0;

function fishRarity(rec) { return rec.rarity || speciesById(rec.species)?.rarity || 'common'; }
// Normalises a fish cost key; species that no longer exist (the roster gets re-themed) become 'rarity:common'.
export function fishKeyInfo(key) {
  if (key.startsWith('rarity:')) return { kind: 'rarity', id: RARITIES.includes(key.slice(7)) ? key.slice(7) : 'common' };
  if (key.startsWith('biome:')) return { kind: 'biome', id: key.slice(6) };
  const sp = speciesById(key);
  return sp ? { kind: 'species', id: key, sp } : { kind: 'rarity', id: 'common' };
}
function fishMatches(rec, key) {
  const k = fishKeyInfo(key);
  if (k.kind === 'rarity') return RARITIES.indexOf(fishRarity(rec)) >= RARITIES.indexOf(k.id);
  if (k.kind === 'biome') return rec.biome === k.id || (!rec.biome && speciesById(rec.species)?.biome === k.id);
  return rec.species === k.id;
}
// kept fish in the holding bucket (not in the tank)
export function spareFish(state) { return (state.fish || []).filter((f) => f && !f.inTank); }
export function fishHave(state, key) { return spareFish(state).filter((f) => fishMatches(f, key)).length; }
export function fishLabel(key) {
  const k = fishKeyInfo(key);
  if (k.kind === 'rarity') return k.id[0].toUpperCase() + k.id.slice(1) + '+ fish';
  if (k.kind === 'biome') return 'Fish from ' + (OCEAN_NAMES[k.id] || k.id);
  return k.sp?.name || key;
}

export function labSlots(state, stats = null) { return 1 + Math.round(stats?.labSlots ?? computeLabStats(state).labSlots ?? 0); }
export function labTime(state, nd, stats = null) {
  const sp = stats?.labSpeed ?? computeLabStats(state).labSpeed ?? 1;
  return Math.max(1, Math.round((nd?.time || 0) / Math.max(0.1, sp)));
}

export function labCheck(state, nd, stats = null) {
  const L = ensureLab(state);
  const aero = { have: Math.floor(state.coins || 0), need: nd.cost.aero || 0 };
  aero.ok = aero.have >= aero.need;
  const items = Object.entries(nd.cost.items || {}).map(([id, need]) => { const have = matCount(state, id); return { id, have, need, ok: have >= need }; });
  const fish = Object.entries(nd.cost.fish || {}).map(([key, need]) => { const have = fishHave(state, key); return { key, have, need, ok: have >= need }; });
  const reqOk = nd.req.every((r) => L.done[r]);
  const slots = labSlots(state, stats) - L.slots.length;
  const paid = aero.ok && items.every((x) => x.ok) && fish.every((x) => x.ok);
  const ok = reqOk && paid && slots > 0 && !L.done[nd.id] && !L.slots.some((s) => s.id === nd.id) && !L.queue.some((q) => q.id === nd.id);
  return { ok, paid, aero, items, fish, slots, reqOk };
}

// Removes the cheapest matching fish (plain before shiny/mutated, smaller first). Returns the removed records.
function takeFish(state, key, n) {
  const pool = spareFish(state).filter((f) => fishMatches(f, key));
  const score = (f) => RARITIES.indexOf(fishRarity(f)) * 1000 + (f.variant?.shiny ? 500 : 0) + (f.variant?.mutation ? 200 : 0) + (f.sizeCm || 0) * 0.01;
  pool.sort((a, b) => score(a) - score(b));
  const take = pool.slice(0, n);
  state.fish = state.fish.filter((f) => !take.includes(f));
  return take;
}

// ---------------------------------------------------------------- research flow
// Takes a node's Aero, materials and fish; returns the receipt (refunded by cancelResearch).
function payFor(game, nd) {
  const st = game.state;
  const aero = nd.cost.aero || 0;
  st.coins -= aero;
  const paid = { aero, items: { ...nd.cost.items }, fish: [] };
  st.inventory ||= { items: {}, packages: [] };
  st.inventory.items ||= {};
  for (const [mid, q] of Object.entries(nd.cost.items || {})) {
    const inv = st.inventory.items;
    inv[mid] -= q;
    if (inv[mid] <= 0) delete inv[mid];
  }
  for (const [key, q] of Object.entries(nd.cost.fish || {})) paid.fish.push(...takeFish(st, key, q));
  if (paid.fish.length) game.aquarium?.syncFish?.();
  return paid;
}

export function startResearch(game, id) {
  const st = game.state, L = ensureLab(st), nd = LAB_BY_ID[id];
  if (!nd) return { ok: false, reason: 'Unknown research.' };
  const c = labCheck(st, nd, game.stats);
  if (L.done[id]) return { ok: false, reason: 'Already researched.' };
  if (L.slots.some((s) => s.id === id) || L.queue.some((q) => q.id === id)) return { ok: false, reason: 'Already brewing.' };
  if (!c.reqOk) return { ok: false, reason: 'Research the earlier nodes first.' };
  if (c.slots <= 0) return { ok: false, reason: 'All lab benches are busy.' };
  if (!c.ok) return { ok: false, reason: 'Missing ingredients.' };
  const paid = payFor(game, nd);
  const now = Date.now();
  const end = now + labTime(st, nd, game.stats) * 1000; // (labTime may re-run ensureLab, which replaces L.slots)
  L.slots.push({ id, start: now, end, paid });
  L.active = L.slots[0] || null;
  game.emit?.('labStarted', { id });
  game.save?.();
  return { ok: true };
}

export function finishResearch(game, id) {
  const st = game.state, L = ensureLab(st), nd = LAB_BY_ID[id];
  if (!nd || L.done[id]) return false;
  L.slots = L.slots.filter((s) => s.id !== id);
  L.active = L.slots[0] || null;
  L.done[id] = Date.now();
  (st.skills ||= {})[id] = true; // mirrored for older readers of state.skills (map panel, dev pages)
  for (const u of nd.unlock) {
    applyUnlock(st, u.kind, u.id);
    game.emit?.('unlocked', { kind: u.kind, id: u.id });
    if (u.kind === 'boat') game.emit?.('boatUpgraded', st.boat?.tier);
  }
  game.recomputeStats?.();
  game.emit?.('labDone', { id });
  game.emit?.('skill', id);
  game.save?.();
  return true;
}

export function cancelResearch(game, id) {
  const st = game.state, L = ensureLab(st);
  const s = L.slots.find((q) => q.id === id) || L.queue.find((q) => q.id === id);
  if (!s) return false;
  L.slots = L.slots.filter((q) => q !== s);
  L.queue = L.queue.filter((q) => q !== s); // [phase6:lab]
  L.active = L.slots[0] || null;
  refund(st, s.paid);
  // queued research that needed this one can never start now: refund it too
  for (let again = true; again;) {
    again = false;
    for (const q of L.queue.slice()) {
      const nd = LAB_BY_ID[q.id];
      if (nd && nd.req.every((r) => L.done[r] || L.slots.some((x) => x.id === r) || L.queue.some((x) => x.id === r))) continue;
      L.queue = L.queue.filter((x) => x !== q);
      refund(st, q.paid);
      again = true;
    }
  }
  game.save?.();
  return true;
}

function refund(st, p0) {
  const p = p0 || {};
  st.coins += p.aero || 0;
  st.inventory ||= { items: {}, packages: [] };
  st.inventory.items ||= {};
  for (const [mid, q] of Object.entries(p.items || {})) st.inventory.items[mid] = (st.inventory.items[mid] || 0) + q;
  for (const f of p.fish || []) st.fish.push({ ...f, inTank: false });
}

export function labRemaining(state, id, now = Date.now()) {
  const s = ensureLab(state).slots.find((q) => q.id === id);
  return s ? Math.max(0, (s.end - now) / 1000) : 0;
}
export function labProgress(state, id, now = Date.now()) {
  const L = ensureLab(state);
  if (L.done[id]) return 1;
  const s = L.slots.find((q) => q.id === id);
  if (!s) return 0;
  return Math.min(1, Math.max(0, (now - s.start) / Math.max(1, s.end - s.start)));
}

export function instantCost(state, id, now = Date.now()) {
  const nd = LAB_BY_ID[id];
  const rem = labRemaining(state, id, now);
  if (!nd || rem <= 0) return 0;
  const frac = rem / Math.max(1, nd.time);
  return Math.ceil(2 + rem * 0.4 + (nd.cost.aero || 0) * 0.12 * Math.min(1, frac));
}

export function instantFinish(game, id) {
  const st = game.state;
  const c = instantCost(st, id);
  if (!ensureLab(st).slots.some((s) => s.id === id)) return false;
  if ((st.coins || 0) < c) return false;
  st.coins -= c;
  return finishResearch(game, id);
}

export function labTick(game, now = Date.now()) {
  const L = ensureLab(game.state);
  if (!L.slots.length && !L.queue.length) return [];
  const due = L.slots.filter((s) => s.end <= now).map((s) => s.id);
  for (const id of due) finishResearch(game, id);
  pumpQueue(game, now);
  return due;
}

// ---------------------------------------------------------------- [phase6:lab] plans, the queue, quest grants
// The Lab panel queues a PLAN (ids in order) and Confirm pays for all of it. What can start right away takes a bench;
// the rest waits in L.queue (already paid) and starts by itself when a bench frees up and its requirements are done.
//   labQueued(state, id) -> 1-based queue position or 0
//   canPlan(state, id, planned) -> {ok, reason}    (requirements may be done, brewing, queued or earlier in the plan)
//   planCost(state, ids) -> {aero, items:{id:n}, fish:{key:n}}
//   planAfford(state, ids) -> {ok, aero:{have,need,ok}, items:[{id,have,need,ok}], fish:[{key,have,need,ok}]}
//   confirmResearch(game, ids) -> {started:[ids], queued:[ids], failed:[{id, reason}]}
//   grantLabNode(game, id, {reason}) -> bool   free research (quest rewards); also grants what it needs; refunds a
//                                              queued/brewing copy; emits 'unlocked' + 'labDone' {id, free:true}
export function labQueued(state, id) { return ensureLab(state).queue.findIndex((q) => q.id === id) + 1; }

export function canPlan(state, id, planned = []) {
  const L = ensureLab(state), nd = LAB_BY_ID[id];
  if (!nd || id === ROOT_ID) return { ok: false, reason: 'Unknown research.' };
  if (L.done[id]) return { ok: false, reason: 'Already researched.' };
  if (L.slots.some((s) => s.id === id) || L.queue.some((q) => q.id === id)) return { ok: false, reason: 'Already brewing.' };
  if (planned.includes(id)) return { ok: false, reason: 'Already planned.' };
  const ready = (r) => L.done[r] || L.slots.some((s) => s.id === r) || L.queue.some((q) => q.id === r) || planned.includes(r);
  if (!nd.req.every(ready)) return { ok: false, reason: 'Unlock ' + nd.req.filter((r) => !ready(r)).map((r) => LAB_BY_ID[r]?.name || r).join(' + ') + ' first.' };
  return { ok: true };
}

export function planCost(state, ids) {
  const out = { aero: 0, items: {}, fish: {} };
  for (const id of ids) {
    const nd = LAB_BY_ID[id];
    if (!nd) continue;
    out.aero += nd.cost.aero || 0;
    for (const [k, v] of Object.entries(nd.cost.items || {})) out.items[k] = (out.items[k] || 0) + v;
    for (const [k, v] of Object.entries(nd.cost.fish || {})) out.fish[k] = (out.fish[k] || 0) + v;
  }
  return out;
}

export function planAfford(state, ids) {
  const c = planCost(state, ids);
  const aero = { have: Math.floor(state.coins || 0), need: c.aero };
  aero.ok = aero.have >= aero.need;
  const items = Object.entries(c.items).map(([id, need]) => { const have = matCount(state, id); return { id, have, need, ok: have >= need }; });
  const fish = Object.entries(c.fish).map(([key, need]) => { const have = fishHave(state, key); return { key, have, need, ok: have >= need }; });
  return { ok: aero.ok && items.every((x) => x.ok) && fish.every((x) => x.ok), aero, items, fish };
}

export function confirmResearch(game, ids) {
  const st = game.state, L = ensureLab(st);
  const out = { started: [], queued: [], failed: [] };
  for (const id of ids) {
    const nd = LAB_BY_ID[id];
    const p = canPlan(st, id, []);
    if (!nd || !p.ok) { out.failed.push({ id, reason: p.reason }); continue; }
    const c = labCheck(st, nd, game.stats);
    if (!c.paid) { out.failed.push({ id, reason: 'Missing ingredients.' }); continue; }
    const now = Date.now();
    const paid = payFor(game, nd);
    if (c.reqOk && labSlots(st, game.stats) - L.slots.length > 0) {
      const end = now + labTime(st, nd, game.stats) * 1000;
      L.slots.push({ id, start: now, end, paid });
      L.active = L.slots[0] || null;
      out.started.push(id);
      game.emit?.('labStarted', { id });
    } else {
      L.queue.push({ id, paid, at: now });
      out.queued.push(id);
      game.emit?.('labQueued', { id });
    }
  }
  if (out.started.length || out.queued.length) game.save?.();
  return out;
}

function pumpQueue(game, now = Date.now()) {
  const st = game.state, L = ensureLab(st);
  let free = labSlots(st, game.stats) - L.slots.length;
  for (const q of L.queue.slice()) {
    if (free <= 0) break;
    const nd = LAB_BY_ID[q.id];
    if (!nd || L.done[q.id]) { L.queue = L.queue.filter((x) => x !== q); continue; }
    if (!nd.req.every((r) => L.done[r])) continue;
    L.queue = L.queue.filter((x) => x !== q);
    const end = now + labTime(st, nd, game.stats) * 1000;
    L.slots.push({ id: q.id, start: now, end, paid: q.paid });
    L.active = L.slots[0] || null;
    free--;
    game.emit?.('labStarted', { id: q.id, queued: true });
  }
}

export function grantLabNode(game, id, o = {}) {
  const st = game.state, L = ensureLab(st), nd = LAB_BY_ID[id];
  if (!nd || L.done[id]) return false;
  for (const r of nd.req) if (r !== ROOT_ID && !L.done[r]) grantLabNode(game, r, o);
  const s = L.slots.find((q) => q.id === id) || L.queue.find((q) => q.id === id);
  if (s) { L.slots = L.slots.filter((q) => q !== s); L.queue = L.queue.filter((q) => q !== s); refund(st, s.paid); }
  L.active = L.slots[0] || null;
  L.done[id] = Date.now();
  (st.skills ||= {})[id] = true;
  for (const u of nd.unlock) {
    applyUnlock(st, u.kind, u.id);
    game.emit?.('unlocked', { kind: u.kind, id: u.id, free: true });
    if (u.kind === 'boat') game.emit?.('boatUpgraded', st.boat?.tier);
  }
  game.recomputeStats?.();
  game.emit?.('labDone', { id, free: true, reason: o.reason || null });
  game.emit?.('skill', id);
  game.save?.();
  return true;
}

// Which nodes can be researched right now (for badges).
export function labReadyCount(state) {
  const L = ensureLab(state);
  if (labSlots(state) - L.slots.length <= 0) return 0;
  let n = 0;
  for (const nd of LAB_NODES) if (!L.done[nd.id] && labStatus(state, nd.id) === 'available' && labCheck(state, nd).ok) n++;
  return n;
}

// Human readable value for an effect chip.
export function fmtEffect(k, v) {
  const f = EFFECT_INFO[k]?.[2] || 'add';
  if (f === 'mul') return (v >= 1 ? '+' : '') + Math.round((v - 1) * 100) + '%';
  if (f === 'cd') return '-' + Math.round((1 - v) * 100) + '%';
  if (f === 'pct') return '+' + Math.round(v * 100) + '%';
  if (f === 'sec') return '+' + v + 's';
  if (f === 'flag') return 'ON';
  return '+' + v;
}
export function fmtTime(s) {
  s = Math.max(0, Math.ceil(s));
  if (s < 60) return s + 's';
  if (s < 3600) return Math.floor(s / 60) + 'm' + (s % 60 ? ' ' + (s % 60) + 's' : '');
  return Math.floor(s / 3600) + 'h' + (Math.floor((s % 3600) / 60) ? ' ' + Math.floor((s % 3600) / 60) + 'm' : '');
}
