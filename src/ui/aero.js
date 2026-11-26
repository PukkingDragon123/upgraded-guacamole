// Frutiger Aero UI kit (phase 3). OWNER: UI agent (signatures below are the contract).
// Everyone draws Aero chrome through these helpers so the whole game shares one look.
// [pixui30] The look is 100% PIXEL ART now (user: "UI all is 100 percent pixel art, no round"): every surface has
// STEPPED corners (1-3 px notches, never arcs), a crisp 1 px dark outline, a 1 px light bevel top-left / shade
// bottom-right, flat colour bands with checker-dithered seams (no smooth gradients) and hard pixel shadows, in the
// Aero palette. Art is rasterised once at the logical resolution and cached (LRU); the `.hi` twin for the 2x UI layer
// is the same pixels scaled by nearest neighbour, so chrome pixels match the pixel fonts. 'pill' / radius options
// map to notches (notchOf). See the PIXEL KIT at the bottom.
// [bubble34] Round accents are back as PIXEL BUBBLES (the PIXEL BUBBLE KIT at the very bottom): orbs / knobs, badges,
// glows, glass plates, icon-only square buttons (close X, zoom, ...), toggles and slider thumbs are hand-stepped pixel
// circles / capsules with a dark outline, banded shading, a gloss arc, a glint and a faint iridescent rim.
//
//   AERO                         palette tokens (sky, aqua, grass, glass, ink, gloss ...)
//   AERO_TONES                   named surface tones ('aqua','green','orange','red','purple','glass','white','clear','sky','grass','dark','deep')
//   CURRENCY = 'Aero'            the one currency (state.coins holds the amount)
//   fmtAero(n) -> '1,250'        number formatting for Aero amounts
//   drawAeroPanel(ctx, x, y, w, h, {tone:'glass'|'sky'|'grass'|'dark'|'deep'|any tone, radius, title, glow, bubbles, sparkle})
//   drawAeroButton(ctx, x, y, w, h, {label, icon, state:'normal'|'hover'|'down'|'disabled', tone:'aqua'|'green'|'orange'|'glass'|..., font, align, radius})
//   drawAeroBar(ctx, x, y, w, h, k, {color, back, gloss, segments})   glossy progress bar, k in 0..1
//   drawAeroCoin(ctx, cx, cy, r, t)                           the Aero currency drop (glossy water drop; 3D from r >= 6)
//   drawGlossOrb(ctx, cx, cy, r, color, t)                    generic orb ([bubble34] a tinted round pixel bubble)
// Extras:
//   aeroSurface(w, h, o) -> cached canvas   the raw surface rasteriser (see SURFACE OPTIONS below)
//   drawAeroSurface(ctx, x, y, w, h, o)     blit of the above
//   drawSparkle(ctx, x, y, size, alpha, color)  4-point lens-flare star (size 1..4)
//   drawAeroBubble(ctx, cx, cy, r, alpha)   a clear soap/water bubble ring
//   drawAeroBadge(ctx, right, top, value, t)    red count badge ('!' = orange); [bubble34] a round pixel bubble
//   drawAeroLabel(ctx, text, x, y, {align, tone, font}) -> rect   small glass pill with text (hover labels)
//   drawAeroGlow(ctx, cx, cy, r, color, alpha)  soft round light (cached radial)
//   aeroText(ctx, text, x, y, o)            drawText with a soft Aero glow halo (o.glow color, default white)
//   drawAeroFrame(ctx, x, y, w, h, {title, icon (canvas), leaves=true, seed}) -> {content, close, header, plaque, finish(ctx)}
//                                           (call finish(ctx) after the content: lower leaves + splash go on top)
//                                           the shared panel window: glass body, big icon + title, red close orb
//   drawAeroCard(ctx, x, y, w, h, {tone='frost', inset})   frosted inner card
// Eco accents (reference look: 2000s eco wallpapers):
//   drawAeroLeaf(ctx, x, y, len, wid, angleDeg, {tone})   one hand-drawn pixel leaf (nearest drawn angle), base at (x, y)
//   drawLeafSprig(ctx, x, y, corner 'tl'|'tr'|'bl'|'br', scale=1 | 'L'|'S', px, {t, phase})  [wallet32] a hand-drawn
//                                               pixel twig of 4-5 leaves rooted at (x, y) (src/ui/pixleaves.js)
//   drawSunFlare(ctx, cx, cy, r, alpha=1)       soft pixel sun bloom with a star glint (no rays)
//   drawArcLines(ctx, cx, cy, r0, n, {gap, a0, a1, alpha, w, h})   thin white arcs (clipped to w x h from 0,0 of ctx)
//   drawSplash(ctx, x, y, w, {flip})            a curling water splash with droplets (base line at y)
//   ecoBackdrop(w, h, o) -> cached canvas      sky gradient + sun + white arcs + curved grass horizon + bubbles

import { rgba, shade, mix, pack, packRGB, hexToRgb } from '../core/color.js';
import { makeCanvas, ctxOf, tinted } from '../core/canvas.js';
import { PixelBuffer } from '../gfx/pixel.js';
import { drawText, measureText, FONTS, setTextBump, faceOf } from '../gfx/font.js';
import { hash1, bayer } from '../core/math.js';
import { pixelBubble as pxBubbleSprite, pixelCloud } from '../gfx/pxsprites.js';
import { alagardReady, alagardBitmap, loadAlagard } from '../gfx/alagard.js';
import { HI, withHi, hiArt, autoHi, fitHi, dualArt } from '../gfx/hires.js'; // [phase9:ui]
import { drawPixLeaf, drawLeafCluster } from './pixleaves.js'; // [wallet32] hand-drawn pixel leaves

export const CURRENCY = 'Aero Bucks';
export const AERO = {
  sky0: '#1e8fe0', sky1: '#59c3ff', sky2: '#bfeaff', aqua: '#2fd3e8', aquaDeep: '#0d8fb5', teal: '#1fb3a6',
  grass0: '#3fae2a', grass1: '#8be04a', lime: '#c8f56a', glass: 'rgba(235,250,255,0.55)', glassEdge: 'rgba(255,255,255,0.85)',
  ink: '#0c3a52', inkSoft: '#3c6f88', inkFaint: '#7aa6bc', white: '#ffffff', gloss: 'rgba(255,255,255,0.75)', orange: '#ff9d2e', red: '#ff4f5e',
  navy: '#0a3a6e', deep: '#062a52', edge: '#0b4f8f', frost: '#eef9ff', mint: '#7dffc8', sun: '#ffe27a',
};

export function fmtAero(n) { return Math.round(n || 0).toLocaleString('en-US'); }

// ---------------------------------------------------------------- UI scale (phase 6)
// Settings > UI size: 'normal' | 'big' (default) | 'huge' (state.settings.uiScale). The HUD multiplies its metrics
// by uiK(); shared widgets pick their face with uiFont() / fitFont() (a face is promoted one step while it still fits).
//   setUiScale(mode), uiScaleMode() -> mode, uiK() -> HUD size factor (vs. the phase 4 HUD)
//   uiFont(base='normal') -> 'small' | 'normal' | 'big'      the face to use for `base` text at this scale
//   fitFont(text, base, maxW, maxH) -> face                    promoted face if `text` fits maxW (and maxH), else base
//   capH(font) -> cap height px ('small' 5, 'normal' 7, 'big' 9)
export const UI_SCALES = { normal: 1.25, big: 1.6, huge: 2 };
let uiMode = 'big';
export function setUiScale(mode) { if (UI_SCALES[mode]) uiMode = mode; setTextBump(uiMode !== 'normal'); } // [phase8:ui] bigger small text
export function uiScaleMode() { return uiMode; }
export function uiK() { return UI_SCALES[uiMode]; }
const PROMOTE = { small: 'normal', normal: 'big' };
export function uiFont(base = 'normal') { return uiMode === 'normal' ? base : PROMOTE[base] || base; }
export function capH(font) { return FONTS[faceOf(font)]?.height || 7; }
export function fitFont(text, base = 'normal', maxW = Infinity, maxH = Infinity) {
  const up = uiFont(base);
  if (up === base || !text) return base;
  if (capH(up) > maxH) return base;
  return measureText(text, up) <= maxW ? up : base;
}

// ---------------------------------------------------------------- tones
// top/mid/bot: vertical gradient stops (mid at 52%), a: [alpha top, alpha bottom], edge: outer 1 px line,
// text/shadow: label colours, glow: colour of the reflected light at the bottom.
export const AERO_TONES = {
  aqua: { top: '#9eeaff', mid: '#38b8f2', bot: '#1678cc', edge: '#0b4a8a', text: '#ffffff', shadow: '#0a4680', glow: '#8ff6ff', a: [1, 1] },
  green: { top: '#dcffa4', mid: '#74d43c', bot: '#2c961c', edge: '#1a5e12', text: '#ffffff', shadow: '#1c5a0e', glow: '#eaffb4', a: [1, 1] },
  orange: { top: '#ffe6a8', mid: '#ffa83c', bot: '#e66c0c', edge: '#8e4206', text: '#ffffff', shadow: '#843a04', glow: '#fff2b8', a: [1, 1] },
  red: { top: '#ffc0bc', mid: '#f4504e', bot: '#c41c2c', edge: '#740a18', text: '#ffffff', shadow: '#6a0a16', glow: '#ffd0c8', a: [1, 1] },
  purple: { top: '#ecd4ff', mid: '#a674f4', bot: '#6438cc', edge: '#3a1a7a', text: '#ffffff', shadow: '#341670', glow: '#f0dcff', a: [1, 1] },
  glass: { top: '#ffffff', mid: '#eaf8ff', bot: '#c4e8fa', edge: '#3f8fc4', text: '#0c3a52', shadow: '#ffffff', glow: '#ffffff', a: [0.95, 0.9] },
  white: { top: '#ffffff', mid: '#f4fbff', bot: '#d8eef9', edge: '#5aa2cc', text: '#0c3a52', shadow: '#ffffff', glow: '#ffffff', a: [1, 1] },
  clear: { top: '#f0fcff', mid: '#9ee2f8', bot: '#4ab4e0', edge: '#ffffff', text: '#ffffff', shadow: '#0a4a7e', glow: '#c8f8ff', a: [0.62, 0.5], edgeA: 0.85 },
  sky: { top: '#b4ecff', mid: '#5cc0f4', bot: '#2a88d8', edge: '#0b4a8a', text: '#ffffff', shadow: '#0a3e74', glow: '#a8f2ff', a: [0.95, 0.97] },
  grass: { top: '#d8ffa0', mid: '#86da4a', bot: '#3aa224', edge: '#1d6312', text: '#ffffff', shadow: '#1c5a0e', glow: '#eaffb4', a: [0.96, 0.98] },
  dark: { top: '#3c94d8', mid: '#1a5ea8', bot: '#0b3670', edge: '#04214a', text: '#ffffff', shadow: '#03183a', glow: '#58c8ff', a: [0.95, 0.97] },
  deep: { top: '#2a6eb0', mid: '#123f7c', bot: '#082650', edge: '#031634', text: '#ffffff', shadow: '#020e24', glow: '#3ab0ff', a: [0.93, 0.96] },
  frost: { top: '#ffffff', mid: '#f2fbff', bot: '#dff3fc', edge: '#86c4e6', text: '#0c3a52', shadow: '#ffffff', glow: '#ffffff', a: [0.97, 0.96] },
  grey: { top: '#f0f4f8', mid: '#b8c6d4', bot: '#8496aa', edge: '#4a5a6e', text: '#f4f8fc', shadow: '#3a4a5c', glow: '#e4ecf4', a: [0.92, 0.92] },
};
const TONE_ALIAS = { sky: 'sky', grass: 'grass', glass: 'glass' };

export function toneOf(name) { return AERO_TONES[name] || AERO_TONES[TONE_ALIAS[name]] || AERO_TONES.aqua; }

// Build a tone from any base colour (for tabs / coloured chips).
const customTones = new Map();
export function toneFrom(hex) {
  let t = customTones.get(hex);
  if (!t) {
    t = { top: mix(hex, '#ffffff', 0.62), mid: shade(hex, 0.08), bot: shade(hex, -0.28), edge: shade(hex, -0.62), text: '#ffffff', shadow: shade(hex, -0.7), glow: mix(hex, '#ffffff', 0.7), a: [1, 1] };
    customTones.set(hex, t);
  }
  return t;
}

// ---------------------------------------------------------------- cache

const tex = new Map();
export function aeroCached(key, build, limit = 600) {
  let c = tex.get(key);
  if (c) { tex.delete(key); tex.set(key, c); return c; }
  c = build();
  tex.set(key, c);
  if (tex.size > limit) tex.delete(tex.keys().next().value);
  return c;
}

const rgbCache = new Map();
function rgbOf(hex) {
  let v = rgbCache.get(hex);
  if (!v) { v = hexToRgb(hex); rgbCache.set(hex, v); if (rgbCache.size > 4096) rgbCache.delete(rgbCache.keys().next().value); } // [perf27] bounded
  return v;
}

// ---------------------------------------------------------------- surface rasteriser
// SURFACE OPTIONS (o):
//   tone (name or object) | top, mid, bot, a:[a0,a1], edge, edgeA
//   r: corner size ('pill' = by height) -> a STEPPED pixel notch (see notchOf), shape: 'rect' | 'tab' (notched top only) |
//      'bottom' (notched bottom only)
//   gloss 0..1 (flat sheen band over the top), glossH (px), rim 0..1 (inner bevel: light top-left, shade bottom-right),
//   glow 0..1 (reflected light band along the bottom), streak (diagonal pixel reflections), inset (recessed: the bevel
//   flips and a shadow row falls under the top edge), bubbles (n tiny pixel twinkles), sparkle (pixel star top-left),
//   ring: n (frame only: a 2n px band, the hole is transparent), depth (rows of a darker lip along the bottom), seed
// [pixui30] Everything is PIXEL ART at the logical resolution: stepped corners (no arcs), a crisp 1 px dark outline,
// a 1 px light/dark bevel, flat colour bands with a checker-dithered row between them (no smooth gradients). The `.hi`
// twin for the 2x UI layer is the same art scaled up by nearest neighbour, so chrome pixels match the pixel fonts.
// (`curve`, `smooth`, `voxel` and `block` are accepted and ignored.)
export const NOTCHES = [[], [1], [2, 1], [3, 2, 1]];
// corner radius (logical px or 'pill') -> notch depth 0..3
export function notchOf(r, w, h) {
  let n;
  if (r === 'pill') n = h < 10 ? 1 : h < 24 ? 2 : 3;
  else { r = r ?? 6; n = r <= 0 ? 0 : r <= 2 ? 1 : r <= 9 ? 2 : 3; }
  while (n > 0 && (n * 2 + 1 > w || n * 2 + 1 > h)) n--;
  return n;
}
function nearestHi(c) {
  return withHi(c, () => {
    const hc = makeCanvas(c.width * HI, c.height * HI);
    const g = ctxOf(hc);
    g.imageSmoothingEnabled = false;
    g.drawImage(c, 0, 0, hc.width, hc.height);
    return hc;
  });
}
// a logical-res pixel canvas with the nearest-neighbour `.hi` twin (exported for callers that bake their own art)
export function pixelArt(c) { return nearestHi(c); }

function surfaceTex(w, h, o) { return nearestHi(pixelSurface(w, h, o)); }

const mixC = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
const WHITE = [255, 255, 255];
function pixelSurface(w, h, o) {
  const T = typeof o.tone === 'object' ? o.tone : o.tone ? toneOf(o.tone) : {};
  const top = rgbOf(o.top || T.top || '#ffffff'), mid = rgbOf(o.mid || T.mid || o.top || '#d8f0ff'), bot = rgbOf(o.bot || T.bot || '#8cc8ec');
  const A = o.a || T.a || [1, 1];
  let edge = rgbOf(o.edge || T.edge || '#0b4a8a'), edgeA = o.edgeA ?? T.edgeA ?? 1;
  // the outline is always DARK: a white / pale edge becomes a deep shade of the body colour
  if (!o.lightEdge && edge[0] * 0.3 + edge[1] * 0.59 + edge[2] * 0.11 > 170) { edge = mixC(bot, [4, 20, 50], 0.66); edgeA = Math.max(edgeA, 0.9); }
  const glowC = rgbOf(o.glowColor || T.glow || '#ffffff');
  const shape = o.shape || 'rect';
  const gloss = o.gloss ?? 0.6, rim = o.rim ?? 0.8, glow = o.glow ?? 0.5;
  const N = NOTCHES[notchOf(o.r, w, h)];
  const ringW = o.ring ? Math.min(Math.floor(Math.min(w, h) / 2) - 1, (o.ring | 0) * 2) : 0;
  const rowIns = (y) => {
    if (shape !== 'bottom' && y < N.length) return N[y];
    if (shape !== 'tab' && h - 1 - y < N.length) return N[h - 1 - y];
    return 0;
  };
  const M = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) { const k = rowIns(y); for (let x = k; x < w - k; x++) M[y * w + x] = 1; }
  if (ringW > 0) {
    const hx0 = ringW, hy0 = ringW, hx1 = w - ringW, hy1 = h - ringW;
    for (let y = hy0; y < hy1; y++) {
      const k = y === hy0 || y === hy1 - 1 ? 1 : 0;
      for (let x = hx0 + k; x < hx1 - k; x++) M[y * w + x] = 0;
    }
  }
  const inside = (x, y) => x >= 0 && y >= 0 && x < w && y < h && M[y * w + x] === 1;
  // 4-neighbour distance to the outside (1 = outline, 2 = bevel), capped at 4
  const D = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) D[i] = M[i] ? 9 : 0;
  for (let pass = 1; pass <= 4; pass++) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (D[i] !== 9) continue;
    const nb = (xx, yy) => (xx < 0 || yy < 0 || xx >= w || yy >= h ? 0 : D[yy * w + xx]);
    if (nb(x - 1, y) === pass - 1 || nb(x + 1, y) === pass - 1 || nb(x, y - 1) === pass - 1 || nb(x, y + 1) === pass - 1) D[i] = pass;
  }
  // vertical colour regions: sheen band (2 tones), body bands, glow band; a checker row dithers each seam
  const gH = gloss > 0 && !o.inset ? Math.max(2, Math.min(Math.round(h * 0.6), Math.round(o.glossH ?? Math.min(26, h * 0.42)))) : 0;
  const bodyH = h - gH;
  const nb = bodyH < 10 ? 1 : bodyH < 34 ? 2 : bodyH < 120 ? 3 : 4;
  const glowH = glow > 0 && h >= 8 ? Math.max(1, Math.round(Math.min(10, h * 0.16))) : 0;
  const dep = Math.max(0, Math.min(Math.floor(h / 4), o.depth | 0));
  const sideC = mixC(mid, edge, 0.55);
  // sheen: two flat tones between the light top colour and the body (kept dark enough for white labels)
  const gTop = mixC(mixC(top, mid, 0.18), WHITE, gloss * 0.22), gLow = mixC(mixC(top, mid, 0.55), WHITE, gloss * 0.08);
  const bandCol = (i) => {
    const t = gH ? (i + 0.5) / nb : (i + 0.5) / nb * 0.999;
    const s = gH ? 0.35 + t * 0.65 : t; // top -> mid -> bot position
    return s < 0.5 ? mixC(top, mid, s / 0.5) : mixC(mid, bot, (s - 0.5) / 0.5);
  };
  const BANDS = []; for (let i = 0; i < nb; i++) BANDS.push(bandCol(i));
  const seed = o.seed ?? (w * 7 + h * 13);
  const period = Math.max(60, Math.round(w * 0.9));
  const b = new PixelBuffer(w, h);
  const d = b.data;
  const put = (i, c, a) => { d[i] = ((Math.round(Math.max(0, Math.min(1, a)) * 255) & 255) << 24 | (Math.max(0, Math.min(255, Math.round(c[2]))) << 16) | (Math.max(0, Math.min(255, Math.round(c[1]))) << 8) | Math.max(0, Math.min(255, Math.round(c[0])))) >>> 0; };
  const colAt = (x, y) => {
    const chk = ((x + y) & 1) === 0;
    if (y < gH) {
      const half = gH >= 6 ? Math.ceil(gH / 2) : gH;
      if (y < half) return y === half - 1 && half < gH && chk ? gLow : gTop;
      return y === gH - 1 && chk ? BANDS[0] : gLow;
    }
    const by = y - gH;
    let i = Math.min(nb - 1, Math.floor((by / Math.max(1, bodyH)) * nb));
    // dither the first row of each band with the band above
    if (i > 0 && Math.floor(((by - 1) / Math.max(1, bodyH)) * nb) < i && chk) i--;
    let c = BANDS[i];
    if (glowH && y >= h - 1 - glowH - dep) {
      const first = y === h - 1 - glowH - dep;
      if (!first || chk) c = mixC(c, glowC, glow * 0.4);
    }
    return c;
  };
  for (let y = 0; y < h; y++) {
    const t = h > 1 ? y / (h - 1) : 0;
    const a0 = A[0] + (A[1] - A[0]) * (Math.round(t * 3) / 3);
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!M[i]) continue;
      const dd = D[i];
      if (dd === 1) { put(i, edge, Math.max(a0 * 0.6, edgeA)); continue; }
      let c, a = a0;
      if (dep && y >= h - 1 - dep) { c = y === h - 1 - dep ? mixC(sideC, edge, 0.35) : sideC; a = Math.max(a, 0.85); }
      else c = colAt(x, y);
      if (o.inset && dd <= 4) {
        if (!inside(x, y - (dd - 1)) || !inside(x, y - dd)) c = mixC(c, [4, 20, 40], dd === 2 ? 0.34 : dd === 3 ? 0.18 : 0.08);
        else if (dd === 2 && !inside(x - 2, y)) c = mixC(c, [4, 20, 40], 0.2);
        else if (dd === 2 && (!inside(x, y + 2) || !inside(x + 2, y))) c = mixC(c, WHITE, 0.35 * Math.max(0.4, rim));
      } else if (dd === 2 && rim > 0) {
        const up = !inside(x, y - 2), dn = !inside(x, y + 2), lf = !inside(x - 2, y), rt = !inside(x + 2, y);
        if (up || (lf && !dn)) c = mixC(c, WHITE, 0.25 + rim * 0.45);
        else if (dn || rt) c = mixC(c, edge, 0.12 + rim * 0.22);
      } else if (o.streak && dd >= 3 && y >= gH * 0.6) {
        const s = (x + y + seed * 3) % period;
        if (s >= 0 && s < 9) c = mixC(c, WHITE, 0.09); else if (s >= 14 && s < 16) c = mixC(c, WHITE, 0.07);
      }
      put(i, c, a);
    }
  }
  const nbub = o.bubbles | 0;
  for (let k = 0; k < nbub; k++) {
    const rr = 2 + Math.floor(hash1(k, seed) * 3);
    const bx = Math.round(w * (0.08 + 0.84 * hash1(k + 7, seed + 1))), by = Math.round(h * (0.55 + 0.38 * hash1(k + 3, seed + 2)));
    ringInto(b, D, w, h, bx, by, rr);
  }
  if (o.sparkle) sparkleInto(b, D, w, Math.round(Math.min(w * 0.12, 8)) + 3, 4, o.sparkle === true ? 2 : Math.min(2, o.sparkle));
  return b.toCanvas();
}
function blend(d, i, r, g, bl, sa) {
  const c = d[i], a = (c >>> 24) / 255;
  const na = sa + a * (1 - sa);
  if (na <= 0) return;
  const or = c & 255, og = (c >>> 8) & 255, ob = (c >>> 16) & 255;
  const nr = (r * sa + or * a * (1 - sa)) / na, ng = (g * sa + og * a * (1 - sa)) / na, nb = (bl * sa + ob * a * (1 - sa)) / na;
  d[i] = ((Math.round(na * 255) & 255) << 24 | (Math.round(nb) & 255) << 16 | (Math.round(ng) & 255) << 8 | (Math.round(nr) & 255)) >>> 0;
}

// [phase8:ui] decorative panel 'bubbles' are now tiny pixel twinkles (no ring outlines)
function ringInto(b, mask, w, h, cx, cy, r) {
  const L = Math.max(1, r - 1);
  const pts = [[0, 0, 0.9]];
  for (let i = 1; i <= L; i++) { const a = 0.75 * (1 - i / (L + 1)); pts.push([i, 0, a], [-i, 0, a], [0, i, a], [0, -i, a]); }
  for (const [dx, dy, a] of pts) {
    const x = cx + dx, y = cy + dy;
    if (x < 0 || y < 0 || x >= w || y >= h || mask[y * w + x] < 3) continue;
    blend(b.data, y * w + x, 255, 255, 255, a >= 0.5 ? 0.6 : 0.3);
  }
}

function sparkleInto(b, mask, w, cx, cy, s) {
  const pts = [[0, 0, 1]];
  for (let i = 1; i <= s + 1; i++) { const a = 1 - i / (s + 2); pts.push([i, 0, a], [-i, 0, a], [0, i, a * 0.8], [0, -i, a * 0.8]); }
  pts.push([1, 1, 0.35], [-1, -1, 0.35], [1, -1, 0.35], [-1, 1, 0.35]);
  for (const [dx, dy, a] of pts) {
    const x = cx + dx, y = cy + dy;
    if (x < 0 || y < 0 || x >= w || y >= b.h || mask[y * w + x] < 3) continue;
    blend(b.data, y * w + x, 255, 255, 255, a >= 0.6 ? 1 : a >= 0.3 ? 0.6 : 0.3);
  }
}

function surfKey(w, h, o) {
  const t = typeof o.tone === 'object' ? JSON.stringify(o.tone) : o.tone || '';
  return `s|${w}|${h}|${t}|${o.top || ''}|${o.mid || ''}|${o.bot || ''}|${o.a || ''}|${o.edge || ''}|${o.edgeA ?? ''}|${o.r ?? ''}|${o.shape || ''}|${o.gloss ?? ''}|${o.glossH ?? ''}|${o.curve ?? ''}|${o.rim ?? ''}|${o.glow ?? ''}|${o.glowColor || ''}|${o.streak ? 1 : 0}|${o.inset ? 1 : 0}|${o.bubbles | 0}|${o.sparkle || 0}|${o.seed ?? ''}|${o.ring | 0}|${o.depth | 0}|${o.lightEdge ? 1 : 0}`;
}

export function aeroSurface(w, h, o = {}) {
  w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
  return aeroCached(surfKey(w, h, o), () => surfaceTex(w, h, o));
}

export function drawAeroSurface(ctx, x, y, w, h, o = {}) {
  w = Math.round(w); h = Math.round(h);
  if (w < 2 || h < 2) return;
  ctx.drawImage(aeroSurface(w, h, o), Math.round(x), Math.round(y));
}

// ---------------------------------------------------------------- text with a soft glow halo

export function aeroText(ctx, text, x, y, o = {}) {
  const glow = o.glow || '#ffffff';
  const scale = o.scale || 1;
  let ax = x;
  if (o.align && o.align !== 'left') {
    const w = measureText(text, o.font || 'normal', scale);
    ax -= o.align === 'center' ? Math.floor(w / 2) : w;
  }
  const base = { ...o, align: 'left', shadow: null, outline: null };
  ctx.save();
  ctx.globalAlpha *= o.glowA ?? 0.35;
  for (const [dx, dy] of [[-2, 0], [2, 0], [0, -2], [0, 2], [-1, -1], [1, -1], [-1, 1], [1, 1]]) drawText(ctx, text, ax + dx * scale, y + dy * scale, { ...base, color: glow });
  ctx.restore();
  drawText(ctx, text, ax, y, { ...base, shadow: o.shadow ?? null, outline: o.outline ?? null, color: o.color || AERO.ink });
}


// ---------------------------------------------------------------- [phase8:ui] focus brackets
// drawPixelBrackets(ctx, x, y, w, h, t, {col, ink, k, gap}) four chunky pixel corner brackets that tick in and out
//   (the 'look here' / selected marker that replaces pulsing rings); drawFocusBrackets(ctx, cx, cy, r, t, o) centred.
export function drawPixelBrackets(ctx, x, y, w, h, t = 0, o = {}) {
  const k = Math.max(1, Math.round(o.k ?? 1));
  const col = o.col || '#ffffff', ink = o.ink || '#0a3e74';
  const off = (o.gap ?? 0) + ((Math.sin(t * 6) > 0 ? 1 : 0) + (o.bounce ? Math.round(Math.abs(Math.sin(t * 3)) * 2) : 0)) * k;
  x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h);
  const L = Math.max(4, Math.round(Math.min(w, h) * 0.22)) + 2 * k, T = 2 * k;
  const corners = [[x - off, y - off, 1, 1], [x + w + off, y - off, -1, 1], [x - off, y + h + off, 1, -1], [x + w + off, y + h + off, -1, -1]];
  for (const pass of [0, 1]) {
    ctx.fillStyle = pass ? col : ink;
    const e = pass ? 0 : 1;
    for (const [cx, cy, sx, sy] of corners) {
      const x0 = sx > 0 ? cx - e : cx - L - e, y0 = sy > 0 ? cy - e : cy - T - e;
      ctx.fillRect(x0, y0, L + e * 2, T + e * 2);
      const x1 = sx > 0 ? cx - e : cx - T - e, y1 = sy > 0 ? cy - e : cy - L - e;
      ctx.fillRect(x1, y1, T + e * 2, L + e * 2);
    }
  }
}
export function drawFocusBrackets(ctx, cx, cy, r, t = 0, o = {}) {
  drawPixelBrackets(ctx, cx - r, cy - r, r * 2, r * 2, t, { gap: 2, bounce: true, ...o });
  if (Math.sin(t * 4) > 0.3) drawSparkle(ctx, cx + r + 3, cy - r - 3, 2, 1);
}

// ---------------------------------------------------------------- [phase8:ui] Alagard titles
// drawTitle(ctx, text, x, y, {size = 16, scale = 2, color, outline, shadow, align}) -> {w, h}
//   crisp Alagard (16 px grid, drawn at an integer scale) with a chunky pixel outline and a drop shadow; y = cap top.
//   Falls back to the 'big' bitmap face until the font has loaded. titleSize(text, o) -> {w, h} measures it.
const trimCache = new Map();
function trimmed(text, size, color) {
  const key = size + '|' + color + '|' + text;
  let e = trimCache.get(key);
  if (e) return e;
  const src = alagardBitmap(text, { size, color });
  const g = ctxOf(src);
  const d = g.getImageData(0, 0, src.width, src.height).data;
  let y0 = src.height, y1 = -1, x1 = 0;
  for (let y = 0; y < src.height; y++) for (let x = 0; x < src.width; x++) if (d[(y * src.width + x) * 4 + 3]) { if (y < y0) y0 = y; if (y > y1) y1 = y; if (x > x1) x1 = x; }
  // cap top: first row of a capital/ascender; measure from a reference 'H' so every title sits on the same line
  const ref = alagardBitmap('H', { size, color });
  const rd = ctxOf(ref).getImageData(0, 0, ref.width, ref.height).data;
  let capTop = 0, capBot = 0;
  for (let y = 0; y < ref.height; y++) for (let x = 0; x < ref.width; x++) if (rd[(y * ref.width + x) * 4 + 3]) { if (!capTop) capTop = y || 1; capBot = y; }
  e = { canvas: src, top: capTop, cap: capBot - capTop + 1, w: x1 + 1, y1 };
  if (trimCache.size > 300) trimCache.clear();
  trimCache.set(key, e);
  return e;
}

export function titleSize(text, o = {}) {
  const size = o.size ?? 16, sc = o.scale ?? 2;
  if (!alagardReady()) { try { loadAlagard(); } catch { /* fallback */ } return { w: measureText(text, 'big', sc), h: 9 * sc }; }
  const t = trimmed(text, size, '#ffffff');
  return { w: (t.w + 1) * sc, h: t.cap * sc };
}

// [pixui30] the cached title composite is pixel art at the logical resolution (a square 8-way outline one font pixel
// wide, a hard drop, a flat highlight on the top third of the letters) with a nearest-neighbour `.hi` twin
function titleComposite(text, size, sc, color, outline, shadow, shadowA, gloss, glossColor) {
  return aeroCached(`ttl30|${text}|${size}|${sc}|${color}|${outline}|${shadow}|${shadowA}|${gloss}|${glossColor}`, () => {
    const t = trimmed(text, size, color);
    const bw = t.canvas.width * sc, bh = t.canvas.height * sc, pad = sc + 1;
    const c = makeCanvas(bw + pad * 2, bh + pad * 2 + sc * 2), g = ctxOf(c);
    const ox = pad, oy = pad;
    if (shadow) { g.globalAlpha = shadowA; g.drawImage(trimmed(text, size, shadow).canvas, ox, oy + sc * 2, bw, bh); g.globalAlpha = 1; }
    if (outline) {
      const oc = trimmed(text, size, outline).canvas;
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, 1], [1, 1], [-1, -1], [1, -1]]) g.drawImage(oc, ox + dx * sc, oy + dy * sc, bw, bh);
    }
    g.drawImage(t.canvas, ox, oy, bw, bh);
    if (gloss) {
      const hl = trimmed(text, size, glossColor).canvas, rows = Math.max(1, Math.round(t.cap * 0.3));
      g.drawImage(hl, 0, t.top, hl.width, rows, ox, oy + t.top * sc, bw, rows * sc);
    }
    nearestHi(c);
    c.pad = pad;
    return c;
  }, 300);
}

export function drawTitle(ctx, text, x, y, o = {}) {
  const size = o.size ?? 16, sc = o.scale ?? 2;
  const color = o.color || '#ffffff', outline = o.outline ?? '#0a3e74', shadow = o.shadow ?? '#041e46';
  if (!alagardReady()) {
    try { loadAlagard(); } catch { /* fallback */ }
    drawText(ctx, text, x, y, { font: 'big', scale: sc, color, shadow: outline, align: o.align });
    return { w: measureText(text, 'big', sc), h: 9 * sc };
  }
  const t = trimmed(text, size, color);
  const W = (t.w + 1) * sc;
  let ax = Math.round(x);
  if (o.align === 'center') ax -= Math.round(W / 2); else if (o.align === 'right') ax -= W;
  const dy = Math.round(y) - t.top * sc;
  const bw = t.canvas.width * sc, bh = t.canvas.height * sc;
  if (ctx.__hi && sc >= 1) {
    // full-res layer: one cached pixel composite (same art as the plain path, see titleComposite)
    const c = titleComposite(text, size, sc, color, outline, shadow, o.shadowA ?? 0.45, o.gloss !== false && sc >= 2, o.glossColor || '#e8fbff');
    ctx.drawImage(c, ax - c.pad, dy - c.pad);
    return { w: W, h: t.cap * sc };
  }
  if (shadow) { const ga = ctx.globalAlpha; ctx.globalAlpha = ga * (o.shadowA ?? 0.45); ctx.drawImage(trimmed(text, size, shadow).canvas, ax, dy + sc * 2, bw, bh); ctx.globalAlpha = ga; }
  if (outline) {
    const oc = trimmed(text, size, outline).canvas;
    for (const [ox, oy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, 1], [1, 1], [-1, -1], [1, -1]]) ctx.drawImage(oc, ax + ox * sc, dy + oy * sc, bw, bh);
  }
  ctx.drawImage(t.canvas, ax, dy, bw, bh);
  if (o.gloss !== false && sc >= 2) {
    // a 1-row highlight on the upper part of the letters (cheap: lighter copy clipped to the top third)
    const hl = trimmed(text, size, o.glossColor || '#e8fbff').canvas;
    const top = t.top, rows = Math.max(1, Math.round(t.cap * 0.3));
    ctx.drawImage(hl, 0, top, hl.width, rows, ax, dy + top * sc, bw, rows * sc);
  }
  return { w: W, h: t.cap * sc };
}

// ---------------------------------------------------------------- panel

const PANEL_TONE = { glass: 'frost', sky: 'sky', grass: 'grass', dark: 'dark', deep: 'deep' };

export function drawAeroPanel(ctx, x, y, w, h, o = {}) {
  const tone = PANEL_TONE[o.tone || 'glass'] || o.tone || 'frost';
  const r = o.radius ?? 8;
  if (o.glow) pixelHalo(ctx, x, y, w, h, notchOf(r, w, h), '#bff4ff', 0.5);
  drawAeroSurface(ctx, x, y, w, h, { tone, r, gloss: o.gloss ?? (h > 80 ? 0.42 : 0.6), glossH: o.glossH ?? Math.min(24, Math.round(h * 0.4)), rim: 0.85, glow: 0.45, streak: w > 120, bubbles: o.bubbles ?? (w * h > 30000 ? 4 : 0), sparkle: o.sparkle ?? (w > 60 && h > 40 ? 2 : 0), inset: o.inset });
  if (o.title) {
    const T = toneOf(tone);
    const light = T.text !== '#ffffff';
    drawText(ctx, o.title, Math.round(x + 10), Math.round(y + 7), { font: fitFont(o.title, 'normal', w - 20), color: light ? AERO.ink : '#ffffff', shadow: light ? 'rgba(255,255,255,0.9)' : T.shadow });
  }
}

// ---------------------------------------------------------------- button

function btnLook(tone, state) {
  const T = typeof tone === 'object' ? tone : toneOf(tone);
  if (state === 'disabled') return { ...toneOf('grey'), a: [0.8, 0.8] };
  if (state === 'hover') return { ...T, top: mix(T.top, '#ffffff', 0.35), mid: mix(T.mid, '#ffffff', 0.18), bot: mix(T.bot, T.mid, 0.35), glow: mix(T.glow, '#ffffff', 0.4) };
  if (state === 'down') return { ...T, top: shade(T.mid, -0.05), mid: shade(T.mid, -0.18), bot: shade(T.bot, -0.1), glow: T.glow };
  return T;
}

export function drawAeroButton(ctx, x, y, w, h, o = {}) {
  x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h);
  if (w < 4 || h < 4) return;
  const st = o.state || 'normal';
  const toneName = o.tone || 'aqua';
  const T = typeof toneName === 'object' ? toneName : toneOf(toneName);
  const look = btnLook(T, st);
  const r = o.radius ?? 'pill';
  const down = st === 'down';
  const n = notchOf(r, w, h);
  // [bubble34] an icon-only square button is a round pixel BUBBLE button (o.bubble forces it on / off)
  const bub = o.bubble ?? (!o.label && !!o.icon && Math.abs(w - h) <= 3 && Math.min(w, h) >= 11);
  let lift;
  if (bub) {
    const d = Math.min(w, h);
    lift = bubbleButtonBody(ctx, x + Math.floor((w - d) / 2), y + Math.floor((h - d) / 2), d, T, st);
  } else {
    // [pixui30] hover halo: a 1 px pale pixel ring hugging the stepped outline
    if (st === 'hover') {
      ctx.fillStyle = rgba(T.glow || '#bff4ff', 0.5);
      ctx.fillRect(x + n, y - 2, w - n * 2, 1);
      ctx.fillRect(x - 1, y + n - 1, 1, h - n * 2 + 1);
      ctx.fillRect(x + w, y + n - 1, 1, h - n * 2 + 1);
    }
    const key = `btn|${w}|${h}|${r}|${typeof toneName === 'object' ? JSON.stringify(toneName) : toneName}|${st}`;
    const c = aeroCached(key, () => surfaceTex(w, h, { tone: look, r, gloss: down ? 0.25 : 0.75, glossH: Math.max(2, Math.round(h * (down ? 0.3 : 0.42))), rim: down ? 0.35 : 0.9, glow: down ? 0.2 : 0.6, inset: false }));
    // [phase8:ui] chunky pixel press: a solid 2 px base under the button; hover lifts the body 1 px, down sinks it
    const base = aeroCached(key + '|base', () => tinted(c, st === 'disabled' ? '#6a7a8c' : shade(T.edge || '#0b4a8a', -0.1)));
    lift = st === 'hover' ? -1 : down ? 1 : 0;
    if (h >= 10) { const ga = ctx.globalAlpha; ctx.globalAlpha = ga * 0.85; ctx.drawImage(base, x, y + 2); ctx.globalAlpha = ga; }
    ctx.drawImage(c, x, y + lift);
  }
  y += lift;
  const ic = o.icon || null;
  const iw = ic ? ic.width + (o.label ? 4 : 0) : 0;
  let label = o.label || '';
  const pad = Math.max(6, Math.min(10, Math.floor(h / 2)));
  // [phase6:ui] bigger UI: promote the face one step when the label still fits the pill
  const font = o.fixedFont ? o.font || 'normal' : fitFont(label, o.font || 'normal', w - pad * 2 + 2 - iw, h - 8);
  let tw = label ? measureText(label, font) : 0;
  if (label && tw + iw > w - pad * 2 + 2) {
    while (label.length > 1 && measureText(label + '..', font) + iw > w - pad * 2 + 2) label = label.slice(0, -1);
    label = label.replace(/\s+$/, '') + '..';
    tw = measureText(label, font);
  }
  const ch = capH(font);
  const dy = 0;
  let cx = o.align === 'left' ? x + pad - 1 : x + Math.round((w - tw - iw) / 2);
  const dis = st === 'disabled';
  if (ic) {
    ctx.globalAlpha = dis ? 0.55 : 1;
    // [phase9:ui] 3D icons rock gently and spin while the button is hovered
    if (!(ic.__icon3d && icon3dDraw && !dis && icon3dDraw(ctx, ic.__icon3d, cx + ic.width / 2, y + h / 2 + dy, Math.max(ic.width, ic.height) + 2, { hover: st === 'hover' ? 1 : 0, phase: x * 0.013 })))
      ctx.drawImage(ic, cx, y + Math.round((h - ic.height) / 2) + dy);
    ctx.globalAlpha = 1;
    cx += iw;
  }
  if (label) {
    const col = dis ? '#eef2f6' : look.text || T.text;
    const sh = dis ? '#5a6a7c' : look.shadow || T.shadow;
    drawText(ctx, label, cx, y + Math.round((h - ch) / 2) + dy, { font, color: col, shadow: sh });
  }
}

// ---------------------------------------------------------------- bar

// [pixui30] pixel bar: a recessed track with 1 px notched corners and a flat fill (light top row, shade bottom row,
// a pixel glint row), square ends, tick marks for segments
export function drawAeroBar(ctx, x, y, w, h, k, o = {}) {
  x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.max(3, Math.round(h));
  k = Math.max(0, Math.min(1, k || 0));
  const color = o.color || AERO.aqua;
  ctx.drawImage(aeroCached(`bart30|${w}|${h}|${o.back || ''}`, () => surfaceTex(w, h, {
    top: o.back ? shade(o.back, -0.25) : '#0e3e64', mid: o.back ? shade(o.back, -0.1) : '#164c76', bot: o.back || '#1c5a86', a: [0.55, 0.5],
    edge: '#06243e', edgeA: 1, r: h >= 5 ? 1 : 0, gloss: 0, rim: 0.6, glow: 0, inset: true,
  })), x, y);
  const fw = Math.round((w - 2) * k);
  if (fw > 0) {
    const fill = aeroCached(`barf30|${w - 2}|${h - 2}|${color}|${o.gloss !== false}`, () => pixelArt(pixelFill(w - 2, h - 2, color, o.gloss !== false)));
    ctx.drawImage(fill, 0, 0, fw, h - 2, x + 1, y + 1, fw, h - 2);
    // a dark pixel cap on the leading edge
    if (fw < w - 2 && fw > 1) { ctx.fillStyle = shade(color, -0.45); ctx.fillRect(x + fw, y + 1, 1, h - 2); }
  }
  const seg = o.segments | 0;
  if (seg > 1 && seg < w / 3) {
    ctx.fillStyle = 'rgba(6,36,62,0.45)';
    for (let i = 1; i < seg; i++) ctx.fillRect(x + 1 + Math.round(((w - 2) * i) / seg), y + 1, 1, h - 2);
  }
}

// flat pixel fill for bars / chips: a light top row, the colour, a shade row; a broken glint row when tall enough
function pixelFill(w, h, color, gloss = true) {
  const c = makeCanvas(w, h), g = ctxOf(c);
  g.fillStyle = color; g.fillRect(0, 0, w, h);
  if (h >= 3) { g.fillStyle = mix(color, '#ffffff', 0.45); g.fillRect(0, 0, w, 1); g.fillStyle = shade(color, -0.22); g.fillRect(0, h - 1, w, 1); }
  if (h >= 5) { g.fillStyle = shade(color, -0.1); g.fillRect(0, h - 2, w, 1); }
  if (gloss && h >= 5) { g.fillStyle = mix(color, '#ffffff', 0.7); for (let xx = 2; xx < w - 2; xx += 9) g.fillRect(xx, 1, Math.min(4, w - 2 - xx), 1); }
  return c;
}

// ---------------------------------------------------------------- orbs, bubbles, coin

// [pixui30] the 'orb' is a STEPPED PIXEL OCTAGON knob (no circles): a dark outline, a light top-left bevel, three
// flat tone bands, a 2 px glint block top-left and a shade bevel bottom-right
function orbTex(r, color) {
  const S = Math.max(3, Math.round(r * 2));
  const n = S <= 4 ? 1 : S <= 8 ? 2 : Math.max(2, Math.floor(S * 0.24));
  const b = new PixelBuffer(S, S);
  const ins = (x, y) => { if (x < 0 || y < 0 || x >= S || y >= S) return false; const ex = Math.min(x, S - 1 - x), ey = Math.min(y, S - 1 - y); return ex + ey >= n; };
  const C = rgbOf(color), Lt = mixC(C, WHITE, 0.55), Dk = mixC(C, [10, 30, 60], 0.32), E = mixC(C, [6, 16, 40], 0.7);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    if (!ins(x, y)) continue;
    let c;
    if (!ins(x - 1, y) || !ins(x + 1, y) || !ins(x, y - 1) || !ins(x, y + 1)) c = E;
    else if (S >= 6 && (!ins(x, y - 2) || !ins(x - 2, y)) && x + y < S - 1) c = mixC(C, WHITE, 0.75);
    else if (S >= 6 && (!ins(x, y + 2) || !ins(x + 2, y)) && x + y > S - 1) c = Dk;
    else { const t = (x + y * 1.6) / (S * 2.6); c = t < 0.36 ? Lt : t < 0.66 ? C : mixC(C, Dk, 0.6); }
    b.set(x, y, packRGB(Math.round(c[0]), Math.round(c[1]), Math.round(c[2])));
  }
  if (S >= 7) { const gx = Math.max(2, Math.round(S * 0.28)), gy = Math.max(2, Math.round(S * 0.24)); b.set(gx, gy, packRGB(255, 255, 255)); b.set(gx + 1, gy, packRGB(255, 255, 255)); if (S >= 11) b.set(gx, gy + 1, packRGB(255, 255, 255)); }
  else if (S >= 4) b.set(1 + (n > 1 ? 1 : 0), 1 + (n > 1 ? 0 : 1) , packRGB(255, 255, 255));
  return b.toCanvas();
}

// the cached pixel orb canvas itself (for callers that bake it into their own art)
// [bubble34] orbs / knobs are round PIXEL BUBBLES now (pixelBubbleCanvas tinted with the colour); orbTex (the stepped
// octagon) is kept for reference only
export function pixelOrbCanvas(r, color = AERO.aqua) { const d = Math.max(3, Math.round(r * 2)); return pixelBubbleCanvas(d, d, { tint: color }); }

export function drawGlossOrb(ctx, cx, cy, r, color = AERO.aqua, t = 0) {
  const c = pixelOrbCanvas(r, color);
  ctx.drawImage(c, Math.round(cx - c.width / 2), Math.round(cy - c.height / 2));
  void t; void orbTex;
}

function bubbleTex(r) {
  const S = Math.ceil(r * 2) + 2, c = S / 2;
  const b = new PixelBuffer(S, S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = x + 0.5 - c, dy = y + 0.5 - c, d = Math.hypot(dx, dy);
    if (d > r) continue;
    const lit = (-dx - dy) / Math.max(0.01, d * 1.414);
    if (d > r - 1) b.set(x, y, pack(lit > -0.1 ? '#ffffff' : '#9fe8ff', lit > -0.1 ? 220 : 170));
    else if (d > r - 2 && lit < -0.3) b.set(x, y, pack('#c8f6ff', 120));
    else b.set(x, y, pack('#d8f8ff', 34));
  }
  const hx = Math.floor(c - r * 0.45), hy = Math.floor(c - r * 0.45);
  b.set(hx, hy, pack('#ffffff'));
  if (r >= 4) { b.set(hx + 1, hy, pack('#ffffff', 190)); b.set(hx, hy + 1, pack('#ffffff', 190)); }
  if (r >= 7) { b.set(hx + 2, hy, pack('#ffffff', 120)); b.set(hx, hy + 2, pack('#ffffff', 120)); }
  return b.toCanvas();
}

function hiBubble(r) { const c1 = pxBubbleSprite(r); return withHi(c1, () => fitHi(c1, pxBubbleSprite(r * HI))); }

export function drawAeroBubble(ctx, cx, cy, r, alpha = 1) {
  r = Math.max(1.5, Math.round(r * 2) / 2);
  const c = aeroCached(`pbub|${r}`, () => hiBubble(r)); // [phase8:ui] pixel bubble with a chunky highlight
  if (alpha < 1) { const ga = ctx.globalAlpha; ctx.globalAlpha = ga * alpha; ctx.drawImage(c, Math.round(cx - c.width / 2), Math.round(cy - c.height / 2)); ctx.globalAlpha = ga; }
  else ctx.drawImage(c, Math.round(cx - c.width / 2), Math.round(cy - c.height / 2));
}

// The Aero currency: a glossy aqua water drop (phase 6: a teardrop that matches the 3D drop on the HUD pill).
function coinTex(r) {
  const S = Math.ceil(r * 2) + 2, c = S / 2;
  const b = new PixelBuffer(S, S);
  const body = [rgbOf('#0a6fa8'), rgbOf('#17a6d8'), rgbOf('#3fd2ee'), rgbOf('#9cf2ff')];
  const R0 = r * 0.8, ccy = c + r * 0.18, tipY = c - r * 0.98;
  const inside = (x, y) => {
    const dx = x + 0.5 - c, py = y + 0.5;
    if (py >= ccy) return Math.hypot(dx, py - ccy) <= R0;
    const u = (ccy - py) / (ccy - tipY);
    return u < 1 && Math.abs(dx) <= R0 * Math.pow(1 - u, 1.25) * (1 + 0.25 * u);
  };
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    if (!inside(x, y)) continue;
    const edge = !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1);
    if (edge) { b.set(x, y, pack('#06406e')); continue; }
    const dx = x + 0.5 - c, dy = y + 0.5 - ccy;
    const lit = (-dx * 0.6 - dy * 0.8) / r;
    const bottom = Math.max(0, dy / R0) * Math.max(0, Math.hypot(dx, dy) / R0 - 0.35);
    let k = 1.4 + lit * 1.3 + bottom * 2.2;
    k = Math.max(0, Math.min(3, k));
    const i = Math.min(2, Math.floor(k)), f = k - i;
    const A = body[i], B = body[i + 1];
    b.set(x, y, packRGB(A[0] + (B[0] - A[0]) * f, A[1] + (B[1] - A[1]) * f, A[2] + (B[2] - A[2]) * f));
  }
  // highlight
  const hx = c - r * 0.28, hy = ccy - r * 0.32, hrx = r * 0.26, hry = r * 0.36;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const ex = (x + 0.5 - hx) / hrx, ey = (y + 0.5 - hy) / hry, e = ex * ex + ey * ey;
    if (e < 1 && inside(x, y) && inside(x - 1, y) && inside(x, y - 1)) blend(b.data, y * S + x, 255, 255, 255, 0.75 * (1 - e * 0.6));
  }
  const gx = Math.round(c - r * 0.3), gy = Math.round(ccy - r * 0.42);
  if (gx >= 0 && gy >= 0 && inside(gx, gy)) blend(b.data, gy * S + gx, 255, 255, 255, 1);
  return b.toCanvas();
}

// [phase6:ui] bigicons.js registers the glossy low-poly 3D drop here (no import cycle); drawAeroCoin uses it from r >= 6.
let coin3d = null;
export function setCoinRenderer(fn) { coin3d = fn; }
// [phase10:ui] voxel ornaments (rendered by src/gfx/bigicons.js decorFrame): leaves | shell | starfish | bubbles | pearl | coral
let decor3d = null;
export function setDecorRenderer(fn) { decor3d = fn; }
//   drawVoxDecor(ctx, name, cx, cy, px, {t, phase, sway, still}) -> bool   centred, gently swaying
export function drawVoxDecor(ctx, name, cx, cy, px, o = {}) {
  const t = o.t ?? performance.now() / 1000;
  // [wallet32] leaf ornaments are hand-drawn 2D pixel sprites now (src/ui/pixleaves.js), centred like the voxel ones
  if (name === 'leaves' || name === 'leaves_l') {
    drawLeafCluster(ctx, name === 'leaves_l' ? 'tl' : 'tr', cx, cy, { center: true, size: px >= 36 ? 'L' : 'S', scale: px >= 96 ? 2 : 1, t, phase: o.phase, still: o.still });
    return true;
  }
  if (!decor3d) return false;
  const turn = o.still ? 0 : Math.sin(t * 0.9 + (o.phase || 0)) * (o.sway ?? 0.18);
  let f = null;
  try { f = decor3d(name, Math.round(px), turn); } catch { f = null; }
  if (!f) return false;
  ctx.drawImage(f.canvas, Math.round((cx - f.ox) * 2) / 2, Math.round((cy - f.oy) * 2) / 2);
  return true;
}
// [phase9:ui] src/gfx/uiicons.js registers icons3d.drawIcon3D here (no import cycle): buttons rock / spin 3D icons
let icon3dDraw = null;
export function setIcon3DDrawer(fn) { icon3dDraw = fn; }

export function drawAeroCoin(ctx, cx, cy, r = 5, t = 0) {
  if (coin3d && r >= 2) { // [phase9:ui] the 3D drop at every size (the 2D drop is only the pre-WebGL fallback)
    let f = null;
    try { f = coin3d(Math.round(r * 2.3), t ? t * 0.12 + (cx * 0.013 + cy * 0.007) : 0); } catch { f = null; }
    if (f) {
      ctx.drawImage(f.canvas, Math.round(cx - f.ox), Math.round(cy - f.oy - r * 0.08));
      const ph = (t * 0.45 + (cx * 0.013 + cy * 0.007)) % 1;
      if (t && ph < 0.08) drawSparkle(ctx, Math.round(cx - r * 0.35), Math.round(cy - r * 0.45), ph < 0.04 ? 2 : 1, 1);
      return;
    }
  }
  r = Math.max(2.5, Math.round(r * 2) / 2);
  const c = aeroCached(`coin|${r}`, () => { const c1 = coinTex(r); return withHi(c1, () => fitHi(c1, coinTex(r * HI))); });
  const x = Math.round(cx - c.width / 2), y = Math.round(cy - c.height / 2);
  ctx.drawImage(c, x, y);
  // a lens-flare twinkle every few seconds
  const ph = (t * 0.45 + (cx * 0.013 + cy * 0.007)) % 1;
  if (t && ph < 0.08 && r >= 3.5) drawSparkle(ctx, x + Math.round(c.width * 0.28), y + Math.round(c.height * 0.25), ph < 0.04 ? 2 : 1, 1);
}

// ---------------------------------------------------------------- sparkles, glows, badges, labels

export function drawSparkle(ctx, x, y, size = 2, alpha = 1, color = '#ffffff') {
  x = Math.round(x); y = Math.round(y);
  const ga = ctx.globalAlpha;
  // [pixui30] one pixel size everywhere: the twinkle is drawn in logical pixels on the 2x layer too
  ctx.fillStyle = color;
  ctx.globalAlpha = ga * alpha;
  ctx.fillRect(x, y, 1, 1);
  for (let i = 1; i <= size; i++) {
    ctx.globalAlpha = ga * alpha * (1 - (i - 1) / (size + 1));
    ctx.fillRect(x + i, y, 1, 1); ctx.fillRect(x - i, y, 1, 1);
    if (i < size || size === 1) { ctx.fillRect(x, y + i, 1, 1); ctx.fillRect(x, y - i, 1, 1); }
  }
  if (size >= 2) {
    ctx.globalAlpha = ga * alpha * 0.35;
    ctx.fillRect(x + 1, y + 1, 1, 1); ctx.fillRect(x - 1, y - 1, 1, 1); ctx.fillRect(x + 1, y - 1, 1, 1); ctx.fillRect(x - 1, y + 1, 1, 1);
  }
  ctx.globalAlpha = ga;
}

// [pixui30] pixel light: three flat-alpha bands ([bubble34] round pixel discs), ordered-dithered at each band edge
// (no smooth radial falloff)
function glowTex(r, color) {
  const S = Math.ceil(r * 2), c = makeCanvas(S, S), g = ctxOf(c);
  const k2 = 1 / Math.SQRT2;
  const AL = [0.55, 0.3, 0.13];
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = Math.abs(x + 0.5 - r), dy = Math.abs(y + 0.5 - r);
    const d = Math.hypot(dx, dy) / r; // [bubble34] round pixel bands (were stepped octagons)
    void k2;
    if (d >= 1) continue;
    const q = d * 3 + (bayer(x, y) - 0.5) * 0.35;
    const i = q < 1 ? 0 : q < 2 ? 1 : q < 3 ? 2 : -1;
    if (i < 0) continue;
    g.fillStyle = rgba(color, AL[i]);
    g.fillRect(x, y, 1, 1);
  }
  return c;
}

export function drawAeroGlow(ctx, cx, cy, r, color = '#bff6ff', alpha = 0.5) {
  r = Math.max(2, Math.round(r));
  const c = aeroCached(`glow34|${r}|${color}`, () => pixelArt(glowTex(r, color)));
  const ga = ctx.globalAlpha;
  ctx.globalAlpha = ga * Math.round(Math.min(1, alpha) * 8) / 8;
  ctx.drawImage(c, Math.round(cx - r), Math.round(cy - r));
  ctx.globalAlpha = ga;
}

// [bubble34] badges are round pixel bubbles now (pixelBubbleBadge); the stepped-square body below is unused
export function drawAeroBadge(ctx, right, top, value, t = 0) { return pixelBubbleBadge(ctx, right, top, value, t); }
export function drawAeroBadgeSquare(ctx, right, top, value, t = 0) {
  if (value === null || value === undefined || value === 0 || value === false) return null;
  const txt = value === '!' ? '!' : typeof value === 'number' && value > 99 ? '99+' : String(value);
  const font = uiMode === 'huge' ? 'big' : uiFont('small'); // [phase6:ui]
  const tw = measureText(txt, font), ch = capH(font);
  const h = ch + 6 + (font === 'big' ? 2 : 0), w = Math.max(h, tw + 8);
  const x = Math.round(right - w), y = Math.round(top + (Math.sin(t * 5) > 0.85 ? -1 : 0));
  const tone = value === '!' ? 'orange' : 'red';
  // [pixui30] a small stepped pixel square (1 px notch): dark outline, light bevel, flat red / orange
  ctx.drawImage(aeroCached(`badge30|${w}|${h}|${tone}`, () => surfaceTex(w, h, { tone, r: 2, gloss: 0.6, glossH: Math.round(h * 0.4), rim: 1, glow: 0.3, edge: tone === 'orange' ? '#6a2a00' : '#5a0614', edgeA: 1 })), x, y);
  drawText(ctx, txt, x + Math.round((w - tw) / 2), y + Math.round((h - ch) / 2), { font, color: '#ffffff', shadow: toneOf(tone).shadow });
  return { x, y, w, h };
}

export function drawAeroLabel(ctx, text, x, y, o = {}) {
  const font = o.fixedFont ? o.font || 'normal' : uiFont(o.font || 'normal'); // [phase6:ui]
  const tw = measureText(text, font);
  const h = capH(font) + 6 + (font === 'big' ? 2 : 0), w = tw + (font === 'big' ? 16 : 12);
  let lx = Math.round(o.align === 'center' ? x - w / 2 : o.align === 'right' ? x - w : x);
  const ly = Math.round(y);
  const tone = o.tone || 'glass';
  ctx.drawImage(aeroCached(`label|${w}|${h}|${tone}`, () => surfaceTex(w, h, { tone, r: 'pill', gloss: 0.6, glossH: Math.round(h * 0.45), curve: 1, rim: 0.8, glow: 0.4 })), lx, ly);
  const T = toneOf(tone);
  // [polish32] light text gets its dark shadow on every tone (the grey COMMON label was pale-on-pale)
  drawText(ctx, text, lx + Math.round((w - tw) / 2), ly + Math.round((h - capH(font)) / 2), { font, color: T.text, shadow: /^#[ef]/i.test(T.text || '') ? T.shadow : null });
  return { x: lx, y: ly, w, h };
}

// ---------------------------------------------------------------- shared panel frame & cards

// [pixui30] a hard pixel drop shadow offset (dx, dy) behind a w x h stepped shape (notch n = 0..3): the shape's own
// stepped silhouette shifted down-right, minus the shape itself (flat, no blur). o: {n, alpha, color}
export function pixelShadow(ctx, x, y, w, h, dx = 2, dy = 2, o = {}) {
  w = Math.round(w); h = Math.round(h);
  if (w < 3 || h < 3) return;
  const n = Math.max(0, Math.min(3, o.n ?? 3));
  const color = o.color || '#03183a';
  const c = aeroCached(`pshadow|${w}|${h}|${dx}|${dy}|${n}|${color}`, () => {
    const N = NOTCHES[n];
    const W = w + dx, H = h + dy, cv = makeCanvas(W, H), g = ctxOf(cv);
    const ins = (yy) => (yy < N.length ? N[yy] : h - 1 - yy < N.length ? N[h - 1 - yy] : 0);
    g.fillStyle = color;
    for (let yy = 0; yy < h; yy++) { const k = ins(yy); g.fillRect(dx + k, dy + yy, w - k * 2, 1); }
    g.globalCompositeOperation = 'destination-out';
    for (let yy = 0; yy < h; yy++) { const k = ins(yy); g.fillRect(k, yy, w - k * 2, 1); }
    return pixelArt(cv);
  });
  const ga = ctx.globalAlpha;
  ctx.globalAlpha = ga * (o.alpha ?? 0.32);
  ctx.drawImage(c, Math.round(x), Math.round(y));
  ctx.globalAlpha = ga;
}

export function drawAeroFrame(ctx, x, y, w, h, o = {}) {
  x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h);
  // [pixui30] hard pixel drop shadow (3 px, stepped like the frame corner)
  pixelShadow(ctx, x, y, w, h, 3, 3);
  // the body is a little eco wallpaper: banded sky, pixel clouds, a stepped grass horizon
  ctx.drawImage(ecoBackdrop(w, h, { seed: o.seed ?? 7, r: 10 }), x, y);
  // [pixui30] the window chrome is a PIXEL frame ring: an 8 px glass-blue band, dark outline inside and out, light
  // bevel top-left / shade bottom-right (raised), stepped 3 px corners, a darker lip along the bottom
  ctx.drawImage(aeroCached(`vframe30|${w}|${h}`, () => surfaceTex(w, h, { ring: 4, r: 10, top: '#ffffff', mid: '#d2f1ff', bot: '#86c8f0', edge: '#06336e', gloss: 0.3, glossH: 4, rim: 1, glow: 0.3, depth: 2, seed: w })), x, y);
  const k = w > 360 ? 1 : 0.8;
  const t = performance.now() / 1000;
  const deco = o.leaves !== false;
  let tx = x + 12;
  const tw = o.title ? Math.min(w - 120, (titleSize(o.title, { scale: 2 }).w || measureText(o.title, 'normal', 2)) + 22) : 0;
  const iw = o.icon ? o.icon.width + 4 : 0;
  let plaque = { x: x + 5, y: y + 3, w: 0, h: 0 };
  if (o.title || o.icon) {
    const pw = Math.round(iw + tw + 14), ph = 28;
    plaque = { x: x + 5, y: y + 3, w: pw, h: ph };
    ctx.drawImage(aeroCached(`vplaque30|${pw}|${ph}`, () => surfaceTex(pw, ph, { tone: 'aqua', r: 8, gloss: 0.75, glossH: 12, rim: 0.9, glow: 0.6, depth: 2 })), x + 5, y + 3);
  }
  if (o.icon) {
    const ic = o.icon;
    ctx.drawImage(ic, Math.round(x + 10), Math.round(y + 16 - ic.height / 2));
    tx = x + 12 + ic.width + 2;
  }
  if (o.title) {
    // [phase8:ui] Alagard title (16 px grid at 2x: 20 px caps) with a chunky outline; falls back to the bitmap face
    const fits = titleSize(o.title, { scale: 2 }).w <= w - (tx - x) - 70;
    if (fits) drawTitle(ctx, o.title, tx, y + 5, { scale: 2 });
    else drawText(ctx, o.title, tx, y + 8, { font: 'normal', scale: 2, color: '#ffffff', shadow: '#0a3e74' });
  }
  // [polish17] the leaves sit up and out past the corner so they never crowd the close orb
  // (skipped when the window reaches the top-right HUD corner: they would sit on the Aero counter)
  const SW = ctx.canvas ? ctx.canvas.width / (ctx.__hi || 1) : Infinity;
  const nearHud = y < 84 && x + w > SW - 220;
  // [wallet32] a hand-drawn pixel twig rooted on the corner, spilling up and out (clear of the close orb below it)
  if (deco && !nearHud) drawLeafCluster(ctx, 'tr', x + w - 3, y + 2, { size: k >= 1 ? 'L' : 'S', t, phase: x * 0.01 });
  const close = { x: x + w - 25, y: y + 6, w: 18, h: 18 };
  // finish(ctx): call after drawing the panel's content so the ornaments and the splash sit on top
  const finish = (c2 = ctx) => {
    if (!deco) return;
    // [polish17] corner ornaments only: no splash swoosh across the bottom edge, no bubble blob on the left edge
    const ok = drawVoxDecor(c2, 'shell', x + 16, y + h - 10, Math.round(34 * k), { t, phase: 1.3 });
    if (ok) {
      drawVoxDecor(c2, 'starfish', x + 42, y + h - 4, Math.round(26 * k), { t, phase: 2.1, sway: 0.25 });
      drawVoxDecor(c2, 'coral', x + w - 14, y + h - 18, Math.round(30 * k), { t, phase: 0.8 });
    } else drawLeafSprig(c2, x + 5, y + h - 6, 'bl', k);
  };
  return { content: { x: x + 8, y: y + 32, w: w - 16, h: h - 40 }, close, header: { x, y, w, h: 30 }, plaque, finish };
}

export function drawAeroCard(ctx, x, y, w, h, o = {}) {
  const tone = o.tone || 'frost';
  drawAeroSurface(ctx, x, y, w, h, { tone, a: tone === 'frost' ? [0.9, 0.84] : undefined, r: o.r ?? 7, gloss: o.gloss ?? 0.3, glossH: Math.min(18, Math.round(h * 0.3)), curve: 2, rim: 0.9, glow: 0.35, glowColor: '#bfeaff', inset: o.inset, bubbles: o.bubbles || 0, seed: o.seed });
}

// ---------------------------------------------------------------- eco accents

export function drawAeroLeaf(ctx, x, y, len, wid, angleDeg, o = {}) {
  // [wallet32] a hand-drawn pixel leaf at the nearest drawn angle (no rotated / stretched texture); `wid` and `flip`
  // are implied by the art
  drawPixLeaf(ctx, x, y, len, angleDeg, { tone: o.tone });
}
// [wallet32] a hand-drawn pixel twig (src/ui/pixleaves.js) rooted at (x, y), spilling towards `corner`.
// scale: a number (old API: >= 0.85 -> the big twig, >= 1.8 -> 2x) or a size 'L' | 'S' with an integer `px` scale;
// o: {t, phase, still} for the 3-frame sway. Returns the drawn rect.
export function drawLeafSprig(ctx, x, y, corner = 'tl', scale = 1, px = 1, o = {}) {
  const size = typeof scale === 'string' ? scale : scale >= 0.85 ? 'L' : 'S';
  const s = typeof scale === 'string' ? px : scale >= 1.8 ? 2 : 1;
  return drawLeafCluster(ctx, corner, x, y, { size, scale: s, t: o.t, phase: o.phase, still: o.still });
}

// [phase8:ui] pixel sun: a bayer-dithered bloom in three steps (rays removed in polish17)
function flareTex(r) {
  const S = r * 2, c = makeCanvas(S, S), g = ctxOf(c);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const d = Math.hypot(x + 0.5 - r, y + 0.5 - r) / r;
    if (d > 1) continue;
    const k = (1 - d) * (1 - d) + (bayer(x, y) - 0.5) * 0.16;
    if (k < 0.08) continue;
    g.fillStyle = k > 0.62 ? '#ffffff' : k > 0.36 ? 'rgba(255,253,236,0.8)' : k > 0.18 ? 'rgba(232,250,255,0.5)' : 'rgba(210,244,255,0.28)';
    g.fillRect(x, y, 1, 1);
  }
  // [polish17] no rays: just the soft dithered bloom (the user does not want light-ray fans anywhere)
  return c;
}

export function drawSunFlare(ctx, cx, cy, r = 24, alpha = 1) {
  r = Math.max(6, Math.round(r));
  const c = aeroCached(`flare|${r}`, () => { const c1 = flareTex(r); return withHi(c1, () => fitHi(c1, flareTex(r * HI))); });
  const ga = ctx.globalAlpha;
  ctx.globalAlpha = ga * alpha;
  ctx.drawImage(c, Math.round(cx - r), Math.round(cy - r));
  ctx.globalAlpha = ga;
  drawSparkle(ctx, cx, cy, Math.max(2, Math.round(r / 8)), alpha);
}

export function drawArcLines(ctx, cx, cy, r0, n = 5, o = {}) {
  const gap = o.gap ?? 6, a0 = o.a0 ?? -0.2, a1 = o.a1 ?? 1.4, alpha = o.alpha ?? 0.35;
  const W = o.w ?? Infinity, H = o.h ?? Infinity;
  ctx.fillStyle = '#ffffff';
  const ga = ctx.globalAlpha;
  for (let i = 0; i < n; i++) {
    const R = r0 + i * gap;
    ctx.globalAlpha = ga * alpha * (1 - i / (n + 1));
    let px = null, py = null;
    const step = 0.8 / R;
    for (let a = a0; a <= a1; a += step) {
      const x = Math.round(cx + Math.cos(a) * R), y = Math.round(cy + Math.sin(a) * R);
      if (x === px && y === py) continue;
      px = x; py = y;
      if (x >= 0 && y >= 0 && x < W && y < H) ctx.fillRect(x, y, 1, 1);
    }
  }
  ctx.globalAlpha = ga;
}

function splashTex(w, flip) {
  const h = Math.round(w * 0.5);
  const b = new PixelBuffer(w, h + 3);
  const put = (x, y, hex, a = 255) => { x = flip ? w - 1 - x : x; if (x >= 0 && y >= 0 && x < w && y < h + 3) b.set(x, y, pack(hex, a)); };
  // a curling wave crest: a thick aqua body thinning as it curls up, a white lip on top
  for (let x = 0; x < w; x++) {
    const k = x / (w - 1);
    if (k > 0.92) break;
    const top = Math.round(h + 1 - Math.sin(Math.min(1, k / 0.92) * Math.PI * 0.62) * h * 0.92 * (0.35 + 0.65 * k));
    const th = Math.max(2, Math.round((1 - k) * 9 + 2));
    for (let t = 0; t < th; t++) {
      const y = top + t;
      if (y > h + 2) break;
      const col = t === 0 ? '#ffffff' : t === 1 ? '#d8faff' : t < th * 0.5 ? '#7fdcfa' : '#2fa8e8';
      put(x, y, col, t === 0 ? 245 : 225);
    }
    if (k > 0.25 && hash1(x, 14) > 0.6) put(x, top + 2 + Math.floor(hash1(x, 15) * 3), '#ffffff', 200);
  }
  // spray droplets flung off the crest
  for (let i = 0; i < 12; i++) {
    const x = Math.round(w * (0.62 + hash1(i, 11) * 0.36)), y = Math.round(h * (0.02 + hash1(i, 12) * 0.55));
    put(x, y, '#ffffff', 235);
    if (i % 2 === 0) { put(x + 1, y, '#c8f6ff', 210); put(x, y + 1, '#5ccaf0', 210); put(x + 1, y + 1, '#2fa8e8', 160); }
  }
  for (let x = 0; x < w; x++) if (hash1(x, 13) > 0.3) put(x, h + 2, x % 3 ? '#e8fbff' : '#9fe6ff', 210);
  return b.toCanvas();
}

export function drawSplash(ctx, x, y, w = 48, o = {}) {
  w = Math.max(12, Math.round(w));
  const c = aeroCached(`splash|${w}|${o.flip ? 1 : 0}`, () => { const c1 = splashTex(w, !!o.flip); return withHi(c1, () => { const b = splashTex(w * HI, !!o.flip); return fitHi(c1, b, c1.width / 2, c1.height, b.width / 2, b.height); }); });
  ctx.drawImage(c, Math.round(x), Math.round(y - c.height));
}

// [pixui30] the window wallpaper as pixel art: a banded sky (flat bands, checker-dithered seams), a few pixel clouds,
// pixel twinkles and a stepped grass horizon in three flat tones (no sun bloom, no round bubbles)
function ecoTex(w, h, o) {
  const body = pixelSurface(w, h, { top: '#1470d8', mid: '#4cb4f8', bot: '#c8f0ff', edge: '#073c80', r: o.r ?? 10, gloss: 0.3, glossH: Math.min(20, Math.round(h * 0.14)), rim: 0.85, glow: 0.2, streak: true, seed: o.seed });
  const c = makeCanvas(w, h), g = ctxOf(c);
  g.drawImage(body, 0, 0);
  g.globalCompositeOperation = 'source-atop';
  if (h > 90 && w > 140) {
    const nC = Math.max(1, Math.round(w / 260));
    for (let i = 0; i < nC; i++) {
      const cw = Math.round(Math.min(90, w * 0.16) * (0.7 + hash1(i, o.seed + 41) * 0.5));
      const cl = pixelCloud(cw, i + (o.seed | 0));
      const cx = Math.round(w * (0.3 + 0.55 * ((i + 0.5) / nC)) + (hash1(i, o.seed + 42) - 0.5) * 60);
      g.globalAlpha = 0.5;
      g.drawImage(cl, cx - (cl.width >> 1), Math.round(10 + hash1(i, o.seed + 43) * 12));
      g.globalAlpha = 1;
    }
  }
  // stepped grass horizon: the crest rises in 2 px terraces toward the middle
  const base = h - 4, amp = Math.min(18, h * 0.06);
  for (let x = 0; x < w; x++) {
    const n = (x - w / 2) / (w / 2);
    const top = Math.round(base - 16 - Math.floor(((1 - n * n) * amp) / 2) * 2);
    g.fillStyle = '#e8ffb0'; g.fillRect(x, top, 1, 1);
    g.fillStyle = '#a8ec5a'; g.fillRect(x, top + 1, 1, 2);
    g.fillStyle = '#6cd23c'; g.fillRect(x, top + 3, 1, 5);
    g.fillStyle = '#4cb22c'; g.fillRect(x, top + 8, 1, 4);
    g.fillStyle = '#2a8a1c'; g.fillRect(x, top + 12, 1, h - top - 12);
    if (((x + 1) & 1) === 0) { g.fillStyle = '#6cd23c'; g.fillRect(x, top + 7, 1, 1); g.fillStyle = '#4cb22c'; g.fillRect(x, top + 11, 1, 1); }
    if (hash1(x, 21) > 0.82) { g.fillStyle = '#c8f878'; g.fillRect(x, top - 1, 1, 1); }
    if (hash1(x, 26) > 0.95) { g.fillStyle = hash1(x, 27) > 0.5 ? '#ffe27a' : '#ff9ed2'; g.fillRect(x, top - 2, 2, 2); g.fillStyle = '#ffffff'; g.fillRect(x, top - 3, 1, 1); }
  }
  // pixel twinkles drifting up the sides (little plus marks)
  g.fillStyle = 'rgba(255,255,255,0.6)';
  for (let i = 0; i < Math.round(w / 60); i++) {
    const bx = Math.round(hash1(i, o.seed + 31) < 0.5 ? 8 + hash1(i, 32) * 28 : w - 34 + hash1(i, 33) * 26);
    const by = Math.round(h * (0.25 + hash1(i, 34) * 0.55));
    g.fillRect(bx, by - 1, 1, 3); g.fillRect(bx - 1, by, 3, 1);
  }
  g.globalCompositeOperation = 'source-over';
  return nearestHi(c);
}

export function ecoBackdrop(w, h, o = {}) {
  w = Math.max(16, Math.round(w)); h = Math.max(16, Math.round(h));
  return aeroCached(`eco|${w}|${h}|${o.seed ?? 7}|${o.r ?? 10}`, () => ecoTex(w, h, { seed: o.seed ?? 7, r: o.r }));
}


// ================================================================ [pixui30] PIXEL KIT
// Reusable pixel-art chrome (all stepped corners, 1 px dark outline + light bevel, flat banded fills, hard shadows).
// Every helper snaps to integer logical pixels and caches its art; on the 2x UI layer the art is the same pixels
// scaled up by nearest neighbour, so it matches the pixel fonts. Tones: any AERO_TONES name or a tone object.
//   pixelPanel(ctx, x, y, w, h, {tone='frost', r=8, shadow=2, inset, gloss, glow, title, streak})   window / card body
//   pixelButton(ctx, x, y, w, h, {label, icon, tone='aqua', state, font, align, r='pill'})   = drawAeroButton
//   pixelBar(ctx, x, y, w, h, k, {color, back, segments})                                       = drawAeroBar
//   pixelBadge(ctx, right, top, value, t)                                                       = drawAeroBadge
//   pixelChip(ctx, x, y, w, h, {tone='glass', r='pill', inset}) -> {x, y, w, h}  small stepped pill / chip / plaque
//   pixelRectPath(ctx, x, y, w, h, r)    a STEPPED path (for fill / clip / stroke) replacing roundRect paths: r is a
//                                        radius (px or 'pill') mapped by notchOf; pass x + 0.5 / w - 1 for 1 px strokes
//   pixelRect(ctx, x, y, w, h, r, fill, {outline, hi, lo})   filled stepped rect, optional 1 px outline + bevel
//   pixelHalo(ctx, x, y, w, h, n, color, alpha)    a 1 px pixel ring just outside a stepped rect (hover / focus)
//   pixelShadow(ctx, x, y, w, h, dx, dy, {n, alpha, color})   hard drop shadow of a stepped rect
//   pixelGradient(ctx, x0, y0, x1, y1, stops, bands=4) -> CanvasGradient   a BANDED linear gradient (hard stops)
//   notchOf(r, w, h) -> 0..3, NOTCHES, pixelArt(canvas) -> canvas with a nearest `.hi` twin
export function pixelPanel(ctx, x, y, w, h, o = {}) {
  x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h);
  if (w < 4 || h < 4) return;
  const r = o.r ?? 8;
  if (o.shadow !== 0 && o.shadow !== false) pixelShadow(ctx, x, y, w, h, o.shadow ?? 2, o.shadow ?? 2, { n: notchOf(r, w, h) });
  drawAeroSurface(ctx, x, y, w, h, { tone: o.tone || 'frost', r, gloss: o.gloss ?? 0.35, glossH: o.glossH ?? Math.min(16, Math.round(h * 0.3)), rim: o.rim ?? 0.9, glow: o.glow ?? 0.3, inset: o.inset, streak: o.streak, a: o.a, edge: o.edge, depth: o.depth });
  if (o.title) {
    const T = toneOf(typeof o.tone === 'string' ? o.tone : 'frost');
    drawText(ctx, o.title, x + 8, y + 6, { font: fitFont(o.title, 'normal', w - 16), color: T.text, shadow: T.text === '#ffffff' ? T.shadow : null });
  }
}
export const pixelButton = (...a) => drawAeroButton(...a);
export const pixelBar = (...a) => drawAeroBar(...a);
export const pixelBadge = (...a) => drawAeroBadge(...a);
export function pixelChip(ctx, x, y, w, h, o = {}) {
  x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h);
  if (w >= 3 && h >= 3) drawAeroSurface(ctx, x, y, w, h, { tone: o.tone || 'glass', r: o.r ?? 'pill', gloss: o.gloss ?? 0.5, glossH: Math.round(h * 0.42), rim: 0.85, glow: 0.4, inset: o.inset, a: o.a, edge: o.edge });
  return { x, y, w, h };
}
export function pixelRectPath(ctx, x, y, w, h, r) {
  const n = notchOf(r, Math.round(w) + 1, Math.round(h) + 1);
  ctx.beginPath();
  if (!n) { ctx.rect(x, y, w, h); return; }
  const N = NOTCHES[n], P = [[x + N[0], y], [x + w - N[0], y]];
  for (let i = 0; i < n; i++) P.push([x + w - N[i], y + i + 1], [x + w - (i + 1 < n ? N[i + 1] : 0), y + i + 1]);
  P.push([x + w, y + h - n]);
  for (let i = n - 1; i >= 0; i--) P.push([x + w - N[i], y + h - i - 1], [x + w - N[i], y + h - i]);
  P.push([x + N[0], y + h]);
  for (let i = 0; i < n; i++) P.push([x + N[i], y + h - i - 1], [x + (i + 1 < n ? N[i + 1] : 0), y + h - i - 1]);
  P.push([x, y + n]);
  for (let i = n - 1; i >= 0; i--) P.push([x + N[i], y + i + 1], [x + N[i], y + i]);
  ctx.moveTo(P[0][0], P[0][1]);
  for (let i = 1; i < P.length; i++) ctx.lineTo(P[i][0], P[i][1]);
  ctx.closePath();
}
export function pixelRect(ctx, x, y, w, h, r, fill, o = {}) {
  x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h);
  if (w < 1 || h < 1) return;
  const n = notchOf(r, w, h), N = NOTCHES[n];
  const ins = (yy) => (yy < 0 || yy >= h ? 0 : yy < N.length ? N[yy] : h - 1 - yy < N.length ? N[h - 1 - yy] : 0);
  const rows = (col, b) => {
    ctx.fillStyle = col;
    for (let yy = b; yy < h - b; yy++) { const k = (b ? Math.max(ins(yy - 1), ins(yy), ins(yy + 1)) : ins(yy)) + b; if (w - k * 2 > 0) ctx.fillRect(x + k, y + yy, w - k * 2, 1); }
  };
  const b = o.outline ? 1 : 0;
  if (o.outline) rows(o.outline, 0);
  if (fill) rows(fill, b);
  const kAt = (yy) => (b ? Math.max(ins(yy - 1), ins(yy), ins(yy + 1)) : ins(yy)) + b;
  const side0 = n + b, sideH = h - (n + b) * 2;
  if (o.hi && h > 2 + b * 2) { ctx.fillStyle = o.hi; const k = kAt(b); ctx.fillRect(x + k, y + b, w - k * 2, 1); if (sideH > 0) ctx.fillRect(x + b, y + side0, 1, sideH); }
  if (o.lo && h > 2 + b * 2) { ctx.fillStyle = o.lo; const k = kAt(h - 1 - b); ctx.fillRect(x + k, y + h - 1 - b, w - k * 2, 1); if (sideH > 0) ctx.fillRect(x + w - 1 - b, y + side0, 1, sideH); }
}
export function pixelHalo(ctx, x, y, w, h, n = 2, color = '#ffffff', alpha = 0.6) {
  x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h);
  const ga = ctx.globalAlpha;
  ctx.globalAlpha = ga * alpha;
  ctx.fillStyle = color;
  ctx.fillRect(x + n, y - 1, w - n * 2, 1); ctx.fillRect(x + n, y + h, w - n * 2, 1);
  ctx.fillRect(x - 1, y + n, 1, h - n * 2); ctx.fillRect(x + w, y + n, 1, h - n * 2);
  ctx.globalAlpha = ga;
}
function parseCol(c) {
  if (c[0] === '#') { const v = rgbOf(c.length === 4 ? '#' + c[1] + c[1] + c[2] + c[2] + c[3] + c[3] : c.slice(0, 7)); return [v[0], v[1], v[2], 1]; }
  const m = c.match(/rgba?\(([^)]+)\)/);
  if (!m) return [255, 255, 255, 1];
  const p = m[1].split(',').map((q) => parseFloat(q));
  return [p[0], p[1], p[2], p[3] ?? 1];
}
export function pixelGradient(ctx, x0, y0, x1, y1, stops, bands = 4) {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  const P = stops.map(([t, c]) => [t, parseCol(c)]);
  const col = (t) => {
    let i = 0;
    while (i < P.length - 2 && t > P[i + 1][0]) i++;
    const [ta, ca] = P[i], [tb, cb] = P[Math.min(P.length - 1, i + 1)];
    const k = tb > ta ? Math.max(0, Math.min(1, (t - ta) / (tb - ta))) : 0;
    const v = ca.map((q, j) => q + (cb[j] - q) * k);
    return `rgba(${Math.round(v[0])},${Math.round(v[1])},${Math.round(v[2])},${Math.round(v[3] * 100) / 100})`;
  };
  for (let i = 0; i < bands; i++) {
    const c = col((i + 0.5) / bands);
    g.addColorStop(i / bands, c); g.addColorStop(Math.min(1, (i + 1) / bands), c);
  }
  return g;
}

// [pixui30] a translucent glass PLATE for items / bait shown 'in a bubble': a stepped octagon (no circle) with a
// tinted banded fill, a rim-coloured dark outline, a 1 px light bevel top-left and a pixel glint. Draw the item on top.
//   pixelGlassPlate(ctx, cx, cy, size, {tint, rim, alpha})
function glassOctTex(S, tint, rim) {
  const b = new PixelBuffer(S, S);
  const n = Math.max(2, Math.floor(S * 0.24));
  const ins = (x, y) => { if (x < 0 || y < 0 || x >= S || y >= S) return false; const ex = Math.min(x, S - 1 - x), ey = Math.min(y, S - 1 - y); return ex + ey >= n; };
  const T = rgbOf(tint), Rm = rgbOf(rim), E = mixC(Rm, [4, 20, 50], 0.45);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    if (!ins(x, y)) continue;
    let c, a;
    if (!ins(x - 1, y) || !ins(x + 1, y) || !ins(x, y - 1) || !ins(x, y + 1)) { c = E; a = 0.95; }
    else if ((!ins(x, y - 2) || !ins(x - 2, y)) && x + y < S) { c = WHITE; a = 0.9; }
    else if ((!ins(x, y + 2) || !ins(x + 2, y)) && x + y > S) { c = mixC(Rm, WHITE, 0.25); a = 0.75; }
    else { const t = y / S; c = t < 0.34 ? mixC(T, WHITE, 0.6) : t < 0.7 ? T : mixC(T, Rm, 0.35); a = t < 0.34 ? 0.62 : t < 0.7 ? 0.45 : 0.55; }
    b.set(x, y, ((Math.round(a * 255) << 24) | (Math.round(c[2]) << 16) | (Math.round(c[1]) << 8) | Math.round(c[0])) >>> 0);
  }
  const g0 = Math.max(n, Math.round(S * 0.26)), gy = Math.max(2, Math.round(S * 0.2));
  for (let i = 0; i < Math.max(2, Math.round(S * 0.12)); i++) b.set(g0 + i, gy, packRGB(255, 255, 255));
  b.set(g0 - 1, gy + 1, packRGB(255, 255, 255));
  return b.toCanvas();
}
// [bubble34] the plate is a round translucent PIXEL SOAP BUBBLE now (glassOctTex kept for reference)
export function pixelGlassPlate(ctx, cx, cy, size, o = {}) {
  const S = Math.max(6, Math.round(size));
  const tint = o.tint || '#e8fbff', rim = o.rim || '#2fb8e0';
  void glassOctTex;
  const c = pixelBubbleCanvas(S, S, { glass: true, tint: rim, fill: tint });
  const ga = ctx.globalAlpha;
  if (o.alpha != null) ctx.globalAlpha = ga * o.alpha;
  ctx.drawImage(c, Math.round(cx - S / 2), Math.round(cy - S / 2));
  ctx.globalAlpha = ga;
}

// ---------------------------------------------------------------- [bubble34] PIXEL BUBBLE KIT
// User direction: "have some round bubble UI but make it pixel art". ROUND soap-bubble accents drawn as crisp pixel art
// on the same logical grid as the [pixui30] chrome (the `.hi` twin is the same art scaled by nearest neighbour):
// hand-stepped pixel circles / capsules (exact masks, hand-tuned small diameters so they read round, not octagonal),
// no anti-aliasing, a 1 px dark outline, a 1 px rim band (light on the lit side, faint iridescent aqua / pink / lilac /
// lime pixel bands on the far side), 4-tone banded body (top-left key light + a reflected glow low in the bubble), a
// broken white gloss arc and a white glint cluster top-left. Big panels / windows stay square; bubbles are accents.
//   circleInsets(d) -> [inset per row]                    the pixel circle of diameter d (row insets from each side)
//   pixelBubbleCanvas(w, h, o) -> cached canvas (.hi)     a disc (w === h) or a capsule (w > h)
//   pixelBubble(ctx, cx, cy, r, o)                         a round bubble centred on (cx, cy), diameter round(2r)
//   pixelBubbleCapsule(ctx, x, y, w, h, o)                 a pill (end caps = the h-px pixel circle)
//      o: {tone (AERO_TONES name | tone object), tint (any hex -> toneFrom), glass (translucent soap bubble), fill
//          (glass body colour), iris (iridescent rim, default on from 9 px), gloss (default on), shadow (px of hard
//          drop shadow baked under it), alpha, tone2 + split (two-tone capsule: x >= split uses tone2, with a seam),
//          glossSpans ([[x0, x1]...] art-px runs of the gloss stroke along a capsule's straight top)}
//   pixelBubbleButton(ctx, cx, cy, r, {state, tone, icon, glyph: 'x' | '+' | '-', alpha}) -> {x, y, w, h, lift}
//      round bubble button: a solid base disc 2 px under it, hover lifts 1 px and lightens (+ a 1 px pale ring),
//      down squashes to a (d + 2) x (d - 2) capsule resting on the base (pixel steps, no scaling)
//   pixelBubbleBadge(ctx, right, top, value, t, {tone}) -> rect   round count badge (a capsule for 2+ chars); '!' = orange
//   pixelBubbleRing(ctx, cx, cy, r, color, alpha)          a static 1 px ring hugging a d-px bubble (hover halo)
//   pixelBubbleTag(ctx, x, y, text, {tone, font, align})   a small text tag ('NEW') in a bubble capsule -> rect
//   drawAeroButton(..., {bubble}) draws an icon-only square button (|w - h| <= 3) as a bubble button by default.
const CIRCLE_HALF = {
  1: [0], 2: [0], 3: [1, 0], 4: [1, 0], 5: [1, 0, 0], 6: [1, 0, 0], 7: [2, 1, 0, 0], 8: [2, 1, 0, 0],
  9: [3, 1, 1, 0, 0], 10: [3, 1, 1, 0, 0], 11: [3, 2, 1, 1, 0, 0], 12: [4, 2, 1, 1, 0, 0], 13: [4, 2, 1, 1, 0, 0, 0],
  14: [5, 3, 2, 1, 1, 0, 0], 15: [5, 3, 2, 1, 1, 0, 0, 0], 16: [5, 3, 2, 1, 1, 0, 0, 0], 17: [6, 4, 3, 2, 1, 1, 0, 0, 0],
};
const circleMemo = new Map();
export function circleInsets(d) {
  d = Math.max(1, Math.round(d));
  let v = circleMemo.get(d);
  if (v) return v;
  let half = CIRCLE_HALF[d];
  if (!half) {
    half = [];
    const R = d / 2;
    for (let y = 0; y < Math.ceil(d / 2); y++) { const dy = y + 0.5 - R; half.push(Math.max(0, Math.round(R - Math.sqrt(Math.max(0, R * R - dy * dy)) - 0.08))); }
  }
  v = [];
  for (let y = 0; y < d; y++) v.push(half[Math.min(y, d - 1 - y)]);
  circleMemo.set(d, v);
  return v;
}
// iridescent rim hues by angle (deg, screen space: -90 = up): aqua, pink, lilac, lime, aqua
const IRIS = [[-150, [150, 244, 255]], [-62, [255, 176, 232]], [8, [200, 178, 255]], [78, [206, 255, 132]], [150, [150, 244, 255]]];
function irisAt(a) { let c = IRIS[0][1]; for (const [a0, col] of IRIS) if (a >= a0) c = col; return a < -150 ? IRIS[4][1] : c; }
const BUB_LIGHT = (() => { const v = [-0.5, -0.62, 0.6], l = Math.hypot(...v); return v.map((q) => q / l); })();
function bubTone(o) {
  if (o.tone && typeof o.tone === 'object') return o.tone;
  if (o.tint) return toneFrom(o.tint);
  return toneOf(o.tone || (o.glass ? 'clear' : 'aqua'));
}
function bubKey(o) {
  const t = o.tone && typeof o.tone === 'object' ? `${o.tone.top}${o.tone.mid}${o.tone.bot}${o.tone.edge}${o.tone.glow || ''}` : o.tint || o.tone || '';
  const t2 = o.tone2 ? (typeof o.tone2 === 'object' ? `${o.tone2.top}${o.tone2.mid}${o.tone2.bot}${o.tone2.edge}` : o.tone2) + '@' + o.split : '';
  return `${t}|${o.glass ? 1 : 0}|${o.iris ?? ''}|${o.gloss ?? ''}|${o.shadow || 0}|${o.fill || ''}|${o.outline || ''}|${t2}|${o.glossSpans ? o.glossSpans.join(';') : ''}`;
}
// the raster: w >= h; a disc when w === h
function bubbleRaster(w, h, o) {
  const T = bubTone(o);
  const sh = o.shadow | 0;
  const b = new PixelBuffer(w, h + sh);
  const ins = circleInsets(h);
  const inside = (x, y) => y >= 0 && y < h && x >= ins[y] && x < w - ins[y];
  // 4-neighbour depth from the outside (1 = outline)
  const dep = new Uint8Array(w * h), q = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!inside(x, y)) continue;
    if (!inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1)) { dep[y * w + x] = 1; q.push(x, y); }
  }
  for (let i = 0; i < q.length; i += 2) {
    const x = q[i], y = q[i + 1], d = dep[y * w + x];
    for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
      if (!inside(nx, ny) || dep[ny * w + nx]) continue;
      dep[ny * w + nx] = d + 1; q.push(nx, ny);
    }
  }
  const glass = !!o.glass;
  const palOf = (TT, outline) => {
    const Lt = rgbOf(TT.top), Md = rgbOf(TT.mid), Sh = rgbOf(TT.bot), Ed = rgbOf(outline || TT.edge || '#0b4a8a'), Gl = rgbOf(TT.glow || '#ffffff');
    const lightEdge = Ed[0] * 0.3 + Ed[1] * 0.59 + Ed[2] * 0.11 > 150;
    const O = lightEdge ? mixC(Sh, [4, 20, 50], 0.62) : mixC(Ed, [4, 14, 36], 0.25);
    const Dk = mixC(Sh, O, 0.4);
    return { Lt, Md, Sh, Gl, O, tones: [Dk, Sh, Md, mixC(Md, Lt, 0.55)] };
  };
  // [bubble34] two-tone capsules (the wallet): pixels right of `split` use tone2, with a dark / light seam
  const P1 = palOf(T, o.outline), P2 = o.tone2 ? palOf(typeof o.tone2 === 'object' ? o.tone2 : toneOf(o.tone2)) : null;
  const split = P2 ? Math.round(o.split) : 1e9;
  let { Lt, Md, Gl, O, tones } = P1;
  const fill = glass ? rgbOf(o.fill || mix(T.mid, '#ffffff', 0.55)) : null;
  const R = h / 2, c0 = R, c1 = w - R;
  const iris = (o.iris ?? h >= 9) && h >= 7;
  const gl = o.gloss !== false;
  const gd = h >= 14 ? 3 : 2; // depth of the gloss arc (on the rim band below 14 px)
  const straight = c1 - c0;
  const put = (x, y, c, a = 255) => b.set(x, y, packRGB(Math.round(c[0]), Math.round(c[1]), Math.round(c[2]), Math.round(a)));
  // the hard drop shadow first (the silhouette shifted down)
  if (sh) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (inside(x, y) && !inside(x, y + sh)) put(x, y + sh, [3, 24, 58], 90);
  const glossAt = (px, qx, ny, a, d) => {
    if (!gl || h < 6) return false;
    if (d !== gd && !(h >= 20 && d === gd + 1 && a > -150 && a < -112)) return false;
    if (qx === 0 && ny < 0 && straight > 0) { // the straight top of a capsule: a long stroke, a gap, a short dash
      if (o.glossSpans) return o.glossSpans.some(([g0, g1]) => px >= g0 && px < g1);
      const f = (px - c0) / straight;
      return f < 0.42 || (f > 0.52 && f < 0.6);
    }
    if (qx > 0) return false;
    if (a > -162 && a < -104) return true;
    return h >= 15 && straight <= 0 && a > -94 && a < -82; // a 1 px break, then a dot
  };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const d = dep[y * w + x];
    if (!d) continue;
    if (P2) ({ Lt, Md, Gl, O, tones } = x >= split ? P2 : P1);
    if (P2 && d >= 2 && (x === split - 1 || x === split)) { put(x, y, x === split ? mixC(P2.Lt, WHITE, 0.2) : P1.O); continue; }
    const px = x + 0.5, py = y + 0.5;
    const qx = px - Math.max(c0, Math.min(c1, px)), qy = py - R;
    const nx = qx / R, ny = qy / R, rr = Math.min(1, nx * nx + ny * ny), nz = Math.sqrt(1 - rr);
    const a = (Math.atan2(qy, qx || (straight > 0 ? 0 : 1e-6)) * 180) / Math.PI;
    if (d === 1) { put(x, y, O, glass ? 235 : 255); continue; }
    if (glossAt(px, qx, ny, a, d)) { put(x, y, WHITE); continue; }
    const lit = nx * BUB_LIGHT[0] + ny * BUB_LIGHT[1] + nz * BUB_LIGHT[2];
    if (d === 2) { // the rim band
      const litSide = a < -40 && a > -178;
      if (glass) { put(x, y, iris && !litSide ? irisAt(a) : mixC(Lt, WHITE, 0.5), litSide ? 230 : 215); continue; }
      if (litSide || !iris) { put(x, y, litSide ? mixC(Lt, WHITE, 0.25) : Md); continue; }
      put(x, y, mixC(Md, irisAt(a), 0.42));
      continue;
    }
    // reflected light low in the bubble (Aero glow), one band inside the rim
    const lowGlow = d === 3 && h >= 11 && a > 28 && a < 152;
    if (glass) {
      if (lowGlow) { put(x, y, mixC(Gl, WHITE, 0.3), 150); continue; }
      const k = lit > 0.55 ? 0 : lit > 0.15 ? 1 : 2;
      put(x, y, k === 0 ? mixC(fill, WHITE, 0.5) : k === 1 ? fill : mixC(fill, Md, 0.35), [118, 92, 120][k]);
      continue;
    }
    if (lowGlow) { put(x, y, mixC(Md, Gl, 0.6)); continue; }
    // classic pixel sphere: crescent bands = rings around a hot spot up-left of the centre
    const dd = Math.hypot(nx + 0.36, (ny + 0.4) * (straight > 0 ? 1.25 : 1));
    const k = dd < 0.5 ? 3 : dd < 0.98 ? 2 : dd < 1.26 ? 1 : 0;
    put(x, y, tones[k]);
  }
  // the glint cluster (inside the gloss arc)
  if (gl && h >= 7) {
    const gx = Math.round(c0 - R * 0.36 - 0.5 + (h >= 12 ? 0.5 : 0)), gy = Math.round(R - R * 0.4 - 0.5 + (h >= 12 ? 0.5 : 0));
    const W1 = packRGB(255, 255, 255);
    const ok = (xx, yy) => yy >= 0 && yy < h && dep[yy * w + xx] >= 2;
    if (ok(gx, gy)) b.set(gx, gy, W1);
    if (h >= 12) { if (ok(gx + 1, gy)) b.set(gx + 1, gy, W1); if (ok(gx, gy + 1)) b.set(gx, gy + 1, W1); }
    if (h >= 18 && ok(gx + 1, gy + 1)) b.set(gx + 1, gy + 1, packRGB(225, 250, 255));
  }
  return b.toCanvas();
}
export function pixelBubbleCanvas(w, h, o = {}) {
  h = Math.max(3, Math.round(h)); w = Math.max(h, Math.round(w));
  return aeroCached(`pb34|${w}|${h}|${bubKey(o)}`, () => pixelArt(bubbleRaster(w, h, o)));
}
function blitA(ctx, c, x, y, a) {
  if (a == null || a >= 1) { ctx.drawImage(c, x, y); return; }
  const ga = ctx.globalAlpha; ctx.globalAlpha = ga * a; ctx.drawImage(c, x, y); ctx.globalAlpha = ga;
}
export function pixelBubble(ctx, cx, cy, r, o = {}) {
  const d = Math.max(3, Math.round(r * 2));
  const c = pixelBubbleCanvas(d, d, o);
  const x = Math.round(cx - d / 2), y = Math.round(cy - d / 2);
  blitA(ctx, c, x, y, o.alpha);
  return { x, y, w: d, h: d };
}
export function pixelBubbleCapsule(ctx, x, y, w, h, o = {}) {
  x = Math.round(x); y = Math.round(y);
  blitA(ctx, pixelBubbleCanvas(w, h, o), x, y, o.alpha);
}
// a solid silhouette (base disc under buttons) and a 1 px ring hugging a bubble's outline
function bubbleSolid(w, h, color) {
  return aeroCached(`pbs34|${w}|${h}|${color}`, () => {
    const c = makeCanvas(w, h), g = ctxOf(c), ins = circleInsets(h);
    g.fillStyle = color;
    for (let y = 0; y < h; y++) g.fillRect(ins[y], y, w - ins[y] * 2, 1);
    return pixelArt(c);
  });
}
function bubbleRingTex(w, h, color) {
  return aeroCached(`pbr34|${w}|${h}|${color}`, () => {
    const W = w + 2, H = h + 2, c = makeCanvas(W, H), g = ctxOf(c), iO = circleInsets(H), iI = circleInsets(h);
    const inO = (x, y) => y >= 0 && y < H && x >= iO[y] && x < W - iO[y];
    const inI = (x, y) => y >= 1 && y <= h && x >= 1 + iI[y - 1] && x < 1 + w - iI[y - 1];
    g.fillStyle = color;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (inO(x, y) && !inI(x, y) && (inI(x - 1, y) || inI(x + 1, y) || inI(x, y - 1) || inI(x, y + 1) || inI(x - 1, y - 1) || inI(x + 1, y + 1) || inI(x - 1, y + 1) || inI(x + 1, y - 1))) g.fillRect(x, y, 1, 1);
    return pixelArt(c);
  });
}
export function pixelBubbleRing(ctx, cx, cy, r, color = '#ffffff', alpha = 0.6) {
  const d = Math.max(3, Math.round(r * 2));
  blitA(ctx, bubbleRingTex(d, d, color), Math.round(cx - d / 2) - 1, Math.round(cy - d / 2) - 1, alpha);
}
// pixel glyphs for icon-less bubble buttons (white with a dark drop row)
function glyphTex(kind, s, ink) {
  return aeroCached(`pbg34|${kind}|${s}|${ink}`, () => {
    const t = s >= 7 ? 2 : 1;
    if ((s - t) % 2) s++;
    const c = makeCanvas(s, s + 1), g = ctxOf(c);
    const plot = (col, dy) => {
      g.fillStyle = col;
      const m = Math.floor((s - t) / 2);
      if (kind === '+' || kind === '-') { g.fillRect(0, m + dy, s, t); if (kind === '+') g.fillRect(m, dy, t, s); }
      else for (let i = 0; i < s; i++) { g.fillRect(i, i + dy, t, 1); g.fillRect(s - t - i, i + dy, t, 1); }
    };
    plot(ink, 1); plot('#ffffff', 0);
    return pixelArt(c);
  });
}
// the body of a bubble button inscribed in a d-px square at (x, y); returns the content offset (lift)
function bubbleButtonBody(ctx, x, y, d, T, st) {
  const look = btnLook(T, st);
  const down = st === 'down';
  if (st === 'hover') blitA(ctx, bubbleRingTex(d, d, T.glow || '#bff4ff'), x - 1, y - 2, 0.6);
  blitA(ctx, bubbleSolid(d, d, st === 'disabled' ? '#6a7a8c' : shade(T.edge || '#0b4a8a', -0.1)), x, y + 2, 0.85);
  const o = { tone: look, iris: d >= 11 && st !== 'disabled' };
  if (down) { ctx.drawImage(pixelBubbleCanvas(d + 2, d - 2, o), x - 1, y + 3); return 2; }
  const lift = st === 'hover' ? -1 : 0;
  ctx.drawImage(pixelBubbleCanvas(d, d, o), x, y + lift);
  return lift;
}
export function pixelBubbleButton(ctx, cx, cy, r, o = {}) {
  const d = Math.max(9, Math.round(r * 2));
  const x = Math.round(cx - d / 2), y = Math.round(cy - d / 2);
  const T = o.tone && typeof o.tone === 'object' ? o.tone : o.tint ? toneFrom(o.tint) : toneOf(o.tone || 'aqua');
  const st = o.state || 'normal';
  const ga = ctx.globalAlpha;
  if (o.alpha != null) ctx.globalAlpha = ga * o.alpha;
  const lift = bubbleButtonBody(ctx, x, y, d, T, st);
  const ic = o.icon || (o.glyph ? glyphTex(o.glyph, Math.max(5, Math.round(d * 0.42)), mixHex(T.edge || '#0b4a8a')) : null);
  if (ic) {
    if (st === 'disabled') ctx.globalAlpha *= 0.55;
    ctx.drawImage(ic, Math.round(x + (d - ic.width) / 2), Math.round(y + (d - ic.height) / 2) + lift);
  }
  ctx.globalAlpha = ga;
  return { x, y, w: d, h: d, lift };
}
const mixHex = (e) => shade(e, -0.2);
export function pixelBubbleBadge(ctx, right, top, value, t = 0, o = {}) {
  if (value === null || value === undefined || value === 0 || value === false) return null;
  const txt = value === '!' ? '!' : typeof value === 'number' && value > 99 ? '99+' : String(value);
  const font = uiMode === 'huge' ? 'big' : uiFont('small');
  const tw = measureText(txt, font), ch = capH(font);
  const h = ch + 6 + (font === 'big' ? 2 : 0) + ((ch + 6) % 2 === 0 ? 1 : 0), w = Math.max(h, tw + 8);
  const x = Math.round(right - w), y = Math.round(top + (Math.sin(t * 5) > 0.85 ? -1 : 0));
  const tone = o.tone || (value === '!' ? 'orange' : 'red');
  ctx.drawImage(pixelBubbleCanvas(w, h, { tone, shadow: 1, iris: false }), x, y);
  const T = toneOf(tone);
  drawText(ctx, txt, x + Math.round((w - tw) / 2), y + Math.round((h - ch) / 2), { font, color: '#ffffff', shadow: T.shadow });
  return { x, y, w, h };
}
// a small text tag in a pixel bubble capsule ('NEW', counters): (x, y) = top-left, or top-right with align 'right'
export function pixelBubbleTag(ctx, x, y, text, o = {}) {
  const font = o.font || 'small', tw = measureText(text, font), ch = capH(font);
  const h = ch + 6, w = Math.max(h, tw + 8 + (ch > 5 ? 2 : 0));
  const tone = o.tone || 'red';
  x = Math.round(o.align === 'right' ? x - w : x); y = Math.round(y);
  ctx.drawImage(pixelBubbleCanvas(w, h, { tone, shadow: 1, iris: false }), x, y);
  drawText(ctx, text, x + Math.round((w - tw) / 2), y + Math.round((h - ch) / 2), { font, color: '#ffffff', shadow: toneOf(tone).shadow || '#000000' });
  return { x, y, w, h };
}
