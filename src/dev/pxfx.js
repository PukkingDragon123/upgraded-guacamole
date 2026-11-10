// Dev preview for the phase 8 pixel-art particle library (dist/dev/pxfx.html?page=N):
// 0 = every sprite sheet (x4) + live bursts, 1 = item pixel art.
import { ctxOf } from '../core/canvas.js';
import { drawText } from '../gfx/font.js';
import { pxFrames, PX_SHEETS } from '../gfx/pxsprites.js';
import { Particles } from '../gfx/particles.js';
import { ecoBackdrop } from '../ui/aero.js';

const RAMPS = { sparkle: 'gold', star: 'gold', heart: 'pink', drop: 'aqua', aero: 'aqua', bubble: 'white', pop: 'white', scale: 'aqua', leaf: 'leaf', petal: 'pink', puff: 'white', smoke: 'smoke', dust: 'dust', zap: 'cyan', spark: 'cyan', impact: 'gold', confetti: 'pink', ribbon: 'purple', wave: 'foam', note: 'purple', shard: 'cyan' };

export async function run(params) {
  const cv = document.getElementById('screen') || document.body.appendChild(document.createElement('canvas'));
  cv.width = 960; cv.height = 540;
  cv.style.cssText = 'width:1920px;height:1080px;image-rendering:pixelated';
  const g = ctxOf(cv);
  const page = Number(params.get('page') || 0);
  const bg = ecoBackdrop(960, 540, { seed: 3 });
  if (page === 2) {
    const { loadAlagard, alagardBitmap } = await import('../gfx/alagard.js');
    await loadAlagard();
    g.drawImage(bg, 0, 0);
    let y = 10;
    for (const [size, sc] of [[16, 1], [16, 2], [24, 1], [32, 1], [12, 2], [20, 1]]) {
      const b = alagardBitmap('Satchel FishDex Quests gjpqy 0123', { size, color: '#ffffff' });
      g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(10, y, b.width * sc, b.height * sc);
      g.drawImage(b, 10, y, b.width * sc, b.height * sc);
      drawText(g, size + ' x' + sc + '  h=' + b.height, 600, y + 4, { color: '#ffffff', outline: '#0a2a4a' });
      y += b.height * sc + 8;
    }
    drawText(g, 'Satchel big x2', 10, y, { font: 'big', scale: 2, color: '#ffffff', shadow: '#0a3e74' });
    return;
  }
  if (page === 1) {
    const { itemPixel, PIXEL_ITEM_IDS } = await import('../build/itempix.js');
    g.drawImage(bg, 0, 0);
    g.fillStyle = 'rgba(255,255,255,0.55)'; g.fillRect(0, 0, 960, 540);
    [...PIXEL_ITEM_IDS].forEach((id, i) => {
      const x = 12 + (i % 8) * 118, y = 10 + Math.floor(i / 8) * 128;
      const s = itemPixel(id);
      if (s) g.drawImage(s.canvas, x, y, s.w * 3, s.h * 3);
      if (s) g.drawImage(s.canvas, x + 80, y + 4);
      drawText(g, id, x, y + 110, { color: '#0c3a52', font: 'small' });
    });
    return;
  }
  const P = new Particles(2000);
  let t = 0;
  const frame = () => {
    t += 1 / 60;
    g.drawImage(bg, 0, 0);
    g.fillStyle = 'rgba(8,40,80,0.35)'; g.fillRect(0, 0, 960, 250);
    PX_SHEETS.forEach((name, i) => {
      const x = 8 + (i % 7) * 136, y = 6 + Math.floor(i / 7) * 80;
      for (let sz = 0; sz < 3; sz++) {
        const F = pxFrames(name, RAMPS[name], sz);
        F.slice(0, 5).forEach((c, k) => { if (sz === 1) g.drawImage(c, x + k * 26, y + 12, c.width * 2, c.height * 2); });
      }
      const F = pxFrames(name, RAMPS[name], 1);
      const c = F[Math.floor(t * 8) % F.length];
      g.drawImage(c, x + 104, y + 46, c.width * 2, c.height * 2);
      drawText(g, name, x, y, { color: '#ffffff', font: 'small', outline: '#0a2a4a' });
    });
    const k = Math.floor(t * 60);
    const fx = [
      () => P.impact(80, 380, 1), () => P.celebrate(200, 380, 1), () => P.pixelSplash(320, 400, 1), () => P.hearts(430, 380, 5),
      () => P.zapBurst(530, 380, 4), () => P.purchase(630, 380, { layer: 'fg' }), () => P.chestOpen(750, 400, 'epic', { layer: 'fg' }),
      () => P.levelUp(870, 420, { layer: 'fg' }), () => P.poof(80, 480), () => P.pixelBurst('leaf', 200, 500, 6), () => P.pixelBurst('petal', 320, 500, 6),
      () => P.pixelBurst('smoke', 430, 500, 5), () => P.pixelBurst('bubble', 530, 500, 6), () => P.pixelBurst('scale', 630, 480, 8), () => P.shockwave(750, 480, 30, '#ff6f9a'),
      () => P.ringWave(870, 490, 40, '#bff8ff'),
    ];
    if (k % 50 === 1) for (const f of fx) f();
    P.update(1 / 60);
    P.draw(g, 'fg', t);
    if (params.get('once') && k > 70) return;
    requestAnimationFrame(frame);
  };
  frame();
}
