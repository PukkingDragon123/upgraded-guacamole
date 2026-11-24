// [cur26] Byte Gem timer skips: finish a running timer right now for gems (gems.js skipCost scales with the time left).
//   labSkipCost(state, id) / labSkip(game, id)        Lab research brewing (lab.js slots)
//   wsSkipCost(entry) / wsSkip(game, i)                Workshop crafting bench i (build/workshop.js queue)
//   eggSkipCost(egg) / eggSkip(game, i)                tank egg clutch i (state.tank.eggs, hatched by the Aquarium)
// Each skip returns true when paid and finished; false (nothing spent) when the timer is gone or gems are short.
import { skipCost, spendGems, canSpendGems } from './gems.js';
import { ensureLab, labRemaining, finishResearch } from './lab.js';
import { ensureWorkshop, wsRemaining, wsTick } from '../build/workshop.js';

export function labSkipCost(state, id) { return skipCost(labRemaining(state, id)); }
export function labSkip(game, id) {
  const st = game.state;
  if (!ensureLab(st).slots.some((s) => s.id === id)) return false;
  const c = labSkipCost(st, id);
  if (!c || !canSpendGems(st, c) || !spendGems(st, c, 'skip:lab:' + id)) return false;
  const ok = finishResearch(game, id);
  game.emit?.('timerSkipped', { kind: 'lab', id, gems: c });
  game.save?.();
  return ok;
}

export function wsSkipCost(e) { return e ? skipCost(wsRemaining(e)) : 0; }
export function wsSkip(game, i) {
  const W = ensureWorkshop(game.state), e = W.queue[i];
  if (!e) return false;
  const c = wsSkipCost(e);
  if (!c || !spendGems(game.state, c, 'skip:workshop')) return false;
  e.end = Date.now();
  wsTick(game);
  game.emit?.('timerSkipped', { kind: 'workshop', id: e.rid, gems: c });
  game.save?.();
  return true;
}

export function eggSkipCost(egg) { return egg ? skipCost(Math.max(0, (egg.dur || 0) - (egg.t || 0))) : 0; }
export function eggSkip(game, i) {
  const eggs = game.state.tank?.eggs;
  const egg = eggs?.[i];
  if (!egg) return false;
  const c = eggSkipCost(egg);
  if (!c || !spendGems(game.state, c, 'skip:egg')) return false;
  egg.t = egg.dur; // the Aquarium hatches it on its next update
  game.emit?.('timerSkipped', { kind: 'egg', id: egg.species, gems: c });
  game.save?.();
  return true;
}
