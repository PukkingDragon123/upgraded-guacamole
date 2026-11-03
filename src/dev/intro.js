// Dev preview for the Intro agent (dist/dev/intro.html): the 3D opening on its own (mock game).
//   ?t=<s> jumps to a time, &speed=<x>, &freeze=1 holds the frame, &w=&h= logical size.
//   window.INTRO is the opening; window.__prof[second] = worst frame ms; window.__done once it ends.
import { ctxOf } from '../core/canvas.js';
import { Input } from '../core/input.js';
import { registerUiIcons } from '../gfx/uiicons.js';
import { DEFAULT_CHARACTER } from '../gfx/character.js';

export async function run(params) {
  const W = Number(params.get('w') || 960), H = Number(params.get('h') || 540);
  const cv = document.getElementById('screen');
  cv.width = W; cv.height = H;
  cv.style.width = '100vw'; cv.style.height = '100vh';
  cv.style.imageRendering = 'pixelated';
  const g = ctxOf(cv);
  registerUiIcons();
  const { Intro3D } = await import('../game/intro3d.js');
  const toLogical = (cx, cy) => { const r = cv.getBoundingClientRect(); return [((cx - r.left) / r.width) * W, ((cy - r.top) / r.height) * H]; };
  const input = new Input(cv, toLogical);
  const intro = new Intro3D({ W, H, input, look: { ...DEFAULT_CHARACTER }, boat: { tier: Number(params.get('boat') || 0) }, onDone: () => { window.__done = true; } });
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
    else if (!intro.cam) intro.update(0.0001);
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
