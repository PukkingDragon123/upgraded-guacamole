// Reel crank gesture detector: measures how fast the pointer circles around a moving centre.
// Works in SCREEN coordinates (what the player physically does with the mouse), so it is unaffected
// by camera zoom. The centre is the centroid of the last ~0.4 s of samples, which settles on the
// middle of whatever loop the player is drawing and follows it when the loop drifts around.

import { TAU, clamp, clamp01, damp } from '../core/math.js';

const WINDOW = 0.42; // seconds of samples for the centroid
const MIN_R = 5; // logical px: smaller wiggles do not count

export class Crank {
  constructor() {
    this.reset(-100, -100);
  }

  reset(x, y) {
    this.samples = [];
    this.t = 0;
    this.cx = x; this.cy = y;
    this.x = x; this.y = y;
    this.prevA = null;
    this.omega = 0; // smoothed signed angular velocity (rad/s)
    this.spin = 0; // accumulated signed angle (drives the knob)
    this.speed = 0; // revolutions per second
    this.power = 0; // 0..1.25 crank strength
    this.radius = 0;
    this.dir = 0; // +1 clockwise (screen), -1 counter-clockwise, 0 idle
    this.turns = 0; // signed revolutions since reset
    this.stun = 0; // seconds the crank is jammed (projectile hits)
    this.da = 0;
  }

  get active() { return this.power > 0.12; }

  update(dt, x, y) {
    if (!(dt > 0)) return;
    this.t += dt;
    this.x = x; this.y = y;
    this.stun = Math.max(0, this.stun - dt);
    const s = this.samples;
    s.push([x, y, this.t]);
    while (s.length > 3 && this.t - s[0][2] > WINDOW) s.shift();
    let sx = 0, sy = 0;
    for (const p of s) { sx += p[0]; sy += p[1]; }
    const mx = sx / s.length, my = sy / s.length;
    // far jumps (pointer teleported) re-seed the centre
    if (Math.hypot(mx - this.cx, my - this.cy) > 160) { this.cx = mx; this.cy = my; this.prevA = null; }
    this.cx = damp(this.cx, mx, 14, dt);
    this.cy = damp(this.cy, my, 14, dt);
    const dx = x - this.cx, dy = y - this.cy;
    const r = Math.hypot(dx, dy);
    this.radius = damp(this.radius, r, 8, dt);
    const a = Math.atan2(dy, dx);
    let da = 0;
    if (this.prevA !== null && r > MIN_R) {
      da = a - this.prevA;
      if (da > Math.PI) da -= TAU;
      if (da < -Math.PI) da += TAU;
      if (Math.abs(da) > 2.7) da = 0; // ambiguous half-turn: ignore
    }
    this.prevA = r > MIN_R ? a : null;
    this.da = da;
    this.omega = damp(this.omega, da / dt, 7, dt);
    this.spin += da;
    this.turns += da / TAU;
    const rev = Math.abs(this.omega) / TAU;
    this.speed = rev;
    const rk = clamp01((this.radius - 3) / 9);
    const target = this.stun > 0 ? 0 : clamp((rev - 0.3) / 2, 0, 1.25) * rk;
    this.power = damp(this.power, target, target > this.power ? 9 : 6, dt);
    this.dir = rev > 0.3 ? Math.sign(this.omega) : 0;
  }
}
