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
//   [quests16] Side stories (questdata.js SIDE_STORIES, chapter.side, kind 'side'), milestones (MILESTONES, kind 'mile')
//     and "Today's orders" (kind 'order' + the board bonus 'orderBonus', S.daily) are CLAIMED: when their objectives are
//     met they become ready (S.ready[id], event 'questReady' {ids}) and book.claim(id) pays the reward (event
//     'questDone' {id, claimed: true}). Main chapter quests (kind 'main') still complete by themselves.
//     New objectives: catch filters (weather, time, bait, trophy, giant, shiny, mutant, flawless, party), zap, feed,
//     build, hatch, evolve, collect, tankFish, gearLv, dress, box, labDone, online, total {k}, ordersToday,
//     species {biome}, craft {cat}. Lifetime counters live in S.life. PERFECT / bad zaps come from a 'shockFired'
//     {grade} game event that QuestBook adds by wrapping game.fishing.onShockFire / onBackfire (no fishing edits).
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

import { SIDE_STORIES, MILESTONES, MILESTONE_LINES, ORDER_POOL, DAILY_AERO, ORDER_MATS } from './questdata.js'; // [quests16]
import { gearLevel, GEAR_BY_ID } from '../aquarium/tanks.js'; // [quests16] tank gear goals
import { RNG } from '../core/rng.js'; // [quests16] the daily order board's seed

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
// [quests16] every chapter carries its side stories (optional, claimed; the main line still opens the next ocean)
for (const c of CHAPTERS) {
  c.side = SIDE_STORIES[c.id] || [];
  for (const q of c.quests) q.kind = 'main';
  for (const q of c.side) q.kind = 'side';
}
// [balance] quest Aero rewards scale with the chapter ocean's fish value (shopdata OCEAN_VALUE), like the Lab prices
// they help pay for. Chapter rewards (the milestones) are set by hand above.
for (const c of CHAPTERS) {
  const k = OCEAN_VALUE[c.ocean] || 1;
  for (const q of [...c.quests, ...c.side]) if (q.reward?.aero && k !== 1) q.reward.aero = Math.round((q.reward.aero * k) / 5) * 5;
}
export const CHAPTER_BY_ID = Object.fromEntries(CHAPTERS.map((c) => [c.id, c]));
export const QUEST_BY_ID = {};
for (const c of CHAPTERS) for (const q of [...c.quests, ...c.side]) { q.chapter = c.id; QUEST_BY_ID[q.id] = q; }
for (const q of MILESTONES) { q.kind = 'mile'; q.chapter = null; QUEST_BY_ID[q.id] = q; }
export { MILESTONES, MILESTONE_LINES };
export const MILESTONE_BY_LINE = {};
for (const q of MILESTONES) (MILESTONE_BY_LINE[q.line] ||= []).push(q);
for (const l in MILESTONE_BY_LINE) MILESTONE_BY_LINE[l].sort((a, b) => a.tier - b.tier);
export const STORY_QUESTS = CHAPTERS.flatMap((c) => [...c.quests, ...c.side]);
const ACTIVE_MAX = 3;
export const ORDERS_PER_DAY = 3;

export const NPC_NAMES = { seal: 'Bubbles', fizz: 'Professor Fizz', marina: 'Marina', dot: 'Dot', bloat: 'Captain Bloat' };
export const isClaimable = (q) => !!q && q.kind !== 'main';

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
  // [quests16] claims, lifetime counters, the order board, the pinned quest
  if (!S.ready || typeof S.ready !== 'object') S.ready = {};
  if (!S.life || typeof S.life !== 'object') S.life = {};
  if (!S.flags || typeof S.flags !== 'object') S.flags = {};
  if (S.pin === undefined) S.pin = null;
  if (!S.daily || typeof S.daily !== 'object' || !Array.isArray(S.daily.list)) S.daily = { day: null, next: 0, list: [], swaps: 1 };
  if (S.v < 2) {
    // older saves: seed the lifetime counters we can rebuild from the FishDex (shinies, mutations seen)
    S.v = 2;
    let shiny = 0, mutant = 0;
    for (const id in state.journal || {}) { const v = state.journal[id]?.variants || {}; if (v.shiny) shiny++; for (const k in v) if (k !== 'shiny') mutant++; }
    S.life.shiny = Math.max(S.life.shiny | 0, shiny);
    S.life.mutant = Math.max(S.life.mutant | 0, mutant);
  }
  for (const q of S.daily.list) if (q && q.id && !QUEST_BY_ID[q.id]) QUEST_BY_ID[q.id] = q; // today's orders live in the save
  return S;
}

// ---------------------------------------------------------------- labels and icons
const speciesName = (id) => { try { return SPECIES.SPECIES_BY_ID?.[id]?.name || id; } catch { return id; } };
export const WEATHER_NAMES = {
  sunny: 'Sunny', bubbles: 'Bubble Breeze', glossyrain: 'Glossy Rain', aurora: 'Aurora', cloudy: 'Cloudy', rain: 'Rain', storm: 'Storm',
  clear: 'Clear Skies', snowfall: 'Snowfall', blizzard: 'Blizzard', murky: 'Murky', static: 'Static Storm', oil: 'Oil Slick', datarain: 'Data Rain',
  still: 'Still Water', neonstorm: 'Neon Storm', rushhour: 'Rush Hour', blackout: 'Blackout', calm: 'Calm', eruption: 'Eruption',
  sulfur: 'Sulfur Haze', magma: 'Magma Bloom', snow: 'Marine Snow', current: 'Deep Current', glowtide: 'Glow Tide',
};
const TIME_NAMES = { night: 'at night', day: 'in daylight', dusk: 'at dawn or dusk' };
const CRAFT_CATS = { rods: 'rods', tackle: 'pieces of tackle', bait: 'bait batches', boat: 'boat parts', upgrade: 'rod upgrades', tank: 'tank upgrades' };
const TOTAL_LABELS = {
  caught: (n) => `Catch ${fmt(n)} fish in total`, species: (n) => `Discover ${n} species`, aero: (n) => `Earn ${fmt(n)} Aero in total`,
  research: (n) => `Finish ${n} research projects`, bosses: (n) => n > 1 ? `Beat ${n} different bosses` : 'Beat a boss',
  zaps: (n) => `Land ${fmt(n)} PERFECT zaps`, flawless: (n) => `Make ${n} flawless catches`, chests: (n) => `Crack open ${n} chests`,
  fed: (n) => `Feed your tank ${n} times`, built: (n) => `Place ${n} things in your tank`, crafted: (n) => `Craft ${n} things`,
  oceans: (n) => n >= 7 ? 'Visit all seven oceans' : `Visit ${n} oceans`, released: (n) => `Release ${n} fish`,
  shiny: (n) => n > 1 ? `Catch ${n} shiny fish` : 'Catch a shiny fish', mutant: (n) => n > 1 ? `Catch ${n} mutated fish` : 'Catch a mutated fish',
  giant: (n) => n > 1 ? `Catch ${n} giant fish` : 'Catch a giant fish', cosmetics: (n) => `Own ${n} Wardrobe items`, rods: (n) => `Own ${n} rods`,
  orders: (n) => `Fill ${n} orders`, quests: (n) => `Finish ${n} quests`, boxes: (n) => `Reel in ${n} floating boxes`,
  hatched: (n) => n > 1 ? `Hatch ${n} eggs` : 'Hatch an egg', zones: (n) => `Reach the ${ZONE_NAMES[ZONES[Math.max(0, n - 1)]] || 'deep'}`,
};
const TOTAL_ICONS = {
  caught: 'hook', species: 'book', aero: 'coin', research: 'beaker', bosses: 'trophy', zaps: 'bolt', flawless: 'star', chests: 'mat:pkg_golden',
  fed: 'food', built: 'decor', crafted: 'hammer', oceans: 'compass', released: 'heart', shiny: 'sparkle', mutant: 'dna', giant: 'crown',
  cosmetics: 'people', rods: 'rod:duck', orders: 'shop', quests: 'trophy', boxes: 'box', hatched: 'egg', zones: 'sonar',
};
const fmt = (n) => Number(n).toLocaleString('en-US');
const an = (w) => (/^[AEIOU]/i.test(w) ? 'an ' : 'a ');
const plural = (w) => (/(fish|s)$/i.test(w) ? w : /[^aeiou]y$/i.test(w) ? w.slice(0, -1) + 'ies' : w + 's');

function catchLabel(o) {
  const adj = [o.giant ? 'giant' : o.trophy ? 'trophy-size' : '', o.shiny ? 'shiny' : '', o.mutant ? 'mutated' : ''].filter(Boolean).join(' ');
  const noun = o.species ? (o.n > 1 ? plural(speciesName(o.species)) : speciesName(o.species)) : o.rarity ? `${cap(o.rarity)}${o.rarity === 'legendary' ? '' : '+'} fish` : 'fish';
  const what = (adj ? adj + ' ' : '') + noun;
  const n = o.n > 1 ? o.n + ' ' : o.species || o.rarity || adj ? an(what) : 'a ';
  let s = `Catch ${n}${what}`;
  if (o.biome) s += ' in ' + (OCEAN_NAMES[o.biome] || o.biome);
  if (o.zone) s += ` (${ZONE_NAMES[o.zone] || o.zone})`;
  if (o.weather) s += o.weather === 'any' ? ' in wild weather' : ' during ' + [].concat(o.weather).map((w) => WEATHER_NAMES[w] || w).join(' or ');
  if (o.time) s += ' ' + (TIME_NAMES[o.time] || o.time);
  if (o.bait) s += o.bait === 'any' ? ' with proper bait' : o.bait === 'app' ? ' with Bait Shop bait' : o.bait === 'custom' ? ' with custom bait' : ' with ' + (BAIT.BAITS?.[o.bait]?.name || o.bait);
  if (o.flawless) s += ' flawlessly';
  if (o.party) s += ' with friends online';
  return s;
}

export function objLabel(o) {
  switch (o.t) {
    case 'catch': return catchLabel(o); // [quests16] filters
    case 'keep': return o.n > 1 ? `Keep ${o.n} fish in your tank` : 'Keep a fish in your tank';
    case 'release': return `Release ${o.n} fish`;
    case 'bait': return o.n > 1 ? `Buy ${o.n} bait packs` : 'Buy bait at the Bait Shop';
    case 'craft': return o.cat ? (o.n > 1 ? `Craft ${o.n} ${CRAFT_CATS[o.cat] || o.cat}` : `Craft ${an(CRAFT_CATS[o.cat] || o.cat).trim()} ${(CRAFT_CATS[o.cat] || o.cat).replace(/s$/, '').replace(/^pieces of/, 'piece of')}`) : `Craft ${o.n} thing${o.n > 1 ? 's' : ''}`;
    case 'equip': return 'Equip a new rod';
    case 'species': return o.biome ? `Discover ${o.n} species from ${OCEAN_NAMES[o.biome] || o.biome}` : `Discover ${o.n} species`;
    case 'research': return o.id ? `Research ${LAB_BY_ID[o.id]?.name || o.id}` : o.n > 1 ? `Finish ${o.n} research projects` : 'Finish a research project';
    case 'tank': return `Upgrade to the ${TANK_NAMES[TANK_ORDER[o.tier]] || 'next tank'}`;
    case 'boat': return `Get the ${BOAT_NAMES[BOAT_ORDER[o.tier]] || 'next boat'}`;
    case 'visit': return `Visit ${OCEAN_NAMES[o.biome] || o.biome}`;
    case 'depth': return `Reach the ${ZONE_NAMES[o.zone] || o.zone}`;
    case 'aero': return `Earn ${o.n.toLocaleString('en-US')} Aero`;
    case 'tutorial': return 'Finish Bubbles\' fishing lesson';
    case 'open': return `Open the ${o.panel}`;
    case 'chest': return o.tier ? (o.n > 1 ? `Crack open ${o.n} ${CHEST_NAMES[o.tier] || o.tier}s (or better)` : `Crack open a ${CHEST_NAMES[o.tier] || o.tier}`) : o.n > 1 ? `Crack open ${o.n} chests` : 'Crack open a chest'; // [phase8:prog]
    case 'have': return `Bring ${o.n} ${ITEMS.ITEMS?.[o.id]?.name || o.id}`;
    case 'dest': return `Sail to ${o.id === 'lab' ? 'Fizz Lab Island' : 'Marina\'s Workshop'}`;
    case 'craftRod': return o.id ? `Craft the ${ROD_BY_ID[o.id]?.name || o.id}` : o.n > 1 ? `Craft ${o.n} rods at the Workshop` : 'Craft a rod at the Workshop';
    case 'rodUp': return `Upgrade a rod to ${o.n} star${o.n > 1 ? 's' : ''}`;
    case 'tackle': return o.n > 1 ? `Equip ${o.n} pieces of tackle` : 'Equip a piece of tackle';
    case 'boss': return `Defeat the boss: ${BOSS_BY_ID[o.id]?.title || 'a boss'}`; // [phase9:fishing]
    // [quests16]
    case 'zap': return `Land ${o.n} PERFECT zap${o.n > 1 ? 's' : ''}`;
    case 'feed': return o.n > 1 ? `Feed your tank ${o.n} times` : 'Feed your tank';
    case 'build': return o.n > 1 ? `Place ${o.n} things in your tank` : 'Place something in your tank';
    case 'hatch': return o.n > 1 ? `Hatch ${o.n} eggs` : 'Hatch an egg';
    case 'evolve': return 'Raise a tank fish until it evolves';
    case 'collect': return `Pop ${o.n} Aero bubbles in your tank`;
    case 'tankFish': return `Have ${o.n} fish swimming in your tank`;
    case 'gearLv': { const g = GEAR_BY_ID[o.id]; return `Get the ${g?.levels?.[o.lv] || (g?.name || o.id) + ' level ' + o.lv} for your tank`; }
    case 'dress': return o.n > 1 ? `Change your look ${o.n} times` : 'Change your look in the Wardrobe';
    case 'box': return `Reel in ${o.n > 1 ? o.n + ' floating boxes' : 'a floating box'}${o.biome ? ' in ' + (OCEAN_NAMES[o.biome] || o.biome) : ''}`;
    case 'labDone': return o.n > 1 ? `Finish ${o.n} research projects` : 'Finish a research project';
    case 'online': return 'Go online with Multiplayer (optional)';
    case 'total': return (TOTAL_LABELS[o.k] || ((n) => `${o.k} ${n}`))(o.n);
    case 'ordersToday': return `Fill all ${o.n} of today's orders`;
    default: return o.t;
  }
}
const WEATHER_ICON = { rain: 'rain', glossyrain: 'rain', datarain: 'rain', storm: 'storm', static: 'storm', neonstorm: 'storm', blizzard: 'storm', aurora: 'star', glowtide: 'sparkle', eruption: 'bolt', magma: 'bolt', rushhour: 'clock' };
export function objIcon(o) {
  switch (o.t) {
    case 'catch': // [quests16] the most telling filter
      if (o.species) return 'fish:' + o.species;
      if (o.shiny) return 'sparkle';
      if (o.giant || o.trophy) return 'crown';
      if (o.mutant) return 'dna';
      if (o.party) return 'people';
      if (o.flawless) return 'star';
      if (o.bait) return 'bait:' + (BAIT.BAITS?.[o.bait] ? o.bait : 'worm');
      if (o.weather) return WEATHER_ICON[[].concat(o.weather)[0]] || 'cloud';
      if (o.time) return o.time === 'night' ? 'moon' : 'sun';
      if (o.zone) return 'sonar';
      return o.biome ? 'biome:' + o.biome : 'hook';
    case 'keep': return 'tank:jar';
    case 'species': return o.biome ? 'biome:' + o.biome : 'eye';
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
    case 'rodUp': case 'tackle': case 'craft': return 'hammer';
    case 'boss': return 'fish:' + (o.id || 'bruce'); // [phase9:fishing]
    case 'zap': return 'bolt';
    case 'feed': return 'food';
    case 'build': return 'decor';
    case 'hatch': return 'egg';
    case 'evolve': return 'dna';
    case 'collect': return 'coin';
    case 'tankFish': return 'tank:smalltank';
    case 'gearLv': return o.id === 'light' ? 'star' : o.id === 'heater' ? 'sun' : 'bubble';
    case 'dress': return 'people';
    case 'box': return 'box';
    case 'labDone': return 'beaker';
    case 'online': return 'wifi';
    case 'total': return TOTAL_ICONS[o.k] || 'star';
    case 'ordersToday': return 'shop';
    case 'release': return 'heart';
    case 'equip': return 'rod:bubble';
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

// ---------------------------------------------------------------- today's orders [quests16]
const dayKey = (d = new Date()) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
const nextMidnight = () => { const d = new Date(); d.setHours(24, 0, 0, 0); return d.getTime(); };
const hashStr = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };
const round5 = (n) => Math.max(5, Math.round(n / 5) * 5);
const PKG_BY_CH = ['pkg_crate', 'pkg_crate', 'pkg_iron', 'pkg_iron', 'pkg_iron', 'pkg_golden', 'pkg_golden'];

// ---------------------------------------------------------------- the engine
export class QuestBook {
  constructor(game) {
    this.game = game;
    this.pollT = 0;
    this.listeners = [];
    this.fight = null; // [quests16] the current fight: {perfect, bad, bait}
    this.wire();
  }

  get S() { return ensureQuests(this.game.state); }
  chapter() { return CHAPTERS[this.S.ch] || null; }
  isDone(id) { return !!this.S.done[id]; }
  isReady(id) { return !!this.S.ready[id] && !this.S.done[id]; } // [quests16] waiting for a claim
  quest(id) { return QUEST_BY_ID[id] || null; }

  // the first few unfinished quests of the current chapter (in order)
  active() {
    const c = this.chapter();
    if (!c) return [];
    return c.quests.filter((q) => !this.S.done[q.id]).slice(0, ACTIVE_MAX);
  }
  isActive(id) { return this.active().some((q) => q.id === id); }
  isLocked(id) {
    const q = QUEST_BY_ID[id];
    if (!q) return true;
    if (q.kind !== 'main') return !this.isDone(id) && !this.available(q);
    const ci = CHAPTERS.findIndex((c) => c.id === q.chapter);
    return ci > this.S.ch || (ci === this.S.ch && !this.isDone(id) && !this.isActive(id));
  }

  // [quests16] side stories open with their chapter (and after their `after` quest); milestones always; orders today
  chapterReached(chId) { const ci = CHAPTERS.findIndex((c) => c.id === chId); return ci >= 0 && ci <= this.S.ch; }
  available(q) {
    if (!q || this.S.done[q.id]) return false;
    if (q.kind === 'side') return this.chapterReached(q.chapter) && (!q.after || !!this.S.done[q.after]);
    if (q.kind === 'mile') return true;
    if (q.kind === 'order' || q.kind === 'orderBonus') return this.S.daily.list.includes(q);
    return false;
  }
  sideQuests(chId) { return CHAPTER_BY_ID[chId]?.side || []; }
  orders() { return this.S.daily.list.filter((q) => q && q.kind === 'order'); }
  orderBonus() { return this.S.daily.list.find((q) => q && q.kind === 'orderBonus') || null; }
  // every claimable quest that is open and not claimed yet
  claimables() {
    const out = [];
    const S = this.S;
    for (const c of CHAPTERS) { if (!this.chapterReached(c.id)) break; for (const q of c.side) if (!S.done[q.id] && this.available(q)) out.push(q); }
    for (const q of S.daily.list) if (q && !S.done[q.id]) out.push(q);
    for (const q of MILESTONES) if (!S.done[q.id]) out.push(q);
    return out;
  }
  readyList(kind = null) {
    const S = this.S, out = [];
    for (const id in S.ready) { const q = QUEST_BY_ID[id]; if (q && !S.done[id] && (!kind || q.kind === kind || (kind === 'order' && q.kind === 'orderBonus'))) out.push(q); }
    return out;
  }
  readyCount(kind = null) { return this.readyList(kind).length; }
  // quests whose counters move with game events
  tracked() { return [...this.active(), ...this.claimables().filter((q) => !this.S.ready[q.id])]; }
  pinned() { const id = this.S.pin; const q = id && QUEST_BY_ID[id]; return q && !this.S.done[id] && (q.kind === 'main' || this.available(q)) ? q : null; }
  setPin(id) { this.S.pin = this.S.pin === id ? null : id; this.game.save?.(); return this.S.pin; }

  depthApi() { return typeof this.game.ocean?.depthZone === 'function'; }
  // depth goals fall back to their `alt` objective while the oceans have no depth zones
  realObj(o) { return o.t === 'depth' && !this.depthApi() && o.alt ? o.alt : o; }

  start(q) {
    const S = this.S;
    if (S.started[q.id]) return;
    S.started[q.id] = { at: Date.now(), coins: this.game.state.totalCoins || 0 };
    S.prog[q.id] = q.objectives.map(() => 0);
    if (q.kind === 'main') this.game.emit?.('questStarted', { id: q.id }); // [quests16] (side stories / orders open quietly)
  }

  // [quests16] lifetime totals for {t: 'total', k}
  total(k) {
    const st = this.game.state, S = this.S, L = S.life;
    switch (k) {
      case 'caught': return st.stats?.caught | 0;
      case 'released': return st.stats?.released | 0;
      case 'species': { let n = 0; for (const id in st.journal || {}) if (st.journal[id]?.caught > 0) n++; return n; }
      case 'aero': return Math.floor(st.totalCoins || 0);
      case 'research': return Object.keys(ensureLab(st).done).filter((id) => id !== ROOT_ID && LAB_BY_ID[id]).length;
      case 'bosses': return Object.keys(st.bosses?.won || {}).filter((id) => st.bosses.won[id]).length;
      case 'oceans': return Object.keys(S.visited).length;
      case 'zones': return this.maxZone() + 1;
      case 'cosmetics': { let n = 0; try { for (const w of CHAR.WARDROBE || []) if (CHAR.ownsCosmetic(st, w)) n++; } catch { /* wardrobe not ready */ } return n; }
      case 'rods': { try { return ensureRods(st).owned.length; } catch { return 0; } }
      case 'quests': { let n = 0; for (const q of STORY_QUESTS) if (S.done[q.id]) n++; return n; }
      default: return L[k] | 0;
    }
  }

  // progress of one objective: {have, need}
  measure(q, i) {
    const st = this.game.state, S = this.S;
    const o = this.realObj(q.objectives[i]);
    const cnt = S.prog[q.id]?.[i] || 0;
    const L = ensureLab(st);
    switch (o.t) {
      case 'catch': case 'keep': case 'release': case 'bait': case 'craft': case 'equip': case 'open': return { have: cnt, need: o.n || 1 };
      case 'species': {
        let n = 0;
        for (const id in st.journal || {}) if (st.journal[id]?.caught > 0 && (!o.biome || SPECIES.SPECIES_BY_ID?.[id]?.biome === o.biome)) n++;
        return { have: n, need: o.n };
      }
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
      // [quests16] counted from events since the quest opened
      case 'zap': case 'feed': case 'build': case 'hatch': case 'evolve': case 'collect': case 'dress': case 'box': case 'labDone': return { have: cnt, need: o.n || 1 };
      case 'online': return { have: S.flags.online || this.game.net?.online ? 1 : 0, need: 1 };
      case 'tankFish': return { have: (st.fish || []).filter((f) => f.inTank).length, need: o.n };
      case 'gearLv': { let lv = 0; try { lv = gearLevel(st, o.id); } catch { lv = 0; } return { have: Math.min(o.lv, lv), need: o.lv }; }
      case 'total': return { have: Math.min(o.n, this.total(o.k)), need: o.n };
      case 'ordersToday': return { have: this.orders().filter((x) => S.done[x.id]).length, need: o.n || ORDERS_PER_DAY };
      default: return { have: 0, need: 1 };
    }
  }
  maxZone() { let m = -1; for (const z in this.S.zones) m = Math.max(m, ZONES.indexOf(z)); return m; }

  objectives(q) {
    const fin = this.isDone(q.id) || this.isReady(q.id);
    return q.objectives.map((o0, i) => {
      const o = this.realObj(o0);
      const m = fin ? { have: 1, need: 1 } : this.measure(q, i);
      const ok = fin || m.have >= m.need;
      return { label: objLabel(o), icon: objIcon(o), have: Math.min(m.have, m.need), need: m.need, ok, obj: o };
    });
  }
  // 0..1 over all objectives (for bars)
  progress(q) {
    if (this.isDone(q.id) || this.isReady(q.id)) return 1;
    const objs = this.objectives(q);
    return objs.reduce((a, o) => a + (o.ok ? 1 : o.have / Math.max(1, o.need)), 0) / Math.max(1, objs.length);
  }

  bump(pred, by = 1) {
    let any = false;
    for (const q of this.tracked()) {
      this.start(q);
      q.objectives.forEach((o0, i) => {
        const o = this.realObj(o0);
        if (pred(o)) { const p = (this.S.prog[q.id] ||= q.objectives.map(() => 0)); p[i] = (p[i] || 0) + by; any = true; }
      });
    }
    if (any) this.check();
  }
  life(k, by = 1) { const L = this.S.life; L[k] = (L[k] | 0) + by; }

  // [quests16] PERFECT / weak / fizzled / backfired zaps: wrap the fishing controller's callbacks (feature-detected)
  hookFishing() {
    const g = this.game, F = g.fishing;
    if (!F || F.__questHook) return;
    F.__questHook = true;
    for (const [name, fixed] of [['onShockFire', null], ['onBackfire', 'backfire']]) {
      const orig = F[name];
      if (typeof orig !== 'function') continue;
      F[name] = function (...a) {
        try { g.emit?.('shockFired', { grade: fixed || a[0] || 'perfect' }); } catch (e) { console.error(e); }
        return orig.apply(this, a);
      };
    }
  }

  // [quests16] does a catch match a catch objective?
  catchMatch(o, c) {
    if (o.t !== 'catch') return false;
    if (o.rarity && c.rar < RAR.indexOf(o.rarity)) return false;
    if (o.biome && o.biome !== c.biome) return false;
    if (o.species && o.species !== c.sp.id) return false;
    if (o.zone && ZONES.indexOf(c.zone) < ZONES.indexOf(o.zone)) return false;
    if (o.weather) {
      if (o.weather === 'any') { if (!c.weather || c.weather === c.calm) return false; } else if (![].concat(o.weather).includes(c.weather)) return false;
    }
    if (o.time && !c.time[o.time]) return false;
    if (o.bait) {
      const b = c.bait, def = b?.def || {};
      if (!b) return false;
      if (o.bait === 'any') { if (b.id === 'crumbs') return false; } else if (o.bait === 'custom') { if (!def.custom) return false; } else if (o.bait === 'app') { if (!def.app || def.custom) return false; } else if (b.id !== o.bait && def.recipe?.base !== o.bait) return false;
    }
    if (o.trophy && !(c.rec.giant || (c.rec.sizeT ?? 0) >= 0.75)) return false;
    if (o.giant && !c.rec.giant) return false;
    if (o.shiny && !c.rec.variant?.shiny) return false;
    if (o.mutant && !c.rec.variant?.mutation) return false;
    if (o.flawless && !c.flawless) return false;
    if (o.party && !c.party) return false;
    return true;
  }

  wire() {
    const g = this.game;
    const on = (ev, fn) => { g.on?.(ev, fn); };
    this.hookFishing();
    on('hooked', () => { this.fight = { perfect: 0, bad: 0, bait: g.fishing?.usedBait || null }; }); // [quests16]
    on('escaped', () => { this.fight = null; });
    on('shockFired', (d) => {
      const perfect = d?.grade === 'perfect';
      if (this.fight) { if (perfect) this.fight.perfect++; else this.fight.bad++; }
      if (perfect) { this.life('zaps'); this.bump((o) => o.t === 'zap'); }
    });
    on('caught', (d) => {
      const rec = d?.rec || {}, sp = d?.sp || {};
      const rar = RAR.indexOf(rec.rarity || sp.rarity || 'common');
      const biome = rec.biome || g.ocean?.biome?.id;
      let zone = rec.zone ?? d?.zone ?? null;
      if (!zone && this.depthApi()) { try { zone = zoneId(g.ocean.depthZone()); } catch { zone = null; } }
      // [quests16] weather, clock, bait and how clean the fight was
      const f = this.fight;
      this.fight = null;
      const flawless = !!f && f.perfect > 0 && f.bad === 0;
      let time = {};
      try { const ck = g.clock; time = { night: !!ck?.isNight?.(), dusk: !!ck?.isDusk?.(), day: (ck?.daylight?.() ?? 1) > 0.6 && !ck?.isDusk?.() }; } catch { time = {}; }
      let party = false;
      try { party = (g.net?.partyLuck?.() || 1) > 1; } catch { party = false; }
      const c = { rec, sp, rar, biome, zone, weather: g.ocean?.weather || null, calm: g.ocean?.biome?.weathers?.[0]?.id || null, time, bait: f?.bait || null, flawless, party };
      if (flawless) this.life('flawless');
      if (rec.variant?.shiny) this.life('shiny');
      if (rec.variant?.mutation) this.life('mutant');
      if (rec.giant) this.life('giant');
      this.bump((o) => this.catchMatch(o, c));
    });
    on('kept', () => this.bump((o) => o.t === 'keep'));
    on('released', () => this.bump((o) => o.t === 'release'));
    on('baitBought', (d) => { if (!d?.gift) this.bump((o) => o.t === 'bait'); });
    on('crafted', (d) => { this.life('crafted'); this.bump((o) => o.t === 'craft' && (!o.cat || o.cat === d?.cat)); });
    on('baitCrafted', () => { this.life('crafted'); this.bump((o) => o.t === 'craft' && (!o.cat || o.cat === 'bait')); });
    on('rodEquipped', () => this.bump((o) => o.t === 'equip'));
    on('panelOpen', (id) => this.bump((o) => o.t === 'open' && o.panel === id));
    on('chestOpened', (d) => { this.life('chests'); const r = CHEST_RANK.indexOf(d?.tier); this.bump((o) => o.t === 'chest' && (!o.tier || r >= CHEST_RANK.indexOf(o.tier))); }); // [phase8:prog]
    on('bossDefeated', (d) => this.bump((o) => o.t === 'boss' && (!o.id || o.id === d?.id))); // [phase9:fishing]
    on('destVisit', (d) => { if (d?.id) { this.S.dests[d.id] = 1; this.check(); } });
    // [quests16] tank, wardrobe, boxes, Lab
    on('tankFed', () => { this.life('fed'); this.bump((o) => o.t === 'feed'); });
    on('tankBuilt', () => { this.life('built'); this.bump((o) => o.t === 'build'); });
    on('hatched', () => { this.life('hatched'); this.bump((o) => o.t === 'hatch'); });
    on('fishEvolved', () => this.bump((o) => o.t === 'evolve'));
    on('coinCollected', () => this.bump((o) => o.t === 'collect'));
    on('character', () => this.bump((o) => o.t === 'dress'));
    on('wardrobe', () => this.bump((o) => o.t === 'dress'));
    on('boxLoot', () => { const b = g.ocean?.biome?.id; this.life('boxes'); this.bump((o) => o.t === 'box' && (!o.biome || o.biome === b)); });
    on('labDone', (d) => { if (!d?.free) this.bump((o) => o.t === 'labDone'); });
    on('netOnline', (on1) => { if (on1) { this.S.flags.online = 1; this.check(); } });
    for (const ev of ['rodCrafted', 'rodUpgraded', 'tackleEquipped', 'crafted', 'gearBought', 'kept', 'tankUpgraded']) on(ev, () => this.check());
    on('travel', (d) => { const id = typeof d === 'string' ? d : d?.to || d?.id || d?.biome; if (id) this.S.visited[id] = 1; this.check(); });
    on('depthZone', (d) => { const z = zoneId(d); if (z) { this.S.zones[z] = 1; this.check(); } }); // the Oceans agent's zone changes
    for (const ev of ['labDone', 'unlocked', 'tankUpgraded', 'tutorialDone', 'boatUpgraded']) on(ev, () => this.check());
  }

  // light poll: oceans, depth, absolute goals, the order board's day
  update(dt) {
    this.pollT -= dt;
    if (this.pollT > 0) return;
    this.pollT = 0.5;
    const g = this.game, S = this.S;
    this.hookFishing();
    const here = g.ocean?.biome?.id;
    if (here && !g.ocean?.travelState && g.state.view !== 'aquarium' && here === g.state.biome) S.visited[here] = 1;
    if (this.depthApi()) { try { const z = zoneId(g.ocean.depthZone()); if (z && ZONES.includes(z)) S.zones[z] = 1; } catch { /* ignore */ } }
    if (g.state.tutorialDone) this.refreshDaily();
    this.check();
  }

  check() {
    const g = this.game, S = this.S;
    // [quests16] claimables: mark the ones whose goals are met as ready (claimed in the Quest Log)
    if (g.state.tutorialDone) {
      const fresh = [];
      for (const q of this.claimables()) {
        if (S.ready[q.id]) continue;
        this.start(q);
        if (q.objectives.every((_, i) => { const m = this.measure(q, i); return m.have >= m.need; })) { S.ready[q.id] = Date.now(); fresh.push(q.id); }
      }
      if (fresh.length) { g.emit?.('questReady', { ids: fresh }); g.save?.(); }
    }
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

  // [quests16] pay a ready side story / milestone / order. Items asked for ('have' + take) must still be in the Satchel.
  claim(id, o = {}) {
    const g = this.game, S = this.S, q = QUEST_BY_ID[id];
    if (!q || !isClaimable(q) || S.done[id] || !S.ready[id]) return false;
    for (const ob of q.objectives) {
      if (ob.t === 'have' && ob.take && (ITEMS.countItem?.(g.state, ob.id) || 0) < ob.n) { delete S.ready[id]; g.toast?.(`Bring ${ob.n} ${ITEMS.ITEMS?.[ob.id]?.name || ob.id} first!`, 'lock'); return false; }
    }
    S.done[id] = Date.now();
    delete S.ready[id];
    if (S.pin === id) S.pin = null;
    for (const ob of q.objectives) if (ob.t === 'have' && ob.take) { try { ITEMS.removeItem?.(g.state, ob.id, ob.n); } catch { /* ignore */ } }
    if (q.kind === 'order') this.life('orders');
    const r = grantReward(g, q.reward, 'quest');
    g.emit?.('questDone', { id, bonus: r.bonus, claimed: true, quiet: !!o.quiet });
    if (!o.noCheck) this.check();
    g.save?.();
    return true;
  }
  claimAll(kind = null) {
    let n = 0;
    for (const q of this.readyList(kind)) if (this.claim(q.id, { quiet: n > 0, noCheck: true })) n++;
    if (n) this.check();
    return n;
  }

  // ------------------------------------------------------------ today's orders [quests16]
  orderContext(salt = 0) {
    const st = this.game.state, S = this.S;
    const ch = Math.max(0, Math.min(CHAPTERS.length - 1, S.ch));
    const oceans = [...new Set([...(st.unlockedBiomes || []), ...Object.keys(S.visited)])].filter((id) => OCEAN_NAMES[id]);
    const rng = new RNG(hashStr(S.daily.day + ':' + salt));
    return { ch, oceans: oceans.length ? oceans : ['oscean'], here: this.game.ocean?.biome?.id || st.biome, mat: rng.pick(ORDER_MATS[ch]), rng };
  }
  orderOk(t, c) {
    if (t.minCh > c.ch) return false;
    if (t.needs === 'workshop' && !(this.S.done.c2_workshop || c.ch >= 2)) return false;
    return true;
  }
  makeOrder(t, c, slot) {
    const r = c.rng;
    const k = t.k * r.float(0.9, 1.15);
    const base = DAILY_AERO[c.ch];
    const objectives = t.make(c, r);
    const mats = ORDER_MATS[c.ch].filter((m) => !objectives.some((o) => o.t === 'have' && o.id === m));
    const reward = { aero: round5(base * k), items: { [r.pick(mats)]: c.ch >= 3 ? 2 : 1 } };
    return { id: `o_${this.S.daily.day}_${slot}_${t.id}`, kind: 'order', pool: t.id, giver: t.giver, title: t.title, text: t.text, objectives, reward };
  }
  refreshDaily(force = false) {
    const S = this.S, D = S.daily, key = dayKey();
    if (!force && D.day === key && D.list.length) return false;
    // anything already earned on the old board is paid out, never lost
    for (const q of D.list) if (q && S.ready[q.id] && !S.done[q.id]) this.claim(q.id, { quiet: true, noCheck: true });
    for (const k of [S.started, S.prog, S.ready, S.done]) for (const id in k) if (id.startsWith('o_')) delete k[id];
    for (const id in QUEST_BY_ID) if (id.startsWith('o_')) delete QUEST_BY_ID[id];
    if (S.pin && String(S.pin).startsWith('o_')) S.pin = null;
    D.day = key; D.next = nextMidnight(); D.swaps = 1; D.list = [];
    const c = this.orderContext(0);
    const pool = ORDER_POOL.filter((t) => this.orderOk(t, c));
    const picks = [];
    while (picks.length < ORDERS_PER_DAY && picks.length < pool.length) { const t = c.rng.pick(pool); if (!picks.includes(t)) picks.push(t); }
    picks.forEach((t, i) => D.list.push(this.makeOrder(t, c, i)));
    const ch = c.ch;
    D.list.push({
      id: `o_${key}_bonus`, kind: 'orderBonus', giver: 'dot', title: 'Board Cleared!',
      text: 'BEEP BOOP! All three orders filled. Bonus protocol engaged: one shiny chest, freshly dusted.',
      objectives: [{ t: 'ordersToday', n: ORDERS_PER_DAY }], reward: { aero: round5(DAILY_AERO[ch] * 1.5), items: { [PKG_BY_CH[ch]]: 1 } },
    });
    for (const q of D.list) QUEST_BY_ID[q.id] = q;
    this.game.emit?.('ordersRefreshed', { day: key });
    this.game.save?.();
    return true;
  }
  // swap one open order for another (once a day)
  swapOrder(id) {
    const S = this.S, D = S.daily;
    const i = D.list.findIndex((q) => q.id === id && q.kind === 'order');
    if (i < 0 || (D.swaps | 0) <= 0 || S.done[id] || S.ready[id]) return false;
    const c = this.orderContext(7 + (D.swaps | 0) * 31 + i);
    const used = new Set(D.list.map((q) => q.pool));
    const pool = ORDER_POOL.filter((t) => this.orderOk(t, c) && !used.has(t.id));
    if (!pool.length) return false;
    const q = this.makeOrder(c.rng.pick(pool), c, i + 'x');
    delete QUEST_BY_ID[id]; delete S.started[id]; delete S.prog[id];
    if (S.pin === id) S.pin = q.id;
    D.list[i] = q;
    QUEST_BY_ID[q.id] = q;
    D.swaps = (D.swaps | 0) - 1;
    this.start(q);
    this.game.save?.();
    return true;
  }
  msToNewOrders() { return Math.max(0, (this.S.daily.next || nextMidnight()) - Date.now()); }

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
