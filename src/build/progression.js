// Phase 8 progression glue (OWNER: Progression agent). installProgression(game) -> game.prog, and sets game.dest.
//   update(dt, inp)  every frame: Workshop craft queue, rod-perk context (deep zones), the Magnet rod pulling
//                    floating boxes toward the hook, stats refresh when the equipped rod / tackle changes,
//                    and the destination scene (src/world/destinations.js)
//   draw(ctx, dt)    the destination scene (screen space; game.js draws it under the HUD and panels)
//   hit(x, y)        true while a destination scene covers the screen (game.js routes input to 'dest')
//   command(id)      'workshop' | 'lab' quick access ("sail there instantly": opens the panel)
//   onCatch(sp, rec) -> [{id, qty}]  fish parts from a catch (called by src/build/build.js onCatch)
import { rng } from '../core/rng.js';
import { Destinations } from '../world/destinations.js';
import { wsTick, ensureWorkshop } from './workshop.js';
import { setRodContext, hasPerk, ensureRods } from '../game/rods.js';
import { addItem } from './items.js';

const DEEP = new Set(['twilight', 'midnight', 'abyss']);
const BIOME_MAT = { oscean: 'clover_leaf', shallows: 'clover_leaf', fjord: 'ice_shard', junkyard: 'spring_coil', metropolis: 'magnet_stone', volcano: 'lava_glass', abyss: 'glow_bulb' };

export class Progression {
  constructor(game) {
    this.game = game;
    this.dest = new Destinations(game);
    this.pollT = 0;
    this.rodKey = '';
    try { ensureWorkshop(game.state); } catch { /* ignore */ }
  }

  update(dt, inp) {
    const g = this.game;
    try { wsTick(g); } catch (e) { if (!this.wsErr) { this.wsErr = true; console.error(e); } }
    this.pollT -= dt;
    if (this.pollT <= 0) {
      this.pollT = 0.5;
      let deep = false;
      try { deep = DEEP.has(g.ocean?.depthZone?.()?.id); } catch { deep = false; }
      if (deep !== this.deep) { this.deep = deep; setRodContext({ deep }); if (g.fishing) g.fishing.rodC = null; }
      const R = ensureRods(g.state);
      const key = R.equipped + '|' + JSON.stringify(R.tackle.on) + '|' + (R.lv[R.equipped] || 0);
      if (key !== this.rodKey) { this.rodKey = key; try { g.recomputeStats?.(); } catch { /* ignore */ } if (g.fishing) g.fishing.rodC = null; }
    }
    this.magnet(dt);
    this.dest.update(dt, inp);
  }

  // Magnet rod: floating boxes near the hook drift toward it (and into the near plane), with a sparkle trail.
  magnet(dt) {
    const g = this.game;
    if (!hasPerk(g.state, 'magnet') || g.state.view !== 'ocean' || this.dest.active) return;
    const h = g.fishing?.hook, list = g.floaters?.list;
    if (!h?.visible || !list?.length || g.fishing?.fighting) return;
    for (const f of list) {
      if (f.hooked || f.out) continue;
      const dx = h.x - f.x, dy = h.y - f.y, d = Math.hypot(dx, dy);
      if (d > 220 || d < 6) continue;
      const k = (1 - d / 220) * 46 * dt;
      f.x += (dx / d) * k;
      if (!f.surface && Number.isFinite(f.y0)) f.y0 += (dy / d) * k;
      if (f.z > 0) f.z = Math.max(0, f.z - dt * 0.15);
      f.age = Math.max(0, (f.age || 0) - dt * 0.5);
      if (rng.chance(dt * 6)) g.particles?.sparkle?.(f.x + rng.float(-6, 6), f.y + rng.float(-6, 6), '#ff8a8a');
    }
  }

  draw(ctx, dt) { this.dest.draw(ctx, dt); }
  hit() { return this.dest.hit(); }
  command(id) { return this.dest.quick(id); }

  // Fish parts from a catch: scales from most fish, fin ribbons from uncommon+, glow bulbs from the deep.
  onCatch(sp, rec) {
    const st = this.game.state, out = [];
    const give = (id, q = 1) => { addItem(st, id, q); out.push({ id, qty: q }); };
    const r = sp?.rarity || rec?.rarity || 'common';
    const ri = ['common', 'uncommon', 'rare', 'epic', 'legendary'].indexOf(r);
    if (rng.chance(0.65)) give('fish_scale', 1 + (ri >= 2 ? 1 : 0));
    if (ri >= 1 && rng.chance(0.25 + ri * 0.12)) give('fin_ribbon', 1);
    let deep = false;
    try { deep = DEEP.has(this.game.ocean?.depthZone?.()?.id); } catch { deep = false; }
    const biome = this.game.ocean?.biome?.id;
    if ((deep || biome === 'abyss') && rng.chance(0.22 + ri * 0.1)) give('glow_bulb', 1);
    // each ocean's own Workshop material now and then
    const local = BIOME_MAT[biome];
    if (local && local !== 'glow_bulb' && rng.chance(0.1 + ri * 0.04)) give(local, 1);
    // the deep zones: fish sometimes come up clutching a chest
    let zone = null;
    try { zone = this.game.ocean?.depthZone?.()?.id || null; } catch { zone = null; }
    const zi = ['sunlit', 'twilight', 'midnight', 'abyss'].indexOf(zone);
    if (zi >= 1 && rng.chance(0.03 + zi * 0.025 + ri * 0.01)) {
      const tier = zi >= 3 && rng.chance(0.25) ? 'orb' : zi >= 2 && rng.chance(0.45) ? 'golden' : 'iron';
      give('pkg_' + tier, 1);
      setTimeout(() => this.game.toast?.('It was hugging a chest! Check your Satchel.', 'star', 4), 1600);
    }
    return out;
  }
}

export function installProgression(game) {
  const p = new Progression(game);
  game.dest = p.dest;
  return p;
}
