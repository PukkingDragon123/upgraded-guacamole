# FISHTOP desktop app (Electron)

FISHTOP is a standalone Frutiger Aero fishing game. The desktop app wraps the same web build
(`dist/index.html` + `dist/fishtop.js`) in a small Electron shell (`electron/main.cjs`,
`electron/preload.cjs`) and runs it as a normal game: in a resizable window or fullscreen. The game talks
to the shell only through `src/platform/host.js`, which also works in a plain browser (fullscreen
falls back to the browser's Fullscreen API).

The old desktop-overlay features are gone: no transparent click-through overlay, no wallpaper or mini
modes, no tray, no global shortcuts and no access to your Desktop folder.

## Run

```sh
npm install                              # also downloads the Electron binary
npm run app                              # build the web bundle, then launch (npm run desktop is an alias)
npm run app -- --fullscreen              # start fullscreen (or --mode=fullscreen / --mode=window)
npm run app -- --dev=shell               # load a dev preview (dist/dev/shell.html if built, else ?dev=shell)
```

- Running as root (containers/CI) needs Chromium's `--no-sandbox`: `npx electron . --no-sandbox`.
- Headless smoke test: `FISHTOP_SMOKE_MS=2500 FISHTOP_SMOKE_MODES=window,fullscreen FISHTOP_SMOKE_SHOT=tests/out/app.png xvfb-run -a npx electron . --no-sandbox`
  logs one `[fishtop] smoke ...` line per mode, saves a capture per mode, then quits.
- `FISHTOP_PROFILE_DIR=<dir>` uses a separate settings/storage profile. `FISHTOP_DEVTOOLS=1` allows
  DevTools (F12) in a packaged build; they are always allowed when running from source.
- Only one instance runs; launching again focuses the open window.

## Window

The page is loaded as `fishtop://app/index.html?host=electron&mode=<window|fullscreen>`.

| Keys | Action |
|---|---|
| F11 or Alt+Enter | Toggle fullscreen (handled by the shell). |
| Esc | In game: open the Settings menu, or close the open panel. |
| F12 / Ctrl+Shift+I | DevTools (from source, or with `FISHTOP_DEVTOOLS=1`). |

Settings has a Fullscreen switch too. The shell remembers the window size and position, whether it was
maximized and whether you were playing fullscreen (`userData/settings.json`). Game saves live in the
page's `localStorage`, exactly as in the browser build.

## Host bridge (`src/platform/host.js`)

| API | Meaning |
|---|---|
| `host.kind` | `'web'` or `'electron'` |
| `host.mode` | `'window'` or `'fullscreen'` (how the page started) |
| `host.isFullscreen()`, `host.setFullscreen(on)`, `host.toggleFullscreen()` | Electron window fullscreen, or the browser's Fullscreen API |
| `host.onFullscreen(cb)` | `cb(on)` whenever fullscreen changes |
| `host.onShortcut(cb)` | `cb('fullscreen')` for Alt+Enter in a browser |
| `host.quit()` | Electron only |

`setInteractive`, `setFishing`, `onCursor`, `requestDesktopFiles` (always `[]`) and `openPath` remain as
harmless no-ops so older code keeps running; `transparent`, `clickThrough`, `lowPower` and
`canUseRealDesktop` are always `false`.

## Security

- Renderers are sandboxed and context-isolated, with no Node integration; the preload exposes only the
  small `window.fishtopHost` API above, and every IPC call checks that it comes from `fishtop://app`.
- Content is served from `dist/` through the private `fishtop://` protocol with a strict CSP. Path
  traversal outside `dist/` is refused.
- All `http(s)` / `ws(s)` requests are cancelled, new windows are denied, navigation away from
  `fishtop://app` is blocked and only the `fullscreen`, `pointerLock` and sanitized clipboard-write
  permissions are granted.

## Browser extension

The browser companion in `extension/` is unchanged: `node tools/build.mjs` still bundles
`src/overlay/main.js` into `extension/overlay.js` (see `extension/README.md`).
