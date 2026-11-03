// Voxel models for the Frutiger Aero room around the tank (full voxel art), all front-facing with the world
// camera's yaw (0) and a slight downward pitch. Big flat pieces render at 1 px per voxel and are upscaled by
// the view's voxel size (vs) with nearest-neighbour, which keeps the chunky voxel look at a quarter of the cost.
//
//   wallTile(vs)                         -> canvas (seamless paneled wall tile)
//   floorStrip(vs, w, h)                 -> canvas (plank floor seen from above, w x h px)
//   windowFrame(w, h, panes, fw, vs)     -> {canvas, ox, oy}  (ox, oy = top-left of the frame's front face)
//   glassDesk(w, topPx, thPx, legPx, vs) -> {canvas, ox, oy}  (ox, oy = front-top-left corner of the slab)
//   cabinetVox(w, h, vs) / consoleVox(w, h, vs) -> {canvas, ox, oy}  (front-top-left corner)
//   cloudVox(seed, w, h, vs)             -> canvas
//   hillVox(w, h, layer, seed, vs)       -> {canvas, crest(x) -> y (px from the strip top)}
//   new GlobeVox(rPx, vs)                rotating green glass globe: frame(t) -> canvas (ring built lazily)
//   broadPlant(vs, seed)                 -> {canvas, ox, oy}  big glossy-leaf floor plant (ground anchor)

import { VoxelModel, renderVoxels } from '../gfx/voxel.js';
import { buildLeaves } from '../world/aerokit.js';
import { makeCanvas, ctxOf } from '../core/canvas.js';
import { RNG } from '../core/rng.js';
import { clamp, smoothstep, hash2, fbm1, TAU } from '../core/math.js';

const LIGHT = { top: 5.2, lit: 4, dark: 2.5, bottom: 1.4 };
const DEG = Math.PI / 180;
const cache = new Map();
const memo = (key, fn) => { let v = cache.get(key); if (!v) { v = fn(); cache.set(key, v); if (cache.size > 80) cache.delete(cache.keys().next().value); } return v; };

// Render at 1 px per voxel, then upscale by vs (integer) with nearest-neighbour.
function vrender(m, vs, o = {}) {
  const r = renderVoxels(m, { scale: 1, yaw: 0, pitch: 24, outline: true, jitter: 0.04, ao: 0.9, edges: 0.55, light: LIGHT, ...o });
  let canvas = r.canvas;
  if (vs > 1) {
    canvas = makeCanvas(r.canvas.width * vs, r.canvas.height * vs);
    const g = ctxOf(canvas);
    g.imageSmoothingEnabled = false;
    g.drawImage(r.canvas, 0, 0, canvas.width, canvas.height);
  }
  return { canvas, project: (x, y, z) => { const p = r.project(x, y, z); return [p[0] * vs, p[1] * vs]; }, ox: r.ox * vs, oy: r.oy * vs };
}

// ------------------------------------------------------------------ wall & floor

export function wallTile(vs) {
  return memo('wall|' + vs, () => {
    const tw = 75, th = 52;
    const m = new VoxelModel(tw + 2, th + 2, 3);
    const wall = m.color('#eef8fc', { jitter: 0.025, smooth: 0.6 });
    const wall2 = m.color('#e4f3fa', { jitter: 0.025, smooth: 0.6 });
    const groove = m.color('#cfe6f1', { jitter: 0.02 });
    for (let y = 0; y < th + 2; y++) for (let x = 0; x < tw + 2; x++) {
      const gx = (x - 1 + tw) % tw, gy = (y - 1 + th) % th;
      const g = gx === 0 || gy === 0;
      for (let z = 0; z < (g ? 1 : 3); z++) m.set(x, y, z, g ? groove : (gx * 7 + gy * 3) % 23 < 2 ? wall2 : wall);
    }
    const r = renderVoxels(m, { scale: 1, yaw: 0, pitch: 0, outline: false, jitter: 0.03, ao: 1, edges: 0.4, light: LIGHT });
    const p = r.project(1, th + 1, 3);
    const t = makeCanvas(tw * vs, th * vs);
    const g = ctxOf(t);
    g.imageSmoothingEnabled = false;
    g.drawImage(r.canvas, Math.round(p[0]), Math.round(p[1]), tw, th, 0, 0, tw * vs, th * vs);
    return t;
  });
}

export function floorStrip(vs, w, h) {
  return memo('floor|' + vs + '|' + w + '|' + h, () => {
    const tw = 90, nz = Math.max(4, Math.round(h / vs / Math.sin(24 * DEG)));
    const m = new VoxelModel(tw + 2, 2, nz);
    const woods = ['#f8f0e0', '#f2e6d0', '#fbf5ea', '#eee0c6'].map((c) => m.color(c, { jitter: 0.03, spec: 0.45, specPow: 16, smooth: 0.5, contrast: 0.6 }));
    const seam = m.color('#d8c8a8', { jitter: 0.02, contrast: 0.6 });
    for (let z = 0; z < nz; z++) for (let x = 0; x < tw + 2; x++) {
      const px = (x - 1 + tw) % tw;
      const plank = Math.floor(px / 9);
      const endSeam = (z + plank * 7) % 23 === 0;
      const c = px % 9 === 0 || endSeam ? seam : woods[(plank + Math.floor((z + plank * 7) / 23)) % 4];
      m.set(x, 0, z, c); m.set(x, 1, z, c);
    }
    const r = renderVoxels(m, { scale: 1, yaw: 0, pitch: 24, outline: false, jitter: 0.03, ao: 0.6, edges: 0.3, light: { top: 5.8, lit: 4.6, dark: 3.2, bottom: 2.2 } });
    const p0 = r.project(1, 2, 0);
    const hh = Math.round(r.canvas.height - p0[1]);
    const tile = makeCanvas(tw * vs, hh * vs);
    const tg = ctxOf(tile);
    tg.imageSmoothingEnabled = false;
    tg.drawImage(r.canvas, Math.round(p0[0]), Math.round(p0[1]), tw, hh, 0, 0, tw * vs, hh * vs);
    const out = makeCanvas(w, h);
    const g = ctxOf(out);
    const th = Math.min(h, tile.height);
    for (let x = 0; x < w; x += tile.width) g.drawImage(tile, 0, 0, tile.width, th, x, 0, tile.width, th);
    if (th < h) { g.fillStyle = '#e8d8b8'; g.fillRect(0, th, w, h - th); }
    return out;
  });
}

// ------------------------------------------------------------------ window frame

export function windowFrame(w, h, panes, fw, vs) {
  return memo(['win', w, h, panes, fw, vs].join('|'), () => {
    const P = 18 * DEG;
    const f = Math.max(2, Math.round(fw / vs));
    const nx = Math.round(w / vs) + f * 2, ny = Math.round((h / vs + f * 2) / Math.cos(P));
    const sill = Math.max(2, Math.round(f * 0.7));
    const nz = 6, sz = nz + Math.max(3, f);
    const m = new VoxelModel(nx + 6, ny + sill + 1, sz);
    const white = m.color('#fbfdff', { jitter: 0.02, spec: 0.8, specPow: 16, smooth: 0.7 });
    const bevel = m.color('#dcebf3', { jitter: 0.02, spec: 0.5, smooth: 0.6 });
    const ox = 3, oy = sill + 1;
    const R = Math.max(2, Math.round(f * 1.3));
    const inRR = (x, y, x0, y0, x1, y1, r) => {
      if (x < x0 || x > x1 || y < y0 || y > y1) return false;
      const cx = x < x0 + r ? x0 + r : x > x1 - r ? x1 - r : x, cy = y < y0 + r ? y0 + r : y > y1 - r ? y1 - r : y;
      return Math.hypot(x - cx, y - cy) <= r;
    };
    const iw = nx - f * 2, ih = ny - f * 2;
    const mul = Math.max(1, Math.round(f * 0.6));
    const pw = (iw - mul * (panes - 1)) / panes;
    const inPane = (x, y) => {
      if (y < f || y >= f + ih) return false;
      const lx = x - f;
      if (lx < 0 || lx >= iw) return false;
      const k = Math.floor(lx / (pw + mul));
      const px = lx - k * (pw + mul);
      return px < pw && inRR(px, y - f, 0, 0, pw - 1, ih - 1, Math.max(1, Math.round(f * 0.6)));
    };
    for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
      if (!inRR(x, y, 0, 0, nx - 1, ny - 1, R) || inPane(x, y)) continue;
      // inner bevel: one voxel step back next to a pane
      const nearPane = inPane(x + 1, y) || inPane(x - 1, y) || inPane(x, y + 1) || inPane(x, y - 1);
      for (let z = 0; z < (nearPane ? nz - 2 : nz); z++) m.set(x + ox, y + oy, z, nearPane ? bevel : white);
    }
    // sill: deeper ledge under the frame
    for (let y = 0; y < sill; y++) for (let z = 0; z < sz; z++) for (let x = 0; x < nx + 6; x++) m.set(x, oy - 1 - y, z, y === 0 ? white : bevel);
    const r = vrender(m, vs, { pitch: 18, ao: 1, edges: 0.7, outline: true });
    const p = r.project(ox, oy + ny, nz);
    return { canvas: r.canvas, ox: Math.round(p[0]), oy: Math.round(p[1]) };
  });
}

// ------------------------------------------------------------------ furniture

export function glassDesk(w, topPx, thPx, legPx, vs) {
  return memo(['desk', w, topPx, thPx, legPx, vs].join('|'), () => {
    const P = 24 * DEG;
    const nx = Math.round(w / vs), nz = Math.max(3, Math.round(topPx / vs / Math.sin(P)));
    const th = Math.max(2, Math.round(thPx / vs / Math.cos(P)));
    const legH = Math.max(2, Math.round(legPx / vs / Math.cos(P)));
    const m = new VoxelModel(nx, legH + th + 1, nz + 2);
    const glass = m.color('#c8f6ee', { jitter: 0.02, spec: 1.3, specPow: 22, smooth: 0.9 });
    const edge = m.color('#4fd0bc', { jitter: 0.02, spec: 1, specPow: 18, smooth: 0.8 });
    const chrome = m.color('#c8d8e4', { jitter: 0, spec: 1.7, specPow: 26, smooth: 0.6 });
    const foot = m.color('#8a9cac', { jitter: 0 });
    // slab: pale glass top, saturated green-aqua edge
    m.box(0, legH, 1, nx - 1, legH + th - 1, nz, (x, y, z) => (y === legH + th - 1 && z < nz ? glass : edge));
    // chrome legs + crossbar
    const lw = Math.max(1, Math.round(3 / vs));
    for (const lx of [Math.round(10 / vs) + 2, nx - Math.round(10 / vs) - 3 - lw]) {
      m.box(lx, 0, nz - 2 - lw, lx + lw, legH - 1, nz - 2, chrome);
      m.box(lx - 1, 0, nz - 3 - lw, lx + lw + 1, 0, nz - 1, foot);
      m.box(lx, 0, 2, lx + lw, legH - 1, 2 + lw, chrome);
    }
    m.box(Math.round(10 / vs) + 2, Math.round(legH * 0.3), 3, nx - Math.round(10 / vs) - 3, Math.round(legH * 0.3), 3, chrome);
    const r = vrender(m, vs, { ao: 0.7, edges: 0.8 });
    const p = r.project(0, legH + th, nz + 1);
    return { canvas: r.canvas, ox: Math.round(p[0]), oy: Math.round(p[1]) };
  });
}

export function cabinetVox(w, h, vs) {
  return memo(['cab', w, h, vs].join('|'), () => {
    const nx = Math.round(w / vs), ny = Math.round(h / vs / Math.cos(24 * DEG)), nz = 10;
    const m = new VoxelModel(nx, ny, nz);
    const white = m.color('#f4fafd', { jitter: 0.02, spec: 0.8, specPow: 16, smooth: 0.7 });
    const seam = m.color('#a9c4d4', { jitter: 0.02 });
    const chrome = m.color('#c8d8e4', { spec: 1.7, specPow: 26 });
    const aqua = m.color('#2fd3e8', { spec: 0.9 });
    const mid = Math.floor(nx / 2);
    m.box(0, 0, 0, nx - 1, ny - 1, nz - 1, (x, y, z) => {
      if (z === nz - 1 && (x === mid || x === mid - 1)) return seam;
      if (z === nz - 1 && y === ny - 3) return aqua;
      return white;
    });
    const hh = Math.max(2, Math.round(ny * 0.22));
    for (const hx of [mid - 3, mid + 2]) m.box(hx, ny - 6 - hh, nz, hx, ny - 6, nz, chrome);
    const r = vrender(m, vs, { ao: 0.8, edges: 0.7 });
    const p = r.project(0, ny, nz);
    return { canvas: r.canvas, ox: Math.round(p[0]), oy: Math.round(p[1]) };
  });
}

export function consoleVox(w, h, vs) {
  return memo(['con', w, h, vs].join('|'), () => {
    const nx = Math.round(w / vs), ny = Math.max(3, Math.round(h / vs)), nz = 8;
    const m = new VoxelModel(nx, ny, nz);
    const white = m.color('#f4fafd', { jitter: 0.02, spec: 0.8, specPow: 16, smooth: 0.8 });
    const aqua = m.color('#2fd3e8', { spec: 0.9 });
    const r0 = ny / 2;
    for (let x = 0; x < nx; x++) for (let y = 0; y < ny; y++) {
      const ex = x < r0 ? r0 - x : x > nx - 1 - r0 ? x - (nx - 1 - r0) : 0;
      if (Math.hypot(ex, y + 0.5 - r0) > r0) continue;
      for (let z = 0; z < nz; z++) m.set(x, y, z, y === 1 && z === nz - 1 ? aqua : white);
    }
    const r = vrender(m, vs, { ao: 0.8, edges: 0.7 });
    const p = r.project(0, ny, nz);
    return { canvas: r.canvas, ox: Math.round(p[0]), oy: Math.round(p[1]) };
  });
}

// ------------------------------------------------------------------ outside: clouds, hills, globe

export function cloudVox(seed, w, h, vs) {
  return memo(['cloud', seed, w, h, vs].join('|'), () => {
    const r = new RNG(seed);
    const nx = Math.max(8, Math.round(w / vs)), ny = Math.max(5, Math.round(h / vs)), nz = Math.max(5, Math.round(ny * 0.9));
    const m = new VoxelModel(nx, ny, nz);
    const c = m.color('#f2f8ff', { jitter: 0.015, smooth: 0.8, ramp: ['#9ab8d8', '#b8d0ea', '#d4e4f6', '#e8f2fc', '#f6faff', '#ffffff', '#ffffff'] });
    const n = r.int(4, 7);
    for (let i = 0; i < n; i++) {
      const u = n === 1 ? 0.5 : i / (n - 1);
      const big = 1 - Math.abs(u - r.float(0.35, 0.6)) * 1.3;
      const ry = ny * r.float(0.32, 0.46) * (0.6 + big * 0.55);
      const rx = ry * r.float(1.1, 1.5);
      m.ellipsoid(nx * (0.15 + 0.7 * u) + r.float(-1.5, 1.5), 1 + ry * 0.62, nz / 2, rx, ry, Math.min(nz / 2 - 0.5, ry), c);
    }
    m.sub(() => m.box(0, 0, 0, nx - 1, 0, nz - 1, c));
    return vrender(m, vs, { pitch: 10, outline: false, edges: 0.35, ao: 1, light: { top: 5.6, lit: 4.4, dark: 3, bottom: 2 } }).canvas;
  });
}

// layer 0 far (hazy), 1 mid, 2 near (the curved green horizon of a little planet)
export function hillVox(w, h, layer, seed, vs) {
  return memo(['hill', w, h, layer, seed, vs].join('|'), () => {
    const nx = Math.round(w / vs), ny = Math.round(h / vs), nz = layer === 2 ? 14 : 8;
    const m = new VoxelModel(nx, ny, nz);
    const pals = [
      [['#a9d9c6', '#8cc9b0', '#76b8a0'], { jitter: 0.02, smooth: 0.8 }],
      [['#b8ef7a', '#6fcf3c', '#4aae2c'], { jitter: 0.04, spec: 0.35, smooth: 0.6 }],
      [['#c8ff8a', '#5ad83a', '#2f9e2c'], { jitter: 0.04, spec: 0.5, specPow: 14, smooth: 0.6 }],
    ][layer];
    const [hiC, midC, loC] = pals[0].map((c) => m.color(c, pals[1]));
    const sheen = m.color('#eaffb8', { spec: 0.8, smooth: 0.7 });
    const flowers = ['#ffffff', '#ffe23a', '#ff8ad0'].map((c) => m.color(c, { jitter: 0.03 }));
    const path = m.color('#eaf8b0', { jitter: 0.03 });
    const dcx = nx * 0.4, dw = nx * 0.62;
    const crestV = layer === 2
      ? (x) => { const q = (x - dcx) / dw; return ny * 0.98 * (1 - q * q) * 0.62 + Math.sin(x * 0.05 + seed) * 0.6; }
      : (x) => ny * ([0.5, 0.42][layer] + [0.12, 0.17][layer] * (0.55 * Math.sin(x * 0.012 * (2 - layer) + seed) + 0.3 * Math.sin(x * 0.033 + seed * 2.3) + 0.4 * (fbm1(x * 0.01 + seed, 3, seed) - 0.5)));
    const tops = new Float32Array(nx);
    for (let x = 0; x < nx; x++) tops[x] = clamp(crestV(x), 0, ny - 1);
    for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) {
      const zf = z / (nz - 1);
      const fall = Math.pow(smoothstep(0.2, 1, zf), 1.3) * (layer === 2 ? 0.55 : 0.35);
      const hgt = Math.round(tops[x] * (1 - fall));
      for (let y = 0; y < hgt; y++) {
        let c = y >= hgt - 1 ? hiC : y > hgt - 4 ? midC : loC;
        if (layer === 2 && y === hgt - 1) {
          if (fall < 0.08 && fall > 0.01 && Math.abs(x - dcx + nx * 0.06) < nx * 0.16) c = sheen;
          if (hash2(x, z, 9) < 0.03) c = flowers[Math.floor(hash2(z, x, 4) * 3)];
          const pxp = dcx - nx * 0.1 + (tops[x] > 0 ? 0 : 0);
          if (Math.abs(x - (pxp + (nz - z) * 1.2)) < 1 + (nz - z) * 0.15) c = path;
        }
        m.set(x, y, z, c);
      }
    }
    const r = vrender(m, vs, { ao: 0.9, edges: layer ? 0.45 : 0.2, outline: layer > 0, light: { top: 5.2, lit: 3.9, dark: 2.5, bottom: 1.4 } });
    // crest (screen) height lookup: the back row's top
    const crest = (px) => {
      const vx = clamp(Math.round(px / vs), 0, nx - 1);
      return r.project(vx, tops[vx], 0)[1];
    };
    return { canvas: r.canvas, crest, tops };
  });
}

// Green glass globe with original continents; a ring of yaw frames built lazily.
export class GlobeVox {
  constructor(rPx, vs, n = 36) {
    this.vs = vs; this.n = n; this.frames = new Array(n).fill(null);
    const R = Math.max(6, Math.round(rPx / vs));
    const S = R * 2 + 2;
    const m = new VoxelModel(S, S, S);
    const sea = m.color('#38c84a', { jitter: 0.03, spec: 1.3, specPow: 10, smooth: 0.95 });
    const seaD = m.color('#1f9a34', { jitter: 0.03, spec: 1.2, specPow: 10, smooth: 0.95 });
    const land = m.color('#e8ffd8', { jitter: 0.03, spec: 1, specPow: 12, smooth: 0.9 });
    const coast = m.color('#a8f07a', { jitter: 0.03, spec: 1, smooth: 0.9 });
    const grid = m.color('#86e070', { jitter: 0.02, spec: 1, smooth: 0.9 });
    const c = S / 2;
    m.sphere(c, c, c, R, (x, y, z) => {
      const dx = x + 0.5 - c, dy = y + 0.5 - c, dz = z + 0.5 - c;
      const d = Math.hypot(dx, dy, dz) || 1;
      const nx = dx / d, ny = dy / d, nz = dz / d;
      const lat = Math.asin(ny), lon = Math.atan2(nz, nx);
      const v = fbm1(lon * 1.3 + 7, 3, 3) * 0.55 + fbm1(lat * 2.4 + lon * 0.7 + 3, 3, 9) * 0.45;
      if (Math.abs(((lat / (Math.PI / 4)) % 1 + 1) % 1 - 0.5) > 0.475 || Math.abs(((lon / (Math.PI / 4)) % 1 + 1) % 1 - 0.5) > 0.48) return grid;
      return v > 0.56 ? land : v > 0.53 ? coast : ny < -0.2 ? seaD : sea;
    });
    this.model = m;
  }

  render(i) {
    const r = renderVoxels(this.model, { scale: this.vs, yaw: (i / this.n) * 360, pitch: 14, outline: true, jitter: 0.03, ao: 0.4, edges: 0.4, light: { top: 5.4, lit: 4.4, dark: 2.6, bottom: 1.8 } });
    return r.canvas;
  }

  warm() { const k = this.frames.indexOf(null); if (k >= 0) this.frames[k] = this.render(k); }

  frame(t) {
    const i = Math.floor(((t * 0.08) % 1) * this.n) % this.n;
    if (this.frames[i]) return this.frames[i];
    for (let d = 1; d < this.n; d++) { const f = this.frames[(i - d + this.n) % this.n]; if (f) return f; }
    this.frames[i] = this.render(i);
    return this.frames[i];
  }
}

// ------------------------------------------------------------------ a big glossy-leaf floor plant

export function broadPlant(vs, seed = 4) {
  return memo('bplant|' + vs + '|' + seed, () => {
    const m = new VoxelModel(60, 70, 34);
    const pot = m.color('#f8fcff', { spec: 1.4, specPow: 18, smooth: 0.8, jitter: 0.02 });
    const band = m.color('#2fd3e8', { spec: 1.2, smooth: 0.6 });
    const soil = m.color('#5a3a2a', { jitter: 0.2 });
    const cx = 30, cz = 17, pr = 9, ph = 16;
    for (let y = 0; y <= ph; y++) {
      const t = y / ph;
      m.cylinder(cx, cz, y, y, pr * (0.74 + 0.26 * t), Math.abs(t - 0.78) < 0.08 ? band : pot);
    }
    m.cylinder(cx, cz, ph, ph + 1, pr * 0.85, soil);
    const r = new RNG(seed);
    buildLeaves(26, '#46d24a')(m, [cx, ph + 1, cz], 0, r);
    buildLeaves(20, '#5ae04a')(m, [cx - 2, ph + 1, cz + 3], 1.3, r);
    const o = renderVoxels(m, { scale: vs, yaw: 0, pitch: 24, outline: true, jitter: 0.04, ao: 1, edges: 0.7, light: LIGHT });
    return { canvas: o.canvas, ox: o.ox, oy: o.oy };
  });
}

void TAU;
