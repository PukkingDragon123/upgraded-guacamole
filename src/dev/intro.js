// Dev preview for the Intro agent (dist/dev/intro.html): the 3D opening on its own (mock game).
//   ?t=<s> jumps to a time, &speed=<x>, &freeze=1 holds the frame, &w=&h= logical size, &auto=<i> auto-picks
//   choice i, &lowpower=1. window.INTRO is the opening; window.__prof[second] = worst frame ms; __done at the end.
//   ?gallery=clip  Clip's poses and moods, and 3D Alagard text sprites (2D renderers)
//   ?gallery=dialogue  the dialogue panel and bubble with choices
import { ctxOf } from '../core/canvas.js';
import { Input } from '../core/input.js';
import { registerUiIcons } from '../gfx/uiicons.js';
import { DEFAULT_CHARACTER } from '../gfx/character.js';
import { drawNPC } from '../gfx/npcs.js';
import { drawText3D } from '../gfx/text3d.js';
import { loadAlagard } from '../gfx/alagard.js';
import { Dialogue } from '../game/dialogue.js';

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
  const d = new Dialogue({ name: 'Clip', portrait: (ctx, cx, cy, r, dd) => drawNPC(ctx, 'clip', { x: cx, y: cy + r * 1.25, t: performance.now() / 1000, scale: r / 34, talk: dd.talk, mood: dd.mood, bubble: false, id: 'portrait' }), vars: { name: 'Finn' } });
  d.say('Whoa! A new angler in the (OS)cean! I\'m Clip, I hold things together.', { hold: 99 });
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
    if (kind === 'clip') {
      const poses = ['idle', 'talk', 'wave', 'point', 'bend', 'think', 'cheer', 'laugh', 'sad', 'spin'];
      const moods = ['happy', 'excited', 'surprised', 'smug', 'sad', 'love', 'angry', 'think', 'happy', 'happy'];
      poses.forEach((p, i) => {
        const x = 60 + (i % 5) * 180, y = 230 + Math.floor(i / 5) * 250;
        drawNPC(g, 'clip', { x, y, t: t + i * 0.3, scale: 1.6, pose: p, mood: moods[i], talk: p === 'talk' ? 0.5 + 0.5 * Math.sin(t * 18) : 0, facing: i % 2 ? -1 : 1, id: 'g' + i });
      });
      drawNPC(g, 'clip', { x: 900, y: 520, t, scale: 4, pose: 'talk', mood: 'happy', talk: 0.5 + 0.5 * Math.sin(t * 16), id: 'big' });
      drawText3D(g, 'HELLO!', 620, 40, { t, size: 16, px: 2, depth: 5, palette: 'aqua', scale: 1.5 });
      drawText3D(g, 'FISH ON!', 820, 40, { t, size: 16, px: 1, depth: 4, palette: 'gold', scale: 2 });
    } else {
      d.update(dt, input, { clickAnywhere: true });
      d2.update(dt, input, {});
      d.drawPanel(g, { x: 60, y: H - 110, w: W - 120, h: 84, t });
      drawNPC(g, 'clip', { x: 200, y: 300, t, scale: 1.4, pose: 'point', mood: 'excited', talk: d2.talk });
      d2.drawBubble(g, 230, 200, { maxW: 220, t, W, H });
    }
    input.endFrame();
  };
  requestAnimationFrame(frame);
}
