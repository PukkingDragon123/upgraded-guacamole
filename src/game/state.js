// Persistent game state (localStorage) with defaults and light migration.

const KEY = 'fishtop.save.v1';

export function defaultState() {
  return {
    v: 1,
    created: Date.now(),
    lastSeen: Date.now(),
    coins: 0,
    totalCoins: 0,
    tutorialDone: false,
    tutorialStep: 0,
    biome: 'shallows',
    unlockedBiomes: ['shallows'],
    skills: {},
    baits: { bread: 3 },
    equipped: null, // { kind: 'icon', id } | { kind: 'special', id }
    baitBox: [], // icon ids stored in the bait box
    files: [], // virtual bait made from dropped files: {id, name, icon, type}
    icons: {}, // icon id -> {gx, gy} custom grid positions
    fish: [], // owned fish records
    tank: { decor: [], substrate: 'sand', theme: 'reef' },
    journal: {}, // species id -> {seen, caught, maxSize, minSize, first, variants: {}}
    secrets: {},
    stats: { caught: 0, escaped: 0, snapped: 0, released: 0, coinsCollected: 0, playTime: 0, casts: 0 },
    settings: {
      master: 0.8, music: 0.55, sfx: 0.8, ambience: 0.6,
      oceanOpacity: 1, dayCycle: 'real', reducedMotion: false, lowPower: false,
      showFps: false, wallpaper: 'ocean', browserFish: true, hints: true,
    },
    view: 'ocean', // 'ocean' | 'aquarium'
    tankWindow: { open: false, x: 0, y: 0 },
  };
}

function merge(base, saved) {
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return saved ?? base;
  const out = { ...base };
  for (const k of Object.keys(saved)) {
    if (base && typeof base[k] === 'object' && base[k] !== null && !Array.isArray(base[k])) out[k] = merge(base[k], saved[k]);
    else out[k] = saved[k];
  }
  return out;
}

export function loadState() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultState();
    return merge(defaultState(), JSON.parse(raw));
  } catch {
    return defaultState();
  }
}

export function saveState(state) {
  try {
    state.lastSeen = Date.now();
    localStorage.setItem(KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

export function resetState() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  return defaultState();
}

export function exportState(state) {
  return btoa(unescape(encodeURIComponent(JSON.stringify(state))));
}

export function importState(code) {
  return merge(defaultState(), JSON.parse(decodeURIComponent(escape(atob(code.trim())))));
}
