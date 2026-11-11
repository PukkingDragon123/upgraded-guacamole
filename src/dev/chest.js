// [chest16] Dev preview of the chest-cracking scene: dist/dev/chest.html
//   ?view=poses (&tool=hammer&scale=1.6)   every chest pose frame of one tool on a grid
//   ?view=models (&s=2.5)                   the four chest models (+ damage steps &dmg=N)
//   ?view=panel&tier=crate|iron|golden|orb (default) the real ChestPanel on a stub game, 1920x1080 hi-res layer
//        &look=json  &seen=1 (shows hold-to-skip)  &n=3 (chests in the satchel)
import { ctxOf, makeCanvas } from '../core/canvas.js';
import { hiCtx } from '../gfx/hires.js';
import { drawText } from '../gfx/font.js';
import { drawCharacter, DEFAULT_CHARACTER, setCharacterBudget, characterStats } from '../gfx/character.js';
import { CHEST_POSES, POSE_N } from '../gfx/chesttools.js';
import { Input } from '../core/input.js';
import { audio } from '../core/audio.js';
import { Particles } from '../gfx/particles.js';
import { registerUiIcons, getUiIcon, CURSOR_HOTSPOT } from '../gfx/uiicons.js';
import { defaultState } from '../game/state.js';
import { UI } from '../ui/ui.js';
import { ChestPanel } from '../ui/chest.js';
import { chestModel, damageChest, ChestSprite } from '../gfx/chestvox.js';

function lookOf(params) { try { if (params.get('look')) return JSON.parse(params.get('look')); } catch { /* ignore */ } return DEFAULT_CHARACTER; }

function runPoses(params, cv) {
  const W = 960, H = 540;
  cv.width = W; cv.height = H; cv.style.width = W * 2 + 'px'; cv.style.height = H * 2 + 'px';
  const g = ctxOf(cv);
  setCharacterBudget(1e6);
  const tool = params.get('tool') || 'hammer', sc = Number(params.get('scale') || 1.3), look = lookOf(params);
  const poses = params.get('poses') ? params.get('poses').split(',') : CHEST_POSES(tool);
  let t = 0, last = performance.now();
  const frame = (now) => {
    requestAnimationFrame(frame);
    t += Math.min(0.05, (now - last) / 1000); last = now;
    g.fillStyle = '#5aa8d0'; g.fillRect(0, 0, W, H);
    let y = 120;
    for (const pose of poses) {
      const [n, dur] = POSE_N[pose] || [8, pose.includes('walk') ? 0.56 : 1.5];
      drawText(g, pose, 8, y - 100, { color: '#ffffff', shadow: '#000' });
      for (let i = 0; i < n; i++) {
        const x = 70 + i * 110;
        const tt = ((i + 0.5) / n) * dur;
        const a = drawCharacter(g, x, y, { pose, t: tt, facing: 1, scale: sc, look, rod: false, trail: false, id: 'dv' + pose + i });
        g.fillStyle = '#ff2a6a'; g.fillRect(a.rodTip[0] - 1, a.rodTip[1] - 1, 3, 3);
      }
      y += 130;
      if (y > H + 100) break;
    }
    window.__ready = true;
  };
  requestAnimationFrame(frame);
}

function runModels(params, cv) {
  const W = 960, H = 540;
  cv.width = W * 2; cv.height = H * 2; cv.style.width = W * 2 + 'px'; cv.style.height = H * 2 + 'px';
  const g = hiCtx(cv, 2);
  const s = Number(params.get('s') || 2.5), dmg = Number(params.get('dmg') || 0);
  const sprites = ['crate', 'iron', 'golden', 'orb'].map((tier) => {
    const cm = chestModel(tier);
    for (let i = 0; i < dmg; i++) damageChest(cm, i, 1.5);
    return new ChestSprite(cm, s);
  });
  let t = 0, last = performance.now();
  const frame = (now) => {
    requestAnimationFrame(frame);
    t += Math.min(0.05, (now - last) / 1000); last = now;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#4a8ab8'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#2a5a7a'; g.fillRect(0, 380, W, 160);
    sprites.forEach((sp, i) => sp.draw(g, 130 + i * 230, 380, { t }));
    window.__ready = true;
  };
  requestAnimationFrame(frame);
}

function runPanel(params, cv) {
  const W = 960, H = 540;
  cv.width = W * 2; cv.height = H * 2; cv.style.width = W * 2 + 'px'; cv.style.height = H * 2 + 'px';
  const ctx = hiCtx(cv, 2);
  registerUiIcons();
  const st = defaultState();
  st.character = { ...lookOf(params) };
  st.coins = 1200;
  if (params.has('seen')) st.chestStats = { crate: 2, iron: 2, golden: 2, orb: 2 };
  const tier = params.get('tier') || 'crate';
  const n = Number(params.get('n') || 1);
  st.inventory = st.inventory || { items: {}, packages: [] };
  st.inventory.packages = [];
  for (let i = 0; i < n; i++) st.inventory.packages.push({ uid: 'dev' + i, tier, from: null, at: 1 });
  const listeners = {};
  const g = {
    params, canvas: cv, screen: { W, H, scale: 2 }, state: st, audio, particles: new Particles(900), time: 0, stats: {},
    on(ev, fn) { (listeners[ev] ||= []).push(fn); }, emit(ev, d) { for (const f of listeners[ev] || []) f(d); },
    save() {}, toast(text, icon) { g.ui.toast(text, icon); }, addCoins(n2) { st.coins += n2; },
  };
  const toLogical = (cx, cy) => { const r = cv.getBoundingClientRect(); return [((cx - r.left) / r.width) * W, ((cy - r.top) / r.height) * H]; };
  g.input = new Input(cv, toLogical);
  cv.addEventListener('pointerdown', () => audio.unlock?.(), { once: true });
  g.ui = new UI(g);
  g.ui.register(new ChestPanel());
  window.FISHTOP = g;
  g.ui.open('crate', { uid: 'dev0' });
  if (params.has('auto')) g.ui.panels.crate.autoplay = true;
  let last = performance.now();
  const bg = makeCanvas(W, H);
  {
    const b = ctxOf(bg);
    const grd = b.createLinearGradient(0, 0, 0, H);
    grd.addColorStop(0, '#7fd0ff'); grd.addColorStop(0.55, '#3a9ad8'); grd.addColorStop(0.56, '#2a86c8'); grd.addColorStop(1, '#0e4a86');
    b.fillStyle = grd; b.fillRect(0, 0, W, H);
    b.fillStyle = '#5ac84a'; b.fillRect(0, H * 0.5, W, 18);
  }
  const frame = (now) => {
    requestAnimationFrame(frame);
    const dt = Math.max(0, Math.min(0.05, (now - last) / 1000)) * Number(params.get('slow') || 1);
    last = now;
    g.time += dt;
    try {
      g.input.update?.(dt);
      g.ui.update?.(dt);
      g.particles.update(dt);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(bg, 0, 0);
      g.ui.tip = null;
      g.ui.drawPanels(ctx, dt);
      g.particles.draw(ctx, 'ui', g.time);
      g.ui.drawToasts?.(ctx);
      g.ui.drawTip?.(ctx);
      const cs = characterStats();
      if (params.has('stats')) drawText(ctx, `frames ${cs.frames} built ${cs.built} (${cs.avgMs} ms) fb ${cs.fallbacks}`, 6, H - 10, { font: 'small', color: '#ffffff', shadow: '#000000' });
      const cur = getUiIcon('cursor'), hs = CURSOR_HOTSPOT.cursor;
      if (g.input.inside && cur) ctx.drawImage(cur, Math.round(g.input.x) - hs[0], Math.round(g.input.y) - hs[1]);
    } catch (e) { console.error(e); }
    g.input.endFrame();
    window.__ready = true;
  };
  requestAnimationFrame(frame);
}

export function run(params) {
  const cv = document.getElementById('screen');
  const view = params.get('view') || 'panel';
  if (view === 'poses') return runPoses(params, cv);
  if (view === 'models') return runModels(params, cv);
  if (view === 'seal') return runSeal(cv);
  return runPanel(params, cv);
}

// ?view=seal : Bubbles at a few sizes / views / moods
import { drawSeal as _drawSeal } from '../gfx/seal.js';
export function runSeal(cv) {
  const W = 960, H = 540;
  cv.width = W * 2; cv.height = H * 2; cv.style.width = W * 2 + 'px'; cv.style.height = H * 2 + 'px';
  const g = hiCtx(cv, 2);
  let t = 0;
  const frame = () => {
    requestAnimationFrame(frame);
    t += 1 / 60;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#2a5a8a'; g.fillRect(0, 0, W, H);
    const rows = [['side', -1], ['side', 1], ['front', -1]];
    const moods = ['happy', 'excited', 'laugh', 'love', 'surprised', 'worried'];
    const anims = ['idle', 'clap', 'wiggle', 'wiggle', 'idle', 'worried'];
    rows.forEach(([view, facing], r) => moods.forEach((mood, i) => {
      _drawSeal(g, { x: 90 + i * 150, y: 160 + r * 170, base: 'bottom', t, size: 52, anim: anims[i], mood, facing, view, lookAt: [90 + i * 150 - 100, 100], id: 'sv' + r + i });
    }));
    window.__ready = true;
  };
  requestAnimationFrame(frame);
}
