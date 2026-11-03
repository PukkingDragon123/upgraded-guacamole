// Compiled creature looks (memoised) and an LRU cache of baked whole-creature voxel frames.

import { compileLook } from './fishart.js';
import { voxelFrame, SWIM_N } from './voxelfish.js';
import { voxelWash } from './fishrig.js';
import { makeCanvas, ctxOf } from '../core/canvas.js';

const MAX = 5000;
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
 * Baked whole-creature voxel frame (FULL VOXEL ART: there is no 2D fish sprite any more).
 * opts: phase (0..1 swim), angle (rad, pitch), scale, inflate, silhouette (true | colour), still, yaw (deg).
 * Returns {canvas, glowCanvas, ox, oy, anchors, w, h} like before (canvas drawn at x - ox, y - oy), or null.
 */
export function frame(c, opts = {}) {
  const f8 = Math.floor((((opts.phase || 0) % 1) + 1) % 1 * FRAMES) % FRAMES;
  const S = Math.max(0.1, Math.round((opts.scale || 1) * 8) / 8);
  const pitch = Math.max(-30, Math.min(30, ((opts.angle || 0) * 180) / Math.PI));
  const sil = opts.silhouette ? (typeof opts.silhouette === 'string' ? opts.silhouette : '#102033') : '';
  const key = `${c.id}|${f8}|${S}|${Math.round(pitch / 10)}|${Math.round((opts.inflate || 0) * 3)}|${sil}|${opts.yaw ?? 15}`;
  let r = cache.get(key);
  if (r) { cache.delete(key); cache.set(key, r); return r; }
  const res = voxelFrame(c, { S, yaw: opts.yaw ?? 15, pitch, sw: Math.floor((f8 / FRAMES) * SWIM_N), infl: Math.round((opts.inflate || 0) * 3), pose: false, lod: 0, pri: 2, force: true });
  if (!res) return null;
  const { f, k } = res;
  let cv = f.canvas;
  if (Math.abs(k - 1) > 0.02) {
    cv = makeCanvas(Math.max(1, Math.round(f.W * k)), Math.max(1, Math.round(f.H * k)));
    ctxOf(cv).drawImage(f.canvas, 0, 0, cv.width, cv.height);
  }
  if (sil) cv = voxelWash(cv, sil, 0.8);
  const anchors = {};
  for (const [n, v] of Object.entries(f.anchors || {})) anchors[n] = [v[0] * k + f.ax * k, v[1] * k + f.ay * k];
  anchors.eyes = (f.eyes || []).map((e) => ({ x: (e.x + f.ax) * k, y: (e.y + f.ay) * k, r: e.r * k, type: e.e?.type }));
  r = { canvas: cv, glowCanvas: sil ? null : f.glow || null, ox: f.ax * k, oy: f.ay * k, anchors, w: cv.width, h: cv.height };
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
