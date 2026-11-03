// renderVoxels(m, opts) spread over several frames: a generator that renders the model in x-slabs (yielding between
// them) and composites them into one canvas. The world camera has yaw 0, so view rays never cross x: slabs overlap
// by a small margin that is cropped away, and every slab shares the full model's y / z bounds, so all slab pixel
// grids line up and outlines, depth lines and shading match a single render (AO may differ right at a seam).
// Returns {canvas, ox, oy, w, h, project} like renderVoxels (no glow / regions / ids). Any other yaw, or a pixel
// scale that cannot keep slab grids aligned, falls back to one renderVoxels call.

import { VoxelModel, renderVoxels } from '../gfx/voxel.js';
import { makeCanvas, ctxOf } from '../core/canvas.js';

export function* renderSteps(m, opts = {}, slabPx = 40) {
  const b = m.bounds();
  yield;
  if (!b) return { canvas: makeCanvas(1, 1), ox: 0, oy: 0, w: 1, h: 1, project: () => [0, 0] };
  const s = opts.scale ?? 2;
  // slab boundaries must fall on whole pixels: x steps of k voxels with k * s integral
  let k = 0;
  for (let q = 1; q <= 20; q++) if (Math.abs(q * s - Math.round(q * s)) < 1e-6) { k = q; break; }
  if (Math.abs(opts.yaw ?? 32) > 1e-6 || !k) return renderVoxels(m, opts);
  const slab = Math.max(k, Math.round(slabPx / s / k) * k);
  const M = k * Math.ceil(2 / k);
  const { nx, ny, data } = m;
  let full = null, g = null, pad = 0, H = 0, proj = null;
  for (let xa = b.x0; xa <= b.x1; xa += slab) {
    const xb = Math.min(b.x1, xa + slab - 1);
    const sa = xa - M, sb = xb + M, sw = sb - sa + 1;
    const sub = new VoxelModel(sw, ny, m.nz);
    sub.palette = m.palette;
    const sd = sub.data;
    const lo = Math.max(0, sa), hi = Math.min(nx - 1, sb);
    for (let z = b.z0; z <= b.z1; z++) for (let y = b.y0; y <= b.y1; y++) {
      const row = nx * (y + ny * z);
      sd.set(data.subarray(row + lo, row + hi + 1), sw * (y + ny * z) + (lo - sa));
    }
    const bb = { x0: 0, x1: sw - 1, y0: b.y0, y1: b.y1, z0: b.z0, z1: b.z1 };
    sub.bounds = () => bb;
    const r = renderVoxels(sub, opts);
    if (!full) {
      pad = Math.round(r.project(0, 0, 0)[0]);
      H = r.h;
      full = makeCanvas(Math.round((b.x1 + 1 - b.x0) * s) + pad * 2, H);
      g = ctxOf(full);
      const p0 = r.project;
      proj = (x, y, z) => { const p = p0(x - sa, y, z); return [p[0] + (sa - b.x0) * s, p[1]]; };
    }
    // columns for model x in [xa, xb + 1) (+ the outer pads on the first / last slab)
    let src = Math.round((xa - sa) * s) + pad, dst = Math.round((xa - b.x0) * s) + pad;
    let w = Math.round((xb + 1 - xa) * s);
    if (xa === b.x0) { src -= pad; dst -= pad; w += pad; }
    if (xb === b.x1) w += pad;
    g.drawImage(r.canvas, src, 0, w, H, dst, 0, w, H);
    yield;
  }
  const fx = (b.x0 + b.x1 + 1) / 2, fy = b.y0, fz = (b.z0 + b.z1 + 1) / 2;
  const [ax, ay] = proj(fx, fy, fz);
  return { canvas: full, ox: Math.round(ax), oy: Math.round(ay), w: full.width, h: H, project: proj };
}

// Run a step generator to completion (synchronous use).
export function runSteps(it) {
  let r = it.next();
  while (!r.done) r = it.next();
  return r.value;
}
