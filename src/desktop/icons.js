// Desktop app icons: 32x32 procedural pixel art (light from top-left, selective outline,
// 1 px drop shadow) plus 14x14 "mini" versions used as bait dangling on a hook.
//   getAppIcon(icon, {size = 32, state, label, day}) -> cached canvas
//     state: 'full' (trash), 'chewed' (bite mark), 'shortcut' (arrow badge); combine with spaces/'+'.
//     label: overrides the coloured tag on file-type icons ('JPG'); day: calendar number.
//   getMiniIcon(icon, {state}) -> 14x14 canvas (no drop shadow)
//   getFileTypeIcon(ext) / fileTypeInfo(name, isDir) -> {icon, type, label, state}
//   App tiers (AppSea store): getAppIcon(icon, {tier}) or the id shorthand 'notes@3' adds a tier badge
//     (1 STD, 2 PRO, 3 ULTRA, 4 ENT; 0 = Lite, no badge); getMiniIcon('notes@3') adds a small tier pip.
//   APPS flags: system (always on the desktop), store (downloaded from AppSea), nobait (cannot go in the
//     bait box / be stolen), hidden (never a desktop icon; window title/icon lookup only).

import { makeCanvas, ctxOf } from '../core/canvas.js';
import { PixelBuffer } from '../gfx/pixel.js';
import { pack, unpack, shade, mix, rgbToHex } from '../core/color.js';
import { bayer, hash2, clamp } from '../core/math.js';

export const ICON_SIZE = 32;
export const MINI_SIZE = 14;

export const APPS = [
  { id: 'mycomputer', label: 'My Computer', type: 'computer', icon: 'computer', app: 'computer', system: true },
  { id: 'recycle', label: 'Recycle Bin', type: 'trash', icon: 'trash', app: 'trash', system: true },
  { id: 'appsea', label: 'AppSea', type: 'browser', icon: 'store', app: 'appsea', system: true, nobait: true },
  { id: 'fishnet', label: 'FishNet Explorer', type: 'browser', icon: 'browser', app: 'browser', store: true },
  { id: 'documents', label: 'Documents', type: 'folder', icon: 'documents', store: true },
  { id: 'photos', label: 'Photos', type: 'image', icon: 'image', store: true },
  { id: 'music', label: 'Music', type: 'music', icon: 'music', store: true },
  { id: 'games', label: 'Games', type: 'game', icon: 'game', store: true },
  { id: 'mail', label: 'Mail', type: 'mail', icon: 'mail', store: true },
  { id: 'notes', label: 'Notes.txt', type: 'docs', icon: 'notes', store: true },
  { id: 'terminal', label: 'Terminal', type: 'terminal', icon: 'terminal', store: true },
  { id: 'settings', label: 'Settings', type: 'settings', icon: 'settings', store: true },
  { id: 'calculator', label: 'Calculator', type: 'calc', icon: 'calc', app: 'calc', store: true },
  { id: 'calendar', label: 'Calendar', type: 'calendar', icon: 'calendar', store: true },
  { id: 'chat', label: 'Chat', type: 'chat', icon: 'chat', store: true },
  { id: 'paint', label: 'Paint', type: 'paint', icon: 'paint', store: true },
  { id: 'videos', label: 'Videos', type: 'video', icon: 'video', app: 'video', store: true },
  { id: 'fishtop', label: 'FISHTOP', type: 'game', icon: 'fishtop', store: true },
  { id: 'moreram', label: 'More RAM', type: 'computer', icon: 'ram', store: true },
  { id: 'notavirus', label: 'NotAVirus.exe', type: 'trash', icon: 'virus', store: true },
  { id: 'appsea_dl', label: 'Downloads', type: 'folder', icon: 'download', app: 'appsea_dl', hidden: true, nobait: true },
];

// ---------------------------------------------------------------- painter

const pkc = new Map();
function pk(c, a = 255) {
  if (typeof c === 'number') return c;
  const k = c + '|' + a;
  let v = pkc.get(k);
  if (v === undefined) pkc.set(k, (v = pack(c, a)));
  return v;
}

const INSETS = { 1: [1], 2: [2, 1], 3: [3, 1, 1], 4: [4, 2, 1, 1], 5: [5, 3, 2, 1, 1] };

// Ordered dither confined to a narrow band around each ramp step (flat areas stay clean).
function dith(t, cols, x, y) {
  t = clamp(t, 0, 1) * (cols.length - 1);
  const i = Math.floor(t);
  if (i >= cols.length - 1) return cols[cols.length - 1];
  const f = clamp((t - i - 0.5) * 2.4 + 0.5, 0, 1);
  return f > bayer(x, y) ? cols[i + 1] : cols[i];
}

class Painter {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.b = new PixelBuffer(w, h);
  }
  px(x, y, c, a) { if (c) this.b.set(x, y, pk(c, a)); }
  rect(x, y, w, h, c, a) { this.b.rect(x, y, w, h, pk(c, a)); }
  hl(x, y, n, c) { this.rect(x, y, n, 1, c); }
  vl(x, y, n, c) { this.rect(x, y, 1, n, c); }
  line(x0, y0, x1, y1, c) { this.b.line(x0, y0, x1, y1, pk(c)); }
  circ(cx, cy, r, c) { this.b.fillCircle(cx, cy, r, pk(c)); }
  ell(cx, cy, rx, ry, c) { this.b.fillEllipse(cx, cy, rx, ry, pk(c)); }
  poly(pts, c) { this.b.fillPoly(pts, pk(c)); }
  on(x, y) { return this.b.alpha(x, y) > 0; }
  rrect(x, y, w, h, c, r = 1) {
    const ins = INSETS[r] || [];
    for (let j = 0; j < h; j++) {
      const d = Math.min(j, h - 1 - j);
      const k = d < ins.length ? ins[d] : 0;
      this.rect(x + k, y + j, w - 2 * k, 1, c);
    }
  }
  each(x0, y0, w, h, fn) {
    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) {
        const c = fn(x, y);
        if (c) this.px(x, y, c);
      }
    }
  }
  paint(x0, y0, w, h, fn) { this.each(x0, y0, w, h, (x, y) => (this.on(x, y) ? fn(x, y) : null)); }
  vgrad(x, y, w, h, cols) { this.each(x, y, w, h, (i, j) => dith((j - y + 0.5) / h, cols, i, j)); }
  clearCirc(cx, cy, r) {
    for (let y = Math.floor(cy - r); y <= cy + r; y++) {
      for (let x = Math.floor(cx - r); x <= cx + r; x++) if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= r) this.b.set(x, y, 0);
    }
  }
  ascii(x, y, rows, pal) {
    rows.forEach((row, j) => {
      for (let i = 0; i < row.length; i++) if (pal[row[i]]) this.px(x + i, y + j, pal[row[i]]);
    });
  }
  // Thick segment. fn(t 0..1 along, s -1..1 across (+ = lit side), x, y) -> colour; w may be fn(t).
  stroke(x0, y0, x1, y1, w, fn) {
    const dx = x1 - x0, dy = y1 - y0, L2 = dx * dx + dy * dy, L = Math.sqrt(L2);
    const nx = -dy / L, ny = dx / L, lit = nx + ny > 0 ? -1 : 1;
    const wm = typeof w === 'function' ? 8 : w;
    for (let y = Math.floor(Math.min(y0, y1) - wm); y <= Math.max(y0, y1) + wm; y++) {
      for (let x = Math.floor(Math.min(x0, x1) - wm); x <= Math.max(x0, x1) + wm; x++) {
        const vx = x + 0.5 - x0, vy = y + 0.5 - y0;
        const t = (vx * dx + vy * dy) / L2;
        if (t < 0 || t > 1) continue;
        const hw = (typeof w === 'function' ? w(t) : w) / 2;
        const s = (vx * nx + vy * ny) / hw;
        if (Math.abs(s) > 1) continue;
        const c = fn(t, s * lit, x, y);
        if (c) this.px(x, y, c);
      }
    }
  }
  // Rotated ellipse; fn(u, v, x, y) with u along the major axis (+ = front), v across (+ = down at ang 0).
  rell(cx, cy, rx, ry, ang, fn) {
    const ca = Math.cos(ang), sa = Math.sin(ang), R = Math.max(rx, ry) + 1;
    for (let y = Math.floor(cy - R); y <= cy + R; y++) {
      for (let x = Math.floor(cx - R); x <= cx + R; x++) {
        const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
        const u = (dx * ca + dy * sa) / rx, v = (-dx * sa + dy * ca) / ry;
        if (u * u + v * v > 1) continue;
        const c = typeof fn === 'function' ? fn(u, v, x, y) : fn;
        if (c) this.px(x, y, c);
      }
    }
  }
  blit(o) {
    const s = o.b.data, d = this.b.data;
    for (let i = 0; i < s.length; i++) if (s[i] >>> 24) d[i] = s[i];
  }
}

// Selective outline: darkened, hue-shifted neighbour pulled toward a shared deep ink.
const OUT_INK = '#1a1226';
const outCache = new Map();
function outlineColor(n) {
  let c = outCache.get(n);
  if (c === undefined) {
    const [r, g, b] = unpack(n);
    const lum = (r * 0.3 + g * 0.59 + b * 0.11) / 255;
    c = pk(mix(shade(rgbToHex(r, g, b), -0.82), OUT_INK, 0.45 + Math.max(0, lum - 0.6) * 0.9));
    outCache.set(n, c);
  }
  return c;
}

// Draw a part on its own layer so it gets an outline separating it from what lies beneath.
function layer(p, draw) {
  const q = new Painter(p.w, p.h);
  draw(q);
  q.b.outline(outlineColor);
  p.blit(q);
}

// ---------------------------------------------------------------- shared bits

const BEIGE = ['#5a4a58', '#9a8676', '#cbb998', '#e4d6b6', '#f7efd8'];
const STEEL = ['#363a54', '#5c6a86', '#8a9eb6', '#b6c8d8', '#e2eef6'];
const OCEAN = ['#17306a', '#2552a0', '#3a84d0', '#64b4ee', '#b0e4ff'];
const LAND = ['#1a4e36', '#2a8044', '#4cb256', '#86d86a', '#c8f29a'];
const MANILA = ['#7a3e2a', '#c4702c', '#eaa13e', '#f8c75c', '#fde59a'];
const ORANGE = ['#7a2228', '#c8482a', '#ff8236', '#ffb45e', '#ffe2a6'];
const GOLD = ['#6e3a1a', '#b8702a', '#eeac3c', '#ffd86a', '#fff4b8'];
const LAV = ['#3a3058', '#675b92', '#a49ace', '#ccc4ea', '#f0ecff'];
const CREAM = ['#6a5040', '#bea078', '#e8d4aa', '#f5e7c6', '#fffaea'];
const LEGAL = ['#7a6a3a', '#d6b85e', '#f4e298', '#fcf1c0', '#fffbe4'];
const SLATE = ['#20263c', '#38425e', '#525f84', '#7584aa', '#a6b4d6'];
const WOOD = ['#5a2e1e', '#94562e', '#c88a52', '#e2b076', '#f6d8a4'];
const BRASS = ['#5a3418', '#9a5e24', '#d89a3a', '#f4c862', '#fff0b0'];
const SKYB = ['#1e3a7a', '#2f62b4', '#4a92e6', '#80c0ff', '#c4e6ff'];
const PAGE = ['#5a5c72', '#b4b8ca', '#e2e4ee', '#f6f6fa', '#ffffff'];

// 3x5 caps for little labels (subset of the small font)
const TINY = {
  A: '.#.|#.#|###|#.#|#.#', B: '##.|#.#|##.|#.#|##.', C: '.##|#..|#..|#..|.##', D: '##.|#.#|#.#|#.#|##.',
  E: '###|#..|##.|#..|###', F: '###|#..|##.|#..|#..', G: '.##|#..|#.#|#.#|.##', H: '#.#|#.#|###|#.#|#.#',
  I: '###|.#.|.#.|.#.|###', J: '..#|..#|..#|#.#|.#.', K: '#.#|#.#|##.|#.#|#.#', L: '#..|#..|#..|#..|###',
  M: '#...#|##.##|#.#.#|#...#|#...#', N: '#..#|##.#|#.##|#..#|#..#', O: '.#.|#.#|#.#|#.#|.#.', P: '##.|#.#|##.|#..|#..',
  Q: '.#.|#.#|#.#|##.|.##', R: '##.|#.#|##.|#.#|#.#', S: '.##|#..|.#.|..#|##.', T: '###|.#.|.#.|.#.|.#.',
  U: '#.#|#.#|#.#|#.#|###', V: '#.#|#.#|#.#|#.#|.#.', W: '#...#|#...#|#.#.#|#.#.#|.#.#.', X: '#.#|#.#|.#.|#.#|#.#',
  Y: '#.#|#.#|.#.|.#.|.#.', Z: '###|..#|.#.|#..|###',
  0: '###|#.#|#.#|#.#|###', 1: '.#.|##.|.#.|.#.|###', 2: '##.|..#|.#.|#..|###', 3: '##.|..#|.#.|..#|##.',
  4: '#.#|#.#|###|..#|..#', 5: '###|#..|##.|..#|##.', 6: '.##|#..|###|#.#|###', 7: '###|..#|.#.|.#.|.#.',
  8: '###|#.#|###|#.#|###', 9: '###|#.#|###|..#|##.', '.': '.|.|.|.|#', '-': '...|...|###|...|...',
  '+': '...|.#.|###|.#.|...',
};
function tinyWidth(s) {
  let w = 0;
  for (const ch of s) w += (TINY[ch] ? TINY[ch].split('|')[0].length : 3) + 1;
  return Math.max(0, w - 1);
}
function tinyText(p, s, x, y, c) {
  for (const ch of s) {
    const g = TINY[ch];
    if (!g) { x += 4; continue; }
    const rows = g.split('|');
    rows.forEach((r, j) => { for (let i = 0; i < r.length; i++) if (r[i] === '#') p.px(x + i, y + j, c); });
    x += rows[0].length + 1;
  }
}

// Bold 6x8 digits for the calendar page.
const BIG = {
  0: ['.####.', '##..##', '##..##', '##..##', '##..##', '##..##', '##..##', '.####.'],
  1: ['..##..', '.###..', '..##..', '..##..', '..##..', '..##..', '..##..', '.####.'],
  2: ['.####.', '##..##', '....##', '...##.', '..##..', '.##...', '##....', '######'],
  3: ['.####.', '##..##', '....##', '..###.', '....##', '....##', '##..##', '.####.'],
  4: ['...##.', '..###.', '.####.', '##.##.', '######', '...##.', '...##.', '...##.'],
  5: ['######', '##....', '##....', '#####.', '....##', '....##', '##..##', '.####.'],
  6: ['.####.', '##....', '##....', '#####.', '##..##', '##..##', '##..##', '.####.'],
  7: ['######', '....##', '...##.', '...##.', '..##..', '..##..', '.##...', '.##...'],
  8: ['.####.', '##..##', '##..##', '.####.', '##..##', '##..##', '##..##', '.####.'],
  9: ['.####.', '##..##', '##..##', '.#####', '....##', '....##', '...##.', '.###..'],
};

function bevelPaint(p, x, y, w, h, R, base = 0.5, edge = 0.28) {
  p.paint(x, y, w, h, (i, j) => {
    let v = base;
    if (!p.on(i, j - 1)) v += edge * 1.6;
    else if (!p.on(i - 1, j)) v += edge;
    if (!p.on(i, j + 1)) v -= edge * 1.4;
    else if (!p.on(i + 1, j)) v -= edge;
    return dith(v, R, i, j);
  });
}

function shadedFish(q, cx, cy, rx, ry, ang, F, { stripe = null, eye = 1 } = {}) {
  const ca = Math.cos(ang), sa = Math.sin(ang);
  const bx = cx - ca * rx * 0.82, by = cy - sa * rx * 0.82;
  const bk = (a, b) => [bx - ca * rx * a - sa * ry * b, by - sa * rx * a + ca * ry * b];
  q.poly([bk(-0.1, -0.35), bk(0.62, -1.15), bk(0.42, 0), bk(0.62, 1.15), bk(-0.1, 0.35)], F[1]);
  q.poly([bk(-0.05, -0.2), bk(0.5, -0.95), bk(0.3, 0)], F[2]);
  const fin = (a, b) => [cx + ca * rx * a - sa * ry * b, cy + sa * rx * a + ca * ry * b];
  q.poly([fin(-0.35, -0.7), fin(-0.05, -1.45), fin(0.25, -0.75)], F[1]);
  q.rell(cx, cy, rx, ry, ang, (u, v, x, y) => {
    if (stripe !== null && Math.abs(u - stripe) < 0.12 + 0.04 * Math.abs(v)) return v > 0.45 ? '#d9dceb' : '#ffffff';
    let l = 0.66 - 0.4 * v + 0.06 * u;
    if (v > 0.45 && u > -0.4) l = Math.max(l, 0.5);
    return dith(l, F, x, y);
  });
  const ex = Math.floor(cx + ca * rx * 0.52 + sa * ry * 0.28), ey = Math.floor(cy + sa * rx * 0.52 - ca * ry * 0.28);
  if (eye === 2) {
    q.rect(ex - 1, ey - 1, 3, 3, '#1a1226');
    q.px(ex - 1, ey - 1, '#ffffff');
    q.px(ex, ey - 1, '#cfe0ff');
  } else {
    q.rect(ex, ey, 2, 2, '#1a1226');
    q.px(ex, ey, '#ffffff');
  }
}

function paperBall(p, cx, cy, r, col) {
  const R = [shade(col, -0.5), shade(col, -0.25), col, shade(col, 0.45)];
  p.each(Math.floor(cx - r - 1), Math.floor(cy - r - 1), Math.ceil(2 * r + 3), Math.ceil(2 * r + 3), (x, y) => {
    const dx = x + 0.5 - cx, dy = y + 0.5 - cy, d = Math.hypot(dx, dy);
    if (d > r) return null;
    const lit = (-dx - dy) / (r * 1.414);
    const crease = hash2(x, y, 7) > 0.8;
    const i = lit > 0.3 ? 3 : lit > -0.3 ? 2 : 1;
    return R[Math.max(0, i - (crease ? 1 : 0))];
  });
  p.line(cx - r * 0.55, cy - r * 0.1, cx - r * 0.05, cy + r * 0.35, R[1]);
  p.line(cx - r * 0.05, cy + r * 0.35, cx + r * 0.4, cy - r * 0.3, R[1]);
}

function btn3(p, x, y, c) {
  p.px(x + 1, y, shade(c, 0.45));
  p.px(x, y + 1, c);
  p.px(x + 1, y + 1, c);
  p.px(x + 2, y + 1, shade(c, -0.35));
  p.px(x + 1, y + 2, shade(c, -0.35));
}

// ---------------------------------------------------------------- 32x32 icons

function drawComputer(p) {
  const B = BEIGE, mid = mix(B[2], B[1], 0.5);
  p.rrect(2, 2, 27, 20, B[2], 2);
  p.hl(4, 2, 23, B[4]);
  p.hl(3, 3, 25, B[3]);
  p.vl(2, 4, 16, B[3]);
  p.vl(28, 4, 16, B[1]);
  p.vl(27, 4, 16, mid);
  p.hl(3, 20, 25, mid);
  p.hl(4, 21, 23, B[1]);
  // bezel + aquarium screensaver
  p.rrect(4, 4, 23, 13, '#2a2638', 1);
  p.hl(5, 17, 21, B[3]);
  const scr = ['#a6f6e6', '#58cfcb', '#2f97b6', '#22679a', '#1b4c80'];
  p.each(5, 5, 21, 11, (x, y) => {
    const c = dith((y - 5) / 10.5, scr, x, y);
    return y % 2 ? c : mix(c, '#0c2236', 0.13);
  });
  p.hl(5, 15, 21, '#cdb46e');
  p.hl(7, 14, 4, '#cdb46e');
  p.hl(17, 14, 7, '#cdb46e');
  p.px(18, 14, '#e8d48c');
  p.px(8, 14, '#e8d48c');
  for (const [x, y] of [[22, 13], [23, 12], [22, 11], [23, 10], [22, 9], [8, 13], [7, 12], [8, 11]]) p.px(x, y, (x + y) % 2 ? '#3fbf6e' : '#2c905a');
  p.ascii(11, 8, ['.yoooo.o', 'okoooOoo', '.oOOOo.o'], { y: '#ffe2a0', o: '#ff8a3a', O: '#c8522a', k: '#1a1226' });
  p.px(9, 7, '#e8fffa');
  p.px(8, 5, '#c6f6f0');
  p.px(17, 6, '#c6f6f0');
  p.px(6, 6, '#eafffb');
  p.px(7, 6, '#c8f7ef');
  p.px(6, 7, '#c8f7ef');
  // chin: vents, power button, LED
  for (const x of [6, 9, 12]) p.hl(x, 19, 2, B[1]);
  p.px(21, 19, B[1]);
  p.px(22, 19, B[0]);
  p.px(25, 19, '#8cff86');
  p.px(24, 19, '#2e7a3a');
  p.px(25, 18, '#d8ffd0');
  // neck + base
  p.rect(12, 22, 7, 3, B[1]);
  p.hl(12, 22, 7, B[0]);
  p.vl(12, 23, 2, B[2]);
  p.rrect(7, 25, 17, 4, B[2], 1);
  p.hl(8, 25, 15, B[4]);
  p.hl(7, 27, 17, mid);
  p.hl(8, 28, 15, B[1]);
  p.hl(17, 26, 4, B[1]);
}

function drawTrash(p, st) {
  const M = STEEL;
  p.poly([[5, 9], [27, 9], [24.5, 30], [7.5, 30]], M[2]);
  const ribs = [0.2, 0.4, 0.6, 0.8];
  p.paint(0, 9, 32, 21, (x, y) => {
    const f = (y - 9) / 21, L = 5 + 2.5 * f, R = 27 - 2.5 * f, t = (x + 0.5 - L) / (R - L);
    let v = 0.86 - 2.1 * (t - 0.26) * (t - 0.26);
    if (y >= 12 && y <= 26) {
      for (const r of ribs) {
        const gx = Math.floor(L + r * (R - L));
        if (x === gx) v -= 0.3;
        else if (x === gx + 1) v += 0.14;
      }
    }
    if (y >= 28) v -= 0.18;
    if (y === 27) v += 0.12;
    return dith(v, M, x, y);
  });
  // recycling emblem
  p.ascii(12, 15, ['....e....', '...eGn...', '..eG.Gn..', '.eG...Gn.', 'eGGGGGGGn'], { e: '#c4f4a8', G: '#5cc060', n: '#2e7a44' });
  // rim + opening
  p.ell(16, 9, 12.6, 3.4, M[2]);
  p.ell(16, 8.6, 12.4, 3, M[3]);
  p.hl(7, 6, 6, M[4]);
  p.hl(5, 7, 3, M[4]);
  p.ell(16, 8.6, 10.6, 2, '#2c2d44');
  p.ell(16, 9.1, 9.6, 1.3, '#1f2034');
  if (st.has('full')) {
    // fish skeleton poking out behind the paper
    const bone = '#efe6d0', bs = '#bdb094';
    p.line(17, 8, 25, 2, bone);
    p.line(18, 8, 26, 2, bs);
    for (const [x, y] of [[19, 6], [21, 4.5], [23, 3]]) {
      p.line(x - 1, y - 1.5, x + 0.5, y + 1.5, bone);
    }
    p.poly([[24.5, 0.8], [29.5, 1.2], [27, 5]], bone);
    p.px(27, 2, '#3a3048');
    p.line(15, 7, 17, 9, bone);
    p.line(15, 10, 17, 8, bs);
    paperBall(p, 10, 6.6, 4.3, '#f6f1e2');
    paperBall(p, 19.5, 6.8, 3.7, '#e3ecf8');
    paperBall(p, 14, 3.9, 3.2, '#fffaf0');
  }
}

function drawBrowser(p) {
  const cx = 15.5, cy = 14.5, r = 12.6;
  const lands = [[10, 9, 5.2, 3.6], [12, 17.5, 3.2, 5.2], [21, 8.5, 4.2, 2.8], [22, 19.5, 3.4, 2.6], [17.5, 13, 2, 1.4], [6.5, 15, 1.6, 2.2]];
  const isLand = (x, y) => lands.some(([lx, ly, rx, ry]) => ((x + 0.5 - lx) / rx) ** 2 + ((y + 0.5 - ly) / ry) ** 2 <= 1);
  const lightAt = (x, y) => {
    const dx = (x + 0.5 - cx) / r, dy = (y + 0.5 - cy) / r, d2 = dx * dx + dy * dy;
    if (d2 > 1) return -1;
    const nz = Math.sqrt(1 - d2);
    let l = clamp(0.3 - 0.48 * dx - 0.55 * dy + 0.25 * nz, 0, 1);
    if (d2 > 0.8 && dx + dy > 0.55) l = Math.max(l, 0.36);
    return l;
  };
  p.each(0, 0, 32, 32, (x, y) => {
    const l = lightAt(x, y);
    if (l < 0) return null;
    if (isLand(x, y)) return dith(l, LAND, x, y);
    const shore = isLand(x - 1, y) || isLand(x + 1, y) || isLand(x, y - 1) || isLand(x, y + 1);
    return dith(Math.min(1, l + (shore ? 0.28 : 0)), OCEAN, x, y);
  });
  // fishing-net graticule
  const rope = (x, y) => {
    const l = lightAt(x, y);
    if (l < 0) return null;
    return l > 0.62 ? '#fff0c8' : l > 0.3 ? '#e2c890' : '#a88a5c';
  };
  const plot = (x, y) => p.px(x, y, rope(x, y));
  for (const lat of [-0.5, 0, 0.5]) {
    const w = Math.sqrt(1 - lat * lat);
    let prev = null;
    for (let x = Math.ceil(cx - r * w); x <= cx + r * w; x++) {
      const u = (x + 0.5 - cx) / (r * w);
      const y = Math.round(cy + lat * r + 1.6 * Math.sqrt(Math.max(0, 1 - u * u)) - 1.2);
      if (prev) bres(prev[0], prev[1], x, y, plot);
      prev = [x, y];
    }
  }
  for (const m of [-0.56, 0, 0.56]) {
    let prev = null;
    for (let y = Math.ceil(cy - r); y <= cy + r; y++) {
      const v = (y + 0.5 - cy) / r;
      const x = Math.round(cx - 0.5 + m * r * Math.sqrt(Math.max(0, 1 - v * v)));
      if (prev) bres(prev[0], prev[1], x, y, plot);
      prev = [x, y];
    }
  }
  p.px(9, 6, '#ffffff');
  p.px(10, 6, '#e8f8ff');
  p.px(8, 7, '#e8f8ff');
  // little fish swimming around the globe
  layer(p, (q) => shadedFish(q, 24.2, 24.2, 4.6, 2.9, -0.42, ORANGE, { stripe: 0.12 }));
}

function bres(x0, y0, x1, y1, fn) {
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    fn(x0, y0);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

function drawFolder(p, docs) {
  const F = MANILA;
  p.poly([[2, 4], [12, 4], [15.5, 8], [2, 8]], F[1]);
  p.hl(3, 4, 9, F[2]);
  p.rrect(2, 7, 27, 21, F[1], 1);
  p.hl(13, 7, 15, F[2]);
  p.vl(2, 8, 18, F[2]);
  if (docs) {
    p.rect(8, 8, 18, 12, '#cfdcee');
    p.hl(8, 8, 18, '#e8f0fa');
    p.vl(25, 9, 11, '#a8b8d0');
    p.rect(5, 10, 18, 10, '#fbf8ee');
    p.hl(5, 10, 18, '#ffffff');
    p.vl(22, 11, 9, '#d8d2c2');
    for (const [y, n] of [[12, 12], [14, 9], [16, 13]]) p.hl(7, y, n, '#9cb0c8');
    p.rect(19, 8, 2, 6, '#e8584a');
    p.px(19, 14, '#e8584a');
    p.px(20, 13, '#a83040');
  } else {
    p.rect(5, 9, 21, 9, '#fbf8ee');
    p.hl(5, 9, 21, '#ffffff');
    p.vl(25, 10, 8, '#d8d2c2');
    p.hl(8, 11, 12, '#b6c6d8');
    p.hl(8, 13, 9, '#b6c6d8');
  }
  p.poly([[1, 13], [30, 13], [28.6, 29], [2.4, 29]], F[2]);
  p.paint(0, 13, 32, 16, (x, y) => {
    if (y === 13) return F[4];
    if (y === 14) return F[3];
    if (y >= 27) return y === 28 ? F[0] : F[1];
    if (!p.on(x - 1, y)) return F[3];
    if (!p.on(x + 1, y)) return F[1];
    return dith(0.66 - 0.3 * (y - 15) / 12, F, x, y);
  });
  // stitched crease along the top of the flap
  for (let x = 3; x < 29; x += 3) p.px(x, 16, mix(F[2], F[1], 0.6));
  if (docs) {
    p.rrect(11, 19, 10, 6, '#fbf4e0', 1);
    p.hl(12, 19, 8, '#ffffff');
    p.hl(12, 24, 8, '#d8c8a0');
    p.hl(13, 21, 6, '#7a88aa');
    p.hl(13, 22, 4, '#7a88aa');
  }
}

function drawImage(p) {
  p.poly([[8, 1.5], [30, 5], [27, 27.5], [5, 24]], '#d9cfbe');
  p.poly([[10, 4], [27.5, 6.8], [25.6, 19], [8.4, 16.2]], '#7ea6c4');
  p.paint(0, 0, 32, 30, (x, y) => (x + y > 46 || y < 3 ? '#c4b9a6' : null));
  // front polaroid
  p.rect(2, 6, 23, 24, '#fbf8f0');
  p.vl(2, 7, 22, '#fffdf8');
  p.hl(2, 6, 23, '#ffffff');
  p.vl(24, 7, 23, '#d6cfbf');
  p.hl(3, 29, 21, '#d6cfbf');
  p.vgrad(4, 8, 19, 9, ['#86d2ff', '#a8e2ff', '#d0f0ff', '#ffe6bc']);
  p.circ(17.5, 12.5, 3.2, '#ffcf48');
  p.circ(17.1, 12.1, 2.1, '#fff0a0');
  p.hl(6, 10, 5, '#ffffff');
  p.hl(7, 9, 2, '#ffffff');
  p.hl(11, 11, 3, '#f0faff');
  p.vgrad(4, 17, 19, 7, ['#4ab4e0', '#3088c8', '#2462a8']);
  p.hl(4, 17, 19, '#86d6f4');
  for (const [x, y] of [[17, 18], [18, 19], [16, 20], [18, 21]]) p.px(x, y, '#ffe890');
  for (const [x, y, n] of [[5, 20, 2], [12, 21, 3], [20, 22, 2], [7, 23, 2]]) p.hl(x, y, n, '#9edcf8');
  p.ell(9.5, 17.6, 4.6, 1.8, '#ecd496');
  p.hl(6, 17, 7, '#f8e6b0');
  p.line(10, 17, 11, 12, '#8a5a34');
  p.line(11, 17, 12, 13, '#6a3e26');
  p.ascii(7, 10, ['..ggg..ggg', '.gGGGggGGg', 'gG..GGG..G', 'G....n....'], { g: '#7ad860', G: '#3a9a4a', n: '#8a5a34' });
  // tape
  p.rect(10, 4, 8, 4, '#f6e4a0', 210);
  p.hl(10, 4, 8, '#fff2c0', 210);
  p.px(10, 7, 0);
  p.px(17, 4, 0);
  // caption scribble
  p.hl(6, 26, 3, '#6a7ab0');
  p.hl(10, 26, 5, '#6a7ab0');
  p.px(9, 25, '#6a7ab0');
  p.hl(16, 26, 2, '#6a7ab0');
}

function drawMusic(p) {
  const cx = 13.5, cy = 17.5, r = 12;
  p.each(0, 0, 32, 32, (x, y) => {
    const dx = x + 0.5 - cx, dy = y + 0.5 - cy, d = Math.hypot(dx, dy);
    if (d > r) return null;
    if (d < 1) return '#120e1a';
    if (d < 4.2) {
      const lit = (-dx - dy) / (d * 1.414);
      return d > 3.4 ? '#a8303a' : lit > 0.3 ? '#ff8a6a' : '#e8584a';
    }
    const a = Math.atan2(dy, dx);
    let c = Math.floor(d * 1.3) % 2 ? '#29253a' : '#332e46';
    const s1 = Math.cos(a + 2.35), s2 = Math.cos(a - 0.8);
    if (d > 5.2 && d < r - 1) {
      if (s1 > 0.93) c = '#7a74a0';
      else if (s1 > 0.8) c = '#524c6e';
      else if (s2 > 0.93) c = '#48425e';
    }
    if (d > r - 1) c = s1 > 0.3 ? '#5a5478' : '#3a3550';
    return c;
  });
  p.px(12, 16, '#ffc0a0');
  layer(p, (q) => {
    const N = GOLD;
    q.poly([[19.5, 5.5], [29.5, 1.5], [29.5, 5.5], [19.5, 9.5]], N[3]);
    q.paint(19, 1, 11, 9, (x, y) => (!q.on(x, y - 1) ? N[4] : !q.on(x, y + 1) ? N[1] : N[3]));
    q.rect(19, 8, 2, 15, N[2]);
    q.vl(19, 8, 15, N[4]);
    q.rect(27, 4, 2, 15, N[2]);
    q.vl(27, 4, 15, N[4]);
    for (const [hx, hy] of [[17.2, 22.6], [25.2, 19.2]]) {
      q.rell(hx, hy, 3.6, 2.6, -0.4, (u, v, x, y) => dith(0.62 - 0.45 * v - 0.2 * u * 0, N, x, y));
      q.px(Math.floor(hx) - 2, Math.floor(hy) - 1, N[4]);
      q.px(Math.floor(hx) - 1, Math.floor(hy) - 1, N[4]);
    }
  });
}

function drawGame(p) {
  const G = LAV;
  p.rrect(2, 10, 28, 12, G[2], 3);
  p.circ(8, 21, 5.6, G[2]);
  p.circ(24, 21, 5.6, G[2]);
  p.paint(0, 9, 32, 20, (x, y) => {
    let i = y >= 21 ? 1 : 2;
    if (!p.on(x, y - 1)) i = 4;
    else if (!p.on(x, y - 2)) i = 3;
    if (!p.on(x, y + 1)) i = 0;
    else if (!p.on(x, y + 2)) i = 1;
    if (!p.on(x + 1, y) && i > 0) i -= 1;
    if (!p.on(x - 1, y) && i < 4 && y < 21) i += 1;
    return G[i];
  });
  p.rrect(4, 8, 7, 2, '#8a82a8', 1);
  p.rrect(21, 8, 7, 2, '#8a82a8', 1);
  p.hl(5, 8, 5, '#c8c0e0');
  p.hl(22, 8, 5, '#c8c0e0');
  // D-pad
  const D = '#2c2840', Dh = '#4c4670';
  p.rect(5, 14, 9, 3, D);
  p.rect(8, 11, 3, 9, D);
  p.hl(5, 14, 3, Dh);
  p.hl(8, 11, 3, Dh);
  p.hl(11, 14, 3, Dh);
  p.px(9, 15, '#1a1628');
  p.hl(5, 17, 3, G[3]);
  p.hl(11, 17, 3, G[3]);
  // face buttons
  btn3(p, 22, 11, '#ff5a5a');
  btn3(p, 25, 14, '#ffd23a');
  btn3(p, 22, 17, '#5ad06a');
  btn3(p, 19, 14, '#4aa0ff');
  p.hl(14, 18, 2, '#5a5078');
  p.hl(17, 18, 2, '#5a5078');
  p.px(15, 13, '#7cf0ff');
  p.px(16, 13, '#3aa0c0');
}

function drawMail(p) {
  const E = CREAM;
  p.rect(2, 7, 28, 19, E[2]);
  p.poly([[2, 7.5], [14, 17.5], [2, 26]], mix(E[2], E[1], 0.3));
  p.poly([[30, 7.5], [18, 17.5], [30, 26]], mix(E[2], E[1], 0.45));
  p.poly([[2, 26], [16, 15.5], [30, 26]], E[3]);
  p.line(2, 25, 15, 16, E[1]);
  p.line(29, 25, 17, 16, E[1]);
  p.hl(2, 25, 28, E[1]);
  p.vl(29, 7, 19, E[1]);
  p.vl(2, 8, 17, E[3]);
  p.poly([[2, 7], [30, 7], [16, 19.5]], E[4]);
  p.paint(2, 7, 28, 13, (x, y) => (y >= 15 ? E[3] : y === 7 ? '#ffffff' : null));
  p.line(2, 7, 15, 19, E[1]);
  p.line(29, 7, 16, 19, E[1]);
  p.line(3, 9, 15, 20, mix(E[2], E[1], 0.5));
  // wax seal
  p.circ(16, 18.6, 3.8, '#9a2234');
  p.circ(15.6, 18.1, 3.1, '#d83a3a');
  p.px(18, 22, '#9a2234');
  p.px(13, 21, '#9a2234');
  p.ascii(14, 17, ['R.R', 'RRR', '.R.'], { R: '#9a2234' });
  p.px(14, 16, '#ff9a86');
  p.px(13, 17, '#ff9a86');
  p.px(15, 16, '#ff7a6a');
}

function drawNotes(p) {
  const Y = LEGAL;
  p.rect(5, 6, 21, 24, Y[1]);
  p.rect(4, 5, 21, 24, Y[3]);
  p.vl(4, 5, 24, Y[4]);
  p.vl(24, 6, 23, Y[2]);
  p.hl(5, 28, 19, Y[2]);
  for (let y = 11; y <= 26; y += 3) p.hl(5, y, 19, '#a8c4e4');
  p.vl(8, 8, 20, '#f0a4a4');
  const ink = '#3c3c78';
  const words = [[[10, 4], [15, 5]], [[10, 6], [17, 3]], [[10, 3], [14, 5]], [[10, 5]], [[10, 4], [15, 3]]];
  words.forEach((ws, i) => {
    const y = 10 + i * 3;
    for (const [x, n] of ws) {
      for (let k = 0; k < n; k++) {
        const hsh = hash2(x + k, y, 3);
        p.px(x + k, hsh > 0.72 ? y - 1 : y, ink);
        if (hsh > 0.88) p.px(x + k, y, ink);
      }
    }
  });
  p.rect(4, 3, 21, 4, '#d8584a');
  p.hl(4, 3, 21, '#f48a78');
  p.hl(4, 6, 21, '#9a3040');
  for (const x of [6, 10, 14, 18, 22]) {
    p.rect(x, 1, 2, 4, '#d8dce6');
    p.px(x, 1, '#ffffff');
    p.vl(x + 1, 2, 3, '#8a90a8');
    p.hl(x, 5, 2, '#5a1e2c');
  }
  layer(p, (q) => q.stroke(29, 8.5, 17.5, 24, 3.6, (t, s) => {
    if (t < 0.11) return s > 0.3 ? '#ffc8cc' : s < -0.35 ? '#c86a7a' : '#f39aa6';
    if (t < 0.19) return s > 0.3 ? '#f4f6fa' : s < -0.35 ? '#8a90a8' : '#c8ccd8';
    if (t < 0.76) return s > 0.3 ? '#ffe88e' : s < -0.35 ? '#d08a2a' : '#f8c040';
    const k = (t - 0.76) / 0.24;
    if (Math.abs(s) > 1 - k * 0.9) return null;
    return k > 0.62 ? '#3a3448' : s > 0 ? '#f8dcb0' : '#d8a878';
  }));
}

function drawTerminal(p) {
  p.rrect(2, 3, 28, 25, '#3a405e', 2);
  p.paint(2, 3, 28, 5, (x, y) => dith((y - 3) / 5, ['#f2f5fa', '#cdd4e2', '#a4adc4'], x, y));
  p.hl(2, 8, 28, '#5a6280');
  for (const [x, c] of [[5, '#ff6a5a'], [8, '#ffc84a'], [11, '#6ad86a']]) {
    p.rect(x, 5, 2, 2, c);
    p.px(x, 5, shade(c, 0.5));
    p.px(x + 1, 6, shade(c, -0.35));
  }
  p.hl(16, 5, 9, '#8a92aa');
  p.hl(17, 6, 5, '#b4bcd0');
  p.each(3, 9, 26, 18, (x, y) => (y % 2 ? '#1a1e32' : '#1f2439'));
  p.hl(3, 9, 26, '#11131e');
  p.vl(3, 10, 17, '#151829');
  p.ascii(6, 12, ['gG...', '.gG..', '..gG.', '...gG', '..gG.', '.gG..', 'gG...'], { g: '#9affb0', G: '#3ad070' });
  p.rect(13, 17, 5, 2, '#9affb0');
  p.hl(13, 19, 5, '#2a6a4a');
  for (const [x, y, n] of [[6, 22, 3], [10, 22, 6], [17, 22, 2], [6, 24, 5], [12, 24, 3]]) p.hl(x, y, n, '#3e8a66');
  p.px(25, 10, '#3e4668');
  p.px(26, 10, '#3e4668');
  p.px(26, 11, '#343a58');
  p.vl(29, 9, 18, '#262a40');
  p.hl(4, 27, 24, '#262a40');
}

function gear(p, cx, cy, ro, ri, n, hole, R, rot = 0) {
  const S = Math.ceil(2 * ro + 3);
  p.each(Math.floor(cx - ro - 1), Math.floor(cy - ro - 1), S, S, (x, y) => {
    const dx = x + 0.5 - cx, dy = y + 0.5 - cy, d = Math.hypot(dx, dy);
    if (d < hole || d > ro) return null;
    const a = Math.atan2(dy, dx) + rot;
    const inTooth = Math.cos(n * a) > -0.2 + 0.6 * clamp((d - ri) / (ro - ri), 0, 1);
    if (d > ri && !inTooth) return null;
    const lit = d > 0.01 ? (-dx - dy) / (d * 1.414) : 0;
    let v;
    if (d > ri - 1.5) v = 0.55 + lit * 0.42;
    else if (d < hole + 1.3) v = 0.42 - lit * 0.32;
    else if (d < hole + 2.6) v = 0.66 + lit * 0.2;
    else v = 0.46 + ((-dx - dy) / (ri * 2.4)) * 0.3;
    if (Math.abs(d - (ri - 2.1)) < 0.5) v -= 0.22;
    return dith(v, R, x, y);
  });
}

function drawSettings(p) {
  gear(p, 22.5, 22.5, 7, 5.1, 7, 1.9, BRASS, 0.2);
  layer(p, (q) => gear(q, 13, 13, 11.3, 8.6, 8, 3.4, ['#363a54', '#5c6a86', '#92a4bc', '#c4d2e0', '#eef6fa'], 0.2));
}

function drawCalc(p) {
  const C = SLATE;
  p.rrect(5, 1, 22, 29, C[2], 2);
  p.hl(7, 1, 18, C[4]);
  p.hl(6, 2, 20, C[3]);
  p.vl(5, 3, 25, C[3]);
  p.vl(26, 3, 25, C[1]);
  p.hl(6, 28, 20, mix(C[2], C[1], 0.5));
  p.hl(7, 29, 18, C[1]);
  p.rrect(7, 3, 18, 8, '#232a26', 1);
  p.vgrad(8, 4, 16, 6, ['#d4f0a8', '#b0dc84', '#94c46c']);
  tinyText(p, '128', 23 - tinyWidth('128'), 5, '#2e4a26');
  p.px(9, 4, '#f0fcd8');
  p.px(10, 4, '#f0fcd8');
  p.px(9, 5, '#e4f8c8');
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      const col = c === 3 ? '#f59b3a' : r === 0 && c === 0 ? '#ff6a5a' : '#eceaf2';
      const x = 7 + c * 5, y = 13 + r * 4;
      p.rect(x, y, 4, 3, col);
      p.hl(x, y, 4, shade(col, 0.4));
      p.hl(x, y + 2, 4, shade(col, -0.32));
      p.hl(x, y + 3, 4, C[1]);
    }
  }
}

function drawCalendar(p, day) {
  p.rrect(2, 4, 28, 26, '#fbf8f2', 2);
  p.hl(4, 29, 24, '#cfc6b6');
  p.hl(3, 28, 26, '#e8e2d4');
  p.vl(29, 12, 16, '#e0d8ca');
  p.paint(2, 4, 28, 8, (x, y) => (y === 4 ? '#ff8a76' : y === 11 ? '#a02e3e' : y === 10 ? '#c23c44' : dith((y - 5) / 6, ['#f0604e', '#e2504a', '#d44446'], x, y)));
  tinyText(p, 'OCT', 16 - Math.ceil(tinyWidth('OCT') / 2), 6, '#fff4ea');
  for (const rx of [7, 23]) {
    p.hl(rx, 7, 2, '#5a1a28');
    p.rect(rx, 1, 2, 6, '#c8ccd8');
    p.vl(rx, 1, 5, '#f4f6fa');
    p.vl(rx + 1, 2, 5, '#7a8098');
  }
  const s = String(clamp(day | 0, 1, 31));
  const w = s.length * 7 - 1;
  let x = 16 - Math.ceil(w / 2);
  for (const ch of s) {
    BIG[ch].forEach((row, j) => {
      for (let i = 0; i < 6; i++) if (row[i] === '#') p.px(x + i, 14 + j, '#3a3048');
    });
    x += 7;
  }
  for (let i = 6; i <= 25; i += 3) p.px(i, 25, '#d0c8d8');
  p.px(12, 25, '#e2504a');
  // page curl
  for (let y = 24; y < 30; y++) for (let xx = 30 - (y - 23); xx < 30; xx++) p.b.set(xx, y, 0);
  p.poly([[23.5, 29.5], [29.5, 23.5], [24.5, 24.5]], '#e2dacb');
  p.line(24, 28, 28, 24, '#c8bfae');
}

function drawChat(p) {
  const B = SKYB;
  p.rrect(1, 3, 21, 15, B[2], 3);
  p.poly([[4, 16], [10, 16], [2.5, 22.5]], B[2]);
  bevelPaint(p, 0, 2, 23, 22, B, 0.52, 0.26);
  p.hl(5, 8, 10, '#e8f4ff');
  p.hl(5, 11, 7, '#e8f4ff');
  p.hl(13, 11, 3, '#e8f4ff');
  layer(p, (q) => {
    q.rrect(10, 12, 20, 14, '#fbfaf4', 3);
    q.poly([[22, 25], [27.5, 25], [29.5, 30]], '#fbfaf4');
    bevelPaint(q, 9, 11, 22, 20, ['#8a90a8', '#d2d8e6', '#f2f2f0', '#fbfaf4', '#ffffff'], 0.68, 0.22);
    for (const x of [14, 19, 24]) {
      q.rect(x, 18, 3, 3, '#5a6a8e');
      q.px(x, 18, '#8a9ac0');
      q.px(x + 2, 20, '#3a4668');
    }
  });
}

function drawPaint(p) {
  const W = WOOD;
  p.ell(14.5, 18, 13, 10, W[2]);
  p.clearCirc(8.6, 22.6, 2.3);
  p.clearCirc(28, 24, 4.4);
  p.paint(0, 7, 32, 23, (x, y) => {
    let v = 0.55 - 0.012 * (x - 14.5) - 0.018 * (y - 18);
    if (!p.on(x, y - 1) || !p.on(x - 1, y)) v += 0.3;
    if (!p.on(x, y + 1) || !p.on(x + 1, y)) v -= 0.3;
    if (Math.sin(y * 1.9 + x * 0.22 + Math.sin(x * 0.4)) > 0.92) v -= 0.14;
    return dith(v, W, x, y);
  });
  const dab = (cx, cy, c) => {
    p.circ(cx + 0.5, cy + 0.5, 2.5, shade(c, -0.35));
    p.circ(cx + 0.5, cy + 0.2, 2.1, c);
    p.px(cx - 1, cy - 1, shade(c, 0.55));
    p.px(cx, cy - 1, shade(c, 0.3));
  };
  dab(7, 15, '#e84a4a');
  dab(11, 11, '#ffcf3a');
  dab(17, 11, '#5ad06a');
  dab(22, 14, '#4a9ef0');
  dab(20, 21, '#b46ae8');
  layer(p, (q) => q.stroke(29.5, 1.5, 14, 19.5, (t) => (t < 0.66 ? 3.2 - t * 0.6 : t < 0.9 ? 3.6 : 3.6 - (t - 0.9) * 22), (t, s) => {
    if (t < 0.56) return s > 0.3 ? '#5ab4c4' : s < -0.35 ? '#1e4e5e' : '#2e7a8a';
    if (t < 0.67) return s > 0.3 ? '#ffffff' : s < -0.35 ? '#8a90a8' : '#d0d4e0';
    if (t < 0.88) return s > 0.3 ? '#c48a5a' : s < -0.35 ? '#5a3420' : '#8a5a3a';
    return s > 0.2 ? '#9ad0ff' : '#4a9ef0';
  }));
}

function drawVideo(p) {
  p.rrect(2, 13, 28, 16, '#363448', 2);
  bevelPaint(p, 2, 13, 28, 16, ['#1a1826', '#262436', '#363448', '#4a4862', '#626080'], 0.5, 0.25);
  p.hl(5, 18, 10, '#b8b6cc');
  p.hl(5, 21, 7, '#b8b6cc');
  p.hl(5, 24, 9, '#b8b6cc');
  p.vl(16, 16, 11, '#58567a');
  p.ascii(20, 17, ['h...', 'hw..', 'hww.', 'hwww', 'hwwg', 'hwg.', 'hg..'], { h: '#ffffff', w: '#e8e6f0', g: '#a8a6be' });
  p.each(2, 9, 28, 4, (x, y) => (Math.floor((x + (12 - y)) / 4) % 2 ? '#2a2838' : '#f4f0e8'));
  p.paint(2, 9, 28, 4, (x, y) => (Math.floor((x + (12 - y)) / 4) % 2 ? (y === 9 ? '#4a4862' : null) : y === 12 ? '#c8c2b4' : y === 9 ? '#ffffff' : null));
  layer(p, (q) => q.stroke(2, 8.6, 29.6, 1.6, 4.4, (t, s, x, y) => {
    const k = Math.floor((x + y * 0.4) / 4) % 2;
    const base = k ? ['#1e1c2a', '#2a2838', '#46445e'] : ['#c8c2b4', '#f4f0e8', '#ffffff'];
    return s > 0.45 ? base[2] : s < -0.45 ? base[0] : base[1];
  }));
  p.circ(3.6, 9.6, 1.9, '#c8ccd8');
  p.px(3, 9, '#ffffff');
  p.px(4, 10, '#7a8098');
}

function drawFishtop(p) {
  p.rrect(2, 2, 28, 28, '#000', 4);
  const sky = ['#ffdca0', '#ffecc6', '#c6f0f0', '#9ae4ec'];
  const sea = ['#56d2e0', '#3aa6d2', '#2878b8', '#204e92', '#1a3a78'];
  p.paint(2, 2, 28, 28, (x, y) => {
    if (y < 12) return dith((y - 2) / 10, sky, x, y);
    let t = (y - 12) / 17;
    if (y < 25 && ((x * 2 - y + 60) % 11) < 2) t -= 0.18;
    return dith(t, sea, x, y);
  });
  p.circ(22.5, 7, 3.6, '#ffe27a');
  p.circ(22.1, 6.6, 2.4, '#fff4c0');
  p.hl(5, 6, 5, '#ffffff');
  p.hl(6, 5, 3, '#ffffff');
  p.hl(11, 8, 3, '#fff8ea');
  for (let x = 2; x < 30; x++) {
    p.px(x, 12, x % 4 === 3 ? '#8fe6ee' : '#e8fffa');
    if (x % 4 === 1) p.px(x, 11, '#e8fffa');
  }
  p.paint(2, 26, 28, 4, (x, y) => (y >= 27 + (Math.sin(x * 0.8) > 0.2 ? 0 : 1) ? (y === 29 ? '#c8a868' : '#e8cf96') : null));
  for (const [x, y] of [[25, 26], [26, 25], [25, 24], [26, 23], [25, 22], [27, 26], [27, 25]]) p.px(x, y, (x + y) % 2 ? '#3fbf6e' : '#2c905a');
  for (const [x, y] of [[6, 22], [9, 25], [5, 18]]) {
    p.px(x, y - 1, '#d8fbff');
    p.px(x - 1, y, '#d8fbff');
    p.px(x + 1, y, '#a8eaf4');
    p.px(x, y + 1, '#a8eaf4');
  }
  // bobber
  p.vl(8, 2, 5, '#2a3048');
  layer(p, (q) => {
    q.vl(8, 7, 2, '#f4f0ea');
    q.circ(8.5, 11.8, 2.8, '#f4f0ea');
    q.paint(5, 9, 7, 3, (x, y) => (x < 8 && y < 11 ? '#ff8a76' : '#e0383a'));
    q.px(7, 13, '#c8c4cc');
    q.px(9, 13, '#c8c4cc');
    q.px(10, 12, '#c8c4cc');
  });
  // leaping fish
  layer(p, (q) => {
    shadedFish(q, 17, 19.5, 6.8, 4.6, Math.PI + 0.62, ORANGE, { stripe: 0.18, eye: 2 });
  });
  for (const [x, y] of [[11, 12], [12, 10], [24, 13], [25, 11]]) p.px(x, y, '#ffffff');
  bevelPaint(p, 2, 2, 1, 1, sky, 0.5, 0);
  p.paint(2, 2, 28, 28, (x, y) => {
    if (!p.on(x - 1, y) || !p.on(x, y - 1)) return y < 12 ? '#fff8e0' : '#8ae8f0';
    if (!p.on(x + 1, y) || !p.on(x, y + 1)) return y < 12 ? '#e0b880' : '#16306a';
    return null;
  });
}

// ---------------------------------------------------------------- AppSea-era icons

const AQUA = ['#123a6a', '#1f64a8', '#2f96d6', '#62c8f0', '#bff0ff'];
const NAVY = ['#141a40', '#24306a', '#3a4c94', '#6a82c8', '#b4c6f0'];
const PCB = ['#0c3324', '#17543a', '#23784e', '#3fa064', '#86d48e'];
const GERM = ['#1e4a2c', '#2f7a3a', '#4fb04a', '#8ade66', '#d4f8a0'];
const HULL = ['#5a1424', '#a02a34', '#d8483e', '#f47a5e', '#ffc0a0'];
const WHITE = ['#5a5c72', '#a4a8bc', '#d4d8e6', '#eef0f8', '#ffffff'];

function sparkle(p, x, y, big) {
  p.px(x, y, '#ffffff');
  p.px(x - 1, y, '#fff4b8');
  p.px(x + 1, y, '#fff4b8');
  p.px(x, y - 1, '#fff4b8');
  p.px(x, y + 1, '#fff4b8');
  if (big) {
    p.px(x - 2, y, '#ffd86a');
    p.px(x + 2, y, '#ffd86a');
    p.px(x, y - 2, '#ffd86a');
    p.px(x, y + 2, '#ffd86a');
  }
}

// Gold down-arrow (download) centred on cx; shaft from y0, tip at y1.
function dlArrow(q, cx, y0, y1, hw, sw, R = GOLD) {
  const hy = y1 - hw * 1.05;
  q.rect(Math.round(cx - sw / 2), y0, sw, Math.ceil(hy - y0) + 1, R[2]);
  q.poly([[cx - hw, hy], [cx + hw, hy], [cx, y1]], R[2]);
  bevelPaint(q, Math.floor(cx - hw - 1), y0 - 1, Math.ceil(hw * 2) + 3, y1 - y0 + 3, R, 0.58, 0.3);
}

function drawStore(p) {
  // rope handle behind the bag
  p.each(6, 1, 21, 13, (x, y) => {
    const dx = (x + 0.5 - 16) / 6.8, dy = (y + 0.5 - 12.5) / 9;
    const e = Math.hypot(dx, dy);
    if (y > 12 || e < 0.72 || e > 1) return null;
    const outer = (e - 0.72) / 0.28;
    return dith(0.4 + (outer > 0.55 ? 0.22 : -0.12) + (dx < 0 ? 0.16 : -0.08) + (dy < -0.8 ? 0.12 : 0), NAVY, x, y);
  });
  // bag body: front face + right gusset
  p.poly([[25.5, 12], [29, 14], [30, 29.5], [27.5, 30]], AQUA[1]);
  p.paint(25, 12, 6, 19, (x, y) => (p.on(x, y) ? dith(0.22 + (x === 29 ? -0.1 : 0.06) - (y - 12) * 0.006, AQUA, x, y) : null));
  p.poly([[5, 12], [26, 12], [27.5, 30], [3.5, 30]], AQUA[2]);
  const crest = (x) => 23.5 + Math.sin(x * 0.72 + 0.6) * 1.2;
  p.paint(3, 12, 25, 19, (x, y) => {
    if (x >= 26 && y < 30 && !p.on(x - 1, y)) return null;
    const cy = crest(x);
    if (y >= cy) {
      if (y < cy + 1) return '#e6fbff';
      return dith(0.36 - (y - cy) * 0.05 - (x - 4) * 0.004, AQUA, x, y);
    }
    let v = 0.72 - (y - 12) * 0.018 - (x - 4) * 0.012;
    if (y <= 14) v += 0.2;
    if (y === 15) v -= 0.18;
    if (x <= 5) v += 0.1;
    return dith(v, AQUA, x, y);
  });
  p.hl(5, 12, 21, '#e8faff');
  for (const gx of [10, 21]) {
    p.rect(gx, 13, 2, 2, '#0c1a3a');
    p.px(gx, 13, '#c8d4f0');
  }
  // download arrow on the front
  layer(p, (q) => dlArrow(q, 15.5, 15, 27, 6, 5));
  for (const [x, y] of [[9, 27], [22, 26], [6, 25]]) p.px(x, y, '#bff0ff');
  sparkle(p, 26, 5, true);
  sparkle(p, 4, 9, false);
}

function drawModem(p) {
  const B = BEIGE;
  // curly phone cord (behind)
  for (let i = 0; i <= 64; i++) {
    const t = i / 64;
    const bx = 8.5 - t * 6.5, by = 12 - t * 10.5;
    const ph = t * Math.PI * 10;
    const x = Math.round(bx + Math.cos(ph) * 1.5), y = Math.round(by + Math.sin(ph) * 0.9);
    if (!p.on(x, y) || Math.sin(ph) > 0) p.px(x, y, Math.sin(ph) > 0 ? '#2a2a3c' : Math.cos(ph) < -0.3 ? '#9a9ab4' : '#5c5c74');
  }
  // body: top face, front face, right side
  p.poly([[7, 11], [29.5, 11], [27.5, 16], [3, 16]], B[3]);
  p.rect(3, 16, 25, 8, B[2]);
  p.poly([[27.5, 16], [29.5, 11], [29.5, 19.5], [27.5, 24]], B[1]);
  p.paint(2, 10, 29, 15, (x, y) => {
    if (y < 16 && x < 28 + (16 - y) * 0.4) {
      let v = 0.7 - (y - 11) * 0.03;
      if (y === 11) v = 0.95;
      return dith(v, B, x, y);
    }
    if (y >= 16 && x <= 27) {
      let v = 0.52 - (y - 16) * 0.025;
      if (y === 16) v = 0.36;
      if (y === 23) v = 0.22;
      if (x === 3) v += 0.15;
      return dith(v, B, x, y);
    }
    return dith(0.24 - (y - 11) * 0.01, B, x, y);
  });
  // vents on top
  for (let i = 0; i < 5; i++) p.line(8 + i * 2.2, 15, 10 + i * 2.2, 12, B[1]);
  // LEDs
  const leds = [['#8cff86', '#2e7a3a'], ['#8cff86', '#2e7a3a'], ['#ffd23a', '#9a6a1a'], ['#ff6a5a', '#8a2a2a']];
  leds.forEach(([on, off], i) => {
    const x = 5 + i * 3;
    p.px(x, 19, on);
    p.px(x + 1, 19, off);
    p.px(x, 20, off);
    p.px(x + 1, 20, off);
  });
  tinyText(p, '56K', 17, 18, '#6a5a52');
  p.hl(17, 17, 11, B[3]);
  for (const x of [5, 6, 24, 25]) p.px(x, 24, '#3a2e3a');
  // screechy signal waves
  for (const [r, c] of [[3.2, '#ffffff'], [5.6, '#9ae8ff'], [8, '#62c8f0']]) {
    for (let a = -2.2; a <= -0.9; a += 0.12) {
      const x = Math.round(24 + Math.cos(a) * r), y = Math.round(9 + Math.sin(a) * r);
      if (!p.on(x, y)) p.px(x, y, c);
    }
  }
}

function drawRam(p) {
  const P = PCB;
  p.rect(2, 8, 28, 15, P[2]);
  p.clearCirc(2.2, 15.5, 1.8);
  p.clearCirc(29.8, 15.5, 1.8);
  bevelPaint(p, 1, 7, 30, 17, P, 0.5, 0.26);
  // copper traces
  for (const y of [18, 20]) for (let x = 4; x < 28; x += 3) p.px(x, y, P[3]);
  // memory chips
  for (const x of [4, 10, 17, 23]) {
    p.rect(x, 10, 5, 7, '#24242f');
    p.hl(x, 10, 5, '#54546a');
    p.vl(x, 11, 6, '#3a3a4a');
    p.hl(x, 16, 5, '#14141c');
    p.px(x + 1, 11, '#8a8aa0');
    for (let k = 0; k < 5; k += 2) { p.px(x + k, 9, '#c8ccd8'); p.px(x + k, 17, '#8a8ea0'); }
  }
  // sticker
  p.rect(7, 17, 19, 6, '#fbf8ee');
  p.hl(7, 17, 19, '#ffffff');
  p.hl(7, 22, 19, '#c8c0b0');
  tinyText(p, '+RAM', 9, 18, '#c8343a');
  // gold contacts
  for (let x = 3; x < 29; x += 2) {
    if (x === 15) continue;
    p.rect(x, 23, 1, 3, GOLD[3]);
    p.px(x, 23, GOLD[4]);
    p.px(x, 25, GOLD[1]);
  }
  sparkle(p, 27, 4, true);
  sparkle(p, 5, 4, false);
}

function drawGerm(p) {
  const G = GERM, cx = 16, cy = 17;
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + 0.25;
    const x = cx + Math.cos(a) * 11.6, y = cy + Math.sin(a) * 11;
    p.line(cx + Math.cos(a) * 8, cy + Math.sin(a) * 8, x, y, G[2]);
    p.line(cx + Math.cos(a) * 8 + 0.6, cy + Math.sin(a) * 8, x + 0.6, y, G[2]);
    p.circ(x, y, 1.9, G[2]);
  }
  p.circ(cx, cy, 9.6, G[2]);
  p.paint(0, 0, 32, 32, (x, y) => {
    const dx = x + 0.5 - cx, dy = y + 0.5 - cy, d = Math.hypot(dx, dy);
    let v = 0.56 - (dx + dy) / 26;
    if (d < 9.6) v += 0.12 * Math.sqrt(Math.max(0, 1 - (d / 9.6) ** 2));
    if (!p.on(x, y - 1)) v += 0.3;
    else if (!p.on(x - 1, y)) v += 0.15;
    if (!p.on(x, y + 1)) v -= 0.3;
    else if (!p.on(x + 1, y)) v -= 0.15;
    return dith(v, G, x, y);
  });
  // freckles
  for (const [x, y] of [[9, 21], [22, 22], [11, 10], [21, 9]]) p.px(x, y, G[1]);
  // disguise: brows, round glasses, eyes, nose, moustache
  const K = '#1a1226';
  for (const ex of [12, 20]) {
    p.each(ex - 3, 12, 7, 7, (x, y) => {
      const d = Math.hypot(x + 0.5 - (ex + 0.5), y + 0.5 - 15.5);
      if (d > 3.4) return null;
      if (d > 2.5) return K;
      return y < 15 ? '#ffffff' : '#dce8f4';
    });
    p.rect(ex + 1, 15, 2, 2, K);
    p.px(ex + 1, 15, '#5a5a7a');
  }
  p.hl(15, 14, 3, K);
  p.rect(8, 10, 6, 2, K);
  p.rect(18, 10, 6, 2, K);
  p.px(8, 12, K);
  p.px(23, 12, K);
  p.circ(16.5, 19.6, 2.5, '#ff8a9a');
  p.circ(16, 19, 1.4, '#ffc0c8');
  p.px(15, 18, '#ffffff');
  p.poly([[9.5, 22.5], [16.5, 21], [23.5, 22.5], [22, 24.5], [16.5, 23.2], [11, 24.5]], '#3a2418');
  p.hl(13, 22, 7, '#5a3a28');
  p.hl(14, 26, 5, G[0]);
  p.px(13, 25, G[0]);
  p.px(19, 25, G[0]);
}

function drawBoat(p) {
  // sea
  p.each(0, 24, 32, 8, (x, y) => {
    const crest = 25 + Math.round(Math.sin(x * 0.55) * 0.8);
    if (y < crest) return null;
    if (y === crest) return '#d8f6ff';
    return dith(0.62 - (y - crest) * 0.09, OCEAN, x, y);
  });
  // mast, flag, rod
  p.vl(21, 3, 16, '#5a3a2a');
  p.vl(22, 4, 15, '#3a2418');
  p.poly([[22, 3], [28, 5], [22, 7.5]], '#ffd23a');
  p.hl(23, 4, 3, '#fff4b0');
  p.line(25, 17, 31, 7, '#2a2a3a');
  p.line(31, 7, 31, 23, '#a8c8e0');
  // cabin
  layer(p, (q) => {
    q.rect(6, 11, 11, 9, WHITE[3]);
    q.rect(5, 9, 13, 3, HULL[2]);
    q.hl(5, 9, 13, HULL[3]);
    q.hl(5, 11, 13, HULL[1]);
    q.vl(6, 12, 8, WHITE[4]);
    q.vl(16, 12, 8, WHITE[1]);
    q.rect(8, 13, 3, 3, '#2a5aa0');
    q.rect(12, 13, 3, 3, '#2a5aa0');
    q.px(8, 13, '#9ae0ff');
    q.px(12, 13, '#9ae0ff');
  });
  // hull
  layer(p, (q) => {
    q.poly([[1.5, 18.5], [30.5, 17.5], [26.5, 27.5], [6, 27.5]], HULL[2]);
    q.paint(0, 17, 32, 12, (x, y) => {
      if (y <= 20) return y === 18 ? WHITE[4] : WHITE[3];
      if (y === 21) return '#2a64d0';
      let v = 0.55 - (y - 22) * 0.07 - (x - 16) * 0.008;
      return dith(v, HULL, x, y);
    });
    for (const x of [9, 14, 19, 24]) q.px(x, 19, WHITE[1]);
  });
  p.hl(4, 27, 24, '#9ae8ff');
}

function drawDownload(p) {
  const S = STEEL;
  // tray
  p.poly([[2, 18], [30, 18], [28, 29], [4, 29]], S[2]);
  p.paint(1, 17, 31, 13, (x, y) => {
    if (y <= 20 && x > 4 && x < 27) return y === 18 ? S[0] : '#2a3048';
    let v = 0.62 - (y - 18) * 0.03 - (x - 4) * 0.008;
    if (y === 18) v = 0.9;
    if (y === 28) v = 0.2;
    return dith(v, S, x, y);
  });
  p.rect(10, 23, 12, 2, S[1]);
  p.hl(10, 23, 12, S[0]);
  // arrow
  layer(p, (q) => dlArrow(q, 16, 2, 22, 7.5, 6, LAND));
  sparkle(p, 26, 6, false);
}

// File-type page icons: a dog-eared page with a glyph and a coloured tag.
const PAGE_KINDS = {
  file: { band: null },
  file_txt: { band: '#8a92a8', label: 'TXT', glyph: 'lines' },
  file_doc: { band: '#3a78d8', label: 'DOC', glyph: 'doc' },
  file_pdf: { band: '#e0443e', label: 'PDF', glyph: 'pdf' },
  file_sheet: { band: '#3aa860', label: 'XLS', glyph: 'sheet' },
  file_code: { band: '#8a5ae0', label: 'JS', glyph: 'code' },
  file_web: { band: '#f08a2a', label: 'HTML', glyph: 'web' },
  file_zip: { band: '#e8b830', label: 'ZIP', glyph: 'zip' },
  file_exe: { band: '#5a6480', label: 'EXE', glyph: 'exe' },
  file_audio: { band: '#e85a9a', label: 'MP3', glyph: 'audio' },
  file_video: { band: '#4a4268', label: 'MP4', glyph: 'video' },
  file_pic: { band: '#2aa8a8', label: 'PNG', glyph: 'pic' },
  file_cfg: { band: '#6a7a90', label: 'CFG', glyph: 'cfg' },
  file_disc: { band: '#7a6ab8', label: 'ISO', glyph: 'disc' },
};

function drawPage(p, kind, label) {
  const P = PAGE, info = PAGE_KINDS[kind] || PAGE_KINDS.file;
  p.poly([[6, 1], [20, 1], [27, 8], [27, 30], [6, 30]], P[3]);
  p.vl(6, 1, 29, P[4]);
  p.vl(26, 8, 22, P[1]);
  p.vl(25, 9, 20, mix(P[3], P[2], 0.6));
  p.hl(7, 29, 19, P[2]);
  p.poly([[20, 1], [20, 8.5], [27.5, 8.5]], P[2]);
  p.hl(20, 8, 7, P[1]);
  p.vl(20, 1, 7, P[3]);
  p.hl(21, 9, 5, mix(P[2], P[1], 0.5));
  const g = info.glyph;
  const ln = (y, a, b) => p.hl(a, y, b - a + 1, '#a8acc0');
  if (!info.band || g === 'lines') {
    for (let y = 5; y <= (info.band ? 15 : 27); y += 2) ln(y, 9, y < 9 ? 17 : (y * 7) % 5 === 0 ? 18 : 23);
  } else if (g === 'doc') {
    p.rect(9, 4, 9, 3, '#3a78d8');
    p.hl(9, 4, 9, '#7ab0ff');
    for (let y = 9; y <= 15; y += 2) ln(y, 9, y === 13 ? 19 : 23);
  } else if (g === 'pdf') {
    p.rect(9, 4, 7, 6, '#c8ccdc');
    p.ascii(10, 5, ['..r..', '.r.r.', 'rrrrr', '.....'], { r: '#e0443e' });
    for (const y of [5, 7, 9]) ln(y, 17, 18);
    ln(12, 9, 23);
    ln(14, 9, 20);
  } else if (g === 'sheet') {
    p.rect(9, 4, 15, 12, '#ffffff');
    p.rect(9, 4, 15, 3, '#c8ecd0');
    for (let x = 9; x <= 24; x += 5) p.vl(Math.min(x, 23), 4, 12, '#7ac08a');
    for (let y = 4; y <= 16; y += 3) p.hl(9, Math.min(y, 15), 15, '#7ac08a');
    p.b.set(23, 4, pk(P[3]));
  } else if (g === 'code') {
    const lt = ['...a', '..a.', '.a..', 'a...', '.a..', '..a.', '...a'];
    const sl = ['...a', '...a', '..a.', '..a.', '.a..', '.a..', 'a...'];
    const gt = lt.map((r) => r.split('').reverse().join(''));
    for (const [rows, x0] of [[lt, 8], [sl, 14], [gt, 20]]) p.ascii(x0, 9, rows, { a: '#7a4ad8' });
    p.hl(9, 5, 7, '#a8acc0');
  } else if (g === 'web') {
    p.circ(15.5, 10, 5.2, '#3a84d0');
    p.ell(13.5, 8.5, 2.6, 1.8, '#4cb256');
    p.ell(17.5, 12, 2, 1.6, '#4cb256');
    p.hl(11, 10, 10, '#b0e4ff');
    p.vl(15, 5, 10, '#b0e4ff');
    p.px(13, 6, '#ffffff');
  } else if (g === 'zip') {
    for (let y = 1; y < 18; y++) p.px(y % 2 ? 15 : 16, y, y % 2 ? '#6a7088' : '#b8bccc');
    p.rect(14, 13, 4, 5, '#c8ccd8');
    p.hl(14, 13, 4, '#ffffff');
    p.px(15, 15, '#5a5c72');
    p.px(16, 15, '#5a5c72');
  } else if (g === 'exe') {
    p.rect(9, 5, 15, 11, '#dfe3ec');
    p.rect(9, 5, 15, 3, '#3a6ad0');
    p.hl(9, 5, 15, '#7aa8ff');
    p.px(22, 6, '#ff6a5a');
    p.rect(11, 9, 4, 4, '#ffd23a');
    p.px(11, 9, '#fff2a0');
    p.hl(16, 10, 6, '#a8acc0');
    p.hl(16, 12, 4, '#a8acc0');
  } else if (g === 'audio') {
    p.ascii(10, 4, ['....pppppp', '....pPPPPp', '....p....p', '....p....p', '..ppp..ppp', '.pPPp.pPPp', '.pPp..pPp.'], { p: '#c83a7a', P: '#ff8ac0' });
  } else if (g === 'video') {
    p.rect(9, 4, 15, 12, '#3a3452');
    for (let x = 10; x < 24; x += 3) { p.px(x, 5, '#d8d4e8'); p.px(x, 14, '#d8d4e8'); }
    p.ascii(14, 7, ['h...', 'hw..', 'hww.', 'hw..', 'h...'], { h: '#ffffff', w: '#d8d4e8' });
  } else if (g === 'pic') {
    p.vgrad(9, 4, 15, 8, ['#8ad4ff', '#c8eeff']);
    p.circ(20, 7, 1.8, '#ffd84a');
    p.ell(12.5, 14, 5, 3.5, '#4cb256');
    p.ell(19.5, 14.5, 5, 2.8, '#2a8044');
    p.rect(9, 14, 15, 2, '#2a8044');
    for (let y = 16; y < 19; y++) p.hl(9, y, 15, P[3]);
  } else if (g === 'cfg') {
    gear(p, 15.5, 10, 5.4, 4, 7, 1.4, ['#363a54', '#5c6a86', '#92a4bc', '#c4d2e0', '#eef6fa']);
  } else if (g === 'disc') {
    p.circ(15.5, 10, 5.6, '#c8ccd8');
    p.paint(9, 4, 14, 13, (x, y) => {
      const a = Math.atan2(y + 0.5 - 10, x + 0.5 - 15.5);
      return ['#ffc0e0', '#c0e8ff', '#e0ffc8', '#fff0b0', '#d8d0ff', '#c8ccd8'][Math.floor((a + Math.PI) / (Math.PI / 3)) % 6];
    });
    p.circ(15.5, 10, 1.6, '#8a90a8');
    p.px(15, 9, '#ffffff');
    p.b.set(15, 10, 0);
  }
  if (info.band) {
    const text = (label || info.label).slice(0, 4).toUpperCase();
    const tw = tinyWidth(text), bw = Math.max(18, tw + 6);
    const bx = Math.min(4, 22 - bw);
    p.rrect(bx, 18, bw, 8, info.band, 1);
    p.hl(bx + 1, 18, bw - 2, shade(info.band, 0.45));
    p.hl(bx + 1, 25, bw - 2, shade(info.band, -0.35));
    p.vl(bx, 19, 6, shade(info.band, 0.2));
    p.vl(bx + bw, 19, 7, P[1]);
    tinyText(p, text, bx + Math.floor((bw - tw) / 2), 20, '#ffffff');
    p.hl(9, 27, 12, P[1]);
  }
}

// ---------------------------------------------------------------- 14x14 minis

function miniFolder(p, docs) {
  const F = MANILA;
  p.rect(1, 2, 5, 2, F[1]);
  p.rect(1, 3, 12, 9, F[1]);
  p.rect(3, 4, 8, 3, docs ? '#ffffff' : '#fbf8ee');
  if (docs) p.hl(4, 5, 5, '#8a9ac0');
  p.poly([[0.5, 6], [13.5, 6], [12.6, 12.6], [1.4, 12.6]], F[2]);
  p.hl(1, 6, 12, F[4]);
  p.hl(1, 7, 12, F[3]);
  p.hl(1, 12, 12, F[1]);
}

const MINI = {
  computer(p) {
    const B = BEIGE;
    p.rrect(1, 1, 12, 9, B[2], 1);
    p.hl(2, 1, 10, B[4]);
    p.vl(12, 2, 7, B[1]);
    p.rect(2, 2, 10, 6, '#2a2638');
    p.vgrad(3, 3, 8, 4, ['#8ef0e2', '#3fb4c4', '#2478a8']);
    p.hl(5, 4, 3, '#ff8a3a');
    p.px(8, 4, '#ff8a3a');
    p.px(5, 4, '#1a1226');
    p.px(3, 3, '#e8fffa');
    p.rect(5, 10, 4, 1, B[1]);
    p.rect(3, 11, 8, 2, B[2]);
    p.hl(3, 11, 8, B[3]);
  },
  trash(p, st) {
    const M = STEEL;
    p.poly([[2, 4], [12, 4], [11, 13], [3, 13]], M[2]);
    p.paint(1, 4, 12, 9, (x, y) => {
      const t = (x - 2.5) / 9;
      let v = 0.86 - 2.1 * (t - 0.26) * (t - 0.26);
      if (x === 5 || x === 9) v -= 0.3;
      return dith(v, M, x, y);
    });
    p.ell(7, 4, 6, 1.6, M[3]);
    p.ell(7, 3.9, 4.6, 0.9, '#2a2b40');
    if (st.has('full')) {
      paperBall(p, 5, 3.2, 2, '#f6f1e2');
      paperBall(p, 9.2, 3, 1.8, '#e3ecf8');
    }
  },
  browser(p) {
    p.each(0, 0, 14, 14, (x, y) => {
      const dx = (x + 0.5 - 7) / 5.8, dy = (y + 0.5 - 7) / 5.8, d2 = dx * dx + dy * dy;
      if (d2 > 1) return null;
      const l = clamp(0.3 - 0.48 * dx - 0.55 * dy + 0.25 * Math.sqrt(1 - d2), 0, 1);
      const land = ((x - 4.5) / 2.6) ** 2 + ((y - 5) / 1.8) ** 2 <= 1 || ((x - 9) / 1.8) ** 2 + ((y - 9) / 1.6) ** 2 <= 1;
      if (x === 7 || y === 7) return l > 0.4 ? '#fff0c8' : '#c8a878';
      return dith(l, land ? LAND : OCEAN, x, y);
    });
  },
  documents(p) { miniFolder(p, true); },
  folder(p) { miniFolder(p, false); },
  image(p) {
    p.rect(1, 2, 12, 11, '#fbf8f0');
    p.vl(12, 3, 10, '#d6cfbf');
    p.vgrad(2, 3, 10, 5, ['#86d2ff', '#d0f0ff']);
    p.rect(9, 4, 2, 2, '#ffd84a');
    p.rect(2, 8, 10, 2, '#3088c8');
    p.ell(5, 8.2, 2.4, 1.2, '#ecd496');
    p.hl(3, 11, 5, '#c8c0b0');
  },
  music(p) {
    const N = GOLD;
    p.rect(5, 2, 7, 2, N[3]);
    p.hl(5, 2, 7, N[4]);
    p.vl(5, 3, 7, N[2]);
    p.vl(11, 3, 6, N[2]);
    p.ell(3.6, 10.2, 2.2, 1.6, N[2]);
    p.ell(9.6, 9.2, 2.2, 1.6, N[2]);
    p.px(2, 9, N[4]);
    p.px(8, 8, N[4]);
  },
  game(p) {
    const G = LAV;
    p.rrect(1, 4, 12, 5, G[2], 1);
    p.circ(3.6, 9, 2.4, G[2]);
    p.circ(10.4, 9, 2.4, G[2]);
    bevelPaint(p, 0, 3, 14, 10, G, 0.55, 0.25);
    p.rect(2, 6, 3, 1, '#2c2840');
    p.rect(3, 5, 1, 3, '#2c2840');
    p.px(10, 5, '#ff5a5a');
    p.px(11, 6, '#ffd23a');
    p.px(9, 6, '#4aa0ff');
    p.px(10, 7, '#5ad06a');
  },
  mail(p) {
    const E = CREAM;
    p.rect(1, 3, 12, 8, E[2]);
    p.hl(1, 10, 12, E[1]);
    p.poly([[1, 3], [13, 3], [7, 8.5]], E[4]);
    p.line(1, 3, 6, 8, E[1]);
    p.line(12, 3, 7, 8, E[1]);
    p.rect(6, 7, 2, 2, '#d83a3a');
    p.px(6, 7, '#ff8a7a');
  },
  notes(p) {
    const Y = LEGAL;
    p.rect(2, 2, 10, 11, Y[3]);
    p.vl(11, 3, 10, Y[2]);
    p.rect(2, 2, 10, 2, '#d8584a');
    for (const y of [6, 8, 10]) p.hl(3, y, 8, '#8ab0d8');
    for (const x of [3, 6, 9]) p.px(x, 1, '#c8ccd8');
  },
  terminal(p) {
    p.rrect(1, 2, 12, 10, '#3a405e', 1);
    p.rect(1, 2, 12, 2, '#cdd4e2');
    p.px(2, 2, '#ff6a5a');
    p.rect(2, 4, 10, 7, '#1a1e32');
    p.ascii(3, 5, ['g.', '.g', 'g.'], { g: '#9affb0' });
    p.hl(6, 8, 3, '#9affb0');
  },
  settings(p) { gear(p, 7, 7, 5.9, 4.4, 7, 1.7, ['#363a54', '#5c6a86', '#92a4bc', '#c4d2e0', '#eef6fa'], 0.2); },
  calc(p) {
    const C = SLATE;
    p.rrect(3, 1, 8, 12, C[2], 1);
    p.vl(3, 2, 10, C[3]);
    p.vl(10, 2, 10, C[1]);
    p.rect(4, 2, 6, 3, '#b0dc84');
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) p.px(4 + c * 2, 6 + r * 2, c === 2 ? '#f59b3a' : '#eceaf2');
  },
  calendar(p) {
    p.rect(1, 2, 12, 11, '#fbf8f2');
    p.rect(1, 2, 12, 3, '#e2504a');
    p.hl(1, 2, 12, '#ff8a76');
    p.vl(12, 5, 8, '#d8d0c4');
    p.px(4, 1, '#c8ccd8');
    p.px(9, 1, '#c8ccd8');
    tinyText(p, '28', 4, 6, '#3a3048');
  },
  chat(p) {
    p.rrect(1, 2, 12, 8, SKYB[2], 2);
    p.poly([[3, 9], [6.5, 9], [2, 12.5]], SKYB[2]);
    bevelPaint(p, 0, 1, 14, 13, SKYB, 0.52, 0.26);
    for (const x of [4, 7, 10]) p.px(x - 1, 5, '#ffffff');
    p.hl(3, 5, 1, '#ffffff');
  },
  paint(p) {
    p.ell(7, 7.5, 6, 5, WOOD[2]);
    p.clearCirc(4.5, 9.8, 1.1);
    bevelPaint(p, 0, 2, 14, 11, WOOD, 0.55, 0.25);
    p.rect(3, 5, 2, 2, '#e84a4a');
    p.rect(6, 4, 2, 2, '#ffcf3a');
    p.rect(9, 5, 2, 2, '#4a9ef0');
    p.rect(9, 8, 2, 2, '#5ad06a');
  },
  video(p) {
    p.rect(1, 6, 12, 7, '#363448');
    p.hl(1, 6, 12, '#4a4862');
    p.each(1, 4, 12, 2, (x, y) => (Math.floor((x + 5 - y) / 2) % 2 ? '#2a2838' : '#f4f0e8'));
    p.each(1, 1, 12, 3, (x, y) => (y >= 3 - Math.floor(x / 5) && y <= 4 - Math.floor(x / 5) ? (Math.floor((x + y) / 2) % 2 ? '#2a2838' : '#f4f0e8') : null));
    p.hl(3, 9, 5, '#b8b6cc');
  },
  store(p) {
    p.each(4, 0, 7, 5, (x, y) => {
      const e = Math.hypot((x + 0.5 - 7.5) / 3, (y + 0.5 - 5) / 4);
      return e > 0.62 && e <= 1 && y < 5 ? NAVY[2] : null;
    });
    p.poly([[2, 5], [12, 5], [13, 13], [1, 13]], AQUA[2]);
    p.paint(1, 5, 13, 9, (x, y) => (y >= 11 ? (y === 11 ? '#e6fbff' : AQUA[1]) : y === 5 ? AQUA[4] : x < 4 ? AQUA[3] : AQUA[2]));
    p.rect(6, 6, 3, 3, GOLD[3]);
    p.poly([[4, 8.5], [11, 8.5], [7.5, 12.5]], GOLD[3]);
    p.hl(6, 6, 3, GOLD[4]);
    p.px(12, 1, '#ffffff');
  },
  isp(p) {
    const B = BEIGE;
    p.poly([[3, 5], [13, 5], [12, 8], [1, 8]], B[3]);
    p.rect(1, 8, 11, 4, B[2]);
    p.poly([[12, 8], [13, 5], [13, 10], [12, 12]], B[1]);
    p.hl(3, 5, 10, B[4]);
    p.hl(1, 11, 11, B[1]);
    p.px(3, 9, '#8cff86');
    p.px(5, 9, '#8cff86');
    p.px(7, 9, '#ffd23a');
    for (const [x, y] of [[3, 3], [2, 2], [1, 1]]) p.px(x, y, '#3a3a4c');
    for (const [x, y] of [[9, 2], [10, 1], [11, 2]]) p.px(x, y, '#9ae8ff');
  },
  ram(p) {
    p.rect(0, 3, 14, 7, PCB[2]);
    p.hl(0, 3, 14, PCB[4]);
    p.hl(0, 9, 14, PCB[1]);
    for (const x of [1, 5, 9]) { p.rect(x, 4, 3, 3, '#24242f'); p.px(x, 4, '#54546a'); }
    p.hl(2, 8, 10, '#fbf8ee');
    for (let x = 1; x < 14; x += 2) if (x !== 7) p.rect(x, 10, 1, 2, GOLD[3]);
    p.px(12, 1, '#ffffff');
  },
  virus(p) {
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + 0.3;
      p.circ(7 + Math.cos(a) * 5.8, 7 + Math.sin(a) * 5.8, 1.1, GERM[2]);
    }
    p.circ(7, 7, 4.9, GERM[2]);
    bevelPaint(p, 0, 0, 14, 14, GERM, 0.55, 0.26);
    p.rect(3, 5, 3, 2, '#1a1226');
    p.rect(8, 5, 3, 2, '#1a1226');
    p.px(4, 6, '#ffffff');
    p.px(9, 6, '#ffffff');
    p.rect(6, 7, 2, 2, '#ff8a9a');
    p.hl(4, 9, 6, '#3a2418');
  },
  download(p) {
    p.poly([[1, 8], [13, 8], [12, 13], [2, 13]], STEEL[2]);
    p.hl(1, 8, 12, STEEL[4]);
    p.rect(3, 8, 8, 2, '#2a3048');
    p.hl(2, 12, 10, STEEL[1]);
    p.rect(5, 1, 4, 5, LAND[3]);
    p.poly([[2.5, 5.5], [11.5, 5.5], [7, 10.5]], LAND[3]);
    p.vl(5, 1, 5, LAND[4]);
    p.vl(8, 1, 5, LAND[1]);
  },
  boat(p) {
    p.vl(8, 1, 7, '#5a3a2a');
    p.poly([[9, 1], [12, 2.5], [9, 4]], '#ffd23a');
    p.rect(2, 5, 5, 3, WHITE[3]);
    p.hl(1, 4, 7, HULL[2]);
    p.px(3, 6, '#2a5aa0');
    p.px(5, 6, '#2a5aa0');
    p.poly([[0, 8], [14, 7.5], [12, 12], [2.5, 12]], HULL[2]);
    p.hl(0, 8, 14, WHITE[4]);
    p.hl(1, 9, 13, '#2a64d0');
    p.each(0, 12, 14, 2, (x, y) => (y === 12 ? (x % 4 === 1 ? '#d8f6ff' : OCEAN[3]) : OCEAN[2]));
  },
  fishtop(p) {
    p.rrect(1, 1, 12, 12, '#000', 2);
    p.paint(1, 1, 12, 12, (x, y) => (y < 5 ? dith((y - 1) / 4, ['#ffe2a8', '#c6f0f0'], x, y) : dith((y - 5) / 7, ['#56d2e0', '#2878b8', '#1e4c8c'], x, y)));
    p.hl(1, 5, 12, '#e8fffa');
    p.px(10, 2, '#ffe27a');
    shadedFish(p, 7.2, 8.6, 3.4, 2.4, Math.PI + 0.5, ORANGE, { stripe: 0.2 });
  },
};

function miniPage(p, kind) {
  const info = PAGE_KINDS[kind] || PAGE_KINDS.file;
  p.poly([[3, 1], [8.5, 1], [11, 3.5], [11, 13], [3, 13]], PAGE[3]);
  p.vl(10, 4, 9, PAGE[1]);
  p.poly([[8.5, 1], [8.5, 3.6], [11.1, 3.6]], PAGE[2]);
  if (info.band) {
    p.rect(2, 7, 8, 4, info.band);
    p.hl(2, 7, 8, shade(info.band, 0.4));
    p.hl(3, 9, 5, '#ffffff');
  } else {
    for (const y of [5, 7, 9, 11]) p.hl(4, y, 5, '#a8acc0');
  }
}

// ---------------------------------------------------------------- states & assembly

function parseState(state) {
  const s = new Set();
  if (!state) return s;
  for (const k of (Array.isArray(state) ? state : String(state).split(/[\s+,]+/))) if (k) s.add(k);
  return s;
}

// Scalloped bite out of the top-right of the silhouette; returns crumb positions.
function applyBite(p, scale) {
  const { w, h } = p;
  let bx = -1, by = -1, best = -1e9;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (p.b.alpha(x, y) > 100) {
      const v = x - y * 1.15;
      if (v > best) { best = v; bx = x; by = y; }
    }
  }
  if (bx < 0) return [];
  const cx = bx + 0.8, cy = by + 0.2, R = 6.2 * scale;
  const circles = [[cx, cy, R * 0.74]];
  for (let k = 0; k < 4; k++) {
    const a = Math.PI * (0.47 + k * 0.2);
    circles.push([cx + Math.cos(a) * R * 0.74, cy + Math.sin(a) * R * 0.74, R * 0.3]);
  }
  const inBite = (x, y) => circles.some(([ox, oy, r]) => Math.hypot(x + 0.5 - ox, y + 0.5 - oy) <= r);
  const edge = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (inBite(x, y)) p.b.set(x, y, 0);
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (p.b.alpha(x, y) && (inBite(x - 1, y) || inBite(x, y + 1) || inBite(x + 1, y) || inBite(x, y - 1))) edge.push([x, y]);
  }
  for (const [x, y] of edge) {
    const [r, g, b] = unpack(p.b.get(x, y));
    p.px(x, y, mix(rgbToHex(r, g, b), '#3a2030', 0.35));
  }
  const crumbs = [];
  if (scale > 0.6) {
    crumbs.push([Math.round(cx + R * 0.2), Math.round(cy + R * 1.25)]);
    crumbs.push([Math.round(cx - R * 0.9), Math.round(cy - R * 0.25)]);
  }
  return crumbs.filter(([x, y]) => x >= 0 && y >= 0 && x < w && y < h && !p.on(x, y));
}

function finish(p, { shadow = true, crumbs = [] } = {}) {
  p.b.outline(outlineColor);
  if (shadow) {
    const { w, h, data } = p.b;
    const src = data.slice(), sh = pk('#06121c', 84);
    for (let y = 1; y < h; y++) for (let x = 1; x < w; x++) {
      const i = y * w + x;
      if (!(src[i] >>> 24) && src[i - w - 1] >>> 24 > 120) data[i] = sh;
    }
  }
  for (const [x, y] of crumbs) if (!p.on(x, y)) p.px(x, y, '#d8c49a');
}

function shortcutBadge(p) {
  p.ascii(0, 22, [
    'kkkkkkkkk',
    'khhhhhhwk',
    'khhbbbbwk',
    'khhhhbbwk',
    'khhhbhbwk',
    'khhbbhhwk',
    'khbbhhhwk',
    'khwwwwwwk',
    'kkkkkkkkk',
  ], { k: '#1a1226', h: '#ffffff', w: '#c8d0e0', b: '#2a6ad8' });
}

// Tier badges (AppSea app tiers). 0 = Lite (no badge).
export const TIER_BADGES = [null, { text: 'STD', color: '#2c9c5c', ink: '#ffffff' }, { text: 'PRO', color: '#2a64d0', ink: '#ffffff' }, { text: 'ULTRA', color: '#8a34d0', ink: '#ffffff' }, { text: 'ENT', color: '#e8a62a', ink: '#3a1e06' }];

function tierBadge(p, tier) {
  const b = TIER_BADGES[tier];
  if (!b) return;
  const w = tinyWidth(b.text) + 4, h = 8, x = p.w - w, y = p.h - h;
  p.rect(x, y, w, h, '#1a1226');
  p.rect(x + 1, y + 1, w - 2, h - 2, b.color);
  p.hl(x + 1, y + 1, w - 2, shade(b.color, 0.4));
  p.vl(x + w - 2, y + 2, h - 3, shade(b.color, -0.25));
  tinyText(p, b.text, x + 2, y + 2, b.ink);
}

function tierPip(p, tier) {
  const b = TIER_BADGES[tier];
  if (!b) return;
  p.rect(10, 10, 4, 4, '#1a1226');
  p.rect(11, 11, 2, 2, b.color);
  p.px(11, 11, shade(b.color, 0.5));
}

function splitTier(icon, opts) {
  const m = /^(.+)@(\d)$/.exec(icon);
  if (m) return [m[1], Number(m[2])];
  return [icon, Number(opts.tier) || 0];
}

function render(icon, st, opts) {
  const p = new Painter(32, 32);
  if (icon.startsWith('file')) drawPage(p, icon, opts.label);
  else {
    switch (icon) {
      case 'computer': drawComputer(p); break;
      case 'trash': drawTrash(p, st); break;
      case 'browser': drawBrowser(p); break;
      case 'folder': drawFolder(p, false); break;
      case 'documents': drawFolder(p, true); break;
      case 'image': drawImage(p); break;
      case 'music': drawMusic(p); break;
      case 'game': drawGame(p); break;
      case 'mail': drawMail(p); break;
      case 'notes': drawNotes(p); break;
      case 'terminal': drawTerminal(p); break;
      case 'settings': drawSettings(p); break;
      case 'calc': drawCalc(p); break;
      case 'calendar': drawCalendar(p, opts.day || 28); break;
      case 'chat': drawChat(p); break;
      case 'paint': drawPaint(p); break;
      case 'video': drawVideo(p); break;
      case 'fishtop': drawFishtop(p); break;
      case 'store': drawStore(p); break;
      case 'isp': drawModem(p); break;
      case 'ram': drawRam(p); break;
      case 'virus': drawGerm(p); break;
      case 'boat': drawBoat(p); break;
      case 'download': drawDownload(p); break;
      default: drawPage(p, 'file');
    }
  }
  const crumbs = st.has('chewed') ? applyBite(p, 1) : [];
  finish(p, { crumbs });
  if (st.has('shortcut')) shortcutBadge(p);
  if (opts.tier) tierBadge(p, opts.tier);
  return p.b.toCanvas();
}

function renderMini(icon, st, tier) {
  const p = new Painter(14, 14);
  if (icon.startsWith('file')) miniPage(p, icon);
  else (MINI[icon] || ((q) => miniPage(q, 'file')))(p, st);
  const crumbs = st.has('chewed') ? applyBite(p, 0.5) : [];
  finish(p, { shadow: false, crumbs });
  if (tier) tierPip(p, tier);
  return p.b.toCanvas();
}

const cache = new Map();

export function getAppIcon(icon, opts = {}) {
  const size = opts.size || 32;
  const [base, tier] = splitTier(String(icon), opts);
  if (base !== icon || tier !== (Number(opts.tier) || 0)) return getAppIcon(base, { ...opts, tier });
  const st = parseState(opts.state);
  const key = icon + '|' + size + '|' + [...st].sort().join(',') + '|' + (opts.label || '') + '|' + (opts.day || '') + '|' + tier;
  let c = cache.get(key);
  if (c) return c;
  if (size <= MINI_SIZE + 2) {
    const m = getMiniIcon(icon, { state: opts.state, tier: opts.tier });
    if (size === MINI_SIZE) c = m;
    else {
      c = makeCanvas(size, size);
      ctxOf(c).drawImage(m, Math.floor((size - MINI_SIZE) / 2), Math.floor((size - MINI_SIZE) / 2));
    }
  } else if (size === 32) {
    c = render(icon, st, opts);
  } else {
    const base = getAppIcon(icon, { ...opts, size: 32 });
    c = makeCanvas(size, size);
    const g = ctxOf(c);
    if (size > 32) {
      const k = Math.floor(size / 32), o = Math.floor((size - 32 * k) / 2);
      g.drawImage(base, o, o, 32 * k, 32 * k);
    } else g.drawImage(base, 0, 0, size, size);
  }
  cache.set(key, c);
  return c;
}

export function getMiniIcon(icon, opts = {}) {
  const [base, tier] = splitTier(String(icon), opts);
  const st = parseState(opts.state);
  st.delete('shortcut');
  const key = 'mini|' + base + '|' + [...st].sort().join(',') + '|' + tier;
  let c = cache.get(key);
  if (!c) {
    c = renderMini(base, st, tier);
    cache.set(key, c);
  }
  return c;
}

// ---------------------------------------------------------------- file types

const EXT_MAP = {};
const addExt = (exts, icon, type) => { for (const e of exts.split(' ')) EXT_MAP[e] = { icon, type }; };
addExt('png jpg jpeg gif bmp webp tif tiff heic ico raw', 'file_pic', 'image');
addExt('svg psd kra xcf ai ase aseprite clip procreate', 'file_pic', 'paint');
addExt('mp3 wav ogg flac m4a aac mid midi opus', 'file_audio', 'music');
addExt('mp4 mov avi mkv webm wmv m4v flv', 'file_video', 'video');
addExt('txt md log nfo rtf readme', 'file_txt', 'docs');
addExt('doc docx odt pages tex epub ppt pptx key odp', 'file_doc', 'docs');
addExt('pdf', 'file_pdf', 'docs');
addExt('xls xlsx csv ods numbers tsv', 'file_sheet', 'calc');
addExt('js mjs ts jsx tsx py c cpp h hpp cs java rs go rb php lua json css scss sh bat ps1 sql kt swift', 'file_code', 'terminal');
addExt('html htm url webloc xml mht', 'file_web', 'browser');
addExt('zip rar 7z tar gz tgz bz2 xz', 'file_zip', 'folder');
addExt('exe msi app apk deb rpm jar com', 'file_exe', 'computer');
addExt('iso dmg img vhd', 'file_disc', 'computer');
addExt('ini cfg conf config dll sys plist reg yml yaml toml env', 'file_cfg', 'settings');
addExt('eml msg mbox', 'mail', 'mail');
addExt('ics ical', 'calendar', 'calendar');
addExt('rom nes sfc gb gba nds sav', 'game', 'game');
addExt('tmp bak old crdownload part', 'file', 'trash');
addExt('torrent', 'file_web', 'browser');

const NAME_HINTS = [
  [/recycle|trash|bin$/i, 'trash', 'trash'],
  [/my computer|this pc|computer/i, 'computer', 'computer'],
  [/chrome|firefox|edge|safari|opera|brave|browser|internet|fishnet/i, 'browser', 'browser'],
  [/steam|epic|game|minecraft|itch|roblox|fishtop/i, 'game', 'game'],
  [/spotify|itunes|music|winamp|audacity/i, 'music', 'music'],
  [/vlc|video|movie|netflix|youtube|obs/i, 'video', 'video'],
  [/discord|slack|teams|zoom|skype|whatsapp|telegram|signal|chat/i, 'chat', 'chat'],
  [/outlook|thunderbird|mail/i, 'mail', 'mail'],
  [/photoshop|gimp|krita|paint|aseprite|figma|blender/i, 'paint', 'paint'],
  [/terminal|cmd|powershell|console|bash|vs ?code|code/i, 'terminal', 'terminal'],
  [/settings|control panel|preferences/i, 'settings', 'settings'],
  [/calc/i, 'calc', 'calc'],
  [/calendar/i, 'calendar', 'calendar'],
  [/photo|picture|gallery/i, 'image', 'image'],
  [/word|notepad|notes|document/i, 'notes', 'docs'],
  [/excel|sheet/i, 'calc', 'calc'],
];

export function getFileTypeIcon(ext) {
  const e = String(ext || '').toLowerCase().replace(/^\./, '');
  if (e === 'folder' || e === 'dir') return { icon: 'folder', type: 'folder', label: '' };
  const m = EXT_MAP[e];
  if (m) return { icon: m.icon, type: m.type, label: m.icon.startsWith('file_') ? e.toUpperCase().slice(0, 4) : '' };
  return { icon: 'file', type: 'docs', label: '' };
}

export function fileTypeInfo(name, isDir = false) {
  const n = String(name || '').trim();
  if (isDir) {
    if (/^(documents|my documents|desktop)$/i.test(n)) return { icon: 'documents', type: 'folder', label: '', state: '' };
    if (/recycle|trash/i.test(n)) return { icon: 'trash', type: 'trash', label: '', state: '' };
    return { icon: 'folder', type: 'folder', label: '', state: '' };
  }
  const dot = n.lastIndexOf('.');
  const ext = dot > 0 ? n.slice(dot + 1).toLowerCase() : '';
  const base = dot > 0 ? n.slice(0, dot) : n;
  if (ext === 'lnk' || ext === 'desktop' || ext === 'alias') {
    const inner = fileTypeInfo(base, false);
    return { ...inner, state: 'shortcut' };
  }
  if (!ext || ext === 'app' || ext === 'exe') {
    for (const [re, icon, type] of NAME_HINTS) if (re.test(base)) return { icon, type, label: '', state: '' };
  }
  return { ...getFileTypeIcon(ext), state: '' };
}

export const ICON_IDS = ['computer', 'trash', 'browser', 'folder', 'documents', 'image', 'music', 'game', 'mail', 'notes', 'terminal', 'settings', 'calc', 'calendar', 'chat', 'paint', 'video', 'fishtop', 'store', 'isp', 'ram', 'virus', 'boat', 'download'];
export const FILE_ICON_IDS = Object.keys(PAGE_KINDS);
