// The physical reel: a big glossy Frutiger Aero pixel-art reel, face-on in the corner during the
// fight, hanging from a short stretch of the equipped rod. Everything the player needs reads off the reel:
//   handle      follows the cursor's angle around the crank loop (circle the mouse to crank)
//   spool       clear acrylic spool; wound line = catch progress; spokes blur with speed;
//               glows green in the sweet speed zone, orange when over-cranking, cyan while the fish is stunned
//   knob trail  speed: aqua (slow) -> green (sweet) -> orange (too fast)
//   bail        chrome bail arm snaps shut at the hook-set; the line runs over its roller to the rod
//   rim LEDs    line tension (aqua -> green -> yellow -> red); the reel shakes and the line buzzes
//   drag star   spins and glows hot when the fish takes line (sparks fly); the ratchet pawl clicks per tooth
//   SHOCK       glossy lightning button with charge pips and a cooldown sweep (also RMB / Space)
//   weight      a pulsing weight icon when the fish is heavier than the rod's strength
// API: new Reel(F); layout(W, H); reset(); idle(dt); kick(n); update(dt, B); draw(ctx, B, k); hitShock(x, y).
//   B = the Battle (or a BoxReel): progress, tension, reelRate, snapT, grace, zone, heavy, stunned, surging,
//   shockReady, shockMax, charges, shockCd, shockCdMax.

import { TAU, clamp, clamp01, damp, lerp, bayer } from '../core/math.js';
import { rgba } from '../core/color.js';
import { makeCanvas, ctxOf } from '../core/canvas.js';
import { glowSprite, pixelLine, drawBolt, boltPoints } from '../gfx/particles.js';

// ------------------------------------------------------------------ pixel painting helpers
function paint(w, h, fn) {
  const c = makeCanvas(w, h);
  const g = ctxOf(c);
  const img = g.createImageData(w, h);
  const d = img.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = fn(x, y);
    if (!v) continue;
    const i = (y * w + x) * 4;
    d[i] = v[0]; d[i + 1] = v[1]; d[i + 2] = v[2]; d[i + 3] = v[3] ?? 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
// pick from a ramp with ordered dithering between steps
function rampAt(ramp, v, x, y) {
  v = clamp01(v) * (ramp.length - 1);
  const i = Math.floor(v), f = v - i;
  return ramp[Math.min(ramp.length - 1, i + (f > bayer(x, y) ? 1 : 0))];
}

const CHROME = ['#2c4a62', '#4f7690', '#7fa4bc', '#b4d0e2', '#e2f2fc', '#ffffff'].map(hex);
const AQUA = ['#0a5f88', '#0d8fb5', '#1fb8dc', '#4fd8f0', '#8ff0ff', '#d8fcff'].map(hex);
const GLASS = ['#0d6fb8', '#1e8fe0', '#38aef0', '#6cd0ff', '#b8ecff'].map(hex);
const LINE = ['#1f6a14', '#3fa02a', '#6cd03a', '#a6ec5a', '#e2ffb0'].map(hex);
const PLATE = ['#6f8ea8', '#a8c0d4', '#d4e4f0', '#eef6fb', '#ffffff'].map(hex);
const LIME = ['#2f7a1e', '#3fae2a', '#6cd03a', '#a6ec5a', '#e2ffb0'].map(hex);
const HOT = ['#7a1a1a', '#c8303a', '#ff5a4a', '#ff9a7a', '#ffe0d0'].map(hex);
const VOLT = ['#a86a00', '#e0a000', '#ffd23a', '#fff07a', '#fffbe0'].map(hex);
const GREY = ['#3a4a58', '#56687a', '#7a8c9c', '#a4b4c2', '#d4e0ea'].map(hex);
const LX = -0.62, LY = -0.78; // light from the top-left (2D, for rims)

// Glossy sphere (knobs, beads, buttons).
function sphere(r, ramp, o = {}) {
  const s = r * 2 + 1;
  return paint(s, s, (x, y) => {
    const dx = (x - r) / (r + 0.35), dy = (y - r) / (r + 0.35);
    const d2 = dx * dx + dy * dy;
    if (d2 > 1) return null;
    const nz = Math.sqrt(1 - d2);
    const dot = (dx * -0.5 + dy * -0.6 + nz * 0.62) / 0.94;
    let l = clamp01(0.12 + 0.88 * Math.max(0, dot));
    if (d2 > 0.82) l *= 0.62; // dark rim
    const hx = (dx + 0.38) / 0.3, hy = (dy + 0.42) / 0.2;
    if (hx * hx + hy * hy < 1) return [255, 255, 255, 255];
    if (o.lower && dy > 0.35 && d2 < 0.6) l = Math.min(1, l + 0.18); // bounce light
    return [...rampAt(ramp, l, x, y), 255];
  });
}

// ------------------------------------------------------------------ cached reel art
const ART = new Map();
function art(key, make) {
  let c = ART.get(key);
  if (!c) { c = make(); ART.set(key, c); }
  return c;
}

// Reel body: chrome rim, glossy aqua side plate, dark glass spool window, screws.
function bodySprite(R) {
  return art('body' + R, () => {
    const C = R + 8, S = C * 2 + 1;
    return paint(S, S, (x, y) => {
      const dx = x - C, dy = y - C, d = Math.hypot(dx, dy);
      if (d > R + 6.4) return null;
      const nx = d ? dx / d : 0, ny = d ? dy / d : 0;
      if (d > R + 2.5) {
        // chrome torus rim
        const u = clamp((d - (R + 2.5)) / 3.9, 0, 1) * 2 - 1; // -1 inner .. 1 outer
        const facing = -(nx * LX + ny * LY); // >0 toward the light (top-left)
        let l = 0.52 + 0.42 * facing * u * -1 + 0.3 * Math.sqrt(1 - u * u) - 0.15;
        if (d > R + 5.6) l *= 0.45;
        if (Math.abs(u + 0.25) < 0.22 && facing < -0.5) l = 1;
        return [...rampAt(CHROME, l, x, y), 255];
      }
      if (d > R - 6.5) {
        // glossy white plastic side plate (slightly domed) with an aqua accent ring
        const ang = Math.atan2(dy, dx);
        if (d < R - 5.2) return [...rampAt(AQUA, 0.62 - 0.3 * (dy / R), x, y), 255];
        let l = 0.62 - 0.36 * (dy / R) - 0.12 * (dx / R);
        // glossy lip highlight crescent on the upper-left
        if (d > R - 3.5 && d < R + 0.5 && Math.abs(ang + 2.25) < 0.7) l = 1;
        // leaf-green accent arc along the lower right
        if (d > R - 2.2 && Math.abs(ang - 0.75) < 0.55) return [...rampAt(LIME, 0.75 - 0.3 * (dy / R), x, y), 255];
        return [...rampAt(PLATE, l, x, y), 255];
      }
      // aqua glass spool window (sky-lit from above, deeper below)
      let l = 0.85 - 0.6 * clamp01((dy / R + 1) / 2);
      if (d > R - 8.5 && dy < 0) l *= 0.6; // inner shadow along the top
      return [...rampAt(GLASS, l, x, y), 255];
    });
  });
}

// Screws on the side plate (drawn once into a separate sprite so they sit above the spool glass).
function screwsSprite(R) {
  return art('screws' + R, () => {
    const C = R + 8, S = C * 2 + 1;
    const c = makeCanvas(S, S), g = ctxOf(c);
    const sc = sphere(2, CHROME);
    for (const a of [-0.8, 0.8, 2.35, 3.95]) {
      const x = Math.round(C + Math.cos(a) * (R - 2.5)), y = Math.round(C + Math.sin(a) * (R - 2.5));
      g.drawImage(sc, x - 2, y - 2);
      g.fillStyle = '#2c4a62'; g.fillRect(x - 1, y, 3, 1);
    }
    return c;
  });
}

// Wound line on the spool: annulus from the arbor to rf, wraps striped, lit top-left.
function lineSprite(rf, ra) {
  return art('line' + rf + '|' + ra, () => {
    const S = rf * 2 + 1;
    return paint(S, S, (x, y) => {
      const dx = x - rf, dy = y - rf, d = Math.hypot(dx, dy);
      if (d > rf + 0.4 || d < ra - 0.4) return null;
      let l = 0.55 - 0.35 * ((dx + dy * 1.2) / (rf * 2));
      const band = Math.floor(d) % 3;
      if (band === 0) l -= 0.22;
      if (d > rf - 0.8) l -= 0.3; // outer edge
      if (d < ra + 0.8) l -= 0.25;
      return [...rampAt(LINE, l, x, y), 255];
    });
  });
}

// Clear front glass: specular crescent and rim glare (mostly transparent).
function glassSprite(R) {
  return art('glass' + R, () => {
    const C = R + 8, S = C * 2 + 1, Rw = R - 6.5;
    return paint(S, S, (x, y) => {
      const dx = x - C, dy = y - C, d = Math.hypot(dx, dy);
      if (d > Rw) return null;
      const ang = Math.atan2(dy, dx);
      // big soft crescent top-left
      if (d > Rw * 0.62 && d < Rw - 1.5 && Math.abs(ang + 2.2) < 0.75) {
        const k = 1 - Math.abs(ang + 2.2) / 0.75;
        if (bayer(x, y) < k * 0.9) return [255, 255, 255, Math.round(70 + 90 * k)];
      }
      // diagonal glare streaks
      const u = (dx + dy) / Math.SQRT2;
      if (Math.abs(u + Rw * 0.25) < 1.2 || Math.abs(u + Rw * 0.05) < 0.6) {
        if ((dy - dx) < Rw * 0.4) return [255, 255, 255, 40];
      }
      // lower rim reflection
      if (d > Rw - 1.6 && dy > 0 && Math.abs(ang - 1.1) < 0.8) return [190, 250, 255, 110];
      return null;
    });
  });
}

// Six-point drag star (12 rotation frames over 60 degrees), normal and hot.
function starSprite(frame, hot) {
  return art('star' + frame + hot, () => {
    const r = 9, S = r * 2 + 1, rot = (frame / 12) * (Math.PI / 3);
    const ramp = hot ? HOT : LIME;
    return paint(S, S, (x, y) => {
      const dx = x - r, dy = y - r, d = Math.hypot(dx, dy);
      const a = Math.atan2(dy, dx) - rot;
      const lobe = Math.cos(a * 6) * 0.5 + 0.5;
      const edge = 5.2 + lobe * 3.6;
      if (d > edge) return null;
      let l = 0.58 - 0.35 * ((dx * 0.6 + dy * 0.8) / r);
      if (d > edge - 1) l *= 0.55;
      if (d < 4.5 && d > 3.5) l *= 0.7;
      if (Math.abs(dx + dy + 4) < 1 && d < edge - 1.5) l = 1;
      return [...rampAt(ramp, l, x, y), 255];
    });
  });
}

const knobSprite = () => art('knob', () => sphere(6, AQUA, { lower: true }));
const weightSprite = () => art('cweight', () => sphere(4, CHROME));
const hubSprite = () => art('hub', () => sphere(4, CHROME));
function beadSprite(col) { return art('bead' + col, () => sphere(2, col === 'off' ? GREY : beadRamp(col))); }
function beadRamp(col) {
  const [r, g, b] = hex(col);
  const mixc = (k) => [Math.round(r + (255 - r) * k), Math.round(g + (255 - g) * k), Math.round(b + (255 - b) * k)];
  return [[r * 0.45, g * 0.45, b * 0.45].map(Math.round), [r * 0.75, g * 0.75, b * 0.75].map(Math.round), [r, g, b], mixc(0.45), mixc(0.85)];
}
function buttonSprite(r, state) {
  return art('btn' + r + state, () => sphere(r, state === 'off' ? GREY : state === 'hot' ? VOLT.map((c) => c.map((v) => Math.min(255, v + 20))) : VOLT, { lower: true }));
}

// Lightning bolt glyph for the shock button.
const BOLT_ROWS = [
  '....###', '...###.', '..###..', '.######', '#####..', '...##..', '..##...', '.##....', '##.....',
];
function boltGlyph(fill) {
  return art('glyph' + fill, () => {
    const w = 7, h = BOLT_ROWS.length;
    const c = makeCanvas(w + 2, h + 2), g = ctxOf(c);
    g.fillStyle = '#5a3a00';
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (BOLT_ROWS[y][x] === '#') g.fillRect(x, y, 3, 3);
    g.fillStyle = fill;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (BOLT_ROWS[y][x] === '#') g.fillRect(x + 1, y + 1, 1, 1);
    return c;
  });
}

// Tiny mouse glyph with the right button lit (shock binding hint).
function mouseGlyph() {
  return art('mouseR', () => {
    const rows = ['.####.', '#.##%#', '#.##%#', '######', '#....#', '#....#', '#....#', '.####.'];
    const c = makeCanvas(6, rows.length), g = ctxOf(c);
    for (let y = 0; y < rows.length; y++) for (let x = 0; x < 6; x++) {
      const ch = rows[y][x];
      if (ch === '.') continue;
      g.fillStyle = ch === '%' ? '#ffd23a' : y === 0 || x === 0 || x === 5 || y === rows.length - 1 || y === 3 ? '#0c3a52' : '#eafaff';
      g.fillRect(x, y, 1, 1);
    }
    g.fillStyle = '#eafaff';
    for (let y = 4; y < 7; y++) g.fillRect(1, y, 4, 1);
    return c;
  });
}

// Weight icon (heavy fish).
function weightIcon(hot) {
  return art('kg' + hot, () => {
    const rows = ['..##..', '.#..#.', '######', '#%%%%#', '#%%%%#', '#%%%%#', '######'];
    const c = makeCanvas(6, rows.length), g = ctxOf(c);
    for (let y = 0; y < rows.length; y++) for (let x = 0; x < 6; x++) {
      const ch = rows[y][x];
      if (ch === '.') continue;
      g.fillStyle = ch === '%' ? (hot ? '#ff5a4a' : '#7a8c9c') : '#0c3a52';
      g.fillRect(x, y, 1, 1);
    }
    return c;
  });
}

export const LED_COLORS = ['#2fd3e8', '#4fe0c8', '#8be04a', '#c8f56a', '#ffd23a', '#ff9d2e', '#ff4f5e'];
function ledColor(k) {
  if (k < 0.3) return LED_COLORS[0];
  if (k < 0.45) return LED_COLORS[1];
  if (k < 0.6) return LED_COLORS[2];
  if (k < 0.7) return LED_COLORS[3];
  if (k < 0.8) return LED_COLORS[4];
  if (k < 0.9) return LED_COLORS[5];
  return LED_COLORS[6];
}

// ------------------------------------------------------------------ the reel
const GEAR = 4.6; // spool turns per handle turn
const TEETH = 14; // ratchet clicks per spool turn
const N_LED = 19;

// Chrome bail wire: pixel arc between the two pivots, squashed as it flips (k: 1 closed, 0 open/back).
function drawBailWire(ctx, cx, cy, rr, a0, a1, flip, t) {
  const n = Math.ceil(rr * (a1 - a0) * 1.2);
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + (a1 - a0) * (i / n);
    const x = cx + Math.cos(a) * rr;
    const y0 = cy + Math.sin(a) * rr;
    // the wire rotates about the horizontal pivot axis (y = cy): squash toward it, flip under when open
    const y = cy + (y0 - cy) * flip;
    pts.push([Math.round(x), Math.round(y)]);
  }
  ctx.fillStyle = '#0c3a52';
  for (const [x, y] of pts) ctx.fillRect(x - 1, y - 1, 4, 4);
  for (let i = 0; i < pts.length; i++) {
    const [x, y] = pts[i];
    const u = i / (pts.length - 1);
    const lit = flip > 0 ? (u < 0.45 ? '#ffffff' : u < 0.7 ? '#e2f2fc' : '#b4d0e2') : '#7fa4bc';
    ctx.fillStyle = lit; ctx.fillRect(x, y, 2, 1);
    ctx.fillStyle = flip > 0 ? '#9ab8cc' : '#4f7690'; ctx.fillRect(x, y + 1, 2, 1);
  }
  // a glint sliding along the wire
  const gi = Math.floor(((t * 0.7) % 1) * pts.length);
  if (flip > 0.5 && pts[gi]) { ctx.fillStyle = '#ffffff'; ctx.fillRect(pts[gi][0] - 1, pts[gi][1] - 1, 3, 1); ctx.fillRect(pts[gi][0], pts[gi][1] - 2, 1, 3); }
  return pts;
}

export class Reel {
  constructor(F) {
    this.F = F;
    this.handleA = -Math.PI / 2;
    this.spoolA = 0; this.spoolV = 0;
    this.tooth = 0; this.pawl = 0;
    this.clickT = 0;
    this.dragA = 0; this.dragHot = 0;
    this.shake = 0;
    this.btnPress = 0; this.btnHover = false;
    this.fire = 0; // shock button flash
    this.lay = null;
    this.speedK = 0;
    this.bail = 0; this.bailT = 0; // 0 open, 1 closed
    this.strain = 0; // red flash when the fish wins a surge / line runs out
    this.denied = 0; // shock not ready
    this.snapped = 0;
    this.kickK = 0; // green pulse on a won counter
    this.progShown = 0;
    this.layW = 0; this.layH = 0;
  }

  reset() {
    this.bail = 0; this.bailT = 0;
    this.strain = 0; this.denied = 0; this.snapped = 0; this.kickK = 0;
    this.fire = 0; this.btnPress = 0;
    this.progShown = 0;
  }

  kick(n = 1) { this.kickK = Math.max(this.kickK, n); }

  // Outside the fight the reel only relaxes.
  idle(dt) {
    this.strain = Math.max(0, this.strain - dt * 2);
    this.speedK = damp(this.speedK, 0, 6, dt);
  }

  layout(W, H) {
    if (this.lay && this.layW === W && this.layH === H) return this.lay;
    const R = Math.round(clamp(H * 0.12, 34, 72));
    const cx = Math.round(W - R - 44), cy = Math.round(H - R - 34);
    const br = Math.max(10, Math.round(R * 0.3));
    const bx = Math.round(cx - R - br - 14), by = Math.round(cy + R * 0.42);
    this.lay = { R, cx, cy, br, bx, by, Rk: R - 8 };
    this.layW = W; this.layH = H;
    return this.lay;
  }

  hitShock(x, y) {
    const L = this.lay;
    if (!L) return false;
    return Math.hypot(x - L.bx, y - L.by) <= L.br + 4;
  }

  update(dt, B) {
    const F = this.F, cr = F.crank, inp = F.input;
    this.layout(F.W, F.H);
    // the bail snaps shut at the hook-set
    this.bailT += dt;
    const closed = this.bailT > 0.12 && !this.snapped;
    if (closed && this.bail < 1) {
      const was = this.bail;
      this.bail = Math.min(1, this.bail + dt * 9);
      if (was < 1 && this.bail >= 1) { F.sfx('click', { vol: 0.5, pitch: 1.4 }); F.fx.glints(this.lay.cx, this.lay.cy - this.lay.R - 9, 2, { w: this.lay.R * 0.6, h: 2 }); }
    }
    // the handle follows the cursor's angle around the crank loop
    const dx = inp.x - cr.cx, dy = inp.y - cr.cy;
    const prevA = this.handleA;
    if (Math.hypot(dx, dy) > 5 && cr.active) {
      const target = Math.atan2(dy, dx);
      let d = target - this.handleA;
      d = ((d + Math.PI) % TAU + TAU) % TAU - Math.PI;
      this.handleA += d * (1 - Math.exp(-28 * dt));
    }
    let dA = this.handleA - prevA;
    dA = ((dA + Math.PI) % TAU + TAU) % TAU - Math.PI;
    // spool: wound by the handle, pulled back out when the fish takes line (drag slips)
    const out = B && B.reelRate < -0.004 ? -B.reelRate : 0;
    const slip = out * 60;
    this.spoolA += Math.abs(dA) * GEAR - slip * dt;
    this.spoolV = damp(this.spoolV, (Math.abs(dA) * GEAR - slip * dt) / Math.max(dt, 1e-3), 10, dt);
    this.dragHot = damp(this.dragHot, out > 0 ? 1 : 0, out > 0 ? 12 : 3, dt);
    if (out > 0) this.dragA -= slip * dt * 0.8;
    // ratchet clicks
    const tooth = Math.floor(this.spoolA / (TAU / TEETH));
    this.clickT -= dt;
    if (tooth !== this.tooth) {
      this.pawl = 1;
      if (this.clickT <= 0) {
        this.clickT = 0.045;
        const sp = Math.min(1, Math.abs(this.spoolV) / 40);
        F.sfx('reel_tick', { vol: out > 0 ? 0.35 : 0.22 + sp * 0.2, pitch: out > 0 ? 0.65 + Math.random() * 0.1 : 0.9 + sp * 0.5 });
      }
      this.tooth = tooth;
    }
    this.pawl = Math.max(0, this.pawl - dt * 14);
    // drag sparks while the fish strips line
    if (out > 0.01 && Math.random() < dt * 30) {
      const L = this.lay;
      F.fx.sparks(L.cx + rnd(-4, 4), L.cy + rnd(-4, 4), 1, { speed: [40, 110], colors: ['#ffffff', '#ffd23a', '#ff9a3a'], g: 260 });
    }
    this.speedK = damp(this.speedK, cr.power, 10, dt);
    // shake with tension
    const T = B ? B.tension : 0;
    this.shake = T > 0.86 ? (T - 0.86) * 18 + (B.snapT > 0 ? 2 : 0) : 0;
    this.fire = Math.max(0, this.fire - dt * 3);
    this.btnPress = Math.max(0, this.btnPress - dt * 6);
    this.strain = Math.max(0, this.strain - dt * 2.2);
    this.denied = Math.max(0, this.denied - dt * 4);
    this.kickK = Math.max(0, this.kickK - dt * 2.5);
    this.btnHover = this.hitShock(inp.x, inp.y);
    if (B) this.progShown = damp(this.progShown, clamp01(B.progress), 8, dt);
    // sweet-zone sparkle off the spool
    const z = B?.zone;
    if (z && cr.power >= z.lo && cr.power <= z.hi && Math.random() < dt * 10) {
      const L = this.lay, a = Math.random() * TAU, rf = this.spoolR();
      F.fx.glint(L.cx + Math.cos(a) * rf, L.cy + Math.sin(a) * rf, { color: '#e2ffb0', len: 3 });
    }
  }

  spoolR() {
    const L = this.lay;
    const ra = 9, rmax = L.R - 9;
    return Math.round(ra + 3 + this.progShown * (rmax - ra - 3));
  }

  // k: slide-in 0..1
  draw(ctx, B, k = 1) {
    const F = this.F, t = F.t;
    const L = this.layout(F.W, F.H);
    const { R } = L;
    const slide = Math.round((1 - k) * (R * 2 + 60));
    const sx = this.shake ? Math.round((Math.random() - 0.5) * this.shake) : 0;
    const sy = this.shake ? Math.round((Math.random() - 0.5) * this.shake) : 0;
    const cx = L.cx + slide + sx, cy = L.cy + slide + sy;
    const T = B ? clamp(B.tension, 0, 1.2) : 0.2;
    const zone = B?.zone;
    const p = this.speedK;
    const state = !zone || p < 0.12 ? 'idle' : p > zone.hi ? 'over' : p >= zone.lo ? 'sweet' : 'slow';
    const stunned = !!B?.stunned;
    ctx.save();
    // ---- rod above the reel (bends with tension)
    this.drawRod(ctx, cx, cy, R, T, t);
    // ---- outer glow by state
    const glowCol = this.strain > 0.3 || T > 0.9 ? '#ff4f5e' : stunned ? '#7ff4ff' : this.kickK > 0.2 ? '#c8f56a' : state === 'over' ? '#ff9d2e' : state === 'sweet' ? '#8be04a' : '#59c3ff';
    const gA = T > 0.9 ? 0.55 + 0.35 * Math.sin(t * 22) : Math.max(this.strain * 0.7, this.kickK * 0.7, stunned ? 0.5 : 0, state === 'sweet' ? 0.45 : state === 'over' ? 0.5 : 0.22);
    const gr = R + 26;
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = gA;
    ctx.drawImage(glowSprite(gr, glowCol), cx - gr, cy - gr);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    // ---- foot (reel seat) connecting to the rod
    this.drawFoot(ctx, cx, cy, R);
    // ---- bail, back half (open: flipped behind the reel)
    if (this.bail < 0.5) this.drawBail(ctx, cx, cy, R, t, false);
    // ---- body
    const body = bodySprite(R), C = R + 8;
    ctx.drawImage(body, cx - C, cy - C);
    // ---- spool: wound line (progress) + sweet glow + rotating glints + spokes
    const ra = 9;
    const rf = this.spoolR();
    if (state === 'sweet' || state === 'over' || stunned) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = stunned ? 0.45 + 0.3 * Math.sin(t * 40) : state === 'sweet' ? 0.5 + 0.15 * Math.sin(t * 10) : 0.55;
      const sg = rf + 7;
      ctx.drawImage(glowSprite(sg, stunned ? '#7ff4ff' : state === 'sweet' ? '#8be04a' : '#ff9d2e'), cx - sg, cy - sg);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.drawImage(lineSprite(rf, ra), cx - rf, cy - rf);
    // the line getting stripped glows red at the edge
    if (this.dragHot > 0.2 || this.strain > 0.2) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = Math.max(this.dragHot, this.strain) * (0.5 + 0.3 * Math.sin(t * 30));
      ctx.fillStyle = '#ff6a5a';
      for (let a = 0; a < TAU; a += 0.06) ctx.fillRect(Math.round(cx + Math.cos(a) * rf), Math.round(cy + Math.sin(a) * rf), 1, 1);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
    // glints travel round the wound line as it spins
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 3; i++) {
      const a = this.spoolA + (i * TAU) / 3;
      for (let j = 0; j < 6; j++) {
        const aa = a - j * 0.07;
        const rr = rf - 2 - (i % 2);
        ctx.fillStyle = rgba('#ffffff', 0.75 - j * 0.12);
        ctx.fillRect(Math.round(cx + Math.cos(aa) * rr), Math.round(cy + Math.sin(aa) * rr), 1, 1);
      }
    }
    ctx.globalCompositeOperation = 'source-over';
    // spokes (with motion ghosts when spinning fast)
    const spin = Math.min(1, Math.abs(this.spoolV) / 30);
    const ghosts = spin > 0.25 ? 3 : 0;
    for (let gi = ghosts; gi >= 0; gi--) {
      const back = gi * 0.16 * Math.sign(this.spoolV || 1);
      const alpha = gi ? 0.25 * spin * (1 - gi / 4) : 1;
      for (let s = 0; s < 3; s++) {
        const a = this.spoolA - back + (s * TAU) / 3;
        const x0 = cx + Math.cos(a) * 6, y0 = cy + Math.sin(a) * 6;
        const x1 = cx + Math.cos(a) * (R - 8), y1 = cy + Math.sin(a) * (R - 8);
        if (gi === 0) { ctx.fillStyle = '#2c4a62'; pixelLine(ctx, x0, y0 + 1, x1, y1 + 1, 2); }
        ctx.fillStyle = rgba(gi ? '#bfeaff' : '#b4d0e2', alpha);
        pixelLine(ctx, x0, y0, x1, y1, 2);
        if (gi === 0) { ctx.fillStyle = rgba('#ffffff', 0.9); pixelLine(ctx, x0, y0, x1, y1, 1); }
      }
    }
    // clear glass over the spool, screws
    ctx.drawImage(glassSprite(R), cx - C, cy - C);
    ctx.drawImage(screwsSprite(R), cx - C, cy - C);
    // electric arcs crackle inside the glass while the fish is stunned
    if (stunned && Math.random() < 0.5) {
      const a0 = Math.random() * TAU, a1 = a0 + rnd(0.8, 2);
      drawBolt(ctx, boltPoints(cx + Math.cos(a0) * rf, cy + Math.sin(a0) * rf, cx + Math.cos(a1) * (R - 8), cy + Math.sin(a1) * (R - 8), 3, (Math.random() * 1e9) >>> 0), 0.8);
    }
    // ---- ratchet pawl (right side): twitches per click
    const px = cx + R + 3, py = cy + Math.round(R * 0.25);
    ctx.fillStyle = '#2c4a62'; ctx.fillRect(px - 1, py - 4, 5, 8);
    ctx.fillStyle = '#b4d0e2'; ctx.fillRect(px, py - 3, 3, 6);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(px, py - 3, 1, 4);
    const pw = Math.round(this.pawl * 2);
    ctx.fillStyle = '#e2f2fc'; ctx.fillRect(px - 3 - pw, py - 1, 3, 2);
    // ---- rim LEDs: tension
    this.drawLeds(ctx, cx, cy, R, T, t, B);
    // ---- bail (front, closed) + line from the spool through the roller up to the rod
    if (this.bail >= 0.5) this.drawBail(ctx, cx, cy, R, t, true);
    this.drawLine(ctx, cx, cy, R, rf, T, t, B);
    // ---- hub + drag star
    const hot = this.dragHot > 0.3 || T > 0.92;
    const fr = ((Math.floor(((this.dragA % (Math.PI / 3)) + Math.PI / 3) / (Math.PI / 3) * 12)) % 12 + 12) % 12;
    ctx.drawImage(starSprite(fr, hot), cx - 9, cy - 9);
    if (hot) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.4 + 0.3 * Math.sin(t * 30);
      ctx.drawImage(glowSprite(12, '#ff5a4a'), cx - 12, cy - 12);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
    // ---- handle: knob trail, arm, counterweight, knob
    this.drawHandle(ctx, cx, cy, L.Rk, state);
    // ---- heavy-fish weight icon
    if (B?.heavy > 0) {
      const pulse = Math.floor(t * 4) % 2 === 0;
      const wi = weightIcon(pulse);
      const wx = cx + R + 4, wy = cy - R + 2;
      ctx.drawImage(wi, wx, wy);
      if (pulse) { ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.5; ctx.drawImage(glowSprite(8, '#ff4f5e'), wx - 5, wy - 4); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; }
    }
    ctx.restore();
    // ---- shock button + pips
    if (B && B.shockMax > 0) this.drawShock(ctx, B, slide, t);
  }

  drawBail(ctx, cx, cy, R, t, front) {
    const rr = R + 12;
    const f = front ? ease(clamp01((this.bail - 0.5) * 2)) : -ease(clamp01((0.5 - this.bail) * 2)) * 0.55;
    const a0 = Math.PI * 1.08, a1 = Math.PI * 1.92;
    const pts = drawBailWire(ctx, cx, cy - 2, rr, a0, a1, f, t);
    // pivots
    for (const a of [a0, a1]) {
      const x = Math.round(cx + Math.cos(a) * rr), y = Math.round(cy - 2);
      // bail arm from the rotor to the pivot
      ctx.fillStyle = '#0c3a52'; ctx.fillRect(Math.min(x, cx + Math.sign(x - cx) * (R + 4)) - 1, y - 2, Math.abs(x - (cx + Math.sign(x - cx) * (R + 4))) + 2, 5);
      ctx.fillStyle = '#e2f2fc'; ctx.fillRect(Math.min(x, cx + Math.sign(x - cx) * (R + 4)), y - 1, Math.abs(x - (cx + Math.sign(x - cx) * (R + 4))), 2);
      ctx.drawImage(hubSprite(), x - 4, y - 4);
    }
    // the line roller on the right end of the bail, spinning with the spool
    const end = pts[pts.length - 1];
    if (end && front) {
      const rx = end[0] - 3, ry = end[1];
      ctx.fillStyle = '#0c3a52'; ctx.fillRect(rx - 3, ry - 3, 7, 7);
      ctx.fillStyle = Math.floor(this.spoolA * 2) % 2 ? '#e2f2fc' : '#b4d0e2'; ctx.fillRect(rx - 2, ry - 2, 5, 5);
      ctx.fillStyle = '#ffffff'; ctx.fillRect(rx - 2, ry - 2, 2, 1);
      this.roller = [rx, ry - 2];
    } else this.roller = null;
  }

  // The line: spool -> bail roller -> rod guide -> tip, buzzing with tension, crackling when shocking.
  drawLine(ctx, cx, cy, R, rf, T, t, B) {
    const F = this.F;
    const g = this.rodGuide || [cx - R, cy - R - 30], tip = this.rodTip || [cx - R - 60, cy - R - 40];
    const lw = Math.round(Math.sin(this.spoolA * 0.09) * rf * 0.5);
    const sp = [cx + lw, cy - rf];
    const roll = this.roller || [cx + R * 0.6, cy - R - 8];
    const stunned = !!B?.stunned;
    const col = this.snapped ? '#ff6a5a' : stunned ? (Math.floor(t * 20) % 2 ? '#bff8ff' : '#ffffff') : T > 0.9 ? '#ff6a5a' : T > 0.75 ? '#ffd23a' : '#f4fdff';
    const vib = T > 0.55 ? (T - 0.55) * 6 : B?.surging ? 0.8 : 0;
    const segs = [[sp[0], sp[1], roll[0], roll[1]], [roll[0], roll[1], g[0], g[1]], [g[0], g[1], tip[0], tip[1]]];
    const pts = [];
    ctx.fillStyle = rgba(col, 0.95);
    for (const [x0, y0, x1, y1] of segs) {
      const n = Math.max(2, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
      const Ls = Math.hypot(x1 - x0, y1 - y0) || 1, nx = -(y1 - y0) / Ls, ny = (x1 - x0) / Ls;
      for (let i = 0; i <= n; i++) {
        const u = i / n;
        const w = Math.sin(u * Math.PI) * vib * Math.sin(t * 70 + u * 9);
        const x = Math.round(x0 + (x1 - x0) * u + nx * w), y = Math.round(y0 + (y1 - y0) * u + ny * w);
        ctx.fillRect(x, y, 1, 1);
        if (i % 3 === 0) pts.push([x, y]);
      }
    }
    // beyond the tip the line runs out toward the fish (fades)
    const ex = tip[0] - 30, ey = tip[1] - 34;
    for (let i = 0; i <= 34; i++) {
      const u = i / 34;
      ctx.fillStyle = rgba(col, 0.9 * (1 - u));
      ctx.fillRect(Math.round(lerp(tip[0], ex, u)), Math.round(lerp(tip[1], ey, u) + Math.sin(u * Math.PI) * (1 - clamp01(T)) * 4), 1, 1);
    }
    // the zap leaving the reel: a bolt racing up the line
    const z = F.zapLine;
    if (z && pts.length > 2) {
      const k = clamp01(z.t / (z.dur * 0.6));
      const head = Math.floor(k * (pts.length - 1));
      const seg = pts.slice(Math.max(0, head - 6), head + 1);
      if (seg.length > 1) drawBolt(ctx, seg.flatMap((p, i) => (i ? boltPoints(seg[i - 1][0], seg[i - 1][1], p[0], p[1], 2, (t * 991 + i) >>> 0) : [p])), 1);
      if (k < 1) {
        const hp = pts[head];
        ctx.globalCompositeOperation = 'lighter';
        ctx.drawImage(glowSprite(6, '#fff07a'), hp[0] - 6, hp[1] - 6);
        ctx.globalCompositeOperation = 'source-over';
      }
    }
    this.linePts = pts;
  }

  drawRod(ctx, cx, cy, R, T, t) {
    const W = this.F.W;
    const bx = W + 12, by = cy - R - 30;
    const tipx = cx - R - 76, tipy0 = cy - R - 64;
    const bend = clamp(T, 0, 1.1) * 18 + Math.sin(t * 3) * 1.5 + this.strain * 6;
    const mx = (bx + tipx) / 2, my = (by + tipy0) / 2 - 6;
    const tipy = tipy0 + bend;
    const n = Math.ceil(bx - tipx);
    const pts = [];
    for (let i = 0; i <= n; i += 2) {
      const u = i / n;
      const x = (1 - u) * (1 - u) * bx + 2 * (1 - u) * u * mx + u * u * tipx;
      const y = (1 - u) * (1 - u) * by + 2 * (1 - u) * u * (my + bend * 0.3) + u * u * tipy;
      pts.push([x, y, u]);
    }
    const look = this.F.rodLook || null;
    const shaft = look?.shaft || '#59c3ff', grip = look?.grip || '#d8eef8';
    const dark = mixHex(shaft, '#0c3a52', 0.45), light = mixHex(shaft, '#ffffff', 0.7);
    // blank: glossy, tapering
    for (const [x, y, u] of pts) {
      const w = Math.max(2, Math.round(6 - u * 4));
      ctx.fillStyle = '#0c3a52'; ctx.fillRect(Math.round(x) - 1, Math.round(y) - 1, 3, w + 2);
    }
    for (const [x, y, u] of pts) {
      const w = Math.max(2, Math.round(6 - u * 4));
      ctx.fillStyle = shaft; ctx.fillRect(Math.round(x), Math.round(y), 2, w);
      ctx.fillStyle = light; ctx.fillRect(Math.round(x), Math.round(y), 2, 1);
      ctx.fillStyle = dark; ctx.fillRect(Math.round(x), Math.round(y) + w - 1, 2, 1);
    }
    // grip on the right
    for (const [x, y, u] of pts) {
      if (u > 0.2) continue;
      ctx.fillStyle = '#0c3a52'; ctx.fillRect(Math.round(x), Math.round(y) - 2, 2, 10);
      ctx.fillStyle = (Math.round(x) >> 1) % 3 ? grip : mixHex(grip, '#0c3a52', 0.15); ctx.fillRect(Math.round(x), Math.round(y) - 1, 2, 8);
      ctx.fillStyle = mixHex(grip, '#ffffff', 0.6); ctx.fillRect(Math.round(x), Math.round(y) - 1, 2, 1);
    }
    // rod glow (fancy rods)
    if (look?.glow) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.12 + 0.06 * Math.sin(t * 3);
      for (let i = 0; i < pts.length; i += 6) ctx.drawImage(glowSprite(5, look.glow), Math.round(pts[i][0]) - 5, Math.round(pts[i][1]) - 3);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
    // guide rings and the tip ring
    const g1 = pts[Math.floor(pts.length * 0.62)], g2 = pts[Math.floor(pts.length * 0.84)], gt = pts[pts.length - 1];
    for (const g of [g1, g2, gt]) {
      if (!g) continue;
      ctx.fillStyle = '#0c3a52'; ctx.fillRect(Math.round(g[0]) - 2, Math.round(g[1]) + 3, 5, 5);
      ctx.fillStyle = '#e2f2fc'; ctx.fillRect(Math.round(g[0]) - 1, Math.round(g[1]) + 4, 3, 3);
      ctx.fillStyle = '#0a3450'; ctx.fillRect(Math.round(g[0]), Math.round(g[1]) + 5, 1, 1);
    }
    this.rodGuide = g1 ? [Math.round(g1[0]), Math.round(g1[1]) + 5] : [cx - R, cy - R - 30];
    this.rodTip = gt ? [Math.round(gt[0]), Math.round(gt[1]) + 5] : [cx - R - 60, cy - R - 40];
    this.footY = by + 4;
  }

  drawFoot(ctx, cx, cy, R) {
    const top = Math.round(this.footY ?? cy - R - 20), bot = cy - R - 2;
    const fx = cx + Math.round(R * 0.15);
    ctx.fillStyle = '#0c3a52'; ctx.fillRect(fx - 6, top - 1, 13, bot - top + 2);
    for (let y = top; y < bot; y++) {
      ctx.fillStyle = '#7fa4bc'; ctx.fillRect(fx - 5, y, 11, 1);
      ctx.fillStyle = '#e2f2fc'; ctx.fillRect(fx - 4, y, 3, 1);
      ctx.fillStyle = '#4f7690'; ctx.fillRect(fx + 4, y, 2, 1);
    }
    ctx.fillStyle = '#ffffff'; ctx.fillRect(fx - 4, top, 1, bot - top);
  }

  drawLeds(ctx, cx, cy, R, T, t, B) {
    // tension LEDs around the lower rim (the bail owns the top)
    const a0 = Math.PI * 1.02, a1 = Math.PI * -0.02;
    const rr = R + 11;
    const lit = clamp01(T) * N_LED;
    const danger = T > 0.9;
    for (let i = 0; i < N_LED; i++) {
      const k = i / (N_LED - 1);
      const a = a0 + (a1 - a0) * k;
      const x = Math.round(cx + Math.cos(a) * rr), y = Math.round(cy + Math.sin(a) * rr);
      const on = i < lit;
      const col = danger && on ? (Math.floor(t * 12) % 2 ? '#ff4f5e' : '#ffd0d0') : ledColor(k);
      ctx.drawImage(beadSprite(on ? col : 'off'), x - 2, y - 2);
      if (on && (i >= lit - 1.5 || danger)) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.55;
        ctx.drawImage(glowSprite(5, col), x - 5, y - 5);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
      }
    }
    // snap timer: a red flare grows at the end of the LED arc as the line is about to go
    if (B?.snapT > 0) {
      const k = clamp01(B.snapT / (B.grace || 1));
      const a = a1 - 0.16;
      const r = Math.round(6 + k * 10);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = k;
      ctx.drawImage(glowSprite(r, '#ff4f5e'), Math.round(cx + Math.cos(a) * rr) - r, Math.round(cy + Math.sin(a) * rr) - r);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
  }

  drawHandle(ctx, cx, cy, Rk, state) {
    const a = this.handleA;
    // trail behind the knob: speed colour
    const tcol = state === 'sweet' ? '#8be04a' : state === 'over' ? '#ff9d2e' : '#59c3ff';
    const p = this.speedK;
    if (p > 0.08) {
      const span = clamp(p * 2.4, 0.2, 2.8) * (this.F.crank.dir || 1);
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 1; i < 18; i++) {
        const aa = a - (i / 18) * span;
        ctx.fillStyle = rgba(tcol, (1 - i / 18) * 0.85);
        ctx.fillRect(Math.round(cx + Math.cos(aa) * Rk) - 2, Math.round(cy + Math.sin(aa) * Rk) - 2, 5, 5);
      }
      ctx.globalCompositeOperation = 'source-over';
    }
    const kx = cx + Math.cos(a) * Rk, ky = cy + Math.sin(a) * Rk;
    const wx = cx - Math.cos(a) * Rk * 0.38, wy = cy - Math.sin(a) * Rk * 0.38;
    // arm
    ctx.fillStyle = '#0c3a52'; pixelLine(ctx, wx - 1, wy - 1, kx - 1, ky - 1, 4);
    ctx.fillStyle = '#7fa4bc'; pixelLine(ctx, wx, wy, kx, ky, 2);
    ctx.fillStyle = '#ffffff'; pixelLine(ctx, wx, wy - 0.6, kx, ky - 0.6, 1);
    ctx.drawImage(weightSprite(), Math.round(wx) - 4, Math.round(wy) - 4);
    ctx.drawImage(hubSprite(), cx - 4, cy - 4);
    ctx.drawImage(knobSprite(), Math.round(kx) - 6, Math.round(ky) - 6);
  }

  drawShock(ctx, B, slide, t) {
    const L = this.lay;
    const den = this.denied > 0 ? Math.round(Math.sin(t * 60) * 2 * this.denied) : 0;
    const bx = L.bx + slide + den, by = L.by + slide, r = L.br;
    const ready = B.shockReady;
    const cdK = B.shockCdMax ? clamp01(B.shockCd / B.shockCdMax) : 0;
    const press = this.btnPress > 0 ? 1 : 0;
    // a little chrome arm linking the button to the reel body
    ctx.fillStyle = '#0c3a52'; ctx.fillRect(bx + r - 1, by - 3, L.cx - L.R - (bx + r) + 4, 6);
    ctx.fillStyle = '#b4d0e2'; ctx.fillRect(bx + r, by - 2, L.cx - L.R - (bx + r) + 2, 4);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(bx + r, by - 2, L.cx - L.R - (bx + r) + 2, 1);
    // glow when ready
    if (ready) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = (0.35 + 0.25 * Math.sin(t * 6)) + this.fire * 0.6 + (this.btnHover ? 0.2 : 0);
      ctx.drawImage(glowSprite(r + 14, '#ffe27a'), bx - r - 14, by - r - 14);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
    // bezel
    ctx.fillStyle = '#0c3a52';
    for (let y = -r - 2; y <= r + 2; y++) { const w = Math.round(Math.sqrt(Math.max(0, (r + 2.4) ** 2 - y * y))); ctx.fillRect(bx - w, by + y + 1, w * 2 + 1, 1); }
    const spr = buttonSprite(r, ready ? (this.btnHover || this.fire > 0 ? 'hot' : 'on') : 'off');
    ctx.drawImage(spr, bx - r, by - r + press);
    // cooldown sweep
    if (!ready && cdK > 0) {
      ctx.fillStyle = 'rgba(12,58,82,0.5)';
      const a0 = -Math.PI / 2, a1 = a0 + cdK * TAU;
      for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) {
        if (x * x + y * y > r * r) continue;
        let a = Math.atan2(y, x);
        if (a < a0) a += TAU;
        if (a <= a1) ctx.fillRect(bx + x, by + y + press, 1, 1);
      }
    }
    const gl = boltGlyph(ready ? '#ffffff' : '#c8d4dc');
    ctx.drawImage(gl, bx - Math.floor(gl.width / 2), by - Math.floor(gl.height / 2) + press);
    // charge pips (glossy beads under the button)
    const n = B.shockMax || 0;
    const pw = 7;
    for (let i = 0; i < n; i++) {
      const px = Math.round(bx - ((n - 1) * pw) / 2 + i * pw), py = by + r + 7;
      ctx.drawImage(beadSprite(i < B.charges ? '#ffd23a' : 'off'), px - 2, py - 2);
      if (i < B.charges && ready) { ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.4; ctx.drawImage(glowSprite(4, '#ffe27a'), px - 4, py - 4); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; }
    }
    // binding hint: mouse with the right button lit
    const mg = mouseGlyph();
    ctx.globalAlpha = ready ? 0.9 : 0.5;
    ctx.drawImage(mg, bx - r - mg.width - 4, by - 4);
    ctx.globalAlpha = 1;
    // little arcs crackling round a ready button
    if (ready && Math.random() < 0.08) {
      const a0 = Math.random() * TAU, a1 = a0 + 1.2;
      drawBolt(ctx, boltPoints(bx + Math.cos(a0) * (r + 2), by + Math.sin(a0) * (r + 2), bx + Math.cos(a1) * (r + 3), by + Math.sin(a1) * (r + 3), 3, (Math.random() * 1e9) >>> 0), 0.8);
    }
  }
}

const rnd = (a, b) => a + Math.random() * (b - a);
const ease = (k) => 1 - Math.pow(1 - k, 3);
function mixHex(a, b, t) {
  const A = hex(a.length === 7 ? a : '#59c3ff'), Bc = hex(b);
  return `rgb(${Math.round(A[0] + (Bc[0] - A[0]) * t)},${Math.round(A[1] + (Bc[1] - A[1]) * t)},${Math.round(A[2] + (Bc[2] - A[2]) * t)})`;
}
