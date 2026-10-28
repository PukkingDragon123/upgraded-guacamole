// Shared scenery toolkit for the ocean biomes: per-pixel painters, dithered gradient strips,
// time-of-day blending, fog-tinted parallax layers, water wobble, god rays, caustics, wave surfaces,
// swaying strands (kelp, seaweed, anemone tentacles), drifting motes and bubbles, pixel glows,
// silhouette masks and a voxel heightfield ground. Everything heavy is built once; per-frame helpers
// only blit cached canvases or issue small fillRects at integer positions.

import { makeCanvas, ctxOf, makeLayer, resizeLayer } from '../core/canvas.js';
import { RNG } from '../core/rng.js';
import { clamp, clamp01, lerp, smoothstep, bayer, hash2, TAU } from '../core/math.js';
import { hexToRgb, packRGB, mix, shade } from '../core/color.js';
import { VoxelModel, renderVoxels } from '../gfx/voxel.js';

export const quality = (env) => (env && env.quality != null ? env.quality : 1);
export const rnd = (seed) => new RNG(seed);

// ------------------------------------------------------------------ pixel painting

// Per-pixel painter: fn(x, y) -> packed ABGR (0 = transparent).
export function paint(w, h, fn) {
  w = Math.max(1, Math.ceil(w)); h = Math.max(1, Math.ceil(h));
  const c = makeCanvas(w, h);
  const g = ctxOf(c);
  const img = g.createImageData(w, h);
  const d = new Uint32Array(img.data.buffer);
  for (let y = 0, i = 0; y < h; y++) for (let x = 0; x < w; x++, i++) {
    const v = fn(x, y);
    if (v) d[i] = v;
  }
  g.putImageData(img, 0, 0);
  return c;
}

// Raw buffer painter: fn(data: Uint32Array, w, h) fills pixels directly.
export function paintBuf(w, h, fn) {
  w = Math.max(1, Math.ceil(w)); h = Math.max(1, Math.ceil(h));
  const c = makeCanvas(w, h);
  const g = ctxOf(c);
  const img = g.createImageData(w, h);
  const d = new Uint32Array(img.data.buffer);
  fn(d, w, h);
  g.putImageData(img, 0, 0);
  return c;
}

export const rgbOf = (hex) => hexToRgb(hex);

// Ordered-dither posterise a continuous colour to `step`-sized channel levels (pixel-art gradients).
export function dpack(r, g, b, x, y, step = 8, a = 255) {
  const k = bayer(x, y);
  const q = (v) => clamp(Math.floor(v / step + k) * step, 0, 255);
  return packRGB(q(r), q(g), q(b), a);
}
export const P = (hex, a = 255) => {
  const [r, g, b] = hexToRgb(hex);
  return packRGB(r, g, b, a);
};

export function lerpStops(stops, t) {
  if (t <= stops[0][0]) return hexToRgb(stops[0][1]);
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) {
      const [t0, c0] = stops[i - 1], [t1, c1] = stops[i];
      const k = (t - t0) / (t1 - t0 || 1);
      const a = hexToRgb(c0), b = hexToRgb(c1);
      return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
    }
  }
  return hexToRgb(stops[stops.length - 1][1]);
}

export function stopsHex(stops, t) {
  const c = lerpStops(stops, t);
  return '#' + c.map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');
}

// Quantised palette of `levels` colours along the stops.
export function stopPalette(stops, levels) {
  const out = [];
  for (let i = 0; i < levels; i++) {
    const c = lerpStops(stops, i / Math.max(1, levels - 1));
    out.push(packRGB(c[0], c[1], c[2]));
  }
  return out;
}

// Pick a palette entry for v in 0..1 with ordered dithering between neighbouring levels.
export function ditherPick(pal, v, x, y, soft = 0.7) {
  const n = pal.length;
  const q = clamp01(v) * (n - 1);
  const i = Math.floor(q);
  const f = q - i;
  const e = soft >= 1 ? f : smoothstep(0.5 - soft / 2, 0.5 + soft / 2, f);
  return pal[Math.min(n - 1, bayer(x, y) < e ? i + 1 : i)];
}

// Vertical gradient strip (w px wide, tile it as a pattern) with dithered colour bands.
export function gradientStrip(h, stops, { levels = 18, w = 8, soft = 0.7, y0 = 0, y1 = h } = {}) {
  const pal = stopPalette(stops, levels);
  return paint(w, h, (x, y) => ditherPick(pal, (y - y0) / Math.max(1, y1 - y0), x, y, soft));
}

// ------------------------------------------------------------------ blending & fog

// Crossfades same-size canvases by weight into one cached composite (recomposited only on change).
export class Blend {
  constructor() { this.layer = null; this.key = ''; this.version = 0; }
  get(items) {
    const c0 = items[0][0];
    if (!this.layer || this.layer.w !== c0.width || this.layer.h !== c0.height) { this.layer = makeLayer(c0.width, c0.height); this.key = ''; }
    let key = '';
    for (const it of items) key += Math.round(it[1] * 96) + ',';
    if (key === this.key) return this.layer.canvas;
    this.key = key;
    this.version++;
    const g = this.layer.ctx;
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    g.clearRect(0, 0, this.layer.w, this.layer.h);
    let acc = 0, first = true;
    for (const [c, w] of items) {
      if (w <= 0.005) continue;
      acc += w;
      g.globalAlpha = first ? 1 : clamp01(w / acc);
      g.drawImage(c, 0, 0);
      first = false;
    }
    if (first) g.drawImage(c0, 0, 0);
    g.globalAlpha = 1;
    return this.layer.canvas;
  }
}

// A cached layer that is re-tinted toward a fill (colour or a screen-space gradient canvas) when the key changes.
export class FogLayer {
  constructor(base, x = 0, y = 0) {
    this.base = base; this.x = x; this.y = y;
    this.out = makeLayer(base.width, base.height);
    this.key = null;
  }
  // fill: css colour string, or a canvas strip used as a repeating vertical gradient in screen space.
  tint(fill, a, key) {
    if (key === this.key) return this.out.canvas;
    this.key = key;
    const g = this.out.ctx;
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    g.clearRect(0, 0, this.out.w, this.out.h);
    g.drawImage(this.base, 0, 0);
    if (a > 0.004) {
      g.globalCompositeOperation = 'source-atop';
      g.globalAlpha = clamp01(a);
      g.save();
      g.translate(-this.x, -this.y);
      g.fillStyle = typeof fill === 'string' ? fill : g.createPattern(fill, 'repeat');
      g.fillRect(this.x, this.y, this.out.w, this.out.h);
      g.restore();
    }
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    return this.out.canvas;
  }
}

// Fill a region with a repeating strip/tile (screen-space aligned).
export function fillWith(ctx, canvas, x, y, w, h) {
  if (w <= 0 || h <= 0) return;
  const pat = ctx.createPattern(canvas, 'repeat');
  ctx.fillStyle = pat;
  ctx.fillRect(x, y, w, h);
}

// Draw a canvas in horizontal bands with a sine x-offset (water distortion).
export function drawWobble(ctx, src, dx, dy, t, amp = 1, band = 4, speed = 1.3, freq = 0.09) {
  dx = Math.round(dx); dy = Math.round(dy);
  if (amp < 0.5) { ctx.drawImage(src, dx, dy); return; }
  const h = src.height, w = src.width;
  for (let y = 0; y < h; y += band) {
    const bh = Math.min(band, h - y);
    const o = Math.round(Math.sin(t * speed + (dy + y) * freq) * amp + Math.sin(t * speed * 0.53 + (dy + y) * freq * 2.3) * amp * 0.35);
    ctx.drawImage(src, 0, y, w, bh, dx + o, dy + y, w, bh);
  }
}

// ------------------------------------------------------------------ light

// Fan of soft dithered light shafts from a virtual sun above the screen (draw with 'lighter').
export function makeRays(w, h, o = {}) {
  const { seed = 1, count = 9, sunX = w * 0.7, sunY = -h * 0.9, minW = 5, maxW = 24, len = 0.85, color = '#ffffff', alpha = 0.55, levels = 6, x0 = -w * 0.08, x1 = w * 1.08, grow = 1.3 } = o;
  const r = new RNG(seed);
  const acc = new Float32Array(w * h);
  for (let i = 0; i < count; i++) {
    const bx = lerp(x0, x1, (i + r.float(0.1, 0.9)) / count);
    const bw = r.float(minW, maxW);
    const inten = r.float(0.3, 1);
    const dl = len * r.float(0.55, 1.15);
    const dx = (bx - sunX) / (0 - sunY);
    const gaps = r.float(0, 1) < 0.4;
    for (let y = 0; y < h; y++) {
      const t = y / h;
      let fade = Math.pow(clamp01(1 - t / dl), 1.5);
      if (fade <= 0) break;
      if (gaps) fade *= 0.75 + 0.25 * Math.sin(y * 0.05 + i);
      const cx = bx + dx * y;
      const hw = (bw * (1 + t * grow)) / 2;
      const xa = Math.max(0, Math.floor(cx - hw)), xb = Math.min(w - 1, Math.ceil(cx + hw));
      for (let x = xa; x <= xb; x++) {
        const u = 1 - Math.abs(x + 0.5 - cx) / hw;
        if (u <= 0) continue;
        acc[y * w + x] += u * u * (3 - 2 * u) * fade * inten;
      }
    }
  }
  const [cr, cg, cb] = hexToRgb(color);
  return paint(w, h, (x, y) => {
    const v = Math.min(1, acc[y * w + x]) * alpha;
    if (v <= 0.004) return 0;
    const q = Math.floor(v * levels + bayer(x, y)) / levels;
    return q <= 0 ? 0 : packRGB(cr, cg, cb, Math.round(Math.min(1, q) * 255));
  });
}

// Dithered radial glow sprite (draw with 'lighter'); cached.
const glowCache = new Map();
export function glowSprite(r, color, { steps = 5, pow = 1.8, alpha = 1 } = {}) {
  r = Math.max(1, Math.round(r));
  const key = r + color + steps + pow + alpha;
  let c = glowCache.get(key);
  if (c) return c;
  const [cr, cg, cb] = hexToRgb(color);
  const s = r * 2 + 1;
  c = paint(s, s, (x, y) => {
    const d = Math.hypot(x - r, y - r) / (r + 0.5);
    if (d >= 1) return 0;
    const v = Math.pow(1 - d, pow) * alpha;
    const q = Math.floor(v * steps + bayer(x, y)) / steps;
    return q <= 0 ? 0 : packRGB(cr, cg, cb, Math.round(Math.min(1, q) * 255));
  });
  glowCache.set(key, c);
  return c;
}

export function drawGlow(ctx, x, y, r, color, a = 1, opts) {
  if (a <= 0.01) return;
  const g = glowSprite(r, color, opts);
  const pa = ctx.globalAlpha, po = ctx.globalCompositeOperation;
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = clamp01(a);
  ctx.drawImage(g, Math.round(x) - (g.width >> 1), Math.round(y) - (g.height >> 1));
  ctx.globalAlpha = pa;
  ctx.globalCompositeOperation = po;
}

// Tiny 4-point twinkle (secret hints, sun glints, stars).
export function twinkle(ctx, x, y, k, color = '#ffffff') {
  if (k <= 0.05) return;
  x = Math.round(x); y = Math.round(y);
  const pa = ctx.globalAlpha;
  ctx.fillStyle = color;
  ctx.globalAlpha = pa * Math.min(1, k * 1.5);
  ctx.fillRect(x, y, 1, 1);
  if (k > 0.35) { ctx.fillRect(x - 1, y, 3, 1); ctx.fillRect(x, y - 1, 1, 3); }
  if (k > 0.7) {
    ctx.globalAlpha = pa * 0.55;
    ctx.fillRect(x - 3, y, 2, 1); ctx.fillRect(x + 2, y, 2, 1);
    ctx.fillRect(x, y - 3, 1, 2); ctx.fillRect(x, y + 2, 1, 2);
  }
  ctx.globalAlpha = pa;
}

// Animated caustics: tileable Voronoi-edge frames, masked onto a layer and added on top.
export class Caustics {
  constructor(o = {}) {
    const { tw = 160, th = 64, frames = 16, cx = 7, cy = 4, seed = 5, color = '#ffffff', core = 0.9, rim = 0.42, thick = 1.15 } = o;
    this.tw = tw; this.th = th;
    this.frames = [];
    const r = new RNG(seed);
    const n = cx * cy;
    const bx = [], by = [], rad = [], ph = [], sp = [];
    for (let i = 0; i < n; i++) { bx.push(r.float(0.2, 0.8)); by.push(r.float(0.2, 0.8)); rad.push(r.float(0.12, 0.3)); ph.push(r.float(0, TAU)); sp.push(r.pick([1, -1, 1, -1, 2])); }
    const cw = tw / cx, ch = th / cy;
    const [R, G, B] = hexToRgb(color);
    const cCore = packRGB(R, G, B, Math.round(255 * core)), cRim = packRGB(R, G, B, Math.round(255 * rim));
    const px = new Float32Array(n), py = new Float32Array(n);
    for (let f = 0; f < frames; f++) {
      const a = (f / frames) * TAU;
      for (let i = 0; i < n; i++) {
        px[i] = ((i % cx) + bx[i] + Math.cos(a * sp[i] + ph[i]) * rad[i]) * cw;
        py[i] = (((i / cx) | 0) + by[i] + Math.sin(a * sp[i] + ph[i]) * rad[i]) * ch;
      }
      this.frames.push(paint(tw, th, (x, y) => {
        const gx = Math.floor(x / cw), gy = Math.floor(y / ch);
        let d1 = 1e9, d2 = 1e9;
        for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
          let ix = gx + i, iy = gy + j, ox = 0, oy = 0;
          if (ix < 0) { ix += cx; ox = -tw; } else if (ix >= cx) { ix -= cx; ox = tw; }
          if (iy < 0) { iy += cy; oy = -th; } else if (iy >= cy) { iy -= cy; oy = th; }
          const k = iy * cx + ix;
          const dx = px[k] + ox - x - 0.5, dy = py[k] + oy - y - 0.5;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
        }
        const e = d2 - d1;
        if (e < thick) return cCore;
        if (e < thick * 2.5 && bayer(x, y) < 0.5) return cRim;
        return 0;
      }));
    }
    this.layer = null;
    this.pats = null;
  }

  // mask: canvas whose alpha limits where caustics land (drawn at mx, my).
  draw(ctx, mask, mx, my, t, alpha, { fps = 9, drift = 5, offset = 0 } = {}) {
    if (alpha <= 0.01) return;
    if (!this.layers) this.layers = new Map();
    let L = this.layers.get(mask);
    if (!L) { L = makeLayer(mask.width, mask.height); L.pats = this.frames.map((c) => L.ctx.createPattern(c, 'repeat')); this.layers.set(mask, L); }
    const g = L.ctx;
    const fi = (Math.floor(t * fps) + offset) % this.frames.length;
    const sx = Math.round((t * drift) % this.tw);
    const ck = fi * 1000 + sx;
    if (L.ck !== ck) {
    L.ck = ck;
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    g.clearRect(0, 0, L.w, L.h);
    g.save();
    g.translate(sx, 0);
    g.fillStyle = L.pats[fi];
    g.fillRect(-sx, 0, L.w, L.h);
    g.restore();
    g.globalCompositeOperation = 'destination-in';
    g.drawImage(mask, 0, 0);
    g.globalCompositeOperation = 'source-over';
    }
    const po = ctx.globalCompositeOperation, pa = ctx.globalAlpha;
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = clamp01(alpha);
    ctx.drawImage(L.canvas, Math.round(mx), Math.round(my));
    ctx.globalCompositeOperation = po;
    ctx.globalAlpha = pa;
  }
}

// Luminance-weighted alpha mask of a canvas (bright, lit surfaces receive more caustic light).
export function lumaMask(src, { gamma = 1.6, gain = 1.4, fadeTop = 0, fadeBottom = 0 } = {}) {
  const w = src.width, h = src.height;
  const s = ctxOf(src).getImageData(0, 0, w, h).data;
  return paintBuf(w, h, (d) => {
    for (let y = 0, i = 0; y < h; y++) {
      let k = 1;
      if (fadeTop > 0) k *= smoothstep(0, fadeTop, y);
      if (fadeBottom > 0) k *= 1 - smoothstep(h - fadeBottom, h, y);
      for (let x = 0; x < w; x++, i++) {
        const a = s[i * 4 + 3];
        if (!a) continue;
        const l = (s[i * 4] * 0.3 + s[i * 4 + 1] * 0.55 + s[i * 4 + 2] * 0.15) / 255;
        const v = clamp01(Math.pow(l, gamma) * gain) * (a / 255) * k;
        if (v > 0.02) d[i] = packRGB(255, 255, 255, Math.round(v * 255));
      }
    }
  });
}

// ------------------------------------------------------------------ water surface

// Integer wave heights per column: base + layered sines (amp scales everything, chop adds small waves).
export function waveLine(out, W, base, t, amp = 2, chop = 0, speed = 1) {
  for (let x = 0; x <= W; x++) {
    const v = Math.sin(x * 0.031 + t * 1.15 * speed) * 0.55 + Math.sin(x * 0.077 - t * 1.7 * speed + 1.7) * 0.3 + Math.sin(x * 0.013 + t * 0.6 * speed + 4.1) * 0.35
      + chop * (Math.sin(x * 0.19 + t * 3.3 * speed) * 0.25 + Math.sin(x * 0.41 - t * 4.7 * speed + 0.7) * 0.12);
    out[x] = Math.round(base + v * amp);
  }
  return out;
}

// Iterate runs of equal height: fn(x0, len, y).
export function waveRuns(ys, W, fn) {
  let x0 = 0;
  for (let x = 1; x <= W; x++) {
    if (x === W || ys[x] !== ys[x0]) { fn(x0, x - x0, ys[x0]); x0 = x; }
  }
}

// ------------------------------------------------------------------ strands (kelp, seaweed, tentacles)

export class Strands {
  constructor() { this.list = []; this.pts = new Float32Array(256); }

  add(o) {
    const s = {
      x: 0, y: 0, n: 12, seg: 3, w: 2, lean: 0, amp: 0.22, speed: 1.2, phase: 0, wave: 0.45, sec: 0.37, curl: 0,
      cols: ['#1d5a3c', '#2b7c48', '#45a65a', '#7ed37a'], out: '#0c2a26', alpha: 1,
      leaf: null, leafEvery: 3, leafLen: 4, leafCol: null, bulb: null, bulbEvery: 4, tip: null, tipR: 1, taper: 0, hl: true, glow: null,
      ...o,
    };
    this.list.push(s);
    return s;
  }

  // Computes centreline points into this.pts; returns count.
  shape(s, t, current) {
    let x = s.x, y = s.y;
    const p = this.pts;
    p[0] = x; p[1] = y;
    for (let i = 1; i <= s.n; i++) {
      const k = i / s.n;
      const ang = s.lean + s.curl * k * k + Math.sin(t * s.speed + s.phase - i * s.wave) * s.amp * k + Math.sin(t * s.speed * s.sec + s.phase * 1.7) * s.amp * 0.4 * k + current * k * k;
      x += Math.sin(ang) * s.seg;
      y += s.down ? Math.cos(ang) * s.seg : -Math.cos(ang) * s.seg;
      p[i * 2] = x; p[i * 2 + 1] = y;
    }
    return s.n;
  }

  draw(ctx, t, current = 0, filter = null) {
    const p = this.pts;
    const pa = ctx.globalAlpha;
    for (const s of this.list) {
      if (filter && !filter(s)) continue;
      const n = this.shape(s, t, current);
      ctx.globalAlpha = pa * s.alpha;
      const wOf = (i) => Math.max(1, Math.round(s.w * (1 - s.taper * (i / n))));
      // outline
      if (s.out) {
        ctx.fillStyle = s.out;
        for (let i = 1; i <= n; i++) {
          const w = wOf(i);
          const x = Math.round(p[i * 2] - w / 2), ya = Math.round(p[i * 2 + 1]), yb = Math.round(p[i * 2 - 1]);
          const y = Math.min(ya, yb);
          ctx.fillRect(x - 1, y - 1, w + 2, Math.abs(yb - ya) + 2);
        }
      }
      // body in ramp groups
      const nc = s.cols.length;
      for (let c = 0; c < nc; c++) {
        ctx.fillStyle = s.cols[c];
        const i0 = Math.max(1, Math.floor((c / nc) * n) + 1), i1 = Math.floor(((c + 1) / nc) * n);
        for (let i = i0; i <= i1; i++) {
          const w = wOf(i);
          const x = Math.round(p[i * 2] - w / 2), ya = Math.round(p[i * 2 + 1]), yb = Math.round(p[i * 2 - 1]);
          ctx.fillRect(x, Math.min(ya, yb), w, Math.abs(yb - ya) + 1);
        }
        // highlight edge in the next colour up
        if (s.hl && c + 1 < nc) {
          ctx.fillStyle = s.cols[c + 1];
          for (let i = i0; i <= i1; i++) {
            const w = wOf(i);
            if (w < 3) continue;
            const x = Math.round(p[i * 2] - w / 2), y = Math.round(p[i * 2 + 1]), y0 = Math.round(p[i * 2 - 1]);
            ctx.fillRect(x, y, 1, Math.max(1, y0 - y));
          }
        }
      }
      // pre-rendered blade sprites (kelp)
      if (s.blades) {
        let side = 1;
        const bs = s.blades, nb = bs.length;
        for (let i = 2; i < n; i += s.leafEvery) {
          side = -side;
          const ang = Math.atan2(p[i * 2] - p[i * 2 - 2], p[i * 2 - 1] - p[i * 2 + 1]);
          const la = ang + side * 0.95 + Math.sin(t * s.speed * 1.3 + i * 0.7 + s.phase) * 0.22 + current * 0.6;
          const bi = ((Math.round(((la + Math.PI) / TAU) * nb) % nb) + nb) % nb;
          const b = bs[bi];
          ctx.drawImage(b.c, Math.round(p[i * 2]) - b.ox, Math.round(p[i * 2 + 1]) - b.oy);
        }
      }
      // leaves / blades
      if (s.leaf) {
        let side = 1;
        for (let i = 2; i < n; i += s.leafEvery) {
          side = -side;
          const bx = p[i * 2], by = p[i * 2 + 1];
          const ang = Math.atan2(p[i * 2] - p[i * 2 - 2], p[i * 2 - 1] - p[i * 2 + 1]);
          const la = ang + side * (s.leaf === 'kelp' ? 1.05 : 0.8) + Math.sin(t * s.speed * 1.3 + i + s.phase) * 0.25;
          const L = s.leafLen * (s.leaf === 'kelp' ? 1 : 0.8) * (0.7 + 0.3 * Math.sin(i * 1.7 + s.phase));
          const lc = s.leafCol || s.cols;
          for (let j = 1; j <= L; j++) {
            const q = j / L;
            const lx = Math.round(bx + Math.sin(la) * j + Math.sin(la + side * 1.5) * q * q * 1.5);
            const ly = Math.round(by - Math.cos(la) * j);
            ctx.fillStyle = s.out || lc[0];
            ctx.fillRect(lx - 1, ly - 1, 3, s.leaf === 'kelp' ? 4 : 3);
            ctx.fillStyle = lc[Math.min(lc.length - 1, 1 + Math.floor(q * (lc.length - 1)))];
            ctx.fillRect(lx, ly, s.leaf === 'kelp' && q < 0.75 ? 2 : 1, s.leaf === 'kelp' ? 2 : 1);
          }
        }
      }
      // gas bladders / bulbs along the stipe
      if (s.bulb) {
        for (let i = 3; i < n; i += s.bulbEvery) {
          const bx = Math.round(p[i * 2] + (i % 2 ? 2 : -3)), by = Math.round(p[i * 2 + 1]);
          ctx.fillStyle = s.out || '#000';
          ctx.fillRect(bx - 1, by - 1, 4, 4);
          ctx.fillStyle = s.bulb;
          ctx.fillRect(bx, by, 2, 2);
          ctx.fillStyle = s.cols[s.cols.length - 1];
          ctx.fillRect(bx, by, 1, 1);
        }
      }
      // tip bulb (anemone tentacles)
      if (s.tip) {
        const tx = Math.round(p[n * 2]), ty = Math.round(p[n * 2 + 1]);
        const r = s.tipR;
        if (s.out) { ctx.fillStyle = s.out; ctx.fillRect(tx - r - 1, ty - r - 1, r * 2 + 2, r * 2 + 2); }
        ctx.fillStyle = s.tip;
        ctx.fillRect(tx - r, ty - r, r * 2, r * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(tx - r, ty - r, 1, 1);
      }
    }
    ctx.globalAlpha = pa;
  }

  tipOf(s, t, current = 0) {
    const n = this.shape(s, t, current);
    return [this.pts[n * 2], this.pts[n * 2 + 1]];
  }
}

// Leaf/blade sprites at `bins` angles (0 = up), anchored at the blade base. Blades curl back toward
// vertical (floating kelp) by `curl`. cols: dark -> light ramp along the blade.
export function bladeSprites({ len = 12, w = 3, cols, bins = 24, curl = 0.45, outline = 0.6 }) {
  const out = [];
  const pc = cols.map((c) => P(c));
  for (let b = 0; b < bins; b++) {
    const a0 = (b / bins) * TAU - Math.PI;
    const R = Math.ceil(len + w + 3);
    const S = R * 2 + 1;
    const buf = new Uint32Array(S * S);
    let x = R + 0.5, y = R + 0.5;
    for (let j = 0; j <= len; j++) {
      const k = j / len;
      const a = a0 + (0 - a0) * curl * k;
      const ww = Math.max(0.5, w * Math.sin(Math.min(1, k * 1.25 + 0.12) * Math.PI) * (k < 0.9 ? 1 : 0.6));
      const nx = Math.cos(a), ny = Math.sin(a);
      for (let q = -ww; q <= ww; q += 0.5) {
        const px = Math.floor(x + nx * q), py = Math.floor(y + ny * q);
        if (px < 0 || py < 0 || px >= S || py >= S) continue;
        const edge = Math.abs(q) > ww - 0.75;
        const ci = clamp(Math.round(k * (pc.length - 1) + (edge ? -1 : 0) + (q < 0 && !edge ? 0.5 : 0)), 0, pc.length - 1);
        buf[py * S + px] = pc[ci];
      }
      x += Math.sin(a) * 1; y -= Math.cos(a) * 1;
    }
    const c = paintBuf(S, S, (d) => {
      d.set(buf);
      if (outline) {
        for (let py = 0; py < S; py++) for (let px = 0; px < S; px++) {
          const i = py * S + px;
          if (buf[i]) continue;
          const n = (px > 0 && buf[i - 1]) || (px < S - 1 && buf[i + 1]) || (py > 0 && buf[i - S]) || (py < S - 1 && buf[i + S]);
          if (n) d[i] = (n & 0xffffff) === 0 ? 0 : darkPacked(n, outline);
        }
      }
    });
    out.push({ c, ox: R, oy: R });
  }
  return out;
}

function darkPacked(c, k) {
  const r = c & 255, g = (c >>> 8) & 255, b = (c >>> 16) & 255;
  return packRGB(r * (1 - k) + 20 * k, g * (1 - k) + 16 * k, b * (1 - k) + 40 * k, 255);
}

// Pre-rendered looping sway animation of a Strands group (all strands share `speed`; use sec 1 or 2).
export class SwayAnim {
  constructor(strands, { frames = 16, pad = 3, under = null, over = null, bounds = null } = {}) {
    const sp = strands.list[0]?.speed || 1;
    const Pd = TAU / sp;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let f = 0; f < frames; f++) {
      const t = (f / frames) * Pd;
      for (const s of strands.list) {
        const n = strands.shape(s, t, 0);
        for (let i = 0; i <= n; i++) {
          const x = strands.pts[i * 2], y = strands.pts[i * 2 + 1];
          const r = s.w + (s.tip ? s.tipR + 2 : 1) + (s.blades ? 16 : 0);
          x0 = Math.min(x0, x - r); x1 = Math.max(x1, x + r); y0 = Math.min(y0, y - r); y1 = Math.max(y1, y + r);
        }
      }
    }
    if (bounds) { x0 = Math.min(x0, bounds.x0); y0 = Math.min(y0, bounds.y0); x1 = Math.max(x1, bounds.x1); y1 = Math.max(y1, bounds.y1); }
    x0 = Math.floor(x0 - pad); y0 = Math.floor(y0 - pad); x1 = Math.ceil(x1 + pad); y1 = Math.ceil(y1 + pad);
    this.x = x0; this.y = y0; this.P = Pd; this.n = frames;
    this.frames = [];
    for (let f = 0; f < frames; f++) {
      const c = makeCanvas(x1 - x0, y1 - y0);
      const g = ctxOf(c);
      g.translate(-x0, -y0);
      under?.(g);
      strands.draw(g, (f / frames) * Pd, 0);
      over?.(g);
      this.frames.push(c);
    }
  }
  frame(t, off = 0) {
    const i = Math.floor((t / this.P) * this.n + off);
    return this.frames[((i % this.n) + this.n) % this.n];
  }
  draw(ctx, t, off = 0, dx = 0, dy = 0) {
    ctx.drawImage(this.frame(t, off), this.x + dx, this.y + dy);
  }
}

// ------------------------------------------------------------------ particles

// Drifting motes (plankton, marine snow, data bits) in a wrap-around box.
export class Motes {
  constructor(n, box, o = {}) {
    const r = new RNG(o.seed ?? 7);
    this.box = box;
    this.o = { vx: [-2, 2], vy: [-3, 3], sizes: [1], colors: ['#ffffff'], alpha: [0.3, 0.8], wob: 4, ...o };
    this.list = [];
    for (let i = 0; i < n; i++) {
      this.list.push({
        x: r.float(box.x0, box.x1), y: r.float(box.y0, box.y1), vx: r.float(...this.o.vx), vy: r.float(...this.o.vy),
        ph: r.float(0, TAU), s: r.pick(this.o.sizes), c: r.pick(this.o.colors), a: r.float(...this.o.alpha), tw: r.float(0.5, 3), k: r.next(),
      });
    }
  }

  update(dt, ex = 0, ey = 0) {
    const b = this.box, w = b.x1 - b.x0, h = b.y1 - b.y0;
    for (const p of this.list) {
      p.x += (p.vx + ex) * dt;
      p.y += (p.vy + ey) * dt;
      if (p.x < b.x0) p.x += w; else if (p.x >= b.x1) p.x -= w;
      if (p.y < b.y0) p.y += h; else if (p.y >= b.y1) p.y -= h;
    }
  }

  draw(ctx, t, alphaMul = 1, count = 1, twinkleAmt = 0) {
    const pa = ctx.globalAlpha;
    const wob = this.o.wob;
    const n = Math.floor(this.list.length * clamp01(count));
    let lastC = null;
    for (let i = 0; i < n; i++) {
      const p = this.list[i];
      let a = p.a * alphaMul;
      if (twinkleAmt) a *= 1 - twinkleAmt + twinkleAmt * (0.5 + 0.5 * Math.sin(t * p.tw + p.ph));
      if (a <= 0.02) continue;
      if (p.c !== lastC) { ctx.fillStyle = p.c; lastC = p.c; }
      ctx.globalAlpha = pa * Math.min(1, a);
      const x = Math.round(p.x + Math.sin(t * 0.7 + p.ph) * wob), y = Math.round(p.y + Math.cos(t * 0.5 + p.ph * 1.3) * wob * 0.5);
      ctx.fillRect(x, y, p.s, p.s);
    }
    ctx.globalAlpha = pa;
  }
}

const bubbleSprites = new Map();
export function bubbleSprite(r, rim = '#e6fbff', fill = 'rgba(170,235,255,0.22)') {
  const key = r + rim;
  let c = bubbleSprites.get(key);
  if (c) return c;
  const s = r * 2 + 1;
  c = makeCanvas(s, s);
  const g = ctxOf(c);
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const d = Math.hypot(x - r, y - r);
    if (d > r + 0.35) continue;
    g.fillStyle = d > r - 0.75 ? rim : fill;
    g.globalAlpha = d > r - 0.75 ? (x > r && y > r ? 0.55 : 0.9) : 1;
    g.fillRect(x, y, 1, 1);
  }
  g.globalAlpha = 1;
  g.fillStyle = '#ffffff';
  if (r >= 2) g.fillRect(r - Math.ceil(r / 2), r - Math.ceil(r / 2), 1, 1);
  if (r >= 4) g.fillRect(r - Math.ceil(r / 2) + 1, r - Math.ceil(r / 2), 1, 1);
  bubbleSprites.set(key, c);
  return c;
}

export class Bubbles {
  constructor(max = 80, rim) { this.list = []; this.max = max; this.rim = rim; }
  emit(x, y, o = {}) {
    if (this.list.length >= this.max) return;
    this.list.push({ x, y, r: o.r ?? 1, vy: o.vy ?? -(16 + Math.random() * 14), ph: Math.random() * TAU, t: 0, life: o.life ?? 12, wob: o.wob ?? 1.5 });
  }
  update(dt, top = -20) {
    let w = 0;
    for (const b of this.list) {
      b.t += dt;
      b.y += b.vy * dt;
      b.vy -= dt * 3;
      if (b.y <= (top ?? -20) + b.r || b.t > b.life) continue;
      this.list[w++] = b;
    }
    this.list.length = w;
  }
  draw(ctx, t) {
    for (const b of this.list) {
      const s = bubbleSprite(b.r, this.rim);
      ctx.drawImage(s, Math.round(b.x + Math.sin(t * 3 + b.ph) * b.wob) - b.r, Math.round(b.y) - b.r);
    }
  }
}

// ------------------------------------------------------------------ masks & silhouettes

// Byte mask with simple raster ops; colourise with toCanvas(fn).
export class Mask {
  constructor(w, h) { this.w = Math.ceil(w); this.h = Math.ceil(h); this.d = new Uint8Array(this.w * this.h); }
  set(x, y, v = 1) { x = Math.floor(x); y = Math.floor(y); if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.d[y * this.w + x] = v; }
  get(x, y) { x = Math.floor(x); y = Math.floor(y); return x >= 0 && y >= 0 && x < this.w && y < this.h ? this.d[y * this.w + x] : 0; }
  rect(x, y, w, h, v = 1) {
    const x0 = Math.max(0, Math.round(x)), y0 = Math.max(0, Math.round(y)), x1 = Math.min(this.w, Math.round(x + w)), y1 = Math.min(this.h, Math.round(y + h));
    for (let j = y0; j < y1; j++) this.d.fill(v, j * this.w + x0, j * this.w + Math.max(x0, x1));
  }
  ellipse(cx, cy, rx, ry, v = 1) {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      const dy = (y + 0.5 - cy) / ry;
      if (dy * dy > 1) continue;
      const hw = rx * Math.sqrt(1 - dy * dy);
      for (let x = Math.round(cx - hw); x < Math.round(cx + hw); x++) this.set(x, y, v);
    }
  }
  poly(pts, v = 1) {
    let minY = Infinity, maxY = -Infinity;
    for (const p of pts) { minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]); }
    for (let y = Math.floor(minY); y <= Math.ceil(maxY); y++) {
      const py = y + 0.5, xs = [];
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const [xi, yi] = pts[i], [xj, yj] = pts[j];
        if ((yi > py) !== (yj > py)) xs.push(xi + ((py - yi) * (xj - xi)) / (yj - yi));
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) for (let x = Math.round(xs[k]); x < Math.round(xs[k + 1]); x++) this.set(x, y, v);
    }
  }
  // Capsule from (x0,y0) to (x1,y1) with radius r (r0 -> r1 taper).
  line(x0, y0, x1, y1, r0 = 1, v = 1, r1 = r0) {
    const rm = Math.max(r0, r1);
    const dx = x1 - x0, dy = y1 - y0, L2 = dx * dx + dy * dy || 1;
    for (let y = Math.floor(Math.min(y0, y1) - rm); y <= Math.ceil(Math.max(y0, y1) + rm); y++) {
      for (let x = Math.floor(Math.min(x0, x1) - rm); x <= Math.ceil(Math.max(x0, x1) + rm); x++) {
        const px = x + 0.5 - x0, py = y + 0.5 - y0;
        const t = clamp((px * dx + py * dy) / L2, 0, 1);
        const ex = px - dx * t, ey = py - dy * t;
        const r = r0 + (r1 - r0) * t;
        if (ex * ex + ey * ey <= r * r) this.set(x, y, v);
      }
    }
  }
  // Fill below a height function (screen y per column) down to yBottom.
  below(fn, v = 1, yBottom = this.h) {
    for (let x = 0; x < this.w; x++) {
      const y0 = Math.max(0, Math.round(fn(x)));
      for (let y = y0; y < Math.min(this.h, yBottom); y++) this.d[y * this.w + x] = v;
    }
  }
  // Branching coral / tree silhouette.
  branch(x, y, ang, len, r, depth, rng, v = 1, spread = 0.55) {
    const x1 = x + Math.sin(ang) * len, y1 = y - Math.cos(ang) * len;
    this.line(x, y, x1, y1, r, v, Math.max(0.6, r * 0.75));
    if (depth <= 0 || len < 3) { this.ellipse(x1, y1, r * 1.1 + 0.6, r * 1.1 + 0.6, v); return; }
    const k = rng.int(2, 3);
    for (let i = 0; i < k; i++) {
      const a = ang + (i - (k - 1) / 2) * spread + rng.float(-0.25, 0.25);
      this.branch(x1, y1, a, len * rng.float(0.6, 0.85), Math.max(0.6, r * 0.72), depth - 1, rng, v, spread);
    }
  }
  // Colourise. fn(x, y, v, up, left, right) -> packed; up = filled run length above (1 = top edge).
  toCanvas(fn) {
    const { w, h, d } = this;
    const up = new Uint16Array(w);
    return paintBuf(w, h, (out) => {
      for (let y = 0, i = 0; y < h; y++) {
        for (let x = 0; x < w; x++, i++) {
          const v = d[i];
          if (!v) { up[x] = 0; continue; }
          up[x] = y > 0 && d[i - w] ? up[x] + 1 : 1;
          const left = x === 0 || !d[i - 1], right = x === w - 1 || !d[i + 1];
          const c = fn(x, y, v, up[x], left, right);
          if (c) out[i] = c;
        }
      }
    });
  }
}

// Fractal ridge heights for silhouettes: returns Float32Array of y per column.
export function ridge(w, base, amp, freq, seed, oct = 4, sharp = 0) {
  const out = new Float32Array(w + 1);
  for (let x = 0; x <= w; x++) {
    let v = 0, a = 1, f = freq, n = 0;
    for (let o = 0; o < oct; o++) {
      let s = Math.sin(x * f + seed * 1.7 + o * 2.1) * 0.5 + Math.sin(x * f * 1.93 + seed * 0.7 + o) * 0.5;
      if (sharp) s = lerp(s, 1 - Math.abs(s) * 2, sharp);
      v += s * a; n += a; a *= 0.5; f *= 2.07;
    }
    out[x] = base - (v / n) * amp;
  }
  return out;
}

// Tileable soft cloud texture (turbidity, fog banks): dithered alpha blobs of one colour.
export function cloudTile(w, h, color, { seed = 1, alpha = 0.25, scale = 0.03, levels = 4, bias = 0.5 } = {}) {
  const [cr, cg, cb] = hexToRgb(color);
  const per = (x, y, o) => {
    // tileable fbm via 4-corner blend
    const n = (xx, yy) => {
      let v = 0, a = 0.5, f = scale, nn = 0;
      for (let i = 0; i < 3; i++) { v += (Math.sin(xx * f * 1.7 + seed + i * 3.1) * Math.sin(yy * f * 2.3 + seed * 0.7 + i) * 0.5 + 0.5) * a; nn += a; a *= 0.5; f *= 2; }
      return v / nn;
    };
    const fx = x / w, fy = y / h;
    return lerp(lerp(n(x, y), n(x - w, y), fx), lerp(n(x, y - h), n(x - w, y - h), fx), fy) + o;
  };
  return paint(w, h, (x, y) => {
    const v = clamp01((per(x, y, 0) - bias) * 3) * alpha;
    const q = Math.floor(v * levels + bayer(x, y)) / levels;
    return q <= 0 ? 0 : packRGB(cr, cg, cb, Math.round(Math.min(1, q) * 255));
  });
}

// Tileable diagonal rain/streak texture (fill as a pattern and scroll).
export function streakTile(w, h, n, color, { len = [3, 6], slant = 3, seed = 1, alpha = 1 } = {}) {
  const r = new RNG(seed);
  const [cr, cg, cb] = hexToRgb(color);
  const buf = new Uint32Array(w * h);
  for (let i = 0; i < n; i++) {
    const x0 = r.int(0, w - 1), y0 = r.int(0, h - 1), L = r.int(len[0], len[1]);
    for (let j = 0; j < L; j++) {
      const x = (((x0 - Math.floor(j / slant)) % w) + w) % w, y = (y0 + j) % h;
      buf[y * w + x] = packRGB(cr, cg, cb, Math.round(255 * alpha * (0.5 + 0.5 * (j / L))));
    }
  }
  return paintBuf(w, h, (d) => d.set(buf));
}

// ------------------------------------------------------------------ geometry helpers

export function catenary(x0, y0, x1, y1, sag, n = 24, out = []) {
  out.length = 0;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    out.push([lerp(x0, x1, t), lerp(y0, y1, t) + sag * 4 * t * (1 - t)]);
  }
  return out;
}

// Pixel polyline with optional dark outline (cables, ropes, chains).
export function drawCable(ctx, pts, color, w = 1, outline = null, hl = null) {
  const seg = (fill, ww, off) => {
    ctx.fillStyle = fill;
    for (let i = 0; i + 1 < pts.length; i++) {
      let [x0, y0] = pts[i];
      const [x1, y1] = pts[i + 1];
      const n = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))));
      for (let k = 0; k < n; k++) {
        const x = Math.round(x0 + ((x1 - x0) * k) / n), y = Math.round(y0 + ((y1 - y0) * k) / n);
        ctx.fillRect(x - off, y - off, ww, ww);
      }
    }
  };
  if (outline) seg(outline, w + 2, 1 + Math.floor((w - 1) / 2));
  seg(color, w, Math.floor((w - 1) / 2));
  if (hl && w >= 2) {
    ctx.fillStyle = hl;
    for (let i = 0; i + 1 < pts.length; i += 2) ctx.fillRect(Math.round(pts[i][0]), Math.round(pts[i][1]) - Math.floor((w - 1) / 2), 1, 1);
  }
}

export function inRect(x, y, r, pad = 0) {
  return r && x >= r.x - pad && y >= r.y - pad && x < r.x + r.w + pad && y < r.y + r.h + pad;
}

// Smooth an env-driven value toward a target (snaps on the first call).
export function follow(obj, key, target, rate, dt) {
  if (obj[key] === undefined || obj.__snap) { obj[key] = target; return target; }
  obj[key] += (target - obj[key]) * (1 - Math.exp(-rate * dt));
  return obj[key];
}

// Time-of-day weights {day, dusk, night} that sum to 1.
export function todWeights(env) {
  const dl = clamp01(env.daylight ?? 1);
  const dusk = clamp01(env.dusk ?? 0) * (0.35 + 0.65 * smoothstep(0.05, 0.6, dl));
  const night = clamp01(1 - dl) * (1 - dusk * 0.7);
  const day = Math.max(0, 1 - night - dusk);
  const s = day + dusk + night || 1;
  return { day: day / s, dusk: dusk / s, night: night / s };
}

export function mixHex(a, b, t) { return mix(a, b, clamp01(t)); }
export function shadeHex(a, k) { return shade(a, k); }

// ------------------------------------------------------------------ voxel ground

// Voxel heightfield seabed seen from the side (yaw 0). `height(vx, vz)` returns the column height in
// voxels, `color(vx, vy, vz, h)` the palette index (palette set up by `palette(m)`), `decorate(m, H)`
// adds extra voxels (stones, shells). The slab's back edge at baseH lands on screen y = backY.
// Returns { canvas, x, y, floor (Float32Array per screen column), toScreen(vx, vy, vz), surfaceY(sx, zf) }.
export function voxelGround(W, H, o) {
  const s = o.vs ?? 2;
  const pitch = o.pitch ?? 27;
  const sp = Math.sin((pitch * Math.PI) / 180), cp = Math.cos((pitch * Math.PI) / 180);
  const nx = Math.ceil(W / s) + 3;
  const nz = o.depth ?? Math.ceil((H - o.backY + 10) / (sp * s)) + 6;
  const ny = o.ny ?? 24;
  const m = new VoxelModel(nx, ny, nz);
  const pal = o.palette(m);
  const hmap = new Float32Array(nx * nz);
  for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) {
    const h = clamp(Math.floor(o.height(x, z)), 1, ny - 1);
    hmap[z * nx + x] = h;
    for (let y = 0; y < h; y++) m.set(x, y, z, o.color(x, y, z, h, pal));
  }
  const H2 = (x, z) => hmap[clamp(z, 0, nz - 1) * nx + clamp(x, 0, nx - 1)];
  o.decorate?.(m, pal, H2);
  const r = renderVoxels(m, { scale: s, yaw: 0, pitch, outline: true, ...(o.render || {}) });
  const base = o.baseH ?? 4;
  const p0 = r.project(1, base, 0);
  const dx = -Math.round(p0[0]), dy = Math.round(o.backY - p0[1]);
  // floor = first opaque pixel per screen column
  const img = ctxOf(r.canvas).getImageData(0, 0, r.w, r.h).data;
  const floor = new Float32Array(W + 1);
  for (let sx = 0; sx <= W; sx++) {
    const cx = clamp(sx - dx, 0, r.w - 1);
    let fy = r.h;
    for (let y = 0; y < r.h; y++) if (img[(y * r.w + cx) * 4 + 3] > 0) { fy = y; break; }
    floor[sx] = fy + dy + 1;
  }
  const toScreen = (vx, vy, vz) => {
    const q = r.project(vx, vy, vz);
    return [q[0] + dx, q[1] + dy];
  };
  // surface point at screen x and depth fraction zf (0 back row .. 1 front row)
  const surfaceY = (sx, zf) => {
    const vz = clamp(Math.round(zf * (nz - 1)), 0, nz - 1);
    const vx = clamp(Math.round((sx - dx) / s), 0, nx - 1);
    const q = toScreen(vx + 0.5, H2(vx, vz), vz + 0.5);
    return q[1];
  };
  return { canvas: r.canvas, glow: r.glow, x: dx, y: dy, floor, toScreen, surfaceY, nx, nz, ny, s, model: m, heightAt: H2 };
}

// ------------------------------------------------------------------ perspective depth scene

// Re-tints sprites toward a fog colour, caching one tinted copy per source canvas (re-tinted on key change).
export class FogCache {
  constructor() { this.map = new Map(); }
  get(src, color, a) {
    if (a <= 0.01 || !src) return src;
    const key = color + '|' + Math.round(a * 40);
    let e = this.map.get(src);
    if (!e) { e = { key: null, c: makeCanvas(src.width, src.height) }; this.map.set(src, e); }
    if (e.key !== key) {
      e.key = key;
      const g = ctxOf(e.c);
      g.globalCompositeOperation = 'source-over';
      g.globalAlpha = 1;
      g.clearRect(0, 0, e.c.width, e.c.height);
      g.drawImage(src, 0, 0);
      g.globalCompositeOperation = 'source-atop';
      g.globalAlpha = clamp01(a);
      g.fillStyle = color;
      g.fillRect(0, 0, e.c.width, e.c.height);
      g.globalCompositeOperation = 'source-over';
      g.globalAlpha = 1;
    }
    return e.c;
  }
}

// Perspective model shared with the fish: z = 0 front plane (scale 1), z = 1 far plane (scale 0.5),
// z = 2 the horizon. Screen y of the floor (height h in front-plane px) at depth z:
//   y = hz + (K - h) * (1 - z / 2),  hz = horizon y, K = yFront - hz.
// The floor is a voxel heightfield ray-marched per screen column (voxel-space style, front to back with a
// y-buffer); props are placed at (screen x, z), scaled by perspective, depth sorted and fog tinted, then
// everything is baked into near / mid / far band canvases (one set per time-of-day variant).
export class DepthScene {
  constructor(W, H, o = {}) {
    this.W = W; this.H = H;
    this.yFront = o.yFront; this.yFar = o.yFar;
    this.hz = 2 * o.yFar - o.yFront;
    this.K = o.yFront - this.hz;
    this.cx = Math.round(W / 2);
    this.pad = o.pad ?? 24;
    this.LW = W + this.pad * 2;
    this.zNear = this.zAt(H + 2);
    this.zFar = o.zFar ?? 1.85;
    this.cuts = o.cuts ?? [0.33, 0.66];
    this.fogK = o.fog ?? 1;
    this.fogStart = o.fogStart ?? -0.25;
    this.items = [];
  }

  s(z) { return 1 - 0.5 * z; }
  y(z, h = 0) { return this.hz + (this.K - h) * (1 - 0.5 * z); }
  zAt(y, h = 0) { return 2 * (1 - (y - this.hz) / (this.K - h)); }
  X(sx, z) { return this.cx + (sx - this.cx) / (1 - 0.5 * z); }
  fog(z) { return clamp01(Math.pow(smoothstep(this.fogStart, this.zFar, z), 1.15) * this.fogK); }
  band(z) { return z < this.cuts[0] ? 0 : z < this.cuts[1] ? 1 : 2; }
  scaleAt(z, base = 1) { return base * this.s(z); }

  // Heightfield + colour grid in world space, then the column ray-march.
  // o.height(X, z) -> world px; o.color(X, z, h) -> [r, g, b] (0..255, unshaded); o.glow(X, z) -> [r,g,b] | null
  terrain(o) {
    const { W, H, pad, cx, K, hz } = this;
    const cw = o.cell ?? 2, dz = o.dz ?? 0.02, hstep = o.hstep ?? 2;
    const z0 = this.zNear - 0.06, z1 = this.zFar;
    const nz = Math.ceil((z1 - z0) / dz) + 2;
    const span = (W / 2 + pad + 6) / this.s(Math.min(1.25, z1));
    const X0 = cx - span, nx = Math.ceil((2 * span) / cw) + 2;
    const N = nx * nz;
    const hgt = new Float32Array(N);
    const base = new Float32Array(N * 3);
    const glow = new Uint8Array(N);
    for (let iz = 0; iz < nz; iz++) {
      const z = z0 + iz * dz;
      for (let ix = 0; ix < nx; ix++) {
        const X = X0 + ix * cw, i = iz * nx + ix;
        const h = Math.round(o.height(X, z) / hstep) * hstep;
        hgt[i] = h;
        let c = o.glow?.(X, z, h);
        if (c) glow[i] = 1; else c = o.color(X, z, h, ix, iz);
        base[i * 3] = c[0]; base[i * 3 + 1] = c[1]; base[i * 3 + 2] = c[2];
      }
    }
    // shading: lambert from the height gradient + ambient occlusion from a blurred height + voxel jitter
    const col = new Uint32Array(N);
    const blur = new Float32Array(N), tmp = new Float32Array(N);
    const R = 3;
    for (let iz = 0; iz < nz; iz++) for (let ix = 0; ix < nx; ix++) {
      let s = 0, n = 0;
      for (let k = -R; k <= R; k++) { const j = ix + k; if (j >= 0 && j < nx) { s += hgt[iz * nx + j]; n++; } }
      tmp[iz * nx + ix] = s / n;
    }
    for (let iz = 0; iz < nz; iz++) for (let ix = 0; ix < nx; ix++) {
      let s = 0, n = 0;
      for (let k = -R; k <= R; k++) { const j = iz + k; if (j >= 0 && j < nz) { s += tmp[j * nx + ix]; n++; } }
      blur[iz * nx + ix] = s / n;
    }
    const L = [-0.42, 0.85, -0.32];
    { const l = Math.hypot(...L); L[0] /= l; L[1] /= l; L[2] /= l; }
    const amb = o.ambient ?? 0.62, dif = o.diffuse ?? 0.5, aoK = o.ao ?? 0.06, jit = o.jitter ?? 0.07;
    for (let iz = 0; iz < nz; iz++) for (let ix = 0; ix < nx; ix++) {
      const i = iz * nx + ix;
      const hl = hgt[iz * nx + Math.max(0, ix - 1)], hr = hgt[iz * nx + Math.min(nx - 1, ix + 1)];
      const hn = hgt[Math.max(0, iz - 1) * nx + ix], hf = hgt[Math.min(nz - 1, iz + 1) * nx + ix];
      let gx = -(hr - hl) / (2 * cw), gz = -(hf - hn) / (2 * cw), gy = 1;
      const gl = Math.hypot(gx, gy, gz);
      gx /= gl; gy /= gl; gz /= gl;
      const lam = Math.max(0, gx * L[0] + gy * L[1] + gz * L[2]);
      const ao = clamp01((blur[i] - hgt[i]) * aoK);
      let k = glow[i] ? 1.25 : (amb + dif * lam) * (1 - ao * 0.55) + (hash2(ix, iz, 71) - 0.5) * 2 * jit;
      const r = base[i * 3] * k, g = base[i * 3 + 1] * k, b = base[i * 3 + 2] * k;
      col[i] = ((clamp(Math.round(r), 0, 255)) | (clamp(Math.round(g), 0, 255) << 8) | (clamp(Math.round(b), 0, 255) << 16) | (glow[i] ? 1 << 24 : 0) | (1 << 25)) >>> 0;
    }
    this.grid = { nx, nz, X0, z0, cw, dz, hgt, col };
    // ray-march every screen column front to back
    const top = Math.floor(hz) - 2;
    const TH = H - top;
    const LW = this.LW;
    const pc = new Uint32Array(LW * TH);      // shaded colour (0 = empty)
    const pz = new Float32Array(LW * TH);     // depth of the sample that drew the pixel
    const step = 0.5 / (K * 0.5);
    const wallF = o.wall ?? 0.72, sideF = o.side ?? 0.84, crestF = o.crest ?? 1.12;
    const shadeP = (c, f) => ((clamp(Math.round((c & 255) * f), 0, 255)) | (clamp(Math.round(((c >> 8) & 255) * f), 0, 255) << 8) | (clamp(Math.round(((c >> 16) & 255) * f), 0, 255) << 16) | (c & (3 << 24))) >>> 0;
    for (let px = 0; px < LW; px++) {
      const sx = px - pad + 0.5;
      let ybuf = TH;
      let prevCell = -1, prevH = -1e9, prevIz = -1;
      for (let z = z0; z < z1; z += step) {
        const s = 1 - 0.5 * z;
        const X = cx + (sx - cx) / s;
        const iz = Math.min(nz - 1, Math.floor((z - z0) / dz));
        let ix = Math.floor((X - X0) / cw) % nx;
        if (ix < 0) ix += nx;
        const cell = iz * nx + ix;
        const h = hgt[cell];
        const yt = hz + (K - h) * s - top;
        const yi = Math.max(0, Math.ceil(yt));
        if (yi < ybuf) {
          let c = col[cell];
          const isWall = cell !== prevCell && h > prevH + 0.01;
          if (isWall) c = shadeP(c, iz !== prevIz ? wallF : sideF);
          for (let y = yi; y < ybuf; y++) { pc[y * LW + px] = c; pz[y * LW + px] = z; }
          if (isWall && ybuf - yi >= 2) pc[yi * LW + px] = shadeP(col[cell], crestF);
          ybuf = yi;
          if (ybuf <= 0) break;
        }
        prevCell = cell; prevH = h; prevIz = iz;
      }
    }
    this.top = top; this.TH = TH; this.pc = pc; this.pz = pz;
    this.buildFloorTable();
  }

  heightAt(X, z) {
    const g = this.grid;
    const iz = clamp(Math.floor((z - g.z0) / g.dz), 0, g.nz - 1);
    let ix = Math.floor((X - g.X0) / g.cw) % g.nx;
    if (ix < 0) ix += g.nx;
    return g.hgt[iz * g.nx + ix];
  }

  buildFloorTable() {
    const zs = [], z0 = -0.6, z1 = 1.9, dz = 0.05;
    for (let z = z0; z <= z1 + 1e-6; z += dz) zs.push(z);
    const xs = Math.ceil(this.W / 4) + 1;
    const t = new Float32Array(zs.length * xs);
    for (let j = 0; j < zs.length; j++) for (let i = 0; i < xs; i++) {
      const sx = i * 4, z = zs[j];
      let h = 0;
      for (let k = -1; k <= 1; k++) h = Math.max(h, this.heightAt(this.X(sx + k * 2, z), z));
      t[j * xs + i] = this.y(z, h);
    }
    this.ft = { z0, dz, nzs: zs.length, xs, t };
  }

  floorAt(x, z = 0) {
    const f = this.ft;
    if (!f) return this.y(z);
    const fx = clamp(x / 4, 0, f.xs - 1.001), fz = clamp((z - f.z0) / f.dz, 0, f.nzs - 1.001);
    const ix = Math.floor(fx), iz = Math.floor(fz), ax = fx - ix, az = fz - iz;
    const a = f.t[iz * f.xs + ix], b = f.t[iz * f.xs + ix + 1], c = f.t[(iz + 1) * f.xs + ix], d = f.t[(iz + 1) * f.xs + ix + 1];
    return lerp(lerp(a, b, ax), lerp(c, d, ax), az);
  }

  // item: {sprite: {canvas, ox, oy}, x, z, dy?, noFog?, fogMul?} -> placed {x, y, z, band, sprite}
  add(item) {
    const it = { dy: 0, fogMul: 1, ...item };
    it.y = Math.round(this.floorAt(it.x, it.z)) + 1 + it.dy;
    it.band = this.band(it.z);
    this.items.push(it);
    return it;
  }

  // variants: [{key, strip}] (strip = water gradient strip canvas used as the fog colour per screen y).
  render(variants) {
    const { LW, pad, TH, top, pc, pz } = this;
    this.items.sort((a, b) => b.z - a.z);
    const bands = [0, 1, 2].map((b) => {
      let bt = top;
      for (const it of this.items) if (it.band === b) bt = Math.min(bt, it.y - it.sprite.oy - 2);
      return { y: Math.floor(bt), canvases: {}, h: this.H - Math.floor(bt) };
    });
    const tmp = makeLayer(8, 8);
    for (const v of variants) {
      const sd = ctxOf(v.strip).getImageData(0, 0, v.strip.width, v.strip.height).data;
      const sw = v.strip.width;
      for (let b = 0; b < 3; b++) {
        const B = bands[b];
        const c = makeCanvas(LW, B.h);
        const g = ctxOf(c);
        const img = g.createImageData(LW, B.h);
        const d = new Uint32Array(img.data.buffer);
        const off = top - B.y;
        for (let y = 0; y < TH; y++) {
          const yy = y + off;
          const sy = Math.min(v.strip.height - 1, y + top);
          for (let x = 0; x < LW; x++) {
            const i = y * LW + x;
            const cc = pc[i];
            if (!cc) continue;
            const z = pz[i];
            if (this.band(z) !== b) continue;
            const glow = (cc >>> 24) & 1;
            let f = this.fog(z) * (glow ? 0.5 : 1);
            const si = (sy * sw + (x & (sw - 1))) * 4;
            const r = lerp(cc & 255, sd[si], f), gg = lerp((cc >> 8) & 255, sd[si + 1], f), bb = lerp((cc >> 16) & 255, sd[si + 2], f);
            d[yy * LW + x] = dpack(r, gg, bb, x, y, 4);
          }
        }
        g.putImageData(img, 0, 0);
        // props of this band, far to near, each fog-tinted toward the gradient
        for (const it of this.items) {
          if (it.band !== b) continue;
          const sp = it.sprite;
          const dx = Math.round(it.x - sp.ox + pad), dy = Math.round(it.y - sp.oy - B.y);
          const f = it.noFog ? 0 : this.fog(it.z) * it.fogMul;
          if (f < 0.01) { g.drawImage(sp.canvas, dx, dy); continue; }
          if (tmp.w < sp.canvas.width || tmp.h < sp.canvas.height) resizeLayer(tmp, Math.max(tmp.w, sp.canvas.width), Math.max(tmp.h, sp.canvas.height));
          const tg = tmp.ctx;
          tg.globalCompositeOperation = 'source-over';
          tg.globalAlpha = 1;
          tg.clearRect(0, 0, tmp.w, tmp.h);
          tg.drawImage(sp.canvas, 0, 0);
          tg.globalCompositeOperation = 'source-atop';
          tg.globalAlpha = f;
          tg.save();
          tg.translate(0, -(it.y - sp.oy));
          tg.fillStyle = tg.createPattern(v.strip, 'repeat');
          tg.fillRect(0, it.y - sp.oy, sp.canvas.width, sp.canvas.height);
          tg.restore();
          tg.globalCompositeOperation = 'source-over';
          tg.globalAlpha = 1;
          g.drawImage(tmp.canvas, 0, 0, sp.canvas.width, sp.canvas.height, dx, dy, sp.canvas.width, sp.canvas.height);
          it.painted?.(g, dx, dy, v.key);
        }
        B.canvases[v.key] = c;
      }
    }
    this.bands = bands;
    return bands;
  }
}

// Quantised perspective scale so props at similar depths share one voxel render.
export function qscale(s, step = 0.1, min = 0.25) {
  return Math.max(min, Math.round(s / step) * step);
}

// Blend helper for a DepthScene's baked bands across time-of-day variants.
export class BandSet {
  constructor(scene) { this.scene = scene; this.blends = [new Blend(), new Blend(), new Blend()]; }
  canvas(b, w) {
    const B = this.scene.bands[b];
    const keys = Object.keys(B.canvases);
    if (keys.length === 1 || !w) return B.canvases[keys[0]];
    return this.blends[b].get([[B.canvases.day, w.day], [B.canvases.dusk, w.dusk], [B.canvases.night, w.night]]);
  }
  draw(ctx, b, w, dx = 0, dy = 0) {
    const B = this.scene.bands[b];
    ctx.drawImage(this.canvas(b, w), Math.round(-this.scene.pad + dx), Math.round(B.y + dy));
  }
}

// Water colour at screen y for time-of-day weights (variants: {day, dusk, night} stop lists).
export function waterColorAt(stopsByKey, w, y, y0, y1) {
  const t = clamp01((y - y0) / Math.max(1, y1 - y0));
  let r = 0, g = 0, b = 0, n = 0;
  for (const k of ['day', 'dusk', 'night']) {
    const wt = w ? w[k] : k === 'day' ? 1 : 0;
    if (!stopsByKey[k] || wt <= 0) continue;
    const c = lerpStops(stopsByKey[k], t);
    r += c[0] * wt; g += c[1] * wt; b += c[2] * wt; n += wt;
  }
  n = n || 1;
  const q = (v) => clamp(Math.round(v / n / 4) * 4, 0, 255).toString(16).padStart(2, '0');
  return '#' + q(r) + q(g) + q(b);
}

// Animated decor living at a depth: sway animations / sprites drawn after their band, fog tinted.
export class DepthDecor {
  constructor(scene) { this.scene = scene; this.list = []; this.fog = new FogCache(); this.key = null; }
  add(o) {
    const it = { off: 0, speed: 1, fogMul: 1, fc: '#000000', fa: 0, ...o };
    it.band = this.scene.band(it.z);
    it.fy = it.fy ?? (it.anim ? it.anim.y + it.anim.frames[0].height * 0.5 : it.y);
    this.list.push(it);
    this.list.sort((a, b) => b.z - a.z);
    return it;
  }
  refog(colorAt, key) {
    if (key === this.key) return;
    this.key = key;
    for (const it of this.list) { it.fc = colorAt(it.fy); it.fa = this.scene.fog(it.z) * it.fogMul; }
  }
  draw(ctx, band, t, dx = 0, dy = 0, speed = 1) {
    for (const it of this.list) {
      if (it.band !== band || it.hidden) continue;
      if (it.anim) {
        const fr = it.anim.frame(t * it.speed * speed, it.off);
        ctx.drawImage(this.fog.get(fr, it.fc, it.fa), Math.round(it.anim.x + dx), Math.round(it.anim.y + dy));
      } else if (it.sprite) ctx.drawImage(this.fog.get(it.sprite, it.fc, it.fa), Math.round(it.x + dx), Math.round(it.y + dy));
    }
  }
}

// White alpha mask with a soft dithered vertical profile (peak at `peak` 0..1) for horizon haze bands.
export function hazeMask(w, h, { peak = 0.6, alpha = 0.7, levels = 6 } = {}) {
  return paint(w, h, (x, y) => {
    const t = y / (h - 1);
    const v = (t < peak ? smoothstep(0, peak, t) : 1 - smoothstep(peak, 1, t)) * alpha;
    const q = Math.floor(v * levels + bayer(x, y)) / levels;
    return q <= 0 ? 0 : packRGB(255, 255, 255, Math.round(Math.min(1, q) * 255));
  });
}
