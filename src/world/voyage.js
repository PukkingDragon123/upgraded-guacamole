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
import { pxFrames } from '../gfx/pxsprites.js';
import { buildText3D } from '../gfx/text3d.js';
import { drawPop3D } from '../ui/pop3d.js';
import { drawAeroGlow, drawSparkle } from '../ui/aero.js';
import * as Character from '../gfx/character.js';
import * as BM from './boatmodels.js';
import { cloudSprites } from './sky.js';
import { MAP_LOCATIONS } from '../ui/mappanel.js';

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
function islandSprite(kind, seed) {
  const key = kind + seed;
  if (ISLANDS.has(key)) return ISLANDS.get(key);
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
function* buildClouds() {
  const dims = [[34, 14, 14, 1], [46, 16, 16, 2], [28, 12, 12, 3], [52, 18, 16, 4], [38, 15, 14, 5]];
  for (const [w, h, d, seed] of dims) {
    if (CLOUDS.length >= dims.length) return;
    try { CLOUDS.push(cloudSprites(seed * 31 + 7, w, h, d, 1)); } catch (e) { console.warn('voyage cloud', e); CLOUDS.push(null); }
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
      C: 0, Cv: 0, B: 0, Bv: 0, X: 0, Xs: W * 0.3, hz: Math.round(H * 0.66), u: 0,
      orig: null, dest: null, capWait: 0, capPending: null,
      palO: lookPal(fromK, night), palD: lookPal(toK, night), pal: null, palDGot: false,
      clouds: [], islands: [], gulls: [], wake: [], bubbles: [], spray: [], fx: [], nextIsl: 0, nextCloud: 0, nextFar: 0,
      jobs: null, titleDef: null, flood: null, sfx: {}, total: D.depart + D.sea + D.arrive + 0.4,
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
    // 1) puppet boat sprites (facing right, every roll) at 1x
    try {
      const b = g.boat;
      if (b?.model) {
        const M = b.model();
        for (let ri = 0; ri < 7; ri++) { const k = b.modelKey + ':1:' + ri + ':1'; if (!b.sprites.has(k)) { b.sprites.set(k, b.buildSprite(M, 1, ri, 1)); yield; } }
      }
    } catch (e) { console.warn('voyage boat', e); }
    // 2) clouds and the islands of both oceans
    yield* buildClouds();
    for (const k of [s.fromK, s.toK]) for (let i = 0; i < 2; i++) { islandSprite(k, i); yield; }
    // 3) the destination biome
    if (s.gen) {
      for (;;) { let r; try { r = s.gen.next(); } catch (e) { console.error(e); r = { done: true }; } if (r.done) break; yield 'build'; }
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
      while (performance.now() - t0 < budget) { const r = s.jobs.next(); if (r.done) { s.jobs = null; break; } }
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
    s.u = Math.max(s.u, 0.85 * smoothstep(0, s.D.sea, s.pt));
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
    const acc = om * om * (T - s.C) - 2 * om * s.Cv;
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
    s.Ca = s.C; s.Va = Math.max(s.Cv, s.Bv * 0.6); s.Ba = s.B; s.VBa = s.Bv;
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
    this.title = { t: 0, def: s.titleDef, name: (s.target.name || '').toUpperCase(), sub: s.target.subtitle || '', first: s.first, to: s.to, played: false };
  }

  // ------------------------------------------------------------ particles of the sea scene (screen space)
  updParts(s, dt) {
    const g = this.game, W = g.screen.W, H = g.screen.H;
    if (s.phase !== 'sea' && s.phase !== 'arrive') return;
    const hz = s.hz, bx = s.X, sp = s.Bv;
    // wake foam on the surface (sea space) + bubbles under the stern + spray off the bow
    s.wakeT = (s.wakeT || 0) - dt;
    if (sp > 40 && s.wakeT <= 0) {
      s.wakeT = 0.02;
      s.wake.push({ x: s.B - 34 + Math.random() * 6, t: 0, life: 0.9 + Math.random() * 0.6, w: 2 + Math.round(Math.random() * 4) });
      if (Math.random() < 0.7) s.bubbles.push({ x: s.B - 30 + Math.random() * 10, y: hz + 4 + Math.random() * 14, vy: -6 - Math.random() * 10, t: 0, life: 0.8 + Math.random() * 0.9, r: Math.random() < 0.3 ? 2 : 1 });
      if (Math.random() < clamp01(sp / 700) * 0.9) s.spray.push({ x: bx + 34 + Math.random() * 4, y: hz - 2, vx: 30 + Math.random() * 60, vy: -60 - Math.random() * sp * 0.18, t: 0, life: 0.5 + Math.random() * 0.3 });
    }
    for (const p of s.wake) p.t += dt;
    for (const p of s.bubbles) { p.t += dt; p.y = Math.max(hz + 2, p.y + p.vy * dt); }
    for (const p of s.spray) { p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 420 * dt; }
    s.wake = s.wake.filter((p) => p.t < p.life);
    s.bubbles = s.bubbles.filter((p) => p.t < p.life);
    s.spray = s.spray.filter((p) => p.t < p.life && p.y < hz + 4);
    // weather of both oceans, weighted by the voyage progress
    const wO = 1 - s.u, wD = s.u;
    for (const [kind, w] of [[s.fromK, wO], [s.toK, wD]]) {
      const fx = LOOK[kind]?.fx;
      if (!fx || w < 0.05) continue;
      const rate = { snow: 70, embers: 40, neon: 60, specks: 26, drizzle: 70, bubbles: 7, glints: 22 }[fx] || 0;
      let n = rate * w * dt;
      while (n > 0) {
        if (Math.random() < n) this.spawnFx(s, fx, W, H);
        n -= 1;
      }
    }
    for (const p of s.fx) { p.t += dt; p.x += (p.vx - s.Cv * p.par) * dt; p.y += p.vy * dt; if (p.kind === 'bubbles') p.vx += Math.sin(p.t * 3 + p.ph) * 4 * dt; }
    s.fx = s.fx.filter((p) => p.t < p.life && p.x > -20 && p.x < W + 40 && p.y < H + 10 && p.y > -10);
    // gulls fly along (not over the deep, dark sea)
    const gullW = (s.fromK === 'abyss' || s.fromK === 'city' ? 0 : wO) + (s.toK === 'abyss' || s.toK === 'city' ? 0 : wD);
    s.gullT = (s.gullT || 0.2) - dt;
    if (s.gullT <= 0 && s.gulls.length < 4 && gullW > 0.3) {
      s.gullT = 0.7 + Math.random() * 1.2;
      s.gulls.push({ x: -20 - Math.random() * 40, y: hz - 60 - Math.random() * (hz * 0.45), vx: 40 + Math.random() * 70, ph: Math.random() * TAU, fl: 6 + Math.random() * 3, t: 0 });
    }
    for (const q of s.gulls) { q.t += dt; q.x += q.vx * dt; q.y += Math.sin(q.t * 1.3 + q.ph) * 6 * dt; }
    s.gulls = s.gulls.filter((q) => q.x < W + 30);
  }

  spawnFx(s, fx, W, H) {
    const hz = s.hz, r = Math.random;
    const P = (o) => s.fx.push({ t: 0, ph: r() * TAU, par: 0, ...o, kind: fx });
    if (fx === 'snow') P({ x: r() * (W + 120), y: -4, vx: -30 - r() * 30, vy: 40 + r() * 40, life: 6, c: r() < 0.3 ? '#cfeeff' : '#ffffff', sz: r() < 0.25 ? 2 : 1, par: 0.25 });
    else if (fx === 'embers') P({ x: r() * (W + 160), y: hz - r() * 30, vx: -10 + r() * 20, vy: -30 - r() * 50, life: 2.5 + r() * 2, c: r() < 0.5 ? '#ffb43c' : '#ff6a2a', sz: r() < 0.2 ? 2 : 1, par: 0.35, flick: 1 });
    else if (fx === 'neon') P({ x: r() * (W + 200), y: -6, vx: -60, vy: 320 + r() * 120, life: 2, c: r() < 0.5 ? '#ff7ae0' : '#5affea', sz: 1, len: 4, par: 0.2 });
    else if (fx === 'drizzle') P({ x: r() * (W + 200), y: -6, vx: -80, vy: 360 + r() * 100, life: 2, c: '#7a8aaa', sz: 1, len: 5, par: 0.2 });
    else if (fx === 'specks') P({ x: r() * (W + 100), y: hz + 6 + r() * (H - hz - 10), vx: 0, vy: -4 - r() * 6, life: 1.6 + r(), c: r() < 0.5 ? '#7affb0' : '#c8ff6a', sz: 1, par: 0.8, flick: 1 });
    else if (fx === 'bubbles') P({ x: r() * (W + 100), y: hz - 4, vx: 6, vy: -18 - r() * 18, life: 5, c: '#ffffff', sz: 2 + Math.floor(r() * 3), par: 0.15, bubble: 1 });
    else if (fx === 'glints') P({ x: r() * (W + 100), y: hz + 2 + r() * 8, vx: 0, vy: 0, life: 0.5 + r() * 0.4, c: '#ffffff', sz: 1, par: 1, glint: 1 });
  }

  // ------------------------------------------------------------ drawing
  // Main canvas, after the world: grabs the postcards and draws the sea scene over everything while away.
  drawOver(ctx, dt) {
    const s = this.s;
    if (!s) return;
    const g = this.game, W = g.screen.W, H = g.screen.H;
    if (s.capPending === 'origin') {
      s.capPending = null;
      this.grabOrigin(s, ctx);
    } else if (s.capPending === 'dest') {
      if (--s.capWait <= 0) { s.capPending = null; this.grabDest(s, ctx); }
    }
    if (s.phase === 'depart') return;
    if (s.phase === 'settle') {
      // the arrival postcard dissolves into the live scene
      const a = 1 - smoothstep(0, 0.4, s.pt);
      if (s.dest && a > 0.01) {
        // the live boat is under the postcard: the puppet rides on top of it until the dissolve is done
        const L = this.ensureLayer(W, H), lc = L.getContext('2d');
        lc.setTransform(1, 0, 0, 1, 0, 0);
        lc.globalAlpha = 1;
        lc.clearRect(0, 0, W, H);
        lc.drawImage(s.dest.canvas, 0, 0, W, H);
        this.drawPuppet(lc, s, s.hz);
        ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = a; ctx.drawImage(L, 0, 0); ctx.restore();
      }
      return;
    }
    const L = this.ensureLayer(W, H);
    this.drawScene(L.getContext('2d'), s, W, H);
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
    s.hz = hz;
    const sampled = samplePal(c, hz, W, H);
    if (sampled) { s.palO = sampled; s.pal = copyPal(sampled); }
    // the boat's screen spot becomes the puppet's start
    const [z, ox] = g.camera.xform();
    s.X = boat ? boat.x * z + ox : W * 0.7;
    s.C = 0; s.Cv = 0; s.B = s.X; s.Bv = Math.max(60, s.v1 || 300);
    s.roll = 0;
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

  drawScene(c, s, W, H) {
    const g = this.game, t = s.t;
    // palette: origin -> destination (the destination target eases toward its sampled colours once grabbed)
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) s.palD.sky[i][j] = damp(s.palD.sky[i][j], s.palDT.sky[i][j], 3, 1 / 60);
    for (let i = 0; i < 2; i++) for (let j = 0; j < 3; j++) s.palD.sea[i][j] = damp(s.palD.sea[i][j], s.palDT.sea[i][j], 3, 1 / 60);
    const u = s.u;
    for (let i = 0; i < 3; i++) mixRGB(s.palO.sky[i], s.palD.sky[i], u, s.pal.sky[i]);
    for (let i = 0; i < 2; i++) mixRGB(s.palO.sea[i], s.palD.sea[i], u, s.pal.sea[i]);
    // horizon: the origin's, then the destination's
    s.hzF ??= s.hz;
    if (s.dest) {
      s.hzF = damp(s.hzF, s.hzD, 4, 1 / 60);
      if (s.phase === 'arrive' && s.pt / s.D.arrive > 0.6) s.hzF = s.hzD;
    }
    s.hz = Math.round(s.hzF);
    const hz = s.hz;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalAlpha = 1;
    c.globalCompositeOperation = 'source-over';
    this.drawSky(c, s, W, hz);
    this.drawSun(c, s, W, hz);
    const aw = this.kindW(s, 'ice');
    if (aw > 0.05) {
      if (!this.aur || this.aur.width !== W || (s.aurT = (s.aurT || 0) + 1) % 4 === 0 || Math.abs((this.aurW || 0) - aw) > 0.08) {
        if (!this.aur || this.aur.width !== W || this.aur.height !== hz) this.aur = makeCanvas(W, Math.max(1, hz));
        const ac = ctxOf(this.aur); ac.clearRect(0, 0, W, hz); drawAurora(ac, W, hz, t, aw); this.aurW = aw;
      }
      c.drawImage(this.aur, 0, 0);
    }
    this.drawClouds(c, s, W, hz, 0);
    this.drawIslands(c, s, W, hz);
    this.drawClouds(c, s, W, hz, 1);
    this.drawSea(c, s, W, H, hz);
    // the origin postcard leaves to the left (water at the water's speed, sky slower) and fades
    if (s.orig) {
      const fo = 1 - smoothstep(s.D.sea * 0.35, s.D.sea * 0.95, s.phase === 'sea' ? s.pt : 99);
      if (fo > 0.01) {
        const o = s.orig;
        c.globalAlpha = fo;
        c.save(); c.beginPath(); c.rect(0, 0, W, hz); c.clip();
        c.drawImage(o.masked, Math.round(-s.C * 0.42), hz - o.hz);
        c.restore();
        c.save(); c.beginPath(); c.rect(0, hz, W, H - hz); c.clip();
        c.drawImage(o.masked, Math.round(-s.C), hz - o.hz);
        c.restore();
        c.globalAlpha = 1;
      }
    }
    // the destination postcard glides in; its landmarks rise over the horizon
    if (s.dest && s.phase === 'arrive') {
      const d = s.dest, e = clamp01(s.pt / s.D.arrive);
      const rem = Math.max(0, s.Cend - s.C);
      const a = smoothstep(0, 0.4, e);
      const rise = Math.round(Math.pow(1 - e, 1.6) * Math.min(90, hz * 0.3));
      c.globalAlpha = a;
      c.save(); c.beginPath(); c.rect(0, 0, W, hz); c.clip();
      c.drawImage(d.masked, Math.round(rem * 0.42), hz - d.hz + rise);
      c.restore();
      c.save(); c.beginPath(); c.rect(0, hz, W, H - hz); c.clip();
      c.drawImage(d.masked, Math.round(rem), hz - d.hz);
      c.restore();
      c.globalAlpha = 1;
    }
    this.drawWake(c, s, hz);
    this.drawPuppet(c, s, hz);
    this.drawFx(c, s, W, H, hz);
    this.drawGulls(c, s, t);
  }

  kindW(s, kind) { return (s.fromK === kind ? 1 - s.u : 0) + (s.toK === kind ? s.u : 0); }

  // sky / water: posterised gradients with ordered dithering, rendered into a 32 px tile and repeated
  drawSky(c, s, W, hz) {
    const [a, b, d] = s.pal.sky;
    this.tileSky = gradTile(this.tileSky, hz, (k, out) => (k < 0.6 ? mixRGB(a, b, k / 0.6, out) : mixRGB(b, d, (k - 0.6) / 0.4, out)), 18);
    c.fillStyle = c.createPattern(this.tileSky, 'repeat-x');
    c.fillRect(0, 0, W, hz);
  }

  drawSun(c, s, W, hz) {
    const day = (1 - s.night);
    const sunA = ((LOOK[s.fromK]?.sun ?? 1) * (1 - s.u) + (LOOK[s.toK]?.sun ?? 1) * s.u) * day;
    const x = Math.round(W * 0.8 - s.C * 0.01), y = Math.round(hz * 0.26);
    if (sunA > 0.04) {
      const lava = this.kindW(s, 'volcano');
      c.globalAlpha = clamp01(sunA);
      c.drawImage(glowDisc(11, lava > 0.5 ? '#ffb070' : '#fff2b0', '#ffffff'), x - 33, y - 33);
      c.globalAlpha = 1;
    }
    const moonA = clamp01(1 - sunA * 1.6) * 0.9;
    if (moonA > 0.04) {
      c.globalAlpha = moonA;
      c.drawImage(glowDisc(8, '#cfe0ff', '#ffffff'), Math.round(W * 0.22) - 24, Math.round(hz * 0.2) - 24);
      c.globalAlpha = 1;
    }
  }

  drawClouds(c, s, W, hz, layer) {
    const par = layer ? 0.16 : 0.07;
    // spawn ahead of the camera (from the right) so nothing pops in
    const key = layer ? 'nextCloud' : 'nextFar';
    const span = W + 160;
    const edge = s.C * par + span;
    if (s[key] < edge - span * 1.2) s[key] = edge - span * 1.2 + Math.random() * 60;
    while (s[key] < edge) {
      const i = Math.floor(Math.random() * 5), set = cloudSet(i);
      if (!set) { s[key] = edge; break; }
      const pick = Math.random() < s.u ? s.toK : s.fromK;
      const pal = LOOK[pick]?.cloud || 'day';
      s.clouds.push({ x: s[key], y: Math.round(hz * (layer ? lerp(0.12, 0.62, Math.random()) : lerp(0.08, 0.45, Math.random()))), set, pal: s.night > 0.6 && pal === 'day' ? 'night' : pal, layer, sc: layer ? 2 : 1 });
      s[key] += (layer ? 220 : 160) + Math.random() * (layer ? 260 : 200);
    }
    for (const cl of s.clouds) {
      if (cl.layer !== layer) continue;
      const spr = cl.set[cl.pal] || cl.set.day;
      if (!spr) continue;
      const x = Math.round(cl.x - s.C * par);
      if (x > W + 10 || x + spr.width * cl.sc < -10) continue;
      c.globalAlpha = layer ? 0.95 : 0.75;
      c.drawImage(spr, x, cl.y, spr.width * cl.sc, spr.height * cl.sc);
    }
    c.globalAlpha = 1;
    s.clouds = s.clouds.filter((cl) => cl.x - s.C * (cl.layer ? 0.16 : 0.07) + 140 > -40);
  }

  drawIslands(c, s, W, hz) {
    const par = 0.24;
    const edge = s.C * par + W + 60;
    if (s.nextIsl === 0) s.nextIsl = edge - 40;
    while (s.nextIsl < edge) {
      const kind = Math.random() < s.u ? s.toK : s.fromK;
      const spr = islandSprite(kind, Math.floor(Math.random() * 2));
      if (spr) s.islands.push({ x: s.nextIsl, spr, kind, sc: 1 + Math.round(Math.random()) });
      s.nextIsl += 240 + Math.random() * 300;
    }
    const haze = s.pal.sky[2];
    for (const is of s.islands) {
      const sc = is.sc, x = Math.round(is.x - s.C * par), sp = is.spr;
      if (x > W + 10 || x + sp.w * sc < -10) continue;
      const y = hz + 2;
      c.drawImage(sp.canvas, x, y - sp.oy * sc, sp.w * sc, sp.h * sc);
      if (sp.glow) { c.globalCompositeOperation = 'lighter'; c.globalAlpha = 0.5; c.drawImage(sp.glow, x, y - sp.oy * sc, sp.w * sc, sp.h * sc); c.globalCompositeOperation = 'source-over'; c.globalAlpha = 1; }
      // atmospheric haze toward the horizon colour (dithered rows, lighter at the base)
      c.fillStyle = css(haze, 0.35);
      c.fillRect(x, y - sp.oy * sc, sp.w * sc, sp.h * sc);
    }
    s.islands = s.islands.filter((is) => is.x - s.C * par + is.spr.w * is.sc > -40);
  }

  drawSea(c, s, W, H, hz) {
    const [top, deep] = s.pal.sea, t = s.t;
    this.tileSea = gradTile(this.tileSea, H - hz, (k, out) => mixRGB(top, deep, Math.pow(k, 0.8), out), 16);
    c.save();
    c.translate(0, hz);
    c.fillStyle = c.createPattern(this.tileSea, 'repeat-x');
    c.fillRect(0, 0, W, H - hz);
    c.restore();
    // a lighter band just under the surface
    c.fillStyle = css(mixRGB(top, [255, 255, 255], 0.25), 0.5);
    c.fillRect(0, hz + 1, W, 3);
    // wavy surface line moving with the water + foam crests
    const amp = 1.4 * ((LOOK[s.fromK]?.wave ?? 1) * (1 - s.u) + (LOOK[s.toK]?.wave ?? 1) * s.u);
    const skyLow = s.pal.sky[2];
    c.fillStyle = css(skyLow);
    for (let x = 0; x < W; x += 2) {
      const wy = Math.round(waveY(x + s.C, t, amp));
      if (wy < 0) c.fillRect(x, hz + wy, 2, -wy);
    }
    c.fillStyle = css(mixRGB(top, [255, 255, 255], 0.55));
    for (let x = 0; x < W; x += 2) {
      const wy = Math.round(waveY(x + s.C, t, amp));
      c.fillRect(x, hz + wy, 2, 1);
    }
    // perspective-free highlight dashes drifting under the surface (faster nearer the surface: they ride the swell)
    c.fillStyle = 'rgba(255,255,255,0.22)';
    for (let i = 0; i < 46; i++) {
      const row = hz + 6 + ((i * 37) % Math.max(10, (H - hz) - 12));
      const k = (row - hz) / Math.max(1, H - hz);
      const sp = 1 - k * 0.55;
      const len = 3 + (i % 4) * 3;
      const x = (((i * 173 - s.C * sp) % (W + 40)) + W + 40) % (W + 40) - 20;
      c.globalAlpha = 0.9 - k * 0.7;
      c.fillRect(Math.round(x), row, len, 1);
    }
    c.globalAlpha = 1;
    // dappled light right under the surface (pixel wiggles)
    c.fillStyle = 'rgba(255,255,240,0.18)';
    for (let i = 0; i < 26; i++) {
      const x = (((i * 211 - s.C) % (W + 30)) + W + 30) % (W + 30) - 15;
      const y = hz + 8 + (i % 5) * 6 + Math.round(Math.sin(t * 2 + i) * 1.5);
      c.fillRect(Math.round(x), y, 4 + (i % 3) * 2, 1);
      c.fillRect(Math.round(x) + 2, y + 1, 2, 1);
    }
  }

  drawWake(c, s, hz) {
    const t = s.t, amp = 1.4;
    c.fillStyle = '#ffffff';
    for (const p of s.wake) {
      const k = p.t / p.life, x = Math.round(p.x - s.C - p.t * 26);
      c.globalAlpha = (1 - k) * 0.85;
      c.fillRect(x, hz + Math.round(waveY(p.x, t, amp)) - (k < 0.3 ? 1 : 0), Math.max(1, Math.round(p.w * (1 - k * 0.5))), 1);
    }
    for (const p of s.bubbles) {
      const k = p.t / p.life, x = Math.round(p.x - s.C);
      c.globalAlpha = (1 - k) * 0.7;
      if (p.r > 1) { c.fillRect(x, Math.round(p.y) - 1, 2, 1); c.fillRect(x - 1, Math.round(p.y), 1, 2); c.fillRect(x + 2, Math.round(p.y), 1, 2); c.fillRect(x, Math.round(p.y) + 2, 2, 1); }
      else c.fillRect(x, Math.round(p.y), 1, 1);
    }
    const drop = pxFrames('drop', 'aqua', 0);
    for (const p of s.spray) {
      const k = p.t / p.life;
      c.globalAlpha = 1 - k * 0.6;
      const f = drop[Math.min(drop.length - 1, Math.floor(k * drop.length))];
      if (f) c.drawImage(f, Math.round(p.x - f.width / 2), Math.round(p.y - f.height / 2));
    }
    c.globalAlpha = 1;
  }

  // the boat with the player on deck (the real Boat's sprites, drawn at the puppet's spot)
  drawPuppet(c, s, hz) {
    const g = this.game, boat = g.boat;
    if (!boat?.model) return;
    const t = s.t;
    const bx = Math.round(s.X);
    const amp = 1.4;
    const half = 30;
    const yl = waveY(s.B - half, t, amp), ym = waveY(s.B, t, amp), yr = waveY(s.B + half, t, amp);
    const by = Math.round(hz + (yl + ym * 2 + yr) / 4);
    const slope = (yr - yl) / (half * 2);
    const accel = s.phase === 'arrive' ? -0.8 : 0.25;
    const roll = clamp(-Math.atan(slope) * 57.3 * 1.2 - clamp(s.Bv / 900, 0, 1) * 2.5 * accel - Math.sin(t * 2.1) * 0.8, -8, 8);
    s.roll = damp(s.roll || 0, roll, 8, 1 / 60);
    let ri = 3, bd = 1e9;
    [-8, -5.3, -2.7, 0, 2.7, 5.3, 8].forEach((r, i) => { const d = Math.abs(r - s.roll); if (d < bd) { bd = d; ri = i; } });
    try { boat.model(); } catch { return; }
    const M = boat.M;
    let spr = boat.sprites.get(boat.modelKey + ':1:' + ri + ':1');
    if (!spr) for (let d = 1; d < 7 && !spr; d++) spr = boat.sprites.get(boat.modelKey + ':1:' + (ri - d) + ':1') || boat.sprites.get(boat.modelKey + ':1:' + (ri + d) + ':1');
    if (!spr) { try { spr = boat.buildSprite(M, 1, 3, 1); boat.sprites.set(boat.modelKey + ':1:3:1', spr); } catch { return; } }
    const A = spr.A, pad = 40;
    const w = spr.canvas.width + pad * 2, h = spr.canvas.height + pad * 2;
    if (!this.pl || this.pl.width < w || this.pl.height < h) this.pl = makeCanvas(w + 20, h + 20);
    const lc = ctxOf(this.pl);
    lc.setTransform(1, 0, 0, 1, 0, 0);
    lc.globalCompositeOperation = 'source-over';
    lc.globalAlpha = 1;
    lc.clearRect(0, 0, this.pl.width, this.pl.height);
    lc.drawImage(spr.canvas, pad, pad);
    const sx = spr.px + pad + Math.round(A.stand[0]), sy = spr.py + pad + Math.round(A.stand[1]);
    const pose = s.phase === 'arrive' && clamp01(s.pt / s.D.arrive) > 0.55 ? 'wave' : 'idle';
    try { Character.drawCharacter(lc, sx, sy, { pose, t, facing: 1, look: g.state.character, scale: 0.62, id: 'boat', shadow: true }); } catch { /* character optional */ }
    if (spr.front) lc.drawImage(spr.front, pad, pad);
    // the hull below the waterline takes the water's colour
    const ox = bx - (spr.px + pad), oy = by - (spr.py + pad);
    lc.globalCompositeOperation = 'source-atop';
    lc.fillStyle = css(s.pal.sea[0]);
    for (const [al, dy] of [[0.45, 1], [0.25, 7]]) {
      lc.globalAlpha = al;
      for (let x = 0; x < w; x += 2) {
        const yy = Math.round(hz + waveY(s.B + (ox + x - bx), t, amp) - oy + dy);
        if (yy < h) lc.fillRect(x, Math.max(0, yy), 2, h - Math.max(0, yy));
      }
    }
    lc.globalCompositeOperation = 'source-over';
    lc.globalAlpha = 1;
    c.drawImage(this.pl, 0, 0, w, h, ox, oy, w, h);
    // flag + boat extras (turbines, jets) through the real boat's helpers
    const vx0 = boat.vx, dir0 = boat.dir;
    boat.vx = s.Bv * 0.4; boat.dir = 1;
    try { if (A.flag) boat.drawFlag(c, bx + A.flag[0], by + A.flag[1]); } catch { /* ignore */ }
    try { BM.drawBoatAnim?.(c, M?.T, A, bx, by, t, 1, 2); } catch { /* ignore */ }
    boat.vx = vx0; boat.dir = dir0;
    // bow wave + stern foam on the waterline
    c.fillStyle = '#f4fffc';
    const sp = s.Bv;
    for (const [ex, side] of [[A.stern[0], -1], [A.bow[0], 1]]) {
      const n = 2 + Math.round(Math.min(7, sp / 60));
      for (let i = 0; i < n; i++) {
        const fx = Math.round(bx + ex + side * (i * 2 + ((t * 9 + i) % 2)));
        const k = hash2(i, Math.floor(t * 10), side + 3);
        if (k < 0.3) continue;
        c.globalAlpha = 0.95 - i * 0.1;
        c.fillRect(fx, Math.round(hz + waveY(s.B + (fx - bx), t, amp)) - (k > 0.75 ? 1 : 0), 2, 1);
      }
    }
    c.globalAlpha = 1;
  }

  drawFx(c, s, W, H, hz) {
    const t = s.t;
    for (const p of s.fx) {
      const k = p.t / p.life;
      let a = Math.min(1, p.t * 4, (1 - k) * 3);
      if (p.flick) a *= 0.6 + 0.4 * Math.sin(p.t * 20 + p.ph);
      if (p.glint) a = Math.sin(k * Math.PI);
      c.globalAlpha = clamp01(a);
      c.fillStyle = p.c;
      const x = Math.round(p.x), y = Math.round(p.y);
      if (p.len) c.fillRect(x, y, 1, p.len);
      else if (p.bubble) {
        const r = p.sz;
        c.fillStyle = 'rgba(255,255,255,0.8)';
        c.fillRect(x - r + 1, y - r, r * 2 - 1, 1); c.fillRect(x - r + 1, y + r, r * 2 - 1, 1); c.fillRect(x - r, y - r + 1, 1, r * 2 - 1); c.fillRect(x + r, y - r + 1, 1, r * 2 - 1);
        c.fillStyle = '#ffffff'; c.fillRect(x - r + 2, y - r + 2, 1, 1);
      } else if (p.glint) { c.fillRect(x - 1, y, 3, 1); c.fillRect(x, y - 1, 1, 3); }
      else c.fillRect(x, y, p.sz, p.sz);
    }
    c.globalAlpha = 1;
    void t; void W; void H; void hz;
  }

  drawGulls(c, s, t) {
    const F = gullFrames();
    for (const q of s.gulls) {
      const f = F[Math.floor((q.t * q.fl + q.ph) % 3)];
      c.drawImage(f, Math.round(q.x), Math.round(q.y));
    }
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

  // a little glass chart card in the lower letterbox: every ocean as a dot, the dotted route, the boat on it
  drawChart(ctx, s, W, H, a) {
    const bars = Math.round(H * 0.11 * (this.game.camera?.bars ?? 1));
    if (bars < 20) return;
    const L = MAP_LOCATIONS;
    const at = (id) => { const l = L.find((q) => q.id === id); return l ? l.sea : null; };
    let A = at(s.from), B = s.kind === 'ocean' ? at(s.to) : null;
    if (!A) A = [0, 50];
    if (!B) B = s.to === 'lab' ? [A[0] - 22, A[1] - 26] : [A[0] + 20, A[1] + 28];
    const cw = Math.min(300, Math.round(W * 0.3)), ch = Math.max(24, bars - 14);
    const x0 = Math.round(W / 2 - cw / 2), y0 = H - bars + Math.round((bars - ch) / 2);
    ctx.save();
    ctx.globalAlpha = a;
    // card: frosted glass with a glossy top and a bright rim
    ctx.fillStyle = 'rgba(8,40,78,0.55)';
    ctx.fillRect(x0, y0, cw, ch);
    ctx.fillStyle = 'rgba(160,230,255,0.16)';
    ctx.fillRect(x0 + 1, y0 + 1, cw - 2, Math.round(ch * 0.42));
    ctx.fillStyle = 'rgba(210,248,255,0.85)';
    ctx.fillRect(x0, y0, cw, 1); ctx.fillRect(x0, y0 + ch - 1, cw, 1); ctx.fillRect(x0, y0, 1, ch); ctx.fillRect(x0 + cw - 1, y0, 1, ch);
    // map space -> card
    const xs = L.map((l) => l.sea[0]).concat([A[0], B[0]]), ys = L.map((l) => l.sea[1]).concat([A[1], B[1]]);
    const mnx = Math.min(...xs) - 6, mxx = Math.max(...xs) + 6, mny = Math.min(...ys) - 6, mxy = Math.max(...ys) + 6;
    const ix = x0 + 34, iw = cw - 46, iy = y0 + 5, ih = ch - 10;
    const P = (p) => [ix + ((p[0] - mnx) / (mxx - mnx)) * iw, iy + ((p[1] - mny) / (mxy - mny)) * ih];
    // compass rose (left)
    const cx = x0 + 17, cy = y0 + Math.round(ch / 2), t = s.t;
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.fillRect(cx - 9, cy, 19, 1); ctx.fillRect(cx, cy - 9, 1, 19);
    const ang = -0.6 + Math.sin(t * 2.3) * 0.12 + Math.sin(t * 5.1) * 0.04;
    for (let i = -7; i <= 7; i++) {
      const px = Math.round(cx + Math.cos(ang) * i), py = Math.round(cy + Math.sin(ang) * i);
      ctx.fillStyle = i > 0 ? '#ff6a5a' : '#ffffff';
      ctx.fillRect(px, py, 1, 1);
    }
    ctx.fillStyle = '#ffe27a'; ctx.fillRect(cx, cy, 1, 1);
    // other oceans: faint dots
    for (const l of L) {
      if (l.id === s.from || l.id === s.to) continue;
      const [px, py] = P(l.sea);
      ctx.fillStyle = 'rgba(200,236,255,0.45)';
      ctx.fillRect(Math.round(px) - 1, Math.round(py) - 1, 2, 2);
    }
    // the route: a gentle arc of dots, the travelled part bright
    const [ax, ay] = P(A), [bx2, by2] = P(B);
    const mx = (ax + bx2) / 2 + (by2 - ay) * 0.25, my = (ay + by2) / 2 - (bx2 - ax) * 0.25;
    const q = (k) => [(1 - k) * (1 - k) * ax + 2 * (1 - k) * k * mx + k * k * bx2, (1 - k) * (1 - k) * ay + 2 * (1 - k) * k * my + k * k * by2];
    const prog = s.phase === 'depart' ? 0.08 * (s.pt / s.D.depart) : s.phase === 'sea' ? lerp(0.08, 0.85, clamp01(s.pt / s.D.sea)) : lerp(0.85, 1, clamp01(s.pt / s.D.arrive));
    for (let i = 0; i <= 24; i++) {
      const k = i / 24, [px, py] = q(k);
      const done = k <= prog;
      if (!done && i % 2) continue;
      ctx.fillStyle = done ? '#ffffff' : 'rgba(255,255,255,0.5)';
      ctx.fillRect(Math.round(px), Math.round(py), done ? 2 : 1, done ? 1 : 1);
    }
    const dot = (p, col, big) => {
      const x = Math.round(p[0]), y = Math.round(p[1]), r = big ? 3 : 2;
      ctx.fillStyle = '#06203a'; ctx.fillRect(x - r - 1, y - r, r * 2 + 2, r * 2); ctx.fillRect(x - r, y - r - 1, r * 2, r * 2 + 2);
      ctx.fillStyle = col; ctx.fillRect(x - r, y - r, r * 2, r * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.fillRect(x - r + 1, y - r + 1, 1, 1);
    };
    const colOf = (id) => L.find((l) => l.id === id)?.color || (id === 'lab' ? '#7affc8' : '#ffb43c');
    dot([ax, ay], colOf(s.from), false);
    dot([bx2, by2], colOf(s.to), true);
    // destination flag
    ctx.fillStyle = '#ffffff'; ctx.fillRect(Math.round(bx2) + 2, Math.round(by2) - 9, 1, 7);
    ctx.fillStyle = colOf(s.to);
    const wv = Math.round(Math.sin(t * 6));
    ctx.fillRect(Math.round(bx2) + 3, Math.round(by2) - 9 + wv * 0, 4, 2); ctx.fillRect(Math.round(bx2) + 3, Math.round(by2) - 7, 3 + (wv > 0 ? 1 : 0), 1);
    // the boat on the route: a tiny hull + sail, bobbing
    const [px, py] = q(prog);
    const bxx = Math.round(px), byy = Math.round(py + Math.sin(t * 5) * 0.8);
    ctx.fillStyle = '#06203a'; ctx.fillRect(bxx - 4, byy - 1, 9, 4);
    ctx.fillStyle = '#ff7a5a'; ctx.fillRect(bxx - 3, byy, 7, 2);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(bxx, byy - 5, 1, 5); ctx.fillRect(bxx + 1, byy - 4, 2, 3);
    // skip hint: a small fast-forward glyph, right of the card
    if (s.skippable && !s.skipped && s.phase !== 'arrive') {
      const sx = x0 + cw + 12, sy = cy - 3;
      ctx.globalAlpha = a * (0.55 + 0.25 * Math.sin(t * 3));
      ctx.fillStyle = '#ffffff';
      for (const ox2 of [0, 6]) for (let i = 0; i < 4; i++) ctx.fillRect(sx + ox2 + i, sy + i, 1, 7 - i * 2);
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
    const cy = Math.round(H * 0.24);
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
    if (T.sub) drawPop3D(ctx, T.sub, W / 2, cy + Math.round(hh / 2) + 16, { t: t + 0.4, pop: clamp01((t - 0.55) * 2.4), alpha: a, palette: 'white', size: 12, depth: 2, wobble: 0.3, sparkle: false, glow: false });
    if (T.first) drawPop3D(ctx, 'NEW OCEAN!', W / 2, cy - Math.round(hh / 2) - 16, { t: t + 0.2, pop: clamp01((t - 0.3) * 2.2), alpha: a, palette: 'gold', size: 12, depth: 3, wobble: 0.6, glow: false });
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
