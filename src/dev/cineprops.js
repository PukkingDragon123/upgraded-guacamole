// Dev preview of the quest cutscene set dressing [cine21]: dist/dev/cineprops.html?H=720&zoom=1
import { ctxOf } from '../core/canvas.js';
import { drawText } from '../gfx/font.js';
import { PROP_DEFS, propNow, drawProp } from '../ui/cineprops.js';

export function run(params) {
  const W = 1280, Hc = 720, H = Number(params.get('H') || 720), zoom = Number(params.get('zoom') || 1);
  const cv = document.getElementById('screen');
  cv.width = W; cv.height = Hc;
  cv.style.width = W * zoom + 'px'; cv.style.height = Hc * zoom + 'px';
  cv.style.imageRendering = 'pixelated';
  const ctx = ctxOf(cv);
  const g = ctx.createLinearGradient(0, 0, 0, Hc);
  g.addColorStop(0, '#7ac8ff'); g.addColorStop(1, '#1a5a9a');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, Hc);
  const ids = Object.keys(PROP_DEFS);
  let x = 120, y = 200;
  for (const id of ids) {
    const n = id === 'crab' ? 6 : 1;
    for (let v = 0; v < n; v++) {
      const s = propNow(id, 0, v, H);
      if (!s) continue;
      if (x + s.w > W - 20) { x = 120; y += 200; }
      ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.fillRect(x - 60, y, 140, 1);
      drawProp(ctx, id, 0, v, x, y, 1, H);
      if (v === 0) drawText(ctx, id, x - 50, y + 6, { color: '#ffffff', shadow: '#000' });
      x += Math.max(70, s.w * 0.6 + 40);
    }
  }
  window.__done = true;
}
