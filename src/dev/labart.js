// Dev preview: the Lab's procedural art (src/ui/labart.js).  node tools/build.mjs --dev labart
import { ctxOf } from '../core/canvas.js';
import { ecoScene, ecoOrb, leafSprig, labRoom, drawTube, drawFlask, drawSplash, drawRays } from '../ui/labart.js';

export function run() {
  const W = 960, H = 540;
  const cv = document.getElementById('screen');
  cv.width = W; cv.height = H;
  cv.style.width = W * 2 + 'px'; cv.style.height = H * 2 + 'px';
  const g = ctxOf(cv);
  g.drawImage(labRoom(W, H, { x: 20, y: 20, w: 220, h: 150 }), 0, 0);
  g.drawImage(ecoScene(400, 225), 540, 10);
  const cols = ['#35c8ff', '#ffc23a', '#3f8cff', '#19c7a2', '#ff74b4', '#6fd23f', '#ff9330', '#a98aff'];
  cols.forEach((c, i) => {
    for (const [j, look] of ['done', 'open', 'locked'].entries()) { const o = ecoOrb(12, c, look); g.drawImage(o, 270 + i * 32 - o.width / 2, 260 + j * 32 - o.height / 2); }
  });
  const sun = ecoOrb(20, '#ffffff', 'sun'); g.drawImage(sun, 300 - sun.width / 2, 400 - sun.height / 2);
  drawRays(g, 300, 400, 80, 0, 0.3);
  const s1 = leafSprig(110, 1, false); g.drawImage(s1.canvas, 20 - s1.ox, 470 - s1.oy);
  const s2 = leafSprig(90, 2, true); g.drawImage(s2.canvas, 940 - s2.ox, 300 - s2.oy);
  drawTube(g, [[560, 300], [620, 280], [700, 300], [760, 360]], { t: 1.3, water: 1, color: '#35c8ff' });
  drawTube(g, [[560, 340], [620, 320], [700, 340], [760, 400]], { t: 1.3, water: 0.5, color: '#6fd23f' });
  drawTube(g, [[560, 380], [620, 360], [700, 380], [760, 440]], { t: 1.3, water: 0 });
  drawFlask(g, 820, 460, { t: 2, level: 0.6, color: '#35c8ff', active: true, glow: 1 });
  drawFlask(g, 860, 460, { t: 2, level: 0.3, color: '#ff74b4' });
  drawSplash(g, 900, 420, 0.35);
  window.__ready = true;
}
