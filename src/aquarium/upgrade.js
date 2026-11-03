// Tank upgrade transition: the old tank (a snapshot of its glass and contents) lifts off the desk, glides up
// beside the new, empty tank, tilts and pours a glossy water stream into it; the water level rises, the fish
// tumble down the stream and splash in one by one, then the old tank fades away in sparkles.
//
//   startUpgrade(aq, from, to) -> anim   (call while the OLD view is still current; then rebuild the view
//                                         and call anim.begin(aq) with the new one)
//   updateUpgrade(aq, dt), drawUpgradeBack / drawUpgradeFront(aq, ctx, sx, sy)
//   upgradeHidesFish(aq, f), upgradeFill(aq) (0..1 water level of the new tank), upgradeScale(aq) (pop-in)

import { clamp, clamp01, lerp, ease, TAU } from '../core/math.js';
import { rng } from '../core/rng.js';
import { makeCanvas, ctxOf } from '../core/canvas.js';
import { audio } from '../core/audio.js';
import { drawGlossOrb, drawSparkle, drawAeroGlow } from '../ui/aero.js';
import { drawVoxelFish } from '../gfx/voxelfish.js';
import { shellArt } from './shell.js';

const DUR = 4.4;
const T_MOVE = 0.55, T_POUR = 1.35, T_POUR_END = 3.0, T_FADE = 3.6;
const ANGLE = 1.95;

export function startUpgrade(aq, from, to) {
  const v = aq.view, L = v.L;
  const sh = shellArt(L, v.T.ell);
  const fr = sh.front;
  const bx = fr.x, by = fr.y;
  const cv = makeCanvas(fr.canvas.width, fr.canvas.height);
  const g = ctxOf(cv);
  if (sh.back) g.drawImage(sh.back.canvas, sh.back.x - bx, sh.back.y - by);
  aq.drawTank(g, L.tank.x - bx, L.tank.y - by);
  g.drawImage(fr.canvas, 0, 0);
  return {
    t: 0, dur: DUR, from, to, cv, u: L.u,
    // glass centre, mouth (top centre) and bottom of the old tank in snapshot coordinates
    cx: L.tank.x + L.tank.w / 2 - bx, cy: L.tank.y + L.tank.h / 2 - by,
    mx: L.tank.x + L.tank.w / 2 - bx, my: L.tank.y - (L.lid || 0) - by,
    bottom: L.tank.y + L.tank.h + (L.base || 0) - by,
    land: new Map(), splashed: new Set(), sounds: new Set(),
    begin(aqn) {
      const Ln = aqn.view.L;
      // same physical scale as before, but a big old tank is shrunk so it can be lifted and tipped
      this.k = Math.min(Ln.u / this.u, (Ln.tank.w * 0.42) / cv.width, (Ln.sh * 0.42) / cv.height);
      const k = this.k;
      // start: the old tank stands on the desk in front of the new one
      this.p0 = { x: Ln.sw / 2, y: Math.min(Ln.deskY, Ln.sh - 4) - (this.bottom - this.cy) * k };
      // pour from the upper left of the new tank
      const hh = (this.cy - this.my) * k;
      this.p1 = {
        x: clamp(Ln.tank.x + Ln.tank.w * 0.12, (cv.width * k) / 2 + 4, Ln.sw * 0.4),
        y: clamp(Ln.tank.y - (Ln.lid || 0) - hh * 0.5, (cv.height * k) * 0.42, Ln.sh * 0.45),
      };
      const n = aqn.fish.length;
      aqn.fish.forEach((f, i) => this.land.set(f, lerp(T_POUR + 0.55, T_POUR_END - 0.15, n > 1 ? i / (n - 1) : 0.5)));
    },
  };
}

export function updateUpgrade(aq, dt) {
  const u = aq.upgrade;
  u.t += dt;
  const T = aq.T, L = aq.view.L;
  const once = (id, fn) => { if (!u.sounds.has(id)) { u.sounds.add(id); fn(); } };
  if (u.t > 0.02) once('pop', () => play('boing', { vol: 0.5, pitch: 1.2 }));
  if (u.t > T_POUR) once('pour', () => play('splash_big', { vol: 0.55, pitch: 1.1 }));
  if (u.t > T_POUR_END) once('done', () => {
    play('catch_rare', { vol: 0.6 });
    const cx = T.W / 2, cy = T.surf + 8;
    if (aq.particles.aeroConfetti) aq.particles.aeroConfetti(cx, cy, 30, { w: T.W * 0.3 });
    else aq.particles.confetti(cx, cy, 24);
  });
  // fish splash in as they reach the water
  const P = impact(aq);
  for (const [f, tl] of u.land) {
    if (u.t < tl || u.splashed.has(f)) continue;
    u.splashed.add(f);
    const lx = P.x - L.tank.x, z = 0.25;
    f.z = z;
    f.x = clamp(lx + rng.float(-6, 6), T.left(z) + 8, T.right(z) - 8);
    f.y = T.top(z) + 4;
    f.vy = 80 * aq.view.fishScale; f.vx = rng.float(-30, 30) * aq.view.fishScale;
    f.target = null;
    aq.particles.splash(f.x, T.top(z), 0.45 * aq.view.fishScale + 0.2);
    play('splash_small', { vol: 0.45, pitch: rng.float(0.9, 1.3) });
  }
  // droplets at the impact point while pouring
  if (u.t > T_POUR + 0.15 && u.t < T_POUR_END && rng.chance(dt * 18)) {
    const lx = P.x - L.tank.x, ly = Math.max(T.top(0.3), P.y - L.tank.y);
    aq.particles.burst(lx, ly, 2, { colors: ['#ffffff', '#bfeaff', '#7fdcff'], speed: 40, g: 120, life: 0.5, up: 30, size: 1 });
  }
  if (u.t >= u.dur) aq.upgrade = null;
}

function play(n, o) { try { audio.play(n, o); } catch { /* no audio */ } }

export function upgradeHidesFish(aq, f) {
  const u = aq.upgrade;
  if (!u) return false;
  const tl = u.land.get(f);
  return tl !== undefined && u.t < tl;
}

export function upgradeFill(aq) {
  const u = aq.upgrade;
  if (!u) return 1;
  return ease.outCubic(clamp01((u.t - T_POUR - 0.2) / (T_POUR_END - T_POUR - 0.1)));
}

export function upgradeScale(aq) {
  const u = aq.upgrade;
  if (!u) return 1;
  const k = clamp01(u.t / 0.45);
  return k >= 1 ? 1 : 0.55 + 0.45 * ease.outBack(k);
}

export function drawUpgradeBack(aq, ctx, sx, sy) {
  const u = aq.upgrade;
  if (!u || u.t > 0.6) return;
  // a soft flash behind the new tank as it pops in
  const L = aq.view.L;
  drawAeroGlow(ctx, sx + L.tank.x + L.tank.w / 2, sy + L.tank.y + L.tank.h / 2, Math.max(L.tank.w, L.tank.h) * 0.7, '#e8fbff', 0.6 * (1 - u.t / 0.6));
}

// Old tank pose at time t: centre (scene coords), rotation, alpha, scale.
function pose(u) {
  const t = u.t;
  if (t < T_MOVE) return { x: u.p0.x, y: u.p0.y - Math.abs(Math.sin(t * 18)) * 2 * u.k * clamp01(t / 0.2), a: 0, alpha: 1, s: 1 };
  if (t < T_POUR) {
    const k = ease.inOutCubic((t - T_MOVE) / (T_POUR - T_MOVE));
    const x = lerp(u.p0.x, u.p1.x, k), y = lerp(u.p0.y, u.p1.y, k) - Math.sin(k * Math.PI) * 30 * u.k;
    return { x, y, a: ANGLE * ease.inOutCubic(clamp01((k - 0.25) / 0.75)), alpha: 1, s: 1 };
  }
  if (t < T_FADE) {
    const wob = Math.sin(t * 9) * 0.03;
    return { x: u.p1.x, y: u.p1.y, a: ANGLE + wob + (t > T_POUR_END ? -(t - T_POUR_END) * 0.6 : 0), alpha: 1, s: 1 };
  }
  const k = clamp01((t - T_FADE) / (DUR - T_FADE - 0.2));
  return { x: u.p1.x, y: u.p1.y - k * 20 * u.k, a: ANGLE - (T_FADE - T_POUR_END) * 0.6, alpha: 1 - k, s: 1 - 0.4 * k };
}

// Rotated mouth of the old tank (scene coords) and the direction water leaves it.
function mouth(u, p) {
  const dx = (u.mx - u.cv.width / 2) * u.k * p.s, dy = (u.my - u.cv.height / 2) * u.k * p.s;
  const c = Math.cos(p.a), s = Math.sin(p.a);
  return { x: p.x + dx * c - dy * s, y: p.y + dx * s + dy * c, dx: Math.sin(p.a), dy: -Math.cos(p.a) };
}

function impact(aq) {
  const L = aq.view.L, T = aq.T;
  const level = lerp(T.H, T.top(0.3), upgradeFill(aq));
  return { x: L.tank.x + L.tank.w * 0.5, y: L.tank.y + level };
}

function bez(a, c, b, s) {
  const m = 1 - s;
  return { x: m * m * a.x + 2 * m * s * c.x + s * s * b.x, y: m * m * a.y + 2 * m * s * c.y + s * s * b.y };
}

export function drawUpgradeFront(aq, ctx, sx, sy) {
  const u = aq.upgrade;
  if (!u || !u.p0) return;
  const p = pose(u);
  const M = mouth(u, p);
  const Pi = impact(aq);
  const P = { x: Pi.x, y: Pi.y };
  const C = { x: M.x + M.dx * 28 * u.k + (P.x - M.x) * 0.25, y: M.y + M.dy * 28 * u.k };
  const t = u.t;
  // ---- the water stream
  if (t > T_POUR - 0.05 && t < T_POUR_END + 0.35) {
    const head = clamp01((t - T_POUR + 0.05) / 0.3);       // the stream reaches down
    const tail = clamp01((t - T_POUR_END) / 0.35);          // and detaches at the end
    const w = Math.max(2.5, 8 * aq.view.L.u);
    const n = 34;
    for (let i = 0; i <= n; i++) {
      const s = i / n;
      if (s > head || s < tail) continue;
      const q = bez(M, C, P, s);
      const r = w * (1 - s * 0.35) * (0.9 + 0.1 * Math.sin(t * 20 + i));
      drawGlossOrb(ctx, sx + q.x, sy + q.y, r, i % 3 ? '#4fcff4' : '#7fe4ff');
    }
    if (head >= 1 && tail <= 0) for (let i = 0; i < 3; i++) {
      const s = ((t * 2.4 + i / 3) % 1);
      const q = bez(M, C, P, s);
      drawSparkle(ctx, sx + q.x + rng.int(-1, 1), sy + q.y - 1, 1, 0.9);
    }
  }
  // ---- fish tumbling down the stream
  for (const [f, tl] of u.land) {
    const s = (t - (tl - 0.5)) / 0.5;
    if (s < 0 || s >= 1) continue;
    const q = bez(M, C, P, s);
    const ox = f.x, oy = f.y, oa = f.angle, ofc = f.facing, ot = f.turn;
    f.x = sx + q.x; f.y = sy + q.y; f.angle = Math.sin(s * TAU) * 0.6; f.facing = 1; f.turn = 1;
    try { drawVoxelFish(ctx, f, { scale: f.scale, alpha: 1 }); } catch { /* renderer busy */ }
    f.x = ox; f.y = oy; f.angle = oa; f.facing = ofc; f.turn = ot;
  }
  // ---- the old tank
  if (p.alpha > 0.01) {
    const cv = u.cv;
    ctx.save();
    ctx.globalAlpha = p.alpha;
    ctx.translate(Math.round(sx + p.x), Math.round(sy + p.y));
    ctx.rotate(p.a);
    const k = u.k * p.s;
    ctx.drawImage(cv, -cv.width * k / 2, -cv.height * k / 2, cv.width * k, cv.height * k);
    ctx.restore();
    if (t > T_FADE) {
      for (let i = 0; i < 5; i++) {
        const a = i * 1.26 + t * 3, r = cv.width * u.k * 0.3 * (1 + (t - T_FADE));
        drawSparkle(ctx, sx + p.x + Math.cos(a) * r, sy + p.y + Math.sin(a) * r * 0.7, 2, p.alpha);
      }
    }
  }
}
