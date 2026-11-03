// Simulated desktop (phase 3, Frutiger Aero). The floating app bubbles ARE the game menu: chunky glossy voxel
// icons inside clear water bubbles that bob in the ocean, with a mirror reflection, hover glow, a click pop and
// badges. Single click opens, dragging rearranges (grid snap, saved in state.icons.aero). My Computer and the
// Recycle Bin stay as flavour (they open little windows). Icons are no longer bait: the bottom-left "Bait Tray"
// shows the equipped consumable bait (src/store/bait.js) and toggles the 'bait' panel.
//
//   MENU_ITEMS                      [{id, label, tint}] in default order
//   desktop.iconRect(id) -> {x, y, w, h} | null       screen rect of a visible menu bubble (tutorial pointers)
//   desktop.drawMenuOverlay(ctx, inp, interactive)    the bubbles above the modal dim (they double as tabs)
//   desktop.box                                       the Bait Tray rect {x, y, w, h, open, bounce, hover}
//   desktop.icons / iconRects() / iconById(id)        visible icons for fish, bait effects and thieves
//   desktop.openApp(app) / closeWindow(w) / windows   little app windows (Aero chrome)
// All icon effects (theft, black-hole pull, flood bob) are visual and reversible.

import { clamp, dist, damp, ease, rectContains } from '../core/math.js';
import { rng } from '../core/rng.js';
import { rgba, mix, shade, pack, hexToRgb } from '../core/color.js';
import { makeCanvas, ctxOf } from '../core/canvas.js';
import { PixelBuffer } from '../gfx/pixel.js';
import { drawText, measureText } from '../gfx/font.js';
import { APPS, getMiniIcon, fileTypeInfo } from './icons.js';
import { drawWindowChrome, windowRects, drawTaskbar, drawButton, drawTooltip } from '../ui/panels.js';
import { aeroCached, aeroSurface, drawAeroGlow, drawAeroBadge, drawAeroLabel, drawSparkle, drawAeroBubble, AERO } from '../ui/aero.js';
import { getUiIcon } from '../gfx/uiicons.js';
import { getBigIcon } from '../gfx/bigicons.js';
import { APP_RENDERERS } from './apps.js';
import { installStore, syncDesktopIcons, openStore, STORE_RENDERERS } from '../store/index.js';
import { currentBait, totalBait } from '../store/bait.js';

export const CELL_W = 58, CELL_H = 60, ICON = 44;
export const TASKBAR_H = 24;
const ORB = 30;

export const MENU_ITEMS = [
  { id: 'lab', label: 'The Lab', tint: '#6ee04a', alias: 'skills' },
  { id: 'aquarium', label: 'Aquarium', tint: '#3ac4f8', alias: 'tank' },
  { id: 'journal', label: 'FishDex', tint: '#3a9cf0' },
  { id: 'inventory', label: 'Satchel', tint: '#8ad848' },
  { id: 'wardrobe', label: 'Wardrobe', tint: '#5ab4ff' },
  { id: 'map', label: 'Map', tint: '#2ad0b8' },
  { id: 'bait', label: 'Bait', tint: '#ffa83c' },
  { id: 'appsea', label: 'AppSea', tint: '#2fc0f0', alias: 'store' },
  { id: 'multiplayer', label: 'Friends', tint: '#78e050' },
  { id: 'settings', label: 'Settings', tint: '#bcd6ea' },
];
const FLAVOUR = [
  { id: 'mycomputer', label: 'My Computer', tint: '#8ed4ff', app: 'computer', icon: 'computer', type: 'computer' },
  { id: 'recycle', label: 'Recycle Bin', tint: '#9ae8b0', app: 'trash', icon: 'trash', type: 'trash' },
];
const MENU_IDS = new Set(MENU_ITEMS.map((m) => m.id));

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
      const base = [L[0] + (T[0] - L[0]) * ty, L[1] + (T[1] - L[1]) * ty, L[2] + (T[2] - L[2]) * ty];
      put(x, y, base, 0.2 + 0.5 * u * u * u);
      // refracted light pooling at the bottom
      const pool = Math.max(0, dy / r) * Math.max(0, u - 0.4) * 1.7;
      if (pool > 0) put(x, y, Gl, Math.min(0.7, pool * 0.75));
      if (d > r - 1) {
        const lit = -Math.cos(ang + 2.36); // 1 at the top-left, -1 at the bottom-right
        put(x, y, lit > 0 ? [255, 255, 255] : Dk, lit > 0 ? 0.55 + lit * 0.4 : 0.55 - lit * 0.35);
      }
    } else {
      // specular cap over the top
      const ex = (x + 0.5 - (c - r * 0.1)) / (r * 0.66), ey = (y + 0.5 - (c - r * 0.5)) / (r * 0.33);
      const e = ex * ex + ey * ey;
      if (e < 1 && d < r - 2) put(x, y, [255, 255, 255], 0.5 * (1 - e) * (1 - Math.max(0, (y + 0.5 - (c - r * 0.75)) / (r * 0.6))));
      // crisp rim light: upper-left arc, faint lower-right arc
      if (d > r - 2.6 && d <= r - 1.4) {
        if (ang > -2.9 && ang < -1.0) put(x, y, [255, 255, 255], 0.85);
        else if (ang > 0.25 && ang < 1.25) put(x, y, Gl, 0.45);
      }
    }
  }
  if (part === 'front') {
    const gx = Math.round(c - r * 0.52), gy = Math.round(c - r * 0.42);
    put(gx, gy, [255, 255, 255], 1); put(gx + 1, gy, [255, 255, 255], 0.75); put(gx, gy + 1, [255, 255, 255], 0.75);
    put(gx - 1, gy, [255, 255, 255], 0.4); put(gx, gy - 1, [255, 255, 255], 0.4);
  }
  return b.toCanvas();
}

function bubblePart(tint, part) { return aeroCached(`dbub|${ICON}|${tint}|${part}`, () => bubbleTex(ICON, tint, part)); }

function iconSprite(ic) {
  try { return getBigIcon(ic.id, { size: 'menu' }); } catch { return null; }
}

// bubble + icon + gloss, then a mirrored copy fading out (the "glossy reflection" under each bubble)
function reflectionTex(ic) {
  return aeroCached(`drefl|${ic.id}|${ic.tint}`, () => {
    const D = ICON, H = 14;
    const full = makeCanvas(D, D);
    const g = ctxOf(full);
    g.drawImage(bubblePart(ic.tint, 'back'), 0, 0);
    const s = iconSprite(ic);
    if (s) g.drawImage(s.canvas, Math.round(D / 2 - s.canvas.width / 2), Math.round(D / 2 - s.canvas.height / 2));
    g.drawImage(bubblePart(ic.tint, 'front'), 0, 0);
    const c = makeCanvas(D, H);
    const q = ctxOf(c);
    q.save(); q.translate(0, D); q.scale(1, -1); q.drawImage(full, 0, 0); q.restore();
    // fade + horizontal ripple bands (pixel rows dropped out) so it reads as water
    const img = q.getImageData(0, 0, D, H);
    for (let y = 0; y < H; y++) {
      const k = Math.pow(1 - y / H, 1.6) * (y % 3 === 2 ? 0.45 : 1);
      for (let x = 0; x < D; x++) img.data[(y * D + x) * 4 + 3] = Math.round(img.data[(y * D + x) * 4 + 3] * k);
    }
    q.putImageData(img, 0, 0);
    return c;
  });
}

// The start orb: an original glossy aqua bubble with a chubby white fish and two little bubbles.
function orbTex(state) {
  const S = ORB, r = S / 2 - 0.5, c = S / 2;
  const b = new PixelBuffer(S, S);
  const body = state === 'down' ? ['#063e78', '#0e66b0', '#1f94dc', '#7fd6ff'] : state === 'hover' ? ['#0d5aa0', '#1f9ae4', '#4fd0ff', '#d4f8ff'] : ['#0a4c92', '#1784d4', '#38bff2', '#b6eeff'];
  const P = body.map((h) => hexToRgb(h));
  const px = (x, y, rgb, a = 1) => {
    if (x < 0 || y < 0 || x >= S || y >= S) return;
    const o = b.data[y * S + x];
    const m = (k, sh) => Math.round(((o >>> sh) & 255) * (1 - a) + rgb[k] * a);
    b.data[y * S + x] = (255 << 24 | m(2, 16) << 16 | m(1, 8) << 8 | m(0, 0)) >>> 0;
  };
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = x + 0.5 - c, dy = y + 0.5 - c, d = Math.hypot(dx, dy);
    if (d > r) continue;
    if (d > r - 1) { b.set(x, y, pack('#06305e')); continue; }
    const lit = (-dx * 0.45 - dy * 0.9) / r;
    const pool = Math.max(0, dy / r) * Math.max(0, d / r - 0.3) * 2.4;
    const k = clamp(1.3 + lit * 1.2 + pool, 0, 2.999);
    const i = Math.floor(k), f = k - i;
    const A = P[i], B = P[i + 1];
    b.data[y * S + x] = (255 << 24 | Math.round(A[2] + (B[2] - A[2]) * f) << 16 | Math.round(A[1] + (B[1] - A[1]) * f) << 8 | Math.round(A[0] + (B[0] - A[0]) * f)) >>> 0;
  }
  // chubby fish (swims left): ellipse body, forked tail, open eye
  const W1 = [255, 255, 255], ox = Math.round(c - 1), oy = Math.round(c + 1) + (state === 'down' ? 1 : 0);
  for (let y = -4; y <= 4; y++) for (let x = -7; x <= 8; x++) {
    const inBody = ((x + 1.5) / 5.4) ** 2 + (y / 3.7) ** 2 <= 1;
    const inTail = x >= 4 && Math.abs(y) <= (x - 3.6) * 1.25 && !(x >= 7 && Math.abs(y) <= x - 7);
    if ((inBody || inTail) && !(x === -4 && y === -1)) px(ox + x, oy + y, W1);
  }
  px(ox - 4, oy - 1, [6, 48, 94]);
  px(ox - 1, oy + 1, P[1], 0.5); px(ox, oy + 1, P[1], 0.5); // gill smile
  // two rising bubbles
  px(ox - 7, oy - 5, W1, 0.9); px(ox - 8, oy - 6, W1, 0.35); px(ox - 6, oy - 6, W1, 0.35);
  px(ox - 9, oy - 9, W1, 0.75);
  // gloss cap
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const ex = (x + 0.5 - c) / (r * 0.72), ey = (y + 0.5 - (c - r * 0.5)) / (r * 0.38);
    const e = ex * ex + ey * ey;
    if (e >= 1 || Math.hypot(x + 0.5 - c, y + 0.5 - c) > r - 1.5) continue;
    px(x, y, W1, 0.6 * (1 - e) * (y < c - r * 0.35 ? 1 : 0.5));
  }
  return b.toCanvas();
}

// ---------------------------------------------------------------- desktop

export class Desktop {
  constructor(game) {
    this.game = game;
    const mk = (def, kind) => ({
      id: def.id, label: def.label, tint: def.tint, kind, alias: def.alias || null,
      app: def.app || def.id, icon: def.icon || def.id, type: def.type || 'computer', nobait: true,
      gx: 0, gy: 0, x: 0, y: 0, w: ICON, h: ICON,
      state: 'hidden', offX: 0, offY: 0, shake: 0, hover: 0, pop: 0, appear: 0, alpha: 1, bob: 0, chewed: 0,
      phase: rng.float(0, 6.28),
    });
    this.menu = MENU_ITEMS.map((d) => mk(d, 'menu'));
    this.flavour = FLAVOUR.map((d) => mk(d, 'app'));
    this._icons = [...this.menu, ...this.flavour];
    this.windows = [];
    this.drag = null;
    this.selected = null;
    this.startOpen = false;
    this.startHover = -1;
    this.box = { x: 0, y: 0, w: 60, h: 28, open: 0, bounce: 0, hover: false };
    this.layoutDirty = true;
    this.time = 0;
    this.dt = 0;
    this.tooltip = null;
    this.visible = true;
    this.hot = null;
    this.badges = { lab: 0 };
    this.seenItems = null;
    this.lastBait = undefined;
    game.on?.('labDone', () => { this.badges.lab = '!'; });
    game.on?.('panelOpen', (id) => {
      if (id === 'lab') this.badges.lab = 0;
      if (id === 'inventory') this.seenItems = this.itemCount();
    });
  }

  // Store sync (and old code) may replace the list: the menu bubbles always stay.
  get icons() { return this._icons; }
  set icons(list) {
    const own = [...this.menu, ...this.flavour];
    this._icons = [...own, ...(list || []).filter((ic) => ic && !own.includes(ic))];
    this.layoutDirty = true;
  }

  get W() { return this.game.screen.W; }
  get H() { return this.game.screen.H; }

  // ------------------------------------------------------------ menu gating & layout
  wants(ic) {
    const g = this.game;
    if (ic.kind === 'app') return true;
    const exists = ic.id === 'aquarium' || ic.id === 'appsea' || !!g.ui?.panels?.[ic.id];
    if (!exists) return false;
    const tut = g.tutorial;
    if (!tut?.dockVisible) return true;
    if (tut.dockVisible(ic.id) !== false) return true;
    return !!(ic.alias && tut.dockVisible(ic.alias) === true);
  }

  rows() {
    return Math.max(3, Math.floor((this.H - TASKBAR_H - this.box.h - 22) / CELL_H));
  }

  cellPos(gx, gy) {
    return { x: 8 + gx * CELL_W, y: 8 + gy * CELL_H };
  }

  saved() {
    const st = this.game.state;
    const icons = (st.icons ||= {});
    return (icons.aero ||= {});
  }

  layout() {
    const saved = this.saved();
    const rows = this.rows();
    const taken = new Set();
    const vis = this.icons.filter((ic) => ic.state !== 'hidden');
    const place = (ic, gx, gy) => {
      taken.add(gx + ',' + gy);
      ic.gx = gx; ic.gy = gy;
      if (ic.state !== 'dragging') {
        const p = this.cellPos(gx, gy);
        ic.x = p.x + Math.round((CELL_W - ICON) / 2); ic.y = p.y;
      }
    };
    const rest = [];
    for (const ic of vis) {
      const s = saved[ic.id];
      if (Array.isArray(s) && s[1] < rows && s[0] >= 0 && s[0] < 8 && !taken.has(s[0] + ',' + s[1])) place(ic, s[0], s[1]);
      else rest.push(ic);
    }
    let auto = 0;
    for (const ic of rest) {
      while (taken.has(Math.floor(auto / rows) + ',' + (auto % rows))) auto++;
      place(ic, Math.floor(auto / rows), auto % rows);
      auto++;
    }
    this.box.x = 10;
    this.box.y = this.H - TASKBAR_H - this.box.h - 8;
    this.layoutDirty = false;
  }

  syncVisibility() {
    for (const ic of this.icons) {
      if (ic.state === 'stolen' || ic.state === 'dragging') continue;
      const want = this.wants(ic);
      if (want && ic.state === 'hidden') {
        ic.state = 'normal';
        ic.appear = this.time > 0.5 ? 0 : 1;
        this.layoutDirty = true;
      } else if (!want && ic.state === 'normal') {
        ic.state = 'hidden';
        this.layoutDirty = true;
      }
    }
  }

  onResize() {
    this.layoutDirty = true;
    for (const w of this.windows) {
      w.x = clamp(w.x, 0, this.W - 60);
      w.y = clamp(w.y, 0, this.H - TASKBAR_H - 20);
    }
  }

  // ------------------------------------------------------------ queries used by fish / fishing / tutorial
  visibleIcons() {
    return this.icons.filter((i) => i.state === 'normal' || i.state === 'dragging');
  }

  iconRects() {
    return this.icons.filter((i) => i.state === 'normal').map((i) => ({ x: i.x + i.offX, y: i.y + i.offY, w: ICON, h: ICON, icon: i, get shake() { return i.shake; }, set shake(v) { i.shake = v; } }));
  }

  iconRect(id) {
    const ic = this.icons.find((i) => i.id === id && (i.state === 'normal' || i.state === 'dragging'));
    if (!ic) return null;
    if (this.layoutDirty) this.layout();
    return { x: Math.round(ic.x + ic.offX), y: Math.round(ic.y + ic.offY), w: ICON, h: ICON };
  }

  windowRects() {
    return this.windows.filter((w) => !w.min).map((w) => ({ x: w.x, y: w.y, w: w.w, h: w.h }));
  }

  freeSlot() {
    const rows = this.rows();
    const taken = new Set(this.icons.filter((i) => i.state !== 'hidden').map((i) => i.gx + ',' + i.gy));
    for (let gx = 0; gx < 4; gx++) for (let gy = 0; gy < rows; gy++) {
      if (!taken.has(gx + ',' + gy)) {
        const p = this.cellPos(gx, gy);
        return { x: p.x + CELL_W / 2, y: p.y + ICON / 2, gx, gy };
      }
    }
    return null;
  }

  // only the flavour icons can be stolen (the menu must stay usable)
  randomStealable() {
    const list = this.icons.filter((i) => i.state === 'normal' && i.kind === 'app');
    return list.length ? rng.pick(list) : null;
  }

  stealIcon(ic, fish) {
    if (ic.state !== 'normal' || ic.kind !== 'app') return false;
    ic.state = 'stolen';
    ic.thief = fish;
    ic.stolenAt = this.time;
    this.game.toast(`"${ic.label}" stolen!`, 'skull');
    return true;
  }

  returnIcon(ic, quiet = false) {
    if (!ic || ic.state !== 'stolen') return;
    ic.state = 'normal';
    ic.thief = null;
    ic.shake = 0.6;
    ic.alpha = 0;
    ic.appear = 0;
    this.layoutDirty = true;
    if (!quiet) this.game.toast(`"${ic.label}" is back!`, 'check');
    this.game.audio.play('icon_drop');
  }

  restoreAll() {
    for (const ic of this.icons) {
      if (ic.state === 'stolen') { if (ic.thief) ic.thief.carry = null; this.returnIcon(ic, true); }
      ic.offX = ic.offY = 0;
    }
    this.layoutDirty = true;
  }

  iconById(id) { return this.icons.find((i) => i.id === id); }

  // ------------------------------------------------------------ badges
  itemCount() {
    const inv = this.game.state.inventory;
    if (!inv) return 0;
    let n = (inv.packages || []).length;
    for (const k in inv.items || {}) n += inv.items[k] | 0;
    return n;
  }

  badgeOf(ic) {
    if (ic.id === 'lab') return this.badges.lab || null;
    if (ic.id === 'inventory') {
      const n = this.itemCount();
      if (this.seenItems === null) this.seenItems = n;
      if (n < this.seenItems) this.seenItems = n;
      return n > this.seenItems ? n - this.seenItems : null;
    }
    return null;
  }

  // ------------------------------------------------------------ actions
  activate(ic) {
    const g = this.game, ui = g.ui;
    ic.pop = 1;
    g.audio.play('bubble', { pitch: 1.1 + rng.float(-0.08, 0.08) });
    const cx = ic.x + ic.offX + ICON / 2, cy = ic.y + ic.offY + ICON / 2;
    g.particles?.bubbles?.(cx, cy, 5, { layer: 'ui', life: 0.9 });
    g.particles?.ring?.(cx, cy, 1.1, 'rgba(220,250,255,0.8)', { layer: 'ui' });
    g.emit?.('iconOpen', ic);
    const closeModals = () => { if (ui?.blocking) for (const p of ui.stack.slice()) ui.close(p.id); };
    if (ic.kind === 'app') { closeModals(); this.openApp(ic.app); return; }
    switch (ic.id) {
      case 'aquarium': closeModals(); g.command('tank'); break;
      case 'appsea': closeModals(); openStore(g); break;
      default:
        if (ui?.panels?.[ic.id]) ui.toggle(ic.id);
        else g.toast?.('Soon!', 'info');
    }
  }

  isActive(ic) {
    const g = this.game;
    if (ic.id === 'aquarium') return g.state.view === 'aquarium';
    if (ic.id === 'appsea') return this.windows.some((w) => String(w.app).startsWith('appsea') && !w.min);
    return !!g.ui?.isOpen?.(ic.id);
  }

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
      x: opts.x ?? clamp(this.W * 0.3 + n * 18, 130, this.W - size[0] - 10),
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
      const cx = ic.x + ic.offX + ICON / 2, cy = ic.y + ic.offY + ICON / 2;
      if (dist(x, y, cx, cy) <= ICON / 2 + 1) return ic;
    }
    return null;
  }

  overBox(x, y) {
    const b = this.box;
    return x >= b.x - 2 && x < b.x + b.w + 2 && y >= b.y - 4 && y < b.y + b.h + 2;
  }

  orbRect() { return { x: 2, y: this.H - ORB + 1, w: ORB, h: ORB }; }

  // What is under the pointer (top-most first). Used by the game's input router.
  hit(x, y) {
    if (y >= this.H - TASKBAR_H || rectContains(this.orbRect(), x, y)) return 'taskbar';
    if (this.startOpen && rectContains(this.startRect(), x, y)) return 'start';
    if (this.windowAt(x, y)) return 'window';
    if (this.overBox(x, y)) return 'box';
    if (this.iconAt(x, y)) return 'icon';
    return null;
  }

  // ------------------------------------------------------------ update / input
  update(dt, inp, layer) {
    this.time += dt;
    this.dt = dt;
    const g = this.game;
    // AppSea: the store registers its window renderers and clears legacy store-app icons
    if (!this.storeReady) {
      this.storeReady = true;
      try {
        Object.assign(APP_RENDERERS, STORE_RENDERERS); // registered at runtime (store <-> desktop import cycle)
        installStore(g);
        syncDesktopIcons(this, g.state);
        g.on?.('appInstalled', () => syncDesktopIcons(this, g.state));
      } catch (e) { console.error(e); }
    }
    this.syncVisibility();
    if (this.layoutDirty) this.layout();
    this.hot = null;
    for (const ic of this.icons) {
      ic.shake = Math.max(0, ic.shake - dt);
      ic.pop = Math.max(0, ic.pop - dt * 2.6);
      ic.appear = Math.min(1, ic.appear + dt * 2.2);
      ic.alpha = Math.min(1, ic.alpha + dt * 2);
      if (ic.state === 'normal' && !ic.pull) { ic.offX = damp(ic.offX, 0, 6, dt); ic.offY = damp(ic.offY, 0, 6, dt); }
      ic.pull = false;
    }
    for (const w of this.windows) w.open = Math.min(1, w.open + dt * 6);
    // bait tray: bounce when the equipped bait changes
    const cur = this.bait();
    const key = cur ? cur.id + ':' + cur.count : null;
    if (this.lastBait !== undefined && key !== this.lastBait && cur?.id !== this.lastBaitId) this.box.bounce = 1;
    this.lastBait = key; this.lastBaitId = cur?.id;
    this.box.bounce = Math.max(0, this.box.bounce - dt * 2.5);
    this.box.hover = layer === 'box';
    this.box.open = damp(this.box.open, this.box.hover ? 1 : 0, 12, dt);
    this.tooltip = null;

    if (this.drag) { this.updateDrag(dt, inp); this.animHover(dt); return true; }

    if (!layer) {
      if (inp.pressed) { this.selected = null; this.startOpen = false; }
      this.animHover(dt);
      return false;
    }
    let used = false;
    if (layer === 'taskbar' || layer === 'start') used = this.updateTaskbar(inp, layer);
    else {
      if (this.startOpen && inp.pressed) this.startOpen = false;
      if (layer === 'window') used = this.updateWindows(dt, inp);
      else if (layer === 'box') {
        if (inp.pressed) {
          inp.consume();
          this.box.bounce = 0.6;
          g.audio.play('bubble');
          if (g.ui?.panels?.bait) g.ui.toggle('bait');
          else openStore(g, { page: 'bait' });
        }
        used = true;
      } else if (layer === 'icon') {
        const ic = this.iconAt(inp.x, inp.y);
        if (ic) {
          this.hot = ic;
          if (ic.mimic) this.tooltip = 'totally_real_app.exe';
          if (inp.pressed) {
            this.selected = ic;
            this.drag = { kind: 'icon', ic, sx: inp.x, sy: inp.y, ox: inp.x - ic.x, oy: inp.y - ic.y, moved: false };
            inp.consume();
          }
          used = true;
        }
      }
    }
    this.animHover(dt);
    return used;
  }

  animHover(dt) {
    for (const ic of this.icons) ic.hover = damp(ic.hover, this.hot === ic || ic.state === 'dragging' ? 1 : 0, 14, dt);
  }

  bait() {
    try { return currentBait(this.game.state); } catch { return null; }
  }

  updateDrag(dt, inp) {
    const d = this.drag, g = this.game;
    if (d.kind === 'icon') {
      const ic = d.ic;
      if (!d.moved && dist(inp.x, inp.y, d.sx, d.sy) > 5) {
        d.moved = true; ic.state = 'dragging';
        g.audio.play('icon_pickup', { vol: 0.5 });
      }
      if (d.moved) { ic.x = inp.x - d.ox; ic.y = inp.y - d.oy; }
      else this.hot = ic;
      if (!inp.down) {
        this.drag = null;
        if (d.moved) {
          ic.state = 'normal';
          this.dropIcon(ic, ic.x + ICON / 2, ic.y + ICON / 2);
          g.audio.play('icon_drop', { vol: 0.6 });
          g.particles?.bubbles?.(ic.x + ICON / 2, ic.y + ICON, 3, { layer: 'ui' });
        } else this.activate(ic);
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
    const gx = clamp(Math.round((cx - 8 - CELL_W / 2) / CELL_W), 0, Math.min(7, Math.floor((this.W - 100) / CELL_W)));
    const gy = clamp(Math.round((cy - 8 - ICON / 2) / CELL_H), 0, rows - 1);
    const saved = this.saved();
    const other = this.icons.find((o) => o !== ic && o.state !== 'hidden' && o.gx === gx && o.gy === gy);
    if (other) { other.gx = ic.gx; other.gy = ic.gy; saved[other.id] = [other.gx, other.gy]; }
    ic.gx = gx; ic.gy = gy;
    saved[ic.id] = [gx, gy];
    // keep every visible icon pinned so the swap survives the next layout
    for (const o of this.icons) if (o.state !== 'hidden' && !saved[o.id]) saved[o.id] = [o.gx, o.gy];
    this.layoutDirty = true;
    this.game.save?.();
  }

  updateWindows(dt, inp) {
    const w = this.windowAt(inp.x, inp.y);
    if (!w) return false;
    const ch = this.chromeRects(w);
    const R = APP_RENDERERS[w.app] || APP_RENDERERS.generic;
    this.winHot = { w, part: rectContains(ch.close, inp.x, inp.y) ? 'close' : rectContains(ch.min, inp.x, inp.y) ? 'min' : null };
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
    const r = windowRects(w);
    return { ...r, titleBar: { ...r.titleBar, w: Math.max(10, r.min.x - r.titleBar.x - 2) } };
  }

  // ------------------------------------------------------------ taskbar & start menu
  startItems() {
    const g = this.game;
    const out = this.menu.filter((ic) => ic.state !== 'hidden').map((ic) => ({ id: ic.id, label: ic.label, big: ic.id, run: () => this.activate(ic) }));
    out.push({ sep: true });
    out.push({ id: 'pause', label: g.paused ? 'Resume' : 'Pause', icon: g.paused ? 'play' : 'pause', run: () => g.command('pause') });
    out.push({ id: 'mini', label: 'Mini mode', icon: 'minimize', run: () => g.command('mini') });
    return out;
  }

  startRect() {
    const items = this.startItems();
    const h = items.reduce((a, it) => a + (it.sep ? 7 : 20), 0) + 34;
    return { x: 2, y: this.H - TASKBAR_H - h - 2, w: 176, h };
  }

  trayRects() {
    const y = this.H - TASKBAR_H + 4, h = TASKBAR_H - 7;
    const right = this.W - 4;
    const clockW = 48;
    return {
      clock: { x: right - clockW, y, w: clockW, h },
      sound: { x: right - clockW - 20, y, w: 18, h },
      pause: { x: right - clockW - 39, y, w: 18, h },
    };
  }

  updateTaskbar(inp, layer) {
    const g = this.game;
    if (layer === 'start') {
      const r = this.startRect();
      const items = this.startItems();
      let y = r.y + 26;
      this.startHover = -1;
      items.forEach((it, i) => {
        const h = it.sep ? 7 : 20;
        if (!it.sep && inp.y >= y && inp.y < y + h && inp.x >= r.x + 4 && inp.x < r.x + r.w - 4) this.startHover = i;
        y += h;
      });
      const it = items[this.startHover];
      if (inp.pressed && it && !it.sep) {
        inp.consume();
        this.startOpen = false;
        g.audio.play('ui_click');
        it.run();
      }
      return true;
    }
    this.startHot = rectContains(this.orbRect(), inp.x, inp.y);
    const tray = this.trayRects();
    this.trayHot = null;
    for (const [k, r] of Object.entries(tray)) if (rectContains(r, inp.x, inp.y)) this.trayHot = k;
    if (this.trayHot === 'pause') this.tooltip = g.paused ? 'Resume (P)' : 'Pause (P)';
    if (this.trayHot === 'sound') this.tooltip = g.muted ? 'Unmute' : 'Mute';
    if (this.trayHot === 'clock') this.tooltip = g.clockTooltip?.() || '';
    if (!inp.pressed) return true;
    inp.consume();
    if (this.startHot) { this.startOpen = !this.startOpen; this.startHover = -1; g.audio.play(this.startOpen ? 'bubble' : 'ui_click'); return true; }
    if (this.trayHot === 'pause') { g.command('pause'); return true; }
    if (this.trayHot === 'sound') { g.command('mute'); return true; }
    if (this.trayHot === 'clock') { g.command('map'); return true; }
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
    let x = ORB + 8;
    const y = this.H - TASKBAR_H + 4;
    const maxX = this.trayRects().pause.x - 6;
    for (const w of this.windows) {
      const bw = Math.min(104, Math.max(56, measureText(w.title) + 28));
      if (x + bw > maxX) break;
      out.push({ x, y, w: bw, h: TASKBAR_H - 7, win: w });
      x += bw + 3;
    }
    return out;
  }

  // ------------------------------------------------------------ drawing: menu bubbles
  drawIcons(ctx) {
    const t = this.time;
    const list = this.icons.filter((ic) => ic.state === 'normal');
    for (const ic of list) this.drawIcon(ctx, ic, ic.x + ic.offX, ic.y + ic.offY, t);
    for (const ic of list) if (ic.hover > 0.5 && !this.drag?.moved) this.drawLabel(ctx, ic, ic.x + ic.offX, ic.y + ic.offY, t);
  }

  bobOf(ic, t) {
    const flood = ic.bob ? Math.sin(t * 2 + ic.gy) * ic.bob : 0;
    if (this.game.state.settings?.reducedMotion) return Math.round(flood);
    return Math.round(Math.sin(t * 1.35 + ic.phase) * 1.6 + flood);
  }

  drawIcon(ctx, ic, x, y, t, o = {}) {
    const sh = ic.shake > 0 ? Math.round(Math.sin(t * 50) * 2 * Math.min(1, ic.shake * 3)) : 0;
    const hov = o.hover ?? ic.hover;
    const bob = ic.state === 'dragging' ? 0 : this.bobOf(ic, t);
    const lift = Math.round(hov * 3);
    const bx = Math.round(x + sh), by = Math.round(y + bob - lift);
    const cx = bx + ICON / 2, cy = by + ICON / 2;
    const a0 = ctx.globalAlpha;
    const app = ease.outBack(Math.min(1, ic.appear));
    const alpha = (o.alpha ?? 1) * ic.alpha * Math.min(1, ic.appear * 2);
    ctx.globalAlpha = a0 * alpha;
    // reflection in the water below (stays put while the bubble bobs)
    if (ic.state !== 'dragging' && app >= 1) {
      ctx.globalAlpha = a0 * alpha * 0.32;
      ctx.drawImage(reflectionTex(ic), Math.round(x + sh), Math.round(y + ICON + 1));
      ctx.globalAlpha = a0 * alpha;
    }
    // glows: hover halo, active ring (the open panel), a breathing aura when a badge is waiting
    const active = o.active;
    if (hov > 0.05 || active) drawAeroGlow(ctx, cx, cy, 31, mix(ic.tint, '#ffffff', 0.4), Math.max(hov * 0.55, active ? 0.45 : 0));
    // pop / appear: pixel scale bounce
    const pop = ic.pop > 0 ? Math.sin((1 - ic.pop) * Math.PI * 2.2) * ic.pop * 0.16 : 0;
    const k = app < 1 ? app : 1;
    const sx = k * (1 + pop), sy = k * (1 - pop * 0.8);
    const back = bubblePart(ic.tint, 'back'), front = bubblePart(ic.tint, 'front');
    const spr = iconSprite(ic);
    const draw = (img, dy = 0) => {
      if (sx === 1 && sy === 1) ctx.drawImage(img, Math.round(cx - img.width / 2), Math.round(cy - img.height / 2 + dy));
      else {
        const w = Math.max(1, Math.round(img.width * sx)), h = Math.max(1, Math.round(img.height * sy));
        ctx.drawImage(img, Math.round(cx - w / 2), Math.round(cy - h / 2 + dy * sy), w, h);
      }
    };
    draw(back);
    if (spr) draw(spr.canvas, ic.pop > 0 ? -Math.round(Math.sin(ic.pop * Math.PI) * 2) : 0);
    draw(front);
    if (active) {
      // a crisp white selection ring + sparkle orbiting the bubble
      ctx.globalAlpha = a0 * alpha * 0.9;
      const ring = aeroCached(`dring|${ICON}`, () => {
        const c = makeCanvas(ICON + 4, ICON + 4), g = ctxOf(c), R = ICON / 2 + 1.5, C = (ICON + 4) / 2;
        g.fillStyle = '#ffffff';
        for (let i = 0; i < 360; i++) { const a = (i / 360) * 6.283; g.fillRect(Math.round(C + Math.cos(a) * R - 0.5), Math.round(C + Math.sin(a) * R - 0.5), 1, 1); }
        return c;
      });
      ctx.drawImage(ring, cx - (ICON + 4) / 2, cy - (ICON + 4) / 2);
      const a = t * 2.4;
      drawSparkle(ctx, cx + Math.cos(a) * (ICON / 2 + 2), cy + Math.sin(a) * (ICON / 2 + 2), 2, 1);
      ctx.globalAlpha = a0 * alpha;
    }
    if (ic.state === 'normal' && hov > 0.3 && (t * 1.3 + ic.phase) % 2.6 < 0.12) drawSparkle(ctx, bx + 12, by + 9, 2, 1);
    const badge = ic.kind === 'menu' ? this.badgeOf(ic) : null;
    if (badge) drawAeroBadge(ctx, bx + ICON + 2, by - 1, badge, t);
    ctx.globalAlpha = a0;
  }

  drawLabel(ctx, ic, x, y, t) {
    const bob = this.bobOf(ic, t);
    const lift = Math.round(ic.hover * 3);
    ctx.globalAlpha = Math.min(1, (ic.hover - 0.5) * 3);
    drawAeroLabel(ctx, ic.label, Math.round(x + ICON / 2), Math.round(y + ICON + 2 + bob - lift), { align: 'center' });
    ctx.globalAlpha = 1;
  }

  drawDragged(ctx) {
    const d = this.drag;
    if (d?.kind === 'icon' && d.moved) {
      // drop target preview: a faint ring in the cell it will land in
      const gx = clamp(Math.round((d.ic.x + ICON / 2 - 8 - CELL_W / 2) / CELL_W), 0, 7), gy = clamp(Math.round((d.ic.y + ICON / 2 - 8 - ICON / 2) / CELL_H), 0, this.rows() - 1);
      const p = this.cellPos(gx, gy);
      ctx.globalAlpha = 0.35;
      ctx.drawImage(bubblePart('#ffffff', 'back'), p.x + Math.round((CELL_W - ICON) / 2), p.y);
      ctx.globalAlpha = 1;
      this.drawIcon(ctx, d.ic, d.ic.x, d.ic.y, this.time, { hover: 1 });
    }
  }

  // Modal open: the menu bubbles sit above the dim and work as tabs.
  drawMenuOverlay(ctx, inp, interactive = true) {
    const g = this.game, t = this.time, dt = this.dt || 1 / 60;
    if (this.layoutDirty) this.layout();
    let hot = null;
    const list = this.menu.filter((ic) => ic.state === 'normal');
    if (interactive) for (const ic of list) if (dist(inp.x, inp.y, ic.x + ic.offX + ICON / 2, ic.y + ic.offY + ICON / 2) <= ICON / 2 + 1) hot = ic;
    for (const ic of list) {
      ic.hover = damp(ic.hover, ic === hot ? 1 : 0, 14, dt);
      this.drawIcon(ctx, ic, ic.x + ic.offX, ic.y + ic.offY, t, { active: this.isActive(ic) });
    }
    if (hot) {
      this.drawLabel(ctx, hot, hot.x + hot.offX, hot.y + hot.offY, t);
      if (inp.pressed && !g.fishing?.fighting) { inp.consume(); this.activate(hot); }
    }
    this.overlayHot = hot;
    return hot;
  }

  // ------------------------------------------------------------ the Bait Tray
  drawBox(ctx, dropY = 0) {
    const b = this.box, t = this.time;
    const bounce = Math.sin(b.bounce * 12) * b.bounce * 3;
    const x = Math.round(b.x), y = Math.round(b.y - bounce + dropY);
    const hov = b.hover;
    if (hov) drawAeroGlow(ctx, x + b.w / 2, y + b.h / 2, 34, '#bff6ff', 0.5);
    ctx.drawImage(aeroCached(`tray|${b.w}|${b.h}|${hov}`, () => aeroSurface(b.w, b.h, {
      tone: hov ? { top: '#d8fbff', mid: '#5ccaf8', bot: '#1f86d6', edge: '#0b4a8a', a: [1, 1], glow: '#c8fbff' } : 'aqua',
      r: 'pill', gloss: 0.75, glossH: 12, curve: 2, rim: 0.9, glow: 0.6, sparkle: 1,
    })), x, y);
    // the dish: a white bubble holding the bait
    const dcx = x + 15, dcy = y + Math.round(b.h / 2);
    ctx.drawImage(aeroCached('traydish', () => aeroSurface(22, 22, { tone: 'frost', r: 'pill', gloss: 0.55, glossH: 9, curve: 1, rim: 0.9, glow: 0.5, glowColor: '#bfeaff', inset: true })), dcx - 11, dcy - 11);
    const cur = this.bait();
    if (cur?.mini) {
      const m = cur.mini, wob = Math.round(Math.sin(t * 2.4) * (hov ? 1 : 0.5));
      ctx.drawImage(m, Math.round(dcx - m.width / 2), Math.round(dcy - m.height / 2) + wob);
    } else {
      ctx.globalAlpha = 0.6;
      ctx.drawImage(getUiIcon('plus') || getUiIcon('bait'), dcx - 4, dcy - 4);
      ctx.globalAlpha = 1;
    }
    drawAeroBubble(ctx, dcx + 7, dcy - 7, 2, 0.8);
    const n = cur ? cur.count : 0;
    const txt = n > 999 ? '999+' : String(n);
    drawText(ctx, txt, x + b.w - 9, y + Math.round(b.h / 2) - 3, { align: 'right', color: n ? '#ffffff' : '#ffe0d8', shadow: n ? '#0a3e74' : '#8a1828' });
    if (hov) {
      let total = 0;
      try { total = totalBait(this.game.state); } catch { total = n; }
      this.tooltip = cur ? `${cur.name}  (${total})` : 'No bait';
    }
  }

  // ------------------------------------------------------------ windows
  drawWindows(ctx) {
    for (const w of this.windows) {
      if (w.min) continue;
      const k = w.open < 1 ? ease.outCubic(w.open) : 1;
      const R = APP_RENDERERS[w.app] || APP_RENDERERS.generic;
      const active = this.windows[this.windows.length - 1] === w;
      ctx.save();
      if (k < 1) {
        ctx.globalAlpha = w.open;
        const cx = w.x + w.w / 2, cy = w.y + w.h / 2;
        ctx.translate(cx, cy + (1 - k) * 10); ctx.scale(0.92 + 0.08 * k, 0.92 + 0.08 * k); ctx.translate(-cx, -cy);
      }
      const hot = this.winHot?.w === w ? this.winHot.part : null;
      const rects = drawWindowChrome(ctx, w, { title: w.title, iconCanvas: getMiniIcon(w.icon), active, hover: hot });
      const content = rects?.content || this.chromeRects(w).content;
      ctx.beginPath();
      ctx.rect(content.x, content.y, content.w, content.h);
      ctx.clip();
      try { R.draw(ctx, w, this.game, content, this.time); } catch (e) { if (!w.err) { w.err = true; console.error(e); } }
      ctx.restore();
    }
    this.winHot = null;
  }

  // ------------------------------------------------------------ taskbar
  drawTaskbar(ctx) {
    const g = this.game;
    const H = this.H, y = H - TASKBAR_H;
    drawTaskbar(ctx, 0, y, this.W, TASKBAR_H);
    // window buttons (glass pills)
    for (const b of this.taskButtons()) {
      const active = this.windows[this.windows.length - 1] === b.win && !b.win.min;
      drawButton(ctx, b.x, b.y, b.w, b.h, { label: b.win.title, icon: getMiniIcon(b.win.icon), state: active ? 'down' : 'normal', style: 'glass', align: 'left', font: 'small' });
    }
    // tray
    const tray = this.trayRects();
    for (const k of ['pause', 'sound']) {
      const r = tray[k];
      if (this.trayHot === k) ctx.drawImage(aeroCached(`trayhot|${r.w}|${r.h}`, () => aeroSurface(r.w, r.h, { tone: 'clear', r: 4, gloss: 0.7, glossH: 7, rim: 0.7, glow: 0.5 })), r.x, r.y);
      const ic = getUiIcon(k === 'pause' ? (g.paused ? 'play' : 'pause') : g.muted ? 'mute' : 'sound');
      ctx.drawImage(ic, r.x + Math.round((r.w - ic.width) / 2), r.y + Math.round((r.h - ic.height) / 2));
    }
    const hh = g.clock?.hour?.() ?? 12;
    const timeStr = `${String(Math.floor(hh)).padStart(2, '0')}:${String(Math.floor((hh % 1) * 60)).padStart(2, '0')}`;
    const ci = getUiIcon(g.clock?.isNight?.() ? 'moon' : 'sun');
    ctx.drawImage(ci, tray.clock.x + 1, tray.clock.y + Math.round((tray.clock.h - ci.height) / 2));
    drawText(ctx, timeStr, tray.clock.x + tray.clock.w - 3, tray.clock.y + 5, { align: 'right', color: '#ffffff', shadow: '#03183a' });
    // the start orb rises a little above the bar
    const o = this.orbRect();
    const st = this.startOpen ? 'down' : this.startHot ? 'hover' : 'normal';
    if (st !== 'normal') drawAeroGlow(ctx, o.x + ORB / 2, o.y + ORB / 2, 20, '#8ff6ff', st === 'hover' ? 0.6 : 0.4);
    ctx.drawImage(aeroCached(`orb|${ORB}|${st}`, () => orbTex(st)), o.x, o.y);
    if (st === 'hover' && (this.time * 0.8) % 2 < 0.15) drawSparkle(ctx, o.x + 8, o.y + 6, 2, 1);
    if (this.startOpen) this.drawStart(ctx);
  }

  drawStart(ctx) {
    const r = this.startRect();
    const t = this.time;
    ctx.fillStyle = rgba('#03183a', 0.25);
    ctx.fillRect(r.x + 3, r.y + 4, r.w, r.h);
    ctx.drawImage(aeroCached(`startbg|${r.w}|${r.h}`, () => aeroSurface(r.w, r.h, { tone: 'dark', r: 8, gloss: 0.4, glossH: 22, curve: 4, rim: 0.8, glow: 0.5, streak: true, bubbles: 3, sparkle: 2 })), r.x, r.y);
    // header: orb + game name
    ctx.drawImage(aeroCached(`orbs|${ORB}`, () => orbTex('normal')), r.x + 3, r.y - 4);
    drawText(ctx, 'FISHTOP', r.x + ORB + 8, r.y + 9, { color: '#ffffff', shadow: '#03183a' });
    // white list well
    const lw = { x: r.x + 4, y: r.y + 24, w: r.w - 8, h: r.h - 28 };
    ctx.drawImage(aeroCached(`startlist|${lw.w}|${lw.h}`, () => aeroSurface(lw.w, lw.h, { tone: 'frost', r: 5, gloss: 0.25, glossH: 12, rim: 0.9, glow: 0.3, glowColor: '#bfeaff' })), lw.x, lw.y);
    let y = r.y + 26;
    this.startItems().forEach((it, i) => {
      if (it.sep) {
        ctx.fillStyle = rgba('#5aa2cc', 0.45);
        ctx.fillRect(lw.x + 8, y + 3, lw.w - 16, 1);
        y += 7;
        return;
      }
      const hov = this.startHover === i;
      if (hov) ctx.drawImage(aeroCached(`starthot|${lw.w - 4}`, () => aeroSurface(lw.w - 4, 19, { tone: 'aqua', r: 5, gloss: 0.7, glossH: 9, curve: 1, rim: 0.7, glow: 0.6 })), lw.x + 2, y);
      if (it.big) {
        const s = getBigIcon(it.big, { size: 18 });
        ctx.drawImage(s.canvas, lw.x + 13 - Math.round(s.canvas.width / 2), y + 10 - Math.round(s.canvas.height / 2));
      } else {
        const ic = getUiIcon(it.icon);
        ctx.drawImage(ic, lw.x + 13 - Math.round(ic.width / 2), y + 10 - Math.round(ic.height / 2));
      }
      drawText(ctx, it.label, lw.x + 27, y + 6, { color: hov ? '#ffffff' : AERO.ink, shadow: hov ? '#0a4680' : null });
      const ic = this.menu.find((m) => m.id === it.id);
      const badge = ic ? this.badgeOf(ic) : null;
      if (badge) drawAeroBadge(ctx, lw.x + lw.w - 4, y + 4, badge, t);
      y += 20;
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

void MENU_IDS;
