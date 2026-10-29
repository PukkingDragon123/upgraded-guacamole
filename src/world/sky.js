// Shared sky for the surface view: a tall dithered gradient per time of day (world y from the camera's top to the
// horizon), sun and moon on arcs that follow the clock, twinkling stars, and drifting voxel cumulus clouds
// (rendered once from voxel models, re-coloured per time of day / weather by luminance) with gentle vertical
// parallax while the camera scrolls. Biomes own one SkyDome each and add their own horizon features.

import { VoxelModel } from '../gfx/voxel.js';
import { makeCanvas, ctxOf } from '../core/canvas.js';
import { RNG } from '../core/rng.js';
import { clamp, clamp01, lerp, smoothstep, hash2, bayer, TAU } from '../core/math.js';
import { hexToRgb, packRGB } from '../core/color.js';
import { paint, dpack, lerpStops, Blend, twinkle, glowSprite } from './scenery.js';
import { renderModel } from './voxkit.js';

export const CLOUD_PALS = {
  day: ['#9aa8cc', '#bccbe8', '#dfe9f8', '#f6fbff', '#ffffff'],
  dusk: ['#4c3462', '#8a5278', '#d07e86', '#ffbe96', '#ffe6c4'],
  night: ['#0c1228', '#141c36', '#1e2a48', '#2a3a5e', '#43567c'],
  rain: ['#2c323e', '#3a424f', '#4a5362', '#5e6876', '#78828f'],
  smog: ['#3a3a2c', '#56563e', '#767452', '#9a966a', '#bab486'],
};

// Re-colour a rendered sprite through a 5-step ramp by luminance (keeps the voxel shading and the alpha).
export function recolor(src, ramp) {
  const w = src.width, h = src.height;
  const s = ctxOf(src).getImageData(0, 0, w, h).data;
  const R = ramp.map(hexToRgb);
  const n = R.length - 1;
  return paint(w, h, (x, y) => {
    const i = (y * w + x) * 4, a = s[i + 3];
    if (!a) return 0;
    const l = (s[i] * 0.3 + s[i + 1] * 0.55 + s[i + 2] * 0.15) / 255;
    const q = clamp01((l - 0.35) / 0.65) * n;
    const k = Math.min(n, Math.floor(q + bayer(x, y) * 0.9));
    const c = R[k];
    return packRGB(c[0], c[1], c[2], a);
  });
}

// Puffy voxel cumulus: overlapping ellipsoid puffs, flat-ish base.
export function cloudModel(seed, w, h, d) {
  const r = new RNG(seed);
  const m = new VoxelModel(w, h, d);
  const c = m.color('#ffffff', { jitter: 0.06, smooth: 0.55 });
  const n = r.int(4, 7);
  for (let i = 0; i < n; i++) {
    const u = n === 1 ? 0.5 : i / (n - 1);
    const big = 1 - Math.abs(u - r.float(0.35, 0.6)) * 1.3;
    const ry = h * r.float(0.32, 0.48) * (0.55 + big * 0.6);
    const rx = ry * r.float(1.1, 1.6);
    const rz = Math.min(d / 2 - 0.6, ry * r.float(0.9, 1.2));
    m.ellipsoid(lerp(w * 0.14, w * 0.86, u) + r.float(-2, 2), 1 + ry * 0.62, d / 2 + r.float(-1.5, 1.5), rx, ry, rz, c);
  }
  // a few small puffs on top
  for (let i = 0; i < 3; i++) m.ellipsoid(r.float(w * 0.3, w * 0.7), h * r.float(0.5, 0.7), d / 2, r.float(2, 4), r.float(2, 3.5), r.float(2, 3.5), c);
  m.sub(() => m.box(0, 0, 0, w - 1, 0, d - 1, c));
  return m;
}

export function cloudSprites(seed, w, h, d, scale = 2, pals = ['day', 'dusk', 'night', 'rain']) {
  const m = cloudModel(seed, w, h, d);
  const r = renderModel(m, { scale, yaw: 18, pitch: 10, outline: false, edges: 0.35, sideEdges: 0.2, ao: 0.8, jitter: 0.08, light: { top: 4.9, lit: 3.9, dark: 2.6, bottom: 1.6 } });
  const out = { w: r.w, h: r.h, ox: Math.round(r.w / 2), oy: r.oy };
  for (const p of pals) out[p] = recolor(r.canvas, CLOUD_PALS[p] || CLOUD_PALS.day);
  return out;
}

// Sun / moon positions on arcs over the surface. Returns {sun: {x, y, up}, moon: {x, y, up}} in world space.
export function skyBodies(hour, W, top, base) {
  const span = base - top;
  const su = (hour - 6) / 13;
  const se = Math.sin(clamp(su, 0, 1) * Math.PI);
  const mu = (((hour - 19) % 24) + 24) % 24 / 12;
  const me = Math.sin(clamp(mu, 0, 1) * Math.PI);
  return {
    sun: { x: lerp(W * 0.1, W * 0.9, clamp(su, -0.1, 1.1)), y: base - 10 - se * (span - 110), up: su > -0.05 && su < 1.05 },
    moon: { x: lerp(W * 0.12, W * 0.88, clamp(mu, -0.1, 1.1)), y: base - 10 - me * (span - 130), up: mu > -0.05 && mu < 1.05 },
  };
}

function disc(g, cx, cy, r, fn) {
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
    const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
    if (d <= r) { const c = fn(x - Math.floor(cx - r), y - Math.floor(cy - r), d / r); if (c) { g.fillStyle = c; g.fillRect(x, y, 1, 1); } }
  }
}

function sunSprite(kind) {
  const R = kind === 'dusk' ? 13 : 9;
  const s = R * 2 + 3;
  const c = makeCanvas(s, s);
  const g = ctxOf(c);
  const cx = s / 2, cy = s / 2;
  if (kind === 'dusk') {
    disc(g, cx, cy, R, (x, y) => {
      const k = y / (R * 2);
      if (y > R + 2 && [4, 7, 9, 11].includes(Math.round(y - R))) return null;
      return k < 0.3 ? '#fff0b0' : k < 0.55 ? '#ffd27a' : k < 0.8 ? '#ffac5a' : '#ff8a4a';
    });
  } else disc(g, cx, cy, R, (x, y, d) => (d > 0.86 ? '#fff1b8' : d > 0.6 ? '#fffbe0' : '#ffffff'));
  return c;
}

function moonSprite() {
  const R = 8, s = R * 2 + 3;
  const c = makeCanvas(s, s);
  const g = ctxOf(c);
  const cx = s / 2, cy = s / 2;
  disc(g, cx, cy, R, (x, y, d) => {
    const dx = x + Math.floor(cx - R) + 0.5 - cx;
    if (dx > 4.5 && d > 0.55) return '#b4c0e6';
    return d > 0.88 ? '#d6deff' : '#f2f5ff';
  });
  for (const [ox, oy, r] of [[-3, -2, 1.6], [2, 2, 2], [-1, 4, 1.1], [3, -4, 1]]) disc(g, cx + ox, cy + oy, r, () => '#c8d0ee');
  return c;
}

export class SkyDome {
  // o: {W, top, base, stops: {day, dusk, night}, seed, clouds: {n, pals, size: [w0, w1], y: [y0, y1]} | null,
  //     stars, glow: {day, dusk, night: [rgb, R, a]}, sun: bool, moon: bool, nightOnly}
  constructor(o) {
    this.o = o;
    const { W, top, base } = o;
    this.W = W; this.top = top; this.base = base;
    this.h = base + 16 - top;
    this.blend = new Blend();
    const mk = (kind) => {
      const rows = new Float32Array(this.h * 3);
      for (let yy = 0; yy < this.h; yy++) {
        const y = yy + top;
        let [r, g, b] = lerpStops(o.stops[kind], clamp01((y - top) / (base - top)));
        if (o.haze && y > base - 40) { const k = smoothstep(base - 40, base + 2, y) * o.haze; r += (255 - r) * k; g += (255 - g) * k; b += (255 - b) * k; }
        rows[yy * 3] = r; rows[yy * 3 + 1] = g; rows[yy * 3 + 2] = b;
      }
      return paint(W, this.h, (x, yy) => {
        let r = rows[yy * 3], g = rows[yy * 3 + 1], b = rows[yy * 3 + 2];
        if (kind === 'night' && yy + top < base - 8) {
          const hs = hash2(x, yy + top, 77);
          if (hs < 0.0035) { const k = 0.3 + (hs / 0.0035) * 0.6; r = lerp(r, 230, k); g = lerp(g, 236, k); b = lerp(b, 255, k); }
        }
        return dpack(r, g, b, x, yy, 5);
      });
    };
    this.kinds = o.nightOnly ? ['night'] : ['day', 'dusk', 'night'];
    this.canvas = {};
    for (const k of this.kinds) this.canvas[k] = mk(k);
    this.sunSpr = { day: sunSprite('day'), dusk: sunSprite('dusk') };
    this.moonSpr = moonSprite();
    const r = new RNG(o.seed ?? 3);
    this.stars = [];
    for (let i = 0; i < (o.stars ?? 40); i++) this.stars.push({ x: r.int(4, W - 4), y: r.int(top + 4, base - 14), f: r.float(1, 3), ph: r.float(0, TAU), c: r.pick(['#ffffff', '#fff2c8', '#c8dcff']) });
    this.clouds = [];
    const co = o.clouds;
    if (co) {
      for (let i = 0; i < co.n; i++) {
        const k = i / Math.max(1, co.n - 1);
        const cw = Math.round(r.float(co.size[0], co.size[1]));
        const ch = Math.round(cw * r.float(0.32, 0.42));
        const spr = cloudSprites((o.seed ?? 3) * 100 + i, cw, ch, Math.max(8, Math.round(ch * 0.9)), co.scale ?? 2, co.pals || ['day', 'dusk', 'night', 'rain']);
        const y = Math.round(lerp(co.y[0], co.y[1], Math.pow(r.next(), 0.8)));
        this.clouds.push({ x: r.float(-60, W), y, v: r.float(1.2, 3.6) * (co.speed ?? 1), p: r.float(0.06, 0.22), spr, k });
      }
      this.clouds.sort((a, b) => a.spr.w - b.spr.w);
    }
    this.t = 0;
  }

  update(dt, wind = 1) {
    this.t += dt;
    for (const c of this.clouds) {
      c.x += c.v * dt * wind;
      if (c.x - c.spr.ox > this.W + 10) c.x = -c.spr.w + c.spr.ox - 10;
    }
  }

  // Visible sky span (world y) for a camera view, or null.
  span(view) {
    const y0 = Math.max(this.top, Math.floor(view ? view.y0 : 0) - 1);
    const y1 = Math.min(this.base + 16, Math.ceil(view ? view.y1 : this.base + 16));
    return y1 > y0 ? [y0, y1] : null;
  }

  drawGradient(ctx, tod, view) {
    const sp = this.span(view);
    if (!sp) return null;
    const c = this.kinds.length === 1 ? this.canvas.night : this.blend.get([[this.canvas.day, tod.day], [this.canvas.dusk, tod.dusk], [this.canvas.night, tod.night]]);
    const [y0, y1] = sp;
    ctx.drawImage(c, 0, y0 - this.top, this.W, y1 - y0, 0, y0, this.W, y1 - y0);
    return sp;
  }

  // Sun, moon, glow and stars. scroll = camera scrollY, ref = surface-view scroll (parallax anchor).
  drawBodies(ctx, env, tod, clear, scroll, ref) {
    const hour = env.hour ?? 12;
    const B = skyBodies(hour, this.W, this.top, this.base);
    const pv = 0.28 * (scroll - ref);
    const t = this.t;
    if (tod.night > 0.12) {
      const ka = tod.night * clear;
      for (const s of this.stars) twinkle(ctx, s.x, s.y, (0.4 + 0.6 * Math.sin(t * s.f + s.ph)) * ka, s.c);
    }
    if (this.o.moon !== false && B.moon.up && tod.night > 0.05) {
      const x = Math.round(B.moon.x), y = Math.round(B.moon.y + pv);
      const g = glowSprite(46, '#96b4ff', { steps: 5, pow: 2 });
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.32 * tod.night * clear;
      ctx.drawImage(g, x - 46, y - 46);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = clamp01(tod.night * 1.4) * (0.4 + 0.6 * clear);
      ctx.drawImage(this.moonSpr, x - (this.moonSpr.width >> 1), y - (this.moonSpr.height >> 1));
      ctx.globalAlpha = 1;
    }
    if (this.o.sun !== false && B.sun.up && tod.night < 0.9) {
      const x = Math.round(B.sun.x), y = Math.round(B.sun.y + pv);
      const dusk = tod.dusk > 0.45;
      const gc = dusk ? '#ffb070' : '#fff8d8';
      const g1 = glowSprite(dusk ? 120 : 80, gc, { steps: 6, pow: 2.2 });
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = (dusk ? 0.6 : 0.5) * (1 - tod.night) * clear;
      ctx.drawImage(g1, x - (g1.width >> 1), y - (g1.height >> 1));
      const g2 = glowSprite(22, '#ffffff', { steps: 4, pow: 1.6 });
      ctx.globalAlpha = 0.5 * (1 - tod.night) * clear;
      ctx.drawImage(g2, x - 22, y - 22);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = (1 - tod.night) * (0.35 + 0.65 * clear);
      const s = dusk ? this.sunSpr.dusk : this.sunSpr.day;
      ctx.drawImage(s, x - (s.width >> 1), y - (s.height >> 1));
      ctx.globalAlpha = 1;
    }
    return B;
  }

  // Voxel clouds, cross-faded between palettes. rain 0..1 pushes toward the rain palette.
  drawClouds(ctx, tod, scroll, ref, rain = 0, alpha = 1, view = null) {
    const keys = this.kinds.length === 1 ? [['night', 1]] : [['day', tod.day], ['dusk', tod.dusk], ['night', tod.night]];
    for (const c of this.clouds) {
      const s = c.spr;
      const x = Math.round(c.x - s.ox), y = Math.round(c.y + c.p * (scroll - ref) - s.oy);
      if (view && (y > view.y1 || y + s.h < view.y0)) continue;
      if (y > this.base + 4) continue;
      let acc = 0;
      for (const [k, wgt] of keys) {
        if (wgt <= 0.01 || !s[k]) continue;
        acc += wgt;
        ctx.globalAlpha = alpha * (wgt / acc);
        ctx.drawImage(s[k], x, y);
      }
      if (rain > 0.02 && s.rain) { ctx.globalAlpha = alpha * rain * (1 - tod.night * 0.5); ctx.drawImage(s.rain, x, y); }
    }
    ctx.globalAlpha = 1;
  }
}
