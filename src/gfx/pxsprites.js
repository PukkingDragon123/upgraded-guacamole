// Hand-drawn 2D pixel-art particle sprite sheets (phase 8, UI & Particles agent).
// Small sprites are authored as ASCII (o = outline, 1..4 = shadow -> highlight, w = white); bigger or rotating
// ones are rasterised from shapes with the same 5-step ramps, a top-left light, bayer-dithered steps and a crisp
// selective outline. Every sheet is built once per (name, ramp, size) and cached.
//
//   RAMPS                          { name: [outline, shadow, base, light, highlight] }
//   pxFrames(name, ramp, size) -> [canvas...]   frames of one sheet (size: 0 small | 1 normal | 2 big)
//   PX_SHEETS                      names: sparkle star heart drop aero bubble pop scale leaf petal puff smoke dust
//                                  zap spark impact confetti ribbon wave note shard
//   rampOf(nameOrHex) -> ramp      named ramp, or a ramp derived from any '#rrggbb'

import { makeCanvas, ctxOf } from '../core/canvas.js';
import { pack, shade, mix } from '../core/color.js';
import { bayer, TAU } from '../core/math.js';
import { PixelBuffer } from './pixel.js';

export const RAMPS = {
  gold: ['#7a3a12', '#d8741c', '#ffc23a', '#ffe98a', '#fffbe0'],
  pink: ['#7a1e4a', '#d8406e', '#ff6f9a', '#ffb0c8', '#ffffff'],
  red: ['#6a0e22', '#c42a3a', '#ff5a6a', '#ffa8a8', '#ffffff'],
  aqua: ['#0b3f78', '#1a7ed0', '#3cc0f4', '#a8ecff', '#ffffff'],
  sky: ['#0a3e74', '#2a88d8', '#5cc0f4', '#b4ecff', '#ffffff'],
  cyan: ['#0a4a5a', '#16a8c8', '#5ff4ff', '#c8fcff', '#ffffff'],
  lime: ['#1d5a12', '#3c9a24', '#7ad83a', '#c8f56a', '#f4ffd8'],
  leaf: ['#16461c', '#2e8a2a', '#5ccf3a', '#a8ec5a', '#e8ffc0'],
  mint: ['#0e4a3a', '#22a07a', '#4fe0a8', '#a8ffd8', '#ffffff'],
  purple: ['#3a1a7a', '#6a3acc', '#a674f4', '#d8bcff', '#ffffff'],
  orange: ['#7a2a06', '#e66c0c', '#ffa83c', '#ffd890', '#fff6e0'],
  white: ['#3c6f88', '#9ec8de', '#e4f6ff', '#ffffff', '#ffffff'],
  foam: ['#5a9ab8', '#b8e8f8', '#eefbff', '#ffffff', '#ffffff'],
  smoke: ['#4a4a62', '#8a8ea8', '#b8bccc', '#dfe2ec', '#ffffff'],
  dust: ['#5a4030', '#9a7a58', '#c8a880', '#e8d4b0', '#fff4e0'],
  ink: ['#0a0614', '#1a1030', '#2a1a44', '#3a2a5a', '#5a4a7a'],
  steel: ['#2a3444', '#5a6a80', '#97a2b8', '#d3dae6', '#ffffff'],
  peach: ['#7a3020', '#e0704a', '#ff9a7a', '#ffd0b8', '#ffffff'],
};

const derived = new Map();
export function rampOf(r) {
  if (Array.isArray(r)) return r;
  if (RAMPS[r]) return RAMPS[r];
  if (typeof r === 'string' && r[0] === '#') {
    let d = derived.get(r);
    if (!d) { d = [shade(r, -0.6), shade(r, -0.25), r, mix(r, '#ffffff', 0.5), mix(r, '#ffffff', 0.85)]; derived.set(r, d); }
    return d;
  }
  return RAMPS.white;
}

// ---------------------------------------------------------------- ASCII art
// o outline, 1..4 ramp, w white, k ink, '.' transparent
const ART = {
  heart: [[
    '.oo...oo.',
    'o34o.o22o',
    'o3422222o',
    'o3222221o',
    '.o22221o.',
    '..o221o..',
    '...o1o...',
    '....o....',
  ]],
  heart0: [[
    '.oo.oo.',
    'o42o22o',
    'o32221o',
    '.o221o.',
    '..o1o..',
    '...o...',
  ]],
  star: [[
    '....o....',
    '...o4o...',
    '...o3o...',
    'ooo332ooo',
    'o4333222o',
    '.o33222o.',
    '.o32o21o.',
    '.o2o.o1o.',
    '.oo...oo.',
  ], [
    '....o....',
    '...o4o...',
    '...o4o...',
    'ooo443ooo',
    'o4443332o',
    '.o44332o.',
    '.o43o32o.',
    '.o3o.o2o.',
    '.oo...oo.',
  ]],
  star0: [[
    '...o...',
    '..o4o..',
    'oo332oo',
    'o43322o',
    '.o322o.',
    'o32o21o',
    'oo...oo',
  ], [
    '...o...',
    '..o4o..',
    'oo443oo',
    'o44433o',
    '.o433o.',
    'o43o32o',
    'oo...oo',
  ]],
  sparkle: [[
    '.......',
    '.......',
    '...3...',
    '..343..',
    '...3...',
    '.......',
    '.......',
  ], [
    '.......',
    '...3...',
    '...4...',
    '.34w43.',
    '...4...',
    '...3...',
    '.......',
  ], [
    '...2...',
    '...3...',
    '..343..',
    '23www32',
    '..343..',
    '...3...',
    '...2...',
  ], [
    '.......',
    '...3...',
    '...4...',
    '.34w43.',
    '...4...',
    '...3...',
    '.......',
  ], [
    '.......',
    '.......',
    '...2...',
    '..232..',
    '...2...',
    '.......',
    '.......',
  ]],
  sparkle0: [[
    '...',
    '.3.',
    '...',
  ], [
    '.3.',
    '3w3',
    '.3.',
  ], [
    '.2.',
    '2w2',
    '.2.',
  ], [
    '...',
    '.2.',
    '...',
  ]],
  drop: [[
    '..o..',
    '.o3o.',
    'o432o',
    'o322o',
    'o221o',
    '.ooo.',
  ]],
  drop0: [[
    '.o.',
    'o3o',
    'o2o',
    '.o.',
  ]],
  aero: [[
    '...o...',
    '..o3o..',
    '..o3o..',
    '.o432o.',
    'o44322o',
    'o43222o',
    'o32221o',
    '.o211o.',
    '..ooo..',
  ]],
  scale: [[
    '.ooo.',
    'o432o',
    'o322o',
    'o221o',
    '.o1o.',
    '..o..',
  ], [
    '.o.',
    'o3o',
    'o2o',
    'o2o',
    'o1o',
    '.o.',
  ], [
    '.ooo.',
    'o234o',
    'o223o',
    'o122o',
    '.o1o.',
    '..o..',
  ], [
    '.o.',
    'o4o',
    'o3o',
    'o2o',
    'o1o',
    '.o.',
  ]],
  pop: [[
    '.......',
    '.4...4.',
    '..3.3..',
    '.......',
    '..3.3..',
    '.4...4.',
    '.......',
  ], [
    '4.....4',
    '.3...3.',
    '.......',
    '.......',
    '.......',
    '.3...3.',
    '4.....4',
  ], [
    '3.....3',
    '.......',
    '.......',
    '.......',
    '.......',
    '.......',
    '3.....3',
  ]],
  note: [[
    '...ooo',
    '...o4o',
    '...o3o',
    '...o3o',
    '.ooo2o',
    'o4332o',
    'o3221o',
    '.oooo.',
  ]],
  wave: [[
    '..4444..',
    '.3....3.',
  ], [
    '..333...',
    '.2...2..',
  ], [
    '..22....',
    '........',
  ]],
  zap: [[
    '...oooo',
    '..o443o',
    '..o43o.',
    '.o43oo.',
    '.o4333o',
    '.oo32o.',
    '..o3o..',
    '.o3o...',
    '.o2o...',
    'o1o....',
    'oo.....',
  ], [
    '...oooo',
    '..o4w4o',
    '..o4wo.',
    '.o4woo.',
    '.o4w44o',
    '.oo43o.',
    '..o4o..',
    '.o4o...',
    '.o3o...',
    'o2o....',
    'oo.....',
  ]],
  spark: [[
    '.3.',
    '3w3',
    '.3.',
  ], [
    '3.3',
    '.w.',
    '3.3',
  ]],
  ribbon: [[
    '33..',
    '.22.',
    '..33',
    '.22.',
    '33..',
  ], [
    '..33',
    '.22.',
    '33..',
    '.22.',
    '..33',
  ], [
    '.3.',
    '.2.',
    '.3.',
    '.2.',
    '.3.',
  ]],
};

function fromAscii(rows, ramp) {
  const w = Math.max(...rows.map((r) => r.length)), h = rows.length;
  const c = makeCanvas(w, h);
  const g = ctxOf(c);
  const map = { o: ramp[0], 1: ramp[1], 2: ramp[2], 3: ramp[3], 4: ramp[4], w: '#ffffff', k: '#14102a' };
  for (let y = 0; y < h; y++) for (let x = 0; x < rows[y].length; x++) {
    const col = map[rows[y][x]];
    if (!col) continue;
    g.fillStyle = col;
    g.fillRect(x, y, 1, 1);
  }
  return c;
}

// ---------------------------------------------------------------- shaded shapes
// inside(x, y) -> bool on pixel centres; nx, ny (optional) -> surface normal for lighting
function shaded(w, h, inside, ramp, o = {}) {
  const buf = new PixelBuffer(w, h);
  const P = ramp.map((c) => pack(c));
  const cx = o.cx ?? w / 2, cy = o.cy ?? h / 2, rx = o.rx ?? w / 2, ry = o.ry ?? h / 2;
  const lx = -0.62, ly = -0.78;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const px = x + 0.5, py = y + 0.5;
    if (!inside(px, py)) continue;
    const nx = (px - cx) / rx, ny = (py - cy) / ry;
    const t = nx * lx + ny * ly; // >0 toward the light
    const v = t + (bayer(x, y) - 0.5) * (o.dither ?? 0.35);
    let lvl = v > 0.55 ? 3 : v > -0.25 ? 2 : 1;
    if (o.flat) lvl = Math.max(2, lvl);
    buf.set(x, y, P[lvl]);
  }
  if (o.spec) {
    const [sx, sy] = o.spec;
    for (const [dx, dy] of o.specShape || [[0, 0], [1, 0], [0, 1]]) if (buf.alpha(sx + dx, sy + dy)) buf.set(sx + dx, sy + dy, P[4]);
  }
  if (o.outline !== false) buf.outline(P[0]);
  return buf.toCanvas();
}

function inPoly(pts) {
  return (x, y) => {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i], [xj, yj] = pts[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };
}

// Pixel bubble: light rim, clear body, chunky white highlight top-left, a small glint bottom-right.
function bubble(r) {
  const s = r * 2 + 1;
  const c = makeCanvas(s, s);
  const g = ctxOf(c);
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const d = Math.hypot(x - r, y - r);
    if (d > r + 0.35) continue;
    if (d > r - 0.75) g.fillStyle = (x + y < s - 1) ? 'rgba(236,252,255,0.95)' : 'rgba(150,226,255,0.9)';
    else g.fillStyle = 'rgba(170,232,255,0.22)';
    g.fillRect(x, y, 1, 1);
  }
  g.fillStyle = '#ffffff';
  if (r <= 2) g.fillRect(r - 1, r - 1, 1, 1);
  else {
    const hx = Math.round(r * 0.5), L = Math.max(2, Math.round(r * 0.5));
    g.fillRect(hx, hx - 1, L, 1);
    g.fillRect(hx - 1, hx, 1, L);
    g.fillRect(hx, hx, 1, 1);
    g.fillStyle = 'rgba(255,255,255,0.85)';
    g.fillRect(s - hx - 1, s - hx - 1, 1, 1);
    if (r >= 5) g.fillRect(s - hx - 2, s - hx - 1, 1, 1);
  }
  return c;
}

// Lumpy cloud puff (foam / smoke / dust): 3-4 overlapping discs, dissolving with a bayer threshold over frames.
function puffFrames(R, ramp, n = 5, seed = 1) {
  const lumps = [[0, 0.15, 0.72], [-0.48, 0.3, 0.5], [0.5, 0.28, 0.55], [0.05, -0.32, 0.55], [-0.25, -0.1, 0.5]];
  const out = [];
  for (let f = 0; f < n; f++) {
    const grow = 0.55 + 0.45 * Math.min(1, (f + 1) / 2.2);
    const s = Math.ceil(R * 2.6) + 2;
    const cx = s / 2, cy = s / 2;
    const inside = (x, y) => lumps.some(([lx, ly, lr]) => Math.hypot(x - (cx + lx * R), y - (cy + ly * R)) < lr * R * grow);
    const c = shaded(s, s, inside, ramp, { cx, cy, rx: R, ry: R, dither: 0.5 });
    if (f >= 2) {
      const cut = (f - 1) / (n - 0.5);
      const g = ctxOf(c);
      const img = g.getImageData(0, 0, s, s);
      const d = img.data;
      for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) if (bayer(x + seed, y) < cut) d[(y * s + x) * 4 + 3] = 0;
      g.putImageData(img, 0, 0);
    }
    out.push(c);
  }
  return out;
}

// Comic impact burst: an 8-spike star that pops, then breaks into flying shards (no rings).
function impactFrames(R, ramp) {
  const out = [];
  const spikes = 8;
  const frames = [[0.45, 0.22, false], [0.85, 0.36, false], [1, 0.42, false], [1, 0.55, true], [1.05, 0.75, true]];
  for (const [k, inner, shards] of frames) {
    const s = Math.ceil(R * 2) + 4, cx = s / 2, cy = s / 2;
    const ro = R * k, ri = R * inner;
    let inside;
    if (!shards) {
      const pts = [];
      for (let i = 0; i < spikes * 2; i++) {
        const a = (i / (spikes * 2)) * TAU - Math.PI / 2;
        const r = i % 2 ? ri * 1.15 : ro * (i % 4 === 0 ? 1 : 0.78);
        pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
      }
      inside = inPoly(pts);
    } else {
      // detached spike tips flying outward
      const polys = [];
      for (let i = 0; i < spikes; i++) {
        const a = (i / spikes) * TAU - Math.PI / 2, w = 0.2;
        const r0 = ri, r1 = ro * (i % 2 ? 0.82 : 1);
        polys.push(inPoly([[cx + Math.cos(a) * r1, cy + Math.sin(a) * r1], [cx + Math.cos(a - w) * r0, cy + Math.sin(a - w) * r0], [cx + Math.cos(a + w) * r0, cy + Math.sin(a + w) * r0]]));
      }
      inside = (x, y) => polys.some((p) => p(x, y));
    }
    const buf = new PixelBuffer(s, s);
    const P = ramp.map((c) => pack(c));
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      if (!inside(x + 0.5, y + 0.5)) continue;
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / Math.max(1, ro) + (bayer(x, y) - 0.5) * 0.18;
      buf.set(x, y, P[d < 0.32 ? 4 : d < 0.55 ? 3 : d < 0.8 ? 2 : 1]);
    }
    buf.outline(P[0]);
    out.push(buf.toCanvas());
  }
  return out;
}

// Leaf / petal at a few rotations (flutter frames).
function leafFrames(len, wid, ramp, petal = false) {
  const out = [];
  for (const ang of [0, 0.7, 1.5, 2.3]) {
    const s = Math.ceil(len) + 4, cx = s / 2, cy = s / 2;
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const flat = Math.abs(Math.cos(ang * 1.3)) * 0.5 + 0.5;
    const inside = (x, y) => {
      const dx = x - cx, dy = y - cy;
      const u = dx * ca + dy * sa, v = -dx * sa + dy * ca;
      const t = u / (len / 2);
      if (Math.abs(t) > 1) return false;
      const half = (wid / 2) * flat * (petal ? Math.sqrt(1 - t * t) * (1 - 0.25 * t) : Math.sin(Math.acos(t)) * (1 - 0.15 * t));
      return Math.abs(v) <= half;
    };
    const c = shaded(s, s, inside, ramp, { dither: 0.5 });
    if (!petal) {
      const g = ctxOf(c);
      g.fillStyle = ramp[1];
      for (let i = -len / 2 + 1.5; i < len / 2 - 1; i += 1) g.fillRect(Math.round(cx + ca * i - 0.5), Math.round(cy + sa * i - 0.5), 1, 1);
    }
    out.push(c);
  }
  return out;
}

function confettiFrames(ramp) {
  // a little square chip flipping in 3D: full, skinny, edge, skinny-flipped (lighter)
  const out = [];
  for (const [w, h, lvl] of [[3, 3, 2], [2, 3, 2], [1, 3, 3], [2, 3, 3], [3, 2, 1]]) {
    const c = makeCanvas(w + 2, h + 2);
    const g = ctxOf(c);
    g.fillStyle = ramp[0]; g.fillRect(0, 1, w + 2, h); g.fillRect(1, 0, w, h + 2);
    g.fillStyle = ramp[lvl]; g.fillRect(1, 1, w, h);
    if (w > 1) { g.fillStyle = ramp[4]; g.fillRect(1, 1, 1, 1); }
    out.push(c);
  }
  return out;
}

function shardFrames(ramp) {
  const out = [];
  for (const pts of [[[0, 0], [5, 1], [2, 4]], [[1, 0], [4, 2], [0, 5]], [[0, 2], [5, 0], [4, 4]]]) {
    out.push(shaded(7, 7, inPoly(pts.map(([x, y]) => [x + 1, y + 1])), ramp, { cx: 3.5, cy: 3.5, rx: 3, ry: 3, spec: [2, 2], specShape: [[0, 0]] }));
  }
  return out;
}

// ---------------------------------------------------------------- sheets
function build(name, ramp, size) {
  switch (name) {
    case 'heart': return (size === 0 ? ART.heart0 : ART.heart).map((r) => fromAscii(r, ramp));
    case 'star': return (size === 0 ? ART.star0 : ART.star).map((r) => fromAscii(r, ramp));
    case 'sparkle': return (size === 0 ? ART.sparkle0 : ART.sparkle).map((r) => fromAscii(r, ramp));
    case 'drop': return (size === 0 ? ART.drop0 : ART.drop).map((r) => fromAscii(r, ramp));
    case 'aero': return ART.aero.map((r) => fromAscii(r, ramp));
    case 'scale': return ART.scale.map((r) => fromAscii(r, ramp));
    case 'pop': return ART.pop.map((r) => fromAscii(r, ramp));
    case 'note': return ART.note.map((r) => fromAscii(r, ramp));
    case 'wave': return ART.wave.map((r) => fromAscii(r, ramp));
    case 'zap': return ART.zap.map((r) => fromAscii(r, ramp));
    case 'spark': return ART.spark.map((r) => fromAscii(r, ramp));
    case 'ribbon': return ART.ribbon.map((r) => fromAscii(r, ramp));
    case 'bubble': return [bubble([2, 3, 4, 5, 7][size] ?? 3)];
    case 'puff': case 'smoke': case 'dust': return puffFrames([3, 4.5, 6.5][size] ?? 4.5, ramp, 5, size);
    case 'impact': return impactFrames([9, 13, 20][size] ?? 13, ramp);
    case 'leaf': return leafFrames([7, 9, 12][size] ?? 9, [4, 5, 6][size] ?? 5, ramp, false);
    case 'petal': return leafFrames([5, 6, 8][size] ?? 6, [4, 5, 6][size] ?? 5, ramp, true);
    case 'confetti': return confettiFrames(ramp);
    case 'shard': return shardFrames(ramp);
    default: return [fromAscii(ART.sparkle0[1], ramp)];
  }
}

export const PX_SHEETS = ['sparkle', 'star', 'heart', 'drop', 'aero', 'bubble', 'pop', 'scale', 'leaf', 'petal', 'puff', 'smoke', 'dust', 'zap', 'spark', 'impact', 'confetti', 'ribbon', 'wave', 'note', 'shard'];

const sheets = new Map();
export function pixelBubble(r) { return bubble(Math.max(1, Math.round(r))); }

export function pxFrames(name, ramp = 'white', size = 1) {
  const R = rampOf(ramp);
  const key = name + '|' + R.join('') + '|' + size;
  let f = sheets.get(key);
  if (!f) {
    f = build(name, R, size);
    if (sheets.size > 400) sheets.clear();
    sheets.set(key, f);
  }
  return f;
}

// A fluffy pixel cloud (UI skies): lumps with a pale blue underside, dithered shade and a soft outline.
export function pixelCloud(w, seed = 1) {
  w = Math.max(12, Math.round(w));
  const h = Math.round(w * 0.5);
  const lumps = [];
  const n = 3 + (seed % 3);
  for (let i = 0; i < n; i++) {
    const u = (i + 0.5) / n;
    const r = h * (0.32 + 0.22 * Math.sin(u * Math.PI)) * (0.85 + 0.3 * ((seed * 7 + i * 13) % 5) / 5);
    lumps.push([w * (0.12 + 0.76 * u), h * 0.62 - r * 0.35, r]);
  }
  const buf = new PixelBuffer(w + 2, h + 2);
  const base = h * 0.82;
  const inside = (x, y) => y < base && (lumps.some(([cx, cy, r]) => Math.hypot(x - cx, y - cy) < r) || (y > h * 0.5 && x > w * 0.1 && x < w * 0.9));
  const C = [pack('#ffffff'), pack('#eef9ff'), pack('#cdeafc'), pack('#a8d8f4')];
  for (let y = 0; y < h + 2; y++) for (let x = 0; x < w + 2; x++) {
    const px = x - 0.5, py = y - 0.5;
    if (!inside(px, py)) continue;
    const k = py / base + (bayer(x, y) - 0.5) * 0.25;
    buf.set(x, y, C[k < 0.45 ? 0 : k < 0.7 ? 1 : k < 0.88 ? 2 : 3]);
  }
  buf.outline(pack('#8cc8ec', 200));
  return buf.toCanvas();
}
