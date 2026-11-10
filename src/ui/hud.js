// The game HUD (phase 4 Shell, phase 6 UI agent: much bigger and bolder). A glossy Aero hotbar at the bottom centre
// (phase 8: chunky pixel-art tile buttons holding pixelised 3D icons that bob, wobble or spin and sparkle on hover; hover lift +
// bold label + key hint, press squash, pop on click, badges, an "open" light), an equipped-gear pod at the bottom
// left (3D rod + bait with its count), a location chip at the top left with the quest-tracker slot below it. The
// Aero pill stays top right (ui.js). Every metric scales with the UI size setting (uiK(): Normal / Big / Huge).
// The hotbar slides away during fights, cinematics and travel; while a modal panel is open it is redrawn above the
// dim as tabs.
//
//   HUD_ITEMS                     [{id, label, key, tint, icon, alias, group}]
//   new Hud(game) -> game.hud
//   hud.update(dt, inp, active)   active = the game routed the pointer to the HUD (layer 'hud')
//   hud.hit(x, y) -> 'hud' | null
//   hud.iconRect(id) -> {x, y, w, h} | null   screen rect of a visible hotbar button (aliases: appsea/store/shop ->
//                                 baitshop, skills -> lab, tank -> aquarium) or 'gear' / 'bait-slot' / 'rod-slot'
//   hud.questSlot() -> {x, y, w, h, a} | null  [phase6] the area reserved for the quest tracker (top left, under the
//                                 location chip); a = the HUD's current opacity (0..1, fade with it). null while the
//                                 HUD is hidden (intro, fights, cinematics, travel). Draw inside it; it scales with
//                                 the UI size. Also exposed as game.hud.questSlot.
//   hud.topY() -> y                the hotbar's top edge (panels centre above it: ui.js panelRect)
//   hud.box                       the bait slot rect (tutorial compat: {x, y, w, h})
//   hud.draw(ctx), hud.drawOverlay(ctx, inp, interactive), hud.drawTooltip(ctx, inp)
//   hud.activate(id)              what a click does (open the panel / aquarium / shop)
//   hud.compat()                  the tiny `game.desktop` stand-in kept for older callers (tutorial, aquarium,
//                                 bait effects): iconRect, iconById, box, windows (the open Bait Shop as a
//                                 pseudo-window), closeWindow, hit, tooltip; icons/iconRects/windowRects are empty.
// Visibility is gated by game.tutorial.dockVisible(id) (alias ids are asked too). A button only shows when its panel
// is registered (e.g. 'quests' appears once the Quests panel exists).

import { clamp, damp, dist, ease, rectContains } from '../core/math.js';
import { rgba, mix, shade } from '../core/color.js';
import { tinted } from '../core/canvas.js';
import { drawText, measureText } from '../gfx/font.js';
import { getUiIcon } from '../gfx/uiicons.js';
import { getBigIcon, iconFrame, iconSpinMode, rodIcon } from '../gfx/bigicons.js';
import { drawTooltip } from './panels.js';
import {
  AERO, aeroCached, aeroSurface, drawAeroGlow, drawAeroBadge, drawAeroLabel, drawSparkle, drawAeroBubble, drawAeroLeaf, drawGlossOrb,
  uiK, uiFont, capH, setUiScale,
} from './aero.js';
import { currentBait, totalBait } from '../store/bait.js';
import { drawBaitGloss } from '../fishing/baitart.js';
import { equippedRod } from '../game/rods.js';
import { labIcon } from './labicons.js';
import { openStore } from '../store/index.js';

export const HUD_ITEMS = [
  { id: 'lab', label: 'The Lab', key: 'L', tint: '#6ee04a', icon: 'lab', alias: 'skills', group: 0 },
  { id: 'quests', label: 'Quests', key: 'Q', tint: '#ffc23a', icon: 'quests', group: 0 }, // [phase6] shows once the Quests panel is registered
  { id: 'aquarium', label: 'Aquarium', key: 'A', tint: '#3ac4f8', icon: 'aquarium', alias: 'tank', group: 0 },
  { id: 'journal', label: 'FishDex', key: 'J', tint: '#3a9cf0', icon: 'journal', group: 0 },
  { id: 'inventory', label: 'Satchel', key: 'I', tint: '#8ad848', icon: 'inventory', group: 0 },
  { id: 'wardrobe', label: 'Wardrobe', key: 'W', tint: '#5ab4ff', icon: 'wardrobe', group: 0 },
  { id: 'map', label: 'Map', key: 'T', tint: '#2ad0b8', icon: 'map', group: 1 },
  { id: 'baitshop', label: 'Bait Shop', key: 'S', tint: '#ffb43c', icon: 'shop', alias: 'appsea', group: 1 },
  { id: 'bait', label: 'Bait', key: 'B', tint: '#ff9ac2', icon: 'bait', group: 1 },
  { id: 'multiplayer', label: 'Multiplayer', key: 'O', tint: '#78e050', icon: 'multiplayer', group: 2 },
  { id: 'settings', label: 'Settings', key: 'Esc', tint: '#bcd6ea', icon: 'settings', group: 2 },
];
const ALIAS = { appsea: 'baitshop', store: 'baitshop', shop: 'baitshop', skills: 'lab', tank: 'aquarium', friends: 'multiplayer', quest: 'quests', questlog: 'quests' };
const BIOME_TINT = { oscean: '#5cd04a', shallows: '#3ad0e8', fjord: '#bfe8ff', junkyard: '#c8a050', metropolis: '#b06aff', volcano: '#ff7a3a', abyss: '#3a6aff' };
const R = Math.round;

// ---------------------------------------------------------------- button art (cached)
// [phase8:ui] chunky pixel-art tile buttons (rounded square, dark outline, banded dithered gradient, hard gloss)
function tileTex(D, tint, lit) {
  return aeroCached(`hudtile|${D}|${tint}|${lit}`, () => {
    const top = mix(tint, '#ffffff', lit ? 0.82 : 0.7), mid = mix(tint, '#ffffff', lit ? 0.38 : 0.22), bot = shade(tint, lit ? -0.02 : -0.16);
    const c = aeroSurface(D, D, { top, mid, bot, edge: shade(tint, -0.62), r: Math.max(5, R(D * 0.24)), gloss: 0.72, glossH: R(D * 0.42), curve: R(D * 0.06), rim: 1, glow: 0.6, glowColor: mix(tint, '#ffffff', 0.75), sparkle: 2 });
    // a 2 px solid pixel drop shadow under the tile
    const out = document.createElement('canvas');
    out.width = D; out.height = D + 3;
    const g = out.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.globalAlpha = 0.45;
    g.drawImage(tinted(c, shade(tint, -0.75)), 0, 3);
    g.globalAlpha = 1;
    g.drawImage(c, 0, 0);
    return out;
  });
}
const tile = (D, tint, lit = 0) => tileTex(D, tint, lit ? 1 : 0);

// [phase8:ui] animated pixel corner brackets (focus / open marker instead of a ring)
function drawBrackets(ctx, x, y, w, h, t, col = '#ffffff', ink = '#0a3e74', k = 1) {
  const o = R((Math.sin(t * 6) > 0 ? 1 : 0) * k);
  const L = R(6 * k), T = Math.max(2, R(2 * k));
  const corners = [[x - o, y - o, 1, 1], [x + w + o, y - o, -1, 1], [x - o, y + h + o, 1, -1], [x + w + o, y + h + o, -1, -1]];
  for (const pass of [0, 1]) {
    ctx.fillStyle = pass ? col : ink;
    const e = pass ? 0 : 1;
    for (const [cx, cy, sx, sy] of corners) {
      const x0 = sx > 0 ? cx - e : cx - L - e, y0 = sy > 0 ? cy - e : cy - T - e;
      ctx.fillRect(x0, y0, L + e * 2, T + e * 2);
      const x1 = sx > 0 ? cx - e : cx - T - e, y1 = sy > 0 ? cy - e : cy - L - e;
      ctx.fillRect(x1, y1, T + e * 2, L + e * 2);
    }
  }
}

const toneShadow = (t) => (t === 'green' ? '#1c5a0e' : t === 'orange' ? '#843a04' : '#6a0a16');

function keycap(ctx, x, y, key, font = 'small') {
  const ch = capH(font), h = ch + 6, w = Math.max(h, measureText(key, font) + 7);
  ctx.drawImage(aeroCached(`hudkey|${w}|${h}`, () => aeroSurface(w, h, { tone: 'white', r: 3, gloss: 0.8, glossH: Math.round(h * 0.45), curve: 1, rim: 0.8, glow: 0.5 })), R(x), R(y));
  drawText(ctx, key, R(x + w / 2), R(y + (h - ch) / 2), { align: 'center', font, color: AERO.ink });
  return { w, h };
}

// ---------------------------------------------------------------- HUD
export class Hud {
  constructor(game) {
    this.game = game;
    this.items = HUD_ITEMS.map((d) => ({ ...d, x: 0, y: 0, hover: 0, pop: 0, press: 0, appear: 1, shown: false, phase: Math.random() * 6.28, turn: 0, wob: 0 }));
    this.time = 0;
    this.dt = 1 / 60;
    this.show = 1;
    this.hot = null;
    this.pressed = null;
    this.tooltip = null;
    this.badges = { lab: 0, baitshop: 0, quests: 0 };
    this.seenItems = null;
    this.gear = { x: 0, y: 0, w: 0, h: 0 };
    this.rodSlot = { x: 0, y: 0, w: 0, h: 0 };
    this.box = { x: 0, y: 0, w: 0, h: 0, open: 0, bounce: 0, hover: false };
    this.chip = { x: 0, y: 0, w: 0, h: 0 };
    this.m = null;
    this.rodHov = 0;
    this.baitHov = 0;
    this.chipHov = 0;
    this.lastBait = undefined;
    game.on?.('labDone', () => { this.badges.lab = '!'; });
    game.on?.('shopRestock', () => { if (!game.ui?.isOpen?.('baitshop')) this.badges.baitshop = '!'; });
    for (const ev of ['questStarted', 'questDone', 'chapterDone']) game.on?.(ev, () => { if (!game.ui?.isOpen?.('quests')) this.badges.quests = '!'; });
    game.on?.('panelOpen', (id) => {
      if (id === 'lab') this.badges.lab = 0;
      if (id === 'baitshop') this.badges.baitshop = 0;
      if (id === 'quests') this.badges.quests = 0;
      if (id === 'inventory') this.seenItems = this.itemCount();
    });
    this.questSlot = this.questSlot.bind(this);
  }

  get W() { return this.game.screen.W; }
  get H() { return this.game.screen.H; }

  // ------------------------------------------------------------ metrics (UI size)
  metrics() {
    setUiScale(this.game.state?.settings?.uiScale || 'big');
    const k = uiK();
    const vis = this.visible();
    const breaks = vis.reduce((n, it, i) => n + (i > 0 && it.group !== vis[i - 1].group ? 1 : 0), 0);
    const n = Math.max(1, vis.length);
    const gap = R(5 * k), groupGap = R(13 * k), pad = R(11 * k), margin = R(6 * k);
    const gearW = R(104 * k), gearH = R(40 * k);
    let B = R(34 * k);
    const need = (b) => pad * 2 + n * b + (n - 1) * gap + breaks * (groupGap - gap);
    const fit = (w) => Math.floor((w - pad * 2 - (n - 1) * gap - breaks * (groupGap - gap)) / n);
    // the hotbar sits centred, slides right of the gear pod when they would touch, and if even that is too
    // tight the pod is stacked above the bar's left end; only then do the buttons shrink
    const podRight = margin + R(2 * k) + gearW + R(8 * k);
    let stack = false, x0 = R((this.W - need(B)) / 2);
    if (x0 < podRight) {
      if (need(B) <= this.W - podRight - margin) x0 = podRight;
      else {
        stack = true;
        if (need(B) > this.W - margin * 2) B = Math.max(24, fit(this.W - margin * 2));
        x0 = R((this.W - need(B)) / 2);
      }
    }
    const font = uiFont('normal');
    this.m = { k, B, gap, groupGap, pad, margin, gearW, gearH, trayH: R(B * 0.72), icon: R(B * 0.84), font, width: need(B), x0, stack };
    return this.m;
  }

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
    const m = this.m || this.metrics();
    const off = R((1 - ease.outCubic(this.show)) * (m.B * 2 + 10));
    return { x: m.x0, y: this.H - m.trayH - m.margin + off, w: m.width, h: m.trayH };
  }

  layout() {
    const m = this.metrics();
    const tr = this.trayRect();
    const off = R((1 - ease.outCubic(this.show)) * (m.B * 2 + 10));
    // gear pod (bottom left)
    const lift = m.stack && tr ? m.trayH + R(m.B * 0.36) + R(10 * m.k) : 0;
    this.gear = { x: m.margin + R(2 * m.k), y: this.H - m.gearH - m.margin + off - lift, w: m.gearW, h: m.gearH };
    const D = R(m.gearH * 0.84), pad = R((m.gearH - D) / 2);
    this.rodSlot = { x: this.gear.x + pad + R(2 * m.k), y: this.gear.y + pad, w: D, h: D };
    this.box.x = this.rodSlot.x + D + R(4 * m.k); this.box.y = this.gear.y + pad; this.box.w = this.gear.x + this.gear.w - this.box.x - pad; this.box.h = D;
    if (!tr) return;
    let x = tr.x + m.pad;
    const vis = this.visible();
    vis.forEach((it, i) => {
      if (i > 0 && it.group !== vis[i - 1].group) x += m.groupGap - m.gap;
      it.x = x; it.y = tr.y - R(m.B * 0.36);
      x += m.B + m.gap;
    });
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
    if (id === 'chip' || id === 'location') return this.chip.w ? { ...this.chip } : null;
    const it = this.find(id);
    if (!it) return null;
    // ask the gate directly so the answer is right even before the first update
    if (!it.shown && !this.wants(it)) return null;
    if (!it.shown) { this.syncVisibility(); }
    this.layout();
    const B = this.m.B;
    return { x: R(it.x), y: R(it.y), w: B, h: B };
  }

  // [phase6] the quest tracker's reserved area (see header)
  questSlot() {
    const g = this.game;
    if (g.tutorial?.intro || this.show < 0.05 || !this.wantShow()) return null;
    const m = this.m || this.metrics();
    const chipH = R(20 * m.k);
    const y = (this.chip.h ? this.chip.y + this.chip.h : m.margin + chipH) + R(6 * m.k);
    const w = Math.min(R(168 * m.k), R(this.W * 0.34));
    const h = Math.min(R(104 * m.k), Math.max(40, (this.gear.y || this.H) - y - R(70 * m.k)));
    return { x: m.margin, y, w, h, a: clamp(this.show * 1.4, 0, 1) };
  }

  // top edge of the hotbar (incl. its raised bubbles), for panels that want to stay clear of it
  topY() {
    const tr = this.trayRect();
    if (!tr || this.show < 0.05) return this.H;
    return tr.y - R(this.m.B * 0.36) - 2;
  }

  gearVisible() {
    const tut = this.game.tutorial;
    if (tut?.intro) return false;
    return tut?.boxVisible ? tut.boxVisible() !== false : true;
  }

  itemAt(x, y) {
    if (this.show < 0.6) return null;
    const B = this.m?.B || 34;
    for (const it of this.items) {
      if (!it.shown) continue;
      if (dist(x, y, it.x + B / 2, it.y + B / 2) <= B / 2 + 2) return it;
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
    if (it.id === 'quests') {
      try { const n = g.quests?.readyCount?.(); if (n) return n; } catch { /* optional API */ }
      return this.badges.quests || null;
    }
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
      const B = this.m?.B || 34;
      const cx = it.x + B / 2, cy = it.y + B / 2;
      g.particles?.bubbles?.(cx, cy, 7, { layer: 'ui', life: 1 });
      // [phase8:ui] juicy pixel click: sparkles + a puff + tiny stars in the button's colour (no ring)
      g.particles?.uiClick?.(cx, cy - B * 0.1, { ramp: it.tint, n: 5 });
      if (!g.state.settings?.reducedMotion) g.particles?.pixelBurst?.('star', cx, cy - B * 0.3, 3, { layer: 'ui', ramp: it.tint, size: 0, dir: -Math.PI / 2, spread: 1.1, speed: [60, 120] });
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
      default: {
        const pid = ALIAS[id] || id;
        if (ui?.panels?.[pid]) ui.toggle(pid);
        else g.toast?.('Soon!', 'info');
      }
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
      it.pop = Math.max(0, it.pop - dt * 2.4);
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
        if (inp.pressed) { inp.consume?.(); g.audio.play('bubble'); this.rodPop = 1; if (g.ui?.panels?.lab) g.ui.open('lab', { tab: 'rods' }); }
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
    this.rodHov = damp(this.rodHov, this.rodHover ? 1 : 0, 14, dt);
    this.baitHov = damp(this.baitHov, this.box.hover ? 1 : 0, 14, dt);
    this.chipHov = damp(this.chipHov, this.chipHover ? 1 : 0, 14, dt);
    this.rodPop = Math.max(0, (this.rodPop || 0) - dt * 2.5);
    // while a modal is open the hotbar works as tabs above the dim (drawOverlay picks its hovered button)
    const hotNow = this.hot || (g.ui?.blocking ? this.overlayHot : null);
    for (const it of this.items) {
      it.hover = damp(it.hover, hotNow === it ? 1 : 0, 16, dt);
      if (this.pressed !== it) it.press = damp(it.press, 0, 18, dt);
      this.spinStep(it, dt, hotNow === it);
    }
  }

  // hovered icons spin (globe, gear) or wobble (everything else); they ease back to their pose afterwards
  spinStep(it, dt, hot) {
    if (this.game.state.settings?.reducedMotion) { it.turn = 0; return; }
    const mode = iconSpinMode(it.icon);
    if (mode === 'full') {
      if (hot || it.pop > 0) it.turn += dt * (0.55 + it.pop * 1.6);
      else { const tgt = Math.round(it.turn); it.turn += (tgt - it.turn) * Math.min(1, dt * 5); }
    } else {
      if (hot) it.wob += dt * 6.5;
      const amp = Math.max(it.hover, it.pop);
      it.turn = Math.sin(it.wob) * amp * (0.85 + it.pop * 0.3);
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
    this.overlayHot = hot; // update() eases hover / spin toward it next frame
    this.drawBar(ctx, true);
    if (hot && inp.pressed && !g.fishing?.fighting) { inp.pressed = false; this.activate(hot.id); }
    return hot;
  }

  drawBar(ctx, overlay) {
    const tr = this.trayRect();
    if (!tr) return;
    const m = this.m, k = m.k;
    const t = this.time;
    const a0 = ctx.globalAlpha;
    ctx.globalAlpha = a0 * clamp(this.show * 1.4, 0, 1);
    // glass tray: a frosted aqua dock with a bright lip, soft shadow and leaves at both ends
    ctx.fillStyle = rgba('#03264a', 0.18);
    ctx.fillRect(tr.x + 8, tr.y + tr.h, tr.w - 16, R(2 * k));
    ctx.drawImage(aeroCached(`hudtray|${tr.w}|${tr.h}`, () => aeroSurface(tr.w, tr.h, {
      top: '#d4f8ff', mid: '#48bcf0', bot: '#1270c0', a: [0.9, 0.96], edge: '#0b4a8a', edgeA: 0.95, r: R(tr.h * 0.46),
      gloss: 0.65, glossH: R(tr.h * 0.42), curve: R(3 * k), rim: 0.9, glow: 0.85, glowColor: '#8ff6ff', streak: true, bubbles: 4, seed: 5,
    })), tr.x, tr.y);
    const L = R(16 * k), Wd = R(9 * k);
    drawAeroLeaf(ctx, tr.x + R(4 * k), tr.y + R(8 * k), L, Wd, 200, { tone: 'lime', flip: true });
    drawAeroLeaf(ctx, tr.x + R(6 * k), tr.y + R(11 * k), R(L * 0.8), R(Wd * 0.85), 150, { tone: 'deep' });
    drawAeroLeaf(ctx, tr.x + tr.w - R(4 * k), tr.y + R(8 * k), L, Wd, -20, { tone: 'lime' });
    drawAeroLeaf(ctx, tr.x + tr.w - R(6 * k), tr.y + R(11 * k), R(L * 0.8), R(Wd * 0.85), 30, { tone: 'deep', flip: true });
    // group separators: etched glass lines
    const vis = this.visible();
    for (let i = 1; i < vis.length; i++) {
      if (vis[i].group === vis[i - 1].group) continue;
      const sx = R((vis[i - 1].x + m.B + vis[i].x) / 2);
      ctx.fillStyle = 'rgba(6,50,100,0.45)'; ctx.fillRect(sx, tr.y + R(tr.h * 0.25), 1, R(tr.h * 0.55));
      ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.fillRect(sx + 1, tr.y + R(tr.h * 0.25), 1, R(tr.h * 0.55));
    }
    const hot = overlay ? this.overlayHot : this.hot;
    for (const it of vis) if (it !== hot) this.drawItem(ctx, it, t, overlay);
    if (hot && hot.shown) this.drawItem(ctx, hot, t, overlay); // the hovered bubble sits on top of its neighbours
    if (!overlay && hot && hot.hover > 0.3 && hot.shown) this.drawLabel(ctx, hot); // above a panel: drawn in drawTooltip
    ctx.globalAlpha = a0;
  }

  drawItem(ctx, it, t, overlay) {
    const g = this.game, m = this.m, B = m.B, k = m.k;
    const calm = !!g.state.settings?.reducedMotion;
    const hov = it.hover;
    const active = this.isActive(it);
    const app = ease.outBack(Math.min(1, it.appear));
    const lift = R(hov * 6 * k + (active ? 1.5 * k : 0));
    const bob = calm ? 0 : Math.sin(t * 1.6 + it.phase) * 0.8 * k;
    const cx = R(it.x + B / 2), cy = R(it.y + B / 2 - lift + bob);
    if (hov > 0.05 || active) drawAeroGlow(ctx, cx, cy, R(B * 0.85), mix(it.tint, '#ffffff', 0.45), Math.max(hov * 0.7, active ? 0.45 : 0));
    // pop / press squash / appear scale / hover swell
    const pop = it.pop > 0 ? Math.sin((1 - it.pop) * Math.PI * 2.4) * it.pop * 0.16 : 0;
    const press = it.press * 0.12;
    const kk = app < 1 ? app : 1;
    const sx = kk * (1 + pop + press * 0.6 + hov * 0.1), sy = kk * (1 - pop * 0.8 - press + hov * 0.1);
    const draw = (img, dy = 0, ox = img.width / 2, oy = img.height / 2) => {
      if (Math.abs(sx - 1) < 0.01 && Math.abs(sy - 1) < 0.01) ctx.drawImage(img, R(cx - ox), R(cy - oy + dy));
      else {
        const w = Math.max(1, R(img.width * sx)), h = Math.max(1, R(img.height * sy));
        ctx.drawImage(img, R(cx - ox * sx), R(cy - oy * sy + dy * sy), w, h);
      }
    };
    // contact shadow on the tray
    ctx.fillStyle = rgba('#03264a', 0.16 + hov * 0.06);
    const sw = R(B * (0.62 - hov * 0.1));
    ctx.fillRect(R(it.x + B / 2 - sw / 2), R(it.y + B + 1), sw, R(2 * k));
    draw(tile(B, it.tint, hov > 0.5 || active)); // [phase8:ui] pixel tile instead of a glass bubble
    // the 3D icon: wobbles / spins while hovered, hops on pop
    const hop = it.pop > 0 ? -R(Math.sin(it.pop * Math.PI) * 4 * k) : 0;
    const iconHop = hop - R(hov * 2 * k);
    let f = null;
    try { f = iconFrame(it.icon, m.icon, it.turn); } catch { f = null; }
    if (f) draw(f.canvas, iconHop, f.ox, f.oy);
    else {
      let spr = null;
      try { spr = getBigIcon(it.icon, { size: m.icon }); } catch { spr = null; }
      if (spr) draw(spr.canvas, iconHop);
    }
    if (active) { // [phase8:ui] bouncing pixel corner brackets + a twinkle (no ring)
      drawBrackets(ctx, R(cx - B / 2), R(cy - B / 2), B, B, t, '#ffffff', '#0a3e74', Math.max(1, R(k * 0.7)));
      if (Math.sin(t * 3) > 0) drawSparkle(ctx, cx + B * 0.36, cy - B * 0.36, k >= 1.5 ? 3 : 2, 1);
    }
    // "open" light under the button
    if (active) {
      drawAeroGlow(ctx, it.x + B / 2, it.y + B + R(4 * k), R(7 * k), '#ffffff', 0.9);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(R(it.x + B / 2 - 3 * k), R(it.y + B + 3 * k), R(6 * k), Math.max(1, R(k)));
    }
    // hover sparkles orbiting the icon + a rising bubble
    if (!calm && hov > 0.3) {
      for (let i = 0; i < 3; i++) {
        const q = (t * 0.8 + it.phase + i / 3) % 1;
        const ang = it.phase + i * 2.1 + t * 1.3;
        const rr = B * (0.36 + 0.18 * q);
        const s = q < 0.5 ? (q < 0.25 ? 2 : 3) : q < 0.8 ? 2 : 1;
        drawSparkle(ctx, cx + Math.cos(ang) * rr, cy - B * 0.06 + Math.sin(ang) * rr * 0.8, Math.min(s, k >= 1.5 ? 3 : 2), (1 - q) * hov);
      }
      const q = (t * 0.9 + it.phase) % 1;
      drawAeroBubble(ctx, cx + Math.sin(t * 4 + it.phase) * 3 * k + B * 0.22, cy - B / 2 - q * 16 * k, 1.5 * k, 1 - q);
    } else if (!overlay && !calm && (t * 0.35 + it.phase) % 4 < 0.1) drawSparkle(ctx, cx - B * 0.24, cy - B * 0.26, 2, 0.9);
    const badge = this.badgeOf(it);
    if (badge) drawAeroBadge(ctx, cx + B / 2 + R(2 * k), cy - B / 2 - R(1 * k), badge, t);
  }

  drawLabel(ctx, it) {
    const m = this.m, B = m.B, k = m.k;
    const font = m.font, kf = font === 'big' ? 'normal' : 'small';
    const lh = R(capH(font) + 8 * Math.min(1.4, k));
    const lift = R(it.hover * 6 * k);
    const cx = R(it.x + B / 2), y = R(it.y - lh - R(6 * k) - lift + (1 - it.hover) * 6);
    ctx.globalAlpha = Math.min(1, (it.hover - 0.3) * 3);
    const tw = measureText(it.label, font);
    const kh = capH(kf) + 6, kw = Math.max(kh, measureText(it.key, kf) + 7);
    const padX = R(7 * k);
    const lw = padX + tw + R(5 * k) + kw + R(4 * k);
    const x0 = clamp(cx - R(lw / 2), 4, this.W - lw - 4);
    ctx.fillStyle = rgba('#03264a', 0.18);
    ctx.fillRect(x0 + 6, y + lh, lw - 12, 2);
    ctx.drawImage(aeroCached(`hudlbl|${lw}|${lh}`, () => aeroSurface(lw, lh, { tone: 'white', r: 'pill', gloss: 0.7, glossH: R(lh * 0.45), curve: 1, rim: 0.85, glow: 0.5, sparkle: 1 })), x0, y);
    drawText(ctx, it.label, x0 + padX, y + R((lh - capH(font)) / 2), { font, color: AERO.ink, shadow: '#ffffff' });
    keycap(ctx, x0 + padX + tw + R(5 * k), y + R((lh - kh) / 2), it.key, kf);
    // a pointer nub under the label
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(cx - 3, y + lh, 7, 1); ctx.fillRect(cx - 2, y + lh + 1, 5, 1); ctx.fillRect(cx - 1, y + lh + 2, 3, 1);
    ctx.globalAlpha = 1;
  }

  // ------------------------------------------------------------ equipped gear: rod + bait
  drawGear(ctx) {
    const g = this.game, t = this.time, m = this.m, k = m.k;
    const G = this.gear;
    const a0 = ctx.globalAlpha;
    const calm = !!g.state.settings?.reducedMotion;
    ctx.globalAlpha = a0 * clamp(this.show * 1.4, 0, 1);
    ctx.fillStyle = rgba('#03264a', 0.18);
    ctx.fillRect(G.x + 8, G.y + G.h, G.w - 16, R(2 * k));
    ctx.drawImage(aeroCached(`hudgear|${G.w}|${G.h}`, () => aeroSurface(G.w, G.h, {
      top: '#ffffff', mid: '#dff4fd', bot: '#8fd0ee', a: [0.9, 0.93], edge: '#ffffff', edgeA: 0.95, r: 'pill',
      gloss: 0.75, glossH: R(G.h * 0.4), curve: R(3 * k), rim: 0.9, glow: 0.7, glowColor: '#ffffff', sparkle: 1,
    })), G.x, G.y);
    drawAeroLeaf(ctx, G.x + G.w - R(6 * k), G.y + R(6 * k), R(15 * k), R(8 * k), -40, { tone: 'lime' });
    drawAeroLeaf(ctx, G.x + G.w - R(8 * k), G.y + R(7 * k), R(11 * k), R(7 * k), -95, { tone: 'leaf', flip: true });
    // rod slot: a glass bubble with the equipped rod in 3D
    const Rs = this.rodSlot, D = Rs.w, rcx = Rs.x + D / 2, rcy = Rs.y + D / 2;
    const rh = this.rodHov;
    const rodPop = this.rodPop || 0;
    if (rh > 0.05) drawAeroGlow(ctx, rcx, rcy, R(D * 0.75), '#ffffff', 0.7 * rh);
    const sw = 1 + rh * 0.08 + Math.sin(rodPop * 9) * rodPop * 0.08;
    const blit = (img, x, y, s = sw) => {
      const w = R(img.width * s), h = R(img.height * s);
      ctx.drawImage(img, R(x - w / 2), R(y - h / 2), w, h);
    };
    blit(tile(D, '#5cc0f4', rh > 0.5), rcx, rcy + 1); // [phase8:ui] pixel tile slot
    let rod = null;
    try { rod = equippedRod(g.state); } catch { rod = null; }
    if (rod) {
      let ic = null;
      try { ic = rodIcon(rod, R(D * 0.86)) || labIcon('rod:' + rod.id, R(D * 0.7)); } catch { ic = null; }
      const wob = calm ? 0 : Math.sin(t * 7) * rh * 1.5 * k;
      if (ic) blit(ic, rcx + wob * 0.3, rcy - rh * 2 * k);
    }
    if (rh > 0.4 && !calm) drawSparkle(ctx, rcx + D * 0.3, rcy - D * 0.32, 2, rh);
    // bait slot: bubble + count pill
    const b = this.box, bh = this.baitHov;
    const bounce = Math.sin(b.bounce * 12) * b.bounce * 3 * k;
    const bcx = b.x + D / 2, bcy = R(b.y + b.h / 2 - bounce - bh * 2 * k);
    if (bh > 0.05) drawAeroGlow(ctx, bcx, bcy, R(D * 0.75), '#fff2c8', 0.7 * bh);
    let cur = null;
    try { cur = currentBait(g.state); } catch { cur = null; }
    blit(tile(D, '#ffb43c', bh > 0.5), bcx, bcy + 1, 1 + bh * 0.08); // [phase8:ui] pixel tile slot
    if (cur?.art) drawBaitGloss(ctx, cur.art, bcx, bcy, R(D * (1 + bh * 0.08)), t, { bubble: false, bob: b.hover });
    else {
      const f = iconFrame('bait', R(D * 0.8), calm ? 0 : Math.sin(t * 6) * bh * 0.8);
      if (f) { ctx.globalAlpha = a0 * 0.85; ctx.drawImage(f.canvas, R(bcx - f.ox), R(bcy - f.oy)); ctx.globalAlpha = a0; }
      else { const hk = getUiIcon('hook'); if (hk) ctx.drawImage(hk, bcx - Math.floor(hk.width / 2), bcy - Math.floor(hk.height / 2)); }
    }
    const n = cur ? cur.count : 0;
    const txt = n > 999 ? '999+' : 'x' + n;
    const font = m.font;
    const ph = capH(font) + 7 + (font === 'big' ? 1 : 0);
    const pw = measureText(txt, font) + R(10 * k / 1.6 + 4);
    const tone = n > 0 ? (n <= 2 ? 'orange' : 'green') : 'red';
    const px = Math.min(G.x + G.w - pw - R(4 * k), b.x + D - R(8 * k)), py = b.y + b.h - ph + R(2 * k);
    ctx.drawImage(aeroCached(`hudcount|${pw}|${ph}|${tone}`, () => aeroSurface(pw, ph, { tone, r: 'pill', gloss: 0.85, glossH: R(ph * 0.45), curve: 1, rim: 0.7, glow: 0.5, edge: '#ffffff', edgeA: 1 })), px, py);
    drawText(ctx, txt, px + R(pw / 2), py + R((ph - capH(font)) / 2), { align: 'center', font, color: '#ffffff', shadow: toneShadow(tone) });
    if (!cur && (t % 1.4) < 0.7) drawAeroBadge(ctx, b.x + D + R(2 * k), b.y - R(3 * k), '!', t);
    ctx.globalAlpha = a0;
  }

  // ------------------------------------------------------------ location chip (top left)
  drawChip(ctx) {
    const g = this.game, m = this.m || this.metrics(), k = m.k;
    if (g.state.view !== 'ocean' && g.state.view !== 'aquarium') { this.chip = { x: 0, y: 0, w: 0, h: 0 }; return; }
    const name = g.state.view === 'aquarium' ? 'Aquarium' : g.biomeName?.() || 'Ocean';
    const hh = g.clock?.hour?.() ?? 12;
    const time = `${String(Math.floor(hh)).padStart(2, '0')}:${String(Math.floor((hh % 1) * 60)).padStart(2, '0')}`;
    const night = !!g.clock?.isNight?.();
    const font = m.font, tfont = font === 'big' ? 'normal' : 'small';
    const h = R(20 * k), orbR = R(6 * k);
    const nw = measureText(name, font), tw = measureText(time, tfont);
    const ic = getUiIcon(night ? 'moon' : 'sun');
    const isc = k >= 1.5 ? 2 : 1, iw = ic.width * isc, ih = ic.height * isc;
    const x = m.margin, y = m.margin;
    const nx = x + orbR * 2 + R(9 * k), sepX = nx + nw + R(7 * k);
    const w = sepX + R(6 * k) + iw + R(4 * k) + tw + R(10 * k) - x;
    this.chip = { x, y, w, h };
    const ch = this.chipHov;
    if (ch > 0.05) drawAeroGlow(ctx, x + w / 2, y + h / 2, R(w * 0.6), '#ffffff', 0.4 * ch);
    ctx.fillStyle = rgba('#03264a', 0.14);
    ctx.fillRect(x + 8, y + h, w - 16, R(2 * k));
    ctx.drawImage(aeroCached(`hudchip|${w}|${h}|${this.chipHover ? 1 : 0}`, () => aeroSurface(w, h, {
      tone: this.chipHover ? 'white' : 'frost', r: 'pill', gloss: 0.75, glossH: R(h * 0.42), curve: 2, rim: 0.9, glow: 0.5, glowColor: '#bfeaff', a: [0.95, 0.92],
    })), x, y);
    const tint = g.state.view === 'aquarium' ? '#3ac4f8' : BIOME_TINT[g.ocean?.biome?.id] || '#3ad0e8';
    const ocx = x + R(5 * k) + orbR, ocy = y + R(h / 2);
    drawGlossOrb(ctx, ocx, ocy, orbR, tint);
    if (!g.state.settings?.reducedMotion && (this.time * 0.4) % 3 < 0.1) drawSparkle(ctx, ocx - orbR * 0.4, ocy - orbR * 0.45, 2, 1);
    drawText(ctx, name, nx, y + R((h - capH(font)) / 2), { font, color: AERO.ink, shadow: '#ffffff' });
    ctx.fillStyle = 'rgba(74,158,208,0.35)'; ctx.fillRect(sepX, y + R(h * 0.25), 1, R(h * 0.5));
    ctx.drawImage(ic, sepX + R(6 * k), y + R((h - ih) / 2), iw, ih);
    drawText(ctx, time, sepX + R(6 * k) + iw + R(4 * k), y + R((h - capH(tfont)) / 2), { font: tfont, color: AERO.inkSoft });
  }

  drawTooltip(ctx, inp) {
    // the hovered tab's label sits above any open panel (the game draws this after the panels)
    const oh = this.game.ui?.blocking ? this.overlayHot : null;
    if (oh && oh.shown && oh.hover > 0.3 && this.show > 0.6) {
      const a0 = ctx.globalAlpha;
      this.drawLabel(ctx, oh);
      ctx.globalAlpha = a0;
    }
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
      questSlot: () => hud.questSlot(),
      get tooltip() { return hud.tooltip; },
      set tooltip(v) { hud.tooltip = v; },
    };
  }
}
