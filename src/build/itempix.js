// Hand-made-feeling 2D pixel art for items (phase 8, UI & Particles agent). Every material, sample, egg, the Aero
// drop, the satchel and the blueprint scroll is painted on a 24 x 24 grid from shaded primitives (pillow / sphere
// shading from a top-left light, 5-step hue-shifted ramps, dithering only at the steps), finished with a selective
// dark outline and hand-placed highlights. Packages (crates and chests) stay voxel: the chest minigame splits them.
//
//   PIXEL_ITEM_IDS                        art ids with pixel art
//   itemPixel(artId) -> {canvas, w, h} | null     the 1x sprite (24 x 24, transparent, bottom-aligned art)
//   itemPixelScaled(artId, k) -> canvas | null    integer-scaled copy (cached)
//   hasPixelArt(artId) -> bool

import { makeCanvas, ctxOf } from '../core/canvas.js';
import { pack, unpack, shade, rgbToHex } from '../core/color.js';
import { bayer, hash2 } from '../core/math.js';
import { autoHi, withHi } from '../gfx/hires.js'; // [phase9:ui]

const N = 24;
// 5-step ramps: [outline, shadow, base, light, highlight]
const RAMP = {
  wood: ['#3a2418', '#7a5236', '#a8805a', '#cfae84', '#f2e2c4'],
  drift: ['#3a3032', '#6e6060', '#9a8c84', '#c4b8a8', '#ece4d6'],
  kelp: ['#123a1e', '#2a6e34', '#46a048', '#7fd05a', '#d4ff9a'],
  tan: ['#4a3010', '#a0702a', '#d4a24a', '#f0cc78', '#fff0c0'],
  shell: ['#6a2440', '#c25a72', '#f08a94', '#ffc0b8', '#fff4ec'],
  shellIn: ['#7a3a3a', '#e0a08a', '#ffd8c4', '#fff0e4', '#ffffff'],
  glassG: ['#0e4a3a', '#2a9a7a', '#5ad8b0', '#a8f8dc', '#ffffff'],
  glassB: ['#0a3a6a', '#2a7ad0', '#5ab8f8', '#b0e8ff', '#ffffff'],
  coral: ['#6a1a2a', '#d0405a', '#ff6f7a', '#ffa8a0', '#fff0e0'],
  pearl: ['#4a3a6a', '#a898c8', '#e4dcf4', '#f8f4ff', '#ffffff'],
  steel: ['#1e2634', '#4a5a70', '#7a8aa2', '#b4c2d4', '#f0f6ff'],
  rust: ['#3a1a0a', '#8a3a18', '#c0642a', '#e09a50', '#ffd8a0'],
  pcb: ['#0a2a14', '#1a6a32', '#2a9a48', '#5ac86a', '#b8f0a0'],
  gold: ['#5a2a06', '#c0781a', '#ffc23a', '#ffe68a', '#fffbe0'],
  chip: ['#0a0a14', '#1e1e2e', '#33334a', '#4e4e6a', '#8a8aaa'],
  stone: ['#24242e', '#55566a', '#8a8c9c', '#b8bac6', '#e6e8f0'],
  rune: ['#0a3a5a', '#1aa8d8', '#5ff4ff', '#c8fcff', '#ffffff'],
  crystal: ['#1e0a4a', '#5a2ab0', '#8f5af0', '#c8a8ff', '#ffffff'],
  crystalB: ['#0a1e5a', '#2a5ad0', '#5a9af8', '#a8d4ff', '#ffffff'],
  vial: ['#1a3a5a', '#8ab8d8', '#d8f0fc', '#ffffff', '#ffffff'],
  liquid: ['#0a3a6a', '#1a7ad0', '#3cc0f4', '#a8ecff', '#ffffff'],
  goo: ['#3a0a5a', '#8a2ac0', '#c060f0', '#e8b0ff', '#ffffff'],
  egg: ['#7a2a06', '#e0601a', '#ff9a3c', '#ffd08a', '#fff6e0'],
  aero: ['#06406e', '#1784c4', '#3fc6ee', '#a8f0ff', '#ffffff'],
  bag: ['#14401a', '#2a8a2a', '#52c03a', '#9ae85a', '#e8ffc0'],
  paper: ['#5a4020', '#c8a878', '#f0e0b8', '#fff4dc', '#ffffff'],
  ribbon: ['#5a0a1a', '#b81e34', '#f0404e', '#ff8a8a', '#ffe0e0'],
  cork: ['#3a2410', '#8a5a2a', '#c08a4a', '#e8b878', '#fff0d0'],
};
const P = {};
for (const k in RAMP) P[k] = RAMP[k].map((c) => pack(c));
const packedArr = new WeakMap();
function rampP(r) {
  if (typeof r === 'string') return P[r];
  if (typeof r[0] === 'number') return r;
  let q = packedArr.get(r);
  if (!q) { q = r.map((h) => pack(h)); packedArr.set(r, q); }
  return q;
}

// ---------------------------------------------------------------- canvas toolkit
class Pix {
  constructor(w = N, h = N) { this.w = w; this.h = h; this.d = new Uint32Array(w * h); this.tag = new Uint8Array(w * h); this.tags = [null]; }
  put(x, y, c) { x |= 0; y |= 0; if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.d[y * this.w + x] = c; }
  get(x, y) { return x < 0 || y < 0 || x >= this.w || y >= this.h ? 0 : this.d[y * this.w + x]; }
  // shaded fill: inside(px, py) on pixel centres, shade(px, py) -> lightness -1..1 (positive = lit)
  fill(inside, ramp, shadeFn, o = {}) {
    const R = rampP(ramp);
    const tid = this.tags.push(ramp) - 1;
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      const px = x + 0.5, py = y + 0.5;
      if (!inside(px, py)) continue;
      const v = shadeFn(px, py) + (bayer(x, y) - 0.5) * (o.dither ?? 0.22);
      const lvl = v > (o.hi ?? 0.62) ? 4 : v > 0.22 ? 3 : v > -0.3 ? 2 : 1;
      this.d[y * this.w + x] = R[o.noHi && lvl === 4 ? 3 : lvl];
      this.tag[y * this.w + x] = tid;
    }
  }
  // sphere-ish ellipse
  ell(cx, cy, rx, ry, ramp, o = {}) {
    const lx = -0.6, ly = -0.8;
    this.fill((x, y) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1, ramp, (x, y) => {
      const nx = (x - cx) / rx, ny = (y - cy) / ry, nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
      return (nx * lx + ny * ly) * 0.9 + nz * 0.35 - 0.25 + (o.bias || 0);
    }, o);
  }
  // pillow-shaded polygon
  poly(pts, ramp, o = {}) {
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const rx = Math.max(1, (Math.max(...xs) - Math.min(...xs)) / 2), ry = Math.max(1, (Math.max(...ys) - Math.min(...ys)) / 2);
    const ins = inPoly(pts);
    this.fill(ins, ramp, (x, y) => {
      const nx = (x - cx) / rx, ny = (y - cy) / ry;
      return -(nx * 0.55 + ny * 0.8) * 0.75 + (o.bias || 0);
    }, o);
  }
  rect(x, y, w, h, ramp, o = {}) { this.poly([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], ramp, o); }
  line(x0, y0, x1, y1, c) {
    const n = Math.max(1, Math.round(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))));
    for (let i = 0; i <= n; i++) this.put(Math.round(x0 + ((x1 - x0) * i) / n), Math.round(y0 + ((y1 - y0) * i) / n), c);
  }
  // paint only over existing pixels
  over(x, y, c) { if (this.get(x, y)) this.put(x, y, c); }
  // selective outline: each empty pixel touching art takes the darkest step of that art's ramp
  outline() {
    const { w, h } = this;
    const src = this.d.slice(), tg = this.tag.slice();
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (src[i]) continue;
      let n = -1;
      for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
        const xx = x + dx, yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < w && yy < h && src[yy * w + xx]) { n = yy * w + xx; break; }
      }
      if (n < 0) continue;
      const ramp = this.tags[tg[n]];
      this.d[i] = ramp ? rampP(ramp)[0] : darker(src[n]);
    }
  }
  // inner edge darkening on the bottom-right side of every shape (crisp form)
  rimShade() {
    const { w, h } = this;
    const src = this.d.slice();
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!src[i]) continue;
      const empty = (xx, yy) => xx < 0 || yy < 0 || xx >= w || yy >= h || !src[yy * w + xx];
      if (empty(x + 1, y) || empty(x, y + 1)) {
        const ramp = this.tags[this.tag[i]];
        if (ramp) { const R = rampP(ramp); const k = R.indexOf(src[i]); if (k > 1) this.d[i] = R[k - 1]; }
      }
    }
  }
  canvas() {
    const c = makeCanvas(this.w, this.h);
    const g = ctxOf(c);
    const img = g.createImageData(this.w, this.h);
    new Uint32Array(img.data.buffer).set(this.d);
    g.putImageData(img, 0, 0);
    return c;
  }
}

function darker(c) { const [r, g, b] = unpack(c); return pack(shade(rgbToHex(r, g, b), -0.6)); }
function inPoly(pts) {
  return (x, y) => {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i], [xj, yj] = pts[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };
}
const W = pack('#ffffff');

// ---------------------------------------------------------------- the items
const ART = {
  driftwood(p) {
    // a weathered diagonal branch with a stub, knots, grain and a pale cut end
    p.poly([[2, 15], [5, 11], [18, 6], [22, 8], [21, 12], [8, 19], [4, 19]], 'drift');
    p.poly([[13, 9], [12, 4], [14, 3], [16, 8]], 'drift', { bias: 0.15 });
    for (const [x0, y0, x1, y1] of [[6, 14, 17, 9], [7, 16, 19, 11], [9, 17, 15, 14]]) p.line(x0, y0, x1, y1, P.drift[1]);
    p.over(10, 13, P.wood[0]); p.over(11, 13, P.wood[1]); p.over(17, 9, P.wood[0]);
    p.ell(21, 10, 1.6, 2.4, 'wood', { bias: 0.4 });
    p.over(21, 10, P.wood[1]);
    p.over(5, 13, P.drift[4]); p.over(6, 12, P.drift[4]); p.over(13, 8, P.drift[4]); p.over(14, 7, P.drift[4]);
  },
  kelp_fibre(p) {
    // a bundle of wavy kelp ribbons tied with twine
    for (const [ox, ph, r] of [[8, 0, 'kelp'], [12, 1.4, 'kelp'], [15.5, 2.6, 'kelp'], [10.5, 3.3, 'lime']]) {
      const ramp = r === 'lime' ? ['#1d5a12', '#3c9a24', '#7ad83a', '#c8f56a', '#f4ffd8'] : r;
      p.fill((x, y) => y > 2 && y < 22 && Math.abs(x - (ox + Math.sin(y * 0.45 + ph) * 1.6)) < 1.7 - (y < 5 ? (5 - y) * 0.3 : 0), ramp, (x, y) => (ox + Math.sin(y * 0.45 + ph) * 1.6 - x) * 0.6 + 0.1);
    }
    p.rect(6, 9, 13, 2.2, 'tan', { bias: 0.2 });
    p.rect(6, 15, 13, 2.2, 'tan');
    p.over(7, 9, P.tan[4]); p.over(8, 9, P.tan[4]); p.over(7, 15, P.tan[4]);
    p.over(9, 5, P.kelp[4]); p.over(12, 4, P.kelp[4]);
  },
  shell(p) {
    // a scallop: a ribbed fan with a scalloped rim and two little ears at the hinge
    const cx = 12, cy = 19;
    const fan = (x, y) => { const dx = x - cx, dy = y - cy; const a = Math.atan2(dy, dx); const r = Math.hypot(dx / 9.6, dy / 15); return dy < 0 && r < 1 + Math.cos(a * 18) * 0.035 && a < -0.35 && a > -2.8; };
    p.fill(fan, 'shell', (x, y) => -((x - cx) / 10) * 0.55 - ((y - cy + 8) / 9) * 0.55);
    p.poly([[8, 15], [16, 15], [17.5, 20], [6.5, 20]], 'shell', { bias: -0.25 });
    for (let i = 0; i < 9; i++) {
      const a = -2.7 + i * 0.29;
      for (let r = 4; r < 15; r++) {
        const x = Math.round(cx + Math.cos(a) * r * 0.64), y = Math.round(cy + Math.sin(a) * r);
        if (fan(x + 0.5, y + 0.5)) p.put(x, y, i % 2 ? P.shell[1] : P.shell[3]);
      }
    }
    p.over(8, 9, P.shell[4]); p.over(9, 8, P.shell[4]); p.over(10, 7, P.shell[4]); p.over(11, 6, P.shell[4]);
  },
  sea_glass(p) {
    // three frosted, rounded pebbles of sea glass
    p.poly([[3, 15], [7, 11], [12, 12], [13, 17], [9, 20], [4, 19]], 'glassG', { dither: 0.35 });
    p.poly([[11, 9], [16, 6], [20, 8], [21, 13], [17, 15], [12, 13]], 'glassB', { dither: 0.35 });
    p.poly([[13, 17], [17, 15], [21, 17], [19, 21], [14, 21]], 'glassG', { bias: 0.15, dither: 0.35 });
    for (const [x, y] of [[6, 13], [7, 13], [6, 14], [14, 8], [15, 8], [14, 9], [16, 17], [17, 17]]) p.over(x, y, W);
  },
  coral_chunk(p) {
    // branching coral on a little base
    p.ell(12, 19, 6, 2.6, 'coral', { bias: -0.15 });
    for (const [x0, y0, x1, y1, r] of [[12, 19, 12, 7, 1.8], [12, 14, 7, 9, 1.5], [12, 13, 17, 6, 1.5], [8, 10, 6, 5, 1.2], [16, 8, 19, 4, 1.1], [7, 9, 4, 8, 1.1]]) {
      p.fill((x, y) => { const dx = x1 - x0, dy = y1 - y0, L = dx * dx + dy * dy; const t = Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / L)); return Math.hypot(x - x0 - dx * t, y - y0 - dy * t) < r; }, 'coral', (x) => (x0 - x) * 0.4 + 0.15);
    }
    for (const [x, y] of [[12, 6], [6, 4], [19, 3], [4, 7], [17, 5]]) p.ell(x, y + 0.5, 1.4, 1.4, 'coral', { bias: 0.5 });
    p.over(11, 10, P.coral[4]); p.over(11, 11, P.coral[4]); p.over(6, 9, P.coral[4]); p.over(15, 8, P.coral[4]);
  },
  pearl(p) {
    // a lustrous pearl resting in a half shell
    p.fill((x, y) => y > 15 && ((x - 12) / 9) ** 2 + ((y - 15) / 5.5) ** 2 <= 1, 'shell', (x, y) => -(x - 12) * 0.05 - (y - 18) * 0.25);
    p.fill((x, y) => y > 15 && y < 17.5 && ((x - 12) / 7.5) ** 2 + ((y - 15) / 3) ** 2 <= 1, 'shellIn', () => 0.3);
    p.ell(12, 11.5, 5.2, 5.2, 'pearl');
    for (const [x, y] of [[10, 9], [11, 9], [10, 10]]) p.over(x, y, W);
    p.over(14, 14, P.pearl[3]);
  },
  scrap_metal(p) {
    // a bent, riveted steel plate with rust spots
    p.poly([[3, 9], [14, 5], [21, 8], [20, 16], [9, 20], [3, 17]], 'steel');
    p.poly([[14, 5], [21, 8], [19, 10], [13, 8]], 'steel', { bias: 0.45 });
    for (const [x, y] of [[6, 11], [6, 15], [16, 12]]) { p.over(x, y, P.steel[0]); p.over(x - 1, y - 1, P.steel[4]); }
    for (const [x, y, r] of [[11, 15, 2.2], [17, 15, 1.4], [8, 9, 1.3]]) p.fill((xx, yy) => p.get(xx | 0, yy | 0) && Math.hypot(xx - x, yy - y) < r + hash2(xx | 0, yy | 0, 4) * 0.8, 'rust', (xx) => (x - xx) * 0.2);
    p.line(5, 10, 13, 7, P.steel[3]);
  },
  gear(p) {
    // a chunky cog: 8 square teeth, a bevelled rim and an axle hole
    const cx = 12, cy = 12;
    p.fill((x, y) => {
      const dx = x - cx, dy = y - cy, r = Math.hypot(dx, dy), a = Math.atan2(dy, dx);
      const tooth = Math.cos(a * 8) > 0.25;
      return r < (tooth ? 10 : 8) && r > 2.4;
    }, 'steel', (x, y) => -((x - cx) * 0.6 + (y - cy) * 0.8) / 9);
    p.fill((x, y) => { const r = Math.hypot(x - cx, y - cy); return r < 5 && r > 2.4; }, 'steel', (x, y) => ((x - cx) * 0.6 + (y - cy) * 0.8) / 6);
    for (const [x, y] of [[7, 6], [8, 5], [6, 8]]) p.over(x, y, P.steel[4]);
  },
  circuit_board(p) {
    // a green PCB with gold traces, a black chip and pins
    p.poly([[2, 7], [21, 4], [22, 17], [3, 20]], 'pcb');
    for (const [x0, y0, x1, y1] of [[4, 10, 9, 10], [9, 10, 9, 14], [4, 16, 12, 16], [15, 7, 20, 7], [16, 12, 20, 12], [14, 15, 20, 15]]) p.line(x0, y0, x1, y1, P.gold[2]);
    p.rect(10, 7.5, 5.5, 6, 'chip');
    for (let i = 0; i < 3; i++) { p.put(9, 9 + i * 2, P.steel[3]); p.put(16, 9 + i * 2, P.steel[3]); }
    for (const [x, y] of [[4, 10], [20, 7], [20, 12], [4, 16], [20, 15]]) p.put(x, y, P.gold[4]);
    p.put(11, 8, P.chip[4]); p.put(12, 8, P.chip[4]);
    p.put(5, 13, P.coral[2]); p.put(18, 18, P.rune[2]);
  },
  ancient_stone(p) {
    // a weathered tablet with a softly glowing rune
    p.poly([[5, 4], [18, 3], [20, 20], [4, 21]], 'stone', { dither: 0.35 });
    p.poly([[5, 4], [18, 3], [18.5, 5], [5, 6]], 'stone', { bias: 0.6 });
    for (const [x, y] of [[8, 16], [16, 7], [7, 9], [17, 18]]) p.over(x, y, P.stone[1]);
    // rune: a little fish glyph
    for (const [x, y] of [[9, 12], [10, 11], [11, 11], [12, 11], [13, 12], [12, 13], [11, 13], [10, 13], [14, 11], [14, 13], [12, 9], [12, 15], [10, 8], [14, 8]]) p.over(x, y, P.rune[2]);
    for (const [x, y] of [[11, 12], [10, 12]]) p.over(x, y, P.rune[4]);
  },
  abyss_crystal(p) {
    // a cluster of faceted crystals
    const shard = (pts, ramp, b) => p.poly(pts, ramp, { bias: b });
    shard([[4, 21], [5, 12], [8, 9], [10, 21]], 'crystalB', -0.1);
    shard([[14, 21], [15, 10], [18, 8], [20, 21]], 'crystalB', 0);
    shard([[8, 21], [9, 6], [12, 2], [15, 6], [16, 21]], 'crystal', 0.1);
    p.line(12, 3, 12, 20, P.crystal[3]);
    for (let y = 4; y < 20; y++) p.over(13, y, P.crystal[1]);
    for (const [x, y] of [[10, 7], [11, 5], [10, 8], [5, 13], [16, 11]]) p.over(x, y, W);
  },
  golden_scale(p) {
    // one big shiny golden fish scale: round top, soft point below, growth ridges and a bright sheen
    const sc = (x, y) => (y <= 11 ? Math.hypot(x - 12, y - 11) <= 8.6 : Math.abs(x - 12) <= 8.6 * Math.pow(1 - (y - 11) / 10.5, 0.8));
    p.fill(sc, 'gold', (x, y) => -((x - 12) * 0.6 + (y - 9) * 0.8) / 8);
    for (const rr of [3.2, 6]) for (let a = -2.9; a < -0.2; a += 0.08) {
      const x = Math.round(12 + Math.cos(a) * rr), y = Math.round(13 + Math.sin(a) * rr);
      if (sc(x + 0.5, y + 0.5)) p.put(x, y, P.gold[1]);
    }
    for (const [x, y] of [[7, 6], [8, 5], [7, 7], [9, 4], [10, 4]]) p.over(x, y, W);
    p.over(15, 15, P.gold[4]); p.over(12, 19, P.gold[3]);
  },
  fish_sample(p) {
    // a corked test tube of sea water with a tiny fish inside
    p.rect(9, 3, 6, 3.5, 'cork');
    p.fill((x, y) => y > 6 && y < 21 && x > 8 && x < 16 && (y < 18 || Math.hypot(x - 12, y - 17.5) < 3.6), 'vial', (x) => (11 - x) * 0.4 + 0.2, { dither: 0.1 });
    p.fill((x, y) => y > 10 && y < 21 && x > 9 && x < 15 && (y < 18 || Math.hypot(x - 12, y - 17.5) < 2.7), 'liquid', (x) => (11.5 - x) * 0.45);
    for (const [x, y] of [[11, 14], [12, 14], [13, 14], [12, 13], [12, 15], [10, 14]]) p.put(x, y, P.egg[2]);
    p.put(13, 14, P.chip[0]);
    for (let y = 7; y < 17; y++) p.put(10, y, W);
    p.put(13, 11, P.liquid[4]);
  },
  rare_specimen(p) {
    // a round glass jar with a glowing purple critter
    p.rect(7, 3, 10, 3, 'steel', { bias: 0.2 });
    p.ell(12, 14, 7.5, 7.5, 'vial', { dither: 0.1, noHi: true });
    p.ell(12, 15.5, 5.5, 5, 'goo');
    p.ell(12, 14, 2.5, 2.2, 'rune', { bias: 0.4 });
    p.put(11, 13, W); p.put(13, 13, P.chip[0]);
    for (const [x, y] of [[7, 11], [7, 12], [8, 10], [8, 9]]) p.put(x, y, W);
  },
  fish_egg(p) {
    // three glossy, see-through roe eggs, each with a tiny fry curled inside (eye dot + body)
    for (const [x, y, r] of [[7.5, 15.5, 4.3], [16.5, 15.5, 4.3], [12, 8.5, 4.5]]) {
      p.ell(x, y, r, r, 'egg', { dither: 0.12 });
      const ex = Math.round(x + 0.5), ey = Math.round(y + 0.5);
      p.put(ex, ey, P.chip[0]); p.put(ex - 1, ey, P.egg[1]); p.put(ex - 1, ey + 1, P.egg[1]); p.put(ex, ey + 1, P.egg[1]);
      p.put(Math.round(x - r * 0.45), Math.round(y - r * 0.45), W); p.put(Math.round(x - r * 0.45) + 1, Math.round(y - r * 0.45), W); p.put(Math.round(x - r * 0.45), Math.round(y - r * 0.45) + 1, P.egg[4]);
    }
  },
  coins(p) {
    // the Aero currency: a glossy water drop with a twinkle
    p.fill((x, y) => { const dx = x - 12; if (y >= 13) return Math.hypot(dx, y - 13) <= 7.5; const u = (13 - y) / 11; return u < 1 && Math.abs(dx) <= 7.5 * Math.pow(1 - u, 1.2); }, 'aero', (x, y) => -((x - 12) * 0.6 + (y - 12) * 0.7) / 8 + 0.1);
    for (const [x, y] of [[9, 10], [9, 11], [9, 12], [10, 9], [8, 13]]) p.over(x, y, W);
    p.over(15, 17, P.aero[4]); p.over(16, 16, P.aero[3]);
  },
  satchel(p) {
    // a cute green satchel with a strap and a brass buckle
    p.fill((x, y) => { const r = Math.hypot(x - 12, y - 9); return r < 7.5 && r > 5.6 && y < 10; }, 'cork', (x) => (12 - x) * 0.1);
    p.poly([[3, 9], [21, 9], [20, 21], [4, 21]], 'bag');
    p.poly([[3, 9], [21, 9], [19, 15], [5, 15]], 'bag', { bias: 0.35 });
    p.rect(10.5, 13, 3.5, 3.5, 'gold');
    for (const [x, y] of [[5, 10], [6, 10], [7, 10], [5, 11]]) p.over(x, y, P.bag[4]);
  },
  scroll(p) {
    // a rolled blueprint scroll tied with a red ribbon
    p.poly([[4, 6], [20, 5], [20, 18], [4, 19]], 'paper');
    p.ell(4, 12.5, 2.4, 7, 'paper', { bias: -0.2 });
    p.ell(20, 11.5, 2.4, 7, 'paper', { bias: 0.1 });
    for (let x = 7; x < 18; x += 2) p.over(x, 9, P.glassB[2]);
    for (let x = 7; x < 16; x += 2) p.over(x, 12, P.glassB[2]);
    p.rect(11, 5, 2.5, 14, 'ribbon');
    p.poly([[10, 17], [12, 15], [14, 17], [13, 22], [12, 19], [11, 22]], 'ribbon', { bias: 0.2 });
    p.over(6, 7, P.paper[4]); p.over(7, 7, P.paper[4]);
  },
  icon_fishmgr(p) {
    // HUD 'My Fish': a happy orange fish with a pink heart bubble
    p.poly([[2, 9], [7, 13], [2, 18]], 'egg', { bias: -0.1 });
    p.ell(12.5, 13.5, 7.5, 5.5, 'egg');
    p.poly([[10, 8.5], [14, 6], [16, 9]], 'egg', { bias: 0.3 });
    p.ell(16, 12, 1.6, 1.6, 'pearl', { bias: 0.8 });
    p.put(16, 12, P.chip[0]); p.put(16, 11, P.chip[0]);
    p.line(17, 15, 18, 15, P.egg[0]);
    for (const [x, y] of [[9, 10], [10, 10], [9, 11]]) p.over(x, y, W);
    for (const x of [9, 11]) for (let y = 12; y < 17; y++) p.over(x, y, P.egg[3]);
    const hx = 19, hy = 4;
    for (const [x, y] of [[0, 0], [1, 0], [3, 0], [4, 0], [-1, 1], [0, 1], [1, 1], [2, 1], [3, 1], [4, 1], [5, 1], [-1, 2], [0, 2], [1, 2], [2, 2], [3, 2], [4, 2], [5, 2], [0, 3], [1, 3], [2, 3], [3, 3], [4, 3], [1, 4], [2, 4], [3, 4], [2, 5]]) p.put(hx - 2 + x, hy + y, x < 1 && y < 2 ? W : P.coral[2]);
  },
};

export const PIXEL_ITEM_IDS = new Set(Object.keys(ART));
export function hasPixelArt(id) { return PIXEL_ITEM_IDS.has(id); }

const cache = new Map();
export function itemPixel(id) {
  if (!ART[id]) return null;
  let e = cache.get(id);
  if (e) return e;
  const p = new Pix();
  try { ART[id](p); } catch (err) { console.error(err); return null; }
  p.rimShade();
  p.outline();
  // trim to the art and keep a 1 px margin (bottom-aligned art makes drawItem's baseline honest)
  let x0 = N, y0 = N, x1 = -1, y1 = -1;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (p.d[y * N + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  const src = p.canvas();
  const w = x1 - x0 + 3, h = y1 - y0 + 3;
  const out = makeCanvas(w, h);
  ctxOf(out).drawImage(src, x0 - 1, y0 - 1, w, h, 0, 0, w, h);
  autoHi(out, { bevel: 0.7 }); // [phase9:ui] lazy 2x remaster (Scale2x curves, 1 device-px outline, rim light) for the hi-res UI
  e = { canvas: out, w, h };
  cache.set(id, e);
  return e;
}

const scaled = new Map();
export function itemPixelScaled(id, k = 2) {
  k = Math.max(1, Math.round(k));
  const key = id + '|' + k;
  let c = scaled.get(key);
  if (c !== undefined) return c;
  const s = itemPixel(id);
  if (!s) { scaled.set(key, null); return null; }
  c = makeCanvas(s.w * k, s.h * k);
  ctxOf(c).drawImage(s.canvas, 0, 0, s.w * k, s.h * k);
  withHi(c, () => { const h = s.canvas.hi; if (!h) return null; const c2 = makeCanvas(c.width * 2, c.height * 2), g2 = ctxOf(c2); g2.drawImage(h, 0, 0, c2.width, c2.height); return c2; }); // [phase9:ui]
  scaled.set(key, c);
  return c;
}
