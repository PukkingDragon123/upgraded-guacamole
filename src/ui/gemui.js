// [cur26] The two currencies + the gem "Skip" button.
//   Aero Bucks = a water droplet; Byte Gems = a faceted violet crystal with a cyan "byte" glint.
// [vicons30] The currency icons are the DETAILED VOXEL models (src/gfx/iconvox.js 'aerobuck' / 'gem', the same ones
// getUiIcon('aerobuck') / getUiIcon('gem') return); the gem turns once whenever its shine sweeps. The pixel sprites
// below (1 canvas px = 1 art px, nearest-neighbour scaled) only stand in until a voxel frame is built.
// [wallet33] The wallet (src/ui/walletglass.js, re-exported below) renders its own 3D glass droplet / gem.
//
//   dropSprite() / gemSprite()          -> canvas (art-px sprites, cached)
//   drawDrop(ctx, cx, cy, p, o)          droplet centred at (cx, cy), p = logical px per art px; o.squash (0..1 splash)
//   drawGem(ctx, cx, cy, p, o)           gem centred; o.glint (0..1 sweep position, <0 = none), o.sparkle (0..1)
//   drawDropSplash(ctx, cx, cy, p, k)    the pixel splash on gain (k = 1 -> 0 as it fades): droplets arc out
//   drawGemShards(ctx, cx, cy, p, k)     the gem glint pop on gain: + sparkles and tiny diamond chips
//   currencyIcon(kind, px)               a canvas ~px tall for buttons / labels (the voxel model; the sprite until built)
//   drawGemButton(ctx, x, y, w, h, o)    pixel-art violet button: gem + "SKIP" + cost (o.label, o.cost, o.state, o.t)
//   gemSkipButton(ui, ctx, x, y, w, h, o) interactive wrapper (hover / click / disabled toast); returns true on click
// Inline text icons {abdrop} and {bytegem} are registered on import.

import { makeCanvas } from '../core/canvas.js';
import { drawText, measureText, registerInlineIcon } from '../gfx/font.js';
import { icon3d, icon3dFrame } from '../gfx/icons3d.js'; // [vicons30] voxel currency icons
import { GEM_NAME, gems, canSpendGems } from '../game/gems.js';

const R = Math.round;

// ---------------------------------------------------------------- sprites (art px)
const DROP_ART = [
  '.....o.....',
  '....oWo....',
  '....oLo....',
  '...oLCLo...',
  '...oWCCo...',
  '..oLWCCCo..',
  '..oWLCCCo..',
  '.oCWCCCCDo.',
  '.oCLCCCCDo.',
  '.oCCCCCDDo.',
  '.oCCCCDDSo.',
  '..oCDDDSo..',
  '...oDSSo...',
  '....ooo....',
];
const DROP_PAL = { o: '#12305e', W: '#ffffff', L: '#8ae6ff', C: '#38aaf2', D: '#2172c8', S: '#3a4fb0' };

const GEM_ART = [
  '...ooooooo...',
  '..oWWLFMMMo..',
  '.oWLLFMMCMDo.',
  'oLLLFMMMMMDDo',
  'oFFFFFFFFFFFo',
  '.oLLMFMMMDDo.',
  '..oLMFMMDDo..',
  '...oLFMDDo...',
  '....oFMDo....',
  '.....oDo.....',
  '......o......',
];
const GEM_PAL = { o: '#2a0e52', W: '#ffffff', L: '#d4a4ff', M: '#9a56f0', D: '#5c2aa8', F: '#7438cc', C: '#7ff4ff' };

function fromArt(rows, pal) {
  const h = rows.length, w = rows[0].length;
  const c = makeCanvas(w, h);
  const g = c.getContext('2d');
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const col = pal[rows[y][x]];
    if (!col) continue;
    g.fillStyle = col; g.fillRect(x, y, 1, 1);
  }
  return c;
}
let dropC = null, gemC = null;
export function dropSprite() { return (dropC ||= fromArt(DROP_ART, DROP_PAL)); }
export function gemSprite() { return (gemC ||= fromArt(GEM_ART, GEM_PAL)); }
const GEM_INNER = GEM_ART.map((r) => [...r].map((ch) => ch !== '.' && ch !== 'o'));

// [vicons30] a voxel frame ({canvas (`.hi`), ox, oy}) of a currency model `px` logical px across (null while unbuilt)
function voxFrame(name, px, turn = 0) {
  try { return icon3dFrame(name, Math.max(8, Math.round(px)), turn); } catch { return null; }
}
let inlineVox = false;
function inlineIcons() { // the {abdrop} / {bytegem} text icons: voxel once those renders exist
  if (inlineVox) return;
  try {
    const a = currencyIcon('drop', 9), b = currencyIcon('gem', 8);
    registerInlineIcon('abdrop', a, 1); registerInlineIcon('bytegem', b, 1);
    inlineVox = !!(a.__icon3d && b.__icon3d);
  } catch { /* fonts not ready */ }
}

function blit(ctx, src, cx, cy, w, h) {
  const s = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(src, cx - w / 2, cy - h / 2, w, h);
  ctx.imageSmoothingEnabled = s;
}
const snap = (v) => Math.round(v * 2) / 2; // half-logical px = one device px on the 2x UI layer

export function drawDrop(ctx, cx, cy, p, o = {}) {
  inlineIcons();
  const sq = o.squash || 0;
  const sx = 1 + sq * 0.18, sy = 1 - sq * 0.16;
  const f = voxFrame('aerobuck', 15 * p);
  if (f) { // squashes about its foot
    const c = f.canvas, w = c.width * sx, h = c.height * sy;
    ctx.drawImage(c, snap(cx - f.ox * sx), snap(cy - f.oy * sy + (15 * p * (1 - sy)) / 2), snap(w), snap(h));
    return;
  }
  const s = dropSprite();
  const w = s.width * p * sx, h = s.height * p * sy;
  blit(ctx, s, snap(cx), snap(cy + (s.height * p - h) / 2), snap(w), snap(h));
}

export function drawGem(ctx, cx, cy, p, o = {}) {
  inlineIcons();
  const turn = o.glint != null && o.glint >= 0 && o.glint <= 1 ? o.glint : 0; // one full turn per shine sweep
  const f = voxFrame('gem', 14 * p, turn);
  if (f) {
    ctx.drawImage(f.canvas, snap(cx - f.ox), snap(cy - f.oy));
    if (o.sparkle > 0) pxSparkle(ctx, cx + 5.5 * p, cy - 5 * p, p, o.sparkle, '#ffffff');
    return;
  }
  const s = gemSprite();
  const H = s.height * p, W = (s.width / s.height) * H;
  const x0 = snap(cx - W / 2), y0 = snap(cy - H / 2);
  blit(ctx, s, snap(cx), snap(cy), snap(W), snap(H));
  // the glint: a 2-px diagonal band sweeping across the facets (our own sprite only: we know its shape)
  if (o.glint != null && o.glint >= 0 && o.glint <= 1) {
    const cols = s.width, rows = s.height, d0 = Math.round(-rows + o.glint * (cols + rows));
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      if (!GEM_INNER[y][x]) continue;
      const d = x - (rows - 1 - y) * 0.5 - d0;
      if (d >= 0 && d < 2) ctx.fillRect(x0 + x * p, y0 + y * p, p, p);
    }
  }
  if (o.sparkle > 0) pxSparkle(ctx, x0 + W - p * 1.5, y0 + p, p, o.sparkle, '#ffffff');
}

// a 4-point pixel twinkle (a plus with a bright core), size by k
export function pxSparkle(ctx, x, y, p, k, col = '#ffffff') {
  if (k <= 0) return;
  const L = Math.max(1, Math.round(k * 2.4));
  ctx.fillStyle = col;
  ctx.fillRect(snap(x - p / 2), snap(y - p / 2 - L * p), p, L * p * 2 + p);
  ctx.fillRect(snap(x - p / 2 - L * p), snap(y - p / 2), L * p * 2 + p, p);
}

// droplets fly up and out of the icon and fall back down (k: 1 -> 0)
export function drawDropSplash(ctx, cx, cy, p, k, seed = 0) {
  if (k <= 0) return;
  const u = 1 - k; // 0 -> 1 time
  const cols = ['#ffffff', '#8ae6ff', '#38aaf2'];
  for (let i = 0; i < 6; i++) {
    const side = i % 2 ? 1 : -1, sp = 0.6 + ((i * 37 + seed) % 5) * 0.12;
    const vx = side * (3 + (i >> 1) * 3.2) * sp, vy = -(9 + (i % 3) * 3) * sp;
    const x = cx + vx * u * p * 1.4, y = cy - p * 4 + (vy * u + 26 * u * u) * p;
    ctx.fillStyle = cols[i % 3];
    const s = i < 2 ? p * 1.5 : p;
    ctx.fillRect(snap(x - s / 2), snap(y - s / 2), s, s);
    if (i < 2 && u < 0.6) { ctx.fillStyle = '#ffffff'; ctx.fillRect(snap(x - s / 2), snap(y - s / 2 - p), p, p); }
  }
  // a little crown of spikes at the drop's foot in the first frames (pixel, not a ring)
  if (u < 0.35) {
    const f = u < 0.18 ? 0 : 1;
    ctx.fillStyle = '#8ae6ff';
    const by = cy + p * 6.5;
    for (const dx of [-5, -3, 3, 5]) {
      const hgt = (Math.abs(dx) === 5 ? 1 : 2) + (f ? -1 : 0);
      if (hgt > 0) ctx.fillRect(snap(cx + dx * p - p / 2), snap(by - hgt * p), p, hgt * p);
    }
  }
}

// the gem's "ding": two twinkles and tiny diamond chips that drift out (k: 1 -> 0)
export function drawGemShards(ctx, cx, cy, p, k) {
  if (k <= 0) return;
  const u = 1 - k;
  pxSparkle(ctx, cx + p * 6, cy - p * 5, p, Math.sin(Math.min(1, u * 2.2) * Math.PI), '#ffffff');
  pxSparkle(ctx, cx - p * 6, cy + p * 2, p, Math.sin(Math.min(1, Math.max(0, u * 2.2 - 0.4)) * Math.PI) * 0.7, '#e8c8ff');
  const cols = ['#d4a4ff', '#7ff4ff', '#ffffff', '#9a56f0'];
  for (let i = 0; i < 4; i++) {
    const a = -Math.PI / 2 + (i - 1.5) * 0.7, d = (4 + u * 10) * p;
    const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d * 0.8 + u * u * 6 * p;
    ctx.fillStyle = cols[i];
    ctx.fillRect(snap(x), snap(y), p, p); // a tiny chip
    if (i % 2 === 0 && u < 0.5) { ctx.fillStyle = '#ffffff'; ctx.fillRect(snap(x), snap(y - p), p, p); }
  }
}

// a currency icon as a small canvas for buttons / inline text (cached per size): the voxel model once it is built,
// the pixel sprite meanwhile (not cached, so the voxel one takes over)
const iconCache = new Map();
export function currencyIcon(kind, px = 12) {
  const key = kind + px;
  let c = iconCache.get(key);
  if (c) return c;
  try { c = icon3d(kind === 'gem' ? 'gem' : 'aerobuck', px, px); } catch { c = null; }
  if (c) { iconCache.set(key, c); return c; }
  const fk = key + '|px';
  c = iconCache.get(fk);
  if (c) return c;
  const s = kind === 'gem' ? gemSprite() : dropSprite();
  const k = Math.max(1, Math.round(px / s.height));
  c = makeCanvas(s.width * k, s.height * k);
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.drawImage(s, 0, 0, c.width, c.height);
  iconCache.set(fk, c);
  return c;
}
inlineIcons();

// ---------------------------------------------------------------- the pixel "Skip" button
const BTN_TONES = {
  normal: { ink: '#2a0e52', top: '#b27cff', body: '#8446e6', bot: '#5c2aa8', hi: '#e2c8ff', text: '#ffffff', shadow: '#3a1478' },
  hover: { ink: '#2a0e52', top: '#c898ff', body: '#9a5cf6', bot: '#6a34bc', hi: '#f2e4ff', text: '#ffffff', shadow: '#3a1478' },
  down: { ink: '#2a0e52', top: '#6a34bc', body: '#7a40d8', bot: '#8446e6', hi: '#9a5cf6', text: '#f2e4ff', shadow: '#2a0e52' },
  disabled: { ink: '#3a3450', top: '#9a94b0', body: '#7c7694', bot: '#5e5874', hi: '#b8b2cc', text: '#e4e0ee', shadow: '#3a3450' },
};

// stepped-corner pixel plate: ink outline, top light band, bottom shade band, broken highlight line (hand-drawn feel)
export function pixelPlate(ctx, x, y, w, h, p, c) {
  x = snap(x); y = snap(y); w = snap(w); h = snap(h);
  ctx.fillStyle = c.ink;
  ctx.fillRect(x + p, y, w - 2 * p, h); ctx.fillRect(x, y + p, w, h - 2 * p);
  ctx.fillStyle = c.body;
  ctx.fillRect(x + p, y + p, w - 2 * p, h - 2 * p);
  ctx.fillStyle = c.top;
  ctx.fillRect(x + p, y + p, w - 2 * p, Math.max(p, snap((h - 2 * p) * 0.36)));
  ctx.fillStyle = c.bot;
  ctx.fillRect(x + p, y + h - 2 * p - p, w - 2 * p, 2 * p);
  if (c.hi) {
    ctx.fillStyle = c.hi;
    const L = w - 4 * p;
    ctx.fillRect(x + 2 * p, y + p, snap(L * 0.55), p);
    ctx.fillRect(snap(x + 2 * p + L * 0.55 + 2 * p), y + p, snap(L * 0.18), p);
    ctx.fillRect(x + p, y + 2 * p, p, p);
  }
}

export function drawGemButton(ctx, x, y, w, h, o = {}) {
  const st = o.state || 'normal', c = BTN_TONES[st] || BTN_TONES.normal;
  const p = o.p || (h >= 26 ? 2 : 1);
  const dy = st === 'down' ? p : 0;
  // drop shadow (1 art px, offset down)
  ctx.fillStyle = 'rgba(20,6,40,0.35)';
  ctx.fillRect(snap(x + p), snap(y + h), snap(w - 2 * p), p);
  pixelPlate(ctx, x, y + dy, w, h - (st === 'down' ? p : 0), p, c);
  const font = h >= 24 ? 'big' : h >= 18 ? 'normal' : 'small';
  const cap = font === 'big' ? 9 : font === 'normal' ? 7 : 5;
  const label = o.label ?? 'SKIP';
  const cost = o.cost != null ? String(o.cost) : '';
  const gp = Math.max(1, Math.round(((h - 6 * p) / 11) * 2) / 2);
  const gw = 13 * gp;
  const lw = measureText(label, font), cw = cost ? measureText(cost, font) : 0;
  const gap = 4 * p;
  const total = lw + (cost ? gap + gw + 2 * p + cw : 0);
  let tx = R(x + w / 2 - total / 2);
  const ty = R(y + dy + (h - cap) / 2) - (st === 'down' ? 0 : 1);
  drawText(ctx, label, tx, ty, { font, color: c.text, shadow: c.shadow });
  if (cost) {
    tx += lw + gap;
    drawGem(ctx, tx + gw / 2, y + dy + h / 2 - p * 0.5, gp, { glint: o.t != null && st !== 'disabled' ? ((o.t * 0.5) % 1.6) : -1 });
    drawText(ctx, cost, tx + gw + 2 * p, ty, { font, color: st === 'disabled' ? '#e4e0ee' : '#fff3a8', shadow: c.shadow });
  }
}

// Interactive: returns true when clicked with enough gems. o: {cost, label, tip, state(game state), t, onShort}
export function gemSkipButton(ui, ctx, x, y, w, h, o = {}) {
  const r = { x, y, w, h };
  const g = ui.game, st = g.state;
  const ok = canSpendGems(st, o.cost || 0);
  const hov = ui.hover(r);
  const down = hov && ui.inp.down;
  drawGemButton(ctx, x, y, w, h, { label: o.label, cost: o.cost, t: ui.time, state: !ok ? 'disabled' : down ? 'down' : hov ? 'hover' : 'normal' });
  if (hov) {
    ui.tip = o.tip || (ok ? `Finish it now for ${o.cost} ${GEM_NAME}` : `Need ${o.cost - gems(st)} more ${GEM_NAME}. Earn them from quests!`);
    ui.markHot?.('gemskip' + x + y);
  }
  if (hov && ui.inp.pressed) {
    ui.inp.pressed = false;
    if (!ok) { g.audio?.play?.('ui_error'); g.toast?.(`Need ${o.cost - gems(st)} more ${GEM_NAME}: finish quests to earn them!`, 'lock'); return false; }
    g.audio?.play?.('ui_unlock');
    return true;
  }
  return false;
}

// ---------------------------------------------------------------- tank egg clutch chip [cur26]
// A small pixel plate: a speckled egg, the time left and a violet "gem cost" end. r = {x, y, w, h}; o: {left (s),
// cost, hover, t, color, afford}. The whole chip is the button (the Aquarium routes the click to skips.eggSkip).
const fmtClock = (s) => { s = Math.max(0, Math.ceil(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
export function drawEggChip(ctx, r, o = {}) {
  const p = r.h >= 26 ? 2 : 1.5;
  const lift = o.hover ? p : 0;
  const y = r.y - lift;
  ctx.fillStyle = 'rgba(4,22,44,0.3)'; ctx.fillRect(snap(r.x + p), snap(r.y + r.h), snap(r.w - 2 * p), p);
  pixelPlate(ctx, r.x, y, r.w, r.h, p, { ink: '#3a2a1a', top: '#fff4d8', body: '#ffe6b4', bot: '#e8c48a', hi: '#ffffff' });
  // the egg (pixel oval with speckles, wobbling as it gets close to hatching)
  const ep = Math.max(1, snap(r.h / 9));
  const ecx = r.x + 3 * p + 2.5 * ep, ecy = y + r.h / 2;
  const wob = o.left < 20 ? Math.sin((o.t || 0) * 18) * p * 0.5 : 0;
  const E = ['.ooo.', 'oWLLo', 'oLLSo', 'oLSLo', 'oLLDo', '.ooo.'];
  const pal = { o: '#4a3418', W: '#ffffff', L: o.color || '#ffd8a8', S: '#c87a4a', D: '#e0a878' };
  const ex = snap(ecx - 2.5 * ep + wob), ey = snap(ecy - 3 * ep);
  for (let yy = 0; yy < E.length; yy++) for (let xx = 0; xx < 5; xx++) { const c = pal[E[yy][xx]]; if (!c) continue; ctx.fillStyle = c; ctx.fillRect(ex + xx * ep, ey + yy * ep, ep, ep); }
  const font = r.h >= 24 ? 'big' : 'normal', cap = font === 'big' ? 9 : 7;
  const ty = R(y + (r.h - cap) / 2);
  drawText(ctx, fmtClock(o.left), R(r.x + 6 * p + 5 * ep), ty, { font, color: '#5a3410' });
  // the violet gem end
  const cw = R(r.w * 0.46), cx = r.x + r.w - cw - p;
  pixelPlate(ctx, cx, y + p, cw, r.h - 2 * p, p, o.afford === false ? BTN_TONES.disabled : o.hover ? BTN_TONES.hover : BTN_TONES.normal);
  const gp = Math.max(1, Math.round(((r.h - 6 * p) / 11) * 2) / 2);
  const txt = String(o.cost || 0), tw = measureText(txt, font);
  const gx = cx + cw / 2 - (13 * gp + 2 * p + tw) / 2;
  drawGem(ctx, gx + 6.5 * gp, y + r.h / 2 - p * 0.5, gp, { glint: o.hover ? ((o.t || 0) * 0.8) % 1.4 : -1 });
  drawText(ctx, txt, R(gx + 13 * gp + 2 * p), ty, { font, color: '#fff3a8', shadow: '#3a1478' });
}
export { fmtClock };

// ================================================================ the wallet
// [wallet33] The wallet is a glossy 3D Frutiger-Aero glass slab now: src/ui/walletglass.js (replaces the [wallet32]
// brass pixel plaque). Re-exported here so callers keep importing it from gemui.js.
export { drawWalletPlaque, walletSize, walletTip, walletTick, drawHeaderWallet, walletP, WALLET_ART } from './walletglass.js';
