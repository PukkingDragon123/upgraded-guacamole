// Dev preview [grouper23]: Bubbles, the floating wind-up talking toy grouper guide (src/gfx/grouper.js).
//   node tools/build.mjs --dev grouper -> dist/dev/grouper.html
//   ?mode=all (default: every animation) | talk (jaw levels + a talking close-up) | close (big side + front portrait)
//   | moods (every face mood) | guide (the GrouperGuide floating to targets and pointing) | portrait (npc portraits)
//   &t=<s> freezes the clock, &bg=dark. window.__bench = sheet build ms (idle, point), window.__ready when warmed.
import { ctxOf } from '../core/canvas.js';
import { drawGrouper, GrouperGuide, GROUPER_ANIMS, warmGrouper, drawPointStream } from '../gfx/grouper.js';
import { drawNPC } from '../gfx/npcs.js';
import { voxStats } from '../fish/voxelize.js';

export function run(params) {
  const W = Number(params.get('w') || 960), H = Number(params.get('h') || 540);
  const cv = document.getElementById('screen');
  cv.width = W; cv.height = H;
  cv.style.width = '100vw'; cv.style.height = '100vh';
  cv.style.imageRendering = 'pixelated';
  const g = ctxOf(cv);
  const mode = params.get('mode') || 'all';
  const freeze = params.has('t') ? Number(params.get('t')) : null;
  const dark = params.get('bg') === 'dark';
  const anims = Object.keys(GROUPER_ANIMS);
  const t0 = performance.now();
  warmGrouper(56, ['idle']);
  const tIdle = performance.now() - t0;
  const t1 = performance.now();
  const v0 = voxStats().ms;
  warmGrouper(56, ['point']);
  window.__bench = { idle: Math.round(tIdle), point: Math.round(performance.now() - t1), voxMs: Math.round(voxStats().ms - v0) };
  const guide = new GrouperGuide({ x: 200, y: 260, size: 48 });
  const targets = [[120, 460], [840, 440], [480, 90], [860, 120], [480, 300], [90, 150]];
  let ti = 0, tT = 0, warmed = 0;
  let last = performance.now();
  const label = (s, x, y) => { g.font = '10px monospace'; g.fillStyle = dark ? '#cfe8ff' : '#0b2a4a'; g.textAlign = 'center'; g.fillText(s, x, y); };
  const frame = (now) => {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const t = freeze ?? now / 1000;
    g.setTransform(1, 0, 0, 1, 0, 0);
    const bg = g.createLinearGradient(0, 0, 0, H);
    if (dark) { bg.addColorStop(0, '#0a2a4a'); bg.addColorStop(1, '#04101e'); } else { bg.addColorStop(0, '#2a8ef0'); bg.addColorStop(0.6, '#9adcff'); bg.addColorStop(1, '#e8fbff'); }
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    if (warmed < anims.length) { warmGrouper(56, [anims[warmed]]); warmed++; if (warmed === anims.length) window.__ready = true; }
    if (mode === 'all') {
      const moods = { idle: 'happy', swim: 'happy', wiggle: 'excited', wave: 'happy', point: 'happy', flop: 'sad', spin: 'excited', worried: 'worried', clap: 'excited', think: 'think', blow: 'happy', cheer: 'excited', sad: 'sad', sleep: 'sleep', surprised: 'surprised', scared: 'scared', look: 'happy', laugh: 'happy' };
      const cols = 6;
      anims.forEach((a, i) => {
        const x = 80 + (i % cols) * 160, y = 95 + Math.floor(i / cols) * 168;
        const A = drawGrouper(g, { x, y, t: t + i * 0.37, size: 56, anim: a, mood: moods[a] || 'happy', talk: a === 'idle' ? 0.5 + 0.5 * Math.sin(t * 16) : 0, point: [x + 90, y - 70], id: 'a' + i, phase: freeze != null ? (i * 0.13) % 1 : undefined });
        if (a === 'point') drawPointStream(g, A.hand, [x + 90, y - 70], t, 1.2);
        label(a, x, y + 72);
      });
    } else if (mode === 'talk') {
      [0, 0.45, 1].forEach((tk, i) => { drawGrouper(g, { x: 170 + i * 300, y: 150, t: 0.4, size: 96, anim: 'idle', mood: 'happy', talk: tk, id: 'j' + i, hover: false, phase: 0.1 }); label('talk ' + tk, 170 + i * 300, 270); });
      [0, 0.45, 1].forEach((tk, i) => { drawGrouper(g, { x: 170 + i * 300, y: 400, t: 0.4, size: 96, anim: 'idle', mood: 'excited', talk: tk, id: 'jf' + i, hover: false, phase: 0.1, view: 'front' }); label('front talk ' + tk, 170 + i * 300, 525); });
    } else if (mode === 'close') {
      const tk = freeze != null ? 0.8 : 0.5 + 0.5 * Math.sin(t * 14);
      drawGrouper(g, { x: 300, y: 270, t, size: 128, k: 1.4, anim: params.get('a') || 'idle', mood: params.get('m') || 'happy', talk: params.has('talk') ? tk : 0, id: 'big', lookAt: [700, 200] });
      drawGrouper(g, { x: 760, y: 300, t, size: 128, anim: 'idle', mood: 'excited', talk: tk, id: 'bigf', view: 'front', facing: -1 });
    } else if (mode === 'moods') {
      const moods = ['happy', 'joy', 'excited', 'love', 'surprised', 'worried', 'sad', 'cry', 'angry', 'determined', 'smug', 'think', 'sleepy', 'sleep', 'dizzy', 'scared'];
      moods.forEach((m, i) => { const x = 70 + (i % 8) * 118, y = 110 + Math.floor(i / 8) * 250; drawGrouper(g, { x, y, t, size: 64, anim: 'idle', mood: m, id: 'm' + i, view: i % 2 ? 'front' : 'side', lookAt: [x + 60, y + 20] }); label(m, x, y + 90); });
    } else if (mode === 'portrait') {
      [20, 30, 44].forEach((r, i) => {
        const cx = 160 + i * 260, cy = 200;
        g.fillStyle = '#bfefff'; g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
        g.save(); g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.clip();
        drawNPC(g, 'seal', { portrait: true, x: cx, y: cy, r, t, talk: 0.5 + 0.5 * Math.sin(t * 15), mood: 'happy', id: 'p' + i });
        g.restore();
      });
      drawNPC(g, 'seal', { x: 480, y: 470, t, scale: 1.35, pose: 'idle', talk: 0.5 + 0.5 * Math.sin(t * 22), mood: 'happy', id: 'shop' });
      g.fillStyle = '#8a5a30'; g.fillRect(380, 470, 200, 12);
    } else if (mode === 'guide') {
      tT -= dt;
      if (tT <= 0) { ti = (ti + 1) % targets.length; tT = 3.2; }
      const p = targets[ti];
      guide.goTo(p[0] + (p[0] > 480 ? -90 : 90), p[1] - 30);
      guide.pointAt(p);
      guide.update(dt, { W, H });
      g.fillStyle = '#ffdd55'; g.fillRect(p[0] - 6, p[1] - 6, 12, 12);
      guide.draw(g, { t, talk: Math.sin(t * 2) > 0 ? 0.5 + 0.5 * Math.sin(t * 18) : 0, mood: 'happy' });
      window.GUIDE = guide;
    }
  };
  requestAnimationFrame(frame);
}
