// Fishing controller: hook & line, one-time bait, nibbles, bites, the fight (battle.js), boss fights (boss.js),
// floating boxes (boxreel.js), the slow-motion landing finale and the escape cutscene (cinematics.js), and the fight
// HUD (hud.js).
//
// Controls (phase 9: simple and clear): when the big "!" pops, CLICK (or circle) to set the hook. Then CIRCLE the mouse
// anywhere to reel. Watch the one big TENSION bar: when the fish pulls (it braces with a "!", then the bar turns red)
// stop circling until the pull is over. Secondary action: HOLD the mouse button (or Space / the right button) and let
// go when the bolt is full to ZAP the fish (stuns it, cancels a pull). Boss extras: drag the opposite way to dodge a
// charge, click minions, circle to wipe ink.
//
// Rod stats (src/game/rods.js rodStats(state, game.stats)) drive everything:
//   lureSpeed -> bite wait (fish notice / sniff / nibble faster, bigger lure radius)
//   luck      -> rarity (luckMul(); game.js multiplies world.rarityBoost by it)
//   control   -> a safer tension bar and longer warnings      resilience -> less line lost while the fish pulls
//   strength  -> fish heavier than this strain the line       shock -> charges / stun / recharge time
// Bait is ONE-TIME USE (src/store/bait.js via game.currentBait()/consumeBait()): one is used at hook-set.
// No bait = a bare hook: fish still bite, attraction is weaker.
//
// Public API (game.js, tutorial, browser overlay): update(dt, worldInput), drawWorld(ctx) [world
// space], drawHud(ctx) [screen space], drawCinematic(ctx) [world space, after fish],
// drawCinematicHud(ctx) [screen space, above the HUD], requestNibble(fish), releaseFish(flee),
// setHook(auto), message(text), crankHint(), gearRect() (the fight panel, for the guide), luckMul(), landBox(f),
// summonBoss(id?), and the fields state ('idle'|'nibble'|'bite'|'fight'|'landing'|'box'), busy, fighting,
// hook {x, y, visible}, tension, rod, bite (the HookBite while a fish bites), battle, boss (the BossDirector).
// If the host never calls drawCinematic/drawCinematicHud, drawWorld/drawHud draw them instead.
// Emits through game.onHooked / onFishCaught / onFishEscaped (game.emit 'hooked' | 'caught' | 'escaped') and
// game.emit('bossDefeated', {id}).

import { TAU, clamp, clamp01, dist, damp, lerp } from '../core/math.js';
import { rng } from '../core/rng.js';
import { rgba } from '../core/color.js';
import { Particles, glowSprite, drawBolt, boltPoints } from '../gfx/particles.js';
import { drawFishRig } from '../gfx/fishrig.js';
import { HOOK, baitSprite } from './baitart.js';
import { Crank } from './crank.js';
import { Battle, HookBite, DEFAULT_ROD, RED } from './battle.js';
import { BossDirector, bossVictory } from './boss.js';
import { Titles, Finale, EscapeCine, Outro } from './cinematics.js';
import { drawFightScene, drawFightHud, drawBiteCue, drawMessage, panelRect } from './hud.js';
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
    this.bite = null; // the HookBite while a fish bites
    this.boss = new BossDirector(this); // [phase9:fishing] boss fish
    this.bossWin = null; // the victory overlay after a boss
    this.holdKind = null; // what the current mouse-button hold is for: 'charge' | 'bonk'
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
  // (a bite counts: the mouse belongs to the hook-set)
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
        x: rng.float(this.W * 0.15, this.W * 0.85), y: rng.float(this.H * 0.18, this.H * 0.72), r: o.big ? rng.int(34, 64) : rng.int(18, 42),
        t: -i * 0.08, max: o.life ?? rng.float(2.6, 3.6), drips: Array.from({ length: rng.int(1, 3) }, () => ({ x: rng.float(-12, 12), w: rng.pick([2, 3]), l: rng.float(6, 18) })),
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

  // [phase9:fishing] first-play tips (hud.js drawTips): how often each one has been shown
  tips() { const st = this.game.state; return st ? (st.fishTips ||= {}) : (this.tipMem ||= {}); }
  countTip(key) { const T = this.tips(); T[key] = (T[key] || 0) + 1; }

  // The fight panel on screen (the guide points at it), or null.
  gearRect() {
    if (this.state !== 'fight' && this.state !== 'box') return null;
    const r = panelRect(this);
    return { x: r.x, y: r.y, w: r.w, h: r.h };
  }

  // Dev / tests: bring this ocean's boss (or `id`) in for the hook.
  summonBoss(id = null) { return this.boss.summon(id); }

  crankHint() {
    if (this.box) return this.box.crankHint();
    if (this.state === 'bite') return [Math.round(this.W * 0.42), Math.round(this.H * 0.55)];
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
    this.nibblesLeft = fish.boss ? 0 : Math.max(0, Math.round(rng.int(n0, n1) / Math.sqrt(lure)));
    this.nibbleT = fish.boss ? 0.3 : rng.float(0.35, 0.8) / lure;
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
    this.bite = null;
    this.state = 'idle';
    this.tension = 0;
    this.stopLoops();
    if (f?.boss) this.boss.rest(false);
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
    // ink on the lens fades; circling the mouse wipes it faster
    const wipe = 1 + (this.battle?.reel || 0) * 3;
    for (const s of this.splats) s.t += rdt * (s.t > 0.3 ? wipe : 1);
    this.splats = this.splats.filter((s) => s.t < s.max);
    if (this.poseHold) {
      this.poseHold.t -= rdt;
      if (this.poseHold.t <= 0) { this.poseHold = null; if (this.boat) this.boat.pose = this.pose || 'idle'; }
    }
    if (this.lostBait) { this.lostBait.t += rdt; if (this.lostBait.t > 1.2) this.lostBait = null; }

    const canHook = worldInput && !g.paused && !g.fishingDisabled && !this.cine?.blocksHook;
    // hook follows the cursor (during a bite the fish holds it)
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
    const fighting = (this.state === 'fight' && !!this.battle) || this.state === 'box';
    if (fighting && !this.loops) {
      const a = this.game.audio;
      this.loops = { reel: a?.loop?.('reel'), tension: a?.loop?.('tension') };
    }
    if (!this.loops) return;
    if (!fighting) { this.stopLoops(); return; }
    this.loops.reel?.set?.(clamp01((this.battle?.reel ?? this.box?.reelK ?? 0) * 0.9));
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
    if (!f.boss && this.cursor.speed > 260 * (this.stats?.calm ?? 1)) {
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
        this.nibblePhase = 0.25;
        this.nibbled = false;
        this.nibbleT = rng.float(0.45, 1.1) / this.lureK();
        if (this.fakeBite && this.nibblesLeft === 1) { h.dip = 8; f.say('!', 0.4); this.sfx('nibble', { pitch: 0.7 }); this.fakeBite = false; }
      } else {
        this.state = 'bite';
        this.game.water?.disturb?.(h.x, h.y, 0.9, 8); // [phase5:water] the strike
        this.bite = new HookBite(this, f);
        this.biteT = this.biteMax = this.bite.window;
        h.dip = 10;
        f.feel('determined', 1);
        f.chompT = 0.3;
        this.sfx('bite');
        this.sfx('notify', { vol: 0.5, pitch: 1.5 });
        this.shake(f.boss ? 6 : 2);
        this.particles.bubbles(h.x, h.y, 6);
        this.particles.aeroBubbles?.(h.x, h.y, 4, { w: 4, sizes: [2, 3, 3, 4] });
        this.particles.impact?.(h.x, h.y, 1, { ramp: 'gold' });
        this.particles.pixelSplash?.(h.x, h.y, 0.6);
        if (rng.chance(this.stats?.autoHook ?? 0)) { this.setHook(true); return; }
      }
    }
    if (inp.pressed && !g.ui?.blocking && this.state === 'nibble') {
      this.iconPop('early', inp.x, inp.y);
      this.sfx('escape', { vol: 0.5 });
      this.releaseFish(true, 'cross');
    }
  }

  // The fish has the bait: one click (or a quick circle) before the window closes sets the hook.
  updateBite(dt, canHook) {
    const f = this.fish, h = this.hook, bt = this.bite;
    if (!f || !bt) { this.releaseFish(true); return; }
    const r = bt.update(dt);
    this.biteT = bt.window - bt.t;
    this.tension = bt.tension;
    // the fish tugs and shakes on the hook
    const side = f.x < h.x ? -1 : 1;
    const tug = Math.max(0, Math.sin(this.t * 11)) * 3;
    const off = f.boss ? this.fishLen(f) * 0.42 : 8 * f.scale + 3;
    f.x = damp(f.x, h.x + side * (off + tug), 16, dt);
    f.y = damp(f.y, h.y + 2 + Math.sin(this.t * 23) * 1.2, 16, dt);
    f.facing = -side;
    f.feel('determined', 0.2);
    this.focusCam(lerp(f.x, h.x, 0.5), f.y, this.fightZoom() * 0.9, 2.5); // a gentle push-in on the strike
    h.dip = Math.max(h.dip, 4 + tug + Math.sin(this.t * 40) * 2 + bt.set * 4);
    if (rng.chance(dt * 14)) this.particles.bubbles(h.x, h.y, 1, { size: 1 });
    void canHook;
    if (r === 'hooked') { this.setHook(false); return; }
    if (r === 'slow') this.hookFail('slow');
  }

  // Spin-to-hook failed: too slow (the fish lets go) or the hook ripped out (spun far too fast).
  hookFail(kind) {
    const f = this.fish, h = this.hook;
    const [sx, sy] = this.toScreen(f.x, f.y);
    void h;
    if (kind === 'rip') {
      this.sfx('line_snap', { pitch: 1.25 });
      this.shake(6);
      this.titles.add('snap', 'RIPPED!', { seed: rng.int(1, 9999) });
      this.releaseFish(true, 'anger');
    } else {
      this.iconPop('miss', sx, sy);
      this.titles.pop('TOO SLOW!', sx, sy - 34, '#ff8a7a', { scale: 2 });
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
    this.bite = null;
    this.battle = new Battle(this);
    this.power = this.battle.power;
    this.tension = this.battle.tension;
    this.splats = [];
    this.holdKind = null;
    this.leanX = 0; this.leanY = 0;
    this.calloutKey = null; this.tipKey = null;
    // cinematic: slow-mo punch-in with letterbox
    const cam = this.cam, boss = !!f.boss;
    this.focusCam(f.x, f.y, this.fightZoom() + (boss ? 0.15 : 0.3), 6);
    cam?.setLetterbox?.(true);
    cam?.slowmo?.(boss ? 0.35 : 0.22, boss ? 0.9 : 0.55);
    cam?.flash?.(boss ? f.boss.color : '#e8fbff', 0.35);
    this.shake(boss ? 10 : 6);
    this.sfx('hookset');
    this.sfx('splash_small', { vol: 0.6, pitch: 0.8 });
    const P = this.particles;
    P.impact?.(f.x, f.y, 2, { ramp: 'white', sparkRamp: 'gold' });
    P.pixelSplash?.(f.x, f.y, 1.2);
    P.pixelBurst?.('scale', f.x, f.y, 6, { ramp: 'aqua' });
    P.speedLines?.(f.x, f.y, 18, { r0: 26, r1: 60, inward: true, len: [8, 18], color: '#ffffff' });
    g.water?.disturb?.(f.x, f.y, 1.4, 12); // [phase5:water] hook-set shock wave
    const surf = this.world.surfaceY;
    if (surf !== null && surf !== undefined && f.y - surf < 40) P.eruption?.(f.x, surf, 0.6);
    const [sx, sy] = this.toScreen(f.x, f.y);
    const W = this.W, H = this.H;
    this.fx.speedLines(W / 2, H / 2, 34, { r0: Math.min(W, H) * 0.35, r1: Math.max(W, H) * 0.6, inward: true, speed: [400, 700], len: [20, 46], color: '#ffffff', life: 0.35 });
    this.fx.lensFlare(sx, sy, { cx: W / 2, cy: H / 2, life: 0.9, scale: 0.9 });
    if (!boss) this.titles.add('fishon', auto ? 'AUTO!' : 'FISH ON!', { rarity: f.sp.rarity });
    f.feel('surprised', 0.8);
    f.squashV += 10;
    f.say('!!', 0.8);
    this.setPose('yank', 0.35);
    this.setPose('pull');
    g.onHooked?.(f);
  }

  // Instant shock for older drivers (fires as a full charge).
  tryShock() {
    const B = this.battle;
    if (!B) return false;
    return B.shock();
  }

  bossZoom() { return clamp((this.W * 0.36) / Math.max(12, this.fishLen()), 1.05, 1.7); }

  updateFight(dt) {
    const g = this.game, B = this.battle, f = this.fish, inp = this.input;
    if (!B || !f) { this.releaseFish(false); return; }
    // a click on a boss's minion bonks it; any other mouse hold (or Space / the right button) charges the SHOCK
    if (inp.pressed) this.holdKind = B.boss?.hitMinion?.(inp.x, inp.y) ? 'bonk' : 'charge';
    if (!inp.down) this.holdKind = null;
    const held = (inp.down && this.holdKind === 'charge') || !!inp.key?.(' ') || !!inp.rdown;
    B.updateCharge(this.rdt, held);
    this.shockGrab = this.holdKind === 'charge';
    g.timeScaleTarget = 1;
    const r = B.update(dt);
    this.tension = B.tension;
    f.controlled = true;
    // the stunned fish crackles
    if (B.stunned && rng.chance(dt * 26)) {
      const R = this.fishLen() * 0.45;
      this.particles.electrify?.(f.x + rng.float(-R, R) * 0.5, f.y + rng.float(-3, 3), R, 1, { sparks: rng.chance(0.5) ? 2 : 0 });
    }
    // a red line sprays and creaks
    if (B.red && rng.chance(dt * 6)) this.sfx('reel_tick', { pitch: 0.6, vol: 0.4 });
    // camera: follows the fish, leaning into a pull
    let zoom = f.boss ? this.bossZoom() : this.fightZoom();
    if (B.mode === 'hookset') zoom += 0.25;
    if (B.trick?.kind === 'jump') zoom = 1.55;
    if (B.boss?.stage === 'intro') zoom += 0.35 * Math.max(0, Math.min(1, B.boss.stageT - 0.6));
    const pulling = B.mode === 'pull' || B.mode === 'warn';
    const ld = B.pull?.dir ?? B.away;
    const lk = pulling ? (B.mode === 'pull' ? 1 : 0.4) : 0;
    this.leanX = damp(this.leanX, Math.cos(ld) * lk * 30, 4, dt);
    this.leanY = damp(this.leanY, Math.sin(ld) * lk * 16, 4, dt);
    this.focusCam(f.x + this.leanX / zoom, f.y + this.leanY / zoom, zoom - lk * 0.08, B.mode === 'hookset' ? 6 : 4);
    // character pose from what the player is doing
    if (!this.poseHold) {
      const pose = B.reel > 0.1 || B.stunned ? 'reel' : 'pull';
      if (pose !== this.pose) this.setPose(pose);
    }
    if (r === 'ok') return;
    if (r === 'land') this.beginLanding();
    else this.fail(r);
  }

  // ------------------------------------------------------------------ battle callbacks (juice)
  fishScreen() { const f = this.fish; return f ? this.toScreen(f.x, f.y) : [this.W / 2, this.H / 2]; }
  popOver(text, pal, scale = 3) {
    const [sx, sy] = this.fishScreen();
    const len = this.fishLen() * this.zoom();
    const col = { lime: '#c8f56a', red: '#ff8a7a', sun: '#ffe27a', aqua: '#bff8ff' }[pal] || '#ffffff';
    this.titles.pop(text, clamp(sx, 120, this.W - 120), clamp(sy - len * 0.32 - 70, this.battle?.boss ? 150 : 90, this.H - 160), col, { scale });
  }

  onRed() {
    this.sfx('slack_warn', { vol: 0.6, pitch: 1.3 });
    this.shake(2);
  }

  onWarn(pull) {
    const f = this.fish;
    if (!f) return;
    this.sfx('grunt', { vol: 0.5, pitch: 1.1 + rng.float(-0.1, 0.1) });
    this.sfx('notify', { vol: 0.35, pitch: 0.8 });
    this.particles.pixelBurst?.('sparkle', f.x, f.y - this.fishLen() * 0.3, 4, { ramp: 'gold', size: 0 });
    void pull;
  }

  onPull(pull) {
    const f = this.fish;
    if (!f) return;
    this.sfx('splash_small', { vol: 0.5, pitch: 0.8 });
    this.sfx('reel', { pitch: 0.6, vol: 0.6 });
    this.shake(4);
    this.cam?.punch?.(f.x, f.y, 0.04, 0.2);
    this.particles.impact?.(f.x, f.y, 0, { ramp: 'peach' });
    this.particles.pixelBurst?.('drop', f.x, f.y, 6, { ramp: 'aqua', dir: pull.dir, spread: 0.6, speed: [60, 140] });
  }

  onPullEnd(good, combo) {
    const f = this.fish;
    if (!f) return;
    if (good && !this.battle?.gentle) {
      this.sfx(combo > 1 ? 'timing_perfect' : 'timing_good', { pitch: 1 + Math.min(0.5, combo * 0.08) });
      this.particles.pixelBurst?.('star', f.x, f.y, 6 + Math.min(8, combo * 2), { ramp: 'lime', speed: [50, 140] });
      this.particles.pixelBurst?.('sparkle', f.x, f.y, 5, { ramp: 'white', w: 12, h: 8 });
      this.popOver(combo > 1 ? 'NICE! x' + combo : 'NICE!', 'lime', 3);
      this.setPose('yank', 0.3);
    } else if (!good) {
      this.sfx('timing_miss', { vol: 0.5 });
    }
  }

  onTrick(kind, title) {
    if (!title) return;
    this.popOver(title, kind === 'fake' ? 'aqua' : 'sun', 2);
    if (kind === 'fake') this.sfx('boing', { vol: 0.5 });
  }

  // ---- shock
  onChargeStart() { this.sfx('neon_buzz', { vol: 0.35, pitch: 0.8 }); }

  onChargeFull() {
    const r = panelRect(this);
    this.sfx('timing_perfect', { vol: 0.6, pitch: 1.6 });
    this.fx.zapBurst?.(r.x + r.w - 34 * r.S, r.y + r.h / 2, 4, { layer: 'fg' });
  }

  onChargeCancel(tap) {
    if (tap) return;
    this.sfx('ui_error', { vol: 0.35 });
    const r = panelRect(this);
    this.titles.pop('TOO SOON!', r.x + r.w - 40, r.y - 18, '#bfeaff', { scale: 2 });
  }

  onShockFizzle() {
    this.sfx('ui_error', { vol: 0.4 });
  }

  onShockReady() {
    const r = panelRect(this);
    this.sfx('neon_buzz', { vol: 0.3, pitch: 1.6 });
    this.fx.pixelBurst?.('sparkle', r.x + r.w - 34 * r.S, r.y + r.h / 2, 6, { ramp: 'gold', layer: 'fg' });
  }

  onShockFire(crit) {
    const r = panelRect(this);
    this.zapLine = { t: 0, dur: this.battle?.zap?.dur ?? 0.2, grade: 'perfect' };
    this.sfx('static_burst', { vol: 0.9, pitch: crit ? 0.9 : 1.2 });
    this.sfx('neon_buzz', { vol: 0.5, pitch: 1.6 });
    this.fx.boltBurst?.(r.x + r.w - 34 * r.S, r.y + r.h / 2, 50, 8);
    this.fx.zapBurst?.(r.x + r.w - 34 * r.S, r.y + r.h / 2, 6, { layer: 'fg' });
    const [rx, ry] = this.rodTip();
    this.particles.electrify?.(rx, ry, 8, 3, { flat: 1 });
  }

  onStun(cancelled, crit) {
    const f = this.fish, P = this.particles;
    if (!f) return;
    const R = this.fishLen() * 0.6;
    P.electrify?.(f.x, f.y, R, 7, { sparks: 10 });
    P.boltBurst?.(f.x, f.y, R + 14, 9);
    P.zapBurst?.(f.x, f.y, 8, { r: R * 0.5 });
    P.impact?.(f.x, f.y, crit ? 2 : 1, { ramp: 'cyan', sparkRamp: 'white' });
    this.cam?.flash?.('#bff8ff', crit ? 0.6 : 0.4);
    this.cam?.punch?.(f.x, f.y, crit ? 0.12 : 0.08, 0.3);
    this.shake(crit ? 10 : 6);
    this.sfx('thunder', { vol: 0.35, pitch: 1.6 });
    this.sfx('glitch', { vol: 0.5 });
    f.say('!!', 0.6);
    const [sx, sy] = this.fishScreen();
    this.fx.lensFlare(sx, sy, { cx: this.W / 2, cy: this.H / 2, life: 0.6, scale: 0.6, tint: '#bff8ff' });
    if (cancelled && !crit) this.popOver('ZAP!', 'aqua', 3);
  }

  // ---- bosses
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
    const f = this.fish;
    if (kind === 'charge') { this.sfx('grunt', { vol: 0.8, pitch: 0.6 }); this.sfx('slack_warn', { pitch: 0.7 }); this.shake(4); }
    else if (kind === 'ink') { this.sfx('blub', { pitch: 0.5, vol: 0.9 }); this.titles.banner('INK! CIRCLE TO WIPE', '#c89aff', '', { pal: 'violet' }); this.shake(5); }
    else { this.sfx('whale_call', { vol: 0.4, pitch: 1.6 }); this.titles.banner('MINIONS! CLICK THEM', '#ffe27a', '', { pal: 'sun' }); }
    if (f) this.particles.pixelBurst?.('sparkle', f.x, f.y, 6, { ramp: 'red' });
  }

  onBossCharge(a) {
    const f = this.fish;
    this.sfx('jump_out', { pitch: 0.6 });
    this.sfx('splash_big', { vol: 0.6, pitch: 0.7 });
    if (f) this.particles.speedLines?.(f.x, f.y, 14, { r0: 10, r1: 40, color: '#ffffff', len: [8, 20] });
    void a;
  }

  onBossDodge() {
    this.sfx('timing_perfect', { pitch: 1.2 });
    this.sfx('dodge_hit', { vol: 0.4, pitch: 1.5 });
    const [sx, sy] = this.fishScreen();
    this.fx.pixelBurst?.('star', this.W / 2, this.H * 0.3, 10, { ramp: 'lime', layer: 'fg' });
    void sx; void sy;
  }

  onBossDazed() {
    const f = this.fish;
    this.sfx('eruption_boom', { vol: 0.7, pitch: 1.2 });
    this.sfx('boing', { vol: 0.6, pitch: 0.6 });
    this.shake(9);
    if (f) { this.particles.impact?.(f.x, f.y, 2, { ramp: 'gold' }); this.particles.pixelBurst?.('star', f.x, f.y - 10, 10, { ramp: 'gold' }); }
  }

  onBossHit() {
    const f = this.fish;
    this.sfx('dodge_hit');
    this.sfx('timing_miss');
    this.shake(12);
    this.cam?.flash?.('#ff8a7a', 0.35);
    if (f) this.particles.impact?.(f.x, f.y, 2, { ramp: 'red' });
    this.popOver('OUCH!', 'red', 3);
  }

  onBossCrit() {
    const f = this.fish;
    this.sfx('catch_rare', { vol: 0.6 });
    this.sfx('thunder', { vol: 0.6, pitch: 1.2 });
    this.cam?.slowmo?.(0.3, 0.5);
    if (f) { this.particles.pixelBurst?.('star', f.x, f.y, 16, { ramp: 'gold', speed: [80, 220] }); this.particles.pixelBurst?.('shard', f.x, f.y, 10, { ramp: 'cyan' }); }
    this.popOver('CRITICAL!', 'sun', 4);
  }

  onMinionBite() { this.popOver('CHOMP!', 'red', 2); }
  onMinionBonk() { this.particles.pixelBurst?.('star', this.fish?.x ?? 0, this.fish?.y ?? 0, 0); }

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
    this.particles.pixelBurst?.('shard', m[0], m[1], 6, { ramp: 'white' });
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
    this.particles.catchBurst?.(f.x, f.y, f.sp?.rarity || 'common');
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
    if ((this.state === 'fight' || (this.state === 'landing' && this.finale?.stage === 'surface')) && f) {
      const m = f.anchors?.mouth || [f.x, f.y];
      const [rx, ry] = this.rodTip();
      this.drawRope(ctx, rx, ry, m[0], m[1], this.tension, true);
    } else if (this.state === 'box' && this.box) {
      this.box.drawWorld(ctx);
    } else if (h.visible) {
      const [rx, ry] = this.rodTip();
      this.drawRope(ctx, rx, ry, h.x, h.y - 5, this.state === 'bite' && this.bite ? 0.35 + this.bite.set * 0.5 : 0.2, false);
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
    const amp = fight ? Math.max(0, T - 0.6) * 5 + (B?.mode === 'pull' && !B.stunned ? 0.8 : 0) + (B?.stunned ? 0.7 : 0) : 0;
    const mx = (x0 + x1) / 2, my = (y0 + y1) / 2 + sag;
    // [phase4:zoom] the line is plotted in screen space through the current transform: a crisp 1 px line at any
    // camera zoom (world-space 1x1 dots would turn into fat blocks when zoomed in)
    const m = ctx.getTransform();
    const Z = Math.max(1, Math.hypot(m.a, m.b));
    const steps = Math.max(4, Math.ceil((d * Z) / 1.5));
    let col = '#e8f4ff';
    if (fight) col = tension >= RED ? '#ff6a5a' : tension > 0.6 ? '#ffd25a' : '#e8f4ff';
    if (B?.stunned) col = Math.floor(this.t * 20) % 2 ? '#bff8ff' : '#ffffff';
    const L = d || 1, nx = -(y1 - y0) / L, ny = (x1 - x0) / L;
    // glints travelling up the line while reeling
    const reel = fight ? (this.battle?.reel ?? this.box?.reelK ?? 0) : 0;
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
    if (this.state === 'fight' && this.battle && this.fish) {
      drawFightHud(ctx, this, this.battle);
      try { this.battle.boss?.drawHud(ctx); } catch (e) { if (!this.bossHudErr) { this.bossHudErr = true; console.error(e); } }
    }
    if (this.state === 'box' && this.box) this.box.drawBands(ctx);
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
