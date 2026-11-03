// Voxel models for the solid parts of the tanks (full voxel art; the glass glare stays a 2D light effect):
//   slabVox(w, h, d, vs, look, o)  rounded-end slab: tank hoods and plinths (look 'white' | 'navy' | 'silver'),
//                                  o: {led: 'top'|'bottom'|null, ledColor, foot, screws, groove, stripe, button}
//                                  -> {canvas, ox, oy}  (ox, oy = top-left of the front face in the canvas)
//   bezelVox(iw, ih, bz, vs)       the wall aquarium's glossy white bezel -> {canvas, ox, oy} (inner top-left)
//   lipVox(hw, t, vs)              the round tanks' rolled glass lip, split into {back, front} halves
//                                  -> each {canvas, ox, oy} (ox, oy = the ring's centre)
// All front-facing with the world camera (yaw 0, pitch 24), cached.

import { VoxelModel, renderVoxels } from '../gfx/voxel.js';
import { vrender } from './roomvox.js';

const DEG = Math.PI / 180, SIN = Math.sin(24 * DEG), COS = Math.cos(24 * DEG);
const cache = new Map();
const memo = (key, fn) => { let v = cache.get(key); if (!v) { v = fn(); cache.set(key, v); if (cache.size > 40) cache.delete(cache.keys().next().value); } return v; };

const LOOKS = {
  white: { top: '#ffffff', body: '#eef6fb', low: '#c4dcea', trim: '#b8cad8', o: { spec: 0.9, specPow: 16, smooth: 0.75 } },
  navy: { top: '#4a88d0', body: '#1c4a8c', low: '#0c2a5a', trim: '#6a8ab0', o: { spec: 0.9, specPow: 14, smooth: 0.7 } },
  silver: { top: '#f4f7fa', body: '#c2ccd6', low: '#7c8896', trim: '#5c6876', o: { spec: 1.6, specPow: 22, smooth: 0.65 } },
};

export function slabVox(wPx, hPx, dPx, vs, look = 'white', o = {}) {
  return memo(['slab', wPx, hPx, dPx, vs, look, JSON.stringify(o)].join('|'), () => {
    const L = LOOKS[look] || LOOKS.white;
    const nx = Math.max(4, Math.round(wPx / vs)), ny = Math.max(2, Math.round(hPx / vs / COS)), nz = Math.max(3, Math.round(dPx / vs / SIN));
    const m = new VoxelModel(nx, ny, nz);
    const top = m.color(L.top, { jitter: 0.02, ...L.o });
    const body = m.color(L.body, { jitter: 0.02, ...L.o });
    const low = m.color(L.low, { jitter: 0.02, ...L.o });
    const trim = m.color(L.trim, { jitter: 0.02, spec: 1.2, specPow: 20 });
    const led = m.color(o.ledColor || '#7ff6ff', { emissive: 0.8, jitter: 0 });
    const dark = m.color('#1a222c', { jitter: 0.02 });
    const lime = m.color('#a8ec5a', { emissive: 0.6 });
    const aqua = m.color('#2fd3e8', { spec: 0.9 });
    const r = nz / 2;
    const foot = o.foot ? Math.max(1, Math.round(ny * 0.18)) : 0;
    const inset = o.foot ? Math.max(2, Math.round(10 / vs)) : 0;
    for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) {
      // stadium footprint: rounded ends in x-z
      const ex = x + 0.5 < r ? r - x - 0.5 : x + 0.5 > nx - r ? x + 0.5 - (nx - r) : 0;
      const inBody = Math.hypot(ex, z + 0.5 - r) <= r;
      const exF = x + 0.5 < r + inset ? r + inset - x - 0.5 : x + 0.5 > nx - r - inset ? x + 0.5 - (nx - r - inset) : 0;
      const inFoot = Math.hypot(exF, z + 0.5 - r) <= r * 0.92;
      for (let y = 0; y < ny; y++) {
        const isFoot = y < foot;
        if (isFoot ? !inFoot : !inBody) continue;
        let c = y === ny - 1 ? top : y < ny * 0.3 ? low : body;
        const front = z === nz - 1 || Math.hypot(ex, z + 1.5 - r) > r;
        if (isFoot) c = trim;
        else if (front) {
          const t = (y - foot) / Math.max(1, ny - foot - 1);
          if (o.led === 'bottom' && y === foot) c = led;
          if (o.led === 'top' && y === ny - 1) c = led;
          if (o.groove && Math.abs(t - 0.82) < 0.5 / ny) c = trim;
          if (o.stripe && Math.abs(t - 0.4) < 0.6 / ny) c = aqua;
        }
        m.set(x, y, z, c);
      }
    }
    if (o.screws) for (const sx of [Math.round(nx * 0.05) + 2, nx - Math.round(nx * 0.05) - 3]) m.set(sx, Math.round(ny * 0.7), nz - 1, trim);
    if (o.button) m.set(nx - Math.round(8 / vs) - 2, Math.round(ny * 0.55), nz - 1, lime), m.set(nx - Math.round(8 / vs) - 1, Math.round(ny * 0.55), nz - 1, lime);
    if (o.well) {
      // recessed well for the rocker switch (drawn live): o.well = [x fraction, width px, height px]
      const [fx, ww, wh] = o.well;
      const wx = Math.round(nx * fx), wwV = Math.max(3, Math.round(ww / vs)), whV = Math.max(2, Math.round(wh / vs / COS));
      const wy = Math.round(foot + (ny - foot) * 0.45 - whV / 2);
      m.box(wx - 1, wy - 1, nz - 2, wx + wwV, wy + whV, nz - 1, dark);
    }
    const rr = vrender(m, vs, { ao: 0.8, edges: 0.75, outline: true });
    const p = rr.project(0, ny, nz);
    const out = { canvas: rr.canvas, ox: Math.round(p[0]), oy: Math.round(p[1]) };
    if (o.well) {
      const [fx, ww, wh] = o.well;
      const wwV = Math.max(3, Math.round(ww / vs)), whV = Math.max(2, Math.round(wh / vs / COS));
      const wy = Math.round(foot + (ny - foot) * 0.45 - whV / 2);
      const q = rr.project(Math.round(nx * fx), wy + whV, nz);
      out.well = { x: Math.round(q[0]) - out.ox, y: Math.round(q[1]) - out.oy, w: wwV * vs, h: Math.round(whV * vs * COS) };
    }
    return out;
  });
}

export function bezelVox(iw, ih, bz, vs) {
  return memo(['bez', iw, ih, bz, vs].join('|'), () => {
    const b = Math.max(2, Math.round(bz / vs));
    const nx = Math.round(iw / vs) + b * 2, ny = Math.round((ih / vs) / COS) + b * 2, nz = 6;
    const m = new VoxelModel(nx, ny, nz);
    const white = m.color('#f8fcff', { jitter: 0.02, spec: 0.9, specPow: 16, smooth: 0.75 });
    const trim = m.color('#b8cad8', { jitter: 0.02, spec: 1.4, specPow: 20 });
    const led = m.color('#7ff6ff', { emissive: 0.8 });
    const R = Math.max(2, Math.round(b * 0.9));
    for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
      const cx = x < R ? R : x > nx - 1 - R ? nx - 1 - R : x, cy = y < R ? R : y > ny - 1 - R ? ny - 1 - R : y;
      if (Math.hypot(x - cx, y - cy) > R) continue;
      const inner = x >= b && x < nx - b && y >= b && y < ny - b;
      if (inner) continue;
      const edge = x === b - 1 || x === nx - b || y === b - 1 || y === ny - b;
      for (let z = 0; z < (edge ? nz - 1 : nz); z++) m.set(x, y, z, edge ? trim : y === Math.round(b * 0.5) && x > b && x < nx - b ? led : white);
    }
    const r = vrender(m, vs, { ao: 0.8, edges: 0.7, outline: true });
    const p = r.project(b, ny - b, nz);
    return { canvas: r.canvas, ox: Math.round(p[0]), oy: Math.round(p[1]) };
  });
}

export function lipVox(hwPx, tPx, vs) {
  return memo(['lip', hwPx, tPx, vs].join('|'), () => {
    const R = Math.max(4, Math.round(hwPx / vs)), t = Math.max(1, tPx / vs / 2);
    const S = Math.ceil((R + t) * 2) + 2, H = Math.ceil(t * 2) + 2;
    const m = new VoxelModel(S, H, S);
    const glass = m.color('#d8fff6', { jitter: 0.02, spec: 1.5, specPow: 24, smooth: 0.95 });
    const glassD = m.color('#7fe2cc', { jitter: 0.02, spec: 1.2, specPow: 20, smooth: 0.9 });
    const c = S / 2, cy = H / 2;
    for (let z = 0; z < S; z++) for (let y = 0; y < H; y++) for (let x = 0; x < S; x++) {
      const d = Math.hypot(x + 0.5 - c, z + 0.5 - c) - R;
      if (Math.hypot(d, y + 0.5 - cy) > t) continue;
      m.set(x, y, z, y + 0.5 > cy ? glass : glassD);
    }
    const half = (front) => {
      // the globe tanks are seen only slightly from above (their surface reads as a thin ellipse)
      const r = renderVoxels(m, { scale: vs, yaw: 0, pitch: 8, outline: true, jitter: 0.02, ao: 0.4, edges: 0.6, light: { top: 5.6, lit: 4.4, dark: 3, bottom: 2 }, keepVoxel: (x, y, z) => (z + 0.5 >= c) === front });
      const p = r.project(c, cy, c);
      return { canvas: r.canvas, ox: Math.round(p[0]), oy: Math.round(p[1]) };
    };
    return { back: half(false), front: half(true) };
  });
}
