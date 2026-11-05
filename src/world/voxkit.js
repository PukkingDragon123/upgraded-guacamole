// Small voxel toolkit for the world: model rotation/mirroring, id-derived overlays, and a strip compositor that
// lays voxel sprites into wide parallax layers (back to front).

import { VoxelModel, renderVoxels } from '../gfx/voxel.js';
import { getProp, getPropSteps } from '../gfx/props.js';
import { makeCanvas, ctxOf } from '../core/canvas.js';
import { pack } from '../core/color.js';

// ONE camera for the whole world diorama: every voxel element (terrain props, coral, rocks, far formations,
// horizon, clouds, the boat) is rendered front-facing (yaw 0, edges level with the screen) with the same slight
// downward pitch, so nothing looks rotated against the level seabed. Depth comes from the receding floor,
// perspective scale and fog only.
export const WORLD_YAW = 0;
export const WORLD_PITCH = 24;
const HI_R = 3; // [phase6:oceans] the ~3x camera: library props get a 3x twin

// Library prop rendered with the world camera.
export function worldProp(id, opts = {}) {
  const p = getProp(id, { ...opts, yaw: WORLD_YAW, pitch: WORLD_PITCH });
  // p.hi(): rendered at HI_R x the pixel scale for the zoomed-in camera (DepthScene hi-res pass; p.hiR tells it)
  if (p && !p.hi) {
    const hiOpts = { ...opts, scale: (opts.scale ?? 1) * HI_R, yaw: WORLD_YAW, pitch: WORLD_PITCH };
    Object.defineProperty(p, 'hi', { value: () => worldProp(id, hiOpts), enumerable: false, configurable: true });
    Object.defineProperty(p, 'hiSteps', { value: () => getPropSteps(id, hiOpts), enumerable: false, configurable: true });
    Object.defineProperty(p, 'hiR', { value: HI_R, enumerable: false, configurable: true });
  }
  return p;
}

// Rotate a model about the z axis (screen-plane roll) around (px, py) in voxel units. Positive degrees lift +x.
// Returns { model, map(x, y) -> [x', y'] } (map transforms anchor points into the rotated model).
export function rollModel(m, deg, px, py) {
  const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  if (Math.abs(deg) < 1e-3) return { model: m, map: (x, y) => [x, y] };
  const padX = Math.ceil(Math.abs(s) * m.ny) + 1, padY = Math.ceil(Math.abs(s) * m.nx) + 1;
  const out = new VoxelModel(m.nx + padX * 2, m.ny + padY * 2, m.nz);
  out.palette = m.palette;
  const { nx, ny, nz } = m;
  const src = m.data, dst = out.data, onx = out.nx, ony = out.ny;
  for (let Y = 0; Y < ony; Y++) {
    for (let X = 0; X < onx; X++) {
      const dx = X - padX + 0.5 - px, dy = Y - padY + 0.5 - py;
      const sx = Math.floor(px + dx * c + dy * s), sy = Math.floor(py - dx * s + dy * c);
      if (sx < 0 || sy < 0 || sx >= nx || sy >= ny) continue;
      for (let z = 0; z < nz; z++) {
        const v = src[sx + nx * (sy + ny * z)];
        if (v) dst[X + onx * (Y + ony * z)] = v;
      }
    }
  }
  const map = (x, y) => {
    const dx = x - px, dy = y - py;
    return [px + dx * c - dy * s + padX, py + dx * s + dy * c + padY];
  };
  return { model: out, map };
}

// Mirror a model along x (shares the palette).
export function mirrorModel(m) {
  const out = new VoxelModel(m.nx, m.ny, m.nz);
  out.palette = m.palette;
  const { nx, ny, nz } = m;
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) {
    const row = nx * (y + ny * z);
    for (let x = 0; x < nx; x++) out.data[row + nx - 1 - x] = m.data[row + x];
  }
  return out;
}

// Copy of `canvas` keeping only pixels whose voxel id is in `set` (+ their outline ring when `ring`).
export function idOverlay(r, set, ring = true) {
  const { w, h, ids } = r;
  const src = ctxOf(r.canvas).getImageData(0, 0, w, h);
  const s32 = new Uint32Array(src.data.buffer);
  const c = makeCanvas(w, h);
  const g = ctxOf(c);
  const img = g.createImageData(w, h);
  const d = new Uint32Array(img.data.buffer);
  let any = false;
  for (let p = 0; p < w * h; p++) {
    if (set.has(ids[p])) { d[p] = s32[p]; any = true; continue; }
    if (!ring || ids[p] || !s32[p]) continue;
    const x = p % w, y = (p / w) | 0;
    if ((x > 0 && set.has(ids[p - 1])) || (x < w - 1 && set.has(ids[p + 1])) || (y > 0 && set.has(ids[p - w])) || (y < h - 1 && set.has(ids[p + w]))) d[p] = s32[p];
  }
  if (!any) return null;
  g.putImageData(img, 0, 0);
  return c;
}

// Solid-colour mask of pixels whose voxel id maps to a colour in `colors` (Map id -> hex).
export function idPaint(r, colors) {
  const { w, h, ids } = r;
  const c = makeCanvas(w, h);
  const g = ctxOf(c);
  const img = g.createImageData(w, h);
  const d = new Uint32Array(img.data.buffer);
  const packed = new Map([...colors].map(([k, v]) => [k, pack(v) >>> 0]));
  let any = false;
  for (let p = 0; p < w * h; p++) {
    const v = packed.get(ids[p]);
    if (v !== undefined) { d[p] = v; any = true; }
  }
  if (!any) return null;
  g.putImageData(img, 0, 0);
  return c;
}

// Render helper (world camera enforced) returning the renderVoxels result plus a projector for model points.
export function renderModel(m, opts = {}) {
  return renderVoxels(m, { scale: 2, outline: true, ...opts, yaw: WORLD_YAW, pitch: opts.flat ? 0 : WORLD_PITCH });
}

// Lay sprites ({canvas, ox, oy}) into a strip: items [{sprite, x, y, z}] drawn far (high z) to near.
export function composeStrip(w, h, items) {
  const c = makeCanvas(w, h);
  const g = ctxOf(c);
  items.sort((a, b) => b.z - a.z);
  for (const it of items) {
    const s = it.sprite;
    g.drawImage(s.canvas, Math.round(it.x - s.ox), Math.round(it.y - s.oy));
  }
  return c;
}

// Relief-voxelize a pixel image: every `cell` x `cell` block becomes a voxel column extruded toward the viewer by
// depth(r, g, b, x, y) voxels (1..maxD; 0 = empty), then rendered with the world camera, so painted panoramas and
// tiny pixel sprites become real voxel relief (outlines, AO, lit top faces on every ledge). Colours are quantised
// into the model palette (<= 250 entries). Returns {canvas, w, h, ox, oy} where (ox, oy) is where the source
// image's top-left corner lands (draw at x - ox, y - oy to line it up with the original).
export function voxelize(src, { cell = 2, depth = () => 3, maxD = 8, alignZ = null, render = {} } = {}) {
  const w = src.width, h = src.height;
  const d = src.getContext ? src.getContext('2d').getImageData(0, 0, w, h).data : src.data;
  // the world camera's pitch foreshortens heights by cos(pitch): sample rows a little closer so the voxel relief
  // keeps the source's proportions on screen
  const rowStep = cell * Math.cos((WORLD_PITCH * Math.PI) / 180);
  const nx = Math.ceil(w / cell), ny = Math.ceil(h / rowStep);
  const rowY = (cy) => Math.min(h - 1, Math.floor((cy + 0.5) * rowStep));
  const m = new VoxelModel(nx, ny, maxD);
  const pal = new Map();
  let shift = 3;
  const keyOf = (r, g, b) => ((r >> shift) << 16) | ((g >> shift) << 8) | (b >> shift);
  // pass 1: count colours, coarsen until they fit the palette
  for (let tries = 0; tries < 3; tries++) {
    const seen = new Set();
    for (let cy = 0; cy < ny; cy++) for (let cx = 0; cx < nx; cx++) {
      const i = (rowY(cy) * w + Math.min(w - 1, cx * cell + (cell >> 1))) * 4;
      if (d[i + 3] > 110) seen.add(keyOf(d[i], d[i + 1], d[i + 2]));
    }
    if (seen.size <= 240) break;
    shift++;
  }
  for (let cy = 0; cy < ny; cy++) for (let cx = 0; cx < nx; cx++) {
    const px = Math.min(w - 1, cx * cell + (cell >> 1)), py = rowY(cy);
    const i = (py * w + px) * 4;
    if (d[i + 3] <= 110) continue;
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const k = keyOf(r, g, b);
    let id = pal.get(k);
    if (id === undefined) {
      if (pal.size >= 250) { id = pal.values().next().value; } else {
        const q = (v) => Math.min(255, (v >> shift << shift) + (1 << (shift - 1)));
        const hex = '#' + [q(r), q(g), q(b)].map((v) => v.toString(16).padStart(2, '0')).join('');
        id = m.color(hex, { jitter: 0.03 });
        pal.set(k, id);
      }
    }
    const dz = Math.max(0, Math.min(maxD, Math.round(depth(r, g, b, px, py))));
    const y = ny - 1 - cy;
    for (let z = 0; z < dz; z++) m.set(cx, y, z, id);
  }
  const rr = renderVoxels(m, { scale: cell, outline: true, jitter: 0.03, ao: 0.7, edges: 0.45, light: { top: 4.6, lit: 3.4, dark: 2.6, bottom: 1.6 }, ...render, yaw: WORLD_YAW, pitch: WORLD_PITCH });
  const az = alignZ ?? Math.ceil(maxD / 2);
  const p = rr.project(0, ny, az);
  return { canvas: rr.canvas, w: rr.w, h: rr.h, ox: Math.round(p[0]), oy: Math.round(p[1]) };
}

// voxelize() composited back onto a canvas of the source size (drop-in replacement for a painted layer).
export const lumDepth = (lo = 2, hi = 5) => (r, g, b) => lo + Math.round(((r * 0.3 + g * 0.55 + b * 0.15) / 255) * (hi - lo));
export function voxRelief(src, opts = {}) {
  const v = voxelize(src, { cell: 2, maxD: 6, depth: lumDepth(2, 5), ...opts });
  const c = makeCanvas(src.width, src.height);
  ctxOf(c).drawImage(v.canvas, -v.ox, -v.oy);
  return c;
}
