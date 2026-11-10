// [phase9:fishing] Boss fights. Every ocean has a boss (src/fish/bosses.js), unlocked by the chapter's Boss quest
// (quests.js `cN_boss`). Drop the hook into the ocean's deepest zone: the water rumbles and the boss surges in (the
// abyss's Ancient Relic still summons The Algorithm too). It is the normal fish renderer at a huge scale, with an aura,
// an outline glow and drifting pixel embers.
//
// The fight is the normal one (circle to reel, ease off on pulls, hold + release to ZAP) plus:
//   intro    letterbox, the camera on the boss, a title card with its name, a roar
//   health   a boss bar at the top (health = 1 - progress); 3 phases (at 66% and 33%: roar + PHASE banner, faster)
//   attacks  CHARGE: it backs up and charges sideways; drag the mouse the OPPOSITE way (green arrow) to dodge.
//              A dodge leaves it dazed: the STUN WINDOW ("ZAP NOW!"); a zap in it is a critical hit.
//            INK: the lens gets inked; circling wipes it.  MINIONS: little fish bite at the line; click them.
//   victory  slow-mo, VICTORY title, rewards (Aero, a chest, a trophy, a rod recipe; smaller on rematches)
//
//   bossUnlocked(game, def), bossRecord(state) -> {won: {id: n}, trophies: {id: ts}}
//   new BossDirector(F)  update(dt), summon(id?), fish (the boss swimming in, or null), drawWorld(ctx), drawHud(ctx)
//   new BossFight(B, def) (built by Battle when fish.boss is set): update(dt) -> 'hold' | null, busy, blocksShock,
//     reelMul(), pullMul(), durMul(), paceMul(), extraTension(), canFinish(), inWindow(), onCrit(), hp, phase,
//     drawWorld(ctx), drawHud(ctx), hitMinion(sx, sy)
//   bossVictory(F, fish, def) -> overlay {update(rdt), draw(ctx)} (grants the rewards, emits 'bossDefeated')
//   drawBossAura(ctx, F, fish, def, k, t)

import { TAU, clamp, clamp01, lerp, damp, ease } from '../core/math.js';
import { rng } from '../core/rng.js';
import { rgba } from '../core/color.js';
import { drawText, measureText } from '../gfx/font.js';
import { glowSprite } from '../gfx/particles.js';
import { drawFishRig } from '../gfx/fishrig.js';
import { voxelFishIcon } from '../fish/fishicon.js';
import { SPECIES, SPECIES_BY_ID } from '../fish/species.js';
import { BOSS_BY_OCEAN, BOSS_BY_ID } from '../fish/bosses.js';
import { drawTitle, drawAeroBar, drawAeroSurface, drawAeroCoin } from '../ui/aero.js';
import { getUiIcon } from '../gfx/uiicons.js';
import { glossText, drawGlassPill, drawRays } from './cinematics.js';
import { drawBigArrow } from './hud.js';
import * as ITEMS from '../build/items.js';
import { grantUnlock } from '../game/lab.js';
import { giveRod } from '../game/rods.js';
import { labIcon } from '../ui/labicons.js';

const INK = '#0c3a52';

export function bossRecord(state) {
  const b = (state.bosses ||= {});
  b.won ||= {}; b.trophies ||= {};
  return b;
}

export function bossUnlocked(game, def) {
  if (!def) return false;
  const st = game.state || {};
  if (game.debugBosses || bossRecord(st).won[def.id]) return true;
  try {
    const book = game.quests?.book;
    if (book && (book.isDone?.(def.quest) || book.isActive?.(def.quest))) return true;
  } catch (e) { /* no quests */ }
  return !!st.quests?.chDone?.[def.chapter];
}

const deepestZone = (g) => {
  try { return g.ocean?.depthZone?.()?.id === 'abyss'; } catch (e) { return false; }
};

function lookLen(sp) {
  const l = sp.look || {};
  return Math.max(20, (l.body?.len || 40) * (sp.scale || 1));
}

// ================================================================== the director: when and how a boss shows up
export class BossDirector {
  constructor(F) {
    this.F = F;
    this.fish = null;
    this.wait = 0; this.cool = 8; this.rumbled = false;
    this.goneT = 0; this.t = 0;
  }

  get game() { return this.F.game; }
  def() { return BOSS_BY_OCEAN[this.game.ocean?.biome?.id] || null; }

  update(dt) {
    const F = this.F, g = this.game;
    this.t += dt;
    this.cool -= dt;
    if (!g.ocean || g.state?.view !== 'ocean' || g.ocean.travelState) { this.wait = 0; return; }
    const f = this.fish;
    if (f) {
      if (!g.school?.fishes?.includes(f) || f.dead) { this.fish = null; return; }
      if (F.fish === f) return; // the fight owns it now
      this.approach(dt, f);
      return;
    }
    // adopt a boss species already swimming here (the Relic summon) once it is unlocked
    const def = this.def();
    if (!def) return;
    const unlocked = bossUnlocked(g, def);
    if (unlocked && g.school?.fishes) {
      const adopt = g.school.fishes.find((x) => x.sp?.id === def.id && !x.boss && !x.hero && !x.controlled);
      if (adopt) { this.makeBoss(adopt, def); this.fish = adopt; return; }
    }
    const ready = unlocked && F.state === 'idle' && !F.cine && F.hook.visible && g.world?.hook?.inWater && this.cool <= 0 && deepestZone(g);
    if (!ready) { this.wait = Math.max(0, this.wait - dt * 2); if (this.wait <= 0) this.rumbled = false; return; }
    this.wait += dt;
    if (this.wait > 1.4 && !this.rumbled) {
      this.rumbled = true;
      F.shake(3);
      F.sfx('sonar', { vol: 0.8, pitch: 0.6 });
      F.sfx('roar', { vol: 0.35, pitch: 0.5 });
      F.titles.banner('SOMETHING HUGE...', def.color, '', { pal: 'red' });
    }
    if (this.rumbled && rng.chance(dt * 4)) F.shake(1);
    if (this.wait > 3.4) { this.wait = 0; this.rumbled = false; this.summon(def.id); }
  }

  makeBoss(f, def) {
    f.boss = def;
    f.scale = def.len / lookLen(f.sp);
    f.life = 1e9;
    f.cooldown = 0;
    f.alpha = Math.max(f.alpha, 0.6);
    f.rec.boss = def.id;
    f.z = 0;
  }

  // Bring the ocean's boss (or `id`) in from the edge of the view, swimming for the hook.
  summon(id = null) {
    const F = this.F, g = this.game;
    const def = (id && id !== true && BOSS_BY_ID[id]) || this.def();
    const sp = def && SPECIES_BY_ID[def.id];
    if (!sp || !g.school?.spawn) return false;
    if (this.fish && g.school.fishes.includes(this.fish)) return true;
    const h = F.hook;
    const v = F.cam?.view?.();
    const side = h.x > (v ? (v.x0 + v.x1) / 2 : F.world.W / 2) ? -1 : 1;
    const x = v ? (side < 0 ? v.x0 - 60 : v.x1 + 60) : h.x + side * 200;
    let f = null;
    try {
      f = g.school.spawn(sp, { x: clamp(x, 10, F.world.W - 10), y: h.y + 6, z: 0, fromFog: false });
    } catch (e) { console.error(e); return false; }
    if (!f) return false;
    this.makeBoss(f, def);
    f.x = clamp(x, 10, F.world.W - 10); f.y = h.y + 6;
    f.alpha = 1; f.fadeIn = false;
    f.facing = -side; f.turn = f.facing;
    f.controlled = true; f.allowTurn = true;
    f.say('!!', 1.5); f.feel('angry', 3);
    this.fish = f; this.goneT = 0;
    F.sfx('roar', { vol: 0.8, pitch: 0.7 });
    F.sfx('splash_big', { vol: 0.5, pitch: 0.6 });
    F.shake(6);
    F.cam?.flash?.(def.color, 0.2);
    return true;
  }

  // The boss surges toward the hook and takes the bait.
  approach(dt, f) {
    const F = this.F, h = F.hook;
    f.controlled = true; f.allowTurn = true; f.cooldown = 0;
    if (F.state !== 'idle' || !h.visible || !this.game.world?.hook?.inWater) {
      // the hook is gone: circle around for a while, then leave
      this.goneT += dt;
      f.vx = Math.cos(this.t * 0.8) * 30; f.vy = Math.sin(this.t * 1.3) * 8;
      f.x += f.vx * dt; f.y += f.vy * dt;
      if (this.goneT > 7) this.dismiss();
      return;
    }
    this.goneT = 0;
    const side = f.x < h.x ? -1 : 1;
    const off = F.fishLen(f) * 0.42 + 6;
    const tx = h.x + side * off, ty = h.y + 2;
    const d = Math.hypot(tx - f.x, ty - f.y);
    const sp = Math.min(d * 3, 170);
    f.vx = ((tx - f.x) / (d || 1)) * sp; f.vy = ((ty - f.y) / (d || 1)) * sp;
    f.x += f.vx * dt; f.y += f.vy * dt;
    f.facing = -side;
    f.lookAt?.(h.x, h.y);
    if (rng.chance(dt * 10)) F.particles.bubbleTrail?.(f.x, f.y, f.vx, f.vy);
    if (d < 14) F.requestNibble(f);
  }

  dismiss() {
    const f = this.fish;
    this.fish = null;
    this.cool = 25;
    if (!f) return;
    f.controlled = false;
    f.setState?.('leave');
  }

  // after a boss fight: rest a while before it can come back
  rest(won) { this.cool = won ? 60 : 20; this.fish = null; }

  drawWorld(ctx) {
    const f = this.fish, F = this.F;
    if (f && F.fish !== f && f.boss) drawBossAura(ctx, F, f, f.boss, 1, F.t);
  }
}

// ================================================================== aura
// A glow behind the boss, a pulsing coloured outline (silhouette passes under a fresh draw of the rig), embers.
export function drawBossAura(ctx, F, f, def, k = 1, t = 0, rage = 0) {
  if (!f || !f.c || f.alpha <= 0) return;
  const col = rage > 0.5 ? '#ff5a4a' : def.color;
  const len = F.fishLen(f);
  const r = Math.round(len * 0.62);
  const pulse = 0.5 + 0.5 * Math.sin(t * 3.2);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = (0.16 + 0.1 * pulse) * k;
  ctx.drawImage(glowSprite(r, col), Math.round(f.x - r), Math.round(f.y - r));
  ctx.globalAlpha = (0.12 + 0.08 * pulse) * k;
  const r2 = Math.round(r * 0.55);
  ctx.drawImage(glowSprite(r2, '#ffffff'), Math.round(f.x - r2), Math.round(f.y - r2));
  ctx.restore();
  try {
    const o = Math.max(1, Math.round(1 + pulse));
    const base = f.rigState({ silhouette: col });
    ctx.save();
    ctx.globalAlpha = (0.55 + 0.35 * pulse) * k * f.alpha;
    for (const [dx, dy] of [[-o, 0], [o, 0], [0, -o], [0, o]]) drawFishRig(ctx, f.c, { ...base, x: base.x + dx, y: base.y + dy });
    ctx.restore();
    ctx.save();
    ctx.globalAlpha = f.alpha;
    f.anchors = drawFishRig(ctx, f.c, f.rigState(rage > 0.5 && Math.floor(t * 6) % 2 ? { wash: { color: '#ff3a2a', alpha: 0.25 } } : {}));
    ctx.restore();
  } catch (e) { /* silhouettes unsupported */ }
  // embers drifting up off the body
  if (rng.chance(0.35 * k)) {
    F.particles.pixel?.(rng.chance(0.6) ? 'sparkle' : 'spark', f.x + rng.float(-len * 0.45, len * 0.45), f.y + rng.float(-len * 0.15, len * 0.15),
      { ramp: rage > 0.5 ? '#ff6a3a' : def.color, vy: -rng.float(12, 30), vx: rng.float(-6, 6), life: rng.float(0.6, 1.1), size: 0, blink: true });
  }
}


// ================================================================== the fight layer
const PHASE_AT = [0.66, 0.33];
const CHARGE_NEED = 54; // logical px of mouse drag (the opposite way) to dodge

export class BossFight {
  constructor(B, def) {
    this.B = B; this.F = B.F; this.def = def; this.fish = B.fish;
    this.tier = def.tier || 1;
    this.t = 0;
    this.stage = 'intro'; this.stageT = 2.9;
    this.phase = 1;
    this.atk = null;
    this.atkT = 4;
    this.last = null;
    this.minions = [];
    this.hurt = 0; // red flash on the bar
    this.hpShown = 1;
    this.cardT = 0;
    this.phaseCard = null;
    this.rage = 0;
    B.shockCdMax *= 0.7;
    B.progress = 0;
    B.ghost = 0;
    this.F.onBossIntro?.(def);
  }

  get hp() { return clamp01(1 - this.B.progress); }
  get busy() { return this.atk?.kind === 'charge'; }
  get blocksShock() { return this.stage !== 'fight'; }
  inWindow() { return this.atk?.kind === 'charge' && this.atk.stage === 'dazed'; }

  // multipliers the Battle reads
  reelMul() { return (1 / (this.def.hp || 1)) * (this.inWindow() ? 1.8 : this.B.stunned ? 0.6 : 1); }
  lineOutMul() { return 0.45; }
  pullMul() { return 0.9 + this.tier * 0.04 + (this.phase - 1) * 0.08; }
  durMul() { return 0.9 + (this.phase - 1) * 0.12; }
  paceMul() { return 1.05 - (this.phase - 1) * 0.15; }
  extraTension() { return this.atk?.kind === 'charge' && this.atk.stage === 'tele' ? 0.08 : 0; }
  canFinish() { return this.stage === 'fight'; }
  debugWin() { this.stage = 'fight'; this.atk = null; }

  update(dt) {
    const B = this.B, F = this.F;
    this.t += dt;
    this.hurt = Math.max(0, this.hurt - F.rdt * 2);
    this.hpShown = damp(this.hpShown, this.hp, 6, F.rdt);
    this.rage = damp(this.rage, this.phase >= 3 ? 1 : 0, 2, dt);
    if (this.phaseCard) { this.phaseCard.t += F.rdt; if (this.phaseCard.t > 1.8) this.phaseCard = null; }
    this.updateMinions(dt);
    if (this.stage === 'intro') {
      this.stageT -= F.rdt;
      this.cardT += F.rdt;
      B.thrash(dt, 2);
      if (this.stageT <= 0) { this.stage = 'fight'; F.onBossFightStart?.(this.def); }
      return 'hold';
    }
    if (this.stage === 'phase') {
      this.stageT -= F.rdt;
      B.thrash(dt, 4);
      if (this.stageT <= 0) { this.stage = 'fight'; this.atkT = 1.2; }
      return 'hold';
    }
    // phase changes: the health stops at the notch, attacks and stuns end, the boss roars
    const next = this.phase === 1 && this.hp <= PHASE_AT[0] ? 2 : this.phase === 2 && this.hp <= PHASE_AT[1] ? 3 : 0;
    if (next) {
      B.progress = 1 - PHASE_AT[next - 2] + 0.002;
      this.atk = null;
      this.minions.length = 0;
      B.stunT = 0; B.charge = null; B.trick = null;
      this.phase = next;
      this.stage = 'phase'; this.stageT = 1.7;
      this.phaseCard = { t: 0, n: next };
      B.mode = 'rest'; B.nextPull = 2.5;
      this.fish.feel('angry', 3); this.fish.say('anger', 1.5);
      F.onBossPhase?.(this.def, next);
      return 'hold';
    }
    if (this.atk) { this.updateAttack(dt); return null; }
    if (!B.stunned && (B.mode === 'rest' || B.mode === 'tired')) {
      this.atkT -= dt;
      if (this.atkT <= 0) this.startAttack();
    }
    return null;
  }

  pickAttack() {
    const all = this.def.attacks || ['charge'];
    const pool = this.phase === 1 ? all.filter((a) => a === 'charge') : all.filter((a) => a !== this.last || all.length === 1);
    return rng.pick(pool.length ? pool : ['charge']);
  }

  startAttack() {
    const B = this.B, F = this.F, f = this.fish;
    const kind = this.pickAttack();
    this.last = kind;
    if (kind === 'charge') {
      const px = F.input.x;
      const dir = px > F.W * 0.6 ? 1 : px < F.W * 0.4 ? -1 : rng.sign();
      const tele = Math.max(0.75, 1.25 - (this.phase - 1) * 0.15 - this.tier * 0.02);
      this.atk = { kind, stage: 'tele', t: 0, tele, dir, x0: F.input.x, best: 0, dodged: false, sx: f.x, sy: f.y };
      f.say('!!', tele); f.feel('angry', 2);
      B.mode = 'rest';
      F.onBossAttack?.('charge', this.atk);
    } else if (kind === 'ink') {
      this.atk = { kind, t: 0, dur: 1 };
      F.inkSplat?.(4 + this.phase, { big: true, life: 9 });
      F.particles.ink?.(f.x, f.y, 18, { power: 1.6, scale: 1.6, color: '#140a22' });
      B.nextPull = Math.min(B.nextPull, 1.2);
      F.onBossAttack?.('ink', this.atk);
    } else {
      const n = 2 + this.phase + Math.min(2, Math.floor(this.tier / 3));
      this.atk = { kind: 'minions', t: 0, dur: 1 };
      this.spawnMinions(n);
      F.onBossAttack?.('minions', this.atk);
    }
  }

  endAttack() {
    this.atk = null;
    this.atkT = rng.float(5.5, 8) * (1.1 - (this.phase - 1) * 0.15);
    if (this.B.mode !== 'stun') this.B.toRest();
  }

  updateAttack(dt) {
    const a = this.atk, B = this.B, F = this.F, f = this.fish;
    a.t += dt;
    if (a.kind !== 'charge') { if (a.t > a.dur) this.endAttack(); return; }
    // dodge: net mouse drag the opposite way (screen x) since the warning began
    const drag = (F.input.x - a.x0) * -a.dir;
    a.best = Math.max(a.best, drag);
    if (!a.dodged && a.best >= CHARGE_NEED && (a.stage === 'tele' || a.stage === 'rush')) { a.dodged = true; F.onBossDodge?.(a); }
    const [ax, ay] = B.anchor();
    if (a.stage === 'tele') {
      // back up and shake
      const back = Math.min(1, a.t / a.tele);
      B.place(ax - a.dir * 40 * back + Math.sin(this.t * 50) * 2, ay + Math.sin(this.t * 37));
      f.facing = a.dir; f.vx = a.dir * 20; f.vy = 0;
      f.wiggle = 0.8;
      if (a.t >= a.tele) { a.stage = 'rush'; a.t = 0; F.onBossCharge?.(a); }
    } else if (a.stage === 'rush') {
      const u = clamp01(a.t / 0.45);
      B.place(ax - a.dir * 40 + a.dir * 150 * ease.outCubic(u), ay, false);
      f.facing = a.dir; f.vx = a.dir * 300; f.vy = 0;
      if (rng.chance(dt * 40)) F.particles.bubbleTrail?.(f.x - a.dir * 20, f.y, -a.dir * 120, 0);
      if (u >= 1) {
        if (a.dodged) {
          a.stage = 'dazed'; a.t = 0; a.dur = 2.8 + Math.max(0, 0.6 - this.tier * 0.06);
          f.feel('dizzy', a.dur); f.say('zzz', a.dur);
          F.onBossDazed?.(a);
        } else {
          a.stage = 'hit'; a.t = 0;
          B.kick(0.45 + this.tier * 0.02);
          B.progress = Math.max(0.005, B.progress - 0.04);
          this.hurt = 0;
          F.onBossHit?.(a);
        }
      }
    } else if (a.stage === 'dazed') {
      B.place(damp(f.x, ax + a.dir * 60, 2, dt) + (Math.floor(this.t * 20) % 2 ? 1 : -1), damp(f.y, ay, 2, dt));
      f.vx = 0; f.vy = 0;
      f.feel('dizzy', 0.3);
      if (rng.chance(dt * 6)) F.particles.pixel?.('star', f.x + rng.float(-20, 20), f.y - F.fishLen() * 0.25, { ramp: 'gold', vy: -20, life: 0.6, size: 0 });
      if (a.t >= a.dur || (B.stunned && a.crit)) this.endAttack();
    } else {
      B.place(damp(f.x, ax, 3, dt), damp(f.y, ay, 3, dt));
      if (a.t > 0.7) this.endAttack();
    }
  }

  onCrit() {
    const B = this.B, a = this.atk;
    B.progress = Math.min(0.999, B.progress + 0.08 + 0.02 * B.shockPower);
    this.hurt = 1;
    if (a) a.crit = true;
    this.F.onBossCrit?.(this.def);
  }

  // ---------------------------------------------------------------- minions
  minionSpecies() {
    const oc = this.def.ocean;
    if (this.def.minion && SPECIES_BY_ID[this.def.minion]) return SPECIES_BY_ID[this.def.minion];
    const pool = SPECIES.filter((s) => s.biome === oc && (s.rarity === 'common' || s.rarity === 'uncommon') && s.look?.kind !== 'chain' && !s.spawn?.never);
    return pool.length ? rng.pick(pool) : SPECIES[0];
  }

  spawnMinions(n) {
    const F = this.F, sp = this.minionSpecies();
    for (let i = 0; i < n; i++) {
      const left = i % 2 === 0;
      const [wx, wy] = F.toWorld(left ? -20 : F.W + 20, F.H * rng.float(0.25, 0.75));
      this.minions.push({ x: wx, y: wy, u: rng.float(0.45, 0.75), sp, t: -i * 0.45, speed: rng.float(42, 58) + this.tier * 3, dir: left ? 1 : -1, hp: 1, wob: rng.float(0, TAU) });
    }
  }

  linePoint(u) {
    const F = this.F, f = this.fish;
    const [rx, ry] = F.rodTip();
    const m = f.anchors?.mouth || [f.x, f.y];
    return [lerp(rx, m[0], u), lerp(ry, m[1], u)];
  }

  updateMinions(dt) {
    const F = this.F, B = this.B;
    for (const m of this.minions) {
      m.t += dt;
      if (m.t < 0 || m.dead) continue;
      const [tx, ty] = this.linePoint(m.u);
      const dx = tx - m.x, dy = ty - m.y, d = Math.hypot(dx, dy) || 1;
      m.dir = dx >= 0 ? 1 : -1;
      m.x += (dx / d) * m.speed * dt;
      m.y += (dy / d) * m.speed * dt + Math.sin(m.t * 6 + m.wob) * 10 * dt;
      if (d < 8) {
        m.dead = true;
        B.kick(0.22);
        F.shake(4);
        F.particles.impact?.(m.x, m.y, 0, { ramp: 'red' });
        F.sfx('gulp', { pitch: 1.4 });
        F.sfx('timing_miss', { vol: 0.5 });
        F.onMinionBite?.(m);
      }
    }
    this.minions = this.minions.filter((m) => !m.dead);
  }

  // A click at screen (sx, sy): bonk the minion under it. Returns true when one was hit.
  hitMinion(sx, sy) {
    const F = this.F;
    for (const m of this.minions) {
      if (m.t < 0 || m.dead) continue;
      const [mx, my] = F.toScreen(m.x, m.y);
      if (Math.hypot(mx - sx, my - sy) < 22) {
        m.dead = true;
        F.particles.impact?.(m.x, m.y, 1, { ramp: 'gold' });
        F.particles.pixelBurst?.('star', m.x, m.y, 5, { ramp: 'gold' });
        F.particles.poof?.(m.x, m.y);
        F.sfx('mash_pop', { pitch: 1.2 });
        F.sfx('boing', { vol: 0.4, pitch: 1.4 });
        F.shake(2);
        F.onMinionBonk?.(m);
        return true;
      }
    }
    return false;
  }

  // ---------------------------------------------------------------- drawing
  drawWorld(ctx) {
    const F = this.F;
    drawBossAura(ctx, F, this.fish, this.def, 1, this.t, this.rage);
    for (const m of this.minions) {
      if (m.t < 0) continue;
      const spr = voxelFishIcon(m.sp, 26, 18, { dir: m.dir });
      if (!spr) continue;
      const bob = Math.round(Math.sin(m.t * 8) * 1);
      ctx.drawImage(spr, Math.round(m.x - spr.width / 2), Math.round(m.y - spr.height / 2 + bob));
      // angry red pip over its head
      if (Math.floor(m.t * 4) % 2) { ctx.fillStyle = '#ff4f5e'; ctx.fillRect(Math.round(m.x) - 1, Math.round(m.y - spr.height / 2 - 4), 2, 2); }
    }
  }

  drawHud(ctx) {
    const F = this.F, W = F.W, H = F.H, t = this.t;
    if (this.stage === 'intro') this.drawIntroCard(ctx, this.cardT);
    // ---- the boss bar
    const show = this.stage === 'intro' ? clamp01((this.cardT - 1.6) * 3) : 1;
    if (show > 0.01) {
      const bw = Math.round(Math.min(W * 0.56, 520)), bh = 18;
      const bx = Math.round(W / 2 - bw / 2), by = Math.round(18 - (1 - ease.outBack(show)) * 60);
      ctx.save();
      ctx.globalAlpha = show;
      drawAeroSurface(ctx, bx - 10, by - 6, bw + 20, bh + 30, { tone: 'dark', r: 10, gloss: 0.35, glossH: 10, rim: 0.6, glow: 0.4 });
      const hp = this.hpShown;
      const col = this.rage > 0.5 ? '#ff5a4a' : this.phase === 2 ? '#ff9d2e' : '#ff4f7a';
      // the bar: a chip of white shows recent damage
      drawAeroBar(ctx, bx, by + 14, bw, bh, Math.max(hp, this.hp + this.hurt * 0.05), { color: '#ffffff' });
      drawAeroBar(ctx, bx, by + 14, bw, bh, this.hp, { color: col });
      // phase notches
      for (const p of PHASE_AT) {
        const nx = Math.round(bx + 1 + (bw - 2) * p);
        ctx.fillStyle = INK; ctx.fillRect(nx - 1, by + 12, 3, bh + 4);
        ctx.fillStyle = '#ffffff'; ctx.fillRect(nx, by + 13, 1, bh + 2);
      }
      // name + phase pips
      const sk = getUiIcon('skull', 1);
      if (sk) ctx.drawImage(sk, bx, by - 1);
      drawText(ctx, this.def.title.toUpperCase(), bx + (sk ? sk.width + 4 : 0), by, { color: '#ffffff', outline: INK, scale: 1 });
      for (let i = 0; i < 3; i++) {
        const on = i < this.phase;
        const px = bx + bw - 3 * 14 + i * 14;
        ctx.fillStyle = INK; ctx.fillRect(px - 1, by - 1, 12, 9);
        ctx.fillStyle = on ? (i === 2 ? '#ff5a4a' : '#ffd23a') : '#3a5a72';
        ctx.fillRect(px, by, 10, 7);
        if (on) { ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.fillRect(px, by, 10, 2); }
      }
      if (this.hurt > 0.3 && Math.floor(t * 20) % 2) { ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fillRect(bx, by + 14, bw, bh); }
      ctx.restore();
    }
    // ---- attack cues
    const a = this.atk;
    if (a?.kind === 'charge') this.drawChargeCue(ctx, a);
    if (a?.kind === 'charge' && a.stage === 'dazed') this.drawZapCue(ctx, a);
    if (this.minions.some((m) => m.t >= 0)) {
      for (const m of this.minions) {
        if (m.t < 0) continue;
        const [sx, sy] = F.toScreen(m.x, m.y);
        drawTarget(ctx, sx, sy, 13, t, '#ff8a7a');
      }
    }
    if (this.phaseCard) this.drawPhaseCard(ctx, this.phaseCard);
  }

  drawIntroCard(ctx, ct) {
    const F = this.F, W = F.W, H = F.H, def = this.def;
    const inK = ease.outCubic(clamp01(ct * 2.5)), outK = clamp01((2.9 - ct) * 3);
    const a = Math.min(inK, outK);
    if (a <= 0.01) return;
    const cy = Math.round(H * 0.62);
    ctx.save();
    // darken the world a touch
    ctx.globalAlpha = 0.35 * a;
    ctx.fillStyle = '#020a14';
    ctx.fillRect(0, 0, W, H);
    // the band
    ctx.globalAlpha = a;
    const bh = 96;
    const slide = Math.round((1 - inK) * W);
    ctx.fillStyle = rgba('#04121e', 0.82);
    ctx.fillRect(-slide, cy - bh / 2, W, bh);
    ctx.fillStyle = def.color; ctx.fillRect(-slide, cy - bh / 2, W, 2); ctx.fillRect(slide, cy + bh / 2 - 2, W, 2);
    // speed streaks in the band
    for (let i = 0; i < 14; i++) {
      const sx = ((i * 137 + ct * 900) % (W + 200)) - 100, sy = cy - bh / 2 + 6 + ((i * 53) % (bh - 12));
      ctx.fillStyle = rgba(def.color, 0.25);
      ctx.fillRect(Math.round(W - sx), sy, 40 + (i % 3) * 20, 1);
    }
    // "BOSS" tag, name, subtitle
    const tag = glossText('BOSS', 2, 'red');
    const tx = Math.round(W / 2 - tag.w / 2 + slide * 0.5);
    ctx.drawImage(tag.c, tx - tag.ox, cy - bh / 2 + 6 - tag.oy);
    const jit = ct < 0.5 ? rng.int(-1, 1) : 0;
    drawTitle(ctx, def.title, W / 2 - slide * 0.3 + jit, cy - 16, { scale: 3, color: '#ffffff', outline: '#04121e', align: 'center', glossColor: def.glow });
    drawText(ctx, def.sub, Math.round(W / 2 + slide * 0.2), cy + 32, { align: 'center', color: def.glow, outline: '#04121e' });
    ctx.restore();
  }

  drawPhaseCard(ctx, pc) {
    const F = this.F, W = F.W, H = F.H;
    const k = ease.outBack(clamp01(pc.t * 4)), a = clamp01((1.8 - pc.t) * 3);
    const g = glossText('PHASE ' + pc.n + '!', 4, pc.n >= 3 ? 'red' : 'sun');
    ctx.save();
    ctx.globalAlpha = a;
    drawRays(ctx, W / 2, H * 0.3, 200, 14, pc.t, pc.n >= 3 ? '#ff8a7a' : '#ffe27a', 0.1 * a);
    ctx.translate(W / 2, Math.round(H * 0.3));
    ctx.scale(lerp(2, 1, k), lerp(2, 1, k));
    ctx.drawImage(g.c, Math.round(-g.w / 2 - g.ox), Math.round(-g.h / 2 - g.oy));
    ctx.restore();
  }

  // the charge: a red arrow on the boss (where it rushes) and a big green DRAG arrow (where you pull)
  drawChargeCue(ctx, a) {
    const F = this.F, W = F.W, H = F.H, t = this.t;
    if (a.stage !== 'tele' && a.stage !== 'rush') return;
    const [fx, fy] = F.toScreen(this.fish.x, this.fish.y);
    const blink = Math.floor(t * 10) % 2;
    drawBigArrow(ctx, fx + a.dir * 30, fy - 34, a.dir > 0 ? 0 : Math.PI, 46, a.dodged ? '#8a9aa8' : blink ? '#ff4f5e' : '#ff9a7a');
    // the counter: green, at the cursor side of the screen, fills as you drag
    const k = clamp01(a.best / CHARGE_NEED);
    const cx = Math.round(W / 2), cy = Math.round(H * 0.3);
    const label = a.dodged ? 'DODGED!' : 'DRAG!';
    const g = glossText(label, 3, a.dodged ? 'lime' : 'sun');
    ctx.drawImage(g.c, Math.round(cx - g.w / 2 - g.ox), Math.round(cy - 40 - g.oy));
    drawBigArrow(ctx, cx - a.dir * 20, cy + 6, a.dir > 0 ? Math.PI : 0, 90, a.dodged ? '#8be04a' : '#c8f56a', k);
  }

  drawZapCue(ctx, a) {
    const F = this.F, t = this.t;
    const [fx, fy] = F.toScreen(this.fish.x, this.fish.y);
    const r = Math.round(clamp(F.fishLen() * F.zoom() * 0.32, 26, 70));
    drawTarget(ctx, clamp(fx, 80, F.W - 80), clamp(fy, 130, F.H - 150), r, t, '#ffe27a');
    const left = clamp01(1 - a.t / a.dur);
    const cx = Math.round(F.W / 2), cy = Math.round(F.H * 0.3);
    const g = glossText(this.B.charges > 0 ? 'ZAP NOW!' : 'DAZED! REEL!', 4, 'sun');
    const k = 1 + Math.max(0, Math.sin(t * 12)) * 0.08;
    ctx.save();
    ctx.translate(cx, cy - 18);
    ctx.scale(k, k);
    ctx.drawImage(g.c, Math.round(-g.w / 2 - g.ox), Math.round(-g.h / 2 - g.oy));
    ctx.restore();
    // the window ticking away
    const w = 120;
    ctx.fillStyle = INK; ctx.fillRect(cx - w / 2 - 1, cy + 6, w + 2, 8);
    ctx.fillStyle = '#5a4a18'; ctx.fillRect(cx - w / 2, cy + 7, w, 6);
    ctx.fillStyle = '#ffe27a'; ctx.fillRect(cx - w / 2, cy + 7, Math.round(w * left), 6);
    ctx.fillStyle = '#fff6c0'; ctx.fillRect(cx - w / 2, cy + 7, Math.round(w * left), 2);
  }
}

// chunky pixel corner brackets that pulse (a 'hit this' marker; no rings)
export function drawTarget(ctx, x, y, r, t, col) {
  const k = 1 + (Math.sin(t * 10) > 0 ? 2 : 0);
  const L = Math.max(5, Math.round(r * 0.45));
  x = Math.round(x); y = Math.round(y); r = Math.round(r) + k;
  for (const pass of [0, 1]) {
    ctx.fillStyle = pass ? col : INK;
    const e = pass ? 0 : 1;
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const cx = x + sx * r, cy = y + sy * r;
      ctx.fillRect(sx < 0 ? cx - e : cx - L - e + 1, cy - e - (sy > 0 ? 2 : 0), L + e * 2, 3 + e * 2);
      ctx.fillRect(cx - e - (sx > 0 ? 2 : 0), sy < 0 ? cy - e : cy - L - e + 1, 3 + e * 2, L + e * 2);
    }
  }
}

// ================================================================== victory
export function bossVictory(F, fish, def) {
  const g = F.game, st = g.state || {};
  const rec = bossRecord(st);
  const first = !rec.won[def.id];
  rec.won[def.id] = (rec.won[def.id] || 0) + 1;
  const rw = first ? def.reward : def.repeat;
  const items = [];
  try {
    if (rw.aero) { g.addCoins?.(rw.aero, F.W / 2, F.H * 0.5); items.push({ kind: 'aero', label: rw.aero.toLocaleString('en-US') + ' Aero' }); }
    if (rw.chest) { ITEMS.addItem(st, rw.chest, 1); items.push({ kind: 'chest', id: rw.chest, label: ITEMS.ITEMS?.[rw.chest]?.name || 'Chest' }); }
    if (first) { rec.trophies[def.id] = Date.now(); items.push({ kind: 'trophy', label: 'Trophy' }); }
    if (rw.recipe) { grantUnlock(st, 'recipe', rw.recipe); g.emit?.('unlocked', { kind: 'recipe', id: rw.recipe, free: true }); items.push({ kind: 'recipe', id: rw.recipe, label: 'Rod recipe' }); }
    if (rw.rod) { giveRod(st, rw.rod); items.push({ kind: 'rod', id: rw.rod, label: 'New rod!' }); }
  } catch (e) { console.error(e); }
  if (fish?.rec) { fish.rec.boss = def.id; fish.rec.trophy = first; }
  g.emit?.('bossDefeated', { id: def.id, ocean: def.ocean, first });
  try { g.save?.(); } catch (e) { /* ignore */ }
  return new Victory(F, def, items, first);
}

class Victory {
  constructor(F, def, items, first) {
    this.F = F; this.def = def; this.items = items; this.first = first;
    this.t = 0; this.dur = 6.5;
    this.burst = false;
  }

  update(rdt) {
    const F = this.F, W = F.W, H = F.H;
    this.t += rdt;
    if (!this.burst && this.t > 0.15) {
      this.burst = true;
      F.fx.celebrate?.(W / 2, H * 0.3, 2.2, { layer: 'fg' });
      F.fx.pixelBurst?.('star', W / 2, H * 0.3, 24, { ramp: 'gold', speed: [120, 300] });
      F.fx.pixelBurst?.('confetti', W / 2, -10, 40, { dir: Math.PI / 2, spread: 1.3, w: W * 0.4, speed: [20, 90] });
      F.sfx('catch_legendary');
      F.sfx('unlock_biome', { vol: 0.6 });
      F.cam?.flash?.('#fff6c0', 0.6);
    }
    // chips pop in one by one
    this.items.forEach((it, i) => {
      if (!it.popped && this.t > 1.4 + i * 0.35) {
        it.popped = true;
        const [x, y] = this.chipPos(i);
        F.fx.chestOpen?.(x, y, it.kind === 'trophy' || it.kind === 'rod' ? 'legendary' : 'epic', { layer: 'fg' });
        F.sfx(it.kind === 'chest' ? 'treasure_open' : 'timing_perfect', { pitch: 1 + i * 0.08 });
      }
    });
    if (this.t > 0.6 && this.t < 4 && rng.chance(0.3)) F.fx.pixel?.('sparkle', rng.float(0, W), rng.float(H * 0.1, H * 0.6), { ramp: 'gold', life: 0.6, size: rng.int(0, 1) });
    return this.t > this.dur ? 'done' : 'ok';
  }

  chipPos(i) {
    const F = this.F, n = this.items.length, gap = 92;
    return [Math.round(F.W / 2 - ((n - 1) * gap) / 2 + i * gap), Math.round(F.H * 0.5)];
  }

  draw(ctx) {
    const F = this.F, W = F.W, H = F.H, t = this.t, def = this.def;
    const a = clamp01(t * 3) * clamp01((this.dur - t) * 2);
    if (a <= 0.01) return;
    ctx.save();
    ctx.globalAlpha = a;
    drawRays(ctx, W / 2, H * 0.3, 320, 18, t * 0.6, '#fff2b8', 0.12);
    const k = ease.outBack(clamp01(t * 3));
    const g = glossText('VICTORY!', 6, 'sun');
    ctx.save();
    ctx.translate(W / 2, Math.round(H * 0.22));
    ctx.scale(lerp(2.4, 1, k), lerp(2.4, 1, k));
    ctx.drawImage(g.c, Math.round(-g.w / 2 - g.ox), Math.round(-g.h / 2 - g.oy));
    ctx.restore();
    const sub = (this.first ? 'BOSS DEFEATED: ' : 'DEFEATED AGAIN: ') + def.title.toUpperCase();
    const sw = measureText(sub, 'normal', 1) + 30;
    drawGlassPill(ctx, W / 2, Math.round(H * 0.31), sw, 17, def.color, 0.9);
    drawText(ctx, sub, Math.round(W / 2), Math.round(H * 0.31) + 5, { align: 'center', color: INK });
    // reward chips
    this.items.forEach((it, i) => {
      if (!it.popped) return;
      const [x, y] = this.chipPos(i);
      const pk = ease.outBack(clamp01((t - 1.4 - i * 0.35) * 4));
      const bob = Math.round(Math.sin(t * 3 + i) * 2);
      ctx.save();
      ctx.translate(x, y + bob);
      ctx.scale(pk, pk);
      drawAeroSurface(ctx, -38, -34, 76, 70, { tone: 'frost', r: 12, gloss: 0.5, glossH: 20, rim: 0.85, glow: 0.5 });
      drawRewardIcon(ctx, it, 0, -6, t);
      drawText(ctx, it.label, 0, 22, { align: 'center', color: INK });
      ctx.restore();
    });
    ctx.restore();
  }
}

function drawRewardIcon(ctx, it, x, y, t) {
  if (it.kind === 'aero') { drawAeroCoin(ctx, x, y, 11, t); return; }
  if (it.kind === 'trophy') { drawTrophy(ctx, x, y, t); return; }
  let ic = null;
  try {
    if (it.kind === 'chest') ic = labIcon('mat:' + it.id, 30);
    else if (it.kind === 'rod') ic = labIcon('rod:' + it.id, 30);
    else if (it.kind === 'recipe') ic = labIcon('rod:' + String(it.id).replace(/^ws_rod_/, ''), 30);
  } catch (e) { ic = null; }
  if (!ic) ic = it.kind === 'chest' ? chestIcon() : getUiIcon('line', 2);
  if (ic) ctx.drawImage(ic, Math.round(x - ic.width / 2), Math.round(y - ic.height / 2));
}

let CHEST = null;
function chestIcon() {
  if (CHEST) return CHEST;
  const c = document.createElement('canvas');
  c.width = 30; c.height = 24;
  const g = c.getContext('2d');
  const P = (col, x, y, w, h) => { g.fillStyle = col; g.fillRect(x, y, w, h); };
  P(INK, 1, 7, 28, 16); P('#c8925a', 2, 8, 26, 14); P('#e8b47a', 2, 8, 26, 3); P('#7a4a24', 2, 19, 26, 3);
  P(INK, 2, 1, 26, 8); P('#d8a268', 3, 2, 24, 6); P('#ffe2b0', 3, 2, 24, 2);
  P('#ffd04a', 4, 7, 22, 2); P('#ffd04a', 13, 6, 4, 9); P(INK, 14, 10, 2, 3); P('#fff8c8', 13, 6, 1, 2);
  CHEST = c;
  return c;
}

// A glossy pixel trophy cup (for the victory chips and the catch card).
export function drawTrophy(ctx, x, y, t = 0, s = 1) {
  x = Math.round(x); y = Math.round(y);
  const P = (col, px, py, w, h) => { ctx.fillStyle = col; ctx.fillRect(x + px * s, y + py * s, w * s, h * s); };
  P(INK, -9, -12, 18, 13); P('#ffd23a', -8, -11, 16, 11); P('#fff6c0', -6, -10, 4, 8); P('#e0901a', 4, -11, 4, 11);
  P(INK, -13, -10, 5, 7); P('#ffd23a', -12, -9, 3, 5); P(INK, 8, -10, 5, 7); P('#ffd23a', 9, -9, 3, 5);
  P(INK, -3, 1, 6, 5); P('#e0a020', -2, 1, 4, 4);
  P(INK, -7, 5, 14, 5); P('#5a8ab8', -6, 6, 12, 3); P('#bfeaff', -6, 6, 12, 1);
  if (Math.sin(t * 4) > 0.6) { P('#ffffff', -5, -9, 1, 3); P('#ffffff', -6, -8, 3, 1); }
}
