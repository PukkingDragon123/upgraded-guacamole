// Extruded 3D voxel lettering from the Alagard pixel font (phase 5, Intro agent).
//
//   buildText3D(text, {size = 16, px = 1, depth = 4, palette = 'aqua', outline = 1}) -> T | null (font not ready)
//     T = {model (whole string), letters: [{model, cx, w, ch}], w, h, d, px}
//     Each font pixel becomes px x px voxels; the face layer carries a vertical gradient and a lit bevel, the
//     body a deeper side colour, and a white sticker outline sits a little behind (Frutiger Aero titles).
//     Letter models are cropped from the same mask (cx = centre x in whole-model voxels) so a renderer can pop,
//     spin and bob them one by one (the opening does this in WebGL through src/gfx/voxgl.js).
//   text3dSprite(text, {size, px, depth, palette, outline, scale, yaw, pitch}) -> {canvas, w, h} | null
//     a cached crisp sprite (voxel.js ray caster) for 2D screens such as the tutorial.
//   drawText3D(ctx, text, x, y, {t, pop 0..1, scale, palette, size, wobble}) draws one centred on (x, y),
//     wobbling through a few cached yaw steps and popping in with a squash.
//   TEXT3D_PALETTES: aqua | leaf | gold | sky | coral | white | logoBlue | logoGreen

import { alagardBitmap, alagardReady, loadAlagard } from './alagard.js';
import { VoxelModel, renderVoxels } from './voxel.js';

export const TEXT3D_PALETTES = {
  aqua: { face: ['#f2ffff', '#9ef0ff', '#3cc8f4'], bevelL: '#ffffff', bevelD: '#1d8fd0', side: '#1270c0', back: '#0a4a94', outline: '#ffffff' },
  sky: { face: ['#ffffff', '#bfe6ff', '#5aa8ff'], bevelL: '#ffffff', bevelD: '#2f6fd8', side: '#2456b8', back: '#173a88', outline: '#ffffff' },
  leaf: { face: ['#f4ffd8', '#a8f06a', '#46c22e'], bevelL: '#ffffff', bevelD: '#2a9a24', side: '#1f7a1c', back: '#155a16', outline: '#ffffff' },
  gold: { face: ['#fffbe0', '#ffe066', '#ffb21a'], bevelL: '#ffffff', bevelD: '#d8820a', side: '#b0600a', back: '#7a3e06', outline: '#ffffff' },
  coral: { face: ['#fff0f0', '#ffb0a0', '#ff6a5a'], bevelL: '#ffffff', bevelD: '#d84a3a', side: '#b0302a', back: '#7a1e1a', outline: '#ffffff' },
  white: { face: ['#ffffff', '#f2fbff', '#cfeeff'], bevelL: '#ffffff', bevelD: '#8fc8ec', side: '#5a9ad0', back: '#3a6aa0', outline: '#2fb8e8' },
  logoBlue: { face: ['#a8ecff', '#3cbcff', '#1478e8'], bevelL: '#ffffff', bevelD: '#0f62c8', side: '#0a4fa8', back: '#06347a', outline: '#ffffff' },
  logoGreen: { face: ['#d4ff96', '#72e04a', '#2fa82a'], bevelL: '#ffffff', bevelD: '#2a8a16', side: '#1f7a12', back: '#124a0a', outline: '#ffffff' },
};

loadAlagard();

let measurer = null;
function measure(text, size) {
  if (!measurer) measurer = document.createElement('canvas').getContext('2d');
  measurer.font = size + 'px Alagard, monospace';
  return measurer.measureText(text).width;
}

// Alpha mask of the text (1 = ink), plus per-letter column ranges.
function textMask(text, size) {
  const bm = alagardBitmap(text, { size, color: '#ffffff' });
  const w = bm.width, h = bm.height;
  const d = bm.getContext('2d').getImageData(0, 0, w, h).data;
  const mask = new Uint8Array(w * h);
  let y0 = h, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3] > 127) { mask[y * w + x] = 1; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (y1 < 0) { y0 = 0; y1 = h - 1; }
  const cols = [];
  for (let i = 0; i < text.length; i++) {
    const a = Math.round(measure(text.slice(0, i), size)) + 1, b = Math.round(measure(text.slice(0, i + 1), size)) + 1;
    cols.push([a, Math.max(a + 1, b)]);
  }
  return { mask, w, h, y0, y1, cols };
}

function paletteIds(m, P) {
  const o = { spec: 0.95, specPow: 16, smooth: 1, jitter: 0.012 };
  return {
    face: P.face.map((c) => m.color(c, o)),
    bevelL: m.color(P.bevelL, { ...o, spec: 1.2 }),
    bevelD: m.color(P.bevelD, o),
    side: m.color(P.side, { ...o, spec: 0.7 }),
    back: m.color(P.back, { ...o, spec: 0.4 }),
    outline: m.color(P.outline, { spec: 0.6, specPow: 10, smooth: 1, jitter: 0.01 }),
  };
}

// Voxelise a window [x0, x1) of the mask into a model.
function voxelise(M, x0, x1, o, P) {
  const px = o.px, D = o.depth * px, OL = o.outline * px;
  const gy0 = M.y0, gy1 = M.y1;
  const gw = x1 - x0, gh = gy1 - gy0 + 1;
  const pad = OL + 1;
  const nx = gw * px + pad * 2, ny = gh * px + pad * 2, nz = D + 2;
  const m = new VoxelModel(nx, ny, nz);
  const ids = paletteIds(m, P);
  const ink = (gx, gy) => gx >= x0 && gx < x1 && gx >= 0 && gy >= 0 && gx < M.w && gy < M.h && M.mask[gy * M.w + gx] === 1;
  // fine grid (voxel space) ink test, so bevels and outlines work per voxel
  const at = (vx, vy) => {
    const gx = x0 + Math.floor((vx - pad) / px), gyTop = gy0 + Math.floor((ny - 1 - vy - pad) / px);
    if (vx < pad || vy < pad) return false;
    return ink(gx, gyTop);
  };
  const near = (vx, vy, r) => {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= r * r + r && at(vx + dx, vy + dy)) return true;
    return false;
  };
  for (let vy = 0; vy < ny; vy++) for (let vx = 0; vx < nx; vx++) {
    if (at(vx, vy)) {
      const k = (vy - pad) / Math.max(1, gh * px - 1); // 0 bottom .. 1 top
      const fi = k > 0.62 ? 0 : k > 0.3 ? 1 : 2;
      const up = !at(vx, vy + 1), left = !at(vx - 1, vy), down = !at(vx, vy - 1), right = !at(vx + 1, vy);
      let face = ids.face[fi];
      if (px > 2 && (up || left)) face = ids.bevelL;
      else if (px > 2 && (down || right)) face = ids.bevelD;
      else if (px > 1 && up) face = ids.face[Math.max(0, fi - 1)];
      for (let z = 1; z <= D; z++) m.set(vx, vy, z, z === D ? face : z === 1 ? ids.back : ids.side);
    } else if (OL > 0 && near(vx, vy, OL)) {
      for (let z = 0; z <= Math.max(1, D - px - 1); z++) m.set(vx, vy, z, ids.outline);
    }
  }
  return { m, pad };
}

const CACHE = new Map();
export function buildText3D(text, o = {}) {
  if (!alagardReady()) return null;
  const opt = { size: o.size ?? 16, px: o.px ?? 1, depth: o.depth ?? 4, outline: o.outline ?? 1, palette: o.palette || 'aqua' };
  const key = text + '|' + JSON.stringify(opt);
  if (CACHE.has(key)) return CACHE.get(key);
  const P = typeof opt.palette === 'object' ? opt.palette : TEXT3D_PALETTES[opt.palette] || TEXT3D_PALETTES.aqua;
  const M = textMask(text, opt.size);
  // trim the empty columns at the ends
  let xa = M.w, xb = 0;
  for (let x = 0; x < M.w; x++) for (let y = 0; y < M.h; y++) if (M.mask[y * M.w + x]) { if (x < xa) xa = x; if (x > xb) xb = x; }
  if (xb < xa) { xa = 0; xb = M.w - 1; }
  const whole = voxelise(M, xa, xb + 1, opt, P);
  const letters = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === ' ') continue;
    let [a, b] = M.cols[i];
    a = Math.max(a, xa); b = Math.min(b, xb + 1);
    // shrink to the inked columns of this letter
    let la = b, lb = a - 1;
    for (let x = a; x < b; x++) for (let y = 0; y < M.h; y++) if (M.mask[y * M.w + x]) { if (x < la) la = x; if (x > lb) lb = x; }
    if (lb < la) continue;
    const L = voxelise(M, la, lb + 1, opt, P);
    letters.push({ model: L.m, ch, w: L.m.nx, cx: (la - xa) * opt.px + L.m.nx / 2, i });
  }
  const T = { model: whole.m, letters, w: whole.m.nx, h: whole.m.ny, d: whole.m.nz, px: opt.px, text };
  CACHE.set(key, T);
  if (CACHE.size > 60) CACHE.delete(CACHE.keys().next().value);
  return T;
}

const SPR = new Map();
export function text3dSprite(text, o = {}) {
  const T = buildText3D(text, o);
  if (!T) return null;
  const scale = o.scale ?? 2, yaw = Math.round(o.yaw ?? 0), pitch = Math.round(o.pitch ?? 12);
  const key = text + '|' + JSON.stringify([o.size, o.px, o.depth, o.outline, o.palette]) + '|' + scale + '|' + yaw + '|' + pitch;
  let s = SPR.get(key);
  if (s) return s;
  const r = renderVoxels(T.model, { scale, yaw, pitch, outline: false, ao: 0.6, edges: 0.35, depthLines: false, light: { top: 3.6, lit: 3.2, dark: 2.2, bottom: 1.6 } });
  s = { canvas: r.canvas, w: r.canvas.width, h: r.canvas.height };
  SPR.set(key, s);
  if (SPR.size > 120) SPR.delete(SPR.keys().next().value);
  return s;
}

export function drawText3D(ctx, text, x, y, o = {}) {
  const t = o.t ?? 0;
  const wob = o.wobble ?? 1;
  const yaw = Math.round((Math.sin(t * 1.6) * 10 * wob) / 5) * 5;
  const s = text3dSprite(text, { size: o.size ?? 16, px: o.px ?? 1, depth: o.depth ?? 4, outline: o.outline ?? 1, palette: o.palette || 'aqua', scale: o.scale ?? 2, yaw, pitch: 14 });
  if (!s) return false;
  const pop = o.pop ?? 1;
  const k = pop < 1 ? Math.max(0, 1 + 2.70158 * Math.pow(pop - 1, 3) + 1.70158 * Math.pow(pop - 1, 2)) : 1;
  const bob = Math.round(Math.sin(t * 2.4) * 2 * wob);
  const w = Math.round(s.w * k), h = Math.round(s.h * (pop < 1 ? 2 - k : 1) * k);
  if (w < 1 || h < 1) return true;
  const a = ctx.globalAlpha;
  if (o.alpha != null) ctx.globalAlpha = a * o.alpha;
  ctx.drawImage(s.canvas, Math.round(x - w / 2), Math.round(y - h / 2 + bob), w, h);
  ctx.globalAlpha = a;
  return true;
}
