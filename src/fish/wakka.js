// Wakka quirk: the chunky retro voxel chomper moves like the arcade classic. It runs straight along an invisible
// grid at constant speed, turns in crisp 90-degree steps at grid nodes, never reverses unless boxed in,
// lays a line of glowing pellet bubbles ahead of each run and gobbles them, chomping in sync with the
// distance travelled ("wakka" on every pellet). Every so often a big power bubble makes it sparkle and
// zoom while nearby fish get a fright. Works in the ocean and in the aquarium (any world with W,
// surfaceY, floorAt). Pellets are drawn by drawPellets (fish.js in the ocean, voxelfish.drawVoxelFish in
// the tank).

import { rng } from '../core/rng.js';
import { clamp } from '../core/math.js';
import { makeCanvas, ctxOf } from '../core/canvas.js';
import { voxelOrb } from '../gfx/voxelfish.js';

const GRID = 24;        // grid cell (logical px)
const SPEED = 62;       // px/s along the grid
const CHOMP = GRID / 2; // px per chomp cycle
const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];
// states in which the fish runs the grid (others use the normal steering: bait, fleeing, eating...)
const GRID_STATES = new Set(['wander', 'idle', 'curious', 'play', 'decor', 'court']);

export function initWakka(f) {
  f.wk = { dir: null, tx: 0, ty: 0, run: 0, pellets: [], dist: 0, alt: false, eaten: 0, power: 0, nextPower: rng.int(10, 16), active: false };
}

function bounds(f) {
  const w = f.world;
  const top = (w.surfaceY ?? 0) + GRID * 1.2;
  const bot = Math.min(w.floorAt ? w.floorAt(f.x, f.z) : w.H, w.H ?? 540) - GRID * 1.2;
  return { x0: GRID, x1: (w.W ?? 960) - GRID, y0: top, y1: Math.max(top + GRID, bot) };
}
const snap = (v, o = 0) => Math.round((v - o) / GRID) * GRID + o;
const inB = (b, x, y) => x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1;

// Pick the next straight run from the current node: keep going, or turn 90 degrees; reverse only if boxed in.
function chooseRun(f, b) {
  const wk = f.wk;
  const cur = wk.dir || [f.facing || 1, 0];
  const opts = [];
  for (const d of DIRS) {
    if (d[0] === -cur[0] && d[1] === -cur[1]) continue;
    if (!inB(b, wk.tx + d[0] * GRID, wk.ty + d[1] * GRID)) continue;
    const straight = d[0] === cur[0] && d[1] === cur[1];
    // horizontal runs are favoured (it is a fish), vertical ones keep it roaming the water column
    opts.push({ d, w: (straight ? 1.4 : 1) * (d[1] ? 0.7 : 1.2) });
  }
  const d = opts.length ? rng.weighted(opts).d : [-cur[0], -cur[1]];
  let n = 0;
  const max = rng.int(2, d[1] ? 4 : 7);
  while (n < max && inB(b, wk.tx + d[0] * GRID * (n + 1), wk.ty + d[1] * GRID * (n + 1))) n++;
  wk.dir = d;
  wk.run = Math.max(1, n);
  // lay the pellet line for this run (a power bubble now and then)
  for (let i = 1; i <= wk.run; i++) {
    const x = wk.tx + d[0] * GRID * i, y = wk.ty + d[1] * GRID * i;
    if (wk.pellets.some((p) => Math.abs(p.x - x) < 2 && Math.abs(p.y - y) < 2)) continue;
    const power = wk.eaten + wk.pellets.length >= wk.nextPower && i === wk.run;
    if (power) wk.nextPower = wk.eaten + wk.pellets.length + rng.int(12, 18);
    wk.pellets.push({ x, y, t: -i * 0.06, power });
  }
  if (wk.pellets.length > 24) wk.pellets.splice(0, wk.pellets.length - 24);
}

/** Per-frame grid motion. Returns true while the grid owns the fish's movement this frame. */
export function updateWakka(f, dt) {
  const wk = f.wk;
  for (const p of wk.pellets) p.t += dt;
  if (wk.power > 0) wk.power -= dt;
  if (f.controlled || !GRID_STATES.has(f.state)) { wk.active = false; return false; }
  const w = f.world;
  const b = bounds(f);
  if (!wk.active) {
    // join the grid at the nearest node ahead
    wk.active = true;
    wk.dir = [f.facing || 1, 0];
    wk.tx = clamp(snap(f.x + (f.facing || 1) * GRID * 0.5), b.x0, b.x1);
    wk.ty = clamp(snap(f.y, b.y0 % GRID), b.y0, b.y1);
    wk.run = 1;
  }
  f.vz = 0;
  let step = SPEED * (wk.power > 0 ? 1.6 : 1) * (f.energy || 1) * dt;
  let guard = 4;
  while (step > 0 && guard-- > 0) {
    const dx = wk.tx - f.x, dy = wk.ty - f.y;
    const d = Math.hypot(dx, dy);
    if (d > step) {
      f.x += (dx / d) * step; f.y += (dy / d) * step;
      wk.dist += step;
      step = 0;
    } else {
      f.x = wk.tx; f.y = wk.ty;
      wk.dist += d;
      step -= d;
      // at a node: maybe notice bait / tank things, then continue the run or pick a new one
      if (!w.isTank && f.noticeBait?.(dt)) { wk.active = false; return false; }
      if (w.isTank && f.thinkTankIdle?.(dt)) { wk.active = false; return false; }
      wk.run--;
      if (wk.run <= 0 || !inB(b, wk.tx + wk.dir[0] * GRID, wk.ty + wk.dir[1] * GRID)) chooseRun(f, b);
      wk.tx += wk.dir[0] * GRID; wk.ty += wk.dir[1] * GRID;
      wk.tx = clamp(wk.tx, b.x0 - GRID, b.x1 + GRID);
    }
  }
  const sp = SPEED * (wk.power > 0 ? 1.6 : 1);
  f.vx = wk.dir[0] * sp; f.vy = wk.dir[1] * sp;
  // gobble pellets on the way
  for (let i = wk.pellets.length - 1; i >= 0; i--) {
    const p = wk.pellets[i];
    if (Math.abs(p.x - f.x) < GRID * 0.4 && Math.abs(p.y - f.y) < GRID * 0.4 && p.t > 0) {
      wk.pellets.splice(i, 1);
      wk.eaten++;
      wk.alt = !wk.alt;
      w.audio?.play('mash_pop', { vol: p.power ? 0.5 : 0.28, pitch: wk.alt ? 0.62 : 0.5 });
      if (p.power) powerUp(f);
      else w.particles?.burst?.(p.x, p.y, 3, { colors: ['#ffffff', '#bff8ff'], speed: 18, life: 0.35, size: 1, layer: 'fg' });
    }
  }
  return true;
}

function powerUp(f) {
  const w = f.world;
  f.wk.power = 4;
  f.feel?.('determined', 2);
  w.audio?.play('sparkle', { vol: 0.5 });
  w.particles?.burst?.(f.x, f.y, 12, { colors: ['#ffffff', '#7ff6ff', '#fff27a'], speed: 50, life: 0.7, size: 2, layer: 'fg' });
  for (const o of w.fishes || []) {
    if (o === f || o.controlled || o.hero) continue;
    if (Math.hypot(o.x - f.x, o.y - f.y) < 140) { o.feel?.('scared', 1.6); if (rng.chance(0.4)) o.say?.('!'); }
  }
}

/** After Fish.animate(): crisp facing / 90-degree angle and a chomp synced to the distance run. */
export function postWakka(f) {
  const wk = f.wk;
  if (!wk.active) return;
  if (wk.dir[0]) { f.facing = wk.dir[0]; f.angle = 0; } else f.angle = wk.dir[1] * Math.PI / 2;
  f.turn = f.facing;
  const ph = (wk.dist / CHOMP) % 1;
  f.swimPhase = ph; f.tailPhase = (wk.dist / (GRID * 0.75)) % 1; f.finPhase = f.tailPhase;
  f.bob = 0;
}

/** Rig-state extras for the Wakka fish (glow while powered up). */
export function wakkaRig(f) {
  return f.wk && f.wk.power > 0 ? { glow: 0.6 + 0.4 * Math.sin(f.age * 18) } : null;
}

// ---- pellet bubbles: small glossy voxel orbs (voxelfish.voxelOrb) inside a soft additive glow
let SPR = null;
function sprites() {
  if (SPR) return SPR;
  const mk = (n, draw) => { const c = makeCanvas(n, n); draw(ctxOf(c), n); return c; };
  const halo = (n, R, a) => mk(n, (g) => { for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { const d = Math.hypot(x + 0.5 - n / 2, y + 0.5 - n / 2); if (d < R) { g.fillStyle = `rgba(150,245,255,${(a * (1 - d / R)).toFixed(3)})`; g.fillRect(x, y, 1, 1); } } });
  SPR = {
    pellet: voxelOrb(2.6, '#d8fcff', true),
    power: voxelOrb(5, '#7ff0ff', true),
    halo: halo(13, 6, 0.45),
    powerHalo: halo(23, 10.5, 0.5),
  };
  return SPR;
}

/** Draw a Wakka fish's pellet bubbles (call before drawing the fish). */
export function drawPellets(ctx, f, alpha = 1) {
  const wk = f.wk;
  if (!wk || !wk.pellets.length) return;
  const S = sprites();
  const t = f.age || 0;
  const prevA = ctx.globalAlpha, prevOp = ctx.globalCompositeOperation;
  for (const p of wk.pellets) {
    if (p.t < 0) continue;
    const pop = Math.min(1, p.t * 6);
    const bob = Math.round(Math.sin(t * 3 + p.x * 0.1) * 0.6);
    const x = Math.round(p.x), y = Math.round(p.y) + bob;
    ctx.globalAlpha = prevA * alpha * pop;
    ctx.globalCompositeOperation = 'lighter';
    const h = p.power ? S.powerHalo : S.halo;
    const pulse = p.power ? 0.7 + 0.3 * Math.sin(t * 8) : 1;
    ctx.globalAlpha = prevA * alpha * pop * pulse;
    ctx.drawImage(h, x - (h.width >> 1), y - (h.height >> 1));
    ctx.globalCompositeOperation = prevOp;
    ctx.globalAlpha = prevA * alpha * pop;
    const s = p.power ? S.power : S.pellet;
    ctx.drawImage(s.canvas, Math.round(x - s.ax), Math.round(y - s.ay));
  }
  ctx.globalAlpha = prevA;
  ctx.globalCompositeOperation = prevOp;
}
