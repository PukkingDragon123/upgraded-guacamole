// [seal20] Dev preview of Bubbles, the fat voxel plush seal: node tools/build.mjs --dev seal -> dist/dev/seal.html
//   ?page=0 (default)  every animation (side view, mixed moods, talking, pointing at a target) on a 1920x1080
//                      hi-res canvas, plus a big front portrait and a size ladder (16 .. 112 px per unit)
//   ?page=1            moods / expressions (side + front), the eyes following a target circling around, portraits
//   ?page=2            in-game style backdrops (ocean, dark panel, light panel) with the guide at its real sizes
//   ?page=3            close-up: a big side view and a big front view (art check)
//   &t=SECONDS freeze time   &bench=1 window.__bench (ms per frame, sheet build ms)
import { hiCtx } from '../gfx/hires.js';
import { drawText } from '../gfx/font.js';
import { drawSeal, SEAL_ANIMS, warmSeal, SealGuide } from '../gfx/seal.js';

export function run(params) {
  const cv = document.getElementById('screen');
  const W = 960, H = 540;
  cv.width = W * 2; cv.height = H * 2; cv.style.width = W * 2 + 'px'; cv.style.height = H * 2 + 'px';
  const g = hiCtx(cv, 2);
  const page = Number(params.get('page') || 0);
  if (params.get('yaw') != null) { globalThis.__SEAL_YAW = Number(params.get('yaw')); globalThis.__SEAL_TILT = Number(params.get('tilt') || 0); }
  const tFix = params.get('t') != null ? Number(params.get('t')) : null;
  const t0 = performance.now();
  const anims = Object.keys(SEAL_ANIMS);
  const label = (s, x, y, c = '#ffffff') => drawText(g, s, x, y, { font: 'small', color: c, align: 'center', outline: '#0a2a4a' });
  const guide = new SealGuide({ x: 700, y: 300, size: 44, id: 'dev-guide' });
  let frames = 0, msSum = 0;
  const frame = () => {
    requestAnimationFrame(frame);
    const t = tFix ?? (performance.now() - t0) / 1000;
    const tA = performance.now();
    g.setTransform(1, 0, 0, 1, 0, 0);
    const bg = g.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#5cc8ff'); bg.addColorStop(0.55, '#2a8ad8'); bg.addColorStop(1, '#0e4f96');
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    if (page === 0) {
      const moods = { idle: 'happy', swim: 'happy', wiggle: 'excited', wave: 'happy', point: 'happy', flop: 'surprised', spin: 'excited', worried: 'worried', clap: 'excited', think: 'think', blow: 'happy', cheer: 'excited', sad: 'sad', sleep: 'sleepy' };
      anims.forEach((a, i) => {
        const cx = 70 + (i % 7) * 118, cy = 120 + Math.floor(i / 7) * 150;
        const A = drawSeal(g, { x: cx, y: cy, base: 'bottom', t: t + i * 0.37, size: 40, anim: a, mood: moods[a], talk: a === 'idle' ? 0.5 + 0.5 * Math.sin(t * 18) : 0, point: [cx + 70, cy - 70], id: 'dv' + i });
        if (a === 'point' && A) { g.fillStyle = '#ffe14a'; g.fillRect(cx + 68, cy - 72, 4, 4); }
        label(a, cx, cy + 10);
      });
      // a size ladder
      [16, 20, 28, 36, 48, 64].forEach((s, i) => { const x = 60 + i * 70 + s * 0.6; drawSeal(g, { x, y: 500, base: 'bottom', t, size: s, anim: 'idle', mood: 'happy', id: 'sz' + i }); label(String(s), x, 512); });
      drawSeal(g, { x: 780, y: 490, base: 'bottom', t, size: 112, anim: 'idle', view: 'front', mood: 'happy', talk: 0.5 + 0.5 * Math.sin(t * 9), id: 'big', lookAt: [780 + Math.cos(t * 0.7) * 300, 300 + Math.sin(t * 0.9) * 150] });
    } else if (page === 1) {
      const moods = ['happy', 'excited', 'laugh', 'love', 'surprised', 'worried', 'sad', 'angry', 'sleepy', 'think'];
      moods.forEach((m, i) => {
        const cx = 60 + i * 92;
        drawSeal(g, { x: cx, y: 130, base: 'bottom', t, size: 36, anim: 'idle', mood: m, id: 'ms' + i });
        drawSeal(g, { x: cx, y: 250, base: 'bottom', t, size: 36, anim: 'idle', mood: m, view: 'front', facing: -1, id: 'mf' + i });
        label(m, cx, 262);
      });
      // the head follows a target circling around it
      const tx = 480 + Math.cos(t * 0.8) * 260, ty = 400 + Math.sin(t * 0.8) * 110;
      g.fillStyle = '#ffe14a'; g.fillRect(Math.round(tx) - 3, Math.round(ty) - 3, 6, 6);
      drawSeal(g, { x: 480, y: 470, base: 'bottom', t, size: 72, anim: 'idle', mood: 'happy', lookAt: [tx, ty], id: 'look' });
      // 8 fixed look directions
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2, x = 120 + (i % 4) * 60, y = 360 + Math.floor(i / 4) * 90;
        drawSeal(g, { x, y, base: 'bottom', t, size: 26, anim: 'idle', lookAt: [x + Math.cos(a) * 100, y - 18 + Math.sin(a) * 100], id: 'ld' + i });
      }
      // portraits
      [24, 34].forEach((r, i) => {
        const cx = 820 + i * 80, cy = 400;
        g.save();
        g.fillStyle = '#d8f4ff'; g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
        g.beginPath(); g.arc(cx, cy, r - 1, 0, Math.PI * 2); g.clip();
        drawSeal(g, { x: cx, y: cy + r * 0.22, anchor: 'head', t, size: r * 1.3, view: 'front', anim: 'idle', mood: 'happy', talk: 0.5 + 0.5 * Math.sin(t * 12), lookAt: [cx + r * 3, cy + r], id: 'pt' + i });
        g.restore();
      });
    } else if (page === 3) {
      drawSeal(g, { x: 260, y: 480, base: 'bottom', t, size: 120, anim: params.get('anim') || 'idle', mood: 'happy', id: 'cu0', point: [520, 120] });
      drawSeal(g, { x: 700, y: 480, base: 'bottom', t, size: 120, anim: params.get('anim') || 'idle', view: 'front', mood: 'happy', id: 'cu1' });
    } else {
      // game-like backdrops and the swimming guide
      g.fillStyle = '#0f2a4a'; g.fillRect(40, 40, 260, 200);
      g.fillStyle = '#eaf8ff'; g.fillRect(340, 40, 260, 200);
      g.fillStyle = '#3a9a3a'; g.fillRect(640, 40, 280, 200);
      [[170, 200], [470, 200], [780, 200]].forEach(([x, y], i) => drawSeal(g, { x, y, base: 'bottom', t, size: 48, anim: ['idle', 'clap', 'wave'][i], mood: 'happy', id: 'bg' + i, ride: i === 0 ? 1 : 0 }));
      const gx = 480 + Math.cos(t * 0.5) * 380, gy = 390 + Math.sin(t * 0.9) * 90;
      guide.goTo(gx, gy);
      guide.pointAt(Math.sin(t * 0.3) > 0.3 ? [200, 300] : null);
      guide.update(1 / 60, { W, H });
      guide.draw(g, { t, mood: 'happy', talk: Math.sin(t * 2) > 0.5 ? 0.6 : 0 });
    }
    const ms = performance.now() - tA;
    frames++; if (frames > 30) msSum += ms;
    if (params.get('bench')) window.__bench = { ms: msSum / Math.max(1, frames - 30), frames, warm: warmMs };
    window.__ready = true;
  };
  let warmMs = 0;
  try { const tw = performance.now(); warmSeal(40, ['idle']); warmMs = performance.now() - tw; } catch (e) { console.error(e); }
  requestAnimationFrame(frame);
}
