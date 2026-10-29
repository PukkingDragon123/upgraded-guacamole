// Fishing controller: hook & line, bait, nibbles, bites, the cinematic hook-set, the crank-and-pull
// fight (battle.js + species events in minigames.js), the slow-motion landing finale and the
// escape cutscene (cinematics.js), and the fight HUD (hud.js).
//
// Public API (game.js, tutorial, browser overlay): update(dt, worldInput), drawWorld(ctx) [world
// space], drawHud(ctx) [screen space], drawCinematic(ctx) [world space, after fish],
// drawCinematicHud(ctx) [screen space, above the HUD], requestNibble(fish), releaseFish(flee),
// setHook(auto), message(text), crankHint(), and the fields state ('idle'|'nibble'|'bite'|'fight'|
// 'landing'), busy, fighting, hook {x, y, visible}, tension.
// If the host never calls drawCinematic/drawCinematicHud, drawWorld/drawHud draw them instead.

import { clamp, clamp01, lerp, dist, damp } from '../core/math.js';
import { rng } from '../core/rng.js';
import { rgba } from '../core/color.js';
import { drawText } from '../gfx/font.js';
import { Particles } from '../gfx/particles.js';
import { HOOK, baitSprite } from './baitart.js';
import { Crank } from './crank.js';
import { Battle } from './battle.js';
import { drawShots, drawCircle } from './minigames.js';
import { Titles, Finale, EscapeCine, Outro } from './cinematics.js';
import { drawFightScene, drawFightBands } from './hud.js';

export class Fishing {
  constructor(game) {
    this.game = game;
    this.world = game.world;
    this.state = 'idle';
    this.t = 0;
    this.rdt = 1 / 60;
    this.hook = { x: -50, y: -50, angle: 0, av: 0, dip: 0, visible: false };
    this.rodX = 0;
    this.baitSwing = 0; this.baitSwingV = 0;
    this.fish = null;
    this.battle = null;
    this.finale = null;
    this.cine = null;
    this.tension = 0;
    this.msg = null;
    this.wasInWater = false;
    this.jig = 0;
    this.cursor = game.world.cursor;
    this.input = game.input;
    this.focus = 0;
    this.crank = new Crank();
    this.fx = new Particles(700); // screen-space effects for the HUD and titles
    this.fx.surfaceY = null;
    this.titles = new Titles(this);
    this.splats = [];
    this.pose = null; this.poseHold = null;
    this.scrolled = false;
    this.hostCine = false; this.hostCineHud = false;
    this.loops = null;
  }

  // ------------------------------------------------------------------ accessors
  get stats() { return this.game.stats; }
  get busy() { return this.state !== 'idle' || !!this.cine; }
  get fighting() { return this.state === 'fight' || this.state === 'landing'; }
  get fight() { return this.battle; }
  get cam() { return this.game.camera; }
  get boat() { return this.game.boat || null; }
  get particles() { return this.game.particles; }
  get W() { return this.game.screen?.W ?? this.world.W; }
  get H() { return this.game.screen?.H ?? this.world.H; }

  toScreen(x, y) { const c = this.cam; return c?.worldToScreen ? c.worldToScreen(x, y) : [x, y]; }
  toWorld(x, y) { const c = this.cam; return c?.screenToWorld ? c.screenToWorld(x, y) : [x, y]; }
  pointerWorld() { return this.toWorld(this.input.x, this.input.y); }
  zoom() { const c = this.cam; return c?.xform ? c.xform()[0] : 1; }
  viewTop() { return this.cam?.scrollY ?? 0; }

  zoneRadius() {
    const f = this.fish;
    if (!f) return 60;
    return clamp(this.fishLen() * 0.5 * this.zoom() + 28, 56, 180);
  }

  scaleColors() {
    const col = this.fish?.sp?.look?.col || {};
    return [col.body || '#c8e8ff', col.belly || '#ffffff', col.back || col.body || '#9ad8ff'];
  }

  sfx(name, opts) { this.game.audio?.play?.(name, opts); }
  shake(n) { this.cam?.shake?.(n); }

  setPose(pose, hold = 0) {
    if (hold > 0) this.poseHold = { pose, t: hold };
    else this.pose = pose;
    const b = this.boat;
    if (b) b.pose = this.poseHold ? this.poseHold.pose : pose;
  }

  scrollTo(y) {
    const c = this.cam;
    if (!c?.scrollTo) return;
    if (!this.scrolled) this.prevScroll = c.scrollTarget ?? c.scrollY ?? 0;
    const target = this.game.surfaceScroll !== undefined ? Math.max(y, this.game.surfaceScroll) : y;
    c.scrollTo(target);
    this.scrolled = true;
  }

  restoreScroll() {
    if (!this.scrolled) return;
    this.scrolled = false;
    this.cam?.scrollTo?.(this.prevScroll ?? 0);
  }

  inkSplat(n = 3) {
    for (let i = 0; i < n; i++) {
      this.splats.push({
        x: rng.float(this.W * 0.15, this.W * 0.85), y: rng.float(this.H * 0.18, this.H * 0.75), r: rng.int(18, 42),
        t: -i * 0.08, max: rng.float(2.2, 3.2), drips: Array.from({ length: rng.int(1, 3) }, () => ({ x: rng.float(-12, 12), w: rng.pick([2, 3]), l: rng.float(6, 18) })),
      });
    }
  }

  rodTip() {
    const b = this.boat, w = this.world;
    if (b?.rodTip && w.surfaceY !== null && w.surfaceY !== undefined && b.visible !== false) {
      const r = b.rodTip();
      if (r && Number.isFinite(r[0]) && Number.isFinite(r[1])) return r;
    }
    return [this.rodX, this.viewTop() - 6];
  }

  // World size of the fish (mouth to tail), for camera framing and HUD rings.
  fishLen(f = this.fish) {
    if (!f) return 30;
    const a = f.anchors;
    let len = (f.sp?.look?.body?.len || 30) * (f.sp?.scale || 1) * f.scale;
    if (a?.mouth && a?.tail) len = Math.max(len * 0.6, dist(a.mouth[0], a.mouth[1], a.tail[0], a.tail[1]) * 1.15);
    return len;
  }

  // Zoom that frames the hooked fish nicely (small fish get a closer look).
  fightZoom() {
    const noSurf = this.world.surfaceY === null || this.world.surfaceY === undefined;
    return clamp((this.W * 0.2) / Math.max(12, this.fishLen()), noSurf ? 1.3 : 1.45, noSurf ? 1.9 : 2.4);
  }

  // Where the fight ends: just under the surface, outboard of the boat on the rod side, so the
  // finale has room for a big arc into the angler's hands.
  landingPoint(f) {
    const w = this.world;
    if (w.surfaceY !== null && w.surfaceY !== undefined) {
      const [rx] = this.rodTip();
      const b = this.boat;
      const half = this.fishLen(f) * 0.4;
      let x = rx + 40;
      if (b && Number.isFinite(b.x)) {
        let out = Math.sign(rx - b.x) || 1;
        const bb = b.bounds?.();
        const edge = (o) => (bb ? (o > 0 ? bb.x + bb.w : bb.x) : b.x + o * 60);
        x = edge(out) + out * (half + 22);
        if (x < 30 || x > w.W - 30) { out = -out; x = edge(out) + out * (half + 22); }
      }
      return { x: clamp(x, 30, w.W - 30), y: w.surfaceY + 14 + half };
    }
    return { x: clamp(f.x, 60, w.W - 60), y: this.viewTop() + 80 };
  }

  crankHint() { return this.battle ? this.battle.crankHint() : [this.input.x, this.input.y]; }

  // ------------------------------------------------------------------ nibble API
  // Called by fish AI when it wants to start nibbling.
  requestNibble(fish) {
    if (this.state !== 'idle' || this.cine || !this.world.hook.active) return false;
    this.fish = fish;
    fish.controlled = true;
    fish.allowTurn = true;
    this.state = 'nibble';
    const sp = fish.sp;
    const [n0, n1] = sp.fight?.nibbles || [1, 3];
    this.nibblesLeft = rng.int(n0, n1);
    this.nibbleT = rng.float(0.35, 0.8);
    this.nibblePhase = 0;
    this.fakeBite = rng.chance(sp.fight?.fakeBite ?? 0.15);
    return true;
  }

  // Let go of the current fish (also cancels any cinematic and restores the camera).
  releaseFish(flee = true, emote = null) {
    const f = this.fish || this.cine?.fish || this.finale?.fish;
    const wasFighting = this.fighting || !!this.cine || !!this.finale;
    if (f) {
      f.controlled = false;
      f.allowTurn = false;
      f.forceAngle = undefined;
      f.alpha = Math.max(f.alpha ?? 1, 1);
      f.cooldown = rng.float(10, 20);
      if (flee) { f.startle?.(this.hook.x, this.hook.y); f.setState?.('leave'); f.cruise *= 1.8; }
      if (emote) f.say?.(emote, 1.5);
    }
    this.fish = null;
    this.battle = null;
    this.finale = null;
    this.cine = null;
    this.state = 'idle';
    this.tension = 0;
    this.stopLoops();
    if (wasFighting) this.resetCamera();
  }

  resetCamera() {
    const c = this.cam, g = this.game;
    c?.release?.(3);
    c?.setLetterbox?.(false);
    this.restoreScroll();
    if (g.timeScaleTarget !== undefined) g.timeScaleTarget = 1;
    if (this.boat) { this.boat.holdFish = null; }
    this.poseHold = null;
    this.setPose('idle');
  }

  message(text, color = '#ffffff', time = 1.6, big = false) {
    this.msg = { text, color, t: 0, max: time, big };
  }

  // ------------------------------------------------------------------ update
  update(dt, worldInput) {
    this.t += dt;
    const g = this.game, w = this.world, inp = this.input, c = this.cursor, h = this.hook;
    const ts = g.timeScale;
    const rdt = Math.min(0.1, ts && ts > 0.05 ? dt / ts : dt);
    this.rdt = rdt;
    if (this.msg) { this.msg.t += rdt; if (this.msg.t > this.msg.max) this.msg = null; }
    this.jig = Math.max(0, this.jig - dt * 0.6);
    w.jig = this.jig;
    this.crank.update(rdt, inp.x, inp.y);
    this.fx.update(rdt);
    this.titles.update(rdt);
    for (const s of this.splats) s.t += rdt;
    this.splats = this.splats.filter((s) => s.t < s.max);
    if (this.poseHold) {
      this.poseHold.t -= rdt;
      if (this.poseHold.t <= 0) { this.poseHold = null; if (this.boat) this.boat.pose = this.pose || 'idle'; }
    }

    const canHook = worldInput && !g.paused && !g.fishingDisabled && !this.cine?.blocksHook;
    // hook follows the cursor
    if (this.state === 'idle' || this.state === 'nibble' || this.state === 'bite') {
      if (canHook) {
        h.visible = true;
        const px = h.x;
        h.x = c.x; h.y = c.y + h.dip;
        h.av += ((px - h.x) * 0.02 - h.angle * 9 - h.av * 2.5) * dt * 10;
      } else if (this.state === 'idle') {
        h.visible = false;
      }
    } else h.visible = false;
    h.angle = clamp(h.angle + h.av * dt, -0.9, 0.9);
    h.dip = damp(h.dip, 0, 6, dt);
    this.rodX = damp(this.rodX, h.x, 2.2, dt);
    this.baitSwingV += (-(h.x - (this.prevHX ?? h.x)) * 1.5 - this.baitSwing * 30 - this.baitSwingV * 4) * dt;
    this.baitSwing = clamp(this.baitSwing + this.baitSwingV * dt * 10, -0.8, 0.8);
    this.prevHX = h.x;

    const surf = w.surfaceY;
    const inWater = h.visible && (surf === null || surf === undefined || h.y > surf + 2);
    if (inWater && !this.wasInWater && h.visible && surf !== null && surf !== undefined && this.state === 'idle') {
      this.sfx('cast', { vol: 0.6 });
      this.particles.splash(h.x, surf, 0.25);
      this.particles.foam?.(h.x, surf, 3, { spread: 4 });
      if (g.state?.stats) g.state.stats.casts++;
      if (this.boat) this.setPose('cast', 0.45);
    }
    this.wasInWater = inWater;
    const bait = g.currentBait();
    w.hook.x = h.x; w.hook.y = h.y;
    w.hook.active = h.visible && canHook && this.state === 'idle';
    w.hook.inWater = inWater;
    w.hook.bait = bait;
    w.hook.radiusMul = this.stats.baitRadius;

    switch (this.state) {
      case 'idle':
        if (canHook && inWater && inp.pressed && !g.ui?.blocking) {
          // jig the lure
          h.dip = -5;
          h.av += rng.float(-3, 3);
          this.jig = Math.min(1.5, this.jig + 0.35);
          this.sfx('bubble', { vol: 0.4, pitch: rng.float(1, 1.4) });
          this.particles.bubbles(h.x, h.y, 3);
          this.particles.ring?.(h.x, h.y, 0.3, 'rgba(230,250,255,0.6)', { flat: 1 });
        }
        break;
      case 'nibble': this.updateNibble(dt, canHook); break;
      case 'bite': this.updateBite(dt, canHook); break;
      case 'fight': this.updateFight(dt); break;
      case 'landing': this.updateLanding(dt); break;
      default: break;
    }
    if (this.cine && this.cine.update(dt, rdt) === 'done') this.cine = null;
    this.updateLoops();
  }

  updateLoops() {
    const fighting = this.state === 'fight' && !!this.battle;
    if (fighting && !this.loops) {
      const a = this.game.audio;
      this.loops = { reel: a?.loop?.('reel'), tension: a?.loop?.('tension') };
    }
    if (!this.loops) return;
    if (!fighting) { this.stopLoops(); return; }
    this.loops.reel?.set?.(clamp01(this.crank.power * 0.9));
    this.loops.tension?.set?.(clamp01((this.tension - 0.45) * 1.8));
  }

  stopLoops() {
    if (!this.loops) return;
    this.loops.reel?.stop?.();
    this.loops.tension?.stop?.();
    this.loops = null;
  }

  updateNibble(dt, canHook) {
    const f = this.fish, h = this.hook, g = this.game, inp = this.input;
    if (!f || !canHook || !this.world.hook.inWater) { this.releaseFish(true); return; }
    // spooked by big movements
    if (this.cursor.speed > 260 * this.stats.calm) {
      this.message('Too fast! It got spooked.', '#ffb0a0');
      this.releaseFish(true);
      return;
    }
    const side = f.x < h.x ? -1 : 1;
    const mouthOff = 9 * f.scale + 4;
    this.nibbleT -= dt;
    let tx = h.x + side * (mouthOff + 6);
    const ty = h.y + 1;
    if (this.nibblePhase > 0) {
      this.nibblePhase -= dt;
      tx = h.x + side * mouthOff;
      if (this.nibblePhase <= 0.08 && !this.nibbled) {
        this.nibbled = true;
        h.dip = 3 + rng.float(0, 2);
        h.av += rng.float(-2, 2);
        f.chompT = 0.15;
        this.sfx('nibble', { pitch: rng.float(0.9, 1.2) });
        this.particles.bubbles(h.x, h.y, 2, { size: 1 });
        this.particles.ring?.(h.x, h.y, 0.25, 'rgba(230,250,255,0.5)', { flat: 1 });
      }
    }
    f.facing = -side;
    f.lookAt(h.x, h.y);
    f.vx = (tx - f.x) * 8; f.vy = (ty - f.y) * 8;
    f.x = damp(f.x, tx, 14, dt); f.y = damp(f.y, ty, 14, dt);
    f.z = damp(f.z, 0, 2, dt);
    f.feel('happy', 0.2);
    if (this.nibbleT <= 0) {
      if (this.nibblesLeft > 0) {
        this.nibblesLeft--;
        this.nibblePhase = 0.25;
        this.nibbled = false;
        this.nibbleT = rng.float(0.45, 1.1);
        if (this.fakeBite && this.nibblesLeft === 1) { h.dip = 8; f.say('!', 0.4); this.sfx('nibble', { pitch: 0.7 }); this.fakeBite = false; }
      } else {
        this.state = 'bite';
        this.biteT = (f.sp.fight?.biteWindow ?? 0.6) * this.stats.biteWindow * (g.tutorialActive ? 2.5 : 1);
        this.biteMax = this.biteT;
        h.dip = 10;
        f.say('!', this.biteT + 0.2);
        f.feel('determined', 1);
        f.chompT = 0.3;
        this.sfx('bite');
        this.particles.bubbles(h.x, h.y, 6);
        this.particles.shockwave?.(h.x, h.y, 14, '#ffe27a', { life: 0.3 });
        if (rng.chance(this.stats.autoHook)) { this.setHook(true); return; }
      }
    }
    if (inp.pressed && !g.ui?.blocking && this.state === 'nibble') {
      this.message('Too early!', '#ffb0a0');
      this.sfx('escape', { vol: 0.5 });
      this.releaseFish(true, 'cross');
    }
  }

  updateBite(dt, canHook) {
    const f = this.fish, h = this.hook, g = this.game, inp = this.input;
    if (!f) { this.state = 'idle'; return; }
    this.biteT -= dt;
    const side = f.x < h.x ? -1 : 1;
    f.x = damp(f.x, h.x + side * (8 * f.scale + 3), 16, dt);
    f.y = damp(f.y, h.y + 2, 16, dt);
    h.dip = Math.max(h.dip, 6 + Math.sin(this.t * 40) * 2);
    if (rng.chance(dt * 12)) this.particles.bubbles(h.x, h.y, 1, { size: 1 });
    if (inp.pressed && canHook && !g.ui?.blocking) { this.setHook(false); return; }
    if (this.biteT <= 0) {
      const bait = g.currentBait();
      if (bait?.kind === 'special' && rng.chance(0.6)) {
        g.consumeBait(bait.type);
        this.message('It stole your bait!', '#ffd2a0');
      } else this.message('Missed the bite!', '#ffd2a0');
      this.sfx('escape', { vol: 0.6 });
      this.releaseFish(true, 'music');
    }
  }

  // ------------------------------------------------------------------ hook-set
  setHook(auto = false) {
    const g = this.game, f = this.fish;
    if (!f || this.state === 'fight' || this.state === 'landing') return;
    this.sp = f.sp;
    this.state = 'fight';
    this.cine = null;
    this.crank.prevA = null;
    this.battle = new Battle(this);
    this.power = this.battle.power;
    this.tension = this.battle.tension;
    this.splats = [];
    // cinematic: slow-mo punch-in with letterbox
    const cam = this.cam;
    const zoomIn = this.fightZoom() + 0.3;
    cam?.focus?.(f.x, f.y, zoomIn, 6);
    cam?.setLetterbox?.(true);
    cam?.slowmo?.(0.22, 0.55);
    cam?.flash?.('#ffffff', 0.35);
    this.shake(5);
    this.sfx('hookset');
    this.sfx('splash_small', { vol: 0.6, pitch: 0.8 });
    const P = this.particles;
    P.shockwave?.(f.x, f.y, 34, '#ffffff', { life: 0.5 });
    P.shockwave?.(f.x, f.y, 20, '#ffe27a', { life: 0.35, delay: 0.06 });
    P.speedLines?.(f.x, f.y, 18, { r0: 26, r1: 60, inward: true, len: [8, 18], color: '#ffffff' });
    P.burst(f.x, f.y, 14, { colors: ['#ffffff', '#ffe27a'], speed: 80, g: 0, life: 0.45 });
    P.bubbles(f.x, f.y, 10);
    P.scales?.(f.x, f.y, 4, this.scaleColors());
    const surf = this.world.surfaceY;
    if (surf !== null && surf !== undefined && f.y - surf < 40) P.eruption?.(f.x, surf, 0.6);
    this.fx.speedLines(this.W / 2, this.H / 2, 34, { r0: Math.min(this.W, this.H) * 0.35, r1: Math.max(this.W, this.H) * 0.6, inward: true, speed: [400, 700], len: [20, 46], color: '#ffffff', life: 0.35 });
    const rar = f.sp.rarity;
    this.titles.add('fishon', auto ? 'AUTO-HOOK!' : 'FISH ON!', { sub: f.sp.name, subColor: rar === 'legendary' ? '#a86a12' : rar === 'epic' ? '#6a2fa0' : rar === 'rare' ? '#2a5aa8' : rar === 'uncommon' ? '#2f7a3c' : '#3a4a5a' });
    f.feel('surprised', 0.8);
    f.squashV += 10;
    f.say('!!', 0.8);
    this.setPose('yank', 0.35);
    this.setPose('pull');
    g.onHooked?.(f);
  }

  updateFight(dt) {
    const g = this.game, B = this.battle, f = this.fish;
    if (!B || !f) { this.releaseFish(false); return; }
    // focus (slow motion) with right mouse if unlocked
    const focusing = this.input.rdown && this.stats.focus > 0;
    this.focus = damp(this.focus, focusing ? 1 : 0, 8, dt);
    g.timeScaleTarget = focusing ? 0.45 : 1;
    const r = B.update(dt);
    this.tension = B.tension;
    f.controlled = true;
    // camera follows the fish (or what the event wants to show)
    const ev = B.event?.focus;
    let zoom = this.fightZoom();
    if (B.mode === 'hookset') zoom += 0.3;
    if (B.trick?.kind === 'jump') zoom = 1.55;
    if (B.mode === 'surge' && B.surgeMul > 1.5) zoom -= 0.15;
    if (ev) this.cam?.focus?.(ev.x, ev.y, ev.zoom, 4);
    else this.cam?.focus?.(f.x, f.y, zoom, B.mode === 'hookset' ? 6 : 4);
    // character pose from what the player is doing
    if (!this.poseHold) {
      const pose = this.input.down ? 'pull' : this.crank.active ? 'reel' : 'pull';
      if (pose !== this.pose) this.setPose(pose);
    }
    if (r === 'ok') return;
    if (r === 'land') this.beginLanding();
    else this.fail(r);
  }

  // ------------------------------------------------------------------ outcomes
  fail(reason) {
    const g = this.game, f = this.fish, B = this.battle;
    if (g.timeScaleTarget !== undefined) g.timeScaleTarget = 1;
    const m = f.anchors?.mouth || [f.x, f.y];
    const [rx, ry] = this.rodTip();
    const line = { x0: rx, y0: ry, x1: m[0], y1: m[1] };
    if (reason === 'snap') {
      this.sfx('line_snap');
      if (g.state?.stats) g.state.stats.snapped++;
      if (g.currentBait()?.kind === 'special') g.consumeBait(g.currentBait().type);
    } else this.sfx('escape');
    if (g.state?.stats) g.state.stats.escaped++;
    this.particles.burst(m[0], m[1], 10, { colors: ['#ffffff', '#9ad8ff'], speed: 60, g: 0, life: 0.4 });
    this.stopLoops();
    this.state = 'idle';
    this.fish = null;
    this.battle = null;
    this.tension = 0;
    this.splats = [];
    void B;
    this.cine = new EscapeCine(this, f, reason, line);
  }

  // Called by the escape cutscene once the fish has made its getaway.
  finishEscape(f, reason) {
    f.controlled = false;
    f.allowTurn = false;
    f.forceAngle = undefined;
    f.alpha = 1;
    f.cooldown = rng.float(10, 20);
    f.startle?.(f.x - (f.facing || 1) * 20, f.y);
    f.setState?.('leave');
    f.cruise *= 1.8;
    this.cam?.release?.(3);
    this.cam?.setLetterbox?.(false);
    this.restoreScroll();
    this.setPose('idle');
    this.game.onFishEscaped?.(f, reason);
  }

  beginLanding() {
    const g = this.game, f = this.fish;
    this.state = 'landing';
    this.stopLoops();
    if (g.timeScaleTarget !== undefined) g.timeScaleTarget = 1;
    this.tension = 0.3;
    this.splats = [];
    this.finale = new Finale(this, f);
    this.battle = null;
  }

  updateLanding(dt) {
    const F = this.finale;
    if (!F) { this.state = 'idle'; return; }
    if (F.update(dt, this.rdt) !== 'caught') return;
    const fish = this.fish;
    const hasBoat = F.hasBoat;
    fish.controlled = false;
    fish.forceAngle = undefined;
    this.fish = null;
    this.finale = null;
    this.state = 'idle';
    this.cine = new Outro(this, hasBoat, fish);
    this.game.onFishCaught(fish);
  }

  // ------------------------------------------------------------------ world drawing
  drawWorld(ctx) {
    const h = this.hook;
    const f = this.fish;
    if (this.battle?.event) this.battle.event.drawWorld(ctx);
    if ((this.state === 'fight' || (this.state === 'landing' && this.finale?.stage === 'surface')) && f) {
      const m = f.anchors?.mouth || [f.x, f.y];
      const [rx, ry] = this.rodTip();
      this.drawRope(ctx, rx, ry, m[0], m[1], this.tension, true);
    } else if (h.visible) {
      const [rx, ry] = this.rodTip();
      this.drawRope(ctx, rx, ry, h.x, h.y - 5, 0.2, false);
      this.drawHookAndBait(ctx);
    }
    if (!this.hostCine) this.drawCinematicWorld(ctx);
  }

  drawCinematic(ctx) {
    this.hostCine = true;
    this.drawCinematicWorld(ctx);
  }

  drawCinematicWorld(ctx) {
    const B = this.battle;
    if (B?.trick?.kind === 'spit') drawShots(ctx, B.trick.shots, 'bubble');
    if (B?.trick?.kind === 'hop' && this.fish) {
      const f = this.fish;
      drawCircle(ctx, f.x, f.y, 10 + Math.sin(this.t * 12) * 2, '#9ad8ff', 0.8, 1, 8, this.t * 3);
    }
    if (B?.glitchT > 0 && this.fish) {
      const f = this.fish;
      ctx.fillStyle = rgba('#ff3a7a', 0.5); ctx.fillRect(Math.round(f.x - 10), Math.round(f.y - 4), 20, 2);
      ctx.fillStyle = rgba('#3affd8', 0.5); ctx.fillRect(Math.round(f.x - 8), Math.round(f.y + 3), 16, 2);
    }
    this.finale?.drawWorld(ctx);
    this.cine?.drawWorld?.(ctx);
  }

  drawRope(ctx, x0, y0, x1, y1, tension, fight, alpha = 0.85) {
    const w = this.world;
    const surf = w.surfaceY ?? null;
    const d = dist(x0, y0, x1, y1);
    const sag = (1 - clamp01(tension)) * Math.min(40, d * 0.18);
    const vib = fight && tension > 0.75 ? Math.sin(this.t * 60) * (tension - 0.75) * 6 : 0;
    const mx = (x0 + x1) / 2 + vib, my = (y0 + y1) / 2 + sag;
    const steps = Math.max(4, Math.ceil(d / 1.5));
    let col = '#e8f4ff';
    if (fight) col = tension > 0.92 ? '#ff6a5a' : tension > 0.75 ? '#ffd25a' : '#e8f4ff';
    // glints travelling up the line while reeling
    const reel = fight ? this.crank.power : 0;
    const glintPhase = (this.t * (0.6 + reel * 2.2)) % 1;
    let px = null, py = null;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = Math.round((1 - t) * (1 - t) * x0 + 2 * (1 - t) * t * mx + t * t * x1);
      const y = Math.round((1 - t) * (1 - t) * y0 + 2 * (1 - t) * t * my + t * t * y1);
      if (x === px && y === py) continue;
      const under = surf === null || y > surf;
      const glint = reel > 0.15 && Math.abs(((1 - t) - glintPhase + 1) % 0.25) < 0.012;
      ctx.fillStyle = glint ? '#ffffff' : rgba(col, under ? alpha * 0.8 : alpha);
      ctx.fillRect(x, y, 1, 1);
      if (surf !== null && py !== null && (py <= surf) !== (y <= surf)) {
        // little ripple where the line enters the water
        const r = 3 + Math.sin(this.t * 4) * 1;
        ctx.fillStyle = rgba('#ffffff', 0.6);
        ctx.fillRect(Math.round(x - r), surf + 1, 2, 1);
        ctx.fillRect(Math.round(x + r - 1), surf + 1, 2, 1);
      }
      px = x; py = y;
    }
  }

  drawHookAndBait(ctx) {
    const h = this.hook, g = this.game;
    const x = Math.round(h.x), y = Math.round(h.y);
    ctx.save();
    ctx.translate(x, y - 5);
    ctx.rotate(h.angle * 0.6);
    ctx.drawImage(HOOK, -3, 0);
    ctx.restore();
    const bait = g.currentBait();
    if (!bait) return;
    const bx = Math.round(h.x + Math.sin(h.angle * 0.6) * 4 + this.baitSwing * 4), by = Math.round(h.y + 8);
    const spr = bait.kind === 'icon' ? bait.mini : baitSprite(bait.type, this.t);
    if (spr) {
      ctx.drawImage(spr, bx - Math.floor(spr.width / 2), by - 2 + Math.round(Math.sin(this.t * 3) * 0.6));
      if (bait.type === 'golden' || bait.type === 'lantern') {
        if (rng.chance(0.15)) this.particles.sparkle(bx + rng.float(-5, 5), by + rng.float(-3, 6), bait.type === 'golden' ? '#fff3a8' : '#a8fff0');
      }
    }
  }

  // ------------------------------------------------------------------ screen drawing
  drawHud(ctx) {
    if (this.state === 'fight' && this.battle && this.fish) drawFightScene(ctx, this, this.battle);
    if (this.state === 'bite' && this.fish) {
      const f = this.fish;
      const k = this.biteT / this.biteMax;
      const [sx, sy] = this.toScreen(f.x, f.y);
      const z = this.zoom();
      const top = sy - 22 * f.scale * z;
      drawText(ctx, 'CLICK!', sx, top - 16, { align: 'center', color: '#ffe27a', outline: '#3a1a0a', scale: 2, wave: 1, time: this.t });
      ctx.fillStyle = '#0b1622'; ctx.fillRect(Math.round(sx - 17), Math.round(top + 1), 34, 5);
      ctx.fillStyle = '#ffe27a'; ctx.fillRect(Math.round(sx - 16), Math.round(top + 2), Math.round(32 * k), 3);
    }
    if (this.msg) {
      const m = this.msg;
      const a = Math.min(1, (m.max - m.t) * 3);
      ctx.globalAlpha = a;
      const y = this.input.y - 40 - m.t * 12;
      drawText(ctx, m.text, this.input.x, y, { align: 'center', color: m.color, outline: '#14202c', scale: m.big ? 2 : 1 });
      ctx.globalAlpha = 1;
    }
    if (!this.hostCineHud) this.drawCinematicHudInner(ctx);
  }

  drawCinematicHud(ctx) {
    this.hostCineHud = true;
    this.drawCinematicHudInner(ctx);
  }

  drawCinematicHudInner(ctx) {
    if (this.state === 'fight' && this.battle && this.fish) drawFightBands(ctx, this, this.battle);
    this.finale?.drawHud(ctx);
    this.cine?.drawHud?.(ctx);
    this.fx.draw(ctx, 'fg', this.t);
    this.titles.draw(ctx);
  }
}

export { drawCircle };
