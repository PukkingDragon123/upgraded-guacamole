// The illustrated reef panorama on the tank's back glass, in the spirit of the classic moving-picture
// aquarium lamp: a saturated, seamlessly tileable strip of blue water, light beams, coral (branching,
// brain, sea fans, tube sponges, anemones), sea grass and lots of little cartoon tropical fish (striped,
// banded, yellow, blue; cute eyes), outlined like a printed illustration. It scrolls slowly sideways
// like the lamp's rotating cylinder. Original art, painted once per height and cached.
//
//   reefPanorama(h, seed) -> {canvas, w, h}   (w = about 3.6 h; the strip wraps seamlessly at w)
//   drawReef(ctx, pano, x0, y0, x1, y1, off) draws the strip scrolled by `off` px over [x0, x1) x [y0, y1)

import { Paint, C, setMix, grad } from './paint.js';
import { hash2, clamp01, smoothstep, TAU } from '../core/math.js';

const cache = new Map();

const INK = C('#0a2a5a');
const PAL = {
  waterT: C('#2aa6f4'), waterM: C('#1688e0'), waterB: C('#0b56b4'),
  orange: [C('#ffd09a'), C('#ff8a2a'), C('#c84a12')], pink: [C('#ffc4e4'), C('#ff5aa8'), C('#b81e6e')],
  purple: [C('#e4c4ff'), C('#a65aff'), C('#5a22b4')], yellow: [C('#fff8b0'), C('#ffd83a'), C('#c89a10')],
  lime: [C('#e8ffa8'), C('#9ae03a'), C('#4a9a18')], red: [C('#ffb4b4'), C('#ff3a4a'), C('#a8102a')],
  cyan: [C('#c8fff8'), C('#3ae0d8'), C('#108a9a')], cream: [C('#fffaf0'), C('#ffe4c0'), C('#d8a878')],
  blue: [C('#bfe4ff'), C('#3a8cff'), C('#1a3ab4')], green: [C('#b8f0a0'), C('#3ab84a'), C('#16702a')],
  white: C('#ffffff'), black: C('#101828'),
};

export function reefPanorama(h, seed = 1, fishK = 1) {
  h = Math.max(24, Math.round(h));
  const key = h + '|' + seed + '|' + fishK;
  let p = cache.get(key);
  if (p) return p;
  const w = Math.round(h * 3.6 / 2) * 2;
  const P = new Paint(w, h);
  const c = P.c;
  const rnd = mulberry(seed * 7919 + h);
  // wrap helper: run a painter at x, x - w and x + w so the strip tiles seamlessly
  const wrap = (x0, y0, x1, y1, fn) => {
    for (const o of [0, -w, w]) {
      if (x1 + o < 0 || x0 + o > w) continue;
      P.each(x0 + o, y0, x1 + o, y1, (x, y) => fn(x - o, y));
    }
  };
  // ---- water: bright at the top, deep at the bottom, soft light beams (periodic in x)
  P.each(0, 0, w, h, (x, y) => {
    const t = y / h;
    grad(c, [[0, PAL.waterT], [0.5, PAL.waterM], [1, PAL.waterB]], t);
    const beam = Math.pow(Math.max(0, Math.sin((x / w) * TAU * 7 + y * 0.012)), 14) * (1 - t) * 0.35;
    const beam2 = Math.pow(Math.max(0, Math.sin((x / w) * TAU * 4 + 1.3 - y * 0.008)), 20) * (1 - t) * 0.25;
    setMix(c, c, PAL.white, beam + beam2);
    return 1;
  });
  // ---- distant reef silhouette (hazy) and sea grass
  const ridge = (x) => h * (0.6 - 0.07 * Math.sin((x / w) * TAU * 3 + 0.7) - 0.05 * Math.sin((x / w) * TAU * 7 + 2.1) - 0.03 * Math.sin((x / w) * TAU * 13));
  P.each(0, h * 0.35, w, h, (x, y) => {
    const r = ridge(x);
    if (y < r) return 0;
    setMix(c, C('#2c78d8'), C('#5a4ac8'), clamp01((y - r) / (h * 0.4)));
    if (y < r + 1.5) setMix(c, c, PAL.white, 0.35);
    return 0.85;
  });
  const n = Math.round(w / h * 9);
  for (let i = 0; i < n; i++) {
    const x = rnd() * w, hh = h * (0.18 + rnd() * 0.25), base = h * (0.7 + rnd() * 0.25);
    const col = rnd() < 0.5 ? PAL.green : PAL.lime;
    const ph = rnd() * TAU;
    blade(wrap, c, x, base, hh, Math.max(1.2, h * 0.012), ph, col);
  }
  // ---- coral clusters
  const nc = Math.round(w / (h * 0.3));
  for (let i = 0; i < nc; i++) {
    const x = (i + 0.2 + rnd() * 0.6) / nc * w;
    const base = h * (0.82 + rnd() * 0.16);
    const kind = Math.floor(rnd() * 6);
    const s = h * (0.12 + rnd() * 0.14);
    const cols = [PAL.orange, PAL.pink, PAL.purple, PAL.yellow, PAL.red, PAL.cyan, PAL.lime][Math.floor(rnd() * 7)];
    if (kind === 0) branching(wrap, c, x, base, s * 1.3, cols, rnd);
    else if (kind === 1) dome(wrap, c, x, base, s * 0.9, s * 0.55, rnd() < 0.5 ? PAL.yellow : PAL.lime);
    else if (kind === 2) fan(wrap, c, x, base, s * 1.2, rnd() < 0.5 ? PAL.purple : PAL.red);
    else if (kind === 3) tubes(wrap, c, x, base, s, rnd() < 0.5 ? PAL.orange : PAL.yellow, rnd);
    else if (kind === 4) anemone(wrap, c, x, base, s * 0.8, rnd() < 0.5 ? PAL.pink : PAL.cream, rnd);
    else { dome(wrap, c, x - s * 0.5, base, s * 0.6, s * 0.4, PAL.lime); branching(wrap, c, x + s * 0.3, base, s, cols, rnd); }
  }
  // a second, nearer row of small coral and anemones along the bottom
  for (let i = 0; i < nc; i++) {
    const x = (i + 0.7 + rnd() * 0.5) / nc * w;
    const s = h * (0.07 + rnd() * 0.08);
    if (rnd() < 0.5) anemone(wrap, c, x, h * 0.99, s, rnd() < 0.5 ? PAL.pink : PAL.cyan, rnd);
    else dome(wrap, c, x, h * 1.0, s, s * 0.6, rnd() < 0.5 ? PAL.orange : PAL.purple);
  }
  // ---- little cartoon fish
  const nf = Math.round(w / h * 8 * fishK);
  const types = ['clown', 'tang', 'bluetang', 'idol', 'butterfly', 'angel', 'clown', 'gramma', 'wrasse', 'bluetang'];
  for (let i = 0; i < nf; i++) {
    const x = (i + rnd()) / nf * w;
    const y = h * (0.08 + rnd() * 0.55);
    const s = Math.max(2.2, h * (0.022 + rnd() * rnd() * 0.045) * (fishK < 1 ? 0.75 : 1));
    fishArt(wrap, c, x, y, s, rnd() < 0.5 ? 1 : -1, types[Math.floor(rnd() * types.length)]);
  }
  p = { canvas: P.toCanvas(4), w, h };
  cache.set(key, p);
  if (cache.size > 10) cache.delete(cache.keys().next().value);
  return p;
}

export function drawReef(ctx, pano, x0, y0, x1, y1, off) {
  const w = pano.w;
  const h = Math.min(pano.h, Math.ceil(y1 - y0));
  if (h <= 0) return;
  const sy = pano.h - h; // the bottom of the strip lines up with the bottom of the region
  let x = x0 - (((off % w) + w) % w);
  while (x < x1) {
    const sx0 = Math.max(0, x0 - x), sx1 = Math.min(w, x1 - x);
    if (sx1 > sx0) ctx.drawImage(pano.canvas, sx0, sy, sx1 - sx0, h, Math.round(x + sx0), Math.round(y1 - h), sx1 - sx0, h);
    x += w;
  }
}

// ------------------------------------------------------------------ painters (illustration style: flat
// tones lit from the top left, a dark ink outline)

function mulberry(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function segD(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
  const t = L > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L)) : 0;
  return [Math.hypot(px - ax - dx * t, py - ay - dy * t), t];
}

// capsule from a to b, radius r0 -> r1, ramp [light, mid, dark]
function capsule(wrap, c, ax, ay, bx, by, r0, r1, ramp, outline = true) {
  const R = Math.max(r0, r1) + 1.5;
  wrap(Math.min(ax, bx) - R, Math.min(ay, by) - R, Math.max(ax, bx) + R, Math.max(ay, by) + R, (x, y) => {
    const [d, t] = segD(x, y, ax, ay, bx, by);
    const r = r0 + (r1 - r0) * t;
    if (d > r + (outline ? 1 : 0)) return 0;
    if (d > r) { c[0] = INK[0]; c[1] = INK[1]; c[2] = INK[2]; return 0.9; }
    const nx = (x - (ax + (bx - ax) * t)) / Math.max(0.5, r);
    grad(c, [[0, ramp[2]], [0.55, ramp[1]], [1, ramp[0]]], clamp01(0.6 - nx * 0.5 - (d / r) * 0.15));
    return 1;
  });
}

function branching(wrap, c, x, base, s, ramp, rnd) {
  const segs = [];
  const grow = (x0, y0, ang, len, r, depth) => {
    const x1 = x0 + Math.cos(ang) * len, y1 = y0 + Math.sin(ang) * len;
    segs.push([x0, y0, x1, y1, r, r * 0.78]);
    if (depth <= 0) { segs.push([x1, y1, x1, y1, r * 1.05, r * 1.05]); return; }
    const k = 1 + (rnd() < 0.4 ? 1 : 0);
    for (let i = 0; i <= k; i++) grow(x1, y1, ang + (i - k / 2) * (0.5 + rnd() * 0.4), len * (0.65 + rnd() * 0.2), r * 0.78, depth - 1);
  };
  grow(x, base, -Math.PI / 2 + (rnd() - 0.5) * 0.3, s * 0.42, Math.max(1.5, s * 0.075), 3);
  for (const g of segs) capsule(wrap, c, g[0], g[1], g[2], g[3], g[4] + 1, g[5] + 1, [INK, INK, INK], false);
  for (const g of segs) capsule(wrap, c, g[0], g[1], g[2], g[3], g[4], g[5], ramp, false);
}

function dome(wrap, c, x, base, rx, ry, ramp) {
  wrap(x - rx - 2, base - ry - 2, x + rx + 2, base + 1, (px, py) => {
    const d = Math.hypot((px - x) / rx, (py - base) / ry);
    if (py > base) return 0;
    if (d > 1 + 1.2 / ry) return 0;
    if (d > 1) { c[0] = INK[0]; c[1] = INK[1]; c[2] = INK[2]; return 0.9; }
    const nx = (px - x) / rx, ny = (py - base) / ry;
    grad(c, [[0, ramp[2]], [0.55, ramp[1]], [1, ramp[0]]], clamp01(0.55 - nx * 0.35 - ny * 0.45));
    // brain-coral grooves
    const g = Math.sin(nx * 14 + Math.sin(ny * 9) * 2) * Math.sin(ny * 11 + nx * 3);
    if (g > 0.55) setMix(c, c, ramp[2], 0.45);
    return 1;
  });
}

function fan(wrap, c, x, base, s, ramp) {
  const cy = base - s * 0.05;
  wrap(x - s - 2, base - s - 2, x + s + 2, base + 1, (px, py) => {
    const dx = px - x, dy = py - cy;
    const d = Math.hypot(dx, dy * 1.05);
    if (py > base || d > s + 1) return 0;
    const a = Math.atan2(-dy, dx);
    if (a < 0.25 || a > Math.PI - 0.25) return 0;
    // lace: radial ribs and rings with holes between them
    const rib = Math.abs(Math.sin(a * 13)) < 0.32, ring = Math.abs(Math.sin(d * 0.7)) < 0.38;
    const stem = Math.abs(dx) < Math.max(1, s * 0.04) && d < s * 0.35;
    if (d > s) { c[0] = INK[0]; c[1] = INK[1]; c[2] = INK[2]; return 0.8; }
    if (!(rib || ring || stem)) return 0;
    grad(c, [[0, ramp[2]], [0.5, ramp[1]], [1, ramp[0]]], clamp01(0.4 + (d / s) * 0.5 - dx / s * 0.2));
    return 1;
  });
}

function tubes(wrap, c, x, base, s, ramp, rnd) {
  const n = 3 + Math.floor(rnd() * 3);
  for (let i = 0; i < n; i++) {
    const ox = (i - (n - 1) / 2) * s * 0.28 + (rnd() - 0.5) * s * 0.1;
    const hh = s * (0.5 + rnd() * 0.7), r = Math.max(1.6, s * 0.11);
    const tx = x + ox + (ox > 0 ? 1 : -1) * s * 0.06;
    capsule(wrap, c, x + ox * 0.6, base, tx, base - hh, r * 0.9, r, ramp);
    // dark opening at the top
    wrap(tx - r, base - hh - r * 0.6, tx + r, base - hh + r * 0.6, (px, py) => {
      const d = Math.hypot((px - tx) / (r * 0.6), (py - (base - hh)) / (r * 0.35));
      if (d > 1) return 0;
      setMix(c, ramp[2], INK, 0.5);
      return 1;
    });
  }
}

function anemone(wrap, c, x, base, s, ramp, rnd) {
  const n = 9 + Math.floor(rnd() * 5);
  const r = Math.max(1.2, s * 0.07);
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (i / (n - 1) - 0.5) * 2.2;
    const L = s * (0.6 + rnd() * 0.35);
    const bx = x + Math.cos(a) * s * 0.18, by = base - s * 0.15;
    const ex = bx + Math.cos(a) * L, ey = by + Math.sin(a) * L;
    capsule(wrap, c, bx, by, ex, ey, r, r * 1.25, ramp);
    // glowing white tip
    wrap(ex - r, ey - r, ex + r, ey + r, (px, py) => (Math.hypot(px - ex, py - ey) < r * 0.8 ? (setMix(c, PAL.white, ramp[0], 0.3), 1) : 0));
  }
  dome(wrap, c, x, base, s * 0.32, s * 0.22, ramp);
}

function blade(wrap, c, x, base, hh, r, ph, ramp) {
  const n = 5;
  let px = x, py = base;
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const nx = x + Math.sin(ph + t * 2.4) * hh * 0.12 * t, ny = base - hh * t;
    capsule(wrap, c, px, py, nx, ny, r * (1.15 - t * 0.5), r * (1.1 - t * 0.55), ramp, false);
    px = nx; py = ny;
  }
}

// Cartoon tropical fish facing dir (1 = right). s = body half-height.
function fishArt(wrap, c, x, y, s, dir, type) {
  const a = s * (type === 'idol' || type === 'butterfly' || type === 'angel' ? 1.25 : type === 'tang' ? 1.45 : 1.8), b = s;
  const tall = type === 'idol' || type === 'angel';
  const inside = (u, v) => {
    if ((u / a) ** 2 + (v / b) ** 2 <= 1) return 'body';
    if (u < -a * 0.75 && u > -a * 1.55 && Math.abs(v) <= (-u - a * 0.75) * 0.95 + b * 0.12) return 'tail';
    if (tall && v < 0 && v > -b * (type === 'idol' ? 2.3 : 1.7) && u > -a * 0.6 && u < a * 0.15 && -v < b * 0.8 + (a * 0.15 - u) * (type === 'idol' ? 2.2 : 1.4) * (u < -a * 0.25 ? 0.4 : 1)) return 'fin';
    if (!tall && v < 0 && v > -b * 1.35 && u > -a * 0.5 && u < a * 0.2 && -v < b * 0.85 + (a * 0.2 - u) * 0.5) return 'fin';
    if (v > 0 && v < b * 1.3 && u > -a * 0.4 && u < a * 0.05 && v < b * 0.9 + (a * 0.05 - u) * 0.4) return 'fin';
    return null;
  };
  const span = a * 1.7 + 2, vspan = b * 2.5 + 2;
  wrap(x - span, y - vspan, x + span, y + vspan, (px, py) => {
    const u = (px - x) * dir, v = py - y;
    const part = inside(u, v);
    if (!part) {
      // ink outline
      for (const [du, dv] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (inside(u + du, v + dv)) { c[0] = INK[0]; c[1] = INK[1]; c[2] = INK[2]; return 0.95; }
      return 0;
    }
    const lit = clamp01(0.6 - v / b * 0.4);
    const t = u / a; // -1 tail .. 1 head
    let ramp = PAL.yellow;
    if (type === 'clown') {
      ramp = PAL.orange;
      const band = Math.abs(t - 0.45) < 0.12 || Math.abs(t + 0.15) < 0.13 || (part === 'tail' && t < -1.25);
      if (band && part !== 'fin') ramp = PAL.cream;
      if (part !== 'body' && (t < -1.45 || v < -b * 1.15 || v > b * 1.1)) ramp = [INK, INK, INK];
    } else if (type === 'tang') ramp = PAL.yellow;
    else if (type === 'bluetang') {
      ramp = PAL.blue;
      if (part === 'tail') ramp = PAL.yellow;
      else if (part === 'body' && v < b * 0.1 && v > -b * 0.55 && t < 0.35 && t > -0.75 && Math.abs(v + b * 0.2 - Math.sin(t * 3) * b * 0.1) < b * 0.25) ramp = [PAL.black, PAL.black, PAL.black];
    } else if (type === 'idol') {
      ramp = PAL.cream;
      if ((t > 0.1 && t < 0.35) || (t < -0.35 && t > -0.75)) ramp = [PAL.black, PAL.black, PAL.black];
      else if (t < -0.75 || part === 'fin') ramp = PAL.yellow;
    } else if (type === 'butterfly') {
      ramp = PAL.yellow;
      if (part === 'body' && t > 0.3 && t < 0.45) ramp = [PAL.black, PAL.black, PAL.black];
      if (part === 'fin') ramp = PAL.orange;
    } else if (type === 'angel') {
      ramp = PAL.blue;
      if (Math.sin(t * 14 + v / b * 3) > 0.45) ramp = PAL.yellow;
    } else if (type === 'gramma') {
      ramp = t > -0.05 ? PAL.purple : PAL.yellow;
    } else if (type === 'wrasse') {
      ramp = PAL.cyan;
      if (part === 'body' && Math.abs(v / b - Math.sin(t * 4) * 0.3) < 0.18) ramp = PAL.pink;
      if (part === 'tail') ramp = PAL.lime;
    }
    grad(c, [[0, ramp[2]], [0.55, ramp[1]], [1, ramp[0]]], lit);
    if (part === 'body' && v < -b * 0.55 && t > -0.3 && t < 0.4) setMix(c, c, PAL.white, 0.3);
    // cute cartoon eye: white with a big dark pupil and a shine
    const ex = a * 0.52, ey = -b * 0.18, er = Math.max(1.2, b * 0.36);
    const de = Math.hypot(u - ex, v - ey);
    if (de < er) {
      const dp = Math.hypot(u - ex - er * 0.18, v - ey + er * 0.05);
      if (dp < er * 0.62) {
        if (Math.hypot(u - ex - er * 0.02, v - ey + er * 0.3) < er * 0.22) { c[0] = 255; c[1] = 255; c[2] = 255; }
        else { c[0] = PAL.black[0]; c[1] = PAL.black[1]; c[2] = PAL.black[2]; }
      } else { c[0] = 255; c[1] = 255; c[2] = 255; }
      if (de > er - 0.8) { c[0] = INK[0]; c[1] = INK[1]; c[2] = INK[2]; }
    }
    // little smile
    if (part === 'body' && Math.abs(u - a * 0.86) < 0.9 && Math.abs(v - b * 0.22) < 0.7) { c[0] = INK[0]; c[1] = INK[1]; c[2] = INK[2]; }
    return 1;
  });
}

void hash2; void smoothstep;
