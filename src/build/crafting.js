// Crafting (phase 3). OWNER: Lab agent. Recipes are unlocked in The Lab (unlock kind 'recipe') and turn Aero +
// materials into building blueprints, aquarium decor, tank decor plans or bait. Crafting is instant.
// Phase 10: everything built from them is placed in the TANK (aquarium build mode).
//   RECIPES: [{id, cat, name, icon /* labIcon key */, out: {id, qty} | null, cost: {aero, items}, desc}]
//     cat: 'building' (bp_<buildingId> -> blueprint, placed in build mode), 'decor' (decor_<propId> -> straight into
//          the aquarium, or the inventory when it is full), 'plans' (plans_<propId> -> tank decor blueprint),
//          'bait' (bait_<baitId> -> store/bait.js addBait), 'special' (custombait -> opens the Bait panel's mixer)
//   RECIPE_BY_ID, CRAFT_CATS [{id, name, icon}]
//   recipeUnlocked(state, id), recipeNode(id) -> the Lab node that unlocks it (null = starter)
//   craftCheck(state, r, n = 1) -> {ok, aero:{have, need, ok}, items:[{id, have, need, ok}]}
//   craft(game, id, n = 1) -> {ok, reason, out:[{id, qty}], placed}
import { BUILDINGS, BUILDING_ORDER, DECOR_BUILDS, RECIPES as BAIT_PRESS } from './buildings.js';
import { ITEMS, addItem, countItem } from './items.js';
import { PROPS } from '../gfx/props.js';
import { unlocked, nodeFor, DECOR_SETS } from '../game/lab.js';
import { BAITS as STORE_BAITS } from '../store/bait.js';

export const CRAFT_CATS = [
  { id: 'building', name: 'Buildings', icon: 'bp:coral_garden' },
  { id: 'decor', name: 'Aquarium Decor', icon: 'decor' },
  { id: 'plans', name: 'Tank Plans', icon: 'bp:lighthouse' }, // [phase10:tank] everything is built in the tank
  { id: 'bait', name: 'Bait', icon: 'bait:worm' },
];

const SIZE_ITEMS = [null, { shell: 1, kelp_fibre: 1 }, { shell: 2, coral_chunk: 1 }, { driftwood: 3, sea_glass: 2 }];
const RICH_ITEMS = { 400: { pearl: 1 }, 800: { gear: 2 }, 1200: { ancient_stone: 1 } };
function decorCost(price, size) {
  const items = { ...(SIZE_ITEMS[size] || SIZE_ITEMS[1]) };
  for (const [p, extra] of Object.entries(RICH_ITEMS)) if (price >= Number(p)) for (const [k, v] of Object.entries(extra)) items[k] = (items[k] || 0) + v;
  return { aero: Math.max(5, Math.round(price * 0.45)), items };
}

export const RECIPES = [];
const R = (o) => RECIPES.push({ desc: '', ...o });

for (const id of BUILDING_ORDER) {
  const b = BUILDINGS[id];
  R({ id: 'bp_' + id, cat: 'building', name: b.name, icon: 'bp:' + id, out: { id: 'bp_' + id, qty: 1 }, cost: { aero: b.cost.coins || 0, items: { ...(b.cost.items || {}) } }, desc: b.desc });
}
const decorIds = ['rubber_duck', ...new Set(Object.values(DECOR_SETS).flatMap((s) => s.decor))];
for (const id of decorIds) {
  const p = PROPS[id];
  if (!p?.decor) continue;
  R({ id: 'decor_' + id, cat: 'decor', name: p.name, icon: 'mat:' + id, out: { id, qty: 1 }, cost: decorCost(p.decor.price, p.decor.size) });
}
const planIds = [...new Set(Object.values(DECOR_SETS).flatMap((s) => s.plans))];
for (const id of planIds) {
  const d = DECOR_BUILDS[id];
  if (!d || !ITEMS['bp_' + id]) continue;
  const c = decorCost(PROPS[id]?.decor?.price || 200, d.size || 1);
  R({ id: 'plans_' + id, cat: 'plans', name: d.name, icon: 'mat:' + id, out: { id: 'bp_' + id, qty: 1 }, cost: { aero: Math.max(d.cost?.coins || 0, Math.round(c.aero * 0.6)), items: { ...c.items, driftwood: (c.items.driftwood || 0) + 2 } }, desc: d.desc });
}
for (const b of BAIT_PRESS) {
  if (!STORE_BAITS?.[b.id] && !ITEMS[b.id]) continue;
  R({ id: 'bait_' + b.id, cat: 'bait', name: STORE_BAITS?.[b.id]?.name || ITEMS[b.id]?.name || b.id, icon: 'bait:' + b.id, out: { id: b.id, qty: b.qty }, cost: { aero: b.coins || 0, items: { ...b.items } }, desc: STORE_BAITS?.[b.id]?.desc || '' });
}
R({ id: 'custombait', cat: 'bait', name: 'Bait Mixer', icon: 'beaker', out: null, cost: { aero: 0, items: {} }, desc: 'Mix your own bait: scent, colour, charm.' });

export const RECIPE_BY_ID = Object.fromEntries(RECIPES.map((r) => [r.id, r]));

export function recipeNode(id) { return nodeFor('recipe', id); }
export function recipeUnlocked(state, id) { return !!unlocked(state, 'recipe', id) || (id === 'bait_bread'); }

export function craftCheck(state, r, n = 1) {
  const aero = { have: Math.floor(state.coins || 0), need: (r.cost.aero || 0) * n };
  aero.ok = aero.have >= aero.need;
  const items = Object.entries(r.cost.items || {}).map(([id, q]) => { const have = countItem(state, id); return { id, have, need: q * n, ok: have >= q * n }; });
  return { ok: aero.ok && items.every((x) => x.ok), aero, items };
}

export function craft(game, id, n = 1) {
  const st = game.state, r = RECIPE_BY_ID[id];
  if (!r) return { ok: false, reason: 'Unknown recipe.' };
  if (!recipeUnlocked(st, id)) return { ok: false, reason: 'Research it in the Lab first.' };
  if (r.cat === 'special') { game.ui?.open?.('bait', { tab: 'craft' }); return { ok: true, out: [] }; }
  const c = craftCheck(st, r, n);
  if (!c.ok) return { ok: false, reason: c.aero.ok ? 'Missing materials.' : 'Not enough Aero.' };
  st.coins -= c.aero.need;
  const inv = (st.inventory ||= { items: {}, packages: [] }).items ||= {};
  for (const x of c.items) { inv[x.id] = (inv[x.id] || 0) - x.need; if (inv[x.id] <= 0) delete inv[x.id]; }
  const out = [{ id: r.out.id, qty: r.out.qty * n }];
  let placed = 0;
  if (r.cat === 'decor') {
    for (let i = 0; i < out[0].qty; i++) {
      let ok = false;
      try { ok = !!game.aquarium?.addDecor?.(r.out.id); } catch { ok = false; }
      if (ok) placed++; else addItem(st, r.out.id, 1);
    }
  } else addItem(st, r.out.id, out[0].qty);
  game.emit?.('crafted', { id, out });
  game.save?.();
  return { ok: true, out, placed };
}
