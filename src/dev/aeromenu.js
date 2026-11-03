// Dev preview of the Aero desktop menu on a live Desktop with a stub game: dist/dev/aeromenu.html
//   ?p=desk (default) | icons (icon sheet)   &open=<panel id> (open a panel)   &start (start menu open)
//   &lab (Lab research done badge)   &items=N (new Satchel items)   &tut=<id,id> (tutorial shows only these)
//   &win=<app> (open an app window)   &coins=N   &away=seconds (welcome panel)   &view=aquarium
import { ctxOf } from '../core/canvas.js';
import { Input } from '../core/input.js';
import { audio } from '../core/audio.js';
import { Particles } from '../gfx/particles.js';
import { getUiIcon, registerUiIcons, CURSOR_HOTSPOT } from '../gfx/uiicons.js';
import { drawText } from '../gfx/font.js';
import { MENU_ICON_IDS, getBigIcon } from '../gfx/bigicons.js';
import { defaultState } from '../game/state.js';
import { UI } from '../ui/ui.js';
import { Desktop } from '../desktop/desktop.js';
import { Wallpaper } from '../desktop/wallpaper.js';
import { drawAeroPanel, drawAeroButton } from '../ui/aero.js';
import { SettingsPanel } from '../ui/settings.js';
import { WelcomePanel } from '../ui/welcome.js';
import { JournalPanel } from '../ui/journal.js';
import { InventoryPanel } from '../ui/inventory.js';
import { SPECIES } from '../fish/species.js';
import { addItem } from '../build/items.js';

let W = 960, H = 540;

// placeholder for panels other agents own (so their menu bubbles show up)
class StubPanel {
  constructor(id, title) { this.id = id; this.title = title; this.modal = true; }
  draw(ctx, ui) {
    const w = 360, h = 220;
    const r = { x: Math.round((W - w) / 2), y: Math.round((H - h) / 2), w, h };
    this.rect = r;
    drawAeroPanel(ctx, r.x, r.y, w, h, { tone: 'sky', title: this.title });
    if (ui.button(ctx, r.x + w - 24, r.y + 6, 17, 17, '', { icon: 'cross' })) ui.close(this.id);
    drawAeroButton(ctx, r.x + 20, r.y + 40, 120, 22, { label: 'Placeholder', tone: 'green' });
  }
}

function makeGame(canvas, params) {
  const st = defaultState();
  st.tutorialDone = true;
  st.coins = Number(params.get('coins') ?? 1250);
  st.view = params.get('view') || 'ocean';
  SPECIES.forEach((sp, i) => { if (i % 3 === 0) st.journal[sp.id] = { seen: true, caught: 1 + (i % 7), maxSize: sp.size[1] * 0.9, minSize: sp.size[0], first: Date.now() - i * 8e7, variants: i % 6 === 0 ? { shiny: true } : {} }; });
  const listeners = {};
  const g = {
    params, canvas, screen: { W, H, scale: 2 }, state: st, audio, particles: new Particles(900),
    time: 0, paused: false, muted: false, trashFull: false, lowPower: false,
    fishing: { fighting: false, busy: false },
    camera: { shake() {}, flash() {} },
    world: { cursor: { x: -100, y: -100 } },
    clock: { realNow: () => Date.now(), hour: () => 14.5, isNight: () => false },
    stats: { boxSlots: 4, tankCap: 6, offlineMul: 0.2 },
    on(ev, fn) { (listeners[ev] ||= []).push(fn); },
    emit(ev, data) { for (const f of listeners[ev] || []) f(data); },
    save() {},
    applyVolumes() {},
    toast(text, icon) { g.ui.toast(text, icon); },
    coinDisplay() { return Math.floor(g.ui.coinShown).toLocaleString('en'); },
    clockTooltip: () => 'Sunny Shallows',
    addCoins(n, x, y) { st.coins += n; if (x !== undefined) for (let i = 0; i < Math.min(6, Math.ceil(n / 3)); i++) g.ui.coinFly(x, y, n); },
    spendCoins(n) { if (st.coins < n) return false; st.coins -= n; return true; },
    command(id) {
      if (id === 'tank') { st.view = st.view === 'aquarium' ? 'ocean' : 'aquarium'; g.toast(st.view === 'aquarium' ? 'Aquarium' : 'Ocean', 'tank'); return; }
      if (id === 'pause') { g.paused = !g.paused; return; }
      if (id === 'mute') { g.muted = !g.muted; return; }
      if (g.ui.panels[id]) g.ui.togglePanel(id); else g.toast(`(${id})`, 'info');
    },
  };
  return g;
}

function iconSheet(ctx) {
  const grd = ctx.createLinearGradient(0, 0, 0, H);
  grd.addColorStop(0, '#8fdcff'); grd.addColorStop(0.5, '#2f9ee0'); grd.addColorStop(1, '#0d4f8f');
  ctx.fillStyle = grd; ctx.fillRect(0, 0, W, H);
  [...MENU_ICON_IDS, 'mycomputer', 'recycle'].forEach((id, i) => {
    const x = 20 + (i % 12) * 78;
    const a = getBigIcon(id, { size: 'menu' });
    ctx.drawImage(a.canvas, x, 20);
    drawText(ctx, id, x, 64, { font: 'small', color: '#ffffff', shadow: '#0a3e74' });
    ctx.drawImage(a.canvas, 0, 0, a.canvas.width, a.canvas.height, x - 8, 80, a.canvas.width * 2, a.canvas.height * 2);
    const c = getBigIcon(id, { size: 18 });
    ctx.drawImage(c.canvas, x, 170);
  });
}

export function run(params) {
  W = Number(params.get('w')) || 960; H = Number(params.get('h')) || 540;
  const cv = document.getElementById('screen');
  cv.width = W; cv.height = H;
  cv.style.width = W * 2 + 'px'; cv.style.height = H * 2 + 'px';
  cv.style.imageRendering = 'pixelated';
  const ctx = ctxOf(cv);
  registerUiIcons();
  const p = params.get('p') || 'desk';
  if (p === 'icons') { iconSheet(ctx); window.__ready = true; return; }
  const toLogical = (cx, cy) => {
    const r = cv.getBoundingClientRect();
    return [((cx - r.left) / r.width) * W, ((cy - r.top) / r.height) * H];
  };
  const g = makeGame(cv, params);
  g.input = new Input(cv, toLogical);
  g.ui = new UI(g);
  for (const P of [SettingsPanel, WelcomePanel, JournalPanel, InventoryPanel]) { try { g.ui.register(new P()); } catch (e) { console.error(e); } }
  for (const [id, title] of [['lab', 'The Lab'], ['wardrobe', 'Wardrobe'], ['map', 'Map'], ['bait', 'Bait'], ['multiplayer', 'Friends']]) g.ui.register(new StubPanel(id, title));
  if (params.get('tut')) { const ok = new Set(params.get('tut').split(',')); g.tutorial = { dockVisible: (id) => ok.has(id) }; }
  g.desktop = new Desktop(g);
  g.wallpaper = new Wallpaper(g);
  window.FISHTOP = g;
  if (params.has('lab')) setTimeout(() => g.emit('labDone', 'x'), 50);
  if (params.get('items')) setTimeout(() => { for (let i = 0; i < Number(params.get('items')); i++) addItem(g.state, 'shell', 1); }, 100);
  if (params.get('open')) setTimeout(() => g.ui.open(params.get('open'), params.has('away') ? { away: Number(params.get('away')), coins: 1234 } : undefined), 200);
  if (params.has('start')) setTimeout(() => { g.desktop.startOpen = true; }, 100);
  if (params.get('win')) setTimeout(() => g.desktop.openApp(params.get('win')), 100);
  let last = performance.now();
  const frame = (now) => {
    requestAnimationFrame(frame);
    const dt = Math.max(0, Math.min(0.05, (now - last) / 1000));
    last = now;
    g.time += dt;
    try {
      const inp = g.input;
      inp.update(dt);
      g.ui.update(dt);
      g.particles.update(dt);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      const uiHit = g.ui.hit(inp.x, inp.y);
      const layer = uiHit ? 'ui-blocked' : g.desktop.drag ? null : g.desktop.hit(inp.x, inp.y);
      g.layer = layer;
      g.desktop.update(dt, inp, layer);
      g.wallpaper.draw(ctx, dt);
      g.desktop.drawIcons(ctx);
      g.desktop.drawBox(ctx);
      g.desktop.drawWindows(ctx);
      g.desktop.drawDragged(ctx);
      g.desktop.drawTaskbar(ctx);
      g.ui.drawHud(ctx, dt);
      g.ui.drawPanels(ctx, dt);
      g.particles.draw(ctx, 'ui', g.time);
      g.ui.drawToasts(ctx);
      g.desktop.drawTooltip(ctx, inp);
      g.ui.drawTip(ctx);
      const name = g.desktop.drag ? 'cursor_grab' : layer === 'icon' || layer === 'box' ? 'cursor_hand' : 'cursor';
      const cur = getUiIcon(name);
      const hs = CURSOR_HOTSPOT[name] || [0, 0];
      if (inp.inside) ctx.drawImage(cur, Math.round(inp.x) - hs[0], Math.round(inp.y) - hs[1]);
    } catch (e) {
      console.error(e);
    }
    g.input.endFrame();
  };
  requestAnimationFrame(frame);
  window.__ready = true;
}
