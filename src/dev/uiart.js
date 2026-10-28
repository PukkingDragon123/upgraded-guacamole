// Dev preview of the UI art kit (temporary skeleton).
import { ctxOf } from '../core/canvas.js';
import { drawText } from '../gfx/font.js';
import { getUiIcon, registerUiIcons, UI_ICON_NAMES, CURSOR_NAMES } from '../gfx/uiicons.js';

export function run(params) {
  const W = 960, H = 540, S = 2;
  const cv = document.getElementById('screen');
  cv.width = W; cv.height = H;
  cv.style.width = W * S + 'px'; cv.style.height = H * S + 'px';
  const g = ctxOf(cv);
  g.fillStyle = '#2b7f8f';
  g.fillRect(0, 0, W, H);
  registerUiIcons();
  const z = Number(params.get('z') || 4);
  [...UI_ICON_NAMES, ...CURSOR_NAMES].forEach((n, i) => {
    const c = getUiIcon(n);
    const cols = 10;
    const x = 10 + (i % cols) * 94, y = 6 + Math.floor(i / cols) * 66;
    g.drawImage(c, x, y, c.width * z, c.height * z);
    drawText(g, n, x, y + 4 + c.height * z, { font: 'small', color: '#fff', shadow: '#0b1622' });
  });
  window.__ready = true;
}
