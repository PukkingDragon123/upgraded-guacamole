// [wallet33] The currency wallet as a glossy 3D Frutiger-Aero GLASS SLAB (replaces the [wallet32] brass pixel plaque).
// User direction: "new money and gem UI more like Frutiger Aero and 3D".
//
// Everything here is a small CPU 3D render baked at DEVICE resolution (D device px per wallet unit; on the 2x UI layer
// a unit of p logical px is D = 2p device px) and blitted 1:1 with nearest neighbour, so it stays crisp and every edge
// lands on a whole device pixel. The renders use the [cel29] model: one top-left key light, light quantised into
// hand-picked hue-shifted ramps (deep / shadow / mid / lit / highlight / specular), a hard specular shape, a lit rim on
// the edge turned away from the light and a dark ink outline.
//   - The slab: a thick translucent aqua glass capsule (height field: quarter-round bevel, a concave dimple at each
//     icon, a sunken number channel per half, a groove between the halves; normals by finite differences). Banded body
//     (darker under the top, glowing at the bottom like light caught in glass), a crisp white gloss lens over the top
//     with a sky-and-cloud reflection, a cyan Fresnel rim, white glints, a few baked micro bubbles, a banded drop
//     shadow. The Byte Gem half is tinted periwinkle-violet. A small glossy 3D leaf sprouts behind the left end.
//     Baked once per (size, digit-field widths, D); caustic shimmer = 8 baked sparse overlay frames, cross-faded.
//   - The Aero Buck: a glossy translucent 3D water droplet (uneven-capsule SDF, dome normals, inverted refraction
//     banding, hard white spec oval + a small back glint), baked per squash level for the gain wobble.
//   - The Byte Gem: a faceted octagonal brilliant (table, 8 crown facets, 8 pavilion facets) rasterised per pixel
//     with flat cel-shaded facets, light facet edges and cyan "byte" pixels; 8 frames cover one 45 degree step of its
//     8-fold symmetry (so it spins seamlessly), plus a bright twin for the gain flash.
//   - Digits: the game's 'big' pixel face blown up to D px, white with a pale-aqua lower half, a 1 px cyan (gem: lilac)
//     rim, a dark ink outline and a hard drop shadow; fixed-width cells, so nothing jitters while counting. At D = 1
//     (the 1x layer at normal size) the 7 px face without the rim keeps them legible (specOf).
// Motion (cheap: blits of baked canvases): on gain the droplet wobbles (squash frames) and throws glossy beads, the
// gem spins fast with a bright flash and pixel twinkles, changed digits hop and flash, a gloss sweep runs across the
// glass; idle: the gloss sweep every ~7 s, caustics shimmer, a bubble rises in each half, the gem turns one facet now
// and then. Reduced motion keeps it still. NO light-ray fans, NO expanding rings.
//
// API (re-exported by gemui.js; ui.js / quests / lab / workshop / wardrobe / shoppanel call it):
//   drawWalletPlaque(ctx, ui, {right, y, p, mini, hov, id}) -> {x, y, w, h, p, drop, gem, a, g}
//   walletSize(ui, {mini, p}) -> {w, h}     walletTip(ui, onGem)     walletTick(ui, dt)     walletP(mode)
//   drawHeaderWallet(ctx, ui, right, y, o)  the compact (MINI) slab for window headers; records ui.hdrWallet
//   WALLET_ART                              the layout specs (FULL / MINI, in wallet units)

import { makeCanvas } from '../core/canvas.js';
import { drawText, measureText } from '../gfx/font.js';
import { GEM_NAME, gems } from '../game/gems.js';
import { CURRENCY, fmtAero } from './aero.js';
import { HI_ON, isHi } from '../gfx/hires.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const hexRGB = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const ramp = (arr) => arr.map(hexRGB);

// ---------------------------------------------------------------- palettes (cel ramps, dark -> light)
const AQUA = ramp(['#06436a', '#08648f', '#0a88b2', '#12aacc', '#2ccadc', '#74e6e4', '#c4faee', '#ffffff']);
const LILAC = ramp(['#1e1868', '#2c278e', '#3d3cae', '#5155cc', '#6e74e2', '#9a9ef2', '#d2d4fc', '#ffffff']);
const WATER = ramp(['#072a72', '#0b46a6', '#1168d0', '#1c8eec', '#38b2f8', '#78d6fc', '#c6f2ff', '#ffffff']);
const VIOLET = ramp(['#2a0a66', '#43129a', '#6020c4', '#8236e6', '#a35cf8', '#c890ff', '#ecd6ff', '#ffffff']);
const LEAF = ramp(['#0c3e22', '#13602e', '#1f863a', '#3aac3c', '#70cc44', '#aee868', '#e2fbb0', '#ffffff']);
const INK = { a: hexRGB('#06284a'), g: hexRGB('#170f4e'), drop: hexRGB('#061d52'), gem: hexRGB('#1c0646'), leaf: hexRGB('#08311a') };
const RIM = { a: hexRGB('#8af0ff'), g: hexRGB('#c2c4ff') };

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
function blend(rgb, w, k) { return [rgb[0] + (w[0] - rgb[0]) * k, rgb[1] + (w[1] - rgb[1]) * k, rgb[2] + (w[2] - rgb[2]) * k]; }
const WHITE = [255, 255, 255];
// signed distance to a rounded rectangle centred (cx, cy), half size (hw, hh), corner radius r
function sdRR(x, y, cx, cy, hw, hh, r) {
  const qx = Math.abs(x - cx) - (hw - r), qy = Math.abs(y - cy) - (hh - r);
  const ox = Math.max(qx, 0), oy = Math.max(qy, 0);
  return Math.sqrt(ox * ox + oy * oy) + Math.min(Math.max(qx, qy), 0) - r;
}
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

// ---------------------------------------------------------------- layout (wallet units)
export const WALLET_ART = {
  FULL: { H: 24, B: 3.4, dimR: 8.1, dimDep: 2.4, chH: 15, chDep: 1.5, chB: 1.4, font: 'big', cap: 9, padR: 2.4, gap: 1.2, minA: '0000', hop: 2, leaf: true },
  MINI: { H: 19, B: 2.4, dimR: 6.7, dimDep: 1.8, chH: 13.6, chDep: 1.1, chB: 1.1, font: 'big', cap: 9, padR: 1.8, gap: 0.8, minA: '000', hop: 1, leaf: false },
};

// at 1 device px per unit (the 1x layer, normal size) the 'big' digits crowd the channel: use the 7 px face there
const SPEC1 = new Map();
function specOf(mini, D) {
  const S = mini ? WALLET_ART.MINI : WALLET_ART.FULL;
  if (D >= 2) return S;
  let v = SPEC1.get(S);
  if (!v) SPEC1.set(S, (v = { ...S, font: 'normal', cap: 7 }));
  return v;
}

const isDigit = (ch) => ch >= '0' && ch <= '9';
const advOf = (ch, font) => measureText(isDigit(ch) ? '0' : ch, font) + 1;
const textW = (s, font) => { let w = 0; for (const ch of s) w += advOf(ch, font); return Math.max(0, w - 1); };

function layoutOf(S, aw, gw) {
  const H = S.H, cy = H / 2;
  const dA = cy; // the droplet dimple is concentric with the left end cap
  const chAx = dA + S.dimR + S.gap, chAw = aw + 5 + S.padR;
  const grooveX = chAx + chAw + 1.7;
  const dG = grooveX + 1.7 + S.dimR;
  const chGx = dG + S.dimR + S.gap, chGw = gw + 5 + S.padR;
  const W = Math.ceil(chGx + chGw + S.B + 0.8);
  return { W, H, cy, dA, dG, chAx, chAw, chGx, chGw, grooveX, chY: cy + 0.4 - S.chH / 2 };
}

// ---------------------------------------------------------------- the glass slab
function slabHeight(S, L, u, v) {
  const d0 = sdRR(u, v, L.W / 2, L.H / 2, L.W / 2, L.H / 2, L.H / 2);
  if (d0 > 0) return 0;
  const k = clamp(-d0 / S.B, 0, 1), e = 1 - k;
  let h = S.B * Math.sqrt(1 - e * e);
  const R2 = S.dimR * S.dimR, dv2 = (v - L.cy) * (v - L.cy);
  let r2 = ((u - L.dA) * (u - L.dA) + dv2) / R2; // concave dimples (spherical cups)
  if (r2 < 1) h -= S.dimDep * Math.sqrt(1 - r2);
  r2 = ((u - L.dG) * (u - L.dG) + dv2) / R2;
  if (r2 < 1) h -= S.dimDep * Math.sqrt(1 - r2);
  const chc = L.chY + S.chH / 2, chr = S.chH / 2; // sunken number channels
  let dc = sdRR(u, v, L.chAx + L.chAw / 2, chc, L.chAw / 2, chr, chr);
  if (dc < 0) { const kc = clamp(-dc / S.chB, 0, 1), ec = 1 - kc; h -= S.chDep * Math.sqrt(1 - ec * ec); }
  dc = sdRR(u, v, L.chGx + L.chGw / 2, chc, L.chGw / 2, chr, chr);
  if (dc < 0) { const kc = clamp(-dc / S.chB, 0, 1), ec = 1 - kc; h -= S.chDep * Math.sqrt(1 - ec * ec); }
  const dg = sdRR(u, v, L.grooveX, L.cy, 0.75, L.H / 2 - S.B - 0.6, 0.75); // the groove between the halves
  if (dg < 0) { const kg = clamp(-dg / 0.75, 0, 1), eg = 1 - kg; h -= 1.1 * Math.sqrt(1 - eg * eg); }
  return h;
}
// puffy cloud silhouettes for the reflection in the gloss lens (unit coords relative to the lens)
const PUFFS = [0, 0, 1, 1.1, -0.35, 1.25, 2.3, 0.05, 0.95, -1.0, 0.25, 0.75];
function cloudAt(u, v, cx, cy, s) {
  for (let k = 0; k < PUFFS.length; k += 3) {
    const dx = u - cx - PUFFS[k] * s, dy = v - cy - PUFFS[k + 1] * s, r = PUFFS[k + 2] * s;
    if (dx * dx + dy * dy < r * r) return true;
  }
  return false;
}

function bakeSlab(S, aw, gw, D) {
  return cached(`slab|${S.H}|${aw}|${gw}|${D}`, () => {
    const L = layoutOf(S, aw, gw);
    const shU = 2, ol = D >= 4 ? 2 : 1, P = ol; // P: a device px border so the ink outline fits all round
    const w = Math.ceil(L.W * D) + P * 2, h = Math.ceil((L.H + shU) * D) + P;
    const { c, g, im } = newImg(w, h);
    const inside = new Uint8Array(w * h), glass = new Uint8Array(w * h);
    const sd = (u, v) => sdRR(u, v, L.W / 2, L.H / 2, L.W / 2, L.H / 2, L.H / 2);
    // the height field once per pixel centre (+1 px border), normals by central differences on it
    const gw2 = w + 2, hgt = new Float32Array(gw2 * (h + 2));
    for (let y = -1; y <= h; y++) for (let x = -1; x <= w; x++) hgt[(y + 1) * gw2 + x + 1] = slabHeight(S, L, (x - P + 0.5) / D, (y - P + 0.5) / D);
    const lens = { x: L.H * 0.42, y: S.B * 0.92, w: L.W - L.H * 0.84, h: L.H * 0.36 };
    const lamFlat = LIT[2];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x, u = (x - P + 0.5) / D, v = (y - P + 0.5) / D;
      const d0 = sd(u, v);
      if (d0 >= 0) continue;
      inside[i] = 1;
      const sec = u > L.grooveX ? 1 : 0, R = sec ? LILAC : AQUA;
      // normal from the height field
      const gi = (y + 1) * gw2 + x + 1;
      const hx = hgt[gi + 1] - hgt[gi - 1], hy = hgt[gi + gw2] - hgt[gi - gw2];
      let nx = (-hx * D) / 2, ny = (-hy * D) / 2, nz = 1;
      const nl = Math.sqrt(nx * nx + ny * ny + nz * nz); nx /= nl; ny /= nl; nz /= nl;
      const lam = nx * LIT[0] + ny * LIT[1] + nz * LIT[2];
      const vv = v / L.H, edge = clamp(-d0 / S.B, 0, 1);
      // body: darker under the top, glowing toward the bottom (light gathered in the glass)
      let T = 2.75 + 2.1 * sstep(0.5, 1.0, vv) - 0.35 * sstep(0.15, 0.45, vv);
      T += (lam - lamFlat) * 3.4;
      if (ny > 0.2 && edge < 1) T += 1.5 * ny; // bottom bevel glow
      const inCh = sdRR(u, v, L.chAx + L.chAw / 2, L.chY + S.chH / 2, L.chAw / 2, S.chH / 2, S.chH / 2) < 0
        || sdRR(u, v, L.chGx + L.chGw / 2, L.chY + S.chH / 2, L.chGw / 2, S.chH / 2, S.chH / 2) < 0;
      if (inCh) T -= 1.35;
      const inDim = ((u - L.dA) ** 2 + (v - L.cy) ** 2 < S.dimR ** 2) || ((u - L.dG) ** 2 + (v - L.cy) ** 2 < S.dimR ** 2);
      if (inDim) T += 0.3 + 0.35 * sstep(0.5, 0.9, vv);
      // Fresnel rim: the outermost glass ring, bright on the side away from the light
      const outer = -d0 < 1 / D + 0.02;
      if (-d0 < 1.1 / D + 0.35 && (nx + ny) > 0.15) T += 1.4;
      let idx = clamp(Math.floor(T), 0, 6);
      if (outer && nx + ny < -0.2) idx = 6; // a crisp light glass edge just inside the ink on the lit side
      if (ny < -0.3 && edge < 0.95) idx = clamp(idx, 3, 4); // the top bevel stays saturated (the gloss lens sits under it)
      const spec = nx * HV[0] + ny * HV[1] + nz * HV[2];
      if (spec > 0.975) idx = 7; else if (spec > 0.94 && idx < 6) idx = 6;
      let col = R[idx];
      let a = 232;
      // gloss lens over the top with a sky-and-cloud reflection (two crisp bands)
      const dl = sdRR(u, v, lens.x + lens.w / 2, lens.y + lens.h / 2, lens.w / 2, lens.h / 2, lens.h / 2);
      if (dl < 0 && !inCh) {
        const lv = (v - lens.y) / lens.h;
        let k = lv < 0.34 ? 0.8 : lv < 0.68 ? 0.52 : 0.28;
        if (cloudAt(u, v, lens.x + 6, lens.y + lens.h * 0.62, S.H * 0.09) || cloudAt(u, v, lens.x + lens.w * 0.62, lens.y + lens.h * 0.7, S.H * 0.075)) k += 0.2;
        if (inDim) k *= 0.55;
        col = blend(col, WHITE, k); a = 244;
      } else if (dl < 0 && inCh) {
        col = blend(col, WHITE, (v - lens.y) / lens.h < 0.42 ? 0.2 : 0.1);
      }
      put(im, i, col, a);
      glass[i] = 1;
    }
    // ink outline (1 device px, 2 on big renders) + banded drop shadow
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (inside[i]) continue;
      const u = (x - P + 0.5) / D, v = (y - P + 0.5) / D;
      if (ringOf(inside, w, h, i, ol)) { put(im, i, u > L.grooveX ? INK.g : INK.a, 255); continue; }
      if (sd(u - 0.3, v - 1.1) < 0) put(im, i, [4, 30, 60], 92);
      else if (sd(u - 0.5, v - 1.9) < 0) put(im, i, [4, 30, 60], 44);
    }
    // a few baked micro bubbles in the glass (lower half, clear of the channels)
    const bub = [[L.dA + S.dimR * 0.95, L.H - S.B - 1.2], [L.chAx + L.chAw * 0.55, L.H - S.B - 0.4], [L.dG - S.dimR * 0.9, L.H - S.B - 1.0]];
    for (const [bu, bv] of bub) {
      const x = Math.round(bu * D) + P, y = Math.round(bv * D) + P;
      if (y < h && x < w && glass[y * w + x]) { put(im, y * w + x, [214, 250, 255], 255); if (D >= 3 && glass[y * w + x + 1]) put(im, y * w + x + 1, [150, 226, 250], 255); }
    }
    g.putImageData(im, 0, 0);
    c.L = L; c.glass = glass; c.D = D; c.P = P;
    return c;
  });
}

// white silhouette of the glass (for the gloss sweep / hover lift)
function slabMask(slab) {
  if (slab.mask) return slab.mask;
  const w = slab.width, h = slab.height;
  const { c, g, im } = newImg(w, h);
  for (let i = 0; i < w * h; i++) if (slab.glass[i]) put(im, i, WHITE, 255);
  g.putImageData(im, 0, 0);
  return (slab.mask = c);
}

// sparse caustic overlays (bright wavy lines in the lower glass), 8 phases
function causticFrame(slab, f) {
  const fr = (slab.cau ||= []);
  return fr[f] || (fr[f] = (() => {
    const w = slab.width, h = slab.height, D = slab.D, L = slab.L;
    const { c, g, im } = newImg(w, h);
    const ph = (f / 8) * Math.PI * 2;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!slab.glass[i]) continue;
      const u = (x - slab.P + 0.5) / D, v = (y - slab.P + 0.5) / D, vv = v / L.H;
      if (vv < 0.55 || vv > 0.9) continue;
      const a = Math.sin(u * 0.55 + Math.sin(v * 0.9 + ph) * 1.4 + ph) + Math.sin(u * 0.31 - v * 0.7 - ph * 0.5 + 1.3);
      if (Math.abs(a) < 0.16 + 0.05 * (vv - 0.55) * 4) put(im, i, [190, 246, 255], 120);
    }
    g.putImageData(im, 0, 0);
    return c;
  })());
}

// ---------------------------------------------------------------- the leaf accent (glossy 3D, behind the left end)
function bakeLeaf(D, len, wid, angDeg) {
  return cached(`leaf|${D}|${len}|${wid}|${angDeg}`, () => {
    const a = (angDeg * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a);
    const ext = len + 2;
    const w = Math.ceil(ext * 2 * D), h = w;
    const { c, g, im } = newImg(w, h);
    const inside = new Uint8Array(w * h);
    const o = ext; // the stem base sits at the canvas centre
    const hgt = (s, t) => { // s along the leaf (0 base .. len tip), t across
      if (s < 0 || s > len) return -1;
      const hw = wid * Math.pow(Math.sin((Math.PI * s) / len), 0.75) * (s < len * 0.5 ? 1 : 1 - 0.15 * (s / len - 0.5));
      const q = Math.abs(t) / Math.max(1e-3, hw);
      if (q >= 1) return -1;
      return Math.sqrt(1 - q * q) * wid * 0.55 - 0.45 * Math.max(0, 1 - Math.abs(t) / 0.5); // dome with a midrib crease
    };
    const e = 0.5 / D;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const u = (x + 0.5) / D - o, v = (y + 0.5) / D - o;
      const s = u * ca + v * sa, t = -u * sa + v * ca;
      const h0 = hgt(s, t);
      if (h0 < 0) continue;
      const i = y * w + x;
      inside[i] = 1;
      const H = (uu, vv2) => { const ss = uu * ca + vv2 * sa, tt = -uu * sa + vv2 * ca, r = hgt(ss, tt); return r < 0 ? 0 : r; };
      let nx = -(H(u + e, v) - H(u - e, v)) / (2 * e), ny = -(H(u, v + e) - H(u, v - e)) / (2 * e), nz = 1;
      const nl = Math.sqrt(nx * nx + ny * ny + nz * nz); nx /= nl; ny /= nl; nz /= nl;
      const lam = nx * LIT[0] + ny * LIT[1] + nz * LIT[2];
      let T = 3.1 + (lam - LIT[2]) * 3.6 + (s / len) * 0.5;
      if (Math.abs(t) < 0.45 && s > 0.8 && s < len - 1) T = Math.max(T, 4.6); // pale midrib
      let idx = clamp(Math.floor(T), 0, 6);
      const sp = nx * HV[0] + ny * HV[1] + nz * HV[2];
      if (sp > 0.97) idx = 7; else if (sp > 0.93 && idx < 6) idx = 6;
      put(im, i, LEAF[idx], 255);
    }
    const ol = D >= 4 ? 2 : 1;
    for (let i = 0; i < w * h; i++) if (!inside[i] && ringOf(inside, w, h, i, ol)) put(im, i, INK.leaf, 255);
    g.putImageData(im, 0, 0);
    c.ox = o * D; c.oy = o * D;
    return c;
  });
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

// a hollow glossy bubble (rising in the glass)
function bakeBubble(D, ru) {
  return cached(`bub|${D}|${ru}`, () => {
    const r = Math.max(1.5, ru * D), n = Math.ceil(r * 2 + 1);
    const { c, g, im } = newImg(n, n);
    const cx = n / 2;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const dx = (x + 0.5 - cx) / r, dy = (y + 0.5 - cx) / r, q = Math.sqrt(dx * dx + dy * dy);
      if (q >= 1) continue;
      const i = y * n + x;
      if (q > 1 - 1.2 / r) put(im, i, dx + dy < 0 ? [236, 252, 255] : [120, 214, 246], 230);
      else if (dx < -0.15 && dy < -0.15 && q < 0.62 && q > 0.25) put(im, i, WHITE, 255);
      else put(im, i, [170, 236, 255], 60);
    }
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

// ---------------------------------------------------------------- digits (glossy Aero pixel digits)
function bakeGlyph(ch, font, D, tone, flash) {
  return cached(`dig|${ch}|${font}|${D}|${tone}|${flash ? 1 : 0}`, () => {
    const cap = font === 'big' ? 9 : 7;
    const gw = Math.max(1, measureText(ch, font)), m = makeCanvas(gw, cap);
    drawText(m.getContext('2d'), ch, 0, 0, { font, color: '#ffffff' });
    const md = m.getContext('2d').getImageData(0, 0, gw, cap).data;
    const rim = D >= 5 ? 2 : D >= 2 ? 1 : 0, ink = 1, sh = Math.max(1, Math.round(D * 0.75));
    const M = rim + ink;
    const w = gw * D + M * 2, h = cap * D + M * 2 + sh;
    const { c, g, im } = newImg(w, h);
    const solid = new Uint8Array(w * h);
    for (let y = 0; y < cap * D; y++) for (let x = 0; x < gw * D; x++) if (md[(((y / D) | 0) * gw + ((x / D) | 0)) * 4 + 3] > 128) solid[(y + M) * w + x + M] = 1;
    const near = (i, r) => ringOf(solid, w, h, i, r);
    const rimC = flash ? hexRGB('#c6ff6a') : RIM[tone], inkC = INK[tone];
    const loC = hexRGB(tone === 'g' ? '#e6e4ff' : '#cdf6ff');
    for (let y = h - 1; y >= 0; y--) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (solid[i]) { const t = (y - M) / (cap * D); put(im, i, flash ? (t < 0.5 ? WHITE : hexRGB('#fffbe0')) : (t < 0.52 ? WHITE : loC), 255); continue; }
      if (near(i, rim)) { put(im, i, rimC, 255); continue; }
      if (near(i, rim + ink)) { put(im, i, inkC, 255); continue; }
      const up = i - sh * w;
      if (up >= 0 && ringOf(solid, w, h, up, rim + ink)) put(im, i, [2, 20, 44], 150);
    }
    g.putImageData(im, 0, 0);
    c.M = M;
    return c;
  });
}

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
    const D = HI_ON.on ? 2 : 1, M = specOf(true, D), { aw, gw } = texts(ui, M);
    W.warm = [() => bakeSlab(M, aw, gw, D), () => bakeDrop(D, 14, 0), () => bakeGem(D, 12.5, 0, false), () => bakeGem(D, 12.5, 0, true)];
    for (const ch of '0123456789,') for (const tone of ['a', 'g']) W.warm.push(() => bakeGlyph(ch, M.font, D, tone, false));
  }
  if (W.warm?.length) { try { W.warm.shift()(); } catch { W.warm.length = 0; } }
}

const fmtShort = (n) => (n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 1 : 2) + 'M' : fmtAero(n));
function texts(ui, S) {
  const aTxt = fmtShort(Math.floor(ui.coinShown || 0)), gTxt = String(Math.floor(ui.gemShown || 0));
  const aw = Math.max(textW(aTxt, S.font), textW(S.minA, S.font)), gw = Math.max(textW(gTxt, S.font), textW('00', S.font));
  return { aTxt, gTxt, aw, gw };
}

// ---------------------------------------------------------------- drawing
let sweepC = null;
function star(ctx, x, y, arm, s, col, th = 1) { // a 4-point pixel twinkle: arm / thickness in device px, a violet shade
  if (arm < 1) return;
  const q = 1 / s, t = th * q, A = arm * q;
  ctx.fillStyle = 'rgba(60,20,140,0.55)';
  ctx.fillRect(x - t / 2 + q, y - t / 2 - A + q, t, A * 2 + t); ctx.fillRect(x - t / 2 - A + q, y - t / 2 + q, A * 2 + t, t);
  ctx.fillStyle = col;
  ctx.fillRect(x - t / 2, y - t / 2 - A, t, A * 2 + t); ctx.fillRect(x - t / 2 - A, y - t / 2, A * 2 + t, t);
  if (arm >= 3) { ctx.fillStyle = '#ffffff'; ctx.fillRect(x - t / 2 - q, y - t / 2 - q, t + 2 * q, t + 2 * q); }
}

export function drawWalletPlaque(ctx, ui, o = {}) {
  const p = o.p || 1, t = ui.time || 0;
  const s = isHi(ctx) || 1, D = Math.max(1, Math.round(p * s));
  const S = specOf(o.mini, D);
  const q = 1 / s; // one device px in logical units
  const sn = (v) => Math.round(v * s) / s;
  const rm = !!ui.game?.state?.settings?.reducedMotion;
  const fx = ui.walletFx || { sweep: -1, gemSpin: 0 };
  const { aTxt, gTxt, aw, gw } = texts(ui, S);
  const slab = bakeSlab(S, aw, gw, D), L = slab.L;
  const W = L.W * p, H = L.H * p;
  const x0 = sn(o.right - W), y0 = sn(o.y - (o.hov ? q * Math.max(1, D >> 1) : 0));
  const blit = (c, ux, uy, dx = 0, dy = 0) => { // c's (ox, oy) at unit point (ux, uy); dx, dy in device px
    ctx.drawImage(c, sn(x0 + ux * p - (c.ox || 0) * q) + dx * q, sn(y0 + uy * p - (c.oy || 0) * q) + dy * q, c.width * q, c.height * q);
  };
  const sm = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  // ---- the leaf behind the left end (HUD slab only)
  if (S.leaf) {
    const sway = rm ? 0 : Math.round(Math.sin(t * 1.4) * 0.6);
    blit(bakeLeaf(D, 10, 3.2, -158), L.H * 0.3, L.H * 0.16, 0, sway);
    blit(bakeLeaf(D, 8, 2.6, -118), L.H * 0.42, L.H * 0.12, 0, sway);
  }
  // ---- glass
  const sx0 = x0 - slab.P * q, sy0 = y0 - slab.P * q; // the slab canvas has a 1-2 device px border for its ink
  ctx.drawImage(slab, sx0, sy0, slab.width * q, slab.height * q);
  if (!rm) { // caustic shimmer: cross-fade two of 8 baked phases
    const ph = (t * 1.1) % 8, f0 = Math.floor(ph), k = ph - f0, a0 = ctx.globalAlpha;
    ctx.globalAlpha = a0 * (1 - k); ctx.drawImage(causticFrame(slab, f0), sx0, sy0, slab.width * q, slab.height * q);
    ctx.globalAlpha = a0 * k; ctx.drawImage(causticFrame(slab, (f0 + 1) % 8), sx0, sy0, slab.width * q, slab.height * q);
    ctx.globalAlpha = a0;
  } else ctx.drawImage(causticFrame(slab, 0), sx0, sy0, slab.width * q, slab.height * q);
  // ---- bubbles rising in the glass (behind the numbers)
  if (!rm) {
    const bub = bakeBubble(D, o.mini ? 1 : 1.3);
    for (const [bx, per, ph] of [[L.chAx + 2.2, 5.2, 0], [L.chGx + L.chGw - 3, 6.4, 2.7]]) {
      const k = ((t + ph) % per) / per;
      if (k > 0.8) continue;
      const kk = k / 0.8, by = L.H - S.B - 1 - kk * (L.H - S.B * 2 - 2);
      const a0 = ctx.globalAlpha;
      ctx.globalAlpha = a0 * (kk > 0.85 ? (1 - kk) / 0.15 : 1);
      ctx.drawImage(bub, sn(x0 + (bx + Math.sin(t * 3 + ph) * 0.5) * p - bub.width * q / 2), sn(y0 + by * p - bub.height * q / 2), bub.width * q, bub.height * q);
      ctx.globalAlpha = a0;
    }
  }
  // ---- gloss sweep (gain, and idly every ~7 s): a diagonal light band masked to the glass
  let sw = fx.sweep;
  if (sw < 0 && !rm) { const k = (t % 7.2) / 1.1; if (k < 1) sw = k; }
  if (sw >= 0 || o.hov) {
    const mask = slabMask(slab), w = slab.width, h = slab.height;
    if (!sweepC || sweepC.width < w || sweepC.height < h) sweepC = makeCanvas(Math.max(w, sweepC?.width || 0), Math.max(h, sweepC?.height || 0));
    const g = sweepC.getContext('2d');
    g.globalCompositeOperation = 'source-over';
    g.clearRect(0, 0, sweepC.width, sweepC.height);
    if (o.hov) { g.fillStyle = 'rgba(255,255,255,0.13)'; g.fillRect(0, 0, w, h); }
    if (sw >= 0) {
      const bw = Math.max(6, h * 0.35), xx = Math.round(-h - bw + sw * (w + h + bw * 2));
      g.fillStyle = 'rgba(255,255,255,0.42)';
      g.beginPath(); g.moveTo(xx + h, 0); g.lineTo(xx + h + bw, 0); g.lineTo(xx + bw, h); g.lineTo(xx, h); g.closePath(); g.fill();
      const b2 = Math.max(2, bw * 0.28), x2 = xx + bw + b2 * 1.5;
      g.fillStyle = 'rgba(255,255,255,0.3)';
      g.beginPath(); g.moveTo(x2 + h, 0); g.lineTo(x2 + h + b2, 0); g.lineTo(x2 + b2, h); g.lineTo(x2, h); g.closePath(); g.fill();
    }
    g.globalCompositeOperation = 'destination-in';
    g.drawImage(mask, 0, 0);
    ctx.drawImage(sweepC, 0, 0, w, h, sx0, sy0, w * q, h * q);
  }
  // ---- the droplet: wobbles (squash frames) on gain, a slow idle bob
  const dropH = o.mini ? 14 : 17.5;
  let lvl = 0;
  if (ui.coinBump > 0) { const u = 1 - ui.coinBump; lvl = Math.round(Math.sin(u * Math.PI * 3) * 3 * ui.coinBump); }
  const bob = rm ? 0 : Math.round(Math.sin(t * 1.6) * Math.max(1, D / 2));
  const dropC = bakeDrop(D, dropH, clamp(lvl, -3, 3));
  const dropY = L.cy - (o.mini ? 0.2 : 0.4);
  blit(dropC, L.dA, dropY, 0, bob - (ui.coinBump > 0 ? Math.round(Math.sin(ui.coinBump * Math.PI) * D) : 0));
  if (ui.coinBump > 0.02) { // glossy beads burst up out of the droplet and fall back
    const u = Math.min(1, (1 - ui.coinBump) * 1.5), sc = o.mini ? 0.6 : 1;
    const big = bakeBead(D, o.mini ? 0.9 : 1.2), sml = bakeBead(D, o.mini ? 0.6 : 0.8);
    for (const [vx, vy, b] of [[-5, 24, 1], [6, 26, 1], [-12, 19, 0], [13, 20, 0], [-17, 13, 0], [18, 14, 0], [1, 30, 0]]) {
      const ux = L.dA + vx * u * sc, uy = dropY - dropH * 0.3 - (vy * u - 34 * u * u) * sc;
      const c = b && u < 0.7 ? big : sml;
      if (u >= 1) break;
      const a0 = ctx.globalAlpha;
      if (u > 0.75) ctx.globalAlpha = a0 * (1 - u) * 4;
      ctx.drawImage(c, sn(x0 + ux * p - c.width * q / 2), sn(y0 + uy * p - c.height * q / 2), c.width * q, c.height * q);
      ctx.globalAlpha = a0;
    }
  }
  // ---- the gem: idle facet turn now and then, a fast spin + bright flash + twinkles on gain
  const gemW = o.mini ? 12.5 : 16.5;
  let spin = fx.gemSpin || 0;
  if (!rm) { const k = (t % 5.5) / 0.9; if (k < 1) spin += sstep(0, 1, k) * 2; }
  const gf = Math.floor(spin * GEM_FRAMES) % GEM_FRAMES;
  const gemC = bakeGem(D, gemW, (gf + GEM_FRAMES) % GEM_FRAMES, false);
  const hopG = ui.gemBump > 0 ? Math.round(Math.sin(ui.gemBump * Math.PI) * D) : 0;
  blit(gemC, L.dG, L.cy - 0.2, 0, -hopG);
  if (ui.gemBump > 0.05) {
    const a0 = ctx.globalAlpha;
    ctx.globalAlpha = a0 * Math.min(1, ui.gemBump * 1.4);
    blit(bakeGem(D, gemW, (gf + GEM_FRAMES) % GEM_FRAMES, true), L.dG, L.cy - 0.2, 0, -hopG);
    ctx.globalAlpha = a0;
    const u = 1 - ui.gemBump;
    star(ctx, sn(x0 + (L.dG + gemW * 0.45) * p), sn(y0 + (L.cy - gemW * 0.42) * p), Math.round(Math.sin(Math.min(1, u * 2) * Math.PI) * D * 1.8), s, '#ffffff', D >= 3 ? 2 : 1);
    star(ctx, sn(x0 + (L.dG - gemW * 0.5) * p), sn(y0 + (L.cy + gemW * 0.18) * p), Math.round(Math.sin(clamp(u * 2 - 0.4, 0, 1) * Math.PI) * D * 1.1), s, '#e8d4ff');
    star(ctx, sn(x0 + (L.dG + gemW * 0.15) * p), sn(y0 + (L.cy - gemW * 0.75 - u * 3) * p), Math.round(Math.sin(clamp(u * 2 - 0.2, 0, 1) * Math.PI) * D * 0.9), s, '#9ff8ff');
  } else if (!rm && (t % 3.3) < 0.22) {
    star(ctx, sn(x0 + (L.dG - gemW * 0.22) * p), sn(y0 + (L.cy - gemW * 0.3) * p), Math.max(1, D >> 1), s, '#ffffff');
  }
  // ---- numbers (right-aligned in their channels, fixed-width digit cells; each changed digit hops and flashes)
  const dy = L.chY + (S.chH - S.cap) / 2;
  const digits = (txt, chX, chW, tone, st, flash) => {
    let ax = chX + chW - S.padR - 1.5 - textW(txt, S.font);
    for (let i = 0; i < txt.length; i++) {
      const ch = txt[i], hp = st.hop[i] || 0;
      const lift = hp > 0 ? Math.round(Math.sin(hp * Math.PI) * S.hop * D) : 0;
      const inset = isDigit(ch) ? Math.floor((measureText('0', S.font) - measureText(ch, S.font)) / 2) : 0;
      const gc = bakeGlyph(ch, S.font, D, tone, flash && hp > 0.4);
      ctx.drawImage(gc, sn(x0 + (ax + inset) * p) - gc.M * q, sn(y0 + dy * p) - gc.M * q - lift * q, gc.width * q, gc.height * q);
      ax += advOf(ch, S.font);
    }
  };
  const id = o.id || 'hud';
  digits(aTxt, L.chAx, L.chAw, 'a', hopState(ui, id + 'a', aTxt), ui.coinBump > 0.2);
  digits(gTxt, L.chGx, L.chGw, 'g', hopState(ui, id + 'g', gTxt), ui.gemBump > 0.2);
  ctx.imageSmoothingEnabled = sm;
  const split = sn(x0 + L.grooveX * p);
  return {
    x: x0, y: y0, w: W, h: H, p,
    drop: { x: Math.round(x0 + L.dA * p), y: Math.round(y0 + L.cy * p) }, gem: { x: Math.round(x0 + L.dG * p), y: Math.round(y0 + L.cy * p) },
    a: { x: x0, y: y0, w: split - x0, h: H }, g: { x: split, y: y0, w: x0 + W - split, h: H },
  };
}

// logical size of a slab, for layout before drawing
export function walletSize(ui, o = {}) {
  const p = o.p || 1;
  const S = specOf(o.mini, Math.round(p * (HI_ON.on ? 2 : 1)));
  const { aw, gw } = texts(ui, S);
  const L = layoutOf(S, aw, gw);
  return { w: L.W * p, h: L.H * p };
}

export function walletTip(ui, onGem) {
  const st = ui.game?.state || {};
  return onGem
    ? `{bytegem} ${GEM_NAME}: ${gems(st)}\nEarned from quests, orders and milestones.\nSkip timers or buy cosmetics with them.`
    : `{abdrop} ${CURRENCY}: ${fmtAero(st.coins || 0)}\nWater-droplet money from fish and your tank.`;
}

// the compact glass wallet for window headers (replaces each window's own Aero / gem pills): right-aligned at
// `right`, top at y, 18 logical px tall at p = 1. While one is showing, the HUD wallet steps aside (no duplicate)
// and coin / gem flights land on this one. Returns its rect.
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

// logical px per wallet unit by UI size (whole device px on both layers)
export function walletP(mode) {
  if (HI_ON.on) return mode === 'huge' ? 2 : mode === 'normal' ? 1 : 1.5;
  return mode === 'huge' ? 3 : mode === 'normal' ? 1 : 2;
}

// dev / screenshot hook: the bakers (device px canvases)
export const WALLET_BAKE = { slab: (mini, aw, gw, D) => bakeSlab(mini ? WALLET_ART.MINI : WALLET_ART.FULL, aw, gw, D), drop: bakeDrop, gem: bakeGem, leaf: bakeLeaf, glyph: bakeGlyph, bead: bakeBead, bubble: bakeBubble };
