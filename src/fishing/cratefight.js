// Crate fights [crate26]: a floating crate you snag is fought on the SAME meter as a fish (spin to keep the marker in
// the middle zone, the big timed SHOCK button), instead of the old light box reel. Surprises (rolled by the floater,
// src/world/floaters.js f.surprise; tells: a legs crate twitches, a mimic's eye peeks from under the lid):
//   legs   1-3.5 s into the fight crab legs pop out (LEGS?!): the crate scuttles, the meter goes erratic (jitter,
//          frequent sideways lunges with a shorter warning) and the catch bar drains ~2x faster outside the zone.
//          Lose it and it drops to the seabed and runs off across it, legs a blur.
//   mimic  at the hook-set or a third of the way in, the lid flies open: teeth, a tongue, eyes, a cinematic beat with a
//          3D voxel MIMIC! title. Then a mini-boss: a narrower zone, a harder pull, CHOMPS (the lid snaps, the marker is
//          knocked toward the edge it leans to) and once, at half way, a SHIELD (the lid clamps shut and armours up: the
//          zone locks and the bar does not fill until a GOOD / CRITICAL shock cracks it). Beating it upgrades the loot
//          one tier (a wooden crate becomes an iron chest, ... orb stays orb with a bonus roll).
// Crate types tune the meter (PROFILE): light wooden crates / bottles wobble, iron crates drag hard but steady, golden
// ones are heavy and sly, orbs float and dart.
//
//   new CrateFish(F, f)          a fish-shaped proxy around the floater (x / y / z go straight to the floater)
//   new CrateBattle(F)           Battle subclass (F.fish = the proxy, F.sp = its sp); update(dt) -> 'ok'|'land'|'run'|'snap'
//     .box (the floater), .surprise, .shielded, markerIcon(w, h), drawHud(ctx), drawWorld(ctx), cancel()
//   new CratePop(F, f, B)        the landing: the crate bursts out of the water and arcs to the rod -> 'caught'
//   new CrateEscape(F, f, reason, line, surprise)  the getaway cutscene (a Fishing.cine)
//   upgradeTier(tier)            the mimic's loot bump

import { TAU, clamp, clamp01, lerp, damp, ease } from '../core/math.js';
import { rng } from '../core/rng.js';
import { Battle, PACE, DIFF } from './battle.js';
import { word3D, letters3D } from './cinematics.js';
import { crateIcon } from '../world/floaters.js';
import { boxSprite } from './boxreel.js';
import { HOOK } from './baitart.js';

const TIER_ORDER = ['crate', 'iron', 'golden', 'orb'];
export const upgradeTier = (t) => TIER_ORDER[Math.min(TIER_ORDER.length - 1, Math.max(0, TIER_ORDER.indexOf(t)) + 1)];

// Meter feel per tier. rarity sets the pacing row (PACE) and the name pill gems; zone / base / amp / speed / jit /
// lunge / secs / drain as DIFF; spring = self-centring (heavy = steady); kg = weight tag.
const PROFILE = {
  crate: { name: 'Wooden Crate', rarity: 'common', zone: 0.3, base: 0.42, amp: 0.26, speed: 0.8, jit: 0.1, lunge: 0.03, secs: 9, drain: 0.04, spring: 0.45 },
  iron: { name: 'Iron Crate', rarity: 'uncommon', zone: 0.26, base: 0.82, amp: 0.07, speed: 0.22, jit: 0, lunge: 0, secs: 12, drain: 0.04, spring: 0.6 },
  golden: { name: 'Golden Crate', rarity: 'rare', zone: 0.24, base: 0.7, amp: 0.15, speed: 0.42, jit: 0.04, lunge: 0.04, secs: 14, drain: 0.05, spring: 0.4 },
  orb: { name: 'Mystery Orb', rarity: 'epic', zone: 0.22, base: 0.5, amp: 0.32, speed: 0.95, jit: 0.12, lunge: 0.08, secs: 15, drain: 0.055, spring: 0.2 },
};
const KIND = {
  crate: { amp: 1, speed: 1, secs: 1, base: 1 },
  bottle: { name: 'Message Bottle', amp: 1.25, speed: 1.2, secs: 0.8, base: 0.85 },
  capsule: { name: 'Aero Capsule', amp: 1.1, speed: 1.1, secs: 0.9, base: 0.95 },
  orb: { amp: 1, speed: 1, secs: 1, base: 1 },
};
const WOOD = { body: '#c8925a', belly: '#ffe2b0', back: '#7a4a24' };
const COLS = { crate: WOOD, iron: { body: '#9aaabc', belly: '#f0f8ff', back: '#4a5868' }, golden: { body: '#ffd04a', belly: '#fff8c8', back: '#b8780e' }, orb: { body: '#b48aff', belly: '#f4e8ff', back: '#5a2ab0' } };

// ------------------------------------------------------------------ the proxy
export class CrateFish {
  constructor(F, f) {
    this.box = f; this.crate = true;
    const P = PROFILE[f.tier] || PROFILE.crate, K = KIND[f.kind] || KIND.crate;
    this.sp = {
      id: 'crate:' + (f.tier || 'crate'), name: K.name || P.name, rarity: P.rarity, crate: true, sound: 'box_close',
      fight: { power: f.tier === 'iron' || f.tier === 'golden' ? 0.6 : 0.35, stamina: 5, fakeBite: 0, biteWindow: 0.6 },
      look: { col: COLS[f.tier] || WOOD, body: { len: 16 } }, scale: 1,
    };
    this.rec = { weightKg: 1 };
    this.scale = 1; this.alpha = 1; this.facing = 1; this.squashV = 0; this.wiggle = 0; this.cooldown = 0;
    this.controlled = true; this.allowTurn = true; this.vx = 0; this.vy = 0; this.boss = null; this.cruise = 0;
  }
  get x() { return this.box.x; } set x(v) { this.box.x = v; }
  get y() { return this.box.y; } set y(v) { this.box.y = v; }
  get z() { return this.box.z; } set z(v) { this.box.z = v; }
  get anchors() { return { mouth: [this.box.x, this.box.y - 7] }; }
  feel() {} say() {} lookAt() {}
}

// ------------------------------------------------------------------ the fight
export class CrateBattle extends Battle {
  constructor(F) {
    super(F);
    const f = this.fish.box;
    this.box = f; this.crate = true;
    this.surprise = f.surprise || null;
    const P = PROFILE[f.tier] || PROFILE.crate, K = KIND[f.kind] || KIND.crate;
    this.P = P;
    const ctl = this.control, st = F.stats || {};
    const reelStat = 0.7 + 0.3 * ((st.reelSpeed ?? 34) / 34), tire = Math.sqrt(st.staminaDrain ?? 1);
    this.heavy = 0;
    this.zoneW = clamp(P.zone * Math.pow(ctl, 0.5) * Math.pow(st.traceRadius ?? 1, 0.5), 0.12, 0.42);
    this.pullBase = P.base * K.base;
    this.pullAmp = P.amp * K.amp / Math.sqrt(ctl);
    this.pullSpeed = P.speed * K.speed;
    this.jitAmp = P.jit;
    this.lungeRate = P.lunge;
    this.spring = P.spring;
    this.secs = P.secs * K.secs / (reelStat * tire);
    this.drainRate = P.drain * (1 - this.resil * 0.6);
    this.progress = 0.12; this.ghost = this.progress;
    this.wobK = f.tier === 'iron' ? 0.25 : f.tier === 'golden' ? 0.5 : 1; // light crates rock, heavy ones barely
    // surprises
    this.legsT = this.surprise === 'legs' ? rng.float(1.2, 3.5) : -1;
    this.mimicAt = this.surprise === 'mimic' ? (rng.chance(0.45) ? 0 : rng.float(0.25, 0.4)) : -1;
    this.revealed = false; this.sprout = null; this.reveal = null;
    this.shield = false; this.shieldDone = false; this.shieldK = 0;
    this.chompT = rng.float(3, 4.5); this.chompTele = 0; this.chompK = 0;
    this.titleT = -1; this.titleText = '';
    f.legs = 0; f.mimic = 0; f.peek = 0; f.hop = 0; f.tellK = undefined; f.rollCtl = true; f.walk = f.walk || 0;
  }

  get shielded() { return this.shield; }
  get canCharge() { return super.canCharge && !this.reveal && !this.sprout; }

  markerIcon(w, h) { return crateIcon(this.box, h); }

  cancel() { const f = this.box; f.hooked = false; f.rollCtl = false; f.legs = 0; f.mimic = 0; f.shield = false; }

  update(dt) {
    const F = this.F, f = this.box;
    this.titleT = this.titleT >= 0 ? this.titleT + F.rdt : -1;
    if (this.reveal) return this.updateReveal(dt);
    if (this.sprout) return this.updateSprout(dt);
    if (this.mode !== 'hookset') {
      if (this.legsT >= 0 && !this.revealed) { this.legsT -= dt; if (this.legsT <= 0) this.startSprout(); }
      if (this.mimicAt >= 0 && !this.revealed && this.progress >= this.mimicAt) this.startReveal();
      if (this.revealed && this.surprise === 'mimic' && !this.shieldDone && this.progress >= 0.5) this.raiseShield();
    }
    const r = super.update(dt);
    if (this.surprise === 'mimic' && this.revealed) this.updateChomp(dt);
    // the floater's look
    if (this.surprise === 'legs' && this.revealed) {
      f.legs = Math.min(1, f.legs + dt * 3);
      f.walk += dt * (7 + Math.abs(this.mv) * 16 + (this.lunge ? 10 : 0));
    }
    if (this.surprise === 'mimic' && this.revealed) {
      this.shieldK = damp(this.shieldK, this.shield ? 1 : 0, 8, dt);
      const want = this.shield ? 0 : this.chompTele > 0 ? 1 : this.chompK > 0 ? 0.12 : 0.45 + 0.12 * Math.sin(this.t * 3.1);
      f.mimic = damp(f.mimic, want, this.chompK > 0 ? 30 : 8, dt);
      f.shield = this.shield && f.mimic < 0.05;
      f.chomp = this.stunned ? 0 : f.chomp;
    }
    f.flash = Math.max(f.flash || 0, this.stunned ? 0.5 : 0);
    const roll = (this.mv * 6 + this.jit * 24 + Math.sin(this.t * 3.3) * 5 + (this.lunge?.stage === 'go' ? this.lunge.dir * 9 : 0)) * this.wobK;
    f.roll = clamp(damp(f.roll || 0, roll, 6, dt), -14, 14);
    return r;
  }

  // ---- LEGS?!
  startSprout() {
    const F = this.F, f = this.box;
    this.revealed = true;
    this.sprout = { t: 0 };
    this.lunge = null; this.beat = null;
    F.sfx('crab_scuttle', { vol: 0.9, pitch: 1.2 });
    F.sfx('boing', { vol: 0.6, pitch: 1.3 });
    F.shake(4);
    F.particles.pixelBurst?.('puff', f.x, f.y + 6, 6, { ramp: 'white', w: 8 });
    F.particles.aeroBubbles?.(f.x, f.y, 6, { w: 8 });
    this.titleText = 'LEGS?!'; this.titleT = 0;
  }

  updateSprout(dt) {
    const F = this.F, f = this.box, S = this.sprout;
    S.t += F.rdt;
    f.hop = Math.sin(clamp01(S.t / 0.5) * Math.PI) * 6;
    f.legs = clamp01((S.t - 0.15) / 0.45);
    f.walk += dt * 20;
    this.marker = damp(this.marker, -0.25, 3, dt); this.mv = 0;
    this.tension = damp(this.tension, 0.5, 4, dt);
    F.focusCam(f.x, f.y, F.fightZoom() + 0.25, 3);
    if (S.t > 1) {
      this.sprout = null; f.hop = 0; f.legs = 1;
      // the crate is a runner now: erratic, sideways lunges, a quicker drain
      this.pullSpeed *= 1.7; this.pullAmp *= 1.25; this.jitAmp += 0.22; this.lungeRate = Math.max(this.lungeRate, 0.32);
      this.drainRate *= 2; this.teleMul *= 0.7; this.spring *= 0.5; this.wobK = Math.max(this.wobK, 0.8);
      this.lungeCool = 0.6;
    }
    return 'ok';
  }

  // ---- MIMIC!
  startReveal() {
    const F = this.F, f = this.box;
    this.revealed = true;
    this.reveal = { t: 0 };
    this.lunge = null; this.beat = null;
    F.cam?.slowmo?.(0.35, 1.1);
    F.cam?.flash?.('#ff8a7a', 0.35);
    F.shake(10);
    F.sfx('box_open', { vol: 1, pitch: 0.7 });
    F.sfx('roar', { vol: 0.8, pitch: 1.7 });
    F.particles.pixelBurst?.('shard', f.x, f.y - 6, 10, { ramp: 'red', speed: [60, 160] });
    F.particles.aeroBubbles?.(f.x, f.y - 4, 8, { w: 8 });
    F.titles.clear?.();
    this.titleText = 'MIMIC!'; this.titleT = 0;
  }

  updateReveal(dt) {
    const F = this.F, f = this.box, R = this.reveal;
    R.t += F.rdt;
    const k = R.t;
    // the lid creaks, then flies open; two snaps at the camera
    f.mimic = k < 0.35 ? 0.15 + Math.sin(k * 60) * 0.05 : k < 0.6 ? clamp01((k - 0.35) / 0.25) : k < 1.6 ? (Math.floor((k - 0.6) * 5) % 2 ? 0.2 : 1) : 0.6;
    f.hop = k < 0.6 ? Math.abs(Math.sin(k * 40)) * 1.5 : 0;
    if (k > 0.6 && !R.snap1) { R.snap1 = true; F.sfx('gulp', { vol: 0.9, pitch: 0.6 }); F.shake(6); }
    if (k > 1.0 && !R.snap2) { R.snap2 = true; F.sfx('gulp', { vol: 0.9, pitch: 0.5 }); F.shake(6); F.particles.aeroBubbles?.(f.x, f.y - 8, 5, { w: 6 }); }
    this.marker = damp(this.marker, 0, 2, dt); this.mv = 0;
    this.tension = damp(this.tension, 0.6, 4, dt);
    F.focusCam(f.x, f.y - 6, F.fightZoom() + 0.7 * clamp01(k * 3), 4);
    if (k > 2.3) {
      this.reveal = null;
      // a mini-boss: narrower zone, a harder, jumpier pull, a longer bar; it bit back a little
      this.zoneW = clamp(this.zoneW * 0.85, 0.14, 0.4);
      this.pullBase += 0.1; this.pullAmp += 0.08; this.pullSpeed *= 1.3; this.jitAmp += 0.08; this.lungeRate = Math.max(this.lungeRate, 0.08);
      this.spring *= 0.5; this.secs *= 1.45; this.drainRate *= 1.3;
      this.progress = Math.max(0.05, this.progress - 0.06);
      this.chompT = rng.float(2.5, 3.5);
      F.titles.banner?.('MINI-BOSS', '#ff8a7a', '', { pal: 'red' });
      F.sfx('notify', { pitch: 0.7 });
    }
    return 'ok';
  }

  // CHOMP: telegraph (the lid gapes, a 3D CHOMP!), then it snaps shut and knocks the marker toward the edge it leans to.
  updateChomp(dt) {
    const F = this.F, f = this.box;
    this.chompK = Math.max(0, this.chompK - dt * 4);
    if (this.shield || this.stunned || this.beat || this.reveal) { this.chompTele = 0; return; }
    if (this.chompTele > 0) {
      this.chompTele -= dt;
      if (this.chompTele <= 0) {
        const side = this.marker >= 0 ? 1 : -1;
        this.marker = clamp(this.marker + side * 0.5, -1, 1);
        this.mv = side * 1.2;
        this.progress = Math.max(0, this.progress - 0.025);
        this.chompK = 1;
        f.mimic = 0.1;
        F.sfx('gulp', { vol: 1, pitch: 0.55 });
        F.sfx('box_close', { vol: 0.8, pitch: 0.7 });
        F.shake(7);
        F.meterShake = 1;
        F.particles.aeroBubbles?.(f.x, f.y - 6, 6, { w: 6 });
        F.particles.pixelBurst?.('shard', f.x, f.y - 6, 5, { ramp: 'white', speed: [40, 100] });
        this.chompT = rng.float(3.2, 5.5);
      }
      return;
    }
    this.chompT -= dt;
    if (this.chompT <= 0 && !this.lunge) {
      this.chompTele = 0.75 * this.teleMul;
      const [sx, sy] = F.toScreen(f.x, f.y);
      F.titles.pop('CHOMP!', sx, sy - 46, '#ff8a7a', { scale: 2.2 });
      F.sfx('grunt', { vol: 0.5, pitch: 0.8 });
    }
  }

  raiseShield() {
    const F = this.F, f = this.box;
    this.shield = true; this.shieldDone = true;
    this.lunge = null;
    if (this.charges <= 0) { this.charges = 1; this.shockCd = 0; }
    F.sfx('box_close', { vol: 1, pitch: 0.5 });
    F.sfx('static_burst', { vol: 0.5, pitch: 0.7 });
    F.shake(6);
    F.cam?.flash?.('#bfe8ff', 0.25);
    F.titles.banner?.('LOCKED! ZAP IT OPEN', '#9ad8ff', '', { pal: 'aqua' });
    F.particles.pixelBurst?.('sparkle', f.x, f.y, 10, { ramp: 'cyan', w: 10, h: 8 });
  }

  // ---- overrides of the shared fight
  updateProgress(dt) {
    if (this.shield) {
      if (!this.inZone && !this.beat) this.progress = Math.max(0, this.progress - this.drainRate * 0.5 * dt);
      return;
    }
    super.updateProgress(dt);
  }

  updateShock(dt) {
    super.updateShock(dt);
    // a shield wants a shock: the beat comes quickly and a charge is handed over
    if (this.shield && !this.beat && !this.zap && !this.stunned && this.beatCool <= 0) {
      if (this.charges <= 0) { this.charges = 1; this.shockCd = 0; }
      if (this.readyT > 0.8 && this.canCharge) this.startBeat();
    }
  }

  hit(grade) {
    const F = this.F, f = this.box;
    const wasShield = this.shield;
    super.hit(grade);
    f.flash = 1;
    if (wasShield) {
      this.shield = false;
      f.shield = false;
      this.progress = Math.min(0.99, this.progress + 0.04);
      F.sfx('ice_crack', { vol: 1, pitch: 0.8 });
      F.particles.pixelBurst?.('shard', f.x, f.y, 14, { ramp: 'cyan', speed: [80, 200] });
      const [sx, sy] = F.toScreen(f.x, f.y);
      F.titles.pop('CRACKED!', sx, sy - 60, '#bff8ff', { scale: 3 });
    }
  }

  checks(dt) {
    if (this.shield && this.progress >= 0.995) this.progress = 0.995;
    return super.checks(dt);
  }

  moveFish(dt) {
    super.moveFish(dt);
    // a legs crate scuttles side to side; anything shivers while zapped
    if (this.surprise === 'legs' && this.revealed && !this.stunned) {
      const f = this.box;
      this.place(f.x + Math.sin(this.t * 9) * 2.5 + (this.lunge?.stage === 'go' ? this.lunge.dir * 1.5 : 0), f.y + Math.abs(Math.sin(this.t * 12)) * -1.2);
    }
  }

  // ---- drawing
  drawWorld(ctx) {
    const f = this.box;
    if (!f.selfDraw) return;
    const spr = boxSprite(f.kind, f.tier);
    ctx.save();
    ctx.translate(Math.round(f.x), Math.round(f.y));
    ctx.rotate(((f.roll || 0) * Math.PI) / 180);
    ctx.drawImage(spr, -Math.floor(spr.width / 2), -Math.floor(spr.height / 2));
    ctx.restore();
  }

  drawHud(ctx) {
    const F = this.F, t = this.titleT;
    if (t < 0) return;
    const W = F.W, H = F.H;
    if (this.titleText === 'MIMIC!') {
      if (t > 2.6) { this.titleT = -1; return; }
      const a = clamp01((2.6 - t) * 3);
      ctx.save();
      ctx.globalAlpha = a;
      const jx = t < 0.3 ? rng.int(-3, 3) : 0;
      const landed = letters3D(ctx, 'MIMIC!', W / 2 + jx, Math.round(H * 0.24), t, { pal: 'red', scale: W < 700 ? 2.2 : 2.8, drop: 180, stagger: 0.07 });
      for (const [lx, ly, i] of landed) {
        if (this['land' + i]) continue;
        this['land' + i] = true;
        F.fx.pixelBurst?.('shard', lx, ly + 20, 4, { ramp: 'red', speed: [40, 120], layer: 'fg' });
        F.sfx('mash_pop', { pitch: 0.7 + i * 0.06, vol: 0.5 });
      }
      if (t > 0.8) word3D(ctx, 'IT BITES!', W / 2, Math.round(H * 0.24 + 62), { t, pop: clamp01((t - 0.8) * 4), scale: W < 700 ? 0.9 : 1.1, pal: 'sun', wobble: 1 });
      ctx.restore();
    } else {
      if (t > 1.5) { this.titleT = -1; return; }
      const f = this.box;
      const [sx, sy] = F.toScreen(f.x, f.y);
      ctx.save();
      ctx.globalAlpha = clamp01((1.5 - t) * 3);
      word3D(ctx, this.titleText, clamp(sx, 120, W - 120), clamp(sy - 70 - ease.outCubic(clamp01(t * 3)) * 20, 80, H - 140), { t: t * 2, pop: clamp01(t * 5), scale: 1.6, pal: 'sun', rot: Math.sin(t * 9) * 0.08, wobble: 1.4 });
      ctx.restore();
    }
  }
}

// ------------------------------------------------------------------ landing: out of the water and up to the rod
export class CratePop {
  constructor(F, f, B = null) {
    this.F = F; this.f = f;
    this.t = 0; this.gearMode = 'pop'; this.progress = 1; this.tension = 0.2;
    this.surprise = B?.surprise || f.surprise || null;
    const w = F.world;
    this.surface = w.surfaceY !== null && w.surfaceY !== undefined ? w.surfaceY : null;
    this.p0 = [f.x, f.y];
    f.hooked = true; f.rollCtl = true; f.shield = false; f.flash = 0;
    if (this.surprise === 'mimic') f.mimic = 0.7;
    const sy = this.surface ?? f.y;
    F.particles.eruption?.(f.x, sy, 0.9);
    F.particles.splashBurst?.(f.x, sy, 1);
    F.sfx('splash_big', { vol: 0.7 });
    F.sfx('jump_out', { pitch: 1.2 });
    F.shake(4);
    F.setPose('yank', 0.35);
    const [sx, sy2] = F.toScreen(f.x, f.y);
    if (this.surprise === 'mimic') F.titles.add('igotit', 'MIMIC TAMED!', { rarity: 'epic', pal: 'sun' });
    else if (this.surprise === 'legs') F.titles.pop('GOTCHA!', sx, sy2 - 50, '#c8f56a', { scale: 3 });
    else F.titles.pop('LANDED!', sx, sy2 - 50, '#c8f56a', { scale: 2.4 });
  }

  crankHint() { const [sx, sy] = this.F.toScreen(this.f.x, this.f.y); return [sx, sy]; }
  cancel() { this.f.hooked = false; this.f.rollCtl = false; }

  update(dt) {
    const F = this.F, f = this.f;
    this.t += dt;
    const u = clamp01(this.t / 0.75);
    const [rx] = F.rodTip();
    const hx = lerp(this.p0[0], rx, 0.6), hy = (this.surface ?? this.p0[1]) - 30;
    const apex = Math.min(this.p0[1], hy) - 46;
    const mx = (this.p0[0] + hx) / 2;
    f.x = (1 - u) * (1 - u) * this.p0[0] + 2 * (1 - u) * u * mx + u * u * hx;
    f.y = (1 - u) * (1 - u) * this.p0[1] + 2 * (1 - u) * u * apex + u * u * hy;
    f.roll = Math.sin(this.t * 14) * 14;
    if (this.surprise === 'legs') f.walk = (f.walk || 0) + dt * 24; // legs still flailing
    if (this.surprise === 'mimic') f.mimic = Math.floor(this.t * 8) % 2 ? 0.2 : 0.8; // still chattering
    if (rng.chance(dt * 30)) F.particles.droplets?.(f.x, f.y, 1, { dir: Math.PI / 2, spread: 1, speed: [10, 40], g: 260 });
    F.focusCam(f.x, f.y, 1.7, 4);
    return u >= 1 ? 'caught' : 'ok';
  }

  drawWorld(ctx) {
    const f = this.f;
    if (!f.selfDraw) return;
    const spr = boxSprite(f.kind, f.tier);
    ctx.save();
    ctx.translate(Math.round(f.x), Math.round(f.y));
    ctx.rotate(((f.roll || 0) * Math.PI) / 180);
    ctx.drawImage(spr, -Math.floor(spr.width / 2), -Math.floor(spr.height / 2));
    ctx.restore();
  }
  drawHud() {}
  drawBands() {}
}

// ------------------------------------------------------------------ the getaway
const RUN_TAUNTS = ['NOPE!', 'BYE!', 'SEE YA!', 'TOO SLOW!'];
export class CrateEscape {
  constructor(F, f, reason, line, surprise) {
    this.F = F; this.f = f; this.reason = reason; this.line = line; this.surprise = surprise;
    this.t = 0; this.blocksHook = true;
    this.dir = rng.sign();
    this.taunt = rng.pick(RUN_TAUNTS);
    this.hook = { x: line.x1, y: line.y1, vx: this.dir * -40, vy: -140, a: 0 };
    f.hooked = true; f.rollCtl = true; f.shield = false;
    F.setPose('sad');
    if (reason === 'snap') { F.titles.add('snap', 'SNAP!', { seed: rng.int(1, 9999) }); F.shake(8); F.sfx('line_snap'); }
    else F.titles.add('escape', surprise === 'legs' ? 'IT RAN OFF!' : surprise === 'mimic' ? 'IT GOT AWAY!' : 'BYE...');
    if (surprise === 'legs') { f.legs = 1; F.sfx('crab_scuttle', { vol: 1, pitch: 1.4 }); }
    F.cam?.slowmo?.(0.6, 0.6);
    const g = F.game;
    let floor = null;
    try { floor = g.ocean?.floorUnder?.(f.x, f.y, f.z); } catch { floor = null; }
    this.floor = Number.isFinite(floor) ? floor - 8 : f.y + 60;
    this.y0 = f.y;
  }

  update(dt, rdt) {
    const F = this.F, f = this.f, t = (this.t += rdt);
    const h = this.hook;
    h.vy += 300 * dt; h.x += h.vx * dt; h.y += h.vy * dt; h.a += dt * 14;
    if (this.surprise === 'legs') {
      // drop to the seabed, then leg it across, little hops and dust puffs
      if (t < 0.45) { f.y = lerp(this.y0, this.floor, ease.inQuad(clamp01(t / 0.45))); f.walk += dt * 10; }
      else {
        if (!this.landed) { this.landed = true; F.particles.pixelBurst?.('dust', f.x, this.floor + 6, 8, { speed: [30, 80] }); F.sfx('boing', { pitch: 1.5, vol: 0.6 }); }
        const sp = Math.min(220, (t - 0.45) * 400);
        f.x += this.dir * sp * dt;
        let fl = this.floor;
        try { const v = F.game.ocean?.floorUnder?.(f.x, f.y, f.z); if (Number.isFinite(v)) fl = v - 8; } catch { /* keep */ }
        this.floor = damp(this.floor, fl, 8, dt);
        f.y = this.floor - Math.abs(Math.sin(t * 16)) * 3;
        f.walk += dt * 30;
        f.roll = -this.dir * 8 + Math.sin(t * 30) * 4;
        if (rng.chance(dt * 16)) F.particles.pixelBurst?.('dust', f.x - this.dir * 8, this.floor + 6, 1, { speed: [10, 40] });
        if (rng.chance(dt * 3)) F.sfx('crab_scuttle', { vol: 0.5, pitch: 1.3 + Math.random() * 0.4 });
      }
      F.focusCam(f.x, f.y - 10, 2, 3);
    } else if (this.surprise === 'mimic') {
      // a mocking chomp-chomp, then it sinks off into the dark, lid clapping
      f.mimic = Math.floor(t * 7) % 2 ? 0.15 : 0.85;
      if (t > 1.2) { f.y += 50 * dt; f.x += this.dir * 30 * dt; }
      if (Math.floor(t * 7) !== this.lastClap) { this.lastClap = Math.floor(t * 7); if (t < 1.2) F.sfx('gulp', { vol: 0.4, pitch: 1.4 }); }
      F.focusCam(f.x, f.y - 6, 2.1, 3);
    } else {
      f.y += 26 * dt; f.x += this.dir * 12 * dt;
      f.roll = Math.sin(t * 2) * 10;
      if (rng.chance(dt * 6)) F.particles.aeroBubbles?.(f.x, f.y - 6, 1, { w: 4 });
      F.focusCam(f.x, f.y, 1.9, 2);
    }
    if (t > 2.4) { this.finish(); return 'done'; }
    return 'ok';
  }

  finish() {
    const F = this.F, f = this.f;
    f.hooked = false; f.rollCtl = false; f.out = true;
    f.y0 = f.y; f.surface = false;
    if (this.surprise === 'legs') { f.running = true; f.vx = this.dir * 200; }
    else f.vx = this.dir * 10;
    F.cam?.release?.(2.4);
    F.cam?.setLetterbox?.(false);
    F.restoreScroll();
    F.setPose('idle');
    F.game.emit?.('boxEscaped', { box: f, reason: this.reason, surprise: this.surprise });
  }

  drawWorld(ctx) {
    const h = this.hook;
    if (this.t < 1.4) {
      ctx.save();
      ctx.translate(Math.round(h.x), Math.round(h.y));
      ctx.rotate(h.a);
      ctx.drawImage(HOOK, -3, -5);
      ctx.restore();
    }
  }

  drawHud(ctx) {
    const F = this.F, f = this.f, t = this.t;
    if (t < 0.5 || t > 2.2) return;
    const [sx, sy] = F.toScreen(f.x, f.y);
    ctx.save();
    ctx.globalAlpha = clamp01((2.2 - t) * 4) * clamp01((t - 0.5) * 5);
    const text = this.surprise === 'mimic' ? 'NOM NOM!' : this.surprise === 'legs' ? this.taunt : '';
    if (text) word3D(ctx, text, clamp(sx + 20, 100, F.W - 100), clamp(sy - 46, 60, F.H - 100), { t: t * 3, pop: clamp01((t - 0.5) * 5), scale: 1, pal: 'white', rot: Math.sin(t * 9) * 0.1 });
    ctx.restore();
  }
}

export { TAU, PACE, DIFF };
