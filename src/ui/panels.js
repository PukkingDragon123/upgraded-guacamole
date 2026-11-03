// Frutiger Aero UI surfaces & widgets: glossy glass panels, frosted cards, pill buttons, bubbles, chrome.
// Built on the pixel-crisp Aero rasteriser in ./aero.js (hard rounded edges, smooth gradients, specular
// sheen, inner white rim, reflected bottom glow, bubbles, lens-flare sparkles); every texture is cached.
// The function names are historical (drawWood, drawPaper ...); the look is 100% Aero.
//
// drawWood(ctx,x,y,w,h,{tone:'light'|'dark', inset=false, round=1, planks, nails, seams})   glossy glass panel
//   (light = sky glass, dark = deep ocean glass, inset = recessed glass well; planks>1 = glass shelf lines)
// drawPaper(ctx,x,y,w,h,{torn, lined, aged, fold})   frosted white glass card (+1 px shadow right, +2 below)
// drawGlass(ctx,x,y,w,h,{tint, frame:false|true|'brass'|'wood'})                        -> inner rect
// drawBottle(ctx,x,y,w,h,{tint, note=true})  glass capsule                               -> inner rect
// drawBubble(ctx,x,y,w,h,{tailX,tailY, style:'speech'|'thought'})                       -> content rect
// drawWaterBubble(ctx,cx,cy,r)
// drawButton(ctx,x,y,w,h,{label, icon (name|canvas), state:'normal'|'hover'|'down'|'disabled',
//   style:'wood'|'shell'|'paper'|'glass'|'coral' (or an Aero tone: 'aqua'|'green'|'orange'|'red'|'purple'|'white'|'clear'),
//   font, align:'center'|'left'})   pill buttons; an icon-only 'cross' button becomes a red close orb
//   (labels that do not fit are truncated with '..')
// buttonSize(label,{icon,font}) -> {w,h}
// drawSlider(ctx,x,y,w,value,{hover, down}) (height SLIDER_H)                            -> {knob}
// drawToggle(ctx,x,y,on,{hover}) (TOGGLE_W x TOGGLE_H)  glossy switch
// drawBar(ctx,x,y,w,h,value,{color, back, segments})
// drawTooltip(ctx,x,y,text,{maxW, font}) auto-placed near (x,y) inside the canvas          -> rect
// drawTab(ctx,x,y,w,h,{label, icon, active, hover, color})
// drawWindowChrome(ctx,{x,y,w,h},{title, iconCanvas, active=true, hover:'close'|'min'|null, down, fill, shadow=true})
//   -> {content, close, min, titleBar};  windowRects({x,y,w,h}) -> the same rects without drawing
// drawTaskbar(ctx,x,y,w,h)
// drawPlank(ctx,x,y,w,h,{rope, tone, label})  glossy title pill                          -> inner rect
// drawStamp(ctx,x,y,text,{color, angle (radians; |a|>π is read as degrees), font, scale})   glossy sticker centred on x,y
// drawFrame(ctx,x,y,w,h,{style:'wood'|'gold'|'coral'})  glossy picture frame               -> inner rect

import { makeCanvas, ctxOf } from '../core/canvas.js';
import { PixelBuffer } from '../gfx/pixel.js';
import { pack, shade, mix, rgba, luminance } from '../core/color.js';
import { clamp, hash2 } from '../core/math.js';
import { drawText, measureText, wrapText } from '../gfx/font.js';
import { getUiIcon } from '../gfx/uiicons.js';
import {
  AERO, aeroSurface, aeroCached, drawAeroButton, drawAeroBar, drawAeroBubble, drawGlossOrb, toneOf, toneFrom, aeroText, drawSparkle,
} from './aero.js';

const SKY = ['#0b3f74', '#1a68b0', '#2f8fdc', '#5cc0f4', '#9ee2ff', '#e4f8ff'];
const DEEP = ['#031634', '#082650', '#123f7c', '#1a5ea8', '#3c94d8', '#8fd0ff'];
const FROST = ['#5a8cac', '#9cc8e0', '#cfe9f7', '#e6f6fd', '#f4fbff', '#ffffff'];
const CHROME = ['#2a4258', '#5a7c96', '#8fb0c8', '#c4dcea', '#e6f3fa', '#ffffff'];
const GOLD = ['#5a3608', '#a8680e', '#e0a020', '#ffd04a', '#ffe98a', '#fffbd8'];
const GRASS = ['#164e0e', '#2c8a1c', '#5cc234', '#94e05a', '#c8f590', '#f0ffd8'];

export const UI_COLORS = {
  ink: AERO.ink,
  inkSoft: AERO.inkSoft,
  inkShadow: '#ffffff',
  text: '#ffffff',
  textShadow: '#0a3e74',
  textDim: '#bfe6ff',
  outline: '#0b2a44',
  wood: SKY,
  woodDark: DEEP,
  paper: FROST,
  brass: CHROME,
  gold: GOLD,
  coral: GRASS,
  chrome: CHROME,
  glass: '#9fe6ff',
  sea: '#1f8fc6',
  seaDeep: '#0a3a6e',
  accent: '#ffd25a',
  good: '#4cd06a',
  bad: '#ff4f5e',
  warn: '#ffad33',
  info: '#3ab4ff',
  coin: '#2fd3e8',
  hover: '#e8fbff',
  disabled: '#9aa8b8',
  titleActive: ['#1a6ac0', '#38a8ec', '#8fe0ff'],
  titleInactive: ['#6a8098', '#8aa0b6', '#b4c6d6'],
  shadow: '#06243e',
};

const iconOf = (icon) => (!icon ? null : typeof icon === 'string' ? getUiIcon(icon) : icon);

// Copy of a texture with a soft offset drop shadow baked in (canvas grows by dx, dy).
function withShadow(src, dx, dy, alpha, color = '#06243e') {
  const c = makeCanvas(src.width + dx, src.height + dy);
  const g = ctxOf(c);
  g.drawImage(src, dx, dy);
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = rgba(color, alpha);
  g.fillRect(0, 0, c.width, c.height);
  g.globalCompositeOperation = 'source-over';
  g.drawImage(src, 0, 0);
  return c;
}

// Punch a rounded hole (destination-out) and optionally fill it with another texture.
function withHole(outer, hx, hy, hw, hh, r, inner) {
  const c = makeCanvas(outer.width, outer.height);
  const g = ctxOf(c);
  g.drawImage(outer, 0, 0);
  g.globalCompositeOperation = 'destination-out';
  g.drawImage(aeroSurface(hw, hh, { top: '#000000', mid: '#000000', bot: '#000000', edge: '#000000', r, gloss: 0, rim: 0, glow: 0 }), hx, hy);
  g.globalCompositeOperation = 'source-over';
  if (inner) g.drawImage(inner, hx, hy);
  return c;
}

// ---------------------------------------------------------------- panels ("wood")

export function drawWood(ctx, x, y, w, h, opts = {}) {
  w = Math.round(w); h = Math.round(h);
  if (w < 3 || h < 3) return;
  const dark = opts.tone === 'dark', inset = !!opts.inset;
  const round = opts.round ?? 1;
  const r = Math.min(round <= 0 ? 2 : round === 1 ? 7 : 9, Math.floor(h / 2));
  const planks = opts.planks | 0;
  const key = `wood|${w}|${h}|${dark}|${inset}|${r}|${planks}`;
  const c = aeroCached(key, () => {
    let o;
    if (inset) {
      o = dark
        ? { top: '#06264a', mid: '#0c3866', bot: '#164c80', a: [0.72, 0.62], edge: '#021630', edgeA: 0.8, gloss: 0, rim: 0.25, glow: 0.35, glowColor: '#5ac8ff', inset: true }
        : { top: '#1a5a96', mid: '#2a78b8', bot: '#3a90cc', a: [0.6, 0.5], edge: '#0b3f74', edgeA: 0.75, gloss: 0, rim: 0.3, glow: 0.4, glowColor: '#9fe6ff', inset: true };
    } else {
      o = { tone: dark ? 'dark' : 'sky', gloss: h > 60 ? 0.42 : 0.55, glossH: Math.min(22, Math.round(h * 0.42)), rim: 0.85, glow: 0.5, streak: w > 100 && h > 40, bubbles: w * h > 24000 ? 4 : w * h > 6000 ? 2 : 0, sparkle: w > 70 && h > 40 ? 2 : 0 };
    }
    let tex = aeroSurface(w, h, { ...o, r, seed: w + h * 3 });
    if (planks > 1) {
      // glass shelf lines
      const cc = makeCanvas(w, h);
      const g = ctxOf(cc);
      g.drawImage(tex, 0, 0);
      for (let i = 1; i < planks; i++) {
        const yy = Math.round((i * h) / planks);
        g.fillStyle = 'rgba(2,24,52,0.35)'; g.fillRect(3, yy - 1, w - 6, 1);
        g.fillStyle = 'rgba(255,255,255,0.45)'; g.fillRect(3, yy, w - 6, 1);
      }
      tex = cc;
    }
    return tex;
  });
  ctx.drawImage(c, Math.round(x), Math.round(y));
}

// ---------------------------------------------------------------- frosted cards ("paper")

export function drawPaper(ctx, x, y, w, h, opts = {}) {
  w = Math.round(w); h = Math.round(h);
  if (w < 4 || h < 4) return;
  const lined = !!opts.lined, aged = !!opts.aged, fold = !!opts.fold;
  const c = aeroCached(`paper|${w}|${h}|${lined}|${aged}|${fold}`, () => {
    const base = aeroSurface(w, h, { tone: 'frost', r: Math.min(6, Math.floor(h / 2)), gloss: 0.3, glossH: Math.min(16, Math.round(h * 0.3)), curve: 2, rim: 0.9, glow: 0.3, glowColor: '#bfeaff', bubbles: aged && w * h > 12000 ? 3 : 0, seed: w * 3 + h });
    const cc = makeCanvas(w, h);
    const g = ctxOf(cc);
    g.drawImage(base, 0, 0);
    if (lined) {
      g.fillStyle = 'rgba(80,170,220,0.32)';
      for (let yy = 13; yy < h - 4; yy += 10) g.fillRect(4, yy, w - 8, 1);
      g.fillStyle = 'rgba(120,210,140,0.4)';
      g.fillRect(10, 3, 1, h - 6);
    }
    if (fold) {
      // glossy page curl at the top-right corner
      const F = clamp(Math.round(Math.min(w, h) * 0.2), 4, 10);
      g.clearRect(w - F, 0, F, F);
      for (let i = 0; i < F; i++) for (let j = 0; j <= i; j++) {
        const px = w - F + j, py = i;
        const t = (i + j) / (2 * F);
        g.fillStyle = j === i || i === F - 1 ? '#5aa2cc' : mix('#ffffff', '#9fd8f2', t);
        if (px - (w - F) <= py) g.fillRect(px, py, 1, 1);
      }
    }
    return withShadow(cc, 1, 2, 0.22);
  });
  ctx.drawImage(c, Math.round(x), Math.round(y));
}

// ---------------------------------------------------------------- glass panes

function glassPane(w, h, tint, framed) {
  return aeroSurface(w, h, {
    top: mix(tint, '#ffffff', 0.55), mid: tint, bot: shade(tint, -0.3), a: [0.42, 0.58], edge: framed ? shade(tint, -0.55) : '#0b4a7a', edgeA: framed ? 0.6 : 0.85,
    r: framed ? 2 : 4, gloss: 0.5, glossH: Math.min(18, Math.round(h * 0.4)), rim: 0.6, glow: 0.4, glowColor: mix(tint, '#ffffff', 0.6), streak: true, bubbles: w * h > 3000 ? 2 : 0,
  });
}

export function drawGlass(ctx, x, y, w, h, opts = {}) {
  w = Math.round(w); h = Math.round(h);
  const tint = opts.tint || UI_COLORS.glass;
  const frame = opts.frame === true ? 'brass' : opts.frame || false;
  if (w >= 6 && h >= 6) {
    const c = aeroCached(`glass|${w}|${h}|${tint}|${frame}`, () => {
      if (!frame) return glassPane(w, h, tint, false);
      const rim = aeroSurface(w, h, { tone: frame === 'wood' ? 'aqua' : 'white', r: 5, gloss: 0.7, glossH: Math.round(h * 0.45), rim: 0.9, glow: 0.6 });
      return withHole(rim, 3, 3, w - 6, h - 6, 2, glassPane(w - 6, h - 6, tint, true));
    });
    ctx.drawImage(c, Math.round(x), Math.round(y));
  }
  const fw = frame ? 3 : 2;
  return { x: x + fw, y: y + fw, w: w - fw * 2, h: h - fw * 2 };
}

// ---------------------------------------------------------------- capsule ("bottle")

function bottleGeom(w, h) {
  const neckL = clamp(Math.round(h * 0.42) + 3, 6, 18);
  const shL = clamp(Math.round(h * 0.35), 3, 12);
  return { neckL, shL, bodyEnd: w - neckL - shL };
}

export function drawBottle(ctx, x, y, w, h, opts = {}) {
  w = Math.round(w); h = Math.round(h);
  const tint = opts.tint || '#8ee0c0';
  const note = opts.note !== false;
  if (w >= 24 && h >= 10) {
    const c = aeroCached(`bottle|${w}|${h}|${tint}|${note}`, () => {
      const cc = makeCanvas(w, h);
      const g = ctxOf(cc);
      const capW = Math.max(5, Math.round(h * 0.45));
      g.drawImage(aeroSurface(w - capW + Math.round(h / 2), h, { top: mix(tint, '#ffffff', 0.6), mid: tint, bot: shade(tint, -0.3), a: [0.55, 0.7], edge: shade(tint, -0.6), r: 'pill', gloss: 0.75, glossH: Math.round(h * 0.42), rim: 0.7, glow: 0.6 }), 0, 0);
      g.drawImage(aeroSurface(capW, Math.max(6, h - 4), { tone: 'aqua', r: Math.min(5, Math.floor(capW / 2)), gloss: 0.8, glossH: Math.round(h * 0.34), curve: 1, rim: 0.85, glow: 0.6 }), w - capW, 2);
      if (note) {
        const { bodyEnd } = bottleGeom(w, h);
        const nx = 6, ny = Math.round(h * 0.34), nw = Math.max(6, bodyEnd - 8), nh = Math.max(3, Math.round(h * 0.32));
        g.drawImage(aeroSurface(nw, nh, { tone: 'frost', r: 1, gloss: 0.3, rim: 0.4, glow: 0 }), nx, ny);
        g.fillStyle = AERO.aqua; g.fillRect(nx + Math.round(nw / 2), ny, 1, nh);
      }
      return cc;
    });
    ctx.drawImage(c, Math.round(x), Math.round(y));
  }
  const { bodyEnd } = bottleGeom(w, h);
  return { x: x + 4, y: y + 4, w: bodyEnd - 6, h: h - 8 };
}

// ---------------------------------------------------------------- speech bubble

const INSETS = { 0: [], 1: [1], 2: [2, 1], 3: [3, 1, 1], 4: [4, 2, 1, 1], 5: [5, 3, 2, 1, 1], 6: [6, 4, 3, 2, 1, 1] };
function rr(w, h, r) {
  const ins = INSETS[r] || [];
  return (x, y) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return false;
    const d = Math.min(y, h - 1 - y);
    const k = d < ins.length ? ins[d] : 0;
    return x >= k && x < w - k;
  };
}

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
  const body = rr(w, h, h >= 20 ? 6 : h >= 14 ? 4 : 2);
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
  const edgeOf = (m, x, y) => !m(x - 1, y) || !m(x + 1, y) || !m(x, y - 1) || !m(x, y + 1);
  const b = new PixelBuffer(CW, CH);
  const sh = pack('#06345a', 60);
  for (let y = 0; y < CH; y++) for (let x = 0; x < CW; x++) if (!shape(x, y) && shape(x - 1, y - 2)) b.set(x, y, sh);
  const glossH = Math.min(10, Math.round(h * 0.42));
  for (let y = 0; y < CH; y++) {
    for (let x = 0; x < CW; x++) {
      if (!shape(x, y)) continue;
      const by = y - oy;
      let c;
      if (edgeOf(shape, x, y)) c = '#3f8fc4';
      else if (!shape(x, y - 1) || !shape(x - 1, y) || !shape(x, y - 2)) c = '#ffffff';
      else if (!shape(x, y + 1)) c = '#bfe6f8';
      else {
        const t = clamp(by / Math.max(1, h), 0, 1);
        c = by < glossH ? mix('#ffffff', '#f4fbff', by / glossH) : mix('#e8f6fd', '#d2eefa', t);
      }
      b.set(x, y, pack(c));
    }
  }
  if (w > 14 && h > 10) {
    const sx = ox + 4, sy = oy + 3;
    b.set(sx, sy, pack('#ffffff')); b.set(sx + 1, sy, pack('#c8f0ff')); b.set(sx, sy + 1, pack('#c8f0ff'));
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
  const c = aeroCached(`bubble|${w}|${h}|${tx}|${ty}|${style}`, () => bubbleTex(w, h, tx ?? w / 2, ty ?? h / 2, style));
  ctx.drawImage(c, x - c.ox, y - c.oy);
  return { x: x + 5, y: y + 4, w: w - 10, h: h - 8 };
}

export function drawWaterBubble(ctx, cx, cy, r) {
  drawAeroBubble(ctx, cx, cy, r);
}

// ---------------------------------------------------------------- buttons

const STYLE_TONE = { wood: 'aqua', coral: 'green', shell: 'white', paper: 'white', glass: 'clear' };

export function buttonSize(label = '', opts = {}) {
  const font = opts.font || 'normal';
  const ic = iconOf(opts.icon);
  const tw = label ? measureText(label, font) : 0;
  const iw = ic ? ic.width + (label ? 4 : 0) : 0;
  const h = font === 'small' ? 15 : 19;
  return { w: Math.max(h, tw + iw + 16), h };
}

export function drawButton(ctx, x, y, w, h, opts = {}) {
  const style = opts.style || 'wood';
  let tone = STYLE_TONE[style] || style;
  const closeBtn = !opts.label && (opts.icon === 'cross');
  if (closeBtn) tone = 'red';
  const ic = iconOf(opts.icon);
  drawAeroButton(ctx, x, y, w, h, { label: opts.label, icon: ic, state: opts.state || 'normal', tone, font: opts.font, align: opts.align, radius: closeBtn ? Math.floor(Math.min(w, h) / 2) : undefined });
}

// ---------------------------------------------------------------- slider (glass track + pearl knob)

export const SLIDER_H = 15;

export function drawSlider(ctx, x, y, w, value, opts = {}) {
  x = Math.round(x); y = Math.round(y); w = Math.max(24, Math.round(w));
  value = clamp(value || 0, 0, 1);
  const x0 = x + 5, x1 = x + w - 5, ty = y + 4, th = 7;
  const kx = Math.round(x0 + value * (x1 - x0));
  ctx.drawImage(aeroSurface(w - 4, th, { top: '#0e3e64', mid: '#1c5a86', bot: '#3a86b4', a: [0.55, 0.45], edge: '#06243e', edgeA: 0.7, r: 'pill', gloss: 0, rim: 0, glow: 0.4, glowColor: '#bff0ff', inset: true }), x + 2, ty);
  const fw = kx - (x + 3);
  if (fw > 2) {
    const fill = aeroSurface(w - 6, th - 2, { tone: 'aqua', r: 'pill', gloss: 0.7, glossH: 2, curve: 0, rim: 0.4, glow: 0.6 });
    ctx.drawImage(fill, 0, 0, fw, th - 2, x + 3, ty + 1, fw, th - 2);
  }
  const hot = opts.hover || opts.down;
  if (hot) {
    ctx.fillStyle = 'rgba(191,244,255,0.35)';
    ctx.fillRect(kx - 7, y + 2, 15, 11);
    ctx.fillRect(kx - 5, y, 11, 15);
  }
  drawGlossOrb(ctx, kx + 0.5, y + 7.5, opts.down ? 5 : 5.5, hot ? '#d8f8ff' : '#a8e4ff');
  return { knob: { x: kx - 6, y: y + 1, w: 13, h: 13 }, x, y, w, h: SLIDER_H };
}

// ---------------------------------------------------------------- toggle (glossy switch)

export const TOGGLE_W = 28, TOGGLE_H = 22;

export function drawToggle(ctx, x, y, on, opts = {}) {
  x = Math.round(x); y = Math.round(y) + (opts.hover ? -1 : 0);
  const hov = !!opts.hover;
  const c = aeroCached(`toggle|${!!on}|${hov}`, () => {
    const cc = makeCanvas(TOGGLE_W, TOGGLE_H);
    const g = ctxOf(cc);
    const tone = on ? (hov ? { ...toneOf('green'), top: '#eaffc0' } : 'green') : (hov ? { ...toneOf('glass'), bot: '#a8d8f0' } : { ...toneOf('glass'), bot: '#9cc4dc', mid: '#d4ecf8' });
    g.drawImage(aeroSurface(TOGGLE_W, 14, { tone, r: 'pill', gloss: 0.7, glossH: 6, curve: 1, rim: 0.7, glow: 0.6, inset: !on }), 0, 4);
    // tiny on/off glyphs
    g.fillStyle = on ? 'rgba(255,255,255,0.9)' : 'rgba(60,111,136,0.7)';
    if (on) g.fillRect(8, 8, 1, 6);
    else { g.fillRect(17, 8, 3, 1); g.fillRect(17, 13, 3, 1); g.fillRect(16, 9, 1, 4); g.fillRect(20, 9, 1, 4); }
    drawGlossOrb(g, on ? TOGGLE_W - 7 : 7, 11, 6.5, on ? '#ffffff' : '#e8f4fa');
    return cc;
  });
  ctx.drawImage(c, x, y);
  return { x, y, w: TOGGLE_W, h: TOGGLE_H };
}

// ---------------------------------------------------------------- bars

export function drawBar(ctx, x, y, w, h, value, opts = {}) {
  const back = opts.back && luminance(opts.back) > 0.45 ? '#9fcfe8' : undefined;
  drawAeroBar(ctx, x, y, w, Math.max(4, Math.round(h)), value, { color: opts.color || UI_COLORS.good, back, segments: opts.segments });
}

// ---------------------------------------------------------------- tooltip

export function tooltipSize(text, opts = {}) {
  const font = opts.font || 'normal';
  const lines = wrapText(text, opts.maxW || 170, font);
  const lh = font === 'small' ? 7 : 10;
  const tw = Math.max(...lines.map((l) => measureText(l, font)));
  const w = tw + 14, h = lines.length * lh + (font === 'small' ? 10 : 11);
  return { w, h, lines, lh, fold: false };
}

export function drawTooltip(ctx, x, y, text, opts = {}) {
  const font = opts.font || 'normal';
  const { w, h, lines, lh } = tooltipSize(text, opts);
  const CW = ctx.canvas.width, CH = ctx.canvas.height;
  let tx = Math.round(x + 12), ty = Math.round(y + 14);
  if (tx + w > CW - 3) tx = Math.round(x - w - 6);
  if (ty + h > CH - 4) ty = Math.round(y - h - 8);
  tx = clamp(tx, 3, Math.max(3, CW - w - 3));
  ty = clamp(ty, 3, Math.max(3, CH - h - 4));
  const c = aeroCached(`tip|${w}|${h}`, () => withShadow(aeroSurface(w, h, { tone: 'frost', r: Math.min(6, Math.floor(h / 2)), gloss: 0.45, glossH: Math.min(9, Math.round(h * 0.45)), curve: 1, rim: 0.9, glow: 0.35, glowColor: '#bfeaff' }), 1, 2, 0.25));
  ctx.drawImage(c, tx, ty);
  lines.forEach((l, i) => drawText(ctx, l, tx + 7, ty + 6 + i * lh, { font, color: UI_COLORS.ink }));
  return { x: tx, y: ty, w, h };
}

// ---------------------------------------------------------------- tabs

export function drawTab(ctx, x, y, w, h, opts = {}) {
  x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h);
  const active = !!opts.active;
  const color = opts.color || '#2f9ee8';
  const hov = !active && !!opts.hover;
  const dy = active ? 0 : hov ? 2 : 3;
  const th = h - dy;
  const tone = active ? toneFrom(color) : hov ? { ...toneOf('clear'), top: '#ffffff', a: [0.85, 0.7] } : toneOf('clear');
  const c = aeroCached(`tab|${w}|${th}|${color}|${active}|${hov}`, () => aeroSurface(w, th, { tone, r: Math.min(6, Math.floor(th / 2)), shape: 'tab', gloss: active ? 0.7 : 0.5, glossH: Math.round(th * 0.48), curve: 1, rim: 0.8, glow: 0.4 }));
  ctx.drawImage(c, x, y + dy);
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
  if (label) drawText(ctx, label, cx, cy, { color: '#ffffff', shadow: active ? shade(color, -0.65) : '#0a4a7e' });
}

// ---------------------------------------------------------------- window chrome (Aero glass)

const TITLE_H = 14, FRAME = 3;

function windowTex(w, h, active) {
  const tone = active
    ? { top: '#c4f0ff', mid: '#6cc8f4', bot: '#2e8ed8', edge: '#0b3f74', a: [0.97, 0.95], glow: '#bff6ff' }
    : { top: '#e4eef6', mid: '#a8c4d8', bot: '#7e9cb6', edge: '#3a5670', a: [0.95, 0.92], glow: '#e8f2fa' };
  const frame = aeroSurface(w, h, { tone, r: 6, gloss: 0.55, glossH: TITLE_H + FRAME - 2, curve: 3, rim: 0.85, glow: 0.35, streak: true, sparkle: active ? 2 : 0, seed: w });
  const c = makeCanvas(w, h);
  const g = ctxOf(c);
  g.drawImage(frame, 0, 0);
  // inner content well edge
  const cx = FRAME, cy = FRAME + TITLE_H + 1, cw = w - FRAME * 2, ch = h - cy - FRAME;
  g.fillStyle = active ? 'rgba(6,46,90,0.55)' : 'rgba(40,64,90,0.45)';
  g.fillRect(cx, cy - 1, cw, 1); g.fillRect(cx - 1, cy, 1, ch); g.fillRect(cx + cw, cy, 1, ch);
  g.fillStyle = 'rgba(255,255,255,0.6)';
  g.fillRect(cx, cy + ch, cw, 1);
  return c;
}

function chromeButton(ctx, x, y, kind, state) {
  const S = 11;
  const tone = kind === 'close' ? 'red' : 'clear';
  const st = state === 'down' ? 'down' : state === 'hover' ? 'hover' : 'normal';
  drawAeroButton(ctx, x - (kind === 'close' ? 2 : 1), y, S + (kind === 'close' ? 3 : 1), S, { tone, state: st, radius: 3 });
  const o = state === 'down' ? 1 : 0;
  const cx = x + (kind === 'close' ? -1 : 0);
  const pts = kind === 'close'
    ? [[3, 3], [4, 4], [5, 5], [6, 6], [7, 7], [7, 3], [6, 4], [4, 6], [3, 7]]
    : [[3, 7], [4, 7], [5, 7], [6, 7], [7, 7]];
  ctx.fillStyle = kind === 'close' ? '#7a0c1a' : '#0a3e74';
  for (const [gx, gy] of pts) ctx.fillRect(cx + gx + o + 1, y + gy + o, 1, 1);
  ctx.fillStyle = '#ffffff';
  for (const [gx, gy] of pts) ctx.fillRect(cx + gx + o + 1, y + gy + o - 1, 1, 1);
}

// The chrome's hit rects for a window rect (same numbers drawWindowChrome returns).
export function windowRects(r) {
  const x = Math.round(r.x), y = Math.round(r.y), w = Math.round(r.w), h = Math.round(r.h);
  const close = { x: x + w - FRAME - 13, y: y + FRAME + 1, w: 11, h: 11 };
  return {
    titleBar: { x: x + FRAME, y: y + FRAME, w: w - FRAME * 2, h: TITLE_H },
    close,
    min: { x: close.x - 13, y: close.y, w: 11, h: 11 },
    content: { x: x + FRAME + 1, y: y + FRAME + TITLE_H + 2, w: w - FRAME * 2 - 2, h: h - FRAME * 2 - TITLE_H - 3 },
  };
}

export function drawWindowChrome(ctx, r, opts = {}) {
  const x = Math.round(r.x), y = Math.round(r.y), w = Math.round(r.w), h = Math.round(r.h);
  const active = opts.active !== false;
  if (opts.shadow !== false) {
    ctx.fillStyle = rgba(UI_COLORS.shadow, active ? 0.22 : 0.14);
    ctx.fillRect(x + 5, y + h, w - 6, 2);
    ctx.fillRect(x + w, y + 5, 2, h - 6);
    ctx.fillStyle = rgba(UI_COLORS.shadow, active ? 0.12 : 0.08);
    ctx.fillRect(x + 6, y + h + 2, w - 6, 2);
    ctx.fillRect(x + w + 2, y + 6, 2, h - 4);
  }
  ctx.drawImage(aeroCached(`win|${w}|${h}|${active}`, () => windowTex(w, h, active)), x, y);
  const { titleBar, close, min, content } = windowRects(r);
  if (opts.fill !== false) {
    ctx.fillStyle = typeof opts.fill === 'string' ? opts.fill : '#f4fbff';
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
    aeroText(ctx, t.replace('…', '..'), tx, titleBar.y + 4, { color: active ? '#06305a' : '#3a4c5e', glow: '#ffffff', glowA: active ? 0.5 : 0.3 });
  }
  const st = (k) => (opts.down === k ? 'down' : opts.hover === k ? 'hover' : 'normal');
  chromeButton(ctx, min.x, min.y, 'min', st('min'));
  chromeButton(ctx, close.x, close.y, 'close', st('close'));
  return { content, close, min, titleBar };
}

// ---------------------------------------------------------------- taskbar (dark Aero glass)

function taskbarTex(w, h) {
  // deep ocean glass: a bright glossy upper half, an aqua light line, a teal-green aurora along the bottom
  const base = aeroSurface(w, h, { top: '#6cc4f4', mid: '#16569c', bot: '#062a58', a: [0.86, 0.94], edge: '#021a3a', edgeA: 0.95, r: 0, gloss: 0.5, glossH: Math.round(h * 0.48), curve: 0, rim: 0.4, glow: 0.6, glowColor: '#2ad8ff' });
  const c = makeCanvas(w, h);
  const g = ctxOf(c);
  g.drawImage(base, 0, 0);
  g.fillStyle = 'rgba(214,248,255,0.9)';
  g.fillRect(0, 1, w, 1);
  g.fillStyle = 'rgba(255,255,255,0.18)';
  g.fillRect(0, 2, w, 1);
  for (let x = 0; x < w; x++) {
    const k = Math.sin(x * 0.011) * 0.5 + 0.5, k2 = Math.sin(x * 0.027 + 1.7) * 0.5 + 0.5;
    g.fillStyle = `rgba(110,255,200,${(0.05 + 0.08 * k * k2).toFixed(3)})`;
    g.fillRect(x, h - 6, 1, 4);
  }
  // a few soft light bubbles in the glass
  for (let i = 0; i < w / 90; i++) {
    const bx = Math.round(hash2(i, 3, 7) * w), by = Math.round(h * 0.55 + hash2(i, 5, 7) * h * 0.3);
    g.fillStyle = 'rgba(200,250,255,0.22)';
    g.fillRect(bx, by, 1, 1);
  }
  return c;
}

export function drawTaskbar(ctx, x, y, w, h) {
  w = Math.round(w); h = Math.round(h);
  ctx.fillStyle = rgba('#06243e', 0.18);
  ctx.fillRect(Math.round(x), Math.round(y) - 2, w, 2);
  ctx.drawImage(aeroCached(`taskbar|${w}|${h}`, () => taskbarTex(w, h)), Math.round(x), Math.round(y));
}

// ---------------------------------------------------------------- title pill ("hanging sign")

export function drawPlank(ctx, x, y, w, h, opts = {}) {
  x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h);
  const tone = opts.tone === 'dark' ? 'dark' : 'aqua';
  ctx.fillStyle = 'rgba(191,244,255,0.25)';
  ctx.fillRect(x + 4, y - 1, w - 8, h + 2);
  ctx.drawImage(aeroCached(`plank|${w}|${h}|${tone}`, () => aeroSurface(w, h, { tone, r: Math.floor(h / 2), gloss: 0.8, glossH: Math.round(h * 0.46), curve: 2, rim: 0.85, glow: 0.7, sparkle: w > 50 ? 1 : 0 })), x, y);
  if (opts.label) {
    drawText(ctx, opts.label, x + Math.round(w / 2), y + Math.round((h - 7) / 2), { align: 'center', color: '#ffffff', shadow: toneOf(tone).shadow });
  }
  return { x: x + 4, y: y + 6, w: w - 8, h: h - 9 };
}

// ---------------------------------------------------------------- glossy sticker ("rubber stamp")

function stampTex(text, color, angle, font) {
  const tw = measureText(text, font), capH = font === 'small' ? 5 : 7;
  const bw = tw + 14, bh = capH + 9;
  const src = makeCanvas(bw, bh);
  const g = ctxOf(src);
  g.drawImage(aeroSurface(bw, bh, { tone: toneFrom(color), r: Math.floor(bh / 2), gloss: 0.8, glossH: Math.round(bh * 0.46), curve: 1, rim: 0.8, glow: 0.6, edge: '#ffffff', edgeA: 1 }), 0, 0);
  drawText(g, text, 7, Math.round((bh - capH) / 2), { font, color: '#ffffff', shadow: shade(color, -0.6) });
  if (Math.abs(angle) < 0.01) return src;
  // 3-shear rotation keeps pixels crisp
  const sd = g.getImageData(0, 0, bw, bh).data;
  const a1 = -Math.tan(angle / 2), b1 = Math.sin(angle);
  const D = Math.ceil(Math.hypot(bw, bh)) + 4, cx = Math.floor(bw / 2), cy = Math.floor(bh / 2), o = Math.floor(D / 2);
  const out = new PixelBuffer(D, D);
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      const si = (y * bw + x) * 4;
      if (sd[si + 3] < 8) continue;
      let X = x - cx, Y = y - cy;
      X += Math.round(a1 * Y);
      Y += Math.round(b1 * X);
      X += Math.round(a1 * Y);
      out.set(X + o, Y + o, ((sd[si + 3] << 24) | (sd[si + 2] << 16) | (sd[si + 1] << 8) | sd[si]) >>> 0);
    }
  }
  return out.toCanvas();
}

export function drawStamp(ctx, x, y, text, opts = {}) {
  const color = opts.color || '#e8283a';
  let angle = opts.angle ?? -0.14;
  if (Math.abs(angle) > Math.PI) angle = (angle * Math.PI) / 180;
  angle = Math.round(angle * 100) / 100;
  const font = opts.font || 'normal';
  const c = aeroCached(`stamp|${text}|${color}|${angle}|${font}`, () => stampTex(String(text), color, angle, font), 300);
  const k = opts.scale || 1;
  if (k === 1) ctx.drawImage(c, Math.round(x - c.width / 2), Math.round(y - c.height / 2));
  else {
    const dw = Math.round(c.width * k), dh = Math.round(c.height * k);
    ctx.drawImage(c, Math.round(x - dw / 2), Math.round(y - dh / 2), dw, dh);
  }
  if (k <= 1.05 && hash2(Math.round(x), Math.round(y), 3) > 0.3) drawSparkle(ctx, Math.round(x - c.width / 2 + 6), Math.round(y - c.height / 2 + 5), 1, 0.9);
}

// ---------------------------------------------------------------- glossy picture frames

const FRAME_TONE = { wood: 'white', gold: { top: '#fff8c8', mid: '#ffd04a', bot: '#d0880e', edge: '#7a4a06', text: '#ffffff', shadow: '#6a3e04', glow: '#fff6c0', a: [1, 1] }, coral: 'green' };

export function drawFrame(ctx, x, y, w, h, opts = {}) {
  x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h);
  const style = opts.style === 'gold' || opts.style === 'coral' ? opts.style : 'wood';
  const fw = style === 'coral' ? 6 : 5;
  if (w >= 14 && h >= 14) {
    const c = aeroCached(`frame|${w}|${h}|${style}`, () => {
      const outer = aeroSurface(w, h, { tone: FRAME_TONE[style], r: 6, gloss: 0.6, glossH: Math.round(h * 0.4), curve: 3, rim: 0.9, glow: 0.6, sparkle: 2 });
      const cc = withHole(outer, fw, fw, w - fw * 2, h - fw * 2, 2, null);
      const g = ctxOf(cc);
      // inner lip: a dark edge so the picture sits inside the glass
      g.fillStyle = style === 'gold' ? 'rgba(90,50,4,0.7)' : 'rgba(10,60,110,0.6)';
      g.fillRect(fw, fw - 1, w - fw * 2, 1); g.fillRect(fw - 1, fw, 1, h - fw * 2);
      g.fillStyle = 'rgba(255,255,255,0.8)';
      g.fillRect(fw, h - fw, w - fw * 2, 1); g.fillRect(w - fw, fw, 1, h - fw * 2);
      return cc;
    });
    ctx.drawImage(c, x, y);
  }
  return { x: x + fw, y: y + fw, w: w - fw * 2, h: h - fw * 2 };
}
