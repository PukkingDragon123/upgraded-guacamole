// Small voxel creatures and helpers for the ocean backdrops (phase 3 "full voxel art" rule): everything here is a
// voxel model rendered once with the shared world camera (front-facing, voxkit.renderModel) and cached.
//
//   gullFrames(tint)            3 wing frames of a little voxel gull (wings up / level / down), cute cartoon eye
//   voxBall(r, color, o)        glossy voxel sphere sprite {canvas, ox, oy} (o.emissive, o.spec)
//   voxPixelSprite(src, depth)  extrude a pixel sprite into voxels (cell 1) -> canvas padded by 2 px each side
//   voxCloudSprite(seed, w, h)  a voxel cumulus (sky.js cloud model) in one palette -> canvas
//   bgFish(biome)               compiled species looks for background fish (low-poly 3D via fishrig) // [phase6:creatures]
//   drawBgFish(ctx, c, x, y, o) draw one background fish with the low-poly fish rig (o: scale, facing, t, wash)

import { VoxelModel } from '../gfx/voxel.js';
import { makeCanvas, ctxOf } from '../core/canvas.js';
import { mix, shade } from '../core/color.js';
import { renderModel, voxelize } from './voxkit.js';
import { cloudSprites } from './sky.js';
import { SPECIES } from '../fish/species.js';
import { compiled } from '../gfx/spritecache.js';
import { drawFishRig } from '../gfx/fishrig.js';

const cache = new Map();
const memo = (k, fn) => { let v = cache.get(k); if (!v) { v = fn(); cache.set(k, v); } return v; };

export function gullFrames(tint = '#ffffff') {
  return memo('gull|' + tint, () => [1, 0, -1].map((flap) => {
    const m = new VoxelModel(17, 9, 5);
    const body = m.color(tint, { jitter: 0.03, spec: 0.4 }), wing = m.color(shade(tint, -0.18), { jitter: 0.03 }), tipC = m.color('#3a4458');
    const beak = m.color('#ffb02a'), eye = m.color('#141824'), shine = m.color('#ffffff');
    m.box(6, 3, 1, 10, 4, 3, body);
    m.box(10, 4, 1, 11, 5, 3, body);
    m.set(12, 4, 2, beak); m.set(13, 4, 2, beak);
    m.set(11, 5, 3, eye); m.set(11, 5, 4, shine);
    m.box(4, 3, 2, 5, 3, 2, body);
    for (let i = 1; i <= 6; i++) {
      const dy = Math.round(flap * i * 0.55);
      const c = i >= 5 ? tipC : wing;
      m.set(8 - Math.round(i * 0.3), 4 + dy, 2 - Math.min(2, Math.floor(i / 3)), c);
      m.set(8 + Math.round(i * 0.25), 4 + dy, 2 + Math.min(2, Math.floor(i / 3)), c);
      m.set(7 - i, 4 + dy, 2, c);
      m.set(9 + i, 4 + dy, 2, c);
    }
    const r = renderModel(m, { scale: 1, outline: true, jitter: 0.02, ao: 0.4, edges: 0.3 });
    return r.canvas;
  }));
}

export function voxBall(r, color = '#ffffff', o = {}) {
  r = Math.max(1, Math.round(r));
  return memo('ball|' + r + color + (o.emissive ?? 0) + (o.spec ?? 0.6) + (o.scale ?? 1), () => {
    const s = r * 2 + 2;
    const m = new VoxelModel(s, s, s);
    const c = m.color(color, { jitter: 0.03, spec: o.spec ?? 0.6, specPow: 10, smooth: 0.85, emissive: o.emissive ?? 0 });
    m.sphere(r + 1, r + 1, r + 1, r, c);
    const rr = renderModel(m, { scale: o.scale ?? 1, outline: o.outline ?? true, jitter: 0.02, ao: 0.5, edges: 0.3, light: { top: 5, lit: 4, dark: 2.6, bottom: 1.8 } });
    return { canvas: rr.canvas, ox: Math.round(rr.w / 2), oy: Math.round(rr.h / 2), w: rr.w, h: rr.h, glow: rr.glow };
  });
}

export function voxPixelSprite(src, depth = 3) {
  const v = voxelize(src, { cell: 1, maxD: depth, depth: () => depth, alignZ: 0, render: { ao: 0.5, edges: 0.4 } });
  const c = makeCanvas(src.width + 4, src.height + 4);
  ctxOf(c).drawImage(v.canvas, 2 - v.ox, 2 - v.oy);
  return c;
}

export function voxCloudSprite(seed, w, h, pal = 'day') {
  return memo('vcloud|' + seed + '|' + w + '|' + h + '|' + pal, () => {
    const s = cloudSprites(seed, Math.round(w / 2), Math.round(h / 2), Math.max(6, Math.round(h * 0.4)), 2, [pal]);
    return s[pal];
  });
}

// Hanging voxel cable / rope (from the surface down, swaying). Returns a DepthDecor anim bound at (x, top).
export function voxCableAnim(len, color, tip, x, top, frames = 8, thick = 1) {
  const A = memo('cable|' + len + color + tip + frames + thick, () => {
    const out = [];
    let W = 0, H = 0;
    for (let f = 0; f < frames; f++) {
      const ph = (f / frames) * Math.PI * 2;
      const m = new VoxelModel(24, len + 6, 5);
      const c = m.color(color, { jitter: 0.06, spec: 0.3 }), hi = m.color(mix(color, '#ffffff', 0.2), { jitter: 0.04 }), tc = m.color(tip, { spec: 0.8, emissive: 0.4 });
      let x = 12;
      for (let i = 0; i < len; i++) {
        const u = i / len;
        x = 12 + Math.sin(ph + u * 3) * u * 5 + Math.sin(u * 2.2) * 2;
        const y = len + 4 - i;
        for (let k = 0; k < thick; k++) m.set(x + k, y, 2, k ? hi : c);
      }
      m.sphere(x, 4, 2, 1.6, tc);
      const r = renderModel(m, { scale: 1, outline: true, jitter: 0.04, ao: 0.4, edges: 0.4 });
      const p = r.project(12, len + 4, 2);
      out.push({ canvas: r.canvas, ox: Math.round(p[0]), oy: Math.round(p[1]) });
      W = Math.max(W, r.w); H = Math.max(H, r.h);
    }
    const ox = Math.max(...out.map((q) => q.ox)), oy = Math.max(...out.map((q) => q.oy));
    const boxed = out.map((q) => { const c = makeCanvas(W + ox, H + oy); ctxOf(c).drawImage(q.canvas, ox - q.ox, oy - q.oy); return c; });
    return { frames: boxed, ox, oy, n: frames, P: 4.5 };
  });
  return {
    frames: A.frames, n: A.n, P: A.P, x: Math.round(x - A.ox), y: Math.round(top - A.oy),
    frame(t, off = 0) { const i = Math.floor((t / A.P) * A.n + off); return A.frames[((i % A.n) + A.n) % A.n]; },
    night() { return null; },
  };
}

// ------------------------------------------------------------------ background fish (voxel fish renderer)

export function bgFish(biome, n = 6) {
  return memo('bgfish|' + biome + '|' + n, () => {
    try {
      const pool = (SPECIES || []).filter((s) => s.look && (s.biome === biome || !biome) && s.look.kind !== 'chain' && s.rarity !== 'legendary');
      const list = (pool.length ? pool : (SPECIES || []).filter((s) => s.look && s.look.kind !== 'chain')).slice(0, 40);
      const out = [];
      for (let i = 0; i < n && list.length; i++) {
        const sp = list[(i * 7) % list.length];
        try { out.push(compiled(sp.look, null, sp.id)); } catch { /* skip odd looks */ }
      }
      return out;
    } catch { return []; }
  });
}

export function drawBgFish(ctx, c, x, y, o = {}) {
  if (!c) return;
  const t = o.t ?? 0;
  try {
    drawFishRig(ctx, c, {
      x, y, scale: o.scale ?? 0.3, facing: o.facing ?? 1, time: t, swimPhase: t * 1.4 + (o.ph || 0), tailPhase: t * 2.2 + (o.ph || 0), finPhase: t * 1.3,
      emotion: 'neutral', mouth: 0, speed01: 0.6, lod: 1, pri: 0.15, wash: o.wash || null, heading: 0, angle: 0, turn: 0,
    });
  } catch { /* fish art unavailable */ }
}

void mix;
