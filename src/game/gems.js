// [cur26] Byte Gems: the glowing pixel-crystal second currency.
// Earned ONLY from quests (story / side stories / milestones / daily orders board) and rare boss
// rewards. Spent on skipping timers (Lab research, Workshop crafting, egg hatching) and on cosmetics.
// No real money anywhere. Balance lives at `state.gems` (number). Changes emit the game event
// 'gemsChanged' { gems, delta, reason } when a game is bound (see bindGemsGame, called by Game).

export const GEM_NAME = 'Byte Gems';
export const GEM_ONE = 'Byte Gem';
export const GEM_SHORT = 'BG';
export const GEM_WELCOME = 30; // one-time gift for saves made before gems existed

let boundGame = null;
export function bindGemsGame(game) { boundGame = game || null; }

function bal(state) {
  if (!state) return 0;
  const n = Number(state.gems);
  if (!Number.isFinite(n) || n < 0) state.gems = 0;
  return state.gems;
}

/** Current gem balance (whole number, default 0). */
export function gems(state) { return Math.floor(bal(state)); }

function changed(state, delta, reason) {
  const g = boundGame;
  if (!g || g.state !== state) return;
  try { g.emit?.('gemsChanged', { gems: state.gems, delta, reason: reason || '' }); } catch (e) { console.error(e); }
}

/** Add n gems (n > 0, rounded). Returns the new balance. */
export function addGems(state, n, reason) {
  n = Math.max(0, Math.round(Number(n) || 0));
  bal(state);
  if (!state || !n) return gems(state);
  state.gems += n;
  state.gemsEarned = (state.gemsEarned || 0) + n;
  changed(state, n, reason);
  return gems(state);
}

export function canSpendGems(state, n) {
  n = Math.max(0, Math.round(Number(n) || 0));
  return gems(state) >= n;
}

/** Spend n gems. Returns true when paid, false (nothing changes) when the balance is too low. */
export function spendGems(state, n, reason) {
  n = Math.max(0, Math.round(Number(n) || 0));
  if (!state || !canSpendGems(state, n)) return false;
  if (!n) return true;
  state.gems -= n;
  state.gemsSpent = (state.gemsSpent || 0) + n;
  changed(state, -n, reason);
  return true;
}

/** Save migration: makes sure state.gems exists; saves from before gems get a one-time welcome gift.
 * Returns the gift amount granted now (0 if none). */
export function ensureGems(state) {
  if (!state) return 0;
  const had = typeof state.gems === 'number' && Number.isFinite(state.gems);
  if (!had) state.gems = 0;
  if (state.gemGift) return 0;
  state.gemGift = true;
  const veteran = (state.totalCoins || 0) > 0 || (state.stats?.caught || 0) > 0 || !!state.tutorialDone;
  if (!had && veteran) { state.gems += GEM_WELCOME; state.gemsEarned = (state.gemsEarned || 0) + GEM_WELCOME; return GEM_WELCOME; }
  return 0;
}

/** Gem price to finish a timer now: scales with the remaining seconds (min 1).
 * ~1 gem per 30 s for the first 5 min, then cheaper per minute for longer timers. */
export function skipCost(remainingSec) {
  const s = Math.max(0, Number(remainingSec) || 0);
  if (s <= 0) return 0;
  const m = s / 60;
  const c = m <= 5 ? m * 2 : 10 + (m - 5) * 1 + Math.max(0, m - 30) * -0.5;
  return Math.max(1, Math.ceil(c));
}

export function fmtGems(n) { return Math.floor(n || 0).toLocaleString('en-US'); }
