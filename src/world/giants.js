// [phase8:creatures] Distant giants that cruise through the far water, now VOXEL models (phase 8: the lowpolyfish.js
// poses are voxelised by src/fish/voxelize.js; phase 6 built them LOW-POLY 3D, src/fish/lowpolyfish.js): a humpback
// whale, a green sea turtle, a glossy bottlenose dolphin, a beluga, a harbour seal and an orca. Frames are cached
// low-poly sprites (one swim cycle, the mesh bends: vertical fluke beats, flipper strokes), built lazily; warm()
// builds at most one missing frame per call so the first sighting never stalls a frame.
//   new VoxelGiant(kind)   (name kept for callers) .n, .warm(), .frame(ph rad, dir) -> {canvas, ox, oy, w, h}
//   The canvas is rendered at RES device px per world px: draw it at (x - ox, y - oy) with size (w, h).
//   lpCrabFrames(color) -> [idle, walk1, walk2] {canvas, ox (bottom centre), oy, w, h} low-poly seabed crabs
//   lpPenguinFrames(dir), lpRestSealFrames() -> canvases with world size .w / .h (fjord critters)

import { TAU } from '../core/math.js';
import { creatureFrame, creatureLook, LP_SWIM, lpCrabLook } from '../fish/lowpolyfish.js';
import { makeCanvas } from '../core/canvas.js';

const RES = 3;
// world length (px) and view of each giant
const SIZE = {
  whale: { len: 190, yaw: 18 }, turtle: { len: 78, yaw: 22 }, dolphin: { len: 92, yaw: 14 },
  beluga: { len: 104, yaw: 14 }, seal: { len: 66, yaw: 16 }, orca: { len: 120, yaw: 14 },
};

function crop(f, flip) {
  const w = f.w, h = f.h;
  const cv = makeCanvas(Math.max(1, Math.round(w * f.k)), Math.max(1, Math.round(h * f.k)));
  const g = cv.getContext('2d');
  g.imageSmoothingEnabled = true;
  if (flip) { g.translate(cv.width, 0); g.scale(-1, 1); }
  g.drawImage(f.canvas, f.sx, f.sy, w, h, 0, 0, cv.width, cv.height);
  return cv;
}

export class VoxelGiant {
  constructor(kind) {
    this.kind = kind;
    this.B = SIZE[kind] || SIZE.dolphin;
    this.frames = new Array(LP_SWIM).fill(null);
    this.flipped = new Array(LP_SWIM).fill(null);
  }

  get n() { return LP_SWIM; }

  build(i) {
    const c = creatureLook(this.kind);
    if (!c) return;
    const S = (RES * this.B.len) / (c.L || 60);
    const f = creatureFrame(this.kind, { S, yaw: this.B.yaw, sw: i, force: true });
    if (!f) return;
    const k = f.k * RES; // sprite px -> canvas px is f.k; canvas px -> world px is 1 / RES
    this.frames[i] = { canvas: crop(f, false), ox: (f.ax * f.k) / RES, oy: (f.ay * f.k) / RES, w: (f.w * f.k) / RES, h: (f.h * f.k) / RES, res: RES, f, k };
  }

  // Build at most one missing frame (call once per update).
  warm() {
    const i = this.frames.indexOf(null);
    if (i >= 0) this.build(i);
  }

  frame(ph, dir) {
    const n = LP_SWIM;
    let i = Math.floor(((ph / TAU) * n) % n + n) % n;
    if (!this.frames[i]) {
      if (this.frames.every((f) => !f)) this.build(i);
      else { for (let d = 1; d < n; d++) { const j = (i + d) % n; if (this.frames[j]) { i = j; break; } } }
    }
    const f = this.frames[i];
    if (!f) return { canvas: makeCanvas(1, 1), ox: 0, oy: 0, w: 1, h: 1 };
    if (dir > 0) return f;
    if (!this.flipped[i]) this.flipped[i] = { canvas: crop(f.f, true), ox: f.w - f.ox, oy: f.oy, w: f.w, h: f.h, res: RES };
    return this.flipped[i];
  }
}

// Low-poly seabed crabs in a colour: idle + two walk frames, bottom-centre anchored (feet on the floor).
const crabCache = new Map();
export function lpCrabFrames(color = '#e0502e', len = 18) {
  const key = color + '|' + len;
  let out = crabCache.get(key);
  if (out) return out;
  const c = lpCrabLook(color);
  out = [0, 2, 5].map((sw) => {
    const f = c ? creatureFrame('crab:' + color, { S: (RES * len) / (c.L || 26), yaw: 70, sw, force: true, look: c }) : null;
    if (!f) return { canvas: makeCanvas(1, 1), ox: 0, oy: 0, w: 1, h: 1 };
    const cv = crop(f, false);
    const w = (f.w * f.k) / RES, h = (f.h * f.k) / RES;
    // anchor at the lowest point of the creature (feet): the bottom anchor of the frame
    const by = f.anchors.bottom ? (f.ay + f.anchors.bottom[1]) * f.k / RES : h;
    return { canvas: cv, ox: w / 2, oy: Math.min(h, by), w, h };
  });
  crabCache.set(key, out);
  return out;
}

// Place a creature frame into a canvas of world size W x H (rendered at RES), the model origin at (ax, ay) world px
// (or the frame centred when ax is null). The canvas carries its world size in .w / .h (draw with them).
function placed(f, W, H, ax, ay, flip = false) {
  const cv = makeCanvas(Math.round(W * RES), Math.round(H * RES));
  const g = cv.getContext('2d');
  g.imageSmoothingEnabled = true;
  if (flip) { g.translate(cv.width, 0); g.scale(-1, 1); }
  const k = f.k;
  const ox = ax == null ? (cv.width - f.w * k) / 2 : ax * RES - f.ax * k;
  const oy = ay == null ? (cv.height - f.h * k) / 2 : ay * RES - f.ay * k;
  g.drawImage(f.canvas, f.sx, f.sy, f.w, f.h, ox, oy, f.w * k, f.h * k);
  cv.w = W; cv.h = H;
  return cv;
}

// Low-poly fjord penguins in the old sprite layout: 0 stand, 1-2 waddle, 3 flap (15 x 17 world px, feet at
// (7, 15)), 4-5 swim strokes, 6 belly slide (19 x 11, centred). dir -1 faces left.
const pengCache = new Map();
export function lpPenguinFrames(dir = 1) {
  let out = pengCache.get(dir);
  if (out) return out;
  out = [0, 1, 2, 3, 4, 5, 6].map((sw) => {
    const f = creatureFrame('penguin', { S: RES, yaw: 18, sw, force: true });
    if (!f) { const c = makeCanvas(1, 1); c.w = 1; c.h = 1; return c; }
    return sw < 4 ? placed(f, 15, 17, 7, 15, dir < 0) : placed(f, 19, 11, null, null, dir < 0);
  });
  pengCache.set(dir, out);
  return out;
}

// Low-poly harbour seal resting on a floe, head lifting: 3 frames, 34 x 16 world px, belly at (17, 12).
let sealRest = null;
export function lpRestSealFrames() {
  if (sealRest) return sealRest;
  sealRest = [0, 2, 3].map((sw) => {
    const f = creatureFrame('restseal', { S: RES, yaw: 14, sw, force: true });
    if (!f) { const c = makeCanvas(1, 1); c.w = 1; c.h = 1; return c; }
    return placed(f, 34, 16, 17, 12.5);
  });
  return sealRest;
}
