// Screen shake, zoom punch, flash and slow motion.

import { clamp, damp, lerp } from '../core/math.js';

export class Camera {
  constructor(game) {
    this.game = game;
    this.trauma = 0;
    this.zoom = 1; this.zoomTarget = 1; this.zx = 0; this.zy = 0; this.zoomT = 0;
    this.flashA = 0; this.flashColor = '#ffffff';
    this.slowT = 0; this.slowScale = 1;
    this.ox = 0; this.oy = 0;
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
  }

  // Apply camera transform for world drawing.
  apply(ctx) {
    const z = this.zoom;
    if (z > 1.001) {
      const W = this.game.screen.W, H = this.game.screen.H;
      const fx = clamp(this.zx, W / (2 * z), W - W / (2 * z));
      const fy = clamp(this.zy, H / (2 * z), H - H / (2 * z));
      ctx.setTransform(z, 0, 0, z, Math.round(W / 2 - fx * z + this.ox), Math.round(H / 2 - fy * z + this.oy));
    } else if (this.ox || this.oy) {
      ctx.setTransform(1, 0, 0, 1, this.ox, this.oy);
    }
  }

  reset(ctx) { ctx.setTransform(1, 0, 0, 1, 0, 0); }

  drawFlash(ctx) {
    if (this.flashA > 0.01) {
      ctx.globalAlpha = this.flashA;
      ctx.fillStyle = this.flashColor;
      ctx.fillRect(0, 0, this.game.screen.W, this.game.screen.H);
      ctx.globalAlpha = 1;
    }
  }
}
