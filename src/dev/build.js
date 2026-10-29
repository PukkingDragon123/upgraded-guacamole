// Dev preview for the building system: dist/dev/build.html?v=gallery (models) - more views added below.
import { ctxOf } from '../core/canvas.js';
import { drawText } from '../gfx/font.js';
import { registerUiIcons } from '../gfx/uiicons.js';
import { buildingSprite, MODEL_IDS } from '../build/buildingmodels.js';
import { itemSprite, ART_IDS } from '../build/itemart.js';
import { drawPackage, TIER_ORDER } from '../build/items.js';
import { BUILDINGS } from '../build/buildings.js';

function zoom(ctx, W, H, t, params) {
  ctx.fillStyle = '#2a6a8a';
  ctx.fillRect(0, 0, W, H);
  const ids = (params.get('ids') || [...MODEL_IDS].slice(0, 5).join(',')).split(',');
  let x = 10;
  const sc = Number(params.get('s') || 1.1);
  for (const id of ids) {
    const s = buildingSprite(id, { force: true, scale: sc });
    ctx.drawImage(s.canvas, x, H - 20 - s.h);
    x += s.w + 10;
  }
}

function gallery(ctx, W, H, t) {
  ctx.fillStyle = '#2a6a8a';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#d8c08a';
  ctx.fillRect(0, 250, W, 6);
  let x = 10;
  const ids = [...MODEL_IDS];
  ids.forEach((id, i) => {
    const s = buildingSprite(id, { force: true, scale: 0.62 });
    const row = i < 5 ? 0 : 1;
    if (i === 5) x = 10;
    const gy = row === 0 ? 250 : 500;
    if (row === 1 && i === 5) { ctx.fillStyle = '#d8c08a'; ctx.fillRect(0, 500, W, 6); }
    ctx.drawImage(s.canvas, Math.round(x + s.w / 2 - s.ox + 40 - s.w / 2), gy - s.oy);
    drawText(ctx, BUILDINGS[id]?.name || id, x + 40, gy + 10, { align: 'center', color: '#fff', outline: '#000', font: 'small' });
    x += Math.max(100, s.w + 20);
  });
  // items
  let ix = 10;
  const arts = [...ART_IDS];
  arts.forEach((id) => {
    const s = itemSprite(id, { frame: Math.floor(t * 6), force: true });
    if (s) ctx.drawImage(s.canvas, ix, 268);
    ix += 46;
  });
  TIER_ORDER.forEach((tier, i) => {
    drawPackage(ctx, 760 + i * 46, 300, tier, t, { scale: 1 });
    drawPackage(ctx, 760 + i * 46, 360, tier, t, { scale: 0.7 });
  });
}

export function run(params) {
  const W = Number(params.get('w')) || 960, H = Number(params.get('h')) || 540;
  const cv = document.getElementById('screen');
  cv.width = W; cv.height = H;
  cv.style.width = W * 2 + 'px'; cv.style.height = H * 2 + 'px';
  const ctx = ctxOf(cv);
  registerUiIcons();
  let t = 0, last = performance.now();
  const frame = (now) => {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000); last = now; t += dt;
    try { if (params.get('v') === 'zoom') zoom(ctx, W, H, t, params); else gallery(ctx, W, H, t); } catch (e) { console.error(e); }
  };
  requestAnimationFrame(frame);
}
