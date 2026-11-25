// [cur26] The two currencies + the gem "Skip" button.
//   Aero Bucks = a water droplet; Byte Gems = a faceted violet crystal with a cyan "byte" glint.
// [vicons30] The currency icons are the DETAILED VOXEL models (src/gfx/iconvox.js 'aerobuck' / 'gem', the same ones
// getUiIcon('aerobuck') / getUiIcon('gem') return); the gem turns once whenever its shine sweeps. The pixel sprites
// below (1 canvas px = 1 art px, nearest-neighbour scaled) only stand in until a voxel frame is built.
// [wallet32] EXCEPT the wallet plaques (bottom of this file): they use their own hand-drawn pixel droplet / gem.
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
import { CURRENCY, fmtAero } from './aero.js'; // [wallet32]
import { HI_ON } from '../gfx/hires.js'; // [wallet32]

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

// ================================================================ [wallet32] the wallet plaque
// A hand-crafted 2D pixel-art plaque (the [cur26] look the user liked, made richer): a brass frame with rivets and
// stepped corners, a blue sea-glass half (Aero Bucks droplet + count) and a violet crystal half (Byte Gem + count),
// recessed number wells with two-tone pixel digits. Everything is drawn on ONE art-pixel grid (1 art px = p logical
// px; on the 2x UI layer p may be a half step = whole device px) from cached art-px canvases scaled by nearest
// neighbour, so the frame, the icons and the digits share their pixel size. Gains: the droplet squashes and splashes
// pixel droplets, the gem hops and a shine sweeps across it with twinkles, each digit that changes hops (tick-up).
// The hand-drawn droplet / gem sprites are used here (the voxel models read muddy at this size).
//   drawWalletPlaque(ctx, ui, o) -> layout   o: {right, y, p, mini, aTxt, gTxt, hov}
//   drawHeaderWallet(ctx, ui, right, y, o)    the compact version for window headers (same art, smaller grid)
//   WALLET_ART                                 the layout specs (FULL / MINI)

const DROP_BIG = [
  '.....o.....',
  '....oHo....',
  '...oHLCo...',
  '...oWLCo...',
  '..oHWCCMo..',
  '..oWHCCMo..',
  '.oHWLCCCMo.',
  'oLHLCCCCMDo',
  'oLLCCCCCMDo',
  'oLCCCCCCMDo',
  'oCCCCCMMDRo',
  '.oMCCMMDRo.',
  '.oDMMDDRSo.',
  '..oSDDDSo..',
  '...ooooo...',
];
const DROP_SMALL = [
  '....o....',
  '...oHo...',
  '...oLo...',
  '..oHLCo..',
  '..oWCMo..',
  '.oHWCCMo.',
  '.oWCCCMo.',
  'oLHCCCMDo',
  'oLCCCMMDo',
  'oCCCMMDRo',
  '.oMMDDRo.',
  '..ooooo..',
];
const DROP_PAL2 = { o: '#0e2a5c', W: '#ffffff', H: '#c8f6ff', L: '#7fd8ff', C: '#3aa8f0', M: '#2a86da', D: '#2062c0', S: '#28409a', R: '#6ad6ff' };
const GEM_BIG = [
  '...ooooooooo...',
  '..oPLHHHHHLMo..',
  '.oPPLHWHHHLMMo.',
  'oPWPLHHHHPLMMDo',
  'oFFFFFFFFFFFFFo',
  'oLPLLMMMMMFMDDo',
  '.oPLLMCMMMFDDo.',
  '..oPLLMMMFMDo..',
  '...oPLMCMFDo...',
  '....oLLMFDo....',
  '.....oLMDo.....',
  '......oDo......',
  '.......o.......',
];
const GEM_SMALL = [
  '..ooooooo..',
  '.oPLHHHLMo.',
  'oPWLHHHLMDo',
  'oFFFFFFFFFo',
  '.oPLMMCFDo.',
  '..oPLMFDo..',
  '...oLMDo...',
  '....oDo....',
  '.....o.....',
];
const GEM_PAL2 = { o: '#24104e', W: '#ffffff', H: '#f2e2ff', P: '#dcbaff', L: '#b98aff', M: '#8e52ec', F: '#6a32c0', D: '#4a209a', C: '#7ff4ff' };
const artCache = new Map();
function artC(key, build) { let c = artCache.get(key); if (!c) { c = build(); artCache.set(key, c); if (artCache.size > 120) artCache.delete(artCache.keys().next().value); } return c; }
const spriteOf = (kind, small) => artC(`spr|${kind}|${small ? 1 : 0}`, () => fromArt(kind === 'gem' ? (small ? GEM_SMALL : GEM_BIG) : (small ? DROP_SMALL : DROP_BIG), kind === 'gem' ? GEM_PAL2 : DROP_PAL2));

// two-tone pixel digits with a hard drop shadow (art px canvas per char)
const DIGIT_TONES = {
  a: { top: '#ffffff', bot: '#d4f4ff', flash: '#fff6b8', sh: '#031424' },
  g: { top: '#ffffff', bot: '#eee0ff', flash: '#fff6b8', sh: '#0c0624' },
};
function glyphArt(ch, font, tone, flash) {
  return artC(`gl|${ch}|${font}|${tone}|${flash ? 1 : 0}`, () => {
    const T = DIGIT_TONES[tone] || DIGIT_TONES.a;
    const cap = font === 'big' ? 9 : 7;
    const w = Math.max(1, measureText(ch, font)) + 1, c = makeCanvas(w, cap + 1), g = c.getContext('2d');
    drawText(g, ch, 1, 1, { font, color: T.sh });
    const m = makeCanvas(w, cap + 1), mg = m.getContext('2d');
    drawText(mg, ch, 0, 0, { font, color: flash ? T.flash : T.top });
    mg.globalCompositeOperation = 'source-atop';
    mg.fillStyle = flash ? T.top : T.bot; mg.fillRect(0, Math.ceil(cap * 0.56), w, cap);
    g.drawImage(m, 0, 0);
    return c;
  });
}
// digits sit in fixed-width cells (the plaque never jitters while a number ticks up); punctuation keeps its own width
const isDigit = (ch) => ch >= '0' && ch <= '9';
const advOf = (ch, font) => measureText(isDigit(ch) ? '0' : ch, font) + 1;
const textW = (s, font) => { let w = 0; for (const ch of s) w += advOf(ch, font); return Math.max(0, w - 1); };

export const WALLET_ART = {
  FULL: { H: 23, rim: 2, font: 'big', cap: 9, wellH: 13, small: false, slotA: 13, slotG: 16, pad: 2, gap: 2 },
  MINI: { H: 18, rim: 1, font: 'normal', cap: 7, wellH: 10, small: true, slotA: 10, slotG: 12, pad: 1, gap: 1 },
};
const BRASS = { hi: '#fff0b4', top: '#eec460', mid: '#d29e3e', lo: '#a46e22', dk: '#764612', ink: '#2e1a08', rivHi: '#fffbe0', rivLo: '#6a3e10' };
const GLASS = {
  a: { hi: '#a8ecff', top: '#3b94cf', base: '#2a76b4', bot: '#1d5a92', edge: '#174a7a', well: '#0a2846', wellT: '#051628', wellB: '#4a9ad0', dot: '#7fd2f6' },
  g: { hi: '#dcc8ff', top: '#7058c6', base: '#5842a8', bot: '#402e86', edge: '#33246c', well: '#1c1242', wellT: '#100a2a', wellB: '#8a72d8', dot: '#a892f0' },
};

// layout in art px for widths aw / gw (the digit fields)
function walletLayout(S, aw, gw) {
  const o = 1 + S.rim + 1; // ink + rim + dark line
  const wA = S.pad + S.slotA + S.gap + (aw + 5) + S.pad, wG = S.pad + S.slotG + S.gap + (gw + 5) + S.pad;
  const xA = o, xD = xA + wA, xG = xD + 2, W = xG + wG + o;
  const gy = o, gh = S.H - o * 2;
  const wellY = gy + Math.floor((gh - S.wellH) / 2);
  return { W, H: S.H, o, xA, wA, xD, xG, wG, gy, gh, wellY, wellA: xA + S.pad + S.slotA + S.gap, wellG: xG + S.pad + S.slotG + S.gap, wellWA: aw + 5, wellWG: gw + 5 };
}

// the static plaque (art px canvas)
function plaqueArt(S, aw, gw, hov) {
  return artC(`plq|${S.H}|${aw}|${gw}|${hov ? 1 : 0}`, () => {
    const L = walletLayout(S, aw, gw), { W, H } = L;
    const c = makeCanvas(W, H + 1), g = c.getContext('2d');
    const R2 = (x, y, w, h, col) => { if (w > 0 && h > 0) { g.fillStyle = col; g.fillRect(x, y, w, h); } };
    // hard drop shadow row + stepped ink silhouette ([2,1] notch)
    R2(2, H, W - 3, 1, 'rgba(4,22,44,0.38)');
    R2(2, 0, W - 4, H, BRASS.ink); R2(1, 1, W - 2, H - 2, BRASS.ink); R2(0, 2, W, H - 4, BRASS.ink);
    // brass rim: lit top-left, shaded bottom-right, 1 px notch inside the ink
    const r = S.rim;
    R2(2, 1, W - 4, H - 2, BRASS.mid); R2(1, 2, W - 2, H - 4, BRASS.mid);
    R2(2, 1, W - 4, 1, hov ? '#ffffff' : BRASS.hi); R2(1, 2, 1, H - 4, BRASS.top);
    if (r > 1) { R2(2, 2, W - 4, 1, BRASS.top); R2(2, 3, 1, H - 6, BRASS.top); }
    R2(2, H - 2, W - 4, 1, BRASS.dk); R2(W - 2, 2, 1, H - 4, BRASS.lo);
    if (r > 1) { R2(3, H - 3, W - 6, 1, BRASS.lo); R2(W - 3, 3, 1, H - 6, BRASS.lo); }
    // a few hand-placed brass glints along the top rim
    R2(5, 1, 3, 1, '#ffffff'); R2(W - 12, 1, 2, 1, '#fff8d8');
    // the dark line around the glass
    R2(L.o - 1, L.gy - 1, W - (L.o - 1) * 2, L.gh + 2, BRASS.ink);
    // the two glass halves
    const half = (x, w, G, k) => {
      const y = L.gy, h = L.gh;
      R2(x, y, w, h, G.base);
      const tb = Math.round(h * 0.36);
      R2(x, y, w, tb, G.top);
      for (let i = 0; i < w; i += 2) R2(x + i, y + tb, 1, 1, G.top); // dithered seam
      R2(x, y + h - 2, w, 2, G.bot);
      for (let i = 1; i < w; i += 2) R2(x + i, y + h - 3, 1, 1, G.bot);
      R2(x, y, w, 1, G.edge); R2(x, y, 1, h, G.edge); // inner shadow under the dark line
      // a broken highlight line like a quick pen stroke
      const hl = Math.round(w * 0.55);
      R2(x + 2, y + 1, hl, 1, G.hi); R2(x + 4 + hl, y + 1, Math.max(1, Math.round(w * 0.12)), 1, G.hi); R2(x + 1, y + 2, 1, 1, G.hi);
      // little marks: ripples in the water half, facet glints in the gem half
      g.fillStyle = G.dot;
      for (let i = 0, rx = x + 6; rx < x + w - 5; i++, rx += 7 + (i % 3) * 2) {
        if (k === 'a') { g.fillRect(rx, y + 3, 2, 1); g.fillRect(rx + 2, y + 2, 1, 1); } else { g.fillRect(rx, y + 3, 1, 1); g.fillRect(rx + 1, y + 2, 1, 1); g.fillRect(rx + 2, y + 3, 1, 1); }
      }
    };
    half(L.xA, L.wA, GLASS.a, 'a');
    half(L.xG, L.wG, GLASS.g, 'g');
    // the brass divider with its rivet
    R2(L.xD, L.gy - 1, 2, L.gh + 2, BRASS.ink);
    R2(L.xD, L.gy, 1, L.gh, BRASS.top); R2(L.xD + 1, L.gy, 1, L.gh, BRASS.lo);
    // rivets: both ends and the divider (2x2 brass studs with a glint pixel)
    const rivet = (x, y) => { R2(x, y, 2, 2, BRASS.mid); R2(x, y, 1, 1, BRASS.rivHi); R2(x + 1, y + 1, 1, 1, BRASS.rivLo); };
    const ry = Math.floor(H / 2) - 1;
    if (r > 1) { rivet(1, ry); rivet(W - 3, ry); rivet(L.xD, ry); R2(L.xD, ry - 1, 2, 1, BRASS.ink); R2(L.xD, ry + 2, 2, 1, BRASS.ink); }
    else { R2(L.xD, ry, 1, 1, BRASS.rivHi); R2(L.xD + 1, ry + 1, 1, 1, BRASS.rivLo); }
    // recessed number wells (1 px notch, dark top row, light bevel below)
    const well = (x, w, G) => {
      const y = L.wellY, h = S.wellH;
      R2(x + 1, y, w - 2, h, G.well); R2(x, y + 1, w, h - 2, G.well);
      R2(x + 1, y, w - 2, 1, G.wellT); R2(x, y + 1, 1, h - 2, G.wellT);
      R2(x + 1, y + h, w - 2, 1, G.wellB);
    };
    well(L.wellA, L.wellWA, GLASS.a);
    well(L.wellG, L.wellWG, GLASS.g);
    c.L = L;
    return c;
  });
}

const snapP = (v) => Math.round(v * 2) / 2;
// pixel droplets that arc up out of the wallet droplet and fall back (art px grid; k: 1 -> 0)
const SPLASH = [[-1, 17, '#ffffff', 2], [2, 18, '#c8f6ff', 2], [-5, 14, '#8ae6ff', 1], [5, 15, '#8ae6ff', 1], [-8, 10, '#38aaf2', 1], [8, 11, '#c8f6ff', 1], [-3, 20, '#ffffff', 1]];
function walletSplash(ctx, x0, y0, p, cx, top, k, small) {
  const u = 1 - k, sc = small ? 0.6 : 1;
  for (const [vx, vy, col, sz] of SPLASH) {
    const ax = Math.round(cx + vx * u * 1.5 * sc), ay = Math.round(top - (vy * u - 16 * u * u) * sc * 1.3);
    const s2 = small ? 1 : sz;
    ctx.fillStyle = col; ctx.fillRect(snapP(x0 + (ax - (s2 > 1 ? 1 : 0)) * p), snapP(y0 + ay * p), s2 * p, s2 * p);
    if (s2 > 1 && u < 0.5) { ctx.fillStyle = '#ffffff'; ctx.fillRect(snapP(x0 + (ax - 1) * p), snapP(y0 + ay * p), p, p); }
  }
}
// blit an art-px canvas at art position (ax, ay) relative to the plaque origin (x0, y0), p logical px per art px
function blitArt(ctx, c, x0, y0, ax, ay, p, sx = 1, sy = 1) {
  const s = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(c, snapP(x0 + ax * p), snapP(y0 + ay * p), snapP(c.width * p * sx), snapP(c.height * p * sy));
  ctx.imageSmoothingEnabled = s;
}

// per-digit hop state: chars that changed (right-aligned) hop for ~0.3 s
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
function decayHops(ui, dt) {
  for (const st of Object.values(ui.walletHop || {})) for (let i = 0; i < st.hop.length; i++) st.hop[i] = Math.max(0, (st.hop[i] || 0) - dt * 3.6);
}

function drawDigits(ctx, x0, y0, p, axRight, ay, txt, font, tone, st, flash, hopH = 2) {
  let ax = axRight - textW(txt, font);
  for (let i = 0; i < txt.length; i++) {
    const ch = txt[i], h = st?.hop[i] || 0;
    const lift = h > 0 ? Math.round(Math.sin(h * Math.PI) * hopH) : 0;
    const inset = isDigit(ch) ? Math.floor((measureText('0', font) - measureText(ch, font)) / 2) : 0;
    blitArt(ctx, glyphArt(ch, font, tone, flash && h > 0.5), x0, y0, ax + inset, ay - lift, p);
    ax += advOf(ch, font);
  }
}

const fmtShort = (n) => (n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 1 : 2) + 'M' : fmtAero(n));

// The plaque. o: {right, y, p, mini, hov, id}. Uses ui.coinShown / ui.gemShown / ui.coinBump / ui.gemBump / ui.time.
export function drawWalletPlaque(ctx, ui, o = {}) {
  const S = o.mini ? WALLET_ART.MINI : WALLET_ART.FULL;
  const p = o.p || 1, t = ui.time || 0;
  const rm = !!ui.game?.state?.settings?.reducedMotion;
  const aTxt = fmtShort(Math.floor(ui.coinShown || 0)), gTxt = String(Math.floor(ui.gemShown || 0));
  const aw = Math.max(textW(aTxt, S.font), textW(o.mini ? '000' : '0000', S.font)), gw = Math.max(textW(gTxt, S.font), textW('00', S.font));
  const art = plaqueArt(S, aw, gw, !!o.hov), L = art.L;
  const x0 = snapP(o.right - L.W * p), y0 = snapP(o.y - (o.hov ? p : 0));
  blitArt(ctx, art, x0, y0, 0, 0, p);
  // ---- idle life inside the glass (pixels only): a bubble rising through the water half, a blinking facet glint
  if (!rm) {
    const bx = L.xA + S.pad + S.slotA + S.gap - 2, k = (t * 0.22) % 1, by = L.gy + L.gh - 2 - Math.floor(k * (L.gh - 3));
    if (k < 0.92) { ctx.fillStyle = GLASS.a.dot; ctx.fillRect(snapP(x0 + bx * p), snapP(y0 + by * p), p, p); }
    if ((t * 0.5) % 1 < 0.12) { ctx.fillStyle = '#ffffff'; ctx.fillRect(snapP(x0 + (L.xG + L.wG - 3) * p), snapP(y0 + (L.gy + 2) * p), p, p); }
  }
  // ---- numbers (each changed digit hops)
  const dy = L.wellY + Math.floor((S.wellH - S.cap) / 2) - (S.wellH - S.cap) % 2;
  const stA = hopState(ui, (o.id || 'hud') + 'a', aTxt), stG = hopState(ui, (o.id || 'hud') + 'g', gTxt);
  drawDigits(ctx, x0, y0, p, L.wellA + L.wellWA - 2, dy, aTxt, S.font, 'a', stA, ui.coinBump > 0.3, S.small ? 1 : 2);
  drawDigits(ctx, x0, y0, p, L.wellG + L.wellWG - 2, dy, gTxt, S.font, 'g', stG, ui.gemBump > 0.3, S.small ? 1 : 2);
  // ---- the droplet: hops when Aero Bucks land (whole art px, never scaled), a slow idle bob, a glint now and then;
  // a splash of pixel droplets arcs up out of it on each gain
  const ds = spriteOf('drop', S.small);
  const dcxA = L.xA + S.pad + S.slotA / 2, dcyA = L.gy + L.gh / 2;
  const bumpA = ui.coinBump > 0 ? Math.sin(ui.coinBump * Math.PI) : 0;
  const bob = rm ? 0 : Math.max(0, Math.sin(t * 1.3)) ** 12 > 0.5 ? 1 : 0;
  const dax = Math.round(dcxA - ds.width / 2), day = Math.round(dcyA - ds.height / 2) - Math.round(bumpA * (S.small ? 1 : 2)) - bob;
  blitArt(ctx, ds, x0, y0, dax, day, p);
  if (!rm && (t * 0.37) % 1 < 0.05) pxSparkle(ctx, x0 + (dcxA - 2) * p, y0 + (dcyA - 2) * p, p, 1, '#ffffff');
  if (ui.coinBump > 0) walletSplash(ctx, x0, y0, p, dcxA, day + 2, ui.coinBump, S.small);
  // ---- the gem: hops on each gem that ticks in, a shine sweep every few seconds
  const gs = spriteOf('gem', S.small);
  const gcx = L.xG + S.pad + S.slotG / 2, gcy = L.gy + L.gh / 2;
  const hopG = ui.gemBump > 0 ? Math.round(Math.sin(ui.gemBump * Math.PI) * (S.small ? 1 : 2)) : 0;
  const gax = Math.round(gcx - gs.width / 2), gay = Math.round(gcy - gs.height / 2) - hopG;
  blitArt(ctx, gs, x0, y0, gax, gay, p);
  const sweep = ui.gemBump > 0 ? 1 - ui.gemBump : rm ? -1 : ((t * 0.32) % 1.6) - 0.3;
  if (sweep >= 0 && sweep <= 1) {
    const rows = gs.height, cols = gs.width, art2 = S.small ? GEM_SMALL : GEM_BIG, d0 = Math.round(-rows + sweep * (cols + rows));
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    for (let yy = 0; yy < rows; yy++) for (let xx = 0; xx < cols; xx++) {
      const ch = art2[yy][xx];
      if (ch === '.' || ch === 'o') continue;
      const d = xx - (rows - 1 - yy) * 0.5 - d0;
      if (d >= 0 && d < 2) ctx.fillRect(snapP(x0 + (gax + xx) * p), snapP(y0 + (gay + yy) * p), p, p);
    }
  }
  if (ui.gemBump > 0) { pxSparkle(ctx, x0 + (gax + gs.width - 1) * p, y0 + (gay + 1) * p, p, ui.gemBump, '#ffffff'); drawGemShards(ctx, x0 + gcx * p, y0 + gcy * p, p * (S.small ? 0.6 : 0.8), ui.gemBump); }
  // ---- a drip forms under the droplet half and falls off now and then (HUD plaque only)
  if (!rm && !o.mini) {
    const dt0 = (t + 1.7) % 7.5, dxp = snapP(x0 + Math.round(dcxA) * p), base = y0 + L.H * p;
    if (dt0 < 1.2) { ctx.fillStyle = '#4fb4ec'; ctx.fillRect(dxp, base, p, p * (dt0 < 0.6 ? 1 : 2)); }
    else if (dt0 < 2.0) { const k = (dt0 - 1.2) / 0.8, a = ctx.globalAlpha; ctx.globalAlpha = a * (1 - k); ctx.fillStyle = '#8ae6ff'; ctx.fillRect(dxp, snapP(base + p * 2 + k * k * p * 14), p, p * 2); ctx.globalAlpha = a; }
  }
  const W = L.W * p, H = L.H * p;
  return {
    x: x0, y: y0, w: W, h: H, p,
    drop: { x: Math.round(x0 + dcxA * p), y: Math.round(y0 + dcyA * p) }, gem: { x: Math.round(x0 + gcx * p), y: Math.round(y0 + gcy * p) },
    a: { x: x0, y: y0, w: (L.xD + 1) * p, h: H }, g: { x: x0 + (L.xD + 1) * p, y: y0, w: W - (L.xD + 1) * p, h: H },
  };
}

// art px size of a plaque, for layout before drawing
export function walletSize(ui, o = {}) {
  const S = o.mini ? WALLET_ART.MINI : WALLET_ART.FULL;
  const aTxt = fmtShort(Math.floor(ui.coinShown || 0)), gTxt = String(Math.floor(ui.gemShown || 0));
  const aw = Math.max(textW(aTxt, S.font), textW(o.mini ? '000' : '0000', S.font)), gw = Math.max(textW(gTxt, S.font), textW('00', S.font));
  const L = walletLayout(S, aw, gw), p = o.p || 1;
  return { w: L.W * p, h: L.H * p };
}

export function walletTip(ui, onGem) {
  const st = ui.game?.state || {};
  return onGem
    ? `{bytegem} ${GEM_NAME}: ${gems(st)}\nEarned from quests, orders and milestones.\nSkip timers or buy cosmetics with them.`
    : `{abdrop} ${CURRENCY}: ${fmtAero(st.coins || 0)}\nWater-droplet money from fish and your tank.`;
}

export function walletTick(ui, dt) { decayHops(ui, dt); }

// [wallet32] the compact wallet for window headers (replaces each window's own Aero / gem pills): right-aligned at
// `right`, top at y, about 18 logical px tall. While one is showing, the HUD plaque steps aside (no duplicate wallet)
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

// the wallet's art px for the HUD by UI size (whole device px on both layers)
export function walletP(mode) {
  if (HI_ON.on) return mode === 'huge' ? 2 : mode === 'normal' ? 1 : 1.5;
  return mode === 'huge' ? 3 : mode === 'normal' ? 1 : 2;
}
