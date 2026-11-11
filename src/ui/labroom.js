// [lab13] THE LAB's room: a layered voxel / pixel-art laboratory drawn behind the research tree and the Rods / Boats
// tabs (OWNER: Lab agent). Every layer is authored once per view size at 2x (logical units, half-pixel glints) into an
// offscreen canvas with a `.hi` twin (src/gfx/hires.js), so a frame is a handful of drawImage calls plus a few dozen
// tiny animated bits (fish behind the portholes and in the tank, swaying kelp, bubbles in tubes, blinking LEDs).
// Depth: each layer's palette is pulled toward a deep night-navy (`DEPTH`), emissive colours ('!#hex') keep their
// glow, and a vignette veil keeps the tree / tiles on top readable. No light rays, spotlights or ring effects.
//   drawLabRoom(ctx, v, t, cam, kind, o)   v = view rect, cam = {x, y, z} (pan in screen px, zoom delta) for parallax,
//                                          kind 'tree' | 'rods' | 'boats', o.afterFar(ctx) draws between wall + furniture
//   labRoomScene(v, kind) -> scene         the scene's layout (boats: scene.wl = the pool's water line, view-relative)
import { clamp, hash1, hash2, TAU } from '../core/math.js';
import { mix, shade, hexToRgb } from '../core/color.js';
import { makeCanvas, ctxOf } from '../core/canvas.js';
import { HI, isHi, hiCtx } from '../gfx/hires.js';
import { microBubble } from './labtiles.js';

const OUT = '#041026';
const TINT = '#041a33';

// ------------------------------------------------------------------ palette with depth
// Colour tokens: '#rrggbb' (pulled toward TINT by DEPTH), '!#rrggbb' (emissive: barely dimmed), '#rrggbb@a' (alpha).
let DEPTH = 0;
const memo = new Map();
function dep(c) {
  const key = c + '|' + DEPTH;
  let v = memo.get(key);
  if (v) return v;
  let a = 1, d = DEPTH, s = c;
  if (s[0] === '!') { s = s.slice(1); d = DEPTH * 0.18; }
  const at = s.indexOf('@');
  if (at > 0) { a = Number(s.slice(at + 1)); s = s.slice(0, at); }
  const [r, g, b] = hexToRgb(d ? mix(s, TINT, d) : s);
  v = a >= 1 ? `rgb(${r | 0},${g | 0},${b | 0})` : `rgba(${r | 0},${g | 0},${b | 0},${a})`;
  memo.set(key, v);
  if (memo.size > 6000) memo.delete(memo.keys().next().value);
  return v;
}
const shm = new Map();
// shade() keeps the token prefix ('!' emissive, '@a' alpha)
function sh(c, k) {
  if (!k) return c;
  const key = c + k;
  let v = shm.get(key);
  if (v) return v;
  let pre = '', s = c, post = '';
  if (s[0] === '!') { pre = '!'; s = s.slice(1); }
  const at = s.indexOf('@');
  if (at > 0) { post = s.slice(at); s = s.slice(0, at); }
  v = pre + shade(s, k) + post;
  shm.set(key, v);
  return v;
}
// mix two colour tokens (keeps the first one's '!' / '@a')
function mx(a, b, k) {
  const pre = a[0] === '!' ? '!' : '', at = a.indexOf('@'), post = at > 0 ? a.slice(at) : '';
  const strip = (c) => { if (c[0] === '!') c = c.slice(1); const i = c.indexOf('@'); return i > 0 ? c.slice(0, i) : c; };
  return pre + mix(strip(a), strip(b), k) + post;
}

// ------------------------------------------------------------------ authoring helpers (logical units on a 2x canvas)
function art(w, h, draw) {
  w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
  const hc = makeCanvas(w * HI, h * HI), g = ctxOf(hc);
  g.setTransform(HI, 0, 0, HI, 0, 0);
  draw(g, w, h);
  const c = makeCanvas(w, h);
  ctxOf(c).drawImage(hc, 0, 0, w, h); // nearest: whole art pixels stay crisp at 1x
  Object.defineProperty(c, 'hi', { value: hc, configurable: true });
  return c;
}
// draw a sprite's fine twin onto an art canvas (logical units)
const put = (g, c, x, y) => g.drawImage(c.hi || c, x, y, c.width, c.height);
const R = (g, x, y, w, h, c) => { if (w <= 0 || h <= 0) return; g.fillStyle = dep(c); g.fillRect(x, y, w, h); };
function disk(g, cx, cy, r, c, ry = r) {
  g.fillStyle = dep(c);
  const n = Math.ceil(ry);
  for (let y = -n; y < n; y++) {
    const yy = (y + 0.5) / ry, d = 1 - yy * yy;
    if (d <= 0) continue;
    const hw = Math.sqrt(d) * r, x0 = Math.round(cx - hw), x1 = Math.round(cx + hw);
    if (x1 > x0) g.fillRect(x0, cy + y, x1 - x0, 1);
  }
}
// per-pixel shaded ellipse: col(nx, ny, x, y) -> token | null
function blob(g, cx, cy, rx, ry, col) {
  const nx0 = Math.ceil(rx), ny0 = Math.ceil(ry);
  for (let y = -ny0; y < ny0; y++) for (let x = -nx0; x < nx0; x++) {
    const u = (x + 0.5) / rx, v = (y + 0.5) / ry;
    if (u * u + v * v > 1) continue;
    const c = col(u, v, x, y);
    if (c) { g.fillStyle = dep(c); g.fillRect(cx + x, cy + y, 1, 1); }
  }
}
function outlinedBlob(g, cx, cy, rx, ry, col) { disk(g, cx, cy, rx + 1, OUT, ry + 1); blob(g, cx, cy, rx, ry, col); }
// a lit ramp lookup for blobs: light from the top-left
const lit = (u, v) => -(u * 0.55 + v * 0.75);
function rampAt(c, l) { return l > 0.55 ? sh(c, 0.5) : l > 0.15 ? sh(c, 0.22) : l > -0.35 ? c : l > -0.7 ? sh(c, -0.22) : sh(c, -0.4); }
// an outlined voxel block: top face (`top` rows), lit left edge, dark right / bottom edges, a hi-res glint
function block(g, x, y, w, h, c, o = {}) {
  if (o.out !== false) R(g, x - 1, y - 1, w + 2, h + 2, OUT);
  R(g, x, y, w, h, c);
  const t = Math.min(h, o.top ?? 1);
  if (t) { R(g, x, y, w, t, sh(c, 0.38)); if (t > 1) R(g, x, y + t - 1, w, 1, sh(c, 0.2)); }
  R(g, x, y + t, 1, h - t, sh(c, 0.16));
  R(g, x + w - 1, y + t, 1, h - t, sh(c, -0.22));
  R(g, x, y + h - 1, w, 1, sh(c, -0.32));
  if (o.glint !== false && w > 4 && h > 3) R(g, x + 1, y + 0.5, 1.5, 0.5, '#ffffff@0.7');
}
// a vertical banded gradient with a checker dither on each band edge
const checkers = new Map();
function checker(g, c) {
  const key = dep(c);
  let p = checkers.get(key);
  if (!p) { const k = makeCanvas(2, 2), kg = ctxOf(k); kg.fillStyle = key; kg.fillRect(0, 0, 1, 1); kg.fillRect(1, 1, 1, 1); p = k; checkers.set(key, p); }
  return g.createPattern(p, 'repeat');
}
function vgrad(g, x, y, w, h, cols, steps = 4) {
  const n = (cols.length - 1) * steps;
  const at = (i) => { const k = i / steps, j = Math.min(cols.length - 2, Math.floor(k)); return mx(cols[j], cols[j + 1], k - j); };
  let prev = -1;
  for (let r = 0; r < h; r++) {
    const q = (r / Math.max(1, h - 1)) * n, a = Math.floor(q), f = q - a;
    if (a !== prev) prev = a;
    R(g, x, y + r, w, 1, at(a));
    if (f > 0.5 && a < n) { g.fillStyle = checker(g, at(a + 1)); g.fillRect(x, y + r, w, 1); }
  }
}
function line(g, x0, y0, x1, y1, c, wdt = 1) {
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) | 0;
  g.fillStyle = dep(c);
  for (let i = 0; i <= n; i++) { const k = n ? i / n : 0; g.fillRect(Math.round(x0 + (x1 - x0) * k), Math.round(y0 + (y1 - y0) * k), wdt, wdt); }
}
function ellipseLine(g, cx, cy, rx, ry, c, a0 = 0, a1 = TAU) {
  g.fillStyle = dep(c);
  const n = Math.ceil((rx + ry) * 3);
  for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * (i / n); g.fillRect(Math.round(cx + Math.cos(a) * rx), Math.round(cy + Math.sin(a) * ry), 1, 1); }
}
// a cable / rope hanging between two points
function cable(g, x0, y0, x1, y1, sag, c, wdt = 2) {
  const n = Math.ceil(Math.abs(x1 - x0) + Math.abs(y1 - y0));
  for (let i = 0; i <= n; i++) {
    const k = i / n, x = Math.round(x0 + (x1 - x0) * k), y = Math.round(y0 + (y1 - y0) * k + sag * 4 * k * (1 - k));
    R(g, x, y - 1, 1, wdt + 2, OUT);
  }
  for (let i = 0; i <= n; i++) {
    const k = i / n, x = Math.round(x0 + (x1 - x0) * k), y = Math.round(y0 + (y1 - y0) * k + sag * 4 * k * (1 - k));
    R(g, x, y, 1, wdt, c);
    R(g, x, y, 1, 0.5, sh(c, 0.4));
  }
}

// ------------------------------------------------------------------ sprites shared by the scenes
const sprites = new Map();
function spr(key, w, h, draw, depth = 0) {
  const k = key + '|' + depth;
  let c = sprites.get(k);
  if (!c) { const d0 = DEPTH; DEPTH = depth; c = art(w, h, draw); DEPTH = d0; sprites.set(k, c); }
  return c;
}
// a little fish facing right (or left), outlined, with a belly shade and a dark eye
function fishSprite(len, col, flip, depth = 0, out = true) {
  const h = Math.max(3, Math.round(len * 0.5));
  return spr(`fish|${len}|${col}|${flip}|${out}`, len + 2, h + 2, (g) => {
    const body = (x, y) => {
      const u = (x - (len * 0.6)) / (len * 0.4), v = (y - h / 2) / (h / 2);
      if (u * u + v * v <= 1) return 1;
      const tx = x / (len * 0.28); // tail: a notched triangle on the left
      if (tx >= 0 && tx <= 1 && Math.abs(v) <= 1.05 - tx * 0.95 && !(tx < 0.35 && Math.abs(v) < 0.3)) return 2;
      return 0;
    };
    const P = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < len; x++) { const b = body(x + 0.5, y + 0.5); if (b) P.push([x, y, b]); }
    const ox = 1, oy = 1;
    const X = (x) => (flip ? len - 1 - x : x) + ox;
    if (out) for (const [x, y] of P) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) R(g, X(x) + (flip ? -dx : dx), y + oy + dy, 1, 1, OUT);
    for (const [x, y, b] of P) {
      const v = (y + 0.5) / h;
      R(g, X(x), y + oy, 1, 1, b === 2 ? sh(col, -0.18) : v < 0.3 ? sh(col, 0.3) : v > 0.72 ? mx(col, '#ffffff', 0.45) : col);
    }
    const ex = Math.round(len * 0.82);
    R(g, X(ex), oy + Math.max(1, Math.round(h * 0.32)), 1, 1, OUT);
    if (len >= 9) R(g, X(ex) + (flip ? 0.5 : 0), oy + Math.max(1, Math.round(h * 0.32)), 0.5, 0.5, '#ffffff');
  }, depth);
}

// glass jar body: x..x+w, y..y+h, liquid level 0..1
function jarBody(g, x, y, w, h, liq, lvl) {
  R(g, x - 1, y, w + 2, h, OUT); R(g, x, y + h, w, 1, OUT);
  R(g, x, y, w, h, '#a8e2f4');
  R(g, x + 1, y + 1, w - 2, h - 2, '#6fb8d8');
  if (liq) {
    const ly = y + Math.round((h - 1) * (1 - lvl));
    R(g, x + 1, ly, w - 2, y + h - 1 - ly, liq);
    R(g, x + 1, ly, w - 2, 1, sh(liq, 0.45));
    R(g, x + w - 3, ly + 1, 2, y + h - 2 - ly, sh(liq, -0.22));
    R(g, x + 1, y + h - 2, w - 2, 1, sh(liq, -0.35));
  }
  R(g, x + 1, y + 1, 1, h - 3, '#ffffff@0.8');
  R(g, x + 2.5, y + 2, 0.5, Math.max(1, h - 7), '#ffffff@0.55');
}
// round-bottom flask standing on yb, bulb radius r
function roundFlask(g, cx, yb, r, liq, lvl = 0.55) {
  const cy = yb - r, nh = Math.round(r * 0.9) + 3;
  R(g, cx - 3, cy - r - nh, 6, nh + 2, OUT); R(g, cx - 2, cy - r - nh + 1, 4, nh + 1, '#bfe8f6'); R(g, cx - 2, cy - r - nh + 1, 1, nh + 1, '#ffffff@0.8');
  R(g, cx - 4, cy - r - nh - 1, 8, 3, OUT); R(g, cx - 3, cy - r - nh, 6, 1, '#e8fbff');
  const ly = cy + r - 2 * r * lvl;
  outlinedBlob(g, cx, cy, r, r, (u, v, x, y) => {
    const l = lit(u, v);
    if (cy + y + 0.5 >= ly) return u < -0.55 && v < 0.2 ? sh(liq, 0.4) : rampAt(liq, l * 0.8);
    return l > 0.6 ? '#ffffff' : u * u + v * v > 0.7 ? '#8fd0ea' : '#bfe8f6';
  });
  R(g, cx - Math.round(r * 0.5), Math.round(cy - r * 0.55), 2, 1, '#ffffff'); R(g, cx - Math.round(r * 0.62), Math.round(cy - r * 0.35), 1, 2, '#ffffff@0.8');
  return { x: cx - r * 0.6, y: ly, w: r * 1.2, h: cy + r - ly - 1, top: cy - r - nh };
}
// erlenmeyer flask standing on yb
function erlen(g, cx, yb, h, w, liq, lvl = 0.5) {
  const neckH = Math.round(h * 0.38), neckW = Math.max(4, Math.round(w * 0.3));
  const hw = (i) => Math.round(i < neckH ? neckW / 2 : neckW / 2 + (w / 2 - neckW / 2) * ((i - neckH) / (h - neckH)));
  const lyI = h - Math.round((h - neckH) * lvl);
  for (let i = 0; i < h; i++) { const y = yb - h + i, a = hw(i); R(g, cx - a - 1, y, a * 2 + 2, 1, OUT); }
  R(g, cx - Math.round(w / 2) - 1, yb, Math.round(w / 2) * 2 + 2, 1, OUT);
  for (let i = 0; i < h; i++) {
    const y = yb - h + i, a = hw(i);
    const wet = i >= lyI, c = wet ? (i === lyI ? sh(liq, 0.45) : liq) : '#b4e4f4';
    R(g, cx - a, y, a * 2, 1, c);
    R(g, cx + a - 2, y, 2, 1, sh(c, -0.25));
    R(g, cx - a, y, 1, 1, wet ? sh(liq, 0.3) : '#ffffff');
  }
  R(g, cx - neckW / 2 - 2, yb - h - 2, neckW + 4, 3, OUT); R(g, cx - neckW / 2 - 1, yb - h - 1, neckW + 2, 1, '#e8fbff');
  R(g, cx - Math.round(w * 0.22), yb - Math.round(h * 0.3), 1, 3, '#ffffff@0.8');
  return { x: cx - w * 0.3, y: yb - (h - lyI), w: w * 0.6, h: h - lyI - 2, top: yb - h - 2 };
}
// a potion bottle with a cork and a label
function bottle(g, cx, yb, h, w, liq) {
  const bh = Math.round(h * 0.62), nh = h - bh;
  block(g, cx - w / 2, yb - bh, w, bh, liq, { top: 2 });
  R(g, cx - w / 2 + 1, yb - bh + 2, 1, bh - 4, '#ffffff@0.7');
  R(g, cx - w / 2 + 2, yb - Math.round(bh * 0.62), w - 4, Math.max(3, Math.round(bh * 0.3)), '#f4fbff');
  R(g, cx - w / 2 + 3, yb - Math.round(bh * 0.62) + 1, w - 7, 1, '#7fa8c0');
  block(g, cx - 2, yb - h + 2, 4, nh - 2, mx(liq, '#bfe8f6', 0.5), { top: 0, glint: false });
  block(g, cx - 2, yb - h - 1, 4, 3, '#c08850', { top: 1, glint: false });
}
// a small potted plant (round leaves)
function plant(g, cx, yb, s, pot = '#f4fbff', leaf = '#5cc83a') {
  const pw = Math.round(s * 0.8), ph = Math.round(s * 0.55);
  const leaves = [[-0.42, -1.25, 0.42], [0.4, -1.35, 0.44], [0, -1.7, 0.4], [-0.62, -0.85, 0.34], [0.6, -0.9, 0.33]];
  for (const [lx, ly, lr] of leaves) R(g, cx + Math.round(lx * s * 0.3), yb - ph + Math.round(ly * s * 0.3), 1, Math.round(-ly * s * 0.3), sh(leaf, -0.4));
  for (const [lx, ly, lr] of leaves) outlinedBlob(g, cx + Math.round(lx * s), yb - ph + Math.round(ly * s * 0.62), Math.round(lr * s), Math.round(lr * s * 0.7), (u, v) => (Math.abs(u + v * 0.2) < 0.12 ? sh(leaf, 0.35) : rampAt(leaf, lit(u, v))));
  block(g, cx - pw / 2, yb - ph, pw, ph, pot, { top: 2 });
  R(g, cx - pw / 2 + 1, yb - ph + 3, pw - 2, 1, sh(pot, -0.25));
}

// ------------------------------------------------------------------ wall pieces
function tileWall(g, x0, y0, w, h, T, seed, base = '#2e9bd0', grout = '#0d4a78') {
  R(g, x0, y0, w, h, grout);
  const vs = [base, sh(base, 0.05), sh(base, -0.04), mx(base, '#3ab8d8', 0.35)];
  for (let ty = 0; ty * T < h; ty++) for (let tx = 0; tx * T < w; tx++) {
    const x = x0 + tx * T, y = y0 + ty * T;
    // an accent band of pale aqua tiles and a few lime / white tiles sprinkled in
    const band = ty % 7 === 4, r = hash2(tx, ty, seed);
    const c = band ? (tx % 2 ? '#8fdcf6' : '#6fd0f0') : r < 0.03 ? '#5ec4ea' : vs[Math.floor(hash2(tx, ty, seed + 3) * vs.length)];
    const tw = T - 1, th = Math.min(T - 1, y0 + h - y);
    if (th <= 0) continue;
    R(g, x, y, tw, th, c);
    R(g, x, y, tw, 2, sh(c, 0.32)); R(g, x, y + 2, tw, Math.round(th * 0.32), sh(c, 0.12));
    R(g, x, y, 1, th, sh(c, 0.2));
    R(g, x + tw - 1, y + 1, 1, th - 1, sh(c, -0.2)); R(g, x, y + th - 1, tw, 1, sh(c, -0.28));
    R(g, x + 1.5, y + 0.5, 2.5, 0.5, '#ffffff@0.8'); R(g, x + 1.5, y + 1, 0.5, 1.5, '#ffffff@0.6');
  }
}
// horizontal chrome / glass pipe
const CHROME = ['#f2fcff', '#c4e8f6', '#86c0dc', '#4f8cb4', '#2c5f88'];
function pipeH(g, x0, x1, y, th, kind = 'chrome', liq = '#5fe08a') {
  R(g, x0, y - 1, x1 - x0, th + 2, OUT);
  for (let i = 0; i < th; i++) {
    const k = i / (th - 1);
    let c;
    if (kind === 'chrome') c = CHROME[Math.min(4, Math.round(Math.abs(k - 0.25) * 5.4))];
    else c = i === 0 ? '#e8fbff' : i === th - 1 ? sh(liq, -0.3) : k < 0.35 ? '!' + sh(liq, 0.35) : '!' + liq;
    R(g, x0, y + i, x1 - x0, 1, c);
  }
  if (kind !== 'chrome') R(g, x0, y + 0.5, x1 - x0, 0.5, '#ffffff@0.8');
}
function pipeV(g, x, y0, y1, th, kind = 'chrome', liq = '#5fe08a') {
  R(g, x - 1, y0, th + 2, y1 - y0, OUT);
  for (let i = 0; i < th; i++) {
    const k = i / (th - 1);
    let c;
    if (kind === 'chrome') c = CHROME[Math.min(4, Math.round(Math.abs(k - 0.25) * 5.4))];
    else c = i === 0 ? '#e8fbff' : i === th - 1 ? sh(liq, -0.3) : k < 0.35 ? '!' + sh(liq, 0.35) : '!' + liq;
    R(g, x + i, y0, 1, y1 - y0, c);
  }
}
function flange(g, cx, cy, w, h) {
  block(g, cx - w / 2, cy - h / 2, w, h, '#9fd0e8', { top: 1, glint: false });
  R(g, cx - 0.5, cy - h / 2 + 1, 1, 1, '#2c5f88'); R(g, cx - 0.5, cy + h / 2 - 2, 1, 1, '#2c5f88');
}
function porthole(g, cx, cy, r) {
  const r1 = r + 7;
  disk(g, cx + 2, cy + 3, r1 + 1, '#000000@0.35');
  disk(g, cx, cy, r1 + 1, OUT);
  const ring = ['#2c5f88', '#4f8cb4', '#86c0dc', '#c4e8f6', '#f2fcff'];
  const n = Math.ceil(r1);
  for (let y = -n; y < n; y++) for (let x = -n; x < n; x++) {
    const d = Math.hypot(x + 0.5, y + 0.5);
    if (d < r || d >= r1) continue;
    const a = Math.atan2(y + 0.5, x + 0.5), l = Math.cos(a + Math.PI * 0.75), p = (d - r) / (r1 - r);
    const s = p < 0.3 ? -l * 0.9 : p > 0.72 ? l * 0.7 : l * 0.4 + 0.35;
    g.fillStyle = dep(ring[clamp(Math.round(2 + s * 2), 0, 4)]);
    g.fillRect(cx + x, cy + y, 1, 1);
  }
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * TAU + 0.31, rx = Math.round(cx + Math.cos(a) * (r + 3.5)), ry = Math.round(cy + Math.sin(a) * (r + 3.5));
    R(g, rx - 1, ry - 1, 2, 2, '#2c5f88'); R(g, rx - 1, ry - 1, 1, 1, '#ffffff');
  }
  // the hole (the sea shows through) + a ring of inner shadow + glass glints
  g.save(); g.globalCompositeOperation = 'destination-out'; disk(g, cx, cy, r, '#000000'); g.restore();
  for (let y = -r; y < r; y++) for (let x = -r; x < r; x++) {
    const d = Math.hypot(x + 0.5, y + 0.5);
    if (d >= r) continue;
    if (d > r - 1) { R(g, cx + x, cy + y, 1, 1, OUT); continue; }
    if (d > r - 3 && y < r * 0.3) R(g, cx + x, cy + y, 1, 1, '#021024@0.45');
    const dd = Math.hypot(x + 0.5 + r * 0.18, y + 0.5 + r * 0.18);
    if (d < r - 4 && dd > r * 0.72 && dd < r * 0.8 && x < 0 && y < 0) R(g, cx + x, cy + y, 1, 1, '#ffffff@0.32');
  }
  R(g, cx - Math.round(r * 0.45), cy - Math.round(r * 0.5), 3, 2, '#ffffff@0.7'); R(g, cx - Math.round(r * 0.58), cy - Math.round(r * 0.3), 1.5, 1.5, '#ffffff@0.55');
  R(g, cx + Math.round(r * 0.45), cy + Math.round(r * 0.5), 1.5, 1.5, '#ffffff@0.4');
}
// the sea seen through a porthole (its own sprite, a size larger than the hole for parallax)
function seaView(r, seed, night = false) {
  const S = r * 2 + 28;
  return spr(`seaview|${r}|${seed}|${night}`, S, S, (g) => {
    vgrad(g, 0, 0, S, S, night ? ['#2a78c8', '#165aa8', '#0c3f86', '#072a62'] : ['#8fe6ff', '#4cc4f4', '#2596e2', '#0f5aa8'], 3);
    // caustic speckles up top
    for (let i = 0; i < S * 1.2; i++) { const x = Math.floor(hash1(i, seed) * S), y = Math.floor(hash1(i, seed + 1) ** 2 * S * 0.5); R(g, x, y, 1, 1, '!#dff9ff@0.45'); }
    // far rocks, kelp silhouettes and the sand
    const by = S - 14;
    for (let x = 0; x < S; x++) { const hh = 6 + Math.round(5 * Math.sin(x * 0.11 + seed) + 3 * Math.sin(x * 0.29 + seed * 2)); R(g, x, by - hh, 1, hh + 14, '#1a6aa8'); }
    for (let k = 0; k < 4; k++) {
      const kx = Math.round(hash1(k, seed + 3) * S), kh = 14 + Math.round(hash1(k, seed + 4) * 22);
      for (let i = 0; i < kh; i++) { const x = kx + Math.round(Math.sin(i * 0.25 + k) * 2); R(g, x, by - i, 2, 1, '#1d7f9a'); if (i % 5 === 2) R(g, x + (i % 10 < 5 ? 2 : -2), by - i, 2, 1, '#1d7f9a'); }
    }
    for (let x = 0; x < S; x++) { const hh = 4 + Math.round(2 * Math.sin(x * 0.17 + seed)); R(g, x, by + 8 - hh, 1, hh + 6, '#e8d6a0'); R(g, x, by + 8 - hh, 1, 1, '#fff2c8'); }
    for (let i = 0; i < 6; i++) { const x = Math.round(hash1(i, seed + 9) * S); R(g, x, by + 4, 2, 1, i % 2 ? '#ff9ab8' : '#ffffff'); }
  }, 0.12);
}
// a blueprint pinned to the wall: kind fish | flask | rod | boat | tank
function blueprint(g, x, y, w, h, kind) {
  R(g, x + 2, y + 2, w, h, '#000000@0.35');
  R(g, x - 1, y - 1, w + 2, h + 2, OUT);
  R(g, x, y, w, h, '#2f7fd0');
  for (let i = 3; i < w; i += 5) R(g, x + i, y + 1, 0.5, h - 2, '#5aa2e4');
  for (let i = 3; i < h; i += 5) R(g, x + 1, y + i, w - 2, 0.5, '#5aa2e4');
  R(g, x + 1, y + 1, w - 2, 1, '#5aa2e4'); R(g, x + 1, y + h - 2, w - 2, 1, '#2468b4');
  const c = '#e8f8ff', cx = x + w / 2, cy = y + h / 2;
  if (kind === 'fish') {
    ellipseLine(g, cx + 3, cy, w * 0.26, h * 0.22, c);
    line(g, cx - w * 0.23, cy, cx - w * 0.36, cy - h * 0.18, c); line(g, cx - w * 0.36, cy - h * 0.18, cx - w * 0.36, cy + h * 0.18, c); line(g, cx - w * 0.36, cy + h * 0.18, cx - w * 0.23, cy, c);
    R(g, Math.round(cx + w * 0.18), Math.round(cy - 2), 1, 1, c);
    line(g, cx - w * 0.36, cy + h * 0.34, cx + w * 0.37, cy + h * 0.34, '#9fd0f4');
    R(g, Math.round(cx - w * 0.36), Math.round(cy + h * 0.3), 1, 3, c); R(g, Math.round(cx + w * 0.37), Math.round(cy + h * 0.3), 1, 3, c);
  } else if (kind === 'flask') {
    line(g, cx - 2, y + 4, cx - 2, cy - 2, c); line(g, cx + 2, y + 4, cx + 2, cy - 2, c);
    line(g, cx - 2, cy - 2, cx - w * 0.3, y + h - 5, c); line(g, cx + 2, cy - 2, cx + w * 0.3, y + h - 5, c); line(g, cx - w * 0.3, y + h - 5, cx + w * 0.3, y + h - 5, c);
    line(g, cx - w * 0.2, cy + 4, cx + w * 0.2, cy + 4, '#9fd0f4');
    ellipseLine(g, x + w - 7, y + 6, 3, 3, '#9fd0f4');
  } else if (kind === 'rod') {
    line(g, x + 4, y + h - 4, x + w - 5, y + 4, c);
    ellipseLine(g, x + w * 0.32, y + h * 0.62, 3, 3, c);
    line(g, x + w - 5, y + 4, x + w - 5, y + h - 8, '#9fd0f4');
    line(g, x + w - 7, y + h - 8, x + w - 5, y + h - 6, c); line(g, x + w - 5, y + h - 6, x + w - 3, y + h - 8, c);
  } else if (kind === 'boat') {
    line(g, x + 4, cy + 2, x + w - 4, cy + 2, c); line(g, x + 4, cy + 2, x + 8, y + h - 5, c); line(g, x + w - 4, cy + 2, x + w - 9, y + h - 5, c); line(g, x + 8, y + h - 5, x + w - 9, y + h - 5, c);
    line(g, cx, cy + 2, cx, y + 4, c); line(g, cx, y + 4, cx + w * 0.28, cy - 1, c); line(g, cx + w * 0.28, cy - 1, cx, cy - 1, c);
  } else {
    line(g, x + 5, y + 6, x + w - 5, y + 6, c); line(g, x + 5, y + 6, x + 5, y + h - 5, c); line(g, x + w - 5, y + 6, x + w - 5, y + h - 5, c); line(g, x + 5, y + h - 5, x + w - 5, y + h - 5, c);
    for (let i = 0; i < 3; i++) R(g, x + 8 + i * 5, y + h - 9 - (i % 2) * 3, 2, 2, '#9fd0f4');
  }
  // dog-eared corner + pins
  R(g, x + w - 4, y + h - 4, 4, 4, '#2468b4'); line(g, x + w - 4, y + h - 1, x + w - 1, y + h - 4, '#9fd0f4');
  for (const px of [x + 2, x + w - 4]) { R(g, px, y, 2, 2, '!#ff4a6a'); R(g, px, y, 1, 1, '!#ffd0dc'); }
}
// a species chart: a white poster with a grid of little fish
function chart(g, x, y, w, h) {
  R(g, x + 2, y + 2, w, h, '#000000@0.35');
  block(g, x, y, w, h, '#eefaff', { top: 0, glint: false });
  R(g, x + 3, y + 3, w - 6, 3, '#35a8e0'); R(g, x + 3, y + 3, w - 6, 1, '#7fd0f4');
  const cols = ['#ff9a3a', '#ffd23a', '#ff74b4', '#35c8ff', '#7fe03a', '#a98aff'];
  for (let i = 0; i < 6; i++) {
    const fx = x + 4 + (i % 3) * Math.floor((w - 6) / 3), fy = y + 9 + Math.floor(i / 3) * Math.floor((h - 11) / 2);
    put(g, fishSprite(9, cols[i], false, DEPTH, false), fx, fy);
    R(g, fx, fy + 7, 8, 0.5, '#9fb8c8');
  }
  R(g, x + w / 2 - 1, y - 1, 2, 2, '!#ff4a6a');
}
function clock(g, cx, cy, r) {
  outlinedBlob(g, cx, cy, r + 2, r + 2, (u, v) => rampAt('#35a8e0', lit(u, v)));
  outlinedBlob(g, cx, cy, r, r, (u, v) => (u * u + v * v > 0.8 ? '#c8e8f4' : '#ffffff'));
  for (let i = 0; i < 12; i++) { const a = (i / 12) * TAU; R(g, Math.round(cx + Math.cos(a) * (r - 2)), Math.round(cy + Math.sin(a) * (r - 2)), 1, 1, i % 3 ? '#8fb4cc' : '#1a3a5a'); }
  line(g, cx, cy, cx + Math.round(r * 0.5), cy - Math.round(r * 0.35), '#1a3a5a'); line(g, cx, cy, cx - 1, cy - Math.round(r * 0.7), '#1a3a5a');
  R(g, cx, cy, 1, 1, '!#ff4a6a');
}
// hazard / bunting
function bunting(g, x0, x1, y, sag, seed) {
  cable(g, x0, y, x1, y, sag, '#e8f8ff', 1);
  const cols = ['#ff5a6a', '#ffd23a', '#35c8ff', '#7fe03a', '#ff74b4', '#ffffff'];
  for (let x = x0 + 6; x < x1 - 4; x += 12) {
    const k = (x - x0) / (x1 - x0), yy = Math.round(y + sag * 4 * k * (1 - k)) + 1, c = cols[Math.floor(hash1(x, seed) * cols.length)];
    for (let i = 0; i < 8; i++) { const hw = Math.max(0, 4 - i * 0.5); R(g, x - hw - 1, yy + i, hw * 2 + 2, 1, OUT); }
    for (let i = 0; i < 7; i++) { const hw = Math.max(0, 4 - i * 0.5 - 0.5); R(g, x - hw, yy + i, hw * 2, 1, i < 2 ? sh(c, 0.3) : c); }
  }
}

// ------------------------------------------------------------------ furniture
function tank(g, x, y, w, h, S) {
  // the stand (white gloss cabinet with aqua doors)
  const sy = y + h + 6, shh = 30;
  block(g, x - 4, sy, w + 8, shh, '#e9f8ff', { top: 3 });
  for (let i = 0; i < 2; i++) { const dx = x + 2 + i * (w / 2), dw = w / 2 - 4; block(g, dx, sy + 6, dw, shh - 10, '#35a8e0', { top: 1 }); R(g, dx + dw / 2 - 4, sy + 10, 8, 2, '#f2fcff'); R(g, dx + dw / 2 - 4, sy + 11, 8, 1, '#4f8cb4'); }
  // glass + water
  R(g, x - 1, y - 1, w + 2, h + 2, OUT);
  vgrad(g, x, y, w, h, ['!#7fe4ff', '!#3cbcf0', '!#1d8ed8', '!#1262b0'], 3);
  // back: rock wall silhouettes
  for (let i = 0; i < w; i++) { const hh = Math.round(h * 0.22 + 6 * Math.sin(i * 0.09) + 4 * Math.sin(i * 0.23 + 1)); R(g, x + i, y + h - 10 - hh, 1, hh, '!#1670b4'); }
  // gravel
  for (let i = 0; i < w; i++) { const hh = 9 + Math.round(1.5 * Math.sin(i * 0.3)); R(g, x + i, y + h - hh, 1, hh, '#e8c88a'); }
  const peb = ['#f6e2a8', '#ffd28a', '#ff9ab8', '#9fe0ff', '#ffffff', '#c8a070'];
  for (let i = 0; i < w * 0.9; i++) { const px = x + Math.floor(hash1(i, 71) * (w - 2)), py = y + h - 8 + Math.floor(hash1(i, 72) * 7), c = peb[Math.floor(hash1(i, 73) * peb.length)]; R(g, px, py, 2, 1, c); R(g, px, py + 1, 2, 1, sh(c, -0.3)); }
  // decor: a rock arch, a coral, a shell, a tiny treasure chest
  outlinedBlob(g, x + Math.round(w * 0.7), y + h - 14, 16, 11, (u, v) => (u * u + (v - 0.6) ** 2 < 0.25 ? null : rampAt('#8aa6c8', lit(u, v))));
  const cx0 = x + Math.round(w * 0.32), cb = y + h - 8;
  const coral = (bx, by, len, a, d) => { for (let i = 0; i < len; i++) { const px = Math.round(bx + Math.sin(a) * i), py = Math.round(by - Math.cos(a) * i); R(g, px - 1, py - 1, 4, 3, OUT); } if (d < 2) { coral(bx + Math.sin(a) * len, by - Math.cos(a) * len, len * 0.65, a - 0.6, d + 1); coral(bx + Math.sin(a) * len, by - Math.cos(a) * len, len * 0.6, a + 0.55, d + 1); } };
  const coralC = (bx, by, len, a, d) => { for (let i = 0; i < len; i++) { const px = Math.round(bx + Math.sin(a) * i), py = Math.round(by - Math.cos(a) * i); R(g, px, py, 2, 1, '#ff74b4'); R(g, px, py, 1, 1, '#ffb8d8'); } if (d < 2) { coralC(bx + Math.sin(a) * len, by - Math.cos(a) * len, len * 0.65, a - 0.6, d + 1); coralC(bx + Math.sin(a) * len, by - Math.cos(a) * len, len * 0.6, a + 0.55, d + 1); } };
  coral(cx0, cb, 12, -0.15, 0); coralC(cx0, cb, 12, -0.15, 0);
  block(g, x + Math.round(w * 0.5), y + h - 15, 12, 8, '#c07a3a', { top: 2 }); R(g, x + Math.round(w * 0.5), y + h - 12, 12, 1, '#ffd23a'); R(g, x + Math.round(w * 0.5) + 5, y + h - 12, 2, 2, '!#fff0a0');
  outlinedBlob(g, x + Math.round(w * 0.12), y + h - 9, 5, 3, (u, v) => (Math.round((u + 1) * 4) % 2 ? '#ffd0e0' : '#ff9ab8'));
  // surface band and the glass glints (front)
  R(g, x, y, w, 3, '!#c8f8ff@0.55'); R(g, x, y + 3, w, 1, '!#9ff0ff@0.35');
  R(g, x + 6, y + 6, 3, h - 18, '#ffffff@0.18'); R(g, x + 11, y + 6, 1, h - 26, '#ffffff@0.14');
  R(g, x + w - 14, y + 10, 2, h - 30, '#ffffff@0.1');
  // frame: corner posts, bottom rail, lid with an LED strip
  for (const px of [x - 3, x + w - 1]) block(g, px, y - 2, 4, h + 6, '#9fd6ee', { top: 0, glint: false });
  block(g, x - 3, y + h, w + 6, 5, '#7cc0e0', { top: 1 });
  block(g, x - 5, y - 9, w + 10, 7, '#2fa6e0', { top: 3 });
  R(g, x - 3, y - 2, w + 6, 1, '!#bffcff');
  S.tank = { x, y: y + 4, w, h: h - 14, floor: y + h - 9 };
  S.leds.push({ x: x + w - 4, y: y - 6, c: '#7fff7a', ph: 0.3 }, { x: x + w - 8, y: y - 6, c: '#35d8ff', ph: 1.7 });
}
function column(g, x, y0, y1, wd, liq, S) {
  block(g, x - 3, y0 - 6, wd + 6, 6, '#9fd6ee', { top: 2 });
  block(g, x - 3, y1, wd + 6, 7, '#9fd6ee', { top: 2 });
  R(g, x - 1, y0, wd + 2, y1 - y0, OUT);
  R(g, x, y0, wd, y1 - y0, '#a8e2f4');
  const ly = y0 + 10;
  R(g, x + 1, ly, wd - 2, y1 - ly, '!' + liq); R(g, x + wd - 3, ly, 2, y1 - ly, '!' + sh(liq, -0.25)); R(g, x + 1, ly, wd - 2, 1, '!' + sh(liq, 0.5));
  R(g, x + 1, y0 + 1, 1, y1 - y0 - 2, '#ffffff@0.75'); R(g, x + 2.5, y0 + 2, 0.5, y1 - y0 - 4, '#ffffff@0.5');
  for (let yy = y0 + 18; yy < y1 - 4; yy += 22) R(g, x, yy, wd, 1, '#ffffff@0.25');
  S.cols.push({ x: x + 1, y: ly + 2, w: wd - 2, h: y1 - ly - 3, c: liq });
}
// a shelving unit; items are generated from the seed and their animated bits land in S
function shelves(g, x, y, w, h, n, seed, S, o = {}) {
  const post = '#9fd6ee';
  const gap = Math.floor(h / n);
  // back panel
  R(g, x, y, w, h, '#0f4f7c'); for (let i = 4; i < w; i += 8) R(g, x + i, y, 1, h, '#13598a');
  for (let s = 0; s < n; s++) {
    const by = y + (s + 1) * gap - 5;
    let cx = x + 6;
    let k = 0;
    while (cx < x + w - 14) {
      const r = hash2(s, k++, seed);
      const room = gap - 9;
      const liqs = ['#ff74b4', '#7fe03a', '#ffb23a', '#a98aff', '#35d8ff', '#19c7a2', '#ff5a6a'];
      const liq = liqs[Math.floor(hash2(k, s, seed + 1) * liqs.length)];
      let iw;
      const kind = o.kinds ? o.kinds[Math.floor(r * o.kinds.length)] : r < 0.3 ? 'jar' : r < 0.5 ? 'round' : r < 0.64 ? 'erlen' : r < 0.78 ? 'bottle' : r < 0.9 ? 'books' : r < 0.95 ? 'plant' : 'fishbox';
      if (kind === 'jar') {
        iw = 14 + Math.round(hash2(k, s, seed + 2) * 6); const jh = Math.min(room - 4, 18 + Math.round(hash2(k, s, seed + 3) * 8));
        const content = ['fish', 'kelp', 'star', 'jelly', 'fish', 'shell'][Math.floor(hash2(k, s, seed + 4) * 6)];
        const jliq = content === 'jelly' ? '#7a5ad8' : mx(liq, '#35c8ff', 0.6);
        jarBody(g, cx, by - jh, iw, jh, '!' + mx(jliq, '#1a6aa8', 0.15), 0.82);
        block(g, cx - 1, by - jh - 4, iw + 2, 4, '#c4e8f6', { top: 1, glint: false });
        const inner = { x: cx + 2, y: by - jh + 3, w: iw - 4, h: jh - 5 };
        if (content === 'star') { const sx = inner.x + inner.w / 2, sy = inner.y + inner.h / 2; for (const [dx, dy] of [[0, -3], [-3, -1], [3, -1], [-2, 3], [2, 3]]) line(g, sx, sy, sx + dx, sy + dy, '#ff9a3a', 1); R(g, sx, sy, 1, 1, '#ffd23a'); }
        else if (content === 'shell') outlinedBlob(g, Math.round(inner.x + inner.w / 2), inner.y + inner.h - 3, 4, 3, (u) => (Math.round((u + 1) * 3) % 2 ? '#ffe0ea' : '#ffb0c8'));
        else if (content === 'jelly') S.jars.push({ ...inner, kind: 'jelly', ph: hash1(k, seed) * 6 });
        else S.jars.push({ ...inner, kind: content, ph: hash1(k, seed) * 6, c: ['#ff9a3a', '#ffd23a', '#ff74b4', '#7fe03a'][k % 4] });
      } else if (kind === 'round') {
        const rr = Math.min(Math.floor((room - 10) / 2), 6 + Math.round(hash2(k, s, seed + 5) * 4)); iw = rr * 2 + 2;
        const q = roundFlask(g, cx + rr + 1, by, rr, '!' + liq, 0.55);
        if (hash1(k, seed + 6) < 0.6) S.flasks.push({ x: q.x, y: q.y, w: q.w, h: q.h, top: q.top, cx: cx + rr + 1 });
      } else if (kind === 'erlen') {
        const eh = Math.min(room - 4, 16 + Math.round(hash2(k, s, seed + 7) * 6)); iw = Math.round(eh * 0.8);
        const q = erlen(g, cx + iw / 2, by, eh, iw, '!' + liq, 0.45);
        if (hash1(k, seed + 8) < 0.5) S.flasks.push({ x: q.x, y: q.y, w: q.w, h: q.h, top: q.top, cx: cx + iw / 2 });
      } else if (kind === 'bottle') {
        iw = 8 + Math.round(hash2(k, s, seed + 9) * 3); bottle(g, cx + iw / 2, by, Math.min(room - 3, 15 + Math.round(hash2(k, s, seed + 10) * 7)), iw, liq);
      } else if (kind === 'books') {
        const nb = 3 + Math.floor(hash2(k, s, seed + 11) * 3); iw = 0;
        for (let b = 0; b < nb; b++) {
          const bw = 3 + Math.round(hash2(b, k, seed + 12) * 2), bh = Math.min(room - 2, 14 + Math.round(hash2(b, k, seed + 13) * 7));
          const bc = ['#35a8e0', '#7fd03a', '#ff9a3a', '#e8f8ff', '#a98aff', '#ff74b4'][Math.floor(hash2(b, k, seed + 14) * 6)];
          block(g, cx + iw, by - bh, bw, bh, bc, { top: 1, glint: false }); R(g, cx + iw + 1, by - bh + 3, bw - 2, 1, sh(bc, 0.45)); R(g, cx + iw + 1, by - 4, bw - 2, 1, sh(bc, 0.45));
          iw += bw + 1;
        }
      } else if (kind === 'plant') { iw = 18; plant(g, cx + 9, by, Math.min(14, room * 0.45)); }
      else if (kind === 'fishbox') { iw = 22; block(g, cx, by - 12, iw, 12, '#ff9a3a', { top: 2 }); put(g, fishSprite(9, '#ffffff', false, DEPTH, false), cx + 6, by - 9); }
      else { iw = 18; const bh = 10; block(g, cx, by - bh, iw, bh, '#e9f8ff', { top: 2 }); R(g, cx + 4, by - bh + 4, iw - 8, 3, '#35a8e0'); }
      cx += iw + 4 + Math.round(hash2(k, s, seed + 15) * 3);
    }
    // the shelf board (a glossy voxel slab) + its lip
    block(g, x - 2, by, w + 4, 4, '#e9f8ff', { top: 2 });
    R(g, x - 2, by + 4, w + 4, 2, '#000000@0.3');
  }
  for (const px of [x - 4, x + w]) block(g, px, y - 4, 4, h + 8, post, { top: 0, glint: false });
}
function consoleUnit(g, x, y, w, h, S) {
  // a white gloss cabinet with a slanted control deck, a screen, dials, LEDs and a glass specimen dome on top
  block(g, x, y + 16, w, h - 16, '#e9f8ff', { top: 3 });
  block(g, x + 4, y + 24, w - 8, h - 30, '#35a8e0', { top: 1 });
  // drawers, a vent, a sticker and a round sight glass with bubbling liquid
  const dh = Math.max(8, Math.floor((h - 40) / 3));
  for (let i = 0; i < 3; i++) { block(g, x + 9, y + 29 + i * (dh + 3), 46, dh, '#2a96d0', { top: 1 }); block(g, x + 26, y + 29 + i * (dh + 3) + Math.floor(dh / 2) - 1, 12, 2, '#e8f8ff', { top: 0, glint: false }); }
  for (let i = 0; i < 5; i++) R(g, x + 62, y + 30 + i * 3, 18, 1, '#1d6fa8');
  outlinedBlob(g, x + 71, y + 52, 7, 7, (u, v) => rampAt('#ffffff', lit(u, v) * 0.5));
  put(g, fishSprite(9, '#ff9a3a', false, DEPTH, false), x + 66, y + 49);
  const wx = x + w - 22, wy = y + 30 + Math.round((h - 40) * 0.45);
  disk(g, wx, wy, 13, OUT);
  blob(g, wx, wy, 12, 12, (u, v) => { const d = Math.hypot(u, v); return d > 0.72 ? rampAt('#c4e8f6', lit(u, v)) : v < -0.15 ? '!#bff4ff' : (u < -0.3 && v < 0.2 ? '!#bfff8a' : '!#6fd83a'); });
  disk(g, wx, wy, 9, '#000000@0'); R(g, wx - 5, wy - 6, 3, 2, '#ffffff@0.8');
  S.flasks.push({ x: wx - 6, y: wy - 2, w: 12, h: 8, top: wy - 9, cx: wx });
  // control deck
  for (let i = 0; i < 12; i++) R(g, x - 2 + Math.round(i * 0.25), y + 16 - i, w + 4 - Math.round(i * 0.5), 1, OUT);
  for (let i = 0; i < 11; i++) R(g, x - 1 + Math.round(i * 0.25), y + 15 - i, w + 2 - Math.round(i * 0.5), 1, i > 8 ? '#f6fdff' : '#cfeaf6');
  // screen
  block(g, x + 6, y - 22, 34, 22, '#d8f0fa', { top: 2 });
  R(g, x + 9, y - 19, 28, 16, '!#05303e');
  for (let i = 0; i < 28; i += 4) R(g, x + 9 + i, y - 19, 0.5, 16, '!#0c5060');
  for (let i = 0; i < 16; i += 4) R(g, x + 9, y - 19 + i, 28, 0.5, '!#0c5060');
  S.screens.push({ x: x + 9, y: y - 19, w: 28, h: 16 });
  // dials
  for (let i = 0; i < 2; i++) {
    const dx = x + 50 + i * 16, dy = y - 8;
    outlinedBlob(g, dx, dy, 6, 6, (u, v) => (u * u + v * v > 0.7 ? '#9fd6ee' : '#ffffff'));
    line(g, dx, dy, dx + (i ? 3 : -2), dy - 3, '!#ff4a6a');
  }
  // buttons + LEDs
  const bc = ['#ff5a6a', '#ffd23a', '#7fe03a', '#35c8ff'];
  for (let i = 0; i < 4; i++) block(g, x + 10 + i * 9, y + 8, 6, 3, bc[i], { top: 1, glint: false });
  for (let i = 0; i < 6; i++) S.leds.push({ x: x + w - 34 + i * 5, y: y + 7, c: ['#7fff7a', '#ff5a6a', '#35d8ff', '#ffd23a'][i % 4], ph: i * 1.37 });
  // a lever
  line(g, x + w - 8, y + 2, x + w - 3, y - 10, '#4f8cb4', 1); outlinedBlob(g, x + w - 3, y - 11, 2, 2, (u, v) => rampAt('#ff5a6a', lit(u, v)));
  // the specimen dome on a pedestal at the back
  const dx = x + w - 30, dy = y - 16;
  block(g, dx - 14, dy - 2, 28, 6, '#9fd6ee', { top: 2 });
  disk(g, dx, dy - 2, 15, OUT, 17);
  blob(g, dx, dy - 2, 14, 16, (u, v, xx, yy) => (yy >= 0 ? null : u < -0.55 && v < -0.2 ? '#ffffff@0.55' : '!#7fe4ff@0.35'));
  R(g, dx - 15, dy - 3, 30, 1, OUT);
  S.dome = { x: dx, y: dy - 10 };
  R(g, dx - 9, dy - 14, 2, 4, '#ffffff@0.7');
}
// a cluster of gas cylinders (rounded voxel capsules with valves and a colour band)
function cylinders(g, x, yb, list) {
  let cx = x;
  for (const [c, hh, wd] of list) {
    const top = yb - hh, r = wd / 2;
    outlinedBlob(g, cx + r, top + r, r, r, (u, v) => (v > 0 ? null : rampAt(c, lit(u, v) * 0.8 + 0.1)));
    block(g, cx, top + r, wd, hh - r, c, { top: 0 });
    R(g, cx + 2, top + 3, 1, hh - 6, '#ffffff@0.65');
    R(g, cx, top + Math.round(hh * 0.3), wd, 4, '#f2fcff'); R(g, cx, top + Math.round(hh * 0.3) + 3, wd, 1, '#9fd6ee');
    block(g, cx + r - 2, top - 5, 4, 5, '#9fd6ee', { top: 1, glint: false }); block(g, cx + r - 4, top - 7, 8, 2, '#4f8cb4', { top: 0, glint: false });
    cx += wd + 3;
  }
}
function lamp(g, x, y0, len, S) {
  R(g, x, y0, 1, len, '#1a3a5a'); R(g, x + 0.5, y0, 0.5, len, '#4f8cb4');
  const y = y0 + len;
  block(g, x - 2, y, 5, 3, '#9fd6ee', { top: 1, glint: false });
  for (let i = 0; i < 8; i++) { const hw = 3 + Math.round(Math.sqrt(i) * 3.6); R(g, x - hw - 1, y + 3 + i, hw * 2 + 3, 1, OUT); R(g, x - hw, y + 3 + i, hw * 2 + 1, 1, i < 2 ? '#7fd8ff' : i < 6 ? '#2fa6e0' : '#1d7fbc'); }
  R(g, x - 10, y + 11, 21, 1, OUT);
  disk(g, x + 1, y + 12, 4, '!#fff8d0', 3);
  S.lamps.push({ x: x + 1, y: y + 12 });
}

// ------------------------------------------------------------------ the near bench (counter along the bottom)
function bench(g, W, top, H, seed, S, items) {
  block(g, -2, top, W + 4, 6, '#f2fcff', { top: 3 });
  R(g, -2, top + 6, W + 4, 2, '#7cc0e0'); R(g, -2, top + 8, W + 4, 1, OUT);
  for (let x = -20 + Math.round(hash1(seed, 1) * 20); x < W; x += 66) {
    block(g, x + 3, top + 12, 60, H - top - 10, '#2a96d0', { top: 1 });
    R(g, x + 8, top + 17, 50, H - top - 22, '#2486c0'); R(g, x + 8, top + 17, 50, 1, '#1a6aa0');
    block(g, x + 26, top + 20, 14, 3, '#e8f8ff', { top: 1, glint: false });
  }
  const yb = top;
  for (const it of items) {
    const x = Math.round(it.f * W);
    if (it.k === 'scope') {
      block(g, x - 10, yb - 4, 20, 4, '#e9f8ff', { top: 1 });
      block(g, x + 2, yb - 26, 5, 22, '#e9f8ff', { top: 0 });
      block(g, x - 8, yb - 12, 14, 3, '#35a8e0', { top: 1, glint: false });
      for (let i = 0; i < 18; i++) R(g, x - 6 + Math.round(i * 0.35) - 1, yb - 30 + i, 6, 1, i === 0 ? OUT : OUT);
      for (let i = 1; i < 17; i++) R(g, x - 6 + Math.round(i * 0.35), yb - 30 + i, 4, 1, i < 4 ? '#f2fcff' : '#bfe0f0');
      block(g, x - 5, yb - 16, 4, 3, '#2c5f88', { top: 0, glint: false });
      block(g, x - 8, yb - 34, 7, 4, '#35a8e0', { top: 1 });
    } else if (it.k === 'rack') {
      block(g, x - 14, yb - 6, 28, 6, '#e9f8ff', { top: 2 });
      const tc = ['#ff74b4', '#ffd23a', '#7fe03a', '#35d8ff', '#a98aff'];
      for (let i = 0; i < 5; i++) { const tx = x - 12 + i * 5, th = 14 + (i % 2) * 3; R(g, tx - 1, yb - th - 4, 5, th + 1, OUT); R(g, tx, yb - th - 3, 3, th, '#bfe8f6'); R(g, tx, yb - th * 0.55 - 3, 3, th * 0.55, '!' + tc[i]); R(g, tx, yb - th - 3, 1, th, '#ffffff@0.7'); }
      block(g, x - 14, yb - 12, 28, 3, '#9fd6ee', { top: 1, glint: false });
    } else if (it.k === 'bowl') {
      const r = 14, cy = yb - r + 1;
      outlinedBlob(g, x, cy, r, r - 1, (u, v) => (v < -0.6 ? null : v < -0.42 ? '!#c8f8ff' : u < -0.55 && v < 0.3 ? '!#bff4ff' : rampAt('!#3cc0f0', lit(u, v) * 0.6)));
      R(g, x - 8, cy - r + 3, 16, 1, OUT); R(g, x - 7, cy - r + 4, 14, 1, '#e8fbff');
      for (let i = -9; i < 10; i++) R(g, x + i, cy + 8 + Math.round(Math.abs(i) * 0.2), 1, 3, ['#ffd28a', '#ff9ab8', '#f6e2a8'][(i + 30) % 3]);
      R(g, x - 9, cy - 4, 2, 4, '#ffffff@0.7');
      S.bowls.push({ x: x - 9, y: cy - 4, w: 18, h: 10 });
    } else if (it.k === 'books') {
      const cs = ['#ff9a3a', '#35a8e0', '#7fd03a'];
      for (let i = 0; i < 3; i++) { const bw = 26 - i * 3, bx = x - bw / 2 + (i % 2) * 2; block(g, bx, yb - 6 - i * 6, bw, 5, cs[i], { top: 1 }); R(g, bx + 2, yb - 4 - i * 6, bw - 3, 1, '#ffffff'); }
      block(g, x - 6, yb - 24, 12, 6, '#e9f8ff', { top: 1 });
    } else if (it.k === 'hot') {
      block(g, x - 12, yb - 6, 24, 6, '#e9f8ff', { top: 2 });
      R(g, x - 9, yb - 3, 4, 1, '!#ff5a2a'); R(g, x + 6, yb - 3, 2, 2, '!#7fff7a');
      const q = erlen(g, x, yb - 7, 26, 22, '!#7fe03a', 0.5);
      S.flasks.push({ x: q.x, y: q.y, w: q.w, h: q.h, top: q.top, cx: x, steam: true });
    } else if (it.k === 'stand') {
      block(g, x - 12, yb - 3, 24, 3, '#9fd6ee', { top: 1, glint: false });
      R(g, x + 9, yb - 44, 2, 41, OUT); R(g, x + 9.5, yb - 43, 1, 40, '#c4e8f6');
      R(g, x - 8, yb - 22, 19, 2, OUT);
      const q = roundFlask(g, x, yb - 20, 9, '!#ff74b4', 0.6);
      S.flasks.push({ x: q.x, y: q.y, w: q.w, h: q.h, top: q.top, cx: x, steam: true });
      block(g, x - 3, yb - 11, 6, 8, '#4f8cb4', { top: 1, glint: false });
      S.flames.push({ x, y: yb - 12 });
    } else if (it.k === 'duck') {
      outlinedBlob(g, x, yb - 6, 9, 6, (u, v) => rampAt('#ffd23a', lit(u, v)));
      outlinedBlob(g, x + 5, yb - 14, 5, 5, (u, v) => rampAt('#ffd23a', lit(u, v)));
      R(g, x + 9, yb - 14, 4, 2, OUT); R(g, x + 9, yb - 14, 3, 1, '#ff9a3a'); R(g, x + 6, yb - 16, 1, 1, OUT);
    } else if (it.k === 'beaker') {
      jarBody(g, x - 8, yb - 20, 16, 20, '!#35d8ff', 0.5); R(g, x - 10, yb - 21, 4, 2, OUT);
      line(g, x + 4, yb - 26, x - 2, yb - 4, '#e8f8ff', 1);
    } else if (it.k === 'plant') plant(g, x, yb, 20, '#ff9a3a', '#5cc83a');
    else if (it.k === 'note') {
      block(g, x - 12, yb - 3, 24, 3, '#fff8d8', { top: 1, glint: false });
      for (let i = 0; i < 3; i++) R(g, x - 9, yb - 2, 18, 0.5, '#9fc8e0');
      line(g, x - 2, yb - 5, x + 12, yb - 9, '#ffb23a', 1);
    } else if (it.k === 'jar') {
      jarBody(g, x - 9, yb - 26, 18, 26, '!#35c8ff', 0.85);
      block(g, x - 10, yb - 30, 20, 4, '#c4e8f6', { top: 1, glint: false });
      S.jars.push({ x: x - 7, y: yb - 23, w: 14, h: 21, kind: 'kelp', ph: it.f * 9, c: '#ff9a3a' });
      S.jars.push({ x: x - 7, y: yb - 23, w: 14, h: 21, kind: 'fish', ph: it.f * 7, c: '#ff9a3a' });
    } else if (it.k === 'reel') {
      outlinedBlob(g, x, yb - 8, 8, 8, (u, v) => (u * u + v * v < 0.2 ? '#2c5f88' : rampAt('#c4e8f6', lit(u, v))));
      block(g, x - 2, yb - 3, 4, 3, '#4f8cb4', { top: 1, glint: false });
      line(g, x + 4, yb - 8, x + 18, yb - 16, '#ffd23a', 1);
    } else if (it.k === 'vise') {
      block(g, x - 10, yb - 10, 20, 10, '#4f8cb4', { top: 2 });
      block(g, x - 14, yb - 16, 8, 6, '#9fd6ee', { top: 1 }); block(g, x + 6, yb - 16, 8, 6, '#9fd6ee', { top: 1 });
      line(g, x - 40, yb - 30, x + 30, yb - 12, '#c07a3a', 2); line(g, x - 40, yb - 31, x + 30, yb - 13, '#f0b070', 1);
    } else if (it.k === 'spool') {
      for (let i = 0; i < 3; i++) { const sx = x - 12 + i * 12, c = ['#ff74b4', '#7fe03a', '#35d8ff'][i]; block(g, sx - 4, yb - 12, 9, 12, '#e9f8ff', { top: 1, glint: false }); R(g, sx - 3, yb - 9, 7, 6, c); R(g, sx - 3, yb - 9, 7, 1, sh(c, 0.4)); }
    } else if (it.k === 'buoy') {
      outlinedBlob(g, x, yb - 9, 8, 9, (u, v) => (Math.abs(v) < 0.25 ? rampAt('#ffffff', lit(u, v)) : rampAt('#ff5a3a', lit(u, v))));
      block(g, x - 1, yb - 22, 3, 5, '#e8f8ff', { top: 0, glint: false });
    } else if (it.k === 'tools') {
      block(g, x - 16, yb - 10, 32, 10, '#ff5a3a', { top: 2 }); block(g, x - 6, yb - 15, 12, 3, '#9fd6ee', { top: 1, glint: false });
      R(g, x - 13, yb - 6, 26, 1, '#c03a2a');
    }
  }
}

// ------------------------------------------------------------------ scenes
const scenes = new Map();
const LAYERS = { tree: { far: [40, 18], mid: [72, 26], near: [140, 0] } };

function wallBase(g, W, H, C, wain, seed) {
  // ceiling: panels, a trim, chrome + glass pipes
  R(g, 0, 0, W, C, '#0d3860');
  for (let x = (seed * 7) % 36; x < W; x += 36) { R(g, x, 0, 1, C, '#0a2c50'); R(g, x + 1, 0, 1, C, '#164a78'); }
  tileWall(g, 0, C, W, wain - C, 20, seed);
  // the wainscot: ribbed panels with rivets
  R(g, 0, wain, W, H - wain, '#14588a');
  for (let x = 0; x < W; x += 6) R(g, x, wain + 6, 1, H - wain, '#1b6a9e');
  for (let x = 0; x < W; x += 6) R(g, x + 3, wain + 6, 1, H - wain, '#104a78');
  for (let x = (seed * 13) % 96; x < W; x += 96) { R(g, x, wain + 4, 2, H - wain, '#0a3a64'); for (let y = wain + 12; y < H; y += 20) { R(g, x - 3, y, 2, 2, '#9fd6ee'); R(g, x + 3, y, 2, 2, '#9fd6ee'); } }
  // the rail between tiles and wainscot
  block(g, 0, wain - 2, W, 6, '#9fd6ee', { top: 2, glint: false });
  R(g, 0, wain + 4, W, 2, '#000000@0.3');
  // ceiling trim
  block(g, 0, C - 3, W, 4, '#9fd6ee', { top: 1, glint: false });
  R(g, 0, C + 1, W, 2, '#000000@0.3');
}

function buildTree(w, h) {
  const S = { leds: [], cols: [], jars: [], flasks: [], screens: [], lamps: [], bowls: [], flames: [], holes: [], pipes: [], tank: null, dome: null };
  const [fmx, fmy] = LAYERS.tree.far, [mmx, mmy] = LAYERS.tree.mid, [nmx] = LAYERS.tree.near;
  const FW = w + fmx * 2, FH = h + fmy * 2;
  const C = 26 + fmy, wain = Math.round(fmy + h * 0.6);
  const fx = (f) => Math.round(fmx + f * w), fy = (f) => Math.round(fmy + f * h);
  // ---- far: the wall
  DEPTH = 0.42;
  const holes = [[0.335, 0.27, 27], [0.5, 0.235, 34], [0.665, 0.27, 27]].map(([a, b, r]) => ({ x: fx(a), y: fy(b), r }));
  const far = art(FW, FH, (g) => {
    wallBase(g, FW, FH, C, wain, 3);
    // pipes along the ceiling, dropping down the wall
    pipeH(g, 0, FW, C + 3, 7, 'chrome');
    pipeH(g, 0, FW, C + 12, 5, 'glass', '#5fe08a');
    for (let x = 60; x < FW; x += 128) flange(g, x, C + 6, 5, 11);
    for (const f of [0.25, 0.75]) pipeV(g, fx(f) - 3, C + 10, wain, 6, 'chrome');
    pipeV(g, fx(0.42) - 2, C + 17, fy(0.13), 4, 'glass', '#ff74b4');
    // blueprints, the species chart and the clock
    blueprint(g, fx(0.03), fy(0.13), 46, 34, 'fish');
    blueprint(g, fx(0.135), fy(0.17), 38, 30, 'flask');
    clock(g, fx(0.205), fy(0.15), 10);
    chart(g, fx(0.43) - 28, fy(0.42), 42, 30);
    blueprint(g, fx(0.53), fy(0.43), 40, 28, 'rod');
    blueprint(g, fx(0.86), fy(0.06), 42, 30, 'boat');
    // cables drooping across the tiles
    cable(g, fx(0.215), C + 10, fx(0.31), C + 6, 22, '#ffd23a');
    cable(g, fx(0.69), C + 6, fx(0.79), C + 10, 18, '#ff5a6a');
    cable(g, fx(0.58), fy(0.37), fx(0.75), fy(0.4), 10, '#7fe03a');
    for (const H0 of holes) porthole(g, H0.x, H0.y, H0.r);
    bunting(g, fx(0.395), fx(0.605), C + 18, 7, 2);
  });
  S.holes = holes.map((H0, i) => ({ ...H0, sea: seaView(H0.r, 5 + i * 3) }));
  S.pipes.push({ x0: 0, x1: FW, y: C + 13, layer: 'far' });
  // ---- mid: furniture
  DEPTH = 0.3;
  const MW = w + mmx * 2, MH = h + mmy * 2;
  const mfx = (f) => Math.round(mmx + f * w), mfy = (f) => Math.round(mmy + f * h);
  const M = { leds: [], cols: [], jars: [], flasks: [], screens: [], lamps: [], bowls: [], flames: [], tank: null, dome: null };
  const mid = art(MW, MH, (g) => {
    // a big potted plant at the far left, behind the tank stand
    tank(g, mfx(0.035) - 30, mfy(0.52), Math.round(w * 0.2) + 30, Math.round(h * 0.25), M);
    column(g, mfx(0.265), mfy(0.12), mfy(0.86), 12, '#35d8ff', M);
    column(g, mfx(0.735) - 12, mfy(0.12), mfy(0.86), 12, '#ff74b4', M);
    consoleUnit(g, mfx(0.37), mfy(0.7), 120, Math.round(h * 0.22), M);
    shelves(g, mfx(0.79), mfy(0.08), Math.round(w * 0.19) + 40, Math.round(h * 0.76), 4, 11, M);
    lamp(g, mfx(0.43), 0, mmy + 36, M);
    lamp(g, mfx(0.6), 0, mmy + 30, M);
    // tubes linking the columns to the tank and the console
    pipeH(g, mfx(0.235), mfx(0.265) - 1, mfy(0.6), 4, 'glass', '#35d8ff');
    pipeV(g, mfx(0.6), mfy(0.8), mfy(0.98), 4, 'chrome');
    cylinders(g, mfx(0.615), mfy(0.88), [['#7fe03a', 58, 16], ['#35c8ff', 66, 18], ['#ff9a3a', 50, 14]]);
    plant(g, mfx(0.22), mfy(0.89), 24, '#e9f8ff', '#4cc83a');
  });
  // ---- near: the bench
  DEPTH = 0.34;
  const NW = w + nmx * 2, NH = 124, top = 56;
  const N = { leds: [], cols: [], jars: [], flasks: [], screens: [], lamps: [], bowls: [], flames: [], tank: null, dome: null };
  const items = [
    { f: 0.02, k: 'books' }, { f: 0.075, k: 'plant' }, { f: 0.125, k: 'scope' }, { f: 0.2, k: 'rack' }, { f: 0.27, k: 'bowl' },
    { f: 0.34, k: 'note' }, { f: 0.4, k: 'hot' }, { f: 0.47, k: 'duck' }, { f: 0.535, k: 'beaker' }, { f: 0.6, k: 'stand' },
    { f: 0.665, k: 'jar' }, { f: 0.73, k: 'books' }, { f: 0.79, k: 'rack' }, { f: 0.86, k: 'scope' }, { f: 0.92, k: 'plant' }, { f: 0.975, k: 'bowl' },
  ];
  const near = art(NW, NH, (g) => bench(g, NW, top, NH, 4, N, items));
  DEPTH = 0;
  return {
    kind: 'tree', w, h, far: { c: far, mx: fmx, my: fmy, k: 0.035, kz: 4, S }, mid: { c: mid, mx: mmx, my: mmy, k: 0.08, kz: 12, S: M },
    near: { c: near, mx: nmx, top, k: 0.16, kz: 34, S: N, y: h - top - 30 },
  };
}

function sceneFor(w, h, kind) {
  const key = `${kind}|${w}|${h}`;
  let s = scenes.get(key);
  if (!s) {
    s = kind === 'rods' ? buildRods(w, h) : kind === 'boats' ? buildBoats(w, h) : buildTree(w, h);
    scenes.set(key, s);
    if (scenes.size > 4) scenes.delete(scenes.keys().next().value);
  }
  return s;
}

// ------------------------------------------------------------------ per-frame bits
const soft = (v, m) => m * Math.tanh(v / Math.max(1, m));
const q2 = (v) => Math.round(v * 2) / 2;
function fillTok(ctx, c, depth) { const d0 = DEPTH; DEPTH = depth; ctx.fillStyle = dep(c); DEPTH = d0; }

function drawSpots(ctx, S, ox, oy, t, depth) {
  // bubbles rising in the glass columns
  for (const c of S.cols || []) {
    for (let i = 0; i < 7; i++) {
      const q = (t * (0.12 + hash1(i, c.x) * 0.08) + hash1(i, c.y)) % 1;
      const bx = ox + c.x + 1 + hash1(i, 5) * (c.w - 4) + Math.sin(t * 2 + i) * 1, by = oy + c.y + c.h - 3 - q * (c.h - 4);
      ctx.globalAlpha = 0.75; ctx.drawImage(microBubble(i % 3 ? 1 : 1.5), q2(bx), q2(by)); ctx.globalAlpha = 1;
    }
  }
  // bubbling flasks
  for (const f of S.flasks || []) {
    for (let i = 0; i < 2; i++) {
      const q = (t * (0.5 + hash1(i, f.x) * 0.3) + hash1(i, f.y)) % 1;
      ctx.globalAlpha = 0.8; ctx.drawImage(microBubble(1), q2(ox + f.x + 1 + hash1(i, 3) * Math.max(1, f.w - 3)), q2(oy + f.y + f.h - q * f.h)); ctx.globalAlpha = 1;
    }
    if (f.steam) { const q = (t * 0.35 + f.x * 0.01) % 1; ctx.globalAlpha = (1 - q) * 0.6; ctx.drawImage(microBubble(1 + q), q2(ox + f.cx - 1 + Math.sin(t * 2 + f.x) * 2), q2(oy + f.top - 2 - q * 16)); ctx.globalAlpha = 1; }
  }
  // specimen jars: a bobbing fish or a swaying sprig of kelp
  for (const j of S.jars || []) {
    if (j.kind === 'fish') {
      const sp = fishSprite(7, j.c, Math.sin(t * 0.4 + j.ph) < 0, depth);
      const fx = j.x + (j.w - sp.width) / 2 + Math.sin(t * 0.4 + j.ph) * (j.w - sp.width) * 0.4, fy = j.y + j.h * 0.38 + Math.sin(t * 1.6 + j.ph) * 1.5;
      ctx.drawImage(sp, q2(ox + fx), q2(oy + fy));
    } else if (j.kind === 'kelp') drawKelp(ctx, ox + j.x + j.w * 0.35, oy + j.y + j.h, j.h * 0.8, t, j.ph, '#5cc83a', depth, 0.8);
    else if (j.kind === 'jelly') {
      const jy = oy + j.y + j.h * 0.35 + Math.sin(t * 1.2 + j.ph) * 2, jx = ox + j.x + j.w / 2;
      fillTok(ctx, '!#ffb8f0', depth); ctx.fillRect(q2(jx - 3), q2(jy), 6, 3); ctx.fillRect(q2(jx - 2), q2(jy - 1), 4, 1);
      fillTok(ctx, '!#ff74d4', depth); for (let k = 0; k < 3; k++) ctx.fillRect(q2(jx - 2 + k * 2), q2(jy + 3), 0.5, 3 + Math.sin(t * 3 + k) * 1);
    }
  }
  // the goldfish bowls
  for (const b of S.bowls || []) {
    const u = (t * 0.25 + b.x * 0.01) % 2, dir = u < 1, k = dir ? u : 2 - u;
    const sp = fishSprite(8, '#ff9a3a', !dir, depth);
    ctx.drawImage(sp, q2(ox + b.x + k * (b.w - sp.width)), q2(oy + b.y + 2 + Math.sin(t * 2 + b.x) * 1.5));
  }
  // burner flames (tiny flickering pixel flames)
  for (const f of S.flames || []) {
    const fl = Math.sin(t * 17 + f.x) > 0 ? 1 : 0;
    fillTok(ctx, '!#35c8ff', depth); ctx.fillRect(ox + f.x - 1, oy + f.y - 3 - fl, 2, 3 + fl);
    fillTok(ctx, '!#e8fbff', depth); ctx.fillRect(ox + f.x - 0.5, oy + f.y - 1.5, 1, 1.5);
  }
  // blinking LEDs (stepped, not pulsing glows)
  for (const l of S.leds || []) {
    const on = ((t * 0.9 + l.ph) % 1.7) < 1.1;
    fillTok(ctx, on ? '!' + l.c : sh(l.c, -0.55), depth);
    ctx.fillRect(ox + l.x, oy + l.y, 2, 2);
    if (on) { ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.fillRect(ox + l.x, oy + l.y, 0.5, 0.5); }
  }
  // the console screens: a scrolling sine trace
  for (const s of S.screens || []) {
    fillTok(ctx, '!#7fff9a', depth);
    for (let i = 0; i < s.w; i++) { const y = s.h / 2 + Math.sin(i * 0.45 - t * 4) * (s.h * 0.28) * Math.sin(t * 0.7 + i * 0.05); ctx.fillRect(ox + s.x + i, q2(oy + s.y + y), 1, 1); }
    fillTok(ctx, '!#ffd23a', depth); ctx.fillRect(ox + s.x + 2, oy + s.y + 2, Math.round((Math.sin(t * 0.5) * 0.5 + 0.5) * 10), 1);
  }
  // the specimen dome: a little fish turning slowly
  if (S.dome) {
    const sp = fishSprite(10, '#35d8ff', Math.sin(t * 0.5) < 0, depth);
    ctx.drawImage(sp, q2(ox + S.dome.x - sp.width / 2), q2(oy + S.dome.y - sp.height / 2 + Math.sin(t * 1.4) * 2));
  }
  // the tank: fish, kelp, the bubbler
  if (S.tank) {
    const T = S.tank;
    for (let i = 0; i < 4; i++) drawKelp(ctx, ox + T.x + 6 + hash1(i, 41) * (T.w - 12), oy + T.floor + 1, T.h * (0.45 + hash1(i, 42) * 0.4), t, i * 1.7, i % 2 ? '#3cb83a' : '#5cd84a', depth, 1);
    const cols = ['#ff9a3a', '#ffd23a', '#ff74b4', '#35d8ff', '#7fe03a'];
    for (let i = 0; i < 5; i++) {
      const len = 8 + (i % 3) * 3, sp0 = 0.035 + hash1(i, 43) * 0.04;
      const u = (t * sp0 + hash1(i, 44) * 2) % 2, right = u < 1, k = right ? u : 2 - u;
      const sp = fishSprite(len, cols[i], !right, depth);
      ctx.drawImage(sp, q2(ox + T.x + 2 + k * (T.w - sp.width - 4)), q2(oy + T.y + 4 + hash1(i, 45) * (T.h - 20) + Math.sin(t * 1.3 + i) * 2));
    }
    for (let i = 0; i < 6; i++) {
      const q = (t * 0.35 + i / 6) % 1;
      ctx.globalAlpha = 0.85; ctx.drawImage(microBubble(i % 2 ? 1 : 1.5), q2(ox + T.x + T.w * 0.86 + Math.sin(t * 3 + i * 2) * 2), q2(oy + T.floor - 2 - q * (T.floor - T.y - 2))); ctx.globalAlpha = 1;
    }
  }
  // the hanging lamps' bulbs flicker very slightly (no light cones)
  for (const l of S.lamps || []) { fillTok(ctx, '!#ffffff', depth); ctx.globalAlpha = 0.5 + 0.2 * Math.sin(t * 2.3 + l.x); ctx.fillRect(ox + l.x - 2, oy + l.y - 1, 3, 1); ctx.globalAlpha = 1; }
}

function drawKelp(ctx, x, yb, h, t, ph, col, depth, a = 1) {
  const n = Math.max(3, Math.floor(h / 2));
  ctx.globalAlpha = a;
  for (let i = 0; i < n; i++) {
    const k = i / n, sw = Math.sin(t * 1.2 + ph + i * 0.22) * k * k * 4;
    const px = q2(x + sw), py = q2(yb - i * 2 - 2);
    fillTok(ctx, i % 2 ? col : sh(col, -0.2), depth); ctx.fillRect(px, py, 2, 2);
    if (i % 4 === 2 && i < n - 1) { const s = (i % 8 < 4 ? 1 : -1); fillTok(ctx, sh(col, 0.25), depth); ctx.fillRect(px + (s > 0 ? 2 : -2), py, 2, 1); }
  }
  ctx.globalAlpha = 1;
}

// the sea behind each porthole: the view sprite (parallax), passing fish and rising bubbles
function drawHoles(ctx, S, ox, oy, t, extra) {
  for (let i = 0; i < S.holes.length; i++) {
    const H0 = S.holes[i], sv = H0.sea;
    const sx = ox + H0.x - sv.width / 2 + soft(extra, 12), sy = oy + H0.y - sv.height / 2;
    ctx.drawImage(sv, q2(sx), q2(sy));
    for (let f = 0; f < 3; f++) {
      const len = 7 + ((f + i) % 3) * 3, right = (f + i) % 2 === 0, span = H0.r * 2 + 40;
      const u = (t * (6 + hash1(f, i) * 6) + hash1(f, i + 9) * span) % span;
      const fx = right ? -H0.r - 20 + u : H0.r + 20 - u;
      const sp = fishSprite(len, ['#ffd23a', '#ff9a3a', '#ff74b4', '#e8fbff'][(f + i) % 4], !right, 0.3, false);
      ctx.drawImage(sp, q2(ox + H0.x + fx + soft(extra, 12) * 0.5), q2(oy + H0.y - H0.r * 0.4 + f * H0.r * 0.35 + Math.sin(t * 1.5 + f) * 2));
    }
    for (let b = 0; b < 3; b++) {
      const q = (t * 0.18 + b / 3 + i * 0.3) % 1;
      ctx.globalAlpha = 0.6; ctx.drawImage(microBubble(1), q2(ox + H0.x - H0.r * 0.5 + hash1(b, i) * H0.r + Math.sin(t + b) * 2), q2(oy + H0.y + H0.r - q * H0.r * 2)); ctx.globalAlpha = 1;
    }
  }
}

// blips of light running along the glass pipes
function drawPipeFlow(ctx, S, ox, oy, t) {
  for (const p of S.pipes || []) {
    for (let i = 0; i < 5; i++) {
      const x = ox + p.x0 + ((t * 40 + i * (p.x1 - p.x0) / 5) % (p.x1 - p.x0));
      ctx.fillStyle = 'rgba(236,255,240,0.75)'; ctx.fillRect(Math.round(x), oy + p.y, 3, 1);
      ctx.fillStyle = 'rgba(236,255,240,0.35)'; ctx.fillRect(Math.round(x) - 3, oy + p.y, 3, 1);
    }
  }
}

const veils = new Map();
function veil(ctx, v, kind) {
  const key = `${kind}|${v.x}|${v.y}|${v.w}|${v.h}`;
  let V = veils.get(key);
  if (!V) {
    const r = ctx.createRadialGradient(v.x + v.w / 2, v.y + v.h * 0.48, Math.min(v.w, v.h) * 0.25, v.x + v.w / 2, v.y + v.h * 0.48, Math.max(v.w, v.h) * 0.7);
    const k = kind === 'tree' ? 1 : kind === 'rods' ? 0.8 : 0.45;
    r.addColorStop(0, 'rgba(3,14,32,0)'); r.addColorStop(0.6, `rgba(3,14,32,${0.18 * k})`); r.addColorStop(1, `rgba(2,8,22,${0.5 * k})`);
    const l = ctx.createLinearGradient(0, v.y, 0, v.y + v.h);
    l.addColorStop(0, `rgba(2,10,26,${0.35 * k})`); l.addColorStop(0.12, 'rgba(2,10,26,0)'); l.addColorStop(0.85, 'rgba(2,10,26,0)'); l.addColorStop(1, `rgba(2,10,26,${0.3 * k})`);
    V = { r, l };
    veils.set(key, V);
    if (veils.size > 8) veils.delete(veils.keys().next().value);
  }
  ctx.fillStyle = V.r; ctx.fillRect(v.x, v.y, v.w, v.h);
  ctx.fillStyle = V.l; ctx.fillRect(v.x, v.y, v.w, v.h);
  if (kind === 'rods') { ctx.fillStyle = 'rgba(4,22,48,0.22)'; ctx.fillRect(v.x, v.y, v.w, v.h); } // the white tiles pop
}

// ------------------------------------------------------------------ public
const ZERO = { x: 0, y: 0, z: 0 };
// The static layers (wall, furniture and, outside the tree, the bench + veil) are blitted into one cached composite
// once the camera has held still for a couple of frames; while it glides they are drawn straight. Animated bits go on
// top, and what sits behind the wall (the sea through the portholes, the sky through the gate) goes underneath: the
// composite keeps the wall's holes transparent.
export function drawLabRoom(ctx, v, t, cam = ZERO, kind = 'tree', o = {}) {
  const w = Math.round(v.w), h = Math.round(v.h);
  const sc = sceneFor(w, h, kind);
  const off = (Lr) => {
    const my = Lr.my || 0, dy = clamp(soft(-cam.y * Lr.k * 0.6, Math.max(1, my - 1)) + cam.z * Lr.kz, -Math.max(0, my - 1), Math.max(0, my - 1));
    return [q2(-Lr.mx + soft(-cam.x * Lr.k, Math.max(1, Lr.mx - 1))), q2(-my + dy)];
  };
  const F = off(sc.far), M = sc.mid ? off(sc.mid) : null;
  const N = sc.near ? [q2(-sc.near.mx + soft(-cam.x * sc.near.k, sc.near.mx - 1)), q2(sc.near.y + clamp(cam.z * sc.near.kz, -16, 40))] : null;
  const inComp = kind !== 'tree'; // the tree's bench slides with the zoom and its vignette lives in the fog
  ctx.fillStyle = '#061c36'; ctx.fillRect(v.x, v.y, v.w, v.h);
  // behind the wall
  if (sc.far.S.holes?.length) drawHoles(ctx, sc.far.S, v.x + F[0], v.y + F[1], t, -cam.x * 0.03);
  if (sc.far.S.gate) drawGate(ctx, sc.far.S, v.x + F[0], v.y + F[1], t);
  const hiF = isHi(ctx) || 1;
  const key = `${F}|${M}|${inComp ? N : ''}|${hiF}|${v.x}|${v.y}`;
  if (key === sc.key) sc.stable = (sc.stable || 0) + 1; else { sc.key = key; sc.stable = 0; }
  const still = (g, x0, y0) => {
    g.drawImage(sc.far.c, x0 + F[0], y0 + F[1]);
    o.afterFar?.(g, x0, y0);
    if (M) g.drawImage(sc.mid.c, x0 + M[0], y0 + M[1]);
    if (N && inComp) g.drawImage(sc.near.c, x0 + N[0], y0 + N[1]);
    if (inComp) veil(g, { x: x0, y: y0, w, h }, kind);
  };
  if (sc.stable >= 2) {
    if (sc.compKey !== key) {
      if (!sc.comp || sc.comp.width !== w * hiF || sc.comp.height !== h * hiF) sc.comp = makeCanvas(w * hiF, h * hiF);
      const g = hiF > 1 ? hiCtx(sc.comp, hiF) : ctxOf(sc.comp);
      g.clearRect(0, 0, w, h);
      still(g, 0, 0);
      sc.compKey = key;
    }
    ctx.drawImage(sc.comp, v.x, v.y, w, h);
  } else still(ctx, v.x, v.y);
  // animated bits on top
  drawPipeFlow(ctx, sc.far.S, v.x + F[0], v.y + F[1], t);
  drawSpots(ctx, sc.far.S, v.x + F[0], v.y + F[1], t, 0.42);
  if (sc.far.S.water) drawDock(ctx, sc.far.S, v.x + F[0], v.y + F[1], t, w);
  if (M) drawSpots(ctx, sc.mid.S, v.x + M[0], v.y + M[1], t, 0.3);
  if (N) {
    if (!inComp) ctx.drawImage(sc.near.c, v.x + N[0], v.y + N[1]);
    drawSpots(ctx, sc.near.S, v.x + N[0], v.y + N[1], t, 0.34);
  }
  return sc;
}

export function labRoomScene(v, kind) { return sceneFor(Math.round(v.w), Math.round(v.h), kind); }

// ------------------------------------------------------------------ rods: the tackle workshop
// a pegboard with hanging tools
function pegboard(g, x, y, w, h, seed) {
  R(g, x + 2, y + 2, w, h, '#000000@0.3');
  block(g, x, y, w, h, '#d8f0fa', { top: 0, glint: false });
  for (let yy = y + 4; yy < y + h - 2; yy += 6) for (let xx = x + 4; xx < x + w - 2; xx += 6) R(g, xx, yy, 1, 1, '#7fb0c8');
  let cx = x + 8, k = 0;
  while (cx < x + w - 12) {
    const r = hash2(k++, 1, seed), top = y + 6;
    if (r < 0.2) { // wrench
      R(g, cx, top + 6, 3, 22, OUT); R(g, cx + 0.5, top + 7, 2, 20, '#c4e8f6');
      block(g, cx - 2, top, 7, 6, '#c4e8f6', { top: 1, glint: false }); R(g, cx, top - 1, 3, 3, '#d8f0fa');
      cx += 14;
    } else if (r < 0.38) { // hammer
      R(g, cx + 3, top + 5, 3, 24, OUT); R(g, cx + 3.5, top + 6, 2, 22, '#e0a060');
      block(g, cx - 1, top, 11, 6, '#4f8cb4', { top: 1 });
      cx += 16;
    } else if (r < 0.54) { // screwdrivers
      for (let i = 0; i < 2; i++) { const c = i ? '#ff5a6a' : '#ffd23a'; block(g, cx + i * 7, top, 4, 9, c, { top: 1, glint: false }); R(g, cx + i * 7 + 1.5, top + 10, 1, 12, '#9fb8c8'); }
      cx += 18;
    } else if (r < 0.72) { // a coil of fishing line
      const c = ['#ff74b4', '#7fe03a', '#35d8ff', '#ffd23a'][k % 4];
      for (let i = 0; i < 4; i++) ellipseLine(g, cx + 8, top + 10, 7 - i * 0.6, 8 - i * 0.6, i % 2 ? c : sh(c, -0.25));
      R(g, cx + 7, top - 1, 2, 3, OUT);
      cx += 22;
    } else if (r < 0.86) { // a landing net
      ellipseLine(g, cx + 9, top + 9, 8, 8, '#4f8cb4');
      for (let i = -6; i <= 6; i += 3) { R(g, cx + 9 + i, top + 3, 0.5, 12, '#9fc8dc'); R(g, cx + 3, top + 9 + i, 12, 0.5, '#9fc8dc'); }
      R(g, cx + 8, top + 17, 2, 14, OUT); R(g, cx + 8.5, top + 18, 1, 12, '#e0a060');
      cx += 22;
    } else { // pliers
      line(g, cx + 2, top, cx + 6, top + 22, OUT, 2); line(g, cx + 8, top, cx + 4, top + 22, OUT, 2);
      line(g, cx + 2, top + 12, cx + 5, top + 22, '#ff5a6a', 1); line(g, cx + 8, top + 12, cx + 5, top + 22, '#ff5a6a', 1);
      cx += 14;
    }
  }
}
// rods leaning in a floor rack
function rodRack(g, x, yb, n, seed) {
  const cols = ['#c07a3a', '#35c8ff', '#7fe03a', '#ff74b4', '#ffd23a', '#a98aff', '#e8f8ff'];
  for (let i = 0; i < n; i++) {
    const bx = x + 6 + i * 9, L = 90 + Math.round(hash1(i, seed) * 40), lean = -6 + Math.round(hash1(i, seed + 1) * 12);
    const c = cols[Math.floor(hash1(i, seed + 2) * cols.length)];
    line(g, bx, yb - 2, bx + lean, yb - L, OUT, 3);
    line(g, bx + 1, yb - 2, bx + lean + 1, yb - L, c, 1);
    for (let k = 1; k < 4; k++) { const q = k / 4; R(g, Math.round(bx + lean * q), Math.round(yb - 2 - L * q), 2, 1, '#e8f8ff'); }
    block(g, bx - 1, yb - 20, 4, 14, '#e0a060', { top: 0, glint: false });
    outlinedBlob(g, bx + 4, yb - 18, 3, 3, (u, v) => rampAt('#c4e8f6', lit(u, v)));
  }
  block(g, x, yb - 6, n * 9 + 8, 6, '#9fd6ee', { top: 2 });
  block(g, x, yb - 60, n * 9 + 8, 4, '#9fd6ee', { top: 1, glint: false });
}
function buildRods(w, h) {
  const S = { leds: [], cols: [], jars: [], flasks: [], screens: [], lamps: [], bowls: [], flames: [], holes: [], pipes: [] };
  const C = 22, wain = Math.round(h * 0.6);
  const fx = (f) => Math.round(f * w), fy = (f) => Math.round(f * h);
  DEPTH = 0.3;
  const holes = [{ x: fx(0.5), y: fy(0.2), r: 26 }];
  const far = art(w, h, (g) => {
    wallBase(g, w, h, C, wain, 5);
    pipeH(g, 0, w, C + 3, 7, 'chrome');
    pipeH(g, 0, w, C + 12, 5, 'glass', '#35d8ff');
    for (let x = 40; x < w; x += 120) flange(g, x, C + 6, 5, 11);
    pegboard(g, fx(0.04), fy(0.14), Math.round(w * 0.36), fy(0.3), 3);
    pegboard(g, fx(0.6), fy(0.14), Math.round(w * 0.36), fy(0.3), 8);
    blueprint(g, fx(0.06), fy(0.5), 44, 30, 'rod');
    blueprint(g, fx(0.84), fy(0.5), 40, 30, 'fish');
    chart(g, fx(0.3), fy(0.5), 42, 30);
    clock(g, fx(0.7), fy(0.56), 10);
    for (const H0 of holes) porthole(g, H0.x, H0.y, H0.r);
    rodRack(g, fx(0.015), fy(0.9), 6, 3);
    rodRack(g, w - fx(0.015) - 62, fy(0.9), 6, 7);
    cylinders(g, fx(0.42), fy(0.9), [['#35c8ff', 54, 16], ['#7fe03a', 46, 14]]);
  });
  S.holes = holes.map((H0, i) => ({ ...H0, sea: seaView(H0.r, 21 + i) }));
  S.pipes.push({ x0: 0, x1: w, y: C + 13 });
  DEPTH = 0.26;
  const NH = 70, top = 34;
  const N = { leds: [], cols: [], jars: [], flasks: [], screens: [], lamps: [], bowls: [], flames: [] };
  const items = [{ f: 0.05, k: 'spool' }, { f: 0.15, k: 'reel' }, { f: 0.29, k: 'vise' }, { f: 0.42, k: 'tools' }, { f: 0.52, k: 'duck' }, { f: 0.61, k: 'beaker' },
    { f: 0.7, k: 'reel' }, { f: 0.8, k: 'bowl' }, { f: 0.9, k: 'plant' }, { f: 0.97, k: 'books' }];
  const near = art(w, NH, (g) => bench(g, w, top, NH, 9, N, items));
  DEPTH = 0;
  return { kind: 'rods', w, h, far: { c: far, mx: 0, my: 0, k: 0, kz: 0, S }, near: { c: near, mx: 0, top, k: 0, kz: 0, S: N, y: h - NH + 8 } };
}

// ------------------------------------------------------------------ boats: the dock hangar with a sea gate
function lifeRing(g, cx, cy, r) {
  outlinedBlob(g, cx, cy, r, r, (u, v) => {
    const d = Math.hypot(u, v);
    if (d < 0.5) return null;
    const a = Math.atan2(v, u), seg = Math.floor(((a + Math.PI) / TAU) * 8) % 2;
    return rampAt(seg ? '#ffffff' : '#ff5a3a', lit(u, v) * (d > 0.75 ? 1 : -1));
  });
  disk(g, cx, cy, Math.round(r * 0.5), '#000000@0');
  g.save(); g.globalCompositeOperation = 'destination-out'; disk(g, cx, cy, Math.round(r * 0.5) - 1, '#000000'); g.restore();
  ellipseLine(g, cx, cy, Math.round(r * 0.5) - 0.5, Math.round(r * 0.5) - 0.5, OUT);
}
function seaGateView(w, h, seed) {
  return spr(`gate|${w}|${h}|${seed}`, w, h, (g) => {
    const hz = Math.round(h * 0.68);
    vgrad(g, 0, 0, w, hz, ['#3a9cf0', '#6fc4fa', '#a8e4ff', '#e2f8ff'], 3);
    // the sun is a soft disc low in the sky (no rays)
    disk(g, Math.round(w * 0.72), Math.round(hz * 0.42), 12, '!#fff8d0'); disk(g, Math.round(w * 0.72), Math.round(hz * 0.42), 9, '!#ffffff');
    // an island with palms on the horizon
    for (let x = 0; x < w; x++) { const d = (x - w * 0.24) / (w * 0.13); if (Math.abs(d) > 1) continue; const t0 = Math.round((1 - d * d) * 14); R(g, x, hz - t0, 1, t0, x % 7 ? '#3aa52a' : '#5cc832'); R(g, x, hz - t0, 1, 1, '#9fe86a'); }
    line(g, w * 0.23, hz - 12, w * 0.235, hz - 26, '#a06a3a', 1); outlinedBlob(g, Math.round(w * 0.236), hz - 27, 6, 2, (u, v) => rampAt('#3aa52a', lit(u, v)));
    // far lighthouse
    block(g, Math.round(w * 0.86), hz - 22, 5, 22, '#ffffff', { top: 0, glint: false }); R(g, Math.round(w * 0.86), hz - 16, 5, 3, '#ff5a3a'); R(g, Math.round(w * 0.86), hz - 8, 5, 3, '#ff5a3a'); block(g, Math.round(w * 0.86) - 1, hz - 26, 7, 4, '#ff5a3a', { top: 1, glint: false }); R(g, Math.round(w * 0.86) + 1, hz - 25, 3, 2, '!#fff6a0');
    // the sea: bands toward the gate, glints
    vgrad(g, 0, hz, w, h - hz, ['#7fd8ff', '#3ab4ec', '#1f8ad8', '#176cc0'], 2);
    R(g, 0, hz, w, 1, '#e8fbff');
    for (let i = 0; i < w * 0.5; i++) { const x = Math.floor(hash1(i, seed) * w), y = hz + 2 + Math.floor(hash1(i, seed + 1) ** 1.4 * (h - hz - 2)); R(g, x, y, 2 + Math.floor(hash1(i, 3) * 4), 1, '!#dff9ff@0.7'); }
  }, 0.12);
}
function cloudSprite(wd, seed) {
  return spr(`cloud|${wd}|${seed}`, wd + 4, Math.round(wd * 0.45) + 4, (g) => {
    const hh = Math.round(wd * 0.45);
    for (const [u, v, r] of [[0.28, 0.62, 0.22], [0.5, 0.42, 0.3], [0.72, 0.6, 0.22], [0.5, 0.72, 0.24]]) disk(g, 2 + Math.round(u * wd), 2 + Math.round(v * hh), Math.round(r * wd) + 1, '#9fd0f0');
    for (const [u, v, r] of [[0.28, 0.62, 0.22], [0.5, 0.42, 0.3], [0.72, 0.6, 0.22], [0.5, 0.72, 0.24]]) disk(g, 2 + Math.round(u * wd), 2 + Math.round(v * hh), Math.round(r * wd), '#ffffff');
    R(g, 2 + Math.round(wd * 0.12), 2 + Math.round(hh * 0.8), Math.round(wd * 0.76), 2, '#d8f0fa');
  }, 0.1);
}
function buildBoats(w, h) {
  const S = { leds: [], cols: [], jars: [], flasks: [], screens: [], lamps: [], bowls: [], flames: [], holes: [], pipes: [] };
  const C = 22, wl = Math.round(h * 0.5);
  const fx = (f) => Math.round(f * w), fy = (f) => Math.round(f * h);
  const gx0 = fx(0.24), gx1 = fx(0.76), gTop = fy(0.13), gr = Math.round((gx1 - gx0) / 2);
  const archTop = gTop + Math.min(gr, Math.round((wl - gTop) * 0.45));
  DEPTH = 0.22;
  const far = art(w, h, (g) => {
    wallBase(g, w, h, C, wl - 4, 6);
    pipeH(g, 0, w, C + 3, 7, 'chrome');
    for (let x = 30; x < w; x += 110) flange(g, x, C + 6, 5, 11);
    // the gate frame (riveted steel with hazard-striped jambs)
    const inGate = (x, y, pad) => {
      if (x < gx0 - pad || x >= gx1 + pad || y >= wl || y < gTop - pad) return false;
      if (y >= archTop) return true;
      const ry = archTop - gTop + pad, rx = gr + pad, u = (x + 0.5 - (gx0 + gx1) / 2) / rx, v = (y + 0.5 - archTop) / ry;
      return u * u + v * v <= 1;
    };
    for (let y = gTop - 12; y < wl; y++) for (let x = gx0 - 12; x < gx1 + 12; x++) {
      if (!inGate(x, y, 10)) continue;
      const o = !inGate(x, y, 9);
      g.fillStyle = dep(o ? OUT : inGate(x, y, 7) ? (x < (gx0 + gx1) / 2 ? '#7cbad8' : '#4f8cb4') : '#c4e8f6'); g.fillRect(x, y, 1, 1);
    }
    for (const jx of [gx0 - 9, gx1 + 2]) for (let y = archTop; y < wl - 2; y++) { R(g, jx, y, 7, 1, Math.floor((y + jx) / 5) % 2 ? '#ffd23a' : '#1a2a3a'); }
    for (let i = 0; i <= 12; i++) { const a = Math.PI + (i / 12) * Math.PI, rx = Math.round((gx0 + gx1) / 2 + Math.cos(a) * (gr + 5)), ry = Math.round(archTop + Math.sin(a) * (archTop - gTop + 5)); R(g, rx - 1, ry - 1, 2, 2, '#2c5f88'); R(g, rx - 1, ry - 1, 1, 1, '#ffffff'); }
    g.save(); g.globalCompositeOperation = 'destination-out';
    for (let y = gTop; y < wl; y++) for (let x = gx0; x < gx1; x++) if (inGate(x, y, 0)) g.fillRect(x, y, 1, 1);
    g.restore();
    // wall props
    lifeRing(g, fx(0.1), fy(0.24), 13);
    lifeRing(g, fx(0.9), fy(0.24), 13);
    blueprint(g, fx(0.04), fy(0.34), 44, 30, 'boat');
    blueprint(g, fx(0.85), fy(0.34), 40, 28, 'fish');
    clock(g, fx(0.18), fy(0.1), 9);
    for (const [bx, c] of [[0.82, '#ff5a3a'], [0.17, '#ffd23a']]) { R(g, fx(bx), C + 8, 1, fy(0.2), '#1a3a5a'); outlinedBlob(g, fx(bx), C + 8 + fy(0.2) + 6, 5, 7, (u, v) => (Math.abs(v) < 0.25 ? rampAt('#ffffff', lit(u, v)) : rampAt(c, lit(u, v)))); }
    bunting(g, 0, gx0 - 14, C + 14, 8, 4); bunting(g, gx1 + 14, w, C + 14, 8, 5);
    // the crane rail across the ceiling
    block(g, 0, C + 12, w, 5, '#ffd23a', { top: 1, glint: false });
    for (let x = 4; x < w; x += 10) R(g, x, C + 13, 5, 3, '#1a2a3a');
    // the pool: a curb with tyre bumpers, then the water
    block(g, -2, wl - 6, w + 4, 6, '#d8e8f0', { top: 3 });
    for (let x = 0; x < w; x += 8) R(g, x, wl - 3, 4, 1, '#ffd23a');
    vgrad(g, 0, wl, w, h - wl, ['#5fcaf4', '#2fa2e0', '#1a7cc8', '#0f5aa8'], 3);
    // the pool's tiled floor seen through the water (lines fan out toward the viewer)
    for (let y = wl + 10, s0 = 8; y < h; y += s0, s0 += 2) R(g, 0, y, w, 1, '#0f5aa8@0.35');
    for (let i = -12; i <= 12; i++) { const xt = w / 2 + i * 34; line(g, xt, wl + 6, w / 2 + i * 70, h, '#0f5aa8@0.3'); }
    R(g, 0, wl, w, 2, '#000000@0.25');
    for (const f of [0.08, 0.2, 0.8, 0.92]) { const tx = fx(f); outlinedBlob(g, tx, wl + 1, 6, 5, (u, v) => (u * u + v * v < 0.2 ? null : rampAt('#2a3040', lit(u, v)))); }
    for (let i = 0; i < 60; i++) { const x = Math.floor(hash1(i, 61) * w), y = wl + 6 + Math.floor(hash1(i, 62) * (h - wl - 8)); R(g, x, y, 3 + Math.floor(hash1(i, 63) * 6), 1, '!#bff4ff@0.35'); }
    // a ladder down into the pool on the left
    for (const lx of [fx(0.015), fx(0.015) + 10]) R(g, lx, wl - 14, 2, 30, '#c4e8f6');
    for (let y = wl - 10; y < wl + 16; y += 6) R(g, fx(0.015), y, 12, 1, '#c4e8f6');
  });
  S.gate = { x: gx0, y: gTop, w: gx1 - gx0, h: wl - gTop, sky: seaGateView(gx1 - gx0, wl - gTop, 3) };
  S.water = { y: wl, h: h - wl };
  S.hook = { x: fx(0.62), y: C + 17 };
  DEPTH = 0;
  return { kind: 'boats', w, h, wl, far: { c: far, mx: 0, my: 0, k: 0, kz: 0, S } };
}

// sky, clouds and a gull behind the sea gate; shimmer on the pool; the crane hook swaying
function drawGate(ctx, S, ox, oy, t) {
  const G = S.gate;
  ctx.drawImage(G.sky, ox + G.x, oy + G.y);
  for (let i = 0; i < 4; i++) {
    const cs = cloudSprite(26 + (i % 3) * 10, i), span = G.w + cs.width;
    const x = ((hash1(i, 81) * span + t * (3 + i)) % span) - cs.width;
    ctx.drawImage(cs, q2(ox + G.x + x), q2(oy + G.y + 6 + hash1(i, 82) * G.h * 0.3));
  }
  const gs = (t * 14) % (G.w + 60) - 30, flap = Math.floor(t * 5) % 2;
  ctx.fillStyle = '#25384c';
  const bx = Math.round(ox + G.x + gs), by = Math.round(oy + G.y + G.h * 0.3 + Math.sin(t * 0.8) * 6);
  if (flap) { ctx.fillRect(bx - 3, by - 1, 2, 1); ctx.fillRect(bx - 1, by, 3, 1); ctx.fillRect(bx + 2, by - 1, 2, 1); }
  else { ctx.fillRect(bx - 3, by, 2, 1); ctx.fillRect(bx - 1, by, 3, 1); ctx.fillRect(bx + 2, by, 2, 1); }
}
function drawDock(ctx, S, ox, oy, t, w) {
  const W0 = S.water;
  for (let i = 0; i < 36; i++) {
    const len = 3 + Math.floor(hash1(i, 91) * 8), y = oy + W0.y + 6 + Math.floor(hash1(i, 92) * (W0.h - 10));
    const x = ox + ((hash1(i, 93) * w + t * (4 + hash1(i, 94) * 6)) % w);
    const a = 0.25 + 0.35 * Math.max(0, Math.sin(t * 1.5 + i * 1.3));
    ctx.fillStyle = `rgba(214,250,255,${a.toFixed(2)})`; ctx.fillRect(Math.round(x), y, len, 1);
  }
  // the crane hook: a cable and a hook block, swaying gently
  const H0 = S.hook, sw = Math.sin(t * 0.9) * 4, L = 46;
  const hx = ox + H0.x + sw, hy = oy + H0.y + L;
  fillTok(ctx, '#1a3a5a', 0.22); for (let i = 0; i < L; i++) ctx.fillRect(q2(ox + H0.x + sw * (i / L)), oy + H0.y + i, 1, 1);
  fillTok(ctx, OUT, 0); ctx.fillRect(q2(hx - 5), hy - 1, 10, 9);
  fillTok(ctx, '#ffd23a', 0.22); ctx.fillRect(q2(hx - 4), hy, 8, 7);
  fillTok(ctx, '#fff0a0', 0.22); ctx.fillRect(q2(hx - 4), hy, 8, 2);
  fillTok(ctx, '#1a2a3a', 0.22); ctx.fillRect(q2(hx - 4), hy + 4, 8, 1);
  fillTok(ctx, '#9fd6ee', 0.22); ctx.fillRect(q2(hx - 1), hy + 7, 2, 5); ctx.fillRect(q2(hx - 1), hy + 11, 5, 2); ctx.fillRect(q2(hx + 3), hy + 9, 2, 3);
}
