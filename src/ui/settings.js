// Settings (Frutiger Aero): a sky-glass window with two frosted cards. Left: sound sliders (icons, names in
// tooltips), the UI size switch (Normal / Big / Huge -> state.settings.uiScale, default Big), fullscreen, day-cycle
// orbs and glossy switches. Right: save (export / import / reset), keyboard keycaps with icons and a one-line privacy
// note. Esc opens it when nothing else is open. Text follows the UI size (uiFont).

import { rgba } from '../core/color.js';
import { drawText, measureText } from '../gfx/font.js';
import { drawToggle, TOGGLE_W, TOGGLE_H } from './panels.js';
import { getUiIcon } from '../gfx/uiicons.js';
import { getBigIcon } from '../gfx/bigicons.js';
import { AERO, aeroCached, aeroSurface, drawAeroFrame, drawAeroCard, drawAeroGlow, uiFont, capH, setUiScale, uiScaleMode } from './aero.js';
import { exportState, importState, resetState, saveState } from '../game/state.js';
import { host } from '../platform/host.js';
import { panelRect } from './ui.js';

const INK = AERO.ink, INK_SOFT = AERO.inkSoft;
const KEYS = [['L', 'sparkle', 'The Lab'], ['Q', 'star', 'Quests'], ['A', 'tank', 'Aquarium'], ['J', 'book', 'FishDex'], ['I', 'trophy', 'Satchel'], ['T', 'map', 'Map'],
  ['S', 'shop', 'Bait Shop'], ['B', 'bait', 'Bait'], ['P', 'pause', 'Pause'], ['Spc', 'storm', 'Shock'], ['Esc', 'cross', 'Menu']];
const CYCLES = [['real', 'clock', 'Real time'], ['fast', 'arrow_r', 'Fast days'], ['day', 'sun', 'Always day'], ['night', 'moon', 'Always night']];
const VOLS = [['master', 'sound', 'Master'], ['music', 'music', 'Music'], ['sfx', 'sparkle', 'Effects'], ['ambience', 'rain', 'Ambience']];
const SIZES = [['normal', 'Normal', 'Classic sizes'], ['big', 'Big', 'Bigger HUD and text (default)'], ['huge', 'Huge', 'Extra large HUD and text']];
const TOGGLES = [
  ['reducedMotion', 'zzz', 'Calm', 'Calmer animations, no shake'],
  ['lowPower', 'sun', 'Eco', 'Lower frame rate, fewer effects'],
  ['showFps', 'clock', 'FPS', 'Frame counter (F3)'],
  ['browserFish', 'fish', 'Web fish', 'Fish visit your web pages (extension)'],
  ['hints', 'question', 'Tips', 'Bubbles the seal pops up with tips'],
];

// a pixel icon at an integer zoom (2x on the bigger UI sizes), centred vertically on cy
function icon(ctx, name, x, cy, z) {
  const ic = getUiIcon(name);
  if (!ic) return 0;
  ctx.drawImage(ic, Math.round(x), Math.round(cy - (ic.height * z) / 2), ic.width * z, ic.height * z);
  return ic.width * z;
}

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
    setUiScale(s.uiScale || 'big');
    const big = uiScaleMode() !== 'normal';
    const F1 = uiFont('normal'), F2 = uiFont('small');
    const z = big ? 2 : 1;
    const RH = big ? 25 : 21; // row height
    const r = panelRect(g, big ? 600 : 470, big ? 404 : 318);
    const W = r.w, H = r.h;
    this.rect = r;
    const F = drawAeroFrame(ctx, r.x, r.y, W, H, { title: 'Settings', icon: getBigIcon('settings', { size: big ? 30 : 'small' }).canvas, seed: 3 });
    if (ui.button(ctx, F.close.x, F.close.y, F.close.w, F.close.h, '', { icon: 'cross', tip: 'Close (Esc)' })) { ui.close(this.id); return; }

    const colW = Math.floor((F.content.w - 6) / 2);
    const L = { x: F.content.x, y: F.content.y, w: colW, h: F.content.h };
    const R = { x: F.content.x + colW + 6, y: F.content.y, w: F.content.w - colW - 6, h: F.content.h };
    drawAeroCard(ctx, L.x, L.y, L.w, L.h, { seed: 1 });
    drawAeroCard(ctx, R.x, R.y, R.w, R.h, { seed: 2 });

    // ------------------------------------------------ sound
    let y = L.y + (big ? 8 : 6);
    for (const [key, ic, name] of VOLS) {
      const cy = y + Math.round(RH / 2);
      const ir = { x: L.x + 4, y, w: 12 * z + 6, h: RH };
      icon(ctx, key === 'master' && s.master <= 0.001 ? 'mute' : ic, L.x + 8, cy, z);
      if (ui.hover(ir)) ui.tip = name;
      const vw = measureText('100', F1) + 8;
      const sx = L.x + 14 + 11 * z, sw = L.w - (14 + 11 * z) - vw - 10;
      const v = ui.slider(ctx, sx, cy - 8, sw, s[key], 'vol_' + key);
      if (Math.abs(v - s[key]) > 0.001) {
        s[key] = Math.round(v * 100) / 100;
        g.applyVolumes?.();
        this.dirty = key;
      }
      drawText(ctx, `${Math.round(s[key] * 100)}`, L.x + L.w - 8, cy - Math.round(capH(F1) / 2), { font: F1, align: 'right', color: INK_SOFT });
      y += RH;
    }
    if (this.dirty && !g.input.down) {
      g.audio.play(this.dirty === 'music' || this.dirty === 'ambience' ? 'bubble' : 'ui_click', { vol: 0.8 });
      this.dirty = null;
      g.save?.();
    }
    this.divider(ctx, L.x + 8, y + 2, L.w - 16);
    y += 7;

    // ------------------------------------------------ UI size: three glossy segments
    {
      const cy = y + Math.round(RH / 2);
      const lw = icon(ctx, 'expand', L.x + 8, cy, z);
      drawText(ctx, 'UI size', L.x + 14 + lw, cy - Math.round(capH(F1) / 2), { font: F1, color: INK });
      const x0 = L.x + 18 + lw + measureText('UI size', F1);
      const bw = Math.floor((L.x + L.w - 8 - x0) / 3), bh = RH - 3;
      const cur = s.uiScale || 'big';
      SIZES.forEach(([id, label, tip], i) => {
        const on = cur === id;
        const bx = x0 + i * bw;
        if (on) drawAeroGlow(ctx, bx + bw / 2, cy, Math.round(bw * 0.6), '#c8ff9a', 0.5);
        if (ui.button(ctx, bx, cy - Math.round(bh / 2), bw - 2, bh, label, { style: on ? 'green' : 'white', active: on, tip, sound: 'ui_toggle', font: 'normal', fixedFont: id === 'normal' }) && !on) {
          s.uiScale = id;
          setUiScale(id);
          g.emit?.('settings', 'uiScale');
          g.save?.();
        }
      });
      y += RH + 2;
    }

    // ------------------------------------------------ display
    {
      const row = { x: L.x + 4, y, w: L.w - 8, h: RH };
      const cy = y + Math.round(RH / 2);
      const hov = ui.hover(row);
      const fs = this.isFullscreen();
      if (hov) {
        ctx.drawImage(aeroCached(`setrow|${row.w}|${row.h}`, () => aeroSurface(row.w, row.h, { tone: 'white', r: 6, gloss: 0.5, glossH: 9, rim: 0.6, glow: 0.4, a: [0.7, 0.7] })), row.x, row.y);
        ui.tip = 'Fullscreen (F11 / Alt+Enter)';
      }
      const lw = icon(ctx, fs ? 'minimize' : 'expand', L.x + 8, cy, z);
      drawText(ctx, 'Fullscreen', L.x + 14 + lw, cy - Math.round(capH(F1) / 2), { font: F1, color: INK });
      drawToggle(ctx, L.x + L.w - TOGGLE_W - 8, cy - Math.round(TOGGLE_H / 2), fs, { hover: hov });
      if (hov && g.input.pressed) {
        g.input.pressed = false;
        g.audio.play('ui_toggle');
        g.command?.('fullscreen');
      }
      y += RH + 2;
    }
    // day cycle: four glossy orbs
    {
      const bw = big ? 34 : 26, bh = big ? 26 : 21, gap = big ? 8 : 6, x0 = L.x + Math.round((L.w - (bw * 4 + gap * 3)) / 2);
      CYCLES.forEach(([id, ic, tip], i) => {
        const on = s.dayCycle === id;
        if (ui.button(ctx, x0 + i * (bw + gap), y, bw, bh, '', { icon: ic, style: on ? 'green' : 'glass', active: on, tip, sound: 'ui_toggle' }) && !on) {
          s.dayCycle = id;
          g.emit?.('settings', 'dayCycle');
          g.save?.();
        }
      });
      y += bh + 5;
    }
    this.divider(ctx, L.x + 8, y, L.w - 16);
    y += 4;
    // switches: two columns when the card is tall enough for only a few rows
    const rows = TOGGLES.length, room = L.y + L.h - y - 4;
    const twoCol = room < rows * RH;
    const cw = twoCol ? Math.floor((L.w - 8) / 2) : L.w - 8;
    TOGGLES.forEach(([key, ic, label, tip], i) => {
      const col = twoCol ? i % 2 : 0, rowI = twoCol ? Math.floor(i / 2) : i;
      const row = { x: L.x + 4 + col * cw, y: y + rowI * RH, w: cw, h: RH };
      const cy = row.y + Math.round(RH / 2);
      const hov = ui.hover(row);
      if (hov) {
        ctx.drawImage(aeroCached(`setrow|${row.w}|${row.h}`, () => aeroSurface(row.w, row.h, { tone: 'white', r: 6, gloss: 0.5, glossH: 9, rim: 0.6, glow: 0.4, a: [0.7, 0.7] })), row.x, row.y);
        ui.tip = tip;
      }
      const lw = icon(ctx, ic, row.x + 4, cy, z);
      const lf = measureText(label, F1) + lw + 14 + TOGGLE_W > cw ? 'normal' : F1;
      drawText(ctx, label, row.x + 9 + lw, cy - Math.round(capH(lf) / 2), { font: lf, color: INK });
      drawToggle(ctx, row.x + row.w - TOGGLE_W - 4, cy - Math.round(TOGGLE_H / 2), !!s[key], { hover: hov });
      if (hov && g.input.pressed) {
        g.input.pressed = false;
        s[key] = !s[key];
        g.audio.play('ui_toggle');
        if (key === 'lowPower') g.lowPower = !!s.lowPower;
        g.emit?.('settings', key);
        g.save?.();
      }
    });

    // ------------------------------------------------ save
    let ry = R.y + (big ? 9 : 8);
    ry += this.heading(ctx, 'Save', R.x + 8, ry, 'home', z, F2);
    const bh = big ? 24 : 20;
    const bw = Math.floor((R.w - 22) / 3);
    if (ui.button(ctx, R.x + 7, ry, bw, bh, 'Export', { icon: 'arrow_u', style: 'aqua', font: 'small', tip: 'Copy a backup code' })) this.exportSave();
    if (ui.button(ctx, R.x + 11 + bw, ry, bw, bh, 'Import', { icon: 'arrow_d', style: 'aqua', font: 'small', tip: 'Paste a backup code' })) this.importSave();
    const armed = this.armReset > 0;
    if (ui.button(ctx, R.x + 15 + bw * 2, ry, bw, bh, armed ? 'Sure?' : 'Reset', { icon: armed ? 'exclaim' : 'trash', style: armed ? 'red' : 'white', font: 'small', tip: armed ? 'Click again to erase everything' : 'Start over' })) {
      if (!armed) { this.armReset = 4; g.audio.play('ui_error'); }
      else this.resetSave();
    }
    ry += bh + 7;
    // [tut16] the fishing lesson: replay it (or end a replay that is running)
    const tut = g.tutorial;
    if (tut?.startLesson) {
      const running = tut.active && tut.mode === 'lesson';
      if (running || tut.canReplay?.()) {
        const label = running ? 'End fishing lesson' : 'Replay fishing tutorial';
        const tip = running ? 'Stop the lesson and fish freely' : 'Bubbles shows you how to fish, step by step';
        if (ui.button(ctx, R.x + 7, ry, R.w - 14, bh, label, { icon: running ? 'cross' : 'fish', style: running ? 'white' : 'green', font: 'small', tip })) {
          ui.close(this.id);
          if (running) tut.endLesson(false); else tut.startLesson('replay');
          return;
        }
        ry += bh + 7;
      }
    }
    if (this.code) {
      const bx = R.x + 7, bwid = R.w - 14, ch = big ? 28 : 22;
      drawAeroCard(ctx, bx, ry, bwid, ch, { tone: 'white', inset: true, gloss: 0 });
      let shown = this.code.slice(0, 200);
      while (measureText(shown, 'small') > bwid - 58 && shown.length) shown = shown.slice(0, -1);
      drawText(ctx, shown + '..', bx + 5, ry + 4, { font: 'small', color: INK_SOFT });
      drawText(ctx, `${Math.round(this.code.length / 1024 * 10) / 10} KB`, bx + 5, ry + ch - 9, { font: 'small', color: AERO.inkFaint });
      if (ui.button(ctx, bx + bwid - 48, ry + Math.round((ch - (big ? 20 : 16)) / 2), 44, big ? 20 : 16, this.copied ? '' : 'Copy', { icon: this.copied ? 'check' : null, style: 'green', font: 'small' })) this.copy();
      ry += ch + 6;
    }

    // ------------------------------------------------ keys
    this.divider(ctx, R.x + 8, ry - 2, R.w - 16);
    ry += 5;
    ry += this.heading(ctx, 'Keys', R.x + 8, ry, 'mouse_l', z, F2);
    const half = Math.floor((R.w - 16) / 2);
    const kf = big ? 'normal' : 'small', kh = capH(kf) + 7, krow = kh + (big ? 6 : 5);
    const nameF = F2;
    KEYS.forEach(([key, ic, name], i) => {
      const kx = R.x + 10 + (i % 2) * half, ky = ry + Math.floor(i / 2) * krow;
      const kw = this.keycap(ctx, kx, ky, key, kf);
      const iw = icon(ctx, ic, kx + kw + 4, ky + kh / 2, 1);
      let nf = nameF;
      if (kw + iw + 10 + measureText(name, nf) > half - 2) nf = 'small';
      drawText(ctx, name, kx + kw + 8 + iw, ky + Math.round((kh - capH(nf)) / 2), { font: nf, color: INK_SOFT });
    });

    // ------------------------------------------------ privacy
    const nh = big ? 20 : 16;
    const ny = R.y + R.h - nh - 6;
    ctx.drawImage(aeroCached(`setnote|${R.w - 14}|${nh}`, () => aeroSurface(R.w - 14, nh, { tone: 'grass', r: 'pill', gloss: 0.7, glossH: Math.round(nh * 0.45), curve: 1, rim: 0.8, glow: 0.6 })), R.x + 7, ny);
    const hw = icon(ctx, 'heart', R.x + 13, ny + nh / 2, 1);
    drawText(ctx, 'Saved on this device', R.x + 18 + hw, ny + Math.round((nh - capH(F2)) / 2), { font: F2, color: '#ffffff', shadow: '#1c5a0e' });
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

  // section heading: icon + caps label; returns the height it used
  heading(ctx, text, x, y, ic, z = 1, font = 'small') {
    const h = Math.max(capH(font), 10 * z) + 5;
    const w = icon(ctx, ic, x, y + h / 2 - 2, z);
    drawText(ctx, font === 'small' ? text.toUpperCase() : text, x + w + 5, y + Math.round((h - 4 - capH(font)) / 2), { font, color: AERO.aquaDeep, shadow: '#ffffff' });
    return h + 2;
  }

  keycap(ctx, x, y, key, font = 'small') {
    const h = capH(font) + 7;
    const w = Math.max(h + 2, measureText(key, font) + 10);
    ctx.drawImage(aeroCached(`keycap|${w}|${h}`, () => aeroSurface(w, h, { tone: 'white', r: 3, gloss: 0.8, glossH: Math.round(h * 0.45), curve: 1, rim: 0.8, glow: 0.5 })), x, y);
    drawText(ctx, key, x + Math.round(w / 2), y + Math.round((h - capH(font)) / 2), { align: 'center', font, color: INK });
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
