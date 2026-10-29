// The fight backbone. Circle the mouse to crank the reel (progress), keep your circling on the side
// OPPOSITE to the fish's pull to counter it (stamina drain, no line lost), hold the button to yank.
// Cranking into an uncountered surge (or yanking with it) builds tension; stopping releases it.
// Species tricks become dramatic moments and species phases become short special events.
//
// update(dt) -> 'ok' | 'land' | 'snap' | 'throw' | 'run' | 'escape'

import { TAU, clamp, clamp01, lerp, dist, damp } from '../core/math.js';
import { rng } from '../core/rng.js';
import { makeEvent } from './minigames.js';

export const TRICK_TITLES = {
  dash: 'DASH!', fake: 'FAKE-OUT!', dive: 'DIVE!', jump: 'JUMP!', wrap: 'TANGLED!', hop: 'WINDOW HOP!',
  glitch: 'GLITCH!', spit: 'SPIT ATTACK!', ink: 'INK CLOUD!',
};

const angleOf = (x, y) => Math.atan2(y, x);

export class Battle {
  constructor(F) {
    const f = F.fish, sp = F.sp, g = F.game;
    this.F = F; this.fish = f; this.sp = sp;
    this.gentle = !!g.tutorialActive;
    const fight = sp.fight || {};
    this.power = clamp01((fight.power ?? 0.4) * (this.gentle ? 0.25 : 1) * (f.rec?.giant ? 1.25 : 1));
    this.stamSecs = (fight.stamina ?? 5) * (0.8 + this.power * 0.4) * (this.gentle ? 0.45 : 1);
    this.start = { x: f.x, y: f.y };
    this.land = F.landingPoint(f);
    const depth = dist(this.start.x, this.start.y, this.land.x, this.land.y);
    this.depth = depth;
    this.lineLen = Math.round((3 + depth / 18 + this.power * 9) * 10) / 10;
    this.reelSecs = (4 + this.power * 9 + Math.min(3, depth / 160)) * (this.gentle ? 0.75 : 1);
    this.progress = 0; this.ghost = 0;
    this.stamina = 1;
    this.tension = 0.22;
    this.offX = 0; this.offY = 0;
    this.mode = 'hookset'; this.modeT = 0.95; this.t = 0;
    this.away = angleOf(this.start.x - this.land.x, this.start.y - this.land.y);
    this.pullDir = this.away;
    this.teleDir = this.away;
    this.pending = null; // trick queued for the next surge
    this.trick = null; // active complex trick
    this.counter = 0; this.align = 0; this.inZone = false; this.zoneD = 0;
    this.snapT = 0; this.slackT = 0;
    this.hudIn = 0;
    this.combo = 0;
    this.exhausted = false; this.idleT = 0;
    this.surgeMul = 1;
    this.glitchT = 0;
    this.lastCounter = false;
    this.warnRun = false; this.warnSlack = false;
    const phases = (fight.phases || []).filter((p) => p !== 'tension');
    this.finalNet = !this.gentle && phases.includes('net');
    const evs = this.gentle ? [] : phases.filter((p) => p !== 'net');
    const n = evs.length;
    this.events = evs.map((name, i) => ({ name, at: n === 1 ? 0.5 : 0.28 + (i * 0.52) / (n - 1), done: false }));
    this.event = null;
    this.eventCool = 0;
    this.phases = this.events.map((e) => e.name).concat(this.finalNet ? ['net'] : []);
    this.pi = 0;
  }

  // Compatibility with older test drivers: fight.phase.startTrick(kind), fight.phaseName.
  get phase() { return this; }
  get phaseName() { return this.event ? this.event.name : 'tension'; }

  get surging() { return this.mode === 'surge' || !!this.trick?.pulls; }
  get grace() { return this.F.stats.snapGrace * (this.gentle ? 3 : 1) + 0.15; }

  anchor() {
    const p = this.progress;
    return [lerp(this.start.x, this.land.x, p), lerp(this.start.y, this.land.y, p)];
  }

  bounds(x) {
    const F = this.F, w = F.world, f = this.fish;
    const top = w.surfaceY !== null && w.surfaceY !== undefined ? w.surfaceY + 8 + 4 * f.scale : F.viewTop() + 24;
    const bottom = (w.floorAt ? w.floorAt(x) : F.viewTop() + F.H) - 8 - 3 * f.scale;
    return [top, Math.max(top + 4, bottom)];
  }

  place(x, y, free = false) {
    const f = this.fish, W = this.F.world.W;
    x = clamp(x, 16, W - 16);
    if (!free) { const [t, b] = this.bounds(x); y = clamp(y, t, b); }
    f.x = x; f.y = y;
    const [ax, ay] = this.anchor();
    this.offX = x - ax; this.offY = y - ay;
  }

  kick(n) { this.tension = clamp(this.tension + n, 0, 1.25); }

  // ------------------------------------------------------------------ main update
  update(dt) {
    const F = this.F, f = this.fish, inp = F.input, cr = F.crank;
    this.t += dt;
    this.hudIn = Math.min(1, this.hudIn + F.rdt * 3);
    this.eventCool = Math.max(0, this.eventCool - dt);
    this.glitchT = Math.max(0, this.glitchT - dt);
    f.z = damp(f.z, 0, 4, dt);
    f.controlled = true; f.allowTurn = true;
    if (this.ghost > this.progress) this.ghost = Math.max(this.progress, this.ghost - dt * 0.25);
    else this.ghost = this.progress;

    // ---- special event in progress
    if (this.event) {
      const ev = this.event;
      const r = ev.update(dt);
      this.updateCounter(dt);
      if (ev.usesCrank) this.physics(dt, { reelMul: 0.6, stamMul: 0.5 });
      else this.tension = damp(this.tension, ev.tension ?? 0.35, 4, dt);
      const res = r !== 'ok' ? this.endEvent(r) : 'ok';
      if (res !== 'ok') return res;
      return this.checks(dt, true);
    }

    // ---- next species event?
    if (!this.trick && this.mode !== 'hookset' && this.eventCool <= 0) {
      const next = this.events.find((e) => !e.done && this.progress >= e.at);
      if (next) { next.done = true; if (this.startEvent(next.name)) return 'ok'; }
    }

    // ---- behaviour modes
    this.modeT -= this.mode === 'hookset' ? F.rdt : dt;
    if (this.trick) {
      const done = this.updateTrick(dt);
      if (done) { this.trick = null; this.toRest(); }
    } else {
      switch (this.mode) {
        case 'hookset':
          this.thrash(dt, 3);
          if (this.modeT <= 0) this.toRest();
          break;
        case 'rest':
          this.drift(dt);
          if (this.modeT <= 0 && !this.exhausted) this.toTele();
          break;
        case 'tele':
          this.brace(dt);
          if (this.modeT <= 0) this.toSurge();
          break;
        case 'surge':
          this.swimSurge(dt);
          if (this.modeT <= 0) this.toRest();
          break;
        default: this.toRest();
      }
    }
    this.updateCounter(dt);
    if (!this.trick?.frozen) this.physics(dt);
    else this.airPhysics(dt);
    return this.checks(dt, false);
  }

  checks(dt, inEvent) {
    const F = this.F, st = F.stats;
    // snap
    if (this.tension >= 1) this.snapT += dt; else this.snapT = Math.max(0, this.snapT - dt * 1.5);
    if (this.snapT > this.grace) return 'snap';
    if (inEvent) return 'ok';
    // slack: doing nothing while the fish rests lets it spit the hook
    const idle = F.crank.power < 0.1 && !F.input.down;
    if (!this.gentle && this.mode === 'rest' && !this.trick && idle && !this.exhausted) this.slackT += dt;
    else this.slackT = Math.max(0, this.slackT - dt * 2);
    const slackMax = st.slackGrace * 1.6;
    if (this.slackT > slackMax * 0.5 && !this.warnSlack) { this.warnSlack = true; F.sfx('slack_warn'); }
    if (this.slackT < 0.1) this.warnSlack = false;
    if (this.slackT > slackMax) return 'throw';
    // line running out
    if (!this.gentle && this.progress < -0.12 && !this.warnRun) { this.warnRun = true; F.sfx('slack_warn', { pitch: 1.3 }); F.titles.pop('LINE RUNNING OUT!', F.W / 2, F.H * 0.36, '#ff8a6a', { scale: 2 }); }
    if (this.progress > 0) this.warnRun = false;
    if (!this.gentle && this.progress < -0.24) return 'run';
    if (this.gentle) this.progress = Math.max(this.progress, -0.05);
    // exhausted fish recover if ignored
    if (this.exhausted) {
      this.idleT = idle ? this.idleT + dt : 0;
      if (this.idleT > 3.5) {
        this.exhausted = false; this.stamina = 0.35; this.idleT = 0;
        F.titles.pop('It recovered!', F.W / 2, F.H * 0.36, '#ffd2a0', { scale: 2 });
        this.fish.feel('angry', 1.5);
      }
    }
    // landed?
    if (this.progress >= 1) {
      this.progress = 1;
      if (this.finalNet && !this.event) { if (this.startEvent('net')) return 'ok'; }
      return 'land';
    }
    return 'ok';
  }

  // ------------------------------------------------------------------ reel physics
  physics(dt, opts = {}) {
    const F = this.F, st = F.stats, cr = F.crank, f = this.fish;
    const crankP = cr.power;
    const hold = F.input.down && !this.event;
    const surging = this.surging;
    const fishPull = surging ? (0.42 + this.power * 0.58) * (0.35 + 0.65 * this.stamina) * this.surgeMul : 0.06;
    const counter = this.counter;
    // progress
    const reelStat = 0.6 + 0.4 * (st.reelSpeed / 34);
    let reel = (crankP * reelStat) / this.reelSecs;
    // holding the button pumps the rod: a slow reel without cranking (the crank is much faster)
    if (hold && crankP < 0.3) reel = Math.max(reel, ((this.gentle ? 0.35 : 0.22) * reelStat) / this.reelSecs);
    if (surging) reel *= 0.25 + 0.75 * counter;
    if (hold) reel *= 1.3;
    if (this.tension > 0.95) reel *= 0.35;
    if (this.exhausted) reel *= 1.6;
    if (this.mode === 'hookset') reel *= 0.35;
    if (this.trick?.noReel) reel = 0;
    reel *= opts.reelMul ?? 1;
    const payout = surging ? fishPull * 0.085 * (1 - counter * 0.9) * (crankP > 0.15 ? 0.7 : 1) : 0;
    this.progress += (reel - payout) * dt;
    this.reelRate = reel - payout;
    // tension
    let T = 0.1 + crankP * (surging ? 0.75 * (1 - counter * 0.7) : 0.16);
    if (hold) T += 0.16 + (surging ? 0.3 * (1 - counter) : 0.04);
    T += fishPull * 0.45 * (1 - counter * 0.6);
    if (this.trick?.extraT) T += this.trick.extraT;
    T *= 0.85 + this.power * 0.3;
    T /= st.lineStrength * (this.gentle ? 1.6 : 1);
    if (this.exhausted) T *= 0.7;
    this.Ttarget = T;
    this.tension = clamp(damp(this.tension, T, T > this.tension ? 2.6 : 4, dt), 0, 1.25);
    // stamina
    let drain = surging ? counter * (0.5 + 0.7 * crankP) + (hold ? counter * 0.6 : 0) : crankP * 0.22 + (hold ? 0.06 : 0);
    drain *= (st.staminaDrain / this.stamSecs) * (opts.stamMul ?? 1);
    if (this.mode === 'hookset') drain *= 0.3;
    this.stamina = clamp01(this.stamina - drain * dt + (drain === 0 && !this.exhausted ? 0.02 * dt : 0));
    if (this.stamina <= 0.001 && !this.exhausted) this.exhaust();
    // juice: counter-pull feedback
    const countering = surging && this.inZone && (crankP > 0.2 || hold);
    if (countering && !this.lastCounter) {
      this.combo++;
      const [sx, sy] = F.toScreen(f.x, f.y);
      F.titles.pop(this.combo > 2 ? `COUNTER x${this.combo}!` : 'COUNTER!', sx, sy - 34, '#9affb8');
      F.sfx('timing_good', { vol: 0.5, pitch: 1 + Math.min(0.5, this.combo * 0.05) });
      F.particles.stars(f.x, f.y, 5, { speed: [20, 50], g: 0 });
    }
    this.lastCounter = countering;
    if (countering && rng.chance(dt * (2 + crankP * 4))) {
      F.particles.scales(f.x, f.y, 1, F.scaleColors());
      if (this.stamina < 0.35 && rng.chance(0.3)) f.say('sweat', 0.8);
    }
    // yank on press
    if (F.input.pressed && !this.event && this.mode !== 'hookset') this.yank();
  }

  // Air time during a jump: any reel or yank strains the line.
  airPhysics(dt) {
    const F = this.F, cr = F.crank;
    const T = (0.05 + cr.power * 0.65 + (F.input.down ? 0.4 : 0)) / (F.stats.lineStrength * (this.gentle ? 1.6 : 1));
    this.tension = clamp(damp(this.tension, T, 4, dt), 0, 1.25);
  }

  yank() {
    const F = this.F, f = this.fish;
    F.setPose('yank', 0.25);
    if (this.surging) {
      if (this.inZone) {
        this.stamina = Math.max(0, this.stamina - 0.06 * F.stats.staminaDrain);
        this.progress += 0.015;
        f.squashV += 9; f.wiggle = 0.5;
        F.particles.scales(f.x, f.y, 3, F.scaleColors());
        F.particles.shockwave(f.x, f.y, 16, '#ffffff', { life: 0.3 });
        const [sx, sy] = F.toScreen(f.x, f.y);
        F.titles.pop('YANK!', sx, sy - 46, '#ffe27a', { scale: 2 });
        F.sfx('mash_pop', { pitch: 0.8 });
        F.shake(2);
      } else {
        this.kick(0.12);
        F.sfx('slack_warn', { vol: 0.4, pitch: 1.4 });
      }
    } else {
      this.progress += 0.008;
      f.squashV += 5;
      F.sfx('reel_tick', { vol: 0.5 });
    }
  }

  exhaust() {
    const F = this.F, f = this.fish;
    this.exhausted = true;
    this.mode = 'rest'; this.modeT = 99;
    this.trick = null;
    f.feel('dizzy', 3);
    f.say('sweat', 1.2);
    F.titles.banner('EXHAUSTED!', '#ffe27a', 'Reel it in!');
    F.sfx('timing_perfect');
    F.particles.stars(f.x, f.y - 6, 10, { speed: [20, 60], g: 0 });
  }

  // Counter alignment: where is the player's crank loop relative to the fish and its pull?
  updateCounter(dt) {
    const F = this.F, f = this.fish, cr = F.crank;
    const [fsx, fsy] = F.toScreen(f.x, f.y);
    const px = cr.active ? cr.cx : F.input.x, py = cr.active ? cr.cy : F.input.y;
    const vx = px - fsx, vy = py - fsy, d = Math.hypot(vx, vy);
    this.zoneD = d;
    const za = this.pullDir + Math.PI;
    const align = d > 18 ? Math.cos(angleOf(vx, vy) - za) : 0;
    this.align = align;
    const pulling = this.surging || this.mode === 'tele';
    const target = pulling ? clamp01((align - 0.2) / 0.6) : 0;
    this.counter = damp(this.counter, this.mode === 'tele' ? 0 : target, 9, dt);
    this.inZone = pulling && align > 0.5 && d > 18;
  }

  // ------------------------------------------------------------------ fish behaviour
  toRest() {
    const p = this.power;
    this.mode = 'rest';
    this.surgeMul = 1;
    this.modeT = this.exhausted ? 99 : rng.float(0.9, 1.8) * (1.25 - p * 0.5) * (this.gentle ? 1.4 : 1);
    this.fish.feel(this.stamina < 0.45 ? 'tired' : 'determined', 1);
  }

  toTele() {
    const F = this.F, f = this.fish, p = this.power;
    this.mode = 'tele';
    this.modeT = this.gentle ? 0.95 : 0.5 - p * 0.12;
    // pull roughly away from the boat, sometimes sideways
    this.teleDir = this.away + rng.float(-1.35, 1.35);
    this.pullDir = this.teleDir;
    this.pending = null;
    const tricks = this.sp.fight?.tricks || [];
    if (!this.gentle && tricks.length && rng.chance(0.3 + p * 0.35)) {
      let kind = rng.pick(tricks);
      if (kind === 'jump' && !this.canJump()) kind = 'dash';
      this.pending = kind;
      if (kind === 'dash') this.modeT *= 0.7;
      if (kind === 'dive') { this.teleDir = Math.PI / 2 + rng.float(-0.25, 0.25); this.pullDir = this.teleDir; }
    }
    f.say(this.pending === 'fake' || this.pending === 'dash' ? '!!' : '!', this.modeT + 0.2);
    f.feel('angry', 1);
    f.squashV -= 8;
    f.wiggle = 0.6;
    F.sfx('grunt', { vol: 0.35, pitch: 1.2 + rng.float(-0.1, 0.1) });
  }

  toSurge() {
    const F = this.F, f = this.fish, p = this.power;
    this.mode = 'surge';
    this.surgeMul = 1;
    this.modeT = rng.float(1.0, 2.1) * (0.7 + p * 0.6) * (0.5 + 0.5 * this.stamina) * (this.gentle ? 0.8 : 1);
    this.combo = this.lastCounter ? this.combo : 0;
    const kind = this.pending;
    this.pending = null;
    if (kind) this.startTrick(kind);
    if (this.mode === 'surge') {
      f.feel('determined', this.modeT);
      F.particles.bubbleTrail(f.x, f.y, Math.cos(this.pullDir) * 80, Math.sin(this.pullDir) * 80, { n: 4 });
      F.sfx('splash_small', { vol: 0.35, pitch: 1.3 });
    }
  }

  thrash(dt, amp) {
    const [ax, ay] = this.anchor(), f = this.fish;
    const t = this.t;
    this.offX = damp(this.offX, Math.sin(t * 23) * amp, 12, dt);
    this.offY = damp(this.offY, Math.cos(t * 19) * amp * 0.6, 12, dt);
    f.vx = Math.sin(t * 7) * 60; f.vy = 0;
    this.place(ax + this.offX, ay + this.offY);
    f.wiggle = 0.6;
    f.feel('surprised', 0.3);
  }

  drift(dt) {
    const F = this.F, f = this.fish;
    const [ax, ay] = this.anchor();
    const t = this.t;
    this.offX = damp(this.offX, Math.sin(t * 1.3) * 8, 1.4, dt);
    this.offY = damp(this.offY, Math.sin(t * 2.1) * 4, 1.4, dt);
    // face away from the boat while being dragged
    f.vx = Math.cos(this.away) * 20 + Math.sin(t * 1.3) * 6;
    f.vy = Math.sin(this.away) * 4;
    this.place(ax + this.offX, ay + this.offY);
    f.lookAt?.(this.land.x, this.land.y - 40);
    if (this.exhausted) f.feel('dizzy', 0.3);
    if (F.crank.power > 0.3 && rng.chance(dt * 3)) F.particles.bubbleTrail(f.x, f.y, -Math.cos(this.away) * 60, -Math.sin(this.away) * 60);
  }

  brace(dt) {
    const f = this.fish;
    const [ax, ay] = this.anchor();
    // coil back against the coming pull
    const k = Math.sin(this.t * 40) * 1.2;
    this.offX = damp(this.offX, this.offX - Math.cos(this.teleDir) * 2 + k, 6, dt);
    this.offY = damp(this.offY, this.offY - Math.sin(this.teleDir) * 2, 6, dt);
    f.vx = Math.cos(this.teleDir) * 30; f.vy = Math.sin(this.teleDir) * 10;
    this.place(ax + this.offX, ay + this.offY);
  }

  swimSurge(dt) {
    const F = this.F, f = this.fish;
    const [ax, ay] = this.anchor();
    const R = (44 + this.power * 40) * (this.surgeMul > 1.5 ? 1.4 : 1);
    const sp = (55 + this.power * 70) * this.surgeMul * (1 - this.counter * 0.6);
    const tx = Math.cos(this.pullDir) * R, ty = Math.sin(this.pullDir) * R;
    const dx = tx - this.offX, dy = ty - this.offY, d = Math.hypot(dx, dy) || 1;
    const step = Math.min(d, sp * dt);
    this.offX += (dx / d) * step; this.offY += (dy / d) * step;
    f.vx = Math.cos(this.pullDir) * 90; f.vy = Math.sin(this.pullDir) * 90;
    this.place(ax + this.offX, ay + this.offY);
    if (rng.chance(dt * 10)) F.particles.bubbleTrail(f.x - Math.cos(this.pullDir) * 8 * f.scale, f.y - Math.sin(this.pullDir) * 8 * f.scale, f.vx, f.vy);
    if (this.surgeMul > 1.5 && rng.chance(dt * 20)) F.particles.wake(f.x, f.y, this.pullDir, 2);
  }

  canJump() {
    const w = this.F.world;
    return w.surfaceY !== null && w.surfaceY !== undefined && this.fish.y - w.surfaceY < 280;
  }

  // ------------------------------------------------------------------ tricks
  startTrick(kind) {
    const F = this.F, f = this.fish, p = this.power;
    if (kind === 'jump' && !this.canJump()) kind = 'dash';
    if (this.trick || this.event) return;
    const [sx, sy] = F.toScreen(f.x, f.y);
    const label = TRICK_TITLES[kind];
    switch (kind) {
      case 'dash':
        this.surgeMul = 2.1;
        this.modeT = 0.55 + p * 0.3;
        this.kick(0.12);
        F.particles.speedLines(f.x, f.y, 12, { r0: 8, r1: 30, color: '#e8fbff', add: false, len: [6, 14] });
        F.cam?.punch?.(f.x, f.y, 0.06, 0.25);
        F.sfx('splash_small', { pitch: 0.8 });
        break;
      case 'fake':
        this.pullDir = this.teleDir + Math.PI + rng.float(-0.45, 0.45);
        this.surgeMul = 1.25;
        F.sfx('boing', { vol: 0.5 });
        break;
      case 'dive':
        this.surgeMul = 1.55;
        this.modeT = 1.4 + p * 0.5;
        F.particles.bubbleTrail(f.x, f.y, 0, 120, { n: 8 });
        break;
      case 'ink':
        this.surgeMul = 1.3;
        F.particles.ink(f.x, f.y, 16, { power: 1.4, scale: 1.3, color: this.sp.biome === 'junkyard' ? '#1a1410' : '#140a22' });
        F.inkSplat(4 + Math.round(p * 3));
        F.sfx('blub', { pitch: 0.6 });
        break;
      case 'glitch': {
        F.particles.burst(f.x, f.y, 18, { colors: ['#ff3a7a', '#3affd8', '#ffffff'], speed: 70, g: 0, life: 0.45, size: 2 });
        const a = rng.float(0, TAU), r = rng.float(35, 60);
        const [ax, ay] = this.anchor();
        this.place(ax + this.offX + Math.cos(a) * r, ay + this.offY + Math.sin(a) * r);
        F.particles.burst(f.x, f.y, 14, { colors: ['#ff3a7a', '#3affd8'], speed: 50, g: 0, life: 0.35, size: 2 });
        this.pullDir = this.away + rng.float(-1.6, 1.6);
        this.surgeMul = 1.3;
        this.glitchT = 0.45;
        this.kick(0.12);
        F.sfx('glitch');
        break;
      }
      case 'jump':
        this.trick = { kind, stage: 'rise', t: 0, noReel: true, sx: this.offX, sy: this.offY };
        break;
      case 'wrap':
        this.trick = { kind, t: 0, dur: 4.6, need: 1.4 + p, dir: rng.sign(), unwound: 0, cx: f.x, cy: f.y, ang: 0, noReel: true, extraT: 0.15 };
        F.sfx('reel', { pitch: 0.7 });
        break;
      case 'hop':
        this.trick = { kind, stage: 'in', t: 0, from: [f.x, f.y], noReel: false };
        F.sfx('bubble', { pitch: 0.7 });
        break;
      case 'spit':
        this.trick = { kind, t: 0, shots: [], fired: 0, n: 3 + Math.round(p * 2), fireT: 0.25, noReel: false };
        break;
      default: break;
    }
    if (label) F.titles.banner(label, kind === 'fake' ? '#ffb0ff' : '#ff9a6a');
    void sx; void sy;
    if (this.trick) this.mode = 'trick';
  }

  updateTrick(dt) {
    const tr = this.trick;
    tr.t += dt;
    switch (tr.kind) {
      case 'jump': return this.updateJump(dt, tr);
      case 'wrap': return this.updateWrap(dt, tr);
      case 'hop': return this.updateHop(dt, tr);
      case 'spit': return this.updateSpit(dt, tr);
      default: return true;
    }
  }

  updateJump(dt, tr) {
    const F = this.F, f = this.fish, w = F.world, sy = w.surfaceY;
    if (tr.stage === 'rise') {
      tr.frozen = false;
      const tx = f.x + f.facing * 30, ty = sy - 2;
      const dx = tx - f.x, dy = ty - f.y, d = Math.hypot(dx, dy) || 1;
      const sp = 300;
      f.vx = (dx / d) * sp; f.vy = (dy / d) * sp;
      this.place(f.x + (dx / d) * Math.min(d, sp * dt), f.y + (dy / d) * Math.min(d, sp * dt), true);
      if (rng.chance(dt * 25)) F.particles.bubbleTrail(f.x, f.y + 4, f.vx, f.vy);
      if (f.y <= sy + 6 || tr.t > 1.4) {
        tr.stage = 'air'; tr.frozen = true;
        const h = rng.float(45, 80) * (1 + this.power * 0.4);
        tr.vy = -Math.sqrt(2 * 420 * h);
        tr.vx = (f.facing || 1) * rng.float(40, 80);
        F.particles.eruption(f.x, sy, 0.9);
        F.sfx('jump_out');
        F.cam?.slowmo?.(0.35, 0.9);
        f.feel('happy', 1.5);
        f.say('music', 1);
      }
    } else if (tr.stage === 'air') {
      tr.vy += 420 * dt;
      f.vx = tr.vx; f.vy = tr.vy;
      this.place(f.x + tr.vx * dt, f.y + tr.vy * dt, true);
      f.forceAngle = clamp(Math.atan2(tr.vy, Math.abs(tr.vx)), -1.2, 1.2);
      if (rng.chance(dt * 40)) F.particles.droplets(f.x, f.y, 1, { dir: Math.PI / 2, spread: 0.6, speed: [10, 40], vx: tr.vx * 0.3 });
      if (rng.chance(dt * 12)) F.particles.sparkle(f.x + rng.float(-8, 8), f.y + rng.float(-6, 6), '#ffffff');
      if (f.y > sy && tr.vy > 0) {
        tr.stage = 'down'; tr.frozen = false; tr.t2 = 0;
        f.forceAngle = undefined;
        F.particles.eruption(f.x, sy, 0.7);
        F.sfx('splash_big', { vol: 0.7 });
        const [sx, ssy] = F.toScreen(f.x, sy);
        if (F.crank.power > 0.35 || F.input.down) {
          this.kick(0.5);
          F.titles.pop('LINE STRAIN!', sx, ssy - 30, '#ff8a6a', { scale: 2 });
          F.shake(5);
        } else {
          this.stamina = Math.max(0, this.stamina - 0.2);
          F.titles.pop('NICE!', sx, ssy - 30, '#9affb8', { scale: 2 });
          F.particles.stars(f.x, sy, 8, { speed: [30, 70] });
        }
      }
    } else {
      tr.t2 += dt;
      const [ax, ay] = this.anchor();
      this.place(damp(f.x, ax + tr.sx, 5, dt), damp(f.y, ay + tr.sy, 5, dt));
      if (tr.t2 > 0.45) return true;
    }
    return false;
  }

  updateWrap(dt, tr) {
    const F = this.F, f = this.fish, cr = F.crank;
    tr.ang += dt * 4 * -tr.dir;
    const r = 14 + 6 * f.scale;
    this.place(tr.cx + Math.cos(tr.ang) * r, tr.cy + Math.sin(tr.ang) * r * 0.7);
    f.vx = -Math.sin(tr.ang) * 60 * -tr.dir; f.vy = Math.cos(tr.ang) * 40 * -tr.dir;
    const da = cr.da;
    if (cr.power > 0.1 && Math.sign(da) === tr.dir) tr.unwound += Math.abs(da) / TAU;
    else if (cr.power > 0.1 && da) { this.kick(dt * 0.6); tr.wrong = 0.3; }
    tr.wrong = Math.max(0, (tr.wrong || 0) - dt);
    f.feel(tr.unwound > tr.need * 0.6 ? 'dizzy' : 'smug', 0.2);
    if (tr.unwound >= tr.need) {
      const [sx, sy] = F.toScreen(f.x, f.y);
      F.titles.pop('UNTANGLED!', sx, sy - 40, '#9affb8', { scale: 2 });
      F.particles.stars(f.x, f.y, 10, { speed: [30, 80] });
      this.stamina = Math.max(0, this.stamina - 0.1);
      F.sfx('timing_perfect');
      return true;
    }
    if (tr.t > tr.dur) {
      this.kick(0.35);
      F.titles.pop('Tangled up!', F.W / 2, F.H * 0.36, '#ff8a6a', { scale: 2 });
      return true;
    }
    return false;
  }

  updateHop(dt, tr) {
    const F = this.F, f = this.fish;
    if (tr.stage === 'in') {
      f.alpha = Math.max(0, 1 - tr.t / 0.4);
      if (rng.chance(dt * 30)) F.particles.bubbleTrail(f.x, f.y, 0, 0, { n: 2 });
      if (tr.t > 0.4) {
        F.particles.ripples(f.x, f.y, 2, 0.6, { flat: 1 });
        const [ax, ay] = this.anchor();
        this.place(ax - this.offX * 0.9 + rng.float(-20, 20), ay - this.offY * 0.6 + rng.float(-10, 10));
        F.particles.ripples(f.x, f.y, 2, 0.6, { flat: 1 });
        F.particles.bubbles(f.x, f.y, 8);
        tr.stage = 'out'; tr.t = 0;
        this.pullDir = angleOf(this.offX, this.offY) + rng.float(-0.4, 0.4);
        F.sfx('boing', { pitch: 1.3 });
      }
    } else {
      f.alpha = Math.min(1, tr.t / 0.3);
      if (tr.t > 0.3) {
        f.alpha = 1;
        this.trick = null;
        this.mode = 'surge';
        this.surgeMul = 1.4;
        this.modeT = 0.9 + this.power * 0.6;
        return false;
      }
    }
    return false;
  }

  updateSpit(dt, tr) {
    const F = this.F, f = this.fish;
    this.drift(dt * 0.5);
    const [pwx, pwy] = F.pointerWorld();
    f.lookAt?.(pwx, pwy);
    f.facing = pwx > f.x ? 1 : -1;
    tr.fireT -= dt;
    if (tr.fired < tr.n && tr.fireT <= 0) {
      tr.fireT = 0.42 - this.power * 0.1;
      tr.fired++;
      const m = f.anchors?.mouth || [f.x, f.y];
      const a = Math.atan2(pwy - m[1], pwx - m[0]) + rng.float(-0.08, 0.08);
      const sp = 120 + this.power * 60;
      tr.shots.push({ x: m[0], y: m[1], vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, t: 0 });
      f.talkT = 0.2; f.squashV -= 5;
      F.sfx('blub', { pitch: 1.5 });
    }
    for (const s of tr.shots) {
      s.t += dt;
      s.x += s.vx * dt; s.y += s.vy * dt;
      const [sx, sy] = F.toScreen(s.x, s.y);
      if (!s.dead && Math.hypot(sx - F.input.x, sy - F.input.y) < 11) {
        s.dead = true;
        this.kick(0.25);
        F.crank.stun = 0.55;
        F.fx.burst(sx, sy, 12, { colors: ['#ffffff', '#9ad8ff'], speed: 90, g: 0, life: 0.4 });
        F.titles.pop('SPLAT!', sx, sy - 18, '#ff9a8a');
        F.sfx('dodge_hit');
        F.shake(3);
      }
    }
    tr.shots = tr.shots.filter((s) => !s.dead && s.t < 2.5);
    return tr.fired >= tr.n && tr.shots.length === 0;
  }

  // ------------------------------------------------------------------ events
  startEvent(name) {
    const F = this.F;
    const ev = makeEvent(name, F, this);
    if (!ev) return false;
    this.event = ev;
    this.trick = null;
    this.mode = 'rest'; this.modeT = 1;
    this.fish.alpha = 1;
    this.fish.forceAngle = undefined;
    F.titles.banner(ev.title, ev.color || '#ffe27a', ev.sub);
    F.sfx('notify', { pitch: 1.2 });
    return true;
  }

  endEvent(r) {
    const F = this.F, f = this.fish, ev = this.event;
    this.event = null;
    this.eventCool = 1.4;
    this.place(f.x, f.y);
    const len = Math.hypot(this.offX, this.offY);
    if (len > 80) { this.offX *= 80 / len; this.offY *= 80 / len; }
    const [sx, sy] = F.toScreen(f.x, f.y);
    if (ev.name === 'net') {
      if (r === 'win') return 'land';
      this.progress = 0.8; this.ghost = 1;
      this.stamina = Math.max(this.stamina, 0.4);
      this.exhausted = false;
      F.titles.pop('It slipped out!', sx, sy - 40, '#ffd2a0', { scale: 2 });
      f.feel('smug', 1.5);
      this.toRest();
      return 'ok';
    }
    if (r === 'snap') return 'snap';
    if (r === 'win') {
      this.progress += 0.1;
      this.stamina = Math.max(0, this.stamina - 0.22);
      F.titles.pop(ev.winText || 'GREAT!', sx, sy - 44, '#9affb8', { scale: 3 });
      F.particles.stars(f.x, f.y, 14, { speed: [30, 90] });
      F.fx.confetti(sx, sy - 20, 14, { speed: [60, 160], life: 1.4 });
      F.sfx('timing_perfect');
    } else {
      this.progress -= 0.08;
      this.kick(0.25);
      F.titles.pop('MISSED!', sx, sy - 44, '#ff8a7a', { scale: 2 });
      f.feel('smug', 1.5);
      F.sfx('timing_miss');
    }
    this.toRest();
    return 'ok';
  }

  // ------------------------------------------------------------------ helpers for HUD / tests
  // Ideal screen point for the crank loop right now (used by the HUD arrow and automated tests).
  crankHint() {
    const F = this.F, f = this.fish;
    const [fsx, fsy] = F.toScreen(f.x, f.y);
    if (this.event?.hint) return this.event.hint();
    const R = Math.max(60, F.zoneRadius());
    if (this.mode === 'tele' || this.surging) {
      const a = this.pullDir + Math.PI;
      return [fsx + Math.cos(a) * R, fsy + Math.sin(a) * R];
    }
    const a = this.away + Math.PI;
    return [fsx + Math.cos(a) * R, fsy + Math.sin(a) * R];
  }
}
