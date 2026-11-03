// Fishing controller: hook & line, one-time bait, nibbles, bites, the slow-mo hook-set, the reel fight
// (battle.js: crank the physical reel, directional surge QTE, SHOCK; species events in minigames.js),
// floating boxes (boxreel.js), the slow-motion landing finale and the escape cutscene (cinematics.js),
// and the fight HUD (hud.js + the physical reel in reel.js).
//
// Rod stats (src/game/rods.js rodStats(state, game.stats)) drive everything:
//   lureSpeed -> bite wait (fish notice / sniff / nibble faster, bigger lure radius)
//   luck      -> rarity (luckMul(); game.js multiplies world.rarityBoost by it)
//   control   -> sweet zone width, QTE forgiveness       resilience -> progress kept when the fish wins
//   strength  -> fish heavier than this put the line at risk         shock -> charges / stun / cooldown
// Bait is ONE-TIME USE (src/store/bait.js via game.currentBait()/consumeBait()): one is used at hook-set.
// No bait = a bare hook: fish still bite, attraction is weaker.
//
// Public API (game.js, tutorial, browser overlay): update(dt, worldInput), drawWorld(ctx) [world
// space], drawHud(ctx) [screen space], drawCinematic(ctx) [world space, after fish],
// drawCinematicHud(ctx) [screen space, above the HUD], requestNibble(fish), releaseFish(flee),
// setHook(auto), message(text), crankHint(), luckMul(), landBox(f), and the fields state ('idle'|'nibble'|
// 'bite'|'fight'|'landing'|'box'), busy, fighting, hook {x, y, visible}, tension, rod, reel.
// If the host never calls drawCinematic/drawCinematicHud, drawWorld/drawHud draw them instead.
// Emits through game.onHooked / onFishCaught / onFishEscaped (game.emit 'hooked' | 'caught' | 'escaped').

import { TAU, clamp, clamp01, dist, damp, lerp } from '../core/math.js';
import { rng } from '../core/rng.js';
import { rgba } from '../core/color.js';
import { Particles, glowSprite, drawBolt, boltPoints } from '../gfx/particles.js';
import { drawFishRig } from '../gfx/fishrig.js';
import { HOOK, baitSprite } from './baitart.js';
import { Crank } from './crank.js';
import { Battle, DEFAULT_ROD } from './battle.js';
import { drawShots, drawCircle } from './minigames.js';
import { Titles, Finale, EscapeCine, Outro } from './cinematics.js';
import { drawFightScene, drawFightBands, drawBiteCue, drawMessage } from './hud.js';
import { Reel } from './reel.js';
import { BoxReel, landBoxLoot, drawBoxHover } from './boxreel.js';
import { rodStats } from '../game/rods.js';

// A bare hook: no bait equipped. Fish still notice it, just much less eagerly.
const BARE = { kind: 'bare', type: 'bare', id: null, label: 'Bare hook', mods: { attract: 0.55, rarity: 1, sizeBonus: 0, giantMul: 1, luck: 0 } };

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
    this.box = null;
    this.tension = 0;
    this.msg = null;
    this.wasInWater = false;
    this.jig = 0;
    this.cursor = game.world.cursor;
    this.input = game.input;
    this.crank = new Crank();
    this.reel = new Reel(this);
    this.fx = new Particles(900); // screen-space effects for the HUD and titles
    this.fx.surfaceY = null;
    this.titles = new Titles(this);
    this.splats = [];
    this.pose = null; this.poseHold = null;
    this.scrolled = false;
    this.hostCine = false; this.hostCineHud = false;
    this.loops = null;
    this.rodC = null; this.rodT = 0;
    this.shockGrab = false;
    this.leanX = 0; this.leanY = 0;
    this.zapLine = null; // the shock travelling down the line {t, dur}
    this.boxHover = null;
    this.lostBait = null;
  }

  // ------------------------------------------------------------------ accessors
  get stats() { return this.game.stats; }
  get busy() { return this.state !== 'idle' || !!this.cine; }
  get fighting() { return this.state === 'fight' || this.state === 'landing' || this.state === 'box'; }
  get fight() { return this.battle; }
  get cam() { return this.game.camera; }
  get boat() { return this.game.boat || null; }
  get particles() { return this.game.particles; }
  get W() { return this.game.screen?.W ?? this.world.W; }
  get H() { return this.game.screen?.H ?? this.world.H; }
  // Equipped rod stats (rods.js rodStats merged with Lab bonuses); refreshed about once a second.
  get rod() { return this.rodC || (this.rodC = this.rodNow()); }

  rodNow() {
    const g = this.game;
    try { if (g.state) return rodStats(g.state, g.stats) || DEFAULT_ROD; } catch (e) { /* mock hosts */ }
    return DEFAULT_ROD;
  }

  lureK() { return clamp(this.rod.lureSpeed || 1, 0.5, 3); }

  // Rarity multiplier from the rod's luck (and the bait's luck bonus). game.js: world.rarityBoost *= luckMul().
  luckMul() {
    const b = this.game.currentBait?.();
    return clamp((this.rod.luck || 1) * (1 + (b?.mods?.luck || 0)), 0.2, 12);
  }

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

  // Camera focus that never shows past the edges of a world without water above (desktop intro).
  focusCam(x, y, zoom, speed) {
    const c = this.cam;
    if (!c?.focus) return;
    if (this.world.surfaceY === null || this.world.surfaceY === undefined) {
      const top = c.scrollY ?? 0, half = this.H / (2 * zoom);
      y = clamp(y, top + half, top + this.H - half);
    }
    c.focus(x, y, zoom, speed);
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
    return { x: clamp(f.x, 60, w.W - 60), y: this.viewTop() + this.H * 0.38 };
  }

  // Start the current species event now (debug / older test drivers).
  startPhase() {
    const B = this.battle;
    if (!B) return;
    const name = B.phases[B.pi];
    if (name && name !== 'tension') B.startEvent(name);
  }

  crankHint() {
    if (this.box) return this.box.crankHint();
    return this.battle ? this.battle.crankHint() : [this.input.x, this.input.y];
  }

  // ------------------------------------------------------------------ nibble API
  // Called by fish AI when it wants to start nibbling.
  requestNibble(fish) {
    if (this.state !== 'idle' || this.cine || !this.world.hook.active) return false;
    this.fish = fish;
    fish.controlled = true;
    fish.allowTurn = true;
    this.state = 'nibble';
    const sp = fish.sp, lure = this.lureK();
    const [n0, n1] = sp.fight?.nibbles || [1, 3];
    this.nibblesLeft = Math.max(0, Math.round(rng.int(n0, n1) / Math.sqrt(lure)));
    this.nibbleT = rng.float(0.35, 0.8) / lure;
    this.nibblePhase = 0;
    this.fakeBite = rng.chance((sp.fight?.fakeBite ?? 0.15) / lure);
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
    if (this.box) this.box.cancel();
    this.box = null;
    this.fish = null;
    this.battle = null;
    this.finale = null;
    this.cine = null;
    this.zapLine = null;
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

  // A small icon pop at a screen point (instead of text): kind 'miss' | 'early' | 'spook' | 'zap'.
  iconPop(kind, x, y) {
    const fx = this.fx;
    if (kind === 'early' || kind === 'miss') {
      fx.ringWave(x, y, 16, '#ff8a7a', { life: 0.35, w: 2 });
      fx.burst(x, y, 8, { colors: ['#ffffff', '#ff8a7a'], speed: 60, g: 0, life: 0.35 });
    } else if (kind === 'spook') {
      fx.ringWave(x, y, 22, '#ffe27a', { life: 0.4, w: 2 });
      fx.speedLines(x, y, 10, { r0: 6, r1: 16, len: [4, 9], color: '#ffffff', life: 0.3 });
    }
    this.titles.pop(kind === 'early' ? '!' : kind === 'spook' ? '!!' : '?', x, y - 14, kind === 'spook' ? '#ffe27a' : '#ff8a7a', { scale: 2 });
  }

  // ------------------------------------------------------------------ update
  update(dt, worldInput) {
    this.t += dt;
    const g = this.game, w = this.world, inp = this.input, c = this.cursor, h = this.hook;
    const ts = g.timeScale;
    const rdt = Math.min(0.1, ts && ts > 0.05 ? dt / ts : dt);
    this.rdt = rdt;
    this.rodT -= rdt;
    if (this.rodT <= 0) { this.rodT = 1; this.rodC = this.rodNow(); }
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
    if (this.lostBait) { this.lostBait.t += rdt; if (this.lostBait.t > 1.2) this.lostBait = null; }

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
      this.particles.aeroBubbles?.(h.x, surf + 6, 3, { w: 3, sizes: [2, 2, 3] });
      if (g.state?.stats) g.state.stats.casts++;
      if (this.boat) this.setPose('cast', 0.45);
    }
    this.wasInWater = inWater;
    const bait = g.currentBait();
    w.hook.x = h.x; w.hook.y = h.y;
    w.hook.active = h.visible && canHook && this.state === 'idle';
    w.hook.inWater = inWater;
    w.hook.bait = bait || BARE;
    w.hook.radiusMul = (this.stats?.baitRadius ?? 1) * (bait ? 1 : 0.6) * (0.85 + 0.15 * this.lureK());
    if (w.hook.active && inWater) this.lureAssist(dt);

    // floating boxes under the hook
    this.boxHover = null;
    if (this.state === 'idle' && canHook && inWater && g.floaters?.hitHook) {
      try { this.boxHover = g.floaters.hitHook(h.x, h.y, 7) || null; } catch (e) { this.boxHover = null; }
      if (this.boxHover?.hooked) this.boxHover = null;
    }

    switch (this.state) {
      case 'idle':
        if (canHook && inWater && inp.pressed && !g.ui?.blocking) {
          if (this.boxHover) { this.startBox(this.boxHover); break; }
          // jig the lure
          h.dip = -5;
          h.av += rng.float(-3, 3);
          this.jig = Math.min(1.5, this.jig + 0.35);
          this.sfx('bubble', { vol: 0.4, pitch: rng.float(1, 1.4) });
          this.particles.bubbles(h.x, h.y, 3);
          this.particles.aeroBubbles?.(h.x, h.y, 2, { w: 2, sizes: [2, 2, 3], speed: [20, 40] });
          this.particles.ring?.(h.x, h.y, 0.3, 'rgba(230,250,255,0.6)', { flat: 1 });
        }
        break;
      case 'nibble': this.updateNibble(dt, canHook); break;
      case 'bite': this.updateBite(dt, canHook); break;
      case 'fight': this.updateFight(dt); break;
      case 'landing': this.updateLanding(dt); break;
      case 'box': this.updateBox(dt); break;
      default: break;
    }
    if (this.zapLine) { this.zapLine.t += rdt; if (this.zapLine.t > this.zapLine.dur + 0.15) this.zapLine = null; }
    if (this.state === 'fight' || this.state === 'box') this.reel.update(rdt, this.battle || this.box);
    else this.reel.idle(rdt);
    if (this.cine && this.cine.update(dt, rdt) === 'done') this.cine = null;
    this.updateLoops();
  }

  // Faster lures (rod lureSpeed > 1): nearby fish notice, sniff and commit sooner.
  lureAssist(dt) {
    const k = this.lureK() - 1;
    if (k <= 0.01) return;
    const list = this.game.school?.fishes || this.world.fishes || [];
    for (const f of list) {
      if (f.controlled) continue;
      if (f.state === 'sniff' && f.sniffT > 0) f.sniffT -= dt * k;
      else if (f.noticeT > 0) f.noticeT -= dt * k;
    }
  }

  updateLoops() {
    const fighting = (this.state === 'fight' && !!this.battle) || this.state === 'box';
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
    if (this.cursor.speed > 260 * (this.stats?.calm ?? 1)) {
      this.iconPop('spook', ...this.toScreen(f.x, f.y));
      this.releaseFish(true, '!');
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
        this.particles.glint?.(h.x + rng.float(-3, 3), h.y + rng.float(-2, 4), { len: 3 });
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
        this.nibbleT = rng.float(0.45, 1.1) / this.lureK();
        if (this.fakeBite && this.nibblesLeft === 1) { h.dip = 8; f.say('!', 0.4); this.sfx('nibble', { pitch: 0.7 }); this.fakeBite = false; }
      } else {
        this.state = 'bite';
        this.biteT = (f.sp.fight?.biteWindow ?? 0.6) * (this.stats?.biteWindow ?? 1) * (g.tutorialActive ? 2.5 : 1);
        this.biteMax = this.biteT;
        h.dip = 10;
        f.say('!', this.biteT + 0.2);
        f.feel('determined', 1);
        f.chompT = 0.3;
        this.sfx('bite');
        this.particles.bubbles(h.x, h.y, 6);
        this.particles.aeroBubbles?.(h.x, h.y, 4, { w: 4, sizes: [2, 3, 3, 4] });
        this.particles.ringWave?.(h.x, h.y, 16, '#ffe27a', { life: 0.3, w: 2 });
        if (rng.chance(this.stats?.autoHook ?? 0)) { this.setHook(true); return; }
      }
    }
    if (inp.pressed && !g.ui?.blocking && this.state === 'nibble') {
      this.iconPop('early', inp.x, inp.y);
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
      this.iconPop('miss', ...this.toScreen(f.x, f.y));
      this.sfx('escape', { vol: 0.6 });
      this.releaseFish(true, 'music');
    }
  }

  // ------------------------------------------------------------------ hook-set
  setHook(auto = false) {
    const g = this.game, f = this.fish;
    if (!f || this.state === 'fight' || this.state === 'landing') return;
    this.sp = f.sp;
    this.rodC = this.rodNow();
    // one-time bait: used up the moment the hook bites
    const bait = g.currentBait?.() || null;
    this.usedBait = bait;
    if (bait) {
      try { g.consumeBait?.(bait.type); } catch (e) { console.error(e); }
      const [bx, by] = this.toScreen(this.hook.x, this.hook.y + 8);
      this.lostBait = { t: 0, x: bx, y: by, spr: bait.mini || baitSprite(bait.type, this.t) };
    }
    this.state = 'fight';
    this.cine = null;
    this.crank.prevA = null;
    this.battle = new Battle(this);
    this.power = this.battle.power;
    this.tension = this.battle.tension;
    this.splats = [];
    this.reel.reset();
    this.leanX = 0; this.leanY = 0;
    // cinematic: slow-mo punch-in with letterbox
    const cam = this.cam;
    const zoomIn = this.fightZoom() + 0.3;
    this.focusCam(f.x, f.y, zoomIn, 6);
    cam?.setLetterbox?.(true);
    cam?.slowmo?.(0.22, 0.55);
    cam?.flash?.('#e8fbff', 0.35);
    this.shake(5);
    this.sfx('hookset');
    this.sfx('splash_small', { vol: 0.6, pitch: 0.8 });
    const P = this.particles;
    P.ringWave?.(f.x, f.y, 34, '#ffffff', { life: 0.5, w: 3 });
    P.ringWave?.(f.x, f.y, 22, '#8ff0ff', { life: 0.35, w: 2, delay: 0.06 });
    P.speedLines?.(f.x, f.y, 18, { r0: 26, r1: 60, inward: true, len: [8, 18], color: '#ffffff' });
    P.burst(f.x, f.y, 14, { colors: ['#ffffff', '#bff8ff', '#c8f56a'], speed: 80, g: 0, life: 0.45 });
    P.aeroBubbles?.(f.x, f.y, 10, { w: 8, h: 6 });
    P.glints?.(f.x, f.y, 5, { w: 14, h: 10 });
    P.scales?.(f.x, f.y, 4, this.scaleColors());
    const surf = this.world.surfaceY;
    if (surf !== null && surf !== undefined && f.y - surf < 40) P.eruption?.(f.x, surf, 0.6);
    const [sx, sy] = this.toScreen(f.x, f.y);
    const W = this.W, H = this.H;
    this.fx.speedLines(W / 2, H / 2, 34, { r0: Math.min(W, H) * 0.35, r1: Math.max(W, H) * 0.6, inward: true, speed: [400, 700], len: [20, 46], color: '#ffffff', life: 0.35 });
    this.fx.lensFlare(sx, sy, { cx: W / 2, cy: H / 2, life: 0.9, scale: 0.9 });
    this.titles.add('fishon', auto ? 'AUTO!' : 'FISH ON!', { rarity: f.sp.rarity });
    f.feel('surprised', 0.8);
    f.squashV += 10;
    f.say('!!', 0.8);
    this.setPose('yank', 0.35);
    this.setPose('pull');
    g.onHooked?.(f);
  }

  tryShock() {
    const B = this.battle;
    if (!B) return false;
    return B.shock();
  }

  updateFight(dt) {
    const g = this.game, B = this.battle, f = this.fish, inp = this.input;
    if (!B || !f) { this.releaseFish(false); return; }
    // SHOCK: the reel's button, right mouse or Space
    const onBtn = inp.pressed && this.reel.hitShock(inp.x, inp.y);
    if (onBtn) { this.shockGrab = true; this.reel.btnPress = 1; inp.consume?.(); }
    if (this.shockGrab && !inp.down) this.shockGrab = false;
    if (onBtn || inp.rpressed || inp.keyPressed?.(' ')) this.tryShock();
    g.timeScaleTarget = 1;
    const r = B.update(dt);
    this.tension = B.tension;
    f.controlled = true;
    // the stunned fish crackles
    if (B.stunned && rng.chance(dt * 26)) {
      const R = this.fishLen() * 0.45;
      this.particles.electrify?.(f.x + rng.float(-R, R) * 0.5, f.y + rng.float(-3, 3), R, 1, { sparks: rng.chance(0.5) ? 2 : 0 });
    }
    // camera: follows the fish (or what the event wants to show), leaning into a surge
    const q = B.qte;
    if (q) this.leanDir = q.dir;
    let zoom = this.fightZoom();
    if (B.mode === 'hookset') zoom += 0.3;
    if (B.trick?.kind === 'jump') zoom = 1.55;
    if (B.mode === 'surge' && B.surgeMul > 1.5) zoom -= 0.15;
    const back = q?.active ? clamp01(q.k * 1.6) : 0;
    const lk = B.lean * (1 - back * 1.8);
    const ld = this.leanDir ?? 0;
    this.leanX = damp(this.leanX, Math.cos(ld) * lk * 34, 5, dt);
    this.leanY = damp(this.leanY, Math.sin(ld) * lk * 20, 5, dt);
    const ev = B.event?.focus;
    if (ev) this.focusCam(ev.x, ev.y, ev.zoom, 4);
    else this.focusCam(f.x + this.leanX / zoom, f.y + this.leanY / zoom, zoom - Math.abs(lk) * 0.12, B.mode === 'hookset' ? 6 : 4);
    // character pose from what the player is doing
    if (!this.poseHold) {
      const pose = q?.holding ? 'pull' : this.crank.active || B.stunned ? 'reel' : 'pull';
      if (pose !== this.pose) this.setPose(pose);
    }
    if (r === 'ok') return;
    if (r === 'land') this.beginLanding();
    else this.fail(r);
  }

  // ------------------------------------------------------------------ battle callbacks (juice)
  fishScreen() { const f = this.fish; return f ? this.toScreen(f.x, f.y) : [this.W / 2, this.H / 2]; }

  onCounter(win, dir, combo) {
    const f = this.fish, P = this.particles, fx = this.fx;
    if (!f) return;
    const [sx, sy] = this.fishScreen();
    const px = this.input.x, py = this.input.y;
    if (win) {
      this.sfx(combo > 1 ? 'timing_perfect' : 'timing_good', { pitch: 1 + Math.min(0.5, combo * 0.08) });
      this.sfx('splash_small', { vol: 0.5, pitch: 1.2 });
      this.shake(3 + Math.min(3, combo));
      P.ringWave?.(f.x, f.y, 26, '#c8f56a', { life: 0.4, w: 3 });
      P.stars?.(f.x, f.y, 8 + combo * 2, { speed: [30, 90], colors: ['#ffffff', '#e2ffb0', '#8be04a'] });
      P.aeroBubbles?.(f.x, f.y, 6, { w: 6 });
      fx.ringWave(px, py, 34, '#8be04a', { life: 0.4, w: 4 });
      fx.lightStreaks(px, py, 10, { dir: dir + Math.PI, spread: 0.5, colors: ['#e2ffb0', '#ffffff', '#8be04a'] });
      fx.glints(px, py, 4, { w: 20, h: 14, color: '#e2ffb0' });
      if (combo > 1) this.titles.pop('x' + combo, sx, sy - this.zoneRadius() * 0.6, '#c8f56a', { scale: 2 });
      this.setPose('yank', 0.3);
      this.reel.kick(1);
    } else {
      this.sfx('timing_miss');
      this.sfx('reel_tick', { pitch: 0.5, vol: 0.5 });
      this.shake(5);
      this.cam?.flash?.('#ff9a8a', 0.18);
      const [rx, ry] = this.rodTip();
      P.sparks?.(rx, ry, 8, { speed: [40, 120], colors: ['#ffffff', '#ffd23a', '#ff9a3a'] });
      fx.ringWave(px, py, 24, '#ff6a5a', { life: 0.35, w: 3 });
      this.reel.strain = 1;
    }
  }

  onShockFire() {
    const B = this.battle;
    this.zapLine = { t: 0, dur: B?.zap?.dur ?? 0.2 };
    this.reel.fire = 1; this.reel.btnPress = 1;
    this.sfx('static_burst', { vol: 0.8, pitch: 1.2 });
    this.sfx('neon_buzz', { vol: 0.5, pitch: 1.6 });
    const L = this.reel.lay;
    if (L) {
      this.fx.electrify(L.bx, L.by, L.br + 6, 4, { flat: 1, sparks: 8 });
      this.fx.ringWave(L.bx, L.by, L.br + 16, '#fff07a', { life: 0.3, w: 3 });
    }
    const [rx, ry] = this.rodTip();
    this.particles.electrify?.(rx, ry, 8, 2, { flat: 1 });
  }

  onStun() {
    const f = this.fish, P = this.particles, B = this.battle;
    if (!f) return;
    const R = this.fishLen() * 0.55;
    P.electrify?.(f.x, f.y, R, 7, { sparks: 10 });
    P.ringWave?.(f.x, f.y, R + 16, '#bff8ff', { life: 0.45, w: 3 });
    P.ringWave?.(f.x, f.y, R + 6, '#fff07a', { life: 0.3, w: 2, delay: 0.05 });
    P.aeroBubbles?.(f.x, f.y, 8, { w: R * 0.6, sizes: [2, 2, 3, 4] });
    P.glints?.(f.x, f.y, 5, { w: R, h: R * 0.5, color: '#bff8ff' });
    this.cam?.flash?.('#bff8ff', 0.4);
    this.cam?.punch?.(f.x, f.y, 0.08, 0.3);
    this.shake(6);
    this.sfx('thunder', { vol: 0.35, pitch: 1.6 });
    this.sfx('glitch', { vol: 0.5 });
    f.say('!!', 0.6);
    const [sx, sy] = this.fishScreen();
    this.fx.lensFlare(sx, sy, { cx: this.W / 2, cy: this.H / 2, life: 0.6, scale: 0.6, tint: '#bff8ff' });
    void B;
  }

  onShockFizzle() {
    this.sfx('ui_error', { vol: 0.4 });
    this.reel.denied = 1;
    const L = this.reel.lay;
    if (L) this.fx.burst(L.bx, L.by, 6, { colors: ['#c8d4dc', '#ffffff'], speed: 40, g: 0, life: 0.25 });
  }

  onTele() {
    const f = this.fish;
    if (!f) return;
    this.particles.glints?.(f.x, f.y, 2, { w: 8, h: 6, color: '#ffd0b0' });
  }

  onSurge(dir) {
    const f = this.fish;
    if (!f) return;
    this.particles.ringWave?.(f.x, f.y, 20, '#ffb08a', { life: 0.3, w: 2, flat: 0.6 });
    this.reel.strain = Math.max(this.reel.strain, 0.6);
    void dir;
  }

  onTrick(kind, title) {
    const f = this.fish;
    if (!f || !title) return;
    const [sx, sy] = this.fishScreen();
    this.titles.pop(title, sx, sy - this.zoneRadius() * 0.7, kind === 'jump' ? '#8ff0ff' : '#ffd0b0', { scale: 2 });
  }

  onTrickDone(ok) {
    const [sx, sy] = this.fishScreen();
    if (ok) { this.fx.stars(sx, sy, 10, { speed: [40, 120] }); this.fx.ringWave(sx, sy, 30, '#c8f56a', { life: 0.35, w: 3 }); }
    else this.fx.ringWave(sx, sy, 26, '#ff6a5a', { life: 0.35, w: 3 });
  }

  onJumpLand(ok) {
    const [sx, sy] = this.fishScreen();
    if (ok) this.fx.aeroBubbles(sx, sy, 8, { w: 20, speed: [40, 90] });
    else { this.reel.strain = 1; this.cam?.flash?.('#ff9a8a', 0.2); }
  }

  onExhausted() {
    const f = this.fish;
    if (!f) return;
    this.particles.stars?.(f.x, f.y - 6, 10, { speed: [20, 60], g: -10 });
    this.particles.ringWave?.(f.x, f.y, 24, '#ffe27a', { life: 0.5, w: 2 });
    this.sfx('magic', { vol: 0.5 });
  }

  onRecovered() {
    const f = this.fish;
    if (f) this.particles.ringWave?.(f.x, f.y, 22, '#ff8a7a', { life: 0.4, w: 2 });
    this.sfx('grunt', { vol: 0.5 });
  }

  onLineOut() { this.reel.strain = 1; }

  onEventStart(ev) {
    this.titles.banner(ev.title || '', ev.color || '#8ff0ff', '', { icon: ev.name });
  }

  onEventEnd(ev, ok) {
    const [sx, sy] = this.fishScreen();
    if (ok) {
      this.titles.pop(ev.winText || 'NICE!', sx, sy - this.zoneRadius() * 0.7, '#c8f56a', { scale: 2 });
      this.fx.aeroConfetti(sx, sy, 18, { speed: [60, 160] });
    } else this.fx.ringWave(sx, sy, 30, '#ff6a5a', { life: 0.4, w: 3 });
  }

  // ------------------------------------------------------------------ outcomes
  fail(reason) {
    const g = this.game, f = this.fish;
    if (g.timeScaleTarget !== undefined) g.timeScaleTarget = 1;
    const m = f.anchors?.mouth || [f.x, f.y];
    const [rx, ry] = this.rodTip();
    const line = { x0: rx, y0: ry, x1: m[0], y1: m[1] };
    if (reason === 'snap') {
      this.sfx('line_snap');
      if (g.state?.stats) g.state.stats.snapped++;
    } else this.sfx('escape');
    if (g.state?.stats) g.state.stats.escaped++;
    this.particles.burst(m[0], m[1], 10, { colors: ['#ffffff', '#9ad8ff'], speed: 60, g: 0, life: 0.4 });
    this.stopLoops();
    this.state = 'idle';
    this.fish = null;
    this.battle = null;
    this.tension = 0;
    this.splats = [];
    this.zapLine = null;
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
    this.zapLine = null;
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

  // ------------------------------------------------------------------ floating boxes
  startBox(f) {
    const g = this.game;
    this.state = 'box';
    this.box = new BoxReel(this, f);
    this.reel.reset();
    this.crank.prevA = null;
    g.emit?.('boxHooked', f);
  }

  updateBox(dt) {
    const B = this.box;
    if (!B) { this.state = 'idle'; return; }
    const r = B.update(dt);
    this.tension = B.tension;
    if (r === 'ok') return;
    const f = B.f;
    this.box = null;
    this.state = 'idle';
    this.tension = 0;
    this.stopLoops();
    this.cam?.release?.(3);
    this.cam?.setLetterbox?.(false);
    this.restoreScroll();
    this.setPose('cheer', 1.2);
    if (r === 'caught') {
      const g = this.game;
      try { if (g.onBoxCaught) g.onBoxCaught(f); else this.landBox(f); } catch (e) { console.error(e); }
    }
  }

  // Loot for a reeled-in box (game.onBoxCaught delegates here): take it, roll + grant loot, glossy pop-up.
  landBox(f) {
    const g = this.game;
    try { g.floaters?.take?.(f); } catch (e) { console.error(e); }
    return landBoxLoot(this, f);
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
    } else if (this.state === 'box' && this.box) {
      this.box.drawWorld(ctx);
    } else if (h.visible) {
      const [rx, ry] = this.rodTip();
      this.drawRope(ctx, rx, ry, h.x, h.y - 5, 0.2, false);
      this.drawHookAndBait(ctx);
      if (this.boxHover) drawBoxHover(ctx, this, this.boxHover);
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
    if (B && this.fish && (B.stunned || B.zap)) this.drawStunnedFish(ctx, B);
    this.finale?.drawWorld(ctx);
    this.cine?.drawWorld?.(ctx);
  }

  // Electric outline flash + twitching glow over the stunned fish (drawn after the fish itself).
  drawStunnedFish(ctx, B) {
    const f = this.fish;
    if (!f.c || f.alpha <= 0) return;
    const k = B.stunned ? clamp01(B.stunT / Math.max(0.01, B.stunMax)) : 1;
    const flick = Math.floor(this.t * 24) % 3;
    const r = this.fishLen() * 0.7;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.25 + 0.25 * k + (flick === 0 ? 0.2 : 0);
    ctx.drawImage(glowSprite(r, '#7ff4ff'), Math.round(f.x - r), Math.round(f.y - r));
    ctx.restore();
    try {
      const col = flick === 0 ? '#ffffff' : flick === 1 ? '#7ff4ff' : '#fff07a';
      const base = f.rigState({ silhouette: col });
      const o = 1;
      for (const [dx, dy] of [[-o, 0], [o, 0], [0, -o], [0, o]]) drawFishRig(ctx, f.c, { ...base, x: base.x + dx, y: base.y + dy });
      const st = f.rigState(flick === 0 ? { wash: { color: '#e8ffff', alpha: 0.75 * k } } : {});
      drawFishRig(ctx, f.c, st);
    } catch (e) { /* the overlay rig may not support silhouettes */ }
    // skeleton-flash frames: brief bright arcs across the body
    if (flick === 0 && B.stunned) {
      const L = this.fishLen() * 0.5;
      drawBolt(ctx, boltPoints(f.x - L, f.y + rng.float(-3, 3), f.x + L, f.y + rng.float(-3, 3), 3, (this.t * 997) >>> 0), 0.8);
    }
  }

  drawRope(ctx, x0, y0, x1, y1, tension, fight, alpha = 0.85) {
    const w = this.world;
    const surf = w.surfaceY ?? null;
    const d = dist(x0, y0, x1, y1);
    const T = clamp01(tension);
    const sag = (1 - T) * Math.min(40, d * 0.18);
    const B = this.battle;
    // line vibration: buzzes with tension, thrums during surges
    const amp = fight ? Math.max(0, T - 0.6) * 5 + (B?.surging && !B.stunned ? 0.8 : 0) + (B?.stunned ? 0.7 : 0) : 0;
    const mx = (x0 + x1) / 2, my = (y0 + y1) / 2 + sag;
    const steps = Math.max(4, Math.ceil(d / 1.5));
    let col = '#e8f4ff';
    if (fight) col = tension > 0.92 ? '#ff6a5a' : tension > 0.75 ? '#ffd25a' : '#e8f4ff';
    if (B?.stunned) col = Math.floor(this.t * 20) % 2 ? '#bff8ff' : '#ffffff';
    const L = d || 1, nx = -(y1 - y0) / L, ny = (x1 - x0) / L;
    // glints travelling up the line while reeling
    const reel = fight ? this.crank.power : 0;
    const glintPhase = (this.t * (0.6 + reel * 2.2)) % 1;
    const zap = this.zapLine;
    const zk = zap ? clamp01(zap.t / zap.dur) : -1;
    const pts = [];
    let px = null, py = null;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const wv = amp ? Math.sin(t * Math.PI) * amp * Math.sin(this.t * 70 + t * 14) : 0;
      const x = Math.round((1 - t) * (1 - t) * x0 + 2 * (1 - t) * t * mx + t * t * x1 + nx * wv);
      const y = Math.round((1 - t) * (1 - t) * y0 + 2 * (1 - t) * t * my + t * t * y1 + ny * wv);
      if (zap && i % 4 === 0) pts.push([x, y, t]);
      if (x === px && y === py) continue;
      const under = surf === null || y > surf;
      const glint = reel > 0.15 && Math.abs(((1 - t) - glintPhase + 1) % 0.25) < 0.012;
      ctx.fillStyle = glint ? '#ffffff' : rgba(col, under ? alpha * 0.8 : alpha);
      ctx.fillRect(x, y, 1, 1);
      if (surf !== null && py !== null && (py <= surf) !== (y <= surf)) {
        // little ripple where the line enters the water; spray off a straining line
        const r = 3 + Math.sin(this.t * 4) * 1;
        ctx.fillStyle = rgba('#ffffff', 0.6);
        ctx.fillRect(Math.round(x - r), surf + 1, 2, 1);
        ctx.fillRect(Math.round(x + r - 1), surf + 1, 2, 1);
        if (fight && T > 0.7 && rng.chance(0.25 * T)) this.particles.droplets?.(x, surf, 1, { dir: -Math.PI / 2, spread: 0.9, speed: [20, 60], g: 260 });
      }
      px = x; py = y;
    }
    // the shock running down the line: a bright bolt head trailing arcs
    if (zap && zk >= 0 && pts.length > 1) {
      const head = Math.min(pts.length - 1, Math.floor(zk * (pts.length - 1)));
      const tail = Math.max(0, head - 8);
      const seg = pts.slice(tail, head + 1);
      if (seg.length > 1) {
        const jag = [];
        for (let i = 0; i < seg.length - 1; i++) {
          const b = boltPoints(seg[i][0], seg[i][1], seg[i + 1][0], seg[i + 1][1], 2.5, (this.t * 7919 + i * 31) >>> 0);
          for (const p of b) jag.push(p);
        }
        drawBolt(ctx, jag, 1);
      }
      const hp = pts[head];
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.drawImage(glowSprite(7, '#fff07a'), hp[0] - 7, hp[1] - 7);
      ctx.restore();
      if (rng.chance(0.6)) this.particles.sparks?.(hp[0], hp[1], 1, { speed: [20, 70], g: 120, colors: ['#ffffff', '#fff07a', '#7ff4ff'] });
    }
    // while stunned, little arcs hop along the line
    if (B?.stunned && rng.chance(0.35) && d > 10) {
      const u = rng.float(0.5, 0.95);
      const ax = lerp(x0, x1, u), ay = lerp(y0, y1, u) + sag * 4 * u * (1 - u);
      drawBolt(ctx, boltPoints(ax, ay, ax + rng.float(-8, 8), ay + rng.float(-8, 8), 3, rng.int(1, 1e9)), 0.7);
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
    if (!bait) {
      // bare hook: a tiny glint on the point
      if (Math.sin(this.t * 3) > 0.92) { ctx.fillStyle = '#ffffff'; ctx.fillRect(x + 1, y + 2, 1, 1); }
      return;
    }
    const bx = Math.round(h.x + Math.sin(h.angle * 0.6) * 4 + this.baitSwing * 4), by = Math.round(h.y + 8);
    const spr = bait.mini || baitSprite(bait.art || bait.type, this.t);
    if (spr) {
      ctx.drawImage(spr, bx - Math.floor(spr.width / 2), by - 2 + Math.round(Math.sin(this.t * 3) * 0.6));
      const fx = bait.effect || bait.type;
      if (fx === 'golden' || fx === 'lantern') {
        if (rng.chance(0.15)) this.particles.sparkle(bx + rng.float(-5, 5), by + rng.float(-3, 6), fx === 'golden' ? '#fff3a8' : '#a8fff0');
      }
    }
  }

  // ------------------------------------------------------------------ screen drawing
  drawHud(ctx) {
    if (this.state === 'fight' && this.battle && this.fish) drawFightScene(ctx, this, this.battle);
    if (this.state === 'box' && this.box) this.box.drawHud(ctx);
    if (this.state === 'bite' && this.fish) drawBiteCue(ctx, this);
    if (this.msg) drawMessage(ctx, this, this.msg);
    if (!this.hostCineHud) this.drawCinematicHudInner(ctx);
  }

  drawCinematicHud(ctx) {
    this.hostCineHud = true;
    this.drawCinematicHudInner(ctx);
  }

  drawCinematicHudInner(ctx) {
    if (this.state === 'fight' && this.battle && this.fish) drawFightBands(ctx, this, this.battle);
    if (this.state === 'box' && this.box) this.box.drawBands(ctx);
    this.finale?.drawHud(ctx);
    this.cine?.drawHud?.(ctx);
    this.drawLostBait(ctx);
    this.fx.draw(ctx, 'fg', this.t);
    this.titles.draw(ctx);
    this.box?.drawLoot?.(ctx);
    this.lootPop?.draw(ctx);
  }

  // The bait popping off the hook at hook-set (one-time use): spins up and bursts into bubbles.
  drawLostBait(ctx) {
    const b = this.lostBait;
    if (!b || !b.spr) return;
    const k = b.t / 1.2;
    const x = b.x + Math.sin(b.t * 9) * 4, y = b.y - b.t * 50;
    if (k > 0.55 && !b.popped) { b.popped = true; this.fx.aeroBubbles(x, y, 5, { w: 4, speed: [10, 30] }); this.fx.ringWave(x, y, 10, '#ffffff', { life: 0.25, w: 1 }); }
    if (b.popped) return;
    ctx.save();
    ctx.globalAlpha = clamp01((0.55 - k) * 4);
    ctx.translate(Math.round(x), Math.round(y));
    ctx.rotate(b.t * 8);
    ctx.drawImage(b.spr, -Math.floor(b.spr.width / 2), -Math.floor(b.spr.height / 2));
    ctx.restore();
  }
}

export { drawCircle, TAU };
