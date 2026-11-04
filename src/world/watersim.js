// FISHTOP water simulation (phase 5). Pure CPU math, no DOM: safe to import anywhere (the game, the 3D intro,
// dev previews, tests). World units are logical world px; y grows downward, a positive height lifts the water.
//
// Surface model along the waterline (the side view's x axis):
//   - a 1D wave equation on a 2 px grid (damped, with a weak spring back to rest), fixed 120 Hz substeps;
//   - layered Gerstner swell on top (trochoid crests: sharper peaks, wider troughs), sized by the weather;
//   - foam that builds where the surface is steep or fast and fades out;
//   - ripple rings on the receding surface sheet (x, z = 0 near edge .. 1 far edge), drawn by watersheet.js / the
//     WebGL pass as perspective ellipses, plus rain pocks and boat wakes made of rings.
//
// In the game: game.water (src/gfx/watergl.js WaterFX) owns one WaterSim as game.water.sim and steps it; its
// waterline lift is folded into every ocean's ocean.waveAt(x) by src/world/watersheet.js.
//
//   const sim = new WaterSim({ width: 960 });
//   sim.update(dt, { weather: 'rain', swellMul: 1, rainMul: 1 })   step it (a weather id picks swell + rain;
//                                                            or pass swell: 'storm', rain: drops/s, wind: 0..1)
//   sim.disturb(x, strength = 1, radius = 8)                 an impact at x: pushes the surface down (negative =
//                                                            sucks it up), makes waves travel out and spawns a ring
//   sim.impulse(x, vel, radius)                              raw velocity kick (px/s, positive = up)
//   sim.heightAt(x)   -> lift in px (positive = up): swell + simulated waves
//   sim.slopeAt(x)    -> d(height)/dx (positive: the surface rises to the right)
//   sim.velocityAt(x), sim.foamAt(x) (0..1)
//   sim.ring(x, z, strength, {speed, life, r0})              a ripple ring on the sheet
//   sim.rings         live rings [{x, z, t, life, speed, r0, a}]  (radius = r0 + speed * t)
//   sim.wake(x, dir, speed, half)                            boat wake: rings trailing the stern + a bow push
//   sim.fillLift(out, W)                                     out[x] = round(heightAt(x)) for x = 0..W (fast path)
//   ride(body, dt, surfaceAt)                                buoyancy helper (see below)
//
// For the Intro agent's 3D water (no game needed):
//   import { swellAt, SWELLS, waterPalette } from '../world/watersim.js';
//   swellAt(x, z, t, SWELLS.calm) -> {h, dx, dz}   a 2D Gerstner swell field: height (up) and horizontal
//                                                  displacement at plane point (x, z) and time t (world px / s)
//   waterPalette('oscean', daylight) -> {surface, deep, horizon, sheen, foam, glint, ray, caustic, under, ...}
//   new WaterSim({width}) + heightAt/slopeAt also work standalone for a 1D slice (e.g. a waterline in 3D).

const TAU = Math.PI * 2;
const SUB = 1 / 120;
const MAX_LIFT = 14;
const MAX_RINGS = 72;

// ------------------------------------------------------------------ swell presets (Gerstner waves)
// A: amplitude px, L: wavelength px, c: phase speed px/s (signed: + travels right), Q: steepness 0..1
export const SWELLS = {
  calm: [{ A: 0.9, L: 210, c: 22, Q: 0.5 }, { A: 0.5, L: 97, c: -14, Q: 0.4 }, { A: 0.28, L: 41, c: 18, Q: 0.6 }],
  breeze: [{ A: 1.3, L: 230, c: 28, Q: 0.55 }, { A: 0.7, L: 103, c: -16, Q: 0.5 }, { A: 0.4, L: 37, c: 24, Q: 0.7 }],
  rain: [{ A: 1.6, L: 250, c: 30, Q: 0.6 }, { A: 0.9, L: 111, c: -20, Q: 0.55 }, { A: 0.5, L: 33, c: 26, Q: 0.7 }],
  storm: [{ A: 3.6, L: 300, c: 44, Q: 0.75 }, { A: 1.8, L: 137, c: -26, Q: 0.7 }, { A: 0.9, L: 47, c: 36, Q: 0.8 }],
  still: [{ A: 0.45, L: 260, c: 14, Q: 0.3 }, { A: 0.25, L: 117, c: -10, Q: 0.3 }],
};

// weather id -> {swell, rain (drops/s), wind 0..1}
const WEATHER = {
  calm: { swell: 'calm' }, sunny: { swell: 'calm' }, clear: { swell: 'calm' }, cloudy: { swell: 'breeze', wind: 0.4 },
  bubbles: { swell: 'breeze', wind: 0.6 }, aurora: { swell: 'calm' }, glossyrain: { swell: 'rain', rain: 26, wind: 0.5 },
  rain: { swell: 'rain', rain: 34, wind: 0.6 }, storm: { swell: 'storm', rain: 60, wind: 1 }, snowfall: { swell: 'calm', wind: 0.2 },
  blizzard: { swell: 'storm', wind: 1 }, murky: { swell: 'calm' }, static: { swell: 'storm', rain: 10, wind: 0.8 }, oil: { swell: 'still' },
  datarain: { swell: 'rain', rain: 30, wind: 0.4 }, still: { swell: 'still' }, neonstorm: { swell: 'storm', rain: 46, wind: 0.9 },
  rushhour: { swell: 'breeze', wind: 0.5 }, eruption: { swell: 'storm', wind: 0.7 }, sulfur: { swell: 'calm' }, snow: { swell: 'still' },
  current: { swell: 'breeze', wind: 0.5 }, glowtide: { swell: 'calm' },
};
export const weatherWater = (id) => WEATHER[id] || WEATHER.calm;

// 2D Gerstner swell at plane point (x, z): sum of the preset's waves with directions fanned around +x.
export function swellAt(x, z, t, waves = SWELLS.calm) {
  let h = 0, dx = 0, dz = 0;
  for (let i = 0; i < waves.length; i++) {
    const w = waves[i], k = TAU / w.L, a = (i - 1) * 0.45, cx = Math.cos(a) * Math.sign(w.c || 1), cz = Math.sin(a);
    const th = k * (cx * x + cz * z) - k * Math.abs(w.c) * t + i * 1.7;
    h += w.A * Math.cos(th);
    const q = (w.Q / (k * waves.length)) * Math.sin(th);
    dx -= cx * q; dz -= cz * q;
  }
  return { h, dx, dz };
}

// ------------------------------------------------------------------ per-ocean water palettes
// surface: open-water body seen from above; horizon: grazing sheen at the far edge; deep: depth tint; sheen:
// highlight on the normal-mapped texture; trough: shading in the texture; foam / crest; glint: sun sparkles;
// under: the mirror band seen from below; ray / caustic: underwater light. Scalars tune the shader per ocean.
export const WATER_PALETTES = {
  oscean: { surface: '#2fb4f4', horizon: '#c8f6ff', deep: '#0f6cc8', sheen: '#ffffff', trough: '#1a6ab8', foam: '#ffffff', crest: '#ffffff', glint: '#fffbe6', under: '#bff6ff', ray: '#f0fff8', caustic: '#e8fffa', reflect: 0.7, rays: 0.55, caustics: 0.7, tint: 0.16 },
  shallows: { surface: '#22c8e0', horizon: '#d0fbff', deep: '#0e8ab8', sheen: '#ffffff', trough: '#0e78a8', foam: '#ffffff', crest: '#f4ffff', glint: '#fffbe0', under: '#c8fbff', ray: '#f4fff0', caustic: '#f0ffe8', reflect: 0.65, rays: 0.6, caustics: 0.85, tint: 0.14 },
  fjord: { surface: '#4ab8dc', horizon: '#e8faff', deep: '#1a5a98', sheen: '#f4fdff', trough: '#2a6a98', foam: '#f8feff', crest: '#ffffff', glint: '#f0fbff', under: '#d8f4ff', ray: '#e8f8ff', caustic: '#e0f4ff', reflect: 0.8, rays: 0.45, caustics: 0.55, tint: 0.18 },
  junkyard: { surface: '#2ab89a', horizon: '#c8f8e0', deep: '#0e6a5a', sheen: '#e8fff0', trough: '#145a4a', foam: '#e8fff0', crest: '#f0fff4', glint: '#f0ffd8', under: '#bff8e0', ray: '#e0ffe8', caustic: '#d8ffe0', reflect: 0.6, rays: 0.4, caustics: 0.5, tint: 0.2 },
  metropolis: { surface: '#5a6ae8', horizon: '#d8d0ff', deep: '#20186a', sheen: '#f0e8ff', trough: '#2a2a7a', foam: '#ece8ff', crest: '#f4f0ff', glint: '#ffe0ff', under: '#d0c8ff', ray: '#e8e0ff', caustic: '#d8d0ff', reflect: 0.75, rays: 0.3, caustics: 0.35, tint: 0.18 },
  volcano: { surface: '#e8783a', horizon: '#ffd8b0', deep: '#6a1a10', sheen: '#fff0d8', trough: '#8a2a14', foam: '#ffe8d8', crest: '#fff4e8', glint: '#fff0b0', under: '#ffd0a8', ray: '#ffd8b0', caustic: '#ffc898', reflect: 0.6, rays: 0.35, caustics: 0.35, tint: 0.2 },
  abyss: { surface: '#2a40b8', horizon: '#8aa8f0', deep: '#060a30', sheen: '#c8d8ff', trough: '#101a5a', foam: '#d8e8ff', crest: '#e0ecff', glint: '#9affea', under: '#7a9af0', ray: '#9ad8ff', caustic: '#7affea', reflect: 0.8, rays: 0.2, caustics: 0.3, tint: 0.24 },
};

const hexRgb = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const rgbHex = (c) => '#' + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
const mixHex = (a, b, t) => { const A = hexRgb(a), B = hexRgb(b); return rgbHex([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t]); };

// Palette for an ocean at a daylight level (1 day .. 0 night) and dusk (0..1 golden hour).
const palMemo = new Map();
export function waterPalette(id, daylight = 1, dusk = 0) {
  const d = Math.round(Math.max(0, Math.min(1, daylight)) * 8) / 8, k = Math.round(Math.max(0, Math.min(1, dusk)) * 8) / 8;
  const key = id + '|' + d + '|' + k;
  let p = palMemo.get(key);
  if (p) return p;
  const P = WATER_PALETTES[id] || WATER_PALETTES.oscean;
  const night = 1 - d;
  p = { ...P, id, daylight: d, dusk: k };
  const NIGHT = { surface: '#123a78', horizon: '#3a5aa0', deep: '#050c2a', sheen: '#a8c8ff', trough: '#081a40', foam: '#c8d8ff', crest: '#d0e0ff', glint: '#e0ecff', under: '#4a6ab0', ray: '#8ab0ff', caustic: '#8ab8ff' };
  const DUSK = { surface: '#c87a6a', horizon: '#ffd0a0', sheen: '#fff0d8', glint: '#fff0c0', crest: '#fff4e8', ray: '#ffd8b0', caustic: '#ffe0c0' };
  for (const c of Object.keys(NIGHT)) {
    let v = P[c];
    if (DUSK[c] && k > 0) v = mixHex(v, DUSK[c], k * 0.45);
    if (night > 0) v = mixHex(v, NIGHT[c], night * (id === 'abyss' || id === 'metropolis' ? 0.35 : 0.7));
    p[c] = v;
  }
  if (palMemo.size > 400) palMemo.clear();
  palMemo.set(key, p);
  return p;
}

// ------------------------------------------------------------------ buoyancy helper
// body: {x, y, vy, roll, rollV, half (half width px), mass (1 = box), draft (px below the line), still: 0..1}
// surfaceAt(x) -> waterline y. Springs the body onto the averaged waterline under it and rolls it with the slope.
// Returns the body; body.splash is set to the impact speed when it slaps the water hard (caller makes a splash).
export function ride(body, dt, surfaceAt) {
  const h = body.half ?? 8, m = Math.max(0.3, body.mass ?? 1);
  const a = surfaceAt(body.x - h), b = surfaceAt(body.x), c = surfaceAt(body.x + h);
  if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(c)) return body;
  const target = (a + b * 2 + c) / 4 + (body.draft ?? 0);
  if (body.vy === undefined || body.y === undefined || !Number.isFinite(body.y)) { body.y = target; body.vy = 0; }
  const prev = body.vy;
  body.vy += ((target - body.y) * (70 / m) - body.vy * (7 + (body.still ?? 0) * 6)) * dt;
  body.y += body.vy * dt;
  const slope = (c - a) / (h * 2);
  const rt = Math.atan(slope) * 57.3;
  body.rollV = (body.rollV ?? 0) + (((rt - (body.roll ?? 0)) * (45 / m)) - (body.rollV ?? 0) * 6) * dt;
  body.roll = (body.roll ?? 0) + body.rollV * dt;
  body.splash = prev > 40 && body.vy < prev * 0.5 ? prev : 0;
  return body;
}

// ------------------------------------------------------------------ the simulation

export class WaterSim {
  constructor(o = {}) {
    this.cell = o.cell || 2;
    this.c = o.speed ?? 78;        // wave speed px/s
    this.damp = o.damp ?? 0.9935;  // velocity kept per substep
    this.spring = o.spring ?? 5;   // pull back to rest
    this.t = 0;
    this.acc = 0;
    this.rings = [];
    this.swell = SWELLS.calm.map((w) => ({ ...w }));
    this.swellK = 1;               // eased swell scale (weather changes blend)
    this.swellTo = 'calm';
    this.rainRate = 0;
    this.wind = 0;
    this.rainAcc = 0;
    this.ringAcc = 0;
    this.resize(o.width || 960);
  }

  resize(W) {
    if (this.W === W && this.h) return;
    this.W = W;
    this.n = Math.ceil(W / this.cell) + 3;
    this.h = new Float32Array(this.n);
    this.v = new Float32Array(this.n);
    this.foam = new Float32Array(this.n);
    this.sw = new Float32Array(this.n);  // swell height per cell
    this.lift = new Float32Array(this.n); // total per cell (swell + sim), refreshed each update
  }

  idx(x) { return Math.max(0, Math.min(this.n - 1, Math.round(x / this.cell))); }

  // velocity impulse (px/s, positive = up) with a smooth bell falloff
  impulse(x, vel, radius = 10) {
    if (!Number.isFinite(x) || !Number.isFinite(vel)) return;
    const c = this.cell, r = Math.max(c, radius);
    const i0 = Math.max(0, Math.floor((x - r) / c)), i1 = Math.min(this.n - 1, Math.ceil((x + r) / c));
    for (let i = i0; i <= i1; i++) {
      const d = (i * c - x) / r;
      if (d * d >= 1) continue;
      const k = 1 - d * d;
      this.v[i] += vel * k * k;
      this.foam[i] = Math.min(1, this.foam[i] + Math.abs(vel) * 0.01 * k);
    }
  }

  // An impact: strength 1 ~ a lure plopping in, 3+ = a big fish crashing down. Negative strength sucks the
  // surface up (something leaving the water). Spawns a ripple ring unless one just started right there.
  disturb(x, strength = 1, radius = 8, o = {}) {
    if (!Number.isFinite(x) || !Number.isFinite(strength)) return;
    const s = Math.max(-4, Math.min(4, strength));
    this.impulse(x, -s * 38, Math.max(3, radius));
    const a = Math.abs(s);
    if (a > 0.12 && o.ring !== false) {
      for (let i = this.rings.length - 1; i >= Math.max(0, this.rings.length - 10); i--) {
        const r = this.rings[i];
        if (r.t < 0.1 && Math.abs(r.x - x) < radius * 0.8) { r.a = Math.min(1.4, Math.max(r.a, a * 0.5)); return; }
      }
      const zr = o.z ?? 0.26 + Math.random() * 0.16;
      this.ring(x, zr, Math.min(1.3, 0.45 + a * 0.35), { speed: 16 + a * 10 + radius * 0.6, life: 1.1 + a * 0.4, r0: Math.min(radius * 0.4, 6) });
      if (a > 0.7) this.ring(x, zr, Math.min(1, 0.2 + a * 0.3), { speed: 10 + a * 5, life: 1.3 + a * 0.3, r0: 1, delay: 0.18 });
    }
  }

  ring(x, z = 0.1, strength = 0.6, o = {}) {
    if (!Number.isFinite(x)) return null;
    if (this.rings.length >= MAX_RINGS) this.rings.shift();
    const r = { x, z: Math.max(0, Math.min(1, z)), t: -(o.delay || 0), life: o.life ?? 1.1, speed: o.speed ?? 16, r0: o.r0 ?? 1, a: strength, kind: o.kind || 'ring' };
    this.rings.push(r);
    return r;
  }

  // Boat wake: a trail of rings at the stern (they spread into a V on the sheet) and a bow push.
  wake(x, dir, speed, half = 30) {
    const k = Math.min(1, Math.abs(speed) / 240);
    if (k < 0.04) return;
    this.ringAcc += k;
    if (this.ringAcc > 0.22) {
      this.ringAcc = 0;
      this.ring(x - dir * half * 0.9, 0.18 + Math.random() * 0.1, 0.55 + k * 0.5, { speed: 9 + k * 20, life: 1.6 + k * 1.2, r0: 3, kind: 'wake' });
    }
    this.impulse(x + dir * (half + 6), -(4 + k * 20), 10);
    this.impulse(x - dir * (half + 8), 3 + k * 12, 14);
  }

  setWeather(id, o = {}) {
    const w = weatherWater(id);
    this.swellTo = o.swell || w.swell || 'calm';
    this.rainRate = o.rain ?? w.rain ?? 0;
    this.wind = o.wind ?? w.wind ?? 0;
  }

  update(dt, o = {}) {
    dt = Math.min(0.1, Math.max(0, dt || 0));
    this.t += dt;
    if (o.weather !== undefined || o.swell !== undefined) this.setWeather(o.weather, o);
    // blend the swell toward the weather preset
    const target = SWELLS[this.swellTo] || SWELLS.calm;
    const kb = 1 - Math.exp(-dt * 0.35);
    for (let i = 0; i < 3; i++) {
      const s = this.swell[i] || (this.swell[i] = { A: 0, L: 200, c: 20, Q: 0.5 });
      const g = target[i] || { A: 0, L: s.L, c: s.c, Q: s.Q };
      s.A += (g.A * (o.swellMul ?? 1) - s.A) * kb;
      s.L += (g.L - s.L) * kb; s.c += (g.c - s.c) * kb; s.Q += (g.Q - s.Q) * kb;
    }
    // rain pocks
    const rate = (o.rain ?? this.rainRate) * (o.rainMul ?? 1);
    if (rate > 0) {
      this.rainAcc += rate * dt;
      while (this.rainAcc >= 1) {
        this.rainAcc -= 1;
        const x = Math.random() * this.W, big = Math.random() < 0.2;
        this.impulse(x, big ? -14 : -6, 3);
        this.ring(x, Math.random(), big ? 0.7 : 0.45, { speed: big ? 11 : 7, life: big ? 0.7 : 0.45, r0: 0.5, kind: 'rain' });
      }
    }
    this.step(dt);
    this.stepSwell();
    for (const r of this.rings) r.t += dt;
    if (this.rings.length) this.rings = this.rings.filter((r) => r.t < r.life);
  }

  step(dt) {
    this.acc = Math.min(0.1, this.acc + dt);
    const { h, v, n, foam } = this;
    const c2 = (this.c * this.c) / (this.cell * this.cell), dmp = this.damp, sp = this.spring;
    while (this.acc >= SUB) {
      this.acc -= SUB;
      for (let i = 0; i < n; i++) {
        const l = h[i > 0 ? i - 1 : 0], r = h[i < n - 1 ? i + 1 : n - 1];
        v[i] = (v[i] + ((l + r - 2 * h[i]) * c2 - h[i] * sp) * SUB) * dmp;
      }
      for (let i = 0; i < n; i++) {
        let y = h[i] + v[i] * SUB;
        if (y > MAX_LIFT) { y = MAX_LIFT; v[i] *= -0.25; } else if (y < -MAX_LIFT) { y = -MAX_LIFT; v[i] *= -0.25; }
        h[i] = y;
      }
    }
    const fd = Math.exp(-dt * 1.6);
    for (let i = 0; i < n; i++) {
      const s = Math.abs(h[i < n - 1 ? i + 1 : i] - h[i > 0 ? i - 1 : i]) * 0.5;
      foam[i] = Math.min(1, Math.max(foam[i] * fd, s > 0.6 ? (s - 0.6) * 0.9 : 0, Math.abs(v[i]) > 50 ? 0.55 : 0));
    }
  }

  // Gerstner trochoid sampled on the cell grid: forward-evaluate (X(x0), Y(x0)) on a fine grid and resample.
  stepSwell() {
    const { n, cell, sw, lift, h } = this;
    const W = this.swell, t = this.t;
    let xi = 0, px = -1e9, py = 0;
    const x0s = -24, x0e = n * cell + 24;
    for (let x0 = x0s; x0 <= x0e; x0 += 1) {
      let X = x0, Y = 0;
      for (let i = 0; i < W.length; i++) {
        const w = W[i];
        if (w.A < 0.01) continue;
        const k = TAU / w.L, th = k * x0 - k * w.c * t + i * 1.7;
        Y += w.A * Math.cos(th);
        X -= (w.Q / (k * W.length)) * Math.sin(th); // normalised steepness: trochoid crests at any amplitude
      }
      // fill grid cells whose x lies in [px, X]
      while (xi < n && xi * cell <= X) {
        const gx = xi * cell;
        sw[xi] = px > -1e8 && X > px ? py + (Y - py) * ((gx - px) / (X - px)) : Y;
        xi++;
      }
      px = X; py = Y;
    }
    for (; xi < n; xi++) sw[xi] = py;
    for (let i = 0; i < n; i++) lift[i] = sw[i] + h[i];
  }

  heightAt(x) {
    const f = Math.max(0, Math.min(this.n - 1.001, x / this.cell));
    const i = Math.floor(f), k = f - i;
    return this.lift[i] + (this.lift[i + 1] - this.lift[i]) * k;
  }

  slopeAt(x) { return (this.heightAt(x + 3) - this.heightAt(x - 3)) / 6; }
  velocityAt(x) { return this.v[this.idx(x)]; }
  foamAt(x) { return this.foam[this.idx(x)]; }

  fillLift(out, W) {
    const L = this.lift, c = this.cell, n = this.n;
    for (let x = 0; x <= W && x < out.length; x++) {
      const f = Math.min(n - 1.001, x / c), i = Math.floor(f), k = f - i;
      out[x] = Math.round(L[i] + (L[i + 1] - L[i]) * k);
    }
    return out;
  }
}
