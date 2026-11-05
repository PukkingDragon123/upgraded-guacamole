// Dev preview for the Intro agent (dist/dev/intro.html): the 3D opening on its own (mock game).
//   ?t=<s> jumps to a time, &speed=<x>, &freeze=1 holds the frame, &w=&h= logical size, &auto=<i> auto-picks
//   choice i, &lowpower=1. window.INTRO is the opening; window.__prof[second] = worst frame ms; __done at the end.
//   ?gallery=seal  Bubbles the seal guide: every animation and mood (low-poly sprite sheets), big portrait
//   ?gallery=swim  the seal swimming around the screen to targets and pointing at them (SealGuide physics)
//   ?gallery=dialogue  the dialogue panel and bubble with choices
import { ctxOf } from '../core/canvas.js';
import { Input } from '../core/input.js';
import { registerUiIcons } from '../gfx/uiicons.js';
import { DEFAULT_CHARACTER } from '../gfx/character.js';
import { drawNPC } from '../gfx/npcs.js';
import { drawSeal, SealGuide, SEAL_ANIMS, warmSeal, drawPointStream } from '../gfx/seal.js';
import { drawText3D } from '../gfx/text3d.js';
import { loadAlagard } from '../gfx/alagard.js';
import { Dialogue, drawAlagard } from '../game/dialogue.js';

export async function run(params) {
  const W = Number(params.get('w') || 960), H = Number(params.get('h') || 540);
  const cv = document.getElementById('screen');
  cv.width = W; cv.height = H;
  cv.style.width = '100vw'; cv.style.height = '100vh';
  cv.style.imageRendering = 'pixelated';
  const g = ctxOf(cv);
  registerUiIcons();
  await loadAlagard();
  const toLogical = (cx, cy) => { const r = cv.getBoundingClientRect(); return [((cx - r.left) / r.width) * W, ((cy - r.top) / r.height) * H]; };
  const input = new Input(cv, toLogical);
  if (params.get('gallery')) return gallery(params.get('gallery'), g, W, H, input);
  const { Intro3D } = await import('../game/intro3d.js');
  const { Dialogue: D } = await import('../game/dialogue.js');
  if (params.has('auto')) D.auto = Number(params.get('auto'));
  const intro = new Intro3D({ W, H, input, look: { ...DEFAULT_CHARACTER }, boat: { tier: Number(params.get('boat') || 0) }, lowPower: params.has('lowpower'), onChoice: (k, v) => { (window.__choices ||= {})[k] = v; }, onDone: () => { window.__done = true; } });
  window.INTRO = intro;
  const speed = Number(params.get('speed') || 1);
  if (params.has('t')) intro.seek(Number(params.get('t')));
  const freeze = params.has('freeze');
  let last = performance.now();
  const frame = (now) => {
    requestAnimationFrame(frame);
    const dt = Math.max(0, Math.min(1 / 20, (now - last) / 1000)) * speed;
    last = now;
    input.update(dt);
    const t0 = performance.now();
    if (!freeze) intro.update(dt);
    else intro.update(0);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#0b3a5c';
    g.fillRect(0, 0, W, H);
    intro.draw(g);
    const ms = performance.now() - t0;
    if (intro.ready) { const k = Math.floor(intro.t); (window.__prof ||= {})[k] = Math.max(window.__prof[k] || 0, Math.round(ms)); }
    input.endFrame();
  };
  requestAnimationFrame(frame);
}

function gallery(kind, g, W, H, input) {
  const d = new Dialogue({ name: 'Bubbles', voice: 'fish', portrait: (ctx, cx, cy, r, dd) => drawNPC(ctx, 'seal', { portrait: true, x: cx, y: cy, r, t: performance.now() / 1000, talk: dd.talk, mood: dd.mood, id: 'portrait' }), vars: { name: 'Finn' } });
  d.say('Whoa! A new angler in the (OS)cean! I\'m Bubbles, the fluffiest guide in the sea.', { hold: 99 });
  const guide = new SealGuide({ x: 200, y: 200, size: 44 });
  const targets = [[80, 470], [880, 470], [480, 60], [900, 120], [480, 300], [60, 140]];
  let ti = 0, tT = 0;
  window.SEAL = guide;
  window.__sealApi = { warmSeal, drawSeal };
  const d2 = new Dialogue({ name: '' });
  d2.say('Circle the mouse to reel!', { choices: [{ text: 'Got it' }, { text: 'Tell me more' }] });
  let last = performance.now();
  const frame = (now) => {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const t = now / 1000;
    input.update(dt);
    g.setTransform(1, 0, 0, 1, 0, 0);
    const bg = g.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#2a8ef0'); bg.addColorStop(0.6, '#9adcff'); bg.addColorStop(1, '#e8fbff');
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    if (kind === 'seal') {
      const anims = ['idle', 'swim', 'wiggle', 'wave', 'point', 'flop', 'spin', 'worried', 'clap', 'think', 'blow', 'idle'];
      const moods = ['happy', 'happy', 'excited', 'happy', 'happy', 'excited', 'love', 'worried', 'excited', 'think', 'happy', 'sad'];
      if (!window.__warm) { window.__warm = true; warmSeal(44, anims); }
      anims.forEach((a, i) => {
        const x = 90 + (i % 4) * 190, y = 90 + Math.floor(i / 4) * 150;
        const pt = [x + 120 * Math.cos(t * 0.7), y + 90 * Math.sin(t * 0.7)];
        drawSeal(g, { x, y, t: t + i * 0.3, size: 44, anim: a, mood: moods[i], talk: i === 0 ? 0.5 + 0.5 * Math.sin(t * 18) : 0, facing: i % 2 ? -1 : 1, point: pt, ride: i === 0 || i === 4 ? 1 : 0, noseBubble: i === 8 ? 1 : 0, id: 'g' + i });
        if (a === 'point') { g.fillStyle = '#ff3a6a'; g.fillRect(Math.round(pt[0]) - 2, Math.round(pt[1]) - 2, 4, 4); }
        g.fillStyle = '#0b3a5c'; g.font = '10px monospace'; g.fillText(a + ' / ' + moods[i], x - 50, y + 62);
      });
      drawSeal(g, { x: 800, y: 420, t, size: 80, anim: 'idle', mood: 'happy', talk: 0.5 + 0.5 * Math.sin(t * 16), id: 'big', ride: 1, view: 'front' });
    } else if (kind === 'font') {
      [16, 20, 24, 28, 32].forEach((sz, i) => drawAlagard(g, 'Now drop your hook in the water! ' + sz, 20, 20 + i * 50, { size: sz, color: '#13304e', shadow: 'rgba(255,255,255,0.9)' }));
    } else if (kind === 'one') {
      const q = new URLSearchParams(location.search);
      const e = (Number(q.get('e') || 60) * Math.PI) / 180, x = 380, y = 300;
      const pt = [x + Math.cos(e) * 300, y - Math.sin(e) * 300];
      const A = drawSeal(g, { x, y, t, size: Number(q.get('s') || 140), anim: q.get('a') || 'point', point: pt, mood: 'happy', id: 'one', lookAt: pt, view: q.get('v') || 'side' });
      drawPointStream(g, A.hand, pt, t, 2);
      g.fillStyle = '#ff3a6a'; g.fillRect(Math.round(pt[0]) - 4, Math.round(pt[1]) - 4, 8, 8);
      g.fillStyle = '#00ff00'; g.fillRect(Math.round(A.hand[0]) - 2, Math.round(A.hand[1]) - 2, 4, 4);
    } else if (kind === 'point') {
      for (let i = 0; i < 7; i++) {
        const x = 110 + (i % 4) * 230, y = 130 + Math.floor(i / 4) * 260;
        const e = ((i - 3) * Math.PI) / 6;
        const pt = [x + Math.cos(e) * 110 * (i % 2 ? -1 : 1), y - Math.sin(e) * 110];
        const A = drawSeal(g, { x, y, t, size: 64, anim: 'point', point: pt, facing: i % 2 ? -1 : 1, mood: 'happy', id: 'p' + i, lookAt: pt });
        drawPointStream(g, A.hand, pt, t, 1.4);
        g.fillStyle = '#ff3a6a'; g.fillRect(Math.round(pt[0]) - 3, Math.round(pt[1]) - 3, 6, 6);
      }
    } else if (kind === 'swim') {
      tT += dt;
      if (tT > 2.6) { tT = 0; ti = (ti + 1) % targets.length; }
      const tg = targets[ti];
      const spot = [tg[0] + (tg[0] < W / 2 ? 90 : -90), tg[1] + (tg[1] < H / 2 ? 70 : -70)];
      guide.goTo(spot[0], spot[1]).pointAt(tg);
      guide.update(dt, { W, H, cursor: [input.x, input.y] });
      for (const p of targets) { g.strokeStyle = p === tg ? '#ff3a6a' : '#ffffff'; g.lineWidth = 2; g.strokeRect(p[0] - 14, p[1] - 14, 28, 28); }
      guide.draw(g, { t, mood: 'happy', talk: 0 });
    } else {
      d.update(dt, input, { clickAnywhere: true });
      d2.update(dt, input, {});
      d.drawPanel(g, { x: 60, y: H - 130, w: W - 120, h: 100, t });
      const A = drawSeal(g, { x: 200, y: 300, t, size: 44, anim: 'point', point: [400, 360], mood: 'excited', talk: d2.talk, ride: 1 });
      d2.drawBubble(g, A.top[0], A.top[1] - 4, { maxW: 300, t, W, H });
    }
    input.endFrame();
  };
  requestAnimationFrame(frame);
}
