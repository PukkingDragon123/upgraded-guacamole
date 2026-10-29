// Dev preview of the AppSea store on a real Desktop with a stub game: dist/dev/store.html?p=store
//   p=store|dl|isp|boatyard|icons   page=home|productivity|media|games|social|utilities|weird|top|new|isp|downloads
//   &rich (coins + installed apps + queued downloads)  &coins=N  &isp=N  &boat=N  &dl=<appId> (start a download)
//   &warn (force the "might contain fish" prompt)  &hl=<appId>  &scroll=N  &persist (keep state in localStorage)
//   &connected (skip the dial-up animation)
import { ctxOf } from '../core/canvas.js';
import { Input } from '../core/input.js';
import { audio } from '../core/audio.js';
import { rgba } from '../core/color.js';
import { Particles } from '../gfx/particles.js';
import { getUiIcon, registerUiIcons, CURSOR_HOTSPOT } from '../gfx/uiicons.js';
import { drawText } from '../gfx/font.js';
import { defaultState } from '../game/state.js';
import { computeStats } from '../game/skills.js';
import { UI } from '../ui/ui.js';
import { Desktop } from '../desktop/desktop.js';
import { APP_RENDERERS } from '../desktop/apps.js';
import { Wallpaper } from '../desktop/wallpaper.js';
import { getAppIcon, getMiniIcon, ICON_IDS, TIER_BADGES } from '../desktop/icons.js';
import { BoatyardPanel } from '../ui/boatyard.js';
import { installStore, STORE_RENDERERS, syncDesktopIcons, openStore, ensureStoreState, boatBonus, baitMods, CATALOG } from '../store/index.js';
import { boatSprite, walrusSprite } from '../store/boatart.js';

let W = 960, H = 540;
const KEY = 'fishtop.storedev';

function makeState(params) {
  let st = null;
  if (params.has('persist')) { try { st = JSON.parse(localStorage.getItem(KEY)); } catch { st = null; } }
  if (st) return st;
  st = defaultState();
  st.tutorialDone = false;
  ensureStoreState(st);
  st.coins = Number(params.get('coins') ?? (params.has('rich') ? 4200 : 40));
  if (params.has('rich')) {
    for (const [id, t] of [['notes', 2], ['music', 1], ['games', 0], ['chat', 0], ['moreram', 4], ['fishnet', 0]]) { st.apps.installed.push(id); st.apps.tiers[id] = t; }
    st.apps.stats = { downloaded: 54321, completed: 9 };
  }
  st.apps.isp = Number(params.get('isp') ?? (params.has('rich') ? 2 : 0));
  st.boat.tier = Number(params.get('boat') ?? 0);
  return st;
}

function makeGame(canvas, params) {
  const st = makeState(params);
  const listeners = {};
  const g = {
    params, canvas, screen: { W, H, scale: 2 }, state: st, audio, particles: new Particles(900),
    time: 0, paused: false, muted: false, trashFull: false, lowPower: false,
    fishing: { fighting: false, busy: false },
    camera: { shake() {}, flash() {} },
    world: { cursor: { x: -100, y: -100 } },
    clock: { realNow: () => Date.now(), hour: () => 14.5, isNight: () => false },
    on(ev, fn) { (listeners[ev] ||= []).push(fn); },
    emit(ev, data) { for (const f of listeners[ev] || []) f(data); },
    save() { if (params.has('persist')) try { localStorage.setItem(KEY, JSON.stringify(st)); } catch { /* ignore */ } },
    toast(text, icon) { g.ui.toast(text, icon); },
    coinDisplay() { return Math.floor(g.ui.coinShown).toLocaleString('en'); },
    clockTooltip: () => 'Sunny Shallows',
    handleIconOpen: () => false,
    addCoins(n) { st.coins += n; },
    spendCoins(n) { if (st.coins < n) return false; st.coins -= n; return true; },
    command(id) { if (g.ui.panels[id]) g.ui.togglePanel(id); else g.toast(`(${id} is not in this preview)`, 'info'); },
  };
  g.stats = computeStats(st.skills);
  return g;
}

function iconSheet(ctx, t) {
  ctx.fillStyle = '#2b5f86';
  ctx.fillRect(0, 0, W, H);
  drawText(ctx, 'AppSea icons (32px x2 / 14px minis x2) + tier badges', 20, 10, { color: '#ffffff' });
  const ids = ['store', 'isp', 'ram', 'virus', 'boat', 'download', 'notes', 'music', 'browser', 'game'];
  ids.forEach((id, i) => {
    const x = 20 + i * 92;
    ctx.drawImage(getAppIcon(id), x, 30, 64, 64);
    ctx.drawImage(getAppIcon(id), x + 66, 30);
    ctx.drawImage(getMiniIcon(id), x + 66, 66, 28, 28);
    drawText(ctx, id, x + 32, 100, { align: 'center', font: 'small', color: '#ffffff' });
  });
  TIER_BADGES.forEach((b, tier) => {
    const x = 20 + tier * 120;
    ctx.drawImage(getAppIcon('notes', { tier }), x, 130, 64, 64);
    ctx.drawImage(getAppIcon(`videos@${tier}`.replace('videos', 'video')), x + 66, 130);
    ctx.drawImage(getMiniIcon('chat@' + tier), x + 66, 166, 28, 28);
    drawText(ctx, b ? b.text : 'LITE', x + 32, 200, { align: 'center', font: 'small', color: '#ffffff' });
  });
  for (let i = 0; i < 5; i++) {
    const s = boatSprite(i, 1);
    const x = 20 + (i % 3) * 300, y = 230 + Math.floor(i / 3) * 140;
    ctx.fillStyle = '#3a92cc';
    ctx.fillRect(x, y + s.oy, s.w, s.h - s.oy);
    ctx.drawImage(s.canvas, x, y);
    const th = boatSprite(i, 0.3);
    ctx.drawImage(th.canvas, x + 190, y + 40);
  }
  for (let f = 0; f < 3; f++) ctx.drawImage(walrusSprite(f), 640 + f * 60, 400, 88, 80);
  const m = baitMods('notes');
  drawText(ctx, `notes bait mods: ${JSON.stringify(m).slice(0, 120)}`, 20, H - 30, { font: 'small', color: '#ffffff' });
  drawText(ctx, `boat netBoost ${boatBonus({ boat: { tier: 3 } }, 'netBoost')} - catalog ${CATALOG.length} apps`, 20, H - 20, { font: 'small', color: '#ffffff' });
  void t;
}

export function run(params) {
  W = Number(params.get('w')) || 960; H = Number(params.get('h')) || 540;
  const cv = document.getElementById('screen');
  cv.width = W; cv.height = H;
  cv.style.width = W * 2 + 'px'; cv.style.height = H * 2 + 'px';
  const ctx = ctxOf(cv);
  registerUiIcons();
  const toLogical = (cx, cy) => {
    const r = cv.getBoundingClientRect();
    return [((cx - r.left) / r.width) * W, ((cy - r.top) / r.height) * H];
  };
  const g = makeGame(cv, params);
  g.input = new Input(cv, toLogical);
  g.ui = new UI(g);
  g.ui.register(new BoatyardPanel());
  Object.assign(APP_RENDERERS, STORE_RENDERERS);
  g.desktop = new Desktop(g);
  g.wallpaper = new Wallpaper(g);
  const S = installStore(g);
  syncDesktopIcons(g.desktop, g.state);
  g.on('appInstalled', () => syncDesktopIcons(g.desktop, g.state));
  if (params.has('connected')) S.connected = true;
  window.FISHTOP = g;
  const p = params.get('p') || 'store';
  const page = params.get('page') || (p === 'isp' ? 'isp' : 'home');
  if (p === 'store' || p === 'dl' || p === 'isp') {
    const w = openStore(g, { page, highlight: params.get('hl') || undefined });
    if (params.has('scroll')) setTimeout(() => { w.scroll = Number(params.get('scroll')); }, 50);
  }
  if (params.get('dl')) {
    if (params.has('warn')) S.st.stats.completed ||= 1;
    const d = S.request(params.get('dl'), { noWarn: !params.has('warn') });
    if (d && params.has('warn')) { d.state = 'confirm'; d.warn = 0; }
  }
  if (p === 'boatyard') g.ui.open('boatyard');
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
      if (p === 'icons') { iconSheet(ctx, g.time); inp.endFrame(); return; }
      const uiHit = g.ui.hit(inp.x, inp.y);
      g.desktop.update(dt, inp, uiHit ? 'ui-blocked' : g.desktop.drag ? null : g.desktop.hit(inp.x, inp.y));
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
      const a = S.active();
      drawText(ctx, `${Math.round(g.state.coins)} coins  isp ${S.st.isp}  boat ${g.state.boat.tier}  installed [${S.st.installed.join(',')}]  dl ${a ? a.app + ' ' + Math.floor((a.done / a.kb) * 100) + '%' : '-'}`, 6, H - 34, { font: 'small', color: '#ffffff', shadow: rgba('#000000', 0.7) });
      const cur = getUiIcon(g.desktop.drag ? 'cursor_grab' : 'cursor');
      const hs = CURSOR_HOTSPOT.cursor;
      if (inp.inside) ctx.drawImage(cur, Math.round(inp.x) - hs[0], Math.round(inp.y) - hs[1]);
    } catch (e) {
      console.error(e);
    }
    g.input.endFrame();
  };
  requestAnimationFrame(frame);
  setInterval(() => g.save(), 1000);
  void ICON_IDS;
}
