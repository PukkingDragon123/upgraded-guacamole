// Fish thumbnails for icons, glyphs, backdrops and lists (phase 8: VOXEL renders via lowpolyfish.js + voxelize.js).
//   voxelFishIcon(sp | speciesId | null, w, h = w, {dir: 1|-1, tint: hex, yaw}) -> canvas (w x h, transparent)
//   A voxel render of the species (default: the Noobikarp), fitted and centred in the box, cached.
//   tint (+ tintA, default 0.6): a colour wash over the render that keeps its shading (far-away fish,
//   silhouettes); dir -1 faces left. Name kept for existing callers; lowpolyFishIcon is the same function.

import { lpFishIcon } from './lowpolyfish.js';

export function voxelFishIcon(sp, w, h = w, o = {}) {
  return lpFishIcon(sp, w, h, o);
}
export { voxelFishIcon as lowpolyFishIcon };
