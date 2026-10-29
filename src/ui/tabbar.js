// Floating tab bar: a row of big voxel icons with labels at the top-right of the screen that open the
// game's main panels. Icons bob gently on staggered phases, hop + glow on hover, squash when pressed,
// show badges and an active highlight for the open panel, and also work while a modal panel is open
// (so they act as tabs to switch panels instantly). The coin counter plank lives at the right end.
//
//   const bar = new TabBar(game, {coins: true});
//   bar.update(dt)      input + animation; call BEFORE ui.drawPanels() consumes clicks (e.g. right after ui.update)
//   bar.draw(ctx)       screen space; call AFTER ui.drawPanels() so it sits above the modal dim overlay
//   bar.hit(x, y)       true when the pointer is over a tab, the collapse toggle or the coin plank
//   bar.bottom          y just below the bar (for stacking toasts); bar.ownsCoins (coin plank drawn here)
//   bar.compact         collapsed into a small strip (persisted in game.state.settings.tabbarCompact)

import { clamp, clamp01, lerp, ease, formatCommas, rectContains } from '../core/math.js';
import { rgba } from '../core/color.js';
import { drawText, measureText } from '../gfx/font.js';
import { drawBigIcon, getBigIcon } from '../gfx/bigicons.js';
import { drawPlank, drawGlass, drawButton, drawTooltip } from './panels.js';
import { getUiIcon } from '../gfx/uiicons.js';
import { SKILLS, skillStatus } from '../game/skills.js';
import { readyCount } from '../build/research.js';

const SLOT = 50, ICON_Y = 4, LABEL_GAP = 2, SMALL_SLOT = 28;

function safe(fn, dflt = null) {
  try { const v = fn(); return v === undefined ? dflt : v; } catch { return dflt; }
}

export class TabBar {
  constructor(game, opts = {}) {
    this.game = game;
    this.ownsCoins = opts.coins !== false;
    this.t = 0;
    this.show = 0;          // 0 hidden .. 1 shown (slide)
    this.dockK = 0;         // 0 .. 1 docked into the taskbar as small pinned icons (while a modal panel covers the top)
    this.morph = 0;         // 0 expanded .. 1 compact
    this.hoverId = null;
    this.pressId = null;
    this.toggleRect = null;
    this.coinRect = null;
    this.bottom = 0;
    this.items = this.defineItems();
    for (const it of this.items) Object.assign(it, { hop: 0, hopV: 0, squash: 0, glow: 0, rect: null, x: 0, y: 0 });
  }

  get compact() { return !!this.game.state?.settings?.tabbarCompact; }
  set compact(v) { if (this.game.state?.settings) this.game.state.settings.tabbarCompact = !!v; else this._compact = !!v; }

  defineItems() {
    const g = this.game;
    const ui = () => g.ui;
    const panel = (id) => !!ui()?.panels?.[id];
    const togglePanel = (id) => () => ui()?.toggle?.(id);
    const open = (id) => !!ui()?.isOpen?.(id);
    const storeWin = () => safe(() => g.desktop.windows.some((w) => w.app === 'appsea' || w.app === 'store'), false);
    return [
      { id: 'aquarium', label: 'Aquarium', key: 'A', visible: () => !!g.command, active: () => g.state?.view === 'aquarium', action: () => g.command('tank') },
      { id: 'journal', label: 'FishDex', key: 'J', visible: () => panel('journal'), active: () => open('journal'), action: togglePanel('journal') },
      {
        id: 'skills', label: 'Skills', key: 'K', visible: () => panel('skills'), active: () => open('skills'), action: togglePanel('skills'),
        badge: () => (safe(() => {
          const found = g.speciesFound?.() ?? 0;
          return SKILLS.some((s) => skillStatus(s, g.state, found).status === 'available' && g.state.coins >= s.cost);
        }, false) ? '!' : null),
      },
      { id: 'shop', label: 'Shop', key: 'S', visible: () => panel('shop'), active: () => open('shop'), action: togglePanel('shop') },
      { id: 'map', label: 'Map', key: 'T', visible: () => panel('map'), active: () => open('map'), action: togglePanel('map') },
      {
        id: 'inventory', label: 'Satchel', key: 'I', visible: () => panel('inventory'), active: () => open('inventory'), action: togglePanel('inventory'),
        badge: () => safe(() => g.state.inventory.packages.length, 0) || null,
      },
      { id: 'build', label: 'Build', key: 'U', visible: () => !!g.build?.toggle, active: () => !!g.build?.active, action: () => g.build?.toggle?.() },
      {
        id: 'research', label: 'Lab', key: '', visible: () => panel('research'), active: () => open('research'), action: togglePanel('research'),
        badge: () => safe(() => g.build?.researchReady?.() ?? readyCount(g.state), 0) || null,
      },
      { id: 'wardrobe', label: 'Wardrobe', key: '', visible: () => panel('wardrobe'), active: () => open('wardrobe'), action: togglePanel('wardrobe') },
      {
        id: 'store', label: 'AppSea', key: '', visible: () => !!g.desktop?.openApp, active: storeWin,
        action: () => { if (!safe(() => g.desktop.openApp('appsea'))) safe(() => g.desktop.openApp('store')); },
        badge: () => safe(() => g.state.apps.downloads.filter((d) => d.state !== 'confirm').length, 0) || null,
      },
      { id: 'boatyard', label: 'Boatyard', key: '', visible: () => panel('boatyard'), active: () => open('boatyard'), action: togglePanel('boatyard') },
      { id: 'settings', label: 'Settings', key: '', visible: () => panel('settings'), active: () => open('settings'), action: togglePanel('settings') },
    ];
  }

  // Tutorial gating mirrors the seabed dock (aquarium <-> dock 'tank').
  unlocked(it) {
    const tut = this.game.tutorial;
    const dockId = it.id === 'aquarium' ? 'tank' : it.id;
    return safe(() => (tut?.dockVisible ? tut.dockVisible(dockId) !== false : true), true);
  }

  visibleItems() { return this.items.filter((it) => safe(it.visible, false) && this.unlocked(it)); }

  wantsShow() { return this.allowed() && !this.wantsDock(); }
  wantsDock() { return this.allowed() && !!this.game.ui?.blocking; }
  get docked() { return this.dockK > 0 && this.show < 0.05; }

  allowed() {
    const g = this.game;
    if (g.tutorial?.active) return false;
    if (g.fishing?.fighting) return false;
    if (g.mini || g.mode === 'wallpaper') return false;
    return true;
  }

  // ---------------------------------------------------------------- layout
  layout() {
    const g = this.game, W = g.screen?.W ?? 960;
    const vis = this.visibleItems();
    this.vis = vis;
    const coinW = this.ownsCoins ? this.coinWidth() : 0;
    const right = W - 8 - (coinW ? coinW + 8 : 0);
    const fullW = vis.length * SLOT;
    const room = right - 250;
    this.autoCompact = fullW > room;
    if (this.docked) {
      // pinned into the taskbar, centred, rising from below the screen
      const H = g.screen?.H ?? 540, slot = SMALL_SLOT;
      const x0 = Math.round(W / 2 - (vis.length * slot) / 2);
      const base = H - 3 + Math.round((1 - ease.outCubic(this.dockK)) * 34);
      vis.forEach((it, i) => { it.cx = x0 + i * slot + Math.round(slot / 2); it.base = base; });
      Object.assign(this, { x0, right: x0 + vis.length * slot, slot, toggleRect: null, bottom: 0 });
      this.stripRect = { x: x0 - 6, y: base - 27, w: vis.length * slot + 12, h: 30 };
      return;
    }
    const k = this.morph;
    const slot = Math.round(lerp(SLOT, SMALL_SLOT, k));
    const x0 = right - vis.length * slot;
    vis.forEach((it, i) => {
      it.cx = x0 + i * slot + Math.round(slot / 2);
      it.base = Math.round(lerp(ICON_Y + 44, 30, k));
    });
    this.x0 = x0;
    this.right = right;
    this.slot = slot;
    this.toggleRect = { x: x0 - 17, y: Math.round(lerp(20, 12, k)), w: 14, h: 15 };
    this.stripRect = { x: x0 - 20, y: 2, w: right - x0 + 24, h: 36 };
    this.bottom = Math.round(lerp(64, 42, k) * this.show);
  }

  coinWidth() {
    const txt = formatCommas(Math.round(this.game.ui?.coinShown ?? this.game.state?.coins ?? 0));
    return measureText(txt) + 30;
  }

  // ---------------------------------------------------------------- update (input first, then animation)
  // Build one icon variant per frame so first hovers / collapsing never hitch.
  prewarm() {
    if (this.warmDone || !this.vis) return;
    this.warmQ ||= [];
    if (!this.warmQ.length && !this.warmQueued) {
      this.warmQueued = true;
      for (const [state, small] of [['normal', false], ['hover', false], ['active', false], ['normal', true], ['hover', true], ['active', true]]) {
        for (const it of this.items) this.warmQ.push([it.id, state, small]);
      }
    }
    const job = this.warmQ.shift();
    if (!job) { this.warmDone = true; return; }
    getBigIcon(job[0], { state: job[1], small: job[2] });
  }

  update(dt) {
    const g = this.game;
    this.t += dt;
    this.prewarm();
    const target = this.wantsShow() ? 1 : 0;
    // the top bar slides away first, then the docked strip rises (and the reverse when the panel closes)
    this.show = clamp01(this.show + (target && this.dockK === 0 ? dt * 2.2 : target ? 0 : -dt * 4));
    this.dockK = clamp01(this.dockK + (this.wantsDock() && this.show < 0.05 ? dt * 4 : -dt * 6));
    const wantCompact = this.compact || this.autoCompact ? 1 : 0;
    this.morph = clamp01(this.morph + (wantCompact ? dt * 5 : -dt * 5));
    this.layout();
    const inp = g.input;
    const live = this.show > 0.6 || (this.docked && this.dockK > 0.6);
    let hov = null;
    if (live && inp) {
      for (const it of this.vis) if (it.rect && rectContains(it.rect, inp.x, inp.y)) hov = it.id;
    }
    if (hov && hov !== this.hoverId) {
      const it = this.items.find((q) => q.id === hov);
      if (it && it.hop === 0) it.hopV = -70;
      safe(() => g.audio?.play?.('ui_hover', { vol: 0.35 }));
    }
    this.hoverId = hov;
    this.toggleHot = live && inp && this.toggleRect && rectContains(this.toggleRect, inp.x, inp.y);
    if (live && inp?.pressed) {
      if (hov) {
        inp.pressed = false;
        const it = this.items.find((q) => q.id === hov);
        it.squash = 1;
        this.pressId = hov;
        safe(() => g.audio?.play?.('ui_tab'));
        safe(() => it.action());
      } else if (this.toggleHot) {
        inp.pressed = false;
        this.compact = !this.compact;
        safe(() => g.audio?.play?.('ui_toggle'));
      }
    }
    if (!inp?.down) this.pressId = null;
    for (const it of this.items) {
      it.hopV += 520 * dt;
      it.hop = Math.min(0, it.hop + it.hopV * dt);
      if (it.hop === 0) it.hopV = 0;
      it.squash = Math.max(0, it.squash - dt * 6);
      const on = it.id === this.hoverId ? 1 : 0;
      it.glow += (on - it.glow) * Math.min(1, dt * 12);
    }
  }

  hit(x, y) {
    if (this.show < 0.6 && !(this.docked && this.dockK > 0.6)) return !!(this.coinRect && rectContains(this.coinRect, x, y));
    if (this.vis?.some((it) => it.rect && rectContains(it.rect, x, y))) return true;
    if (this.toggleRect && rectContains(this.toggleRect, x, y)) return true;
    return !!(this.coinRect && rectContains(this.coinRect, x, y));
  }

  // ---------------------------------------------------------------- draw
  draw(ctx) {
    const g = this.game;
    if (!this.vis) this.layout();
    if (this.ownsCoins) this.drawCoins(ctx);
    const docked = this.docked;
    if (this.show <= 0.001 && !docked) { for (const it of this.items) it.rect = null; return; }
    const k = docked ? 1 : this.morph, small = k > 0.5;
    const shown = docked ? this.dockK : this.show;
    const n = this.vis.length;
    if (k > 0.02) {
      ctx.globalAlpha = Math.min(1, k * 1.5) * shown;
      const sr = this.stripRect;
      drawGlass(ctx, sr.x, sr.y + (docked ? 0 : Math.round((this.show - 1) * 40)), sr.w, sr.h, { tint: '#8fe0ff' });
      ctx.globalAlpha = 1;
    }
    let tip = null;
    this.vis.forEach((it, i) => {
      const stagger = clamp01(shown * 1.6 - (n - 1 - i) * 0.05);
      const slide = docked ? 0 : Math.round((1 - ease.outBack(stagger)) * -76);
      const bob = Math.round(Math.sin(this.t * 1.7 + i * 0.83) * (small ? 1 : 1.6));
      const lift = Math.round(it.hop) - (it.glow > 0.5 ? 2 : 0);
      const active = !!safe(it.active, false);
      const state = it.glow > 0.5 ? 'hover' : active ? 'active' : 'normal';
      const x = it.cx, y = it.base + bob + lift + slide;
      const ic = getBigIcon(it.id, { state, small });
      // soft drop shadow, shrinking as the icon floats up
      const up = clamp((-(bob + lift)) / 8, 0, 1);
      const sw = Math.round(ic.canvas.width * (small ? 0.42 : 0.36) * (1 - up * 0.3));
      ctx.fillStyle = rgba('#06121c', (0.22 - up * 0.08) * Math.min(1, stagger * 2));
      ctx.fillRect(x - sw, it.base + slide + 1, sw * 2, 2);
      ctx.fillRect(x - sw + 2, it.base + slide, sw * 2 - 4, 1);
      ctx.fillRect(x - sw + 2, it.base + slide + 3, sw * 2 - 4, 1);
      if (active) {
        // light pool under the selected tab
        const a = (0.2 + 0.07 * Math.sin(this.t * 3)) * Math.min(1, stagger * 2);
        const rw = small ? [9, 7, 4] : [18, 15, 11, 6];
        rw.forEach((hw, j) => {
          ctx.fillStyle = rgba('#8ef0ff', a * (1 - j * 0.18));
          ctx.fillRect(x - hw, it.base + slide - 1 - j, hw * 2, 1);
          ctx.fillRect(x - hw + 2, it.base + slide + j, hw * 2 - 4, 1);
        });
      }
      const press = this.pressId === it.id ? 0.6 : 0;
      const squash = it.squash > 0 ? -Math.sin((1 - it.squash) * Math.PI) * 0.9 - press : it.hopV < -10 ? 0.4 : -press;
      const badge = safe(it.badge, null);
      drawBigIcon(ctx, it.id, x, y, { state, small, badge: badge || null, t: this.t + i, squash });
      const iw = small ? 24 : 44;
      it.rect = { x: x - Math.round(this.slot / 2) + 1, y: Math.max(0, y - iw - 2), w: this.slot - 2, h: iw + (small ? 4 : 16) };
      if (!small) {
        const ly = it.base + LABEL_GAP + slide + 1;
        const col = state === 'hover' ? '#fff2b0' : active ? '#9af4ff' : '#fff8ea';
        drawText(ctx, it.label, x, ly, { align: 'center', color: col, outline: '#0c1a28' });
        if (active) {
          const lw = measureText(it.label);
          ctx.fillStyle = '#0c1a28';
          ctx.fillRect(x - Math.floor(lw / 2) - 1, ly + 10, lw + 2, 3);
          ctx.fillStyle = '#9af4ff';
          ctx.fillRect(x - Math.floor(lw / 2), ly + 11, lw, 1);
        }
      } else if (active) {
        ctx.fillStyle = '#9af4ff';
        ctx.fillRect(x - 5, it.base + slide + 3, 10, 1);
      }
      if (it.id === this.hoverId) tip = it.label + (it.key ? ` (${it.key})` : '');
    });
    // collapse / expand toggle
    const tr = this.toggleRect;
    if (!tr) { if (tip && g.ui && 'tip' in g.ui) g.ui.tip = tip; return; }
    const ty = tr.y + Math.round((1 - ease.outCubic(this.show)) * -50);
    drawButton(ctx, tr.x, ty, tr.w, tr.h, { icon: getUiIcon(this.compact ? 'arrow_d' : 'arrow_u'), style: 'glass', state: this.toggleHot ? 'hover' : 'normal' });
    if (this.toggleHot) tip = this.compact ? 'Show big tabs' : 'Shrink tabs';
    if (tip) {
      if (g.ui && 'tip' in g.ui) g.ui.tip = tip;
      else if (g.input) drawTooltip(ctx, g.input.x + 12, g.input.y + 14, tip, { maxW: 200 });
    }
  }

  drawOverPanels(ctx) { this.draw(ctx); }

  drawCoins(ctx) {
    const g = this.game, ui = g.ui;
    const W = g.screen?.W ?? 960;
    const val = Math.round(ui?.coinShown ?? g.state?.coins ?? 0);
    const txt = formatCommas(val);
    const tw = measureText(txt) + 30;
    const bump = ui?.coinBump > 0 ? Math.sin(ui.coinBump * 10) * ui.coinBump * 2 : 0;
    const k = this.morph * this.show;
    const r = { x: W - tw - 8, y: Math.round(lerp(14, 9, k) - bump), w: tw, h: 20 };
    this.coinRect = r;
    if (ui) ui.coinRect = r;
    drawPlank(ctx, r.x, r.y, r.w, r.h, { rope: r.y + 2 });
    ctx.drawImage(getUiIcon('coin'), r.x + 6, r.y + 5);
    drawText(ctx, txt, r.x + r.w - 7, r.y + 7, { align: 'right', color: '#fff3dc', shadow: '#2a160a' });
    if (g.input && rectContains(r, g.input.x, g.input.y) && ui && 'tip' in ui) ui.tip = 'Oxidized Coins - your fish make these!';
  }
}

