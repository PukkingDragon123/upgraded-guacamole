'use strict';
// FISHTOP desktop shell (Electron main process).
// Window modes: window | overlay | wallpaper | mini (see docs/DESKTOP.md).
// The game is the static web build in dist/, served from the private fishtop://app origin.
const {
  app, BrowserWindow, Menu, Tray, dialog, globalShortcut, ipcMain, nativeImage, protocol, screen, session, shell,
} = require('electron');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { execFile } = require('node:child_process');

const MODES = ['window', 'overlay', 'wallpaper', 'mini'];
const SCHEME = 'fishtop';
const ORIGIN = `${SCHEME}://app`;
const DIST = path.resolve(__dirname, '..', 'dist');
const IS_DEV = !app.isPackaged;
const CURSOR_MS = 33; // ~30 Hz
const MINI = { width: 320, height: 220 };
const MAX_DESKTOP_ITEMS = 200;

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' data: blob:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "frame-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.map': 'application/json', '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf',
};

// ---------------------------------------------------------------------------------------------
// Process-level setup (must happen before 'ready')

if (process.env.FISHTOP_PROFILE_DIR) app.setPath('userData', path.resolve(process.env.FISHTOP_PROFILE_DIR));
protocol.registerSchemesAsPrivileged([
  { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);
// Sandbox every renderer (windows also set sandbox: true); an explicit --no-sandbox (e.g. root in CI) wins.
if (!app.commandLine.hasSwitch('no-sandbox')) app.enableSandbox();
if (process.platform === 'linux') app.commandLine.appendSwitch('enable-transparent-visuals');
// Keep rendering when the wallpaper window is (from Chromium's point of view) occluded.
if (process.platform === 'win32') app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');

function argValue(name, argv = process.argv) {
  const pre = `--${name}=`;
  const hit = argv.find((a) => typeof a === 'string' && a.startsWith(pre));
  return hit ? hit.slice(pre.length) : null;
}

// ---------------------------------------------------------------------------------------------
// Settings (userData/settings.json)

const DEFAULTS = { mode: 'window', desktopAccess: 'ask', bounds: {} };
let settings = { ...DEFAULTS };
let saveTimer = null;
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');

function loadSettings() {
  try {
    settings = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) };
  } catch { settings = { ...DEFAULTS }; }
  if (!MODES.includes(settings.mode)) settings.mode = 'window';
  if (!['ask', 'granted', 'denied'].includes(settings.desktopAccess)) settings.desktopAccess = 'ask';
  if (!settings.bounds || typeof settings.bounds !== 'object') settings.bounds = {};
}

function saveSettings() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(writeSettingsNow, 300);
}

function writeSettingsNow() {
  clearTimeout(saveTimer);
  saveTimer = null;
  try {
    const file = settingsFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(settings, null, 2));
    fs.renameSync(`${file}.tmp`, file);
  } catch (err) {
    console.warn('[fishtop] could not save settings:', err.message);
  }
}

// ---------------------------------------------------------------------------------------------
// Runtime state

const state = {
  mode: 'window',
  prevMode: 'window', // where Ctrl+Alt+M returns to
  win: null,
  rect: null, // screen rect (DIP) covered by the window, for cursor mapping
  interactive: false, // overlay: window receives mouse input
  fishing: false,
  paused: false,
  switching: false,
};
const windowModes = new WeakMap();
const wantsInteractive = new WeakMap(); // last setInteractive() per window (may arrive before a switch commits)
const overlayCss = new WeakMap(); // overlay: resolves once the transparent-background CSS is in
let tray = null;
let cursorTimer = null;
let lastCursor = '';
let xPointer = null; // Linux/X11 pointer query connection (see createXPointer)
let sessionDesktopAccess = null; // choice made without "remember"
let permissionPrompt = null;
let listedPaths = new Set();
let lastOpen = { path: '', t: 0 };

const alive = (w) => !!w && !w.isDestroyed();

// ---------------------------------------------------------------------------------------------
// Pixel-art app/tray icon, generated as a PNG data URL (no asset files).

const FISH_ART = [
  '................',
  '................',
  '.......kkkk.....',
  '......kffffk....',
  'kk..kkoohhhokk..',
  'kfkkoohhoowwook.',
  'kffoooooooweook.',
  'kffooooooooooook',
  'kffoyyoooooookk.',
  'kfkoyyyyyyoook..',
  'kk.kkyyyyyyykk..',
  '.....kkffkkk....',
  '......kffk......',
  '.......kk.......',
  '................',
  '................',
];
const FISH_PAL = {
  k: [28, 30, 52, 255], e: [28, 30, 52, 255], o: [255, 140, 58, 255], h: [255, 200, 130, 255],
  y: [255, 222, 150, 255], f: [226, 86, 52, 255], w: [255, 255, 255, 255],
};
const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function artDataUrl(rows, pal, scale) {
  const w = rows[0].length * scale, h = rows.length * scale, stride = w * 4 + 1;
  const raw = Buffer.alloc(stride * h); // filter byte 0 per row, transparent by default
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = pal[rows[Math.floor(y / scale)][Math.floor(x / scale)]];
      if (c) raw.set(c, y * stride + 1 + x * 4);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr), pngChunk('IDAT', zlib.deflateSync(raw)), pngChunk('IEND', Buffer.alloc(0)),
  ]);
  return `data:image/png;base64,${png.toString('base64')}`;
}

function fishIcon(baseScale) {
  const img = nativeImage.createFromDataURL(artDataUrl(FISH_ART, FISH_PAL, baseScale));
  img.addRepresentation({ scaleFactor: 2, dataURL: artDataUrl(FISH_ART, FISH_PAL, baseScale * 2) });
  return img;
}

// ---------------------------------------------------------------------------------------------
// Windows

function primary() {
  return screen.getPrimaryDisplay();
}

function usableBounds(b) {
  if (!b || ![b.x, b.y, b.width, b.height].every(Number.isFinite) || b.width < 120 || b.height < 90) return null;
  const wa = screen.getDisplayMatching(b).workArea;
  const ix = Math.min(b.x + b.width, wa.x + wa.width) - Math.max(b.x, wa.x);
  const iy = Math.min(b.y + b.height, wa.y + wa.height) - Math.max(b.y, wa.y);
  return ix >= 80 && iy >= 60 ? b : null;
}

function windowOptions(mode) {
  const base = {
    show: false,
    title: 'FISHTOP',
    icon: fishIcon(4),
    backgroundColor: '#0b1622',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      navigateOnDragDrop: false,
      spellcheck: false,
      devTools: IS_DEV || !!process.env.FISHTOP_DEVTOOLS,
      // Overlay/wallpaper are rarely focused or may look occluded: keep their animation running.
      backgroundThrottling: mode === 'window' || mode === 'mini',
    },
  };
  const bare = {
    frame: false, hasShadow: false, resizable: false, movable: false, minimizable: false, maximizable: false,
    fullscreenable: false, skipTaskbar: true, roundedCorners: false, thickFrame: false,
  };
  const display = primary();
  if (mode === 'overlay') {
    return { ...base, ...bare, ...display.workArea, transparent: true, backgroundColor: '#00000000', alwaysOnTop: true };
  }
  if (mode === 'wallpaper') {
    const desktopType = process.platform === 'win32' ? {} : { type: 'desktop' };
    return { ...base, ...bare, ...display.bounds, ...desktopType, focusable: false };
  }
  if (mode === 'mini') {
    const wa = display.workArea;
    const saved = usableBounds(settings.bounds.mini);
    const b = saved || { x: wa.x + wa.width - MINI.width - 24, y: wa.y + wa.height - MINI.height - 24, ...MINI };
    return {
      ...base, ...b, title: 'FISHTOP mini', frame: false, alwaysOnTop: true, resizable: true,
      minWidth: 240, minHeight: 165, maxWidth: 960, maxHeight: 660, maximizable: false, fullscreenable: false,
    };
  }
  const wa = display.workArea;
  const saved = usableBounds(settings.bounds.window);
  const size = { width: Math.min(1280, wa.width), height: Math.min(760, wa.height) };
  return { ...base, ...(saved || size), center: !saved, minWidth: 640, minHeight: 360 };
}

function pageUrl(mode) {
  const q = new URLSearchParams({ host: 'electron', mode });
  // Dev previews: electron . --dev=<name> (isolated dist/dev/<name>.html if built, else index.html?dev=<name>)
  const dev = IS_DEV ? argValue('dev') : null;
  if (dev && /^[\w-]+$/.test(dev)) {
    if (fs.existsSync(path.join(DIST, 'dev', `${dev}.html`))) return `${ORIGIN}/dev/${dev}.html?${q}`;
    q.set('dev', dev);
  }
  return `${ORIGIN}/index.html?${q}`;
}

function createWindow(mode) {
  const win = new BrowserWindow(windowOptions(mode));
  windowModes.set(win, mode);
  const wc = win.webContents;

  if (mode === 'overlay') {
    win.setAlwaysOnTop(true, 'floating');
    if (process.platform === 'darwin') win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    win.setIgnoreMouseEvents(true, { forward: true });
  } else if (mode === 'wallpaper') {
    if (process.platform === 'darwin') win.setVisibleOnAllWorkspaces(true);
    win.setIgnoreMouseEvents(true);
  } else if (mode === 'mini') {
    win.setAlwaysOnTop(true, 'floating');
  }

  // index.html paints an opaque page background; the overlay must show the real desktop through it.
  if (mode === 'overlay') {
    overlayCss.set(win, new Promise((resolve) => {
      wc.on('dom-ready', () => {
        wc.insertCSS('html, body { background: transparent !important; }').catch(() => {}).finally(resolve);
      });
    }));
  }

  wc.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || !(IS_DEV || process.env.FISHTOP_DEVTOOLS)) return;
    if (input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i')) {
      event.preventDefault();
      if (wc.isDevToolsOpened()) wc.closeDevTools();
      else wc.openDevTools({ mode: 'detach' });
    }
  });

  let crashes = 0;
  wc.on('render-process-gone', (_e, details) => {
    console.error(`[fishtop] renderer gone (${details.reason})`);
    if (details.reason === 'clean-exit' || ++crashes > 3) return;
    setTimeout(() => alive(win) && win.reload(), 1000);
  });

  if (mode === 'window' || mode === 'mini') {
    let t = null;
    const remember = () => {
      clearTimeout(t);
      t = setTimeout(() => {
        if (!alive(win) || win.isMinimized() || win.isMaximized() || win.isFullScreen()) return;
        settings.bounds[mode] = win.getBounds();
        saveSettings();
      }, 400);
    };
    win.on('move', remember);
    win.on('resize', remember);
  }

  win.on('closed', () => {
    if (state.win !== win) return;
    state.win = null;
    updateCursorPoll();
    if (!state.switching) app.quit();
  });

  win.loadURL(pageUrl(mode)).catch((err) => console.error('[fishtop] load failed:', err.message));
  return win;
}

function waitReady(win) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(done, 10000); // show whatever we have rather than hang the switch
    function done(err) {
      clearTimeout(timer);
      win.removeListener('ready-to-show', ok);
      win.removeListener('closed', gone);
      if (alive(win)) win.webContents.removeListener('did-fail-load', failed);
      if (err) reject(err); else resolve();
    }
    function ok() { done(); }
    function gone() { done(new Error('window closed while loading')); }
    function failed(_e, code, desc, url, isMainFrame) {
      if (isMainFrame) done(new Error(`could not load ${url} (${desc || code})`));
    }
    win.once('ready-to-show', ok);
    win.once('closed', gone);
    win.webContents.on('did-fail-load', failed);
  });
}

function reveal(win, mode) {
  if (!alive(win)) return;
  if (win.isMinimized()) win.restore();
  if (mode === 'overlay' || mode === 'wallpaper') {
    win.showInactive();
  } else {
    win.show();
    win.focus();
  }
}

function retire(win) {
  if (!alive(win)) return;
  win.close(); // lets the page run pagehide/unload (save state)
  setTimeout(() => alive(win) && win.destroy(), 1500);
}

function notify(message) {
  console.warn(`[fishtop] ${message}`);
  const opts = { type: 'info', title: 'FISHTOP', message, buttons: ['OK'], noLink: true };
  const parent = alive(state.win) && state.mode !== 'wallpaper' ? state.win : null;
  (parent ? dialog.showMessageBox(parent, opts) : dialog.showMessageBox(opts)).catch(() => {});
}

let waylandCache = null;
function nativeWayland() {
  if (process.platform !== 'linux') return false;
  if (waylandCache === null) {
    const ozone = app.commandLine.getSwitchValue('ozone-platform'); // Electron fills this in once it picked one
    const hint = process.env.ELECTRON_OZONE_PLATFORM_HINT || app.commandLine.getSwitchValue('ozone-platform-hint');
    const session = process.env.XDG_SESSION_TYPE === 'wayland' || !!process.env.WAYLAND_DISPLAY;
    waylandCache = ozone ? ozone === 'wayland' : hint !== 'x11' && session;
  }
  return waylandCache;
}

function wallpaperUnsupported() {
  if (nativeWayland()) return 'it needs an X11 session (try launching with --ozone-platform=x11)';
  return null;
}

async function setMode(mode, { fallbackMessage } = {}) {
  if (!MODES.includes(mode)) return { ok: false, mode: state.mode, error: `unknown mode "${mode}"` };
  if (state.switching) return { ok: false, mode: state.mode, error: 'busy switching modes' };
  const old = alive(state.win) ? state.win : null;
  if (old && mode === state.mode) {
    reveal(old, mode);
    if (fallbackMessage) notify(fallbackMessage);
    return { ok: !fallbackMessage, mode };
  }

  if (mode === 'wallpaper') {
    const why = wallpaperUnsupported();
    if (why) return fallbackToWindow(`Wallpaper mode isn't available: ${why}.`);
  }

  state.switching = true;
  let win = null;
  try {
    win = createWindow(mode);
    await waitReady(win);
    if (overlayCss.has(win)) await withTimeout(overlayCss.get(win), 3000).catch(() => {});
    if (mode === 'wallpaper' && process.platform === 'win32') await attachToDesktopWindows(win);
  } catch (err) {
    if (alive(win)) win.destroy();
    state.switching = false;
    if (mode === 'window') {
      notify(`FISHTOP could not open its window: ${err.message}`);
      return { ok: false, mode: state.mode, error: err.message };
    }
    return fallbackToWindow(`${modeLabel(mode)} mode isn't available: ${err.message}.`);
  }

  if (mode === 'mini' && state.mode !== 'mini' && old) state.prevMode = state.mode;
  state.mode = mode;
  state.win = win;
  state.rect = mode === 'overlay' ? primary().workArea : mode === 'wallpaper' ? primary().bounds : null;
  state.interactive = wantsInteractive.get(win) || false;
  state.fishing = false;
  state.paused = false;
  reveal(win, mode);
  applyMouse();
  updateCursorPoll();
  if (old) retire(old);
  state.switching = false;

  settings.mode = mode;
  saveSettings();
  refreshTray();
  if (fallbackMessage) notify(fallbackMessage);
  return { ok: !fallbackMessage, mode };
}

function fallbackToWindow(message) {
  return setMode('window', { fallbackMessage: `${message} Switched to window mode.` }).then((r) => ({
    ...r, ok: false, error: message,
  }));
}

function modeLabel(mode) {
  return { window: 'Window', overlay: 'Overlay', wallpaper: 'Wallpaper', mini: 'Mini' }[mode] || mode;
}

function applyMouse() {
  const w = state.win;
  if (!alive(w)) return;
  if (state.mode === 'overlay') {
    const on = state.interactive && !state.paused;
    if (on) w.setIgnoreMouseEvents(false);
    else w.setIgnoreMouseEvents(true, { forward: true });
  } else if (state.mode === 'wallpaper') {
    w.setIgnoreMouseEvents(true);
  }
}

function clickThrough() {
  return state.mode === 'wallpaper' || (state.mode === 'overlay' && !(state.interactive && !state.paused));
}

function send(channel, payload) {
  const w = state.win;
  if (alive(w)) w.webContents.send(channel, payload);
}

function onDisplaysChanged() {
  const w = state.win;
  if (!alive(w)) return;
  if (state.mode === 'overlay') {
    state.rect = primary().workArea;
    w.setBounds(state.rect);
  } else if (state.mode === 'wallpaper') {
    state.rect = primary().bounds;
    if (process.platform !== 'win32') w.setBounds(state.rect);
  }
}

// ---------------------------------------------------------------------------------------------
// Cursor forwarding (overlay/wallpaper only): the page gets no mouse events while click-through.

function updateCursorPoll() {
  const want = alive(state.win) && (state.mode === 'overlay' || state.mode === 'wallpaper');
  if (want && !cursorTimer) cursorTimer = setInterval(pollCursor, CURSOR_MS);
  else if (!want && cursorTimer) {
    clearInterval(cursorTimer);
    cursorTimer = null;
  }
  lastCursor = '';
}

function cursorPoint() {
  if (process.platform === 'linux' && !nativeWayland()) {
    if (!xPointer) xPointer = createXPointer() || { ok: false, poll: () => null, close() {} };
    const px = xPointer.ok ? xPointer.poll() : null;
    if (px) {
      const sf = primary().scaleFactor || 1;
      return { x: Math.round(px.x / sf), y: Math.round(px.y / sf) };
    }
  }
  return screen.getCursorScreenPoint();
}

function pollCursor() {
  const w = state.win, r = state.rect;
  if (!alive(w) || !r || state.switching || w.isMinimized()) return;
  const p = cursorPoint();
  const x = p.x - r.x, y = p.y - r.y;
  const through = clickThrough();
  const key = `${x},${y},${through}`;
  if (key === lastCursor) return;
  lastCursor = key;
  w.webContents.send('fishtop:cursor', {
    x, y, screenX: p.x, screenY: p.y,
    inside: x >= 0 && y >= 0 && x < r.width && y < r.height,
    clickThrough: through,
  });
}

// Linux/X11: Chromium refreshes getCursorScreenPoint() only from pointer events, which a click-through
// window never gets. So ask the X server directly: a minimal X11 client that only sends QueryPointer
// over the local display socket (authenticating like any X client, via XAUTHORITY's MIT cookie).

const pad4 = (n) => (n + 3) & ~3;

function readXAuthCookie(displayNum) {
  let data;
  try {
    data = fs.readFileSync(process.env.XAUTHORITY || path.join(os.homedir(), '.Xauthority'));
  } catch { return null; }
  const host = os.hostname();
  let fallback = null;
  for (let i = 0; i + 2 <= data.length;) {
    const family = data.readUInt16BE(i);
    i += 2;
    const fields = [];
    for (let k = 0; k < 4; k++) {
      if (i + 2 > data.length) return fallback;
      const len = data.readUInt16BE(i);
      fields.push(data.subarray(i + 2, i + 2 + len));
      i += 2 + len;
    }
    const [address, number, name, cookie] = fields;
    if (name.toString() !== 'MIT-MAGIC-COOKIE-1' || (number.length && number.toString() !== displayNum)) continue;
    const entry = { name, data: Buffer.from(cookie) };
    if (family === 0xffff || (family === 256 && address.toString() === host)) return entry;
    fallback = fallback || entry;
  }
  return fallback;
}

function createXPointer() {
  const m = /^(?:unix)?:(\d+)(?:\.\d+)?$/.exec(process.env.DISPLAY || '');
  if (!m) return null; // remote/TCP displays: fall back to Electron's value
  const auth = readXAuthCookie(m[1]);
  const name = auth ? auth.name : Buffer.alloc(0);
  const cookie = auth ? auth.data : Buffer.alloc(0);
  const head = Buffer.alloc(12);
  head[0] = 0x6c; // little-endian
  head.writeUInt16LE(11, 2);
  head.writeUInt16LE(name.length, 6);
  head.writeUInt16LE(cookie.length, 8);
  const setup = Buffer.concat([head, name, Buffer.alloc(pad4(name.length) - name.length), cookie, Buffer.alloc(pad4(cookie.length) - cookie.length)]);

  const self = { ok: true, last: null, poll, close: () => sock.destroy() };
  let buf = Buffer.alloc(0), root = 0, ready = false, pending = 0;
  const sock = net.createConnection(`/tmp/.X11-unix/X${m[1]}`, () => sock.write(setup));
  sock.on('error', () => { self.ok = false; });
  sock.on('close', () => { self.ok = false; });
  sock.on('data', (chunk) => {
    buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
    if (!ready) {
      if (buf.length < 8 || buf.length < 8 + buf.readUInt16LE(6) * 4) return;
      if (buf[0] !== 1) { // setup refused
        self.ok = false;
        sock.destroy();
        return;
      }
      const total = 8 + buf.readUInt16LE(6) * 4;
      root = buf.readUInt32LE(8 + 32 + pad4(buf.readUInt16LE(24)) + 8 * buf[29]); // screen 0 root window
      buf = buf.subarray(total);
      ready = true;
    }
    while (buf.length >= 32) {
      const extra = buf[0] === 1 || buf[0] === 35 ? buf.readUInt32LE(4) * 4 : 0;
      if (buf.length < 32 + extra) return;
      if (buf[0] === 1) self.last = { x: buf.readInt16LE(16), y: buf.readInt16LE(18) };
      if (buf[0] <= 1) pending = Math.max(0, pending - 1);
      buf = buf.subarray(32 + extra);
    }
  });
  function poll() { // returns the newest answer (one poll behind) and asks again
    if (ready && self.ok && pending < 2) {
      const req = Buffer.alloc(8);
      req[0] = 38; // QueryPointer
      req.writeUInt16LE(2, 2);
      req.writeUInt32LE(root, 4);
      sock.write(req);
      pending++;
    }
    return self.last;
  }
  return self;
}

// ---------------------------------------------------------------------------------------------
// Windows wallpaper: re-parent our window into the desktop WorkerW (behind the icons).

const WORKERW_PS = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class FishtopWallpaper {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr FindWindow(string cls, string title);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr FindWindowEx(IntPtr parent, IntPtr after, string cls, string title);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lParam);
  [DllImport("user32.dll")] public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam, uint flags, uint timeout, out IntPtr result);
  [DllImport("user32.dll", SetLastError = true)] public static extern IntPtr SetParent(IntPtr child, IntPtr parent);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int x, int y, int cx, int cy, uint flags);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr hWnd, uint flags);
  static IntPtr found = IntPtr.Zero;

  static bool Reparent(IntPtr hwnd, IntPtr parent) {
    SetParent(hwnd, parent);
    return GetAncestor(hwnd, 1) == parent; // GA_PARENT
  }

  public static string Attach(long handle, int x, int y, int w, int h) {
    const uint SWP_NOZORDER = 0x0004, SWP_NOACTIVATE = 0x0010, SWP_SHOWWINDOW = 0x0040;
    IntPtr hwnd = new IntPtr(handle);
    if (!IsWindow(hwnd)) return "ERR window handle is not valid";
    IntPtr progman = FindWindow("Progman", null);
    if (progman == IntPtr.Zero) return "ERR the desktop (Progman) window was not found";
    IntPtr res;
    // Ask Progman to spawn the WorkerW that sits between the wallpaper and the desktop icons.
    SendMessageTimeout(progman, 0x052C, new IntPtr(0xD), new IntPtr(0x1), 0, 1000, out res);
    SendMessageTimeout(progman, 0x052C, IntPtr.Zero, IntPtr.Zero, 0, 1000, out res);

    // Windows 11 24H2+: the icon view and the WorkerW are both children of Progman.
    IntPtr defView = FindWindowEx(progman, IntPtr.Zero, "SHELLDLL_DefView", null);
    IntPtr inner = FindWindowEx(progman, IntPtr.Zero, "WorkerW", null);
    if (defView != IntPtr.Zero && inner != IntPtr.Zero) {
      if (!Reparent(hwnd, progman)) return "ERR SetParent failed (" + Marshal.GetLastWin32Error() + ")";
      SetWindowPos(hwnd, defView, x, y, w, h, SWP_NOACTIVATE | SWP_SHOWWINDOW);
      return "OK progman";
    }

    // Classic: find the top-level window hosting SHELLDLL_DefView; the WorkerW right after it is ours.
    found = IntPtr.Zero;
    EnumWindows(delegate (IntPtr top, IntPtr lp) {
      if (FindWindowEx(top, IntPtr.Zero, "SHELLDLL_DefView", null) != IntPtr.Zero) {
        found = FindWindowEx(IntPtr.Zero, top, "WorkerW", null);
      }
      return true;
    }, IntPtr.Zero);
    if (found == IntPtr.Zero) return "ERR the desktop WorkerW window was not found";
    if (!Reparent(hwnd, found)) return "ERR SetParent failed (" + Marshal.GetLastWin32Error() + ")";
    SetWindowPos(hwnd, IntPtr.Zero, x, y, w, h, SWP_NOZORDER | SWP_NOACTIVATE | SWP_SHOWWINDOW);
    return "OK workerw";
  }
}
'@
`;

function attachToDesktopWindows(win) {
  const buf = win.getNativeWindowHandle();
  const hwnd = buf.length >= 8 ? buf.readBigInt64LE(0) : BigInt(buf.readInt32LE(0));
  // SetWindowPos wants physical pixels relative to the parent, which spans the virtual screen.
  const phys = screen.getAllDisplays().map((d) => screen.dipToScreenRect(null, d.bounds));
  const prim = screen.dipToScreenRect(null, primary().bounds);
  const vx = Math.min(...phys.map((r) => r.x)), vy = Math.min(...phys.map((r) => r.y));
  const args = [hwnd.toString(), ...[prim.x - vx, prim.y - vy, prim.width, prim.height].map((v) => String(Math.trunc(v)))];
  const script = `${WORKERW_PS}\n[FishtopWallpaper]::Attach([long]${args[0]}, ${args[1]}, ${args[2]}, ${args[3]}, ${args[4]})\n`;
  const exe = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return new Promise((resolve, reject) => {
    execFile(exe, ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], { windowsHide: true, timeout: 20000 }, (err, stdout, stderr) => {
      const out = String(stdout || '').trim().split(/\r?\n/).pop() || '';
      if (out.startsWith('OK')) {
        console.log(`[fishtop] wallpaper attached (${out.slice(3)})`);
        resolve();
      } else {
        const detail = String(stderr || '').split(/\r?\n/).map((l) => l.trim()).find(Boolean);
        reject(new Error(out.startsWith('ERR') ? out.slice(4) : detail || (err && err.killed ? 'PowerShell timed out' : 'PowerShell failed')));
      }
    });
  });
}

// ---------------------------------------------------------------------------------------------
// Real Desktop folder: permission-gated, READ-ONLY listing (names + icons, never contents).

const SKIP_NAMES = new Set(['desktop.ini', 'thumbs.db', '.ds_store', '.localized', '$recycle.bin']);
const SHORTCUT_EXT = new Set(['lnk', 'url', 'desktop', 'webloc', 'alias']);

function desktopDir() {
  try {
    const dir = path.resolve(app.getPath('desktop'));
    return fs.existsSync(dir) ? dir : null;
  } catch { return null; }
}

function currentAccess() {
  return sessionDesktopAccess || settings.desktopAccess;
}

function setDesktopAccess(value) {
  settings.desktopAccess = value;
  sessionDesktopAccess = null;
  if (value !== 'granted') listedPaths = new Set();
  saveSettings();
  refreshTray();
  send('fishtop:shortcut', { id: 'desktop-access', access: value, ...hostState() });
}

function ensureDesktopAccess() {
  const access = currentAccess();
  if (access !== 'ask') return Promise.resolve(access === 'granted');
  if (!permissionPrompt) permissionPrompt = askDesktopAccess().finally(() => { permissionPrompt = null; });
  return permissionPrompt;
}

async function askDesktopAccess() {
  const opts = {
    type: 'question',
    title: 'FISHTOP',
    buttons: ['Allow', "Don't allow"],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
    message: 'Let FISHTOP show the items on your Desktop?',
    detail: 'FISHTOP only looks at the names and icons of the items directly on your Desktop so fish can swim around them. '
      + 'It never reads what is inside your files and never changes, moves or deletes anything. '
      + 'Double-clicking one of those icons in the game opens it, just like on your real desktop.\n\n'
      + 'You can change this later from the FISHTOP tray menu.',
    checkboxLabel: 'Remember my choice',
    checkboxChecked: true,
  };
  const parent = alive(state.win) && state.mode !== 'wallpaper' ? state.win : null;
  const { response, checkboxChecked } = parent ? await dialog.showMessageBox(parent, opts) : await dialog.showMessageBox(opts);
  const choice = response === 0 ? 'granted' : 'denied';
  if (checkboxChecked) {
    settings.desktopAccess = choice;
    sessionDesktopAccess = null;
    saveSettings();
  } else {
    sessionDesktopAccess = choice;
  }
  refreshTray();
  return choice === 'granted';
}

function withTimeout(promise, ms) {
  let t;
  return Promise.race([promise, new Promise((_, rej) => { t = setTimeout(() => rej(new Error('timeout')), ms); })])
    .finally(() => clearTimeout(t));
}

async function iconFor(full) {
  try {
    const img = await withTimeout(app.getFileIcon(full, { size: 'normal' }), 3000);
    return img && !img.isEmpty() ? img.toDataURL() : null;
  } catch { return null; }
}

async function listDesktop() {
  const dir = desktopDir();
  if (!dir) return [];
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true }); // names only
  } catch (err) {
    console.warn('[fishtop] could not list Desktop:', err.message);
    return [];
  }
  const items = [];
  for (const d of entries) {
    const name = d.name;
    if (name.startsWith('.') || name.startsWith('~$') || SKIP_NAMES.has(name.toLowerCase())) continue;
    const full = path.join(dir, name);
    let isDir = d.isDirectory();
    if (d.isSymbolicLink()) {
      try { isDir = (await fsp.stat(full)).isDirectory(); } catch { continue; } // metadata only
    } else if (!isDir && !d.isFile()) continue;
    const dot = path.extname(name);
    const ext = dot.slice(1).toLowerCase();
    const bundle = isDir && ext === 'app';
    items.push({
      name,
      title: isDir && !bundle ? name : name.slice(0, name.length - dot.length) || name,
      ext: isDir && !bundle ? '' : ext,
      isDir,
      isShortcut: !isDir && SHORTCUT_EXT.has(ext),
      path: full,
      icon: null,
    });
  }
  items.sort((a, b) => (b.isDir - a.isDir) || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
  items.length = Math.min(items.length, MAX_DESKTOP_ITEMS);

  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const it = items[next++];
      it.icon = await iconFor(it.path);
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  listedPaths = new Set(items.map((it) => it.path));
  return items;
}

async function openDesktopPath(p) {
  if (currentAccess() !== 'granted') return { ok: false, error: 'Desktop access was not granted' };
  if (typeof p !== 'string' || !p) return { ok: false, error: 'invalid path' };
  const full = path.resolve(p);
  if (!listedPaths.has(full) || path.dirname(full) !== desktopDir()) return { ok: false, error: 'not a listed Desktop item' };
  const now = Date.now();
  if (now - lastOpen.t < 1000 || (full === lastOpen.path && now - lastOpen.t < 3000)) return { ok: false, error: 'too many opens' };
  lastOpen = { path: full, t: now };
  const err = await shell.openPath(full);
  return err ? { ok: false, error: err } : { ok: true };
}

// ---------------------------------------------------------------------------------------------
// Launch at login (off unless the user turns it on from the tray)

function autostartFile() {
  const base = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(base, 'autostart', 'fishtop.desktop');
}

function loginItemOptions() {
  return IS_DEV ? { path: process.execPath, args: [path.resolve(app.getAppPath())] } : {};
}

function getLaunchAtLogin() {
  try {
    if (process.platform === 'linux') return fs.existsSync(autostartFile());
    return app.getLoginItemSettings(loginItemOptions()).openAtLogin;
  } catch { return false; }
}

function setLaunchAtLogin(on) {
  try {
    if (process.platform === 'linux') {
      const file = autostartFile();
      if (!on) {
        fs.rmSync(file, { force: true });
      } else {
        const q = (s) => `"${String(s).replace(/(["`$\\])/g, '\\$1')}"`;
        const exec = [q(process.execPath), ...(IS_DEV ? [q(path.resolve(app.getAppPath()))] : [])].join(' ');
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, `[Desktop Entry]\nType=Application\nName=FISHTOP\nExec=${exec}\nX-GNOME-Autostart-enabled=true\n`);
      }
    } else {
      app.setLoginItemSettings({ openAtLogin: !!on, ...loginItemOptions() });
    }
  } catch (err) {
    notify(`Could not change "Launch at login": ${err.message}`);
  }
  refreshTray();
}

// ---------------------------------------------------------------------------------------------
// Shortcuts, tray, IPC

function hostState() {
  return { mode: state.mode, fishing: state.fishing, paused: state.paused, interactive: state.interactive && !state.paused };
}

function sendShortcut(id, accelerator, extra = {}) {
  send('fishtop:shortcut', { id, accelerator, ...hostState(), ...extra });
}

function toggleFishing() {
  state.fishing = !state.fishing;
  if (state.fishing) state.paused = false;
  state.interactive = state.fishing;
  applyMouse();
  if (state.fishing && alive(state.win) && state.mode !== 'wallpaper') {
    if (state.mode === 'overlay') state.win.focus();
    else reveal(state.win, state.mode);
  }
  sendShortcut('toggle-fishing', 'Ctrl+Alt+F');
  refreshTray();
}

function togglePause() {
  state.paused = !state.paused;
  if (state.paused) {
    state.fishing = false;
    state.interactive = false;
  }
  applyMouse();
  sendShortcut('pause', 'Ctrl+Alt+P');
  refreshTray();
}

function toggleMini() {
  const next = state.mode === 'mini' ? (state.prevMode !== 'mini' ? state.prevMode : 'window') : 'mini';
  sendShortcut('mini', 'Ctrl+Alt+M', { nextMode: next });
  setMode(next);
}

function cycleOverlay() {
  const next = state.mode === 'overlay' ? 'window' : 'overlay';
  sendShortcut('cycle-overlay', 'Ctrl+Alt+O', { nextMode: next });
  setMode(next);
}

const SHORTCUTS = [
  { accelerator: 'Control+Alt+F', run: toggleFishing },
  { accelerator: 'Control+Alt+P', run: togglePause },
  { accelerator: 'Control+Alt+M', run: toggleMini },
  { accelerator: 'Control+Alt+O', run: cycleOverlay },
];

function registerShortcuts() {
  for (const s of SHORTCUTS) {
    try {
      if (!globalShortcut.register(s.accelerator, s.run)) console.warn(`[fishtop] ${s.accelerator} is taken by another app`);
    } catch (err) {
      console.warn(`[fishtop] could not register ${s.accelerator}: ${err.message}`);
    }
  }
}

function createTray() {
  try {
    tray = new Tray(fishIcon(1));
    tray.setToolTip('FISHTOP');
    tray.on('click', () => {
      if (process.platform === 'win32' && alive(state.win) && (state.mode === 'window' || state.mode === 'mini')) reveal(state.win, state.mode);
    });
    refreshTray();
  } catch (err) {
    tray = null;
    console.warn('[fishtop] tray unavailable:', err.message);
  }
}

function refreshTray() {
  if (!tray || tray.isDestroyed()) return;
  const modeItem = (id, label) => ({ label, type: 'radio', checked: state.mode === id, click: () => setMode(id) });
  const access = currentAccess();
  const accessItem = (id, label) => ({ label, type: 'radio', checked: access === id, click: () => setDesktopAccess(id) });
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'FISHTOP', enabled: false },
    { type: 'separator' },
    modeItem('window', 'Window'),
    modeItem('overlay', 'Desktop overlay  (Ctrl+Alt+O)'),
    modeItem('wallpaper', 'Wallpaper (experimental)'),
    modeItem('mini', 'Mini aquarium  (Ctrl+Alt+M)'),
    { type: 'separator' },
    { label: 'Fishing  (Ctrl+Alt+F)', type: 'checkbox', checked: state.fishing, click: toggleFishing },
    { label: 'Pause  (Ctrl+Alt+P)', type: 'checkbox', checked: state.paused, click: togglePause },
    { type: 'separator' },
    {
      label: 'Desktop icon access',
      submenu: [accessItem('ask', 'Ask when needed'), accessItem('granted', 'Allowed'), accessItem('denied', 'Not allowed')],
    },
    { label: 'Launch at login', type: 'checkbox', checked: getLaunchAtLogin(), click: (item) => setLaunchAtLogin(item.checked) },
    { type: 'separator' },
    { label: 'Show FISHTOP', click: () => reveal(state.win, state.mode) },
    { label: 'Quit FISHTOP', click: () => app.quit() },
  ]));
}

function trusted(event) {
  try {
    return String(event.senderFrame && event.senderFrame.url).startsWith(`${ORIGIN}/`);
  } catch { return false; }
}

function fromCurrent(event) {
  return trusted(event) && alive(state.win) && event.sender === state.win.webContents;
}

function hostInfo(win) {
  const access = currentAccess();
  return {
    kind: 'electron',
    mode: (win && windowModes.get(win)) || state.mode,
    platform: process.platform,
    version: app.getVersion(),
    electron: process.versions.electron,
    canUseRealDesktop: !!desktopDir() && access !== 'denied',
    desktopAccess: access,
  };
}

function registerIpc() {
  ipcMain.on('fishtop:info', (event) => {
    event.returnValue = trusted(event) ? hostInfo(BrowserWindow.fromWebContents(event.sender)) : null;
  });
  ipcMain.on('fishtop:set-interactive', (event, on) => {
    const win = trusted(event) ? BrowserWindow.fromWebContents(event.sender) : null;
    if (!win) return;
    wantsInteractive.set(win, !!on);
    if (win !== state.win || !!on === state.interactive) return;
    state.interactive = !!on;
    applyMouse();
  });
  ipcMain.on('fishtop:set-fishing', (event, on) => {
    if (!fromCurrent(event)) return;
    state.fishing = !!on;
    if (state.fishing) state.paused = false;
    state.interactive = state.fishing;
    applyMouse();
    refreshTray();
  });
  ipcMain.handle('fishtop:set-mode', (event, mode) => (trusted(event) ? setMode(String(mode)) : { ok: false, error: 'untrusted' }));
  ipcMain.handle('fishtop:desktop-files', async (event) => {
    if (!trusted(event)) return [];
    return (await ensureDesktopAccess()) ? listDesktop() : [];
  });
  ipcMain.handle('fishtop:open-path', (event, p) => (trusted(event) ? openDesktopPath(p) : { ok: false, error: 'untrusted' }));
  ipcMain.on('fishtop:quit', (event) => { if (trusted(event)) app.quit(); });
}

// ---------------------------------------------------------------------------------------------
// Security: local content only

function registerProtocol() {
  protocol.handle(SCHEME, async (request) => {
    let rel;
    try {
      const url = new URL(request.url);
      if (url.host !== 'app') return new Response('not found', { status: 404 });
      rel = decodeURIComponent(url.pathname);
    } catch { return new Response('bad request', { status: 400 }); }
    if (rel === '/' || rel === '') rel = '/index.html';
    const file = path.normalize(path.join(DIST, rel));
    if (!file.startsWith(DIST + path.sep)) return new Response('forbidden', { status: 403 });
    try {
      const body = await fsp.readFile(file);
      return new Response(body, {
        status: 200,
        headers: {
          'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
          'content-security-policy': CSP,
          'x-content-type-options': 'nosniff',
          'cache-control': 'no-cache',
        },
      });
    } catch { return new Response('not found', { status: 404 }); }
  });
}

function installSecurity() {
  const ses = session.defaultSession;
  ses.setSpellCheckerEnabled(false); // also stops Chromium fetching dictionaries from the network
  const allowed = new Set(['fullscreen', 'pointerLock', 'clipboard-sanitized-write']);
  ses.setPermissionRequestHandler((_wc, permission, callback) => callback(allowed.has(permission)));
  ses.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (_details, callback) => {
    callback({ cancel: true });
  });
}

app.on('web-contents-created', (_e, contents) => {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  const guard = (event, url) => { if (!String(url).startsWith(`${ORIGIN}/`)) event.preventDefault(); };
  contents.on('will-navigate', guard);
  contents.on('will-redirect', guard);
  contents.on('will-attach-webview', (event) => event.preventDefault());
});

// ---------------------------------------------------------------------------------------------
// Smoke test hook: FISHTOP_SMOKE_MS=3000 [FISHTOP_SMOKE_MODES=window,overlay,mini] [FISHTOP_SMOKE_SHOT=out.png]

async function runSmoke() {
  const ms = Number(process.env.FISHTOP_SMOKE_MS);
  if (!(ms > 0)) return;
  const modes = (process.env.FISHTOP_SMOKE_MODES || state.mode).split(',').filter((m) => MODES.includes(m));
  const shot = process.env.FISHTOP_SMOKE_SHOT;
  const pause = (t) => new Promise((r) => setTimeout(r, t));
  for (const m of modes) {
    const res = await setMode(m);
    await pause(ms);
    const w = state.win;
    let page = 'no window';
    if (alive(w)) {
      page = await w.webContents.executeJavaScript(
        'JSON.stringify({ title: document.title, url: location.href, host: window.fishtopHost ? { kind: fishtopHost.kind, mode: fishtopHost.mode, canUseRealDesktop: fishtopHost.canUseRealDesktop } : null })',
      ).catch((err) => `eval failed: ${err.message}`);
      if (shot) {
        const file = modes.length > 1 ? shot.replace(/(\.png)?$/i, `-${m}.png`) : shot;
        fs.writeFileSync(file, (await w.webContents.capturePage()).toPNG());
      }
    }
    console.log(`[fishtop] smoke mode=${m} result=${JSON.stringify(res)} state=${state.mode} page=${page}`);
  }
  console.log('[fishtop] smoke done');
  app.quit();
}

// ---------------------------------------------------------------------------------------------
// Startup

async function start() {
  loadSettings();
  if (!fs.existsSync(path.join(DIST, 'index.html'))) {
    dialog.showErrorBox('FISHTOP', 'dist/index.html is missing. Run "npm run build" first.');
    app.quit();
    return;
  }
  installSecurity();
  registerProtocol();
  registerIpc();
  if (process.platform === 'win32') app.setAppUserModelId('app.fishtop.desktop');
  Menu.setApplicationMenu(process.platform === 'darwin'
    ? Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }])
    : null);
  createTray();
  registerShortcuts();
  for (const ev of ['display-added', 'display-removed', 'display-metrics-changed']) screen.on(ev, onDisplaysChanged);

  const cli = argValue('mode');
  const initial = MODES.includes(cli) ? cli : settings.mode;
  await setMode(initial);
  runSmoke().catch((err) => {
    console.error('[fishtop] smoke failed:', err);
    app.exit(1);
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    const m = argValue('mode', argv);
    if (MODES.includes(m)) setMode(m);
    else if (alive(state.win)) reveal(state.win, state.mode);
  });
  app.on('activate', () => { // macOS dock click
    if (alive(state.win)) reveal(state.win, state.mode);
    else if (app.isReady() && !state.switching) setMode(settings.mode);
  });
  app.on('window-all-closed', () => {
    if (!state.switching) app.quit();
  });
  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    if (cursorTimer) clearInterval(cursorTimer);
    if (xPointer) xPointer.close();
    if (saveTimer) writeSettingsNow();
  });
  app.whenReady().then(start).catch((err) => {
    console.error('[fishtop] startup failed:', err);
    dialog.showErrorBox('FISHTOP', `Startup failed: ${err.message}`);
    app.exit(1);
  });
}
