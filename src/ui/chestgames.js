// [chest16] The four crack-it-open minigames of src/ui/chest.js, one per chest tier. Each one drives the bubble
// person's pose and calls back into the panel (P) for the juicy part (P.impact: damage carved into the voxel chest,
// debris, shake, hit-stop, 3D pop text, sounds, Bubbles' reaction). Misses are funny, never punishing: every
// chest opens; a good run earns a bonus (0..2 extra loot rolls).
//
//   HammerGame (crate)  a carnival HIGH-STRIKER next to you: the puck climbs as you wind the hammer up; click / Space
//                       to smash. Gold band = CRACK (2 dmg), green = THWACK, low = a ringing "tink" (the hammer
//                       buzzes in your hands). Clicks during a swing are buffered.
//   PryGame (iron)      wedge the crowbar into the lid seam and MASH (click / Space) to lever it: each full strain
//                       bar pops a seam bolt. The chest bucks now and then ("!" + growl): stop mashing while it
//                       bucks, or the bar springs back and you land on your bum.
//   ChiselGame (golden) RHYTHM: gold glints slide along the rail to the chisel; tap on the beat. Every tap chips
//                       the seam open and plays the next note of a little tune. Off-beat taps hit your thumb.
//   OrbGame (orb)       DRAG to spin the orb, find the glowing weak spot and tap it while it pulses bright; each
//                       tap cracks the glass further (the cracks are painted into the voxel orb and turn with it).
// interface: start(), update(dt, inp, click), draw(ctx, s), pose() -> {pose, t} | null, bonus() -> 0..2,
//            hint() -> {text, icon}, progress() -> 0..1
import { clamp01, lerp } from '../core/math.js';
import { mix } from '../core/color.js';
import { poseT } from '../gfx/chesttools.js';
import { aeroCached, aeroSurface, drawPixelBrackets } from './aero.js';
import { partSprite } from '../build/pixart.js';

const R = Math.random;
const rnd = (a, b) => a + R() * (b - a);
const pick = (a) => a[Math.floor(R() * a.length)];

// ================================================================ crate: the high-striker hammer
export class HammerGame {
  constructor(P) {
    this.P = P;
    this.hp = 6; this.n = 0;
    this.state = 'aim'; this.st = 0;
    this.ph = 0; this.speed = 2.3; this.p = 0;
    this.queued = false;
    this.score = { perfect: 0, good: 0, weak: 0 };
    this.bell = 0; this.puckFly = 0;
    this.fishAt = R() < 0.55 ? (R() < 0.5 ? 1 : 2) : -1;
    this.wiped = false;
    this.behind = true;
    this.newZone();
  }
  newZone() {
    const w = Math.max(0.085, 0.17 - this.n * 0.017);
    const top = rnd(0.86, 0.98);
    this.zone = { a: top - w, b: top };
    this.speed = 2.1 + this.n * 0.22 + rnd(-0.15, 0.2);
  }
  start() {}
  progress() { return clamp01(1 - this.hp / 6); }
  hint() { return { text: 'Click when the puck is in the gold!', icon: 'mouse' }; }
  bonus() { return this.score.perfect >= 3 && this.score.weak === 0 ? 2 : this.score.perfect >= 2 ? 1 : 0; }
  autoClick() { return this.state === 'aim' && this.quality(this.p) === 'perfect'; } // dev autoplay
  quality(p) { return p >= this.zone.a && p <= this.zone.b + 0.015 ? 'perfect' : p >= 0.52 ? 'good' : 'weak'; }
  update(dt, inp, click) {
    const P = this.P;
    this.st += dt;
    this.bell = Math.max(0, this.bell - dt * 2.5);
    this.puckFly = Math.max(0, this.puckFly - dt * 3);
    if (click) { if (this.state === 'aim') this.swing(); else this.queued = true; }
    if (this.state === 'aim') {
      this.ph += this.speed * dt;
      this.p = Math.pow((1 - Math.cos(this.ph)) / 2, 0.85);
      if (this.queued) { this.queued = false; this.swing(); }
    } else if (this.state === 'swing') {
      if (!this.struck && this.st >= 0.15) { this.struck = true; this.strike(); }
      if (this.st >= 0.3) { this.state = this.q === 'weak' ? 'buzz' : 'recover'; this.st = 0; }
    } else if (this.state === 'buzz') {
      if (this.st >= 0.5) { this.state = 'recover'; this.st = 0; }
    } else if (this.state === 'recover') {
      this.p = Math.max(0, this.p - dt * 3.2);
      // a little breather halfway: wipe the bubble, phew
      if (!this.wiped && this.hp <= 3 && this.hp > 0 && this.st < dt * 1.5) { this.wiped = true; P.charBeat('wipe', 1.05); P.sfx('puff', { vol: 0.35, pitch: 1.3 }); }
      if (this.st >= 0.28 && !P.beatBusy() && this.hp > 0) { this.state = 'aim'; this.st = 0; this.ph = 0; this.newZone(); }
    }
    P.spots = [P.chestCentre()];
  }
  swing() {
    this.state = 'swing'; this.st = 0; this.struck = false;
    this.power = this.p; this.q = this.quality(this.p);
    this.P.sfx('hookset', { vol: 0.5, pitch: 0.75 + this.power * 0.35 });
  }
  strike() {
    const P = this.P, q = this.q;
    this.score[q]++;
    if (q === 'perfect') { this.bell = 1; this.puckFly = 1; P.sfx('bell', { vol: 0.55, pitch: 1.0 + this.n * 0.04 }); }
    const dmg = q === 'perfect' ? 2 : q === 'good' ? 1.25 : 0.6;
    this.hp -= dmg; this.n++;
    P.hits = this.n;
    const last = this.hp <= 0;
    P.impact({ power: q === 'perfect' ? 1.7 : q === 'good' ? 1 : 0.4, quality: q, last,
      text: last ? 'SMASH!' : q === 'perfect' ? pick(['CRACK!', 'WHAM!', 'KRAK!']) : q === 'good' ? pick(['THWACK!', 'THUNK!', 'WHUMP!']) : pick(['tink', 'tonk', 'plink']), palette: q === 'perfect' || last ? 'gold' : q === 'good' ? 'white' : 'sky' });
    if (this.n - 1 === this.fishAt) P.fishJoke();
    if (q === 'weak') P.sfx('boing', { vol: 0.45, pitch: 1.2 });
    if (last) P.finish(0.35);
  }
  pose() {
    if (this.state === 'swing') return { pose: 'ck_smash', t: Math.min(this.st, 0.299) };
    if (this.state === 'buzz') return { pose: 'ck_buzz', t: this.st };
    if (this.state === 'recover') return this.st < 0.16 ? { pose: 'ck_smash', t: 0.299 } : { pose: 'ck_wind', t: poseT('ck_wind', 0) };
    return { pose: 'ck_wind', t: poseT('ck_wind', this.p) };
  }
  // the high-striker: a striped post with a scale, a gold bell on top and a puck that rides the wind-up
  draw(ctx, s) {
    const k = s.k, x = Math.round(s.charX - 96 * k), y1 = Math.round(s.floorY - 4), h = Math.round(176 * k), y0 = y1 - h, w = Math.round(14 * k);
    const t = this.P.t;
    // base plate
    ctx.fillStyle = '#3a2412'; ctx.fillRect(x - Math.round(12 * k), y1 - 2, Math.round(24 * k + w), Math.round(7 * k));
    ctx.fillStyle = '#c8925a'; ctx.fillRect(x - Math.round(11 * k), y1 - 1, Math.round(22 * k + w), Math.round(4 * k));
    ctx.fillStyle = '#ecc088'; ctx.fillRect(x - Math.round(11 * k), y1 - 1, Math.round(22 * k + w), 1);
    // post: candy stripes, outline, sheen
    ctx.fillStyle = '#2a1626'; ctx.fillRect(x - 1, y0 - 1, w + 2, h + 2);
    for (let yy = 0; yy < h; yy++) {
      ctx.fillStyle = Math.floor((yy + x * 0.0) / Math.round(10 * k)) % 2 ? '#ff5a6a' : '#fff4ec';
      ctx.fillRect(x, y0 + yy, w, 1);
    }
    ctx.fillStyle = 'rgba(255,255,255,0.45)'; ctx.fillRect(x + 2, y0, 2, h);
    ctx.fillStyle = 'rgba(80,20,40,0.25)'; ctx.fillRect(x + w - 3, y0, 3, h);
    // the track inside: zones
    const tx = x + Math.round(w / 2) - 2, tw = 5;
    const yAt = (p) => Math.round(y1 - 6 - p * (h - 14));
    ctx.fillStyle = '#1e1430'; ctx.fillRect(tx - 1, y0 + 5, tw + 2, h - 9);
    ctx.fillStyle = '#3a3a5a'; ctx.fillRect(tx, yAt(0.52), tw, yAt(0) - yAt(0.52));
    ctx.fillStyle = '#4cd06a'; ctx.fillRect(tx, yAt(1), tw, yAt(0.52) - yAt(1));
    const za = yAt(this.zone.b), zb = yAt(this.zone.a);
    const glint = 0.5 + 0.5 * Math.sin(t * 9);
    ctx.fillStyle = mix('#ffb21a', '#fff2a0', glint); ctx.fillRect(tx - 2, za, tw + 4, zb - za);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(tx - 2, za, tw + 4, 1);
    // little tick marks with a heart, a fish and a star on the scale
    for (let i = 1; i < 10; i++) { ctx.fillStyle = '#2a1626'; ctx.fillRect(x + w, yAt(i / 10), 3, 1); }
    // bell
    const bx = x + Math.round(w / 2), by = y0 - Math.round(8 * k);
    const ring = this.bell > 0 ? Math.round(Math.sin(t * 60) * 2 * this.bell) : 0;
    const bw = Math.round(10 * k);
    ctx.fillStyle = '#5a3608'; ctx.fillRect(bx - bw - 1 + ring, by - Math.round(7 * k) - 1, bw * 2 + 2, Math.round(10 * k) + 2);
    for (let r = 0; r < Math.round(10 * k); r++) {
      const ww = Math.round(bw * (0.55 + 0.45 * Math.sqrt(r / (10 * k))));
      ctx.fillStyle = r < 2 ? '#fff6c0' : r < 4 ? '#ffe066' : r < 7 * k ? '#ffc23a' : '#d8901a';
      ctx.fillRect(bx - ww + ring, by - Math.round(7 * k) + r, ww * 2, 1);
    }
    ctx.fillStyle = '#ffffff'; ctx.fillRect(bx - Math.round(bw * 0.45) + ring, by - Math.round(5 * k), 2, Math.round(3 * k));
    ctx.fillStyle = '#8a5418'; ctx.fillRect(bx - 1, by + Math.round(3 * k), 3, 2);
    if (this.bell > 0.3) for (let i = 0; i < 3; i++) { const a = -Math.PI / 2 + (i - 1) * 0.7; ctx.drawImage(partSprite('sparkle', '#fff6a0', 2), Math.round(bx + Math.cos(a) * 18 * k - 4), Math.round(by + Math.sin(a) * 14 * k - 4)); }
    // puck
    const pp = this.puckFly > 0 ? 1 + this.puckFly * 0.04 : this.p;
    const py = Math.max(y0 - 2, yAt(pp));
    ctx.fillStyle = '#2a1626'; ctx.fillRect(tx - 4, py - 4, tw + 8, 8);
    ctx.fillStyle = this.quality(this.p) === 'perfect' ? '#fff2a0' : '#59c3ff'; ctx.fillRect(tx - 3, py - 3, tw + 6, 6);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(tx - 3, py - 3, tw + 6, 2);
    ctx.fillStyle = 'rgba(0,30,80,0.35)'; ctx.fillRect(tx - 3, py + 2, tw + 6, 1);
  }
}

// ================================================================ iron: crowbar mash, with bucks
export class PryGame {
  constructor(P) {
    this.P = P;
    this.F = 0; this.Fs = 0; this.stage = 0; this.need = 4; this.t = 0;
    this.buck = { state: 'calm', t: 2.4 };
    this.score = { bonk: 0, steady: 0 };
    this.clickedInBuck = false;
  }
  start() {}
  progress() { return clamp01((this.stage + this.F * 0.9) / this.need); }
  hint() { return this.buck.state === 'calm' ? { text: 'MASH to lever the lid!', icon: 'mouse' } : { text: 'It bucks! Hands off!', icon: 'cross' }; }
  bonus() { return this.score.bonk === 0 && this.t < 10 ? 2 : this.score.bonk <= 1 ? 1 : 0; }
  update(dt, inp, click) {
    const P = this.P, B = this.buck;
    this.t += dt;
    const slipping = P.beatBusy();
    P.spots = [P.chestCentre()];
    this.F = Math.max(0, this.F - (0.16 + this.F * 0.14) * dt);
    this.Fs = lerp(this.Fs, this.F, Math.min(1, dt * 14));
    if (this.Fs > 0.7 && R() < dt * 5) P.sweat();
    B.t -= dt;
    if (B.state === 'calm' && B.t <= 0 && this.stage < this.need) { B.state = 'warn'; B.t = rnd(0.5, 0.65); P.sfx('grunt', { vol: 0.55, pitch: 0.55 }); P.sfx('slack_warn', { vol: 0.5, pitch: 0.7 }); P.sealSay('worried', 'worried', 0.9); }
    else if (B.state === 'warn') { P.lidShudder(0.6); if (B.t <= 0) { B.state = 'buck'; B.t = 0.45; this.clickedInBuck = false; P.lidKick(); P.sfx('box_close', { vol: 0.8, pitch: 0.8 }); P.shakeBy(3); this.F = Math.max(0, this.F - 0.1); } }
    else if (B.state === 'buck' && B.t <= 0) {
      B.state = 'calm'; B.t = rnd(1.5, 2.9);
      if (!this.clickedInBuck) { this.score.steady++; P.pop('steady!', 'leaf', 0.8); P.sealSay('clap', 'happy', 0.6); }
    }
    if (click && !slipping) {
      if (B.state === 'buck') {
        this.clickedInBuck = true; this.score.bonk++;
        this.F = Math.max(0, this.F - 0.35);
        P.charBeat('slip', 1.05);
        P.pop('BONK!', 'coral', 1.1);
        P.sfx('boing', { vol: 0.6, pitch: 0.8 }); P.sfx('chest_thud', { vol: 0.6 });
        P.sealSay('wiggle', 'laugh', 1.2);
        P.shakeBy(4);
      } else {
        this.F += 0.088;
        P.sfx('slack_warn', { vol: 0.22 + this.F * 0.2, pitch: 0.8 + this.F * 0.7 });
        P.lidShudder(0.25 + this.F * 0.4);
        if (R() < 0.3) P.spark(P.pryPoint(), 2, ['#ffffff', '#ffe8a8']);
        if (this.F >= 1) this.pop();
      }
    }
  }
  pop() {
    const P = this.P;
    this.F = 0.25; this.Fs = 0.6;
    this.stage++;
    P.hits = this.stage;
    P.impact({ power: 1.2, quality: 'good', last: this.stage >= this.need, text: this.stage >= this.need ? 'POPPED!' : pick(['POP!', 'PING!', 'SPROING!']), palette: 'gold', lid: this.stage * 6 });
    if (this.stage >= this.need) P.finish(0.25);
    else if (this.stage === 2 && R() < 0.6) P.charBeat('wipe', 0.8);
  }
  autoClick() { return this.buck.state === 'calm' && Math.random() < 0.35; }
  pose() { return { pose: 'ck_pry', t: poseT('ck_pry', clamp01(this.Fs * 1.05)) }; }
  draw(ctx, s) {
    const P = this.P, k = s.k, t = P.t;
    // strain meter: a chunky pixel bar over the character with a bolt pip per stage
    const w = Math.round(92 * k), h = Math.round(10 * k), x = Math.round(s.charX - w / 2 + 6 * k), y = Math.round(s.floorY - 152 * k);
    ctx.drawImage(aeroCached(`prybar|${w}|${h}`, () => aeroSurface(w, h, { tone: 'dark', r: 'pill', gloss: 0.5, glossH: 4, rim: 0.8 })), x, y);
    const fw = Math.round((w - 6) * clamp01(this.Fs));
    const col = this.Fs > 0.8 ? '#ff7a3a' : this.Fs > 0.5 ? '#ffd23a' : '#8ae84a';
    if (fw > 0) { ctx.fillStyle = col; ctx.fillRect(x + 3, y + 3, fw, h - 6); ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.fillRect(x + 3, y + 3, fw, 1); }
    if (this.Fs > 0.75 && ((t * 16) | 0) % 2) ctx.drawImage(partSprite('spark', '#ffffff', 1), x + 3 + fw - 3, y - 2);
    for (let i = 0; i < this.need; i++) {
      const bx = Math.round(x + w / 2 + (i - (this.need - 1) / 2) * 16 * k), by = y + h + Math.round(8 * k);
      const on = i < this.stage;
      ctx.fillStyle = '#14202c'; ctx.fillRect(bx - 5, by - 5, 11, 11);
      ctx.fillStyle = on ? '#4a5468' : '#ffc23a'; ctx.fillRect(bx - 4, by - 4, 9, 9);
      if (!on) { ctx.fillStyle = '#fff2b8'; ctx.fillRect(bx - 4, by - 4, 9, 2); ctx.fillStyle = '#a8681a'; ctx.fillRect(bx - 1, by - 1, 3, 3); }
      else { ctx.fillStyle = '#8ae84a'; ctx.fillRect(bx - 2, by, 2, 2); ctx.fillRect(bx, by + 1, 2, 2); ctx.fillRect(bx + 2, by - 2, 2, 3); }
    }
    // the chest's "!" when it is about to buck (a chunky pixel bang on a little plate)
    if (this.buck.state !== 'calm') {
      const [cx, cy] = P.chestTop();
      const bob = Math.round(Math.sin(t * 20) * 2), blink = this.buck.state === 'buck' || ((t * 10) | 0) % 2;
      if (blink) {
        const bx = Math.round(cx), by = Math.round(cy - 34 * k + bob);
        ctx.fillStyle = '#14202c'; ctx.fillRect(bx - 8, by - 15, 16, 30);
        ctx.fillStyle = this.buck.state === 'buck' ? '#ff4a3a' : '#ffd23a'; ctx.fillRect(bx - 7, by - 14, 14, 28);
        ctx.fillStyle = '#ffffff'; ctx.fillRect(bx - 2, by - 10, 5, 13); ctx.fillRect(bx - 2, by + 6, 5, 5);
        ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.fillRect(bx - 7, by - 14, 14, 2);
      }
    }
  }
}

// ================================================================ golden: chisel to the beat
const PATTERNS = [
  [0, 1, 2, 3], [0, 1, 1.5, 2, 3], [0, 0.5, 1, 2, 3], [0, 1, 2, 2.5, 3, 3.5], [0, 1.5, 2, 3], [0, 0.5, 1, 1.5, 2, 3],
];
const MELODY = [0, 4, 7, 4, 9, 7, 4, 2, 4, 7, 12, 9, 7, 12, 14, 12, 16, 19, 16, 24];
export class ChiselGame {
  constructor(P) {
    this.P = P;
    this.bpm = 108; this.beat = 60 / this.bpm;
    this.t = -this.beat * 3;
    this.notes = []; this.bar = 1;
    this.need = 10; this.hits = 0; this.mel = 0;
    this.score = { perfect: 0, good: 0, miss: 0, whiff: 0 };
    this.lastBeat = -99; this.hitFx = 0;
    for (let i = 0; i < 3; i++) this.addBar();
  }
  addBar() {
    const pat = this.bar === 1 ? PATTERNS[0] : PATTERNS[1 + Math.floor(R() * (PATTERNS.length - 1))];
    for (const b of pat) this.notes.push({ at: (this.bar * 4 + b) * this.beat - this.beat * 4, done: false, miss: false, q: null, ht: 0 });
    this.bar++;
  }
  start() {}
  progress() { return clamp01(this.hits / this.need); }
  hint() { return { text: 'Tap when the glints reach the chisel!', icon: 'mouse' }; }
  bonus() { return this.score.perfect >= 7 ? 2 : this.score.perfect >= 4 ? 1 : 0; }
  update(dt, inp, click) {
    const P = this.P;
    this.t += dt;
    this.hitFx = Math.max(0, this.hitFx - dt * 4);
    const bi = Math.floor(this.t / this.beat);
    if (bi !== this.lastBeat) { this.lastBeat = bi; P.sfx('reel_tick', { vol: bi % 4 === 0 ? 0.32 : 0.16, pitch: bi % 4 === 0 ? 1.25 : 1 }); P.sealBob(); }
    for (const n of this.notes) if (!n.done && !n.miss && this.t - n.at > 0.18) { n.miss = true; n.ht = this.t; this.score.miss++; }
    if (this.notes.filter((n) => !n.done && !n.miss).length < 6 && this.hits < this.need) this.addBar();
    if (click && !P.beatBusy()) {
      let best = null, bd = 1e9;
      for (const n of this.notes) { if (n.done || n.miss) continue; const d = Math.abs(this.t - n.at); if (d < bd) { bd = d; best = n; } }
      if (best && bd < 0.17) {
        best.done = true; best.ht = this.t;
        const q = bd < 0.075 ? 'perfect' : 'good';
        best.q = q;
        this.score[q]++;
        this.hits++; P.hits = this.hits;
        this.hitFx = 1;
        const semi = MELODY[this.mel++ % MELODY.length];
        P.sfx('ice_chime', { vol: 0.5, pitch: Math.pow(2, semi / 12) * 0.9 });
        P.charBeat('chisel', 0.2);
        const last = this.hits >= this.need;
        P.impact({ power: q === 'perfect' ? 1.3 : 0.9, quality: q, last, text: last ? 'UNSEALED!' : q === 'perfect' ? pick(['PERFECT!', 'SHINY!', 'GOLDEN!']) : pick(['NICE!', 'OK!', 'TAK!']), palette: q === 'perfect' || last ? 'gold' : 'white', small: !last });
        if (last) P.finish(0.4);
      } else {
        this.score.whiff++;
        P.charBeat('ouch', 0.62);
        P.pop('OUCH!', 'coral', 0.8);
        P.sfx('boing', { vol: 0.4, pitch: 1.5 });
        P.sealSay('wiggle', 'laugh', 0.8);
      }
    }
    P.spots = [P.chestCentre()];
  }
  autoClick() { return this.notes.some((n) => !n.done && !n.miss && Math.abs(this.t - n.at) < 0.02); }
  pose() { return null; }
  // the lane IS the chest's seam: glints slide along the gold rim (from beyond the right corner) to the chisel
  lane() {
    const P = this.P, cm = P.cm;
    const A = P.spr.toScreen(P.chestX, P.chestY, cm.laneA), B = P.spr.toScreen(P.chestX, P.chestY, cm.laneB);
    const dx = B[0] - A[0], dy = B[1] - A[1], L = Math.hypot(dx, dy) || 1;
    const ext = 120 * P.k, G = 20 * P.k; // the chisel tip sits a little left of the corner
    return { ax: A[0] - (dx / L) * G, ay: A[1] - (dy / L) * G, ux: dx / L, uy: dy / L, len: L + ext + G, seam: L + G };
  }
  draw(ctx, s) {
    const L = this.lane(), k = s.k, t = this.t;
    const lead = this.beat * 3;
    const at = (d) => [Math.round(L.ax + L.ux * d), Math.round(L.ay + L.uy * d)];
    const dOf = (time) => ((time - t) / lead) * L.len;
    // the guide line beyond the chest: a dotted gold trail through the air
    for (let d = L.seam + 4; d < L.len; d += 6) { const [x, y] = at(d); ctx.globalAlpha = clamp01(1 - (d - L.seam) / (L.len - L.seam)) * 0.7; ctx.fillStyle = '#ffe066'; ctx.fillRect(x, y, 2, 2); }
    ctx.globalAlpha = 1;
    // beat ticks along the seam
    const b0 = Math.ceil(t / this.beat), b1 = Math.floor((t + lead) / this.beat);
    for (let b = b0; b <= b1; b++) { const d = dOf(b * this.beat); if (d > L.len) continue; const [x, y] = at(d); ctx.fillStyle = b % 4 === 0 ? '#ffffff' : '#ffe066'; ctx.fillRect(x, y - 3, 1, 3); }
    // target bracket at the chisel (pulses on the beat)
    const ph = 1 - ((t / this.beat) % 1 + 1) % 1;
    const r = Math.round((8 + ph * 2) * k);
    drawPixelBrackets(ctx, L.ax - r, L.ay - r, r * 2, r * 2, t, { col: this.hitFx > 0 ? '#ffffff' : '#ffe066', ink: '#5a3608' });
    // notes: faceted gold gems sliding along the seam
    for (const n of this.notes) {
      if (n.done && t - n.ht > 0.25) continue;
      if (n.miss && t - n.ht > 0.4) continue;
      const d = n.done ? 0 : dOf(n.at);
      if (d > L.len || d < -30 * k) continue;
      let [x, y] = at(d);
      if (n.miss) y += Math.round((t - n.ht) * 40);
      const big = n.done ? 1 + (t - n.ht) * 4 : 1;
      const sz = Math.round(5 * k * big);
      const fadeIn = clamp01((L.len - d) / (30 * k));
      ctx.globalAlpha = (n.miss ? clamp01(1 - (t - n.ht) / 0.4) * 0.6 : n.done ? clamp01(1 - (t - n.ht) / 0.25) : 1) * fadeIn;
      ctx.fillStyle = '#5a3608';
      for (let i = -sz - 1; i <= sz + 1; i++) { const hw = sz + 1 - Math.abs(i); ctx.fillRect(x - hw, y + i, hw * 2 + 1, 1); }
      for (let i = -sz; i <= sz; i++) { const hw = sz - Math.abs(i); ctx.fillStyle = n.miss ? '#8a8aa0' : i < -sz / 3 ? '#fff6c0' : i < sz / 3 ? '#ffd23a' : '#d8901a'; ctx.fillRect(x - hw, y + i, hw * 2 + 1, 1); }
      ctx.fillStyle = '#ffffff'; ctx.fillRect(x - 1, y - Math.round(sz / 2), 2, 2);
      ctx.globalAlpha = 1;
    }
  }
}

// ================================================================ orb: spin, find the weak spot, tap
export class OrbGame {
  constructor(P) {
    this.P = P;
    this.yaw = 0; this.vel = 0; this.need = 5; this.hits = 0;
    this.drag = null; this.t = 0; this.wob = 0; this.found = 0;
    this.score = { perfect: 0, good: 0, miss: 0 };
  }
  start() {}
  progress() { return clamp01(this.hits / this.need); }
  hint() { return this.visible() ? { text: 'Tap the crack while it shines!', icon: 'mouse' } : { text: 'Drag to spin the orb!', icon: 'drag' }; }
  bonus() { return this.score.perfect >= 4 ? 2 : this.score.miss <= 1 ? 1 : 0; }
  target() { return this.P.cm.weak[this.hits % this.P.cm.weak.length]; }
  facing() { return this.P.spr.facing(this.target().n, this.P.orbYawShown()); }
  visible() { return this.facing() > 0.2; }
  shine() { return 0.5 + 0.5 * Math.sin(this.t * 5.2); }
  update(dt, inp, click) {
    const P = this.P;
    this.t += dt;
    this.wob = Math.max(0, this.wob - dt * 3);
    if (click) this.drag = { x: inp.x, y: inp.y, lx: inp.x, t: 0, moved: false };
    if (this.drag) {
      this.drag.t += dt;
      const dx = inp.x - this.drag.lx;
      this.drag.lx = inp.x;
      if (Math.abs(inp.x - this.drag.x) > 5) this.drag.moved = true;
      if (this.drag.moved) { this.yaw -= dx * 1.6; this.vel = -dx * 1.6 / Math.max(dt, 0.008); }
      if (!inp.down) {
        if (!this.drag.moved) this.tap(this.drag.x, this.drag.y);
        this.drag = null;
      }
    } else {
      this.vel *= Math.exp(-dt * 2.6);
      if (Math.abs(this.vel) < 8) this.vel += 14 * dt * Math.sign(this.vel || 1) * (this.visible() ? 0 : 1);
      this.yaw += this.vel * dt;
    }
    const key = (a, b) => inp.key?.(a) || inp.key?.(b);
    if (key('a', 'ArrowLeft')) this.yaw += 140 * dt;
    if (key('d', 'ArrowRight')) this.yaw -= 140 * dt;
    if (inp.keyPressed?.(' ')) { const [x, y] = this.targetScreen(); this.tap(x, y, true); }
    P.orbYaw = this.yaw;
    const [sx, sy] = this.targetScreen();
    P.spots = [{ x: Math.round(sx), y: Math.round(sy) }];
  }
  autoClick() { if (this.visible() && this.shine() > 0.8 && !this.drag) { const [x, y] = this.targetScreen(); this.tap(x, y); } else if (!this.visible()) this.yaw += 3; return false; }
  targetScreen() { const P = this.P; return P.spr.toScreen(P.chestX, P.chestY, this.target().p, P.orbYawShown()); }
  tap(x, y, key = false) {
    const P = this.P;
    P.charBeat('tap', 0.28);
    const [tx, ty] = this.targetScreen();
    const vis = this.visible();
    const near = Math.hypot(x - tx, y - ty) < 18 * P.k || key;
    if (vis && near) {
      const q = this.shine() > 0.62 ? 'perfect' : 'good';
      this.score[q]++;
      this.hits++; P.hits = this.hits;
      const last = this.hits >= this.need;
      P.impact({ power: q === 'perfect' ? 1.4 : 1, quality: q, last, at: this.P.cm.weak[(this.hits - 1) % this.P.cm.weak.length].p, text: last ? 'SHATTER!' : q === 'perfect' ? pick(['CRACK!', 'KRIIK!', 'TING!']) : pick(['tik!', 'tak!']), palette: q === 'perfect' || last ? 'gold' : 'white', small: !last && q !== 'perfect' });
      this.vel = (R() < 0.5 ? -1 : 1) * rnd(60, 120);
      if (last) P.finish(0.35);
    } else if (P.onOrb(x, y)) {
      this.score.miss++; this.wob = 1;
      P.pop('boink', 'sky', 0.7, x, y - 10);
      P.sfx('boing', { vol: 0.4, pitch: 1.7 }); P.sfx('ice_chime', { vol: 0.25, pitch: 0.7 });
      P.sealSay('think', 'think', 0.9);
    }
  }
  pose() { return null; }
  draw(ctx, s) {
    const P = this.P, k = s.k;
    const [tx, ty] = this.targetScreen();
    if (this.visible()) {
      const sh = this.shine(), f = clamp01((this.facing() - 0.2) * 3);
      const r = Math.round((6 + sh * 3) * k);
      ctx.globalAlpha = f;
      drawPixelBrackets(ctx, Math.round(tx - r), Math.round(ty - r), r * 2, r * 2, this.t, { col: sh > 0.62 ? '#ffffff' : '#ff9ae8', ink: '#2a0a4a' });
      // the hairline crack glints when it shines
      if (sh > 0.62) ctx.drawImage(partSprite('sparkle', '#ffffff', 2), Math.round(tx - 5), Math.round(ty - 5));
      ctx.globalAlpha = 1;
    } else {
      // a pixel arrow beside the orb: spin this way
      const [cx, cy] = P.orbCentre();
      const n = this.target().n;
      const yaw = (P.orbYawShown() * Math.PI) / 180;
      const side = Math.sign(n[0] * Math.cos(yaw) - n[2] * Math.sin(yaw)) || 1;
      const ax = Math.round(cx + side * 52 * k + Math.sin(this.t * 6) * 3 * side), ay = Math.round(cy);
      for (let i = 0; i < 7; i++) { ctx.fillStyle = '#14202c'; ctx.fillRect(ax + side * i - (side < 0 ? 0 : 0), ay - (7 - i) - 1, 2, (7 - i) * 2 + 3); }
      for (let i = 0; i < 6; i++) { ctx.fillStyle = i < 2 ? '#ffffff' : '#ff9ae8'; ctx.fillRect(ax + side * i, ay - (6 - i), 1, (6 - i) * 2 + 1); }
    }
    // remaining cracks as glass pips under the orb
    const [cx] = P.orbCentre();
    for (let i = 0; i < this.need; i++) {
      const x = Math.round(cx + (i - (this.need - 1) / 2) * 13 * k), y = Math.round(s.floorY + 16 * k);
      ctx.fillStyle = '#14202c'; ctx.fillRect(x - 4, y - 4, 9, 9);
      ctx.fillStyle = i < this.hits ? '#ff9ae8' : '#5a4a8a'; ctx.fillRect(x - 3, y - 3, 7, 7);
      ctx.fillStyle = i < this.hits ? '#ffffff' : '#7a6aaa'; ctx.fillRect(x - 3, y - 3, 3, 2);
    }
  }
}

export const GAMES = { crate: HammerGame, iron: PryGame, golden: ChiselGame, orb: OrbGame };
