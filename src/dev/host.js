// Dev preview for the host bridge: shows what src/platform/host.js reports and lets you try modes,
// shortcuts, cursor forwarding, click-through and the Desktop listing (index.html?dev=host, or
// `npm run desktop -- --dev=host` in the Electron shell).
import { host, HOST_MODES } from '../platform/host.js';
import { ctxOf } from '../core/canvas.js';
import { drawText } from '../gfx/font.js';

export function run() {
  const cv = document.getElementById('screen');
  const S = host.lowPower ? 1 : 2;
  const g = ctxOf(cv);
  const st = { cursor: null, shortcut: '-', files: null, filesNote: 'press D or click LIST', fishing: false, busy: false };
  const panel = { x: 8, y: 8, w: 300, h: 150 };
  const buttons = [];

  function fit() {
    cv.width = Math.max(160, Math.floor(innerWidth / S));
    cv.height = Math.max(110, Math.floor(innerHeight / S));
    cv.style.width = cv.width * S + 'px';
    cv.style.height = cv.height * S + 'px';
    g.imageSmoothingEnabled = false;
    panel.w = Math.min(300, cv.width - 16);
  }
  fit();
  addEventListener('resize', fit);

  const inPanel = (p) => p && p.x >= panel.x && p.y >= panel.y && p.x < panel.x + panel.w && p.y < panel.y + panel.h;

  function moveTo(x, y) {
    st.cursor = { x: Math.floor(x / S), y: Math.floor(y / S) };
    // Overlay pattern: only grab the mouse while over UI (or while fishing).
    host.setInteractive(st.fishing || inPanel(st.cursor));
  }

  host.onCursor((x, y) => moveTo(x, y));
  addEventListener('mousemove', (e) => moveTo(e.clientX, e.clientY));
  host.onShortcut((id, ev) => {
    st.shortcut = `${id} fishing=${ev.fishing} paused=${ev.paused}${ev.nextMode ? ' -> ' + ev.nextMode : ''}`;
    if (typeof ev.fishing === 'boolean') st.fishing = ev.fishing;
  });

  async function listDesktop() {
    if (st.busy) return;
    st.busy = true;
    st.filesNote = 'asking...';
    const files = await host.requestDesktopFiles();
    st.files = files;
    st.filesNote = `${files.length} item(s)` + (files[0] ? `: ${files.slice(0, 4).map((f) => f.name).join(', ')}` : '');
    st.busy = false;
  }

  addEventListener('keydown', (e) => {
    if (e.code === 'KeyD') listDesktop();
  });
  addEventListener('mousedown', (e) => {
    const p = { x: Math.floor(e.clientX / S), y: Math.floor(e.clientY / S) };
    const b = buttons.find((r) => p.x >= r.x && p.y >= r.y && p.x < r.x + r.w && p.y < r.y + r.h);
    if (b) b.run();
  });

  function button(x, y, label, runFn, active) {
    const w = label.length * 4 + 8;
    g.fillStyle = active ? '#3fa58f' : '#25415a';
    g.fillRect(x, y, w, 11);
    drawText(g, label, x + 4, y + 3, { font: 'small', color: '#ffffff' });
    buttons.push({ x, y, w, h: 11, run: runFn });
    return x + w + 4;
  }

  let t = 0;
  function draw() {
    t += 1 / 60;
    if (host.transparent) g.clearRect(0, 0, cv.width, cv.height);
    else {
      g.fillStyle = '#0f2a3d';
      g.fillRect(0, 0, cv.width, cv.height);
    }
    buttons.length = 0;
    g.fillStyle = 'rgba(11, 22, 34, 0.88)';
    g.fillRect(panel.x, panel.y, panel.w, panel.h);
    g.strokeStyle = '#7fd6c8';
    g.strokeRect(panel.x + 0.5, panel.y + 0.5, panel.w - 1, panel.h - 1);

    const lines = [
      `HOST BRIDGE  kind=${host.kind}  mode=${host.mode}  platform=${host.platform}`,
      `transparent=${host.transparent} clickThrough=${host.clickThrough} lowPower=${host.lowPower}`,
      `canUseRealDesktop=${host.canUseRealDesktop}`,
      `cursor=${st.cursor ? st.cursor.x + ',' + st.cursor.y : '-'}  fishing=${st.fishing}`,
      `shortcut: ${st.shortcut}`,
      `desktop: ${st.filesNote}`,
    ];
    lines.forEach((l, i) => drawText(g, l, panel.x + 6, panel.y + 6 + i * 11, { font: 'small', color: i ? '#d8f4ee' : '#ffd27a' }));

    let x = panel.x + 6;
    const y = panel.y + panel.h - 30;
    for (const m of HOST_MODES) x = button(x, y, m, () => host.setMode(m), m === host.mode);
    x = panel.x + 6;
    x = button(x, y + 14, 'list', listDesktop, false);
    x = button(x, y + 14, 'fish', () => { st.fishing = !st.fishing; host.setFishing(st.fishing); }, st.fishing);
    if (host.kind === 'electron') button(x, y + 14, 'quit', () => host.quit(), false);

    if (st.cursor) {
      const r = 4 + Math.sin(t * 6) * 1.5;
      g.strokeStyle = st.fishing ? '#ffd27a' : '#7fd6c8';
      g.beginPath();
      g.arc(st.cursor.x + 0.5, st.cursor.y + 0.5, r, 0, Math.PI * 2);
      g.stroke();
    }
    requestAnimationFrame(draw);
  }
  draw();
  window.__hostReady = true;
}
