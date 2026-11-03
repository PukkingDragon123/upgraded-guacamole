// The Frutiger Aero room around the tank: a bright wall with a big window onto rolling green hills under
// a blue sky (clouds drift, hills shift with the mouse for a little parallax, wind turbines turn), a glass
// desk on chrome legs, a sleek white desk lamp, glossy potted plants, sun shafts, bloom, dust sparkles and
// soap bubbles. Everything static is painted once per (view, tier, size) and cached; per frame the room
// costs a handful of drawImage calls.
//
//   roomArt(L)                          -> cached art for a scene layout (tanks.js sceneLayout)
//   drawRoomBack(ctx, art, ox, oy, t, par)   sky, clouds, hills, turbines, wall/window/desk, sun shafts
//   drawRoomFront(ctx, art, ox, oy, t, par)  foreground plant, lamp bloom
//   RoomAmbient                          dust motes + soap bubbles (update(dt, art), draw(ctx, ox, oy))
//   roomHit(art, x, y) -> 'lamp' | 'plant' | 'fplant' | null   (scene coords; click toys)
// par = {x, y} in -1..1 (mouse offset from the scene centre, smoothed by the caller).

import { makeCanvas, ctxOf } from '../core/canvas.js';
import { hash2, fbm1, clamp01, smoothstep, TAU } from '../core/math.js';
import { VoxelModel, renderVoxels } from '../gfx/voxel.js';
import { Paint, C, setMix, grad, sdRR } from './paint.js';

// ------------------------------------------------------------------ palette

const COL = {
  wallT: C('#f6fcff'), wallM: C('#e4f4fb'), wallB: C('#c9e6f3'), wallShade: C('#9cc6dc'),
  frame: C('#fbfdff'), frameS: C('#d4e5ee'), frameD: C('#a9c4d4'), frameEdge: C('#7fa6bd'),
  skyT: C('#1a74dc'), skyM: C('#45aaf0'), skyH: C('#b8e6ff'), skyW: C('#e9f8ff'),
  sun: C('#fffbe8'),
  cloudH: C('#ffffff'), cloudM: C('#eef7ff'), cloudS: C('#cfe3f6'), cloudD: C('#a8c8e8'),
  glassTop: C('#d8f6f4'), glassEdge: C('#7fe2cc'), glassEdgeD: C('#2fa79a'), white: C('#ffffff'),
  chrome0: C('#5f7486'), chrome1: C('#a9bccb'), chrome2: C('#e8f2f8'), chrome3: C('#ffffff'),
  floorA: C('#efe0c4'), floorB: C('#d9c19a'), floorS: C('#b89c74'), floorR: C('#fff6e4'),
  base: C('#ffffff'), navy: C('#1d3f6e'), navyL: C('#3f73b0'), aqua: C('#2fd3e8'), lime: C('#a8ec5a'),
};

// ------------------------------------------------------------------ plan

// Positions of everything in scene coordinates, derived from the scene layout.
export function roomPlan(L) {
  const { sw, sh, u, deskY, tank, tier, key, shape } = L;
  const full = key === 'full';
  const wall = shape === 'wall';
  const plan = { sw, sh, u, deskY, tank, tier, key, shape, wins: [], items: [] };
  const fw = Math.max(2, Math.round(7 * u)); // window frame
  plan.fw = fw;
  plan.floorY = Math.round(full ? Math.min(sh - 18 * u, deskY + 0.11 * sh) : sh + 4);
  if (wall) {
    // the wall aquarium takes the wall: two tall side windows
    const bez = Math.round(16 * u);
    const gap = tank.x - bez - Math.round(14 * u);
    const ww = Math.min(Math.round(120 * u), gap - Math.round(14 * u));
    if (ww > 14) {
      const y = Math.round(sh * 0.08), h = Math.round(sh * (full ? 0.66 : 0.7));
      plan.wins.push({ x: Math.round(gap - ww), y, w: ww, h, panes: 1 });
      plan.wins.push({ x: Math.round(sw - gap), y, w: ww, h, panes: 1 });
    }
  } else {
    const y = Math.round(sh * (full ? 0.055 : 0.05));
    const x = Math.round(sw * (full ? 0.085 : 0.035));
    const bottom = Math.round(full ? deskY - sh * 0.13 : deskY - sh * 0.12);
    plan.wins.push({ x, y, w: sw - x * 2, h: bottom - y, panes: full ? 3 : 2 });
  }
  // sky rect = union of the panes
  let x0 = sw, y0 = sh, x1 = 0, y1 = 0;
  for (const w of plan.wins) { x0 = Math.min(x0, w.x); y0 = Math.min(y0, w.y); x1 = Math.max(x1, w.x + w.w); y1 = Math.max(y1, w.y + w.h); }
  plan.sky = plan.wins.length ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
  // furniture: desk (jar..big tank), cabinet (reef), floating console (wall)
  if (tier <= 3) plan.desk = { x0: Math.round(sw * (full ? 0.035 : -0.02)), x1: Math.round(sw * (full ? 0.965 : 1.02)), y: deskY, top: Math.max(3, Math.round(9 * u)), th: Math.max(2, Math.round(6 * u)) };
  else if (tier === 4) plan.cabinet = { x0: tank.x - Math.round(8 * u), x1: tank.x + tank.w + Math.round(8 * u), y: tank.y + tank.h + L.base, bottom: full ? plan.floorY + Math.round(22 * u) : sh + 2 };
  else plan.console = { x0: tank.x + Math.round(tank.w * 0.12), x1: tank.x + Math.round(tank.w * 0.88), y: tank.y + tank.h + Math.round(26 * u), h: Math.max(3, Math.round(10 * u)) };
  // props
  const vs = Math.max(1, Math.round(2 * u * (full ? 1 : 0.9)));
  plan.vs = vs;
  const deskTop = deskY - Math.round(4 * u);
  const leftGap = tank.x - (plan.desk ? plan.desk.x0 : 0), rightGap = (plan.desk ? plan.desk.x1 : sw) - (tank.x + tank.w);
  if (plan.desk && leftGap > 52 * u) plan.items.push({ kind: 'lamp', x: Math.round(tank.x - Math.min(leftGap * 0.45, 92 * u)), y: deskTop, flip: false });
  else if (full && leftGap > 40 * u) plan.items.push({ kind: 'floorlamp', x: Math.round(Math.max(30 * u, tank.x * 0.45)), y: Math.round(sh - 4 * u), flip: false });
  if (plan.desk && rightGap > 44 * u) plan.items.push({ kind: 'plant', x: Math.round(tank.x + tank.w + Math.min(rightGap * 0.5, 84 * u)), y: deskTop, seed: 3 });
  if (full && sw - (tank.x + tank.w) > 64 * u) plan.items.push({ kind: 'fplant', x: Math.round(sw - Math.max(34 * u, (sw - tank.x - tank.w) * 0.32)), y: Math.round(sh + 2 * u), seed: 11, front: true });
  if (full && wall && tank.x > 64 * u) plan.items.push({ kind: 'fplant', x: Math.round(Math.max(34 * u, tank.x * 0.32)), y: Math.round(sh + 2 * u), seed: 5, front: true, flip: true });
  return plan;
}

// ------------------------------------------------------------------ sky, clouds, hills

function paintSky(w, h, u) {
  const P = new Paint(w, h);
  const c = P.c;
  const sx = w * 0.16, sy = h * 0.14;
  const stops = [[0, COL.skyT], [0.5, COL.skyM], [0.86, COL.skyH], [1, COL.skyW]];
  P.each(0, 0, w, h, (x, y) => {
    grad(c, stops, y / h);
    const d = Math.hypot(x - sx, (y - sy) * 1.15);
    const glow = Math.exp(-d / (h * 0.32)) * 0.75 + Math.exp(-d / (h * 0.08)) * 0.5;
    const ang = Math.atan2(y - sy, x - sx);
    const ray = Math.pow(Math.abs(Math.sin(ang * 6 + 0.4)), 18) * 0.2 * Math.exp(-d / (h * 0.7));
    const k = clamp01(glow + ray);
    c[0] += (255 - c[0]) * k; c[1] += (252 - c[1]) * k; c[2] += (236 - c[2]) * k * 0.9;
    if (d < 7 * u + 2) { c[0] = 255; c[1] = 254; c[2] = 244; }
    return 1;
  });
  return { canvas: P.toCanvas(4), sun: [sx, sy] };
}

function paintCloud(w, h, seed) {
  const P = new Paint(w, h);
  const c = P.c;
  const n = 5 + Math.floor(hash2(seed, 1, 9) * 4);
  const puffs = [];
  const base = h * 0.78;
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const r = h * (0.22 + 0.3 * Math.sin(t * Math.PI) * (0.7 + 0.5 * hash2(seed, i, 3)));
    puffs.push([w * (0.12 + 0.76 * t) + (hash2(seed, i, 5) - 0.5) * w * 0.08, base - r * (0.45 + 0.4 * hash2(seed, i, 7)), r]);
  }
  P.each(0, 0, w, h, (x, y) => {
    if (y > base + h * 0.06) return 0;
    let best = -1, nx = 0, ny = 0;
    for (const [px, py, r] of puffs) {
      const d = Math.hypot(x - px, y - py);
      const v = 1 - d / r;
      if (v > best) { best = v; nx = (x - px) / r; ny = (y - py) / r; }
    }
    if (best < 0) return 0;
    // flat underside, lit from the upper left
    const lit = clamp01(0.62 - nx * 0.35 - ny * 0.75 + best * 0.25);
    const under = smoothstep(base - h * 0.12, base + h * 0.04, y);
    const tone = lit * (1 - under * 0.55);
    grad(c, [[0, COL.cloudD], [0.3, COL.cloudS], [0.62, COL.cloudM], [0.85, COL.cloudH]], tone);
    return best < 0.06 ? 0.85 : 1;
  });
  return P.toCanvas(4);
}

// layer: 0 far (hazy blue-green), 1 mid, 2 near (bright grass)
function paintHills(w, h, layer, seed, u, skyH) {
  const P = new Paint(w, h);
  const c = P.c;
  const amp = [0.12, 0.17, 0.2][layer] * h, base = [0.5, 0.62, 0.78][layer] * h;
  const f1 = [0.006, 0.008, 0.005][layer] / Math.max(0.5, u), f2 = f1 * 2.7;
  const crest = (x) => base - amp * (0.55 * Math.sin(x * f1 + seed) + 0.3 * Math.sin(x * f2 + seed * 2.3) + 0.4 * (fbm1(x * f1 * 0.7 + seed, 3, seed) - 0.5));
  const cols = [
    [C('#a9d9c6'), C('#8cc9b0'), C('#6fb69c')],
    [C('#b8ef7a'), C('#6fcf3c'), C('#3f9f2c')],
    [C('#d8ff8a'), C('#8ee04a'), C('#47b02e')],
  ][layer];
  const haze = C('#d6f0ff');
  P.each(0, 0, w, h, (x, y) => {
    const cy = crest(x);
    if (y < cy) return 0;
    const dy = y - cy;
    const sl = (crest(x + 2) - crest(x - 2)) / 4; // + = going down to the right: faces the sun
    const lit = clamp01(0.62 + sl * 1.6 - dy / (h * 0.9) * 0.6);
    grad(c, [[0, cols[2]], [0.5, cols[1]], [1, cols[0]]], lit);
    // glossy crest sheen
    if (dy < 2.2 * u + 1 && layer > 0) setMix(c, c, C('#f4ffd0'), 0.55 * (1 - dy / (2.2 * u + 1)));
    // mowing stripes on the near hills
    if (layer > 0) {
      const s = Math.sin((x * 0.05 / Math.max(0.5, u)) + dy * 0.09 + seed);
      if (s > 0.75) setMix(c, c, C('#ffffff'), 0.07);
    }
    if (layer === 0) setMix(c, c, haze, 0.35 - dy / h * 0.2);
    // tiny flowers on the near hill
    if (layer === 2 && dy > 4 && hash2(Math.floor(x / 2), Math.floor(y / 2), seed) > 0.992) setMix(c, c, hash2(x, y, 3) > 0.5 ? C('#ffffff') : C('#fff27a'), 0.9);
    return 1;
  });
  void skyH;
  return { canvas: P.toCanvas(4), crest };
}

// Turbine rotor frames (3 blades, 120-degree symmetry).
const rotorCache = new Map();
function rotorFrames(L) {
  L = Math.max(4, Math.round(L));
  let fr = rotorCache.get(L);
  if (fr) return fr;
  fr = [];
  const N = 12, s = L * 2 + 3;
  for (let f = 0; f < N; f++) {
    const P = new Paint(s, s);
    const a0 = (f / N) * (TAU / 3);
    for (let b = 0; b < 3; b++) {
      const a = a0 + (b * TAU) / 3;
      for (let r = 1; r <= L; r += 0.5) {
        const x = Math.round(s / 2 + Math.cos(a) * r - 0.5), y = Math.round(s / 2 + Math.sin(a) * r - 0.5);
        P.over(x, y, COL.white, 1);
        if (r < L * 0.55) P.over(x + (Math.sin(a) > 0 ? 1 : 0), y + (Math.cos(a) > 0 ? 0 : 1), C('#e2eef6'), 1);
      }
    }
    P.over(Math.floor(s / 2), Math.floor(s / 2), C('#cfdde8'), 1);
    fr.push(P.toCanvas(2));
  }
  rotorCache.set(L, fr);
  return fr;
}

// ------------------------------------------------------------------ the room (wall, window, floor, desk)

function paintRoom(plan) {
  const { sw, sh, u, deskY, fw } = plan;
  const P = new Paint(sw, sh);
  const c = P.c;
  const floorY = plan.floorY;
  // wall: pale aqua-white, lighter around the window
  const sky = plan.sky;
  const wcx = sky ? sky.x + sky.w / 2 : sw / 2, wcy = sky ? sky.y + sky.h * 0.45 : sh * 0.3;
  P.each(0, 0, sw, Math.min(sh, floorY), (x, y) => {
    grad(c, [[0, COL.wallT], [0.55, COL.wallM], [1, COL.wallB]], y / Math.max(1, floorY));
    const d = Math.hypot((x - wcx) / (sw * 0.55), (y - wcy) / (sh * 0.6));
    setMix(c, c, COL.white, clamp01(0.5 - d * 0.5));
    // faint glossy wall panels
    const px = (x / (150 * u)) % 1;
    if (px < 0.006 + 1 / (150 * u)) setMix(c, c, COL.wallShade, 0.12);
    return 1;
  });
  // under-desk shade
  if (plan.desk) {
    const d = plan.desk;
    P.each(d.x0, d.y, d.x1, floorY, (x, y) => {
      const k = 1 - (y - d.y) / Math.max(1, floorY - d.y);
      c[0] = 70; c[1] = 120; c[2] = 150;
      return 0.18 * k + 0.05;
    });
  }
  // windows
  for (const w of plan.wins) paintWindow(P, w, plan);
  // floor + baseboard
  if (floorY < sh) {
    P.each(0, floorY, sw, sh, (x, y) => {
      const t = (y - floorY) / Math.max(1, sh - floorY);
      grad(c, [[0, COL.floorS], [0.25, COL.floorB], [1, COL.floorA]], t);
      // planks (perspective: seams fan out from the centre)
      const fx = (x - sw / 2) / (0.4 + t * 0.9);
      const seam = Math.abs(((fx / (46 * u)) % 1 + 1) % 1 - 0.5);
      if (seam > 0.485) setMix(c, c, COL.floorS, 0.5);
      // glossy reflection of the window
      if (sky && x > sky.x && x < sky.x + sky.w) setMix(c, c, COL.floorR, 0.35 * (1 - t) * (0.6 + 0.4 * Math.sin(x * 0.02)));
      return 1;
    });
    const bb = Math.max(2, Math.round(5 * u));
    P.each(0, floorY - bb, sw, floorY + 1, (x, y) => {
      setMix(c, COL.white, COL.frameS, (y - (floorY - bb)) / bb);
      return 1;
    });
  }
  if (plan.desk) paintDesk(P, plan);
  if (plan.cabinet) paintCabinet(P, plan);
  if (plan.console) paintConsole(P, plan);
  void deskY; void fw;
  return P;
}

function paintWindow(P, w, plan) {
  const { u, fw } = plan;
  const c = P.c;
  const r = Math.round(9 * u);
  const ox = w.x - fw, oy = w.y - fw, ow = w.w + fw * 2, oh = w.h + fw * 2;
  // soft shadow of the frame on the wall
  P.each(ox - 4 * u, oy - 2 * u, ox + ow + 6 * u, oy + oh + 8 * u, (x, y) => {
    const d = sdRR(x, y, ox + ow / 2 + 2 * u, oy + oh / 2 + 3 * u, ow / 2, oh / 2, r);
    if (d < 0 || d > 6 * u) return 0;
    c[0] = 90; c[1] = 140; c[2] = 170;
    return 0.16 * (1 - d / (6 * u));
  });
  // glossy white frame
  P.each(ox, oy, ox + ow, oy + oh, (x, y) => {
    const d = sdRR(x, y, ox + ow / 2, oy + oh / 2, ow / 2, oh / 2, r);
    if (d > 0) return 0;
    const t = (y - oy) / oh;
    grad(c, [[0, COL.frame], [0.5, COL.frame], [1, COL.frameS]], t);
    if (d > -1) setMix(c, c, COL.frameEdge, 0.5);
    else if (d > -2 && y < oy + oh / 2) setMix(c, c, COL.white, 0.9);
    return 1;
  });
  // panes (holes) and mullions
  const mull = Math.max(2, Math.round(5 * u));
  const pw = (w.w - mull * (w.panes - 1)) / w.panes;
  const pr = Math.max(1, Math.round(5 * u));
  for (let i = 0; i < w.panes; i++) {
    const px = w.x + i * (pw + mull), py = w.y;
    const cx = px + pw / 2, cy = py + w.h / 2;
    P.each(px - 2, py - 2, px + pw + 2, py + w.h + 2, (x, y) => {
      const d = sdRR(x, y, cx, cy, pw / 2, w.h / 2, pr);
      if (d > 1.2) return 0;
      if (d > 0) { // inner bevel: shaded top-left, lit bottom-right
        const tl = (x - cx) / pw + (y - cy) / w.h < 0;
        setMix(c, tl ? COL.frameD : COL.white, COL.frameS, 0.3);
        return 1;
      }
      return 1;
    });
    P.each(px, py, px + pw, py + w.h, (x, y) => (sdRR(x, y, cx, cy, pw / 2, w.h / 2, pr) <= 0 ? 1 : 0), 'erase');
    // reflections on the glass: two diagonal streaks
    P.each(px, py, px + pw, py + w.h, (x, y) => {
      if (sdRR(x, y, cx, cy, pw / 2, w.h / 2, pr) > 0) return 0;
      const s = (x - px) + (y - py) * 0.6;
      const k = ((s / (pw * 0.9)) % 1 + 1) % 1;
      c[0] = 255; c[1] = 255; c[2] = 255;
      if (k > 0.1 && k < 0.16) return 0.13;
      if (k > 0.19 && k < 0.21) return 0.1;
      return 0;
    });
  }
  // sill
  if (plan.shape !== 'wall') {
    const sy = w.y + w.h + fw, sx0 = w.x - fw - 6 * u, sx1 = w.x + w.w + fw + 6 * u, h = Math.max(2, Math.round(6 * u));
    P.each(sx0, sy - 1, sx1, sy + h + 3 * u, (x, y) => {
      if (y < sy + h) {
        const t = (y - sy) / h;
        grad(c, [[0, COL.white], [0.35, COL.frame], [1, COL.frameS]], t);
        if (y < sy + 1) setMix(c, c, COL.frameEdge, 0.3);
        if (x < sx0 + 1 || x > sx1 - 1) setMix(c, c, COL.frameD, 0.5);
        return 1;
      }
      c[0] = 80; c[1] = 130; c[2] = 160;
      return 0.18 * (1 - (y - sy - h) / (3 * u));
    });
  }
}

function paintDesk(P, plan) {
  const { u, floorY, sh } = plan;
  const d = plan.desk;
  const c = P.c;
  const topY = d.y - d.top, fy = d.y, by = d.y + d.th;
  // chrome legs (behind the glass top) with a crossbar
  const legW = Math.max(2, Math.round(6 * u));
  const legBottom = Math.min(sh + 2, floorY + Math.round(16 * u));
  for (const lx of [d.x0 + Math.round(20 * u), d.x1 - Math.round(20 * u) - legW]) {
    P.each(lx, by, lx + legW, legBottom, (x) => {
      const t = (x - lx) / legW;
      grad(c, [[0, COL.chrome1], [0.3, COL.chrome3], [0.55, COL.chrome2], [1, COL.chrome0]], t);
      return 1;
    });
    // foot pad
    P.each(lx - 2 * u, legBottom - 3 * u, lx + legW + 2 * u, legBottom, () => { setMix(c, COL.chrome1, COL.chrome0, 0.4); return 1; });
  }
  // glass top: the top face seen from above (translucent, catches the window light)
  P.each(d.x0, topY, d.x1, fy, (x, y) => {
    const t = (y - topY) / d.top;
    setMix(c, COL.white, COL.glassTop, t);
    const edge = x < d.x0 + 2 || x > d.x1 - 3;
    if (y < topY + 1) { setMix(c, c, COL.white, 0.8); return 0.95; }
    return edge ? 0.9 : 0.55 + 0.15 * t;
  });
  // front edge: green glass seen edge-on
  P.each(d.x0, fy, d.x1, by, (x, y) => {
    const t = (y - fy) / Math.max(1, d.th);
    grad(c, [[0, COL.white], [0.2, COL.glassEdge], [1, COL.glassEdgeD]], t);
    const sheen = Math.sin(x * 0.03) * 0.5 + 0.5;
    if (t > 0.3 && t < 0.55) setMix(c, c, COL.white, 0.25 * sheen);
    return 0.92;
  });
  // shadow under the slab
  P.each(d.x0, by, d.x1, by + Math.max(2, 4 * u), (x, y) => { c[0] = 40; c[1] = 90; c[2] = 120; return 0.22 * (1 - (y - by) / Math.max(2, 4 * u)); });
}

function paintCabinet(P, plan) {
  const { u } = plan;
  const k = plan.cabinet;
  const c = P.c;
  const r = Math.round(4 * u);
  const cx = (k.x0 + k.x1) / 2, cy = (k.y + k.bottom) / 2, hw = (k.x1 - k.x0) / 2, hh = (k.bottom - k.y) / 2;
  P.each(k.x0, k.y, k.x1, k.bottom, (x, y) => {
    const d = sdRR(x, y, cx, cy, hw, hh, r);
    if (d > 0) return 0;
    const t = (y - k.y) / (k.bottom - k.y);
    grad(c, [[0, C('#ffffff')], [0.06, C('#eef6fb')], [0.5, C('#dbeaf2')], [1, C('#b4cfde')]], t);
    if (d > -1) setMix(c, c, COL.frameEdge, 0.6);
    // doors + chrome handles
    const dx = (x - k.x0) / (k.x1 - k.x0);
    if (Math.abs(dx - 0.5) < 0.002 + 0.5 / (k.x1 - k.x0)) setMix(c, c, COL.frameD, 0.7);
    if (t > 0.12 && Math.abs(Math.abs(dx - 0.5) - 0.04) < 0.004 && t < 0.4) setMix(c, c, COL.chrome1, 1);
    // aqua accent strip
    if (t > 0.05 && t < 0.07) setMix(c, c, COL.aqua, 0.8);
    return 1;
  });
}

function paintConsole(P, plan) {
  const { u } = plan;
  const k = plan.console;
  const c = P.c;
  const cx = (k.x0 + k.x1) / 2, cy = k.y + k.h / 2;
  P.each(k.x0 - 2, k.y - 2, k.x1 + 2, k.y + k.h + 6 * u, (x, y) => {
    const d = sdRR(x, y, cx, cy, (k.x1 - k.x0) / 2, k.h / 2, k.h / 2);
    if (d > 0) {
      if (y > k.y + k.h * 0.5 && d < 5 * u) { c[0] = 70; c[1] = 120; c[2] = 150; return 0.2 * (1 - d / (5 * u)); }
      return 0;
    }
    const t = (y - k.y) / k.h;
    grad(c, [[0, COL.white], [0.4, COL.frame], [1, COL.frameS]], t);
    if (d > -1) setMix(c, c, COL.frameEdge, 0.5);
    return 1;
  });
}

// ------------------------------------------------------------------ voxel props

function deskLamp(vs) {
  const m = new VoxelModel(26, 44, 18);
  const white = m.color('#f8fcff', { spec: 1.3, specPow: 18, smooth: 0.7, jitter: 0.02 });
  const chrome = m.color('#c8d8e4', { spec: 1.8, specPow: 26, smooth: 0.5, jitter: 0 });
  const aqua = m.color('#2fd3e8', { spec: 1.2, smooth: 0.5 });
  const bulb = m.color('#fff6d8', { emissive: 1 });
  const cz = 9;
  // base: glossy disc with an aqua ring
  m.cylinder(7, cz, 0, 2, 6.5, white);
  m.cylinder(7, cz, 2, 2, 6.8, aqua);
  m.cylinder(7, cz, 3, 3, 4.5, white);
  // arm: chrome tube rising then arching to the right
  m.tube([[7, 3, cz, 1.1], [7.5, 18, cz, 1.1], [9, 32, cz, 1.1], [14, 39, cz, 1.1], [19, 37, cz, 1.1]], chrome, 6);
  // dome head (opening down) with a glowing bulb
  m.ellipsoid(19.5, 33, cz, 6, 5, 6, white);
  m.sub(() => m.ellipsoid(19.5, 31, cz, 4.6, 4, 4.6, white));
  m.sub(() => m.box(13, 26, 0, 26, 30, 17, white));
  m.ellipsoid(19.5, 31, cz, 2.6, 2.2, 2.6, bulb);
  const r = renderVoxels(m, { scale: vs, yaw: 18, pitch: 16, ao: 1, edges: 0.7, groundAO: true, glowRadius: 3 });
  return { ...r, bulb: r.regions?.[bulb] || null };
}

function floorLamp(vs) {
  const m = new VoxelModel(24, 90, 16);
  const white = m.color('#f8fcff', { spec: 1.3, specPow: 18, smooth: 0.7, jitter: 0.02 });
  const chrome = m.color('#c8d8e4', { spec: 1.8, specPow: 26, smooth: 0.5, jitter: 0 });
  const glow = m.color('#fffbe8', { emissive: 1 });
  const cz = 8;
  m.cylinder(12, cz, 0, 1, 7, white);
  m.cylinder(12, cz, 2, 70, 0.9, chrome);
  // glossy orb shade
  m.sphere(12, 78, cz, 8, glow);
  m.sphere(12, 78, cz, 8.4, white);
  m.sub(() => m.box(0, 70, 0, 23, 77, 15, white));
  m.sphere(12, 77, cz, 7.2, glow);
  const r = renderVoxels(m, { scale: vs, yaw: 10, pitch: 12, ao: 1, edges: 0.7, groundAO: true, glowRadius: 4 });
  return { ...r, bulb: r.regions?.[glow] || null };
}

function pottedPlant(vs, seed, tall = false) {
  const H = tall ? 96 : 40;
  const m = new VoxelModel(tall ? 44 : 32, H, tall ? 30 : 24);
  const pot = m.color('#f8fcff', { spec: 1.4, specPow: 18, smooth: 0.8, jitter: 0.02 });
  const band = m.color(tall ? '#a8ec5a' : '#2fd3e8', { spec: 1.2, smooth: 0.6 });
  const soil = m.color('#5a3a2a', { jitter: 0.2 });
  const leafA = m.color('#3fae2a', { spec: 0.6, smooth: 0.4, jitter: 0.08 });
  const leafB = m.color('#7fd84a', { spec: 0.7, smooth: 0.4, jitter: 0.06 });
  const leafC = m.color('#c8f56a', { spec: 0.6, smooth: 0.4 });
  const cx = m.nx / 2, cz = m.nz / 2;
  const pr = tall ? 10 : 7, ph = tall ? 20 : 11;
  // glossy rounded pot with a coloured band
  for (let y = 0; y <= ph; y++) {
    const t = y / ph;
    const r = pr * (0.72 + 0.28 * Math.sin(Math.min(1, t * 1.25) * Math.PI * 0.55 + 0.3));
    m.cylinder(cx, cz, y, y, r, Math.abs(t - 0.78) < 0.08 ? band : pot);
  }
  m.cylinder(cx, cz, ph + 1, ph + 1, pr * 0.98, pot);
  m.cylinder(cx, cz, ph, ph + 1, pr * 0.82, soil);
  // leaves
  let s = seed * 9301 + 49297;
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  if (tall) {
    // snake-plant blades: tall, slightly curved, banded
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * TAU + rnd() * 0.5, lean = 0.08 + rnd() * 0.18;
      const hgt = 40 + rnd() * 34, w = 1.6 + rnd() * 0.8;
      const pts = [];
      for (let k = 0; k <= 6; k++) {
        const t = k / 6;
        pts.push([cx + Math.cos(a) * (2 + t * hgt * lean), ph + 1 + t * hgt, cz + Math.sin(a) * (2 + t * hgt * lean), w * (1 - t * 0.75)]);
      }
      const bandCol = (x, y) => (Math.floor(y / 3 + i) % 3 === 0 ? leafB : y > ph + hgt * 0.8 ? leafC : leafA);
      m.tube(pts, bandCol, 3);
    }
  } else {
    // pothos: heart leaves on arching stems
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * TAU + rnd() * 0.6;
      const reach = 6 + rnd() * 7, up = 6 + rnd() * 14;
      const lx = cx + Math.cos(a) * reach, ly = ph + 2 + up, lz = cz + Math.sin(a) * reach * 0.8;
      m.tube([[cx, ph + 1, cz, 0.6], [(cx + lx) / 2, ly + 2, (cz + lz) / 2, 0.6], [lx, ly, lz, 0.6]], leafA, 3);
      const col = rnd() > 0.5 ? leafB : leafA;
      m.ellipsoid(lx + Math.cos(a) * 2.2, ly - 1, lz + Math.sin(a) * 1.6, 3.2, 1.4, 2.6, col);
      m.ellipsoid(lx + Math.cos(a) * 3.2, ly - 1.4, lz + Math.sin(a) * 2.2, 1.6, 1, 1.4, leafC);
    }
  }
  return renderVoxels(m, { scale: vs, yaw: 24, pitch: 18, ao: 1.1, edges: 0.7, groundAO: true });
}

// ------------------------------------------------------------------ art cache

const artCache = new Map();

export function roomArt(L) {
  const key = [L.key, L.tier, L.sw, L.sh].join('|');
  let art = artCache.get(key);
  if (art) return art;
  const plan = roomPlan(L);
  const { sw, sh, u } = plan;
  const P = paintRoom(plan);
  const room = P.toCanvas(4);
  const g = ctxOf(room);
  const front = makeCanvas(sw, sh);
  const fg = ctxOf(front);
  const props = [];
  for (const it of plan.items) {
    let r;
    if (it.kind === 'lamp') r = deskLamp(plan.vs);
    else if (it.kind === 'floorlamp') r = floorLamp(plan.vs);
    else if (it.kind === 'plant') r = pottedPlant(plan.vs, it.seed, false);
    else r = pottedPlant(Math.max(1, Math.round(plan.vs * 1.15)), it.seed, true);
    const x = Math.round(it.x - r.ox), y = Math.round(it.y - r.oy);
    const tgt = it.front ? fg : g;
    if (it.flip) { tgt.save(); tgt.translate(x + r.canvas.width, y); tgt.scale(-1, 1); tgt.drawImage(r.canvas, 0, 0); tgt.restore(); }
    else tgt.drawImage(r.canvas, x, y);
    // soft contact shadow on the desk / floor
    const sh0 = { x: it.x, y: it.y, w: r.canvas.width * 0.42 };
    props.push({ ...it, rect: { x, y, w: r.canvas.width, h: r.canvas.height }, glow: r.glow, bulb: r.bulb, sh0 });
    if (r.bulb && r.glow) props[props.length - 1].glowAt = { x, y };
  }
  // sky + parallax layers
  let sky = null;
  if (plan.sky) {
    const s = plan.sky;
    const m = Math.round(18 * u) + 4;
    const skyArt = paintSky(s.w, s.h, u);
    const hills = [0, 1, 2].map((i) => {
      const hh = Math.round(s.h * [0.62, 0.5, 0.36][i]);
      const hl = paintHills(s.w + m * 2, hh, i, 3.1 + i * 1.7 + L.tier * 0.37, u, s.h);
      return { canvas: hl.canvas, crest: hl.crest, y: s.y + s.h - hh, depth: [0.25, 0.55, 1][i] };
    });
    const clouds = [];
    const nc = Math.max(2, Math.round(s.w / (150 * u)));
    for (let i = 0; i < nc; i++) {
      const cw = Math.round((70 + 70 * hash2(i, 2, 5)) * u), ch = Math.round(cw * 0.42);
      clouds.push({ canvas: paintCloud(cw, ch, i * 3 + 1), x: hash2(i, 3, 5) * (s.w + cw), y: s.y + s.h * (0.08 + 0.32 * hash2(i, 4, 5)), speed: (2 + 3 * hash2(i, 5, 5)) * u, depth: 0.15 + 0.2 * hash2(i, 6, 5) });
    }
    // wind turbines on the far hills
    const turbines = [];
    const far = hills[0];
    const nt = s.w > 220 * u ? 3 : 1;
    for (let i = 0; i < nt; i++) {
      const fx = s.w * (0.58 + i * 0.12) + m;
      const th = Math.round((22 - i * 3) * u + 6);
      turbines.push({ x: fx, base: far.y + far.crest(fx) + 2, h: th, ph: i * 0.7, layer: far });
    }
    sky = { rect: s, canvas: skyArt.canvas, sun: [s.x + skyArt.sun[0], s.y + skyArt.sun[1]], hills, clouds, turbines, m };
  }
  // sun shafts radiating from the window into the room (additive)
  let shafts = null;
  if (plan.sky) {
    const S = new Paint(sw, sh);
    const c = S.c;
    const src = [plan.sky.x + plan.sky.w * 0.25, plan.sky.y - plan.sky.h * 0.6];
    S.each(0, plan.sky.y, sw, sh, (x, y) => {
      const ang = Math.atan2(y - src[1], x - src[0]);
      const k = Math.pow(Math.max(0, Math.sin(ang * 9 + 1.1)), 6) * 0.5 + Math.pow(Math.max(0, Math.sin(ang * 4.5 + 0.2)), 10) * 0.6;
      const fall = clamp01(1 - (y - plan.sky.y) / (sh * 1.1));
      const a = k * fall * 0.16;
      if (a < 0.01) return 0;
      c[0] = 255; c[1] = 250; c[2] = 222;
      return a;
    });
    shafts = S.toCanvas(8);
  }
  // window bloom (soft glow spilling over the frame)
  let bloom = null;
  if (plan.wins.length) {
    const B = new Paint(sw, sh);
    const c = B.c;
    for (const w of plan.wins) {
      const R = Math.round(16 * u) + 4;
      B.each(w.x - R, w.y - R, w.x + w.w + R, w.y + w.h + R, (x, y) => {
        const d = sdRR(x, y, w.x + w.w / 2, w.y + w.h / 2, w.w / 2, w.h / 2, 6 * u);
        if (d < 0) return 0;
        c[0] = 255; c[1] = 255; c[2] = 246;
        return 0.3 * Math.pow(1 - clamp01(d / R), 2);
      });
    }
    bloom = B.toCanvas(8);
  }
  art = { key, plan, room, front, props, sky, shafts, bloom, sw, sh, u };
  artCache.set(key, art);
  if (artCache.size > 12) artCache.delete(artCache.keys().next().value);
  return art;
}

// ------------------------------------------------------------------ drawing

export function drawRoomBack(ctx, art, ox, oy, t, par = { x: 0, y: 0 }) {
  const s = art.sky;
  if (s) {
    const r = s.rect;
    ctx.save();
    ctx.beginPath();
    ctx.rect(ox + r.x, oy + r.y, r.w, r.h);
    ctx.clip();
    ctx.drawImage(s.canvas, ox + r.x, oy + r.y);
    for (const cl of s.clouds) {
      const span = r.w + cl.canvas.width;
      const x = ((cl.x + t * cl.speed - par.x * 6 * art.u * cl.depth) % span + span) % span - cl.canvas.width;
      ctx.drawImage(cl.canvas, Math.round(ox + r.x + x), Math.round(oy + cl.y + par.y * 2 * art.u * cl.depth));
    }
    for (let i = 0; i < s.hills.length; i++) {
      const h = s.hills[i];
      const dx = Math.round(-s.m - par.x * 10 * art.u * h.depth), dy = Math.round(-par.y * 3 * art.u * h.depth);
      ctx.drawImage(h.canvas, ox + r.x + dx, oy + h.y + dy);
      if (i === 0) {
        for (const tb of s.turbines) {
          const x = Math.round(ox + r.x + dx + tb.x), y0 = Math.round(oy + tb.base + dy);
          ctx.fillStyle = '#ffffff'; ctx.fillRect(x, y0 - tb.h, 1, tb.h);
          ctx.fillStyle = '#d6e6f0'; ctx.fillRect(x + 1, y0 - tb.h + 2, 1, tb.h - 2);
          const fr = rotorFrames(tb.h * 0.48);
          const f = fr[Math.floor((t * 1.4 + tb.ph) * fr.length / 2) % fr.length];
          ctx.drawImage(f, x - (f.width >> 1), y0 - tb.h - (f.height >> 1));
        }
      }
    }
    // lens flare from the sun (very soft)
    const sx = ox + s.sun[0], sy = oy + s.sun[1];
    ctx.globalCompositeOperation = 'lighter';
    const fl = flareSprites();
    const vx = ox + r.x + r.w * 0.62 - sx, vy = oy + r.y + r.h * 0.7 - sy;
    for (const [k, i, a] of [[0.35, 0, 0.35], [0.6, 1, 0.25], [0.85, 2, 0.3], [1.1, 1, 0.18]]) {
      const spr = fl[i];
      ctx.globalAlpha = a * (0.85 + 0.15 * Math.sin(t * 0.7 + k * 3));
      ctx.drawImage(spr, Math.round(sx + vx * k - spr.width / 2), Math.round(sy + vy * k - spr.height / 2));
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.restore();
  }
  ctx.drawImage(art.room, ox, oy);
  if (art.bloom) {
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.85;
    ctx.drawImage(art.bloom, ox, oy);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }
}

// After the tank: sun shafts over everything, foreground plant, lamp glow.
export function drawRoomFront(ctx, art, ox, oy, t, par = { x: 0, y: 0 }, lampOn = true) {
  if (art.shafts) {
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.75 + 0.25 * Math.sin(t * 0.35);
    ctx.drawImage(art.shafts, ox, oy);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }
  ctx.drawImage(art.front, Math.round(ox + par.x * 4 * art.u), oy);
  if (lampOn) {
    ctx.globalCompositeOperation = 'lighter';
    for (const p of art.props) {
      if (!p.glow || !p.glowAt) continue;
      ctx.globalAlpha = 0.8;
      ctx.drawImage(p.glow, ox + p.glowAt.x, oy + p.glowAt.y);
      if (p.bulb) {
        const b = p.bulb, gl = glowDisc();
        const cx = ox + p.rect.x + b.cx, cy = oy + p.rect.y + b.cy;
        const R = Math.round(26 * art.u) + 8;
        ctx.globalAlpha = 0.45 + 0.05 * Math.sin(t * 2);
        ctx.drawImage(gl, Math.round(cx - R), Math.round(cy - R), R * 2, R * 2);
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }
}

export function roomHit(art, x, y) {
  for (const p of art.props) {
    const r = p.rect;
    if (x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h) return p.kind;
  }
  return null;
}

// ------------------------------------------------------------------ sprites

let flareCv = null;
function flareSprites() {
  if (flareCv) return flareCv;
  const mk = (r, col, ring) => {
    const P = new Paint(r * 2 + 2, r * 2 + 2);
    const c = P.c;
    P.each(0, 0, r * 2 + 2, r * 2 + 2, (x, y) => {
      const d = Math.hypot(x - r - 1, y - r - 1) / r;
      if (d > 1) return 0;
      c[0] = col[0]; c[1] = col[1]; c[2] = col[2];
      return ring ? (d > 0.82 ? 0.6 : 0.12) : 0.5 * (1 - d * d);
    });
    return P.toCanvas(8);
  };
  flareCv = [mk(7, C('#bfffe8'), false), mk(11, C('#9fe0ff'), true), mk(5, C('#fff2a8'), false)];
  return flareCv;
}

let glowCv = null;
function glowDisc() {
  if (glowCv) return glowCv;
  const P = new Paint(48, 48);
  const c = P.c;
  P.each(0, 0, 48, 48, (x, y) => {
    const d = Math.hypot(x - 24, y - 24) / 24;
    if (d > 1) return 0;
    c[0] = 255; c[1] = 240; c[2] = 200;
    return Math.pow(1 - d, 2) * 0.6;
  });
  glowCv = P.toCanvas(8);
  return glowCv;
}

const bubbleCache = new Map();
function soapBubble(r) {
  r = Math.max(2, Math.round(r));
  let cv = bubbleCache.get(r);
  if (cv) return cv;
  const s = r * 2 + 2;
  const P = new Paint(s, s);
  const c = P.c;
  P.each(0, 0, s, s, (x, y) => {
    const dx = (x - r - 1) / r, dy = (y - r - 1) / r, d = Math.hypot(dx, dy);
    if (d > 1) return 0;
    // iridescent rim, clear centre, a glossy window highlight
    const ang = Math.atan2(dy, dx);
    c[0] = 200 + 55 * Math.sin(ang * 2 + 1); c[1] = 230 + 25 * Math.sin(ang * 2 + 3); c[2] = 255;
    if (dx > -0.62 && dx < -0.2 && dy > -0.66 && dy < -0.3) { c[0] = 255; c[1] = 255; c[2] = 255; return 0.85; }
    if (d > 0.84) return 0.65;
    return 0.06 + 0.1 * d;
  });
  cv = P.toCanvas(8);
  bubbleCache.set(r, cv);
  return cv;
}

// ------------------------------------------------------------------ ambient motes + bubbles

export class RoomAmbient {
  constructor() { this.motes = []; this.bubbles = []; this.t = 0; this.key = null; this.bubT = 2; }

  update(dt, art) {
    this.t += dt;
    const { sw, sh, u } = art;
    if (this.key !== art.key) {
      this.key = art.key;
      this.motes.length = 0; this.bubbles.length = 0;
      const n = Math.round((sw * sh) / 9000);
      for (let i = 0; i < n; i++) this.motes.push({ x: Math.random() * sw, y: Math.random() * sh, vx: (Math.random() - 0.5) * 3 * u, vy: (Math.random() - 0.3) * 2 * u, ph: Math.random() * TAU, sp: 0.6 + Math.random() * 1.6 });
    }
    for (const m of this.motes) {
      m.ph += dt * m.sp;
      m.x += (m.vx + Math.sin(m.ph * 0.7) * 2 * u) * dt;
      m.y += (m.vy + Math.cos(m.ph * 0.5) * 1.2 * u) * dt;
      if (m.x < 0) m.x += sw; if (m.x > sw) m.x -= sw;
      if (m.y < 0) m.y += sh; if (m.y > sh) m.y -= sh;
    }
    this.bubT -= dt;
    const maxB = Math.max(2, Math.round(sw / 160));
    if (this.bubT <= 0 && this.bubbles.length < maxB) {
      this.bubT = 2.5 + Math.random() * 4;
      const tk = art.plan.tank;
      let x = Math.random() * sw;
      for (let k = 0; k < 4 && x > tk.x - 10 && x < tk.x + tk.w + 10; k++) x = Math.random() * sw;
      this.bubbles.push({ x, y: sh + 10, r: (3 + Math.random() * 6) * Math.max(0.6, u), vy: -(8 + Math.random() * 10) * u, ph: Math.random() * TAU, life: 0 });
    }
    let w = 0;
    for (const b of this.bubbles) {
      b.life += dt;
      b.ph += dt * 1.3;
      b.y += b.vy * dt;
      b.x += Math.sin(b.ph) * 6 * u * dt;
      if (b.y < -20) continue;
      this.bubbles[w++] = b;
    }
    this.bubbles.length = w;
  }

  draw(ctx, art, ox, oy) {
    if (this.key !== art.key) return;
    const sky = art.sky?.rect;
    for (const m of this.motes) {
      // sparkles show up in the sunlit middle of the room, twinkling
      const tw = Math.sin(m.ph * 3);
      if (tw < 0.2) continue;
      const lit = sky ? clamp01(1 - Math.abs(m.x - (sky.x + sky.w * 0.5)) / (sky.w * 0.7)) : 0.6;
      const a = (tw - 0.2) * 0.8 * (0.3 + 0.7 * lit);
      ctx.globalAlpha = a;
      ctx.fillStyle = tw > 0.85 ? '#ffffff' : '#fff6d0';
      const x = Math.round(ox + m.x), y = Math.round(oy + m.y);
      ctx.fillRect(x, y, 1, 1);
      if (tw > 0.92 && art.u > 0.8) { ctx.fillRect(x - 1, y, 3, 1); ctx.fillRect(x, y - 1, 1, 3); }
    }
    ctx.globalAlpha = 1;
    for (const b of this.bubbles) {
      const spr = soapBubble(b.r);
      ctx.globalAlpha = Math.min(1, b.life * 2) * 0.9;
      ctx.drawImage(spr, Math.round(ox + b.x - spr.width / 2), Math.round(oy + b.y - spr.height / 2));
    }
    ctx.globalAlpha = 1;
  }
}


