// Side-view pixel art for the five boat tiers (boatyard previews / thumbnails) and Barnaby the walrus
// shipwright. Procedural, deterministic, cached per (tier, scale).
//   boatSprite(tier, scale = 1) -> {canvas, ox, oy}   (ox, oy = centre of the hull at the waterline)
//   walrusSprite(frame) -> canvas                     frame: 0 idle, 1 blink, 2 talk

import { PixelBuffer, selOut } from '../gfx/pixel.js';
import { pack } from '../core/color.js';
import { bayer, clamp } from '../core/math.js';

const WOOD = ['#4a2414', '#7a3e22', '#a8643a', '#cc8a52', '#ecb878'];
const WHITE = ['#4a5068', '#8a94ac', '#c4ccdc', '#e8ecf4', '#ffffff'];
const RED = ['#4a1020', '#8a2030', '#c83a3a', '#ee6a52', '#ffa888'];
const NAVY = ['#0e1a3a', '#1a2e66', '#2a4a9a', '#4a74c8', '#8ab0f0'];
const ORANGE = ['#5a1a08', '#a03a10', '#e0601a', '#ff8a3a', '#ffc080'];
const GLASS = ['#0e1a2e', '#1a3a5a', '#2a6a9a', '#5aa8d8', '#bfeaff'];
const YELLOW = ['#6a4a08', '#b08010', '#e8b820', '#ffd84a', '#fff4a0'];
const STEEL = ['#2a2e40', '#4a5268', '#7a849c', '#aab4c8', '#dce4f0'];
const BROWN = ['#2e180e', '#5a321e', '#8a5636', '#b8805a', '#e0b08a'];
const GREENC = ['#0e3a1e', '#1a6a32', '#2a9a4a', '#5ac86a', '#a8f0a0'];

const pkc = new Map();
const pk = (c = '#000000') => { let v = pkc.get(c); if (v === undefined) pkc.set(c, (v = pack(c))); return v; };

function dith(t, cols, x, y) {
  t = clamp(t, 0, 1) * (cols.length - 1);
  const i = Math.floor(t);
  if (i >= cols.length - 1) return cols[cols.length - 1];
  const f = clamp((t - i - 0.5) * 2.4 + 0.5, 0, 1);
  return f > bayer(x, y) ? cols[i + 1] : cols[i];
}

// Drawing helpers in unit coordinates (scaled by s) on a PixelBuffer.
function U(b, s) {
  const R = (v) => Math.round(v * s);
  return {
    poly: (pts, c) => b.fillPoly(pts.map(([x, y]) => [x * s, y * s]), pk(c)),
    rect: (x, y, w, h, c) => b.rect(R(x), R(y), Math.max(1, R(x + w) - R(x)), Math.max(1, R(y + h) - R(y)), pk(c)),
    line: (x0, y0, x1, y1, c) => b.line(x0 * s, y0 * s, x1 * s, y1 * s, pk(c)),
    thick: (x0, y0, x1, y1, w, c) => {
      const dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy) || 1, nx = (-dy / L) * w * 0.5, ny = (dx / L) * w * 0.5;
      b.fillPoly([[(x0 + nx) * s, (y0 + ny) * s], [(x1 + nx) * s, (y1 + ny) * s], [(x1 - nx) * s, (y1 - ny) * s], [(x0 - nx) * s, (y0 - ny) * s]], pk(c));
      if (w * s < 1.5) b.line(x0 * s, y0 * s, x1 * s, y1 * s, pk(c));
    },
    circ: (x, y, r, c) => b.fillCircle(x * s, y * s, Math.max(0.7, r * s), pk(c)),
    ell: (x, y, rx, ry, c) => b.fillEllipse(x * s, y * s, Math.max(0.7, rx * s), Math.max(0.7, ry * s), pk(c)),
    px: (x, y, c) => b.set(R(x), R(y), pk(c)),
    s,
  };
}

function shadeInto(out, b, ramp, opts) {
  const { w, h, data } = b;
  let x0 = w, x1 = 0, y0 = h, y1 = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (data[y * w + x] >>> 24) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < x0) return;
  const s = opts.s;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (!(data[y * w + x] >>> 24)) continue;
      const ty = (y - y0) / Math.max(1, y1 - y0), tx = (x - x0) / Math.max(1, x1 - x0);
      const R = typeof ramp === 'function' ? ramp(x / s, y / s - (opts.dy || 0)) : ramp;
      let v = (opts.top ?? 0.84) - ty * (opts.span ?? 0.45) - tx * (opts.side ?? 0.1);
      if (!b.alpha(x, y - 1)) v += 0.16;
      else if (!b.alpha(x - 1, y)) v += 0.06;
      if (!b.alpha(x, y + 1)) v -= 0.14;
      out.data[y * out.w + x] = pk(dith(v, R, x, y));
    }
  }
}

// ---------------------------------------------------------------- the five boats (units: 172 x 100, waterline y=80)
const BOATS = [
  // 0 Rusty Dinghy
  (part, D) => {
    part(WOOD, (q) => q.poly([[54, 71], [120, 69], [113, 85], [62, 87]]), { top: 0.78, span: 0.5 });
    D.line(57, 76, 116, 74.5, WOOD[1]);
    D.line(59, 81, 114, 79.5, WOOD[1]);
    D.line(54, 71, 120, 69, WOOD[4]);
    D.rect(88, 76, 7, 4, '#b8823e');
    D.px(89, 77, '#3a2414'); D.px(93, 77, '#3a2414'); D.px(89, 79, '#3a2414'); D.px(93, 79, '#3a2414');
    part(STEEL, (q) => q.poly([[99, 62], [107, 62], [106, 69], [100, 69]]), { top: 0.8 });
    D.line(99, 62, 107, 62, STEEL[4]);
    part(WOOD, (q) => { q.thick(68, 60, 92, 92, 1.6, '#000'); q.ell(93, 93, 2.6, 5, '#000'); }, { top: 0.9, span: 0.3 });
    D.line(64, 70, 52, 38, '#3a2a20');
    D.line(52, 38, 44, 62, '#c8e0f0');
  },
  // 1 Fishing Boat
  (part, D) => {
    part((x, y) => (y < 73 ? WHITE : RED), (q) => q.poly([[38, 66], [124, 62], [134, 55], [124, 80], [48, 84], [38, 74]]), { top: 0.86, span: 0.5 });
    D.line(39, 71, 126, 67.5, NAVY[2]);
    D.line(39, 72, 125, 68.5, NAVY[1]);
    part(WHITE, (q) => q.rect(56, 44, 28, 20, '#000'), { top: 0.95, span: 0.35 });
    part(RED, (q) => q.rect(53, 40, 34, 5, '#000'), { top: 0.8, span: 0.3 });
    for (const x of [59, 67, 75]) { D.rect(x, 48, 5, 6, GLASS[2]); D.rect(x, 48, 5, 1, GLASS[4]); D.px(x, 49, GLASS[4]); }
    D.rect(80, 52, 3, 12, WHITE[1]);
    D.circ(70, 59, 3.4, RED[2]); D.circ(70, 59, 1.6, WHITE[3]); D.px(67, 59, '#ffffff'); D.px(73, 59, '#ffffff');
    D.line(98, 62, 98, 28, '#3a3448'); D.line(99, 62, 99, 28, '#5a5468');
    D.line(93, 34, 104, 34, '#3a3448');
    D.circ(98, 27, 1.3, '#ffd23a');
    D.line(110, 63, 138, 30, '#2a2a3a');
    D.line(116, 63, 148, 42, '#2a2a3a');
    D.line(138, 30, 140, 70, '#c8e0f0');
    D.line(148, 42, 150, 74, '#c8e0f0');
  },
  // 2 Trawler
  (part, D) => {
    part((x, y) => (y < 63 ? WHITE : y > 77 ? RED : NAVY), (q) => q.poly([[24, 60], [140, 56], [150, 47], [138, 82], [36, 86], [24, 72]]), { top: 0.8, span: 0.4 });
    for (const x of [48, 72, 96, 118]) { D.line(x, 66, x + 1, 74, ORANGE[1]); D.line(x + 3, 68, x + 3, 72, ORANGE[1]); }
    part(WHITE, (q) => q.rect(94, 30, 32, 27, '#000'), { top: 0.95, span: 0.35 });
    part(NAVY, (q) => q.rect(92, 26, 36, 5, '#000'), { top: 0.7 });
    for (const x of [98, 106, 114]) { D.rect(x, 34, 6, 7, GLASS[2]); D.rect(x, 34, 6, 2, GLASS[3]); }
    D.rect(120, 34, 3, 22, WHITE[1]);
    D.line(110, 26, 110, 6, '#3a3448'); D.line(111, 26, 111, 6, '#5a5468');
    part(STEEL, (q) => q.rect(102, 10, 18, 3, '#000'), { top: 0.8 });
    D.circ(110, 5, 1.6, '#ff4a3a');
    part(ORANGE, (q) => { q.thick(30, 60, 42, 22, 3, '#000'); q.thick(56, 60, 42, 22, 3, '#000'); q.thick(30, 30, 54, 30, 2, '#000'); }, { top: 0.9, span: 0.4 });
    for (let k = 0; k < 6; k++) { D.line(42, 24, 30 + k * 2.4, 58, '#d8c8a0'); }
    for (const y of [34, 42, 50]) D.line(36 - (y - 34) * 0.15, y, 46 + (y - 34) * 0.15, y, '#d8c8a0');
    D.circ(34, 56, 1.8, '#ff8a2a'); D.circ(40, 58, 1.8, '#ff8a2a'); D.circ(46, 57, 1.8, '#ff8a2a');
    part(STEEL, (q) => q.circ(70, 54, 4, '#000'), { top: 0.9 });
  },
  // 3 Luxury Yacht
  (part, D) => {
    part((x, y) => (y > 75 ? NAVY : WHITE), (q) => q.poly([[18, 62], [150, 57], [166, 52], [148, 74], [34, 80], [18, 70]]), { top: 0.95, span: 0.5 });
    D.poly([[20, 66], [152, 61], [160, 58], [151, 63], [22, 68.5]], NAVY[2]);
    part(WHITE, (q) => q.poly([[44, 61], [128, 58], [140, 48], [58, 47], [44, 53]]), { top: 1, span: 0.35 });
    D.poly([[56, 53], [130, 51.5], [136, 49.5], [60, 49.5]], GLASS[1]);
    D.line(60, 50, 134, 50, GLASS[3]);
    part(WHITE, (q) => q.poly([[66, 47], [118, 46], [126, 38], [74, 37]]), { top: 1, span: 0.3 });
    D.poly([[76, 42], [118, 41.5], [122, 39], [78, 39]], GLASS[1]);
    D.line(78, 39.5, 121, 39.5, GLASS[3]);
    part(WHITE, (q) => { q.thick(86, 37, 92, 26, 2, '#000'); q.thick(106, 37, 98, 26, 2, '#000'); q.thick(91, 26, 99, 26, 2, '#000'); }, { top: 0.95 });
    part(WHITE, (q) => q.circ(95, 21, 5, '#000'), { top: 1.05, span: 0.6, side: 0.4 });
    for (let x = 24; x < 140; x += 3) D.px(x, 58.5 - (x - 24) * 0.035, '#9aa4bc');
    part(GLASS, (q) => q.rect(28, 57, 10, 3, '#000'), { top: 0.95 });
    D.line(22, 64, 22, 44, '#3a3448');
    D.rect(23, 44, 7, 5, '#d83a3a'); D.rect(23, 46, 7, 1, '#ffffff');
  },
  // 4 Research Vessel
  (part, D) => {
    part((x, y) => (y < 67 ? WHITE : ORANGE), (q) => q.poly([[6, 58], [156, 52], [168, 44], [150, 84], [18, 88], [6, 70]]), { top: 0.9, span: 0.45 });
    D.poly([[8, 79], [152, 75], [151, 78], [10, 82]], NAVY[2]);
    part(WHITE, (q) => q.rect(88, 26, 54, 29, '#000'), { top: 1, span: 0.35 });
    part(WHITE, (q) => q.rect(98, 14, 34, 13, '#000'), { top: 1, span: 0.3 });
    D.rect(90, 30, 50, 5, GLASS[1]); D.line(90, 30, 139, 30, GLASS[3]);
    D.rect(100, 18, 30, 4, GLASS[1]); D.line(100, 18, 129, 18, GLASS[3]);
    for (const x of [94, 104, 114, 124, 134]) D.rect(x, 40, 4, 4, GLASS[2]);
    D.line(124, 14, 124, -2, '#3a3448');
    part(WHITE, (q) => q.circ(124, 3, 4.2, '#000'), { top: 1.05, span: 0.6, side: 0.4 });
    D.line(116, 8, 116, 0, '#3a3448'); D.line(132, 10, 134, 2, '#3a3448');
    part(NAVY, (q) => q.rect(54, 44, 26, 11, '#000'), { top: 0.8 });
    for (let x = 57; x < 80; x += 4) D.line(x, 45, x, 54, NAVY[1]);
    part(GREENC, (q) => q.rect(57, 35, 20, 9, '#000'), { top: 0.8 });
    part(ORANGE, (q) => q.rect(38, 36, 7, 18, '#000'), { top: 0.9 });
    part(YELLOW, (q) => q.thick(41, 37, 14, 10, 3, '#000'), { top: 0.95, span: 0.3 });
    D.line(14, 11, 14, 36, '#2a2a3a');
    part(YELLOW, (q) => { q.ell(14, 42, 8, 4.5, '#000'); q.rect(12, 36, 4, 3, '#000'); q.poly([[4, 40], [7, 42], [4, 45]], '#000'); }, { top: 0.95, span: 0.5 });
    D.circ(16, 42, 1.6, GLASS[2]); D.px(15, 41, GLASS[4]);
  },
];

const cache = new Map();

export function boatSprite(tier, scale = 1) {
  tier = clamp(tier | 0, 0, BOATS.length - 1);
  const key = tier + '|' + scale;
  let c = cache.get(key);
  if (c) return c;
  const s = scale;
  const W = Math.ceil(176 * s), H = Math.ceil(100 * s), oy = 4 * s;
  const out = new PixelBuffer(W, H);
  const part = (ramp, draw, opts = {}) => {
    const b = new PixelBuffer(W, H);
    draw(offset(U(b, s), oy));
    shadeInto(out, b, ramp, { ...opts, s, dy: oy / s });
  };
  BOATS[tier](part, offset(U(out, s), oy));
  out.outline(selOut(0.75));
  c = { canvas: out.toCanvas(), ox: Math.round(88 * s), oy: Math.round(80 * s + oy), w: W, h: H };
  cache.set(key, c);
  return c;
}

// Shift every y coordinate by a pixel margin so masts above y=0 still fit.
function offset(q, oy) {
  const s = q.s, dy = oy / s;
  return {
    s,
    poly: (pts, c) => q.poly(pts.map(([x, y]) => [x, y + dy]), c),
    rect: (x, y, w, h, c) => q.rect(x, y + dy, w, h, c),
    line: (x0, y0, x1, y1, c) => q.line(x0, y0 + dy, x1, y1 + dy, c),
    thick: (x0, y0, x1, y1, w, c) => q.thick(x0, y0 + dy, x1, y1 + dy, w, c),
    circ: (x, y, r, c) => q.circ(x, y + dy, r, c),
    ell: (x, y, rx, ry, c) => q.ell(x, y + dy, rx, ry, c),
    px: (x, y, c) => q.px(x, y + dy, c),
  };
}

// ---------------------------------------------------------------- Barnaby the walrus (captain's hat, tusks)
export function walrusSprite(frame = 0) {
  const key = 'walrus|' + frame;
  let c = cache.get(key);
  if (c) return c;
  const W = 44, H = 40, out = new PixelBuffer(W, H);
  const part = (ramp, draw, opts = {}) => {
    const b = new PixelBuffer(W, H);
    draw(U(b, 1));
    shadeInto(out, b, ramp, { ...opts, s: 1 });
  };
  const D = U(out, 1);
  const hy = frame === 2 ? -1 : 0;
  part(BROWN, (q) => { q.ell(21, 28, 16, 10, '#000'); q.ell(10, 36, 6, 2.6, '#000'); q.ell(30, 37, 6, 2.4, '#000'); }, { top: 0.8, span: 0.5 });
  part(BROWN, (q) => q.ell(23, 30, 9, 6, '#000'), { top: 0.95, span: 0.3 });
  part(BROWN, (q) => q.circ(28, 15 + hy, 9, '#000'), { top: 0.85, span: 0.45 });
  // muzzle + tusks
  part(['#7a5a40', '#b08868', '#d8b490', '#ecd0b0', '#fff0dc'], (q) => { q.circ(25, 19 + hy, 3.6, '#000'); q.circ(31, 19 + hy, 3.6, '#000'); }, { top: 0.9, span: 0.4 });
  for (const [x, y] of [[23, 19], [25, 21], [27, 19], [30, 20], [32, 19], [33, 21]]) D.px(x, y + hy, '#5a3a28');
  D.rect(28, 16 + hy, 2, 2, '#2a1810');
  const tl = frame === 2 ? 1 : 0;
  D.rect(25, 22 + hy, 2, 6 + tl, '#fffaf0'); D.px(25, 27 + hy + tl, '#d8d0c0');
  D.rect(31, 22 + hy, 2, 6 + tl, '#fffaf0'); D.px(32, 27 + hy + tl, '#d8d0c0');
  if (frame === 2) D.rect(27, 22 + hy, 4, 2, '#5a1a1a');
  // eyes
  if (frame === 1) { D.line(23, 12 + hy, 25, 12 + hy, '#1a1226'); D.line(31, 12 + hy, 33, 12 + hy, '#1a1226'); }
  else { D.rect(23, 11 + hy, 2, 2, '#1a1226'); D.rect(31, 11 + hy, 2, 2, '#1a1226'); D.px(23, 11 + hy, '#ffffff'); D.px(31, 11 + hy, '#ffffff'); }
  // captain's hat
  part(NAVY, (q) => q.poly([[20, 7 + hy], [36, 7 + hy], [34, 1 + hy], [22, 1 + hy]]), { top: 0.75 });
  D.rect(18, 7 + hy, 21, 2, '#141a30');
  D.rect(20, 6 + hy, 16, 1, '#f4f4f8');
  D.rect(27, 2 + hy, 3, 3, '#ffd23a'); D.px(27, 2 + hy, '#fff4a0');
  out.outline(selOut(0.75));
  c = out.toCanvas();
  cache.set(key, c);
  return c;
}
