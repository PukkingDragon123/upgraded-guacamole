// Frosty Fjord (60 m): icy turquoise water in a glacier-carved canyon. Above the surface: steep granite walls,
// snow peaks, a calving glacier, drifting ice floes with penguins and a seal, a low polar sun or the aurora.
// Underwater: a perspective voxel fjord (granite + blue-ice cliffs at several depths, glacial silt, dropstones),
// a frozen shipwreck, ice crystal clusters, kelp under the ice, plumose anemones, iceberg keels in the far fog,
// diving penguin flocks, seal and beluga silhouettes, slush snow and sparkling ice motes.
// Weathers: clear, snowfall, blizzard, aurora. Secrets: the iced-in chest (crack it), the penguin's gift,
// the singing crystals (strike them smallest to largest).
//
// Also exports small shared helpers (world-space water strips, cached voxel sprites, voxel modelling bits)
// used by the volcano and metropolis biomes.

import { Biome, worldTop } from './base.js';
import { clamp, clamp01, lerp, smoothstep, ease, hash2, fbm2, TAU } from '../../core/math.js';
import { RNG } from '../../core/rng.js';
import { mix, rgba, pack } from '../../core/color.js';
import { makeCanvas, ctxOf, makeLayer, tinted } from '../../core/canvas.js';
import { flipCanvas } from '../../gfx/pixel.js';
import { VoxelModel, renderVoxels } from '../../gfx/voxel.js';
import { getProp, noise3, fbm3 } from '../../gfx/props.js';
import {
  paint, dpack, lerpStops, stopPalette, ditherPick, Blend, FogLayer, fillWith, drawWobble, makeRays, drawGlow, twinkle,
  Caustics, lumaMask, waveLine, waveRuns, Strands, Motes, Bubbles, Mask, ridge, todWeights, quality, inRect, bladeSprites,
  SwayAnim, streakTile, cloudTile, DepthScene, BandSet, DepthDecor, qscale, hazeMask,
} from '../scenery.js';

// ====================================================================== shared helpers

export const qmix = (a, b, t) => mix(a, b, Math.round(clamp01(t) * 32) / 32);
export const tri = (a, b, c, w) => qmix(qmix(a, b, w.dusk / Math.max(0.001, w.day + w.dusk)), c, w.night);

// Vertical gradient strip covering world y in [top, H): rows 0..H-1 hold y = row, the rows below hold the
// negative world y (row - S). Used as a screen-aligned repeating pattern it paints the right colour above the
// default view too (the camera scrolls up to the surface). tOf(y) -> 0..1 along the stops.
export function worldStrip(H, top, stops, tOf, levels = 24, w = 8) {
  const S = H - top;
  const pal = stopPalette(stops, levels);
  return paint(w, S, (x, row) => ditherPick(pal, tOf(row < H ? row : row - S), x, row));
}

// Colour (hex) of a world strip at world y.
export function stripColorAt(stops, t) {
  const c = lerpStops(stops, clamp01(t));
  return '#' + c.map((v) => clamp(Math.round(v / 4) * 4, 0, 255).toString(16).padStart(2, '0')).join('');
}

// Generic implicit voxel shape over a box.
export function vshape(m, x0, y0, z0, x1, y1, z1, test, c) {
  for (let y = Math.floor(y0); y <= Math.ceil(y1); y++) for (let z = Math.floor(z0); z <= Math.ceil(z1); z++) for (let x = Math.floor(x0); x <= Math.ceil(x1); x++) {
    if (test(x + 0.5, y + 0.5, z + 0.5)) m.put(x, y, z, c);
  }
}

// Noise-displaced ellipsoid (rocks, lumps), optionally flat at the bottom.
export function vblob(m, cx, cy, cz, rx, ry, rz, amp, freq, seed, c, flat = -Infinity) {
  const e = 1 + amp;
  vshape(m, cx - rx * e, Math.max(flat, cy - ry * e), cz - rz * e, cx + rx * e, cy + ry * e, cz + rz * e, (x, y, z) => {
    if (y < flat) return false;
    const dx = (x - cx) / rx, dy = (y - cy) / ry, dz = (z - cz) / rz;
    const d = dx * dx + dy * dy + dz * dz;
    if (d > e * e) return false;
    return Math.sqrt(d) <= 1 + (fbm3(x * freq, y * freq, z * freq, 2, seed) - 0.5) * amp * 2;
  }, c);
}

// Polygonal prism (crystal / basalt column) from p0 along dir with a pointed or flat tip.
export function vprism(m, p0, dir, len, r, tip, c, sides = 6, rot = 0) {
  const dl = Math.hypot(...dir);
  const d = dir.map((v) => v / dl);
  const up = Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  let a = [d[1] * up[2] - d[2] * up[1], d[2] * up[0] - d[0] * up[2], d[0] * up[1] - d[1] * up[0]];
  const al = Math.hypot(...a); a = a.map((v) => v / al);
  const b = [d[1] * a[2] - d[2] * a[1], d[2] * a[0] - d[0] * a[2], d[0] * a[1] - d[1] * a[0]];
  const L = len + tip, R = r + 1;
  const ends = [p0, [p0[0] + d[0] * L, p0[1] + d[1] * L, p0[2] + d[2] * L]];
  const lo = [0, 1, 2].map((k) => Math.min(ends[0][k], ends[1][k]) - R), hi = [0, 1, 2].map((k) => Math.max(ends[0][k], ends[1][k]) + R);
  const seg = TAU / sides, cosH = Math.cos(seg / 2);
  vshape(m, lo[0], lo[1], lo[2], hi[0], hi[1], hi[2], (x, y, z) => {
    const px = x - p0[0], py = y - p0[1], pz = z - p0[2];
    const t = px * d[0] + py * d[1] + pz * d[2];
    if (t < 0 || t > L) return false;
    const u = px * a[0] + py * a[1] + pz * a[2], v = px * b[0] + py * b[1] + pz * b[2];
    const ang = Math.atan2(v, u) + rot;
    const k = (((ang % seg) + seg) % seg) - seg / 2;
    const rr = r * (t > len ? 1 - (t - len) / Math.max(0.01, tip) : 1);
    return Math.hypot(u, v) * Math.cos(k) / cosH <= rr;
  }, c);
}

// Cached voxel sprite: build() -> {m, yaw?, pitch?, vs?, lights?: [{at, r, color}], light?, track?, screens?}.
const MODELS = new Map(), SPRITES = new Map();
export function voxSprite(key, build, { scale = 1, yaw = 30, pitch = 27, vs = 1.75 } = {}) {
  const sk = key + '|' + scale;
  let p = SPRITES.get(sk);
  if (p) return p;
  let res = MODELS.get(key);
  if (!res) { res = build(); MODELS.set(key, res); }
  const r = renderVoxels(res.m, { scale: (res.vs ?? vs) * scale, yaw: res.yaw ?? yaw, pitch: res.pitch ?? pitch, outline: true, track: res.track || res.screens || [], ...(res.render || {}) });
  const lights = [];
  if (res.lights) for (const l of res.lights) { const [x, y] = r.project(...l.at); lights.push({ x: Math.round(x), y: Math.round(y), r: Math.round(l.r * scale), color: l.color }); }
  else {
    for (const [k, reg] of Object.entries(r.regions)) {
      const pe = res.m.palette[k];
      if (!pe.emissive || reg.n < 6) continue;
      lights.push({ x: Math.round(reg.cx), y: Math.round(reg.cy), r: Math.round(Math.max(reg.w, reg.h) * 0.7 + 10 * scale), color: res.light || pe.color });
    }
  }
  const screens = (res.screens || []).map((k) => r.regions[k]?.inner).filter((q) => q && q.w > 0);
  const anchors = {};
  for (const [k, a] of Object.entries(res.anchors || {})) { const [x, y] = r.project(...a); anchors[k] = { x: Math.round(x), y: Math.round(y) }; }
  let ox = r.ox, oy = r.oy;
  if (res.ground) { const [gx, gy] = r.project(...res.ground); ox = Math.round(gx); oy = Math.round(gy); }
  p = { canvas: r.canvas, glow: r.glow, ox, oy, w: r.w, h: r.h, lights, screens, anchors, regions: r.regions };
  SPRITES.set(sk, p);
  return p;
}

// Place a voxel sprite (or a getProp id) into a DepthScene at (x fraction, z) with perspective scale.
export function placeSprite(D, W, sprite, xf, z, extra = {}) {
  const it = D.add({ sprite, x: Math.round(xf * W), z, ...extra });
  it.p = sprite; it.left = it.x - sprite.ox; it.top = it.y - sprite.oy; it.s = D.s(z);
  return it;
}

// Pixel run helper for small sprites drawn with fillRect.
export function px(g, x, y, w, h, c) { g.fillStyle = c; g.fillRect(x, y, w, h); }

// How much of the view sits above y = 0 (0 default view .. 1 fully scrolled up).
export function skyward(env, H) {
  const v = env?.view;
  return v ? clamp01(-v.y0 / (H * 0.62)) : 0;
}

// ====================================================================== fjord palettes

const SKY = {
  day: [[0, '#3a74c8'], [0.45, '#6aa8e2'], [0.82, '#b8e0f8'], [1, '#e6f8ff']],
  dusk: [[0, '#1c2256'], [0.35, '#45387a'], [0.62, '#a8568a'], [0.84, '#ee8c78'], [1, '#ffd49c']],
  night: [[0, '#01030c'], [0.55, '#06102a'], [1, '#13284e']],
};
const OVERCAST = {
  day: [[0, '#8a98aa'], [1, '#d4dde6']],
  dusk: [[0, '#463a56'], [1, '#a88890']],
  night: [[0, '#05070e'], [1, '#18202e']],
};
const WATER = {
  day: [[0, '#bff8f2'], [0.05, '#86e8e6'], [0.26, '#42bcd2'], [0.58, '#2488b6'], [1, '#165c90']],
  dusk: [[0, '#f2c8b8'], [0.04, '#a4c0cc'], [0.14, '#5094b8'], [0.5, '#2e6098'], [1, '#1a3a6c']],
  night: [[0, '#5aa8c4'], [0.1, '#2e7aa0'], [0.5, '#1c5282'], [1, '#103262']],
};
// mountain material palettes: far range, rock, snow, glacier ice (dark -> light)
const MT = {
  day: { far: ['#7e9cc4', '#9ab6d8', '#c2d8ee', '#e4f0fa'], rock: ['#28324a', '#3c4862', '#56637e', '#7a88a2'], snow: ['#8aa4cc', '#b4cae6', '#dcebfa', '#ffffff'], ice: ['#2a86b4', '#46aed4', '#86dcee', '#d0f8ff'] },
  dusk: { far: ['#5a4a7a', '#7e5c88', '#b87a92', '#eaa49c'], rock: ['#1e1834', '#2e2446', '#463460', '#664a78'], snow: ['#76629a', '#b47ea4', '#f2a8a0', '#ffd8bc'], ice: ['#3a4a8a', '#5a64a8', '#c08ab0', '#ffc8c0'] },
  night: { far: ['#0c1430', '#13203e', '#1c2e52', '#2a4068'], rock: ['#04070f', '#080d1c', '#0f172c', '#18223c'], snow: ['#1e2c4e', '#304670', '#4a6496', '#7690c4'], ice: ['#0c2442', '#14385c', '#22567e', '#3a78a2'] },
};
const STRATA = [[104, 116, 140], [88, 100, 124], [118, 128, 150], [96, 104, 130], [80, 90, 114]];
const NEON_ICE = '#9ff4ff';

// ====================================================================== small sprites

function penguinFrames() {
  // 0 stand, 1-2 waddle, 3 flap, 4 swim A, 5 swim B (horizontal), 6 belly-slide
  const K = '#141824', K2 = '#262c3c', Wt = '#f4f6fa', Wb = '#c8cede', O = '#ff9a2a', O2 = '#d8641a', E = '#ffffff';
  const frames = [];
  const stand = (g, lean, wing, foot) => {
    px(g, 3, 2, 4, 3, K); px(g, 2, 4, 6, 7, K); px(g, 3, 11, 4, 1, K);
    px(g, 4, 5, 3, 6, Wt); px(g, 6, 5, 1, 5, Wb); px(g, 4, 3, 2, 1, Wt);
    px(g, 5, 3, 1, 1, '#000000'); px(g, 4, 3, 1, 1, E);
    px(g, 7, 3, 2, 1, O); px(g, 7, 4, 1, 1, O2);
    px(g, 1 + lean, 5 + wing, 1, 4, K2); px(g, 8 - lean, 5 - wing + 1, 1, 3, K2);
    px(g, 3 + foot, 12, 2, 1, O); px(g, 6 - foot, 12, 2, 1, O);
  };
  for (const [lean, wing, foot] of [[0, 0, 0], [0, 0, 1], [0, 0, -1], [0, -2, 0]]) {
    const c = makeCanvas(11, 13); stand(ctxOf(c), lean, wing, foot); frames.push(c);
  }
  for (const f of [0, 1]) {
    const c = makeCanvas(15, 7), g = ctxOf(c);
    px(g, 2, 2, 10, 3, K); px(g, 1, 3, 12, 2, K); px(g, 3, 4, 8, 2, Wt); px(g, 12, 3, 2, 1, O);
    px(g, 10, 2, 1, 1, E); px(g, 0, 3 - f, 2, 1, K2); px(g, 6, f ? 1 : 5, 3, 1, K2);
    frames.push(c);
  }
  { const c = makeCanvas(15, 7), g = ctxOf(c); px(g, 2, 3, 10, 3, K); px(g, 3, 5, 8, 1, Wt); px(g, 12, 3, 2, 1, O); px(g, 10, 3, 1, 1, E); px(g, 0, 4, 2, 1, O); frames.push(c); }
  return frames;
}

function sealFrames() {
  const out = [];
  for (const lift of [0, 1, 2]) {
    const c = makeCanvas(30, 12), g = ctxOf(c);
    const B = '#5a6474', B2 = '#7a8698', B3 = '#3e4656', S = '#a8b2c2';
    px(g, 6, 6, 18, 5, B); px(g, 8, 5, 14, 1, B2); px(g, 9, 7, 8, 1, S);
    px(g, 2, 8, 5, 2, B3); px(g, 0, 7, 3, 1, B3); px(g, 0, 10, 3, 1, B3);
    const hy = 4 - lift;
    px(g, 22, hy + 1, 6, 5, B); px(g, 23, hy, 4, 1, B2); px(g, 27, hy + 3, 2, 2, B2);
    px(g, 25, hy + 2, 1, 1, '#0a0c12'); px(g, 28, hy + 3, 1, 1, '#0a0c12'); px(g, 26, hy + 4, 3, 1, '#c8ccd4');
    px(g, 14, 10, 4, 1, B3);
    for (let i = 0; i < 4; i++) px(g, 10 + i * 3, 6 + (i % 2), 1, 1, B3);
    out.push(c);
  }
  return out;
}

// Side silhouettes (white masks, tinted at draw time) for the far fog.
function belugaFrames(L = 120) {
  const H = Math.round(L * 0.3), frames = [];
  for (let f = 0; f < 8; f++) {
    const ph = (f / 8) * TAU;
    const m = new Mask(L + 20, H + 24);
    const cy = H * 0.55 + 8;
    for (let x = 0; x < L; x++) {
      const u = x / L;
      const th = H * (0.18 + smoothstep(0.02, 0.4, u) * 0.75) * (1 - smoothstep(0.82, 1.02, u) * 0.3);
      const dy = Math.sin(ph - u * 3) * Math.pow(clamp01(0.5 - u), 1.5) * 16;
      const melon = u > 0.84 ? (u - 0.84) * H * 0.9 : 0;
      for (let y = Math.round(cy - th * 0.5 + dy - melon); y < Math.round(cy + th * 0.5 + dy); y++) m.set(x + 10, y, 1);
    }
    const fy = cy + Math.sin(ph) * 0.5 * 16 * Math.pow(0.5, 1.5);
    const fa = Math.cos(ph) * 0.4;
    m.poly([[12, fy - 1], [2, fy - 10 - fa * 12], [8, fy], [2, fy + 9 - fa * 12], [12, fy + 1]]);
    m.poly([[L * 0.72 + 10, cy + H * 0.2], [L * 0.62 + 10, cy + H * 0.55 + Math.sin(ph + 1) * 3], [L * 0.66 + 10, cy + H * 0.2]]);
    frames.push(m.toCanvas(() => pack('#ffffff')));
  }
  return frames;
}

function sealSwimFrames(L = 60) {
  const H = Math.round(L * 0.32), frames = [];
  for (let f = 0; f < 8; f++) {
    const ph = (f / 8) * TAU;
    const m = new Mask(L + 16, H + 16);
    const cy = H * 0.5 + 6;
    for (let x = 0; x < L; x++) {
      const u = x / L;
      const th = H * (0.15 + Math.sin(Math.PI * Math.pow(clamp01(u * 1.05), 0.8)) * 0.8);
      const dy = Math.sin(ph - u * 4) * (1 - u) * 3;
      for (let y = Math.round(cy - th * 0.5 + dy); y < Math.round(cy + th * 0.5 + dy); y++) m.set(x + 8, y, 1);
    }
    const s = Math.sin(ph) * 5;
    m.poly([[9, cy - 1], [0, cy - 6 + s], [3, cy + s * 0.3], [0, cy + 6 + s], [9, cy + 1]]);
    m.poly([[L * 0.7 + 8, cy + 2], [L * 0.55 + 8, cy + H * 0.6 + Math.sin(ph + 2) * 3], [L * 0.62 + 8, cy + 1]]);
    frames.push(m.toCanvas(() => pack('#ffffff')));
  }
  return frames;
}

// ====================================================================== voxel models

const ICE = ['#cdf6ff', '#a6e8fa', '#e8fdff', '#7ccfe8'];

function crystalModel(seed, big = 1, tint = 0) {
  const r = new RNG(seed);
  const m = new VoxelModel(Math.round(44 * big) + 6, Math.round(62 * big) + 6, Math.round(38 * big) + 6);
  const rock = [m.color('#56627a', { jitter: 0.14, smooth: 0.55 }), m.color('#6a7690', { jitter: 0.12, smooth: 0.55 }), m.color('#e8f2fa', { jitter: 0.06, smooth: 0.5 })];
  const hues = [['#bff2ff', '#e6fdff', '#8ad6f0'], ['#c8e6ff', '#f0f8ff', '#94b8f0'], ['#c0fff0', '#eafff8', '#86e0cc']][tint % 3];
  const cA = m.color(hues[0], { emissive: 0.18, jitter: 0.05, smooth: 0.25, spec: 1.2 });
  const cB = m.color(hues[1], { emissive: 0.45, jitter: 0.03, smooth: 0.25 });
  const cC = m.color(hues[2], { emissive: 0.12, jitter: 0.05, smooth: 0.25 });
  const cx = m.nx / 2, cz = m.nz / 2;
  vblob(m, cx, 2, cz, 15 * big, 6 * big, 12 * big, 0.3, 0.16, seed, rock[0], 0);
  vblob(m, cx + 9 * big, 2, cz + 3, 6 * big, 4 * big, 5 * big, 0.3, 0.2, seed + 3, rock[1], 0);
  m.recolor((x, y, z, p) => (p !== cA && m.exposed(x, y, z) && !m.get(x, y + 1, z) && hash2(x * 3 + z, y, seed) < 0.7 ? rock[2] : null));
  const sh = [[0, 1, 0, 46, 5], [-0.45, 1, 0.1, 32, 3.8], [0.5, 1, -0.15, 34, 4], [0.2, 1, 0.55, 22, 3.2], [-0.35, 1, -0.5, 24, 3.2], [-0.9, 0.55, 0.3, 14, 2.4], [0.9, 0.6, 0.35, 13, 2.2]];
  sh.forEach(([dx, dy, dz, len, rr], i) => {
    const p0 = [cx + dx * 5 * big + r.float(-1, 1), 3, cz + dz * 5 * big + r.float(-1, 1)];
    vprism(m, p0, [dx, dy, dz], len * big * r.float(0.85, 1.05), rr * big, rr * big * 1.6, i % 3 === 2 ? cC : cA, 6, r.float(0, 1));
  });
  m.recolor((x, y, z, p) => ((p === cA || p === cC) && !m.get(x - 1, y, z) && !m.get(x, y, z + 1) ? cB : null));
  return { m, yaw: 28, light: '#9af0ff' };
}

function boulderModel(seed, big = 1) {
  const m = new VoxelModel(Math.round(46 * big), Math.round(32 * big), Math.round(36 * big));
  const g = [m.color('#5c6680', { jitter: 0.14, smooth: 0.7 }), m.color('#717b94', { jitter: 0.14, smooth: 0.7 }), m.color('#8a92a8', { jitter: 0.12, smooth: 0.7 })];
  const snow = [m.color('#e6f2fa', { jitter: 0.06, smooth: 0.8 }), m.color('#bcd8ec', { jitter: 0.06, smooth: 0.8 })];
  const lich = m.color('#c87a8a', { jitter: 0.1, smooth: 0.6 });
  vblob(m, m.nx / 2, 9 * big, m.nz / 2, 18 * big, 12 * big, 14 * big, 0.28, 0.1, seed, g[0], 0);
  vblob(m, m.nx * 0.72, 5 * big, m.nz * 0.6, 8 * big, 6 * big, 7 * big, 0.3, 0.14, seed + 7, g[1], 0);
  m.recolor((x, y, z, p) => {
    if (!m.exposed(x, y, z)) return null;
    const n = fbm3(x * 0.12, y * 0.12, z * 0.12, 2, seed + 1);
    if (!m.get(x, y + 1, z) && n > 0.42) return n > 0.62 ? snow[0] : snow[1];
    if (n < 0.3 && hash2(x + z * 7, y, seed) < 0.5) return lich;
    return n > 0.55 ? g[2] : n < 0.4 ? g[1] : null;
  });
  return { m, yaw: 30 };
}

function softCoralModel(seed) {
  const r = new RNG(seed);
  const m = new VoxelModel(30, 30, 26);
  const c = [m.color('#e2486a', { jitter: 0.1, smooth: 0.6 }), m.color('#ff7a92', { jitter: 0.08, smooth: 0.6 }), m.color('#ffc0c8', { jitter: 0.06, smooth: 0.6 })];
  const stalk = m.color('#f0c8b8', { smooth: 0.5 });
  for (let i = 0; i < 6; i++) {
    const a = r.float(0, TAU), rr = r.float(0, 6);
    const bx = 15 + Math.cos(a) * rr, bz = 13 + Math.sin(a) * rr * 0.8, hgt = r.float(8, 18);
    m.line(bx, 0, bz, bx + r.float(-2, 2), hgt, bz + r.float(-2, 2), stalk, 1.4);
    for (let k = 0; k < 5; k++) vblob(m, bx + r.float(-3, 3), hgt * r.float(0.5, 1.05), bz + r.float(-3, 3), r.float(2.5, 4), r.float(2.5, 4), r.float(2.5, 4), 0.35, 0.4, seed + i * 9 + k, c[k % 2]);
  }
  m.recolor((x, y, z, p) => ((p === c[0] || p === c[1]) && !m.get(x, y + 1, z) && hash2(x, z, y) < 0.35 ? c[2] : null));
  return { m, yaw: 24 };
}

function iceArchModel() {
  const m = new VoxelModel(120, 70, 34);
  const ic = [m.color('#7ccfe8', { jitter: 0.06, smooth: 0.6 }), m.color('#a6e8fa', { jitter: 0.05, smooth: 0.6 }), m.color('#e8fdff', { jitter: 0.04, smooth: 0.6 }), m.color('#4aa8d0', { jitter: 0.06, smooth: 0.6 })];
  vshape(m, 0, 0, 0, 119, 69, 33, (x, y, z) => {
    const dx = (x - 60) / 50, dy = y / 62;
    const rr = Math.hypot(dx, dy);
    const th = 0.2 + fbm2(x * 0.06, y * 0.06, 2, 4) * 0.12;
    const dz = Math.abs(z - 17) / 15;
    return rr < 1 && rr > 1 - th && dz < 1 - (fbm2(x * 0.1, y * 0.1, 2, 9) - 0.5) * 0.4;
  }, ic[1]);
  m.recolor((x, y, z, p) => {
    if (!m.exposed(x, y, z)) return null;
    if (!m.get(x, y + 1, z)) return ic[2];
    const n = fbm3(x * 0.1, y * 0.2, z * 0.1, 2, 31);
    return n < 0.4 ? ic[3] : n < 0.5 ? ic[0] : null;
  });
  return { m, yaw: 18 };
}

// The frozen wreck: a tilted old schooner rimed with ice, icicles under every edge, a split hull, broken mast.
function shipModel() {
  const m = new VoxelModel(116, 82, 46);
  const wood = [m.color('#5a3a2a', { jitter: 0.12 }), m.color('#6e4a34', { jitter: 0.12 }), m.color('#82593c', { jitter: 0.12 }), m.color('#3a2620', { jitter: 0.08 })];
  const frost = [m.color('#e6f4fc', { jitter: 0.06, smooth: 0.5 }), m.color('#b8dcf0', { jitter: 0.06, smooth: 0.5 }), m.color('#ffffff', { jitter: 0.04, smooth: 0.5 })];
  const ice = [m.color('#9adcf0', { jitter: 0.05, smooth: 0.4, emissive: 0.08 }), m.color('#d4f6ff', { jitter: 0.04, smooth: 0.4, emissive: 0.15 })];
  const iron = m.color('#4a4e60', { jitter: 0.1 }), dark = m.color('#160e14', { jitter: 0 });
  const tilt = 0.2, roll = 0.12;
  const keelY = (x) => 10 + (x - 58) * tilt;
  const L0 = 10, L1 = 106;
  // hull: per-row half-width, rounded bilge, planking rows
  vshape(m, 0, 0, 0, 115, 70, 45, (x, y, z) => {
    if (x < L0 || x > L1) return false;
    const u = (x - L0) / (L1 - L0);
    const hw = 14 * Math.pow(Math.sin(Math.PI * Math.min(1, u * 1.02 + 0.06)), 0.55) * (u > 0.85 ? 1 - (u - 0.85) * 2.4 : 1);
    const yk = keelY(x) + (z - 23) * roll, depth = 21;
    const k = (y - yk) / depth;
    if (k < 0 || k > 1) return false;
    const w = hw * (0.3 + 0.7 * Math.pow(k, 0.45));
    return Math.abs(z - 23) <= w && Math.abs(z - 23) >= w - 1.6 || (k < 0.12 && Math.abs(z - 23) <= w);
  }, (x, y, z) => wood[Math.floor((y - keelY(x)) / 3) % 2 ? 1 : 2]);
  // deck planks
  vshape(m, L0 + 2, 0, 0, L1 - 4, 70, 45, (x, y, z) => {
    const u = (x - L0) / (L1 - L0);
    const hw = 14 * Math.pow(Math.sin(Math.PI * Math.min(1, u * 1.02 + 0.06)), 0.55) - 1.2;
    const yd = keelY(x) + 20 + (z - 23) * roll;
    return Math.abs(y - yd) < 0.6 && Math.abs(z - 23) < hw;
  }, (x) => (Math.floor(x / 4) % 2 ? wood[0] : wood[1]));
  // stern cabin
  vshape(m, 14, 0, 12, 30, 80, 34, (x, y, z) => {
    const yd = keelY(x) + 20 + (z - 23) * roll;
    return y > yd && y < yd + 9 && Math.abs(z - 23) < 9 && x > 15 && x < 30;
  }, wood[2]);
  m.sub(() => { for (let k = 0; k < 3; k++) m.box(17 + k * 4, keelY(18) + 24, 31, 18 + k * 4, keelY(18) + 26, 34, 1); });
  // broken mast + yard
  const mx = 62, my = keelY(mx) + 20;
  m.line(mx, my, 23, mx + 4, my + 40, 23, wood[3], 2.2);
  m.line(mx + 4, my + 40, 23, mx + 6, my + 44, 22, wood[3], 1.6);
  m.line(mx - 15, my + 30, 23, mx + 19, my + 34, 23, wood[0], 1.1);
  m.line(mx + 26, my + 1, 23, mx + 30, my + 22, 23, wood[3], 1.6); // second mast stump
  // bowsprit
  m.line(L1 - 6, keelY(L1) + 19, 23, L1 + 8, keelY(L1) + 26, 23, wood[3], 1.2);
  // split in the hull
  m.sub(() => vshape(m, 70, 0, 26, 82, 80, 45, (x, y) => Math.abs(x - 76 - (y - keelY(76)) * 0.25) < 2.2 + fbm2(x * 0.3, y * 0.3, 2, 3) * 2 && y < keelY(76) + 18, 1));
  m.under(() => vshape(m, 68, 0, 30, 84, 80, 38, (x, y, z) => Math.abs(x - 76 - (y - keelY(76)) * 0.25) < 2 && y < keelY(76) + 17 && z > 31 && z < 36, dark));
  // portholes
  for (const hx of [40, 50, 88]) { const hy = keelY(hx) + 14; m.box(hx, hy, 36, hx + 1, hy + 1, 40, iron); m.sub(() => m.box(hx, hy, 38, hx + 1, hy + 1, 45, 1)); }
  // ice chunks heaped against the bow and stern
  for (const [bx, bz, s] of [[100, 32, 7], [92, 36, 5], [16, 34, 6], [24, 38, 4], [56, 40, 5]]) vblob(m, bx, keelY(bx) + 3, bz, s * 1.4, s, s, 0.35, 0.22, bx, ice[0], keelY(bx) - 1);
  // frost on everything facing up, rime patches on the sides
  m.recolor((x, y, z, p) => {
    if (p === ice[0] || p === ice[1] || p === dark) return null;
    if (!m.exposed(x, y, z)) return null;
    if (!m.get(x, y + 1, z)) return hash2(x, z, 5) < 0.85 ? frost[0] : frost[2];
    const n = fbm3(x * 0.15, y * 0.15, z * 0.15, 2, 7);
    return n > 0.6 ? frost[1] : null;
  });
  m.recolor((x, y, z, p) => (p === ice[0] && !m.get(x, y + 1, z) ? ice[1] : null));
  // icicles hanging from overhangs
  const cand = [];
  for (let z = 0; z < m.nz; z++) for (let y = 4; y < m.ny; y++) for (let x = 0; x < m.nx; x++) {
    const v = m.get(x, y, z);
    if (v && v !== ice[0] && !m.get(x, y - 1, z) && !m.get(x, y - 2, z) && (z > 33 || hash2(x, z, 3) < 0.2)) cand.push([x, y, z]);
  }
  const r = new RNG(44);
  for (let i = 0; i < 70 && cand.length; i++) {
    const [x, y, z] = cand[r.int(0, cand.length - 1)];
    const len = r.int(2, 7);
    for (let k = 1; k <= len; k++) if (!m.get(x, y - k, z)) m.set(x, y - k, z, k > len - 2 ? ice[1] : ice[0]);
  }
  // silt drift around the keel
  const silt = [m.color('#a6aeb4', { jitter: 0.1, smooth: 0.8 }), m.color('#bcc4c8', { jitter: 0.1, smooth: 0.8 })];
  m.under(() => vshape(m, 0, 0, 0, 115, 8, 45, (x, y, z) => {
    const d = Math.hypot((x - 58) / 58, (z - 23) / 22);
    return d < 1 && y < (1 - d * d) * 6 + fbm2(x * 0.2, z * 0.2, 2, 8) * 2;
  }, (x, y, z) => (hash2(x, z, 6) < 0.15 ? frost[1] : hash2(x, z, 7) < 0.5 ? silt[0] : silt[1])));
  return { m, yaw: 22, pitch: 24 };
}

function singingCrystal(size) {
  const m = new VoxelModel(16, Math.round(14 + size * 10), 14);
  const base = m.color('#6a7690', { jitter: 0.12, smooth: 0.6 });
  const a = m.color('#bff2ff', { emissive: 0.3, jitter: 0.04, smooth: 0.2 });
  const b = m.color('#f0feff', { emissive: 0.6, jitter: 0.02, smooth: 0.2 });
  vblob(m, 8, 1, 7, 6, 2, 5, 0.3, 0.3, size * 7, base, 0);
  vprism(m, [8, 2, 7], [0.05, 1, 0.02], 6 + size * 8, 2.6 + size * 0.5, 3 + size, a, 6, size);
  m.recolor((x, y, z, p) => (p === a && !m.get(x - 1, y, z) ? b : null));
  return { m, yaw: 26 };
}

function floeModel(seed, R) {
  const m = new VoxelModel(Math.ceil(R * 2 + 4), 7, Math.ceil(R * 1.2 + 4));
  const snow = [m.color('#f4fbff', { jitter: 0.05, smooth: 0.6 }), m.color('#dcecf8', { jitter: 0.05, smooth: 0.6 })];
  const side = [m.color('#a8e4f4', { jitter: 0.05 }), m.color('#7cc8e2', { jitter: 0.05 })];
  const cx = m.nx / 2, cz = m.nz / 2;
  vshape(m, 0, 0, 0, m.nx, 5, m.nz, (x, y, z) => {
    const a = Math.atan2((z - cz) * 1.6, x - cx);
    const rr = R * (0.78 + 0.22 * noise3(Math.cos(a) * 1.8, Math.sin(a) * 1.8, 0.5, seed));
    const d = Math.hypot(x - cx, (z - cz) * 1.6);
    return d < rr - (y > 3 ? 1 : 0);
  }, (x, y, z) => (y > 3 ? (hash2(x, z, seed) < 0.15 ? snow[1] : snow[0]) : y > 1 ? side[0] : side[1]));
  return { m, yaw: 0, pitch: 34 };
}

// ====================================================================== the biome

export class FjordBiome extends Biome {
  constructor(ocean) {
    super(ocean);
    this.id = 'fjord'; this.name = 'Frosty Fjord'; this.subtitle = 'Glacier water, 60 m down'; this.music = 'fjord';
    this.weathers = [{ id: 'clear', name: 'Clear Skies', weight: 4 }, { id: 'snowfall', name: 'Snowfall', weight: 2.2 }, { id: 'blizzard', name: 'Blizzard', weight: 0.8, icon: 'cloud' }, { id: 'aurora', name: 'Aurora', weight: 1.2, icon: 'star' }];
    this.ambient = 'fjord';
    this.fogColor = '#3ab4cc';
    this.fogAmount = 0.58;
    this.t = 0;
    this.tod = { day: 1, dusk: 0, night: 0 };
    this.wx = { snow: 0, bliz: 0, aurora: 0, clear: 1 };
    this.par = { x: 0, y: 0 };
    this.cols = { crest: '#f0ffff', sub: '#a8f0f0' };
    this.fresh = true;
    this.seq = [];
    this.songT = 0;
    this.hint = 0;
  }

  baseSurface(H) { return Math.round(H * 0.1); }
  surfaceAt(env) { return Math.round(lerp(this.baseSurface(this.H), -6, ease.inOutCubic(clamp01(env?.flood || 0)))); }
  waveAt(x) { return this.ys ? this.ys[clamp(Math.round(x), 0, this.W)] : null; }
  floorAt(x, z = 0) { return this.D ? this.D.floorAt(x, z) : super.floorAt(x); }
  secrets() { return this.game?.state?.secrets || {}; }

  waterLook(env) {
    const n = this.tod.night;
    return { refract: 12, caustic: 8 + (1 - n) * 4, foamColor: '#f4ffff', causticColor: n > 0.5 ? '#1a3a44' : '#2a5a5a', crestColor: '#ffffff' };
  }

  // ------------------------------------------------------------------ build
  build(W, H) {
    this.W = W; this.H = H;
    this.top = worldTop(H);
    this.base = this.baseSurface(H);
    this.ys = new Int16Array(W + 2).fill(this.base);
    const tOf = (y) => clamp01((y - (this.base - 2)) / (H - this.base + 2));
    this.water = { day: worldStrip(H, this.top, WATER.day, tOf), dusk: worldStrip(H, this.top, WATER.dusk, tOf), night: worldStrip(H, this.top, WATER.night, tOf) };
    this.waterBlend = new Blend(); this.skyBlend = new Blend(); this.ocBlend = new Blend();
    this.buildSky();
    this.buildDepth();
    this.buildLayers();
    const rh = H - this.base;
    this.raysA = new FogLayer(makeRays(W, rh, { seed: 7, count: 8, sunX: W * 0.72, sunY: -H * 0.7, minW: 10, maxW: 30, len: 0.95, color: '#ffffff', alpha: 0.5, levels: 5 }));
    this.raysB = new FogLayer(makeRays(W, rh, { seed: 12, count: 14, sunX: W * 0.68, sunY: -H * 0.6, minW: 3, maxW: 9, len: 0.75, color: '#ffffff', alpha: 0.55, levels: 4 }));
    this.caustics = new Caustics({ tw: 140, th: 44, cx: 10, cy: 5, seed: 17, color: '#f0ffff', thick: 0.6, core: 0.7, rim: 0.2 });
    this.shimmer = this.makeShimmer();
    this.buildLife();
    this.fresh = true;
  }

  // Sky canvas (world y skyY .. base + 14) per time of day: gradient, sun/moon, stars, mountains, glacier, icebergs.
  buildSky() {
    const W = this.W, base = this.base;
    const skyY = this.top - 12;
    this.skyY = skyY;
    const h = base + 14 - skyY;
    this.skyH = h;
    const wy = (row) => row + skyY;
    const ry = (y) => y - skyY;
    // ---- silhouettes (world y of each layer's top edge per column)
    const far = new Float32Array(W + 1), mid = new Float32Array(W + 1);
    const farR = ridge(W, base - 92, 52, 0.011, 2.4, 4, 0.55);
    for (let x = 0; x <= W; x++) far[x] = farR[x];
    const peaks = [[0.27, 228, 0.16], [0.4, 150, 0.1], [0.66, 170, 0.12], [0.79, 236, 0.15], [0.55, 112, 0.08]];
    for (let x = 0; x <= W; x++) {
      let y = base + 4;
      for (const [pxf, ph, hw] of peaks) {
        const d = Math.abs(x / W - pxf) / hw;
        y = Math.min(y, base - ph + Math.pow(d, 1.25) * ph * 0.82);
      }
      y += (fbm2(x * 0.05, 3.3, 3, 21) - 0.5) * 16 + Math.abs(Math.sin(x * 0.11)) * 2;
      mid[x] = y;
    }
    // glacier between the middle peaks: from a high saddle down to a calving cliff at the water
    const gx0 = Math.round(W * 0.43), gx1 = Math.round(W * 0.66), gTop = base - 104;
    const glacierTop = (x) => gTop + Math.pow(Math.abs((x - (gx0 + gx1) / 2) / ((gx1 - gx0) / 2)), 2) * 34 + (fbm2(x * 0.08, 1, 2, 5) - 0.5) * 4;
    // near walls (left/right) as x-extent per world y
    const wallL = (y) => W * 0.16 + (y - this.top) * -0.05 + (fbm2(2.1, y * 0.03, 3, 31) - 0.5) * 34 + (y > base - 40 ? (y - (base - 40)) * -0.55 : 0);
    const wallR = (y) => W * 0.835 + (y - this.top) * 0.04 + (fbm2(7.7, y * 0.03, 3, 33) - 0.5) * 30 + (y > base - 30 ? (y - (base - 30)) * 0.7 : 0);
    this.wallL = wallL; this.wallR = wallR;
    // icebergs floating on the fjord (their keels show underwater in the far layer)
    this.bergs = [[0.34, 26, 18], [0.71, 18, 12], [0.58, 10, 7]].map(([xf, w, hh]) => ({ x: Math.round(xf * W), w, h: hh }));
    // ---- material + tone maps (shared by the three palettes)
    const N = W * h;
    const mat = new Uint8Array(N), tone = new Float32Array(N);
    // mat: 0 sky, 1 far range, 2 mid rock, 3 mid snow, 4 glacier, 5 glacier cliff, 6 near rock, 7 near snow, 8 berg ice, 9 berg top, 10 far snow
    for (let row = 0; row < h; row++) {
      const y = wy(row);
      if (y > base + 1) continue;
      const xl = wallL(y), xr = wallR(y);
      for (let x = 0; x < W; x++) {
        const i = row * W + x;
        // near walls
        if (x < xl || x > xr) {
          const edge = x < xl ? xl - x : x - xr;
          const gully = fbm2(x * 0.06, y * 0.012, 3, 41);
          const ledge = Math.sin(y * 0.09 + fbm2(x * 0.02, y * 0.02, 2, 43) * 6);
          const snowy = (ledge > 0.86 && gully > 0.4) || (edge < 3 && hash2(x, Math.floor(y / 3), 4) < 0.5 && y < base - 20) || (gully > 0.66 && y < base - 60);
          mat[i] = snowy ? 7 : 6;
          tone[i] = clamp01((x < xl ? 0.55 : 0.32) + (gully - 0.5) * 0.8 + (edge < 2 ? 0.25 : 0) + (ledge > 0.7 ? 0.15 : 0));
          continue;
        }
        // icebergs at the waterline
        let berg = false;
        for (const b of this.bergs) {
          const d = Math.abs(x - b.x) / b.w;
          const topY = base - b.h * (1 - Math.pow(d, 1.6)) - (hash2(Math.floor(x / 3), b.x, 2) < 0.3 ? 1 : 0);
          if (d < 1 && y >= topY && y <= base + 1) {
            mat[i] = y < topY + 2 ? 9 : 8;
            tone[i] = clamp01(0.55 + (x < b.x ? 0.25 : -0.15) + (fbm2(x * 0.3, y * 0.15, 2, 7) - 0.5) * 0.6);
            berg = true;
            break;
          }
        }
        if (berg) continue;
        // glacier
        if (x > gx0 - 4 && x < gx1 + 4 && y >= glacierTop(x)) {
          const cliff = base - 22 + (fbm2(x * 0.07, 2, 2, 9) - 0.5) * 8;
          if (y >= cliff) {
            mat[i] = 5;
            tone[i] = clamp01(0.45 + (fbm2(x * 0.5, y * 0.04, 2, 11) - 0.5) * 0.9 + (y < cliff + 2 ? 0.4 : 0) - (y > base - 3 ? 0.2 : 0));
          } else {
            mat[i] = 4;
            const k = (y - glacierTop(x)) / Math.max(1, cliff - glacierTop(x));
            const crev = Math.abs(Math.sin((y - Math.abs(x - (gx0 + gx1) / 2) * 0.2) * 0.55 + fbm2(x * 0.1, y * 0.1, 2, 12) * 2)) > 0.93;
            const moraine = Math.abs(x - (gx0 + gx1) / 2 - Math.sin(y * 0.1) * 3) < 1.5 && hash2(x, y, 9) < 0.7;
            tone[i] = moraine ? -1 : crev ? 0.15 : clamp01(0.85 - k * 0.3 + (fbm2(x * 0.08, y * 0.08, 2, 13) - 0.5) * 0.3);
          }
        }
        // mid mountains (in front of the glacier sides)
        if (y >= mid[x] && (mat[i] === 0 || (x < gx0 + 10 || x > gx1 - 10) && y < glacierTop(x) + 8)) {
          const d = y - mid[x];
          const slope = (mid[Math.min(W, x + 2)] - mid[Math.max(0, x - 2)]) / 4;
          const gully = fbm2(x * 0.09, y * 0.02, 3, 51);
          const snowLine = base - 70 + (fbm2(x * 0.03, 0, 2, 52) - 0.5) * 50;
          const snowy = d < 3 + gully * 10 || (y < snowLine && (gully > 0.5 || Math.abs(slope) < 0.45)) || (gully > 0.68 && y < base - 30);
          mat[i] = snowy ? 3 : 2;
          tone[i] = clamp01(0.5 + (slope < -0.1 ? 0.3 : slope > 0.25 ? -0.3 : 0) + (gully - 0.5) * 0.7 + (d < 2 ? 0.2 : 0));
          continue;
        }
        if (mat[i]) continue;
        // far range
        if (y >= far[x]) {
          const slope = (far[Math.min(W, x + 2)] - far[Math.max(0, x - 2)]) / 4;
          const d = y - far[x];
          mat[i] = d < 6 + fbm2(x * 0.1, 0, 2, 61) * 12 ? 10 : 1;
          tone[i] = clamp01(0.55 + (slope < 0 ? 0.25 : -0.2) + (fbm2(x * 0.08, y * 0.05, 2, 62) - 0.5) * 0.5 - d / 80);
        }
      }
    }
    const sunPos = { day: [0.7, base - 196], dusk: [0.62, base - 60], night: [0.28, base - 250] };
    this.sun = sunPos;
    const mk = (kind) => {
      const st = SKY[kind], P = MT[kind];
      const pal = {};
      for (const k of ['far', 'rock', 'snow', 'ice']) pal[k] = P[k].map((c) => pack(c) >>> 0);
      const [sxf, sy] = sunPos[kind];
      const sx = sxf * W;
      const glow = { day: [[255, 250, 230], 90, 0.55], dusk: [[255, 196, 140], 200, 0.6], night: [[150, 180, 255], 50, 0.25] }[kind];
      const c = paint(W, h, (x, row) => {
        const i = row * W + x, y = wy(row), mt = mat[i];
        const tn = tone[i];
        if (!mt) {
          let [r, g, b] = lerpStops(st, clamp01((y - this.top) / (base - this.top)));
          const d = Math.hypot(x - sx, (y - sy) * 1.2);
          if (d < glow[1]) { const k = Math.pow(1 - d / glow[1], 2.2) * glow[2]; r += (glow[0][0] - r) * k; g += (glow[0][1] - g) * k; b += (glow[0][2] - b) * k; }
          if (kind === 'night' && y < base - 20) {
            const hs = hash2(x, row, 77);
            if (hs < 0.0035) { const k = 0.3 + (hs / 0.0035) * 0.65; r = lerp(r, 230, k); g = lerp(g, 236, k); b = lerp(b, 255, k); }
          }
          return dpack(r, g, b, x, row, 5);
        }
        switch (mt) {
          case 1: return ditherPick(pal.far, tn * 0.9, x, row);
          case 10: return ditherPick(pal.far, 0.7 + tn * 0.3, x, row);
          case 2: return ditherPick(pal.rock, tn, x, row);
          case 3: return ditherPick(pal.snow, 0.25 + tn * 0.75, x, row);
          case 4: return tn < 0 ? pal.rock[1] : ditherPick(pal.snow, 0.35 + tn * 0.65, x, row);
          case 5: return ditherPick(pal.ice, tn, x, row);
          case 6: return ditherPick(pal.rock, tn * 0.85, x, row);
          case 7: return ditherPick(pal.snow, 0.2 + tn * 0.8, x, row);
          case 8: return ditherPick(pal.ice, 0.3 + tn * 0.7, x, row);
          case 9: return pal.snow[3];
          default: return 0;
        }
      });
      const g = ctxOf(c);
      const [mx, my] = [sx, ry(sy)];
      const disc = (cx, cy, r, fn) => {
        for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
          if (mat[Math.max(0, y) * W + Math.max(0, Math.min(W - 1, x))]) continue;
          const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
          if (d <= r) { const col = fn(d / r, x, y); if (col) { g.fillStyle = col; g.fillRect(x, y, 1, 1); } }
        }
      };
      if (kind === 'day') disc(mx, my, 9, (d) => (d > 0.86 ? '#fff4c8' : d > 0.6 ? '#fffbe8' : '#ffffff'));
      else if (kind === 'dusk') disc(mx, my, 12, (d, x, y) => ([4, 7, 9].includes(Math.round(y - my)) ? null : y < my - 4 ? '#fff2c0' : y < my + 3 ? '#ffc880' : '#ff9a5a'));
      else {
        disc(mx, my, 7.5, (d, x) => (x + 0.5 - mx > 3.5 && d > 0.5 ? '#aab6dc' : d > 0.86 ? '#d6deff' : '#f2f5ff'));
        for (const [ox, oy, r] of [[-3, -2, 1.5], [1, 2, 1.8], [-1, 4, 1]]) disc(mx + ox, my + oy, r, () => '#c4ccea');
      }
      return c;
    };
    this.sky = { day: mk('day'), dusk: mk('dusk'), night: mk('night') };
    this.skyMat = mat;
    const so = { levels: 10 };
    const overH = h;
    this.overcast = {
      day: paint(8, overH, (x, y) => ditherPick(stopPalette(OVERCAST.day, 10), y / overH, x, y)),
      dusk: paint(8, overH, (x, y) => ditherPick(stopPalette(OVERCAST.dusk, 10), y / overH, x, y)),
      night: paint(8, overH, (x, y) => ditherPick(stopPalette(OVERCAST.night, 10), y / overH, x, y)),
    };
    void so;
    // mountains mask (for drawing overcast/fog only over the sky)
    this.skyMask = paint(W, h, (x, row) => (mat[row * W + x] ? 0 : pack('#ffffff')));
    const r = new RNG(31);
    this.stars = [];
    for (let i = 0; i < 40; i++) {
      const x = r.int(4, W - 4), y = r.int(this.top + 10, base - 90);
      if (!mat[(y - skyY) * W + x]) this.stars.push({ x, y, f: r.float(0.8, 3), ph: r.float(0, TAU), c: r.pick(['#ffffff', '#e8f0ff', '#c8dcff', '#fff4d8']) });
    }
    // aurora curtains
    this.aurora = [this.auroraTex(Math.round(W * 1.6), 150, 3, ['#4affa0', '#3ae0c0', '#9a6aff']), this.auroraTex(Math.round(W * 1.6), 110, 9, ['#7aff8a', '#4ad8ff', '#ff6ac8'])];
    // clouds
    this.clouds = [];
    for (let i = 0; i < 6; i++) this.clouds.push({ x: r.float(0, W), y: r.int(this.top + 30, base - 150), v: r.float(1.5, 4), tile: cloudTile(r.int(120, 200), r.int(26, 40), '#ffffff', { seed: 40 + i, alpha: 0.75, scale: 0.05, bias: 0.45, levels: 4 }) });
    this.snowTile = streakTile(128, 128, 30, '#ffffff', { seed: 5, len: [1, 2], slant: 6, alpha: 0.9 });
    this.blizTile = streakTile(160, 96, 46, '#f4faff', { seed: 9, len: [4, 9], slant: 1, alpha: 0.75 });
  }

  // A wide aurora curtain texture: vertical rays hanging from a wavy lower edge, green at the hem fading up to violet.
  auroraTex(w, h, seed, cols) {
    const [c0, c1, c2] = cols.map((c) => lerpStops([[0, c]], 0));
    const r0 = new Float32Array(w);
    for (let x = 0; x < w; x++) r0[x] = Math.pow(clamp01(fbm2(x * 0.045, seed, 3, seed) * 1.6 - 0.35), 1.4) * (0.6 + 0.4 * Math.sin(x * 0.31 + seed));
    return paint(w, h, (x, y) => {
      const hem = h * 0.78 + Math.sin(x * 0.013 + seed) * h * 0.12 + Math.sin(x * 0.041) * 4;
      if (y > hem + 2) return 0;
      const up = (hem - y) / (h * 0.8);
      if (up > 1) return 0;
      let v = r0[x] * (up < 0 ? 1 + up * 0.5 : Math.pow(1 - up, 1.3)) * (0.7 + 0.3 * Math.sin(x * 0.9 + y * 0.05));
      if (Math.abs(y - hem) < 1.5) v *= 1.5;
      const k = clamp01(up * 1.3);
      const col = k < 0.45 ? [lerp(c0[0], c1[0], k / 0.45), lerp(c0[1], c1[1], k / 0.45), lerp(c0[2], c1[2], k / 0.45)] : [lerp(c1[0], c2[0], (k - 0.45) / 0.55), lerp(c1[1], c2[1], (k - 0.45) / 0.55), lerp(c1[2], c2[2], (k - 0.45) / 0.55)];
      const q = Math.floor(clamp01(v) * 5 + ((x * 3 + y * 5) % 4) / 4) / 5;
      if (q <= 0) return 0;
      return pack('#' + col.map((c) => clamp(Math.round(c), 0, 255).toString(16).padStart(2, '0')).join(''), Math.round(q * 230));
    });
  }

  makeShimmer() {
    const W = this.W + 256, h = 14;
    const r = new RNG(23);
    const acc = new Float32Array(W * h);
    for (let i = 0; i < W * 0.45; i++) {
      const y = Math.floor(Math.pow(r.next(), 1.6) * h), len = r.int(3, 14 - Math.min(9, y)), x = r.int(0, W - 1);
      const a = (1 - y / h) * r.float(0.4, 1);
      for (let k = 0; k < len; k++) acc[y * W + ((x + k) % W)] = Math.max(acc[y * W + ((x + k) % W)], a * (k === 0 || k === len - 1 ? 0.5 : 1));
    }
    return paint(W, h, (x, y) => { const v = acc[y * W + x]; return v < 0.05 ? 0 : pack(v > 0.6 ? '#ffffff' : '#c8fffa', Math.round(Math.min(1, v) * 200)); });
  }

  // Perspective fjord floor between granite / blue-ice walls, props at many depths.
  buildDepth() {
    const W = this.W, H = this.H;
    const D = new DepthScene(W, H, { yFront: H - 70, yFar: H - 158, pad: 24, zFar: 1.9, fogStart: -0.25, fog: 0.9 });
    this.D = D;
    const cx = D.cx, surf = this.base + 3;
    const edge = (z, side) => W * (side < 0 ? 0.385 : 0.375) + Math.sin(z * 2.6 + side) * W * 0.03 + (fbm2(z * 2.1, 3.3 + side, 2, 71) - 0.5) * W * 0.08 + smoothstep(0.9, 1.9, z) * W * 0.12;
    this.edge = edge;
    const floorH = (X, z) => {
      let h = (fbm2(X * 0.0045, z * 1.3, 3, 72) - 0.45) * 12;
      h += Math.max(0, fbm2(X * 0.03, z * 5, 2, 73) - 0.66) * 40;            // dropstones
      h += smoothstep(1.0, 1.7, z) * Math.max(0, fbm2(X * 0.004 + 5, z, 2, 74) * 60 - 18); // moraine
      const front = 1 - smoothstep(0.05, 0.5, z);
      h *= 1 - front * 0.6;
      if (X > W - 260 + (X - cx) * 0) h *= 1 - front * 0.3;
      const rp = Math.sin(z * 46 + fbm2(X * 0.02, z * 2, 2, 75) * 7);
      if (rp > 0.72) h += 2;
      return Math.max(-2, h);
    };
    const cap = (z) => D.K - (surf - D.hz) / D.s(z);
    const cliff = (X, z) => {
      const side = X < cx ? -1 : 1;
      const over = Math.abs(X - cx) - edge(z, side) - (fbm2(z * 6, side * 4, 2, 76) - 0.5) * 20;
      if (over <= 0) return null;
      let h;
      if (over < 12) h = 30 + Math.round(fbm2(X * 0.05, z * 5, 2, 77) * 8) * 2;
      else if (over < 28) h = 74;
      else if (over < 46) h = 128;
      else h = 900;
      return Math.min(h, cap(z));
    };
    D.terrain({
      cell: 2, dz: 0.02, hstep: 2, ambient: 0.66, diffuse: 0.46, ao: 0.07, jitter: 0.06, wall: 0.8, side: 0.9, crest: 1.14, wallMin: 28, fullHeight: true,
      height: (X, z) => cliff(X, z) ?? floorH(X, z),
      floorHeight: floorH,
      color: (X, z, h) => {
        if (h >= 28) {
          const ice = fbm2(X * 0.012, z * 3, 2, 78) > 0.52;
          if (ice) return hash2(Math.floor(X / 2), Math.floor(z * 50), 79) < 0.2 ? [200, 240, 250] : [226, 248, 255];
          return fbm2(X * 0.05, z * 5, 2, 80) > 0.55 ? [196, 214, 226] : [150, 164, 180];
        }
        const hs = hash2(Math.floor(X / 2), Math.floor(z * 50), 81);
        if (hs < 0.007) return [214, 108, 130];   // coralline algae / sea star
        if (hs < 0.011) return [240, 244, 248];   // shell
        if (hs < 0.014) return [236, 150, 70];    // brittle star
        if (h > 6) return fbm2(X * 0.06, z * 6, 2, 82) > 0.5 ? [134, 142, 160] : [114, 122, 142];
        const g = fbm2(X * 0.012 + 3, z * 2, 2, 83);
        if (g > 0.66 && hash2(Math.floor(X / 2), Math.floor(z * 50), 84) < (g - 0.66) * 4) return [110, 116, 128]; // gravel
        const n = fbm2(X * 0.025, z * 4, 2, 85);
        return n < 0.35 ? [148, 158, 162] : n > 0.66 ? [184, 192, 190] : [166, 174, 176];
      },
      wallColor: (X, z, hp, h) => {
        const ice = fbm2(X * 0.012, z * 3, 2, 78) > 0.52;
        if (ice) {
          const band = Math.floor((hp + fbm2(X * 0.02, z * 3, 2, 86) * 20) / 7);
          const crevasse = hash2(Math.floor(X / 3), Math.floor(z * 30), 87) < 0.1;
          const base = [[150, 226, 244], [120, 206, 236], [176, 238, 250], [98, 186, 226]][((band % 4) + 4) % 4];
          let k = 1 - smoothstep(30, 420, hp) * 0.32;
          if (crevasse) k *= 0.62;
          if (hp > h - 3) k *= 1.2;
          return [base[0] * k, base[1] * k, Math.min(255, base[2] * k)];
        }
        const band = Math.floor((hp + fbm2(X * 0.015, z * 2, 2, 88) * 26) / 8);
        const c = STRATA[((band % STRATA.length) + STRATA.length) % STRATA.length];
        let k = 1 - smoothstep(30, 420, hp) * 0.4;
        if (hash2(Math.floor(X / 3), Math.floor(hp / 6), 89) < 0.06) k *= 0.62;
        if (hp > h - 3 && h < 400) k *= 1.3;
        return [c[0] * k, c[1] * k, c[2] * k];
      },
    });
    const S = (key, build, xf, z, base, extra = {}) => placeSprite(D, W, voxSprite(key, build, { scale: qscale(base * D.s(z)) }), xf, z, extra);
    const P = (id, xf, z, base, variant = 0) => placeSprite(D, W, getProp(id, { scale: qscale(base * D.s(z)), variant }), xf, z, { id });
    // near
    S('fj_boulder1', () => boulderModel(11, 1), 0.205, 0.2, 0.8);
    S('fj_crystal0', () => crystalModel(5, 1, 0), 0.815, 0.22, 0.7);
    S('fj_coral0', () => softCoralModel(3), 0.58, 0.06, 0.75);
    S('fj_coral1', () => softCoralModel(8), 0.655, 0.2, 0.7);
    S('fj_boulder2', () => boulderModel(19, 0.7), 0.735, 0.03, 0.7);
    S('fj_crystal2', () => crystalModel(23, 0.7, 2), 0.415, 0.28, 0.65);
    // mid
    const ship = S('fj_ship', shipModel, 0.6, 0.47, 1.12);
    S('fj_crystal1', () => crystalModel(9, 1, 1), 0.285, 0.5, 0.95);
    S('fj_boulder3', () => boulderModel(27, 1.2), 0.39, 0.62, 1.0);
    P('anchor', 0.795, 0.44, 0.8);
    S('fj_coral2', () => softCoralModel(14), 0.47, 0.42, 0.9);
    S('fj_crystal3', () => crystalModel(31, 0.8, 0), 0.735, 0.6, 0.9);
    S('fj_boulder4', () => boulderModel(35, 0.8), 0.17, 0.4, 0.9);
    // far
    S('fj_arch', iceArchModel, 0.47, 1.18, 1.3);
    S('fj_crystal4', () => crystalModel(41, 1.2, 1), 0.33, 0.9, 1.1);
    S('fj_crystal5', () => crystalModel(43, 1, 2), 0.66, 0.96, 1.1);
    S('fj_boulder5', () => boulderModel(47, 1.4), 0.56, 0.84, 1.2);
    S('fj_boulder6', () => boulderModel(53, 1.2), 0.26, 1.3, 1.5);
    S('fj_coral3', () => softCoralModel(21), 0.43, 0.8, 1.0);
    S('fj_crystal6', () => crystalModel(57, 1.3, 0), 0.6, 1.4, 1.6);
    this.ship = ship;
    // iced-in chest (secret) and the singing crystals, drawn live in the near band
    const chz = 0.08, chx = Math.round(W * 0.505);
    this.chestProp = getProp('treasure_chest', { scale: qscale(0.62 * D.s(chz)), frame: 0 });
    this.chestOpen = getProp('treasure_chest', { scale: qscale(0.62 * D.s(chz)), frame: 1 });
    const cy = Math.round(D.floorAt(chx, chz)) + 1, cp = this.chestProp;
    this.chest = { x: chx, y: cy, w: cp.w + 10, h: cp.oy + 10, cracks: 0, shake: 0, t: 0, open: false };
    this.chest.rect = { x: chx - cp.ox - 5, y: cy - cp.oy - 8, w: cp.w + 10, h: cp.oy + 10 };
    const sizes = [2, 0, 3, 1];
    this.crystals = sizes.map((sz, i) => {
      const z = [0.02, 0.1, -0.04, 0.06][i];
      const x = Math.round(W * (0.265 + i * 0.033));
      const spr = voxSprite('fj_sing' + sz, () => singingCrystal(sz), { scale: qscale(0.9 * D.s(z)) });
      const y = Math.round(D.floorAt(x, z)) + 1;
      return { size: sz, x, y, z, spr, lit: 0, rect: { x: x - spr.ox, y: y - spr.oy, w: spr.w, h: spr.oy }, cx: x, cy: y - Math.round(spr.oy * 0.6) };
    });
    D.render([{ key: 'day', strip: this.water.day }, { key: 'dusk', strip: this.water.dusk }, { key: 'night', strip: this.water.night }]);
    this.bands = new BandSet(D);
    this.hazeY = Math.round(D.hz - 28);
    this.haze = new FogLayer(hazeMask(W, 72, { peak: 0.55, alpha: 0.75 }), 0, this.hazeY);
    this.masks = [0, 1].map((b) => lumaMask(D.bands[b].canvases.day, { gamma: 2.2, gain: 1.05 }));
    this.floor = new Float32Array(W + 1);
    for (let x = 0; x <= W; x++) this.floor[x] = D.floorAt(x, 0);
    // sparkle points on crystals and the ship's ice (glints drawn per frame)
    this.glints = [];
    const gr = new RNG(61);
    for (const q of D.items) {
      if (!q.p?.glow) continue;
      for (let k = 0; k < 4; k++) this.glints.push({ x: q.left + gr.float(0.2, 0.8) * q.p.w, y: q.top + gr.float(0.1, 0.6) * q.p.oy, band: q.band, ph: gr.float(0, 9), p: gr.float(3, 7) });
    }
  }

  // Far layers: glacier front and moraine at the end of the fjord; iceberg keels hanging from the surface.
  buildLayers() {
    const W = this.W, H = this.H, pad = 28, D = this.D;
    this.pad = pad;
    const LW = W + pad * 2;
    const r = new RNG(15);
    const hz = D.hz;
    // --- far A: glacier terminus wall continuing underwater + side walls
    const yA = this.base, hA = H - yA;
    const mA = new Mask(LW, hA);
    const baseA = hz - yA + 14;
    const rA = ridge(LW, baseA - 44, 26, 0.008, 4.4, 4, 0.3);
    mA.below((x) => rA[x]);
    const gx0 = LW * 0.36, gx1 = LW * 0.68;
    for (let x = Math.round(gx0); x < gx1; x++) {
      const u = (x - gx0) / (gx1 - gx0);
      const bottom = baseA - 60 - Math.sin(u * Math.PI) * 30 + (fbm2(x * 0.05, 2, 2, 3) - 0.5) * 14;
      for (let y = 0; y < bottom; y++) mA.set(x, y, 2);
    }
    for (let i = 0; i < 5; i++) { const px0 = r.float(0.08, 0.92) * LW, top0 = r.float(baseA - 120, baseA - 60); mA.poly([[px0 - 26, baseA], [px0 - 4, top0], [px0 + 6, top0 + 6], [px0 + 30, baseA]]); }
    const palA = stopPalette([[0, '#0c4a6a'], [1, '#3a9ab8']], 6);
    const palG = stopPalette([[0, '#2a7aa0'], [1, '#a8eef8']], 6);
    this.farA = new FogLayer(mA.toCanvas((x, y, v, up) => {
      if (v === 2) return ditherPick(palG, 0.85 - y / 160 + (fbm2(x * 0.4, y * 0.03, 2, 7) - 0.5) * 0.7, x, y);
      if (up <= 1) return pack('#8ae0ee');
      return ditherPick(palA, 0.72 - Math.min(1, up / 70) * 0.55 + (fbm2(x * 0.05, y * 0.05, 2, 2) - 0.5) * 0.35, x, y);
    }), -pad, yA);
    this.farAY = yA;
    // --- far B: iceberg keels hanging from the surface + seabed boulders on the horizon
    const yB = this.base, hB = H - yB;
    const mB = new Mask(LW, hB);
    const baseB = hz - yB + 22;
    const rB = ridge(LW, baseB - 8, 10, 0.012, 6.2, 3);
    mB.below((x) => rB[x]);
    for (let i = 0; i < 26; i++) { const px0 = r.float(0, LW), by = rB[Math.round(clamp(px0, 0, LW))] + 4; mB.ellipse(px0, by - 3, r.float(6, 16), r.float(4, 9)); }
    const keels = [...this.bergs.map((b) => [b.x + pad, b.w * 1.6, b.h * 5.5]), [LW * 0.1, 30, 70], [LW * 0.88, 40, 95]];
    for (const [kx, kw, kd] of keels) {
      mB.poly([[kx - kw, 0], [kx + kw, 0], [kx + kw * 0.6, kd * 0.45], [kx + kw * 0.2, kd * 0.85], [kx - kw * 0.1, kd], [kx - kw * 0.5, kd * 0.6], [kx - kw * 0.9, kd * 0.3]], 3);
    }
    const palB = stopPalette([[0, '#0a3c56'], [1, '#2e8aa6']], 6);
    const palK = stopPalette([[0, '#4ab2d0'], [1, '#c8f6ff']], 6);
    this.farB = new FogLayer(mB.toCanvas((x, y, v, up, left, right) => {
      if (v === 3) return ditherPick(palK, 0.9 - y / 140 + (left ? 0.2 : right ? -0.25 : 0) + (fbm2(x * 0.2, y * 0.05, 2, 9) - 0.5) * 0.5, x, y);
      if (up <= 1) return pack('#9ae4ee');
      if (up === 2) return pack('#4aa0b8');
      return ditherPick(palB, 0.7 - Math.min(1, up / 40) * 0.5 + (fbm2(x * 0.08, y * 0.08, 2, 6) - 0.5) * 0.4, x, y);
    }), -pad, yB);
    this.farBY = yB;
    // giants
    this.beluga = belugaFrames(120); this.belugaL = this.beluga.map(flipCanvas);
    this.sealS = sealSwimFrames(58); this.sealSL = this.sealS.map(flipCanvas);
    this.giant = { kind: 'seal', x: W * 0.3, y: H * 0.4, dir: 1, v: 16, ph: 0, s: 0.8 };
    this.giantT = 0;
  }

  buildLife() {
    const W = this.W, H = this.H, D = this.D;
    const r = new RNG(29);
    this.decor = new DepthDecor(D);
    // kelp under the ice: tall brown-olive stipes with big blades at many depths
    const blades = bladeSprites({ len: 14, w: 3, cols: ['#3a3418', '#54501e', '#727024', '#949034', '#b8b04a'], curl: 0.5, outline: 0.5 });
    const bladesS = bladeSprites({ len: 9, w: 2, cols: ['#3a3418', '#54501e', '#727024', '#949034'], curl: 0.5, outline: 0.4 });
    for (const [xf, z, n] of [[0.17, 0.62, 40], [0.215, 0.74, 34], [0.85, 0.66, 38], [0.8, 0.8, 30], [0.52, 1.0, 30], [0.375, 0.92, 28], [0.68, 0.88, 26], [0.12, 0.3, 46], [0.88, 0.32, 42], [0.46, 1.2, 30], [0.27, 1.1, 26], [0.7, 1.25, 26]]) {
      const s = D.s(z), x = Math.round(xf * W);
      const st = new Strands();
      st.add({ x, y: Math.round(D.floorAt(x, z)) + 3, n, seg: Math.max(2, Math.round(4 * s)), w: s > 0.6 ? 2 : 1, amp: 0.13, speed: 0.6, sec: 1, phase: r.float(0, TAU), wave: 0.18, lean: r.float(-0.06, 0.06),
        cols: ['#2e2a14', '#46421a', '#5e5a22'], out: '#141208', blades: s > 0.62 ? blades : bladesS, leafEvery: 2, bulb: s > 0.6 ? '#a89a3a' : null, bulbEvery: 7, hl: false });
      this.decor.add({ anim: new SwayAnim(st, { frames: 20 }), z, off: r.int(0, 19) });
    }
    // red & green seaweed tufts
    const sets = [['#5a1a2a', '#8a2a3a', '#b8404e', '#e0687a'], ['#24503a', '#2e6a46', '#448a58', '#6aae74'], ['#6a4a1e', '#8a6a2a', '#b08a3a', '#d8b05a']];
    for (const [xf, z] of [[0.08, -0.1], [0.16, 0.05], [0.32, 0.16], [0.37, -0.12], [0.45, 0.12], [0.55, -0.15], [0.62, 0.0], [0.7, 0.14], [0.78, -0.1], [0.9, 0.08], [0.97, -0.05],
      [0.22, 0.5], [0.35, 0.44], [0.52, 0.56], [0.66, 0.5], [0.8, 0.46], [0.3, 0.8], [0.5, 0.7], [0.62, 0.8]]) {
      const s = D.s(z), x0 = Math.round(xf * W), y0 = Math.round(D.floorAt(x0, z)) + 1;
      const set = sets[r.chance(0.6) ? r.int(0, 1) : 2];
      const st = new Strands();
      const k = r.int(3, 6), tall = r.chance(0.4);
      for (let i = 0; i < k; i++) {
        const lean = (i / Math.max(1, k - 1) - 0.5) * 0.9 + r.float(-0.15, 0.15);
        st.add({ x: x0 + Math.round(lean * 7 * s), y: y0, n: Math.max(3, Math.round((tall ? r.int(8, 12) : r.int(4, 7)) * Math.min(1.1, s))), seg: 2, w: tall && s > 0.7 ? 2 : 1, amp: 0.25, speed: 1.3, sec: 2, phase: r.float(0, TAU), wave: 0.45, lean, curl: lean * 0.4, cols: set, out: tall && s > 0.7 ? '#140c14' : null, hl: false, taper: 0.3 });
      }
      this.decor.add({ anim: new SwayAnim(st, { frames: 16 }), z, off: r.int(0, 15) });
    }
    // plumose anemones (tall white Metridium) with feathery crowns
    this.anemones = [];
    for (const [xf, z, cols, tip, stalk] of [
      [0.13, 0.04, ['#c8b8b0', '#e8dcd4', '#fff4ee', '#ffffff'], '#ffffff', ['#a88a80', '#c8aaa0', '#e8d0c4']],
      [0.88, 0.16, ['#e8905a', '#ffb07a', '#ffd0a8', '#fff0dc'], '#fff6e8', ['#a8583a', '#c8784a', '#e8a070']],
      [0.33, 0.56, ['#c8b8b0', '#e8dcd4', '#fff4ee', '#ffffff'], '#ffffff', ['#a88a80', '#c8aaa0', '#e8d0c4']],
      [0.7, 0.3, ['#e8905a', '#ffb07a', '#ffd0a8', '#fff0dc'], '#fff6e8', ['#a8583a', '#c8784a', '#e8a070']]]) {
      const x = Math.round(xf * W), y = Math.round(D.floorAt(x, z)) + 1, s = D.s(z);
      const sh = Math.round(16 * s);
      const st = new Strands();
      const N = 15;
      for (let i = 0; i < N; i++) {
        const u = i / (N - 1) - 0.5;
        const lean = u * 2.6 + r.float(-0.1, 0.1);
        st.add({ x: x + Math.round(u * 8 * s), y: y - sh - 1 + Math.round(Math.abs(u) * 3 * s), n: Math.max(3, Math.round((4 + ((i * 5) % 3)) * Math.min(1.1, s))), seg: 2, w: s > 0.8 ? 2 : 1, amp: 0.3, speed: 1.2, sec: 2, phase: i * 0.4, wave: 0.6, lean, curl: lean * 0.5, cols, out: null, hl: false, tip, tipR: 1 });
      }
      const under = (gg) => {
        for (let yy = -sh; yy <= 0; yy++) {
          const k = (yy + sh) / sh;
          const hw = Math.round((2.5 + (1 - k) * 3 + (k > 0.85 ? 2 : 0)) * s);
          gg.fillStyle = stalk[k < 0.3 ? 2 : k < 0.7 ? 1 : 0];
          gg.fillRect(x - hw, y + yy, hw * 2 + 1, 1);
          gg.fillStyle = stalk[2];
          gg.fillRect(x - hw, y + yy, 1, 1);
        }
        gg.fillStyle = '#2a1e24';
        gg.fillRect(x - Math.round(6 * s), y + 1, Math.round(12 * s) + 1, 1);
      };
      const anim = new SwayAnim(st, { frames: 16, under, bounds: { x0: x - 9, y0: y - sh - 12, x1: x + 9, y1: y + 2 } });
      this.decor.add({ anim, z, off: r.int(0, 15) });
      this.anemones.push({ x, y: y - sh, z });
    }
    // life above water
    this.penguin = penguinFrames();
    this.penguinL = this.penguin.map(flipCanvas);
    this.seal = sealFrames();
    // ice floes drifting on the surface
    this.floes = [];
    const fr = new RNG(71);
    const spec = [[0.08, 16, 0], [0.3, 11, 0], [0.47, 22, 3], [0.66, 9, 0], [0.82, 18, 2], [0.94, 8, 0], [0.2, 7, 0]];
    for (const [xf, R, who] of spec) {
      const p = voxSprite('fj_floe' + R, () => floeModel(R * 13, R), { scale: 1 });
      const keel = this.keelSprite(p.w, Math.round(R * 1.4), R);
      this.floes.push({ x: xf * W, v: fr.float(1.2, 2.6), spr: p, keel, R, who, ph: fr.float(0, TAU) });
    }
    // penguins (who 3: three penguins incl. the secret one; who 2: seal)
    const fl = this.floes.find((f) => f.who === 3);
    this.penguins = [-12, -3, 7].map((dx, i) => ({ floe: fl, dx, dir: i === 1 ? -1 : 1, state: 'stand', t: fr.float(1, 4), f: 0, secret: i === 1, y: 0, vx: 0, vy: 0, wx: 0, wy: 0 }));
    // particles
    const sy = this.base;
    this.slush = new Motes(130, { x0: 0, y0: sy + 4, x1: W, y1: H - 40 }, { seed: 3, vx: [-2, 2], vy: [3, 9], sizes: [1, 1, 1, 2], colors: ['#ffffff', '#e8faff', '#c8f0ff'], alpha: [0.3, 0.8], wob: 4 });
    this.iceMotes = new Motes(40, { x0: 0, y0: sy + 10, x1: W, y1: H - 40 }, { seed: 8, vx: [-3, 3], vy: [-2, 2], sizes: [1], colors: ['#ffffff', '#c8fbff', NEON_ICE], alpha: [0.5, 1], wob: 6 });
    this.nearMotes = new Motes(24, { x0: 0, y0: sy + 10, x1: W, y1: H - 30 }, { seed: 9, vx: [-4, 4], vy: [1, 5], sizes: [2, 2, 3], colors: ['#f0fcff', '#d0f4ff'], alpha: [0.12, 0.3], wob: 8 });
    this.airSnow = new Motes(160, { x0: 0, y0: this.top - 10, x1: W, y1: sy + 4 }, { seed: 11, vx: [-6, 6], vy: [12, 26], sizes: [1, 1, 1, 2], colors: ['#ffffff', '#eef6ff'], alpha: [0.5, 1], wob: 5 });
    this.bubbles = new Bubbles(70, '#e8ffff');
    this.emitT = 1;
    // penguin flock diving through the water
    this.flock = null; this.flockT = 6;
    this.birds = [0, 1, 2, 3].map((i) => ({ x: r.float(0, W), y: r.float(this.top + 80, sy - 120), v: r.float(10, 18) * (i % 2 ? -1 : 1), ph: r.float(0, TAU) }));
  }

  // Translucent underwater part of an ice floe: an inverted, ragged block with a few brinicles.
  keelSprite(w, d, seed) {
    const m = new Mask(w + 4, d + 10);
    const cx = (w + 4) / 2;
    for (let x = 0; x < w + 4; x++) {
      const u = Math.abs(x - cx) / (w / 2);
      if (u > 1) continue;
      const dd = d * (1 - Math.pow(u, 2.2)) * (0.75 + 0.25 * fbm2(x * 0.3, seed, 2, seed)) + 1;
      for (let y = 0; y < dd; y++) m.set(x, y, 1);
    }
    const r = new RNG(seed);
    for (let i = 0; i < Math.max(2, w / 9); i++) { const x = r.int(4, w); const top = m.get(x, 2) ? d * (0.4 + r.next() * 0.5) : 2; for (let y = 0; y < top + r.int(3, 8); y++) if (!m.get(x, y)) m.set(x, y, 2); }
    return m.toCanvas((x, y, v, up, left, right) => {
      if (v === 2) return pack('#e8fdff', 200);
      const k = y / (d + 1);
      if (left || right) return pack('#e6fbff', 150);
      return pack(k < 0.15 ? '#c8f6ff' : k < 0.5 ? '#9ae4f4' : '#78d0ea', Math.round(170 - k * 90 + ((x + y) % 2 ? 10 : 0)));
    });
  }

  // ------------------------------------------------------------------ update
  update(dt, env) {
    dt = Math.max(0, Math.min(dt, 0.1));
    this.t += dt;
    const t = this.t, W = this.W, H = this.H;
    const tod = todWeights(env);
    this.tod = tod;
    const snap = this.fresh;
    const k = snap ? 1 : 1 - Math.exp(-dt * 0.6);
    const w = env.weather, wx = this.wx;
    wx.snow += ((w === 'snowfall' ? 1 : w === 'blizzard' ? 0.6 : 0) - wx.snow) * k;
    wx.bliz += ((w === 'blizzard' ? 1 : 0) - wx.bliz) * k;
    wx.aurora += ((w === 'aurora' ? 1 : 0) - wx.aurora) * k;
    wx.clear = clamp01(1 - wx.snow * 0.7 - wx.bliz * 0.6);
    const c = env.cursor;
    const tx = c && c.x > -50 ? (c.x / W - 0.5) * -2 : 0, ty = c && c.y > -50 ? (c.y / H - 0.5) * -2 : 0;
    const kp = snap ? 1 : 1 - Math.exp(-dt * 2.5);
    this.par.x += (tx - this.par.x) * kp;
    this.par.y += (ty - this.par.y) * kp;
    this.fresh = false;
    this.cols.crest = tri('#f2ffff', '#ffe4d0', '#a8c8ee', tod);
    this.cols.sub = tri('#9ef0ee', '#d0b0b0', '#4a88b4', tod);
    this.fogColor = tri('#3cb6cc', '#3a6e9a', '#1c4e80', tod);
    if (wx.bliz > 0.05) this.fogColor = qmix(this.fogColor, '#6a8a9a', wx.bliz * 0.35);
    const fkey = Math.round(tod.day * 40) + ',' + Math.round(tod.dusk * 40);
    this.decor.refog((y) => this.waterHex(y, tod), fkey);
    // surface
    const sy = this.surfaceAt(env);
    waveLine(this.ys, W, sy, t * 0.55, 0.9 + wx.bliz * 2.2 + wx.snow * 0.3, 0.2 + wx.bliz * 1.4, 0.8 + wx.bliz * 0.8);
    for (const f of this.floes) { f.x += f.v * dt * (1 + wx.bliz * 2.5); if (f.x > W + 40) f.x = -40; }
    this.updatePenguins(dt, sy);
    for (const b of this.birds) { b.x += b.v * dt; b.ph += dt * 5; if (b.x > W + 20) b.x = -20; if (b.x < -20) b.x = W + 20; }
    for (const cl of this.clouds) { cl.x += cl.v * dt * (1 + wx.bliz * 4); if (cl.x > W + 10) cl.x = -cl.tile.width - 10; }
    // particles
    const drift = Math.sin(t * 0.17) * 2 + wx.bliz * 10;
    this.slush.update(dt * (0.6 + wx.snow * 0.6 + wx.bliz * 0.6), drift, 0);
    this.iceMotes.update(dt, drift * 0.6, 0);
    this.nearMotes.update(dt, drift * 1.3, 0);
    this.airSnow.update(dt * (0.6 + wx.bliz * 1.4), 8 + wx.bliz * 160, wx.bliz * 40);
    this.bubbles.update(dt, sy);
    this.emitT -= dt;
    if (this.emitT <= 0) {
      this.emitT = 0.9 + Math.random() * 1.8;
      const a = this.anemones[Math.floor(Math.random() * this.anemones.length)];
      if (Math.random() < 0.5) this.bubbles.emit(a.x + (Math.random() - 0.5) * 6, a.y, { r: 1 });
      else { const x = this.ship.x + (Math.random() - 0.4) * 60 * this.ship.s; this.bubbles.emit(x, this.ship.top + this.ship.p.oy * 0.5, { r: Math.random() < 0.3 ? 2 : 1 }); }
    }
    // penguin flock: dive from the surface, sweep through the water, climb back out
    if (this.flock) {
      const F = this.flock;
      F.t += dt;
      const u = F.t / F.dur;
      for (const p of F.birds) {
        const q = clamp01(u * 1.15 - p.lag);
        p.x = lerp(F.x0, F.x1, q) + Math.sin(q * 9 + p.ph) * 6;
        p.y = sy + 6 + Math.sin(q * Math.PI) * F.depth + p.dy + Math.sin(q * 20 + p.ph) * 2;
        p.vy = Math.cos(q * Math.PI) * F.depth;
        if (Math.random() < dt * 6 && q > 0.02 && q < 0.98) this.bubbles.emit(p.x - F.dir * 4, p.y, { r: 1, vy: -12 });
      }
      if (u > 1.3) { this.flock = null; this.flockT = 18 + Math.random() * 30; }
    } else if ((this.flockT -= dt) <= 0) {
      const dir = Math.random() < 0.5 ? 1 : -1;
      this.flock = { t: 0, dur: 7 + Math.random() * 3, dir, x0: dir > 0 ? -30 : W + 30, x1: dir > 0 ? W + 30 : -30, depth: H * (0.25 + Math.random() * 0.25),
        birds: Array.from({ length: 4 + Math.floor(Math.random() * 4) }, (_, i) => ({ lag: i * 0.04 + Math.random() * 0.03, dy: (Math.random() - 0.5) * 30, ph: Math.random() * TAU, x: -99, y: 0, vy: 0 })) };
    }
    // far giants
    const gi = this.giant;
    if (gi) {
      gi.x += gi.dir * gi.v * dt;
      gi.ph += dt * (gi.kind === 'beluga' ? 0.8 : 1.6);
      gi.y += Math.sin(t * 0.3) * dt * 3;
      if (gi.x < -260 || gi.x > W + 260) { this.giant = null; this.giantT = 20 + Math.random() * 40; }
    } else if ((this.giantT -= dt) <= 0) {
      const bel = Math.random() < 0.45, dir = Math.random() < 0.5 ? 1 : -1;
      this.giant = { kind: bel ? 'beluga' : 'seal', dir, x: dir > 0 ? -200 : W + 200, y: H * (bel ? 0.3 + Math.random() * 0.12 : 0.26 + Math.random() * 0.2), v: bel ? 9 : 18, ph: 0, s: bel ? 0.75 + Math.random() * 0.2 : 0.7 + Math.random() * 0.3 };
    }
    // secrets
    const ch = this.chest;
    ch.shake = Math.max(0, ch.shake - dt * 3);
    if (ch.open) ch.t += dt;
    for (const cr of this.crystals) cr.lit = Math.max(this.secrets().fjord_song ? 0.35 : 0, cr.lit - dt * 0.5);
    this.songT = Math.max(0, this.songT - dt);
    this.hint += dt;
    env.flash = 0;
  }

  waterHex(y, tod) {
    let r = 0, g = 0, b = 0;
    const t = clamp01((y - (this.base - 2)) / (this.H - this.base + 2));
    for (const k of ['day', 'dusk', 'night']) {
      const c = lerpStops(WATER[k], t), w = tod[k];
      r += c[0] * w; g += c[1] * w; b += c[2] * w;
    }
    const q = (v) => clamp(Math.round(v / 4) * 4, 0, 255).toString(16).padStart(2, '0');
    return '#' + q(r) + q(g) + q(b);
  }

  updatePenguins(dt, sy) {
    for (const p of this.penguins) {
      p.t -= dt;
      const fx = p.floe.x + p.dx;
      if (p.state === 'stand' || p.state === 'walk') {
        if (p.state === 'walk') { p.dx += p.dir * dt * 4; p.f += dt * 6; if (Math.abs(p.dx) > p.floe.R * 0.8) { p.dir *= -1; p.dx = clamp(p.dx, -p.floe.R * 0.8, p.floe.R * 0.8); } }
        if (p.t <= 0) {
          if (p.state === 'stand') { p.state = Math.random() < 0.55 ? 'walk' : 'flap'; p.t = 0.8 + Math.random() * 2; }
          else { p.state = 'stand'; p.t = 1 + Math.random() * 3; if (Math.random() < 0.4) p.dir *= -1; }
        }
      } else if (p.state === 'flap') {
        p.f += dt * 8;
        if (p.t <= 0) { p.state = 'stand'; p.t = 1 + Math.random() * 2; }
      } else if (p.state === 'jump') {
        p.vy += 260 * dt; p.wx += p.vx * dt; p.wy += p.vy * dt;
        if (p.wy > sy + 4) { p.state = 'swim'; p.t = 3.2; p.splash = 0.5; this.bubbles.emit(p.wx, sy + 6, { r: 2 }); this.bubbles.emit(p.wx + 3, sy + 10, { r: 1 }); }
      } else if (p.state === 'swim') {
        const k = 1 - p.t / 3.2;
        p.wx = fx - p.dir * 40 * Math.sin(k * Math.PI) + Math.sin(k * 12) * 2;
        p.wy = sy + 8 + Math.sin(k * Math.PI) * 46;
        if (Math.random() < dt * 5) this.bubbles.emit(p.wx, p.wy - 2, { r: 1, vy: -14 });
        if (p.t <= 0) { p.state = 'hop'; p.t = 0.5; p.wx = fx; p.vy = -110; p.wy = sy; }
      } else if (p.state === 'hop') {
        p.vy += 300 * dt; p.wy += p.vy * dt;
        const fy = sy - 4;
        if (p.wy >= fy && p.vy > 0) { p.state = 'flap'; p.t = 1.4; p.gift = 3; }
      }
      if (p.splash) p.splash = Math.max(0, p.splash - dt);
      if (p.gift) p.gift = Math.max(0, p.gift - dt);
    }
  }

  // ------------------------------------------------------------------ draw
  drawBack(ctx, env) {
    this.nearHooked = !!this.nearSeen;
    this.nearSeen = false;
    const W = this.W, H = this.H, t = this.t, tod = this.tod, wx = this.wx;
    const sy = this.surfaceAt(env);
    const ys = this.ys;
    let top = H;
    for (let x = 0; x <= W; x++) if (ys[x] < top) top = ys[x];
    const water = this.waterBlend.get([[this.water.day, tod.day], [this.water.dusk, tod.dusk], [this.water.night, tod.night]]);
    const view = env.view;
    const y0 = view ? Math.floor(view.y0) - 2 : -10, y1 = view ? Math.ceil(view.y1) + 2 : H;
    const hasAir = top > y0 - 4;
    if (hasAir) {
      this.drawSky(ctx, env, y0);
      const wp = new Path2D();
      wp.moveTo(0, y1);
      waveRuns(ys, W, (x0, len, y) => { wp.lineTo(x0, y); wp.lineTo(x0 + len, y); });
      wp.lineTo(W, y1);
      wp.closePath();
      ctx.fillStyle = ctx.createPattern(water, 'repeat');
      ctx.fill(wp);
    } else fillWith(ctx, water, 0, y0, W, y1 - y0);
    const key = this.waterBlend.key;
    const px = this.par.x, py = this.par.y;
    const wob = quality(env) >= 1 ? 1 : 0;
    drawWobble(ctx, this.farA.tint(water, 0.72, key), -this.pad + px * 0.8, this.farAY + py * 0.4, t, wob, 4, 0.8, 0.07);
    this.drawGiant(ctx);
    drawWobble(ctx, this.farB.tint(water, 0.62, key), -this.pad + px * 1.4, this.farBY + py * 0.5, t + 2, wob, 4, 1, 0.09);
    this.bands.draw(ctx, 2, tod, px * 2, py * 0.6);
    ctx.drawImage(this.haze.tint(water, 1, key), 0, this.hazeY);
    this.decor.draw(ctx, 2, t, px * 2, py * 0.6, 1 + wx.bliz * 0.6);
    this.drawGlints(ctx, 2, px * 2, py * 0.6);
    this.drawFlock(ctx);
    const murk = wx.snow * 0.06 + wx.bliz * 0.14;
    if (murk > 0.01) { ctx.fillStyle = rgba(tod.night > 0.5 ? '#0a1424' : '#8aa4b4', murk); ctx.fillRect(0, Math.max(y0, top), W, y1 - Math.max(y0, top)); }
    this.drawSurface(ctx, env, sy);
  }

  drawSky(ctx, env, y0) {
    const W = this.W, t = this.t, tod = this.tod, wx = this.wx, base = this.base;
    ctx.drawImage(this.skyBlend.get([[this.sky.day, tod.day], [this.sky.dusk, tod.dusk], [this.sky.night, tod.night]]), 0, this.skyY);
    const visTop = y0 < base - 120;
    const oc = clamp01(wx.snow * 0.7 + wx.bliz * 0.9);
    const clear = 1 - oc;
    if (visTop) {
      // twinkling stars
      if (tod.night > 0.15 && clear > 0.1) for (const s of this.stars) twinkle(ctx, s.x, s.y, (0.4 + 0.6 * Math.sin(t * s.f + s.ph)) * tod.night * clear, s.c);
      // aurora
      const au = clamp01((tod.night * 0.65 + tod.dusk * 0.25 + wx.aurora * (0.55 + tod.night * 0.45) + tod.day * wx.aurora * 0.12) * clear * (0.4 + wx.aurora * 0.6));
      if (au > 0.04) this.drawAurora(ctx, au);
      // wispy clouds / snow clouds
      for (const cl of this.clouds) {
        ctx.globalAlpha = (0.25 + oc * 0.6) * (1 - tod.night * 0.6);
        ctx.drawImage(cl.tile, Math.round(cl.x), cl.y);
      }
      ctx.globalAlpha = 1;
      // terns
      const ba = (tod.day + tod.dusk) * (1 - wx.bliz) * clear;
      if (ba > 0.05) {
        ctx.fillStyle = tod.dusk > 0.5 ? '#3a2438' : '#2c3448';
        ctx.globalAlpha = ba;
        for (const b of this.birds) {
          const x = Math.round(b.x), y = Math.round(b.y + Math.sin(b.ph * 0.3) * 4), f = Math.sin(b.ph) > 0 ? 0 : 1;
          if (f === 0) { ctx.fillRect(x - 3, y - 2, 1, 1); ctx.fillRect(x - 2, y - 1, 2, 1); ctx.fillRect(x, y, 1, 1); ctx.fillRect(x + 1, y - 1, 2, 1); ctx.fillRect(x + 3, y - 2, 1, 1); }
          else { ctx.fillRect(x - 3, y, 3, 1); ctx.fillRect(x, y, 1, 1); ctx.fillRect(x + 1, y, 3, 1); }
        }
        ctx.globalAlpha = 1;
      }
    }
    // overcast & falling snow over the sky
    if (oc > 0.02) {
      ctx.globalAlpha = oc * 0.75;
      fillWith(ctx, this.ocBlend.get([[this.overcast.day, tod.day], [this.overcast.dusk, tod.dusk], [this.overcast.night, tod.night]]), 0, this.skyY, W, base - 20 - this.skyY);
      ctx.globalAlpha = oc * 0.45;
      ctx.drawImage(this.ocBlend.layer.canvas, 0, 0, 8, 8, 0, 0, 0, 0);
      ctx.globalAlpha = 1;
      // haze over the mountains too
      ctx.fillStyle = rgba(tod.night > 0.5 ? '#141c2a' : '#c8d4de', oc * 0.35);
      ctx.fillRect(0, this.skyY, W, base + 2 - this.skyY);
    }
    if (wx.snow > 0.05 || wx.bliz > 0.05) {
      const n = Math.round(this.airSnow.list.length * clamp01(wx.snow + wx.bliz));
      ctx.fillStyle = tod.night > 0.5 ? '#a8b8d0' : '#ffffff';
      for (let i = 0; i < n; i++) {
        const p = this.airSnow.list[i];
        const x = Math.round(p.x + Math.sin(t * 0.8 + p.ph) * 4), y = Math.round(p.y);
        if (y > this.ys[clamp(x, 0, W)] - 1) continue;
        ctx.globalAlpha = p.a;
        ctx.fillRect(x, y, p.s, p.s);
      }
      if (wx.bliz > 0.05) {
        const tile = this.blizTile, oy = Math.floor((t * 90) % tile.height), ox = Math.floor((t * 420) % tile.width);
        ctx.save();
        ctx.globalAlpha = wx.bliz * 0.55;
        const pat = ctx.createPattern(tile, 'repeat');
        pat.setTransform(new DOMMatrix([1, 0, 0, 1, ox, oy]));
        ctx.fillStyle = pat;
        ctx.fillRect(0, this.skyY, W, base - this.skyY);
        ctx.restore();
      }
      ctx.globalAlpha = 1;
    }
  }

  // Aurora: two curtains in thin vertical strips, each strip lifted by travelling sines, additive.
  drawAurora(ctx, a) {
    const t = this.t, W = this.W;
    const op = ctx.globalCompositeOperation;
    ctx.globalCompositeOperation = 'lighter';
    const conf = [[this.aurora[0], this.top + 26, 6, 0.9], [this.aurora[1], this.top + 96, -9, 0.6]];
    for (const [tex, y0, sp, am] of conf) {
      const off = Math.floor(((t * sp) % tex.width + tex.width) % tex.width);
      for (let x = 0; x < W; x += 3) {
        const sx = (x + off) % (tex.width - 3);
        const dy = Math.sin(x * 0.011 + t * 0.21) * 16 + Math.sin(x * 0.027 - t * 0.37) * 6;
        ctx.globalAlpha = clamp01(a * am * (0.7 + 0.3 * Math.sin(x * 0.04 + t * 0.9)));
        ctx.drawImage(tex, sx, 0, 3, tex.height, x, Math.round(y0 + dy), 3, tex.height);
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = op;
  }

  drawGiant(ctx) {
    const gi = this.giant;
    if (!gi) return;
    const fr = gi.kind === 'beluga' ? (gi.dir > 0 ? this.beluga : this.belugaL) : gi.dir > 0 ? this.sealS : this.sealSL;
    const spr = fr[Math.floor((((gi.ph / TAU) * fr.length) % fr.length + fr.length) % fr.length)];
    const c = tinted(spr, gi.kind === 'beluga' ? '#7ab8d0' : '#0e3a56');
    ctx.globalAlpha = gi.kind === 'beluga' ? 0.32 : 0.36;
    const s = gi.s || 1, w = Math.round(spr.width * s), h = Math.round(spr.height * s);
    ctx.drawImage(c, Math.round(gi.x - w / 2 + this.par.x * 1.1), Math.round(gi.y - h / 2 + this.par.y * 0.5), w, h);
    ctx.globalAlpha = 1;
  }

  drawFlock(ctx) {
    const F = this.flock;
    if (!F) return;
    const fr = F.dir > 0 ? this.penguin : this.penguinL;
    for (const p of F.birds) {
      if (p.x < -20 || p.x > this.W + 20) continue;
      const spr = fr[4 + (Math.floor(this.t * 10 + p.ph) % 2)];
      ctx.globalAlpha = 0.85;
      ctx.drawImage(spr, Math.round(p.x - 7), Math.round(p.y - 3));
    }
    ctx.globalAlpha = 1;
  }

  drawSurface(ctx, env, sy) {
    if (sy < -40) return;
    const W = this.W, ys = this.ys, t = this.t, tod = this.tod, wx = this.wx;
    const crest = new Path2D(), sub = new Path2D(), band = new Path2D();
    const sh = this.shimmer, shH = sh.height;
    waveRuns(ys, W, (x0, len, y) => { crest.rect(x0, y, len, 1); sub.rect(x0, y + 1, len, 2); band.rect(x0, y + 2, len, shH + 2); });
    ctx.fillStyle = this.cols.sub;
    ctx.globalAlpha = 0.55;
    ctx.fill(sub);
    ctx.globalCompositeOperation = 'lighter';
    const a1 = (0.5 - tod.night * 0.25) * (1 - wx.bliz * 0.4);
    const o1 = Math.floor((t * 7) % 256), o2 = Math.floor((256 - ((t * 4) % 256)) % 256);
    const p1 = ctx.createPattern(sh, 'repeat-x');
    p1.setTransform(new DOMMatrix([1, 0, 0, 1, -o1, sy + 2]));
    ctx.globalAlpha = a1;
    ctx.fillStyle = p1;
    ctx.fill(band);
    const p2 = ctx.createPattern(sh, 'repeat-x');
    p2.setTransform(new DOMMatrix([1, 0, 0, 1, -o2, sy + 1]));
    ctx.globalAlpha = a1 * 0.6;
    ctx.fillStyle = p2;
    ctx.fill(band);
    // aurora / sun glitter on the water
    const au = wx.aurora * tod.night;
    const s = tod.night > 0.5 ? this.sun.night : tod.dusk > 0.4 ? this.sun.dusk : this.sun.day;
    const sx = s[0] * W;
    ctx.fillStyle = au > 0.3 ? '#7affb0' : tod.night > 0.5 ? '#c8dcff' : tod.dusk > 0.4 ? '#ffd090' : '#ffffff';
    for (let i = 0; i < 22; i++) {
      const ph = Math.floor(t * 3 + i * 0.61);
      const x = Math.round((au > 0.3 ? W * 0.5 : sx) + (hash2(i, ph, 5) - 0.5) * (au > 0.3 ? W * 0.8 : 40 + i * 3));
      if (x < 0 || x >= W) continue;
      ctx.globalAlpha = Math.sin(((t * 3 + i * 0.61) % 1) * Math.PI) * wx.clear * 0.85;
      ctx.fillRect(x, ys[x] + 1 + Math.floor(hash2(i, ph, 6) * 6), 2 + Math.floor(hash2(i, ph, 7) * 3), 1);
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = this.cols.crest;
    ctx.fill(crest);
    if (wx.bliz > 0.2) {
      ctx.fillStyle = '#ffffff';
      ctx.globalAlpha = wx.bliz;
      for (let x = 1; x < W; x++) if (ys[x] < ys[x - 1] && ys[x] <= ys[x + 1] && hash2(x, Math.floor(t * 4), 1) < 0.6) ctx.fillRect(x - 1, ys[x] - 1, 3, 1);
      ctx.globalAlpha = 1;
    }
    this.drawFloes(ctx, env);
  }

  drawFloes(ctx, env) {
    const ys = this.ys, W = this.W, t = this.t, tod = this.tod;
    const night = tod.night;
    for (const f of this.floes) {
      const x = Math.round(f.x);
      if (x < -60 || x > W + 60) continue;
      const wl = ys[clamp(x, 0, W)] + Math.round(Math.sin(t * 1.1 + f.ph) * 0.8);
      const p = f.spr;
      // keel (translucent, under the waterline)
      ctx.globalAlpha = 0.75 - night * 0.3;
      ctx.drawImage(f.keel, x - (f.keel.width >> 1), wl + 1);
      ctx.globalAlpha = 1;
      ctx.drawImage(p.canvas, x - p.ox, wl - p.oy + 3);
      if (night > 0.3) { ctx.fillStyle = rgba('#0a1430', night * 0.45); ctx.fillRect(x - p.ox, wl - p.oy + 3, p.w, p.oy); }
      f.top = wl - p.oy + 6;
      if (f.who === 2) {
        const fr = this.seal[Math.floor(t * 0.7) % 4 === 0 ? 1 + (Math.floor(t * 3) % 2) : 0];
        ctx.drawImage(fr, x - 14, f.top - 10);
      }
    }
    // penguins on (or around) their floe
    for (const p of this.penguins) {
      const fl = p.floe, fx = Math.round(fl.x + p.dx);
      const fr = p.dir > 0 ? this.penguin : this.penguinL;
      if (p.state === 'swim') continue;
      let spr, x, y;
      if (p.state === 'jump' || p.state === 'hop') { spr = fr[3]; x = Math.round(p.wx) - 5; y = Math.round(p.wy) - 12; }
      else {
        spr = p.state === 'walk' ? fr[1 + (Math.floor(p.f) % 2)] : p.state === 'flap' ? fr[Math.floor(p.f) % 2 ? 3 : 0] : fr[0];
        x = fx - 5; y = (fl.top ?? this.base) - 13;
      }
      ctx.drawImage(spr, x, y);
      if (p.gift > 0 && p.state !== 'jump') { ctx.fillStyle = '#ffd84a'; ctx.fillRect(x + (p.dir > 0 ? 9 : 0), y + 4, 2, 2); twinkle(ctx, x + (p.dir > 0 ? 10 : 1), y + 3, Math.sin(p.gift * 4) * 0.5 + 0.5, '#fff6b0'); }
      if (p.secret && !this.secrets().fjord_penguin && p.state === 'stand') {
        const hk = ((this.hint + 1) % 8) / 8;
        if (hk < 0.12) twinkle(ctx, x + 5, y - 3, Math.sin((hk / 0.12) * Math.PI), '#ffffff');
      }
    }
  }

  drawSeabed(ctx, env) {
    const t = this.t, tod = this.tod, wx = this.wx, q = quality(env);
    const sy = this.surfaceAt(env);
    // god rays: sunlight by day, aurora-green by night
    const au = wx.aurora * tod.night;
    const rayA = (tod.day * 0.9 + tod.dusk * 0.7 + tod.night * (0.2 + au * 0.6)) * (0.25 + wx.clear * 0.75) * (1 - wx.bliz * 0.6);
    if (rayA > 0.02) {
      const rc = au > 0.3 ? qmix('#a8c8ff', '#7affb8', au) : tri('#f4fcff', '#ffc08a', '#a8c8ff', tod);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = rayA * (0.75 + 0.25 * Math.sin(t * 0.33));
      ctx.drawImage(this.raysA.tint(rc, 1, rc), Math.round(Math.sin(t * 0.05) * 14), sy - 2);
      ctx.globalAlpha = rayA * (0.6 + 0.4 * Math.sin(t * 0.47 + 2));
      ctx.drawImage(this.raysB.tint(rc, 1, rc), Math.round(Math.sin(t * 0.04 + 1) * 20), sy - 2);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    }
    this.slush.draw(ctx, t, 0.55 + wx.snow * 0.35 + tod.day * 0.2, q * (0.45 + wx.snow * 0.35 + wx.bliz * 0.2), 0.3);
    const dx = this.par.x * 3, dy = this.par.y * 0.8;
    this.bands.draw(ctx, 1, tod, dx, dy);
    const ca = this.causticA(q);
    if (ca > 0.01) this.caustics.draw(ctx, this.masks[1], -this.D.pad + dx, this.D.bands[1].y + dy, t, ca * 0.75, { fps: 7, drift: 3, offset: 5 });
    this.decor.draw(ctx, 1, t, dx, dy, 1 + wx.bliz * 0.6);
    this.drawGlints(ctx, 1, dx, dy);
    if (!this.nearHooked) this.paintNear(ctx, env);
  }

  causticA(q) {
    const tod = this.tod, wx = this.wx;
    if (q < 0.75) return 0;
    return (tod.day * 0.48 + tod.dusk * 0.3 + tod.night * (0.08 + wx.aurora * 0.25)) * (0.25 + wx.clear * 0.75);
  }

  drawGlints(ctx, b, dx, dy) {
    const t = this.t;
    for (const g of this.glints) {
      if (g.band !== b) continue;
      const p = ((t + g.ph) % g.p) / g.p;
      if (p < 0.08) twinkle(ctx, g.x + dx, g.y + dy, Math.sin((p / 0.08) * Math.PI), '#ffffff');
    }
  }

  drawNear(ctx, env) {
    this.nearSeen = true;
    if (this.nearHooked) this.paintNear(ctx, env);
  }

  paintNear(ctx, env) {
    const t = this.t, tod = this.tod, wx = this.wx, q = quality(env);
    const dx = this.par.x * 4, dy = this.par.y;
    this.bands.draw(ctx, 0, tod, dx, dy);
    const ca = this.causticA(q);
    if (ca > 0.01) this.caustics.draw(ctx, this.masks[0], -this.D.pad + dx, this.D.bands[0].y + dy, t, ca, { fps: 7, drift: 4 });
    ctx.save();
    ctx.translate(Math.round(dx), Math.round(dy));
    this.drawCrystals(ctx);
    this.drawChest(ctx);
    ctx.restore();
    this.decor.draw(ctx, 0, t, dx, dy, 1 + wx.bliz * 0.6);
    this.drawGlints(ctx, 0, dx, dy);
    // the penguin swimming under the floe (secret)
    for (const p of this.penguins) {
      if (p.state !== 'swim') continue;
      const fr = p.dir > 0 ? this.penguinL : this.penguin;
      ctx.drawImage(fr[4 + (Math.floor(t * 10) % 2)], Math.round(p.wx) - 7, Math.round(p.wy) - 3);
    }
    this.bubbles.draw(ctx, t);
  }

  drawCrystals(ctx) {
    const t = this.t, solved = !!this.secrets().fjord_song;
    for (const c of this.crystals) {
      const s = c.spr;
      const wob = c.lit > 0.6 ? Math.round(Math.sin(t * 50) * (c.lit - 0.6) * 3) : 0;
      ctx.drawImage(s.canvas, c.x - s.ox + wob, c.y - s.oy);
      const g = c.lit + (solved ? 0.25 + 0.15 * Math.sin(t * 1.5 + c.size) : 0);
      if (g > 0.03) {
        if (s.glow) { ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = clamp01(g); ctx.drawImage(s.glow, c.x - s.ox, c.y - s.oy); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; }
        drawGlow(ctx, c.cx, c.cy, 8 + c.size * 2, '#bff8ff', g * 0.8);
      }
    }
    if (!solved) {
      const p = (this.hint % 9) / 9;
      const small = this.crystals.find((c) => c.size === 0);
      if (p < 0.1) twinkle(ctx, small.cx + 2, small.cy - 4, Math.sin((p / 0.1) * Math.PI), '#ffffff');
    }
  }

  drawChest(ctx) {
    const c = this.chest, t = this.t;
    const opened = c.open || this.secrets().fjord_chest;
    const p = opened ? this.chestOpen : this.chestProp;
    const sx = Math.round(Math.sin(t * 60) * c.shake * 2);
    ctx.drawImage(p.canvas, c.x - p.ox + sx, c.y - p.oy);
    if (opened) {
      const k = (t % 3) / 3;
      if (k < 0.15) twinkle(ctx, c.x + 3, c.y - p.oy + 4, Math.sin((k / 0.15) * Math.PI), '#fff6b0');
      if (c.open && c.t < 1.5) {
        // falling shards
        for (let i = 0; i < 10; i++) {
          const a = i * 0.63, sp = 20 + (i % 4) * 9;
          const x = c.x + Math.cos(a) * sp * c.t, y = c.y - 14 + Math.sin(a) * sp * c.t * 0.6 + 50 * c.t * c.t;
          ctx.globalAlpha = 1 - c.t / 1.5;
          ctx.fillStyle = i % 2 ? '#e8fdff' : '#9ae4f4';
          ctx.fillRect(Math.round(x), Math.round(y), 2, 2);
        }
        ctx.globalAlpha = 1;
      }
      return;
    }
    // the ice block around the chest
    const r = c.rect;
    const x0 = r.x + sx, y0 = r.y, w = r.w, h = r.h;
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = '#9ae6f6';
    ctx.fillRect(x0 + 1, y0, w - 2, h);
    ctx.fillRect(x0, y0 + 1, w, h - 2);
    ctx.globalAlpha = 0.75;
    ctx.fillStyle = '#e8fdff';
    ctx.fillRect(x0 + 1, y0, w - 2, 1);
    ctx.fillRect(x0, y0 + 1, 1, h - 3);
    ctx.fillRect(x0 + 3, y0 + 3, 1, 6); ctx.fillRect(x0 + 5, y0 + 3, 1, 3);
    ctx.fillStyle = '#5ab4d4';
    ctx.fillRect(x0 + w - 1, y0 + 2, 1, h - 3);
    ctx.fillRect(x0 + 2, y0 + h - 1, w - 3, 1);
    ctx.globalAlpha = 1;
    // cracks spread with each knock
    ctx.fillStyle = '#ffffff';
    const cr = c.cracks;
    if (cr >= 1) for (let i = 0; i < 7; i++) ctx.fillRect(x0 + w - 6 - i, y0 + 2 + i + (i > 3 ? 1 : 0), 1, 1);
    if (cr >= 2) { for (let i = 0; i < 9; i++) ctx.fillRect(x0 + 4 + i, y0 + h - 4 - Math.round(i * 0.7), 1, 1); for (let i = 0; i < 5; i++) ctx.fillRect(x0 + w / 2 + i, y0 + 4 + i * 2, 1, 1); }
    if (!this.secrets().fjord_chest) {
      const hk = ((this.hint + 3) % 7) / 7;
      if (hk < 0.12) twinkle(ctx, x0 + w - 3, y0 + 2, Math.sin((hk / 0.12) * Math.PI), '#ffffff');
    }
  }

  drawFront(ctx, env) {
    const t = this.t, tod = this.tod, wx = this.wx, q = quality(env);
    this.nearMotes.draw(ctx, t, 0.75 + tod.day * 0.3, q);
    // twinkling ice motes
    const n = Math.round(this.iceMotes.list.length * q);
    for (let i = 0; i < n; i++) {
      const p = this.iceMotes.list[i];
      const k = 0.5 + 0.5 * Math.sin(t * p.tw * 1.6 + p.ph);
      if (k < 0.55) continue;
      const x = p.x + Math.sin(t * 0.6 + p.ph) * 5, y = p.y + Math.cos(t * 0.4 + p.ph) * 3;
      twinkle(ctx, x, y, (k - 0.5) * 2 * (0.5 + tod.day * 0.3 + tod.night * wx.aurora * 0.4), p.c);
    }
    if (this.songT > 0) {
      ctx.fillStyle = rgba('#c8fff0', this.songT * 0.06);
      ctx.fillRect(0, env.view ? env.view.y0 : 0, this.W, this.H + 400);
    }
  }

  // ------------------------------------------------------------------ lighting
  lighting(env) {
    const tod = todWeights(env), wx = this.wx;
    let dark = tod.night * 0.5 + tod.dusk * 0.12 + wx.snow * 0.05 + wx.bliz * 0.14;
    dark -= wx.aurora * tod.night * 0.08;
    dark *= 1 - skyward(env, this.H) * 0.45;
    let tint = qmix('#a86a74', '#1a2c66', tod.night / Math.max(0.001, tod.night + tod.dusk));
    if (wx.aurora > 0.2 && tod.night > 0.3) tint = qmix(tint, '#0e3a3a', wx.aurora * 0.5);
    const lights = [];
    if (dark > 0.04) {
      const n = tod.night;
      if (wx.aurora > 0.1) for (const xf of [0.25, 0.55, 0.8]) lights.push({ x: this.W * xf, y: this.base + 30, r: 170, color: xf === 0.55 ? '#9a7aff' : '#5affb0', a: 0.4 * n * wx.aurora });
      const m = this.sun.night;
      if (n > 0.2 && wx.clear > 0.3) lights.push({ x: m[0] * this.W, y: Math.max(0, this.base) + 10, r: 150, color: '#7a9ad8', a: 0.4 * n * wx.clear });
      for (const c of this.crystals) if (c.lit > 0.05 || this.secrets().fjord_song) lights.push({ x: c.cx, y: c.cy, r: 30 + c.size * 6, color: '#bff8ff', a: Math.max(c.lit, 0.3) * 0.9 });
      for (const q of this.D.items) if (q.p?.glow && q.z < 0.8) lights.push({ x: q.x, y: q.top + q.p.oy * 0.5, r: 34 * q.s + 10, color: '#9af0ff', a: 0.3 * n * (1 - this.D.fog(q.z) * 0.7) });
      if (this.chest.open || this.secrets().fjord_chest) lights.push({ x: this.chest.x, y: this.chest.y - 10, r: 30, color: '#ffe27a', a: 0.45 * n + 0.1 });
    }
    return { dark: clamp(dark, 0, 0.62), tint, lights };
  }

  // ------------------------------------------------------------------ secrets
  secretAt(x, y) {
    for (const p of this.penguins) {
      if (!p.secret || (p.state !== 'stand' && p.state !== 'walk' && p.state !== 'flap')) continue;
      const fx = p.floe.x + p.dx, fy = (p.floe.top ?? this.base) - 13;
      if (inRect(x, y, { x: fx - 6, y: fy - 2, w: 12, h: 16 }, 2)) return 'penguin';
    }
    if (!this.chest.open && !this.secrets().fjord_chest && inRect(x, y, this.chest.rect, 2)) return 'chest';
    for (let i = 0; i < this.crystals.length; i++) if (inRect(x, y, this.crystals[i].rect, 2)) return 'crystal' + i;
    return null;
  }

  onSecret(id, game) {
    const st = game.state;
    st.secrets ||= {};
    const audio = game.audio, fx = game.particles;
    if (id === 'penguin') {
      const p = this.penguins.find((q) => q.secret);
      p.state = 'jump'; p.wx = p.floe.x + p.dx; p.wy = (p.floe.top ?? this.base) - 6; p.vx = -p.dir * 18; p.vy = -90;
      audio?.play?.('penguin', { vol: 0.6 });
      setTimeout(() => audio?.play?.('splash_small', { vol: 0.5 }), 450);
      if (!st.secrets.fjord_penguin) {
        st.secrets.fjord_penguin = true;
        setTimeout(() => {
          const c = 30 + Math.floor(Math.random() * 20);
          game.addCoins?.(c, p.floe.x, this.base - 10);
          audio?.play?.('coin_spawn');
          game.toast?.(`The penguin pops back up with a shiny pebble for you. It is a coin. +${c} coins`, 'coin');
          game.save?.();
        }, 4200);
        game.toast?.('Pingu dives for something...', 'info');
      } else game.toast?.(['The penguin does a little bow before diving.', 'Splash! Showing off again.', 'It returns with a fish. For itself.'][Math.floor(Math.random() * 3)], 'info');
      return;
    }
    if (id === 'chest') {
      const c = this.chest;
      c.cracks++;
      c.shake = 1;
      audio?.play?.('ice_crack', { vol: 0.6, pitch: 0.9 + c.cracks * 0.1 });
      for (let i = 0; i < 5; i++) fx?.burst?.(c.x + (Math.random() - 0.5) * 20, c.y - 10, 1, { colors: ['#e8fdff', '#9ae4f4'], g: 40, speed: 30 });
      if (c.cracks >= 3) {
        c.open = true; c.t = 0;
        st.secrets.fjord_chest = true;
        const coins = 60 + Math.floor(Math.random() * 40);
        audio?.play?.('treasure_open');
        setTimeout(() => audio?.play?.('sparkle'), 300);
        game.addCoins?.(coins, c.x, c.y - 20);
        for (let i = 0; i < 10; i++) fx?.sparkle?.(c.x + (Math.random() - 0.5) * 40, c.y - 10 - Math.random() * 30, '#fff2a0');
        game.toast?.(`The ice shatters! The old captain's chest was full of frozen gold. +${coins} coins`, 'coin');
        game.save?.();
      } else game.toast?.(c.cracks === 1 ? 'Something glints inside a block of old ice. It cracks a little.' : 'Crack! Almost...', 'info');
      return;
    }
    if (id.startsWith('crystal')) {
      const cr = this.crystals[Number(id.slice(7))];
      if (!cr) return;
      cr.lit = 1;
      audio?.play?.('ice_chime', { pitch: [1.6, 1.3, 1.1, 0.85][cr.size], vol: 0.7 });
      if (st.secrets.fjord_song) return;
      if (cr.size === this.seq.length) {
        this.seq.push(cr.size);
        if (this.seq.length === 1 && !this.hinted) { this.hinted = true; game.toast?.('The crystal sings. Its neighbours hum along, waiting their turn...', 'info'); }
        if (this.seq.length === this.crystals.length) {
          st.secrets.fjord_song = true;
          this.seq = [];
          this.songT = 3;
          const coins = 50;
          setTimeout(() => { audio?.play?.('magic'); for (const c of this.crystals) c.lit = 1; }, 350);
          game.addCoins?.(coins, cr.cx, cr.cy - 20);
          game.toast?.(`The crystals ring in harmony and the whole fjord shimmers. +${coins} coins. (The aurora answers at night...)`, 'star');
          game.save?.();
        }
      } else {
        this.seq = [];
        setTimeout(() => audio?.play?.('ui_error', { vol: 0.35 }), 200);
        if (!this.hinted2) { this.hinted2 = true; game.toast?.('A dull clunk. An icy whisper: "Little ones first..."', 'info'); }
      }
    }
  }
}
