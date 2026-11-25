// [fishui30] Fight FX: the real struggle in the world while a fish (crate, boss) is on the line. Pure visuals: it
// reads the Battle and never changes it.
//   thrash    timed to the fish's pulls (the wander of its pull, jitter, lunges): a burst of churned whitewater,
//             bubbles and displacement streaks at the tail; near the surface a pixel SPLASH CROWN (cached 6-frame
//             sprite sheets in four sizes: a centre jet, two curling sheets with beads at their tips, a foam skirt),
//             droplets with trails, mist, foam chunks riding the live waterline and short pixel ripple lines running
//             out along the surface (never expanding circles). The surface itself is kicked through the water sim
//             (impulse only: no ring effects).
//   stream    bubbles stream from the mouth while it pulls; the line slices the surface with spray where it enters.
//   lunge     a much bigger burst, streaks, a crown when it is near the surface.
//   shock     electric pixel sparks (zig-zags re-jagged every 2 frames) crackling through the water, electrified
//             bubbles, sparkles along the surface.
//   kelp      kelp stalks rooted on the seabed near the hook (when the floor is near) and torn fronds drifting in the
//             water sway harder with the commotion and lean away from the fish.
//   landing   leap(): a huge crown, a second delayed crown, a ring of droplets, mist, foam, ripples, bubbles below.
//   flavours  crates slosh (alternating side splashes, glugging bubbles from the seams), a mimic's CHOMP sprays a fan of
//             water, a legs crate kicks bubble streams (and sand near the floor), bosses throw bigger crowns and a
//             phase change erupts.
// Intensity scales with the fish's rarity tier, fight power, weight, size and boss-ness.
// Pooled: particles live in typed arrays (no objects per particle, no per-frame allocation), capped at POOL; crowns
// are a small fixed pool. Drawn in screen space through the world transform, snapped to whole screen pixels (crisp at
// any camera zoom), one fillRect per pixel blob, constant colour strings + globalAlpha.
//
//   const fx = new FightFX(F); fx.begin(B); fx.update(dt); fx.fight(B, dt); fx.draw(ctx) [world transform]
//   fx.lunge(B, L), fx.shock(grade, chain), fx.hookset(B), fx.leap(x, surfY, power), fx.surfaceThrash(f, power),
//   fx.flexTip(rx, ry, mx, my) -> [x, y] (the rod tip bent toward the fish), fx.lineBuzz (px of line vibration)

import { TAU, clamp, clamp01, lerp, hash2 } from '../core/math.js';
import { makeCanvas, ctxOf } from '../core/canvas.js';

const POOL = 560;
// kinds
const DROP = 1, MIST = 2, BUBBLE = 3, FOAM = 4, RIPPLE = 5, CHURN = 6, STREAK = 7, SPARK = 8, FROND = 9, SAND = 10, GLINT = 11;
// colours (constant strings: alpha goes through globalAlpha)
const COL = ['#ffffff', '#e8fbff', '#bfefff', '#8ad8ff', '#5ab8e8', '#7ff4ff', '#fff6a0', '#2a7ab8', '#b8e860', '#6cc23a', '#3a8a2a', '#d8bc78', '#a88a50', '#1f5a22', '#ffffff'];
const C_WHITE = 0, C_FOAM = 1, C_PALE = 2, C_AQUA = 3, C_DEEP = 4, C_CYAN = 5, C_YELLOW = 6, C_EDGE = 7, C_KELP_L = 8, C_KELP = 9, C_KELP_D = 10, C_SAND = 11, C_SAND_D = 12, C_INK_K = 13;

// ------------------------------------------------------------------ splash crown sprite sheets
const CROWN_SIZES = [7, 11, 17, 26];
const CROWN_FRAMES = 6;
const SHEETS = new Map();
function crownSheet(si) {
  let sh = SHEETS.get(si);
  if (sh) return sh;
  const s = CROWN_SIZES[si];
  const fw = Math.ceil(s * 2.8) + 4, fh = Math.ceil(s * 2.4) + 6, base = fh - 3;
  const c = makeCanvas(fw * CROWN_FRAMES, fh), g = ctxOf(c);
  const img = g.createImageData(fw * CROWN_FRAMES, fh), d = img.data;
  const mask = new Uint8Array(fw * fh);
  const PALW = [[255, 255, 255], [214, 246, 255], [150, 220, 250]], EDGE = [42, 122, 184];
  for (let f = 0; f < CROWN_FRAMES; f++) {
    mask.fill(0);
    const p = (f + 0.5) / CROWN_FRAMES; // 0..1 life
    const cx = Math.floor(fw / 2);
    const put = (x, y, v) => { x = Math.round(x); y = Math.round(y); if (x >= 0 && y >= 0 && x < fw && y < fh && mask[y * fw + x] < v) mask[y * fw + x] = v; };
    const blob = (x, y, r, v) => { for (let yy = -r; yy <= r; yy++) for (let xx = -r; xx <= r; xx++) if (Math.abs(xx) + Math.abs(yy) <= r + (r > 1 ? 1 : 0)) put(x + xx, y + yy, yy > 0 || xx > 0 ? Math.min(v, 2) : v); };
    const grow = clamp01(p * 2.2), fall = clamp01((p - 0.5) / 0.5);
    // the foam skirt on the waterline: lumpy, widening
    const ws = s * (0.45 + 0.75 * p);
    for (let x = -ws; x <= ws; x++) {
      const hh = 1 + Math.floor(hash2(x + 50, f, si) * 2.2) + (Math.abs(x) < ws * 0.5 ? 1 : 0);
      for (let y = 0; y < hh; y++) put(cx + x, base - y, y === hh - 1 ? 3 : 2);
    }
    // two curling sheets
    const hS = s * 1.05 * grow * (1 - 0.55 * fall), spread = s * (0.32 + 0.62 * p);
    for (const side of [-1, 1]) {
      const n = Math.ceil(hS * 1.6) + 2;
      let tipX = cx, tipY = base;
      for (let i = 0; i <= n; i++) {
        const v = i / n;
        if (fall > 0.3 && hash2(i, f * 7 + side, si + 3) < fall * 0.55) continue; // the sheet breaks up as it falls
        const x = cx + side * (s * 0.22 + v * spread), y = base - 1 - Math.sin(v * Math.PI * 0.62) * hS / Math.sin(Math.PI * 0.62);
        const th = v < 0.4 && s > 10 ? 2 : 1;
        for (let k = 0; k < th; k++) put(x - side * k, y, side < 0 ? 3 : 2);
        put(x + side, y + 1, 1);
        tipX = x; tipY = y;
      }
      // beads flung off the tips
      if (p > 0.3) {
        const lift = (p - 0.3) * s * 0.9;
        blob(tipX + side * (1 + (p - 0.3) * s * 0.5), tipY - lift + fall * fall * s * 0.9, s > 12 ? 1 : 0, 3);
        if (s > 9) blob(tipX + side * (3 + (p - 0.3) * s * 0.8), tipY - lift * 0.5 + fall * fall * s * 1.2, 0, 2);
      }
    }
    // the centre jet (bigger crowns): rises then collapses into a bead
    if (s >= 10) {
      const hc = s * (si >= 3 ? 1.25 : 1.6) * Math.sin(Math.PI * clamp01(p * 1.15));
      const cw = Math.max(1, Math.round(s * 0.1));
      for (let y = 0; y < hc; y++) {
        if (fall > 0.2 && y > hc * 0.4 && hash2(y, f, si + 9) < fall) continue;
        for (let x = -cw; x <= cw; x++) put(cx + x, base - 2 - y, x < 0 ? 3 : x > 0 ? 1 : 2);
      }
      blob(cx, base - 3 - hc - (p > 0.45 ? (p - 0.45) * s * 0.6 : 0), Math.max(1, Math.round(s * 0.09)), 3);
    }
    // paint: body, shade, highlight, then a 1 px blue edge around it
    for (let y = 0; y < fh; y++) for (let x = 0; x < fw; x++) {
      const v = mask[y * fw + x];
      const o = (y * fw * CROWN_FRAMES + f * fw + x) * 4;
      if (v) {
        const col = v === 3 ? PALW[0] : v === 2 ? PALW[1] : PALW[2];
        d[o] = col[0]; d[o + 1] = col[1]; d[o + 2] = col[2]; d[o + 3] = 255;
      } else {
        let edge = false;
        for (let k = 0; k < 4 && !edge; k++) {
          const nx = x + (k === 0 ? 1 : k === 1 ? -1 : 0), ny = y + (k === 2 ? 1 : k === 3 ? -1 : 0);
          if (nx >= 0 && ny >= 0 && nx < fw && ny < fh && mask[ny * fw + nx]) edge = true;
        }
        if (edge) { d[o] = EDGE[0]; d[o + 1] = EDGE[1]; d[o + 2] = EDGE[2]; d[o + 3] = 200; }
      }
    }
  }
  g.putImageData(img, 0, 0);
  sh = { c, fw, fh, base };
  SHEETS.set(si, sh);
  return sh;
}

// Underwater thrash wash: a lumpy burst of churned whitewater blown out behind the tail (+x = backwards), blobs with
// a blue edge that swell, drift back and break up into ring bubbles. 6 frames, three sizes.
const WASH_SIZES = [9, 15, 24];
const WSHEETS = new Map();
function washSheet(si) {
  let sh = WSHEETS.get(si);
  if (sh) return sh;
  const s = WASH_SIZES[si];
  const fw = Math.ceil(s * 2.6) + 6, fh = Math.ceil(s * 1.6) + 6, ox = 3, oy = Math.floor(fh / 2);
  const c = makeCanvas(fw * CROWN_FRAMES, fh), g = ctxOf(c);
  const img = g.createImageData(fw * CROWN_FRAMES, fh), d = img.data;
  const mask = new Uint8Array(fw * fh);
  const PALW = [[255, 255, 255], [222, 248, 255], [168, 226, 250]], EDGE = [36, 110, 176];
  for (let f = 0; f < CROWN_FRAMES; f++) {
    mask.fill(0);
    const p = (f + 0.5) / CROWN_FRAMES;
    const put = (x, y, v) => { x = Math.round(x); y = Math.round(y); if (x >= 0 && y >= 0 && x < fw && y < fh && mask[y * fw + x] < v) mask[y * fw + x] = v; };
    const nb = 11;
    for (let i = 0; i < nb; i++) {
      const h1 = hash2(i, 1, si * 7), h2 = hash2(i, 2, si * 7), h3 = hash2(i, 3, si * 7);
      const bx = ox + (0.15 + 0.85 * h1) * s * (0.55 + p * 1.35), by = oy + (h2 - 0.5) * s * (0.35 + p * 0.75);
      let r = s * (0.12 + 0.16 * h3) * (1 - p * 0.55);
      const ring = false;
      if (r < 0.8) r = 0.8;
      const R = Math.round(r);
      for (let yy = -R; yy <= R; yy++) for (let xx = -R; xx <= R; xx++) {
        const dd = Math.abs(xx) + Math.abs(yy) * 1.2;
        if (dd > R + 0.5) continue;
        if (ring && dd < R - 0.6 && R > 1) continue;
        put(bx + xx, by + yy, (xx < 0 && yy < 0) || (xx === 0 && yy === -R) ? 3 : yy > 0 ? 1 : 2);
      }
    }
    // a few streaks of churned water trailing out (early frames only)
    for (let i = 0; i < (p < 0.6 ? 3 : 0); i++) {
      const y = oy + (hash2(i, 9, si) - 0.5) * s * 0.6, x0 = ox + s * 0.2 * p, len = s * (0.6 + p * 1.2) * (0.6 + hash2(i, 8, si) * 0.5);
      for (let x = 0; x < len; x++) put(x0 + x + s * p * 0.6, y, x < len * 0.3 ? 3 : 2);
    }
    for (let y = 0; y < fh; y++) for (let x = 0; x < fw; x++) {
      const v = mask[y * fw + x];
      const o = (y * fw * CROWN_FRAMES + f * fw + x) * 4;
      if (v) {
        const col = v === 3 ? PALW[0] : v === 2 ? PALW[1] : PALW[2];
        d[o] = col[0]; d[o + 1] = col[1]; d[o + 2] = col[2]; d[o + 3] = 235;
      } else {
        let edge = false;
        for (let k = 0; k < 4 && !edge; k++) {
          const nx = x + (k === 0 ? 1 : k === 1 ? -1 : 0), ny = y + (k === 2 ? 1 : k === 3 ? -1 : 0);
          if (nx >= 0 && ny >= 0 && nx < fw && ny < fh && mask[ny * fw + nx]) edge = true;
        }
        if (edge) { d[o] = EDGE[0]; d[o + 1] = EDGE[1]; d[o + 2] = EDGE[2]; d[o + 3] = 170; }
      }
    }
  }
  g.putImageData(img, 0, 0);
  sh = { c, fw, fh, ox, oy };
  WSHEETS.set(si, sh);
  return sh;
}

// the world -> screen transform of the current draw (module scope: no closures per frame)
let TA = 1, TB = 0, TC = 0, TD = 1, TE = 0, TF = 0;
const SX = (x, y) => Math.round(TA * x + TC * y + TE), SY = (x, y) => Math.round(TB * x + TD * y + TF);

// ------------------------------------------------------------------ the system
export class FightFX {
  constructor(F) {
    this.F = F;
    this.kind = new Uint8Array(POOL);
    this.col = new Uint8Array(POOL);
    this.x = new Float32Array(POOL); this.y = new Float32Array(POOL);
    this.vx = new Float32Array(POOL); this.vy = new Float32Array(POOL);
    this.t = new Float32Array(POOL); this.life = new Float32Array(POOL);
    this.sz = new Float32Array(POOL); this.seed = new Float32Array(POOL);
    this.cur = 0; this.live = 0; this.hi = 0;
    // crowns: x, y, t, life, size class, mirrored
    this.cr = { x: new Float32Array(24), y: new Float32Array(24), t: new Float32Array(24), life: new Float32Array(24), si: new Uint8Array(24), on: new Uint8Array(24), flip: new Uint8Array(24), delay: new Float32Array(24) };
    this.crCur = 0;
    // underwater washes: x, y, t, life, size class, direction (+1 = blown out to +x)
    this.ws = { x: new Float32Array(16), y: new Float32Array(16), t: new Float32Array(16), life: new Float32Array(16), si: new Uint8Array(16), on: new Uint8Array(16), dir: new Int8Array(16) };
    this.wsCur = 0;
    // rooted kelp stalks: x, floor y, height, phase
    this.kelp = { n: 0, cx: 0, x: new Float32Array(6), y: new Float32Array(6), h: new Float32Array(6), ph: new Float32Array(6) };
    this.commotion = 0; this.lean = 0; this.leanX = 0;
    this.thrT = 0.3; this.streamT = 0; this.lineT = 0; this.sparkT = 0;
    this.lineBuzz = 0; this.strain = 0;
    this.time = 0;
    this.lastPhase = 0; this.lastChomp = 0; this.sloshSide = 1; this.lastStun = false;
    this.I = 1; this.sizeK = 1; this.kelpA = 0; this.kelpT = 0;
  }

  // ---------------------------------------------------------------- helpers
  get game() { return this.F.game; }
  surf() { const s = this.F.world?.surfaceY; return s === null || s === undefined ? null : s; }
  levelAt(x) {
    const w = this.game?.water;
    if (w?.levelAt) { const v = w.levelAt(x); if (Number.isFinite(v)) return v; }
    return this.surf();
  }
  kick(x, vel, r) { try { this.game?.water?.sim?.impulse?.(x, vel, r); } catch (e) { /* no water sim */ } }

  spawn(kind, x, y, vx, vy, life, sz = 1, col = 0) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return -1;
    let i = this.cur, n = 0;
    while (this.kind[i] && n < 48) { i = (i + 1) % POOL; n++; } // a short scan; else recycle the slot under the cursor
    this.cur = (i + 1) % POOL;
    if (!this.kind[i]) this.live++;
    this.kind[i] = kind; this.x[i] = x; this.y[i] = y; this.vx[i] = vx; this.vy[i] = vy;
    this.t[i] = 0; this.life[i] = life; this.sz[i] = sz; this.col[i] = col; this.seed[i] = Math.random() * 1000;
    if (i >= this.hi) this.hi = i + 1;
    return i;
  }

  crown(x, y, size, delay = 0) {
    const C = this.cr, i = this.crCur;
    this.crCur = (i + 1) % 24;
    const si = size > 1.6 ? 3 : size > 0.95 ? 2 : size > 0.5 ? 1 : 0;
    C.x[i] = x; C.y[i] = y; C.t[i] = -delay; C.life[i] = 0.42 + si * 0.09; C.si[i] = si; C.on[i] = 1; C.flip[i] = Math.random() < 0.5 ? 1 : 0;
  }

  wash(x, y, size, dir) {
    const W = this.ws, i = this.wsCur;
    this.wsCur = (i + 1) % 16;
    W.x[i] = x; W.y[i] = y; W.t[i] = 0; W.si[i] = size > 1.3 ? 2 : size > 0.7 ? 1 : 0; W.life[i] = 0.42 + W.si[i] * 0.1; W.on[i] = 1; W.dir[i] = dir >= 0 ? 1 : -1;
  }

  clear() {
    this.kind.fill(0); this.cr.on.fill(0); this.ws.on.fill(0); this.live = 0; this.hi = 0; this.kelp.n = 0;
    this.commotion = 0; this.lineBuzz = 0; this.strain = 0;
  }

  // ---------------------------------------------------------------- fight lifecycle
  begin(B) {
    const F = this.F, f = B.fish;
    this.thrT = 0.25; this.lastPhase = B.boss?.phase || 1; this.lastChomp = 0; this.lastStun = false;
    const len = F.fishLen?.(f) || 30;
    this.sizeK = clamp(len / 40, 0.6, 3);
    this.I = clamp(0.55 + (B.pi4 || 0) * 0.18 + (B.power || 0) * 0.5 + (B.heavy || 0) * 0.2 + (B.boss ? 0.9 : 0), 0.4, 2.4);
    this.kelpT = 0; this.kelp.n = 0;
    this.plantKelp(f, len);
  }

  // Kelp rooted on the seabed around the fish when the floor is near (re-planted when the fight drifts away).
  plantKelp(f, len) {
    const F = this.F, k = this.kelp;
    let floor = NaN;
    try { floor = F.game?.ocean?.floorUnder?.(f.x, f.y); } catch (e) { floor = NaN; }
    if (!(Number.isFinite(floor) && floor - f.y < 140 && floor - f.y > 8)) return;
    if (k.n && Math.abs(k.cx - f.x) < 150) return;
    k.n = 0; this.kelpA = 0; k.cx = f.x;
    const n = 4 + (Math.random() < 0.5 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      const side = i % 2 ? 1 : -1;
      const x = f.x + side * (len * 0.3 + 6 + (i >> 1) * 14 + Math.random() * 8);
      let fy = floor;
      try { const v = F.game.ocean.floorUnder(x, f.y); if (Number.isFinite(v)) fy = v; } catch (e) { /* keep */ }
      k.x[k.n] = x; k.y[k.n] = fy + 1; k.h[k.n] = clamp((fy - f.y) * (0.55 + Math.random() * 0.5), 14, 80); k.ph[k.n] = Math.random() * TAU;
      k.n++;
    }
  }

  // The hook-set: the fish goes berserk for a moment.
  hookset(B) {
    const f = B.fish;
    this.commotion = Math.min(2, this.commotion + 1);
    this.thrash(B, f, 1.3 * this.I, true);
  }

  // per frame while fighting (after Battle.update)
  fight(B, dt) {
    const F = this.F, f = B.fish;
    if (!f || dt <= 0) return;
    const I = this.I;
    const spinG = (B.spin || 0) * (B.grip ?? 1);
    const amp = Math.max(0.05, (B.pullAmp || 0.15) + 0.1);
    const pullK = clamp01(((B.need ?? 0.5) - (B.pullBase ?? 0.5)) / amp * 0.5 + 0.5);
    const strain = clamp01(Math.abs(spinG - (B.need || 0)) * 0.8 + Math.max(0, (B.tension || 0) - 0.55) * 1.4 + (B.lunge?.stage === 'go' ? 0.5 : 0));
    this.strain += (strain - this.strain) * Math.min(1, dt * 6);
    this.lineBuzz = B.stunned ? 0.8 : clamp(this.strain * 1.6 * (0.7 + I * 0.3) + (B.lunge?.stage === 'go' ? 1.2 : 0), 0, 3);
    const len = F.fishLen?.(f) || 30;
    const facing = f.facing || 1;
    const mouth = f.anchors?.mouth || [f.x + facing * len * 0.45, f.y];
    // hook-set thrash
    if (B.mode === 'hookset') {
      this.thrT -= dt;
      if (this.thrT <= 0) { this.thrT = 0.13 + Math.random() * 0.08; this.thrash(B, f, 0.8 * I, false); }
      return;
    }
    // stunned: crackles and twitching bubbles, no thrash
    if (B.stunned) {
      this.sparkT -= dt;
      if (this.sparkT <= 0) { this.sparkT = 0.05 + Math.random() * 0.06; this.sparks(f.x, f.y, len * 0.5, 1, 0.6); }
      if (Math.random() < dt * 8) this.spawn(BUBBLE, f.x + (Math.random() - 0.5) * len * 0.6, f.y, (Math.random() - 0.5) * 8, -12, 1.2, 1, C_CYAN);
      this.lastStun = true;
      return;
    }
    this.lastStun = false;
    // the beat: it braces, only a trickle of bubbles
    if (B.beat) {
      if (Math.random() < dt * 5) this.spawn(BUBBLE, mouth[0], mouth[1], facing * 6, -16, 1.4, 1, C_FOAM);
      return;
    }
    // lunge telegraph: a rapid buzz of tail bubbles while it braces
    const tail = f.anchors?.tail || [f.x - facing * len * 0.45, f.y];
    if (B.lunge?.stage === 'tele' && Math.random() < dt * 18) this.spawn(BUBBLE, tail[0], tail[1] + (Math.random() - 0.5) * 4, -facing * 20, -10, 1, Math.random() < 0.3 ? 2 : 1, C_FOAM);
    // bubbles streaming from the mouth while it pulls
    this.streamT -= dt * (3 + 11 * I * pullK);
    while (this.streamT <= 0) {
      this.streamT += 1;
      this.spawn(BUBBLE, mouth[0] + (Math.random() - 0.5) * 3, mouth[1] - 1, facing * (4 + Math.random() * 8), -(14 + Math.random() * 20), 1.2 + Math.random(), Math.random() < 0.5 ? 1 : this.bubbleSize(this.sizeK), C_FOAM);
    }
    // thrash beats, timed to the pull
    this.thrT -= dt * (0.7 + pullK * 0.9 + (B.jitAmp || 0) * 2.5);
    if (this.thrT <= 0) {
      this.thrT = lerp(0.8, 0.34, clamp01((I - 0.4) / 2)) * (0.75 + Math.random() * 0.5);
      if (B.crate) this.slosh(B, f, (0.5 + pullK * 0.7) * I);
      else this.thrash(B, f, (0.45 + pullK * 0.75) * I, false);
    }
    // the line slicing the surface: spray and short ripple lines where it enters
    const s = this.surf();
    if (s !== null) {
      const [rx, ry] = F.rodTip();
      if ((ry - s) * (mouth[1] - s) < 0) {
        const k = (s - ry) / (mouth[1] - ry), ex = rx + (mouth[0] - rx) * k;
        this.lineT -= dt * (1 + this.strain * 10 * I);
        if (this.lineT <= 0) {
          this.lineT = 0.9 + Math.random() * 0.4;
          const lv = this.levelAt(ex) ?? s;
          const dir = Math.sign(mouth[0] - rx) || 1;
          for (let i = 0; i < 2 + Math.round(this.strain * 3); i++) this.spawn(DROP, ex + (Math.random() - 0.5) * 2, lv - 1, -dir * (10 + Math.random() * 30), -(30 + Math.random() * 60 * (0.5 + this.strain)), 1, 1, i % 2 ? C_WHITE : C_PALE);
          if (Math.random() < 0.5) this.ripple(ex, lv, 0.5 + this.strain * 0.6);
          if (this.strain > 0.5) this.spawn(FOAM, ex + dir * 2, lv, dir * 6, 0, 0.8, 2, C_WHITE);
        }
      }
    }
    // crate flavours
    if (B.crate) {
      const ck = B.chompK || 0;
      if (ck > 0.9 && this.lastChomp <= 0.9) this.chomp(B, f);
      this.lastChomp = ck;
      if (B.surprise === 'legs' && B.revealed && Math.random() < dt * 14) {
        const side = Math.random() < 0.5 ? -1 : 1;
        this.spawn(BUBBLE, f.x + side * 6, f.y + 6, side * 14, -8, 0.9, 1, C_FOAM);
        let fl = NaN;
        try { fl = F.game?.ocean?.floorUnder?.(f.x, f.y); } catch (e) { fl = NaN; }
        if (Number.isFinite(fl) && fl - f.y < 24 && Math.random() < 0.4) this.spawn(SAND, f.x + side * 5, fl - 1, side * (8 + Math.random() * 14), -(6 + Math.random() * 12), 0.9, 1, Math.random() < 0.5 ? C_SAND : C_SAND_D);
      }
    }
    // bosses: a phase change erupts
    if (B.boss) {
      const ph = B.boss.phase || 1;
      if (ph !== this.lastPhase) { this.lastPhase = ph; this.erupt(f, 1.6 + ph * 0.3); }
    }
    // kelp leans away from the fish while it thrashes; re-planted when the seabed comes near
    this.leanX = f.x;
    this.kelpT -= dt;
    if (this.kelpT <= 0) { this.kelpT = 0.6; this.plantKelp(f, len); }
  }

  // ---------------------------------------------------------------- events
  // A thrash beat: whitewater and bubbles at the tail; near the surface a splash crown, droplets, foam, ripples.
  thrash(B, f, p, big) {
    const F = this.F, len = F.fishLen?.(f) || 30, facing = f.facing || 1;
    const tail = f.anchors?.tail || [f.x - facing * len * 0.45, f.y];
    const k = this.sizeK;
    this.commotion = Math.min(2.2, this.commotion + 0.22 * p);
    // the wash: a burst of churned whitewater blown out behind the tail
    this.wash(tail[0], tail[1], (0.45 + p) * Math.sqrt(k) * 0.8, -facing);
    const nb = Math.min(20, Math.round((4 + 7 * p) * Math.sqrt(k)));
    for (let i = 0; i < nb; i++) {
      const a = Math.random() * TAU, sp = 12 + Math.random() * 36 * p;
      this.spawn(BUBBLE, tail[0] + Math.cos(a) * 4 * k, tail[1] + Math.sin(a) * 3 * k, Math.cos(a) * sp - facing * 16, Math.sin(a) * sp * 0.6 - 12, 1 + Math.random() * 1.2, this.bubbleSize(k), C_FOAM);
    }
    const nc = Math.min(6, 1 + Math.round(p * 2 * Math.sqrt(k)));
    for (let i = 0; i < nc; i++) this.spawn(CHURN, tail[0] + (Math.random() - 0.5) * len * 0.3, tail[1] + (Math.random() - 0.5) * 6, -facing * (8 + Math.random() * 20), (Math.random() - 0.5) * 10, 0.45 + Math.random() * 0.35, 1 + Math.round(Math.random() * Math.min(2, p)), C_WHITE);
    const ns = big ? 4 : p > 0.6 ? 2 : 1;
    for (let i = 0; i < ns; i++) this.spawn(STREAK, tail[0], tail[1] + (Math.random() - 0.5) * 10 * k, -facing * (60 + Math.random() * 70), 0, 0.32, (6 + Math.random() * 8) * k, i % 2 ? C_WHITE : C_PALE);
    // torn kelp sometimes rips loose in the commotion
    if (Math.random() < 0.06 * p) this.spawn(FROND, tail[0], tail[1] - 4, -facing * 10 + (Math.random() - 0.5) * 10, -6, 4 + Math.random() * 2, 5 + Math.random() * 4, C_KELP);
    this.surfaceSplash(f.x + (Math.random() - 0.5) * len * 0.5, f.y, p, len);
  }

  // bubble size (world px) for a fish of size factor k: mostly small, some big ring bubbles on big fish
  bubbleSize(k) {
    const r = Math.random();
    return r < 0.45 ? 1 : r < 0.72 ? 2 : r < 0.9 ? 3 : k > 1.2 ? 4 : 3;
  }

  // A splash where the fish meets the surface, scaled by how close it is to it.
  surfaceSplash(x, y, p, len = 30) {
    const s = this.surf();
    if (s === null) return;
    const lv = this.levelAt(x) ?? s;
    const reach = 30 + len * 1.2 + 30 * this.I;
    const depth = y - lv;
    if (depth > reach || depth < -40) return;
    const near = clamp01(1 - Math.max(0, depth) / reach);
    const ps = Math.max(p * 0.35, p * Math.sqrt(near)) * Math.sqrt(this.sizeK);
    if (ps < 0.12) return;
    this.crown(x, lv, ps * 0.9);
    const nd = Math.min(22, Math.round(4 + 12 * ps));
    for (let i = 0; i < nd; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.2, sp = (60 + Math.random() * 90) * (0.6 + ps * 0.5);
      this.spawn(DROP, x + (Math.random() - 0.5) * 6, lv - 1, Math.cos(a) * sp, Math.sin(a) * sp, 1.4, Math.random() < 0.25 && ps > 0.6 ? 2 : 1, Math.random() < 0.5 ? C_WHITE : C_PALE);
    }
    for (let i = 0; i < Math.min(8, Math.round(3 * ps)); i++) this.spawn(MIST, x + (Math.random() - 0.5) * 10, lv - 2 - Math.random() * 6, (Math.random() - 0.5) * 40, -(10 + Math.random() * 30), 0.6 + Math.random() * 0.6, 1, C_FOAM);
    for (let i = 0; i < Math.min(5, 1 + Math.round(2 * ps)); i++) this.spawn(FOAM, x + (Math.random() - 0.5) * 8, lv, (Math.random() - 0.5) * 30, 0, 1 + Math.random() * 0.8, 2 + Math.round(Math.random() * 2 * Math.min(1.5, ps)), C_WHITE);
    this.ripple(x, lv, ps);
    if (ps > 0.9) this.ripple(x, lv, ps * 0.7, 0.2);
    this.kick(x, -(40 + 80 * ps), 6 + 6 * ps);
  }

  // Two short pixel wave lines running out along the surface (left and right).
  ripple(x, y, p, delay = 0) {
    for (const s of [-1, 1]) {
      const i = this.spawn(RIPPLE, x + s * 2, y, s * (16 + 18 * p), 0, 0.7 + 0.4 * p, 3 + Math.round(3 * Math.min(1.5, p)), C_WHITE);
      if (i >= 0) this.t[i] = -delay;
    }
  }

  // A crate sloshes: alternating side splashes off its corners, glug bubbles from the seams.
  slosh(B, f, p) {
    this.sloshSide = -this.sloshSide;
    const side = this.sloshSide;
    this.commotion = Math.min(2, this.commotion + 0.18 * p);
    for (let i = 0; i < 6; i++) this.spawn(BUBBLE, f.x + side * 6 + (Math.random() - 0.5) * 6, f.y - 6, side * (6 + Math.random() * 10), -(16 + Math.random() * 18), 1.2, Math.random() < 0.3 ? 2 : 1, C_FOAM);
    for (let i = 0; i < 2; i++) this.spawn(CHURN, f.x + side * 9, f.y + (Math.random() - 0.5) * 8, side * 14, (Math.random() - 0.5) * 6, 0.5, 1 + Math.round(Math.random()), C_WHITE);
    this.wash(f.x + side * 7, f.y - 2, 0.5 + p * 0.4, side);
    this.surfaceSplash(f.x + side * 8, f.y, p * 0.9, 16);
  }

  // The mimic's CHOMP: a fan of water out of its mouth.
  chomp(B, f) {
    const dir = f.facing || 1;
    for (let i = 0; i < 12; i++) {
      const a = (Math.random() - 0.5) * 1.3 - Math.PI * 0.15;
      const sp = 50 + Math.random() * 80;
      this.spawn(CHURN, f.x, f.y - 6, Math.cos(a) * sp * (i % 2 ? 1 : -1), Math.sin(a) * sp * 0.5, 0.5, 1 + (i % 3 === 0 ? 1 : 0), C_WHITE);
    }
    for (let i = 0; i < 10; i++) this.spawn(BUBBLE, f.x + (Math.random() - 0.5) * 10, f.y - 8, (Math.random() - 0.5) * 40, -(20 + Math.random() * 30), 1.1, Math.random() < 0.4 ? 2 : 1, C_FOAM);
    this.commotion = Math.min(2.2, this.commotion + 0.6);
    this.wash(f.x + 6, f.y - 6, 1.2, 1); this.wash(f.x - 6, f.y - 6, 1.2, -1);
    this.surfaceSplash(f.x, f.y, 1.4, 22);
    void dir;
  }

  // A lunge: the big shove.
  lunge(B, L) {
    const F = this.F, f = B?.fish;
    if (!f) return;
    const len = F.fishLen?.(f) || 30, facing = f.facing || 1;
    const p = (1.2 + (B.power || 0)) * this.I;
    this.thrash(B, f, p, true);
    const tail = f.anchors?.tail || [f.x - facing * len * 0.45, f.y];
    this.wash(tail[0] - facing * 4, tail[1], 1.6 * Math.sqrt(this.sizeK), -facing);
    for (let i = 0; i < 6; i++) this.spawn(STREAK, tail[0] + (Math.random() - 0.5) * 6, f.y + (Math.random() - 0.5) * len * 0.35, -facing * (90 + Math.random() * 90), 0, 0.4, (8 + Math.random() * 10) * this.sizeK, i % 2 ? C_WHITE : C_PALE);
    this.commotion = Math.min(2.4, this.commotion + 0.8);
  }

  // A shock lands: electric sparks crackle out through the water, the bubbles light up.
  shock(grade, chain = 0) {
    const F = this.F, f = F.fish;
    if (!f) return;
    const crit = grade === 'perfect', len = F.fishLen?.(f) || 30;
    this.sparks(f.x, f.y, len * (crit ? 1.1 : 0.7), crit ? 9 + chain * 3 : 5, 1);
    for (let i = 0; i < (crit ? 14 : 7); i++) {
      const a = Math.random() * TAU, sp = 20 + Math.random() * 40;
      this.spawn(BUBBLE, f.x + Math.cos(a) * len * 0.3, f.y + Math.sin(a) * 6, Math.cos(a) * sp, Math.sin(a) * sp * 0.5 - 14, 1.2, Math.random() < 0.4 ? 2 : 1, C_CYAN);
    }
    for (let i = 0; i < (crit ? 6 : 3); i++) this.spawn(GLINT, f.x + (Math.random() - 0.5) * len, f.y + (Math.random() - 0.5) * 14, 0, -4, 0.3 + Math.random() * 0.2, 1 + (crit && i < 2 ? 1 : 0), i % 2 ? C_CYAN : C_YELLOW);
    // sparks skitter along the surface when the fish is near it
    const s = this.surf();
    if (s !== null && f.y - s < 60) {
      for (let i = 0; i < (crit ? 6 : 3); i++) {
        const x = f.x + (Math.random() - 0.5) * len * 1.4;
        const j = this.spawn(SPARK, x, (this.levelAt(x) ?? s) + 1, Math.random() < 0.5 ? 0 : Math.PI, 6 + Math.random() * 10, 0.2 + Math.random() * 0.15, 1, C_CYAN);
        if (j >= 0) this.t[j] = -Math.random() * 0.15;
      }
    }
    this.commotion = Math.min(2.2, this.commotion + 0.5);
  }

  // n zig-zag sparks radiating from (x, y), r long
  sparks(x, y, r, n, k) {
    for (let i = 0; i < n; i++) {
      const a = (i / Math.max(1, n)) * TAU + Math.random() * 0.8;
      const j = this.spawn(SPARK, x + Math.cos(a) * r * 0.15, y + Math.sin(a) * r * 0.1, a, r * (0.5 + Math.random() * 0.6) * k, 0.12 + Math.random() * 0.14, 1, Math.random() < 0.3 ? C_WHITE : C_CYAN);
      if (j >= 0) this.t[j] = -Math.random() * 0.08;
    }
  }

  // A boss phase change / mimic reveal: a massive surge.
  erupt(f, p) {
    const len = this.F.fishLen?.(f) || 60;
    for (let i = 0; i < 24; i++) {
      const a = Math.random() * TAU, sp = 30 + Math.random() * 70;
      this.spawn(BUBBLE, f.x + Math.cos(a) * len * 0.3, f.y + Math.sin(a) * len * 0.15, Math.cos(a) * sp, Math.sin(a) * sp * 0.5 - 20, 1.5, Math.random() < 0.5 ? 2 : 3, C_FOAM);
    }
    for (let i = 0; i < 8; i++) this.spawn(CHURN, f.x + (Math.random() - 0.5) * len * 0.8, f.y + (Math.random() - 0.5) * 20, (Math.random() - 0.5) * 60, (Math.random() - 0.5) * 30, 0.7, 2, C_WHITE);
    this.wash(f.x - len * 0.2, f.y, 2, -1); this.wash(f.x + len * 0.2, f.y, 2, 1);
    this.commotion = 2.4;
    this.surfaceSplash(f.x, f.y, p, len);
  }

  // The landing: the big leap out of the water.
  leap(x, y, power = 1) {
    const p = clamp(power, 0.6, 3);
    this.crown(x, y, 1.2 + p * 0.5);
    this.crown(x - 6, y, 0.7 + p * 0.25, 0.16);
    this.crown(x + 7, y, 0.6 + p * 0.2, 0.3);
    const nd = Math.min(70, Math.round(26 + 16 * p));
    for (let i = 0; i < nd; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * (i % 3 ? 1.4 : 2.6), sp = (90 + Math.random() * 150) * (0.7 + p * 0.3);
      this.spawn(DROP, x + (Math.random() - 0.5) * 10, y - 1, Math.cos(a) * sp, Math.sin(a) * sp, 2, Math.random() < 0.3 ? 2 : 1, Math.random() < 0.5 ? C_WHITE : C_PALE);
    }
    for (let i = 0; i < Math.round(10 * p); i++) this.spawn(MIST, x + (Math.random() - 0.5) * 16, y - 2 - Math.random() * 10, (Math.random() - 0.5) * 60, -(20 + Math.random() * 40), 0.8 + Math.random() * 0.6, 1, C_FOAM);
    for (let i = 0; i < Math.round(6 + 4 * p); i++) this.spawn(FOAM, x + (Math.random() - 0.5) * 14, y, (Math.random() - 0.5) * 50, 0, 1.4 + Math.random(), 2 + Math.round(Math.random() * 3), C_WHITE);
    this.ripple(x, y, p); this.ripple(x, y, p * 0.8, 0.18); this.ripple(x, y, p * 0.6, 0.38);
    for (let i = 0; i < Math.round(14 * p); i++) this.spawn(BUBBLE, x + (Math.random() - 0.5) * 20, y + 4 + Math.random() * 16, (Math.random() - 0.5) * 20, -(20 + Math.random() * 30), 1.2, Math.random() < 0.4 ? 2 : 1, C_FOAM);
    this.kick(x, 120 + 60 * p, 14 + 4 * p); // it leaves the water: the surface heaves up
  }

  // The haul to the surface before the leap: quick small splashes.
  surfaceThrash(f, p) {
    const len = this.F.fishLen?.(f) || 30;
    this.surfaceSplash(f.x + (Math.random() - 0.5) * len * 0.6, f.y, p, len);
    this.spawn(CHURN, f.x - (f.facing || 1) * len * 0.4, f.y, -(f.facing || 1) * 20, -4, 0.4, 2, C_WHITE);
  }

  // The rod tip bent toward the fish under strain: [x, y] of the flexed tip.
  flexTip(rx, ry, mx, my, out) {
    const b = this.game?.boat;
    let hx = rx - 20, hy = ry + 26;
    const h = b?.anchorsWorld?.hands;
    if (h && Number.isFinite(h[0])) { hx = h[0]; hy = h[1]; }
    let dx = rx - hx, dy = ry - hy;
    const dl = Math.hypot(dx, dy) || 1; dx /= dl; dy /= dl;
    let lx = mx - rx, ly = my - ry;
    const ll = Math.hypot(lx, ly) || 1; lx /= ll; ly /= ll;
    const bend = clamp(0.25 + this.strain * 0.6 + this.lineBuzz * 0.05, 0, 0.9);
    let ex = dx + (lx - dx) * bend, ey = dy + (ly - dy) * bend;
    const el = Math.hypot(ex, ey) || 1; ex /= el; ey /= el;
    const L = 8 + this.strain * 2;
    const vib = Math.sin(this.time * 62) * this.lineBuzz * 0.35;
    out[0] = rx + ex * L - ey * vib; out[1] = ry + ey * L + ex * vib;
    out[2] = rx + dx * L * 0.55; out[3] = ry + dy * L * 0.55; // the bend's control point
    return out;
  }

  // ---------------------------------------------------------------- simulation
  update(dt) {
    if (dt <= 0) return;
    this.time += dt;
    // rooted kelp fades in with the fight and out after it
    const on = this.F.state === 'fight' || this.F.state === 'landing';
    this.kelpA = clamp01(this.kelpA + (on ? dt * 1.5 : -dt * 0.8));
    if (this.kelpA <= 0) this.kelp.n = 0;
    this.commotion = Math.max(0, this.commotion - dt * 0.7);
    const s = this.surf();
    let hi = 0;
    for (let i = 0; i < this.hi; i++) {
      const k = this.kind[i];
      if (!k) continue;
      const t = (this.t[i] += dt);
      if (t < 0) { hi = i + 1; continue; }
      if (t >= this.life[i]) { this.kind[i] = 0; this.live--; continue; }
      let x = this.x[i], y = this.y[i], vx = this.vx[i], vy = this.vy[i];
      switch (k) {
        case DROP: {
          vy += 330 * dt; vx *= 1 - dt * 0.3;
          x += vx * dt; y += vy * dt;
          if (s !== null && vy > 0 && y > s + 1) {
            const lv = this.levelAt(x) ?? s;
            if (y > lv) {
              this.kind[i] = 0; this.live--;
              if (this.sz[i] > 1 && Math.random() < 0.35) this.spawn(RIPPLE, x, lv, Math.random() < 0.5 ? -10 : 10, 0, 0.35, 2, C_WHITE);
              continue;
            }
          }
          break;
        }
        case MIST: vy += 30 * dt; vx *= 1 - dt * 2.5; vy *= 1 - dt * 2.5; x += vx * dt; y += vy * dt; break;
        case BUBBLE: {
          vy -= 40 * dt; vy *= 1 - dt * 1.2; vx *= 1 - dt * 2.2;
          x += vx * dt + Math.sin(t * 9 + this.seed[i]) * 6 * dt; y += vy * dt;
          if (s !== null && y < s + 2) {
            const lv = this.levelAt(x) ?? s;
            if (y < lv + 1) { this.kind[i] = 0; this.live--; if (this.sz[i] > 1) this.spawn(MIST, x, lv - 1, 0, -12, 0.25, 1, C_WHITE); continue; }
          }
          break;
        }
        case FOAM: case RIPPLE: {
          vx *= 1 - dt * (k === FOAM ? 1.6 : 0.9);
          x += vx * dt;
          const lv = this.levelAt(x);
          if (lv !== null) y = lv;
          break;
        }
        case CHURN: case SAND: vx *= 1 - dt * 3; vy *= 1 - dt * 3; vy += (k === SAND ? 20 : -8) * dt; x += vx * dt; y += vy * dt; break;
        case STREAK: vx *= 1 - dt * 4; x += vx * dt; break;
        case FROND: {
          vx *= 1 - dt * 0.8; vy += (4 - vy) * dt * 0.5;
          // pushed away from the fish by the commotion
          const away = Math.sign(x - this.leanX) || 1;
          vx += away * this.commotion * 6 * dt;
          x += vx * dt; y += vy * dt;
          if (s !== null && y < s + 4) { y = s + 4; vy = Math.abs(vy); }
          break;
        }
        default: x += vx * dt * (k === SPARK ? 0 : 1); y += vy * dt * (k === SPARK ? 0 : 1); break;
      }
      this.x[i] = x; this.y[i] = y; this.vx[i] = vx; this.vy[i] = vy;
      hi = i + 1;
    }
    this.hi = hi;
    const C = this.cr;
    for (let i = 0; i < 24; i++) if (C.on[i]) { C.t[i] += dt; if (C.t[i] >= C.life[i]) C.on[i] = 0; }
    const Wq = this.ws;
    for (let i = 0; i < 16; i++) if (Wq.on[i]) { Wq.t[i] += dt; Wq.x[i] += Wq.dir[i] * 14 * dt; if (Wq.t[i] >= Wq.life[i]) Wq.on[i] = 0; }
  }

  // ---------------------------------------------------------------- drawing (world transform in ctx)
  draw(ctx) {
    let crowns = 0;
    for (let i = 0; i < 24; i++) crowns += this.cr.on[i];
    for (let i = 0; i < 16; i++) crowns += this.ws.on[i];
    if (!this.hi && !this.kelp.n && !crowns) return;
    const m = ctx.getTransform();
    TA = m.a; TB = m.b; TC = m.c; TD = m.d; TE = m.e; TF = m.f;
    const z = Math.max(1, Math.round(Math.hypot(m.a, m.b)));
    const a0 = ctx.globalAlpha;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    // rooted kelp first (it stands behind the splashes)
    const K = this.kelp;
    ctx.globalAlpha = a0 * this.kelpA;
    for (let s = 0; s < K.n; s++) {
      const h = K.h[s], n = Math.max(3, Math.round(h / 2));
      const prox = clamp01(1 - Math.abs(K.x[s] - this.leanX) / 120);
      const amp = 1.5 + this.commotion * 3.2 * (0.4 + prox);
      const push = (Math.sign(K.x[s] - this.leanX) || 1) * this.commotion * 3.5 * prox;
      for (let pass = 0; pass < 2; pass++) {
        for (let j = 0; j < n; j++) {
          const k = j / n;
          const wx = K.x[s] + Math.sin(this.time * (1.4 + this.commotion) + K.ph[s] + k * 2.6) * amp * Math.pow(k, 1.3) + push * Math.pow(k, 1.2);
          const wy = K.y[s] - j * 2;
          const x = SX(wx, wy), y = SY(wx, wy);
          if (pass === 0) { ctx.fillStyle = COL[C_INK_K]; ctx.fillRect(x - z, y - z, 4 * z, 3 * z); }
          else {
            ctx.fillStyle = COL[k > 0.55 ? C_KELP : C_KELP_D]; ctx.fillRect(x, y, 2 * z, 2 * z);
            ctx.fillStyle = COL[C_KELP_L]; ctx.fillRect(x, y, z, 2 * z);
          }
          if (j % 4 === 2 && k < 0.9) {
            const side = j % 8 === 2 ? -1 : 1, lx = side < 0 ? x - 2 * z : x + 2 * z;
            if (pass === 0) { ctx.fillStyle = COL[C_INK_K]; ctx.fillRect(lx - z, y - z, 4 * z, 3 * z); }
            else { ctx.fillStyle = COL[C_KELP]; ctx.fillRect(lx, y, 2 * z, z); }
          }
        }
      }
    }
    ctx.globalAlpha = a0;
    // underwater washes behind the tail
    const Wq = this.ws;
    for (let i = 0; i < 16; i++) {
      if (!Wq.on[i]) continue;
      const sh = washSheet(Wq.si[i]);
      const f = Math.min(CROWN_FRAMES - 1, Math.floor((Wq.t[i] / Wq.life[i]) * CROWN_FRAMES));
      const x = SX(Wq.x[i], Wq.y[i]), y = SY(Wq.x[i], Wq.y[i]);
      const w = sh.fw * z, h = sh.fh * z;
      ctx.globalAlpha = a0 * (f >= CROWN_FRAMES - 1 ? 0.6 : 0.92);
      if (Wq.dir[i] < 0) {
        ctx.save(); ctx.translate(x, 0); ctx.scale(-1, 1);
        ctx.drawImage(sh.c, f * sh.fw, 0, sh.fw, sh.fh, -sh.ox * z, y - sh.oy * z, w, h);
        ctx.restore();
      } else ctx.drawImage(sh.c, f * sh.fw, 0, sh.fw, sh.fh, x - sh.ox * z, y - sh.oy * z, w, h);
    }
    ctx.globalAlpha = a0;
    const fr = Math.floor(this.time * 30);
    for (let i = 0; i < this.hi; i++) {
      const k = this.kind[i];
      if (!k) continue;
      const t = this.t[i];
      if (t < 0) continue;
      const lf = t / this.life[i];
      const x = SX(this.x[i], this.y[i]), y = SY(this.x[i], this.y[i]);
      const col = COL[this.col[i]];
      switch (k) {
        case DROP: {
          ctx.globalAlpha = a0 * (lf > 0.8 ? (1 - lf) * 5 : 1);
          const sz = this.sz[i] * z;
          // a 1-blob trail behind along its velocity
          const vx = this.vx[i], vy = this.vy[i], vl = Math.hypot(vx, vy) || 1;
          if (vl > 40) { ctx.fillStyle = COL[C_AQUA]; ctx.fillRect(x - Math.round((vx / vl) * 2 * z), y - Math.round((vy / vl) * 2 * z), z, z); }
          ctx.fillStyle = col; ctx.fillRect(x, y, sz, sz);
          break;
        }
        case MIST: ctx.globalAlpha = a0 * 0.7 * (1 - lf); ctx.fillStyle = col; ctx.fillRect(x, y, z, z); break;
        case BUBBLE: {
          const sz = this.sz[i];
          ctx.globalAlpha = a0 * (lf > 0.85 ? (1 - lf) * 6 : 0.92);
          if (sz >= 4) { // a 4x4 ring bubble: cut corners, a blue rim at the lower right, a white glint
            ctx.fillStyle = col;
            ctx.fillRect(x + z, y, 2 * z, z); ctx.fillRect(x, y + z, z, 2 * z);
            ctx.fillStyle = COL[C_EDGE];
            ctx.fillRect(x + z, y + 3 * z, 2 * z, z); ctx.fillRect(x + 3 * z, y + z, z, 2 * z);
            ctx.fillStyle = COL[C_WHITE]; ctx.fillRect(x + z, y + z, z, z);
          } else if (sz >= 3) { // a 3x3 ring
            ctx.fillStyle = col; ctx.fillRect(x + z, y, z, z); ctx.fillRect(x, y + z, z, z);
            ctx.fillStyle = COL[C_EDGE]; ctx.fillRect(x + 2 * z, y + z, z, z); ctx.fillRect(x + z, y + 2 * z, z, z);
            ctx.fillStyle = COL[C_WHITE]; ctx.fillRect(x, y, z, z);
          } else if (sz >= 2) {
            ctx.fillStyle = col; ctx.fillRect(x, y, 2 * z, 2 * z);
            ctx.fillStyle = COL[C_EDGE]; ctx.fillRect(x + z, y + z, z, z);
            ctx.fillStyle = COL[C_WHITE]; ctx.fillRect(x, y, z, z);
          } else { ctx.fillStyle = col; ctx.fillRect(x, y, z, z); }
          break;
        }
        case FOAM: {
          const w = Math.max(1, Math.round(this.sz[i] * (1 - lf * 0.6))) * z;
          ctx.globalAlpha = a0 * (lf > 0.6 ? (1 - lf) * 2.5 : 1);
          ctx.fillStyle = COL[C_PALE]; ctx.fillRect(x - w, y, w * 2, z);
          ctx.fillStyle = col; ctx.fillRect(x - w + z, y - z, Math.max(z, w * 2 - 2 * z), z);
          break;
        }
        case RIPPLE: {
          // a short wave line: flat shoulders, a raised crest in the middle (_-^-_)
          const len = Math.round(this.sz[i] * (1 + lf * 0.6)) * z;
          ctx.globalAlpha = a0 * (1 - lf) * 0.95;
          ctx.fillStyle = col;
          ctx.fillRect(x - len, y + z, len * 2, z);
          ctx.fillRect(x - Math.round(len * 0.5), y, len, z);
          ctx.fillRect(x - z, y - z, 2 * z, z);
          break;
        }
        case CHURN: {
          const r = Math.round(this.sz[i] * (1 + lf * 0.8));
          ctx.globalAlpha = a0 * (1 - lf) * 0.85;
          ctx.fillStyle = col;
          ctx.fillRect(x - r * z, y, (2 * r + 1) * z, z); ctx.fillRect(x, y - r * z, z, (2 * r + 1) * z);
          if (r > 1) { ctx.fillStyle = COL[C_PALE]; ctx.fillRect(x - z, y - z, 3 * z, 3 * z); }
          break;
        }
        case STREAK: {
          const len = Math.round(this.sz[i]) * z, dir = this.vx[i] > 0 ? -1 : 1;
          ctx.globalAlpha = a0 * (1 - lf) * 0.85;
          ctx.fillStyle = col; ctx.fillRect(dir > 0 ? x : x - len, y, len, z);
          ctx.fillStyle = COL[C_WHITE]; ctx.fillRect(dir > 0 ? x : x - 2 * z, y, 2 * z, z);
          break;
        }
        case SPARK: {
          ctx.globalAlpha = a0 * ((fr + i) % 3 === 0 ? 1 : 0.75);
          const ang = this.vx[i], L = this.vy[i] * (0.6 + 0.4 * Math.min(1, t / 0.05));
          const ca = Math.cos(ang), sa = Math.sin(ang);
          const seg = 4, jf = Math.floor(fr / 2);
          let px = this.x[i], py = this.y[i];
          for (let q = 1; q <= seg; q++) {
            const u = q / seg, off = q < seg ? (hash2(i * 7 + q, jf, 13) - 0.5) * L * 0.5 : 0;
            const nx = this.x[i] + ca * L * u - sa * off, ny = this.y[i] + sa * L * u + ca * off;
            const steps = Math.max(1, Math.ceil(Math.hypot(nx - px, ny - py)));
            ctx.fillStyle = q === 1 ? COL[C_WHITE] : col;
            for (let st = 0; st < steps; st++) { const w = st / steps; ctx.fillRect(SX(px + (nx - px) * w, py + (ny - py) * w), SY(px + (nx - px) * w, py + (ny - py) * w), z, z); }
            px = nx; py = ny;
          }
          break;
        }
        case GLINT: {
          ctx.globalAlpha = a0 * (1 - lf);
          const r = this.sz[i] * z;
          ctx.fillStyle = col; ctx.fillRect(x - r, y, 2 * r + z, z); ctx.fillRect(x, y - r, z, 2 * r + z);
          ctx.fillStyle = COL[C_WHITE]; ctx.fillRect(x, y, z, z);
          break;
        }
        case SAND: ctx.globalAlpha = a0 * (1 - lf); ctx.fillStyle = col; ctx.fillRect(x, y, z, z); break;
        case FROND: {
          ctx.globalAlpha = a0 * (lf > 0.7 ? (1 - lf) / 0.3 : 1);
          const n = Math.round(this.sz[i]);
          for (let pass = 0; pass < 2; pass++) for (let j = 0; j < n; j++) {
            const kk = j / n;
            const wx = this.x[i] + Math.sin(this.time * 3 + this.seed[i] + kk * 3) * 2 * kk + j * 0.6, wy = this.y[i] - j * 1.6;
            const sx = SX(wx, wy), sy = SY(wx, wy);
            if (pass === 0) { ctx.fillStyle = COL[C_INK_K]; ctx.fillRect(sx - z, sy - z, 4 * z, 4 * z); }
            else { ctx.fillStyle = COL[j % 3 === 0 ? C_KELP_L : C_KELP]; ctx.fillRect(sx, sy, 2 * z, 2 * z); }
          }
          break;
        }
        default: break;
      }
    }
    ctx.globalAlpha = a0;
    // the splash crowns, on the waterline
    const C = this.cr;
    for (let i = 0; i < 24; i++) {
      if (!C.on[i] || C.t[i] < 0) continue;
      const sh = crownSheet(C.si[i]);
      const f = Math.min(CROWN_FRAMES - 1, Math.floor((C.t[i] / C.life[i]) * CROWN_FRAMES));
      const lv = this.levelAt(C.x[i]) ?? C.y[i];
      const x = SX(C.x[i], lv), y = SY(C.x[i], lv);
      const w = sh.fw * z, h = sh.fh * z;
      if (C.flip[i]) {
        ctx.save();
        ctx.translate(x, 0); ctx.scale(-1, 1);
        ctx.drawImage(sh.c, f * sh.fw, 0, sh.fw, sh.fh, -Math.round(w / 2), y - sh.base * z, w, h);
        ctx.restore();
      } else ctx.drawImage(sh.c, f * sh.fw, 0, sh.fw, sh.fh, x - Math.round(w / 2), y - sh.base * z, w, h);
    }
    ctx.restore();
  }
}
