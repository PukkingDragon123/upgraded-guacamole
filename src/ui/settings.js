// Settings (Frutiger Aero): a sky-glass window with two frosted cards. Left: sound sliders (icons only,
// names in tooltips), fullscreen, day-cycle orbs and glossy switches. Right: save (export / import /
// reset), keyboard keycaps with icons and a one-line privacy note. Esc opens it when nothing else is open.

import { rgba } from '../core/color.js';
import { drawText, measureText } from '../gfx/font.js';
import { drawToggle, TOGGLE_W, TOGGLE_H } from './panels.js';
import { getUiIcon } from '../gfx/uiicons.js';
import { getBigIcon } from '../gfx/bigicons.js';
import { AERO, aeroCached, aeroSurface, drawAeroFrame, drawAeroCard } from './aero.js';
import { exportState, importState, resetState, saveState } from '../game/state.js';
import { host } from '../platform/host.js';

const INK = AERO.ink, INK_SOFT = AERO.inkSoft;
const KEYS = [['L', 'sparkle', 'The Lab'], ['A', 'tank', 'Aquarium'], ['J', 'book', 'FishDex'], ['I', 'trophy', 'Satchel'], ['T', 'map', 'Map'], ['S', 'shop', 'Bait Shop'],
  ['B', 'bait', 'Bait'], ['P', 'pause', 'Pause'], ['Spc', 'storm', 'Shock'], ['Esc', 'cross', 'Menu']];
const CYCLES = [['real', 'clock', 'Real time'], ['fast', 'arrow_r', 'Fast days'], ['day', 'sun', 'Always day'], ['night', 'moon', 'Always night']];
const VOLS = [['master', 'sound', 'Master'], ['music', 'music', 'Music'], ['sfx', 'sparkle', 'Effects'], ['ambience', 'rain', 'Ambience']];
const TOGGLES = [
  ['reducedMotion', 'zzz', 'Calm', 'Calmer animations, no shake'],
  ['lowPower', 'sun', 'Eco', 'Lower frame rate, fewer effects'],
  ['showFps', 'clock', 'FPS', 'Frame counter (F3)'],
  ['browserFish', 'fish', 'Web fish', 'Fish visit your web pages (extension)'],
  ['hints', 'question', 'Tips', 'Pinch pops up with tips'],
];

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
    const W = Math.min(g.screen.W - 24, 452), H = Math.min(g.screen.H - 40, 288);
    const r = { x: Math.round((g.screen.W - W) / 2), y: Math.round((g.screen.H - H) / 2) - 8, w: W, h: H };
    this.rect = r;
    const F = drawAeroFrame(ctx, r.x, r.y, W, H, { title: 'Settings', icon: getBigIcon('settings', { size: 'small' }).canvas, seed: 3 });
    if (ui.button(ctx, F.close.x, F.close.y, F.close.w, F.close.h, '', { icon: 'cross', tip: 'Close (Esc)' })) { ui.close(this.id); return; }

    const colW = Math.floor((F.content.w - 6) / 2);
    const L = { x: F.content.x, y: F.content.y, w: colW, h: F.content.h };
    const R = { x: F.content.x + colW + 6, y: F.content.y, w: F.content.w - colW - 6, h: F.content.h };
    drawAeroCard(ctx, L.x, L.y, L.w, L.h, { seed: 1 });
    drawAeroCard(ctx, R.x, R.y, R.w, R.h, { seed: 2 });

    // ------------------------------------------------ sound
    let y = L.y + 8;
    for (const [key, icon, name] of VOLS) {
      const ic = getUiIcon(key === 'master' && s.master <= 0.001 ? 'mute' : icon);
      const ir = { x: L.x + 6, y: y - 2, w: 16, h: 14 };
      ctx.drawImage(ic, L.x + 8, y - 1);
      if (ui.hover(ir)) ui.tip = name;
      const sx = L.x + 26, sw = L.w - 26 - 34;
      const v = ui.slider(ctx, sx, y - 4, sw, s[key], 'vol_' + key);
      if (Math.abs(v - s[key]) > 0.001) {
        s[key] = Math.round(v * 100) / 100;
        g.applyVolumes?.();
        this.dirty = key;
      }
      drawText(ctx, `${Math.round(s[key] * 100)}`, L.x + L.w - 8, y + 1, { align: 'right', color: INK_SOFT });
      y += 19;
    }
    if (this.dirty && !g.input.down) {
      g.audio.play(this.dirty === 'music' || this.dirty === 'ambience' ? 'bubble' : 'ui_click', { vol: 0.8 });
      this.dirty = null;
      g.save?.();
    }
    this.divider(ctx, L.x + 8, y - 3, L.w - 16);

    // ------------------------------------------------ display
    y += 1;
    {
      const row = { x: L.x + 4, y: y - 3, w: L.w - 8, h: TOGGLE_H };
      const hov = ui.hover(row);
      const fs = this.isFullscreen();
      if (hov) {
        ctx.drawImage(aeroCached(`setrow|${row.w}|${row.h}`, () => aeroSurface(row.w, row.h, { tone: 'white', r: 6, gloss: 0.5, glossH: 9, rim: 0.6, glow: 0.4, a: [0.7, 0.7] })), row.x, row.y);
        ui.tip = 'Fullscreen (F11 / Alt+Enter)';
      }
      ctx.drawImage(getUiIcon(fs ? 'minimize' : 'expand'), L.x + 8, y + 3);
      drawText(ctx, 'Fullscreen', L.x + 24, y + 5, { color: INK });
      drawToggle(ctx, L.x + L.w - TOGGLE_W - 8, y - 3, fs, { hover: hov });
      if (hov && g.input.pressed) {
        g.input.pressed = false;
        g.audio.play('ui_toggle');
        g.command?.('fullscreen');
      }
    }
    y += 22;
    // day cycle: four glossy orbs
    {
      const bw = 24, gap = 6, x0 = L.x + Math.round((L.w - (bw * 4 + gap * 3)) / 2);
      CYCLES.forEach(([id, icon, tip], i) => {
        const on = s.dayCycle === id;
        if (ui.button(ctx, x0 + i * (bw + gap), y, bw, 20, '', { icon, style: on ? 'green' : 'glass', active: on, tip, sound: 'ui_toggle' }) && !on) {
          s.dayCycle = id;
          g.emit?.('settings', 'dayCycle');
          g.save?.();
        }
      });
    }
    y += 26;
    this.divider(ctx, L.x + 8, y - 3, L.w - 16);
    y += 2;
    // switches
    for (const [key, icon, label, tip] of TOGGLES) {
      const row = { x: L.x + 4, y: y - 1, w: L.w - 8, h: TOGGLE_H };
      const hov = ui.hover(row);
      if (hov) {
        ctx.drawImage(aeroCached(`setrow|${row.w}|${row.h}`, () => aeroSurface(row.w, row.h, { tone: 'white', r: 6, gloss: 0.5, glossH: 9, rim: 0.6, glow: 0.4, a: [0.7, 0.7] })), row.x, row.y);
        ui.tip = tip;
      }
      ctx.drawImage(getUiIcon(icon), L.x + 8, y + 5);
      drawText(ctx, label, L.x + 24, y + 7, { color: INK });
      drawToggle(ctx, L.x + L.w - TOGGLE_W - 8, y - 1, !!s[key], { hover: hov });
      if (hov && g.input.pressed) {
        g.input.pressed = false;
        s[key] = !s[key];
        g.audio.play('ui_toggle');
        if (key === 'lowPower') g.lowPower = !!s.lowPower;
        g.emit?.('settings', key);
        g.save?.();
      }
      y += TOGGLE_H - 1;
    }

    // ------------------------------------------------ save
    let ry = R.y + 8;
    this.heading(ctx, 'Save', R.x + 8, ry, 'home');
    ry += 14;
    const bw = Math.floor((R.w - 22) / 3);
    if (ui.button(ctx, R.x + 7, ry, bw, 20, 'Export', { icon: 'arrow_u', style: 'aqua', font: 'small', tip: 'Copy a backup code' })) this.exportSave();
    if (ui.button(ctx, R.x + 11 + bw, ry, bw, 20, 'Import', { icon: 'arrow_d', style: 'aqua', font: 'small', tip: 'Paste a backup code' })) this.importSave();
    const armed = this.armReset > 0;
    if (ui.button(ctx, R.x + 15 + bw * 2, ry, bw, 20, armed ? 'Sure?' : 'Reset', { icon: armed ? 'exclaim' : 'trash', style: armed ? 'red' : 'white', font: 'small', tip: armed ? 'Click again to erase everything' : 'Start over' })) {
      if (!armed) { this.armReset = 4; g.audio.play('ui_error'); }
      else this.resetSave();
    }
    ry += 26;
    if (this.code) {
      const bx = R.x + 7, bwid = R.w - 14;
      drawAeroCard(ctx, bx, ry, bwid, 22, { tone: 'white', inset: true, gloss: 0 });
      let shown = this.code.slice(0, 200);
      while (measureText(shown, 'small') > bwid - 54 && shown.length) shown = shown.slice(0, -1);
      drawText(ctx, shown + '..', bx + 5, ry + 4, { font: 'small', color: INK_SOFT });
      drawText(ctx, `${Math.round(this.code.length / 1024 * 10) / 10} KB`, bx + 5, ry + 13, { font: 'small', color: AERO.inkFaint });
      if (ui.button(ctx, bx + bwid - 44, ry + 3, 40, 16, this.copied ? '' : 'Copy', { icon: this.copied ? 'check' : null, style: 'green', font: 'small' })) this.copy();
      ry += 28;
    }

    // ------------------------------------------------ keys
    this.divider(ctx, R.x + 8, ry - 2, R.w - 16);
    ry += 4;
    this.heading(ctx, 'Keys', R.x + 8, ry, 'mouse_l');
    ry += 15;
    const half = Math.floor((R.w - 16) / 2);
    KEYS.forEach(([key, icon, name], i) => {
      const kx = R.x + 10 + (i % 2) * half, ky = ry + Math.floor(i / 2) * 20;
      const kw = this.keycap(ctx, kx, ky, key);
      const ic = getUiIcon(icon);
      ctx.drawImage(ic, kx + kw + 5, ky + Math.round((13 - ic.height) / 2));
      drawText(ctx, name, kx + kw + 7 + ic.width, ky + 3, { font: 'small', color: INK_SOFT });
    });
    ry += Math.ceil(KEYS.length / 2) * 17 + 4;

    // ------------------------------------------------ privacy
    const ny = R.y + R.h - 22;
    ctx.drawImage(aeroCached(`setnote|${R.w - 14}`, () => aeroSurface(R.w - 14, 16, { tone: 'grass', r: 'pill', gloss: 0.7, glossH: 7, curve: 1, rim: 0.8, glow: 0.6 })), R.x + 7, ny);
    ctx.drawImage(getUiIcon('heart'), R.x + 13, ny + 4);
    drawText(ctx, 'Saved on this device', R.x + 27, ny + 5, { font: 'small', color: '#ffffff', shadow: '#1c5a0e' });
    F.finish();
  }

  isFullscreen() {
    try { return host.isFullscreen ? !!host.isFullscreen() : !!document.fullscreenElement; } catch { return false; }
  }

  divider(ctx, x, y, w) {
    ctx.fillStyle = rgba('#5aa2cc', 0.35);
    ctx.fillRect(x, y, w, 1);
    ctx.fillStyle = rgba('#ffffff', 0.9);
    ctx.fillRect(x, y + 1, w, 1);
  }

  heading(ctx, text, x, y, icon) {
    ctx.drawImage(getUiIcon(icon), x, y - 2);
    drawText(ctx, text.toUpperCase(), x + 14, y, { font: 'small', color: AERO.aquaDeep });
  }

  keycap(ctx, x, y, key) {
    const w = Math.max(15, measureText(key, 'small') + 9);
    ctx.drawImage(aeroCached(`keycap|${w}`, () => aeroSurface(w, 13, { tone: 'white', r: 3, gloss: 0.8, glossH: 6, curve: 1, rim: 0.8, glow: 0.5 })), x, y);
    drawText(ctx, key, x + Math.round(w / 2), y + 4, { align: 'center', font: 'small', color: INK });
    return w;
  }

  exportSave() {
    const g = this.game;
    try {
      g.save?.();
      this.code = exportState(g.state);
      this.copy();
    } catch {
      g.toast('Export failed', 'cross');
    }
  }

  copy() {
    const g = this.game;
    if (!this.code) return;
    const ok = () => { this.copied = 2; g.audio.play('ui_buy', { vol: 0.5 }); g.toast('Copied!', 'check'); };
    try {
      if (navigator.clipboard?.writeText) navigator.clipboard.writeText(this.code).then(ok, () => window.prompt('Copy your save code:', this.code));
      else window.prompt('Copy your save code:', this.code);
    } catch {
      g.toast('Copy failed', 'cross');
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
      g.toast('Imported! Reloading...', 'check');
      setTimeout(() => location.reload(), 600);
    } catch {
      g.audio.play('ui_error');
      g.toast('Not a FISHTOP save', 'cross');
    }
  }

  resetSave() {
    const g = this.game;
    g.state = resetState();
    saveState(g.state);
    g.audio.play('splash_big');
    g.toast('Fresh start!', 'info');
    setTimeout(() => location.reload(), 600);
  }
}
