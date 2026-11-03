// Float RGBA painter for the Aero room, tank shells and window chrome: premultiplied colour with
// hard-edged shapes (signed distances), quantised with ordered dithering when turned into a canvas.
//   new Paint(w, h); P.each(x0, y0, x1, y1, (x, y) => alpha after writing P.c, mode 'over'|'light'|'erase')
//   P.toCanvas(q) -> canvas;  C(hex) -> [r, g, b];  setMix(out, a, b, t);  grad(out, stops, t);  sdRR(...)

import { makeCanvas, ctxOf } from '../core/canvas.js';
import { hexToRgb } from '../core/color.js';
import { bayer, clamp } from '../core/math.js';

export const C = (hex) => hexToRgb(hex);

// Premultiplied float RGBA canvas with hard-edged shapes; quantised with ordered dithering on output.
export class Paint {
  constructor(w, h) {
    this.w = Math.max(1, w | 0); this.h = Math.max(1, h | 0);
    this.d = new Float32Array(this.w * this.h * 4);
    this.c = [0, 0, 0];
  }

  over(x, y, c, a) {
    if (a <= 0 || x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    if (a > 1) a = 1;
    const i = (y * this.w + x) * 4, d = this.d, k = 1 - a;
    d[i] = c[0] * a + d[i] * k; d[i + 1] = c[1] * a + d[i + 1] * k; d[i + 2] = c[2] * a + d[i + 2] * k; d[i + 3] = a + d[i + 3] * k;
  }

  // Additive light (keeps alpha).
  light(x, y, c, a) {
    if (a <= 0 || x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 4, d = this.d, al = d[i + 3];
    if (al <= 0) return;
    d[i] += c[0] * a * al; d[i + 1] += c[1] * a * al; d[i + 2] += c[2] * a * al;
  }

  erase(x, y, a = 1) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 4, d = this.d, k = 1 - a;
    d[i] *= k; d[i + 1] *= k; d[i + 2] *= k; d[i + 3] *= k;
  }

  // fn(x, y) -> alpha (0 = skip) after writing the colour into this.c
  each(x0, y0, x1, y1, fn, mode = 'over') {
    x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0));
    x1 = Math.min(this.w, Math.ceil(x1)); y1 = Math.min(this.h, Math.ceil(y1));
    const c = this.c;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const a = fn(x + 0.5, y + 0.5, x, y);
      if (!(a > 0)) continue;
      if (mode === 'over') this.over(x, y, c, a);
      else if (mode === 'light') this.light(x, y, c, a);
      else this.erase(x, y, a);
    }
  }

  toCanvas(q = 5) {
    const cv = makeCanvas(this.w, this.h);
    const g = ctxOf(cv);
    const img = g.createImageData(this.w, this.h);
    const o = img.data, d = this.d;
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      const i = (y * this.w + x) * 4;
      const a = d[i + 3];
      if (a < 0.02) continue;
      const b = bayer(x, y);
      const inv = 1 / a;
      o[i] = clamp(Math.floor((d[i] * inv) / q + b) * q, 0, 255);
      o[i + 1] = clamp(Math.floor((d[i + 1] * inv) / q + b) * q, 0, 255);
      o[i + 2] = clamp(Math.floor((d[i + 2] * inv) / q + b) * q, 0, 255);
      o[i + 3] = a > 0.97 ? 255 : clamp(Math.floor(a * 16 + b) * 16, 0, 255);
    }
    g.putImageData(img, 0, 0);
    return cv;
  }
}

export function setMix(out, a, b, t) {
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  out[0] = a[0] + (b[0] - a[0]) * t; out[1] = a[1] + (b[1] - a[1]) * t; out[2] = a[2] + (b[2] - a[2]) * t;
  return out;
}

// multi-stop gradient: stops = [[t, rgb], ...]
export function grad(out, stops, t) {
  if (t <= stops[0][0]) return setMix(out, stops[0][1], stops[0][1], 0);
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) return setMix(out, stops[i - 1][1], stops[i][1], (t - stops[i - 1][0]) / (stops[i][0] - stops[i - 1][0]));
  }
  return setMix(out, stops[stops.length - 1][1], stops[stops.length - 1][1], 0);
}

// signed distance to a rounded rect (centre cx, cy; half sizes hw, hh; radius r)
export function sdRR(x, y, cx, cy, hw, hh, r) {
  const qx = Math.abs(x - cx) - hw + r, qy = Math.abs(y - cy) - hh + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}
