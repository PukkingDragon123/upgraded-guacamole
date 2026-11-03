// Dev preview: the Lab's voxel scenery (src/ui/labvox.js) and 2D effects.  node tools/build.mjs --dev labart
import { ctxOf } from '../core/canvas.js';
import { drawText } from '../gfx/font.js';
import { voxBudget, roomChunk, floorChunk, ROOM_CHUNK, windowFrame, windowView, bench, flask, pipe, shelf, clock, plant, sprig, seaScene, drawPiece } from '../ui/labvox.js';
import { drawRays } from '../ui/labart.js';

export function run() {
  const W = 960, H = 540;
  const cv = document.getElementById('screen');
  cv.width = W; cv.height = H;
  cv.style.width = W * 2 + 'px'; cv.style.height = H * 2 + 'px';
  const g = ctxOf(cv);
  g.fillStyle = '#334'; g.fillRect(0, 0, W, H);
  voxBudget(1e9);
  const times = [];
  const T = (name, f) => { const t0 = performance.now(); const r = f(); times.push(`${name} ${(performance.now() - t0).toFixed(0)}ms`); return r; };
  const rm = T('room', () => roomChunk(300, { tileY: 190, floorY: 260 }));
  const fl = T('floor', () => floorChunk(40));
  for (let x = 10; x < 470; x += ROOM_CHUNK) { if (rm?.canvas) g.drawImage(rm.canvas, x, 10); if (fl?.canvas) g.drawImage(fl.canvas, x, 10 + 258); }
  const wv = T('view', () => windowView(220, 150));
  if (wv?.canvas) g.drawImage(wv.canvas, 500, 10);
  if (wv?.glow) { g.globalCompositeOperation = 'lighter'; g.drawImage(wv.glow, 500, 10); g.globalCompositeOperation = 'source-over'; }
  if (wv?.sun) { const [sx, sy] = wv.project(...wv.sun); drawRays(g, 500 + sx, 10 + sy, 160, 0, 0.25, 16); }
  const wf = T('frame', () => windowFrame(220, 150));
  if (wf?.canvas) g.drawImage(wf.canvas, 740, 10);
  const b = T('bench', () => bench(200));
  if (b?.canvas) g.drawImage(b.canvas, 500, 220);
  ['#35c8ff', '#ff74b4', '#6fd23f'].forEach((c, i) => { const f = T('flask' + i, () => flask(i === 2 ? 'lg' : 'md', 0.3 + i * 0.3, c)); if (f?.canvas) g.drawImage(f.canvas, 720 + i * 40, 220); });
  const p = T('pipe', () => pipe(120, 60));
  if (p?.canvas) g.drawImage(p.canvas, 860, 220);
  const sh = T('shelf', () => shelf(180));
  if (sh?.canvas) g.drawImage(sh.canvas, 500, 300);
  const ck = T('clock', () => clock());
  if (ck?.canvas) g.drawImage(ck.canvas, 700, 300);
  const pl = T('plant', () => plant());
  if (pl?.canvas) g.drawImage(pl.canvas, 760, 300);
  [[110, -60, 3], [90, 200, 5], [100, -20, 7]].forEach(([l, a, s], i) => { const sp = T('sprig' + i, () => sprig(l, a, s)); if (sp?.canvas) g.drawImage(sp.canvas, 10 + i * 160, 330); });
  const sea = T('sea', () => seaScene(300, 180));
  if (sea?.canvas) g.drawImage(sea.canvas, 640, 360);
  times.forEach((s, i) => drawText(g, s, 520, 380 + i * 9, { font: 'small', color: '#ffffff' }));
  window.__ready = true;
}
