// [pixui30] Dev preview of the pixel-art UI kit (aero.js PIXEL KIT): ?dev=pixui (logical 480 x 270 at CSS 4x).
import { ctxOf } from '../core/canvas.js';
import { drawText } from '../gfx/font.js';
import {
  pixelPanel, pixelButton, pixelBar, pixelBadge, pixelChip, pixelRect, pixelRectPath, pixelHalo, pixelShadow, pixelGradient,
  pixelGlassPlate, drawGlossOrb, drawAeroGlow, drawAeroLabel, drawAeroFrame,
  pixelBubble, pixelBubbleCapsule, pixelBubbleButton, pixelBubbleBadge, pixelBubbleRing, drawAeroButton, drawAeroBadge,
} from '../ui/aero.js';
import { drawSlider, drawToggle, drawTooltip, drawTab, drawBubble } from '../ui/panels.js';
import { drawWalletPlaque, walletTick } from '../ui/gemui.js';

// [bubble34] the pixel bubble kit on a dark and a light strip
function bubbles(g, t) {
  const y0 = 262;
  g.fillStyle = '#0c2c56'; g.fillRect(0, y0, W2, 70);
  g.fillStyle = '#dff3fc'; g.fillRect(0, y0 + 70, W2, 68);
  drawText(g, 'pixelBubble 3..40 px', 4, y0 + 2, { font: 'small', color: '#bff4ff' });
  let x = 6;
  for (const d of [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 18, 20, 24, 28]) { pixelBubble(g, x + d / 2, y0 + 30, d / 2, { tone: 'aqua' }); x += d + 3; }
  x = 6;
  for (const d of [7, 10, 14, 18, 24, 32, 40]) { pixelBubble(g, x + d / 2, y0 + 70 + 4 + 20, d / 2, { glass: true }); x += d + 4; }
  const tones = ['red', 'orange', 'green', 'purple', 'white', 'grey'];
  tones.forEach((tn, i) => pixelBubble(g, 300 + i * 24, y0 + 22, 10, { tone: tn }));
  tones.forEach((tn, i) => pixelBubble(g, 300 + i * 24, y0 + 50, 6.5, { tone: tn }));
  pixelBubbleCapsule(g, 300, y0 + 80, 60, 15, { tone: 'aqua' });
  pixelBubbleCapsule(g, 366, y0 + 80, 44, 11, { tone: 'green' });
  pixelBubbleCapsule(g, 416, y0 + 78, 56, 20, { glass: true });
  drawText(g, 'NEW', 381, y0 + 83, { font: 'small', color: '#ffffff', shadow: '#1c5a0e' });
  const st = ['normal', 'hover', 'down', 'disabled'];
  st.forEach((s, i) => pixelBubbleButton(g, 200 + i * 22, y0 + 104, 9, { tone: 'red', glyph: 'x', state: s }));
  st.forEach((s, i) => pixelBubbleButton(g, 200 + i * 22, y0 + 126, 9, { tone: 'aqua', glyph: i % 2 ? '-' : '+', state: s }));
  drawAeroButton(g, 300, y0 + 104, 24, 24, { icon: null, label: '', bubble: true, tone: 'green' });
  pixelBubbleBadge(g, 360, y0 + 106, 3, t); pixelBubbleBadge(g, 380, y0 + 106, '!', t); pixelBubbleBadge(g, 410, y0 + 106, 27, t); drawAeroBadge(g, 450, y0 + 106, 128, t);
  pixelBubble(g, 360, y0 + 128, 8, { tone: 'white' }); pixelBubbleRing(g, 360, y0 + 128, 8, '#59c3ff', 1);
  pixelGlassPlate(g, 400, y0 + 126, 22, {}); drawGlossOrb(g, 430, y0 + 126, 5, '#ff9d2e'); drawGlossOrb(g, 450, y0 + 126, 3, '#4cc83a');
}
const W2 = 480;
// [bubble34] the pixel bubble wallet (FULL at p = 1 / 1.5 / 2, MINI) on a fake UI; click = a gain
const fakeUi = { time: 0, coinShown: 12480, gemShown: 37, coinBump: 0, gemBump: 0, game: { state: { settings: {}, coins: 12480, gems: 37 } }, hover: () => false };
function wallets(g, t) {
  const y0 = 400;
  g.fillStyle = '#0a2a52'; g.fillRect(0, y0, W2, 130);
  fakeUi.time = t; fakeUi.coinBump = Math.max(0, fakeUi.coinBump - 1 / 60 * 3); fakeUi.gemBump = Math.max(0, fakeUi.gemBump - 1 / 60 * 2.2);
  if ((t % 4) < 1 / 60) { fakeUi.coinShown += 125; fakeUi.coinBump = 1; fakeUi.gemShown += 1; fakeUi.gemBump = 1; }
  walletTick(fakeUi, 1 / 60);
  drawWalletPlaque(g, fakeUi, { right: 150, y: y0 + 6, p: 1 });
  drawWalletPlaque(g, fakeUi, { right: 150, y: y0 + 40, p: 1, mini: true, id: 'm' });
  drawWalletPlaque(g, fakeUi, { right: 470, y: y0 + 4, p: 1.5, id: 'b' });
  drawWalletPlaque(g, fakeUi, { right: 300, y: y0 + 40, p: 1.5, mini: true, id: 'bm' });
  // gain frames (coinBump / gemBump fixed)
  const keep = [fakeUi.coinBump, fakeUi.gemBump, fakeUi.time];
  [0.92, 0.75, 0.5].forEach((k, i) => { fakeUi.coinBump = k; fakeUi.gemBump = k; fakeUi.time = 1; drawWalletPlaque(g, fakeUi, { right: 150 + i * 160, y: y0 + 98, p: 1, id: 'f' + i }); });
  [fakeUi.coinBump, fakeUi.gemBump, fakeUi.time] = keep;
}

export function run() {
  const W = 480, H = 530, S = 3; // [bubble34] + the pixel bubble kit (bottom)
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
    bubbles(g, t);
    wallets(g, t);
    requestAnimationFrame(draw);
  }
  draw();
  window.__galleryReady = true;
}
