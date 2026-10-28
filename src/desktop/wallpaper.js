// The "ordinary" desktop wallpaper shown before the ocean floods in (and in mini mode),
// plus the rising-water reveal used by the opening cinematic.

import { makeLayer, resizeLayer } from '../core/canvas.js';
import { PixelBuffer } from '../gfx/pixel.js';
import { pack, ramp, mix } from '../core/color.js';
import { bayer, fbm1, hash2, clamp, lerp, TAU } from '../core/math.js';

export class Wallpaper {
  constructor(game) {
    this.game = game;
    this.layer = makeLayer(8, 8);
    this.built = '';
    this.t = 0;
  }

  onResize() { this.built = ''; }

  build() {
    const { W, H } = this.game.screen;
    const key = W + 'x' + H;
    if (this.built === key) return;
    this.built = key;
    resizeLayer(this.layer, W, H);
    const buf = new PixelBuffer(W, H);
    const sky = ['#5aa8e8', '#7cc0f0', '#a0d4f4', '#c8e6f8', '#e6f4fb'].map((h) => pack(h));
    const hills = [ramp('#4caf50'), ramp('#3f9a48'), ramp('#2f8040')].map((r) => r.map((h) => pack(h)));
    const horizon = H * 0.62;
    for (let y = 0; y < H; y++) {
      const k = y / horizon;
      for (let x = 0; x < W; x++) {
        const idx = clamp(Math.floor(k * 4.6 + (bayer(x, y) - 0.5) * 0.9), 0, 4);
        buf.data[y * W + x] = sky[idx];
      }
    }
    // clouds
    for (let i = 0; i < 7; i++) {
      const cx = hash2(i, 1, 7) * W, cy = 30 + hash2(i, 2, 7) * H * 0.3, cw = 50 + hash2(i, 3, 7) * 90;
      for (let j = 0; j < 6; j++) {
        const px = cx + (j - 2.5) * cw * 0.18, py = cy - Math.sin((j / 5) * Math.PI) * cw * 0.12;
        buf.fillEllipse(px, py, cw * 0.16, cw * 0.1, pack('#ffffff'));
      }
      for (let x = Math.floor(cx - cw * 0.5); x < cx + cw * 0.5; x++) buf.set(x, Math.round(cy + cw * 0.08), pack('#d8eaf6'));
    }
    // three rolling hill layers
    for (let l = 0; l < 3; l++) {
      const base = horizon + l * H * 0.1;
      const R = hills[l];
      for (let x = 0; x < W; x++) {
        const top = base - (fbm1(x * 0.004 + l * 10, 3, 3 + l) - 0.3) * H * 0.22;
        for (let y = Math.max(0, Math.floor(top)); y < H; y++) {
          const d = y - top;
          const light = 0.75 - d / (H * 0.5) + (l === 0 ? 0.08 : 0);
          const idx = clamp(Math.floor(light * 4.99 + (bayer(x, y) - 0.5) * 0.8), 0, 4);
          buf.data[y * W + x] = R[idx];
        }
      }
    }
    this.layer.ctx.drawImage(buf.toCanvas(), 0, 0);
  }

  draw(ctx, dt, dim = false) {
    this.build();
    this.t += dt || 0;
    ctx.drawImage(this.layer.canvas, 0, 0);
    if (dim) { ctx.fillStyle = 'rgba(10,30,50,0.08)'; ctx.fillRect(0, 0, this.game.screen.W, this.game.screen.H); }
  }

  waterline(x) {
    const { H } = this.game.screen;
    const r = this.game.ocean.reveal;
    const base = lerp(H + 12, -30, r);
    return base + Math.sin(x * 0.03 + this.t * 2.2) * 4 + Math.sin(x * 0.011 - this.t * 1.3) * 6;
  }

  clipOcean(ctx) {
    const { W, H } = this.game.screen;
    ctx.beginPath();
    ctx.moveTo(0, H);
    for (let x = 0; x <= W; x += 6) ctx.lineTo(x, this.waterline(x));
    ctx.lineTo(W, H);
    ctx.closePath();
    ctx.clip();
  }

  drawWaterline(ctx) {
    const { W } = this.game.screen;
    if (this.game.ocean.reveal <= 0 || this.game.ocean.reveal >= 1) return;
    for (let x = 0; x < W; x++) {
      const y = Math.round(this.waterline(x));
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.fillRect(x, y - 1, 1, 2);
      ctx.fillStyle = 'rgba(160,230,255,0.6)';
      ctx.fillRect(x, y + 1, 1, 2);
    }
  }
}
