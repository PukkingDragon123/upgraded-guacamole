// The fight backbone (phase 6: the 3D GEAR is the reel, see gear.js).
//   Hook     HookSpin: when a fish bites, spin the gear up into the hook band (circle the mouse) and keep it
//            there until the hook is set, inside a short window. Too slow: the fish lets go. Past the RIP
//            line for too long: the hook tears out.
//   Spin     circling the mouse drives the gear (momentum, the fish drags it back); it winds line (progress).
//            Keep the RPM inside the moving SWEET BAND: faster reeling and stamina drain. Above it the line
//            strains (snap risk); far below it the fish takes line (the gear even spins backwards).
//            The band drifts on its own (faster for rarer fish) and jumps when the fish surges.
//   Surge    the fish braces (tele) then surges in a direction: the band jumps up (spin harder!) and a
//            directional QTE: HOLD the mouse button and drag AGAINST the surge (it also brakes the gear).
//            Success drains the fish and yanks it back; failure strains the line and gives up line.
//   Shock    HOLD the mouse button (outside a surge), Space or the right button to charge; RELEASE to zap down
//            the line and STUN the fish (no surges, fast reeling, wide calm band). Release inside the PERFECT
//            window for a long stun; early = weak (resistant fish shrug it off); overcharged = fizzle; held
//            too long = BACKFIRE (line strain, the gear jams, the fish gets a free surge).
//            Charges, stun power and cooldown come from rodStats().shock.
//   Heavy    fish heavier than the rod's strength put the line at risk (more tension, more drag).
// Rarer fish: faster band drift, a narrower band, stronger surges and shock resistance (DIFF); rod control
// widens the band, calms the drift and widens the PERFECT window; resilience keeps progress.
// Species tricks are short visual events and species phases are special events (minigames.js).
//
// update(dt) -> 'ok' | 'land' | 'snap' | 'throw' | 'run' | 'escape'

import { TAU, clamp, clamp01, lerp, dist, damp } from '../core/math.js';
import { rng } from '../core/rng.js';
import { makeEvent } from './minigames.js';
import { RPM_UNIT } from './gear.js';

export const TRICK_TITLES = {
  dash: 'DASH!', fake: 'FAKE!', dive: 'DIVE!', jump: 'JUMP!', wrap: 'TANGLE!', hop: 'HOP!',
  glitch: 'GLITCH!', spit: 'SPIT!', ink: 'INK!',
};

export const DEFAULT_ROD = { lureSpeed: 1, luck: 1, control: 1, resilience: 0.1, strength: 6, shock: { power: 0.8, charges: 1, cooldown: 6 } };

// Difficulty by rarity (RPM values). base/amp/drift: where the sweet band sits, how far and how fast it wanders;
// width: band half-width; shift: how far a surge kicks it; surge: drag + line stripping; resist: shock resistance;
// hook*: the spin-to-hook band centre / half-width, window (s) and the time in the band needed (s).
export const DIFF = {
  common: { i: 0, base: 96, amp: 16, drift: 0.32, width: 27, shift: 26, surge: 1, resist: 0, hookC: 98, hookW: 30, hookWin: 2.1, hookNeed: 0.35 },
  uncommon: { i: 1, base: 104, amp: 22, drift: 0.45, width: 24, shift: 32, surge: 1.12, resist: 0.12, hookC: 106, hookW: 27, hookWin: 1.95, hookNeed: 0.4 },
  rare: { i: 2, base: 112, amp: 28, drift: 0.6, width: 21, shift: 38, surge: 1.26, resist: 0.25, hookC: 115, hookW: 24, hookWin: 1.8, hookNeed: 0.45 },
  epic: { i: 3, base: 120, amp: 34, drift: 0.8, width: 18, shift: 44, surge: 1.42, resist: 0.4, hookC: 125, hookW: 21, hookWin: 1.7, hookNeed: 0.5 },
  legendary: { i: 4, base: 128, amp: 40, drift: 1.05, width: 16, shift: 50, surge: 1.6, resist: 0.55, hookC: 136, hookW: 18, hookWin: 1.6, hookNeed: 0.55 },
};
export const diffOf = (sp) => DIFF[sp?.rarity] || DIFF.common;

const angleOf = (x, y) => Math.atan2(y, x);

// ------------------------------------------------------------------ spin to hook
// Built when a fish bites (Fishing.state 'bite'); update(dt) -> 'ok' | 'hooked' | 'slow' | 'rip'.
export class HookSpin {
  constructor(F, f) {
    this.F = F; this.fish = f;
    this.gearMode = 'hook';
    const sp = f.sp, fight = sp.fight || {}, rod = F.rod || DEFAULT_ROD;
    this.gentle = !!F.game.tutorialActive;
    const d = diffOf(sp);
    this.d = d;
    const ctl = clamp(rod.control ?? 1, 0.5, 3);
    const power = clamp01(fight.power ?? 0.4);
    this.c0 = d.hookC + power * 10 + (f.rec?.giant ? 8 : 0);
    this.w = d.hookW * Math.pow(ctl, 0.6) * (this.gentle ? 1.6 : 1);
    this.ripGap = (32 + 10 * ctl) * (this.gentle ? 1.7 : 1);
    this.window = (d.hookWin + (fight.biteWindow ?? 0.6) * 0.6) * (F.stats?.biteWindow ?? 1) * (this.gentle ? 2.4 : 1);
    this.need = d.hookNeed * (this.gentle ? 0.7 : 1);
    this.t = 0; this.got = 0; this.ripT = 0; this.ripMax = 0.3;
    this.ph = rng.float(0, TAU);
    this.band = { lo: 0, hi: 0, rip: 0, c: 0 };
    this.set = 0; this.progress = 0; this.tension = 0.2; this.inBand = false;
    this.snapT = 0; this.grace = 1; this.shockMax = 0; this.charges = 0;
    this.load = 14 + power * 24;
    this.updateBand();
  }

  get timeK() { return clamp01(1 - this.t / this.window); }

  updateBand() {
    const wob = this.gentle ? 0 : Math.sin(this.t * (1.4 + this.d.i * 0.7) + this.ph) * this.d.i * 4;
    const c = this.c0 + wob, b = this.band;
    b.c = c; b.lo = c - this.w; b.hi = c + this.w; b.rip = b.hi + this.ripGap;
  }

  update(dt) {
    const G = this.F.gear, rpm = G.rpm;
    this.t += dt;
    this.updateBand();
    const b = this.band;
    const inBand = rpm >= b.lo && rpm <= b.hi;
    if (inBand) this.got += dt;
    else this.got = Math.max(0, this.got - dt * (rpm > b.hi ? 0.5 : 0.3));
    if (rpm > b.rip) this.ripT += dt; else this.ripT = Math.max(0, this.ripT - dt * 1.2);
    this.inBand = inBand;
    this.set = this.progress = clamp01(this.got / this.need);
    this.tension = clamp(0.15 + clamp01(rpm / b.rip) * 0.6 + (this.ripT / this.ripMax) * 0.45, 0, 1.2);
    // the fish tugs on the bait: the gear has to fight a jerky drag
    G.load = this.load * (0.7 + 0.6 * Math.max(0, Math.sin(this.t * 11)));
    G.brake = false;
    if (this.got >= this.need) return 'hooked';
    if (this.ripT >= this.ripMax) return 'rip';
    if (this.t >= this.window) return 'slow';
    return 'ok';
  }
}

export class Battle {
  constructor(F) {
    const f = F.fish, sp = F.sp, g = F.game;
    this.F = F; this.fish = f; this.sp = sp;
    this.gentle = !!g.tutorialActive;
    const fight = sp.fight || {};
    // rod
    const rod = F.rod || DEFAULT_ROD;
    this.rod = rod;
    this.control = clamp(rod.control ?? 1, 0.5, 3);
    this.resil = clamp(rod.resilience ?? 0.1, 0, 0.9);
    this.strength = Math.max(0.1, rod.strength ?? 6);
    const kg = Number(f.rec?.weightKg) || 1;
    this.kg = kg;
    this.heavy = this.gentle ? 0 : clamp(kg / this.strength - 1, 0, 2.5);
    const sh = rod.shock || DEFAULT_ROD.shock;
    this.shockMax = Math.max(0, Math.min(6, Math.round(sh.charges ?? 1)));
    this.charges = this.shockMax;
    this.shockPower = Math.max(0.2, sh.power ?? 0.8);
    this.shockCdMax = Math.max(0.5, sh.cooldown ?? 6);
    this.shockCd = 0;
    this.stunT = 0; this.stunMax = 1;
    this.zap = null;
    // fish
    this.power = clamp01((fight.power ?? 0.4) * (this.gentle ? 0.25 : 1) * (f.rec?.giant ? 1.25 : 1) * (1 + this.heavy * 0.15));
    // difficulty: rarity drives the band's drift, surges and shock resistance; the rod eases it
    const d = diffOf(sp), giant = f.rec?.giant ? 1 : 0, ctl = this.control;
    this.d = d;
    this.gearMode = 'fight';
    this.resist = this.gentle ? 0 : clamp(d.resist + giant * 0.1, 0, 0.8);
    this.bandBase = clamp(d.base + this.power * 14 + giant * 6, 70, 170);
    this.bandW = d.width * Math.pow(ctl, 0.7) * (this.gentle ? 1.7 : 1);
    this.bandAmp = (d.amp * (this.gentle ? 0.45 : 1)) / Math.sqrt(ctl);
    this.bandDrift = (d.drift * (this.gentle ? 0.5 : 1)) / Math.sqrt(ctl);
    this.shiftAmt = (d.shift + this.power * 16) * (this.gentle ? 0.6 : 1);
    this.bandShift = 0; this.shiftDir = 1; this.bandDir = 0; this.bandT = 0;
    this.bph = [rng.float(0, TAU), rng.float(0, TAU), rng.float(0, TAU)];
    this.band = { lo: 0, hi: 0, c: 0 };
    this.inBand = false;
    // shock charge: hold to charge, release in the PERFECT window
    this.charge = null; this.needRelease = false; this.prevHeld = false;
    this.chargeDur = 1;
    const half = clamp(0.085 * Math.sqrt(ctl) * (this.gentle ? 1.8 : 1), 0.06, 0.2);
    this.chargeWin = { lo: 0.78 - half, hi: Math.min(0.97, 0.78 + half) };
    this.overHold = 0.45;
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
    this.pending = null;
    this.trick = null;
    this.qte = null;
    this.snapT = 0; this.slackT = 0;
    this.hudIn = 0;
    this.combo = 0;
    this.exhausted = false; this.idleT = 0;
    this.surgeMul = 1;
    this.glitchT = 0;
    this.reelRate = 0;
    this.warnRun = false; this.warnSlack = false;
    this.lean = 0;
    const phases = (fight.phases || []).filter((p) => p !== 'tension');
    this.finalNet = !this.gentle && phases.includes('net');
    const evs = this.gentle ? [] : phases.filter((p) => p !== 'net');
    const n = evs.length;
    this.events = evs.map((name, i) => ({ name, at: n === 1 ? 0.5 : 0.28 + (i * 0.52) / (n - 1), done: false }));
    this.event = null;
    this.eventCool = 0;
    this.phases = this.events.map((e) => e.name).concat(this.finalNet ? ['net'] : []);
    this.pi = 0;
    this.updateBand(0);
  }

  // Compatibility with older test drivers: fight.phase.startTrick(kind), fight.phaseName.
  get phase() { return this; }
  get phaseName() { return this.event ? this.event.name : 'tension'; }

  get surging() { return this.mode === 'surge' || !!this.trick?.pulls; }
  get stunned() { return this.stunT > 0; }
  get grace() { return this.F.stats.snapGrace * this.control * (this.gentle ? 3 : 1) + 0.15; }
  // a charge can start (hold); shockReady (older drivers, the tutorial) also wants the fish not already stunned
  get canCharge() { return this.charges > 0 && this.shockCd <= 0 && !this.zap && !this.event && this.trick?.kind !== 'jump'; }
  get shockReady() { return this.canCharge && this.stunT <= 0 && !this.charge; }

  anchor() {
    const p = this.progress;
    return [lerp(this.start.x, this.land.x, p), lerp(this.start.y, this.land.y, p)];
  }

  bounds(x) {
    const F = this.F, w = F.world, f = this.fish;
    const top = w.surfaceY !== null && w.surfaceY !== undefined ? w.surfaceY + 8 + 4 * f.scale : F.viewTop() + 24;
    const deep = F.game?.ocean?.floorUnder?.(x, f.y); // [phase6:oceans] fights in the deep zones: the floor under the fish
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

  // ------------------------------------------------------------------ main update
  update(dt) {
    const F = this.F, f = this.fish;
    this.t += dt;
    this.hudIn = Math.min(1, this.hudIn + F.rdt * 3);
    this.eventCool = Math.max(0, this.eventCool - dt);
    this.glitchT = Math.max(0, this.glitchT - dt);
    this.shockCd = Math.max(0, this.shockCd - dt);
    f.z = damp(f.z, 0, 4, dt);
    f.controlled = true; f.allowTurn = true;
    if (this.ghost > this.progress) this.ghost = Math.max(this.progress, this.ghost - dt * 0.25);
    else this.ghost = this.progress;
    this.updateZap(dt);
    // camera lean toward the surge
    const leanT = this.qte?.active ? (this.mode === 'surge' ? 1 : 0.45) : 0;
    this.lean = damp(this.lean, leanT, 5, dt);

    this.updateBand(dt);
    this.driveGear();

    // ---- special event in progress
    if (this.event) {
      const ev = this.event;
      const r = ev.update(dt);
      if (ev.usesCrank) this.physics(dt, { reelMul: 0.6, stamMul: 0.5 });
      else this.tension = damp(this.tension, ev.tension ?? 0.35, 4, dt);
      const res = r !== 'ok' ? this.endEvent(r) : 'ok';
      if (res !== 'ok') return res;
      return this.checks(dt, true);
    }

    // ---- next species event?
    if (!this.trick && !this.stunned && this.mode !== 'hookset' && this.eventCool <= 0) {
      const next = this.events.find((e) => !e.done && this.progress >= e.at);
      if (next) { next.done = true; if (this.startEvent(next.name)) return 'ok'; }
    }

    // ---- behaviour modes
    this.modeT -= this.mode === 'hookset' ? F.rdt : dt;
    if (this.stunned) {
      this.stunT -= dt;
      this.stunMove(dt);
      if (this.stunT <= 0) { this.stunT = 0; this.toRest(); }
    } else if (this.trick) {
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
          if (this.modeT <= 0) this.endSurge();
          break;
        default: this.toRest();
      }
    }
    this.updateQte(dt);
    if (!this.trick?.frozen) this.physics(dt);
    else this.airPhysics(dt);
    return this.checks(dt, false);
  }

  checks(dt, inEvent) {
    const F = this.F, st = F.stats;
    if (this.tension >= 1) this.snapT += dt; else this.snapT = Math.max(0, this.snapT - dt * 1.5);
    if (this.snapT > this.grace) return 'snap';
    if (inEvent) return 'ok';
    // slack: doing nothing while the fish rests lets it spit the hook
    const idle = F.gear.rpm < 12 && !F.input.down && !this.charge;
    if (!this.gentle && this.mode === 'rest' && !this.trick && idle && !this.exhausted && !this.stunned) this.slackT += dt;
    else this.slackT = Math.max(0, this.slackT - dt * 2);
    const slackMax = st.slackGrace * 1.6;
    if (this.slackT > slackMax * 0.5 && !this.warnSlack) { this.warnSlack = true; F.sfx('slack_warn'); }
    if (this.slackT < 0.1) this.warnSlack = false;
    if (this.slackT > slackMax) return 'throw';
    // line running out
    if (!this.gentle && this.progress < -0.12 && !this.warnRun) { this.warnRun = true; F.sfx('slack_warn', { pitch: 1.3 }); F.onLineOut?.(); }
    if (this.progress > 0) this.warnRun = false;
    if (!this.gentle && this.progress < -0.24) return 'run';
    if (this.gentle) this.progress = Math.max(this.progress, -0.05);
    // exhausted fish recover if ignored
    if (this.exhausted) {
      this.idleT = idle ? this.idleT + dt : 0;
      if (this.idleT > 3.5) {
        this.exhausted = false; this.stamina = 0.35; this.idleT = 0;
        F.onRecovered?.();
        this.fish.feel('angry', 1.5);
      }
    }
    if (this.progress >= 1) {
      this.progress = 1;
      if (this.finalNet && !this.event) { if (this.startEvent('net')) return 'ok'; }
      return 'land';
    }
    return 'ok';
  }

  // ------------------------------------------------------------------ the sweet band + gear drag
  // The band (RPM) wanders on layered sines (faster for rarer fish), jumps when the fish surges (up: spin harder;
  // a FAKE drops it instead) and calms down while the fish is stunned or exhausted.
  updateBand(dt) {
    const calm = this.stunned ? 0.12 : this.exhausted ? 0.3 : 1;
    this.bandT += dt * this.bandDrift * calm;
    const bt = this.bandT, p = this.bph;
    const n = Math.sin(bt + p[0]) * 0.6 + Math.sin(bt * 2.3 + p[1]) * 0.3 + Math.sin(bt * 4.1 + p[2]) * 0.1;
    let target = 0;
    if (!this.stunned && !this.exhausted && !this.event) {
      if (this.mode === 'tele') target = this.shiftAmt * 0.5;
      else if (this.surging) target = this.shiftAmt * Math.min(1.6, this.surgeMul) * this.shiftDir;
    }
    this.bandDir = Math.abs(target - this.bandShift) > 6 ? Math.sign(target - this.bandShift) : 0;
    this.bandShift = damp(this.bandShift, target, this.surging ? 3.5 : 2.2, dt);
    const c = clamp(this.bandBase + this.bandAmp * n + this.bandShift, 62, 200);
    const w = this.bandW * (this.stunned ? 1.45 : this.exhausted ? 1.3 : 1);
    const b = this.band;
    b.c = c; b.lo = Math.max(20, c - w); b.hi = c + w;
    this.zone = { lo: b.lo / RPM_UNIT, hi: b.hi / RPM_UNIT };
  }

  // How hard the fish drags the gear back (rpm/s), and the brake while you hold against a surge.
  driveGear() {
    const G = this.F.gear;
    let L = 14 + this.power * 26 + this.heavy * 16;
    if (this.mode === 'tele') L += 25;
    if (this.surging) L = (100 + this.power * 140) * Math.min(2, this.surgeMul) * this.d.surge * (0.35 + 0.65 * this.stamina) * (1 + this.heavy * 0.25);
    if (this.exhausted) L *= 0.35;
    if (this.mode === 'hookset') L = 45;
    if (this.stunned || this.trick?.frozen || (this.event && !this.event.usesCrank)) L = 0;
    G.load = L * (this.gentle ? 0.5 : 1);
    G.brake = !!this.qte?.holding;
  }

  // ------------------------------------------------------------------ reel physics
  crankState() {
    const p = this.F.gear.p, z = this.zone;
    if (p < 0.08) return 'idle';
    return p > z.hi ? 'over' : p >= z.lo ? 'sweet' : 'slow';
  }

  physics(dt, opts = {}) {
    const F = this.F, st = F.stats, G = F.gear;
    const p = G.p, z = this.zone;
    const surging = this.surging && !this.stunned;
    const pull = surging ? (0.42 + this.power * 0.58) * (0.35 + 0.65 * this.stamina) * this.surgeMul : 0.05;
    const inBand = p >= z.lo && p <= z.hi, under = p < z.lo;
    const eff = Math.min(p, z.hi), over = Math.max(0, p - z.hi);
    const reelStat = 0.6 + 0.4 * (st.reelSpeed / 34);
    let reel = (eff * reelStat) / this.reelSecs;
    if (inBand) reel *= 1.3; else if (under) reel *= 0.7;
    if (this.stunned) reel *= 2.4;
    if (surging) reel *= inBand ? 0.45 : 0.15;
    if (this.tension > 0.95) reel *= 0.35;
    if (this.exhausted) reel *= 1.6;
    if (this.mode === 'hookset') reel *= 0.35;
    if (this.trick?.noReel) reel = 0;
    reel *= opts.reelMul ?? 1;
    const holding = !!this.qte?.holding;
    // the fish takes line while it runs (less if you hold or keep up in the band), and when the gear spins back
    const payout = surging ? pull * Math.sqrt(this.d.surge) * 0.085 * (1 - this.resil) * (holding ? 0.45 : 1) * (inBand ? 0.35 : 1) : 0;
    const back = G.rpm < 0 ? (-G.rpm / RPM_UNIT) * 0.09 * (1 - this.resil) : 0;
    this.progress += (reel - payout - back) * dt;
    this.reelRate = reel - payout - back;
    this.inBand = inBand;
    // tension: the line strains when the gear outruns the band, and while the fish runs
    let T = 0.13 + eff * 0.14 + over * 2.3;
    if (surging) T += pull * 0.42 + (inBand ? 0.1 : 0) + (holding ? 0.06 : 0);
    if (this.trick?.extraT) T += this.trick.extraT;
    T *= (0.85 + this.power * 0.3) * (1 + this.heavy * 0.55);
    T /= st.lineStrength * (this.gentle ? 1.6 : 1);
    if (this.exhausted) T *= 0.7;
    if (this.stunned) T *= 0.5;
    this.Ttarget = T;
    this.tension = clamp(damp(this.tension, T, T > this.tension ? 2.6 : 4, dt), 0, 1.25);
    // stamina: spinning in the band tires it; counters and shocks do the real work
    let drain = p * 0.2 * (inBand ? 1.4 : 0.7) + (this.stunned ? 0.35 : 0);
    if (surging) drain *= 0.3;
    drain *= (st.staminaDrain / this.stamSecs) * (opts.stamMul ?? 1);
    if (this.mode === 'hookset') drain *= 0.3;
    this.stamina = clamp01(this.stamina - drain * dt + (drain === 0 && !this.exhausted ? 0.02 * dt : 0));
    if (this.stamina <= 0.001 && !this.exhausted) this.exhaust();
  }

  // Air time during a jump: any reeling strains the line.
  airPhysics(dt) {
    const F = this.F, G = F.gear;
    const T = (0.05 + G.p * 0.65 + (F.input.down ? 0.3 : 0)) / (F.stats.lineStrength * (this.gentle ? 1.6 : 1));
    this.tension = clamp(damp(this.tension, T, 4, dt), 0, 1.25);
  }

  exhaust() {
    const F = this.F, f = this.fish;
    this.exhausted = true;
    this.mode = 'rest'; this.modeT = 99;
    this.trick = null;
    if (this.qte?.active) this.qte.active = false;
    f.feel('dizzy', 3);
    f.say('sweat', 1.2);
    F.onExhausted?.();
  }

  // ------------------------------------------------------------------ directional QTE
  newQte(dir, kind = null) {
    const c = this.control;
    const need = (this.gentle ? 34 : 52 + this.power * 46 + this.heavy * 14) / Math.sqrt(c);
    this.qte = { dir, t: 0, got: 0, need, k: 0, active: true, holding: false, kind, flip: 0, win: false, fail: false };
    this.qPrev = null;
  }

  updateQte(dt) {
    const q = this.qte, F = this.F, inp = F.input;
    if (!q) return;
    q.t += dt;
    q.flip = Math.max(0, q.flip - dt * 3);
    if (!q.active) { if (q.t > 1.2) this.qte = null; return; }
    if (this.exhausted || this.event) { q.active = false; return; }
    const cdx = -Math.cos(q.dir), cdy = -Math.sin(q.dir);
    const usable = inp.down && !F.shockGrab;
    if (usable) {
      const prev = this.qPrev || [inp.x, inp.y];
      const mx = inp.x - prev[0], my = inp.y - prev[1];
      const along = mx * cdx + my * cdy, perp = Math.abs(-mx * cdy + my * cdx);
      // control = forgiveness: wider cone before sideways motion counts against you
      const slack = Math.abs(along) * 0.6 * this.control;
      const gain = along - Math.max(0, perp - slack) * 0.6;
      if (gain > 0) q.got += gain;
      else q.got = Math.max(0, q.got + gain * 0.6);
      q.holding = true;
      this.qPrev = [inp.x, inp.y];
    } else {
      q.holding = false;
      this.qPrev = null;
      q.got = Math.max(0, q.got - dt * q.need * 0.25);
    }
    q.k = clamp01(q.got / q.need);
    if (q.k >= 1) this.counterWin();
  }

  counterWin() {
    const F = this.F, f = this.fish, q = this.qte;
    q.active = false; q.win = true; q.t = 0;
    this.combo++;
    const drain = (0.13 + 0.05 * this.control) * F.stats.staminaDrain * (1 - this.power * 0.3) * (this.gentle ? 1.6 : 1);
    this.stamina = Math.max(0, this.stamina - drain);
    this.progress += 0.035;
    const cdx = -Math.cos(q.dir), cdy = -Math.sin(q.dir);
    const [ax, ay] = this.anchor();
    this.place(ax + this.offX * 0.4 + cdx * 16, ay + this.offY * 0.4 + cdy * 16);
    f.squashV += 12; f.wiggle = 0.8;
    f.feel('dizzy', 1.2);
    this.tension = Math.max(0.2, this.tension - 0.18);
    this.mode = 'rest';
    this.trick = null;
    this.surgeMul = 1;
    this.modeT = rng.float(1.0, 1.8) * (1.2 - this.power * 0.4) * (this.gentle ? 1.4 : 1);
    F.onCounter?.(true, q.dir, this.combo);
    if (this.stamina <= 0.001 && !this.exhausted) this.exhaust();
  }

  counterFail() {
    const F = this.F, q = this.qte;
    if (!q?.active) return;
    q.active = false; q.fail = true; q.t = 0;
    this.combo = 0;
    const k = (this.gentle ? 0.08 : 0.2 + this.power * 0.15) * (1 + this.heavy * 0.4) / this.control;
    this.kick(k);
    this.progress -= (this.gentle ? 0.01 : 0.045) * (1 - this.resil);
    this.fish.feel('smug', 1.2);
    F.onCounter?.(false, q.dir, 0);
  }

  // ------------------------------------------------------------------ shock: hold to charge, release to zap
  // held: the charge input this frame (LMB charge-hold, Space or the right button). Real time (rdt).
  updateCharge(rdt, held) {
    const F = this.F;
    const edge = held && !this.prevHeld;
    this.prevHeld = held;
    if (!held) this.needRelease = false;
    const c = this.charge;
    if (!c) {
      if (held && !this.needRelease && this.canCharge) {
        this.charge = { t: 0, k: 0, full: 0, inWin: false };
        F.onChargeStart?.();
      } else if (edge && !this.canCharge && !this.event) F.onShockFizzle?.();
      return;
    }
    if (this.event || this.trick?.kind === 'jump') { this.charge = null; this.needRelease = held; F.onChargeCancel?.(); return; }
    if (held) {
      c.t += rdt;
      c.k = Math.min(1, c.t / this.chargeDur);
      if (c.k >= 1) c.full += rdt;
      const w = this.chargeWin;
      const inWin = c.k >= w.lo && c.k <= w.hi;
      if (inWin && !c.inWin) F.onChargePerfect?.();
      if (!inWin && c.inWin) F.onChargeOver?.();
      c.inWin = inWin;
      if (c.full >= this.overHold) this.backfire();
      return;
    }
    this.charge = null;
    if (c.k < 0.12) { F.onChargeCancel?.(true); return; } // a tap: nothing spent
    const w = this.chargeWin;
    this.fireZap(c.k < w.lo ? 'weak' : c.k <= w.hi ? 'perfect' : 'fizzle', c.k);
  }

  // Spends a charge and sends the zap down the line; the stun lands when it arrives (updateZap).
  fireZap(grade, k = 0.78) {
    this.charges--;
    this.shockCd = this.shockCdMax;
    let stun = 0;
    if (grade === 'perfect') stun = (this.shockPower + 0.6) * (1 - this.resist * 0.35);
    else if (grade === 'weak') {
      stun = this.shockPower * (0.3 + 0.45 * clamp01(k / this.chargeWin.lo)) * (1 - this.resist);
      if (stun < 0.35) { stun = 0; grade = 'shrug'; }
    }
    this.zap = { t: 0, dur: 0.2, stun, grade };
    this.F.onShockFire?.(grade);
  }

  // Instant shock for older drivers (RMB tap in old tests): fires as a release at `grade`.
  shock(grade = 'perfect') {
    if (!this.canCharge) { this.F.onShockFizzle?.(); return false; }
    this.charge = null;
    this.fireZap(grade);
    return true;
  }

  // Held past full: the charge discharges into your own gear.
  backfire() {
    const F = this.F;
    this.charge = null; this.needRelease = true;
    this.charges--;
    this.shockCd = this.shockCdMax;
    this.kick(0.3 + 0.08 * this.d.i);
    F.crank.stun = Math.max(F.crank.stun, 0.6);
    F.gear.jolt(-90);
    F.gear.jam = 0.5;
    this.fish.feel('smug', 1.5);
    if (this.mode === 'rest' && !this.exhausted && !this.gentle) this.modeT = Math.min(this.modeT, 0.15); // free surge
    F.onBackfire?.();
  }

  updateZap(dt) {
    if (!this.zap) return;
    this.zap.t += this.F.rdt;
    if (this.zap.t < this.zap.dur) return;
    const z = this.zap;
    this.zap = null;
    if (z.stun > 0) this.stun(z.stun, z.grade);
    else this.F.onShrug?.(z.grade);
  }

  stun(dur = this.shockPower + 0.3, grade = 'perfect') {
    const F = this.F, f = this.fish;
    this.stunMax = this.stunT = Math.max(this.stunT, dur);
    if (this.qte?.active) { this.qte.active = false; this.qte.win = true; this.qte.stunned = true; this.qte.t = 0; }
    if (this.trick && this.trick.kind !== 'jump') { this.trick = null; f.alpha = 1; }
    this.mode = 'stun';
    this.surgeMul = 1;
    this.stamina = Math.max(0, this.stamina - (grade === 'perfect' ? 0.12 : 0.05));
    f.feel('dizzy', this.stunT + 0.5);
    f.squashV += 14; f.wiggle = 1;
    F.onStun?.(grade);
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

  // ------------------------------------------------------------------ fish behaviour
  toRest() {
    const p = this.power;
    this.mode = 'rest';
    this.surgeMul = 1;
    this.shiftDir = 1;
    this.modeT = this.exhausted ? 99 : rng.float(0.9, 1.8) * (1.25 - p * 0.5) * (this.gentle ? 1.6 : 1);
    this.fish.feel(this.stamina < 0.45 ? 'tired' : 'determined', 1);
  }

  toTele() {
    const F = this.F, f = this.fish, p = this.power;
    this.mode = 'tele';
    this.modeT = this.gentle ? 1.1 : (0.62 - p * 0.14) * (0.85 + 0.15 * this.control);
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
    // tricks that are not plain surges get no QTE
    if (!['jump', 'wrap', 'hop', 'spit'].includes(this.pending)) this.newQte(this.teleDir, this.pending);
    f.say(this.pending === 'fake' || this.pending === 'dash' ? '!!' : '!', this.modeT + 0.2);
    f.feel('angry', 1);
    f.squashV -= 8;
    f.wiggle = 0.6;
    F.sfx('grunt', { vol: 0.35, pitch: 1.2 + rng.float(-0.1, 0.1) });
    F.onTele?.(this.teleDir);
  }

  toSurge() {
    const F = this.F, f = this.fish, p = this.power;
    this.mode = 'surge';
    this.surgeMul = 1;
    this.modeT = rng.float(1.1, 2.0) * (0.75 + p * 0.5) * (0.6 + 0.4 * this.stamina) * (this.gentle ? 1.5 : 1) * (0.85 + 0.15 * this.control);
    const kind = this.pending;
    this.pending = null;
    if (kind) this.startTrick(kind);
    if (this.mode === 'surge') {
      f.feel('determined', this.modeT);
      F.particles.bubbleTrail(f.x, f.y, Math.cos(this.pullDir) * 80, Math.sin(this.pullDir) * 80, { n: 4 });
      F.particles.wake?.(f.x, f.y, this.pullDir, 4);
      F.sfx('splash_small', { vol: 0.35, pitch: 1.3 });
      F.onSurge?.(this.pullDir);
    }
  }

  endSurge() {
    if (this.qte?.active) this.counterFail();
    this.toRest();
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
    f.vx = Math.cos(this.away) * 20 + Math.sin(t * 1.3) * 6;
    f.vy = Math.sin(this.away) * 4;
    this.place(ax + this.offX, ay + this.offY);
    f.lookAt?.(this.land.x, this.land.y - 40);
    if (this.exhausted) f.feel('dizzy', 0.3);
    if (F.gear.p > 0.3 && rng.chance(dt * 3)) F.particles.bubbleTrail(f.x, f.y, -Math.cos(this.away) * 60, -Math.sin(this.away) * 60);
  }

  brace(dt) {
    const f = this.fish;
    const [ax, ay] = this.anchor();
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
    const hold = this.qte?.holding ? 0.45 : 1;
    const sp = (55 + this.power * 70) * this.surgeMul * hold;
    const tx = Math.cos(this.pullDir) * R, ty = Math.sin(this.pullDir) * R;
    const dx = tx - this.offX, dy = ty - this.offY, d = Math.hypot(dx, dy) || 1;
    const step = Math.min(d, sp * dt);
    this.offX += (dx / d) * step; this.offY += (dy / d) * step;
    f.vx = Math.cos(this.pullDir) * 90; f.vy = Math.sin(this.pullDir) * 90;
    this.place(ax + this.offX, ay + this.offY);
    if (rng.chance(dt * 12)) F.particles.bubbleTrail(f.x - Math.cos(this.pullDir) * 8 * f.scale, f.y - Math.sin(this.pullDir) * 8 * f.scale, f.vx, f.vy);
    if (rng.chance(dt * (this.surgeMul > 1.5 ? 24 : 8))) F.particles.wake(f.x, f.y, this.pullDir, 2);
  }

  canJump() {
    const w = this.F.world;
    return w.surfaceY !== null && w.surfaceY !== undefined && this.fish.y - w.surfaceY < 280;
  }

  // ------------------------------------------------------------------ tricks (short visual events)
  startTrick(kind) {
    const F = this.F, f = this.fish, p = this.power;
    if (kind === 'jump' && !this.canJump()) kind = 'dash';
    if (this.trick || this.event) return;
    switch (kind) {
      case 'dash':
        this.surgeMul = 2.1;
        this.modeT = 0.75 + p * 0.3;
        this.kick(0.1);
        F.particles.speedLines(f.x, f.y, 12, { r0: 8, r1: 30, color: '#e8fbff', add: false, len: [6, 14] });
        F.cam?.punch?.(f.x, f.y, 0.06, 0.25);
        F.sfx('splash_small', { pitch: 0.8 });
        break;
      case 'fake': {
        // feint: the real surge goes the other way - the QTE arrow flips
        this.pullDir = this.teleDir + Math.PI + rng.float(-0.45, 0.45);
        this.surgeMul = 1.25;
        this.shiftDir = -1; // ...and the band drops instead of jumping up
        if (this.qte?.active) { this.qte.dir = this.pullDir; this.qte.got *= 0.15; this.qte.flip = 1; }
        F.sfx('boing', { vol: 0.5 });
        F.particles.glints?.(f.x, f.y, 4, { w: 10, h: 8, color: '#ffb0ff' });
        break;
      }
      case 'dive':
        this.surgeMul = 1.55;
        this.modeT = 1.5 + p * 0.5;
        F.particles.bubbleTrail(f.x, f.y, 0, 120, { n: 8 });
        break;
      case 'ink':
        this.surgeMul = 1.3;
        F.particles.ink(f.x, f.y, 16, { power: 1.4, scale: 1.3, color: this.sp.biome === 'junkyard' ? '#1a1410' : '#140a22' });
        F.inkSplat(3 + Math.round(p * 3));
        F.sfx('blub', { pitch: 0.6 });
        break;
      case 'glitch': {
        F.particles.burst(f.x, f.y, 18, { colors: ['#ff3a7a', '#3affd8', '#ffffff'], speed: 70, g: 0, life: 0.45, size: 2 });
        const a = rng.float(0, TAU), r = rng.float(35, 60);
        const [ax, ay] = this.anchor();
        this.place(ax + this.offX + Math.cos(a) * r, ay + this.offY + Math.sin(a) * r);
        F.particles.burst(f.x, f.y, 14, { colors: ['#ff3a7a', '#3affd8'], speed: 50, g: 0, life: 0.35, size: 2 });
        this.pullDir = this.away + rng.float(-1.6, 1.6);
        if (this.qte?.active) { this.qte.dir = this.pullDir; this.qte.got *= 0.3; this.qte.flip = 1; }
        this.surgeMul = 1.3;
        this.glitchT = 0.45;
        this.kick(0.1);
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
    F.onTrick?.(kind, TRICK_TITLES[kind]);
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
        F.particles.aeroBubbles?.(f.x, sy + 6, 8, { w: 10 });
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
      if (rng.chance(dt * 12)) F.particles.glint?.(f.x + rng.float(-8, 8), f.y + rng.float(-6, 6));
      if (f.y > sy && tr.vy > 0) {
        tr.stage = 'down'; tr.frozen = false; tr.t2 = 0;
        f.forceAngle = undefined;
        F.particles.eruption(f.x, sy, 0.7);
        F.sfx('splash_big', { vol: 0.7 });
        const strained = F.gear.p > 0.35;
        if (strained) { this.kick(0.45); F.shake(5); }
        else { this.stamina = Math.max(0, this.stamina - 0.2); F.particles.stars(f.x, sy, 8, { speed: [30, 70] }); }
        F.onJumpLand?.(!strained, f.x, sy);
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
      F.onTrickDone?.(true);
      F.particles.stars(f.x, f.y, 10, { speed: [30, 80] });
      this.stamina = Math.max(0, this.stamina - 0.1);
      F.sfx('timing_perfect');
      return true;
    }
    if (tr.t > tr.dur) {
      this.kick(0.35);
      F.onTrickDone?.(false);
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
        F.particles.aeroBubbles?.(f.x, f.y, 8);
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
        this.modeT = 1.1 + this.power * 0.6;
        this.newQte(this.pullDir, 'hop');
        F.onSurge?.(this.pullDir);
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
        F.fx.aeroBubbles?.(sx, sy, 5, { layer: 'fg', w: 6 });
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
    if (this.qte?.active) this.qte.active = false;
    this.mode = 'rest'; this.modeT = 1;
    this.fish.alpha = 1;
    this.fish.forceAngle = undefined;
    F.onEventStart?.(ev);
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
    if (ev.name === 'net') {
      if (r === 'win') return 'land';
      this.progress = 0.8; this.ghost = 1;
      this.stamina = Math.max(this.stamina, 0.4);
      this.exhausted = false;
      F.onEventEnd?.(ev, false);
      f.feel('smug', 1.5);
      this.toRest();
      return 'ok';
    }
    if (r === 'snap') return 'snap';
    if (r === 'win') {
      this.progress += 0.1;
      this.stamina = Math.max(0, this.stamina - 0.22);
      F.sfx('timing_perfect');
    } else {
      this.progress -= 0.08 * (1 - this.resil);
      this.kick(0.25);
      f.feel('smug', 1.5);
      F.sfx('timing_miss');
    }
    F.onEventEnd?.(ev, r === 'win');
    this.toRest();
    return 'ok';
  }

  // ------------------------------------------------------------------ helpers for HUD / tests
  // A comfortable screen point to circle the mouse around (automated tests); events may override.
  crankHint() {
    const F = this.F, f = this.fish;
    if (this.event?.hint) return this.event.hint();
    const [fsx, fsy] = F.toScreen(f.x, f.y);
    const R = Math.max(60, F.zoneRadius());
    const a = this.away + Math.PI;
    return [clamp(fsx + Math.cos(a) * R, 50, F.W - 160), clamp(fsy + Math.sin(a) * R, 60, F.H - 80)];
  }
}
