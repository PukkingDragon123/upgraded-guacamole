// The player's voxel boat (five upgrade tiers, see boatmodels.js). It rides the simulated surface (biome waves +
// the water sim lift), rolls with the slope, can be grabbed and dragged along the surface (leaving a wake and a
// bow wave), turns to face its direction of travel, puffs stovepipe smoke, flies a waving flag and carries the
// fisherman (drawCharacter) on its working deck, between the hull and the near bulwark. At night its windows,
// lamps and string lights glow (drawn after the darkness pass) and it lights the water around it.
//
// API (docs/ARCHITECTURE.md "Boat"): update(dt, inp), draw(ctx, env) (world space), hit(wx, wy), rodTip(),
// fields x, y (waterline), dir, dragging, bob, pose, poseT, holdFish, tier. Extras: drawLights(ctx, dark)
// (after the lighting pass), lights() (sources for the lighting pass), deck() (where the fisherman stands).
// Tier = game.state.boat?.tier (0..4, re-read every frame); paint = game.state.character?.boat.

import { VoxelModel } from '../gfx/voxel.js';
import * as Character from '../gfx/character.js';
import { makeLayer, resizeLayer } from '../core/canvas.js';
import { clamp, clamp01, damp, hash2, TAU } from '../core/math.js';
import { mix } from '../core/color.js';
import { rng } from '../core/rng.js';
import { rollModel, mirrorModel, idOverlay, idPaint, renderModel, WORLD_YAW, WORLD_PITCH } from './voxkit.js';
import { glowSprite } from './scenery.js';
import { puffSprites } from './sky.js';
import { buildBoatModel, BOAT_TIERS } from './boatmodels.js';

const VS = 2;            // px per voxel
const YAW = WORLD_YAW, PITCH = WORLD_PITCH;
const ROLLS = [-8, -5.3, -2.7, 0, 2.7, 5.3, 8];
const CHAR_SCALE = 0.62;

function buildFlag(paint, small) {
  const rows = small
    ? ['........', '..###...', '.#####.#', '.######.', '.#####.#', '..###...', '........']
    : ['............', '.....###....', '...######..#', '..#######.##', '..########..', '...######.##', '.....###...#', '............'];
  const w = rows[0].length, h = rows.length;
  const m = new VoxelModel(w, h, 1);
  const field = m.color('#f6f0e2', { jitter: 0.04 }), edge = m.color(paint, { jitter: 0.05 }), fishC = m.color(mix(paint, '#1a2a4a', 0.35), { jitter: 0.04 }), eye = m.color('#f6f0e2');
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const ch = rows[h - 1 - y][x];
    m.set(x, y, 0, x === 0 || y === 0 || y === h - 1 ? edge : ch === '#' ? fishC : field);
  }
  m.set(small ? 3 : 4, small ? 3 : 4, 0, eye);
  return renderModel(m, { scale: VS, flat: true, outline: true, edges: 0, sideEdges: 0 });
}

export class Boat {
  constructor(game) {
    this.game = game;
    this.x = Math.round((game.screen?.W || 960) * 0.56);
    this.y = 0;
    this.vx = 0; this.vy = 0;
    this.dir = 1;
    this.roll = 0; this.rollV = 0;
    this.bob = 0;
    this.lift = 0;
    this.dragging = false;
    this.hover = false;
    this.grabDX = 0;
    this.pose = 'idle'; this.poseT = 0; this.lastPose = 'idle';
    this.holdFish = null;
    this.facing = 1;
    this.t = 0;
    this.turnT = 0;
    this.wakeT = 0;
    this.smoke = [];
    this.smokeT = 0;
    this.models = new Map();
    this.sprites = new Map();
    this.layer = makeLayer(8, 8);
    this.anchors = null;
    this.anchorsWorld = null;
    this.placed = false;
    this.visible = false;
    this.tier = 0;
  }

  get ocean() { return this.game.ocean; }

  readTier() {
    const t = Number(this.game.state?.boat?.tier ?? 0);
    return Number.isFinite(t) ? clamp(Math.round(t), 0, BOAT_TIERS.length - 1) : 0;
  }

  paint() {
    const look = this.game.state?.character;
    let hull = look?.boat || '#c8583a', trim = '#efe2c2';
    try {
      const bp = Character.boatPaint?.(look);
      if (bp?.hull) { hull = bp.hull; trim = bp.trim || trim; }
    } catch { /* character module without boatPaint */ }
    return { hull, trim };
  }

  // ---------------------------------------------------------------- models & sprites
  model() {
    const tier = this.readTier();
    const { hull, trim } = this.paint();
    const key = tier + '|' + hull + '|' + trim;
    if (this.modelKey !== key) {
      this.modelKey = key;
      let M = this.models.get(key);
      if (!M) {
        const T = buildBoatModel(tier, hull, trim);
        M = { T, mirror: mirrorModel(T.m), flag: buildFlag(hull, tier === 0), tier };
        this.models.set(key, M);
        if (this.models.size > 4) this.models.delete(this.models.keys().next().value);
      }
      this.M = M;
      this.tier = tier;
    }
    return this.M;
  }

  buildSprite(M, dir, ri) {
    const T = M.T;
    const nx = T.m.nx;
    const src = dir > 0 ? T.m : M.mirror;
    const sp = Math.sin((PITCH * Math.PI) / 180), cp = Math.cos((PITCH * Math.PI) / 180);
    const comp = (Math.atan((sp * Math.tan((YAW * Math.PI) / 180)) / cp) * 180) / Math.PI;
    const mx = (x) => (dir > 0 ? x : nx - x);
    const deg = ROLLS[ri] + (dir > 0 ? comp : -comp);
    const { model, map } = rollModel(src, deg, mx(T.pivot[0]), T.pivot[1]);
    const r = renderModel(model, { scale: VS, yaw: dir > 0 ? YAW : -YAW, pitch: PITCH, jitter: 0.18 });
    const P = (p) => { const [x, y] = map(mx(p[0]), p[1]); return r.project(x, y, p[2]); };
    const piv = P([T.pivot[0], T.pivot[1], T.zc + 0.5]);
    const rel = (p) => { if (!p) return null; const q = P(p); return [q[0] - piv[0], q[1] - piv[1]]; };
    const A = {};
    for (const [k, p] of Object.entries(T.A)) A[k] = rel(p);
    for (const k of ['cabin', 'sub', 'under']) if (T[k]) A[k] = rel(T[k]);
    return { r, canvas: r.canvas, px: Math.round(piv[0]), py: Math.round(piv[1]), front: idOverlay(r, T.front, true), night: idPaint(r, T.night), A };
  }

  sprite(dir, ri) {
    const M = this.model();
    const key = this.modelKey + ':' + dir + ':' + ri;
    let s = this.sprites.get(key);
    if (s) return s;
    // fall back to the nearest roll already built (the rest warm up one per frame)
    for (let d = 1; d < ROLLS.length; d++) {
      for (const j of [ri - d, ri + d]) {
        const q = this.sprites.get(this.modelKey + ':' + dir + ':' + j);
        if (q) { this.want = [dir, ri]; return q; }
      }
    }
    s = this.buildSprite(M, dir, ri);
    this.sprites.set(key, s);
    if (this.sprites.size > 40) this.sprites.delete(this.sprites.keys().next().value);
    return s;
  }

  warm() {
    const M = this.model();
    const order = [3, 2, 4, 1, 5, 0, 6];
    const want = this.want;
    this.want = null;
    const tryBuild = (dir, ri) => {
      const key = this.modelKey + ':' + dir + ':' + ri;
      if (this.sprites.has(key)) return false;
      this.sprites.set(key, this.buildSprite(M, dir, ri));
      return true;
    };
    if (want && tryBuild(want[0], want[1])) return;
    for (const ri of order) if (tryBuild(this.dir, ri)) return;
  }

  // ---------------------------------------------------------------- water
  level() { return this.ocean?.waterLevel?.() ?? null; }

  waterAt(x) {
    const o = this.ocean;
    const base = o?.waveAt ? o.waveAt(x) : this.level();
    if (base === null || base === undefined) return null;
    const w = this.game.water;
    return w?.active ? base - (w.surfaceOffset(x) || 0) : base;
  }

  // ---------------------------------------------------------------- update
  update(dt, inp) {
    this.t += dt;
    if (this.pose !== this.lastPose) { this.lastPose = this.pose; this.poseT = 0; }
    this.poseT += dt;
    const g = this.game;
    const lvl = this.level();
    this.visible = lvl !== null && g.state.view === 'ocean' && !g.ocean?.travelState && !g.mini;
    if (lvl === null) { this.dragging = false; return; }
    this.model();
    if (this.visible) this.warm();
    const W = g.screen.W;
    const cur = g.world.cursor;
    const s = this.current();
    const half = s ? Math.max(24, Math.abs(s.A.bow[0] - s.A.stern[0]) * 0.42) : 52;
    // grab / drag along the surface
    this.hover = !!inp && !this.dragging && this.hit(cur.x, cur.y);
    if (inp && inp.pressed && !this.dragging && this.hit(cur.x, cur.y)) {
      this.dragging = true;
      this.grabDX = this.x - cur.x;
      inp.consume();
      g.audio?.play?.('splash_small', { vol: 0.35, pitch: 1.3 });
      g.water?.splash?.(this.x, 0.6, half * 0.6);
    }
    if (this.dragging && (!inp || !g.input.down)) {
      this.dragging = false;
      g.water?.splash?.(this.x, 0.5, half * 0.5);
    }
    const margin = half + 16;
    if (this.dragging) {
      const tx = clamp(cur.x + this.grabDX, margin, W - margin);
      this.vx += ((tx - this.x) * 38 - this.vx * 11) * dt;
      this.vx = clamp(this.vx, -420, 420);
      this.lift = damp(this.lift, clamp((lvl - 10 - cur.y) * 0.08, -2, 5), 6, dt);
    } else {
      this.vx = damp(this.vx, 0, 1.6, dt);
      this.lift = damp(this.lift, 0, 4, dt);
    }
    this.x += this.vx * dt;
    if (this.x < margin) { this.x = margin; this.vx = Math.abs(this.vx) * 0.3; }
    if (this.x > W - margin) { this.x = W - margin; this.vx = -Math.abs(this.vx) * 0.3; }
    // turn to face the direction of travel
    if (Math.abs(this.vx) > 40 && Math.sign(this.vx) !== this.dir) {
      this.turnT += dt;
      if (this.turnT > 0.25) { this.dir = Math.sign(this.vx); this.turnT = 0; g.water?.splash?.(this.x, 0.4, half * 0.5); }
    } else this.turnT = 0;
    // buoyancy: sit on the water under the hull, roll with its slope
    const ws = this.waterAt(this.x - half), wm = this.waterAt(this.x), wb = this.waterAt(this.x + half);
    const target = (ws + wm * 2 + wb) / 4 - this.lift;
    if (!this.placed) { this.y = target; this.placed = true; }
    const heavy = 1 + this.tier * 0.25;
    this.vy += ((target - this.y) * (60 / heavy) - this.vy * 9) * dt;
    this.y += this.vy * dt;
    this.bob = this.y - target;
    const slope = (wb - ws) / (half * 2);
    const rollT = clamp((-Math.atan(slope) * 57.3 * 1.15) / Math.sqrt(heavy) - this.vx * 0.012 - (this.dragging ? (cur.x + this.grabDX - this.x) * 0.02 : 0), -9, 9);
    this.rollV += ((rollT - this.roll) * (40 / heavy) - this.rollV * 7) * dt;
    this.roll += this.rollV * dt;
    // wake + bow wave while moving, gentle lapping while still
    this.wakeT -= dt;
    const sp = Math.abs(this.vx);
    const water = g.water;
    if (this.wakeT <= 0 && water) {
      this.wakeT = sp > 10 ? 0.06 : 0.45;
      if (sp > 10) {
        const k = Math.min(1, sp / 260);
        water.disturb(this.x - this.dir * (half + 6), lvl + 4, 0.35 + k * 0.9, 7 + k * 6);
        water.surf.impulse(this.x + this.dir * (half + 8), -(5 + k * 22), 12);
        water.surf.impulse(this.x - this.dir * (half + 10), 4 + k * 14, 16);
        if (k > 0.35 && rng.chance(0.5)) g.particles?.burst?.(this.x + this.dir * (half + 10), lvl - 2, 3, { colors: ['#ffffff', '#d8f4ff'], speed: 50 * k, up: 40, g: 200, life: 0.6, flat: 0.6 });
      } else water.disturb(this.x + rng.float(-half, half), lvl + 6, 0.12, 6);
    }
    // stovepipe smoke
    this.smokeT -= dt;
    if (this.smokeT <= 0 && this.anchorsWorld?.chimney) {
      this.smokeT = 0.32 + rng.float(0, 0.2);
      const c = this.anchorsWorld.chimney;
      this.smoke.push({ x: c[0], y: c[1], t: 0, life: rng.float(2.2, 3.2), r: rng.float(1.2, 2) + this.tier * 0.3, ph: rng.float(0, TAU) });
    }
    for (const p of this.smoke) { p.t += dt; p.y -= (12 - p.t * 2) * dt; p.x += (-this.dir * 4 - this.vx * 0.3 + Math.sin(p.ph + p.t * 2) * 3) * dt; }
    this.smoke = this.smoke.filter((p) => p.t < p.life);
    // the fisherman faces the hook when it is out, else forward
    const h = g.fishing?.hook;
    const tx = h && h.visible ? h.x : null;
    if (tx !== null && Math.abs(tx - this.x) > 12) this.facing = Math.sign(tx - this.x);
    else if (!h?.visible) this.facing = this.dir;
  }

  // ---------------------------------------------------------------- queries
  rollIndex() {
    let best = 0, bd = 1e9;
    for (let i = 0; i < ROLLS.length; i++) { const d = Math.abs(ROLLS[i] - this.roll); if (d < bd) { bd = d; best = i; } }
    return best;
  }

  current() {
    if (this.level() === null) return null;
    return this.sprite(this.dir, this.rollIndex());
  }

  bounds() {
    const s = this.current();
    if (!s) return null;
    const A = s.A;
    const x0 = this.x + Math.min(A.stern[0], A.bow[0]), x1 = this.x + Math.max(A.stern[0], A.bow[0]);
    return { x: x0, y: this.y + A.top[1], w: x1 - x0, h: A.keel[1] - A.top[1] + 4 };
  }

  hit(wx, wy) {
    if (!this.visible) return false;
    const b = this.bounds();
    return !!b && wx >= b.x && wx <= b.x + b.w && wy >= b.y && wy <= b.y + b.h;
  }

  deck() {
    const s = this.current();
    if (!s) return [this.x, this.y - 20];
    return [this.x + s.A.stand[0], this.y + s.A.stand[1]];
  }

  rodTip() {
    if (this.anchorsWorld?.rodTip) return this.anchorsWorld.rodTip;
    const [x, y] = this.deck();
    return [x + this.facing * 20, y - 44];
  }

  lights() {
    const a = this.anchorsWorld;
    if (!a || !this.visible) return [];
    const M = this.M;
    const out = [];
    for (const [k, r, color, al] of M?.T?.lights || []) if (a[k]) out.push({ x: a[k][0], y: a[k][1], r, color, a: al });
    return out;
  }

  // ---------------------------------------------------------------- drawing
  draw(ctx, env) {
    if (!this.visible) return;
    const s = this.current();
    if (!s) return;
    const g = this.game;
    const L = this.layer;
    const pad = 70;
    const w = s.canvas.width + pad * 2, h = s.canvas.height + pad * 2;
    if (L.w < w || L.h < h || L.w > w + 200 || L.h > h + 200) resizeLayer(L, w, h);
    const lc = L.ctx;
    lc.setTransform(1, 0, 0, 1, 0, 0);
    lc.globalAlpha = 1;
    lc.globalCompositeOperation = 'source-over';
    lc.clearRect(0, 0, L.w, L.h);
    const bx = Math.round(this.x), by = Math.round(this.y);
    const ox = bx - s.px - pad, oy = by - s.py - pad; // world position of the layer's top-left
    lc.drawImage(s.canvas, pad, pad);
    // fisherman on the working deck
    const sx = bx + Math.round(s.A.stand[0]) - ox, sy = by + Math.round(s.A.stand[1]) - oy;
    let an = null;
    try {
      an = Character.drawCharacter(lc, sx, sy, { pose: this.pose || 'idle', t: this.poseT, facing: this.facing, look: g.state.character, fish: this.holdFish, scale: CHAR_SCALE, id: 'boat', shadow: true });
    } catch (e) {
      if (!this.charErr) { this.charErr = true; console.warn('drawCharacter failed', e); }
    }
    if (s.front) lc.drawImage(s.front, pad, pad);
    // submerged part of the hull: tint below the live waterline
    const tint = g.ocean?.biome?.fogColor || '#2a7aa0';
    lc.globalCompositeOperation = 'source-atop';
    lc.fillStyle = tint;
    const x0 = Math.max(0, pad - 2), x1 = Math.min(L.w, pad + s.canvas.width + 2);
    for (const [al, dy] of [[0.45, 1], [0.25, 7]]) {
      lc.globalAlpha = al;
      for (let x = x0; x < x1; x += 2) {
        const wy = this.waterAt(ox + x);
        if (wy === null) continue;
        const yy = Math.round(wy - oy) + dy;
        if (yy < L.h) lc.fillRect(x, yy, 2, L.h - yy);
      }
    }
    lc.globalCompositeOperation = 'source-over';
    lc.globalAlpha = 1;
    this.drawSmoke(ctx);
    ctx.drawImage(L.canvas, ox, oy);
    if (s.A.flag) this.drawFlag(ctx, bx + s.A.flag[0], by + s.A.flag[1]);
    this.drawFoam(ctx, s, bx);
    const A = {};
    for (const [k, p] of Object.entries(s.A)) if (p) A[k] = [bx + p[0], by + p[1]];
    if (an?.rodTip) A.rodTip = [an.rodTip[0] + ox, an.rodTip[1] + oy];
    if (an?.hands) A.hands = [an.hands[0] + ox, an.hands[1] + oy];
    if (an?.head) A.head = [an.head[0] + ox, an.head[1] + oy];
    this.anchorsWorld = A;
    this.anchors = an;
    this.drawOrigin = [ox + pad, oy + pad];
    void env;
  }

  drawFlag(ctx, x, y) {
    const f = this.M?.flag;
    if (!f) return;
    const c = f.canvas, w = c.width, h = c.height;
    const dir = -this.dir; // streams toward the stern
    const wind = 1 + Math.min(1.5, Math.abs(this.vx) / 120);
    for (let col = 0; col < w; col += VS) {
      const k = col / w;
      const off = Math.round(Math.sin(this.t * 5 * wind - col * 0.35) * k * 2.2 + k * k * 2 * (1.6 - wind * 0.5));
      const dx = dir > 0 ? Math.round(x) + col : Math.round(x) - col - VS;
      const sx = dir > 0 ? col : w - col - VS;
      ctx.drawImage(c, sx, 0, VS, h, dx, Math.round(y) - h + 4 + off, VS, h);
    }
  }

  drawSmoke(ctx) {
    if (!this.smoke.length) return;
    const puffs = puffSprites(this.game.world?.night ? '#565c6c' : '#dfe6ec');
    for (const p of this.smoke) {
      const k = p.t / p.life;
      const s = puffs[Math.min(puffs.length - 1, Math.max(0, Math.round(p.r * 0.5 + k * 4) - 1))];
      ctx.globalAlpha = (1 - k) * (1 - k) * 0.85;
      ctx.drawImage(s, Math.round(p.x - s.width / 2), Math.round(p.y - s.height / 2));
    }
    ctx.globalAlpha = 1;
  }

  drawFoam(ctx, s, bx) {
    const sp = Math.abs(this.vx);
    ctx.fillStyle = '#f4fffc';
    for (const [ex, side] of [[s.A.stern[0], -this.dir], [s.A.bow[0], this.dir]]) {
      const x = bx + ex;
      if (this.waterAt(x) === null) continue;
      const n = 2 + Math.round(Math.min(6, sp / 40));
      for (let i = 0; i < n; i++) {
        const fx = Math.round(x + side * (i * 2 + ((this.t * 9 + i) % 2)));
        const k = hash2(i, Math.floor(this.t * 8), side + 3);
        if (k < 0.35) continue;
        ctx.globalAlpha = 0.9 - i * 0.12;
        ctx.fillRect(fx, Math.round(this.waterAt(fx)) - (k > 0.8 ? 1 : 0), 2, 1);
      }
    }
    ctx.globalAlpha = 1;
  }

  // Emissive windows, lamps and string lights (drawn after the darkness pass).
  drawLights(ctx, dark) {
    if (!this.visible || dark < 0.08 || !this.drawOrigin) return;
    const s = this.current();
    if (!s) return;
    const a = clamp01((dark - 0.08) * 2.2);
    if (s.night) {
      ctx.globalAlpha = a;
      ctx.drawImage(s.night, this.drawOrigin[0], this.drawOrigin[1]);
      ctx.globalAlpha = 1;
    }
    const A = this.anchorsWorld;
    if (!A) return;
    const flick = 0.85 + 0.15 * Math.sin(this.t * 9) * Math.sin(this.t * 3.3);
    const glow = (p, r, col, al) => {
      if (!p) return;
      const gs = glowSprite(r, col);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = al;
      ctx.drawImage(gs, Math.round(p[0]) - r, Math.round(p[1]) - r);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    };
    glow(A.lantern, 12, '#ffcf70', a * 0.75 * flick);
    glow(A.mast, 6, '#fff6d8', a * 0.6);
    glow(A.sub, 8, '#bfffff', a * 0.6);
    glow(A.under, 22, '#5affff', a * 0.35);
  }
}
