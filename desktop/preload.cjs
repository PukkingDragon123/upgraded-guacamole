'use strict';
// FISHTOP preload (sandboxed, context-isolated). Exposes a small, explicit API as window.fishtopHost;
// the game reaches it through src/platform/host.js. Never hand ipcRenderer or events to the page.
const { contextBridge, ipcRenderer } = require('electron');

let info = null;
try { info = ipcRenderer.sendSync('fishtop:info'); } catch { info = null; }
info = info || {};
const mode = typeof info.mode === 'string' ? info.mode : 'window';

function subscribe(channel, cb) {
  if (typeof cb !== 'function') return () => {};
  const listener = (_event, payload) => {
    try { cb(payload); } catch (err) { console.error(err); }
  };
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('fishtopHost', {
  kind: 'electron',
  mode,
  platform: String(info.platform || ''),
  version: String(info.version || ''),
  electron: String(info.electron || ''),
  canUseRealDesktop: !!info.canUseRealDesktop,
  desktopAccess: String(info.desktopAccess || 'ask'),
  setInteractive: (on) => ipcRenderer.send('fishtop:set-interactive', !!on),
  setFishing: (on) => ipcRenderer.send('fishtop:set-fishing', !!on),
  setMode: (next) => ipcRenderer.invoke('fishtop:set-mode', String(next)),
  onShortcut: (cb) => subscribe('fishtop:shortcut', cb),
  onCursor: (cb) => subscribe('fishtop:cursor', cb),
  requestDesktopFiles: () => ipcRenderer.invoke('fishtop:desktop-files'),
  openPath: (p) => ipcRenderer.invoke('fishtop:open-path', String(p)),
  quit: () => ipcRenderer.send('fishtop:quit'),
});

window.addEventListener('DOMContentLoaded', () => {
  document.documentElement.dataset.host = 'electron';
  document.documentElement.dataset.hostMode = mode;
  if (mode !== 'mini') return;
  // Frameless mini window: an invisible strip along the top edge moves the window.
  const grip = document.createElement('div');
  grip.id = 'fishtop-grip';
  grip.title = 'Drag to move';
  grip.style.cssText = 'position:fixed;left:0;top:0;right:0;height:14px;z-index:2147483647;-webkit-app-region:drag;app-region:drag;';
  document.body.appendChild(grip);
});
