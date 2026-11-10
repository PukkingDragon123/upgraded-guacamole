// Compiled creature looks (memoised) and an LRU cache of baked whole-creature frames (phase 8: voxel sprites from
// src/fish/lowpolyfish.js + src/fish/voxelize.js).

import { compileLook } from './fishart.js';
import { lpFrame, LP_SWIM } from '../fish/lowpolyfish.js';
import { voxelWash } from './fishrig.js';
import { makeCanvas, ctxOf } from '../core/canvas.js';

const MAX = 1500;
const cache = new Map();
let nextId = 1;

export const FRAMES = 8;

const compiledCache = new Map();

// Compile (and memoise) a look + variant pair.
export function compiled(look, variant = null, key = null) {
  const k = key ? key + '|' + variantKey(variant) : null;
  if (k && compiledCache.has(k)) return compiledCache.get(k);
  const c = compileLook(look, variant);
  c.id = nextId++;
  if (k) compiledCache.set(k, c);
  return c;
}

export function variantKey(v) {
  if (!v) return '-';
  return [v.mutation || '', v.shiny ? 's' + (v.shinyHue ?? '') : '', v.pattern || '', v.patternColor || '', v.seed || ''].join(':');
}

/**
 * Baked whole-creature frame (phase 6: a cropped low-poly sprite from src/fish/lowpolyfish.js).
 * opts: phase (0..1 swim), angle (rad, pitch: applied by rotating the sprite), scale, inflate, silhouette
 * (true | colour), yaw (deg). Returns {canvas, glowCanvas, ox, oy, anchors, w, h} (canvas drawn at x - ox, y - oy), or null.
 */
export function frame(c, opts = {}) {
  const f8 = Math.floor((((opts.phase || 0) % 1) + 1) % 1 * FRAMES) % FRAMES;
  const S = Math.max(0.1, Math.round((opts.scale || 1) * 8) / 8);
  const ang = Math.max(-0.6, Math.min(0.6, opts.angle || 0));
  const sil = opts.silhouette ? (typeof opts.silhouette === 'string' ? opts.silhouette : '#102033') : '';
  const key = `${c.id}|${f8}|${S}|${Math.round(ang * 10)}|${Math.round((opts.inflate || 0) * 3)}|${sil}|${opts.yaw ?? 12}`;
  let r = cache.get(key);
  if (r) { cache.delete(key); cache.set(key, r); return r; }
  const f = lpFrame(c, { S, yaw: opts.yaw ?? 12, sw: Math.floor((f8 / FRAMES) * LP_SWIM), infl: Math.round((opts.inflate || 0) * 3), force: true });
  if (!f) return null;
  const k = f.k;
  const a0 = Math.round(ang * 10) / 10, ca = Math.cos(a0), sa = Math.sin(a0);
  // rotated bounds of the cell around the origin
  const pts = [[-f.ax, -f.ay], [f.w - f.ax, -f.ay], [-f.ax, f.h - f.ay], [f.w - f.ax, f.h - f.ay]].map(([x, y]) => [(x * ca - y * sa) * k, (x * sa + y * ca) * k]);
  const x0 = Math.floor(Math.min(...pts.map((p) => p[0]))), y0 = Math.floor(Math.min(...pts.map((p) => p[1])));
  const x1 = Math.ceil(Math.max(...pts.map((p) => p[0]))), y1 = Math.ceil(Math.max(...pts.map((p) => p[1])));
  let cv = makeCanvas(Math.max(1, x1 - x0), Math.max(1, y1 - y0));
  const g = ctxOf(cv);
  g.imageSmoothingEnabled = true;
  g.translate(-x0, -y0);
  g.rotate(a0);
  g.scale(k, k);
  g.drawImage(f.canvas, f.sx, f.sy, f.w, f.h, -f.ax, -f.ay, f.w, f.h);
  if (sil) cv = voxelWash(cv, sil, 0.8);
  const toC = (p) => [(p[0] * ca - p[1] * sa) * k - x0, (p[0] * sa + p[1] * ca) * k - y0];
  const anchors = {};
  for (const [n, v] of Object.entries(f.anchors || {})) anchors[n] = toC(v);
  anchors.eyes = (f.eyes || []).map((e) => { const [x, y] = toC([e.x, e.y]); return { x, y, r: e.r * k, type: 'real' }; });
  r = { canvas: cv, glowCanvas: null, ox: -x0, oy: -y0, anchors, w: cv.width, h: cv.height };
  cache.set(key, r);
  if (cache.size > MAX) {
    const it = cache.keys();
    for (let i = 0; i < 200; i++) cache.delete(it.next().value);
  }
  return r;
}

export function clearSpriteCache() {
  cache.clear();
}
