// Fight HUD (screen space), Frutiger Aero and nearly text-free [simple24]:
//   bite   the big glossy "!" over the biting fish, the bite window draining, CLICK! with a 3D mouse
//   scene  ink on the lens
//   frame  soft Aero vignette (stun / beat / strain edge tints), the big glossy name pill, the meter + catch bar +
//          SHOCK button (meter.js) and the 3D gear (gear.js), the spin control.

import { TAU, clamp, clamp01, lerp, damp } from '../core/math.js';
import { rgba, RARITY } from '../core/color.js';
import { drawText, measureText, registerInlineIcon } from '../gfx/font.js';
import { getUiIcon } from '../gfx/uiicons.js';
import { makeCanvas, ctxOf } from '../core/canvas.js';
import { drawCharacter } from '../gfx/character.js';
import { discSprite, glowSprite, pixelLine, gbubbleSprite } from '../gfx/particles.js';
import { glossText, drawGlassPill, glossFor, word3D } from './cinematics.js';
import { drawIcon3d } from './icons3d.js'; // [phase9:fishing] 3D HUD icons, 3D voxel words
import { drawMeter } from './meter.js'; // [simple24] the meter, catch bar and SHOCK button
import { voxelFishIcon } from '../fish/fishicon.js';
import { gemIcon } from '../gfx/bigicons.js';

const INK = '#0c3a52';

// ------------------------------------------------------------------ inline icons (used by events)
let iconsReady = false;
function crankIcon(dir) {
  const c = makeCanvas(11, 11);
  const g = ctxOf(c);
  const pts = [];
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * TAU * 0.8 - Math.PI / 2;
    const aa = dir > 0 ? a : -a + Math.PI;
    pts.push([Math.round(5 + Math.cos(aa) * 4), Math.round(5 + Math.sin(aa) * 4)]);
  }
  g.fillStyle = INK;
  for (const [x, y] of pts) g.fillRect(x - 1, y - 1, 3, 3);
  g.fillStyle = '#8ff0ff';
  for (const [x, y] of pts) g.fillRect(x, y, 1, 1);
  const [ex, ey] = pts[pts.length - 1];
  g.fillStyle = INK; g.fillRect(ex - 2, ey - 2, 5, 5);
  g.fillStyle = '#ffffff'; g.fillRect(ex - 1, ey - 1, 3, 3);
  return c;
}

export function ensureIcons() {
  if (iconsReady) return;
  iconsReady = true;
  registerInlineIcon('crank_cw', crankIcon(1));
  registerInlineIcon('crank_ccw', crankIcon(-1));
  registerInlineIcon('crank', crankIcon(1));
}

export function inkSplatSprite(r) { return discSprite(r, '#0a0614', 0.35, '#1a1030'); }

// ------------------------------------------------------------------ cached art
const ART = new Map();
function cached(key, w, h, paint) {
  let c = ART.get(key);
  if (!c) { c = makeCanvas(w, h); paint(ctxOf(c), c); ART.set(key, c); }
  return c;
}

// Pixel mouse glyph, left button lit (hold) - 9x13.
function mouseHold(lit) {
  return cached('mouse' + lit, 9, 13, (g) => {
    const rows = ['..#####..', '.#LL#..#.', '#LLL#...#', '#LLL#...#', '#####...#', '#.......#', '#.......#', '#.......#', '#.......#', '#.......#', '.#.....#.', '..#####..', '.........'];
    for (let y = 0; y < rows.length; y++) for (let x = 0; x < 9; x++) {
      const ch = rows[y][x];
      if (ch === '#') { g.fillStyle = INK; g.fillRect(x, y, 1, 1); }
      else if (ch === 'L') { g.fillStyle = lit ? '#8be04a' : '#d8eef8'; g.fillRect(x, y, 1, 1); }
      else if (y > 0 && y < 11 && x > 0 && x < 8 && rows[y].indexOf('#') < x && rows[y].lastIndexOf('#') > x) { g.fillStyle = y < 3 ? '#ffffff' : '#e8f6fc'; g.fillRect(x, y, 1, 1); }
    }
    if (lit) { g.fillStyle = '#e2ffb0'; g.fillRect(2, 1, 1, 1); }
  });
}

// ------------------------------------------------------------------ glossy arrow (per-pixel, any angle)
let arrowCanvas = null, arrowCtx = null;
const ARROW_RAMPS = {
  pull: { fill: ['#2f7a1e', '#3fae2a', '#6cd03a', '#a6ec5a', '#e2ffb0'], empty: ['#3f8fbc', '#7cc8ec', '#b8ecff', '#e2f8ff', '#ffffff'] },
  surge: { fill: ['#8a1a10', '#d8402a', '#ff6a3a', '#ff9d5a', '#ffe0c0'], empty: ['#8a1a10', '#d8402a', '#ff6a3a', '#ff9d5a', '#ffe0c0'] },
  ok: { fill: ['#0d6f9a', '#1fb8dc', '#4fe0f0', '#9ff4ff', '#ffffff'], empty: ['#0d6f9a', '#1fb8dc', '#4fe0f0', '#9ff4ff', '#ffffff'] },
};
const hexRgb = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const RAMP_RGB = {};
for (const [k, v] of Object.entries(ARROW_RAMPS)) RAMP_RGB[k] = { fill: v.fill.map(hexRgb), empty: v.empty.map(hexRgb) };

// Draws an arrow from tail (x, y) pointing along `ang`. o: {len, w, k (fill 0..1), kind, alpha, emptyAlpha}
export function drawGlossArrow(ctx, x, y, ang, o = {}) {
  const len = Math.round(o.len ?? 70), w = Math.max(4, Math.round(o.w ?? 14));
  const headL = Math.round(w * 1.35), headW = w * 1.15;
  const ca = Math.cos(ang), sa = Math.sin(ang);
  const pad = Math.ceil(headW) + 3;
  const S = len + pad * 2 + 2;
  if (!arrowCanvas || arrowCanvas.width < S) { arrowCanvas = makeCanvas(S, S); arrowCtx = ctxOf(arrowCanvas); }
  const g = arrowCtx;
  const img = g.createImageData(S, S);
  const d = img.data;
  const ox = S / 2, oy = S / 2; // arrow midpoint at the canvas centre
  const k = clamp01(o.k ?? 1);
  const R = RAMP_RGB[o.kind || 'pull'];
  const upSign = ca >= 0 ? -1 : 1;
  const half = (u) => (u <= len - headL ? w / 2 : u <= len ? (headW * (len - u)) / headL : -1);
  for (let py = 0; py < S; py++) for (let px = 0; px < S; px++) {
    const rx = px + 0.5 - ox, ry = py + 0.5 - oy;
    const u = rx * ca + ry * sa + len / 2, v = -rx * sa + ry * ca;
    const hw = half(u);
    const inside = u >= 0 && hw > 0 && Math.abs(v) <= hw;
    const hwo = half(Math.min(len, Math.max(0, u)));
    const outl = !inside && u >= -1.6 && u <= len + 1.6 && Math.abs(v) <= Math.max(hwo, u < 0 ? w / 2 : 0) + 1.6;
    if (!inside && !outl) continue;
    const i = (py * S + px) * 4;
    if (outl) { d[i] = 12; d[i + 1] = 58; d[i + 2] = 82; d[i + 3] = 230; continue; }
    const n = (v / Math.max(1, hw)) * upSign; // -1 bottom .. 1 top (screen)
    const filled = u <= k * len;
    const ramp = filled ? R.fill : R.empty;
    let l = 0.45 + n * 0.32;
    if (n > 0.2 && n < 0.75) l = 0.92; // gloss band
    if (Math.abs(v) > hw - 1.2) l -= 0.25; // edge
    l = clamp01(l) * (ramp.length - 1);
    const li = Math.min(ramp.length - 1, Math.floor(l) + ((l % 1) > ((px * 7 + py * 13) % 16) / 16 ? 1 : 0));
    const c = ramp[li];
    d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2];
    d[i + 3] = filled ? 255 : Math.round(255 * (o.emptyAlpha ?? 0.55));
  }
  g.clearRect(0, 0, S, S);
  g.putImageData(img, 0, 0);
  const mx = x + ca * len / 2, my = y + sa * len / 2;
  const a0 = ctx.globalAlpha;
  ctx.globalAlpha = a0 * (o.alpha ?? 1);
  ctx.drawImage(arrowCanvas, 0, 0, S, S, Math.round(mx - ox), Math.round(my - oy), S, S);
  ctx.globalAlpha = a0;
}

// ------------------------------------------------------------------ glossy pill (pixel rows)
export function drawPill(ctx, x, y, w, h, top = '#ffffff', bot = '#9fe0ff', edge = INK, alpha = 0.9) {
  x = Math.round(x); y = Math.round(y);
  const r = Math.floor(h / 2);
  ctx.save();
  ctx.globalAlpha *= alpha;
  for (let i = -1; i <= h; i++) {
    const dy = i < r ? r - i - 0.5 : i >= h - r ? i - (h - r) + 0.5 : 0;
    const inset = dy > 0 ? Math.round(r - Math.sqrt(Math.max(0, r * r - dy * dy))) : 0;
    if (i === -1 || i === h) { ctx.fillStyle = edge; ctx.fillRect(x + r, y + i, w - 2 * r, 1); continue; }
    const k = i / Math.max(1, h - 1);
    ctx.fillStyle = edge; ctx.fillRect(x + inset - 1, y + i, w - 2 * inset + 2, 1);
    ctx.fillStyle = k < 0.45 ? mixHex(top, bot, k * 0.6) : mixHex(top, bot, 0.3 + k * 0.7);
    ctx.fillRect(x + inset, y + i, w - 2 * inset, 1);
  }
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.fillRect(x + r, y + 1, w - 2 * r, 1);
  ctx.restore();
}

function mixHex(a, b, t) {
  const A = hexRgb(a), B = hexRgb(b);
  return `rgb(${Math.round(A[0] + (B[0] - A[0]) * t)},${Math.round(A[1] + (B[1] - A[1]) * t)},${Math.round(A[2] + (B[2] - A[2]) * t)})`;
}

// ------------------------------------------------------------------ bite cue [simple24]: CLICK NOW!
// A big glossy "!" bubble above the biting fish with the bite window draining as a pixel bar under it, a 3D mouse
// clicking beside it and the 3D word CLICK!. No rings.
export function drawBiteCue(ctx, F) {
  const f = F.fish, hs = F.hs;
  const k = clamp01(F.biteT / Math.max(0.01, F.biteMax));
  const [sx, sy] = F.toScreen(f.x, f.y);
  const z = F.zoom();
  const t = F.t;
  const S = F.H / 540;
  const cx = Math.round(clamp(sx, 80 * S, F.W - 80 * S)), cy = Math.round(clamp(sy - 22 * f.scale * z - 46 * S, 70 * S, F.H - 120 * S));
  const pop = 1 + Math.max(0, 0.35 - (1 - k) * 2.5) + Math.sin(t * 30) * 0.05;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 0.55 + 0.3 * Math.sin(t * 20);
  ctx.drawImage(glowSprite(Math.round(34 * S), '#ffe27a'), cx - Math.round(34 * S), cy - Math.round(34 * S));
  ctx.restore();
  const br = Math.round(20 * S);
  const b = gbubbleSprite(br);
  ctx.drawImage(b, cx - br, cy - br);
  word3D(ctx, '!', cx, cy, { t, scale: 2.3 * S * pop, pal: 'sun', wobble: 1.5, depth: 6 });
  // the window draining: a chunky pixel bar under the bubble
  const w = Math.round(64 * S), h = Math.max(4, Math.round(6 * S)), x = cx - w / 2, y = cy + br + Math.round(8 * S);
  ctx.fillStyle = INK; ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
  ctx.fillStyle = '#163a56'; ctx.fillRect(x, y, w, h);
  ctx.fillStyle = k < 0.35 ? (Math.floor(t * 10) % 2 ? '#ffffff' : '#ff6a5a') : '#ffd23a'; ctx.fillRect(x, y, Math.round(w * k), h);
  ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.fillRect(x, y, Math.round(w * k), 1);
  // CLICK! + a 3D mouse pressing its button
  const down = Math.floor(t * 5) % 2 === 0;
  drawIcon3d(ctx, down ? 'mouse_lit' : 'mouse', cx + Math.round(48 * S), cy + (down ? 2 : 0), Math.round(30 * S), Math.sin(t * 3) * 0.4);
  word3D(ctx, 'CLICK!', cx, y + h + Math.round(18 * S), { t, scale: 0.9 * S, pal: 'sun', wobble: 1.2 });
  void hs;
}

// Short message near the cursor (external callers: tutorial, overlay toasts) as a glass pill.
export function drawMessage(ctx, F, m) {
  const a = Math.min(1, (m.max - m.t) * 3);
  const x = F.input.x, y = Math.round(F.input.y - 44 - m.t * 12);
  ctx.save();
  ctx.globalAlpha = a;
  word3D(ctx, m.text, x, y, { t: m.t * 2, pop: clamp01(m.t * 6), scale: 0.6, pal: 'white', wobble: 0.6 }); // [phase9:fishing] 3D, not flat text
  ctx.restore();
}

// ------------------------------------------------------------------ the fight [simple24]
// In the scene: only the ink on the lens. Above everything: a soft frame, the fish's name, the meter + catch bar +
// SHOCK button (meter.js) and the 3D gear (gear.js, the spin control).
export function drawFightScene(ctx, F, B) {
  ensureIcons();
  ctx.save();
  ctx.globalAlpha = B.hudIn;
  drawInk(ctx, F);
  ctx.restore();
}

export function drawFightBands(ctx, F, B) {
  ensureIcons();
  ctx.save();
  ctx.globalAlpha = B.hudIn;
  drawEdges(ctx, F, B);
  if (!B.boss) drawNamePill(ctx, F, B, 10, 10); // a boss has its own bar
  ctx.restore();
  F.gear.draw(ctx, B, 1);
  drawMeter(ctx, F, B);
}

export function drawFightHud(ctx, F, B) {
  drawFightScene(ctx, F, B);
  drawFightBands(ctx, F, B);
}

// ------------------------------------------------------------------ edges: vignette, stun, strain
function drawEdges(ctx, F, B) {
  const W = F.W, H = F.H, t = F.t;
  const v = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.45, W / 2, H / 2, Math.max(W, H) * 0.75);
  v.addColorStop(0, 'rgba(190,240,255,0)');
  v.addColorStop(1, 'rgba(190,240,255,0.22)');
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, W, H);
  if (B.stunned) {
    const k = clamp01(B.stunT / B.stunMax);
    const fl = Math.floor(t * 20) % 3 === 0 ? 1.4 : 1;
    edgeTint(ctx, W, H, 1, 0, '127,244,255', 0.14 * k * fl);
    edgeTint(ctx, W, H, -1, 0, '127,244,255', 0.14 * k * fl);
  }
  if (B.beat) edgeTint(ctx, W, H, 0, 1, '255,226,122', 0.12 + 0.06 * Math.sin(t * 16));
  if (B.marker > 0.8) edgeTint(ctx, W, H, 1, 0, '255,79,94', (B.marker - 0.8) * 1.2 * (0.6 + 0.4 * Math.sin(t * 20)));
  if (B.marker < -0.8) edgeTint(ctx, W, H, -1, 0, '255,140,70', (-B.marker - 0.8) * 1.0 * (0.6 + 0.4 * Math.sin(t * 12)));
}

function edgeTint(ctx, W, H, dx, dy, rgb, a) {
  if (a <= 0.01) return;
  const band = Math.round(Math.min(W, H) * 0.2);
  const sides = [[dx, 'r'], [-dx, 'l'], [dy, 'b'], [-dy, 't']];
  for (const [w, s] of sides) {
    if (w <= 0.15) continue;
    const al = a * Math.min(1, w * 1.2);
    let g;
    if (s === 'r') { g = ctx.createLinearGradient(W, 0, W - band, 0); }
    else if (s === 'l') { g = ctx.createLinearGradient(0, 0, band, 0); }
    else if (s === 'b') { g = ctx.createLinearGradient(0, H, 0, H - band); }
    else { g = ctx.createLinearGradient(0, 0, 0, band); }
    g.addColorStop(0, `rgba(${rgb},${al})`);
    g.addColorStop(1, `rgba(${rgb},0)`);
    ctx.fillStyle = g;
    if (s === 'r') ctx.fillRect(W - band, 0, band, H);
    else if (s === 'l') ctx.fillRect(0, 0, band, H);
    else if (s === 'b') ctx.fillRect(0, H - band, W, band);
    else ctx.fillRect(0, 0, W, band);
  }
}

// ------------------------------------------------------------------ name pill
function drawNamePill(ctx, F, B, x, y) {
  const sp = F.sp, rar = RARITY[sp.rarity] || RARITY.common, t = F.t;
  const S = Math.max(1, F.H / 540);
  const w = Math.min(F.W * 0.5, sp.name.length * 13 * S + 30);
  const cy = y + Math.round(14 * S);
  word3D(ctx, sp.name, x + w / 2, cy, { t, scale: 0.8 * S, pal: glossFor(sp.rarity), wobble: 0.6 });
  const n = rar.stars || 1, gs = Math.round(12 * S);
  for (let i = 0; i < n; i++) {
    const g = gemIcon(rar.color || '#59c3ff', gs);
    if (g) ctx.drawImage(g, Math.round(x + w / 2 - (n * (gs + 2)) / 2 + i * (gs + 2)), Math.round(cy + 14 * S + Math.sin(t * 4 + i) * 1.5));
  }
  if (F.fish?.rec?.giant || B.heavy > 0) {
    const tag = F.fish?.rec?.giant ? 'GIANT' : `${Math.round(B.kg * 10) / 10} kg`;
    word3D(ctx, tag, x + w + 30 * S, cy, { t: t + 1, scale: 0.55 * S, pal: B.heavy > 0 ? 'red' : 'sun', wobble: 0.6 });
  }
}

// ------------------------------------------------------------------ ink splats on the "lens"
function drawInk(ctx, F) {
  for (const s of F.splats) {
    const k = s.t / s.max;
    const a = s.t < 0.15 ? s.t / 0.15 : 1 - Math.max(0, (k - 0.6) / 0.4);
    const r = Math.round(s.r * (s.t < 0.15 ? 0.6 + (s.t / 0.15) * 0.4 : 1));
    const spr = inkSplatSprite(r);
    ctx.globalAlpha = clamp01(a) * 0.92;
    ctx.drawImage(spr, Math.round(s.x - r), Math.round(s.y - r + k * 12));
    for (const d of s.drips) {
      ctx.fillStyle = '#0a0614';
      ctx.fillRect(Math.round(s.x + d.x), Math.round(s.y + r * 0.6), d.w, Math.round(d.l * k * 1.5 + 2));
    }
    ctx.globalAlpha = 1;
  }
}

// ------------------------------------------------------------------ angler cam porthole
export function drawAngler(ctx, F, x, y, o = {}) {
  const look = F.game.state?.character;
  try {
    return drawCharacter(ctx, x, y, { pose: o.pose || 'idle', t: o.t ?? F.t, facing: o.facing ?? 1, scale: o.scale || 1, look, fish: o.fish });
  } catch (e) {
    if (!F.charErr) { F.charErr = true; console.warn('drawCharacter failed', e); }
    return null;
  }
}

export { pixelLine, damp };
