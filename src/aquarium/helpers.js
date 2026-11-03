// Aquarium helpers bought in the Lab (stats.autoCollect): a little glossy snail janitor that glides along
// the front glass just under the waterline and slurps up Aero drops bobbing at the surface. Cute cartoon
// eyes on stalks (big pupils, white shine), an aqua Aero shell with a white swirl, a lime body.
//
//   new GlassSnail(aq)   update(aq, dt) / draw(ctx, aq) in tank-local coordinates (inside drawTank)

import { Paint, C, setMix, grad } from './paint.js';
import { clamp, clamp01, TAU } from '../core/math.js';
import { rng } from '../core/rng.js';

const sprites = new Map();

// Snail facing right, size = shell radius in px; frame 0/1 = foot relaxed / stretched, eat = mouth open.
function snailSprite(size, frame, eat) {
  const r = Math.max(3, Math.round(size));
  const key = r + '|' + frame + '|' + (eat ? 1 : 0);
  let s = sprites.get(key);
  if (s) return s;
  const W = r * 4 + 6, H = r * 3 + 5;
  const P = new Paint(W, H);
  const c = P.c;
  const ink = C('#0c3a52');
  const footY = H - 2, st = frame ? r * 0.35 : 0;
  const sx = r + 2, sy = footY - r * 1.05;            // shell centre
  const hx = W - r * 0.9 - 2 + st * 0.5, hy = footY - r * 0.55; // head
  const body = [C('#3a9a28'), C('#8be04a'), C('#d8ff9a')];
  // foot / body: a soft slug shape from under the shell to the head
  P.each(0, 0, W, H, (x, y) => {
    const t = clamp01((x - 2) / (hx - 2));
    const top = footY - r * (0.35 + 0.55 * Math.pow(t, 3));
    const inside = x > 2 && x < hx + r * 0.6 && y > top && y <= footY && Math.hypot((x - hx) / (r * 0.62), (y - hy) / (r * 0.62)) < 1.6 + (x < hx ? 9 : 0);
    const head = Math.hypot((x - hx) / (r * 0.62), (y - hy) / (r * 0.6)) <= 1;
    if (!inside && !head) return 0;
    grad(c, [[0, body[0]], [0.5, body[1]], [1, body[2]]], clamp01(0.75 - (y - (footY - r)) / (r * 1.4)));
    if (y > footY - 1.2) setMix(c, c, body[0], 0.5);
    return 1;
  });
  // eye stalks + cute cartoon eyes
  for (const k of [0, 1]) {
    const ex = hx + r * (0.05 + k * 0.38), ey = hy - r * (1.15 + k * 0.08);
    for (let i = 0; i <= 6; i++) {
      const t = i / 6;
      const x = Math.round(hx + (ex - hx) * t + k * r * 0.1), y = Math.round(hy - r * 0.3 + (ey - hy + r * 0.3) * t);
      P.over(x, y, body[1], 1);
    }
    const er = Math.max(1.6, r * 0.34);
    P.each(ex - er - 1, ey - er - 1, ex + er + 1, ey + er + 1, (x, y) => {
      const d = Math.hypot(x - ex, y - ey);
      if (d > er + 0.6) return 0;
      if (d > er - 0.5) { c[0] = ink[0]; c[1] = ink[1]; c[2] = ink[2]; return 1; }
      c[0] = 255; c[1] = 255; c[2] = 255;
      const dp = Math.hypot(x - ex - er * 0.2, y - ey - er * 0.05);
      if (dp < er * 0.62) { c[0] = 16; c[1] = 24; c[2] = 40; }
      if (Math.hypot(x - ex - er * 0.05, y - ey + er * 0.3) < er * 0.28) { c[0] = 255; c[1] = 255; c[2] = 255; }
      return 1;
    });
  }
  // smile (or an open "o" while slurping)
  const mx = Math.round(hx + r * 0.45), my = Math.round(hy + r * 0.12);
  if (eat) { P.over(mx, my, ink, 1); P.over(mx + 1, my, ink, 1); P.over(mx, my + 1, ink, 1); P.over(mx + 1, my + 1, ink, 1); }
  else { P.over(mx - 1, my, ink, 1); P.over(mx, my + 1, ink, 1); P.over(mx + 1, my, ink, 0.8); }
  // glossy Aero shell with a white swirl
  const shell = [C('#0a6fa8'), C('#2fc3e8'), C('#9cf2ff')];
  P.each(sx - r - 2, sy - r - 2, sx + r + 2, sy + r + 2, (x, y) => {
    const dx = x - sx, dy = y - sy, d = Math.hypot(dx, dy);
    if (d > r + 0.8) return 0;
    if (d > r - 0.2) { c[0] = ink[0]; c[1] = ink[1]; c[2] = ink[2]; return 1; }
    grad(c, [[0, shell[0]], [0.55, shell[1]], [1, shell[2]]], clamp01(0.6 - (dx * 0.4 + dy * 0.7) / r));
    // spiral groove
    const a = Math.atan2(dy, dx);
    const sp = ((d / r) * 2.4 - (a + Math.PI) / TAU) % 1;
    if (Math.abs(sp - 0.5) < 0.09) setMix(c, c, C('#ffffff'), 0.75);
    // highlight
    if (Math.hypot(dx + r * 0.38, dy + r * 0.45) < r * 0.22) { c[0] = 255; c[1] = 255; c[2] = 255; }
    return 1;
  });
  s = { canvas: P.toCanvas(4), ax: Math.round(sx), ay: footY };
  sprites.set(key, s);
  if (sprites.size > 40) sprites.delete(sprites.keys().next().value);
  return s;
}

export class GlassSnail {
  constructor(aq) {
    const T = aq.T;
    this.x = T.W * rng.float(0.3, 0.7);
    this.dir = rng.sign();
    this.t = rng.float(0, 5);
    this.eatT = 0;
    this.restT = 0;
  }

  // the waterline on the front glass: x range and y
  track(aq) {
    const T = aq.T;
    const y = T.top(0) + 3;
    if (!T.round) return { x0: 8, x1: T.W - 8, y };
    const [a, b] = T.span(T.surf + 4, 0, 10);
    return { x0: T.sx(a, 0), x1: T.sx(b, 0), y };
  }

  update(aq, dt) {
    const k = aq.view.fishScale;
    this.t += dt;
    this.eatT = Math.max(0, this.eatT - dt);
    const tr = this.track(aq);
    if (this.restT > 0) { this.restT -= dt; return; }
    // head for the nearest drop that has been bobbing for a little while
    let best = null, bd = Infinity;
    for (const c of aq.coins.list) {
      if (!c.sleep || c.hint || c.rest < 1.5) continue;
      const p = aq.toLocal(c.X, c.Y, c.D);
      const d = Math.abs(p.x - this.x);
      if (d < bd) { bd = d; best = { c, p }; }
    }
    const speed = (8 + 4 * k) * (best ? 1.6 : 0.8);
    if (best) {
      const dx = best.p.x - this.x;
      if (Math.abs(dx) > 1) this.dir = Math.sign(dx);
      this.x += this.dir * Math.min(Math.abs(dx), speed * dt);
      if (Math.abs(dx) < 5 + 6 * k) {
        aq.collectCoin(best.c, 'helper');
        this.eatT = 0.35; this.restT = 0.3;
      }
    } else {
      this.x += this.dir * speed * dt;
      if (this.x < tr.x0 || this.x > tr.x1) this.dir *= -1;
      if (rng.chance(dt * 0.08)) this.restT = rng.float(1, 3);
    }
    this.x = clamp(this.x, tr.x0, tr.x1);
  }

  draw(ctx, aq) {
    const k = aq.view.fishScale;
    const tr = this.track(aq);
    const spr = snailSprite(4 + 5.5 * k, Math.floor(this.t * 3) % 2 && this.restT <= 0 ? 1 : 0, this.eatT > 0);
    const y = Math.round(tr.y + spr.canvas.height - 2);
    const x = Math.round(this.x);
    if (this.dir < 0) {
      ctx.save(); ctx.translate(x, 0); ctx.scale(-1, 1);
      ctx.drawImage(spr.canvas, -spr.ax - spr.canvas.width / 2 + spr.ax, y - spr.ay);
      ctx.restore();
    } else ctx.drawImage(spr.canvas, x - spr.canvas.width / 2, y - spr.ay);
    return { x, y, w: spr.canvas.width, h: spr.canvas.height };
  }
}
