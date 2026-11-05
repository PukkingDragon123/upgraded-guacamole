// Frutiger Aero UI kit (phase 3). OWNER: UI agent (signatures below are the contract).
// Everyone draws Aero chrome through these helpers so the whole game shares one glossy look:
// pixel-crisp glass (hard rounded edges, no anti-aliasing) with smooth gradients, a specular sheen,
// an inner white rim, a soft reflected glow at the bottom, bubbles and lens-flare sparkles.
// Every surface is rasterised once per size/look and cached (LRU), so drawing is a single drawImage.
//
//   AERO                         palette tokens (sky, aqua, grass, glass, ink, gloss ...)
//   AERO_TONES                   named surface tones ('aqua','green','orange','red','purple','glass','white','clear','sky','grass','dark','deep')
//   CURRENCY = 'Aero'            the one currency (state.coins holds the amount)
//   fmtAero(n) -> '1,250'        number formatting for Aero amounts
//   drawAeroPanel(ctx, x, y, w, h, {tone:'glass'|'sky'|'grass'|'dark'|'deep'|any tone, radius, title, glow, bubbles, sparkle})
//   drawAeroButton(ctx, x, y, w, h, {label, icon, state:'normal'|'hover'|'down'|'disabled', tone:'aqua'|'green'|'orange'|'glass'|..., font, align, radius})
//   drawAeroBar(ctx, x, y, w, h, k, {color, back, gloss, segments})   glossy progress bar, k in 0..1
//   drawAeroCoin(ctx, cx, cy, r, t)                           the Aero currency drop (glossy water drop; 3D from r >= 6)
//   drawGlossOrb(ctx, cx, cy, r, color, t)                    generic glossy bubble/orb
// Extras:
//   aeroSurface(w, h, o) -> cached canvas   the raw surface rasteriser (see SURFACE OPTIONS below)
//   drawAeroSurface(ctx, x, y, w, h, o)     blit of the above
//   drawSparkle(ctx, x, y, size, alpha, color)  4-point lens-flare star (size 1..4)
//   drawAeroBubble(ctx, cx, cy, r, alpha)   a clear soap/water bubble ring
//   drawAeroBadge(ctx, right, top, value, t)    red glossy count pill ('!' = orange)
//   drawAeroLabel(ctx, text, x, y, {align, tone, font}) -> rect   small glass pill with text (hover labels)
//   drawAeroGlow(ctx, cx, cy, r, color, alpha)  soft round light (cached radial)
//   aeroText(ctx, text, x, y, o)            drawText with a soft Aero glow halo (o.glow color, default white)
//   drawAeroFrame(ctx, x, y, w, h, {title, icon (canvas), leaves=true, seed}) -> {content, close, header, finish(ctx)}
//                                           (call finish(ctx) after the content: lower leaves + splash go on top)
//                                           the shared panel window: glass body, big icon + title, red close orb
//   drawAeroCard(ctx, x, y, w, h, {tone='frost', inset})   frosted inner card
// Eco accents (reference look: 2000s eco wallpapers):
//   drawAeroLeaf(ctx, x, y, len, wid, angleDeg, {flip, tone})   one glossy pixel leaf, base at (x, y)
//   drawLeafSprig(ctx, x, y, corner 'tl'|'tr'|'bl'|'br', scale=1)  a twig of 4-5 glossy leaves spilling from a corner
//   drawSunFlare(ctx, cx, cy, r, alpha=1)       sun bloom with rays, a star glint and lens rings
//   drawArcLines(ctx, cx, cy, r0, n, {gap, a0, a1, alpha, w, h})   thin white arcs (clipped to w x h from 0,0 of ctx)
//   drawSplash(ctx, x, y, w, {flip})            a curling water splash with droplets (base line at y)
//   ecoBackdrop(w, h, o) -> cached canvas      sky gradient + sun + white arcs + curved grass horizon + bubbles

import { rgba, shade, mix, pack, packRGB, hexToRgb } from '../core/color.js';
import { makeCanvas, ctxOf } from '../core/canvas.js';
import { PixelBuffer } from '../gfx/pixel.js';
import { drawText, measureText, FONTS } from '../gfx/font.js';
import { hash1 } from '../core/math.js';

export const CURRENCY = 'Aero';
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
export function setUiScale(mode) { if (UI_SCALES[mode]) uiMode = mode; }
export function uiScaleMode() { return uiMode; }
export function uiK() { return UI_SCALES[uiMode]; }
const PROMOTE = { small: 'normal', normal: 'big' };
export function uiFont(base = 'normal') { return uiMode === 'normal' ? base : PROMOTE[base] || base; }
export function capH(font) { return FONTS[font]?.height || 7; }
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
  if (!v) { v = hexToRgb(hex); rgbCache.set(hex, v); }
  return v;
}

// ---------------------------------------------------------------- surface rasteriser
// SURFACE OPTIONS (o):
//   tone (name or object) | top, mid, bot, a:[a0,a1], edge, edgeA
//   r: corner radius px ('pill' = h/2), shape: 'rect' | 'tab' (rounded top only) | 'bottom' (rounded bottom only)
//   gloss 0..1 (specular sheen over the top), glossH (px; default ~45% of h, max 26), curve (px the sheen edge bows)
//   rim 0..1 (inner white highlight line), glow 0..1 (reflected light along the bottom), streak (diagonal reflections)
//   inset (recessed: inner shadow at the top), bubbles (n decorative bubbles), sparkle (lens flare top-left)
//   seed (decor placement)
function surfaceTex(w, h, o) {
  const T = typeof o.tone === 'object' ? o.tone : o.tone ? toneOf(o.tone) : {};
  const top = rgbOf(o.top || T.top || '#ffffff'), mid = rgbOf(o.mid || T.mid || o.top || '#d8f0ff'), bot = rgbOf(o.bot || T.bot || '#8cc8ec');
  const A = o.a || T.a || [1, 1];
  const edge = rgbOf(o.edge || T.edge || '#0b4a8a'), edgeA = o.edgeA ?? T.edgeA ?? 1;
  const glowC = rgbOf(o.glowColor || T.glow || '#ffffff');
  const R = o.r === 'pill' ? h / 2 : Math.max(0, Math.min(o.r ?? 6, w / 2, h / 2));
  const shape = o.shape || 'rect';
  const gloss = o.gloss ?? 0.6, rim = o.rim ?? 0.8, glow = o.glow ?? 0.5;
  const glossH = o.glossH ?? Math.min(26, Math.round(h * 0.46));
  const curve = o.curve ?? Math.min(6, glossH * 0.35);
  const inside = (x, y) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return false;
    if (R <= 0) return true;
    const roundTop = shape !== 'bottom', roundBot = shape !== 'tab';
    let cx = null, cy = null;
    if (x < R) cx = R; else if (x >= w - R) cx = w - R;
    if (y < R && roundTop) cy = R; else if (y >= h - R && roundBot) cy = h - R;
    if (cx === null || cy === null) return true;
    const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
    return dx * dx + dy * dy <= R * R + R * 0.35;
  };
  const b = new PixelBuffer(w, h);
  const d = b.data;
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (inside(x, y)) mask[y * w + x] = 1;
  const m = (x, y) => x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x] === 1;
  const midY = 0.52;
  const seed = o.seed ?? (w * 7 + h * 13);
  for (let y = 0; y < h; y++) {
    const t = h > 1 ? y / (h - 1) : 0;
    let cr, cg, cb;
    if (t < midY) { const k = t / midY; cr = top[0] + (mid[0] - top[0]) * k; cg = top[1] + (mid[1] - top[1]) * k; cb = top[2] + (mid[2] - top[2]) * k; }
    else { const k = (t - midY) / (1 - midY); cr = mid[0] + (bot[0] - mid[0]) * k; cg = mid[1] + (bot[1] - mid[1]) * k; cb = mid[2] + (bot[2] - mid[2]) * k; }
    const ba = A[0] + (A[1] - A[0]) * t;
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      let r = cr, g = cg, bl = cb, a = ba;
      // overlay helper: source-over of colour (sr,sg,sb) with alpha sa
      const over = (sr, sg, sb, sa) => {
        if (sa <= 0) return;
        const na = sa + a * (1 - sa);
        r = (sr * sa + r * a * (1 - sa)) / na; g = (sg * sa + g * a * (1 - sa)) / na; bl = (sb * sa + bl * a * (1 - sa)) / na;
        a = na;
      };
      const ring0 = !m(x - 1, y) || !m(x + 1, y) || !m(x, y - 1) || !m(x, y + 1);
      const ring1 = !ring0 && (!m(x - 2, y) || !m(x + 2, y) || !m(x, y - 2) || !m(x, y + 2) || !m(x - 1, y - 1) || !m(x + 1, y - 1) || !m(x - 1, y + 1) || !m(x + 1, y + 1));
      // reflected glow along the bottom
      if (glow > 0 && t > 0.55) {
        const k = (t - 0.55) / 0.45;
        const cx = Math.abs(x + 0.5 - w / 2) / (w / 2);
        over(glowC[0], glowC[1], glowC[2], glow * k * k * 0.55 * (1 - cx * cx * 0.7));
      }
      // recessed: soft inner shadow at the top and left
      if (o.inset) {
        if (y < 5) over(4, 20, 40, (5 - y) * 0.07);
        if (x < 3) over(4, 20, 40, (3 - x) * 0.05);
      }
      // diagonal glass streaks
      if (o.streak) {
        const s = (x + y * 0.75 + seed * 3) % Math.max(60, w * 0.9);
        if (s > 0 && s < 14) over(255, 255, 255, 0.07);
        else if (s > 20 && s < 24) over(255, 255, 255, 0.05);
      }
      // specular sheen: top region bounded by a gently bowed edge
      if (gloss > 0) {
        const nx = (x + 0.5 - w / 2) / (w / 2);
        const edgeY = glossH - curve * (1 - nx * nx);
        if (y < edgeY) {
          const k = y / Math.max(1, edgeY);
          over(255, 255, 255, gloss * (0.62 - 0.42 * k));
        }
      }
      if (ring1 && rim > 0) {
        const k = y < h * 0.5 ? 0.9 : 0.45;
        over(255, 255, 255, rim * k);
      }
      if (ring0) {
        // outer line: tone edge, lighter at the top so the top reads as a lit glass lip
        const er = y < 2 ? edge[0] + (255 - edge[0]) * 0.25 : edge[0], eg = y < 2 ? edge[1] + (255 - edge[1]) * 0.25 : edge[1], eb = y < 2 ? edge[2] + (255 - edge[2]) * 0.25 : edge[2];
        r = er; g = eg; bl = eb; a = Math.max(a * 0.5, edgeA);
      }
      d[y * w + x] = ((Math.round(a * 255) & 255) << 24 | (Math.round(bl) & 255) << 16 | (Math.round(g) & 255) << 8 | (Math.round(r) & 255)) >>> 0;
    }
  }
  // decorative bubbles (rings with a glint) and a lens-flare sparkle
  const nb = o.bubbles | 0;
  for (let k = 0; k < nb; k++) {
    const rr = 2 + Math.floor(hash1(k, seed) * 4);
    const bx = Math.round(w * (0.08 + 0.84 * hash1(k + 7, seed + 1))), by = Math.round(h * (0.55 + 0.4 * hash1(k + 3, seed + 2)));
    ringInto(b, mask, w, h, bx, by, rr);
  }
  if (o.sparkle) sparkleInto(b, mask, w, Math.round(Math.min(w * 0.12, R + 6)) + 2, 3, o.sparkle === true ? 2 : o.sparkle);
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

function ringInto(b, mask, w, h, cx, cy, r) {
  for (let y = cy - r - 1; y <= cy + r + 1; y++) for (let x = cx - r - 1; x <= cx + r + 1; x++) {
    if (x < 0 || y < 0 || x >= w || y >= h || !mask[y * w + x]) continue;
    const dd = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
    if (dd <= r && dd > r - 1) blend(b.data, y * w + x, 255, 255, 255, (x - cx) + (y - cy) < 0 ? 0.5 : 0.22);
    else if (dd <= r - 1) blend(b.data, y * w + x, 220, 248, 255, 0.08);
  }
  const gx = cx - Math.round(r * 0.45), gy = cy - Math.round(r * 0.45);
  if (gx >= 0 && gy >= 0 && gx < w && gy < h && mask[gy * w + gx]) blend(b.data, gy * w + gx, 255, 255, 255, 0.9);
}

function sparkleInto(b, mask, w, cx, cy, s) {
  const pts = [[0, 0, 1]];
  for (let i = 1; i <= s + 1; i++) { const a = 1 - i / (s + 2); pts.push([i, 0, a], [-i, 0, a], [0, i, a * 0.8], [0, -i, a * 0.8]); }
  pts.push([1, 1, 0.35], [-1, -1, 0.35], [1, -1, 0.35], [-1, 1, 0.35]);
  for (const [dx, dy, a] of pts) {
    const x = cx + dx, y = cy + dy;
    if (x < 0 || y < 0 || x >= w || y >= b.h || !mask[y * w + x]) continue;
    blend(b.data, y * w + x, 255, 255, 255, a);
  }
}

function surfKey(w, h, o) {
  const t = typeof o.tone === 'object' ? JSON.stringify(o.tone) : o.tone || '';
  return `s|${w}|${h}|${t}|${o.top || ''}|${o.mid || ''}|${o.bot || ''}|${o.a || ''}|${o.edge || ''}|${o.edgeA ?? ''}|${o.r ?? ''}|${o.shape || ''}|${o.gloss ?? ''}|${o.glossH ?? ''}|${o.curve ?? ''}|${o.rim ?? ''}|${o.glow ?? ''}|${o.glowColor || ''}|${o.streak ? 1 : 0}|${o.inset ? 1 : 0}|${o.bubbles | 0}|${o.sparkle || 0}|${o.seed ?? ''}`;
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

// ---------------------------------------------------------------- panel

const PANEL_TONE = { glass: 'frost', sky: 'sky', grass: 'grass', dark: 'dark', deep: 'deep' };

export function drawAeroPanel(ctx, x, y, w, h, o = {}) {
  const tone = PANEL_TONE[o.tone || 'glass'] || o.tone || 'frost';
  const r = o.radius ?? 8;
  if (o.glow) {
    ctx.fillStyle = rgba('#bff4ff', 0.18);
    ctx.fillRect(Math.round(x) - 2, Math.round(y) + 2, Math.round(w) + 4, Math.round(h) - 4);
    ctx.fillRect(Math.round(x) + 2, Math.round(y) - 2, Math.round(w) - 4, Math.round(h) + 4);
  }
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
  const r = o.radius ?? Math.floor(h / 2);
  const down = st === 'down';
  // hover halo (soft light around the pill)
  if (st === 'hover') {
    ctx.fillStyle = rgba(T.glow || '#bff4ff', 0.28);
    ctx.fillRect(x + Math.min(r, 4), y - 1, w - Math.min(r, 4) * 2, h + 2);
    ctx.fillRect(x - 1, y + Math.min(r, 4), w + 2, h - Math.min(r, 4) * 2);
  }
  const key = `btn|${w}|${h}|${r}|${typeof toneName === 'object' ? JSON.stringify(toneName) : toneName}|${st}`;
  const c = aeroCached(key, () => surfaceTex(w, h, { tone: look, r, gloss: down ? 0.35 : 0.8, glossH: Math.max(3, Math.round(h * (down ? 0.38 : 0.46))), curve: Math.min(3, h * 0.12), rim: down ? 0.35 : 0.85, glow: down ? 0.25 : 0.75 }));
  ctx.drawImage(c, x, y);
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
  const dy = down ? 1 : 0;
  let cx = o.align === 'left' ? x + pad - 1 : x + Math.round((w - tw - iw) / 2);
  const dis = st === 'disabled';
  if (ic) {
    ctx.globalAlpha = dis ? 0.55 : 1;
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

export function drawAeroBar(ctx, x, y, w, h, k, o = {}) {
  x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.max(3, Math.round(h));
  k = Math.max(0, Math.min(1, k || 0));
  const color = o.color || AERO.aqua;
  // recessed glass track
  ctx.drawImage(aeroCached(`bart|${w}|${h}|${o.back || ''}`, () => surfaceTex(w, h, {
    top: o.back ? shade(o.back, -0.2) : '#0e3e64', mid: o.back || '#1c5a86', bot: o.back ? shade(o.back, 0.15) : '#2e7aa8', a: [0.55, 0.45],
    edge: '#06243e', edgeA: 0.75, r: 'pill', gloss: 0, rim: 0, glow: 0.35, glowColor: '#9fe6ff', inset: true,
  })), x, y);
  const fw = Math.round((w - 2) * k);
  if (fw > 0) {
    const fill = aeroCached(`barf|${w - 2}|${h - 2}|${color}|${o.gloss !== false}`, () => surfaceTex(w - 2, h - 2, {
      top: mix(color, '#ffffff', 0.55), mid: shade(color, 0.05), bot: shade(color, -0.25), edge: shade(color, -0.5), edgeA: 0.9,
      r: 'pill', gloss: o.gloss === false ? 0 : 0.7, glossH: Math.max(1, Math.round((h - 2) * 0.48)), curve: 0, rim: 0.5, glow: 0.6, glowColor: mix(color, '#ffffff', 0.6),
    }));
    const sw = Math.max(Math.min(fw, h - 2), fw);
    if (sw >= w - 2) ctx.drawImage(fill, x + 1, y + 1);
    else {
      // left part from the texture, then a rounded cap from its right end
      const cap = Math.min(Math.floor((h - 2) / 2), Math.floor(sw / 2));
      ctx.drawImage(fill, 0, 0, sw - cap, h - 2, x + 1, y + 1, sw - cap, h - 2);
      ctx.drawImage(fill, w - 2 - cap, 0, cap, h - 2, x + 1 + sw - cap, y + 1, cap, h - 2);
    }
    // travelling bubbles inside the fill
    if (h >= 7 && fw > 10) {
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      for (let i = 0; i < fw / 16; i++) {
        const bx = x + 4 + Math.floor(hash1(i, 3) * Math.max(1, fw - 8)), by = y + 2 + Math.floor(hash1(i, 4) * (h - 5));
        if (bx < x + fw - 2) ctx.fillRect(bx, by, 1, 1);
      }
    }
  }
  const seg = o.segments | 0;
  if (seg > 1 && seg < w / 3) {
    ctx.fillStyle = 'rgba(6,36,62,0.35)';
    for (let i = 1; i < seg; i++) ctx.fillRect(x + 1 + Math.round(((w - 2) * i) / seg), y + 2, 1, h - 4);
  }
}

// ---------------------------------------------------------------- orbs, bubbles, coin

function orbTex(r, color) {
  const S = Math.ceil(r * 2) + 2, c = S / 2;
  const b = new PixelBuffer(S, S);
  const C = rgbOf(color), Lt = rgbOf(mix(color, '#ffffff', 0.7)), Dk = rgbOf(shade(color, -0.45)), E = rgbOf(shade(color, -0.65));
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = x + 0.5 - c, dy = y + 0.5 - c, d = Math.hypot(dx, dy);
    if (d > r) continue;
    const u = d / r;
    // light from the top-left; a bright rim of refracted light at the bottom-right
    const lit = (-dx * 0.6 - dy * 0.8) / r;
    let k = 0.5 + lit * 0.45;
    let col = k > 0.5 ? [C[0] + (Lt[0] - C[0]) * (k - 0.5) * 2, C[1] + (Lt[1] - C[1]) * (k - 0.5) * 2, C[2] + (Lt[2] - C[2]) * (k - 0.5) * 2] : [Dk[0] + (C[0] - Dk[0]) * k * 2, Dk[1] + (C[1] - Dk[1]) * k * 2, Dk[2] + (C[2] - Dk[2]) * k * 2];
    // bottom refraction glow
    const rg = Math.max(0, (dy / r) * 0.9 + (dx / r) * 0.3) * Math.max(0, u - 0.45) * 1.8;
    if (rg > 0) col = col.map((v, i) => v + (Lt[i] - v) * Math.min(1, rg));
    if (d > r - 1) col = [E[0], E[1], E[2]];
    b.set(x, y, packRGB(Math.max(0, Math.min(255, col[0])), Math.max(0, Math.min(255, col[1])), Math.max(0, Math.min(255, col[2]))));
  }
  // specular cap: a soft white ellipse at the top-left plus a hard glint
  const hx = c - r * 0.32, hy = c - r * 0.5, hrx = r * 0.55, hry = r * 0.3;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const ex = (x + 0.5 - hx) / hrx, ey = (y + 0.5 - hy) / hry;
    const e = ex * ex + ey * ey;
    if (e < 1 && Math.hypot(x + 0.5 - c, y + 0.5 - c) < r - 1) blend(b.data, y * S + x, 255, 255, 255, 0.75 * (1 - e * 0.7));
  }
  const gx = Math.round(c - r * 0.5), gy = Math.round(c - r * 0.55);
  if (r >= 3) blend(b.data, gy * S + gx, 255, 255, 255, 1);
  return b.toCanvas();
}

export function drawGlossOrb(ctx, cx, cy, r, color = AERO.aqua, t = 0) {
  r = Math.max(1.5, Math.round(r * 2) / 2);
  const c = aeroCached(`orb|${r}|${color}`, () => orbTex(r, color));
  ctx.drawImage(c, Math.round(cx - c.width / 2), Math.round(cy - c.height / 2));
  void t;
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

export function drawAeroBubble(ctx, cx, cy, r, alpha = 1) {
  r = Math.max(1.5, Math.round(r * 2) / 2);
  const c = aeroCached(`bub|${r}`, () => bubbleTex(r));
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

export function drawAeroCoin(ctx, cx, cy, r = 5, t = 0) {
  if (coin3d && r >= 6) {
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
  const c = aeroCached(`coin|${r}`, () => coinTex(r));
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

function glowTex(r, color) {
  const S = Math.ceil(r * 2), c = S / 2;
  const cv = makeCanvas(S, S);
  const g = ctxOf(cv);
  const gr = g.createRadialGradient(c, c, 0, c, c, r);
  gr.addColorStop(0, rgba(color, 1)); gr.addColorStop(0.4, rgba(color, 0.45)); gr.addColorStop(1, rgba(color, 0));
  g.fillStyle = gr;
  g.fillRect(0, 0, S, S);
  return cv;
}

export function drawAeroGlow(ctx, cx, cy, r, color = '#bff6ff', alpha = 0.5) {
  r = Math.max(2, Math.round(r));
  const c = aeroCached(`glow|${r}|${color}`, () => glowTex(r, color));
  const ga = ctx.globalAlpha;
  ctx.globalAlpha = ga * alpha;
  ctx.drawImage(c, Math.round(cx - r), Math.round(cy - r));
  ctx.globalAlpha = ga;
}

export function drawAeroBadge(ctx, right, top, value, t = 0) {
  if (value === null || value === undefined || value === 0 || value === false) return null;
  const txt = value === '!' ? '!' : typeof value === 'number' && value > 99 ? '99+' : String(value);
  const font = uiMode === 'huge' ? 'big' : uiFont('small'); // [phase6:ui]
  const tw = measureText(txt, font), ch = capH(font);
  const h = ch + 6 + (font === 'big' ? 2 : 0), w = Math.max(h, tw + 8);
  const x = Math.round(right - w), y = Math.round(top + (Math.sin(t * 5) > 0.85 ? -1 : 0));
  const tone = value === '!' ? 'orange' : 'red';
  ctx.drawImage(aeroCached(`badge|${w}|${h}|${tone}`, () => surfaceTex(w, h, { tone, r: 'pill', gloss: 0.85, glossH: Math.round(h * 0.45), curve: 1, rim: 0.7, glow: 0.6, edge: '#ffffff', edgeA: 1 })), x, y);
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
  drawText(ctx, text, lx + Math.round((w - tw) / 2), ly + Math.round((h - capH(font)) / 2), { font, color: T.text, shadow: T.text === '#ffffff' ? T.shadow : null });
  return { x: lx, y: ly, w, h };
}

// ---------------------------------------------------------------- shared panel frame & cards

export function drawAeroFrame(ctx, x, y, w, h, o = {}) {
  x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h);
  // soft shadow + outer halo
  ctx.fillStyle = rgba('#03183a', 0.2);
  ctx.fillRect(x + 6, y + h, w - 10, 3);
  ctx.fillRect(x + w, y + 6, 3, h - 10);
  ctx.fillStyle = rgba('#bff4ff', 0.16);
  ctx.fillRect(x - 2, y + 4, w + 4, h - 8);
  ctx.fillRect(x + 4, y - 2, w - 8, h + 4);
  // the body is a little eco wallpaper: deep sky, sun bloom, white arcs, a curved grass horizon
  ctx.drawImage(ecoBackdrop(w, h, { seed: o.seed ?? 7, r: 10 }), x, y);
  const k = w > 360 ? 1 : 0.8;
  if (o.leaves !== false) drawLeafSprig(ctx, x + w - 6, y + 5, 'tr', k);
  let tx = x + 12;
  if (o.icon) {
    const ic = o.icon;
    ctx.drawImage(ic, Math.round(x + 6), Math.round(y + 15 - ic.height / 2));
    tx = x + 8 + ic.width + 2;
  }
  if (o.title) {
    // [phase6:ui] bold big face at 2x (18 px caps) when the UI is enlarged; an outline keeps it readable on the sky
    const tf = uiMode === 'normal' || measureText(o.title, 'big', 2) > w - (tx - x) - 70 ? 'normal' : 'big';
    drawText(ctx, o.title, tx, y + (tf === 'big' ? 6 : 8), { font: tf, scale: 2, color: '#ffffff', shadow: '#0a3e74', outline: tf === 'big' ? 'rgba(10,62,116,0.55)' : null });
  }
  const close = { x: x + w - 25, y: y + 6, w: 18, h: 18 };
  // finish(ctx): call after drawing the panel's content so the lower leaves and the splash sit on top
  const finish = (c2 = ctx) => {
    if (o.leaves === false) return;
    drawSplash(c2, x + w - 96 * k, y + h + 9, Math.round(84 * k), { flip: true });
    drawLeafSprig(c2, x + 5, y + h - 6, 'bl', k);
  };
  return { content: { x: x + 8, y: y + 32, w: w - 16, h: h - 40 }, close, header: { x, y, w, h: 30 }, finish };
}

export function drawAeroCard(ctx, x, y, w, h, o = {}) {
  const tone = o.tone || 'frost';
  drawAeroSurface(ctx, x, y, w, h, { tone, a: tone === 'frost' ? [0.9, 0.84] : undefined, r: o.r ?? 7, gloss: o.gloss ?? 0.3, glossH: Math.min(18, Math.round(h * 0.3)), curve: 2, rim: 0.9, glow: 0.35, glowColor: '#bfeaff', inset: o.inset, bubbles: o.bubbles || 0, seed: o.seed });
}

// ---------------------------------------------------------------- eco accents

const LEAF_TONES = {
  leaf: ['#13561a', '#2a8c22', '#52bf2c', '#8fe03a', '#d4ff7a'],
  lime: ['#2a6a12', '#4aa61e', '#7fd636', '#b8f05a', '#ecffa8'],
  deep: ['#0c4416', '#1c7024', '#36a034', '#68cc48', '#b4f080'],
};

function leafTex(len, wid, ang, flip, tone) {
  const R = LEAF_TONES[tone] || LEAF_TONES.leaf;
  const P = R.map((h) => rgbOf(h));
  const a = (ang * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a);
  const hw = wid / 2;
  const pts = [[0, 0], [ca * len, sa * len], [ca * len * 0.5 - sa * hw, sa * len * 0.5 + ca * hw], [ca * len * 0.5 + sa * hw, sa * len * 0.5 - ca * hw]];
  const minX = Math.floor(Math.min(...pts.map((q) => q[0]))) - 2, minY = Math.floor(Math.min(...pts.map((q) => q[1]))) - 2;
  const maxX = Math.ceil(Math.max(...pts.map((q) => q[0]))) + 2, maxY = Math.ceil(Math.max(...pts.map((q) => q[1]))) + 2;
  const W = maxX - minX, H = maxY - minY, ox = -minX, oy = -minY;
  const b = new PixelBuffer(W, H);
  const fs = flip ? -1 : 1;
  const shape = (x, y) => {
    const px = x + 0.5 - ox, py = y + 0.5 - oy;
    const u = (px * ca + py * sa) / len, v = ((-px * sa + py * ca) / hw) * fs;
    if (u < 0.02 || u > 1) return null;
    let half = Math.pow(Math.sin(Math.PI * Math.min(1, Math.pow(u, 0.85) * 1.02)), 0.6) * (1 - 0.12 * u);
    if (len > 18) half *= 1 - 0.07 * (0.5 + 0.5 * Math.sin(u * len * 1.1));
    if (Math.abs(v) > half) return null;
    return [u, v, half];
  };
  const inside = new Uint8Array(W * H);
  const info = new Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const q = shape(x, y); if (q) { inside[y * W + x] = 1; info[y * W + x] = q; } }
  const m = (x, y) => x >= 0 && y >= 0 && x < W && y < H && inside[y * W + x];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!inside[y * W + x]) continue;
    const [u, v, half] = info[y * W + x];
    let c;
    if (!m(x - 1, y) || !m(x + 1, y) || !m(x, y - 1) || !m(x, y + 1)) c = P[0];
    else if (Math.abs(v) < 0.09 + 0.05 * (1 - u)) c = P[4];
    else {
      const lit = v < 0 ? 1 : 0;
      let k = 1.6 + lit * 1.0 - u * 0.5 + (1 - Math.abs(v) / half) * 0.35;
      // side veins
      const vein = (u * len * 0.42 - Math.abs(v) * hw * 0.32) % 4;
      if (vein > 0 && vein < 0.7 && Math.abs(v) < half * 0.85) k += 0.55;
      k = Math.max(0, Math.min(3.99, k));
      const i = Math.floor(k), f = k - i, A = P[i], B = P[Math.min(4, i + 1)];
      c = [A[0] + (B[0] - A[0]) * f, A[1] + (B[1] - A[1]) * f, A[2] + (B[2] - A[2]) * f];
      // glossy specular streak on the lit half
      if (v < -0.18 && v > -0.62 && u > 0.18 && u < 0.72) {
        const s = 0.42 * Math.sin(((u - 0.18) / 0.54) * Math.PI);
        c = [c[0] + (255 - c[0]) * s, c[1] + (255 - c[1]) * s, c[2] + (255 - c[2]) * s];
      }
    }
    b.set(x, y, packRGB(c[0], c[1], c[2]));
  }
  // stalk
  for (let i = 0; i < 3; i++) { const sx = Math.round(ox - ca * i), sy = Math.round(oy - sa * i); if (sx >= 0 && sy >= 0 && sx < W && sy < H) b.set(sx, sy, packRGB(P[1][0], P[1][1], P[1][2])); }
  const cv = b.toCanvas();
  cv.ox = ox; cv.oy = oy;
  return cv;
}

export function drawAeroLeaf(ctx, x, y, len, wid, angleDeg, o = {}) {
  len = Math.max(4, Math.round(len)); wid = Math.max(3, Math.round(wid));
  const ang = Math.round(angleDeg / 10) * 10;
  const c = aeroCached(`leaf|${len}|${wid}|${ang}|${o.flip ? 1 : 0}|${o.tone || 'leaf'}`, () => leafTex(len, wid, ang, !!o.flip, o.tone || 'leaf'));
  ctx.drawImage(c, Math.round(x - c.ox), Math.round(y - c.oy));
}

// Sprig layout for the top-left corner (leaves spill up and to the left); other corners mirror it.
const SPRIG = [
  { x: 28, y: -3, len: 22, wid: 14, ang: -28, flip: true, tone: 'lime' },
  { x: 2, y: 12, len: 26, wid: 16, ang: 128, flip: false, tone: 'lime' },
  { x: 3, y: 3, len: 34, wid: 20, ang: 174, flip: true, tone: 'deep' },
  { x: 16, y: -4, len: 32, wid: 19, ang: -70, flip: true, tone: 'leaf' },
  { x: 0, y: 0, len: 42, wid: 24, ang: -132, flip: false, tone: 'lime' },
]

function sprigTex(corner, scale) {
  const fx = corner === 'tr' || corner === 'br' ? -1 : 1, fy = corner === 'bl' || corner === 'br' ? -1 : 1;
  const S = Math.ceil(110 * scale), O = Math.ceil(52 * scale);
  const c = makeCanvas(S, S);
  const g = ctxOf(c);
  // twig
  for (let i = 0; i <= 40; i++) {
    const k = i / 40, px = O + fx * (38 * k) * scale, py = O + fy * (-5 * Math.sin(k * Math.PI)) * scale;
    g.fillStyle = '#1f6a18'; g.fillRect(Math.round(px), Math.round(py), 2, 2);
    g.fillStyle = '#7ed43a'; g.fillRect(Math.round(px), Math.round(py), 1, 1);
  }
  for (const L of SPRIG) {
    let a = L.ang;
    if (fx < 0) a = 180 - a;
    if (fy < 0) a = -a;
    const flip = (fx * fy < 0) ? !L.flip : L.flip;
    drawAeroLeaf(g, O + fx * L.x * scale, O + fy * L.y * scale, L.len * scale, L.wid * scale, a, { flip, tone: L.tone });
  }
  c.ox = O; c.oy = O;
  return c;
}

export function drawLeafSprig(ctx, x, y, corner = 'tl', scale = 1) {
  scale = Math.round(scale * 10) / 10;
  const c = aeroCached(`sprig|${corner}|${scale}`, () => sprigTex(corner, scale));
  ctx.drawImage(c, Math.round(x - c.ox), Math.round(y - c.oy));
}

function flareTex(r) {
  const S = r * 2, c = makeCanvas(S, S), g = ctxOf(c);
  const gr = g.createRadialGradient(r, r, 0, r, r, r);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.12, 'rgba(255,255,250,0.95)'); gr.addColorStop(0.3, 'rgba(220,250,255,0.45)'); gr.addColorStop(1, 'rgba(200,240,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, S, S);
  // rays (crisp 1 px spokes of varying length)
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2 + 0.2, L = r * (i % 2 ? 0.55 : 0.95) * (0.8 + hash1(i, 3) * 0.3);
    for (let d = r * 0.12; d < L; d += 0.7) {
      const k = 1 - d / L;
      g.fillStyle = `rgba(255,255,255,${(0.55 * k).toFixed(3)})`;
      g.fillRect(Math.round(r + Math.cos(a) * d), Math.round(r + Math.sin(a) * d), 1, 1);
    }
  }
  return c;
}

export function drawSunFlare(ctx, cx, cy, r = 24, alpha = 1) {
  r = Math.max(6, Math.round(r));
  const c = aeroCached(`flare|${r}`, () => flareTex(r));
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
  const c = aeroCached(`splash|${w}|${o.flip ? 1 : 0}`, () => splashTex(w, !!o.flip));
  ctx.drawImage(c, Math.round(x), Math.round(y - c.height));
}

function ecoTex(w, h, o) {
  const R = o.r ?? 10;
  const body = surfaceTex(w, h, { top: '#1470d8', mid: '#4cb4f8', bot: '#c8f0ff', edge: '#073c80', r: R, gloss: 0.38, glossH: Math.min(28, Math.round(h * 0.3)), curve: 6, rim: 0.85, glow: 0.2, streak: true, seed: o.seed });
  const c = makeCanvas(w, h);
  const g = ctxOf(c);
  g.drawImage(body, 0, 0);
  g.globalCompositeOperation = 'source-atop';
  // sun bloom + arcs from it (upper right, left of the close orb)
  const sx = Math.round(w * 0.78), sy = -4;
  drawArcLines(g, sx, sy, Math.round(h * 0.35), 6, { gap: 7, a0: 1.75, a1: 3.0, alpha: 0.4, w, h });
  drawSunFlare(g, sx, sy + 6, Math.min(46, Math.round(h * 0.18)), 0.85);
  // curved grass horizon along the bottom
  const base = h - 4;
  for (let x = 0; x < w; x++) {
    const n = (x - w / 2) / (w / 2);
    const top = Math.round(base - 16 - (1 - n * n) * Math.min(18, h * 0.06));
    for (let y = top; y < h; y++) {
      const k = (y - top) / Math.max(1, h - top);
      const col = y === top ? '#e8ffb0' : y === top + 1 ? '#a8ec5a' : mix('#6cd23c', '#2a8a1c', Math.min(1, k * 1.4));
      g.fillStyle = col;
      g.fillRect(x, y, 1, 1);
    }
    if (hash1(x, 21) > 0.82) { g.fillStyle = '#c8f878'; g.fillRect(x, top - 1, 1, 1); }
  }
  // bubbles drifting up the sides
  for (let i = 0; i < Math.round(w / 60); i++) {
    const bx = hash1(i, o.seed + 31) < 0.5 ? 6 + hash1(i, 32) * 30 : w - 36 + hash1(i, 33) * 30;
    const by = h * (0.25 + hash1(i, 34) * 0.55), br = 2 + Math.floor(hash1(i, 35) * 4);
    g.drawImage(aeroCached(`bub|${br}`, () => bubbleTex(br)), Math.round(bx - br - 1), Math.round(by - br - 1));
  }
  g.globalCompositeOperation = 'source-over';
  return c;
}

export function ecoBackdrop(w, h, o = {}) {
  w = Math.max(16, Math.round(w)); h = Math.max(16, Math.round(h));
  return aeroCached(`eco|${w}|${h}|${o.seed ?? 7}|${o.r ?? 10}`, () => ecoTex(w, h, { seed: o.seed ?? 7, r: o.r }));
}
