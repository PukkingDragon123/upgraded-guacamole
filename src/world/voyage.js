// [travel17] The voyage: a cinematic ocean-to-ocean trip (OWNER: travel agent).
//
// game.voyage (made by Ocean). ocean.travel(id, done) hands the trip to start(); ocean.updateTravel / drawTravel
// delegate here while ocean.travelState.voyage is set. The trip has four beats:
//   depart  LIVE: the real boat (with the bubble person) turns and accelerates off to the right, leaving wake and
//           spray, while the camera pulls back from the fishing zoom to the whole-world wide shot and pans after it.
//           On its last frame the world is grabbed (without the boat) as the origin postcard.
//   sea     the open-sea beat, drawn here in screen space: the origin postcard scrolls away with parallax (sky band
//           slow, water band fast, dithered edge), then open water: sky / sea shift from the origin palette (sampled
//           from the postcard) to the destination's, voxel clouds and islands of both oceans drift past, gulls fly
//           along, weather of both oceans (snow + aurora, embers + ash, neon rain, data specks, drizzle) blends.
//           Meanwhile the destination biome builds a step at a time (ocean.travelState.gen), its title letters are
//           voxelised, and once ready the destination is rendered LIVE for a few frames under this overlay and
//           grabbed as the arrival postcard (camera at the arrival framing, boat hidden).
//   arrive  the destination postcard glides in (water band at the water's speed, sky band slower with its
//           landmarks rising over the horizon) while the camera decelerates and the boat glides to its berth.
//   settle  LIVE again: the boat splashes to a stop, the postcard dissolves into the live scene, the camera eases
//           back to the fishing zoom over the boat, the HUD returns. The ocean's name drops in as big 3D voxel
//           letters (+ subtitle; a gold "NEW OCEAN!" and confetti the first time).
// Destinations (the Lab / the Workshop): sail(dest) runs depart + a short sea beat toward the place's sky, then
// cross-fades into the destination scene (src/world/destinations.js) with the boat gliding in.
// The first trip ever plays in full; later trips are shorter and can be skipped (click / Esc / Space fast-forward).
// Audio: whoosh + splash on departure, a water-rush loop that follows the boat's speed, open-sea ambience (gulls),
// the music crossfades to the destination track during the sea beat, a little cue of the destination, a splash and
// the arrival jingle (the unlock fanfare on a first visit).
//
// API: start(to, done) -> bool (an ocean id), sail(destId, onArrive) -> bool, active, update(dt), drawOver(ctx, dt)
// (main canvas, after the world), drawUi(ctx, dt) (UI layer: route chart in the letterbox, the title, skip hint).
import { clamp, clamp01, lerp, damp, ease, smoothstep, hash2, bayer, TAU } from '../core/math.js';
import { hexToRgb, rgba } from '../core/color.js';
import { makeCanvas, ctxOf } from '../core/canvas.js';
import { RNG } from '../core/rng.js';
import { VoxelModel, renderVoxels } from '../gfx/voxel.js';
import { pxFrames, pixelBubble } from '../gfx/pxsprites.js';
import { buildText3D } from '../gfx/text3d.js';
import { drawPop3D } from '../ui/pop3d.js';
import { drawAeroGlow, drawSparkle } from '../ui/aero.js';
import * as Character from '../gfx/character.js';
import * as BM from './boatmodels.js';
import { cloudSprites } from './sky.js';
import { MAP_LOCATIONS } from '../ui/mappanel.js';
import { destSprite } from './destinations.js';

// oceans whose sky pass paints near walls that continue under the water: their postcards move in one piece
const LOCKED = new Set(['fjord', 'metropolis']);
const KIND = { oscean: 'hill', shallows: 'palm', fjord: 'ice', junkyard: 'junk', metropolis: 'city', volcano: 'volcano', abyss: 'abyss', lab: 'lab', workshop: 'workshop' };
// authored day looks (the origin's real colours are sampled from its postcard; the destination's once it is grabbed)
const LOOK = {
  hill: { sky: ['#2a8fe8', '#69c3ff', '#d8f4ff'], sea: ['#3aa8e0', '#0d4f8a'], cloud: 'day', sun: 1, fx: 'bubbles', wave: 1 },
  palm: { sky: ['#1a96ec', '#62d0ff', '#eafcff'], sea: ['#2ccde0', '#0a6a9a'], cloud: 'day', sun: 1, fx: 'glints', wave: 1 },
  ice: { sky: ['#2a4a86', '#6a9ad0', '#d6f0ff'], sea: ['#58a6c8', '#0a3050'], cloud: 'day', sun: 0.6, fx: 'snow', wave: 1.2 },
  junk: { sky: ['#3e5e6e', '#86a496', '#d6d4ac'], sea: ['#4a8a7a', '#123a3a'], cloud: 'rain', sun: 0.5, fx: 'specks', wave: 1.1 },
  city: { sky: ['#1a1450', '#5a2a8a', '#ff8ac8'], sea: ['#3a3a9a', '#0a0a30'], cloud: 'night', sun: 0, fx: 'neon', wave: 1 },
  volcano: { sky: ['#3a1612', '#8a3416', '#ffa050'], sea: ['#5a3430', '#1a0a0a'], cloud: 'dusk', sun: 0.4, fx: 'embers', wave: 1.3 },
  abyss: { sky: ['#04060e', '#0e1830', '#2a426a'], sea: ['#123050', '#02050c'], cloud: 'rain', sun: 0, fx: 'drizzle', wave: 1.6 },
  lab: { sky: ['#2a88d8', '#8fd8ff', '#e4f8ff'], sea: ['#7ad8f8', '#1a7ed0'], cloud: 'day', sun: 1, fx: 'bubbles', wave: 0.8 },
  workshop: { sky: ['#2a88d8', '#8fd8ff', '#e4f8ff'], sea: ['#7ad8f8', '#1a7ed0'], cloud: 'day', sun: 1, fx: 'glints', wave: 0.8 },
  open: { sky: ['#3a96e6', '#7ccaff', '#e2f6ff'], sea: ['#3cb8e8', '#0b5694'] }, // the open sea between two oceans
};
// 3D title palettes per destination
const NEON = { face: ['#fff2ff', '#ff9ae8', '#e04ad0'], bevelL: '#ffffff', bevelD: '#b02ab0', side: '#7a1a8a', back: '#4a0a5a', outline: '#ffffff' };
const DEEP = { face: ['#eef4ff', '#a8b8ff', '#6272f0'], bevelL: '#ffffff', bevelD: '#4a52c8', side: '#2e3494', back: '#1a1e5a', outline: '#c8f4ff' };
const TITLE_PAL = { oscean: 'logoGreen', shallows: 'aqua', fjord: 'white', junkyard: 'leaf', metropolis: NEON, volcano: 'coral', abyss: DEEP };
const CUE = { oscean: ['chirp', 0.35], shallows: ['chirp', 0.4], fjord: ['ice_chime', 0.5], junkyard: ['static_burst', 0.35], metropolis: ['neon_buzz', 0.45], volcano: ['eruption_boom', 0.3], abyss: ['sonar', 0.35] };

const rgbOf = (h) => hexToRgb(h);
const mixRGB = (a, b, t, out = [0, 0, 0]) => { out[0] = a[0] + (b[0] - a[0]) * t; out[1] = a[1] + (b[1] - a[1]) * t; out[2] = a[2] + (b[2] - a[2]) * t; return out; };
const css = (c, a = 1) => (a >= 1 ? `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})` : `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`);
const lookPal = (kind, night = 0) => {
  const L = LOOK[kind] || LOOK.hill, N = [10, 16, 48];
  const dk = (h, k) => mixRGB(rgbOf(h), N, k * night);
  return { sky: [dk(L.sky[0], 0.8), dk(L.sky[1], 0.75), dk(L.sky[2], 0.65)], sea: [dk(L.sea[0], 0.6), dk(L.sea[1], 0.5)] };
};
const copyPal = (p) => ({ sky: p.sky.map((c) => c.slice()), sea: p.sea.map((c) => c.slice()) });
const hermite = (p0, v0, p1, v1, D, e) => {
  const e2 = e * e, e3 = e2 * e;
  return (2 * e3 - 3 * e2 + 1) * p0 + (e3 - 2 * e2 + e) * D * v0 + (-2 * e3 + 3 * e2) * p1 + (e3 - e2) * D * v1;
};

// ---------------------------------------------------------------- small pixel sprites
let GULLS = null;
function gullFrames() {
  if (GULLS) return GULLS;
  // o outline, w white, g grey wing tip, b beak
  const F = [
    ['o.........o', 'go.......og', '.gwo...owg.', '..www.www..', '....wwwb...', '.....ww....'],
    ['...........', '...........', 'goowwwwwoog', '.ggw.wwwbg.', '....www....', '...........'],
    ['...........', '....wwwb...', '..wwwwwww..', '.gwo...owg.', 'go.......og', '...........'],
  ];
  const C = { o: '#3a5470', w: '#ffffff', g: '#9ab0c4', b: '#ffb43c' };
  GULLS = F.map((rows) => {
    const c = makeCanvas(rows[0].length, rows.length), g = ctxOf(c);
    rows.forEach((r, y) => [...r].forEach((ch, x) => { if (C[ch]) { g.fillStyle = C[ch]; g.fillRect(x, y, 1, 1); } }));
    return c;
  });
  return GULLS;
}

// dithered glow disc (sun / moon / lava glow): hard pixel rings fading by bayer threshold
const GLOWS = new Map();
function glowDisc(r, hex, core = null) {
  const key = r + hex + core;
  let c = GLOWS.get(key);
  if (c) return c;
  const R = r * 3, S = R * 2 + 1;
  c = makeCanvas(S, S);
  const g = ctxOf(c), id = g.createImageData(S, S), d = id.data;
  const [cr, cg, cb] = hexToRgb(hex), cc = core ? hexToRgb(core) : [255, 255, 255];
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dd = Math.hypot(x - R, y - R), i = (y * S + x) * 4;
    if (dd <= r) {
      const k = dd / r, edge = k > 0.82;
      const m = k < 0.5 ? 1 : 1 - (k - 0.5) * 0.6;
      d[i] = lerp(cr, cc[0], edge ? 0 : m * 0.8); d[i + 1] = lerp(cg, cc[1], edge ? 0 : m * 0.8); d[i + 2] = lerp(cb, cc[2], edge ? 0 : m * 0.8); d[i + 3] = 255;
    } else {
      const k = (dd - r) / (R - r);
      const a = Math.pow(1 - clamp01(k), 2.2) * 0.55;
      const step = Math.floor(a * 6 + bayer(x, y)) / 6;
      if (step <= 0) continue;
      d[i] = cr; d[i + 1] = cg; d[i + 2] = cb; d[i + 3] = Math.round(step * 255);
    }
  }
  g.putImageData(id, 0, 0);
  GLOWS.set(key, c);
  return c;
}

// ---------------------------------------------------------------- voxel islands (one small model per ocean kind)
function islandModel(kind, seed) {
  const r = new RNG(seed * 7919 + 13);
  if (kind === 'hill') {
    const m = new VoxelModel(44, 30, 16), C = (h, o) => m.color(h, { jitter: 0.06, ...o });
    const grass = [C('#6cd83a'), C('#8ae84a'), C('#4cb82a')], white = C('#f4fbff', { spec: 0.6 }), trunk = C('#7a5432'), leaf = C('#3cae3a');
    for (let x = 0; x < 44; x++) { const h = Math.round(Math.sqrt(Math.max(0, 1 - ((x - 22) / 22) ** 2)) * (10 + r.float(0, 2))); m.box(x, 0, 3, x, h, 12, (xx, y) => grass[y === h ? 1 : (xx + y) % 5 === 0 ? 2 : 0]); }
    const tx = r.int(10, 16);
    m.box(tx, 8, 7, tx + 1, 15, 8, trunk); m.sphere(tx + 0.5, 18, 7.5, 4.2, leaf);
    const wx = r.int(27, 33);
    m.box(wx, 9, 7, wx, 26, 7, white);
    for (const [dx, dy] of [[0, 7], [6, -4], [-6, -4]]) m.line(wx, 26, 6, wx + dx * 0.9, 26 + dy * 0.9, 6, white, 0.5);
    return { m, yaw: 18, pitch: 14 };
  }
  if (kind === 'palm') {
    const m = new VoxelModel(40, 34, 16), C = (h, o) => m.color(h, { jitter: 0.06, ...o });
    const sand = [C('#ffe2a0'), C('#f4cf86')], trunk = C('#b07a48'), leaf = [C('#4cc83a'), C('#2e9a2a')], rock = C('#a89a8a');
    for (let x = 4; x < 36; x++) { const h = Math.round(Math.sqrt(Math.max(0, 1 - ((x - 20) / 16) ** 2)) * 5); m.box(x, 0, 4, x, h, 11, sand[(x + h) % 3 === 0 ? 1 : 0]); }
    m.sphere(9, 2, 8, 2.5, rock);
    for (const [px, lean, hh] of [[17, -0.25, 22], [24, 0.3, 18]]) {
      for (let y = 4; y < hh; y++) m.set(Math.round(px + (y - 4) * lean * 0.4), y, 8, trunk);
      const topX = Math.round(px + (hh - 4) * lean * 0.4);
      for (let a = 0; a < 6; a++) { const t = (a / 6) * TAU; m.line(topX, hh, 8, topX + Math.cos(t) * 7, hh - 2 + Math.abs(Math.sin(t)) * 2 - 1, 8 + Math.sin(t) * 3, leaf[a % 2], 0.6); }
    }
    return { m, yaw: 16, pitch: 12 };
  }
  if (kind === 'ice') {
    const m = new VoxelModel(46, 40, 18), C = (h, o) => m.color(h, { jitter: 0.04, ...o });
    const ice = [C('#e8f8ff', { spec: 0.8 }), C('#a8e0f8', { spec: 0.9 }), C('#6ab8e0')], snow = C('#ffffff', { spec: 0.4 });
    const peaks = [[14, 30, 9], [26, 38, 10], [36, 22, 7]];
    for (const [px, ph, pr] of peaks) for (let y = 0; y < ph; y++) { const rr = pr * (1 - y / ph) + 0.6; m.cylinder(px + r.float(-0.6, 0.6), 9, y, y, rr, (x, yy, z) => (yy > ph - 6 ? snow : (x + yy) % 7 === 0 ? ice[2] : z > 9 ? ice[1] : ice[0])); }
    return { m, yaw: 20, pitch: 12 };
  }
  if (kind === 'junk') {
    const m = new VoxelModel(46, 36, 16), C = (h, o) => m.color(h, { jitter: 0.1, ...o });
    const rust = [C('#a8643a'), C('#7a4a2e'), C('#c88a4a')], grey = C('#8a96a4'), scr = C('#6affb0', { emissive: 0.8 }), dark = C('#3a4048');
    for (let x = 2; x < 44; x++) { const h = Math.round(Math.sqrt(Math.max(0, 1 - ((x - 23) / 21) ** 2)) * 9 + r.float(-1, 1)); m.box(x, 0, 3, x, h, 12, rust[(x * 3 + h) % 3]); }
    for (let i = 0; i < 5; i++) { const bx = r.int(6, 34), by = r.int(5, 9); m.box(bx, by, 5, bx + 4, by + 3, 9, grey); m.box(bx + 1, by + 1, 10, bx + 3, by + 2, 10, i % 2 ? scr : dark); }
    m.box(32, 8, 7, 33, 30, 8, rust[1]); m.line(33, 30, 7, 18, 33, 7, rust[2], 0.6); m.box(18, 26, 7, 18, 33, 7, dark);
    return { m, yaw: 18, pitch: 12 };
  }
  if (kind === 'city') {
    const m = new VoxelModel(48, 44, 16), C = (h, o) => m.color(h, { jitter: 0.05, ...o });
    const wall = [C('#3a3470'), C('#2a2a5a')], win = [C('#ff7ae0', { emissive: 1 }), C('#5affea', { emissive: 1 }), C('#ffe27a', { emissive: 0.9 })];
    let x = 2;
    while (x < 44) {
      const w = r.int(5, 8), h = r.int(14, 42);
      m.box(x, 0, 4, Math.min(46, x + w), h, 11, (xx, y, z) => (z === 11 && y % 3 === 1 && xx % 2 === 0 && hash2(xx, y, seed) < 0.6 ? win[Math.floor(hash2(xx, y, 3) * 3)] : wall[xx % 2]));
      if (r.chance(0.5)) m.box(x + (w >> 1), h, 7, x + (w >> 1), h + 4, 7, win[0]);
      x += w + r.int(0, 2);
    }
    return { m, yaw: 14, pitch: 10 };
  }
  if (kind === 'volcano') {
    const m = new VoxelModel(50, 36, 18), C = (h, o) => m.color(h, { jitter: 0.08, ...o });
    const rock = [C('#4a3a3a'), C('#2a2224'), C('#6a4a40')], lava = C('#ff8a2a', { emissive: 1 }), lava2 = C('#ffd24a', { emissive: 1 });
    for (let y = 0; y < 30; y++) { const rr = 22 * (1 - y / 34) + 1.5; m.cylinder(25, 9, y, y, rr, (x, yy, z) => ((x * 5 + yy * 3) % 13 === 0 && z > 12 && yy < 26 ? lava : rock[(x + yy) % 3])); }
    m.sub(() => m.cylinder(25, 9, 27, 31, 4));
    m.cylinder(25, 9, 26, 27, 4, lava2);
    for (let y = 26; y > 6; y--) m.set(25 + Math.round(Math.sin(y * 0.6) * 1.5) + Math.round((26 - y) * 0.35), y, 16, lava);
    return { m, yaw: 18, pitch: 12 };
  }
  if (kind === 'sail') {
    const m = new VoxelModel(24, 22, 8), C = (h, o) => m.color(h, { jitter: 0.05, ...o });
    const hull = [C(seed ? '#e8583a' : '#3a8ad8'), C('#f4ecd8')], sail = C('#ffffff', { spec: 0.5 }), sail2 = C(seed ? '#ffd23a' : '#7affc8'), mast = C('#7a5432');
    for (let x = 2; x < 22; x++) { const d = Math.abs(x - 12) > 7 ? 1 : 0; m.box(x, d, 2, x, 3, 5, x % 5 === 0 ? hull[1] : hull[0]); }
    m.box(11, 4, 3, 11, 20, 3, mast);
    for (let y = 6; y < 20; y++) { const w = Math.round((20 - y) * 0.55); m.box(12, y, 3, 12 + w, y, 3, y % 5 === 0 ? sail2 : sail); }
    for (let y = 6; y < 16; y++) { const w = Math.round((16 - y) * 0.45); m.box(10 - w, y, 3, 10, y, 3, sail); }
    return { m, yaw: 10, pitch: 8 };
  }
  if (kind === 'buoy') {
    const m = new VoxelModel(12, 22, 12), C = (h, o) => m.color(h, { jitter: 0.04, ...o });
    const red = C('#e8443a', { spec: 0.6 }), white = C('#f6f6f0', { spec: 0.6 }), dark = C('#3a3a48'), lamp = C('#ffe27a', { emissive: 1 });
    m.cone(6, 6, 0, 6, 5.5, 4.2, (x, y) => (y < 2 ? dark : red));
    for (let y = 6; y < 17; y++) m.cylinder(6, 6, y, y, 2.2, (y >> 2) % 2 ? white : red);
    m.box(4, 17, 4, 7, 17, 7, dark); m.box(5, 18, 5, 6, 20, 6, lamp);
    return { m, yaw: 24, pitch: 14 };
  }
  if (kind === 'abyss') {
    const m = new VoxelModel(40, 40, 16), C = (h, o) => m.color(h, { jitter: 0.08, ...o });
    const rock = [C('#262a3a'), C('#1a1c28'), C('#3a3e52')], glow = C('#5affea', { emissive: 1 }), glow2 = C('#a88aff', { emissive: 1 });
    for (const [px, ph, pr] of [[12, 34, 6], [22, 26, 7], [30, 16, 5]]) for (let y = 0; y < ph; y++) { const rr = pr * (1 - (y / ph) ** 1.6) + 0.5 + Math.sin(y * 0.9 + px) * 0.6; m.cylinder(px, 8, y, y, rr, rock[(y + px) % 3]); }
    for (let i = 0; i < 9; i++) m.set(r.int(8, 32), r.int(2, 26), 13, i % 3 ? glow : glow2);
    return { m, yaw: 18, pitch: 12 };
  }
  return null;
}
const ISLANDS = new Map();
function islandSprite(kind, seed, peek = false) {
  const key = kind + seed;
  if (ISLANDS.has(key)) return ISLANDS.get(key);
  if (peek) return null; // drawing never builds: the jobs do, a few ms a frame
  let s = null;
  try {
    const def = islandModel(kind, seed);
    if (def) {
      const r = renderVoxels(def.m, { scale: 1, yaw: def.yaw, pitch: def.pitch });
      s = { canvas: r.canvas, glow: r.glow, ox: r.ox, oy: r.oy, w: r.w, h: r.h };
    }
  } catch (e) { console.warn('voyage island', e); }
  ISLANDS.set(key, s);
  return s;
}
const CLOUDS = [];
function cloudSet(i) { return CLOUDS[i]; }
// 0..4 far (1x voxels), 5..7 near (2x voxels)
function* buildClouds() {
  const dims = [[34, 14, 14, 1, 1], [46, 16, 16, 2, 1], [28, 12, 12, 3, 1], [52, 18, 16, 4, 1], [38, 15, 14, 5, 1], [40, 16, 16, 6, 2], [52, 18, 18, 7, 2], [34, 14, 14, 8, 2]];
  for (let i = CLOUDS.length; i < dims.length; i++) {
    const [w, h, d, seed, sc] = dims[i];
    try { CLOUDS.push(cloudSprites(seed * 31 + 7, w, h, d, sc)); } catch (e) { console.warn('voyage cloud', e); CLOUDS.push(null); }
    yield;
  }
}

// ---------------------------------------------------------------- 3D voxel title (letters drop in one by one)
const TITLES = new Map();
function* titleSteps(text, pal, sc) {
  const key = text + '|' + (typeof pal === 'string' ? pal : 'custom') + '|' + sc;
  if (TITLES.has(key)) return TITLES.get(key);
  let T = null;
  for (let i = 0; i < 200 && !(T = buildText3D(text, { size: 16, px: 1, depth: 4, outline: 1, palette: pal })); i++) yield; // the font may still load
  if (!T) return null;
  yield;
  const opt = { pitch: 14, outline: false, ao: 0.6, edges: 0.35, depthLines: false, light: { top: 3.6, lit: 3.2, dark: 2.2, bottom: 1.6 } };
  const letters = [];
  for (const L of T.letters) {
    const lo = renderVoxels(L.model, { ...opt, scale: sc, yaw: 0 });
    yield;
    const hi = renderVoxels(L.model, { ...opt, scale: sc * 2, yaw: 0 });
    const c = lo.canvas;
    const hc = makeCanvas(c.width * 2, c.height * 2);
    ctxOf(hc).drawImage(hi.canvas, Math.round((hc.width - hi.canvas.width) / 2), Math.round((hc.height - hi.canvas.height) / 2));
    Object.defineProperty(c, 'hi', { value: hc, configurable: true });
    letters.push({ canvas: c, x: (L.cx - T.w / 2) * sc, ch: L.ch });
    yield;
  }
  const out = { letters, w: T.w * sc, h: (T.h + 2) * sc };
  TITLES.set(key, out);
  return out;
}

// ---------------------------------------------------------------- the controller
export class Voyage {
  constructor(game) {
    this.game = game;
    this.s = null;          // the running trip
    this.title = null;      // the arrival title (outlives the trip by a few seconds)
    this.fade = null;       // destination hand-off cross-fade {layer, t, d}
    this.layer = null;
    this.tileSky = null; this.tileSea = null;
  }
  get active() { return !!this.s; }

  // ------------------------------------------------------------ start
  start(to, done) {
    const g = this.game, o = g.ocean;
    if (this.s || !o?.biome || to === o.biome.id) return false;
    const target = o.cache[to] || o.make(to);
    let gen = null;
    if (target.W !== o.W || target.H !== o.H || target.ready === false) {
      if (typeof target.steps === 'function') gen = target.steps(o.W, o.H);
      else gen = (function* one() { yield; target.build(o.W, o.H); })();
    }
    const s = this.begin({ kind: 'ocean', to, target, done, gen });
    o.travelState = { voyage: true, live: true, from: o.biome, to: target, t: 0, dur: s.total, dir: 1, done, switched: false, gen };
    s.ts = o.travelState;
    return true;
  }

  // a destination (the Lab / the Workshop): depart + sea, then onArrive() starts the destination scene
  sail(destId, onArrive) {
    const g = this.game, o = g.ocean;
    if (this.s || !o?.biome || o.travelState || g.state?.view !== 'ocean') return false;
    const s = this.begin({ kind: 'dest', to: destId, target: null, done: onArrive, gen: null });
    o.travelState = { voyage: true, live: true, from: o.biome, to: o.biome, t: 0, dur: s.total, dir: 1, done: null, switched: false, gen: null };
    s.ts = o.travelState;
    return true;
  }

  begin({ kind, to, target, done, gen }) {
    const g = this.game, st = g.state, W = g.screen.W, H = g.screen.H;
    const V = (st.voyage ||= { trips: 0, seen: {} });
    V.seen ||= {};
    const firstEver = !V.trips, repeat = !!V.seen[to];
    const visited = !!(st.quests?.visited?.[to]);
    const reduced = !!st.settings?.reducedMotion;
    const long = !repeat && kind === 'ocean';
    const D = kind === 'dest' ? { depart: 1.1, sea: 1.25, arrive: 0.6 } : long ? { depart: 1.35, sea: 1.75, arrive: 1.65 } : { depart: 1.0, sea: 1.1, arrive: 1.3 };
    const boat = g.boat, cam = g.camera;
    const fromId = g.ocean.biome.id;
    const fromK = KIND[fromId] || 'hill';
    const toK = KIND[to] || 'hill';
    const night = 1 - clamp01(g.ocean.env?.daylight ?? 1);
    const s = {
      kind, to, from: fromId, fromK, toK, target, done, gen, D, phase: 'depart', pt: 0, t: 0,
      speed: reduced ? 2.2 : 1, skippable: !firstEver, skipped: false, first: kind === 'ocean' && !visited && !repeat,
      night,
      x0: boat?.x ?? W * 0.36, dir0: boat?.dir ?? 1,
      cam0: { cx: cam.cx, cy: cam.cy, z: cam.open ? cam.z : 1 },
      // sea-space motion (screen px): C camera, B boat; snapshots
      C: 0, Cv: 0, B: 0, Bv: 0, X: 0, Xs: W * 0.36, Z: 1, hz: Math.round(H * 0.66), u: 0,
      orig: null, dest: null, capWait: 0, capPending: null,
      palO: lookPal(fromK, night), palD: lookPal(toK, night), palM: lookPal('open', night), pal: null, palDGot: false,
      clouds: [], islands: [], gulls: [], wake: [], bubbles: [], spray: [], fx: [], cols: [], floats: [], nextIsl: 0, nextCloud: 0, nextFar: 0,
      jobs: null, titleDef: null, flood: null, sfx: {}, total: D.depart + D.sea + D.arrive + 0.4, W0: W, H0: H,
    };
    s.pal = copyPal(s.palO);
    s.palDT = copyPal(s.palD);
    this.s = s;
    this.title = null;
    // the boat: the pilot takes the wheel, facing the open sea
    if (boat) {
      boat.pilot = { x: boat.x, vx: 0 };
      if (boat.dir !== 1) { boat.dir = 1; g.water?.splash?.(boat.x, 0.5, 20); }
      boat.pose = 'idle';
      const W2 = W;
      s.xEnd = Math.min(W2 - 90, Math.max(s.x0 + 50, Math.min(W2 * 0.8, Math.max(s.x0 + W2 * 0.25, W2 * 0.7))));
    }
    cam.setLetterbox(true);
    // background work, a few ms a frame: the destination build, puppet boat sprites, clouds, islands, the title
    s.jobs = this.jobs(s);
    // audio: whoosh, the lurch splash, the water-rush loop; open-sea ambience
    const a = g.audio;
    a?.play('travel_whoosh', { vol: 0.5 });
    try { s.flood = a?.loop?.('flood'); s.flood?.set(0); } catch { s.flood = null; }
    if (fromId !== 'shallows') a?.setAmbience?.('shallows', { weather: 'calm', night: g.ocean.env?.night });
    if (g.fishing?.busy && !g.fishing.fighting) try { g.fishing.releaseFish(false); } catch { /* ignore */ }
    return s;
  }

  *jobs(s) {
    const g = this.game, o = g.ocean;
    // 1) puppet boat sprites (facing right, every roll): 1x during the departure, the close-up 2x ones once at sea
    const boatSprites = function* (Rs) {
      try {
        const b = g.boat;
        if (!b?.model) return;
        const M = b.model();
        for (const R of Rs) for (const ri of [3, 2, 4, 1, 5, 0, 6]) { const k = b.modelKey + ':1:' + ri + ':' + R; if (!b.sprites.has(k)) { b.sprites.set(k, b.buildSprite(M, 1, ri, R)); yield; } }
      } catch (e) { console.warn('voyage boat', e); }
    };
    yield* boatSprites([1]);
    // the rest waits for the sea beat (the departure renders the live world: keep its frames light)
    while (s.phase === 'depart') yield 'wait';
    yield* boatSprites([2]);
    // 2) clouds and the islands of both oceans
    yield* buildClouds();
    for (const k of [s.fromK, s.toK, 'sail', 'buoy']) for (let i = 0; i < 2; i++) { islandSprite(k, i); yield; }
    if (s.kind === 'dest') { try { destSprite(s.to, 2); s.placeReady = true; } catch (e) { console.warn(e); } yield; }
    // 3) the destination biome
    if (s.gen) {
      for (;;) { let r; try { r = s.gen.next(); } catch (e) { console.error(e); r = { done: true }; } if (r.done) break; yield r.value ?? 'build'; }
      s.gen = null;
      if (s.ts) s.ts.gen = null;
    }
    // 4) the title
    if (s.kind === 'ocean' && s.target) {
      const name = (s.target.name || 'Ocean').toUpperCase();
      s.titleDef = yield* titleSteps(name, TITLE_PAL[s.to] || 'aqua', 3);
    }
  }

  runJobs(s, budget) {
    if (!s.jobs) return;
    const t0 = performance.now();
    try {
      while (performance.now() - t0 < budget) { const r = s.jobs.next(); if (r.done) { s.jobs = null; break; } if (r.value === 'wait') break; }
    } catch (e) { console.error(e); s.jobs = null; }
  }

  // ------------------------------------------------------------ update
  update(dtIn) {
    const s = this.s;
    if (!s) return;
    const g = this.game, inp = g.input;
    // skip (after the first trip ever): fast-forward the rest
    if (inp) {
      const esc = inp.keyPressed?.('Escape'), key = esc || inp.keyPressed?.(' ') || inp.keyPressed?.('Enter');
      if (esc) inp.keysPressed?.delete?.('Escape');
      if (s.skippable && !s.skipped && (key || inp.pressed)) { s.skipped = true; s.speed = Math.max(s.speed, 3.6); g.audio?.play('ui_click'); }
      if (inp.pressed) inp.consume?.();
    }
    // the window changed size mid-trip: the postcards no longer fit; land at once
    if (g.screen.W !== s.W0 || g.screen.H !== s.H0) { this.abort(s); return; }
    const dt = Math.min(0.05, dtIn) * s.speed;
    s.t += dt; s.pt += dt;
    if (s.ts) s.ts.t = s.t;
    const lowP = g.lowPower ? 0.6 : 1;
    if (s.phase === 'depart') this.updDepart(s, dt);
    else if (s.phase === 'sea') this.updSea(s, dt);
    else if (s.phase === 'arrive') this.updArrive(s, dt);
    else if (s.phase === 'settle') this.updSettle(s, dt);
    // background work: light while the live world renders, more while only the voyage scene draws
    if (this.s === s) this.runJobs(s, (s.phase === 'sea' && !s.ts?.live ? 9 : 4) * lowP);
    this.updParts(s, dt);
  }

  // live: the boat accelerates away, the camera pulls back and pans after it
  updDepart(s, dt) {
    const g = this.game, cam = g.camera, boat = g.boat, W = g.screen.W;
    const k = clamp01(s.pt / s.D.depart);
    const x = lerp(s.x0, s.xEnd, ease.inQuad(k));
    if (boat?.pilot) {
      boat.pilot.vx = dt > 0 ? (x - boat.pilot.x) / dt : 0;
      boat.pilot.x = x;
      s.v1 = 2 * (s.xEnd - s.x0) / s.D.depart; // boat speed at the end (world px / s at the wide shot's 1x)
    }
    // camera: from the fishing framing to the whole-world wide shot over the surface, leading the boat
    const zk = lerp(s.cam0.z, 1, ease.inOutCubic(k));
    const b = cam.bounds(zk);
    const lead = (W / (2 * zk)) * 0.32;
    const desX = clamp(x + lead, b.x0, b.x1), desY = b.y0;
    const w = ease.inOutCubic(clamp01(k * 1.35));
    cam.drive = { cx: lerp(s.cam0.cx, desX, w), cy: lerp(s.cam0.cy, desY, w), z: zk };
    // spray off the bow + foam as it picks up speed
    const sp = Math.abs(boat?.pilot?.vx || 0);
    const lvl = g.ocean.waterLevel();
    if (boat && lvl !== null && sp > 120 && Math.random() < 0.6) {
      const bow = boat.x + 34;
      g.particles?.pixelBurst?.('drop', bow, lvl - 2, 1 + (sp > 400 ? 1 : 0), { ramp: 'aqua', dir: -Math.PI * 0.62, spread: 0.45, speed: [60 + sp * 0.12, 120 + sp * 0.2], g: 300 });
    }
    if (!s.sfx.lurch && s.pt > 0.12) { s.sfx.lurch = 1; g.audio?.play('splash_big', { vol: 0.4, pitch: 1.1 }); if (boat && lvl !== null) g.particles?.pixelSplash?.(boat.x - 30, lvl, 0.8); }
    if (!s.sfx.spray && k > 0.55) { s.sfx.spray = 1; g.audio?.play('splash_small', { vol: 0.4, pitch: 0.9 }); }
    s.flood?.set(clamp01(sp / 900) * 0.7);
    if (k >= 1 && !s.capPending) {
      // grab the world without the boat on the next draw (the puppet takes over in the same frame)
      s.capPending = 'origin';
      if (s.ts) s.ts.hideBoat = true;
    }
  }

  // the open-sea beat (only the voyage scene draws)
  updSea(s, dt) {
    const g = this.game, W = g.screen.W;
    this.cruise(s, dt, W);
    s.u = Math.max(s.u, 0.85 * clamp01(s.pt / s.D.sea));
    // music: crossfade to the destination's track while at sea
    if (!s.sfx.music && s.pt > 0.15) {
      s.sfx.music = 1;
      if (s.kind === 'ocean') { const tr = s.target?.music || 'shallows'; try { g.audio?.setMusic(tr); } catch { /* ignore */ } }
    }
    if (!s.sfx.gull && s.pt > 0.45 && s.toK !== 'abyss') { s.sfx.gull = 1; g.audio?.play('chirp', { vol: 0.25, pan: 0.4, pitch: 1.2 }); }
    if (!s.sfx.cue && s.pt > s.D.sea * 0.7) { s.sfx.cue = 1; const c = CUE[s.to]; if (c) g.audio?.play(c[0], { vol: c[1] }); }
    if (s.kind === 'dest') {
      if (s.pt >= s.D.sea) this.handToDest(s);
      return;
    }
    // the destination is built: render it live (under this overlay) at the arrival framing and grab it
    if (!s.dest && !s.capPending && !s.gen && s.pt > Math.min(0.5, s.D.sea * 0.3)) this.prepArrival(s);
    if (s.dest && s.pt >= s.D.sea && (!s.jobs || s.titleDef || s.pt > s.D.sea + 1.2)) this.beginArrive(s);
    // a very slow build: never strand the boat at sea
    if (!s.dest && s.pt > s.D.sea + 7 && s.gen) { try { while (!s.gen.next().done); } catch (e) { console.error(e); } s.gen = null; if (s.ts) s.ts.gen = null; }
  }

  cruise(s, dt, W) {
    // boat speed eases to a cruise; the camera is a critically damped follower keeping the boat at Xs
    const Bc = W * 0.72;
    s.Bv = damp(s.Bv, Bc, 1.6, dt);
    s.B += s.Bv * dt;
    const om = 3.2, T = s.B - s.Xs;
    const acc = om * om * (T - s.C) + 2 * om * (s.Bv - s.Cv); // velocity feed-forward: no lag behind the cruising boat
    s.Cv += acc * dt;
    s.C += s.Cv * dt;
    s.X = s.B - s.C;
  }

  prepArrival(s) {
    const g = this.game, o = g.ocean, cam = g.camera, boat = g.boat, W = g.screen.W;
    // switch the ocean over (the old one's hi-res scenery is freed)
    const from = o.biome;
    from.D?.dropHi?.();
    from.hiDone = null; from.hiFirst = null;
    if (o.hiFor === from.D) { o.hiFor = null; o.hiGen = null; }
    o.biome = s.target;
    o.pickWeather(true);
    o.ambNow = undefined;
    if (s.ts) { s.ts.switched = true; s.ts.gen = null; s.ts.live = true; s.ts.hideBoat = true; }
    try { g.school?.clear?.(); } catch { /* ignore */ }
    // berth: a good fishing spot, inside the new ocean's boat range
    let lo = 90, hi = W - 90;
    try { const br = o.biome.boatRange?.(W); if (br) { lo = Math.max(lo, br[0] + 60); hi = Math.min(hi, br[1] - 60); } } catch { /* optional */ }
    s.Xf = clamp(Math.round(W * 0.36), lo, Math.max(lo, hi));
    if (boat) { boat.x = s.Xf; boat.pilot = { x: s.Xf, vx: 0 }; boat.placed = false; boat.dir = 1; boat.vx = 0; }
    const b = cam.bounds(1);
    cam.drive = { cx: W / 2, cy: b.y0, z: 1 };
    this.snapCam(cam);
    s.capWait = 3;
    s.capPending = 'dest';
  }

  snapCam(cam) {
    const d = cam.drive;
    if (!d) return;
    cam.cx = cam.tx = d.cx; cam.cy = cam.ty = d.cy; cam.z = cam.base = d.z; cam.fz = 1; cam.leadX = cam.leadY = 0;
  }

  beginArrive(s) {
    s.phase = 'arrive'; s.pt = 0;
    s.Ca = s.C; s.Va = Math.max(s.Cv, s.Bv * 0.6); s.Ba = s.B; s.VBa = s.Bv; s.Za = s.Z || 1;
    s.Dist = s.Va * s.D.arrive / 2;
    s.Cend = s.Ca + s.Dist;
    s.Bend = s.Cend + s.Xf;
  }

  updArrive(s, dt) {
    const g = this.game;
    const e = clamp01(s.pt / s.D.arrive);
    const C = s.Ca + s.Dist * (1 - (1 - e) * (1 - e));
    const B = hermite(s.Ba, s.VBa, s.Bend, 0, s.D.arrive, e);
    s.Cv = dt > 0 ? (C - s.C) / dt : 0; s.Bv = dt > 0 ? Math.max(0, (B - s.B) / dt) : 0;
    s.C = C; s.B = B; s.X = B - C;
    s.u = 0.85 + 0.15 * smoothstep(0, 0.6, e);
    if (!s.titleT && e > 0.35) this.showTitle(s);
    if (e >= 1) this.handoff(s);
  }

  // live again: the real boat takes over at the puppet's spot, the postcard dissolves into the live scene
  handoff(s) {
    const g = this.game, o = g.ocean, boat = g.boat, cam = g.camera;
    s.phase = 'settle'; s.pt = 0;
    if (s.ts) { s.ts.live = true; s.ts.hideBoat = false; }
    this.snapCam(cam);
    if (boat) { boat.pilot = null; boat.x = s.Xf; boat.dir = 1; boat.vx = 26; boat.placed = false; boat.facing = 1; }
    const lvl = o.waterLevel();
    if (lvl !== null) {
      g.particles?.pixelSplash?.(s.Xf + 30, lvl, 1.3);
      g.particles?.pixelBurst?.('foam', s.Xf, lvl, 6, { w: 30, speed: [10, 40] });
      g.water?.splash?.(s.Xf + 20, 1.2, 40);
    }
    g.audio?.play('splash_big', { vol: 0.45 });
    g.audio?.play(s.first ? 'unlock_biome' : 'arrive', { vol: s.first ? 0.7 : 0.55 });
    s.flood?.stop(); s.flood = null;
  }

  // cut straight to the destination (window resized mid-trip)
  abort(s) {
    const g = this.game, o = g.ocean, boat = g.boat;
    if (s.kind === 'dest') { this.fade = null; this.layer = null; this.handToDest(s); this.fade = null; return; }
    try { if (s.gen) { while (!s.gen.next().done); s.gen = null; } o.get(s.to); } catch (e) { console.error(e); }
    if (o.biome !== s.target) {
      o.biome = s.target;
      o.pickWeather(true);
    }
    if (boat) { boat.pilot = null; boat.placed = false; boat.dir = 1; }
    s.dest = null;
    s.flood?.stop(); s.flood = null;
    if (!this.title) this.showTitle(s);
    this.finish(s);
  }

  updSettle(s, dt) {
    if (s.pt >= 0.4) this.finish(s);
  }

  finish(s) {
    const g = this.game, o = g.ocean, cam = g.camera, st = g.state;
    cam.drive = null;
    cam.home?.(false);
    cam.setLetterbox(false);
    if (g.boat) g.boat.pilot = null;
    o.travelState = null;
    o.ambNow = undefined;
    try { g.audio?.setMusic(g.musicFor?.() ?? o.biome.music); } catch { /* ignore */ }
    try { g.audio?.setAmbience(o.biome.ambient || o.biome.id, { weather: o.weather, night: o.env.night }); } catch { /* ignore */ }
    const V = (st.voyage ||= { trips: 0, seen: {} });
    V.trips = (V.trips || 0) + 1;
    (V.seen ||= {})[s.to] = 1;
    s.flood?.stop();
    this.s = null;
    try { s.done?.(); } catch (e) { console.error(e); }
    if (s.kind === 'ocean') g.emit?.('travel', { to: s.to, from: s.from, first: s.first });
  }

  // destination variant: hand the trip to the destination scene, cross-fading the sea away on top
  handToDest(s) {
    const g = this.game, o = g.ocean, cam = g.camera;
    if (this.layer) {
      const c = makeCanvas(this.layer.width, this.layer.height);
      ctxOf(c).drawImage(this.layer, 0, 0);
      this.fade = { canvas: c, t: 0, d: 0.55 };
    }
    cam.drive = null;
    cam.setLetterbox(false);
    if (g.boat) { g.boat.pilot = null; g.boat.x = s.x0; g.boat.placed = false; }
    o.travelState = null;
    s.flood?.stop(); s.flood = null;
    try { g.audio?.setAmbience(o.biome.ambient || o.biome.id, { weather: o.weather, night: o.env.night }); } catch { /* ignore */ }
    const V = (g.state.voyage ||= { trips: 0, seen: {} });
    V.trips = (V.trips || 0) + 1;
    (V.seen ||= {})[s.to] = 1;
    this.s = null;
    g.audio?.play('splash_small', { vol: 0.4 });
    try { s.done?.({ boatX: s.X, boatY: s.hz }); } catch (e) { console.error(e); }
  }

  showTitle(s) {
    s.titleT = 1;
    if (s.kind !== 'ocean' || !s.target) return;
    if (s.titleDef) for (const L of s.titleDef.letters) L.landed = false;
    this.title = { t: 0, def: s.titleDef, name: (s.target.name || '').toUpperCase(), sub: s.target.subtitle || '', first: s.first, to: s.to, played: false };
  }

  // ------------------------------------------------------------ particles of the sea scene
  // Sea-space things (wake, stern bubbles, bow spray) keep x in sea space (B units) and y relative to the waterline,
  // so the virtual zoom (s.Z, anchored on the boat) scales them with the boat. Weather lives in screen space.
  updParts(s, dt) {
    const g = this.game, W = g.screen.W, H = g.screen.H;
    if (s.phase !== 'sea' && s.phase !== 'arrive') return;
    const sp = s.Bv;
    s.wakeT = (s.wakeT || 0) - dt;
    if (sp > 30 && s.wakeT <= 0) {
      s.wakeT = 0.016;
      const k = clamp01(sp / 700);
      s.wake.push({ x: s.B - 30 + Math.random() * 6, t: 0, life: 0.8 + Math.random() * 0.8 * (0.5 + k), w: 2 + Math.round(Math.random() * 4) });
      if (Math.random() < 0.85) s.bubbles.push({ x: s.B - 26 + Math.random() * 14, y: 3 + Math.random() * 12 * (0.4 + k), vy: -4 - Math.random() * 8, vx: -6 - Math.random() * 14, t: 0, life: 0.7 + Math.random() * 1.1, r: Math.random() < 0.3 ? 2 : 1 });
      if (Math.random() < k * 1.1) s.spray.push({ x: s.B + 28 + Math.random() * 6, y: -2, vx: sp * (0.55 + Math.random() * 0.25), vy: -40 - Math.random() * (40 + sp * 0.1), t: 0, life: 0.55 + Math.random() * 0.35 });
    }
    for (const p of s.wake) p.t += dt;
    for (const p of s.bubbles) { p.t += dt; p.x += p.vx * dt; p.y = Math.max(1.5, p.y + p.vy * dt); }
    for (const p of s.spray) { p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 380 * dt; }
    s.wake = s.wake.filter((p) => p.t < p.life);
    s.bubbles = s.bubbles.filter((p) => p.t < p.life);
    s.spray = s.spray.filter((p) => p.t < p.life && p.y < 3);
    // weather of both oceans, weighted by the voyage progress
    const wO = 1 - s.u, wD = s.u;
    for (const [kind, w] of [[s.fromK, wO], [s.toK, wD]]) {
      const fx = LOOK[kind]?.fx;
      if (!fx || w < 0.05) continue;
      const rate = { snow: 90, embers: 55, neon: 70, specks: 30, drizzle: 90, bubbles: 9, glints: 26 }[fx] || 0;
      let n = rate * w * dt;
      while (n > 0) { if (Math.random() < n) this.spawnFx(s, fx, W, H); n -= 1; }
    }
    for (const p of s.fx) { p.t += dt; p.x += (p.vx - s.Cv * (s.Z || 1) * p.par) * dt; p.y += p.vy * dt; if (p.bubble || p.kind === 'snow') p.x += Math.sin(p.t * 2.6 + p.ph) * 10 * dt; }
    s.fx = s.fx.filter((p) => p.t < p.life && p.x > -30 && p.x < W + 60 && p.y < H + 10 && p.y > -10);
    // gulls fly along (not over the dark, deep or neon seas)
    const gullW = (['abyss', 'city', 'volcano'].includes(s.fromK) ? 0 : wO) + (['abyss', 'city', 'volcano'].includes(s.toK) ? 0 : wD);
    s.gullT = (s.gullT ?? 0.3) - dt;
    if (s.gullT <= 0 && s.gulls.length < 5 && gullW > 0.3) {
      s.gullT = 0.5 + Math.random() * 1.1;
      const sc = (s.Z || 1) > 1.3 ? 2 : 1;
      s.gulls.push({ x: -24 * sc - Math.random() * 40, y: s.hz * (0.25 + Math.random() * 0.5), vx: 50 + Math.random() * 90, ph: Math.random() * 3, fl: 7 + Math.random() * 4, t: 0, sc });
    }
    for (const q of s.gulls) { q.t += dt; q.x += q.vx * dt; q.y += Math.sin(q.t * 1.4 + q.ph) * 8 * dt; }
    s.gulls = s.gulls.filter((q) => q.x < W + 40);
  }

  spawnFx(s, fx, W, H) {
    const hz = s.hz, r = Math.random;
    const P = (o) => s.fx.push({ t: 0, ph: r() * TAU, par: 0, ...o, kind: fx });
    if (fx === 'snow') P({ x: r() * (W + 160), y: -4, vx: -24 - r() * 30, vy: 34 + r() * 40, life: 8, c: r() < 0.3 ? '#dff4ff' : '#ffffff', sz: r() < 0.35 ? 3 : 2, par: 0.3, flake: 1 });
    else if (fx === 'embers') P({ x: r() * (W + 160), y: hz - r() * 20, vx: -10 + r() * 20, vy: -40 - r() * 60, life: 2.5 + r() * 2, c: r() < 0.5 ? '#ffc23a' : '#ff6a2a', sz: r() < 0.3 ? 2 : 1, par: 0.35, flick: 1 });
    else if (fx === 'neon') P({ x: r() * (W + 220), y: -8, vx: -50, vy: 340 + r() * 120, life: 2, c: r() < 0.5 ? '#ff7ae0' : '#5affea', sz: 1, len: 6, par: 0.2 });
    else if (fx === 'drizzle') P({ x: r() * (W + 220), y: -8, vx: -90, vy: 380 + r() * 100, life: 2, c: '#8a9ac0', sz: 1, len: 7, par: 0.2 });
    else if (fx === 'specks') P({ x: r() * (W + 100), y: hz + 8 + r() * (H - hz - 12), vx: 0, vy: -4 - r() * 6, life: 1.6 + r(), c: r() < 0.5 ? '#7affb0' : '#c8ff6a', sz: r() < 0.3 ? 2 : 1, par: 0.8, flick: 1 });
    else if (fx === 'bubbles') P({ x: r() * (W + 100), y: hz - 4 - r() * 30, vx: 6, vy: -16 - r() * 18, life: 6, c: '#ffffff', sz: 2 + Math.floor(r() * 4), par: 0.15, bubble: 1 });
    else if (fx === 'glints') P({ x: r() * (W + 100), y: hz + 3 + r() * 10, vx: 0, vy: 0, life: 0.5 + r() * 0.4, c: '#ffffff', sz: 1, par: 1, glint: 1 });
    // ash flakes ride with the embers
    if (fx === 'embers' && r() < 0.6) s.fx.push({ t: 0, ph: r() * TAU, kind: 'ash', x: r() * (W + 160), y: -4, vx: -20 - r() * 20, vy: 30 + r() * 30, life: 7, c: r() < 0.5 ? '#6a5a5a' : '#9a8a84', sz: 2, par: 0.3 });
  }

  // ------------------------------------------------------------ drawing
  // Main canvas, after the world: grabs the postcards and draws the sea scene over everything while away.
  drawOver(ctx, dt) {
    const s = this.s;
    if (!s) return;
    const g = this.game, W = g.screen.W, H = g.screen.H;
    s.drawDt = clamp(dt || 1 / 60, 0, 0.05) * s.speed;
    if (s.capPending === 'origin') {
      s.capPending = null;
      this.grabOrigin(s, ctx);
    } else if (s.capPending === 'dest') {
      if (--s.capWait <= 0) { s.capPending = null; this.grabDest(s, ctx); }
    }
    if (s.phase === 'depart') return;
    const L = this.ensureLayer(W, H), lc = ctxOf(L);
    if (s.phase === 'settle') {
      // the arrival postcard dissolves into the live scene; the live boat is under it, so the puppet rides on top
      const a = 1 - smoothstep(0, 0.4, s.pt);
      if (!s.dest || a <= 0.01) return;
      lc.setTransform(1, 0, 0, 1, 0, 0);
      lc.globalAlpha = 1;
      lc.clearRect(0, 0, W, H);
      lc.drawImage(s.dest.canvas, 0, 0, W, H);
      s.Z = 1;
      this.drawPuppet(lc, s, s.hz);
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = a; ctx.drawImage(L, 0, 0); ctx.restore();
      return;
    }
    this.drawScene(lc, s, W, H);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(L, 0, 0);
    ctx.restore();
  }

  ensureLayer(W, H) {
    if (!this.layer || this.layer.width !== W || this.layer.height !== H) this.layer = makeCanvas(W, H);
    return this.layer;
  }

  grab(ctx) {
    const g = this.game, W = g.screen.W, H = g.screen.H;
    const c = makeCanvas(W, H);
    ctxOf(c).drawImage(ctx.canvas, 0, 0, ctx.canvas.width, ctx.canvas.height, 0, 0, W, H);
    return c;
  }

  // screen y of the waterline under the current camera
  horizonNow() {
    const g = this.game, lvl = g.ocean.waterLevel();
    const [z, , oy] = g.camera.xform();
    return Number.isFinite(lvl) ? Math.round(lvl * z + oy) : Math.round(g.screen.H * 0.66);
  }

  grabOrigin(s, ctx) {
    const g = this.game, boat = g.boat, W = g.screen.W, H = g.screen.H;
    const hz = clamp(this.horizonNow(), 40, H - 40);
    const c = this.grab(ctx);
    s.orig = { canvas: c, masked: maskEdge(c, 'right', W, H), hz };
    s.hz = hz; s.hzF = hz;
    const sampled = samplePal(c, hz, W, H);
    if (sampled) { s.palO = sampled; s.pal = copyPal(sampled); }
    // the boat's screen spot becomes the puppet's start
    const [z, ox] = g.camera.xform();
    s.X = boat ? boat.x * z + ox : W * 0.7;
    s.C = 0; s.Cv = 0; s.B = s.X; s.Bv = Math.max(60, s.v1 || 300);
    s.roll = 0; s.Z = 1;
    s.phase = 'sea'; s.pt = 0;
    if (s.ts) { s.ts.live = false; s.ts.hideBoat = false; }
    if (boat) boat.pilot = null;
    g.camera.drive = null;
    try { g.school?.clear?.(); } catch { /* ignore */ }
  }

  grabDest(s, ctx) {
    const g = this.game, W = g.screen.W, H = g.screen.H;
    const hz = clamp(this.horizonNow(), 40, H - 40);
    const c = this.grab(ctx);
    s.dest = { canvas: c, masked: maskEdge(c, 'left', W, H), hz };
    s.hzD = hz;
    const sampled = samplePal(c, hz, W, H);
    if (sampled) s.palDT = sampled;
    if (s.ts) { s.ts.live = false; }
  }

  // zoom of a layer (k = 0 infinitely far .. 1 at the boat's distance) and the screen spot of a 1x point
  zl(s, k) { return 1 + ((s.Z || 1) - 1) * k; }
  zx(s, x, k) { return s.X + (x - s.X) * this.zl(s, k); }
  zy(s, y, k) { return s.hz + (y - s.hz) * this.zl(s, k); }

  drawScene(c, s, W, H) {
    const t = s.t, dt = s.drawDt || 1 / 60;
    // palette: origin -> destination (the destination target eases toward its sampled colours once grabbed)
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) s.palD.sky[i][j] = damp(s.palD.sky[i][j], s.palDT.sky[i][j], 4, dt);
    for (let i = 0; i < 2; i++) for (let j = 0; j < 3; j++) s.palD.sea[i][j] = damp(s.palD.sea[i][j], s.palDT.sea[i][j], 4, dt);
    // origin -> the open sea -> destination
    const u = s.u, M = s.palM, a = smoothstep(0, 0.5, u), b = smoothstep(0.45, 1, u);
    const tmp = this.tmpC || (this.tmpC = [0, 0, 0]);
    for (let i = 0; i < 3; i++) { mixRGB(s.palO.sky[i], M.sky[i], a, tmp); mixRGB(tmp, s.palD.sky[i], b, s.pal.sky[i]); }
    for (let i = 0; i < 2; i++) { mixRGB(s.palO.sea[i], M.sea[i], a, tmp); mixRGB(tmp, s.palD.sea[i], b, s.pal.sea[i]); }
    // horizon: the origin's, then the destination's
    s.hzF ??= s.hz;
    if (s.phase === 'sea') s.hzF = damp(s.hzF, Math.round(H * 0.73), 2.2, dt);
    else if (s.phase === 'arrive' && s.dest) {
      s.hzA ??= s.hzF;
      const e = s.pt / s.D.arrive;
      s.hzF = e >= 0.6 ? s.hzD : lerp(s.hzA, s.hzD, smoothstep(0, 0.6, e));
    }
    s.hz = Math.round(s.hzF);
    // the virtual camera moves in on the boat at sea and back out for the arrival
    if (s.phase === 'sea') s.Z = s.kind === 'dest' ? 1 + 0.5 * smoothstep(0.05, s.D.sea, s.pt) : 1 + 0.65 * smoothstep(0.1, Math.max(0.6, s.D.sea * 0.75), s.pt);
    else if (s.phase === 'arrive') s.Z = lerp(s.Za ?? s.Z, 1, smoothstep(0.05, 0.75, s.pt / s.D.arrive));
    const hz = s.hz;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalAlpha = 1;
    c.globalCompositeOperation = 'source-over';
    this.drawSky(c, s, W, hz);
    this.drawSun(c, s, W, hz);
    const aw = this.kindW(s, 'ice');
    if (aw > 0.05) {
      s.aurT = (s.aurT || 0) + 1;
      if (!this.aur || this.aur.width !== W || this.aur.height !== hz || s.aurT % 3 === 0 || Math.abs((this.aurW || 0) - aw) > 0.06) {
        if (!this.aur || this.aur.width !== W || this.aur.height !== hz) this.aur = makeCanvas(W, Math.max(1, hz));
        const ac = ctxOf(this.aur); ac.clearRect(0, 0, W, hz); drawAurora(ac, W, hz, t, aw); this.aurW = aw;
      }
      c.drawImage(this.aur, 0, 0);
    }
    this.drawClouds(c, s, W, hz, 0);
    this.drawIslands(c, s, W, hz, 0);
    this.drawClouds(c, s, W, hz, 1);
    this.drawIslands(c, s, W, hz, 1);
    if (s.kind === 'dest') this.drawPlace(c, s, W, hz);
    this.drawSea(c, s, W, H, hz);
    // the origin postcard leaves to the left (water at the water's speed, sky slower) and fades
    if (s.orig) {
      const fo = 1 - smoothstep(s.D.sea * 0.3, s.D.sea * 0.9, s.phase === 'sea' ? s.pt : 99);
      if (fo > 0.01) this.drawPost(c, s, s.orig.masked, s.orig.hz, -s.C, 0, fo, W, H, hz, LOCKED.has(s.from));
    }
    // the destination postcard glides in; its landmarks rise over the horizon
    if (s.dest && s.phase === 'arrive') {
      const e = clamp01(s.pt / s.D.arrive);
      const rem = Math.max(0, s.Cend - s.C);
      const rise = Math.pow(1 - e, 1.6) * Math.min(90, hz * 0.3);
      const lk = LOCKED.has(s.to);
      this.drawPost(c, s, s.dest.masked, s.dest.hz, rem, lk ? 0 : rise, smoothstep(0, 0.4, e), W, H, hz, lk);
    }
    this.drawFloats(c, s, W, hz);
    this.drawWake(c, s, hz);
    this.drawPuppet(c, s, hz);
    this.drawSpray(c, s, hz);
    this.drawFx(c, s, W, H, hz);
    this.drawGulls(c, s, t);
  }

  // a postcard in two bands: the sky band far (slower, barely zoomed, may sink below the horizon), the water near
  drawPost(c, s, img, phz, offX, rise, alpha, W, H, hz, locked = false) {
    if (alpha <= 0.01) return;
    c.globalAlpha = alpha;
    if (locked) {
      const zW = this.zl(s, 1);
      c.drawImage(img, Math.round(this.zx(s, offX, 1)), Math.round(this.zy(s, hz - phz, 1)), Math.round(W * zW), Math.round(H * zW));
      c.globalAlpha = 1;
      return;
    }
    const kS = 0.3, zS = this.zl(s, kS), zW = this.zl(s, 1);
    c.save(); c.beginPath(); c.rect(0, 0, W, hz); c.clip();
    const sx = this.zx(s, offX * 0.42, kS), sy = this.zy(s, hz - phz + rise, kS);
    c.drawImage(img, Math.round(sx), Math.round(sy), Math.round(W * zS), Math.round(H * zS));
    c.restore();
    c.save(); c.beginPath(); c.rect(0, hz, W, H - hz); c.clip();
    c.drawImage(img, Math.round(this.zx(s, offX, 1)), Math.round(this.zy(s, hz - phz, 1)), Math.round(W * zW), Math.round(H * zW));
    c.restore();
    c.globalAlpha = 1;
  }

  kindW(s, kind) { return (s.fromK === kind ? 1 - s.u : 0) + (s.toK === kind ? s.u : 0); }

  // sky / water: posterised gradients with ordered dithering, rendered into a 32 px tile and repeated
  drawSky(c, s, W, hz) {
    const [a, b, d] = s.pal.sky;
    this.tileSky = gradTile(this.tileSky, hz, (k, out) => (k < 0.55 ? mixRGB(a, b, k / 0.55, out) : mixRGB(b, d, (k - 0.55) / 0.45, out)), 20);
    c.fillStyle = c.createPattern(this.tileSky, 'repeat-x');
    c.fillRect(0, 0, W, hz);
  }

  drawSun(c, s, W, hz) {
    const day = (1 - s.night);
    const sunA = ((LOOK[s.fromK]?.sun ?? 1) * (1 - s.u) + (LOOK[s.toK]?.sun ?? 1) * s.u) * day;
    const x = Math.round(W * 0.78 - s.C * 0.006), y = Math.round(hz * 0.24);
    if (sunA > 0.04) {
      const lava = this.kindW(s, 'volcano');
      c.globalAlpha = clamp01(sunA);
      const g = glowDisc(12, lava > 0.5 ? '#ffb070' : '#fff2b0', '#ffffff');
      c.drawImage(g, x - (g.width >> 1), y - (g.height >> 1));
      c.globalAlpha = 1;
    }
    const moonA = clamp01(1 - sunA * 1.6) * 0.9;
    if (moonA > 0.04) {
      c.globalAlpha = moonA;
      const g = glowDisc(8, '#cfe0ff', '#ffffff');
      c.drawImage(g, Math.round(W * 0.22) - (g.width >> 1), Math.round(hz * 0.2) - (g.height >> 1));
      c.globalAlpha = 1;
      // a few twinkling stars over the dark seas
      const st = moonA * (1 - s.pal.sky[0][2] / 400);
      if (st > 0.1) {
        c.fillStyle = '#ffffff';
        for (let i = 0; i < 40; i++) {
          const sx = (((i * 233 + 17) - s.C * 0.01) % W + W) % W, sy = (i * 97) % Math.max(20, Math.round(hz * 0.7));
          c.globalAlpha = st * (0.4 + 0.6 * Math.abs(Math.sin(s.t * 2 + i)));
          c.fillRect(Math.round(sx), sy, 1, 1);
        }
        c.globalAlpha = 1;
      }
    }
  }

  drawClouds(c, s, W, hz, layer) {
    const par = layer ? 0.2 : 0.07, k = layer ? 0.3 : 0.08;
    // spawn ahead of the camera (from the right) so nothing pops in
    const key = layer ? 'nextCloud' : 'nextFar';
    const span = W + 200;
    const edge = s.C * par + span;
    if (s[key] < edge - span * 1.25) s[key] = edge - span * 1.25 + Math.random() * 60;
    while (s[key] < edge) {
      const set = cloudSet(layer ? 5 + Math.floor(Math.random() * 3) : Math.floor(Math.random() * 5));
      if (!set) { s[key] = edge; break; }
      const pick = Math.random() < s.u ? s.toK : s.fromK;
      const pal = LOOK[pick]?.cloud || 'day';
      s.clouds.push({ x: s[key], y: Math.round(hz * (layer ? lerp(0.06, 0.36, Math.random()) : lerp(0.05, 0.45, Math.random()))), set, pal: s.night > 0.6 && pal === 'day' ? 'night' : pal, layer, kind: pick });
      s[key] += (layer ? 190 : 95) + Math.random() * (layer ? 240 : 140);
    }
    for (const cl of s.clouds) {
      if (cl.layer !== layer) continue;
      // tint follows the voyage: a cloud of the ocean we are leaving keeps its look, the sky decides the rest
      const spr = cl.set[cl.pal] || cl.set.day;
      if (!spr) continue;
      const z = this.zl(s, k);
      const x = Math.round(this.zx(s, cl.x - s.C * par, k)), y = Math.round(this.zy(s, cl.y, k));
      const w = Math.round(spr.width * z), h = Math.round(spr.height * z);
      if (x > W + 10 || x + w < -10) continue;
      c.globalAlpha = layer ? 0.96 : 0.8;
      c.drawImage(spr, x, y, w, h);
    }
    c.globalAlpha = 1;
    s.clouds = s.clouds.filter((cl) => cl.x - s.C * (cl.layer ? 0.2 : 0.07) + 300 > -60);
  }

  // islands on the horizon: a far row (small, hazy) and a nearer row (bigger, clearer), both oceans' kinds
  drawIslands(c, s, W, hz, layer) {
    const par = layer ? 0.5 : 0.22, k = layer ? 0.45 : 0.18, sc = layer ? 2 : 1;
    const key = layer ? 'nextIslN' : 'nextIsl';
    const edge = s.C * par + W + 80;
    if (!s[key]) s[key] = layer ? edge + 200 : edge - 60;
    while (s[key] < edge) {
      const kind = !layer && Math.random() < 0.3 ? 'sail' : Math.random() < s.u ? s.toK : s.fromK;
      const spr = islandSprite(kind, Math.floor(Math.random() * 2), true);
      if (spr) s.islands.push({ x: s[key], spr, kind, sc, layer, bob: Math.random() * 6 });
      s[key] += (layer ? 520 : 230) + Math.random() * (layer ? 520 : 280);
    }
    const haze = s.pal.sky[2];
    for (const is of s.islands) {
      if (is.layer !== layer) continue;
      const sp = is.spr, z = this.zl(s, k) * is.sc;
      const x = Math.round(this.zx(s, is.x - s.C * par, k)), y = hz + 2 + (is.kind === 'sail' ? Math.round(Math.sin(s.t * 1.6 + is.bob)) : 0);
      const w = Math.round(sp.w * z), h = Math.round(sp.h * z), top = Math.round(y - sp.oy * z);
      if (x > W + 10 || x + w < -10) continue;
      c.drawImage(sp.canvas, x, top, w, h);
      if (sp.glow) { c.globalCompositeOperation = 'lighter'; c.globalAlpha = 0.45; c.drawImage(sp.glow, x, top, w, h); c.globalCompositeOperation = 'source-over'; c.globalAlpha = 1; }
      // atmospheric haze toward the horizon colour
      const hzA = layer ? 0.18 : 0.42;
      if (!this.hazeC || this.hazeC.width < w || this.hazeC.height < h) this.hazeC = makeCanvas(Math.max(w, 64), Math.max(h, 64));
      const hc = ctxOf(this.hazeC);
      hc.globalCompositeOperation = 'source-over'; hc.clearRect(0, 0, w, h);
      hc.drawImage(sp.canvas, 0, 0, w, h);
      hc.globalCompositeOperation = 'source-atop'; hc.fillStyle = css(haze); hc.fillRect(0, 0, w, h);
      c.globalAlpha = hzA;
      c.drawImage(this.hazeC, 0, 0, w, h, x, top, w, h);
      c.globalAlpha = 1;
    }
    s.islands = s.islands.filter((is) => is.x - s.C * (is.layer ? 0.5 : 0.22) + is.spr.w * is.sc * 2 > -80);
  }

  // the Lab island / the Workshop dock appears on the horizon and grows as the boat closes in
  drawPlace(c, s, W, hz) {
    const k = smoothstep(0.25, 1, s.pt / s.D.sea);
    if (k <= 0 || !s.placeReady) return;
    let S = null;
    try { S = destSprite(s.to, 2); } catch { S = null; }
    if (!S) return;
    const z = lerp(0.35, 0.8, k) * this.zl(s, 0.3);
    const lab = s.to === 'lab';
    const x = Math.round(lerp(W * 1.08, W * 0.8, ease.outCubic(k))), bob = lab ? Math.sin(s.t * 1.3) * 3 : 0;
    const w = Math.round(S.w * z), h = Math.round(S.h * z);
    const y = Math.round(hz + 2 - S.oy * z + (lab ? -26 * z + bob : 0));
    c.globalAlpha = smoothstep(0, 0.3, k);
    c.drawImage(S.canvas, x - Math.round(S.ox * z), y, w, h);
    if (S.glow) { c.globalCompositeOperation = 'lighter'; c.globalAlpha *= 0.5; c.drawImage(S.glow, x - Math.round(S.ox * z), y, w, h); c.globalCompositeOperation = 'source-over'; }
    c.globalAlpha = 1;
  }

  drawSea(c, s, W, H, hz) {
    const [top, deep] = s.pal.sea, t = s.t, Z = s.Z || 1, dt = s.drawDt || 1 / 60;
    this.tileSea = gradTile(this.tileSea, H - hz, (k, out) => mixRGB(top, deep, Math.pow(k, 0.75), out), 16);
    c.save();
    c.translate(0, hz);
    c.fillStyle = c.createPattern(this.tileSea, 'repeat-x');
    c.fillRect(0, 0, W, H - hz);
    c.restore();
    // a lighter sheen just under the surface
    const sheen = mixRGB(top, [255, 255, 255], 0.3);
    c.fillStyle = css(sheen, 0.55);
    c.fillRect(0, hz + 1, W, Math.round(2 * Z));
    c.fillStyle = css(sheen, 0.25);
    c.fillRect(0, hz + 1 + Math.round(2 * Z), W, Math.round(3 * Z));
    // the surface: a swell moving with the water, foam crests on top
    const amp = this.amp(s) * Z;
    const sea = (x) => s.B + (x - s.X) / Z;
    const skyLow = s.pal.sky[2];
    c.fillStyle = css(skyLow);
    for (let x = 0; x < W; x += 2) {
      const wy = Math.round(waveY(sea(x), t, amp));
      if (wy < 0) c.fillRect(x, hz + wy, 2, -wy);
    }
    const crest = mixRGB(top, [255, 255, 255], 0.6);
    c.fillStyle = css(crest);
    for (let x = 0; x < W; x += 2) {
      const sx = sea(x), wy = Math.round(waveY(sx, t, amp));
      c.fillRect(x, hz + wy, 2, 1);
      // whitecaps on the steeper crests
      if (waveY(sx + 3, t, amp) - waveY(sx - 3, t, amp) < -1.2 * Z && hash2(Math.floor(sx / 6), 7, 3) > 0.45) { c.fillStyle = '#ffffff'; c.fillRect(x, hz + wy - 1, 2, 1); c.fillStyle = css(crest); }
    }
    // streaks and glints drifting under the surface (they ride with the water)
    const rows = 40;
    c.fillStyle = '#ffffff';
    for (let i = 0; i < rows; i++) {
      const dy = 5 + ((i * 37) % Math.max(10, H - hz - 10));
      const kk = dy / Math.max(1, H - hz);
      const y = hz + Math.round(dy);
      const len = Math.round((3 + (i % 4) * 3) * Z * (1 - kk * 0.4));
      const sp = 1 - kk * 0.5;
      const span = W + 60;
      const x = ((((i * 173) - s.C * sp * Z) % span) + span) % span - 30;
      c.globalAlpha = (0.3 - kk * 0.24);
      c.fillRect(Math.round(x), y, len, 1);
    }
    // dappled light right under the surface (pixel wiggles), scaled with the shot
    c.fillStyle = '#fffff0';
    for (let i = 0; i < 30; i++) {
      const span = W + 40;
      const x = ((((i * 211) - s.C * Z) % span) + span) % span - 20;
      const y = hz + Math.round((7 + (i % 6) * 6) * Z + Math.sin(t * 2 + i) * 1.5);
      c.globalAlpha = 0.16;
      c.fillRect(Math.round(x), y, Math.round((4 + (i % 3) * 2) * Z), 1);
      c.fillRect(Math.round(x + 2 * Z), y + 1, Math.round(2 * Z), 1);
    }
    // caustic shimmer net under the surface (a tiling pixel pattern, two layers sliding past each other)
    const cz = caustTile();
    const cw2 = cz.width, chh = cz.height;
    for (const [sp2, al, oy2] of [[1, 0.2, 0], [0.7, 0.12, 5]]) {
      const off = ((-(s.C * sp2 * Z) - t * 9 * sp2) % cw2 + cw2) % cw2;
      c.globalAlpha = al;
      for (let x = -cw2 + off; x < W; x += cw2) c.drawImage(cz, Math.round(x), hz + 3 + oy2, cw2, chh);
    }
    c.globalAlpha = 1;
    // bubble columns rising from the deep, riding with the water
    s.colT = (s.colT ?? 0.4) - dt;
    if (s.colT <= 0) { s.colT = 0.35 + Math.random() * 0.6; s.cols.push({ x: s.B + (W * (0.6 + Math.random() * 0.6)) / Z, t: 0, ph: Math.random() * 9 }); }
    c.fillStyle = 'rgba(230,250,255,0.55)';
    for (const col of s.cols) {
      col.t += dt;
      const bx0 = s.X + (col.x - s.B) * Z;
      if (bx0 < -20 || bx0 > W + 20) continue;
      for (let i = 0; i < 7; i++) {
        const yy = H - ((col.t * 40 + i * 23 + col.ph * 7) % Math.max(30, H - hz - 10));
        if (yy < hz + 8) continue;
        const xx = Math.round(bx0 + Math.sin(col.t * 3 + i) * 2), r = i % 3 === 0 ? 2 : 1;
        if (r > 1) { c.fillRect(xx, yy - 2, 2, 1); c.fillRect(xx - 1, yy - 1, 1, 2); c.fillRect(xx + 2, yy - 1, 1, 2); c.fillRect(xx, yy + 1, 2, 1); }
        else c.fillRect(xx, Math.round(yy), 1, 1);
      }
    }
    s.cols = s.cols.filter((col) => col.t < 6 && s.X + (col.x - s.B) * Z > -40);
    // floating motes in the deep
    c.fillStyle = css(mixRGB(top, [255, 255, 255], 0.5));
    for (let i = 0; i < 36; i++) {
      const span = W + 20;
      const x = ((((i * 149) - s.C * 0.7) % span) + span) % span - 10;
      const y = hz + 20 + ((i * 59 + Math.floor(t * 6 + i)) % Math.max(20, H - hz - 24));
      c.globalAlpha = 0.25 + 0.2 * Math.sin(t * 3 + i);
      c.fillRect(Math.round(x), y, 1, 1);
    }
    c.globalAlpha = 1;
  }

  amp(s) { return 1.2 * ((LOOK[s.fromK]?.wave ?? 1) * (1 - s.u) + (LOOK[s.toK]?.wave ?? 1) * s.u); }

  // channel buoys bobbing past on the near water (they ride with the water: the best speed cue)
  drawFloats(c, s, W, hz) {
    const Z = s.Z || 1, amp = this.amp(s) * Z, t = s.t;
    if (s.phase === 'sea') {
      s.nextFloat ??= s.B + W * 0.9;
      if (s.nextFloat < s.B + (W * 1.1) / Z) { s.floats.push({ x: s.nextFloat, ph: Math.random() * 6 }); s.nextFloat += W * (0.8 + Math.random() * 0.9); }
    }
    const spr = islandSprite('buoy', 0, true);
    if (!spr) return;
    for (const f of s.floats) {
      const x = s.X + (f.x - s.B) * Z;
      if (x < -40 || x > W + 40) continue;
      const wy = waveY(f.x, t, amp), tilt = Math.sin(t * 2.2 + f.ph) * 1.2;
      const w = Math.round(spr.w * Z), h = Math.round(spr.h * Z);
      c.drawImage(spr.canvas, Math.round(x - w / 2 + tilt), Math.round(hz + wy - (spr.oy - 4) * Z), w, h);
      if (spr.glow) { c.globalCompositeOperation = 'lighter'; c.globalAlpha = 0.5 + 0.5 * Math.sin(t * 4 + f.ph); c.drawImage(spr.glow, Math.round(x - w / 2 + tilt), Math.round(hz + wy - (spr.oy - 4) * Z), w, h); c.globalCompositeOperation = 'source-over'; c.globalAlpha = 1; }
      // the water laps around it
      c.fillStyle = 'rgba(255,255,255,0.8)';
      c.fillRect(Math.round(x - w / 2 - 2 * Z), Math.round(hz + wy), Math.round(w + 4 * Z), 1);
    }
    s.floats = s.floats.filter((f) => s.X + (f.x - s.B) * Z > -60);
  }

  drawWake(c, s, hz) {
    const t = s.t, Z = s.Z || 1, amp = this.amp(s) * Z;
    const X = (x) => Math.round(s.X + (x - s.B) * Z);
    c.fillStyle = '#ffffff';
    for (const p of s.wake) {
      const k = p.t / p.life, x = X(p.x - p.t * 18);
      c.globalAlpha = (1 - k) * 0.9;
      c.fillRect(x, hz + Math.round(waveY(p.x, t, amp)) - (k < 0.3 ? 1 : 0), Math.max(1, Math.round(p.w * Z * (1 - k * 0.5))), 1);
    }
    for (const p of s.bubbles) {
      const k = p.t / p.life, x = X(p.x), y = Math.round(hz + p.y * Z), r = p.r * (Z > 1.4 ? 2 : 1);
      c.globalAlpha = (1 - k) * 0.75;
      if (r > 1) { c.fillRect(x, y - r, r, 1); c.fillRect(x - 1, y - r + 1, 1, r); c.fillRect(x + r, y - r + 1, 1, r); c.fillRect(x, y + 1, r, 1); }
      else c.fillRect(x, y, 1, 1);
    }
    c.globalAlpha = 1;
  }

  drawSpray(c, s, hz) {
    const Z = s.Z || 1;
    const drop = pxFrames('drop', 'aqua', Z > 1.4 ? 1 : 0);
    for (const p of s.spray) {
      const k = p.t / p.life;
      const f = drop[Math.min(drop.length - 1, Math.floor(k * drop.length))];
      if (!f) continue;
      c.globalAlpha = 1 - k * 0.5;
      c.drawImage(f, Math.round(s.X + (p.x - s.B) * Z - f.width / 2), Math.round(hz + p.y * Z - f.height / 2));
    }
    c.globalAlpha = 1;
  }

  // the boat with the player on deck (the real Boat's sprites, drawn at the puppet's spot and the shot's zoom)
  drawPuppet(c, s, hz) {
    const g = this.game, boat = g.boat;
    if (!boat?.model) return;
    const t = s.t, Z = s.Z || 1, amp = this.amp(s) * Z;
    const R = Z >= 1.4 ? 2 : 1;
    const bx = Math.round(s.X);
    const half = 30;
    const yl = waveY(s.B - half, t, amp), ym = waveY(s.B, t, amp), yr = waveY(s.B + half, t, amp);
    const by = Math.round(hz + (yl + ym * 2 + yr) / 4);
    const slope = (yr - yl) / (half * 2 * Z);
    const pitch = s.phase === 'arrive' ? -1 : s.phase === 'sea' && s.pt < 0.6 ? 1 : 0.3;
    const roll = clamp(-Math.atan(slope) * 57.3 * 1.2 - clamp(s.Bv / 900, 0, 1) * 2.4 * pitch - Math.sin(t * 2.1) * 0.9, -8, 8);
    s.roll = damp(s.roll || 0, roll, 8, s.drawDt || 1 / 60);
    let ri = 3, bd = 1e9;
    [-8, -5.3, -2.7, 0, 2.7, 5.3, 8].forEach((r, i) => { const d = Math.abs(r - s.roll); if (d < bd) { bd = d; ri = i; } });
    try { boat.model(); } catch { return; }
    const M = boat.M;
    const get = (rr, RR) => boat.sprites.get(boat.modelKey + ':1:' + rr + ':' + RR);
    let spr = null, SR = R;
    for (const RR of R === 2 ? [2, 1] : [1, 2]) {
      spr = get(ri, RR);
      for (let d = 1; d < 7 && !spr; d++) spr = get(ri - d, RR) || get(ri + d, RR);
      if (spr) { SR = RR; break; }
    }
    if (!spr) { try { spr = boat.buildSprite(M, 1, 3, 1); boat.sprites.set(boat.modelKey + ':1:3:1', spr); SR = 1; } catch { return; } }
    const A = spr.A, pad = 40 * SR;
    const w = spr.canvas.width + pad * 2, h = spr.canvas.height + pad * 2;
    if (!this.pl || this.pl.width < w || this.pl.height < h) this.pl = makeCanvas(w + 20, h + 20);
    const lc = ctxOf(this.pl);
    lc.setTransform(1, 0, 0, 1, 0, 0);
    lc.globalCompositeOperation = 'source-over';
    lc.globalAlpha = 1;
    lc.clearRect(0, 0, this.pl.width, this.pl.height);
    lc.drawImage(spr.canvas, pad, pad);
    const sx = spr.px + pad + Math.round(A.stand[0] * SR), sy = spr.py + pad + Math.round(A.stand[1] * SR);
    const pose = s.phase === 'arrive' && clamp01(s.pt / s.D.arrive) > 0.5 ? 'wave' : s.phase === 'sea' && s.kind === 'dest' && s.pt > s.D.sea * 0.6 ? 'wave' : 'idle';
    try { Character.drawCharacter(lc, sx, sy, { pose, t, facing: 1, look: g.state.character, scale: 0.62 * SR, id: 'boat', shadow: true }); } catch { /* character optional */ }
    if (spr.front) lc.drawImage(spr.front, pad, pad);
    // the hull below the waterline takes the water's colour
    const k = Z / SR; // screen px per layer px
    const ox = bx - (spr.px + pad) * k, oy = by - (spr.py + pad) * k;
    lc.globalCompositeOperation = 'source-atop';
    lc.fillStyle = css(s.pal.sea[0]);
    for (const [al, dy] of [[0.45, 1], [0.25, 7]]) {
      lc.globalAlpha = al;
      for (let x = 0; x < w; x += 2) {
        const scrX = ox + x * k;
        const wy = hz + waveY(s.B + (scrX - s.X) / Z, t, amp) + dy * Z;
        const yy = Math.round((wy - oy) / k);
        if (yy < h) lc.fillRect(x, Math.max(0, yy), 2, h - Math.max(0, yy));
      }
    }
    lc.globalCompositeOperation = 'source-over';
    lc.globalAlpha = 1;
    c.drawImage(this.pl, 0, 0, w, h, Math.round(ox), Math.round(oy), Math.round(w * k), Math.round(h * k));
    // flag + boat extras (turbines, jets) through the real boat's helpers, in its world units
    const vx0 = boat.vx, dir0 = boat.dir;
    boat.vx = s.Bv * 0.4; boat.dir = 1;
    c.save();
    c.translate(bx, by); c.scale(Z, Z);
    try { if (A.flag) boat.drawFlag(c, A.flag[0], A.flag[1]); } catch { /* ignore */ }
    try { BM.drawBoatAnim?.(c, M?.T, A, 0, 0, t, 1, 2); } catch { /* ignore */ }
    c.restore();
    boat.vx = vx0; boat.dir = dir0;
    // bow wave + stern foam on the waterline
    c.fillStyle = '#f4fffc';
    const sp = s.Bv;
    for (const [ex, side] of [[A.stern[0], -1], [A.bow[0], 1]]) {
      const n = 2 + Math.round(Math.min(8, sp / 50));
      for (let i = 0; i < n; i++) {
        const fx = Math.round(bx + ex * Z + side * (i * 2 + ((t * 9 + i) % 2)) * Z);
        const q = hash2(i, Math.floor(t * 10), side + 3);
        if (q < 0.3) continue;
        c.globalAlpha = 0.95 - i * 0.09;
        c.fillRect(fx, Math.round(hz + waveY(s.B + (fx - s.X) / Z, t, amp)) - (q > 0.75 ? Math.round(Z) : 0), Math.round(2 * Z), Math.max(1, Math.round(Z * 0.8)));
      }
    }
    c.globalAlpha = 1;
  }

  drawFx(c, s, W, H, hz) {
    for (const p of s.fx) {
      const k = p.t / p.life;
      let a = Math.min(1, p.t * 4, (1 - k) * 3);
      if (p.flick) a *= 0.6 + 0.4 * Math.sin(p.t * 20 + p.ph);
      if (p.glint) a = Math.sin(k * Math.PI);
      c.globalAlpha = clamp01(a);
      const x = Math.round(p.x), y = Math.round(p.y);
      if (p.len) { c.fillStyle = p.c; c.fillRect(x, y, 1, p.len); c.globalAlpha *= 0.5; c.fillRect(x + 1, y - 2, 1, 2); }
      else if (p.bubble) {
        const b = pixelBubble(p.sz + 1);
        if (b) c.drawImage(b, x - (b.width >> 1), y - (b.height >> 1));
      } else if (p.flake) {
        // a pixel snowflake with a faint blue rim so it reads on a bright sky
        c.fillStyle = '#8ab8d8';
        if (p.sz >= 3) { c.fillRect(x - 1, y + 1, 3, 1); c.fillStyle = p.c; c.fillRect(x, y - 1, 1, 3); c.fillRect(x - 1, y, 3, 1); }
        else { c.fillRect(x, y + 1, 2, 1); c.fillStyle = p.c; c.fillRect(x, y, 2, 1); }
      } else if (p.glint) { c.fillStyle = p.c; c.fillRect(x - 1, y, 3, 1); c.fillRect(x, y - 1, 1, 3); }
      else { c.fillStyle = p.c; c.fillRect(x, y, p.sz, p.sz); }
    }
    c.globalAlpha = 1;
    void W; void H; void hz;
  }

  drawGulls(c, s, t) {
    const F = gullFrames();
    for (const q of s.gulls) {
      const f = F[Math.floor((q.t * q.fl + q.ph) % 3)];
      c.drawImage(f, Math.round(q.x), Math.round(q.y), f.width * q.sc, f.height * q.sc);
    }
    void t;
  }

  // ------------------------------------------------------------ UI layer: route chart, skip hint, the title
  drawUi(ctx, dt) {
    const g = this.game, W = g.screen.W, H = g.screen.H;
    if (this.fade) {
      const f = this.fade;
      f.t += dt;
      const a = 1 - smoothstep(0, f.d, f.t);
      if (a <= 0.01) this.fade = null;
      else { ctx.save(); ctx.globalAlpha = a; ctx.drawImage(f.canvas, 0, 0, W, H); ctx.restore(); }
    }
    const s = this.s;
    if (s && s.phase !== 'settle' && !(s.phase === 'depart' && s.pt < 0.25)) {
      const a = s.phase === 'depart' ? smoothstep(0.25, 0.7, s.pt) : s.phase === 'arrive' ? 1 - smoothstep(0.55, 0.95, s.pt / s.D.arrive) : 1;
      if (a > 0.01) this.drawChart(ctx, s, W, H, a);
    }
    if (this.title) this.drawTitle(ctx, dt, W, H);
  }

  // a little glass chart card in the lower letterbox: every ocean as a pin, the dotted route, the boat on it
  drawChart(ctx, s, W, H, a) {
    const bars = Math.round(H * 0.11 * (this.game.camera?.bars ?? 1));
    if (bars < 24) return;
    const L = MAP_LOCATIONS;
    const loc = (id) => L.find((q) => q.id === id);
    let A = loc(s.from)?.sea, B = s.kind === 'ocean' ? loc(s.to)?.sea : null;
    if (!A) A = [0, 50];
    if (!B) B = s.to === 'lab' ? [A[0] - 26, A[1] - 22] : [A[0] + 24, A[1] + 26];
    const cw = Math.min(360, Math.round(W * 0.36)), ch = bars - 12;
    const x0 = Math.round(W / 2 - cw / 2), y0 = H - bars + 6, t = s.t;
    ctx.save();
    ctx.globalAlpha = a;
    // card: a stepped-corner glass plate with a gloss band, a bright rim and a dark outline
    const plate = (x, y, w, h, col) => { ctx.fillStyle = col; ctx.fillRect(x + 2, y, w - 4, h); ctx.fillRect(x + 1, y + 1, w - 2, h - 2); ctx.fillRect(x, y + 2, w, h - 4); };
    plate(x0 - 1, y0 - 1, cw + 2, ch + 2, '#04182e');
    plate(x0, y0, cw, ch, '#bff4ff');
    plate(x0 + 1, y0 + 1, cw - 2, ch - 2, '#0c3a68');
    const gl = ctx.createLinearGradient(0, y0, 0, y0 + ch);
    gl.addColorStop(0, '#2a78b8'); gl.addColorStop(0.5, '#155896'); gl.addColorStop(1, '#0a3a70');
    plate(x0 + 2, y0 + 2, cw - 4, ch - 4, gl);
    ctx.fillStyle = 'rgba(255,255,255,0.14)';
    ctx.fillRect(x0 + 3, y0 + 3, cw - 6, Math.round((ch - 6) * 0.38));
    // compass rose (left): 8 points, a swinging needle
    const cx = x0 + Math.round(ch / 2) + 2, cy = y0 + Math.round(ch / 2), R = Math.max(8, Math.round(ch * 0.36));
    ctx.fillStyle = 'rgba(190,240,255,0.35)';
    for (let i = -R; i <= R; i++) { ctx.fillRect(cx + i, cy, 1, 1); ctx.fillRect(cx, cy + i, 1, 1); }
    for (let i = -Math.round(R * 0.6); i <= Math.round(R * 0.6); i++) { ctx.fillRect(cx + i, cy + i, 1, 1); ctx.fillRect(cx + i, cy - i, 1, 1); }
    ctx.fillStyle = '#e8fbff'; ctx.fillRect(cx - 1, cy - R - 2, 3, 2); // north tick
    const ang = -Math.PI / 2 + 0.75 + Math.sin(t * 2.3) * 0.18 + Math.sin(t * 5.1) * 0.05;
    for (let i = -R + 2; i <= R - 2; i++) {
      const px = Math.round(cx + Math.cos(ang) * i), py = Math.round(cy + Math.sin(ang) * i);
      ctx.fillStyle = i > 0 ? '#ff6a5a' : '#ffffff';
      ctx.fillRect(px, py, 2, 2);
    }
    ctx.fillStyle = '#ffe27a'; ctx.fillRect(cx - 1, cy - 1, 3, 3);
    // the map: every ocean as a small pin, a dotted arc for the route, the boat on it
    const xs = L.map((l) => l.sea[0]).concat([A[0], B[0]]), ys = L.map((l) => l.sea[1]).concat([A[1], B[1]]);
    const mnx = Math.min(...xs) - 8, mxx = Math.max(...xs) + 8, mny = Math.min(...ys) - 8, mxy = Math.max(...ys) + 8;
    const ix = cx + R + 14, iw = x0 + cw - 30 - ix, iy = y0 + 7, ih = ch - 14;
    const P = (p) => [ix + ((p[0] - mnx) / (mxx - mnx)) * iw, iy + ((p[1] - mny) / (mxy - mny)) * ih];
    // faint chart grid
    ctx.fillStyle = 'rgba(190,240,255,0.12)';
    for (let gx = ix; gx < ix + iw; gx += 12) for (let gy = iy; gy < iy + ih; gy += 3) ctx.fillRect(gx, gy, 1, 1);
    const colOf = (id) => loc(id)?.color || (id === 'lab' ? '#7affc8' : '#ffb43c');
    const pin = (p, col, r) => {
      const x = Math.round(p[0]), y = Math.round(p[1]);
      ctx.fillStyle = '#04182e'; ctx.fillRect(x - r - 1, y - r, r * 2 + 2, r * 2); ctx.fillRect(x - r, y - r - 1, r * 2, r * 2 + 2);
      ctx.fillStyle = col; ctx.fillRect(x - r, y - r, r * 2, r * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.fillRect(x - r, y - r, Math.max(1, r - 1), 1);
    };
    for (const l of L) if (l.id !== s.from && l.id !== s.to) { ctx.globalAlpha = a * 0.55; pin(P(l.sea), l.color, 1); }
    ctx.globalAlpha = a;
    const [ax, ay] = P(A), [bx2, by2] = P(B);
    const mx = clamp((ax + bx2) / 2 + (by2 - ay) * 0.22, ix, ix + iw), my = clamp((ay + by2) / 2 - (bx2 - ax) * 0.22, iy + 2, iy + ih - 2);
    const q = (k) => [(1 - k) * (1 - k) * ax + 2 * (1 - k) * k * mx + k * k * bx2, (1 - k) * (1 - k) * ay + 2 * (1 - k) * k * my + k * k * by2];
    const prog = s.phase === 'depart' ? 0.08 * (s.pt / s.D.depart) : s.phase === 'sea' ? lerp(0.08, 0.86, clamp01(s.pt / s.D.sea)) : lerp(0.86, 1, clamp01(s.pt / s.D.arrive));
    const N = Math.max(16, Math.round(Math.hypot(bx2 - ax, by2 - ay) / 3));
    for (let i = 0; i <= N; i++) {
      const k = i / N, [px, py] = q(k);
      const done = k <= prog;
      if (!done && i % 2) continue;
      ctx.fillStyle = done ? '#ffffff' : 'rgba(220,248,255,0.55)';
      ctx.fillRect(Math.round(px), Math.round(py), done ? 2 : 1, done ? 2 : 1);
    }
    pin([ax, ay], colOf(s.from), 2);
    pin([bx2, by2], colOf(s.to), 3);
    // destination flag
    const fxp = Math.round(bx2) + 3, fyp = Math.round(by2) - 12;
    ctx.fillStyle = '#04182e'; ctx.fillRect(fxp - 1, fyp - 1, 3, 12);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(fxp, fyp, 1, 10);
    const wv = Math.sin(t * 7) > 0 ? 1 : 0;
    ctx.fillStyle = colOf(s.to); ctx.fillRect(fxp + 1, fyp, 5, 2); ctx.fillRect(fxp + 1, fyp + 2, 4 + wv, 2);
    ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.fillRect(fxp + 1, fyp, 5, 1);
    // the boat on the route: hull + sail, bobbing, a little wake behind it
    const [px, py] = q(Math.min(1, prog));
    const bxx = Math.round(px), byy = Math.round(py + Math.sin(t * 5) * 0.8);
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    for (let i = 1; i < 5; i++) { const [wx, wy] = q(Math.max(0, prog - i * 0.025)); ctx.fillRect(Math.round(wx), Math.round(wy) + 2, 1, 1); }
    ctx.fillStyle = '#04182e'; ctx.fillRect(bxx - 5, byy - 1, 11, 5); ctx.fillRect(bxx - 1, byy - 8, 6, 7);
    ctx.fillStyle = '#ff7a5a'; ctx.fillRect(bxx - 4, byy, 9, 2); ctx.fillStyle = '#c8462e'; ctx.fillRect(bxx - 3, byy + 2, 7, 1);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(bxx, byy - 7, 1, 7); ctx.fillRect(bxx + 1, byy - 6, 3, 5);
    ctx.fillStyle = '#bfe8ff'; ctx.fillRect(bxx + 1, byy - 2, 3, 1);
    // skip hint: a small fast-forward glyph at the card's right end
    if (s.skippable && !s.skipped && s.phase !== 'arrive') {
      const sx = x0 + cw - 22, sy = cy - 4;
      ctx.globalAlpha = a * (0.6 + 0.3 * Math.sin(t * 3));
      for (const ox2 of [0, 7]) {
        for (let i = 0; i < 5; i++) { ctx.fillStyle = '#04182e'; ctx.fillRect(sx + ox2 + i, sy + i - 1, 2, 11 - i * 2); }
        for (let i = 0; i < 5; i++) { ctx.fillStyle = '#ffffff'; ctx.fillRect(sx + ox2 + i, sy + i, 1, 9 - i * 2); }
      }
    }
    ctx.restore();
  }

  drawTitle(ctx, dt, W, H) {
    const T = this.title;
    T.t += dt;
    const t = T.t, hold = T.first ? 4.4 : 3.4;
    if (t > hold + 0.8) { this.title = null; return; }
    if (!T.def) {
      // the voxel letters were not ready in time: the whole word as one 3D sprite
      if (t < 0.05) return;
    }
    const out = clamp01((t - hold) / 0.8);
    const a = 1 - out;
    const cy = Math.round(H * 0.34); // clear of the top banners and of the boat
    if (!T.played && t > 0.05) {
      T.played = true;
      this.game.audio?.play('sparkle', { vol: 0.4 });
      if (T.first) { try { this.game.particles?.celebrate?.(W / 2, cy, 1.4, { layer: 'ui' }); } catch { /* ignore */ } }
    }
    ctx.save();
    ctx.globalAlpha = a;
    drawAeroGlow(ctx, W / 2, cy, Math.round(Math.min(W * 0.32, 260)), '#06264e', 0.38 * a);
    if (T.def) {
      const n = T.def.letters.length;
      T.def.letters.forEach((L, i) => {
        const li = clamp01((t - i * 0.05) / 0.5);
        if (li <= 0) return;
        const k = ease.outBack(li, 2.2);
        const fall = (1 - k) * -46;
        const sq = li < 1 ? 1 + Math.sin(li * Math.PI) * 0.12 : 1;
        const bob = Math.sin(t * 2.2 + i * 0.55) * 1.5;
        const lift = out * -12;
        const c = L.canvas, w = c.width / sq, h = c.height * sq;
        // each letter lands with a little splash of pixel droplets
        if (li >= 0.55 && !L.landed && t < 3) { L.landed = true; try { this.game.particles?.pixelBurst?.('drop', W / 2 + L.x, cy + c.height * 0.45, 2, { layer: 'ui', ramp: 'aqua', size: 0, dir: -Math.PI / 2, spread: 1.1, speed: [30, 70] }); } catch { /* fx optional */ } }
        ctx.globalAlpha = a * clamp01(li * 3);
        ctx.drawImage(c, Math.round((W / 2 + L.x - w / 2) * 2) / 2, Math.round((cy - h / 2 + fall + bob + lift) * 2) / 2, Math.round(w * 2) / 2, Math.round(h * 2) / 2);
      });
      // a glint sweeping along the letters
      const q = (t * 0.6) % 1.8;
      if (q < 1 && t > n * 0.05 + 0.4) drawSparkle(ctx, W / 2 - T.def.w / 2 + q * T.def.w, cy - T.def.h * 0.25, 2, a * 0.95);
    } else {
      drawPop3D(ctx, T.name, W / 2, cy, { t, pop: clamp01(t * 2), alpha: a, palette: typeof TITLE_PAL[T.to] === 'string' ? TITLE_PAL[T.to] : 'white', size: 24, depth: 4, glow: false });
    }
    ctx.globalAlpha = a;
    const hh = T.def ? T.def.h : 40;
    if (T.sub) drawPop3D(ctx, T.sub, W / 2, cy + Math.round(hh / 2) + 14, { t: t + 0.4, pop: clamp01((t - 0.55) * 2.4), alpha: a, palette: 'white', size: 12, depth: 2, wobble: 0.3, sparkle: false, glow: false });
    if (T.first) drawPop3D(ctx, 'NEW OCEAN!', W / 2, cy - Math.round(hh / 2) - 18, { t: t + 0.2, pop: clamp01((t - 0.3) * 2.2), alpha: a, palette: 'gold', size: 16, depth: 3, wobble: 0.6, glow: false });
    ctx.restore();
  }
}

// ---------------------------------------------------------------- helpers
function waveY(x, t, amp) {
  return (Math.sin(x * 0.035 - t * 2.4) * 1.1 + Math.sin(x * 0.012 + t * 1.3) * 1.6) * amp;
}

// a 32 px wide vertical gradient tile with ordered dithering between posterised levels
const TILE_W = 32;
function gradTile(tile, h, colAt, levels) {
  h = Math.max(1, Math.round(h));
  if (!tile || tile.height !== h) { tile = makeCanvas(TILE_W, h); tile._id = ctxOf(tile).createImageData(TILE_W, h); }
  const id = tile._id, d = id.data;
  const cols = [];
  for (let i = 0; i < levels; i++) cols.push(colAt(i / (levels - 1), [0, 0, 0]));
  for (let y = 0; y < h; y++) {
    const tt = (y / Math.max(1, h - 1)) * (levels - 1), i0 = Math.floor(tt), f = tt - i0;
    for (let x = 0; x < TILE_W; x++) {
      const c = cols[Math.min(levels - 1, bayer(x, y) < f ? i0 + 1 : i0)];
      const p = (y * TILE_W + x) * 4;
      d[p] = c[0]; d[p + 1] = c[1]; d[p + 2] = c[2]; d[p + 3] = 255;
    }
  }
  ctxOf(tile).putImageData(id, 0, 0);
  return tile;
}

// a tiling caustic net: bright cell edges of a jittered grid, fading with depth
let CAUST = null;
function caustTile() {
  if (CAUST) return CAUST;
  const w = 96, h = 26, c = makeCanvas(w, h), g = ctxOf(c), id = g.createImageData(w, h), d = id.data;
  const pts = [];
  for (let j = -1; j <= 3; j++) for (let i = -1; i <= 8; i++) pts.push([((i + 8) % 8) * 12 + hash2(i & 7, j, 5) * 10, j * 9 + hash2(i & 7, j, 9) * 7]);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let a = 1e9, b = 1e9;
    for (const [px, py] of pts) for (const ox of [-w, 0, w]) { const dd = Math.hypot(x - px - ox, y - py); if (dd < a) { b = a; a = dd; } else if (dd < b) b = dd; }
    const edge = b - a;
    const fade = 1 - y / h;
    if (edge < 1.3 && bayer(x, y) < fade * 0.95) { const i = (y * w + x) * 4; d[i] = 255; d[i + 1] = 255; d[i + 2] = 236; d[i + 3] = 255; }
  }
  g.putImageData(id, 0, 0);
  CAUST = c;
  return c;
}

// a copy of a postcard with a dithered fade along one edge
function maskEdge(src, side, W, H) {
  const c = makeCanvas(W, H), g = ctxOf(c);
  g.drawImage(src, 0, 0);
  const R = Math.min(160, Math.round(W * 0.16));
  const x0 = side === 'right' ? W - R : 0;
  const id = g.getImageData(x0, 0, R, H), d = id.data;
  for (let y = 0; y < H; y++) for (let x = 0; x < R; x++) {
    const k = side === 'right' ? (x + 0.5) / R : 1 - (x + 0.5) / R; // 0 keep .. 1 gone
    const kk = smoothstep(0, 1, k);
    if (bayer(x0 + x, y) < kk) d[(y * R + x) * 4 + 3] = 0;
  }
  g.putImageData(id, x0, 0);
  return c;
}

// the colours of a postcard: sky (top, middle, near the horizon) and water (surface, deep)
function samplePal(src, hz, W, H) {
  try {
    const n = 48;
    const c = makeCanvas(1, n), g = c.getContext('2d', { willReadFrequently: true });
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    g.drawImage(src, Math.round(W * 0.1), 0, Math.round(W * 0.8), H, 0, 0, 1, n);
    const d = g.getImageData(0, 0, 1, n).data;
    const at = (y) => { const i = clamp(Math.round((y / H) * n), 0, n - 1) * 4; return [d[i], d[i + 1], d[i + 2]]; };
    const top = at(hz * 0.04), mid = at(hz * 0.4), low = mixRGB(at(hz * 0.7), mid, 0.3);
    const s0 = at(hz + 10), s1 = at(Math.min(H - 2, hz + (H - hz) * 0.9));
    return { sky: [top, mid, low], sea: [s0, s1] };
  } catch { return null; }
}

// fjord aurora: two wavy dithered ribbons near the top of the sky
function drawAurora(c, W, hz, t, w) {
  for (const [y0, col, ph, th] of [[hz * 0.16, '#5affb0', 0, 10], [hz * 0.24, '#7ad8ff', 2, 7]]) {
    c.fillStyle = col;
    for (let x = 0; x < W; x += 2) {
      const y = Math.round(y0 + Math.sin(x * 0.012 + t * 0.6 + ph) * 12 + Math.sin(x * 0.031 - t * 0.9) * 4);
      const hgt = Math.round(th + Math.sin(x * 0.02 + t + ph) * 3);
      for (let i = 0; i < hgt; i++) {
        const k = i / hgt;
        if (bayer(x >> 1, y + i) > (1 - k) * 0.75 * w) continue;
        c.globalAlpha = 0.28 * w;
        c.fillRect(x, y + i, 2, 1);
      }
    }
  }
  c.globalAlpha = 1;
}
