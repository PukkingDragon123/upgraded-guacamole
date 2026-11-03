// Host bridge: the game's single point of contact with the Electron shell (phase 4, Shell agent).
// In Electron, electron/preload.cjs exposes window.fishtopHost; in a plain browser every call falls back to the
// Fullscreen API or a safe no-op. FISHTOP runs as a normal windowed or fullscreen game; the old overlay,
// click-through, wallpaper and mini modes and the Desktop-folder access are gone.
//
//   host.kind               'web' | 'electron'
//   host.mode               'window' | 'fullscreen' (the mode the page started in)
//   host.platform           process.platform in Electron, 'web' otherwise
//   host.isFullscreen()     -> bool
//   host.setFullscreen(on)  host.toggleFullscreen()   (Electron: the window; web: document.documentElement)
//   host.onFullscreen(cb)   cb(on) -> unsubscribe
//   host.onShortcut(cb)     cb(id) -> unsubscribe; ids: 'fullscreen' (F11 / Alt+Enter on web)
//   host.quit()             Electron only
// Kept as harmless no-ops for older callers: transparent, clickThrough, lowPower, canUseRealDesktop (all false),
//   setInteractive(), setFishing(), setMode(m) (fullscreen | window), onCursor(), requestDesktopFiles() -> [],
//   openPath() -> {ok:false}.

const win = typeof window !== 'undefined' ? window : null;
const doc = typeof document !== 'undefined' ? document : null;
const bridge = win && win.fishtopHost && win.fishtopHost.kind === 'electron' ? win.fishtopHost : null;

const kind = bridge ? 'electron' : 'web';
const shortcutCbs = new Set();
const fsCbs = new Set();
let keysHooked = false;

function emit(set, ...args) {
  for (const cb of [...set]) {
    try { cb(...args); } catch (err) { console.error(err); }
  }
}

function webFullscreen() { return !!(doc && doc.fullscreenElement); }

if (bridge && typeof bridge.onFullscreen === 'function') bridge.onFullscreen((on) => emit(fsCbs, !!on));
else if (doc) doc.addEventListener('fullscreenchange', () => emit(fsCbs, webFullscreen()));

// Browser: Alt+Enter toggles fullscreen too (F11 stays the browser's own).
function onWebKey(e) {
  if (!(e.altKey && e.key === 'Enter') || e.repeat || !shortcutCbs.size) return;
  e.preventDefault();
  emit(shortcutCbs, 'fullscreen', { id: 'fullscreen' });
}

function hookWebKeys() {
  if (keysHooked || bridge || !win || typeof win.addEventListener !== 'function') return;
  keysHooked = true;
  win.addEventListener('keydown', onWebKey, true);
}

export const host = {
  kind,
  mode: bridge ? (bridge.mode === 'fullscreen' ? 'fullscreen' : 'window') : 'window',
  platform: bridge ? String(bridge.platform || '') : 'web',
  transparent: false,
  clickThrough: false,
  lowPower: false,
  canUseRealDesktop: false,

  isFullscreen() {
    if (bridge && typeof bridge.isFullscreen === 'function') return !!bridge.isFullscreen();
    return webFullscreen();
  },

  setFullscreen(on) {
    if (bridge && typeof bridge.setFullscreen === 'function') return Promise.resolve(bridge.setFullscreen(!!on)).catch(() => false);
    if (!doc) return Promise.resolve(false);
    try {
      if (on && !webFullscreen()) return Promise.resolve(doc.documentElement.requestFullscreen?.()).then(() => true, () => false);
      if (!on && webFullscreen()) return Promise.resolve(doc.exitFullscreen?.()).then(() => false, () => true);
    } catch { /* not allowed (no user gesture, iframe) */ }
    return Promise.resolve(webFullscreen());
  },

  toggleFullscreen() { return this.setFullscreen(!this.isFullscreen()); },

  onFullscreen(cb) {
    if (typeof cb !== 'function') return () => {};
    fsCbs.add(cb);
    return () => fsCbs.delete(cb);
  },

  onShortcut(cb) {
    if (typeof cb !== 'function') return () => {};
    shortcutCbs.add(cb);
    hookWebKeys();
    return () => shortcutCbs.delete(cb);
  },

  quit() { if (bridge && typeof bridge.quit === 'function') bridge.quit(); },

  // ---- legacy no-ops
  setInteractive() {},
  setFishing() {},
  setMode(next) { return this.setFullscreen(next === 'fullscreen').then(() => ({ ok: true, mode: next === 'fullscreen' ? 'fullscreen' : 'window' })); },
  onCursor() { return () => {}; },
  requestDesktopFiles() { return Promise.resolve([]); },
  openPath() { return Promise.resolve({ ok: false, error: 'not available' }); },
};

export const HOST_MODES = ['window', 'fullscreen'];
