// [deep28] Fight personalities for deep-sea fish: one small, readable twist per species on top of the [simple24] meter,
// built only from the meter's own mechanics (grip of the spin, how fast the marker answers, the pull, the zone width,
// lunges) plus a voxel overlay drawn by meter.js (drawTwist). Bosses, crates and the fishing lesson never get one.
//
//   makeTwist(B) -> twist | null          from sp.fight.twist (species-deep28.js) or TWIST_OF (older deep fish)
//   twist.update(dt)                      sets B.grip, B.reactK, B.springK, B.twistPull, B.twistAmp, B.twistSpeed,
//                                         B.twistJit, B.zoneW (from B.zoneW0), B.blind, B.vanta, B.flash, B.alarm,
//                                         B.redFlash, B.wrapK, B.slime
//   twist.onLunge(L) / twist.onHit(grade) hooks from Battle
//   twist.word / twist.wordT / twist.pal   a 3D voxel word over the meter (meter.js)
//
// Twists: slime (hagfish: a slippery marker, slime bursts weaken your grip), blink (firefly squid: the zone goes dark
// for a moment), frenzy (Humboldt: rapid lunges with short warnings), wrap (giant / colossal / bigfin squid: tentacles
// squeeze the zone, a good shock breaks free), dazzle (Dana squid, anglers: a flash, then your reel barely bites),
// ambush (bobbit, lizardfish, frilled / goblin sharks: a lunge right at the start, quicker lunges), alarm (atolla: the
// fight goes wild while the alarm blinks), waddle (sea pig: a steppy, comic pull), vanta (blackdragon: the marker turns
// ultra-black, only its chin light shows), thrash (lancetfish: big jitter), bite (sabertooth, viperfish, loosejaw:
// each lunge bites a little off the catch bar), reverse (Lasiognathus: it reels YOU in for a moment), dive (cusk eel,
// sixgill: a long heavy pull toward the bottom).

import { clamp01 } from '../core/math.js';
import { rng } from '../core/rng.js';

// older deep species (species-deep.js / species.js) that get a personality too
export const TWIST_OF = {
  viperfish: 'bite', loosejaw: 'bite', fangtooth: 'bite', frilledshark: 'ambush', goblinshark: 'ambush', bigfin: 'wrap',
  cockeye: 'blink', vampsquid: 'blink', sixgill: 'dive', seadevil: 'dazzle', angler: 'dazzle', whipnose: 'dazzle',
  dragonfish: 'vanta',
};

// timed events: idle (gap) -> tele (warning) -> on (effect) -> idle. gap [min, max] s, tele s, on s
const EVT = {
  slime: { gap: [6, 9], tele: 0.5, on: 2.2, word: 'SLIMED!', pal: 'leaf', sfx: 'worm_squish' },
  blink: { gap: [5, 8], tele: 0.6, on: 1.3, word: 'BLINK!', pal: 'aqua', sfx: 'sparkle' },
  wrap: { gap: [8, 12], tele: 0.9, on: 3.4, word: 'WRAPPED!', pal: 'coral', sfx: 'grunt' },
  dazzle: { gap: [7, 10], tele: 0.8, on: 1.45, word: 'DAZZLED!', pal: 'sun', sfx: 'golden_shimmer' },
  alarm: { gap: [9, 13], tele: 0.3, on: 2.4, word: 'WEE-WOO!', pal: 'red', sfx: 'sonar' },
  vanta: { gap: [6, 9], tele: 0.5, on: 1.6, word: 'VANTABLACK!', pal: 'violet', sfx: 'whale_call' },
  reverse: { gap: [8, 11], tele: 0.9, on: 1.5, word: "IT'S FISHING YOU!", pal: 'violet', sfx: 'reel' },
  dive: { gap: [9, 12], tele: 0.6, on: 2.4, word: 'DIVE!', pal: 'aqua', sfx: 'grunt' },
};

export function makeTwist(B) {
  const sp = B.sp;
  if (!sp || B.boss || B.gentle || B.isCrate) return null;
  const id = sp.fight?.twist || TWIST_OF[sp.id];
  if (!id) return null;
  return new Twist(B, id);
}

class Twist {
  constructor(B, id) {
    this.B = B; this.id = id;
    this.t = 0; this.stage = 'idle'; this.st = 0;
    const E = EVT[id];
    this.gap = E ? rng.float(E.gap[0], E.gap[1]) * 0.6 : 0; // the first one comes a little sooner
    this.word = null; this.wordT = 0; this.pal = E?.pal || 'white';
    this.k = 0; // effect strength 0..1 (eased in / out)
    B.zoneW0 = B.zoneW;
    B.grip = 1; B.reactK = 1; B.springK = 1; B.twistPull = 0; B.twistAmp = 1; B.twistSpeed = 1; B.twistJit = 0;
    B.blind = 0; B.vanta = 0; B.flash = 0; B.alarm = 0; B.redFlash = 0; B.wrapK = 0; B.slime = 0; B.teleK = 1; B.lungeDurK = 1;
    // constant personalities
    if (id === 'slime') { B.reactK = 0.6; B.springK = 0.45; }
    if (id === 'frenzy') { B.lungeRate = Math.max(B.lungeRate * 2.4, 0.22) + 0.06; B.teleK = 0.6; B.lungeDurK = 0.65; }
    if (id === 'ambush') { B.lungeRate = Math.max(B.lungeRate * 1.3, 0.08); B.teleK = 0.72; this.ambushAt = 0.25; }
    if (id === 'thrash') B.twistJit = 0.16;
    if (id === 'waddle') this.say('OINK?', 'coral', 1.8);
  }

  say(word, pal = this.pal, time = 1.3) { this.word = word; this.pal = pal; this.wordT = time; }

  update(dt) {
    const B = this.B, F = B.F, E = EVT[this.id];
    this.t += dt;
    this.wordT = Math.max(0, this.wordT - dt);
    B.flash = Math.max(0, B.flash - dt * 3.5);
    B.redFlash = B.lunge?.stage === 'go' && this.id === 'frenzy' ? 1 : Math.max(0, B.redFlash - dt * 4);
    if (this.id === 'waddle') B.twistPull = 0.17 * Math.sign(Math.sin(this.t * 2.4)) * (Math.abs(Math.sin(this.t * 2.4)) > 0.25 ? 1 : 0.3);
    if (this.id === 'ambush' && this.ambushAt != null && this.t >= this.ambushAt && !B.lunge && !B.beat) {
      // the strike from below: a lunge with almost no warning, right at the start
      this.ambushAt = null;
      B.lunge = { stage: 'tele', t: 0, tele: 0.45, dir: -1, dur: 1, k: 0 };
      B.fish?.say?.('!!', 0.45); B.fish?.feel?.('angry', 1.2);
      F.sfx?.('bite', { vol: 0.6, pitch: 0.7 });
      this.say('AMBUSH!', 'red', 1.2);
    }
    if (!E) return;
    // the event cycle (it waits for beats and stuns to pass)
    if (this.stage === 'idle') {
      if (B.beat || B.stunned) return this.ease(dt, 0);
      this.gap -= dt;
      if (this.gap <= 0) { this.stage = 'tele'; this.st = 0; this.onTele(); }
    } else {
      this.st += dt;
      if (this.stage === 'tele' && this.st >= E.tele) { this.stage = 'on'; this.st = 0; this.onStart(); }
      else if (this.stage === 'on' && (this.st >= E.on || this.cut)) { this.stage = 'idle'; this.cut = false; this.gap = rng.float(E.gap[0], E.gap[1]); }
    }
    this.ease(dt, this.stage === 'on' ? 1 : 0);
  }

  ease(dt, want) {
    const B = this.B, id = this.id;
    const sp = id === 'wrap' ? (want ? 1.25 : 1.4) : id === 'blink' || id === 'vanta' ? 7 : 5;
    this.k = want > this.k ? Math.min(want, this.k + dt * sp) : Math.max(want, this.k - dt * sp);
    const k = this.k, tele = this.stage === 'tele' ? clamp01(this.st / (EVT[id]?.tele || 1)) : 0;
    switch (id) {
      case 'slime': B.grip = 1 - 0.4 * k; B.reactK = 0.6 - 0.2 * k; B.slime = Math.max(k, 0.35); break;
      case 'blink': B.blind = k; break;
      case 'wrap': B.wrapK = Math.max(k, tele * 0.25); B.zoneW = B.zoneW0 * (1 - 0.4 * k); break;
      case 'dazzle': B.grip = 1 - 0.7 * k; B.dazzleTele = tele; break;
      case 'alarm': B.alarm = Math.max(k, tele); B.twistAmp = 1 + 0.8 * k; B.twistSpeed = 1 + 0.7 * k; break;
      case 'vanta': B.vanta = k; break;
      case 'reverse': B.twistPull = -0.62 * k; B.reverseTele = tele; break; // it pulls toward you: stop spinning and it holds
      case 'dive': B.twistPull = 0.38 * k * clamp01(this.st / 0.6 + (this.stage === 'on' ? 0 : 1)); break;
      default: break;
    }
  }

  onTele() {
    const E = EVT[this.id], B = this.B;
    if (this.id !== 'alarm') this.say(this.id === 'wrap' ? 'WRAP!' : this.id === 'dazzle' ? 'LIGHTS!' : E.word, E.pal, E.tele + 0.6);
    B.F.sfx?.(E.sfx, { vol: 0.4, pitch: this.id === 'reverse' ? 0.7 : 1 });
    if (this.id === 'reverse' || this.id === 'dazzle') B.fish?.say?.('!', E.tele);
  }

  onStart() {
    const B = this.B, F = B.F, f = B.fish;
    if (this.id === 'wrap' || this.id === 'alarm' || this.id === 'dazzle') this.say(EVT[this.id].word, EVT[this.id].pal, 1.4);
    if (this.id === 'dazzle') { B.flash = 1; F.sfx?.('glass_crack', { vol: 0.25, pitch: 1.6 }); }
    if (this.id === 'slime' && f) slimeCloud(F, f, 12);
    if (this.id === 'reverse') this.say('STOP SPINNING!', 'sun', 1.5);
  }

  onLunge(L) {
    const B = this.B, F = B.F;
    if (this.id === 'bite') {
      // each lunge takes a bite out of the catch bar
      B.progress = Math.max(0, B.progress - 0.025);
      F.sfx?.('bite', { vol: 0.5, pitch: 0.9 });
      this.say('CHOMP!', 'red', 0.9);
    } else if (this.id === 'frenzy' && this.t < 30 && !this.frenzySaid) { this.frenzySaid = true; this.say('FRENZY!', 'red', 1.2); }
    else if (this.id === 'thrash' && rng.chance(0.4)) this.say('THRASH!', 'aqua', 0.9);
    void L;
  }

  onHit(grade) {
    // a good shock breaks a wrap
    if (this.id === 'wrap' && this.stage === 'on' && (grade === 'perfect' || grade === 'good')) { this.cut = true; this.say('BROKE FREE!', 'leaf', 1.2); }
    if (this.id === 'slime' && this.stage === 'on' && grade === 'perfect') this.cut = true;
  }

  // the hook set: the hagfish slimes the hook straight away
  onHookset() {
    const B = this.B;
    if (this.id === 'slime' && B.fish) { slimeCloud(B.F, B.fish, 22); this.say('SLIME CLOUD!', 'leaf', 1.6); }
  }
}

// a cloud of hagfish slime: pale, stringy voxel blobs drifting off the fish and the hook (world particles)
export function slimeCloud(F, f, n = 16) {
  const P = F.particles;
  if (!P) return;
  try {
    P.burst?.(f.x, f.y, n, { colors: ['#e8f6dc', '#d4ecc8', '#f4fff0', '#c0dcb8'], speed: 34, g: -3, drag: 2.6, life: 2.6, size: 3, layer: 'fg' });
    P.pixelBurst?.('puff', f.x, f.y, Math.round(n * 0.6), { ramp: 'white', speed: [10, 40], w: 6, h: 4 });
  } catch { /* particles optional */ }
}

