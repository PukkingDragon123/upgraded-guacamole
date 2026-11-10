// Pooled pixel particle system: bubbles, splashes, sparkles, rings, floating text, sprites, plus the
// "juice" kinds used by the fishing cinematics: trailing droplets, foam, mist, speed lines / light
// streaks, crank sparks, fish scales, ink clouds, confetti, spinning coins, stars, shockwaves, glows,
// and the Frutiger Aero kit: electric arcs (arc/electrify), glossy bubbles (aeroBubbles), glints,
// bokeh orbs, lens flares (lensFlare), leaves and Aero confetti (aeroConfetti), thick glossy rings, and
// the big-moment combos: bloom (swelling soft light), splashBurst (Aero water burst), boltBurst (radial lightning).
//
// [phase5:water] Water hooks: when game.water is attached (particles.water, set by WaterFX) drops and droplets landing
// on the live waterline ring the surface, rising bubbles that reach it sit as little domes and pop, eruptions and
// big splashes kick the surface sim, and splash() adds a crown + mist. New: crown(x, y, power), foamRing(x, y, power),
// surfaceBubble(x, y, r).
//
// [phase8:ui] PIXEL-ART LIBRARY (hand-drawn sprite sheets from src/gfx/pxsprites.js, no lazy rings):
//   pixelBurst(kind, x, y, n = 8, opts)   kinds: sparkle star heart drop splash foam puff bubble scale coin aero
//       confetti ribbon dust smoke leaf petal zap spark impact pop note shard wave
//       opts: {ramp | ramps[], layer, speed:[a,b], dir, spread, up, g, life:[a,b], size, scale (int), w, h, delay}
//   pixel(kind, x, y, opts)               one sprite particle
//   Big-moment combos: impact(x, y, size, opts), poof, pixelSplash, wavelets, hearts, zapBurst, celebrate,
//       uiClick, purchase, unlock, levelUp, chestOpen(x, y, rarity, opts), catchBurst(x, y, rarity, opts)
//   ring / ripples / shockwave / ringWave and raw {kind:'ring'|'ring2'} adds are now routed to pixel effects
//   (wavelets on water, impact bursts / pops elsewhere); no expanding circles are drawn anymore.
//
// add(p) takes a plain object (kind, x, y, vx, vy, life, size, color, g, drag, layer, add, delay...).
// `delay` (s) keeps a particle invisible and frozen until it is due. When the pool is full new
// particles recycle the oldest ones instead of being dropped, so big moments never lose effects.

import { rng } from '../core/rng.js';
import { rgba } from '../core/color.js';
import { drawText } from './font.js';
import { drawPop3D } from '../ui/pop3d.js'; // [phase9:ui] 3D pop-up text
// [phase9:ui] a text colour -> the nearest 3D text palette
function popPalette(c) { const h = String(c || '').toLowerCase(); if (!h.startsWith('#') || h.length < 7) return 'white'; const r = parseInt(h.slice(1, 3), 16), g = parseInt(h.slice(3, 5), 16), b = parseInt(h.slice(5, 7), 16); if (r > 200 && g > 150 && b < 150) return 'gold'; if (r > 200 && g < 150) return 'coral'; if (g > 180 && r < 180 && b < 160) return 'leaf'; if (b > 200 && r < 160) return 'aqua'; return 'white'; }
import { makeCanvas, ctxOf } from '../core/canvas.js';
import { TAU, bayer } from '../core/math.js';
import { pxFrames, pixelBubble } from './pxsprites.js'; // [phase8:ui]

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
function bubbleSprite(r) { // [phase8:ui] pixel bubble with a chunky highlight
  let c = bubbleCache.get(r);
  if (!c) { c = pixelBubble(r); bubbleCache.set(r, c); }
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
const AERO_CONFETTI = ['#59c3ff', '#2fd3e8', '#bfeaff', '#8be04a', '#c8f56a', '#ffffff', '#ffe27a', '#7ff0c8'];

// ---------------------------------------------------------------- Frutiger Aero sprites
// Glossy soap bubble: fresnel rim with a faint rainbow film, big specular top-left, small one bottom-right.
const gbubbleCache = new Map();
function gbubbleSprite(r) {
  r = Math.max(2, Math.min(24, Math.round(r)));
  let c = gbubbleCache.get(r);
  if (c) return c;
  const s = r * 2 + 1;
  c = makeCanvas(s, s);
  const g = ctxOf(c);
  const img = g.createImageData(s, s);
  const d = img.data;
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const dx = x - r, dy = y - r, k = Math.hypot(dx, dy) / (r + 0.4);
    if (k > 1) continue;
    let R = 200, G = 245, B = 255, A = 0.07 + 0.42 * k * k * k;
    const rim = k > 1 - 1.3 / r;
    if (rim) {
      const ang = Math.atan2(dy, dx);
      // thin-film rainbow tint around the rim
      const hue = Math.sin(ang * 2 + 1.2);
      R = 215 + hue * 35; G = 248 - Math.max(0, -hue) * 30; B = 255 - Math.max(0, hue) * 50;
      A = dy + dx < 0 ? 0.95 : 0.7;
    }
    // specular highlights
    const hx = (dx + r * 0.38) / (r * 0.34), hy = (dy + r * 0.42) / (r * 0.22);
    if (hx * hx + hy * hy < 1) { R = 255; G = 255; B = 255; A = 0.95; }
    const lx = (dx - r * 0.45) / (r * 0.16 + 0.5), ly = (dy - r * 0.42) / (r * 0.12 + 0.5);
    if (r > 3 && lx * lx + ly * ly < 1) { R = 255; G = 255; B = 255; A = Math.max(A, 0.6); }
    const i = (y * s + x) * 4;
    d[i] = R; d[i + 1] = G; d[i + 2] = B; d[i + 3] = Math.round(Math.min(1, A) * 255);
  }
  g.putImageData(img, 0, 0);
  if (gbubbleCache.size > 64) gbubbleCache.clear();
  gbubbleCache.set(r, c);
  return c;
}

// Thick ring (glossy shockwave): w px wide, lighter inner edge.
const thickRingCache = new Map();
function thickRingSprite(r, w, color, flat = 1) {
  r = Math.max(2, Math.round(r));
  const key = r + '|' + w + '|' + color + '|' + flat;
  let c = thickRingCache.get(key);
  if (c) return c;
  const s = r * 2 + 3, hh = Math.max(3, Math.ceil(r * flat) * 2 + 3);
  c = makeCanvas(s, hh);
  const g = ctxOf(c);
  const cx = s / 2, cy = hh / 2;
  for (let y = 0; y < hh; y++) for (let x = 0; x < s; x++) {
    const dx = (x + 0.5 - cx), dy = (y + 0.5 - cy) / Math.max(0.05, flat);
    const d = Math.hypot(dx, dy);
    if (d > r + 0.5 || d < r - w + 0.5) continue;
    const inner = d < r - w + 1.5;
    g.fillStyle = inner ? '#ffffff' : color;
    g.fillRect(x, y, 1, 1);
  }
  if (thickRingCache.size > 300) thickRingCache.clear();
  thickRingCache.set(key, c);
  return c;
}

// Jagged electric bolt between two points (re-randomised by the caller every few frames).
function boltPoints(x0, y0, x1, y1, jag, seed) {
  const dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy) || 1;
  const n = Math.max(2, Math.round(L / 5));
  const px = -dy / L, py = dx / L;
  const pts = [[x0, y0]];
  let h = seed;
  for (let i = 1; i < n; i++) {
    h = (h * 1103515245 + 12345) >>> 0;
    const off = ((h / 4294967296) - 0.5) * 2 * jag * Math.sin((i / n) * Math.PI);
    pts.push([x0 + (dx * i) / n + px * off, y0 + (dy * i) / n + py * off]);
  }
  pts.push([x1, y1]);
  return pts;
}

// Draws an electric bolt (white core, cyan glow) along a point list. Exported for the fishing HUD.
export function drawBolt(ctx, pts, a = 1, color = '#7ff4ff', core = '#ffffff') {
  const prev = ctx.globalCompositeOperation;
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = rgba(color, 0.45 * a);
  for (let i = 1; i < pts.length; i++) pixelLine(ctx, pts[i - 1][0] - 1, pts[i - 1][1], pts[i][0] - 1, pts[i][1], 3);
  ctx.fillStyle = rgba(color, 0.9 * a);
  for (let i = 1; i < pts.length; i++) pixelLine(ctx, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1], 1);
  ctx.fillStyle = rgba(core, a);
  for (let i = 1; i < pts.length; i++) pixelLine(ctx, pts[i - 1][0], pts[i - 1][1] - 0.5, pts[i][0], pts[i][1] - 0.5, 1);
  ctx.globalCompositeOperation = prev;
}
export { boltPoints };


// [phase8:ui] ramp for a CSS colour: hex -> derived 5-step ramp; rgba()/unknown -> fallback name
function rampFor(color, fallback = 'white') {
  if (Array.isArray(color)) return color;
  if (typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color)) {
    const c = color.toLowerCase();
    if (c === '#ffffff' || c === '#fff6b0' || c === '#fff6c0' || c === '#ffe27a' || c === '#fff6a0' || c === '#ffd23a') return c === '#ffffff' ? 'white' : 'gold';
    return c;
  }
  return fallback;
}
const RARITY_RAMP = { common: 'white', uncommon: 'lime', rare: 'aqua', epic: 'purple', legendary: 'gold', mythic: 'pink' };
const PX_CONFETTI = ['pink', 'gold', 'aqua', 'lime', 'purple', 'orange', 'mint'];
const rs = (v) => (Array.isArray(v) ? rng.float(v[0], v[1]) : v);
const pickOf = (v) => (Array.isArray(v) ? rng.pick(v) : v);
// per-kind defaults for pixelBurst: sheet, ramp, speed, g, drag, life, anim, size(s), sway, dir/spread
const PXDEF = {
  sparkle: { sheet: 'sparkle', ramp: 'gold', speed: [10, 70], g: -8, drag: 3, life: [0.45, 0.9], anim: 'life', size: [0, 1, 1] },
  star: { sheet: 'star', ramp: 'gold', speed: [50, 150], g: 90, drag: 2.4, life: [0.7, 1.3], anim: 'twinkle', size: [0, 0, 1], up: 30, blink: true },
  heart: { sheet: 'heart', ramp: 'pink', speed: [20, 70], g: -40, drag: 2.2, life: [1, 1.7], anim: 'fixed', size: [0, 0, 1], sway: 10, up: 20, blink: true },
  drop: { sheet: 'drop', ramp: 'aqua', speed: [60, 170], g: 330, drag: 0.3, life: [0.6, 1.1], anim: 'fixed', size: [0, 0, 1], dir: -Math.PI / 2, spread: 1.1 },
  foam: { sheet: 'puff', ramp: 'foam', speed: [10, 40], g: -6, drag: 3, life: [0.5, 0.9], anim: 'life', size: [0, 1] },
  puff: { sheet: 'puff', ramp: 'white', speed: [20, 60], g: -10, drag: 3.2, life: [0.45, 0.8], anim: 'life', size: [0, 1, 1] },
  bubble: { sheet: 'bubble', ramp: 'white', speed: [10, 40], g: -60, drag: 1.5, life: [0.9, 1.8], anim: 'fixed', size: [0, 1, 1, 2, 3], sway: 6, pop: true },
  scale: { sheet: 'scale', ramp: 'aqua', speed: [30, 100], g: 80, drag: 2, life: [1, 1.8], anim: 'loop', fps: 10, up: 20 },
  aero: { sheet: 'aero', ramp: 'aqua', speed: [80, 180], g: 380, drag: 0.6, life: [1, 1.6], anim: 'fixed', dir: -Math.PI / 2, spread: 1, glint: true },
  confetti: { sheet: 'confetti', ramp: PX_CONFETTI, speed: [80, 240], g: 90, drag: 1.8, life: [1.6, 3], anim: 'loop', fps: 12, sway: 18, dir: -Math.PI / 2, spread: 1.2 },
  ribbon: { sheet: 'ribbon', ramp: PX_CONFETTI, speed: [80, 220], g: 70, drag: 1.8, life: [1.6, 3], anim: 'loop', fps: 8, sway: 14, dir: -Math.PI / 2, spread: 1.1 },
  dust: { sheet: 'dust', ramp: 'dust', speed: [10, 40], g: -4, drag: 3, life: [0.5, 1], anim: 'life', size: [0, 1] },
  smoke: { sheet: 'smoke', ramp: 'smoke', speed: [6, 24], g: -30, drag: 2, life: [0.9, 1.6], anim: 'life', size: [1, 2] },
  leaf: { sheet: 'leaf', ramp: 'leaf', speed: [50, 180], g: 60, drag: 2, life: [1.6, 3], anim: 'loop', fps: 6, sway: 16, size: [0, 1], dir: -Math.PI / 2, spread: 1.2 },
  petal: { sheet: 'petal', ramp: ['pink', 'peach', 'white'], speed: [40, 150], g: 45, drag: 2, life: [1.6, 3], anim: 'loop', fps: 6, sway: 18, size: [0, 1], dir: -Math.PI / 2, spread: 1.3 },
  zap: { sheet: 'zap', ramp: 'cyan', speed: [30, 90], g: 0, drag: 4, life: [0.18, 0.35], anim: 'loop', fps: 20 },
  spark: { sheet: 'spark', ramp: 'cyan', speed: [60, 180], g: 120, drag: 2, life: [0.25, 0.5], anim: 'loop', fps: 16 },
  note: { sheet: 'note', ramp: ['purple', 'pink', 'aqua'], speed: [20, 50], g: -30, drag: 2, life: [1, 1.5], anim: 'fixed', sway: 8, up: 20, blink: true },
  shard: { sheet: 'shard', ramp: 'cyan', speed: [60, 160], g: 240, drag: 1, life: [0.6, 1.1], anim: 'loop', fps: 10, up: 40 },
  pop: { sheet: 'pop', ramp: 'white', speed: [0, 0], g: 0, drag: 0, life: [0.22, 0.28], anim: 'life', one: true },
  impact: { sheet: 'impact', ramp: 'gold', speed: [0, 0], g: 0, drag: 0, life: [0.3, 0.34], anim: 'life', size: [1], one: true },
  wave: { sheet: 'wave', ramp: 'foam', speed: [0, 0], g: 0, drag: 0, life: [0.35, 0.5], anim: 'life', one: true },
};
export { PXDEF, RARITY_RAMP };

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
    if (q.kind === 'ring' || q.kind === 'ring2') { // [phase8:ui] no lazy circles: legacy rings become pixel effects
      try { return this.ringFx(q) || q; } catch (e) { console.warn('ringFx', e); return q; }
    }
    if (!(q.life > 0) || !Number.isFinite(q.life)) q.life = 0.5; // [phase8:ui] never let a bad arg break drawing
    if (!Number.isFinite(q.x) || !Number.isFinite(q.y)) return q;
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
    if (power > 0.35 && this.water) { this.crown(x, y, power * 0.8); if (power > 0.6) this.spray(x, y - 2, power * 0.6); } // [phase5:water]
  }

  // [phase5:water] ---------------------------------------------------------------- surface water
  // Crown splash: a ring of droplets thrown up and out in a coronet, thin sheets at its rim, then they rain back.
  crown(x, y, power = 1, opts = {}) {
    const layer = opts.layer || 'fg';
    const n = Math.round(8 + power * 10), w = 3 + power * 5;
    for (let i = 0; i < n; i++) {
      const side = i % 2 ? 1 : -1, f = (i >> 1) / Math.max(1, (n >> 1) - 1);
      const a = -Math.PI / 2 + side * (0.35 + f * 0.55), sp = (70 + power * 70) * (0.85 + 0.3 * Math.random());
      this.add({ kind: 'droplet', x: x + side * (w * (0.4 + f * 0.6)), y: y - 1, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.6 + power * 0.4, size: f < 0.3 && power > 0.8 ? 2 : 1, color: f > 0.6 ? '#ffffff' : '#d8f6ff', g: 330, drag: 0.6, layer, trail: 2 });
    }
    for (const s of [-1, 1]) this.add({ kind: 'column', x: Math.round(x + s * w * 0.8), y, h: 6 + power * 10, w: power > 0.8 ? 2 : 1, life: 0.28 + power * 0.1, layer, color: '#e8fbff' });
    if (power > 0.6) this.add({ kind: 'column', x: Math.round(x), y, h: 10 + power * 18, w: power > 1.2 ? 3 : 2, life: 0.35 + power * 0.15, layer, color: '#f4fdff', delay: 0.12 });
  }

  // A foam ring on the surface sheet (water sim) + a few foam puffs on the line.
  foamRing(x, y, power = 1, opts = {}) {
    this.water?.sim?.ring?.(x, opts.z ?? 0.25 + Math.random() * 0.15, Math.min(1.2, 0.5 + power * 0.4), { speed: 18 + power * 16, life: 1 + power * 0.5, r0: 3 });
    this.foam(x, y, Math.round(2 + power * 3), { spread: 4 + power * 6, layer: opts.layer });
  }

  // A bubble resting on the surface (tension dome) that wobbles and pops.
  surfaceBubble(x, y, r = 2, opts = {}) {
    return this.add({ kind: 'sbubble', x, y, r: Math.max(1, Math.min(4, Math.round(r))), life: opts.life ?? 0.25 + Math.random() * 0.7, layer: opts.layer || 'fg', fade: false, ph: Math.random() * 6 });
  }

  // the live waterline under x (falls back to the flat surface)
  waterAt(x) {
    const w = this.water;
    if (w && w.levelAt) { const v = w.levelAt(x); if (Number.isFinite(v)) return v; }
    return this.surfaceY;
  }

  // a drop hitting the surface: a tiny pock (ring + nudge) on the sim, rate-limited
  dropLanded(x, size, vy) {
    const w = this.water;
    if (!w?.sim) return;
    w.sim.impulse(x, -Math.min(14, 2 + vy * 0.02) * size, 2.5);
    if ((size > 1 || vy > 140) && this.pockN < 14) { this.pockN++; w.sim.ring(x, 0.12 + Math.random() * 0.4, 0.5, { speed: 9, life: 0.45, r0: 0.5, kind: 'rain' }); }
  }
  // [/phase5:water]

  ring(x, y, power = 1, color = 'rgba(230,250,255,0.9)', opts = {}) {
    return this.ringFx({ x, y, r1: 8 + 10 * power, color, layer: opts.layer || 'fg', flat: opts.flat, delay: opts.delay, life: opts.life });
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
    for (let i = 0; i < n; i++) this.wavelets(x, y, power * (1 - i * 0.2), { layer: opts.layer, delay: i * (opts.gap ?? 0.16), spread: 2 + i * 3 }); // [phase8:ui]
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
    if (this.water && layer !== 'ui') { this.water.splash?.(x, 0.8 + power * 1.1, 12 + power * 10); this.crown(x, y, power * 1.1, { layer }); this.foamRing(x, y, power, { layer }); } // [phase5:water]
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
  // [phase8:ui] now a pixel-art impact burst (spiky pop + shards + sparkles) instead of an expanding circle.
  shockwave(x, y, r = 30, color = '#ffffff', opts = {}) {
    return this.impact(x, y, r > 34 ? 2 : r > 16 ? 1 : 0, { ramp: rampFor(color, 'gold'), layer: opts.layer, delay: opts.delay });
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

  // ---------------------------------------------------------------- Frutiger Aero kit
  // Electric arc between two points; flickers (re-jags) every few hundredths of a second.
  arc(x0, y0, x1, y1, opts = {}) {
    return this.add({ kind: 'arc', x: x0, y: y0, x1, y1, life: opts.life ?? rng.float(0.08, 0.2), color: opts.color || '#7ff4ff', jag: opts.jag ?? 4, seed: rng.int(1, 1e9), layer: opts.layer || 'fg', fade: false, delay: opts.delay });
  }

  // A crackle of arcs around a point (stunned fish, shock impacts) plus bright sparks.
  electrify(x, y, r = 12, n = 4, opts = {}) {
    for (let i = 0; i < n; i++) {
      const a0 = rng.float(0, TAU), a1 = a0 + rng.float(0.8, 2.4) * rng.sign();
      const r0 = r * rng.float(0.5, 1.1), r1 = r * rng.float(0.5, 1.2);
      this.arc(x + Math.cos(a0) * r0, y + Math.sin(a0) * r0 * (opts.flat ?? 0.7), x + Math.cos(a1) * r1, y + Math.sin(a1) * r1 * (opts.flat ?? 0.7), { jag: opts.jag ?? 3, layer: opts.layer, color: opts.color, life: opts.life });
    }
    if (opts.sparks !== 0) this.sparks(x, y, opts.sparks ?? 3, { colors: ['#ffffff', '#bff8ff', '#7ff4ff', '#fff6a0'], speed: [40, 120], g: 80, layer: opts.layer, life: 0.35 });
  }

  // Glossy Aero soap bubbles that wobble up and pop at the surface.
  aeroBubbles(x, y, n = 6, opts = {}) {
    for (let i = 0; i < n; i++) {
      this.add({
        kind: 'gbubble', x: x + rng.float(-(opts.w ?? 4), opts.w ?? 4), y: y + rng.float(-(opts.h ?? 4), opts.h ?? 4),
        vx: rng.float(-12, 12) + (opts.vx ?? 0), vy: -rng.float(opts.speed?.[0] ?? 14, opts.speed?.[1] ?? 46),
        life: rng.float(opts.life?.[0] ?? 1.2, opts.life?.[1] ?? 2.8), r: rng.pick(opts.sizes || [2, 2, 3, 3, 4, 5, 6]),
        wob: rng.float(0, TAU), layer: opts.layer || 'fg', delay: opts.delay ? rng.float(0, opts.delay) : 0, rise: opts.rise ?? 1,
      });
    }
  }

  // Four-point star glints with long thin rays (specular sparkle).
  glint(x, y, opts = {}) {
    return this.add({ kind: 'glint', x, y, vx: opts.vx ?? 0, vy: opts.vy ?? 0, life: opts.life ?? rng.float(0.35, 0.7), len: opts.len ?? rng.pick([3, 4, 5, 6]), color: opts.color || '#ffffff', layer: opts.layer || 'fg', fade: false, delay: opts.delay, drag: 2 });
  }

  glints(x, y, n = 4, opts = {}) {
    for (let i = 0; i < n; i++) this.glint(x + rng.float(-(opts.w ?? 10), opts.w ?? 10), y + rng.float(-(opts.h ?? 8), opts.h ?? 8), { ...opts, delay: opts.delay ? rng.float(0, opts.delay) : 0, len: opts.len ?? rng.pick([3, 4, 5, 7]) });
  }

  // Soft out-of-focus light orbs drifting in front of the scene.
  bokeh(x, y, n = 5, opts = {}) {
    for (let i = 0; i < n; i++) {
      const a = rng.float(0, TAU), sp = rng.float(4, opts.speed ?? 26);
      this.add({ kind: 'bokeh', x: x + rng.float(-(opts.w ?? 40), opts.w ?? 40), y: y + rng.float(-(opts.h ?? 30), opts.h ?? 30), vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - (opts.up ?? 4), life: rng.float(1.2, opts.life ?? 2.6), r: rng.int(opts.r?.[0] ?? 4, opts.r?.[1] ?? 12), color: rng.pick(opts.colors || ['#bfeaff', '#ffffff', '#c8f56a', '#7ff0ff']), layer: opts.layer || 'fg', fade: false, drag: 0.8, delay: opts.delay ? rng.float(0, opts.delay) : 0 });
    }
  }

  // Lens flare from a light source through the screen centre (cx, cy): glow, anamorphic streak, ghosts.
  lensFlare(x, y, opts = {}) {
    return this.add({ kind: 'flare', x, y, cx: opts.cx ?? x, cy: opts.cy ?? y, life: opts.life ?? 1.2, scale: opts.scale ?? 1, layer: opts.layer || 'fg', fade: false, delay: opts.delay, tint: opts.tint || '#fff6d8' });
  }

  // Fluttering eco leaves (Aero celebration confetti).
  leaves(x, y, n = 8, opts = {}) {
    for (let i = 0; i < n; i++) {
      const a = (opts.dir ?? -Math.PI / 2) + rng.float(-(opts.spread ?? 1.2), opts.spread ?? 1.2);
      const sp = rng.float(opts.speed?.[0] ?? 60, opts.speed?.[1] ?? 200);
      this.add({
        kind: 'leaf', x: x + rng.float(-(opts.w ?? 4), opts.w ?? 4), y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: rng.float(1.8, opts.life ?? 3.4), g: opts.g ?? 70, drag: 2, color: rng.pick(['#8be04a', '#3fae2a', '#c8f56a', '#5ccf3a']),
        spin: rng.float(0, TAU), spinV: rng.float(3, 9) * rng.sign(), sway: rng.float(0, TAU), layer: opts.layer || 'fg', delay: opts.delay ? rng.float(0, opts.delay) : 0,
      });
    }
  }

  // Celebration mix: Aero-palette confetti, leaves, glossy bubbles and glints.
  aeroConfetti(x, y, n = 30, opts = {}) {
    this.confetti(x, y, Math.round(n * 0.7), { colors: AERO_CONFETTI, ...opts });
    this.leaves(x, y, Math.round(n * 0.2), opts);
    this.aeroBubbles(x, y, Math.round(n * 0.15), { layer: opts.layer, w: opts.w ?? 20, speed: [30, 90] });
  }

  // Thick glossy ring wave.
  // [phase8:ui] was a thick expanding ring; now an impact burst with a spray of sparkles in the same colour.
  ringWave(x, y, r = 30, color = '#bfeaff', opts = {}) {
    return this.impact(x, y, r > 50 ? 2 : r > 20 ? 1 : 0, { ramp: rampFor(color, 'aqua'), layer: opts.layer, delay: opts.delay, sparkles: Math.round(4 + r / 10) });
  }

  // Bloom: a big soft additive light that swells and fades (sun-flare moments).
  bloom(x, y, r = 40, color = '#e8fbff', opts = {}) {
    this.glow(x, y, r, color, { life: opts.life ?? 0.6, grow: opts.grow ?? 0.6, layer: opts.layer });
    return this.glow(x, y, Math.round(r * 0.45), '#ffffff', { life: (opts.life ?? 0.6) * 0.7, grow: 0.3, layer: opts.layer });
  }

  // Aero water burst (any layer, also screen space): radial droplets with trails, a glossy ring,
  // foam puffs, soap bubbles and glints.
  splashBurst(x, y, power = 1, opts = {}) {
    const layer = opts.layer || 'fg';
    this.droplets(x, y, Math.round(18 * power), { dir: opts.dir ?? -Math.PI / 2, spread: opts.spread ?? Math.PI, speed: [40 * power, 150 * power], g: opts.g ?? 220, w: 3, layer, colors: ['#ffffff', '#e8fbff', '#bff8ff', '#7fd8ff'] });
    this.pixelBurst('drop', x, y, Math.round(4 + 4 * power), { layer, spread: Math.PI, speed: [50 * power, 140 * power] }); // [phase8:ui]
    this.pixelBurst('puff', x, y, Math.round(3 + 2 * power), { layer, ramp: 'foam', speed: [20, 60 * power] });
    this.aeroBubbles(x, y, Math.round(4 + 6 * power), { w: 6 * power, h: 4, layer, speed: [30, 90], sizes: [2, 2, 3, 4, 5] });
    this.glints(x, y, Math.round(2 + 2 * power), { w: 10 * power, h: 8 * power, layer });
    if (this.water && layer !== 'ui' && this.surfaceY !== null && Math.abs(y - (this.waterAt(x) ?? y)) < 14) this.water.splash?.(x, 0.5 + power * 0.6, 8 + power * 8); // [phase5:water]
  }

  // Radial lightning: jagged bolts shooting out of a point, a cyan ring and white-hot sparks.
  boltBurst(x, y, r = 30, n = 6, opts = {}) {
    const layer = opts.layer || 'fg';
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + rng.float(-0.3, 0.3), rr = r * rng.float(0.6, 1.1);
      this.arc(x, y, x + Math.cos(a) * rr, y + Math.sin(a) * rr * (opts.flat ?? 1), { jag: opts.jag ?? 5, layer, life: rng.float(0.12, 0.26), color: opts.color, delay: rng.float(0, 0.08) });
    }
    this.pixelBurst('zap', x, y, Math.max(2, Math.round(n / 2)), { layer, speed: [40, 110] }); // [phase8:ui]
    this.sparks(x, y, Math.round(n * 1.5), { colors: ['#ffffff', '#bff8ff', '#7ff4ff', '#fff6a0'], speed: [60, 180], g: 60, layer, life: 0.4 });
    this.glow(x, y, Math.round(r * 0.7), '#bff8ff', { life: 0.25, grow: 0.5, layer });
  }


  // ---------------------------------------------------------------- [phase8:ui] pixel-art library
  // One hand-drawn sprite particle. opts: ramp, size, scale, anim ('life'|'loop'|'twinkle'|'fixed'), fps, frame,
  // vx, vy, g, drag, life, sway, layer, delay, blink (flicker out at the end), pop (bubble pops when done).
  pixel(sheet, x, y, o = {}) {
    const ramp = pickOf(o.ramp ?? 'white');
    return this.add({
      kind: 'px', sheet, ramp, sz: o.size ?? 1, sc: Math.max(1, Math.round(o.scale ?? 1)), x, y, vx: o.vx ?? 0, vy: o.vy ?? 0,
      g: o.g ?? 0, drag: o.drag ?? 0, life: o.life ?? 0.5, anim: o.anim || 'life', fps: o.fps ?? 10, fr: o.frame ?? rng.int(0, 7),
      sway: o.sway ?? 0, ph: rng.float(0, TAU), layer: o.layer || 'fg', delay: o.delay, fade: false, blink: o.blink ?? false, popEnd: !!o.pop,
      flip: o.flip ?? rng.chance(0.5),
    });
  }

  // Radial (or directed) burst of n hand-drawn sprites of one kind. See PXDEF for the per-kind defaults.
  pixelBurst(kind, x, y, n = 8, o = {}) {
    n = Number.isFinite(n) ? Math.min(200, Math.max(0, Math.round(n))) : 8;
    o = o && typeof o === 'object' ? o : {};
    if (kind === 'coin' || kind === 'coins') return this.coins(x, y, n, o);
    if (kind === 'splash') return this.pixelSplash(x, y, o.power ?? Math.min(2, n / 8), o);
    const D = PXDEF[kind] || PXDEF.sparkle;
    const sp = o.speed || D.speed, life = o.life || D.life;
    const dir = o.dir ?? D.dir, spread = o.spread ?? D.spread ?? Math.PI;
    let first = null;
    for (let i = 0; i < n; i++) {
      const a = dir !== undefined ? dir + rng.float(-spread, spread) : (i / Math.max(1, n)) * TAU + rng.float(-0.4, 0.4);
      const v = D.one ? 0 : rs(sp);
      const q = this.pixel(D.sheet, x + rng.float(-(o.w ?? 0), o.w ?? 0), y + rng.float(-(o.h ?? 0), o.h ?? 0), {
        ramp: o.ramps ? rng.pick(o.ramps) : o.ramp ?? D.ramp, size: o.size ?? pickOf(D.size ?? 1), scale: o.scale,
        vx: Math.cos(a) * v + (o.vx ?? 0), vy: Math.sin(a) * v - (o.up ?? D.up ?? 0) + (o.vy ?? 0), g: o.g ?? D.g, drag: o.drag ?? D.drag,
        life: rs(life), anim: D.anim, fps: D.fps, sway: o.sway ?? D.sway ?? 0, layer: o.layer, blink: o.blink ?? D.blink,
        delay: o.delay ? (o.stagger === false ? o.delay : rng.float(0, o.delay)) : 0, pop: D.pop,
      });
      if (D.glint && q) q.glint = true;
      first ||= q;
    }
    return first;
  }

  // Comic impact: a spiky burst that pops into shards, plus sparkles and tiny stars. size 0 | 1 | 2.
  impact(x, y, size = 1, o = {}) {
    size = size === 0 || size === 2 ? size : 1;
    const layer = o.layer || 'fg', ramp = o.ramp || 'gold';
    const q = this.pixel('impact', x, y, { ramp, size, life: 0.3 + size * 0.04, layer, delay: o.delay });
    this.pixelBurst('sparkle', x, y, o.sparkles ?? 4 + size * 3, { layer, ramp: o.sparkRamp || ramp, speed: [40 + size * 30, 90 + size * 60], delay: o.delay, stagger: false });
    if (size >= 1) this.pixelBurst('star', x, y, 2 + size * 2, { layer, ramp: o.sparkRamp || ramp, size: 0, speed: [60, 140 + size * 40], delay: o.delay, stagger: false });
    return q;
  }

  // A cute "poof" (cloud puffs + a couple of sparkles): spawns, despawns, UI closes.
  poof(x, y, o = {}) {
    const layer = o.layer || 'fg';
    this.pixelBurst('puff', x, y, o.n ?? 6, { layer, ramp: o.ramp || 'white', speed: [20, 60 * (o.power ?? 1)], w: 2, h: 2 });
    this.pixelBurst('sparkle', x, y, 2, { layer, ramp: o.sparkRamp || 'gold', size: 0 });
  }

  // Water splash as pixel art: teardrop droplets, foam puffs and two wavelets scooting off on the surface.
  pixelSplash(x, y, power = 1, o = {}) {
    if (!Number.isFinite(power)) power = 1;
    const layer = o.layer || 'fg';
    this.pixelBurst('drop', x, y, Math.round(5 + 8 * power), { layer, ramp: o.ramp || 'aqua', speed: [70 * (0.6 + power * 0.5), 180 * (0.6 + power * 0.5)], spread: 0.95 });
    this.pixelBurst('foam', x, y, Math.round(2 + 3 * power), { layer, w: 4 + power * 4, speed: [8, 30] });
    this.wavelets(x, y, power, { layer });
    if (power > 0.6) this.pixelBurst('sparkle', x, y - 4, 2, { layer, ramp: 'white', size: 0 });
  }

  // Two pixel wave crests sliding left and right on the water line (replaces ripple rings).
  wavelets(x, y, power = 1, o = {}) {
    if (!Number.isFinite(power)) power = 1;
    const layer = o.layer || 'fg', sp = 14 + power * 16, d = o.spread ?? 2;
    for (const s of [-1, 1]) this.pixel('wave', x + s * d, y - 1, { ramp: o.ramp || 'foam', vx: s * sp, drag: 1.4, life: 0.45 + power * 0.25, layer, delay: o.delay, flip: s < 0 });
  }

  hearts(x, y, n = 5, o = {}) { return this.pixelBurst('heart', x, y, n, { dir: -Math.PI / 2, spread: 0.9, ...o }); }

  // Crackling electricity: zig-zag bolt sprites and bright plus sparks.
  zapBurst(x, y, n = 4, o = {}) {
    const layer = o.layer || 'fg';
    this.pixelBurst('zap', x, y, n, { layer, ramp: o.ramp || 'cyan', speed: [30, 100], w: o.r ?? 6, h: o.r ?? 6 });
    this.pixelBurst('spark', x, y, n * 2, { layer, ramp: o.ramp || 'cyan' });
  }

  // Party! confetti chips, ribbons, stars, hearts and sparkles.
  celebrate(x, y, power = 1, o = {}) {
    if (!Number.isFinite(power)) power = 1;
    const layer = o.layer || 'fg';
    this.pixelBurst('confetti', x, y, Math.round(18 * power), { layer, w: 10 * power });
    this.pixelBurst('ribbon', x, y, Math.round(6 * power), { layer, w: 8 * power });
    this.pixelBurst('star', x, y, Math.round(5 * power), { layer, ramp: o.ramp || 'gold', speed: [80, 200] });
    this.pixelBurst('heart', x, y, Math.round(2 + 2 * power), { layer, dir: -Math.PI / 2, spread: 1, speed: [40, 110] });
    this.pixelBurst('sparkle', x, y, Math.round(6 * power), { layer, ramp: 'white', w: 16 * power, h: 10 * power, delay: 0.4 });
  }

  // Juicy little UI click: a puff of tiny sparkles (and a dust kick).
  uiClick(x, y, o = {}) {
    const layer = o.layer || 'ui';
    this.pixelBurst('sparkle', x, y, o.n ?? 4, { layer, ramp: o.ramp || 'white', size: 0, speed: [40, 90] });
    this.pixelBurst('puff', x, y + 2, 2, { layer, ramp: 'white', size: 0, speed: [16, 36], dir: -Math.PI / 2, spread: 1.4 });
  }

  // Buying something: Aero drops + coins hop out, gold sparkles and a star.
  purchase(x, y, o = {}) {
    const layer = o.layer || 'ui';
    this.pixelBurst('aero', x, y, o.n ?? 5, { layer, speed: [70, 150], g: 300 });
    this.pixelBurst('sparkle', x, y, 6, { layer, ramp: 'gold' });
    this.pixelBurst('star', x, y, 3, { layer, ramp: 'gold', size: 0, speed: [50, 120] });
  }

  // Unlocking: a big impact, a star fountain and drifting sparkles.
  unlock(x, y, o = {}) {
    const layer = o.layer || 'ui', ramp = o.ramp || 'gold';
    this.impact(x, y, 1, { layer, ramp });
    this.pixelBurst('star', x, y, 6, { layer, ramp, dir: -Math.PI / 2, spread: 1.2, speed: [80, 180] });
    this.pixelBurst('sparkle', x, y, 6, { layer, ramp: 'white', w: 18, h: 12, delay: 0.3 });
    this.pixelBurst('confetti', x, y, 8, { layer });
  }

  // Level up: a rising column of stars and sparkles, then confetti.
  levelUp(x, y, o = {}) {
    const layer = o.layer || 'ui';
    for (let i = 0; i < 10; i++) this.pixel(i % 3 ? 'sparkle' : 'star', x + rng.float(-14, 14), y + rng.float(-4, 4), { ramp: i % 2 ? 'gold' : 'lime', size: i % 3 ? 1 : 0, vy: -rng.float(50, 110), g: 20, drag: 1.2, life: rng.float(0.8, 1.3), anim: i % 3 ? 'life' : 'twinkle', layer, delay: i * 0.04, blink: true });
    this.impact(x, y, 1, { layer, ramp: 'lime', sparkRamp: 'gold' });
    this.celebrate(x, y - 10, 0.8, { layer });
  }

  // Chest / crate cracking open: a rarity-coloured impact, shards, coins, stars and confetti.
  chestOpen(x, y, rarity = 'common', o = {}) {
    const layer = o.layer || 'ui', ramp = RARITY_RAMP[rarity] || 'gold';
    const pw = { common: 0.7, uncommon: 0.85, rare: 1, epic: 1.25, legendary: 1.6, mythic: 1.8 }[rarity] ?? 1;
    this.impact(x, y, pw > 1.2 ? 2 : 1, { layer, ramp, sparkRamp: 'gold' });
    this.pixelBurst('shard', x, y, Math.round(6 * pw), { layer, ramp });
    this.pixelBurst('dust', x, y + 6, 5, { layer, speed: [30, 70], dir: -Math.PI / 2, spread: 1.6 });
    this.coins(x, y, Math.round(4 * pw), { layer, speed: [90, 200] });
    this.pixelBurst('star', x, y, Math.round(5 * pw), { layer, ramp, speed: [80, 200] });
    if (pw >= 1) this.celebrate(x, y, pw * 0.7, { layer, ramp });
  }

  // A catch: splash, scales in the fish's colours, rarity stars and (for good ones) hearts and confetti.
  catchBurst(x, y, rarity = 'common', o = {}) {
    const layer = o.layer || 'fg', ramp = RARITY_RAMP[rarity] || 'aqua';
    const pw = { common: 0.6, uncommon: 0.8, rare: 1, epic: 1.3, legendary: 1.7, mythic: 1.9 }[rarity] ?? 1;
    this.pixelSplash(x, y, pw, { layer });
    this.pixelBurst('scale', x, y, Math.round(4 + 4 * pw), { layer, ramp: o.scaleRamp || 'aqua' });
    this.pixelBurst('star', x, y, Math.round(3 + 3 * pw), { layer, ramp, speed: [70, 180] });
    if (pw >= 1) this.hearts(x, y - 8, Math.round(2 * pw), { layer });
    if (pw >= 1.3) this.celebrate(x, y - 10, pw * 0.6, { layer, ramp });
  }

  // Converts legacy ring adds into pixel effects (water rings -> wavelets, flat rings -> pops / impacts).
  ringFx(q) {
    if (this._inRing) return null;
    this._inRing = true;
    try { return this.ringFxInner(q); } finally { this._inRing = false; }
  }

  ringFxInner(q) {
    const r = q.r1 ?? 12, layer = q.layer || 'fg', flat = q.flat ?? 0.4;
    const nearWater = this.surfaceY !== null && layer !== 'ui' && Math.abs(q.y - (this.waterAt(q.x) ?? q.y)) < 10;
    if (flat < 0.8 || nearWater) {
      this.wavelets(q.x, q.y, Math.min(1.5, r / 18), { layer, delay: q.delay });
      return this.pixel('puff', q.x, q.y - 1, { ramp: 'foam', size: 0, life: 0.35, layer, delay: q.delay });
    }
    if (r < 10) return this.pixel('pop', q.x, q.y, { ramp: rampFor(q.color, 'white'), life: 0.25, layer, delay: q.delay });
    return this.impact(q.x, q.y, r > 40 ? 2 : r > 18 ? 1 : 0, { ramp: rampFor(q.color, 'white'), layer, delay: q.delay, sparkles: 3 });
  }

  // ---------------------------------------------------------------- simulation
  update(dt) {
    const list = this.list;
    let w = 0;
    const surf = this.surfaceY;
    this.pockN = 0; // [phase5:water]
    const wl = surf !== null && this.water ? (x) => this.waterAt(x) : () => surf; // [phase5:water] live waterline
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
          if (surf !== null && p.y < surf + 16 && p.layer !== 'ui') {
            const ly = wl(p.x); // [phase5:water]
            if (p.y >= ly + 2) break;
            p.t = p.max; // pop
            if (p.size > 1 && list.length < this.max) {
              if (this.water && Math.random() < 0.6) this.surfaceBubble(p.x, ly + 1, p.size, { layer: p.layer }); // [phase5:water]
              else this.add({ kind: 'dot', x: p.x, y: ly + 1, vy: -10, life: 0.25, color: '#ffffff', layer: p.layer });
            }
            continue;
          }
          break;
        case 'gbubble':
          p.wob += dt * 4;
          p.vy = Math.max(p.vy - 10 * dt * p.rise, -60);
          p.vx *= Math.exp(-1.5 * dt);
          p.x += (p.vx + Math.sin(p.wob) * 5) * dt;
          p.y += p.vy * dt * p.rise;
          if (surf !== null && p.y < surf + 16 && p.layer !== 'ui') {
            const ly = wl(p.x); // [phase5:water]
            if (p.y >= ly + 2) break;
            p.t = p.max;
            if (this.water && p.r >= 2 && Math.random() < 0.7) this.surfaceBubble(p.x, ly + 1, Math.min(4, p.r), { layer: p.layer }); // [phase5:water]
            else if (list.length < this.max) this.pixel('pop', p.x, ly, { layer: p.layer, ramp: 'white', life: 0.22 }); // [phase8:ui]
            continue;
          }
          break;
        case 'sbubble': { // [phase5:water] a dome riding the waterline; pops into a micro splash
          p.y = wl(p.x) + 1;
          if (p.t + dt >= p.max) {
            p.t = p.max;
            if (list.length < this.max * 0.9) {
              for (let i = 0; i < 2 + p.r; i++) this.add({ kind: 'drop', x: p.x + rng.float(-p.r, p.r), y: p.y - p.r, vx: rng.float(-30, 30), vy: -rng.float(30, 70), life: 0.5, size: 1, color: '#ffffff', g: 300, drag: 0.4, layer: p.layer });
              this.pixel('pop', p.x, p.y - 1, { layer: p.layer, ramp: 'white', life: 0.22 }); // [phase8:ui]
            }
            this.water?.sim?.ring?.(p.x, 0.08 + Math.random() * 0.2, 0.45, { speed: 7, life: 0.4, r0: 0.5, kind: 'rain' });
            continue;
          }
          break;
        }
        case 'px': // [phase8:ui] sprite particle
          p.vx *= Math.exp(-p.drag * dt);
          p.vy *= Math.exp(-p.drag * dt);
          p.vy += p.g * dt;
          p.x += (p.vx + (p.sway ? Math.sin(p.t * 5 + p.ph) * p.sway : 0)) * dt;
          p.y += p.vy * dt;
          if (p.glint && p.vy > 0 && p.floor != null && p.y > p.floor) { p.y = p.floor; p.vy *= -0.4; }
          if (p.popEnd && p.t + dt >= p.max && list.length < this.max) { p.t = p.max; this.pixel('pop', p.x, p.y, { ramp: 'white', life: 0.22, layer: p.layer }); continue; }
          if (p.popEnd && surf !== null && p.layer !== 'ui' && p.y < wl(p.x) + 1) { p.t = p.max; this.pixel('pop', p.x, wl(p.x), { ramp: 'white', life: 0.22, layer: p.layer }); continue; }
          break;
        case 'leaf':
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
          if ((p.kind === 'drop' || p.kind === 'droplet') && surf !== null && p.layer !== 'ui' && p.vy > 0 && p.y > surf - 16 && p.t > 0.1) {
            const ly = wl(p.x); // [phase5:water] land on the live waterline
            if (p.y > ly + 1) {
              p.t = p.max;
              if (p.size > 1 && list.length < this.max * 0.8) this.pixel('wave', p.x, ly, { layer: p.layer, ramp: 'foam', life: 0.3 }); // [phase8:ui]
              if (this.water) this.dropLanded(p.x, p.size, p.vy);
              continue;
            }
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
        case 'px': { // [phase8:ui] hand-drawn sprite sheet particle
          if (p.blink && k > 0.72 && Math.floor(p.t * 22) % 2) break;
          const F = p.F || (p.F = pxFrames(p.sheet, p.ramp, p.sz));
          let fi;
          if (p.anim === 'life') fi = Math.min(F.length - 1, Math.floor(k * F.length));
          else if (p.anim === 'loop') fi = Math.floor(p.t * p.fps + p.fr) % F.length;
          else if (p.anim === 'twinkle') fi = Math.sin(p.t * 16 + p.ph) > 0.55 ? Math.min(1, F.length - 1) : 0;
          else fi = p.fr % F.length;
          const c = F[fi] || F[0];
          if (!c) break;
          const w = c.width * p.sc, h = c.height * p.sc;
          if (p.flip && p.sheet !== 'zap') {
            ctx.save(); ctx.translate(x + (w >> 1), y - (h >> 1)); ctx.scale(-1, 1); ctx.drawImage(c, 0, 0, w, h); ctx.restore();
          } else ctx.drawImage(c, x - (w >> 1), y - (h >> 1), w, h);
          break;
        }
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
        case 'sparkle': { // [phase8:ui] animated pixel sparkle (grow -> cross -> fade)
          const F = p.F || (p.F = pxFrames('sparkle', rampFor(p.color, 'gold'), p.big === false ? 0 : 1));
          const c = F[Math.min(F.length - 1, Math.floor(k * F.length))];
          ctx.globalAlpha = Math.min(1, a * 1.4);
          ctx.drawImage(c, x - (c.width >> 1), y - (c.height >> 1));
          ctx.globalAlpha = 1;
          break;
        }
        case 'star': { // [phase8:ui] cute outlined pixel stars instead of plus shapes
          if (k > 0.75 && Math.floor(p.t * 22) % 2) break;
          const sz = p.size;
          const F = p.F || (p.F = sz <= 1 ? pxFrames('sparkle', rampFor(p.color, 'gold'), 0) : pxFrames('star', rampFor(p.color, 'gold'), sz >= 3 ? 1 : 0));
          const c = sz <= 1 ? F[Math.min(F.length - 1, Math.floor(k * F.length))] : F[Math.sin(p.t * 16 + p.spin) > 0.5 ? 1 : 0];
          ctx.drawImage(c, x - (c.width >> 1), y - (c.height >> 1));
          break;
        }
        case 'text':
          ctx.globalAlpha = a;
          // [phase9:ui] pop-up words are 3D voxel letters (2D only while the font loads)
          if (!drawPop3D(ctx, String(p.text), x, y, { t: time + (p.spin || 0), pop: Math.min(1, p.t * 4), palette: popPalette(p.color), size: (p.scale || 1) > 1.4 ? 32 : 16, depth: 3, wobble: 0.6, glow: false, sparkle: false }))
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
        case 'sbubble': { // [phase5:water] upper half of a glossy bubble above the line, wobbling
          const r = p.r + (Math.sin(p.t * 30 + p.ph) > 0.6 ? 1 : 0);
          const s = bubbleSprite(r);
          ctx.globalAlpha = 0.95;
          ctx.drawImage(s, 0, 0, s.width, r + 1, x - r, y - r - 1, s.width, r + 1);
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(x - Math.ceil(r / 2), y - r, 1, 1);
          ctx.globalAlpha = 1;
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
        case 'scale': { // [phase8:ui] flipping pixel fish scale
          const F = p.F || (p.F = pxFrames('scale', rampFor(p.color, 'aqua'), 1));
          const c = F[Math.floor(p.t * 10 + p.ph) % F.length];
          ctx.globalAlpha = a;
          ctx.drawImage(c, x - (c.width >> 1), y - (c.height >> 1));
          ctx.globalAlpha = 1;
          break;
        }
        case 'confetti': { // [phase8:ui] outlined pixel confetti chips flipping in 3D
          const F = p.F || (p.F = pxFrames('confetti', rampFor(p.color, 'pink'), 1));
          const c = F[Math.floor(Math.abs(p.spin) * 1.3) % F.length];
          ctx.globalAlpha = a;
          ctx.drawImage(c, x - (c.width >> 1), y - (c.height >> 1));
          ctx.globalAlpha = 1;
          break;
        }
        case 'arc': {
          // flicker: re-jag every ~45 ms, blink off now and then
          const fr = Math.floor(p.t / 0.045);
          if ((fr * 7 + p.seed) % 5 === 0) break;
          const pts = boltPoints(p.x, p.y, p.x1, p.y1, p.jag, (p.seed + fr * 7919) >>> 0);
          drawBolt(ctx, pts, 1 - k * 0.5, p.color);
          break;
        }
        case 'gbubble': {
          const s = gbubbleSprite(p.r);
          ctx.globalAlpha = a;
          ctx.drawImage(s, x - p.r, y - p.r);
          ctx.globalAlpha = 1;
          break;
        }
        case 'glint': {
          const tw = Math.sin(Math.min(1, k) * Math.PI);
          const L = Math.round(p.len * tw);
          if (L < 1) break;
          ctx.globalCompositeOperation = 'lighter';
          for (let i = 1; i <= L; i++) {
            ctx.fillStyle = rgba(p.color, tw * (1 - i / (L + 1)));
            ctx.fillRect(x - i, y, 1, 1); ctx.fillRect(x + i, y, 1, 1);
            ctx.fillRect(x, y - i, 1, 1); ctx.fillRect(x, y + i, 1, 1);
          }
          if (L > 2) {
            ctx.fillStyle = rgba(p.color, tw * 0.45);
            ctx.fillRect(x - 1, y - 1, 1, 1); ctx.fillRect(x + 1, y - 1, 1, 1);
            ctx.fillRect(x - 1, y + 1, 1, 1); ctx.fillRect(x + 1, y + 1, 1, 1);
          }
          ctx.fillStyle = rgba('#ffffff', tw);
          ctx.fillRect(x, y, 1, 1);
          ctx.globalCompositeOperation = 'source-over';
          break;
        }
        case 'bokeh': {
          const s = glowSprite(p.r, p.color);
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = Math.sin(Math.min(1, k) * Math.PI) * 0.35;
          ctx.drawImage(s, x - p.r, y - p.r);
          ctx.globalAlpha = 1;
          ctx.globalCompositeOperation = 'source-over';
          break;
        }
        case 'flare': {
          const fa = Math.sin(Math.min(1, k) * Math.PI);
          const sc = p.scale;
          const vx = p.cx - p.x, vy = p.cy - p.y;
          ctx.globalCompositeOperation = 'lighter';
          // source glow + anamorphic streak
          const gr = Math.round(16 * sc);
          ctx.globalAlpha = fa * 0.8;
          ctx.drawImage(glowSprite(gr, p.tint), x - gr, y - gr);
          const sl = Math.round(140 * sc * (0.6 + 0.4 * fa));
          for (let i = 0; i < sl; i += 2) {
            const f = 1 - i / sl;
            ctx.globalAlpha = fa * f * f * 0.8;
            ctx.fillStyle = i < 6 ? '#ffffff' : '#bfeaff';
            ctx.fillRect(x + i, y, 2, 1); ctx.fillRect(x - i - 2, y, 2, 1);
          }
          ctx.globalAlpha = fa * 0.6;
          ctx.fillStyle = '#ffffff';
          for (let i = 1; i < Math.round(18 * sc); i++) { ctx.fillRect(x, y - i, 1, 1); ctx.fillRect(x, y + i, 1, 1); }
          // ghosts along the axis through the screen centre
          const G = [[0.35, 5, '#9affd8', 0], [0.62, 11, '#7ad8ff', 1], [0.85, 3, '#ffe27a', 0], [1.2, 16, '#c8a8ff', 1], [1.55, 7, '#8aff9a', 0], [1.9, 22, '#7ad8ff', 1]];
          for (const [t, r, col, ring] of G) {
            const gx = Math.round(p.x + vx * t), gy = Math.round(p.y + vy * t), rr = Math.max(2, Math.round(r * sc));
            ctx.globalAlpha = fa * (ring ? 0.35 : 0.3);
            const gr2 = ring ? Math.max(2, rr >> 1) : rr; // [phase8:ui] soft orbs, no ghost rings
            ctx.drawImage(glowSprite(gr2, col), gx - gr2, gy - gr2);
          }
          ctx.globalAlpha = 1;
          ctx.globalCompositeOperation = 'source-over';
          break;
        }
        case 'leaf': { // [phase8:ui] shaded pixel leaf fluttering through rotation frames
          const F = p.F || (p.F = pxFrames('leaf', rampFor(p.color, 'leaf'), 0));
          const c = F[Math.floor(Math.abs(p.spin)) % F.length];
          ctx.globalAlpha = a;
          ctx.drawImage(c, x - (c.width >> 1), y - (c.height >> 1));
          ctx.globalAlpha = 1;
          break;
        }
        case 'ring2': {
          const r = Math.round(p.r0 + (p.r1 - p.r0) * Math.sqrt(k));
          const s = thickRingSprite(r, Math.max(1, Math.round(p.w * (1 - k * 0.6))), p.color, p.flat ?? 1);
          ctx.globalAlpha = (1 - k) * 0.95;
          ctx.drawImage(s, x - Math.floor(s.width / 2), y - Math.floor(s.height / 2));
          ctx.globalAlpha = 1;
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

export { coinFrame, discSprite, glowSprite, pixelLine, gbubbleSprite, thickRingSprite, AERO_CONFETTI };
