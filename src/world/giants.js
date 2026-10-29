// Distant voxel giants that cruise through the far water: a humpback whale (tail-beat cycle) and a green sea
// turtle (flipper strokes). Frames are voxel models re-posed per phase and rendered lazily, one per call to
// warm(), so the first sighting never stalls a frame; drawing falls back to the nearest built frame.

import { VoxelModel } from '../gfx/voxel.js';
import { smoothstep, hash3, TAU } from '../core/math.js';
import { flipCanvas } from '../gfx/pixel.js';
import { renderModel } from './voxkit.js';

const sm = smoothstep;

function whaleModel(ph) {
  const L = 96, R = 13;
  const m = new VoxelModel(L + 6, 2 * R + 40, 2 * R + 30);
  const C = (c, o = {}) => m.color(c, { jitter: 0.08, ...o });
  const back = C('#34445e'), side = C('#4a5c7c'), belly = C('#c4ccd8'), groove = C('#8e98aa'), fin = C('#d4dae4'), finD = C('#3a4a66'), eye = C('#0e1218'), barn = C('#d8d2c2');
  const cy = m.ny / 2 + 4, cz = m.nz / 2;
  const flex = (u) => Math.sin(ph) * Math.pow(Math.max(0, 0.5 - u), 1.5) * 30;
  for (let x = 0; x < L; x++) {
    const u = x / L;
    const r = R * (0.1 + 0.9 * sm(0.04, 0.42, u)) * (1 - sm(0.86, 1.0, u) * 0.45);
    const yc = cy + flex(u) - Math.max(0, u - 0.8) * 8;
    for (let y = Math.floor(yc - r); y <= Math.ceil(yc + r); y++) for (let z = Math.floor(cz - r); z <= Math.ceil(cz + r); z++) {
      const dy = (y + 0.5 - yc) / r, dz = (z + 0.5 - cz) / (r * 0.86);
      if (dy * dy + dz * dz > 1) continue;
      let c = dy > 0.15 ? back : side;
      if (dy < -0.3) c = u > 0.55 && (y + x) % 3 === 0 ? groove : belly;
      if (u > 0.82 && dy > 0.45 && hash3(x, y, z, 4) < 0.08) c = barn;
      m.set(x, y, z, c);
    }
    if (u > 0.33 && u < 0.38) m.set(x, Math.round(yc + r), cz, finD);
  }
  // flukes
  const fy = cy + flex(0);
  for (let x = 0; x < 9; x++) {
    const k = x / 9, span = (R + 8) * (1 - Math.abs(k - 0.35) * 1.2);
    for (let z = Math.floor(cz - span); z <= Math.ceil(cz + span); z++) { m.set(x, Math.round(fy), z, finD); if (k > 0.3) m.set(x, Math.round(fy) + 1, z, finD); }
  }
  // long pectoral fins (humpback), white underside
  const px = Math.round(L * 0.64), pr = R * 0.9;
  for (const side of [-1, 1]) m.line(px, cy - 3, cz + side * pr * 0.8, px - 20, cy - 16 + Math.sin(ph + 1) * 3, cz + side * (pr + 8), side > 0 ? fin : finD, 1.6);
  m.set(Math.round(L * 0.9), Math.round(cy - 2), Math.round(cz + R * 0.55), eye);
  return m;
}

function turtleModel(ph) {
  const m = new VoxelModel(50, 30, 36);
  const C = (c, o = {}) => m.color(c, { jitter: 0.1, ...o });
  const shellA = C('#7a6436'), shellB = C('#5e4c2a'), seam = C('#3a2e1c'), plast = C('#d8c89a'), skin = C('#6e8a5a'), skinD = C('#4e6a44'), spot = C('#c8d0a0'), eye = C('#101010');
  const cx = 22, cy = 13, cz = 18;
  m.ellipsoid(cx, cy, cz, 15, 7, 12, (x, y, z) => {
    if (y < cy - 1) return plast;
    const cell = Math.floor((x + 2) / 6) * 7 + Math.floor((z + 1) / 6);
    const onSeam = (x + 2) % 6 === 0 || (z + 1) % 6 === 0;
    return onSeam && y > cy ? seam : cell % 2 ? shellA : shellB;
  });
  m.sub(() => m.box(0, 0, 0, 49, cy - 3, 35, 1));
  m.ellipsoid(cx, cy - 2, cz, 14, 2, 11, plast);
  // neck + head
  m.line(cx + 12, cy - 1, cz, cx + 18, cy, cz, skinD, 2.2);
  m.ellipsoid(cx + 21, cy + 0.5, cz, 4, 3, 3, (x, y, z) => ((x + y + z) % 4 === 0 ? spot : skin));
  m.set(cx + 23, cy + 1, cz + 3, eye); m.set(cx + 23, cy + 1, cz - 3, eye);
  // front flippers sweep down and back, rear flippers paddle
  const a = 0.25 + (Math.sin(ph) * 0.5 + 0.5) * 1.05;
  for (const side of [-1, 1]) {
    const rx = cx + 8, rz = cz + side * 9;
    const tx = rx - Math.cos(a) * 15, ty = cy - 1 - Math.sin(a) * 11, tz = rz + side * (5 + Math.cos(a) * 4);
    m.line(rx, cy - 1, rz, (rx + tx) / 2, (cy - 1 + ty) / 2, (rz + tz) / 2, skin, 2.2);
    m.line((rx + tx) / 2, (cy - 1 + ty) / 2, (rz + tz) / 2, tx, ty, tz, skinD, 1.2);
    const b = Math.sin(ph + 2) * 0.35;
    m.line(cx - 11, cy - 2, cz + side * 7, cx - 17, cy - 3 + b * 4, cz + side * 9, skinD, 1.4);
  }
  return m;
}

const BUILD = {
  whale: { n: 8, model: whaleModel, render: { scale: 2, yaw: 22, pitch: 10, jitter: 0.1 } },
  turtle: { n: 10, model: turtleModel, render: { scale: 2, yaw: 18, pitch: 20, jitter: 0.12 } },
};

export class VoxelGiant {
  constructor(kind) {
    this.kind = kind;
    this.B = BUILD[kind];
    this.frames = new Array(this.B.n).fill(null);
    this.flipped = new Array(this.B.n).fill(null);
  }

  get n() { return this.B.n; }

  build(i) {
    const r = renderModel(this.B.model((i / this.B.n) * TAU), this.B.render);
    this.frames[i] = { canvas: r.canvas, ox: Math.round(r.w / 2), oy: Math.round(r.h / 2) };
  }

  // Build at most one missing frame (call once per update).
  warm() {
    const i = this.frames.indexOf(null);
    if (i >= 0) this.build(i);
  }

  frame(ph, dir) {
    let i = Math.floor(((ph / TAU) * this.B.n) % this.B.n + this.B.n) % this.B.n;
    if (!this.frames[i]) {
      if (this.frames.every((f) => !f)) this.build(i);
      else { for (let d = 1; d < this.B.n; d++) { const j = (i + d) % this.B.n; if (this.frames[j]) { i = j; break; } } }
    }
    const f = this.frames[i];
    if (dir > 0) return f;
    if (!this.flipped[i]) this.flipped[i] = { canvas: flipCanvas(f.canvas), ox: f.canvas.width - f.ox, oy: f.oy };
    return this.flipped[i];
  }
}
