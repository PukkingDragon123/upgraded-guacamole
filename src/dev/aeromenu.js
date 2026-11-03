// Dev preview of the Aero menu icons: dist/dev/aeromenu.html
//   row 1: the voxel menu icons at 'menu' size (1x), row 2: the same at 3x, row 3: 'big' size.
import { ctxOf } from '../core/canvas.js';
import { drawText } from '../gfx/font.js';
import { MENU_ICON_IDS, getBigIcon } from '../gfx/bigicons.js';
import { registerUiIcons } from '../gfx/uiicons.js';

const W = 960, H = 540;

export function run() {
  registerUiIcons();
  const cv = document.getElementById('screen');
  cv.width = W; cv.height = H;
  cv.style.width = W * 2 + 'px'; cv.style.height = H * 2 + 'px';
  cv.style.imageRendering = 'pixelated';
  const g = ctxOf(cv);
  const grd = g.createLinearGradient(0, 0, 0, H);
  grd.addColorStop(0, '#8fdcff'); grd.addColorStop(0.5, '#2f9ee0'); grd.addColorStop(1, '#0d4f8f');
  g.fillStyle = grd; g.fillRect(0, 0, W, H);
  MENU_ICON_IDS.forEach((id, i) => {
    const x = 30 + i * 90;
    const a = getBigIcon(id, { size: 'menu' });
    g.drawImage(a.canvas, x, 20);
    drawText(g, id, x, 70, { font: 'small', color: '#ffffff', shadow: '#0a3e74' });
    const b = getBigIcon(id, { size: 'menu' });
    g.drawImage(b.canvas, 0, 0, b.canvas.width, b.canvas.height, x - 10, 90, b.canvas.width * 2, b.canvas.height * 2);
    const c = getBigIcon(id, { size: 'big' });
    g.drawImage(c.canvas, x, 200);
  });
}
