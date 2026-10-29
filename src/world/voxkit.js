// Small voxel toolkit for the world: model rotation/mirroring, id-derived overlays, and a strip compositor that
// lays voxel sprites into wide parallax layers (back to front).

import { VoxelModel, renderVoxels } from '../gfx/voxel.js';
import { makeCanvas, ctxOf } from '../core/canvas.js';
import { pack } from '../core/color.js';

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

// Render helper returning the renderVoxels result plus a projector for model points.
export function renderModel(m, opts) {
  return renderVoxels(m, { scale: 2, yaw: 0, pitch: 20, outline: true, ...opts });
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
