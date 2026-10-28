// Ocean population manager: weighted spawning per biome/time/weather/bait, despawning, depth-sorted drawing.

import { rng } from '../core/rng.js';
import { clamp, lerp } from '../core/math.js';
import { RARITY } from '../core/color.js';
import { SPECIES } from './species.js';
import { Fish, baitInterest } from './fish.js';
import { rollIndividual } from './traits.js';

export class School {
  constructor(world) {
    this.world = world;
    this.fishes = [];
    this.spawnT = 0.5;
    this.target = 10;
    world.fishes = this.fishes;
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
    // keep legendaries special: at most one around
    if (sp.rarity === 'legendary' && this.fishes.some((f) => f.sp === sp)) wt = 0;
    return wt;
  }

  pickSpecies() {
    const pool = this.speciesPool().map((s) => ({ s, w: this.weightOf(s) })).filter((e) => e.w > 0);
    if (!pool.length) return null;
    return rng.weighted(pool).s;
  }

  spawn(sp, opts = {}) {
    const w = this.world;
    const rec = opts.rec || rollIndividual(sp, w.rollMods || {});
    const fromFog = opts.fromFog ?? rng.chance(0.45);
    const fish = new Fish(rec, sp, w, { fadeIn: true });
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
      fish.setState('enter');
      fish.enterTarget = { x: left ? rng.float(80, w.W * 0.6) : rng.float(w.W * 0.4, w.W - 80), y: fish.y };
    }
    fish.life = rng.float(70, 200);
    this.fishes.push(fish);
    return fish;
  }

  update(dt) {
    const w = this.world;
    this.target = Math.round((w.lowPower ? 6 : 11) * (w.populationMul || 1));
    this.spawnT -= dt;
    const active = this.fishes.filter((f) => f.state !== 'leave').length;
    if (this.spawnT <= 0 && active < this.target && w.spawning !== false) {
      const sp = this.pickSpecies();
      if (sp) {
        const n = sp.move?.school > 0.4 ? rng.int(2, 4) : 1;
        const lead = this.spawn(sp);
        for (let i = 1; i < n; i++) this.spawn(sp, { x: lead.x + rng.float(-30, 30), y: lead.y + rng.float(-20, 20), z: lead.z, fromFog: false });
      }
      this.spawnT = active < this.target * 0.5 ? rng.float(0.5, 1.5) : rng.float(2.5, 6);
    }
    for (const f of this.fishes) {
      f.update(dt);
      if (!f.controlled && f.state !== 'leave' && f.age > f.life && f.state !== 'sniff' && f.state !== 'interest' && !f.posing) f.setState('leave');
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
