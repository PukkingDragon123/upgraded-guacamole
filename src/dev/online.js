// Dev preview (Online & AppSea agent) with a stub game: node tools/build.mjs --dev online
//   dist/dev/online.html?p=bait|craft|mp|appsea|dl|eco  &page=home|bait|isp|downloads|<category>  &lab (all unlocks)
//   &online (go online)  &peers=N (fake peers in the panel)  &coins=N
import { ctxOf } from '../core/canvas.js';
import { Input } from '../core/input.js';
import { audio } from '../core/audio.js';
import { Particles } from '../gfx/particles.js';
import { registerUiIcons, getUiIcon } from '../gfx/uiicons.js';
import { defaultState } from '../game/state.js';
import { grantUnlock, LAB_NODES } from '../game/lab.js';
import { UI } from '../ui/ui.js';
import { BaitPanel } from '../ui/baitpanel.js';
import { MultiplayerPanel } from '../ui/multiplayer.js';
import { installNet } from '../net/index.js';
import { STORE_RENDERERS, installStore } from '../store/index.js';
import { addBait, ensureBait, BAITS } from '../store/bait.js';
import { addItem } from '../build/items.js';
import { ecoSky, leafSpray, ecoGlobe, splashButton, leaf } from '../store/ecoart.js';
import { drawAeroPanel } from '../ui/aero.js';
import { drawBaitGloss } from '../fishing/baitart.js';
import { drawText } from '../gfx/font.js';

export function run(params) {
  const W = 960, H = 540;
  const cv = document.getElementById('screen');
  cv.width = W; cv.height = H;
  cv.style.width = W * 2 + 'px'; cv.style.height = H * 2 + 'px';
  cv.style.imageRendering = 'pixelated';
  const ctx = ctxOf(cv);
  registerUiIcons();
  const st = defaultState();
  st.coins = Number(params.get('coins') ?? 2500);
  if (params.has('lab')) for (const n of LAB_NODES) for (const u of n.unlock || []) grantUnlock(st, u.kind, u.id);
  ensureBait(st);
  for (const id of ['worm', 'golden', 'notes_lite', 'music_pro', 'games_ultra', 'fishnet_enterprise', 'chip']) addBait(st, id, 3);
  for (const [id, n] of [['kelp_fibre', 12], ['shell', 8], ['pearl', 3], ['sea_glass', 5], ['coral_chunk', 4], ['circuit_board', 2], ['driftwood', 6]]) addItem(st, id, n);
  const listeners = {};
  const screen = { W, H, canvas: cv, scale: 2, toLogical: (x, y) => { const r = cv.getBoundingClientRect(); return [((x - r.left) / r.width) * W, ((y - r.top) / r.height) * H]; } };
  const input = new Input(cv, screen.toLogical);
  const windows = [];
  const g = {
    params, canvas: cv, screen, state: st, audio, input, particles: new Particles(300), time: 0,
    ocean: { biome: { id: 'oscean' }, waterLevel: () => 100 },
    on(ev, fn) { (listeners[ev] ||= []).push(fn); },
    emit(ev, d) { for (const f of listeners[ev] || []) f(d); },
    toast(text, icon) { g.ui.toast(text, icon); },
    save() {},
    desktop: { windows, windowAt: () => windows[windows.length - 1] || null, openApp: () => null, closeWindow() {}, focus() {} },
  };
  g.ui = new UI(g);
  g.ui.register(new BaitPanel());
  g.ui.register(new MultiplayerPanel());
  installStore(g);
  const net = installNet(g);
  const p = params.get('p') || 'eco';
  if (p === 'bait') g.ui.open('bait');
  if (p === 'craft') g.ui.open('bait', { tab: 'craft' });
  if (p === 'mp') {
    g.ui.open('multiplayer');
    if (params.has('online')) {
      net.goOnline(true);
      const n = Number(params.get('peers') || 0);
      const names = ['BubbleBass42', 'KelpQueen', 'Sir Splash', 'MintyOrca'];
      for (let i = 0; i < n; i++) {
        net.onPresence('l:fake' + i, { v: 1, sid: 'fakepeer' + i, name: names[i % 4], oc: i % 3 === 2 ? 'fjord' : 'oscean', x: 0.2 + i * 0.2, st: ['idle', 'wait', 'fight'][i % 3], boat: { t: i }, look: {} }, { src: 'local' });
        net.showCatch(net.peers.get('l:fake' + i), { sp: 'x', r: ['rare', 'common', 'legendary'][i % 3], s: 30 + i * 12 });
      }
      net.addFeed({ kind: 'wave', name: 'KelpQueen', color: '#ff6aa8' });
    }
  }
  const win = { id: 'appsea', app: p === 'dl' ? 'appsea_dl' : 'appsea', x: 240, y: 60, w: 480, h: 320, data: {}, scroll: 0 };
  if (p === 'appsea' || p === 'dl') {
    const R = STORE_RENDERERS[win.app];
    win.w = R.size[0]; win.h = R.size[1];
    R.init(win, g);
    windows.push(win);
    if (p === 'appsea' && params.get('page')) R.navigate(win, g, params.get('page'));
    if (p === 'dl') { g.store.request('notes', { noWarn: params.has('nowarn'), dialog: false }); }
  }
  let last = performance.now();
  const frame = (now) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    g.time += dt;
    input.update(dt);
    g.ui.update(dt);
    net.update(dt);
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#5cc0f4'); bg.addColorStop(1, '#0d6fb5');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    if (p === 'eco') {
      ecoSky(ctx, 20, 20, 460, 140, g.time, { sun: [0.25, 0.3], grass: 22, globe: 26 });
      leafSpray(ctx, 480, 20, 'tr', 1, g.time);
      leafSpray(ctx, 20, 160, 'bl', 0.8, g.time);
      ecoGlobe(ctx, 560, 90, 40, g.time);
      for (let i = 0; i < 6; i++) leaf(ctx, 640 + i * 40, 60, 30, -60 + i * 25, { tone: i % 3 });
      drawAeroPanel(ctx, 20, 190, 460, 120, { tone: 'glass', radius: 12 });
      splashButton(g.ui, ctx, 40, 230, 90, 20, 'Download', { tone: 'green' });
      splashButton(g.ui, ctx, 150, 230, 90, 20, 'Get', { tone: 'orange' });
      splashButton(g.ui, ctx, 260, 230, 90, 20, 'Wave', { tone: 'aqua' });
      Object.keys(BAITS).filter((id) => !BAITS[id].app || id.endsWith('_lite') || id.endsWith('_enterprise')).slice(0, 26).forEach((id, i) => {
        drawBaitGloss(ctx, BAITS[id].art, 520 + (i % 9) * 46, 200 + Math.floor(i / 9) * 52, 40, g.time + i * 0.3);
        drawText(ctx, id.slice(0, 10), 520 + (i % 9) * 46, 224 + Math.floor(i / 9) * 52, { font: 'small', align: 'center', color: '#ffffff' });
      });
    }
    for (const w of windows) {
      const R = STORE_RENDERERS[w.app];
      ctx.fillStyle = '#0a3a6e'; ctx.fillRect(w.x - 3, w.y - 16, w.w + 6, w.h + 19);
      drawText(ctx, w.title || '', w.x + 4, w.y - 12, { color: '#ffffff' });
      const content = { x: w.x, y: w.y, w: w.w, h: w.h };
      ctx.save(); ctx.beginPath(); ctx.rect(content.x, content.y, content.w, content.h); ctx.clip();
      R.draw(ctx, w, g, content, g.time);
      ctx.restore();
      if (input.pressed && input.x >= w.x && input.y >= w.y && input.x < w.x + w.w && input.y < w.y + w.h) R.input(w, g, input, content);
      if (input.wheel && R.scroll) w.scroll = Math.max(0, Math.min(R.scroll(w, content), w.scroll + input.wheel * 14));
    }
    g.ui.drawPanels(ctx, dt);
    g.ui.drawToasts(ctx);
    g.ui.drawTip(ctx);
    const c = getUiIcon('cursor');
    if (c) ctx.drawImage(c, Math.round(input.x), Math.round(input.y));
    g.ui.tip = null;
    input.pressed = false; input.wheel = 0;
    requestAnimationFrame(frame);
  };
  window.DEV = g;
  requestAnimationFrame(frame);
}
