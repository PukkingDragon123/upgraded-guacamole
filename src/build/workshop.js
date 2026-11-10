// Marina's Workshop: the crafting system (phase 8, OWNER: Progression agent). A recipe book of rods, tackle (reels,
// lines, lures, charms), rod upgrades, bait, decor, boat parts, tank gear and buildings, made from fishing materials,
// box/chest loot and fish parts. Small things are instant; big things (rods, boat parts, tank gear, rare tackle) go
// into a timed craft queue. The Workshop itself is a destination you sail to (src/world/destinations.js) and opens
// with a quest (src/game/quests.js 'c2_workshop'); the older Lab crafting recipes (src/build/crafting.js) live here too.
//
//   WS_CATS [{id, name, icon /* pixart id */}]
//   ensureWorkshop(state) -> state.workshop = {queue:[{rid, start, end}], made:{rid: n}, seen:{rid: 1}, total}
//   workshopUnlocked(state) -> bool        (feature:workshop from the quest, or chapter 3+ for older saves)
//   recipesFor(state, cat?) -> [recipe]   recipe {id, cat, name, rarity, desc, icon ('pix:<id>'|'item:<id>'|'rod:<id>'),
//                                          cost:{aero, items}, time (s, 0 = instant), out:{type, id, qty, ...}, req:[cond]}
//     cond: {lab: nodeId} | {ch: n} (n chapters finished) | {quest: id} | {starter: true}; any one unlocks the recipe.
//   wsRecipe(state, id) -> recipe | null
//   wsUnlocked(state, r) -> bool          wsLockReason(state, r) -> text
//   wsCheck(state, r) -> {ok, aero:{have,need,ok}, items:[{id,have,need,ok}], slot, owned, reason}
//   wsCraft(game, id) -> {ok, reason, queued, out}   (emits 'crafted' {id, cat, out}; 'rodCrafted' {id} for rods)
//   wsTick(game)                          finishes due queue entries (called every frame by progression.js)
//   wsSlots(state), wsRemaining(entry), wsRushCost(entry), wsRush(game, index)
//   outLabel(r) / outOwned(state, r)
import { ITEMS, addItem, countItem, removeItem } from './items.js';
import { RECIPES as LAB_RECIPES, recipeUnlocked, craft as labCraft, recipeNode } from './crafting.js';
import { RODS, ROD_BY_ID, TACKLE, TACKLE_BY_ID, giveRod, equipRod, ownsRod, giveTackle, ownsTackle, rodLevel, setRodLevel, MAX_ROD_LEVEL } from '../game/rods.js';
import { LAB_BY_ID, ensureLab, unlocked } from '../game/lab.js';
import { BOAT_PARTS, BOAT_PART_SLOTS } from '../world/boatmodels.js';
import { GEAR, gearLevel } from '../aquarium/tanks.js';
import { CHAPTERS, QUEST_BY_ID } from '../game/quests.js';

export const WS_CATS = [
  { id: 'rods', name: 'Rods', icon: 'cat_rods' },
  { id: 'tackle', name: 'Tackle', icon: 'cat_tackle' },
  { id: 'upgrade', name: 'Rod Upgrades', short: 'Upgrade', icon: 'cat_upgrade' },
  { id: 'bait', name: 'Bait', icon: 'cat_bait' },
  { id: 'decor', name: 'Decor', icon: 'cat_decor' },
  { id: 'boat', name: 'Boat Parts', short: 'Boat', icon: 'cat_boat' },
  { id: 'tank', name: 'Tank Gear', short: 'Tank', icon: 'cat_tank' },
  { id: 'build', name: 'Buildings', icon: 'cat_build' },
];

// ---------------------------------------------------------------- save
export function ensureWorkshop(state) {
  const w = (state.workshop ||= {});
  if (!Array.isArray(w.queue)) w.queue = [];
  w.made ||= {};
  w.seen ||= {};
  w.total ||= 0;
  return w;
}
const chDone = (state) => Math.max(0, state?.quests?.ch | 0);
export function workshopUnlocked(state) {
  if (!state) return false;
  if (state.workshop?.unlocked) return true;
  try { if (unlocked(state, 'feature', 'workshop')) return true; } catch { /* lab not ready */ }
  return !!state.quests?.done?.c2_workshop || chDone(state) >= 2;
}

// ---------------------------------------------------------------- static recipes
const STATIC = [];
const add = (o) => STATIC.push({ time: 0, desc: '', req: [{ starter: true }], ...o });

// ---- rods (crafted rods each have a perk; see rods.js PERKS)
const ROD_RECIPES = {
  duck: { aero: 40, items: { driftwood: 4, kelp_fibre: 2, fish_scale: 3 }, time: 20, req: [{ starter: true }] },
  clover: { aero: 120, items: { clover_leaf: 3, kelp_fibre: 4, fish_scale: 4 }, time: 45, req: [{ lab: 'luck1' }, { ch: 1 }] },
  frost: { aero: 260, items: { ice_shard: 4, sea_glass: 3, fin_ribbon: 2 }, time: 75, req: [{ ch: 2 }] },
  magnet: { aero: 300, items: { scrap_metal: 6, spring_coil: 2, gear: 1 }, time: 90, req: [{ lab: 'boat_magnet' }, { ch: 3 }] },
  sakura: { aero: 450, items: { coral_chunk: 3, fin_ribbon: 3, pearl: 1 }, time: 120, req: [{ lab: 'craft_decor1' }, { ch: 3 }] },
  pixel: { aero: 600, items: { circuit_board: 2, spring_coil: 3, fish_scale: 6 }, time: 150, req: [{ ch: 4 }] },
  glow: { aero: 900, items: { sea_glass: 4, glow_bulb: 2, circuit_board: 1 }, time: 180, req: [{ lab: 'sea_lantern' }, { ch: 4 }] },
  turbo: { aero: 1600, items: { lava_glass: 3, gear: 4, spring_coil: 4 }, time: 240, req: [{ lab: 'reel5' }, { ch: 5 }] },
  starfish: { aero: 5000, items: { golden_scale: 1, abyss_crystal: 2, pearl: 3, glow_bulb: 3 }, time: 360, req: [{ ch: 6 }] },
};
export const WS_ROD_IDS = Object.keys(ROD_RECIPES);
for (const [id, c] of Object.entries(ROD_RECIPES)) {
  const rod = ROD_BY_ID[id];
  if (!rod) continue;
  add({ id: 'ws_rod_' + id, cat: 'rods', name: rod.name, rarity: rod.rarity, desc: rod.desc, icon: 'rod:' + id, cost: { aero: c.aero, items: c.items }, time: c.time, out: { type: 'rod', id }, req: c.req });
}

// ---- tackle
const TK = {
  reel_spin: [20, { scrap_metal: 1, driftwood: 2 }, 0, [{ starter: true }]],
  line_braid: [15, { kelp_fibre: 3, fish_scale: 1 }, 0, [{ starter: true }]],
  lure_spoon: [15, { shell: 2, fish_scale: 2 }, 0, [{ starter: true }]],
  charm_heart: [20, { shell: 2, fish_scale: 2 }, 0, [{ starter: true }]],
  lure_frog: [60, { clover_leaf: 1, fish_scale: 3, kelp_fibre: 2 }, 0, [{ lab: 'hook_lucky' }, { ch: 2 }]],
  charm_clover: [70, { clover_leaf: 3, shell: 2 }, 0, [{ lab: 'luck1' }, { ch: 2 }]],
  reel_turbo: [160, { spring_coil: 2, gear: 2, scrap_metal: 2 }, 20, [{ lab: 'reel3' }, { ch: 3 }]],
  line_glow: [150, { fin_ribbon: 2, glow_bulb: 1, kelp_fibre: 3 }, 20, [{ lab: 'sea_lantern' }, { ch: 4 }]],
  lure_squid: [140, { glow_bulb: 1, fin_ribbon: 2, fish_scale: 3 }, 20, [{ ch: 4 }]],
  charm_star: [180, { pearl: 1, sea_glass: 3, fish_scale: 3 }, 20, [{ lab: 'luck2' }, { ch: 4 }]],
  reel_gold: [420, { gear: 3, pearl: 1, lava_glass: 1 }, 45, [{ lab: 'reel5' }, { ch: 5 }]],
  line_titan: [380, { fin_ribbon: 4, magnet_stone: 1, scrap_metal: 4 }, 45, [{ lab: 'line3' }, { ch: 5 }]],
  charm_pearl: [500, { pearl: 2, glow_bulb: 1, coral_chunk: 2 }, 45, [{ ch: 6 }]],
};
for (const t of TACKLE) {
  const c = TK[t.id];
  if (!c) continue;
  add({ id: 'ws_tk_' + t.id, cat: 'tackle', name: t.name, rarity: t.rarity, desc: t.desc, icon: 'pix:' + t.id, cost: { aero: c[0], items: c[1] }, time: c[2], out: { type: 'tackle', id: t.id }, req: c[3] });
}

// ---- bait from fish parts (plus the Lab's bait recipes below)
add({ id: 'ws_bait_sprinkle', cat: 'bait', name: 'Scale Sprinkles', rarity: 'common', desc: 'Crumbs dusted with fish-scale glitter.', icon: 'item:crumbs', cost: { aero: 0, items: { fish_scale: 2, kelp_fibre: 1 } }, out: { type: 'item', id: 'crumbs', qty: 5 } });
add({ id: 'ws_bait_wormy', cat: 'bait', name: 'Wiggly Worms', rarity: 'uncommon', desc: 'Fresh worms in a ribbon bow.', icon: 'item:worm', cost: { aero: 10, items: { fin_ribbon: 1, kelp_fibre: 2 } }, out: { type: 'item', id: 'worm', qty: 4 }, req: [{ ch: 1 }] });

// ---- boat parts (the Wardrobe's Boat tab equips them)
const BP_COST = {
  uncommon: [60, { driftwood: 4, kelp_fibre: 3 }, 15, [{ starter: true }]],
  rare: [180, { sea_glass: 3, fin_ribbon: 2 }, 30, [{ lab: 'boat_skiff' }, { ch: 3 }]],
  epic: [500, { gear: 3, circuit_board: 1, spring_coil: 2 }, 60, [{ ch: 4 }]],
  legendary: [1500, { golden_scale: 1, pearl: 2 }, 120, [{ ch: 5 }]],
};
const SLOT_MAT = { hull: 'shell', sail: 'fin_ribbon', flag: 'kelp_fibre', engine: 'spring_coil', decal: 'shell' };
const SLOT_ART = { hull: 'boat_hull', sail: 'boat_sail', flag: 'boat_flag', engine: 'boat_engine', decal: 'boat_decal' };
const PART_TINT = { white: '#ffffff', stripe: '#2fb8e8', leaf: '#5ccf3a', bubble: '#bff4ff', rainbow: '#ff8ac8', solar: '#ffd23a', fish: '#ff9a2a', drop: '#2fb8e8', heart: '#ff5a7a', star: '#ffd23a', smile: '#ffe25a', turbine: '#e8eef4', paddle: '#c8925a', outboard: '#2fd3e8', swoosh: '#2fd3e8', wave: '#3a8cff', leaves: '#5ccf3a', bubbles: '#bff4ff', stripes: '#ff4f5e', dolphin: '#59c3ff' };
for (const { id: slot, name: slotName } of BOAT_PART_SLOTS) {
  for (const p of BOAT_PARTS[slot] || []) {
    const c = BP_COST[p.rarity];
    if (!c || p.id === 'none') continue;
    const items = { ...c[1] };
    items[SLOT_MAT[slot]] = (items[SLOT_MAT[slot]] || 0) + 2;
    const tint = (p.color || PART_TINT[p.id] || '#2fb8e8').replace('#', '');
    add({ id: `ws_boat_${slot}_${p.id}`, cat: 'boat', name: `${p.name} ${slotName}`, rarity: p.rarity, desc: `A ${slotName.toLowerCase()} for your boat. Equip it in the Wardrobe's Boat tab.`, icon: `pix:${SLOT_ART[slot]}#${tint}`, cost: { aero: c[0], items }, time: c[2], out: { type: 'boatpart', slot, id: p.id }, req: c[3] });
  }
}

// ---- the Lab's crafting recipes (buildings, aquarium decor, seabed plans, bait), unlocked in the Lab
const LAB_CAT = { building: 'build', decor: 'decor', plans: 'decor', bait: 'bait', special: 'bait' };
const RAR_OF = (id) => ITEMS[id]?.rarity || 'common';
for (const r of LAB_RECIPES) {
  const cat = LAB_CAT[r.cat];
  if (!cat) continue;
  STATIC.push({ id: r.id, cat, name: r.name, rarity: r.out ? RAR_OF(r.out.id) : 'rare', desc: r.desc || '', icon: r.out ? 'item:' + r.out.id : 'pix:gem', cost: r.cost, time: 0, out: r.out ? { type: 'lab', id: r.out.id, qty: r.out.qty } : { type: 'special' }, req: [{ labRecipe: r.id }], lab: true, sub: r.cat });
}
const STATIC_BY_ID = Object.fromEntries(STATIC.map((r) => [r.id, r]));

// ---------------------------------------------------------------- dynamic recipes
const UP_MAT = ['fish_scale', 'kelp_fibre', 'sea_glass', 'fin_ribbon', 'gear', 'pearl', 'circuit_board', 'glow_bulb', 'abyss_crystal', 'golden_scale'];
function upgradeRecipe(state, rod) {
  const lv = rodLevel(state, rod.id);
  const next = lv + 1;
  const t = rod.tier;
  const items = { fish_scale: 2 + t + next };
  const m1 = UP_MAT[Math.min(UP_MAT.length - 1, 1 + Math.floor(t / 2) + Math.floor(next / 2))];
  items[m1] = (items[m1] || 0) + Math.max(1, Math.round((next * (t + 2)) / 4));
  if (next >= 3) items.fin_ribbon = (items.fin_ribbon || 0) + next - 1;
  if (next >= 4) items.pearl = (items.pearl || 0) + (next - 3);
  if (next >= 5 && t >= 6) items.abyss_crystal = (items.abyss_crystal || 0) + 1;
  return {
    id: 'ws_up_' + rod.id, cat: 'upgrade', name: `${rod.name} ${'★'.repeat(Math.min(next, MAX_ROD_LEVEL))}`, rarity: rod.rarity, maxed: lv >= MAX_ROD_LEVEL,
    desc: lv >= MAX_ROD_LEVEL ? 'Fully tuned. A masterpiece.' : `Tune it to level ${next}: +6% lure, luck and control, +10% strength, more resilience.`,
    icon: 'rod:' + rod.id, cost: { aero: Math.round(25 * (t + 1) * Math.pow(next, 1.45)), items }, time: 8 + next * 8 + t * 4, out: { type: 'rodlevel', id: rod.id, lv: next }, req: [{ starter: true }], dynamic: true,
  };
}
const GEAR_REQ = [null, { lab: 'tank_bowl' }, { lab: 'tank_small' }, { lab: 'tank_big' }, { lab: 'tank_reef' }];
const GEAR_MAT = { filter: ['sea_glass', 'kelp_fibre'], heater: ['scrap_metal', 'lava_glass'], light: ['sea_glass', 'glow_bulb'], air: ['shell', 'fish_scale'], sand: ['shell', 'coral_chunk'] };
const GEAR_ART = { filter: 'tank_filter', heater: 'tank_heater', light: 'tank_light', air: 'tank_air', sand: 'tank_sand' };
function gearRecipe(state, g) {
  const lv = gearLevel(state, g.id), next = lv + 1;
  if (next >= g.levels.length) return null;
  const [m0, m1] = GEAR_MAT[g.id] || ['shell', 'sea_glass'];
  const items = { [m0]: 2 + next * 2 };
  if (next >= 2) items[m1] = (items[m1] || 0) + next - 1;
  return {
    id: `ws_tank_${g.id}`, cat: 'tank', name: g.levels[next], rarity: ['common', 'uncommon', 'rare', 'epic', 'epic'][next] || 'rare', desc: `${g.name}: ${g.desc}`, icon: 'pix:' + (GEAR_ART[g.id] || 'tank_filter'),
    cost: { aero: Math.round((g.cost[next] || 100) * 0.35), items }, time: 15 * next, out: { type: 'gear', id: g.id, lv: next }, req: [GEAR_REQ[next] || { ch: 4 }, { ch: Math.min(6, next + 1) }], dynamic: true,
  };
}

export function recipesFor(state, cat = null) {
  const out = [];
  for (const r of STATIC) if (!cat || r.cat === cat) out.push(r);
  if (!cat || cat === 'upgrade') for (const id of ensureRodsOwned(state)) { const rod = ROD_BY_ID[id]; if (rod && id !== 'twig') out.push(upgradeRecipe(state, rod)); }
  if (!cat || cat === 'tank') for (const g of GEAR) { const r = gearRecipe(state, g); if (r) out.push(r); }
  return out;
}
function ensureRodsOwned(state) { return state?.rods?.owned || ['twig']; }
export function wsRecipe(state, id) {
  if (STATIC_BY_ID[id]) return STATIC_BY_ID[id];
  if (id.startsWith('ws_up_')) { const rod = ROD_BY_ID[id.slice(6)]; return rod && ownsRod(state, rod.id) ? upgradeRecipe(state, rod) : null; }
  if (id.startsWith('ws_tank_')) { const g = GEAR.find((q) => q.id === id.slice(8)); return g ? gearRecipe(state, g) : null; }
  return null;
}

// ---------------------------------------------------------------- unlocks
function condOk(state, c) {
  if (c.starter) return true;
  if (c.labRecipe) return recipeUnlocked(state, c.labRecipe);
  if (c.lab) return !!ensureLab(state).done[c.lab];
  if (c.ch !== undefined) return chDone(state) >= c.ch;
  if (c.quest) return !!state.quests?.done?.[c.quest];
  return false;
}
export function wsUnlocked(state, r) {
  if (!r) return false;
  if (unlockedRecipe(state, r.id)) return true;
  return (r.req || []).some((c) => condOk(state, c));
}
function unlockedRecipe(state, id) { try { return unlocked(state, 'recipe', id); } catch { return false; } }
export function wsLockReason(state, r) {
  const parts = [];
  for (const c of r.req || []) {
    if (c.labRecipe) { const nd = recipeNode(c.labRecipe); parts.push(nd ? `Research ${nd.name} in the Lab` : 'Research it in the Lab'); }
    else if (c.lab) parts.push(`Research ${LAB_BY_ID[c.lab]?.name || c.lab} in the Lab`);
    else if (c.ch !== undefined) { const ch = CHAPTERS[c.ch - 1]; parts.push(ch ? `Finish Chapter ${c.ch}: ${ch.title}` : `Finish chapter ${c.ch}`); }
    else if (c.quest) parts.push(`Quest: ${QUEST_BY_ID[c.quest]?.title || c.quest}`);
  }
  return parts.join(' or ') || 'Locked';
}

// ---------------------------------------------------------------- crafting
export function wsSlots(state) { return 2 + (chDone(state) >= 4 ? 1 : 0); }
export function outOwned(state, r) {
  const o = r.out || {};
  switch (o.type) {
    case 'rod': return ownsRod(state, o.id);
    case 'tackle': return ownsTackle(state, o.id);
    case 'boatpart': return !!state.cosmetics?.[`boatpart:${o.slot}:${o.id}`];
    default: return false;
  }
}
export function inQueue(state, rid) { return ensureWorkshop(state).queue.some((q) => q.rid === rid); }

export function wsCheck(state, r) {
  const aero = { have: Math.floor(state.coins || 0), need: r.cost?.aero || 0 };
  aero.ok = aero.have >= aero.need;
  const items = Object.entries(r.cost?.items || {}).map(([id, need]) => { const have = countItem(state, id); return { id, have, need, ok: have >= need }; });
  const W = ensureWorkshop(state);
  const owned = outOwned(state, r);
  const queued = inQueue(state, r.id);
  const slot = !r.time || W.queue.length < wsSlots(state);
  let reason = '';
  if (!wsUnlocked(state, r)) reason = wsLockReason(state, r);
  else if (r.maxed) reason = 'Max level!';
  else if (owned) reason = 'Already yours';
  else if (queued) reason = 'Crafting...';
  else if (!slot) reason = 'Queue full';
  else if (!aero.ok) reason = 'Not enough Aero';
  else if (!items.every((x) => x.ok)) reason = 'Missing materials';
  return { ok: !reason, aero, items, owned, queued, slot, reason };
}

export function wsCraft(game, id) {
  const st = game.state;
  const r = wsRecipe(st, id);
  if (!r) return { ok: false, reason: 'Unknown recipe.' };
  if (r.lab) {
    if (!wsUnlocked(st, r)) return { ok: false, reason: wsLockReason(st, r) };
    const res = labCraft(game, id); // emits 'crafted' itself
    if (res.ok) { const W = ensureWorkshop(st); W.made[id] = (W.made[id] || 0) + 1; W.total++; }
    return { ...res, queued: false };
  }
  const c = wsCheck(st, r);
  if (!c.ok) return { ok: false, reason: c.reason };
  st.coins -= c.aero.need;
  for (const x of c.items) removeItem(st, x.id, x.need);
  const W = ensureWorkshop(st);
  if (r.time > 0) {
    const now = Date.now();
    W.queue.push({ rid: r.id, start: now, end: now + r.time * 1000, name: r.name, icon: r.icon });
    game.emit?.('craftQueued', { id: r.id });
    game.save?.();
    return { ok: true, queued: true };
  }
  const out = finish(game, r);
  return { ok: true, queued: false, out };
}

function finish(game, r) {
  const st = game.state, o = r.out || {};
  const W = ensureWorkshop(st);
  let out = [];
  switch (o.type) {
    case 'rod': giveRod(st, o.id); equipRod(st, o.id); out = [{ rod: o.id }]; game.emit?.('rodCrafted', { id: o.id }); game.emit?.('rodEquipped', o.id); break;
    case 'tackle': giveTackle(st, o.id, true); out = [{ tackle: o.id }]; break;
    case 'rodlevel': setRodLevel(st, o.id, Math.max(rodLevel(st, o.id), o.lv)); out = [{ rod: o.id, lv: o.lv }]; game.emit?.('rodUpgraded', { id: o.id, lv: o.lv }); break;
    case 'boatpart': {
      (st.cosmetics ||= {})[`boatpart:${o.slot}:${o.id}`] = true;
      st.boat ||= { tier: 0, parts: {} };
      (st.boat.parts ||= {})[o.slot] = o.id;
      game.emit?.('boatUpgraded', { part: o.slot, id: o.id });
      out = [{ boatpart: o.id }];
      break;
    }
    case 'gear': {
      (st.tank ||= {}).gear ||= {};
      st.tank.gear[o.id] = Math.max(gearLevel(st, o.id), o.lv);
      try { game.aquarium?.view?.rebuild?.(); } catch { /* aquarium view optional */ }
      game.emit?.('gearBought', { id: o.id, level: o.lv });
      out = [{ gear: o.id, lv: o.lv }];
      break;
    }
    case 'item': addItem(st, o.id, o.qty || 1); out = [{ id: o.id, qty: o.qty || 1 }]; break;
    default: break;
  }
  W.made[r.id] = (W.made[r.id] || 0) + 1;
  W.total++;
  try { game.recomputeStats?.(); } catch { /* ignore */ }
  if (game.fishing) game.fishing.rodC = null; // refresh the cached rod stats
  game.emit?.('crafted', { id: r.id, cat: r.cat, out });
  game.save?.();
  return out;
}

export function wsRemaining(e, now = Date.now()) { return Math.max(0, (e.end - now) / 1000); }
export function wsProgress(e, now = Date.now()) { return Math.min(1, Math.max(0, (now - e.start) / Math.max(1, e.end - e.start))); }
export function wsRushCost(e, now = Date.now()) { return Math.ceil(wsRemaining(e, now) / 6) + 5; }
export function wsRush(game, i) {
  const W = ensureWorkshop(game.state), e = W.queue[i];
  if (!e) return false;
  const cost = wsRushCost(e);
  if ((game.state.coins || 0) < cost) return false;
  game.state.coins -= cost;
  e.end = Date.now();
  wsTick(game);
  return true;
}

// Finishes due crafts; returns the finished recipes (the panel / progression shows a celebration).
export function wsTick(game, now = Date.now()) {
  const st = game.state;
  const W = st?.workshop;
  if (!W?.queue?.length) return [];
  const done = [];
  W.queue = W.queue.filter((e) => {
    if (e.end > now) return true;
    const r = wsRecipe(st, e.rid) || STATIC_BY_ID[e.rid];
    if (r) { finish(game, r); done.push(r); }
    return false;
  });
  for (const r of done) {
    game.toast?.(`Crafted: ${r.name}!`, 'sparkle');
    game.audio?.play?.('ui_unlock');
    game.emit?.('craftDone', { id: r.id });
  }
  return done;
}

export function outLabel(r) {
  const o = r.out || {};
  if (o.type === 'item' || o.type === 'lab') return `${o.qty > 1 ? o.qty + 'x ' : ''}${ITEMS[o.id]?.name || r.name}`;
  if (o.type === 'tackle') return `${TACKLE_BY_ID[o.id]?.slot || ''}`;
  return r.name;
}
export { RODS };
