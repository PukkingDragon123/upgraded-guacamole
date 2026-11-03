// Dev preview (Online & AppSea agent): every bait as glossy voxel art. node tools/build.mjs --dev onlinebait
import { ctxOf } from '../core/canvas.js';
import { drawText } from '../gfx/font.js';
import { BAITS, SPECIAL_ORDER, CHARMS, COLOURS } from '../store/bait.js';
import { drawBaitGloss, baitMini } from '../fishing/baitart.js';

export function run() {
  const cv = document.getElementById('screen');
  const W = 960, H = 540;
  cv.width = W; cv.height = H;
  cv.style.width = W * 2 + 'px'; cv.style.height = H * 2 + 'px';
  cv.style.imageRendering = 'pixelated';
  const ctx = ctxOf(cv);
  const ids = [...SPECIAL_ORDER, ...Object.keys(BAITS).filter((id) => BAITS[id].app && (id.endsWith('_lite') || id.endsWith('_enterprise')))];
  let t = 0;
  const frame = () => {
    t += 1 / 60;
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#bfeaff'); g.addColorStop(1, '#2c9fe6');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ids.forEach((id, i) => {
      const x = 30 + (i % 16) * 58, y = 34 + Math.floor(i / 16) * 70;
      drawBaitGloss(ctx, BAITS[id].art, x, y, 44, t + i * 0.3);
      drawText(ctx, id.slice(0, 11), x, y + 26, { align: 'center', font: 'small', color: '#0c3a52' });
      const m = baitMini(BAITS[id].art);
      ctx.drawImage(m, x + 18, y + 14);
    });
    CHARMS.forEach((c, i) => {
      const art = { ...BAITS.worm.art, custom: true, color: COLOURS[i % COLOURS.length].hex, charm: c.id, scent: '#ffd23a' };
      drawBaitGloss(ctx, art, 40 + i * 70, 470, 56, t);
      const a2 = { ...BAITS.notes_pro.art, custom: true, color: COLOURS[(i + 2) % COLOURS.length].hex, charm: c.id };
      drawBaitGloss(ctx, a2, 480 + i * 70, 470, 56, t);
    });
    requestAnimationFrame(frame);
  };
  frame();
}
