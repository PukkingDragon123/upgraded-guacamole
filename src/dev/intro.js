// Dev preview for the Intro agent: ?view=wall renders the desktop landscape (with timing).
import { ctxOf } from '../core/canvas.js';
import { renderLandscape } from '../desktop/wallpaper.js';

export function run(params) {
  const W = Number(params.get('w') || 960), H = Number(params.get('h') || 540);
  const cv = document.getElementById('screen');
  cv.width = W; cv.height = H;
  cv.style.width = W * 2 + 'px'; cv.style.height = H * 2 + 'px';
  const g = ctxOf(cv);
  const t0 = performance.now();
  const c = renderLandscape(W, H);
  const ms = performance.now() - t0;
  g.drawImage(c, 0, 0);
  console.log('landscape ms', ms.toFixed(1));
  window.__ms = ms;
}
