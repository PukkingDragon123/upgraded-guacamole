// Voxel reef scenery behind the tank's real fish (full voxel art; no flat or painted fish or coral).
//
//   reefDiorama(w, h, seed, k) -> {canvas, w, h}
//       a strip of voxel coral bommies (World agent's coral.js reef formations: staghorn, table, fans, brain,
//       tube sponges, bubble coral, sea whips on encrusted rock) standing along the back of the floor, built
//       with the world camera and cached per size. The bottom edge sits on the back line of the floor.
//   new ReefDrum(w, h, seed, vs)
//       the Aqua Lamp's moving picture as a 3D voxel reef DRUM: a cylinder (deep blue core, a ring of rock)
//       crowded with coral all around, rendered at N yaw steps (a ring of cached frames, built lazily one
//       per warm() call) so it slowly rotates like the real lamp's turning cylinder.
//       get(angleDeg) -> {a, b, k} two neighbouring frames and the blend between them (null until one exists).
// Frames: {canvas, ax, by} = axis x and the drum's bottom y inside the canvas.

import { VoxelModel, renderVoxels } from '../gfx/voxel.js';
import { reefSprite, coralModel, THEMES } from '../world/coral.js';
import { makeCanvas, ctxOf } from '../core/canvas.js';
import { RNG } from '../core/rng.js';
import { clamp, TAU } from '../core/math.js';

const dioCache = new Map();

export function reefDiorama(w, h, seed = 3, k = 1) {
  w = Math.max(16, Math.round(w)); h = Math.max(12, Math.round(h));
  const key = [w, h, seed, k].join('|');
  let d = dioCache.get(key);
  if (d) return d;
  const r = new RNG(seed * 31 + 7);
  const c = makeCanvas(w, h);
  const g = ctxOf(c);
  // formations sized so the reef fills the lower ~70% of the back glass
  const kk = clamp((h * 0.7) / 62, 0.3, 2.2) * k;
  const sprites = [];
  let x = -r.float(10, 30) * kk;
  let i = 0;
  while (x < w + 20 && i < 12) {
    const tall = r.chance(0.5);
    const opts = { w: tall ? 110 : 150, h: tall ? 96 : 78, d: 40, density: 1.15, rock: tall ? 0.36 : 0.44, sizes: [9, tall ? 24 : 20] };
    const s = reefSprite(seed * 100 + i, 'shallows', opts, kk, r.chance(0.5));
    sprites.push({ s, x: x + s.ox, z: r.next() });
    x += s.canvas.width * r.float(0.62, 0.8);
    i++;
  }
  // back row first (slightly lower), then the front row
  sprites.sort((a, b) => b.z - a.z);
  for (const { s, x: sx, z } of sprites) g.drawImage(s.canvas, Math.round(sx - s.ox), Math.round(h - s.oy + (z > 0.5 ? -2 : 1) * kk));
  d = { canvas: c, w, h };
  dioCache.set(key, d);
  if (dioCache.size > 12) dioCache.delete(dioCache.keys().next().value);
  return d;
}

// ------------------------------------------------------------------ the lamp's rotating reef drum

const KINDS = ['staghorn', 'fan', 'brain', 'tube', 'table', 'bubble', 'whip', 'staghorn', 'fan', 'pillar'];

const drumCache = new Map();
// Shared drums (the ring of frames survives view and tier changes).
export function reefDrum(w, h, seed = 5, vs = 2, n = 60) {
  const key = [Math.round(w), Math.round(h), seed, vs, n].join('|');
  let d = drumCache.get(key);
  if (!d) { d = new ReefDrum(w, h, seed, vs, n); drumCache.set(key, d); if (drumCache.size > 4) drumCache.delete(drumCache.keys().next().value); }
  return d;
}

export class ReefDrum {
  // w, h: on-screen size of the drum (px); vs: px per voxel
  constructor(w, h, seed = 5, vs = 2, n = 60) {
    this.vs = Math.max(1, Math.round(vs));
    this.n = n;
    this.frames = new Array(n).fill(null);
    this.model = buildDrum(Math.max(16, Math.round(w / this.vs)), Math.max(12, Math.round(h / this.vs)), seed);
  }

  render(i) {
    const m = this.model;
    const yaw = (i / this.n) * 360;
    const r = renderVoxels(m, { scale: this.vs, yaw, pitch: 8, outline: true, jitter: 0.05, ao: 1.2, edges: 0.6, sideEdges: 0.35, light: { top: 5, lit: 3.7, dark: 2.3, bottom: 1.2 } });
    const p = r.project(m.nx / 2, 0, m.nz / 2);
    return { canvas: r.canvas, ax: Math.round(p[0]), by: Math.round(p[1]) };
  }

  warm() { const k = this.frames.indexOf(null); if (k >= 0) this.frames[k] = this.render(k); return k >= 0; }

  get ready() { return this.frames.every(Boolean); }

  // frames around a rotation angle (degrees) and the blend between them
  get(deg) {
    const f = ((((deg / 360) * this.n) % this.n) + this.n) % this.n;
    const i0 = Math.floor(f) % this.n, i1 = (i0 + 1) % this.n;
    let a = this.frames[i0], b = this.frames[i1];
    if (!a) { for (let d = 1; d < this.n && !a; d++) a = this.frames[(i0 - d + this.n) % this.n]; b = null; }
    if (!a) return null;
    return { a, b, k: b ? f - Math.floor(f) : 0 };
  }
}

function buildDrum(D, H, seed) {
  const r = new RNG(seed);
  const m = new VoxelModel(D, H, D);
  const cx = D / 2, cz = D / 2, R = D / 2 - 1;
  const theme = THEMES.shallows;
  const core = m.color('#1f6ccc', { jitter: 0.05, smooth: 0.6 });
  const coreL = m.color('#3a9aee', { jitter: 0.05, smooth: 0.6 });
  const rock = m.color('#6a6488', { jitter: 0.12, smooth: 0.3 });
  const rockL = m.color('#8a82a8', { jitter: 0.1 });
  const sand = m.color('#e8d4a4', { jitter: 0.08 });
  const weed = m.color('#3ab84a', { jitter: 0.08, spec: 0.3 });
  const weedL = m.color('#8ae04a', { jitter: 0.06, spec: 0.4 });
  // the drum's deep blue core (the "sea" behind the reef) with lighter vertical light bands
  const Rc = R * 0.7;
  m.cylinder(cx, cz, 0, H - 1, Rc, (x, y, z) => (Math.sin(Math.atan2(z - cz, x - cx) * 9 + y * 0.05) > 0.55 ? coreL : core));
  // a ring of rock and sand around the bottom
  const rockH = Math.max(3, Math.round(H * 0.18));
  for (let y = 0; y < rockH; y++) {
    const rr = R * (0.98 - (y / rockH) * 0.2);
    m.cylinder(cx, cz, y, y, rr, (x, yy, z) => {
      const a = Math.atan2(z - cz, x - cx);
      const bump = Math.sin(a * 11 + seed) * 0.5 + Math.sin(a * 5 + y * 0.4) * 0.5;
      if (Math.hypot(x - cx, z - cz) > rr - 1.5 + bump) return null;
      return y === rockH - 1 ? sand : (x * 3 + y + z) % 5 === 0 ? rockL : rock;
    });
  }
  // rock ledges climbing the drum (a reef wall all the way round) with corals on every ledge
  const pal = new Map();
  const levels = [rockH - 1, Math.round(H * 0.4), Math.round(H * 0.66)];
  let ci = 0;
  for (let L = 0; L < levels.length; L++) {
    const y0 = levels[L];
    if (L > 0) {
      // a lumpy rock shelf sticking out of the core
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * TAU + r.float(0, 0.5) + L;
        const ex = cx + Math.cos(a) * Rc * 0.95, ez = cz + Math.sin(a) * Rc * 0.95;
        m.ellipsoid(ex, y0 - 1, ez, R * r.float(0.16, 0.24), Math.max(2, H * 0.035), R * r.float(0.16, 0.24), (x, y, z) => ((x + y * 2 + z) % 6 === 0 ? rockL : rock));
      }
    }
    const n = Math.round((TAU * R) / Math.max(5, H * (L ? 0.2 : 0.15)));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + r.float(-0.1, 0.1) + L * 0.4;
      const rad = (L ? Rc * 1.02 : R * 0.84) * r.float(0.95, 1.05);
      const kind = KINDS[Math.floor(r.next() * KINDS.length)];
      const size = Math.max(4, H * r.float(0.11, kind === 'fan' || kind === 'staghorn' ? (L ? 0.17 : 0.24) : 0.16));
      const cm = coralModel(kind, seed * 50 + ci++, theme, size);
      const b = cm.bounds();
      if (!b) continue;
      const px = cx + Math.cos(a) * rad, pz = cz + Math.sin(a) * rad;
      stampShared(m, cm, Math.round(px - (b.x0 + b.x1) / 2), y0, Math.round(pz - (b.z0 + b.z1) / 2), pal);
    }
  }
  const n = Math.round((TAU * R) / Math.max(5, H * 0.15));
  // sea grass blades between the corals
  for (let i = 0; i < Math.round(n * 0.8); i++) {
    const a = r.float(0, TAU), rad = R * r.float(0.75, 0.92);
    const x0 = cx + Math.cos(a) * rad, z0 = cz + Math.sin(a) * rad, hh = H * r.float(0.25, 0.5);
    const lean = r.float(-0.25, 0.25);
    m.tube([[x0, rockH - 1, z0, 0.7], [x0 + lean * hh * 0.4, rockH + hh * 0.5, z0, 0.6], [x0 + lean * hh, rockH + hh, z0, 0.45]], (x, y) => (y > rockH + hh * 0.6 ? weedL : weed), 3);
  }
  return m;
}

// Copy another model's voxels at an offset, reusing palette entries with the same look (the palette holds 255).
function stampShared(m, other, ox, oy, oz, pal) {
  const map = other.palette.map((p, i) => {
    if (i === 0 || !p) return 0;
    const key = JSON.stringify(p);
    let v = pal.get(key);
    if (v === undefined) { v = m.palette.length < 250 ? m.color(p.color, p) : 1; pal.set(key, v); }
    return v;
  });
  for (let z = 0; z < other.nz; z++) for (let y = 0; y < other.ny; y++) for (let x = 0; x < other.nx; x++) {
    const v = other.get(x, y, z);
    if (v) m.set(x + ox, y + oy, z + oz, map[v]);
  }
}
