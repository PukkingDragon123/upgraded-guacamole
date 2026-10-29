// Dev preview of the menu panels with a stub game: dist/dev/panels.html?p=shop|skills|journal|map|settings|welcome
//   &coins=N  &fresh (empty save)  &rich (lots of progress)  &hl=hook1 (skills highlight)  &sp=<species id>
//   &biome=junkyard (journal tab / current location)  &forecast  &away=seconds  &w=800&h=450 (logical size)
//   shop:   &tab=bait|decor|cosmetics|specials  &item=<id> (open the counter close-up)  &puff (Cap'n Bloat puffs up)
//   skills: &sel=<skill id> (select)  &z=2 (zoom level, centred on the selection)
import { ctxOf } from '../core/canvas.js';
import { Input } from '../core/input.js';
import { audio } from '../core/audio.js';
import { rgba } from '../core/color.js';
import { Particles } from '../gfx/particles.js';
import { getUiIcon, registerUiIcons, CURSOR_HOTSPOT } from '../gfx/uiicons.js';
import { drawText } from '../gfx/font.js';
import { defaultState } from '../game/state.js';
import { computeStats, SKILL_BY_ID, skillStatus, SKILLS } from '../game/skills.js';
import { BAITS } from '../game/shopdata.js';
import { SPECIES } from '../fish/species.js';
import { UI } from '../ui/ui.js';
import { registerPanels } from '../ui/registry.js';

let W = 960, H = 540;

function sampleState(params) {
  const st = defaultState();
  if (params.has('fresh')) return st;
  st.coins = Number(params.get('coins') ?? 1850);
  const rich = params.has('rich');
  const own = rich
    ? SKILLS.filter((s) => !s.id.startsWith('breed') && !['exp3', 'exp4', 'hook8', 'tank8', 'line5', 'reel5', 'bait6'].includes(s.id)).map((s) => s.id)
    : ['hook1', 'hook2', 'hook3', 'line1', 'line2', 'reel1', 'mouse1', 'mouse2', 'bait1', 'bait2', 'tank1', 'hook5', 'exp1'];
  for (const id of own) st.skills[id] = true;
  st.unlockedBiomes = ['shallows', 'junkyard'];
  st.biome = params.get('biome') || 'shallows';
  st.baits = { bread: 3, worm: 2 };
  st.tank.decor = [{ id: 'rock_small', x: 0.3, z: 0.5 }, { id: 'coral_brain', x: 0.6, z: 0.4 }];
  const day = 86400000;
  SPECIES.forEach((sp, i) => {
    const caught = sp.biome === 'shallows' ? i % 5 !== 3 && sp.rarity !== 'legendary' : sp.biome === 'junkyard' ? i % 3 === 0 : rich && i % 4 === 0;
    const seen = !caught && (i % 2 === 0 || sp.biome === 'shallows');
    if (!caught && !seen) return;
    const n = caught ? 1 + (i * 7) % 23 : 0;
    st.journal[sp.id] = {
      seen: true, caught: n, maxSize: caught ? sp.size[1] * 0.92 : 0, minSize: caught ? sp.size[0] * 1.1 : 9999,
      first: Date.now() - (i + 1) * day * 1.7, variants: caught && i % 4 === 0 ? { shiny: i % 8 === 0, neon: true, albino: i % 3 === 0 } : {},
    };
  });
  return st;
}

function makeGame(canvas, params) {
  const st = sampleState(params);
  const listeners = {};
  const g = {
    params, canvas,
    screen: { W, H, scale: 2 },
    state: st,
    audio,
    particles: new Particles(900),
    time: 0,
    lowPower: false,
    muted: false,
    fishing: { fighting: false, busy: false },
    camera: { shake() {}, flash() {} },
    desktop: { restoreAll() { g.toast('All icons are back on the desktop.', 'home'); }, iconById: () => null },
    aquarium: { addDecor(id) { st.tank.decor.push({ id, x: 0.5, z: 0.5 }); return true; } },
    clock: { hour: () => 14, isNight: () => false },
    ocean: {
      biome: { id: st.biome, name: { shallows: 'Sunny Shallows', junkyard: 'Junkyard Reef', abyss: 'The Midnight Abyss' }[st.biome] },
      weather: params.get('weather') || 'storm', weatherT: 214, travelState: null,
      weatherName() { return { sunny: 'Sunny', storm: 'Storm', rain: 'Rain', cloudy: 'Cloudy' }[this.weather] || 'Calm'; },
    },
    on(ev, fn) { (listeners[ev] ||= []).push(fn); },
    off(ev, fn) { listeners[ev] = (listeners[ev] || []).filter((f) => f !== fn); },
    emit(ev, data) { for (const f of listeners[ev] || []) f(data); },
    recomputeStats() { g.stats = computeStats(st.skills); if (params.has('forecast')) g.stats.forecast = 1; },
    save() {},
    toast(text, icon) { g.ui.toast(text, icon); },
    applyVolumes() { audio.setVolumes?.({ master: st.settings.master, music: st.settings.music, sfx: st.settings.sfx, ambience: st.settings.ambience }); },
    speciesFound() { return Object.values(st.journal).filter((j) => j.caught > 0).length; },
    tankCount() { return 3; },
    spendCoins(n) { if (st.coins < n) { audio.play('ui_error'); return false; } st.coins -= n; return true; },
    addCoins(n, x, y) {
      st.coins += n;
      if (x !== undefined) for (let i = 0; i < Math.min(6, Math.ceil(n / 3)); i++) g.ui.coinFly(x + Math.random() * 8 - 4, y + Math.random() * 8 - 4, n / 6);
    },
    unlockSkill(id) {
      const sk = SKILL_BY_ID[id];
      const s = skillStatus(sk, st, g.speciesFound());
      if (s.status !== 'available') { audio.play('ui_error'); g.toast(s.reason || 'Locked', 'lock'); return false; }
      if (!g.spendCoins(sk.cost)) { g.toast('Not enough coins.', 'coin'); return false; }
      st.skills[id] = true;
      g.recomputeStats();
      audio.play('ui_unlock');
      if (sk.effect.unlockBiome && !st.unlockedBiomes.includes(sk.effect.unlockBiome)) st.unlockedBiomes.push(sk.effect.unlockBiome);
      g.emit('skill', id);
      return true;
    },
    buyBait(id) {
      const it = BAITS[id];
      if (!it || !g.stats.unlockBait.has(id)) return false;
      if (!g.spendCoins(it.price)) { g.toast('Not enough coins.', 'coin'); return false; }
      st.baits[id] = (st.baits[id] || 0) + it.qty;
      audio.play('ui_buy');
      g.emit('buy', id);
      return true;
    },
    travel(id) {
      if (!st.unlockedBiomes.includes(id)) return false;
      g.ui.stack = [];
      st.biome = id;
      g.ocean.biome = { id, name: id };
      g.toast('Travelling to ' + id + '...', 'map');
      return true;
    },
    command(id) {
      if (id === 'restore') g.desktop.restoreAll();
      else if (g.ui.panels[id]) g.ui.toggle(id);
    },
  };
  g.recomputeStats();
  if (params.get('p') === 'welcome' || params.has('away')) g.pendingWelcome = { away: Number(params.get('away') || 8040), coins: Number(params.get('gain') || 1284) };
  return g;
}

function backdrop(ctx, t) {
  for (let y = 0; y < H; y += 2) {
    const k = y / H;
    ctx.fillStyle = `rgb(${Math.round(58 - 40 * k)},${Math.round(160 - 90 * k)},${Math.round(190 - 80 * k)})`;
    ctx.fillRect(0, y, W, 2);
  }
  ctx.fillStyle = 'rgba(255,255,255,0.05)';
  for (let i = 0; i < 7; i++) {
    const x0 = 80 + i * 140 + Math.sin(t * 0.3 + i) * 10;
    ctx.beginPath();
    ctx.moveTo(x0, 0); ctx.lineTo(x0 + 40, 0); ctx.lineTo(x0 - 60, H); ctx.lineTo(x0 - 120, H);
    ctx.fill();
  }
  ctx.fillStyle = '#d8c08a';
  for (let x = 0; x < W; x += 2) ctx.fillRect(x, Math.round(H - 40 - Math.sin(x * 0.01) * 6), 2, 60);
}

export function run(params) {
  W = Number(params.get('w')) || 960; H = Number(params.get('h')) || 540;
  const cv = document.getElementById('screen');
  cv.width = W; cv.height = H;
  cv.style.width = W * 2 + 'px'; cv.style.height = H * 2 + 'px';
  window.__size = [W, H];
  const ctx = ctxOf(cv);
  registerUiIcons();
  const toLogical = (cx, cy) => {
    const r = cv.getBoundingClientRect();
    return [((cx - r.left) / r.width) * W, ((cy - r.top) / r.height) * H];
  };
  const g = makeGame(cv, params);
  g.input = new Input(cv, toLogical);
  g.ui = new UI(g);
  registerPanels(g.ui);
  window.FISHTOP = g;
  const p = params.get('p') || 'skills';
  const data = p === 'skills' && params.get('hl') ? { highlight: params.get('hl') } : p === 'journal' && params.get('sp') ? { species: params.get('sp') } : p === 'shop' && params.get('tab') ? { tab: params.get('tab') } : undefined;
  g.ui.open(p, data);
  const panel = g.ui.panels[p];
  if (p === 'shop') {
    const id = params.get('item');
    if (id) {
      setTimeout(() => {
        for (const tab of ['bait', 'decor', 'cosmetics', 'specials']) {
          const it = panel.items(tab).find((q) => q.id === id);
          if (it) { panel.tab = tab; panel.select(it); break; }
        }
      }, 300);
    }
    if (params.has('puff')) setTimeout(() => { panel.say('HMPH! Puffed up for the camera.', 'angry'); panel.puffUp(); }, 600);
  }
  if (p === 'skills') {
    if (params.get('sel')) panel.sel = params.get('sel');
    const z = Number(params.get('z'));
    if (z) setTimeout(() => { panel.zoomTo(z, panel.view); if (panel.sel) panel.focusTile(panel.sel, panel.view); }, 200);
  }
  let last = performance.now();
  const frame = (now) => {
    requestAnimationFrame(frame);
    const dt = Math.max(0, Math.min(0.05, (now - last) / 1000));
    last = now;
    g.time += dt;
    try {
      g.input.update(dt);
      g.ui.update(dt);
      g.particles.update(dt);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      backdrop(ctx, g.time);
      g.ui.tip = null;
      if (!g.ui.stack.length && g.input.pressed) { g.input.pressed = false; g.ui.open(p, data); }
      g.ui.drawPanels(ctx, dt);
      g.particles.draw(ctx, 'ui', g.time);
      g.ui.drawToasts(ctx);
      // coin flyers (normally drawn by the HUD)
      for (const f of g.ui.flyers) {
        const k = Math.min(1, f.t / f.dur);
        ctx.drawImage(getUiIcon('coin'), Math.round(f.x0 + (f.x1 - f.x0) * k * k * k - 4), Math.round(f.y0 + (f.y1 - f.y0) * k * k * k - Math.sin(k * Math.PI) * 30 - 4));
      }
      g.ui.drawTip(ctx);
      drawText(ctx, `${Math.round(g.state.coins)} coins  [${p}]`, 6, H - 10, { font: 'small', color: '#ffffff', shadow: rgba('#000000', 0.6) });
      const cur = getUiIcon('cursor');
      const hs = CURSOR_HOTSPOT.cursor;
      if (g.input.inside) ctx.drawImage(cur, Math.round(g.input.x) - hs[0], Math.round(g.input.y) - hs[1]);
    } catch (e) {
      console.error(e);
    }
    g.input.endFrame();
  };
  requestAnimationFrame(frame);
}
