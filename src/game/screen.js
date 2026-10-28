// Low-res render target that fills the window with integer nearest-neighbour scaling.

import { ctxOf } from '../core/canvas.js';

const TARGET_W = 960;

export class Screen {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.ctx = ctxOf(canvas);
    this.fixedScale = opts.scale || 0;
    this.W = 640; this.H = 360; this.scale = 3; this.dpr = 1;
    this.listeners = [];
    this.resize();
    let pending = 0;
    window.addEventListener('resize', () => {
      cancelAnimationFrame(pending);
      pending = requestAnimationFrame(() => this.resize());
    });
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const cssW = window.innerWidth, cssH = window.innerHeight;
    const devW = Math.round(cssW * dpr), devH = Math.round(cssH * dpr);
    let scale = this.fixedScale || Math.max(1, Math.round(devW / TARGET_W));
    while (scale > 1 && devH / scale < 420) scale--;
    while (!this.fixedScale && devW / scale > 1400) scale++;
    const W = Math.ceil(devW / scale), H = Math.ceil(devH / scale);
    const changed = W !== this.W || H !== this.H;
    this.W = W; this.H = H; this.scale = scale; this.dpr = dpr;
    this.canvas.width = W;
    this.canvas.height = H;
    this.canvas.style.width = (W * scale) / dpr + 'px';
    this.canvas.style.height = (H * scale) / dpr + 'px';
    this.ctx.imageSmoothingEnabled = false;
    if (changed) for (const f of this.listeners) f(W, H);
  }

  onResize(f) { this.listeners.push(f); }

  toLogical = (cx, cy) => {
    const r = this.canvas.getBoundingClientRect();
    return [((cx - r.left) / r.width) * this.W, ((cy - r.top) / r.height) * this.H];
  };
}
