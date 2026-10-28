// Voxel woodwork for the tank: a cabinet frame (lid with lamp, posts, base) around the glass for the
// floating window / mini tank, and a lamp-hood rim plus corner posts for the full-screen view.
// Built as voxel models (2 px voxels) with brass trim, rivets, planks and an emissive lamp strip,
// rendered front-on with a touch of pitch so trims catch the light.

import { VoxelModel, renderVoxels } from '../gfx/voxel.js';
import { hash2 } from '../core/math.js';

const V = 2;

function woodPal(m) {
  return {
    wood: [m.color('#6e3c22', { jitter: 0.1 }), m.color('#82492a', { jitter: 0.1 }), m.color('#9a5a34', { jitter: 0.08 })],
    seam: m.color('#3a1e14', { jitter: 0.04 }),
    brass: m.color('#d8a83a', { jitter: 0.04, spec: 1.2, specPow: 12 }),
    brassD: m.color('#a27420', { jitter: 0.04, spec: 0.6 }),
    rivet: m.color('#fff2b0', { jitter: 0, spec: 1.6 }),
    lamp: m.color('#fff0c0', { emissive: 1, jitter: 0 }),
    dark: m.color('#24140e', { jitter: 0.03 }),
  };
}

function woodAt(P, x, y, horiz) {
  const along = horiz ? x : y, across = horiz ? y : x;
  const plank = Math.floor(along / 23 + hash2(Math.floor(across / 4), 0, 3) * 2);
  if ((along + Math.floor(hash2(plank, Math.floor(across / 4), 1) * 23)) % 23 === 0) return P.seam;
  const g = Math.sin(along * 0.31 + Math.sin(across * 1.3 + plank) * 1.5) + hash2(along, across, 7) * 0.6;
  return P.wood[g > 0.7 ? 2 : g < -0.6 ? 0 : 1];
}

// Cabinet frame around an inner glass rect. Sizes in px; returns {canvas, glow, dx, dy} where
// (dx, dy) places the canvas relative to the frame's top-left so the glass hole lines up.
export function voxCabinet(w, h, lid, side, base) {
  const nx = Math.round(w / V), ny = Math.round(h / V), nz = 7;
  const L = Math.round(lid / V), S = Math.round(side / V), B = Math.round(base / V);
  const m = new VoxelModel(nx, ny, nz);
  const P = woodPal(m);
  const top = ny - 1; // model y is up
  for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    const gy = top - y; // rows from the top
    const inLid = gy < L, inBase = gy >= ny - B, inSide = x < S || x >= nx - S;
    if (!(inLid || inBase || inSide)) continue;
    let depth = 5;
    if (inLid && gy === 0) depth = 4; // bevelled top edge
    if (inBase && gy === ny - 1) depth = 4;
    for (let z = 0; z <= depth; z++) m.set(x, y, z, woodAt(P, x, gy, inLid || inBase));
    // brass trim strips: under the lid, on top of the base, framing the glass
    const trimLid = inLid && gy === L - 1, trimBase = inBase && gy === ny - B;
    const trimSide = inSide && !inLid && !inBase && (x === S - 1 || x === nx - S);
    if (trimLid || trimBase || trimSide) m.set(x, y, 6, (x + gy) % 9 === 0 ? P.rivet : P.brass);
    // a plank groove across the lid and the cabinet
    if ((inLid && gy === Math.floor(L / 2)) || (inBase && gy === ny - B + Math.floor(B / 2) + 1)) m.set(x, y, 5, P.dark);
  }
  // brass corner caps (raised, with a rivet)
  const cap = (x0, gy0) => {
    for (let gy = gy0; gy < gy0 + 4; gy++) for (let x = x0; x < x0 + 4; x++) {
      const y = top - gy;
      if (y < 0 || y >= ny || x < 0 || x >= nx) continue;
      m.set(x, y, 6, P.brass);
      if (gy === gy0 || x === x0) m.set(x, y, 6, P.brassD);
    }
    m.set(x0 + 2, top - gy0 - 1, 6, P.rivet);
  };
  cap(0, L - 2); cap(nx - 4, L - 2); cap(0, ny - B - 2); cap(nx - 4, ny - B - 2);
  // lamp strip under the lid (emissive, recessed)
  for (let x = S; x < nx - S; x++) m.set(x, top - (L - 1), 3, P.lamp);
  // little brass feet
  for (const fx of [S + 2, nx - S - 5]) for (let x = fx; x < fx + 3; x++) m.set(x, 0, 6, P.brassD);
  const r = renderVoxels(m, { scale: V, yaw: 0, pitch: 7, ao: 1.1, edges: 0.8, sideEdges: 0.5, groundAO: false, glowRadius: 2 });
  const [px, py] = r.project(0, ny, 7);
  return { canvas: r.canvas, glow: r.glow, dx: -Math.round(px), dy: -Math.round(py) };
}

// Full-screen view: a lamp hood across the top and slim posts at the screen edges.
export function voxRim(W, H, rimH = 18, postW = 10) {
  const nx = Math.round(W / V), ry = Math.round(rimH / V), nz = 6;
  const m = new VoxelModel(nx, ry, nz);
  const P = woodPal(m);
  for (let gy = 0; gy < ry; gy++) for (let x = 0; x < nx; x++) {
    const y = ry - 1 - gy;
    for (let z = 0; z <= (gy === 0 ? 3 : 4); z++) m.set(x, y, z, woodAt(P, x, gy, true));
    if (gy === ry - 1) m.set(x, y, 5, (x % 24 === 6) ? P.rivet : P.brass);
    if (gy === ry - 2 && x % 24 === 6) m.set(x, y, 5, P.brassD);
  }
  for (let x = 4; x < nx - 4; x++) m.set(x, 0, 1, P.lamp);
  const top = renderVoxels(m, { scale: V, yaw: 0, pitch: -6, ao: 1.1, edges: 0.8, groundAO: false, glowRadius: 2 });
  const [tx, ty] = top.project(0, ry, 6);
  // posts
  const pn = Math.round(postW / V), ph = Math.round(H / V);
  const pm = new VoxelModel(pn + 1, ph, 5);
  const Q = woodPal(pm);
  for (let y = 0; y < ph; y++) for (let x = 0; x < pn + 1; x++) {
    const gy = ph - 1 - y;
    if (x === pn) { pm.set(x, y, 4, Q.brassD); continue; }
    for (let z = 0; z <= 3; z++) pm.set(x, y, z, woodAt(Q, x, gy, false));
    if (x === pn - 1) pm.set(x, y, 4, (gy % 26 === 13) ? Q.rivet : Q.brass);
  }
  const post = renderVoxels(pm, { scale: V, yaw: 0, pitch: 0, ao: 1, edges: 0.7, groundAO: false });
  const [qx, qy] = post.project(0, ph, 5);
  return {
    top: { canvas: top.canvas, glow: top.glow, dx: -Math.round(tx), dy: -Math.round(ty) },
    post: { canvas: post.canvas, dx: -Math.round(qx), dy: -Math.round(qy) },
  };
}
