// LRU cache for rasterised creature frames.

import { compileLook, rasterFish } from './fishart.js';

const MAX = 5000;
const cache = new Map();
let nextId = 1;

export const FRAMES = 8;
export const ANGLE_STEP = Math.PI / 12;

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
 * opts: phase (0..1), angle (rad), scale, blink, mouth, inflate, expr, silhouette, squash, still
 */
export function frame(c, opts = {}) {
  const f = Math.floor(((opts.phase || 0) % 1 + 1) % 1 * FRAMES) % FRAMES;
  const a = Math.max(-6, Math.min(6, Math.round((opts.angle || 0) / ANGLE_STEP)));
  const s = Math.max(1, Math.round((opts.scale || 1) * 8));
  const inf = Math.round((opts.inflate || 0) * 4);
  const sq = Math.round((opts.squash || 0) * 3);
  const key = `${c.id}|${f}|${a}|${s}|${opts.blink ? 1 : 0}${opts.mouth ? 1 : 0}${opts.silhouette ? 1 : 0}${opts.still ? 1 : 0}|${opts.expr || ''}|${inf}|${sq}`;
  let r = cache.get(key);
  if (r) {
    cache.delete(key);
    cache.set(key, r);
    return r;
  }
  r = rasterFish(c, {
    phase: f / FRAMES,
    angle: a * ANGLE_STEP,
    scale: s / 8,
    blink: !!opts.blink,
    mouth: opts.mouth ? 1 : 0,
    inflate: inf / 4,
    squash: sq / 3,
    expr: opts.expr,
    silhouette: !!opts.silhouette,
    still: !!opts.still,
  });
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
