// Quest lines (phase 6, OWNER: Lab+Quests agent). The progression spine: chapters told through the NPCs (Bubbles the
// guide seal, Professor Fizz, Marina, Dot, Captain Bloat). Early quests teach the systems one by one; every chapter
// ends in a milestone that charts the next ocean (a free Lab grant), plus Aero, materials, bait and a cosmetic.
//
//   CHAPTERS [{id, n, title, ocean, giver, intro: [lines], outro: {npc, text}, reward, quests: [quest]}]
//     quest {id, giver, title, text (what the giver says), objectives: [obj], reward}
//     obj   {t: 'catch', n, rarity?, biome?, species?, zone?}   catches after the quest starts
//           {t: 'keep', n} {t: 'release', n} {t: 'bait', n} (Bait Shop buys) {t: 'craft', n} {t: 'equip'} (a rod)
//           {t: 'species', n}  distinct species caught      {t: 'research', n | id}  Lab nodes done (count or one)
//           {t: 'tank', tier}  {t: 'boat', tier}             {t: 'visit', biome}  {t: 'depth', zone, alt: obj}
//           {t: 'aero', n}  Aero earned since the quest started    {t: 'tutorial'}  {t: 'open', panel}
//     reward {aero, items: {matId: n}, bait: {baitId: n}, cosmetics: [wardrobe ids], lab: [node ids], unlock: [{kind, id}]}
//   [phase8:prog] objectives {t: 'chest', n, tier?} (chests cracked open, tier or better) {t: 'have', id, n, take?} (items in
//     the Satchel; take = handed over on completion) {t: 'dest', id} (sailed to the Lab / Workshop) {t: 'craftRod', n | id}
//     (Workshop rods owned) {t: 'rodUp', n} (any rod tuned to n stars) {t: 'tackle', n} (tackle slots filled).
//     reward.unlock [{kind, id}] is applied with lab.grantUnlock (e.g. feature:workshop, recipe:ws_rod_frost).
//   [phase9:fishing] {t: 'boss', id} beat that boss fish (event 'bossDefeated' {id}; src/fish/bosses.js). Every chapter
//     ends with a Boss quest (cN_boss): while it is active (or done) the ocean's boss lurks in its deepest zone.
//   QUEST_BY_ID, ZONES (depth zone order), CHAPTER_BY_ID
//   ensureQuests(state) -> state.quests = {v, ch, started:{qid:{at, coins}}, prog:{qid:[n]}, done:{qid:ts},
//                          chDone:{chId:ts}, visited:{biome:1}, zones:{zone:1}, intro: chId|null, outro: chId|null}
//   class QuestBook (game.quests.book): check(), active(), objectives(q) -> [{label, have, need, ok, icon}],
//     chapter(), events: 'questStarted' {id}, 'questDone' {id}, 'chapterDone' {id, next}
//   rewardList(rw) -> [{key, label, n}] (icon keys for labIcon / uiicons), grantReward(game, rw, at)
// Progress: game events ('caught', 'labDone', 'unlocked', 'tankUpgraded', 'travel', 'tutorialDone', 'depthZone', 'kept', 'released',
// 'baitBought', 'crafted', 'rodEquipped', 'panelOpen', 'boatUpgraded') plus a light poll of the save (oceans, tiers,
// tutorial) and the depth zone (game.ocean.depthZone(), feature-detected; without it depth goals use their `alt`).
import { LAB_BY_ID, OCEAN_NAMES, TANK_NAMES, BOAT_NAMES, BOAT_ORDER, TANK_ORDER, ensureLab, grantLabNode, ROOT_ID, grantUnlock } from './lab.js';
import { ROD_BY_ID, ensureRods } from './rods.js'; // [phase8:prog]
import * as ITEMS from '../build/items.js';
import * as BAIT from '../store/bait.js';
import * as CHAR from '../gfx/character.js';
import * as SPECIES from '../fish/species.js';
import { BOSS_BY_ID } from '../fish/bosses.js'; // [phase9:fishing] boss quests
import { OCEAN_VALUE } from './shopdata.js'; // [balance]

export const ZONES = ['sunlit', 'twilight', 'midnight', 'abyss'];
const CHEST_RANK = ['crate', 'iron', 'golden', 'orb']; // [phase8:prog]
const CHEST_NAMES = { crate: 'Driftwood Crate', iron: 'Iron Crate', golden: 'Golden Chest', orb: 'Mystery Orb' };
export const ZONE_NAMES = { sunlit: 'Sunlit Zone', twilight: 'Twilight Zone', midnight: 'Midnight Zone', abyss: 'Abyssal Zone' };
const RAR = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
const cap = (s) => s[0].toUpperCase() + s.slice(1);

const Q = (id, giver, title, text, objectives, reward) => ({ id, giver, title, text, objectives, reward });
export const CHAPTERS = [
  {
    id: 'ch1', title: 'Splash Down', ocean: 'oscean', giver: 'seal',
    intro: [
      { npc: 'seal', text: 'Welcome to the (OS)cean! I\'m Bubbles. Let\'s turn you into a real angler!' },
      { npc: 'fizz', text: 'And I\'m Professor Fizz! Bring me Aero and I\'ll invent you wonderful things!' },
    ],
    outro: { npc: 'marina', text: 'Ahoy! Marina, pier keeper. My old dinghy is yours - the Sunny Shallows await!' },
    reward: { aero: 80, lab: ['sea_shallows'], cosmetics: ['hat_leafcrown'], unlock: [{ kind: 'recipe', id: 'ws_rod_clover' }] }, // [phase8:prog] + a rod recipe
    quests: [
      Q('c1_lesson', 'seal', 'Fishing 101', 'Hook, reel, shock! I\'ll show you everything.', [{ t: 'tutorial' }], { aero: 10, bait: { crumbs: 5 } }),
      Q('c1_catch', 'seal', 'First Splash', 'Three fish. You can do it!', [{ t: 'catch', n: 3 }], { aero: 15, items: { driftwood: 2 } }),
      Q('c1_keep', 'seal', 'Home Sweet Tank', 'Keep a fish! It makes Aero while you fish.', [{ t: 'keep', n: 1 }], { aero: 10, items: { shell: 2 } }),
      Q('c1_chest', 'seal', 'Crack It Open!', 'There\'s a crate in your Satchel. Tap the glowing knots to crack it!', [{ t: 'chest', n: 1 }], { aero: 10, items: { fish_scale: 3 } }), // [phase8:prog]
      Q('c1_lab', 'fizz', 'Lab Coat On', 'Plan a tile in The Lab, then press Confirm!', [{ t: 'research', n: 1 }], { items: { driftwood: 3, kelp_fibre: 2 } }),
      Q('c1_dex', 'seal', 'FishDex Rookie', 'Every new fish goes in your FishDex.', [{ t: 'species', n: 4 }], { aero: 25 }),
      Q('c1_bowl', 'fizz', 'A Bigger Tank', 'That Nano Tank is cramped. Research the Bubble Tank!', [{ t: 'tank', tier: 1 }], { aero: 30, items: { shell: 3, kelp_fibre: 2 } }),
      Q('c1_boss', 'seal', 'Boss: Turbine Shark', 'Something HUGE spins at the very bottom. Drop your hook into the Abyssal Zone!', [{ t: 'boss', id: 'bruce' }], { aero: 40, items: { fish_scale: 4 } }), // [phase9:fishing]
    ],
  },
  {
    id: 'ch2', title: 'Sunny Shallows', ocean: 'shallows', giver: 'marina',
    intro: [
      { npc: 'marina', text: 'The Shallows are warm, bright and bursting with fish. Hop in the dinghy!' },
      { npc: 'seal', text: 'The Bait Shop is open! Better bait, better fish!' },
    ],
    outro: { npc: 'bloat', text: 'Hrrumph! Captain Bloat. Up north, the Frosty Fjord hides a tale or two...' },
    reward: { aero: 250, lab: ['sea_fjord'], cosmetics: ['top_sailor'], items: { sea_glass: 2 }, unlock: [{ kind: 'recipe', id: 'ws_rod_frost' }] }, // [phase8:prog]
    quests: [
      Q('c2_sail', 'marina', 'Set Sail', 'Open the Map and travel to the Sunny Shallows.', [{ t: 'visit', biome: 'shallows' }], { aero: 20 }),
      Q('c2_catch', 'marina', 'Shallow Waters', 'The shallows are teeming. Fill that bucket!', [{ t: 'catch', n: 6, biome: 'shallows' }], { items: { driftwood: 3, sea_glass: 2 } }),
      Q('c2_workshop', 'marina', 'Marina\'s Workshop', 'My crafting dock is a mess! Bring me 8 Driftwood and 3 Shells to fix it up.', [{ t: 'have', id: 'driftwood', n: 8, take: true }, { t: 'have', id: 'shell', n: 3, take: true }], { aero: 30, items: { fish_scale: 3, kelp_fibre: 2 }, unlock: [{ kind: 'feature', id: 'workshop' }] }), // [phase8:prog]
      Q('c2_bait', 'seal', 'Shop Specials', 'Buy any bait at the Bait Shop. Yum!', [{ t: 'bait', n: 1 }], { bait: { worm: 3 } }),
      Q('c2_dock', 'marina', 'All Aboard!', 'Open the Map and sail to my Workshop dock!', [{ t: 'dest', id: 'workshop' }], { aero: 20, items: { driftwood: 4 } }), // [phase8:prog]
      Q('c2_craftrod', 'marina', 'Your First Rod', 'Craft the Rubber Duck Rod at the Workshop. Squeak!', [{ t: 'craftRod', n: 1 }], { aero: 40, items: { fish_scale: 4, kelp_fibre: 2 } }), // [phase8:prog]
      Q('c2_rare', 'marina', 'Something Shiny', 'Catch an Uncommon fish or better.', [{ t: 'catch', n: 1, rarity: 'uncommon' }], { aero: 40, items: { coral_chunk: 1 } }),
      Q('c2_rod', 'fizz', 'Wand of Bubbles', 'Research the Bubble Wand rod!', [{ t: 'research', id: 'rod_bubble' }], { aero: 30, items: { kelp_fibre: 3 } }),
      Q('c2_deep', 'seal', 'Twilight Peek', 'Dive down past the sunlight. Spooky... and fun!', [{ t: 'depth', zone: 'twilight', alt: { t: 'catch', n: 4 } }], { aero: 40, items: { pearl: 1 } }),
      Q('c2_dinghy', 'marina', 'A Real Boat', 'Research the Dinghy in The Lab. Oars included!', [{ t: 'boat', tier: 1 }], { aero: 30, items: { driftwood: 3, kelp_fibre: 2 } }), // [balance] main-track goal
      Q('c2_boss', 'marina', 'Boss: Dragon-Karp', 'A karp that rage-quit the river lives at the bottom. Beat it!', [{ t: 'boss', id: 'dragonkarp' }], { aero: 80, items: { coral_chunk: 2 } }), // [phase9:fishing]
    ],
  },
  {
    id: 'ch3', title: 'Frosty Fjord', ocean: 'fjord', giver: 'bloat',
    intro: [
      { npc: 'bloat', text: 'In my day we fished the Fjord with nothing but a toothpick and courage!' },
      { npc: 'fizz', text: 'And we have SCIENCE now. Let\'s upgrade everything!' },
    ],
    outro: { npc: 'fizz', text: 'A reef made of scrap and glitches? Fascinating! Junkyard Reef unlocked!' },
    reward: { aero: 700, lab: ['sea_junkyard'], cosmetics: ['face_goggles'], items: { gear: 2, pkg_golden: 1 }, unlock: [{ kind: 'recipe', id: 'ws_rod_magnet' }] }, // [phase8:prog] + a golden chest
    quests: [
      Q('c3_sail', 'bloat', 'Cold Feet', 'Sail to the Frosty Fjord. Bring a scarf.', [{ t: 'visit', biome: 'fjord' }], { aero: 40 }),
      Q('c3_catch', 'bloat', 'Ice Fishing', 'Eight fjord fish, and not one less!', [{ t: 'catch', n: 8, biome: 'fjord' }], { items: { sea_glass: 3, shell: 3 } }),
      Q('c3_tank', 'fizz', 'Tank You Very Much', 'Your fish want a Small Tank.', [{ t: 'tank', tier: 2 }], { aero: 60, items: { coral_chunk: 2 } }),
      Q('c3_rare', 'bloat', 'A Rare Tale', 'Catch a Rare fish. Then you\'ll have a story!', [{ t: 'catch', n: 1, rarity: 'rare' }], { aero: 80, bait: { sugar: 3 } }),
      Q('c3_frost', 'bloat', 'Brr-illiant Rod', 'Craft the Frost Rod. The fjord fish will be chill.', [{ t: 'craftRod', id: 'frost' }], { aero: 80, items: { ice_shard: 2 } }), // [phase8:prog]
      Q('c3_tune', 'marina', 'Fine Tuning', 'Upgrade any rod to one star at the Workshop.', [{ t: 'rodUp', n: 1 }], { aero: 60, items: { fin_ribbon: 2 } }), // [phase8:prog]
      Q('c3_lab', 'fizz', 'Busy Benches', 'Finish 10 research projects in The Lab.', [{ t: 'research', n: 10 }], { items: { gear: 1, kelp_fibre: 4 } }),
      Q('c3_boat', 'marina', 'Sea Legs', 'Upgrade to the Skiff. Zoom zoom!', [{ t: 'boat', tier: 2 }], { aero: 80 }),
      Q('c3_glass', 'fizz', 'Clear Thinking', 'Research the Glass Rod. Two shocks per fight!', [{ t: 'research', id: 'rod_glass' }], { aero: 60, items: { sea_glass: 2, coral_chunk: 2 } }), // [balance] main-track goal
      Q('c3_boss', 'bloat', 'Boss: Ok Boomer Shark', 'Hrrumph! The old shark at the bottom of the Fjord. Show it how it\'s done!', [{ t: 'boss', id: 'eldershark' }], { aero: 150, items: { ice_shard: 2 } }), // [phase9:fishing]
    ],
  },
  {
    id: 'ch4', title: 'Junkyard Reef', ocean: 'junkyard', giver: 'fizz',
    intro: [
      { npc: 'fizz', text: 'Scrap, circuits and glitchy fish! Bring me parts, I bring you gadgets.' },
      { npc: 'seal', text: 'It gets darker down there. Stay close to the bubbles!' },
    ],
    outro: { npc: 'marina', text: 'I found an old chart... a whole city under the sea! Sunken Metropolis unlocked!' },
    reward: { aero: 1800, lab: ['sea_metropolis'], cosmetics: ['shoes_flippers'], items: { circuit_board: 2 }, unlock: [{ kind: 'recipe', id: 'ws_rod_glow' }] }, // [phase8:prog]
    quests: [
      Q('c4_sail', 'fizz', 'Scrap Happy', 'Travel to the Junkyard Reef.', [{ t: 'visit', biome: 'junkyard' }], { aero: 60 }),
      Q('c4_catch', 'fizz', 'Glitch Hunt', 'Ten junkyard fish. Some of them are probably printers.', [{ t: 'catch', n: 10, biome: 'junkyard' }], { items: { scrap_metal: 4, gear: 1 } }),
      Q('c4_dex', 'fizz', 'Field Notes', 'Discover 15 different species.', [{ t: 'species', n: 15 }], { aero: 120 }),
      Q('c4_deep', 'seal', 'Midnight Snack', 'Reach the Midnight Zone. Bring a light!', [{ t: 'depth', zone: 'midnight', alt: { t: 'catch', n: 3, rarity: 'uncommon' } }], { aero: 100, bait: { lantern: 2 } }),
      Q('c4_golden', 'fizz', 'Golden Glitter', 'Crack open a Golden Chest. Lockpicks ready!', [{ t: 'chest', tier: 'golden', n: 1 }], { aero: 150, items: { pkg_iron: 1 } }), // [phase8:prog]
      Q('c4_magnet', 'fizz', 'Magnetic Personality', 'Craft the Magnet Rod. Boxes will come to YOU.', [{ t: 'craftRod', id: 'magnet' }], { aero: 120, items: { spring_coil: 2 } }), // [phase8:prog]
      Q('c4_aero', 'fizz', 'Cha-Ching', 'Earn 3,000 Aero.', [{ t: 'aero', n: 3000 }], { items: { circuit_board: 1 } }),
      Q('c4_shock', 'fizz', 'Shock Therapy', 'Research the Capacitor in the Shock row.', [{ t: 'research', id: 'shock2' }], { aero: 100 }),
      Q('c4_chrome', 'fizz', 'Chrome Dome', 'Research the Chrome Caster. Fast, shiny and strong.', [{ t: 'research', id: 'rod_chrome' }], { aero: 100, items: { gear: 2, pearl: 1 } }), // [balance] main-track goal
      Q('c4_boss', 'fizz', 'Boss: Blue Screen Ray', 'A fatal exception lurks in the deep. ZAP it when it\'s dazed!', [{ t: 'boss', id: 'bsod' }], { aero: 250, items: { circuit_board: 1 } }), // [phase9:fishing]
    ],
  },
  {
    id: 'ch5', title: 'Sunken Metropolis', ocean: 'metropolis', giver: 'marina',
    intro: [
      { npc: 'marina', text: 'Neon lights under the waves! Fish here wear sunglasses. Probably.' },
      { npc: 'bloat', text: 'Epic fish lurk between the towers. Hrrumph, I\'ve seen them!' },
    ],
    outro: { npc: 'bloat', text: 'Feel that heat? The Lava Rift opens! Only the bravest fish there.' },
    reward: { aero: 4500, lab: ['sea_volcano'], cosmetics: ['hat_tophat'], items: { pearl: 2 }, unlock: [{ kind: 'recipe', id: 'ws_rod_turbo' }] }, // [phase8:prog]
    quests: [
      Q('c5_sail', 'marina', 'City Lights', 'Sail to the Sunken Metropolis.', [{ t: 'visit', biome: 'metropolis' }], { aero: 100 }),
      Q('c5_catch', 'marina', 'Rush Hour', 'Catch 10 Metropolis fish.', [{ t: 'catch', n: 10, biome: 'metropolis' }], { items: { circuit_board: 2, gear: 2 } }),
      Q('c5_epic', 'bloat', 'Epic Proportions', 'Catch an Epic fish!', [{ t: 'catch', n: 1, rarity: 'epic' }], { aero: 300, bait: { golden: 1 } }),
      Q('c5_tank', 'fizz', 'Big Tank Energy', 'Upgrade to the Big Tank.', [{ t: 'tank', tier: 3 }], { aero: 200 }),
      Q('c5_glow', 'seal', 'Night Light', 'Craft the Glow Rod for the deep, dark zones.', [{ t: 'craftRod', id: 'glow' }], { aero: 250, items: { glow_bulb: 1 } }), // [phase8:prog]
      Q('c5_boat', 'marina', 'Flying Fish', 'Get the Hydrofoil.', [{ t: 'boat', tier: 3 }], { items: { gear: 2, sea_glass: 3 } }),
      Q('c5_lab', 'fizz', 'Mad Science', 'Finish 30 research projects.', [{ t: 'research', n: 30 }], { aero: 300 }),
      Q('c5_dolphin', 'marina', 'Dolphin Talk', 'Research the Dolphin Spinner. The fish come to chat.', [{ t: 'research', id: 'rod_dolphin' }], { aero: 150, items: { pearl: 2, circuit_board: 1 } }), // [balance] main-track goal
      Q('c5_boss', 'marina', 'Boss: Main Character Marlin', 'The Metropolis has a main character. Hook it from the very bottom!', [{ t: 'boss', id: 'mayorgrouper' }], { aero: 400, items: { pearl: 1 } }), // [phase9:fishing]
    ],
  },
  {
    id: 'ch6', title: 'Lava Rift', ocean: 'volcano', giver: 'bloat',
    intro: [
      { npc: 'bloat', text: 'Lava, vents, and fish that sizzle. Mind your whiskers!' },
      { npc: 'seal', text: 'The deepest zone is down there somewhere. I can smell it!' },
    ],
    outro: { npc: 'seal', text: 'You did it! The Deep Ocean is waiting. The scariest, most beautiful place of all.' },
    reward: { aero: 10000, lab: ['sea_abyss'], cosmetics: ['face_heart'], items: { abyss_crystal: 1, pkg_orb: 1 }, unlock: [{ kind: 'recipe', id: 'ws_rod_starfish' }] }, // [phase8:prog]
    quests: [
      Q('c6_sail', 'bloat', 'Hot Water', 'Brave the Lava Rift.', [{ t: 'visit', biome: 'volcano' }], { aero: 150 }),
      Q('c6_catch', 'bloat', 'Fire and Fins', 'Catch 12 Lava Rift fish.', [{ t: 'catch', n: 12, biome: 'volcano' }], { items: { ancient_stone: 2 } }),
      Q('c6_deep', 'seal', 'Into the Abyss', 'Reach the Abyssal Zone. Deep breath!', [{ t: 'depth', zone: 'abyss', alt: { t: 'catch', n: 2, rarity: 'rare' } }], { aero: 300, bait: { blackhole: 1 } }),
      Q('c6_aero', 'seal', 'Big Spender', 'Earn 15,000 Aero.', [{ t: 'aero', n: 15000 }], { items: { circuit_board: 2, pearl: 1 } }),
      Q('c6_dex', 'fizz', 'Encyclopedia', 'Discover 35 species.', [{ t: 'species', n: 35 }], { aero: 400 }),
      Q('c6_turbo', 'bloat', 'Need for Speed', 'Craft the Turbo Reel Rod. Vroom!', [{ t: 'craftRod', id: 'turbo' }], { aero: 400, items: { lava_glass: 1 } }), // [phase8:prog]
      Q('c6_tackle', 'marina', 'Fully Kitted', 'Fill all four tackle slots on your rod.', [{ t: 'tackle', n: 4 }], { aero: 300, items: { pearl: 1 } }), // [phase8:prog]
      Q('c6_rare', 'bloat', 'Hot Rarities', 'Catch 3 Rare fish in the Lava Rift.', [{ t: 'catch', n: 3, rarity: 'rare', biome: 'volcano' }], { items: { abyss_crystal: 1 } }),
      Q('c6_carbon', 'fizz', 'Featherweight', 'Research the Aero Carbon rod. Light as a bubble!', [{ t: 'research', id: 'rod_aero' }], { aero: 200, items: { circuit_board: 2, ancient_stone: 2 } }), // [balance] main-track goal
      Q('c6_boss', 'bloat', 'Boss: The Final Boss', 'A leviathan of lava at the bottom of the Rift. It is NOT the final boss.', [{ t: 'boss', id: 'moltenleviathan' }], { aero: 700, items: { lava_glass: 2 } }), // [phase9:fishing]
    ],
  },
  {
    id: 'ch7', title: 'The Deep', ocean: 'abyss', giver: 'seal',
    intro: [
      { npc: 'seal', text: 'This is it. The Deep Ocean. Glowing eyes everywhere... stay brave!' },
      { npc: 'bloat', text: 'They say a legend sleeps at the bottom. Hrrumph. Find it.' },
    ],
    outro: { npc: 'fizz', text: 'A true Legend Hunter! I\'ve never been so proud. More adventures soon!' },
    reward: { aero: 20000, lab: ['sea_legend'], cosmetics: ['trail_rainbow'], items: { golden_scale: 1 } },
    quests: [
      Q('c7_sail', 'seal', 'Lights Out', 'Dive into The Deep Ocean.', [{ t: 'visit', biome: 'abyss' }], { aero: 300 }),
      Q('c7_catch', 'bloat', 'Deep Haul', 'Catch 12 fish in The Deep.', [{ t: 'catch', n: 12, biome: 'abyss' }], { items: { abyss_crystal: 2 } }),
      Q('c7_legend', 'bloat', 'The Legend', 'Catch a Legendary fish.', [{ t: 'catch', n: 1, rarity: 'legendary' }], { aero: 1500, items: { golden_scale: 1 } }),
      Q('c7_lab', 'fizz', 'Nobel Bubble Prize', 'Finish 60 research projects.', [{ t: 'research', n: 60 }], { aero: 800 }),
      Q('c7_dex', 'seal', 'Know Them All', 'Discover 50 species.', [{ t: 'species', n: 50 }], { aero: 800 }),
      Q('c7_sub', 'marina', 'Yellow Submarine', 'Build the Submarine.', [{ t: 'boat', tier: 6 }], { aero: 600 }),
      Q('c7_orb', 'fizz', 'Orb of Mystery', 'Crack open a Mystery Orb.', [{ t: 'chest', tier: 'orb', n: 1 }], { aero: 500 }), // [phase8:prog]
      Q('c7_star', 'seal', 'Wish Upon a Starfish', 'Craft the Starfish Scepter.', [{ t: 'craftRod', id: 'starfish' }], { aero: 1000 }), // [phase8:prog]
      Q('c7_trident', 'bloat', 'Sea King', 'Research the Sea King Trident. Giants beware!', [{ t: 'research', id: 'rod_trident' }], { aero: 250, items: { abyss_crystal: 2, ancient_stone: 2 } }), // [balance] main-track goal
      Q('c7_boss', 'seal', 'Boss: The Algorithm', 'It has watched you all along. Face it at the bottom of The Deep!', [{ t: 'boss', id: 'manyeyes' }], { aero: 1500, items: { golden_scale: 1 } }), // [phase9:fishing]
    ],
  },
];
CHAPTERS.forEach((c, i) => { c.n = i + 1; });
// [balance] quest Aero rewards scale with the chapter ocean's fish value (shopdata OCEAN_VALUE), like the Lab prices
// they help pay for. Chapter rewards (the milestones) are set by hand above.
for (const c of CHAPTERS) {
  const k = OCEAN_VALUE[c.ocean] || 1;
  for (const q of c.quests) if (q.reward?.aero && k !== 1) q.reward.aero = Math.round((q.reward.aero * k) / 5) * 5;
}
export const CHAPTER_BY_ID = Object.fromEntries(CHAPTERS.map((c) => [c.id, c]));
export const QUEST_BY_ID = {};
for (const c of CHAPTERS) for (const q of c.quests) { q.chapter = c.id; QUEST_BY_ID[q.id] = q; }
const ACTIVE_MAX = 3;

export const NPC_NAMES = { seal: 'Bubbles', fizz: 'Professor Fizz', marina: 'Marina', dot: 'Dot', bloat: 'Captain Bloat' };

// ---------------------------------------------------------------- save
export function ensureQuests(state) {
  const S = (state.quests ||= {});
  S.v ||= 1;
  if (!Number.isInteger(S.ch) || S.ch < 0) S.ch = 0;
  S.ch = Math.min(S.ch, CHAPTERS.length);
  S.started ||= {}; S.prog ||= {}; S.done ||= {}; S.chDone ||= {}; S.visited ||= {}; S.zones ||= {};
  S.dests ||= {}; // [phase8:prog] destinations sailed to
  if (S.intro === undefined) S.intro = CHAPTERS[0].id;
  if (S.outro === undefined) S.outro = null;
  return S;
}

// ---------------------------------------------------------------- labels and icons
const speciesName = (id) => { try { return SPECIES.SPECIES_BY_ID?.[id]?.name || id; } catch { return id; } };
export function objLabel(o) {
  switch (o.t) {
    case 'catch': {
      const what = o.species ? speciesName(o.species) : o.rarity ? `${cap(o.rarity)}+ fish` : 'fish';
      const n = o.species || o.rarity ? (o.n > 1 ? o.n + ' ' : 'a' + (/^[AEIOU]/i.test(what) ? 'n ' : ' ')) : o.n + ' ';
      return `Catch ${n}${what}${o.biome ? ' in ' + (OCEAN_NAMES[o.biome] || o.biome) : ''}${o.zone ? ' (' + (ZONE_NAMES[o.zone] || o.zone) + ')' : ''}`;
    }
    case 'keep': return o.n > 1 ? `Keep ${o.n} fish in your tank` : 'Keep a fish in your tank';
    case 'release': return `Release ${o.n} fish`;
    case 'bait': return o.n > 1 ? `Buy ${o.n} bait packs` : 'Buy bait at the Bait Shop';
    case 'craft': return `Craft ${o.n} thing${o.n > 1 ? 's' : ''}`;
    case 'equip': return 'Equip a new rod';
    case 'species': return `Discover ${o.n} species`;
    case 'research': return o.id ? `Research ${LAB_BY_ID[o.id]?.name || o.id}` : o.n > 1 ? `Finish ${o.n} research projects` : 'Finish a research project';
    case 'tank': return `Upgrade to the ${TANK_NAMES[TANK_ORDER[o.tier]] || 'next tank'}`;
    case 'boat': return `Get the ${BOAT_NAMES[BOAT_ORDER[o.tier]] || 'next boat'}`;
    case 'visit': return `Visit ${OCEAN_NAMES[o.biome] || o.biome}`;
    case 'depth': return `Reach the ${ZONE_NAMES[o.zone] || o.zone}`;
    case 'aero': return `Earn ${o.n.toLocaleString('en-US')} Aero`;
    case 'tutorial': return 'Finish Bubbles\' fishing lesson';
    case 'open': return `Open the ${o.panel}`;
    case 'chest': return o.tier ? `Crack open a ${CHEST_NAMES[o.tier] || o.tier}` : o.n > 1 ? `Crack open ${o.n} chests` : 'Crack open a chest'; // [phase8:prog]
    case 'have': return `Bring ${o.n} ${ITEMS.ITEMS?.[o.id]?.name || o.id}`;
    case 'dest': return `Sail to ${o.id === 'lab' ? 'Fizz Lab Island' : 'Marina\'s Workshop'}`;
    case 'craftRod': return o.id ? `Craft the ${ROD_BY_ID[o.id]?.name || o.id}` : o.n > 1 ? `Craft ${o.n} rods at the Workshop` : 'Craft a rod at the Workshop';
    case 'rodUp': return `Upgrade a rod to ${o.n} star${o.n > 1 ? 's' : ''}`;
    case 'tackle': return `Equip ${o.n} pieces of tackle`;
    case 'boss': return `Defeat the boss: ${BOSS_BY_ID[o.id]?.title || 'a boss'}`; // [phase9:fishing]
    default: return o.t;
  }
}
export function objIcon(o) {
  switch (o.t) {
    case 'catch': return o.biome ? 'biome:' + o.biome : 'hook';
    case 'keep': return 'tank:jar';
    case 'species': return 'eye';
    case 'research': return o.id ? LAB_BY_ID[o.id]?.icon || 'beaker' : 'beaker';
    case 'tank': return 'tank:' + (TANK_ORDER[o.tier] || 'bowl');
    case 'boat': return 'boat:' + (BOAT_ORDER[o.tier] || 'dinghy');
    case 'visit': return 'biome:' + o.biome;
    case 'depth': return 'sonar';
    case 'aero': return 'coin';
    case 'bait': return 'bait:worm';
    case 'tutorial': return 'hook';
    case 'chest': return 'mat:pkg_' + (o.tier || 'crate'); // [phase8:prog]
    case 'have': return 'mat:' + o.id;
    case 'dest': return o.id === 'lab' ? 'beaker' : 'hammer';
    case 'craftRod': return o.id ? 'rod:' + o.id : 'rod:duck';
    case 'rodUp': case 'tackle': return 'hammer';
    case 'boss': return 'fish:' + (o.id || 'bruce'); // [phase9:fishing]
    default: return 'star';
  }
}

export function rewardList(rw = {}) {
  const out = [];
  if (rw.aero) out.push({ key: 'aero', label: rw.aero.toLocaleString('en-US') + ' Aero', n: rw.aero });
  for (const id of rw.lab || []) {
    const nd = LAB_BY_ID[id];
    const biome = nd?.unlock?.find((u) => u.kind === 'biome')?.id;
    out.push({ key: nd?.icon || 'beaker', label: biome ? 'New ocean: ' + (OCEAN_NAMES[biome] || biome) : 'Lab: ' + (nd?.name || id), big: !!biome });
  }
  for (const [id, n] of Object.entries(rw.items || {})) out.push({ key: 'mat:' + id, label: `${n} ${ITEMS.ITEMS?.[id]?.name || id}`, n });
  for (const [id, n] of Object.entries(rw.bait || {})) out.push({ key: 'bait:' + id, label: `${n} ${BAIT.BAITS?.[id]?.name || id}`, n });
  for (const id of rw.cosmetics || []) out.push({ key: 'cosmetic:' + id, label: CHAR.WARDROBE_BY_ID?.[id]?.name || id, cosmetic: id });
  for (const u of rw.unlock || []) { // [phase8:prog] readable unlock rewards
    if (u.kind === 'recipe' && u.id.startsWith('ws_rod_')) out.push({ key: 'rod:' + u.id.slice(7), label: 'New rod recipe: ' + (ROD_BY_ID[u.id.slice(7)]?.name || u.id), big: true });
    else if (u.kind === 'feature' && u.id === 'workshop') out.push({ key: 'hammer', label: 'Marina\'s Workshop opens!', big: true });
    else out.push({ key: u.kind + ':' + u.id, label: u.id });
  }
  return out;
}

export function grantReward(game, rw = {}, reason = 'quest') {
  const st = game.state;
  let bonus = 0;
  for (const id of rw.lab || []) {
    const nd = LAB_BY_ID[id];
    if (!nd) continue;
    // already researched: Fizz pays you back in Aero instead
    if (ensureLab(st).done[id]) bonus += Math.round(20 + (nd.cost.aero || 0) * 0.5);
    else grantLabNode(game, id, { reason });
  }
  const aero = (rw.aero || 0) + bonus;
  if (aero) {
    const W = game.screen?.W || 960;
    if (typeof game.addCoins === 'function') game.addCoins(aero, W / 2, 70); else { st.coins = (st.coins || 0) + aero; st.totalCoins = (st.totalCoins || 0) + aero; }
  }
  for (const [id, n] of Object.entries(rw.items || {})) { try { ITEMS.addItem(st, id, n); } catch { /* items not ready */ } }
  for (const [id, n] of Object.entries(rw.bait || {})) { try { BAIT.ensureBait?.(st); BAIT.addBait(st, id, n); } catch { /* bait not ready */ } }
  for (const id of rw.cosmetics || []) { try { if (!CHAR.grantCosmetic?.(st, id)) (st.cosmetics ||= {})[id] = true; } catch { (st.cosmetics ||= {})[id] = true; } }
  for (const u of rw.unlock || []) { try { grantUnlock(st, u.kind, u.id); game.emit?.('unlocked', { kind: u.kind, id: u.id, free: true }); } catch { /* ignore */ } } // [phase8:prog] applied, not just announced
  game.recomputeStats?.();
  return { bonus };
}

// ---------------------------------------------------------------- the engine
export class QuestBook {
  constructor(game) {
    this.game = game;
    this.pollT = 0;
    this.listeners = [];
    this.wire();
  }

  get S() { return ensureQuests(this.game.state); }
  chapter() { return CHAPTERS[this.S.ch] || null; }
  isDone(id) { return !!this.S.done[id]; }

  // the first few unfinished quests of the current chapter (in order)
  active() {
    const c = this.chapter();
    if (!c) return [];
    return c.quests.filter((q) => !this.S.done[q.id]).slice(0, ACTIVE_MAX);
  }
  isActive(id) { return this.active().some((q) => q.id === id); }
  isLocked(id) { const q = QUEST_BY_ID[id]; if (!q) return true; const ci = CHAPTERS.findIndex((c) => c.id === q.chapter); return ci > this.S.ch || (ci === this.S.ch && !this.isDone(id) && !this.isActive(id)); }

  depthApi() { return typeof this.game.ocean?.depthZone === 'function'; }
  // depth goals fall back to their `alt` objective while the oceans have no depth zones
  realObj(o) { return o.t === 'depth' && !this.depthApi() && o.alt ? o.alt : o; }

  start(q) {
    const S = this.S;
    if (S.started[q.id]) return;
    S.started[q.id] = { at: Date.now(), coins: this.game.state.totalCoins || 0 };
    S.prog[q.id] = q.objectives.map(() => 0);
    this.game.emit?.('questStarted', { id: q.id });
  }

  // progress of one objective: {have, need}
  measure(q, i) {
    const st = this.game.state, S = this.S;
    const o = this.realObj(q.objectives[i]);
    const cnt = S.prog[q.id]?.[i] || 0;
    const L = ensureLab(st);
    switch (o.t) {
      case 'catch': case 'keep': case 'release': case 'bait': case 'craft': case 'equip': case 'open': return { have: cnt, need: o.n || 1 };
      case 'species': { let n = 0; for (const id in st.journal || {}) if (st.journal[id]?.caught > 0) n++; return { have: n, need: o.n }; }
      case 'research': {
        if (o.id) return { have: L.done[o.id] ? 1 : 0, need: 1 };
        return { have: Object.keys(L.done).filter((id) => id !== ROOT_ID && LAB_BY_ID[id]).length, need: o.n || 1 };
      }
      case 'tank': return { have: Math.min(o.tier, st.tank?.tier | 0), need: o.tier };
      case 'boat': return { have: Math.min(o.tier, st.boat?.tier | 0), need: o.tier };
      case 'visit': return { have: S.visited[o.biome] || st.biome === o.biome && this.game.ocean?.biome?.id === o.biome ? 1 : 0, need: 1 };
      case 'depth': return { have: S.zones[o.zone] || ZONES.indexOf(o.zone) <= this.maxZone() ? 1 : 0, need: 1 };
      case 'aero': return { have: Math.max(0, Math.min(o.n, (st.totalCoins || 0) - (S.started[q.id]?.coins ?? st.totalCoins ?? 0))), need: o.n };
      case 'tutorial': return { have: st.tutorialDone ? 1 : 0, need: 1 };
      // [phase8:prog] Workshop, chests, destinations
      case 'chest': return { have: cnt, need: o.n || 1 };
      case 'have': return { have: Math.min(o.n, ITEMS.countItem?.(st, o.id) || 0), need: o.n };
      case 'dest': return { have: S.dests?.[o.id] ? 1 : 0, need: 1 };
      case 'craftRod': {
        const R = ensureRods(st);
        if (o.id) return { have: R.owned.includes(o.id) ? 1 : 0, need: 1 };
        return { have: R.owned.filter((id) => ROD_BY_ID[id]?.src === 'workshop').length, need: o.n || 1 };
      }
      case 'rodUp': { const R = ensureRods(st); return { have: Math.min(o.n, Math.max(0, ...R.owned.map((id) => R.lv[id] | 0))), need: o.n }; }
      case 'tackle': { const R = ensureRods(st); return { have: Object.values(R.tackle.on).filter(Boolean).length, need: o.n }; }
      case 'boss': return { have: cnt || st.bosses?.won?.[o.id] ? 1 : 0, need: 1 }; // [phase9:fishing]
      default: return { have: 0, need: 1 };
    }
  }
  maxZone() { let m = -1; for (const z in this.S.zones) m = Math.max(m, ZONES.indexOf(z)); return m; }

  objectives(q) {
    return q.objectives.map((o0, i) => {
      const o = this.realObj(o0);
      const m = this.isDone(q.id) ? { have: 1, need: 1 } : this.measure(q, i);
      const ok = this.isDone(q.id) || m.have >= m.need;
      return { label: objLabel(o), icon: objIcon(o), have: Math.min(m.have, m.need), need: m.need, ok, obj: o };
    });
  }

  bump(pred, by = 1) {
    let any = false;
    for (const q of this.active()) {
      this.start(q);
      q.objectives.forEach((o0, i) => {
        const o = this.realObj(o0);
        if (pred(o)) { this.S.prog[q.id][i] = (this.S.prog[q.id][i] || 0) + by; any = true; }
      });
    }
    if (any) this.check();
  }

  wire() {
    const g = this.game;
    const on = (ev, fn) => { g.on?.(ev, fn); };
    on('caught', (d) => {
      const rec = d?.rec || {}, sp = d?.sp || {};
      const rar = RAR.indexOf(rec.rarity || sp.rarity || 'common');
      const biome = rec.biome || g.ocean?.biome?.id;
      let zone = rec.zone ?? d?.zone ?? null;
      if (!zone && this.depthApi()) { try { zone = zoneId(g.ocean.depthZone()); } catch { zone = null; } }
      this.bump((o) => o.t === 'catch' && (!o.rarity || rar >= RAR.indexOf(o.rarity)) && (!o.biome || o.biome === biome) && (!o.species || o.species === sp.id) && (!o.zone || ZONES.indexOf(zone) >= ZONES.indexOf(o.zone)));
    });
    on('kept', () => this.bump((o) => o.t === 'keep'));
    on('released', () => this.bump((o) => o.t === 'release'));
    on('baitBought', (d) => { if (!d?.gift) this.bump((o) => o.t === 'bait'); });
    on('crafted', () => this.bump((o) => o.t === 'craft'));
    on('baitCrafted', () => this.bump((o) => o.t === 'craft'));
    on('rodEquipped', () => this.bump((o) => o.t === 'equip'));
    on('panelOpen', (id) => this.bump((o) => o.t === 'open' && o.panel === id));
    on('chestOpened', (d) => { const r = CHEST_RANK.indexOf(d?.tier); this.bump((o) => o.t === 'chest' && (!o.tier || r >= CHEST_RANK.indexOf(o.tier))); }); // [phase8:prog]
    on('bossDefeated', (d) => this.bump((o) => o.t === 'boss' && (!o.id || o.id === d?.id))); // [phase9:fishing]
    on('destVisit', (d) => { if (d?.id) { this.S.dests[d.id] = 1; this.check(); } });
    for (const ev of ['rodCrafted', 'rodUpgraded', 'tackleEquipped', 'crafted']) on(ev, () => this.check());
    on('travel', (d) => { const id = typeof d === 'string' ? d : d?.to || d?.id || d?.biome; if (id) this.S.visited[id] = 1; this.check(); });
    on('depthZone', (d) => { const z = zoneId(d); if (z) { this.S.zones[z] = 1; this.check(); } }); // the Oceans agent's zone changes
    for (const ev of ['labDone', 'unlocked', 'tankUpgraded', 'tutorialDone', 'boatUpgraded']) on(ev, () => this.check());
  }

  // light poll: oceans, depth, absolute goals
  update(dt) {
    this.pollT -= dt;
    if (this.pollT > 0) return;
    this.pollT = 0.5;
    const g = this.game, S = this.S;
    const here = g.ocean?.biome?.id;
    if (here && !g.ocean?.travelState && g.state.view !== 'aquarium' && here === g.state.biome) S.visited[here] = 1;
    if (this.depthApi()) { try { const z = zoneId(g.ocean.depthZone()); if (z && ZONES.includes(z)) S.zones[z] = 1; } catch { /* ignore */ } }
    this.check();
  }

  check() {
    const g = this.game, S = this.S;
    const c = this.chapter();
    if (!c) return;
    for (const q of this.active()) {
      this.start(q);
      if (q.objectives.every((_, i) => { const m = this.measure(q, i); return m.have >= m.need; })) this.complete(q);
    }
    if (c.quests.every((q) => S.done[q.id]) && !S.chDone[c.id]) {
      S.chDone[c.id] = Date.now();
      const r = grantReward(g, c.reward, 'chapter');
      S.ch++;
      S.outro = c.id;
      S.intro = CHAPTERS[S.ch]?.id || null;
      g.emit?.('chapterDone', { id: c.id, next: S.intro, bonus: r.bonus });
      g.save?.();
      // the next chapter's first quests may already be satisfied
      setTimeout(() => this.check(), 50);
    }
  }

  complete(q) {
    const g = this.game, S = this.S;
    if (S.done[q.id]) return;
    S.done[q.id] = Date.now();
    for (const o of q.objectives) if (o.t === 'have' && o.take) { try { ITEMS.removeItem?.(g.state, o.id, o.n); } catch { /* ignore */ } } // [phase8:prog] hand the items over
    const r = grantReward(g, q.reward, 'quest');
    g.emit?.('questDone', { id: q.id, bonus: r.bonus });
    g.save?.();
  }

  // dev / test helper: finish the current chapter's quests right now
  debugFinishChapter() { const c = this.chapter(); if (!c) return; for (const q of c.quests) this.complete(q); this.check(); }
}

export function zoneId(z) {
  if (z === null || z === undefined) return null;
  if (typeof z === 'number') return ZONES[Math.max(0, Math.min(ZONES.length - 1, z))];
  const s = String(typeof z === 'object' ? z.id ?? z.name ?? z.zone ?? '' : z).toLowerCase();
  return ZONES.find((k) => s.includes(k)) || (s.includes('abyss') ? 'abyss' : null);
}

void RAR;
