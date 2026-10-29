// The "ordinary" desktop wallpaper shown before the ocean floods in (and in mini mode),
// plus the rising-water reveal used by the opening cinematic.

import { makeLayer, resizeLayer } from '../core/canvas.js';
import { PixelBuffer } from '../gfx/pixel.js';
import { pack } from '../core/color.js';
import { bayer, fbm1, hash2, clamp, lerp } from '../core/math.js';
import { VoxelModel } from '../gfx/voxel.js';
import { RNG } from '../core/rng.js';
import { renderModel } from '../world/voxkit.js';
import { cloudSprites } from '../world/sky.js';

// A long voxel hill (yaw 0 so it stays level), grass ramp by height, optional trees and flowers.
function hillStrip(W, L) {
  const r = new RNG(L.seed);
  const s = 2, nx = Math.ceil(W / s) + 4, d = L.d;
  const amp = Math.round(L.amp / s);
  const ny = amp + 60;
  const m = new VoxelModel(nx, ny, d);
  const C = L.cols.map((c) => m.color(c, { jitter: 0.12 }));
  const flowers = ['#ffe25a', '#ff7aa8', '#ffffff', '#ff9a3a'].map((c) => m.color(c));
  const trunk = m.color('#6a4a2e', { jitter: 0.1 }), leaf = m.color(L.cols[1], { jitter: 0.15, smooth: 0.4 }), leafHi = m.color(L.cols[2], { jitter: 0.12 });
  const hgt = new Float32Array(nx);
  for (let x = 0; x < nx; x++) hgt[x] = 30 + (fbm1(x * 0.012 + L.seed * 10, 3, L.seed) - 0.25) * amp;
  for (let x = 0; x < nx; x++) for (let z = 0; z < d; z++) {
    const h = Math.max(2, Math.round(30 + (hgt[x] - 30) * (0.7 + 0.3 * Math.sin(((z + 0.5) / d) * Math.PI))));
    for (let y = 0; y < h; y++) {
      const fromTop = h - 1 - y;
      m.set(x, y, z, fromTop === 0 ? C[2] : fromTop < 3 ? C[1] : C[0]);
    }
    if (L.trees && hash2(x, z, 9) < 0.012) m.set(x, h, z, flowers[Math.floor(hash2(x, z, 2) * 4)]);
  }
  for (let i = 0; i < L.trees; i++) {
    const x = r.int(10, nx - 10), z = r.int(4, d - 5), h = Math.round(30 + (hgt[x] - 30) * 0.95);
    m.box(x, h, z, x, h + 6, z, trunk);
    m.ellipsoid(x + 0.5, h + 9, z + 0.5, 4, 3.6, 3.6, leaf);
    m.ellipsoid(x - 0.5, h + 10.5, z - 0.5, 2.4, 2, 2.4, leafHi);
  }
  return renderModel(m, { scale: s, yaw: 0, pitch: 22, jitter: 0.12 });
}

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
    const sky = ['#4a98e0', '#68b4ee', '#8ccaf2', '#b4dcf6', '#e0f0fa'].map((h) => pack(h));
    const horizon = H * 0.62;
    for (let y = 0; y < H; y++) {
      const k = y / horizon;
      for (let x = 0; x < W; x++) {
        const idx = clamp(Math.floor(k * 4.6 + (bayer(x, y) - 0.5) * 0.9), 0, 4);
        buf.data[y * W + x] = sky[idx];
      }
    }
    const g = this.layer.ctx;
    g.drawImage(buf.toCanvas(), 0, 0);
    // voxel cumulus
    for (let i = 0; i < 6; i++) {
      const cw = 22 + Math.floor(hash2(i, 3, 7) * 30);
      const c = cloudSprites(900 + i, cw, Math.round(cw * 0.38), Math.round(cw * 0.34), 2, ['day']);
      const cx = hash2(i, 1, 7) * W, cy = 24 + hash2(i, 2, 7) * H * 0.3;
      g.drawImage(c.day, Math.round(cx - c.ox), Math.round(cy));
    }
    // three rolling voxel hill layers (far -> near), with trees and flowers on the nearer ones
    const layers = [
      { base: horizon, amp: H * 0.12, cols: ['#3f9a48', '#4caf50', '#5cc062'], d: 16, seed: 3, trees: 0 },
      { base: horizon + H * 0.1, amp: H * 0.1, cols: ['#2f8a40', '#3f9e48', '#55b85a'], d: 18, seed: 4, trees: 5 },
      { base: horizon + H * 0.2, amp: H * 0.08, cols: ['#247a36', '#2f8f40', '#45a850'], d: 20, seed: 5, trees: 7 },
    ];
    for (const L of layers) {
      const spr = hillStrip(W, L);
      const y0 = Math.round(L.base + L.amp * 0.6 - spr.oy) + 40;
      g.drawImage(spr.canvas, Math.round(W / 2 - spr.ox), y0);
      g.fillStyle = L.cols[0];
      g.fillRect(0, y0 + spr.h - 3, W, H);
    }
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
