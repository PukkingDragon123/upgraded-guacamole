// Canvas creation helpers. Everything is drawn at low resolution and upscaled
// with nearest-neighbour filtering, so smoothing is always disabled.

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}

export function ctxOf(canvas) {
  const g = canvas.getContext('2d', { willReadFrequently: false });
  g.imageSmoothingEnabled = false;
  return g;
}

export function makeLayer(w, h) {
  const canvas = makeCanvas(w, h);
  return { canvas, ctx: ctxOf(canvas), w: canvas.width, h: canvas.height };
}

export function resizeLayer(layer, w, h) {
  layer.canvas.width = Math.max(1, Math.ceil(w));
  layer.canvas.height = Math.max(1, Math.ceil(h));
  layer.w = layer.canvas.width;
  layer.h = layer.canvas.height;
  layer.ctx.imageSmoothingEnabled = false;
}

// Tinted copies of a sprite (cached): solid colour silhouette with the sprite's alpha.
const tintCache = new WeakMap();
export function tinted(src, color) {
  let m = tintCache.get(src);
  if (!m) tintCache.set(src, (m = new Map()));
  let c = m.get(color);
  if (!c) {
    c = makeCanvas(src.width, src.height);
    const g = ctxOf(c);
    g.drawImage(src, 0, 0);
    g.globalCompositeOperation = 'source-in';
    g.fillStyle = color;
    g.fillRect(0, 0, c.width, c.height);
    m.set(color, c);
  }
  return c;
}

// Scratch canvas used for per-sprite effects (fog, darkness, flashes).
let scratch = null;
export function scratchCanvas(w, h) {
  if (!scratch) scratch = makeLayer(64, 64);
  if (scratch.w < w || scratch.h < h) resizeLayer(scratch, Math.max(scratch.w, w), Math.max(scratch.h, h));
  scratch.ctx.globalCompositeOperation = 'source-over';
  scratch.ctx.globalAlpha = 1;
  scratch.ctx.clearRect(0, 0, w, h);
  return scratch;
}

// Draw `src` onto ctx with a colour wash applied only to its pixels.
export function drawWashed(ctx, src, sx, sy, sw, sh, dx, dy, dw, dh, color, alpha) {
  if (alpha <= 0.01) {
    ctx.drawImage(src, sx, sy, sw, sh, dx, dy, dw, dh);
    return;
  }
  const s = scratchCanvas(sw, sh);
  s.ctx.drawImage(src, sx, sy, sw, sh, 0, 0, sw, sh);
  s.ctx.globalCompositeOperation = 'source-atop';
  s.ctx.globalAlpha = Math.min(1, alpha);
  s.ctx.fillStyle = color;
  s.ctx.fillRect(0, 0, sw, sh);
  s.ctx.globalAlpha = 1;
  s.ctx.globalCompositeOperation = 'source-over';
  ctx.drawImage(s.canvas, 0, 0, sw, sh, dx, dy, dw, dh);
}
