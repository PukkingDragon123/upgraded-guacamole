'use strict';
// FISHTOP desktop app (Electron main process, phase 4): runs the game as a normal windowed or fullscreen game.
// The old overlay / click-through / wallpaper / mini modes and Desktop-folder listing are gone (docs/DESKTOP.md).
// The game is the static web build in dist/, served from the private fishtop://app origin; nothing touches the
// network or the user's files.
const { app, BrowserWindow, Menu, dialog, ipcMain, nativeImage, protocol, screen, session } = require('electron');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const zlib = require('node:zlib');

const MODES = ['window', 'fullscreen'];
const SCHEME = 'fishtop';
const ORIGIN = `${SCHEME}://app`;
const DIST = path.resolve(__dirname, '..', 'dist');
const IS_DEV = !app.isPackaged;

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

if (process.env.FISHTOP_PROFILE_DIR) app.setPath('userData', path.resolve(process.env.FISHTOP_PROFILE_DIR));
protocol.registerSchemesAsPrivileged([
  { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);
// Sandbox every renderer; an explicit --no-sandbox (e.g. root in CI) wins.
if (!app.commandLine.hasSwitch('no-sandbox')) app.enableSandbox();

function argValue(name, argv = process.argv) {
  const pre = `--${name}=`;
  const hit = argv.find((a) => typeof a === 'string' && a.startsWith(pre));
  return hit ? hit.slice(pre.length) : null;
}

// ---------------------------------------------------------------------------------------------
// Settings (userData/settings.json): last window bounds and whether the game was fullscreen

const DEFAULTS = { fullscreen: false, bounds: null, maximized: false };
let settings = { ...DEFAULTS };
let saveTimer = null;
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');

function loadSettings() {
  try {
    const raw = JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
    settings = { ...DEFAULTS, fullscreen: !!raw.fullscreen, maximized: !!raw.maximized, bounds: raw.bounds?.window || raw.bounds || null };
  } catch { settings = { ...DEFAULTS }; }
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

let win = null;
const alive = (w) => !!w && !w.isDestroyed();

// ---------------------------------------------------------------------------------------------
// Pixel-art app icon, generated as a PNG data URL (no asset files).

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
  k: [28, 30, 52, 255], o: [255, 140, 58, 255], h: [255, 200, 130, 255],
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
  const raw = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = pal[rows[Math.floor(y / scale)][Math.floor(x / scale)]];
      if (c) raw.set(c, y * stride + 1 + x * 4);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
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
// The game window

function usableBounds(b) {
  if (!b || ![b.x, b.y, b.width, b.height].every(Number.isFinite) || b.width < 480 || b.height < 270) return null;
  const wa = screen.getDisplayMatching(b).workArea;
  const ix = Math.min(b.x + b.width, wa.x + wa.width) - Math.max(b.x, wa.x);
  const iy = Math.min(b.y + b.height, wa.y + wa.height) - Math.max(b.y, wa.y);
  return ix >= 120 && iy >= 90 ? b : null;
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

function sendFullscreen() {
  if (alive(win)) win.webContents.send('fishtop:fullscreen', { on: win.isFullScreen() });
}

function setFullscreen(on) {
  if (!alive(win)) return false;
  win.setFullScreen(!!on);
  return !!on;
}

function createWindow(mode) {
  const wa = screen.getPrimaryDisplay().workArea;
  const saved = usableBounds(settings.bounds);
  const size = { width: Math.min(1600, Math.round(wa.width * 0.86)), height: Math.min(900, Math.round(wa.height * 0.86)) };
  const w = new BrowserWindow({
    show: false,
    title: 'FISHTOP',
    icon: fishIcon(4),
    backgroundColor: '#0b1622',
    autoHideMenuBar: true,
    ...(saved || size),
    center: !saved,
    minWidth: 640,
    minHeight: 360,
    fullscreenable: true,
    fullscreen: mode === 'fullscreen',
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
    },
  });
  const wc = w.webContents;

  // Game keys handled by the shell: F11 / Alt+Enter fullscreen, Esc leaves fullscreen only via the game menu,
  // F12 / Ctrl+Shift+I devtools when allowed.
  wc.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const key = String(input.key || '');
    if (key === 'F11' || (input.alt && key === 'Enter')) {
      event.preventDefault();
      setFullscreen(!w.isFullScreen());
      return;
    }
    if (!(IS_DEV || process.env.FISHTOP_DEVTOOLS)) return;
    if (key === 'F12' || (input.control && input.shift && key.toLowerCase() === 'i')) {
      event.preventDefault();
      if (wc.isDevToolsOpened()) wc.closeDevTools();
      else wc.openDevTools({ mode: 'detach' });
    }
  });

  let crashes = 0;
  wc.on('render-process-gone', (_e, details) => {
    console.error(`[fishtop] renderer gone (${details.reason})`);
    if (details.reason === 'clean-exit' || ++crashes > 3) return;
    setTimeout(() => alive(w) && w.reload(), 1000);
  });

  let t = null;
  const remember = () => {
    clearTimeout(t);
    t = setTimeout(() => {
      if (!alive(w) || w.isMinimized()) return;
      settings.fullscreen = w.isFullScreen();
      settings.maximized = w.isMaximized();
      if (!w.isMaximized() && !w.isFullScreen()) settings.bounds = w.getBounds();
      saveSettings();
    }, 400);
  };
  w.on('move', remember);
  w.on('resize', remember);
  for (const ev of ['enter-full-screen', 'leave-full-screen']) w.on(ev, () => { remember(); sendFullscreen(); });
  w.on('maximize', remember);
  w.on('unmaximize', remember);
  w.once('ready-to-show', () => {
    if (settings.maximized && mode !== 'fullscreen') w.maximize();
    w.show();
    w.focus();
  });
  w.on('closed', () => { if (win === w) win = null; });
  w.loadURL(pageUrl(mode)).catch((err) => console.error('[fishtop] load failed:', err.message));
  return w;
}

// ---------------------------------------------------------------------------------------------
// IPC: a tiny, explicit API (preload.cjs -> src/platform/host.js)

function trusted(event) {
  try {
    return String(event.senderFrame && event.senderFrame.url).startsWith(`${ORIGIN}/`);
  } catch { return false; }
}

function registerIpc() {
  ipcMain.on('fishtop:info', (event) => {
    event.returnValue = trusted(event) ? {
      kind: 'electron',
      mode: alive(win) && win.isFullScreen() ? 'fullscreen' : 'window',
      fullscreen: alive(win) && win.isFullScreen(),
      platform: process.platform,
      version: app.getVersion(),
      electron: process.versions.electron,
    } : null;
  });
  ipcMain.handle('fishtop:set-fullscreen', (event, on) => (trusted(event) ? setFullscreen(!!on) : false));
  ipcMain.handle('fishtop:toggle-fullscreen', (event) => (trusted(event) && alive(win) ? setFullscreen(!win.isFullScreen()) : false));
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
// Smoke test hook: FISHTOP_SMOKE_MS=3000 [FISHTOP_SMOKE_MODES=window,fullscreen] [FISHTOP_SMOKE_SHOT=out.png]

async function runSmoke() {
  const ms = Number(process.env.FISHTOP_SMOKE_MS);
  if (!(ms > 0)) return;
  const modes = (process.env.FISHTOP_SMOKE_MODES || 'window').split(',').filter((m) => MODES.includes(m));
  const shot = process.env.FISHTOP_SMOKE_SHOT;
  const pause = (t) => new Promise((r) => setTimeout(r, t));
  for (const m of modes) {
    setFullscreen(m === 'fullscreen');
    await pause(ms);
    let page = 'no window';
    if (alive(win)) {
      page = await win.webContents.executeJavaScript(
        'JSON.stringify({ title: document.title, url: location.href, host: window.fishtopHost ? { kind: fishtopHost.kind, fullscreen: fishtopHost.isFullscreen() } : null, hud: !!(window.FISHTOP && window.FISHTOP.hud) })',
      ).catch((err) => `eval failed: ${err.message}`);
      if (shot) {
        const file = modes.length > 1 ? shot.replace(/(\.png)?$/i, `-${m}.png`) : shot;
        fs.writeFileSync(file, (await win.webContents.capturePage()).toPNG());
      }
    }
    console.log(`[fishtop] smoke mode=${m} fullscreen=${alive(win) && win.isFullScreen()} page=${page}`);
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
  if (process.platform === 'win32') app.setAppUserModelId('app.fishtop.game');
  Menu.setApplicationMenu(process.platform === 'darwin'
    ? Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' }])
    : null);
  const cli = argValue('mode') || (process.argv.includes('--fullscreen') ? 'fullscreen' : null);
  const mode = MODES.includes(cli) ? cli : settings.fullscreen ? 'fullscreen' : 'window';
  win = createWindow(mode);
  runSmoke().catch((err) => {
    console.error('[fishtop] smoke failed:', err);
    app.exit(1);
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!alive(win)) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });
  app.on('activate', () => { // macOS dock click
    if (alive(win)) { win.show(); win.focus(); } else if (app.isReady()) win = createWindow(settings.fullscreen ? 'fullscreen' : 'window');
  });
  app.on('window-all-closed', () => app.quit());
  app.on('will-quit', () => { if (saveTimer) writeSettingsNow(); });
  app.whenReady().then(start).catch((err) => {
    console.error('[fishtop] startup failed:', err);
    dialog.showErrorBox('FISHTOP', `Startup failed: ${err.message}`);
    app.exit(1);
  });
}
