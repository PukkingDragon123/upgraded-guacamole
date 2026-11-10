// Dev preview: every 3D UI icon (src/gfx/icons3d.js) at full resolution. dist/dev/icons3d.html?px=40
import { ICON3D, drawIcon3D } from '../gfx/icons3d.js';
import { hiCtx } from '../gfx/hires.js';
import { drawText } from '../gfx/font.js';

export function run(params) {
  const cv = document.getElementById('screen');
  const W = 960, H = 540;
  cv.width = W * 2; cv.height = H * 2; cv.style.width = W * 2 + 'px'; cv.style.height = H * 2 + 'px';
  const g = hiCtx(cv, 2);
  const px = Number(params.get('px')) || 40;
  const names = Object.keys(ICON3D);
  const draw = () => {
    g.setTransform(1, 0, 0, 1, 0, 0);
    const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, '#dff6ff'); gr.addColorStop(1, '#7cc8f0');
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
    const cols = Math.floor(W / (px + 26));
    names.forEach((n, i) => {
      const x = 20 + (i % cols) * (px + 26) + px / 2, y = 20 + Math.floor(i / cols) * (px + 22) + px / 2;
      drawIcon3D(g, n, x, y, px, { t: performance.now() / 1000, hover: params.get('hover') ? 1 : 0 });
      drawText(g, n.slice(0, 8), x, y + px / 2 + 2, { font: 'small', align: 'center', color: '#0c3a52' });
    });
    requestAnimationFrame(draw);
  };
  draw();
}
