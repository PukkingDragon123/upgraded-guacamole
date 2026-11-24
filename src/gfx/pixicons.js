// [pixicons26] HAND-DRAWN 2D PIXEL ART icons for the whole UI (replaces the [icons15] voxel renders). Every icon is a
// hand-authored pixel map (src/gfx/pixart.js: string rows over a shared hue-shifted palette, 12 x 12 glyphs,
// 20 x 20 objects, a few parametric families for rods / gems / globes / reels). The engine here adds the clean 1 px
// selective outline (coloured by the material it wraps, darkest under the shape), an optional soft 1 px drop shadow,
// scales with INTEGER nearest-neighbour only (on the 2x hi-res UI layer: `.hi` twins) and caches every scaled canvas.
// Hover feedback is 2D: frame 1 hops the art up one art pixel (no 3D spin).
//
//   PAL                                  the shared palette (char -> hex / #rrggbbaa)
//   hasPix(name) -> bool                 a sprite (or alias / family member) exists
//   pixSprite(name) -> {canvas (1 px per art pixel, outline included), w, h, spin} | null
//   pixFrame(name, px, turn = 0, o) -> {canvas (logical, `.hi`), ox, oy} | null    centred in a square that fits a
//                                        px-logical icon; turn: 'wobble' |turn| > 0.35 / 'full' quarter turns = hop frame
//                                        o: {shadow = true, state: 'normal'|'hover'|'active'}
//   pixStill(name, w, h = w) -> canvas | null   the art scaled to fit a w x h logical box (canvas may be 1 px larger),
//                                        `.hi` twin, `.__icon3d = name` (getUiIcon treats it as final)
//   pixSpin(name) -> 'full' | 'wobble' | null
//   pixKeyName(key) -> sprite name | null   maps model keys ('ui3d:x', 'fish3d:x', 'lab:boat:x', 'item:x', ...) to sprites
//   pixRegister(name, def)               add a sprite at run time (families: rods, gems, cut gems, globes)
//   pickScale(native, devicePx) -> k     the integer device-pixel scale used for an art grid
import { makeCanvas, ctxOf } from '../core/canvas.js';
import { HI } from './hires.js';
import { hexToRgb, mix } from '../core/color.js';
import { PAL, SPRITES, ALIAS, FAMILY } from './pixart.js';

export { PAL };

const INK = '#170e22';
const SHADOW = [8, 22, 52, 0.26];

// ---------------------------------------------------------------- compile (rows -> RGBA grid with outline)
const defs = new Map(Object.entries(SPRITES));
const compiled = new Map();

export function pixRegister(name, def) { defs.set(name, def); compiled.delete(name); }

function rgbaOf(hex) {
  if (!hex) return null;
  const [r, g, b] = hexToRgb(hex.slice(0, 7));
  const a = hex.length >= 9 ? parseInt(hex.slice(7, 9), 16) : 255;
  return [r, g, b, a];
}
const rgbaCache = new Map();
function col(hex) { let c = rgbaCache.get(hex); if (!c) { c = rgbaOf(hex); rgbaCache.set(hex, c); } return c; }

// resolve a def: {base, map, pal, rot, flip} derive from another sprite's rows
function rowsOf(def, depth = 0) {
  if (def.rows) return { rows: def.rows, pal: def.pal || null };
  if (def.base && depth < 6) {
    const b = defs.get(def.base);
    if (!b) return null;
    const r = rowsOf(b, depth + 1);
    if (!r) return null;
    let rows = r.rows;
    if (def.map) rows = rows.map((s) => s.replace(/./g, (ch) => (def.map[ch] !== undefined ? def.map[ch] : ch)));
    if (def.flip) rows = rows.map((s) => [...s].reverse().join(''));
    if (def.flipY) rows = [...rows].reverse();
    for (let q = 0; q < ((def.rot || 0) & 3); q++) { // 90 degrees clockwise
      const h = rows.length, w = Math.max(...rows.map((s) => s.length));
      const out = [];
      for (let x = 0; x < w; x++) { let s = ''; for (let y = h - 1; y >= 0; y--) s += rows[y][x] || '.'; out.push(s); }
      rows = out;
    }
    return { rows, pal: { ...(r.pal || {}), ...(def.pal || {}) } };
  }
  return null;
}

function compile(name) {
  let c = compiled.get(name);
  if (c !== undefined) return c;
  let def = defs.get(name);
  if (!def && ALIAS[name]) return compile(ALIAS[name]);
  if (!def) {
    for (const [pre, make] of Object.entries(FAMILY)) {
      if (name.startsWith(pre)) { try { def = make(name.slice(pre.length)); } catch (e) { console.warn('pixicon family', name, e); def = null; } break; }
    }
    if (def) defs.set(name, def);
  }
  if (!def) { compiled.set(name, null); return null; }
  try { c = build(def); } catch (e) { console.warn('pixicon', name, e); c = null; }
  compiled.set(name, c);
  return c;
}

function build(def) {
  const R = rowsOf(def);
  if (!R) return null;
  const pal = R.pal ? { ...PAL, ...R.pal } : PAL;
  const rows = R.rows;
  const h = rows.length, w = Math.max(...rows.map((s) => s.length));
  const ol = def.ol !== false;
  const p = ol ? 1 : 0;
  const W = w + 2 * p, H = h + 2 * p;
  const px = new Uint8ClampedArray(W * H * 4);
  const block = new Uint8Array(W * H);
  for (let y = 0; y < h; y++) {
    const s = rows[y];
    for (let x = 0; x < w; x++) {
      const ch = s[x] || '.';
      if (ch === '.' || ch === ' ') continue;
      const i = (y + p) * W + x + p;
      if (ch === '_') { block[i] = 1; continue; }
      const hex = pal[ch];
      const c = hex ? col(hex) : [255, 0, 255, 255];
      px.set(c, i * 4);
    }
  }
  if (ol) {
    // selective coloured outline: the material it wraps, pushed toward ink (darker on the shadow side, under the art)
    const ink = col(INK);
    const out = new Uint8ClampedArray(px);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (px[i * 4 + 3] || block[i]) continue;
      const nb = (xx, yy) => (xx < 0 || yy < 0 || xx >= W || yy >= H ? -1 : px[(yy * W + xx) * 4 + 3] > 40 ? yy * W + xx : -1);
      const up = nb(x, y - 1), lf = nb(x - 1, y), rt = nb(x + 1, y), dn = nb(x, y + 1);
      const j = up >= 0 ? up : lf >= 0 ? lf : rt >= 0 ? rt : dn;
      if (j < 0) continue;
      const k = def.ink ? 1 : up >= 0 || lf >= 0 ? 0.86 : 0.74; // under / left of the art = deepest
      const a = px[j * 4 + 3] / 255;
      for (let q = 0; q < 3; q++) out[i * 4 + q] = Math.round(px[j * 4 + q] * (1 - k) * a + ink[q] * (k + (1 - k) * (1 - a)));
      out[i * 4 + 3] = 255;
    }
    px.set(out);
  }
  const canvas = makeCanvas(W, H);
  const g = ctxOf(canvas);
  const img = g.createImageData(W, H);
  img.data.set(px);
  g.putImageData(img, 0, 0);
  return { canvas, w: W, h: H, spin: def.spin || 'wobble', data: px };
}

export function hasPix(name) { return !!name && !!compile(String(name)); }
export function pixSprite(name) { return compile(String(name)); }
export function pixSpin(name) { const c = compile(String(name)); return c ? c.spin : null; }

// ---------------------------------------------------------------- scaling
/** Integer device-pixel scale for an art grid of `native` px shown about `D` device px wide. */
export function pickScale(native, D) {
  return Math.max(1, Math.floor((D * 1.1) / native));
}

const scaledCache = new Map();
// the sprite at k device px per art pixel, optional drop shadow (+1,+1 art px) and hover tint; frame 1 = hop
function scaled(name, sp, k, shadow, state) {
  const key = name + '|' + k + '|' + (shadow ? 1 : 0) + '|' + state;
  let c = scaledCache.get(key);
  if (c) return c;
  const sh = shadow ? 1 : 0;
  c = makeCanvas((sp.w + sh) * k, (sp.h + sh) * k);
  const g = ctxOf(c);
  g.imageSmoothingEnabled = false;
  if (shadow) {
    const t = makeCanvas(sp.w, sp.h), tg = ctxOf(t);
    tg.drawImage(sp.canvas, 0, 0);
    tg.globalCompositeOperation = 'source-in';
    tg.fillStyle = `rgba(${SHADOW[0]},${SHADOW[1]},${SHADOW[2]},1)`;
    tg.fillRect(0, 0, sp.w, sp.h);
    g.globalAlpha = SHADOW[3];
    g.drawImage(t, k, k, sp.w * k, sp.h * k);
    g.globalAlpha = 1;
  }
  let src = sp.canvas;
  if (state === 'hover' || state === 'active') {
    const t = makeCanvas(sp.w, sp.h), tg = ctxOf(t);
    const img = tg.createImageData(sp.w, sp.h);
    const d = img.data, s = sp.data;
    const tint = state === 'hover' ? [255, 246, 214] : [220, 250, 255], m = state === 'hover' ? 0.14 : 0.08;
    for (let i = 0; i < d.length; i += 4) {
      d[i + 3] = s[i + 3];
      const lum = s[i] + s[i + 1] + s[i + 2];
      const mm = lum < 150 ? 0 : m;
      for (let q = 0; q < 3; q++) d[i + q] = s[i + q] + (tint[q] - s[i + q]) * mm;
    }
    tg.putImageData(img, 0, 0);
    src = t;
  }
  g.drawImage(src, 0, 0, sp.w * k, sp.h * k);
  if (scaledCache.size > 2500) scaledCache.delete(scaledCache.keys().next().value);
  scaledCache.set(key, c);
  return c;
}

function frameIndex(spin, turn) {
  if (!turn) return 0;
  if (spin === 'full') { const q = ((turn % 1) + 1) % 1; return q < 0.08 || q > 0.92 ? 0 : Math.floor(q * 4) % 2; }
  return Math.abs(turn) > 0.35 ? 1 : 0;
}

// the logical (1x) twin for plain contexts: crisp at round(k / 2) (never a blurry downsample)
function logicalOf(sp, name, k, shadow, state, S, fr) {
  const c = makeCanvas(S, S);
  const kl = Math.max(1, Math.round(k / HI));
  const art = scaled(name, sp, kl, shadow, state);
  ctxOf(c).drawImage(art, Math.round((S - art.width) / 2), Math.round((S - art.height) / 2) - fr * kl);
  return c;
}

const frameCache = new Map();
export function pixFrame(name, px, turn = 0, o = {}) {
  const sp = compile(String(name));
  if (!sp) return null;
  const D = Math.max(4, Math.round(px * HI));
  const k = pickScale(Math.max(sp.w, sp.h), D);
  const fr = frameIndex(sp.spin, turn);
  const shadow = o.shadow !== false && k >= 3;
  const state = o.state || 'normal';
  const key = name + '|' + k + '|' + fr + '|' + (shadow ? 1 : 0) + '|' + state;
  let e = frameCache.get(key);
  if (e) return e;
  const sh = shadow ? 1 : 0;
  const Wd = (sp.w + sh) * k, Hd = (sp.h + sh) * k;
  const S = Math.ceil((Math.max(Wd, Hd) + 2 * k) / HI) + 2;
  const hi = makeCanvas(S * HI, S * HI);
  const dx = Math.round((S * HI - Wd) / 2 + (sh * k) / 2), dy = Math.round((S * HI - Hd) / 2 + (sh * k) / 2) - fr * k;
  ctxOf(hi).drawImage(scaled(name, sp, k, shadow, state), dx - Math.round((sh * k) / 2), dy - Math.round((sh * k) / 2));
  const c = logicalOf(sp, name, k, shadow, state, S, fr);
  Object.defineProperty(c, 'hi', { value: hi, configurable: true });
  c.__pix = name;
  e = { canvas: c, ox: S / 2, oy: S / 2, k, w: Wd / HI, h: Hd / HI };
  if (frameCache.size > 2500) frameCache.delete(frameCache.keys().next().value);
  frameCache.set(key, e);
  return e;
}

const stillCache = new Map();
export function pixStill(name, w, h = w, o = {}) {
  const sp = compile(String(name));
  if (!sp) return null;
  const key = name + '|' + w + 'x' + h + '|' + (o.shadow ? 1 : 0);
  let c = stillCache.get(key);
  if (c) return c;
  const D = Math.max(4, Math.round(Math.min(w, h) * HI));
  const k = pickScale(Math.max(sp.w, sp.h), D);
  const shadow = !!o.shadow && k >= 3;
  const art = scaled(name, sp, k, shadow, 'normal');
  const cw = Math.max(w, Math.ceil(art.width / HI)), ch = Math.max(h, Math.ceil(art.height / HI));
  const hi = makeCanvas(cw * HI, ch * HI);
  ctxOf(hi).drawImage(art, Math.round((cw * HI - art.width) / 2), Math.round((ch * HI - art.height) / 2));
  c = makeCanvas(cw, ch);
  const kl = Math.max(1, Math.round(k / HI));
  const lo = scaled(name, sp, kl, shadow, 'normal');
  ctxOf(c).drawImage(lo, Math.round((cw - lo.width) / 2), Math.round((ch - lo.height) / 2));
  Object.defineProperty(c, 'hi', { value: hi, configurable: true });
  c.__icon3d = name;
  c.__pix = name;
  if (stillCache.size > 2000) stillCache.delete(stillCache.keys().next().value);
  stillCache.set(key, c);
  return c;
}

// ---------------------------------------------------------------- model keys -> sprites
// ui3d:<name>, fish3d:<name>, decor:<name>, lab:<kind>:<id>, vm:<...>, item:<id>, rod:<id>, bench:<id>, <menu id>
export function pixKeyName(key) {
  if (!key) return null;
  let k = String(key);
  for (let i = 0; i < 3; i++) {
    if (hasPix(k)) return k;
    const m = k.match(/^(vm|ui3d|fish3d|decor|bench|lab|item):(.*)$/);
    if (!m) break;
    k = m[2];
  }
  if (k.startsWith('pkg_') && hasPix('chest_' + k.slice(4))) return 'chest_' + k.slice(4);
  if (hasPix('item_' + k)) return 'item_' + k;
  return hasPix(k) ? k : null;
}

/** Brighten helper used by callers that tint a still (kept tiny on purpose). */
export function pixTint(hex, t) { return mix(hex, '#ffffff', t); }
