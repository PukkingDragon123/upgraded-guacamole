// Pooled pixel particle system: bubbles, splashes, sparkles, rings, floating text, sprites, plus the
// "juice" kinds used by the fishing cinematics: trailing droplets, foam, mist, speed lines / light
// streaks, crank sparks, fish scales, ink clouds, confetti, spinning coins, stars, shockwaves, glows.
//
// add(p) takes a plain object (kind, x, y, vx, vy, life, size, color, g, drag, layer, add, delay...).
// `delay` (s) keeps a particle invisible and frozen until it is due. When the pool is full new
// particles recycle the oldest ones instead of being dropped, so big moments never lose effects.

import { rng } from '../core/rng.js';
import { rgba } from '../core/color.js';
import { drawText } from './font.js';
import { makeCanvas, ctxOf } from '../core/canvas.js';
import { TAU, bayer } from '../core/math.js';

// ---------------------------------------------------------------- cached sprites
const ringCache = new Map();
function ringSprite(r, color, flat = 0.4) {
  const key = r + color + flat;
  let c = ringCache.get(key);
  if (!c) {
    const s = r * 2 + 3;
    c = makeCanvas(s, Math.max(3, Math.ceil(r * flat) * 2 + 3));
    const g = ctxOf(c);
    g.fillStyle = color;
    const cy = c.height / 2;
    for (let a = 0; a < TAU; a += 0.5 / Math.max(1, r)) {
      g.fillRect(Math.round(s / 2 + Math.cos(a) * r - 0.5), Math.round(cy + Math.sin(a) * r * flat - 0.5), 1, 1);
    }
    if (ringCache.size > 600) ringCache.clear();
    ringCache.set(key, c);
  }
  return c;
}

const bubbleCache = new Map();
function bubbleSprite(r) {
  let c = bubbleCache.get(r);
  if (!c) {
    const s = r * 2 + 1;
    c = makeCanvas(s, s);
    const g = ctxOf(c);
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      const dx = x - r, dy = y - r, d = Math.hypot(dx, dy);
      if (d > r + 0.3) continue;
      if (d > r - 0.8) g.fillStyle = 'rgba(220,250,255,0.85)';
      else g.fillStyle = 'rgba(160,230,255,0.18)';
      g.fillRect(x, y, 1, 1);
    }
    g.fillStyle = 'rgba(255,255,255,0.95)';
    g.fillRect(Math.max(0, r - Math.ceil(r / 2)), Math.max(0, r - Math.ceil(r / 2)), 1, 1);
    bubbleCache.set(r, c);
  }
  return c;
}

// Dithered soft disc (ink clouds, foam, glows). edge = fraction of the radius that is dithered.
const discCache = new Map();
function discSprite(r, color, edge = 0.45, rim = null) {
  r = Math.max(1, Math.round(r));
  const key = r + color + edge + rim;
  let c = discCache.get(key);
  if (!c) {
    const s = r * 2 + 1;
    c = makeCanvas(s, s);
    const g = ctxOf(c);
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      const d = Math.hypot(x - r, y - r) / (r + 0.35);
      if (d > 1) continue;
      const solid = 1 - edge;
      if (d > solid && bayer(x, y) > 1 - (d - solid) / Math.max(0.01, edge)) continue;
      g.fillStyle = rim && d > 0.55 && y > r ? rim : color;
      g.fillRect(x, y, 1, 1);
    }
    if (discCache.size > 500) discCache.clear();
    discCache.set(key, c);
  }
  return c;
}

const glowCache = new Map();
function glowSprite(r, color) {
  r = Math.max(2, Math.round(r));
  const key = r + color;
  let c = glowCache.get(key);
  if (!c) {
    const s = r * 2 + 1;
    c = makeCanvas(s, s);
    const g = ctxOf(c);
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      const d = Math.hypot(x - r, y - r) / r;
      if (d > 1) continue;
      const k = (1 - d) * (1 - d);
      if (bayer(x, y) > k * 1.6) continue;
      g.fillStyle = rgba(color, 0.25 + k * 0.6);
      g.fillRect(x, y, 1, 1);
    }
    if (glowCache.size > 200) glowCache.clear();
    glowCache.set(key, c);
  }
  return c;
}

// Spinning coin frames (front -> edge -> front).
let coinFrames = null;
function coinFrame(i) {
  if (!coinFrames) {
    coinFrames = [5, 4, 3, 1, 3, 4].map((w, fi) => {
      const c = makeCanvas(7, 7);
      const g = ctxOf(c);
      const x0 = Math.round((7 - w) / 2);
      g.fillStyle = '#5a3208';
      g.fillRect(x0 - (w > 1 ? 1 : 0), 1, w + (w > 1 ? 2 : 0), 5);
      g.fillRect(x0, 0, w, 7);
      g.fillStyle = fi === 3 ? '#c8901a' : '#ffc832';
      g.fillRect(x0, 1, w, 5);
      if (w > 2) {
        g.fillStyle = '#c8901a'; g.fillRect(x0 + w - 1, 2, 1, 4); g.fillRect(x0, 5, w, 1);
        g.fillStyle = '#fff3a0'; g.fillRect(x0, 1, 1, 3); g.fillRect(x0 + 1, 1, w - 2, 1);
        if (w >= 4) { g.fillStyle = '#e8a828'; g.fillRect(x0 + 2, 2, 1, 3); }
      }
      return c;
    });
  }
  return coinFrames[((i % 6) + 6) % 6];
}

function pixelLine(ctx, x0, y0, x1, y1, w = 1) {
  const dx = x1 - x0, dy = y1 - y0;
  const n = Math.max(1, Math.round(Math.max(Math.abs(dx), Math.abs(dy))));
  for (let i = 0; i <= n; i++) ctx.fillRect(Math.round(x0 + (dx * i) / n), Math.round(y0 + (dy * i) / n), w, w);
}

const CONFETTI = ['#ff5a6a', '#ffd23a', '#5ad8ff', '#8aff7a', '#d27bff', '#ffffff', '#ff9a3a'];

export class Particles {
  constructor(max = 900) {
    this.max = max;
    this.list = [];
    this.limitScale = 1;
    this.surfaceY = null; // bubbles pop and droplets land here
    this.rr = 0;
  }

  add(p) {
    const q = {
      kind: 'dot', x: 0, y: 0, vx: 0, vy: 0, life: 1, t: 0, size: 1, color: '#ffffff',
      g: 0, drag: 0, layer: 'fg', add: false, fade: true, ...p,
    };
    q.max = q.life;
    if (q.delay) q.t = -q.delay;
    const cap = Math.max(16, Math.floor(this.max * this.limitScale));
    if (this.list.length >= cap) {
      // recycle the oldest particles (front of the compacted list)
      this.rr = (this.rr + 1) % Math.max(1, Math.min(this.list.length, cap >> 1));
      this.list[this.rr] = q;
      return q;
    }
    this.list.push(q);
    return q;
  }

  // ---------------------------------------------------------------- classic helpers
  bubble(x, y, opts = {}) {
    return this.add({ kind: 'bubble', x, y, vx: rng.float(-4, 4), vy: -rng.float(14, 26), life: rng.float(1.5, 4), size: opts.size ?? rng.pick([1, 1, 1, 2, 2, 3]), wob: rng.float(0, TAU), layer: opts.layer || 'fg', ...opts });
  }

  bubbles(x, y, n = 6, opts = {}) {
    for (let i = 0; i < n; i++) this.bubble(x + rng.float(-3, 3), y + rng.float(-3, 3), { vy: -rng.float(10, 40), ...opts });
  }

  burst(x, y, n, opts = {}) {
    for (let i = 0; i < n; i++) {
      const a = rng.float(0, TAU), sp = rng.float(opts.speedMin ?? 20, opts.speed ?? 70);
      this.add({
        kind: opts.kind || 'dot', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * (opts.flat ?? 1) - (opts.up ?? 0),
        life: rng.float(opts.lifeMin ?? 0.3, opts.life ?? 0.9), size: opts.size ?? rng.pick([1, 1, 2]),
        color: Array.isArray(opts.colors) ? rng.pick(opts.colors) : opts.color || '#ffffff', g: opts.g ?? 60, drag: opts.drag ?? 2,
        add: !!opts.add, layer: opts.layer || 'fg', len: opts.len, delay: opts.delay,
      });
    }
  }

  splash(x, y, power = 1) {
    const n = Math.round(10 + 22 * power);
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + rng.float(-0.9, 0.9);
      const sp = rng.float(30, 110) * (0.6 + power * 0.6);
      this.add({ kind: i % 3 ? 'drop' : 'droplet', x: x + rng.float(-4, 4), y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rng.float(0.5, 1.2), size: rng.pick([1, 1, 2]), color: rng.pick(['#e8fbff', '#a8e8ff', '#ffffff']), g: 260, drag: 0.4 });
    }
    this.ring(x, y, power);
    if (power > 0.5) this.foam(x, y, Math.round(3 + power * 4), { spread: 6 + power * 8 });
    this.bubbles(x, y + 4, Math.round(4 + 6 * power));
  }

  ring(x, y, power = 1, color = 'rgba(230,250,255,0.9)', opts = {}) {
    return this.add({ kind: 'ring', x, y, life: 0.6 + 0.3 * power, r0: 2, r1: 8 + 10 * power, color, layer: 'fg', ...opts });
  }

  sparkle(x, y, color = '#fff6b0', opts = {}) {
    return this.add({ kind: 'sparkle', x, y, vx: rng.float(-6, 6), vy: rng.float(-10, -2), life: rng.float(0.4, 0.9), color, add: true, ...opts });
  }

  text(x, y, text, opts = {}) {
    return this.add({ kind: 'text', x, y, vy: -18, life: 1.3, text, color: '#ffffff', font: 'normal', layer: 'ui', fade: true, ...opts });
  }

  sprite(x, y, canvas, opts = {}) {
    return this.add({ kind: 'sprite', x, y, sprite: canvas, life: 1, vy: -10, layer: 'fg', ...opts });
  }

  // ---------------------------------------------------------------- water
  // Droplets with motion trails. opts: dir (rad), spread, speed [min,max], colors, g, layer, size
  droplets(x, y, n, opts = {}) {
    const dir = opts.dir ?? -Math.PI / 2, spread = opts.spread ?? 1;
    const [s0, s1] = opts.speed || [40, 140];
    for (let i = 0; i < n; i++) {
      const a = dir + rng.float(-spread, spread), sp = rng.float(s0, s1);
      this.add({
        kind: 'droplet', x: x + rng.float(-(opts.w ?? 3), opts.w ?? 3), y: y + rng.float(-1, 1), vx: Math.cos(a) * sp + (opts.vx ?? 0), vy: Math.sin(a) * sp + (opts.vy ?? 0),
        life: rng.float(opts.lifeMin ?? 0.5, opts.life ?? 1.3), size: opts.size ?? rng.pick([1, 1, 1, 2]),
        color: rng.pick(opts.colors || ['#ffffff', '#e8fbff', '#b8ecff', '#8ad8ff']), g: opts.g ?? 300, drag: opts.drag ?? 0.3,
        layer: opts.layer || 'fg', delay: opts.delay ? rng.float(0, opts.delay) : 0, trail: opts.trail ?? 3,
      });
    }
  }

  // Surface foam puffs that swell, drift and fade.
  foam(x, y, n = 6, opts = {}) {
    const spread = opts.spread ?? 10;
    for (let i = 0; i < n; i++) {
      this.add({
        kind: 'foam', x: x + rng.float(-spread, spread), y: y + rng.float(-1.5, 1.5), vx: rng.float(-14, 14) * (opts.push ?? 1), vy: rng.float(-3, 1),
        life: rng.float(0.7, 1.6) * (opts.lifeMul ?? 1), r0: rng.pick([1, 1, 2]), r1: rng.pick([2, 3, 3, 4, 5]) * (opts.scale ?? 1),
        drag: 3, color: opts.color || '#ffffff', rim: opts.rim || '#b8e8f8', layer: opts.layer || 'fg', delay: opts.delay ? rng.float(0, opts.delay) : 0,
      });
    }
  }

  // Fine mist / spray that hangs in the air.
  spray(x, y, power = 1, opts = {}) {
    const n = Math.round(12 * power);
    for (let i = 0; i < n; i++) {
      const a = (opts.dir ?? -Math.PI / 2) + rng.float(-1.2, 1.2);
      const sp = rng.float(20, 90) * power;
      this.add({ kind: 'mist', x: x + rng.float(-6, 6), y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rng.float(0.6, 1.4), g: 30, drag: 2.5, color: rng.pick(['#ffffff', '#d8f6ff', '#b0e4ff']), layer: opts.layer || 'fg' });
    }
  }

  // Concentric ripple rings spreading out over time.
  ripples(x, y, n = 3, power = 1, opts = {}) {
    for (let i = 0; i < n; i++) {
      this.add({ kind: 'ring', x, y, life: 0.7 + power * 0.4, r0: 2 + i * 2, r1: (10 + 14 * power) + i * 6, color: opts.color || 'rgba(230,250,255,0.85)', delay: i * (opts.gap ?? 0.16), layer: opts.layer || 'fg', flat: opts.flat });
    }
  }

  // Big fish-out-of-water eruption: water column, crown droplets, foam skirt, mist, rings, bubbles.
  eruption(x, y, power = 1, opts = {}) {
    const layer = opts.layer || 'fg';
    this.droplets(x, y, Math.round(26 * power), { dir: -Math.PI / 2, spread: 0.35, speed: [120 * power, 260 * power], g: 340, w: 5, layer, life: 1.6 });
    this.droplets(x, y, Math.round(22 * power), { dir: -Math.PI / 2, spread: 1.15, speed: [60, 170 * power], g: 300, w: 8, layer });
    this.spray(x, y - 4, power * 1.4, { layer });
    this.foam(x, y, Math.round(10 * power), { spread: 14 * power, scale: 1.1, layer });
    this.ripples(x, y, 3, power, { layer });
    for (let i = 0; i < 4; i++) this.add({ kind: 'column', x: x + rng.float(-4, 4), y, h: rng.float(30, 60) * power, w: rng.pick([2, 3, 4]), life: rng.float(0.35, 0.6), layer, color: '#e8fbff', delay: i * 0.04 });
    this.bubbles(x, y + 6, Math.round(10 * power));
  }

  // ---------------------------------------------------------------- speed & light
  // Single streak along its velocity. opts.len = pixel length, opts.add = additive.
  streak(x, y, vx, vy, opts = {}) {
    return this.add({ kind: 'streak', x, y, vx, vy, life: opts.life ?? 0.35, len: opts.len ?? 10, color: opts.color || '#ffffff', add: opts.add ?? true, drag: opts.drag ?? 0, g: 0, layer: opts.layer || 'fg', delay: opts.delay, w: opts.w ?? 1 });
  }

  // Radial speed lines around a point. inward = lines rush toward the centre (impact frames).
  speedLines(x, y, n = 16, opts = {}) {
    const r0 = opts.r0 ?? 20, r1 = opts.r1 ?? 60;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + rng.float(-0.12, 0.12);
      const r = rng.float(r0, r1);
      const sp = rng.float(opts.speed?.[0] ?? 120, opts.speed?.[1] ?? 260) * (opts.inward ? -1 : 1);
      this.streak(x + Math.cos(a) * r, y + Math.sin(a) * r, Math.cos(a) * sp, Math.sin(a) * sp, {
        len: rng.float(opts.len?.[0] ?? 8, opts.len?.[1] ?? 20), life: rng.float(0.18, opts.life ?? 0.38), color: Array.isArray(opts.colors) ? rng.pick(opts.colors) : opts.color || '#ffffff', layer: opts.layer, add: opts.add ?? true, w: opts.w,
      });
    }
  }

  // Directional water streaks (behind a dashing fish).
  wake(x, y, dir, n = 3, opts = {}) {
    for (let i = 0; i < n; i++) {
      const a = dir + rng.float(-0.25, 0.25), sp = rng.float(60, 140);
      this.streak(x + rng.float(-6, 6), y + rng.float(-6, 6), -Math.cos(a) * sp, -Math.sin(a) * sp, { len: rng.float(6, 16), life: rng.float(0.2, 0.4), color: opts.color || '#d8f6ff', add: false, layer: opts.layer });
    }
  }

  // Long glowing light streaks shooting out of a point (catch moments).
  lightStreaks(x, y, n = 10, opts = {}) {
    for (let i = 0; i < n; i++) {
      const a = (opts.dir ?? 0) + (opts.spread !== undefined ? rng.float(-opts.spread, opts.spread) : rng.float(0, TAU));
      const sp = rng.float(160, 340);
      this.streak(x, y, Math.cos(a) * sp, Math.sin(a) * sp, { len: rng.float(14, 34), life: rng.float(0.25, 0.55), color: rng.pick(opts.colors || ['#fff6c0', '#ffffff', '#ffe27a']), drag: 3, layer: opts.layer, add: true });
    }
  }

  // Crank sparks: bright, gravity, velocity-aligned.
  sparks(x, y, n = 6, opts = {}) {
    for (let i = 0; i < n; i++) {
      const a = (opts.dir ?? -Math.PI / 2) + rng.float(-(opts.spread ?? Math.PI), opts.spread ?? Math.PI);
      const sp = rng.float(opts.speed?.[0] ?? 40, opts.speed?.[1] ?? 130);
      this.add({ kind: 'spark', x, y, vx: Math.cos(a) * sp + (opts.vx ?? 0), vy: Math.sin(a) * sp + (opts.vy ?? 0), life: rng.float(0.2, opts.life ?? 0.55), g: opts.g ?? 220, drag: 1.5, color: rng.pick(opts.colors || ['#fff6a0', '#ffd23a', '#ffffff', '#ff9a3a']), layer: opts.layer || 'fg', add: true });
    }
  }

  stars(x, y, n = 6, opts = {}) {
    for (let i = 0; i < n; i++) {
      const a = rng.float(0, TAU), sp = rng.float(opts.speed?.[0] ?? 20, opts.speed?.[1] ?? 90);
      this.add({ kind: 'star', x: x + rng.float(-(opts.w ?? 0), opts.w ?? 0), y: y + rng.float(-(opts.h ?? 0), opts.h ?? 0), vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - (opts.up ?? 0), life: rng.float(0.5, opts.life ?? 1.1), g: opts.g ?? 20, drag: 2.2, size: rng.pick(opts.sizes || [1, 2, 2, 3]), color: rng.pick(opts.colors || ['#fff6b0', '#ffffff', '#ffe27a']), layer: opts.layer || 'fg', add: true, spin: rng.float(0, 4), delay: opts.delay ? rng.float(0, opts.delay) : 0 });
    }
  }

  glow(x, y, r = 12, color = '#fff6c0', opts = {}) {
    return this.add({ kind: 'glow', x, y, r, color, life: opts.life ?? 0.5, layer: opts.layer || 'fg', grow: opts.grow ?? 0.4, vx: opts.vx ?? 0, vy: opts.vy ?? 0 });
  }

  // Full circular shockwave (underwater hits, hook-set).
  shockwave(x, y, r = 30, color = '#ffffff', opts = {}) {
    return this.add({ kind: 'ring', x, y, life: opts.life ?? 0.45, r0: opts.r0 ?? 3, r1: r, color: rgba(color, opts.alpha ?? 0.9), flat: 1, layer: opts.layer || 'fg', delay: opts.delay });
  }

  // ---------------------------------------------------------------- creature bits
  scales(x, y, n = 5, colors = ['#c8e8ff'], opts = {}) {
    for (let i = 0; i < n; i++) {
      const a = rng.float(0, TAU), sp = rng.float(20, 70);
      this.add({ kind: 'scale', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 20, life: rng.float(0.9, 1.8), g: opts.g ?? 40, drag: 2.4, color: rng.pick(colors), ph: rng.float(0, TAU), layer: opts.layer || 'fg' });
    }
  }

  ink(x, y, n = 5, opts = {}) {
    for (let i = 0; i < n; i++) {
      const a = rng.float(0, TAU), sp = rng.float(8, 40) * (opts.power ?? 1);
      this.add({ kind: 'ink', x: x + rng.float(-4, 4), y: y + rng.float(-4, 4), vx: Math.cos(a) * sp + (opts.vx ?? 0), vy: Math.sin(a) * sp + (opts.vy ?? 0), life: rng.float(1.2, 2.6) * (opts.lifeMul ?? 1), r0: rng.float(2, 4), r1: rng.float(7, 15) * (opts.scale ?? 1), drag: 1.6, color: opts.color || '#140a22', rim: opts.rim || '#2a1a44', layer: opts.layer || 'fg', delay: opts.delay ? rng.float(0, opts.delay) : 0 });
    }
  }

  bubbleTrail(x, y, vx = 0, vy = 0, opts = {}) {
    const n = opts.n ?? 1;
    for (let i = 0; i < n; i++) {
      this.bubble(x + rng.float(-2, 2), y + rng.float(-2, 2), { vx: -vx * 0.15 + rng.float(-6, 6), vy: -vy * 0.15 - rng.float(8, 24), size: rng.pick(opts.sizes || [1, 1, 2]), life: rng.float(0.6, 1.6), layer: opts.layer || 'fg' });
    }
  }

  // ---------------------------------------------------------------- celebration
  confetti(x, y, n = 30, opts = {}) {
    for (let i = 0; i < n; i++) {
      const a = (opts.dir ?? -Math.PI / 2) + rng.float(-(opts.spread ?? 1.2), opts.spread ?? 1.2);
      const sp = rng.float(opts.speed?.[0] ?? 80, opts.speed?.[1] ?? 240);
      this.add({
        kind: 'confetti', x: x + rng.float(-(opts.w ?? 4), opts.w ?? 4), y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: rng.float(1.6, opts.life ?? 3.2), g: opts.g ?? 90, drag: 1.8, color: rng.pick(opts.colors || CONFETTI),
        spin: rng.float(0, TAU), spinV: rng.float(6, 16) * rng.sign(), sway: rng.float(0, TAU), w: rng.pick([2, 3, 3]), h: rng.pick([2, 3, 4]),
        layer: opts.layer || 'fg', delay: opts.delay ? rng.float(0, opts.delay) : 0,
      });
    }
  }

  coins(x, y, n = 6, opts = {}) {
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + rng.float(-(opts.spread ?? 1), opts.spread ?? 1);
      const sp = rng.float(opts.speed?.[0] ?? 80, opts.speed?.[1] ?? 180);
      this.add({ kind: 'coin', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rng.float(1.1, opts.life ?? 1.8), g: opts.g ?? 380, drag: 0.6, spin: rng.float(0, 6), spinV: rng.float(14, 24), floor: opts.floor ?? null, layer: opts.layer || 'fg', delay: opts.delay ? rng.float(0, opts.delay) : 0 });
    }
  }

  // ---------------------------------------------------------------- simulation
  update(dt) {
    const list = this.list;
    let w = 0;
    const surf = this.surfaceY;
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      p.t += dt;
      if (p.t >= p.max) continue;
      if (p.t < 0) { list[w++] = p; continue; }
      switch (p.kind) {
        case 'bubble':
          p.wob += dt * 5;
          p.vy = Math.max(p.vy - 8 * dt, -45);
          p.x += (p.vx + Math.sin(p.wob) * 6) * dt;
          p.y += p.vy * dt;
          if (surf !== null && p.y < surf + 2 && p.layer !== 'ui') {
            p.t = p.max; // pop
            if (p.size > 1 && list.length < this.max) this.add({ kind: 'dot', x: p.x, y: surf + 1, vy: -10, life: 0.25, color: '#ffffff', layer: p.layer });
            continue;
          }
          break;
        case 'confetti':
          p.spin += p.spinV * dt;
          p.sway += dt * 4;
          p.vx *= Math.exp(-p.drag * dt);
          p.vy *= Math.exp(-p.drag * dt);
          p.vy += p.g * dt;
          p.x += (p.vx + Math.sin(p.sway) * 18) * dt;
          p.y += p.vy * dt;
          break;
        default:
          if (p.trail) { p.px = p.x; p.py = p.y; }
          p.vx *= Math.exp(-p.drag * dt);
          p.vy *= Math.exp(-p.drag * dt);
          p.vy += p.g * dt;
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          if (p.kind === 'coin') {
            p.spin += p.spinV * dt;
            if (p.floor !== null && p.y > p.floor && p.vy > 0) { p.y = p.floor; p.vy *= -0.45; p.vx *= 0.7; }
          }
          if ((p.kind === 'drop' || p.kind === 'droplet') && surf !== null && p.layer !== 'ui' && p.vy > 0 && p.y > surf + 1 && p.t > 0.1) {
            p.t = p.max;
            if (p.size > 1 && list.length < this.max * 0.8) this.add({ kind: 'ring', x: p.x, y: surf + 1, life: 0.35, r0: 1, r1: 4, color: 'rgba(230,250,255,0.8)', layer: p.layer });
            continue;
          }
      }
      list[w++] = p;
    }
    list.length = w;
  }

  // ---------------------------------------------------------------- drawing
  draw(ctx, layer = 'fg', time = 0) {
    for (const p of this.list) {
      if (p.layer !== layer || p.t < 0) continue;
      const k = p.t / p.max;
      const a = p.fade ? Math.min(1, (1 - k) * 2.2) : 1;
      if (a <= 0.02) continue;
      const x = Math.round(p.x), y = Math.round(p.y);
      switch (p.kind) {
        case 'bubble': {
          const s = bubbleSprite(p.size);
          ctx.globalAlpha = a;
          ctx.drawImage(s, x - p.size, y - p.size);
          ctx.globalAlpha = 1;
          break;
        }
        case 'ring': {
          const r = Math.round(p.r0 + (p.r1 - p.r0) * Math.sqrt(k));
          const s = ringSprite(r, p.color, p.flat ?? 0.4);
          ctx.globalAlpha = 1 - k;
          ctx.drawImage(s, x - Math.floor(s.width / 2), y - Math.floor(s.height / 2));
          ctx.globalAlpha = 1;
          break;
        }
        case 'sparkle': {
          const tw = Math.sin(k * Math.PI);
          ctx.globalCompositeOperation = 'lighter';
          ctx.fillStyle = rgba(p.color, a);
          ctx.fillRect(x, y, 1, 1);
          if (tw > 0.4) {
            ctx.fillRect(x - 1, y, 1, 1); ctx.fillRect(x + 1, y, 1, 1);
            ctx.fillRect(x, y - 1, 1, 1); ctx.fillRect(x, y + 1, 1, 1);
          }
          if (tw > 0.8 && (p.big ?? true)) {
            ctx.fillStyle = rgba(p.color, a * 0.5);
            ctx.fillRect(x - 2, y, 1, 1); ctx.fillRect(x + 2, y, 1, 1);
            ctx.fillRect(x, y - 2, 1, 1); ctx.fillRect(x, y + 2, 1, 1);
          }
          ctx.globalCompositeOperation = 'source-over';
          break;
        }
        case 'star': {
          const s = p.size;
          const tw = 0.6 + 0.4 * Math.sin(p.t * 18 + p.spin);
          ctx.globalCompositeOperation = 'lighter';
          ctx.fillStyle = rgba(p.color, a * tw);
          const diag = Math.floor(p.t * 6 + p.spin) % 2 === 1 && s > 1;
          if (diag) {
            for (let i = -s; i <= s; i++) { ctx.fillRect(x + i, y + i, 1, 1); ctx.fillRect(x + i, y - i, 1, 1); }
          } else {
            ctx.fillRect(x - s, y, s * 2 + 1, 1);
            ctx.fillRect(x, y - s, 1, s * 2 + 1);
          }
          ctx.fillStyle = rgba('#ffffff', a);
          ctx.fillRect(x, y, 1, 1);
          ctx.globalCompositeOperation = 'source-over';
          break;
        }
        case 'text':
          ctx.globalAlpha = a;
          drawText(ctx, p.text, x, y, { font: p.font, color: p.color, align: 'center', outline: p.outline ?? '#14202c', time, wave: p.wave, scale: p.scale });
          ctx.globalAlpha = 1;
          break;
        case 'sprite': {
          const s = p.sprite;
          ctx.globalAlpha = a;
          ctx.drawImage(s, x - Math.floor(s.width / 2), y - Math.floor(s.height / 2));
          ctx.globalAlpha = 1;
          break;
        }
        case 'droplet': {
          ctx.fillStyle = rgba(p.color, a);
          ctx.fillRect(x, y, p.size, p.size);
          // motion trail: a short fading line behind the droplet
          const sp = Math.hypot(p.vx, p.vy);
          if (sp > 30) {
            const n = Math.min(p.trail, Math.round(sp / 45) + 1);
            const ux = p.vx / sp, uy = p.vy / sp;
            for (let i = 1; i <= n; i++) {
              ctx.fillStyle = rgba(p.color, a * (1 - i / (n + 1)) * 0.7);
              ctx.fillRect(Math.round(p.x - ux * i * 1.6), Math.round(p.y - uy * i * 1.6), 1, 1);
            }
          }
          break;
        }
        case 'foam': {
          const r = Math.round(p.r0 + (p.r1 - p.r0) * Math.sqrt(k));
          const s = discSprite(r, p.color, 0.5, p.rim);
          ctx.globalAlpha = a * 0.95;
          ctx.drawImage(s, x - r, y - r);
          ctx.globalAlpha = 1;
          break;
        }
        case 'ink': {
          const r = Math.round(p.r0 + (p.r1 - p.r0) * Math.sqrt(k));
          const s = discSprite(r, p.color, 0.55, p.rim);
          ctx.globalAlpha = a * 0.85;
          ctx.drawImage(s, x - r, y - r);
          ctx.globalAlpha = 1;
          break;
        }
        case 'glow': {
          const r = Math.round(p.r * (1 + p.grow * k));
          const s = glowSprite(r, p.color);
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = a;
          ctx.drawImage(s, x - r, y - r);
          ctx.globalAlpha = 1;
          ctx.globalCompositeOperation = 'source-over';
          break;
        }
        case 'mist':
          ctx.fillStyle = rgba(p.color, a * 0.55);
          ctx.fillRect(x, y, 1, 1);
          break;
        case 'column': {
          // a rising sheet of water that collapses
          const h = Math.round(p.h * Math.sin(Math.min(1, k * 1.2) * Math.PI));
          ctx.fillStyle = rgba(p.color, a * 0.8);
          ctx.fillRect(x - (p.w >> 1), y - h, p.w, h);
          ctx.fillStyle = rgba('#ffffff', a);
          ctx.fillRect(x - (p.w >> 1), y - h, p.w, 1);
          break;
        }
        case 'streak':
        case 'spark': {
          const sp = Math.hypot(p.vx, p.vy) || 1;
          const len = p.kind === 'spark' ? Math.min(4, 1 + sp / 50) : p.len * (1 - k * 0.5);
          const ux = p.vx / sp, uy = p.vy / sp;
          if (p.add) ctx.globalCompositeOperation = 'lighter';
          ctx.fillStyle = rgba(p.color, a);
          pixelLine(ctx, p.x, p.y, p.x - ux * len, p.y - uy * len, p.w || 1);
          if (p.kind === 'spark') { ctx.fillStyle = rgba('#ffffff', a); ctx.fillRect(x, y, 1, 1); }
          if (p.add) ctx.globalCompositeOperation = 'source-over';
          break;
        }
        case 'scale': {
          const flick = Math.sin(p.t * 14 + p.ph);
          ctx.fillStyle = rgba(flick > 0.3 ? '#ffffff' : p.color, a);
          if (flick > -0.4) { ctx.fillRect(x, y - 1, 1, 1); ctx.fillRect(x - 1, y, 3, 1); ctx.fillRect(x, y + 1, 1, 1); }
          else ctx.fillRect(x - 1, y, 2, 1);
          break;
        }
        case 'confetti': {
          const cw = Math.max(1, Math.round(Math.abs(Math.cos(p.spin)) * p.w));
          ctx.fillStyle = rgba(p.color, a);
          ctx.fillRect(x - (cw >> 1), y, cw, p.h);
          if (cw > 1) { ctx.fillStyle = rgba('#ffffff', a * 0.5); ctx.fillRect(x - (cw >> 1), y, cw, 1); }
          break;
        }
        case 'coin': {
          ctx.globalAlpha = a;
          ctx.drawImage(coinFrame(Math.floor(p.spin)), x - 3, y - 3);
          ctx.globalAlpha = 1;
          if (Math.floor(p.spin) % 6 === 0 && Math.sin(p.t * 30) > 0.6) {
            ctx.globalCompositeOperation = 'lighter';
            ctx.fillStyle = rgba('#fff6c0', a);
            ctx.fillRect(x - 1, y - 4, 1, 3); ctx.fillRect(x - 2, y - 3, 3, 1);
            ctx.globalCompositeOperation = 'source-over';
          }
          break;
        }
        default: {
          if (p.add) ctx.globalCompositeOperation = 'lighter';
          ctx.fillStyle = rgba(p.color, a);
          ctx.fillRect(x, y, p.size, p.size);
          if (p.add) ctx.globalCompositeOperation = 'source-over';
        }
      }
    }
  }

  clear() { this.list.length = 0; }
}

export { coinFrame, discSprite, glowSprite, pixelLine };
