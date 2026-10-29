// Dev preview for the building system.
//   dist/dev/build.html?v=gallery           all building models, item art and package tiers
//   dist/dev/build.html?v=zoom&ids=a,b&s=1.2 selected building models, zoomed
//   dist/dev/build.html?v=world             real ocean + Build (stub game). Extra params:
//       b=shallows|junkyard|abyss  hour=H  rich (lots of items + buildings)  fresh (starter kit only)
//       p=inventory|research|package|building|buildtray (open a panel)  tab=<inventory tab>  mode=build
//       ghost=x,z (blueprint ghost at a fixed spot)  anim=1 (construction animation mid-way)
import { ctxOf } from '../core/canvas.js';
import { Input } from '../core/input.js';
import { audio } from '../core/audio.js';
import { rgba } from '../core/color.js';
import { drawText } from '../gfx/font.js';
import { registerUiIcons, getUiIcon, CURSOR_HOTSPOT } from '../gfx/uiicons.js';
import { Particles } from '../gfx/particles.js';
import { defaultState } from '../game/state.js';
import { computeStats } from '../game/skills.js';
import { Camera } from '../game/camera.js';
import { Clock } from '../world/clock.js';
import { Ocean } from '../world/ocean.js';
import { UI } from '../ui/ui.js';
import { SPECIES } from '../fish/species.js';
import { rollIndividual } from '../fish/traits.js';
import { buildingSprite, MODEL_IDS } from '../build/buildingmodels.js';
import { itemSprite, ART_IDS } from '../build/itemart.js';
import { drawPackage, TIER_ORDER, addItem, addPackage, ITEMS, MATERIAL_IDS } from '../build/items.js';
import { BUILDINGS, BUILDING_ORDER } from '../build/buildings.js';
import { Build } from '../build/build.js';
import { InventoryPanel } from '../ui/inventory.js';
import { ResearchPanel } from '../ui/research.js';
import { PackagePanel } from '../ui/package.js';
import { BuildTrayPanel, BuildingPanel } from '../ui/buildpanel.js';

function zoom(ctx, W, H, t, params) {
  ctx.fillStyle = '#2a6a8a';
  ctx.fillRect(0, 0, W, H);
  const ids = (params.get('ids') || [...MODEL_IDS].slice(0, 5).join(',')).split(',');
  let x = 10;
  const sc = Number(params.get('s') || 1.1);
  for (const id of ids) {
    const s = buildingSprite(id, { force: true, scale: sc });
    ctx.drawImage(s.canvas, x, H - 20 - s.h);
    x += s.w + 10;
  }
}

function gallery(ctx, W, H, t) {
  ctx.fillStyle = '#2a6a8a';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#d8c08a';
  ctx.fillRect(0, 250, W, 6);
  let x = 10;
  const ids = [...MODEL_IDS];
  ids.forEach((id, i) => {
    const s = buildingSprite(id, { force: true, scale: 0.62 });
    const row = i < 5 ? 0 : 1;
    if (i === 5) x = 10;
    const gy = row === 0 ? 250 : 500;
    if (row === 1 && i === 5) { ctx.fillStyle = '#d8c08a'; ctx.fillRect(0, 500, W, 6); }
    ctx.drawImage(s.canvas, Math.round(x + 40 - s.ox), gy - s.oy);
    drawText(ctx, BUILDINGS[id]?.name || id, x + 40, gy + 10, { align: 'center', color: '#fff', outline: '#000', font: 'small' });
    x += Math.max(100, s.w + 20);
  });
  let ix = 10;
  for (const id of ART_IDS) {
    const s = itemSprite(id, { frame: Math.floor(t * 6), force: true });
    if (s) ctx.drawImage(s.canvas, ix, 268);
    ix += 44;
  }
  TIER_ORDER.forEach((tier, i) => {
    drawPackage(ctx, 760 + i * 46, 300, tier, t, { scale: 1 });
    drawPackage(ctx, 760 + i * 46, 360, tier, t, { scale: 0.6 });
  });
}

// ---------------------------------------------------------------- stub game with the real ocean
function makeGame(cv, W, H, params) {
  const st = defaultState();
  st.coins = Number(params.get('coins') ?? 4200);
  st.tutorialDone = true;
  st.biome = params.get('b') || 'shallows';
  st.settings.dayCycle = 'real';
  const listeners = {};
  const g = {
    params, canvas: cv, screen: { W, H, scale: 2 }, state: st, audio, particles: new Particles(900), time: 0,
    lowPower: false, muted: false, paused: false,
    fishing: { fighting: false, busy: false, hook: { visible: false, x: 0, y: 0 }, releaseFish() {} },
    school: { fishes: [] },
    world: { cursor: { x: -100, y: -100, vx: 0, vy: 0, speed: 0, inWorld: true }, glowLevel: 0, rollMods: {} },
    aquarium: { addDecor(id) { st.tank.decor.push({ id, x: 0.5, z: 0.5 }); return true; } },
    tutorial: { active: false },
    on(ev, fn) { (listeners[ev] ||= []).push(fn); },
    emit(ev, d) { for (const f of listeners[ev] || []) f(d); },
    save() {}, musicFor: () => null,
    toast(text, icon, time) { g.ui.toast(text, icon, time); },
    spendCoins(n) { if (st.coins < n) { audio.play('ui_error'); return false; } st.coins -= n; return true; },
    addCoins(n, x, y) { st.coins += n; if (x !== undefined) for (let i = 0; i < Math.min(6, Math.ceil(n / 3)); i++) g.ui.coinFly(x + Math.random() * 8 - 4, y + Math.random() * 8 - 4, n / 6); },
    equip(kind, id) { st.equipped = { kind, id }; audio.play('ui_click'); },
    keepFish(rec) { st.fish.push({ ...rec, inTank: st.fish.filter((f) => f.inTank).length < 8 }); },
    releaseFish() { st.coins += 10; return 10; },
    setView(v) { st.view = v; },
  };
  g.stats = computeStats(st.skills);
  const toLogical = (cx, cy) => { const r = cv.getBoundingClientRect(); return [((cx - r.left) / r.width) * W, ((cy - r.top) / r.height) * H]; };
  g.input = new Input(cv, toLogical);
  g.camera = new Camera(g);
  g.clock = new Clock(g);
  if (params.has('hour')) g.clock.override = Number(params.get('hour'));
  g.ocean = new Ocean(g);
  g.ocean.setBiome(st.biome);
  g.ocean.weatherT = 1e9;
  g.ui = new UI(g);
  for (const P of [InventoryPanel, ResearchPanel, PackagePanel, BuildTrayPanel, BuildingPanel]) g.ui.register(new P());
  g.build = new Build(g);
  g.dockItems = g.build.dockItems();
  if (params.has('rich')) enrich(g, W);
  return g;
}

function enrich(g, W) {
  const st = g.state;
  for (const id of MATERIAL_IDS) addItem(st, id, 3 + Math.floor(Math.random() * 18));
  addItem(st, 'fish_egg', 3);
  for (const id of ['bp_coral_garden', 'bp_lighthouse', 'bp_arcade', 'bp_totem', 'bp_vault', 'bp_bubble_tower', 'bp_castle', 'bp_pagoda_lantern']) addItem(st, id, 1 + (id === 'bp_coral_garden' ? 1 : 0));
  for (const id of ['moai_head', 'lava_lamp', 'rubber_duck', 'crystal_cluster', 'pirate_ship']) addItem(st, id, 1);
  const cos = Object.keys(ITEMS).filter((id) => ITEMS[id].kind === 'cosmetic');
  for (const id of cos.slice(0, 6)) addItem(st, id, 1);
  st.baits = { bread: 5, worm: 3, golden: 1, lantern: 2, chip: 4 };
  for (const t of ['crate', 'iron', 'golden', 'orb', 'crate']) addPackage(st, t, { species: 'puffer' });
  const now = Date.now();
  const put = (id, x, z, extra = {}) => st.buildings.push({ uid: id + x, id, x, z, flip: false, lvl: 1, built: now - 3600e3, prod: now - 3600e3, on: true, ...extra });
  put('research_lab', Math.round(W * 0.22), 0.3, { lvl: 2 });
  put('lighthouse', Math.round(W * 0.08), 0.75);
  put('coral_garden', Math.round(W * 0.42), 0.55);
  put('bubble_tower', Math.round(W * 0.58), 0.9);
  put('arcade', Math.round(W * 0.7), 0.42);
  put('totem', Math.round(W * 0.5), 0.2);
  if (g.params.has('all')) {
    put('bait_workshop', Math.round(W * 0.3), 0.85);
    put('hatchery', Math.round(W * 0.84), 0.6);
    put('vault', Math.round(W * 0.62), 0.25);
    put('shell_shack', Math.round(W * 0.9), 1.05);
  }
  st.research.done = { marine_bio: now, eng1: now, coral_prop: now };
  st.research.active = [{ id: 'tinkering', start: now - 200e3, end: now + 280e3 }, { id: 'bubble_physics', start: now - 500e3, end: now - 1 }];
  st.vault.coins = 900;
  for (let i = 0; i < 6; i++) { const sp = SPECIES[i * 3 % SPECIES.length]; st.fish.push({ ...rollIndividual(sp), inTank: i < 4, caughtAt: now - i * 1000 }); }
}

function drawWorldView(ctx, g, t, dt, params) {
  const W = g.screen.W, H = g.screen.H, oc = g.ocean, env = oc.env, B = g.build;
  g.camera.apply(ctx);
  oc.biome.drawBack(ctx, env);
  let L = oc.lighting();
  oc.biome.drawSeabed(ctx, env);
  B.drawWorld(ctx, env, 'far');
  oc.biome.drawNear?.(ctx, env);
  B.drawWorld(ctx, env, 0);
  g.particles.draw(ctx, 'bg', g.time);
  B.addLights(L);
  oc.applyLighting(ctx, L);
  g.particles.draw(ctx, 'fg', g.time);
  oc.biome.drawFront(ctx, env);
  g.camera.reset(ctx);
  // dock buttons (as the orchestrator would place them)
  let x = W - 20;
  for (const it of g.dockItems.slice().reverse()) {
    x -= it.w;
    const fy = Math.min(oc.floorAt(x + it.w / 2) + 6, H - 8);
    it.rect = { x, y: fy - 34, w: it.w, h: 34 };
    it.ground = fy;
    x -= 10;
  }
  g.ui.setDock(g.dockItems);
  B.drawUi(ctx);
  g.ui.drawHud(ctx, dt);
  g.ui.drawPanels(ctx, dt);
  g.particles.draw(ctx, 'ui', g.time);
  g.ui.drawToasts(ctx);
  g.ui.drawTip(ctx);
  void t; void params;
}

export function run(params) {
  const W = Number(params.get('w')) || 960, H = Number(params.get('h')) || 540;
  const cv = document.getElementById('screen');
  cv.width = W; cv.height = H;
  cv.style.width = W * 2 + 'px'; cv.style.height = H * 2 + 'px';
  const ctx = ctxOf(cv);
  registerUiIcons();
  const v = params.get('v') || 'world';
  let g = null;
  if (v === 'world') {
    g = makeGame(cv, W, H, params);
    window.FISHTOP = g;
    const p = params.get('p');
    if (params.get('mode') === 'build') g.build.toggle(true);
    if (p === 'building') g.ui.open('building', { uid: g.state.buildings.find((b) => b.id === (params.get('id') || 'arcade'))?.uid });
    else if (p) g.ui.open(p, p === 'inventory' && params.get('tab') ? { tab: params.get('tab') } : p === 'package' ? { tier: params.get('tier') || 'golden' } : undefined);
    if (params.get('anim')) {
      const b = g.state.buildings.find((q) => q.id === 'research_lab') || g.state.buildings[0];
      if (b) g.build.anims.set(b.uid, { t: Number(params.get('anim')) * 2.8, dur: 2.8, kind: 'build' });
    }
  }
  let t = 0, last = performance.now();
  const frame = (now) => {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000); last = now; t += dt;
    try {
      if (v === 'zoom') zoom(ctx, W, H, t, params);
      else if (v === 'gallery') gallery(ctx, W, H, t);
      else {
        const inp = g.input;
        inp.update(dt);
        g.time += dt;
        g.camera.update(dt);
        const c = g.world.cursor;
        [c.x, c.y] = g.camera.screenToWorld(inp.x, inp.y);
        g.world.glowLevel = g.ocean.biome.lighting(g.ocean.env).dark;
        g.ui.update(dt);
        g.ocean.update(dt);
        const layer = g.ui.hit(inp.x, inp.y) ? 'ui' : (g.build.active || g.build.hit(c.x, c.y)) ? 'build' : null;
        if (params.get('ghost') && g.build.active) {
          const [gx, gz] = params.get('ghost').split(',').map(Number);
          g.build.setDepth(gz);
          inp.x = gx; inp.y = 300; inp.inside = true;
        }
        g.build.update(dt, inp, layer);
        g.particles.update(dt);
        if (inp.keyPressed('Escape') && g.build.active && !g.ui.stack.some((q) => q.modal !== false)) g.build.toggle(false);
        if (inp.keyPressed('i')) g.ui.togglePanel('inventory');
        if (inp.keyPressed('u')) g.build.toggle();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        drawWorldView(ctx, g, t, dt, params);
        drawText(ctx, `${Math.round(g.state.coins)} coins  layer:${layer}`, 6, H - 10, { font: 'small', color: '#ffffff', shadow: rgba('#000000', 0.6) });
        if (inp.inside) { const cur = getUiIcon('cursor'); const hs = CURSOR_HOTSPOT.cursor; ctx.drawImage(cur, Math.round(inp.x) - hs[0], Math.round(inp.y) - hs[1]); }
        inp.endFrame();
      }
    } catch (e) { console.error(e); }
  };
  requestAnimationFrame(frame);
}

void BUILDING_ORDER;
