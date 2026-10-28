// Host bridge: the game's single point of contact with the native desktop shell.
// In Electron, desktop/preload.cjs exposes window.fishtopHost and every call goes to the main process.
// In a plain browser (or the extension) everything is a safe no-op; Ctrl+Alt+F/P/M/O still arrive
// through onShortcut from in-page key presses so the flows can be tried without the shell.
//
//   host.kind               'web' | 'electron'
//   host.mode               'window' | 'overlay' | 'wallpaper' | 'mini'   (?mode=... on web, default 'window')
//   host.transparent        overlay: draw no opaque background, the real desktop shows through
//   host.clickThrough       overlay/wallpaper: the page gets no real mouse events by default -> use onCursor
//   host.lowPower           mini: throttle fps / effects
//   host.canUseRealDesktop  real Desktop items can be requested (Electron, not denied by the user)
//   host.setInteractive(on) overlay: take mouse input while the cursor is over game UI or while fishing
//   host.setFishing(on)     optional: tell the shell fishing started/ended (keeps tray + Ctrl+Alt+F in sync)
//   host.setMode(mode)      -> Promise<{ok, mode, error?}> (the page reloads in the new mode)
//   host.onShortcut(cb)     cb({id, accelerator, mode, fishing, paused, interactive, nextMode?}) -> unsubscribe
//                           ids: 'toggle-fishing' | 'pause' | 'mini' | 'cycle-overlay' | 'desktop-access'
//   host.onCursor(cb)       cb({x, y, screenX, screenY, inside, clickThrough}) ~30 Hz -> unsubscribe
//   host.requestDesktopFiles() -> Promise<[{name, title, ext, isDir, isShortcut, path, icon}]> ([] on web/denied)
//   host.openPath(path)     -> Promise<{ok, error?}> (only listed Desktop items, only with permission)
//   host.quit()

export const HOST_MODES = ['window', 'overlay', 'wallpaper', 'mini'];

const win = typeof window !== 'undefined' ? window : null;
const bridge = win && win.fishtopHost && win.fishtopHost.kind === 'electron' ? win.fishtopHost : null;

function queryParam(name) {
  try {
    return new URLSearchParams(win ? win.location.search : '').get(name);
  } catch {
    return null;
  }
}

function normMode(m) {
  return HOST_MODES.includes(m) ? m : 'window';
}

const kind = bridge ? 'electron' : 'web';
const mode = normMode(bridge ? bridge.mode : queryParam('mode'));
const shortcutCbs = new Set();
const cursorCbs = new Set();
let interactive = false; // last value sent to the shell (deduped: games may call every frame)
let webFishing = false;
let webPaused = false;
let keysHooked = false;
let cursorOff = null;

function emit(set, payload) {
  for (const cb of [...set]) {
    try {
      cb(payload);
    } catch (err) {
      console.error(err);
    }
  }
}

if (bridge) {
  bridge.onShortcut((ev) => {
    if (ev && typeof ev.interactive === 'boolean') interactive = ev.interactive;
    emit(shortcutCbs, ev);
  });
}

// Browser fallback for the global shortcuts (in-page only).
const WEB_KEYS = {
  KeyF: ['toggle-fishing', 'Ctrl+Alt+F'],
  KeyP: ['pause', 'Ctrl+Alt+P'],
  KeyM: ['mini', 'Ctrl+Alt+M'],
  KeyO: ['cycle-overlay', 'Ctrl+Alt+O'],
};

function onWebKey(e) {
  if (!e.ctrlKey || !e.altKey || e.shiftKey || e.metaKey || e.repeat || !shortcutCbs.size) return;
  const hit = WEB_KEYS[e.code];
  if (!hit) return;
  e.preventDefault();
  const [id, accelerator] = hit;
  if (id === 'toggle-fishing') {
    webFishing = !webFishing;
    if (webFishing) webPaused = false;
  } else if (id === 'pause') {
    webPaused = !webPaused;
    if (webPaused) webFishing = false;
  }
  const ev = { id, accelerator, mode, fishing: webFishing, paused: webPaused, interactive: true };
  if (id === 'mini') ev.nextMode = mode === 'mini' ? 'window' : 'mini';
  if (id === 'cycle-overlay') ev.nextMode = mode === 'overlay' ? 'window' : 'overlay';
  emit(shortcutCbs, ev);
}

function hookWebKeys() {
  if (keysHooked || bridge || !win || typeof win.addEventListener !== 'function') return;
  keysHooked = true;
  win.addEventListener('keydown', onWebKey, true);
}

export const host = {
  kind,
  mode,
  platform: bridge ? String(bridge.platform || '') : 'web',
  transparent: kind === 'electron' && mode === 'overlay',
  clickThrough: kind === 'electron' && (mode === 'overlay' || mode === 'wallpaper'),
  lowPower: mode === 'mini',
  canUseRealDesktop: !!(bridge && bridge.canUseRealDesktop),

  setInteractive(on) {
    on = !!on;
    if (on === interactive) return;
    interactive = on;
    if (bridge) bridge.setInteractive(on);
  },

  setFishing(on) {
    on = !!on;
    interactive = on;
    if (bridge && typeof bridge.setFishing === 'function') bridge.setFishing(on);
    else webFishing = on;
  },

  setMode(next) {
    if (!bridge) return Promise.resolve({ ok: false, mode, error: 'modes need the desktop app' });
    return Promise.resolve(bridge.setMode(String(next))).catch((err) => ({ ok: false, mode, error: String(err && err.message || err) }));
  },

  onShortcut(cb) {
    if (typeof cb !== 'function') return () => {};
    shortcutCbs.add(cb);
    hookWebKeys();
    return () => shortcutCbs.delete(cb);
  },

  onCursor(cb) {
    if (typeof cb !== 'function') return () => {};
    cursorCbs.add(cb);
    if (bridge && cursorCbs.size === 1) cursorOff = bridge.onCursor((ev) => emit(cursorCbs, ev));
    return () => {
      cursorCbs.delete(cb);
      if (!cursorCbs.size && cursorOff) {
        cursorOff();
        cursorOff = null;
      }
    };
  },

  requestDesktopFiles() {
    if (!bridge) return Promise.resolve([]);
    return Promise.resolve(bridge.requestDesktopFiles())
      .then((list) => (Array.isArray(list) ? list : []))
      .catch(() => []);
  },

  openPath(path) {
    if (!bridge) return Promise.resolve({ ok: false, error: 'needs the desktop app' });
    return Promise.resolve(bridge.openPath(String(path))).catch((err) => ({ ok: false, error: String(err && err.message || err) }));
  },

  quit() {
    if (bridge) bridge.quit();
  },
};
