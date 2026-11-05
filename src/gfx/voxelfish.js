// RETIRED (phase 6): fish and sea creatures are LOW-POLY 3D models now (src/fish/lowpolyfish.js on the shared
// WebGL2 renderer src/gfx/lowpoly.js). This module only keeps the old voxel-fish entry points as thin wrappers so
// existing callers (aquarium, dev pages) keep working:
//   drawVoxelFish(ctx, fish, {scale, glow, alpha}) -> anchors      (aquarium fish objects, via drawFishRig)
//   warmVoxelFish(c, scale), setVoxelFishBudget(ms), beginVoxelFishFrame(), voxelFishStats(), setVoxelSync(on),
//   clearVoxelFishCache(), benchVoxel(c, S), voxelOrb(r, hex, glow), voxelFrame(c, req) (a cropped low-poly frame)

import { drawFishRig } from './fishrig.js';
import { drawPellets, wakkaRig } from '../fish/wakka.js';
import { lpFrame, lpOrb, warmFish, setLowpolyBudget, setLowpolySync, lowpolyStats, clearLowpolyCache, LP_SWIM } from '../fish/lowpolyfish.js';
import { makeCanvas } from '../core/canvas.js';

export const SWIM_N = LP_SWIM;
export const VP = 1;
export const YAW_STEP = 10;
const DEG = Math.PI / 180;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export function setVoxelSync(on) { setLowpolySync(on); }
export function setVoxelFishBudget(ms) { setLowpolyBudget(ms); }
export function beginVoxelFishFrame() {}
export function voxelFishStats() { const s = lowpolyStats(); return { ...s, frames: s.sheetCount, framePx: s.sheetPx, pending: s.misses }; }
export function warmVoxelFish(c, scale) { warmFish(c, scale); }
export function clearVoxelFishCache() { clearLowpolyCache(); }
export function benchVoxel(c, S) { const t0 = now(); lpFrame(c, { S, yaw: 15, sw: 1, force: true }); const ms = now() - t0; return { layout: 0, grid: 0, trace: ms, finish: 0, total: ms }; }
export function voxelOrb(r, hex = '#e6fdff', glow = false) { return lpOrb(r, hex, glow) || { canvas: makeCanvas(1, 1), glow: null, ax: 0, ay: 0 }; }

// A low-poly frame cropped into its own canvas, in the old voxelFrame result shape ({f: {canvas, W, H, ax, ay,
// anchors, eyes, pitch, Sb, glow}, k}).
const crops = new Map();
export function voxelFrame(c, req) {
  const f = lpFrame(c, { S: req.S, yaw: req.yaw ?? 15, sw: req.sw || 0, infl: req.infl || 0, force: req.force, pri: req.pri });
  if (!f) return null;
  const key = f.canvas;
  let m = crops.get(key);
  if (!m) { crops.set(key, (m = new Map())); if (crops.size > 200) crops.delete(crops.keys().next().value); }
  let cv = m.get(f.sx + ',' + f.sy);
  if (!cv) { cv = makeCanvas(f.w, f.h); cv.getContext('2d').drawImage(f.canvas, f.sx, f.sy, f.w, f.h, 0, 0, f.w, f.h); m.set(f.sx + ',' + f.sy, cv); }
  const anchors = {};
  for (const [k, v] of Object.entries(f.anchors)) anchors[k] = [v[0], v[1]];
  const eyes = f.eyes.map((e) => ({ x: e.x, y: e.y, r: e.r, e: { type: 'real' } }));
  return { f: { canvas: cv, W: f.w, H: f.h, ax: f.ax, ay: f.ay, anchors, eyes, pitch: 0, Sb: req.S / f.k, glow: null }, k: f.k };
}

/**
 * Draw a fish object (aquarium / tank space) as a low-poly model. f: {c, x, y, facing, turn, vx, vz, angle,
 * tailPhase, swimPhase, finPhase, bob, squash, blink, mouth, emotion, inflate, quirks, chain}.
 * opts: {scale, glow, alpha}. Returns anchors {top, mouth, eyes, w, h}.
 */
export function drawVoxelFish(ctx, f, opts = {}) {
  const S = opts.scale ?? f.scale ?? 1;
  const vz = f.vz || 0, sp = Math.abs(f.vx || 0) + 6;
  const heading = clamp(Math.atan2(vz * 260, sp) / DEG, -55, 55);
  const alpha = opts.alpha ?? 1;
  if (f.wk) drawPellets(ctx, f, alpha);
  if (alpha < 1) ctx.globalAlpha = alpha;
  const a = drawFishRig(ctx, f.c, {
    x: f.x, y: f.y, bob: f.bob || 0, facing: f.facing ?? 1, turn: f.turn ?? f.facing ?? 1, angle: f.angle || 0, scale: S,
    squash: f.squash || 0, swimPhase: f.swimPhase ?? f.tailPhase ?? 0, tailPhase: f.tailPhase ?? 0, finPhase: f.finPhase ?? 0,
    speed01: f.speed01 ?? 0.4, inflate: f.quirks?.has?.('inflate') ? f.inflate || 0 : 0,
    lookX: f.lookX ?? null, lookY: f.lookY ?? null, blink: f.blink || 0, emotion: f.emotion || 'neutral', mouth: f.mouth || 0,
    time: f.age ?? 0, glow: opts.glow ?? 0, heading, chain: f.chain, ...(f.wk ? wakkaRig(f) : null),
  });
  ctx.globalAlpha = 1;
  return a;
}
