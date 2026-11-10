// The side-view tank scene (phase 10): a perspective side view into a big glass tank, drawn in screen space from
// cached voxel sprites. One camera model: the eye sits in front of the glass at eye height eyeY, E tank px from the
// front pane; every point (x, y, z) projects with scale s(z) = E / (E + D/2 - z), so the back plane is smaller and
// scrolls slower (parallax), and the room behind the tank slower still.
//
//   new TankScene(aq)
//   .layout(screenW, screenH, bottomY)    picks the zoom Z for the tier (fits the tank's height), keeps it stable
//   .cam(camX) / .windowCam(rect, camX, ty)  camera objects {Z, camX, cx, hy, clip}
//   .proj(x, y, z, cam) -> {x, y, s}      screen point and perspective scale; .unproj(sx, sy, z, cam) -> [x, y]
//   .sOf(z), .layerZ(l)                   l: 0 front, 1 mid, 2 back, 3 back wall
//   .pump(ms)                             builds queued voxel art within a time budget (call every frame)
//   .draw(ctx, cam, o)                    room, tank interior (water, light, planes, plants, rocks, decor,
//                                         buildings, equipment, fish, drops, food, bubbles), glass and frame
//   .pieceSprite(piece)                   sprite of a placed decoration / building at its layer scale (or null)
//   .invalidate()                         rebuild everything (tier, gear, resize)

import { clamp, clamp01, lerp, TAU, hash2 } from '../core/math.js';
import { RNG } from '../core/rng.js';
import { mix, shade, rgba, hexToRgb } from '../core/color.js';
import { makeCanvas, ctxOf } from '../core/canvas.js';
import { getPropSteps, PROPS } from '../gfx/props.js';
import { drawFishRig } from '../gfx/fishrig.js';
import { buildingSprite, qScale } from '../build/buildingmodels.js';
import { BUILDINGS } from '../build/buildings.js';
import { drawAeroCoin, drawAeroGlow } from '../ui/aero.js';
import { gradientStrip, makeRays, Caustics, bubbleSprite, glowSprite } from '../world/scenery.js';
import { PlantField, plantCols, headCols } from '../world/plants.js';
import { TANK_TIERS, gearLevel } from './tanks.js';
import { planeSteps, backdropSteps, rockSteps, plantSteps, frameSteps, roomSteps, gearSteps, artCached, LIGHT_COLS, PXV } from './tankart.js';

const DECOR_K = 0.78;
const BUILD_K = 0.62;
const WATER = [
  { top: '#a8f4ff', mid: '#45c8f0', bot: '#1d7fc4', air: '#eafcff', veil: '#1a6aa8' },
  { top: '#c8f8ff', mid: '#5ad8f8', bot: '#1f8ad0', air: '#f2feff', veil: '#1a70b0' },
];
const PLANT_COLS = ['#3fbf4a', '#5ad85a', '#2fa85a', '#7ae05a', '#3ab890', '#58c8a8'];
const FLOWER_COLS = ['#ff7ab4', '#ffd23a', '#ff9a4a', '#b88aff', '#ffffff'];
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

function flipped(c) {
  if (c.__flip) return c.__flip;
  const f = makeCanvas(c.width, c.height);
  const g = ctxOf(f);
  g.translate(c.width, 0); g.scale(-1, 1); g.drawImage(c, 0, 0);
  c.__flip = f;
  return f;
}

export class TankScene {
  constructor(aq) {
    this.aq = aq;
    this.Z = 1.4;
    this.key = '';
    this.jobs = [];
    this.jobKeys = new Set();
    this.sprites = new Map(); // key -> sprite | null (pending)
    this.planes = [null, null, null];
    this.backdrop = null;
    this.fields = [new PlantField(11), new PlantField(12), new PlantField(13)];
    this.scenery = [];
    this.caustics = null;
    this.rays = null;
    this.waterTex = null;
    this.bubbles = [];
    this.motes = [];
    this.bottomY = 440; this.topY = 46;
    this.W = 960; this.H = 540;
  }

  get shape() { return this.aq.shape; }
  get E() { return this.shape.D * 4.6; }
  get eyeY() { return this.shape.H * 0.8; }
  sOf(z) { const E = this.E; return E / (E + this.shape.D / 2 - z); }
  layerZ(l) { const D = this.shape.D; return l === 3 ? -D / 2 + 3 : this.shape.planeZ[clamp(l | 0, 0, 2)]; }
  layerOfZ(z) { const D = this.shape.D; return z > D / 6 ? 0 : z > -D / 6 ? 1 : 2; }

  // ------------------------------------------------------------------ camera
  layout(W, H, bottomY) {
    this.W = W; this.H = H;
    const T = this.shape;
    const by = Math.round(bottomY);
    const hood = 21, base = 12;
    let Z = (by - base - this.topY) / (T.H + hood);
    Z = clamp(Math.floor(Z * 20) / 20, 0.8, clamp((H / 540) * 1.45, 1.45, 2.1));
    const key = [T.tier, Z, W, H].join('|');
    this.bottomY = by - Math.round(base * Z);
    if (key !== this.layoutKey) { this.layoutKey = key; this.Z = Z; this.invalidate(); }
  }

  // horizontal scroll range of the full view (0 when the tank fits)
  scrollMax() {
    const T = this.shape, Z = this.Z;
    const half = this.W / 2 / Z, need = T.W / 2 + 70;
    return Math.max(0, need - half);
  }

  cam(camX) {
    const Z = this.Z;
    return { Z, camX, cx: this.W / 2, hy: this.bottomY - this.eyeY * Z, clip: null, full: true };
  }
  // a camera for the floating window: same zoom, centred on (camX, ty)
  windowCam(r, camX, ty) {
    const Z = this.Z, s0 = this.sOf(0);
    return { Z, camX, cx: r.x + r.w / 2, hy: r.y + r.h / 2 - (this.eyeY - ty) * s0 * Z, clip: r, full: false };
  }

  proj(x, y, z, c) {
    const s = this.sOf(z), k = s * c.Z;
    return { x: c.cx + (x - c.camX) * k, y: c.hy + (this.eyeY - y) * k, s };
  }
  unproj(sx, sy, z, c) {
    const k = this.sOf(z) * c.Z;
    return [c.camX + (sx - c.cx) / k, this.eyeY - (sy - c.hy) / k];
  }

  // ------------------------------------------------------------------ build jobs
  invalidate() {
    this.key = '';
  }
  // hi: small sprites the frame needs now (frame, decor, rocks); lo: the big substrate strips
  queue(key, gen, done, hi = false) {
    if (this.jobKeys.has(key)) return;
    this.jobKeys.add(key);
    const j = { key, it: gen, done, hi };
    if (hi) { const i = this.jobs.findIndex((q) => !q.hi && !q.started); if (i < 0) this.jobs.push(j); else this.jobs.splice(i, 0, j); } else this.jobs.push(j);
  }
  pump(ms = 6) {
    const t0 = now();
    while (this.jobs.length && now() - t0 < ms) {
      const j = this.jobs[0];
      j.started = true;
      let r;
      try { r = j.it.next(); } catch (e) { console.warn('tank art', j.key, e); r = { done: true, value: null }; }
      if (r.done) { this.jobs.shift(); this.jobKeys.delete(j.key); try { j.done(r.value); } catch (e) { console.warn('tank art', j.key, e); } }
    }
  }
  busy() { return this.jobs.length > 0; }

  // a cached sprite from a generator factory (null until built)
  sprite(key, make) {
    if (this.sprites.has(key)) return this.sprites.get(key);
    this.sprites.set(key, null);
    this.queue(key, make(), (v) => this.sprites.set(key, v || false), true);
    return null;
  }

  ensure() {
    const st = this.aq.st, T = this.shape;
    const sand = gearLevel(st, 'sand'), light = gearLevel(st, 'light');
    const key = [this.layoutKey, sand, light, TANK_TIERS[T.tier]?.plants].join('|');
    if (key === this.key) return;
    const tierChanged = !this.key || this.key.split('|')[0] !== key.split('|')[0];
    this.key = key;
    this.planes = [null, null, null];
    if (tierChanged) this.backdrop = null;
    this.jobs.length = 0; this.jobKeys.clear();
    if (tierChanged) this.sprites.clear();
    else for (const [k, v] of this.sprites) if (v === null) this.sprites.delete(k); // pending jobs were dropped
    const Z = this.Z;
    // the substrate planes, back first so the scene fills in from behind
    for (const k of [2, 1, 0]) {
      const sK = this.sOf(T.planeZ[k]);
      const pitch = this.planePitch(k);
      this.queue('plane' + k, planeSteps(T, k, Z, sK, pitch, sand), (v) => { this.planes[k] = v; });
    }
    if (!this.backdrop) this.queue('backdrop', backdropSteps(T, Z, this.sOf(-T.D / 2 + 1), '#3aa8e0'), (v) => { this.backdrop = v; });
    this.buildScenery();
    this.rays = null;
    this.waterTex = null;
  }

  // match the ortho voxel strip's visible top band to the perspective floor band of its slab
  planePitch(k) {
    const T = this.shape, z = T.planeZ[k], hz = T.D / 6;
    const h = T.planeH(k, 0);
    const ds = this.sOf(z + hz) - this.sOf(z - hz);
    const sinP = ((this.eyeY - h) * ds) / ((T.D / 3) * this.sOf(z));
    return clamp(Math.asin(clamp(sinP, 0.05, 0.6)) * 57.3, 8, 30);
  }

  // ------------------------------------------------------------------ base scenery: rocks, plants, moss balls
  buildScenery() {
    const T = this.shape, tier = T.tier;
    const st = this.aq.st;
    const light = gearLevel(st, 'light');
    const R = new RNG(1234 + tier * 77);
    const W = T.W;
    this.scenery = [];
    const rocks = 2 + tier * 2;
    const kinds = ['boulder', 'stack', 'slate', 'mossy', 'boulder', 'mossy'];
    for (let i = 0; i < rocks; i++) {
      const l = i % 3 === 0 ? 2 : i % 3 === 1 ? 1 : R.chance(0.5) ? 2 : 0;
      const x = (R.float(0.06, 0.94) - 0.5) * W;
      const size = (l === 2 ? R.float(46, 80) : R.float(28, 54)) * (1 + tier * 0.04);
      this.scenery.push({ type: 'rock', kind: kinds[(i + tier) % kinds.length], seed: tier * 50 + i, x, l, size });
    }
    if (tier >= 1) this.scenery.push({ type: 'rock', kind: 'driftwood', seed: tier, x: (R.float(0.2, 0.8) - 0.5) * W, l: 1, size: 90 + tier * 10 });
    for (let i = 0; i < 1 + (tier >> 1); i++) this.scenery.push({ type: 'rock', kind: 'marimo', seed: i + tier * 3, x: (R.float(0.1, 0.9) - 0.5) * W, l: 0, size: 14 + R.float(0, 6) });
    // lush static plants: swords and stem plants at the back, ferns mid, anubias and moss carpets in front
    const P = (kind, l, size, n) => { for (let i = 0; i < n; i++) this.scenery.push({ type: 'plant', kind, seed: tier * 40 + i * 7 + kind.length, x: (R.float(0.04, 0.96) - 0.5) * W, l, size: size * R.float(0.8, 1.2) }); };
    P('sword', 2, 120 + tier * 8, 1 + tier);
    P('redstem', 2, 110 + tier * 6, 1 + Math.ceil(tier * 0.8));
    P('fern', 1, 70, 1 + (tier >> 1));
    P('sword', 1, 80, tier >> 1);
    P('anubias', 0, 38, 1 + (tier >> 1));
    P('moss', 0, 16, 2 + tier);
    P('moss', 1, 14, 1 + (tier >> 1));
    for (let i = 0; i < 1 + tier; i++) this.scenery.push({ type: 'rock', kind: 'pebbles', seed: i + tier * 9, x: (R.float(0.08, 0.92) - 0.5) * W, l: R.chance(0.5) ? 0 : 1, size: 30 + R.float(0, 20) });
    // plants (physics plant fields, one per plane)
    for (const f of this.fields) f.list.length = 0;
    const nPl = (TANK_TIERS[tier]?.plants || 4) + light * 2;
    const water = '#3aa8e0';
    for (let i = 0; i < nPl * 2; i++) {
      const l = i % 5 === 0 ? 0 : i % 2 ? 2 : 1;
      const xw = (R.float(0.03, 0.97) - 0.5) * W;
      this.addPlant(l, xw, R, water, i);
    }
    this.fieldsAt = null;
  }

  addPlant(l, xw, R, water, i) {
    const T = this.shape, z = T.planeZ[l], k = this.sOf(z) * this.Z;
    const h = T.planeH(l, xw);
    const kinds = l === 2 ? ['kelp', 'kelp', 'seagrass', 'frond', 'whip'] : l === 1 ? ['seagrass', 'frond', 'kelp', 'fan', 'flower'] : ['grass', 'seagrass', 'flower', 'fan'];
    const kind = R.pick(kinds);
    const fog = l === 2 ? 0.22 : l === 1 ? 0.08 : 0;
    const col = R.pick(PLANT_COLS);
    const size = (kind === 'kelp' ? R.float(0.9, 1.2) * (0.7 + this.shape.H / 600) : R.float(1.3, 2.1)) * k / 1.4;
    const n = kind === 'kelp' ? Math.round(R.int(7, 11) * (0.7 + this.shape.H / 700)) : undefined;
    const tuft = kind === 'grass' || kind === 'seagrass' ? R.int(3, 5) : 1;
    for (let t = 0; t < tuft; t++) {
      const x = xw + (t - tuft / 2) * 3;
      this.fields[l].add({
        kind, x: (x * k) / 2, y: (-h * k) / 2 + 1, z: l * 0.5, s: 1, layer: 'p' + l, rng: R, size: size * R.float(0.8, 1.1), n,
        w: kind === 'kelp' ? [6, 4.4] : kind === 'seagrass' ? [4.6, 1.2] : kind === 'grass' ? [3.4, 0.8] : kind === 'frond' ? [2.4, 1] : kind === 'whip' ? [2.8, 0.8] : kind === 'fan' ? [3, 1.2] : kind === 'flower' ? [2, 1.6] : undefined,
        cols: plantCols(mix(col, '#ffffff', 0.05), water, fog, { bulb: kind === 'kelp' ? '#e8d84a' : null }),
        head: kind === 'flower' ? { type: 'flower', ...headCols(R.pick(FLOWER_COLS), '#ffe24a', water, fog) } : null,
      });
    }
    void i;
  }

  // ------------------------------------------------------------------ sprites for placed pieces
  // piece: {kind: 'decor'|'building', id, v, l, flip}
  pieceSprite(p) {
    const Z = this.Z, sK = this.sOf(this.layerZ(p.l));
    if (p.kind === 'building') {
      const sc = qScale(BUILD_K * Z * sK * (BUILDINGS[p.id] ? 1 : 1.15));
      const s = buildingSprite(p.id, { scale: sc, yaw: 0 });
      if (!s) return null;
      const k = s.approx || 1;
      return { canvas: p.flip ? s.flipped() : s.canvas, glow: p.flip ? s.glowFlipped?.() : s.glow, ox: p.flip ? s.w - s.ox : s.ox, oy: s.oy, w: s.w, h: s.h, k, anchors: s.anchors, src: s };
    }
    if (!PROPS[p.id]) return null;
    const sc = Math.max(0.3, Math.round(DECOR_K * Z * sK * 8) / 8);
    const key = `prop|${p.id}|${p.v || 0}|${sc}`;
    const s = this.sprite(key, () => getPropSteps(p.id, { scale: sc, variant: p.v || 0, yaw: 0, pitch: 18 }));
    if (!s) return null;
    return { canvas: p.flip ? flipped(s.canvas) : s.canvas, ox: p.flip ? s.w - s.ox : s.ox, oy: s.oy, w: s.w, h: s.h, k: 1 };
  }

  rockSprite(r) {
    const sK = this.sOf(this.layerZ(r.l));
    const px = Math.round(r.size * this.Z * sK);
    if (r.type === 'plant') return this.sprite(`plant|${r.kind}|${r.seed}|${px}`, () => plantSteps(r.kind, r.seed, px));
    return this.sprite(`rock|${r.kind}|${r.seed}|${px}`, () => rockSteps(r.kind, r.seed, px));
  }

  // the glass frame's pieces are built (the grow animation waits for them)
  frameReady() {
    const L = gearLevel(this.aq.st, 'light');
    return ['base', 'pillar', 'hood'].every((k) => this.frame(k, k === 'hood' ? { light: L } : {}));
  }
  frame(kind, o = {}) { return this.sprite(`frame|${kind}|${this.Z}|${o.light ?? ''}`, () => frameSteps(kind, this.Z, o)); }
  room(kind) { return this.sprite(`room|${kind}`, () => roomSteps(kind, 3)); }
  gear(kind, lv) { return this.sprite(`gear|${kind}|${lv}|${this.Z}`, () => gearSteps(kind, lv, this.Z)); }

  // ------------------------------------------------------------------ per-frame effects state
  update(dt, cam) {
    const T = this.shape;
    // plant physics: fish push through the plants of their plane
    const Z = this.Z;
    for (let l = 0; l < 3; l++) {
      const A = this.proj(0, 0, T.planeZ[l], cam);
      const pushers = [];
      for (const f of this.aq.fish) {
        if (this.layerOfZ(f.p[2]) !== l) continue;
        const q = this.proj(f.p[0], f.p[1], f.p[2], cam);
        const d = f.dir;
        pushers.push({ x: q.x / 2, y: q.y / 2, r: (f.len * q.s * Z) / 4 + 2, vx: d[0] * f.speed * Z * 0.5, vy: -d[1] * f.speed * Z * 0.5, k: 1, z: l * 0.5 });
      }
      const view = { x0: -20, y0: -20, x1: this.W / 2 + 20, y1: this.H / 2 + 20 };
      this.fields[l].update(dt, { t: this.aq.t, view, pushers, dx: A.x / 2, dy: A.y / 2, flow: 0.15 });
    }
    // ambient bubbles from the air stones and the filter, drifting motes
    const air = gearLevel(this.aq.st, 'air');
    this.bubT = (this.bubT || 0) - dt * (1.2 + air * 0.9);
    while (this.bubT < 0) {
      this.bubT += 0.12;
      const src = this.bubbleSources();
      if (!src.length) break;
      const s = src[(Math.random() * src.length) | 0];
      this.aq.addBubble([s[0] + (Math.random() - 0.5) * (s[3] || 3), s[1], s[2]], (air >= 3 && Math.random() < 0.25 ? 2.2 : 1) * (0.8 + Math.random() * 1.4));
    }
  }

  // world points where bubbles rise from: [x, y, z, spread]
  bubbleSources() {
    const T = this.shape, st = this.aq.st, out = [];
    const air = gearLevel(st, 'air');
    for (const g of this.gearPlacement()) {
      if (g.kind === 'airstone') out.push([g.x, T.floorY(g.x, g.z) + 2, g.z, g.lv === 2 ? 50 : 3]);
      if (g.kind === 'filter' && g.lv === 0) out.push([g.x, T.floorY(g.x, g.z) + 6, g.z, 3]);
    }
    if (!air && !out.length) out.push([0, T.floorY(0, 0) + 2, 0, 2]);
    return out;
  }

  // equipment positions (world): filter back-left, heater on the back glass right, air stones on the back plane
  gearPlacement() {
    const T = this.shape, st = this.aq.st, W = T.W;
    const f = gearLevel(st, 'filter'), h = gearLevel(st, 'heater'), a = gearLevel(st, 'air');
    const zb = T.planeZ[2] - T.D * 0.08;
    const out = [{ kind: 'filter', lv: f, x: -W / 2 + Math.min(70, W * 0.1), z: zb, l: 2 }];
    if (h > 0) out.push({ kind: 'heater', lv: h, x: W / 2 - Math.min(64, W * 0.09), z: -T.D / 2 + 4, l: 3, y: T.waterY - 6 });
    const n = a >= 2 ? 1 : a + 1;
    for (let i = 0; i < n; i++) {
      const u = n === 1 ? (a >= 2 ? 0.5 : 0.62) : 0.35 + i * 0.4;
      out.push({ kind: 'airstone', lv: a, x: (u - 0.5) * W * (a >= 2 ? 0.2 : 0.8), z: zb, l: 2 });
    }
    return out;
  }

  // ------------------------------------------------------------------ drawing
  draw(ctx, cam, o = {}) {
    this.ensure();
    bindCtx(ctx);
    const aq = this.aq, T = this.shape, t = aq.t, Z = cam.Z;
    const st = aq.st;
    const lampOff = !!st.tank.lampOff;
    const night = aq.nightK || 0;
    const dark = clamp01((lampOff ? 0.55 : 0) + night * 0.35);
    const lightLv = gearLevel(st, 'light');
    // tank rectangles: the front glass (z = D/2) and back glass (z = -D/2); grow animation scales the box
    const gk = o.grow || null;
    const hw = (T.W / 2) * (gk ? gk[0] : 1), hh = T.H * (gk ? gk[1] : 1);
    const zf = T.D / 2, zb = -T.D / 2;
    const F0 = this.proj(-hw, 0, zf, cam), F1 = this.proj(hw, hh, zf, cam);
    const B0 = this.proj(-hw, 0, zb, cam), B1 = this.proj(hw, hh, zb, cam);
    const fx0 = Math.round(F0.x), fx1 = Math.round(F1.x), fy0 = Math.round(F1.y), fy1 = Math.round(F0.y);
    if (cam.full) this.drawRoom(ctx, cam, fx0, fx1, fy0, fy1);
    else { ctx.save(); ctx.beginPath(); ctx.rect(cam.clip.x, cam.clip.y, cam.clip.w, cam.clip.h); ctx.clip(); }
    // ---- interior
    ctx.save();
    ctx.beginPath(); ctx.rect(fx0, fy0, fx1 - fx0, fy1 - fy0); ctx.clip();
    const wy = Math.round(this.proj(0, Math.min(hh - 2, T.waterY * (gk ? gk[2] : 1)), zf, cam).y);
    this.drawWater(ctx, fx0, fx1, fy0, fy1, wy, cam);
    // back glass: the reef relief, the inner corners of the box
    const bd = this.backdrop;
    if (bd) {
      const A = this.proj(0, 0, zb + 1, cam);
      ctx.globalAlpha = 0.9;
      ctx.drawImage(bd.canvas, Math.round(A.x - bd.ox), Math.round(A.y - bd.oy));
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    ctx.fillRect(Math.round(B0.x), Math.round(B1.y), 1, Math.round(B0.y - B1.y));
    ctx.fillRect(Math.round(B1.x), Math.round(B1.y), 1, Math.round(B0.y - B1.y));
    this.drawEdge(ctx, F0.x, F1.y, B0.x, B1.y, 'rgba(255,255,255,0.22)');
    this.drawEdge(ctx, F1.x, F1.y, B1.x, B1.y, 'rgba(255,255,255,0.22)');
    // light shafts from the hood
    this.drawRays(ctx, cam, fx0, fx1, fy0, fy1, lightLv, dark, t);
    // ---- depth-sorted contents
    const items = this.collect(cam);
    // wall-mounted pieces first (on the back glass)
    for (const it of items) if (it.l === 3) it.draw();
    for (let l = 2; l >= 0; l--) {
      const P = this.planes[l];
      const A = this.proj(0, 0, T.planeZ[l], cam);
      if (P) {
        ctx.drawImage(P.canvas, Math.round(A.x - P.ox), Math.round(A.y - P.oy));
        this.drawCaustics(ctx, P, Math.round(A.x - P.ox), Math.round(A.y - P.oy), t, (0.5 - l * 0.12) * (1 - dark) * (0.7 + lightLv * 0.12));
      } else this.drawPlaneFallback(ctx, l, cam);
      // fish shadows on this plane
      this.drawShadows(ctx, cam, l);
      ctx.save();
      ctx.setTransform(2, 0, 0, 2, 0, 0);
      this.fields[l].draw(ctx, 'p' + l, { dx: A.x / 2, dy: A.y / 2, view: { x0: 0, y0: 0, x1: this.W / 2, y1: this.H / 2 } });
      ctx.restore();
      const mine = items.filter((it) => it.l === l).sort((a, b) => a.z - b.z || a.y - b.y);
      for (const it of mine) it.draw();
    }
    this.drawFood(ctx, cam);
    this.drawBubbles(ctx, cam, t);
    this.drawDrops(ctx, cam, t);
    this.drawMotes(ctx, cam, t, fx0, fx1, fy0, fy1);
    this.drawSurface(ctx, cam, fx0, fx1, wy, t, hw);
    if (dark > 0.01) {
      ctx.fillStyle = rgba('#06204a', dark * 0.62);
      ctx.fillRect(fx0, fy0, fx1 - fx0, fy1 - fy0);
      // glowing pieces and the light still shine
      ctx.globalCompositeOperation = 'lighter';
      for (const it of items) if (it.glow) it.glow(dark);
      ctx.globalCompositeOperation = 'source-over';
    }
    this.drawGlass(ctx, fx0, fx1, fy0, fy1, t);
    ctx.restore();
    if (cam.full) this.drawFrame(ctx, cam, fx0, fx1, fy0, fy1, lightLv, dark, t);
    else ctx.restore();
  }

  drawEdge(ctx, x0, y0, x1, y1, col) {
    ctx.fillStyle = col;
    const n = Math.max(1, Math.round(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))));
    for (let i = 0; i <= n; i += 1) ctx.fillRect(Math.round(lerp(x0, x1, i / n)), Math.round(lerp(y0, y1, i / n)), 1, 1);
  }

  // ---- the Frutiger Aero room behind and around the tank
  drawRoom(ctx, cam, fx0, fx1, fy0, fy1) {
    const W = this.W, H = this.H, T = this.shape;
    const zr = -T.D / 2 - 260;
    const wall = this.room('wall');
    const A = this.proj(0, 0, zr, cam);
    if (wall) {
      const ox = ((Math.round(A.x) % wall.w) + wall.w) % wall.w;
      for (let y = -((Math.round(A.y) % wall.h + wall.h) % wall.h); y < H; y += wall.h) for (let x = ox - wall.w; x < W; x += wall.w) ctx.drawImage(wall.canvas, x, y);
    } else { ctx.fillStyle = '#e2f4ff'; ctx.fillRect(0, 0, W, H); }
    // a glossy chair rail at the tank's base height
    const rail = this.room('rail');
    if (rail) {
      const ry = Math.round(this.proj(0, -6, zr, cam).y);
      const ox = ((Math.round(A.x) % rail.w) + rail.w) % rail.w;
      for (let x = ox - rail.w; x < W; x += rail.w) ctx.drawImage(rail.canvas, x, ry);
    }
    // soft daylight: brighter toward the top of the room
    if (!this.roomLight || this.roomLight.height !== H) this.roomLight = gradientStrip(H, [[0, '#ffffff'], [0.45, '#e8f8ff'], [1, '#b8e0f8']], { levels: 10, w: 8 }), this.roomPat = null;
    this.roomPat ||= ctx.createPattern(this.roomLight, 'repeat-x');
    ctx.save(); ctx.globalAlpha = 0.35; ctx.fillStyle = this.roomPat; ctx.fillRect(0, 0, W, H); ctx.restore();
    // soft window light pooling on the wall
    drawAeroGlow(ctx, Math.round(A.x - 260 * A.s * cam.Z), Math.round(A.y - 300 * A.s * cam.Z), Math.round(160 * cam.Z), '#ffffff', 0.35);
    // the floor under the stand
    const floorY = Math.round(this.proj(0, -120, zr + 40, cam).y);
    const fl = this.room('floor');
    if (fl) {
      const ox = ((Math.round(A.x * 1.3) % fl.w) + fl.w) % fl.w;
      for (let y = floorY; y < H; y += fl.h) for (let x = ox - fl.w; x < W; x += fl.w) ctx.drawImage(fl.canvas, x, y);
    } else { ctx.fillStyle = '#f0dcb4'; ctx.fillRect(0, floorY, W, H - floorY); }
    ctx.fillStyle = 'rgba(120,170,210,0.35)';
    ctx.fillRect(0, floorY, W, 2);
    // room props, spaced around the tank (they only show where the tank does not cover them)
    const span = T.W / 2;
    const props = [
      ['window', -span - 230, 150], ['monstera', -span - 120, -120], ['lamp', span + 110, -120], ['shelf', span + 200, 120],
      ['window', span + 330, 150], ['monstera', span + 380, -120], ['shelf', -span - 380, 110],
    ];
    for (const [kind, x, y] of props) {
      const s = this.room(kind);
      if (!s) continue;
      const p = this.proj(x, y, zr, cam);
      const dx = Math.round(p.x - s.ox), dy = Math.round(p.y - s.oy);
      if (dx > W || dx + s.w < 0 || dy > H || dy + s.h < 0) continue;
      ctx.drawImage(s.canvas, dx, dy);
      if (s.glow) { ctx.globalCompositeOperation = 'lighter'; ctx.drawImage(s.glow, dx, dy); ctx.globalCompositeOperation = 'source-over'; }
    }
    // the tank's soft shadow on the wall
    ctx.fillStyle = 'rgba(30,90,150,0.10)';
    ctx.fillRect(fx0 + 10, fy0 + 14, fx1 - fx0, fy1 - fy0);
  }

  drawWater(ctx, fx0, fx1, fy0, fy1, wy, cam) {
    const pal = WATER[gearLevel(this.aq.st, 'filter') >= 2 ? 1 : 0];
    const h = Math.max(8, fy1 - wy);
    const key = h + pal.top;
    if (!this.waterTex || this.waterKey !== key) {
      this.waterKey = key;
      this.waterTex = gradientStrip(h, [[0, pal.top], [0.35, pal.mid], [1, pal.bot]], { levels: 20, w: 8 });
      this.waterPat = null;
    }
    this.waterPat ||= ctx.createPattern(this.waterTex, 'repeat-x');
    // air gap between the waterline and the lid: a pale glassy band with a reflection line
    const ah = Math.max(0, wy - fy0);
    if (ah > 0) {
      if (!this.airTex || this.airTex.height !== ah) this.airTex = gradientStrip(ah, [[0, '#ffffff'], [0.5, pal.air], [1, '#bdf2ff']], { levels: 8, w: 8 }), this.airPat = null;
      this.airPat ||= ctx.createPattern(this.airTex, 'repeat-x');
      ctx.save(); ctx.translate(0, fy0); ctx.fillStyle = this.airPat; ctx.fillRect(fx0, 0, fx1 - fx0, ah); ctx.restore();
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.fillRect(fx0, fy0 + Math.round(ah * 0.35), fx1 - fx0, 1);
    }
    ctx.save();
    ctx.translate(0, wy);
    ctx.fillStyle = this.waterPat;
    ctx.fillRect(fx0, 0, fx1 - fx0, fy1 - wy);
    ctx.restore();
    void cam;
  }

  drawRays(ctx, cam, fx0, fx1, fy0, fy1, lightLv, dark, t) {
    const h = fy1 - fy0;
    if (!this.rays || this.rays.height !== h) {
      this.rays = makeRays(360, h, { seed: 7, count: 7, sunX: 180, sunY: -h * 2.6, minW: 8, maxW: 26, len: 0.95, alpha: 0.42, grow: 0.7 });
      this.raysF = flipped(this.rays);
    }
    const a = (0.32 + lightLv * 0.1) * (1 - dark * 0.9);
    if (a < 0.02) return;
    const col = lightLv === 2 ? `hsl(${(t * 40) % 360},90%,75%)` : LIGHT_COLS[lightLv];
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = a * (0.85 + 0.15 * Math.sin(t * 0.7));
    const off = this.proj(0, 0, 0, cam).x;
    const sway = Math.sin(t * 0.35) * 14;
    const x0 = Math.floor((fx0 - off) / 360) - 1;
    for (let i = x0; off + i * 360 < fx1; i++) ctx.drawImage(i & 1 ? this.raysF : this.rays, Math.round(off + i * 360 + sway), fy0);
    if (lightLv === 2 || lightLv === 3) {
      ctx.globalAlpha = 0.12 * (1 - dark);
      ctx.fillStyle = col;
      ctx.fillRect(fx0, fy0, fx1 - fx0, h);
    }
    ctx.restore();
  }

  drawCaustics(ctx, P, x, y, t, a) {
    if (a <= 0.02) return;
    this.caustics ||= new Caustics({ tw: 160, th: 64, frames: 12, cx: 7, cy: 4, seed: 9, color: '#e8ffff', core: 0.7, rim: 0.3 });
    if (P.canvas.width * P.canvas.height > 900000) return;
    this.caustics.draw(ctx, P.canvas, x, y, t, a, { fps: 8, drift: 6 });
  }

  drawPlaneFallback(ctx, l, cam) {
    const T = this.shape, z = T.planeZ[l];
    const S = ['#bff4ff', '#8fe4f8', '#6ad0f0'];
    ctx.fillStyle = S[l];
    const step = 8;
    for (let x = -T.W / 2; x < T.W / 2; x += step) {
      const p = this.proj(x, T.planeH(l, x), z, cam), q = this.proj(x + step, 0, z, cam);
      ctx.fillRect(Math.round(p.x), Math.round(p.y), Math.ceil(q.x - p.x) + 1, Math.max(1, Math.round(q.y - p.y)));
    }
  }

  drawShadows(ctx, cam, l) {
    const T = this.shape;
    for (const f of this.aq.fish) {
      if (this.layerOfZ(f.p[2]) !== l) continue;
      const fy = T.floorY(f.p[0], f.p[2]);
      const hgt = f.p[1] - fy;
      const k = clamp01(1 - hgt / (T.H * 0.7));
      if (k < 0.05) continue;
      const p = this.proj(f.p[0], fy, f.p[2], cam);
      const w = Math.round(f.len * p.s * cam.Z * (0.35 + 0.25 * k));
      const sh = shadowSprite(Math.max(4, w));
      ctx.globalAlpha = 0.22 * k;
      ctx.drawImage(sh, Math.round(p.x - sh.width / 2), Math.round(p.y - sh.height / 2));
      ctx.globalAlpha = 1;
    }
  }

  // every drawable piece: rocks, equipment, decor, buildings, fish -> [{l, z, y, draw, glow}]
  collect(cam) {
    const aq = this.aq, T = this.shape, Z = cam.Z, t = aq.t;
    const out = [];
    for (const r of this.scenery) {
      const s = this.rockSprite(r);
      if (!s) continue;
      const z = T.planeZ[r.l];
      const p = this.proj(r.x, T.planeH(r.l, r.x), z, cam);
      out.push({ l: r.l, z: z - 4, y: p.y, draw: () => ctx2((c) => c.drawImage(s.canvas, Math.round(p.x - s.ox), Math.round(p.y - s.oy + 2))) });
    }
    for (const g of this.gearPlacement()) {
      const s = this.gear(g.kind, g.lv);
      if (!s) continue;
      const y = g.l === 3 ? g.y : T.floorY(g.x, g.z);
      const p = this.proj(g.x, y, g.z, cam);
      const top = g.kind === 'heater' ? 0 : 0;
      const dx = Math.round(p.x - s.ox), dy = Math.round(p.y - s.oy + (g.kind === 'heater' ? s.h : 2) + top);
      out.push({
        l: g.l, z: g.z, y: p.y, draw: () => ctx2((c) => c.drawImage(s.canvas, dx, dy)),
        glow: s.glow ? () => ctx2((c) => c.drawImage(s.glow, dx, dy)) : null,
      });
    }
    // placed decorations and buildings
    for (const d of aq.pieces()) {
      if (d.hidden) continue;
      const s = this.pieceSprite(d);
      const z = this.layerZ(d.l);
      const base = d.l === 3 ? (d.wy ?? T.H * 0.5) : T.planeH(d.l, d.x) - 1;
      const yy = base + (d.lift || 0);
      const p = this.proj(d.x, yy, z, cam);
      d.screen = null;
      if (!s) { out.push({ l: d.l, z, y: p.y, draw: () => ctx2((c) => placeholder(c, p.x, p.y, t)) }); continue; }
      const k = s.k || 1;
      const sq = d.squash || 0;
      const w = Math.round(s.w * k * (1 + sq * 0.3)), h = Math.round(s.h * k * (1 - sq * 0.35));
      const dx = Math.round(p.x - s.ox * k * (1 + sq * 0.3)), dy = Math.round(p.y - s.oy * k * (1 - sq * 0.35) - (d.hop || 0) * 2);
      d.screen = { x: dx, y: dy, w, h, canvas: s.canvas, k: w / s.w, base: p };
      const ledge = d.l === 3 ? this.gear('ledge', 0) : null;
      out.push({
        l: d.l, z: z + (d.order || 0) * 0.001, y: p.y, piece: d,
        draw: () => ctx2((c) => {
          if (ledge) c.drawImage(ledge.canvas, Math.round(p.x - ledge.ox), Math.round(p.y - ledge.oy));
          if (d.ghostA != null) c.globalAlpha = d.ghostA;
          const sx = d.shake > 0 ? Math.round(Math.sin(t * 60) * 2) : 0;
          c.drawImage(s.canvas, dx + sx, dy, w, h);
          c.globalAlpha = 1;
        }),
        glow: s.glow ? () => ctx2((c) => c.drawImage(s.glow, dx, dy, w, h))
          : PROPS[d.id]?.tags?.includes('glow') || PROPS[d.id]?.tags?.includes('crystal') ? (dk) => ctx2((c) => { drawAeroGlow(c, dx + w / 2, dy + h * 0.45, Math.round(Math.max(w, h) * 0.7), '#bff8ff', 0.3 * dk); c.globalAlpha = 0.35 * dk; c.drawImage(s.canvas, dx, dy, w, h); c.globalAlpha = 1; }) : null,
      });
    }
    // fish
    const wash = aq.nightK > 0.4 || aq.st.tank.lampOff ? { color: '#0a2a5a', alpha: 0.25 } : null;
    for (const f of aq.fish) {
      const p = this.proj(f.p[0], f.p[1], f.p[2], cam);
      const st = this.rigState(f, p, Z, t, wash);
      out.push({ l: this.layerOfZ(f.p[2]), z: f.p[2], y: p.y, fish: f, draw: () => ctx2((c) => { if (f.alpha < 1) c.globalAlpha = f.alpha; f.anchors = drawFishRig(c, f.c, st); c.globalAlpha = 1; }) });
      f.screen = { x: p.x, y: p.y, r: f.len * p.s * Z * 0.5 };
    }
    return out;
  }

  rigState(f, p, Z, t, wash) {
    const d = f.dir;
    const cy = Math.cos(f.yaw);
    const turn = clamp(cy * 1.7, -1, 1);
    const facing = turn >= 0 ? 1 : -1;
    const heading = clamp(Math.atan2(-d[2], Math.abs(d[0]) + 0.05) * 57.3 * 0.55, -24, 24);
    const sp01 = clamp01(f.speed / Math.max(1, f.cruise * 2));
    f.blinkT = (f.blinkT ?? Math.random() * 4) - 1 / 60;
    if (f.blinkT < -0.12) f.blinkT = 2 + Math.random() * 4;
    const st = {
      x: p.x, y: p.y + (f.wiggle || 0) * 2, facing, turn: Math.abs(turn) > 0.98 ? facing : turn, angle: clamp(-f.pitch * 0.85, -0.6, 0.6),
      scale: f.drawScale * p.s * Z, squash: (f.wiggle || 0) * 0.4, swimPhase: f.phase, tailPhase: f.phase, finPhase: (f.phase * 1.3) % 1, speed01: sp01,
      inflate: f.inflate || 0, lookX: null, lookY: null, blink: f.blinkT < 0 ? 1 : 0, emotion: f.state === 'sleep' ? 'sleepy' : f.state === 'flee' ? 'scared' : 'neutral',
      mouth: f.state === 'eat' ? Math.abs(Math.sin(t * 9)) : 0, time: f.age, heading, wash, glow: f.sp.glow ? 1 : 0.6, pri: 1,
    };
    if (f.c.kind === 'chain') {
      const pts = [];
      const segs = 16, L = f.len * p.s * Z;
      for (let i = 0; i < segs; i++) {
        const u = i / (segs - 1);
        pts.push({ x: p.x - facing * u * L * 0.95, y: p.y + Math.sin(t * 4 - u * 5) * L * 0.06 * u });
      }
      st.chain = pts;
    }
    return st;
  }

  drawFood(ctx, cam) {
    for (const p of this.aq.food) {
      if (p.eaten) continue;
      const q = this.proj(p.p[0], p.p[1], p.p[2], cam);
      ctx.fillStyle = p.c;
      ctx.fillRect(Math.round(q.x), Math.round(q.y), 2, 2);
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.fillRect(Math.round(q.x), Math.round(q.y), 1, 1);
    }
  }

  drawBubbles(ctx, cam, t) {
    for (const b of this.aq.bubbles) {
      const q = this.proj(b.p[0], b.p[1], b.p[2], cam);
      const r = clamp(Math.round(b.r * q.s * cam.Z * 0.9), 1, 7);
      const s = bubbleSprite(r);
      ctx.drawImage(s, Math.round(q.x + Math.sin(t * 3 + b.wob) * 0.8) - r, Math.round(q.y) - r);
    }
  }

  drawDrops(ctx, cam, t) {
    for (const c of this.aq.drops.list) {
      const q = this.proj(c.p[0], c.p[1], c.p[2], cam);
      const r = clamp(c.r * q.s * cam.Z, 3, 14);
      drawAeroGlow(ctx, q.x, q.y, Math.round(r * 2.2), '#9af0ff', 0.25 + 0.08 * Math.sin(t * 3 + c.id));
      drawAeroCoin(ctx, q.x, q.y, r, t);
      c.screen = { x: q.x, y: q.y, r };
    }
  }

  drawMotes(ctx, cam, t, fx0, fx1, fy0, fy1) {
    const T = this.shape;
    if (!this.motes.length) {
      const R = new RNG(5);
      for (let i = 0; i < 90; i++) this.motes.push({ x: R.float(-0.5, 0.5), y: R.float(0.1, 0.95), z: R.float(-0.45, 0.45), ph: R.float(0, TAU), c: R.pick(['#ffffff', '#dffcff', '#bff4ff']), a: R.float(0.25, 0.7) });
    }
    for (const m of this.motes) {
      const x = m.x * T.W + Math.sin(t * 0.2 + m.ph) * 6, y = m.y * T.waterY + Math.sin(t * 0.33 + m.ph * 2) * 4;
      const q = this.proj(x, y, m.z * T.D, cam);
      if (q.x < fx0 || q.x > fx1 || q.y < fy0 || q.y > fy1) continue;
      ctx.globalAlpha = m.a * (0.6 + 0.4 * Math.sin(t * 1.3 + m.ph));
      ctx.fillStyle = m.c;
      ctx.fillRect(Math.round(q.x), Math.round(q.y), 1, 1);
    }
    ctx.globalAlpha = 1;
  }

  // the underside of the water surface seen from below: a bright band between the front and back edges, wavelets
  drawSurface(ctx, cam, fx0, fx1, wy, t, hw) {
    const T = this.shape;
    const yb = Math.round(this.proj(0, T.waterY, -T.D / 2, cam).y);
    const top = Math.min(wy, yb), bot = Math.max(wy, yb);
    ctx.fillStyle = 'rgba(220,252,255,0.28)';
    ctx.fillRect(fx0, top, fx1 - fx0, Math.max(1, bot - top));
    const rip = this.aq.ripples;
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    const step = 2;
    for (let x = fx0; x < fx1; x += step) {
      const [wx] = this.unproj(x, wy, T.D / 2, cam);
      const h = rip ? rip.height(wx, T.D / 2 - 4, 1.6) : 0;
      const y = Math.round(wy + Math.sin(x * 0.07 + t * 2.2) * 0.8 + h * 1.4);
      ctx.fillRect(x, y, step, 1);
    }
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    for (let x = fx0; x < fx1; x += step) {
      const y = Math.round(yb + Math.sin(x * 0.05 - t * 1.7) * 0.8);
      ctx.fillRect(x, y, step, 1);
    }
    // glints under the surface
    for (let i = 0; i < 14; i++) {
      const gx = fx0 + ((i * 97 + Math.floor(t * 0.5) * 53) % Math.max(1, fx1 - fx0));
      const k = (Math.sin(t * 2.3 + i * 1.7) + 1) / 2;
      if (k < 0.7) continue;
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.fillRect(gx, top + ((i * 7) % Math.max(1, bot - top + 1)), 3, 1);
    }
    void hw;
  }

  drawGlass(ctx, fx0, fx1, fy0, fy1, t) {
    // Aero gloss: diagonal streaks fixed to the front pane and a bright band near the top
    const w = fx1 - fx0, h = fy1 - fy0;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    ctx.fillRect(fx0, fy0, w, Math.round(h * 0.08));
    const n = Math.max(2, Math.round(w / 420));
    for (let i = 0; i < n; i++) {
      const x = fx0 + Math.round(((i + 0.3) / n) * w);
      for (let y = 0; y < h; y += 2) {
        const xx = x + Math.round(y * 0.35);
        ctx.fillStyle = 'rgba(255,255,255,0.045)';
        ctx.fillRect(xx, fy0 + y, 22, 2);
        ctx.fillStyle = 'rgba(255,255,255,0.06)';
        ctx.fillRect(xx + 30, fy0 + y, 5, 2);
      }
    }
    ctx.restore();
    void t;
  }

  drawFrame(ctx, cam, fx0, fx1, fy0, fy1, lightLv, dark, t) {
    // stand + base under the glass, the glass corner pillars, the hood with its light on top
    const stand = this.frame('stand'), cap = this.frame('standcap');
    const base = this.frame('base'), bcap = this.frame('basecap');
    const pil = this.frame('pillar');
    const hood = this.frame('hood', { light: lightLv }), hcap = this.frame('hoodcap', { light: lightLv });
    const left = fx0 - (pil ? pil.w : 6), right = fx1 + (pil ? pil.w : 6);
    const by = fy1;
    let sy = by + (base ? base.h - 2 : 12);
    if (stand) {
      for (let x = left + 6; x < right - 6; x += stand.w) ctx.drawImage(stand.canvas, 0, 0, Math.min(stand.w, right - 6 - x), stand.h, x, sy, Math.min(stand.w, right - 6 - x), stand.h);
      if (cap) { ctx.drawImage(cap.canvas, left + 6 - cap.w + 2, sy); ctx.drawImage(flipped(cap.canvas), right - 8, sy); }
    }
    if (base) {
      if (bcap) { ctx.drawImage(bcap.canvas, left - bcap.w + 4, by); ctx.drawImage(flipped(bcap.canvas), right - 4, by); }
      for (let x = left; x < right; x += base.w) ctx.drawImage(base.canvas, 0, 0, Math.min(base.w, right - x), base.h, x, by, Math.min(base.w, right - x), base.h);
    } else { ctx.fillStyle = '#f4fbff'; ctx.fillRect(left, by, right - left, 12); }
    if (pil) {
      for (const x of [fx0 - pil.w, fx1]) for (let y = fy0; y < fy1; y += pil.h) ctx.drawImage(pil.canvas, 0, 0, pil.w, Math.min(pil.h, fy1 - y), x === fx1 ? x : x, y, pil.w, Math.min(pil.h, fy1 - y));
    } else { ctx.fillStyle = 'rgba(200,255,246,0.8)'; ctx.fillRect(fx0 - 6, fy0, 6, fy1 - fy0); ctx.fillRect(fx1, fy0, 6, fy1 - fy0); }
    if (hood) {
      const hy = fy0 + 3;
      if (hcap) { ctx.drawImage(hcap.canvas, left - hcap.w + 4, hy - hcap.h); ctx.drawImage(flipped(hcap.canvas), right - 4, hy - hcap.h); }
      for (let x = left; x < right; x += hood.w) ctx.drawImage(hood.canvas, 0, 0, Math.min(hood.w, right - x), hood.h, x, hy - hood.h, Math.min(hood.w, right - x), hood.h);
      // Aero gloss on the lid: a soft white sheen over its upper half and a crisp highlight line
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = 'rgba(255,255,255,0.10)';
      ctx.fillRect(left - 2, hy - hood.h + 3, right - left + 4, Math.round(hood.h * 0.4));
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fillRect(left + 6, hy - hood.h + 4, right - left - 12, 1);
      ctx.restore();
      // the light strip glows under the hood
      if (!this.aq.st.tank.lampOff) {
        const col = lightLv === 2 ? `hsl(${(t * 50) % 360},95%,72%)` : LIGHT_COLS[lightLv];
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.5 * (1 - dark * 0.6);
        ctx.fillStyle = col;
        ctx.fillRect(left + 4, hy, right - left - 8, 2);
        ctx.globalAlpha = 0.18 * (1 - dark * 0.6);
        ctx.fillRect(left + 4, hy + 2, right - left - 8, 4);
        ctx.restore();
      }
      this.hoodRect = { x: left, y: hy - hood.h, w: right - left, h: hood.h };
    }
  }
}

// ------------------------------------------------------------------ small helpers
let CTX = null;
function ctx2(fn) { fn(CTX); }
export function bindCtx(ctx) { CTX = ctx; }

const shadows = new Map();
function shadowSprite(w) {
  w = Math.max(4, Math.round(w / 2) * 2);
  let c = shadows.get(w);
  if (c) return c;
  const h = Math.max(2, Math.round(w * 0.22));
  c = makeCanvas(w, h);
  const g = ctxOf(c);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = (x + 0.5 - w / 2) / (w / 2), dy = (y + 0.5 - h / 2) / (h / 2);
    const d = dx * dx + dy * dy;
    if (d > 1) continue;
    if ((1 - d) * 1.6 < ((x + y * 3) % 4) / 4) continue;
    g.fillStyle = '#0a3a6a';
    g.fillRect(x, y, 1, 1);
  }
  shadows.set(w, c);
  return c;
}

function placeholder(ctx, x, y, t) {
  const k = (Math.sin(t * 6) + 1) / 2;
  ctx.fillStyle = `rgba(255,255,255,${0.4 + k * 0.4})`;
  ctx.fillRect(Math.round(x) - 1, Math.round(y) - 6, 2, 2);
  ctx.fillRect(Math.round(x) - 4, Math.round(y) - 3, 2, 2);
  ctx.fillRect(Math.round(x) + 3, Math.round(y) - 4, 2, 2);
}

export { glowSprite, hexToRgb, shade, hash2, artCached, PXV };
