// Consumable bait (phase 3). OWNER: Online & AppSea agent.
// Bait is downloaded from AppSea (or crafted/customised in the Lab recipe 'custombait') and is ONE-TIME USE:
// one bait is used up each time a fish is hooked. Desktop icons are no longer bait (they are the game's menu).
//
//   BAITS: {id: {id, name, short, type /* species bait-pref key */, effect /* special bait effect or null */,
//               attract, rarity, size, giant, luck, desc, art, tier, app, source, pack, price, kb}}
//     Special ids keep the old shop ids (bread, worm, sugar, golden, flood, blackhole, chip, popup, lantern, relic)
//     with type === id, so species prefs and the fishing agent's bait effects keep working; 'crumbs' is the free
//     starter (type 'bread'). AppSea app baits are '<appId>_<tierId>' ('notes_lite', 'music_pro' ...) with
//     type = the app's species bait-pref key (docs, folder, music, image, game, mail, terminal ...).
//   ensureBait(state) -> state.bait = {inv:{baitId:count}, custom:[{id, name, base, scent, color, charm, size, mods,
//                                      count, type, effect}], equipped:id|null, known:{id:true}}
//   currentBait(state) -> {id, name, type, kind:'bait', effect, base, count,
//                          mods:{attract, rarity, sizeBonus, giantMul, luck}, mini /*small canvas*/, art}|null
//     `effect` = special effect id (worm|golden|flood|blackhole|chip|popup|lantern|relic) or null; custom bait built
//     on a special base carries its base's effect (and type).
//   consumeBait(state) -> bool             (called by fishing on hook-set; auto-equips a similar bait when out)
//   addBait(state, id, n)                  (marks the bait known; equips it when nothing is equipped)
// Extras: baitDef(state, id), baitList(state), equipBait(state, id), totalBait(state), appBaitId(app, tier),
//   PACK_QTY, SPECIAL_ORDER, custom builder data (CRAFT_BASES, SCENTS, COLOURS, CHARMS, SIZES, BATCHES) with
//   craftBases(state), customRecipe(state, recipe), customCost(state, recipe, batch, deps),
//   canCraft(state, recipe, batch, deps), craftCustom(state, recipe, batch, deps).
//   deps = {unlocked(state) -> bool, known(itemId) -> bool, count(state, itemId), take(state, {itemId: n}) -> bool}
//   (the bait panel builds it from src/game/lab.js + src/build/items.js; this module stays import-cycle free).

import { CATALOG, APP_DEF, TIERS, baitPowerAt, sizeKb, PACK_QTY, appBaitId } from './catalog.js';
import { baitMini, TYPE_ART } from '../fishing/baitart.js';

export { TYPE_ART };

export { PACK_QTY, appBaitId };

// ---------------------------------------------------------------- special bait (old shop ids)
// attract/rarity are kept modest where the fishing agent's bait effects already add their own boost.
const SPECIALS = [
  ['crumbs', 'Bread Crumbs', 'bread', null, { attract: 0.9 }, 'Free crumbs. Common fish nibble anything.', { pack: 10, price: 0, kb: 0 }],
  ['bread', 'Fresh Bread', 'bread', null, { attract: 1.15 }, 'Cheap and cheerful. Common fish love it.', { pack: 6, price: 6, kb: 40 }],
  ['worm', 'Glowing Worm', 'worm', 'worm', { attract: 1.3 }, 'Wiggles and glows. Most fish find it irresistible.', { pack: 3, price: 24, kb: 180 }],
  ['sugar', 'Sugar Cube', 'sugar', null, { attract: 1.2, size: 0.03 }, 'Sweet-toothed fish (and puddings) adore it.', { pack: 3, price: 30, kb: 320 }],
  ['chip', 'Overclocked Chip', 'chip', 'chip', { attract: 1.2, rarity: 1.05 }, 'Sparks attract mechanical and digital fish.', { pack: 3, price: 60, kb: 1400 }],
  ['popup', 'Pop-up Ad', 'popup', 'popup', { attract: 1.25 }, '"YOU WON A FREE FISH!" Spam fish can\'t resist.', { pack: 3, price: 40, kb: 650 }],
  ['flood', 'Flood Bait', 'flood', 'flood', { attract: 1.1 }, 'Raises the water over your whole desktop for a while.', { pack: 1, price: 90, kb: 4800 }],
  ['lantern', 'Lantern Pearl', 'lantern', 'lantern', { attract: 1.2, rarity: 1.08 }, 'A glowing pearl for the deep. Deep fish follow the light.', { pack: 2, price: 150, kb: 2600 }],
  ['golden', 'Golden Bait', 'golden', 'golden', { attract: 1.1, rarity: 1.15, giant: 1.3 }, 'Everything glitters. Rare fish come running.', { pack: 1, price: 140, kb: 9000 }],
  ['blackhole', 'Black Hole Bait', 'blackhole', 'blackhole', { attract: 1.4, rarity: 1.1 }, 'Pulls icons and deep fish toward your hook.', { pack: 1, price: 320, kb: 26000 }],
  ['relic', 'Ancient Relic', 'relic', 'relic', { attract: 1.2, rarity: 1.2, giant: 1.5 }, 'Something ancient answers. Use it in the deep.', { pack: 1, price: 1250, kb: 160000 }],
];
export const SPECIAL_ORDER = SPECIALS.map((s) => s[0]);

// AppSea listings for downloadable special bait (category 'bait').
export const SPECIAL_SHOP = {
  bread: { title: 'Bread.zip', publisher: 'Crumb Bakery', version: '1.0' },
  worm: { title: 'GlowWorm Screensaver', publisher: 'Wiggle Soft', version: '3.1' },
  sugar: { title: 'Sugar Rush', publisher: 'Candy Clam', version: '2.0' },
  chip: { title: 'Overclock Utility', publisher: 'Root Beer Labs', version: '9000' },
  popup: { title: 'PopUp Generator', publisher: 'TotallyLegitAds', version: '2000' },
  flood: { title: 'FloodGate Installer', publisher: 'Tide Systems', version: '1.2' },
  lantern: { title: 'Lantern Pearl Theme', publisher: 'Glow & Co.', version: 'Vista' },
  golden: { title: 'GoldRush Toolbar', publisher: 'Shiny Inc.', version: '24K' },
  blackhole: { title: 'BlackHole.exe', publisher: 'Event Horizon', version: '0.0' },
  relic: { title: 'Ancient Relic.iso', publisher: 'Unknown', version: '???' },
};

export const BAITS = {};

for (const [id, name, type, effect, m, desc, shop] of SPECIALS) {
  BAITS[id] = {
    id, name, short: name, type, effect, desc, tier: -1, app: null, source: id === 'crumbs' ? 'starter' : 'appsea',
    attract: m.attract ?? 1, rarity: m.rarity ?? 1, size: m.size ?? 0, giant: m.giant ?? 1, luck: m.luck ?? 0,
    pack: shop.pack, price: shop.price, kb: shop.kb, art: { shape: id },
  };
}

for (const fam of CATALOG) {
  const type = APP_DEF[fam.id]?.type || 'docs';
  const [c1, c2] = TYPE_ART[type] || TYPE_ART.docs;
  for (let tier = 0; tier < TIERS.length; tier++) {
    const p = baitPowerAt(fam.id, tier), k = p - 1;
    const id = appBaitId(fam.id, tier);
    BAITS[id] = {
      id, name: `${fam.name} ${TIERS[tier].name}`, short: fam.name, type, effect: null, tier, app: fam.id, source: 'appsea',
      desc: fam.desc[tier], power: p,
      attract: Math.round((1.05 + k * 0.45) * 100) / 100, rarity: Math.round((1 + k * 0.3) * 100) / 100,
      size: Math.round(k * 0.07 * 1000) / 1000, giant: Math.round((1 + k * 0.9) * 100) / 100, luck: Math.round(k * 0.1 * 100) / 100,
      pack: PACK_QTY[tier], kb: sizeKb(fam.id, tier),
      art: { shape: 'grub', color: c1, color2: c2, tier, type },
    };
  }
}

const modsOf = (d) => ({ attract: d.attract, rarity: d.rarity, sizeBonus: d.size, giantMul: d.giant, luck: d.luck });

// ---------------------------------------------------------------- custom bait builder (Lab recipe 'custombait')
export const CRAFT_BASES = ['crumbs', 'bread', 'worm', 'sugar', 'chip', 'popup', 'lantern', 'golden'];
const BASE_COST = {
  crumbs: { kelp_fibre: 1 }, bread: { kelp_fibre: 1, driftwood: 1 }, worm: { kelp_fibre: 2 }, sugar: { shell: 1, coral_chunk: 1 },
  chip: { circuit_board: 1, scrap_metal: 1 }, popup: { scrap_metal: 2 }, lantern: { pearl: 1, sea_glass: 1 }, golden: { pearl: 1, shell: 3 },
};
export const SCENTS = [
  { id: 'none', name: 'Plain', adj: '', color: '#ffffff', mods: {}, cost: {} },
  { id: 'kelp', name: 'Kelp Musk', adj: 'Musky', color: '#5fd068', mods: { attract: 1.15 }, cost: { kelp_fibre: 2 } },
  { id: 'citrus', name: 'Citrus Zest', adj: 'Zesty', color: '#ffd23a', mods: { attract: 1.25 }, cost: { shell: 2, kelp_fibre: 1 } },
  { id: 'brine', name: 'Deep Brine', adj: 'Briny', color: '#3a8aff', mods: { rarity: 1.12 }, cost: { sea_glass: 2 } },
  { id: 'ozone', name: 'Ozone Spark', adj: 'Fizzy', color: '#b48aff', mods: { rarity: 1.08, attract: 1.1 }, cost: { circuit_board: 1 } },
];
export const COLOURS = [
  { id: 'aqua', name: 'Aqua', hex: '#38d6f0', mods: { attract: 1.03 } },
  { id: 'lime', name: 'Lime', hex: '#8ee04a', mods: { sizeBonus: 0.02 } },
  { id: 'sun', name: 'Sunshine', hex: '#ffd23a', mods: { rarity: 1.03 } },
  { id: 'coral', name: 'Coral', hex: '#ff7a6a', mods: { attract: 1.04 } },
  { id: 'violet', name: 'Violet', hex: '#9a6af0', mods: { giantMul: 1.08 } },
  { id: 'pearl', name: 'Pearl', hex: '#eef4ff', mods: { luck: 0.03 } },
];
export const CHARMS = [
  { id: 'none', name: 'No charm', adj: '', mods: {}, cost: {} },
  { id: 'star', name: 'Star', adj: 'Star', mods: { rarity: 1.25 }, cost: { pearl: 1 } },
  { id: 'heart', name: 'Heart', adj: 'Lovely', mods: { attract: 1.3 }, cost: { coral_chunk: 2 } },
  { id: 'gem', name: 'Gem', adj: 'Gem', mods: { sizeBonus: 0.12 }, cost: { sea_glass: 3 } },
  { id: 'clover', name: 'Clover', adj: 'Lucky', mods: { luck: 0.1, rarity: 1.1, attract: 1.1 }, cost: { pearl: 1, shell: 2 } },
  { id: 'crown', name: 'Crown', adj: 'Royal', mods: { giantMul: 1.6 }, cost: { golden_scale: 1 } },
];
export const SIZES = [
  { id: 's', name: 'Small', adj: 'Mini', scale: 0.8, mods: { attract: 1.15, sizeBonus: -0.04 }, cost: {} },
  { id: 'm', name: 'Medium', adj: '', scale: 1, mods: {}, cost: {} },
  { id: 'l', name: 'Large', adj: 'Jumbo', scale: 1.25, mods: { attract: 0.9, sizeBonus: 0.08, giantMul: 1.3 }, cost: { kelp_fibre: 1 } },
];
export const BATCHES = [5, 10, 20];
export const DEFAULT_RECIPE = { base: 'crumbs', scent: 'none', color: 'aqua', charm: 'none', size: 'm' };
const AERO_PER_MISSING = 15; // a material the item registry does not know is paid in Aero instead

const byId = (list, id) => list.find((o) => o.id === id) || list[0];

// ---------------------------------------------------------------- state
export function ensureBait(state) {
  const b = (state.bait ||= { inv: {}, custom: [], equipped: null, known: {} });
  if (!b.inv || typeof b.inv !== 'object') b.inv = {};
  if (!Array.isArray(b.custom)) b.custom = [];
  b.known ||= {};
  if (b.equipped === undefined) b.equipped = null;
  if (!b.starter) {
    b.starter = true;
    b.inv.crumbs = (b.inv.crumbs || 0) + 10;
    b.known.crumbs = true;
    // veterans: one pack of every app tier they had installed (apps used to be reusable desktop bait)
    const tiers = state.apps?.tiers || {};
    for (const [app, t] of Object.entries(tiers)) {
      const id = appBaitId(app, t);
      if (BAITS[id]) { b.inv[id] = (b.inv[id] || 0) + BAITS[id].pack; b.known[id] = true; }
    }
    const eq = state.equipped;
    if (!b.equipped) b.equipped = eq?.kind === 'special' && BAITS[eq.id] ? eq.id : 'crumbs';
  }
  // legacy special bait counts (old shop / crates / tutorial write state.baits) drain into the new inventory
  const old = state.baits;
  if (old && typeof old === 'object') {
    for (const k in old) {
      const n = old[k] | 0;
      if (n > 0 && BAITS[k]) { b.inv[k] = (b.inv[k] || 0) + n; b.known[k] = true; }
      delete old[k];
    }
  }
  return b;
}

export function baitDef(state, id) {
  if (!id) return null;
  if (BAITS[id]) return BAITS[id];
  const c = ensureBait(state).custom.find((q) => q.id === id);
  return c ? customDef(c) : null;
}

function customDef(c) {
  const base = BAITS[c.base] || BAITS.crumbs;
  const col = byId(COLOURS, c.color);
  return {
    id: c.id, name: c.name, short: c.name, type: base.type, effect: base.effect, tier: base.tier, app: base.app, source: 'custom',
    desc: `Custom ${base.name}`, custom: true, recipe: c,
    attract: c.mods.attract, rarity: c.mods.rarity, size: c.mods.sizeBonus, giant: c.mods.giantMul, luck: c.mods.luck,
    art: { ...base.art, color: col.hex, charm: c.charm, scale: byId(SIZES, c.size).scale, scent: byId(SCENTS, c.scent).color, custom: true },
  };
}

export function countOf(state, id) {
  const b = ensureBait(state);
  if (BAITS[id]) return b.inv[id] || 0;
  return b.custom.find((q) => q.id === id)?.count || 0;
}

export function totalBait(state) {
  const b = ensureBait(state);
  let n = 0;
  for (const k in b.inv) n += b.inv[k] | 0;
  for (const c of b.custom) n += c.count | 0;
  return n;
}

// Inventory entries, specials first, then app bait by tier, then custom bait.
export function baitList(state) {
  const b = ensureBait(state);
  const out = [];
  for (const id of SPECIAL_ORDER) if (b.inv[id] > 0) out.push({ id, count: b.inv[id], def: BAITS[id] });
  const apps = Object.keys(b.inv).filter((id) => BAITS[id]?.app && b.inv[id] > 0);
  apps.sort((a, c) => BAITS[a].tier - BAITS[c].tier || BAITS[a].name.localeCompare(BAITS[c].name));
  for (const id of apps) out.push({ id, count: b.inv[id], def: BAITS[id] });
  for (const c of b.custom) if (c.count > 0) out.push({ id: c.id, count: c.count, def: customDef(c), custom: true });
  return out;
}

export function addBait(state, id, n = 1) {
  const b = ensureBait(state);
  n = Math.max(0, Math.floor(n));
  if (!n) return;
  const c = b.custom.find((q) => q.id === id);
  if (c) c.count += n;
  else if (BAITS[id]) { b.inv[id] = (b.inv[id] || 0) + n; b.known[id] = true; }
  else return;
  if (!b.equipped || countOf(state, b.equipped) <= 0) b.equipped = id;
}

export function equipBait(state, id) {
  const b = ensureBait(state);
  if (id === null) { b.equipped = null; return true; }
  if (countOf(state, id) <= 0) return false;
  b.equipped = id;
  return true;
}

const curCache = new Map();
export function currentBait(state) {
  const b = ensureBait(state);
  const id = b.equipped;
  if (!id) return null;
  const n = countOf(state, id);
  if (n <= 0) return null;
  const def = baitDef(state, id);
  if (!def) return null;
  let o = curCache.get(id);
  if (!o || o.def !== def) {
    let mini = null;
    try { mini = baitMini(def.art); } catch (e) { mini = null; }
    o = { id, name: def.name, label: def.name, type: def.type, kind: 'bait', effect: def.effect, base: def.recipe?.base || id, count: n, mods: modsOf(def), mini, art: def.art, def };
    curCache.set(id, o);
    if (curCache.size > 64) curCache.delete(curCache.keys().next().value);
  }
  o.count = n;
  return o;
}

// One bait used up (hook-set). When the stack runs out, equips the weakest bait of the same type, else crumbs.
export function consumeBait(state) {
  const b = ensureBait(state);
  const id = b.equipped;
  if (!id) return false;
  const c = b.custom.find((q) => q.id === id);
  if (c) {
    if (c.count <= 0) return false;
    c.count--;
    if (c.count <= 0) { b.custom = b.custom.filter((q) => q !== c); b.equipped = null; }
  } else {
    if (!b.inv[id]) return false;
    if (--b.inv[id] <= 0) { delete b.inv[id]; b.equipped = null; }
  }
  if (!b.equipped) {
    b.lastOut = { id, at: Date.now() };
    const type = (c ? customDef(c) : BAITS[id])?.type;
    const same = baitList(state).filter((e) => e.def.type === type && !e.def.effect);
    same.sort((x, y) => (x.def.attract || 1) - (y.def.attract || 1));
    b.equipped = same[0]?.id || (b.inv.crumbs > 0 ? 'crumbs' : null);
  }
  return true;
}

// ---------------------------------------------------------------- custom builder
// Bases the player may build on: always crumbs, plus every craftable base / app bait they have owned.
export function craftBases(state) {
  const b = ensureBait(state);
  const out = CRAFT_BASES.filter((id) => id === 'crumbs' || b.known[id]);
  const apps = Object.keys(b.known).filter((id) => BAITS[id]?.app);
  apps.sort((a, c) => BAITS[a].tier - BAITS[c].tier || BAITS[a].name.localeCompare(BAITS[c].name));
  return out.concat(apps);
}

function mulMods(m, add) {
  for (const [k, v] of Object.entries(add || {})) {
    if (k === 'sizeBonus' || k === 'luck') m[k] += v;
    else m[k] *= v;
  }
  return m;
}

export function customRecipe(state, r = {}) {
  const base = BAITS[r.base] ? r.base : 'crumbs';
  const rec = { base, scent: byId(SCENTS, r.scent).id, color: byId(COLOURS, r.color).id, charm: byId(CHARMS, r.charm).id, size: byId(SIZES, r.size).id };
  const m = modsOf(BAITS[base]);
  for (const part of [byId(SCENTS, rec.scent), byId(COLOURS, rec.color), byId(CHARMS, rec.charm), byId(SIZES, rec.size)]) mulMods(m, part.mods);
  for (const k of Object.keys(m)) m[k] = Math.round(m[k] * 1000) / 1000;
  m.sizeBonus = Math.max(-0.1, m.sizeBonus);
  const sc = byId(SCENTS, rec.scent), ch = byId(CHARMS, rec.charm), sz = byId(SIZES, rec.size);
  const short = BAITS[base].short.replace(/^Bread /, '');
  const name = [sz.adj, sc.adj, ch.adj, short].filter(Boolean).join(' ').slice(0, 28);
  rec.id = 'c_' + [base, rec.scent, rec.color, rec.charm, rec.size].join('.');
  rec.name = name;
  rec.mods = m;
  return rec;
}

// Material + Aero cost of a batch: {items:{id:n}, aero}
export function customCost(state, r, batch = 5, deps = {}) {
  const rec = customRecipe(state, r);
  const mul = Math.max(1, Math.round(batch / 5));
  const items = {};
  const base = BAITS[rec.base];
  const parts = [BASE_COST[rec.base] || (base?.app ? { driftwood: 1, kelp_fibre: 1, fish_sample: Math.max(0, base.tier) } : { kelp_fibre: 1 }),
    byId(SCENTS, rec.scent).cost, byId(CHARMS, rec.charm).cost, byId(SIZES, rec.size).cost];
  let aero = (5 + Math.max(0, base?.tier ?? 0) * 12) * mul;
  for (const p of parts) for (const [id, q] of Object.entries(p || {})) {
    if (!q) continue;
    if (!deps.known || deps.known(id)) items[id] = (items[id] || 0) + q * mul;
    else aero += AERO_PER_MISSING * q * mul;
  }
  return { items, aero };
}

export function canCraft(state, r, batch = 5, deps = {}) {
  if (deps.unlocked && !deps.unlocked(state)) return { ok: false, reason: 'locked' };
  const rec = customRecipe(state, r);
  if (!craftBases(state).includes(rec.base)) return { ok: false, reason: 'base' };
  const cost = customCost(state, rec, batch, deps);
  if ((state.coins || 0) < cost.aero) return { ok: false, reason: 'aero', cost };
  for (const [id, q] of Object.entries(cost.items)) if ((deps.count ? deps.count(state, id) : 0) < q) return { ok: false, reason: 'items', cost, missing: id };
  return { ok: true, cost };
}

export function craftCustom(state, r, batch = 5, deps = {}) {
  const chk = canCraft(state, r, batch, deps);
  if (!chk.ok) return chk;
  const rec = customRecipe(state, r);
  if (Object.keys(chk.cost.items).length && !(deps.take && deps.take(state, chk.cost.items))) return { ok: false, reason: 'items', cost: chk.cost };
  state.coins -= chk.cost.aero;
  const b = ensureBait(state);
  let c = b.custom.find((q) => q.id === rec.id);
  if (!c) {
    c = { id: rec.id, name: rec.name, base: rec.base, scent: rec.scent, color: rec.color, charm: rec.charm, size: rec.size, mods: rec.mods, count: 0 };
    b.custom.push(c);
    if (b.custom.length > 24) b.custom = b.custom.filter((q) => q.count > 0 || q === c).slice(-24);
  }
  c.mods = rec.mods;
  c.count += batch;
  if (!b.equipped || countOf(state, b.equipped) <= 0) b.equipped = c.id;
  return { ok: true, bait: c, cost: chk.cost };
}
