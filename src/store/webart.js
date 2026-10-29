// Retro 2000s web-page art for AppSea / SlowNet: dithered gradients, 3D bevels, glossy buttons, star
// ratings, blinking badges, hit counters, segmented progress bars and little animated mascots.
// Static pieces are cached canvases; per frame only fills and drawImage.

import { makeCanvas, ctxOf } from '../core/canvas.js';
import { PixelBuffer, selOut } from '../gfx/pixel.js';
import { pack, shade, mix } from '../core/color.js';
import { bayer, clamp } from '../core/math.js';
import { drawText, measureText } from '../gfx/font.js';

const cache = new Map();
function cached(key, fn) {
  let c = cache.get(key);
  if (!c) { c = fn(); cache.set(key, c); }
  return c;
}

// ---------------------------------------------------------------- gradients
function hexRgb(h) { return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]; }

// Dithered multi-stop gradient canvas. dir 'v' (top->bottom) or 'h'. Banded to 4 px steps then dithered.
export function gradCanvas(w, h, stops, dir = 'v') {
  const key = `g|${w}|${h}|${stops.join(',')}|${dir}`;
  return cached(key, () => {
    const c = makeCanvas(w, h), g = ctxOf(c);
    const img = g.createImageData(w, h), d = img.data;
    const cols = stops.map(hexRgb), n = cols.length - 1;
    const L = dir === 'v' ? h : w;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const f = ((dir === 'v' ? y : x) / Math.max(1, L - 1)) * n;
        const i = Math.min(n - 1, Math.floor(f));
        const kk = clamp(Math.floor((f - i) * 6 + bayer(x, y)) / 6, 0, 1);
        const a = cols[i], b = cols[i + 1];
        const o = (y * w + x) * 4;
        d[o] = a[0] + (b[0] - a[0]) * kk;
        d[o + 1] = a[1] + (b[1] - a[1]) * kk;
        d[o + 2] = a[2] + (b[2] - a[2]) * kk;
        d[o + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    return c;
  });
}

export function drawGrad(ctx, x, y, w, h, stops, dir = 'v') {
  if (w <= 0 || h <= 0) return;
  ctx.drawImage(gradCanvas(Math.round(w), Math.round(h), stops, dir), Math.round(x), Math.round(y));
}

// ---------------------------------------------------------------- bevels & buttons
export const WIN = { face: '#d4d0c8', light: '#ffffff', mid: '#e8e6e0', shadow: '#808080', dark: '#404040', text: '#000000', title: '#0a246a' };

export function bevel(ctx, x, y, w, h, { face = WIN.face, inset = false, thin = false } = {}) {
  x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h);
  if (face) { ctx.fillStyle = face; ctx.fillRect(x, y, w, h); }
  const tl = inset ? WIN.shadow : WIN.light, br = inset ? WIN.light : WIN.dark;
  ctx.fillStyle = tl;
  ctx.fillRect(x, y, w - 1, 1);
  ctx.fillRect(x, y, 1, h - 1);
  ctx.fillStyle = br;
  ctx.fillRect(x, y + h - 1, w, 1);
  ctx.fillRect(x + w - 1, y, 1, h);
  if (!thin) {
    ctx.fillStyle = inset ? WIN.dark : WIN.mid;
    ctx.fillRect(x + 1, y + 1, w - 3, 1);
    ctx.fillRect(x + 1, y + 1, 1, h - 3);
    ctx.fillStyle = inset ? WIN.mid : WIN.shadow;
    ctx.fillRect(x + 1, y + h - 2, w - 2, 1);
    ctx.fillRect(x + w - 2, y + 1, 1, h - 2);
  }
}

export function winButton(ctx, x, y, w, h, label, { hover = false, down = false, disabled = false, font = 'normal', bold = false } = {}) {
  bevel(ctx, x, y, w, h, { inset: down });
  if (hover && !disabled && !down) { ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fillRect(x + 2, y + 2, w - 4, h - 4); }
  const ty = y + Math.floor((h - (font === 'small' ? 5 : 7)) / 2) + (down ? 1 : 0);
  if (disabled) drawText(ctx, label, x + w / 2 + 1, ty + 1, { align: 'center', color: '#ffffff', font });
  drawText(ctx, label, x + w / 2 + (down ? 1 : 0), ty, { align: 'center', color: disabled ? '#808080' : '#000000', font });
  if (bold && !disabled) drawText(ctx, label, x + w / 2 + 1 + (down ? 1 : 0), ty, { align: 'center', color: '#000000', font });
}

const GLOSS = {
  green: ['#0a5a14', '#1e9a28', '#3ad040', '#8af07a', '#e0ffd0'],
  orange: ['#7a2a06', '#d0600e', '#ff9a1e', '#ffd05a', '#fff4c0'],
  blue: ['#0a2a7a', '#1a58d0', '#3a8af8', '#8ac8ff', '#e4f4ff'],
  red: ['#6a0a10', '#c01a24', '#f04a3a', '#ff9a7a', '#ffe4d8'],
  grey: ['#4a4a52', '#7a7a84', '#a4a4ac', '#c8c8d0', '#f0f0f4'],
  purple: ['#3a0a6a', '#7a2ac0', '#a85af0', '#d4a4ff', '#f4e4ff'],
};

function glossTex(w, h, color) {
  return cached(`gl|${w}|${h}|${color}`, () => {
    const R = GLOSS[color] || GLOSS.green;
    const b = new PixelBuffer(w, h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const corner = (x === 0 || x === w - 1) && (y === 0 || y === h - 1);
        if (corner) continue;
        let c;
        if (y === 0 || y === h - 1 || x === 0 || x === w - 1) c = R[0];
        else if (y < h / 2) c = y === 1 ? R[4] : bayer(x, y) < 0.5 - (y - 1) / h ? R[4] : R[3];
        else c = y === h - 2 ? R[1] : bayer(x, y) < (y - h / 2) / h * 1.4 ? R[1] : R[2];
        b.set(x, y, pack(c));
      }
    }
    return b.toCanvas();
  });
}

// Tacky glossy web button ("DOWNLOAD NOW!"). label may contain '\n'.
export function glossButton(ctx, x, y, w, h, label, { color = 'green', hover = false, down = false, disabled = false, t = 0, font = 'small' } = {}) {
  x = Math.round(x); y = Math.round(y);
  const col = disabled ? 'grey' : color;
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(x + 1, y + h, w - 1, 1);
  ctx.fillRect(x + w, y + 1, 1, h - 1);
  ctx.drawImage(glossTex(w, h, col), x, y + (down ? 1 : 0));
  if (hover && !disabled) {
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    ctx.fillRect(x + 1, y + 1 + (down ? 1 : 0), w - 2, h - 2);
    // shine sweep
    const sx = x + ((t * 90) % (w + 20)) - 10;
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    for (let i = 0; i < 4; i++) ctx.fillRect(Math.round(sx + i), y + 1, 1, h - 2);
  }
  const lines = String(label).split('\n');
  const lh = font === 'small' ? 7 : 10;
  const th = lines.length * lh - (lh - (font === 'small' ? 5 : 7));
  lines.forEach((l, i) => {
    const ty = y + Math.round((h - th) / 2) + i * lh + (down ? 1 : 0);
    drawText(ctx, l, x + w / 2, ty, { align: 'center', color: disabled ? '#e8e8ec' : '#ffffff', font, outline: disabled ? null : GLOSS[col][0] });
  });
}

// Small solid triangle arrow (dir: 'up'|'down'|'left'|'right') centred in a box.
export function drawArrow(ctx, x, y, w, h, dir, color = '#000000') {
  ctx.fillStyle = color;
  const cx = Math.floor(x + w / 2), cy = Math.floor(y + h / 2);
  for (let i = 0; i < 3; i++) {
    if (dir === 'up') ctx.fillRect(cx - i, cy - 1 + i, i * 2 + 1, 1);
    else if (dir === 'down') ctx.fillRect(cx - i, cy + 1 - i, i * 2 + 1, 1);
    else if (dir === 'left') ctx.fillRect(cx - 1 + i, cy - i, 1, i * 2 + 1);
    else ctx.fillRect(cx + 1 - i, cy - i, 1, i * 2 + 1);
  }
}

// ---------------------------------------------------------------- stars, badges, counters
const STAR = ['..#..', '.###.', '#####', '.###.', '.#.#.'];
function starTex(kind) {
  return cached('star|' + kind, () => {
    const b = new PixelBuffer(7, 7);
    STAR.forEach((row, j) => {
      for (let i = 0; i < 5; i++) {
        if (row[i] !== '#') continue;
        let c = kind === 'empty' ? '#c8ccd8' : j < 2 ? '#fff4a0' : '#ffc81e';
        if (kind === 'half' && i > 2) c = '#c8ccd8';
        if (kind === 'half' && i === 2) c = j < 2 ? '#fff4a0' : '#ffc81e';
        b.set(i + 1, j + 1, pack(c));
      }
    });
    b.outline(() => pack('#7a4a10'));
    return b.toCanvas();
  });
}

export function drawStars(ctx, x, y, rating) {
  for (let i = 0; i < 5; i++) {
    const k = rating - i;
    ctx.drawImage(starTex(k >= 0.75 ? 'full' : k >= 0.25 ? 'half' : 'empty'), Math.round(x + i * 7), Math.round(y));
  }
  return 35;
}

// Blinking starburst badge ("NEW!", "HOT!").
export function drawBurst(ctx, x, y, text, t, { color = '#ff2a2a', ink = '#ffff40', blink = true } = {}) {
  if (blink && Math.floor(t * 2.5) % 2) { ink = color; color = '#ffff40'; }
  const w = measureText(text, 'small') + 6, h = 9;
  ctx.fillStyle = '#000000';
  ctx.fillRect(x - 1, y, w + 2, h);
  ctx.fillRect(x, y - 1, w, h + 2);
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
  // jagged corners
  ctx.fillStyle = '#000000';
  for (let i = 2; i < w - 2; i += 3) { ctx.fillRect(x + i, y - 2, 1, 1); ctx.fillRect(x + i + 1, y + h + 1, 1, 1); }
  drawText(ctx, text, x + 3, y + 2, { font: 'small', color: ink });
  return w + 2;
}

export function drawTag(ctx, x, y, text, color, ink = '#ffffff') {
  const w = measureText(text, 'small') + 4;
  ctx.fillStyle = shade(color, -0.45);
  ctx.fillRect(x, y, w, 9);
  ctx.fillStyle = color;
  ctx.fillRect(x + 1, y + 1, w - 2, 7);
  ctx.fillStyle = shade(color, 0.35);
  ctx.fillRect(x + 1, y + 1, w - 2, 1);
  drawText(ctx, text, x + 2, y + 2, { font: 'small', color: ink });
  return w;
}

export function drawCounter(ctx, x, y, n, digits = 7) {
  const s = String(Math.floor(n)).padStart(digits, '0').slice(-digits);
  for (let i = 0; i < s.length; i++) {
    const cx = x + i * 7;
    ctx.fillStyle = '#000000';
    ctx.fillRect(cx, y, 6, 9);
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(cx, y + 4, 6, 1);
    drawText(ctx, s[i], cx + 1, y + 2, { font: 'small', color: i === s.length - 1 ? '#ff5a3a' : '#3aff5a' });
  }
  return digits * 7;
}

// Windows-XP style segmented progress bar.
export function drawBlocks(ctx, x, y, w, h, frac, { color = '#2a58e0', light = '#7aa8ff', back = '#ffffff', t = 0, marquee = false } = {}) {
  bevel(ctx, x, y, w, h, { face: back, inset: true, thin: true });
  const iw = w - 4, bw = 6, gap = 2;
  const n = Math.floor(iw / (bw + gap));
  const lit = marquee ? -1 : Math.round(n * clamp(frac, 0, 1));
  const mpos = Math.floor(t * 10) % (n + 4);
  for (let i = 0; i < n; i++) {
    const on = marquee ? i >= mpos - 3 && i <= mpos : i < lit;
    if (!on) continue;
    const bx = x + 2 + i * (bw + gap);
    ctx.fillStyle = color;
    ctx.fillRect(bx, y + 2, bw, h - 4);
    ctx.fillStyle = light;
    ctx.fillRect(bx, y + 2, bw, Math.max(1, Math.floor((h - 4) / 3)));
  }
}

// Simple flat rounded progress pill used inside cards.
export function drawPill(ctx, x, y, w, h, frac, color = '#3ad040') {
  ctx.fillStyle = '#20283a';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#e8ecf4';
  ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
  const fw = Math.round((w - 2) * clamp(frac, 0, 1));
  ctx.fillStyle = color;
  ctx.fillRect(x + 1, y + 1, fw, h - 2);
  ctx.fillStyle = shade(color, 0.45);
  ctx.fillRect(x + 1, y + 1, fw, 1);
  // candy stripes
  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  for (let i = 0; i < fw; i += 4) ctx.fillRect(x + 1 + i, y + 2, 2, h - 3);
}

// ---------------------------------------------------------------- logos & tiles
// Gradient-filled outlined word-art text (cached).
export function wordArt(text, { scale = 3, top = '#fff27a', bottom = '#ff8a1e', outline = '#0a1a5a', shadow = '#000000' } = {}) {
  return cached(`wa|${text}|${scale}|${top}|${bottom}|${outline}`, () => {
    const tw = measureText(text, 'normal', scale), th = 7 * scale;
    const pad = scale + 2;
    const c = makeCanvas(tw + pad * 2 + scale, th + pad * 2 + scale);
    const g = ctxOf(c);
    const fill = makeCanvas(c.width, c.height), fg = ctxOf(fill);
    for (let y = 0; y < c.height; y++) {
      const k = clamp((y - pad) / th, 0, 1);
      fg.fillStyle = mix(top, bottom, Math.round(k * 5) / 5);
      fg.fillRect(0, y, c.width, 1);
    }
    fg.fillStyle = 'rgba(255,255,255,0.75)';
    fg.fillRect(0, pad + 1, c.width, Math.max(1, Math.floor(scale / 2)));
    const mask = makeCanvas(c.width, c.height);
    drawText(ctxOf(mask), text, pad, pad, { scale, color: '#ffffff' });
    fg.globalCompositeOperation = 'destination-in';
    fg.drawImage(mask, 0, 0);
    // outline + drop shadow
    const o = Math.max(1, scale - 1);
    drawText(g, text, pad + o + 1, pad + o + 2, { scale, color: shadow });
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, 1], [1, -1], [-1, 1]]) drawText(g, text, pad + dx * o, pad + dy * o, { scale, color: outline });
    g.drawImage(fill, 0, 0);
    return c;
  });
}

// Tiled page background: pale water with faint fish & bubbles (very 1999).
export function pageTile() {
  return cached('tile', () => {
    const c = makeCanvas(48, 48), g = ctxOf(c);
    g.fillStyle = '#eef8ff';
    g.fillRect(0, 0, 48, 48);
    g.fillStyle = '#dceffc';
    for (const [x, y] of [[6, 8], [30, 30], [40, 6]]) { g.fillRect(x, y, 3, 3); g.fillRect(x - 1, y + 1, 5, 1); g.fillRect(x + 1, y - 1, 1, 5); }
    g.fillStyle = '#d4eafa';
    // two tiny fish
    for (const [x, y, f] of [[14, 20, 1], [34, 42, -1]]) {
      g.fillRect(x, y, 6, 3);
      g.fillRect(x + 1, y - 1, 4, 5);
      g.fillRect(f > 0 ? x - 2 : x + 6, y - 1, 2, 5);
    }
    return c;
  });
}

export function tileFill(ctx, x, y, w, h, scroll = 0) {
  const tile = pageTile();
  const oy = -(Math.round(scroll * 0.5) % 48);
  for (let ty = y + oy - 48; ty < y + h; ty += 48) {
    if (ty + 48 <= y) continue;
    for (let tx = x; tx < x + w; tx += 48) ctx.drawImage(tile, tx, ty);
  }
}

// ---------------------------------------------------------------- mascots (pixel sprites)
function sprite(rows, pal, outline = true) {
  const h = rows.length, w = rows[0].length;
  const b = new PixelBuffer(w + 2, h + 2);
  rows.forEach((r, j) => { for (let i = 0; i < w; i++) if (pal[r[i]]) b.set(i + 1, j + 1, pack(pal[r[i]])); });
  if (outline) b.outline(selOut(0.7));
  return b.toCanvas();
}

// SlowNet snail: its shell is a beige modem with blinking LEDs.
const SNAIL = [
  '......bbbbbbbb.....',
  '....bbBBBBBBBBbb...',
  '...bBBwwwwwwwwBBb..',
  '..bBBwBBBBBBBBwBBb.',
  '..bBwBBgBrBgBBBwBb.',
  '..bBwBBBBBBBBBBwBb.',
  '..bBBwBBBkBBkBwBBb.',
  'oo.bBBwwwwwwwwBBb..',
  'Ooo.bbBBBBBBBBbb...',
  '.Oooooooooooooooo..',
  '..OOOOOOOOOOOOOOOOo',
];
const SNAIL_PAL = { b: '#9a8676', B: '#e4d6b6', w: '#f7efd8', g: '#6aff5a', r: '#ff5a4a', k: '#5a4a58', o: '#9ad86a', O: '#5a9a3a' };
const SNAIL_HEAD = ['..k.k', '..o.o', '.ooo.', 'oooo.', 'ooo..'];
export function drawSnail(ctx, x, y, t) {
  const body = cached('snail', () => sprite(SNAIL, SNAIL_PAL));
  const blink = cached('snail2', () => sprite(SNAIL.map((r) => r.replace('g', 'B').replace('r', 'g')), SNAIL_PAL));
  const head = cached('snailh', () => sprite(SNAIL_HEAD, { k: '#1a1226', o: '#9ad86a' }));
  const bob = Math.round(Math.sin(t * 3) * 0.6);
  ctx.drawImage(Math.floor(t * 3) % 2 ? blink : body, Math.round(x), Math.round(y + bob));
  ctx.drawImage(head, Math.round(x - 3), Math.round(y + 3 + bob));
}

// Under-construction crab with a hard hat.
const CRAB = [
  '.....yyyy.....',
  '....yYYYYy....',
  '...yYYYYYYy...',
  'r.kk......kk.r',
  'rr.RRRRRRRR.rr',
  '.rRRRRRRRRRRr.',
  '..RRrRRRRrRR..',
  '..r.r....r.r..',
];
export function drawCrab(ctx, x, y, t) {
  const a = cached('crab0', () => sprite(CRAB, { y: '#ffd23a', Y: '#e8a61a', k: '#1a1226', R: '#e0483a', r: '#a02a2a' }));
  const b = cached('crab1', () => sprite(CRAB.map((r, j) => (j === 7 ? '.r..r....r..r.' : r)), { y: '#ffd23a', Y: '#e8a61a', k: '#1a1226', R: '#e0483a', r: '#a02a2a' }));
  ctx.drawImage(Math.floor(t * 6) % 2 ? a : b, Math.round(x), Math.round(y));
}

// Yellow/black "UNDER CONSTRUCTION" stripe sign.
export function drawConstruction(ctx, x, y, w, t) {
  ctx.fillStyle = '#000000';
  ctx.fillRect(x, y, w, 11);
  for (let i = 0; i < w - 2; i++) {
    if (((i + Math.floor(t * 8)) >> 2) % 2) { ctx.fillStyle = '#ffd23a'; ctx.fillRect(x + 1 + i, y + 1, 1, 9); }
  }
  ctx.fillStyle = '#000000';
  const label = 'UNDER CONSTRUCTION';
  const lw = measureText(label, 'small') + 6;
  ctx.fillRect(Math.round(x + (w - lw) / 2), y + 1, lw, 9);
  drawText(ctx, label, x + w / 2, y + 3, { font: 'small', color: '#ffd23a', align: 'center' });
}

// 88x31-style button badge (scaled down to 58x20).
export function drawBadge88(ctx, x, y, top, bottom, { bg = '#000080', fg = '#ffff00', accent = '#ff00ff' } = {}) {
  ctx.fillStyle = '#000000';
  ctx.fillRect(x, y, 58, 20);
  ctx.fillStyle = bg;
  ctx.fillRect(x + 1, y + 1, 56, 18);
  ctx.fillStyle = accent;
  ctx.fillRect(x + 1, y + 10, 56, 1);
  drawText(ctx, top, x + 29, y + 3, { font: 'small', color: fg, align: 'center' });
  drawText(ctx, bottom, x + 29, y + 12, { font: 'small', color: '#ffffff', align: 'center' });
}

// Speedometer gauge (semi circle) for the ISP page.
export function drawGauge(ctx, cx, cy, r, frac, t) {
  for (let a = 0; a <= 40; a++) {
    const k = a / 40, ang = Math.PI + k * Math.PI;
    const col = k < 0.33 ? '#e0483a' : k < 0.66 ? '#ffd23a' : '#3ad040';
    for (let rr = r - 4; rr <= r; rr++) {
      ctx.fillStyle = col;
      ctx.fillRect(Math.round(cx + Math.cos(ang) * rr), Math.round(cy + Math.sin(ang) * rr), 1, 1);
    }
  }
  const wob = Math.sin(t * 7) * 0.02 + Math.sin(t * 13) * 0.015;
  const ang = Math.PI + clamp(frac + wob, 0, 1) * Math.PI;
  ctx.fillStyle = '#1a1226';
  for (let i = 0; i < r - 3; i++) ctx.fillRect(Math.round(cx + Math.cos(ang) * i), Math.round(cy + Math.sin(ang) * i), 2, 1);
  ctx.fillStyle = '#5a5a6a';
  ctx.fillRect(cx - 2, cy - 2, 5, 4);
}
