'use strict';
// FISHTOP preload (sandboxed, context-isolated). Exposes a small, explicit API as window.fishtopHost;
// the game reaches it through src/platform/host.js. Never hand ipcRenderer or events to the page.
const { contextBridge, ipcRenderer } = require('electron');

let info = null;
try { info = ipcRenderer.sendSync('fishtop:info'); } catch { info = null; }
info = info || {};
let fullscreen = !!info.fullscreen;
const fsListeners = new Set();

ipcRenderer.on('fishtop:fullscreen', (_event, payload) => {
  fullscreen = !!(payload && payload.on);
  for (const cb of [...fsListeners]) { try { cb(fullscreen); } catch (err) { console.error(err); } }
});

contextBridge.exposeInMainWorld('fishtopHost', {
  kind: 'electron',
  mode: fullscreen ? 'fullscreen' : 'window',
  platform: String(info.platform || ''),
  version: String(info.version || ''),
  electron: String(info.electron || ''),
  isFullscreen: () => fullscreen,
  setFullscreen: (on) => ipcRenderer.invoke('fishtop:set-fullscreen', !!on),
  toggleFullscreen: () => ipcRenderer.invoke('fishtop:toggle-fullscreen'),
  onFullscreen: (cb) => {
    if (typeof cb !== 'function') return () => {};
    fsListeners.add(cb);
    return () => fsListeners.delete(cb);
  },
  quit: () => ipcRenderer.send('fishtop:quit'),
});

window.addEventListener('DOMContentLoaded', () => {
  document.documentElement.dataset.host = 'electron';
});
