// [pixui30] Dev preview of the pixel-art UI kit (aero.js PIXEL KIT): ?dev=pixui (logical 480 x 270 at CSS 4x).
import { ctxOf } from '../core/canvas.js';
import { drawText } from '../gfx/font.js';
import {
  pixelPanel, pixelButton, pixelBar, pixelBadge, pixelChip, pixelRect, pixelRectPath, pixelHalo, pixelShadow, pixelGradient,
  pixelGlassPlate, drawGlossOrb, drawAeroGlow, drawAeroLabel, drawAeroFrame,
} from '../ui/aero.js';
import { drawSlider, drawToggle, drawTooltip, drawTab, drawBubble } from '../ui/panels.js';

export function run() {
  const W = 480, H = 270, S = 4;
  const cv = document.getElementById('screen');
  cv.width = W; cv.height = H;
  cv.style.width = W * S + 'px'; cv.style.height = H * S + 'px';
  const g = ctxOf(cv);
  let t = 0;
  function draw() {
    t += 1 / 60;
    g.fillStyle = pixelGradient(g, 0, 0, 0, H, [[0, '#1e8fe0'], [1, '#bfeaff']], 6);
    g.fillRect(0, 0, W, H);
    const f = drawAeroFrame(g, 6, 6, 250, 150, { title: 'Pixel Kit', leaves: false });
    pixelPanel(g, f.content.x + 4, f.content.y + 4, 110, 60, { title: 'pixelPanel' });
    pixelButton(g, f.content.x + 124, f.content.y + 6, 80, 19, { label: 'Button' });
    pixelButton(g, f.content.x + 124, f.content.y + 30, 80, 19, { label: 'Hover', tone: 'green', state: 'hover' });
    pixelButton(g, f.content.x + 124, f.content.y + 54, 80, 19, { label: 'Down', tone: 'orange', state: 'down' });
    pixelBar(g, f.content.x + 8, f.content.y + 72, 100, 8, 0.5 + 0.5 * Math.sin(t), { color: '#4cc83a', segments: 5 });
    pixelBadge(g, f.content.x + 112, f.content.y + 2, 3, t);
    pixelChip(g, f.content.x + 8, f.content.y + 86, 60, 13, { tone: 'aqua' });
    drawText(g, 'chip', f.content.x + 26, f.content.y + 89, { color: '#ffffff' });
    f.finish(g);
    // widgets
    drawSlider(g, 270, 14, 120, 0.6);
    drawToggle(g, 400, 10, true);
    drawToggle(g, 436, 10, false);
    drawTab(g, 270, 40, 60, 18, { label: 'Tab', active: true });
    drawTab(g, 332, 40, 60, 18, { label: 'Tab' });
    drawGlossOrb(g, 280, 80, 7, '#ff9d2e'); drawGlossOrb(g, 300, 80, 4, '#2fd3e8'); drawGlossOrb(g, 324, 80, 10, '#4cc83a');
    pixelGlassPlate(g, 360, 82, 30, {});
    drawAeroGlow(g, 420, 82, 20, '#fff6a0', 0.8);
    pixelRect(g, 270, 100, 40, 20, 4, '#e8fff0', { outline: '#3a9a5a', hi: '#ffffff', lo: '#bfe8cc' });
    pixelShadow(g, 320, 100, 40, 20, 2, 2, { n: 2 }); pixelRect(g, 320, 100, 40, 20, 6, '#ffe8ea', { outline: '#d0485a', hi: '#ffffff' });
    g.strokeStyle = '#0a3e74'; pixelRectPath(g, 370.5, 100.5, 39, 19, 12); g.stroke();
    pixelHalo(g, 420, 100, 40, 20, 2, '#ffffff', 1); pixelRect(g, 420, 100, 40, 20, 4, '#59c3ff', { outline: '#0b4a8a' });
    drawAeroLabel(g, 'drawAeroLabel', 270, 130, {});
    drawBubble(g, 280, 170, 120, 30, { tailX: 270, tailY: 215 });
    drawText(g, 'speech bubble', 290, 180, { color: '#0c3a52' });
    drawTooltip(g, 20, 170, 'A pixel tooltip\nwith two lines', {});
    requestAnimationFrame(draw);
  }
  draw();
  window.__galleryReady = true;
}
