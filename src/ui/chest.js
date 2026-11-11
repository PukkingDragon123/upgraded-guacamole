// Chest opening: the bubble person CRACKS THE CHEST OPEN (phase 8 Progression agent; rebuilt [chest16]).
// Panel id 'crate' (the Satchel's "Open!" button and the floating-box flow open it): open({uid} | {tier}).
//
// A little staged scene on a wooden dock: you (the bubble person, in your wardrobe outfit, with a tool) stand next
// to a big detailed voxel chest (src/gfx/chestvox.js) and Bubbles the plush seal watches from the other side.
// Each tier is its own skill minigame (src/ui/chestgames.js): Driftwood Crate = carnival high-striker hammer,
// Iron Crate = crowbar mash with bucks, Golden Chest = chisel to the beat, Mystery Orb = spin it and tap the
// weak spots. Every blow is carved into the voxel chest (splinters, popped nails / bolts, lit seams, cracks in the
// glass) with voxel debris that bounces on the dock, hit-stop, screen shake, squash, 3D voxel pop text and sounds;
// Bubbles flinches, claps and giggles. Misses are funny (the hammer rings, you land on your bum, you hit your thumb)
// and never cost anything; a good run earns bonus loot (crackChest bonus 0..2). At the end the chest bursts open
// (the crate falls apart, lids swing open, the orb shatters), the loot pops out item by item onto cards that flip
// over, and Bubbles reacts to each one. Loot is granted at the burst (closing never loses it).
// After the first chest of a tier: hold the skip pill (or Enter) to crack it at once; intros get shorter.
// Smoke-test hooks: phase ('intro' | 'play' | 'burst' | 'loot' | 'empty'), spots[0] = {x, y} to click, hits, loot.
import { clamp, clamp01, lerp, ease } from '../core/math.js';
import { RARITY, mix, shade, rgba } from '../core/color.js';
import { makeCanvas } from '../core/canvas.js';
import { drawText, measureText } from '../gfx/font.js';
import { hiArt } from '../gfx/hires.js';
import { ITEMS, TIERS, inventory } from '../build/items.js';
import { drawItem } from '../build/itemdraw.js';
import { chestOf, crackChest } from '../build/crates.js';
import { PixFx, partSprite } from '../build/pixart.js';
import { aeroSurface, aeroCached, drawAeroCoin, fmtAero } from './aero.js';
import { drawPop3D } from './pop3d.js';
import { drawCharacter, warmCharacter } from '../gfx/character.js';
import { CHEST_TOOL, CHEST_POSES, poseT, poseFrameT } from '../gfx/chesttools.js';
import { chestModel, damageChest, ChestSprite } from '../gfx/chestvox.js';
import { drawSeal } from '../gfx/seal.js';
import { voxelFishIcon } from '../fish/fishicon.js';
import { GAMES } from './chestgames.js';

const REVEAL_SFX = { common: 'click', uncommon: 'timing_good', rare: 'sparkle', epic: 'magic', legendary: 'golden_shimmer' };
const CHEST_S = 3.1, CHAR_S = 1.9, SEAL_S = 54;
const TITLE_PAL = { crate: 'white', iron: 'aqua', golden: 'gold', orb: 'white' };
const BURST_WORD = { crate: 'SMASHED!', iron: 'POPPED!', golden: 'UNSEALED!', orb: 'SHATTERED!' };
const CHIPS = {
  crate: ['#c8925a', '#e0b07a', '#93603a', '#f4cf94'], iron: ['#ffffff', '#ffe8a8', '#bfe8ff', '#93a4bf'],
  golden: ['#ffd23a', '#fff2b8', '#f0b83c', '#ff3a6a'], orb: ['#ff8ae8', '#8ae8ff', '#ffffff', '#a68aff'],
};
const HIT_SFX = {
  crate: [['wood_hit', 0.8], ['wood_crack', 0.55]], iron: [['chest_hit', 0.7], ['nail_ping', 0.5]],
  golden: [['chest_hit', 0.45], ['sparkle', 0.4]], orb: [['glass_crack', 0.7], ['ice_chime', 0.35]],
};
const R = Math.random;
const rnd = (a, b) => a + R() * (b - a);

export class ChestPanel {
  constructor() {
    this.id = 'crate';
    this.modal = true;
    this.closeOnOutside = false;
    this.sound = 'box_open';
    this.fx = new PixFx(700);
    this.t = 0;
    this.phase = 'empty';
    this.spots = []; this.hits = 0; this.loot = null;
    this.debris = []; this.pops = []; this.cards = []; this.flyers = []; this.pieces = [];
  }

  // ------------------------------------------------------------------ open / reset
  open(data) {
    const g = this.game, st = g.state;
    const inv = inventory(st);
    let pkg = null;
    if (data?.uid) pkg = inv.packages.find((p) => p.uid === data.uid);
    if (!pkg && data?.tier) pkg = inv.packages.find((p) => p.tier === data.tier);
    if (!pkg) pkg = inv.packages[0] || null;
    const again = !!this.nextAfter && this.phase === 'loot';
    this.nextAfter = false;
    this.pkg = pkg;
    this.tier = TIERS[pkg?.tier] ? pkg.tier : 'crate';
    if (!GAMES[this.tier]) this.tier = 'crate';
    this.C = chestOf(this.tier);
    this.kind = CHEST_TOOL[this.tier];
    st.chestStats ||= {};
    this.seen = (st.chestStats[this.tier] || 0) > 0;
    this.phase = pkg ? 'intro' : 'empty';
    this.pt = 0;
    this.t = 0;
    this.k = clamp(Math.round((g.screen.H / 540) * 4) / 4, 1, 2);
    this.cm = pkg ? chestModel(this.tier) : null;
    this.spr = this.cm ? new ChestSprite(this.cm, CHEST_S * this.k) : null;
    this.mg = pkg ? new GAMES[this.tier](this) : null;
    this.hits = 0; this.spots = []; this.loot = null; this.bonus = 0; this.skipped = false;
    this.freeze = 0; this.shake = 0; this.sq = 0; this.lidWob = 0; this.lidAngle = 0; this.lidTarget = 0; this.lidV = 0; this.glow = 0;
    this.orbYaw = 0; this.dmgI = 0; this.finishAt = 0;
    this.debris = []; this.pops = []; this.cards = []; this.flyers = []; this.pieces = []; this.fx.list = [];
    this.beat = null; this.mood = null; this.moodT = 0;
    this.seal = { anim: 'swim', mood: 'happy', until: 0, x: null, bob: 0 };
    this.fish = null; this.skipHold = 0; this.peekT = rnd(4, 7); this.hideOrb = false;
    this.reach = this.reach || null;
    this.entered = again;
    this.introLen = again ? 0.55 : this.seen ? 0.95 : 1.75;
    this.dropT = again ? 0.05 : 0.15;
    this.landed = false;
    this.warm = 0;
  }
  close() { this.flyers = []; }

  // ------------------------------------------------------------------ layout
  stage() {
    const g = this.game, W = g.screen.W, H = g.screen.H, k = this.k || 1;
    const hudTop = Math.min(H, g.hud?.topY?.() ?? H);
    const floorY = Math.round(Math.min(H * 0.74, hudTop - 74 * k));
    const cx = Math.round(W / 2);
    const chestX = Math.round(cx + 40 * k);
    const reach = this.reach ?? Math.round(118 * k);
    const charX = Math.round(this.hitX(chestX, floorY) - reach);
    return { W, H, k, hudTop, floorY, cx, chestX, charX, sealX: Math.round(chestX + 168 * k) };
  }
  get chestX() { return this.S.chestX; }
  get chestY() { return this.S.floorY + this.dropOff(); }
  hitX(chestX, floorY) { return this.spr ? this.spr.toScreen(chestX, floorY, this.impactPoint())[0] : chestX - 60; }
  impactPoint() {
    const cm = this.cm;
    if (cm.tier === 'iron') return cm.pry;
    if (cm.tier === 'orb') return [cm.centre[0] - cm.R * 0.85, cm.centre[1] - 2, cm.centre[2] + cm.R * 0.3];
    if (cm.tier === 'golden') return cm.chiselAt;
    return cm.hits[0];
  }
  chestCentre() { const [x, y] = this.spr.toScreen(this.chestX, this.chestY, [this.cm.anchor[0], 16, this.cm.anchor[2]]); return { x: Math.round(x), y: Math.round(y) }; }
  chestTop() { return this.spr.toScreen(this.chestX, this.chestY, [this.cm.anchor[0], this.cm.m.ny - 2, this.cm.anchor[2]]); }
  pryPoint() { return this.spr.toScreen(this.chestX, this.chestY, this.cm.pry || this.cm.hits[0]); }
  orbCentre() { return this.spr.toScreen(this.chestX, this.chestY, this.cm.centre || [20, 20, 20]); }
  orbYawShown() { return Math.round(this.orbYaw / 10) * 10; }
  onOrb(x, y) { const [cx, cy] = this.orbCentre(); return Math.hypot(x - cx, y - cy) < (this.cm.R || 14) * CHEST_S * this.k * 1.05; }
  dropOff() {
    if (this.phase !== 'intro') return 0;
    const q = clamp01((this.pt - this.dropT) / 0.42);
    if (this.pt < this.dropT) return -400;
    return -Math.round((1 - ease.outBounce(q)) * 280 * this.k);
  }

  // ------------------------------------------------------------------ hooks used by the minigames
  sfx(name, o) { try { this.game.audio?.play?.(name, o); } catch { /* audio optional */ } }
  beatBusy() { return !!this.beat && (this.beat.kind === 'wipe' || this.beat.kind === 'slip' || this.beat.kind === 'ouch') && this.beat.t < this.beat.dur; }
  charBeat(kind, dur) {
    const start = kind === 'chisel' ? poseFrameT('ck_chisel', 2) : kind === 'tap' ? poseFrameT('ck_tap', 2) : 0;
    this.beat = { kind, t: start, dur: dur + start };
  }
  sealSay(anim, mood, secs) { this.seal.anim = anim; this.seal.mood = mood; this.seal.until = this.t + secs; }
  sealBob() { this.seal.bob = 1; }
  shakeBy(a) { if (!this.game.state.settings?.reducedMotion) this.shake = Math.max(this.shake, a); }
  lidShudder(a) { this.lidWob = Math.max(this.lidWob, a); }
  lidKick() { this.lidWob = 1.3; this.lidV -= 60; }
  spark([x, y], n, colors) { this.fx.burst(x, y, n, { kind: 'spark', colors, speed: 120, g: 300, life: 0.4 }); }
  pop(text, palette = 'white', size = 1, x, y) {
    const p = this.S ? (x == null ? this.chestTop() : [x, y]) : [0, 0];
    this.pops.push({ text, palette, size, x: p[0] + rnd(-8, 8), y: p[1] - 18 * this.k, t: 0, life: size >= 1.2 ? 1.2 : 0.85 });
    if (this.pops.length > 5) this.pops.shift();
  }
  finish(delay) { if (!this.finishAt) this.finishAt = this.t + delay; }

  // one blow lands: carve the chest, throw debris, shake, hit-stop, pop text, sounds, reactions
  impact(o) {
    const g = this.game, k = this.k, tier = this.tier;
    const idx = tier === 'orb' ? this.hits - 1 : this.dmgI++;
    const res = damageChest(this.cm, idx, o.power);
    const at = o.at || res.at || this.impactPoint();
    const yawOff = tier === 'orb' ? this.orbYawShown() : 0;
    const [x, y] = this.spr.toScreen(this.chestX, this.chestY, at, yawOff);
    const cc = this.chestCentre();
    const dir = Math.sign(x - cc.x) || -1;
    const pw = o.power;
    // the carved-out voxels fly
    let n = 0;
    for (const v of res.removed) {
      if (n++ > 70) break;
      const [vx, vy] = this.spr.toScreen(this.chestX, this.chestY, [v.x, v.y, v.z], yawOff);
      this.addDebris(vx, vy, v.col, { vx: dir * rnd(30, 170) * (0.6 + pw * 0.5) + rnd(-30, 30), vy: -rnd(90, 300) * (0.5 + pw * 0.45) });
    }
    for (const v of res.popped) {
      const [vx, vy] = this.spr.toScreen(this.chestX, this.chestY, [v.x, v.y, v.z], yawOff);
      this.addDebris(vx, vy, v.col, { vx: dir * rnd(60, 160) + rnd(-40, 40), vy: -rnd(260, 380), kind: v.kind, life: 3.2 });
    }
    const col = CHIPS[tier];
    this.fx.burst(x, y, Math.round(6 + pw * 8), { kinds: tier === 'orb' ? ['shard', 'sparkle', 'spark'] : tier === 'golden' ? ['confetti', 'shard', 'sparkle'] : tier === 'iron' ? ['spark', 'spark', 'star'] : ['chip', 'chip', 'shard'], colors: col, speed: 160 + pw * 90, speedMin: 50, g: 520, life: 0.8, up: 110, scale: 2, a0: dir < 0 ? Math.PI * 0.6 : -Math.PI * 0.4, arc: Math.PI * 0.9 });
    this.fx.burst(x, y, o.quality === 'perfect' ? 6 : 2, { kinds: ['sparkle', 'star'], colors: ['#ffffff', '#fff6a0'], speed: 110, g: 40, life: 0.7, scale: 1 });
    if (tier === 'crate') this.fx.burst(x, y + 4, 3, { kind: 'puff', colors: ['#f6ead0', '#e0c8a0'], speed: 40, g: -20, life: 0.7, scale: 2 });
    for (const [name, vol] of HIT_SFX[tier]) this.sfx(name, { vol: vol * (0.6 + pw * 0.3), pitch: 0.85 + R() * 0.2 + (o.last ? -0.15 : 0) });
    if (res.popped.length) this.sfx('nail_ping', { vol: 0.5, pitch: 1 + R() * 0.3 });
    // feel
    const reduced = !!g.state.settings?.reducedMotion;
    this.freeze = reduced ? 0 : 0.03 + pw * 0.035 + (o.last ? 0.05 : 0);
    this.shakeBy(1.5 + pw * 2.4 + (o.last ? 2 : 0));
    this.sq = Math.min(1, 0.35 + pw * 0.4);
    this.lidWob = Math.max(this.lidWob, 0.5 + pw * 0.4);
    this.glow = Math.min(1, this.glow + 0.18);
    if (o.lid != null) this.lidTarget = o.lid;
    const top = this.chestTop();
    this.pop(o.text, o.palette, o.last ? 1.7 : o.small ? 1 : o.quality === 'perfect' ? 1.55 : o.quality === 'weak' ? 0.95 : 1.25, lerp(x, top[0], 0.35), Math.min(y, top[1]) - 14 * k);
    // reactions
    if (o.quality === 'perfect') { this.sealSay('clap', 'excited', 0.75); this.mood = 'excited'; this.moodT = 0.6; }
    else if (o.quality === 'weak') { if (R() < 0.7) this.sealSay('wiggle', 'laugh', 0.8); this.mood = 'surprised'; this.moodT = 0.5; }
    else if (R() < 0.35) this.sealSay('idle', 'surprised', 0.4);
  }

  addDebris(x, y, col, o = {}) {
    const k = this.k;
    this.debris.push({ x, y, vx: o.vx || 0, vy: o.vy || 0, col, kind: o.kind || 'cube', size: o.size || (R() < 0.3 ? 3 : 2), fy: this.S.floorY + rnd(-7, 9) * k, life: o.life ?? rnd(2.2, 3.4), t: 0, rot: R() * 4, vr: rnd(-14, 14), bounced: 0 });
    if (this.debris.length > 520) this.debris.splice(0, this.debris.length - 520);
  }

  // a fish flops out of the crate (a joke) and Bubbles snaps it up
  fishJoke() {
    const [x, y] = this.spr.toScreen(this.chestX, this.chestY, this.cm.hits[Math.max(0, this.dmgI - 1)] || this.impactPoint());
    this.fish = { x, y, vx: rnd(60, 110), vy: -rnd(300, 360), t: 0, state: 'fly', rot: 0, face: 1, hops: 0 };
    this.sfx('jump_out', { vol: 0.5 }); this.sfx('blub', { vol: 0.5, pitch: 1.3 });
    this.sealSay('idle', 'surprised', 0.9);
  }

  // ------------------------------------------------------------------ frame
  draw(ctx, ui, dt) {
    const g = this.game, inp = ui.inp;
    dt = Math.max(0, Math.min(0.05, dt || 0.016));
    const S = (this.S = this.stage());
    this.rect = { x: 0, y: 0, w: S.W, h: S.H };
    if (this.phase === 'empty') {
      drawText(ctx, 'No chests in your Satchel!', S.cx, S.floorY - 60, { font: 'big', scale: 2, align: 'center', color: '#ffffff', shadow: '#0a3e74' });
      if (ui.button(ctx, S.cx - 70, S.floorY - 20, 140, 30, 'Back', { style: 'aqua' })) ui.close(this.id);
      return;
    }
    // hit-stop: the world holds its breath for a few frames
    const frozen = this.freeze > 0;
    this.freeze -= dt;
    const gdt = frozen ? 0 : dt;
    this.t += gdt; this.pt += gdt;
    this.tick(gdt, ui, S);
    // ---- draw
    this.drawBackdrop(ctx, S);
    const sh = this.shake, sx = Math.round((R() - 0.5) * sh * 2), sy = Math.round((R() - 0.5) * sh * 1.2);
    ctx.save();
    ctx.translate(sx, sy);
    if (this.phase === 'play' && this.mg.behind) this.mg.draw(ctx, S);
    this.drawSealGuide(ctx, S);
    this.drawChest(ctx, S);
    this.drawPieces(ctx);
    this.drawHero(ctx, S);
    this.drawDebris(ctx);
    this.drawFish(ctx, S);
    this.fx.draw(ctx);
    if (this.phase === 'play' && !this.mg.behind) this.mg.draw(ctx, S);
    ctx.restore();
    this.drawPops(ctx);
    this.drawHeader(ctx, ui, S);
    if (this.phase === 'loot') this.drawLoot(ctx, ui, S, gdt);
  }

  tick(dt, ui, S) {
    const g = this.game, inp = ui.inp, k = this.k;
    this.shake = Math.max(0, this.shake - dt * 14 - this.shake * dt * 3);
    this.sq = Math.max(0, this.sq - dt * 5);
    this.lidWob = Math.max(0, this.lidWob - dt * 2.4);
    this.glow = Math.max(0, this.glow - dt * 0.15);
    this.seal.bob = Math.max(0, this.seal.bob - dt * 8);
    this.moodT -= dt;
    if (this.beat) { this.beat.t += dt; if (this.beat.t >= this.beat.dur) this.beat = null; }
    // lid spring (iron / golden swing on a hinge)
    this.lidV += ((this.lidTarget - this.lidAngle) * 180 - this.lidV * 14) * dt;
    this.lidAngle = Math.max(-2, this.lidAngle + this.lidV * dt);
    this.fx.update(dt);
    this.updateDebris(dt);
    this.updatePieces(dt);
    this.updateFish(dt, S);
    for (const p of this.pops) p.t += dt;
    this.pops = this.pops.filter((p) => p.t < p.life);
    // warm the poses: the impact pose first (to measure the reach), the rest in the background
    if (this.warm < 2) {
      const look = g.state.character, scale = CHAR_S * k;
      const ip = this.tier === 'iron' ? 'ck_pry' : this.tier === 'golden' ? 'ck_chisel' : this.tier === 'orb' ? 'ck_tap' : 'ck_smash';
      if (this.warm === 0 && warmCharacter(look, { poses: [ip], scale, facing: 1, ms: 14 })) {
        this.warm = 1;
        const m = drawCharacter(scratch(), 0, 0, { pose: ip, t: this.tier === 'iron' ? poseT('ck_pry', 0.5) : poseFrameT(ip, 3), facing: 1, scale, look, trail: false, shadow: false, id: 'measure' });
        const tip = this.tier === 'golden' ? m.tool2 : m.rodTip;
        if (tip && Number.isFinite(tip[0])) this.reach = Math.round(tip[0] + (this.tier === 'orb' ? 2 : this.tier === 'golden' ? 1 : 3) * k);
      } else if (this.warm === 1 && warmCharacter(look, { poses: CHEST_POSES(this.kind), scale, facing: 1, ms: 7 })) this.warm = 2;
    }
    if (this.phase === 'intro') {
      if (!this.landed && this.pt >= this.dropT + 0.42) {
        this.landed = true;
        this.sfx('chest_thud', { vol: 0.8 }); this.sfx('wood_hit', { vol: 0.35, pitch: 0.7 });
        this.shakeBy(3.5); this.sq = 0.9; this.lidWob = 1;
        const [x0] = this.spr.toScreen(this.chestX, S.floorY, [0, 0, this.cm.anchor[2]]), [x1] = this.spr.toScreen(this.chestX, S.floorY, [this.cm.m.nx, 0, this.cm.anchor[2]]);
        this.fx.burst(x0, S.floorY, 5, { kind: 'puff', colors: ['#f6ead0', '#d8e8f0'], speed: 70, g: -10, life: 0.9, scale: 2, a0: Math.PI * 0.8, arc: Math.PI * 0.4 });
        this.fx.burst(x1, S.floorY, 5, { kind: 'puff', colors: ['#f6ead0', '#d8e8f0'], speed: 70, g: -10, life: 0.9, scale: 2, a0: -Math.PI * 0.2, arc: Math.PI * 0.4 });
        this.sealSay('idle', 'surprised', 0.5);
      }
      if (this.pt >= this.introLen && (this.warm >= 1 || this.pt > 4)) { this.phase = 'play'; this.pt = 0; this.mg.start(); }
    }
    // skip (after the first chest of this tier): hold the pill or Enter
    const pill = this.skipRect(S);
    const overUi = pill && ui.hover(pill) || ui.hover({ x: S.W - 40, y: 38, w: 34, h: 34 });
    if (pill && (this.phase === 'intro' || this.phase === 'play')) {
      const holding = (inp.down && ui.hover(pill)) || inp.key?.('Enter');
      this.skipHold = holding ? this.skipHold + dt : Math.max(0, this.skipHold - dt * 2);
      if (this.skipHold >= 0.55) { this.skipped = true; this.skipHold = 0; this.startBurst(); }
    }
    if (this.phase === 'play') {
      let click = false;
      if (inp.pressed && !overUi) { click = true; inp.pressed = false; }
      if (inp.keyPressed?.(' ') && this.tier !== 'orb') click = true;
      if (this.autoplay && this.mg.autoClick?.()) click = true; // dev preview
      this.mg.update(dt, inp, click);
      // the chest is alive: now and then the lid hops (something inside wants out)
      this.peekT -= dt;
      if (this.peekT <= 0 && this.tier !== 'orb' && !this.finishAt) {
        this.peekT = rnd(4.5, 8);
        if (this.tier !== 'iron') { this.lidWob = 1.1; this.sfx('squeak', { vol: 0.35, pitch: rnd(1.1, 1.5) }); this.sealSay('idle', 'surprised', 0.6); }
      }
      if (this.finishAt && this.t >= this.finishAt) this.startBurst();
    } else if (this.phase === 'burst') {
      const len = this.skipped || this.seen ? 0.32 : 0.62;
      this.shakeBy(0.6 + (this.pt / len) * 2.2);
      this.lidWob = Math.max(this.lidWob, 0.6 + this.pt * 1.5);
      this.glow = Math.min(1, this.glow + dt * 2);
      if (((this.pt * 12) | 0) !== (((this.pt - dt) * 12) | 0)) this.sfx(this.tier === 'orb' ? 'glass_crack' : this.tier === 'crate' ? 'wood_crack' : 'chest_hit', { vol: 0.3, pitch: 1 + this.pt });
      if (this.pt >= len) this.explode();
    }
    // Bubbles' mood returns to watching
    if (this.seal.until && this.t > this.seal.until) { this.seal.until = 0; this.seal.anim = 'idle'; this.seal.mood = 'happy'; }
  }

  // ------------------------------------------------------------------ the burst
  startBurst() {
    if (this.phase === 'burst' || this.phase === 'loot') return;
    this.phase = 'burst'; this.pt = 0;
    this.bonus = this.skipped ? 0 : Math.max(0, Math.min(2, this.mg?.bonus?.() | 0));
    this.loot = crackChest(this.game, this.pkg, { bonus: this.bonus });
    const st = this.game.state;
    st.chestStats ||= {};
    st.chestStats[this.tier] = (st.chestStats[this.tier] || 0) + 1;
    this.spots = [];
    this.sealSay('worried', 'excited', 2);
  }

  explode() {
    const g = this.game, k = this.k, S = this.S, cm = this.cm, tier = this.tier;
    this.phase = 'loot'; this.pt = 0;
    this.shakeBy(7); this.freeze = g.state.settings?.reducedMotion ? 0 : 0.08;
    const top = this.chestTop(), cc = this.chestCentre();
    if (tier === 'crate') {
      // the lid flies, the walls fall apart into planks and splinters
      const lid = this.spr.piece(2);
      this.pieces.push({ r: lid, py: Math.round(top[1] - this.chestY), x: 0, y: 0, vx: rnd(-40, 60) * k, vy: -420 * k, rot: 0, vr: rnd(-5, 5), t: 0 });
      for (const p of [3, 4, 5]) this.shatter(p, 0.3);
      for (const p of [3, 4, 5, 2]) cm.detached.add(p);
      cm.ver++;
      this.sfx('wood_crack', { vol: 0.9, pitch: 0.8 }); this.sfx('chest_thud', { vol: 0.8 });
    } else if (tier === 'orb') {
      this.hideOrb = true;
      this.shatter(7, 0.2, true);
      this.sfx('glass_crack', { vol: 1, pitch: 0.8 }); this.sfx('ice_chime', { vol: 0.6, pitch: 1.3 });
    } else {
      this.lidTarget = 108; this.lidV = 900;
      this.sfx('lock_open', { vol: 0.8 }); this.sfx('box_open', { vol: 0.7 });
    }
    this.sfx(tier === 'golden' || tier === 'orb' ? 'golden_shimmer' : 'treasure_open', { vol: 0.85 });
    this.sfx('eruption_boom', { vol: 0.35, pitch: 1.4 });
    this.fx.burst(top[0], top[1], 34, { kinds: ['confetti', 'confetti', 'star', 'sparkle', 'heart'], colors: ['#ffffff', '#ffe27a', '#ff9ad0', '#8ae8ff', '#8ae84a', CHIPS[tier][0]], speed: 320, speedMin: 90, g: 260, life: 1.8, up: 140, scale: 2, a0: -Math.PI * 0.95, arc: Math.PI * 0.9 });
    this.fx.burst(cc.x, cc.y, 12, { kind: 'puff', colors: ['#ffffff', '#e8f4ff'], speed: 110, g: -30, life: 1, scale: 2 });
    this.pop(BURST_WORD[tier], 'gold', 1.6, cc.x, top[1] - 12 * k);
    if (this.bonus) this.bonusPopAt = this.t + 0.9;
    this.beat = { kind: 'cheer', t: 0, dur: 1.5 };
    this.sealSay('spin', 'excited', 0.85);
    this.sealNext = { anim: 'clap', mood: 'love', at: this.t + 0.85, secs: 1.2 };
    this.buildCards(S);
  }

  // turn one piece of the chest into tumbling voxel debris (sampled)
  shatter(p, keep, radial = false) {
    const cm = this.cm, { m, pid } = cm, nx = m.nx, ny = m.ny;
    const cc = this.chestCentre(), k = this.k;
    const yawOff = p === 7 ? this.orbYawShown() : 0;
    const [ox, oy] = p === 7 ? this.orbCentre() : [cc.x, cc.y];
    let n = 0;
    for (let z = 0; z < m.nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
      const i = x + nx * (y + ny * z);
      if (pid[i] !== p || !m.data[i]) continue;
      if (R() > keep) continue;
      if (n++ > 360) break;
      const [sx, sy] = this.spr.toScreen(this.chestX, this.chestY, [x, y, z], yawOff);
      const col = m.palette[m.data[i]]?.color || '#ffffff';
      const dx = sx - ox, dy = sy - oy, d = Math.hypot(dx, dy) || 1;
      const sp = radial ? rnd(120, 340) : rnd(40, 200);
      const out = p === 4 ? -1 : p === 5 ? 1 : 0;
      this.addDebris(sx, sy, col, { vx: radial ? (dx / d) * sp : out * rnd(60, 200) + (dx / d) * sp * 0.5, vy: radial ? (dy / d) * sp - rnd(80, 200) : -rnd(60, 260) + (p === 3 ? 0 : -40), size: R() < 0.25 ? 4 : R() < 0.5 ? 3 : 2, life: rnd(2.4, 4) });
    }
    void k;
  }

  updatePieces(dt) {
    const k = this.k;
    for (const P of this.pieces) { P.t += dt; P.vy += 1100 * k * dt; P.x += P.vx * dt; P.y += P.vy * dt; P.rot += P.vr * dt; }
    this.pieces = this.pieces.filter((P) => P.t < 2.5 && P.y < 900);
  }
  drawPieces(ctx) {
    for (const P of this.pieces) {
      const r = P.r;
      ctx.save();
      ctx.translate(Math.round(this.chestX + P.x), Math.round(this.chestY + P.py + P.y));
      ctx.rotate(Math.round(P.rot * 8) / 8);
      ctx.drawImage(r.canvas, Math.round(-r.ax), Math.round(-r.ay - P.py));
      ctx.restore();
    }
  }

  // ------------------------------------------------------------------ debris (voxel cubes, nails, bolts)
  updateDebris(dt) {
    const k = this.k;
    for (const d of this.debris) {
      d.t += dt;
      d.vy += 980 * k * dt;
      d.x += d.vx * dt; d.y += d.vy * dt;
      d.rot += d.vr * dt;
      if (d.y > d.fy) {
        d.y = d.fy;
        if (d.vy > 70 * k) {
          d.vy *= -0.38; d.vx *= 0.62; d.vr *= 0.6; d.bounced++;
          if (d.bounced === 1 && (d.kind === 'nail' || d.kind === 'bolt')) this.sfx('nail_ping', { vol: 0.3, pitch: rnd(1.2, 1.8) });
        } else { d.vy = 0; d.vx *= Math.max(0, 1 - dt * 9); d.vr *= Math.max(0, 1 - dt * 9); }
      }
    }
    this.debris = this.debris.filter((d) => d.t < d.life);
  }
  drawDebris(ctx) {
    for (const d of this.debris) {
      const a = clamp01((d.life - d.t) / 0.5);
      if (a <= 0) continue;
      ctx.globalAlpha = a;
      const spr = d.kind === 'nail' ? nailSprite(d.col, Math.round(d.rot) & 3) : d.kind === 'bolt' ? boltSprite(d.col) : cubeSprite(d.col, d.size);
      ctx.drawImage(spr, Math.round(d.x - spr.width / 2), Math.round(d.y - spr.height));
    }
    ctx.globalAlpha = 1;
  }

  updateFish(dt, S) {
    const f = this.fish;
    if (!f) return;
    const k = this.k;
    f.t += dt;
    if (f.state === 'fly' || f.state === 'flop') {
      f.vy += 1000 * k * dt; f.x += f.vx * dt; f.y += f.vy * dt; f.rot += (f.state === 'fly' ? 10 : 0) * dt;
      const fy = S.floorY + 4 * k;
      if (f.y > fy) {
        f.y = fy; f.state = 'flop'; f.rot = 0;
        if (f.hops < 3) { f.vy = -rnd(140, 200) * k; f.vx = rnd(-50, 50); f.face = -f.face; f.hops++; this.sfx('splash_small', { vol: 0.25, pitch: 1.4 }); }
        else { f.vy = 0; f.vx = 0; f.state = 'wait'; f.t = 0; }
      }
    } else if (f.state === 'wait' && f.t > 0.35) {
      f.state = 'gulp'; f.t = 0; f.x0 = f.x; f.y0 = f.y;
      this.sealSay('wiggle', 'excited', 0.6);
    } else if (f.state === 'gulp') {
      const q = clamp01(f.t / 0.45);
      const mx = this.sealMouth?.[0] ?? S.sealX, my = this.sealMouth?.[1] ?? S.floorY - 30 * k;
      f.x = lerp(f.x0, mx, q); f.y = lerp(f.y0, my, q) - Math.sin(q * Math.PI) * 60 * k; f.rot = q * 6;
      if (q >= 1) {
        this.fish = null;
        this.sfx('gulp', { vol: 0.6 });
        this.sealSay('wiggle', 'love', 1.2);
        this.fx.burst(mx, my - 6, 4, { kind: 'heart', colors: ['#ff7ab0', '#ffb0d8'], speed: 50, g: -60, life: 1.1, scale: 1 });
      }
    }
  }
  drawFish(ctx) {
    const f = this.fish;
    if (!f) return;
    const k = this.k;
    const c = voxelFishIcon(null, Math.round(26 * k), Math.round(16 * k), { dir: f.face });
    if (!c) return;
    ctx.save();
    ctx.translate(Math.round(f.x), Math.round(f.y - 6 * k));
    const wig = f.state === 'flop' || f.state === 'wait' ? Math.sin(f.t * 30) * 0.25 : 0;
    ctx.rotate(Math.round((f.rot + wig) * 8) / 8);
    ctx.drawImage(c, -Math.round(c.width / 2), -Math.round(c.height / 2));
    ctx.restore();
  }

  // ------------------------------------------------------------------ scene drawing
  drawBackdrop(ctx, S) {
    const k = this.k;
    // a soft dusk wash over the world, deeper at the bottom
    ctx.fillStyle = 'rgba(8,26,52,0.35)';
    ctx.fillRect(0, 0, S.W, S.H);
    for (let i = 0; i < 6; i++) { ctx.fillStyle = `rgba(6,20,44,${0.05 + i * 0.03})`; ctx.fillRect(0, Math.round(S.floorY - 40 * k + i * 16 * k), S.W, Math.round(S.H)); }
    // the dock
    const dw = Math.min(S.W - 40, Math.round(720 * k));
    const dock = aeroCached(`chestdock|${dw}|${k}`, () => dockArt(dw, k));
    ctx.drawImage(dock, Math.round(S.cx + 14 * k - dw / 2), Math.round(S.floorY - 16 * k));
  }

  drawChest(ctx, S) {
    if (!this.spr) return;
    const k = this.k, t = this.t;
    const X = this.chestX, Y = this.chestY;
    const sq = ease.outQuad(this.sq);
    const wob = this.lidWob;
    // contact shadow
    if (this.phase !== 'loot' || this.tier !== 'orb') {
      const lift = clamp01(-this.dropOff() / (200 * k));
      const hw = Math.round(52 * k * (1 - lift * 0.5));
      ctx.fillStyle = 'rgba(20,10,30,0.28)';
      for (let i = -2; i <= 2; i++) { const w2 = Math.round(hw * Math.sqrt(1 - (i / 3) ** 2)); ctx.fillRect(X - w2 + Math.round(4 * k), S.floorY + i + 2, w2 * 2, 1); }
    }
    ctx.save();
    ctx.translate(X, Y);
    ctx.scale(1 + sq * 0.07, 1 - sq * 0.08);
    ctx.translate(-X, -Y);
    const lidDx = Math.round(Math.sin(t * 47) * wob * 1.6), lidDy = -Math.round(Math.abs(Math.sin(t * 31)) * wob * 3.2);
    let ang = this.lidAngle;
    ang = ang < 1 ? 0 : this.phase === 'loot' && Math.abs(this.lidAngle - this.lidTarget) > 6 ? Math.round(ang / 12) * 12 : Math.round(ang / 2) * 2;
    this.spr.draw(ctx, X, Y, { lidAngle: Math.min(115, ang), lidDx, lidDy, glow: this.glow, orbYaw: this.orbYawShown(), orbDx: this.mg?.wob ? Math.round(Math.sin(t * 50) * this.mg.wob * 3) : 0, hideOrb: this.hideOrb, noLid: this.tier === 'crate' && this.cm.detached.has(2) });
    ctx.restore();
    // the open chest glows from inside while the loot comes out
    if (this.phase === 'loot' && this.pt < 3) {
      const [tx, ty] = this.chestTop();
      if (((t * 8) | 0) % 2) this.fx.add({ x: tx + rnd(-30, 30) * k, y: ty + rnd(10, 30) * k, vy: -rnd(30, 70), g: -10, life: 0.8, kind: R() < 0.5 ? 'sparkle' : 'spark', color: R() < 0.5 ? '#ffffff' : CHIPS[this.tier][1] });
    }
  }

  heroPose() {
    const kind = this.kind;
    const b = this.beat;
    if (b) {
      if (b.kind === 'wipe') return { pose: 'ck_wipe_' + kind, t: b.t };
      if (b.kind === 'slip') return { pose: 'ck_slip', t: Math.min(b.t, 0.49) };
      if (b.kind === 'ouch') return { pose: 'ck_ouch', t: b.t };
      if (b.kind === 'chisel') return { pose: 'ck_chisel', t: Math.min(b.t, 0.239) };
      if (b.kind === 'tap') return { pose: 'ck_tap', t: Math.min(b.t, 0.259) };
      if (b.kind === 'cheer') return { pose: 'ck_cheer_' + kind, t: b.t };
    }
    if (this.phase === 'intro' && !this.entered && this.pt < this.introLen * 0.7) return { pose: 'ck_walk_' + kind, t: this.pt };
    if (this.phase === 'play') { const p = this.mg.pose(); if (p) return p; }
    return { pose: 'ck_ready_' + kind, t: this.t };
  }
  heroX(S) {
    if (this.phase !== 'intro' || this.entered) return S.charX;
    const q = clamp01(this.pt / (this.introLen * 0.7));
    const from = this.seen ? S.charX - 70 * this.k : -40;
    return Math.round(lerp(from, S.charX, ease.outQuad(q)));
  }
  drawHero(ctx, S) {
    const g = this.game, k = this.k;
    const { pose, t } = this.heroPose();
    const top = this.chestTop();
    const mood = this.moodT > 0 ? this.mood : this.phase === 'loot' ? 'happy' : null;
    try {
      drawCharacter(ctx, this.heroX(S), S.floorY, { pose, t, facing: 1, scale: CHAR_S * k, look: g.state.character, lookAt: this.phase === 'loot' ? [top[0], top[1] - 60 * k] : top, id: 'chest', mood, trail: false });
    } catch (e) { if (!this.charErr) { this.charErr = true; console.warn('chest hero', e); } }
  }
  drawSealGuide(ctx, S) {
    const k = this.k, sl = this.seal;
    let x = S.sealX;
    let anim = sl.anim;
    if (this.phase === 'intro' && !this.entered) {
      const q = clamp01((this.pt - 0.2) / 0.9);
      x = Math.round(lerp(S.W + 70 * k, S.sealX, ease.outCubic(q)));
      if (q < 1) anim = 'swim';
    }
    if (this.sealNext && this.t >= this.sealNext.at) { this.sealSay(this.sealNext.anim, this.sealNext.mood, this.sealNext.secs); this.sealNext = null; }
    const look = this.fish ? [this.fish.x, this.fish.y] : this.phase === 'loot' ? this.chestTop() : this.chestTop();
    try {
      const A = drawSeal(ctx, { x, y: S.floorY + 2 - Math.round(sl.bob * 3), base: 'bottom', t: this.t, size: Math.round(SEAL_S * k), anim, mood: sl.mood, facing: -1, view: anim === 'swim' ? 'side' : 'front', lookAt: look, id: 'chestseal', noseBubble: anim === 'idle' && this.phase === 'play' ? 0.6 : 0 });
      if (A?.mouth) this.sealMouth = A.mouth;
    } catch (e) { if (!this.sealErr) { this.sealErr = true; console.warn('chest seal', e); } }
  }

  drawPops(ctx) {
    for (const p of this.pops) {
      const fade = clamp01((p.life - p.t) / 0.25);
      const rise = ease.outCubic(clamp01(p.t / p.life)) * 22 * this.k;
      drawPop3D(ctx, p.text, Math.round(p.x), Math.round(p.y - rise), { t: this.t, pop: clamp01(p.t / 0.18), alpha: fade, palette: p.palette, scale: p.size * 1.6 * this.k, wobble: 0.6, glow: false, sparkle: p.size >= 1.2 });
    }
    if (this.bonusPopAt && this.t >= this.bonusPopAt) {
      this.bonusPopAt = 0;
      const top = this.chestTop();
      this.pops.push({ text: this.bonus > 1 ? '+2 BONUS!' : '+1 BONUS!', palette: 'leaf', size: 1.1, x: top[0] + 90 * this.k, y: top[1] - 10 * this.k, t: 0, life: 1.8 });
      this.sfx('timing_perfect', { vol: 0.6 });
    }
  }

  skipRect(S) {
    if (!this.seen || !(this.phase === 'intro' || this.phase === 'play')) return null;
    const k = this.k, w = Math.round(104 * k), h = Math.round(22 * k);
    return { x: S.W - w - Math.round(14 * k), y: Math.round(S.floorY + 34 * k), w, h };
  }

  drawHeader(ctx, ui, S) {
    const k = this.k, t = this.t;
    // chest name in voxel letters
    drawPop3D(ctx, this.C.name, S.cx, Math.round(30 * k), { t, pop: clamp01((this.t + 0.2) / 0.4), palette: TITLE_PAL[this.tier], scale: 1.1 * k, wobble: 0.35, glow: false, sparkle: true });
    // hint plaque (icon + a few words)
    if (this.phase === 'play' && !this.finishAt) {
      const h = this.mg.hint();
      const w = measureText(h.text, 'normal') + Math.round(34 * k);
      const x = Math.round(S.cx - w / 2), y = Math.round(54 * k);
      ctx.drawImage(aeroCached(`chesthint|${w}|${k}`, () => aeroSurface(w, Math.round(18 * k), { tone: 'dark', r: 'pill', gloss: 0.5, glossH: 6, rim: 0.7 })), x, y);
      drawHintIcon(ctx, h.icon, x + Math.round(12 * k), y + Math.round(9 * k), t, k);
      drawText(ctx, h.text, x + Math.round(24 * k), y + Math.round(5 * k), { color: '#fff6c0', shadow: '#0a1e3a' });
    }
    // hold to skip
    const pill = this.skipRect(S);
    if (pill) {
      const hov = ui.hover(pill);
      ctx.drawImage(aeroCached(`chestskip|${pill.w}|${pill.h}|${hov}`, () => aeroSurface(pill.w, pill.h, { tone: hov ? 'aqua' : 'dark', r: 'pill', gloss: 0.6, glossH: 7, rim: 0.8 })), pill.x, pill.y);
      const fw = Math.round((pill.w - 8) * clamp01(this.skipHold / 0.55));
      if (fw > 0) { ctx.fillStyle = 'rgba(138,232,74,0.85)'; ctx.fillRect(pill.x + 4, pill.y + 4, fw, pill.h - 8); }
      drawText(ctx, 'Hold to skip', pill.x + pill.w / 2, pill.y + Math.round(pill.h / 2) - 3, { align: 'center', color: '#ffffff', shadow: '#0a1e3a' });
    }
    // leave (keeps the chest while it is still closed)
    if ((this.phase === 'intro' || this.phase === 'play') && !this.finishAt && ui.button(ctx, S.W - 34, 44, 24, 24, '', { icon: 'cross', tip: 'Later (Esc)' })) ui.close(this.id);
  }

  // ------------------------------------------------------------------ loot reveal: one by one onto flip cards
  buildCards(S) {
    const k = this.k, list = this.loot || [];
    const n = list.length, per = Math.min(n, 8), rows = Math.ceil(n / per) || 1;
    const SW = Math.round(70 * k), SH = Math.round(86 * k), gap = Math.round(8 * k);
    const y0 = Math.round(Math.max(76 * k, S.floorY - 150 * k - rows * (SH + gap) - 20 * k));
    const fast = this.skipped || this.seen;
    this.revealGap = fast ? 0.26 : 0.46;
    this.cards = list.map((e, i) => {
      const row = Math.floor(i / per), inRow = Math.min(per, n - row * per), c = i % per;
      const x = Math.round(S.W / 2 - (inRow * (SW + gap) - gap) / 2 + c * (SW + gap));
      return { ...e, x, y: y0 + row * (SH + gap), w: SW, h: SH, at: 0.35 + i * this.revealGap, state: 'wait', t: 0, rarity: e.id === 'coins' ? 'common' : ITEMS[e.id]?.rarity || 'common' };
    });
  }

  drawLoot(ctx, ui, S, dt) {
    const g = this.game, k = this.k;
    // click / Space hurries the reveal along
    if ((ui.inp.pressed || ui.inp.keyPressed?.(' ')) && this.cards.some((c) => c.state !== 'shown')) {
      ui.inp.pressed = false;
      let n = 0;
      for (const c of this.cards) if (c.state === 'wait') c.at = Math.min(c.at, this.pt + 0.05 + 0.08 * n++);
    }
    const [mx, my] = this.chestTop();
    let allIn = true;
    for (const c of this.cards) {
      if (c.state === 'wait') { allIn = false; if (this.pt >= c.at) { c.state = 'fly'; c.t = 0; this.sfx('mash_pop', { vol: 0.4, pitch: 1 + R() * 0.3 }); } continue; }
      c.t += dt;
      if (c.state === 'fly') {
        allIn = false;
        const q = clamp01(c.t / 0.45);
        this.drawCardBack(ctx, c, ease.outBack(clamp01(c.t / 0.25)));
        const e = ease.inOutQuad(q);
        const x = lerp(mx, c.x + c.w / 2, e), y = lerp(my + 10 * k, c.y + c.h * 0.55, e) - Math.sin(q * Math.PI) * 70 * k;
        this.drawLootIcon(ctx, c, x, y + 14 * k, 0.6 + q * 0.4);
        if (R() < 0.5) this.fx.add({ x: x + rnd(-4, 4), y, vx: 0, vy: 20, g: 0, life: 0.35, kind: 'spark', color: RARITY[c.rarity]?.color || '#ffffff' });
        if (q >= 1) { c.state = 'flip'; c.t = 0; }
        continue;
      }
      if (c.state === 'flip') {
        allIn = false;
        const q = clamp01(c.t / 0.22);
        if (q < 0.5) this.drawCardBack(ctx, c, 1, 1 - q * 2);
        else this.drawCard(ctx, ui, c, (q - 0.5) * 2);
        if (q >= 1) { c.state = 'shown'; c.t = 0; this.revealFx(c); }
        continue;
      }
      this.drawCard(ctx, ui, c, 1);
    }
    // flyers to the Satchel
    for (const f of this.flyers) {
      f.t += dt;
      const q = clamp01(f.t / f.dur);
      if (q <= 0) continue;
      const e = ease.inCubic(q);
      const x = lerp(f.x0, f.x1, e), y = lerp(f.y0, f.y1, e) - Math.sin(q * Math.PI) * 80;
      this.drawLootIcon(ctx, f.c, x, y + 14, 1 - q * 0.5);
      if (q >= 1 && !f.done) { f.done = true; this.sfx('coin_collect', { vol: 0.4, pitch: 1 + R() * 0.3 }); this.fx.burst(f.x1, f.y1, 6, { kind: 'star', colors: ['#ffffff', '#ffe27a'], speed: 90, g: 100, life: 0.5 }); }
    }
    if (this.flyers.length && this.flyers.every((f) => f.done)) { this.flyers = []; this.afterCollect(); return; }
    const last = this.cards[this.cards.length - 1];
    if (allIn && !this.flyers.length && (!last || last.t > 0.3)) {
      const left = (inventory(g.state).packages || []).length;
      const bw = Math.round(150 * k), bh = Math.round(30 * k), by = Math.round(S.floorY + 32 * k);
      const bx = left ? S.cx - bw - 6 : S.cx - bw / 2;
      if (ui.button(ctx, bx, by, bw, bh, 'Collect!', { style: 'green', icon: 'check', sound: 'ui_buy' }) || ui.inp.keyPressed?.('Enter')) this.collect(false);
      if (left && ui.button(ctx, S.cx + 6, by, bw, bh, `Open next (${left})`, { style: 'orange', icon: 'star' })) this.collect(true);
    }
  }

  revealFx(c) {
    const col = RARITY[c.rarity]?.color || '#ffffff';
    const big = c.rarity === 'epic' || c.rarity === 'legendary';
    const cx = c.x + c.w / 2, cy = c.y + c.h / 2;
    this.fx.burst(cx, cy, big ? 30 : 10, { kinds: big ? ['sparkle', 'star', 'confetti'] : ['spark', 'star'], colors: [col, '#ffffff', mix(col, '#ffffff', 0.5)], speed: big ? 240 : 120, g: 220, life: big ? 1.1 : 0.6, up: 50, scale: big ? 2 : 1 });
    this.sfx(REVEAL_SFX[c.rarity] || 'click', { vol: 0.6 });
    if (c.rarity === 'legendary') { this.pop('LEGENDARY!', 'gold', 1.3, cx, c.y - 8 * this.k); this.sealSay('spin', 'love', 0.9); this.sealNext = { anim: 'wiggle', mood: 'love', at: this.t + 0.9, secs: 1 }; this.shakeBy(3); this.beat = { kind: 'cheer', t: 0, dur: 1.4 }; }
    else if (c.rarity === 'epic') { this.pop('EPIC!', 'coral', 1.1, cx, c.y - 8 * this.k); this.sealSay('spin', 'excited', 0.85); this.beat = { kind: 'cheer', t: 0, dur: 1 }; }
    else if (c.rarity === 'rare') this.sealSay('clap', 'excited', 0.7);
    else if (c.id === 'coins') this.sealSay('wiggle', 'happy', 0.5);
  }

  drawLootIcon(ctx, c, x, by, s = 1) {
    if (c.id === 'coins') { drawAeroCoin(ctx, x, by - 14 * this.k, 9 * s * this.k, this.t); return; }
    drawItem(ctx, c.id, x, by, { box: [Math.round(40 * s * this.k), Math.round(40 * s * this.k)], t: this.t });
  }

  drawCardBack(ctx, c, pop = 1, sx = 1) {
    const w = Math.max(1, Math.round(c.w * pop * sx)), h = Math.round(c.h * pop);
    if (w < 2 || h < 2) return;
    const x = Math.round(c.x + (c.w - w) / 2), y = Math.round(c.y + (c.h - h) / 2);
    ctx.drawImage(aeroCached(`cardback|${this.tier}|${w}|${h}`, () => cardBack(w, h, CHIPS[this.tier][0])), x, y);
  }

  drawCard(ctx, ui, c, sx = 1) {
    const k = this.k;
    const col = RARITY[c.rarity]?.color || '#c9d4dc';
    const pop = c.state === 'shown' && c.t < 0.3 ? 1 + Math.sin((c.t / 0.3) * Math.PI) * 0.12 : 1;
    const w = Math.max(2, Math.round(c.w * pop * sx)), h = Math.round(c.h * pop);
    const x = Math.round(c.x + (c.w - w) / 2), y = Math.round(c.y + (c.h - h) / 2);
    ctx.drawImage(aeroCached(`lootcard|${w}|${h}|${col}`, () => aeroSurface(w, h, { tone: 'frost', r: 8, gloss: 0.6, glossH: Math.round(14 * k), rim: 0.9, glow: 0.5, glowColor: col })), x, y);
    if (sx < 0.6) return;
    ctx.fillStyle = col; ctx.fillRect(x + 4, y + h - Math.round(22 * k), w - 8, Math.round(18 * k));
    ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.fillRect(x + 4, y + h - Math.round(22 * k), w - 8, 2);
    // rarity pips
    const ri = ['common', 'uncommon', 'rare', 'epic', 'legendary'].indexOf(c.rarity) + 1;
    for (let i = 0; i < ri; i++) ctx.drawImage(partSprite('star', i < ri ? mix(col, '#ffffff', 0.3) : '#8090a0', 1), Math.round(x + w / 2 - ri * 4 + i * 8 - 2), y + 5);
    const bob = Math.round(Math.sin(this.t * 3 + c.x) * 1.5);
    this.drawLootIcon(ctx, c, x + w / 2, y + h - Math.round(28 * k) + bob, 1);
    const name = c.id === 'coins' ? `${fmtAero(c.qty)} Aero` : `${c.qty > 1 ? c.qty + 'x ' : ''}${ITEMS[c.id]?.name || c.id}`;
    let label = name;
    while (measureText(label, 'small') > w - 8 && label.length > 4) label = label.slice(0, -2);
    if (label !== name) label += '.';
    drawText(ctx, label, x + w / 2, y + h - Math.round(17 * k), { font: 'small', align: 'center', color: '#ffffff', shadow: shade(col, -0.6) });
    if ((c.rarity === 'legendary' || c.rarity === 'epic') && ((this.t * 3) | 0) % 2) ctx.drawImage(partSprite('sparkle', '#ffffff', 1), x + w - 12, y + 4);
    if (ui.hover({ x, y, w, h }) && c.id !== 'coins') ui.tip = `${ITEMS[c.id]?.name || c.id} (${RARITY[c.rarity]?.name || ''})`;
  }

  collect(next) {
    const g = this.game, S = this.S;
    const r = g.hud?.iconRect?.('inventory');
    const x1 = r ? r.x + r.w / 2 : S.W - 60, y1 = r ? r.y + r.h / 2 : S.H - 30;
    this.nextAfter = next;
    this.flyers = this.cards.map((c, i) => ({ c, x0: c.x + c.w / 2, y0: c.y + c.h / 2, x1, y1, t: -i * 0.06, dur: 0.5 }));
    this.cards = [];
    this.sfx('ui_buy', { vol: 0.6 });
  }
  afterCollect() {
    const ui = this.game.ui;
    if (this.nextAfter && (inventory(this.game.state).packages || []).length) this.open({});
    else { this.nextAfter = false; ui.close(this.id); }
  }
}

// ==================================================================== small art (cached)
let SCR = null;
function scratch() { if (!SCR) SCR = makeCanvas(2, 2).getContext('2d'); return SCR; }

const CUBES = new Map();
function cubeSprite(col, s) {
  const key = col + s;
  let c = CUBES.get(key);
  if (c) return c;
  c = hiArt(s + 1, s + 1, (g, W, H) => {
    g.fillStyle = shade(col, -0.62); g.fillRect(0, 0, W, H);
    g.fillStyle = col; g.fillRect(1, 1, W - 2, H - 2);
    g.fillStyle = mix(col, '#ffffff', 0.4); g.fillRect(1, 1, W - 2, Math.max(1, Math.floor((H - 2) / 3)));
    g.fillStyle = shade(col, -0.28); g.fillRect(W - 1 - Math.max(1, Math.floor((W - 2) / 3)), 1 + Math.max(1, Math.floor((H - 2) / 3)), Math.max(1, Math.floor((W - 2) / 3)), H - 2 - Math.max(1, Math.floor((H - 2) / 3)));
  });
  CUBES.set(key, c);
  if (CUBES.size > 400) CUBES.delete(CUBES.keys().next().value);
  return c;
}
function nailSprite(col, r) {
  const key = 'nail' + col + r;
  let c = CUBES.get(key);
  if (c) return c;
  const horiz = r % 2 === 1;
  c = hiArt(horiz ? 8 : 4, horiz ? 4 : 8, (g, W, H) => {
    g.fillStyle = '#2a3040';
    if (horiz) { g.fillRect(0, 2, W, 4); g.fillRect(r === 1 ? 0 : W - 4, 0, 4, H); g.fillStyle = '#dfe8f2'; g.fillRect(1, 3, W - 2, 2); g.fillRect(r === 1 ? 1 : W - 3, 1, 2, H - 2); g.fillStyle = '#ffffff'; g.fillRect(r === 1 ? 1 : W - 3, 1, 1, 2); }
    else { g.fillRect(2, 0, 4, H); g.fillRect(0, r === 0 ? 0 : H - 4, W, 4); g.fillStyle = '#dfe8f2'; g.fillRect(3, 1, 2, H - 2); g.fillRect(1, r === 0 ? 1 : H - 3, W - 2, 2); g.fillStyle = '#ffffff'; g.fillRect(1, r === 0 ? 1 : H - 3, 2, 1); }
  });
  CUBES.set(key, c);
  return c;
}
function boltSprite(col) {
  const key = 'bolt' + col;
  let c = CUBES.get(key);
  if (c) return c;
  c = hiArt(5, 5, (g, W, H) => {
    g.fillStyle = '#3a2408'; g.fillRect(1, 0, W - 2, H); g.fillRect(0, 1, W, H - 2);
    g.fillStyle = col; g.fillRect(2, 1, W - 4, H - 2); g.fillRect(1, 2, W - 2, H - 4);
    g.fillStyle = '#fff6d0'; g.fillRect(2, 2, 3, 2);
    g.fillStyle = shade(col, -0.4); g.fillRect(W / 2 - 1, H / 2 - 1, 2, 2);
  });
  CUBES.set(key, c);
  return c;
}

// the back of a loot card: chest-coloured with a stitched border and a question mark
function cardBack(w, h, col) {
  return hiArt(w, h, (g, W, H) => {
    g.fillStyle = shade(col, -0.6); g.fillRect(2, 0, W - 4, H); g.fillRect(0, 2, W, H - 4);
    g.fillStyle = col; g.fillRect(4, 2, W - 8, H - 4); g.fillRect(2, 4, W - 4, H - 8);
    for (let y = 4; y < H - 4; y += 8) for (let x = 4 + ((y / 8) % 2) * 4; x < W - 4; x += 8) { g.fillStyle = mix(col, '#ffffff', 0.18); g.fillRect(x, y, 4, 4); }
    g.fillStyle = mix(col, '#ffffff', 0.55);
    for (let x = 8; x < W - 8; x += 6) { g.fillRect(x, 6, 3, 2); g.fillRect(x, H - 8, 3, 2); }
    for (let y = 8; y < H - 8; y += 6) { g.fillRect(6, y, 2, 3); g.fillRect(W - 8, y, 2, 3); }
    const s = Math.max(2, Math.round(W / 22));
    const Q = ['.###.', '#...#', '...#.', '..#..', '.....', '..#..'];
    const qx = Math.round(W / 2 - 2.5 * s), qy = Math.round(H / 2 - 3 * s);
    Q.forEach((row, j) => { for (let i = 0; i < 5; i++) if (row[i] === '#') { g.fillStyle = shade(col, -0.55); g.fillRect(qx + i * s + s / 2, qy + j * s + s / 2, s, s); g.fillStyle = '#ffffff'; g.fillRect(qx + i * s, qy + j * s, s, s); } });
    g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(4, 2, W - 8, 3);
  });
}

// the wooden dock the scene stands on: top boards, a front beam with post caps, posts into the water
function dockArt(w, k) {
  const top = Math.round(30 * k), face = Math.round(10 * k), posts = Math.round(26 * k), h = top + face + posts;
  return hiArt(w, h, (g, W, H) => {
    const S = W / w;
    const T = Math.round(top * S), F = Math.round(face * S);
    const boards = ['#c8925a', '#bd8650', '#d29c62', '#b88250'];
    const rows = 4, bh = T / rows;
    for (let r = 0; r < rows; r++) {
      const y0 = Math.round(r * bh), y1 = Math.round((r + 1) * bh);
      let x = -((r * 37) % 60) * S;
      while (x < W) {
        const len = Math.round((70 + ((x * 7 + r * 13) % 50)) * S);
        const c = boards[Math.abs(Math.round(x + r * 3)) % 4];
        g.fillStyle = c; g.fillRect(Math.round(x), y0, len, y1 - y0);
        g.fillStyle = mix(c, '#ffe8c0', 0.35); g.fillRect(Math.round(x), y0, len, Math.max(1, Math.round(S)));
        g.fillStyle = shade(c, -0.18);
        for (let i = 0; i < 4; i++) g.fillRect(Math.round(x + (8 + i * 17) * S), Math.round(y0 + (2 + (i % 2) * 3) * S), Math.round(6 * S), Math.max(1, Math.round(S * 0.5)));
        g.fillStyle = '#5a3820'; g.fillRect(Math.round(x + len - S), y0, Math.max(1, Math.round(S)), y1 - y0);
        g.fillStyle = '#e6eef6'; g.fillRect(Math.round(x + 3 * S), Math.round(y0 + bh / 2 - S / 2), Math.round(S), Math.round(S));
        x += len;
      }
      g.fillStyle = '#5a3820'; g.fillRect(0, y1 - Math.max(1, Math.round(S)), W, Math.max(1, Math.round(S)));
    }
    // fade the far edge into the dusk, darken the near edge a touch
    for (let i = 0; i < 4; i++) { g.fillStyle = `rgba(20,30,60,${0.22 - i * 0.05})`; g.fillRect(0, Math.round(i * S * 2), W, Math.round(S * 2)); }
    // front beam
    g.fillStyle = '#7a4a26'; g.fillRect(0, T, W, F);
    g.fillStyle = '#a06a3a'; g.fillRect(0, T, W, Math.round(2 * S));
    g.fillStyle = '#4a2a14'; g.fillRect(0, T + F - Math.round(2 * S), W, Math.round(2 * S));
    // posts into the water
    const pw = Math.round(14 * S);
    for (let x = Math.round(18 * S); x < W - pw; x += Math.round(84 * S)) {
      g.fillStyle = '#5a3820'; g.fillRect(x - Math.round(S), T - Math.round(2 * S), pw + Math.round(2 * S), F + Math.round(2 * S));
      g.fillStyle = '#8a5a30'; g.fillRect(x, T - Math.round(S), pw, F);
      g.fillStyle = '#c8925a'; g.fillRect(x, T - Math.round(S), pw, Math.round(2 * S));
      for (let y = T + F; y < H; y++) {
        const q = (y - T - F) / (H - T - F);
        g.fillStyle = q < 0.3 ? '#6a4224' : `rgba(58,40,40,${0.9 - q * 0.8})`;
        g.fillRect(x + Math.round(S), y, pw - Math.round(2 * S), 1);
      }
      g.fillStyle = 'rgba(255,255,255,0.7)'; g.fillRect(x - Math.round(2 * S), Math.round(T + F + 6 * S), pw + Math.round(4 * S), Math.round(S));
      g.fillStyle = '#6aa84a'; g.fillRect(x + Math.round(2 * S), Math.round(T + F + 2 * S), Math.round(3 * S), Math.round(3 * S));
    }
    // rope along the beam
    g.fillStyle = '#e0c890';
    for (let x = 0; x < W; x += Math.round(4 * S)) { const yy = Math.round(T + F * 0.5 + Math.sin(x / (W / 6) * Math.PI) * 2 * S); g.fillRect(x, yy, Math.round(3 * S), Math.round(2 * S)); }
  });
}

// a tiny pixel glyph for the hint plaque: mouse, drag arrows or a cross
function drawHintIcon(ctx, icon, x, y, t, k) {
  const s = Math.max(1, Math.round(k));
  if (icon === 'mouse') {
    const press = ((t * 3) | 0) % 2;
    ctx.fillStyle = '#0a1e3a'; ctx.fillRect(x - 4 * s, y - 6 * s, 8 * s, 12 * s);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(x - 3 * s, y - 5 * s, 6 * s, 10 * s);
    ctx.fillStyle = press ? '#ffd23a' : '#cfe4f4'; ctx.fillRect(x - 3 * s, y - 5 * s, 3 * s, 4 * s);
    ctx.fillStyle = '#0a1e3a'; ctx.fillRect(x, y - 5 * s, s, 4 * s);
  } else if (icon === 'drag') {
    const o = Math.round(Math.sin(t * 5) * 2);
    ctx.fillStyle = '#ffffff';
    for (let i = 0; i < 4; i++) { ctx.fillRect(x - 6 * s + i * s + o, y - (3 - i) * s, s, (3 - i) * 2 * s + s); ctx.fillRect(x + 6 * s - i * s + o, y - (3 - i) * s, s, (3 - i) * 2 * s + s); }
    ctx.fillRect(x - 3 * s + o, y, 6 * s, s);
  } else {
    ctx.fillStyle = '#ff5a4a';
    for (let i = -3; i <= 3; i++) { ctx.fillRect(x + i * s, y + i * s, 2 * s, 2 * s); ctx.fillRect(x + i * s, y - i * s, 2 * s, 2 * s); }
  }
  void rgba;
}
