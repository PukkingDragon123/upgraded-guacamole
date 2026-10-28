// Handmade pixel-art UI surfaces & widgets (wood, paper, glass, bubbles, shells, rope, coral).
// All drawing is deterministic; expensive textures are cached per size/state (LRU).
//
// drawWood(ctx,x,y,w,h,{tone:'light'|'dark', nails=true, inset=false, round=1, planks=auto, seams=true})
// drawPaper(ctx,x,y,w,h,{torn:false|true|'top'|'bottom'|'both', lined, aged, fold})   (+1 px shadow right, +2 below)
// drawGlass(ctx,x,y,w,h,{tint, frame:false|true|'brass'|'wood'})                        -> inner rect
// drawBottle(ctx,x,y,w,h,{tint, note=true})                                             -> inner rect
// drawBubble(ctx,x,y,w,h,{tailX,tailY, style:'speech'|'thought'})                       -> content rect
// drawWaterBubble(ctx,cx,cy,r)
// drawButton(ctx,x,y,w,h,{label, icon (name|canvas), state:'normal'|'hover'|'down'|'disabled', style:'wood'|'shell'|'paper'|'glass'|'coral', font, align:'center'|'left'})
//   (labels that do not fit are truncated with '..')
// buttonSize(label,{icon,font}) -> {w,h}
// drawSlider(ctx,x,y,w,value,{hover, down}) (height SLIDER_H)                            -> {knob}
// drawToggle(ctx,x,y,on,{hover}) (TOGGLE_W x TOGGLE_H)
// drawBar(ctx,x,y,w,h,value,{color, back, segments})
// drawTooltip(ctx,x,y,text,{maxW, font}) auto-placed near (x,y) inside the canvas          -> rect
// drawTab(ctx,x,y,w,h,{label, icon, active, hover, color})
// drawWindowChrome(ctx,{x,y,w,h},{title, iconCanvas, active=true, hover:'close'|'min'|null, down, fill, shadow=true})
//   -> {content, close, min, titleBar}
// drawTaskbar(ctx,x,y,w,h)
// drawPlank(ctx,x,y,w,h,{rope=14, tone, label})                                        -> inner rect
// drawStamp(ctx,x,y,text,{color, angle (radians; |a|>π is read as degrees), font, scale})   centred on x,y
// drawFrame(ctx,x,y,w,h,{style:'wood'|'gold'|'coral'})                                 -> inner rect

import { makeCanvas, ctxOf } from '../core/canvas.js';
import { PixelBuffer } from '../gfx/pixel.js';
import { pack, unpack, shade, mix, rgbToHex, rgba } from '../core/color.js';
import { bayer, hash1, hash2, clamp, fbm2 } from '../core/math.js';
import { drawText, measureText, wrapText } from '../gfx/font.js';
import { getUiIcon } from '../gfx/uiicons.js';

const WOOD_L = ['#3a1e14', '#6e3c22', '#9a5e34', '#c08550', '#dcaa70', '#f2d098'];
const WOOD_D = ['#1e100c', '#3a2016', '#55321f', '#70452a', '#8c5c38', '#a8784c'];
const PAPER = ['#7a5a3c', '#c8ac80', '#e2cfa8', '#f3e6c8', '#fbf3df', '#fffcf2'];
const BRASS = ['#3e2210', '#7a4a1c', '#b8782a', '#e0a844', '#f6d27a', '#fff2b8'];
const GOLD = ['#4a2a10', '#8a5418', '#c88a26', '#f0b83c', '#ffe07a', '#fff8c8'];
const CORAL = ['#5a1424', '#a8344a', '#e0585a', '#ff866c', '#ffb48e', '#ffe0c6'];
const CHROME = ['#2a2028', '#7a6e66', '#b4a894', '#d8ceb8', '#ece4d0', '#fffaee'];

export const UI_COLORS = {
  ink: '#2e1f1c',
  inkSoft: '#6b4f43',
  inkShadow: '#fff7e6',
  text: '#fff6e2',
  textShadow: '#2a140e',
  textDim: '#cdb89a',
  outline: '#1c1220',
  wood: WOOD_L,
  woodDark: WOOD_D,
  paper: PAPER,
  brass: BRASS,
  gold: GOLD,
  coral: CORAL,
  chrome: CHROME,
  glass: '#9fe6ff',
  sea: '#1f6f86',
  seaDeep: '#123a5a',
  accent: '#ffd25a',
  good: '#6ad46a',
  bad: '#ff5a4a',
  warn: '#ffb43a',
  info: '#5ab4ff',
  coin: '#5fbf98',
  hover: '#fff2b0',
  disabled: '#8f8a90',
  titleActive: ['#18506e', '#2a7e9e', '#4cb8c6'],
  titleInactive: ['#5a5e70', '#767a8e', '#9a9eae'],
  shadow: '#06121c',
};

// ---------------------------------------------------------------- helpers

const pkc = new Map(), pkcA = new Map();
function pk(c, a = 255) {
  if (a === 255) {
    let v = pkc.get(c);
    if (v === undefined) pkc.set(c, (v = pack(c)));
    return v;
  }
  const k = c + '|' + a;
  let v = pkcA.get(k);
  if (v === undefined) pkcA.set(k, (v = pack(c, a)));
  return v;
}

function step(v, R, x, y) {
  const n = R.length - 1;
  v = clamp(v, 0, n);
  const i = Math.floor(v);
  if (i >= n) return R[n];
  const f = clamp((v - i - 0.5) * 2.4 + 0.5, 0, 1);
  return f > bayer(x, y) ? R[i + 1] : R[i];
}

const INSETS = { 0: [], 1: [1], 2: [2, 1], 3: [3, 1, 1], 4: [4, 2, 1, 1], 5: [5, 3, 2, 1, 1] };
function rr(w, h, r) {
  const ins = INSETS[r] || [];
  return (x, y) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return false;
    const d = Math.min(y, h - 1 - y);
    const k = d < ins.length ? ins[d] : 0;
    return x >= k && x < w - k;
  };
}
const edgeOf = (m, x, y) => !m(x - 1, y) || !m(x + 1, y) || !m(x, y - 1) || !m(x, y + 1);

// LRU texture caches; volatile textures (bubble tails, stamps) live in their own small store.
const tex = new Map(), volatileTex = new Map();
function cached(key, build, store = tex, limit = 500) {
  let c = store.get(key);
  if (c) {
    store.delete(key);
    store.set(key, c);
    return c;
  }
  c = build();
  store.set(key, c);
  if (store.size > limit) store.delete(store.keys().next().value);
  return c;
}

const outCache = new Map();
function outlineFn(n) {
  let c = outCache.get(n);
  if (c === undefined) {
    const [r, g, b] = unpack(n);
    const lum = (r * 0.3 + g * 0.59 + b * 0.11) / 255;
    c = pk(mix(shade(rgbToHex(r, g, b), -0.82), '#1a1226', 0.45 + Math.max(0, lum - 0.6) * 0.9));
    outCache.set(n, c);
  }
  return c;
}

// Tiny ASCII sprite with automatic selective outline (1 px margin added).
function asciiSprite(rows, pal) {
  const h = rows.length, w = Math.max(...rows.map((r) => r.length));
  const b = new PixelBuffer(w + 2, h + 2);
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const c = pal[row[x]];
      if (c) b.set(x + 1, y + 1, Array.isArray(c) ? pk(c[0], c[1]) : pk(c));
    }
  });
  b.outline(outlineFn);
  return b.toCanvas();
}

function blitRect(ctx, c, x, y) {
  ctx.drawImage(c, Math.round(x), Math.round(y));
}

const iconOf = (icon) => (!icon ? null : typeof icon === 'string' ? getUiIcon(icon) : icon);

// ---------------------------------------------------------------- wood

function woodTex(w, h, tone, nails, inset, round, planks, noSeams) {
  const R0 = tone === 'dark' ? WOOD_D : WOOD_L;
  const R = inset ? [R0[0], R0[0], R0[1], R0[2], R0[3], R0[4]] : R0;
  const b = new PixelBuffer(w, h);
  const m = rr(w, h, round);
  const n = planks || Math.max(1, Math.round((h - 2) / 12));
  const ys = [];
  for (let i = 0; i <= n; i++) ys.push(1 + Math.round((i * (h - 2)) / n));
  const nailAt = [];
  for (let i = 0; i < n; i++) {
    const y0 = ys[i], y1 = ys[i + 1], ph = y1 - y0, seed = i * 31 + (tone === 'dark' ? 7 : 0);
    const tint = (hash1(i, 3) - 0.5) * 0.16;
    const P = R.map((c) => (tint > 0 ? mix(c, shade(c, 0.4), tint * 2) : mix(c, shade(c, -0.4), -tint * 2)));
    const seams = [];
    if (w > 90 && !noSeams) {
      seams.push(Math.round(w * (0.2 + hash1(i, 5) * 0.55)));
      if (w > 300) seams.push(Math.round(w * (0.2 + hash1(i, 5) * 0.55) + w * 0.45) % (w - 24) + 12);
    }
    const knot = w > 48 && ph >= 8 && hash1(i, 9) > 0.35 ? [12 + Math.floor(hash1(i, 11) * (w - 24)), y0 + ph / 2 + 0.5] : null;
    const top = i > 0 ? 1 : 0;
    const wave = new Float32Array(w);
    for (let x = 0; x < w; x++) wave[x] = Math.sin(x * 0.045 + seed) * 1.6 + Math.sin(x * 0.013 + seed * 2) * 2.4;
    const s0 = seams.length > 0 ? seams[0] : -9, s1 = seams.length > 1 ? seams[1] : -9;
    for (let y = y0; y < y1; y++) {
      const ly = y - y0;
      for (let x = 0; x < w; x++) {
        if (!m(x, y)) continue;
        if (i > 0 && ly === 0) { b.set(x, y, pk(R[0])); continue; }
        let c = P[3];
        if (ly === top) c = P[4];
        else if (ly === ph - 1) c = P[2];
        else {
          let gy = y + wave[x];
          let kd = 9;
          if (knot) {
            const dx = (x + 0.5 - knot[0]) / 3.2, dy = (y + 0.5 - knot[1]) / 1.7;
            kd = Math.hypot(dx, dy);
            if (kd < 3.2) gy += Math.sign(y + 0.5 - knot[1]) * (3.2 - kd) * 0.9;
          }
          const ph2 = ((gy + seed * 0.37) / 3.3) % 1;
          const seg = Math.sin(x * 0.07 + Math.floor(gy / 3.3) * 2.3 + seed) > -0.2;
          if (ph2 < 0.24 && seg) c = P[2];
          else if (ph2 > 0.55 && ph2 < 0.7 && hash2(x >> 3, Math.floor(gy / 3.3), seed) > 0.55) c = P[4];
          if (knot && kd < 1) c = kd < 0.5 ? P[1] : P[2];
          else if (knot && kd < 1.5) c = P[4];
        }
        if (ly >= top && (Math.abs(x - s0) <= 1 || Math.abs(x - s1) <= 1)) {
          const sx = Math.abs(x - s0) <= 1 ? s0 : s1;
          if (x === sx) c = R[0];
          else if (x === sx + 1 && ly > top) c = P[4];
          else if (x === sx - 1 && ly > top && ly < ph - 1) c = P[2];
        }
        if (x === 1 && ly > top) c = mix(c, P[5], 0.35);
        if (x === w - 2) c = mix(c, P[1], 0.45);
        if (inset) {
          if (y === 1 || x === 1) c = R[1];
          else if (y === 2 || x === 2) c = mix(c, R[1], 0.5);
          else if (y === h - 2) c = R0[4];
          else if (x === w - 2) c = R0[3];
        }
        b.set(x, y, pk(c));
      }
    }
    if (nails && !inset && w >= 24 && ph >= 6) {
      const ny = y0 + top + Math.floor((ph - top) / 2) - 1;
      if (i === 0 || i === n - 1) nailAt.push([4, ny], [w - 6, ny]);
      for (const sx of seams) nailAt.push([sx - 4, ny], [sx + 3, ny]);
    }
  }
  for (const [nx, ny] of nailAt) {
    b.set(nx, ny, pk('#f4f6fa'));
    b.set(nx + 1, ny, pk('#a8b0c0'));
    b.set(nx, ny + 1, pk('#8a92a4'));
    b.set(nx + 1, ny + 1, pk('#4a5064'));
    b.set(nx + 2, ny + 1, pk(R[1]));
    b.set(nx + 1, ny + 2, pk(R[1]));
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (m(x, y) && edgeOf(m, x, y)) b.set(x, y, pk(R0[0]));
  return b.toCanvas();
}

export function drawWood(ctx, x, y, w, h, opts = {}) {
  w = Math.round(w); h = Math.round(h);
  if (w < 3 || h < 3) return;
  const tone = opts.tone === 'dark' ? 'dark' : 'light';
  const nails = opts.nails !== false, inset = !!opts.inset, round = opts.round ?? 1, planks = opts.planks || 0, noSeams = opts.seams === false;
  blitRect(ctx, cached(`wood|${w}|${h}|${tone}|${nails}|${inset}|${round}|${planks}|${noSeams}`, () => woodTex(w, h, tone, nails, inset, round, planks, noSeams)), x, y);
}

// ---------------------------------------------------------------- paper

function paperTex(w, h, torn, lined, aged, fold) {
  const tTop = torn === 'top' || torn === 'both', tBot = torn === true || torn === 'bottom' || torn === 'both';
  const prof = (x, s) => clamp(Math.round(1.3 + Math.sin(x * 0.75 + s) * 0.9 + hash1(x, s) * 1.7 - 0.6), 0, 3);
  const F = fold ? clamp(Math.round(Math.min(w, h) * 0.22), 4, 12) : 0;
  const m = (x, y) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return false;
    if (tTop && y < prof(x, 3)) return false;
    if (tBot && y > h - 1 - prof(x, 7)) return false;
    if (F && x - (w - F) > y) return false;
    if (!tTop && y === 0 && (x === 0 || (!F && x === w - 1))) return false;
    if (!tBot && y === h - 1 && (x === 0 || x === w - 1)) return false;
    return true;
  };
  const flap = (x, y) => F && x >= w - F && y < F && x - (w - F) <= y;
  const b = new PixelBuffer(w + 1, h + 2);
  const sh = pk('#1a1020', 64);
  for (let y = 0; y < h + 2; y++) for (let x = 0; x < w + 1; x++) if (!m(x, y) && m(x - 1, y - 2)) b.set(x, y, sh);
  const R = PAPER;
  const ring = aged && w > 50 && h > 40 ? [w * 0.74, h * 0.66, Math.min(w, h) * 0.17] : null;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!m(x, y)) continue;
      if (edgeOf(m, x, y)) { b.set(x, y, pk(mix(R[0], R[1], 0.25))); continue; }
      if (flap(x, y)) {
        const onEdge = x === w - F || y === F - 1 || x - (w - F) === y;
        b.set(x, y, pk(onEdge ? R[1] : step(4.2 - (y / F) * 1.2, R, x, y)));
        continue;
      }
      let v = 3.0;
      if (y <= 2) v += 0.8;
      if (y >= h - 4) v -= 0.75;
      if (x === 1) v += 0.5;
      if (x >= w - 3) v -= 0.5;
      const hs = hash2(x, y, 41);
      if (hs > 0.975) v -= 0.55;
      else if (hs < 0.015) v += 0.6;
      if (aged) {
        const d = Math.min(x, y, w - 1 - x, h - 1 - y);
        if (d < 7) v -= (7 - d) * 0.2;
        if (hash2(x >> 1, y >> 1, 9) > 0.988) v = 1.6;
        if (ring) {
          const rd = Math.hypot(x + 0.5 - ring[0], (y + 0.5 - ring[1]) * 1.1);
          if (Math.abs(rd - ring[2]) < 0.8 && hash2(x, y, 5) > 0.2) v = Math.min(v, 1.9);
          else if (rd < ring[2]) v -= 0.25;
        }
      }
      if (F && x >= w - F - 2 && y < F + 2 && !flap(x, y) && (x === w - F - 1 || y === F)) v -= 0.8;
      let c = step(v, R, x, y);
      if (lined) {
        if (y >= 13 && (y - 13) % 10 === 0 && x > 2 && x < w - 3) c = '#a9c4e0';
        if (x === 10 && y > 2 && y < h - 3) c = '#e6a2a0';
      }
      b.set(x, y, pk(c));
    }
  }
  return b.toCanvas();
}

export function drawPaper(ctx, x, y, w, h, opts = {}) {
  w = Math.round(w); h = Math.round(h);
  if (w < 4 || h < 4) return;
  const torn = opts.torn || false, lined = !!opts.lined, aged = !!opts.aged, fold = !!opts.fold;
  blitRect(ctx, cached(`paper|${w}|${h}|${torn}|${lined}|${aged}|${fold}`, () => paperTex(w, h, torn, lined, aged, fold)), x, y);
}

// ---------------------------------------------------------------- frames used by glass / windows

function bandFrame(b, w, h, fw, R, opts = {}) {
  const outer = rr(w, h, opts.r ?? 2);
  const inner = (x, y) => x >= fw && y >= fw && x < w - fw && y < h - fw;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!outer(x, y) || inner(x, y)) continue;
      let v;
      if (edgeOf(outer, x, y)) v = 0;
      else if (inner(x - 1, y) || inner(x + 1, y) || inner(x, y - 1) || inner(x, y + 1)) v = 1;
      else {
        const dT = y, dB = h - 1 - y, dL = x, dR = w - 1 - x, mn = Math.min(dT, dB, dL, dR);
        const side = mn === dT ? 't' : mn === dL ? 'l' : mn === dB ? 'b' : 'r';
        v = side === 't' ? 4.3 : side === 'l' ? 3.8 : side === 'b' ? 2.2 : 2.6;
        const k = mn;
        if (k === 1) v += 0.5;
        if (opts.grain) {
          const along = side === 't' || side === 'b' ? x : y;
          const g = fbm2(along * 0.06, k * 0.9 + (side === 'l' || side === 'r' ? 40 : 0), 2, 3);
          v += (g - 0.5) * 1.2;
          if ((g * 9) % 1 < 0.12) v -= 0.6;
        }
      }
      b.set(x, y, pk(step(v, R, x, y)));
    }
  }
  if (opts.rivets) {
    for (const [rx, ry] of [[1, 1], [w - 3, 1], [1, h - 3], [w - 3, h - 3]]) {
      const cx = rx + (fw - 2 > 0 ? Math.floor((fw - 2) / 2) : 0), cy = ry + (fw - 2 > 0 ? Math.floor((fw - 2) / 2) : 0);
      b.set(cx, cy, pk(R[5]));
      b.set(cx + 1, cy, pk(R[3]));
      b.set(cx, cy + 1, pk(R[3]));
      b.set(cx + 1, cy + 1, pk(R[1]));
    }
  }
}

// ---------------------------------------------------------------- glass

function glassTex(w, h, tint, frame) {
  const b = new PixelBuffer(w, h);
  const fw = frame ? 3 : 0;
  if (frame) bandFrame(b, w, h, fw, frame === 'wood' ? WOOD_L : BRASS, { rivets: true, grain: frame === 'wood' });
  const gw = w - 2 * fw, gh = h - 2 * fw;
  const m = rr(gw, gh, frame ? 0 : 2);
  const deep = shade(tint, -0.55), lite = shade(tint, 0.55);
  const S = Math.floor(Math.min(gw, gh) * 0.18) + 3;
  for (let y = 0; y < gh; y++) {
    const t = y / Math.max(1, gh - 1), rowC = mix(tint, deep, Math.round(t * 0.55 * 12) / 12);
    for (let x = 0; x < gw; x++) {
      if (!m(x, y)) continue;
      let c, a;
      if (!frame && edgeOf(m, x, y)) { c = '#0e2a3a'; a = 225; }
      else {
        c = rowC;
        a = 52 + t * 46;
        if (y >= gh - 3) { c = deep; a = 120; }
        const d = x + y;
        if (y < gh * 0.8 && d >= S && d <= S + 3) { c = '#ffffff'; a = 78; }
        if (y < gh * 0.8 && d >= S + 6 && d <= S + 7) { c = '#ffffff'; a = 52; }
        const d2 = gw + gh - d;
        if (y > gh * 0.3 && d2 >= S + 4 && d2 <= S + 5) { c = lite; a = 70; }
        if (y === (frame ? 0 : 1)) { c = '#ffffff'; a = 190; }
        else if (x === (frame ? 0 : 1)) { c = '#ffffff'; a = 110; }
        else if (x === gw - (frame ? 1 : 2)) { c = deep; a = 160; }
      }
      b.set(x + fw, y + fw, pk(c, Math.round(a)));
    }
  }
  const nb = Math.min(4, Math.floor((gw * gh) / 1800));
  for (let k = 0; k < nb; k++) {
    const bx = fw + 6 + Math.floor(hash1(k, w + 3) * (gw - 12)), by = fw + Math.floor(gh * 0.45) + Math.floor(hash1(k, h + 7) * (gh * 0.45 - 4));
    for (const [dx, dy, a] of [[0, -1, 150], [-1, 0, 150], [1, 0, 90], [0, 1, 90]]) b.set(bx + dx, by + dy, pk('#e8fcff', a));
    if (k % 2 === 0) b.set(bx - 1, by - 2, pk('#ffffff', 110));
  }
  const sx = fw + 4, sy = fw + 3;
  b.set(sx, sy, pk('#ffffff'));
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) b.set(sx + dx, sy + dy, pk('#ffffff', 170));
  return b.toCanvas();
}

export function drawGlass(ctx, x, y, w, h, opts = {}) {
  w = Math.round(w); h = Math.round(h);
  const tint = opts.tint || UI_COLORS.glass;
  const frame = opts.frame === true ? 'brass' : opts.frame || false;
  if (w >= 6 && h >= 6) blitRect(ctx, cached(`glass|${w}|${h}|${tint}|${frame}`, () => glassTex(w, h, tint, frame)), x, y);
  const fw = frame ? 3 : 2;
  return { x: x + fw, y: y + fw, w: w - fw * 2, h: h - fw * 2 };
}

// ---------------------------------------------------------------- bottle

function bottleGeom(w, h) {
  const neckL = clamp(Math.round(h * 0.42) + 3, 6, 18), corkL = clamp(Math.round(neckL * 0.5), 3, 8);
  const shL = clamp(Math.round(h * 0.35), 3, 12);
  return { neckL, corkL, shL, bodyEnd: w - neckL - shL, nh: Math.max(4, Math.round(h * 0.4)) };
}

function bottleTex(w, h, tint, note) {
  const { corkL, shL, bodyEnd, nh } = bottleGeom(w, h);
  const half = h / 2;
  const bodyM = rr(bodyEnd * 2 + 8, h, h >= 16 ? 4 : 2);
  const glass = (x, y) => {
    if (x < 0 || y < 0 || x >= w - corkL || y >= h) return false;
    const dy = Math.abs(y + 0.5 - half);
    if (x < bodyEnd) return bodyM(x, y);
    if (x < bodyEnd + shL) {
      const t = (x - bodyEnd + 0.5) / shL;
      return dy <= half + (nh / 2 - half) * (0.5 - 0.5 * Math.cos(Math.PI * t));
    }
    if (x >= w - corkL - 2) return dy <= nh / 2 + 1;
    return dy <= nh / 2;
  };
  const cork = (x, y) => x >= w - corkL - 1 && x < w && Math.abs(y + 0.5 - half) <= nh / 2 - 1;
  const any = (x, y) => glass(x, y) || cork(x, y);
  const deep = shade(tint, -0.55);
  const b = new PixelBuffer(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!any(x, y)) continue;
      if (cork(x, y) && (!glass(x, y) || x >= w - corkL)) {
        const top = !cork(x, y - 1), bot = !cork(x, y + 1);
        const c = edgeOf(any, x, y) ? WOOD_L[0] : top ? WOOD_L[5] : bot ? WOOD_L[2] : hash2(x, y, 3) > 0.72 ? WOOD_L[2] : WOOD_L[4];
        b.set(x, y, pk(c));
        continue;
      }
      if (edgeOf(glass, x, y)) { b.set(x, y, pk('#0e2a3a', 230)); continue; }
      const t = y / (h - 1);
      let c = mix(tint, deep, t * 0.6), a = 64 + t * 60;
      if (x >= w - corkL - 2) { c = shade(tint, 0.35); a = 210; }
      if (!glass(x, y - 1) || !glass(x, y - 2)) { c = '#ffffff'; a = !glass(x, y - 1) ? 200 : 90; }
      else if (y === 3 && x > 5 && x < bodyEnd * 0.7) { c = '#ffffff'; a = 130; }
      if (!glass(x, y + 2)) { c = deep; a = 150; }
      b.set(x, y, pk(c, Math.round(a)));
    }
  }
  if (note) {
    const len = Math.round((bodyEnd - 8) * 0.8), x0 = Math.round((bodyEnd - len) / 2) + 1, x1 = x0 + len;
    const py0 = Math.round(h * 0.32), py1 = Math.max(py0 + 4, Math.round(h * 0.68)), mid = (py0 + py1) / 2;
    const tones = ['#fffaf0', '#f8edd4', '#efe0bc', '#e2cca2', '#cdb48a'];
    for (let y = py0; y <= py1; y++) {
      for (let x = x0; x <= x1; x++) {
        const e = y === py0 || y === py1 || x === x0 || x === x1;
        const t = (y - py0) / (py1 - py0);
        let c = e ? '#7e5e3e' : tones[Math.min(4, Math.floor(t * 4.6))];
        const cap = x <= x0 + 2 || x >= x1 - 2;
        if (!e && cap) c = x === x0 + 1 || x === x1 - 1 ? '#d6bf94' : '#e8d6b0';
        if (!e && (x === x1 - 1 || x === x0 + 1) && Math.abs(y - mid) < 1) c = '#8a6a46';
        if (!e && !cap && hash2(x, y, 4) > 0.94) c = '#d6bf94';
        b.set(x, y, pk(c));
      }
    }
    const tx = Math.round((x0 + x1) / 2);
    for (let y = py0; y <= py1; y++) { b.set(tx, y, pk('#d83a3a')); b.set(tx + 1, y, pk('#a02a34')); }
    b.set(tx - 1, py0 - 1, pk('#e04a44'));
    b.set(tx + 2, py0 - 1, pk('#a02a34'));
    b.set(tx, py0 - 1, pk('#ff7a6a'));
    b.set(tx + 1, py0 - 1, pk('#c83a3a'));
    b.set(tx - 1, py0 - 2, pk('#e04a44'));
    b.set(tx + 2, py0 - 2, pk('#c83a3a'));
  }
  return b.toCanvas();
}

export function drawBottle(ctx, x, y, w, h, opts = {}) {
  w = Math.round(w); h = Math.round(h);
  const tint = opts.tint || '#8ee0c0';
  const note = opts.note !== false;
  if (w >= 24 && h >= 10) blitRect(ctx, cached(`bottle|${w}|${h}|${tint}|${note}`, () => bottleTex(w, h, tint, note)), x, y);
  const { bodyEnd } = bottleGeom(w, h);
  return { x: x + 4, y: y + 4, w: bodyEnd - 6, h: h - 8 };
}

// ---------------------------------------------------------------- speech bubble

function bubbleTex(w, h, tx, ty, style) {
  let side = null;
  if (ty >= h + 2) side = 'b';
  else if (ty <= -3) side = 't';
  else if (tx <= -3) side = 'l';
  else if (tx >= w + 2) side = 'r';
  const maxL = 13;
  let base = null, tip = null;
  if (side === 'b' || side === 't') {
    const bx = clamp(tx, 9, w - 10);
    tip = [clamp(tx, bx - 12, bx + 12), side === 'b' ? Math.min(ty, h + maxL) : Math.max(ty, -maxL)];
    base = [bx, side === 'b' ? h - 2 : 1];
  } else if (side) {
    const by = clamp(ty, 7, h - 8);
    tip = [side === 'r' ? Math.min(tx, w + maxL) : Math.max(tx, -maxL), clamp(ty, by - 10, by + 10)];
    base = [side === 'r' ? w - 2 : 1, by];
  }
  const ox = Math.max(0, tip ? -Math.floor(tip[0]) + 1 : 0), oy = Math.max(0, tip ? -Math.floor(tip[1]) + 1 : 0);
  const CW = Math.max(w, tip ? Math.ceil(tip[0]) + 2 : 0) + ox + 2, CH = Math.max(h, tip ? Math.ceil(tip[1]) + 2 : 0) + oy + 3;
  const body = rr(w, h, h >= 14 ? 4 : 2);
  const circles = [];
  let tri = null;
  if (tip && style === 'thought') {
    const ex = base[0], ey = base[1];
    [[0.38, 3.2], [0.68, 2.3], [0.93, 1.5]].forEach(([t, r]) => circles.push([ex + (tip[0] - ex) * t, ey + (tip[1] - ey) * t, r]));
  } else if (tip) {
    const vertical = side === 'b' || side === 't';
    const [bx, by] = base;
    tri = vertical ? [[bx - 4.5, by], [bx + 4.5, by], tip] : [[bx, by - 4], [bx, by + 4], tip];
  }
  const inTri = (px, py) => {
    if (!tri) return false;
    const [a, b2, c] = tri;
    const s = (p1, p2, p3) => (p1[0] - p3[0]) * (p2[1] - p3[1]) - (p2[0] - p3[0]) * (p1[1] - p3[1]);
    const P = [px, py];
    const d1 = s(P, a, b2), d2 = s(P, b2, c), d3 = s(P, c, a);
    return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
  };
  const shape = (x, y) => {
    const bx = x - ox, by = y - oy;
    if (body(bx, by)) return true;
    if (inTri(bx + 0.5, by + 0.5)) return true;
    return circles.some(([cx, cy, r]) => Math.hypot(bx + 0.5 - cx, by + 0.5 - cy) <= r);
  };
  const b = new PixelBuffer(CW, CH);
  const sh = pk('#06121c', 56);
  for (let y = 0; y < CH; y++) for (let x = 0; x < CW; x++) if (!shape(x, y) && shape(x - 1, y - 2)) b.set(x, y, sh);
  for (let y = 0; y < CH; y++) {
    for (let x = 0; x < CW; x++) {
      if (!shape(x, y)) continue;
      const bx = x - ox, by = y - oy;
      let c;
      if (edgeOf(shape, x, y)) c = '#2a2440';
      else if (!shape(x, y + 2) || !shape(x, y + 1)) c = '#d6e2ec';
      else if (!shape(x + 1, y)) c = '#e6eef4';
      else if (!shape(x, y - 1) || !shape(x - 1, y)) c = '#ffffff';
      else c = '#fffdf6';
      if (body(bx, by) && by >= 2 && by <= 3 && bx >= 3 && bx <= Math.min(9, w - 4) && by + bx < 11) c = '#ffffff';
      b.set(x, y, pk(c));
    }
  }
  const sx = ox + 3, sy = oy + 3;
  if (w > 14 && h > 10) {
    b.set(sx, sy + 1, pk('#ffffff'));
    b.set(sx + 1, sy, pk('#ffffff'));
    b.set(sx, sy, pk('#ffffff'));
  }
  const cv = b.toCanvas();
  cv.ox = ox;
  cv.oy = oy;
  return cv;
}

export function drawBubble(ctx, x, y, w, h, opts = {}) {
  w = Math.round(w); h = Math.round(h); x = Math.round(x); y = Math.round(y);
  const tx = opts.tailX === undefined ? null : Math.round(opts.tailX - x);
  const ty = opts.tailY === undefined ? null : Math.round(opts.tailY - y);
  const style = opts.style === 'thought' ? 'thought' : 'speech';
  const c = cached(`bubble|${w}|${h}|${tx}|${ty}|${style}`, () => bubbleTex(w, h, tx ?? w / 2, ty ?? h / 2, style), volatileTex, 96);
  ctx.drawImage(c, x - c.ox, y - c.oy);
  return { x: x + 5, y: y + 4, w: w - 10, h: h - 8 };
}

function waterBubbleTex(r) {
  const S = Math.ceil(r * 2) + 2, c = S / 2;
  const b = new PixelBuffer(S, S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const d = Math.hypot(x + 0.5 - c, y + 0.5 - c);
      if (d > r) continue;
      const dx = x + 0.5 - c, dy = y + 0.5 - c;
      const lit = (-dx - dy) / Math.max(0.01, d * 1.414);
      let col = '#bff4ff', a = 46;
      if (d > r - 1) { col = lit > -0.2 ? '#e8fcff' : '#7fd6ec'; a = 230; }
      else if (d > r - 2 && lit < -0.4) { col = '#a8ecff'; a = 110; }
      b.set(x, y, pk(col, a));
    }
  }
  const hx = Math.floor(c - r * 0.45), hy = Math.floor(c - r * 0.45);
  b.set(hx, hy, pk('#ffffff'));
  if (r >= 4) { b.set(hx + 1, hy, pk('#ffffff', 200)); b.set(hx, hy + 1, pk('#ffffff', 200)); }
  return b.toCanvas();
}

export function drawWaterBubble(ctx, cx, cy, r) {
  r = Math.max(1.5, Math.round(r * 2) / 2);
  const c = cached(`wbub|${r}`, () => waterBubbleTex(r));
  ctx.drawImage(c, Math.round(cx - c.width / 2), Math.round(cy - c.height / 2));
}

// ---------------------------------------------------------------- buttons

const BTN = {
  wood: { R: WOOD_L, r: 2, text: '#fff4dc', shadow: '#3a1e12' },
  shell: { R: ['#5a2a3e', '#b0606e', '#e08e8e', '#f7bcaa', '#ffdccb', '#fff4ec'], r: 3, text: '#6a2a3c', shadow: '#ffece2' },
  paper: { R: PAPER, r: 1, text: '#3a2a22', shadow: '#fffaf0' },
  glass: { R: ['#0e2a3a', '#2a6e8a', '#5ab4cc', '#8edcec', '#c4f2fa', '#ffffff'], r: 3, text: '#ffffff', shadow: '#123e54', alpha: true },
  coral: { R: CORAL, r: 3, text: '#fffaf0', shadow: '#7a1e2a' },
};

const greyR = (R) => R.map((c, i) => mix(c, ['#2e2a30', '#5a5660', '#8a8690', '#a8a4ac', '#c4c0c6', '#dcd8dc'][i], 0.75));

function buttonTex(w, h, style, state) {
  const S = BTN[style] || BTN.wood;
  let R = state === 'disabled' ? greyR(S.R) : S.R;
  const down = state === 'down', hover = state === 'hover';
  if (hover) R = R.map((c, i) => (i === 0 ? c : mix(c, S.R[Math.min(5, i + 1)], 0.6)));
  if (down) R = R.map((c, i) => (i === 0 ? c : mix(c, S.R[Math.max(1, i - 1)], 0.5)));
  const off = down ? 2 : 0;
  const shapeM = rr(w, h - off, S.r);
  const m = (x, y) => shapeM(x, y - off);
  const lipTop = h - 3, fb = down ? h - 2 : lipTop - 1;
  const b = new PixelBuffer(w, h);
  const seed = (w * 7 + h) % 13;
  const rim = style === 'glass' ? '#ffffff' : '#fff3b8';
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!m(x, y)) continue;
      if (edgeOf(m, x, y)) { b.set(x, y, pk(R[0])); continue; }
      const fy = y - off;
      if (!down && y >= lipTop) {
        b.set(x, y, pk(y === lipTop ? (x === 1 ? R[2] : R[1]) : mix(R[1], R[0], 0.45)));
        continue;
      }
      let c = R[3], a = 255;
      if (fy === 1) c = down ? R[2] : R[5];
      else if (fy === 2) c = down ? mix(R[2], R[3], 0.5) : R[4];
      else if (y === fb) c = R[2];
      else if (x === 1) c = R[4];
      else if (x === w - 2) c = R[2];
      const body = fy > 2 && y < fb && x > 1 && x < w - 2;
      if (body && style === 'wood') {
        const gy = y + Math.sin(x * 0.09 + seed) * 1.3;
        const ph = (gy / 3.4) % 1;
        if (ph < 0.25 && Math.sin(x * 0.13 + Math.floor(gy / 3.4) * 2.1 + seed) > -0.1) c = R[2];
      } else if (body && style === 'shell') {
        const k = (x - 2) % 5;
        if (k === 0) c = R[2];
        else if (k === 1) c = R[4];
        if (fy === 3 && k === 2 && x < w * 0.5) c = R[5];
      } else if (body && style === 'paper') {
        if (hash2(x, y, 41) > 0.965) c = R[2];
      } else if (body && style === 'coral') {
        const cx = Math.floor(x / 5), cy = Math.floor((y - off) / 4);
        if (hash2(cx, cy, 13) > 0.45) {
          const px = cx * 5 + 2 + (cy % 2), py = cy * 4 + 1 + off;
          if (x === px && y === py) c = R[1];
          else if (x === px - 1 && y === py - 1) c = R[5];
          else if ((x === px + 1 && y === py) || (x === px && y === py + 1)) c = R[4];
        }
      }
      if (style === 'glass') {
        a = Math.round(125 + (fy / h) * 70);
        const d = x + fy;
        if (fy > 2 && y < fb && d >= 6 && d <= 8) { c = '#ffffff'; a = 140; }
        if (fy === 1) a = 230;
      }
      if (hover && (fy === 1 || x === 1 || x === w - 2)) { c = rim; a = 235; }
      b.set(x, y, pk(c, S.alpha ? a : 255));
    }
  }
  return b.toCanvas();
}

export function buttonSize(label = '', opts = {}) {
  const font = opts.font || 'normal';
  const ic = iconOf(opts.icon);
  const tw = label ? measureText(label, font) : 0;
  const iw = ic ? ic.width + (label ? 4 : 0) : 0;
  const h = font === 'small' ? 15 : 19;
  return { w: Math.max(h, tw + iw + 16), h };
}

export function drawButton(ctx, x, y, w, h, opts = {}) {
  w = Math.round(w); h = Math.round(h); x = Math.round(x); y = Math.round(y);
  const style = BTN[opts.style] ? opts.style : 'wood';
  const state = opts.state || 'normal';
  const S = BTN[style];
  ctx.drawImage(cached(`btn|${w}|${h}|${style}|${state}`, () => buttonTex(w, h, style, state)), x, y);
  const font = opts.font || 'normal';
  const ic = iconOf(opts.icon);
  const iw = ic ? ic.width + (opts.label ? 4 : 0) : 0;
  let label = opts.label || '';
  let tw = label ? measureText(label, font) : 0;
  if (label && tw + iw > w - 10) {
    while (label.length > 1 && measureText(label + '..', font) + iw > w - 10) label = label.slice(0, -1);
    label = label.replace(/\s+$/, '') + '..';
    tw = measureText(label, font);
  }
  const down = state === 'down';
  const faceTop = down ? 3 : 1, faceBot = down ? h - 2 : h - 4;
  const capH = font === 'small' ? 5 : 7;
  const cy = Math.round((faceTop + faceBot) / 2);
  let cx = opts.align === 'left' ? x + 5 : x + Math.round((w - tw - iw) / 2);
  const dis = state === 'disabled';
  if (ic) {
    ctx.globalAlpha = dis ? 0.55 : 1;
    ctx.drawImage(ic, cx, y + cy - Math.floor(ic.height / 2));
    ctx.globalAlpha = 1;
    cx += iw;
  }
  if (label) {
    const color = dis ? (style === 'glass' || style === 'wood' || style === 'coral' ? '#d8d2cc' : '#8a8488') : state === 'hover' && (style === 'wood' || style === 'coral') ? '#fffbe8' : S.text;
    drawText(ctx, label, cx, y + cy - Math.floor(capH / 2), { font, color, shadow: dis ? (style === 'paper' || style === 'shell' ? null : '#4a464c') : S.shadow });
  }
}

// ---------------------------------------------------------------- slider (rope + bobber)

export const SLIDER_H = 15;

let bobbers = null;
function getBobbers() {
  if (bobbers) return bobbers;
  const pal = { y: '#ffe27a', w: '#f6f2ec', h: '#ffffff', l: '#d4d0d8', g: '#9a96a8', p: '#ff9a86', r: '#e83a3a', R: '#a42438', x: '#3a2a3a', o: '#ff6a4a' };
  const rows = ['...y...', '...w...', '..prr..', '.pprrR.', 'pprrrRR', 'prrrrRR', 'xxxxxxx', 'hwwwwlg', 'wwwwllg', '.wwwlg.', '..wlg..'];
  const hoverRows = rows.map((r) => r.replace(/r/g, 'o'));
  bobbers = { normal: asciiSprite(rows, pal), hover: asciiSprite(hoverRows, pal) };
  return bobbers;
}

const ROPE = ['#5a3a20', '#9a7444', '#d4b07a', '#f0d6a4'];
const ROPE_W = ['#1e3c4a', '#2e6a7a', '#4aa0a8', '#86d4cc'];

function ropeTex(w, wet) {
  const R = wet ? ROPE_W : ROPE;
  const b = new PixelBuffer(w, 5);
  for (let x = 0; x < w; x++) {
    b.set(x, 0, pk(R[0]));
    b.set(x, 4, pk(R[0]));
    for (let r = 0; r < 3; r++) {
      const ph = (((x + r) % 4) + 4) % 4;
      b.set(x, r + 1, pk(ph === 0 ? R[3] : ph === 3 ? R[1] : R[2]));
    }
  }
  return b.toCanvas();
}

let knotSprite = null;
function getKnot() {
  if (!knotSprite) knotSprite = asciiSprite(['.lb.', 'lbbd', 'bbdd', '.dd.'], { l: ROPE[3], b: ROPE[2], d: ROPE[1] });
  return knotSprite;
}

export function drawSlider(ctx, x, y, w, value, opts = {}) {
  x = Math.round(x); y = Math.round(y); w = Math.max(24, Math.round(w));
  value = clamp(value || 0, 0, 1);
  const x0 = x + 5, x1 = x + w - 5, ry = y + 6;
  const kx = Math.round(x0 + value * (x1 - x0));
  const rl = x1 - x0;
  if (kx > x0) ctx.drawImage(cached(`rope|${rl}|1`, () => ropeTex(rl, true)), 0, 0, kx - x0, 5, x0, ry, kx - x0, 5);
  if (x1 > kx) ctx.drawImage(cached(`rope|${rl}|0`, () => ropeTex(rl, false)), kx - x0, 0, x1 - kx, 5, kx, ry, x1 - kx, 5);
  const k = getKnot();
  ctx.drawImage(k, x0 - 4, ry - 1);
  ctx.drawImage(k, x1 - 2, ry - 1);
  const B = getBobbers();
  const spr = opts.hover || opts.down ? B.hover : B.normal;
  const by = y + (opts.down ? 0 : opts.hover ? -2 : -1);
  if (opts.hover && !opts.down) {
    ctx.fillStyle = rgba('#fff2b0', 0.35);
    ctx.fillRect(kx - 5, ry + 6, 11, 1);
  }
  ctx.drawImage(spr, kx - Math.floor(spr.width / 2), by);
  return { knob: { x: kx - 5, y: by, w: 11, h: spr.height }, x, y, w, h: SLIDER_H };
}

// ---------------------------------------------------------------- toggle (clam shell)

export const TOGGLE_W = 28, TOGGLE_H = 22;

const SHELL = ['#5a2a3a', '#a85a68', '#e08a86', '#f6b49c', '#ffd8c0', '#fff2e4'];
const SHELL_OFF = SHELL.map((c, i) => (i === 0 ? c : mix(c, '#a89aa0', 0.3)));
const SHELL_IN = ['#6a2a4a', '#c87a98', '#f0a8c0', '#ffc8d8', '#ffe4ec', '#fff6fa'];

// Scallop shell: radial ridges from the hinge at (cx, cy), scalloped rim. flip = opening downward (a bowl).
function shellFan(q, cx, cy, rx, ry, R, flip, inner) {
  const N = 8;
  for (let y = 0; y < TOGGLE_H; y++) {
    for (let x = 0; x < TOGGLE_W; x++) {
      const dx = (x + 0.5 - cx) / rx, dy = ((y + 0.5 - cy) / ry) * (flip ? -1 : 1);
      if (dy > 0.02) continue;
      const a = Math.atan2(-dy, dx), d = Math.hypot(dx, dy);
      const u = (a / (Math.PI / N)) % 1;
      if (d > 0.88 + 0.12 * Math.sin(u * Math.PI)) continue;
      let i;
      if (inner) i = u < 0.14 ? 3 : d > 0.75 ? 4 : 5;
      else {
        i = 3;
        if (u < 0.16) i = 2;
        else if (u > 0.5 && u < 0.8) i = 4;
        if (d < 0.3) i = Math.min(i, 2);
        if (dx > 0.4 && i > 1) i -= 1;
        if (dx < -0.3 && u > 0.45 && u < 0.85 && d > 0.45) i = 5;
      }
      q.set(x, y, pk(R[i]));
    }
  }
}

function toggleTex(on, hover) {
  const layers = [];
  const layer = (draw) => {
    const q = new PixelBuffer(TOGGLE_W, TOGGLE_H);
    draw(q);
    q.outline(outlineFn);
    layers.push(q);
  };
  if (!on) {
    layer((q) => {
      shellFan(q, 14, 18.6, 12.6, 16, SHELL_OFF, false, false);
      for (let x = 10; x < 18; x++) {
        q.set(x, 18, pk(SHELL_OFF[2]));
        q.set(x, 19, pk(x === 10 ? SHELL_OFF[3] : SHELL_OFF[1]));
      }
    });
  } else {
    layer((q) => shellFan(q, 14, 11.5, 12.6, 10.5, SHELL_IN, false, true));
    layer((q) => {
      shellFan(q, 14, 11, 12.6, 9, SHELL, true, false);
      for (let x = 3; x < 25; x++) if (q.get(x, 11) >>> 24) { q.set(x, 11, pk('#ffd2de')); q.set(x, 12, pk('#e89ab4')); }
    });
    layer((q) => {
      for (let y = 5; y < 15; y++) {
        for (let x = 9; x < 19; x++) {
          const dx = x + 0.5 - 14, dy = y + 0.5 - 9.8, d = Math.hypot(dx, dy);
          if (d > 3.6) continue;
          const lit = (-dx - dy) / Math.max(0.01, d * 1.414);
          q.set(x, y, pk(d < 1.3 && lit > 0 ? '#ffffff' : lit > 0.25 ? '#fdf8ff' : lit > -0.4 ? '#e8e0f4' : '#bfb2da'));
        }
      }
      q.set(12, 8, pk('#ffffff'));
    });
  }
  const out = new PixelBuffer(TOGGLE_W, TOGGLE_H);
  for (const q of layers) for (let i = 0; i < q.data.length; i++) if (q.data[i] >>> 24) out.data[i] = q.data[i];
  if (on) for (const [x, y, c] of [[22, 3, '#ffffff'], [21, 3, '#fff8c0'], [23, 3, '#fff8c0'], [22, 2, '#fff8c0'], [22, 4, '#fff8c0'], [5, 5, '#fff8c0']]) out.set(x, y, pk(c));
  if (hover) {
    for (let i = 0; i < out.data.length; i++) {
      const c = out.data[i];
      if (!(c >>> 24)) continue;
      const [r, g, bb] = unpack(c);
      out.data[i] = pk(r + g + bb < 200 ? mix(rgbToHex(r, g, bb), '#7a3a2a', 0.5) : mix(rgbToHex(r, g, bb), '#fff4d8', 0.3));
    }
  }
  return out.toCanvas();
}

export function drawToggle(ctx, x, y, on, opts = {}) {
  const c = cached(`toggle|${!!on}|${!!opts.hover}`, () => toggleTex(!!on, !!opts.hover));
  ctx.drawImage(c, Math.round(x), Math.round(y) + (opts.hover ? -1 : 0));
  return { x, y, w: TOGGLE_W, h: TOGGLE_H };
}

// ---------------------------------------------------------------- bars

export function drawBar(ctx, x, y, w, h, value, opts = {}) {
  x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.max(4, Math.round(h));
  value = clamp(value || 0, 0, 1);
  const color = opts.color || UI_COLORS.good;
  const back = opts.back || '#2a1e2e';
  const O = '#1a1226';
  ctx.fillStyle = O;
  ctx.fillRect(x + 1, y, w - 2, h);
  ctx.fillRect(x, y + 1, w, h - 2);
  const ix = x + 1, iy = y + 1, iw = w - 2, ih = h - 2;
  ctx.fillStyle = back;
  ctx.fillRect(ix, iy, iw, ih);
  ctx.fillStyle = shade(back, -0.45);
  ctx.fillRect(ix, iy, iw, 1);
  ctx.fillStyle = shade(back, 0.18);
  ctx.fillRect(ix, iy + ih - 1, iw, 1);
  const fw = Math.round(iw * value);
  if (fw > 0) {
    ctx.fillStyle = color;
    ctx.fillRect(ix, iy, fw, ih);
    ctx.fillStyle = shade(color, 0.5);
    ctx.fillRect(ix, iy, fw, 1);
    if (ih > 4) {
      ctx.fillStyle = shade(color, 0.22);
      ctx.fillRect(ix, iy + 1, fw, 1);
    }
    ctx.fillStyle = shade(color, -0.32);
    ctx.fillRect(ix, iy + ih - 1, fw, 1);
    if (ih > 5) {
      ctx.fillStyle = rgba('#ffffff', 0.55);
      ctx.fillRect(ix + 2, iy + 1, Math.max(0, Math.min(fw - 4, 6)), 1);
      ctx.fillRect(ix + 9, iy + 1, Math.max(0, Math.min(fw - 11, 2)), 1);
    }
    if (fw < iw) {
      ctx.fillStyle = shade(color, 0.35);
      ctx.fillRect(ix + fw - 1, iy + 1, 1, ih - 2);
    }
    if (ih > 6 && fw > 12) {
      ctx.fillStyle = rgba('#ffffff', 0.5);
      for (let k = 0; k < fw / 14; k++) {
        const bx = ix + 6 + Math.floor(hash1(k, 3) * Math.max(1, fw - 10)), by = iy + 2 + Math.floor(hash1(k, 4) * (ih - 4));
        if (bx < ix + fw - 2) ctx.fillRect(bx, by, 1, 1);
      }
    }
  }
  const seg = opts.segments | 0;
  if (seg > 1) {
    ctx.fillStyle = rgba(O, 0.75);
    for (let i = 1; i < seg; i++) ctx.fillRect(ix + Math.round((iw * i) / seg), iy, 1, ih);
  }
}

// ---------------------------------------------------------------- tooltip

export function tooltipSize(text, opts = {}) {
  const font = opts.font || 'normal';
  const lines = wrapText(text, opts.maxW || 170, font);
  const lh = font === 'small' ? 7 : 10;
  const tw = Math.max(...lines.map((l) => measureText(l, font)));
  const w = tw + 14, h = lines.length * lh + (font === 'small' ? 10 : 11);
  const fold = w > 40 && h > 24;
  return { w: w + (fold ? 5 : 0), h, lines, lh, fold };
}

export function drawTooltip(ctx, x, y, text, opts = {}) {
  const font = opts.font || 'normal';
  const { w, h, lines, lh, fold } = tooltipSize(text, opts);
  const CW = ctx.canvas.width, CH = ctx.canvas.height;
  let tx = Math.round(x + 12), ty = Math.round(y + 14);
  if (tx + w > CW - 3) tx = Math.round(x - w - 6);
  if (ty + h > CH - 4) ty = Math.round(y - h - 8);
  tx = clamp(tx, 3, Math.max(3, CW - w - 3));
  ty = clamp(ty, 6, Math.max(6, CH - h - 4));
  drawPaper(ctx, tx, ty, w, h, { fold });
  const tpx = tx + Math.round(w / 2) - 6;
  ctx.fillStyle = rgba('#f4e0a0', 0.82);
  ctx.fillRect(tpx + 1, ty - 3, 11, 1);
  ctx.fillRect(tpx, ty - 2, 12, 4);
  ctx.fillRect(tpx, ty + 2, 11, 1);
  ctx.fillStyle = rgba('#fff8d8', 0.7);
  ctx.fillRect(tpx + 1, ty - 3, 11, 1);
  ctx.fillStyle = rgba('#b89858', 0.5);
  ctx.fillRect(tpx, ty + 2, 11, 1);
  lines.forEach((l, i) => drawText(ctx, l, tx + 7, ty + 6 + i * lh, { font, color: UI_COLORS.ink }));
  return { x: tx, y: ty, w, h };
}

// ---------------------------------------------------------------- tabs

function tabTex(w, h, color, active) {
  const R = [shade(color, -0.75), shade(color, -0.45), shade(color, -0.2), color, shade(color, 0.3), shade(color, 0.6)];
  const Rr = active ? R : R.map((c) => mix(c, '#4a3a40', 0.38));
  const b = new PixelBuffer(w, h);
  const ins = [3, 1, 1];
  const m = (x, y) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return false;
    const k = y < 3 ? ins[y] : 0;
    return x >= k && x < w - k;
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!m(x, y)) continue;
      const bottom = y === h - 1;
      if (edgeOf(m, x, y) && !(bottom && active && x > 0 && x < w - 1)) { b.set(x, y, pk(Rr[0])); continue; }
      let v = 3.0 + (y < 3 ? 0.9 : 0) - (y / h) * 0.6;
      if (x === 1) v += 0.5;
      if (x === w - 2) v -= 0.6;
      const stitch = (y === 3 && x >= 3 && x <= w - 4) || ((x === 3 || x === w - 4) && y >= 3 && y < h - 2);
      if (stitch && (x + y) % 3 !== 0) v = 4.6;
      if (!active && y >= h - 2) v -= 0.8;
      b.set(x, y, pk(step(v, Rr, x, y)));
    }
  }
  return b.toCanvas();
}

export function drawTab(ctx, x, y, w, h, opts = {}) {
  x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h);
  const active = !!opts.active;
  const color = opts.color || '#d8584a';
  const hov = !active && !!opts.hover;
  const dy = active ? 0 : hov ? 2 : 3;
  const th = h - dy;
  const col = hov ? mix(color, '#fff4e0', 0.18) : color;
  ctx.drawImage(cached(`tab|${w}|${th}|${col}|${active}`, () => tabTex(w, th, col, active)), x, y + dy);
  const ic = iconOf(opts.icon);
  const label = opts.label || '';
  const tw = label ? measureText(label) : 0;
  const iw = ic ? ic.width + (label ? 3 : 0) : 0;
  let cx = x + Math.round((w - tw - iw) / 2);
  const cy = y + dy + Math.round((th - 7) / 2) + 1;
  if (ic) {
    ctx.drawImage(ic, cx, cy + 3 - Math.floor(ic.height / 2));
    cx += iw;
  }
  if (label) drawText(ctx, label, cx, cy, { color: active ? '#fff8ec' : '#e6d6cc', shadow: shade(color, -0.7) });
}

// ---------------------------------------------------------------- window chrome

const TITLE_H = 14, FRAME = 3;

function windowTex(w, h, active) {
  const b = new PixelBuffer(w, h);
  bandFrame(b, w, h, FRAME, CHROME, { r: 1 });
  const T = active ? UI_COLORS.titleActive : UI_COLORS.titleInactive;
  const tx0 = FRAME, ty0 = FRAME, tw = w - FRAME * 2;
  for (let y = ty0; y < ty0 + TITLE_H; y++) {
    for (let x = tx0; x < tx0 + tw; x++) {
      const t = (x - tx0) / Math.max(1, tw - 1), v = t * 2.999, bi = Math.floor(v), bf = v - bi;
      let c = bf > 0.88 && (x + y) % 2 === 0 ? T[Math.min(2, bi + 1)] : T[bi];
      const ly = y - ty0;
      if (ly === 0) c = mix(c, '#ffffff', 0.35);
      else if (ly === 1) c = mix(c, '#ffffff', 0.12);
      else if (ly === TITLE_H - 1) c = shade(c, -0.35);
      else if (ly === TITLE_H - 2 && (x + Math.floor(x / 6)) % 6 < 2) c = mix(c, '#ffffff', 0.22);
      if (active && ly > 2 && ly < TITLE_H - 3 && hash2(x, y, 77) > 0.985 && t > 0.35) c = mix(c, '#ffffff', 0.55);
      b.set(x, y, pk(c));
    }
  }
  const cy0 = ty0 + TITLE_H;
  for (let x = tx0; x < tx0 + tw; x++) b.set(x, cy0, pk(CHROME[3]));
  const ix = FRAME, iy = cy0 + 1, iw = w - FRAME * 2, ih = h - iy - FRAME;
  for (let x = ix; x < ix + iw; x++) { b.set(x, iy, pk(CHROME[1])); b.set(x, iy + ih - 1, pk(CHROME[5])); }
  for (let y = iy; y < iy + ih; y++) { b.set(ix, y, pk(CHROME[1])); b.set(ix + iw - 1, y, pk(CHROME[5])); }
  return b.toCanvas();
}

function chromeButton(ctx, x, y, kind, state) {
  const base = kind === 'close' ? '#e8584a' : '#e6b85e';
  const R = [shade(base, -0.78), shade(base, -0.38), base, shade(base, 0.32), shade(base, 0.62)];
  const S = 11, down = state === 'down', hov = state === 'hover';
  const F = hov ? [R[0], R[2], R[3], R[4], '#fff4d0'] : down ? [R[0], R[0], R[1], R[2], R[2]] : R;
  ctx.fillStyle = F[0];
  ctx.fillRect(x + 1, y, S - 2, S);
  ctx.fillRect(x, y + 1, S, S - 2);
  ctx.fillStyle = F[2];
  ctx.fillRect(x + 1, y + 1, S - 2, S - 2);
  ctx.fillStyle = F[3];
  ctx.fillRect(x + 1, y + 1, S - 2, 4);
  ctx.fillStyle = F[4];
  ctx.fillRect(x + 2, y + 1, S - 4, 1);
  ctx.fillStyle = F[1];
  ctx.fillRect(x + 1, y + S - 2, S - 2, 1);
  const o = down ? 1 : 0;
  const pts = kind === 'close'
    ? [[3, 3], [4, 4], [5, 5], [6, 6], [7, 7], [7, 3], [6, 4], [4, 6], [3, 7]]
    : [[3, 7], [4, 7], [5, 7], [6, 7], [7, 7]];
  ctx.fillStyle = F[0];
  for (const [gx, gy] of pts) ctx.fillRect(x + gx + o, y + gy + 1 + o, 1, 1);
  ctx.fillStyle = '#ffffff';
  for (const [gx, gy] of pts) ctx.fillRect(x + gx + o, y + gy + o, 1, 1);
}

export function drawWindowChrome(ctx, r, opts = {}) {
  const x = Math.round(r.x), y = Math.round(r.y), w = Math.round(r.w), h = Math.round(r.h);
  const active = opts.active !== false;
  if (opts.shadow !== false) {
    ctx.fillStyle = rgba(UI_COLORS.shadow, active ? 0.28 : 0.18);
    ctx.fillRect(x + 4, y + h, w - 2, 3);
    ctx.fillRect(x + w, y + 4, 3, h - 1);
  }
  ctx.drawImage(cached(`win|${w}|${h}|${active}`, () => windowTex(w, h, active)), x, y);
  const titleBar = { x: x + FRAME, y: y + FRAME, w: w - FRAME * 2, h: TITLE_H };
  const close = { x: x + w - FRAME - 13, y: y + FRAME + 1, w: 11, h: 11 };
  const min = { x: close.x - 13, y: close.y, w: 11, h: 11 };
  const content = { x: x + FRAME + 1, y: y + FRAME + TITLE_H + 2, w: w - FRAME * 2 - 2, h: h - FRAME * 2 - TITLE_H - 3 };
  if (opts.fill !== false) {
    ctx.fillStyle = typeof opts.fill === 'string' ? opts.fill : '#f6eedd';
    ctx.fillRect(content.x, content.y, content.w, content.h);
  }
  let tx = titleBar.x + 4;
  if (opts.iconCanvas) {
    const ic = opts.iconCanvas;
    const s = ic.height > 12 ? 12 / ic.height : 1;
    const iw = Math.round(ic.width * s), ih = Math.round(ic.height * s);
    ctx.drawImage(ic, tx - 1, titleBar.y + Math.floor((TITLE_H - ih) / 2), iw, ih);
    tx += iw + 3;
  }
  if (opts.title) {
    const maxW = min.x - tx - 4;
    let t = String(opts.title);
    while (t.length > 1 && measureText(t) > maxW) t = t.slice(0, -2) + '…';
    drawText(ctx, t.replace('…', '..'), tx, titleBar.y + 4, { color: active ? '#ffffff' : '#e4e4ec', shadow: active ? '#0c2a3e' : '#3a3c48' });
  }
  const st = (k) => (opts.down === k ? 'down' : opts.hover === k ? 'hover' : 'normal');
  chromeButton(ctx, min.x, min.y, 'min', st('min'));
  chromeButton(ctx, close.x, close.y, 'close', st('close'));
  return { content, close, min, titleBar };
}

// ---------------------------------------------------------------- taskbar (a little dock)

function taskbarTex(w, h) {
  const b = new PixelBuffer(w, h);
  const R = WOOD_L, beam = 4, bw = 16;
  const boards = [];
  for (let bi = 0; bi <= Math.ceil(w / bw); bi++) {
    const tint = (hash1(bi, 3) - 0.5) * 0.25;
    boards.push(tint > 0 ? R.map((q) => mix(q, shade(q, 0.4), tint * 2)) : R.map((q) => mix(q, shade(q, -0.4), -tint * 2)));
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let c;
      if (y === 0) c = R[0];
      else if (y < beam) {
        c = y === 1 ? R[5] : y === beam - 1 ? R[2] : R[4];
        if (y === 2 && Math.sin(x * 0.21) > 0.6 && Math.sin(x * 0.05) > 0) c = R[3];
      } else if (y === beam) c = R[1];
      else {
        const bi = Math.floor(x / bw), lx = x % bw, seed = bi * 13;
        const P = boards[bi];
        if (lx === 0) c = R[0];
        else {
          c = P[3];
          const gx = lx + Math.sin(y * 0.18 + seed) * 1.2;
          const ph = ((gx + seed) / 3.6) % 1;
          if (ph < 0.22 && Math.sin(y * 0.15 + Math.floor((gx + seed) / 3.6) * 2.3) > -0.3) c = P[2];
          if (lx === 1) c = P[4];
          if (lx === bw - 1) c = P[2];
          if (y === beam + 1) c = P[1];
          else if (y >= h - 2) c = mix(c, P[1], 0.6);
        }
      }
      b.set(x, y, pk(c));
    }
  }
  for (let x = 8; x < w - 2; x += 48) {
    b.set(x, 2, pk('#f4f6fa'));
    b.set(x + 1, 2, pk('#8a92a4'));
    b.set(x + 1, 3, pk(R[1]));
  }
  return b.toCanvas();
}

export function drawTaskbar(ctx, x, y, w, h) {
  w = Math.round(w); h = Math.round(h);
  ctx.fillStyle = rgba('#06121c', 0.3);
  ctx.fillRect(Math.round(x), Math.round(y) - 2, w, 2);
  ctx.drawImage(cached(`taskbar|${w}|${h}`, () => taskbarTex(w, h)), Math.round(x), Math.round(y));
}

// ---------------------------------------------------------------- hanging sign

export function drawPlank(ctx, x, y, w, h, opts = {}) {
  x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h);
  const rope = opts.rope ?? 14;
  const ax = [x + 6, x + w - 8];
  for (const rx of ax) {
    for (let yy = y - rope; yy < y + 4; yy++) {
      const ph = (yy + rx) % 3;
      ctx.fillStyle = ROPE[0];
      ctx.fillRect(rx - 1, yy, 4, 1);
      ctx.fillStyle = ph === 0 ? ROPE[3] : ROPE[2];
      ctx.fillRect(rx, yy, 1, 1);
      ctx.fillStyle = ph === 1 ? ROPE[3] : ROPE[1];
      ctx.fillRect(rx + 1, yy, 1, 1);
    }
    ctx.fillStyle = '#4a5064';
    ctx.fillRect(rx - 1, y - rope - 3, 4, 3);
    ctx.fillStyle = '#c8ccd8';
    ctx.fillRect(rx, y - rope - 3, 2, 1);
    ctx.fillStyle = '#8a92a4';
    ctx.fillRect(rx - 1, y - rope - 2, 1, 1);
  }
  drawWood(ctx, x, y, w, h, { tone: opts.tone, nails: false, round: 2, planks: h < 34 ? 1 : 2, seams: false });
  for (const rx of ax) {
    ctx.fillStyle = '#1e100c';
    ctx.fillRect(rx, y + 3, 2, 2);
    ctx.fillStyle = ROPE[2];
    ctx.fillRect(rx - 1, y + 2, 4, 1);
    ctx.fillStyle = ROPE[3];
    ctx.fillRect(rx, y + 2, 1, 1);
  }
  if (opts.label) {
    drawText(ctx, opts.label, x + Math.round(w / 2), y + Math.round((h - 7) / 2) + 1, { align: 'center', color: '#fff4dc', shadow: '#2a140e' });
  }
  return { x: x + 4, y: y + 6, w: w - 8, h: h - 9 };
}

// ---------------------------------------------------------------- rubber stamp

function stampTex(text, color, angle, font) {
  const tw = measureText(text, font), capH = font === 'small' ? 5 : 7;
  const bw = tw + 15, bh = capH + 12;
  const src = makeCanvas(bw, bh);
  const g = ctxOf(src);
  g.fillStyle = '#000';
  g.fillRect(2, 0, bw - 4, 2); g.fillRect(2, bh - 2, bw - 4, 2);
  g.fillRect(0, 2, 2, bh - 4); g.fillRect(bw - 2, 2, 2, bh - 4);
  g.fillRect(1, 1, 1, 1); g.fillRect(bw - 2, 1, 1, 1); g.fillRect(1, bh - 2, 1, 1); g.fillRect(bw - 2, bh - 2, 1, 1);
  g.fillRect(4, 3, bw - 8, 1); g.fillRect(4, bh - 4, bw - 8, 1);
  g.fillRect(3, 4, 1, bh - 8); g.fillRect(bw - 4, 4, 1, bh - 8);
  drawText(g, text, 7, 6, { font, color: '#ff0000' });
  const sd = g.getImageData(0, 0, bw, bh).data;
  const a1 = -Math.tan(angle / 2), b1 = Math.sin(angle);
  const D = Math.ceil(Math.hypot(bw, bh)) + 4, cx = Math.floor(bw / 2), cy = Math.floor(bh / 2), o = Math.floor(D / 2);
  const out = new PixelBuffer(D, D);
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      const si = (y * bw + x) * 4;
      if (sd[si + 3] < 128) continue;
      const isText = sd[si] > 128;
      let X = x - cx, Y = y - cy;
      X += Math.round(a1 * Y);
      Y += Math.round(b1 * X);
      X += Math.round(a1 * Y);
      const ox = X + o, oy = Y + o;
      const hs = hash2(ox, oy, 17), blot = hash2(ox >> 2, oy >> 2, 19);
      if (isText ? hs > 0.985 : hs > 0.94 || (blot > 0.88 && hs > 0.5)) continue;
      out.set(ox, oy, pk(color, !isText && (hs > 0.8 || blot > 0.8) ? 150 : 235));
    }
  }
  return out.toCanvas();
}

export function drawStamp(ctx, x, y, text, opts = {}) {
  const color = opts.color || '#d8383a';
  let angle = opts.angle ?? -0.14;
  if (Math.abs(angle) > Math.PI) angle = (angle * Math.PI) / 180;
  angle = Math.round(angle * 100) / 100;
  const font = opts.font || 'normal';
  const c = cached(`stamp|${text}|${color}|${angle}|${font}`, () => stampTex(String(text), color, angle, font), volatileTex, 96);
  const k = opts.scale || 1;
  if (k === 1) ctx.drawImage(c, Math.round(x - c.width / 2), Math.round(y - c.height / 2));
  else {
    const dw = Math.round(c.width * k), dh = Math.round(c.height * k);
    ctx.drawImage(c, Math.round(x - dw / 2), Math.round(y - dh / 2), dw, dh);
  }
}

// ---------------------------------------------------------------- picture frames

function frameTex(w, h, style) {
  const b = new PixelBuffer(w, h);
  if (style === 'gold') {
    const fw = 5;
    bandFrame(b, w, h, fw, GOLD, { r: 1 });
    for (let x = 0; x < w; x++) {
      for (const yy of [2, h - 3]) if (x > 4 && x < w - 5 && x % 3 === 0) b.set(x, yy, pk(GOLD[5]));
    }
    for (let y = 0; y < h; y++) {
      for (const xx of [2, w - 3]) if (y > 4 && y < h - 5 && y % 3 === 0) b.set(xx, y, pk(GOLD[5]));
    }
    for (const [cx, cy] of [[2, 2], [w - 3, 2], [2, h - 3], [w - 3, h - 3]]) {
      for (const [dx, dy, c] of [[0, -1, 5], [-1, 0, 5], [1, 0, 3], [0, 1, 3], [0, 0, 1], [-1, -1, 4], [1, 1, 2], [1, -1, 4], [-1, 1, 3]]) b.set(cx + dx, cy + dy, pk(GOLD[c]));
    }
    return b.toCanvas();
  }
  if (style === 'coral') {
    const fw = 6;
    const bump = (x, y) => {
      const k = hash2(x >> 2, y >> 2, 31);
      return k > 0.55 ? 1 : 0;
    };
    const outer = (x, y) => {
      if (x < 0 || y < 0 || x >= w || y >= h) return false;
      const d = Math.min(x, y, w - 1 - x, h - 1 - y);
      const corner = (x < 3 || x > w - 4) && (y < 3 || y > h - 4);
      if (corner) return Math.hypot(Math.min(x, w - 1 - x) - 3, Math.min(y, h - 1 - y) - 3) < 3.6;
      return d >= 1 - bump(x, y) || d >= 1;
    };
    const inner = (x, y) => x >= fw && y >= fw && x < w - fw && y < h - fw;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!outer(x, y) || inner(x, y)) continue;
        const d = Math.min(x, y, w - 1 - x, h - 1 - y);
        if (d === 0 && !bump(x, y)) continue;
        let v;
        const shape = (xx, yy) => outer(xx, yy) && !inner(xx, yy) && !(Math.min(xx, yy, w - 1 - xx, h - 1 - yy) === 0 && !bump(xx, yy));
        if (edgeOf(shape, x, y)) v = 0;
        else {
          const side = d === y ? 't' : d === x ? 'l' : d === h - 1 - y ? 'b' : 'r';
          v = 3.0 + (side === 't' || side === 'l' ? 0.8 : -0.5) - (d === fw - 1 ? 0.8 : 0);
          const hp = hash2(x, y, 5);
          if (hp > 0.86) v = 1.5;
          else if (hp > 0.78) v += 0.9;
        }
        b.set(x, y, pk(step(v, CORAL, x, y)));
      }
    }
    return b.toCanvas();
  }
  const fw = 5;
  bandFrame(b, w, h, fw, WOOD_L, { r: 0, grain: true });
  for (let k = 1; k < fw; k++) {
    b.set(k, k, pk(WOOD_L[1]));
    b.set(w - 1 - k, k, pk(WOOD_L[1]));
    b.set(k, h - 1 - k, pk(WOOD_L[1]));
    b.set(w - 1 - k, h - 1 - k, pk(WOOD_L[1]));
  }
  return b.toCanvas();
}

export function drawFrame(ctx, x, y, w, h, opts = {}) {
  x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h);
  const style = opts.style === 'gold' || opts.style === 'coral' ? opts.style : 'wood';
  if (w >= 14 && h >= 14) ctx.drawImage(cached(`frame|${w}|${h}|${style}`, () => frameTex(w, h, style)), x, y);
  const fw = style === 'coral' ? 6 : 5;
  return { x: x + fw, y: y + fw, w: w - fw * 2, h: h - fw * 2 };
}
