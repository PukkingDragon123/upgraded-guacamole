// Coral skill tree: node data + derived gameplay stats.
// pos = layout in tree units (x: -1..1 left/right, y: 0 root .. 1 crown); the skill panel maps it to pixels.

export const BRANCHES = {
  hook: { name: 'Hooks', color: '#ff8a7a' },
  line: { name: 'Lines', color: '#7ad8ff' },
  reel: { name: 'Reels', color: '#ffd25a' },
  mouse: { name: 'Mouse Mastery', color: '#c89aff' },
  bait: { name: 'Bait', color: '#ff9ad0' },
  tank: { name: 'Aquarium', color: '#7dffb8' },
  breed: { name: 'Breeding', color: '#ffb8e8' },
  exp: { name: 'Expeditions', color: '#ffe8a8' },
};

const S = (id, branch, name, cost, req, pos, effect, desc, extra = {}) => ({ id, branch, name, cost, req, pos, effect, desc, ...extra });

export const SKILLS = [
  S('hook1', 'hook', 'Sharper Hook', 0, [], [0, 0.04], { biteWindow: 1.25 }, 'Bites stay hookable longer.', { icon: 'hook' }),
  // hooks (centre-left trunk)
  S('hook2', 'hook', 'Barbed Hook', 15, ['hook1'], [-0.16, 0.16], { slackGrace: 0.6 }, 'Fish struggle longer before throwing the hook.', { icon: 'hook' }),
  S('hook3', 'hook', 'Lucky Hook', 60, ['hook2'], [-0.28, 0.27], { rarityBoost: 1.2 }, 'Rarer fish show up a little more often.', { icon: 'star' }),
  S('hook5', 'hook', 'Steel Hook', 300, ['hook3'], [-0.36, 0.4], { lineStrength: 0.15 }, 'Tough enough for junk. Needed for Junkyard Reef.', { icon: 'hook' }),
  S('hook4', 'hook', 'Auto-Hook Charm', 150, ['hook3'], [-0.18, 0.4], { autoHook: 0.15 }, '15% chance to set the hook automatically.', { icon: 'sparkle' }),
  S('hook6', 'hook', 'Golden Hook', 900, ['hook5'], [-0.44, 0.55], { rarityBoost: 1.3, shinyChance: 1.5 }, 'Rare and shiny fish are drawn to gold.', { icon: 'crown' }),
  S('hook7', 'hook', 'Lantern Hook', 1200, ['hook5'], [-0.3, 0.6], { lantern: 1 }, 'Your hook glows. Needed for the Deep Ocean.', { icon: 'sun' }),
  S('hook8', 'hook', 'Auto-Hook II', 2500, ['hook4', 'hook6'], [-0.36, 0.75], { autoHook: 0.15 }, '+15% more auto-hook chance.', { icon: 'sparkle' }),
  // lines (left)
  S('line1', 'line', 'Braided Line', 20, ['hook1'], [-0.42, 0.12], { lineStrength: 0.15 }, 'Line can take more tension.', { icon: 'line' }),
  S('line2', 'line', 'Elastic Line', 50, ['line1'], [-0.58, 0.2], { snapGrace: 0.25 }, 'Survives tension spikes a bit longer.', { icon: 'line' }),
  S('line3', 'line', 'Fluoro Line', 120, ['line2'], [-0.72, 0.3], { calm: 1.25 }, 'Nearly invisible: fish spook less.', { icon: 'eye' }),
  S('line4', 'line', 'Steel Leader', 400, ['line3'], [-0.78, 0.45], { lineStrength: 0.2 }, 'Big fish, no problem.', { icon: 'line' }),
  S('line5', 'line', 'Titanium Line', 1500, ['line4'], [-0.8, 0.62], { lineStrength: 0.25, snapGrace: 0.3 }, 'The strongest line on any desktop.', { icon: 'line' }),
  // reels (right of trunk)
  S('reel1', 'reel', 'Quick Reel', 25, ['hook1'], [0.16, 0.15], { reelSpeed: 12 }, 'Reel in faster.', { icon: 'reel' }),
  S('reel2', 'reel', 'Counter Grip', 70, ['reel1'], [0.28, 0.26], { staminaDrain: 1.25 }, 'Pulling against fish tires them faster.', { icon: 'reel' }),
  S('reel3', 'reel', 'Ball Bearings', 180, ['reel2'], [0.36, 0.39], { reelSpeed: 14 }, 'Smooth, speedy reeling.', { icon: 'reel' }),
  S('reel4', 'reel', 'Drag System', 450, ['reel3'], [0.44, 0.53], { snapGrace: 0.3, slackGrace: 0.5 }, 'More forgiving tension.', { icon: 'reel' }),
  S('reel5', 'reel', 'Overdrive Reel', 1800, ['reel4'], [0.4, 0.7], { staminaDrain: 1.35, reelSpeed: 16 }, 'Wear down even legends.', { icon: 'reel' }),
  // mouse mastery (right)
  S('mouse1', 'mouse', 'Calm Hands', 30, ['hook1'], [0.42, 0.1], { calm: 1.3 }, 'Fish tolerate faster mouse movement.', { icon: 'mouse_l' }),
  S('mouse8', 'mouse', 'Coin Magnet', 140, ['mouse1'], [0.6, 0.14], { collectRadius: 16 }, 'Collect coins from further away.', { icon: 'coin' }),
  S('mouse2', 'mouse', 'Lure Jigging', 80, ['mouse1'], [0.56, 0.26], { baitRadius: 1.25 }, 'Clicking in the water attracts fish from further.', { icon: 'bait' }),
  S('mouse3', 'mouse', 'Big Net', 100, ['mouse2'], [0.72, 0.3], { netTolerance: 1.35, netTime: 1.25 }, 'Sloppy circles still catch fish.', { icon: 'net' }),
  S('mouse4', 'mouse', 'Tracer Eyes', 160, ['mouse2'], [0.64, 0.42], { traceRadius: 1.3, traceForgive: 1.3 }, 'Bigger ring when tracing fish.', { icon: 'eye' }),
  S('mouse5', 'mouse', 'Rhythm Fins', 220, ['mouse4'], [0.8, 0.46], { timingWindow: 1.35, timingMisses: 1 }, 'Wider timing window, one extra miss.', { icon: 'music' }),
  S('mouse6', 'mouse', 'Power Clicks', 220, ['mouse4'], [0.7, 0.56], { mashPower: 1.35 }, 'Each mash click counts more.', { icon: 'mouse_l' }),
  S('mouse9', 'mouse', 'Dodge Roll', 350, ['mouse6'], [0.84, 0.62], { dodgeHits: 1 }, 'Take one extra hit when dodging.', { icon: 'heart' }),
  S('mouse7', 'mouse', 'Focus Mode', 600, ['mouse6'], [0.62, 0.72], { focus: 1 }, 'Hold RIGHT mouse during fights to slow time.', { icon: 'clock' }),
  // bait (upper left)
  S('bait1', 'bait', 'Bigger Bait Box', 20, ['hook2'], [-0.06, 0.28], { boxSlots: 2 }, '+2 bait box slots.', { icon: 'bait' }),
  S('bait2', 'bait', 'Worm Farm', 60, ['bait1'], [-0.06, 0.42], { unlockBait: ['worm'] }, 'Glowing Worms appear in the shop.', { icon: 'worm' }),
  S('bait8', 'bait', 'Sugar Rush', 120, ['bait2'], [0.06, 0.5], { unlockBait: ['sugar'] }, 'Sugar Cubes appear in the shop.', { icon: 'food' }),
  S('bait3', 'bait', 'Golden Bait License', 250, ['bait2'], [-0.14, 0.53], { unlockBait: ['golden'] }, 'Golden Bait appears in the shop.', { icon: 'crown' }),
  S('bait4', 'bait', 'Flood Gates', 300, ['bait3'], [-0.06, 0.64], { unlockBait: ['flood'] }, 'Flood Bait appears in the shop.', { icon: 'rain' }),
  S('bait5', 'bait', 'Bait Box XL', 500, ['bait4'], [-0.16, 0.74], { boxSlots: 3 }, '+3 bait box slots.', { icon: 'bait' }),
  S('bait7', 'bait', 'Potent Bait', 700, ['bait4'], [0.04, 0.76], { baitRadius: 1.3 }, 'Bait smell travels much further.', { icon: 'sparkle' }),
  S('bait6', 'bait', 'Black Hole Permit', 1500, ['bait7'], [-0.04, 0.88], { unlockBait: ['blackhole'] }, 'Black Hole Bait appears in the shop. Handle with care.', { icon: 'skull' }),
  // aquarium (lower right)
  S('tank1', 'tank', 'Bigger Tank', 40, ['reel1'], [0.14, 0.3], { tankCap: 3 }, '+3 fish in your aquarium.', { icon: 'tank' }),
  S('tank2', 'tank', 'Auto-Feeder', 150, ['tank1'], [0.2, 0.42], { feeder: 1 }, 'Your fish get fed while you work.', { icon: 'food' }),
  S('tank3', 'tank', 'Snail Janitor', 200, ['tank1'], [0.1, 0.44], { autoCollect: 1 }, 'A snail slowly collects coins for you.', { icon: 'coin' }),
  S('tank4', 'tank', 'Bigger Tank II', 400, ['tank2'], [0.24, 0.56], { tankCap: 4 }, '+4 fish in your aquarium.', { icon: 'tank' }),
  S('tank5', 'tank', 'Happy Water', 500, ['tank4'], [0.2, 0.68], { coinMul: 1.25 }, 'Happier fish make 25% more coins.', { icon: 'heart' }),
  S('tank6', 'tank', 'Coin Crab', 1200, ['tank3', 'tank4'], [0.12, 0.6], { autoCollect: 1 }, 'A greedy crab helps collect coins.', { icon: 'coin' }),
  S('tank7', 'tank', 'Bigger Tank III', 2000, ['tank5'], [0.26, 0.82], { tankCap: 6 }, '+6 fish in your aquarium.', { icon: 'tank' }),
  S('tank8', 'tank', 'Treasure Currents', 3000, ['tank7'], [0.16, 0.94], { coinMul: 1.5, offlineMul: 0.2 }, '+50% coins, more coins while away.', { icon: 'trophy' }),
  // breeding (crown right)
  S('breed1', 'breed', 'Fish Romance', 800, ['tank5'], [0.36, 0.84], { breeding: 1 }, 'Happy pairs of the same species lay eggs.', { icon: 'heart' }),
  S('breed2', 'breed', 'Warm Nursery', 1200, ['breed1'], [0.5, 0.88], { hatchSpeed: 1.6 }, 'Eggs hatch faster.', { icon: 'sun' }),
  S('breed3', 'breed', 'Mutation Lab', 2000, ['breed1'], [0.42, 0.96], { mutationChance: 0.05 }, 'More mutations when catching and breeding.', { icon: 'sparkle' }),
  S('breed4', 'breed', 'Sparkle Genes', 4000, ['breed3'], [0.56, 0.98], { shinyChance: 2 }, 'Shiny fish twice as likely.', { icon: 'star' }),
  // expeditions (crown left)
  S('exp1', 'exp', 'Junkyard Reef Map', 350, ['hook5'], [-0.52, 0.42], { unlockBiome: 'junkyard' }, 'Travel to Junkyard Reef. Requires the Steel Hook and 6 species discovered.', { icon: 'map', needSpecies: 6 }),
  S('exp2', 'exp', 'Junk Bait License', 500, ['exp1'], [-0.6, 0.56], { unlockBait: ['chip', 'popup'] }, 'Overclocked Chips and Pop-up Ads in the shop.', { icon: 'bait' }),
  S('exp5', 'exp', 'Weather Radio', 400, ['exp1'], [-0.62, 0.7], { forecast: 1 }, 'See the weather forecast and rare-fish weather.', { icon: 'cloud' }),
  S('exp6', 'exp', 'Sonar Ping', 900, ['exp5'], [-0.66, 0.84], { sonar: 1 }, 'Rare fish get a subtle glint.', { icon: 'eye' }),
  S('exp3', 'exp', 'Deep Ocean Map', 2500, ['exp1', 'hook7'], [-0.46, 0.86], { unlockBiome: 'abyss' }, 'Dive into the Deep Ocean. Requires the Lantern Hook and 16 species discovered.', { icon: 'map', needSpecies: 16 }),
  S('exp4', 'exp', 'Deep Ocean Bait License', 1800, ['exp3'], [-0.3, 0.95], { unlockBait: ['lantern', 'relic'] }, 'Lantern Pearls and Ancient Relics in the shop.', { icon: 'skull' }),
];

export const SKILL_BY_ID = Object.fromEntries(SKILLS.map((s) => [s.id, s]));

export const BASE_STATS = {
  biteWindow: 1, lineStrength: 1, snapGrace: 0.35, slackGrace: 1.6, reelSpeed: 34, staminaDrain: 1,
  traceRadius: 1, traceForgive: 1, mashPower: 1, timingWindow: 1, timingMisses: 2, dodgeHits: 2,
  netTolerance: 1, netTime: 1, calm: 1, autoHook: 0, baitRadius: 1, rarityBoost: 1,
  mutationChance: 0.05, shinyChance: 1 / 220, boxSlots: 4, tankCap: 4, coinMul: 1, collectRadius: 14,
  focus: 0, autoCollect: 0, feeder: 0, breeding: 0, hatchSpeed: 1, sonar: 0, lantern: 0, forecast: 0, offlineMul: 0.35,
};

const MULTIPLIERS = new Set(['biteWindow', 'staminaDrain', 'traceRadius', 'traceForgive', 'mashPower', 'timingWindow', 'netTolerance', 'netTime', 'calm', 'baitRadius', 'rarityBoost', 'shinyChance', 'coinMul', 'hatchSpeed']);

export function computeStats(owned) {
  const s = { ...BASE_STATS, unlockBait: new Set(['bread']), unlockBiome: new Set(['shallows']) };
  for (const sk of SKILLS) {
    if (!owned[sk.id]) continue;
    for (const [k, v] of Object.entries(sk.effect)) {
      if (k === 'unlockBait') v.forEach((b) => s.unlockBait.add(b));
      else if (k === 'unlockBiome') s.unlockBiome.add(v);
      else if (MULTIPLIERS.has(k)) s[k] *= v;
      else s[k] = (s[k] || 0) + v;
    }
  }
  return s;
}

// 'owned' | 'available' | 'locked' plus a reason when locked.
export function skillStatus(sk, state, speciesFound) {
  if (state.skills[sk.id]) return { status: 'owned' };
  const missing = sk.req.filter((r) => !state.skills[r]);
  if (missing.length) return { status: 'locked', reason: 'Requires ' + missing.map((m) => SKILL_BY_ID[m].name).join(' + ') };
  if (sk.needSpecies && speciesFound < sk.needSpecies) return { status: 'locked', reason: `Discover ${sk.needSpecies} species (${speciesFound}/${sk.needSpecies})` };
  return { status: 'available' };
}
