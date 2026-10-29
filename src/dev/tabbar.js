// Dev preview of the floating tab bar.
//   dist/dev/tabbar.html?page=0  big icons: normal / hover / active / small, zoomed
//   dist/dev/tabbar.html?page=1  live bar on a mock desktop (move the mouse, click tabs; panels are mocked)
//     &open=journal (panel open + dim overlay)  &compact  &fight (bar slides away)  &t=1.5 (sim seconds)
import { ctxOf } from '../core/canvas.js';
import { rgba } from '../core/color.js';
import { drawText } from '../gfx/font.js';
import { BIG_ICON_IDS, getBigIcon, drawBigIcon } from '../gfx/bigicons.js';
import { TabBar } from '../ui/tabbar.js';
import { drawWood, drawPaper, drawTooltip } from '../ui/panels.js';
import { getAppIcon } from '../desktop/icons.js';
import { registerUiIcons, getUiIcon } from '../gfx/uiicons.js';

const W = 960, H = 540;

function ocean(g) {
  const top = [0x3f, 0xb8, 0xc4], bot = [0x12, 0x4a, 0x6e];
  for (let y = 0; y < H; y++) {
    const k = y / H;
    g.fillStyle = `rgb(${Math.round(top[0] + (bot[0] - top[0]) * k)},${Math.round(top[1] + (bot[1] - top[1]) * k)},${Math.round(top[2] + (bot[2] - top[2]) * k)})`;
    g.fillRect(0, y, W, 1);
  }
  g.fillStyle = 'rgba(255,255,255,0.05)';
  for (let i = 0; i < 7; i++) {
    const x0 = 80 + i * 140;
    g.beginPath(); g.moveTo(x0, 0); g.lineTo(x0 + 40, 0); g.lineTo(x0 - 60, H); g.lineTo(x0 - 120, H); g.fill();
  }
}

function pageIcons(g) {
  drawText(g, 'Big tab icons: normal / hover (+badge) / active / small, and 2x', 12, 8, { color: '#fff4d6', shadow: '#0b1a26' });
  BIG_ICON_IDS.forEach((id, i) => {
    const col = i % 4, row = Math.floor(i / 4);
    const x0 = 14 + col * 236, y0 = 30 + row * 170;
    ['normal', 'hover', 'active'].forEach((st, j) => drawBigIcon(g, id, x0 + 26 + j * 56, y0 + 54, { state: st, badge: j === 1 ? (i % 3 === 0 ? '!' : i) : null }));
    drawBigIcon(g, id, x0 + 196, y0 + 54, { small: true });
    const c = getBigIcon(id).canvas;
    g.drawImage(c, x0, y0 + 62, c.width * 2, c.height * 2);
    drawText(g, id, x0 + 110, y0 + 90, { color: '#ffffff', shadow: '#0b1a26' });
    drawText(g, `${c.width}x${c.height}`, x0 + 110, y0 + 102, { font: 'small', color: '#c8f0ff', shadow: '#0b1a26' });
  });
}

function mockGame(params) {
  const ui = {
    panels: Object.fromEntries(['journal', 'skills', 'shop', 'map', 'inventory', 'research', 'wardrobe', 'boatyard', 'settings'].map((id) => [id, { id }])),
    openId: params.get('open') || null,
    isOpen(id) { return this.openId === id; },
    toggle(id) { this.openId = this.openId === id ? null : id; },
    coinShown: 12450, coinBump: 0, tip: null,
  };
  return {
    screen: { W, H },
    state: {
      coins: 12450, view: 'ocean', skills: { hook1: true }, journal: {},
      inventory: { items: {}, packages: [{ tier: 0 }, { tier: 1 }, { tier: 0 }] },
      apps: { downloads: [{ state: 'active' }, { state: 'queued' }] },
      research: { active: [{ end: 0 }], done: {}, perks: {} },
      settings: { tabbarCompact: params.has('compact') },
    },
    input: { x: -100, y: -100, pressed: false, down: false },
    ui,
    build: { active: false, toggle() { this.active = !this.active; } },
    desktop: { windows: [], openApp(id) { this.windows = this.windows.some((w) => w.app === id) ? [] : [{ app: id }]; return {}; } },
    command(c) { if (c === 'tank') this.state.view = this.state.view === 'aquarium' ? 'ocean' : 'aquarium'; },
    fishing: { fighting: params.has('fight') },
    tutorial: { active: false },
    speciesFound: () => 3,
    audio: { play() {} },
  };
}

function drawDesktop(g, game) {
  ['computer', 'trash', 'browser', 'documents', 'notes', 'music', 'fishtop'].forEach((id, i) => {
    const x = 12 + (i >= 6 ? 74 : 0), y = 10 + (i % 6) * 62;
    g.drawImage(getAppIcon(id), x + 21, y);
    drawText(g, id, x + 37, y + 36, { align: 'center', color: '#fff', shadow: '#0b1a26' });
  });
  if (game.ui.openId) {
    g.fillStyle = rgba('#06121e', 0.42);
    g.fillRect(0, 0, W, H);
    drawWood(g, 280, 110, 400, 300, { tone: 'dark' });
    drawPaper(g, 296, 140, 368, 254, { lined: true, aged: true });
    drawText(g, 'Mock panel: ' + game.ui.openId, 480, 120, { align: 'center', scale: 1, color: '#fff3dc', shadow: '#1a0e06' });
    drawText(g, 'Click another tab to switch instantly.', 312, 156, { color: '#2e1f1c' });
  }
}

function pageBar(params, g, cv, S) {
  const game = mockGame(params);
  const bar = new TabBar(game);
  // simulate a little time so the slide-in has settled (or freeze mid-animation with &t=)
  const simT = Number(params.get('t') ?? 2);
  for (let t = 0; t < simT; t += 1 / 60) bar.update(1 / 60);
  const inp = game.input;
  cv.addEventListener('pointermove', (e) => { const r = cv.getBoundingClientRect(); inp.x = Math.floor((e.clientX - r.left) / S); inp.y = Math.floor((e.clientY - r.top) / S); });
  cv.addEventListener('pointerdown', () => { inp.pressed = true; inp.down = true; });
  window.addEventListener('pointerup', () => { inp.down = false; });
  let last = performance.now();
  const frame = () => {
    const now = performance.now(), dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    ocean(g);
    bar.update(dt);
    drawDesktop(g, game);
    game.ui.tip = null;
    bar.draw(g);
    if (game.ui.tip) drawTooltip(g, inp.x + 12, inp.y + 14, game.ui.tip, { maxW: 200 });
    g.drawImage(getUiIcon('cursor'), inp.x, inp.y);
    drawText(g, `bottom=${bar.bottom}  compact=${bar.compact}  hit(cursor)=${bar.hit(inp.x, inp.y)}  open=${game.ui.openId}  view=${game.state.view}  build=${game.build.active}`, 12, H - 12, { font: 'small', color: '#fff', shadow: '#0b1a26' });
    inp.pressed = false;
    window.__bar = { bottom: bar.bottom, open: game.ui.openId, view: game.state.view, build: game.build.active, compact: bar.compact, hover: bar.hoverId };
    requestAnimationFrame(frame);
  };
  frame();
}

export function run(params) {
  const S = Number(params.get('s') || 2);
  const cv = document.getElementById('screen');
  cv.width = W; cv.height = H;
  cv.style.width = W * S + 'px'; cv.style.height = H * S + 'px';
  cv.style.cursor = 'none';
  const g = ctxOf(cv);
  registerUiIcons();
  const page = Number(params.get('page') || 0);
  if (page === 1) return pageBar(params, g, cv, S);
  ocean(g);
  const t0 = performance.now();
  pageIcons(g);
  window.__timing = Math.round(performance.now() - t0);
}
