// [bubble34] The currency wallet as PIXEL ART in the bubble language (replaces the [wallet33] 3D glass slab).
// User direction: "have some round bubble UI but make it pixel art". Same placement, slide-away, flight-target and
// header-wallet rules as [wallet32] / [wallet33]; only the drawing changed.
//
// Everything is authored at the LOGICAL resolution (1 art px = 1 logical px = 2 device px on the 2x UI layer), like
// the [pixui30] chrome and the [bubble34] bubble kit (src/ui/aero.js): the wallet is sized per UI mode (height =
// round(spec.H * p), p = walletP(mode)) instead of scaling a small sprite, so its pixels match the rest of the UI.
//   - Body (`bakeBody`, baked once per size / digit-field widths): a two-tone PIXEL BUBBLE CAPSULE (pixelBubbleCanvas:
//     aqua Aero Bucks half, periwinkle-violet Byte Gems half with a dark / light seam, 1 px dark outline, light rim on
//     the lit side, faint iridescent pixel rim bands on the far side, banded body, broken white gloss strokes over each
//     half, white glint), a hard 1 px drop shadow; the droplet and the gem each sit in a round translucent pixel SOAP
//     BUBBLE (glass bubble, iridescent rim, gloss arc, glint); the numbers sit in recessed pixel wells (stepped
//     capsule, dark top row, light bottom bevel).
//   - Aero Buck: the cel droplet rasterised at 1 px per art px (bakeDrop(1, ...)): banded water ramp, hard white spec,
//     ink outline; 7 squash levels for the gain wobble. Byte Gem: the faceted brilliant at 1 px per art px (bakeGem):
//     flat cel facets, light facet edges, cyan byte pixels, 8 spin frames + a bright twin (hard-swapped on gain).
//   - Digits (`glyphArt`): crisp pixel numbers, white with a pale-aqua (gem: pale-lilac) lower half, a 1 px ink
//     outline and a hard drop row, in fixed-width cells (no jitter while counting). Face by height (`faceOf`): the
//     game's 'big' face (9 px) on small wallets, a hand-drawn 13 px face (`D13`) on the default Big UI, 'big' x2 / x3
//     above that.
// Motion (whole art px; blits of baked canvases): on gain the droplet wobbles through its squash frames and pixel
// beads burst up out of it; the gem hops, spins fast and flashes (bright twin) with pixel twinkles; changed digits hop
// and flash pale gold; a stair-stepped pixel gloss band sweeps the capsule. Idle: the sweep every ~7 s, a tiny pixel
// bubble rises past each number well, the gem turns two facets every ~5.5 s with a twinkle, the droplet bobs 1 px.
// Reduced motion keeps it still. NO light-ray fans, NO expanding rings.
//
// API (re-exported by gemui.js; ui.js / quests / lab / workshop / wardrobe / shoppanel call it):
//   drawWalletPlaque(ctx, ui, {right, y, p, mini, hov, id}) -> {x, y, w, h, p, drop, gem, a, g}
//   walletSize(ui, {mini, p}) -> {w, h}     walletTip(ui, onGem)     walletTick(ui, dt)     walletP(mode)
//   drawHeaderWallet(ctx, ui, right, y, o)  the compact (MINI) capsule for window headers; records ui.hdrWallet
//   WALLET_ART                              the layout specs (FULL / MINI; heights in wallet units, art px = units * p)
//   WALLET_BAKE                             the bakers (dev pages / screenshots)

import { makeCanvas } from '../core/canvas.js';
import { drawText, measureText } from '../gfx/font.js';
import { GEM_NAME, gems } from '../game/gems.js';
import { CURRENCY, fmtAero, pixelBubbleCanvas, circleInsets, drawSparkle, drawLeafSprig } from './aero.js';
import { HI_ON } from '../gfx/hires.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const hexRGB = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const ramp = (arr) => arr.map(hexRGB);

// ---------------------------------------------------------------- palettes (cel ramps, dark -> light)
const WATER = ramp(['#072a72', '#0b46a6', '#1168d0', '#1c8eec', '#38b2f8', '#78d6fc', '#c6f2ff', '#ffffff']);
const VIOLET = ramp(['#2a0a66', '#43129a', '#6020c4', '#8236e6', '#a35cf8', '#c890ff', '#ecd6ff', '#ffffff']);
const INK = { drop: hexRGB('#061d52'), gem: hexRGB('#1c0646') };

// key light (screen space: x right, y DOWN, z toward the viewer) and the half vector
const LIT = (() => { const v = [-0.5, -0.72, 0.85], l = Math.hypot(...v); return v.map((c) => c / l); })();
const HV = (() => { const v = [LIT[0], LIT[1], LIT[2] + 1], l = Math.hypot(...v); return v.map((c) => c / l); })();

// ---------------------------------------------------------------- small helpers
const cache = new Map();
function cached(key, build) {
  let c = cache.get(key);
  if (c === undefined) { c = build(); cache.set(key, c); if (cache.size > 260) cache.delete(cache.keys().next().value); }
  return c;
}
function newImg(w, h) {
  const c = makeCanvas(w, h), g = c.getContext('2d');
  return { c, g, im: g.createImageData(c.width, c.height) };
}
function put(im, i, rgb, a) { const d = im.data, j = i * 4; d[j] = rgb[0]; d[j + 1] = rgb[1]; d[j + 2] = rgb[2]; d[j + 3] = a; }
const WHITE = [255, 255, 255];
// the 8 px around a silhouette: is (i) a pixel outside `inside` that touches it?
function ringOf(inside, w, h, i, rad) {
  const x = i % w, y = (i / w) | 0;
  for (let dy = -rad; dy <= rad; dy++) for (let dx = -rad; dx <= rad; dx++) {
    if (dx * dx + dy * dy > rad * rad + rad) continue;
    const X = x + dx, Y = y + dy;
    if (X >= 0 && Y >= 0 && X < w && Y < h && inside[Y * w + X]) return true;
  }
  return false;
}

// ---------------------------------------------------------------- the Aero Buck droplet
function sdDrop(x, y, r1, r2, hh) { // IQ uneven capsule, y UP from the bottom circle's centre
  x = Math.abs(x);
  const b = (r1 - r2) / hh, a = Math.sqrt(1 - b * b), k = -b * x + a * y;
  if (k < 0) return Math.sqrt(x * x + y * y) - r1;
  if (k > a * hh) return Math.sqrt(x * x + (y - hh) * (y - hh)) - r2;
  return a * x + b * y - r1;
}
// a droplet `hu` units tall; lvl = squash level (-3 stretch .. +3 squash); canvas origin (ox, oy) = its centre
function bakeDrop(D, hu, lvl) {
  return cached(`drop|${D}|${hu}|${lvl}`, () => {
    const sx = 1 + 0.075 * lvl, sy = 1 - 0.075 * lvl;
    const r1 = hu * 0.39, r2 = hu * 0.045, hh = hu - r1 - r2 - hu * 0.02;
    const pad = 2;
    const wu = r1 * 2 * 1.25 + pad * 2, huu = hu * 1.25 + pad * 2;
    const w = Math.ceil(wu * D), h = Math.ceil(huu * D);
    const { c, g, im } = newImg(w, h);
    const inside = new Uint8Array(w * h);
    // foot (bottom of the round part) sits at a fixed spot so squashes stay grounded
    const footY = pad + hu * 1.12, cx = wu / 2;
    const sd = (u, v) => sdDrop((u - cx) / sx, (footY - v) / sy - r1, r1, r2, hh) * Math.min(sx, sy);
    const height = (u, v) => { const d = sd(u, v); if (d >= 0) return 0; const k = clamp(-d / (r1 * 0.95), 0, 1), e = 1 - k; return r1 * Math.sqrt(1 - e * e); };
    const e = 0.5 / D;
    const topY = footY - (hu - hu * 0.02) * sy;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const u = (x + 0.5) / D, v = (y + 0.5) / D;
      const d = sd(u, v);
      if (d >= 0) continue;
      const i = y * w + x;
      inside[i] = 1;
      let nx = -(height(u + e, v) - height(u - e, v)) / (2 * e), ny = -(height(u, v + e) - height(u, v - e)) / (2 * e), nz = 1;
      const nl = Math.sqrt(nx * nx + ny * ny + nz * nz); nx /= nl; ny /= nl; nz /= nl;
      const vv = (v - topY) / (footY - topY); // 0 tip .. 1 foot
      const lam = nx * LIT[0] + ny * LIT[1] + nz * LIT[2];
      // water refracts the bright sky upside down: deeper at the top, a glowing crescent low and to the right
      let T = 2.4 + 1.5 * sstep(0.35, 0.95, vv) + (lam - LIT[2]) * 1.6;
      const back = -(nx * LIT[0] + ny * LIT[1]); // facing away from the light (bottom-right)
      if (back > 0.2 && nz < 0.92) T += 3.2 * (back - 0.1);
      if (-d < 0.9 / D + 0.25 && back < 0) T -= 0.8; // the lit-side edge reads darker (Fresnel line)
      let idx = clamp(Math.floor(T), 0, 6);
      if (back > 0.5 && -d < r1 * 0.32 && -d > 0.6 / D + 0.2) idx = Math.max(idx, 5); // the caustic crescent
      const sp = nx * HV[0] + ny * HV[1] + nz * HV[2];
      if (sp > 0.965) idx = 7; else if (sp > 0.93) idx = Math.max(idx, 6);
      put(im, i, WATER[idx], 245);
    }
    // a small back glint (bottom right) and the tiny tip glint
    const gl = (gu, gv, n) => { const x = Math.round(gu * D), y = Math.round(gv * D); for (let k = 0; k < n; k++) { const j = y * w + x + k; if (inside[j]) put(im, j, WHITE, 255); } };
    gl(cx + r1 * 0.45 * sx, footY - r1 * 0.42 * sy, Math.max(1, D >> 1));
    gl(cx + r1 * 0.55 * sx, footY - r1 * 0.62 * sy, 1);
    const ol = D >= 4 ? 2 : 1;
    for (let i = 0; i < w * h; i++) if (!inside[i] && ringOf(inside, w, h, i, ol)) put(im, i, INK.drop, 255);
    g.putImageData(im, 0, 0);
    c.ox = cx * D; c.oy = (footY - hu * 0.5) * D; // the drop's centre (at rest)
    return c;
  });
}

// glossy round beads for the gain splash
function bakeBead(D, ru) {
  return cached(`bead|${D}|${ru}`, () => {
    const r = Math.max(1, ru * D), n = Math.ceil(r * 2 + 2);
    const { c, g, im } = newImg(n, n);
    const cx = n / 2, inside = new Uint8Array(n * n);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const dx = (x + 0.5 - cx) / r, dy = (y + 0.5 - cx) / r, q = dx * dx + dy * dy;
      if (q >= 1) continue;
      inside[y * n + x] = 1;
      const nz = Math.sqrt(1 - q), lam = dx * LIT[0] + dy * LIT[1] + nz * LIT[2];
      let idx = clamp(Math.floor(4.6 + (lam - 0.5) * 3 + (dy > 0.3 ? 1.2 : 0)), 3, 6);
      if (lam > 0.93) idx = 7;
      put(im, y * n + x, WATER[idx], 255);
    }
    for (let i = 0; i < n * n; i++) if (!inside[i] && ringOf(inside, n, n, i, 1)) put(im, i, [18, 72, 150], 235);
    g.putImageData(im, 0, 0);
    return c;
  });
}

// ---------------------------------------------------------------- the Byte Gem (faceted octagonal brilliant)
const GEM_N = 8, GEM_FRAMES = 8;
function gemGeometry(theta) {
  const tilt = 0.3, ct = Math.cos(tilt), st = Math.sin(tilt);
  const ring = (r, y, off) => { const out = []; for (let i = 0; i < GEM_N; i++) { const a = theta + off + (i * Math.PI * 2) / GEM_N; out.push([r * Math.cos(a), y, r * Math.sin(a)]); } return out; };
  const T = ring(0.58, 0.36, 0), G = ring(1, 0, 0), C = [0, -1.0, 0];
  // view: y up -> screen y down; tilt the top toward the viewer; z toward the viewer
  const view = ([x, y, z]) => { const y2 = y * ct - z * st, z2 = y * st + z * ct; return [x, -y2, z2]; };
  const faces = [];
  const add = (pts, kind, i) => {
    const P = pts.map(view);
    // normal (outward): cross of two edges, oriented away from the centroid
    const a = P[0], b = P[1], c = P[2];
    let n = [(b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]), (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]), (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])];
    const cen = P.reduce((s, p) => [s[0] + p[0] / P.length, s[1] + p[1] / P.length, s[2] + p[2] / P.length], [0, 0, 0]);
    const oc = view([0, 0.05, 0]);
    if (n[0] * (cen[0] - oc[0]) + n[1] * (cen[1] - oc[1]) + n[2] * (cen[2] - oc[2]) < 0) n = n.map((q) => -q);
    const l = Math.hypot(...n); n = n.map((q) => q / l);
    if (n[2] <= 0.02) return;
    faces.push({ P, n, kind, i, cen });
  };
  add(T.slice(), 'table', 0);
  for (let i = 0; i < GEM_N; i++) {
    const j = (i + 1) % GEM_N;
    add([T[i], T[j], G[j], G[i]], 'crown', i);
    add([G[i], G[j], C], 'pav', i);
  }
  return faces;
}
function inPoly(P, x, y) { // convex polygon (either winding)
  let s = 0;
  for (let k = 0; k < P.length; k++) {
    const a = P[k], b = P[(k + 1) % P.length];
    const cr = (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]);
    if (cr !== 0) { const sg = cr > 0 ? 1 : -1; if (s === 0) s = sg; else if (sg !== s) return false; }
  }
  return true;
}
function edgeDist(P, x, y) {
  let m = 1e9;
  for (let k = 0; k < P.length; k++) {
    const a = P[k], b = P[(k + 1) % P.length], dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
    const t = clamp(((x - a[0]) * dx + (y - a[1]) * dy) / L2, 0, 1);
    const ex = x - a[0] - dx * t, ey = y - a[1] - dy * t; m = Math.min(m, Math.sqrt(ex * ex + ey * ey));
  }
  return m;
}
// wu = gem width in units; f = rotation frame (0..GEM_FRAMES-1 over one 45 degree facet step); bright = gain flash
function bakeGem(D, wu, f, bright) {
  return cached(`gem|${D}|${wu}|${f}|${bright ? 1 : 0}`, () => {
    const sc = wu / 2, pad = 1.5;
    const w = Math.ceil((wu + pad * 2) * D), h = Math.ceil((sc * 1.75 + pad * 2) * D);
    const { c, g, im } = newImg(w, h);
    const inside = new Uint8Array(w * h);
    const faces = gemGeometry(((f / GEM_FRAMES) * Math.PI * 2) / GEM_N + 0.2);
    let minY = 1e9;
    for (const F of faces) for (const p of F.P) minY = Math.min(minY, p[1]);
    const ox = w / 2, oy = pad * D - minY * sc * D;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const gx = (x + 0.5 - ox) / (sc * D), gy = (y + 0.5 - oy) / (sc * D);
      let F = null;
      for (const q of faces) if (inPoly(q.P, gx, gy)) { if (!F || q.cen[2] > F.cen[2]) F = q; }
      if (!F) continue;
      const i = y * w + x;
      inside[i] = 1;
      const n = F.n, lam = n[0] * LIT[0] + n[1] * LIT[1] + n[2] * LIT[2];
      let T = F.kind === 'table' ? 3.3 : F.kind === 'crown' ? 1.8 + lam * 2.2 : 1.6 + lam * 1.4 + n[2] * 1.3; // pavilion: light bounces back out of the middle
      if ((F.i & 1) && F.kind !== 'table') T += 0.45; // alternating facet tones
      if (bright) T += 2.6;
      let idx = clamp(Math.floor(T), 0, 6);
      const sp = n[0] * HV[0] + n[1] * HV[1] + n[2] * HV[2];
      if (sp > 0.992) idx = 7; else if (sp > 0.975) idx = Math.max(idx, 6);
      let col = VIOLET[idx];
      // light facet edges (the cut catching light), 1 device px
      if (edgeDist(F.P, gx, gy) * sc * D < 0.75) col = bright ? WHITE : VIOLET[Math.min(7, idx + 1)];
      // cyan "byte" pixels glowing inside the pavilion
      if (F.kind === 'pav' && F.i % 3 === 0) {
        const bx = F.cen[0] * 0.7, by = F.cen[1] * 0.75 + 0.05;
        if (Math.abs(gx - bx) * sc < 0.65 && Math.abs(gy - by) * sc < 0.65) col = hexRGB(bright ? '#e6ffff' : '#7ff4ff');
      }
      if (F.kind === 'table' && Math.abs(gx + 0.18) * sc < 0.6 && Math.abs(gy + 0.42) * sc < 0.5) col = hexRGB('#b8fbff');
      put(im, i, col, 255);
    }
    const ol = D >= 4 ? 2 : 1;
    for (let i = 0; i < w * h; i++) if (!inside[i] && ringOf(inside, w, h, i, ol)) put(im, i, INK.gem, 255);
    g.putImageData(im, 0, 0);
    // centre of the girdle's bounding box
    c.ox = w / 2; c.oy = oy + sc * D * 0.12;
    return c;
  });
}


// ---------------------------------------------------------------- layout (art px = logical px)
export const WALLET_ART = {
  FULL: { H: 24, minA: '0000', hop: 2, leaf: true, capK: 0.42 },
  MINI: { H: 19, minA: '000', hop: 1, leaf: false, capK: 0.47 },
};

// ---- the hand-drawn 13 px digit face (8 px cells, 2 px strokes)
const D13_ART = {
  0: ['..####..', '.######.', '###..###', '##....##', '##....##', '##....##', '##....##', '##....##', '##....##', '##....##', '###..###', '.######.', '..####..'],
  1: ['...##...', '..###...', '.####...', '.#.##...', '...##...', '...##...', '...##...', '...##...', '...##...', '...##...', '...##...', '.######.', '.######.'],
  2: ['..####..', '.######.', '###..###', '##....##', '......##', '.....###', '....###.', '...###..', '..###...', '.###....', '###.....', '########', '########'],
  3: ['..####..', '.######.', '###..###', '##....##', '......##', '....###.', '....###.', '......##', '......##', '##....##', '###..###', '.######.', '..####..'],
  4: ['....###.', '...####.', '..##.##.', '.##..##.', '##...##.', '##...##.', '########', '########', '.....##.', '.....##.', '.....##.', '.....##.', '.....##.'],
  5: ['########', '########', '##......', '##......', '######..', '#######.', '.....###', '......##', '......##', '......##', '##...###', '.######.', '..####..'],
  6: ['..####..', '.######.', '###..###', '##......', '##......', '######..', '#######.', '###..###', '##....##', '##....##', '###..###', '.######.', '..####..'],
  7: ['########', '########', '......##', '.....###', '.....##.', '....###.', '....##..', '...###..', '...##...', '...##...', '...##...', '...##...', '...##...'],
  8: ['..####..', '.######.', '###..###', '##....##', '###..###', '.######.', '.######.', '###..###', '##....##', '##....##', '###..###', '.######.', '..####..'],
  9: ['..####..', '.######.', '###..###', '##....##', '##....##', '###..###', '.#######', '..######', '......##', '......##', '###..###', '.######.', '..####..'],
  ',': ['..', '..', '..', '..', '..', '..', '..', '..', '..', '##', '##', '.#', '#.'],
  '.': ['..', '..', '..', '..', '..', '..', '..', '..', '..', '..', '..', '##', '##'],
  M: ['##......##', '###....###', '####..####', '##.####.##', '##..##..##', '##......##', '##......##', '##......##', '##......##', '##......##', '##......##', '##......##', '##......##'],
};
const FACES = [{ cap: 9, font: 'big', s: 1 }, { cap: 13, font: 'd13', s: 1 }, { cap: 18, font: 'big', s: 2 }, { cap: 26, font: 'd13', s: 2 }, { cap: 27, font: 'big', s: 3 }];
function faceOf(S, H) {
  const lim = Math.max(9, H * S.capK);
  let f = FACES[0];
  for (const F of FACES) if (F.cap <= lim) f = F;
  return f;
}
const isDigit = (ch) => ch >= '0' && ch <= '9';
// a glyph's 1-bit bitmap {w, h, bits} in art px
const bitsMemo = new Map();
function glyphBits(ch, F) {
  const key = ch + '|' + F.font + '|' + F.s;
  let v = bitsMemo.get(key);
  if (v) return v;
  const art = F.font === 'd13' ? D13_ART[ch] : null;
  if (art) {
    const s = F.s, w = art[0].length * s, h = art.length * s, bits = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) bits[y * w + x] = art[(y / s) | 0][(x / s) | 0] === '#' ? 1 : 0;
    v = { w, h, bits };
  } else {
    const font = 'big', s = F.font === 'big' ? F.s : Math.max(1, Math.round(F.cap / 9));
    const gw = Math.max(1, measureText(ch, font, s)), gh = (isDigit(ch) ? 9 : 12) * s, m = makeCanvas(gw, gh), g = m.getContext('2d'); // (the comma's tail hangs below)
    drawText(g, ch, 0, 0, { font, color: '#ffffff', scale: s });
    const d = g.getImageData(0, 0, gw, gh).data, bits = new Uint8Array(gw * gh);
    for (let i = 0; i < gw * gh; i++) bits[i] = d[i * 4 + 3] > 128 ? 1 : 0;
    v = { w: gw, h: gh, bits };
  }
  bitsMemo.set(key, v);
  return v;
}
const advOf = (ch, F) => glyphBits(isDigit(ch) ? '0' : ch, F).w + F.s;
const textW = (s, F) => { let w = 0; for (const ch of s) w += advOf(ch, F); return Math.max(0, w - F.s); };

// layout of a wallet H art px tall with digit fields aw / gw wide
function layoutOf(H, aw, gw, F) {
  const m = H < 22 ? 1 : Math.max(2, Math.round(H * 0.09)), Db = H - m * 2;
  let Hc = Math.max(F.cap + 6, Math.round(H * 0.62));
  if ((H - Hc) % 2) Hc++;
  const cy0 = (H - Hc) / 2, gap = Math.max(1, Math.round(H * 0.05)), pad = Math.max(3, Math.round(Hc * 0.36));
  const dA = { x: m, y: m, d: Db };
  const chA = { x: m + Db + gap, y: cy0, w: aw + pad * 2, h: Hc };
  const seam = chA.x + chA.w + Math.max(2, Math.round(H * 0.1));
  const dG = { x: seam + Math.max(2, Math.round(H * 0.09)), y: m, d: Db };
  const chG = { x: dG.x + Db + gap, y: cy0, w: gw + pad * 2, h: Hc };
  const W = chG.x + chG.w + cy0;
  return { W, H, m, Db, dA, dG, chA, chG, seam, pad, F };
}
function layoutFor(ui, mini, p) {
  const S = mini ? WALLET_ART.MINI : WALLET_ART.FULL;
  const H = Math.max(12, Math.round(S.H * p)), F = faceOf(S, H);
  const t = texts(ui, S, F);
  return { S, L: layoutOf(H, t.aw, t.gw, F), ...t };
}

// ---------------------------------------------------------------- the body: a two-tone pixel bubble capsule
const WELL = {
  a: { ink: '#06284a', top: '#063a66', fill: '#0c548e', fill2: '#0e62a0', bev: '#62dcf6' },
  g: { ink: '#170f4e', top: '#1a1050', fill: '#2e2282', fill2: '#382a94', bev: '#b4a4ff' },
};
function drawWell(g, x, y, w, h, side) {
  const C = WELL[side], ins = circleInsets(h);
  const row = (yy, col, k = 0) => { const i = ins[yy] + k; if (w - i * 2 > 0) { g.fillStyle = col; g.fillRect(x + i, y + yy, w - i * 2, 1); } };
  for (let yy = 0; yy < h; yy++) row(yy, C.ink);
  for (let yy = 1; yy < h - 1; yy++) row(yy, yy < h * 0.55 ? C.fill : C.fill2, 1);
  // inner shadow under the top edge, a light bevel along the bottom
  g.fillStyle = C.top;
  for (let yy = 1; yy < 3 && yy < h - 1; yy++) { const i = Math.max(ins[yy - 1], ins[yy], ins[yy + 1] ?? 0) + 1; g.fillRect(x + i, y + yy, w - i * 2, 1); }
  g.fillStyle = C.bev;
  { const yy = h - 2, i = Math.max(ins[yy - 1], ins[yy], ins[yy + 1]) + 1; g.fillRect(x + i + 1, y + yy, w - i * 2 - 2, 1); }
}
const AQUA_T = { top: '#b4f4ff', mid: '#38c4ec', bot: '#1886cc', edge: '#06284a', glow: '#9ff8ff' };
const VIO_T = { top: '#e0d8ff', mid: '#8c7cf4', bot: '#5a44cc', edge: '#170f4e', glow: '#e4dcff' };
function bakeBody(L, mini) {
  return cached(`body|${L.W}|${L.H}|${L.chA.w}|${L.chG.w}|${mini ? 1 : 0}`, () => {
    const { W, H } = L;
    const c = makeCanvas(W, H + 1), g = c.getContext('2d');
    const half = (x0, x1) => [Math.round(x0 + (x1 - x0) * 0.08), Math.round(x0 + (x1 - x0) * 0.55)];
    const sA = half(L.chA.x, L.seam), sG = half(L.dG.x + L.Db * 0.5, W - H / 2);
    g.drawImage(pixelBubbleCanvas(W, H, { tone: AQUA_T, tone2: VIO_T, split: L.seam, shadow: 1, glossSpans: [sA, [sA[1] + 2, sA[1] + 5], sG, [sG[1] + 2, sG[1] + 4]] }), 0, 0);
    drawWell(g, L.chA.x, L.chA.y, L.chA.w, L.chA.h, 'a');
    drawWell(g, L.chG.x, L.chG.y, L.chG.w, L.chG.h, 'g');
    // the droplet and the gem each sit in a round translucent pixel soap bubble
    g.drawImage(pixelBubbleCanvas(L.Db, L.Db, { glass: true, tone: { top: '#ffffff', mid: '#9ff0ff', bot: '#38b8e8', edge: '#06284a', glow: '#e0ffff' }, fill: '#c8f6ff' }), L.dA.x, L.dA.y);
    g.drawImage(pixelBubbleCanvas(L.Db, L.Db, { glass: true, tone: { top: '#ffffff', mid: '#d4ccff', bot: '#8c7cf4', edge: '#170f4e', glow: '#f0ecff' }, fill: '#e4defe' }), L.dG.x, L.dG.y);
    return c;
  });
}
// the capsule silhouette (white), for the sweep / hover light
function bodyMask(L) {
  return cached(`mask|${L.W}|${L.H}`, () => {
    const c = makeCanvas(L.W, L.H), g = c.getContext('2d'), ins = circleInsets(L.H);
    g.fillStyle = '#ffffff';
    for (let y = 1; y < L.H - 1; y++) { const i = ins[y] + 1; g.fillRect(i, y, L.W - i * 2, 1); }
    return c;
  });
}

// ---------------------------------------------------------------- digits (crisp pixel numbers)
function glyphArt(ch, F, tone, flash) {
  return cached(`dig|${ch}|${F.font}|${F.s}|${tone}|${flash ? 1 : 0}`, () => {
    const B = glyphBits(ch, F), w = B.w + 2, h = B.h + 3;
    const { c, g, im } = newImg(w, h);
    const solid = new Uint8Array(w * h);
    for (let y = 0; y < B.h; y++) for (let x = 0; x < B.w; x++) if (B.bits[y * B.w + x]) solid[(y + 1) * w + x + 1] = 1;
    const ink = tone === 'g' ? hexRGB('#170f4e') : hexRGB('#06284a');
    const lo = hexRGB(flash ? '#fff0a0' : tone === 'g' ? '#e2deff' : '#c8f4ff');
    for (let y = h - 1; y >= 0; y--) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (solid[i]) { put(im, i, (y - 1) / B.h < 0.52 ? WHITE : lo, 255); continue; }
      if (ringOf(solid, w, h, i, 1)) { put(im, i, ink, 255); continue; }
      const up = i - w;
      if (up >= 0 && (solid[up] || ringOf(solid, w, h, up, 1))) put(im, i, [2, 20, 44], 120);
    }
    g.putImageData(im, 0, 0);
    return c;
  });
}

// ---------------------------------------------------------------- state
// ---------------------------------------------------------------- state
function hopState(ui, key, txt) {
  const H = (ui.walletHop ||= {});
  let st = H[key];
  if (!st) st = H[key] = { txt, hop: [] };
  if (st.txt !== txt) {
    const a = st.txt, b = txt, hop = [];
    for (let i = 0; i < b.length; i++) {
      const j = a.length - (b.length - i);
      hop[i] = j < 0 || a[j] !== b[i] ? 1 : Math.max(0, st.hop[i - (b.length - a.length)] || 0);
    }
    st.txt = txt; st.hop = hop;
  }
  return st;
}
export function walletTick(ui, dt) {
  for (const st of Object.values(ui.walletHop || {})) for (let i = 0; i < st.hop.length; i++) st.hop[i] = Math.max(0, (st.hop[i] || 0) - dt * 3.6);
  const W = (ui.walletFx ||= { sweep: -1, gemSpin: 0, lastC: 0, lastG: 0 });
  if (ui.coinBump > 0.95 && W.lastC <= 0.95) W.sweep = 0; // a gloss sweep on each gain
  if (ui.gemBump > 0.95 && W.lastG <= 0.95) W.sweep = 0;
  W.lastC = ui.coinBump || 0; W.lastG = ui.gemBump || 0;
  if (W.sweep >= 0) { W.sweep += dt * 1.6; if (W.sweep > 1) W.sweep = -1; }
  W.gemSpin = (W.gemSpin || 0) + dt * ((ui.gemBump || 0) * 5.5); // <= ~1 baked frame per tick (no strobing)
  // warm the header wallet's bakes in the background (one small job per frame), so opening a window never hitches
  if (!W.warm && (ui.time || 0) > 3) {
    const p = walletP(ui.game?.state?.settings?.uiScale || 'big'), { L } = layoutFor(ui, true, p), F = L.F;
    W.warm = [() => bakeBody(L, true), () => bakeDrop(1, dropHOf(L), 0), () => bakeGem(1, gemWOf(L), 0, false), () => bakeGem(1, gemWOf(L), 0, true)];
    for (const ch of '0123456789,') for (const tone of ['a', 'g']) W.warm.push(() => glyphArt(ch, F, tone, false));
  }
  if (W.warm?.length) { try { W.warm.shift()(); } catch { W.warm.length = 0; } }
}

const fmtShort = (n) => (n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 1 : 2) + 'M' : fmtAero(n));
function texts(ui, S, F) {
  const aTxt = fmtShort(Math.floor(ui.coinShown || 0)), gTxt = String(Math.floor(ui.gemShown || 0));
  const aw = Math.max(textW(aTxt, F), textW(S.minA, F)), gw = Math.max(textW(gTxt, F), textW('00', F));
  return { aTxt, gTxt, aw, gw };
}
const dropHOf = (L) => Math.max(8, Math.round(L.Db * (L.Db < 20 ? 0.8 : 0.7)));
const gemWOf = (L) => Math.max(8, Math.round(L.Db * (L.Db < 20 ? 0.76 : 0.64)));

// ---------------------------------------------------------------- drawing
let fxC = null;
export function drawWalletPlaque(ctx, ui, o = {}) {
  const p = o.p || 1, t = ui.time || 0;
  const rm = !!ui.game?.state?.settings?.reducedMotion;
  const fx = ui.walletFx || { sweep: -1, gemSpin: 0 };
  const { S, L, aTxt, gTxt } = layoutFor(ui, o.mini, p);
  const F = L.F, W = L.W, H = L.H;
  const x0 = Math.round(o.right - W), y0 = Math.round(o.y) - (o.hov ? 1 : 0);
  const blit = (c, cx, cy, dy = 0) => ctx.drawImage(c, x0 + Math.round(cx - (c.ox || 0)), y0 + Math.round(cy - (c.oy || 0)) + dy);
  const sm = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  // ---- a hand-drawn pixel leaf twig behind the left end (HUD wallet only)
  if (S.leaf) drawLeafSprig(ctx, x0 + Math.round(H * 0.42), y0 + 3, 'tl', 'S', 1, { t, phase: 0.7 });
  // ---- the capsule (baked: body, wells, icon bubbles)
  const body = bakeBody(L, o.mini);
  ctx.drawImage(body, x0, y0);
  // ---- tiny pixel bubbles rising past each number well (behind the numbers)
  if (!rm) {
    const bub = pixelBubbleCanvas(H >= 30 ? 5 : 4, H >= 30 ? 5 : 4, { glass: true, tone: { top: '#ffffff', mid: '#c8f6ff', bot: '#62dcf6', edge: '#1a6aa8' }, gloss: false });
    for (const [ch, per, ph] of [[L.chA, 5.2, 0], [L.chG, 6.4, 2.7]]) {
      const k = ((t + ph) % per) / per;
      if (k > 0.75) continue;
      const kk = k / 0.75;
      const bx = ch.x + Math.round(ch.h * 0.45) + Math.round(Math.sin(t * 3 + ph) * 0.6), by = ch.y + ch.h - 2 - bub.height - Math.round(kk * (ch.h - 4 - bub.height));
      ctx.drawImage(bub, x0 + bx, y0 + by);
    }
  }
  // ---- gloss sweep (gain, and idly every ~7 s) + hover light: a stair-stepped pixel band masked to the capsule
  let sw = fx.sweep;
  if (sw < 0 && !rm) { const k = (t % 7.2) / 1.1; if (k < 1) sw = k; }
  if (sw >= 0 || o.hov) {
    if (!fxC || fxC.width < W || fxC.height < H) fxC = makeCanvas(Math.max(W, fxC?.width || 0), Math.max(H, fxC?.height || 0));
    const g = fxC.getContext('2d');
    g.globalCompositeOperation = 'source-over';
    g.clearRect(0, 0, fxC.width, fxC.height);
    if (o.hov) { g.fillStyle = 'rgba(255,255,255,0.14)'; g.fillRect(0, 0, W, H); }
    if (sw >= 0) {
      const bw = Math.max(3, Math.round(H * 0.22)), xx = Math.round(-H - bw + sw * (W + H + bw * 2));
      for (let y = 0; y < H; y++) { // 1:2 stair steps
        const sx = xx + Math.round((H - y) * 0.5);
        g.fillStyle = 'rgba(255,255,255,0.4)'; g.fillRect(sx, y, bw, 1);
        g.fillStyle = 'rgba(255,255,255,0.28)'; g.fillRect(sx + bw + 2, y, Math.max(1, bw >> 2), 1);
      }
    }
    g.globalCompositeOperation = 'destination-in';
    g.drawImage(bodyMask(L), 0, 0);
    ctx.drawImage(fxC, 0, 0, W, H, x0, y0, W, H);
  }
  // ---- the droplet: wobbles (squash frames) on gain, a slow 1 px idle bob
  const dcx = L.dA.x + L.Db / 2, dcy = L.dA.y + L.Db / 2;
  const dropH = dropHOf(L);
  let lvl = 0;
  if (ui.coinBump > 0) { const u = 1 - ui.coinBump; lvl = Math.round(Math.sin(u * Math.PI * 3) * 3 * ui.coinBump); }
  const bob = rm ? 0 : Math.round(Math.sin(t * 1.6) * 0.6);
  const hopD = ui.coinBump > 0 ? Math.round(Math.sin(ui.coinBump * Math.PI) * Math.max(1, H * 0.06)) : 0;
  blit(bakeDrop(1, dropH, Math.max(-3, Math.min(3, lvl))), dcx, dcy + 0.5, bob - hopD);
  if (ui.coinBump > 0.02) { // pixel beads burst up out of the droplet and fall back
    const u = Math.min(1, (1 - ui.coinBump) * 1.5), sc = H / 24;
    const big = bakeBead(1, H >= 30 ? 1.6 : 1.2), sml = bakeBead(1, H >= 30 ? 1.1 : 0.8);
    for (const [vx, vy, b] of [[-5, 24, 1], [6, 26, 1], [-12, 19, 0], [13, 20, 0], [-17, 13, 0], [18, 14, 0], [1, 30, 0]]) {
      if (u >= 1) break;
      const ux = dcx + vx * u * sc, uy = dcy - dropH * 0.3 - (vy * u - 34 * u * u) * sc;
      const c = b && u < 0.7 ? big : sml;
      const a0 = ctx.globalAlpha;
      if (u > 0.75) ctx.globalAlpha = a0 * (u > 0.88 ? 0.33 : 0.66); // fades in two steps
      ctx.drawImage(c, x0 + Math.round(ux - c.width / 2), y0 + Math.round(uy - c.height / 2));
      ctx.globalAlpha = a0;
    }
  }
  // ---- the gem: idle facet turn now and then, a fast spin + bright flash + twinkles on gain
  const gcx = L.dG.x + L.Db / 2, gcy = L.dG.y + L.Db / 2;
  const gemW = gemWOf(L);
  let spin = fx.gemSpin || 0;
  if (!rm) { const k = (t % 5.5) / 0.9; if (k < 1) spin += (k * k * (3 - 2 * k)) * 2; }
  const gf = ((Math.floor(spin * GEM_FRAMES) % GEM_FRAMES) + GEM_FRAMES) % GEM_FRAMES;
  const hopG = ui.gemBump > 0 ? Math.round(Math.sin(ui.gemBump * Math.PI) * Math.max(1, H * 0.06)) : 0;
  const bright = ui.gemBump > 0.5 && ((t * 12) | 0) % 3 !== 2; // the bright twin, hard-swapped (a little flicker)
  blit(bakeGem(1, gemW, gf, bright), gcx, gcy - 0.5, -hopG);
  const sk = H >= 30 ? 3 : 2;
  if (ui.gemBump > 0.05) {
    const u = 1 - ui.gemBump;
    const tw = (a, b2) => Math.max(0, Math.round(Math.sin(Math.max(0, Math.min(1, u * 2 - a)) * Math.PI) * b2));
    const s1 = tw(0, sk), s2 = tw(0.4, sk - 1), s3 = tw(0.2, sk - 1);
    if (s1) drawSparkle(ctx, x0 + Math.round(gcx + gemW * 0.45), y0 + Math.round(gcy - gemW * 0.42), s1, 1, '#ffffff');
    if (s2) drawSparkle(ctx, x0 + Math.round(gcx - gemW * 0.5), y0 + Math.round(gcy + gemW * 0.18), s2, 1, '#e8d4ff');
    if (s3) drawSparkle(ctx, x0 + Math.round(gcx + gemW * 0.15), y0 + Math.round(gcy - gemW * 0.75 - u * 3), s3, 1, '#9ff8ff');
  } else if (!rm && (t % 3.3) < 0.22) {
    drawSparkle(ctx, x0 + Math.round(gcx - gemW * 0.22), y0 + Math.round(gcy - gemW * 0.3), 1, 1, '#ffffff');
  }
  // ---- numbers (right-aligned in their wells, fixed-width digit cells; each changed digit hops and flashes)
  const hopPx = Math.max(1, Math.round(S.hop * p));
  const digits = (txt, ch, tone, st, flash) => {
    let ax = ch.x + ch.w - L.pad - textW(txt, F);
    const dy = ch.y + Math.round((ch.h - F.cap) / 2);
    for (let i = 0; i < txt.length; i++) {
      const c = txt[i], hp = st.hop[i] || 0;
      const lift = hp > 0 ? Math.round(Math.sin(hp * Math.PI) * hopPx) : 0;
      const inset = isDigit(c) ? Math.floor((glyphBits('0', F).w - glyphBits(c, F).w) / 2) : 0;
      const gc = glyphArt(c, F, tone, flash && hp > 0.4);
      ctx.drawImage(gc, x0 + ax + inset - 1, y0 + dy - 1 - lift);
      ax += advOf(c, F);
    }
  };
  const id = o.id || 'hud';
  digits(aTxt, L.chA, 'a', hopState(ui, id + 'a', aTxt), ui.coinBump > 0.2);
  digits(gTxt, L.chG, 'g', hopState(ui, id + 'g', gTxt), ui.gemBump > 0.2);
  ctx.imageSmoothingEnabled = sm;
  const split = x0 + L.seam;
  return {
    x: x0, y: y0, w: W, h: H, p,
    drop: { x: Math.round(x0 + dcx), y: Math.round(y0 + dcy) }, gem: { x: Math.round(x0 + gcx), y: Math.round(y0 + gcy) },
    a: { x: x0, y: y0, w: split - x0, h: H }, g: { x: split, y: y0, w: x0 + W - split, h: H },
  };
}

// logical size of a wallet, for layout before drawing
export function walletSize(ui, o = {}) {
  const { L } = layoutFor(ui, o.mini, o.p || 1);
  return { w: L.W, h: L.H };
}

export function walletTip(ui, onGem) {
  const st = ui.game?.state || {};
  return onGem
    ? `{bytegem} ${GEM_NAME}: ${gems(st)}\nEarned from quests, orders and milestones.\nSkip timers or buy cosmetics with them.`
    : `{abdrop} ${CURRENCY}: ${fmtAero(st.coins || 0)}\nWater-droplet money from fish and your tank.`;
}

// the compact wallet for window headers (replaces each window's own Aero / gem pills): right-aligned at `right`, top
// at y, ~19 logical px tall at p = 1. While one is showing, the HUD wallet steps aside (no duplicate) and coin / gem
// flights land on this one. Returns its rect.
export function drawHeaderWallet(ctx, ui, right, y, o = {}) {
  const p = o.p || 1;
  const r0 = walletSize(ui, { mini: true, p });
  const hovR = { x: right - r0.w, y, w: r0.w, h: r0.h };
  const hov = !o.noHover && ui.hover?.(hovR);
  const lay = drawWalletPlaque(ctx, ui, { right, y, p, mini: true, hov, id: 'hdr' });
  ui.hdrWallet = { ...lay, time: ui.time };
  if (hov) ui.tip = walletTip(ui, ui.inp && ui.inp.x >= lay.g.x);
  return { x: lay.x, y: lay.y, w: lay.w, h: lay.h };
}

// logical px per wallet unit by UI size
export function walletP(mode) {
  if (HI_ON.on) return mode === 'huge' ? 2 : mode === 'normal' ? 1 : 1.5;
  return mode === 'huge' ? 3 : mode === 'normal' ? 1 : 2;
}

// dev / screenshot hook: the bakers (art px canvases)
export const WALLET_BAKE = { body: (ui, mini, p) => bakeBody(layoutFor(ui, mini, p).L, mini), drop: bakeDrop, gem: bakeGem, glyph: glyphArt, bead: bakeBead, faceOf, D13_ART };
