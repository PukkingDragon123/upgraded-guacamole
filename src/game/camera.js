// Camera: vertical world scroll (surface <-> underwater), cinematic focus zoom, letterbox,
// screen shake, zoom punch, flash and slow motion.
//
// World space: y = 0 is the top of the default underwater view; negative y goes up toward the
// surface and the boat. scrollY is the world y shown at the top of the screen (0 = default view,
// negative = scrolled up). Focus zoom is centred on a world point.

import { clamp, damp, lerp } from '../core/math.js';

export class Camera {
  constructor(game) {
    this.game = game;
    this.trauma = 0;
    this.zoom = 1; this.zoomTarget = 1; this.zx = 0; this.zy = 0; this.zoomT = 0;
    this.flashA = 0; this.flashColor = '#ffffff';
    this.slowT = 0; this.slowScale = 1;
    this.ox = 0; this.oy = 0;
    // scroll
    this.scrollY = 0; this.scrollTarget = 0; this.minScroll = 0; this.maxScroll = 0;
    // cinematic focus
    this.focusOn = false; this.focusX = 0; this.focusY = 0; this.focusZoom = 1; this.fz = 1; this.fx = 0; this.fy = 0;
    this.focusSpeed = 4;
    // letterbox 0..1
    this.bars = 0; this.barsTarget = 0;
  }

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

  // ---- scroll
  setScrollRange(min, max) { this.minScroll = min; this.maxScroll = max; this.scrollTarget = clamp(this.scrollTarget, min, max); }
  scrollBy(dy) { this.scrollTarget = clamp(this.scrollTarget + dy, this.minScroll, this.maxScroll); }
  scrollTo(y, instant = false) { this.scrollTarget = clamp(y, this.minScroll, this.maxScroll); if (instant) this.scrollY = this.scrollTarget; }

  // ---- cinematic focus (world point, zoom factor)
  focus(x, y, zoom = 2, speed = 4) {
    this.focusOn = true;
    this.focusX = x; this.focusY = y; this.focusZoom = zoom; this.focusSpeed = speed;
  }
  release(speed = 3) { this.focusOn = false; this.focusSpeed = speed; }
  setLetterbox(on) { this.barsTarget = on ? 1 : 0; }

  update(dt) {
    this.trauma = Math.max(0, this.trauma - dt * 18);
    const s = this.trauma;
    this.ox = Math.round((Math.random() * 2 - 1) * s * 0.6);
    this.oy = Math.round((Math.random() * 2 - 1) * s * 0.6);
    this.zoomT = Math.max(0, this.zoomT - dt);
    if (this.zoomT <= 0) this.zoomTarget = 1;
    this.zoom = damp(this.zoom, this.zoomTarget, this.zoomTarget > this.zoom ? 14 : 5, dt);
    this.flashA = Math.max(0, this.flashA - dt * 4);
    this.slowT = Math.max(0, this.slowT - dt);
    this.scrollY = damp(this.scrollY, this.scrollTarget, 8, dt);
    if (Math.abs(this.scrollY - this.scrollTarget) < 0.3) this.scrollY = this.scrollTarget;
    const W = this.game.screen.W, H = this.game.screen.H;
    const tz = this.focusOn ? this.focusZoom : 1;
    this.fz = damp(this.fz, tz, this.focusSpeed, dt);
    const tx = this.focusOn ? this.focusX : W / 2, ty = this.focusOn ? this.focusY : this.scrollY + H / 2;
    this.fx = damp(this.fx || tx, tx, this.focusSpeed * 1.3, dt);
    this.fy = damp(this.fy || ty, ty, this.focusSpeed * 1.3, dt);
    this.bars = damp(this.bars, this.barsTarget, 6, dt);
  }

  // Total transform world -> screen: [scale, offsetX, offsetY]
  xform() {
    const W = this.game.screen.W, H = this.game.screen.H;
    let z = this.fz;
    let cx = W / 2, cy = this.scrollY + H / 2;
    if (z > 1.001) {
      // pan toward the focus point while zooming, clamped so we never show outside the world band
      const k = Math.min(1, (z - 1) / Math.max(0.001, (this.focusZoom || z) - 1));
      cx = lerp(cx, this.fx, k);
      cy = lerp(cy, this.fy, k);
      cx = clamp(cx, W / (2 * z), W - W / (2 * z));
    }
    // punch zoom on top
    if (this.zoom > 1.001) z *= this.zoom;
    return [z, Math.round(W / 2 - cx * z + this.ox), Math.round(H / 2 - cy * z + this.oy)];
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
    const W = this.game.screen.W, H = this.game.screen.H;
    const h = Math.round(H * 0.11 * this.bars);
    ctx.fillStyle = '#05080c';
    ctx.fillRect(0, 0, W, h);
    ctx.fillRect(0, H - h, W, h);
  }

  drawFlash(ctx) {
    if (this.flashA > 0.01) {
      ctx.globalAlpha = this.flashA;
      ctx.fillStyle = this.flashColor;
      ctx.fillRect(0, 0, this.game.screen.W, this.game.screen.H);
      ctx.globalAlpha = 1;
    }
  }
}
