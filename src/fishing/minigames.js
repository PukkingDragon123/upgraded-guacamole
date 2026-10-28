// Fight minigames. Each phase object: update(dt, inp) -> 'ok' | 'win' | 'snap' | 'throw' | 'escape' | 'recover'
// and draw(ctx) for world-space visuals; drawHud(ctx) for prompts.

import { TAU, clamp, clamp01, lerp, dist, damp, pointInPoly, segmentHitsRect } from '../core/math.js';
import { rng } from '../core/rng.js';
import { rgba } from '../core/color.js';
import { drawText } from '../gfx/font.js';

const PROMPT_Y = 26;

// Shared fish fight movement inside the water.
export function fightMove(F, dt, tx, ty, speed, acc = 6) {
  const f = F.fish;
  const dx = tx - f.x, dy = ty - f.y;
  const d = Math.hypot(dx, dy) || 1;
  f.vx = damp(f.vx, (dx / d) * speed, acc, dt);
  f.vy = damp(f.vy, (dy / d) * speed, acc, dt);
  f.x += f.vx * dt;
  f.y += f.vy * dt;
  F.confine();
}

function prompt(ctx, F, text, color = '#ffffff') {
  const c = F.cursor;
  drawText(ctx, text, Math.round(c.x), Math.round(c.y + PROMPT_Y), { align: 'center', color, outline: '#0b1622', font: 'normal' });
}

// ---------------------------------------------------------------- tension
export class TensionPhase {
  constructor(F, opts = {}) {
    this.F = F;
    this.name = 'tension';
    const f = F.fish;
    this.stamina = opts.stamina ?? 1;
    this.lineLen = Math.max(40, dist(F.cursor.x, F.cursor.y, f.x, f.y));
    this.mode = 'pull';
    this.modeT = rng.float(0.8, 1.6);
    this.dir = Math.atan2(f.y - F.cursor.y, f.x - F.cursor.x);
    this.trick = null;
    this.snapT = 0; this.slackT = 0;
    this.snag = null;
    this.hint = 0;
  }

  pickMode() {
    const F = this.F, sp = F.sp, power = F.power;
    const tricks = sp.fight?.tricks || [];
    if (this.mode === 'pull') {
      this.mode = 'rest';
      this.modeT = rng.float(0.7, 1.5) * (1.2 - power * 0.5);
    } else {
      this.mode = 'pull';
      this.modeT = rng.float(1, 2.4) * (0.7 + power * 0.6);
      const away = Math.atan2(F.fish.y - F.cursor.y, F.fish.x - F.cursor.x);
      this.dir = away + rng.float(-1.1, 1.1);
      if (tricks.length && rng.chance(0.35 + power * 0.3)) this.startTrick(rng.pick(tricks));
    }
  }

  startTrick(kind) {
    const F = this.F, f = F.fish;
    const w = F.world;
    switch (kind) {
      case 'dash': case 'fake': {
        const d0 = this.dir;
        this.trick = { kind, t: 0, tele: 0.35, dur: 0.5, dir: kind === 'fake' ? d0 + Math.PI + rng.float(-0.5, 0.5) : d0, teleDir: d0 };
        f.say(kind === 'fake' ? '!' : '!!', 0.6);
        f.squashV -= 8;
        break;
      }
      case 'dive':
        this.trick = { kind, t: 0, tele: 0.25, dur: 0.8, dir: Math.PI / 2 + rng.float(-0.3, 0.3) };
        f.say('arrow_d', 0.6);
        break;
      case 'jump':
        if (w.surfaceY !== null && f.y - w.surfaceY < 140) this.trick = { kind, t: 0, phase: 'rise', dur: 2 };
        break;
      case 'wrap': {
        const icons = w.icons || [];
        let best = null, bd = 180;
        for (const r of icons) { const d = dist(r.x + r.w / 2, r.y + r.h / 2, f.x, f.y); if (d < bd) { bd = d; best = r; } }
        if (best) this.trick = { kind, t: 0, icon: best, dur: 2.6, ang: Math.atan2(f.y - best.y - best.h / 2, f.x - best.x - best.w / 2) };
        break;
      }
      case 'hop': {
        const wins = w.windows || [];
        if (wins.length >= 1) this.trick = { kind, t: 0, dur: 2.2, from: rng.pick(wins), to: rng.pick(wins) };
        break;
      }
      case 'glitch':
        this.trick = { kind, t: 0, dur: 0.6 };
        break;
      default: break;
    }
  }

  update(dt, inp) {
    const F = this.F, f = F.fish, c = F.cursor, power = F.power, st = F.stats;
    this.hint += dt;
    this.modeT -= dt;
    if (this.modeT <= 0 && !this.trick) this.pickMode();
    const holding = inp.down;
    // desired fish motion
    let speed = this.mode === 'pull' ? (45 + power * 95) : 14;
    let dir = this.dir;
    let spike = 0;
    const tr = this.trick;
    if (tr) {
      tr.t += dt;
      if (tr.kind === 'dash' || tr.kind === 'fake' || tr.kind === 'dive') {
        if (tr.t < tr.tele) { dir = tr.teleDir ?? tr.dir; speed = 20; f.wiggle = 0.5; }
        else { dir = tr.dir; speed = (120 + power * 160); spike = 0.45; }
        if (tr.t > tr.tele + tr.dur) this.trick = null;
      } else if (tr.kind === 'jump') {
        this.updateJump(dt, tr);
        if (tr.done) this.trick = null;
        return this.common(dt, inp, holding, 0, true);
      } else if (tr.kind === 'wrap') {
        tr.ang += dt * 2.6;
        const r = tr.icon;
        const cx = r.x + r.w / 2, cy = r.y + r.h / 2, rad = Math.max(r.w, r.h) * 0.9;
        fightMove(F, dt, cx + Math.cos(tr.ang) * rad, cy + Math.sin(tr.ang) * rad, 140, 8);
        if (tr.t > tr.dur) this.trick = null;
        return this.common(dt, inp, holding, 0.1, false);
      } else if (tr.kind === 'hop') {
        this.updateHop(dt, tr);
        if (tr.done) this.trick = null;
        return this.common(dt, inp, holding, 0.05, false);
      } else if (tr.kind === 'glitch') {
        if (tr.t > 0.25 && !tr.jumped) {
          tr.jumped = true;
          F.world.particles?.burst(f.x, f.y, 14, { colors: ['#ff3a7a', '#3affd8', '#ffffff'], speed: 60, g: 0, life: 0.4, size: 2 });
          f.x += rng.float(-60, 60); f.y += rng.float(-40, 40);
          F.confine();
          F.world.audio?.play('glitch');
          spike = 0.3;
        }
        if (tr.t > tr.dur) this.trick = null;
      }
    }
    const tx = f.x + Math.cos(dir) * 60, ty = f.y + Math.sin(dir) * 60;
    fightMove(F, dt, tx, ty, speed, 5);
    return this.common(dt, inp, holding, spike, false);
  }

  common(dt, inp, holding, spike, airborne) {
    const F = this.F, f = F.fish, c = F.cursor, st = F.stats, power = F.power;
    // reel / line length
    const d = dist(c.x, c.y, f.x, f.y);
    let snagMul = 1;
    this.snag = null;
    if (!airborne) {
      for (const r of F.world.icons || []) {
        if (segmentHitsRect(c.x, c.y, f.x, f.y, { x: r.x + 3, y: r.y + 3, w: r.w - 6, h: r.h - 6 })) { this.snag = r; break; }
      }
    }
    if (this.snag) { snagMul = 0.25; spike += 0.2; this.snag.shake = 0.3; }
    if (holding && !airborne) this.lineLen = Math.max(14, this.lineLen - st.reelSpeed * snagMul * dt * (this.tension > 0.95 ? 0.2 : 1));
    // rope constraint
    let pullAway = 0;
    if (d > this.lineLen) {
      const over = d - this.lineLen;
      const nx = (f.x - c.x) / d, ny = (f.y - c.y) / d;
      if (holding) {
        f.x -= nx * over * 0.85; f.y -= ny * over * 0.85;
        pullAway = clamp01(over / 6);
      } else {
        this.lineLen = d;
        pullAway = 0.25;
      }
    }
    // cursor moving against the fish = counter pressure
    const fvx = f.vx, fvy = f.vy;
    const fs = Math.hypot(fvx, fvy) || 1;
    const cs = c.speed;
    const against = cs > 20 ? clamp(-(c.vx * fvx + c.vy * fvy) / (fs * cs), -1, 1) : 0;
    const counter = Math.max(0, against) * clamp01(cs / 220);
    const struggle = this.mode === 'pull' ? 1 : 0.3;
    let target = holding ? 0.32 + struggle * 0.33 * (0.6 + power * 0.6) + pullAway * 0.3 : 0.06 + struggle * 0.18 + pullAway * 0.2;
    target += spike + counter * 0.12;
    if (airborne) target = 0.02;
    target /= st.lineStrength;
    this.tension = this.tension === undefined ? 0.3 : this.tension;
    const rate = target > this.tension ? 3.2 : 4.5;
    this.tension = clamp(damp(this.tension, target, rate, dt), 0, 1.2);
    const T = this.tension;
    F.tension = T;
    // stamina
    if (holding && T > 0.22 && T < 0.92 && !airborne) {
      const stam = (F.sp.fight?.stamina ?? 5) * (0.8 + power * 0.4);
      this.stamina -= (dt / stam) * (1 + counter * 1.6) * st.staminaDrain * (this.snag ? 0.4 : 1);
    }
    // snap / slack
    if (T >= 1) this.snapT += dt; else this.snapT = Math.max(0, this.snapT - dt * 2);
    if (this.snapT > st.snapGrace) return 'snap';
    if (T < 0.1 && this.mode === 'pull' && !airborne) this.slackT += dt; else this.slackT = Math.max(0, this.slackT - dt);
    if (this.slackT > st.slackGrace) return 'throw';
    if (this.slackT > st.slackGrace * 0.5 && !this.warnedSlack) { this.warnedSlack = true; F.world.audio?.play('slack_warn'); }
    if (this.slackT === 0) this.warnedSlack = false;
    f.feel(T > 0.8 ? 'angry' : this.mode === 'pull' ? 'determined' : 'tired', 0.3);
    if (this.stamina <= 0) return 'win';
    return 'ok';
  }

  updateJump(dt, tr) {
    const F = this.F, f = F.fish, w = F.world;
    const sy = w.surfaceY;
    if (tr.phase === 'rise') {
      fightMove(F, dt, f.x + f.facing * 30, sy - 10, 180, 10, true);
      if (f.y < sy + 4) {
        tr.phase = 'air';
        tr.vy = -rng.float(140, 200);
        tr.vx = f.facing * rng.float(30, 70);
        F.world.particles?.splash(f.x, sy, 0.8);
        F.world.audio?.play('jump_out');
        f.feel('happy', 1);
      }
    } else if (tr.phase === 'air') {
      tr.vy += 380 * dt;
      f.x += tr.vx * dt; f.y += tr.vy * dt;
      f.forceAngle = clamp(Math.atan2(tr.vy, Math.abs(tr.vx)), -1.2, 1.2);
      if (f.y > sy && tr.vy > 0) {
        tr.phase = 'down';
        F.world.particles?.splash(f.x, sy, 1);
        F.world.audio?.play('splash_small');
        f.forceAngle = undefined;
        if (F.input.down) this.tension = Math.min(1.15, (this.tension || 0) + 0.55);
      }
    } else {
      tr.t2 = (tr.t2 || 0) + dt;
      if (tr.t2 > 0.3) tr.done = true;
    }
  }

  updateHop(dt, tr) {
    const F = this.F, f = F.fish;
    const a = tr.from, b = tr.to;
    if (!tr.stage) tr.stage = 'in';
    if (tr.stage === 'in') {
      fightMove(F, dt, a.x + a.w / 2, a.y + a.h / 2, 160, 8);
      if (rectHas(a, f.x, f.y) && tr.t > 0.3) { tr.stage = 'under'; tr.ut = 0.6; }
      if (tr.t > 1.4) tr.done = true;
    } else if (tr.stage === 'under') {
      tr.ut -= dt;
      if (tr.ut <= 0) {
        f.x = b.x + rng.float(10, b.w - 10); f.y = b.y + rng.float(10, b.h - 10);
        tr.stage = 'out';
        tr.ot = 0.6;
        tr.exitDir = rng.float(0, TAU);
      }
    } else {
      tr.ot -= dt;
      fightMove(F, dt, f.x + Math.cos(tr.exitDir) * 80, f.y + Math.sin(tr.exitDir) * 80, 150, 8);
      if (tr.ot <= 0) tr.done = true;
    }
  }

  draw(ctx) {
    if (this.snag) {
      const r = this.snag;
      const t = performance.now() / 1000;
      ctx.fillStyle = rgba('#ff5a5a', 0.5 + 0.3 * Math.sin(t * 12));
      ctx.fillRect(r.x - 1, r.y - 1, r.w + 2, 1); ctx.fillRect(r.x - 1, r.y + r.h, r.w + 2, 1);
      ctx.fillRect(r.x - 1, r.y, 1, r.h); ctx.fillRect(r.x + r.w, r.y, 1, r.h);
    }
  }

  drawHud(ctx) {
    const F = this.F;
    F.drawStamina(ctx, this.stamina);
    F.drawTensionGauge(ctx, F.tension ?? 0);
    if (this.snag) prompt(ctx, F, 'SNAGGED! Go around the icon', '#ff9a8a');
    else if (this.trick?.kind === 'jump') prompt(ctx, F, 'It jumped! Let go before it lands!', '#ffe27a');
    else if ((F.tension ?? 0) > 0.85) prompt(ctx, F, 'Too tight! Let go!', '#ff8a7a');
    else if (this.slackT > 0.4) prompt(ctx, F, 'Slack line! Hold to reel!', '#9ad8ff');
    else if (this.hint < 4 || F.tutorial) prompt(ctx, F, '{mouse_hold} Hold to reel - pull AGAINST its swim', '#ffffff');
  }
}

function rectHas(r, x, y) {
  return x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;
}

// ---------------------------------------------------------------- trace
const PATHS = {
  figure8: (t) => [Math.sin(t), Math.sin(t * 2) * 0.5],
  circle: (t) => [Math.cos(t), Math.sin(t) * 0.7],
  zigzag: (t) => [Math.sin(t * 0.5) * 1.1, (Math.abs(((t * 0.8) % 2) - 1) - 0.5) * 1.2],
  wave: (t) => [Math.sin(t * 0.45) * 1.2, Math.sin(t * 2.2) * 0.4],
  spiral: (t) => { const r = 0.4 + 0.6 * Math.abs(Math.sin(t * 0.25)); return [Math.cos(t) * r, Math.sin(t) * r * 0.8]; },
  clover: (t) => { const r = Math.cos(2 * t); return [Math.cos(t) * r, Math.sin(t) * r]; },
};

export class TracePhase {
  constructor(F) {
    this.F = F;
    this.name = 'trace';
    const f = F.fish;
    const w = F.world;
    this.kind = rng.pick(Object.keys(PATHS));
    this.cx = clamp(f.x, 120, w.W - 120);
    this.cy = clamp(f.y, (w.surfaceY ?? 0) + 70, w.floorAt(f.x) - 70);
    this.rx = rng.float(70, 120); this.ry = rng.float(45, 70);
    this.t = 0;
    this.speed = 0.9 + F.power * 0.9;
    this.progress = 0;
    this.outT = 0;
    this.radius = (24 - F.power * 7) * F.stats.traceRadius;
    this.inside = false;
    this.lead = 1.2;
  }

  pos(t) {
    const [u, v] = PATHS[this.kind](t);
    return [this.cx + u * this.rx, this.cy + v * this.ry];
  }

  update(dt, inp) {
    const F = this.F, f = F.fish, c = F.cursor;
    const ease = Math.min(1, this.t * 0.6 + 0.2);
    this.t += dt * this.speed * ease;
    const [tx, ty] = this.pos(this.t);
    fightMove(F, dt, tx, ty, 260, 12);
    this.inside = dist(c.x, c.y, f.x, f.y) < this.radius;
    if (this.inside) {
      this.progress += dt / (3.2 + F.power * 3);
      F.tension = 0.45;
      f.feel('tired', 0.2);
    } else {
      this.progress = Math.max(0, this.progress - dt * 0.12);
      this.outT += dt;
      F.tension = Math.min(1, 0.5 + this.outT * 0.15);
      f.feel('smug', 0.2);
    }
    if (this.outT > 3.6 * F.stats.traceForgive) return 'escape';
    if (this.progress >= 1) return 'win';
    return 'ok';
  }

  draw(ctx) {
    const F = this.F, f = F.fish;
    // dotted path preview
    for (let i = 1; i <= 26; i++) {
      const [x, y] = this.pos(this.t + i * 0.07 * this.speed);
      if (i % 2) continue;
      ctx.fillStyle = rgba('#e8fcff', 0.75 - i * 0.025);
      ctx.fillRect(Math.round(x), Math.round(y), 2, 2);
    }
    const r = Math.round(this.radius + Math.sin(performance.now() / 120) * 1.5);
    drawCircle(ctx, f.x, f.y, r, this.inside ? '#7dff9a' : '#ff7a7a', 0.9);
    drawCircle(ctx, f.x, f.y, r - 2, this.inside ? '#2a8a4a' : '#8a2a2a', 0.4);
  }

  drawHud(ctx) {
    const F = this.F;
    F.drawStamina(ctx, 1 - this.progress, '#7dff9a');
    prompt(ctx, F, this.inside ? 'Follow it!' : '{arrow_r} Keep your hook inside the ring!', this.inside ? '#b8ffc8' : '#ffd2c8');
  }
}

// ---------------------------------------------------------------- mash
export class MashPhase {
  constructor(F) {
    this.F = F;
    this.name = 'mash';
    this.progress = 0.08;
    this.time = 6.5 + (1 - F.power) * 2;
    this.t = 0;
    this.combo = 0;
    this.anchor = { x: F.fish.x, y: F.fish.y };
  }

  update(dt, inp) {
    const F = this.F, f = F.fish;
    this.t += dt;
    this.progress = Math.max(0, this.progress - dt * (0.1 + F.power * 0.12));
    if (inp.clicks > 0) {
      for (let i = 0; i < inp.clicks; i++) {
        this.progress += (0.075 * F.stats.mashPower) / (0.6 + F.power * 0.8);
        this.combo++;
        f.squashV += 6;
        f.x += (F.cursor.x - f.x) * 0.04;
        f.y += (F.cursor.y - f.y) * 0.04;
        F.world.audio?.play('mash_pop', { pitch: 0.8 + Math.min(1, this.combo * 0.04) });
        F.world.particles?.burst(f.x, f.y, 4, { colors: ['#ffffff', '#ffe27a'], speed: 50, g: 0, life: 0.3 });
      }
    }
    // fish jitters in place
    f.x = damp(f.x, this.anchor.x + Math.sin(this.t * 31) * 2, 8, dt);
    f.y = damp(f.y, this.anchor.y + Math.cos(this.t * 27) * 1.5, 8, dt);
    f.feel(this.progress > 0.6 ? 'scared' : 'angry', 0.2);
    F.tension = 0.5 + 0.3 * Math.sin(this.t * 20);
    if (this.progress >= 1) return 'win';
    if (this.t > this.time) return this.progress > 0.5 ? 'win' : 'escape';
    return 'ok';
  }

  draw() {}

  drawHud(ctx) {
    const F = this.F, f = F.fish;
    const w = 50, x = Math.round(f.x - w / 2), y = Math.round(f.y - 26 * f.scale - 10);
    ctx.fillStyle = '#0b1622'; ctx.fillRect(x - 1, y - 1, w + 2, 6);
    ctx.fillStyle = '#3a2a1a'; ctx.fillRect(x, y, w, 4);
    ctx.fillStyle = this.progress > 0.7 ? '#7dff9a' : '#ffd25a';
    ctx.fillRect(x, y, Math.round(w * clamp01(this.progress)), 4);
    const left = Math.max(0, this.time - this.t);
    drawText(ctx, 'MASH CLICK!', f.x, y - 12, { align: 'center', color: '#ffe27a', outline: '#0b1622', wave: 1, time: this.t });
    drawText(ctx, left.toFixed(1) + 's', f.x, y + 7, { align: 'center', font: 'small', color: '#ffffff', outline: '#0b1622' });
  }
}

// ---------------------------------------------------------------- timing
export class TimingPhase {
  constructor(F) {
    this.F = F;
    this.name = 'timing';
    this.need = 3 + Math.round(F.power * 3);
    this.hits = 0;
    this.misses = 0;
    this.allowed = F.stats.timingMisses;
    this.beat = (1.15 - F.power * 0.45);
    this.t = -0.4;
    this.target = 14;
    this.flash = null;
    this.home = { x: F.fish.x, y: F.fish.y };
  }

  ring() {
    const k = this.t / this.beat;
    return lerp(46, 0, k);
  }

  update(dt, inp) {
    const F = this.F, f = F.fish;
    this.t += dt;
    if (this.flash) { this.flash.t += dt; if (this.flash.t > 0.4) this.flash = null; }
    // fish thrash
    fightMove(F, dt, this.home.x + Math.sin(this.t * 3) * 20, this.home.y + Math.cos(this.t * 2.3) * 10, 90, 6);
    F.tension = 0.4;
    const r = this.ring();
    const win = 5 * F.stats.timingWindow;
    if (inp.pressed) {
      const err = Math.abs(r - this.target);
      if (this.t > 0 && err < win) {
        const perfect = err < win * 0.4;
        this.hits++;
        this.flash = { text: perfect ? 'PERFECT!' : 'GOOD!', color: perfect ? '#ffe27a' : '#9affb8', t: 0 };
        F.world.audio?.play(perfect ? 'timing_perfect' : 'timing_good');
        f.squashV += 10;
        f.feel('scared', 0.5);
        F.world.particles?.burst(f.x, f.y, perfect ? 12 : 7, { colors: ['#ffe27a', '#ffffff'], speed: 70, g: 0, life: 0.5 });
        this.t = -0.25;
      } else {
        this.miss();
      }
    } else if (r < this.target - win) {
      this.miss();
    }
    if (this.hits >= this.need) return 'win';
    if (this.misses > this.allowed) return 'escape';
    return 'ok';
  }

  miss() {
    this.misses++;
    this.flash = { text: 'MISS', color: '#ff8a7a', t: 0 };
    this.F.world.audio?.play('timing_miss');
    this.F.fish.feel('smug', 0.6);
    this.t = -0.35;
  }

  draw(ctx) {
    const f = this.F.fish;
    drawCircle(ctx, f.x, f.y, this.target, '#ffffff', 0.9);
    if (this.t > 0) drawCircle(ctx, f.x, f.y, Math.max(1, Math.round(this.ring())), '#ffe27a', 0.95);
  }

  drawHud(ctx) {
    const F = this.F, f = F.fish;
    const y = Math.round(f.y - 30 * f.scale - 14);
    for (let i = 0; i < this.need; i++) {
      ctx.fillStyle = i < this.hits ? '#ffe27a' : '#2a3a4a';
      ctx.fillRect(Math.round(f.x - this.need * 4 + i * 8), y, 6, 3);
    }
    if (this.flash) drawText(ctx, this.flash.text, f.x, y - 12 - this.flash.t * 10, { align: 'center', color: this.flash.color, outline: '#0b1622' });
    prompt(this.ctxFix || ctx, F, '{mouse_l} Click when the rings meet!', '#ffffff');
  }
}

// ---------------------------------------------------------------- dodge
export class DodgePhase {
  constructor(F) {
    this.F = F;
    this.name = 'dodge';
    this.dur = 6 + F.power * 3;
    this.t = 0;
    this.progress = 0;
    this.shots = [];
    this.fireT = 0.8;
    this.hits = 0;
    this.allowed = F.stats.dodgeHits;
    this.stun = 0;
    const kind = F.sp.fight?.projectile || (F.sp.biome === 'junkyard' ? 'bolt' : F.sp.biome === 'abyss' ? 'ink' : 'bubble');
    this.kind = kind;
    this.home = { x: F.fish.x, y: F.fish.y };
  }

  update(dt, inp) {
    const F = this.F, f = F.fish, c = F.cursor;
    this.t += dt;
    this.stun = Math.max(0, this.stun - dt);
    fightMove(F, dt, this.home.x + Math.sin(this.t * 1.3) * 40, this.home.y + Math.sin(this.t * 2.1) * 20, 80, 5);
    f.lookAt(c.x, c.y);
    f.feel('angry', 0.2);
    this.fireT -= dt;
    if (this.fireT <= 0) {
      this.fireT = rng.float(0.45, 1.0) * (1.2 - F.power * 0.5);
      const lead = 0.25;
      const tx = c.x + c.vx * lead, ty = c.y + c.vy * lead;
      const a = Math.atan2(ty - f.y, tx - f.x) + rng.float(-0.1, 0.1);
      const sp = 140 + F.power * 90;
      this.shots.push({ x: f.x, y: f.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, t: 0 });
      f.talkT = 0.2;
      F.world.audio?.play(this.kind === 'bolt' ? 'click' : 'blub', { pitch: 1.4 });
    }
    for (const s of this.shots) {
      s.t += dt;
      s.x += s.vx * dt; s.y += s.vy * dt;
      if (!s.dead && dist(s.x, s.y, c.x, c.y) < 6) {
        s.dead = true;
        this.hits++;
        this.stun = 0.6;
        F.world.audio?.play('dodge_hit');
        F.shake(3);
        F.world.particles?.burst(c.x, c.y, 10, { colors: ['#ffffff', '#ff8a7a'], speed: 60, g: 0, life: 0.4 });
      }
    }
    this.shots = this.shots.filter((s) => !s.dead && s.t < 3);
    if (inp.down && !this.stun) this.progress += dt / this.dur;
    F.tension = this.stun ? 0.95 : inp.down ? 0.55 : 0.2;
    if (this.hits > this.allowed) return 'snap';
    if (this.progress >= 1) return 'win';
    return 'ok';
  }

  draw(ctx) {
    for (const s of this.shots) {
      const x = Math.round(s.x), y = Math.round(s.y);
      if (this.kind === 'bolt') {
        ctx.fillStyle = '#9aa4b8'; ctx.fillRect(x - 2, y - 1, 5, 3);
        ctx.fillStyle = '#e8eef8'; ctx.fillRect(x - 1, y - 1, 2, 1);
        ctx.fillStyle = '#4a5468'; ctx.fillRect(x - 2, y + 1, 5, 1);
      } else if (this.kind === 'ink') {
        ctx.fillStyle = '#140a1e'; ctx.fillRect(x - 3, y - 2, 6, 5); ctx.fillRect(x - 2, y - 3, 4, 7);
        ctx.fillStyle = '#3a2a5a'; ctx.fillRect(x - 1, y - 2, 2, 1);
      } else if (this.kind === 'spark') {
        ctx.fillStyle = '#fff6a0'; ctx.fillRect(x - 1, y - 1, 3, 3);
        ctx.fillStyle = '#ffb02a'; ctx.fillRect(x - 2, y, 1, 1); ctx.fillRect(x + 2, y, 1, 1);
      } else {
        ctx.fillStyle = '#cfefff'; ctx.fillRect(x - 2, y - 3, 5, 7); ctx.fillRect(x - 3, y - 2, 7, 5);
        ctx.fillStyle = '#4aa8d8'; ctx.fillRect(x - 1, y - 1, 3, 3);
        ctx.fillStyle = '#ffffff'; ctx.fillRect(x - 2, y - 2, 1, 1);
      }
    }
  }

  drawHud(ctx) {
    const F = this.F;
    F.drawStamina(ctx, 1 - this.progress, '#9ad8ff');
    let hearts = '';
    for (let i = 0; i <= this.allowed; i++) hearts += i < this.allowed + 1 - this.hits ? '{heart}' : '{heart_empty}';
    drawText(ctx, hearts, F.cursor.x, F.cursor.y - 30, { align: 'center' });
    prompt(ctx, F, this.stun ? 'Ouch!' : '{mouse_hold} Hold to reel - DODGE the shots!', this.stun ? '#ff8a7a' : '#ffffff');
  }
}

// ---------------------------------------------------------------- unwrap (noodle)
export class UnwrapPhase {
  constructor(F) {
    this.F = F;
    this.name = 'unwrap';
    this.dir = rng.sign();
    this.need = TAU * (2 + F.power * 2);
    this.progress = 0;
    this.time = 10;
    this.t = 0;
    this.prevA = null;
    this.center = { x: F.cursor.x, y: F.cursor.y };
    this.coil = 0;
  }

  update(dt, inp) {
    const F = this.F, f = F.fish, c = F.cursor;
    this.t += dt;
    this.center.x = damp(this.center.x, c.x, 1.5, dt);
    this.center.y = damp(this.center.y, c.y, 1.5, dt);
    const a = Math.atan2(c.y - this.center.y, c.x - this.center.x);
    const r = dist(c.x, c.y, this.center.x, this.center.y);
    if (this.prevA !== null && r > 6) {
      let da = a - this.prevA;
      if (da > Math.PI) da -= TAU;
      if (da < -Math.PI) da += TAU;
      this.progress = clamp(this.progress + da * this.dir, 0, this.need);
    }
    this.prevA = a;
    // the noodle coils around the cursor
    this.coil += dt * 3 * -this.dir;
    const rad = 18 * (1 - this.progress / this.need) + 8;
    f.x = c.x + Math.cos(this.coil) * rad;
    f.y = c.y + Math.sin(this.coil) * rad * 0.8;
    f.vx = -Math.sin(this.coil) * 40 * -this.dir; f.vy = Math.cos(this.coil) * 40 * -this.dir;
    f.allowTurn = true;
    f.feel(this.progress > this.need * 0.6 ? 'dizzy' : 'smug', 0.2);
    F.tension = 0.5;
    if (this.progress >= this.need) return 'win';
    if (this.t > this.time) return 'escape';
    return 'ok';
  }

  draw(ctx) {
    const F = this.F, c = F.cursor;
    // circular arrow showing direction
    const t = performance.now() / 1000;
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * TAU + t * 3 * this.dir;
      ctx.fillStyle = rgba('#ffe27a', i / 10);
      ctx.fillRect(Math.round(c.x + Math.cos(a) * 30), Math.round(c.y + Math.sin(a) * 30), 2, 2);
    }
  }

  drawHud(ctx) {
    const F = this.F;
    F.drawStamina(ctx, 1 - this.progress / this.need, '#ffe27a');
    prompt(ctx, F, `It's wrapped around you! Circle ${this.dir > 0 ? 'clockwise' : 'counter-clockwise'}!`, '#ffe27a');
  }
}

// ---------------------------------------------------------------- net
export class NetPhase {
  constructor(F) {
    this.F = F;
    this.name = 'net';
    this.time = 9 * F.stats.netTime;
    this.t = 0;
    this.path = [];
    this.drawing = false;
    this.fail = null;
    this.home = { x: F.fish.x, y: F.fish.y };
    this.caught = false;
  }

  update(dt, inp) {
    const F = this.F, f = F.fish, c = F.cursor;
    this.t += dt;
    if (this.fail) { this.fail.t += dt; if (this.fail.t > 0.8) this.fail = null; }
    // exhausted drift
    this.home.y = damp(this.home.y, Math.min(this.home.y, F.world.floorAt(f.x) - 30), 1, dt);
    fightMove(F, dt, this.home.x + Math.sin(this.t * 0.8) * 12, this.home.y + Math.sin(this.t * 1.7) * 4, 25, 3);
    f.feel('dizzy', 0.2);
    F.tension = 0.2;
    if (inp.pressed) { this.drawing = true; this.path = [[c.x, c.y]]; }
    if (this.drawing) {
      const last = this.path[this.path.length - 1];
      if (dist(last[0], last[1], c.x, c.y) > 3) this.path.push([c.x, c.y]);
      const closed = this.path.length > 12 && dist(this.path[0][0], this.path[0][1], c.x, c.y) < 14 * F.stats.netTolerance;
      if (inp.released || closed) {
        this.drawing = false;
        if (this.check()) return 'win';
        this.path = [];
        this.fail = { t: 0 };
        F.world.audio?.play('timing_miss');
      }
    }
    if (this.t > this.time) return 'recover';
    return 'ok';
  }

  check() {
    const F = this.F, f = F.fish;
    if (this.path.length < 8) return false;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, len = 0;
    for (let i = 0; i < this.path.length; i++) {
      const [x, y] = this.path[i];
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      if (i) len += dist(x, y, this.path[i - 1][0], this.path[i - 1][1]);
    }
    const tol = F.stats.netTolerance;
    const size = Math.max(10, 16 * f.scale);
    if (maxX - minX < size * 0.8 / tol || maxY - minY < size * 0.5 / tol) return false;
    if (maxX - minX > 360) return false;
    // close the loop and test the fish centre (plus generous tolerance points)
    const poly = this.path;
    const pts = [[f.x, f.y], [f.x - 4 * tol, f.y], [f.x + 4 * tol, f.y]];
    const hits = pts.filter(([x, y]) => pointInPoly(x, y, poly)).length;
    return hits >= (tol > 1.2 ? 1 : 2);
  }

  draw(ctx) {
    const F = this.F, f = F.fish;
    const t = this.t;
    // target hint
    const r = Math.round(18 * f.scale + 6 + Math.sin(t * 5) * 2);
    for (let i = 0; i < 24; i++) {
      if (i % 2) continue;
      const a = (i / 24) * TAU + t;
      ctx.fillStyle = rgba('#ffffff', 0.6);
      ctx.fillRect(Math.round(f.x + Math.cos(a) * r), Math.round(f.y + Math.sin(a) * r * 0.75), 2, 2);
    }
    // drawn net rope
    for (let i = 1; i < this.path.length; i++) {
      const [x0, y0] = this.path[i - 1], [x1, y1] = this.path[i];
      const steps = Math.max(1, Math.ceil(dist(x0, y0, x1, y1)));
      for (let k = 0; k < steps; k++) {
        const x = Math.round(lerp(x0, x1, k / steps)), y = Math.round(lerp(y0, y1, k / steps));
        ctx.fillStyle = (x + y) % 4 < 2 ? '#e8d2a0' : '#9a7a4a';
        ctx.fillRect(x, y, 2, 2);
      }
    }
  }

  drawHud(ctx) {
    const F = this.F;
    const left = Math.max(0, this.time - this.t);
    if (this.fail) prompt(ctx, F, 'Missed! Circle the WHOLE fish!', '#ff8a7a');
    else prompt(ctx, F, `{net} Draw a circle around it! ${left.toFixed(1)}s`, '#ffe27a');
  }
}

export function drawCircle(ctx, cx, cy, r, color, a = 1) {
  ctx.fillStyle = rgba(color, a);
  const n = Math.max(12, Math.round(r * 4));
  let px = null, py = null;
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * TAU;
    const x = Math.round(cx + Math.cos(ang) * r), y = Math.round(cy + Math.sin(ang) * r);
    if (x === px && y === py) continue;
    ctx.fillRect(x, y, 1, 1);
    px = x; py = y;
  }
}

export const PHASES = {
  tension: TensionPhase,
  trace: TracePhase,
  mash: MashPhase,
  timing: TimingPhase,
  dodge: DodgePhase,
  unwrap: UnwrapPhase,
  net: NetPhase,
};
