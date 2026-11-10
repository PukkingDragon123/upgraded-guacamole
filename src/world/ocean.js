// Ocean manager: current biome, environment state (time, weather, flood), lighting pass and travel cinematics.

import { clamp, clamp01, lerp, damp, ease, dist } from '../core/math.js';
import { rng } from '../core/rng.js';
import { rgba, mix, hexToRgb } from '../core/color.js';
import { makeLayer, resizeLayer } from '../core/canvas.js';
import { drawText } from '../gfx/font.js';
import { alagardBitmap, alagardReady } from '../gfx/alagard.js';
import { BIOMES, BIOME_DEPTH } from './biomes/index.js';
import { worldTop } from './biomes/base.js';
import { installAero } from './aerokit.js';
import { todWeights } from './scenery.js'; // [phase7:env]
import { installZoomSky } from './zoomsky.js';
import { installWater } from './watersheet.js'; // [phase5:water] simulated surface + water sheet
import { installDeep, ZoneSpawner } from './deepsea.js'; // [phase6:oceans] depth zones under every ocean
import { ZONE_IDS } from './depthzones.js';

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
      lantern: null, wind: 0, hour: 12, quality: 1, view: null, top: 0,
    };
    this.top = -400; // world y of the highest point the camera can show (sky / surface view)
    // [phase6:oceans] depth zones: fish spawn per zone (school.js asks game.world.zones), zone ambience, the depth HUD
    this.zones = new ZoneSpawner(this);
    game.world.zones = this.zones;
    this.zoneNow = null; this.zoneCard = null; this.meterA = 0;
  }

  // The ocean is always fully there (the old "wallpaper floods" reveal is gone); kept for older callers.
  get reveal() { return 1; }
  set reveal(v) { void v; }

  get W() { return this.game.screen.W; }
  get H() { return this.game.screen.H; }

  get(id) {
    const b = this.cache[id] || this.make(id);
    if (b.W !== this.W || b.H !== this.H || b.ready === false) b.build(this.W, this.H);
    return b;
  }

  // Construct (unbuilt) and give it the glossy Frutiger Aero overlay.
  make(id) {
    const Cls = BIOMES[id] || BIOMES.oscean || BIOMES.shallows;
    const b = new Cls(this);
    try { installAero(b); } catch (e) { console.error(e); }
    try { installZoomSky(b); } catch (e) { console.error(e); }
    try { installWater(b); } catch (e) { console.error(e); } // [phase5:water]
    try { installDeep(b); } catch (e) { console.error(e); } // [phase6:oceans]
    this.cache[id] = b;
    return b;
  }

  setBiome(id) {
    this.biome = this.get(id);
    this.pickWeather(true);
    this.game.audio.setMusic(this.game.musicFor?.() ?? this.biome.music);
    this.game.audio.setAmbience(this.biome.ambient || id, { weather: this.weather, night: this.env.night });
    this.ambNow = undefined; // [phase6:oceans] re-evaluated for the new ocean's zones
  }

  onResize() {
    this.top = Ocean.topFor(this.H);
    this.env.top = this.top;
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

  // World y of the highest visible point for a screen height (scroll range + a margin for shake/zoom).
  static topFor(H) { return worldTop(H); }

  // Still water level the boat floats on (the abyss keeps a distant surface far above its view).
  waterLevel() {
    if (this.travelState) return null;
    const b = this.biome;
    if (b.boatLevel) return b.boatLevel(this.env);
    return this.surfaceY();
  }

  // Animated waterline (biome waves) at world x; the water sim lift is applied on top by the caller.
  waveAt(x) {
    const b = this.biome;
    const v = b.waveAt ? b.waveAt(x, this.env) : null;
    return v ?? this.waterLevel();
  }

  pickWeather(initial = false) {
    const ws = this.biome.weathers;
    const w = rng.weighted(ws, (x) => x.weight);
    if (!initial && w.id !== this.weather) this.game.toast?.(`Weather: ${w.name}`, w.icon || 'cloud');
    this.weather = w.id;
    this.weatherT = rng.float(150, 360);
    this.game.audio.setAmbience(this.ambienceId?.() ?? (this.biome.ambient || this.biome.id), { weather: this.weather, night: this.env.night });
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
      g.audio.setAmbience(this.ambienceId(), { weather: this.weather, night });
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
    this.hiPass();
    try { this.updateZone(dt); } catch (err) { if (!this.zoneErr) { this.zoneErr = true; console.error(err); } } // [phase6:oceans]
  }

  // ------------------------------------------------------------- depth zones (phase 6, see depthzones.js / deepsea.js)
  // Zone and depth (m) at the hook while it is out, else at the camera centre: {id, name, depthM, y}.
  depthZone() {
    const D = this.biome?.deep;
    if (!D?.L) return { id: 'sunlit', name: 'Sunlit Zone', depthM: 0, y: 0 };
    const y = this.probeY();
    const z = D.zoneAtY(y);
    return { id: z.id, name: z.name, depthM: Math.round(D.metres(y)), y };
  }

  probeY() {
    const g = this.game, h = g.fishing?.hook, v = g.world?.view;
    if (h?.visible && Number.isFinite(h.y)) return h.y;
    return v ? (v.y0 + v.y1) / 2 : 0;
  }

  // HUD data for a depth meter: zones (with y / metre spans), the current probe, the camera window, the bottom.
  depthInfo() {
    const D = this.biome?.deep;
    if (!D?.L) return null;
    const L = D.L, v = this.game.world?.view, z = this.depthZone();
    return {
      zone: z, zones: L.zones.map((q) => ({ id: q.id, name: q.name, y0: q.y0, y1: q.y1, m0: q.m0, m1: q.m1 })),
      top: L.zones[0].y0, bottom: L.bottom, maxM: L.zones[L.zones.length - 1].m1, view: v ? [v.y0, v.y1] : null,
    };
  }

  // World y of the bottom of the deep column, and the floor under a point (shelf above the lip, abyss floor below).
  deepBottom() { return this.biome?.deep?.L?.bottom ?? this.H; }
  floorUnder(x, y, z = 0) {
    const D = this.biome?.deep;
    return D?.L ? D.floorUnder(x, y, z) : this.floorAt(x, z);
  }

  // the zone the camera looks at decides the ambience and music; the probe zone fires 'depthZone'
  camZone() {
    const D = this.biome?.deep, v = this.game.world?.view;
    if (!D?.L || !v) return null;
    return D.zoneAtY((v.y0 + v.y1) / 2);
  }

  ambienceId() { return this.ambNow === 'deep' ? 'abyss' : (this.biome.ambient || this.biome.id); }

  updateZone(dt) {
    const g = this.game, D = this.biome?.deep;
    if (!D?.L || this.travelState || g.state?.view !== 'ocean') { this.meterA = Math.max(0, this.meterA - dt * 3); return; }
    const z = this.depthZone();
    const prev = this.zoneNow;
    if (!prev || prev.id !== z.id || prev.ocean !== this.biome.id) {
      this.zoneNow = { ...z, ocean: this.biome.id };
      if (prev && prev.ocean === this.biome.id) {
        g.emit?.('depthZone', { id: z.id, name: z.name, depthM: z.depthM, prev: prev.id });
        const order = ['sunlit', 'twilight', 'midnight', 'abyss'];
        const deeper = order.indexOf(z.id) > order.indexOf(prev.id);
        const now = performance.now();
        if ((deeper || now - (this.cardAt || 0) > 4000) && !g.fishing?.fighting && !this.titleCard) { this.zoneCard = { t: 0, id: z.id, name: z.name, m: z.depthM }; this.cardAt = now; }
      } else g.emit?.('depthZone', { id: z.id, name: z.name, depthM: z.depthM, prev: null });
    } else { this.zoneNow.depthM = z.depthM; this.zoneNow.y = z.y; }
    const cz = this.camZone();
    const amb = cz && (cz.id === 'midnight' || cz.id === 'abyss') && cz.deep ? 'deep' : 'home';
    if (amb !== this.ambNow) {
      const first = this.ambNow === undefined;
      this.ambNow = amb;
      if (!first || amb === 'deep') {
        g.audio.setMusic(amb === 'deep' ? 'abyss' : (g.musicFor?.() ?? this.biome.music));
        g.audio.setAmbience(this.ambienceId(), { weather: this.weather, night: this.env.night });
      }
    }
    const muff = { sunlit: 0, twilight: 0.18, midnight: 0.38, abyss: 0.55 }[cz?.deep ? cz.id : 'sunlit'] ?? 0;
    this.muffle = damp(this.muffle ?? 0, muff, 1.5, dt);
    if (Math.abs((this.muffleSet ?? -1) - this.muffle) > 0.02) { this.muffleSet = this.muffle; g.audio.setMuffle?.(this.muffle); }
    const v = g.world?.view, under = v && this.waterLevel() !== null ? (v.y0 + v.y1) / 2 > (this.waterLevel() ?? 0) + 20 : !!v;
    this.meterA = damp(this.meterA, under && !g.tutorial?.active ? 1 : 0, 4, dt);
  }

  // Zoomed-in camera: re-render the current biome's near/mid scenery at 2x detail, a few ms per frame.
  hiPass() {
    const b = this.biome, cam = this.game.camera, ts = this.travelState;
    // [phase7:env] the second half of the trip (destination built, old ocean gone) already polishes the hi-res pass
    const early = ts && ts.switched && !ts.gen;
    if (!b || b.ready === false || (ts && !early) || (!early && (!cam?.open || (cam.z || 1) < 1.3))) return;
    const D = b.D;
    if (!D?.hiSteps || b.hiDone === D) return;
    if (this.hiFor !== D) {
      this.hiFor?.dropHi?.();
      this.hiFor = D;
      this.hiT0 = performance.now();
      const decor = b.decor?.hiSteps ? b.decor : null;
      const w = todWeights(this.env), prefer = ['day', 'dusk', 'night'].sort((p, q) => w[q] - w[p]);
      this.hiGen = (function* all() {
        // [phase7:env] the current time of day's detail first, then the decor; the other variants follow afterwards
        let g = null;
        if (!D.hi) {
          g = D.hiSteps(undefined, prefer);
          for (;;) { const r = g.next(); if (r.done) { g = null; break; } if (r.value === 'variant') break; yield; }
        }
        b.hiFirst = D;
        if (decor) yield* decor.hiSteps();
        if (b.hiExtraSteps) yield* b.hiExtraSteps();
        if (g) yield* g;
        b.hiDone = D;
      })();
    }
    if (!this.hiGen) return;
    // [phase7:env] a bigger slice while the trip / the loading shimmer covers it, the usual few ms afterwards
    const fresh = early || (this.hiT0 != null && performance.now() - this.hiT0 < (b.hiFirst !== D ? 8000 : 2500));
    const t0 = performance.now(), budget = this.game.lowPower ? 5 : fresh ? 28 : 7;
    try {
      while (performance.now() - t0 < budget) if (this.hiGen.next().done) { this.hiGen = null; break; }
    } catch (e) { console.error(e); this.hiGen = null; }
  }

  // Ambient light at a point (for fish wash).
  lightAt(x, y, L) {
    if (!L || L.dark < 0.02) return 1;
    let lit = 1 - (L.profile ? L.profile(y).dark : L.dark); // [phase6:oceans] darkness varies with depth
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
      if (L.hookLit) { /* [phase6:oceans] the deep sea lights the hook itself */ }
      else if (h.visible && g.stats.lantern) L.lights.push({ x: h.x, y: h.y, r: 90, color: '#ffe8b0', a: 0.9 });
      else if (h.visible) L.lights.push({ x: h.x, y: h.y, r: 34, color: '#c8e8ff', a: 0.35 });
      const v = this.env.view;
      for (const f of g.school.fishes) {
        if (v && (f.x < v.x0 - 60 || f.x > v.x1 + 60 || f.y < v.y0 - 60 || f.y > v.y1 + 60)) continue;
        if (f.quirks.has('glow') || f.quirks.has('lure')) {
          const a = f.anchors?.lure || [f.x, f.y];
          L.lights.push({ x: a[0], y: a[1], r: 40 + 20 * f.scale, color: f.sp.glowColor || '#7affea', a: 0.6 * (1 - f.z * 0.6) });
        }
      }
    }
    return L;
  }

  // Multiply darkness with additive light pools. Lights are in world space; the pass runs in screen space
  // (call with any transform: it resets to identity and maps lights through the game camera).
  applyLighting(ctx, L) {
    if (L.dark < 0.02) return;
    const lc = this.light;
    const W = this.W, H = this.H;
    if (lc.w !== W || lc.h !== H) resizeLayer(lc, W, H);
    const cam = this.game.camera;
    const [z, ox, oy] = cam?.xform ? cam.xform() : [1, 0, 0];
    const g = lc.ctx;
    const [tr, tg, tb] = hexToRgb(L.tint || '#1a2440');
    const k = clamp01(L.dark);
    const prof = L.profile; // [phase6:oceans] darkness by depth: a vertical gradient through the zones
    g.globalCompositeOperation = 'source-over';
    if (prof) {
      const gr = g.createLinearGradient(0, 0, 0, H);
      const n = 12;
      for (let i = 0; i <= n; i++) {
        const d = prof((i / n * H - oy) / z), kk = clamp01(d.dark), t = d.tint;
        gr.addColorStop(i / n, `rgb(${Math.round(lerp(255, t[0], kk))},${Math.round(lerp(255, t[1], kk))},${Math.round(lerp(255, t[2], kk))})`);
      }
      g.fillStyle = gr;
    } else g.fillStyle = `rgb(${Math.round(lerp(255, tr, k))},${Math.round(lerp(255, tg, k))},${Math.round(lerp(255, tb, k))})`;
    g.fillRect(0, 0, W, H);
    g.globalCompositeOperation = 'lighter';
    for (const l of L.lights) {
      const x = l.x * z + ox, y = l.y * z + oy, r = l.r * z;
      if (x + r < 0 || y + r < 0 || x - r > W || y - r > H || r < 1) continue;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      const [rr, gg, b] = hexToRgb(l.color || '#ffffff');
      const a = (l.a ?? 1) * (prof ? clamp01(prof(l.y).dark) : k);
      gr.addColorStop(0, `rgba(${rr},${gg},${b},${a})`);
      gr.addColorStop(0.55, `rgba(${rr},${gg},${b},${a * 0.45})`);
      gr.addColorStop(1, `rgba(${rr},${gg},${b},0)`);
      g.fillStyle = gr;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'multiply';
    ctx.drawImage(lc.canvas, 0, 0);
    ctx.restore();
    // [phase6:oceans] emissive deep-sea things after the darkness (sparks, eyes, glowing growths, the giants)
    const D = this.biome?.deep;
    if (D && prof) {
      ctx.save();
      ctx.setTransform(z, 0, 0, z, ox, oy);
      try { D.drawGlowPass(ctx, this.env); } catch (e) { D.fail?.(e); }
      ctx.restore();
    }
  }

  // ------------------------------------------------------------- travel cinematic
  travel(to, done) {
    if (this.travelState || to === this.biome.id) return;
    const from = this.biome;
    // biomes that expose steps(W, H) build over the first frames of the trip instead of stalling it
    const target = this.cache[to] || this.make(to);
    let gen = null;
    if (target.W !== this.W || target.H !== this.H || target.ready === false) {
      if (typeof target.steps === 'function') gen = target.steps(this.W, this.H);
      else target.build(this.W, this.H);
    }
    this.travelState = { from, to: target, t: 0, dur: 4.2, dir: Math.sign(depthOf(to) - depthOf(from.id)) || 1, done, switched: false, gen };
    this.game.audio.play('travel_whoosh');
    this.game.audio.setMusic(null);
    this.game.school.clear();
  }

  updateTravel(dt) {
    const s = this.travelState;
    s.t += dt;
    const k = s.t / s.dur;
    if (s.gen) {
      const t0 = performance.now();
      const drain = k >= 0.5;
      while (drain || performance.now() - t0 < 10) if (s.gen.next().done) { s.gen = null; break; }
    }
    // streaming bubbles for speed feel
    if (rng.chance(0.9)) this.game.particles.bubble(rng.float(0, this.W), s.dir > 0 ? this.H + 5 : -5, { vy: s.dir > 0 ? -rng.float(160, 320) : rng.float(160, 320), life: 2.5, layer: 'ui', size: rng.pick([1, 2, 3]) });
    if (!s.switched && k >= 0.5) {
      s.switched = true;
      s.from.D?.dropHi?.(); // free the old ocean's hi-res scenery
      s.from.hiDone = null; s.from.hiFirst = null;
      if (this.hiFor === s.from.D) { this.hiFor = null; this.hiGen = null; }
      this.biome = s.to;
      this.pickWeather(true);
      this.game.audio.play('arrive');
    }
    if (k >= 1) {
      this.travelState = null;
      this.ambNow = undefined; // [phase6:oceans]
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
    if (s.gen) { ctx.fillStyle = '#3aa8e0'; ctx.fillRect(0, 0, W, H); }
    else { s.to.drawBack(ctx, env); s.to.drawSeabed(ctx, env); s.to.drawNear?.(ctx, env); }
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

  // [phase6:oceans] the depth meter (a glass capsule on the right edge: zones, the camera window, the hook's depth)
  // and the zone title card when the hook / camera crosses into another zone.
  drawDepthHud(ctx, dt) {
    const g = this.game, info = this.meterA > 0.02 ? this.depthInfo() : null;
    if (info && !this.travelState && g.state?.view === 'ocean' && !g.ui?.blocking) {
      const a = this.meterA, W = this.W, H = this.H;
      const mh = Math.round(clamp(H * 0.44, 150, 280)), mw = 8;
      const x = W - 22, y0 = Math.round(H * 0.5 - mh / 2 - 10);
      const span = Math.max(1, info.bottom - info.top);
      const Y = (wy) => y0 + clamp((wy - info.top) / span, 0, 1) * mh;
      ctx.save();
      ctx.globalAlpha = a;
      // drop shadow + glass rim
      ctx.fillStyle = 'rgba(4,16,34,0.35)';
      ctx.fillRect(x - 3, y0 - 2, mw + 7, mh + 6);
      for (const zn of info.zones) {
        const c = ZONE_COLORS[zn.id] || ZONE_COLORS.sunlit;
        const a0 = Math.round(Y(zn.y0)), a1 = Math.round(Y(zn.y1));
        if (a1 <= a0) continue;
        const gr = ctx.createLinearGradient(0, a0, 0, a1);
        gr.addColorStop(0, c[0]); gr.addColorStop(1, c[1]);
        ctx.fillStyle = gr;
        ctx.fillRect(x, a0, mw, a1 - a0);
        ctx.fillStyle = 'rgba(255,255,255,0.45)';
        if (a0 > y0) ctx.fillRect(x - 2, a0, mw + 4, 1);
      }
      // camera window
      if (info.view) {
        const v0 = Math.round(Y(info.view[0])), v1 = Math.max(v0 + 3, Math.round(Y(info.view[1])));
        ctx.fillStyle = 'rgba(255,255,255,0.22)';
        ctx.fillRect(x - 1, v0, mw + 2, v1 - v0);
        ctx.fillStyle = 'rgba(255,255,255,0.8)';
        ctx.fillRect(x - 1, v0, mw + 2, 1); ctx.fillRect(x - 1, v1 - 1, mw + 2, 1);
      }
      // gloss + rim
      ctx.fillStyle = 'rgba(255,255,255,0.42)';
      ctx.fillRect(x + 1, y0 + 2, 2, mh - 4);
      ctx.strokeStyle = 'rgba(220,248,255,0.9)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x - 0.5, y0 - 0.5, mw + 1, mh + 1);
      // the hook / camera marker: a glossy pill with the depth
      const zn = info.zone, my = Math.round(Y(zn.y));
      const zc = ZONE_COLORS[zn.id] || ZONE_COLORS.sunlit;
      const label = zn.depthM >= 1000 ? (zn.depthM / 1000).toFixed(zn.depthM >= 10000 ? 0 : 1) + ' km' : zn.depthM + ' m';
      const tw = label.length * 6 + 10, px = x - tw - 8;
      ctx.fillStyle = 'rgba(6,22,44,0.78)';
      ctx.fillRect(px, my - 7, tw, 14);
      ctx.fillStyle = zc[2];
      ctx.fillRect(px, my - 7, tw, 1); ctx.fillRect(px, my + 6, tw, 1);
      ctx.fillStyle = 'rgba(255,255,255,0.14)';
      ctx.fillRect(px + 1, my - 6, tw - 2, 5);
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.moveTo(px + tw, my - 4); ctx.lineTo(px + tw + 5, my); ctx.lineTo(px + tw, my + 4); ctx.fill();
      ctx.fillRect(x - 2, my, mw + 4, 1);
      drawText(ctx, label, px + tw / 2, my - 4, { align: 'center', color: '#ffffff', outline: '#06121e' });
      drawText(ctx, zn.name.toUpperCase(), x + mw + 2, y0 + mh + 7, { align: 'right', font: 'small', color: zc[2], outline: '#06121e' });
      ctx.restore();
    }
    this.drawZoneCard(ctx, dt);
  }

  // [phase7:env] while the zoomed-in voxel detail is still being built: a small glossy loading pill with a shimmer
  // sweep and pixel sparkles (bottom centre, above the hotbar), fading out when the pass completes
  drawShimmer(ctx, dt) {
    const b = this.biome, busy = !!(this.hiGen && b && b.hiFirst !== b.D && !this.travelState && this.game.state?.view === 'ocean');
    this.shimA = clamp01((this.shimA || 0) + (busy ? dt * 3 : -dt * 2));
    if (this.shimA < 0.02 || this.game.ui?.blocking) return;
    const W = this.W, H = this.H, a = this.shimA, t = performance.now() / 1000;
    const w = 96, h = 14, x = Math.round(W / 2 - w / 2), y = Math.round(H * 0.8);
    ctx.save();
    ctx.globalAlpha = a;
    ctx.fillStyle = 'rgba(6,30,58,0.55)';
    ctx.fillRect(x - 1, y + 1, w + 2, h + 1);
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, '#c8f4ff'); g.addColorStop(0.5, '#4ab8f0'); g.addColorStop(1, '#1a6ab8');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fillRect(x + 1, y + 1, w - 2, 4);
    // the shimmer: a bright diagonal band sweeping across
    const sx = x + ((t * 70) % (w + 30)) - 15;
    ctx.save();
    ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    for (let i = 0; i < h; i++) ctx.fillRect(Math.round(sx - i * 0.5), y + i, 6, 1);
    ctx.restore();
    ctx.strokeStyle = 'rgba(230,252,255,0.95)'; ctx.lineWidth = 1;
    ctx.strokeRect(x - 0.5, y - 0.5, w + 1, h + 1);
    drawText(ctx, 'Polishing voxels', W / 2, y + 4, { align: 'center', font: 'small', color: '#ffffff', outline: '#0a3a6a' });
    // pixel sparkles hopping off the pill
    ctx.fillStyle = '#ffffff';
    for (let i = 0; i < 4; i++) {
      const k = (t * 0.9 + i * 0.25) % 1, px = x + ((i * 37 + Math.floor(t * 0.9 + i * 0.25) * 53) % w), py = y - Math.round(k * 10);
      ctx.globalAlpha = a * (1 - k);
      ctx.fillRect(px, py, 1, 1);
      if (k < 0.5) { ctx.fillRect(px - 1, py, 3, 1); ctx.fillRect(px, py - 1, 1, 3); }
    }
    ctx.restore();
  }

  drawZoneCard(ctx, dt) {
    const c = this.zoneCard;
    if (!c) return;
    c.t += dt;
    const D = 3.2;
    if (c.t > D || this.travelState || this.game.state?.view !== 'ocean') { this.zoneCard = null; return; }
    if (this.game.ui?.blocking) return;
    const a = Math.min(1, c.t * 2.5, (D - c.t) * 1.4);
    const col = (ZONE_COLORS[c.id] || ZONE_COLORS.sunlit)[2];
    const y = Math.round(this.H * 0.24 - (1 - Math.min(1, c.t * 2.5)) * 8);
    const sh = c.id === 'abyss' ? Math.round(Math.sin(c.t * 40) * Math.max(0, 0.5 - c.t) * 4) : 0;
    ctx.save();
    ctx.globalAlpha = Math.max(0, a);
    if (alagardReady()) {
      const bm = alagardBitmap(c.name.toUpperCase(), { size: 16, color: col });
      const bs = alagardBitmap(c.name.toUpperCase(), { size: 16, color: '#06121e' });
      const s = 2, w = bm.width * s, h = bm.height * s, x0 = Math.round(this.W / 2 - w / 2) + sh;
      for (const [dx, dy] of [[-2, 0], [2, 0], [0, -2], [0, 2], [2, 2]]) ctx.drawImage(bs, x0 + dx, y + dy, w, h);
      ctx.drawImage(bm, x0, y, w, h);
    } else drawText(ctx, c.name.toUpperCase(), this.W / 2 + sh, y + 6, { align: 'center', scale: 3, color: col, outline: '#06121e' });
    const m = c.m >= 1000 ? (c.m / 1000).toFixed(1) + ' km' : c.m + ' m';
    drawText(ctx, '- ' + m + ' -', this.W / 2, y + 40, { align: 'center', color: '#e8fbff', outline: '#06121e' });
    ctx.restore();
  }

  drawTitleCard(ctx, dt) {
    this.drawDepthHud(ctx, dt); // [phase6:oceans]
    this.drawShimmer(ctx, dt); // [phase7:env]
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

// [phase6:oceans] depth meter colours per zone: [top, bottom, accent]
const ZONE_COLORS = {
  sunlit: ['#8ae8ff', '#1e8ad8', '#bff6ff'],
  twilight: ['#4a5ac0', '#2a2470', '#c8b8ff'],
  midnight: ['#18145a', '#07071e', '#8aa8ff'],
  abyss: ['#06050c', '#000000', '#ff6a5a'],
};
void ZONE_IDS;

function depthOf(id) {
  return BIOME_DEPTH[id] ?? 0;
}
