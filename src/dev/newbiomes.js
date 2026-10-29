// Dev preview of the three new oceans and their species.
//   dist/dev/newbiomes.html?b=fjord|volcano|metropolis&hour=12&weather=aurora&scroll=-335
//   &mode=species&biome=fjord (species grid; biome=all for every new species)
// Extra params: ui=0 (hide fake desktop), fish=0, stats=1, cycle=1, warm=SECONDS, q=quality, cx/cy (cursor),
// click=x,y;x,y (trigger secretAt at world points), scroll=Y (world y at the screen top: negative shows the
// surface / sky view the camera can scroll up to), boat=0 (hide the placeholder boat), frozen (species).
// Draw order mirrors the game: drawBack, far fish, drawSeabed, mid fish, drawNear, lighting, icons, near fish, drawFront.
import { ctxOf } from '../core/canvas.js';
import { clamp01, lerp } from '../core/math.js';
import { mix, RARITY } from '../core/color.js';
import { drawText } from '../gfx/font.js';
import { Clock } from '../world/clock.js';
import { Ocean } from '../world/ocean.js';
import { BIOMES, BIOME_ORDER } from '../world/biomes/index.js';
import { FjordBiome } from '../world/biomes/fjord.js';
import { VolcanoBiome } from '../world/biomes/volcano.js';
import { MetropolisBiome } from '../world/biomes/metropolis.js';
import { EXTRA_SPECIES } from '../fish/species-extra.js';
import { compiled } from '../gfx/spritecache.js';
import { drawFishRig, beginRigFrame } from '../gfx/fishrig.js';

const TASKBAR_H = 24;
Object.assign(BIOMES, { fjord: FjordBiome, volcano: VolcanoBiome, metropolis: MetropolisBiome });
for (const id of ['fjord', 'volcano', 'metropolis']) if (!BIOME_ORDER.includes(id)) BIOME_ORDER.push(id);

function makeGame(W, H, params, cam) {
  const noop = () => {};
  const game = {
    screen: { W, H },
    world: { cursor: { x: W * 0.55, y: H * 0.45, vx: 0, vy: 0, speed: 0, inWorld: true } },
    audio: new Proxy({}, { get: (_, k) => (k === 'loop' ? () => ({ set: noop, stop: noop }) : (...a) => { if (k === 'play') game.sounds.push(a[0]); }) }),
    sounds: [],
    state: { secrets: {}, baits: { bread: 3 }, coins: Number(params.get('coins') || 40), settings: { dayCycle: 'real' } },
    stats: {},
    lowPower: false,
    camera: cam,
    fishing: { hook: { visible: false, x: 0, y: 0 }, busy: false },
    school: { fishes: [] },
    particles: new Proxy({}, { get: () => noop }),
    toasts: [],
    toast(text) { game.toasts.push({ text, t: 0 }); console.log('toast:', text); },
    addCoins(n) { game.state.coins += n; console.log('coins +' + n); },
    spendCoins(n) { if (game.state.coins < n) return false; game.state.coins -= n; return true; },
    save: noop,
    musicFor: () => null,
  };
  game.clock = new Clock(game);
  return game;
}

export function run(params) {
  if (params.get('mode') === 'species') { runSpecies(params); return; }
  const W = Number(params.get('w') || 960), H = Number(params.get('h') || 540);
  const S = Number(params.get('zoom') || 2);
  const cv = document.getElementById('screen');
  cv.width = W; cv.height = H;
  cv.style.width = W * S + 'px'; cv.style.height = H * S + 'px';
  const ctx = ctxOf(cv);
  const scroll = Number(params.get('scroll') || 0);
  const cam = { xform: () => [1, 0, -scroll], view: () => ({ x0: 0, y0: scroll, x1: W, y1: scroll + H, z: 1 }), shake: () => {} };
  const game = makeGame(W, H, params, cam);
  const hour0 = Number(params.get('hour') ?? 12);
  game.clock.override = hour0;
  const ocean = new Ocean(game);
  game.ocean = ocean;
  const t0 = performance.now();
  ocean.onResize();
  ocean.setBiome(params.get('b') || 'fjord');
  const buildMs = performance.now() - t0;
  const weather = params.get('weather');
  if (weather) ocean.weather = weather;
  ocean.weatherT = 1e9;
  if (params.has('flood')) ocean.flood = ocean.floodTarget = Number(params.get('flood'));
  if (params.has('q')) game.lowPower = Number(params.get('q')) < 1;
  const showUi = params.get('ui') !== '0' && scroll === 0;
  const showFish = params.get('fish') !== '0';
  const showBoat = params.get('boat') !== '0';
  const stats = params.has('stats');
  const cycle = params.has('cycle');
  const fixedCursor = params.has('cx');
  if (fixedCursor) { game.world.cursor.x = Number(params.get('cx')); game.world.cursor.y = Number(params.get('cy') || H / 2); }
  ocean.env.view = cam.view();

  const fish = [
    [0.18, 0.32, 0.85, 38, 14, '#ff9a3a', 9], [0.72, 0.26, 0.78, 56, 20, '#ffd84a', -7], [0.46, 0.55, 0.72, 30, 12, '#7ad8ff', 12],
    [0.62, 0.44, 0.5, 46, 18, '#ff6a8a', -11], [0.33, 0.66, 0.45, 34, 13, '#b48aff', 8], [0.86, 0.6, 0.4, 28, 11, '#8aff9a', -10],
    [0.52, 0.3, 0.2, 64, 24, '#ff7a3a', 6], [0.28, 0.47, 0.12, 40, 16, '#3ae0d0', -9],
  ].map(([x, y, z, len, h, c, v]) => ({ x: x * W, y: y * H, z, len, h, c, v }));
  fish.push({ x: W * 0.47, y: 0, z: 0.15, len: 30, h: 10, c: '#ffb04a', v: 5, crawl: true }, { x: W * 0.62, y: 0, z: 0.8, len: 30, h: 10, c: '#ff7aa0', v: -4, crawl: true });

  const perf = { back: 0, seabed: 0, front: 0, light: 0, n: 0, total: 0 };
  window.__perf = perf; window.__ocean = ocean; window.__game = game;
  let last = performance.now(), time = 0;
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
      let col = f.c;
      if (z0 < 0 && L.dark > 0.02) col = mix(f.c, L.tint || '#0a1030', clamp01((1 - ocean.lightAt(f.x, f.y, L)) * 0.9));
      else col = mix(f.c, fogC, Math.min(0.85, f.z * (b.fogAmount ?? 0.75)));
      const dark = mix(col, '#101830', 0.45), light = mix(col, '#ffffff', 0.35);
      const dir = Math.sign(f.v) || 1, s = 1 - f.z * 0.5;
      const len = f.len * s, hh = f.h * s;
      const fy = f.crawl ? b.floorAt(f.x, f.z) - hh / 2 - 1 : f.y + Math.sin(time * 1.3 + f.x) * 3;
      const cx = Math.round(f.x), cy = Math.round(fy);
      ctx.fillStyle = dark;
      for (let y = -hh / 2 - 1; y <= hh / 2 + 1; y++) { const w = Math.round((len / 2 + 1) * Math.sqrt(Math.max(0, 1 - (y / (hh / 2 + 1)) ** 2))); ctx.fillRect(cx - w, cy + Math.round(y), w * 2, 1); }
      ctx.fillStyle = col;
      for (let y = -hh / 2; y <= hh / 2; y++) { const w = Math.round((len / 2) * Math.sqrt(Math.max(0, 1 - (y / (hh / 2)) ** 2))); ctx.fillRect(cx - w, cy + Math.round(y), w * 2, 1); }
      ctx.fillStyle = light;
      ctx.fillRect(cx - Math.round(len * 0.25), cy - Math.round(hh * 0.3), Math.round(len * 0.4), 2);
      ctx.fillStyle = dark;
      const tx = cx - dir * Math.round(len / 2);
      for (let k = 0; k < hh * 0.5; k++) ctx.fillRect(tx - dir * k - (dir > 0 ? 1 : 0), cy - Math.round(k * 0.8), 1, Math.round(k * 1.6) + 1);
      ctx.fillStyle = '#101018';
      ctx.fillRect(cx + dir * Math.round(len * 0.3), cy - 2, 2, 2);
    }
  }

  // placeholder boat riding the biome's waterline
  function drawBoat() {
    const lvl = ocean.waterLevel();
    if (lvl === null || !showBoat) return;
    const x = Math.round(W * 0.5), y = Math.round(ocean.waveAt(x) ?? lvl);
    ctx.fillStyle = '#3a2214'; ctx.fillRect(x - 34, y - 9, 68, 12); ctx.fillRect(x - 30, y + 3, 60, 3);
    ctx.fillStyle = '#8a5a2e'; ctx.fillRect(x - 33, y - 8, 66, 4);
    ctx.fillStyle = '#c8945a'; ctx.fillRect(x - 33, y - 8, 66, 1);
    ctx.fillStyle = '#2a3a6a'; ctx.fillRect(x - 4, y - 24, 8, 15);
    ctx.fillStyle = '#f0c8a0'; ctx.fillRect(x - 3, y - 30, 6, 6);
    ctx.fillStyle = '#c83a2a'; ctx.fillRect(x - 4, y - 32, 8, 3);
    ctx.fillStyle = '#5a3a1a'; for (let i = 0; i < 26; i++) ctx.fillRect(x + 4 + i, y - 22 - Math.round(i * 0.9), 1, 1);
  }

  function drawUi() {
    const names = ['My PC', 'Trash', 'Browser', 'Documents', 'Music', 'Photos', 'Games', 'Mail', 'Terminal', 'Settings', 'Calc', 'Notes'];
    names.forEach((n, i) => {
      const gx = Math.floor(i / 7), gy = i % 7;
      const x = 12 + gx * 74 + 21, y = 10 + gy * 62;
      ctx.fillStyle = '#1a2a3a'; ctx.fillRect(x - 1, y - 1, 34, 34);
      ctx.fillStyle = ['#ffd24a', '#9ab0c0', '#4ab0ff', '#ffe08a', '#ff7ab0', '#7ae08a'][i % 6]; ctx.fillRect(x, y, 32, 32);
      ctx.fillStyle = '#ffffff'; ctx.fillRect(x + 3, y + 3, 10, 3);
      drawText(ctx, n, x + 16, y + 38, { align: 'center', color: '#ffffff', outline: '#0b1622' });
    });
    ctx.fillStyle = '#5a3a1e'; ctx.fillRect(14, H - TASKBAR_H - 40, 52, 34);
    ctx.fillStyle = '#8a5a2e'; ctx.fillRect(16, H - TASKBAR_H - 38, 48, 8);
    let x = W - 12;
    for (const [w, h, c] of [[26, 34, '#7ae0ff'], [36, 34, '#3ab8e8'], [30, 34, '#8a4a2a'], [34, 34, '#ff7aa8'], [74, 64, '#c88a4a']]) {
      x -= w;
      const fy = Math.min(ocean.floorAt(x + w / 2) + 6, H - TASKBAR_H - 2);
      ctx.fillStyle = '#1a1020'; ctx.fillRect(x - 1, fy - h - 1, w + 2, h + 2);
      ctx.fillStyle = c; ctx.fillRect(x, fy - h, w, h);
      x -= 10;
    }
  }

  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.max(0, Math.min(0.05, (now - last) / 1000));
    last = now;
    time += dt;
    if (cycle) game.clock.override = (hour0 + time * 0.5) % 24;
    if (!fixedCursor) {
      game.world.cursor.x = W * (0.5 + 0.35 * Math.sin(time * 0.3));
      game.world.cursor.y = scroll + H * (0.45 + 0.25 * Math.cos(time * 0.23));
    }
    for (const f of fish) { f.x += f.v * dt; if (f.x > W + 40) f.x = -40; if (f.x < -40) f.x = W + 40; }
    ocean.env.view = cam.view();
    ocean.update(dt);
    const b = ocean.biome, env = ocean.env;
    ctx.setTransform(1, 0, 0, 1, 0, -scroll);
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
    drawBoat();
    L = ocean.lighting();
    ocean.applyLighting(ctx, L);
    const T4 = performance.now();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (showUi) drawUi();
    ctx.setTransform(1, 0, 0, 1, 0, -scroll);
    if (showFish) drawFish(fish, -1, 0.33, L);
    const T5 = performance.now();
    b.drawFront(ctx, env);
    const T6 = performance.now();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
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
    if (stats) drawText(ctx, `build ${buildMs.toFixed(0)}ms  back ${perf.back.toFixed(2)}  seabed ${perf.seabed.toFixed(2)}  near ${(perf.near || 0).toFixed(2)}  light ${perf.light.toFixed(2)}  front ${perf.front.toFixed(2)}  = ${perf.total.toFixed(2)} ms  lights ${L.lights.length} dark ${L.dark.toFixed(2)}`, 250, 4, { font: 'small', color: '#ffffff', outline: '#000000' });
    game.toasts = game.toasts.filter((t) => (t.t += dt) < 4);
    game.toasts.forEach((t, i) => drawText(ctx, t.text, W / 2, 60 + i * 12, { align: 'center', color: '#ffffff', outline: '#000' }));
  }
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------- species grid
const BG = { fjord: ['#5ab8d0', '#14507a'], volcano: ['#3a1a18', '#0a0608'], metropolis: ['#1a1838', '#06060e'] };

function grad(g, W, H, top, bot) {
  const a = top.match(/\w\w/g).map((h) => parseInt(h, 16)), b = bot.match(/\w\w/g).map((h) => parseInt(h, 16));
  for (let y = 0; y < H; y += 4) { const t = y / H; g.fillStyle = `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(',')})`; g.fillRect(0, y, W, 4); }
}

function runSpecies(params) {
  const W = 960, H = 540;
  const cv = document.getElementById('screen');
  cv.width = W; cv.height = H;
  cv.style.width = W * 2 + 'px'; cv.style.height = H * 2 + 'px';
  const g = ctxOf(cv);
  const biome = params.get('biome') || 'fjord';
  const frozen = params.has('frozen');
  const list = biome === 'all' ? EXTRA_SPECIES : EXTRA_SPECIES.filter((s) => s.biome === biome);
  const leg = list.filter((s) => s.rarity === 'legendary');
  const rest = list.filter((s) => s.rarity !== 'legendary');
  const cols = biome === 'all' ? 9 : 4;
  const cells = rest.map((sp, i) => ({ sp, x: 90 + (i % cols) * (biome === 'all' ? 106 : 180), y: 70 + Math.floor(i / cols) * (biome === 'all' ? 80 : 150) }));
  leg.forEach((sp, i) => cells.push({ sp, x: biome === 'all' ? 200 + i * 280 : 830, y: biome === 'all' ? 470 : 280, big: true }));
  let t = 0, last = performance.now();
  function draw() {
    const now = performance.now();
    t += frozen ? 0 : Math.min(0.05, (now - last) / 1000);
    last = now;
    beginRigFrame();
    grad(g, W, H, ...(BG[biome] || BG.fjord));
    cells.forEach(({ sp, x, y, big }, i) => {
      const c = compiled(sp.look, null, sp.id);
      const scale = biome === 'all' ? (big ? 0.45 : 0.75) : big ? 0.62 : 1;
      const sw = frozen ? 0.15 + i * 0.07 : t * 0.9;
      const st = { x, y, scale, time: frozen ? 0.25 : t, swimPhase: sw, tailPhase: frozen ? sw * 1.3 : t * 1.6, finPhase: frozen ? sw * 0.7 : t * 1.1, emotion: 'neutral', mouth: 0, speed01: 0.5 };
      if (sp.look.kind === 'chain') {
        const pts = [];
        for (let k = 0; k < (c.chain?.segs || 14); k++) { const u = (frozen ? 0.5 : t * 0.8) - k * 0.12; pts.push({ x: x + Math.cos(u) * 70 * scale - k * 2, y: y + Math.sin(u * 2) * 18 * scale }); }
        st.chain = pts; st.x = pts[0].x; st.y = pts[0].y;
      }
      drawFishRig(g, c, st);
      const r = RARITY[sp.rarity];
      drawText(g, sp.name, x, y + (big ? 120 : biome === 'all' ? 30 : 52), { font: 'small', align: 'center', color: r.color, shadow: '#05070c' });
      if (biome !== 'all') drawText(g, r.name, x, y + (big ? 128 : 60), { font: 'small', align: 'center', color: r.dark, shadow: '#05070c' });
    });
    drawText(g, `${biome.toUpperCase()}  ${list.length} species`, 8, 6, { font: 'small', color: '#ffffff', shadow: '#000000' });
    if (!frozen) requestAnimationFrame(draw);
    else if ((window.__warm = (window.__warm || 0) + 1) < 40) requestAnimationFrame(draw);
  }
  draw();
}
