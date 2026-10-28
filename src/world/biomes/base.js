// Biome base class. Concrete biomes (shallows/junkyard/abyss) override the draw/build hooks.
//
// Contract used by the game (see docs/ARCHITECTURE.md "Biomes"):
//   build(W, H)                      regenerate static layers for this screen size (deterministic)
//   baseSurface(H) -> y | null       water surface at normal level (null = no surface, e.g. abyss)
//   floorAt(x) -> y                  seabed height in screen space
//   update(dt, env)                  animate (env: see Ocean.env)
//   drawBack(ctx, env)               sky, surface, water body, far/mid parallax, god rays, giant silhouettes
//   drawSeabed(ctx, env)             terrain, props, animated decor, caustics
//   drawFront(ctx, env)              foreground motes/snow/rain/fog that sit above fish
//   lighting(env) -> {dark, tint, lights:[{x,y,r,color,a}]}  darkness pass (0 = none)
//   weathers: [{id, name, weight}]   weather states for this biome
//   secretAt(x, y) -> id | null      clickable hidden spots; onSecret(id, game) reacts
//   ambient: audio ambience id;  music: audio track id;  title / subtitle for the travel card

import { lerp } from '../../core/math.js';

export class Biome {
  constructor(ocean) {
    this.ocean = ocean;
    this.game = ocean.game;
    this.id = 'base';
    this.name = 'Ocean';
    this.subtitle = '';
    this.music = 'shallows';
    this.W = 0; this.H = 0;
    this.weathers = [{ id: 'calm', name: 'Calm', weight: 1 }];
    this.floor = null;
  }

  build(W, H) {
    this.W = W; this.H = H;
    this.floor = new Float32Array(W + 1);
    for (let x = 0; x <= W; x++) this.floor[x] = H - 46 - Math.sin(x * 0.01) * 6;
  }

  baseSurface(H) { return Math.round(H * 0.12); }

  floorAt(x) {
    if (!this.floor) return this.H - 40;
    const i = Math.max(0, Math.min(this.W, Math.round(x)));
    return this.floor[i];
  }

  update(dt, env) {}

  drawBack(ctx, env) {
    const g = ctx.createLinearGradient(0, 0, 0, this.H);
    g.addColorStop(0, '#3fb6d8');
    g.addColorStop(1, '#0d4f7a');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.W, this.H);
  }

  drawSeabed(ctx, env) {
    ctx.fillStyle = '#e8cf95';
    for (let x = 0; x < this.W; x++) ctx.fillRect(x, Math.round(this.floor[x]), 1, this.H);
  }

  drawFront(ctx, env) {}

  lighting(env) {
    return { dark: lerp(0.55, 0, env.daylight), tint: '#1a2a5a', lights: [] };
  }

  secretAt() { return null; }
  onSecret() {}
}
