// The physical reel: a big glossy Frutiger Aero pixel-art fly reel, face-on in the corner during the
// fight, hanging from a short stretch of rod. Everything the player needs reads off the reel itself:
//   handle      follows the cursor's angle around the crank loop (circle the mouse to crank)
//   spool       clear acrylic spool; wound line = catch progress; spokes blur with speed;
//               glows green in the sweet speed zone, orange when over-cranking
//   knob trail  speed: aqua (slow) -> green (sweet) -> orange (too fast)
//   rim LEDs    line tension (aqua -> green -> yellow -> red); the reel shakes and the line buzzes
//   drag star   spins and glows hot when the fish takes line; the ratchet pawl clicks per tooth
//   guide       the level-wind roller slides side to side as line goes on
//   SHOCK       glossy lightning button with charge pips and a cooldown sweep (also RMB / Space)
//   weight      a pulsing weight icon when the fish is heavier than the rod's strength
// API: new Reel(F); layout(W, H); update(dt, B); draw(ctx, B, k); hitShock(x, y).

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
const GLASS = ['#06243a', '#0a3450', '#0f4766', '#175c7e'].map(hex);
const LINE = ['#7fc4e0', '#a8e2f6', '#d2f4ff', '#f4fdff'].map(hex);
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
        // glossy aqua side plate (slightly domed)
        const facing = -(nx * LX + ny * LY);
        let l = 0.55 - 0.32 * (dy / R) - 0.1 * (dx / R);
        // glossy lip highlight crescent on the upper-left
        const ang = Math.atan2(dy, dx);
        if (d > R - 3.5 && d < R + 0.5 && Math.abs(ang + 2.25) < 0.7) l = 0.97;
        if (d < R - 5.5) l *= 0.7; // inner bevel shadow
        void facing;
        return [...rampAt(AQUA, l, x, y), 255];
      }
      // dark glass spool window (lit from below by the bay)
      let l = 0.25 + 0.55 * clamp01((dy / R + 1) / 2) ** 2;
      if (d > R - 8.5 && dy < 0) l *= 0.5; // inner shadow along the top
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
const N_LED = 17;

export class Reel {
  constructor(F) {
    this.F = F;
    this.handleA = -Math.PI / 2;
    this.spoolA = 0; this.spoolV = 0;
    this.tooth = 0; this.pawl = 0;
    this.clickT = 0;
    this.dragA = 0; this.dragHot = 0;
    this.shake = 0;
    this.trail = [];
    this.btnPress = 0; this.btnHover = false;
    this.fire = 0; // shock button flash
    this.lay = null;
    this.speedK = 0;
  }

  layout(W, H) {
    const R = Math.round(clamp(H * 0.088, 30, 52));
    const cx = Math.round(W - R - 30), cy = Math.round(H - R - 24);
    const br = Math.max(9, Math.round(R * 0.27));
    const bx = Math.round(cx - R - br * 0.2), by = Math.round(cy + R * 0.62);
    this.lay = { R, cx, cy, br, bx, by, Rk: R - 7 };
    return this.lay;
  }

  hitShock(x, y) {
    const L = this.lay;
    if (!L) return false;
    return Math.hypot(x - L.bx, y - L.by) <= L.br + 3;
  }

  update(dt, B) {
    const F = this.F, cr = F.crank, inp = F.input;
    if (!this.lay) this.layout(F.W, F.H);
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
    // knob trail
    this.speedK = damp(this.speedK, cr.power, 10, dt);
    this.trail.unshift(this.handleA);
    if (this.trail.length > 10) this.trail.length = 10;
    // shake with tension
    const T = B ? B.tension : 0;
    this.shake = T > 0.86 ? (T - 0.86) * 18 + (B.snapT > 0 ? 2 : 0) : 0;
    this.fire = Math.max(0, this.fire - dt * 3);
    this.btnPress = Math.max(0, this.btnPress - dt * 6);
    this.btnHover = this.hitShock(inp.x, inp.y);
  }

  // k: slide-in 0..1
  draw(ctx, B, k = 1) {
    const F = this.F, t = F.t;
    const L = this.lay || this.layout(F.W, F.H);
    const { R } = L;
    const slide = Math.round((1 - k) * (R * 2 + 60));
    const sx = this.shake ? Math.round((Math.random() - 0.5) * this.shake) : 0;
    const sy = this.shake ? Math.round((Math.random() - 0.5) * this.shake) : 0;
    const cx = L.cx + slide + sx, cy = L.cy + slide + sy;
    const T = B ? clamp(B.tension, 0, 1.2) : 0.2;
    const prog = B ? clamp01(B.progress) : 0;
    const zone = B?.zone;
    const p = this.speedK;
    const state = !zone || p < 0.12 ? 'idle' : p > zone.hi ? 'over' : p >= zone.lo ? 'sweet' : 'slow';
    ctx.save();
    // ---- rod above the reel (bends with tension)
    this.drawRod(ctx, cx, cy, R, T, t);
    // ---- outer glow by state
    const glowCol = T > 0.9 ? '#ff4f5e' : state === 'over' ? '#ff9d2e' : state === 'sweet' ? '#8be04a' : '#59c3ff';
    const gA = T > 0.9 ? 0.55 + 0.35 * Math.sin(t * 22) : state === 'sweet' ? 0.45 : state === 'over' ? 0.5 : 0.22;
    const gr = R + 22;
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = gA;
    ctx.drawImage(glowSprite(gr, glowCol), cx - gr, cy - gr);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    // ---- foot (reel seat) connecting to the rod
    this.drawFoot(ctx, cx, cy, R);
    // ---- body
    const body = bodySprite(R), C = R + 8;
    ctx.drawImage(body, cx - C, cy - C);
    // ---- spool: wound line (progress) + sweet glow + rotating glints + spokes
    const ra = 8, rmax = R - 9;
    const rf = Math.round(ra + 3 + prog * (rmax - ra - 3));
    if (state === 'sweet' || state === 'over') {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = state === 'sweet' ? 0.5 + 0.15 * Math.sin(t * 10) : 0.55;
      const sg = rf + 6;
      ctx.drawImage(glowSprite(sg, state === 'sweet' ? '#8be04a' : '#ff9d2e'), cx - sg, cy - sg);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.drawImage(lineSprite(rf, ra), cx - rf, cy - rf);
    // glints travel round the wound line as it spins
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 3; i++) {
      const a = this.spoolA + (i * TAU) / 3;
      for (let j = 0; j < 5; j++) {
        const aa = a - j * 0.07;
        const rr = rf - 2 - (i % 2);
        ctx.fillStyle = rgba('#ffffff', 0.7 - j * 0.13);
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
        const x0 = cx + Math.cos(a) * 5, y0 = cy + Math.sin(a) * 5;
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
    // ---- ratchet pawl (right side): twitches per click
    const px = cx + R + 3, py = cy + Math.round(R * 0.25);
    ctx.fillStyle = '#2c4a62'; ctx.fillRect(px - 1, py - 4, 5, 8);
    ctx.fillStyle = '#b4d0e2'; ctx.fillRect(px, py - 3, 3, 6);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(px, py - 3, 1, 4);
    const pw = Math.round(this.pawl * 2);
    ctx.fillStyle = '#e2f2fc'; ctx.fillRect(px - 3 - pw, py - 1, 3, 2);
    // ---- level-wind line guide at the top (slides side to side)
    this.drawGuide(ctx, cx, cy, R, T, t);
    // ---- rim LEDs: tension
    this.drawLeds(ctx, cx, cy, R, T, t, B);
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
      const wx = cx - R - 2, wy = cy - R - 2;
      ctx.drawImage(wi, wx, wy);
      if (pulse) { ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.5; ctx.drawImage(glowSprite(8, '#ff4f5e'), wx - 5, wy - 4); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; }
    }
    ctx.restore();
    // ---- shock button + pips
    this.drawShock(ctx, B, slide, t);
  }

  drawRod(ctx, cx, cy, R, T, t) {
    const W = this.F.W;
    const bx = W + 12, by = cy - R - 26;
    const tipx = cx - R - 70, tipy0 = cy - R - 58;
    const bend = clamp(T, 0, 1.1) * 18 + Math.sin(t * 3) * 1.5;
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
    // blank: glossy white-aqua carbon, tapering
    for (const [x, y, u] of pts) {
      const w = Math.max(2, Math.round(5 - u * 3));
      ctx.fillStyle = '#0c3a52'; ctx.fillRect(Math.round(x) - 1, Math.round(y) - 1, 3, w + 2);
    }
    for (const [x, y, u] of pts) {
      const w = Math.max(2, Math.round(5 - u * 3));
      ctx.fillStyle = '#59c3ff'; ctx.fillRect(Math.round(x), Math.round(y), 2, w);
      ctx.fillStyle = '#e8faff'; ctx.fillRect(Math.round(x), Math.round(y), 2, 1);
      ctx.fillStyle = '#1e8fe0'; ctx.fillRect(Math.round(x), Math.round(y) + w - 1, 2, 1);
    }
    // grip (cork-white foam) on the right
    for (const [x, y, u] of pts) {
      if (u > 0.22) continue;
      ctx.fillStyle = '#0c3a52'; ctx.fillRect(Math.round(x), Math.round(y) - 2, 2, 9);
      ctx.fillStyle = (Math.round(x) >> 1) % 3 ? '#f4fbff' : '#d8eef8'; ctx.fillRect(Math.round(x), Math.round(y) - 1, 2, 7);
      ctx.fillStyle = '#ffffff'; ctx.fillRect(Math.round(x), Math.round(y) - 1, 2, 1);
    }
    // a guide ring and the tip ring
    const g1 = pts[Math.floor(pts.length * 0.62)], gt = pts[pts.length - 1];
    for (const g of [g1, gt]) {
      if (!g) continue;
      ctx.fillStyle = '#0c3a52'; ctx.fillRect(Math.round(g[0]) - 2, Math.round(g[1]) + 3, 5, 5);
      ctx.fillStyle = '#e2f2fc'; ctx.fillRect(Math.round(g[0]) - 1, Math.round(g[1]) + 4, 3, 3);
      ctx.fillStyle = '#0a3450'; ctx.fillRect(Math.round(g[0]), Math.round(g[1]) + 5, 1, 1);
    }
    this.rodGuide = g1 ? [Math.round(g1[0]), Math.round(g1[1]) + 5] : [cx, cy - R - 20];
    this.rodTip = gt ? [Math.round(gt[0]), Math.round(gt[1]) + 5] : [cx - R - 60, cy - R - 40];
    this.footY = by + 4;
  }

  drawFoot(ctx, cx, cy, R) {
    const top = Math.round(this.footY ?? cy - R - 20), bot = cy - R - 2;
    ctx.fillStyle = '#0c3a52'; ctx.fillRect(cx - 6, top - 1, 13, bot - top + 2);
    for (let y = top; y < bot; y++) {
      ctx.fillStyle = '#7fa4bc'; ctx.fillRect(cx - 5, y, 11, 1);
      ctx.fillStyle = '#e2f2fc'; ctx.fillRect(cx - 4, y, 3, 1);
      ctx.fillStyle = '#4f7690'; ctx.fillRect(cx + 4, y, 2, 1);
    }
    ctx.fillStyle = '#ffffff'; ctx.fillRect(cx - 4, top, 1, bot - top);
  }

  drawGuide(ctx, cx, cy, R, T, t) {
    const lw = Math.round(Math.sin(this.spoolA * 0.09) * 6);
    const gx = cx + 12 + lw, gy = cy - R - 4;
    // arm
    ctx.fillStyle = '#0c3a52'; ctx.fillRect(cx + 5, gy - 2, 22, 5);
    ctx.fillStyle = '#b4d0e2'; ctx.fillRect(cx + 6, gy - 1, 20, 3);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(cx + 6, gy - 1, 20, 1);
    // roller
    ctx.fillStyle = '#0c3a52'; ctx.fillRect(gx - 3, gy - 4, 7, 8);
    const rol = Math.floor(this.spoolA * 3) % 2;
    ctx.fillStyle = rol ? '#e2f2fc' : '#b4d0e2'; ctx.fillRect(gx - 2, gy - 3, 5, 6);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(gx - 2, gy - 3, 2, 1);
    // the line: roller -> rod guide -> tip, buzzing with tension
    const g = this.rodGuide || [cx - R, cy - R - 30], tip = this.rodTip || [cx - R - 60, cy - R - 40];
    const col = T > 0.9 ? '#ff6a5a' : T > 0.75 ? '#ffd23a' : '#f4fdff';
    const vib = T > 0.6 ? (T - 0.6) * 5 : 0;
    const segs = [[gx, gy - 3, g[0], g[1]], [g[0], g[1], tip[0], tip[1]]];
    ctx.fillStyle = rgba(col, 0.95);
    for (const [x0, y0, x1, y1] of segs) {
      const n = Math.max(2, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
      const L = Math.hypot(x1 - x0, y1 - y0) || 1, nx = -(y1 - y0) / L, ny = (x1 - x0) / L;
      for (let i = 0; i <= n; i++) {
        const u = i / n;
        const w = Math.sin(u * Math.PI) * vib * Math.sin(t * 70 + u * 9);
        ctx.fillRect(Math.round(x0 + (x1 - x0) * u + nx * w), Math.round(y0 + (y1 - y0) * u + ny * w), 1, 1);
      }
    }
    // beyond the tip the line runs out toward the fish (fades)
    const ex = tip[0] - 26, ey = tip[1] - 30;
    for (let i = 0; i <= 30; i++) {
      const u = i / 30;
      ctx.fillStyle = rgba(col, 0.9 * (1 - u));
      ctx.fillRect(Math.round(lerp(tip[0], ex, u)), Math.round(lerp(tip[1], ey, u) + Math.sin(u * Math.PI) * (1 - clamp01(T)) * 4), 1, 1);
    }
  }

  drawLeds(ctx, cx, cy, R, T, t, B) {
    const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
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
    // snap timer: the last LEDs flash white as the line is about to go
    if (B?.snapT > 0) {
      const k = clamp01(B.snapT / B.grace);
      const a = a1 + 0.18;
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = k;
      ctx.drawImage(glowSprite(Math.round(6 + k * 8), '#ff4f5e'), Math.round(cx + Math.cos(a) * rr) - Math.round(6 + k * 8), Math.round(cy + Math.sin(a) * rr) - Math.round(6 + k * 8));
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
      for (let i = 1; i < 16; i++) {
        const aa = a - (i / 16) * span;
        ctx.fillStyle = rgba(tcol, (1 - i / 16) * 0.8);
        ctx.fillRect(Math.round(cx + Math.cos(aa) * Rk) - 2, Math.round(cy + Math.sin(aa) * Rk) - 2, 4, 4);
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
    if (!B) return;
    const bx = L.bx + slide, by = L.by + slide, r = L.br;
    const ready = B.shockReady;
    const cdK = B.shockCdMax ? clamp01(B.shockCd / B.shockCdMax) : 0;
    const press = this.btnPress > 0 ? 1 : 0;
    // glow when ready
    if (ready) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = (0.35 + 0.25 * Math.sin(t * 6)) + this.fire * 0.6 + (this.btnHover ? 0.2 : 0);
      ctx.drawImage(glowSprite(r + 12, '#ffe27a'), bx - r - 12, by - r - 12);
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
    // charge pips
    const n = B.shockMax || 0;
    const pw = 7;
    for (let i = 0; i < n; i++) {
      const px = Math.round(bx - ((n - 1) * pw) / 2 + i * pw), py = by + r + 6;
      ctx.drawImage(beadSprite(i < B.charges ? '#ffd23a' : 'off'), px - 2, py - 2);
    }
    // binding hint: mouse with the right button lit
    const mg = mouseGlyph();
    ctx.globalAlpha = 0.85;
    ctx.drawImage(mg, bx - r - mg.width - 3, by - 4);
    ctx.globalAlpha = 1;
    // little arcs crackling round a ready button
    if (ready && Math.random() < 0.06) {
      const a0 = Math.random() * TAU, a1 = a0 + 1.2;
      drawBolt(ctx, boltPoints(bx + Math.cos(a0) * (r + 2), by + Math.sin(a0) * (r + 2), bx + Math.cos(a1) * (r + 3), by + Math.sin(a1) * (r + 3), 3, (Math.random() * 1e9) >>> 0), 0.8);
    }
  }
}
