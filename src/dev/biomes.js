// Dev preview of the ocean biomes: dist/dev/biomes.html?b=shallows|junkyard|abyss&hour=12&weather=rain
// Extra params: ui=0 (hide fake desktop), fish=0, stats=1 (frame timings), cycle=1 (fast day cycle),
// warm=SECONDS (pre-simulate), flood=0..1, q=quality, cx/cy (fixed cursor), click=x,y (trigger secretAt).
// Draw order mirrors the game: drawBack, far fish (z>=0.66), drawSeabed, mid fish, drawNear, lighting, icons,
// near fish (z<0.33), drawFront. Placeholder fish scale by 1 - z/2; crawlers ride floorAt(x, z).
import { ctxOf } from '../core/canvas.js';
import { clamp01, lerp } from '../core/math.js';
import { mix } from '../core/color.js';
import { drawText } from '../gfx/font.js';
import { Clock } from '../world/clock.js';
import { Ocean } from '../world/ocean.js';

const TASKBAR_H = 24;

function makeGame(W, H, params) {
  const noop = () => {};
  const game = {
    screen: { W, H },
    world: { cursor: { x: W * 0.55, y: H * 0.45, vx: 0, vy: 0, speed: 0, inWorld: true } },
    audio: new Proxy({}, { get: (_, k) => (k === 'loop' ? () => ({ set: noop, stop: noop }) : (...a) => { if (k === 'play') game.sounds.push(a[0]); }) }),
    sounds: [],
    state: { secrets: {}, baits: { bread: 3 }, coins: Number(params.get('coins') || 40), settings: { dayCycle: 'real' } },
    stats: {},
    lowPower: false,
    fishing: { hook: { visible: false, x: 0, y: 0 }, busy: false },
    school: { fishes: [] },
    particles: new Proxy({}, { get: () => noop }),
    toasts: [],
    toast(text) { game.toasts.push({ text, t: 0 }); console.log('toast:', text); },
    addCoins(n) { game.state.coins += n; },
    spendCoins(n) { if (game.state.coins < n) return false; game.state.coins -= n; return true; },
    save: noop,
    musicFor: () => null,
  };
  game.clock = new Clock(game);
  return game;
}

export function run(params) {
  const W = Number(params.get('w') || 960), H = Number(params.get('h') || 540);
  const S = Number(params.get('zoom') || 2);
  const cv = document.getElementById('screen');
  cv.width = W; cv.height = H;
  cv.style.width = W * S + 'px'; cv.style.height = H * S + 'px';
  const ctx = ctxOf(cv);
  const game = makeGame(W, H, params);
  const hour0 = Number(params.get('hour') ?? 12);
  game.clock.override = hour0;
  const ocean = new Ocean(game);
  game.ocean = ocean;
  const t0 = performance.now();
  ocean.setBiome(params.get('b') || 'shallows');
  const buildMs = performance.now() - t0;
  const weather = params.get('weather');
  if (weather) { ocean.weather = weather; }
  ocean.weatherT = 1e9;
  if (params.has('flood')) { ocean.flood = ocean.floodTarget = Number(params.get('flood')); }
  if (params.has('q')) game.lowPower = Number(params.get('q')) < 1;
  const showUi = params.get('ui') !== '0';
  const showFish = params.get('fish') !== '0';
  const stats = params.has('stats');
  const cycle = params.has('cycle');
  const fixedCursor = params.has('cx');
  if (fixedCursor) { game.world.cursor.x = Number(params.get('cx')); game.world.cursor.y = Number(params.get('cy') || H / 2); }

  // placeholder fish at a few depths: [xFrac, yFrac, z, len, h, colour, speed]
  const fish = [
    [0.18, 0.32, 0.85, 38, 14, '#ff9a3a', 9], [0.72, 0.26, 0.78, 56, 20, '#ffd84a', -7], [0.46, 0.55, 0.72, 30, 12, '#7ad8ff', 12],
    [0.62, 0.44, 0.5, 46, 18, '#ff6a8a', -11], [0.33, 0.66, 0.45, 34, 13, '#b48aff', 8], [0.86, 0.6, 0.4, 28, 11, '#8aff9a', -10],
    [0.52, 0.3, 0.2, 64, 24, '#ff7a3a', 6], [0.28, 0.47, 0.12, 40, 16, '#3ae0d0', -9],
  ].map(([x, y, z, len, h, c, v]) => ({ x: x * W, y: y * H, z, len, h, c, v }));
  // bottom dwellers riding the perspective floor (floorAt(x, z))
  fish.push({ x: W * 0.47, y: 0, z: 0.15, len: 30, h: 10, c: '#ffb04a', v: 5, crawl: true }, { x: W * 0.62, y: 0, z: 0.8, len: 30, h: 10, c: '#ff7aa0', v: -4, crawl: true });

  const perf = { back: 0, seabed: 0, front: 0, light: 0, n: 0, total: 0 };
  window.__perf = perf;
  window.__ocean = ocean;
  window.__game = game;
  let last = performance.now();
  let time = 0;

  const warm = Number(params.get('warm') || 0);
  for (let i = 0; i < warm * 30; i++) ocean.update(1 / 30);

  if (params.has('click')) {
    for (const c of params.get('click').split(';')) {
      const [x, y] = c.split(',').map(Number);
      const id = ocean.biome.secretAt(x, y);
      console.log('secretAt', x, y, '->', id);
      if (id) ocean.biome.onSecret(id, game);
      for (let i = 0; i < 20; i++) ocean.update(1 / 30);
    }
  }
  window.__secret = (x, y) => { const id = ocean.biome.secretAt(x, y); if (id) ocean.biome.onSecret(id, game); return id; };

  function drawFish(list, z0, z1, L) {
    const b = ocean.biome;
    const fogC = b.fogColor || '#2a7aa0';
    for (const f of list) {
      if (f.z < z0 || f.z >= z1) continue;
      let col = f.c, a = 0;
      if (z0 < 0 && L.dark > 0.02) { col = mix(f.c, L.tint || '#0a1030', clamp01((1 - ocean.lightAt(f.x, f.y, L)) * 0.9)); }
      else { a = Math.min(0.85, f.z * (b.fogAmount ?? 0.75)); col = mix(f.c, fogC, a); }
      const dark = mix(col, '#101830', 0.45), light = mix(col, '#ffffff', 0.35);
      const dir = Math.sign(f.v) || 1;
      const s = 1 - f.z * 0.5;
      const len = f.len * s, hh = f.h * s;
      const fy = f.crawl ? b.floorAt(f.x, f.z) - hh / 2 - 1 : f.y + Math.sin(time * 1.3 + f.x) * 3;
      const cx = Math.round(f.x), cy = Math.round(fy);
      ctx.fillStyle = dark;
      for (let y = -hh / 2 - 1; y <= hh / 2 + 1; y++) {
        const w = Math.round((len / 2 + 1) * Math.sqrt(Math.max(0, 1 - (y / (hh / 2 + 1)) ** 2)));
        ctx.fillRect(cx - w, cy + Math.round(y), w * 2, 1);
      }
      ctx.fillStyle = col;
      for (let y = -hh / 2; y <= hh / 2; y++) {
        const w = Math.round((len / 2) * Math.sqrt(Math.max(0, 1 - (y / (hh / 2)) ** 2)));
        ctx.fillRect(cx - w, cy + Math.round(y), w * 2, 1);
      }
      ctx.fillStyle = light;
      ctx.fillRect(cx - Math.round(len * 0.25), cy - Math.round(hh * 0.3), Math.round(len * 0.4), 2);
      // tail
      ctx.fillStyle = dark;
      const tx = cx - dir * Math.round(len / 2);
      for (let k = 0; k < hh * 0.5; k++) ctx.fillRect(tx - dir * k - (dir > 0 ? 1 : 0), cy - Math.round(k * 0.8), 1, Math.round(k * 1.6) + 1);
      ctx.fillStyle = '#101018';
      ctx.fillRect(cx + dir * Math.round(len * 0.3), cy - 2, 2, 2);
    }
  }

  function drawUi() {
    // icon grid (2 columns x 7 rows like the real desktop)
    const names = ['My PC', 'Trash', 'Browser', 'Documents', 'Music', 'Photos', 'Games', 'Mail', 'Terminal', 'Settings', 'Calc', 'Notes'];
    names.forEach((n, i) => {
      const gx = Math.floor(i / 7), gy = i % 7;
      const x = 12 + gx * 74 + 21, y = 10 + gy * 62;
      ctx.fillStyle = '#1a2a3a'; ctx.fillRect(x - 1, y - 1, 34, 34);
      ctx.fillStyle = ['#ffd24a', '#9ab0c0', '#4ab0ff', '#ffe08a', '#ff7ab0', '#7ae08a'][i % 6]; ctx.fillRect(x, y, 32, 32);
      ctx.fillStyle = '#ffffff'; ctx.fillRect(x + 3, y + 3, 10, 3);
      drawText(ctx, n, x + 16, y + 38, { align: 'center', color: '#ffffff', outline: '#0b1622' });
    });
    // bait box
    ctx.fillStyle = '#5a3a1e'; ctx.fillRect(14, H - TASKBAR_H - 40, 52, 34);
    ctx.fillStyle = '#8a5a2e'; ctx.fillRect(16, H - TASKBAR_H - 38, 48, 8);
    // dock items standing on the floor
    let x = W - 12;
    for (const [w, h, c] of [[26, 34, '#7ae0ff'], [36, 34, '#3ab8e8'], [30, 34, '#8a4a2a'], [34, 34, '#ff7aa8'], [74, 64, '#c88a4a']].reverse().reverse()) {
      x -= w;
      const fy = Math.min(ocean.floorAt(x + w / 2) + 6, H - TASKBAR_H - 2);
      ctx.fillStyle = '#1a1020'; ctx.fillRect(x - 1, fy - h - 1, w + 2, h + 2);
      ctx.fillStyle = c; ctx.fillRect(x, fy - h, w, h);
      x -= 10;
    }
    // taskbar
    ctx.fillStyle = '#1b2433'; ctx.fillRect(0, H - TASKBAR_H, W, TASKBAR_H);
    ctx.fillStyle = '#2d3a50'; ctx.fillRect(0, H - TASKBAR_H, W, 1);
    ctx.fillStyle = '#8a5a2e'; ctx.fillRect(2, H - TASKBAR_H + 2, 72, TASKBAR_H - 4);
    drawText(ctx, 'FISHTOP', 38, H - TASKBAR_H + 8, { align: 'center', color: '#fff4d0', outline: '#2a1608' });
    drawText(ctx, `${ocean.biome.name} - ${ocean.weatherName()} - ${String(Math.floor(ocean.env.hour)).padStart(2, '0')}:00`, W - 8, H - TASKBAR_H + 8, { align: 'right', color: '#cfe8ff' });
  }

  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.max(0, Math.min(0.05, (now - last) / 1000));
    last = now;
    time += dt;
    if (cycle) game.clock.override = (hour0 + time * 0.5) % 24;
    if (!fixedCursor) {
      game.world.cursor.x = W * (0.5 + 0.35 * Math.sin(time * 0.3));
      game.world.cursor.y = H * (0.45 + 0.25 * Math.cos(time * 0.23));
    }
    for (const f of fish) { f.x += f.v * dt; if (f.x > W + 40) f.x = -40; if (f.x < -40) f.x = W + 40; }
    ocean.update(dt);
    const b = ocean.biome, env = ocean.env;
    const T = performance.now();
    b.drawBack(ctx, env);
    const T1 = performance.now();
    let L = { dark: 0, tint: '#000', lights: [] };
    if (showFish) drawFish(fish, 0.66, 2, L);
    const T2 = performance.now();
    b.drawSeabed(ctx, env);
    const T3 = performance.now();
    if (showFish) drawFish(fish, 0.33, 0.66, L);
    const Tn = performance.now();
    b.drawNear?.(ctx, env);
    const Tn2 = performance.now();
    L = ocean.lighting();
    ocean.applyLighting(ctx, L);
    const T4 = performance.now();
    if (showUi) drawUi();
    if (showFish) drawFish(fish, -1, 0.33, L);
    const T5 = performance.now();
    b.drawFront(ctx, env);
    const T6 = performance.now();
    if (showUi) {
      ctx.fillStyle = '#1b2433'; ctx.fillRect(0, H - TASKBAR_H, W, TASKBAR_H);
      drawText(ctx, 'FISHTOP', 38, H - TASKBAR_H + 8, { align: 'center', color: '#fff4d0', outline: '#2a1608' });
      drawText(ctx, `${b.name} - ${ocean.weatherName()} - ${String(Math.floor(env.hour)).padStart(2, '0')}:${String(Math.floor((env.hour % 1) * 60)).padStart(2, '0')}`, W - 8, H - TASKBAR_H + 8, { align: 'right', color: '#cfe8ff' });
    }
    perf.n++;
    const k = perf.n < 10 ? 1 : 0.05;
    perf.back = lerp(perf.back, T1 - T, k); perf.seabed = lerp(perf.seabed, T3 - T2, k);
    perf.light = lerp(perf.light, T4 - Tn2, k); perf.front = lerp(perf.front, T6 - T5, k);
    perf.near = lerp(perf.near || 0, Tn2 - Tn, k);
    perf.total = perf.back + perf.seabed + perf.front + perf.light + perf.near;
    perf.build = buildMs;
    if (stats) {
      drawText(ctx, `build ${buildMs.toFixed(0)}ms  back ${perf.back.toFixed(2)}  seabed ${perf.seabed.toFixed(2)}  near ${(perf.near || 0).toFixed(2)}  light ${perf.light.toFixed(2)}  front ${perf.front.toFixed(2)}  = ${perf.total.toFixed(2)} ms  lights ${L.lights.length} dark ${L.dark.toFixed(2)}`, 250, 4, { font: 'small', color: '#ffffff', outline: '#000000' });
    }
    game.toasts = game.toasts.filter((t) => (t.t += dt) < 4);
    game.toasts.forEach((t, i) => drawText(ctx, t.text, W / 2, 60 + i * 12, { align: 'center', color: '#ffffff', outline: '#000' }));
  }
  requestAnimationFrame(frame);
}
