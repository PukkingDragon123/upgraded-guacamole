// Dev preview of the voxel fish style.
//   dist/dev/voxfish.html?page=all      every species (filter: &biome=shallows|junkyard|abyss), &spin (turning),
//                                        &yaw=DEG (fixed world yaw), &scale=K, &frozen
//   dist/dev/voxfish.html?page=ocean    real biome + School population (presence scale, schools, hero fish,
//                                        packages) with frame timings: &biome=..., &hour=H, &hero, &n=COUNT
//   dist/dev/voxfish.html?page=features turning, emotions, look/talk, inflate, wash, glow, silhouette, chains, crates
// window.__vf exposes {stats, perf} for tools/shot.mjs.

import { ctxOf } from '../core/canvas.js';
import { drawText } from '../gfx/font.js';
import { RARITY } from '../core/color.js';
import { compiled } from '../gfx/spritecache.js';
import { drawFishRig, setFishStyle } from '../gfx/fishrig.js';
import { voxelFishStats, setVoxelFishBudget, benchVoxel, setVoxelSync } from '../gfx/voxelfish.js';
import { rigGeom } from '../gfx/fishart.js';
import { SPECIES, SPECIES_BY_ID } from '../fish/species.js';
import { School } from '../fish/school.js';
import { Clock } from '../world/clock.js';
import { Ocean } from '../world/ocean.js';

const W = 960, H = 540;
const BG = { shallows: ['#3a9cc4', '#1f6a94'], junkyard: ['#3a5a52', '#1c2e30'], abyss: ['#141a36', '#05070f'], all: ['#2f7ea4', '#163c58'] };

function bg(g, top, bot) {
  const a = top.match(/\w\w/g).map((h) => parseInt(h, 16)), b = bot.match(/\w\w/g).map((h) => parseInt(h, 16));
  for (let y = 0; y < H; y += 4) {
    const t = y / H;
    g.fillStyle = `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(',')})`;
    g.fillRect(0, y, W, 4);
  }
}

// Scale that fits a species into a w x h box (rig geometry at scale 1).
function fitScale(sp, w, h) {
  const c = compiled(sp.look, null, sp.id);
  if (c.kind === 'chain') return Math.min(1.4, w / (c.chain.segs * c.chain.r * 1.2 + c.chain.r * 4));
  const g = rigGeom(c, { sw: 0, angle: 0, scale: 1, inflate: 0, still: true });
  return Math.min(2.4, w / g.w, h / g.h);
}

function chainPts(c, x, y, t, s, dir = 1) {
  const pts = [];
  const n = c.chain.segs, r = c.chain.r * s;
  for (let i = 0; i < n; i++) {
    const k = i / (n - 1);
    pts.push({ x: x - dir * i * r * 1.1, y: y + Math.sin(t * 2.4 - k * 5) * r * 1.3 * Math.min(1, k * 2.5) });
  }
  return pts;
}

export function run(params) {
  const cv = document.getElementById('screen');
  cv.width = W; cv.height = H;
  cv.style.width = W * 2 + 'px'; cv.style.height = H * 2 + 'px';
  const g = ctxOf(cv);
  if (params.get('style') === 'pixel') setFishStyle('pixel');
  if (params.has('budget')) setVoxelFishBudget(Number(params.get('budget')));
  const page = params.get('page') || 'all';
  const perf = { frame: 0, fish: 0, n: 0, max: 0, hist: [] };
  window.__vf = { perf, stats: voxelFishStats };
  if (page === 'ocean') return runOcean(cv, g, params, perf);
  if (page === 'bench') {
    const out = [];
    for (const [id, S] of [['honk', 1.6], ['koi', 1.4], ['grouper', 1.3], ['puffer', 5.5], ['manyeyes', 1.2], ['clickcrab', 1.7], ['glowjelly', 1.7]]) {
      const sp = SPECIES_BY_ID[id];
      const c = compiled(sp.look, null, sp.id);
      let best = null;
      for (let k = 0; k < 6; k++) { const b = benchVoxel(c, S); if (!best || b.trace < best.trace) best = b; }
      out.push([id, S, best]);
    }
    window.__vf.bench = out;
    console.log(JSON.stringify(out));
    return;
  }
  const frozen = params.has('frozen');
  if (frozen) setVoxelSync(true);
  let t = 0, last = performance.now();
  let mouse = null;
  cv.addEventListener('mousemove', (e) => { const r = cv.getBoundingClientRect(); mouse = [(e.clientX - r.left) / 2, (e.clientY - r.top) / 2]; });
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (!frozen) t += dt;
    const T0 = performance.now();
    if (page === 'features') drawFeatures(g, t, frozen, mouse);
    else drawAll(g, t, frozen, params);
    const ms = performance.now() - T0;
    perf.n++;
    perf.fish = perf.n < 5 ? ms : perf.fish * 0.95 + ms * 0.05;
    if (perf.n > 120) perf.max = Math.max(perf.max, ms);
    const st = voxelFishStats();
    drawText(g, `draw ${perf.fish.toFixed(2)} ms  max ${perf.max.toFixed(1)}  frames ${st.frames}  built ${st.built}  fb ${st.fallbacks}  jobs ${st.jobs}  warm ${st.warm}`, W - 6, H - 10, { font: 'small', align: 'right', color: '#cfe6ff', shadow: '#000' });
  }
  requestAnimationFrame(frame);
}

function drawAll(g, t, frozen, params) {
  const which = params.get('biome') || 'all';
  const ids = params.get('ids')?.split(',');
  const list = ids ? ids.map((id) => SPECIES_BY_ID[id]).filter(Boolean) : SPECIES.filter((s) => which === 'all' || s.biome === which || s.id === which);
  bg(g, ...(BG[which] || BG.all));
  const cols = Number(params.get('cols')) || (which === 'all' && !ids ? 9 : 5);
  const rows = Math.ceil(list.length / cols);
  const cw = W / cols, ch = (H - 14) / rows;
  const spin = params.has('spin');
  const yaw0 = Number(params.get('yaw') || 0);
  const k = Number(params.get('scale') || 1);
  list.forEach((sp, i) => {
    const c = compiled(sp.look, null, sp.id);
    const cx = (i % cols) * cw + cw / 2, cy = Math.floor(i / cols) * ch + ch / 2 - 4;
    const s = fitScale(sp, cw * 0.86, ch * 0.72) * k;
    const turn = spin ? Math.cos(t * 0.9 + i * 0.7) : Math.cos((yaw0 * Math.PI) / 180);
    const ft = frozen ? i * 0.13 : t;
    drawFishRig(g, c, {
      x: cx, y: cy, facing: turn >= 0 ? 1 : -1, turn, angle: 0, scale: s, swimPhase: ft * 0.9, tailPhase: ft * 1.6 + i * 0.1, finPhase: ft * 1.1,
      speed01: 0.5, inflate: 0, emotion: 'neutral', mouth: 0, time: ft, blink: 0,
      chain: c.kind === 'chain' ? chainPts(c, cx + c.chain.segs * c.chain.r * s * 0.5, cy, ft, s, 1) : null,
    });
    drawText(g, sp.name, cx, cy + ch * 0.42, { font: 'small', align: 'center', color: RARITY[sp.rarity].color, shadow: '#05070c' });
  });
}

const EMOS = ['neutral', 'happy', 'sad', 'angry', 'scared', 'surprised', 'love', 'sleepy', 'dizzy', 'smug'];

function drawFeatures(g, t, frozen, mouse) {
  bg(g, '#2a6a88', '#12283a');
  const ft = frozen ? 0.6 : t;
  const comp = (id) => { const sp = SPECIES_BY_ID[id]; return compiled(sp.look, null, sp.id); };
  // 1) yaw sweep (left -> right), koi and clownfish
  const koi = comp('koi'), honk = comp('honk'), puff = comp('puffer'), angler = comp('loadingangler'), jelly = comp('glowjelly');
  for (let j = 0; j < 7; j++) {
    const turn = 1 - (j / 6) * 2;
    drawFishRig(g, koi, { x: 60 + j * 74, y: 40, facing: turn >= 0 ? 1 : -1, turn, scale: 0.85, time: ft, swimPhase: ft, tailPhase: ft * 1.4 });
    drawFishRig(g, honk, { x: 60 + j * 74, y: 100, facing: turn >= 0 ? 1 : -1, turn, scale: 1, time: ft, swimPhase: ft, tailPhase: ft * 1.4, angle: (j - 3) * 0.12 });
  }
  drawText(g, 'yaw sweep (turn 1 -> -1) + pitch', 280, 132, { font: 'small', align: 'center', color: '#ffe9a8', shadow: '#000' });
  // 2) emotions on clownfish and pudding
  const purin = comp('purin');
  EMOS.forEach((e, j) => {
    const x = 50 + j * 54;
    drawFishRig(g, honk, { x, y: 175, scale: 0.8, time: ft + j, swimPhase: ft, tailPhase: ft * 1.3, emotion: e, mouth: e === 'happy' || e === 'surprised' ? 0.6 : 0 });
    drawFishRig(g, purin, { x, y: 228, scale: 0.75, time: ft + j, swimPhase: ft * 0.5, emotion: e, mouth: e === 'happy' ? 0.5 : 0 });
    drawText(g, e, x, 252, { font: 'small', align: 'center', color: '#cfe6ff', shadow: '#000' });
  });
  // 3) look + talk, inflate, wash, glow, silhouette
  const tx = mouse ? mouse[0] : 700 + Math.cos(ft * 1.3) * 60, ty = mouse ? mouse[1] : 60 + Math.sin(ft * 1.7) * 30;
  g.fillStyle = '#ffe066'; g.fillRect(Math.round(tx) - 1, Math.round(ty) - 1, 3, 3);
  const talk = frozen ? 0.6 : Math.abs(Math.sin(ft * 8));
  drawFishRig(g, honk, { x: 640, y: 60, scale: 1.4, time: ft, swimPhase: ft, tailPhase: ft * 1.5, lookX: tx, lookY: ty, mouth: talk, emotion: 'neutral' });
  drawFishRig(g, comp('googly'), { x: 800, y: 60, scale: 1.2, facing: -1, time: ft, swimPhase: ft, tailPhase: ft * 1.5, lookX: tx, lookY: ty, speed01: 1 });
  const inf = frozen ? 1 : Math.max(0, Math.sin(ft * 0.9));
  drawFishRig(g, puff, { x: 900, y: 70, scale: 1, time: ft, swimPhase: ft, inflate: inf, emotion: inf > 0.5 ? 'angry' : 'neutral', mouth: inf > 0.5 ? 0.4 : 0 });
  drawText(g, 'look + talk     googly      inflate', 770, 128, { font: 'small', align: 'center', color: '#ffe9a8', shadow: '#000' });
  drawFishRig(g, honk, { x: 620, y: 175, scale: 1.1, time: ft, swimPhase: ft, tailPhase: ft * 1.5, wash: { color: '#9fc8e0', alpha: 0.55 } });
  drawFishRig(g, honk, { x: 740, y: 175, scale: 1.1, time: ft, swimPhase: ft, tailPhase: ft * 1.5, wash: { color: '#05070f', alpha: 0.7 } });
  drawFishRig(g, honk, { x: 860, y: 175, scale: 1.1, time: ft, swimPhase: ft, tailPhase: ft * 1.5, silhouette: true });
  drawText(g, 'fog wash      dark wash      silhouette', 740, 214, { font: 'small', align: 'center', color: '#ffe9a8', shadow: '#000' });
  // 4) dark corner: glow
  g.fillStyle = '#060912'; g.fillRect(560, 262, 400, 140);
  drawFishRig(g, angler, { x: 640, y: 330, scale: 1.2, time: ft, swimPhase: ft, tailPhase: ft * 1.2, glow: frozen ? 1 : 0.6 + 0.4 * Math.sin(ft * 3) });
  drawFishRig(g, jelly, { x: 760, y: 320, scale: 1.3, time: ft, swimPhase: ft, glow: 1 });
  drawFishRig(g, comp('dragonfish'), { x: 890, y: 330, scale: 1, time: ft, swimPhase: ft, tailPhase: ft * 1.4, glow: 1, facing: -1 });
  drawText(g, 'glow layers in the dark', 760, 392, { font: 'small', align: 'center', color: '#ffe9a8', shadow: '#000' });
  // 5) chains + giant boss
  const noodle = comp('noodle'), cable = comp('cableeel');
  for (const [c, x0, y0, sp] of [[noodle, 280, 320, 1], [cable, 280, 400, 1.3]]) {
    const pts = [];
    for (let i = 0; i < c.chain.segs; i++) {
      const u = ft * sp - i * 0.13;
      pts.push({ x: x0 + Math.cos(u) * 160 - i * 2, y: y0 + Math.sin(u * 2) * 30 });
    }
    drawFishRig(g, c, { x: pts[0].x, y: pts[0].y, time: ft, chain: pts, emotion: c === noodle ? 'love' : 'determined', scale: 1.2 });
  }
  const boss = comp('manyeyes');
  drawFishRig(g, boss, { x: 760, y: 470, facing: -1, turn: -1, scale: 0.75, time: ft, swimPhase: ft * 0.6, tailPhase: ft * 0.8, glow: 0.7, emotion: 'angry' });
}

// ------------------------------------------------------------------ ocean composition

function makeGame(params) {
  const noop = () => {};
  const game = {
    screen: { W, H },
    audio: new Proxy({}, { get: (_, k) => (k === 'loop' ? () => ({ set: noop, stop: noop }) : noop) }),
    state: { secrets: {}, baits: {}, coins: 0, settings: { dayCycle: 'real' } },
    stats: {}, lowPower: false,
    fishing: { hook: { visible: false, x: 0, y: 0 }, busy: false },
    particles: new Proxy({}, { get: () => noop }),
    toast: noop, addCoins: noop, spendCoins: () => false, save: noop, musicFor: () => null,
  };
  game.clock = new Clock(game);
  game.clock.override = Number(params.get('hour') ?? 12);
  return game;
}

function runOcean(cv, g, params, perf) {
  const game = makeGame(params);
  const world = {
    W, H, surfaceY: 0, floorAt: (x, z = 0) => game.ocean.floorAt(x, z),
    cursor: { x: -100, y: -100, vx: 0, vy: 0, speed: 0, inWorld: false },
    hook: { x: 0, y: 0, active: false, inWater: false, bait: null, radiusMul: 1 },
    fishes: [], icons: [], windows: [], particles: game.particles, audio: game.audio, desktop: null,
    biome: params.get('biome') || 'shallows', night: false, dusk: false, weather: 'calm', hour: 12,
    secrets: {}, rarityBoost: 1, calmMul: 1, isTank: false, glowLevel: 0, rollMods: {}, populationMul: Number(params.get('pop') || 1),
  };
  game.world = world;
  const school = new School(world);
  game.school = school;
  const ocean = new Ocean(game);
  game.ocean = ocean;
  ocean.setBiome(world.biome);
  ocean.weatherT = 1e9;
  world.night = game.clock.isNight?.() ?? false;
  world.surfaceY = ocean.surfaceY?.() ?? 0;
  // populate: simulate a minute so fish are spread over the scene
  for (let i = 0; i < 60 * 20; i++) { school.update(1 / 20); }
  if (params.has('hero')) school.spawnHero(params.get('hero') ? SPECIES_BY_ID[params.get('hero')] : null)?.forEach((f) => { f.x = W * 0.3 + Math.random() * W * 0.3; f.alpha = 1; });
  let last = performance.now(), time = 0;
  const frameMs = [];
  window.__vf.ocean = { school, frameMs };
  function drawRange(list, z0, z1, L) {
    const b = ocean.biome;
    const fogColor = b.fogColor || '#2a7aa0';
    for (const f of list) {
      if (f.z < z0 || f.z >= z1) continue;
      let wash = null;
      const fog = Math.min(0.85, Math.max(0, f.z * (b.fogAmount ?? 0.75)));
      let lit = 1;
      try { lit = ocean.lightAt(f.x, f.y, L); } catch { /* biome WIP */ }
      if (z0 < 0 && L.dark > 0.02) wash = { color: L.tint || '#0a1030', alpha: Math.min(1, Math.max(0, (1 - lit) * 0.9)) };
      else if (fog > 0.03) wash = { color: fogColor, alpha: fog };
      const t0 = performance.now();
      f.draw(g, wash, time);
      const dtm = performance.now() - t0;
      fishT.sum += dtm;
      if (dtm > fishT.worst) { fishT.worst = dtm; fishT.who = f.sp.id + (f.hero ? '*' : '') + ' S' + (f.scale * (1 - f.z * 0.5)).toFixed(2); }
    }
  }
  const fishT = { sum: 0, worst: 0, who: '' };
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    time += dt;
    const T0 = performance.now();
    fishT.sum = 0; fishT.worst = 0;
    world.glowLevel = ocean.biome.lighting(ocean.env).dark;
    ocean.update(dt);
    school.update(dt);
    const sorted = school.sorted();
    const b = ocean.biome, env = ocean.env;
    const safe = (fn) => { try { fn(); } catch (e) { if (!safe.warned) { safe.warned = true; console.warn('biome art (other agent WIP):', e.message); } } };
    let back = false;
    safe(() => { b.drawBack(g, env); back = true; });
    if (!back) bg(g, ...(BG[world.biome] || BG.all));
    let L = { dark: 0, tint: '#000', lights: [] };
    safe(() => { L = ocean.lighting(); });
    drawRange(sorted, 0.66, 2, L);
    safe(() => b.drawSeabed(g, env));
    drawRange(sorted, 0.33, 0.66, L);
    safe(() => b.drawNear?.(g, env));
    safe(() => ocean.applyLighting(g, L));
    drawRange(sorted, -1, 0.33, L);
    safe(() => b.drawFront(g, env));
    const ms = performance.now() - T0;
    frameMs.push(ms);
    (window.__vf.fishLog ||= []).push([+ms.toFixed(1), +fishT.sum.toFixed(1), +fishT.worst.toFixed(1), fishT.who, voxelFishStats().spent]);
    if (window.__vf.fishLog.length > 400) window.__vf.fishLog.shift();
    if (frameMs.length > 600) frameMs.shift();
    perf.n++;
    perf.fish = perf.n < 5 ? ms : perf.fish * 0.95 + ms * 0.05;
    if (perf.n > 60) perf.max = Math.max(perf.max, ms);
    const st = voxelFishStats();
    const heroes = school.fishes.filter((f) => f.hero).length, pk = school.fishes.filter((f) => f.package).length;
    drawText(g, `frame ${perf.fish.toFixed(2)} ms  max ${perf.max.toFixed(1)}  fish ${school.fishes.length} (heroes ${heroes}, crates ${pk})  vox frames ${st.frames}  built ${st.built}  fb ${st.fallbacks}  jobs ${st.jobs}  warm ${st.warm}`, 6, H - 10, { font: 'small', color: '#ffffff', outline: '#000' });
  }
  requestAnimationFrame(frame);
}
