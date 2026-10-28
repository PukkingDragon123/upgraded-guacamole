// Settings: a tackle-box lid of planks with two pinned paper sheets. Left: sound (rope sliders) and
// display (clam toggles, day-cycle shells). Right: icons & save data (export/import/reset), a keyboard
// shortcut card and a short privacy note.

import { clamp01 } from '../core/math.js';
import { rgba } from '../core/color.js';
import { drawText, measureText, wrapText } from '../gfx/font.js';
import { drawWood, drawPaper, drawToggle, TOGGLE_W, TOGGLE_H } from './panels.js';
import { getUiIcon } from '../gfx/uiicons.js';
import { exportState, importState, resetState, saveState } from '../game/state.js';

const INK = '#3a2516', INK_SOFT = '#7a5a40', INK_FAINT = '#a88a68';
const SHORTCUTS = [
  ['J', 'Journal'], ['K', 'Skill tree'], ['S', 'Shop'], ['T', 'Travel map'], ['B', 'Bait box'], ['A', 'Aquarium'],
  ['P', 'Pause fishing'], ['M', 'Mini mode'], ['F3', 'Show FPS'], ['Esc', 'Close panel'],
];
const CYCLES = [['real', 'Real', 'clock', 'Follows your clock'], ['fast', 'Fast', 'arrow_r', 'A full day every 24 minutes'], ['day', 'Day', 'sun', 'Always sunny'], ['night', 'Night', 'moon', 'Always night (glowing fish!)']];

export class SettingsPanel {
  constructor() {
    this.id = 'settings';
    this.modal = true;
    this.sound = 'ui_open';
    this.t = 0;
  }

  open() {
    this.t = 0;
    this.code = null;
    this.armReset = 0;
    this.copied = 0;
  }

  draw(ctx, ui, dt) {
    const g = this.game, s = g.state.settings;
    dt = Math.max(0, dt);
    this.t += dt;
    this.armReset = Math.max(0, this.armReset - dt);
    this.copied = Math.max(0, this.copied - dt);
    const W = Math.min(g.screen.W - 24, 600), H = Math.min(g.screen.H - 24, 380);
    const r = { x: Math.round((g.screen.W - W) / 2), y: Math.round((g.screen.H - H) / 2), w: W, h: H };
    this.rect = r;
    drawWood(ctx, r.x, r.y, W, H, { tone: 'light' });
    drawText(ctx, 'SETTINGS', r.x + W / 2, r.y + 8, { align: 'center', scale: 2, color: '#fff4dc', shadow: '#3a1e12' });
    ctx.drawImage(getUiIcon('gear'), Math.round(r.x + W / 2 - measureText('SETTINGS', 'normal', 2) / 2 - 20), r.y + 9);
    if (ui.button(ctx, r.x + W - 25, r.y + 6, 18, 17, '', { icon: 'cross', style: 'shell', tip: 'Close (Esc)' })) { ui.close(this.id); return; }

    const colW = Math.floor((W - 30) / 2);
    const L = { x: r.x + 10, y: r.y + 28, w: colW, h: H - 38 };
    const R = { x: r.x + 20 + colW, y: r.y + 28, w: colW, h: H - 38 };
    drawPaper(ctx, L.x, L.y, L.w, L.h, { aged: true });
    drawPaper(ctx, R.x, R.y, R.w, R.h, { aged: true });
    this.pin(ctx, L.x + L.w / 2, L.y);
    this.pin(ctx, R.x + R.w / 2, R.y);

    // ------------------------------------------------ sound
    let y = L.y + 10;
    this.heading(ctx, 'SOUND', L.x + 10, y, 'sound');
    y += 16;
    const vols = [['master', 'Master', 'sound'], ['music', 'Music', 'music'], ['sfx', 'Effects', 'sparkle'], ['ambience', 'Ambience', 'rain']];
    for (const [key, label, icon] of vols) {
      ctx.drawImage(getUiIcon(key === 'master' && s.master <= 0.001 ? 'mute' : icon), L.x + 10, y - 1);
      drawText(ctx, label, L.x + 24, y + 1, { color: INK });
      const sx = L.x + 84, sw = L.w - 84 - 36;
      const v = ui.slider(ctx, sx, y - 3, sw, s[key], 'vol_' + key);
      if (Math.abs(v - s[key]) > 0.001) {
        s[key] = Math.round(v * 100) / 100;
        g.applyVolumes();
        this.dirty = key;
      }
      drawText(ctx, `${Math.round(s[key] * 100)}%`, L.x + L.w - 10, y + 1, { align: 'right', color: INK_SOFT });
      y += 20;
    }
    // test blip when a volume slider is released
    if (this.dirty && !g.input.down) {
      g.audio.play(this.dirty === 'music' || this.dirty === 'ambience' ? 'bubble' : 'ui_click', { vol: 0.8 });
      this.dirty = null;
      g.save?.();
    }

    // ------------------------------------------------ display
    y += 4;
    this.heading(ctx, 'DISPLAY', L.x + 10, y, 'eye');
    y += 16;
    drawText(ctx, 'Ocean opacity', L.x + 10, y + 1, { color: INK });
    {
      const sx = L.x + 84, sw = L.w - 84 - 36;
      const v = ui.slider(ctx, sx, y - 3, sw, clamp01((s.oceanOpacity - 0.15) / 0.85), 'ocean');
      const nv = Math.round((0.15 + v * 0.85) * 100) / 100;
      if (Math.abs(nv - s.oceanOpacity) > 0.001) { s.oceanOpacity = nv; g.emit?.('settings', 'oceanOpacity'); }
      drawText(ctx, `${Math.round(s.oceanOpacity * 100)}%`, L.x + L.w - 10, y + 1, { align: 'right', color: INK_SOFT });
    }
    y += 20;
    drawText(ctx, 'Day cycle', L.x + 10, y + 5, { color: INK });
    {
      const bw = Math.floor((L.w - 84 - 10) / 4);
      CYCLES.forEach(([id, label, , tip], i) => {
        const bx = L.x + 84 + i * bw;
        const on = s.dayCycle === id;
        if (ui.button(ctx, bx, y, bw - 2, 17, label, { style: 'shell', active: on, font: 'small', tip, sound: 'ui_toggle' }) && !on) {
          s.dayCycle = id;
          g.emit?.('settings', 'dayCycle');
          g.save?.();
        }
      });
    }
    y += 24;
    const toggles = [
      ['reducedMotion', 'Reduced motion', 'Calmer animations and no screen shake'],
      ['lowPower', 'Low power', 'Caps the frame rate and trims effects (great on laptops)'],
      ['showFps', 'Show FPS', 'Frame counter in the corner (F3)'],
      ['browserFish', 'Browser fish', 'Let fish visit your web pages (browser extension)'],
      ['hints', 'Tips & hints', 'Pinch pops up with helpful tips now and then'],
    ];
    for (const [key, label, tip] of toggles) {
      const row = { x: L.x + 6, y, w: L.w - 12, h: TOGGLE_H };
      const hov = ui.hover(row);
      if (hov) { ctx.fillStyle = rgba('#fff8e0', 0.5); ctx.fillRect(row.x, row.y, row.w, row.h); ui.tip = tip; }
      drawText(ctx, label, L.x + 10, y + 8, { color: INK });
      drawToggle(ctx, L.x + L.w - TOGGLE_W - 10, y, !!s[key], { hover: hov });
      drawText(ctx, s[key] ? 'ON' : 'OFF', L.x + L.w - TOGGLE_W - 16, y + 9, { align: 'right', font: 'small', color: s[key] ? '#2a7a3a' : INK_FAINT });
      if (hov && g.input.pressed) {
        g.input.pressed = false;
        s[key] = !s[key];
        g.audio.play('ui_toggle');
        if (key === 'lowPower') g.lowPower = !!s.lowPower || !!g.mini;
        g.emit?.('settings', key);
        g.save?.();
      }
      y += TOGGLE_H + 1;
    }

    // ------------------------------------------------ save & icons
    let ry = R.y + 10;
    this.heading(ctx, 'ICONS & SAVE', R.x + 10, ry, 'home');
    ry += 16;
    const bw = Math.floor((R.w - 26) / 2);
    if (ui.button(ctx, R.x + 10, ry, bw, 20, 'Restore icons', { icon: 'home', style: 'wood', tip: 'Put every icon from the bait box back on the desktop' })) g.command('restore');
    if (ui.button(ctx, R.x + 16 + bw, ry, bw, 20, 'Export save', { icon: 'arrow_u', style: 'wood', tip: 'Get a code to back up or move your save' })) this.exportSave();
    ry += 24;
    if (ui.button(ctx, R.x + 10, ry, bw, 20, 'Import save', { icon: 'arrow_d', style: 'wood', tip: 'Paste a save code' })) this.importSave();
    const armed = this.armReset > 0;
    if (ui.button(ctx, R.x + 16 + bw, ry, bw, 20, armed ? 'Really reset?' : 'Reset save', { icon: armed ? 'exclaim' : 'trash', style: armed ? 'coral' : 'shell', tip: armed ? 'Click again to erase everything' : 'Start over from scratch' })) {
      if (!armed) { this.armReset = 4; g.audio.play('ui_error'); }
      else this.resetSave();
    }
    ry += 26;
    // export code box
    if (this.code) {
      const bx = R.x + 10, bwid = R.w - 20;
      ctx.fillStyle = '#2a1a10';
      ctx.fillRect(bx, ry, bwid, 22);
      ctx.fillStyle = '#f8f0dc';
      ctx.fillRect(bx + 1, ry + 1, bwid - 2, 20);
      let shown = this.code.slice(0, 200);
      while (measureText(shown, 'small') > bwid - 50 && shown.length) shown = shown.slice(0, -1);
      drawText(ctx, shown + '...', bx + 4, ry + 4, { font: 'small', color: INK_SOFT });
      drawText(ctx, `${Math.round(this.code.length / 1024 * 10) / 10} KB`, bx + 4, ry + 13, { font: 'small', color: INK_FAINT });
      if (ui.button(ctx, bx + bwid - 44, ry + 3, 40, 16, this.copied ? 'Copied' : 'Copy', { style: 'paper', font: 'small' })) this.copy();
      ry += 26;
    } else {
      drawText(ctx, 'Your save lives in this browser only.', R.x + 10, ry + 2, { color: INK_SOFT });
      ry += 14;
    }

    // ------------------------------------------------ shortcuts
    ry += 2;
    this.heading(ctx, 'SHORTCUTS', R.x + 10, ry, 'mouse_l');
    ry += 15;
    const half = Math.floor((R.w - 20) / 2);
    SHORTCUTS.forEach(([key, label], i) => {
      const kx = R.x + 10 + (i % 2) * half, ky = ry + Math.floor(i / 2) * 14;
      const kw = this.keycap(ctx, kx, ky, key);
      drawText(ctx, label, kx + kw + 4, ky + 3, { color: INK });
    });
    ry += Math.ceil(SHORTCUTS.length / 2) * 14 + 6;

    // ------------------------------------------------ privacy note
    const note = 'FISHTOP never opens, moves or reads your files. Icons in the bait box are virtual copies, and dropped files only lend their name.';
    const lines = wrapText(note, R.w - 34, 'normal');
    const ny = Math.max(ry, R.y + R.h - 12 - lines.length * 9 - 8);
    ctx.fillStyle = rgba('#7ad8a0', 0.18);
    ctx.fillRect(R.x + 8, ny - 3, R.w - 16, lines.length * 9 + 9);
    ctx.drawImage(getUiIcon('heart'), R.x + 11, ny);
    lines.forEach((l, i) => drawText(ctx, l, R.x + 25, ny + 1 + i * 9, { color: '#2a5a3a' }));
  }

  pin(ctx, x, y) {
    ctx.fillStyle = '#5a1010'; ctx.fillRect(Math.round(x) - 3, y - 3, 6, 6);
    ctx.fillStyle = '#d83a3a'; ctx.fillRect(Math.round(x) - 2, y - 2, 4, 4);
    ctx.fillStyle = '#ff9a8a'; ctx.fillRect(Math.round(x) - 2, y - 2, 2, 2);
  }

  heading(ctx, text, x, y, icon) {
    ctx.drawImage(getUiIcon(icon), x, y - 2);
    drawText(ctx, text, x + 14, y, { color: '#a8402e' });
    ctx.fillStyle = rgba('#a8402e', 0.4);
    ctx.fillRect(x + 14, y + 9, measureText(text) + 30, 1);
  }

  keycap(ctx, x, y, key) {
    const w = Math.max(13, measureText(key, 'small') + 8);
    ctx.fillStyle = '#2a1a10';
    ctx.fillRect(x, y, w, 12);
    ctx.fillStyle = '#f4ece0';
    ctx.fillRect(x + 1, y + 1, w - 2, 8);
    ctx.fillStyle = '#b8a890';
    ctx.fillRect(x + 1, y + 9, w - 2, 2);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x + 1, y + 1, w - 2, 1);
    drawText(ctx, key, x + Math.round(w / 2), y + 3, { align: 'center', font: 'small', color: INK });
    return w;
  }

  exportSave() {
    const g = this.game;
    try {
      g.save?.();
      this.code = exportState(g.state);
      this.copy();
    } catch {
      g.toast('Could not export the save.', 'cross');
    }
  }

  copy() {
    const g = this.game;
    if (!this.code) return;
    const ok = () => { this.copied = 2; g.audio.play('ui_buy', { vol: 0.5 }); g.toast('Save code copied to the clipboard!', 'check'); };
    try {
      if (navigator.clipboard?.writeText) navigator.clipboard.writeText(this.code).then(ok, () => window.prompt('Copy your save code:', this.code));
      else window.prompt('Copy your save code:', this.code);
    } catch {
      g.toast('Copy failed - try again.', 'cross');
    }
  }

  importSave() {
    const g = this.game;
    let code = null;
    try { code = window.prompt('Paste your FISHTOP save code:'); } catch { code = null; }
    if (!code) return;
    try {
      const st = importState(code);
      if (!st || typeof st !== 'object' || !st.settings) throw new Error('bad');
      g.state = st;
      saveState(st);
      g.toast('Save imported! Reloading...', 'check');
      setTimeout(() => location.reload(), 600);
    } catch {
      g.audio.play('ui_error');
      g.toast("That code doesn't look like a FISHTOP save.", 'cross');
    }
  }

  resetSave() {
    const g = this.game;
    g.state = resetState();
    saveState(g.state);
    g.audio.play('splash_big');
    g.toast('Fresh start! Reloading...', 'info');
    setTimeout(() => location.reload(), 600);
  }
}

