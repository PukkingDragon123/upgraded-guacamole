// A living fish: steering-based AI with states, personality, quirks and emotions.
// Rendering is delegated to the layered rig (gfx/fishrig.js).

import { TAU, clamp, clamp01, lerp, dist, angleDiff, damp, rectContains } from '../core/math.js';
import { rng } from '../core/rng.js';
import { compiled } from '../gfx/spritecache.js';
import { drawFishRig } from '../gfx/fishrig.js';
import { sizeScaleOf, personalityOf } from './traits.js';

const SPEED = 1.5; // world speed multiplier for the 960px canvas

const EMOTE_TIME = 1.6;

export class Fish {
  constructor(rec, species, world, opts = {}) {
    this.rec = rec;
    this.sp = species;
    this.world = world;
    this.id = rec.uid;
    this.c = compiled(species.look, rec.variant, species.id);
    this.scale = sizeScaleOf(rec, species);
    const pers = personalityOf(rec);
    const t = species.traits || {};
    this.curiosity = clamp01((t.curiosity ?? 0.5) + (pers.curiosity || 0));
    this.shyness = clamp01((t.shyness ?? 0.4) + (pers.shyness || 0));
    this.greed = clamp01((t.greed ?? 0.5) + (pers.greed || 0));
    this.aggression = clamp01((t.aggression ?? 0.2) + (pers.aggression || 0));
    this.energy = clamp(1 + (pers.energy || 0), 0.5, 1.5);
    this.social = clamp01(0.4 + (pers.social || 0));
    const m = species.move || {};
    this.style = species.look?.kind === 'chain' ? 'chain' : m.style || 'swim';
    this.cruise = (m.speed ?? 16) * SPEED * this.energy;
    this.burst = (m.burst ?? 70) * SPEED;
    this.agility = m.agility ?? 3;
    this.depth = m.depth || [0.15, 0.85];
    this.school = m.school || 0;
    this.quirks = new Set(species.quirks || []);

    this.x = opts.x ?? 0; this.y = opts.y ?? 0; this.z = opts.z ?? rng.float(0, 0.8);
    this.vx = 0; this.vy = 0; this.vz = 0;
    this.facing = rng.sign(); this.turn = this.facing; this.turning = 0;
    this.angle = 0;
    this.swimPhase = rng.next(); this.tailPhase = rng.next(); this.finPhase = rng.next();
    this.squash = 0; this.squashV = 0;
    this.bob = 0;
    this.blink = 0; this.blinkT = rng.float(1, 4);
    this.mouth = 0; this.talkT = 0; this.chompT = 0;
    this.emotion = 'neutral'; this.emotionT = 0; this.emotionLock = 0;
    this.lookX = null; this.lookY = null;
    this.glanceT = rng.float(1, 3);
    this.inflate = 0; this.inflateHold = 0;
    this.emote = null; // {icon, t}
    this.state = opts.state || 'wander';
    this.stateT = 0;
    this.target = null;
    this.wanderT = 0;
    this.alpha = opts.fadeIn ? 0 : 1;
    this.fadeIn = !!opts.fadeIn;
    this.dead = false;
    this.leaving = false;
    this.cooldown = 0; // bait ignore cooldown
    this.noticeT = rng.float(0.3, 1.2);
    this.controlled = false; // driven by fishing controller
    this.camo = this.quirks.has('camouflage') ? 1 : 0;
    this.posing = false;
    this.carry = null; // stolen icon
    this.age = 0;
    this.hiddenUntil = 0;
    this.hopT = rng.float(0.5, 2);
    this.speechT = 0;
    if (this.style === 'chain') {
      const n = species.look?.chain?.segs ?? 22;
      const spacing = (species.look?.chain?.r ?? 3) * 1.1 * this.scale;
      this.chain = Array.from({ length: n }, (_, i) => ({ x: this.x - i * spacing * this.facing, y: this.y }));
      this.chainSpacing = spacing;
    }
    if (this.style === 'crawl') this.z = rng.float(0, 0.3);
  }

  get rarity() { return this.sp.rarity; }

  setState(s, t = 0) {
    this.state = s;
    this.stateT = t;
    this.target = null;
  }

  // Emotions drive the rig's face; locked emotions persist for a duration.
  feel(emotion, time = 1.5) {
    this.emotion = emotion;
    this.emotionLock = time;
  }

  say(icon, time = EMOTE_TIME) {
    this.emote = { icon, t: 0, max: time };
  }

  talk(time = 0.5) {
    this.talkT = Math.max(this.talkT, time);
  }

  // ------------------------------------------------------------------ helpers
  waterTop() {
    const s = this.world.surfaceY;
    return (s ?? -40) + 10 * this.scale;
  }

  floor(x = this.x) {
    return this.world.floorAt(x) - 6 * this.scale;
  }

  bandY(t) {
    const top = this.waterTop(), bot = this.floor();
    return lerp(top, bot, t);
  }

  pickWanderTarget() {
    const w = this.world;
    const [d0, d1] = this.depth;
    const margin = 20;
    let tx = clamp(this.x + rng.float(-260, 260), margin, w.W - margin);
    if (rng.chance(0.15)) tx = rng.float(margin, w.W - margin);
    const ty = this.bandY(rng.float(d0, d1));
    this.target = { x: tx, y: ty, z: clamp01(this.z + rng.float(-0.4, 0.4)) };
    this.wanderT = rng.float(2, 6) / this.energy;
  }

  steer(tx, ty, speed, arrive = 30) {
    const dx = tx - this.x, dy = ty - this.y;
    const d = Math.hypot(dx, dy) || 1;
    const sp = d < arrive ? speed * (d / arrive) : speed;
    return [(dx / d) * sp, (dy / d) * sp];
  }

  // ------------------------------------------------------------------ update
  update(dt) {
    const w = this.world;
    this.age += dt;
    this.stateT += dt;
    if (this.fadeIn) { this.alpha = Math.min(1, this.alpha + dt * 1.5); if (this.alpha >= 1) this.fadeIn = false; }
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.emotionLock = Math.max(0, this.emotionLock - dt);
    if (this.emote) { this.emote.t += dt; if (this.emote.t > this.emote.max) this.emote = null; }

    let desired = [0, 0];
    let dz = 0;
    if (!this.controlled) {
      desired = this.think(dt);
      if (this.target && this.target.z !== undefined) dz = (this.target.z - this.z) * 0.6;
    }

    if (this.controlled) {
      // position driven externally (fishing); only animate
    } else if (this.style === 'crawl') {
      this.updateCrawl(dt, desired);
    } else if (this.style === 'hop') {
      this.updateHop(dt, desired);
    } else {
      const acc = this.agility * (this.state === 'flee' ? 2.2 : 1);
      this.vx = damp(this.vx, desired[0], acc, dt);
      this.vy = damp(this.vy, desired[1], acc, dt);
      if (this.style === 'drift' || this.quirks.has('pulse')) {
        // jellies move in pulses
        const pulse = Math.max(0, Math.sin(this.swimPhase * TAU));
        this.vy += -pulse * 14 * dt;
        this.vy += 4 * dt; // slow sink
      }
      if (this.inflate > 0.3) { this.vx *= 0.96; this.vy = damp(this.vy, -6, 2, dt); }
      // perspective: far fish move slower on screen
      const persp = 1 - this.z * 0.45;
      this.x += this.vx * dt * persp;
      this.y += this.vy * dt * persp;
      this.vz = damp(this.vz, dz, 1.5, dt);
      this.z = clamp01(this.z + this.vz * dt);
      this.confine(dt);
    }
    if (this.style === 'chain') this.updateChain(dt);

    this.animate(dt);
  }

  confine(dt) {
    const w = this.world;
    const top = this.waterTop();
    const bot = this.floor();
    if (this.state !== 'leave' && this.state !== 'enter') {
      if (this.x < 10) this.vx += (10 - this.x) * 4 * dt;
      if (this.x > w.W - 10) this.vx -= (this.x - (w.W - 10)) * 4 * dt;
    }
    if (this.y < top) { this.y = damp(this.y, top, 6, dt); this.vy = Math.max(this.vy, 0); }
    if (this.y > bot) { this.y = damp(this.y, bot, 6, dt); this.vy = Math.min(this.vy, 0); }
  }

  updateCrawl(dt, desired) {
    // crawlers walk along the seabed (or perch on icons)
    const groundY = this.perch ? this.perch.y - 4 * this.scale : this.world.floorAt(this.x) - 5 * this.scale;
    this.vx = damp(this.vx, desired[0], 4, dt);
    this.x += this.vx * dt;
    if (this.perch && (this.x < this.perch.x || this.x > this.perch.x + this.perch.w)) this.perch = null;
    this.vy = 0;
    this.y = damp(this.y, groundY, 10, dt);
    this.x = clamp(this.x, -30, this.world.W + 30);
  }

  updateHop(dt, desired) {
    const ground = this.world.floorAt(this.x) - 5 * this.scale;
    this.hopT -= dt;
    const onGround = this.y >= ground - 0.5;
    if (onGround) {
      this.vx = damp(this.vx, 0, 6, dt);
      if (this.hopT <= 0 && Math.abs(desired[0]) + Math.abs(desired[1]) > 3) {
        this.vx = Math.sign(desired[0] || this.facing) * rng.float(30, 60) * SPEED;
        this.vy = -rng.float(40, 80) * SPEED;
        this.hopT = rng.float(0.6, 2.2) / this.energy;
        this.squashV -= 6;
      }
    }
    this.vy += 140 * dt; // water-damped gravity
    this.vy *= Math.exp(-1.2 * dt);
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    if (this.y > ground) {
      if (this.vy > 30) this.squashV += this.vy * 0.05;
      this.y = ground; this.vy = 0;
    }
    if (this.y < this.waterTop()) { this.y = this.waterTop(); this.vy = Math.abs(this.vy) * 0.3; }
  }

  updateChain(dt) {
    const ch = this.chain;
    ch[0].x = this.x; ch[0].y = this.y;
    const sp = this.chainSpacing;
    for (let i = 1; i < ch.length; i++) {
      const a = ch[i - 1], b = ch[i];
      // slight sinuous drift
      b.y += Math.sin(this.swimPhase * TAU - i * 0.5) * 0.25;
      const dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.hypot(dx, dy) || 1;
      if (d > sp) { b.x = a.x + (dx / d) * sp; b.y = a.y + (dy / d) * sp; }
    }
  }

  animate(dt) {
    const speed = Math.hypot(this.vx, this.vy);
    const s01 = clamp01(speed / Math.max(10, this.cruise * 1.8));
    this.speed01 = s01;
    const base = this.style === 'crawl' ? 0.6 + s01 * 3 : 0.45 + s01 * 1.6;
    this.swimPhase = (this.swimPhase + dt * base * (this.inflate > 0.3 ? 0.4 : 1)) % 1;
    this.tailPhase = (this.tailPhase + dt * (0.6 + s01 * 3.2)) % 1;
    this.finPhase = (this.finPhase + dt * (1.4 - s01 * 0.6 + (this.state === 'sniff' ? 1.2 : 0))) % 1;

    // facing & turn-around squash
    if (!this.controlled || this.allowTurn) {
      const vx = this.vx;
      if (Math.abs(vx) > 4 && Math.sign(vx) !== this.facing) this.facing = Math.sign(vx);
    }
    this.turn = damp(this.turn, this.facing, 14, dt);
    if (Math.abs(this.turn) < 0.15) this.turn = this.facing * 0.15;

    // pitch from velocity
    let targetA = 0;
    if (this.style !== 'crawl' && this.style !== 'hop' && this.c.kind !== 'jelly' && this.c.kind !== 'pudding' && this.c.kind !== 'seahorse') {
      targetA = clamp(Math.atan2(this.vy, Math.abs(this.vx) + 6), -0.7, 0.7);
    }
    if (this.forceAngle !== undefined) targetA = this.forceAngle;
    this.angle = damp(this.angle, targetA, 5, dt);

    // squash spring
    this.squashV += (-this.squash * 90 - this.squashV * 9) * dt;
    this.squash = clamp(this.squash + this.squashV * dt, -0.5, 0.5);
    this.bob = Math.sin(this.age * 2.1 + this.swimPhase) * (1 - s01) * 0.8;

    // blinking
    this.blinkT -= dt;
    if (this.blinkT <= 0) {
      this.blink = 1;
      this.blinkT = rng.float(1.8, 5.5);
      if (rng.chance(0.15)) this.blinkT = 0.18; // double blink
    }
    this.blink = Math.max(0, this.blink - dt * 8);

    // mouth: talk / chomp / breathe
    this.talkT = Math.max(0, this.talkT - dt);
    this.chompT = Math.max(0, this.chompT - dt);
    let mouth = 0.05 + 0.08 * Math.max(0, Math.sin(this.age * 2.3));
    if (this.talkT > 0) mouth = 0.25 + 0.6 * Math.abs(Math.sin(this.age * 18));
    if (this.chompT > 0) mouth = Math.abs(Math.sin(this.age * 14));
    this.mouth = damp(this.mouth, mouth, 20, dt);

    // inflate decay
    if (this.inflateHold > 0) this.inflateHold -= dt;
    else this.inflate = Math.max(0, this.inflate - dt * 0.35);

    // idle glances
    this.glanceT -= dt;
    if (this.glanceT <= 0) {
      this.glanceT = rng.float(1.2, 4);
      this.glance = rng.chance(0.4) ? { x: this.x + rng.float(-80, 80), y: this.y + rng.float(-40, 40), t: rng.float(0.5, 1.4) } : null;
    }
    if (this.glance) { this.glance.t -= dt; if (this.glance.t <= 0) this.glance = null; }

    // camouflage reveal
    if (this.quirks.has('camouflage')) {
      const c = this.world.cursor;
      const near = c && dist(c.x, c.y, this.x, this.y) < 60;
      this.camo = damp(this.camo, near || this.state === 'flee' || this.controlled ? 0 : 1, 2, dt);
    }
    if (!this.emotionLock) this.emotion = this.baseEmotion();
  }

  baseEmotion() {
    switch (this.state) {
      case 'flee': case 'hide': return 'scared';
      case 'sleep': return 'sleepy';
      case 'curious': return this.quirks.has('googly') ? 'surprised' : 'happy';
      case 'sniff': return 'neutral';
      case 'eat': return 'happy';
      case 'play': return 'happy';
      default: return this.inflate > 0.4 ? 'angry' : 'neutral';
    }
  }

  // ------------------------------------------------------------------ brain
  // Returns desired velocity [vx, vy].
  think(dt) {
    const w = this.world;
    const cur = w.cursor;
    // fear: fast cursor nearby
    if (cur && cur.inWorld && this.state !== 'flee' && this.state !== 'leave') {
      const d = dist(cur.x, cur.y, this.x, this.y);
      const scare = (cur.speed - 260 * (w.calmMul || 1)) / 400;
      if (d < 70 + this.scale * 10 && scare > 0 && this.z < 0.5 && rng.chance(clamp01(scare * (0.4 + this.shyness)) * dt * 12)) {
        this.startle(cur.x, cur.y);
      }
    }
    switch (this.state) {
      case 'enter': return this.thinkEnter(dt);
      case 'wander': return this.thinkWander(dt);
      case 'idle': return this.thinkIdle(dt);
      case 'curious': return this.thinkCurious(dt);
      case 'interest': return this.thinkInterest(dt);
      case 'sniff': return this.thinkSniff(dt);
      case 'flee': return this.thinkFlee(dt);
      case 'hide': return this.thinkHide(dt);
      case 'leave': return this.thinkLeave(dt);
      case 'mimic': return this.thinkMimic(dt);
      case 'commute': return this.thinkCommute(dt);
      case 'steal': return this.thinkSteal(dt);
      case 'script': return this.script ? this.script(this, dt) : [0, 0];
      case 'eat': return this.thinkEat(dt);
      case 'sleep': return this.thinkSleep(dt);
      case 'play': return this.thinkPlay(dt);
      case 'decor': return this.thinkDecor(dt);
      case 'court': return this.thinkCourt(dt);
      default:
        if (this.extraThink) return this.extraThink(dt);
        return this.thinkWander(dt);
    }
  }

  startle(fromX, fromY) {
    if (this.controlled) return;
    this.setState('flee');
    this.fleeFrom = { x: fromX, y: fromY };
    this.feel('scared', 1.5);
    if (this.quirks.has('inflate')) { this.inflate = 1; this.inflateHold = 2.5; this.world.audio?.play('puff', { pitch: 1 / this.scale }); this.squashV += 8; }
    if (this.quirks.has('honk')) this.world.audio?.play('honk', { pitch: rng.float(0.9, 1.1) });
    if (this.quirks.has('ink')) this.world.particles?.burst(this.x, this.y, 18, { colors: ['#1a1024', '#2a1838', '#120a18'], speed: 30, g: -4, drag: 3, life: 2.5, size: 3, layer: 'fg' });
    if (rng.chance(0.5)) this.say('!');
    this.cooldown = 4;
  }

  thinkEnter(dt) {
    const tx = this.enterTarget?.x ?? this.world.W / 2;
    const ty = this.enterTarget?.y ?? this.y;
    if (Math.abs(this.x - tx) < 40 || this.stateT > 6) this.setState('wander');
    return this.steer(tx, ty, this.cruise);
  }

  // ---------------------------------------------------------------- aquarium behaviours
  // The tank world provides: food [{x,y,eaten}], decorSpots [{x,y,kind}], night, onEat(fish, food), onCourt(a, b)
  thinkTankIdle(dt) {
    const w = this.world;
    const rec = this.rec;
    if (w.night && this.sp.activity !== 'night' && rng.chance(dt * 0.4)) { this.setState('sleep'); return true; }
    if (w.food?.length && (rec.hunger ?? 0.5) > 0.15 && rng.chance(dt * (1 + this.greed * 3))) { this.setState('eat'); return true; }
    if (rng.chance(dt * 0.05 * this.energy)) {
      const others = w.fishes.filter((o) => o !== this && !o.controlled);
      if (others.length) { this.playmate = rng.pick(others); this.setState('play'); return true; }
    }
    if (w.decorSpots?.length && rng.chance(dt * 0.04)) { this.decorSpot = rng.pick(w.decorSpots); this.setState('decor'); return true; }
    if (w.canCourt?.(this) && rng.chance(dt * 0.02 * this.social)) {
      const mate = w.fishes.find((o) => o !== this && o.sp === this.sp && w.canCourt(o) && o.state !== 'court');
      if (mate) { this.mate = mate; mate.mate = this; this.setState('court'); mate.setState('court'); return true; }
    }
    return false;
  }

  thinkEat(dt) {
    const food = this.world.food || [];
    let best = null, bd = Infinity;
    for (const f of food) { if (f.eaten) continue; const d = dist(f.x, f.y, this.x, this.y); if (d < bd) { bd = d; best = f; } }
    if (!best || this.stateT > 8) { this.setState('wander'); return [0, 0]; }
    this.lookAt(best.x, best.y);
    if (bd < 6 + 4 * this.scale) {
      best.eaten = true;
      this.chompT = 0.35;
      this.feel('happy', 1.2);
      this.squashV += 5;
      this.world.onEat?.(this, best);
      this.world.audio?.play('gulp', { vol: 0.5, pitch: 1.4 / Math.max(0.6, this.scale) });
      if ((this.rec.hunger ?? 0) <= 0.05 || rng.chance(0.3)) { this.setState('wander'); this.say('heart', 1); }
      return [0, 0];
    }
    return this.steer(best.x, best.y, this.burst * 0.6, 8);
  }

  thinkSleep(dt) {
    const w = this.world;
    if (!w.night || this.stateT > 60) { this.setState('wander'); this.feel('tired', 2); return [0, 0]; }
    if (!this.bed) this.bed = { x: clamp(this.x + rng.float(-40, 40), 30, w.W - 30), y: this.floor() - 4 };
    if (rng.chance(dt * 0.5)) this.say('zzz', 1.5);
    this.feel('sleepy', 0.5);
    return this.steer(this.bed.x, this.bed.y, this.cruise * 0.4, 30);
  }

  thinkPlay(dt) {
    const m = this.playmate;
    if (!m || !this.world.fishes.includes(m) || this.stateT > 5) { this.setState('wander'); return [0, 0]; }
    this.lookAt(m.x, m.y);
    this.feel('happy', 0.3);
    if (rng.chance(dt * 0.8)) this.say(rng.pick(['music', 'heart', '!']), 0.8);
    if (dist(this.x, this.y, m.x, m.y) < 10 && m.state !== 'play') { m.playmate = this; m.setState('play'); m.vx += this.vx; this.setState('wander'); return [0, 0]; }
    return this.steer(m.x, m.y, this.burst * 0.55, 4);
  }

  thinkDecor(dt) {
    const s = this.decorSpot;
    if (!s || this.stateT > 7) { this.setState('wander'); return [0, 0]; }
    const d = dist(this.x, this.y, s.x, s.y);
    if (d < 6) {
      this.hideInDecor = s.kind === 'hide' && this.stateT < 4;
      if (rng.chance(dt * 0.5)) this.say(rng.pick(['heart', 'music', '...']), 1);
      return [Math.sin(this.age * 2) * 3, Math.cos(this.age * 1.6) * 2];
    }
    this.hideInDecor = false;
    return this.steer(s.x, s.y, this.cruise, 20);
  }

  thinkCourt(dt) {
    const m = this.mate;
    if (!m || !this.world.fishes.includes(m) || this.stateT > 9) { this.mate = null; this.setState('wander'); return [0, 0]; }
    this.feel('love', 0.5);
    if (rng.chance(dt * 1.2)) this.say('heart', 1);
    const mx = (this.x + m.x) / 2, my = (this.y + m.y) / 2;
    const ang = this.age * 1.6 + (this.id < m.id ? 0 : Math.PI);
    const tx = mx + Math.cos(ang) * 16, ty = my + Math.sin(ang) * 10;
    if (this.stateT > 6 && this.id < m.id) { this.world.onCourt?.(this, m); this.stateT = 99; }
    return this.steer(tx, ty, this.cruise * 1.2, 10);
  }

  thinkWander(dt) {
    const w = this.world;
    if (w.isTank && this.thinkTankIdle(dt)) return [0, 0];
    this.wanderT -= dt;
    if (!this.target || this.wanderT <= 0 || dist(this.x, this.y, this.target.x, this.target.y) < 12) {
      if (rng.chance(0.25)) { this.setState('idle'); this.idleT = rng.float(1, 3.5); return [0, 0]; }
      this.pickWanderTarget();
    }
    // quirk hooks
    if (this.quirks.has('commuter') && !w.isTank && this.stateT > 2 && rng.chance(dt * 0.12)) { this.setState('commute'); return [0, 0]; }
    if (this.quirks.has('mimic') && w.desktop && this.stateT > 3 && rng.chance(dt * 0.15)) { this.setState('mimic'); return [0, 0]; }
    if (this.quirks.has('thief') && w.desktop && this.stateT > 4 && rng.chance(dt * 0.06)) { this.setState('steal'); return [0, 0]; }
    if (this.quirks.has('forgetful') && rng.chance(dt * 0.15)) {
      this.say('?'); this.feel('surprised', 1); this.facing *= -1; this.vx = -this.vx; this.pickWanderTarget();
    }
    if ((this.quirks.has('googly') || this.curiosity > 0.75) && this.wantsCursor()) { this.setState('curious'); return [0, 0]; }
    // bait attraction
    const bait = !w.isTank && this.noticeBait(dt);
    if (bait) return [0, 0];
    let [vx, vy] = this.steer(this.target.x, this.target.y, this.cruise, 40);
    // separation + schooling
    const [sx, sy] = this.flock();
    return [vx + sx, vy + sy];
  }

  thinkIdle(dt) {
    this.idleT -= dt;
    if (this.idleT <= 0) this.setState('wander');
    if (this.noticeBait(dt)) return [0, 0];
    if (this.wantsCursor()) { this.setState('curious'); return [0, 0]; }
    return [Math.sin(this.age) * 2, Math.cos(this.age * 0.7) * 2];
  }

  wantsCursor() {
    const c = this.world.cursor;
    if (!c || !c.inWorld || c.speed > 120 || this.cooldown > 0 || this.z > 0.5) return false;
    const d = dist(c.x, c.y, this.x, this.y);
    return d < 90 && rng.chance(this.curiosity * 0.02);
  }

  thinkCurious(dt) {
    const c = this.world.cursor;
    this.lookAt(c.x, c.y);
    if (this.stateT > rng.float(2.5, 6) || c.speed > 200 || !c.inWorld) {
      this.setState('wander');
      this.cooldown = 3;
      return [0, 0];
    }
    const keep = 26 + 10 * this.scale;
    const d = dist(c.x, c.y, this.x, this.y);
    const ang = Math.atan2(this.y - c.y, this.x - c.x) + dt * 0.4;
    const tx = c.x + Math.cos(ang) * keep, ty = c.y + Math.sin(ang) * keep * 0.6;
    if (d < keep * 0.7) return this.steer(this.x + (this.x - c.x), this.y + (this.y - c.y), this.cruise);
    this.target = { x: tx, y: ty, z: 0 };
    if (rng.chance(dt * 0.4)) { this.talk(0.4); this.say(rng.pick(['?', 'heart', '!', 'music'])); }
    return this.steer(tx, ty, this.cruise * 0.8, 20);
  }

  // Bait noticing: returns true if the fish switched to 'interest'.
  noticeBait(dt) {
    const w = this.world;
    const h = w.hook;
    if (!h || !h.active || !h.inWater || !h.bait || this.cooldown > 0 || this.inflate > 0.3 || this.posing) return false;
    this.noticeT -= dt;
    if (this.noticeT > 0) return false;
    this.noticeT = rng.float(0.4, 1.1);
    const interest = baitInterest(this.sp, h.bait);
    if (interest <= 0.05) return false;
    const radius = (90 + interest * 70) * (h.radiusMul || 1) * (1 + (w.jig || 0) * 0.6);
    const d = dist(h.x, h.y, this.x, this.y);
    if (d > radius) return false;
    const p = interest * (0.35 + this.curiosity * 0.5 + this.greed * 0.4) * (1 - this.shyness * 0.4 * clamp01(w.cursor.speed / 150));
    if (!rng.chance(clamp01(p))) return false;
    this.setState('interest');
    this.interest = interest;
    this.say(interest > 1.5 ? 'heart' : '?', 1);
    return true;
  }

  thinkInterest(dt) {
    const h = this.world.hook;
    if (!h.active || !h.inWater || !h.bait) { this.setState('wander'); return [0, 0]; }
    this.lookAt(h.x, h.y);
    const side = this.x < h.x ? -1 : 1;
    const mouthOff = 10 * this.scale + 6;
    const tx = h.x + side * mouthOff, ty = h.y + 2;
    this.target = { x: tx, y: ty, z: 0 };
    if (this.world.cursor.speed > 300) { this.startle(h.x, h.y); return [0, 0]; }
    const d = dist(this.x, this.y, tx, ty);
    if (d < 6 && this.z < 0.15) {
      this.setState('sniff');
      this.sniffT = rng.float(1, 2.6) / (0.5 + this.greed);
      this.facing = -side;
      return [0, 0];
    }
    if (this.stateT > 10) { this.setState('wander'); this.cooldown = 5; }
    return this.steer(tx, ty, this.cruise * (0.6 + this.greed * 0.6), 25);
  }

  thinkSniff(dt) {
    const h = this.world.hook;
    if (!h.active || !h.inWater || !h.bait) { this.setState('wander'); return [0, 0]; }
    this.lookAt(h.x, h.y);
    this.facing = h.x > this.x ? 1 : -1;
    this.sniffT -= dt;
    const side = this.x < h.x ? -1 : 1;
    const tx = h.x + side * (10 * this.scale + 5 + Math.sin(this.stateT * 6) * 2), ty = h.y + 2;
    if (this.sniffT <= 0) {
      const p = clamp01(this.interest * 0.4 + this.greed * 0.4 + 0.15);
      if (rng.chance(p) && this.world.requestNibble?.(this)) return [0, 0];
      // reject
      this.say('cross');
      this.feel('disgust', 1.2);
      this.world.audio?.play('blub', { pitch: 0.8 });
      this.cooldown = rng.float(8, 18);
      this.setState('wander');
      this.pickWanderTarget();
      return [0, 0];
    }
    if (this.world.cursor.speed > 220) { this.startle(h.x, h.y); return [0, 0]; }
    return this.steer(tx, ty, this.cruise * 0.6, 10);
  }

  thinkFlee(dt) {
    const f = this.fleeFrom || { x: this.x - this.facing, y: this.y };
    let dx = this.x - f.x, dy = this.y - f.y;
    const d = Math.hypot(dx, dy) || 1;
    dx /= d; dy /= d;
    if (this.stateT > 1.4 + this.shyness) {
      if (this.world.windows?.length && rng.chance(0.5) && !this.world.isTank) this.goHide();
      else this.setState('wander');
      return [0, 0];
    }
    this.z = Math.min(1, this.z + dt * 0.25 * this.shyness);
    return [dx * this.burst, dy * this.burst * 0.6];
  }

  goHide() {
    const wins = this.world.windows;
    let best = null, bd = Infinity;
    for (const r of wins) {
      const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
      const d = dist(cx, cy, this.x, this.y);
      if (d < bd) { bd = d; best = r; }
    }
    if (!best || bd > 400) { this.setState('wander'); return; }
    this.setState('hide');
    this.hideRect = best;
    this.hideT = rng.float(3, 7);
  }

  thinkHide(dt) {
    const r = this.hideRect;
    this.hideT -= dt;
    if (!r || this.hideT <= 0) { this.setState('wander'); this.say('...'); return [0, 0]; }
    // peek: drift toward edge after a while
    const peek = this.hideT < 1.6;
    const tx = peek ? (this.x < r.x + r.w / 2 ? r.x + 4 : r.x + r.w - 4) : r.x + r.w / 2;
    const ty = clamp(this.y, r.y + 8, r.y + r.h - 8);
    if (peek) this.lookAt(this.world.cursor.x, this.world.cursor.y);
    return this.steer(tx, ty, this.cruise * 1.2, 20);
  }

  thinkLeave(dt) {
    const tx = this.x < this.world.W / 2 ? -80 : this.world.W + 80;
    if (this.x < -60 || this.x > this.world.W + 60) this.dead = true;
    this.z = Math.min(1, this.z + dt * 0.05);
    return this.steer(tx, this.y, this.cruise * 1.3, 1);
  }

  thinkCommute(dt) {
    // Mr. Briefcase: 9-5 office hours by the real clock.
    const w = this.world;
    const hour = w.hour ?? 12;
    if (this.stateT > 12) { this.setState('wander'); return [0, 0]; }
    if (hour >= 12 && hour < 13) {
      if (this.stateT < 0.1) { this.say('food'); this.talk(0.6); }
      this.chompT = 0.2;
      return [Math.sin(this.age * 2) * 4, 0];
    }
    const workHours = hour >= 9 && hour < 17;
    const win = workHours ? w.windows?.[0] : null;
    const tx = win ? win.x + win.w + 8 : w.W - 40;
    const ty = win ? win.y + 20 : this.bandY(0.85);
    if (!this.saidCommute) {
      this.saidCommute = true;
      this.say(workHours ? 'clock' : 'moon');
      this.feel(workHours ? 'determined' : 'tired', 2);
    }
    if (dist(this.x, this.y, tx, ty) < 10) {
      // "typing"
      if (rng.chance(dt * 2)) w.particles?.text(this.x, this.y - 12 * this.scale, rng.pick(['tap', 'clack', '...', 'email?', 'meeting!']), { font: 'small', color: '#d8f4ff', life: 1, vy: -10 });
      this.facing = -1;
      return [0, 0];
    }
    return this.steer(tx, ty, this.burst * 0.7, 20);
  }

  thinkMimic(dt) {
    // Shortcut Fish: occupy an empty desktop grid slot and pose as an icon.
    const d = this.world.desktop;
    if (!this.mimicSlot) {
      this.mimicSlot = d?.freeSlot?.();
      if (!this.mimicSlot) { this.setState('wander'); return [0, 0]; }
    }
    const s = this.mimicSlot;
    const at = dist(this.x, this.y, s.x, s.y) < 3;
    if (at) {
      this.posing = true;
      this.z = 0;
      this.facing = 1;
      const c = this.world.cursor;
      const near = c.inWorld && dist(c.x, c.y, this.x, this.y) < 70;
      if (!near && rng.chance(dt * 0.3)) this.wiggle = 0.4;
      if (this.stateT > 40 && !near) { this.posing = false; this.mimicSlot = null; this.setState('wander'); }
      return [0, 0];
    }
    this.posing = false;
    return this.steer(s.x, s.y, this.cruise * 1.2, 30);
  }

  unmask() {
    // double-clicked while posing
    this.posing = false;
    this.mimicSlot = null;
    this.feel('surprised', 1.5);
    this.say('!');
    this.squashV += 10;
    this.world.audio?.play('squeak');
    this.setState('flee');
    this.fleeFrom = { x: this.x - 10, y: this.y };
    this.cooldown = 1;
  }

  thinkSteal(dt) {
    const d = this.world.desktop;
    if (!this.carry) {
      if (!this.stealTarget) {
        this.stealTarget = d?.randomStealable?.();
        if (!this.stealTarget) { this.setState('wander'); return [0, 0]; }
        this.feel('smug', 3);
      }
      const ic = this.stealTarget;
      const tx = ic.x + ic.w / 2, ty = ic.y + ic.h / 2;
      if (dist(this.x, this.y, tx, ty) < 8) {
        if (d.stealIcon(ic, this)) {
          this.carry = ic;
          this.say('$');
          this.world.audio?.play('squeak', { pitch: 1.3 });
        }
        this.stealTarget = null;
        this.setState('leave');
        return [0, 0];
      }
      if (this.stateT > 12) { this.stealTarget = null; this.setState('wander'); }
      return this.steer(tx, ty, this.cruise * 1.1, 20);
    }
    return [0, 0];
  }

  lookAt(x, y) { this.lookX = x; this.lookY = y; this.lookHold = 0.3; }

  flock() {
    let sx = 0, sy = 0, ax = 0, ay = 0, cx = 0, cy = 0, n = 0;
    for (const o of this.world.fishes) {
      if (o === this || o.controlled) continue;
      const dx = this.x - o.x, dy = this.y - o.y;
      const d2 = dx * dx + dy * dy;
      const minD = 14 * (this.scale + o.scale);
      if (d2 < minD * minD && Math.abs(this.z - o.z) < 0.25) {
        const d = Math.sqrt(d2) || 1;
        sx += (dx / d) * (minD - d) * 2;
        sy += (dy / d) * (minD - d) * 2;
      }
      if (this.school > 0 && o.sp === this.sp && d2 < 120 * 120) {
        ax += o.vx; ay += o.vy; cx += o.x; cy += o.y; n++;
      }
    }
    if (n) {
      const k = this.school;
      sx += ((ax / n) - this.vx) * 0.5 * k + ((cx / n) - this.x) * 0.4 * k;
      sy += ((ay / n) - this.vy) * 0.5 * k + ((cy / n) - this.y) * 0.4 * k;
    }
    return [sx, sy];
  }

  // ------------------------------------------------------------------ drawing
  rigState(extra = {}) {
    const c = this.world.cursor;
    let lx = null, ly = null;
    if (this.lookHold > 0 || this.lookX !== null) {
      lx = this.lookX; ly = this.lookY;
    }
    this.lookHold = Math.max(0, (this.lookHold || 0) - 1 / 60);
    if (this.lookHold <= 0) { this.lookX = null; this.lookY = null; }
    if (lx === null && this.glance) { lx = this.glance.x; ly = this.glance.y; }
    if ((this.quirks.has('googly') || this.quirks.has('manyeyes') || this.quirks.has('intro')) && c?.inWorld && lx === null) { lx = c.x; ly = c.y; }
    const sc = this.scale * (1 - this.z * 0.5);
    return {
      x: this.x, y: this.y + this.bob, facing: this.facing, turn: this.turn, angle: this.angle, scale: sc,
      squash: this.squash + (this.wiggle || 0) * Math.sin(this.age * 30) * 0.3,
      swimPhase: this.swimPhase, tailPhase: this.tailPhase, finPhase: this.finPhase, speed01: this.speed01 || 0,
      inflate: this.inflate, lookX: lx, lookY: ly, blink: this.posing ? 0 : this.blink,
      emotion: this.emotion, mouth: this.mouth, time: this.age,
      chain: this.chain, pose: this.posing, ...extra,
    };
  }

  draw(ctx, wash, time) {
    if (this.alpha <= 0) return null;
    if (this.wiggle) this.wiggle = Math.max(0, this.wiggle - 0.02);
    const st = this.rigState({ wash, glow: this.world.glowLevel ?? 0, time });
    let alpha = this.alpha;
    if (this.camo > 0.05) alpha *= 1 - this.camo * 0.8;
    if (this.rec.variant?.mutation === 'ghost') alpha *= 0.65;
    if (alpha < 1) ctx.globalAlpha = alpha;
    const anchors = drawFishRig(ctx, this.c, st);
    ctx.globalAlpha = 1;
    this.anchors = anchors;
    return anchors;
  }
}

// Interest of a species in a bait {kind:'icon'|'special', type}.
export function baitInterest(sp, bait) {
  if (!bait) return 0;
  const prefs = sp.bait || {};
  let v = prefs[bait.type];
  if (v === undefined) v = bait.kind === 'special' ? 0.6 : 0.25;
  if (bait.type === 'golden') v = Math.max(v, { common: 0.4, uncommon: 0.8, rare: 1.6, epic: 2.2, legendary: 2.6 }[sp.rarity] || 1);
  if (bait.type === 'blackhole') v = Math.max(v, 1.4);
  if (bait.type === 'bread') v = Math.max(v, sp.rarity === 'common' ? 1.6 : sp.rarity === 'uncommon' ? 0.7 : 0.2);
  if (bait.type === 'worm') v = Math.max(v, 1.1);
  if (sp.spawn?.requires && sp.spawn.requires !== bait.type) v *= 0.15;
  return v;
}
