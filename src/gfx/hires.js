// [phase9:ui] Full-resolution UI layer. The world keeps drawing into the 960 px logical canvas; the HUD, panels,
// toasts, tooltips, UI particles and the cursor draw into a second canvas at 2x the logical size (device pixels at
// 1920x1080) whose context is pre-scaled, so every layout still works in logical units while UI art gets
// half-logical-pixel detail. Everything stays nearest-neighbour crisp.
//
// Dual-resolution sprites: any canvas may carry a `.hi` twin (HI times the size, lazily built). On the UI context,
// drawImage swaps in the twin automatically (3, 5 and 9 argument forms; source rects are mapped), so callers keep
// using the logical canvas (its width / height are logical) and get the fine art for free on the hi-res layer.
//   HI                                  the hi-res factor of `.hi` twins (2)
//   withHi(canvas, build) -> canvas     attach a lazy `.hi` twin (build() -> canvas HI x the size)
//   hiArt(w, h, draw) -> canvas         author at HI x: draw(g, W, H) on a (w*HI x h*HI) canvas; returns the logical
//                                       canvas (smooth-downsampled for 1x contexts) with `.hi` = the authored art
//   hiFromBuffer(buf) -> canvas         a PixelBuffer authored at HI x -> logical canvas with `.hi`
//   enhanceHi(canvas) -> canvas         automatic 2x remaster of 1x pixel art: Scale2x diagonals, a 1 device-px
//                                       outline with a shaded inner rim, top-left light / bottom-right shade
//   autoHi(canvas) -> canvas            withHi(canvas, () => enhanceHi(canvas))
//   isHi(ctx) -> factor (0 = plain)     the UI context reports its scale
//   UiLayer(screen)                     the overlay: .ctx, .begin() -> ctx (cleared, transform = logical), .active
import { makeCanvas, ctxOf } from '../core/canvas.js';

export const HI = 2;
export const HI_ON = { on: false }; // true while the full-res UI layer is showing

export function withHi(c, build) {
  if (!c || 'hi' in c) return c;
  let v = null;
  Object.defineProperty(c, 'hi', {
    configurable: true,
    get() {
      if (v === null) { try { const r = build(); v = r === undefined ? null : r || false; } catch (e) { console.warn('hi art', e); v = false; } }
      return v || undefined; // build() -> undefined means 'not now' (asked again next draw), null / false = none
    },
  });
  return c;
}

function downsample(src, w, h) {
  const c = makeCanvas(w, h);
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.drawImage(src, 0, 0, w, h);
  return c;
}

export function hiArt(w, h, draw) {
  w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
  const hc = makeCanvas(w * HI, h * HI);
  const g = ctxOf(hc);
  draw(g, w * HI, h * HI);
  const c = downsample(hc, w, h);
  Object.defineProperty(c, 'hi', { value: hc, configurable: true });
  return c;
}

// Logical drawing code run twice: once on a plain w x h canvas, once (lazily) on a 2x canvas whose context behaves
// like the UI layer (logical units, `.hi` twins swapped in). draw(g, S) gets S = 1 or HI for optional extra detail.
export function dualArt(w, h, draw) {
  w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
  const c = makeCanvas(w, h);
  draw(ctxOf(c), 1);
  return withHi(c, () => {
    const hc = makeCanvas(w * HI, h * HI);
    const g = hiCtx(hc, HI);
    draw(g, HI);
    return hc;
  });
}

// A twin built at a bigger size than exactly HI x (rounding): placed so that big point (bx, by) lands on HI * (x, y).
export function fitHi(c, big, x = c.width / 2, y = c.height / 2, bx = big.width / 2, by = big.height / 2) {
  if (!big) return null;
  const hc = makeCanvas(c.width * HI, c.height * HI);
  ctxOf(hc).drawImage(big, Math.round(x * HI - bx), Math.round(y * HI - by));
  return hc;
}

export function hiCtx(canvas, R = HI) {
  const g = canvas.getContext('2d');
  if (!g.__hi) installHiCtx(g, R);
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.imageSmoothingEnabled = false;
  g.logicalW = canvas.width / R; g.logicalH = canvas.height / R;
  return g;
}

export function hiFromBuffer(buf) {
  const hc = buf.toCanvas();
  const c = downsample(hc, Math.ceil(buf.w / HI), Math.ceil(buf.h / HI));
  Object.defineProperty(c, 'hi', { value: hc, configurable: true });
  return c;
}

// ---------------------------------------------------------------- automatic remaster of 1x pixel art
const lum = (c) => ((c & 255) * 0.3 + ((c >>> 8) & 255) * 0.59 + ((c >>> 16) & 255) * 0.11);
function tone(c, k) {
  // k > 0 lightens toward a warm white, k < 0 darkens toward a cool shade (hue-shifted like the art direction)
  const a = c >>> 24;
  let r = c & 255, g = (c >>> 8) & 255, b = (c >>> 16) & 255;
  if (k > 0) { r += (255 - r) * k; g += (252 - g) * k; b += (236 - b) * k; }
  else { const q = -k; r *= 1 - q * 1.05; g *= 1 - q; b *= 1 - q * 0.75; b += 18 * q; }
  return ((a << 24) | (Math.max(0, Math.min(255, Math.round(b))) << 16) | (Math.max(0, Math.min(255, Math.round(g))) << 8) | Math.max(0, Math.min(255, Math.round(r)))) >>> 0;
}

export function enhanceHi(src, o = {}) {
  const w = src.width, h = src.height;
  if (!w || !h) return null;
  const d = new Uint32Array(ctxOf(src).getImageData(0, 0, w, h).data.buffer.slice(0));
  const W = w * 2, H = h * 2;
  const out = new Uint32Array(W * H);
  const P = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : d[y * w + x]);
  const same = (a, b) => a === b || ((a >>> 24) < 16 && (b >>> 24) < 16);
  // Scale2x (EPX): smooth stair-step diagonals without inventing colours
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = P(x, y), A = P(x, y - 1), B = P(x + 1, y), C = P(x - 1, y), D = P(x, y + 1);
    let e0 = p, e1 = p, e2 = p, e3 = p;
    if (!same(A, D) && !same(C, B)) {
      if (same(C, A)) e0 = C;
      if (same(A, B)) e1 = B;
      if (same(C, D)) e2 = C;
      if (same(D, B)) e3 = B;
    }
    const i = y * 2 * W + x * 2;
    out[i] = e0; out[i + 1] = e1; out[i + W] = e2; out[i + W + 1] = e3;
  }
  // outline thinning + bevel: the outer device pixel stays the dark outline, the inner one becomes a shaded rim of
  // the fill; fill pixels touching the outline get light from the top-left and shade at the bottom-right
  const A2 = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : out[y * W + x] >>> 24);
  const res = out.slice();
  const dark = (c) => (c >>> 24) > 200 && lum(c) < (o.outlineLum ?? 70);
  const bevel = o.bevel ?? 1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const c = out[y * W + x];
    if ((c >>> 24) < 16) continue;
    const edge = A2(x - 1, y) < 16 || A2(x + 1, y) < 16 || A2(x, y - 1) < 16 || A2(x, y + 1) < 16;
    if (edge) continue;
    if (dark(c)) {
      // inner half of a 2 px outline: pick the brightest non-outline neighbour within 2 px and use its shade
      let best = 0, bl = -1;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        const q = out[yy * W + xx];
        if ((q >>> 24) < 200 || dark(q)) continue;
        const l = lum(q) - (Math.abs(dx) + Math.abs(dy)) * 4;
        if (l > bl) { bl = l; best = q; }
      }
      if (best) {
        const outerish = A2(x - 2, y) < 16 || A2(x + 2, y) < 16 || A2(x, y - 2) < 16 || A2(x, y + 2) < 16;
        if (outerish) res[y * W + x] = tone(best, -0.42);
      }
      continue;
    }
    if (!bevel) continue;
    const up = out[(y - 1) * W + x], lf = out[y * W + x - 1], dn = out[(y + 1) * W + x], rt = out[y * W + x + 1];
    const tl = dark(up) || dark(lf) || (up >>> 24) < 16 || (lf >>> 24) < 16;
    const br = dark(dn) || dark(rt) || (dn >>> 24) < 16 || (rt >>> 24) < 16;
    if (tl && !br) res[y * W + x] = tone(c, 0.22 * bevel);
    else if (br && !tl) res[y * W + x] = tone(c, -0.14 * bevel);
  }
  if (o.outline) {
    // a fresh 1 device-px selective outline around the remastered interior (o.outline(packed) -> packed)
    const src2 = res.slice();
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if ((src2[i] >>> 24) >= 16) continue;
      let n = 0;
      if (x > 0 && (src2[i - 1] >>> 24) >= 16) n = src2[i - 1];
      else if (x < W - 1 && (src2[i + 1] >>> 24) >= 16) n = src2[i + 1];
      else if (y > 0 && (src2[i - W] >>> 24) >= 16) n = src2[i - W];
      else if (y < H - 1 && (src2[i + W] >>> 24) >= 16) n = src2[i + W];
      if (n) res[i] = o.outline(n);
    }
  }
  const c = makeCanvas(W, H);
  const g = ctxOf(c);
  const img = g.createImageData(W, H);
  new Uint32Array(img.data.buffer).set(res);
  g.putImageData(img, 0, 0);
  return c;
}

export function autoHi(c, o) {
  if (!c || 'hi' in c || !(c instanceof HTMLCanvasElement)) return c;
  return withHi(c, () => enhanceHi(c, o));
}

// ---------------------------------------------------------------- the UI layer
export function isHi(ctx) { return (ctx && ctx.__hi) || 0; }

const P2D = typeof CanvasRenderingContext2D !== 'undefined' ? CanvasRenderingContext2D.prototype : null;

function installHiCtx(ctx, R) {
  const draw = P2D.drawImage, setT = P2D.setTransform;
  ctx.__hi = R;
  ctx.drawImage = function (img, a, b, c, d, e, f, g, h) {
    const hi = img && img.hi;
    if (hi) {
      const n = arguments.length;
      if (n <= 3) return draw.call(this, hi, a, b, img.width, img.height);
      if (n <= 5) return draw.call(this, hi, a, b, c, d);
      const kx = hi.width / img.width, ky = hi.height / img.height;
      return draw.call(this, hi, a * kx, b * ky, c * kx, d * ky, e, f, g, h);
    }
    return draw.apply(this, arguments);
  };
  // numbers are logical (identity = the layer's scale); a DOMMatrix (from getTransform) passes through untouched
  ctx.setTransform = function (a, b, c, d, e, f) {
    if (arguments.length < 6 || typeof a === 'object') return setT.apply(this, arguments);
    return setT.call(this, a * R, b * R, c * R, d * R, e * R, f * R);
  };
  ctx.resetTransform = function () { return setT.call(this, R, 0, 0, R, 0, 0); };
}

export class UiLayer {
  constructor(screen, R = HI) {
    this.screen = screen;
    this.R = R;
    this.active = false;
    this.canvas = null;
    this.ctx = null;
    if (!P2D || typeof document === 'undefined') return;
    const c = document.createElement('canvas');
    c.id = 'uihi';
    c.setAttribute('aria-hidden', 'true');
    Object.assign(c.style, { position: 'fixed', left: '0', top: '0', pointerEvents: 'none', imageRendering: 'pixelated', zIndex: '2' });
    const host = screen.canvas;
    host.insertAdjacentElement('afterend', c);
    this.canvas = c;
    this.ctx = c.getContext('2d');
    installHiCtx(this.ctx, R);
    this.sync();
  }

  sync() {
    const s = this.screen, c = this.canvas;
    if (!c) return false;
    const on = s.scale >= 2;
    HI_ON.on = on;
    if (!on) { if (this.active) { c.style.display = 'none'; this.active = false; } return false; }
    const w = s.W * this.R, h = s.H * this.R;
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    const cs = s.canvas.style;
    if (c.style.width !== cs.width) c.style.width = cs.width;
    if (c.style.height !== cs.height) c.style.height = cs.height;
    if (!this.active) { c.style.display = ''; this.active = true; }
    return true;
  }

  // Start a frame: returns the context to draw UI into (the hi-res layer, or null when it is off)
  begin() {
    if (!this.sync()) return null;
    const g = this.ctx;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, this.screen.W, this.screen.H);
    g.logicalW = this.screen.W; g.logicalH = this.screen.H;
    return g;
  }

  clear() { if (this.active) this.begin(); }
}
