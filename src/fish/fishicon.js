// Voxel fish thumbnails for icons, glyphs, backdrops and lists (FULL VOXEL ART: never a flat 2D fish).
//   voxelFishIcon(sp | speciesId | null, w, h = w, {dir: 1|-1, tint: hex, yaw}) -> canvas (w x h, transparent)
//   A real voxel render of the species (default: the Noobikarp), fitted and centred in the box, cached.
//   tint (+ tintA, default 0.6): a colour wash over the voxel render that keeps its shading (far-away fish,
//   silhouettes); dir -1 faces left.

import { SPECIES_BY_ID } from './species.js';
import { compiled } from '../gfx/spritecache.js';
import { voxelFrame } from '../gfx/voxelfish.js';
import { rigGeom } from '../gfx/fishart.js';
import { makeCanvas, ctxOf } from '../core/canvas.js';
import { voxelWash } from '../gfx/fishrig.js';

const cache = new Map();

export function voxelFishIcon(sp, w, h = w, o = {}) {
  sp = (typeof sp === 'string' ? SPECIES_BY_ID[sp] : sp) || SPECIES_BY_ID.pixel;
  if (!sp) return null;
  w = Math.max(4, Math.round(w)); h = Math.max(4, Math.round(h));
  const dir = o.dir < 0 ? -1 : 1;
  const key = `${sp.id}|${w}x${h}|${dir}|${o.tint || ''}|${o.tintA ?? ''}|${o.yaw ?? 15}`;
  let cv = cache.get(key);
  if (cv !== undefined) return cv;
  const c = compiled(sp.look, null, sp.id);
  const g = rigGeom(c, { sw: 0, angle: 0, scale: 1, inflate: 0, still: true });
  const S = Math.max(0.08, Math.min(w / (g.w * 0.82), h / (g.h * 0.82)));
  const res = voxelFrame(c, { S, yaw: o.yaw ?? 15, pitch: 0, sw: 1, infl: 0, pose: false, lod: 0, pri: 3, force: true });
  if (!res) return null;
  const f = res.f;
  const src = f.canvas;
  const k = Math.min(res.k, w / src.width, h / src.height);
  cv = makeCanvas(w, h);
  const x = ctxOf(cv);
  const dw = Math.round(src.width * k), dh = Math.round(src.height * k);
  x.save();
  x.translate(Math.round((w - dw) / 2) + (dir < 0 ? dw : 0), Math.round((h - dh) / 2));
  if (dir < 0) x.scale(-1, 1);
  x.drawImage(src, 0, 0, dw, dh);
  x.restore();
  if (o.tint) cv = voxelWash(cv, o.tint, o.tintA ?? 0.6);
  cache.set(key, cv);
  if (cache.size > 300) cache.delete(cache.keys().next().value);
  return cv;
}
