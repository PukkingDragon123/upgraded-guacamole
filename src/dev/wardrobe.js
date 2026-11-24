// Dev preview of the Wardrobe's voxel boutique [wardrobe26]: dist/dev/wardrobe.html?w=1360&h=800&spin=0&t=3
import { ctxOf } from '../core/canvas.js';
import { drawWardrobeRoom, wardrobeRoomPending, wardrobeRoomStats } from '../ui/wardroberoom.js';
import { drawCharacter, normalizeLook } from '../gfx/character.js';

export function run(params) {
  const W = Number(params.get('w') || 1360), H = Number(params.get('h') || 800);
  const cv = document.getElementById('screen');
  cv.width = W; cv.height = H;
  cv.style.width = W + 'px'; cv.style.height = H + 'px';
  cv.style.imageRendering = 'pixelated';
  const ctx = ctxOf(cv);
  const spin = Number(params.get('spin') || -24), tFix = params.get('t');
  const t0 = performance.now();
  let frames = 0, worst = 0;
  const loop = () => {
    const f0 = performance.now();
    const t = tFix != null ? Number(tFix) : (f0 - t0) / 1000;
    ctx.clearRect(0, 0, W, H);
    const R = drawWardrobeRoom(ctx, { x: 0, y: 0, w: W, h: H }, t, { spin });
    drawCharacter(ctx, R.feet[0], R.feet[1], { pose: 'idle', t, yaw: spin, scale: Math.round((H * 0.29 / 72) * 4) / 4, look: normalizeLook(null), id: 'dev', shadow: true });
    R.front(ctx);
    const ms = performance.now() - f0;
    frames++; if (frames > 5) worst = Math.max(worst, ms);
    window.__room = { pending: wardrobeRoomPending(), worst, frames, stats: wardrobeRoomStats() };
    requestAnimationFrame(loop);
  };
  loop();
}
