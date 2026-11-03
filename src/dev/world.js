// Dev preview for the world agent: dist/dev/world.html
//   ?view=boats            every boat tier on a calm sea (params: dir=-1, roll=index 0..6, night=1, paint=#hex)
//   ?view=horizon          the voxel horizon / sky features of each biome
//   ?view=coral            coral species, reef formations and animated life (theme=shallows|junkyard|abyss, scale, size)
//   ?view=coralprof        coral build-cost profile (console warning)
// The full scene (sky, surface view, water shader) is best checked in the real game:
//   node tools/shot.mjs "?skipintro&watergl=force" out.png 4000 1920 1080 "FISHTOP.camera.scrollTo(FISHTOP.surfaceScroll)"
import { ctxOf } from '../core/canvas.js';
import { drawText } from '../gfx/font.js';
import { Boat } from '../world/boat.js';
import { BOAT_TIERS } from '../world/boatmodels.js';
import { THEMES, coralModel, reefFormation, renderCoral, voxAnim, placeAnim } from '../world/coral.js';
import { palmIsland, lighthouseIslet, sailboat, seaStacks, markerBuoy, factory, gantryCrane, containerStack, rockSpires } from '../world/horizon.js';
import { lerp } from '../core/math.js';
import { makeLayer } from '../core/canvas.js';
import { Clock } from '../world/clock.js';
import { Ocean } from '../world/ocean.js';
import { biomesReady } from '../world/biomes/index.js';
import { Floaters } from '../world/floaters.js';
import { WaterFX } from '../gfx/watergl.js';

function fakeGame(W, H, params, tier) {
  const g = {
    screen: { W, H },
    state: { view: 'ocean', boat: { tier }, character: params.get('paint') ? { boat: params.get('paint') } : undefined },
    world: { cursor: { x: -100, y: -100 }, night: params.get('night') === '1' },
    input: { down: false },
    ocean: { waterLevel: () => H * 0.62, waveAt: () => Math.round(H * 0.62), biome: { fogColor: '#2a8ab0' }, travelState: null },
    water: null,
    fishing: { hook: { visible: false } },
  };
  return g;
}

// ?view=ocean&b=oscean&hour=12&weather=sunny&scroll=-335&watergl=force&floaters=4&stats=1
// Full world pipeline as in game.draw: water shader (forced, works on software GL), real boat, floating boxes.
function runOcean(params) {
  const W = Number(params.get('w') || 960), H = Number(params.get('h') || 540);
  const cv = document.getElementById('screen');
  cv.width = W; cv.height = H;
  cv.style.width = W * 2 + 'px'; cv.style.height = H * 2 + 'px';
  const ctx = ctxOf(cv);
  const scroll = Number(params.get('scroll') || 0);
  const cam = { xform: () => [1, 0, -scroll], view: () => ({ x0: 0, y0: scroll, x1: W, y1: scroll + H, z: 1 }), shake() {}, screenToWorld: (x, y) => [x, y + scroll], apply: (g) => g.setTransform(1, 0, 0, 1, 0, -scroll), reset: (g) => g.setTransform(1, 0, 0, 1, 0, 0) };
  const noop = () => {};
  const game = {
    screen: { W, H }, camera: cam, lowPower: false, mini: false, stats: { crateLuck: Number(params.get('luck') || 0) },
    world: { cursor: { x: W * 0.55, y: H * 0.45, vx: 0, vy: 0, speed: 0, inWorld: true } },
    audio: new Proxy({}, { get: (_, k) => (k === 'loop' ? () => ({ set: noop, stop: noop }) : noop) }),
    state: { view: 'ocean', secrets: {}, boat: { tier: Number(params.get('tier') || 0) }, settings: { dayCycle: 'real' }, character: undefined },
    fishing: { hook: { visible: false, x: 0, y: 0 }, busy: false },
    school: { fishes: [] },
    particles: new Proxy({}, { get: () => noop }),
    toast: noop, addCoins: noop, save: noop, musicFor: () => null,
  };
  game.clock = new Clock(game);
  game.clock.override = Number(params.get('hour') ?? 12);
  const ocean = new Ocean(game);
  game.ocean = ocean;
  const t0 = performance.now();
  ocean.onResize();
  ocean.setBiome(params.get('b') || 'oscean');
  const buildMs = performance.now() - t0;
  if (params.get('weather')) ocean.weather = params.get('weather');
  ocean.weatherT = 1e9;
  const wgl = params.get('watergl') || 'force';
  game.water = new WaterFX(game, { force: wgl === 'force', disabled: wgl === '0' });
  game.boat = new Boat(game);
  game.floaters = new Floaters(game);
  const layer = makeLayer(W, H);
  window.__game = game; window.__ocean = ocean;
  const perf = { ms: 0, n: 0 };
  window.__perf = perf;
  // pre-roll so boxes are already out
  const warm = Number(params.get('warm') ?? 20);
  if (params.has('floaters')) { game.floaters.update(0.01); game.floaters.want = Number(params.get('floaters')); }
  for (let i = 0; i < warm * 30; i++) { ocean.update(1 / 30); game.floaters.update(1 / 30); }
  let last = performance.now();
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.max(0, Math.min(0.05, (now - last) / 1000));
    last = now;
    const T = performance.now();
    game.world.cursor.x = W * (0.5 + 0.3 * Math.sin(now / 3000));
    ocean.env.view = cam.view(); ocean.env.top = ocean.top; ocean.env.scroll = scroll; ocean.env.ref = -Math.round(H * 0.62);
    ocean.update(dt);
    game.floaters.update(dt);
    game.boat.update(dt, null);
    const water = game.water;
    water.update(dt, { surfaceY: ocean.waterLevel(), top: ocean.top, W, H, waveAt: (x) => ocean.waveAt(x) });
    if (Math.random() < dt * 2) water.disturb(Math.random() * W, ocean.waterLevel() + 40 + Math.random() * 200, 0.6, 8);
    const env = ocean.env, b = ocean.biome;
    const shader = water.available;
    const g = shader ? layer.ctx : ctx;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, W, H);
    cam.apply(g);
    b.drawBack(g, env);
    game.floaters.draw(g, 'far');
    let L = ocean.lighting();
    b.drawSeabed(g, env);
    game.floaters.draw(g, 'mid');
    b.drawNear?.(g, env);
    game.floaters.draw(g, 'near');
    cam.reset(g);
    if (shader) {
      const out = water.render(layer.canvas, cam, b.waterLook?.(env) || {});
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(out || layer.canvas, 0, 0);
    }
    cam.apply(ctx);
    try { game.boat.draw(ctx, env); } catch (e) { if (!game.boatErr) { game.boatErr = true; console.warn('boat', e.message); } }
    cam.reset(ctx);
    if (L.dark > 0.02) L.lights.push(...(game.boat.lights?.() || []));
    ocean.applyLighting(ctx, L);
    cam.apply(ctx);
    game.boat.drawLights?.(ctx, L.dark);
    b.drawFront(ctx, env);
    cam.reset(ctx);
    perf.n++;
    perf.ms = lerp(perf.ms, performance.now() - T, perf.n < 10 ? 1 : 0.05);
    if (params.has('stats')) drawText(ctx, `build ${buildMs.toFixed(0)}ms frame ${perf.ms.toFixed(2)}ms water:${water.active ? water.kind : '2d'} boxes ${game.floaters.list.length}`, 250, 4, { font: 'small', color: '#ffffff', outline: '#000000' });
  }
  requestAnimationFrame(frame);
}

export function run(params) {
  if (params.get('view') === 'ocean') { biomesReady.then(() => runOcean(params)); return; }
  const W = Number(params.get('w') || 960), H = Number(params.get('h') || 540);
  const cv = document.getElementById('screen');
  cv.width = W; cv.height = H;
  cv.style.width = W * 2 + 'px'; cv.style.height = H * 2 + 'px';
  const ctx = ctxOf(cv);
  const view = params.get('view') || 'boats';
  const night = params.get('night') === '1';
  if (view === 'coralprof') {
    // build-cost profile: model generation vs rendering per reef size factor
    const out = [];
    for (const k of [0.6, 0.9, 1.2, 1.5]) {
      const t0 = performance.now();
      const m = reefFormation(77, THEMES.shallows, { w: Math.round(140 * k), h: Math.round(84 * k), d: Math.round(54 * k), sizes: [10 * k, 24 * k] });
      const t1 = performance.now();
      renderCoral(m, 1, THEMES.shallows);
      const t2 = performance.now();
      out.push(`k${k} model ${Math.round(t1 - t0)}ms render ${Math.round(t2 - t1)}ms`);
    }
    for (const kind of ['kelp', 'anemone', 'seagrass', 'soft']) {
      const t0 = performance.now();
      voxAnim(kind, 3, 'shallows', kind === 'kelp' ? 14 : 10, 1.2);
      out.push(`${kind} x8 ${Math.round(performance.now() - t0)}ms`);
    }
    console.warn('PROF ' + out.join(' | '));
    return;
  }
  if (view === 'coral') {
    const themeId = params.get('theme') || 'shallows';
    const theme = THEMES[themeId];
    const scale = Number(params.get('scale') || 1.5);
    ctx.fillStyle = { shallows: '#2a9ac0', junkyard: '#2e6a5e', abyss: '#14204a' }[themeId];
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = { shallows: '#d8c08a', junkyard: '#6e6a56', abyss: '#2e3450' }[themeId];
    ctx.fillRect(0, H * 0.42, W, 6); ctx.fillRect(0, H * 0.97, W, 6);
    const kinds = Object.keys(theme.weights);
    const step = Math.floor((W - 60) / kinds.length);
    kinds.forEach((k, i) => {
      const spr = renderCoral(coralModel(k, 10 + i, theme, Number(params.get('size') || 22) * scale), 1, theme);
      ctx.drawImage(spr.canvas, Math.round(50 + i * step - spr.ox), Math.round(H * 0.42 - spr.oy));
      if (night && spr.night) { ctx.globalCompositeOperation = 'lighter'; ctx.drawImage(spr.night, Math.round(50 + i * step - spr.ox), Math.round(H * 0.42 - spr.oy)); ctx.globalCompositeOperation = 'source-over'; }
      drawText(ctx, k, 50 + i * step, H * 0.42 + 10, { align: 'center', color: '#fff', outline: '#000' });
    });
    const t0 = performance.now();
    [[170, 0], [480, 1], [790, 2]].forEach(([x, i]) => {
      const spr = renderCoral(reefFormation(40 + i, theme, { w: Math.round(140 * scale), h: Math.round(84 * scale), d: Math.round(54 * scale), sizes: [10 * scale, 24 * scale] }), 1, theme);
      ctx.drawImage(spr.canvas, Math.round(x - spr.ox), Math.round(H * 0.97 - spr.oy));
      if (night && spr.night) { ctx.globalCompositeOperation = 'lighter'; ctx.drawImage(spr.night, Math.round(x - spr.ox), Math.round(H * 0.97 - spr.oy)); ctx.globalCompositeOperation = 'source-over'; }
    });
    console.log('formations ms', Math.round(performance.now() - t0));
    const anims = ['anemone', 'soft', 'kelp', 'seagrass'].map((k, i) => ({ a: placeAnim(voxAnim(k, 5 + i, themeId, k === 'kelp' ? 14 : 18, scale), 60 + i * 80, H * 0.62), k }));
    let t = 0;
    const loop = () => {
      requestAnimationFrame(loop);
      t += 1 / 60;
      ctx.fillStyle = { shallows: '#2a9ac0', junkyard: '#2e6a5e', abyss: '#14204a' }[themeId];
      ctx.fillRect(0, H * 0.44, 380, H * 0.2);
      for (const { a } of anims) ctx.drawImage(a.frame(t), a.x, a.y);
    };
    loop();
    return;
  }
  if (view === 'horizon') {
    ctx.fillStyle = night ? '#0a1430' : '#8ccff0';
    ctx.fillRect(0, 0, W, H);
    const items = [palmIsland(4, {}), lighthouseIslet(7, {}), sailboat(9, {}), seaStacks(12, {}), markerBuoy('#e2483a'), factory(21, {}), gantryCrane(23, {}), containerStack(25, {}), rockSpires(31, {})];
    let x = 10, y = 150, rowH = 0;
    for (const it of items) {
      if (x + it.w > W - 10) { x = 10; y += rowH + 20; rowH = 0; }
      ctx.drawImage(it.base, x, y - it.oy);
      ctx.fillStyle = '#ff3a3a'; ctx.fillRect(x + it.ox - 1, y, 3, 1);
      x += it.w + 16; rowH = Math.max(rowH, it.h);
    }
    return;
  }
  const dir = Number(params.get('dir') || 1);
  const boats = BOAT_TIERS.map((_, i) => {
    const g = fakeGame(W, H, params, i);
    const b = new Boat(g);
    b.dir = dir;
    b.roll = Number(params.get('roll') ? [-8, -5.3, -2.7, 0, 2.7, 5.3, 8][Number(params.get('roll'))] : 0);
    return { g, b };
  });
  const lv = Math.round(H * 0.62);
  const slots = [0.09, 0.25, 0.44, 0.66, 0.88];
  let t = 0, last = performance.now();
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now; t += dt;
    ctx.fillStyle = night ? '#0a1430' : '#9ad8f4';
    ctx.fillRect(0, 0, W, lv);
    ctx.fillStyle = night ? '#0c2a4a' : '#2a9ac0';
    ctx.fillRect(0, lv, W, H - lv);
    boats.forEach(({ g, b }, i) => {
      b.x = Math.round(W * slots[i]);
      const r0 = b.roll;
      b.update(dt, null);
      b.roll = r0; b.y = lv;
      g.screen.W = W * 4; // keep the drag clamp out of the way
      b.draw(ctx, {});
      if (night) b.drawLights(ctx, 0.6);
      drawText(ctx, `${i} ${BOAT_TIERS[i].name}`, b.x, lv + 60, { align: 'center', color: '#ffffff', outline: '#06121e' });
      const rt = b.rodTip();
      ctx.fillStyle = '#ff2a6a'; ctx.fillRect(Math.round(rt[0]) - 1, Math.round(rt[1]) - 1, 3, 3);
    });
  }
  requestAnimationFrame(frame);
}
