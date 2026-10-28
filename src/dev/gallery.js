// Dev-only art gallery (open index.html?gallery) for checking sprites.
import { makeCanvas, ctxOf } from '../core/canvas.js';
import { compiled, frame } from '../gfx/spritecache.js';
import { drawText } from '../gfx/font.js';

import { TEST_LOOKS } from './testlooks.js';

export function run(params) {
  runGallery(TEST_LOOKS, { frozen: params.has('frozen'), angle: Number(params.get('angle') || 0), fs: Number(params.get('fs') || 1) });
}

export function runGallery(looks, opts = {}) {
  const W = opts.w || 640, H = opts.h || 360, S = opts.scale || 3;
  const cv = document.getElementById('screen');
  cv.width = W; cv.height = H;
  cv.style.width = W * S + 'px'; cv.style.height = H * S + 'px';
  const g = ctxOf(cv);
  const items = looks.map((l) => ({ name: l.name, c: compiled(l.look, l.variant || null) }));
  let t = 0;
  function draw() {
    t += 1 / 60;
    g.fillStyle = opts.bg || '#2b6f8f';
    g.fillRect(0, 0, W, H);
    const cols = opts.cols || 6;
    const cw = W / cols, ch = opts.rowH || 60;
    items.forEach((it, i) => {
      const cx = (i % cols) * cw + cw / 2, cy = Math.floor(i / cols) * ch + ch / 2 + 4;
      const f = frame(it.c, { phase: opts.frozen ? opts.phase || 0 : t * 1.5, angle: opts.angle || 0, scale: opts.fs || 1, inflate: it.name.includes('inflated') ? 1 : 0, blink: false });
      g.drawImage(f.canvas, Math.round(cx - f.ox), Math.round(cy - f.oy));
      drawText(g, it.name, cx, cy + 18, { font: 'small', align: 'center', color: '#ffffff', shadow: '#0b1622' });
    });
    if (!opts.frozen) requestAnimationFrame(draw);
  }
  draw();
  window.__galleryReady = true;
}
