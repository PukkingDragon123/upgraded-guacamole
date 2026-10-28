// Pooled pixel particle system: bubbles, splashes, sparkles, rings, floating text, sprites.

import { rng } from '../core/rng.js';
import { rgba } from '../core/color.js';
import { drawText } from './font.js';
import { makeCanvas, ctxOf } from '../core/canvas.js';
import { TAU } from '../core/math.js';

const ringCache = new Map();
function ringSprite(r, color) {
  const key = r + color;
  let c = ringCache.get(key);
  if (!c) {
    const s = r * 2 + 3;
    c = makeCanvas(s, Math.max(3, Math.ceil(r * 0.8) * 2 + 3));
    const g = ctxOf(c);
    g.fillStyle = color;
    const cy = c.height / 2;
    for (let a = 0; a < TAU; a += 0.5 / Math.max(1, r)) {
      g.fillRect(Math.round(s / 2 + Math.cos(a) * r - 0.5), Math.round(cy + Math.sin(a) * r * 0.4 - 0.5), 1, 1);
    }
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

export class Particles {
  constructor(max = 900) {
    this.max = max;
    this.list = [];
    this.limitScale = 1;
    this.surfaceY = null; // bubbles pop here
  }

  add(p) {
    if (this.list.length >= this.max * this.limitScale) return null;
    const q = {
      kind: 'dot', x: 0, y: 0, vx: 0, vy: 0, life: 1, t: 0, size: 1, color: '#ffffff',
      g: 0, drag: 0, layer: 'fg', add: false, fade: true, ...p,
    };
    q.max = q.life;
    this.list.push(q);
    return q;
  }

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
        add: !!opts.add, layer: opts.layer || 'fg',
      });
    }
  }

  splash(x, y, power = 1) {
    const n = Math.round(10 + 22 * power);
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + rng.float(-0.9, 0.9);
      const sp = rng.float(30, 110) * (0.6 + power * 0.6);
      this.add({ kind: 'drop', x: x + rng.float(-4, 4), y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rng.float(0.5, 1.2), size: rng.pick([1, 1, 2]), color: rng.pick(['#e8fbff', '#a8e8ff', '#ffffff']), g: 260, drag: 0.4 });
    }
    this.ring(x, y, power);
    this.bubbles(x, y + 4, Math.round(4 + 6 * power));
  }

  ring(x, y, power = 1, color = 'rgba(230,250,255,0.9)') {
    return this.add({ kind: 'ring', x, y, life: 0.6 + 0.3 * power, r0: 2, r1: 8 + 10 * power, color, layer: 'fg' });
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

  update(dt) {
    const list = this.list;
    let w = 0;
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      p.t += dt;
      if (p.t >= p.max) continue;
      if (p.kind === 'bubble') {
        p.wob += dt * 5;
        p.vy = Math.max(p.vy - 8 * dt, -45);
        p.x += (p.vx + Math.sin(p.wob) * 6) * dt;
        p.y += p.vy * dt;
        if (this.surfaceY !== null && p.y < this.surfaceY + 2 && p.layer !== 'ui') {
          p.t = p.max; // pop
          if (p.size > 1 && list.length < this.max) this.add({ kind: 'dot', x: p.x, y: this.surfaceY + 1, vy: -10, life: 0.25, color: '#ffffff', layer: p.layer });
          continue;
        }
      } else {
        p.vx *= Math.exp(-p.drag * dt);
        p.vy *= Math.exp(-p.drag * dt);
        p.vy += p.g * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        if (p.kind === 'drop' && this.surfaceY !== null && p.vy > 0 && p.y > this.surfaceY + 1 && p.t > 0.1) {
          p.t = p.max;
          continue;
        }
      }
      list[w++] = p;
    }
    list.length = w;
  }

  draw(ctx, layer = 'fg', time = 0) {
    for (const p of this.list) {
      if (p.layer !== layer) continue;
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
          const s = ringSprite(r, p.color);
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
        case 'text':
          ctx.globalAlpha = a;
          drawText(ctx, p.text, x, y, { font: p.font, color: p.color, align: 'center', outline: p.outline ?? '#14202c', time, wave: p.wave });
          ctx.globalAlpha = 1;
          break;
        case 'sprite': {
          const s = p.sprite;
          ctx.globalAlpha = a;
          ctx.drawImage(s, x - Math.floor(s.width / 2), y - Math.floor(s.height / 2));
          ctx.globalAlpha = 1;
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
