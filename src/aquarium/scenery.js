// Eco-Aero scenery for the view out of the aquarium room's window and the leafy frame around it
// (original art in the spirit of the 2000s eco wallpapers): a glass city inside a water bubble, a glossy
// green glass globe, thin white arcs across the sky, and glossy leafy branches that frame the view.
//
//   cityBubble(R)            -> canvas  (2R+pad square; the bubble's bottom centre is at (w/2, h - pad))
//   glassGlobe(R)            -> canvas  (globe centred)
//   paintArcs(P, w, h, u)    thin white arcs painted into a sky Paint
//   paintLeafBranch(P, x, y, ang, len, u, seed, opts)   a branch of glossy leaves painted into a Paint

import { Paint, C, setMix, grad } from './paint.js';
import { clamp01, smoothstep, fbm2, hash2, TAU } from '../core/math.js';

const W = C('#ffffff');

// ------------------------------------------------------------------ glass city in a water bubble

const cityCache = new Map();
export function cityBubble(R) {
  R = Math.max(8, Math.round(R));
  let cv = cityCache.get(R);
  if (cv) return cv;
  const pad = Math.round(R * 0.25) + 2;
  const S = R * 2 + pad * 2;
  const P = new Paint(S, S);
  const c = P.c;
  const cx = S / 2, cy = S / 2;
  // towers (back to front), glass blue-grey with window grids and a bright reflection stripe
  const towers = [];
  let rs = R * 13 + 7;
  const rnd = () => ((rs = (rs * 9301 + 49297) % 233280) / 233280);
  const n = 9;
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const x = cx - R * 0.78 + t * R * 1.5 + (rnd() - 0.5) * R * 0.08;
    const w = R * (0.13 + rnd() * 0.1);
    const mid = 1 - Math.abs(t - 0.45) * 1.5;
    const h = R * (0.55 + mid * 0.75 + rnd() * 0.3);
    towers.push({ x, w, h, slant: rnd() < 0.3, tone: rnd(), back: i % 2 === 0 });
  }
  towers.sort((a, b) => (a.back === b.back ? 0 : a.back ? -1 : 1));
  const ground = cy + R * 0.62;
  for (const tw of towers) {
    const x0 = tw.x - tw.w / 2, x1 = tw.x + tw.w / 2, top = ground - tw.h * (tw.back ? 0.85 : 1);
    P.each(x0, top - tw.w * 0.4, x1, ground, (x, y) => {
      if (Math.hypot(x - cx, y - cy) > R - 1) return 0;
      const slantTop = tw.slant ? top + (x - x0) / tw.w * tw.w * 0.35 : top;
      if (y < slantTop) return 0;
      const u = (x - x0) / tw.w, v = (y - top) / tw.h;
      const base = tw.back ? [C('#9cc4dc'), C('#6e98b8'), C('#4a7298')] : [C('#d8f0ff'), C('#7eaed4'), C('#3a6a96')];
      grad(c, [[0, base[2]], [0.5, base[1]], [1, base[0]]], clamp01(0.75 - u * 0.6 + tw.tone * 0.15 - v * 0.2));
      // sky reflected in the glass: a bright band and a soft gradient
      if (u > 0.15 && u < 0.32) setMix(c, c, W, 0.45);
      // window grid
      const gx = (x - x0) % Math.max(2, tw.w / 4), gy = (y - top) % Math.max(2, R * 0.06);
      if (gx < 0.7 || gy < 0.6) setMix(c, c, C('#2a4a6a'), 0.25);
      if (x < x0 + 1 || x > x1 - 1) setMix(c, c, C('#1a3a5a'), 0.4);
      return tw.back ? 0.85 : 1;
    });
  }
  // green lawn under the city inside the bubble
  P.each(cx - R, ground - 2, cx + R, cy + R, (x, y) => {
    if (Math.hypot(x - cx, y - cy) > R - 1) return 0;
    const t = (y - ground) / (R * 0.4);
    grad(c, [[0, C('#c8f56a')], [0.4, C('#6fcf3c')], [1, C('#3a9a28')]], t);
    return 1;
  });
  // the bubble: clear water skin, bright rim, a swirl of splash on the left, a big highlight
  P.each(0, 0, S, S, (x, y) => {
    const dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy) / R;
    if (d > 1.02) {
      // splash streaks curling around the left side
      const a = Math.atan2(dy, dx);
      if (a > 1.7 || a < -2.6) {
        const k = Math.sin(a * 5 + d * 9);
        if (d < 1.16 && k > 0.6) { setMix(c, W, C('#bfeaff'), 0.3); return 0.55 * (1 - (d - 1.02) / 0.14); }
      }
      return 0;
    }
    const a = Math.atan2(dy, dx);
    let al = 0;
    c[0] = 255; c[1] = 255; c[2] = 255;
    if (d > 0.93) { setMix(c, W, C('#9fe0ff'), (dx + dy) / R * 0.5 + 0.5); al = 0.75; }
    else if (d > 0.82) { setMix(c, C('#dff6ff'), W, 0.5); al = 0.12 + 0.2 * (d - 0.82) / 0.11; }
    else al = 0.06;
    // highlight crescent upper left, small glints
    if (d > 0.62 && d < 0.84 && a > -2.6 && a < -1.6) al = Math.max(al, 0.55 * Math.sin((a + 2.6) / 1.0 * Math.PI));
    if (Math.hypot(dx + R * 0.32, dy + R * 0.5) < R * 0.07) al = 0.9;
    // swirling water lines inside the skin (left half)
    if (dx < 0 && d > 0.7 && Math.abs(Math.sin(a * 3 + d * 14)) < 0.08) al = Math.max(al, 0.4);
    return al;
  }, 'over');
  cv = P.toCanvas(4);
  cv.pad = pad;
  cityCache.set(R, cv);
  return cv;
}

// ------------------------------------------------------------------ green glass globe

const globeCache = new Map();
export function glassGlobe(R) {
  R = Math.max(8, Math.round(R));
  let cv = globeCache.get(R);
  if (cv) return cv;
  const S = R * 2 + 6;
  const P = new Paint(S, S);
  const c = P.c;
  const cx = S / 2, cy = S / 2;
  const deep = C('#1f8a2a'), mid = C('#5ad83a'), lite = C('#c8ff8a'), land = C('#f4fff0'), landS = C('#c8ecd0');
  P.each(0, 0, S, S, (x, y) => {
    const nx = (x - cx) / R, ny = (y - cy) / R;
    const r2 = nx * nx + ny * ny;
    if (r2 > 1) return 0;
    const nz = Math.sqrt(1 - r2);
    const lit = clamp01(0.55 - nx * 0.45 - ny * 0.5 + nz * 0.3);
    grad(c, [[0, deep], [0.5, mid], [0.9, lite], [1, W]], lit * 0.9);
    // continents (original blobs on the sphere), lighter and frosted
    const lon = Math.atan2(nx, nz) + 0.6, lat = Math.asin(Math.max(-1, Math.min(1, ny)));
    const n = fbm2(lon * 1.1 + 3, lat * 1.6 + 1, 3, 17);
    if (n > 0.6) { setMix(c, C('#a8e8b0'), land, lit); if (n < 0.62) setMix(c, c, mid, 0.35); }
    // meridians and parallels
    const m = Math.abs(((lon / (TAU / 14)) % 1 + 1) % 1 - 0.5), p = Math.abs(((lat / (Math.PI / 9)) % 1 + 1) % 1 - 0.5);
    if (m > 0.47 || p > 0.47) setMix(c, c, W, 0.3 * nz);
    // glass: big soft highlight top-left, rim light bottom-right, bright edge
    const hx = nx + 0.4, hy = ny + 0.5;
    const h = 1 - Math.hypot(hx / 0.32, hy / 0.2);
    if (h > 0) setMix(c, c, W, Math.min(0.8, h * 1.6));
    else if (nx < -0.1 && ny < -0.1) setMix(c, c, W, 0.12 * clamp01(-nx - ny - 0.2));
    if (r2 > 0.86) setMix(c, c, nx + ny > 0.3 ? lite : C('#2a9a3a'), 0.5);
    if (nx > 0.2 && ny > 0.2 && r2 > 0.7) setMix(c, c, W, 0.25);
    return 1;
  });
  // a sparkle on the highlight
  const sx = Math.round(cx - R * 0.45), sy = Math.round(cy - R * 0.5), s = Math.max(2, Math.round(R * 0.08));
  for (let i = -s; i <= s; i++) { P.over(sx + i, sy, W, 1 - Math.abs(i) / (s + 1)); P.over(sx, sy + i, W, 1 - Math.abs(i) / (s + 1)); }
  cv = P.toCanvas(4);
  globeCache.set(R, cv);
  return cv;
}

// ------------------------------------------------------------------ arcs

// Thin white concentric arcs sweeping across the middle of the sky.
export function paintArcs(P, w, h, u) {
  const c = P.c;
  const cx = w * 0.5, cy = h * 1.75;
  const n = 7;
  P.each(w * 0.22, 0, w * 0.8, h * 0.85, (x, y) => {
    const d = Math.hypot(x - cx, (y - cy) * 1.05);
    let a = 0;
    for (let i = 0; i < n; i++) {
      const R = h * (1.18 + i * 0.05);
      if (Math.abs(d - R) < 0.55 + u * 0.2) a = Math.max(a, 0.38 - i * 0.03);
    }
    if (!a) return 0;
    const fx = Math.min(1, (x - w * 0.22) / (w * 0.12), (w * 0.8 - x) / (w * 0.12));
    c[0] = 255; c[1] = 255; c[2] = 255;
    return a * fx;
  });
}

// ------------------------------------------------------------------ glossy leaves

// One glossy leaf: base (bx, by), direction ang, length L, half width Wd; light from the upper left.
function paintLeaf(P, bx, by, ang, L, Wd, flip, seed) {
  const c = P.c;
  const ca = Math.cos(ang), sa = Math.sin(ang);
  const ext = L + Wd + 2;
  const ink = C('#145a1a'), dark = C('#2a8a1a'), midc = C('#62cc2c'), lite = C('#b8f05a'), pale = C('#e4ffa0');
  const inside = (u, v) => {
    if (u < 0 || u > L) return false;
    const t = u / L;
    const prof = Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.08)), 0.75) * (1 - 0.12 * t);
    const serr = 1 + 0.06 * Math.sin(u * 0.9 + seed);
    return Math.abs(v) < Wd * prof * serr;
  };
  P.each(bx - ext, by - ext, bx + ext, by + ext, (x, y) => {
    const dx = x - bx, dy = y - by;
    const u = dx * ca + dy * sa, v = (-dx * sa + dy * ca) * (flip ? -1 : 1);
    if (!inside(u, v)) {
      if (inside(u + 1, v) || inside(u - 1, v) || inside(u, v + 1) || inside(u, v - 1)) { c[0] = ink[0]; c[1] = ink[1]; c[2] = ink[2]; return 0.9; }
      return 0;
    }
    const t = u / L;
    const side = v < 0 ? 1 : 0; // one half catches more light
    const w = Math.abs(v) / Wd;
    grad(c, [[0, dark], [0.45, midc], [0.85, lite], [1, pale]], clamp01(0.35 + side * 0.35 - w * 0.25 + (1 - t) * 0.1));
    // midrib and veins
    if (Math.abs(v) < 0.6 + Wd * 0.03) setMix(c, c, pale, 0.7);
    else if (Math.abs(Math.sin((u - Math.abs(v) * 1.3) * (5.5 / Math.max(6, L * 0.25)) * 3)) > 0.96) setMix(c, c, side ? pale : dark, 0.35);
    // glossy streak
    if (v < -Wd * 0.25 && v > -Wd * 0.6 && t > 0.2 && t < 0.75) setMix(c, c, W, 0.35 * Math.sin((t - 0.2) / 0.55 * Math.PI));
    return 1;
  });
}

// A branch: a gently curving stem from (x, y) along ang with leaves alternating on both sides.
export function paintLeafBranch(P, x, y, ang, len, u, seed = 1, o = {}) {
  const c = P.c;
  let s = seed * 7919 + 13;
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  const n = o.leaves ?? 7;
  const bend = o.bend ?? 0.35;
  const pts = [];
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    const a = ang + bend * t * t;
    pts.push([x + Math.cos(a) * len * t, y + Math.sin(a) * len * t + Math.sin(t * 3 + seed) * len * 0.03]);
  }
  // stem
  const sw = Math.max(1, 2.2 * u);
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
    const r = sw * (1 - (i / pts.length) * 0.6);
    P.each(Math.min(ax, bx) - r - 1, Math.min(ay, by) - r - 1, Math.max(ax, bx) + r + 1, Math.max(ay, by) + r + 1, (px, py) => {
      const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
      const tt = L2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L2)) : 0;
      const d = Math.hypot(px - ax - dx * tt, py - ay - dy * tt);
      if (d > r) return 0;
      setMix(c, C('#2a7a1a'), C('#8ad84a'), clamp01(0.6 - d / r * 0.5));
      return 1;
    });
  }
  // leaves
  for (let i = 0; i < n; i++) {
    const t = 0.15 + (i / Math.max(1, n - 1)) * 0.85;
    const p = pts[Math.min(pts.length - 1, Math.round(t * 24))];
    const dir = ang + bend * t * t;
    const sideA = i % 2 ? 1 : -1;
    const la = dir + sideA * (0.7 + rnd() * 0.4);
    const L = len * (o.leafLen ?? 0.32) * (0.75 + rnd() * 0.45) * (i === n - 1 ? 1.1 : 1);
    paintLeaf(P, p[0], p[1], i === n - 1 ? dir : la, L, L * (0.36 + rnd() * 0.06), sideA > 0, seed + i);
  }
}

void smoothstep; void hash2;
