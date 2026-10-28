// Fishing controller: hook & line, bait, nibbles, bites, hook-set, the multi-phase fight and the landing.

import { TAU, clamp, clamp01, lerp, dist, damp } from '../core/math.js';
import { rng } from '../core/rng.js';
import { rgba } from '../core/color.js';
import { drawText } from '../gfx/font.js';
import { HOOK, baitSprite } from './baitart.js';
import { PHASES, drawCircle } from './minigames.js';

export class Fishing {
  constructor(game) {
    this.game = game;
    this.world = game.world;
    this.state = 'idle';
    this.t = 0;
    this.hook = { x: -50, y: -50, angle: 0, av: 0, dip: 0, visible: false };
    this.rodX = 0;
    this.baitSwing = 0; this.baitSwingV = 0;
    this.fish = null;
    this.fight = null;
    this.tension = 0;
    this.msg = null;
    this.wasInWater = false;
    this.jig = 0;
    this.cursor = game.world.cursor;
    this.input = game.input;
    this.lineSnap = null; // recoil animation
    this.focus = 0;
  }

  get stats() { return this.game.stats; }
  get busy() { return this.state !== 'idle'; }
  get fighting() { return this.state === 'fight' || this.state === 'landing'; }

  // Called by fish AI when it wants to start nibbling.
  requestNibble(fish) {
    if (this.state !== 'idle' || !this.world.hook.active) return false;
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
    this.anchorX = this.hook.x;
    this.anchorY = this.hook.y;
    return true;
  }

  releaseFish(flee = true, emote = null) {
    const f = this.fish;
    if (f) {
      f.controlled = false;
      f.allowTurn = false;
      f.forceAngle = undefined;
      f.cooldown = rng.float(10, 20);
      if (flee) { f.startle(this.hook.x, this.hook.y); f.setState('leave'); f.cruise *= 1.8; }
      if (emote) f.say(emote, 1.5);
    }
    this.fish = null;
    this.fight = null;
    this.state = 'idle';
  }

  message(text, color = '#ffffff', time = 1.6, big = false) {
    this.msg = { text, color, t: 0, max: time, big };
  }

  shake(n) { this.game.camera.shake(n); }

  confine() {
    const f = this.fish, w = this.world;
    const top = (w.surfaceY ?? -1000) + 6;
    f.x = clamp(f.x, 12, w.W - 12);
    if (!(this.fight?.phase?.trick?.kind === 'jump')) f.y = clamp(f.y, top, w.floorAt(f.x) - 8);
  }

  // ------------------------------------------------------------------ update
  update(dt, worldInput) {
    this.t += dt;
    const g = this.game, w = this.world, inp = this.input, c = this.cursor, h = this.hook;
    if (this.msg) { this.msg.t += dt; if (this.msg.t > this.msg.max) this.msg = null; }
    if (this.lineSnap) { this.lineSnap.t += dt; if (this.lineSnap.t > 0.6) this.lineSnap = null; }
    this.jig = Math.max(0, this.jig - dt * 0.6);
    w.jig = this.jig;

    const canHook = worldInput && !g.paused && !g.fishingDisabled;
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
    }
    h.angle = clamp(h.angle + h.av * dt, -0.9, 0.9);
    h.dip = damp(h.dip, 0, 6, dt);
    this.rodX = damp(this.rodX, h.x, 2.2, dt);
    this.baitSwingV += (-(h.x - (this.prevHX ?? h.x)) * 1.5 - this.baitSwing * 30 - this.baitSwingV * 4) * dt;
    this.baitSwing = clamp(this.baitSwing + this.baitSwingV * dt * 10, -0.8, 0.8);
    this.prevHX = h.x;

    const inWater = h.visible && (w.surfaceY === null || h.y > w.surfaceY + 2);
    if (inWater && !this.wasInWater && h.visible && w.surfaceY !== null && this.state === 'idle') {
      g.audio.play('cast', { vol: 0.6 });
      g.particles.splash(h.x, w.surfaceY, 0.25);
      g.state.stats.casts++;
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
        if (canHook && inWater && inp.pressed && !g.ui.blocking) {
          // jig the lure
          h.dip = -5;
          h.av += rng.float(-3, 3);
          this.jig = Math.min(1.5, this.jig + 0.35);
          g.audio.play('bubble', { vol: 0.4, pitch: rng.float(1, 1.4) });
          g.particles.bubbles(h.x, h.y, 3);
        }
        break;
      case 'nibble': this.updateNibble(dt, canHook); break;
      case 'bite': this.updateBite(dt, canHook); break;
      case 'fight': this.updateFight(dt); break;
      case 'landing': this.updateLanding(dt); break;
      default: break;
    }
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
    let tx = h.x + side * (mouthOff + 6), ty = h.y + 1;
    if (this.nibblePhase > 0) {
      this.nibblePhase -= dt;
      tx = h.x + side * mouthOff;
      if (this.nibblePhase <= 0.08 && !this.nibbled) {
        this.nibbled = true;
        h.dip = 3 + rng.float(0, 2);
        h.av += rng.float(-2, 2);
        f.chompT = 0.15;
        g.audio.play('nibble', { pitch: rng.float(0.9, 1.2) });
        g.particles.bubbles(h.x, h.y, 2, { size: 1 });
      }
    }
    f.facing = -side;
    f.lookAt(h.x, h.y);
    f.vx = (tx - f.x) * 8; f.vy = (ty - f.y) * 8;
    f.x = damp(f.x, tx, 14, dt); f.y = damp(f.y, ty, 14, dt);
    f.feel('happy', 0.2);
    if (this.nibbleT <= 0) {
      if (this.nibblesLeft > 0) {
        this.nibblesLeft--;
        this.nibblePhase = 0.25;
        this.nibbled = false;
        this.nibbleT = rng.float(0.45, 1.1);
        if (this.fakeBite && this.nibblesLeft === 1) { h.dip = 8; f.say('!', 0.4); g.audio.play('nibble', { pitch: 0.7 }); this.fakeBite = false; }
      } else {
        this.state = 'bite';
        this.biteT = (f.sp.fight?.biteWindow ?? 0.6) * this.stats.biteWindow * (g.tutorialActive ? 2.5 : 1);
        this.biteMax = this.biteT;
        h.dip = 10;
        f.say('!', this.biteT + 0.2);
        f.feel('determined', 1);
        f.chompT = 0.3;
        g.audio.play('bite');
        g.particles.bubbles(h.x, h.y, 6);
        if (rng.chance(this.stats.autoHook)) { this.setHook(true); return; }
      }
    }
    if (inp.pressed && !g.ui.blocking && this.state === 'nibble') {
      this.message('Too early!', '#ffb0a0');
      g.audio.play('escape', { vol: 0.5 });
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
    if (inp.pressed && canHook && !g.ui.blocking) { this.setHook(false); return; }
    if (this.biteT <= 0) {
      const bait = g.currentBait();
      if (bait?.kind === 'special' && rng.chance(0.6)) {
        g.consumeBait(bait.type);
        this.message('It stole your bait!', '#ffd2a0');
      } else this.message('Missed the bite!', '#ffd2a0');
      g.audio.play('escape', { vol: 0.6 });
      this.releaseFish(true, 'music');
    }
  }

  setHook(auto) {
    const g = this.game, f = this.fish;
    g.audio.play('hookset');
    this.shake(3);
    g.particles.burst(f.x, f.y, 10, { colors: ['#ffffff', '#ffe27a'], speed: 80, g: 0, life: 0.4 });
    if (auto) this.message('Auto-hook!', '#9affb8', 1);
    f.feel('surprised', 0.8);
    f.squashV += 10;
    this.state = 'fight';
    const phases = (f.sp.fight?.phases || ['tension', 'net']).slice();
    if (g.tutorialActive) phases.splice(0, phases.length, 'tension');
    this.fight = { phases, pi: 0, phase: null, time: 0 };
    this.power = clamp01((f.sp.fight?.power ?? 0.4) * (g.tutorialActive ? 0.25 : 1) * (f.rec.giant ? 1.25 : 1));
    this.sp = f.sp;
    this.tension = 0.3;
    this.startPhase();
    g.onHooked?.(f);
  }

  startPhase(override) {
    const F = this.fight;
    const name = override || F.phases[F.pi];
    const Cls = PHASES[name] || PHASES.tension;
    F.phase = new Cls(this, name === 'tension' && override ? { stamina: 0.45 } : {});
    F.phaseName = name;
    F.flash = 0;
    if (F.pi > 0 || override) this.game.audio.play('notify', { pitch: 1.2 });
  }

  updateFight(dt) {
    const F = this.fight, g = this.game;
    F.time += dt;
    F.flash += dt;
    // focus (slow motion) with right mouse if unlocked
    const focusing = this.input.rdown && this.stats.focus > 0;
    this.focus = damp(this.focus, focusing ? 1 : 0, 8, dt);
    g.timeScaleTarget = focusing ? 0.45 : 1;
    const r = F.phase.update(dt, this.input);
    this.fish.controlled = true;
    if (r === 'ok') return;
    if (r === 'win') {
      F.pi++;
      if (F.pi >= F.phases.length) { this.beginLanding(); return; }
      g.particles.burst(this.fish.x, this.fish.y, 12, { colors: ['#9affb8', '#ffffff'], speed: 70, g: 0, life: 0.5 });
      this.startPhase();
    } else if (r === 'recover') {
      this.message('It recovered!', '#ffd2a0');
      F.phases.splice(F.pi, 0, 'tension');
      F.phase = new PHASES.tension(this, { stamina: 0.45 });
      F.phaseName = 'tension';
    } else {
      this.fail(r);
    }
  }

  fail(reason) {
    const g = this.game, f = this.fish;
    g.timeScaleTarget = 1;
    if (reason === 'snap') {
      this.message('SNAP!', '#ff7a6a', 1.8, true);
      g.audio.play('line_snap');
      this.shake(6);
      this.lineSnap = { t: 0, x: f.x, y: f.y };
      g.state.stats.snapped++;
      if (g.currentBait()?.kind === 'special') g.consumeBait(g.currentBait().type);
    } else {
      this.message(reason === 'throw' ? 'It threw the hook!' : 'It got away!', '#ffd2a0', 1.8, true);
      g.audio.play('escape');
    }
    g.state.stats.escaped++;
    f.feel('smug', 2);
    this.releaseFish(true, reason === 'snap' ? 'music' : 'cross');
    g.onFishEscaped?.(f, reason);
  }

  beginLanding() {
    const g = this.game, f = this.fish;
    this.state = 'landing';
    this.landT = 0;
    this.landFrom = { x: f.x, y: f.y };
    g.timeScaleTarget = 1;
    g.camera.punch(f.x, f.y, 0.14);
    g.camera.slowmo(0.3, 0.55);
    this.shake(5);
    g.audio.play('splash_big');
    g.particles.splash(f.x, f.y, 1.4);
    g.particles.burst(f.x, f.y, 26, { colors: ['#ffffff', '#ffe27a', '#9af0ff'], speed: 120, g: 30, life: 0.9, add: true });
    f.feel(rng.pick(['surprised', 'scared', 'dizzy']), 3);
    f.say('!', 1);
  }

  updateLanding(dt) {
    const g = this.game, f = this.fish, w = this.world;
    this.landT += dt;
    const k = clamp01(this.landT / 0.7);
    const topY = w.surfaceY !== null ? w.surfaceY - 30 : this.cursor.y - 40;
    const tx = this.cursor.x, ty = Math.min(this.cursor.y, topY);
    f.x = lerp(this.landFrom.x, tx, k);
    f.y = lerp(this.landFrom.y, ty, k) - Math.sin(k * Math.PI) * 40;
    f.forceAngle = -0.6 + Math.sin(this.landT * 20) * 0.3;
    f.squash = Math.sin(this.landT * 25) * 0.25;
    if (w.surfaceY !== null && !this.splashed && f.y < w.surfaceY) {
      this.splashed = true;
      g.particles.splash(f.x, w.surfaceY, 1.2);
    }
    if (this.landT > 0.8) {
      this.splashed = false;
      const fish = this.fish;
      fish.controlled = false;
      fish.forceAngle = undefined;
      this.fish = null;
      this.fight = null;
      this.state = 'idle';
      this.game.onFishCaught(fish);
    }
  }

  // ------------------------------------------------------------------ drawing
  drawWorld(ctx) {
    const g = this.game, w = this.world, h = this.hook, c = this.cursor;
    const fightLine = (this.state === 'fight' || this.state === 'landing') && this.fish;
    if (this.fight?.phase?.draw) this.fight.phase.draw(ctx);
    if (fightLine) {
      const f = this.fish;
      const m = f.anchors?.mouth || [f.x, f.y];
      this.drawRope(ctx, c.x, c.y, m[0], m[1], this.tension, true);
      // faint line up to the rod
      this.drawRope(ctx, this.rodX, -6, c.x, c.y, 0.9, false, 0.35);
    } else if (h.visible) {
      this.drawRope(ctx, this.rodX, -6, h.x, h.y - 5, 0.2, false);
      this.drawHookAndBait(ctx);
    }
    if (this.lineSnap) {
      const k = this.lineSnap.t / 0.6;
      ctx.fillStyle = rgba('#e8f4ff', 1 - k);
      for (let i = 0; i < 10; i++) {
        const a = i * 0.7 + k * 6;
        ctx.fillRect(Math.round(c.x + Math.cos(a) * k * 30 * (i / 10)), Math.round(c.y + Math.sin(a) * k * 20 * (i / 10) + k * k * 20), 1, 1);
      }
    }
  }

  drawRope(ctx, x0, y0, x1, y1, tension, fight, alpha = 0.85) {
    const w = this.world;
    const d = dist(x0, y0, x1, y1);
    const sag = (1 - clamp01(tension)) * Math.min(40, d * 0.18);
    const vib = fight && tension > 0.75 ? Math.sin(this.t * 60) * (tension - 0.75) * 6 : 0;
    const mx = (x0 + x1) / 2 + vib, my = (y0 + y1) / 2 + sag;
    const steps = Math.max(4, Math.ceil(d / 2));
    let col = '#e8f4ff';
    if (fight) col = tension > 0.92 ? '#ff6a5a' : tension > 0.75 ? '#ffd25a' : '#e8f4ff';
    let px = null, py = null;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = Math.round((1 - t) * (1 - t) * x0 + 2 * (1 - t) * t * mx + t * t * x1);
      const y = Math.round((1 - t) * (1 - t) * y0 + 2 * (1 - t) * t * my + t * t * y1);
      if (x === px && y === py) continue;
      const under = w.surfaceY === null || y > w.surfaceY;
      ctx.fillStyle = rgba(col, under ? alpha * 0.8 : alpha);
      ctx.fillRect(x, y, 1, 1);
      if (w.surfaceY !== null && py !== null && (py <= w.surfaceY) !== (y <= w.surfaceY)) {
        // little ripple where the line enters the water
        const r = 3 + Math.sin(this.t * 4) * 1;
        ctx.fillStyle = rgba('#ffffff', 0.6);
        ctx.fillRect(Math.round(x - r), w.surfaceY + 1, 2, 1);
        ctx.fillRect(Math.round(x + r - 1), w.surfaceY + 1, 2, 1);
      }
      px = x; py = y;
    }
  }

  drawHookAndBait(ctx) {
    const h = this.hook, g = this.game;
    const x = Math.round(h.x), y = Math.round(h.y);
    // hook sprite rotated by swing (draw rotated via transform; tiny so it stays crisp enough)
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
        if (rng.chance(0.15)) g.particles.sparkle(bx + rng.float(-5, 5), by + rng.float(-3, 6), bait.type === 'golden' ? '#fff3a8' : '#a8fff0');
      }
    }
  }

  drawHud(ctx) {
    const F = this.fight;
    if (this.state === 'fight' && F?.phase) {
      F.phase.drawHud(ctx);
      if (F.phases.length > 1) {
        const c = this.cursor;
        const n = F.phases.length;
        for (let i = 0; i < n; i++) {
          ctx.fillStyle = i < F.pi ? '#9affb8' : i === F.pi ? '#ffffff' : '#3a4a5a';
          ctx.fillRect(Math.round(c.x - n * 3 + i * 6), Math.round(c.y + 40), 4, 2);
        }
      }
    }
    if (this.state === 'bite' && this.fish) {
      const f = this.fish;
      const k = this.biteT / this.biteMax;
      drawText(this.ctx || ctx, 'CLICK!', f.x, f.y - 22 * f.scale - 14, { align: 'center', color: '#ffe27a', outline: '#3a1a0a', scale: 2, wave: 1, time: this.t });
      ctx.fillStyle = '#0b1622'; ctx.fillRect(Math.round(f.x - 16), Math.round(f.y - 22 * f.scale - 1), 32, 3);
      ctx.fillStyle = '#ffe27a'; ctx.fillRect(Math.round(f.x - 16), Math.round(f.y - 22 * f.scale - 1), Math.round(32 * k), 3);
    }
    if (this.msg) {
      const m = this.msg;
      const a = Math.min(1, (m.max - m.t) * 3);
      ctx.globalAlpha = a;
      const y = this.cursor.y - 40 - m.t * 12;
      drawText(ctx, m.text, this.cursor.x, y, { align: 'center', color: m.color, outline: '#14202c', scale: m.big ? 2 : 1 });
      ctx.globalAlpha = 1;
    }
  }

  drawStamina(ctx, v, color = '#ff8a5a') {
    const f = this.fish;
    if (!f) return;
    const w = 40, x = Math.round(f.x - w / 2), y = Math.round(f.y - 24 * f.scale - 8);
    ctx.fillStyle = '#0b1622'; ctx.fillRect(x - 1, y - 1, w + 2, 5);
    ctx.fillStyle = '#2a1a1a'; ctx.fillRect(x, y, w, 3);
    ctx.fillStyle = color; ctx.fillRect(x, y, Math.round(w * clamp01(v)), 3);
    ctx.fillStyle = rgba('#ffffff', 0.5); ctx.fillRect(x, y, Math.round(w * clamp01(v)), 1);
  }

  drawTensionGauge(ctx, T) {
    const c = this.cursor;
    const R = 17;
    const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
    const n = 54;
    for (let i = 0; i <= n; i++) {
      const k = i / n;
      const a = lerp(a0, a1, k);
      let col = k < 0.1 ? '#6ab8ff' : k < 0.75 ? '#7dff9a' : k < 0.9 ? '#ffd25a' : '#ff5a4a';
      const on = k <= T;
      ctx.fillStyle = on ? col : rgba('#0b1622', 0.55);
      const x = Math.round(c.x + Math.cos(a) * R), y = Math.round(c.y + Math.sin(a) * R);
      ctx.fillRect(x, y, 2, 2);
    }
    // needle
    const a = lerp(a0, a1, clamp01(T));
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(Math.round(c.x + Math.cos(a) * (R - 4)), Math.round(c.y + Math.sin(a) * (R - 4)), 2, 2);
    ctx.fillRect(Math.round(c.x + Math.cos(a) * (R + 3)), Math.round(c.y + Math.sin(a) * (R + 3)), 2, 2);
  }
}

export { drawCircle };
