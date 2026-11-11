// [lab14] THE LAB's backdrop: an UNDERWATER VOXEL SCENE, like looking into the sea (OWNER: Lab agent). Used behind the
// research tree and the Rods / Boats tabs. Everything solid is a real voxel model rendered with src/gfx/voxel.js:
// the coral reefs come from the world's reef kit (src/world/coral.js), the far pinnacles / mesa / arch / kelp columns
// from src/world/farvox.js, the relics from the prop library (src/gfx/props.js, getPropSteps); the dune heightfields,
// the seabed slab, the swaying kelp, the clouds and the little distant fish are modelled here.
//
// Depth, back to front (each layer has its own parallax and is pulled toward the water's haze colour by depth):
//   water gradient (bright aqua under the surface -> deep blue); Boats: a strip of sky with voxel clouds on top
//   far2  : faint blue silhouettes (pinnacles, a mesa, an arch) on rock hills    far fish schools
//   far1  : a coral garden on sand dunes (reefs, corals, kelp columns)           mid kelp (sways), mid fish school
//   mid   : reef bommies, a sunken boat, rocks on dunes
//   floor : the near seabed slab (sand ripples, pebbles, shells, starfish)      + animated caustics on the sand
//   props : big detailed reefs at the edges, the anchor, the open chest, a clam  near kelp + sea grass (sway)
//   bubbles rising from the chest / clam / helmet, a readability veil per kind (the tree: a dim, cool middle band,
//   brighter edges), then the rippling underside of the surface along the top (Boats: the water line).
// No light rays / god rays / spotlights, no ring effects.
//
// Every static layer is built ONCE per view size (a step generator run ~7 ms per frame; layers fade in as they
// finish; sprites are cached across sizes) at the hi-res factor into an offscreen canvas with a `.hi` twin
// (src/gfx/hires.js), so a frame is a few big drawImage calls plus small animated bits.
//   drawLabRoom(ctx, v, t, cam, kind)   v = view rect, cam = {x, y, z} (pan in screen px, zoom delta) for parallax
//                                       (omitted: a slow idle drift), kind 'tree' | 'rods' | 'boats'
//   labRoomScene(v, kind) -> {wl}       Boats: the water line (view-relative) the boats float on
import { VoxelModel, renderVoxels } from '../gfx/voxel.js';
import { THEMES, reefFormationSteps, coralModel, voxAnim } from '../world/coral.js';
import { renderSteps } from '../world/slabrender.js';
import { spire, mesa, rockArch, kelpColumn, render as farRender } from '../world/farvox.js';
import { getPropSteps } from '../gfx/props.js';
import { makeCanvas, ctxOf } from '../core/canvas.js';
import { HI } from '../gfx/hires.js';
import { mix, shade, hexToRgb } from '../core/color.js';
import { RNG } from '../core/rng.js';
import { clamp, hash1, hash2, fbm2, TAU } from '../core/math.js';
import { microBubble } from './labtiles.js';

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const BUDGET = 7; // ms of scene building per frame

// ------------------------------------------------------------------ palette (Frutiger Aero aqua)
const WATER = [[0, '#8ff0ff'], [0.1, '#55d8f6'], [0.32, '#2cb2e6'], [0.58, '#1a8cd2'], [0.8, '#136cb8'], [1, '#0d4f98']];
const ROCK = ['#5a6a92', '#6c7ea2', '#4c5a80', '#7e8eae', '#5e6e8c'];
const CROWN = { cols: ['#ff7aa0', '#ffa45a', '#ffe070', '#7ae08a', '#b48aff', '#5ae0e0'], density: 0.55, blobs: 14, ledge: 0.16, branch: true };
const CORAL_R = { scale: 1, outline: true, jitter: 0.06, ao: 1.3, edges: 0.7, sideEdges: 0.4, light: { top: 4.8, lit: 3.4, dark: 2.1, bottom: 1 }, yaw: 0, pitch: 24 };

function waterAt(k) {
  for (let i = 1; i < WATER.length; i++) {
    if (k <= WATER[i][0]) { const [a, ca] = WATER[i - 1], [b, cb] = WATER[i]; return mix(ca, cb, (k - a) / (b - a)); }
  }
  return WATER[WATER.length - 1][1];
}

// ------------------------------------------------------------------ canvases: authored at HI, logical twin
function twin(hc) {
  if (hc.width % HI || hc.height % HI) { // pad to whole logical px so the twin draws 1:1 (no resampling)
    const p = makeCanvas(Math.ceil(hc.width / HI) * HI, Math.ceil(hc.height / HI) * HI);
    ctxOf(p).drawImage(hc, 0, 0);
    hc = p;
  }
  const c = makeCanvas(hc.width / HI, hc.height / HI);
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
  g.drawImage(hc, 0, 0, c.width, c.height);
  Object.defineProperty(c, 'hi', { value: hc, configurable: true });
  return c;
}
function layer(wL, hL) {
  wL = Math.max(1, Math.round(wL)); hL = Math.max(1, Math.round(hL));
  const c = makeCanvas(wL * HI, hL * HI);
  return { c, g: ctxOf(c), wL, hL };
}
// a sprite {canvas, ox, oy} at logical (x, y) = its ground anchor; k = device px per sprite px
function put(L, s, x, y, k = 1) {
  if (!s?.canvas) return;
  L.g.drawImage(s.canvas, Math.round(x * HI - s.ox * k), Math.round(y * HI - s.oy * k), s.canvas.width * k, s.canvas.height * k);
}
// pull a layer toward the haze colour: fog alpha aTop at the top -> aBot at the bottom (only where it has pixels)
function fog(L, col, aTop, aBot, y0 = 0, y1 = L.hL) {
  const g = L.g, [r, gg, b] = hexToRgb(col);
  g.save();
  g.globalCompositeOperation = 'source-atop';
  const gr = g.createLinearGradient(0, y0 * HI, 0, y1 * HI);
  gr.addColorStop(0, `rgba(${r},${gg},${b},${aTop})`); gr.addColorStop(1, `rgba(${r},${gg},${b},${aBot})`);
  g.fillStyle = gr; g.fillRect(0, 0, L.c.width, L.c.height);
  g.restore();
}
function tintCanvas(src, col, a) {
  const c = makeCanvas(src.width, src.height), g = ctxOf(c);
  g.drawImage(src, 0, 0);
  g.globalCompositeOperation = 'source-atop';
  const [r, gg, b] = hexToRgb(col);
  g.fillStyle = `rgba(${r},${gg},${b},${a})`; g.fillRect(0, 0, c.width, c.height);
  return c;
}
function flipCanvas(src) {
  const c = makeCanvas(src.width, src.height), g = ctxOf(c);
  g.translate(src.width, 0); g.scale(-1, 1); g.drawImage(src, 0, 0);
  return c;
}
const flipS = (s) => ({ canvas: flipCanvas(s.canvas), ox: s.canvas.width - s.ox, oy: s.oy });
// a sprite as a logical-size canvas with a `.hi` twin, scaled by k device px per sprite px (nearest)
function spriteTwin(src, k) {
  if (k === 1) return twin(src);
  const hc = makeCanvas(src.width * k, src.height * k), g = ctxOf(hc);
  g.drawImage(src, 0, 0, hc.width, hc.height);
  return twin(hc);
}

// ------------------------------------------------------------------ sprite cache (size independent)
const SPR = new Map();
function* cachedSteps(key, make) {
  let s = SPR.get(key);
  if (s) return s;
  s = yield* make();
  SPR.set(key, s);
  if (SPR.size > 120) SPR.delete(SPR.keys().next().value);
  return s;
}
const spr = (r) => ({ canvas: r.canvas, ox: r.ox, oy: r.oy });

function* reefSteps(seed, o) {
  return yield* cachedSteps('reef|' + seed + '|' + JSON.stringify(o), function* () {
    const m = yield* reefFormationSteps(seed, THEMES.shallows, o);
    return spr(yield* renderSteps(m, CORAL_R));
  });
}
function* coralSteps(kind, seed, size) {
  return yield* cachedSteps('coral|' + kind + '|' + seed + '|' + size, function* () {
    const m = coralModel(kind, seed, THEMES.shallows, size);
    yield;
    return spr(yield* renderSteps(m, CORAL_R));
  });
}
function* propSteps(id, scale, o = {}) {
  return yield* cachedSteps('prop|' + id + '|' + scale + '|' + JSON.stringify(o), function* () {
    try { return spr(yield* getPropSteps(id, { scale, yaw: 0, pitch: 24, ...o })); } catch { return null; }
  });
}
function* farSteps(key, make) {
  return yield* cachedSteps('far|' + key, function* () { yield; return make(); });
}

// ------------------------------------------------------------------ hand-made models
// Tall kelp: a wavy stipe with alternating ruffled blades and golden floats; ph sways it (a bend that grows upward).
function kelpModel(seed, H, ph) {
  const r = new RNG(seed);
  const nx = 72, nz = 16;
  const m = new VoxelModel(nx, H + 8, nz);
  const C = (c, o = {}) => m.color(c, { jitter: 0.08, ...o });
  const stipe = C('#2a8048'), stipeL = C('#4aa858');
  const blade = [C('#2a9a50'), C('#44c062'), C('#86ea6e'), C('#d8ffa0', { light: 0.4 })];
  const float = C('#e8c84a', { spec: 0.8 }), floatL = C('#fff2a0', { light: 0.5 });
  const lean = r.float(-0.06, 0.06), w0 = r.float(0, TAU);
  const sway = (y) => { const k = y / H; return Math.sin(ph + w0 + k * 2.2) * 7 * Math.pow(k, 1.3) + Math.sin(y * 0.07 + seed) * 1.4 + lean * y; };
  const cx = nx / 2, cz = nz / 2;
  for (let y = 0; y < H; y++) {
    const x = cx + sway(y), th = y < H * 0.35 ? 1.2 : 0.7;
    for (let dx = -th; dx <= th; dx += 0.7) m.set(Math.round(x + dx), y, cz, (y + Math.round(dx)) % 9 === 0 ? stipeL : stipe);
  }
  let side = r.chance(0.5) ? 1 : -1;
  for (let y = 6 + r.int(0, 4); y < H - 4; y += r.int(6, 9)) {
    side = -side;
    const x0 = cx + sway(y), L = r.int(12, 20) * (0.75 + 0.35 * Math.sin((y / H) * Math.PI)), a = side * r.float(0.7, 1.05);
    const z0 = cz + r.int(-3, 3);
    let bx = x0, by = y;
    for (let k = 0; k < L; k++) {
      const t = k / L;
      const ang = a * (1 - t * 0.55) + Math.sin(ph * 1.3 + y * 0.05 + t * 2) * 0.25 * t;
      bx += Math.sin(ang) * 0.95; by += Math.cos(ang) * 0.75 + 0.2;
      const wd = 3.3 * Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.15 + 0.04)), 0.7);
      for (let q = -wd; q <= wd; q += 0.5) {
        // the blade's width runs perpendicular to its axis (x/y plane), ruffled in z
        const px = bx + Math.cos(ang) * q, py = by - Math.sin(ang) * q * 0.6;
        const edge = Math.abs(q) > wd - 0.8, rib = Math.abs(q) < 0.5;
        const col = rib ? blade[0] : edge ? (t > 0.6 ? blade[3] : blade[2]) : t > 0.75 ? blade[2] : blade[1];
        m.set(Math.round(px), Math.round(py), Math.round(z0 + Math.sin(q * 1.3 + k * 0.4) * 1.2), col);
      }
    }
    // the float at the blade's base
    const fx = x0 + side * 1.6, fy = y + 1;
    m.ellipsoid(fx, fy, cz, 1.6, 1.9, 1.6, float);
    m.set(Math.round(fx - 0.5), Math.round(fy + 1), cz + 1, floatL);
  }
  return m;
}
const KELP_R = { scale: 1, yaw: 0, pitch: 12, outline: true, groundAO: false, jitter: 0.06, ao: 1, edges: 0.6 };
function* kelpSteps(seed, H, n = 12) {
  return yield* cachedSteps('kelp|' + seed + '|' + H + '|' + n, function* () {
    const fr = [];
    for (let f = 0; f < n; f++) {
      const m = kelpModel(seed, H, (f / n) * TAU);
      const r = renderVoxels(m, KELP_R);
      const [ax, ay] = r.project(m.nx / 2, 0, m.nz / 2);
      fr.push({ canvas: r.canvas, ox: Math.round(ax), oy: Math.round(ay) });
      yield;
    }
    return boxFrames(fr);
  });
}
// align animation frames on a shared box (anchor = base point)
function boxFrames(fr) {
  const minX = Math.min(...fr.map((q) => -q.ox)), minY = Math.min(...fr.map((q) => -q.oy));
  const maxX = Math.max(...fr.map((q) => q.canvas.width - q.ox)), maxY = Math.max(...fr.map((q) => q.canvas.height - q.oy));
  const frames = fr.map((q) => {
    const c = makeCanvas(maxX - minX, maxY - minY);
    ctxOf(c).drawImage(q.canvas, -minX - q.ox, -minY - q.oy);
    return c;
  });
  return { frames, ox: -minX, oy: -minY };
}

// A soft cumulus puff (white tops, pale aqua undersides).
function* cloudSteps(i) {
  return yield* cachedSteps('cloud|' + i, function* () {
    const r = new RNG(900 + i);
    const W = 70 + r.int(0, 30), m = new VoxelModel(W + 8, 30, 16);
    const wht = m.color('#ffffff', { jitter: 0.02, smooth: 0.8 }), sh = m.color('#d4f4ff', { jitter: 0.02, smooth: 0.8 });
    const n = r.int(4, 6);
    for (let k = 0; k < n; k++) {
      const cx = 6 + ((k + 0.5) / n) * W, rr = (W / n) * r.float(0.7, 1.05) * (1 - Math.abs(k - (n - 1) / 2) / n * 0.6);
      m.ellipsoid(cx, rr * 0.65 + 2, 8, rr, rr * 0.75, 6, (x, y) => (y < 5 ? sh : wht));
    }
    m.box(4, 1, 4, W + 2, 3, 11, sh);
    yield;
    const rv = renderVoxels(m, { scale: 1, yaw: 0, pitch: 14, outline: false, groundAO: false, jitter: 0.02 });
    return { canvas: rv.canvas, ox: rv.ox, oy: rv.oy };
  });
}

// A little distant fish (side view), two tail frames.
function fishModel(f, body, belly) {
  const m = new VoxelModel(16, 8, 6);
  const B = m.color(body, { spec: 0.7, jitter: 0.04 }), L = m.color(belly, { jitter: 0.04 }), D = m.color(shade(body, -0.28)), E = m.color('#081428');
  m.ellipsoid(9, 3.6, 3, 5.6, 2.6, 2, (x, y) => (y < 3 ? L : B));
  m.box(7, 6, 3, 9, 6, 3, D); // dorsal fin
  const tw = f ? 1 : 2;
  m.box(2, 3.6 - tw, 3, 3, 3.6 + tw, 3, D); m.box(1, 3.6 - tw - 1, 3, 1, 3.6 - tw, 3, D); m.box(1, 3.6 + tw, 3, 1, 3.6 + tw + 1, 3, D);
  m.set(12, 4, 4, E);
  return m;
}
function* fishSteps(kind) {
  return yield* cachedSteps('fish|' + kind, function* () {
    const [body, belly] = kind === 1 ? ['#ffd24a', '#fff2b0'] : kind === 2 ? ['#ff8a5a', '#ffe0c8'] : ['#9fdcff', '#e8fbff'];
    const fr = [0, 1].map((f) => { const r = renderVoxels(fishModel(f, body, belly), { scale: 1, yaw: 0, pitch: 10, outline: true, groundAO: false }); return r.canvas; });
    yield;
    return fr;
  });
}

// The near seabed: a wide slab of rippled sand with pebbles, shells, starfish, rubble and sea-grass tufts.
function* floorSteps(nx, nz, seed) {
  return yield* cachedSteps('floor|' + nx + '|' + nz + '|' + seed, function* () {
    const ny = 16;
    const m = new VoxelModel(nx, ny, nz);
    const C = (c, o = {}) => m.color(c, { jitter: 0.07, ...o });
    const sand = [C('#d2ae7c'), C('#e6c896'), C('#f4deb0'), C('#fdecc8'), C('#fff8e4', { light: 0.3 })];
    const wet = C('#c09a68'), peb = [C('#8a92b0'), C('#a4aec8'), C('#6e7898')], shellC = [C('#ffd0dc', { spec: 0.6 }), C('#ffffff', { spec: 0.8 }), C('#ffb48a', { spec: 0.6 })];
    const star = C('#ff7a3a'), starL = C('#ffb066'), grass = [C('#2e8a3e'), C('#58b84a'), C('#9ae070')], rubble = [C('#ff9ab4'), C('#ffd0a0'), C('#c8a0ff')];
    const r = new RNG(seed);
    const hAt = new Float32Array(nx * nz);
    for (let z = 0; z < nz; z++) {
      for (let x = 0; x < nx; x++) {
        const dune = fbm2(x * 0.012, z * 0.02, 3, seed) * 6;
        const rv = Math.sin(z * 0.42 + x * 0.035 + fbm2(x * 0.02, z * 0.03, 2, seed + 4) * 6);
        const rip = rv > 0.62 ? 1 : rv < -0.8 ? -1 : 0;
        const h = 4 + dune;
        hAt[x + z * nx] = h;
        const top = Math.floor(h);
        for (let y = 0; y <= top; y++) {
          const d = top - y;
          let c;
          if (d === 0) {
            const n = hash2(x, z, seed + 1);
            c = rip > 0 ? sand[3] : rip < 0 ? sand[1] : n > 0.95 ? sand[4] : n < 0.04 ? sand[1] : sand[2];
            if (!rip && fbm2(x * 0.04, z * 0.07, 2, seed + 9) < 0.28) c = n > 0.5 ? sand[1] : sand[2];
          } else c = d < 2 ? sand[1] : d < 4 ? sand[0] : wet;
          m.set(x, y, z, c);
        }
      }
      if ((z & 15) === 15) yield;
    }
    const ground = (x, z) => Math.floor(hAt[clamp(Math.round(x), 0, nx - 1) + clamp(Math.round(z), 0, nz - 1) * nx]) + 1;
    // pebbles
    for (let i = 0; i < nx * nz * 0.0009; i++) {
      const x = r.float(2, nx - 3), z = r.float(2, nz - 3), y = ground(x, z);
      const s = r.float(0.8, 2.4);
      m.ellipsoid(x, y - 0.3, z, s * 1.3, s * 0.8, s, r.pick(peb));
    }
    // shells (little fans) and starfish
    for (let i = 0; i < nx * nz * 0.0006; i++) {
      const x = Math.round(r.float(3, nx - 4)), z = Math.round(r.float(3, nz - 4)), y = ground(x, z), c = r.pick(shellC);
      for (let k = -2; k <= 2; k++) for (let j = 0; j <= 2 - Math.abs(k) * 0.5; j++) m.set(x + k, y + (j > 1 ? 1 : 0), z + j, c);
    }
    for (let i = 0; i < nx * nz * 0.00025; i++) {
      const x = r.float(6, nx - 7), z = r.float(5, nz - 6), y = ground(x, z), a0 = r.float(0, TAU);
      for (let a = 0; a < 5; a++) {
        const ang = a0 + (a / 5) * TAU;
        for (let k = 0; k < 4.5; k += 0.5) m.set(Math.round(x + Math.cos(ang) * k), y, Math.round(z + Math.sin(ang) * k * 0.8), k < 1.5 ? starL : star);
      }
      m.set(Math.round(x), y + 1, Math.round(z), starL);
    }
    // coral rubble and sea-grass tufts
    for (let i = 0; i < nx * nz * 0.0005; i++) {
      const x = Math.round(r.float(2, nx - 3)), z = Math.round(r.float(2, nz - 3)), y = ground(x, z);
      if (r.chance(0.35)) { const c = r.pick(rubble); m.set(x, y, z, c); m.set(x + 1, y, z, c); if (r.chance(0.5)) m.set(x, y + 1, z, c); }
      else for (let b = 0; b < 4; b++) { const bx = x + r.int(-2, 2), hh = r.int(2, 5); for (let k = 0; k < hh; k++) m.set(bx + (k > 2 ? (b % 2 ? 1 : -1) : 0), y + k, z, grass[Math.min(2, Math.floor((k / hh) * 3))]); }
    }
    yield;
    const rr = yield* renderSteps(m, { scale: 1, yaw: 0, pitch: 24, outline: false, groundAO: false, jitter: 0.04, ao: 0.9, edges: 0.35, depthLines: false });
    return { canvas: rr.canvas, ox: rr.ox, oy: rr.oy, project: rr.project, ny, nz, ground };
  });
}

// Rolling dunes / rock hills as a voxel heightfield: tall at the back (the skyline), flattening toward the front so
// things can stand on the visible top. Anchor (ox, oy) = the back-left foot (x 0, y 0, z 0); 1 sprite px per voxel.
function* hillsSteps(key, nx, nz, o) {
  return yield* cachedSteps('hills|' + key + '|' + nx + '|' + nz, function* () {
    const { seed, base, amp, cols, speck = [] } = o;
    const ny = base + amp + 4;
    const m = new VoxelModel(nx, ny, nz);
    const C = cols.map((c) => m.color(c, { jitter: 0.08 }));
    const SP = speck.map((c) => m.color(c, { jitter: 0.1 }));
    const crest = new Float32Array(nx);
    for (let x = 0; x < nx; x++) crest[x] = base + amp * clamp(fbm2(x * 0.011, 0.5, 3, seed) * 1.25 - 0.1 + Math.sin(x * 0.006 + seed) * 0.15, 0, 1);
    for (let z = 0; z < nz; z++) {
      const k = z / nz, fall = Math.pow(1 - k, 1.6);
      for (let x = 0; x < nx; x++) {
        const hh = Math.max(1, Math.round(crest[x] * fall + 2 + fbm2(x * 0.05, z * 0.08, 2, seed + 3) * 2));
        for (let y = 0; y < hh; y++) {
          const d = hh - 1 - y;
          let c = C[d === 0 ? 0 : d < 3 ? 1 : d < 7 ? 2 : 3];
          if (d === 0 && SP.length && hash2(x, z, seed + 7) < 0.012) c = SP[Math.floor(hash2(x, z, seed + 8) * SP.length)];
          m.set(x, y, z, c);
        }
      }
      if ((z & 7) === 7) yield;
    }
    const rr = yield* renderSteps(m, { scale: 1, yaw: 0, pitch: 24, outline: true, groundAO: false, jitter: 0.05, ao: 1, edges: 0.4, depthLines: false });
    const [ax, ay] = rr.project(0, 0, 0);
    return { canvas: rr.canvas, ox: Math.round(ax), oy: Math.round(ay) };
  });
}

// ------------------------------------------------------------------ procedural animated textures
// Caustic web over the sand: a periodic Voronoi edge net with drifting points (loops over n frames), squashed for
// the floor's perspective and faded toward the back. Blocky 2 device px cells.
function causticFrame(TW, TH, f, n) {
  const W = TW * HI, H = TH * HI, c = makeCanvas(W, H), g = ctxOf(c);
  const img = g.createImageData(W, H), d = img.data;
  const CX = 7, CY = Math.max(4, Math.round((H * 2.4) / (W / 7))), cw = W / CX, ch = (H * 2.4) / CY;
  const ph = (f / n) * TAU;
  const pts = [];
  for (let j = -1; j <= CY; j++) for (let i = -1; i <= CX; i++) {
    const ii = ((i % CX) + CX) % CX, h1 = hash2(ii, j, 71), h2 = hash2(ii, j, 72), h3 = hash2(ii, j, 73);
    pts.push([(i + 0.2 + h1 * 0.6) * cw + Math.cos(ph + h3 * TAU) * cw * 0.16, (j + 0.2 + h2 * 0.6) * ch + Math.sin(ph * (h3 > 0.5 ? 1 : -1) + h1 * TAU) * ch * 0.16]);
  }
  const KX = TAU / W;
  for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) {
    // a gentle domain warp (periodic in x) keeps the web organic, not tiled
    const px = x + 1 + Math.sin((y + 1) * 0.11 + ph) * 3 + Math.sin(x * KX * 2 + ph) * 2, py = (y + 1) * 2.4 + Math.sin(x * KX * 3 - ph) * 5;
    let d1 = 1e9, d2 = 1e9;
    for (const p of pts) {
      const dx = px - p[0], dy = py - p[1], q = dx * dx + dy * dy;
      if (q < d1) { d2 = d1; d1 = q; } else if (q < d2) d2 = q;
    }
    const e = Math.sqrt(d2) - Math.sqrt(d1);
    const depth = y / H; // 0 = back of the floor
    const fade = clamp(depth * 3, 0, 1) * (0.45 + 0.55 * depth);
    const v = e < 1.8 ? 1 : e < 3.6 ? 0.4 : 0;
    if (!v) continue;
    const a = Math.round(255 * v * fade);
    for (let yy = 0; yy < 2; yy++) for (let xx = 0; xx < 2; xx++) {
      const o = ((y + yy) * W + x + xx) * 4;
      d[o] = 220; d[o + 1] = 255; d[o + 2] = 250; d[o + 3] = a;
    }
  }
  g.putImageData(img, 0, 0);
  return twin(c);
}
// The underside of the water surface: a bright rippling band with a wavy lower edge (periodic, loops over n frames).
function surfaceFrame(TW, TH, f, n) {
  const W = TW * HI, H = TH * HI, c = makeCanvas(W, H), g = ctxOf(c);
  const img = g.createImageData(W, H), d = img.data;
  const ph = (f / n) * TAU, K = TAU / W;
  for (let x = 0; x < W; x += 2) {
    const edge = H * 0.36 + Math.sin(x * K * 3 + ph) * 3 + Math.sin(x * K * 7 - ph * 2) * 2 + Math.sin(x * K * 2 - ph) * 2;
    for (let y = 0; y < H; y += 2) {
      let col, a;
      const cell = Math.sin(x * K * 9 + ph + Math.sin(y * 0.2 + ph) * 1.5) + Math.sin(x * K * 5 - ph * 2 + y * 0.31) + Math.sin(x * K * 13 + ph * 3 - y * 0.12);
      if (y < edge) {
        col = cell > 1.3 ? [240, 255, 255] : cell > 0.2 ? [180, 246, 255] : [120, 222, 248];
        a = cell > 1.3 ? 0.95 : 0.7;
      } else {
        const k = (y - edge) / (H - edge);
        if (y < edge + 2) { col = [255, 255, 255]; a = 0.9; } else if (cell > 1.5 && k < 0.6) { col = [220, 252, 255]; a = 0.45 * (1 - k); } else { col = [170, 238, 255]; a = 0.32 * (1 - k) * (1 - k); }
      }
      for (let yy = 0; yy < 2; yy++) for (let xx = 0; xx < 2; xx++) {
        const o = ((y + yy) * W + x + xx) * 4;
        d[o] = col[0]; d[o + 1] = col[1]; d[o + 2] = col[2]; d[o + 3] = Math.round(255 * a);
      }
    }
  }
  g.putImageData(img, 0, 0);
  return twin(c);
}

// ------------------------------------------------------------------ the scene
const scenes = new Map();
function sceneFor(w, h, kind) {
  const boats = kind === 'boats';
  const key = w + '|' + h + '|' + (boats ? 'b' : 'u');
  let S = scenes.get(key);
  if (!S) {
    S = makeScene(w, h, boats);
    scenes.set(key, S);
    if (scenes.size > 2) scenes.delete(scenes.keys().next().value);
  }
  return S;
}

function makeScene(w, h, boats) {
  const top = boats ? Math.round(h * 0.3) : 0, U = h - top;
  const S = {
    w, h, boats, top, U,
    far2Y: top + U * 0.6, far1Y: top + U * 0.68, midY: top + U * 0.76, floorY: top + U * 0.79,
    L: {}, ready: {}, kelp: [], grass: [], fish: [], bubbles: [], caus: null, surf: null, done: false, gen: null,
  };
  S.bg = backdrop(S);
  S.veil = veils(S);
  S.gen = buildScene(S);
  return S;
}

// water gradient (and, for the Boats tab, the bright air above the surface)
function backdrop(S) {
  const { w, h, top, U } = S;
  const c = makeCanvas(w, h), g = c.getContext('2d');
  const gr = g.createLinearGradient(0, top, 0, h);
  for (let i = 0; i <= 20; i++) gr.addColorStop(i / 20, waterAt(i / 20));
  g.fillStyle = gr; g.fillRect(0, top, w, U);
  if (top > 0) {
    const sky = g.createLinearGradient(0, 0, 0, top);
    sky.addColorStop(0, '#5cc4f4'); sky.addColorStop(0.55, '#a8e8ff'); sky.addColorStop(1, '#e6fcff');
    g.fillStyle = sky; g.fillRect(0, 0, w, top);
  }
  return c;
}

// readability veils: the tree gets a cool dim band through the middle (the tiles live there); the Rods grid a
// softer overall dim; every kind a soft vignette. Edges stay brighter.
function veils(S) {
  const { w, h } = S;
  const mk = (draw) => { const c = makeCanvas(w, h); draw(c.getContext('2d')); return c; };
  return {
    tree: mk((g) => {
      const r = g.createRadialGradient(w / 2, h * 0.47, Math.min(w, h) * 0.08, w / 2, h * 0.47, Math.max(w, h) * 0.62);
      r.addColorStop(0, 'rgba(0,40,104,0.34)'); r.addColorStop(0.45, 'rgba(0,40,104,0.22)'); r.addColorStop(1, 'rgba(0,40,104,0)');
      g.fillStyle = r; g.fillRect(0, 0, w, h);
    }),
    rods: mk((g) => {
      g.fillStyle = 'rgba(0,44,110,0.3)'; g.fillRect(0, 0, w, h);
      const r = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.7);
      r.addColorStop(0, 'rgba(0,36,96,0.1)'); r.addColorStop(1, 'rgba(0,20,64,0.3)');
      g.fillStyle = r; g.fillRect(0, 0, w, h);
    }),
    boats: mk((g) => {
      const r = g.createRadialGradient(w / 2, h * 0.55, Math.min(w, h) * 0.3, w / 2, h * 0.55, Math.max(w, h) * 0.75);
      r.addColorStop(0, 'rgba(0,36,96,0)'); r.addColorStop(1, 'rgba(0,20,64,0.3)');
      g.fillStyle = r; g.fillRect(0, S.top, w, h - S.top);
    }),
  };
}

// layer paddings (logical px) = the parallax room on each side
const PAD = { sky: 26, far2: 26, far1: 40, mid: 60, floor: 96, props: 96 };
const PAR = { sky: 0.015, far2: 0.03, far1: 0.05, mid: 0.085, floor: 0.14, props: 0.14 };

function* buildScene(S) {
  const { w, h, top, U } = S;
  const r = new RNG(77);
  const hazeFar = waterAt(0.42), hazeMid = waterAt(0.5);
  // animated textures first (cheap, they make the scene feel alive while the rest builds)
  S.surf = [];
  for (let f = 0; f < 8; f++) { S.surf.push(surfaceFrame(160, 34, f, 8)); }
  yield;
  // Boats: soft voxel clouds in the strip of sky above the surface
  if (top > 0) {
    const P = PAD.far2, L = layer(w + P * 2, top);
    for (let i = 0; i < 4; i++) {
      const s = yield* cloudSteps(i);
      put(L, s, P + w * (0.06 + i * 0.22 + hash1(i, 41) * 0.05), top * (0.3 + hash1(i, 42) * 0.22), 2);
    }
    S.L.sky = { c: twin(L.c), x: -P, y: 0, P };
    S.ready.sky = -1;
  }

  // ---- far2: faint silhouettes (pinnacles, a mesa, an arch) on rolling rock hills
  {
    const P = PAD.far2, LW = w + P * 2, y0 = top + U * 0.16, base = S.far2Y - y0, L = layer(LW, base + 40);
    const hills = yield* hillsSteps('h2', Math.ceil(LW), 60, { seed: 54, base: 10, amp: 26, cols: ['#8a9cc0', '#7484aa', '#5e6c94', '#4c5a80'], speck: ROCK });
    put(L, hills, 0, base, 2);
    const items = [];
    const sp = [[0.03, 70, 9], [0.14, 110, 12], [0.27, 58, 8], [0.72, 100, 11], [0.86, 128, 13], [0.97, 64, 9], [0.45, 46, 7], [0.6, 56, 8]];
    for (let i = 0; i < sp.length; i++) {
      const [xf, hh, ww] = sp[i];
      const s = yield* farSteps('sp|' + i + '|' + hh, () => farRender(spire(400 + i, { h: hh, w: ww, d: 16, lean: hash1(i, 3) * 0.14 - 0.07, cols: ROCK, crown: CROWN }), { scale: 1.5, yaw: i % 2 ? 22 : -22 }));
      items.push([s, xf * LW, base + 8 + (i % 3) * 3]);
    }
    const ms = yield* farSteps('mesa|a', () => farRender(mesa(52, { h: 34, w: 38, d: 18, cols: ROCK, crown: CROWN }), { scale: 1.5, yaw: -16 }));
    items.push([ms, LW * 0.52, base + 10]);
    const ar = yield* farSteps('arch|a', () => farRender(rockArch(51, { span: 56, h: 72, th: 8, d: 14, cols: ROCK, crown: CROWN }), { scale: 1.5, yaw: 18 }));
    items.push([ar, LW * 0.36, base + 12]);
    items.sort((a, b) => a[2] - b[2]);
    for (const [s, x, y] of items) put(L, s, x, y);
    fog(L, hazeFar, 0.62, 0.5);
    S.L.far2 = { c: twin(L.c), x: -P, y: y0, P };
    S.ready.far2 = -1;
  }
  yield;

  // ---- far1: the coral garden on sand dunes, kelp columns
  {
    const P = PAD.far1, LW = w + P * 2, y0 = top + U * 0.3, base = S.far1Y - y0, L = layer(LW, base + 40);
    const hills = yield* hillsSteps('h1', Math.ceil(LW), 64, { seed: 55, base: 6, amp: 16, cols: ['#f2deb0', '#e2c898', '#d0b482', '#b89c6c'], speck: ['#8a92b0', '#a4aec8', '#ff9ab4'] });
    put(L, hills, 0, base, 2);
    const items = [];
    const kinds = ['staghorn', 'fan', 'brain', 'tube', 'table', 'pillar', 'fan', 'whip'];
    for (let i = 0; i < 10; i++) {
      const k = kinds[i % kinds.length];
      const s = yield* coralSteps(k, 300 + i, [9, 12, 10][i % 3]);
      items.push([s, r.float(0, LW), base + r.float(10, 22)]);
    }
    for (let i = 0; i < 4; i++) {
      const s = yield* reefSteps(330 + (i % 2), { w: 96, h: 56, d: 34, sizes: [7, 14] });
      items.push([i % 2 ? s : (S.flip330 ||= flipS(s)), LW * (0.1 + i * 0.27) + r.int(-20, 20), base + r.float(12, 20)]);
    }
    for (let i = 0; i < 9; i++) {
      const hh = r.int(46, 90);
      const s = yield* farSteps('kc|' + i + '|' + hh, () => kelpColumn(60 + i, hh, ['#3a8a4a', '#56b04c', '#8ae060'], 1));
      items.push([s, r.float(0, LW), base + r.float(8, 16)]);
    }
    items.sort((a, b) => a[2] - b[2]);
    for (const [s, x, y] of items) put(L, s, x, y);
    fog(L, hazeMid, 0.56, 0.42);
    S.L.far1 = { c: twin(L.c), x: -P, y: y0, P };
    S.ready.far1 = -1;
  }
  yield;

  // fish schools (far and mid water)
  {
    const kinds = [0, 1, 2];
    const fr = [];
    for (const k of kinds) fr.push(yield* fishSteps(k));
    const mkSchool = (k, n, depth, y, speed, dir, scale) => {
      const fogA = depth === 'far' ? 0.62 : 0.4, col = depth === 'far' ? hazeFar : hazeMid;
      const frames = fr[k].map((c) => tintCanvas(c, col, fogA));
      const pair = frames.map((c) => (dir < 0 ? flipCanvas(c) : c)).map((c) => spriteTwin(c, scale));
      const members = [];
      for (let i = 0; i < n; i++) members.push([hash1(i, 11 + k) * 46 - 23, hash1(i, 13 + k) * 18 - 9, hash1(i, 17 + k) * TAU]);
      return { frames: pair, members, y, speed, dir, depth, off: hash1(k, 5) * 1000 };
    };
    S.fish.push(mkSchool(0, 11, 'far', top + U * 0.42, 7, 1, 1));
    S.fish.push(mkSchool(1, 7, 'far', top + U * 0.3, 5, -1, 1));
    S.fish.push(mkSchool(2, 5, 'mid', top + U * 0.55, 10, 1, 2));
  }
  yield;

  // ---- mid: reef bommies, a sunken boat and rocks on sand dunes
  {
    const P = PAD.mid, LW = w + P * 2, y0 = top + U * 0.28, base = S.midY - y0, L = layer(LW, S.floorY + 40 - y0);
    const hills = yield* hillsSteps('hm', Math.ceil(LW), 80, { seed: 56, base: 5, amp: 12, cols: ['#f6e6be', '#e8d0a2', '#d6bc8a', '#c0a274'], speck: ['#8a92b0', '#a4aec8', '#ffb48a', '#ff9ab4'] });
    put(L, hills, 0, base, 2);
    const items = [];
    const reefs = [[0.15, 341], [0.5, 342], [0.85, 341]];
    for (let i = 0; i < reefs.length; i++) {
      const [xf, seed] = reefs[i];
      let s = yield* reefSteps(seed, { w: 120, h: 72, d: 44, sizes: [8, 18] });
      if (i === 2) s = S.flip341 ||= flipS(s);
      items.push([s, LW * xf + r.int(-24, 24), base + r.float(16, 24), 1]);
    }
    const boat = yield* propSteps('sunken_boat', 0.9);
    if (boat) items.push([boat, LW * 0.68, base + 24, 1]);
    for (const [id, xf, sc] of [['rock_big', 0.3, 0.8], ['rock_arch', 0.04, 0.9], ['rock_small', 0.94, 0.9], ['rock_big', 0.4, 0.6]]) {
      const s = yield* propSteps(id, sc);
      if (s) items.push([s, LW * xf, base + r.float(14, 26), 1]);
    }
    for (let i = 0; i < 6; i++) {
      const k = ['fan', 'staghorn', 'tube', 'brain', 'whip', 'table'][i];
      const s = yield* coralSteps(k, 360 + i, [12, 14, 10][i % 3]);
      items.push([s, r.float(0, LW), base + r.float(14, 28), 1]);
    }
    items.sort((a, b) => a[2] - b[2]);
    for (const [s, x, y, k] of items) put(L, s, x, y, k);
    fog(L, hazeMid, 0.4, 0.26);
    S.L.mid = { c: twin(L.c), x: -P, y: y0, P };
    S.ready.mid = -1;
  }
  yield;

  // mid kelp (fogged sway frames)
  {
    const P = PAD.far1;
    for (let i = 0; i < 6; i++) {
      const A = yield* kelpSteps(500 + (i % 3), Math.round(U * 0.5 + (i % 3) * 18));
      const frames = A.frames.map((c) => spriteTwin(tintCanvas(c, hazeMid, 0.45), 1));
      const xf = [0.05, 0.12, 0.3, 0.64, 0.86, 0.95][i];
      S.kelp.push({ frames, ox: A.ox / HI, oy: A.oy / HI, x: -P + (w + P * 2) * xf, y: S.far1Y + 2, layer: 'far1', off: i * 3 });
    }
  }
  yield;

  // ---- floor: the near seabed slab
  {
    const P = PAD.floor, LW = w + P * 2, band = h - S.floorY + 24;
    const nz = Math.ceil(band / Math.sin((24 * Math.PI) / 180)) + 4;
    const F = yield* floorSteps(Math.ceil(LW), nz, 91);
    const y0 = S.floorY - 4, L = layer(LW, h + 30 - y0);
    // the slab's back edge lands on floorY
    const [, by] = F.project(0, 7, 0); // z = 0 is the back (z runs toward the viewer)
    const sh = Math.round(S.floorY - y0 - by);
    L.g.drawImage(F.canvas, 0, sh * HI, F.canvas.width * HI, F.canvas.height * HI);
    fog(L, waterAt(0.55), 0.34, 0, 0, Math.min(L.hL, 60));
    S.L.floor = { c: twin(L.c), x: -P, y: y0, P };
    S.floorMap = { F, y0: y0 + sh, P };
    S.ready.floor = -1;
  }
  yield;

  // caustics (tile frames over the floor band)
  {
    const TH = Math.round(h + 20 - S.floorY), TW = 128, n = 12, fr = [];
    for (let f = 0; f < n; f++) { fr.push(causticFrame(TW, TH, f, n)); yield; }
    S.caus = { frames: fr, TW, TH };
  }

  // ---- props: big detailed reefs at the edges, relics, rocks (sit on the floor)
  {
    const P = PAD.props, LW = w + P * 2, y0 = top + U * 0.06, L = layer(LW, h + 30 - y0);
    const gy = (_, d) => S.floorY + (h - S.floorY) * d; // view y on the floor; d: 0 = back edge .. 1 = bottom of the view
    const items = [];
    const left = yield* reefSteps(371, { w: Math.round(clamp(w * 0.2, 120, 220)), h: 120, d: 64, rock: 0.55, sizes: [10, 26] });
    const right = yield* reefSteps(372, { w: Math.round(clamp(w * 0.18, 110, 200)), h: 110, d: 60, rock: 0.5, sizes: [10, 24] });
    items.push([left, P + w * 0.04, gy(0, 0.78), 2, 0.2]);
    items.push([S.flip372 ||= flipS(right), P + w * 0.97, gy(0, 0.72), 2, 0.3]);
    const back = yield* reefSteps(373, { w: 90, h: 60, d: 40, sizes: [7, 14] });
    items.push([back, P + w * 0.2, gy(0, 0.22), 2, 0.8]);
    items.push([S.flip373 ||= flipS(back), P + w * 0.8, gy(0, 0.18), 2, 0.85]);
    const corals = [['fan', 381, 14, 0.12, 0.5], ['staghorn', 382, 12, 0.3, 0.6], ['brain', 383, 8, 0.66, 0.7], ['tube', 384, 11, 0.86, 0.45], ['bubble', 385, 7, 0.44, 0.85], ['pillar', 386, 9, 0.56, 0.4], ['whip', 387, 10, 0.75, 0.62]];
    for (const [k, seed, size, xf, d] of corals) {
      const s = yield* coralSteps(k, seed, size);
      items.push([s, P + w * xf, gy(0, d), 2, 1 - d]);
    }
    for (const [id, xf, d, sc, o] of [['anchor', 0.33, 0.62, 0.7, {}], ['treasure_chest', 0.71, 0.66, 0.55, { frame: 1 }], ['clam_pearl', 0.53, 0.8, 0.55, {}], ['starfish_rock', 0.22, 0.86, 0.5, {}], ['rock_small', 0.62, 0.95, 0.6, {}], ['diver_helmet', 0.9, 0.9, 0.5, {}]]) {
      const s = yield* propSteps(id, sc, o);
      if (s) items.push([s, P + w * xf, gy(0, d), 2, 1 - d, id]);
    }
    items.sort((a, b) => b[4] - a[4]);
    for (const [s, x, y, k] of items) put(L, s, x, y - y0, k); // items hold view y
    S.L.props = { c: twin(L.c), x: -P, y: y0, P };
    S.ready.props = -1;
    // bubble sources: the chest, the clam, the diver's helmet
    for (const it of items) {
      if (it[5] === 'treasure_chest') S.bubbles.push({ x: it[1] - P - 4, y: it[2] - 18, n: 7, sp: 20 });
      if (it[5] === 'clam_pearl') S.bubbles.push({ x: it[1] - P, y: it[2] - 10, n: 5, sp: 16 });
      if (it[5] === 'diver_helmet') S.bubbles.push({ x: it[1] - P + 2, y: it[2] - 22, n: 6, sp: 24 });
    }
  }
  yield;

  // near kelp forests at both edges + sea grass (sway frames)
  {
    const P = PAD.props;
    const spots = [[0.015, 0.7, 0], [0.075, 0.82, 1], [0.135, 0.62, 2], [0.885, 0.66, 0], [0.945, 0.8, 1], [0.99, 0.62, 2]];
    for (let i = 0; i < spots.length; i++) {
      const [xf, d, v] = spots[i];
      const H = Math.round(U * (0.72 + v * 0.06));
      const A = yield* kelpSteps(520 + v, H);
      const frames = A.frames.map((c) => spriteTwin(c, 2));
      S.kelp.push({ frames, ox: A.ox, oy: A.oy, x: w * xf, y: S.floorY + (h - S.floorY) * d, layer: 'props', off: i * 2 + 1 });
    }
    for (let i = 0; i < 7; i++) {
      const A = voxAnim('seagrass', 40 + (i % 3), 'shallows', 9 + (i % 2) * 3, 1, 8);
      yield;
      const frames = A.frames.map((c) => spriteTwin(c, 2));
      const xf = [0.18, 0.27, 0.4, 0.47, 0.6, 0.78, 0.83][i], d = [0.5, 0.92, 0.6, 0.98, 0.72, 0.95, 0.4][i];
      S.grass.push({ frames, ox: A.ox, oy: A.oy, x: w * xf, y: S.floorY + (h - S.floorY) * d, off: i * 3, P: A.P });
    }
  }
  S.done = true;
}

function stepScene(S) {
  if (S.done || !S.gen) return;
  const t0 = now();
  do {
    const r = S.gen.next();
    if (r.done) { S.done = true; S.gen = null; break; }
  } while (now() - t0 < BUDGET);
}

// ------------------------------------------------------------------ drawing
export function drawLabRoom(ctx, v, t, cam, kind = 'tree') {
  const w = Math.round(v.w), h = Math.round(v.h);
  if (w < 8 || h < 8) return;
  const S = sceneFor(w, h, kind);
  stepScene(S);
  // parallax: pan in screen px -> softly clamped layer offsets; zoom pushes the near layers outward a touch
  const c = cam || { x: Math.sin(t * 0.07) * 260, y: Math.sin(t * 0.05) * 60, z: 0 };
  const off = (name) => {
    const P = PAD[name], f = PAR[name];
    const dx = P * 0.92 * Math.tanh((-(c.x || 0) * f) / P);
    const dy = 10 * Math.tanh((-(c.y || 0) * f * 0.5) / 10) + (c.z || 0) * f * 40;
    return [dx, dy];
  };
  const x0 = v.x, y0 = v.y;
  const fade = (name) => {
    if (S.ready[name] === undefined) return 0;
    if (S.ready[name] < 0) S.ready[name] = t;
    return clamp((t - S.ready[name]) / 0.45, 0, 1);
  };
  const lay = (name) => {
    const Lr = S.L[name];
    if (!Lr) return;
    const a = fade(name);
    if (a <= 0) return;
    const [dx, dy] = off(name);
    const ga = ctx.globalAlpha;
    if (a < 1) ctx.globalAlpha = ga * a;
    ctx.drawImage(Lr.c, Math.round((x0 + Lr.x + dx) * 2) / 2, Math.round((y0 + Lr.y + dy) * 2) / 2);
    ctx.globalAlpha = ga;
  };

  ctx.drawImage(S.bg, x0, y0, w, h);
  lay('sky');
  lay('far2');
  drawFish(ctx, S, t, x0, y0, 'far', off('far2'));
  lay('far1');
  drawKelp(ctx, S, t, x0, y0, 'far1', off('far1'));
  drawFish(ctx, S, t, x0, y0, 'mid', off('far1'));
  lay('mid');
  lay('floor');
  // caustics drift over the sand
  if (S.caus && S.L.floor) {
    const { frames, TW } = S.caus, n = frames.length, q = (t * 4) % n, i0 = Math.floor(q), k = q - i0;
    const [dx, dy] = off('floor');
    const yy = Math.round((y0 + S.floorY + dy) * 2) / 2;
    const po = ctx.globalCompositeOperation, ga = ctx.globalAlpha;
    ctx.globalCompositeOperation = 'lighter';
    const fa = fade('floor');
    for (const [fi, a] of [[i0, 1 - k], [(i0 + 1) % n, k]]) {
      if (a < 0.02) continue;
      ctx.globalAlpha = ga * a * 0.28 * fa;
      for (let x = (dx % TW) - TW; x < w + TW; x += TW) ctx.drawImage(frames[fi], Math.round((x0 + x) * 2) / 2, yy);
    }
    ctx.globalCompositeOperation = po; ctx.globalAlpha = ga;
  }
  drawGrass(ctx, S, t, x0, y0, off('floor'));
  drawKelp(ctx, S, t, x0, y0, 'props', off('props'));
  lay('props');
  drawBubbles(ctx, S, t, x0, y0, off('props'));
  // readability veil
  const veil = S.veil[kind] || S.veil.tree;
  ctx.drawImage(veil, x0, y0, w, h);
  // the rippling underside of the surface (top of the water), over the veil so it stays a bright aqua-white
  if (S.surf) {
    const fr = S.surf[Math.floor(t * 5) % S.surf.length], TW = 160, sx = ((t * 6) % TW + TW) % TW;
    const [dx] = off('far2');
    const yy = y0 + S.top - (S.top ? 4 : 2);
    const ga = ctx.globalAlpha;
    ctx.globalAlpha = ga * (kind === 'boats' ? 1 : 0.8);
    for (let x = -TW - sx + (dx % TW); x < w + TW; x += TW) ctx.drawImage(fr, Math.round((x0 + x) * 2) / 2, yy);
    ctx.globalAlpha = ga;
  }
}

function drawKelp(ctx, S, t, x0, y0, layerName, [dx, dy]) {
  for (const k of S.kelp) {
    if (k.layer !== layerName) continue;
    const n = k.frames.length, f = k.frames[Math.floor(t * 3 + k.off) % n];
    ctx.drawImage(f, Math.round((x0 + k.x + dx - k.ox) * 2) / 2, Math.round((y0 + k.y + dy - k.oy) * 2) / 2);
  }
}

function drawGrass(ctx, S, t, x0, y0, [dx, dy]) {
  for (const g of S.grass) {
    const n = g.frames.length, f = g.frames[Math.floor((t / g.P) * n + g.off) % n];
    ctx.drawImage(f, Math.round((x0 + g.x + dx - g.ox) * 2) / 2, Math.round((y0 + g.y + dy - g.oy) * 2) / 2);
  }
}

function drawFish(ctx, S, t, x0, y0, depth, [dx, dy]) {
  for (const sc of S.fish) {
    if (sc.depth !== depth) continue;
    const span = S.w + 140;
    const cx = ((sc.off + t * sc.speed * sc.dir) % span + span) % span - 70;
    const cy = sc.y + Math.sin(t * 0.3 + sc.off) * 8;
    for (let i = 0; i < sc.members.length; i++) {
      const [ox, oy, ph] = sc.members[i];
      const fx = cx + ox + Math.sin(t * 0.9 + ph) * 3, fy = cy + oy + Math.sin(t * 1.3 + ph * 1.7) * 2;
      const f = sc.frames[Math.floor(t * 5 + ph * 3) & 1];
      ctx.drawImage(f, Math.round((x0 + fx + dx) * 2) / 2, Math.round((y0 + fy + dy) * 2) / 2);
    }
  }
}

function drawBubbles(ctx, S, t, x0, y0, [dx, dy]) {
  if (!S.ready.props) return;
  const ga = ctx.globalAlpha;
  for (let s = 0; s < S.bubbles.length; s++) {
    const B = S.bubbles[s];
    for (let i = 0; i < B.n; i++) {
      const q = (t * (B.sp / 140) + i / B.n + hash1(s, 3)) % 1;
      const yy = B.y - q * 140;
      if (yy < S.top + 8) continue;
      const xx = B.x + Math.sin(t * 2.2 + i * 1.7 + s) * (1 + q * 3);
      ctx.globalAlpha = ga * (q < 0.1 ? q * 10 : q > 0.8 ? (1 - q) * 5 : 1) * 0.85;
      ctx.drawImage(microBubble(Math.min(2, 1 + ((i + s) % 3) * 0.5 + (q > 0.5 ? 0.5 : 0))), Math.round((x0 + xx + dx) * 2) / 2, Math.round((y0 + yy + dy) * 2) / 2);
    }
  }
  ctx.globalAlpha = ga;
}

// Where the Boats tab floats its boats: on the water surface (view-relative y)
export function labRoomScene(v, kind) { return { wl: kind === 'boats' ? Math.round(v.h * 0.3) : 0 }; }

