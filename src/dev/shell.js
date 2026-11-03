// Dev preview (Shell agent, phase 4): menu icon sheet, rod/bait icons and the Dot NPC used by the HUD and the
// Bait Shop. node tools/build.mjs --dev shell -> dist/dev/shell.html
import { ctxOf } from '../core/canvas.js';
import { drawText } from '../gfx/font.js';
import { getBigIcon, BIG_ICON_IDS } from '../gfx/bigicons.js';
import { labIcon } from '../ui/labicons.js';
import { drawNPC } from '../gfx/npcs.js';
import { ecoBackdrop } from '../ui/aero.js';
import { RODS } from '../game/rods.js';
import { BAITS, SPECIAL_ORDER } from '../store/bait.js';
import { drawBaitGloss } from '../fishing/baitart.js';

export function run() {
  const W = 960, H = 540;
  const cv = document.getElementById('screen');
  cv.width = W; cv.height = H;
  cv.style.width = W * 2 + 'px'; cv.style.height = H * 2 + 'px';
  const g = ctxOf(cv);
  let t = 0;
  function draw() {
    t += 1 / 60;
    g.drawImage(ecoBackdrop(W, H), 0, 0);
    BIG_ICON_IDS.forEach((id, i) => {
      const x = 30 + (i % 12) * 76, y = 20 + Math.floor(i / 12) * 70;
      const ic = getBigIcon(id, { size: 'big' });
      g.drawImage(ic.canvas, x, y);
      drawText(g, id, x + 22, y + 50, { align: 'center', font: 'small', color: '#ffffff', shadow: '#0b1622' });
    });
    RODS.forEach((r, i) => {
      const c = labIcon('rod:' + r.id, 28);
      if (c) g.drawImage(c, 30 + i * 40, 170);
    });
    SPECIAL_ORDER.forEach((id, i) => drawBaitGloss(g, BAITS[id].art, 40 + i * 44, 240, 34, t, {}));
    drawNPC(g, 'dot', { x: 120, y: 400, t, scale: 1.4, pose: 'talk', talk: (Math.sin(t * 9) + 1) / 2 });
    drawNPC(g, 'dot', { x: 260, y: 400, t, scale: 2, pose: 'wave', mood: 'happy' });
    requestAnimationFrame(draw);
  }
  draw();
  window.__galleryReady = true;
}
