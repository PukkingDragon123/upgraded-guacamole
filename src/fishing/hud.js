// Fight HUD (screen space), Frutiger Aero and nearly text-free:
//   bite   the big glossy "!" over the biting fish: bite-window ring, spin arrows, hook-set meter beads
//   scene  fish stamina arc, the directional surge QTE (glossy surge arrow at the fish, a big glossy
//          PULL arrow at the cursor that fills as you drag, hold-mouse glyph), the spin loop at the
//          cursor, species event visuals, ink on the lens
//   frame  soft Aero vignette, surge edge tint (and a green edge when you pull right), the big glossy name
//          pill, the round glass "angler cam" porthole, and the 3D gear (gear.js) with its rings and SHOCK.

import { TAU, clamp, clamp01, lerp, damp } from '../core/math.js';
import { rgba, RARITY } from '../core/color.js';
import { drawText, measureText, registerInlineIcon } from '../gfx/font.js';
import { getUiIcon } from '../gfx/uiicons.js';
import { makeCanvas, ctxOf } from '../core/canvas.js';
import { drawCharacter } from '../gfx/character.js';
import { discSprite, glowSprite, pixelLine, gbubbleSprite } from '../gfx/particles.js';
import { glossText, drawGlassPill, glossFor, word3D } from './cinematics.js';
import { drawIcon3d } from './icons3d.js'; // [phase9:fishing] 3D HUD icons, 3D voxel words
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

// ------------------------------------------------------------------ bite cue: a big glossy "!" bubble
// above the fish, a shrinking timer ring, spin arrows racing round it (green once the gear is in the hook band,
// gold dots for the hook-set meter) and the spin loop at the cursor. No words.
export function drawBiteCue(ctx, F) {
  const f = F.fish, hs = F.hs;
  const k = clamp01(F.biteT / Math.max(0.01, F.biteMax));
  const [sx, sy] = F.toScreen(f.x, f.y);
  const z = F.zoom();
  const t = F.t;
  const S = F.H / 540;
  const cx = Math.round(sx), cy = Math.round(sy - 22 * f.scale * z - 36 * S);
  const pop = 1 + Math.max(0, 0.35 - (1 - k) * 2.5) + Math.sin(t * 30) * 0.05;
  drawSpinLoop(ctx, F, hs?.inBand ? '#8be04a' : '#ffe27a');
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 0.55 + 0.3 * Math.sin(t * 20);
  ctx.drawImage(glowSprite(34, '#ffe27a'), cx - 34, cy - 34);
  ctx.restore();
  // timer ring
  const R = Math.round(28 * S), n = 80;
  for (let i = 0; i < n; i++) {
    const u = i / n;
    const a = -Math.PI / 2 + u * TAU;
    const on = u <= k;
    ctx.fillStyle = on ? (k < 0.35 ? '#ff6a5a' : '#ffe27a') : 'rgba(12,58,82,0.35)';
    ctx.fillRect(Math.round(cx + Math.cos(a) * R) - 1, Math.round(cy + Math.sin(a) * R) - 1, 3, 3);
  }
  // spin arrows chasing round the ring: the faster the gear, the faster they run
  const spin = F.gear.angle * -1, col = hs?.inBand ? '#8be04a' : '#ffffff';
  for (let j = 0; j < 3; j++) {
    const a0 = spin + (j * TAU) / 3;
    for (let i = 0; i < 7; i++) {
      const a = a0 - i * 0.07 * (F.gear.dir || 1);
      const rr = R + 6 * S;
      ctx.fillStyle = INK;
      ctx.fillRect(Math.round(cx + Math.cos(a) * rr) - 2, Math.round(cy + Math.sin(a) * rr) - 2, i ? 4 : 6, i ? 4 : 6);
      ctx.fillStyle = rgba(col, 1 - i / 8);
      ctx.fillRect(Math.round(cx + Math.cos(a) * rr) - 1, Math.round(cy + Math.sin(a) * rr) - 1, i ? 2 : 4, i ? 2 : 4);
    }
  }
  // hook-set meter: gold beads filling the inside of the ring
  if (hs) {
    const m = Math.round(hs.set * 16);
    for (let i = 0; i < 16; i++) {
      const a = -Math.PI / 2 + (i / 16) * TAU, rr = R - 7 * S;
      ctx.fillStyle = i < m ? '#ffd23a' : 'rgba(255,255,255,0.25)';
      ctx.fillRect(Math.round(cx + Math.cos(a) * rr) - 1, Math.round(cy + Math.sin(a) * rr) - 1, 3, 3);
    }
  }
  const br = Math.round(18 * S);
  const b = gbubbleSprite(br);
  ctx.drawImage(b, cx - br, cy - br);
  word3D(ctx, '!', cx, cy, { t, scale: 2.2 * S * pop, pal: hs?.inBand ? 'lime' : 'sun', wobble: 1.5, depth: 6 });
}

// The player's spin loop at the cursor: a glossy dotted circle that follows the crank centre.
function drawSpinLoop(ctx, F, col) {
  const cr = F.crank, t = F.t;
  if (!cr.active) {
    const gr = Math.round(18 * (F.H / 540));
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * TAU + t * 6;
      ctx.fillStyle = rgba(INK, 0.4);
      ctx.fillRect(Math.round(F.input.x + Math.cos(a) * gr) - 2, Math.round(F.input.y + Math.sin(a) * gr) - 2, 4, 4);
      ctx.fillStyle = rgba(col, 0.15 + (i / 14) * 0.8);
      ctx.fillRect(Math.round(F.input.x + Math.cos(a) * gr) - 1, Math.round(F.input.y + Math.sin(a) * gr) - 1, 3, 3);
    }
    return;
  }
  const R = Math.round(clamp(cr.radius, 10, 70));
  const n = Math.max(24, R * 2);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    ctx.fillStyle = rgba(col, i % 2 ? 0.25 : 0.6);
    ctx.fillRect(Math.round(cr.cx + Math.cos(a) * R), Math.round(cr.cy + Math.sin(a) * R), 2, 2);
  }
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

// ------------------------------------------------------------------ in-scene markers
export function drawFightScene(ctx, F, B) {
  ensureIcons();
  ctx.save();
  ctx.globalAlpha = B.hudIn;
  if (!B.event) drawStaminaArc(ctx, F, B);
  if (!B.event || B.event.usesCrank) drawCrankLoop(ctx, F, B);
  drawQte(ctx, F, B);
  if (B.trick?.kind === 'wrap') drawWrapHint(ctx, F, B);
  if (B.event) B.event.drawHud(ctx);
  drawInk(ctx, F);
  ctx.restore();
}

// Overlay frame and the reel (drawn above everything in the scene).
export function drawFightBands(ctx, F, B) {
  ensureIcons();
  ctx.save();
  ctx.globalAlpha = B.hudIn;
  drawEdges(ctx, F, B);
  if (!B.boss) drawNamePill(ctx, F, B, 10, 10); // a boss has its own bar
  drawAnglerCam(ctx, F, B);
  ctx.restore();
  F.gear.draw(ctx, B, 1); // the gear keeps its own slide-in (it is already up from the hook-set)
}

export function drawFightHud(ctx, F, B) {
  drawFightScene(ctx, F, B);
  drawFightBands(ctx, F, B);
}

// ------------------------------------------------------------------ stamina arc above the fish
function drawStaminaArc(ctx, F, B) {
  const f = F.fish;
  if (!f || B.mode === 'hookset') return;
  const [sx, sy] = F.toScreen(f.x, f.y);
  const R = Math.round(clamp(F.zoneRadius() * 0.72, 30, 120));
  const a0 = Math.PI * 1.15, a1 = Math.PI * 1.85;
  const k = clamp01(B.stamina);
  const n = Math.round(R * (a1 - a0) * 0.9);
  const t = F.t;
  const ex = B.exhausted;
  const fillCol = ex ? (Math.floor(t * 6) % 2 ? '#ffe27a' : '#fff6c0') : B.stunned ? '#9ff4ff' : k < 0.3 ? '#ff5a4a' : '#ff9d2e';
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    const a = a0 + (a1 - a0) * u;
    const on = u <= k;
    for (let r = R - 2; r <= R + 2; r++) {
      const x = Math.round(sx + Math.cos(a) * r), y = Math.round(sy + Math.sin(a) * r);
      ctx.fillStyle = r === R - 2 || r === R + 2 ? rgba(INK, 0.55) : on ? (r === R + 1 ? '#fff6e0' : fillCol) : 'rgba(220,245,255,0.35)';
      ctx.fillRect(x, y, 1, 1);
    }
  }
  // fish icon at the start of the arc
  const fic = voxelFishIcon(F.sp, 26, 16, { dir: -1 });
  if (fic) ctx.drawImage(fic, Math.round(sx + Math.cos(a0) * R - fic.width - 1), Math.round(sy + Math.sin(a0) * R - fic.height / 2));
  if (ex && Math.random() < 0.15) F.fx.glint?.(sx + Math.cos(a0 + Math.random()) * R, sy + Math.sin(a0 + Math.random()) * R, { color: '#ffe27a' });
}

// ------------------------------------------------------------------ spin loop at the cursor
function drawCrankLoop(ctx, F, B) {
  if (B.qte?.active && B.qte.holding) return;
  const st = B.crankState();
  drawSpinLoop(ctx, F, st === 'sweet' ? '#8be04a' : st === 'over' ? '#ff9d2e' : '#8ff0ff');
}

// ------------------------------------------------------------------ directional QTE
function drawQte(ctx, F, B) {
  const q = B.qte, f = F.fish;
  if (!q || !f) return;
  const t = F.t;
  const [sx, sy] = F.toScreen(f.x, f.y);
  if (q.active) {
    const tele = B.mode === 'tele';
    const surgeA = q.dir, pullA = q.dir + Math.PI;
    const appear = clamp01(q.t * 5);
    const flip = q.flip;
    // surge arrow out of the fish (where it is going)
    const R0 = clamp(F.zoneRadius() * 0.55, 22, 90);
    const blink = tele && Math.floor(t * 10) % 2;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.35 + 0.25 * Math.sin(t * 14);
    const gx = sx + Math.cos(surgeA) * (R0 + 26), gy = sy + Math.sin(surgeA) * (R0 + 26);
    ctx.drawImage(glowSprite(26, '#ff6a3a'), Math.round(gx - 26), Math.round(gy - 26));
    ctx.restore();
    const S = Math.max(1, F.H / 540);
    drawGlossArrow(ctx, sx + Math.cos(surgeA) * R0, sy + Math.sin(surgeA) * R0, surgeA, { len: (54 * appear + 4) * S, w: 15 * S, kind: 'surge', alpha: blink ? 0.6 : 0.95 });
    // the PULL arrow at the cursor: drag along it while holding the button
    const L = Math.round(112 * S), W = Math.round(26 * S);
    const ax = F.input.x - Math.cos(pullA) * (q.holding ? q.k * 10 : 0), ay = F.input.y - Math.sin(pullA) * (q.holding ? q.k * 10 : 0);
    const off = 16;
    const tx = clamp(ax + Math.cos(pullA) * off, 20, F.W - 20), ty = clamp(ay + Math.sin(pullA) * off, 20, F.H - 20);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = (q.holding ? 0.55 : 0.3) + 0.2 * Math.sin(t * 10) + flip * 0.5;
    const hx = tx + Math.cos(pullA) * L * 0.6, hy = ty + Math.sin(pullA) * L * 0.6;
    ctx.drawImage(glowSprite(40, q.holding ? '#8be04a' : '#59c3ff'), Math.round(hx - 40), Math.round(hy - 40));
    ctx.restore();
    const shake = flip > 0 ? Math.round(Math.sin(t * 60) * flip * 3) : 0;
    drawGlossArrow(ctx, tx + shake, ty, pullA, { len: L * (0.6 + 0.4 * appear), w: W, k: q.k, kind: 'pull', emptyAlpha: 0.78 });
    // hold glyph by the tail, nudging along the arrow
    const nud = (t * 1.6) % 1;
    const mxp = tx - Math.cos(pullA) * 14 + Math.cos(pullA) * nud * 14 * (q.holding ? 0 : 1), myp = ty - Math.sin(pullA) * 14 + Math.sin(pullA) * nud * 14 * (q.holding ? 0 : 1);
    drawIcon3d(ctx, q.holding || Math.floor(t * 4) % 2 === 0 ? 'mouse_lit' : 'mouse', mxp, myp, 22, Math.sin(t * 3) * 0.5);
    if (q.holding && q.k > 0.05 && Math.random() < 0.4) {
      const u = q.k * L;
      F.fx.glint?.(tx + Math.cos(pullA) * u, ty + Math.sin(pullA) * u, { color: '#e2ffb0', len: 4 });
    }
  } else if (q.win && q.t < 0.6) {
    // a quick ring burst where the arrow was
    const k = q.t / 0.6;
    ctx.save();
    ctx.globalAlpha = 1 - k;
    const S = Math.max(1, F.H / 540);
    drawGlossArrow(ctx, F.input.x, F.input.y, q.dir + Math.PI, { len: (112 + k * 40) * S, w: 26 * S, k: 1, kind: q.stunned ? 'ok' : 'pull' });
    ctx.restore();
  }
}

function drawWrapHint(ctx, F, B) {
  const tr = B.trick, L = F.reel.lay;
  if (!L) return;
  const cx = L.cx, cy = L.cy, R = L.R + 20, t = F.t;
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * TAU + t * 3 * tr.dir;
    const x = cx + Math.cos(a) * R, y = cy + Math.sin(a) * R;
    const ta = a + (Math.PI / 2) * tr.dir;
    ctx.fillStyle = INK;
    ctx.fillRect(Math.round(x) - 2, Math.round(y) - 2, 4, 4);
    ctx.fillStyle = (i / 10) < tr.unwound / tr.need ? '#8be04a' : '#ffe27a';
    ctx.fillRect(Math.round(x) - 1, Math.round(y) - 1, 2, 2);
    ctx.fillRect(Math.round(x + Math.cos(ta) * 2), Math.round(y + Math.sin(ta) * 2), 1, 1);
  }
}

// ------------------------------------------------------------------ edges: vignette + surge tint
function drawEdges(ctx, F, B) {
  const W = F.W, H = F.H, t = F.t;
  // soft Aero vignette: pale aqua corners
  const v = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.45, W / 2, H / 2, Math.max(W, H) * 0.75);
  v.addColorStop(0, 'rgba(190,240,255,0)');
  v.addColorStop(1, 'rgba(190,240,255,0.26)');
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, W, H);
  const q = B.qte;
  if (q?.active) {
    // the surge pulls the light toward its side; a winning pull glows green on the other side
    const dx = Math.cos(q.dir), dy = Math.sin(q.dir);
    const pulse = 0.6 + 0.4 * Math.sin(t * 10);
    const a = (B.mode === 'surge' ? 0.3 : 0.16) * pulse * (1 - q.k * 0.7);
    edgeTint(ctx, W, H, dx, dy, '255,140,70', a);
    if (q.holding && q.k > 0.02) edgeTint(ctx, W, H, -dx, -dy, '160,236,90', 0.12 + q.k * 0.3);
  }
  if (B.stunned) {
    const k = clamp01(B.stunT / B.stunMax);
    const fl = Math.floor(t * 20) % 3 === 0 ? 1.4 : 1;
    edgeTint(ctx, W, H, 1, 0, '127,244,255', 0.16 * k * fl);
    edgeTint(ctx, W, H, -1, 0, '127,244,255', 0.16 * k * fl);
    edgeTint(ctx, W, H, 0, 1, '255,240,122', 0.08 * k * fl);
  }
  if (B.tension > 0.92) {
    const a = Math.min(0.28, (B.tension - 0.92) * 2.2) * (0.6 + 0.4 * Math.sin(t * 20));
    edgeTint(ctx, W, H, 0, 1, '255,79,94', a);
    edgeTint(ctx, W, H, 0, -1, '255,79,94', a * 0.6);
  }
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
  // [phase9:fishing] the name as 3D voxel letters with spinning rarity gems (no flat pill text, no pixel stars)
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

function portholeRing(r) {
  return cached('port' + r, r * 2 + 9, r * 2 + 9, (g) => {
    const C = r + 4;
    for (let y = 0; y < r * 2 + 9; y++) for (let x = 0; x < r * 2 + 9; x++) {
      const dx = x - C, dy = y - C, d = Math.hypot(dx, dy);
      if (d < r - 0.5 || d > r + 4.3) continue;
      const u = (d - r) / 4.3;
      const lit = -(dx + dy) / Math.max(1, d);
      let col;
      if (u > 0.82 || u < 0.12) col = INK;
      else if (lit > 0.4 && u < 0.5) col = '#ffffff';
      else if (lit > -0.2) col = '#b4d0e2';
      else col = '#7fa4bc';
      g.fillStyle = col;
      g.fillRect(x, y, 1, 1);
    }
  });
}

function drawAnglerCam(ctx, F, B) {
  const t = F.t;
  const r = Math.round(clamp(F.H * 0.11, 34, 80));
  const cx = r + 14, cy = F.H - r - 14;
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.clip();
  const biome = F.world.biome;
  const dark = biome === 'abyss';
  const sky = ctx.createLinearGradient(0, cy - r, 0, cy + r);
  sky.addColorStop(0, dark ? '#0a1028' : '#59c3ff');
  sky.addColorStop(0.6, dark ? '#1e2a50' : '#bfeaff');
  sky.addColorStop(0.61, dark ? '#0a1a3a' : '#1fb8dc');
  sky.addColorStop(1, dark ? '#06101e' : '#0d8fb5');
  ctx.fillStyle = sky; ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  // sun + hill
  if (!dark) {
    ctx.drawImage(glowSprite(10, '#fffbe0'), cx + r - 26, cy - r + 6);
    ctx.fillStyle = '#8be04a';
    for (let x = -r; x <= r; x++) { const h = Math.round(6 + Math.cos((x + t * 3) * 0.05) * 3); ctx.fillRect(cx + x, cy + r * 0.2 - h, 1, h); }
  }
  const wl = Math.round(cy + r * 0.2);
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  for (let i = -r; i < r; i += 7) ctx.fillRect(cx + ((i + Math.floor(t * 12) + r) % (2 * r)) - r, wl + Math.round(Math.sin(t * 3 + i) * 0.8), 3, 1);
  // pose from what the player is doing
  let pose = 'reel';
  if (B.event?.name === 'mash' || F.poseHold?.pose === 'yank') pose = 'yank';
  else if (B.qte?.holding || B.surging) pose = 'pull';
  else if (F.gear.p < 0.08) pose = 'idle';
  const bob = Math.round(Math.sin(t * 2.2));
  ctx.fillStyle = '#ffffff'; ctx.fillRect(cx - r, wl - 2 + bob, r * 2, 3);
  ctx.fillStyle = '#59c3ff'; ctx.fillRect(cx - r, wl + 1 + bob, r * 2, 2);
  const anchors = drawAngler(ctx, F, cx - 6, wl - 1 + bob, { pose, t, facing: 1 });
  const rt = anchors?.rodTip || [cx + 16, wl - 30];
  const T = B.tension;
  const col = T > 0.88 ? '#ff6a5a' : T > 0.7 ? '#ffd25a' : '#ffffff';
  ctx.fillStyle = col;
  const ex = cx + r, ey = cy + r * 0.7;
  const vib = T > 0.8 ? Math.sin(t * 60) * 1.2 : 0;
  for (let i = 0; i <= 30; i++) {
    const k = i / 30;
    ctx.fillRect(Math.round(lerp(rt[0], ex, k)), Math.round(lerp(rt[1], ey, k) + Math.sin(k * Math.PI) * ((1 - clamp01(T)) * 8 + vib)), 1, 1);
  }
  // glass gloss
  ctx.fillStyle = 'rgba(255,255,255,0.22)';
  ctx.beginPath(); ctx.ellipse(cx - r * 0.25, cy - r * 0.5, r * 0.62, r * 0.3, -0.35, 0, TAU); ctx.fill();
  ctx.restore();
  const ring = portholeRing(r);
  ctx.drawImage(ring, cx - r - 4, cy - r - 4);
  // live dot
  if (Math.floor(t * 2) % 2) { ctx.fillStyle = INK; ctx.fillRect(cx + r - 9, cy - r + 5, 5, 5); ctx.fillStyle = '#ff4f5e'; ctx.fillRect(cx + r - 8, cy - r + 6, 3, 3); }
}

export { pixelLine, damp };
