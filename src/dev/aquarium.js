// Dev preview of the aquarium with a stub game.
//   dist/dev/aquarium.html?mode=full|window|mini&fish=12&coins=80&rain&night&skills=all&decor=castle,pirate_ship&t=0
//   mode: full (default) = full-screen view; window = floating window over a plain desktop; mini = mini tank.
//   rain: fish drop coins rapidly; coins=N pre-fills a pile; night: moonlight; skills=all unlocks every skill
//   (snail + crab, feeder, breeding); decor: extra decorations; ff=N fast-forwards N seconds before drawing.

import { ctxOf } from '../core/canvas.js';
import { drawText } from '../gfx/font.js';
import { registerUiIcons } from '../gfx/uiicons.js';
import { rng } from '../core/rng.js';
import { Aquarium } from '../aquarium/aquarium.js';
import { defaultState } from '../game/state.js';
import { computeStats, SKILLS } from '../game/skills.js';
import { SPECIES } from '../fish/species.js';
import { rollIndividual } from '../fish/traits.js';
import { coinSheet, SPIN_N } from '../aquarium/coins.js';
import { drawVoxelFish, setVoxelFishBudget, voxelFishStats } from '../gfx/voxelfish.js';
import { Fish } from '../fish/fish.js';

// Voxel fish gallery: ?voxfish=biome|all&yaw=0&spin (rotating) &scale=1
function voxFishGallery(g, W, H, params) {
  const which = params.get('voxfish') || 'shallows';
  const list = SPECIES.filter((s) => which === 'all' || s.biome === which || s.id === which);
  const spin = params.has('spin');
  const yaw0 = Number(params.get('yaw') || 0);
  const scale = Number(params.get('scale') || 1);
  setVoxelFishBudget(1e9);
  const items = list.map((sp, i) => {
    const f = new Fish(rollIndividual(sp, { mutationChance: 0, shinyChance: 0 }), sp, { W, H, floorAt: () => H, cursor: {}, fishes: [] }, { z: 0 });
    f.scale = sp.scale ?? 1;
    return { sp, f };
  });
  const cols = 6, cw = W / cols, ch = H / Math.ceil(items.length / cols);
  let t = 0;
  const t0 = performance.now();
  function frame() {
    t += 1 / 60;
    g.fillStyle = '#1f6a84'; g.fillRect(0, 0, W, H);
    items.forEach(({ sp, f }, i) => {
      const cx = (i % cols) * cw + cw / 2, cy = Math.floor(i / cols) * ch + ch / 2;
      const turn = spin ? Math.cos(t * 0.8 + i) : Math.cos(yaw0 * Math.PI / 180);
      Object.assign(f, { x: cx, y: cy, facing: turn >= 0 ? 1 : -1, turn, vz: 0, vx: 20, angle: 0, tailPhase: (t * 1.2 + i * 0.13) % 1, bob: 0, squash: 0, _vyaw: undefined });
      drawVoxelFish(g, f, { scale: f.scale * scale });
      drawText(g, sp.name, cx, cy + ch / 2 - 10, { font: 'small', align: 'center', color: '#fff', outline: '#0a1a28' });
    });
    if (!window.__vfReady) { window.__vfReady = Math.round(performance.now() - t0); console.log('voxfish build ms', window.__vfReady, JSON.stringify(voxelFishStats())); }
    if (spin) requestAnimationFrame(frame);
  }
  frame();
}

// Coin sprite sheets: every spin x flip frame for each denomination at a few on-screen sizes.
function coinDebug(g, W, H, zoomRow) {
  g.fillStyle = '#1f6a84';
  g.fillRect(0, 0, W, H);
  let y = 4;
  for (const r of [7, 5.5, 4]) {
    let x = 4;
    for (let d = 0; d < 3; d++) {
      const sh = coinSheet(d, r * (d === 0 ? 0.8 : d === 1 ? 0.9 : 1.1), true);
      g.drawImage(sh.canvas, 0, 0, sh.cell * SPIN_N, sh.cell * 4, x, y, sh.cell * SPIN_N, sh.cell * 4);
      x += sh.cell * SPIN_N + 8;
    }
    y += Math.ceil(r * 1.1) * 2 * 4 + 24;
  }
  // zoomed first rows
  const sh = coinSheet(zoomRow, 8, true);
  g.save(); g.scale(3, 3);
  g.drawImage(sh.canvas, 0, 0, sh.cell * 8, sh.cell * 2, 4, (y + 4) / 3, sh.cell * 8, sh.cell * 2);
  g.restore();
}

export function run(params) {
  const W = 960, H = 540;
  const cv = document.getElementById('screen');
  cv.width = W; cv.height = H;
  cv.style.width = W * 2 + 'px'; cv.style.height = H * 2 + 'px';
  const g = ctxOf(cv);
  registerUiIcons();
  if (params.has('coinsheet')) return coinDebug(g, W, H, Number(params.get('coinsheet') || 0));
  if (params.has('voxfish')) return voxFishGallery(g, W, H, params);
  const mode = params.get('mode') || 'full';
  const night = params.has('night');

  const state = defaultState();
  state.tutorialDone = true;
  state.view = mode === 'full' ? 'aquarium' : 'ocean';
  state.tankWindow = { open: mode === 'window', x: 0, y: 0 };
  const all = params.get('skills') === 'all';
  if (all) for (const s of SKILLS) state.skills[s.id] = true;
  else if (params.get('skills')) for (const id of params.get('skills').split(',')) state.skills[id] = true;
  const nFish = Number(params.get('fish') ?? 12);
  const pool = SPECIES.filter((s) => s.look?.kind !== 'chain' && !s.quirks?.includes('intro'));
  for (let i = 0; i < nFish; i++) {
    const sp = params.get('same') ? pool.find((q) => q.id === params.get('same')) || pool[0] : pool[(i * 7 + 3) % pool.length];
    const rec = rollIndividual(sp, { mutationChance: 0.1, shinyChance: 0.05 });
    state.fish.push({ ...rec, inTank: true, happiness: params.has('same') ? 0.95 : rng.float(0.5, 1), hunger: params.has('same') ? 0.1 : rng.float(0.1, 0.8), coinT: rng.float(0, 1) });
  }
  if (params.get('decor')) state.tank = { decor: [], starter: false };

  const events = {};
  const toasts = [];
  const game = {
    screen: { W, H },
    state,
    stats: computeStats(state.skills),
    mini: mode === 'mini',
    clock: { isNight: () => night, isDusk: () => false, hour: () => (night ? 23 : 12), daylight: () => (night ? 0 : 1), dusk: () => 0 },
    desktop: { hit: () => null, tooltip: null },
    tutorial: null,
    on(ev, f) { (events[ev] ||= []).push(f); },
    emit(ev, d) { for (const f of events[ev] || []) f(d); },
    addCoins(n) { state.coins += n; },
    toast(t) { toasts.push({ t, age: 0 }); console.log('toast:', t); },
    save() {},
    command(id) { if (id === 'tank') state.view = state.view === 'aquarium' ? 'ocean' : 'aquarium'; },
    setView(v) { state.view = v; },
    setMini(m) { game.mini = m; },
  };
  const aq = new Aquarium(game);
  game.aquarium = aq;
  window.AQ = aq;
  window.GAME = game;
  if (mode === 'window') aq.openWindow(true);
  if (params.get('decor')) for (const id of params.get('decor').split(',')) aq.addDecor(id);
  if (!state.tank.decor.length) for (const id of ['rock_arch', 'coral_fan']) aq.addDecor(id);
  const offline = Number(params.get('offline') || 0);
  if (offline) console.log('offline coins', aq.offlineCoins(offline));

  // input: a small stand-in for core/input.js
  const inp = { x: -100, y: -100, vx: 0, vy: 0, speed: 0, down: false, pressed: false, released: false, rpressed: false, inside: false, consume() { this.pressed = false; this.released = false; } };
  let px = 0, py = 0;
  const pos = (e) => { const r = cv.getBoundingClientRect(); inp.x = ((e.clientX - r.left) / r.width) * W; inp.y = ((e.clientY - r.top) / r.height) * H; inp.inside = true; };
  window.addEventListener('pointermove', pos);
  cv.addEventListener('pointerdown', (e) => { pos(e); if (e.button === 2) inp.rpressed = true; else { inp.down = true; inp.pressed = true; } });
  window.addEventListener('pointerup', (e) => { pos(e); if (e.button !== 2) { inp.down = false; inp.released = true; } });
  cv.addEventListener('contextmenu', (e) => e.preventDefault());

  // pre-fill a coin pile
  const nCoins = Number(params.get('coins') || 0);
  const T = aq.T;
  for (let i = 0; i < nCoins; i++) {
    const d = rng.chance(0.12) ? 2 : rng.chance(0.25) ? 1 : 0;
    aq.coins.spawn(rng.float(0.1, 0.9) * T.W, T.surf + rng.float(0, 120), rng.float(0.02, 0.7) * T.DEPTH, d);
  }
  // eggs=k: a clutch k% of the way to hatching (hatches after a few seconds when k is high)
  if (params.has('eggs')) {
    const sp = aq.fish[0]?.sp;
    if (sp) state.tank.eggs.push({ species: sp.id, x: 0.45, z: 0.15, t: 180 * Number(params.get('eggs') || 50) / 100, dur: 180, n: 5, color: sp.look?.col?.body || '#ffd0a0' });
  }
  if (params.has('glass')) { aq.snail = null; aq.updateHelpers(0); if (aq.snail) { aq.snail.mode = 'glass'; aq.snail.side = 'L'; aq.snail.X = 4; aq.snail.cdir = 1; aq.snail.climb = 40; aq.snail.climbMax = 60; aq.snail.z = 0; } }
  const ff = Number(params.get('ff') || 0);
  for (let i = 0; i < ff * 30; i++) aq.update(1 / 30, null);

  const rain = params.has('rain');
  let last = performance.now(), ms = 0, acc = 0, frames = 0, fps = 60;
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.max(0, Math.min(0.05, (now - last) / 1000));
    last = now;
    const t0 = performance.now();
    inp.vx = (inp.x - px) / Math.max(dt, 1e-3); inp.vy = (inp.y - py) / Math.max(dt, 1e-3);
    inp.speed = Math.hypot(inp.vx, inp.vy);
    px = inp.x; py = inp.y;
    if (rain && aq.fish.length && Math.random() < dt * 6) {
      const f = aq.fish[Math.floor(Math.random() * aq.fish.length)];
      aq.dropCoin(f, Math.random() < 0.1 ? 2 : Math.random() < 0.25 ? 1 : 0);
    }
    game.desktop.tooltip = null;
    const over = aq.hit(inp.x, inp.y);
    aq.update(dt, over ? inp : null);
    inp.pressed = false; inp.released = false; inp.rpressed = false;
    // a plain desktop behind the window / mini tank
    const grd = g.createLinearGradient(0, 0, 0, H);
    grd.addColorStop(0, '#3a9cc4'); grd.addColorStop(1, '#1d5f86');
    g.fillStyle = grd;
    g.fillRect(0, 0, W, H);
    if (game.mini) aq.drawMini(g, dt);
    else if (state.view === 'aquarium') aq.drawFull(g, dt);
    else aq.drawWindow(g, dt);
    g.fillStyle = '#6a3e26';
    g.fillRect(0, H - 24, W, 24);
    if (game.desktop.tooltip) drawText(g, game.desktop.tooltip.replace(/\{[a-z_]+\}/g, '*'), inp.x + 12, inp.y + 12, { color: '#fff', outline: '#000' });
    ms = ms * 0.9 + (performance.now() - t0) * 0.1;
    acc += dt; frames++;
    if (acc > 0.5) { fps = frames / acc; acc = 0; frames = 0; }
    drawText(g, `${Math.round(fps)} fps  ${ms.toFixed(1)} ms  fish ${aq.fish.length}  coins ${aq.coins.list.length}  purse ${state.coins}`, 6, H - 16, { font: 'small', color: '#fff', outline: '#000' });
    toasts.forEach((t, i) => drawText(g, t.t, W - 8, 30 + i * 10, { align: 'right', font: 'small', color: '#fff', outline: '#000' }));
  }
  requestAnimationFrame(frame);
}
