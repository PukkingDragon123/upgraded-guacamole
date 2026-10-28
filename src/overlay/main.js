// Browser-extension overlay entry (bundled to extension/overlay.js by tools/build.mjs).
// Injected by the extension into the top frame of a tab, either on demand ("Fish in this tab",
// activeTab) or by the opt-in roaming content script. Safe to inject more than once.

import { Overlay } from './overlay.js';

(function boot() {
  if (window.top !== window) return;
  if (document.documentElement?.localName !== 'html') return; // XML / SVG viewers
  const prev = window.__FISHTOP_OVERLAY__;
  if (prev && !prev.destroyed) { prev.wake(); return; }
  window.__FISHTOP_OVERLAY__ = new Overlay();
})();
