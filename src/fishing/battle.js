// The fight backbone [simple24]: ONE meter, ONE spin, ONE big SHOCK button. Only one input matters at a time.
//   Hook     HookBite: when the fish bites (the big "!"), click (or Space) before the window closes. A click while it
//            is still nibbling scares it off. Nothing else.
//   Spin     a horizontal meter with a glowing sweet ZONE in the middle and a MARKER (the hooked fish's icon). The fish
//            drags the marker LEFT (it swims away); spinning the reel (circle the mouse round the big 3D gear, roll
//            the wheel, or hold / tap W / Up) pushes it RIGHT. Too slow = it runs left, too fast = the line goes tight
//            on the right. Keep the marker in the zone: the catch bar fills (faster the longer you stay steady and the
//            closer to dead centre); outside it the bar drains slowly. The fish's pull wanders (gentle for commons;
//            rarer fish wander faster, jitter and LUNGE: a telegraphed shove, arrow on the meter first).
//   Shock    the big SHOCK button recharges by itself (faster while you hold the zone). When a charge is ready the
//            fight gives a BEAT: the fish braces, the marker freezes (stop spinning!), and a spark sweeps across the
//            meter. Press Space / click as the spark crosses the GOLD notch in the middle: CRITICAL (big hit, long stun,
//            the marker snaps to centre; 'shockFired' {grade: 'perfect'}). Inside the green zone: a GOOD zap ('good').
//            In the red ends: a small BACKFIRE (onBackfire). No press: nothing lost, the beat comes back later.
//            While stunned the fish stops pulling: free progress. Upgrades (rodStats().shock + Lab): power = damage +
//            stun, charges, cooldown = recharge, control / timingWindow = a wider gold notch, power >= 1.8 chains.
//   Lose     only when the catch bar is empty AND the marker sits at an edge for a while ('run' left, 'snap' right).
// Rarer fish: narrower zone, faster wander, jitter, lunges, a longer bar and a quicker spark (DIFF / PACE).
// Bosses (boss.js BossFight) ride on the same meter: phases change the pull, shield phases only a shock breaks.
// The forced fishing lesson (tutorial.lesson {stage: 'spin' | 'shock' | 'land', hold, cap, floor}) shapes the fight.
//
// update(dt) -> 'ok' | 'land' | 'snap' | 'run'

import { TAU, clamp, clamp01, lerp, dist, damp } from '../core/math.js';
import { rng } from '../core/rng.js';
import { RPM_UNIT } from './gear.js';
import { BossFight } from './boss.js';

export const TRICK_TITLES = { lunge: 'LUNGE!', dash: 'DASH!', run: 'RUN!' };

export const DEFAULT_ROD = { lureSpeed: 1, luck: 1, control: 1, resilience: 0.1, strength: 6, shock: { power: 0.8, charges: 1, cooldown: 6 } };

// Difficulty by rarity. zone: sweet zone half-width (meter units, the track is -1..1); base / amp / speed: the fish's
// pull (in spin units, 1 = RPM_UNIT rpm) and how far / fast it wanders; jit: jitter; lunge: lunges per second;
// secs: seconds of steady zone time to land it; drain: catch bar lost per second outside the zone; hookWin: the
// bite window (s); sweep: seconds the shock spark takes across the meter; crit: gold notch half-width.
export const DIFF = {
  common: { i: 0, zone: 0.3, base: 0.5, amp: 0.15, speed: 0.42, jit: 0, lunge: 0, secs: 16, drain: 0.035, hookWin: 1.8, sweep: 1.6, crit: 0.13 },
  uncommon: { i: 1, zone: 0.27, base: 0.54, amp: 0.2, speed: 0.55, jit: 0.05, lunge: 0.05, secs: 19, drain: 0.045, hookWin: 1.55, sweep: 1.42, crit: 0.115 },
  rare: { i: 2, zone: 0.24, base: 0.58, amp: 0.25, speed: 0.7, jit: 0.1, lunge: 0.09, secs: 22.5, drain: 0.055, hookWin: 1.35, sweep: 1.26, crit: 0.1 },
  epic: { i: 3, zone: 0.21, base: 0.62, amp: 0.29, speed: 0.86, jit: 0.16, lunge: 0.13, secs: 26.5, drain: 0.065, hookWin: 1.2, sweep: 1.12, crit: 0.09 },
  legendary: { i: 4, zone: 0.18, base: 0.66, amp: 0.33, speed: 1.02, jit: 0.22, lunge: 0.17, secs: 31, drain: 0.075, hookWin: 1.05, sweep: 1, crit: 0.08 },
};
// Per rarity tier (common .. legendary): spring = how much the marker drifts back to the middle on its own (commons
// are forgiving), react = how fast the marker answers the spin, tele = the lunge warning (s), beatGap = calm seconds
// between shock beats.
export const PACE = {
  spring: [0.55, 0.38, 0.22, 0.1, 0],
  react: [4.2, 4.8, 5.4, 6, 6.6],
  tele: [1.1, 1.0, 0.9, 0.8, 0.7],
  beatGap: [2.6, 2.4, 2.2, 2, 1.8],
};
export const diffOf = (sp) => DIFF[sp?.rarity] || DIFF.common;
const GAIN = 1.25; // marker speed (track half-widths per s) per spin unit of imbalance

// The shock as a weapon: level 1..5 (MK I..V) from power, charges and recharge; chain arcs from MK IV.
export function shockLevel(sh) {
  const p = sh?.power ?? 0.8, c = sh?.charges ?? 1, cd = sh?.cooldown ?? 6;
  const score = (p - 0.8) / 0.42 + (c - 1) * 0.45 + Math.max(0, 6 - cd) * 0.18;
  return clamp(1 + Math.floor(score), 1, 5);
}

// ------------------------------------------------------------------ the bite: click when it bites
// Built when a fish bites (Fishing.state 'bite'); update(dt) -> 'ok' | 'slow'. Fishing calls hook() on a click.
export class HookBite {
  constructor(F, f) {
    this.F = F; this.fish = f;
    this.gearMode = 'hook';
    const sp = f.sp, fight = sp.fight || {};
    this.gentle = !!F.game.tutorialActive;
    const d = diffOf(sp);
    this.d = d;
    this.window = (d.hookWin + (fight.biteWindow ?? 0.6) * 0.5) * (F.stats?.biteWindow ?? 1);
    if (f.boss) this.window *= 1.8;
    if (this.gentle) this.window = Math.max(this.window, 10); // the lesson: plenty of time
    this.t = 0; this.set = 0; this.progress = 0; this.tension = 0.3; this.inBand = false;
    this.shockMax = 0; this.charges = 0;
  }

  get timeK() { return clamp01(1 - this.t / this.window); }

  update(dt) {
    this.t += dt;
    this.set = this.progress = clamp01(this.t / this.window);
    this.tension = 0.3 + 0.4 * Math.max(0, Math.sin(this.t * 11));
    const G = this.F.gear;
    G.load = 0; G.brake = false;
    return this.t >= this.window ? 'slow' : 'ok';
  }
}
export { HookBite as HookSpin }; // older name

export class Battle {
  constructor(F) {
    const f = F.fish, sp = F.sp, g = F.game;
    this.F = F; this.fish = f; this.sp = sp;
    this.gentle = !!g.tutorialActive;
    const fight = sp.fight || {};
    const rod = F.rod || DEFAULT_ROD;
    this.rod = rod;
    const st = F.stats || {};
    this.control = clamp(rod.control ?? 1, 0.5, 3);
    this.resil = clamp(rod.resilience ?? 0.1, 0, 0.9);
    this.strength = Math.max(0.1, rod.strength ?? 6);
    const kg = Number(f.rec?.weightKg) || 1;
    this.kg = kg;
    this.heavy = this.gentle || f.boss ? 0 : clamp(kg / this.strength - 1, 0, 2.5);
    const giant = f.rec?.giant ? 1 : 0;
    this.power = clamp01((fight.power ?? 0.4) * (this.gentle ? 0.4 : 1) * (giant ? 1.2 : 1));
    // difficulty: a boss fights by its tier, everyone else by rarity
    const d = f.boss ? DIFF[['common', 'uncommon', 'uncommon', 'rare', 'rare', 'epic', 'epic', 'legendary'][clamp(f.boss.tier | 0, 1, 7)]] : diffOf(sp);
    this.d = d;
    this.pi4 = clamp(d.i | 0, 0, 4);
    this.gearMode = 'meter';
    const ctl = this.control;
    // ---- the meter
    // older Lab perks feed the meter: Tracer Eyes (traceRadius) widen the zone, Dodge Roll (dodgeHits) lengthens the
    // lunge warning, Focus Mode slows the shock spark, Counter Grip (mashPower) hits harder
    this.zoneW = clamp(d.zone * Math.pow(ctl, 0.5) * Math.pow(st.traceRadius ?? 1, 0.5) * (this.gentle ? 1.25 : 1), 0.12, 0.42);
    this.teleMul = 1 + Math.max(0, (st.dodgeHits ?? 2) - 2) * 0.2;
    this.hitMul = Math.pow(st.mashPower ?? 1, 0.5);
    this.pullBase = d.base + this.power * 0.14 + this.heavy * 0.12;
    this.pullAmp = (d.amp + this.heavy * 0.05) * (this.gentle ? 0.45 : 1) / Math.sqrt(ctl);
    this.pullSpeed = d.speed * (this.gentle ? 0.6 : 1);
    this.jitAmp = (d.jit + this.heavy * 0.06) * (this.gentle ? 0 : 1);
    this.lungeRate = this.gentle ? 0 : d.lunge * (1 + this.heavy * 0.3);
    this.spring = this.gentle ? 0.8 : PACE.spring[this.pi4];
    this.react = PACE.react[this.pi4];
    this.marker = -0.35; this.mv = 0;
    this.need = this.pullBase; this.spin = 0;
    this.ph = [rng.float(0, TAU), rng.float(0, TAU), rng.float(0, TAU)];
    this.pt = 0;
    this.jit = 0; this.jitT = 0; this.jitTo = 0;
    this.lunge = null; this.lungeCool = 3;
    this.inZone = false; this.zoneT = 0; this.steady = 0; this.centre = false;
    this.loseT = 0;
    // ---- catch bar
    const reelStat = 0.7 + 0.3 * ((st.reelSpeed ?? 34) / 34);
    const tire = Math.sqrt(st.staminaDrain ?? 1);
    this.secs = d.secs * (0.85 + (fight.stamina ?? 5) * 0.03) * (giant ? 1.2 : 1) * (1 + this.heavy * 0.2) / (reelStat * tire) * (this.gentle ? 0.8 : 1);
    this.drainRate = d.drain * (1 - this.resil * 0.6);
    this.progress = this.gentle ? 0.05 : 0.14; this.ghost = this.progress;
    // ---- the shock button
    const sh = rod.shock || DEFAULT_ROD.shock;
    this.shockMax = clamp(Math.round(sh.charges ?? 1), 1, 6);
    this.charges = this.shockMax;
    this.shockPower = Math.max(0.3, sh.power ?? 0.8);
    this.shockCdMax = clamp(sh.cooldown ?? 6, 1.5, 12);
    this.shockCd = 0;
    this.level = shockLevel(sh);
    this.chain = this.shockPower >= 2.4 ? 2 : this.shockPower >= 1.8 ? 1 : 0;
    this.critW = clamp(d.crit * Math.pow(st.timingWindow ?? 1, 0.7) * Math.pow(ctl, 0.3) * (1 + (this.shockPower - 0.8) * 0.12) * (this.gentle ? 1.7 : 1), 0.06, 0.3);
    this.sweep = d.sweep * (this.gentle ? 1.5 : 1) * ((st.focus ?? 0) > 0 ? 1.2 : 1);
    this.beat = null; this.beatCool = 2.2; this.readyT = 0;
    this.zap = null; this.lastHit = null;
    this.stunT = 0; this.stunMax = 1;
    this.combo = 0; this.crits = 0;
    // ---- fish placement
    this.start = { x: f.x, y: f.y };
    this.land = F.landingPoint(f);
    this.depth = dist(this.start.x, this.start.y, this.land.x, this.land.y);
    this.lineLen = Math.round((3 + this.depth / 18 + this.power * 9) * 10) / 10;
    this.away = Math.atan2(this.start.y - this.land.y, this.start.x - this.land.x);
    this.offX = 0; this.offY = 0;
    this.tension = 0.3;
    this.mode = 'hookset'; this.modeT = 0.9; this.t = 0;
    this.hudIn = 0;
    // older fields other modules read
    this.event = null; this.trick = null; this.qte = null; this.lean = 0; this.stamina = 1; this.exhausted = false;
    this.phases = []; this.pi = 0; this.events = [];
    this.boss = f.boss ? new BossFight(this, f.boss) : null;
    if (this.boss) { this.secs = 38 * (f.boss.hp || 1) * (1 + (f.boss.tier - 1) * 0.04) / reelStat; this.progress = 0; this.ghost = 0; this.zoneW = clamp(this.zoneW * 1.15, 0.16, 0.42); }
  }

  get phase() { return this; }
  get phaseName() { return 'meter'; }
  get surging() { return !!this.lunge && this.lunge.stage === 'go'; }
  get stunned() { return this.stunT > 0; }
  get lesson() { return this.gentle ? this.F.game?.tutorial?.lesson || null : null; }
  lessonShock() { const L = this.lesson; return !L || (L.hold <= 0 && (L.stage === 'shock' || L.stage === 'land')); }
  // a shock beat may start: a charge, not stunned, not already zapping, not during a boss cutscene
  get canCharge() { return this.charges > 0 && !this.zap && !this.boss?.blocksShock && this.lessonShock(); }
  get shockReady() { return this.canCharge && !this.stunned; }
  get ready() { return this.charges > 0; }
  // the charge being built up (0..1) for the button's fill
  get chargeK() { return this.charges >= this.shockMax ? 1 : clamp01(1 - this.shockCd / this.shockCdMax); }

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
  }

  kick(n) { this.marker = clamp(this.marker - n, -1, 1); }

  // ------------------------------------------------------------------ main update
  update(dt) {
    const F = this.F, f = this.fish, G = F.gear;
    this.t += dt;
    this.hudIn = Math.min(1, this.hudIn + F.rdt * 3);
    f.z = damp(f.z, 0, 4, dt);
    f.controlled = true; f.allowTurn = true;
    if (this.ghost > this.progress) this.ghost = Math.max(this.progress, this.ghost - dt * 0.3); else this.ghost = this.progress;
    this.updateZap(dt);
    this.spin = clamp((G.rpm || 0) / RPM_UNIT, -0.6, 2);
    G.load = 18 + Math.max(0, this.need) * 40; G.brake = false;
    // the lesson's calm intro beat for a step: the fish settles while Bubbles explains
    const LS = this.lesson;
    if (LS && LS.hold > 0 && this.mode !== 'hookset') {
      this.marker = damp(this.marker, 0, 2, dt); this.mv = 0;
      this.idleFish(dt);
      this.tension = damp(this.tension, 0.3, 3, dt);
      return 'ok';
    }
    if (this.boss) {
      const bm = this.boss.update(dt);
      if (bm === 'hold') { this.mv = damp(this.mv, 0, 6, dt); this.tension = damp(this.tension, 0.3, 3, dt); return 'ok'; }
    }
    if (this.mode === 'hookset') {
      this.modeT -= F.rdt;
      this.thrash(dt, 3);
      this.marker = damp(this.marker, -0.2, 3, dt);
      if (this.modeT <= 0) this.mode = 'fight';
      return 'ok';
    }
    this.updatePull(dt);
    this.updateShock(dt);
    this.updateMarker(dt);
    this.updateProgress(dt);
    this.moveFish(dt);
    this.tension = clamp(0.32 + Math.max(0, this.marker) * 0.66 - Math.max(0, -this.marker) * 0.12 + (this.lunge?.stage === 'go' ? 0.12 : 0), 0.1, 1.05);
    return this.checks(dt);
  }

  // The fish's pull (spin units): a slow wander, a little jitter, telegraphed lunges, the boss's phase on top.
  updatePull(dt) {
    const F = this.F, f = this.fish, B = this.boss?.mods?.() || null;
    const speed = this.pullSpeed * (B?.speed ?? 1), amp = this.pullAmp * (B?.amp ?? 1) + (B?.ampAdd ?? 0), jitA = this.jitAmp + (B?.jit ?? 0);
    this.pt += dt * speed;
    const p = this.ph, t = this.pt;
    const wave = Math.sin(t + p[0]) * 0.6 + Math.sin(t * 2.3 + p[1]) * 0.3 + Math.sin(t * 4.1 + p[2]) * 0.1;
    this.jitT -= dt;
    if (this.jitT <= 0) { this.jitT = rng.float(0.14, 0.32); this.jitTo = rng.float(-1, 1) * jitA; }
    this.jit = damp(this.jit, this.jitTo, 10, dt);
    // lunges: telegraph (arrow on the meter, the fish braces), then a hard shove one way
    const rate = this.lungeRate + (B?.lunge ?? 0);
    this.lungeCool -= dt;
    if (!this.lunge && !this.beat && !this.stunned && rate > 0 && this.lungeCool <= 0 && rng.chance(dt * rate * 1.6)) {
      const dir = this.marker > 0.25 ? 1 : this.marker < -0.25 ? -1 : rng.sign(); // shoves you further the way you lean
      this.lunge = { stage: 'tele', t: 0, tele: PACE.tele[this.pi4] * (B?.tele ?? 1) * this.teleMul, dir, dur: 0.7 + this.power * 0.3, k: 0 };
      f.say('!!', this.lunge.tele); f.feel('angry', 1.2);
      F.sfx('grunt', { vol: 0.4, pitch: 1.1 });
      F.onLungeWarn?.(this.lunge);
    }
    let lungeN = 0;
    const L = this.lunge;
    if (L) {
      L.t += dt;
      if (L.stage === 'tele' && L.t >= L.tele) { L.stage = 'go'; L.t = 0; F.onLunge?.(L); }
      else if (L.stage === 'go') {
        L.k = Math.sin(clamp01(L.t / L.dur) * Math.PI);
        lungeN = -L.dir * (0.55 + this.power * 0.2) * L.k;
        if (L.t >= L.dur) { this.lunge = null; this.lungeCool = rng.float(2.2, 4); }
      }
    }
    this.need = this.pullBase + (B?.base ?? 0) + amp * wave + this.jit + lungeN;
  }

  updateMarker(dt) {
    let vt;
    if (this.stunned) vt = -this.marker * 3.2; // stunned: no pull, the marker floats home
    else if (this.beat) vt = 0; // the beat: everything holds still
    else vt = (this.spin - this.need) * GAIN - this.marker * this.spring;
    this.mv = damp(this.mv, vt, this.beat ? 9 : this.react, dt);
    this.marker = clamp(this.marker + this.mv * dt, -1, 1);
    if ((this.marker <= -1 && this.mv < 0) || (this.marker >= 1 && this.mv > 0)) this.mv = 0;
    const was = this.inZone;
    this.inZone = Math.abs(this.marker) <= this.zoneW;
    this.centre = Math.abs(this.marker) <= this.zoneW * 0.4;
    this.zoneT = this.inZone ? this.zoneT + dt : 0;
    this.steady = this.inZone ? Math.min(1, this.steady + dt / 2.5) : Math.max(0, this.steady - dt * 1.5);
    if (this.inZone !== was) this.F.onZone?.(this.inZone);
  }

  updateProgress(dt) {
    const B = this.boss, LP = this.lesson;
    if (this.beat) return; // the beat is a pause
    let rate;
    if (this.inZone || this.stunned) {
      rate = (1 / this.secs) * (1 + this.steady * 0.35) * (this.centre ? 1.15 : 1) * (this.stunned ? 1.3 : 1);
      if (B) rate *= B.fillMul();
    } else {
      rate = -this.drainRate * (Math.abs(this.marker) > 0.85 ? 1.4 : 1);
      if (B) rate *= 0.6;
    }
    this.progress += rate * dt;
    if (LP) this.progress = clamp(this.progress, LP.floor ?? 0, LP.cap ?? 1);
    if (this.progress < 0) this.progress = 0;
  }

  checks(dt) {
    const edge = Math.abs(this.marker) > 0.8;
    if (!this.gentle && this.progress <= 0.001 && edge && !this.stunned && !this.beat) this.loseT += dt;
    else this.loseT = Math.max(0, this.loseT - dt * 1.5);
    if (this.loseT > 2.6) return this.marker < 0 ? 'run' : 'snap';
    if (this.progress >= 1 && this.boss && !this.boss.canFinish()) this.progress = 0.995;
    if (this.progress >= 1) { this.progress = 1; return 'land'; }
    return 'ok';
  }

  // ------------------------------------------------------------------ the shock: recharge, beat, press
  updateShock(dt) {
    const F = this.F;
    // recharge (faster while you hold the zone)
    if (this.charges < this.shockMax) {
      this.shockCd -= dt * (this.inZone ? 1.35 : 0.8);
      if (this.shockCd <= 0) { this.charges++; this.shockCd = this.charges < this.shockMax ? this.shockCdMax : 0; F.onShockReady?.(); }
    }
    this.beatCool = Math.max(0, this.beatCool - dt);
    const b = this.beat;
    if (!b) {
      this.readyT = this.canCharge && !this.stunned && !this.lunge ? this.readyT + dt : 0;
      const shield = this.boss?.shielded;
      const want = this.canCharge && !this.stunned && !this.lunge && this.beatCool <= 0 && (this.zoneT > 0.6 || this.readyT > 3.4 || (shield && this.readyT > 0.8));
      if (want) this.startBeat();
      return;
    }
    b.t += dt;
    if (b.stage === 'tele') {
      if (b.t >= b.tele) { b.stage = 'sweep'; b.t = 0; F.onBeatSweep?.(b); }
    } else if (b.stage === 'sweep') {
      b.x = lerp(-1.12, 1.12, clamp01(b.t / b.dur));
      const inCrit = Math.abs(b.x) <= this.critW;
      if (inCrit && !b.critSeen) { b.critSeen = true; F.onBeatCrit?.(b); }
      if (b.t >= b.dur) { this.beat = null; this.beatCool = PACE.beatGap[this.pi4]; F.onBeatMiss?.(); this.lessonRefund('miss'); }
    }
  }

  startBeat() {
    const F = this.F, f = this.fish;
    this.beat = { stage: 'tele', t: 0, tele: this.gentle ? 0.8 : 0.5, dur: this.sweep * (this.boss?.sweepMul?.() ?? 1), x: -1.12 };
    f.feel('surprised', 1); f.say('!', 0.8);
    F.onBeat?.(this.beat);
  }

  // Space / click. Returns the grade ('perfect' | 'good' | 'backfire') or null when nothing happened.
  pressShock() {
    const F = this.F, b = this.beat;
    if (!b || b.stage !== 'sweep' || this.zap) {
      if (!b) F.onShockFizzle?.(this.charges > 0 ? 'wait' : 'empty');
      return null;
    }
    const x = Math.abs(b.x);
    const grade = x <= this.critW ? 'perfect' : x <= this.zoneW ? 'good' : 'backfire';
    this.beat = null;
    this.beatCool = PACE.beatGap[this.pi4];
    this.charges--;
    if (this.shockCd <= 0) this.shockCd = this.shockCdMax;
    if (grade === 'backfire') { this.backfire(); return grade; }
    this.zap = { t: 0, dur: 0.2, grade };
    F.onShockFire?.(grade);
    return grade;
  }

  // Instant shock for older drivers / dev: fires as a press at `grade`.
  shock(grade = 'perfect') {
    if (this.charges <= 0) { this.F.onShockFizzle?.('empty'); return false; }
    this.beat = { stage: 'sweep', t: 0, dur: 1, x: grade === 'perfect' ? 0 : grade === 'good' ? this.zoneW * 0.9 : 1 };
    return !!this.pressShock();
  }

  backfire() {
    const F = this.F;
    const side = this.marker >= 0 ? 1 : -1;
    this.marker = clamp(this.marker + side * 0.32, -1, 1);
    this.mv = side * 0.6;
    this.progress = Math.max(0, this.progress - 0.02);
    F.gear.jolt(-60);
    F.gear.jam = 0.45;
    this.combo = 0;
    this.fish.feel('smug', 1.5);
    F.onBackfire?.();
    this.lessonRefund('backfire');
  }

  // The zap runs down the line; the hit lands when it arrives.
  updateZap(dt) {
    if (!this.zap) return;
    this.zap.t += this.F.rdt;
    if (this.zap.t < this.zap.dur) return;
    const z = this.zap;
    this.zap = null;
    this.hit(z.grade);
  }

  hit(grade) {
    const F = this.F, f = this.fish, P = this.shockPower;
    const crit = grade === 'perfect';
    const weak = !!this.boss?.weakPoint?.();
    let dmg = crit ? 0.08 + 0.045 * P : 0.035 + 0.02 * P;
    const chain = crit ? this.chain : this.chain >= 2 ? 1 : 0;
    dmg *= (1 + chain * 0.35) * this.hitMul;
    if (weak && crit) dmg *= 1.6;
    if (this.boss) dmg *= this.boss.dmgMul();
    const LP = this.lesson;
    this.progress = clamp(this.progress + dmg, 0, LP?.cap ?? 1);
    const stun = crit ? 1.1 + P * 0.75 : 0.45 + P * 0.3;
    this.stunMax = this.stunT = Math.max(this.stunT, LP ? Math.max(stun, 2.4) : stun);
    this.marker = crit ? this.marker * 0.25 : this.marker * 0.6;
    this.mv = 0;
    this.lunge = null;
    this.combo = crit ? this.combo + 1 : 0;
    if (crit) this.crits++;
    this.lastHit = { grade, dmg, chain, weak, t: this.t };
    f.feel('dizzy', this.stunT + 0.5);
    f.squashV += crit ? 16 : 8; f.wiggle = 1;
    this.boss?.onShock?.(grade);
    if (LP) LP.hit = true;
    F.onShockHit?.(grade, dmg, chain, weak);
    F.onStun?.(grade);
  }

  // the lesson hands a wasted charge straight back
  lessonRefund(why) {
    const L = this.lesson;
    if (!L) return;
    this.charges = Math.max(this.charges, 1);
    this.shockCd = 0;
    this.beatCool = Math.min(this.beatCool, 1.2);
    L.miss = (L.miss || 0) + 1;
    L.missWhy = why;
    if (L.stage === 'shock' && L.miss >= 3 && why !== 'backfire') L.easy = true; // third time: a very wide notch
    if (L.easy) this.critW = Math.max(this.critW, 0.3);
  }

  // ------------------------------------------------------------------ fish motion (mirrors the meter)
  moveFish(dt) {
    const f = this.fish, t = this.t;
    if (this.stunned) { this.stunT = Math.max(0, this.stunT - dt); this.stunMove(dt); return; }
    if (this.lunge?.stage === 'tele') { this.brace(dt); return; }
    const [ax, ay] = this.anchor();
    // the marker left = the fish pulls away from the boat; right = it is hauled in
    const R = 26 + this.power * 18;
    const dx = Math.cos(this.away), dy = Math.sin(this.away);
    const along = -this.marker * R + (this.lunge?.stage === 'go' ? -this.lunge.dir * 20 * this.lunge.k : 0);
    const side = Math.sin(t * 1.4) * 10 + this.jit * 30;
    this.offX = damp(this.offX, dx * along - dy * side, 3, dt);
    this.offY = damp(this.offY, dy * along * 0.5 + dx * side * 0.4 + Math.sin(t * 2.1) * 3, 3, dt);
    f.vx = dx * (this.marker < 0 ? 50 : 20) + Math.sin(t * 1.3) * 8;
    f.vy = dy * 6;
    this.place(ax + this.offX, ay + this.offY);
    if (this.beat) f.wiggle = 0.3;
    f.lookAt?.(this.land.x, this.land.y - 40);
    if (this.inZone && rng.chance(dt * 3)) this.F.particles.bubbleTrail?.(f.x, f.y, -dx * 60, -dy * 60);
  }

  idleFish(dt) {
    const [ax, ay] = this.anchor(), f = this.fish;
    this.offX = damp(this.offX, Math.sin(this.t * 1.1) * 6, 2, dt);
    this.offY = damp(this.offY, Math.sin(this.t * 1.7) * 3, 2, dt);
    f.vx = Math.cos(this.away) * 12; f.vy = 0;
    this.place(ax + this.offX, ay + this.offY);
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

  brace(dt) {
    const f = this.fish, L = this.lunge;
    const [ax, ay] = this.anchor();
    const k = Math.sin(this.t * 40) * 1.4;
    const dx = Math.cos(this.away) * L.dir;
    this.offX = damp(this.offX, this.offX + dx * 3 + k, 6, dt);
    this.place(ax + this.offX, ay + this.offY);
    f.vx = Math.cos(this.away) * -L.dir * 30; f.vy = 0;
    f.wiggle = 0.7;
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

  // dev / tests: finish the fight now (a boss skips its remaining phases)
  debugWin() { this.boss?.debugWin(); this.progress = 1; }
  startEvent() { return false; }

  // A comfortable screen point to circle the mouse around (automated tests): just left of the gear.
  crankHint() {
    const F = this.F, L = F.gear.lay;
    if (L) return [Math.round(L.cx - L.R * 0.2), Math.round(L.cy)];
    return [Math.round(F.W * 0.7), Math.round(F.H * 0.7)];
  }
}
