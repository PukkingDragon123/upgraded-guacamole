// The fight (phase 9: simple, clear, juicy). One control plus one secondary action:
//   REEL     circle the mouse (anywhere) to reel the fish in. Reeling pulls the line tight: the big TENSION bar.
//   PULLS    the fish pulls in clear bursts: it braces ("!", yellow), then PULLS (red). Ease off (stop circling)
//            while it pulls or the tension maxes out and the line SNAPS. Let it pull and you lose a little line;
//            sit the pull out without going into the red and the fish is TIRED: reel hard for a bonus.
//   SHOCK    hold the mouse button (or Space / the right button) to charge, let go when the bolt is full: the zap
//            runs down the line and STUNS the fish (a pull in progress is cancelled, reeling is free and fast).
//            Charges and stun power come from the rod (rodStats().shock); a used charge refills over its cooldown.
// Rarity makes pulls stronger, more frequent and with a shorter warning, and the fish heavier to reel; the rod's
// control widens the safe zone, resilience keeps line when the fish pulls, strength vs the fish's weight adds strain.
// Bosses (boss.js BossFight) ride on top: health = 1 - progress, phases, special attacks and a stun window.
//
//   new HookBite(F, fish)  the bite: a single click (or a quick circle) inside the window sets the hook.
//                          update(dt) -> 'ok' | 'hooked' | 'slow'
//   new Battle(F)          update(dt) -> 'ok' | 'land' | 'snap' | 'run'; updateCharge(rdt, held)
//   fields for the HUD / tutorial / tests: progress, tension, reel, mode ('hookset'|'rest'|'warn'|'pull'|'tired'|
//   'stun'|'boss'), pull {dir, trick}, charges, shockMax, shockCd, shockCdMax, charge {k}|null, canCharge,
//   shockReady, stunned, stunT, zap, red (tension in the red), boss (BossFight | null)

import { TAU, clamp, clamp01, lerp, dist, damp } from '../core/math.js';
import { rng } from '../core/rng.js';
import { BossFight } from './boss.js';

export const DEFAULT_ROD = { lureSpeed: 1, luck: 1, control: 1, resilience: 0.1, strength: 6, shock: { power: 0.8, charges: 1, cooldown: 6 } };

// Difficulty by rarity. reel: seconds of full reeling to land; every: seconds between pulls; dur: pull length;
// warn: brace time before a pull; power: how hard it pulls; out: line lost per second while it pulls; hook: bite window.
export const DIFF = {
  common: { i: 0, reel: 5.5, every: [3.2, 4.6], dur: [0.9, 1.3], warn: 1.0, power: 0.75, out: 0.06, hook: 1.7, resist: 0 },
  uncommon: { i: 1, reel: 6.5, every: [2.8, 4.0], dur: [1.0, 1.5], warn: 0.9, power: 0.85, out: 0.07, hook: 1.5, resist: 0.1 },
  rare: { i: 2, reel: 7.5, every: [2.4, 3.5], dur: [1.1, 1.7], warn: 0.8, power: 0.95, out: 0.08, hook: 1.35, resist: 0.2 },
  epic: { i: 3, reel: 8.5, every: [2.1, 3.1], dur: [1.2, 1.9], warn: 0.72, power: 1.05, out: 0.09, hook: 1.2, resist: 0.3 },
  legendary: { i: 4, reel: 10, every: [1.8, 2.7], dur: [1.3, 2.1], warn: 0.65, power: 1.15, out: 0.1, hook: 1.1, resist: 0.4 },
};
export const diffOf = (sp) => DIFF[sp?.rarity] || DIFF.common;

export const RED = 0.82; // tension above this is the red zone
const TRICKS = { dash: 'DASH!', jump: 'JUMP!', fake: 'FAKE!', ink: 'INK!', glitch: 'GLITCH!', dive: 'DIVE!' };

// ------------------------------------------------------------------ the bite
export class HookBite {
  constructor(F, f) {
    this.F = F; this.fish = f;
    const d = diffOf(f.sp);
    this.gentle = !!F.game.tutorialActive;
    const boss = !!f.boss;
    this.window = (d.hook + (f.sp.fight?.biteWindow ?? 0.5) * 0.4) * (F.stats?.biteWindow ?? 1) * (this.gentle ? 2.6 : 1) * (boss ? 1.6 : 1);
    this.t = 0;
    this.turns0 = F.crank.turns;
    this.set = 0; this.progress = 0; this.tension = 0.2;
  }

  get timeK() { return clamp01(1 - this.t / this.window); }

  update(dt) {
    const F = this.F, inp = F.input;
    this.t += F.rdt;
    // a click, or a good quick circle, sets the hook
    const spun = Math.abs(F.crank.turns - this.turns0);
    this.set = this.progress = clamp01(spun / 0.8);
    this.tension = 0.2 + this.set * 0.5;
    if ((inp.pressed && !F.game.ui?.blocking) || spun >= 0.8) return 'hooked';
    if (this.t >= this.window) return 'slow';
    return 'ok';
  }
}

// ------------------------------------------------------------------ the fight
export class Battle {
  constructor(F) {
    const f = F.fish, sp = F.sp, g = F.game;
    this.F = F; this.fish = f; this.sp = sp;
    this.gentle = !!g.tutorialActive;
    const fight = sp.fight || {};
    const rod = F.rod || DEFAULT_ROD;
    this.rod = rod;
    this.control = clamp(rod.control ?? 1, 0.5, 3);
    this.resil = clamp(rod.resilience ?? 0.1, 0, 0.9);
    this.strength = Math.max(0.1, rod.strength ?? 6);
    const kg = Number(f.rec?.weightKg) || 1;
    this.kg = kg;
    this.heavy = this.gentle || f.boss ? 0 : clamp(kg / this.strength - 1, 0, 2);
    const sh = rod.shock || DEFAULT_ROD.shock;
    this.shockMax = Math.max(1, Math.min(6, Math.round(sh.charges ?? 1)));
    this.charges = this.shockMax;
    this.shockPower = Math.max(0.3, sh.power ?? 0.8);
    this.shockCdMax = Math.max(1.5, (sh.cooldown ?? 6) * (this.gentle ? 0.5 : 1));
    this.shockCd = 0;
    this.stunT = 0; this.stunMax = 1;
    this.zap = null;
    this.charge = null; this.prevHeld = false; this.needRelease = false;
    this.chargeDur = 0.75;
    // bosses fight by their tier (their health bar is long enough), everyone else by rarity
    const d = f.boss ? DIFF[['common', 'uncommon', 'uncommon', 'rare', 'rare', 'epic', 'epic', 'legendary'][clamp(f.boss.tier | 0, 1, 7)]] : diffOf(sp);
    this.d = d;
    this.power = clamp01((fight.power ?? 0.4) * (this.gentle ? 0.4 : 1) * (f.rec?.giant ? 1.2 : 1));
    this.pullK = (this.gentle ? 0.55 : d.power * (0.85 + this.power * 0.3)) * (1 + this.heavy * 0.2);
    this.resist = this.gentle ? 0 : clamp(d.resist + (f.rec?.giant ? 0.1 : 0), 0, 0.7);
    // reel time: rarer and stronger fish take longer, the reel speed stat and tiring perks shorten it
    const st = F.stats || {};
    this.reelSecs = (this.gentle ? 4 : d.reel * (0.85 + this.power * 0.35) * (1 + this.heavy * 0.25)) / (((st.reelSpeed ?? 34) / 34) * (st.staminaDrain ?? 1));
    this.start = { x: f.x, y: f.y };
    this.land = F.landingPoint(f);
    this.depth = dist(this.start.x, this.start.y, this.land.x, this.land.y);
    this.lineLen = Math.round((3 + this.depth / 18 + this.power * 9) * 10) / 10;
    this.away = Math.atan2(this.start.y - this.land.y, this.start.x - this.land.x);
    this.progress = 0.12; this.ghost = 0.12;
    this.tension = 0.2; this.reel = 0; this.red = false; this.redT = 0;
    this.snapT = 0;
    this.offX = 0; this.offY = 0;
    this.mode = 'hookset'; this.modeT = 0.9; this.t = 0;
    this.pull = null; this.pullRed = false; this.pulls = 0; this.combo = 0;
    this.nextPull = this.gentle ? 3.5 : rng.float(d.every[0], d.every[1]) * 0.7;
    this.hudIn = 0;
    this.trick = null; this.glitchT = 0;
    this.lean = 0;
    this.flash = null; // {kind, t} for the HUD (counter, red, zap)
    this.boss = f.boss ? new BossFight(this, f.boss) : null;
  }

  // compatibility (tutorial / tests feature-detect these)
  get phase() { return this; }
  get phaseName() { return this.mode; }
  get event() { return null; }
  get surging() { return false; }
  get stunned() { return this.stunT > 0; }
  get grace() { return (0.5 + 0.3 * this.control + (this.F.stats?.snapGrace ?? 0.35) * 0.6) * (this.gentle ? 4 : 1); }
  get canCharge() { return this.charges > 0 && !this.zap && this.mode !== 'hookset' && !this.boss?.blocksShock; }
  get shockReady() { return this.canCharge && this.stunT <= 0 && !this.charge; }
  get pulling() { return this.mode === 'pull'; }

  anchor() {
    const p = clamp01(this.progress);
    return [lerp(this.start.x, this.land.x, p), lerp(this.start.y, this.land.y, p)];
  }

  bounds(x) {
    const F = this.F, w = F.world, f = this.fish;
    const top = w.surfaceY !== null && w.surfaceY !== undefined ? w.surfaceY + 8 + 4 * f.scale : F.viewTop() + 24;
    const deep = F.game?.ocean?.floorUnder?.(x, f.y);
    const bottom = (Number.isFinite(deep) ? deep : w.floorAt ? w.floorAt(x) : F.viewTop() + F.H) - 8 - 3 * f.scale;
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
  note(kind, extra = {}) { this.flash = { kind, t: 0, ...extra }; }

  // ------------------------------------------------------------------ main update
  update(dt) {
    const F = this.F, f = this.fish, cr = F.crank;
    this.t += dt;
    this.hudIn = Math.min(1, this.hudIn + F.rdt * 3);
    if (this.flash) { this.flash.t += F.rdt; if (this.flash.t > 1.2) this.flash = null; }
    this.glitchT = Math.max(0, this.glitchT - dt);
    f.z = damp(f.z, 0, 4, dt);
    f.controlled = true; f.allowTurn = true;
    // the reel: circling power (0..1)
    const want = cr.stun > 0 ? 0 : clamp01(cr.power);
    this.reel = damp(this.reel, want, want > this.reel ? 12 : 8, dt);
    this.idleT = this.reel < 0.15 ? (this.idleT || 0) + dt : 0;
    if (this.ghost > this.progress) this.ghost = Math.max(this.progress, this.ghost - dt * 0.2); else this.ghost = this.progress;
    // shock recharge
    if (this.charges < this.shockMax) {
      this.shockCd -= dt;
      if (this.shockCd <= 0) { this.charges++; this.shockCd = this.charges < this.shockMax ? this.shockCdMax : 0; F.onShockReady?.(); }
    }
    this.updateZap();

    const bossMode = this.boss ? this.boss.update(dt) : null;
    if (bossMode === 'hold') { this.tension = damp(this.tension, 0.25, 3, dt); return 'ok'; }

    this.modeT -= dt;
    if (this.stunned) {
      this.stunT -= dt;
      this.stunMove(dt);
      if (this.stunT <= 0) { this.stunT = 0; this.toRest(); }
    } else if (!this.boss?.busy) {
      switch (this.mode) {
        case 'hookset':
          this.thrash(dt, 3);
          if (this.modeT <= 0) this.toRest();
          break;
        case 'rest': case 'tired':
          this.drift(dt);
          if (this.mode === 'tired' && this.modeT <= 0) this.mode = 'rest';
          this.nextPull -= dt;
          if (this.nextPull <= 0) this.toWarn();
          break;
        case 'warn':
          this.brace(dt);
          if (this.modeT <= 0) this.toPull();
          break;
        case 'pull':
          this.swimPull(dt);
          if (this.modeT <= 0) this.endPull();
          break;
        default: this.toRest();
      }
    }
    if (this.trick?.kind === 'jump') this.updateJump(dt);
    else this.physics(dt);
    return this.checks(dt);
  }

  physics(dt) {
    const F = this.F, st = F.stats || {};
    const reel = this.reel;
    const lineStr = (st.lineStrength ?? 1) * Math.pow(this.control, 0.4) * (this.gentle ? 1.5 : 1);
    const heavyK = 1 + this.heavy * 0.45;
    let T, gain = 0;
    const speed = 1 / this.reelSecs;
    const bossMul = this.boss ? this.boss.reelMul() : 1;
    if (this.stunned) {
      T = 0.12 + reel * 0.22;
      gain = reel * speed * 2.2;
    } else if (this.mode === 'pull') {
      const k = this.pullK * (this.pullMul || 1) * (this.boss ? this.boss.pullMul() : 1);
      if (reel > 0.2) {
        T = (0.5 + reel * 0.75 * k) * heavyK / lineStr;
        gain = reel * speed * 0.15;
      } else {
        T = (0.34 + 0.1 * k) * heavyK / lineStr;
        gain = -this.d.out * k * (1 - this.resil) * (this.gentle ? 0.3 : 1) * (this.boss ? this.boss.lineOutMul() : 1);
      }
    } else {
      T = (0.12 + reel * 0.5) * heavyK / lineStr;
      if (this.mode === 'warn') T += 0.06;
      gain = reel * speed * (this.mode === 'tired' ? 1.8 : 1) * (this.mode === 'hookset' ? 0.4 : 1);
      if (reel < 0.12 && this.mode !== 'hookset' && !this.boss?.atk) gain -= 0.012 * (1 - this.resil) * (this.gentle ? 0 : 1); // a slack line lets it creep away
    }
    if (this.boss) T += this.boss.extraTension();
    gain *= bossMul;
    this.progress += gain * dt;
    this.reelRate = gain;
    const rise = this.mode === 'pull' ? 2.6 : 2;
    this.tension = clamp(damp(this.tension, T, T > this.tension ? rise : 3.2, dt), 0, 1.25);
  }

  checks(dt) {
    const F = this.F;
    const red = this.tension >= RED;
    if (red && !this.red) F.onRed?.();
    this.red = red;
    if (red && this.mode === 'pull') this.pullRed = true;
    if (this.tension >= 0.995) this.snapT += dt; else this.snapT = Math.max(0, this.snapT - dt * 1.5);
    if (this.snapT > this.grace) return 'snap';
    if (this.gentle) this.progress = Math.max(this.progress, 0.04);
    if (this.progress <= (this.boss ? -0.06 : 0)) return 'run'; // a boss breaks free once it is back past full health
    if (this.progress >= 1) {
      this.progress = 1;
      if (this.boss && !this.boss.canFinish()) { this.progress = 0.995; return 'ok'; }
      return 'land';
    }
    return 'ok';
  }

  // ------------------------------------------------------------------ pulls
  toRest() {
    this.mode = 'rest';
    this.trick = null;
    if (this.nextPull <= 0.2) this.nextPull = this.pullGap();
    this.fish.feel(this.progress > 0.7 ? 'tired' : 'determined', 1);
  }

  pullGap() {
    const d = this.d;
    if (this.gentle) return rng.float(3.5, 4.5);
    const k = this.boss ? this.boss.paceMul() : 1;
    return rng.float(d.every[0], d.every[1]) * (1.15 - this.power * 0.3) * k;
  }

  toWarn() {
    const F = this.F, f = this.fish;
    this.mode = 'warn';
    this.modeT = (this.gentle ? 1.4 : this.d.warn * (0.85 + 0.15 * this.control)) * (this.boss ? 0.9 : 1);
    this.pull = { dir: this.away + rng.float(-1.1, 1.1), trick: null };
    const tricks = (this.sp.fight?.tricks || []).filter((k) => TRICKS[k]);
    if (!this.gentle && !this.boss && tricks.length && rng.chance(0.25 + this.power * 0.3)) {
      let k = rng.pick(tricks);
      if (k === 'jump' && !this.canJump()) k = 'dash';
      this.pull.trick = k;
      if (k === 'dive') this.pull.dir = Math.PI / 2 + rng.float(-0.25, 0.25);
    }
    f.say('!', this.modeT + 0.2);
    f.feel('angry', 1);
    f.squashV -= 8; f.wiggle = 0.6;
    F.onWarn?.(this.pull);
  }

  toPull() {
    const F = this.F, f = this.fish, d = this.d;
    const trick = this.pull?.trick;
    if (trick === 'fake') {
      // a feint: it braces... and does nothing. Smug.
      F.onTrick?.('fake', TRICKS.fake);
      f.say('music', 0.8); f.feel('smug', 1);
      this.mode = 'rest'; this.nextPull = rng.float(0.8, 1.4);
      return;
    }
    this.mode = 'pull';
    this.pullRed = false;
    this.pulls++;
    this.modeT = this.gentle ? 1 : rng.float(d.dur[0], d.dur[1]) * (0.9 + this.power * 0.25) * (trick === 'dash' ? 0.7 : 1) * (this.boss ? this.boss.durMul() : 1);
    this.pullMul = trick === 'dash' ? 1.35 : 1;
    if (trick === 'ink') F.inkSplat?.(2 + Math.round(this.power * 2));
    if (trick === 'glitch') {
      const a = rng.float(0, TAU), r = rng.float(30, 55);
      const [ax, ay] = this.anchor();
      F.particles.pixelBurst?.('zap', f.x, f.y, 6, { ramp: 'cyan' });
      this.place(ax + this.offX + Math.cos(a) * r, ay + this.offY + Math.sin(a) * r);
      this.glitchT = 0.45;
      F.sfx('glitch');
    }
    if (trick === 'jump') this.trick = { kind: 'jump', stage: 'rise', t: 0, sx: this.offX, sy: this.offY };
    if (trick) F.onTrick?.(trick, TRICKS[trick]);
    f.feel('determined', this.modeT);
    F.particles.bubbleTrail(f.x, f.y, Math.cos(this.pull.dir) * 80, Math.sin(this.pull.dir) * 80, { n: 4 });
    F.particles.wake?.(f.x, f.y, this.pull.dir, 4);
    F.onPull?.(this.pull);
  }

  endPull() {
    const F = this.F, f = this.fish;
    const good = !this.pullRed;
    if (good && !this.gentle) {
      this.combo++;
      this.mode = 'tired';
      this.modeT = 1.6 + this.control * 0.3;
      f.feel('tired', this.modeT); f.say('sweat', 1.2);
    } else {
      this.combo = 0;
      this.mode = 'rest';
    }
    this.trick = this.trick?.kind === 'jump' ? this.trick : null;
    this.nextPull = this.pullGap();
    F.onPullEnd?.(good, this.combo);
  }

  // ------------------------------------------------------------------ shock: hold to charge, release when full
  updateCharge(rdt, held) {
    const F = this.F;
    const edge = held && !this.prevHeld;
    this.prevHeld = held;
    if (!held) this.needRelease = false;
    const c = this.charge;
    if (!c) {
      if (held && !this.needRelease && this.canCharge) { this.charge = { t: 0, k: 0 }; F.onChargeStart?.(); }
      else if (edge && !this.canCharge) F.onShockFizzle?.();
      return;
    }
    if (held) {
      const was = c.k;
      c.t += rdt;
      c.k = Math.min(1, c.t / this.chargeDur);
      if (c.k >= 1 && was < 1) F.onChargeFull?.();
      return;
    }
    this.charge = null;
    if (c.k < 1) { F.onChargeCancel?.(c.k < 0.2); return; } // let go too early: nothing spent
    this.fireZap();
  }

  fireZap() {
    this.charges--;
    this.zapped = true;
    if (this.shockCd <= 0) this.shockCd = this.shockCdMax;
    const window = this.boss?.inWindow?.() || false;
    let stun = (this.shockPower + 0.7) * (1 - this.resist * 0.5);
    if (this.boss) stun = window ? 2 + this.shockPower * 0.4 : stun * 0.45;
    this.zap = { t: 0, dur: 0.2, stun, window };
    this.F.onShockFire?.(window);
  }

  // Instant shock for older drivers (fires as a full charge).
  shock() {
    if (!this.canCharge) { this.F.onShockFizzle?.(); return false; }
    this.charge = null;
    this.fireZap();
    return true;
  }

  updateZap() {
    if (!this.zap) return;
    this.zap.t += this.F.rdt;
    if (this.zap.t < this.zap.dur) return;
    const z = this.zap;
    this.zap = null;
    this.stun(z.stun, z.window);
  }

  stun(dur, crit = false) {
    const F = this.F, f = this.fish;
    const wasPull = this.mode === 'pull' || this.mode === 'warn';
    this.stunMax = this.stunT = Math.max(this.stunT, dur);
    if (this.trick && this.trick.kind !== 'jump') this.trick = null;
    this.mode = 'stun';
    this.nextPull = Math.max(this.nextPull, 1.2);
    f.feel('dizzy', this.stunT + 0.5);
    f.squashV += 14; f.wiggle = 1;
    if (crit) this.boss?.onCrit?.();
    F.onStun?.(wasPull, crit);
  }

  stunMove(dt) {
    const f = this.fish;
    const [ax, ay] = this.anchor();
    this.offX = damp(this.offX, 0, 1.5, dt);
    this.offY = damp(this.offY, 0, 1.5, dt);
    const j = Math.floor(this.t * 30) % 2 ? 1.5 : -1.5;
    this.place(ax + this.offX + j, ay + this.offY + (Math.floor(this.t * 23) % 2 ? 1 : -1) * 0.8);
    f.vx = Math.cos(this.away) * 8; f.vy = 0;
    f.wiggle = 0.9;
    f.feel('dizzy', 0.3);
  }

  // ------------------------------------------------------------------ fish motion
  thrash(dt, amp) {
    const [ax, ay] = this.anchor(), f = this.fish, t = this.t;
    this.offX = damp(this.offX, Math.sin(t * 23) * amp, 12, dt);
    this.offY = damp(this.offY, Math.cos(t * 19) * amp * 0.6, 12, dt);
    f.vx = Math.sin(t * 7) * 60; f.vy = 0;
    this.place(ax + this.offX, ay + this.offY);
    f.wiggle = 0.6;
  }

  drift(dt) {
    const F = this.F, f = this.fish;
    const [ax, ay] = this.anchor();
    const t = this.t, tired = this.mode === 'tired';
    const amp = tired ? 3 : 10;
    this.offX = damp(this.offX, Math.sin(t * 1.3) * amp, 1.4, dt);
    this.offY = damp(this.offY, Math.sin(t * 2.1) * amp * 0.45, 1.4, dt);
    f.vx = Math.cos(this.away) * (tired ? 6 : 20) + Math.sin(t * 1.3) * 6;
    f.vy = Math.sin(this.away) * 4;
    this.place(ax + this.offX, ay + this.offY);
    f.lookAt?.(this.land.x, this.land.y - 40);
    if (this.reel > 0.3 && rng.chance(dt * 3)) F.particles.bubbleTrail(f.x, f.y, -Math.cos(this.away) * 60, -Math.sin(this.away) * 60);
  }

  brace(dt) {
    const f = this.fish;
    const [ax, ay] = this.anchor();
    const dir = this.pull?.dir ?? this.away;
    const k = Math.sin(this.t * 40) * 1.4;
    this.offX = damp(this.offX, this.offX - Math.cos(dir) * 2 + k, 6, dt);
    this.offY = damp(this.offY, this.offY - Math.sin(dir) * 2, 6, dt);
    f.vx = Math.cos(dir) * 30; f.vy = Math.sin(dir) * 10;
    this.place(ax + this.offX, ay + this.offY);
    f.wiggle = 0.5;
  }

  swimPull(dt) {
    const F = this.F, f = this.fish;
    if (this.trick?.kind === 'jump') return;
    const [ax, ay] = this.anchor();
    const dir = this.pull?.dir ?? this.away;
    const R = (40 + this.power * 36) * (this.pullMul || 1) * (this.boss ? 1.4 : 1);
    const sp = (55 + this.power * 70) * (this.pullMul || 1) * (this.reel > 0.2 ? 0.6 : 1);
    const tx = Math.cos(dir) * R, ty = Math.sin(dir) * R;
    const dx = tx - this.offX, dy = ty - this.offY, d = Math.hypot(dx, dy) || 1;
    const step = Math.min(d, sp * dt);
    this.offX += (dx / d) * step; this.offY += (dy / d) * step;
    f.vx = Math.cos(dir) * 90; f.vy = Math.sin(dir) * 90;
    this.place(ax + this.offX, ay + this.offY);
    if (rng.chance(dt * 12)) F.particles.bubbleTrail(f.x - Math.cos(dir) * 8 * f.scale, f.y - Math.sin(dir) * 8 * f.scale, f.vx, f.vy);
    if (rng.chance(dt * 8)) F.particles.wake?.(f.x, f.y, dir, 2);
  }

  canJump() {
    const w = this.F.world;
    return w.surfaceY !== null && w.surfaceY !== undefined && this.fish.y - w.surfaceY < 260;
  }

  // A leap out of the water during a pull (pure spectacle: the pull rules still apply).
  updateJump(dt) {
    const F = this.F, f = this.fish, sy = F.world.surfaceY, tr = this.trick;
    tr.t += dt;
    if (tr.stage === 'rise') {
      const tx = f.x + f.facing * 30, ty = sy - 2;
      const dx = tx - f.x, dy = ty - f.y, d = Math.hypot(dx, dy) || 1, sp = 300;
      f.vx = (dx / d) * sp; f.vy = (dy / d) * sp;
      this.place(f.x + (dx / d) * Math.min(d, sp * dt), f.y + (dy / d) * Math.min(d, sp * dt), true);
      if (f.y <= sy + 6 || tr.t > 1.4) {
        tr.stage = 'air';
        const h = rng.float(45, 75) * (1 + this.power * 0.4);
        tr.vy = -Math.sqrt(2 * 420 * h);
        tr.vx = (f.facing || 1) * rng.float(40, 80);
        F.particles.eruption?.(f.x, sy, 0.9);
        F.particles.pixelSplash?.(f.x, sy, 1.2);
        F.sfx('jump_out');
        F.cam?.slowmo?.(0.4, 0.7);
        f.feel('happy', 1.5);
      }
    } else if (tr.stage === 'air') {
      tr.vy += 420 * dt;
      f.vx = tr.vx; f.vy = tr.vy;
      this.place(f.x + tr.vx * dt, f.y + tr.vy * dt, true);
      f.forceAngle = clamp(Math.atan2(tr.vy, Math.abs(tr.vx)), -1.2, 1.2);
      if (rng.chance(dt * 30)) F.particles.pixelBurst?.('drop', f.x, f.y, 1, { ramp: 'aqua', speed: [10, 40] });
      if (f.y > sy && tr.vy > 0) {
        tr.stage = 'down'; tr.t2 = 0;
        f.forceAngle = undefined;
        F.particles.eruption?.(f.x, sy, 0.7);
        F.particles.pixelSplash?.(f.x, sy, 1.4);
        F.sfx('splash_big', { vol: 0.7 });
        F.shake(4);
      }
    } else {
      tr.t2 += dt;
      const [ax, ay] = this.anchor();
      this.place(damp(f.x, ax + tr.sx, 5, dt), damp(f.y, ay + tr.sy, 5, dt));
      if (tr.t2 > 0.45) this.trick = null;
    }
    this.physics(dt);
  }

  // ------------------------------------------------------------------ helpers for tests / the HUD
  // A comfortable screen point to circle the mouse around (automated tests).
  crankHint() {
    const F = this.F;
    return [Math.round(F.W * 0.42), Math.round(F.H * 0.55)];
  }

  // dev / tests: finish the fight now
  debugWin() { this.progress = 1; if (this.boss) this.boss.debugWin(); }
}
