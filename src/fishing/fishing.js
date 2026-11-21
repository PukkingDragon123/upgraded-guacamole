// Fishing controller [simple24]: hook & line, one-time bait, nibbles, a bite you CLICK to hook (battle.js HookBite),
// the meter fight (battle.js: spin the 3D gear to keep the fish's marker in the middle of the meter; press the big
// SHOCK button on the beat), floating boxes (boxreel.js), the slow-motion landing finale and the escape cutscene
// (cinematics.js), and the fight HUD (hud.js + meter.js + the big 3D gear in gear.js).
//
// Controls: move the mouse into the water to cast, click to jig. When the fish bites (the big "!"), click (or Space).
// Then SPIN: circle the mouse (anywhere), roll the wheel, or hold / tap W / Up / R. The fish drags the marker left,
// spinning pushes it right: keep it in the green zone. When a shock is ready the marker freezes and a spark sweeps the
// meter: press Space / click as it crosses the gold notch (CRITICAL), in the green (GOOD); the red ends backfire.
//
// Rod stats (src/game/rods.js rodStats(state, game.stats)) drive everything:
//   lureSpeed -> bite wait (fish notice / sniff / nibble faster, bigger lure radius)
//   luck      -> rarity (luckMul(); game.js multiplies world.rarityBoost by it)
//   control   -> zone width, calmer pull, a wider gold notch     resilience -> less catch bar lost outside the zone
//   strength  -> fish heavier than this pull harder              shock -> power (damage + stun), charges, recharge
// Bait is ONE-TIME USE (src/store/bait.js via game.currentBait()/consumeBait()): one is used at hook-set.
// No bait = a bare hook: fish still bite, attraction is weaker.
//
// Public API (game.js, tutorial, browser overlay): update(dt, worldInput), drawWorld(ctx) [world
// space], drawHud(ctx) [screen space], drawCinematic(ctx) [world space, after fish],
// drawCinematicHud(ctx) [screen space, above the HUD], requestNibble(fish), releaseFish(flee),
// setHook(auto), message(text), crankHint(), luckMul(), landBox(f), partRect(kind) ('meter' | 'bar' | 'shock' | 'gear'),
// and the fields state ('idle'|'nibble'|'bite'|'fight'|'landing'|'box'), busy, fighting, hook {x, y, visible},
// tension, rod, gear (alias reel), hs (the HookBite while a fish bites).
// If the host never calls drawCinematic/drawCinematicHud, drawWorld/drawHud draw them instead.
// Emits through game.onHooked / onFishCaught / onFishEscaped (game.emit 'hooked' | 'caught' | 'escaped').
// [phase9:fishing] Bosses (boss.js): a BossDirector (this.boss) brings each ocean's boss to a hook in the deepest zone
// once its quest is active; the Battle carries a BossFight (health, phases, attacks); summonBoss(id?) for tests.
// All pop-ups are cinematic 3D voxel words (cinematics.js Titles / word3D), never flat 2D text.

import { TAU, clamp, clamp01, dist, damp, lerp } from '../core/math.js';
import { rng } from '../core/rng.js';
import { rgba } from '../core/color.js';
import { Particles, glowSprite, drawBolt, boltPoints } from '../gfx/particles.js';
import { drawFishRig } from '../gfx/fishrig.js';
import { HOOK, baitSprite, baitHook } from './baitart.js';
import { Crank } from './crank.js';
import { Battle, HookBite, DEFAULT_ROD } from './battle.js';
import { BossDirector, bossVictory } from './boss.js'; // [phase9:fishing] boss fights
import { meterLayout, meterRect, hitShockButton } from './meter.js'; // [simple24] the meter + SHOCK button
import { Titles, Finale, EscapeCine, Outro } from './cinematics.js';
import { drawFightScene, drawFightBands, drawBiteCue, drawMessage } from './hud.js';
import { Gear } from './gear.js';
import { BoxReel, landBoxLoot, drawBoxHover } from './boxreel.js';
import { rodStats, equippedRod } from '../game/rods.js';
import { SPECIES } from '../fish/species.js';

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
    this.gear = new Gear(this);
    this.reel = this.gear; // older name
    this.hs = null; // spin-to-hook while a fish bites
    this.holdKind = null; // what the current mouse-button hold is for: 'charge' | 'pull'
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
    this.boss = new BossDirector(this); // [phase9:fishing]
    this.bossWin = null; // the boss victory overlay
  }

  // ------------------------------------------------------------------ accessors
  get stats() { return this.game.stats; }
  get busy() { return this.state !== 'idle' || !!this.cine; }
  // (a bite counts: the mouse belongs to the gear while you spin to hook)
  get fighting() { return this.state === 'bite' || this.state === 'fight' || this.state === 'landing' || this.state === 'box'; }
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
    try {
      if (g.state) {
        this.rodLook = equippedRod(g.state)?.look || null;
        return rodStats(g.state, g.stats) || DEFAULT_ROD;
      }
    } catch (e) { /* mock hosts */ }
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
  viewTop() { const v = this.cam?.view?.(); return v ? v.y0 : this.cam?.scrollY ?? 0; } // [phase4:zoom] real view top

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
    if ((this.world.surfaceY === null || this.world.surfaceY === undefined) && !c.open) { // [phase4:zoom] the follow camera clamps to the world itself
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

  inkSplat(n = 3, o = {}) {
    for (let i = 0; i < n; i++) {
      this.splats.push({
        x: rng.float(this.W * 0.15, this.W * 0.85), y: rng.float(this.H * 0.18, this.H * 0.75), r: o.big ? rng.int(34, 64) : rng.int(18, 42),
        t: -i * 0.08, max: o.life ?? rng.float(2.2, 3.2), drips: Array.from({ length: rng.int(1, 3) }, () => ({ x: rng.float(-12, 12), w: rng.pick([2, 3]), l: rng.float(6, 18) })),
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

  // [phase9:fishing] Dev / tests: bring this ocean's boss (or `id`) in for the hook.
  summonBoss(id = null) { return this.boss.summon(id); }
  bossZoom() { return clamp((this.W * 0.36) / Math.max(12, this.fishLen()), 1.05, 1.7); }
  // a 3D word over the hooked fish
  popOver(text, pal, scale = 3) {
    const [sx, sy] = this.fishScreen();
    const len = this.fishLen() * this.zoom();
    const col = { lime: '#c8f56a', red: '#ff8a7a', sun: '#ffe27a', aqua: '#bff8ff' }[pal] || '#ffffff';
    this.titles.pop(text, clamp(sx, 120, this.W - 120), clamp(sy - len * 0.32 - 60, this.battle?.boss ? 150 : 90, this.H - 160), col, { scale });
  }

  startPhase() { /* [simple24] species events are gone: one meter, one spin */ }

  // [simple24] Screen rects of the fight HUD (the fishing lesson brackets them): 'meter', 'bar', 'shock', 'all', 'gear'.
  partRect(kind = 'meter') {
    if (kind === 'gear') return this.gear.rect?.() || null;
    if (this.state !== 'fight' || !this.battle) return null;
    const r = meterRect(this, kind);
    return r && Number.isFinite(r.x) ? r : null;
  }

  crankHint() {
    if (this.box) return this.box.crankHint();
    if (this.state === 'bite') return this.fishScreen();
    return this.battle ? this.battle.crankHint() : [this.input.x, this.input.y];
  }

  // ------------------------------------------------------------------ nibble API
  // Called by fish AI when it wants to start nibbling.
  requestNibble(fish) {
    if (this.state !== 'idle' || this.cine || !this.world.hook.active) return false;
    if (fish.boss && this.game.tutorialActive) return false; // [tut16] no boss during the fishing lesson
    this.fish = fish;
    fish.controlled = true;
    fish.allowTurn = true;
    this.state = 'nibble';
    const sp = fish.sp, lure = this.lureK();
    const [n0, n1] = sp.fight?.nibbles || [1, 3];
    this.nibblesLeft = fish.boss ? 0 : Math.max(0, Math.round(rng.int(n0, n1) / Math.sqrt(lure)));
    // [pace16] a calmer nibble: the first touch after 0.6-1.2 s (was 0.35-0.8 s), so the bite reads as a moment
    this.nibbleT = fish.boss ? 0.3 : rng.float(0.6, 1.2) / lure;
    if (this.game.tutorialActive && !fish.boss) { this.nibblesLeft = Math.max(2, this.nibblesLeft); this.nibbleT = 1.1; } // the lesson: watch it nibble
    this.nibblePhase = 0;
    this.fakeBite = !fish.boss && rng.chance((sp.fight?.fakeBite ?? 0.15) / lure);
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
    this.hs = null;
    this.state = 'idle';
    this.tension = 0;
    this.stopLoops();
    if (f?.boss) this.boss.rest(false);
    if (wasFighting) this.resetCamera();
  }

  resetCamera() {
    const c = this.cam, g = this.game;
    c?.release?.(2.4); // [pace16] a softer glide back (was 3)
    c?.setLetterbox?.(false);
    this.restoreScroll();
    if (g.timeScaleTarget !== undefined) g.timeScaleTarget = 1;
    if (this.boat) { this.boat.holdFish = null; }
    this.poseHold = null;
    this.setPose('idle');
  }

  message(text, color = '#ffffff', time = 2.2, big = false) { // [pace16] prompts linger (was 1.6 s)
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
    const wipe = 1 + (this.state === 'fight' ? this.gear.p * 2.5 : 0); // circling wipes the ink faster
    for (const s of this.splats) s.t += rdt * (s.t > 0.3 ? wipe : 1);
    this.splats = this.splats.filter((s) => s.t < s.max);
    if (this.poseHold) {
      this.poseHold.t -= rdt;
      if (this.poseHold.t <= 0) { this.poseHold = null; if (this.boat) this.boat.pose = this.pose || 'idle'; }
    }
    if (this.lostBait) { this.lostBait.t += rdt; if (this.lostBait.t > 1.2) this.lostBait = null; }

    const canHook = worldInput && !g.paused && !g.fishingDisabled && !this.cine?.blocksHook;
    // hook follows the cursor (during a bite the fish holds it and the mouse spins the gear)
    if (this.state === 'bite') {
      h.visible = true;
    } else if (this.state === 'idle' || this.state === 'nibble') {
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
    if (g.tutorialActive) this.tutorialBite(dt, w.hook.active && inWater);

    // floating boxes under the hook
    this.boxHover = null;
    if (this.state === 'idle' && canHook && inWater && g.floaters?.hitHook && !g.tutorialActive) { // [tut16] no box detours in the lesson
      try { this.boxHover = g.floaters.hitHook(h.x, h.y, 7) || null; } catch (e) { this.boxHover = null; }
      if (this.boxHover?.hooked) this.boxHover = null;
    }

    switch (this.state) {
      case 'idle':
        if (canHook && inWater && inp.pressed && !g.ui?.blocking) {
          if (this.boxHover) { this.startBox(this.boxHover); break; }
          // jig the lure
          h.dip = -5;
          g.water?.disturb?.(h.x, h.y, 0.45, 5); // [phase5:water] the twitch ripples the water
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
    this.gear.update(rdt, this.state === 'fight' ? this.battle : this.state === 'box' ? this.box : null);
    if ((this.state === 'idle' && h.visible) || this.state === 'nibble') this.gear.warm(1); // cache the spin frames before a bite
    try { this.boss.update(dt); } catch (e) { if (!this.bossErr) { this.bossErr = true; console.error(e); } }
    if (this.bossWin && this.bossWin.update(rdt) === 'done') this.bossWin = null;
    if (this.cine && this.cine.update(dt, rdt) === 'done') this.cine = null;
    if (this.lootPop && this.lootPop.update(rdt) === 'done') this.lootPop = null;
    this.updateLoops();
  }

  // The tutorial's first casts must get a bite: if nothing is keen on the bait for a few seconds, a friendly 'intro'
  // fish (Noobikarp: curious, greedy, bites at once) swims in from just outside the view and goes for the hook.
  tutorialBite(dt, fishing) {
    const school = this.game.school, h = this.hook;
    if (!fishing || this.state !== 'idle' || !school?.spawn) { this.tutWait = Math.min(this.tutWait || 0, 1.5); return; }
    const keen = school.fishes.some((f) => !f.controlled && (f.state === 'interest' || f.state === 'sniff'));
    this.tutWait = keen ? Math.min(this.tutWait || 0, 1) : (this.tutWait || 0) + dt;
    if (this.tutWait < 3.5) return;
    this.tutWait = 0;
    // an intro fish already around goes for it again; otherwise one swims in
    const old = school.fishes.find((f) => !f.controlled && !f.hero && f.quirks?.has?.('intro') && f.state !== 'leave' && f.alpha > 0.5);
    if (old) { old.cooldown = 0; old.interest = 2.5; old.setState?.('interest'); return; }
    const sp = SPECIES.find((s) => s.quirks?.includes('intro') && s.biome === this.world.biome) || SPECIES.find((s) => s.quirks?.includes('intro'));
    if (!sp) return;
    try {
      const side = rng.chance(0.5) ? -1 : 1;
      const v = this.cam?.view?.();
      const x = v ? (side < 0 ? v.x0 - 20 : v.x1 + 20) : h.x + side * 140;
      const f = school.spawn(sp, { x: clamp(x, 20, this.world.W - 20), y: h.y + rng.float(4, 20), z: 0.05, fromFog: false });
      f.y = h.y + rng.float(4, 20); f.z = 0.05;
      f.facing = -side; f.turn = f.facing;
      f.cooldown = 0; f.noticeT = 0;
      f.interest = 2.5;
      f.setState?.('interest');
    } catch (e) { console.error(e); }
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
    const fighting = (this.state === 'fight' && !!this.battle) || this.state === 'box' || (this.state === 'bite' && !!this.hs);
    if (fighting && !this.loops) {
      const a = this.game.audio;
      this.loops = { reel: a?.loop?.('reel'), tension: a?.loop?.('tension') };
    }
    if (!this.loops) return;
    if (!fighting) { this.stopLoops(); return; }
    this.loops.reel?.set?.(clamp01(this.gear.p * 0.9));
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
    if (!f.boss && this.cursor.speed > 260 * (this.stats?.calm ?? 1) * (g.tutorialActive ? 2.5 : 1)) {
      this.iconPop('spook', ...this.toScreen(f.x, f.y));
      this.releaseFish(true, '!');
      return;
    }
    const side = f.x < h.x ? -1 : 1;
    const mouthOff = f.boss ? this.fishLen(f) * 0.42 : 9 * f.scale + 4;
    this.nibbleT -= dt;
    let tx = h.x + side * (mouthOff + 6);
    const ty = h.y + 1;
    if (this.nibblePhase > 0) {
      this.nibblePhase -= dt;
      tx = h.x + side * mouthOff;
      if (this.nibblePhase <= 0.08 && !this.nibbled) {
        this.nibbled = true;
        this.game.water?.disturb?.(h.x, h.y, 0.3, 4); // [phase5:water]
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
        this.nibblePhase = 0.32;
        this.nibbled = false;
        this.nibbleT = rng.float(0.75, 1.5) / this.lureK(); // [pace16] was 0.45-1.1 s between nibbles
        if (this.fakeBite && this.nibblesLeft === 1) { h.dip = 8; f.say('!', 0.4); this.sfx('nibble', { pitch: 0.7 }); this.fakeBite = false; }
      } else {
        this.state = 'bite';
        this.game.water?.disturb?.(h.x, h.y, 0.9, 8); // [phase5:water] the strike
        this.hs = new HookBite(this, f);
        this.biteT = this.biteMax = this.hs.window;
        this.gear.reset();
        h.dip = 10;
        f.feel('determined', 1);
        f.chompT = 0.3;
        this.sfx('bite');
        this.particles.bubbles(h.x, h.y, 6);
        this.particles.aeroBubbles?.(h.x, h.y, 4, { w: 4, sizes: [2, 3, 3, 4] });
        this.particles.ringWave?.(h.x, h.y, 16, '#ffe27a', { life: 0.3, w: 2 });
        if (rng.chance(this.stats?.autoHook ?? 0)) { this.setHook(true); return; }
      }
    }
    if (inp.pressed && !g.ui?.blocking && this.state === 'nibble' && !g.tutorialActive) { // (the lesson never punishes an early click)
      this.iconPop('early', inp.x, inp.y);
      this.sfx('escape', { vol: 0.5 });
      this.releaseFish(true, 'cross');
    }
  }

  // The fish has the bait: click (or Space) before the window closes.
  updateBite(dt, canHook) {
    const f = this.fish, h = this.hook, hs = this.hs, inp = this.input, g = this.game;
    if (!f || !hs) { this.releaseFish(true); return; }
    const r = hs.update(dt);
    this.biteT = hs.window - hs.t;
    this.tension = hs.tension;
    // the fish tugs and shakes on the hook
    const side = f.x < h.x ? -1 : 1;
    const tug = Math.max(0, Math.sin(this.t * 11)) * 3;
    f.x = damp(f.x, h.x + side * ((f.boss ? this.fishLen(f) * 0.42 : 8 * f.scale + 3) + tug), 16, dt);
    f.y = damp(f.y, h.y + 2 + Math.sin(this.t * 23) * 1.2, 16, dt);
    f.facing = -side;
    f.feel('determined', 0.2);
    this.focusCam(lerp(f.x, h.x, 0.5), f.y, this.fightZoom() * 0.9, 1.8);
    h.dip = Math.max(h.dip, 4 + tug + Math.sin(this.t * 40) * 2);
    if (rng.chance(dt * 14)) this.particles.bubbles(h.x, h.y, 1, { size: 1 });
    const click = (inp.pressed || inp.keyPressed?.(' ')) && !g.ui?.blocking && canHook !== false;
    if (click) { inp.consume?.(); this.setHook(false); return; }
    if (r === 'slow') this.hookFail('slow');
  }

  // Too slow: the fish lets go.
  hookFail(kind) {
    const f = this.fish;
    const [sx, sy] = this.toScreen(f.x, f.y);
    this.iconPop('miss', sx, sy);
    this.titles.pop('TOO SLOW!', sx, sy - 34, '#ff8a7a', { scale: 2 });
    this.sfx('escape', { vol: 0.6 });
    this.releaseFish(true, 'music');
    void kind;
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
    this.hs = null;
    this.battle = new Battle(this);
    this.power = this.battle.power;
    this.tension = this.battle.tension;
    this.splats = [];
    this.holdKind = null;
    this.btnPress = 0; this.btnBad = 0; this.btnDenied = 0; this.meterShake = 0; this.tickT = 0; this.chainArcs = [];
    this.gear.reset();
    this.gear.flashOn('#ffffff', 1);
    this.gear.kick(1);
    this.leanX = 0; this.leanY = 0;
    // cinematic: slow-mo punch-in with letterbox
    const cam = this.cam;
    const zoomIn = f.boss ? this.bossZoom() + 0.5 : this.fightZoom() + 0.3;
    this.focusCam(f.x, f.y, zoomIn, f.boss ? 2 : 4.2); // [pace16] was 6
    cam?.setLetterbox?.(true);
    cam?.slowmo?.(f.boss ? 0.35 : 0.3, f.boss ? 1.4 : 0.85); // [pace16] a longer, softer hook-set beat (was 0.22 for 0.55 s)
    cam?.flash?.('#e8fbff', 0.35);
    this.shake(5);
    this.sfx('hookset');
    this.sfx('splash_small', { vol: 0.6, pitch: 0.8 });
    const P = this.particles;
    P.impact?.(f.x, f.y, 2, { ramp: 'aqua' });
    P.burst(f.x, f.y, 14, { colors: ['#ffffff', '#bff8ff', '#c8f56a'], speed: 80, g: 0, life: 0.45 });
    P.splashBurst?.(f.x, f.y, 1.1);
    g.water?.disturb?.(f.x, f.y, 1.4, 12); // [phase5:water] hook-set shock wave
    P.scales?.(f.x, f.y, 4, this.scaleColors());
    const surf = this.world.surfaceY;
    if (surf !== null && surf !== undefined && f.y - surf < 40) P.eruption?.(f.x, surf, 0.6);
    if (!f.boss) this.titles.add('fishon', auto ? 'AUTO!' : 'FISH ON!', { rarity: f.sp.rarity }); // a boss gets its intro cutscene
    f.feel('surprised', 0.8);
    f.squashV += 10;
    f.say('!!', 0.8);
    this.setPose('yank', 0.35);
    this.setPose('pull');
    g.onHooked?.(f);
  }

  // Instant shock for older drivers (fires as a PERFECT press).
  tryShock() {
    const B = this.battle;
    if (!B) return false;
    return B.shock();
  }

  updateFight(dt) {
    const g = this.game, B = this.battle, f = this.fish, inp = this.input;
    if (!B || !f) { this.releaseFish(false); return; }
    const rdt = this.rdt;
    this.btnPress = Math.max(0, (this.btnPress || 0) - rdt * 5);
    this.btnBad = Math.max(0, (this.btnBad || 0) - rdt * 2.5);
    this.btnDenied = Math.max(0, (this.btnDenied || 0) - rdt * 3);
    this.meterShake = Math.max(0, (this.meterShake || 0) - rdt * 3);
    for (const c of this.chainArcs || []) c.t += rdt;
    if (this.chainArcs?.length) this.chainArcs = this.chainArcs.filter((c) => c.t < c.delay + 0.35);
    // SHOCK: Space, or a click (anywhere during a beat, or on the button), or the right button
    const onBtn = inp.pressed && hitShockButton(this, inp.x, inp.y);
    const fire = inp.keyPressed?.(' ') || inp.rpressed || onBtn || (inp.pressed && !!B.beat);
    if (fire && !g.ui?.blocking) { B.pressShock(); if (inp.pressed) inp.consume?.(); }
    g.timeScaleTarget = 1;
    const r = B.update(dt);
    this.tension = B.tension;
    f.controlled = true;
    // centred: soft ticks that climb with the steady streak
    if (B.inZone && !B.beat && !B.stunned && B.mode !== 'hookset') {
      this.tickT -= rdt;
      if (this.tickT <= 0) { this.tickT = 0.42 - B.steady * 0.14; this.sfx('reel_tick', { vol: 0.22 + B.steady * 0.12, pitch: 1 + B.steady * 0.6 + (B.centre ? 0.15 : 0) }); }
    }
    // the stunned fish crackles
    if (B.stunned && rng.chance(dt * 26)) {
      const R = this.fishLen() * 0.45;
      this.particles.electrify?.(f.x + rng.float(-R, R) * 0.5, f.y + rng.float(-3, 3), R, 1, { sparks: rng.chance(0.5) ? 2 : 0 });
    }
    // camera: follows the fish; the boss intro pushes in
    let zoom = f.boss ? this.bossZoom() : this.fightZoom();
    if (B.mode === 'hookset') zoom += 0.3;
    if (B.boss?.stage === 'intro') zoom += 0.45 * clamp01((B.boss.stageT - 0.8) / 1.5);
    if (B.beat) zoom += 0.12;
    if (B.boss?.stage === 'intro') this.focusCam(f.x, f.y - (this.H * 0.16) / zoom, zoom, 1.6);
    else this.focusCam(f.x, f.y + (this.H * 0.08) / zoom, zoom, B.mode === 'hookset' ? 4.5 : 3); // the fish sits a bit high: room for the meter
    if (!this.poseHold) {
      const pose = B.stunned || this.gear.p > 0.08 ? 'reel' : 'pull';
      if (pose !== this.pose) this.setPose(pose);
    }
    if (r === 'ok') return;
    if (r === 'land') this.beginLanding();
    else this.fail(r);
  }

  // ------------------------------------------------------------------ battle callbacks (juice) [simple24]
  fishScreen() { const f = this.fish; return f ? this.toScreen(f.x, f.y) : [this.W / 2, this.H / 2]; }
  btnPos() { const b = meterLayout(this).btn; return [b.cx, b.cy]; }

  // the marker entered / left the sweet zone
  onZone(inside) {
    if (inside) { this.sfx('timing_good', { vol: 0.3, pitch: 1.4 }); this.gear.flashOn('#8be04a', 0.35); }
    else this.sfx('reel_tick', { vol: 0.35, pitch: 0.6 });
  }

  onLungeWarn(L) {
    const [sx, sy] = this.fishScreen();
    this.titles.pop(L.dir < 0 ? 'RUN!' : 'RUSH!', sx, sy - this.zoneRadius() * 0.7, '#ffd23a', { scale: 2 });
    this.sfx('slack_warn', { vol: 0.5, pitch: 1.2 });
  }

  onLunge(L) {
    const f = this.fish;
    if (!f) return;
    this.sfx('splash_small', { vol: 0.6, pitch: 0.8 });
    this.particles.bubbleTrail?.(f.x, f.y, Math.cos(this.battle?.away ?? 0) * -L.dir * 90, 0, { n: 6 });
    this.particles.wake?.(f.x, f.y, this.battle?.away ?? 0, 4);
    this.shake(3);
    this.meterShake = 0.6;
  }

  // a charge is ready
  onShockReady() {
    this.sfx('neon_buzz', { vol: 0.35, pitch: 1.5 });
    const [bx, by] = this.btnPos();
    this.fx.pixelBurst?.('spark', bx, by, 6, { ramp: 'gold', layer: 'fg' });
  }

  // the beat begins: the fish braces, the marker freezes
  onBeat() {
    this.sfx('magic', { vol: 0.5, pitch: 1.3 });
    this.sfx('neon_buzz', { vol: 0.45, pitch: 0.8 });
    const f = this.fish;
    if (f) this.particles.pixelBurst?.('sparkle', f.x, f.y, 8, { ramp: 'gold', w: this.fishLen() * 0.4, h: 6 });
  }
  onBeatSweep() { this.sfx('reel_tick', { vol: 0.5, pitch: 1.6 }); }
  onBeatCrit() { this.sfx('reel_tick', { vol: 0.7, pitch: 2 }); }
  onBeatMiss() {
    const L = meterLayout(this);
    this.titles.pop('MISSED', L.cx, L.cy - L.h - 30 * L.S, '#bfeaff', { scale: 1.5 });
    this.sfx('timing_miss', { vol: 0.4 });
  }

  // a press outside the beat: the button wobbles (no charge spent)
  onShockFizzle(why) {
    this.btnDenied = 1;
    this.sfx('ui_error', { vol: 0.3 });
    if (why === 'wait' && this.battle?.charges > 0) {
      const [bx, by] = this.btnPos();
      this.titles.pop('WAIT FOR IT', bx, by - 60 * (this.H / 540), '#ffe27a', { scale: 1.4 });
    }
  }

  // The zap leaves the button (muzzle flash) and runs down the line. grade 'perfect' | 'good'.
  // (QuestBook wraps this and onBackfire: 'shockFired' {grade}.)
  onShockFire(grade = 'perfect') {
    const B = this.battle, strong = grade === 'perfect';
    this.zapLine = { t: 0, dur: B?.zap?.dur ?? 0.2, grade };
    this.btnPress = 1;
    this.gear.kick(strong ? 1 : 0.5);
    this.sfx('static_burst', { vol: strong ? 1 : 0.6, pitch: strong ? 1.25 : 0.95 });
    this.sfx('thunder', { vol: strong ? 0.4 : 0.2, pitch: 1.8 });
    const [bx, by] = this.btnPos();
    // muzzle flash: a burst of pixel zaps and sparks off the button
    this.fx.zapBurst?.(bx, by, strong ? 8 : 4, { layer: 'fg', r: 14, ramp: strong ? 'gold' : 'cyan' });
    this.fx.sparks(bx, by, strong ? 18 : 8, { speed: [80, 240], colors: ['#ffffff', '#fff6a0', '#ffd23a', '#7ff4ff'], g: 200 });
    this.fx.impact?.(bx, by, strong ? 2 : 1, { ramp: 'gold', layer: 'fg' });
    const [rx, ry] = this.rodTip();
    this.particles.electrify?.(rx, ry, 8, strong ? 3 : 1, { flat: 1 });
    this.meterShake = strong ? 1 : 0.5;
  }

  // the zap arrives: impact, knockback, 3D words. dmg = catch bar gained, chain = extra arcs.
  onShockHit(grade, dmg, chain = 0, weak = false) {
    const f = this.fish, P = this.particles;
    if (!f) return;
    const crit = grade === 'perfect';
    const R = this.fishLen() * (crit ? 0.7 : 0.45);
    P.impact?.(f.x, f.y, crit ? 2 : 1, { ramp: crit ? 'gold' : 'cyan', sparkles: crit ? 10 : 5 });
    P.zapBurst?.(f.x, f.y, crit ? 8 : 4, { r: R * 0.5 });
    P.electrify?.(f.x, f.y, R, crit ? 7 : 4, { sparks: crit ? 10 : 4 });
    P.scales?.(f.x, f.y, crit ? 6 : 3, this.scaleColors());
    P.aeroBubbles?.(f.x, f.y, crit ? 8 : 4, { w: R * 0.6, sizes: [2, 2, 3, 4] });
    this.cam?.flash?.(crit ? '#fff6c0' : '#bff8ff', crit ? 0.4 : 0.22);
    this.cam?.punch?.(f.x, f.y, crit ? 0.1 : 0.05, 0.3);
    if (crit) this.cam?.slowmo?.(0.35, 0.35);
    this.shake(crit ? 10 : 5);
    this.sfx(crit ? 'thunder' : 'glitch', { vol: crit ? 0.6 : 0.5, pitch: crit ? 1.3 : 1.2 });
    if (crit) this.sfx('timing_perfect', { pitch: 1.2 });
    // chain lightning: arcs leap to bubbles beside the fish
    this.chainArcs = [];
    for (let i = 0; i < chain; i++) {
      const a = (i ? -1 : 1) * rng.float(0.5, 1.2) + (i ? Math.PI : 0);
      const d = this.fishLen() * rng.float(0.8, 1.2);
      const tx = f.x + Math.cos(a) * d, ty = f.y + Math.sin(a) * d * 0.5;
      this.chainArcs.push({ x0: f.x, y0: f.y, x1: tx, y1: ty, t: 0, delay: 0.08 + i * 0.1 });
    }
    // the words pop right above the meter, where the eyes are when you press
    const ML = meterLayout(this);
    const x = ML.cx, y = Math.round(ML.cy - ML.h / 2 - 96 * ML.S);
    if (crit) this.titles.pop(weak ? 'WEAK POINT!' : 'CRITICAL!', x, y, '#ffe27a', { scale: 6 });
    else this.titles.pop('ZAP!', x, y, '#bff8ff', { scale: 4 });
    const S = this.H / 540;
    this.titles.pop('+' + Math.round(dmg * 100) + '%', x + 90 * S, y + 34 * S, '#c8f56a', { scale: 1.8 });
    if (chain) this.titles.pop('CHAIN x' + (chain + 1), x - 90 * S, y + 34 * S, '#8ff0ff', { scale: 1.8 });
    if ((this.battle?.combo || 0) > 1 && crit) this.titles.pop('COMBO x' + this.battle.combo, x, y + 60 * S, '#ffd23a', { scale: 1.6 });
    f.say('!!', 0.6);
  }

  onStun() { this.sfx('glitch', { vol: 0.35 }); }

  // a bad press: the charge discharges into your own reel
  onBackfire() {
    const [bx, by] = this.btnPos();
    this.sfx('static_burst', { vol: 0.7, pitch: 0.6 });
    this.sfx('timing_miss');
    this.shake(5);
    this.cam?.flash?.('#ff9a8a', 0.18);
    this.btnBad = 1; this.btnPress = 0.6;
    this.gear.flashOn('#ff4f5e', 1);
    this.gear.strain = 1;
    this.fx.sparks(bx, by, 14, { speed: [80, 200], colors: ['#ffffff', '#ffd23a', '#ff5a4a'], g: 260 });
    this.fx.pixelBurst?.('smoke', bx, by - 10, 4, { layer: 'fg' });
    this.titles.pop('BACKFIRE!', bx, by - 66 * (this.H / 540), '#ff8a7a', { scale: 2 });
    this.meterShake = 0.8;
  }

  // [phase9:fishing] boss callbacks (boss.js BossFight)
  onBossIntro(def) {
    this.sfx('roar', { vol: 1, pitch: 0.7 });
    this.sfx('eruption_boom', { vol: 0.6 });
    this.cam?.slowmo?.(0.5, 1.2);
    this.cam?.flash?.(def.color, 0.35);
    this.shake(12);
    const f = this.fish;
    if (f) { this.particles.pixelSplash?.(f.x, f.y, 2); this.particles.impact?.(f.x, f.y, 2, { ramp: def.color }); }
  }

  onBossFightStart() { this.sfx('notify', { pitch: 0.8 }); }

  onBossPhase(def, n) {
    const f = this.fish;
    this.sfx('roar', { vol: 0.9, pitch: 0.6 + n * 0.08 });
    this.sfx('eruption_boom', { vol: 0.5 });
    this.shake(12);
    this.cam?.flash?.(n >= 3 ? '#ff6a5a' : def.color, 0.4);
    if (f) { this.particles.impact?.(f.x, f.y, 2, { ramp: n >= 3 ? 'red' : 'gold' }); this.particles.pixelBurst?.('shard', f.x, f.y, 12, { ramp: n >= 3 ? 'red' : 'gold' }); }
  }

  onBossAttack(kind) {
    if (kind === 'ink') { this.sfx('blub', { pitch: 0.5, vol: 0.9 }); this.titles.banner('INK! KEEP SPINNING', '#c89aff', '', { pal: 'violet' }); this.shake(5); }
  }

  onBossCrit(def, weak) {
    this.sfx('catch_rare', { vol: 0.6 });
    const f = this.fish;
    if (f) { this.particles.pixelBurst?.('star', f.x, f.y, 16, { ramp: 'gold', speed: [80, 220] }); this.particles.pixelBurst?.('shard', f.x, f.y, 10, { ramp: weak ? 'red' : 'cyan' }); }
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
    if (f.boss) this.boss.rest(false);
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
    // a boss: the victory cinematic + rewards ride over the landing
    if (this.battle?.boss && f.boss) {
      try { this.bossWin = bossVictory(this, f, f.boss); } catch (e) { console.error(e); }
      this.boss.rest(true);
      this.cam?.slowmo?.(0.25, 1.2);
    }
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
    this.gear.reset();
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

  // Fallback when the host has no onBoxCaught: take the box, roll + grant loot, glossy pop-up.
  landBox(f) {
    const g = this.game;
    try { g.floaters?.take?.(f); } catch (e) { console.error(e); }
    return landBoxLoot(this, f);
  }

  // The host rolled and granted the loot (game.onBoxCaught -> build.onBoxCaught): show the glossy pop-up.
  // A null loot means nobody rolled it: roll and grant here.
  showBoxLoot(f, loot) {
    return landBoxLoot(this, f, loot || undefined);
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
      this.drawRope(ctx, rx, ry, h.x, h.y - 5, this.state === 'bite' && this.hs ? 0.5 : 0.2, false);
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
    try {
      this.boss.drawWorld(ctx); // a boss swimming in
      if (this.state === 'fight') B?.boss?.drawWorld(ctx); // the hooked boss: aura, minions
    } catch (e) { if (!this.bossDrawErr) { this.bossDrawErr = true; console.error(e); } }
    if (B && this.fish && (B.stunned || B.zap)) this.drawStunnedFish(ctx, B);
    // [simple24] chain lightning: arcs leaping from the fish to bubbles beside it
    for (const c of this.chainArcs || []) {
      if (c.t < c.delay) continue;
      const k = clamp01((c.t - c.delay) / 0.12);
      const x1 = lerp(c.x0, c.x1, k), y1 = lerp(c.y0, c.y1, k);
      drawBolt(ctx, boltPoints(c.x0, c.y0, x1, y1, 5, (this.t * 911 + c.delay * 1e4) >>> 0), 1 - clamp01((c.t - c.delay - 0.12) / 0.23));
      if (k >= 1 && !c.hit) { c.hit = true; this.particles.zapBurst?.(c.x1, c.y1, 4); this.particles.aeroBubbles?.(c.x1, c.y1, 3, { w: 3 }); }
    }
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
    // [phase4:zoom] the line is plotted in screen space through the current transform: a crisp 1 px line at any
    // camera zoom (world-space 1x1 dots would turn into fat blocks when zoomed in)
    const m = ctx.getTransform();
    const Z = Math.max(1, Math.hypot(m.a, m.b));
    const steps = Math.max(4, Math.ceil((d * Z) / 1.5));
    let col = '#e8f4ff';
    if (fight) col = tension > 0.92 ? '#ff6a5a' : tension > 0.75 ? '#ffd25a' : '#e8f4ff';
    if (B?.stunned) col = Math.floor(this.t * 20) % 2 ? '#bff8ff' : '#ffffff';
    const L = d || 1, nx = -(y1 - y0) / L, ny = (x1 - x0) / L;
    // glints travelling up the line while reeling
    const reel = fight ? this.gear.p : 0;
    const glintPhase = (this.t * (0.6 + reel * 2.2)) % 1;
    const zap = this.zapLine;
    const zk = zap ? clamp01(zap.t / zap.dur) : -1;
    const pts = [];
    let px = null, py = null, pwy = null;
    const ssurf = surf === null ? null : Math.round(m.d * surf + m.f);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const wv = amp ? Math.sin(t * Math.PI) * amp * Math.sin(this.t * 70 + t * 14) : 0;
      const wx = (1 - t) * (1 - t) * x0 + 2 * (1 - t) * t * mx + t * t * x1 + nx * wv;
      const wy = (1 - t) * (1 - t) * y0 + 2 * (1 - t) * t * my + t * t * y1 + ny * wv;
      if (zap && i % Math.max(4, Math.round(4 * Z)) === 0) pts.push([Math.round(wx), Math.round(wy), t]);
      const x = Math.round(m.a * wx + m.c * wy + m.e), y = Math.round(m.b * wx + m.d * wy + m.f);
      if (x === px && y === py) continue;
      const under = surf === null || wy > surf;
      const glint = reel > 0.15 && Math.abs(((1 - t) - glintPhase + 1) % 0.25) < 0.012;
      if (Z > 1.4) { ctx.fillStyle = rgba('#0c3a5c', 0.3 * alpha); ctx.fillRect(x, y + 1, 1, 1); } // [phase4:zoom] a soft shade keeps the thin line readable over bright water
      ctx.fillStyle = glint ? '#ffffff' : rgba(col, under ? alpha * 0.8 : alpha);
      ctx.fillRect(x, y, 1, 1);
      if (surf !== null && pwy !== null && (pwy <= surf) !== (wy <= surf)) {
        // little ripple where the line enters the water; spray off a straining line
        const r = (3 + Math.sin(this.t * 4) * 1) * Z, rw = Math.max(2, Math.round(2 * Z));
        ctx.fillStyle = rgba('#ffffff', 0.6);
        ctx.fillRect(Math.round(x - r), ssurf + Math.round(Z), rw, Math.max(1, Math.round(Z * 0.6)));
        ctx.fillRect(Math.round(x + r - rw / 2), ssurf + Math.round(Z), rw, Math.max(1, Math.round(Z * 0.6)));
        if (fight && T > 0.7 && rng.chance(0.25 * T)) this.particles.droplets?.(wx, surf, 1, { dir: -Math.PI / 2, spread: 0.9, speed: [20, 60], g: 260 });
      }
      px = x; py = y; pwy = wy;
    }
    ctx.restore();
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
    const bait = g.currentBait();
    const drawHook = () => {
      ctx.save();
      ctx.translate(x, y - 5);
      ctx.rotate(h.angle * 0.6);
      ctx.drawImage(HOOK, -3, 0);
      ctx.restore();
    };
    if (!bait) {
      drawHook();
      // bare hook: a tiny glint on the point
      if (Math.sin(this.t * 3) > 0.92) { ctx.fillStyle = '#ffffff'; ctx.fillRect(x + 1, y + 2, 1, 1); }
      return;
    }
    // [bait12] the detailed voxel bait threaded on the hook bend (2x world resolution, wriggling creatures),
    // swinging with the hook; the hook is drawn over it so the point pierces the bait
    const bx = h.x + Math.sin(h.angle * 0.6) * 4 + this.baitSwing * 4, by = h.y + 7;
    let hk = null;
    try { hk = bait.art ? baitHook(bait.art, this.t) : null; } catch (e) { hk = null; }
    if (hk) {
      ctx.save();
      ctx.translate(Math.round(bx * 2) / 2, Math.round((by + Math.sin(this.t * 3) * 0.6) * 2) / 2);
      ctx.rotate(this.baitSwing * 0.35 + h.angle * 0.25);
      if (hk.glow) { ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.55; ctx.drawImage(hk.glow, -hk.w / 2, -hk.h / 2, hk.w, hk.h); ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1; }
      ctx.drawImage(hk.canvas, -hk.w / 2, -hk.h / 2, hk.w, hk.h);
      ctx.restore();
    } else {
      const spr = bait.mini || baitSprite(bait.art || bait.type, this.t);
      if (spr) ctx.drawImage(spr, Math.round(bx) - Math.floor(spr.width / 2), Math.round(by) - 2);
    }
    drawHook();
    const fx = bait.effect || bait.type;
    if (fx === 'golden' || fx === 'lantern') {
      if (rng.chance(0.15)) this.particles.sparkle(bx + rng.float(-5, 5), by + rng.float(-3, 6), fx === 'golden' ? '#fff3a8' : '#a8fff0');
    }
  }

  // ------------------------------------------------------------------ screen drawing
  drawHud(ctx) {
    const bossIntro = this.battle?.boss?.stage === 'intro'; // the boss cutscene owns the screen
    if (this.state === 'fight' && this.battle && this.fish && !bossIntro) drawFightScene(ctx, this, this.battle);
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
    if (this.state === 'fight' && this.battle && this.fish && this.battle.boss?.stage !== 'intro') drawFightBands(ctx, this, this.battle);
    else if (this.state !== 'box' && this.gear.show > 0.01) this.gear.draw(ctx, null, 1);
    if (this.state === 'box' && this.box) this.box.drawBands(ctx);
    if (this.state === 'fight' && this.battle?.boss) { try { this.battle.boss.drawHud(ctx); } catch (e) { if (!this.bossHudErr) { this.bossHudErr = true; console.error(e); } } }
    this.finale?.drawHud(ctx);
    this.bossWin?.draw(ctx);
    this.cine?.drawHud?.(ctx);
    this.drawLostBait(ctx);
    this.fx.draw(ctx, 'fg', this.t);
    this.titles.draw(ctx);
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

export { TAU };
