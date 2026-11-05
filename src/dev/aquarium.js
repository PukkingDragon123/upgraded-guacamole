// Dev preview of the 3D aquarium with a stub game (phase 6).
//   dist/dev/aquarium.html?tier=0..5&fish=12&mode=full|window&night&skills=all&decor=castle,pirate_ship&preset=front|top|close|side|room
//   &swim (start swimming) &gear=filter:2,light:3,air:2,heater:1,sand:3 &coins=N &grow (play the expansion from tier-1)
//   &ff=N (fast-forward N seconds) &yaw=..&pitch=..&dist=k (camera override). window.AQ = the aquarium.

import { ctxOf } from '../core/canvas.js';
import { drawText } from '../gfx/font.js';
import { registerUiIcons } from '../gfx/uiicons.js';
import { rng } from '../core/rng.js';
import { Aquarium } from '../aquarium/aquarium.js';
import { PROF } from '../aquarium/view3d.js';
import { decorModel } from '../aquarium/lpdecor.js';
import { PROPS } from '../gfx/props.js';
import { defaultState } from '../game/state.js';
import { computeStats, SKILLS } from '../game/skills.js';
import { SPECIES } from '../fish/species.js';
import { rollIndividual } from '../fish/traits.js';

export function run(params) {
  const W = 960, H = 540;
  const cv = document.getElementById('screen');
  cv.width = W; cv.height = H;
  cv.style.width = W * 2 + 'px'; cv.style.height = H * 2 + 'px';
  const g = ctxOf(cv);
  registerUiIcons();
  const mode = params.get('mode') || 'full';
  const night = params.has('night');
  const state = defaultState();
  state.tutorialDone = true;
  state.view = mode === 'full' ? 'aquarium' : 'ocean';
  state.tankWindow = { open: mode === 'window', x: 0, y: 0 };
  state.coins = 99999;
  const tier = Number(params.get('tier') || 3);
  state.tank.tier = params.has('grow') ? Math.max(0, tier - 1) : tier;
  if (params.get('skills') === 'all') for (const s of SKILLS) state.skills[s.id] = true;
  if (params.get('gear')) { state.tank.gear = {}; for (const kv of params.get('gear').split(',')) { const [k, v] = kv.split(':'); state.tank.gear[k] = Number(v); } }
  const nFish = Number(params.get('fish') ?? 12);
  const pool = SPECIES.filter((s) => !s.quirks?.includes('intro') && !s.spawn?.never);
  for (let i = 0; i < nFish; i++) {
    const sp = params.get('same') ? pool.find((q) => q.id === params.get('same')) || pool[0] : pool[(i * 7 + 3) % pool.length];
    const rec = rollIndividual(sp, { mutationChance: 0.1, shinyChance: 0.05 });
    state.fish.push({ ...rec, inTank: true, happiness: rng.float(0.5, 1), hunger: rng.float(0.1, 0.8), coinT: rng.float(0, 1) });
  }
  const events = {};
  const toasts = [];
  const game = {
    screen: { W, H }, state, stats: computeStats(state), mini: false,
    clock: { isNight: () => night, isDusk: () => false, hour: () => (night ? 23 : 12), daylight: () => (night ? 0 : 1), dusk: () => 0 },
    desktop: { hit: () => null, tooltip: null }, tutorial: null, ui: { active: false },
    input: { keys: new Set(), keysPressed: new Set(), key(k) { return this.keys.has(k); }, keyPressed(k) { return this.keysPressed.has(k); } },
    on(ev, f) { (events[ev] ||= []).push(f); },
    emit(ev, d) { for (const f of events[ev] || []) f(d); },
    addCoins(n) { state.coins += n; },
    spendCoins(n) { if (state.coins < n) return false; state.coins -= n; return true; },
    toast(t) { toasts.push({ t, age: 0 }); console.log('toast:', t); },
    save() {}, recomputeStats() { game.stats = computeStats(state); },
    command(id) { if (id === 'tank') state.view = state.view === 'aquarium' ? 'ocean' : 'aquarium'; },
    setView(v) { state.view = v; },
  };
  const aq = new Aquarium(game);
  game.aquarium = aq;
  window.AQ = aq; window.GAME = game; window.PROF = PROF;
  window.decorCheck = () => { const bad = [], sizes = {}; for (const id of Object.keys(PROPS)) { if (!PROPS[id].decor) continue; try { const m = decorModel(id, 0); sizes[id] = [Math.round(m.r), Math.round(m.h), m.mesh.count / 3]; } catch (e) { bad.push(id + ': ' + e.message); } } return { bad, n: Object.keys(sizes).length, sizes }; };
  if (mode === 'window') aq.openWindow(true);
  for (const id of (params.get('decor') || 'rock_arch,coral_fan,treasure_chest,castle,rubber_duck').split(',').filter(Boolean)) aq.addDecor(id);
  for (let i = 0; i < Number(params.get('coins') || 0); i++) aq.drops.spawn(aq.shape.swimPoint(Math.random, Math.random(), 1), rng.chance(0.15) ? 2 : rng.chance(0.3) ? 1 : 0);
  // input stand-in
  const inp = { x: -100, y: -100, vx: 0, vy: 0, speed: 0, down: false, rdown: false, pressed: false, released: false, rpressed: false, wheel: 0, inside: false,
    keyPressed: (k) => game.input.keysPressed.has(k), consume() { this.pressed = false; this.released = false; } };
  const pos = (e) => { const r = cv.getBoundingClientRect(); inp.x = ((e.clientX - r.left) / r.width) * W; inp.y = ((e.clientY - r.top) / r.height) * H; inp.inside = true; };
  window.addEventListener('pointermove', pos);
  cv.addEventListener('pointerdown', (e) => { pos(e); if (e.button === 2) { inp.rpressed = true; inp.rdown = true; } else { inp.down = true; inp.pressed = true; } });
  window.addEventListener('pointerup', (e) => { pos(e); if (e.button === 2) inp.rdown = false; else { inp.down = false; inp.released = true; } });
  cv.addEventListener('contextmenu', (e) => e.preventDefault());
  cv.addEventListener('wheel', (e) => { e.preventDefault(); inp.wheel += Math.sign(e.deltaY); }, { passive: false });
  window.addEventListener('keydown', (e) => { const k = e.key.length === 1 ? e.key.toLowerCase() : e.key; if (!game.input.keys.has(k)) game.input.keysPressed.add(k); game.input.keys.add(k); });
  window.addEventListener('keyup', (e) => { const k = e.key.length === 1 ? e.key.toLowerCase() : e.key; game.input.keys.delete(k); });

  const ff = Number(params.get('ff') || 0);
  for (let i = 0; i < ff * 30; i++) aq.update(1 / 30, null);
  if (params.get('preset')) setTimeout(() => aq.view.setPreset(params.get('preset'), true), 200);
  if (params.has('swim')) aq.enterSwim();
  if (params.has('grow')) setTimeout(() => { state.tank.tier = tier; }, 600);
  const cam = aq.view.camT;
  if (params.has('yaw')) cam.yaw = Number(params.get('yaw'));
  if (params.has('pitch')) cam.pitch = Number(params.get('pitch'));
  if (params.has('dist')) cam.dist *= Number(params.get('dist'));
  if (params.has('yaw') || params.has('pitch') || params.has('dist')) Object.assign(aq.view.cam, { yaw: cam.yaw, pitch: cam.pitch, dist: cam.dist });

  let last = performance.now(), ms = 0, acc = 0, frames = 0, fps = 60;
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.max(0, Math.min(0.05, (now - last) / 1000));
    last = now;
    const t0 = performance.now();
    game.desktop.tooltip = null;
    aq.update(dt, aq.hit(inp.x, inp.y) ? inp : null);
    inp.pressed = false; inp.released = false; inp.rpressed = false; inp.wheel = 0;
    game.input.keysPressed.clear();
    g.fillStyle = '#2a7fb0'; g.fillRect(0, 0, W, H);
    if (state.view === 'aquarium') aq.drawFull(g, dt); else aq.drawWindow(g, dt);
    if (game.desktop.tooltip) drawText(g, game.desktop.tooltip.replace(/\{[a-z_]+\}/g, '*'), inp.x + 12, inp.y + 12, { color: '#fff', outline: '#000' });
    ms = ms * 0.9 + (performance.now() - t0) * 0.1;
    acc += dt; frames++;
    if (acc > 0.5) { fps = frames / acc; acc = 0; frames = 0; }
    window.__aqMs = ms;
    drawText(g, `${Math.round(fps)} fps  ${ms.toFixed(1)} ms  fish ${aq.fish.length}  drops ${aq.drops.list.length}  purse ${state.coins}`, 6, H - 12, { font: 'small', color: '#fff', outline: '#000' });
    toasts.slice(-4).forEach((t, i) => drawText(g, t.t, W - 8, 40 + i * 10, { align: 'right', font: 'small', color: '#fff', outline: '#000' }));
  }
  requestAnimationFrame(frame);
}
