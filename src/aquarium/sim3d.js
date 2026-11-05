// The aquarium's 3D simulation (phase 6). Everything lives in tank space: centimetres, Y up, the tank's base at
// y = 0, centred on x / z, the front glass toward +z.
//
//   new TankShape(tier)        geometry queries: floorY(x, z), waterY, inside(p, m), clamp(p, m) -> hit normal |
//                              null, floorPoint(u, v) / toUV(x, z) (u across 0..1, v 0 front .. 1 back),
//                              swimPoint(rnd, y01, m), rayHit(o, d) (ray vs the water volume), size, center
//   new TankFish(rec, sp, len) steering AI in 3D (heading + speed, so fish always swim nose first): wander in the
//                              species' depth band, school, eat flakes, flee / inspect the swimmer, gather at a
//                              poked decoration, court (breeding), sleep at night; crawlers walk the gravel,
//                              jellies pulse, rays glide. update(dt, W) with the world W (see Aquarium.simWorld()).
//   new Drops3D()              Aero drops that rise to the surface and bob there until popped
//   Ripples                    surface ring waves: add(x, z, amp), height(x, z, t)
//   DENOMS                     drop denominations

import { clamp, clamp01, lerp, TAU } from '../core/math.js';
import { rng } from '../core/rng.js';
import { TANK3D } from './tanks.js';
import { fishKind } from './lpfish.js';

export const DENOMS = [1, 5, 25];
export const DROP_CAP = 70;

const v3len = (x, y, z) => Math.sqrt(x * x + y * y + z * z);
const hashN = (x, z) => { const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453; return s - Math.floor(s); };
function vnoise(x, z) {
  const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const a = hashN(xi, zi), b = hashN(xi + 1, zi), c = hashN(xi, zi + 1), d = hashN(xi + 1, zi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

// inner profile of a glass globe of radius R centred at cy, cut flat at y = 0 and open at `open`
export function sphereProf(R, cy, open, n = 14) {
  const out = [];
  const y0 = 0.5;
  for (let i = 0; i <= n; i++) {
    const y = y0 + (open - y0) * (i / n);
    out.push([Math.sqrt(Math.max(0.01, R * R - (y - cy) ** 2)), y]);
  }
  return out;
}

// ------------------------------------------------------------------ tank geometry
export class TankShape {
  constructor(tier) {
    const d = TANK3D[tier] || TANK3D[0];
    this.tier = tier;
    this.d = d;
    this.round = d.shape === 'round';
    this.waterY = d.water;
    this.fishLen = d.fish;
    if (this.round) {
      this.R = d.R; this.cy = d.cy;
      // inner glass profile [[r, y]...] (the bowl's comes from its sphere)
      this.prof = d.prof || sphereProf(d.R, d.cy, d.open);
      this.size = [d.R * 2, d.open, d.R * 2];
      this.center = [0, Math.min(d.cy, d.water * 0.55), 0];
      this.floorR = this.rAt(d.gravel) - 0.6;
      this.top = d.open;
    } else {
      this.W = d.W; this.H = d.H; this.D = d.D;
      this.size = [d.W, d.H, d.D];
      this.center = [0, d.H / 2, 0];
      this.top = d.H;
    }
    this.minDim = Math.min(this.size[0], this.waterY, this.size[2]);
  }

  // radius of the round glass at height y
  rAt(y) {
    const P = this.prof;
    if (y <= P[0][1]) return P[0][0];
    for (let i = 1; i < P.length; i++) if (y <= P[i][1]) { const [r0, y0] = P[i - 1], [r1, y1] = P[i]; return r0 + (r1 - r0) * (y - y0) / Math.max(1e-6, y1 - y0); }
    return P[P.length - 1][0];
  }

  floorY(x, z) {
    const d = this.d;
    if (this.round) {
      const r = Math.hypot(x, z) / Math.max(1, this.floorR);
      return d.gravel + 0.9 * (1 - Math.min(1, r * r)) - 0.4 + vnoise(x * 0.5 + 3, z * 0.5) * 0.5;
    }
    const back = clamp01((d.D / 2 - z) / d.D);
    return d.gravel + d.slope * back * back * (1.2 - 0.2 * back) + (vnoise(x * 0.12, z * 0.12) - 0.5) * d.slope * 0.35 + (vnoise(x * 0.6 + 9, z * 0.6) - 0.5) * 0.5;
  }

  // floor point from normalised (u across, v depth 0 = front .. 1 = back)
  floorPoint(u, v, m = 1.5) {
    let x, z;
    if (this.round) {
      const fr = this.floorR - m;
      x = (u - 0.5) * 2 * fr; z = (0.5 - v) * 2 * fr;
      const r = Math.hypot(x, z);
      if (r > fr) { x *= fr / r; z *= fr / r; }
    } else {
      x = clamp((u - 0.5) * this.W, -this.W / 2 + m, this.W / 2 - m);
      z = clamp((0.5 - v) * this.D, -this.D / 2 + m, this.D / 2 - m);
    }
    return [x, this.floorY(x, z), z];
  }
  toUV(x, z) {
    if (this.round) { const fr = this.floorR - 1.5; return [clamp01(x / (2 * fr) + 0.5), clamp01(0.5 - z / (2 * fr))]; }
    return [clamp01(x / this.W + 0.5), clamp01(0.5 - z / this.D)];
  }

  // keep p inside the swimmable water (margin m); returns the push normal when it hit a wall, else null
  clamp(p, m = 1, floorM = m) {
    let hit = null;
    const top = this.waterY - m * 0.6;
    if (p[1] > top) { p[1] = top; hit = [0, -1, 0]; }
    const fy = this.floorY(p[0], p[2]) + floorM;
    if (p[1] < fy) { p[1] = fy; hit = [0, 1, 0]; }
    if (this.round) {
      const r = this.rAt(p[1]) - m;
      const h = Math.hypot(p[0], p[2]);
      if (h > r) {
        const k = Math.max(0, r) / (h || 1);
        hit = [-p[0] / (h || 1), 0, -p[2] / (h || 1)];
        p[0] *= k; p[2] *= k;
      }
    } else {
      const hx = this.W / 2 - m, hz = this.D / 2 - m;
      if (p[0] > hx) { p[0] = hx; hit = [-1, 0, 0]; } else if (p[0] < -hx) { p[0] = -hx; hit = [1, 0, 0]; }
      if (p[2] > hz) { p[2] = hz; hit = [0, 0, -1]; } else if (p[2] < -hz) { p[2] = -hz; hit = [0, 0, 1]; }
    }
    return hit;
  }

  inside(p, m = 0) {
    if (p[1] > this.waterY - m || p[1] < this.floorY(p[0], p[2]) + m) return false;
    if (this.round) return Math.hypot(p[0], p[2]) <= this.rAt(p[1]) - m;
    return Math.abs(p[0]) <= this.W / 2 - m && Math.abs(p[2]) <= this.D / 2 - m;
  }

  // distance-ish to the nearest wall (for steering), and the inward normal
  wallAvoid(p, range) {
    const out = [0, 0, 0];
    if (this.round) {
      const h = Math.hypot(p[0], p[2]) || 0.001, r = this.rAt(p[1]);
      const d = r - h;
      if (d < range) { const k = 1 - d / range; out[0] -= (p[0] / h) * k; out[2] -= (p[2] / h) * k; }
    } else {
      const hx = this.W / 2, hz = this.D / 2;
      if (hx - p[0] < range) out[0] -= 1 - (hx - p[0]) / range;
      if (p[0] + hx < range) out[0] += 1 - (p[0] + hx) / range;
      if (hz - p[2] < range) out[2] -= 1 - (hz - p[2]) / range;
      if (p[2] + hz < range) out[2] += 1 - (p[2] + hz) / range;
    }
    const top = this.waterY - p[1], bot = p[1] - this.floorY(p[0], p[2]);
    if (top < range * 0.6) out[1] -= 1 - top / (range * 0.6);
    if (bot < range * 0.6) out[1] += 1 - bot / (range * 0.6);
    return out;
  }

  // a random swimmable point with its height at fraction y01 of the local water column (0 floor .. 1 surface)
  swimPoint(rnd = Math.random, y01 = 0.5, m = 2) {
    let x, z;
    if (this.round) {
      const y = lerp(this.floorY(0, 0) + m, this.waterY - m, y01);
      const r = Math.max(0.5, this.rAt(y) - m);
      const a = rnd() * TAU, k = Math.sqrt(rnd()) * r;
      x = Math.cos(a) * k; z = Math.sin(a) * k;
      const p = [x, y, z];
      this.clamp(p, m);
      return p;
    }
    x = (rnd() - 0.5) * (this.W - 2 * m); z = (rnd() - 0.5) * (this.D - 2 * m);
    const fy = this.floorY(x, z);
    const p = [x, lerp(fy + m, this.waterY - m, y01), z];
    this.clamp(p, m);
    return p;
  }

  // ray (origin o, unit dir d) vs the water volume's bounding shape: entry distance or null
  rayHit(o, d) {
    if (this.round) {
      // march the profile: first sample inside the glass
      const tc = this.rayBox(o, d, [-this.R, 0, -this.R], [this.R, this.top, this.R]);
      if (!tc) return null;
      const n = 48, step = (tc[1] - tc[0]) / n;
      for (let i = 0; i <= n; i++) {
        const t = tc[0] + step * i;
        const x = o[0] + d[0] * t, y = o[1] + d[1] * t, z = o[2] + d[2] * t;
        if (Math.hypot(x, z) <= this.rAt(y)) return t;
      }
      return null;
    }
    const r = this.rayBox(o, d, [-this.W / 2, 0, -this.D / 2], [this.W / 2, this.top, this.D / 2]);
    return r ? r[0] : null;
  }

  rayBox(o, d, lo, hi) {
    let t0 = -Infinity, t1 = Infinity;
    for (let k = 0; k < 3; k++) {
      if (Math.abs(d[k]) < 1e-9) { if (o[k] < lo[k] || o[k] > hi[k]) return null; continue; }
      let a = (lo[k] - o[k]) / d[k], b = (hi[k] - o[k]) / d[k];
      if (a > b) [a, b] = [b, a];
      t0 = Math.max(t0, a); t1 = Math.min(t1, b);
      if (t0 > t1) return null;
    }
    if (t1 < 0) return null;
    return [Math.max(0, t0), t1];
  }
}

// ------------------------------------------------------------------ fish
const STYLE = (sp, kind) => {
  if (kind === 'crab') return 'crawl';
  if (kind === 'jelly') return 'drift';
  if (kind === 'ray') return 'glide';
  const s = sp.move?.style || 'swim';
  if (s === 'crawl') return 'crawl';
  if (s === 'drift' || s === 'hover') return 'hover';
  if (s === 'glide') return 'glide';
  return 'swim';
};

export class TankFish {
  constructor(rec, sp, len) {
    this.rec = rec; this.sp = sp; this.id = rec.uid;
    this.kind = fishKind(sp);
    this.style = STYLE(sp, this.kind);
    this.baseLen = len; this.len = len;
    const m = sp.move || {};
    const t = sp.traits || {};
    this.curiosity = clamp01(t.curiosity ?? 0.5);
    this.shyness = clamp01(t.shyness ?? 0.4);
    this.agility = m.agility ?? 3;
    this.band = m.depth || [0.15, 0.85];
    this.school = m.school || 0;
    this.speedK = clamp((m.speed ?? 16) / 16, 0.45, 2.4);
    this.p = [0, 5, 0];
    this.yaw = rng.float(0, TAU); this.pitch = 0; this.bank = 0;
    this.speed = 0; this.vy = 0;
    this.phase = rng.next(); this.age = rng.float(0, 10);
    this.state = 'wander'; this.stateT = 0; this.target = null; this.wanderT = 0;
    this.emote = null;
    this.wiggle = 0; this.wiggleV = 0;
    this.baby = 0;
    this.alpha = 1;
    this.mate = null; this.gather = null; this.thinkT = rng.float(0, 0.5);
  }

  get cruise() { return this.len * 0.9 * this.speedK * (this.style === 'hover' ? 0.45 : this.style === 'crawl' ? 0.5 : this.style === 'glide' ? 0.75 : 1); }
  get dir() { const cp = Math.cos(this.pitch); return [Math.cos(this.yaw) * cp, Math.sin(this.pitch), -Math.sin(this.yaw) * cp]; }

  say(icon, time = 1.6) { this.emote = { icon, t: 0, max: time }; }
  feel() { /* low-poly fish have no face rig; kept for decor scripts */ }
  setState(s, target = null) { this.state = s; this.stateT = 0; this.target = target; }
  poke(k = 6) { this.wiggleV += k; }

  update(dt, W) {
    this.age += dt; this.stateT += dt;
    if (this.emote) { this.emote.t += dt; if (this.emote.t > this.emote.max) this.emote = null; }
    if (this.baby > 0) { this.baby -= dt; this.len = this.baseLen * (0.6 + 0.4 * clamp01(1 - this.baby / 40)); }
    else this.len = this.baseLen;
    this.wiggleV += (-this.wiggle * 120 - this.wiggleV * 10) * dt;
    this.wiggle = clamp(this.wiggle + this.wiggleV * dt, -1, 1);
    this.thinkT -= dt;
    if (this.thinkT <= 0) { this.thinkT = 0.25 + rng.float(0, 0.2); this.think(W); }
    const want = this.desired(W);
    this.move(dt, want, W);
    // tail beat follows effort
    const s01 = clamp01(this.speed / Math.max(0.1, this.cruise * 2));
    this.phase = (this.phase + dt * (this.style === 'hover' ? 0.6 : 0.9 + s01 * 3.2)) % 1;
  }

  think(W) {
    const rec = this.rec, T = W.tank;
    void rec;
    const av = W.avatar;
    // the swimmer: shy fish bolt, curious ones come for a look
    if (av && this.state !== 'eat') {
      const d = v3len(av.p[0] - this.p[0], av.p[1] - this.p[1], av.p[2] - this.p[2]);
      const near = av.r * 2.2 + this.len * 1.5;
      if (d < near && (av.speed > av.r * 2.5 || this.shyness > 0.62) && this.state !== 'flee') {
        const away = [this.p[0] - av.p[0], this.p[1] - av.p[1], this.p[2] - av.p[2]];
        const l = v3len(...away) || 1;
        const tg = [this.p[0] + away[0] / l * T.minDim * 0.5, this.p[1] + away[1] / l * T.minDim * 0.3, this.p[2] + away[2] / l * T.minDim * 0.5];
        T.clamp(tg, this.len);
        this.setState('flee', tg);
        if (rng.chance(0.4)) this.say('!', 1);
        W.onStartle?.(this);
        return;
      }
      if (this.state === 'wander' && d < near * 3 && av.speed < av.r * 1.5 && rng.chance(this.curiosity * 0.25)) {
        this.setState('curious');
        if (rng.chance(0.4)) this.say('?', 1.2);
        return;
      }
    }
    // the cursor at the glass (orbit view): curious fish come to look, a fast swipe startles
    const cu = W.cursor;
    if (cu && !av && (this.state === 'wander' || this.state === 'curious')) {
      const d = v3len(cu.p[0] - this.p[0], cu.p[1] - this.p[1], cu.p[2] - this.p[2]);
      if (cu.speed > 700 && d < T.minDim * 0.45) {
        const away = [this.p[0] * 2 - cu.p[0], this.p[1], this.p[2] * 2 - cu.p[2]];
        T.clamp(away, this.len);
        this.setState('flee', away);
        if (rng.chance(0.3)) this.say('!', 0.9);
        return;
      }
      if (this.state === 'wander' && d < T.minDim * 1.4 && cu.speed < 200 && rng.chance(this.curiosity * 0.05)) { this.setState('curious'); if (rng.chance(0.3)) this.say('?', 1); return; }
    }
    if (this.state === 'flee' && this.stateT > 1.6) this.setState('wander');
    if (this.state === 'curious' && ((!av && !cu) || this.stateT > 6)) this.setState('wander');
    if (this.state === 'gather' && (!this.gather || this.stateT > (this.gather.time || 5))) { this.gather = null; this.setState('wander'); }
    // food
    if (this.state !== 'flee' && this.state !== 'eat' && W.food.length && (rec.hunger ?? 0.3) > 0.12) {
      let best = null, bd = Infinity;
      for (const f of W.food) { if (f.eaten) continue; const d = v3len(f.p[0] - this.p[0], f.p[1] - this.p[1], f.p[2] - this.p[2]); if (d < bd) { bd = d; best = f; } }
      if (best && (bd < T.minDim * 1.2 || rng.chance(0.5))) { this.setState('eat'); this.food = best; return; }
    }
    if (this.state === 'eat' && (!this.food || this.food.eaten)) { this.food = null; this.setState('wander'); }
    // night: sleepy fish drift low and slow
    if (W.night && this.state === 'wander' && rng.chance(0.08)) { this.setState('sleep', T.swimPoint(Math.random, rng.float(0.05, 0.3), this.len)); this.say('zzz', 2); return; }
    if (this.state === 'sleep' && (!W.night || this.stateT > 30)) this.setState('wander');
    // courting pairs
    if (this.state === 'wander' && W.canCourt?.(this) && rng.chance(0.06)) {
      const m = W.fish.find((o) => o !== this && o.sp === this.sp && o.state === 'wander' && W.canCourt(o));
      if (m) { this.setState('court'); this.mate = m; m.setState('court'); m.mate = this; this.say('heart', 1.5); m.say('heart', 1.5); return; }
    }
    if (this.state === 'court') {
      const m = this.mate;
      if (!m || !W.fish.includes(m) || m.state !== 'court' || this.stateT > 10) { this.mate = null; this.setState('wander'); }
      else if (this.stateT > 6 && this.id < m.id) { W.onCourt?.(this, m); this.setState('wander'); m.setState('wander'); this.mate = m.mate = null; }
    }
    if (this.state === 'wander') {
      this.wanderT -= 0.3;
      if (!this.target || this.wanderT <= 0 || v3len(this.target[0] - this.p[0], this.target[1] - this.p[1], this.target[2] - this.p[2]) < this.len * 0.8) this.pickTarget(W);
    }
  }

  pickTarget(W) {
    const T = W.tank;
    const [a, b] = this.band;
    let y01 = 1 - rng.float(a, b);
    if (this.style === 'crawl') y01 = 0;
    if (this.style === 'glide') y01 = rng.float(0.02, 0.25);
    // schoolers lean toward their buddies
    let p = T.swimPoint(Math.random, y01, this.len * 0.7);
    if (this.school > 0 || rng.chance(0.2)) {
      const buddies = W.fish.filter((o) => o !== this && o.sp === this.sp);
      if (buddies.length) {
        const o = buddies[Math.floor(rng.next() * buddies.length)];
        p = [lerp(p[0], o.p[0], 0.6), lerp(p[1], o.p[1], 0.5), lerp(p[2], o.p[2], 0.6)];
      }
    }
    // a peek at a decoration now and then
    if (W.decor.length && rng.chance(0.18)) {
      const d = W.decor[Math.floor(rng.next() * W.decor.length)];
      p = [d.p[0] + rng.float(-1, 1) * d.r, d.p[1] + d.h * rng.float(0.3, 1.1), d.p[2] + d.r * rng.float(0.6, 1.2)];
      T.clamp(p, this.len * 0.6);
    }
    this.target = p;
    this.wanderT = rng.float(3, 8);
  }

  // where this fish wants to go now: [dx, dy, dz] unit-ish and a speed
  desired(W) {
    const T = W.tank, p = this.p;
    let tg = this.target, sp = this.cruise;
    switch (this.state) {
      case 'flee': sp = this.cruise * 3.2; break;
      case 'eat': if (this.food) { tg = this.food.p; sp = this.cruise * 1.8; if (v3len(tg[0] - p[0], tg[1] - p[1], tg[2] - p[2]) < Math.max(0.6, this.len * 0.35)) W.onEat?.(this, this.food); } break;
      case 'curious': {
        const av = W.avatar, cu = W.cursor;
        if (av) {
          const a = this.age * 0.6 + this.id.length;
          tg = [av.p[0] + Math.cos(a) * av.r * 2.6, av.p[1] + Math.sin(a * 0.7) * av.r * 0.8, av.p[2] + Math.sin(a) * av.r * 2.6];
          T.clamp(tg, this.len * 0.6);
          sp = this.cruise * 1.2;
        } else if (cu) {
          // nose up to the glass where the cursor is
          const a = this.age * 0.9 + this.id.length;
          tg = [cu.p[0] + Math.cos(a) * this.len * 0.6, cu.p[1] + Math.sin(a * 1.3) * this.len * 0.3, cu.p[2]];
          T.clamp(tg, this.len * 0.55);
          sp = this.cruise * 0.9;
        }
        break;
      }
      case 'gather': if (this.gather) { const a = this.age * 1.2 + (this.id.charCodeAt(0) || 0); const g = this.gather; tg = [g.p[0] + Math.cos(a) * g.r, g.p[1] + Math.sin(a * 1.7) * g.r * 0.3, g.p[2] + Math.sin(a) * g.r]; T.clamp(tg, this.len * 0.6); sp = this.cruise * (g.dance ? 2 : 1.4); } break;
      case 'court': if (this.mate) { const m = this.mate, a = this.stateT * 2.4 + (this.id < m.id ? 0 : Math.PI); tg = [(p[0] + m.p[0]) / 2 + Math.cos(a) * this.len, (p[1] + m.p[1]) / 2 + Math.sin(a * 0.5) * this.len * 0.3, (p[2] + m.p[2]) / 2 + Math.sin(a) * this.len]; sp = this.cruise * 1.3; } break;
      case 'sleep': sp = this.cruise * 0.25; break;
      default: break;
    }
    if (!tg) return { d: this.dir, sp: sp * 0.5 };
    let dx = tg[0] - p[0], dy = tg[1] - p[1], dz = tg[2] - p[2];
    const dist = v3len(dx, dy, dz) || 0.001;
    dx /= dist; dy /= dist; dz /= dist;
    const arrive = this.len * 1.5;
    if (dist < arrive && this.state !== 'flee') sp *= Math.max(0.25, dist / arrive);
    // separation from neighbours (looser for the same species when schooling)
    let sx = 0, sy = 0, sz = 0;
    for (const o of W.fish) {
      if (o === this) continue;
      const ox = p[0] - o.p[0], oy = p[1] - o.p[1], oz = p[2] - o.p[2];
      const r = (this.len + o.len) * (o.sp === this.sp && this.school ? 0.45 : 0.6);
      const d2 = ox * ox + oy * oy + oz * oz;
      if (d2 > r * r || d2 < 1e-6) continue;
      const d = Math.sqrt(d2), k = (r - d) / r;
      sx += ox / d * k; sy += oy / d * k; sz += oz / d * k;
    }
    // decor: swim around solid pieces
    for (const c of W.decor) {
      const ox = p[0] - c.p[0], oz = p[2] - c.p[2];
      if (p[1] > c.p[1] + c.h + this.len * 0.3) continue;
      const r = c.r + this.len * 0.5;
      const d2 = ox * ox + oz * oz;
      if (d2 > r * r || d2 < 1e-6) continue;
      const d = Math.sqrt(d2), k = (r - d) / r;
      sx += ox / d * k * 1.5; sz += oz / d * k * 1.5; sy += k * 0.4;
    }
    const wa = T.wallAvoid(p, this.len * 1.4);
    dx += sx * 1.2 + wa[0] * 1.6; dy += sy * 1.2 + wa[1] * 1.6; dz += sz * 1.2 + wa[2] * 1.6;
    const l = v3len(dx, dy, dz) || 1;
    return { d: [dx / l, dy / l, dz / l], sp };
  }

  move(dt, want, W) {
    const T = W.tank, p = this.p;
    const turn = (1.4 + this.agility * 0.55) * (this.state === 'flee' ? 2 : 1) * (this.style === 'hover' ? 0.5 : 1);
    const [dx, dy, dz] = want.d;
    const wantYaw = Math.atan2(-dz, dx);
    const horiz = Math.hypot(dx, dz);
    const maxP = this.style === 'crawl' ? 0 : this.style === 'hover' ? 1.2 : 0.75;
    const wantPitch = clamp(Math.atan2(dy, horiz), -maxP, maxP);
    let dyaw = ((wantYaw - this.yaw + Math.PI) % TAU + TAU) % TAU - Math.PI;
    // a fish that wants to go straight back turns through a wide arc instead of spinning on the spot
    const step = clamp(dyaw, -turn * dt, turn * dt);
    this.yaw += step;
    this.bank = lerp(this.bank, clamp(-step / Math.max(dt, 1e-3) * 0.12, -0.5, 0.5), Math.min(1, dt * 4));
    this.pitch = lerp(this.pitch, wantPitch, Math.min(1, dt * turn * 0.8));
    // slow down for sharp turns
    const align = Math.cos(Math.min(Math.PI, Math.abs(dyaw)));
    const target = want.sp * (0.35 + 0.65 * Math.max(0, align));
    this.speed = lerp(this.speed, target, Math.min(1, dt * (this.state === 'flee' ? 5 : 1.8)));
    let sp = this.speed;
    if (this.style === 'hover') sp *= 0.6 + 0.8 * Math.max(0, Math.sin(this.phase * TAU));
    const d = this.dir;
    p[0] += d[0] * sp * dt; p[2] += d[2] * sp * dt;
    if (this.style === 'crawl') {
      p[1] = lerp(p[1], T.floorY(p[0], p[2]) + this.len * 0.18, Math.min(1, dt * 8));
      this.pitch = 0;
    } else {
      p[1] += d[1] * sp * dt + Math.sin(this.age * 1.7) * 0.02 * this.len * dt;
    }
    const hit = T.clamp(p, this.len * 0.45, this.style === 'crawl' ? this.len * 0.18 : this.len * 0.4);
    if (hit && this.style !== 'crawl') {
      // bounce the heading off the wall
      const nd = [d[0] + hit[0] * 1.5, d[1] + hit[1] * 1.5, d[2] + hit[2] * 1.5];
      this.yaw = lerp(this.yaw, Math.atan2(-nd[2], nd[0]), 0.3);
      if (this.state === 'wander' && rng.chance(0.3)) this.pickTarget(W);
    }
  }
}

// ------------------------------------------------------------------ Aero drops
export class Drops3D {
  constructor() { this.list = []; this.nextId = 1; this.k = 1; this.mergeT = 0; this.onMerge = null; }
  setScale(k) { this.k = k; for (const c of this.list) c.r = this.radius(c.d, c.value); }
  radius(d, value) {
    const base = [1.05, 1.3, 1.65][d] ?? 1.05;
    const extra = value > DENOMS[d] ? Math.min(0.8, Math.log2(value / DENOMS[d]) * 0.14) : 0;
    return (base + extra) * this.k;
  }
  spawn(p, d = 0, o = {}) {
    d = clamp(d | 0, 0, 2);
    const c = { id: this.nextId++, p: p.slice(), v: o.v ? o.v.slice() : [0, 0, 0], d, value: o.value ?? DENOMS[d], ph: rng.float(0, TAU), age: 0, rest: 0, sleep: false, hint: false, hold: o.hold ?? 0, r: 0 };
    c.r = this.radius(d, c.value);
    this.list.push(c);
    return c;
  }
  remove(c) { const i = this.list.indexOf(c); if (i >= 0) this.list.splice(i, 1); }
  step(dt, T, ripples) {
    const list = this.list;
    const drag = Math.exp(-dt * 2.4);
    const rise = 3.2 * this.k + 2;
    for (const c of list) {
      c.age += dt; c.ph += dt * 2.1;
      const restY = T.waterY - c.r * 0.35 + Math.sin(c.ph) * 0.08 * this.k;
      if (c.hint) {
        const hy = c.hintY ?? (c.hintY = lerp(T.floorY(c.p[0], c.p[2]) + c.r * 3, T.waterY, 0.35));
        c.v[1] += ((hy + Math.sin(c.ph * 0.9) * 0.4 * this.k - c.p[1]) * 3 - c.v[1]) * Math.min(1, dt * 4);
      } else if (c.hold > 0) { c.hold -= dt; c.v[1] *= drag; }
      else c.v[1] += (rise * (c.d === 2 ? 0.8 : 1) - c.v[1]) * Math.min(1, dt * 1.5);
      c.v[0] *= drag; c.v[2] *= drag;
      c.p[0] += (c.v[0] + Math.sin(c.ph * 0.7) * 0.5 * this.k) * dt;
      c.p[1] += c.v[1] * dt;
      c.p[2] += (c.v[2] + Math.cos(c.ph * 0.6) * 0.3 * this.k) * dt;
      if (c.p[1] >= restY) {
        if (!c.sleep && c.age > 0.3) ripples?.add(c.p[0], c.p[2], 0.25);
        c.p[1] = restY; if (c.v[1] > 0) c.v[1] = 0;
        c.rest += dt; c.sleep = true;
      } else { c.sleep = false; c.rest = 0; }
      const y = c.p[1];
      c.p[1] = Math.min(y, T.waterY);
      T.clamp(c.p, c.r + 0.3, c.r);
      if (c.sleep) c.p[1] = restY;
    }
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (!a.sleep) continue;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        if (!b.sleep) continue;
        const dx = b.p[0] - a.p[0], dz = b.p[2] - a.p[2];
        const min = (a.r + b.r) * 0.95;
        const d2 = dx * dx + dz * dz;
        if (d2 >= min * min) continue;
        const d = Math.sqrt(d2) || 0.01;
        const push = (min - d) * 0.5 * Math.min(1, dt * 8);
        const nx = d > 0.02 ? dx / d : rng.next() - 0.5, nz = d > 0.02 ? dz / d : rng.next() - 0.5;
        a.p[0] -= nx * push; b.p[0] += nx * push; a.p[2] -= nz * push; b.p[2] += nz * push;
      }
    }
    this.mergeT -= dt;
    if (list.length > DROP_CAP && this.mergeT <= 0) {
      this.mergeT = 0.12;
      const rest = list.filter((c) => c.sleep && !c.hint).sort((p, q) => p.value - q.value);
      if (rest.length >= 2) {
        const [a, b] = rest;
        a.value += b.value;
        a.d = a.value >= 25 ? 2 : a.value >= 5 ? 1 : 0;
        a.r = this.radius(a.d, a.value);
        a.p[0] = (a.p[0] + b.p[0]) / 2; a.p[2] = (a.p[2] + b.p[2]) / 2;
        this.remove(b);
        this.onMerge?.(a);
      }
    }
  }
}

// ------------------------------------------------------------------ surface ripples
export class Ripples {
  constructor() { this.list = []; this.t = 0; }
  add(x, z, amp = 0.5) { if (this.list.length > 24) this.list.shift(); this.list.push({ x, z, t0: this.t, a: amp }); }
  step(dt) { this.t += dt; this.list = this.list.filter((r) => this.t - r.t0 < 3); }
  // height offset (cm) at (x, z): ambient swell + ring waves
  height(x, z, k = 1) {
    const t = this.t;
    let h = (Math.sin(x * 0.21 + t * 1.6) * 0.5 + Math.sin(z * 0.27 - t * 1.3) * 0.4 + Math.sin((x + z) * 0.13 + t * 0.9) * 0.6) * 0.18 * k;
    for (const r of this.list) {
      const age = t - r.t0;
      const d = Math.hypot(x - r.x, z - r.z);
      const front = age * 9;
      const w = d - front;
      if (w > 3 || w < -10) continue;
      h += Math.sin(w * 1.6) * r.a * Math.exp(-age * 1.1) * Math.exp(-Math.abs(w) * 0.35) / (1 + d * 0.08);
    }
    return h;
  }
}
