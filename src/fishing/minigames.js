// Species special events, played inside the zoomed fight scene on top of the crank backbone.
// Each event: update(dt) -> 'ok' | 'win' | 'fail' | 'snap'; drawWorld(ctx) (world space, after the
// fish); drawHud(ctx) (screen space); title/sub/color for the banner; prompt for the prompt line;
// meter (0..1) for the HUD event bar; focus {x, y, zoom} to steer the camera; hint() -> screen point.

import { TAU, clamp, clamp01, lerp, dist, damp, pointInPoly } from '../core/math.js';
import { rng } from '../core/rng.js';
import { rgba } from '../core/color.js';
import { drawText } from '../gfx/font.js';

export function drawCircle(ctx, cx, cy, r, color, a = 1, w = 1, dash = 0, rot = 0) {
  ctx.fillStyle = rgba(color, a);
  const n = Math.max(12, Math.round(r * 4));
  let px = null, py = null;
  for (let i = 0; i < n; i++) {
    if (dash && Math.floor((i / n) * dash * 2) % 2) continue;
    const ang = (i / n) * TAU + rot;
    const x = Math.round(cx + Math.cos(ang) * r), y = Math.round(cy + Math.sin(ang) * r);
    if (x === px && y === py) continue;
    ctx.fillRect(x, y, w, w);
    px = x; py = y;
  }
}

class Event {
  constructor(F, B, name) {
    this.F = F; this.B = B; this.fish = F.fish; this.name = name;
    this.t = 0;
    this.home = { x: this.fish.x, y: this.fish.y };
    this.meter = 0;
    this.focus = null;
    this.tension = 0.35;
    this.usesCrank = false;
  }

  get power() { return this.B.power; }
  hint() { return this.F.toScreen(this.fish.x, this.fish.y); }
  thrashAt(dt, x, y, amp = 2, speed = 8) {
    const f = this.fish;
    f.x = damp(f.x, x + Math.sin(this.t * 31) * amp, speed, dt);
    f.y = damp(f.y, y + Math.cos(this.t * 27) * amp * 0.7, speed, dt);
    f.vx = Math.sin(this.t * 6) * 40; f.vy = 0;
  }
  drawWorld() {}
  drawHud() {}
}

// ---------------------------------------------------------------- mash: rapid clicks yank it up
class MashEvent extends Event {
  constructor(F, B) {
    super(F, B, 'mash');
    this.title = 'MASH!'; this.sub = 'Click as fast as you can!'; this.color = '#ffe27a';
    this.meter = 0.1;
    this.dur = 4.5 + (1 - this.power) * 1.5;
    this.combo = 0;
    this.prompt = '{mouse_l} CLICK CLICK CLICK!';
    this.winText = 'POWER YANK!';
  }

  update(dt) {
    const F = this.F, f = this.fish, st = F.stats;
    this.t += dt;
    this.meter = Math.max(0, this.meter - dt * (0.1 + this.power * 0.12));
    for (let i = 0; i < F.input.clicks; i++) {
      this.meter += (0.085 * st.mashPower) / (0.6 + this.power * 0.8);
      this.combo++;
      f.squashV += 6;
      this.home.y -= 1.2;
      const m = f.anchors?.mouth || [f.x, f.y];
      F.particles.sparks(m[0], m[1], 4, { speed: [30, 90], g: 60 });
      F.particles.droplets(f.x, f.y, 2, { spread: Math.PI, speed: [20, 60], g: 40 });
      const [sx, sy] = F.toScreen(f.x, f.y);
      F.fx.shockwave(F.input.x, F.input.y, 10, '#ffe27a', { life: 0.25 });
      F.fx.text?.(sx + rng.float(-30, 30), sy - 30, `${this.combo}`, { color: '#ffe27a', vy: -40, life: 0.5, layer: 'fg' });
      F.sfx('mash_pop', { pitch: 0.8 + Math.min(1, this.combo * 0.04) });
      F.setPose('yank', 0.12);
    }
    this.thrashAt(dt, this.home.x, this.home.y, 2.5, 10);
    f.feel(this.meter > 0.6 ? 'scared' : 'angry', 0.2);
    this.tension = 0.45 + 0.25 * Math.sin(this.t * 20);
    if (this.meter >= 1) return 'win';
    if (this.t > this.dur) return this.meter > 0.55 ? 'win' : 'fail';
    return 'ok';
  }

  drawHud(ctx) {
    const F = this.F, f = this.fish;
    const [sx, sy] = F.toScreen(f.x, f.y);
    const R = F.zoneRadius() * 0.8;
    // segmented power ring around the fish
    const n = 32;
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (i / n) * TAU;
      const on = i / n < this.meter;
      ctx.fillStyle = on ? (this.meter > 0.75 ? '#9affb8' : '#ffe27a') : rgba('#0b1622', 0.6);
      ctx.fillRect(Math.round(sx + Math.cos(a) * R) - 1, Math.round(sy + Math.sin(a) * R) - 1, 3, 3);
    }
    const pulse = 1 + (Math.sin(this.t * 22) > 0 ? 1 : 0);
    drawText(ctx, '{mouse_l}', sx - 6 * pulse, sy + R + 6, { scale: pulse + 1 });
    const left = Math.max(0, this.dur - this.t);
    drawText(ctx, left.toFixed(1) + 's', sx, sy - R - 14, { align: 'center', color: '#ffffff', outline: '#0b1622' });
  }
}

// ---------------------------------------------------------------- timing: click on the beat
class TimingEvent extends Event {
  constructor(F, B) {
    super(F, B, 'timing');
    this.title = 'RHYTHM!'; this.sub = 'Click when the rings meet'; this.color = '#9ad8ff';
    this.need = 3 + Math.round(this.power * 2);
    this.hits = 0; this.misses = 0;
    this.allowed = F.stats.timingMisses;
    this.beat = 1.15 - this.power * 0.45;
    this.t = -0.5;
    this.target = 26;
    this.flash = null;
    this.prompt = '{mouse_l} Click when the rings meet!';
    this.winText = 'IN RHYTHM!';
  }

  ring() { return lerp(80, 0, this.t / this.beat); }

  update(dt) {
    const F = this.F, f = this.fish;
    this.t += dt;
    if (this.flash) { this.flash.t += dt; if (this.flash.t > 0.45) this.flash = null; }
    this.thrashAt(dt, this.home.x + Math.sin(this.t * 3) * 6, this.home.y + Math.cos(this.t * 2.3) * 3, 1, 6);
    this.tension = 0.4;
    const r = this.ring();
    const win = 7 * F.stats.timingWindow;
    if (F.input.pressed) {
      const err = Math.abs(r - this.target);
      if (this.t > 0 && err < win) {
        const perfect = err < win * 0.4;
        this.hits++;
        this.meter = this.hits / this.need;
        this.flash = { text: perfect ? 'PERFECT!' : 'GOOD!', color: perfect ? '#ffe27a' : '#9affb8', t: 0 };
        F.sfx(perfect ? 'timing_perfect' : 'timing_good');
        f.squashV += 10;
        f.feel('scared', 0.5);
        this.home.y -= 3;
        this.B.progress += 0.02;
        F.particles.stars(f.x, f.y, perfect ? 10 : 6, { speed: [30, 80] });
        F.particles.shockwave(f.x, f.y, 22, perfect ? '#ffe27a' : '#9affb8');
        F.setPose('yank', 0.15);
        this.t = -0.25;
      } else this.miss();
    } else if (this.t > 0 && r < this.target - win) this.miss();
    if (this.hits >= this.need) return 'win';
    if (this.misses > this.allowed) return 'fail';
    return 'ok';
  }

  miss() {
    this.misses++;
    this.flash = { text: 'MISS', color: '#ff8a7a', t: 0 };
    this.F.sfx('timing_miss');
    this.fish.feel('smug', 0.6);
    this.B.kick(0.1);
    this.t = -0.35;
  }

  drawHud(ctx) {
    const F = this.F, f = this.fish;
    const [sx, sy] = F.toScreen(f.x, f.y);
    drawCircle(ctx, sx, sy, this.target, '#ffffff', 0.95, 2);
    drawCircle(ctx, sx, sy, this.target - 3, '#ffffff', 0.25, 1);
    if (this.t > 0) {
      const r = Math.max(1, Math.round(this.ring()));
      const close = Math.abs(r - this.target) < 7 * F.stats.timingWindow;
      drawCircle(ctx, sx, sy, r, close ? '#9affb8' : '#ffe27a', 0.95, 2);
    }
    const y = Math.round(sy - this.target - 22);
    for (let i = 0; i < this.need; i++) {
      ctx.fillStyle = '#0b1622'; ctx.fillRect(Math.round(sx - this.need * 6 + i * 12) - 1, y - 1, 10, 6);
      ctx.fillStyle = i < this.hits ? '#ffe27a' : '#2a3a4a'; ctx.fillRect(Math.round(sx - this.need * 6 + i * 12), y, 8, 4);
    }
    let hearts = '';
    for (let i = 0; i <= this.allowed; i++) hearts += i < this.allowed + 1 - this.misses ? '{heart}' : '{heart_empty}';
    drawText(ctx, hearts, sx, y - 14, { align: 'center' });
    if (this.flash) drawText(ctx, this.flash.text, sx, sy + this.target + 10 - this.flash.t * 16, { align: 'center', color: this.flash.color, outline: '#0b1622', scale: 2 });
  }
}

// ---------------------------------------------------------------- trace: stay on the fish
const PATHS = {
  figure8: (t) => [Math.sin(t), Math.sin(t * 2) * 0.5],
  circle: (t) => [Math.cos(t), Math.sin(t) * 0.7],
  wave: (t) => [Math.sin(t * 0.45) * 1.2, Math.sin(t * 2.2) * 0.4],
  spiral: (t) => { const r = 0.4 + 0.6 * Math.abs(Math.sin(t * 0.25)); return [Math.cos(t) * r, Math.sin(t) * r * 0.8]; },
  clover: (t) => { const r = Math.cos(2 * t); return [Math.cos(t) * r, Math.sin(t) * r]; },
};

class TraceEvent extends Event {
  constructor(F, B) {
    super(F, B, 'trace');
    this.title = 'FOLLOW IT!'; this.sub = 'Keep your cursor on the fish'; this.color = '#7dff9a';
    this.kind = rng.pick(Object.keys(PATHS));
    this.rx = rng.float(55, 80); this.ry = rng.float(30, 46);
    const f = this.fish, w = F.world;
    const [top, bot] = B.bounds(f.x);
    this.cx = clamp(f.x, this.rx + 20, w.W - this.rx - 20);
    this.cy = clamp(f.y, top + this.ry + 6, Math.max(top + this.ry + 6, bot - this.ry - 6));
    this.pt = 0;
    this.speed = 0.9 + this.power * 0.8;
    this.outT = 0;
    this.radius = (15 - this.power * 4) * F.stats.traceRadius;
    this.inside = false;
    this.focus = { x: this.cx, y: this.cy, zoom: 1.7 };
    this.prompt = 'Keep your cursor on the fish!';
    this.winText = 'GOT ITS RHYTHM!';
  }

  pos(t) {
    const [u, v] = PATHS[this.kind](t);
    return [this.cx + u * this.rx, this.cy + v * this.ry];
  }

  hint() { return this.F.toScreen(this.fish.x, this.fish.y); }

  update(dt) {
    const F = this.F, f = this.fish;
    this.t += dt;
    const ease = Math.min(1, this.t * 0.6 + 0.2);
    this.pt += dt * this.speed * ease;
    const [tx, ty] = this.pos(this.pt);
    f.vx = (tx - f.x) * 6; f.vy = (ty - f.y) * 6;
    f.x = damp(f.x, tx, 12, dt); f.y = damp(f.y, ty, 12, dt);
    const [pwx, pwy] = F.pointerWorld();
    this.inside = dist(pwx, pwy, f.x, f.y) < this.radius;
    if (this.inside) {
      this.meter += dt / (2.4 + this.power * 2.2);
      this.tension = 0.4;
      f.feel('tired', 0.2);
      if (rng.chance(dt * 8)) F.particles.sparkle(f.x + rng.float(-6, 6), f.y + rng.float(-4, 4), '#9affb8');
    } else {
      this.meter = Math.max(0, this.meter - dt * 0.1);
      this.outT += dt;
      this.tension = Math.min(0.9, 0.5 + this.outT * 0.12);
      f.feel('smug', 0.2);
    }
    if (this.outT > 3 * F.stats.traceForgive) return 'fail';
    if (this.meter >= 1) return 'win';
    return 'ok';
  }

  drawWorld(ctx) {
    const f = this.fish;
    for (let i = 2; i <= 26; i += 2) {
      const [x, y] = this.pos(this.pt + i * 0.07 * this.speed);
      ctx.fillStyle = rgba('#e8fcff', 0.75 - i * 0.025);
      ctx.fillRect(Math.round(x), Math.round(y), 1, 1);
    }
    const r = Math.round(this.radius + Math.sin(this.t * 8) * 1);
    drawCircle(ctx, f.x, f.y, r, this.inside ? '#7dff9a' : '#ff7a7a', 0.9);
  }

  drawHud(ctx) {
    const F = this.F;
    const [sx, sy] = F.toScreen(this.fish.x, this.fish.y);
    const w = 48, x = Math.round(sx - w / 2), y = Math.round(sy + this.radius * F.zoom() + 10);
    ctx.fillStyle = '#0b1622'; ctx.fillRect(x - 1, y - 1, w + 2, 5);
    ctx.fillStyle = this.inside ? '#7dff9a' : '#ff8a7a'; ctx.fillRect(x, y, Math.round(w * clamp01(this.meter)), 3);
  }
}

// ---------------------------------------------------------------- dodge: crank while it shoots
class DodgeEvent extends Event {
  constructor(F, B) {
    super(F, B, 'dodge');
    this.title = 'DODGE!'; this.sub = 'Keep reeling - avoid the shots'; this.color = '#ff9a8a';
    this.dur = 4 + this.power * 2;
    this.shots = [];
    this.fireT = 0.7;
    this.hits = 0;
    this.allowed = F.stats.dodgeHits;
    this.usesCrank = true;
    this.kind = F.sp.fight?.projectile || (F.sp.biome === 'junkyard' ? 'bolt' : F.sp.biome === 'abyss' ? 'ink' : 'bubble');
    this.prompt = 'Keep circling - DODGE the shots!';
    this.winText = 'UNTOUCHABLE!';
  }

  update(dt) {
    const F = this.F, f = this.fish;
    this.t += dt;
    this.meter = this.t / this.dur;
    this.thrashAt(dt, this.home.x + Math.sin(this.t * 1.3) * 18, this.home.y + Math.sin(this.t * 2.1) * 8, 0.5, 5);
    const [pwx, pwy] = F.pointerWorld();
    f.lookAt?.(pwx, pwy);
    f.facing = pwx > f.x ? 1 : -1;
    f.feel('angry', 0.2);
    this.fireT -= dt;
    if (this.fireT <= 0) {
      this.fireT = rng.float(0.45, 0.95) * (1.2 - this.power * 0.5);
      const a = Math.atan2(pwy - f.y, pwx - f.x) + rng.float(-0.1, 0.1);
      const sp = 110 + this.power * 60;
      this.shots.push({ x: f.x, y: f.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, t: 0 });
      f.talkT = 0.2;
      F.sfx(this.kind === 'bolt' ? 'click' : 'blub', { pitch: 1.4 });
    }
    for (const s of this.shots) {
      s.t += dt;
      s.x += s.vx * dt; s.y += s.vy * dt;
      const [sx, sy] = F.toScreen(s.x, s.y);
      if (!s.dead && Math.hypot(sx - F.input.x, sy - F.input.y) < 11) {
        s.dead = true;
        this.hits++;
        this.B.kick(0.22);
        F.crank.stun = 0.5;
        if (this.kind === 'ink') F.inkSplat(2);
        F.sfx('dodge_hit');
        F.shake(3);
        F.fx.burst(sx, sy, 12, { colors: ['#ffffff', '#ff8a7a'], speed: 80, g: 0, life: 0.4 });
      }
    }
    this.shots = this.shots.filter((s) => !s.dead && s.t < 3);
    if (this.hits > this.allowed) return 'fail';
    if (this.t > this.dur) return 'win';
    return 'ok';
  }

  drawWorld(ctx) { drawShots(ctx, this.shots, this.kind); }

  drawHud(ctx) {
    const F = this.F;
    const [sx, sy] = F.toScreen(this.fish.x, this.fish.y);
    let hearts = '';
    for (let i = 0; i <= this.allowed; i++) hearts += i < this.allowed + 1 - this.hits ? '{heart}' : '{heart_empty}';
    drawText(ctx, hearts, sx, sy - F.zoneRadius() - 12, { align: 'center' });
  }
}

export function drawShots(ctx, shots, kind) {
  for (const s of shots) {
    const x = Math.round(s.x), y = Math.round(s.y);
    if (kind === 'bolt') {
      ctx.fillStyle = '#9aa4b8'; ctx.fillRect(x - 2, y - 1, 5, 3);
      ctx.fillStyle = '#e8eef8'; ctx.fillRect(x - 1, y - 1, 2, 1);
      ctx.fillStyle = '#4a5468'; ctx.fillRect(x - 2, y + 1, 5, 1);
    } else if (kind === 'ink') {
      ctx.fillStyle = '#140a1e'; ctx.fillRect(x - 3, y - 2, 6, 5); ctx.fillRect(x - 2, y - 3, 4, 7);
      ctx.fillStyle = '#3a2a5a'; ctx.fillRect(x - 1, y - 2, 2, 1);
    } else {
      ctx.fillStyle = '#cfefff'; ctx.fillRect(x - 2, y - 3, 5, 7); ctx.fillRect(x - 3, y - 2, 7, 5);
      ctx.fillStyle = '#4aa8d8'; ctx.fillRect(x - 1, y - 1, 3, 3);
      ctx.fillStyle = '#ffffff'; ctx.fillRect(x - 2, y - 2, 1, 1);
    }
  }
}

// ---------------------------------------------------------------- unwrap: crank the other way
class UnwrapEvent extends Event {
  constructor(F, B) {
    super(F, B, 'unwrap');
    this.dir = rng.sign();
    this.title = 'UNTANGLE!'; this.color = '#ffe27a';
    this.sub = `Circle ${this.dir > 0 ? 'clockwise' : 'counter-clockwise'}!`;
    this.need = 2 + this.power * 1.5;
    this.turns = 0;
    this.time = 8;
    this.coil = 0;
    this.prompt = `${this.dir > 0 ? '{crank_cw}' : '{crank_ccw}'} Circle ${this.dir > 0 ? 'CLOCKWISE' : 'COUNTER-CLOCKWISE'} to unwind!`;
    this.winText = 'UNWOUND!';
  }

  hint() {
    const [sx, sy] = this.F.toScreen(this.fish.x, this.fish.y);
    return [sx + 70, sy];
  }

  update(dt) {
    const F = this.F, f = this.fish, cr = F.crank;
    this.t += dt;
    if (cr.power > 0.08 && cr.da) {
      if (Math.sign(cr.da) === this.dir) this.turns += Math.abs(cr.da) / TAU;
      else this.turns = Math.max(0, this.turns - Math.abs(cr.da) / TAU * 0.5);
    }
    this.meter = this.turns / this.need;
    this.coil += dt * 3 * -this.dir;
    const rad = 16 * (1 - this.meter) + 8;
    f.x = this.home.x + Math.cos(this.coil) * rad;
    f.y = this.home.y + Math.sin(this.coil) * rad * 0.7;
    f.vx = -Math.sin(this.coil) * 40 * -this.dir; f.vy = Math.cos(this.coil) * 30 * -this.dir;
    f.feel(this.meter > 0.6 ? 'dizzy' : 'smug', 0.2);
    this.tension = 0.5;
    if (this.turns >= this.need) return 'win';
    if (this.t > this.time) return 'fail';
    return 'ok';
  }

  drawWorld(ctx) {
    // the tangled line coils around the fish
    const f = this.fish;
    const n = 3 - Math.floor(this.meter * 3);
    for (let k = 0; k < n; k++) {
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * TAU + this.coil * 0.5 + k;
        const r = 10 + k * 3;
        ctx.fillStyle = rgba('#e8f4ff', 0.6);
        ctx.fillRect(Math.round(f.x + Math.cos(a) * r), Math.round(f.y + Math.sin(a) * r * 0.5), 1, 1);
      }
    }
  }

  drawHud(ctx) {
    const F = this.F, cr = F.crank;
    const cx = cr.active ? cr.cx : F.input.x, cy = cr.active ? cr.cy : F.input.y;
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * TAU + this.t * 4 * this.dir;
      ctx.fillStyle = rgba('#ffe27a', 0.2 + (i / 14) * 0.8);
      ctx.fillRect(Math.round(cx + Math.cos(a) * 30) - 1, Math.round(cy + Math.sin(a) * 30) - 1, 3, 3);
    }
    drawText(ctx, `${Math.min(this.turns, this.need).toFixed(1)} / ${this.need.toFixed(1)}`, cx, cy + 38, { align: 'center', color: '#ffe27a', outline: '#0b1622' });
  }
}

// ---------------------------------------------------------------- net: draw a loop around it
class NetEvent extends Event {
  constructor(F, B) {
    super(F, B, 'net');
    this.title = 'NET IT!'; this.sub = 'Draw a circle around the fish'; this.color = '#ffe27a';
    this.time = 7 * F.stats.netTime;
    this.path = [];
    this.drawing = false;
    this.fail = null;
    this.focus = { x: this.home.x, y: this.home.y, zoom: 1.8 };
    this.tension = 0.2;
    this.prompt = '{net} Hold & draw a circle around it!';
    this.winText = 'NETTED!';
  }

  hint() { return this.F.toScreen(this.fish.x, this.fish.y); }

  update(dt) {
    const F = this.F, f = this.fish;
    this.t += dt;
    this.meter = 1 - this.t / this.time;
    if (this.fail) { this.fail.t += dt; if (this.fail.t > 0.8) this.fail = null; }
    this.thrashAt(dt, this.home.x + Math.sin(this.t * 0.8) * 8, this.home.y + Math.sin(this.t * 1.7) * 3, 0.3, 3);
    f.feel('dizzy', 0.2);
    const [px, py] = F.pointerWorld();
    if (F.input.pressed) { this.drawing = true; this.path = [[px, py]]; }
    if (this.drawing) {
      const last = this.path[this.path.length - 1];
      if (dist(last[0], last[1], px, py) > 1.5) this.path.push([px, py]);
      const closed = this.path.length > 12 && dist(this.path[0][0], this.path[0][1], px, py) < 8 * F.stats.netTolerance;
      if (F.input.released || closed) {
        this.drawing = false;
        if (this.check()) { F.sfx('net_swish'); return 'win'; }
        this.path = [];
        this.fail = { t: 0 };
        F.sfx('timing_miss');
      }
    }
    if (this.t > this.time) return 'fail';
    return 'ok';
  }

  check() {
    const F = this.F, f = this.fish;
    if (this.path.length < 8) return false;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const [x, y] of this.path) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
    const tol = F.stats.netTolerance;
    const size = Math.max(8, 12 * f.scale);
    if (maxX - minX < (size * 0.8) / tol || maxY - minY < (size * 0.5) / tol) return false;
    if (maxX - minX > 260) return false;
    const pts = [[f.x, f.y], [f.x - 3 * tol, f.y], [f.x + 3 * tol, f.y]];
    const hits = pts.filter(([x, y]) => pointInPoly(x, y, this.path)).length;
    return hits >= (tol > 1.2 ? 1 : 2);
  }

  drawWorld(ctx) {
    const f = this.fish;
    const r = Math.round(14 * f.scale + 5 + Math.sin(this.t * 5) * 1.5);
    drawCircle(ctx, f.x, f.y, r, '#ffffff', 0.7, 1, 12, this.t);
    for (let i = 1; i < this.path.length; i++) {
      const [x0, y0] = this.path[i - 1], [x1, y1] = this.path[i];
      const steps = Math.max(1, Math.ceil(dist(x0, y0, x1, y1)));
      for (let k = 0; k < steps; k++) {
        const x = Math.round(lerp(x0, x1, k / steps)), y = Math.round(lerp(y0, y1, k / steps));
        ctx.fillStyle = (x + y) % 4 < 2 ? '#e8d2a0' : '#9a7a4a';
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }

  drawHud(ctx) {
    const F = this.F;
    if (this.fail) {
      const [sx, sy] = F.toScreen(this.fish.x, this.fish.y);
      drawText(ctx, 'Missed! Circle the WHOLE fish!', sx, sy + F.zoneRadius() + 4, { align: 'center', color: '#ff8a7a', outline: '#0b1622' });
    }
  }
}

const EVENTS = { mash: MashEvent, timing: TimingEvent, trace: TraceEvent, dodge: DodgeEvent, unwrap: UnwrapEvent, net: NetEvent };

export function makeEvent(name, F, B) {
  const C = EVENTS[name];
  return C ? new C(F, B) : null;
}

export const EVENT_NAMES = Object.keys(EVENTS);
