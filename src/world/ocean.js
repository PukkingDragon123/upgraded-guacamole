// Ocean manager: current biome, environment state (time, weather, flood), lighting pass and travel cinematics.

import { clamp, clamp01, lerp, damp, ease, dist } from '../core/math.js';
import { rng } from '../core/rng.js';
import { rgba, mix, hexToRgb } from '../core/color.js';
import { makeLayer, resizeLayer } from '../core/canvas.js';
import { drawText } from '../gfx/font.js';
import { BIOMES } from './biomes/index.js';

export class Ocean {
  constructor(game) {
    this.game = game;
    this.cache = {};
    this.biome = null;
    this.flood = 0; this.floodTarget = 0;
    this.weather = 'calm';
    this.weatherT = 0;
    this.light = makeLayer(16, 16);
    this.travelState = null;
    this.env = {
      daylight: 1, dusk: 0, night: false, weather: 'calm', time: 0, flood: 0, cursor: game.world.cursor,
      lantern: null, wind: 0, hour: 12, quality: 1,
    };
    this.reveal = 1; // 0 = plain wallpaper, 1 = full ocean (opening flood animation)
  }

  get W() { return this.game.screen.W; }
  get H() { return this.game.screen.H; }

  get(id) {
    let b = this.cache[id];
    if (!b) {
      const Cls = BIOMES[id] || BIOMES.shallows;
      b = new Cls(this);
      this.cache[id] = b;
    }
    if (b.W !== this.W || b.H !== this.H) b.build(this.W, this.H);
    return b;
  }

  setBiome(id) {
    this.biome = this.get(id);
    this.pickWeather(true);
    this.game.audio.setMusic(this.game.musicFor?.() ?? this.biome.music);
    this.game.audio.setAmbience(this.biome.ambient || id, { weather: this.weather, night: this.env.night });
  }

  onResize() {
    for (const b of Object.values(this.cache)) b.build(this.W, this.H);
    resizeLayer(this.light, this.W, this.H);
  }

  // ------------------------------------------------------------- environment
  surfaceY() {
    const b = this.biome;
    const base = b.baseSurface(this.H);
    if (base === null) return null;
    return Math.round(lerp(base, -6, ease.inOutCubic(clamp01(this.flood))));
  }

  floorAt(x, z = 0) { return this.biome.floorAt(x, z); }

  pickWeather(initial = false) {
    const ws = this.biome.weathers;
    const w = rng.weighted(ws, (x) => x.weight);
    if (!initial && w.id !== this.weather) this.game.toast?.(`Weather: ${w.name}`, w.icon || 'cloud');
    this.weather = w.id;
    this.weatherT = rng.float(150, 360);
    this.game.audio.setAmbience(this.biome.ambient || this.biome.id, { weather: this.weather, night: this.env.night });
  }

  weatherName() {
    return this.biome.weathers.find((w) => w.id === this.weather)?.name || 'Calm';
  }

  update(dt) {
    const g = this.game, clock = g.clock, e = this.env;
    e.time += dt;
    e.daylight = clock.daylight();
    e.dusk = clock.dusk();
    const night = clock.isNight();
    if (night !== e.night) {
      e.night = night;
      g.audio.setNight(night);
      g.audio.setAmbience(this.biome.ambient || this.biome.id, { weather: this.weather, night });
    }
    e.hour = clock.hour();
    e.weather = this.weather;
    this.weatherT -= dt;
    if (this.weatherT <= 0) this.pickWeather();
    this.flood = damp(this.flood, this.floodTarget, 0.8, dt);
    e.flood = this.flood;
    e.quality = g.lowPower ? 0.5 : 1;
    if (this.travelState) this.updateTravel(dt);
    this.biome.update(dt, e);
  }

  // Ambient light at a point (for fish wash).
  lightAt(x, y, L) {
    if (!L || L.dark < 0.02) return 1;
    let lit = 1 - L.dark;
    for (const l of L.lights) {
      const d = dist(x, y, l.x, l.y);
      if (d < l.r) lit += (1 - d / l.r) * (l.a ?? 1);
    }
    return clamp01(lit);
  }

  lighting() {
    const L = this.biome.lighting(this.env);
    const g = this.game;
    // the lantern hook (abyss) and glowing fish add light
    if (L.dark > 0.05) {
      const h = g.fishing.hook;
      if (h.visible && g.stats.lantern) L.lights.push({ x: h.x, y: h.y, r: 90, color: '#ffe8b0', a: 0.9 });
      else if (h.visible) L.lights.push({ x: h.x, y: h.y, r: 34, color: '#c8e8ff', a: 0.35 });
      for (const f of g.school.fishes) {
        if (f.quirks.has('glow') || f.quirks.has('lure')) {
          const a = f.anchors?.lure || [f.x, f.y];
          L.lights.push({ x: a[0], y: a[1], r: 40 + 20 * f.scale, color: f.sp.glowColor || '#7affea', a: 0.6 * (1 - f.z * 0.6) });
        }
      }
    }
    return L;
  }

  // Multiply darkness with additive light pools.
  applyLighting(ctx, L) {
    if (L.dark < 0.02) return;
    const lc = this.light;
    if (lc.w !== this.W || lc.h !== this.H) resizeLayer(lc, this.W, this.H);
    const g = lc.ctx;
    const [tr, tg, tb] = hexToRgb(L.tint || '#1a2440');
    const k = clamp01(L.dark);
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = `rgb(${Math.round(lerp(255, tr, k))},${Math.round(lerp(255, tg, k))},${Math.round(lerp(255, tb, k))})`;
    g.fillRect(0, 0, lc.w, lc.h);
    g.globalCompositeOperation = 'lighter';
    for (const l of L.lights) {
      const gr = g.createRadialGradient(l.x, l.y, 0, l.x, l.y, l.r);
      const [r, gg, b] = hexToRgb(l.color || '#ffffff');
      const a = (l.a ?? 1) * k;
      gr.addColorStop(0, `rgba(${r},${gg},${b},${a})`);
      gr.addColorStop(0.55, `rgba(${r},${gg},${b},${a * 0.45})`);
      gr.addColorStop(1, `rgba(${r},${gg},${b},0)`);
      g.fillStyle = gr;
      g.fillRect(l.x - l.r, l.y - l.r, l.r * 2, l.r * 2);
    }
    ctx.globalCompositeOperation = 'multiply';
    ctx.drawImage(lc.canvas, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
  }

  // ------------------------------------------------------------- travel cinematic
  travel(to, done) {
    if (this.travelState || to === this.biome.id) return;
    const from = this.biome;
    const target = this.get(to);
    const down = { shallows: 0, junkyard: 1, abyss: 2 };
    this.travelState = { from, to: target, t: 0, dur: 4.2, dir: Math.sign((down[to] ?? 0) - (down[from.id] ?? 0)) || 1, done, switched: false };
    this.game.audio.play('travel_whoosh');
    this.game.audio.setMusic(null);
    this.game.school.clear();
  }

  updateTravel(dt) {
    const s = this.travelState;
    s.t += dt;
    const k = s.t / s.dur;
    // streaming bubbles for speed feel
    if (rng.chance(0.9)) this.game.particles.bubble(rng.float(0, this.W), s.dir > 0 ? this.H + 5 : -5, { vy: s.dir > 0 ? -rng.float(160, 320) : rng.float(160, 320), life: 2.5, layer: 'ui', size: rng.pick([1, 2, 3]) });
    if (!s.switched && k >= 0.5) {
      s.switched = true;
      this.biome = s.to;
      this.pickWeather(true);
      this.game.audio.play('arrive');
    }
    if (k >= 1) {
      this.travelState = null;
      this.game.audio.setMusic(this.game.musicFor?.() ?? this.biome.music);
      this.game.audio.setAmbience(this.biome.ambient || this.biome.id, { weather: this.weather, night: this.env.night });
      this.titleCard = { t: 0, title: this.biome.name, sub: this.biome.subtitle };
      s.done?.();
    }
  }

  // Draws the travel transition (replaces drawBack/drawSeabed while active).
  drawTravel(ctx) {
    const s = this.travelState;
    const k = clamp01(s.t / s.dur);
    const W = this.W, H = this.H;
    const off = ease.inOutCubic(k) * H * 1.15 * s.dir;
    const env = this.env;
    // old biome scrolls away, new one scrolls in
    ctx.save();
    ctx.translate(0, Math.round(-off));
    s.from.drawBack(ctx, env); s.from.drawSeabed(ctx, env); s.from.drawNear?.(ctx, env);
    ctx.restore();
    ctx.save();
    ctx.translate(0, Math.round(H * 1.15 * s.dir - off));
    s.to.drawBack(ctx, env); s.to.drawSeabed(ctx, env); s.to.drawNear?.(ctx, env);
    ctx.restore();
    // depth fog in the middle of the trip
    const mid = 1 - Math.abs(k - 0.5) * 2;
    ctx.fillStyle = rgba('#0a1e30', mid * 0.75);
    ctx.fillRect(0, 0, W, H);
    // speed lines
    ctx.fillStyle = rgba('#bfefff', 0.25 * mid);
    for (let i = 0; i < 30; i++) {
      const x = (i * 97 + s.t * 13) % W;
      const len = 20 + (i % 5) * 12;
      const y = ((i * 53 + s.t * 600 * s.dir) % (H + len) + H + len) % (H + len) - len;
      ctx.fillRect(Math.round(x), Math.round(y), 1, len);
    }
    // depth meter
    const depth = Math.round(lerp(depthOf(s.from.id), depthOf(s.to.id), ease.inOutCubic(k)));
    drawText(ctx, `DEPTH ${depth} m`, W / 2, H / 2 - 6, { align: 'center', color: '#e8fbff', outline: '#06121e', scale: 2 });
  }

  drawTitleCard(ctx, dt) {
    const c = this.titleCard;
    if (!c || this.game.ui.blocking) return;
    c.t += dt;
    const a = Math.min(1, c.t * 2, (4 - c.t) * 1.5);
    if (a <= 0) { this.titleCard = null; return; }
    ctx.globalAlpha = a;
    const y = Math.round(this.H * 0.3 - (1 - Math.min(1, c.t * 2)) * 10);
    drawText(ctx, c.title.toUpperCase(), this.W / 2, y, { align: 'center', scale: 3, color: '#ffffff', outline: '#06121e', wave: 1, time: c.t });
    drawText(ctx, c.sub, this.W / 2, y + 30, { align: 'center', color: '#bfefff', outline: '#06121e' });
    ctx.globalAlpha = 1;
  }
}

function depthOf(id) {
  return { shallows: 8, junkyard: 140, abyss: 3200 }[id] ?? 0;
}
