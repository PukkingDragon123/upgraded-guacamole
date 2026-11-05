// Camera: the zoomed-in follow camera for the ocean world, cinematic focus zoom, letterbox, screen shake, zoom
// punch, flash and slow motion.
//
// World space: y = 0 is the top of the old full-screen underwater view; negative y goes up toward the surface, the
// boat and the sky. The world is one logical screen wide (game.screen.W) and spans [ocean.top, H] vertically.
// In the open ocean the camera sits close: base zoom `state.settings.zoom` (default 3, Ctrl/Alt + wheel or +/-
// change it between ZOOM.min and ZOOM.max; saves from before phase 6 are scaled up once) and it follows the action:
//   - the hook (cursor) while fishing: a soft dead zone; nearing a screen edge pans the camera (edge follow),
//   - the boat while it is dragged; at the surface view an idle camera drifts back over the boat,
//   - fights / cinematics: camera.focus(x, y, zoom) - the focus zoom stacks on top of the base zoom.
// The wheel, Home/End and PageUp/PageDown scroll between the surface (boat), the shelf seabed and, below its lip, the
// deep zones down to the abyss floor (phase 6, see src/world/depthzones.js): scrollKeys(inp) handles Home (surface),
// End (the abyss floor) and PageUp/PageDown (one zone stop); the hook nearing the bottom edge dives the camera,
// faster the longer it is held there. The old scroll units (minScroll .. 0 = surface view .. shelf seabed view) still
// map onto the surface .. shelf travel and continue linearly (> 0) into the deep; scrollY (biome parallax) clamps at 0.
// Outside the open ocean (aquarium, mini, travel) the camera is the old identity view (zoom 1, whole screen).
//
// API: shake, punch, flash, slowmo, timeScale, setScrollRange, scrollBy, scrollTo, focus, release, setLetterbox,
// update, xform() -> [zoom, ox, oy] (screen = world * zoom + o), view() -> {x0, y0, x1, y1, z}, worldToScreen,
// screenToWorld, apply(ctx), reset(ctx), drawBars, drawFlash, surfaceK(); fields z (current zoom), cx/cy (centre),
// scrollY (old-style scroll value, for parallax), open (zoomed ocean view active).

import { clamp, damp, lerp } from '../core/math.js';

export const ZOOM = { min: 2, max: 4.5, def: 3 }; // [phase6:oceans] zoomed in a lot more
// how much of a cinematic focus zoom (authored for the old 1x view) stacks on top of the base zoom
const CINE_K = 0.3;
// surface view: the waterline sits this far down the screen (0..1)
const SURF_AT = 0.66;

export class Camera {
  constructor(game) {
    this.game = game;
    this.trauma = 0;
    this.zoom = 1; this.zoomTarget = 1; this.zx = 0; this.zy = 0; this.zoomT = 0; // punch
    this.flashA = 0; this.flashColor = '#ffffff';
    this.slowT = 0; this.slowScale = 1;
    this.ox = 0; this.oy = 0;
    // follow camera: centre (cx, cy), eased target (tx, ty), zoom z (base * cinematic)
    const W = game.screen?.W || 960, H = game.screen?.H || 540;
    this.cx = W / 2; this.cy = H / 2; this.tx = this.cx; this.ty = this.cy;
    this.z = 1; this.base = 1;
    this.leadX = 0; this.leadY = 0;
    this.open = false; this.wasOpen = false;
    this.manualT = 0; // explicit scrolling pauses the edge follow briefly
    this.pin = null; // {k: 0 surface .. 1 seabed, t}: hold a scroll framing while the zoom changes
    this.idleT = 0;
    // old scroll API (kept for game.js / fishing / build): range in old full-screen units
    this.minScroll = 0; this.maxScroll = 0;
    // cinematic focus
    this.focusOn = false; this.focusX = 0; this.focusY = 0; this.focusZoom = 1; this.fz = 1;
    this.focusSpeed = 4;
    // letterbox 0..1
    this.bars = 0; this.barsTarget = 0;
    // Ctrl / Alt + wheel zooms (plain wheel scrolls)
    this.zoomWheel = 0;
    if (typeof window !== 'undefined') {
      window.addEventListener('wheel', (e) => { if (e.ctrlKey || e.altKey || e.metaKey) this.zoomWheel += Math.sign(e.deltaY); }, { capture: true, passive: true });
    }
  }

  get W() { return this.game.screen.W; }
  get H() { return this.game.screen.H; }

  shake(n) {
    if (this.game.state.settings.reducedMotion) n *= 0.3;
    this.trauma = Math.min(10, this.trauma + n);
  }

  punch(x, y, amount = 0.12, time = 0.6) {
    if (this.game.state.settings.reducedMotion) amount *= 0.3;
    this.zx = x; this.zy = y;
    this.zoomTarget = 1 + amount;
    this.zoomT = time;
  }

  flash(color = '#ffffff', a = 0.8) {
    this.flashColor = color;
    this.flashA = this.game.state.settings.reducedMotion ? a * 0.3 : a;
  }

  slowmo(scale, time) {
    this.slowScale = scale;
    this.slowT = time;
  }

  timeScale() { return this.slowT > 0 ? this.slowScale : 1; }

  // ---- zoom setting
  baseZoom() {
    const st = this.game.state?.settings;
    if (st && st.zoomV !== 6) { // pre-phase-6 saves: the old ~2x zoom becomes ~3x
      const z0 = Number(st.zoom);
      if (Number.isFinite(z0) && z0 > 0) st.zoom = Math.round(clamp(z0 * 1.5, ZOOM.min, ZOOM.max) * 20) / 20;
      st.zoomV = 6;
    }
    const z = Number(st?.zoom);
    return Number.isFinite(z) && z > 0 ? clamp(z, ZOOM.min, ZOOM.max) : ZOOM.def;
  }

  setZoom(z) {
    const s = this.game.state?.settings;
    if (!s) return;
    s.zoom = Math.round(clamp(z, ZOOM.min, ZOOM.max) * 20) / 20;
  }

  // ---- world bounds for the follow camera at zoom z: centre ranges
  bounds(z, free = true) {
    const W = this.W, H = this.H, g = this.game;
    const hw = W / (2 * z), hh = H / (2 * z);
    const top = Number.isFinite(g.ocean?.top) ? g.ocean.top : -Math.ceil(H * 0.74);
    let y0 = top + hh;
    if (free) {
      // the free camera stops at the surface view: the waterline (or the boat's distant surface) SURF_AT down
      let L = null;
      try { L = g.ocean?.waterLevel?.() ?? null; } catch { L = null; }
      const s = Number.isFinite(L) ? L : 0;
      y0 = Math.max(y0, Math.min(s + (0.5 - SURF_AT) * 2 * hh, H - hh));
    }
    // [phase6:oceans] the world continues below the shelf (H) down to the deep column's bottom
    let bottom = H;
    try { const v = g.ocean?.deepBottom?.(); if (Number.isFinite(v) && v > H && !g.ocean?.travelState) bottom = v; } catch { bottom = H; }
    const y1 = Math.max(y0, bottom - hh);
    const yShelf = clamp(H - hh, y0, y1);
    const x0 = Math.min(hw, W / 2), x1 = Math.max(W - hw, W / 2);
    return { x0, x1, y0, y1, yShelf, hw, hh };
  }

  // old scroll units (minScroll..0) <-> centre y of the free camera
  refScroll() { const r = this.game.surfaceScroll; return Number.isFinite(r) && r < 0 ? r : -Math.round(this.H * 0.62); }
  scrollToY(s) {
    const b = this.bounds(this.open ? this.baseZoom() : this.base);
    const k = Math.max(0, 1 - s / this.refScroll()); // > 1: below the shelf view, into the deep
    return clamp(lerp(b.y0, b.yShelf, k), b.y0, b.y1);
  }
  yToScroll(y) {
    if (!this.open) return 0;
    const b = this.bounds(this.base);
    const k = b.yShelf > b.y0 ? Math.max(0, (y - b.y0) / (b.yShelf - b.y0)) : 1;
    return this.refScroll() * (1 - k);
  }

  // Old-style scroll value (surfaceScroll at the surface view, 0 at the shelf seabed view; never deeper, so the
  // biomes' parallax stays as authored). scrollTarget keeps the real (possibly deep) value for save / restore.
  get scrollY() { return Math.min(0, this.yToScroll(this.cy)); }
  set scrollY(v) { this.cy = this.ty = this.scrollToY(v); }
  get scrollTarget() { return this.yToScroll(this.ty); }

  // ---- scroll (old units; see header)
  setScrollRange(min, max) { this.minScroll = min; this.maxScroll = max; }
  scrollBy(dy) {
    if (!this.open) return;
    this.pin = null;
    const deep = this.ty > this.H - this.H / (2 * this.z); // [phase6:oceans] long dives scroll faster
    this.ty += dy * (this.H / this.z) / this.H * 1.25 * (deep ? 2.4 : 1);
    this.manualT = 0.7;
    this.clampTargets();
  }
  scrollTo(y, instant = false) {
    if (!this.open) return;
    this.ty = this.scrollToY(y);
    this.pin = { s: y, t: 1.2 }; // keep the framing while the zoom settles
    // the surface view centres on the boat
    const boat = this.game.boat;
    if (y <= this.refScroll() + 1 && boat?.visible && !this.focusOn) this.tx = boat.x;
    this.manualT = 0.9;
    this.clampTargets();
    void instant; // eased either way (a hard cut here would jump right before travel / view changes)
  }

  clampTargets() {
    const b = this.bounds(this.z);
    this.tx = clamp(this.tx, b.x0, b.x1);
    this.ty = clamp(this.ty, b.y0, b.y1);
  }

  // Jump straight to a world point (no easing).
  snapTo(x, y) {
    this.pin = null;
    this.tx = this.cx = x; this.ty = this.cy = y;
    this.clampTargets();
    this.cx = this.tx; this.cy = this.ty;
  }

  // Frame the boat at the surface view.
  home(instant = false) {
    const boat = this.game.boat;
    const b = this.bounds(this.baseZoom()); // where the surface view will be once the zoom has settled
    this.tx = clamp(boat?.x ?? this.W / 2, b.x0, b.x1);
    this.ty = b.y0;
    this.pin = { s: this.refScroll(), t: 1.6 };
    if (instant) { this.cx = this.tx; this.cy = this.ty; }
  }

  // ---- cinematic focus (world point, zoom factor authored for the old 1x view; stacks on the base zoom)
  focus(x, y, zoom = 2, speed = 4) {
    this.focusOn = true;
    this.focusX = x; this.focusY = y; this.focusZoom = zoom; this.focusSpeed = speed;
  }
  release(speed = 3) {
    if (this.focusOn) { this.tx = this.cx; this.ty = this.cy; }
    this.focusOn = false; this.focusSpeed = speed;
  }
  setLetterbox(on) { this.barsTarget = on ? 1 : 0; }

  // Is the zoomed open-ocean camera active?
  isOpen() {
    const g = this.game;
    if (g.mini || g.state?.view !== 'ocean') return false;
    if (g.ocean?.travelState) return false;
    if (g.tutorial?.intro?.opaque) return false;
    return true;
  }

  update(dt) {
    const g = this.game;
    this.step(dt);
    // the visible world rect for world systems (fish spawn around it, culling)
    if (g.world) g.world.view = this.open ? this.view() : null;
  }

  step(dt) {
    const g = this.game;
    this.trauma = Math.max(0, this.trauma - dt * 18);
    const s = this.trauma;
    this.ox = Math.round((Math.random() * 2 - 1) * s * 0.6);
    this.oy = Math.round((Math.random() * 2 - 1) * s * 0.6);
    this.zoomT = Math.max(0, this.zoomT - dt);
    if (this.zoomT <= 0) this.zoomTarget = 1;
    this.zoom = damp(this.zoom, this.zoomTarget, this.zoomTarget > this.zoom ? 14 : 5, dt);
    this.flashA = Math.max(0, this.flashA - dt * 4);
    this.slowT = Math.max(0, this.slowT - dt);
    this.bars = damp(this.bars, this.barsTarget, 6, dt);
    this.manualT = Math.max(0, this.manualT - dt);

    const W = this.W, H = this.H;
    const open = this.isOpen();
    this.open = open;
    const inp = g.input;
    // zoom setting: Ctrl / Alt + wheel, +/- keys (only in the open ocean)
    if (this.zoomWheel) {
      if (open && !g.ui?.blocking) this.setZoom(this.baseZoom() * Math.pow(1.1, -this.zoomWheel));
      this.zoomWheel = 0;
      if (inp) inp.wheel = 0;
    }
    if (open && inp?.keyPressed && !g.ui?.blocking) {
      if (inp.keyPressed('+') || inp.keyPressed('=')) this.setZoom(this.baseZoom() * 1.12);
      if (inp.keyPressed('-') || inp.keyPressed('_')) this.setZoom(this.baseZoom() / 1.12);
    }

    if (!open) {
      // aquarium / mini / opaque intro: the old identity view; travel eases out to it
      const travel = !!g.ocean?.travelState && g.state?.view === 'ocean' && !g.mini;
      if (travel) {
        this.base = damp(this.base, 1, 6, dt);
        if (this.base < 1.004) this.base = 1;
      } else this.base = 1;
      this.fz = 1;
      this.z = this.base;
      this.cx = travel ? damp(this.cx, W / 2, 6, dt) : W / 2;
      this.cy = travel ? damp(this.cy, H / 2, 6, dt) : H / 2;
      if (!travel) { this.focusOn = false; }
      this.tx = this.cx; this.ty = this.cy;
      this.wasOpen = false;
      return;
    }

    // ---- zoom: base (setting) x cinematic focus on top
    const baseT = this.baseZoom();
    this.base = damp(this.base, baseT, 3.2, dt);
    if (Math.abs(this.base - baseT) < 0.003) this.base = baseT;
    const cineT = this.focusOn ? Math.max(0.75, 1 + (this.focusZoom - 1) * CINE_K) : 1;
    this.fz = damp(this.fz, cineT, this.focusSpeed, dt);
    if (Math.abs(this.fz - cineT) < 0.002) this.fz = cineT;
    this.z = this.base * this.fz;
    if (!this.wasOpen) {
      // entering the open ocean (start, arrival after travel, back from the aquarium): over the boat at the surface
      this.wasOpen = true;
      const travelled = this.base < baseT - 0.01;
      this.home(!travelled);
      if (!travelled) { this.base = baseT; this.z = this.base * this.fz; }
    }

    const z = this.z;
    if (this.focusOn) {
      // cinematic: glide to the focus point (bounded by the world, not the surface view)
      const b = this.bounds(z, false);
      const fx = clamp(this.focusX, b.x0, b.x1), fy = clamp(this.focusY, b.y0, b.y1);
      const k = this.focusSpeed * 1.3;
      this.cx = damp(this.cx, fx, k, dt);
      this.cy = damp(this.cy, fy, k, dt);
      this.tx = this.cx; this.ty = this.cy;
      this.leadX = damp(this.leadX, 0, 4, dt); this.leadY = damp(this.leadY, 0, 4, dt);
      return;
    }

    // ---- free follow
    const b = this.bounds(z), hard = this.bounds(z, false);
    const vw = W / z, vh = H / z;
    if (this.pin?.t > 0) { this.pin.t -= dt; this.ty = this.scrollToY(this.pin.s); }
    const boat = g.boat, hook = g.fishing?.hook, cur = g.world?.cursor;
    let sub = null;
    if (boat?.dragging) sub = { x: boat.x, y: boat.y - 16, vx: boat.vx || 0, vy: 0 };
    else if (hook?.visible && cur?.inWorld && inp?.inside) sub = { x: hook.x, y: hook.y, vx: (inp.vx || 0) / z, vy: (inp.vy || 0) / z };
    this.tx = clamp(this.tx, b.x0, b.x1); this.ty = clamp(this.ty, b.y0, b.y1);
    this.cx = damp(this.cx, this.tx, 5, dt);
    { const ny = damp(this.cy, this.ty, 5, dt), vmax = 1500 * dt; this.cy += clamp(ny - this.cy, -vmax, vmax); } // dives glide
    if (sub) {
      this.idleT = 0;
      if (this.manualT <= 0) {
        // dead zone: the middle of the screen; beyond it the camera pans proportionally (edge follow)
        const dzx = vw * 0.3, dzy = vh * 0.27;
        const ex = sub.x - this.cx, ey = sub.y - this.cy;
        const ovx = Math.abs(ex) - dzx, ovy = Math.abs(ey) - dzy;
        const rate = 3.2;
        // [phase6:oceans] holding the hook at the top / bottom edge dives (or climbs) faster and faster
        this.edgeT = ovy > vh * 0.08 ? (this.edgeT || 0) + dt : 0;
        const boost = 1 + clamp(this.edgeT - 0.35, 0, 1.6) * 2.2;
        if (ovx > 0) { const n = clamp(this.tx + Math.sign(ex) * ovx * Math.min(1, rate * dt), b.x0, b.x1); this.cx += n - this.tx; this.tx = n; }
        if (ovy > 0) { const n = clamp(this.ty + Math.sign(ey) * ovy * Math.min(1, rate * boost * dt), b.y0, b.y1); this.cy += n - this.ty; this.ty = n; }
      }
      // a small lead in the direction of motion
      this.leadX = damp(this.leadX, clamp(sub.vx * 0.08, -vw * 0.06, vw * 0.06), 3, dt);
      this.leadY = damp(this.leadY, clamp(sub.vy * 0.06, -vh * 0.05, vh * 0.05), 3, dt);
    } else {
      this.idleT += dt;
      this.leadX = damp(this.leadX, 0, 2, dt); this.leadY = damp(this.leadY, 0, 2, dt);
      // at the surface view an idle camera drifts back over the boat
      if (boat?.visible && this.idleT > 1.5 && this.ty <= b.y0 + vh * 0.1 && !g.fishing?.busy) this.tx = clamp(damp(this.tx, boat.x, 1.2, dt), b.x0, b.x1);
    }
    // hard limits = the world; the surface-view limit is soft (no jump after a cinematic above it)
    this.cx = clamp(this.cx, hard.x0, hard.x1); this.cy = clamp(this.cy, hard.y0, hard.y1);
    this.leadX = clamp(this.cx + this.leadX, b.x0, b.x1) - this.cx;
    this.leadY = clamp(this.cy + this.leadY, hard.y0, b.y1) - this.cy;
  }

  // Total transform world -> screen: [scale, offsetX, offsetY]
  xform() {
    const W = this.W, H = this.H;
    let z = this.z;
    const cx = this.cx + (this.open ? this.leadX : 0), cy = this.cy + (this.open ? this.leadY : 0);
    // punch zoom on top
    if (this.zoom > 1.001) z *= this.zoom;
    return [z, Math.round(W / 2 - cx * z + this.ox), Math.round(H / 2 - cy * z + this.oy)];
  }

  // Visible world rectangle {x0, y0, x1, y1, z} (includes shake/zoom).
  view() {
    const [z, ox, oy] = this.xform();
    const W = this.W, H = this.H;
    return { x0: -ox / z, y0: -oy / z, x1: (W - ox) / z, y1: (H - oy) / z, z };
  }

  // 0 = seabed / default underwater view (or deeper), 1 = surface view.
  surfaceK() {
    if (!this.open) return 0;
    const b = this.bounds(this.base);
    return b.yShelf > b.y0 ? clamp((b.yShelf - this.cy) / (b.yShelf - b.y0), 0, 1) : 0;
  }

  // [phase6:oceans] Home = the surface view, End = the abyss floor, PageUp / PageDown = one zone stop. Returns true
  // when it handled a key (game.js then skips its old surface / seabed jumps).
  scrollKeys(inp) {
    if (!this.open || !inp?.keyPressed) return false;
    const home = inp.keyPressed('Home'), end = inp.keyPressed('End'), up = inp.keyPressed('PageUp'), down = inp.keyPressed('PageDown');
    if (!(home || end || up || down)) return false;
    const zones = this.game.ocean?.biome?.deep?.L?.zones;
    if (!zones) return false;
    if (home) { this.scrollTo(this.refScroll()); return true; }
    const b = this.bounds(this.baseZoom());
    const stops = [b.y0, b.yShelf];
    for (const z of zones) if (z.deep) stops.push(clamp((z.top + z.y1) / 2, b.y0, b.y1));
    stops.push(b.y1);
    stops.sort((p, q) => p - q);
    let y = end ? b.y1 : null;
    if (down && y === null) y = stops.find((q) => q > this.ty + 12) ?? b.y1;
    if (up) y = [...stops].reverse().find((q) => q < this.ty - 12) ?? b.y0;
    this.pin = null;
    this.ty = y;
    if (y <= b.y0 + 1 && this.game.boat?.visible) this.tx = this.game.boat.x;
    this.manualT = 1.4;
    this.clampTargets();
    return true;
  }

  worldToScreen(x, y) {
    const [z, ox, oy] = this.xform();
    return [x * z + ox, y * z + oy];
  }

  screenToWorld(x, y) {
    const [z, ox, oy] = this.xform();
    return [(x - ox) / z, (y - oy) / z];
  }

  // Apply camera transform for world drawing.
  apply(ctx) {
    const [z, ox, oy] = this.xform();
    ctx.setTransform(z, 0, 0, z, ox, oy);
  }

  reset(ctx) { ctx.setTransform(1, 0, 0, 1, 0, 0); }

  drawBars(ctx) {
    if (this.bars < 0.01) return;
    const W = this.W, H = this.H;
    const h = Math.round(H * 0.11 * this.bars);
    if (h < 1) return;
    // glossy Frutiger Aero cinema bars: deep sky glass with a bright specular edge facing the action
    for (const [y0, edge] of [[0, h - 1], [H - h, H - h]]) {
      const g = ctx.createLinearGradient(0, y0, 0, y0 + h);
      g.addColorStop(0, y0 ? '#1c7fc4' : '#0a3f6e'); g.addColorStop(1, y0 ? '#0a3f6e' : '#1c7fc4');
      ctx.fillStyle = g;
      ctx.fillRect(0, y0, W, h);
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.fillRect(0, y0 + Math.round(h * (y0 ? 0.08 : 0.5)), W, Math.max(1, Math.round(h * 0.35)));
      ctx.fillStyle = 'rgba(190,240,255,0.85)';
      ctx.fillRect(0, edge, W, 1);
    }
  }

  drawFlash(ctx) {
    if (this.flashA > 0.01) {
      ctx.globalAlpha = this.flashA;
      ctx.fillStyle = this.flashColor;
      ctx.fillRect(0, 0, this.W, this.H);
      ctx.globalAlpha = 1;
    }
  }
}
