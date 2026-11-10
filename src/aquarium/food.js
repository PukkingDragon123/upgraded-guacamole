// Fish food for the tank (phase 10 polish). Four detailed voxel foods, each with its own look and physics:
//   flakes   Reef Flakes    thin speckled flakes in three colours: float a moment, then flutter down, tumbling
//   pellets  Pop Pellets    round speckled pellets: plunge, tumble and bounce once on the gravel (2 bites)
//   worms    Bloodworms     segmented red worms that wriggle all the way down and keep squirming (3 bites)
//   shrimp   Brine Shrimp   curled pink shrimp with eyes and a tail fan that kick upward as they sink (2 bites)
// Every piece is a tiny VoxelModel re-voxelised per tumble / wriggle frame and rendered by the voxel renderer
// (outline, AO, edge light) at 2 device px per voxel, so it is crisp on the full-res UI layer.
//
//   FOODS[id] {name, short, tip, n:[min,max] per pinch, bites, feed (hunger per piece), sink:[min,max]}, FOOD_IDS
//   new FoodSim(aq)  .items .crumbs
//     .drop(type, x, z, n, o)        a pinch shaken in from under the lid (staggered, splashes on the water)
//     .step(dt)                      physics + crumbs
//     .live()                        pieces fish can go for (in the water, not eaten)
//     .bite(f, item) -> bool         a fish nibbles (crumbs, knock, chomp bubbles); true when eaten up
//     .draw(ctx, cam, o)             draws pieces + crumbs ({dark, hi})
//   foodIcon(type, px) -> canvas     a voxel icon (a little heap of the food), device px with `.hi`-style use
//   shakerSprite(tilt) -> canvas     the voxel food shaker shown at the cursor while feeding (device px)

import { VoxelModel, renderVoxels } from '../gfx/voxel.js';
import { makeCanvas, ctxOf } from '../core/canvas.js';
import { clamp, clamp01, TAU } from '../core/math.js';
import { rng } from '../core/rng.js';

export const FOODS = {
  flakes: { name: 'Reef Flakes', short: 'Flakes', tip: 'Light flakes that flutter down slowly', n: [9, 12], bites: 1, feed: 0.09, sink: [5, 8], r: 2.2, frames: 8, cols: ['#ff7a3a', '#ffcf3a', '#6ad04a', '#ff5a7a'] },
  pellets: { name: 'Pop Pellets', short: 'Pellets', tip: 'Crunchy pellets that sink fast', n: [5, 7], bites: 2, feed: 0.16, sink: [20, 27], r: 1.8, frames: 6, cols: ['#d8743a', '#7ac23a', '#e8b43a'] },
  worms: { name: 'Bloodworms', short: 'Worms', tip: 'Wriggly worms - a feast!', n: [3, 4], bites: 3, feed: 0.24, sink: [9, 13], r: 2.6, frames: 6, cols: ['#d8283a'] },
  shrimp: { name: 'Brine Shrimp', short: 'Shrimp', tip: 'Tiny shrimp that kick as they sink', n: [5, 6], bites: 2, feed: 0.18, sink: [4, 7], r: 2, frames: 4, cols: ['#ff8a6a'] },
};
export const FOOD_IDS = Object.keys(FOODS);

// ------------------------------------------------------------------ voxel sprites
const RENDER = { scale: 2, yaw: 0, pitch: 26, outline: true, ao: 0.35, edges: 0.85, groundAO: false, jitter: 0.08 };
const shadeHex = (hex, k) => {
  const n = parseInt(hex.slice(1), 16);
  const f = (v) => Math.max(0, Math.min(255, Math.round(k >= 0 ? v + (255 - v) * k : v * (1 + k))));
  return '#' + [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => f(v).toString(16).padStart(2, '0')).join('');
};
const h3 = (x, y, z) => { const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return s - Math.floor(s); };

// rotation matrices (row major) and their product
const rotX = (a) => [1, 0, 0, 0, Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a)];
const rotY = (a) => [Math.cos(a), 0, Math.sin(a), 0, 1, 0, -Math.sin(a), 0, Math.cos(a)];
const rotZ = (a) => [Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a), 0, 0, 0, 1];
const mul = (A, B) => { const o = new Array(9); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) o[i * 3 + j] = A[i * 3] * B[j] + A[i * 3 + 1] * B[3 + j] + A[i * 3 + 2] * B[6 + j]; return o; };

// fill a G^3 grid by sampling shape(x, y, z) (local coords, centred) through the inverse of rotation R
function voxelize(G, R, shape, m) {
  const c = G / 2;
  for (let iz = 0; iz < G; iz++) for (let iy = 0; iy < G; iy++) for (let ix = 0; ix < G; ix++) {
    const px = ix + 0.5 - c, py = iy + 0.5 - c, pz = iz + 0.5 - c;
    // R^T p
    const qx = R[0] * px + R[3] * py + R[6] * pz, qy = R[1] * px + R[4] * py + R[7] * pz, qz = R[2] * px + R[5] * py + R[8] * pz;
    const v = shape(qx, qy, qz, px, py, pz); // local coords + world (screen-aligned) coords for lighting
    if (v) m.set(ix, iy, iz, v);
  }
}

// palette helper: a dict of named colours on a model
function pal(m, cols) { const o = {}; for (const k in cols) o[k] = m.color(cols[k][0], { jitter: 0.06, spec: cols[k][1] ?? 0.5, ...(cols[k][2] || {}) }); return o; }

// ---- the food shapes (local voxel units; y up)
function flakeShape(m, v) {
  const base = FOODS.flakes.cols[v % FOODS.flakes.cols.length];
  const P = pal(m, { a: [base, 0.4], b: [shadeHex(base, 0.35), 0.6], c: [shadeHex(base, -0.28), 0.3], s: [v % 2 ? '#ffffff' : '#ffe8a0', 0.8] });
  // a crumpled, irregular plate facing the camera (thin in z)
  return (x, y, z) => {
    const bump = Math.sin(x * 1.1 + v) * 0.45 + Math.cos(y * 0.9 + v * 2) * 0.35;
    if (Math.abs(z - bump) > 0.62) return 0;
    const a = Math.atan2(y, x), r = Math.hypot(x, y);
    const R0 = 4.3 * (1 + 0.2 * Math.sin(3 * a + v * 1.7) + 0.13 * Math.sin(5 * a + v * 2.9));
    if (r > R0) return 0;
    const h = h3(Math.round(x), Math.round(y), v);
    if (h < 0.1) return P.s;
    if (r > R0 - 1.1) return h < 0.55 ? P.c : P.a;
    return h < 0.33 ? P.b : P.a;
  };
}
function pelletShape(m, v, bitten) {
  const base = FOODS.pellets.cols[v % FOODS.pellets.cols.length];
  const P = pal(m, { a: [base, 0.6], b: [shadeHex(base, 0.22), 0.8], c: [shadeHex(base, -0.4), 0.3], s: [shadeHex(base, 0.55), 0.9], g: ['#ffffff', 1, { emissive: 0.2 }], d: [shadeHex(base, -0.25), 0.4], k: [shadeHex(base, -0.55), 0.2] });
  const R = 3.4;
  return (x, y, z, wx, wy, wz) => {
    const d = x * x + y * y + z * z;
    if (d > R * R) return 0;
    if (bitten && (x - 2.6) ** 2 + (y - 1.2) ** 2 + (z - 1) ** 2 < 5.5) return bitten && d > 2.2 * 2.2 ? 0 : P.k; // a bite out of it
    // round shading baked in screen space: a glossy top-left highlight, a darker rim at the bottom-right
    const lit = (-wx * 0.5 + wy * 0.7 + wz * 0.5) / R;
    if (lit > 0.78 && d > (R - 1.2) ** 2) return P.g;
    const h = h3(Math.round(x), Math.round(y), Math.round(z));
    if (h < 0.13) return P.c; // speckles turn with the pellet
    if (lit < -0.45) return h > 0.8 ? P.c : P.d;
    if (lit > 0.4) return h > 0.7 ? P.s : P.b;
    return h > 0.88 ? P.s : P.a;
  };
}
function wormShape(m, len, ph) {
  const P = pal(m, { a: ['#d8283a', 0.7], b: ['#a8162c', 0.5], c: ['#ff6a6a', 0.9], h: ['#6a0a1c', 0.4] });
  const L = len / 2;
  return (x, y, z) => {
    if (Math.abs(x) > L) return 0;
    const u = (x + L) / (2 * L);
    const cy = Math.sin(u * TAU * 1.1 + ph) * 1.6 * (0.4 + u * 0.6);
    const rr = 1.05 + (u > 0.15 && u < 0.9 ? 0.2 : 0) - (u < 0.08 ? 0.3 : 0);
    if ((y - cy) ** 2 + z * z > rr * rr) return 0;
    if (x > L - 1.4) return y - cy > 0.3 ? P.b : P.h; // the dark head
    const seg = Math.floor((x + L) / 1.5) % 2;
    if (y - cy > 0.6 && z > -0.2) return seg ? P.c : P.a; // a wet highlight along the back
    return seg ? P.b : P.a;
  };
}
function shrimpShape(m, curl, scale = 1) {
  const P = pal(m, { a: ['#ff8a6a', 0.7], b: ['#ffc0a0', 0.9], c: ['#e8604a', 0.5], e: ['#1a1020', 1], t: ['#ffd8c0', 0.8] });
  // a curled body: points along an arc from head (x > 0) to tail
  const pts = [];
  const n = 9;
  for (let i = 0; i < n; i++) {
    const u = i / (n - 1);
    const a = -0.4 + u * (1.6 + curl * 0.9);
    pts.push([Math.cos(a) * 3.2 * scale - 0.6, -Math.sin(a) * 2.6 * scale + 0.6, (1.25 - u * 0.75) * scale]);
  }
  return (x, y, z) => {
    let best = 1e9, bi = 0;
    for (let i = 0; i < n; i++) { const p = pts[i]; const d = (x - p[0]) ** 2 + (y - p[1]) ** 2; if (d < best) { best = d; bi = i; } }
    const p = pts[bi];
    const r = p[2];
    if (best + z * z > r * r) {
      // the tail fan
      const q = pts[n - 1];
      if (Math.abs(z) < 1.3 * scale && (x - q[0] + 0.8) ** 2 + (y - q[1] - 0.4) ** 2 < 1.4 * scale) return P.t;
      // feelers
      if (Math.abs(z) < 0.6 && y > pts[0][1] - 0.2 && y < pts[0][1] + 0.6 && x > pts[0][0] && x < pts[0][0] + 2.2 * scale) return P.c;
      return 0;
    }
    if (bi === 0 && z > 0.2 && y > p[1]) return P.e; // eye
    if (y > p[1] + r * 0.45) return P.b;
    return bi % 2 ? P.c : P.a;
  };
}

const SPR = new Map();
let budgetT = 0, budgetN = 0;
function canBuild() {
  const n = performance.now();
  if (n - budgetT > 16) { budgetT = n; budgetN = 0; }
  return budgetN < 6;
}
function render(m, o = {}) {
  const r = renderVoxels(m, { ...RENDER, ...o });
  return r.canvas;
}

// key -> canvas (device px); null while over this frame's build budget
function sprite(type, v, frame, size) {
  const key = type + '|' + v + '|' + frame + '|' + size;
  let c = SPR.get(key);
  if (c !== undefined) return c;
  if (!canBuild()) return null;
  budgetN++;
  const G = type === 'worms' ? 22 : type === 'crumb' ? 6 : type === 'shrimp' ? 17 : 14;
  const m = new VoxelModel(G, G, G);
  const F = FOODS[type]?.frames || 1;
  const a = (frame / F) * TAU;
  try {
    if (type === 'flakes') voxelize(G, mul(rotZ(a * 0.5 + v), rotY(Math.sin(a) * 1.25)), flakeShape(m, v), m);
    else if (type === 'pellets') voxelize(G, mul(rotY(a), rotZ(a * 0.5 + v)), pelletShape(m, v, size < 2), m);
    else if (type === 'worms') voxelize(G, rotY(0.25), wormShape(m, 6 + size * 4, a), m);
    else if (type === 'shrimp') voxelize(G, rotY(-0.3), shrimpShape(m, Math.sin(a) * 0.5 + 0.5, size < 2 ? 0.95 : 1.25), m);
    else if (type === 'crumb') {
      const P = pal(m, { a: [v, 0.5], b: [shadeHex(v, -0.3), 0.3] });
      voxelize(G, rotY(frame), (x, y, z) => (Math.abs(x) < 1 && Math.abs(y) < 0.6 && Math.abs(z) < 1 && x + z < 0.9 ? (y > 0 ? P.a : P.b) : 0), m);
    }
    c = render(m);
  } catch (e) { console.warn('food sprite', key, e); c = false; }
  SPR.set(key, c);
  return c;
}

// a little heap of the food for the picker (device px, ~3 px per voxel)
const ICONS = new Map();
export function foodIcon(type, scale = 3) {
  const key = type + '|' + scale;
  if (ICONS.has(key)) return ICONS.get(key);
  const G = 18, m = new VoxelModel(G, G, G);
  const put = (shape, R, ox, oy, oz) => voxelize(G, R, (x, y, z) => shape(x - ox, y - oy, z - oz), m);
  if (type === 'flakes') { put(flakeShape(m, 0), rotX(0.35), -2, -1, 1); put(flakeShape(m, 1), rotX(-0.5), 2.5, 1.5, -1); put(flakeShape(m, 2), rotZ(0.6), 0.5, 3.6, 1.5); }
  else if (type === 'pellets') { put(pelletShape(m, 0, false), rotY(0), -2.6, -1.5, 0); put(pelletShape(m, 1, false), rotY(1), 2.6, -1.5, 0.5); put(pelletShape(m, 2, false), rotY(2), 0, 2.2, 0); }
  else if (type === 'worms') { put(wormShape(m, 13, 0.6), rotZ(0.25), 0, 0, 0); put(wormShape(m, 9, 2.4), mul(rotY(1.2), rotZ(-0.2)), 0, -2.5, 0); }
  else put(shrimpShape(m, 0.6, 1.35), rotY(-0.25), 0, 0, 0);
  let c = null;
  try { c = render(m, { scale, yaw: 24, pitch: 30, ao: 0.5 }); } catch (e) { console.warn('food icon', e); }
  ICONS.set(key, c);
  return c;
}

// the food shaker: a glossy Aero can with a white label, a little fish emblem and a holed lid
const SHAKERS = new Map();
export function shakerSprite(tilt = 0) {
  if (SHAKERS.has(tilt)) return SHAKERS.get(tilt);
  const G = 22, m = new VoxelModel(G, G, G);
  const P = pal(m, { can: ['#2a9ae8', 0.9], can2: ['#1a6ac0', 0.6], lab: ['#f4fbff', 0.6], lid: ['#e8f2fa', 1], hole: ['#30486a', 0.2], fish: ['#ff8a3a', 0.8], eye: ['#1a1020', 0.5], rim: ['#b8d0e4', 0.8] });
  const shape = (x, y, z) => {
    const r = Math.hypot(x, z);
    if (y < -5.5 || y > 6) return 0;
    if (y > 4.2) { // the lid with holes
      if (r > 4.1) return 0;
      if (y > 5.2 && r < 3.2 && Math.abs(((x + 10) % 1.6) - 0.8) < 0.45 && Math.abs(((z + 10) % 1.6) - 0.8) < 0.45) return P.hole;
      return r > 3.6 ? P.rim : P.lid;
    }
    if (r > 3.6) return 0;
    if (y > -2.6 && y < 2.4 && z > 0) {
      // label: a little orange fish
      const fx = x, fy = y + 0.1;
      if ((fx * fx) / 3.2 + fy * fy / 1.1 < 1) return Math.abs(fx - 1.1) < 0.5 && fy > 0 ? P.eye : P.fish;
      if (fx < -1.6 && fx > -2.8 && Math.abs(fy) < (fx + 2.8) * 0.8) return P.fish;
      return P.lab;
    }
    return y < -4.5 ? P.can2 : P.can;
  };
  voxelize(G, mul(rotZ(tilt), rotY(-0.5)), shape, m);
  let c = null;
  try { c = render(m, { scale: 4, yaw: 0, pitch: 18, ao: 0.4 }); } catch (e) { console.warn('shaker', e); }
  SHAKERS.set(tilt, c);
  return c;
}

// ------------------------------------------------------------------ the simulation
export class FoodSim {
  constructor(aq) {
    this.aq = aq;
    this.items = [];
    this.crumbs = [];
    this.queue = []; // staggered drops
    this.splashT = 0;
  }
  get T() { return this.aq.shape; }
  clear() { this.items.length = 0; this.crumbs.length = 0; this.queue.length = 0; }
  live() { return this.items.filter((p) => p.wet && !p.eaten); }

  // a pinch of food: pieces appear under the lid around x (staggered like a shaker) and fall into the water
  drop(type, x, z, n = null, o = {}) {
    const F = FOODS[type] || FOODS.flakes;
    n ??= rng.int(F.n[0], F.n[1]);
    if (this.items.length > 70) n = Math.min(n, 2);
    for (let i = 0; i < n; i++) this.queue.push({ at: (o.delay || 0) + i * (o.gap ?? 0.045) + rng.float(0, 0.03), type, x: x + rng.float(-1, 1) * (o.spread ?? 14), z: z + rng.float(-1, 1) * 10 });
  }

  spawn(q) {
    const T = this.T, F = FOODS[q.type];
    const p = [clamp(q.x, -T.W / 2 + 4, T.W / 2 - 4), T.H - 2 - rng.float(0, 3), clamp(q.z, -T.D / 2 + 6, T.D / 2 - 6)];
    this.items.push({
      type: q.type, v: rng.int(0, 99), p, vel: [rng.float(-6, 6), -rng.float(10, 30), 0], wet: false, eaten: false,
      rot: rng.float(0, TAU), rotV: rng.float(2, 6) * (rng.chance(0.5) ? 1 : -1), ph: rng.float(0, TAU), dir: rng.chance(0.5) ? 1 : -1,
      bites: F.bites, t: 0, rest: 0, floatT: q.type === 'flakes' ? rng.float(0.4, 1.4) : 0, hopT: rng.float(0.3, 1), r: F.r, bounced: false, alpha: 1,
      sink: rng.float(F.sink[0], F.sink[1]),
    });
  }

  step(dt) {
    const T = this.T, aq = this.aq;
    this.splashT -= dt;
    if (this.queue.length) {
      for (const q of this.queue) q.at -= dt;
      const due = this.queue.filter((q) => q.at <= 0);
      if (due.length) { this.queue = this.queue.filter((q) => q.at > 0); for (const q of due) this.spawn(q); }
    }
    let w = 0;
    for (const p of this.items) {
      p.t += dt;
      if (p.eaten) continue;
      const v = p.vel;
      if (!p.wet) {
        // falling through the air gap under the lid
        v[1] -= 260 * dt;
        p.p[0] += v[0] * dt; p.p[1] += v[1] * dt;
        p.rot += p.rotV * dt * 2;
        if (p.p[1] <= T.waterY) { p.p[1] = T.waterY - 0.5; p.wet = true; v[1] *= p.type === 'pellets' ? 0.35 : 0.12; v[0] *= 0.3; aq.foodSplash(p); }
      } else if (p.floatT > 0) {
        // flakes float on the surface for a moment, bobbing on the ripples
        p.floatT -= dt;
        p.p[1] = T.waterY - 0.8 + Math.sin(p.t * 5 + p.ph) * 0.3;
        p.p[0] += Math.sin(p.t * 1.3 + p.ph) * 3 * dt;
        p.rot += Math.sin(p.t * 2 + p.ph) * dt * 0.6;
        v[1] = -1;
      } else if (p.rest <= 0) {
        // sinking: each food has its own way down
        const k = Math.min(1, dt * (p.type === 'pellets' ? 2.2 : 3));
        v[1] += (-p.sink - v[1]) * k;
        if (p.type === 'flakes') {
          v[0] = Math.sin(p.t * 2.1 + p.ph) * 7;
          p.rotV = 3 + Math.sin(p.t * 1.7 + p.ph) * 3;
          v[1] -= Math.abs(Math.cos(p.t * 2.1 + p.ph)) * 3 * dt; // flutter: slows when broadside
        } else if (p.type === 'pellets') {
          v[0] *= Math.exp(-dt * 2); v[0] += Math.sin(p.t * 3 + p.ph) * 1.2 * dt;
        } else if (p.type === 'worms') {
          v[0] = Math.sin(p.t * 3 + p.ph) * 4 + p.dir * 2;
        } else if (p.type === 'shrimp') {
          p.hopT -= dt;
          if (p.hopT <= 0) { p.hopT = rng.float(0.7, 1.5); v[1] = rng.float(9, 15); v[0] = p.dir * rng.float(6, 12); if (rng.chance(0.3)) p.dir *= -1; }
          v[0] *= Math.exp(-dt * 2.5);
        }
        p.p[0] += v[0] * dt; p.p[1] += v[1] * dt; p.p[2] += (v[2] || 0) * dt;
        p.rot += p.rotV * dt;
        const fy = T.floorY(p.p[0], p.p[2]) + p.r * 0.6;
        if (p.p[1] <= fy) {
          p.p[1] = fy;
          if (p.type === 'pellets' && !p.bounced && v[1] < -10) { p.bounced = true; v[1] = -v[1] * 0.32; v[0] += rng.float(-6, 6); aq.foodLand(p, true); }
          else { p.rest = 0.001; v[0] = v[1] = 0; aq.foodLand(p, false); }
        }
        if (p.p[1] > T.waterY - 0.8) { p.p[1] = T.waterY - 0.8; v[1] = Math.min(v[1], 0); }
      } else {
        // resting on the gravel: worms keep squirming, shrimp twitch, then the food slowly melts away
        p.rest += dt;
        if (p.type === 'shrimp') { p.hopT -= dt; if (p.hopT <= 0) { p.hopT = rng.float(1.5, 3.5); p.rest = 0; v[1] = rng.float(5, 9); v[0] = p.dir * rng.float(3, 6); } }
        if (p.type === 'flakes' || p.type === 'pellets') p.rot += (Math.round(p.rot / Math.PI) * Math.PI - p.rot) * Math.min(1, dt * 4);
        p.alpha = clamp01(1 - (p.rest - 26) / 4);
        if (p.rest > 30) continue;
      }
      const hx = T.W / 2 - 3, hz = T.D / 2 - 4;
      p.p[0] = clamp(p.p[0], -hx, hx); p.p[2] = clamp(p.p[2], -hz, hz);
      this.items[w++] = p;
    }
    this.items.length = w;
    // crumbs: tiny bits that drift down and fade
    w = 0;
    for (const c of this.crumbs) {
      c.t += dt;
      if (c.t > c.life) continue;
      c.vel[1] += (-6 - c.vel[1]) * Math.min(1, dt * 2);
      c.vel[0] *= Math.exp(-dt * 2);
      c.p[0] += c.vel[0] * dt; c.p[1] += c.vel[1] * dt;
      c.frame = (c.frame + dt * 6) % 4;
      const fy = T.floorY(c.p[0], c.p[2]);
      if (c.p[1] < fy) { c.p[1] = fy; c.vel[0] = 0; }
      this.crumbs[w++] = c;
    }
    this.crumbs.length = w;
  }

  // a fish takes a bite: crumbs fly, the piece is knocked about; returns true when it is all gone
  bite(f, p) {
    const d = f.dir;
    p.bites--;
    const col = FOODS[p.type].cols[p.v % FOODS[p.type].cols.length];
    const n = p.bites <= 0 ? rng.int(3, 5) : rng.int(2, 3);
    for (let i = 0; i < n && this.crumbs.length < 80; i++) {
      this.crumbs.push({ p: [p.p[0] + rng.float(-1.5, 1.5), p.p[1] + rng.float(-1, 1.5), p.p[2]], vel: [d[0] * rng.float(4, 14) + rng.float(-8, 8), rng.float(2, 10), 0], t: 0, life: rng.float(1.2, 2.4), col, frame: rng.float(0, 4) });
    }
    if (p.bites <= 0) { p.eaten = true; return true; }
    // knocked by the bite
    p.vel[0] += d[0] * rng.float(5, 10); p.vel[1] += rng.float(3, 7);
    p.rest = 0; p.rotV += rng.float(-6, 6); p.floatT = 0;
    return false;
  }

  // ---- drawing (cam: the scene camera; o.hi = drawing on the full-res layer)
  draw(ctx, cam, o = {}) {
    const S = this.aq.scene;
    const half = 0.5; // sprites are authored in device px (2 per voxel): half that in logical px
    const prevF = ctx.filter;
    if (o.dark > 0.05) ctx.filter = `brightness(${(1 - o.dark * 0.5).toFixed(2)}) saturate(${(1 - o.dark * 0.3).toFixed(2)})`;
    for (const c of this.crumbs) {
      const s = sprite('crumb', c.col, Math.floor(c.frame) % 4, 1);
      const q = S.proj(c.p[0], c.p[1], c.p[2], cam);
      const a = clamp01((c.life - c.t) / 0.6);
      if (!s) { ctx.fillStyle = c.col; ctx.fillRect(Math.round(q.x), Math.round(q.y), 1, 1); continue; }
      ctx.globalAlpha = a;
      ctx.drawImage(s, Math.round((q.x - s.width * half / 2) * 2) / 2, Math.round((q.y - s.height * half / 2) * 2) / 2, s.width * half, s.height * half);
      ctx.globalAlpha = 1;
    }
    for (const p of this.items) {
      if (p.eaten) continue;
      const F = FOODS[p.type];
      const fr = F.frames;
      let frame, v = 0, size = 2;
      if (p.type === 'flakes') { v = p.v % 4; frame = ((Math.floor((p.rot / TAU) * fr) % fr) + fr) % fr; }
      else if (p.type === 'pellets') { v = p.v % 3; size = p.bites >= 2 ? 2 : 1; frame = ((Math.floor((p.rot / TAU) * fr) % fr) + fr) % fr; }
      else if (p.type === 'worms') { size = clamp(p.bites, 1, 3); frame = Math.floor((p.t * (p.rest > 0 ? 4 : 9) + p.ph) % fr); }
      else { size = p.bites >= 2 ? 2 : 1; const hop = p.hopT < 0.25 ? 1 : 0; frame = (Math.floor(p.t * 3 + p.ph) + hop * 2) % fr; }
      const s = sprite(p.type, v, frame, size);
      const q = S.proj(p.p[0], p.p[1], p.p[2], cam);
      if (!s) { ctx.fillStyle = F.cols[0]; ctx.fillRect(Math.round(q.x) - 1, Math.round(q.y) - 1, 2, 2); continue; }
      const w = s.width * half, h = s.height * half;
      if (p.alpha < 1) ctx.globalAlpha = p.alpha;
      const flip = (p.type === 'worms' || p.type === 'shrimp') && p.dir < 0;
      const x = Math.round((q.x - w / 2) * 2) / 2, y = Math.round((q.y - h / 2) * 2) / 2;
      if (flip) { ctx.save(); ctx.translate(x + w, y); ctx.scale(-1, 1); ctx.drawImage(s, 0, 0, w, h); ctx.restore(); }
      else ctx.drawImage(s, x, y, w, h);
      ctx.globalAlpha = 1;
    }
    ctx.filter = prevF || 'none';
  }
}

// a contact sheet of every food frame (debug / art review): FISHTOP.aquarium.feed.sheet()
FoodSim.prototype.sheet = function sheet() {
  const rows = [];
  for (const type of FOOD_IDS) for (let v = 0; v < (type === 'flakes' ? 4 : type === 'pellets' ? 3 : 1); v++) for (const size of type === 'flakes' ? [2] : type === 'worms' ? [3, 2, 1] : [2, 1]) {
    const row = [];
    for (let f = 0; f < FOODS[type].frames; f++) { budgetN = 0; const c = sprite(type, v, f, size); if (c) row.push(c); }
    rows.push(row);
  }
  const icons = FOOD_IDS.map((id) => foodIcon(id, 5)).concat([shakerSprite(-0.18), shakerSprite(-0.75)]).filter(Boolean);
  rows.push(icons);
  const W = Math.max(...rows.map((r) => r.reduce((a, c) => a + c.width + 4, 0))), H = rows.reduce((a, r) => a + Math.max(1, ...r.map((c) => c.height)) + 4, 0);
  const out = makeCanvas(W, H), g = ctxOf(out);
  g.fillStyle = '#45c8f0'; g.fillRect(0, 0, W, H);
  let y = 0;
  for (const r of rows) { let x = 0; for (const c of r) { g.drawImage(c, x, y); x += c.width + 4; } y += Math.max(1, ...r.map((c) => c.height)) + 4; }
  return out;
};
