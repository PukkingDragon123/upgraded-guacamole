// Tank helpers: the snail janitor (crawls the floor and the front glass), the coin crab, and egg clutches.
// Helpers live in tank space (X, z) and talk to the aquarium through a small interface:
//   aq.T (TankSpace), aq.view.fishScale, aq.coins (CoinPile), aq.collectCoin(c, by), aq.t

import { PixelBuffer } from '../gfx/pixel.js';
import { pack } from '../core/color.js';
import { ramp7 } from '../gfx/voxel.js';
import { clamp, clamp01, TAU, hash2, damp } from '../core/math.js';
import { rng } from '../core/rng.js';
import { compiled } from '../gfx/spritecache.js';
import { makeCanvas, ctxOf } from '../core/canvas.js';
import { VoxelModel, renderVoxels } from '../gfx/voxel.js';
import { drawVoxelFish } from '../gfx/voxelfish.js';

const SHELL_A = ramp7('#b0643a', 1), SHELL_B = ramp7('#f0d2a0', 0.9), FOOT = ramp7('#c8b8a4', 0.9);

// Voxel snail facing right (r = shell radius in px); frame 0..3 stretches the foot (crawl wave).
function snailSprite(r, frame) {
  const R = Math.max(2, Math.round(r / 2 * 2) / 2 + 1);
  const nx = Math.ceil(R * 4.6) + 4, ny = Math.ceil(R * 2.8) + 3, nz = Math.ceil(R * 2) + 3;
  const m = new VoxelModel(nx, ny, nz);
  const shA = m.color('#b0643a', { smooth: 0.5, spec: 0.8 }), shB = m.color('#f0d2a0', { smooth: 0.5, spec: 0.8 });
  const foot = m.color('#c8b8a4', { smooth: 0.4 }), footD = m.color('#9a8a7a', {}), eye = m.color('#20141a', { spec: 1.2 });
  const stretch = [0, 1, 2, 1][frame];
  const zc = nz / 2, sx = R + 1.5, sy = R + 1.2;
  // foot: a soft slab along the ground, head end raised
  for (let x = 1; x < nx - 2 + Math.min(0, stretch - 2); x++) {
    const t = x / (nx - 3);
    const hgt = t > 0.72 ? 2 + Math.round((t - 0.72) * 6) : 1;
    for (let y = 0; y < hgt; y++) for (let z = -1; z <= 1; z++) m.set(x + (t > 0.5 ? stretch * 0.5 : 0), y, Math.floor(zc + z), y === 0 ? footD : foot);
  }
  const hx = nx - 3 + stretch * 0.5;
  // eye stalks
  for (const dz of [-1, 1]) {
    for (let y = 2; y < 2 + Math.max(2, R); y++) m.set(Math.floor(hx + (y - 2) * 0.3), y, Math.floor(zc + dz), foot);
    m.set(Math.floor(hx + (Math.max(2, R) - 1) * 0.3), 2 + Math.max(2, R), Math.floor(zc + dz), eye);
  }
  // spiral shell: banded sphere
  for (let y = 0; y < ny; y++) for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) {
    const dx = x + 0.5 - sx, dy = y + 0.5 - sy, dz = (z + 0.5 - zc) * 1.25;
    const d = Math.hypot(dx, dy, dz);
    if (d > R) continue;
    const a = Math.atan2(dy, dx);
    const band = Math.floor((Math.hypot(dx, dy) / R) * 3 + (a / TAU) + 4) % 2;
    m.set(x, y, z, band ? shA : shB);
  }
  const rr = renderVoxels(m, { scale: 2, yaw: 0, pitch: 12, ao: 1, edges: 0.7, groundAO: true });
  const [ox, oy] = rr.project(sx, 0, zc);
  return { canvas: rr.canvas, ox: Math.round(ox), oy: Math.round(oy) };
}

const snailCache = new Map();
function snailFrames(r) {
  r = Math.max(2, Math.round(r * 2) / 2);
  let f = snailCache.get(r);
  if (!f) { f = [0, 1, 2, 3].map((i) => snailSprite(r, i)); snailCache.set(r, f); }
  return f;
}

// Rotated copy (quarter turns clockwise, optionally mirrored first) for climbing the glass.
const rotCache = new WeakMap();
function rotated(cv, q, mirror = false) {
  let m = rotCache.get(cv);
  if (!m) rotCache.set(cv, (m = {}));
  const key = q + (mirror ? 'm' : '');
  if (m[key]) return m[key];
  const c = makeCanvas(cv.height, cv.width);
  const g = ctxOf(c);
  g.translate(c.width / 2, c.height / 2);
  g.rotate(q * Math.PI / 2);
  if (mirror) g.scale(-1, 1);
  g.drawImage(cv, -cv.width / 2, -cv.height / 2);
  m[key] = c;
  return c;
}

export class Snail {
  constructor(aq) {
    const T = aq.T;
    this.X = T.W * rng.float(0.2, 0.8);
    this.z = 0.06;
    this.dir = 1;
    this.mode = 'floor';
    this.climb = 0; this.climbMax = 0;
    this.t = rng.float(0, 5);
    this.eatT = 0;
    this.idleT = 0;
  }

  rescale(sx) { this.X *= sx; }

  update(aq, dt) {
    const T = aq.T, vs = aq.view.fishScale;
    this.t += dt;
    this.eatT = Math.max(0, this.eatT - dt);
    const speed = 11 * vs;
    if (this.mode === 'glass') {
      // up the front corner of a side pane, a little rest, then back down
      this.climb = clamp(this.climb + this.cdir * speed * 0.8 * dt, 0, this.climbMax);
      if (this.cdir > 0 && this.climb >= this.climbMax) { this.idleT += dt; if (this.idleT > 2.5) { this.cdir = -1; this.idleT = 0; } }
      if (this.cdir < 0 && this.climb <= 0) { this.mode = 'floor'; this.dir = this.side === 'L' ? 1 : -1; }
      return;
    }
    if (this.mode === 'towall') {
      const tx = this.side === 'L' ? 4 : T.W - 4;
      this.dir = Math.sign(tx - this.X) || 1;
      this.X += this.dir * Math.min(Math.abs(tx - this.X), speed * dt);
      this.z = damp(this.z, 0.02, 1, dt);
      if (Math.abs(tx - this.X) < 0.5) { this.mode = 'glass'; this.cdir = 1; this.climb = 0; this.climbMax = (T.floorFront - T.surf) * rng.float(0.25, 0.6); this.z = 0; }
      return;
    }
    // nearest resting coin near the front of the floor
    let best = null, bd = Infinity;
    for (const c of aq.coins.list) {
      if (!c.sleep && !c.contact) continue;
      if (c.D / T.DEPTH > 0.3) continue;
      const d = Math.abs(c.X - this.X) + Math.abs(c.D / T.DEPTH - this.z) * T.W * 0.3;
      if (d < bd) { bd = d; best = c; }
    }
    if (best) {
      const dx = best.X - this.X;
      if (Math.abs(dx) > 1) this.dir = Math.sign(dx);
      this.X += this.dir * Math.min(Math.abs(dx), speed * dt);
      this.z = damp(this.z, clamp(best.D / T.DEPTH, 0.02, 0.3), 0.6, dt);
    } else {
      this.X += this.dir * speed * 0.6 * dt;
      if (this.X < 8 || this.X > T.W - 8) this.dir *= -1;
      if (rng.chance(dt * 0.04)) { this.mode = 'towall'; this.side = this.X < T.W / 2 ? 'L' : 'R'; }
    }
    this.X = clamp(this.X, 6, T.W - 6);
    if (this.eatT <= 0) {
      const reach = 6 * vs + 3;
      const gy = T.groundZ(this.X, this.z);
      for (const c of aq.coins.list) {
        if (Math.abs(c.X - this.X) < reach + c.r && Math.abs(c.D - this.z * T.DEPTH) < reach * 2 + c.r && c.Y > gy - c.r * 3.5) {
          aq.collectCoin(c, 'snail');
          this.eatT = 0.45;
          break;
        }
      }
    }
  }

  depth() { return this.mode === 'glass' ? 0 : this.z; }

  draw(ctx, aq) {
    const T = aq.T, vs = aq.view.fishScale;
    const z = this.depth();
    const s = T.s(z);
    const fr = snailFrames(5.2 * vs * s + 0.6);
    const f = fr[Math.floor(this.t * (this.mode === 'glass' || this.eatT > 0 ? 3 : 5)) % 4];
    const x = Math.round(T.sx(this.X, z)), gy = T.sy(T.groundZ(this.X, z), z);
    if (this.mode === 'glass') {
      // foot against the side glass: head up while climbing, down while creeping back
      const L = this.side === 'L', up = this.cdir > 0;
      const cv = L ? (up ? rotated(f.canvas, 1, true) : rotated(f.canvas, 1)) : (up ? rotated(f.canvas, 3) : rotated(f.canvas, 3, true));
      const y = Math.round(gy - this.climb - cv.height * 0.6);
      ctx.drawImage(cv, L ? Math.round(T.sx(0, 0)) + 1 : Math.round(T.sx(T.W, 0)) - cv.width - 1, y);
      return;
    }
    const y = Math.round(gy + 1);
    if (this.dir < 0) {
      ctx.save(); ctx.translate(x, 0); ctx.scale(-1, 1);
      ctx.drawImage(f.canvas, -f.ox, y - f.oy);
      ctx.restore();
    } else ctx.drawImage(f.canvas, x - f.ox, y - f.oy);
  }
}

const CRAB_LOOK = {
  kind: 'crab', body: { len: 22, h: 14 },
  col: { body: '#3aa88a', belly: '#bff0d8', fin: '#4cc8a0', outline: '#0c2a26' },
};

export class CoinCrab {
  constructor(aq) {
    const T = aq.T;
    this.X = T.W * rng.float(0.3, 0.7);
    this.z = 0.2;
    this.facing = 1;
    this.t = 0;
    this.walk = 0;
    this.pinchT = 0;
    this.restT = 0;
    this.c = compiled(CRAB_LOOK, null, 'coincrab');
  }

  rescale(sx) { this.X *= sx; }

  update(aq, dt) {
    const T = aq.T, vs = aq.view.fishScale;
    this.t += dt;
    this.pinchT = Math.max(0, this.pinchT - dt);
    if (this.restT > 0) { this.restT -= dt; this.walk = damp(this.walk, 0, 8, dt); return; }
    let best = null, bd = Infinity;
    for (const c of aq.coins.list) {
      if (!c.sleep && !c.contact) continue;
      const dz = (c.D / T.DEPTH - this.z) * T.W * 0.5;
      const d = Math.hypot(c.X - this.X, dz);
      if (d < bd) { bd = d; best = c; }
    }
    const speed = 34 * vs;
    if (best) {
      const tz = clamp(best.D / T.DEPTH, 0.03, 0.9);
      const dx = best.X - this.X, dz = (tz - this.z) * T.W * 0.5;
      const d = Math.hypot(dx, dz) || 1;
      const st = Math.min(d, speed * dt);
      this.X += (dx / d) * st;
      this.z += ((dz / d) * st) / (T.W * 0.5);
      if (Math.abs(dx) > 0.5) this.facing = Math.sign(dx);
      this.walk = damp(this.walk, 1, 6, dt);
      const reach = 9 * vs + 3;
      if (d < reach + best.r) {
        aq.collectCoin(best, 'crab');
        this.pinchT = 0.4;
        this.restT = 0.25;
      }
    } else {
      this.walk = damp(this.walk, 0, 4, dt);
      if (rng.chance(dt * 0.3)) { this.restT = 1; this.facing *= -1; }
    }
    this.X = clamp(this.X, 8, T.W - 8);
    this.z = clamp(this.z, 0.03, 0.9);
  }

  depth() { return this.z; }

  draw(ctx, aq) {
    const T = aq.T, vs = aq.view.fishScale;
    const s = T.s(this.z);
    const x = T.sx(this.X, this.z), y = T.sy(T.groundZ(this.X, this.z), this.z) - 4 * s * vs - Math.abs(Math.sin(this.t * 14)) * this.walk;
    this.turn = (this.turn ?? this.facing) + (this.facing - (this.turn ?? this.facing)) * 0.2;
    const pseudo = (this.pseudo ||= { c: this.c, quirks: new Set() });
    Object.assign(pseudo, { x, y, facing: this.facing, turn: this.turn, vx: this.walk * 20, vz: 0, angle: 0, tailPhase: 0, bob: 0, squash: Math.sin(this.t * 10) * 0.05 * this.walk, blink: (this.t % 3.3) < 0.12 ? 1 : 0, mouth: 0, emotion: 'neutral' });
    drawVoxelFish(ctx, pseudo, { scale: 0.75 * vs * s });
  }
}

// ------------------------------------------------------------------ eggs

const eggCache = new Map();
function eggSprite(r, color) {
  const key = r + color;
  let c = eggCache.get(key);
  if (c) return c;
  const R = ramp7(color, 0.8);
  const s = Math.ceil(r * 2) + 3;
  const b = new PixelBuffer(s, s);
  const cx = s / 2, cy = s / 2;
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const dx = x + 0.5 - cx, dy = y + 0.5 - cy, d = Math.hypot(dx, dy * 0.92);
    if (d > r) continue;
    const t = 4 - (dx + dy) / r + (d > r - 0.9 ? -1 : 0);
    b.set(x, y, pack(R[clamp(Math.round(t), 0, 6)], 215));
  }
  b.set(Math.floor(cx - r * 0.4), Math.floor(cy - r * 0.45), pack('#ffffff', 240));
  b.outline(() => pack(R[0], 200));
  c = b.toCanvas();
  eggCache.set(key, c);
  return c;
}

// egg: {X, z, t, dur, species, color, n}
export function drawEggs(ctx, aq, egg) {
  const T = aq.T, vs = aq.view.fishScale;
  const s = T.s(egg.z);
  const k = clamp01(egg.t / egg.dur);
  const r = Math.max(1, Math.round((2.4 * vs * s + 0.4) * 2) / 2);
  const spr = eggSprite(r, egg.color || '#ffd8a0');
  const cx = T.sx(egg.X, egg.z), cy = T.sy(T.groundZ(egg.X, egg.z), egg.z);
  for (let i = 0; i < egg.n; i++) {
    const a = i * 2.4, rr = (i ? 1.6 + (i % 3) * 0.7 : 0) * r;
    const wob = k > 0.82 ? Math.round(Math.sin(aq.t * 22 + i * 1.7) * (k > 0.95 ? 1.2 : 0.6)) : 0;
    const x = Math.round(cx + Math.cos(a) * rr * 1.3 - spr.width / 2 + wob), y = Math.round(cy - r - Math.abs(Math.sin(a)) * rr * 0.5 - spr.height / 2 + 1);
    ctx.drawImage(spr, x, y);
    if (k > 0.35) {
      ctx.fillStyle = '#1a1424';
      const ex = x + Math.floor(spr.width / 2) + (i % 2 ? 0 : 1), ey = y + Math.floor(spr.height / 2);
      ctx.fillRect(ex, ey, 1, 1);
      if (k > 0.6 && r >= 2) ctx.fillRect(ex - 1, ey, 1, 1);
    }
  }
}

export function eggColor(sp) {
  const c = sp?.look?.col?.body || '#ffcf8a';
  return c;
}

void hash2;
