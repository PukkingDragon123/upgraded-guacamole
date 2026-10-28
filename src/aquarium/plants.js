// Procedural aquarium plants with pre-rendered sway frames.
// plantFrames(kind, heightPx, seed) -> {frames: [canvas], ox, oy} (ox, oy = root point); cached.
// Kinds: vallis (tall ribbon grass), rotala (red-tipped stems), fern (java fern), hairgrass (carpet tuft),
//        cabomba (feathery whorls), sword (amazon sword rosette).

import { PixelBuffer, selOut } from '../gfx/pixel.js';
import { pack, mix } from '../core/color.js';
import { ramp7 } from '../gfx/voxel.js';
import { RNG } from '../core/rng.js';
import { clamp, TAU, bayer } from '../core/math.js';

export const SWAY_FRAMES = 12;
export const PLANT_KINDS = ['vallis', 'rotala', 'fern', 'hairgrass', 'cabomba', 'sword'];

const GREEN = ramp7('#3f9a46', 1.1), LIME = ramp7('#7cc44a', 1.05), DEEP = ramp7('#2a6e4a', 1.1);
const RED = ramp7('#d2504a', 1), PINK = ramp7('#e87a8a', 0.9), OLIVE = ramp7('#6a8a3a', 1);
const pk = new Map();
const P = (h) => { let v = pk.get(h); if (v === undefined) pk.set(h, (v = pack(h))); return v; };

// Sway offset for a point at height fraction t (0 root .. 1 tip).
const sway = (ph, t, amp, k = 0) => Math.sin(ph * TAU + t * 1.7 + k) * amp * Math.pow(t, 1.5);

function blade(b, x0, y0, h, w, bend, ph, amp, k, R, cx) {
  // ribbon: centre line curves; width tapers; left edge lit, right edge shaded
  const n = Math.ceil(h);
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = x0 + bend * t * t * h + sway(ph, t, amp, k) + cx;
    const y = y0 - t * h;
    const ww = Math.max(1, w * (1 - t * 0.55));
    for (let j = 0; j < ww; j++) {
      const u = ww <= 1 ? 0.5 : j / (ww - 1);
      let tone = 2.6 + t * 1.1 + (u < 0.3 ? 0.9 : u > 0.72 ? -0.9 : 0) - (t < 0.1 ? 0.8 : 0);
      tone += (bayer(Math.round(x), Math.round(y)) - 0.5) * 0.6;
      b.set(Math.round(x - ww / 2 + j), Math.round(y), P(R[clamp(Math.round(tone), 0, 6)]));
    }
  }
}

function leaf(b, cx, cy, ang, len, wid, R, tone = 3) {
  // lanceolate leaf: darker at the base, lit upper half, pale midrib, slanted side veins, bright rim
  const ca = Math.cos(ang), sa = Math.sin(ang);
  const up = sa < 0 ? 1 : -1;
  for (let i = 0; i <= len * 2; i++) {
    const t = i / (len * 2);
    const half = Math.sin(Math.pow(t, 0.8) * Math.PI) * wid;
    for (let j = -half; j <= half; j += 0.5) {
      const x = cx + ca * t * len - sa * j, y = cy + sa * t * len + ca * j;
      const side = j * up < 0 ? 1 : -1;
      let tn = tone - 0.9 + t * 1.3 + side * 0.55;
      const aj = Math.abs(j);
      if (aj < 0.55 && t < 0.92) tn += 1.2;
      else if (wid > 2.5 && Math.abs(((t * len - aj * 0.9) / 3.2) % 1) < 0.16) tn -= 0.8;
      else if (aj > half - 0.7) tn += side > 0 ? 0.9 : -0.4;
      tn += (bayer(Math.round(x), Math.round(y)) - 0.5) * 0.5;
      b.set(Math.round(x), Math.round(y), P(R[clamp(Math.round(tn), 0, 6)]));
    }
  }
}

function build(kind, H, seed, ph) {
  const rng = new RNG(seed);
  const amp = Math.max(1, H * 0.05);
  const Wd = Math.ceil(H * (kind === 'fern' || kind === 'sword' ? 1.1 : kind === 'hairgrass' ? 1.3 : 0.7) + amp * 2 + 8);
  const Hd = Math.ceil(H + 6);
  const b = new PixelBuffer(Wd, Hd);
  const ox = Math.floor(Wd / 2), oy = Hd - 2;
  if (kind === 'vallis') {
    const n = 4 + rng.int(0, 4);
    for (let i = 0; i < n; i++) {
      const hh = H * rng.float(0.6, 1);
      blade(b, ox + rng.float(-H * 0.06, H * 0.06), oy, hh, Math.max(2, H * 0.035), rng.float(-0.25, 0.25), ph, amp, rng.float(0, TAU), i % 3 === 0 ? LIME : GREEN, 0);
    }
  } else if (kind === 'hairgrass') {
    const n = 10 + rng.int(0, 8);
    for (let i = 0; i < n; i++) {
      const hh = H * rng.float(0.45, 1);
      const x0 = ox + rng.float(-H * 0.45, H * 0.45);
      blade(b, x0, oy, hh, 1, rng.float(-0.35, 0.35), ph, amp * 0.6, rng.float(0, TAU), rng.chance(0.4) ? LIME : GREEN, 0);
    }
  } else if (kind === 'rotala' || kind === 'cabomba') {
    const stems = 2 + rng.int(0, 3);
    for (let s = 0; s < stems; s++) {
      const hh = H * rng.float(0.65, 1), x0 = ox + rng.float(-H * 0.12, H * 0.12), k = rng.float(0, TAU), bend = rng.float(-0.12, 0.12);
      const n = Math.ceil(hh);
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const x = x0 + bend * t * t * hh + sway(ph, t, amp, k), y = oy - t * hh;
        b.set(Math.round(x), Math.round(y), P((kind === 'rotala' ? (t > 0.6 ? RED : OLIVE) : DEEP)[2]));
        const gap = Math.max(3, Math.round(H * 0.06));
        if (i % gap === 0 && i > 2) {
          if (kind === 'rotala') {
            const R = t > 0.7 ? (t > 0.88 ? PINK : RED) : t > 0.5 ? OLIVE : GREEN;
            const ll = Math.max(2, H * 0.07 * (1 - t * 0.3));
            leaf(b, x, y, -0.35, ll, Math.max(0.8, ll * 0.32), R);
            leaf(b, x, y, Math.PI + 0.35, ll, Math.max(0.8, ll * 0.32), R, 2);
          } else {
            // feathery whorl: radiating fine lines
            const rr = Math.max(2, H * 0.09 * (1 - t * 0.35));
            for (let a = 0; a < 7; a++) {
              const ang = Math.PI + (a / 6) * Math.PI;
              for (let q = 1; q <= rr; q++) b.set(Math.round(x + Math.cos(ang) * q), Math.round(y + Math.sin(ang) * q * 0.5), P((q > rr * 0.6 ? LIME : GREEN)[3 + (a % 2)]));
            }
          }
        }
      }
    }
  } else if (kind === 'fern' || kind === 'sword') {
    const n = kind === 'fern' ? 5 + rng.int(0, 3) : 7 + rng.int(0, 4);
    const R = kind === 'fern' ? DEEP : GREEN;
    for (let i = 0; i < n; i++) {
      const spread = (i / (n - 1) - 0.5) * (kind === 'fern' ? 1.9 : 2.3);
      const ang = -Math.PI / 2 + spread + rng.float(-0.12, 0.12);
      const len = H * rng.float(0.65, 1) * (kind === 'sword' ? 1 - Math.abs(spread) * 0.25 : 1);
      const tip = sway(ph, 1, amp * 0.7, i);
      leaf(b, ox, oy, ang + tip * 0.02, len, Math.max(1.2, len * (kind === 'fern' ? 0.16 : 0.13)), i % 2 ? R : LIME, 3);
    }
  }
  b.outline(selOut(0.7));
  return { canvas: b.toCanvas(), ox, oy };
}

const cache = new Map();
export function plantFrames(kind, H, seed) {
  H = Math.max(6, Math.round(H));
  const key = kind + '|' + H + '|' + seed;
  let p = cache.get(key);
  if (p) return p;
  const frames = [];
  let ox = 0, oy = 0;
  for (let f = 0; f < SWAY_FRAMES; f++) {
    const r = build(kind, H, seed, f / SWAY_FRAMES);
    frames.push(r.canvas); ox = r.ox; oy = r.oy;
  }
  p = { frames, ox, oy };
  cache.set(key, p);
  return p;
}

void mix;
