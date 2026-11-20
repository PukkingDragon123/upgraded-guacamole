// [lab18] THE LAB's backdrop: an UNDERWATER VOXEL SCENE, like looking into a sunny reef (OWNER: Lab agent). Used
// behind the research tree and the Rods / Boats tabs. Everything solid is a real voxel model rendered with
// src/gfx/voxel.js: the coral reefs come from the world's reef kit (src/world/coral.js, with a low-growing species mix:
// no sea whips / pillar corals), the far pinnacles / mesa / arch from src/world/farvox.js, the relics from the prop
// library (src/gfx/props.js, getPropSteps); the dune heightfields, the seabed slab, the clouds and the little fish are
// modelled here. There are NO kelp stalks or other tall, tree-like plants: the space is filled with low reef life
// (bommies, sea fans, barrel sponges, brain / bubble corals, swaying anemones, short sea-grass tufts).
//
// Depth, back to front (each layer has its own parallax and is pulled toward the water's haze colour by depth):
//   water gradient (bright aqua under the surface -> deep blue); Boats: a strip of sky with voxel clouds
//   far3  : the faintest reef ridge on the horizon
//   far2  : faint blue silhouettes (pinnacles, a mesa, an arch) on rock hills    far fish schools
//   far1  : a coral garden on sand dunes (bommies, fans, sponges, rocks)          a sea turtle gliding by, mid fish
//   mid   : reef bommies, a sunken boat, rocks, tube worms on dunes               swaying anemones (hazed)
//   floor : the near seabed slab (sand ripples, pebbles, shells, starfish, urchins, sand dollars) + caustics + grass
//   props : big reef walls at both edges, sea fans, the anchor, the open chest, a clam, the diver's helmet, swaying
//           anemones, a little crab scuttling about
//   bubbles rising from the chest / clam / helmet and from the sand, drifting marine snow, a readability veil per
//   kind (the tree: a darker, calmer middle band, brighter edges), then the rippling underside of the surface along
//   the top (Boats: the water line the boats float on).
// No light rays / god rays / spotlights, no expanding ring effects, no text pop-ups.
//
// Every static layer is built ONCE per view size (a step generator run ~7 ms per frame; layers fade in as they
// finish; sprites are cached across sizes) at the hi-res factor into an offscreen canvas with a `.hi` twin
// (src/gfx/hires.js), so a frame is a few big drawImage calls plus small animated bits (no per-frame allocations).
//   drawLabRoom(ctx, v, t, cam, kind)   v = view rect, cam = {x, y, z} (pan in screen px, zoom delta) for parallax
//                                       (omitted: a slow idle drift), kind 'tree' | 'rods' | 'boats'
//   labRoomScene(v, kind) -> {wl}       Boats: the water line (view-relative) the boats float on
//   drawBoatFloat(ctx, x, y, hw, t, o)  Boats: the pixel water ripple / highlight under a floating boat
import { VoxelModel, renderVoxels } from '../gfx/voxel.js';
import { THEMES, reefFormationSteps, coralModel, voxAnimSteps, voxCrab } from '../world/coral.js';
import { renderSteps } from '../world/slabrender.js';
import { spire, mesa, rockArch, render as farRender } from '../world/farvox.js';
import { getPropSteps } from '../gfx/props.js';
import { makeCanvas, ctxOf } from '../core/canvas.js';
import { HI } from '../gfx/hires.js';
import { mix, shade, hexToRgb } from '../core/color.js';
import { RNG } from '../core/rng.js';
import { clamp, hash1, hash2, fbm2, TAU } from '../core/math.js';
import { microBubble } from './labtiles.js';

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const BUDGET = 7; // ms of scene building per frame
const snap = (v) => Math.round(v * 2) / 2; // to whole device px

// ------------------------------------------------------------------ palette (Frutiger Aero aqua)
const WATER = [[0, '#8ff0ff'], [0.1, '#55d8f6'], [0.32, '#2cb2e6'], [0.58, '#1a8cd2'], [0.8, '#136cb8'], [1, '#0d4f98']];
const ROCK = ['#5a6a92', '#6c7ea2', '#4c5a80', '#7e8eae', '#5e6e8c'];
const CROWN = { cols: ['#ff7aa0', '#ffa45a', '#ffe070', '#7ae08a', '#b48aff', '#5ae0e0'], density: 0.55, blobs: 14, ledge: 0.16, branch: true };
const CORAL_R = { scale: 1, outline: true, jitter: 0.06, ao: 1.3, edges: 0.7, sideEdges: 0.4, light: { top: 4.8, lit: 3.4, dark: 2.1, bottom: 1 }, yaw: 0, pitch: 24 };
// the reef kit's shallows palettes with a low-growing species mix (no sea whips / pillar corals, few table corals)
const LAB = { ...THEMES.shallows, weights: { staghorn: 4, fan: 3, brain: 3.5, tube: 3, bubble: 2.5, table: 0.5 } };
const LOW_KINDS = ['fan', 'brain', 'staghorn', 'tube', 'bubble', 'brain', 'fan', 'tube'];

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
  const g = ctxOf(c);
  g.imageSmoothingEnabled = false;
  return { c, g, wL, hL };
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
  g.imageSmoothingEnabled = false;
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
  if (SPR.size > 160) SPR.delete(SPR.keys().next().value);
  return s;
}
const spr = (r) => ({ canvas: r.canvas, ox: r.ox, oy: r.oy });

function* reefSteps(seed, o) {
  return yield* cachedSteps('reef|' + seed + '|' + JSON.stringify(o), function* () {
    const m = yield* reefFormationSteps(seed, LAB, o);
    return spr(yield* renderSteps(m, CORAL_R));
  });
}
function* coralSteps(kind, seed, size) {
  return yield* cachedSteps('coral|' + kind + '|' + seed + '|' + size, function* () {
    const m = coralModel(kind, seed, LAB, size);
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
// swaying reef life (anemones, sea grass): voxel frames over one sway cycle (the reef kit's VoxAnim)
function* animSteps(kind, seed, size, frames, pal) {
  return yield* cachedSteps('anim|' + kind + '|' + seed + '|' + size + '|' + frames + '|' + pal, function* () {
    return yield* voxAnimSteps(kind, seed, 'shallows', size, 1, frames, pal);
  });
}

// ------------------------------------------------------------------ hand-made models
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

// A little reef fish (side view), two tail frames. Kinds: 0 silver-blue, 1 yellow, 2 coral, 3 clownfish (white
// bands), 4 blue tang (yellow tail), 5 purple / gold gramma.
const FISH = [['#9fdcff', '#e8fbff'], ['#ffd24a', '#fff2b0'], ['#ff8a5a', '#ffe0c8'], ['#ff7a2a', '#ffc08a'], ['#3a7af0', '#8ac0ff'], ['#b46aff', '#ffd24a']];
function fishModel(f, kind) {
  const [body, belly] = FISH[kind];
  const m = new VoxelModel(16, 8, 6);
  const B = m.color(body, { spec: 0.7, jitter: 0.04 }), L = m.color(belly, { jitter: 0.04 }), D = m.color(shade(body, -0.28)), E = m.color('#081428');
  const W = m.color('#ffffff', { jitter: 0.02 }), T = kind === 4 ? m.color('#ffd24a') : kind === 5 ? L : D;
  m.ellipsoid(9, 3.6, 3, 5.6, 2.6, 2, (x, y) => {
    if (kind === 3 && (x === 8 || x === 11)) return W;
    if (kind === 5) return x < 8 ? L : B;
    return y < 3 ? L : B;
  });
  m.box(7, 6, 3, 9, 6, 3, D); // dorsal fin
  const tw = f ? 1 : 2;
  m.box(2, 3.6 - tw, 3, 3, 3.6 + tw, 3, T); m.box(1, 3.6 - tw - 1, 3, 1, 3.6 - tw, 3, T); m.box(1, 3.6 + tw, 3, 1, 3.6 + tw + 1, 3, T);
  m.set(12, 4, 4, E);
  return m;
}
function* fishSteps(kind) {
  return yield* cachedSteps('fish|' + kind, function* () {
    const fr = [0, 1].map((f) => renderVoxels(fishModel(f, kind), { scale: 1, yaw: 0, pitch: 10, outline: true, groundAO: false }).canvas);
    yield;
    return fr;
  });
}

// A green sea turtle (3/4 view from a little above, head to +x): domed carapace with scutes, pale plastron, spotted
// head, long front flippers that sweep up and down over one stroke (ph), little rear flippers that trail.
function turtleModel(ph) {
  const m = new VoxelModel(46, 22, 40);
  const C = (c, o = {}) => m.color(c, { jitter: 0.05, ...o });
  const sh = [C('#2e6a4a'), C('#4f8f52', { spec: 0.4 }), C('#7cba5e', { spec: 0.5 }), C('#b6dc84', { spec: 0.6 })], rim = C('#d8c27a');
  const skin = C('#6aa884'), skinD = C('#3e7a5e'), spot = C('#d4ecb8'), belly = C('#f2e2a6'), eye = C('#0a1420'), shine = C('#ffffff');
  const cx = 21, cy = 9, cz = 20, RX = 12, RZ = 9.5;
  m.ellipsoid(cx, cy - 1, cz, RX - 1, 1.6, RZ - 1, belly);
  m.ellipsoid(cx, cy, cz, RX, 5.2, RZ, (x, y, z) => {
    if (y < cy - 1) return belly;
    const d = Math.hypot((x - cx) / RX, (z - cz) / RZ);
    if (d > 0.86) return rim;
    const u = x - cx + 30, v = z - cz + 30 + ((Math.floor(u / 6) & 1) ? 3 : 0);
    if (u % 6 === 0 || v % 6 === 0) return sh[0];
    return y >= cy + 4 ? sh[3] : y >= cy + 2 ? sh[2] : sh[1];
  });
  // neck + head
  m.ellipsoid(cx + RX - 0.5, cy, cz, 3.2, 2.2, 2.6, skinD);
  m.ellipsoid(cx + RX + 3.2, cy + 0.6, cz, 3.2, 2.5, 2.6, (x, y, z) => ((x * 7 + y * 3 + z * 5) % 5 === 0 ? spot : skin));
  m.set(cx + RX + 4, cy + 1, cz + 2, eye); m.set(cx + RX + 4, cy + 2, cz + 2, shine);
  m.set(cx + RX + 4, cy + 1, cz - 2, eye);
  // flippers: flat blades rotating about the body axis
  const blade = (x0, y0, z0, side, L, wd, ang, back) => {
    const dx = -back, dy = Math.sin(ang), dz = side * Math.cos(ang), l = Math.hypot(dx, dy, dz);
    for (let k = 0; k <= L; k++) {
      const t = k / L, w = wd * (1 - t * 0.75) + 0.6;
      const px = x0 + (dx / l) * k, py = y0 + (dy / l) * k, pz = z0 + (dz / l) * k;
      for (let q = -w; q <= w; q += 0.5) m.set(Math.round(px + q * 0.9), Math.round(py), Math.round(pz), Math.abs(q) > w - 0.7 ? skinD : (k + Math.round(q)) % 4 === 0 ? spot : skin);
    }
  };
  // the stroke: mostly a downward sweep (a < 0 dips toward the sand), only a little lift above the shell line
  const a = -0.25 + Math.sin(ph) * 0.5, a2 = Math.sin(ph + 1.2) * 0.35;
  for (const side of [-1, 1]) {
    blade(cx + 6, cy, cz + side * (RZ - 2), side, 15, 2.1, a, 0.85 + Math.cos(ph) * 0.25);
    blade(cx - 8, cy - 0.5, cz + side * (RZ - 3), side, 5, 1.4, a2, 1.1);
  }
  return m;
}
function* turtleSteps(n) {
  return yield* cachedSteps('turtle|' + n, function* () {
    const fr = [];
    for (let f = 0; f < n; f++) {
      const m = turtleModel((f / n) * TAU);
      const r = renderVoxels(m, { scale: 1, yaw: -8, pitch: 34, outline: true, groundAO: false, jitter: 0.05, ao: 0.9, edges: 0.6 });
      const [ax, ay] = r.project(21, 9, 20);
      fr.push({ canvas: r.canvas, ox: Math.round(ax), oy: Math.round(ay) });
      yield;
    }
    return boxFrames(fr);
  });
}
// align animation frames on a shared box (anchor = the model's centre)
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

// The near seabed: a wide slab of rippled sand with pebbles, shells, starfish, urchins, sand dollars, coral rubble
// and short sea-grass tufts.
function* floorSteps(nx, nz, seed) {
  return yield* cachedSteps('floor|' + nx + '|' + nz + '|' + seed, function* () {
    const ny = 16;
    const m = new VoxelModel(nx, ny, nz);
    const C = (c, o = {}) => m.color(c, { jitter: 0.07, ...o });
    const sand = [C('#d2ae7c'), C('#e6c896'), C('#f4deb0'), C('#fdecc8'), C('#fff8e4', { light: 0.3 })];
    const wet = C('#c09a68'), peb = [C('#8a92b0'), C('#a4aec8'), C('#6e7898')], shellC = [C('#ffd0dc', { spec: 0.6 }), C('#ffffff', { spec: 0.8 }), C('#ffb48a', { spec: 0.6 })];
    const star = [C('#ff7a3a'), C('#ff5a8a'), C('#b07aff')], starL = C('#ffd0a0'), grass = [C('#2e8a3e'), C('#58b84a'), C('#9ae070')], rubble = [C('#ff9ab4'), C('#ffd0a0'), C('#c8a0ff')];
    const urch = C('#3a2a5a', { spec: 0.4 }), urchS = C('#6a4a9a'), urchT = C('#c8a0ff'), dollar = C('#f4ecd8'), dollarM = C('#d8c8a8');
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
    for (let i = 0; i < nx * nz * 0.001; i++) {
      const x = r.float(2, nx - 3), z = r.float(2, nz - 3), y = ground(x, z);
      const s = r.float(0.8, 2.4);
      m.ellipsoid(x, y - 0.3, z, s * 1.3, s * 0.8, s, r.pick(peb));
    }
    // shells (little fans) and starfish
    for (let i = 0; i < nx * nz * 0.0007; i++) {
      const x = Math.round(r.float(3, nx - 4)), z = Math.round(r.float(3, nz - 4)), y = ground(x, z), c = r.pick(shellC);
      for (let k = -2; k <= 2; k++) for (let j = 0; j <= 2 - Math.abs(k) * 0.5; j++) m.set(x + k, y + (j > 1 ? 1 : 0), z + j, c);
    }
    for (let i = 0; i < nx * nz * 0.0003; i++) {
      const x = r.float(6, nx - 7), z = r.float(5, nz - 6), y = ground(x, z), a0 = r.float(0, TAU), sc = r.pick(star);
      for (let a = 0; a < 5; a++) {
        const ang = a0 + (a / 5) * TAU;
        for (let k = 0; k < 4.5; k += 0.5) m.set(Math.round(x + Math.cos(ang) * k), y, Math.round(z + Math.sin(ang) * k * 0.8), k < 1.5 ? starL : sc);
      }
      m.set(Math.round(x), y + 1, Math.round(z), starL);
    }
    yield;
    // sea urchins (dark spiny balls) and sand dollars
    for (let i = 0; i < nx * nz * 0.00014; i++) {
      const x = r.float(6, nx - 7), z = r.float(5, nz - 6), y = ground(x, z);
      m.sphere(x, y + 1, z, 2.2, urch);
      for (let a = 0; a < 10; a++) {
        const ang = (a / 10) * TAU + r.float(-0.2, 0.2), up = r.float(0.1, 1);
        for (let k = 2; k < 5; k++) m.set(Math.round(x + Math.cos(ang) * k * (1 - up * 0.5)), Math.round(y + 1 + up * k), Math.round(z + Math.sin(ang) * k * 0.6), k > 3 ? urchT : urchS);
      }
    }
    for (let i = 0; i < nx * nz * 0.00016; i++) {
      const x = r.float(6, nx - 7), z = r.float(5, nz - 6), y = ground(x, z);
      for (let dz = -2; dz <= 2; dz++) for (let dx = -3; dx <= 3; dx++) if (dx * dx + dz * dz * 2.2 <= 9.5) m.set(Math.round(x + dx), y, Math.round(z + dz), (dx === 0 || Math.abs(dx) === Math.abs(dz) * 2) && dx * dx + dz * dz > 0 ? dollarM : dollar);
    }
    // coral rubble and short sea-grass tufts
    for (let i = 0; i < nx * nz * 0.0005; i++) {
      const x = Math.round(r.float(2, nx - 3)), z = Math.round(r.float(2, nz - 3)), y = ground(x, z);
      if (r.chance(0.4)) { const c = r.pick(rubble); m.set(x, y, z, c); m.set(x + 1, y, z, c); if (r.chance(0.5)) m.set(x, y + 1, z, c); }
      else for (let b = 0; b < 4; b++) { const bx = x + r.int(-2, 2), hh = r.int(2, 4); for (let k = 0; k < hh; k++) m.set(bx + (k > 2 ? (b % 2 ? 1 : -1) : 0), y + k, z, grass[Math.min(2, Math.floor((k / hh) * 3))]); }
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
    const { seed, base, amp, cols, speck = [], outline = true } = o;
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
    const rr = yield* renderSteps(m, { scale: 1, yaw: 0, pitch: 24, outline, groundAO: false, jitter: 0.05, ao: 1, edges: 0.4, depthLines: false });
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
    if (scenes.size > 3) scenes.delete(scenes.keys().next().value);
  } else if (scenes.size > 1) { scenes.delete(key); scenes.set(key, S); } // keep the most recent last
  return S;
}

function makeScene(w, h, boats) {
  const top = boats ? Math.round(h * 0.3) : 0, U = h - top;
  const S = {
    w, h, boats, top, U,
    far3Y: top + U * 0.56, far2Y: top + U * 0.6, far1Y: top + U * 0.68, midY: top + U * 0.76, floorY: top + U * 0.79,
    L: {}, ready: {}, anim: [], fish: [], bubbles: [], crab: null, caus: null, surf: null, done: false, gen: null,
  };
  S.bg = backdrop(S);
  S.veil = veils(S);
  S.motes = motes(S);
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

// readability veils: the tree gets a darker, calm band through the middle (the tiles, links and labels live there),
// the Rods grid a softer overall dim; every kind a soft vignette. The edges stay bright and lively.
function veils(S) {
  const { w, h, top } = S;
  const mk = (draw) => { const c = makeCanvas(w, h); draw(c.getContext('2d')); return c; };
  const band = (g, y0, y1, a, col) => {
    const l = g.createLinearGradient(0, y0, 0, y1);
    l.addColorStop(0, `rgba(${col},0)`); l.addColorStop(0.25, `rgba(${col},${a})`); l.addColorStop(0.7, `rgba(${col},${a})`); l.addColorStop(1, `rgba(${col},${a * 0.35})`);
    g.fillStyle = l; g.fillRect(0, y0, w, y1 - y0);
  };
  return {
    tree: mk((g) => {
      band(g, h * 0.04, h, 0.2, '2,34,92');
      const r = g.createRadialGradient(w / 2, h * 0.5, Math.min(w, h) * 0.1, w / 2, h * 0.5, Math.max(w, h) * 0.6);
      r.addColorStop(0, 'rgba(2,30,84,0.3)'); r.addColorStop(0.5, 'rgba(2,30,84,0.18)'); r.addColorStop(1, 'rgba(2,30,84,0)');
      g.fillStyle = r; g.fillRect(0, 0, w, h);
    }),
    rods: mk((g) => {
      g.fillStyle = 'rgba(0,44,110,0.22)'; g.fillRect(0, 0, w, h);
      const r = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.7);
      r.addColorStop(0, 'rgba(0,36,96,0.1)'); r.addColorStop(1, 'rgba(0,20,64,0.3)');
      g.fillStyle = r; g.fillRect(0, 0, w, h);
    }),
    boats: mk((g) => {
      const r = g.createRadialGradient(w / 2, h * 0.55, Math.min(w, h) * 0.3, w / 2, h * 0.55, Math.max(w, h) * 0.75);
      r.addColorStop(0, 'rgba(0,36,96,0)'); r.addColorStop(1, 'rgba(0,20,64,0.26)');
      g.fillStyle = r; g.fillRect(0, top, w, h - top);
    }),
  };
}

// marine snow: tiny specks that drift and twinkle (fixed seeds, no allocation per frame)
function motes(S) {
  const n = Math.round(clamp((S.w * S.U) / 4200, 40, 140)), out = new Float32Array(n * 5);
  for (let i = 0; i < n; i++) out.set([hash1(i, 51), hash1(i, 53), 1.5 + hash1(i, 52) * 3.5, hash1(i, 54) * TAU, hash1(i, 55)], i * 5);
  return out;
}

// layer paddings (logical px) = the parallax room on each side
const PAD = { sky: 26, far3: 20, far2: 26, far1: 40, mid: 60, floor: 96, props: 96 };
const PAR = { sky: 0.015, far3: 0.02, far2: 0.03, far1: 0.05, mid: 0.085, floor: 0.14, props: 0.14 };

function* buildScene(S) {
  const { w, h, top, U } = S;
  const r = new RNG(77);
  const hazeDeep = waterAt(0.36), hazeFar = waterAt(0.42), hazeMid = waterAt(0.5);
  // animated textures first (cheap, they make the scene feel alive while the rest builds)
  S.surf = [];
  for (let f = 0; f < 12; f++) { S.surf.push(surfaceFrame(160, 34, f, 12)); if (f % 3 === 2) yield; }
  // Boats: soft voxel clouds in the strip of sky above the surface
  if (top > 0) {
    const P = PAD.sky, LW = w + P * 2, L = layer(LW, top);
    for (let i = 0; i < 4; i++) {
      const s = yield* cloudSteps(i);
      put(L, s, P + w * (0.06 + i * 0.22 + hash1(i, 41) * 0.05), top * (0.3 + hash1(i, 42) * 0.2), 2);
    }
    S.L.sky = { c: twin(L.c), x: -P, y: 0, P };
    S.ready.sky = -1;
  }

  // ---- far3: the faintest reef ridge on the horizon
  {
    const P = PAD.far3, LW = w + P * 2, y0 = top + U * 0.3, base = S.far3Y - y0, L = layer(LW, base + 30);
    const hills = yield* hillsSteps('h3', Math.ceil(LW), 40, { seed: 53, base: 18, amp: 34, cols: ['#7aa8d0', '#6a96c2', '#5c86b4', '#5078a6'], speck: ['#8ab0e0', '#9ab8d8'] });
    put(L, hills, 0, base, 2);
    fog(L, hazeDeep, 0.74, 0.66);
    S.L.far3 = { c: twin(L.c), x: -P, y: y0, P };
    S.ready.far3 = -1;
  }
  yield;

  // ---- far2: faint silhouettes (pinnacles, a mesa, an arch) on rolling rock hills
  {
    const P = PAD.far2, LW = w + P * 2, y0 = top + U * 0.16, base = S.far2Y - y0, L = layer(LW, base + 40);
    const hills = yield* hillsSteps('h2', Math.ceil(LW), 60, { seed: 54, base: 10, amp: 26, cols: ['#8a9cc0', '#7484aa', '#5e6c94', '#4c5a80'], speck: ROCK });
    put(L, hills, 0, base, 2);
    const items = [];
    const sp = [[0.03, 58, 10], [0.15, 84, 13], [0.27, 48, 9], [0.73, 76, 12], [0.87, 96, 14], [0.97, 54, 10], [0.6, 44, 9]];
    for (let i = 0; i < sp.length; i++) {
      const [xf, hh, ww] = sp[i];
      const s = yield* farSteps('sp|' + i + '|' + hh, () => farRender(spire(400 + i, { h: hh, w: ww, d: 16, lean: hash1(i, 3) * 0.14 - 0.07, cols: ROCK, crown: CROWN }), { scale: 1.5, yaw: i % 2 ? 22 : -22 }));
      items.push([s, xf * LW, base + 8 + (i % 3) * 3]);
    }
    const ms = yield* farSteps('mesa|a', () => farRender(mesa(52, { h: 34, w: 38, d: 18, cols: ROCK, crown: CROWN }), { scale: 1.5, yaw: -16 }));
    items.push([ms, LW * 0.5, base + 10]);
    const ar = yield* farSteps('arch|a', () => farRender(rockArch(51, { span: 56, h: 72, th: 8, d: 14, cols: ROCK, crown: CROWN }), { scale: 1.5, yaw: 18 }));
    items.push([ar, LW * 0.36, base + 12]);
    items.sort((a, b) => a[2] - b[2]);
    for (const [s, x, y] of items) put(L, s, x, y);
    fog(L, hazeFar, 0.62, 0.5);
    S.L.far2 = { c: twin(L.c), x: -P, y: y0, P };
    S.ready.far2 = -1;
  }
  yield;

  // ---- far1: the coral garden on sand dunes (bommies, fans, sponges, rocks)
  {
    const P = PAD.far1, LW = w + P * 2, y0 = top + U * 0.3, base = S.far1Y - y0, L = layer(LW, base + 40);
    const hills = yield* hillsSteps('h1', Math.ceil(LW), 64, { seed: 55, base: 6, amp: 16, cols: ['#f2deb0', '#e2c898', '#d0b482', '#b89c6c'], speck: ['#8a92b0', '#a4aec8', '#ff9ab4'] });
    put(L, hills, 0, base, 2);
    const items = [];
    const nC = Math.round(clamp(LW / 60, 10, 22));
    for (let i = 0; i < nC; i++) {
      const s = yield* coralSteps(LOW_KINDS[i % LOW_KINDS.length], 300 + (i % 12), [9, 12, 10, 8][i % 4]);
      items.push([s, ((i + r.float(0.1, 0.9)) / nC) * LW, base + r.float(10, 22)]);
    }
    const nR = Math.round(clamp(LW / 220, 4, 7));
    for (let i = 0; i < nR; i++) {
      const s = yield* reefSteps(330 + (i % 3), { w: 96, h: 56, d: 34, sizes: [7, 14] });
      items.push([i % 2 ? s : (S['flip33' + (i % 3)] ||= flipS(s)), LW * ((i + 0.5) / nR) + r.int(-24, 24), base + r.float(12, 20)]);
    }
    for (const [id, xf, sc] of [['rock_big', 0.22, 0.5], ['rock_small', 0.58, 0.6], ['rock_big', 0.82, 0.45], ['coral_brain', 0.42, 0.5]]) {
      const s = yield* propSteps(id, sc);
      if (s) items.push([s, LW * xf, base + r.float(12, 20)]);
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
    const fr = [];
    for (let k = 0; k < FISH.length; k++) fr.push(yield* fishSteps(k));
    const mkSchool = (k, n, depth, y, speed, dir, scale, spread = 1) => {
      const fogA = depth === 'far' ? 0.6 : depth === 'mid' ? 0.36 : 0.12, col = depth === 'far' ? hazeFar : hazeMid;
      const frames = fr[k].map((c) => tintCanvas(c, col, fogA));
      const pair = frames.map((c) => (dir < 0 ? flipCanvas(c) : c)).map((c) => spriteTwin(c, scale));
      const members = [];
      for (let i = 0; i < n; i++) members.push([(hash1(i, 11 + k) * 46 - 23) * spread, (hash1(i, 13 + k) * 18 - 9) * spread, hash1(i, 17 + k) * TAU]);
      return { frames: pair, members, y, speed, dir, depth, off: hash1(k, 5) * 1000, span: w + 160 };
    };
    S.fish.push(mkSchool(0, 13, 'far', top + U * 0.42, 6, 1, 1));
    S.fish.push(mkSchool(1, 8, 'far', top + U * 0.27, 4.5, -1, 1));
    S.fish.push(mkSchool(4, 6, 'far', top + U * 0.52, 5.5, -1, 1, 0.8));
    S.fish.push(mkSchool(2, 5, 'mid', top + U * 0.58, 9, 1, 2));
    S.fish.push(mkSchool(5, 3, 'mid', top + U * 0.36, 7, -1, 2, 1.2));
    S.fish.push(mkSchool(3, 2, 'near', top + U * 0.7, 11, 1, 2, 0.6));
  }
  yield;
  // a sea turtle gliding through the mid water (hazed), facing either way
  {
    const T = yield* turtleSteps(16);
    const mk = (flip) => T.frames.map((c) => spriteTwin(tintCanvas(flip ? flipCanvas(c) : c, hazeMid, 0.32), 2));
    const R = mk(false);
    yield;
    S.turtle = { R, L: mk(true), ox: T.ox, oy: T.oy, w: T.frames[0].width };
  }

  // ---- mid: reef bommies, a sunken boat, rocks and tube worms on sand dunes
  {
    const P = PAD.mid, LW = w + P * 2, y0 = top + U * 0.28, base = S.midY - y0, L = layer(LW, S.floorY + 40 - y0);
    const hills = yield* hillsSteps('hm', Math.ceil(LW), 80, { seed: 56, base: 5, amp: 12, cols: ['#f6e6be', '#e8d0a2', '#d6bc8a', '#c0a274'], speck: ['#8a92b0', '#a4aec8', '#ffb48a', '#ff9ab4'] });
    put(L, hills, 0, base, 2);
    const items = [];
    const reefs = [[0.04, 344, 1.25], [0.2, 341, 1], [0.5, 342, 1], [0.84, 341, 1], [0.97, 345, 1.25]];
    for (let i = 0; i < reefs.length; i++) {
      const [xf, seed, sz] = reefs[i];
      let s = yield* reefSteps(seed, { w: Math.round(120 * sz), h: Math.round(72 * sz), d: 44, rock: sz > 1 ? 0.55 : 0.42, sizes: [8, 18] });
      if (i === 3 || i === 4) s = S['flipm' + i] ||= flipS(s);
      items.push([s, LW * xf + (i % 4 ? r.int(-24, 24) : 0), base + r.float(16, 24), 1]);
    }
    const boat = yield* propSteps('sunken_boat', 0.9);
    if (boat) items.push([boat, LW * 0.68, base + 24, 1]);
    for (const [id, xf, sc] of [['rock_big', 0.3, 0.8], ['rock_arch', 0.1, 0.9], ['rock_small', 0.9, 0.9], ['rock_big', 0.4, 0.6], ['starfish_rock', 0.6, 0.7], ['coral_brain', 0.76, 0.8], ['coral_brain', 0.26, 0.6]]) {
      const s = yield* propSteps(id, sc);
      if (s) items.push([s, LW * xf, base + r.float(14, 26), 1]);
    }
    for (let i = 0; i < 9; i++) {
      const s = yield* coralSteps(LOW_KINDS[(i + 3) % LOW_KINDS.length], 360 + i, [12, 14, 10][i % 3]);
      items.push([s, ((i + r.float(0.15, 0.85)) / 9) * LW, base + r.float(14, 28), 1]);
    }
    items.sort((a, b) => a[2] - b[2]);
    for (const [s, x, y, k] of items) put(L, s, x, y, k);
    fog(L, hazeMid, 0.4, 0.26);
    S.L.mid = { c: twin(L.c), x: -P, y: y0, P };
    S.ready.mid = -1;
  }
  yield;

  // mid reef life: anemones swaying on the dunes (hazed like the mid layer)
  {
    const P = PAD.mid, spots = [[0.07, 'pink'], [0.16, 'purple'], [0.33, 'teal'], [0.45, 'orange'], [0.57, 'magenta'], [0.79, 'orange'], [0.88, 'red'], [0.95, 'yellow']];
    for (let i = 0; i < spots.length; i++) {
      const [xf, pal] = spots[i];
      const A = yield* animSteps('anemone', 610 + i, 14 + (i % 3) * 2, 16, pal);
      const key = 'animm|' + i;
      const frames = SPR.get(key) || A.frames.map((c) => spriteTwin(tintCanvas(c, hazeMid, 0.3), 1));
      SPR.set(key, frames);
      S.anim.push({ frames, ox: A.ox / HI, oy: A.oy / HI, x: -P + (w + P * 2) * xf, y: S.midY + 18 + hash1(i, 9) * 8, layer: 'mid', P: 3 + hash1(i, 7) * 1.4, off: hash1(i, 8) * 16 });
      yield;
    }
  }

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
    S.ready.floor = -1;
  }
  yield;

  // caustics (tile frames over the floor band)
  {
    const TH = Math.round(h + 20 - S.floorY), TW = 128, n = 16, fr = [];
    for (let f = 0; f < n; f++) { fr.push(causticFrame(TW, TH, f, n)); yield; }
    S.caus = { frames: fr, TW, TH };
  }

  // ---- props: big reef walls at the edges, sea fans, relics, rocks (sit on the floor)
  const gy = (d) => S.floorY + (h - S.floorY) * d; // view y on the floor; d: 0 = back edge .. 1 = bottom of the view
  {
    const P = PAD.props, LW = w + P * 2, y0 = top + U * 0.06, L = layer(LW, h + 30 - y0);
    const items = [];
    const ew = Math.round(clamp(w * 0.22, 130, 240));
    // tall coral-covered rock walls frame both sides (a little canyon) where open water would be
    const left = yield* reefSteps(371, { w: ew, h: Math.round(clamp(U * 0.46, 120, 230)), d: 64, rock: 0.76, sizes: [10, 24] });
    const right = yield* reefSteps(372, { w: Math.round(ew * 0.92), h: Math.round(clamp(U * 0.4, 110, 210)), d: 60, rock: 0.74, sizes: [10, 24] });
    items.push([left, P + w * 0.05, gy(0.8), 2, 0.2]);
    items.push([S.flip372 ||= flipS(right), P + w * 0.96, gy(0.74), 2, 0.26]);
    // sea fans standing up behind the edge reefs (flat lace, not trees)
    for (const [seed, size, xf, d] of [[391, 22, 0.02, 0.36], [392, 18, 0.11, 0.3], [393, 20, 0.9, 0.32], [394, 24, 0.985, 0.4]]) {
      const s = yield* coralSteps('fan', seed, size);
      items.push([s, P + w * xf, gy(d), 2, 1 - d]);
    }
    const back = yield* reefSteps(373, { w: 90, h: 60, d: 40, sizes: [7, 14] });
    items.push([back, P + w * 0.22, gy(0.22), 2, 0.8]);
    items.push([S.flip373 ||= flipS(back), P + w * 0.79, gy(0.18), 2, 0.85]);
    const corals = [['fan', 381, 14, 0.15, 0.5], ['staghorn', 382, 12, 0.3, 0.58], ['brain', 383, 9, 0.66, 0.7], ['tube', 384, 12, 0.86, 0.45], ['bubble', 385, 8, 0.44, 0.85], ['brain', 386, 10, 0.56, 0.38], ['tube', 387, 10, 0.76, 0.6], ['bubble', 388, 9, 0.12, 0.95], ['staghorn', 389, 11, 0.93, 0.97]];
    for (const [k, seed, size, xf, d] of corals) {
      const s = yield* coralSteps(k, seed, size);
      items.push([s, P + w * xf, gy(d), 2, 1 - d]);
    }
    for (const [id, xf, d, sc, o] of [['anchor', 0.33, 0.62, 0.7, {}], ['treasure_chest', 0.71, 0.66, 0.55, { frame: 1 }], ['clam_pearl', 0.53, 0.8, 0.55, {}], ['starfish_rock', 0.22, 0.86, 0.5, {}], ['rock_small', 0.62, 0.95, 0.6, {}], ['diver_helmet', 0.9, 0.9, 0.5, {}], ['message_bottle', 0.47, 0.5, 0.5, {}], ['coral_brain', 0.8, 0.84, 0.55, { variant: 2 }]]) {
      const s = yield* propSteps(id, sc, o);
      if (s) items.push([s, P + w * xf, gy(d), 2, 1 - d, id]);
    }
    items.sort((a, b) => b[4] - a[4]);
    for (const [s, x, y, k] of items) put(L, s, x, y - y0, k); // items hold view y
    S.L.props = { c: twin(L.c), x: -P, y: y0, P };
    S.ready.props = -1;
    // view-space boxes of the props (for ordering the swaying life against them)
    S.boxes = items.map(([s, x, y, k, back]) => { const l = x - P - (s.ox * k) / HI, tp = y - (s.oy * k) / HI; return [l, tp, l + (s.canvas.width * k) / HI, tp + (s.canvas.height * k) / HI, 1 - back]; });
    // bubble sources: the chest, the clam, the diver's helmet, a couple of vents in the sand
    for (const it of items) {
      if (it[5] === 'treasure_chest') S.bubbles.push({ x: it[1] - P - 4, y: it[2] - 18, n: 7, sp: 20, h: 150 });
      if (it[5] === 'clam_pearl') S.bubbles.push({ x: it[1] - P, y: it[2] - 10, n: 5, sp: 16, h: 130 });
      if (it[5] === 'diver_helmet') S.bubbles.push({ x: it[1] - P + 2, y: it[2] - 22, n: 6, sp: 24, h: 170 });
    }
    S.bubbles.push({ x: w * 0.4, y: gy(0.3), n: 4, sp: 14, h: 110, small: true }, { x: w * 0.61, y: gy(0.24), n: 4, sp: 12, h: 100, small: true });
  }
  yield;

  // near reef life: anemones (sway) and short sea-grass tufts on the sand; a little crab
  {
    const spots = [[0.035, 0.97, 'pink', 18], [0.1, 0.9, 'purple', 16], [0.17, 0.72, 'teal', 13], [0.83, 0.93, 'orange', 16], [0.905, 0.6, 'red', 13], [0.975, 0.99, 'magenta', 18], [0.38, 0.92, 'yellow', 12], [0.64, 0.78, 'teal', 12], [0.27, 0.42, 'orange', 11], [0.645, 0.44, 'pink', 11]];
    for (let i = 0; i < spots.length; i++) {
      const [xf, d, pal, size] = spots[i];
      const A = yield* animSteps('anemone', 640 + i, size, 16, pal);
      const key = 'animp|' + (640 + i) + '|' + size;
      const frames = SPR.get(key) || A.frames.map((c) => spriteTwin(c, 2));
      SPR.set(key, frames);
      // one that a prop in front of it overlaps sways behind the props layer, the rest over it
      const ax = w * xf, ay = gy(d), l = ax - A.ox, tp = ay - A.oy, r = l + frames[0].width;
      const hidden = S.boxes.some((b) => b[4] > d && b[0] < r - 2 && b[2] > l + 2 && b[1] < ay - 2 && b[3] > tp + 2);
      S.anim.push({ frames, ox: A.ox, oy: A.oy, x: ax, y: ay, layer: hidden ? 'propsB' : 'props', P: 2.8 + hash1(i, 17) * 1.4, off: hash1(i, 18) * 16, d });
      yield;
    }
    for (let i = 0; i < 9; i++) {
      const A = yield* animSteps('seagrass', 40 + (i % 3), 6 + (i % 2), 12, null);
      const key = 'grass|' + (40 + (i % 3)) + '|' + (6 + (i % 2));
      const frames = SPR.get(key) || A.frames.map((c) => spriteTwin(c, 2));
      SPR.set(key, frames);
      const xf = [0.08, 0.27, 0.4, 0.47, 0.6, 0.69, 0.78, 0.86, 0.24][i], d = [0.62, 0.92, 0.6, 0.98, 0.72, 0.99, 0.95, 0.7, 0.5][i];
      S.anim.push({ frames, ox: A.ox, oy: A.oy, x: w * xf, y: gy(d), layer: 'floor', P: 3.2 + hash1(i, 27) * 1.2, off: i * 3, d });
    }
    S.anim.sort((a, b) => (a.d || 0) - (b.d || 0));
    const cf = voxCrab('#ff6a3a', 1);
    yield;
    S.crab = { frames: cf.map((q) => ({ c: spriteTwin(q.canvas, 1), ox: q.ox / HI, oy: q.oy / HI })), x0: w * 0.35, x1: w * 0.5, y: gy(0.97) };
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
const OFF = { sky: [0, 0], far3: [0, 0], far2: [0, 0], far1: [0, 0], mid: [0, 0], floor: [0, 0], props: [0, 0] };
export function drawLabRoom(ctx, v, t, cam, kind = 'tree') {
  const w = Math.round(v.w), h = Math.round(v.h);
  if (w < 8 || h < 8) return;
  const S = sceneFor(w, h, kind);
  stepScene(S);
  // parallax: pan in screen px -> softly clamped layer offsets; zoom pushes the near layers outward a touch
  const cx = cam ? cam.x || 0 : Math.sin(t * 0.07) * 260, cy = cam ? cam.y || 0 : Math.sin(t * 0.05) * 60, cz = cam ? cam.z || 0 : 0;
  for (const name in OFF) {
    const P = PAD[name], f = PAR[name], o = OFF[name];
    o[0] = P * 0.92 * Math.tanh((-cx * f) / P);
    o[1] = 10 * Math.tanh((-cy * f * 0.5) / 10) + cz * f * 40;
  }
  const x0 = v.x, y0 = v.y;
  const fade = (name) => {
    if (S.ready[name] === undefined) return 0;
    if (S.ready[name] < 0) S.ready[name] = t;
    return clamp((t - S.ready[name]) / 0.45, 0, 1);
  };
  const ga = ctx.globalAlpha;
  const lay = (name) => {
    const Lr = S.L[name];
    if (!Lr) return;
    const a = fade(name);
    if (a <= 0) return;
    const [dx, dy] = OFF[name];
    if (a < 1) ctx.globalAlpha = ga * a;
    ctx.drawImage(Lr.c, snap(x0 + Lr.x + dx), snap(y0 + Lr.y + dy));
    ctx.globalAlpha = ga;
  };

  ctx.drawImage(S.bg, x0, y0, w, h);
  lay('sky');
  lay('far3');
  lay('far2');
  drawFish(ctx, S, t, x0, y0, 'far', OFF.far2);
  lay('far1');
  drawFish(ctx, S, t, x0, y0, 'mid', OFF.far1);
  drawTurtle(ctx, S, t, x0, y0, OFF.far1);
  lay('mid');
  if (S.ready.mid !== undefined) drawAnim(ctx, S, t, x0, y0, 'mid', OFF.mid);
  lay('floor');
  // caustics drift over the sand
  if (S.caus && S.L.floor) {
    const { frames, TW } = S.caus, n = frames.length, q = (t * 4) % n, i0 = Math.floor(q), k = q - i0;
    const [dx, dy] = OFF.floor;
    const yy = snap(y0 + S.floorY + dy);
    const po = ctx.globalCompositeOperation;
    ctx.globalCompositeOperation = 'lighter';
    const fa = fade('floor');
    for (let j = 0; j < 2; j++) {
      const fi = j ? (i0 + 1) % n : i0, a = j ? k : 1 - k;
      if (a < 0.02) continue;
      ctx.globalAlpha = ga * a * 0.28 * fa;
      for (let x = (dx % TW) - TW; x < w + TW; x += TW) ctx.drawImage(frames[fi], snap(x0 + x), yy);
    }
    ctx.globalCompositeOperation = po; ctx.globalAlpha = ga;
  }
  if (S.ready.floor !== undefined) drawAnim(ctx, S, t, x0, y0, 'floor', OFF.floor);
  if (S.ready.props !== undefined) drawAnim(ctx, S, t, x0, y0, 'propsB', OFF.props, 'props');
  lay('props');
  if (S.ready.props !== undefined) { drawAnim(ctx, S, t, x0, y0, 'props', OFF.props); drawCrab(ctx, S, t, x0, y0, OFF.props); }
  drawFish(ctx, S, t, x0, y0, 'near', OFF.props);
  drawBubbles(ctx, S, t, x0, y0, OFF.props);
  drawMotes(ctx, S, t, x0, y0, OFF.far1);
  // readability veil
  ctx.drawImage(S.veil[kind] || S.veil.tree, x0, y0, w, h);
  // the rippling underside of the surface (top of the water), over the veil so it stays a bright aqua-white
  if (S.surf) {
    const fr = S.surf[Math.floor(t * 5) % S.surf.length], TW = 160, sx = ((t * 6) % TW + TW) % TW;
    const dx = OFF.far2[0];
    const yy = y0 + S.top - (S.top ? 4 : 2);
    ctx.globalAlpha = ga * (kind === 'boats' ? 1 : 0.8);
    for (let x = -TW - sx + (dx % TW); x < w + TW; x += TW) ctx.drawImage(fr, snap(x0 + x), yy);
    ctx.globalAlpha = ga;
  }
}

// swaying reef life: frame = phase of its own slow cycle
function drawAnim(ctx, S, t, x0, y0, layerName, [dx, dy], fadeOf = layerName) {
  const fa = clamp((t - (S.ready[fadeOf] > 0 ? S.ready[fadeOf] : t)) / 0.45, 0, 1), ga = ctx.globalAlpha;
  if (fa < 1) ctx.globalAlpha = ga * fa;
  for (const a of S.anim) {
    if (a.layer !== layerName) continue;
    const n = a.frames.length, f = a.frames[(Math.floor((t / a.P) * n + a.off) % n + n) % n];
    ctx.drawImage(f, snap(x0 + a.x + dx - a.ox), snap(y0 + a.y + dy - a.oy));
  }
  ctx.globalAlpha = ga;
}

// the sea turtle: one slow pass across the view every 80 s, alternating direction and depth, a lazy flipper stroke
// with a little lift on each down-beat
function drawTurtle(ctx, S, t, x0, y0, [dx, dy]) {
  const T = S.turtle;
  if (!T) return;
  if (T.t0 === undefined) T.t0 = t - 8;
  const cyc = 80, k = (t - T.t0) / cyc, pass = Math.floor(k), q = k - pass, dur = 0.8;
  if (q > dur) return;
  const dir = pass & 1 ? -1 : 1, u = q / dur, span = S.w + T.w + 40;
  const x = dir > 0 ? -T.w / 2 - 20 + u * span : S.w + T.w / 2 + 20 - u * span;
  const st = (t / 3.4) % 1, fi = Math.floor(st * 16) % 16;
  const y = S.top + S.U * (pass & 1 ? 0.34 : 0.44) + Math.sin(t * 0.13) * 10 - Math.sin(st * TAU) * 1.5;
  const f = (dir > 0 ? T.R : T.L)[fi];
  ctx.drawImage(f, snap(x0 + x + dx - (dir > 0 ? T.ox : f.width - T.ox)), snap(y0 + y + dy - T.oy));
}

// a little crab: scuttles sideways along the sand, pauses with its claws up, scuttles back
function drawCrab(ctx, S, t, x0, y0, [dx, dy]) {
  const C = S.crab;
  if (!C) return;
  const cyc = 14, q = (t % cyc) / cyc; // 0..0.3 walk right, 0.3..0.5 idle, 0.5..0.8 walk left, 0.8..1 idle
  let k, walking = true;
  if (q < 0.3) k = q / 0.3; else if (q < 0.5) { k = 1; walking = false; } else if (q < 0.8) k = 1 - (q - 0.5) / 0.3; else { k = 0; walking = false; }
  k = k * k * (3 - 2 * k);
  const fr = C.frames[walking ? 1 + (Math.floor(t * 8) & 1) : 0];
  const x = C.x0 + (C.x1 - C.x0) * k;
  ctx.drawImage(fr.c, snap(x0 + x + dx - fr.ox), snap(y0 + C.y + dy - fr.oy - (walking ? (Math.floor(t * 8) & 1) * 0.5 : 0)));
}

function drawFish(ctx, S, t, x0, y0, depth, [dx, dy]) {
  for (const sc of S.fish) {
    if (sc.depth !== depth) continue;
    const span = sc.span;
    const cx = ((sc.off + t * sc.speed * sc.dir) % span + span) % span - 80;
    const cy = sc.y + Math.sin(t * 0.3 + sc.off) * 8;
    for (let i = 0; i < sc.members.length; i++) {
      const [ox, oy, ph] = sc.members[i];
      // each fish weaves gently around its slot (slow figure-eight), the tail beats a little out of phase
      const fx = cx + ox + Math.sin(t * 0.7 + ph) * 4, fy = cy + oy + Math.sin(t * 1.1 + ph * 1.7) * 2.5;
      const f = sc.frames[Math.floor(t * 4.5 + ph * 3) & 1];
      ctx.drawImage(f, snap(x0 + fx + dx), snap(y0 + fy + dy));
    }
  }
}

function drawBubbles(ctx, S, t, x0, y0, [dx, dy]) {
  if (!S.ready.props) return;
  const ga = ctx.globalAlpha;
  for (let s = 0; s < S.bubbles.length; s++) {
    const B = S.bubbles[s];
    for (let i = 0; i < B.n; i++) {
      const q = (t * (B.sp / B.h) + i / B.n + hash1(s, 3)) % 1;
      const yy = B.y - q * B.h;
      if (yy < S.top + 8) continue;
      const xx = B.x + Math.sin(t * 2.2 + i * 1.7 + s) * (1 + q * 3);
      ctx.globalAlpha = ga * (q < 0.1 ? q * 10 : q > 0.8 ? (1 - q) * 5 : 1) * (B.small ? 0.6 : 0.85);
      ctx.drawImage(microBubble(B.small ? 1 : Math.min(2, 1 + ((i + s) % 3) * 0.5 + (q > 0.5 ? 0.5 : 0))), snap(x0 + xx + dx), snap(y0 + yy + dy));
    }
  }
  ctx.globalAlpha = ga;
}

// marine snow: single device px specks drifting down and sideways, softly twinkling
function drawMotes(ctx, S, t, x0, y0, [dx, dy]) {
  const M = S.motes, n = M.length / 5, ga = ctx.globalAlpha, H = S.h - S.top;
  ctx.fillStyle = '#e8fbff';
  for (let i = 0; i < n; i++) {
    const o = i * 5, sp = M[o + 2], ph = M[o + 3];
    const x = ((M[o] * S.w + Math.sin(t * 0.21 + ph) * 10 + t * sp * 0.6 + dx * 1.4) % S.w + S.w) % S.w;
    const y = S.top + ((M[o + 1] * H + t * sp + Math.sin(t * 0.5 + ph) * 3 + dy) % H + H) % H;
    ctx.globalAlpha = ga * (0.18 + 0.32 * Math.max(0, Math.sin(t * 1.3 + ph * 3)));
    ctx.fillRect(snap(x0 + x), snap(y0 + y), 0.5, 0.5);
  }
  ctx.globalAlpha = ga;
}

// Where the Boats tab floats its boats: on the water surface (view-relative y)
export function labRoomScene(v, kind) { return { wl: kind === 'boats' ? Math.round(v.h * 0.3) : 0 }; }

// A floating boat's water: a darker stepped pool under the hull (it sits IN the water), little foam dashes lapping
// at its sides, a bright pixel highlight band (white = selected, gold = the boat you sail) with two twinkling glints.
// No soft gradients and no rings. (x, y) = the hull centre on the water line.
export function drawBoatFloat(ctx, x, y, hw, t, o = {}) {
  x = snap(x); y = snap(y);
  const a0 = ctx.globalAlpha;
  ctx.fillStyle = '#0a4a8a';
  for (let i = 0; i < 3; i++) {
    const ww = snap(hw * (0.9 - i * 0.22));
    ctx.globalAlpha = a0 * (0.22 - i * 0.05);
    ctx.fillRect(x - ww, y + 1 + i, ww * 2, 1);
  }
  const hl = o.cur ? '#fff0a0' : o.sel ? '#ffffff' : null;
  if (hl) {
    ctx.fillStyle = hl;
    for (let i = 0; i < 3; i++) {
      const ww = snap(hw * (1.05 - i * 0.25) * (o.sel ? 1.1 : 1));
      ctx.globalAlpha = a0 * (0.55 - i * 0.14);
      ctx.fillRect(x - ww, y - 0.5 + i, ww * 2, 0.5);
    }
  }
  // foam lapping at the hull: short dashes drifting out and back
  ctx.fillStyle = '#ffffff';
  for (const s of [-1, 1]) for (let j = 0; j < 3; j++) {
    const q = (t * 0.8 + j * 0.33 + (s > 0 ? 0.5 : 0)) % 1;
    ctx.globalAlpha = a0 * 0.85 * (1 - q);
    ctx.fillRect(snap(x + s * (hw * 0.62 + q * 7) - (s < 0 ? 2.5 - j * 0.5 : 0)), y - 0.5 + (j & 1) * 0.5, snap(2.5 - j * 0.5), 0.5);
  }
  if (hl) {
    ctx.fillStyle = hl === '#fff0a0' ? '#fff6c8' : '#ffffff';
    for (let i = 0; i < 2; i++) {
      const q = 0.5 + 0.5 * Math.sin(t * 2.4 + i * 2.1);
      if (q < 0.3) continue;
      const gx = snap(x + (i ? hw * 0.95 : -hw * 0.9)), gy2 = snap(y - 5 - i * 5), arm = q > 0.75 ? 2 : 1;
      ctx.globalAlpha = a0 * q;
      ctx.fillRect(gx - arm, gy2, arm * 2 + 0.5, 0.5);
      ctx.fillRect(gx, gy2 - arm, 0.5, arm * 2 + 0.5);
    }
  }
  ctx.globalAlpha = a0;
}
