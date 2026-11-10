// Fight HUD (phase 9: simple and clear). Big, readable, near the action, screen space:
//   bite     a huge glossy "!" over the fish with a shrinking timer bar and CLICK!
//   panel    bottom centre, over the cinema bar: the catch track (the fish swimming toward your hook), ONE big
//            TENSION bar (green / yellow / RED: a snap is coming), the reel you crank by circling (left) and the
//            SHOCK orb (right: charges, fills while you hold, LET GO! when full)
//   callouts big glossy words over the fish: REEL! / ! (it braces) / EASE OFF! (it pulls) / NICE! / ZAPPED!
//   tips     short animated hints on the first few fights (circle to reel, ease off on red, hold + release to zap)
//   edges    a red pulse at the screen edges while the line is in the red; ink on the lens
//
// Exports: drawBiteCue(ctx, F), drawFightScene(ctx, F, B) (under the cinema bars), drawFightHud(ctx, F, B) (over
// them), drawPanel(ctx, F, o), drawMessage, drawAngler, drawBigArrow, drawInk, inkSplatSprite, panelRect(F).

import { TAU, clamp, clamp01, lerp, damp, ease } from '../core/math.js';
import { rgba } from '../core/color.js';
import { drawText, measureText } from '../gfx/font.js';
import { getUiIcon } from '../gfx/uiicons.js';
import { drawCharacter } from '../gfx/character.js';
import { discSprite, glowSprite, pixelLine, gbubbleSprite } from '../gfx/particles.js';
import { voxelFishIcon } from '../fish/fishicon.js';
import { drawAeroSurface, drawGlossOrb } from '../ui/aero.js';
import { glossText, drawGlassPill } from './cinematics.js';
import { RED } from './battle.js';

const INK = '#0c3a52';

export function inkSplatSprite(r) { return discSprite(r, '#0a0614', 0.35, '#1a1030'); }

const gloss = (ctx, text, x, y, scale, pal, o = {}) => {
  const g = glossText(text, scale, pal);
  const k = o.k ?? 1;
  ctx.save();
  if (o.alpha !== undefined) ctx.globalAlpha *= o.alpha;
  ctx.translate(Math.round(x), Math.round(y));
  if (k !== 1) ctx.scale(k, k);
  ctx.drawImage(g.c, Math.round(-g.w / 2 - g.ox), Math.round(-g.h / 2 - g.oy));
  ctx.restore();
  return g;
};

// ------------------------------------------------------------------ big glossy arrow (fill k 0..1)
// Tail at (x, y), pointing along ang, len px. Drawn with axis-aligned pixel rows (crisp at any angle step of 90).
export function drawBigArrow(ctx, x, y, ang, len, col, k = 1) {
  const right = Math.cos(ang) >= 0;
  const hw = Math.max(5, Math.round(len * 0.11)), hh = Math.max(9, Math.round(len * 0.22)), head = Math.max(10, Math.round(len * 0.28));
  const x0 = Math.round(x), y0 = Math.round(y);
  const sx = right ? 1 : -1;
  const fillTo = Math.round(len * clamp01(k));
  const col2 = '#ffffff';
  for (const pass of [0, 1, 2]) {
    for (let i = 0; i <= len; i++) {
      const w = i < len - head ? hw : Math.round(hh * (len - i) / head);
      if (w <= 0) continue;
      const px = x0 + sx * i;
      if (pass === 0) { ctx.fillStyle = INK; ctx.fillRect(px - 1, y0 - w - 1, 3, w * 2 + 3); continue; }
      if (pass === 1) {
        ctx.fillStyle = i <= fillTo ? col : 'rgba(255,255,255,0.35)';
        ctx.fillRect(px, y0 - w, 1, w * 2 + 1);
      } else if (i <= fillTo) {
        ctx.fillStyle = rgba(col2, 0.55);
        ctx.fillRect(px, y0 - w + 1, 1, Math.max(1, Math.round(w * 0.6)));
      }
    }
  }
}

// ------------------------------------------------------------------ the bite: a huge "!"
export function drawBiteCue(ctx, F) {
  const f = F.fish, bt = F.bite;
  if (!f || !bt) return;
  const k = bt.timeK;
  const [sx, sy] = F.toScreen(f.x, f.y);
  const t = F.t;
  const len = F.fishLen() * F.zoom();
  const cx = Math.round(clamp(sx, 60, F.W - 60)), cy = Math.round(clamp(sy - len * 0.35 - 52, 70, F.H - 120));
  const age = bt.t;
  const pop = ease.outBack(clamp01(age * 5)) * (1 + Math.max(0, Math.sin(t * 18)) * 0.06);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 0.5 + 0.3 * Math.sin(t * 20);
  ctx.drawImage(glowSprite(46, '#ffe27a'), cx - 46, cy - 46);
  ctx.restore();
  const br = 26;
  const b = gbubbleSprite(br);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(pop, pop);
  ctx.drawImage(b, -br, -br);
  ctx.restore();
  gloss(ctx, '!', cx, cy + 2, 8, k < 0.35 ? 'red' : 'sun', { k: pop });
  // the window: a bar that runs out
  const w = 70, h = 6, bx = cx - w / 2, by = cy + br + 8;
  ctx.fillStyle = INK; ctx.fillRect(bx - 1, by - 1, w + 2, h + 2);
  ctx.fillStyle = '#1c4a68'; ctx.fillRect(bx, by, w, h);
  ctx.fillStyle = k < 0.35 ? '#ff6a5a' : '#ffd23a'; ctx.fillRect(bx, by, Math.round(w * k), h);
  ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.fillRect(bx, by, Math.round(w * k), 2);
  // CLICK! with a mouse glyph
  const blink = Math.floor(t * 8) % 2;
  const g = gloss(ctx, 'CLICK!', cx + 8, by + h + 16, 3, blink ? 'sun' : 'aqua');
  const m = getUiIcon('mouse_l', 2);
  if (m) ctx.drawImage(m, Math.round(cx + 8 - g.w / 2 - m.width - 6), Math.round(by + h + 16 - m.height / 2 + (blink ? 1 : 0)));
}

// ------------------------------------------------------------------ ink on the lens
export function drawInk(ctx, F) {
  for (const s of F.splats) {
    const k = s.t / s.max;
    const a = s.t < 0.15 ? s.t / 0.15 : 1 - Math.max(0, (k - 0.6) / 0.4);
    const r = Math.round(s.r * (s.t < 0.15 ? 0.6 + (s.t / 0.15) * 0.4 : 1));
    const spr = inkSplatSprite(r);
    ctx.globalAlpha = clamp01(a) * 0.94;
    ctx.drawImage(spr, Math.round(s.x - r), Math.round(s.y - r + k * 12));
    for (const d of s.drips) {
      ctx.fillStyle = '#0a0614';
      ctx.fillRect(Math.round(s.x + d.x), Math.round(s.y + r * 0.6), d.w, Math.round(d.l * k * 1.5 + 2));
    }
    ctx.globalAlpha = 1;
  }
}

// ------------------------------------------------------------------ under the cinema bars: edges, ink, callouts
export function drawFightScene(ctx, F, B) {
  const W = F.W, H = F.H, t = F.t;
  // red pulse at the edges while the line is in the red
  const T = B.tension;
  if (T >= RED - 0.04) {
    const a = clamp01((T - RED + 0.04) * 4) * (0.35 + 0.25 * Math.sin(t * 14));
    edgeGlow(ctx, W, H, '#ff3a3a', a);
  } else if (B.stunned) edgeGlow(ctx, W, H, '#7ff4ff', 0.12 + 0.06 * Math.sin(t * 20));
  drawInk(ctx, F);
  drawCallouts(ctx, F, B);
}

function edgeGlow(ctx, W, H, col, a) {
  if (a <= 0.01) return;
  const n = 18;
  for (let i = 0; i < n; i++) {
    const k = 1 - i / n;
    ctx.fillStyle = rgba(col, a * k * k * 0.6);
    ctx.fillRect(0, i * 2, W, 2); ctx.fillRect(0, H - i * 2 - 2, W, 2);
    ctx.fillRect(i * 2, 0, 2, H); ctx.fillRect(W - i * 2 - 2, 0, 2, H);
  }
}

// What the big word over the fish says right now.
function callout(F, B) {
  const reeling = B.reel > 0.2;
  if (B.boss && B.boss.stage !== 'fight') return null;
  if (B.boss?.atk?.kind === 'charge') return null;
  if (B.stunned) return { text: B.stunT > B.stunMax - 0.6 ? 'ZAPPED!' : 'REEL!', pal: B.stunT > B.stunMax - 0.6 ? 'aqua' : 'lime', shake: 0 };
  switch (B.mode) {
    case 'hookset': return null;
    case 'warn': return { text: '!', pal: 'sun', big: true, shake: 2 };
    case 'pull': return reeling || B.tension >= RED ? { text: 'EASE OFF!', pal: 'red', shake: 3 } : { text: 'LET IT RUN', pal: 'aqua', shake: 0 };
    case 'tired': return { text: 'REEL!', pal: 'lime', shake: 0, pump: true };
    default: return !reeling && B.t > 1 ? { text: 'REEL!', pal: 'lime', shake: 0, soft: true } : null;
  }
}

function drawCallouts(ctx, F, B) {
  const f = B.fish, t = F.t;
  const c = callout(F, B);
  const key = c ? c.text : '';
  if (key !== F.calloutKey) { F.calloutKey = key; F.calloutT = 0; }
  F.calloutT = (F.calloutT || 0) + F.rdt;
  if (!c) return;
  const [sx, sy] = F.toScreen(f.x, f.y);
  const len = F.fishLen() * F.zoom();
  const cx = clamp(sx, 90, F.W - 90), cy = clamp(sy - len * 0.32 - 34, 76, F.H - 150);
  const pop = ease.outBack(clamp01(F.calloutT * 6));
  const pump = c.pump ? 1 + Math.max(0, Math.sin(t * 10)) * 0.1 : 1;
  const sh = c.shake ? Math.round(Math.sin(t * 60) * c.shake) : 0;
  const alpha = c.soft ? 0.55 + 0.35 * Math.sin(t * 4) : 1;
  gloss(ctx, c.text, cx + sh, cy, c.big ? 9 : 4, c.pal, { k: pop * pump, alpha });
}

// ------------------------------------------------------------------ the panel
export function panelRect(F) {
  const W = F.W, H = F.H;
  const w = Math.round(Math.min(W - 40, 470)), h = 70;
  return { x: Math.round(W / 2 - w / 2), y: H - h - 8, w, h };
}

// Over the cinema bars: the panel, the tips and the boss layer.
export function drawFightHud(ctx, F, B) {
  const k = ease.outCubic(clamp01(B.hudIn));
  drawPanel(ctx, F, {
    k, progress: B.boss ? null : B.progress, ghost: B.ghost, tension: B.tension, reel: B.reel, red: B.tension >= RED,
    pulling: B.mode === 'pull', warn: B.mode === 'warn', stunned: B.stunned, charges: B.charges, shockMax: B.shockMax,
    shockCd: B.shockCd, shockCdMax: B.shockCdMax, charge: B.charge?.k ?? null, canCharge: B.canCharge, snap: clamp01(B.snapT / Math.max(0.1, B.grace)),
    sp: B.sp, flash: B.flash,
  });
  drawTips(ctx, F, B);
}

// o: {k, progress (null = hide the catch track), ghost, tension, reel, red, pulling, warn, stunned, charges, shockMax,
//     shockCd, shockCdMax, charge (0..1 | null), canCharge, snap (0..1), sp, flash, box (no shock orb)}
export function drawPanel(ctx, F, o) {
  const R = panelRect(F), t = F.t;
  const slide = Math.round((1 - o.k) * 110);
  const x = R.x, y = R.y + slide, w = R.w, h = R.h;
  ctx.save();
  // glass plate
  drawAeroSurface(ctx, x, y, w, h, { tone: 'dark', r: 14, gloss: 0.32, glossH: 16, rim: 0.7, glow: 0.45 });
  // ---- the reel (left): a spool you crank by circling
  const rx = x + 34, ry = y + h / 2;
  F.reelAng = (F.reelAng || 0) + F.rdt * (o.reel || 0) * 14;
  drawReel(ctx, rx, ry, 22, F.reelAng, o.reel || 0, t);
  // ---- bars
  const bx = x + 66, bw = w - (o.box ? 82 : 132);
  const ty = y + (o.progress === null || o.progress === undefined ? 20 : 30), th = 24;
  if (o.progress !== null && o.progress !== undefined) drawTrack(ctx, F, bx, y + 10, bw, 12, o);
  drawTension(ctx, bx, ty, bw, th, o, t);
  // ---- shock (right)
  if (!o.box) drawShockOrb(ctx, F, x + w - 34, y + h / 2, o, t);
  ctx.restore();
}

function drawReel(ctx, cx, cy, r, ang, reel, t) {
  cx = Math.round(cx); cy = Math.round(cy);
  // glow while reeling
  if (reel > 0.2) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.25 * reel;
    ctx.drawImage(glowSprite(r + 10, '#8be04a'), cx - r - 10, cy - r - 10);
    ctx.restore();
  }
  drawGlossOrb(ctx, cx, cy, r, reel > 0.2 ? '#6cd03a' : '#59c3ff', t);
  // the spool: line wraps
  ctx.fillStyle = INK; ctx.fillRect(cx - 9, cy - 9, 18, 18);
  ctx.fillStyle = '#e8f6fc'; ctx.fillRect(cx - 8, cy - 8, 16, 16);
  for (let i = 0; i < 7; i++) { ctx.fillStyle = i % 2 ? '#7fd8f4' : '#bff0ff'; ctx.fillRect(cx - 7, cy - 7 + i * 2, 14, 2); }
  // spokes + handle knob, turning
  for (let s = 0; s < 3; s++) {
    const a = ang + (s * TAU) / 3;
    for (let i = 3; i < 13; i++) { ctx.fillStyle = INK; ctx.fillRect(Math.round(cx + Math.cos(a) * i) - 1, Math.round(cy + Math.sin(a) * i) - 1, 2, 2); }
  }
  const hx = Math.round(cx + Math.cos(ang) * 14), hy = Math.round(cy + Math.sin(ang) * 14);
  ctx.fillStyle = INK; ctx.fillRect(hx - 4, hy - 4, 8, 8);
  ctx.fillStyle = '#ffd23a'; ctx.fillRect(hx - 3, hy - 3, 6, 6);
  ctx.fillStyle = '#fff6c0'; ctx.fillRect(hx - 3, hy - 3, 3, 2);
  ctx.fillStyle = INK; ctx.fillRect(cx - 2, cy - 2, 4, 4);
  // speed arcs
  if (reel > 0.15) {
    for (let j = 0; j < 2; j++) {
      const a0 = ang * 0.7 + j * Math.PI;
      for (let i = 0; i < 8; i++) {
        const a = a0 - i * 0.12;
        ctx.fillStyle = rgba('#ffffff', reel * (0.8 - i * 0.09));
        ctx.fillRect(Math.round(cx + Math.cos(a) * (r + 4)) - 1, Math.round(cy + Math.sin(a) * (r + 4)) - 1, 2, 2);
      }
    }
  }
}

// The catch track: a thin glass lane, your hook at the right end, the fish swimming toward it.
function drawTrack(ctx, F, x, y, w, h, o) {
  const p = clamp01(o.progress), g = clamp01(o.ghost ?? p);
  ctx.fillStyle = INK; ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
  ctx.fillStyle = '#123a56'; ctx.fillRect(x, y, w, h);
  ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fillRect(x, y, w, 3);
  const fw = Math.round(w * p);
  if (g > p) { ctx.fillStyle = '#ff6a5a'; ctx.fillRect(x + fw, y, Math.round(w * (g - p)), h); }
  ctx.fillStyle = '#2fd3e8'; ctx.fillRect(x, y, fw, h);
  ctx.fillStyle = '#9ff4ff'; ctx.fillRect(x, y, fw, 3);
  // bubbles in the lane
  for (let i = 0; i < 6; i++) {
    const u = ((F.t * 0.12 + i / 6) % 1);
    if (u < p) { ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.fillRect(Math.round(x + u * w), y + 4 + (i % 3) * 2, 1, 1); }
  }
  // the hook at the end
  const hk = getUiIcon('hook');
  if (hk) ctx.drawImage(hk, Math.round(x + w - hk.width / 2), Math.round(y + h / 2 - hk.height / 2));
  // the fish riding the lane
  const fi = o.icon || (o.sp ? voxelFishIcon(o.sp, 30, 20, { dir: 1 }) : null);
  const fx = Math.round(x + fw), fy = Math.round(y + h / 2);
  if (fi) ctx.drawImage(fi, fx - Math.round(fi.width / 2), fy - Math.round(fi.height / 2) + Math.round(Math.sin(F.t * 8) * (o.pulling ? 2 : 1)));
  else { ctx.fillStyle = '#ffd23a'; ctx.fillRect(fx - 3, fy - 3, 6, 6); }
}

// THE tension bar. Green safe, yellow tight, red: a snap is coming.
function drawTension(ctx, x, y, w, h, o, t) {
  const T = clamp01(o.tension);
  const red = o.red;
  const shake = red ? Math.round(Math.sin(t * 70) * 2) : 0;
  x += shake;
  // track with the three zones
  ctx.fillStyle = INK; ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
  const zG = Math.round(w * 0.6), zR = Math.round(w * RED);
  ctx.fillStyle = '#1d4a2a'; ctx.fillRect(x, y, zG, h);
  ctx.fillStyle = '#4a4218'; ctx.fillRect(x + zG, y, zR - zG, h);
  ctx.fillStyle = '#4a1a22'; ctx.fillRect(x + zR, y, w - zR, h);
  // the fill
  const fw = Math.round(w * T);
  const col = T >= RED ? '#ff4f5e' : T >= 0.6 ? '#ffd23a' : '#6cd03a';
  const hi = T >= RED ? '#ffb0a8' : T >= 0.6 ? '#fff2a0' : '#c8f56a';
  const lo = T >= RED ? '#b8202e' : T >= 0.6 ? '#d89a1a' : '#3a9a24';
  if (fw > 0) {
    ctx.fillStyle = col; ctx.fillRect(x, y, fw, h);
    ctx.fillStyle = hi; ctx.fillRect(x, y + 2, fw, Math.round(h * 0.28));
    ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.fillRect(x, y + 3, fw, 1);
    ctx.fillStyle = lo; ctx.fillRect(x, y + h - 4, fw, 4);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(x + fw - 2, y, 2, h);
  }
  if (red && Math.floor(t * 12) % 2) { ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fillRect(x, y, w, h); }
  // zone ticks
  ctx.fillStyle = INK; ctx.fillRect(x + zG, y, 1, h); ctx.fillRect(x + zR - 1, y, 2, h);
  // the snap meter: the red end cracks open as the line is about to go
  const sk = getUiIcon('skull', 2);
  if (sk) {
    const jig = red ? Math.round(Math.sin(t * 50) * 1) : 0;
    ctx.save();
    ctx.globalAlpha = red ? 1 : 0.55;
    ctx.drawImage(sk, Math.round(x + w - sk.width - 3 + jig), Math.round(y + h / 2 - sk.height / 2));
    ctx.restore();
  }
  if (o.snap > 0.02) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x + zR + 1, y + h - 3, Math.round((w - zR - 2) * o.snap), 2);
  }
  // label
  const label = red ? 'TOO TIGHT!' : o.pulling ? 'PULLING!' : 'TENSION';
  const lc = red ? '#ffb0a8' : o.pulling ? '#ffd0b0' : '#bfeaff';
  drawText(ctx, label, x + 6, y + Math.round(h / 2) - 3, { color: lc, outline: INK });
}

function drawShockOrb(ctx, F, cx, cy, o, t) {
  cx = Math.round(cx); cy = Math.round(cy);
  const r = 22;
  const ch = o.charge;
  const ready = o.canCharge && o.charges > 0;
  const col = ch !== null ? (ch >= 1 ? '#fff07a' : '#ffd23a') : ready ? '#59c3ff' : '#7a8a98';
  if (ch !== null || ready) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = ch !== null ? 0.35 + ch * 0.4 : 0.15 + 0.08 * Math.sin(t * 4);
    ctx.drawImage(glowSprite(r + 12, ch !== null ? '#fff07a' : '#7ff4ff'), cx - r - 12, cy - r - 12);
    ctx.restore();
  }
  const jit = ch >= 1 ? Math.round(Math.sin(t * 60)) : 0;
  drawGlossOrb(ctx, cx + jit, cy, r, col, t);
  // charge fill: rises from the bottom inside the orb
  if (ch !== null) {
    const fh = Math.round((r * 2 - 6) * ch);
    ctx.fillStyle = rgba('#fff6a0', 0.55);
    for (let yy = 0; yy < fh; yy++) {
      const ry = r - 3 - yy, half = Math.floor(Math.sqrt(Math.max(0, (r - 3) * (r - 3) - ry * ry)));
      ctx.fillRect(cx - half + jit, cy + ry, half * 2, 1);
    }
  } else if (!ready && o.shockCdMax > 0 && o.charges < o.shockMax) {
    // recharging: a fill sweep
    const k = 1 - clamp01(o.shockCd / o.shockCdMax);
    const fh = Math.round((r * 2 - 6) * k);
    ctx.fillStyle = 'rgba(191,248,255,0.35)';
    for (let yy = 0; yy < fh; yy++) {
      const ry = r - 3 - yy, half = Math.floor(Math.sqrt(Math.max(0, (r - 3) * (r - 3) - ry * ry)));
      ctx.fillRect(cx - half, cy + ry, half * 2, 1);
    }
  }
  drawBolt16(ctx, cx + jit, cy, ch >= 1 && Math.floor(t * 16) % 2 ? '#ffffff' : ready || ch !== null ? '#fff07a' : '#c8d4dc');
  // charge pips under the orb
  const n = o.shockMax || 1;
  for (let i = 0; i < n; i++) {
    const px = Math.round(cx - (n * 8) / 2 + i * 8 + 1), py = cy + r + 1;
    ctx.fillStyle = INK; ctx.fillRect(px - 1, py - 1, 7, 5);
    ctx.fillStyle = i < o.charges ? '#fff07a' : '#3a5a72'; ctx.fillRect(px, py, 5, 3);
  }
  // LET GO! / HOLD
  if (ch >= 1) gloss(ctx, 'LET GO!', cx - 10, cy - r - 14, 3, 'sun', { k: 1 + Math.max(0, Math.sin(t * 16)) * 0.08 });
  else if (ch !== null) gloss(ctx, 'HOLD...', cx - 8, cy - r - 12, 2, 'aqua');
}

// a chunky 16 px lightning bolt
function drawBolt16(ctx, cx, cy, col) {
  const rows = ['.....###', '....###.', '...###..', '..###...', '.######.', '....###.', '...###..', '..##....', '.##.....', '#.......'];
  const ox = Math.round(cx - 8), oy = Math.round(cy - 10);
  for (const [c, d] of [[INK, 1], [col, 0]]) {
    ctx.fillStyle = c;
    for (let y = 0; y < rows.length; y++) for (let x = 0; x < 8; x++) if (rows[y][x] === '#') ctx.fillRect(ox + x * 2 - d, oy + y * 2 - d, 2 + d * 2, 2 + d * 2);
  }
}

// ------------------------------------------------------------------ first-play tips
// A glass card above the panel: an animated glyph + a few words. Shown on the first fights (state.fishTips).
function tipFor(F, B) {
  const tips = F.tips();
  if (B.mode === 'hookset' || B.boss?.stage === 'intro') return null;
  const n = (k) => tips[k] || 0;
  if (B.charge && B.charge.k < 1 && n('zap') < 4) return { key: 'zap', text: 'Fill it, then let go!', glyph: 'hold' };
  if ((B.mode === 'pull' || B.mode === 'warn') && n('pull') < 4) return { key: 'pull', text: 'It pulls! Stop circling', glyph: 'stop' };
  if (B.tension >= RED && n('red') < 4) return { key: 'red', text: 'Red = ease off!', glyph: 'stop' };
  if (B.shockReady && B.t > 6 && n('zap') < 3 && !B.zapped) return { key: 'zap', text: 'Hold + let go = ZAP!', glyph: 'hold' };
  if (B.reel < 0.15 && (B.t < 5 || B.idleT > 1.5) && n('reel') < 4 && B.mode !== 'pull') return { key: 'reel', text: 'Circle the mouse to reel!', glyph: 'circle' };
  return null;
}

export function drawTips(ctx, F, B) {
  const tip = tipFor(F, B);
  const key = tip?.key || null;
  if (key !== F.tipKey) {
    if (F.tipKey && F.tipShown > 0.8) F.countTip(F.tipKey);
    F.tipKey = key; F.tipShown = 0;
  }
  F.tipShown = (F.tipShown || 0) + F.rdt;
  if (!tip) return;
  drawTipCard(ctx, F, tip.text, tip.glyph, F.tipShown);
}

export function drawTipCard(ctx, F, text, glyph, age) {
  const R = panelRect(F), t = F.t;
  const tw = measureText(text, 'normal', 2);
  const w = tw + 70, h = 38;
  const x = Math.round(F.W / 2 - w / 2), y = R.y - h - 10;
  const k = ease.outBack(clamp01(age * 4));
  ctx.save();
  ctx.globalAlpha = clamp01(age * 5);
  ctx.translate(x + w / 2, y + h / 2);
  ctx.scale(k, k);
  ctx.translate(-w / 2, -h / 2);
  drawAeroSurface(ctx, 0, 0, w, h, { tone: 'frost', r: 12, gloss: 0.5, glossH: 14, rim: 0.85, glow: 0.4 });
  drawGlyph(ctx, glyph, 26, h / 2, t);
  drawText(ctx, text, 50, Math.round(h / 2) - 7, { scale: 2, color: INK });
  ctx.restore();
}

// animated glyphs: a mouse circling, a held button filling, a red STOP hand
function drawGlyph(ctx, kind, cx, cy, t) {
  cx = Math.round(cx); cy = Math.round(cy);
  if (kind === 'circle') {
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * TAU;
      ctx.fillStyle = rgba('#1e8fe0', 0.25 + 0.5 * (((i / 16 - t * 1.6) % 1 + 1) % 1));
      ctx.fillRect(Math.round(cx + Math.cos(a) * 12) - 1, Math.round(cy + Math.sin(a) * 12) - 1, 3, 3);
    }
    const a = t * 1.6 * TAU;
    const m = getUiIcon('cursor') || getUiIcon('mouse_l');
    if (m) ctx.drawImage(m, Math.round(cx + Math.cos(a) * 12 - 2), Math.round(cy + Math.sin(a) * 12 - 2));
  } else if (kind === 'hold') {
    const m = getUiIcon('mouse_hold', 2) || getUiIcon('mouse_l', 2);
    const k = (t * 0.9) % 1.4;
    if (m) ctx.drawImage(m, Math.round(cx - m.width / 2), Math.round(cy - m.height / 2));
    ctx.fillStyle = INK; ctx.fillRect(cx + 12, cy - 12, 6, 24);
    ctx.fillStyle = k >= 1 ? (Math.floor(t * 12) % 2 ? '#ffffff' : '#fff07a') : '#ffd23a';
    const fh = Math.round(22 * Math.min(1, k));
    ctx.fillRect(cx + 13, cy + 11 - fh, 4, fh);
  } else {
    // stop: the tension bar glyph going red with a pause sign
    ctx.fillStyle = INK; ctx.fillRect(cx - 14, cy - 6, 28, 12);
    const k = 0.5 + 0.5 * Math.sin(t * 6);
    ctx.fillStyle = '#6cd03a'; ctx.fillRect(cx - 13, cy - 5, 14, 10);
    ctx.fillStyle = k > 0.5 ? '#ff4f5e' : '#ffd23a'; ctx.fillRect(cx + 1, cy - 5, Math.round(12 * k), 10);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(cx - 4, cy - 10, 3, 6); ctx.fillRect(cx + 1, cy - 10, 3, 6);
  }
}

// ------------------------------------------------------------------ misc
// Short message near the cursor (external callers: tutorial, overlay toasts) as a glass pill.
export function drawMessage(ctx, F, m) {
  const a = Math.min(1, (m.max - m.t) * 3);
  const x = F.input.x, y = Math.round(F.input.y - 44 - m.t * 12);
  const w = measureText(m.text, 'normal', 1) + 16;
  ctx.save();
  ctx.globalAlpha = a;
  drawGlassPill(ctx, x, y - 4, w, 15, '#bfeaff', 0.92);
  drawText(ctx, m.text, x, y, { align: 'center', color: INK });
  ctx.restore();
}

export function drawAngler(ctx, F, x, y, o = {}) {
  const look = F.game.state?.character;
  try {
    return drawCharacter(ctx, x, y, { pose: o.pose || 'idle', t: o.t ?? F.t, facing: o.facing ?? 1, scale: o.scale || 1, look, fish: o.fish });
  } catch (e) {
    if (!F.charErr) { F.charErr = true; console.warn('drawCharacter failed', e); }
    return null;
  }
}

export { pixelLine, damp, lerp };
