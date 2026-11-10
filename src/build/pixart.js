// Hand-made-feeling 2D pixel-art icons for the phase 8 progression systems (OWNER: Progression agent).
// Small sprites (12..20 px) are built from shaded primitives on a pixel grid (5-step ramps lit from the top
// left, bayer-dithered steps, a selective darker outline) or from ASCII; every icon is cached per (id, scale).
//
//   pixIcon(id, scale = 1) -> canvas | null      ids: PIX_IDS (materials, tackle, boat parts, tank gear, tabs, UI bits)
//   rodPix(rod, scale = 1) -> canvas             a rod icon from rods.js look {kind, shaft, grip, reel, tip, glow} + perk
//   drawPix(ctx, id, cx, cy, size)               draws an icon centred in a size x size box (integer scale)
//   hasPix(id) -> bool
// Rod icons: 'rod:<id>' also works with pixIcon (needs registerRods(RODS) from rods.js, done at import).

import { makeCanvas, ctxOf } from '../core/canvas.js';
import { shade, mix } from '../core/color.js';
import { bayer, clamp } from '../core/math.js';

const ramp5 = (c) => [shade(c, -0.62), shade(c, -0.3), c, mix(c, '#ffffff', 0.42), mix(c, '#ffffff', 0.86)];
const LX = -0.62, LY = -0.72; // light from the top left

class Pix {
  constructor(w, h) { this.w = w; this.h = h; this.c = new Array(w * h).fill(null); this.noOutline = new Set(); }
  in(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h; }
  set(x, y, col) { x = Math.floor(x); y = Math.floor(y); if (this.in(x, y) && col) this.c[y * this.w + x] = col; return this; }
  get(x, y) { return this.in(x, y) ? this.c[y * this.w + x] : null; }
  // light value -1..1 -> ramp step 1..4 with dither
  step(r, l, x, y) { const k = clamp(Math.floor(2.2 + l * 1.7 + (bayer(x, y) - 0.5) * 0.7), 1, 4); return r[k]; }
  ball(cx, cy, rx, col, ry = rx) {
    const r = ramp5(col);
    for (let y = Math.floor(cy - ry - 1); y <= cy + ry + 1; y++) for (let x = Math.floor(cx - rx - 1); x <= cx + rx + 1; x++) {
      const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry, d2 = dx * dx + dy * dy;
      if (d2 > 1) continue;
      const nz = Math.sqrt(1 - d2);
      let l = dx * LX + dy * LY + nz * 0.35 - 0.2;
      if (dx < -0.25 && dy < -0.25 && d2 < 0.45 && d2 > 0.12) l = 2;
      this.set(x, y, this.step(r, l, x, y));
    }
    return this;
  }
  box(x0, y0, x1, y1, col, flat = false) {
    const r = ramp5(col);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      let c = r[2];
      if (!flat) {
        if (y === y0 || x === x0) c = r[3];
        if (y === y1 || x === x1) c = r[1];
        if (y === y0 && x === x0) c = r[4];
      }
      this.set(x, y, c);
    }
    return this;
  }
  // capsule from (x0,y0) to (x1,y1), radius rad, shaded across its width
  bar(x0, y0, x1, y1, rad, col) {
    const r = ramp5(col);
    const dx = x1 - x0, dy = y1 - y0, L2 = dx * dx + dy * dy || 1;
    const nx = -dy / Math.sqrt(L2), ny = dx / Math.sqrt(L2);
    const s = Math.sign(nx * LX + ny * LY) || 1;
    for (let y = Math.floor(Math.min(y0, y1) - rad - 1); y <= Math.max(y0, y1) + rad + 1; y++) for (let x = Math.floor(Math.min(x0, x1) - rad - 1); x <= Math.max(x0, x1) + rad + 1; x++) {
      const px = x + 0.5, py = y + 0.5;
      const t = clamp(((px - x0) * dx + (py - y0) * dy) / L2, 0, 1);
      const qx = x0 + dx * t, qy = y0 + dy * t;
      const ox = px - qx, oy = py - qy, d = Math.hypot(ox, oy);
      if (d > rad + 0.01) continue;
      const side = (ox * nx + oy * ny) / Math.max(0.5, rad) * s;
      this.set(x, y, this.step(r, side * 0.9 + 0.1, x, y));
    }
    return this;
  }
  line(x0, y0, x1, y1, col) {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let i = 0; i <= n; i++) this.set(Math.round(x0 + ((x1 - x0) * i) / n), Math.round(y0 + ((y1 - y0) * i) / n), col);
    return this;
  }
  poly(pts, col) {
    const r = ramp5(col);
    let y0 = Infinity, y1 = -Infinity, x0 = Infinity, x1 = -Infinity;
    for (const [x, y] of pts) { y0 = Math.min(y0, y); y1 = Math.max(y1, y); x0 = Math.min(x0, x); x1 = Math.max(x1, x); }
    for (let y = Math.floor(y0); y <= y1; y++) for (let x = Math.floor(x0); x <= x1; x++) {
      const px = x + 0.5, py = y + 0.5;
      let inside = false;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const [xi, yi] = pts[i], [xj, yj] = pts[j];
        if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
      }
      if (!inside) continue;
      const l = -(((px - x0) / Math.max(1, x1 - x0)) * 0.9 + ((py - y0) / Math.max(1, y1 - y0)) * 1.1 - 1);
      this.set(x, y, this.step(r, l, x, y));
    }
    return this;
  }
  // rows of chars; pal maps char -> colour ('.' / ' ' = empty)
  ascii(rows, pal, ox = 0, oy = 0) {
    rows.forEach((row, y) => [...row].forEach((ch, x) => { const c = pal[ch]; if (c) this.set(ox + x, oy + y, c); }));
    return this;
  }
  glint(x, y) { this.set(x, y, '#ffffff'); this.noOutline.add(y * this.w + x); return this; }
  thin(x, y, col) { if (this.in(x, y)) { this.set(x, y, col); this.noOutline.add(y * this.w + x); } return this; }
  outline(col = null) {
    const add = [];
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      if (this.get(x, y)) continue;
      let n = null;
      for (const [ax, ay] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const q = this.get(x + ax, y + ay); if (q && !this.noOutline.has((y + ay) * this.w + x + ax)) { n = q; break; } }
      if (n) add.push([x, y, col || shade(n, -0.66)]);
    }
    for (const [x, y, c] of add) this.set(x, y, c);
    return this;
  }
  canvas(scale = 1) {
    const cv = makeCanvas(this.w * scale, this.h * scale), g = ctxOf(cv);
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      const c = this.c[y * this.w + x];
      if (!c) continue;
      g.fillStyle = c;
      g.fillRect(x * scale, y * scale, scale, scale);
    }
    return cv;
  }
}

// ---------------------------------------------------------------- icon recipes (16 x 16 unless noted)
const S = 16;
const HOOK = (p, x, y, col = '#c8d6e6') => { p.set(x, y, col).set(x, y + 1, col).set(x, y + 2, col).set(x + 1, y + 3, col).set(x + 2, y + 2, col); return p; };

const ART = {
  // ---------------- materials
  clover_leaf() {
    const p = new Pix(S, S);
    p.bar(8, 9, 11, 15, 0.8, '#2e8a2a');
    for (const [x, y] of [[5.5, 5.5], [10.5, 5.5], [5.5, 10], [10.5, 10]]) p.ball(x, y, 3.4, '#5ccf3a');
    p.set(8, 8, '#2e8a2a').glint(4, 4).glint(9, 4);
    return p.outline();
  },
  ice_shard() {
    const p = new Pix(S, S);
    p.poly([[8, 1], [13, 6], [11, 15], [5, 15], [3, 6]], '#8ad8ff');
    p.poly([[8, 1], [8, 15], [5, 15], [3, 6]], '#c8f0ff');
    p.line(8, 3, 8, 13, '#ffffff').line(5, 7, 6, 12, '#e8fbff');
    return p.outline('#2a6aa0');
  },
  spring_coil() {
    const p = new Pix(S, S);
    for (let i = 0; i < 5; i++) { p.bar(3, 3 + i * 2.6, 13, 4.3 + i * 2.6, 0.9, i % 2 ? '#97a2b8' : '#c8d2e0'); }
    p.bar(13, 2, 13, 4, 0.7, '#97a2b8').bar(3, 13, 3, 15, 0.7, '#97a2b8');
    return p.outline();
  },
  magnet_stone() {
    const p = new Pix(S, S);
    p.bar(4, 3, 4, 10, 2, '#ff4f5e').bar(12, 3, 12, 10, 2, '#3a8cff');
    for (let a = 0; a <= 12; a++) { const t = Math.PI * (a / 12); p.bar(8 - Math.cos(t) * 4, 10 + Math.sin(t) * 3.5, 8 - Math.cos(t) * 4, 10 + Math.sin(t) * 3.5, 2, a < 6 ? '#ff4f5e' : '#3a8cff'); }
    p.box(2, 1, 6, 3, '#e8eef4').box(10, 1, 14, 3, '#e8eef4');
    return p.outline();
  },
  lava_glass() {
    const p = new Pix(S, S);
    p.poly([[3, 12], [6, 2], [10, 1], [14, 8], [11, 15], [4, 15]], '#4a2a3a');
    p.poly([[6, 9], [8, 4], [11, 7], [10, 12], [7, 13]], '#ff7a2a');
    p.line(8, 6, 9, 10, '#ffe27a').glint(7, 4);
    return p.outline('#1a0a14');
  },
  fish_scale() {
    const p = new Pix(S, S);
    p.ascii([
      '......oo......',
      '....oo44oo....',
      '...o344w43o...',
      '..o34444w43o..',
      '.o3444444443o.',
      '.o3p44444443o.',
      'o32p4444444p3o',
      'o322333333223o',
      'o32p4444444p3o',
      '.o3444444443o.',
      '.o2333333332o.',
      '..o22pppp22o..',
      '...oo2222oo...',
      '.....oooo.....',
    ], { o: '#1a6a8a', 2: '#2f9ac8', 3: '#4cc4e8', 4: '#8eeaff', w: '#ffffff', p: '#ffb0e0' }, 1, 1);
    return p;
  },
  fin_ribbon() {
    const p = new Pix(S, S);
    p.poly([[2, 14], [3, 4], [8, 1], [14, 3], [13, 9]], '#ff8ac8');
    for (let i = 0; i < 4; i++) p.line(3, 13, 4 + i * 3, 2 + (i === 3 ? 2 : 0), '#ffd0e8');
    p.ball(3, 13, 1.6, '#ffb83a');
    return p.outline();
  },
  glow_bulb() {
    const p = new Pix(S, S);
    p.bar(8, 1, 10, 6, 0.8, '#3a6a5a');
    p.ball(8, 10, 5, '#c8ff6a');
    p.ball(7, 9, 2.4, '#fffbd0');
    p.glint(6, 7);
    return p.outline('#1a3a2a');
  },
  // ---------------- tackle: reels
  reel_spin() { return reelArt('#c8d2e0', '#3a8cff'); },
  reel_turbo() { const p = reelArt('#ffb43c', '#ff4f5e'); p.line(12, 1, 10, 4, '#fff27a').line(10, 4, 13, 4, '#fff27a').line(13, 4, 11, 7, '#fff27a'); return p; },
  reel_gold() { const p = reelArt('#ffd23a', '#ffffff'); p.glint(3, 5).glint(12, 12); return p; },
  // lines: spools
  line_braid() { return spoolArt('#8ae84a'); },
  line_glow() { const p = spoolArt('#7affe8'); p.glint(5, 7).glint(10, 9); return p; },
  line_titan() { return spoolArt('#97a2b8', '#3a4a5a'); },
  // lures
  lure_spoon() {
    const p = new Pix(S, S);
    p.ball(7, 7, 3.6, '#e8eef4', 5.4);
    p.ball(7, 6, 1.6, '#ff4f5e');
    p.set(7, 1, '#97a2b8').set(7, 0, '#97a2b8');
    HOOK(p, 7, 12, '#97a2b8');
    return p.outline();
  },
  lure_frog() {
    const p = new Pix(S, S);
    p.ball(8, 9, 5.2, '#6cd83a', 4.4);
    p.ball(5, 5, 2, '#8ae84a').ball(11, 5, 2, '#8ae84a');
    p.set(5, 5, '#14202c').set(11, 5, '#14202c').glint(4, 4).glint(10, 4);
    p.line(6, 11, 10, 11, '#2e8a2a').ball(8, 12, 1.6, '#ffe27a');
    HOOK(p, 13, 11);
    return p.outline();
  },
  lure_squid() {
    const p = new Pix(S, S);
    p.ball(8, 5, 4, '#ff9ae8', 4.6);
    for (let i = 0; i < 4; i++) p.bar(5 + i * 2, 9, 4 + i * 2.6, 14, 0.6, '#ff6fc8');
    p.set(6, 5, '#14202c').set(10, 5, '#14202c').glint(6, 3);
    p.ball(8, 2, 1, '#fff6b0');
    return p.outline();
  },
  // charms on a ring
  charm_heart() { return charmArt((p) => { p.ball(5.5, 8, 3, '#ff5a7a').ball(10.5, 8, 3, '#ff5a7a').poly([[2.6, 9], [13.4, 9], [8, 15]], '#ff5a7a'); p.glint(4, 6); }); },
  charm_clover() { return charmArt((p) => { for (const [x, y] of [[5.6, 7.6], [10.4, 7.6], [5.6, 12], [10.4, 12]]) p.ball(x, y, 2.7, '#5ccf3a'); p.glint(4, 6); }); },
  charm_star() { return charmArt((p) => { p.poly(starPts(8, 10.5, 6, 2.6), '#ffd23a'); p.glint(7, 7); }); },
  charm_pearl() { return charmArt((p) => { p.ball(8, 10, 4.6, '#f4f0ff'); p.ball(6.6, 8.6, 1.4, '#ffffff'); }); },
  // ---------------- boat parts (tinted by recipe)
  boat_hull(col = '#2fb8e8') {
    const p = new Pix(S, S);
    for (let a = 0; a <= 10; a++) { const t = Math.PI * (a / 10); p.set(Math.round(8 - Math.cos(t) * 6), Math.round(5 - Math.sin(t) * 4), '#97a2b8'); }
    p.box(2, 5, 13, 14, '#c8d2e0');
    p.box(2, 5, 13, 7, col);
    p.bar(5, 7, 5, 11, 0.8, col);
    p.bar(10, 7, 10, 9, 0.8, col);
    p.glint(3, 6).glint(4, 9);
    return p.outline();
  },
  boat_sail(col = '#ffffff') {
    const p = new Pix(S, S);
    p.bar(4, 1, 4, 14, 0.6, '#a07040');
    p.poly([[5, 2], [14, 12], [5, 12]], col);
    p.bar(2, 14, 13, 14, 0.8, '#2fb8e8');
    return p.outline();
  },
  boat_flag(col = '#ff4f5e') {
    const p = new Pix(S, S);
    p.bar(3, 1, 3, 15, 0.6, '#c8d2e0');
    p.poly([[4, 2], [14, 3], [12, 6], [14, 9], [4, 9]], col);
    p.glint(5, 3);
    return p.outline();
  },
  boat_engine(col = '#2fd3e8') {
    const p = new Pix(S, S);
    p.box(5, 2, 11, 8, col);
    p.bar(8, 8, 8, 12, 0.8, '#5a6a80');
    p.ball(5, 13, 2, '#e8eef4', 1.2).ball(11, 13, 2, '#e8eef4', 1.2).ball(8, 13, 1.2, '#97a2b8');
    p.glint(6, 3);
    return p.outline();
  },
  boat_decal(col = '#ffd23a') {
    const p = new Pix(S, S);
    p.box(2, 3, 13, 12, '#ffffff', true);
    p.poly(starPts(7.5, 7.8, 4.6, 2), col);
    p.poly([[10, 12], [13, 9], [13, 12]], '#c8d2e0');
    return p.outline();
  },
  // ---------------- tank gear
  tank_filter() {
    const p = new Pix(S, S);
    p.box(3, 4, 12, 14, '#2fb8e8'); p.box(5, 6, 10, 9, '#bff4ff');
    p.bar(7, 1, 7, 4, 0.7, '#97a2b8');
    p.ball(11, 2, 1.2, '#e8fbff').ball(13, 5, 0.9, '#e8fbff');
    return p.outline();
  },
  tank_heater() {
    const p = new Pix(S, S);
    p.bar(8, 2, 8, 13, 2.2, '#e8fbff');
    p.bar(8, 5, 8, 12, 1, '#ff5a3a');
    p.box(6, 0, 10, 2, '#5a6a80');
    return p.outline();
  },
  tank_light() {
    const p = new Pix(S, S);
    p.box(1, 3, 14, 6, '#e8eef4');
    for (let x = 2; x < 14; x += 3) p.set(x, 6, '#fff27a').set(x + 1, 6, '#fff27a');
    for (let i = 0; i < 4; i++) p.line(2 + i * 3.5, 8, 1 + i * 4, 14, '#fff6b0');
    return p.outline();
  },
  tank_air() {
    const p = new Pix(S, S);
    p.ball(8, 13, 5, '#97a2b8', 2.4);
    p.ball(6, 8, 1.6, '#bff4ff').ball(9, 5, 1.2, '#bff4ff').ball(7, 2, 1, '#e8fbff');
    return p.outline();
  },
  tank_sand() {
    const p = new Pix(S, S);
    p.ball(8, 14, 7, '#ffd890', 5);
    for (let y = 15; y < S; y++) for (let x = 0; x < S; x++) p.set(x, y, null);
    for (const [x, y, c] of [[5, 12, '#ff9ac2'], [9, 11, '#7ae8f0'], [11, 13, '#ffffff'], [7, 13, '#8ae84a']]) p.set(x, y, c);
    return p.outline();
  },
  // ---------------- workshop tabs / UI
  cat_rods() { return rodArt({ kind: 'carbon', shaft: '#2fd3e8', grip: '#0c3a52', reel: '#ffffff', tip: '#c8f56a' }); },
  cat_tackle() { return ART.reel_spin(); },
  cat_upgrade() {
    const p = new Pix(S, S);
    p.poly(starPts(8, 9, 6.5, 3), '#ffd23a');
    p.poly([[8, 0], [12, 4], [10, 4], [10, 6], [6, 6], [6, 4], [4, 4]], '#6cd83a');
    p.glint(7, 7);
    return p.outline();
  },
  cat_bait() {
    const p = new Pix(S, S);
    for (let i = 0; i < 6; i++) p.ball(3 + i * 1.9, 9 + Math.sin(i * 1.3) * 3, 2.2, '#ff8a9a');
    p.set(13, 7, '#14202c').glint(12, 6);
    return p.outline();
  },
  cat_decor() {
    const p = new Pix(S, S);
    p.box(3, 7, 12, 15, '#ffb0c8');
    for (const x of [3, 6, 9, 12]) p.box(x, 4, x, 6, '#ffb0c8');
    p.box(6, 11, 9, 15, '#7a3a5a', true);
    p.bar(8, 0, 8, 3, 0.5, '#97a2b8').poly([[9, 0], [13, 1], [9, 2]], '#ff4f5e');
    return p.outline();
  },
  cat_boat() {
    const p = new Pix(S, S);
    p.poly([[1, 9], [15, 9], [12, 14], [4, 14]], '#2fb8e8');
    p.bar(8, 1, 8, 9, 0.5, '#a07040');
    p.poly([[9, 2], [14, 8], [9, 8]], '#ffffff');
    p.poly([[7, 3], [7, 8], [3, 8]], '#ffd23a');
    return p.outline();
  },
  cat_tank() {
    const p = new Pix(S, S);
    p.ball(8, 9, 6.5, '#bff4ff', 6);
    for (let y = 0; y < 4; y++) for (let x = 0; x < S; x++) p.set(x, y, null);
    p.box(2, 3, 13, 4, '#e8eef4');
    p.ball(8, 10, 2.4, '#ff9a2a', 1.6).poly([[10, 10], [12, 8], [12, 12]], '#ff9a2a');
    p.set(7, 9, '#14202c');
    return p.outline();
  },
  cat_build() { return ART.hammer(); },
  hammer() {
    const p = new Pix(S, S);
    p.bar(3, 14, 10, 6, 1, '#c8925a');
    p.box(7, 1, 14, 6, '#97a2b8');
    p.box(5, 2, 7, 5, '#5a6a80');
    p.glint(8, 2);
    return p.outline();
  },
  anvil() {
    const p = new Pix(20, 14);
    p.box(1, 1, 18, 4, '#5a6a80');
    p.poly([[0, 1], [3, 1], [3, 4]], '#5a6a80');
    p.box(6, 5, 13, 9, '#3a4a5a');
    p.box(3, 10, 16, 13, '#2a3444');
    p.line(2, 1, 17, 1, '#c8d2e0');
    return p.outline('#121a24');
  },
  key() {
    const p = new Pix(S, S);
    p.ball(5, 5, 3.6, '#ffd23a');
    for (let y = 4; y <= 6; y++) for (let x = 4; x <= 6; x++) p.c[y * S + x] = null;
    p.bar(7, 7, 13, 13, 1, '#ffd23a');
    p.box(11, 12, 12, 14, '#e0a020').box(13, 10, 14, 11, '#e0a020');
    return p.outline();
  },
  gem() {
    const p = new Pix(S, S);
    p.poly([[3, 6], [6, 2], [10, 2], [13, 6], [8, 14]], '#5ad8ff');
    p.poly([[3, 6], [13, 6], [8, 14]], '#2fa8e8');
    p.line(5, 4, 7, 3, '#ffffff');
    return p.outline();
  },
};

function starPts(cx, cy, R, r) {
  const out = [];
  for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 5, q = i % 2 ? r : R; out.push([cx + Math.cos(a) * q, cy + Math.sin(a) * q]); }
  return out;
}
function reelArt(body, accent) {
  const p = new Pix(S, S);
  p.bar(2, 13, 6, 9, 1, '#5a6a80');
  p.ball(8, 8, 5.4, body);
  p.ball(8, 8, 2.6, accent);
  p.ball(8, 8, 1, '#ffffff');
  p.bar(12, 3, 14, 1, 0.8, '#5a6a80');
  p.ball(14.2, 1.4, 1.2, accent);
  return p.outline();
}
function spoolArt(col, core = '#c8925a') {
  const p = new Pix(S, S);
  p.box(2, 2, 13, 4, core).box(2, 11, 13, 13, core);
  for (let y = 5; y <= 10; y++) p.bar(4, y, 11, y, 0.5, y % 2 ? col : shade(col, -0.15));
  p.line(11, 7, 15, 15, col);
  return p.outline();
}
function charmArt(draw) {
  const p = new Pix(S, S);
  for (let a = 0; a < 12; a++) { const t = (a / 12) * Math.PI * 2; p.set(8 + Math.round(Math.cos(t) * 2), 2 + Math.round(Math.sin(t) * 2), '#c8d2e0'); }
  draw(p);
  return p.outline();
}

// ---------------------------------------------------------------- rods
const PERK_ORN = {
  magnet: (p) => { p.bar(12, 1, 12, 3, 0.9, '#ff4f5e').bar(15, 1, 15, 3, 0.9, '#3a8cff').bar(12, 4, 15, 4, 0.9, '#c8d2e0'); },
  clover: (p) => { for (const [x, y] of [[12, 2], [15, 2], [12, 5], [15, 5]]) p.ball(x, y, 1.6, '#5ccf3a'); },
  glow: (p) => { p.ball(14, 3, 2.6, '#e8ff7a'); p.glint(13, 2); },
  frost: (p) => { for (const [dx, dy] of [[0, 2], [2, 0], [1, 1], [-1, 1]]) { p.line(13 - dx, 3 - dy, 13 + dx, 3 + dy, '#e8fbff'); } p.set(13, 3, '#8ad8ff'); },
  turbo: (p) => { p.line(15, 0, 12, 4, '#fff27a').line(12, 4, 15, 4, '#fff27a').line(15, 4, 12, 8, '#fff27a'); },
  bouncy: (p) => { p.ball(13.5, 3.5, 2.6, '#ffe25a'); p.ball(15.5, 3.5, 1, '#ff9d2e'); p.set(13, 3, '#14202c'); },
  bloom: (p) => { for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; p.ball(13.5 + Math.cos(a) * 1.8, 3 + Math.sin(a) * 1.8, 1.2, '#ffb0d8'); } p.set(13, 3, '#ffe27a'); },
  retro: (p) => { p.ascii(['.##.##', '######', '######', '.####.', '..##..'], { '#': '#ff4f5e' }, 10, 0); },
  wish: (p) => { p.poly(starPts(13, 3.5, 3.4, 1.4), '#ffd23a'); },
};
function rodArt(look = {}, perk = null) {
  const p = new Pix(S, S);
  const shaft = look.shaft || '#b88a52', grip = look.grip || '#7a5432', reel = look.reel || '#c8c8c8', tip = look.tip || '#ffffff';
  const kind = look.kind || 'stick';
  // fishing line + hook hanging from the tip
  for (let y = 4; y < 12; y++) p.thin(14, y, 'rgba(232,244,255,0.85)');
  p.thin(14, 12, '#c8d2e0').thin(14, 13, '#c8d2e0').thin(13, 14, '#c8d2e0').thin(12, 13, '#c8d2e0');
  p.bar(2, 14, 13, 3, kind === 'stick' ? 1 : 0.8, shaft);
  if (kind === 'stick') { p.set(6, 10, shade(shaft, -0.35)).set(9, 7, shade(shaft, -0.35)); }
  if (kind === 'carbon') for (let i = 0; i < 3; i++) p.set(6 + i * 2, 10 - i * 2, mix(shaft, '#ffffff', 0.7));
  if (kind === 'coil') for (let i = 0; i < 4; i++) p.set(5 + i * 2, 11 - i * 2, look.glow || '#fff6a0');
  p.bar(1, 15, 4, 12, 1.2, grip);
  p.ball(5.5, 12.5, 1.8, reel);
  p.set(4, 13, shade(reel, -0.4));
  if (kind === 'crystal') p.poly([[13, 0], [15, 2.5], [13, 5], [11, 2.5]], tip);
  else if (kind === 'wand') p.ball(13, 3, 2.1, tip);
  else if (kind === 'trident') { p.bar(11, 1, 11, 4, 0.5, tip).bar(13, 0, 13, 4, 0.5, tip).bar(15, 1, 15, 4, 0.5, tip).bar(11, 4, 15, 4, 0.5, tip); }
  else p.set(13, 3, tip).set(14, 2, tip);
  if (perk && PERK_ORN[perk]) PERK_ORN[perk](p);
  return p.outline();
}

// ---------------------------------------------------------------- cache + API
let RODS_BY_ID = {};
export function registerRods(list) { RODS_BY_ID = Object.fromEntries((list || []).map((r) => [r.id, r])); }

const cache = new Map();
export const PIX_IDS = new Set(Object.keys(ART));
export function hasPix(id) { return PIX_IDS.has(id) || (typeof id === 'string' && ((id.startsWith('rod:') && !!RODS_BY_ID[id.slice(4)]) || /^(boat_\w+)#/.test(id))); }

// id may be 'boat_hull#<color>' for tinted boat-part art.
export function pixIcon(id, scale = 1) {
  if (!id) return null;
  const key = id + '|' + scale;
  let c = cache.get(key);
  if (c !== undefined) return c;
  let p = null;
  try {
    if (id.startsWith('rod:')) { const r = RODS_BY_ID[id.slice(4)]; p = r ? rodArt(r.look, r.perk) : null; }
    else if (id.includes('#')) { const [base, col] = id.split('#'); p = ART[base] ? ART[base]('#' + col) : null; }
    else p = ART[id] ? ART[id]() : null;
  } catch (e) { console.error(e); p = null; }
  c = p ? p.canvas(scale) : null;
  cache.set(key, c);
  return c;
}
export function rodPix(rod, scale = 1) {
  if (!rod) return null;
  const key = 'rodobj:' + rod.id + '|' + scale;
  let c = cache.get(key);
  if (!c) { c = rodArt(rod.look, rod.perk).canvas(scale); cache.set(key, c); }
  return c;
}
// Centred in a size x size box at the biggest integer scale that fits.
export function drawPix(ctx, id, cx, cy, size = 32) {
  const base = pixIcon(id, 1);
  if (!base) return false;
  const k = Math.max(1, Math.floor(size / Math.max(base.width, base.height)));
  const c = k === 1 ? base : pixIcon(id, k);
  ctx.drawImage(c, Math.round(cx - c.width / 2), Math.round(cy - c.height / 2));
  return true;
}

// ---------------------------------------------------------------- tiny pixel particles (chest / workshop effects)
// partSprite(kind, color) -> canvas; kinds: star, sparkle, spark, chip, heart, coin, confetti, puff, shard
const PART = {
  star: ['..o..', '.oho.', 'ohwho', '.oho.', '..o..'],
  sparkle: ['...h...', '...h...', '..hwh..', 'hhwwwhh', '..hwh..', '...h...', '...h...'],
  spark: ['.h.', 'hwh', '.h.'],
  chip: ['oo', 'ho'],
  heart: ['.oo.oo.', 'ohhohho', 'ohwhhho', '.ohhho.', '..oho..', '...o...'],
  coin: ['.ooo.', 'ohwho', 'ohhho', 'ohhho', '.ooo.'],
  confetti: ['hh', 'oo'],
  puff: ['.hhh.', 'hwwwh', 'hwwhh', '.hhh.'],
  shard: ['..w', '.hh', 'ho.'],
};
const pcache = new Map();
export function partSprite(kind, color = '#ffe27a', scale = 1) {
  const key = kind + color + scale;
  let c = pcache.get(key);
  if (c) return c;
  const rows = PART[kind] || PART.spark;
  const r = ramp5(color);
  const pal = { o: r[1], h: r[2], w: r[4] };
  const w = rows[0].length, h = rows.length;
  c = makeCanvas(w * scale, h * scale);
  const g = ctxOf(c);
  rows.forEach((row, y) => [...row].forEach((ch, x) => { if (pal[ch]) { g.fillStyle = pal[ch]; g.fillRect(x * scale, y * scale, scale, scale); } }));
  pcache.set(key, c);
  return c;
}

// A small immediate-mode pixel particle list for panels (screen space). add({x, y, vx, vy, g, life, kind, color, scale, drag, spin})
export class PixFx {
  constructor(max = 400) { this.list = []; this.max = max; }
  add(p) { if (this.list.length >= this.max) this.list.shift(); this.list.push({ vx: 0, vy: 0, g: 0, life: 1, t: 0, kind: 'spark', color: '#ffffff', scale: 1, drag: 0, ...p }); }
  burst(x, y, n, o = {}) {
    for (let i = 0; i < n; i++) {
      const a = (o.a0 ?? 0) + Math.random() * (o.arc ?? Math.PI * 2), sp = (o.speedMin ?? 40) + Math.random() * ((o.speed ?? 160) - (o.speedMin ?? 40));
      const kinds = o.kinds || [o.kind || 'spark'], colors = o.colors || [o.color || '#ffffff'];
      this.add({ x: x + (Math.random() - 0.5) * (o.spread || 0), y: y + (Math.random() - 0.5) * (o.spread || 0), vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - (o.up || 0), g: o.g ?? 300, life: (o.life ?? 0.8) * (0.6 + Math.random() * 0.6), kind: kinds[(Math.random() * kinds.length) | 0], color: colors[(Math.random() * colors.length) | 0], scale: o.scale || 1, drag: o.drag ?? 0.6 });
    }
  }
  update(dt) {
    for (const p of this.list) {
      p.t += dt;
      p.vy += p.g * dt;
      const d = Math.max(0, 1 - p.drag * dt);
      p.vx *= d; p.vy *= d;
      p.x += p.vx * dt; p.y += p.vy * dt;
    }
    this.list = this.list.filter((p) => p.t < p.life);
  }
  draw(ctx) {
    for (const p of this.list) {
      const k = p.t / p.life;
      const blink = p.kind === 'sparkle' || p.kind === 'star' ? k > 0.6 && ((p.t * 20) | 0) % 2 : false;
      if (blink) continue;
      const s = partSprite(p.kind, p.color, p.scale);
      ctx.globalAlpha = k > 0.75 ? (1 - k) * 4 : 1;
      ctx.drawImage(s, Math.round(p.x - s.width / 2), Math.round(p.y - s.height / 2));
    }
    ctx.globalAlpha = 1;
  }
}

// dev hook: window.__pixart for the art review (no gameplay effect)
if (typeof window !== 'undefined') window.__pixart = { pixIcon, rodPix, PIX_IDS, partSprite };
