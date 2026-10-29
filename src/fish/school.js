// Ocean population manager: weighted spawning per biome/time/weather/bait, despawning, depth-sorted drawing.
// Presence: ocean fish are scaled up (small species most), schools are larger, giant individuals are more
// common, and every so often a huge "hero" fish (or a whole school of them) cruises through the mid/far
// layers as scenery (not catchable). Some fish carry a package crate (build/items.js rollPackage):
// fish.package and fish.rec.package, so the catch record carries it to game.onFishCaught.

import { rng } from '../core/rng.js';
import { clamp, lerp } from '../core/math.js';
import { RARITY } from '../core/color.js';
import { SPECIES } from './species.js';
import { Fish, baitInterest } from './fish.js';
import { rollIndividual } from './traits.js';
import { rollPackage } from '../build/items.js';

// On-screen size multiplier for ocean fish by look length (look px): small fish grow most.
export function presenceOf(sp) {
  const l = sp.look || {};
  if (l.kind === 'chain') return 1.45;
  const len = Math.max(l.body?.len || 30, (l.body?.h || 20) * 0.9);
  const k = clamp(1.95 - (len - 28) * 0.0125, 1.22, 1.95);
  return sp.rarity === 'legendary' ? Math.min(k, 1.3) : k;
}

const HERO_MIN_LEN = 40;

export class School {
  constructor(world) {
    this.world = world;
    this.fishes = [];
    this.spawnT = 0.5;
    this.target = 10;
    this.heroT = rng.float(14, 30);
    world.fishes = this.fishes;
    if (typeof window !== 'undefined') window.__school = this;
  }

  clear() {
    this.fishes.length = 0;
  }

  speciesPool() {
    const w = this.world;
    return SPECIES.filter((s) => s.biome === w.biome && !s.spawn?.never);
  }

  weightOf(sp) {
    const w = this.world;
    const spawn = sp.spawn || {};
    let wt = (RARITY[sp.rarity]?.weight ?? 10) * (spawn.weight ?? 1);
    const night = w.night;
    if (sp.activity === 'night') wt *= night ? 2.2 : 0.15;
    if (sp.activity === 'day') wt *= night ? 0.2 : 1.3;
    if (sp.activity === 'dusk') wt *= w.dusk ? 3 : 0.4;
    if (spawn.weather && !spawn.weather.includes(w.weather)) wt *= 0.05;
    if (spawn.time && spawn.time !== (night ? 'night' : 'day')) wt *= 0.1;
    if (spawn.hidden && !w.secrets?.[spawn.hidden]) wt = 0;
    const bait = w.hook?.bait;
    if (spawn.requires) {
      if (!bait || bait.type !== spawn.requires) return 0;
      wt *= 6;
    }
    if (bait) wt *= 0.6 + baitInterest(sp, bait) * 0.7;
    if (sp.rarity !== 'common') wt *= w.rarityBoost || 1;
    if (bait?.type === 'golden' && sp.rarity !== 'common') wt *= 2.5;
    if (bait?.type === 'blackhole' && (sp.rarity === 'rare' || sp.rarity === 'epic' || sp.rarity === 'legendary')) wt *= 2;
    // keep legendaries special: at most one around (heroes do not count)
    if (sp.rarity === 'legendary' && this.fishes.some((f) => f.sp === sp && !f.hero)) wt = 0;
    return wt;
  }

  pickSpecies() {
    const pool = this.speciesPool().map((s) => ({ s, w: this.weightOf(s) })).filter((e) => e.w > 0);
    if (!pool.length) return null;
    return rng.weighted(pool).s;
  }

  spawn(sp, opts = {}) {
    const w = this.world;
    const rec = opts.rec || rollIndividual(sp, { giantChance: 0.04, ...(w.rollMods || {}) });
    const fromFog = opts.fromFog ?? rng.chance(0.45);
    const fish = new Fish(rec, sp, w, { fadeIn: true });
    fish.scale *= presenceOf(sp);
    const [d0, d1] = sp.move?.depth || [0.15, 0.85];
    const top = (w.surfaceY ?? 0) + 20;
    if (opts.x !== undefined) {
      fish.x = opts.x; fish.y = opts.y; fish.z = opts.z ?? 0.3;
    } else if (fromFog || sp.move?.style === 'crawl') {
      fish.x = rng.float(60, w.W - 60);
      fish.z = sp.move?.style === 'crawl' ? rng.float(0, 0.3) : rng.float(0.75, 1);
      fish.y = lerp(top, w.floorAt(fish.x, fish.z) - 10, rng.float(d0, d1));
      if (sp.move?.style === 'crawl') fish.x = rng.chance(0.5) ? -20 : w.W + 20;
    } else {
      const left = rng.chance(0.5);
      fish.x = left ? -40 : w.W + 40;
      fish.z = rng.float(0, 0.7);
      fish.y = lerp(top, w.floorAt(fish.x, fish.z) - 10, rng.float(d0, d1));
      fish.facing = left ? 1 : -1;
      fish.turn = fish.facing;
      fish.setState('enter');
      fish.enterTarget = { x: left ? rng.float(80, w.W * 0.6) : rng.float(w.W * 0.4, w.W - 80), y: fish.y };
    }
    fish.life = rng.float(70, 200);
    if (!opts.noPackage) {
      const pkg = rollPackage(sp, w.biome);
      if (pkg) { fish.package = pkg; fish.rec.package = pkg; }
    }
    this.fishes.push(fish);
    return fish;
  }

  // A huge scenery fish (or a small school of them) crossing the mid/far layers.
  spawnHero(sp = null) {
    const w = this.world;
    if (!sp) {
      const pool = this.speciesPool().filter((s) => {
        const l = s.look || {};
        if (l.kind === 'chain' || s.spawn?.requires || s.spawn?.hidden) return false;
        if (s.move?.style === 'crawl' || s.move?.style === 'hop') return false;
        if ((s.quirks || []).some((q) => q === 'intro' || q === 'mimic' || q === 'commuter' || q === 'thief')) return false;
        return Math.max(l.body?.len || 0, (l.body?.h || 0) * 0.8) >= HERO_MIN_LEN || s.move?.school > 0.4;
      });
      if (!pool.length) return null;
      sp = rng.weighted(pool.map((s) => ({ s, w: (s.look.body?.len || 40) * (s.rarity === 'legendary' ? 0.6 : 1) * (s.activity === 'night' && !w.night ? 0.3 : 1) }))).s;
    }
    const len = Math.max(sp.look.body?.len || 40, (sp.look.body?.h || 30) * 0.8);
    const left = rng.chance(0.5);
    const z = rng.float(0.7, 0.9);
    const school = sp.move?.school > 0.4;
    const n = school ? rng.int(3, 5) : 1;
    // on-screen body length: a single hero ~200-290 px, a school of big fish ~95-140 px each
    const want = school ? rng.float(95, 140) : rng.float(200, 290);
    const scale = want / len / (1 - z * 0.5);
    const top = (w.surfaceY ?? 0) + 40;
    const y0 = lerp(top + want * 0.3, w.floorAt(w.W / 2, z) - want * 0.35, rng.float(0.1, 0.5));
    const out = [];
    for (let i = 0; i < n; i++) {
      const rec = rollIndividual(sp, { mutationChance: 0, shinyChance: 0, giantChance: 0, patternChance: 0 });
      const f = new Fish(rec, sp, w, { fadeIn: true });
      f.hero = true;
      f.scale = scale * rng.float(0.85, 1.1);
      const lead = (i === 0 ? 0 : rng.float(0.4, 1.6)) * want;
      f.x = left ? -want * 0.7 - lead : w.W + want * 0.7 + lead;
      f.y = y0 + (i === 0 ? 0 : rng.float(-0.45, 0.45) * want);
      f.z = clamp(z + rng.float(-0.04, 0.04), 0.67, 0.94);
      f.facing = left ? 1 : -1;
      f.turn = f.facing;
      f.cooldown = 1e9;
      f.passTarget = { x: left ? w.W + want * 2 : -want * 2, y: f.y + rng.float(-30, 30) };
      f.passSpeed = rng.float(26, 40) * (school ? 1.3 : 1);
      f.setState('pass');
      f.life = 1e9;
      this.fishes.push(f);
      out.push(f);
    }
    return out;
  }

  update(dt) {
    const w = this.world;
    this.target = Math.round((w.lowPower ? 7 : 14) * (w.populationMul || 1));
    this.spawnT -= dt;
    const active = this.fishes.filter((f) => f.state !== 'leave' && !f.hero).length;
    if (this.spawnT <= 0 && active < this.target && w.spawning !== false) {
      const sp = this.pickSpecies();
      if (sp) {
        const n = sp.move?.school > 0.4 ? rng.int(3, 6) : 1;
        const lead = this.spawn(sp);
        for (let i = 1; i < n; i++) this.spawn(sp, { x: lead.x + rng.float(-40, 40), y: lead.y + rng.float(-26, 26), z: lead.z, fromFog: false });
      }
      this.spawnT = active < this.target * 0.5 ? rng.float(0.5, 1.5) : rng.float(2.5, 6);
    }
    // heroes: one at a time, not in low-power mode
    this.heroT -= dt;
    if (this.heroT <= 0) {
      this.heroT = rng.float(40, 85);
      if (!w.lowPower && w.spawning !== false && w.heroes !== false && !this.fishes.some((f) => f.hero)) this.spawnHero();
    }
    for (const f of this.fishes) {
      f.update(dt);
      if (!f.controlled && !f.hero && f.state !== 'leave' && f.age > f.life && f.state !== 'sniff' && f.state !== 'interest' && !f.posing) f.setState('leave');
    }
    for (let i = this.fishes.length - 1; i >= 0; i--) {
      const f = this.fishes[i];
      if (f.dead) {
        if (f.carry) w.desktop?.returnIcon?.(f.carry, true);
        this.fishes.splice(i, 1);
      }
    }
  }

  sorted() {
    return this.fishes.slice().sort((a, b) => b.z - a.z);
  }

  remove(fish) {
    const i = this.fishes.indexOf(fish);
    if (i >= 0) this.fishes.splice(i, 1);
  }
}

export function fogFor(z, base) {
  return clamp(z * base, 0, 0.85);
}
