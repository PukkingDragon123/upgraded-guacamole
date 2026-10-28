// Software pixel buffer for procedurally rasterised sprites, plus an ASCII
// sprite parser for hand-authored art.

import { makeCanvas, ctxOf } from '../core/canvas.js';
import { pack, unpack, packRGB, shade } from '../core/color.js';

export class PixelBuffer {
  constructor(w, h) {
    this.w = Math.max(1, w | 0);
    this.h = Math.max(1, h | 0);
    this.data = new Uint32Array(this.w * this.h);
  }

  inBounds(x, y) {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }

  set(x, y, c) {
    x |= 0; y |= 0;
    if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.data[y * this.w + x] = c;
  }

  get(x, y) {
    x |= 0; y |= 0;
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return 0;
    return this.data[y * this.w + x];
  }

  alpha(x, y) {
    return this.get(x, y) >>> 24;
  }

  rect(x, y, w, h, c) {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.set(i, j, c);
  }

  line(x0, y0, x1, y1, c) {
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.set(x0, y0, c);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }

  fillCircle(cx, cy, r, c) {
    const r2 = r * r;
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
        const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
        if (dx * dx + dy * dy <= r2) this.set(x, y, c);
      }
    }
  }

  fillEllipse(cx, cy, rx, ry, c) {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry;
        if (dx * dx + dy * dy <= 1) this.set(x, y, c);
      }
    }
  }

  fillPoly(points, c) {
    let minY = Infinity, maxY = -Infinity;
    for (const p of points) { minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]); }
    for (let y = Math.floor(minY); y <= Math.ceil(maxY); y++) {
      const py = y + 0.5;
      const xs = [];
      for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        const [xi, yi] = points[i], [xj, yj] = points[j];
        if ((yi > py) !== (yj > py)) xs.push(xi + ((py - yi) * (xj - xi)) / (yj - yi));
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        for (let x = Math.round(xs[k]); x < Math.round(xs[k + 1]); x++) this.set(x, y, c);
      }
    }
  }

  // Outline every transparent pixel touching an opaque one. colorFn(neighbourColor) -> packed colour.
  outline(colorFn, diagonal = false) {
    const { w, h, data } = this;
    const src = data.slice();
    const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : src[y * w + x]);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (src[y * w + x] >>> 24) continue;
        let n = at(x - 1, y) || at(x + 1, y) || at(x, y - 1) || at(x, y + 1);
        if (!n && diagonal) n = at(x - 1, y - 1) || at(x + 1, y - 1) || at(x - 1, y + 1) || at(x + 1, y + 1);
        if (n && n >>> 24 > 40) data[y * w + x] = typeof colorFn === 'function' ? colorFn(n) : colorFn;
      }
    }
  }

  toCanvas() {
    const c = makeCanvas(this.w, this.h);
    const g = ctxOf(c);
    const img = g.createImageData(this.w, this.h);
    new Uint32Array(img.data.buffer).set(this.data);
    g.putImageData(img, 0, 0);
    return c;
  }
}

// Selective outline helper: darkened, hue-shifted version of the neighbour colour.
export function selOut(strength = 0.72) {
  const cache = new Map();
  return (n) => {
    let c = cache.get(n);
    if (c === undefined) {
      const [r, g, b] = unpack(n);
      const hex = '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
      c = pack(shade(hex, -strength));
      cache.set(n, c);
    }
    return c;
  };
}

/**
 * Parse ASCII art into a canvas.
 * rows: array of strings (or a single string with newlines); palette: { char: '#rrggbb' | null }
 * '.' and ' ' are transparent unless defined in the palette.
 */
export function spriteFromAscii(rows, palette, scale = 1) {
  if (typeof rows === 'string') rows = rows.replace(/^\n+|\n+\s*$/g, '').split('\n').map((r) => r.trim());
  const h = rows.length;
  const w = Math.max(...rows.map((r) => r.length));
  const buf = new PixelBuffer(w * scale, h * scale);
  const packed = {};
  for (const [k, v] of Object.entries(palette)) {
    if (!v) continue;
    if (v.length === 9) {
      const a = parseInt(v.slice(7, 9), 16);
      packed[k] = pack(v.slice(0, 7), a);
    } else packed[k] = pack(v);
  }
  for (let y = 0; y < h; y++) {
    const row = rows[y];
    for (let x = 0; x < row.length; x++) {
      const c = packed[row[x]];
      if (c) buf.rect(x * scale, y * scale, scale, scale, c);
    }
  }
  return buf.toCanvas();
}

export function flipCanvas(src) {
  const c = makeCanvas(src.width, src.height);
  const g = ctxOf(c);
  g.translate(src.width, 0);
  g.scale(-1, 1);
  g.drawImage(src, 0, 0);
  return c;
}

export { packRGB };
