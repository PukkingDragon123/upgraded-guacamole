// [food24] Fish food as progression: Reef Flakes are the starter food; every other food is unlocked through the game's
// progression (Lab research or a side-story reward) and has its own modest effect in the tank sim (src/aquarium/aquarium.js).
// Data + rules only (no art): the voxel looks and sinking physics live in src/aquarium/food.js.
//
//   FOOD_ORDER                 tray order
//   FOOD_DATA[id] {name, short, perk, how: {starter} | {lab: nodeId} | {quest: questId}, meal: {...} | null}
//     meal: what a fish gets for a while after eating it (rec.meal = {f, until}); all optional:
//       min      minutes the meal lasts         hunger  x hunger growth          fill  x hunger filled per bite / Feed all
//       happy    happiness per bite              mood    + happiness target        grow  x evolution speed
//       aero     x Aero/min                      court   romance at lower happiness, shorter rest between clutches
//       mutate / shiny  x mutation / shiny odds of eggs laid by a parent on this meal
//   hasFood(state, id)         unlocked? (Lab unlock kind 'food': state.lab.unlocks['food:<id>'], flakes always)
//   ownedFoods(state)          unlocked ids in tray order
//   ensureFoods(state)         one-time save migration (state.tank.foodV): Lab foods researched past (a later node in the
//                              row is done) are granted, the food a save had picked stays, Bloodworms for saves past ch2
//   foodSource(id)             {kind: 'starter'} | {kind: 'lab', node} | {kind: 'quest', id}
//   foodLock(game, id)         {how (one line for the tooltip), open (bool: the source can be worked on now), why}
//   mealOf(rec)                the active meal effects of a tank fish (FOOD_DATA[..].meal) or null
import { unlocked, grantUnlock, ensureLab, LAB_BY_ID, LAB_NODES, LAB_CHILDREN, labStatus, questGateInfo } from './lab.js';

export const STARTER_FOOD = 'flakes';
export const FOOD_ORDER = ['flakes', 'pellets', 'worms', 'shrimp', 'krill'];
export const FOOD_DATA = {
  flakes: { name: 'Reef Flakes', short: 'Flakes', perk: 'Everyday food. Every fish likes it.', how: { starter: true }, meal: null },
  pellets: { name: 'Pop Pellets', short: 'Pellets', perk: 'Hearty: fills 35% more, fish stay full longer', how: { lab: 'food_pellets' },
    meal: { min: 12, fill: 1.35, hunger: 0.65 } },
  worms: { name: 'Bloodworms', short: 'Worms', perk: 'Feast: much happier fish that grow up faster', how: { quest: 's2_worms' },
    meal: { min: 10, fill: 1.15, happy: 0.035, mood: 0.08, grow: 1.5 } },
  shrimp: { name: 'Brine Shrimp', short: 'Shrimp', perk: 'Lively: +10% AB/min and easier romance', how: { lab: 'food_shrimp' },
    meal: { min: 10, happy: 0.02, aero: 1.1, court: true } },
  krill: { name: 'Golden Krill', short: 'Krill', perk: 'Golden: +15% AB/min, eggs mutate 2x as often', how: { quest: 's5_krill' },
    meal: { min: 12, fill: 1.2, happy: 0.03, aero: 1.15, mutate: 2, shiny: 1.5 } },
};

export function hasFood(state, id) {
  if (!FOOD_DATA[id]) return false;
  return id === STARTER_FOOD || unlocked(state, 'food', id);
}
export function ownedFoods(state) { return FOOD_ORDER.filter((id) => hasFood(state, id)); }

export function foodSource(id) {
  const h = FOOD_DATA[id]?.how || {};
  if (h.lab && LAB_BY_ID[h.lab]) return { kind: 'lab', node: LAB_BY_ID[h.lab] };
  if (h.quest) return { kind: 'quest', id: h.quest };
  return { kind: 'starter' };
}

// a node that a later done node needs (directly or further down its row) counts as researched
function researchedPast(L, id, seen = new Set()) {
  for (const c of LAB_CHILDREN[id] || []) {
    if (seen.has(c)) continue;
    seen.add(c);
    if (L.done[c] || researchedPast(L, c, seen)) return true;
  }
  return false;
}

export function ensureFoods(state) {
  if (!state || typeof state !== 'object') return;
  const T = (state.tank ||= {});
  if ((T.foodV | 0) >= 1) return;
  T.foodV = 1;
  const L = ensureLab(state);
  // the food nodes were added to the Tank Life row: a save that already researched past them keeps going
  for (const nd of LAB_NODES) {
    if (!nd.unlock.some((u) => u.kind === 'food') || L.done[nd.id] || !researchedPast(L, nd.id)) continue;
    L.done[nd.id] = Date.now();
    (state.skills ||= {})[nd.id] = true;
    for (const u of nd.unlock) grantUnlock(state, u.kind, u.id);
  }
  // the food a save was using stays (every food used to be free); Bloodworms for saves already past Marina's chapter
  if (T.food && FOOD_DATA[T.food] && T.food !== 'krill') {
    grantUnlock(state, 'food', T.food);
    const nd = foodSource(T.food).node; // its Lab node counts as researched (never pay for a food you have)
    if (nd && !L.done[nd.id] && nd.req.every((r) => L.done[r])) { L.done[nd.id] = Date.now(); (state.skills ||= {})[nd.id] = true; }
  }
  if ((state.quests?.ch | 0) >= 2) grantUnlock(state, 'food', 'worms');
}

// How to unlock a food, for the tray tooltip and its click: {how, open, why, src, quest}
export function foodLock(game, id) {
  const st = game?.state || {}, src = foodSource(id);
  if (src.kind === 'lab') {
    const nd = src.node, s = labStatus(st, nd.id);
    const qi = questGateInfo(nd);
    let why = '';
    if (s === 'researching') why = 'Researching now...';
    else if (s === 'locked') why = `Research ${LAB_BY_ID[nd.req[0]]?.name || 'the node before it'} first.`;
    else if (qi && !st.quests?.done?.[qi.id]) why = `Sealed: finish "${qi.title}" first.`;
    return { src, how: `Research ${nd.name} in the Lab`, open: true, why };
  }
  if (src.kind === 'quest') {
    const book = game?.quests?.book, q = book?.quest?.(src.id);
    const npc = { seal: 'Bubbles', fizz: 'Professor Fizz', marina: 'Marina', dot: 'Dot', bloat: 'Captain Bloat' }[q?.giver] || 'a friend';
    const chN = Number(String(q?.chapter || '').replace(/\D/g, '')) || 0;
    const how = q ? `Reward from ${npc}'s side story "${q.title}"${chN ? ` (Chapter ${chN})` : ''}` : 'A quest reward';
    let open = !!(q && book.available?.(q)), why = '';
    if (q && book.isReady?.(q.id)) why = 'Ready! Claim it in the Quest Log.';
    else if (q && !open) {
      const after = q.after && !book.isDone?.(q.after) ? book.quest?.(q.after) : null;
      const reached = book.chapterReached?.(q.chapter) ?? true;
      why = !reached && chN ? `Opens in Chapter ${chN}.` : after ? `Opens after "${after.title}".` : 'Not open yet.';
    }
    return { src, how, open, why, quest: q };
  }
  return { src, how: 'Always in your tank cupboard', open: true, why: '' };
}

export function mealOf(rec) {
  const m = rec?.meal;
  if (!m || !(m.until > Date.now())) return null;
  return FOOD_DATA[m.f]?.meal || null;
}
