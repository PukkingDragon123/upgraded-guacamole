// Dev preview of the 3D voxel world map: dist/dev/mapview.html
//   &yaw=0..5 (rotation index)  &state=fresh|mid|all (unlocked locations)  &biome=<current id>
//   &hover=<id> (force hover highlight)  &sel=<id>  &sail=<id> (start sailing there)  &forecast
//   &bake (raw baked diorama + timings, no panel)  &w=960&h=540 (logical size)
// window.FISHTOP = stub game (FISHTOP.ui.open('map'), FISHTOP.ui.panels.map.setYaw(i) ...)
import { ctxOf } from '../core/canvas.js';
import { Input } from '../core/input.js';
import { audio } from '../core/audio.js';
import { rgba } from '../core/color.js';
import { getUiIcon, registerUiIcons, CURSOR_HOTSPOT } from '../gfx/uiicons.js';
import { drawText } from '../gfx/font.js';
import { defaultState } from '../game/state.js';
import { computeStats } from '../game/skills.js';
import { SPECIES } from '../fish/species.js';
import { UI } from '../ui/ui.js';
import { MapPanel, MAP_YAWS, __mapDev } from '../ui/mappanel.js';

let W = 960, H = 540;

const PRESETS = {
  fresh: { biomes: ['shallows'], skills: ['hook1'] },
  mid: { biomes: ['shallows', 'junkyard', 'fjord'], skills: ['hook1', 'hook2', 'hook3', 'hook5', 'exp1', 'exp7'] },
  all: { biomes: ['shallows', 'junkyard', 'abyss', 'fjord', 'volcano', 'metropolis'], skills: ['hook1', 'hook2', 'hook3', 'hook5', 'hook7', 'exp1', 'exp3', 'exp5'] },
};

function makeGame(params) {
  const st = defaultState();
  const pre = PRESETS[params.get('state') || 'mid'] || PRESETS.mid;
  st.unlockedBiomes = [...pre.biomes];
  for (const s of pre.skills) st.skills[s] = true;
  st.biome = params.get('biome') || 'shallows';
  SPECIES.forEach((sp, i) => {
    if (sp.biome === 'shallows' ? i % 4 !== 3 : i % 3 === 0) st.journal[sp.id] = { seen: true, caught: 1 + (i % 5), maxSize: 0, minSize: 9999, first: Date.now(), variants: {} };
  });
  const listeners = {};
  const g = {
    params, screen: { W, H, scale: 2 }, state: st, audio, time: 0,
    fishing: { fighting: false, busy: false },
    ocean: {
      biome: { id: st.biome, weathers: [{ id: 'sunny', name: 'Sunny' }] }, weather: 'sunny', weatherT: 214, travelState: null,
      weatherName() { return 'Sunny'; },
    },
    on(ev, fn) { (listeners[ev] ||= []).push(fn); },
    emit(ev, d) { for (const f of listeners[ev] || []) f(d); },
    speciesFound() { return Object.values(st.journal).filter((j) => j.caught > 0).length; },
    travel(id) {
      if (!st.unlockedBiomes.includes(id)) return false;
      g.ui.stack = [];
      st.biome = id;
      g.ocean.biome = { id };
      g.ui.toast('Travelling to ' + id + '...', 'map');
      return true;
    },
  };
  g.stats = computeStats(st.skills);
  if (params.has('forecast')) g.stats.forecast = 1;
  return g;
}

function backdrop(ctx) {
  for (let y = 0; y < H; y += 2) {
    const k = y / H;
    ctx.fillStyle = `rgb(${Math.round(30 - 20 * k)},${Math.round(90 - 50 * k)},${Math.round(130 - 60 * k)})`;
    ctx.fillRect(0, y, W, 2);
  }
}

function runBake(ctx, params) {
  const t0 = performance.now();
  if (params.has('nowater')) __mapDev.DEBUG.noWater = true;
  const dio = __mapDev.getDio();
  const t1 = performance.now();
  const yaw = MAP_YAWS[Number(params.get('yaw') ?? 4)];
  const scale = Number(params.get('scale') || 2.4);
  const bk = __mapDev.getBake(scale, yaw);
  const t2 = performance.now();
  if (params.has('all')) {
    const times = MAP_YAWS.map((y) => { const a = performance.now(); const b = __mapDev.bakeView(dio, y, scale); return `${y}:${Math.round(performance.now() - a)}(${b.ms.join('/')})`; });
    window.__all = times.join(' ');
  }
  backdrop(ctx);
  ctx.drawImage(bk.canvas, Math.round((W - bk.W) / 2), Math.round((H - bk.H) / 2));
  const info = `model ${Math.round(t1 - t0)}ms (${dio.model.palette.length} pal)  bake ${Math.round(t2 - t1)}ms [render ${bk.ms[0]} water ${bk.ms[1]}]  ${bk.W}x${bk.H} ok=${bk.ok}`;
  drawText(ctx, info, 6, 6, { color: '#ffffff', shadow: '#000000' });
  window.__mapInfo = info;
  console.log(info);
}

export function run(params) {
  W = Number(params.get('w')) || 960; H = Number(params.get('h')) || 540;
  const cv = document.getElementById('screen');
  cv.width = W; cv.height = H;
  cv.style.width = W * 2 + 'px'; cv.style.height = H * 2 + 'px';
  const ctx = ctxOf(cv);
  registerUiIcons();
  if (params.has('bake')) { runBake(ctx, params); return; }
  const toLogical = (cx, cy) => {
    const r = cv.getBoundingClientRect();
    return [((cx - r.left) / r.width) * W, ((cy - r.top) / r.height) * H];
  };
  const g = makeGame(params);
  g.input = new Input(cv, toLogical);
  g.ui = new UI(g);
  g.ui.register(new MapPanel());
  window.FISHTOP = g;
  window.__mapDev = __mapDev;
  const panel = g.ui.panels.map;
  const t0 = performance.now();
  g.ui.open('map');
  window.__openMs = Math.round(performance.now() - t0);
  console.log('map open ms', window.__openMs);
  if (params.has('yaw')) { panel.yawI = Number(params.get('yaw')); }
  if (params.get('hover')) panel.debugHover = params.get('hover');
  if (params.get('sel')) panel.sel = params.get('sel');
  if (params.get('sail')) setTimeout(() => panel.trySail({ id: params.get('sail') }), 300);
  let last = performance.now(), frames = 0, worst = 0;
  const frame = (now) => {
    requestAnimationFrame(frame);
    const dt = Math.max(0, Math.min(0.05, (now - last) / 1000));
    worst = Math.max(worst, now - last);
    last = now;
    g.time += dt;
    const f0 = performance.now();
    try {
      g.input.update?.(dt);
      g.ui.update(dt);
      backdrop(ctx);
      g.ui.tip = null;
      if (!g.ui.stack.length && g.input.pressed) { g.input.pressed = false; g.ui.open('map'); }
      g.ui.drawPanels(ctx, dt);
      g.ui.drawToasts(ctx);
      g.ui.drawTip(ctx);
      const cur = getUiIcon('cursor'), hs = CURSOR_HOTSPOT.cursor;
      if (g.input.inside) ctx.drawImage(cur, Math.round(g.input.x) - hs[0], Math.round(g.input.y) - hs[1]);
    } catch (e) {
      console.error(e);
    }
    frames++;
    window.__frameMs = Math.round((performance.now() - f0) * 10) / 10;
    window.__frames = frames;
    drawText(ctx, `open ${window.__openMs}ms  frame ${window.__frameMs}ms`, 4, H - 8, { font: 'small', color: rgba('#ffffff', 0.6) });
    g.input.endFrame();
  };
  requestAnimationFrame(frame);
}
