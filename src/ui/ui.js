// UI manager: modal panel stack, immediate-mode widgets, glass toasts and the Aero currency pill.
// Panels: { id, open(data), close(), draw(ctx, ui, dt) (immediate mode: draw + handle input), rect, modal }
// The game menu is the Aero HUD hotbar (src/ui/hud.js, game.hud); while a modal panel is open the hotbar is
// drawn above the dim and stays clickable, so its buttons double as tabs.
// [phase6:ui] Everything scales with Settings > UI size (state.settings.uiScale: 'normal' | 'big' (default) | 'huge',
// see uiK/uiFont in ./aero.js): the Aero pill (3D drop), toasts and tooltips. panelRect(game, w, h) centres a panel
// in the space above the hotbar.

import { clamp01, lerp, ease, rectContains } from '../core/math.js';
import { rgba } from '../core/color.js';
import { drawText, measureText, wrapText } from '../gfx/font.js';
import { drawButton, drawSlider, drawToggle, drawTooltip, drawTab, TOGGLE_W, TOGGLE_H } from './panels.js';
import { getUiIcon } from '../gfx/uiicons.js';
import { AERO, CURRENCY, fmtAero, aeroSurface, aeroCached, drawAeroCoin, drawSparkle, drawAeroGlow, drawAeroLeaf, uiK, uiFont, capH, setUiScale, uiScaleMode } from './aero.js';
import { iconFrame } from '../gfx/bigicons.js';
import { drawIcon3D } from '../gfx/icons3d.js'; // [phase9:ui]
import { drawPop3D, text3dCanvas, POP_PALETTE } from './pop3d.js'; // [phase9:ui]

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
    this.dockHover = -1; // legacy readers
    this.flyers = []; // Aero drops flying to the counter
    this.anim = 0;
    try { this.hookPixelFx(game); } catch { /* optional juice */ } // [phase8:ui]
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
    if (this.coinRect && rectContains(this.coinRect, x, y)) return true;
    return false;
  }

  toast(text, icon = 'info', time = 3.5) {
    this.toasts.push({ text, icon, t: 0, max: time });
    if (this.toasts.length > 4) this.toasts.shift();
  }

  update(dt) {
    this.time += dt;
    setUiScale(this.game.state?.settings?.uiScale || 'big'); // [phase6:ui]
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
    drawButton(ctx, x, y, w, h, { label, icon: opts.icon ? getUiIcon(opts.icon) : opts.iconCanvas, state: opts.disabled ? 'disabled' : down ? 'down' : hov ? 'hover' : opts.active ? 'down' : 'normal', style: opts.style || 'wood', font: opts.font, align: opts.align, fixedFont: opts.fixedFont });
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

  // [phase8:ui] pixel-art celebrations for game moments (purchases, unlocks, crafts, finished quests). Never throws.
  hookPixelFx(game) {
    if (!game?.on) return;
    const at = () => {
      const i = this.inp || {};
      const W = game.screen?.W || 960, H = game.screen?.H || 540;
      return Number.isFinite(i.x) && i.x > 0 ? [i.x, i.y] : [W / 2, H * 0.42];
    };
    const fx = (fn) => () => {
      const ps = game.particles;
      if (!ps?.pixelBurst || game.state?.settings?.reducedMotion) return;
      try { fn(ps, ...at()); } catch (e) { console.warn('pixel fx', e); }
    };
    game.on('buy', fx((ps, x, y) => ps.purchase(x, y)));
    game.on('unlocked', fx((ps, x, y) => ps.unlock(x, y)));
    game.on('crafted', fx((ps, x, y) => { ps.impact(x, y, 1, { layer: 'ui', ramp: 'lime' }); ps.pixelBurst('star', x, y, 5, { layer: 'ui', ramp: 'gold' }); ps.pixelBurst('dust', x, y + 4, 4, { layer: 'ui' }); }));
    game.on('questDone', fx((ps) => { const W = game.screen?.W || 960; ps.levelUp(W / 2, 110); }));
  }

  // water-splash accent on clicks: aqua droplets + a couple of bubbles (UI particle layer)
  splash(x, y, k = 1) {
    const ps = this.game.particles;
    if (!ps || this.game.state?.settings?.reducedMotion) return;
    try {
      // [phase8:ui] pixel click: sparkles, a tiny puff, a few drops and (big buttons) a couple of stars
      if (ps.uiClick) {
        ps.uiClick(x, y, { n: Math.round(3 + 3 * k) });
        ps.pixelBurst('drop', x, y, Math.round(3 * k), { layer: 'ui', size: 0, speed: [50, 110 * k], spread: 1.2 });
        if (k >= 1) ps.pixelBurst('star', x, y - 2, 2, { layer: 'ui', size: 0, dir: -Math.PI / 2, spread: 1, speed: [60, 120] });
      } else ps.burst(x, y, Math.round(6 * k), { colors: ['#ffffff', '#bff4ff', '#5cd0ff'], speed: 70 * k, speedMin: 20, g: 220, life: 0.45, up: 50, layer: 'ui', drag: 1 });
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
    return { x: r.x + Math.round(r.h * 0.52), y: r.y + Math.round(r.h / 2) };
  }

  // ---------------------------------------------------------------- frame
  drawHud(ctx, dt) {
    const g = this.game;
    this.tip = null;
    this.dtLast = Math.max(0, Math.min(0.1, dt || 1 / 60));
    if (!g.tutorial?.intro) this.drawAeroPill(ctx);
    // flying drops
    for (const f of this.flyers) {
      const k = ease.inCubic(clamp01(f.t / f.dur));
      const x = lerp(f.x0, f.x1, k), y = lerp(f.y0, f.y1, k) - Math.sin(k * Math.PI) * 30;
      drawAeroCoin(ctx, x, y, 3.5 * Math.min(1.6, uiK()), 0);
      if (k > 0.2 && (f.t * 20 | 0) % 3 === 0) drawSparkle(ctx, x - 3, y + 2, 1, 0.6);
    }
  }

  // The Aero counter: a glossy frosted pill top-right with a spinning 3D Aero drop and the amount (scales with the UI size).
  drawAeroPill(ctx) {
    const W = this.game.screen.W;
    const k = uiK(), mode = uiScaleMode();
    const font = uiFont('normal'), sc = mode === 'huge' ? 2 : 1;
    const txt = fmtAero(this.coinShown);
    const tw = measureText(txt, font, sc);
    const h = Math.round(22 * k), D = Math.round(h * 1.05);
    const w = Math.max(Math.round(64 * k), tw + D + Math.round(16 * k));
    const bump = this.coinBump > 0 ? Math.sin(this.coinBump * 10) * this.coinBump * 2 * k : 0;
    const m = Math.round(6 * k);
    const r = { x: W - w - m - 2, y: m - Math.round(bump), w, h };
    this.coinRect = r;
    const hov = this.hover(r) && !this.blocking;
    this.pillHov = (this.pillHov || 0) + ((hov ? 1 : 0) - (this.pillHov || 0)) * Math.min(1, (this.dtLast || 1 / 60) * 14);
    const ccx = r.x + Math.round(h * 0.52), ccy = r.y + Math.round(h / 2);
    if (this.coinBump > 0.05) drawAeroGlow(ctx, ccx, ccy, Math.round(18 * k), '#9ff6ff', this.coinBump * 0.8);
    if (this.pillHov > 0.05) drawAeroGlow(ctx, r.x + w / 2, r.y + h / 2, Math.round(w * 0.55), '#ffffff', 0.35 * this.pillHov);
    ctx.fillStyle = 'rgba(3,38,74,0.16)';
    ctx.fillRect(r.x + 8, r.y + h, w - 16, Math.round(2 * k));
    ctx.drawImage(aeroCached(`hudpill|${w}|${h}|${hov}`, () => aeroSurface(w, h, { tone: hov ? { top: '#ffffff', mid: '#f4fcff', bot: '#cdeefc', edge: '#2a86c4', a: [0.97, 0.95], glow: '#ffffff' } : { top: '#ffffff', mid: '#eef9ff', bot: '#bfe6f8', edge: '#4a9ed0', a: [0.96, 0.95], glow: '#ffffff' }, r: 'pill', gloss: 0.8, glossH: Math.round(h * 0.45), curve: 2, rim: 0.9, glow: 0.6, glowColor: '#ffffff', sparkle: 1 })), r.x, r.y);
    drawAeroLeaf(ctx, r.x + Math.round(4 * k), r.y + Math.round(h * 0.78), Math.round(14 * k), Math.round(8 * k), 150, { tone: 'deep', flip: true });
    drawAeroLeaf(ctx, r.x + Math.round(5 * k), r.y + Math.round(h * 0.74), Math.round(16 * k), Math.round(9 * k), -160, { tone: 'lime' });
    // the drop: a 3D water drop that turns slowly, spins up on hover and when Aero arrives
    this.coinTurn = (this.coinTurn || 0) + (this.dtLast || 1 / 60) * (this.game.state?.settings?.reducedMotion ? 0 : 0.12 + this.pillHov * 0.8 + this.coinBump * 2.5);
    const f = iconFrame('coin', Math.round(D * (1 + this.coinBump * 0.12)), this.coinTurn);
    if (f) ctx.drawImage(f.canvas, Math.round(ccx - f.ox), Math.round(ccy - f.oy - 1));
    else drawAeroCoin(ctx, ccx, ccy, 7.5 * k, this.time);
    if ((this.time * 0.45) % 1 < 0.06) drawSparkle(ctx, ccx - Math.round(h * 0.16), ccy - Math.round(h * 0.2), k >= 1.5 ? 3 : 2, 1);
    drawText(ctx, txt, r.x + w - Math.round(9 * k), r.y + Math.round((h - capH(font) * sc) / 2), { font, scale: sc, align: 'right', color: AERO.ink, shadow: '#ffffff' });
    if (hov) this.tip = CURRENCY;
  }

  drawPanels(ctx, dt) {
    const g = this.game;
    if (this.blocking) {
      ctx.fillStyle = rgba('#04304e', 0.36 * Math.min(1, (this.active?.anim ?? 1) * 2));
      ctx.fillRect(0, 0, g.screen.W, g.screen.H);
      // the HUD hotbar stays above the dim and keeps working as tabs
      const over = this.stack.some((p) => p.rect && rectContains(p.rect, this.inp.x, this.inp.y));
      try { g.hud?.drawOverlay?.(ctx, this.inp, !over); } catch (e) { if (!this.menuErr) { this.menuErr = true; console.error(e); } }
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

  // [phase9:ui] Toasts are cinematic 3D now: a spinning 3D icon and floating extruded-Alagard voxel text (no 2D text
  // box), popping in with a squash, swaying and bobbing, a sparkle burst on arrival, drifting up as they fade.
  drawToasts(ctx) {
    const g = this.game, W = g.screen.W, k = uiK();
    let y = (this.coinRect ? this.coinRect.y + this.coinRect.h : 26) + Math.round(10 * k);
    for (const t of this.toasts) {
      const fadeIn = Math.min(1, t.t * 3.2), fadeOut = Math.min(1, (t.max - t.t) * 2.5);
      const lines = wrapText(t.text, Math.round(92 * k), 'normal').slice(0, 2);
      const pal = POP_PALETTE[t.icon] || 'white', TS = 1.25;
      const sizes = lines.map((l) => text3dCanvas(l, { palette: pal, scale: TS }));
      if (sizes.some((c) => !c)) { this.drawToastFallback(ctx, t, y); y += 22; continue; }
      const tw = Math.max(...sizes.map((c) => c.width)), th = sizes.reduce((a2, c) => a2 + c.height - 2, 0);
      const D = Math.round(24 * Math.min(1.3, k));
      const h = Math.max(D, th), w = tw + D + 6;
      const lift = (1 - fadeOut) * 14;
      const right = W - Math.round(10 * k);
      const x = right - w + (1 - ease.outCubic(fadeIn)) * 40;
      const cy = y + h / 2 - lift;
      ctx.save();
      ctx.globalAlpha = Math.min(fadeIn * 1.5, fadeOut);
      // the 3D icon spins in, then rocks gently
      const icon = getUiIcon(t.icon)?.__icon3d ? t.icon : 'info';
      if (!drawIcon3D(ctx, icon, x + D / 2, cy, D, { t: t.t + this.time, hover: t.t < 0.9 ? 1 : 0, phase: t.max })) { const ic = getUiIcon(t.icon) || getUiIcon('info'); ctx.drawImage(ic, Math.round(x + D / 2 - ic.width / 2), Math.round(cy - ic.height / 2)); }
      let ly = cy - th / 2;
      lines.forEach((l, i) => {
        const c = sizes[i];
        drawPop3D(ctx, l, x + D + 6 + c.width / 2, ly + c.height / 2, { t: this.time + i * 0.4, pop: Math.min(1, t.t * 2.6 - i * 0.15), palette: pal, scale: TS, phase: t.max * 3 + i, wobble: 0.6, sparkle: i === 0 });
        ly += c.height - 2;
      });
      ctx.restore();
      if (!t.fx && t.t > 0.05) {
        t.fx = true;
        try { const ps = g.particles; ps?.pixelBurst?.('sparkle', x + D / 2, cy, 6, { layer: 'ui', ramp: pal === 'gold' ? 'gold' : pal === 'coral' ? 'pink' : 'aqua' }); ps?.pixelBurst?.('bubble', x + D / 2, cy + 4, 3, { layer: 'ui', size: 0 }); } catch { /* optional */ }
      }
      y += h + Math.round(6 * k);
    }
  }

  // only while the Alagard font is still loading: a plain line of text, no box
  drawToastFallback(ctx, t, y) {
    ctx.globalAlpha = Math.min(1, t.t * 4, (t.max - t.t) * 3);
    drawText(ctx, t.text, this.game.screen.W - 12, y, { align: 'right', color: '#ffffff', outline: '#0a3e74' });
    ctx.globalAlpha = 1;
  }

  drawTip(ctx) {
    if (this.tip) drawTooltip(ctx, this.inp.x + 12, this.inp.y + 14, this.tip, { maxW: 200 });
  }
}

// [phase6:ui] A w x h panel rect centred in the space above the HUD hotbar (clamped to the screen), so big panels
// never hide the hotbar that doubles as their tab strip.
export function panelRect(game, w, h) {
  const W = game.screen.W, H = game.screen.H;
  const bottom = Math.max(Math.round(H * 0.6), Math.min(H, game.hud?.topY?.() ?? H) - 4);
  w = Math.min(w, W - 16);
  h = Math.min(h, bottom - 8);
  return { x: Math.round((W - w) / 2), y: Math.max(4, Math.round((bottom - h) / 2)), w, h };
}

// Shared panel base helper: centred rect of given size.
export function centerRect(game, w, h) {
  const W = game.screen.W, H = game.screen.H;
  return { x: Math.round((W - w) / 2), y: Math.round((H - h) / 2) - 8, w, h };
}
