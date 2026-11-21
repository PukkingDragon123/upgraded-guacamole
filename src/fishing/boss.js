// [phase9:fishing] Boss fights. Every ocean has a boss (src/fish/bosses.js), unlocked by the chapter's Boss quest
// (quests.js `cN_boss`). Drop the hook into the ocean's deepest zone: the water rumbles and the boss surges in (the
// abyss's Ancient Relic still summons The Algorithm too). It is the normal fish renderer at a huge scale, with an aura,
// an outline glow and drifting pixel embers.
//
// [simple24] The fight is the normal one (spin to keep the marker in the middle, SHOCK on the beat) plus:
//   intro    letterbox, the camera on the boss, a title card with its name, a roar
//   health   a boss bar at the top (health = 1 - progress); 3 phases (at 66% and 33%: roar + PHASE card)
//   phases   1 a heavy pull + lunges; 2 faster + SHIELD (only a shock cracks it) + ink; 3 RAGE + WEAK POINT (crits x1.6)
//   victory  slow-mo, VICTORY title, rewards (Aero, a chest, a trophy, a rod recipe; smaller on rematches)
//
//   bossUnlocked(game, def), bossRecord(state) -> {won: {id: n}, trophies: {id: ts}}
//   new BossDirector(F)  update(dt), summon(id?), fish (the boss swimming in, or null), drawWorld(ctx), drawHud(ctx)
//   new BossFight(B, def) (built by Battle when fish.boss is set): update(dt) -> 'hold' | null, blocksShock, shielded,
//     mods() (pull modifiers), fillMul(), dmgMul(), sweepMul(), weakPoint(), onShock(grade), canFinish(), hp, phase,
//     drawWorld(ctx), drawHud(ctx)
//   bossVictory(F, fish, def) -> overlay {update(rdt), draw(ctx)} (grants the rewards, emits 'bossDefeated')
//   drawBossAura(ctx, F, fish, def, k, t)

import { TAU, clamp, clamp01, lerp, damp, ease } from '../core/math.js';
import { rng } from '../core/rng.js';
import { rgba, shade } from '../core/color.js';
import { glowSprite } from '../gfx/particles.js';
import { drawFishRig } from '../gfx/fishrig.js';
import { voxelFishIcon } from '../fish/fishicon.js';
import { SPECIES, SPECIES_BY_ID } from '../fish/species.js';
import { BOSS_BY_OCEAN, BOSS_BY_ID } from '../fish/bosses.js';
import { drawAeroBar, drawAeroCoin, aeroCached, aeroSurface } from '../ui/aero.js';
import { drawGlow, word3D, letters3D } from './cinematics.js';
import { drawIcon3d, chestIconId } from './icons3d.js';
import { gemIcon, rodIcon } from '../gfx/bigicons.js';
import { ROD_BY_ID } from '../game/rods.js';
import * as ITEMS from '../build/items.js';
import { grantUnlock } from '../game/lab.js';
import { giveRod } from '../game/rods.js';

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
// [simple24] The boss fights on the same meter + SHOCK button as every fish, in 3 phases (health notches at 66 / 33 %):
//   phase 1  a steady, heavy pull with the odd LUNGE (arrow on the meter first)
//   phase 2  faster, jitterier; SHIELD: the boss armours up (bubble plates, the zone turns steel blue) and the catch
//            bar stops filling until a shock (GOOD or CRITICAL) cracks it. A charge is always handed over for it.
//            Bosses with 'ink' squirt ink on the lens (spinning wipes it).
//   phase 3  RAGE: fastest pull, more lunges; WEAK POINT: critical zaps hit 1.6x harder.
const PHASE_AT = [0.66, 0.33];

export class BossFight {
  constructor(B, def) {
    this.B = B; this.F = B.F; this.def = def; this.fish = B.fish;
    this.tier = def.tier || 1;
    this.t = 0;
    this.introDur = 3.8;
    this.stage = 'intro'; this.stageT = this.introDur;
    this.landed = new Set();
    this.palette = { face: [def.glow, def.color, shade(def.color, -0.3)], bevelL: '#ffffff', bevelD: shade(def.color, -0.35), side: shade(def.color, -0.5), back: '#121a2e', outline: '#ffffff' };
    this.phase = 1;
    this.shield = null; this.shieldT = 7; this.shieldK = 0;
    this.inkT = 9;
    this.hurt = 0;
    this.hpShown = 1;
    this.cardT = 0;
    this.phaseCard = null;
    this.rage = 0;
    this.minions = [];
    B.shockCdMax *= 0.75;
    B.progress = 0;
    B.ghost = 0;
    this.F.onBossIntro?.(def);
  }

  get hp() { return clamp01(1 - this.B.progress); }
  get busy() { return false; }
  get atk() { return this.shield; }
  get shielded() { return !!this.shield; }
  get blocksShock() { return this.stage !== 'fight'; }
  weakPoint() { return this.phase >= 3; }
  inWindow() { return this.weakPoint(); }
  // the Battle's pull modifiers for this phase (spin units)
  mods() {
    const k = this.tier - 1, ph = this.phase;
    if (ph === 1) return { base: 0.04 + k * 0.015, amp: 1, speed: 1, jit: 0, lunge: 0.05 + k * 0.01, tele: 1.1 };
    if (ph === 2) return { base: 0.06 + k * 0.02, amp: 1.12, speed: 1.25, jit: 0.04 + k * 0.012, lunge: 0.07 + k * 0.012, tele: 1 };
    return { base: 0.08 + k * 0.02, amp: 1.22, speed: 1.45, jit: 0.07 + k * 0.015, lunge: 0.12 + k * 0.015, tele: 0.9 };
  }
  fillMul() { return this.shield ? 0 : 1; }
  dmgMul() { return 1 / Math.sqrt(this.def.hp || 1); }
  sweepMul() { return 1 + Math.max(0, 0.15 - this.tier * 0.02); }
  canFinish() { return this.stage === 'fight' && !this.shield; }
  debugWin() { this.stage = 'fight'; this.shield = null; this.phase = 3; }
  hitMinion() { return false; }

  update(dt) {
    const B = this.B, F = this.F;
    this.t += dt;
    this.hurt = Math.max(0, this.hurt - F.rdt * 2);
    this.hpShown = damp(this.hpShown, this.hp, 6, F.rdt);
    this.rage = damp(this.rage, this.phase >= 3 ? 1 : 0, 2, dt);
    this.shieldK = damp(this.shieldK, this.shield ? 1 : 0, 6, dt);
    if (this.phaseCard) { this.phaseCard.t += F.rdt; if (this.phaseCard.t > 1.8) this.phaseCard = null; }
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
      if (this.stageT <= 0) { this.stage = 'fight'; if (this.phase === 2) this.shieldT = 1.2; }
      return 'hold';
    }
    // phase changes: the health stops at the notch, the beat and stun end, the boss roars
    const next = this.phase === 1 && this.hp <= PHASE_AT[0] ? 2 : this.phase === 2 && this.hp <= PHASE_AT[1] ? 3 : 0;
    if (next) {
      B.progress = 1 - PHASE_AT[next - 2] + 0.002;
      this.shield = null;
      B.stunT = 0; B.beat = null; B.lunge = null;
      this.phase = next;
      this.stage = 'phase'; this.stageT = 1.7;
      this.phaseCard = { t: 0, n: next };
      this.fish.feel('angry', 3); this.fish.say('anger', 1.5);
      F.onBossPhase?.(this.def, next);
      return 'hold';
    }
    // shields (phase 2+): up every so often, until a shock cracks it
    if (this.phase >= 2) {
      if (this.shield) {
        this.shield.t += dt;
        if (B.charges <= 0 && this.shield.t > 1.4 && !this.shield.gift) { this.shield.gift = true; B.charges = 1; B.shockCd = 0; F.onShockReady?.(); }
        if (this.shield.t > 16) this.dropShield(false);
      } else if (!B.stunned && !B.beat) {
        this.shieldT -= dt;
        if (this.shieldT <= 0) this.raiseShield();
      }
    }
    // ink on the lens (bosses that have it), phase 2+
    if (this.phase >= 2 && (this.def.attacks || []).includes('ink')) {
      this.inkT -= dt;
      if (this.inkT <= 0) {
        this.inkT = rng.float(11, 15);
        F.inkSplat?.(2 + this.phase, { big: true, life: 6 });
        F.particles.ink?.(this.fish.x, this.fish.y, 16, { power: 1.5, scale: 1.5, color: '#140a22' });
        F.onBossAttack?.('ink');
      }
    }
    return null;
  }

  raiseShield() {
    const F = this.F;
    this.shield = { t: 0, gift: false };
    F.sfx('neon_buzz', { vol: 0.6, pitch: 0.6 });
    F.sfx('grunt', { vol: 0.6, pitch: 0.6 });
    F.popOver?.('SHIELD UP! SHOCK IT!', 'aqua', 3);
    F.shake(4);
    this.fish.feel('smug', 2);
    F.onBossAttack?.('shield');
  }

  dropShield(broken) {
    const F = this.F, f = this.fish;
    this.shield = null;
    this.shieldT = rng.float(8, 11) * (1.1 - (this.phase - 2) * 0.12);
    if (broken) {
      F.sfx('glass_crack', { vol: 0.8 }); F.sfx('ice_crack', { vol: 0.5 });
      F.particles.pixelBurst?.('shard', f.x, f.y, 18, { ramp: 'cyan', speed: [80, 220] });
      F.popOver?.('SHIELD BROKEN!', 'aqua', 3);
      F.shake(8);
      this.hurt = 1;
    }
  }

  // the Battle landed a shock
  onShock(grade) {
    this.hurt = 1;
    if (this.shield) this.dropShield(true);
    if (grade === 'perfect') this.F.onBossCrit?.(this.def, this.weakPoint());
  }

  // ---------------------------------------------------------------- drawing
  drawWorld(ctx) {
    const F = this.F, f = this.fish;
    drawBossAura(ctx, F, f, this.def, 1, this.t, this.rage);
    if (this.shieldK > 0.02) drawShield(ctx, F, f, this.shieldK, this.t);
  }

  drawHud(ctx) {
    const F = this.F, W = F.W, t = this.t;
    if (this.stage === 'intro') this.drawIntroCard(ctx, this.cardT);
    // ---- the boss bar: slim glass bar at the top, the boss's own 3D model as its badge, its name in 3D voxels
    const show = this.stage === 'intro' ? clamp01((this.cardT - 2.4) * 3) : 1;
    if (show > 0.01) {
      const S = Math.max(1, F.H / 540);
      const bw = Math.round(Math.min(W * 0.5, 460 * S)), bh = Math.round(12 * S);
      const bx = Math.round(W / 2 - bw / 2), by = Math.round(30 * S - (1 - ease.outBack(show)) * 70);
      ctx.save();
      ctx.globalAlpha = show;
      const col = this.shield ? '#9ad8ff' : this.rage > 0.5 ? '#ff5a4a' : this.phase === 2 ? '#ff9d2e' : '#ff4f7a';
      drawAeroBar(ctx, bx, by, bw, bh, Math.max(this.hpShown, this.hp), { color: '#ffffff' });
      drawAeroBar(ctx, bx, by, bw, bh, this.hp, { color: col });
      for (const p of PHASE_AT) {
        const nx = Math.round(bx + 1 + (bw - 2) * p);
        ctx.fillStyle = INK; ctx.fillRect(nx - 1, by - 2, 3, bh + 4);
        ctx.fillStyle = '#ffffff'; ctx.fillRect(nx, by - 1, 1, bh + 2);
      }
      if (this.hurt > 0.3 && Math.floor(t * 20) % 2) { ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fillRect(bx, by, bw, bh); }
      const ic = voxelFishIcon(this.def.id, Math.round(46 * S), Math.round(30 * S), { dir: 1 });
      if (ic) ctx.drawImage(ic, bx - ic.width - 4, Math.round(by + bh / 2 - ic.height / 2 + Math.sin(t * 3) * 1.5));
      for (let i = 0; i < 3; i++) {
        const g = gemIcon(i < this.phase ? (i === 2 ? '#ff4f5e' : '#ffd23a') : '#5a6a7c', Math.round(12 * S));
        if (g) ctx.drawImage(g, bx + bw + 4 + i * Math.round(13 * S), Math.round(by + bh / 2 - g.height / 2));
      }
      const tag = this.shield ? 'SHIELDED' : this.phase >= 3 ? 'WEAK POINT: CRITS x1.6' : '';
      word3D(ctx, this.def.title, W / 2, by + bh + Math.round(14 * S), { t, scale: 0.6 * S, pal: this.rage > 0.5 ? 'red' : 'white', wobble: 0.6 });
      if (tag) word3D(ctx, tag, W / 2, by + bh + Math.round(34 * S), { t: t + 1, scale: 0.42 * S, pal: this.shield ? 'aqua' : 'sun', wobble: 0.5, alpha: 0.75 + 0.25 * Math.sin(t * 6) });
      ctx.restore();
    }
    if (this.phaseCard) this.drawPhaseCard(ctx, this.phaseCard);
  }

  // The intro mini cutscene's titles: "BOSS" slams in, then the name drops in as big 3D voxel letters, the
  // subtitle sways in under it. (The camera pan, slow-mo, roar and shake come from Fishing.updateFight / onBossIntro.)
  drawIntroCard(ctx, ct) {
    const F = this.F, W = F.W, H = F.H, def = this.def;
    const out = clamp01((this.introDur - ct) * 3);
    if (out <= 0.01) return;
    ctx.save();
    // a soft dark vignette pulls the eye to the boss
    ctx.globalAlpha = 0.55 * out * clamp01(ct * 2);
    for (let i = 0; i < 24; i++) {
      const k = 1 - i / 24;
      ctx.fillStyle = rgba('#020a14', k * k * 0.9);
      ctx.fillRect(0, H * 0.12 + i * 3, W, 3); ctx.fillRect(0, H * 0.88 - i * 3 - 3, W, 3);
    }
    ctx.globalAlpha = out;
    // the title never covers the boss: the top third when the boss sits low, else below it
    const [, bsy] = F.toScreen(this.fish.x, this.fish.y);
    const bh = F.fishLen() * F.zoom() * 0.24;
    const top = Math.round(H * 0.11) + 70, bottom = Math.round(H * 0.89) - 64;
    let cy = Math.min(Math.round(H * 0.27), Math.round(bsy - bh - 70));
    if (cy < top) cy = Math.max(Math.round(bsy + bh + 72), top);
    cy = Math.min(cy, bottom);
    if (ct > 0.5) {
      const bt = ct - 0.5;
      word3D(ctx, 'BOSS', W / 2, cy - 54, { t: bt, pop: clamp01(bt * 4), scale: lerp(4, 1.3, ease.outBack(clamp01(bt * 4))), pal: 'red', rot: Math.sin(bt * 4) * 0.06 });
    }
    if (ct > 0.9) {
      const nt = ct - 0.9;
      const sc = clamp(W / (def.title.length * 34), 1.4, 2.6);
      const landed = letters3D(ctx, def.title, W / 2, cy, nt, { pal: this.palette, scale: sc, stagger: 0.05, drop: 180 });
      for (const [lx, ly, i] of landed) {
        if (this.landed.has(i)) continue;
        this.landed.add(i);
        F.fx.pixelBurst?.('sparkle', lx, ly + 18, 3, { ramp: def.color, layer: 'fg', size: 0 });
        if (i % 2 === 0) F.sfx('mash_pop', { pitch: 0.7 + i * 0.03, vol: 0.4 });
      }
    }
    // [voices23] the boss growls its subtitle in the deep, distorted 8-bit boss voice
    if (ct > 1.7 && !this.growled) { this.growled = true; try { F.game?.audio?.babble?.(def.sub || def.title, 'boss'); } catch { /* optional */ } }
    if (ct > 1.7) word3D(ctx, def.sub, W / 2, cy + 52, { t: ct, pop: clamp01((ct - 1.7) * 4), scale: 0.75, pal: 'white', wobble: 0.8 });
    ctx.restore();
  }

  drawPhaseCard(ctx, pc) {
    const F = this.F, W = F.W, H = F.H;
    const a = clamp01((1.8 - pc.t) * 3);
    ctx.save();
    ctx.globalAlpha = a;
    letters3D(ctx, 'PHASE ' + pc.n, W / 2, Math.round(H * 0.3), pc.t, { pal: pc.n >= 3 ? 'red' : 'sun', scale: 2.2, stagger: 0.04, drop: 90 });
    ctx.restore();
  }

}

// The boss's shield: a steel-blue outline hugging its silhouette and glossy pixel armour plates (tiny voxel hexes)
// orbiting it on a flat ellipse, with a shimmer running across. No rings or circles.
const PLATE = new Map();
function plateSprite(s) {
  let c = PLATE.get(s);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = c.height = s * 2 + 3;
  const g = c.getContext('2d');
  const C = s + 1;
  for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
    const dx = Math.abs(x - C), dy = Math.abs(y - C);
    const inside = dx <= s && dy <= s * 0.87 && dx * 0.5 + dy * 0.87 <= s * 0.87; // a hexagon
    if (!inside) continue;
    const edge = dx >= s - 1 || dy >= s * 0.87 - 1 || dx * 0.5 + dy * 0.87 >= s * 0.87 - 1;
    g.fillStyle = edge ? INK : y < C - 1 ? (x < C ? '#ffffff' : '#d8f4ff') : y < C + 1 ? '#9ad8ff' : '#4fa8e8';
    g.fillRect(x, y, 1, 1);
  }
  PLATE.set(s, c);
  return c;
}

export function drawShield(ctx, F, f, k, t) {
  if (!f || !f.c) return;
  const len = F.fishLen(f);
  try {
    const base = f.rigState({ silhouette: '#9ad8ff' });
    ctx.save();
    ctx.globalAlpha = 0.85 * k;
    const o = 2;
    for (const [dx, dy] of [[-o, 0], [o, 0], [0, -o], [0, o]]) drawFishRig(ctx, f.c, { ...base, x: base.x + dx, y: base.y + dy });
    ctx.globalAlpha = 1;
    f.anchors = drawFishRig(ctx, f.c, f.rigState({ wash: { color: '#bfe8ff', alpha: 0.28 * k } }));
    ctx.restore();
  } catch (e) { /* silhouettes unsupported */ }
  // honeycomb armour plates over the body (a shimmer band sweeps across them)
  const s = Math.max(3, Math.round(len * 0.035));
  const spr = plateSprite(s);
  const rx = len * 0.46, ry = len * 0.17, dx = s * 1.8, dy = s * 1.6;
  const sweep = ((t * 0.6) % 1.6) - 0.3;
  ctx.save();
  for (let j = -Math.ceil(ry / dy); j <= Math.ceil(ry / dy); j++) {
    for (let i = -Math.ceil(rx / dx); i <= Math.ceil(rx / dx); i++) {
      const x = i * dx + (j % 2 ? dx / 2 : 0), y = j * dy;
      const e = (x / rx) ** 2 + (y / ry) ** 2;
      if (e > 1) continue;
      const u = (x / rx + 1) / 2;
      const lit = Math.abs(u - sweep) < 0.12;
      ctx.globalAlpha = k * (lit ? 0.95 : 0.45 + 0.2 * (1 - e));
      ctx.drawImage(spr, Math.round(f.x + x - s - 1), Math.round(f.y + y - s - 1));
    }
  }
  ctx.restore();
  if (rng.chance(0.3 * k)) F.particles.pixel?.('sparkle', f.x + rng.float(-rx, rx), f.y + rng.float(-ry, ry), { ramp: 'cyan', life: 0.4, size: 0 });
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
    if (rw.aero) { g.addCoins?.(rw.aero, F.W / 2, F.H * 0.5); items.push({ kind: 'aero', label: '+' + rw.aero.toLocaleString('en-US') }); }
    if (rw.chest) { ITEMS.addItem(st, rw.chest, 1); items.push({ kind: 'chest', id: rw.chest, label: 'Chest' }); }
    if (first) { rec.trophies[def.id] = Date.now(); items.push({ kind: 'trophy', label: 'Trophy' }); }
    if (rw.recipe) { grantUnlock(st, 'recipe', rw.recipe); g.emit?.('unlocked', { kind: 'recipe', id: rw.recipe, free: true }); items.push({ kind: 'recipe', id: rw.recipe, label: 'Recipe' }); }
    if (rw.rod) { giveRod(st, rw.rod); items.push({ kind: 'rod', id: rw.rod, label: 'New Rod' }); }
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
    this.landed = new Set();
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
    this.items.forEach((it, i) => {
      if (!it.popped && this.t > 1.6 + i * 0.35) {
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
    const F = this.F, n = this.items.length, gap = 100;
    return [Math.round(F.W / 2 - ((n - 1) * gap) / 2 + i * gap), Math.round(F.H * 0.52)];
  }

  draw(ctx) {
    const F = this.F, W = F.W, H = F.H, t = this.t, def = this.def;
    const a = clamp01(t * 3) * clamp01((this.dur - t) * 2);
    if (a <= 0.01) return;
    ctx.save();
    ctx.globalAlpha = a;
    const landed = letters3D(ctx, 'VICTORY!', W / 2, Math.round(H * 0.22), t, { pal: 'sun', scale: W < 700 ? 2.2 : 2.8, stagger: 0.07 });
    for (const [lx, ly, i] of landed) {
      if (this.landed.has(i)) continue;
      this.landed.add(i);
      F.fx.pixelBurst?.('star', lx, ly + 24, 4, { ramp: 'gold', layer: 'fg', speed: [40, 110] });
      F.sfx('mash_pop', { pitch: 1 + i * 0.07, vol: 0.5 });
    }
    if (t > 1) word3D(ctx, (this.first ? 'BOSS DEFEATED' : 'DEFEATED AGAIN'), W / 2, Math.round(H * 0.34), { t, pop: clamp01((t - 1) * 4), scale: 0.95, pal: def.color === '#ffd23a' ? 'sun' : 'white' });
    // [polish17] a deep glass voxel plate behind the reward row so the icons and labels read over the busy scene
    // (the boat sits right there at the surface)
    if (this.items.length && this.items[0].popped) {
      const n = this.items.length, [x0, y0] = this.chipPos(0);
      const pw = Math.round((n - 1) * 100 + 96), ph = 96, pk = ease.outBack(clamp01((t - 1.5) * 4));
      const plate = aeroCached(`bossrw|${pw}|${ph}`, () => aeroSurface(pw, ph, { tone: 'deep', a: [0.78, 0.86], r: 12, gloss: 0.4, glossH: 30, curve: 2, rim: 0.9, glow: 0.5, depth: 2, block: 4 }));
      const sw = Math.max(1, Math.round(pw * pk)), sh = Math.max(1, Math.round(ph * pk));
      ctx.drawImage(plate, Math.round(x0 - 48 + (pw - sw) / 2), Math.round(y0 - 40 + (ph - sh) / 2), sw, sh);
    }
    // the rewards: spinning 3D objects on a glow, each with a small 3D label
    this.items.forEach((it, i) => {
      if (!it.popped) return;
      const [x, y] = this.chipPos(i);
      const pk = ease.outBack(clamp01((t - 1.6 - i * 0.35) * 4));
      const bob = Math.round(Math.sin(t * 3 + i) * 3);
      drawGlow(ctx, x, y + bob, 34, it.kind === 'trophy' ? '#fff2b8' : '#bff8ff', 0.45 * pk);
      ctx.save();
      ctx.translate(x, y + bob);
      ctx.scale(pk, pk);
      drawRewardIcon(ctx, it, 0, 0, t + i);
      ctx.restore();
      word3D(ctx, it.label, x, y + 40, { t: t + i, pop: pk, scale: 0.55, pal: 'white', wobble: 0.6 });
    });
    ctx.restore();
  }
}

function drawRewardIcon(ctx, it, x, y, t) {
  if (it.kind === 'aero') { drawAeroCoin(ctx, x, y, 16, t); return; }
  if (it.kind === 'trophy') { drawIcon3d(ctx, 'trophy', x, y, 52, Math.sin(t * 1.5)); return; }
  if (it.kind === 'chest') { drawIcon3d(ctx, chestIconId(it.id), x, y, 50, Math.sin(t * 1.5)); return; }
  const rod = ROD_BY_ID[it.kind === 'rod' ? it.id : String(it.id).replace(/^ws_rod_/, '')];
  const ic = rod ? rodIcon(rod, 52) : null;
  if (ic) ctx.drawImage(ic, Math.round(x - ic.width / 2), Math.round(y - ic.height / 2));
}

// The trophy as a 3D model (the catch card shows it for a first boss win).
export function drawTrophy(ctx, x, y, t = 0, px = 40) { return drawIcon3d(ctx, 'trophy', x, y, px, Math.sin(t * 1.5)); }
