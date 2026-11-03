// The game HUD (phase 4, Shell agent): replaces the simulated desktop's floating icons. A glossy Aero hotbar at the
// bottom centre (glass bubble buttons with chunky voxel icons in a glass tray: hover lift + label + key hint, press
// squash, badges, an "open" light), an equipped-gear pod at the bottom left (rod + bait with its count), and a
// location chip at the top left (ocean, time of day). The Aero pill stays top right (ui.js). The hotbar slides
// away during fights, cinematics and travel; while a modal panel is open it is redrawn above the dim as tabs.
//
//   HUD_ITEMS                     [{id, label, key, tint, icon, alias, group}]
//   new Hud(game) -> game.hud
//   hud.update(dt, inp, active)   active = the game routed the pointer to the HUD (layer 'hud')
//   hud.hit(x, y) -> 'hud' | null
//   hud.iconRect(id) -> {x, y, w, h} | null   screen rect of a visible hotbar button (aliases: appsea/store/shop ->
//                                 baitshop, skills -> lab, tank -> aquarium) or 'gear' / 'bait-slot' / 'rod-slot'
//   hud.box                       the bait slot rect (tutorial compat: {x, y, w, h})
//   hud.draw(ctx), hud.drawOverlay(ctx, inp, interactive), hud.drawTooltip(ctx, inp)
//   hud.activate(id)              what a click does (open the panel / aquarium / shop)
//   hud.compat()                  the tiny `game.desktop` stand-in kept for older callers (tutorial, aquarium,
//                                 bait effects): iconRect, iconById, box, windows (the open Bait Shop as a
//                                 pseudo-window), closeWindow, hit, tooltip; icons/iconRects/windowRects are empty.
// Visibility is gated by game.tutorial.dockVisible(id) (alias ids are asked too).

import { clamp, damp, dist, ease, rectContains } from '../core/math.js';
import { rgba, mix, shade, hexToRgb } from '../core/color.js';
import { PixelBuffer } from '../gfx/pixel.js';
import { drawText, measureText } from '../gfx/font.js';
import { getUiIcon } from '../gfx/uiicons.js';
import { getBigIcon } from '../gfx/bigicons.js';
import { drawTooltip } from './panels.js';
import {
  AERO, aeroCached, aeroSurface, drawAeroGlow, drawAeroBadge, drawAeroLabel, drawSparkle, drawAeroBubble, drawAeroLeaf, drawGlossOrb,
} from './aero.js';
import { currentBait, totalBait } from '../store/bait.js';
import { drawBaitGloss } from '../fishing/baitart.js';
import { equippedRod } from '../game/rods.js';
import { labIcon } from './labicons.js';
import { openStore } from '../store/index.js';

export const HUD_ITEMS = [
  { id: 'lab', label: 'The Lab', key: 'L', tint: '#6ee04a', icon: 'lab', alias: 'skills', group: 0 },
  { id: 'aquarium', label: 'Aquarium', key: 'A', tint: '#3ac4f8', icon: 'aquarium', alias: 'tank', group: 0 },
  { id: 'journal', label: 'FishDex', key: 'J', tint: '#3a9cf0', icon: 'journal', group: 0 },
  { id: 'inventory', label: 'Satchel', key: 'I', tint: '#8ad848', icon: 'inventory', group: 0 },
  { id: 'wardrobe', label: 'Wardrobe', key: 'W', tint: '#5ab4ff', icon: 'wardrobe', group: 0 },
  { id: 'map', label: 'Map', key: 'T', tint: '#2ad0b8', icon: 'map', group: 1 },
  { id: 'baitshop', label: 'Bait Shop', key: 'S', tint: '#ffb43c', icon: 'shop', alias: 'appsea', group: 1 },
  { id: 'bait', label: 'Bait', key: 'B', tint: '#ffa83c', icon: 'bait', group: 1 },
  { id: 'multiplayer', label: 'Multiplayer', key: 'O', tint: '#78e050', icon: 'multiplayer', group: 2 },
  { id: 'settings', label: 'Settings', key: 'Esc', tint: '#bcd6ea', icon: 'settings', group: 2 },
];
const ALIAS = { appsea: 'baitshop', store: 'baitshop', shop: 'baitshop', skills: 'lab', tank: 'aquarium', friends: 'multiplayer' };
const B = 34, GAP = 5, GROUP_GAP = 13, PAD = 11, ICON_PX = 24;
const BIOME_TINT = { oscean: '#5cd04a', shallows: '#3ad0e8', fjord: '#bfe8ff', junkyard: '#c8a050', metropolis: '#b06aff', volcano: '#ff7a3a', abyss: '#3a6aff' };

// ---------------------------------------------------------------- bubble art (cached)
function bubbleTex(D, tint, part) {
  const b = new PixelBuffer(D, D);
  const r = D / 2, c = D / 2;
  const T = hexToRgb(tint), L = hexToRgb(mix(tint, '#ffffff', 0.62)), Dk = hexToRgb(shade(tint, -0.5)), Gl = hexToRgb(mix(tint, '#ffffff', 0.85));
  const put = (x, y, rgb, a) => {
    if (a <= 0) return;
    const i = y * D + x, o = b.data[i], oa = (o >>> 24) / 255;
    const na = a + oa * (1 - a);
    const f = (k, sh) => Math.round((rgb[k] * a + ((o >>> sh) & 255) * oa * (1 - a)) / Math.max(1e-4, na));
    b.data[i] = ((Math.round(na * 255) << 24) | (f(2, 16) << 16) | (f(1, 8) << 8) | f(0, 0)) >>> 0;
  };
  for (let y = 0; y < D; y++) for (let x = 0; x < D; x++) {
    const dx = x + 0.5 - c, dy = y + 0.5 - c, d = Math.hypot(dx, dy);
    if (d > r) continue;
    const u = d / r, ang = Math.atan2(dy, dx);
    if (part === 'back') {
      const ty = (y + 0.5) / D;
      put(x, y, [L[0] + (T[0] - L[0]) * ty, L[1] + (T[1] - L[1]) * ty, L[2] + (T[2] - L[2]) * ty], 0.42 + 0.5 * Math.pow(u, 2.2));
      const pool = Math.max(0, dy / r) * Math.max(0, u - 0.4) * 1.7;
      if (pool > 0) put(x, y, Gl, Math.min(0.7, pool * 0.75));
      if (d > r - 1) {
        const lit = -Math.cos(ang + 2.36);
        put(x, y, lit > 0 ? [255, 255, 255] : Dk, lit > 0 ? 0.6 + lit * 0.4 : 0.6 - lit * 0.35);
      }
    } else {
      const ex = (x + 0.5 - (c - r * 0.1)) / (r * 0.66), ey = (y + 0.5 - (c - r * 0.5)) / (r * 0.33);
      const e = ex * ex + ey * ey;
      if (e < 1 && d < r - 2) put(x, y, [255, 255, 255], 0.5 * (1 - e) * (1 - Math.max(0, (y + 0.5 - (c - r * 0.75)) / (r * 0.6))));
      if (d > r - 2.6 && d <= r - 1.4) {
        if (ang > -2.9 && ang < -1.0) put(x, y, [255, 255, 255], 0.85);
        else if (ang > 0.25 && ang < 1.25) put(x, y, Gl, 0.45);
      }
    }
  }
  if (part === 'front') {
    const gx = Math.round(c - r * 0.52), gy = Math.round(c - r * 0.42);
    put(gx, gy, [255, 255, 255], 1); put(gx + 1, gy, [255, 255, 255], 0.75); put(gx, gy + 1, [255, 255, 255], 0.75);
  }
  return b.toCanvas();
}
const bubble = (D, tint, part) => aeroCached(`hudbub|${D}|${tint}|${part}`, () => bubbleTex(D, tint, part));

function ringTex(D) {
  return aeroCached(`hudring|${D}`, () => {
    const b = new PixelBuffer(D + 4, D + 4);
    const C = (D + 4) / 2, R = D / 2 + 1.5;
    for (let y = 0; y < D + 4; y++) for (let x = 0; x < D + 4; x++) {
      const d = Math.hypot(x + 0.5 - C, y + 0.5 - C);
      if (Math.abs(d - R) < 0.6) b.data[y * (D + 4) + x] = 0xffffffff;
    }
    return b.toCanvas();
  });
}

const toneShadow = (t) => (t === 'green' ? '#1c5a0e' : t === 'orange' ? '#843a04' : '#6a0a16');

function keycap(ctx, x, y, key) {
  const w = Math.max(11, measureText(key, 'small') + 6);
  ctx.drawImage(aeroCached(`hudkey|${w}`, () => aeroSurface(w, 11, { tone: 'white', r: 3, gloss: 0.8, glossH: 5, curve: 1, rim: 0.8, glow: 0.5 })), Math.round(x), Math.round(y));
  drawText(ctx, key, Math.round(x + w / 2), Math.round(y + 3), { align: 'center', font: 'small', color: AERO.ink });
  return w;
}

// ---------------------------------------------------------------- HUD
export class Hud {
  constructor(game) {
    this.game = game;
    this.items = HUD_ITEMS.map((d) => ({ ...d, x: 0, y: 0, hover: 0, pop: 0, press: 0, appear: 1, shown: false, phase: Math.random() * 6.28 }));
    this.time = 0;
    this.dt = 1 / 60;
    this.show = 1;
    this.hot = null;
    this.pressed = null;
    this.tooltip = null;
    this.badges = { lab: 0, baitshop: 0 };
    this.seenItems = null;
    this.gear = { x: 0, y: 0, w: 0, h: 0 };
    this.rodSlot = { x: 0, y: 0, w: 0, h: 0 };
    this.box = { x: 0, y: 0, w: 0, h: 0, open: 0, bounce: 0, hover: false };
    this.chip = { x: 0, y: 0, w: 0, h: 0 };
    this.lastBait = undefined;
    this.layoutDirty = true;
    game.on?.('labDone', () => { this.badges.lab = '!'; });
    game.on?.('shopRestock', () => { if (!game.ui?.isOpen?.('baitshop')) this.badges.baitshop = '!'; });
    game.on?.('panelOpen', (id) => {
      if (id === 'lab') this.badges.lab = 0;
      if (id === 'baitshop') this.badges.baitshop = 0;
      if (id === 'inventory') this.seenItems = this.itemCount();
    });
  }

  get W() { return this.game.screen.W; }
  get H() { return this.game.screen.H; }

  // ------------------------------------------------------------ gating & layout
  wants(it) {
    const g = this.game;
    const exists = it.id === 'aquarium' || it.id === 'baitshop' || !!g.ui?.panels?.[it.id];
    if (!exists) return false;
    const tut = g.tutorial;
    if (!tut?.dockVisible) return true;
    if (tut.dockVisible(it.id) !== false) return true;
    return !!(it.alias && tut.dockVisible(it.alias) === true);
  }

  visible() { return this.items.filter((it) => it.shown); }

  // Hidden while the opening plays, during a fight / cinematic / travel, and in the full-screen aquarium edit modes.
  wantShow() {
    const g = this.game;
    if (g.tutorial?.intro) return false;
    if (g.fishing?.fighting || g.fishing?.cine || g.fishing?.finale) return false;
    if (g.ocean?.travelState) return false;
    return true;
  }

  trayRect() {
    const vis = this.visible();
    if (!vis.length) return null;
    let w = PAD * 2 + vis.length * B + (vis.length - 1) * GAP;
    for (let i = 1; i < vis.length; i++) if (vis[i].group !== vis[i - 1].group) w += GROUP_GAP - GAP;
    const h = 26;
    const off = Math.round((1 - ease.outCubic(this.show)) * 64);
    return { x: Math.round((this.W - w) / 2), y: this.H - h - 5 + off, w, h };
  }

  layout() {
    const tr = this.trayRect();
    if (!tr) return;
    let x = tr.x + PAD;
    const vis = this.visible();
    vis.forEach((it, i) => {
      if (i > 0 && it.group !== vis[i - 1].group) x += GROUP_GAP - GAP;
      it.x = x; it.y = tr.y - 12;
      x += B + GAP;
    });
    // gear pod (bottom left) and location chip (top left)
    const off = tr.y - (this.H - 31);
    this.gear = { x: 8, y: this.H - 44 + off, w: 98, h: 38 };
    this.rodSlot = { x: this.gear.x + 4, y: this.gear.y + 3, w: 32, h: 32 };
    this.box.x = this.gear.x + 40; this.box.y = this.gear.y + 3; this.box.w = 54; this.box.h = 32;
  }

  syncVisibility() {
    for (const it of this.items) {
      const want = this.wants(it);
      if (want && !it.shown) { it.shown = true; it.appear = this.time > 0.5 ? 0 : 1; }
      else if (!want && it.shown) it.shown = false;
    }
  }

  // ------------------------------------------------------------ queries
  find(id) {
    id = ALIAS[id] || id;
    return this.items.find((it) => it.id === id) || null;
  }

  iconRect(id) {
    if (id === 'gear') return this.gearVisible() ? { ...this.gear } : null;
    if (id === 'bait-slot' || id === 'box') return this.gearVisible() ? { x: this.box.x, y: this.box.y, w: this.box.w, h: this.box.h } : null;
    if (id === 'rod-slot') return this.gearVisible() ? { ...this.rodSlot } : null;
    const it = this.find(id);
    if (!it) return null;
    // ask the gate directly so the answer is right even before the first update
    if (!it.shown && !this.wants(it)) return null;
    if (!it.shown) { this.syncVisibility(); }
    this.layout();
    return { x: Math.round(it.x), y: Math.round(it.y), w: B, h: B };
  }

  gearVisible() {
    const tut = this.game.tutorial;
    if (tut?.intro) return false;
    return tut?.boxVisible ? tut.boxVisible() !== false : true;
  }

  itemAt(x, y) {
    if (this.show < 0.6) return null;
    for (const it of this.items) {
      if (!it.shown) continue;
      if (dist(x, y, it.x + B / 2, it.y + B / 2) <= B / 2 + 1) return it;
    }
    return null;
  }

  hit(x, y) {
    if (this.itemAt(x, y)) return 'hud';
    if (this.show > 0.6 && this.gearVisible() && rectContains(this.gear, x, y)) return 'hud';
    if (this.show > 0.6 && this.chip.w > 0 && rectContains(this.chip, x, y) && !this.game.tutorial?.intro) return 'hud';
    const tr = this.trayRect();
    if (tr && this.show > 0.6 && rectContains(tr, x, y)) return 'hud';
    return null;
  }

  isActive(it) {
    const g = this.game;
    if (it.id === 'aquarium') return g.state.view === 'aquarium' || !!g.state.tankWindow?.open;
    return !!g.ui?.isOpen?.(it.id);
  }

  itemCount() {
    const inv = this.game.state.inventory;
    if (!inv) return 0;
    let n = (inv.packages || []).length;
    for (const k in inv.items || {}) n += inv.items[k] | 0;
    return n;
  }

  badgeOf(it) {
    const g = this.game;
    if (it.id === 'lab') return this.badges.lab || null;
    if (it.id === 'baitshop') return this.badges.baitshop || null;
    if (it.id === 'bait') { try { return currentBait(g.state) ? null : '!'; } catch { return null; } }
    if (it.id === 'inventory') {
      const n = this.itemCount();
      if (this.seenItems === null) this.seenItems = n;
      if (n < this.seenItems) this.seenItems = n;
      return n > this.seenItems ? n - this.seenItems : null;
    }
    return null;
  }

  // ------------------------------------------------------------ actions
  activate(id) {
    const g = this.game, ui = g.ui;
    const it = this.find(id);
    if (it) {
      it.pop = 1;
      const cx = it.x + B / 2, cy = it.y + B / 2;
      g.particles?.bubbles?.(cx, cy, 5, { layer: 'ui', life: 0.9 });
      g.particles?.ring?.(cx, cy, 1.1, 'rgba(220,250,255,0.8)', { layer: 'ui' });
    }
    g.audio.play('bubble', { pitch: 1.1 + Math.random() * 0.15 });
    g.emit?.('iconOpen', it || { id });
    g.emit?.('hudOpen', id);
    const closeModals = () => { if (ui?.blocking) for (const p of ui.stack.slice()) ui.close(p.id); };
    switch (ALIAS[id] || id) {
      case 'aquarium': closeModals(); g.command('tank'); break;
      case 'baitshop':
        if (ui?.isOpen?.('baitshop')) ui.close('baitshop');
        else openStore(g);
        break;
      default:
        if (ui?.panels?.[id]) ui.toggle(id);
        else g.toast?.('Soon!', 'info');
    }
  }

  // ------------------------------------------------------------ update
  update(dt, inp, active) {
    const g = this.game;
    this.time += dt;
    this.dt = dt;
    this.syncVisibility();
    this.show = damp(this.show, this.wantShow() ? 1 : 0, 9, dt);
    this.layout();
    for (const it of this.items) {
      it.pop = Math.max(0, it.pop - dt * 2.6);
      it.appear = Math.min(1, it.appear + dt * 2.4);
    }
    // bait slot bounce when the equipped bait changes
    let cur = null;
    try { cur = currentBait(g.state); } catch { cur = null; }
    const key = cur ? cur.id : null;
    if (this.lastBait !== undefined && key !== this.lastBait) this.box.bounce = 1;
    this.lastBait = key;
    this.box.bounce = Math.max(0, this.box.bounce - dt * 2.5);
    this.tooltip = null;
    this.hot = null;
    this.box.hover = false;
    this.rodHover = false;
    this.chipHover = false;
    if (active && inp) {
      const it = this.itemAt(inp.x, inp.y);
      if (it) {
        this.hot = it;
        if (inp.pressed) { this.pressed = it; inp.consume?.(); }
      } else if (this.gearVisible() && rectContains(this.box, inp.x, inp.y)) {
        this.box.hover = true;
        let total = 0;
        try { total = totalBait(g.state); } catch { total = 0; }
        this.tooltip = cur ? `${cur.name}  (${total} bait)` : 'No bait! Visit the Bait Shop';
        if (inp.pressed) { inp.consume?.(); this.box.bounce = 0.6; g.audio.play('bubble'); if (g.ui?.panels?.bait) g.ui.toggle('bait'); else openStore(g); }
      } else if (this.gearVisible() && rectContains(this.rodSlot, inp.x, inp.y)) {
        this.rodHover = true;
        let rod = null;
        try { rod = equippedRod(g.state); } catch { rod = null; }
        this.tooltip = rod ? rod.name : 'Rod';
        if (inp.pressed) { inp.consume?.(); g.audio.play('bubble'); if (g.ui?.panels?.lab) g.ui.open('lab', { tab: 'rods' }); }
      } else if (this.chip.w > 0 && rectContains(this.chip, inp.x, inp.y)) {
        this.chipHover = true;
        this.tooltip = g.clockTooltip?.() || '';
        if (inp.pressed) { inp.consume?.(); g.command('map'); }
      } else if (inp.pressed) inp.consume?.(); // the tray itself swallows clicks
    }
    if (this.pressed) {
      this.pressed.press = 1;
      if (!inp?.down) {
        const it = this.pressed;
        this.pressed = null;
        if (active && this.itemAt(inp.x, inp.y) === it && !g.fishing?.fighting) this.activate(it.id);
      }
    }
    for (const it of this.items) {
      it.hover = damp(it.hover, this.hot === it ? 1 : 0, 16, dt);
      if (this.pressed !== it) it.press = damp(it.press, 0, 18, dt);
    }
  }

  // ------------------------------------------------------------ drawing
  draw(ctx) {
    const g = this.game;
    if (g.tutorial?.intro) return;
    if (this.show < 0.02) { this.chip = { x: 0, y: 0, w: 0, h: 0 }; return; }
    const a0 = ctx.globalAlpha;
    ctx.globalAlpha = a0 * clamp(this.show * 1.4, 0, 1);
    this.drawChip(ctx);
    ctx.globalAlpha = a0;
    if (this.gearVisible()) this.drawGear(ctx);
    this.drawBar(ctx, false);
  }

  // Modal open: the hotbar sits above the dim and keeps working as tabs.
  drawOverlay(ctx, inp, interactive = true) {
    const g = this.game;
    if (g.tutorial?.intro || this.show < 0.02) return null;
    let hot = null;
    if (interactive) hot = this.itemAt(inp.x, inp.y);
    for (const it of this.items) it.hover = damp(it.hover, it === hot ? 1 : 0, 16, this.dt || 1 / 60);
    this.drawBar(ctx, true);
    if (hot && inp.pressed && !g.fishing?.fighting) { inp.pressed = false; this.activate(hot.id); }
    this.overlayHot = hot;
    return hot;
  }

  drawBar(ctx, overlay) {
    const tr = this.trayRect();
    if (!tr) return;
    const t = this.time;
    const a0 = ctx.globalAlpha;
    ctx.globalAlpha = a0 * clamp(this.show * 1.4, 0, 1);
    // glass tray: a frosted aqua dock with a bright lip, soft shadow and leaves at both ends
    ctx.fillStyle = rgba('#03264a', 0.16);
    ctx.fillRect(tr.x + 6, tr.y + tr.h, tr.w - 12, 2);
    ctx.drawImage(aeroCached(`hudtray|${tr.w}|${tr.h}`, () => aeroSurface(tr.w, tr.h, {
      top: '#d4f8ff', mid: '#48bcf0', bot: '#1270c0', a: [0.9, 0.96], edge: '#0b4a8a', edgeA: 0.95, r: 12,
      gloss: 0.65, glossH: 11, curve: 3, rim: 0.9, glow: 0.85, glowColor: '#8ff6ff', streak: true, bubbles: 3, seed: 5,
    })), tr.x, tr.y);
    drawAeroLeaf(ctx, tr.x + 4, tr.y + 8, 16, 9, 200, { tone: 'lime', flip: true });
    drawAeroLeaf(ctx, tr.x + 6, tr.y + 11, 13, 8, 150, { tone: 'deep' });
    drawAeroLeaf(ctx, tr.x + tr.w - 4, tr.y + 8, 16, 9, -20, { tone: 'lime' });
    drawAeroLeaf(ctx, tr.x + tr.w - 6, tr.y + 11, 13, 8, 30, { tone: 'deep', flip: true });
    // group separators: etched glass lines
    const vis = this.visible();
    for (let i = 1; i < vis.length; i++) {
      if (vis[i].group === vis[i - 1].group) continue;
      const sx = Math.round((vis[i - 1].x + B + vis[i].x) / 2);
      ctx.fillStyle = 'rgba(6,50,100,0.45)'; ctx.fillRect(sx, tr.y + 6, 1, tr.h - 11);
      ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.fillRect(sx + 1, tr.y + 6, 1, tr.h - 11);
    }
    for (const it of vis) this.drawItem(ctx, it, t, overlay);
    const hot = overlay ? this.overlayHot : this.hot;
    if (hot && hot.hover > 0.4 && hot.shown) this.drawLabel(ctx, hot);
    ctx.globalAlpha = a0;
  }

  drawItem(ctx, it, t, overlay) {
    const g = this.game;
    const hov = it.hover;
    const active = this.isActive(it);
    const app = ease.outBack(Math.min(1, it.appear));
    const lift = Math.round(hov * 4 + (active ? 1 : 0));
    const bob = g.state.settings?.reducedMotion ? 0 : Math.round(Math.sin(t * 1.6 + it.phase) * 0.6);
    const cx = Math.round(it.x + B / 2), cy = Math.round(it.y + B / 2 - lift + bob);
    if (hov > 0.05 || active) drawAeroGlow(ctx, cx, cy, 28, mix(it.tint, '#ffffff', 0.45), Math.max(hov * 0.6, active ? 0.4 : 0));
    // pop / press squash / appear scale
    const pop = it.pop > 0 ? Math.sin((1 - it.pop) * Math.PI * 2.2) * it.pop * 0.14 : 0;
    const press = it.press * 0.1;
    const k = app < 1 ? app : 1;
    const sx = k * (1 + pop + press * 0.6 + hov * 0.06), sy = k * (1 - pop * 0.8 - press + hov * 0.06);
    const draw = (img, dy = 0) => {
      if (Math.abs(sx - 1) < 0.01 && Math.abs(sy - 1) < 0.01) ctx.drawImage(img, Math.round(cx - img.width / 2), Math.round(cy - img.height / 2 + dy));
      else {
        const w = Math.max(1, Math.round(img.width * sx)), h = Math.max(1, Math.round(img.height * sy));
        ctx.drawImage(img, Math.round(cx - w / 2), Math.round(cy - h / 2 + dy * sy), w, h);
      }
    };
    draw(bubble(B, it.tint, 'back'));
    let spr = null;
    try { spr = getBigIcon(it.icon, { size: ICON_PX }); } catch { spr = null; }
    if (spr) draw(spr.canvas, it.pop > 0 ? -Math.round(Math.sin(it.pop * Math.PI) * 2) : 0);
    draw(bubble(B, it.tint, 'front'));
    if (active) {
      ctx.drawImage(ringTex(B), cx - (B + 4) / 2, cy - (B + 4) / 2);
      const a = t * 2.4;
      drawSparkle(ctx, cx + Math.cos(a) * (B / 2 + 2), cy + Math.sin(a) * (B / 2 + 2), 2, 1);
    }
    // "open" light under the button
    if (active) {
      drawAeroGlow(ctx, it.x + B / 2, it.y + B + 4, 6, '#ffffff', 0.9);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(Math.round(it.x + B / 2) - 2, Math.round(it.y + B + 3), 4, 1);
    }
    if (!overlay && hov > 0.3 && (t * 1.3 + it.phase) % 2.6 < 0.12) drawSparkle(ctx, cx - 8, cy - 9, 2, 1);
    if (!g.state.settings?.reducedMotion && hov > 0.5) {
      const q = (t * 0.9 + it.phase) % 1;
      drawAeroBubble(ctx, cx + Math.sin(t * 4 + it.phase) * 3 + 7, cy - B / 2 - q * 14, 1.5, 1 - q);
    }
    const badge = this.badgeOf(it);
    if (badge) drawAeroBadge(ctx, cx + B / 2 + 1, cy - B / 2 - 1, badge, t);
  }

  drawLabel(ctx, it) {
    const cx = Math.round(it.x + B / 2), y = Math.round(it.y - 21);
    ctx.globalAlpha = Math.min(1, (it.hover - 0.4) * 3);
    const kw = Math.max(11, measureText(it.key, 'small') + 6);
    const lw = measureText(it.label) + 12;
    const total = lw + 3 + kw;
    const x0 = clamp(cx - Math.round(total / 2), 4, this.W - total - 4);
    drawAeroLabel(ctx, it.label, x0, y, { tone: 'white' });
    keycap(ctx, x0 + lw + 3, y + 1, it.key);
    ctx.globalAlpha = 1;
  }

  // ------------------------------------------------------------ equipped gear: rod + bait
  drawGear(ctx) {
    const g = this.game, t = this.time;
    const G = this.gear;
    const a0 = ctx.globalAlpha;
    ctx.globalAlpha = a0 * clamp(this.show * 1.4, 0, 1);
    ctx.fillStyle = rgba('#03264a', 0.16);
    ctx.fillRect(G.x + 6, G.y + G.h, G.w - 12, 2);
    ctx.drawImage(aeroCached(`hudgear|${G.w}|${G.h}`, () => aeroSurface(G.w, G.h, {
      top: '#ffffff', mid: '#dff4fd', bot: '#8fd0ee', a: [0.88, 0.92], edge: '#ffffff', edgeA: 0.95, r: 'pill',
      gloss: 0.75, glossH: 15, curve: 3, rim: 0.9, glow: 0.7, glowColor: '#ffffff', sparkle: 1,
    })), G.x, G.y);
    drawAeroLeaf(ctx, G.x + G.w - 6, G.y + 6, 15, 8, -40, { tone: 'lime' });
    drawAeroLeaf(ctx, G.x + G.w - 8, G.y + 7, 11, 7, -95, { tone: 'leaf', flip: true });
    // rod slot
    const R = this.rodSlot, rcx = R.x + R.w / 2, rcy = R.y + R.h / 2;
    if (this.rodHover) drawAeroGlow(ctx, rcx, rcy, 22, '#ffffff', 0.7);
    ctx.drawImage(bubble(30, '#7ad8ff', 'back'), Math.round(rcx - 15), Math.round(rcy - 15));
    let rod = null;
    try { rod = equippedRod(g.state); } catch { rod = null; }
    if (rod) {
      let ic = null;
      try { ic = labIcon('rod:' + rod.id, 22); } catch { ic = null; }
      if (ic) ctx.drawImage(ic, Math.round(rcx - ic.width / 2), Math.round(rcy - ic.height / 2 + (this.rodHover ? -1 : 0)));
    }
    ctx.drawImage(bubble(30, '#7ad8ff', 'front'), Math.round(rcx - 15), Math.round(rcy - 15));
    // bait slot: bubble + count pill
    const b = this.box;
    const bounce = Math.sin(b.bounce * 12) * b.bounce * 3;
    const bcx = b.x + 15, bcy = Math.round(b.y + b.h / 2 - bounce);
    if (b.hover) drawAeroGlow(ctx, bcx, bcy, 22, '#fff2c8', 0.7);
    let cur = null;
    try { cur = currentBait(g.state); } catch { cur = null; }
    if (cur?.art) drawBaitGloss(ctx, cur.art, bcx, bcy, 29, t, { tint: '#fff4dc', rim: '#ffa83c', bob: b.hover });
    else {
      ctx.drawImage(bubble(30, '#ffc070', 'back'), bcx - 15, bcy - 15);
      const hk = getUiIcon('hook');
      if (hk) { ctx.globalAlpha = a0 * 0.7; ctx.drawImage(hk, bcx - Math.floor(hk.width / 2), bcy - Math.floor(hk.height / 2)); ctx.globalAlpha = a0; }
      ctx.drawImage(bubble(30, '#ffc070', 'front'), bcx - 15, bcy - 15);
    }
    const n = cur ? cur.count : 0;
    const txt = n > 999 ? '999+' : 'x' + n;
    const pw = measureText(txt) + 8;
    const tone = n > 0 ? (n <= 2 ? 'orange' : 'green') : 'red';
    ctx.drawImage(aeroCached(`hudcount|${pw}|${tone}`, () => aeroSurface(pw, 13, { tone, r: 'pill', gloss: 0.85, glossH: 6, curve: 1, rim: 0.7, glow: 0.5, edge: '#ffffff', edgeA: 1 })), b.x + 24, b.y + b.h - 13);
    drawText(ctx, txt, b.x + 24 + Math.round(pw / 2), b.y + b.h - 10, { align: 'center', color: '#ffffff', shadow: toneShadow(tone) });
    if (!cur && (t % 1.4) < 0.7) drawAeroBadge(ctx, b.x + 32, b.y - 2, '!', t);
    ctx.globalAlpha = a0;
  }

  // ------------------------------------------------------------ location chip (top left)
  drawChip(ctx) {
    const g = this.game, t = this.time;
    if (g.state.view !== 'ocean' && g.state.view !== 'aquarium') { this.chip = { x: 0, y: 0, w: 0, h: 0 }; return; }
    const name = g.state.view === 'aquarium' ? 'Aquarium' : g.biomeName?.() || 'Ocean';
    const hh = g.clock?.hour?.() ?? 12;
    const time = `${String(Math.floor(hh)).padStart(2, '0')}:${String(Math.floor((hh % 1) * 60)).padStart(2, '0')}`;
    const night = !!g.clock?.isNight?.();
    const nw = measureText(name), tw = measureText(time, 'small');
    const w = 22 + nw + 8 + 14 + tw + 9, h = 20;
    const x = 6, y = 6;
    this.chip = { x, y, w, h };
    if (this.chipHover) drawAeroGlow(ctx, x + w / 2, y + h / 2, Math.round(w * 0.6), '#ffffff', 0.4);
    ctx.drawImage(aeroCached(`hudchip|${w}|${this.chipHover ? 1 : 0}`, () => aeroSurface(w, h, {
      tone: this.chipHover ? 'white' : 'frost', r: 'pill', gloss: 0.75, glossH: 8, curve: 2, rim: 0.9, glow: 0.5, glowColor: '#bfeaff', a: [0.94, 0.9],
    })), x, y);
    const tint = g.state.view === 'aquarium' ? '#3ac4f8' : BIOME_TINT[g.ocean?.biome?.id] || '#3ad0e8';
    drawGlossOrb(ctx, x + 11, y + 10, 6, tint);
    drawText(ctx, name, x + 21, y + 7, { color: AERO.ink, shadow: '#ffffff' });
    const ic = getUiIcon(night ? 'moon' : 'sun');
    const ix = x + 21 + nw + 7;
    ctx.fillStyle = 'rgba(74,158,208,0.35)'; ctx.fillRect(ix - 4, y + 5, 1, h - 10);
    if (ic) ctx.drawImage(ic, ix, y + Math.round((h - ic.height) / 2));
    drawText(ctx, time, ix + 14, y + 8, { font: 'small', color: AERO.inkSoft });
    void t;
  }

  drawTooltip(ctx, inp) {
    if (this.tooltip) drawTooltip(ctx, inp.x + 10, inp.y + 12, this.tooltip);
  }

  // ------------------------------------------------------------ `game.desktop` stand-in for older callers
  compat() {
    const hud = this, g = this.game;
    const shopWin = () => {
      const p = g.ui?.panels?.baitshop;
      if (!p || !g.ui.isOpen('baitshop') || !p.rect) return null;
      return { app: 'appsea', id: 'baitshop', title: 'Bait Shop', min: false, x: p.rect.x, y: p.rect.y, w: p.rect.w, h: p.rect.h };
    };
    return {
      kind: 'hud',
      icons: [],
      drag: null,
      box: this.box,
      get windows() { const w = shopWin(); return w ? [w] : []; },
      iconRect: (id) => hud.iconRect(id),
      iconById: (id) => { const r = hud.iconRect(id); return r ? { id: ALIAS[id] || id, ...r } : null; },
      iconRects: () => [],
      windowRects: () => [],
      visibleIcons: () => [],
      hit: (x, y) => (hud.hit(x, y) ? 'taskbar' : null), // 'taskbar' = "the HUD owns this point" for old checks
      overBox: (x, y) => hud.gearVisible() && rectContains(hud.box, x, y),
      openApp: (app) => { if (String(app).startsWith('appsea')) openStore(g); return null; },
      closeWindow: (w) => { if (w?.id === 'baitshop' || String(w?.app).startsWith('appsea')) g.ui?.close?.('baitshop'); },
      focus() {},
      returnIcon() {},
      restoreAll() {},
      stealIcon: () => false,
      randomStealable: () => null,
      freeSlot: () => null,
      get tooltip() { return hud.tooltip; },
      set tooltip(v) { hud.tooltip = v; },
    };
  }
}
