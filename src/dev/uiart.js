// Dev preview of the UI art kit: dist/dev/uiart.html?page=N
//   page 0: desktop icons (normal, 2x, chewed, full, shortcut, minis, file types)
//   page 1: inline UI icons, emotes, cursors, inline text
//   page 2: panels & widgets in every state
//   page 3: a composed desktop scene (windows, taskbar, tooltip, signs)
import { ctxOf, makeCanvas } from '../core/canvas.js';
import { drawText } from '../gfx/font.js';
import { bayer } from '../core/math.js';
import { getUiIcon, registerUiIcons, UI_ICON_NAMES, CURSOR_NAMES } from '../gfx/uiicons.js';
import { APPS, getAppIcon, getMiniIcon, fileTypeInfo, FILE_ICON_IDS, ICON_IDS } from '../desktop/icons.js';
import {
  drawWood, drawPaper, drawGlass, drawBottle, drawBubble, drawWaterBubble, drawButton, buttonSize, drawSlider, drawToggle,
  drawBar, drawTooltip, drawTab, drawWindowChrome, drawTaskbar, drawPlank, drawStamp, drawFrame, UI_COLORS,
} from '../ui/panels.js';

const W = 960, H = 540;

function ocean(g, t = 0) {
  const top = [0x3f, 0xb8, 0xc4], bot = [0x12, 0x4a, 0x6e];
  for (let y = 0; y < H; y++) {
    const k = y / H;
    for (let band = 0; band < 2; band++) {
      const kk = Math.min(1, k + band * 0.012);
      g.fillStyle = `rgb(${Math.round(top[0] + (bot[0] - top[0]) * kk)},${Math.round(top[1] + (bot[1] - top[1]) * kk)},${Math.round(top[2] + (bot[2] - top[2]) * kk)})`;
      if (band === 0) g.fillRect(0, y, W, 1);
    }
  }
  g.fillStyle = 'rgba(255,255,255,0.05)';
  for (let i = 0; i < 7; i++) {
    const x0 = 80 + i * 140;
    g.beginPath();
    g.moveTo(x0, 0); g.lineTo(x0 + 40, 0); g.lineTo(x0 - 60, H); g.lineTo(x0 - 120, H);
    g.fill();
  }
  g.fillStyle = 'rgba(220,250,255,0.35)';
  for (let i = 0; i < 60; i++) {
    const x = (i * 157) % W, y = (i * 263 + 40) % H, r = 1 + (i % 3);
    g.fillRect(x, y, r, r);
  }
}

function label(g, text, x, y, opts = {}) {
  drawText(g, text, x, y, { font: 'small', color: '#fff8ea', shadow: '#0b1a26', align: 'center', ...opts });
}

function title(g, text) {
  drawText(g, text, 12, 8, { scale: 2, color: '#fff4d6', shadow: '#0b1a26' });
}

function pageIcons(g) {
  title(g, 'Desktop icons');
  const cw = 106;
  APPS.forEach((a, i) => {
    const x = 20 + (i % 9) * cw, y = 40 + Math.floor(i / 9) * 64;
    const c = getAppIcon(a.icon);
    g.drawImage(c, x + cw / 2 - 16 - 10, y);
    const lines = a.label.length > 11 ? [a.label.slice(0, a.label.indexOf(' ')), a.label.slice(a.label.indexOf(' ') + 1)] : [a.label];
    lines.forEach((l, j) => drawText(g, l, x + cw / 2 - 10, y + 35 + j * 10, { align: 'center', color: '#ffffff', shadow: '#0b1a26' }));
  });
  // zoomed 2x row
  label(g, 'ZOOM 2X', 20, 178, { align: 'left' });
  ICON_IDS.forEach((id, i) => {
    const c = getAppIcon(id);
    const x = 20 + (i % 13) * 72, y = 188 + Math.floor(i / 13) * 70;
    g.drawImage(c, x, y, 64, 64);
  });
  // states
  label(g, 'STATES: FULL / CHEWED / SHORTCUT', 20, 334, { align: 'left' });
  const states = [['trash', 'full'], ['trash', 'full chewed'], ['computer', 'chewed'], ['browser', 'chewed'], ['music', 'chewed'], ['game', 'chewed'], ['browser', 'shortcut'], ['music', 'shortcut']];
  states.forEach(([id, st], i) => {
    const x = 20 + i * 72;
    g.drawImage(getAppIcon(id, { state: st }), x, 344, 64, 64);
  });
  // minis
  label(g, 'MINI 14X14 (1X / 2X / CHEWED)', 620, 334, { align: 'left' });
  ICON_IDS.forEach((id, i) => {
    const x = 620 + (i % 9) * 36, y = 346 + Math.floor(i / 9) * 46;
    g.drawImage(getMiniIcon(id), x, y);
    g.drawImage(getMiniIcon(id, { state: id === 'trash' ? 'full chewed' : 'chewed' }), x + 16, y);
    g.drawImage(getMiniIcon(id), x, y + 16, 28, 28);
  });
  // file types
  label(g, 'FILE TYPES', 20, 418, { align: 'left' });
  const files = ['photo.jpg', 'song.mp3', 'clip.mp4', 'notes.txt', 'essay.docx', 'manual.pdf', 'budget.xlsx', 'app.js', 'index.html', 'backup.zip', 'setup.exe', 'image.iso', 'config.ini', 'unknown.xyz', 'Chrome.lnk', 'Steam.exe'];
  files.forEach((f, i) => {
    const info = fileTypeInfo(f);
    const x = 20 + i * 58, y = 428;
    g.drawImage(getAppIcon(info.icon, { label: info.label, state: info.state }), x + 8, y);
    label(g, f.length > 10 ? f.slice(0, 9) + '.' : f, x + 24, y + 36);
    label(g, info.type, x + 24, y + 44, { color: '#9ff0e0' });
  });
  FILE_ICON_IDS.forEach((id, i) => g.drawImage(getMiniIcon(id), 20 + i * 18, 500));
  g.drawImage(getAppIcon('folder'), 300, 492);
  g.drawImage(getAppIcon('calendar', { day: 7 }), 340, 492);
}

function pageUiIcons(g) {
  title(g, 'UI icons, emotes & cursors');
  registerUiIcons();
  const names = UI_ICON_NAMES;
  names.forEach((n, i) => {
    const c = getUiIcon(n);
    const x = 16 + (i % 16) * 58, y = 40 + Math.floor(i / 16) * 52;
    g.drawImage(c, x, y, c.width * 3, c.height * 3);
    g.drawImage(c, x + 38, y + 30 - c.height);
    label(g, n.length > 11 ? n.slice(0, 10) : n, x + 18, y + 38);
  });
  const y0 = 40 + Math.ceil(names.length / 16) * 52 + 4;
  CURSOR_NAMES.forEach((n, i) => {
    const c = getUiIcon(n);
    const x = 16 + i * 80;
    g.drawImage(c, x, y0, c.width * 3, c.height * 3);
    g.drawImage(c, x + 50, y0 + 30);
    label(g, n, x + 24, y0 + 52);
  });
  const lines = [
    'Cost: 25{coin}   Big haul: 1,200{coin_big}   Lives {heart}{heart}{heart_empty}',
    'Rarity {star}{star}{star}{star_empty}{star_empty}   {lock} Locked   {unlock} Open   {check} Done {cross} Nope',
    'Hold {mouse_hold} to reel, {mouse_l} cast, {mouse_r} cancel.  {sun} day {moon} night {rain} {storm}',
    'Mood: {zzz} {anger} {sweat} {question} {exclaim} {dollar} {music} {sparkle}',
  ];
  lines.forEach((l, i) => drawText(g, l, 340, y0 + 6 + i * 14, { color: '#ffffff', shadow: '#0b1a26' }));
  drawText(g, 'SMALL FONT {coin} 12 {heart} {star} {fish}', 340, y0 + 64, { font: 'small', color: '#fff4d6', shadow: '#0b1a26' });
}


function pageSurfaces(g) {
  title(g, 'Surfaces & buttons');
  registerUiIcons();
  drawWood(g, 16, 40, 220, 62, { tone: 'light' });
  label(g, 'WOOD LIGHT', 126, 106);
  drawWood(g, 16, 116, 220, 62, { tone: 'dark' });
  label(g, 'WOOD DARK', 126, 182);
  drawWood(g, 250, 40, 200, 138, { tone: 'dark' });
  drawWood(g, 260, 50, 180, 118, { inset: true });
  drawText(g, 'Inset panel', 272, 62, { color: UI_COLORS.text, shadow: UI_COLORS.textShadow });
  drawText(g, 'Cost: 25{coin}', 272, 78, { color: UI_COLORS.text, shadow: UI_COLORS.textShadow });
  drawWood(g, 270, 96, 70, 20, { nails: false, round: 2 });
  drawPaper(g, 466, 40, 140, 92);
  drawText(g, 'Plain paper', 476, 52, { color: UI_COLORS.ink });
  drawPaper(g, 618, 40, 150, 100, { lined: true, torn: 'bottom' });
  drawText(g, 'Lined + torn', 630, 52, { color: UI_COLORS.ink });
  drawPaper(g, 780, 40, 166, 112, { aged: true, fold: true });
  drawText(g, 'Aged + fold', 792, 52, { color: UI_COLORS.ink });
  drawGlass(g, 466, 146, 120, 70);
  label(g, 'GLASS', 526, 220);
  drawGlass(g, 596, 156, 130, 80, { frame: 'brass' });
  label(g, 'BRASS FRAME', 661, 240);
  drawGlass(g, 736, 166, 120, 70, { frame: 'wood', tint: '#a8f0c8' });
  label(g, 'WOOD FRAME', 796, 240);
  drawBottle(g, 16, 196, 190, 46);
  drawBottle(g, 216, 202, 120, 30, { note: false, tint: '#9fd8ff' });
  label(g, 'BOTTLES', 180, 248);
  drawPlank(g, 350, 214, 104, 26, { label: 'Bait Shop', rope: 16 });

  const styles = ['wood', 'shell', 'paper', 'glass', 'coral'];
  const states = ['normal', 'hover', 'down', 'disabled'];
  states.forEach((st, j) => label(g, st.toUpperCase(), 120 + j * 112, 262));
  styles.forEach((sty, i) => {
    const y = 272 + i * 30;
    label(g, sty.toUpperCase(), 34, y + 7);
    states.forEach((st, j) => {
      drawButton(g, 72 + j * 112, y, 96, 21, { label: ['Cast!', 'Shells', 'Notes', 'Peek', 'Buy 25{coin}'][i], style: sty, state: st, icon: i === 2 ? 'book' : null });
    });
    states.forEach((st, j) => drawButton(g, 530 + j * 28, y, 21, 21, { icon: ['hook', 'heart', 'map', 'eye', 'coral'][i], style: sty, state: st }));
  });
  const bs = buttonSize('Small btn', { font: 'small', icon: 'gear' });
  drawButton(g, 660, 272, bs.w, bs.h, { label: 'Small btn', font: 'small', icon: 'gear', style: 'wood' });
  drawButton(g, 660, 292, bs.w, bs.h, { label: 'Small btn', font: 'small', icon: 'gear', style: 'shell', state: 'hover' });
  const big = buttonSize('Go Fishing', { icon: 'hook' });
  drawButton(g, 660, 316, big.w + 20, 26, { label: 'Go Fishing', icon: 'hook', style: 'wood', state: 'hover' });
  drawButton(g, 660, 350, big.w + 20, 26, { label: 'Go Fishing', icon: 'hook', style: 'coral' });
  drawButton(g, 660, 384, 180, 34, { label: 'Big glass button', style: 'glass' });
  drawButton(g, 660, 424, 180, 34, { label: 'Big shell button', style: 'shell', icon: 'sparkle' });
  drawWood(g, 16, 432, 600, 96, { tone: 'light' });
  drawWood(g, 26, 442, 580, 76, { inset: true, tone: 'dark' });
  ['wood', 'shell', 'paper', 'glass', 'coral'].forEach((sty, i) => drawButton(g, 40 + i * 112, 452, 100, 21, { label: 'Hover', style: sty, state: 'hover' }));
  ['wood', 'shell', 'paper', 'glass', 'coral'].forEach((sty, i) => drawButton(g, 40 + i * 112, 482, 100, 21, { label: 'Pressed', style: sty, state: 'down' }));
  drawButton(g, 860, 300, 80, 21, { label: 'OK', style: 'wood' });
  drawButton(g, 860, 330, 80, 21, { label: 'Cancel', style: 'paper', icon: 'cross' });
}

function pageWidgets(g) {
  title(g, 'Widgets');
  registerUiIcons();
  // sliders
  label(g, 'SLIDERS', 16, 40, { align: 'left' });
  drawSlider(g, 16, 50, 180, 0.0);
  drawSlider(g, 16, 72, 180, 0.35, { hover: true });
  drawSlider(g, 16, 94, 180, 0.8, { down: true });
  drawSlider(g, 16, 116, 120, 1);
  // toggles
  label(g, 'TOGGLES', 230, 40, { align: 'left' });
  drawToggle(g, 230, 50, false);
  drawToggle(g, 262, 50, false, { hover: true });
  drawToggle(g, 300, 50, true);
  drawToggle(g, 332, 50, true, { hover: true });
  drawText(g, 'Music', 368, 58, { color: '#fff', shadow: '#0b1a26' });
  // bars
  label(g, 'BARS', 230, 88, { align: 'left' });
  drawBar(g, 230, 98, 160, 10, 0.72, { color: '#ff5a4a' });
  drawBar(g, 230, 112, 160, 10, 0.45, { color: '#5ab4ff', segments: 5 });
  drawBar(g, 230, 126, 160, 6, 0.9, { color: '#ffd25a' });
  drawBar(g, 230, 136, 160, 14, 0.3, { color: '#6ad46a', back: '#1e2a2a', segments: 3 });
  drawText(g, '{heart} 72%', 396, 99, { color: '#fff', shadow: '#0b1a26' });
  // tabs
  label(g, 'TABS', 450, 40, { align: 'left' });
  drawWood(g, 450, 70, 300, 80, { tone: 'light' });
  drawTab(g, 456, 50, 70, 21, { label: 'Fish', active: true, icon: 'fish' });
  drawTab(g, 528, 50, 66, 21, { label: 'Bait', color: '#4a9ad8', icon: 'worm' });
  drawTab(g, 596, 50, 66, 21, { label: 'Decor', color: '#5aae5a', icon: 'coral' });
  drawTab(g, 664, 50, 60, 21, { label: 'Map', color: '#c88a3a' });
  drawPaper(g, 460, 80, 280, 60, { lined: true });
  drawText(g, 'Sir Puffington   {star}{star}{star_empty}', 474, 92, { color: UI_COLORS.ink });
  // bubbles
  label(g, 'SPEECH BUBBLES', 16, 160, { align: 'left' });
  drawBubble(g, 16, 172, 110, 34, { tailX: 40, tailY: 222 });
  drawText(g, 'Blub blub!', 28, 184, { color: UI_COLORS.ink });
  drawBubble(g, 150, 172, 80, 30, { tailX: 260, tailY: 196 });
  drawText(g, '{question}{exclaim}', 170, 181, { color: UI_COLORS.ink });
  drawBubble(g, 290, 176, 60, 26, { tailX: 270, tailY: 170 });
  drawText(g, '{zzz}{music}', 302, 184, { color: UI_COLORS.ink });
  drawBubble(g, 16, 246, 120, 30, { tailX: 50, tailY: 230 });
  drawText(g, 'Hook me up', 28, 256, { color: UI_COLORS.ink });
  drawBubble(g, 160, 236, 110, 36, { tailX: 290, tailY: 290, style: 'thought' });
  drawText(g, 'Mmm, worm...', 174, 250, { color: UI_COLORS.ink });
  drawBubble(g, 300, 226, 40, 22, { tailX: 320, tailY: 262 });
  drawText(g, '{heart}{anger}', 306, 232, { color: UI_COLORS.ink });
  for (const [x, y, r] of [[380, 200, 2], [392, 186, 3], [404, 166, 4.5], [420, 140, 6], [372, 230, 1.5], [430, 214, 3.5]]) drawWaterBubble(g, x, y, r);
  // stamps
  label(g, 'STAMPS', 470, 160, { align: 'left' });
  drawPaper(g, 470, 170, 200, 90, { aged: true });
  drawStamp(g, 530, 200, 'NEW!', { color: '#d8383a', angle: -0.22 });
  drawStamp(g, 610, 196, 'SOLD', { color: '#3a5ad8', angle: 0.15 });
  drawStamp(g, 560, 236, 'RARE CATCH', { color: '#2e8a4a', angle: -0.08 });
  drawStamp(g, 636, 238, 'x2', { color: '#a83ad8', angle: 12, font: 'small' });
  // frames
  label(g, 'FRAMES', 690, 160, { align: 'left' });
  for (const [i, st] of ['wood', 'gold', 'coral'].entries()) {
    const r = drawFrame(g, 690 + i * 88, 172, 80, 64, { style: st });
    g.fillStyle = ['#7ad0e8', '#2a4a8a', '#164a5a'][i];
    g.fillRect(r.x, r.y, r.w, r.h);
    g.drawImage(getAppIcon(['image', 'fishtop', 'browser'][i]), r.x + r.w / 2 - 16, r.y + r.h / 2 - 16);
    label(g, st.toUpperCase(), 730 + i * 88, 240);
  }
  // windows
  label(g, 'WINDOW CHROME', 16, 296, { align: 'left' });
  const a = drawWindowChrome(g, { x: 16, y: 306, w: 300, h: 150 }, { title: 'FishNet Explorer - fishipedia.org', iconCanvas: getMiniIcon('browser'), active: true, hover: 'close' });
  drawText(g, 'content rect', a.content.x + 6, a.content.y + 6, { color: UI_COLORS.ink });
  drawButton(g, a.content.x + 6, a.content.y + 24, 80, 19, { label: 'Search', style: 'paper' });
  g.strokeStyle = 'rgba(255,0,128,0.6)';
  g.strokeRect(a.close.x + 0.5, a.close.y + 0.5, a.close.w - 1, a.close.h - 1);
  const b = drawWindowChrome(g, { x: 330, y: 316, w: 220, h: 130 }, { title: 'Notes.txt', iconCanvas: getMiniIcon('notes'), active: false, hover: 'min' });
  drawPaper(g, b.content.x + 4, b.content.y + 4, b.content.w - 8, b.content.h - 10, { lined: true });
  drawWindowChrome(g, { x: 566, y: 306, w: 170, h: 90 }, { title: 'Settings', iconCanvas: getMiniIcon('settings'), down: 'close', fill: '#e8f0f4' });
  // tooltip near the right edge (auto-placed to the left)
  drawTooltip(g, 930, 300, 'Golden Bait: +50% rarity for 2 casts. Costs 120{coin}', { maxW: 150 });
  drawTooltip(g, 760, 400, 'Drag an icon here', {});
  g.drawImage(getUiIcon('cursor'), 760, 400);
  // taskbar
  drawTaskbar(g, 0, 516, W, 24);
  ['computer', 'browser', 'music', 'fishtop'].forEach((id, i) => g.drawImage(getMiniIcon(id), 8 + i * 22, 522));
  drawText(g, '12:34', W - 40, 525, { color: '#fff4dc', shadow: '#2a140e' });
}

export function run(params) {
  const S = Number(params.get('s') || 2);
  const cv = document.getElementById('screen');
  cv.width = W; cv.height = H;
  cv.style.width = W * S + 'px'; cv.style.height = H * S + 'px';
  const g = ctxOf(cv);
  ocean(g);
  const page = Number(params.get('page') || 0);
  const PAGES = [pageIcons, pageUiIcons, pageSurfaces, pageWidgets];
  PAGES[page % PAGES.length](g);
  window.__ready = true;
}

void makeCanvas; void bayer;
