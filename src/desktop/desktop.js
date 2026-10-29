// Simulated desktop: icon grid, drag & drop (incl. into the bait box), windows, taskbar and start menu.
// All icon effects (theft, black-hole pull, flood bob, nibbles) are visual and reversible.

import { clamp, lerp, dist, damp, rectContains } from '../core/math.js';
import { rng } from '../core/rng.js';
import { rgba } from '../core/color.js';
import { drawText, measureText } from '../gfx/font.js';
import { APPS, getAppIcon, getMiniIcon, fileTypeInfo } from './icons.js';
import { drawWindowChrome, drawTaskbar, drawButton, drawWood, drawTooltip } from '../ui/panels.js';
import { getUiIcon } from '../gfx/uiicons.js';
import { APP_RENDERERS } from './apps.js';
import { makeBaitBoxSprites } from './baitbox.js';

export const CELL_W = 74, CELL_H = 62, ICON = 32;
export const TASKBAR_H = 24;

export class Desktop {
  constructor(game) {
    this.game = game;
    this.icons = APPS.filter((a) => !a.hidden).map((a, i) => ({
      id: a.id, label: a.label, type: a.type, icon: a.icon, app: a.app || a.id,
      gx: 0, gy: i, x: 0, y: 0, w: CELL_W - 8, h: CELL_H - 4,
      state: 'normal', offX: 0, offY: 0, shake: 0, hover: 0, sel: false, chewed: 0, alpha: 1,
    }));
    this.windows = [];
    this.drag = null;
    this.selected = null;
    this.startOpen = false;
    this.box = { x: 0, y: 0, w: 52, h: 34, open: 0, bounce: 0, hover: false };
    this.boxSprites = makeBaitBoxSprites();
    this.layoutDirty = true;
    this.time = 0;
    this.tooltip = null;
    this.visible = true;
  }

  get W() { return this.game.screen.W; }
  get H() { return this.game.screen.H; }

  rows() {
    return Math.max(3, Math.floor((this.H - TASKBAR_H - 70) / CELL_H));
  }

  cellPos(gx, gy) {
    return { x: 12 + gx * CELL_W, y: 10 + gy * CELL_H };
  }

  layout() {
    const saved = this.game.state.icons || {};
    const rows = this.rows();
    const taken = new Set();
    let auto = 0;
    for (const ic of this.icons) {
      const s = saved[ic.id];
      let gx, gy;
      if (s && s.gy < rows && !taken.has(s.gx + ',' + s.gy)) { gx = s.gx; gy = s.gy; }
      else {
        while (taken.has(Math.floor(auto / rows) + ',' + (auto % rows))) auto++;
        gx = Math.floor(auto / rows); gy = auto % rows;
        auto++;
      }
      taken.add(gx + ',' + gy);
      ic.gx = gx; ic.gy = gy;
      const p = this.cellPos(gx, gy);
      ic.x = p.x + 4; ic.y = p.y;
    }
    this.box.x = 14;
    this.box.y = this.H - TASKBAR_H - this.box.h - 6;
    this.layoutDirty = false;
  }

  onResize() {
    this.layoutDirty = true;
    for (const w of this.windows) {
      w.x = clamp(w.x, 0, this.W - 60);
      w.y = clamp(w.y, 0, this.H - TASKBAR_H - 20);
    }
  }

  // ------------------------------------------------------------ queries used by fish/fishing
  visibleIcons() {
    return this.icons.filter((i) => i.state === 'normal' || i.state === 'dragging');
  }

  iconRects() {
    return this.icons.filter((i) => i.state === 'normal').map((i) => ({ x: i.x + 17 + i.offX, y: i.y + i.offY, w: ICON, h: ICON, icon: i, get shake() { return i.shake; }, set shake(v) { i.shake = v; } }));
  }

  windowRects() {
    return this.windows.filter((w) => !w.min).map((w) => ({ x: w.x, y: w.y, w: w.w, h: w.h }));
  }

  freeSlot() {
    const rows = this.rows();
    const taken = new Set(this.icons.map((i) => i.gx + ',' + i.gy));
    for (let gx = 0; gx < 4; gx++) for (let gy = 0; gy < rows; gy++) {
      if (!taken.has(gx + ',' + gy)) {
        const p = this.cellPos(gx, gy);
        return { x: p.x + 4 + 33, y: p.y + 16, gx, gy };
      }
    }
    return null;
  }

  randomStealable() {
    const list = this.icons.filter((i) => i.state === 'normal' && i.id !== 'fishtop');
    return list.length ? rng.pick(list) : null;
  }

  stealIcon(ic, fish) {
    if (ic.state !== 'normal') return false;
    ic.state = 'stolen';
    ic.thief = fish;
    ic.stolenAt = this.time;
    this.game.toast(`A thief fish stole "${ic.label}"! Catch it to get it back.`, 'skull');
    return true;
  }

  returnIcon(ic, quiet = false) {
    if (ic.state !== 'stolen') return;
    ic.state = 'normal';
    ic.thief = null;
    ic.shake = 0.6;
    ic.alpha = 0;
    if (!quiet) this.game.toast(`"${ic.label}" is back on your desktop.`, 'check');
    else this.game.toast(`The thief dropped "${ic.label}". It floated back.`, 'check');
    this.game.audio.play('icon_drop');
  }

  restoreAll() {
    for (const ic of this.icons) {
      if (ic.state === 'stolen') { if (ic.thief) ic.thief.carry = null; this.returnIcon(ic, true); }
      if (ic.state === 'inBox') ic.state = 'normal';
      ic.offX = ic.offY = 0;
    }
    this.game.state.baitBox = [];
    if (this.game.state.equipped?.kind === 'icon') this.game.state.equipped = null;
    this.game.toast('All icons restored to the desktop.', 'home');
  }

  putInBox(ic) {
    const st = this.game.state;
    const cap = this.game.stats.boxSlots;
    if (st.baitBox.length >= cap) {
      this.game.toast(`Bait box is full (${cap} slots). Upgrade it in the skill tree!`, 'cross');
      this.game.audio.play('ui_error');
      return false;
    }
    ic.state = 'inBox';
    if (!st.baitBox.includes(ic.id)) st.baitBox.push(ic.id);
    if (!st.equipped) st.equipped = { kind: 'icon', id: ic.id };
    this.box.bounce = 1;
    this.game.audio.play('icon_box');
    this.game.particles.burst(this.box.x + this.box.w / 2, this.box.y + 6, 12, { colors: ['#ffe8a8', '#c8945a', '#ffffff'], speed: 60, g: 80, life: 0.6, up: 20 });
    this.game.emit('iconBoxed', ic);
    return true;
  }

  takeFromBox(id) {
    const ic = this.icons.find((i) => i.id === id);
    const st = this.game.state;
    st.baitBox = st.baitBox.filter((x) => x !== id);
    if (st.equipped?.kind === 'icon' && st.equipped.id === id) st.equipped = null;
    if (ic) { ic.state = 'normal'; ic.alpha = 0; this.layoutDirty = true; }
  }

  iconById(id) { return this.icons.find((i) => i.id === id); }

  // ------------------------------------------------------------ windows
  openApp(appId, opts = {}) {
    const existing = this.windows.find((w) => w.app === appId);
    if (existing) { existing.min = false; this.focus(existing); return existing; }
    const R = APP_RENDERERS[appId] || APP_RENDERERS.generic;
    const def = APPS.find((a) => (a.app || a.id) === appId) || { label: appId, icon: 'folder' };
    const size = R.size || [300, 200];
    const n = this.windows.length;
    const w = {
      id: appId + Date.now(), app: appId, title: R.title || def.label, icon: def.icon,
      x: opts.x ?? clamp(this.W * 0.3 + n * 18, 100, this.W - size[0] - 10),
      y: opts.y ?? clamp(60 + n * 16, 10, this.H - size[1] - TASKBAR_H - 10),
      w: size[0], h: size[1], min: false, open: 0, data: {}, scroll: 0,
    };
    R.init?.(w, this.game);
    this.windows.push(w);
    this.game.audio.play('window_open');
    return w;
  }

  closeWindow(w) {
    this.windows = this.windows.filter((x) => x !== w);
    APP_RENDERERS[w.app]?.close?.(w, this.game);
    this.game.audio.play('window_close');
  }

  focus(w) {
    this.windows = this.windows.filter((x) => x !== w);
    this.windows.push(w);
  }

  windowAt(x, y) {
    for (let i = this.windows.length - 1; i >= 0; i--) {
      const w = this.windows[i];
      if (!w.min && rectContains(w, x, y)) return w;
    }
    return null;
  }

  iconAt(x, y) {
    for (const ic of this.icons) {
      if (ic.state !== 'normal') continue;
      if (x >= ic.x + 8 && x < ic.x + ic.w - 8 && y >= ic.y && y < ic.y + ic.h) return ic;
    }
    return null;
  }

  overBox(x, y) {
    const b = this.box;
    return x >= b.x - 6 && x < b.x + b.w + 6 && y >= b.y - 14 && y < b.y + b.h + 4;
  }

  // What is under the pointer (top-most first). Used by the game's input router.
  hit(x, y) {
    if (y >= this.H - TASKBAR_H) return 'taskbar';
    if (this.startOpen && rectContains(this.startRect(), x, y)) return 'start';
    if (this.windowAt(x, y)) return 'window';
    if (this.overBox(x, y)) return 'box';
    if (this.iconAt(x, y)) return 'icon';
    return null;
  }

  // ------------------------------------------------------------ update / input
  update(dt, inp, layer) {
    this.time += dt;
    if (this.layoutDirty) this.layout();
    const g = this.game;
    for (const ic of this.icons) {
      ic.shake = Math.max(0, ic.shake - dt);
      ic.hover = damp(ic.hover, 0, 10, dt);
      ic.alpha = Math.min(1, ic.alpha + dt * 2);
      if (ic.state === 'normal' && !ic.pull) { ic.offX = damp(ic.offX, 0, 6, dt); ic.offY = damp(ic.offY, 0, 6, dt); }
      ic.pull = false;
    }
    for (const w of this.windows) w.open = Math.min(1, w.open + dt * 6);
    this.box.bounce = Math.max(0, this.box.bounce - dt * 2.5);
    const draggingIcon = this.drag?.kind === 'icon' && this.drag.moved;
    this.box.hover = this.overBox(inp.x, inp.y) && (layer === 'box' || draggingIcon);
    this.box.open = damp(this.box.open, this.box.hover || draggingIcon ? 1 : 0, 10, dt);
    this.tooltip = null;

    // continuing drags
    if (this.drag) { this.updateDrag(dt, inp); return true; }

    if (!layer) {
      if (inp.pressed) { this.selected = null; this.startOpen = false; }
      return false;
    }
    if (layer === 'taskbar' || layer === 'start') return this.updateTaskbar(inp, layer);
    if (this.startOpen && inp.pressed) this.startOpen = false;
    if (layer === 'window') return this.updateWindows(dt, inp);
    if (layer === 'box') {
      if (inp.pressed) { g.ui.open('bait'); inp.consume(); }
      this.tooltip = 'Bait Box - drag icons here!';
      return true;
    }
    if (layer === 'icon') {
      const ic = this.iconAt(inp.x, inp.y);
      if (!ic) return false;
      ic.hover = 1;
      if (ic.mimic) this.tooltip = 'totally_real_app.exe';
      if (inp.dblclick) {
        g.emit('iconOpen', ic);
        if (!g.handleIconOpen?.(ic)) this.openApp(ic.app);
        inp.consume();
        return true;
      }
      if (inp.pressed) {
        this.selected = ic;
        this.drag = { kind: 'icon', ic, sx: inp.x, sy: inp.y, ox: inp.x - ic.x, oy: inp.y - ic.y, moved: false };
        g.audio.play('icon_pickup', { vol: 0.5 });
      }
      return true;
    }
    return false;
  }

  updateDrag(dt, inp) {
    const d = this.drag, g = this.game;
    if (d.kind === 'icon') {
      const ic = d.ic;
      if (!d.moved && dist(inp.x, inp.y, d.sx, d.sy) > 4) { d.moved = true; ic.state = 'dragging'; }
      if (d.moved) {
        ic.x = inp.x - d.ox; ic.y = inp.y - d.oy;
      }
      if (!inp.down) {
        if (d.moved) {
          if (this.overBox(inp.x, inp.y)) {
            if (!this.putInBox(ic)) ic.state = 'normal';
            this.layoutDirty = true;
          } else {
            ic.state = 'normal';
            this.dropIcon(ic, inp.x - d.ox + ic.w / 2, inp.y - d.oy + ic.h / 2);
            g.audio.play('icon_drop', { vol: 0.6 });
          }
        }
        this.drag = null;
      }
      return true;
    }
    if (d.kind === 'window') {
      const w = d.win;
      w.x = clamp(inp.x - d.ox, -w.w + 50, this.W - 50);
      w.y = clamp(inp.y - d.oy, 0, this.H - TASKBAR_H - 16);
      if (!inp.down) this.drag = null;
      return true;
    }
    if (d.kind === 'custom') {
      d.move?.(inp);
      if (!inp.down) { d.end?.(inp); this.drag = null; }
      return true;
    }
    return true;
  }

  dropIcon(ic, cx, cy) {
    const rows = this.rows();
    const gx = clamp(Math.round((cx - 12 - CELL_W / 2) / CELL_W), 0, Math.floor((this.W - 100) / CELL_W));
    const gy = clamp(Math.round((cy - 10 - CELL_H / 2) / CELL_H), 0, rows - 1);
    const other = this.icons.find((o) => o !== ic && o.gx === gx && o.gy === gy && o.state !== 'inBox');
    if (other) { other.gx = ic.gx; other.gy = ic.gy; this.game.state.icons[other.id] = { gx: other.gx, gy: other.gy }; }
    ic.gx = gx; ic.gy = gy;
    this.game.state.icons[ic.id] = { gx, gy };
    this.layoutDirty = true;
  }

  updateWindows(dt, inp) {
    const w = this.windowAt(inp.x, inp.y);
    if (!w) return false;
    const ch = this.chromeRects(w);
    const R = APP_RENDERERS[w.app] || APP_RENDERERS.generic;
    if (inp.pressed) {
      this.focus(w);
      if (rectContains(ch.close, inp.x, inp.y)) { this.closeWindow(w); inp.consume(); return true; }
      if (rectContains(ch.min, inp.x, inp.y)) { w.min = true; this.game.audio.play('window_min'); inp.consume(); return true; }
      if (rectContains(ch.titleBar, inp.x, inp.y)) {
        this.drag = { kind: 'window', win: w, ox: inp.x - w.x, oy: inp.y - w.y };
        inp.consume();
        return true;
      }
    }
    if (rectContains(ch.content, inp.x, inp.y)) {
      R.input?.(w, this.game, inp, ch.content);
      if (inp.wheel && R.scroll) w.scroll = clamp(w.scroll + inp.wheel * 14, 0, R.scroll(w, ch.content));
    }
    return true;
  }

  chromeRects(w) {
    const t = 13;
    return {
      titleBar: { x: w.x, y: w.y, w: w.w - 30, h: t },
      close: { x: w.x + w.w - 14, y: w.y + 2, w: 11, h: 10 },
      min: { x: w.x + w.w - 27, y: w.y + 2, w: 11, h: 10 },
      content: { x: w.x + 3, y: w.y + t + 1, w: w.w - 6, h: w.h - t - 4 },
    };
  }

  // ------------------------------------------------------------ taskbar & start menu
  startRect() {
    const items = this.startItems();
    return { x: 2, y: this.H - TASKBAR_H - items.length * 16 - 30, w: 150, h: items.length * 16 + 28 };
  }

  startItems() {
    const g = this.game;
    return [
      { id: 'journal', label: 'Fish Journal', icon: 'book', key: 'J' },
      { id: 'tank', label: g.state.view === 'aquarium' ? 'Back to Ocean' : 'My Aquarium', icon: 'tank', key: 'A' },
      { id: 'skills', label: 'Coral Skill Tree', icon: 'coral', key: 'K' },
      { id: 'shop', label: "Cap'n Bloat's Shop", icon: 'shop', key: 'S' },
      { id: 'map', label: 'Travel Map', icon: 'map', key: 'T' },
      { id: 'bait', label: 'Bait Box', icon: 'bait', key: 'B' },
      { id: 'pause', label: g.paused ? 'Resume Fishing' : 'Pause Fishing', icon: g.paused ? 'play' : 'pause', key: 'P' },
      { id: 'mini', label: 'Mini Mode', icon: 'minimize', key: 'M' },
      { id: 'restore', label: 'Restore All Icons', icon: 'home' },
      { id: 'settings', label: 'Settings', icon: 'gear' },
    ];
  }

  trayRects() {
    const y = this.H - TASKBAR_H + 3, h = TASKBAR_H - 6;
    const right = this.W - 4;
    const clockW = 62;
    return {
      clock: { x: right - clockW, y, w: clockW, h },
      sound: { x: right - clockW - 22, y, w: 20, h },
      pause: { x: right - clockW - 44, y, w: 20, h },
      coins: { x: right - clockW - 130, y, w: 84, h },
    };
  }

  updateTaskbar(inp, layer) {
    const g = this.game;
    if (layer === 'start') {
      const r = this.startRect();
      const items = this.startItems();
      const i = Math.floor((inp.y - r.y - 22) / 16);
      this.startHover = i;
      if (inp.pressed && items[i]) {
        this.startOpen = false;
        g.audio.play('ui_click');
        g.command(items[i].id);
        inp.consume();
      }
      return true;
    }
    const sb = { x: 2, y: this.H - TASKBAR_H + 2, w: 72, h: TASKBAR_H - 4 };
    this.startHot = rectContains(sb, inp.x, inp.y);
    const tray = this.trayRects();
    this.trayHot = null;
    for (const [k, r] of Object.entries(tray)) if (rectContains(r, inp.x, inp.y)) this.trayHot = k;
    if (this.trayHot === 'pause') this.tooltip = g.paused ? 'Resume fishing (P)' : 'Pause fishing (P)';
    if (this.trayHot === 'sound') this.tooltip = g.muted ? 'Unmute' : 'Mute';
    if (this.trayHot === 'clock') this.tooltip = g.clockTooltip?.() || '';
    if (this.trayHot === 'coins') this.tooltip = 'Oxidized Coins';
    if (!inp.pressed) return true;
    inp.consume();
    if (this.startHot) { this.startOpen = !this.startOpen; g.audio.play('ui_click'); return true; }
    if (this.trayHot === 'pause') { g.command('pause'); return true; }
    if (this.trayHot === 'sound') { g.command('mute'); return true; }
    if (this.trayHot === 'clock') { g.command('map'); return true; }
    // window buttons
    for (const b of this.taskButtons()) {
      if (rectContains(b, inp.x, inp.y)) {
        const w = b.win;
        if (w.min) { w.min = false; this.focus(w); }
        else if (this.windows[this.windows.length - 1] === w) w.min = true;
        else this.focus(w);
        g.audio.play('ui_click');
        return true;
      }
    }
    this.startOpen = false;
    return true;
  }

  taskButtons() {
    const out = [];
    let x = 80;
    const y = this.H - TASKBAR_H + 3;
    const maxX = this.trayRects().coins.x - 6;
    for (const w of this.windows) {
      const bw = Math.min(110, Math.max(60, measureText(w.title) + 26));
      if (x + bw > maxX) break;
      out.push({ x, y, w: bw, h: TASKBAR_H - 6, win: w });
      x += bw + 3;
    }
    return out;
  }

  // ------------------------------------------------------------ drawing
  drawIcons(ctx) {
    const t = this.time;
    for (const ic of this.icons) {
      if (ic.state === 'inBox' || ic.state === 'stolen' || ic.state === 'dragging') continue;
      this.drawIcon(ctx, ic, ic.x + ic.offX, ic.y + ic.offY, t);
    }
  }

  drawIcon(ctx, ic, x, y, t, alpha = 1) {
    const sh = ic.shake > 0 ? Math.round(Math.sin(t * 50) * 2 * Math.min(1, ic.shake * 3)) : 0;
    const bob = ic.bob ? Math.round(Math.sin(t * 2 + ic.gy) * ic.bob) : 0;
    const ix = Math.round(x + (ic.w - ICON) / 2 + sh), iy = Math.round(y + 2 + bob);
    ctx.globalAlpha = alpha * ic.alpha;
    if (ic.hover > 0.05 || this.selected === ic) {
      ctx.fillStyle = rgba('#bfe8ff', this.selected === ic ? 0.28 : 0.16 * ic.hover);
      ctx.fillRect(Math.round(x + 4), Math.round(y), ic.w - 8, ic.h - 2);
    }
    const spr = getAppIcon(ic.icon, { size: ICON, state: ic.chewed > 0 ? 'chewed' : ic.id === 'trash' && this.game.trashFull ? 'full' : undefined });
    // soft drop shadow
    ctx.globalAlpha = alpha * ic.alpha * 0.35;
    ctx.drawImage(spr, ix + 1, iy + 2);
    ctx.globalAlpha = alpha * ic.alpha;
    ctx.drawImage(spr, ix, iy);
    const label = ic.label;
    const lw = measureText(label);
    const lx = Math.round(x + ic.w / 2), ly = Math.round(y + ICON + 6 + bob);
    if (this.selected === ic) {
      ctx.fillStyle = rgba('#2a6ab8', 0.85);
      ctx.fillRect(lx - Math.ceil(lw / 2) - 2, ly - 1, lw + 4, 10);
    }
    drawText(ctx, label, lx, ly, { align: 'center', color: '#ffffff', outline: this.selected === ic ? null : '#0b1a2a' });
    ctx.globalAlpha = 1;
  }

  drawDragged(ctx) {
    const d = this.drag;
    if (d?.kind === 'icon' && d.moved) this.drawIcon(ctx, d.ic, d.ic.x, d.ic.y, this.time, 0.85);
  }

  drawBox(ctx, dropY = 0) {
    const b = this.box;
    const s = this.boxSprites;
    const bounce = Math.sin(b.bounce * 12) * b.bounce * 3;
    const x = Math.round(b.x), y = Math.round(b.y - bounce + dropY);
    ctx.drawImage(s.body, x, y + 8);
    // lid opens with a hinge at the back
    const lidOpen = b.open;
    const lid = lidOpen > 0.5 ? s.lidOpen : s.lidClosed;
    ctx.drawImage(lid, x - 2, y + 8 - lid.height + (lidOpen > 0.5 ? 2 : 3));
    // contents peek
    const st = this.game.state;
    const n = st.baitBox.length;
    if (lidOpen > 0.5 && n) {
      for (let i = 0; i < Math.min(4, n); i++) {
        const ic = this.iconById(st.baitBox[i]);
        if (ic) ctx.drawImage(getMiniIcon(ic.icon), x + 6 + i * 11, y + 4);
      }
    }
    if (n) drawText(ctx, String(n), x + b.w - 4, y + b.h - 2, { font: 'small', color: '#fff3c4', outline: '#2a160a', align: 'right' });
  }

  drawWindows(ctx) {
    for (const w of this.windows) {
      if (w.min) continue;
      const k = w.open < 1 ? 0.9 + 0.1 * w.open : 1;
      const R = APP_RENDERERS[w.app] || APP_RENDERERS.generic;
      const active = this.windows[this.windows.length - 1] === w;
      if (k < 1) ctx.globalAlpha = w.open;
      // drop shadow
      ctx.fillStyle = 'rgba(5,15,30,0.35)';
      ctx.fillRect(w.x + 3, w.y + 4, w.w, w.h);
      const rects = drawWindowChrome(ctx, w, { title: w.title, iconCanvas: getMiniIcon(w.icon), active });
      const content = rects?.content || this.chromeRects(w).content;
      ctx.save();
      ctx.beginPath();
      ctx.rect(content.x, content.y, content.w, content.h);
      ctx.clip();
      R.draw(ctx, w, this.game, content, this.time);
      ctx.restore();
      ctx.globalAlpha = 1;
    }
  }

  drawTaskbar(ctx) {
    const g = this.game;
    const y = this.H - TASKBAR_H;
    drawTaskbar(ctx, 0, y, this.W, TASKBAR_H);
    // start button
    drawButton(ctx, 2, y + 2, 72, TASKBAR_H - 4, { label: 'FISHTOP', icon: getUiIcon('fish'), state: this.startOpen ? 'down' : this.startHot ? 'hover' : 'normal', style: 'wood' });
    for (const b of this.taskButtons()) {
      const active = this.windows[this.windows.length - 1] === b.win && !b.win.min;
      drawButton(ctx, b.x, b.y, b.w, b.h, { label: b.win.title, icon: getMiniIcon(b.win.icon), state: active ? 'down' : 'normal', style: 'glass', align: 'left' });
    }
    const tray = this.trayRects();
    // coins
    drawText(ctx, `{coin} ${g.coinDisplay()}`, tray.coins.x + tray.coins.w - 4, tray.coins.y + 5, { align: 'right', color: '#c8ffd8', shadow: '#0b1622' });
    ctx.drawImage(getUiIcon(g.paused ? 'play' : 'pause'), tray.pause.x + 5, tray.pause.y + 4);
    ctx.drawImage(getUiIcon(g.muted ? 'mute' : 'sound'), tray.sound.x + 5, tray.sound.y + 4);
    if (this.trayHot && this.trayHot !== 'coins' && this.trayHot !== 'clock') {
      const r = tray[this.trayHot];
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fillRect(r.x, r.y, r.w, r.h);
    }
    const d = new Date(g.clock.realNow());
    const hh = g.clock.hour();
    const timeStr = `${String(Math.floor(hh)).padStart(2, '0')}:${String(Math.floor((hh % 1) * 60)).padStart(2, '0')}`;
    ctx.drawImage(getUiIcon(g.clock.isNight() ? 'moon' : 'sun'), tray.clock.x + 2, tray.clock.y + 4);
    drawText(ctx, timeStr, tray.clock.x + tray.clock.w - 4, tray.clock.y + 5, { align: 'right', color: '#ffffff', shadow: '#0b1622' });
    void d;
    if (this.startOpen) this.drawStart(ctx);
  }

  drawStart(ctx) {
    const r = this.startRect();
    drawWood(ctx, r.x, r.y, r.w, r.h, { tone: 'dark' });
    drawText(ctx, 'FISHTOP', r.x + 10, r.y + 7, { color: '#ffe8a8', shadow: '#1a0e06' });
    this.startItems().forEach((it, i) => {
      const y = r.y + 22 + i * 16;
      if (this.startHover === i) {
        ctx.fillStyle = 'rgba(255,232,168,0.18)';
        ctx.fillRect(r.x + 4, y - 2, r.w - 8, 15);
      }
      ctx.drawImage(getUiIcon(it.icon), r.x + 8, y);
      drawText(ctx, it.label, r.x + 22, y + 1, { color: '#fff3dc', shadow: '#1a0e06' });
      if (it.key) drawText(ctx, it.key, r.x + r.w - 10, y + 2, { font: 'small', color: '#c8a878', align: 'right' });
    });
  }

  drawTooltip(ctx, inp) {
    if (this.tooltip) drawTooltip(ctx, inp.x + 10, inp.y + 12, this.tooltip);
  }
}

// Build virtual bait from dropped / listed files (names only; never reads contents).
export function fileBait(name, isDir) {
  const info = fileTypeInfo(name, isDir);
  return { id: 'file:' + name, name, icon: info.icon, type: info.type };
}
