// UI manager: modal panel stack, immediate-mode widgets, toasts, coin counter and the seabed dock.
// Panels: { id, open(data), close(), draw(ctx, ui, dt) (immediate mode: draw + handle input), rect, modal }

import { clamp, clamp01, lerp, damp, ease, rectContains, formatCommas } from '../core/math.js';
import { rgba } from '../core/color.js';
import { drawText, measureText, wrapText } from '../gfx/font.js';
import { drawButton, drawSlider, drawToggle, drawTooltip, drawTab, drawWood, drawPlank } from './panels.js';
import { getUiIcon } from '../gfx/uiicons.js';
import { TabBar } from './tabbar.js';

export class UI {
  constructor(game) {
    this.game = game;
    this.panels = {};
    this.stack = [];
    this.toasts = [];
    this.tip = null;
    this.hot = null;
    this.prevHot = null;
    this.inp = game.input;
    this.time = 0;
    this.coinShown = 0;
    this.coinBump = 0;
    this.dockHover = -1;
    this.dock = [];
    this.flyers = []; // coins flying to the counter
    this.anim = 0;
  }

  register(panel) {
    this.panels[panel.id] = panel;
    panel.ui = this;
    panel.game = this.game;
  }

  get active() { return this.stack[this.stack.length - 1] || null; }
  get blocking() { return this.stack.some((p) => p.modal !== false); }

  isOpen(id) { return this.stack.some((p) => p.id === id); }

  open(id, data) {
    const p = this.panels[id];
    if (!p) return;
    if (this.isOpen(id)) { if (data !== undefined) p.open?.(data); return; }
    if (p.replace !== false) this.stack = this.stack.filter((q) => q.keep);
    p.anim = 0;
    p.closing = false;
    this.stack.push(p);
    p.open?.(data);
    this.game.audio.play(p.sound || 'ui_open');
    this.game.emit('panelOpen', id);
  }

  close(id) {
    const p = id ? this.panels[id] : this.active;
    if (!p || !this.isOpen(p.id)) return;
    this.stack = this.stack.filter((q) => q !== p);
    p.close?.();
    this.game.audio.play('ui_close');
    this.game.emit('panelClose', p.id);
  }

  togglePanel(id) { if (this.isOpen(id)) this.close(id); else this.open(id); }

  // Does the UI want the pointer at (x,y)? (checked before world input)
  hit(x, y) {
    if (this.blocking) return true;
    for (const p of this.stack) if (p.rect && rectContains(p.rect, x, y)) return true;
    if (this.dockHit(x, y) >= 0) return true;
    if (this.coinRect && rectContains(this.coinRect, x, y)) return true;
    if (this.tabbar?.hit(x, y)) return true;
    return false;
  }

  toast(text, icon = 'info', time = 3.5) {
    this.toasts.push({ text, icon, t: 0, max: time });
    if (this.toasts.length > 4) this.toasts.shift();
  }

  update(dt) {
    this.time += dt;
    for (const t of this.toasts) t.t += dt;
    this.toasts = this.toasts.filter((t) => t.t < t.max);
    const g = this.game;
    const diff = g.state.coins - this.coinShown;
    this.coinShown += Math.abs(diff) < 1 ? diff : diff * Math.min(1, dt * 8);
    this.coinBump = Math.max(0, this.coinBump - dt * 3);
    for (const f of this.flyers) f.t += dt;
    this.flyers = this.flyers.filter((f) => {
      if (f.t >= f.dur) { this.coinBump = 1; g.audio.play('coin_collect', { vol: 0.5 }); return false; }
      return true;
    });
    for (const p of this.stack) p.anim = Math.min(1, (p.anim || 0) + dt * 5);
    // floating big-icon tab bar: takes its clicks before panels and the world see them
    if (!this.tabbar && g.state) this.tabbar = new TabBar(g);
    this.tabbar?.update(dt);
  }

  // ---------------------------------------------------------------- immediate-mode widgets
  hover(r) {
    const i = this.inp;
    return i.x >= r.x && i.y >= r.y && i.x < r.x + r.w && i.y < r.y + r.h;
  }

  clicked(r) {
    if (this.inp.pressed && this.hover(r)) { this.inp.pressed = false; return true; }
    return false;
  }

  button(ctx, x, y, w, h, label, opts = {}) {
    const r = { x, y, w, h };
    const hov = !opts.disabled && this.hover(r);
    const down = hov && this.inp.down;
    if (hov) this.markHot(label + x + y);
    drawButton(ctx, x, y, w, h, { label, icon: opts.icon ? getUiIcon(opts.icon) : opts.iconCanvas, state: opts.disabled ? 'disabled' : down ? 'down' : hov ? 'hover' : opts.active ? 'down' : 'normal', style: opts.style || 'wood', font: opts.font });
    if (hov && opts.tip) this.tip = opts.tip;
    if (!opts.disabled && this.clicked(r)) { this.game.audio.play(opts.sound || 'ui_click'); return true; }
    if (opts.disabled && this.hover(r) && this.inp.pressed) { this.inp.pressed = false; this.game.audio.play('ui_error'); }
    return false;
  }

  slider(ctx, x, y, w, value, key) {
    const r = { x: x - 4, y: y - 6, w: w + 8, h: 14 };
    const hov = this.hover(r);
    if (hov && this.inp.pressed) { this.dragKey = key; this.inp.pressed = false; }
    if (this.dragKey === key) {
      if (!this.inp.down) this.dragKey = null;
      else value = clamp01((this.inp.x - x) / w);
    }
    drawSlider(ctx, x, y, w, value, { hover: hov || this.dragKey === key });
    return value;
  }

  // toggle(panelId) opens/closes a panel; toggle(ctx, x, y, on, tip) is the clam toggle widget.
  toggle(ctx, x, y, on, tip) {
    if (typeof ctx === 'string') return this.togglePanel(ctx);
    const r = { x, y, w: 22, h: 14 };
    const hov = this.hover(r);
    drawToggle(ctx, x, y, on, { hover: hov });
    if (hov && tip) this.tip = tip;
    if (this.clicked(r)) { this.game.audio.play('ui_toggle'); return !on; }
    return on;
  }

  tab(ctx, x, y, w, h, label, active) {
    const r = { x, y, w, h };
    drawTab(ctx, x, y, w, h, { label, active, hover: this.hover(r) });
    if (this.clicked(r)) { this.game.audio.play('ui_tab'); return true; }
    return false;
  }

  markHot(id) {
    this.hot = id;
  }

  // ---------------------------------------------------------------- coins flying to counter
  coinFly(x, y, value) {
    const c = this.coinTarget();
    this.flyers.push({ x0: x, y0: y, x1: c.x, y1: c.y, t: 0, dur: 0.5 + Math.random() * 0.25, value });
  }

  coinTarget() {
    const r = this.coinRect || { x: this.game.screen.W - 90, y: 6, w: 80, h: 18 };
    return { x: r.x + 12, y: r.y + 9 };
  }

  // ---------------------------------------------------------------- dock: physical objects on the seabed
  setDock(items) { this.dock = items; }

  dockHit(x, y) {
    for (let i = 0; i < this.dock.length; i++) {
      const d = this.dock[i];
      if (d.rect && rectContains(d.rect, x, y)) return i;
    }
    return -1;
  }

  // ---------------------------------------------------------------- frame
  drawHud(ctx, dt) {
    const g = this.game;
    this.tip = null;
    // coin counter: hanging wooden plank top-right
    const W = g.screen.W;
    if (!this.tabbar?.ownsCoins) {
    const txt = formatCommas(this.coinShown);
    const tw = measureText(txt) + 30;
    const bump = this.coinBump > 0 ? Math.sin(this.coinBump * 10) * this.coinBump * 2 : 0;
    const r = { x: W - tw - 12, y: 6 - Math.round(bump), w: tw, h: 20 };
    this.coinRect = r;
    drawPlank(ctx, r.x, r.y, r.w, r.h);
    ctx.drawImage(getUiIcon('coin'), r.x + 6, r.y + 6);
    drawText(ctx, txt, r.x + r.w - 7, r.y + 7, { align: 'right', color: '#fff3dc', shadow: '#2a160a' });
    if (this.hover(r)) this.tip = 'Oxidized Coins - your fish make these!';
    }
    // dock
    this.dockHover = this.blocking ? -1 : this.dockHit(this.inp.x, this.inp.y);
    for (let i = 0; i < this.dock.length; i++) {
      const d = this.dock[i];
      d.draw?.(ctx, this.dockHover === i, this.time);
      if (this.dockHover === i) {
        this.tip = d.label;
        if (this.inp.pressed && !this.game.fishing.fighting) { this.inp.pressed = false; this.game.audio.play('ui_click'); d.action(); }
      }
    }
    // flying coins
    for (const f of this.flyers) {
      const k = ease.inCubic(clamp01(f.t / f.dur));
      const x = lerp(f.x0, f.x1, k), y = lerp(f.y0, f.y1, k) - Math.sin(k * Math.PI) * 30;
      ctx.drawImage(getUiIcon('coin'), Math.round(x - 4), Math.round(y - 4));
    }
  }

  drawPanels(ctx, dt) {
    const g = this.game;
    if (this.blocking) {
      ctx.fillStyle = rgba('#06121e', 0.42 * Math.min(1, (this.active?.anim ?? 1) * 2));
      ctx.fillRect(0, 0, g.screen.W, g.screen.H);
    }
    for (const p of this.stack.slice()) {
      const top = p === this.active;
      const saved = this.inp.pressed, savedDown = this.inp.down;
      if (!top) { this.inp.pressed = false; }
      const k = ease.outBack(Math.min(1, p.anim || 0));
      ctx.save();
      if (k < 1 && p.rect) {
        const cx = p.rect.x + p.rect.w / 2, cy = p.rect.y + p.rect.h / 2;
        ctx.translate(cx, cy + (1 - k) * 20);
        ctx.scale(0.85 + 0.15 * k, 0.85 + 0.15 * k);
        ctx.translate(-cx, -cy);
        ctx.globalAlpha = Math.min(1, (p.anim || 0) * 2);
      }
      p.draw(ctx, this, dt);
      ctx.restore();
      if (!top) { this.inp.pressed = saved; this.inp.down = savedDown; }
    }
    // click outside a modal panel closes it
    const a = this.active;
    if (a && a.rect && a.modal !== false && a.closeOnOutside !== false && this.inp.pressed && !rectContains(a.rect, this.inp.x, this.inp.y)) {
      this.inp.pressed = false;
      this.close();
    }
    if (a && this.game.input.keyPressed('Escape')) this.close();
    this.tabbar?.draw(ctx); // above the modal dim so tabs switch panels
  }

  drawToasts(ctx) {
    const g = this.game;
    let y = Math.max(34, (this.tabbar?.bottom ?? 0) + 4);
    for (const t of this.toasts) {
      const a = Math.min(1, t.t * 5, (t.max - t.t) * 3);
      const lines = wrapText(t.text, 230);
      const h = lines.length * 11 + 8;
      const w = Math.max(...lines.map((l) => measureText(l))) + 30;
      const x = g.screen.W - w - 10 + Math.round((1 - Math.min(1, t.t * 5)) * 40);
      ctx.globalAlpha = a;
      drawWood(ctx, x, y, w, h, { tone: 'dark', nails: false });
      ctx.drawImage(getUiIcon(t.icon) || getUiIcon('info'), x + 6, y + 5);
      lines.forEach((l, i) => drawText(ctx, l, x + 20, y + 5 + i * 11, { color: '#fff3dc', shadow: '#1a0e06' }));
      ctx.globalAlpha = 1;
      y += h + 4;
    }
  }

  drawTip(ctx) {
    if (this.tip) drawTooltip(ctx, this.inp.x + 12, this.inp.y + 14, this.tip, { maxW: 200 });
  }
}

// Shared panel base helper: centred rect of given size.
export function centerRect(game, w, h) {
  const W = game.screen.W, H = game.screen.H;
  return { x: Math.round((W - w) / 2), y: Math.round((H - h) / 2) - 8, w, h };
}
