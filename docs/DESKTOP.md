# FISHTOP desktop app (Electron shell)

The desktop app wraps the same web build (`dist/index.html` + `dist/fishtop.js`) in a small Electron
shell (`desktop/main.cjs`, `desktop/preload.cjs`). The game talks to it only through
`src/platform/host.js`, which also works in a plain browser, where every call is a safe no-op.

## Run

```sh
npm install                              # also downloads the Electron binary
npm run desktop                          # build the web bundle, then launch in the last used mode
npm run desktop -- --mode=overlay        # start in a given mode: window | overlay | wallpaper | mini
npm run desktop -- --dev=host            # load a dev preview (dist/dev/host.html if built, else ?dev=host)
```

- Running as root (containers/CI) needs Chromium's `--no-sandbox`: `npx electron . --no-sandbox`.
- Headless smoke test: `FISHTOP_SMOKE_MS=2500 FISHTOP_SMOKE_MODES=window,overlay,mini FISHTOP_SMOKE_SHOT=tests/out/desk.png xvfb-run -a npx electron . --no-sandbox`
  logs one `[fishtop] smoke ...` line per mode, saves a capture per mode, then quits.
- `FISHTOP_PROFILE_DIR=<dir>` uses a separate settings/storage profile. `FISHTOP_DEVTOOLS=1` allows
  DevTools (F12) in a packaged build; it is always allowed when running from source.
- Only one instance runs. Launching again focuses it, or switches mode if `--mode=` is given.

## Window modes

The page is loaded as `fishtop://app/index.html?host=electron&mode=<mode>`. Switching modes opens a
new window and closes the old one, so the page reloads. Save game state on `pagehide` (localStorage is
shared across modes).

| Mode | What it is |
|---|---|
| `window` | Normal framed, resizable window with the full simulated desktop. Size and position are remembered. |
| `overlay` | Frameless, transparent, always-on-top window over the primary display's work area (not in the taskbar, no shadow). Click-through by default: the real desktop stays fully usable. The page background is forced transparent. |
| `wallpaper` | Experimental. A window behind the desktop icons. macOS/Linux use BrowserWindow `type: 'desktop'`. Windows re-parents the window into Explorer's WorkerW through a PowerShell `Add-Type` P/Invoke script (Progman `0x052C`, SHELLDLL_DefView, `SetParent`). It is never interactive. If it fails, the app falls back to `window` and shows a message. |
| `mini` | Small frameless always-on-top aquarium (320x220, resizable 240x165 to 960x660, bottom-right by default). Drag it by the invisible 14 px strip along the top edge. `host.lowPower` is true, so the game should lower its fps and effects. |

## Shortcuts and tray

| Keys | Action |
|---|---|
| Ctrl+Alt+F | Toggle fishing. In overlay mode the window becomes interactive (and focused) while fishing. Also unpauses. |
| Ctrl+Alt+P | Toggle pause. Forces click-through and stops fishing. The game should pause on this event. |
| Ctrl+Alt+M | Mini mode on/off (returns to the previous mode). |
| Ctrl+Alt+O | Toggle overlay/window. |

Each key is also delivered to the page through `host.onShortcut` as
`{id: 'toggle-fishing'|'pause'|'mini'|'cycle-overlay', accelerator, mode, fishing, paused, interactive, nextMode?}`.
The mode keys are sent just before the switch. If another app already holds a key, a warning is logged.
In a browser the same keys work only while the page has focus.

The tray icon (a generated pixel fish) offers: mode switch, Fishing, Pause, Desktop icon access
(Ask / Allowed / Not allowed), **Launch at login** (off by default; on Linux it writes
`~/.config/autostart/fishtop.desktop` only when you tick it), Show, and Quit.

## Game integration (`src/platform/host.js`)

```js
import { host } from '../platform/host.js';
host.kind; host.mode; host.transparent; host.clickThrough; host.lowPower; host.canUseRealDesktop;
host.onCursor(({ x, y, inside, clickThrough }) => { /* CSS px relative to the window, ~30 Hz */ });
host.setInteractive(overUi || fishing);  // deduped, safe to call every frame
host.onShortcut((ev) => { /* see table above; also {id:'desktop-access', access} */ });
const items = await host.requestDesktopFiles(); // [{name,title,ext,isDir,isShortcut,path,icon}]
await host.openPath(item.path);            // only on a deliberate double-click
host.setMode('mini'); host.setFishing(false); host.quit();
```

- **Overlay hover pattern:** while click-through, the page gets no real mouse input. On Windows and
  macOS mouse moves are forwarded, but on Linux they are not, so use `onCursor` for hit-testing.
  Call `setInteractive(true)` while the cursor is over a fish, a menu or the bait box, and keep it
  true during a fishing fight. Call `setInteractive(false)` otherwise. When fishing ends through the
  game's own UI, call `host.setFishing(false)` to keep the tray and Ctrl+Alt+F in step.
- Cursor events are polled only in overlay and wallpaper modes, and only sent when something changed.
- Draw no opaque full-screen background when `host.transparent` is true.

## Privacy and safety

- **Desktop files are opt-in and read-only.** The first `requestDesktopFiles()` shows a native
  dialog (Allow / Don't allow, "Remember my choice"). You can change the answer later from the tray.
  When allowed, the app lists only the direct children of your Desktop folder: name, extension,
  folder/shortcut flags and a 32 px icon from `app.getFileIcon`. Hidden and system entries are
  skipped, and at most 200 items are returned. It never reads file contents and never creates,
  moves, renames or deletes anything.
- `openPath` works only with permission, only for paths from the latest listing, and is rate-limited
  to 1 per second (3 seconds for the same item). It hands the item to the OS (`shell.openPath`),
  just like a double-click.
- Renderer hardening: `contextIsolation`, `sandbox` (plus `app.enableSandbox()`), no `nodeIntegration`,
  no webviews, no popups, and navigation is locked to `fishtop://app`. IPC accepts only that origin.
  The preload exposes a fixed function list and never exposes `ipcRenderer`.
- No remote content. Pages are served from `dist/` by a custom protocol with a strict CSP (`'self'`
  only, inline styles allowed). All http(s)/ws(s) requests are cancelled, permission requests other
  than fullscreen, pointer lock and clipboard write are denied, and the spellchecker (which would
  download dictionaries) is off.
- Settings live in `<userData>/settings.json`: mode, window bounds and Desktop permission.

## Platform caveats

- **Windows:** wallpaper mode depends on undocumented Explorer internals and can break with Windows
  updates. It handles both the classic WorkerW layout and the 24H2 layout where WorkerW is a child of
  Progman. Restarting Explorer detaches the window, so switch modes again. Security tools may flag
  `powershell -EncodedCommand`. After leaving wallpaper mode the background can stay stale until
  Explorer repaints.
- **macOS:** the OS asks separately for Desktop folder access (TCC) on the first listing. Overlay
  uses the `floating` level and stays visible on all Spaces. `type: 'desktop'` wallpaper sits under
  the Finder icons. Launch at login uses login items.
- **Linux (X11):** transparency needs a compositor. Mouse moves are not forwarded through
  click-through windows, and Chromium's cursor position goes stale there, so the shell asks the X
  server directly (`QueryPointer` on the local display socket, authenticated with the MIT cookie from
  `XAUTHORITY`). Wallpaper `type: 'desktop'` placement depends on the window manager and desktop
  icon implementation.
- **Linux (Wayland):** Electron runs natively on Wayland when the session is Wayland. Global cursor
  position, always-on-top and window placement are not available there, global shortcuts may need
  the desktop portal, and wallpaper mode falls back to window. For overlay/wallpaper, launch with
  `--ozone-platform=x11` (XWayland). Even then, the cursor position updates only over X11 windows.
- Overlay covers the **primary** display only. It refits when displays change.
