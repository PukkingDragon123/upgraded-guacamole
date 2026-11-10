// [phase9:fishing] Boss fish data: one boss per ocean, built on an existing epic / legendary species and fought by
// src/fishing/boss.js (drawn by the normal fish renderer at a huge scale, with an aura, particles and a glow).
//
//   BOSSES [{id (= species id), ocean, chapter, quest, tier 1..7, title, sub, color (aura), glow, len (world px body
//            length while it is a boss), attacks: ['charge' | 'ink' | 'minions'], minion (species id), hp (fight length
//            multiplier), reward {aero, chest, recipe?, rod?}, repeat {aero, chest}}]
//   BOSS_BY_ID, BOSS_BY_OCEAN
// [balance] Rewards keep pace with the steeper Lab: a first win is worth ~10-20 minutes of fishing in that ocean, and a
// boss win (or its chapter) is the trophy that opens Lab tier 6-9 research (lab.js LAB_GATE).
// Unlocked by the chapter's Boss quest (src/game/quests.js, `cN_boss`); they surface in the ocean's deepest zone.

export const BOSSES = [
  {
    id: 'bruce', ocean: 'oscean', chapter: 'ch1', quest: 'c1_boss', tier: 1,
    title: 'Turbine Shark', sub: 'Spinner of the Green Hills', color: '#8ff0ff', glow: '#bff8ff',
    len: 104, attacks: ['charge'], minion: 'pixel', hp: 1,
    reward: { aero: 200, chest: 'pkg_iron', recipe: 'ws_rod_sakura' }, repeat: { aero: 50, chest: 'pkg_crate' },
  },
  {
    id: 'dragonkarp', ocean: 'shallows', chapter: 'ch2', quest: 'c2_boss', tier: 2,
    title: 'Rage-Quit Dragon-Karp', sub: 'It did NOT lag', color: '#ff9d5a', glow: '#ffe0a8',
    len: 108, attacks: ['charge', 'minions'], minion: null, hp: 1.1,
    reward: { aero: 500, chest: 'pkg_iron', recipe: 'ws_rod_pixel' }, repeat: { aero: 120, chest: 'pkg_crate' },
  },
  {
    id: 'eldershark', ocean: 'fjord', chapter: 'ch3', quest: 'c3_boss', tier: 3,
    title: 'Ok Boomer Shark', sub: 'Back in my day...', color: '#bfeaff', glow: '#e8fbff',
    len: 118, attacks: ['charge', 'ink'], minion: null, hp: 1.2,
    reward: { aero: 1400, chest: 'pkg_golden', recipe: 'ws_rod_magnet' }, repeat: { aero: 350, chest: 'pkg_iron' },
  },
  {
    id: 'bsod', ocean: 'junkyard', chapter: 'ch4', quest: 'c4_boss', tier: 4,
    title: 'Blue Screen of Death Ray', sub: 'A fatal exception has occurred', color: '#5a9aff', glow: '#bfe0ff',
    len: 112, attacks: ['charge', 'minions', 'ink'], minion: null, hp: 1.3,
    reward: { aero: 3500, chest: 'pkg_golden', recipe: 'ws_rod_glow' }, repeat: { aero: 850, chest: 'pkg_iron' },
  },
  {
    id: 'mayorgrouper', ocean: 'metropolis', chapter: 'ch5', quest: 'c5_boss', tier: 5,
    title: 'Main Character Marlin', sub: 'Everyone else is an NPC', color: '#ffd23a', glow: '#fff2b8',
    len: 120, attacks: ['charge', 'minions', 'ink'], minion: null, hp: 1.4,
    reward: { aero: 8000, chest: 'pkg_golden', recipe: 'ws_rod_turbo' }, repeat: { aero: 2000, chest: 'pkg_golden' },
  },
  {
    id: 'moltenleviathan', ocean: 'volcano', chapter: 'ch6', quest: 'c6_boss', tier: 6,
    title: 'The Final Boss Leviathan', sub: '(it is not the final boss)', color: '#ff6a3a', glow: '#ffc08a',
    len: 128, attacks: ['charge', 'minions', 'ink'], minion: null, hp: 1.5,
    reward: { aero: 18000, chest: 'pkg_orb', recipe: 'ws_rod_starfish' }, repeat: { aero: 4500, chest: 'pkg_golden' },
  },
  {
    id: 'manyeyes', ocean: 'abyss', chapter: 'ch7', quest: 'c7_boss', tier: 7,
    title: 'The Algorithm', sub: 'It has been watching you', color: '#c89aff', glow: '#ecd8ff',
    len: 130, attacks: ['charge', 'ink', 'minions'], minion: null, hp: 1.6,
    reward: { aero: 35000, chest: 'pkg_orb', rod: 'aerolite' }, repeat: { aero: 9000, chest: 'pkg_orb' },
  },
];

export const BOSS_BY_ID = Object.fromEntries(BOSSES.map((b) => [b.id, b]));
export const BOSS_BY_OCEAN = Object.fromEntries(BOSSES.map((b) => [b.ocean, b]));
