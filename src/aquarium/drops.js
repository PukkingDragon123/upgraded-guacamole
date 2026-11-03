// Aero drops: the aquarium's idle income. Fish puff out glossy aqua drops (the Aero currency, drawn with
// ui/aero.js drawAeroCoin inside a soap-bubble skin) that float up through the water and bob at the surface
// until they are popped (hover / click / sweep), popped by a helper or popped automatically
// (stats.autoCollect). Same interface the aquarium used for the old coin pile, so helpers keep working:
//
//   new AeroDrops()
//   setTank(T, scale)                 TankSpace + on-screen size factor of the current view
//   spawn(X, Y, D, d, {value, vx, vy, vd, hold}) -> drop   tank space (X, Y front-plane px, D depth px)
//   remove(drop), step(dt), wakeAll(), list
//   drop: {id, X, Y, D, d (size class 0..2), value, r / vr (radius px at the front glass), rest (s at the
//          surface), sleep (resting at the surface), hint (tutorial drop: hovers mid-water), ph}
//   onMerge(drop) callback when crowding merges drops into a bigger one.

import { clamp, TAU } from '../core/math.js';
import { rng } from '../core/rng.js';

export const DENOMS = [1, 5, 25];
export const DROP_CAP = 70;

export class AeroDrops {
  constructor() {
    this.list = [];
    this.nextId = 1;
    this.T = null;
    this.scale = 1;
    this.onMerge = null;
    this.mergeT = 0;
  }

  setTank(T, scale) { this.T = T; this.scale = scale; for (const c of this.list) c.r = c.vr = this.radius(c.d, c.value); }

  radius(d, value) {
    const base = [2.4, 3.1, 4.1][d] ?? 2.4;
    const extra = value > DENOMS[d] ? Math.min(2.6, Math.log2(value / DENOMS[d]) * 0.45) : 0;
    return Math.max(2.5, (base + extra) * (0.55 + this.scale * 0.75));
  }

  spawn(X, Y, D, d = 0, o = {}) {
    d = clamp(d | 0, 0, 2);
    const c = {
      id: this.nextId++, X, Y, D, d, value: o.value ?? DENOMS[d],
      vx: o.vx ?? 0, vy: Math.min(0, o.vy ?? 0) * 0.5, vd: o.vd ?? 0,
      ph: rng.float(0, TAU), age: 0, rest: 0, r: 0, vr: 0, sleep: false, hint: false, hold: o.hold ?? 0,
    };
    c.r = c.vr = this.radius(d, c.value);
    this.list.push(c);
    return c;
  }

  remove(c) {
    const i = this.list.indexOf(c);
    if (i >= 0) this.list.splice(i, 1);
  }

  wakeAll() { for (const c of this.list) c.sleep = false; }

  // Rise with drag, wobble, bob at the surface; stay inside the glass; resting drops nudge each other apart.
  step(dt) {
    const T = this.T;
    if (!T || dt <= 0) return;
    const list = this.list;
    const k = this.scale;
    const rise = -(16 + 14 * k);
    const drag = Math.exp(-dt * 2.4);
    for (const c of list) {
      c.age += dt;
      c.ph += dt * 2.1;
      const z = clamp(c.D / T.DEPTH, 0, 0.9);
      const restY = T.surf + c.r * 0.55 + Math.sin(c.ph) * 0.5;
      if (c.hint) {
        // tutorial drop: hovers low in the water so it is easy to find, gently bobbing
        const hy = c.hintY ?? (c.hintY = T.surf + (T.floorFront - T.surf) * 0.58);
        c.vy += ((hy + Math.sin(c.ph * 0.9) * 2 - c.Y) * 3 - c.vy) * Math.min(1, dt * 4);
      } else if (c.hold > 0) {
        c.hold -= dt;
        c.vy *= drag;
      } else {
        c.vy += (rise * (c.d === 2 ? 0.8 : 1) - c.vy) * Math.min(1, dt * 1.5);
      }
      c.vx *= drag; c.vd *= drag;
      c.X += (c.vx + Math.sin(c.ph * 0.7) * 2.5 * k) * dt;
      c.Y += c.vy * dt;
      c.D += c.vd * dt;
      if (c.Y <= restY) {
        c.Y = restY; if (c.vy < 0) c.vy = 0;
        c.rest += dt; c.sleep = true;
      } else { c.sleep = false; c.rest = 0; }
      // walls
      const m = c.r + 1;
      c.D = clamp(c.D, 0, T.DEPTH * 0.9);
      const zz = c.D / T.DEPTH;
      if (T.round) {
        const [a, b] = T.span(Math.max(c.Y, T.surf + 1), zz, m);
        if (b > a) c.X = clamp(c.X, a, b);
        else c.X = T.W / 2;
        const q = T.clampTank(c.X, c.Y, zz, m);
        if (q) { c.X = q[0]; c.Y = Math.max(restY, q[1]); }
      } else c.X = clamp(c.X, m, T.W - m);
      const fl = T.groundZ(c.X, zz) - c.r;
      if (c.Y > fl) c.Y = fl;
      void z;
    }
    // resting drops spread out along the surface instead of stacking up
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (!a.sleep) continue;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        if (!b.sleep) continue;
        const dx = b.X - a.X, dd = (b.D - a.D) * 0.5;
        const min = (a.r + b.r) * 0.92;
        const d2 = dx * dx + dd * dd;
        if (d2 >= min * min) continue;
        const d = Math.sqrt(d2) || 0.01;
        const push = (min - d) * 0.5 * Math.min(1, dt * 8);
        const nx = d > 0.02 ? dx / d : (rng.next() - 0.5), nd = d > 0.02 ? dd / d : (rng.next() - 0.5);
        a.X -= nx * push; b.X += nx * push;
        a.D -= nd * push * 2; b.D += nd * push * 2;
      }
    }
    // crowded: merge the two smallest resting drops into one bigger drop
    this.mergeT -= dt;
    if (list.length > DROP_CAP && this.mergeT <= 0) {
      this.mergeT = 0.12;
      const rest = list.filter((c) => c.sleep && !c.hint).sort((p, q) => p.value - q.value);
      if (rest.length >= 2) {
        const [a, b] = rest;
        a.value += b.value;
        a.d = a.value >= 25 ? 2 : a.value >= 5 ? 1 : 0;
        a.r = a.vr = this.radius(a.d, a.value);
        a.X = (a.X + b.X) / 2; a.D = (a.D + b.D) / 2;
        this.remove(b);
        this.onMerge?.(a);
      }
    }
  }
}
