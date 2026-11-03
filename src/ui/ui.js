// UI manager: modal panel stack, immediate-mode widgets, glass toasts and the Aero HUD pill.
// Panels: { id, open(data), close(), draw(ctx, ui, dt) (immediate mode: draw + handle input), rect, modal }
// The game menu lives on the desktop (floating app icons, src/desktop/desktop.js); while a modal panel is open
// those icons are drawn above the dim and stay clickable, so they double as tabs.

import { clamp01, lerp, ease, rectContains } from '../core/math.js';
import { rgba } from '../core/color.js';
import { drawText, measureText, wrapText } from '../gfx/font.js';
import { drawButton, drawSlider, drawToggle, drawTooltip, drawTab, TOGGLE_W, TOGGLE_H } from './panels.js';
import { getUiIcon } from '../gfx/uiicons.js';
import { AERO, CURRENCY, fmtAero, aeroSurface, aeroCached, drawAeroCoin, drawSparkle, drawAeroGlow, drawAeroLeaf } from './aero.js';

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
    this.flyers = []; // Aero drops flying to the counter
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
    drawButton(ctx, x, y, w, h, { label, icon: opts.icon ? getUiIcon(opts.icon) : opts.iconCanvas, state: opts.disabled ? 'disabled' : down ? 'down' : hov ? 'hover' : opts.active ? 'down' : 'normal', style: opts.style || 'wood', font: opts.font, align: opts.align });
    if (hov && opts.tip) this.tip = opts.tip;
    if (!opts.disabled && this.clicked(r)) {
      this.game.audio.play(opts.sound || 'ui_click');
      this.splash(this.inp.x, this.inp.y, w > 40 ? 1 : 0.6);
      return true;
    }
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
    drawSlider(ctx, x, y, w, value, { hover: hov || this.dragKey === key, down: this.dragKey === key });
    return value;
  }

  // toggle(panelId) opens/closes a panel; toggle(ctx, x, y, on, tip) is the glossy switch widget.
  toggle(ctx, x, y, on, tip) {
    if (typeof ctx === 'string') return this.togglePanel(ctx);
    const r = { x, y, w: TOGGLE_W, h: TOGGLE_H };
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

  // water-splash accent on clicks: aqua droplets + a couple of bubbles (UI particle layer)
  splash(x, y, k = 1) {
    const ps = this.game.particles;
    if (!ps || this.game.state?.settings?.reducedMotion) return;
    try {
      ps.burst(x, y, Math.round(6 * k), { colors: ['#ffffff', '#bff4ff', '#5cd0ff'], speed: 70 * k, speedMin: 20, g: 220, life: 0.45, up: 50, layer: 'ui', drag: 1 });
      ps.bubbles?.(x, y, Math.round(2 * k), { layer: 'ui', life: 0.9 });
    } catch { /* particles are optional */ }
  }

  markHot(id) {
    this.hot = id;
  }

  // ---------------------------------------------------------------- Aero drops flying to the counter
  coinFly(x, y, value) {
    const c = this.coinTarget();
    this.flyers.push({ x0: x, y0: y, x1: c.x, y1: c.y, t: 0, dur: 0.5 + Math.random() * 0.25, value });
  }

  coinTarget() {
    const r = this.coinRect || { x: this.game.screen.W - 90, y: 6, w: 80, h: 20 };
    return { x: r.x + 11, y: r.y + 10 };
  }

  // ---------------------------------------------------------------- legacy dock hooks (no seabed dock any more)
  setDock(items) { this.dock = items || []; }

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
    this.drawAeroPill(ctx);
    // legacy dock items (dev pages only)
    this.dockHover = this.blocking ? -1 : this.dockHit(this.inp.x, this.inp.y);
    for (let i = 0; i < this.dock.length; i++) {
      const d = this.dock[i];
      d.draw?.(ctx, this.dockHover === i, this.time);
      if (this.dockHover === i) {
        this.tip = d.label;
        if (this.inp.pressed && !g.fishing?.fighting) { this.inp.pressed = false; g.audio.play('ui_click'); d.action(); }
      }
    }
    // flying drops
    for (const f of this.flyers) {
      const k = ease.inCubic(clamp01(f.t / f.dur));
      const x = lerp(f.x0, f.x1, k), y = lerp(f.y0, f.y1, k) - Math.sin(k * Math.PI) * 30;
      drawAeroCoin(ctx, x, y, 3.5, 0);
      if (k > 0.2 && (f.t * 20 | 0) % 3 === 0) drawSparkle(ctx, x - 3, y + 2, 1, 0.6);
    }
  }

  // The Aero counter: a glossy frosted pill top-right with the currency drop and the amount.
  drawAeroPill(ctx) {
    const W = this.game.screen.W;
    const txt = fmtAero(this.coinShown);
    const tw = measureText(txt);
    const w = tw + 30, h = 20;
    const bump = this.coinBump > 0 ? Math.sin(this.coinBump * 10) * this.coinBump * 2 : 0;
    const r = { x: W - w - 8, y: 6 - Math.round(bump), w, h };
    this.coinRect = r;
    const hov = this.hover(r) && !this.blocking;
    if (this.coinBump > 0.05) drawAeroGlow(ctx, r.x + 11, r.y + 10, 16, '#9ff6ff', this.coinBump * 0.8);
    ctx.drawImage(aeroCached(`hudpill|${w}|${hov}`, () => aeroSurface(w, h, { tone: hov ? { top: '#ffffff', mid: '#f4fcff', bot: '#cdeefc', edge: '#2a86c4', a: [0.97, 0.95], glow: '#ffffff' } : 'frost', r: 'pill', gloss: 0.75, glossH: 9, curve: 2, rim: 0.9, glow: 0.5, glowColor: '#bfeaff', sparkle: 1 })), r.x, r.y);
    drawAeroLeaf(ctx, r.x + 4, r.y + 15, 13, 7, 150, { tone: 'deep', flip: true });
    drawAeroLeaf(ctx, r.x + 5, r.y + 14, 15, 8, -160, { tone: 'lime' });
    drawAeroCoin(ctx, r.x + 11, r.y + 10, 6.5, this.time);
    drawText(ctx, txt, r.x + w - 8, r.y + 7, { align: 'right', color: AERO.ink, shadow: '#ffffff' });
    if (hov) this.tip = CURRENCY;
  }

  drawPanels(ctx, dt) {
    const g = this.game;
    if (this.blocking) {
      ctx.fillStyle = rgba('#04304e', 0.36 * Math.min(1, (this.active?.anim ?? 1) * 2));
      ctx.fillRect(0, 0, g.screen.W, g.screen.H);
      // the floating menu icons stay above the dim and keep working as tabs
      const over = this.stack.some((p) => p.rect && rectContains(p.rect, this.inp.x, this.inp.y));
      try { g.desktop?.drawMenuOverlay?.(ctx, this.inp, !over); } catch (e) { if (!this.menuErr) { this.menuErr = true; console.error(e); } }
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
  }

  drawToasts(ctx) {
    const g = this.game;
    let y = (this.coinRect ? this.coinRect.y + this.coinRect.h : 26) + 6;
    for (const t of this.toasts) {
      const a = Math.min(1, t.t * 5, (t.max - t.t) * 3);
      const lines = wrapText(t.text, 220);
      const h = lines.length * 10 + 9;
      const w = Math.max(...lines.map((l) => measureText(l))) + 32;
      const x = g.screen.W - w - 8 + Math.round((1 - ease.outCubic(Math.min(1, t.t * 4))) * 40);
      ctx.globalAlpha = a;
      ctx.drawImage(aeroCached(`toast|${w}|${h}`, () => aeroSurface(w, h, { tone: 'frost', r: Math.min(8, Math.floor(h / 2)), gloss: 0.6, glossH: Math.min(9, Math.round(h * 0.45)), curve: 2, rim: 0.9, glow: 0.45, glowColor: '#bfeaff', sparkle: 1 })), x, y);
      // icon sits in a little aqua bubble
      ctx.drawImage(aeroCached('toastdot', () => aeroSurface(15, 15, { tone: 'aqua', r: 'pill', gloss: 0.8, glossH: 7, curve: 1, rim: 0.7, glow: 0.6 })), x + 4, y + Math.round((h - 15) / 2));
      drawAeroLeaf(ctx, x + 6, y + Math.round(h / 2) + 5, 10, 6, 140, { tone: 'lime', flip: true });
      const ic = getUiIcon(t.icon) || getUiIcon('info');
      ctx.drawImage(ic, x + 4 + Math.round((15 - ic.width) / 2), y + Math.round((h - ic.height) / 2));
      lines.forEach((l, i) => drawText(ctx, l, x + 24, y + 5 + i * 10, { color: AERO.ink }));
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
