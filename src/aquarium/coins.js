// Oxidized Coins: ray-traced 3D coin sprite sheets (spin x flip frames, rim thickness, embossed
// emblem, verdigris patina, specular glint) and a small rigid-circle pile simulation
// (water drag, bounces off a ground profile, stacking with sleeping bodies).
//
// coinSheet(denomIdx, screenRadius) -> {canvas, cell, r, half}; frame (i, j) at (i*cell, j*cell),
//   i = spin index (0..SPIN_N-1), j = flip index (0..FLIP_N-1); draw centred at (x - half, y - half).
// CoinPile: 3D spheres in tank space (X, Y front-plane px, D depth px) resting on a heightfield floor,
//   against the glass walls and around ellipsoid decor colliders.

import { makeCanvas, ctxOf } from '../core/canvas.js';
import { PixelBuffer, selOut } from '../gfx/pixel.js';
import { pack } from '../core/color.js';
import { bayer, hash2, fbm2, clamp, TAU } from '../core/math.js';
import { rng } from '../core/rng.js';

export const DENOMS = [1, 5, 25];
export const SPIN_N = 16, FLIP_N = 16;

// 6-step ramps, deep shadow -> glint.
const RAMPS = {
  copper: ['#2a1210', '#66291a', '#a8482a', '#e07640', '#fcac66', '#ffe8c4'],
  patina: ['#123a34', '#1f6a58', '#38a07e', '#62cc9e', '#9cecc0', '#e0fff2'],
  brass: ['#2e1e0c', '#6a4814', '#ac7c22', '#e2b23e', '#fadc78', '#fffbe2'],
  bronze: ['#24160e', '#553620', '#8c6036', '#bc8c52', '#e2bc80', '#fff2cc'],
  dark: ['#120a0c', '#2a1814', '#4a2a1e', '#6e4028', '#8e5a36', '#b07a4a'],
};
const PACKED = Object.fromEntries(Object.entries(RAMPS).map(([k, v]) => [k, v.map((h) => pack(h))]));
const MATS = ['copper', 'patina', 'brass', 'bronze', 'dark'];

// 3x5 digits for the reverse faces.
const DIGITS = { 1: ['.#.', '##.', '.#.', '.#.', '###'], 2: ['##.', '..#', '.#.', '#..', '###'], 5: ['###', '#..', '##.', '..#', '##.'] };

function digitAt(str, x, y, unit) {
  // (x, y) normalised face coords; unit = normalised size of one glyph pixel
  const w = str.length * 4 - 1;
  const gx = Math.floor(x / unit + w / 2), gy = Math.floor(y / unit + 2.5);
  if (gy < 0 || gy > 4 || gx < 0 || gx >= w) return false;
  const ci = Math.floor(gx / 4), cx = gx % 4;
  if (cx === 3) return false;
  return DIGITS[str[ci]]?.[gy][cx] === '#';
}

// Little fish emblem (raised): body ellipse, forked tail, recessed eye.
function fishAt(x, y, s) {
  x /= s; y /= s;
  const body = ((x + 0.1) / 0.44) ** 2 + (y / 0.27) ** 2 < 1;
  const tail = x > 0.26 && x < 0.62 && Math.abs(y) < 0.05 + (x - 0.26) * 0.85 && !(x > 0.5 && Math.abs(y) < (x - 0.5) * 1.2);
  const fin = y < -0.2 && y > -0.36 && x > -0.2 && x < 0.12 && y > -0.36 + (x + 0.2) * 0.4;
  if (!(body || tail || fin)) return 0;
  if (Math.hypot(x + 0.33, y + 0.05) < 0.075) return 0.25; // eye
  if (body && Math.abs(x - 0.18) < 0.03 && Math.abs(y) < 0.18) return 0.45; // gill line
  return 0.75;
}

// Face texture sample: {h (relief 0..1), m (material index), t (tone offset)}.
// Oxidation sits in the recesses (verdigris), raised rims and emblems are worn back to bright metal.
function faceSample(d, back, x, y, R) {
  const r = Math.hypot(x, y);
  const seed = d * 17 + (back ? 5 : 0);
  const n = fbm2(x * 2.6 + seed, y * 2.6 - seed, 3, 11 + d);
  const speck = hash2(Math.floor((x + 1) * R * 1.1), Math.floor((y + 1) * R * 1.1), 40 + d + (back ? 9 : 0));
  const field = (metal) => ({ h: 0.1, m: n > 0.6 ? metal : 1, t: speck > 0.9 ? 0.25 : n > 0.5 ? -0.05 : 0.05 });
  if (d === 0) {
    // copper penny with a leaping fish
    if (r > 0.8) return { h: 0.9, m: 0, t: 0.2 };
    if (r > 0.71) return { h: 0.02, m: 1, t: -0.3 };
    const relief = back ? (digitAt('1', x, y, 0.22) ? 0.8 : 0) : fishAt(x, y, 0.98);
    if (relief) return { h: relief, m: 0, t: relief > 0.5 ? 0.3 : -0.2 };
    return field(0);
  }
  if (d === 1) {
    // bronze ring coin: inner lip, ring of studs, thick verdigris
    if (r > 0.82) return { h: 0.85, m: 3, t: 0.2 };
    if (r > 0.75) return { h: 0.02, m: 1, t: -0.3 };
    if (r < 0.42) return { h: 0.75, m: 3, t: 0.2 };
    if (r < 0.48) return { h: 0.02, m: 1, t: -0.3 };
    const a = Math.atan2(y, x);
    const studs = back ? 5 : 8;
    const sa = Math.round(a / TAU * studs) * TAU / studs;
    if (Math.hypot(x - Math.cos(sa) * 0.615, y - Math.sin(sa) * 0.615) < 0.1) return { h: 0.8, m: 3, t: 0.3 };
    return { h: 0.1, m: n > 0.7 ? 3 : 1, t: speck > 0.88 ? 0.25 : 0 };
  }
  // 25: bimetal - polished brass core with a fish, copper ring with verdigris, reeded rim
  if (r > 0.87) return { h: 0.9, m: 0, t: 0.2 };
  if (r > 0.8) return { h: 0.02, m: 1, t: -0.3 };
  if (r > 0.62) {
    const a = Math.atan2(y, x);
    const dot = Math.abs(((a / TAU) * 12 + 12.5) % 1 - 0.5) < 0.13 && Math.abs(r - 0.71) < 0.045;
    return dot ? { h: 0.7, m: 0, t: 0.3 } : field(0);
  }
  if (r > 0.56) return { h: 0.0, m: 4, t: 0.1 };
  const relief = back ? (digitAt('25', x, y, 0.13) ? 0.75 : 0) : fishAt(x, y, 0.56);
  if (relief) return { h: 0.35 + relief * 0.6, m: 2, t: relief > 0.5 ? 0.35 : -0.1 };
  return { h: 0.35, m: 2, t: -0.12 };
}

const TEX = 48;
function buildFaceTex(d, back, R) {
  const h = new Float32Array(TEX * TEX), m = new Uint8Array(TEX * TEX), t = new Float32Array(TEX * TEX);
  for (let j = 0; j < TEX; j++) for (let i = 0; i < TEX; i++) {
    const x = ((i + 0.5) / TEX) * 2 - 1, y = ((j + 0.5) / TEX) * 2 - 1;
    const s = faceSample(d, back, x, y, R);
    const k = j * TEX + i;
    h[k] = s.h; m[k] = s.m; t[k] = s.t;
  }
  return { h, m, t };
}

function texIdx(x, y) {
  const i = clamp(Math.floor((x + 1) * 0.5 * TEX), 0, TEX - 1), j = clamp(Math.floor((y + 1) * 0.5 * TEX), 0, TEX - 1);
  return j * TEX + i;
}

const L = (() => { const v = [-0.45, -0.62, -0.64]; const n = Math.hypot(...v); return v.map((c) => c / n); })();
const HV = (() => { const v = [L[0], L[1], L[2] - 1]; const n = Math.hypot(...v); return v.map((c) => c / n); })();

// Basis of the coin for spin a (about view y) then flip b (about view x).
function basis(a, b) {
  const rot = (v) => {
    let [x, y, z] = v;
    const x1 = x * Math.cos(a) + z * Math.sin(a), z1 = -x * Math.sin(a) + z * Math.cos(a);
    x = x1; z = z1;
    const y2 = y * Math.cos(b) - z * Math.sin(b), z2 = y * Math.sin(b) + z * Math.cos(b);
    return [x, y2, z2];
  };
  return { u: rot([1, 0, 0]), v: rot([0, 1, 0]), n: rot([0, 0, -1]) };
}

const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

function shadePx(nv, mat, tone, x, y, metal) {
  const nl = Math.hypot(nv[0], nv[1], nv[2]) || 1;
  const N = [nv[0] / nl, nv[1] / nl, nv[2] / nl];
  const diff = Math.max(0, dot3(N, L));
  const spec = Math.pow(Math.max(0, dot3(N, HV)), metal ? 22 : 7) * (metal ? 1.25 : 0.35);
  const v = 0.3 + diff * 0.78 + spec + tone * 0.7;
  const idx = clamp(Math.floor(v * 4.1 + (bayer(x, y) - 0.5) * 0.5), 0, 5);
  return PACKED[MATS[mat]][idx];
}

function renderFrame(d, R, T, a, b, tex, cell) {
  const buf = new PixelBuffer(cell, cell);
  const { u, v, n } = basis(a, b);
  const Rt = R - 0.3;
  const half = cell / 2;
  const hole = d === 1 ? 0.27 * R : 0;
  const reeded = d === 2;
  const bumpK = 0.9 / R;
  for (let py = 0; py < cell; py++) for (let px = 0; px < cell; px++) {
    const o = [px + 0.5 - half, py + 0.5 - half, -50];
    const ol = [dot3(o, u), dot3(o, v), dot3(o, n)];
    const dl = [u[2], v[2], n[2]];
    // slab |z| <= T (local z along n)
    let s0, s1;
    if (Math.abs(dl[2]) < 1e-6) { if (Math.abs(ol[2]) > T) continue; s0 = -1e9; s1 = 1e9; }
    else { const ta = (-T - ol[2]) / dl[2], tb = (T - ol[2]) / dl[2]; s0 = Math.min(ta, tb); s1 = Math.max(ta, tb); }
    // cylinder radius R
    const A = dl[0] * dl[0] + dl[1] * dl[1], B = 2 * (ol[0] * dl[0] + ol[1] * dl[1]), C = ol[0] * ol[0] + ol[1] * ol[1] - Rt * Rt;
    let c0, c1;
    if (A < 1e-9) { if (C > 0) continue; c0 = -1e9; c1 = 1e9; }
    else { const disc = B * B - 4 * A * C; if (disc < 0) continue; const sq = Math.sqrt(disc); c0 = (-B - sq) / (2 * A); c1 = (-B + sq) / (2 * A); }
    const t0 = Math.max(s0, c0), t1 = Math.min(s1, c1);
    if (t0 >= t1) continue;
    const hx = ol[0] + t0 * dl[0], hy = ol[1] + t0 * dl[1], hz = ol[2] + t0 * dl[2];
    let col;
    if (s0 >= c0) {
      // face hit
      const front = hz > 0;
      const rr = Math.hypot(hx, hy);
      if (hole && rr < hole) {
        // through the hole: inner wall or nothing
        if (A < 1e-9) continue;
        const C2 = ol[0] * ol[0] + ol[1] * ol[1] - hole * hole;
        const disc = B * B - 4 * A * C2;
        if (disc < 0) continue;
        const tw = (-B + Math.sqrt(disc)) / (2 * A);
        if (tw >= s1) continue;
        const wx = ol[0] + tw * dl[0], wy = ol[1] + tw * dl[1];
        const nn = [-wx / hole, -wy / hole];
        const nv = [nn[0] * u[0] + nn[1] * v[0], nn[0] * u[1] + nn[1] * v[1], nn[0] * u[2] + nn[1] * v[2]];
        buf.set(px, py, shadePx(nv, 4, 0.1, px, py, true));
        continue;
      }
      const sx = (front ? hx : -hx) / R, sy = hy / R;
      const T_ = front ? tex.front : tex.back;
      const k = texIdx(sx, sy);
      const step = 0.55 / R;
      const gx = (T_.h[texIdx(sx + step, sy)] - T_.h[texIdx(sx - step, sy)]) / (2 * step) * bumpK;
      const gy = (T_.h[texIdx(sx, sy + step)] - T_.h[texIdx(sx, sy - step)]) / (2 * step) * bumpK;
      const fs = front ? 1 : -1;
      const tu = front ? u : [-u[0], -u[1], -u[2]];
      const fn = [n[0] * fs, n[1] * fs, n[2] * fs];
      const nv = [fn[0] - gx * tu[0] - gy * v[0], fn[1] - gx * tu[1] - gy * v[1], fn[2] - gx * tu[2] - gy * v[2]];
      const m = T_.m[k];
      col = shadePx(nv, m, T_.t[k] + (T_.h[k] - 0.4) * 0.25, px, py, m !== 1);
    } else {
      // rim
      const nn = [hx / Rt, hy / Rt];
      const nv = [nn[0] * u[0] + nn[1] * v[0], nn[0] * u[1] + nn[1] * v[1], nn[0] * u[2] + nn[1] * v[2]];
      let tone = 0.1;
      if (reeded) tone = Math.cos(Math.atan2(hy, hx) * 30) > 0.2 ? 0.12 : -0.18;
      const mat = d === 1 ? 3 : 0;
      const pat = hash2(Math.floor(Math.atan2(hy, hx) * 6), Math.floor(hz * 3), 77 + d) > 0.78;
      col = shadePx(nv, pat ? 1 : mat, tone - 0.05, px, py, !pat);
    }
    buf.set(px, py, col);
  }
  buf.outline(selOut(0.78));
  return buf;
}

// Sheets are keyed by denomination and on-screen radius (0.5 px buckets): coins shrink with depth.
const sheets = new Map();
const queue = [];
function radiusKey(r) { return Math.max(2, Math.round(r * 2) / 2); }

function buildSheet(d, R) {
  const T = clamp(R * 0.17, 0.6, 1.25);
  const cell = Math.ceil(R + T) * 2 + 3;
  const tex = { front: buildFaceTex(d, false, R), back: buildFaceTex(d, true, R) };
  const sheet = new PixelBuffer(cell * SPIN_N, cell * FLIP_N);
  for (let j = 0; j < FLIP_N; j++) for (let i = 0; i < SPIN_N; i++) {
    const f = renderFrame(d, R, T, (i / SPIN_N) * TAU, (j / FLIP_N) * TAU, tex, cell);
    for (let y = 0; y < cell; y++) for (let x = 0; x < cell; x++) {
      const c = f.data[y * cell + x];
      if (c) sheet.data[(j * cell + y) * sheet.w + i * cell + x] = c;
    }
  }
  return { canvas: sheet.toCanvas(), cell, r: R, half: Math.floor(cell / 2) };
}

// Sheet for denomination d at on-screen radius r. Missing sizes are queued (built by pumpCoinSheets)
// and the nearest built size is returned meanwhile; `now` forces a synchronous build.
export function coinSheet(d, r, now = false) {
  const R = radiusKey(r);
  const key = d * 1000 + R * 2;
  let s = sheets.get(key);
  if (s) return s;
  if (now) { s = buildSheet(d, R); sheets.set(key, s); return s; }
  if (!queue.some((q) => q.key === key)) queue.push({ key, d, R });
  let best = null, bd = Infinity;
  for (const [k, v] of sheets) {
    if (Math.floor(k / 1000) !== d) continue;
    const dd = Math.abs(v.r - R);
    if (dd < bd) { bd = dd; best = v; }
  }
  if (!best) { best = buildSheet(d, R); sheets.set(key, best); queue.splice(queue.findIndex((q) => q.key === key), 1); }
  return best;
}

// Build queued sheets within a small time budget (call once per frame).
export function pumpCoinSheets(budgetMs = 4) {
  const t0 = performance.now();
  while (queue.length && performance.now() - t0 < budgetMs) {
    const q = queue.shift();
    if (!sheets.has(q.key)) sheets.set(q.key, buildSheet(q.d, q.R));
  }
}

export const COIN_R = [5.5, 6.5, 8];

// Tiny 4-point glint sprite (additive).
let glintCv = null;
export function glintSprite() {
  if (glintCv) return glintCv;
  glintCv = makeCanvas(7, 7);
  const g = ctxOf(glintCv);
  g.fillStyle = 'rgba(255,250,220,1)';
  g.fillRect(3, 1, 1, 5); g.fillRect(1, 3, 5, 1);
  g.fillStyle = 'rgba(255,240,190,0.55)';
  g.fillRect(3, 0, 1, 1); g.fillRect(3, 6, 1, 1); g.fillRect(0, 3, 1, 1); g.fillRect(6, 3, 1, 1);
  g.fillStyle = 'rgba(255,255,255,1)';
  g.fillRect(3, 3, 1, 1);
  return glintCv;
}

// ------------------------------------------------------------------ physics (3D)

const G = 170, DRAG = 2.3, FLUTTER = 40, E_GROUND = 0.3, E_COIN = 0.16, FRICTION = 0.35, CELL = 12;
let nextId = 1;
const gkey = (ix, iy, id) => (ix * 128 + iy) * 128 + id;

export class CoinPile {
  // tank: {W, DEPTH, ground(X, D) -> top Y, slope(X, D) -> [dY/dX, dY/dD], colliders: [{X, D, R, top, base}]}
  constructor() {
    this.list = [];
    this.tank = null;
    this.grid = new Map();
    this.onBounce = null;
    this.scale = 1;
  }

  setTank(tank, scale) {
    this.tank = tank;
    if (scale !== this.scale) {
      this.scale = scale;
      for (const c of this.list) this.applySize(c);
    }
    this.wakeAll();
  }

  applySize(c) {
    c.vr = COIN_R[c.d] * this.scale;
    c.r = c.vr * 0.8;
  }

  spawn(X, Y, D, d, opts = {}) {
    const c = {
      id: nextId++, X, Y, D, vx: opts.vx ?? 0, vy: opts.vy ?? 0, vd: opts.vd ?? 0, d, value: opts.value ?? DENOMS[d],
      spin: rng.float(0, TAU), flip: rng.float(0, TAU), ws: rng.float(5, 12) * rng.sign(), wf: rng.float(2, 7) * rng.sign(),
      sleep: false, restT: 0, age: 0, contact: false, ph: rng.float(0, TAU), ph2: rng.float(0, TAU), glint: rng.float(2, 9),
      restSpin: (rng.chance(0.62) ? 0 : Math.PI) + rng.pick([-1, 0, 0, 1]) * (TAU / SPIN_N),
      restFlip: rng.pick([-1, 0, 0, 0, 1]) * (TAU / FLIP_N), r: 1, vr: 1,
    };
    this.applySize(c);
    this.list.push(c);
    return c;
  }

  remove(c) {
    const i = this.list.indexOf(c);
    if (i >= 0) this.list.splice(i, 1);
    this.wakeAround(c.X, c.Y, c.D, c.r * 2 + 6);
  }

  wakeAround(X, Y, D, rad) {
    for (const c of this.list) {
      if (c.sleep && Math.abs(c.X - X) < rad + c.r && Math.abs(c.D - D) < rad + c.r && c.Y < Y + rad) { c.sleep = false; c.restT = 0; }
    }
  }

  wakeAll() { for (const c of this.list) { c.sleep = false; c.restT = 0; } }

  step(dt) {
    if (!this.tank) return;
    const steps = Math.max(1, Math.min(6, Math.ceil(dt / (1 / 110))));
    const h = dt / steps;
    this.h = h;
    for (let s = 0; s < steps; s++) this.substep(h);
    for (const c of this.list) {
      c.age += dt;
      c.glint -= dt;
      if (c.sleep) continue;
      if (c.contact) {
        const k = 1 - Math.exp(-7 * dt);
        c.ws *= Math.exp(-5 * dt); c.wf *= Math.exp(-5 * dt);
        c.spin += angDiff(c.spin, c.restSpin) * k + c.ws * dt * 0.3;
        c.flip += angDiff(c.flip, c.restFlip) * k + c.wf * dt * 0.3;
      } else {
        const sp = Math.min(1, Math.hypot(c.vx, c.vy) / 60);
        c.spin += c.ws * dt * (0.4 + sp);
        c.flip += c.wf * dt * (0.4 + sp);
      }
    }
  }

  substep(h) {
    const list = this.list;
    const damp = Math.exp(-DRAG * h);
    for (const c of list) {
      if (c.sleep) continue;
      c.vy += G * h;
      c.vx *= damp; c.vy *= damp; c.vd *= damp;
      if (!c.contact) {
        c.vx += Math.sin(c.age * 6.5 + c.ph) * FLUTTER * h;
        c.vd += Math.sin(c.age * 5.1 + c.ph2) * FLUTTER * 0.6 * h;
      } else if (c.coinContact) { const k = Math.exp(-4 * h); c.vx *= k; c.vd *= k; }
      c.X += c.vx * h; c.Y += c.vy * h; c.D += c.vd * h;
      c.contact = false;
      c.coinContact = false;
      c.slope = 0;
    }
    this.buildGrid();
    for (let it = 0; it < 2; it++) {
      for (const c of list) {
        if (c.sleep) continue;
        this.collideWorld(c, it === 0);
        this.collidePairs(c, it === 0);
      }
    }
    for (const c of list) {
      if (c.sleep) continue;
      const v2 = c.vx * c.vx + c.vy * c.vy + c.vd * c.vd;
      if (c.contact && v2 < (c.coinContact ? 30 : c.slope > 0.012 ? 3 : 20)) {
        c.restT += h;
        if (c.restT > 0.35) { c.sleep = true; c.vx = 0; c.vy = 0; c.vd = 0; }
      } else c.restT = 0;
    }
  }

  buildGrid() {
    const g = this.grid;
    g.clear();
    for (const c of this.list) {
      const k = gkey((c.X / CELL) | 0, (c.Y / CELL) | 0, (c.D / CELL) | 0);
      let a = g.get(k);
      if (!a) g.set(k, (a = []));
      a.push(c);
    }
  }

  // Restitution + friction; resting contacts (tiny normal speed) barely brake so coins roll downhill.
  bounce(c, nx, ny, nd, e, sound, mul = 1, roll = 0.03) {
    const vn = c.vx * nx + c.vy * ny + c.vd * nd;
    if (vn >= 0) return;
    const resting = -vn < 12;
    c.vx -= (1 + (resting ? 0 : e)) * vn * nx; c.vy -= (1 + (resting ? 0 : e)) * vn * ny; c.vd -= (1 + (resting ? 0 : e)) * vn * nd;
    const f = resting ? roll : FRICTION;
    const tx = c.vx, ty = c.vy, td = c.vd; // tangential friction (normal part is now >= 0)
    const vn2 = tx * nx + ty * ny + td * nd;
    c.vx -= (tx - vn2 * nx) * f; c.vy -= (ty - vn2 * ny) * f; c.vd -= (td - vn2 * nd) * f;
    if (sound && -vn > 22) { this.onBounce?.(-vn * mul, c); c.ws += rng.float(-6, 6); c.wf += rng.float(-6, 6); }
  }

  collideWorld(c, sound) {
    const t = this.tank, r = c.r;
    // glass walls
    if (c.X < r + 1) { c.X = r + 1; if (c.vx < 0) c.vx *= -0.4; }
    if (c.X > t.W - r - 1) { c.X = t.W - r - 1; if (c.vx > 0) c.vx *= -0.4; }
    if (c.D < r + 1) { c.D = r + 1; if (c.vd < 0) c.vd *= -0.4; }
    if (c.D > t.DEPTH - r - 1) { c.D = t.DEPTH - r - 1; if (c.vd > 0) c.vd *= -0.4; }
    // decor: ellipsoid domes standing on the floor
    for (const k of t.colliders) {
      const dx = c.X - k.X, dd = c.D - k.D;
      if (Math.abs(dx) > k.R + r || Math.abs(dd) > k.R + r) continue;
      const q = k.R / k.H;
      const dy = (c.Y - k.base) * q;
      const L = Math.hypot(dx, dy, dd);
      const minL = k.R + r;
      if (L >= minL || L < 1e-6) continue;
      const nx = dx / L, ny = dy / L, nd = dd / L;
      const pen = minL - L;
      c.X += nx * pen; c.Y += (ny * pen) / q; c.D += nd * pen;
      const nl = Math.hypot(nx, ny / q, nd) || 1;
      this.bounce(c, nx / nl, ny / q / nl, nd / nl, E_GROUND, sound);
      if (ny < -0.3) c.contact = true;
    }
    // floor heightfield
    const top = t.ground(c.X, c.D) - r;
    if (c.Y > top) {
      c.Y = top;
      const [gx, gd] = t.slope(c.X, c.D);
      const nl = Math.hypot(gx, 1, gd);
      this.bounce(c, gx / nl, -1 / nl, gd / nl, E_GROUND, sound);
      // roll downhill (exaggerated: the sand slopes are subtle on screen)
      c.vx += gx * G * 2.5 * this.h; c.vd += gd * G * 2.5 * this.h; // (gx, gd) = dY/dX, dY/dD: downhill
      c.contact = true;
      c.slope = Math.abs(gx) + Math.abs(gd);
    }
  }

  collidePairs(c, sound) {
    const gx = (c.X / CELL) | 0, gy = (c.Y / CELL) | 0, gd = (c.D / CELL) | 0;
    for (let ix = gx - 1; ix <= gx + 1; ix++) for (let iy = gy - 1; iy <= gy + 1; iy++) for (let id = gd - 1; id <= gd + 1; id++) {
      const cell = this.grid.get(gkey(ix, iy, id));
      if (!cell) continue;
      for (const o of cell) {
        if (o === c || (!o.sleep && o.id < c.id)) continue;
        let dx = c.X - o.X, dy = c.Y - o.Y, dd = c.D - o.D;
        const minD = c.r + o.r;
        let d2 = dx * dx + dy * dy + dd * dd;
        if (d2 >= minD * minD) continue;
        if (d2 < 1e-6) { dx = rng.float(-0.1, 0.1); dy = -0.1; dd = rng.float(-0.1, 0.1); d2 = dx * dx + dy * dy + dd * dd; }
        const d = Math.sqrt(d2), nx = dx / d, ny = dy / d, nd = dd / d, pen = minD - d;
        if (o.sleep) {
          const vn = c.vx * nx + c.vy * ny + c.vd * nd;
          if (vn < -70 || (ny > 0.35 && c.vy > 6)) { o.sleep = false; o.restT = 0; }
        }
        if (o.sleep) {
          c.X += nx * pen; c.Y += ny * pen; c.D += nd * pen;
          this.bounce(c, nx, ny, nd, E_COIN, sound && true, 0.8, 0.22);
          if (ny < -0.2) { c.contact = true; c.coinContact = true; }
        } else {
          const mi = c.r * c.r, mj = o.r * o.r, wi = mj / (mi + mj), wj = mi / (mi + mj);
          c.X += nx * pen * wi; c.Y += ny * pen * wi; c.D += nd * pen * wi;
          o.X -= nx * pen * wj; o.Y -= ny * pen * wj; o.D -= nd * pen * wj;
          const vn = (c.vx - o.vx) * nx + (c.vy - o.vy) * ny + (c.vd - o.vd) * nd;
          if (vn < 0) {
            const J = -(1 + E_COIN) * vn / (1 / mi + 1 / mj);
            c.vx += (J / mi) * nx; c.vy += (J / mi) * ny; c.vd += (J / mi) * nd;
            o.vx -= (J / mj) * nx; o.vy -= (J / mj) * ny; o.vd -= (J / mj) * nd;
            if (sound && -vn > 34) this.onBounce?.(-vn * 0.7, c);
          }
          if (ny < -0.2) { c.contact = true; c.coinContact = true; }
          if (ny > 0.2) { o.contact = true; o.coinContact = true; }
        }
      }
    }
  }
}

export function angDiff(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

export function frameOf(c) {
  const i = ((Math.round((c.spin / TAU) * SPIN_N) % SPIN_N) + SPIN_N) % SPIN_N;
  const j = ((Math.round((c.flip / TAU) * FLIP_N) % FLIP_N) + FLIP_N) % FLIP_N;
  return [i, j];
}
