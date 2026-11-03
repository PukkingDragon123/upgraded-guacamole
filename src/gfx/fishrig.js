// Fish rig entry point: drawFishRig(ctx, compiled, st) -> anchors in world coords (+ w, h of the drawn box).
// FULL VOXEL ART: every fish and creature is a detailed 3D voxel model from voxelfish.js (cartoon voxel eyes,
// Frutiger Aero gloss, spinning rotors, outfits); there is no 2D fish style any more. While a creature's very
// first voxel frame is still building, nothing is drawn for it (anchors still come back from its geometry).
// The Wakka chomper (kind 'chomper') is a chunky retro voxel model whose frame turns in 90-degree steps.
// Extra st fields: pose (iconfish mimic pose), chain ([{x,y}] head-first for chain kinds), heading (deg,
// + = swimming away from the viewer: the voxel fish turns its head into the scene), lod (0 near, 1 far:
// fewer swim frames), pri (voxel build priority bonus), silhouette (true | colour: a dark voxel silhouette),
// wash {color, alpha}, glow. turn is the world-space scaleX (-1..1) during a turn-around; turn: 1 with
// facing: -1 means "facing left". setFishStyle / getFishStyle remain for API compatibility (voxel only).

import { rigGeom, isKind, kindRotates, chainRadius, defaultChainPoints, realCues } from './fishart.js';
import { tinted, makeCanvas, ctxOf } from '../core/canvas.js';
import { voxelFrame, chainBall, setVoxelFishBudget, SWIM_N, voxelParts } from './voxelfish.js';

/** Kept for API compatibility: fish are always voxel. */
export function setFishStyle() {}
export function getFishStyle() { return 'voxel'; }
if (typeof window !== 'undefined') window.__rigStats = () => rigStats(); // debug / perf

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const fract = (v) => v - Math.floor(v);
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const DEG = Math.PI / 180;
const BASE_YAW = 15;

export function setRigBudget(ms) { setVoxelFishBudget(Math.max(1.5, ms * 0.75)); }
export function beginRigFrame() {}
let drawMs = 0, drawCalls = 0, pending = 0;
export function rigStats() { return { items: geoCache.size + washes.size, rasterized: 0, fallbacks: pending, drawMs, drawCalls, pending }; }
const geoCache = new Map();
export function clearRigCache() { geoCache.clear(); washes.clear(); }

// A voxel render washed toward a colour, keeping its facets, glints and outline readable (undiscovered-fish
// silhouettes are dark voxel renders, never flat shapes). Cached per (canvas, colour, amount).
const washes = new Map();
export function voxelWash(src, color, a = 0.8) {
  const key = color + '|' + a;
  let m = washes.get(src);
  if (!m) { washes.set(src, (m = new Map())); if (washes.size > 500) washes.delete(washes.keys().next().value); }
  let cv = m.get(key);
  if (!cv) {
    cv = makeCanvas(src.width, src.height);
    const g = ctxOf(cv);
    g.drawImage(src, 0, 0);
    g.globalCompositeOperation = 'source-atop';
    g.globalAlpha = a;
    g.fillStyle = color;
    g.fillRect(0, 0, cv.width, cv.height);
    m.set(key, cv);
  }
  return cv;
}

// World-space scaleX of the creature: -1 facing left .. 1 facing right (through 0 mid-turn).
function worldTurn(st) {
  const facing = st.facing ?? 1;
  const turn = st.turn;
  if (turn == null) return facing;
  if (turn === 1 && facing === -1) return -1;
  return clamp(turn, -1, 1);
}

// Face state shared by all eyes of a fish this frame.
function faceState(st, ang, sx, X, Y, geo) {
  let lx = 0, ly = 0;
  if (st.lookX != null && st.lookY != null) {
    let dx = (st.lookX - X) * Math.sign(sx || 1), dy = st.lookY - Y;
    const ca = Math.cos(-ang), sa = Math.sin(-ang);
    const rx = dx * ca - dy * sa, ry = dx * sa + dy * ca;
    const m = Math.hypot(rx, ry);
    if (m > 0.01) { const k = Math.min(1, m / 24) / m; lx = rx * k; ly = ry * k; }
  }
  const t = st.time || 0;
  const cue = realCues(st.emotion || 'neutral');
  const toon = geo?.toon;
  if (!toon) {
    if (cue.spin) { lx = Math.cos(t * 7) * 0.75; ly = Math.sin(t * 7) * 0.75; }
    if (cue.lx) lx = clamp(lx + cue.lx, -1, 1);
    if (cue.ly) ly = clamp(ly + cue.ly, -1, 1);
  }
  // googly pupils: gravity + jiggle + a bit of look
  const gx = lx * 0.6 + Math.sin(t * 9.1) * 0.25 * (st.speed01 ?? 0.4);
  const gy = 0.55 + ly * 0.3 + Math.cos(t * 7.3) * 0.2 * (st.speed01 ?? 0.4);
  return {
    emotion: st.emotion || 'neutral', blink: st.blink || 0, lx, ly, gx: clamp(gx, -1, 1), gy: clamp(gy, -1, 1), time: t,
    open: clamp(Math.max(st.mouth || 0, geo?.rest || 0) + (toon ? 0 : cue.gape || 0), 0, 1), pupil: toon ? 1 : cue.pupil || 1, dim: toon ? 0 : cue.dim || 0, cue,
  };
}


export function drawFishRig(ctx, c, st) {
  const t0 = now();
  let a = c.kind === 'chain' ? drawVoxelChain(ctx, c, st) : drawVoxelRig(ctx, c, st);
  if (!a) { pending++; a = placeholderAnchors(c, st); }
  drawMs += now() - t0;
  drawCalls++;
  return a;
}

// Anchors from the creature's geometry while its first voxel frame builds (nothing is drawn meanwhile).
function placeholderAnchors(c, st) {
  const X = st.x || 0, Y = (st.y || 0) + (st.bob || 0);
  if (c.kind === 'chain') {
    const pts = st.chain && st.chain.length >= 2 ? st.chain : defaultChainPoints(c, st.scale ?? 1, 0, X, Y, worldTurn(st) >= 0 ? 1 : -1);
    const r = (c.chain?.r || 4) * (st.scale ?? 1);
    const last = pts[pts.length - 1];
    return { mouth: [pts[0].x, pts[0].y], top: [pts[0].x, pts[0].y - r * 2], bottom: [pts[0].x, pts[0].y + r * 2], tail: [last.x, last.y], eyes: [], w: r * 4, h: r * 4 };
  }
  const s = Math.max(0.05, Math.round((st.scale ?? 1) * 8) / 8);
  const key = (c.id ?? c._vid ?? c.kind) + '|' + s;
  let g = geoCache.get(key);
  if (!g) { g = rigGeom(c, { sw: 0, angle: 0, scale: s, inflate: 0, still: true }); geoCache.set(key, g); if (geoCache.size > 600) geoCache.delete(geoCache.keys().next().value); }
  const sx = worldTurn(st) < 0 ? -1 : 1;
  const toW = (p) => [X + (p[0] - g.ox) * sx, Y + (p[1] - g.oy)];
  const out = { w: g.w, h: g.h };
  for (const [k, v] of Object.entries(g.anchors)) if (Array.isArray(v)) out[k] = toW(v);
  out.eyes = g.eyes.map((e) => { const [x, y] = toW([e.x, e.y]); return { x, y, r: e.r, type: e.e.type }; });
  return out;
}

function compose(ctx, items, glows, X, Y, scx, scy, st, c, bw, bh) {
  const wash = st.wash && st.wash.alpha > 0.01 ? st.wash : null;
  const sil = st.silhouette;
  const flush = st.flush;
  if (wash || sil || flush) {
    // composite into a scratch canvas centred on the origin, tint it, then place it
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [cv, dx, dy, dw, dh] of items) { x0 = Math.min(x0, dx); y0 = Math.min(y0, dy); x1 = Math.max(x1, dx + (dw ?? cv.width)); y1 = Math.max(y1, dy + (dh ?? cv.height)); }
    if (!isFinite(x0)) return;
    x0 = Math.floor(x0); y0 = Math.floor(y0);
    const w = Math.ceil(x1 - x0), h = Math.ceil(y1 - y0);
    const sc = scratchFor(w, h);
    const g = sc._g;
    for (const [cv, dx, dy, dw, dh] of items) {
      if (dw === undefined) g.drawImage(cv, dx - x0, dy - y0);
      else g.drawImage(cv, dx - x0, dy - y0, dw, dh);
    }
    g.globalCompositeOperation = 'source-atop';
    if (flush && !sil) {
      g.globalAlpha = flush[1];
      g.fillStyle = flush[0];
      g.fillRect(0, 0, w, h);
    }
    if (sil || wash) {
      g.globalAlpha = sil ? 0.86 : Math.min(1, wash.alpha);
      g.fillStyle = sil ? (typeof sil === 'string' ? sil : '#102033') : wash.color;
      g.fillRect(0, 0, w, h);
    }
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    ctx.save();
    ctx.translate(X, Y);
    ctx.scale(scx, scy);
    ctx.drawImage(sc, 0, 0, w, h, x0, y0, w, h);
    ctx.restore();
  } else {
    ctx.save();
    ctx.translate(X, Y);
    if (scx !== 1 || scy !== 1) ctx.scale(scx, scy);
    for (const [cv, dx, dy, dw, dh] of items) {
      if (dw === undefined) ctx.drawImage(cv, dx, dy);
      else ctx.drawImage(cv, dx, dy, dw, dh);
    }
    ctx.restore();
  }
  const gs = sil ? 0 : st.glow ?? (c.glow ? 1 : 0);
  if (gs > 0.01 && glows.length) {
    ctx.save();
    ctx.translate(X, Y);
    if (scx !== 1 || scy !== 1) ctx.scale(scx, scy);
    const prevOp = ctx.globalCompositeOperation, prevA = ctx.globalAlpha;
    ctx.globalCompositeOperation = 'lighter';
    for (const [cv, dx, dy, dw, dh, soft] of glows) {
      if (soft) {
        // pre-blurred voxel glow halo
        ctx.globalAlpha = prevA * Math.min(1, gs) * 0.55;
        if (dw === undefined) ctx.drawImage(cv, dx, dy); else ctx.drawImage(cv, dx, dy, dw, dh);
        continue;
      }
      ctx.globalAlpha = prevA * Math.min(1, gs) * 0.12;
      ctx.drawImage(cv, dx - 1, dy); ctx.drawImage(cv, dx + 1, dy); ctx.drawImage(cv, dx, dy - 1); ctx.drawImage(cv, dx, dy + 1);
      ctx.globalAlpha = prevA * Math.min(1, gs) * 0.45;
      ctx.drawImage(cv, dx, dy);
    }
    ctx.globalCompositeOperation = prevOp;
    ctx.globalAlpha = prevA;
    ctx.restore();
  }
}

function drawVoxelRig(ctx, c, st) {
  const kind = isKind(c);
  const tau = worldTurn(st);
  // world yaw 0..180 through the front; side-on poses sit in a slight 3/4 view so the volume reads
  const Yw = Math.acos(clamp(tau, -1, 1)) / DEG;
  const mirror = Yw > 90;
  let yaw = mirror ? 180 - Yw : Yw;
  const base = st.yawBase ?? (kindRotates(c) ? 0 : BASE_YAW); // the retro chomper reads best side-on
  yaw = base + (90 - base) * (yaw / 90) - (st.heading || 0);
  if (yaw < -90) yaw = -90;
  const S = st.scale ?? 1;
  const ang = kind ? 0 : st.angle || 0;
  const t = st.time || 0;
  const lod = st.lod || 0;
  const ph = kind ? st.swimPhase ?? t * 1.2 : st.tailPhase ?? st.swimPhase ?? t * 1.2;
  let sw = Math.floor(fract(ph) * SWIM_N) % SWIM_N;
  if (lod) sw -= sw % 2;
  const infl = kind ? 0 : Math.round(clamp(st.inflate || 0, 0, 1) * 3);
  const pose = !!(st.pose || st.emotion === 'pose');
  const res = voxelFrame(c, { S, yaw, pitch: ang / DEG, sw, infl, pose, lod, pri: st.pri ?? 1 });
  if (!res) return null; // first frame still building: the pixel rig stands in this once
  const { f, k } = res;
  const sq = clamp(st.squash || 0, -1, 1);
  const kx = k * (1 + 0.22 * sq), ky = k * (1 - 0.2 * sq);
  const fang = f.pitch * DEG; // bucketed pitch of the frame (stable face sprite keys)
  const fs = faceState(st, fang, mirror ? -1 : 1, st.x, st.y, { toon: !!c.toon, rest: c.mouth?.rest || 0 });
  const cue = fs.cue;
  const twitch = cue.twitch && !st.silhouette ? ((Math.floor(t * 23) % 3) - 1) * (Math.floor(t * 7) & 1) : 0;
  const X = Math.round(st.x) + twitch, Y = Math.round(st.y + (st.bob || 0));
  // the Wakka chomper turns in crisp 90-degree steps: the finished voxel frame is rotated (+PI/2 = down)
  const rot = kindRotates(c) ? Math.round((st.angle || 0) / (Math.PI / 2)) * (Math.PI / 2) : 0;
  const items = [[f.canvas, -f.ax, -f.ay]];
  const glows = f.glow ? [[f.glow, -f.ax, -f.ay, undefined, undefined, true]] : [];
  // real voxel face parts (eyeballs with lids, jaw gape, gill flare, spinning rotors): no 2D overlays
  if (!st.silhouette) voxelParts(items, glows, c, f, st, fs, lod);
  const scx = (mirror ? -1 : 1) * kx;
  const flush = !c.toon && cue.flush && !st.silhouette ? cue.flush : null;
  const st2 = flush ? { ...st, flush } : st;
  const translucent = (c.alpha ?? 255) < 255 && !st.silhouette;
  const prevA = ctx.globalAlpha;
  if (translucent) ctx.globalAlpha = prevA * Math.max(0.35, c.alpha / 255);
  composeVoxel(ctx, f, items, glows, X, Y, scx, ky, st2, c, rot);
  ctx.globalAlpha = prevA;
  const cr = Math.cos(rot), sr = Math.sin(rot);
  const toW = (p) => [X + (p[0] * cr - p[1] * sr) * scx, Y + (p[0] * sr + p[1] * cr) * ky];
  const out = {};
  for (const [key, v] of Object.entries(f.anchors)) out[key] = toW(v);
  out.eyes = f.eyes.map((e) => { const [x, y] = toW([e.x, e.y]); return { x, y, r: e.r * Math.abs(kx), type: e.e.type }; });
  out.w = f.W * Math.abs(kx); out.h = f.H * ky;
  if (c.variant?.shiny) out.shiny = true;
  return out;
}

// Voxel compositor: frame + overlays drawn straight through the transform; fog / darkness / colour flush
// are a cached tinted silhouette of the frame drawn over it (no per-fish scratch compositing).
function composeVoxel(ctx, f, items, glows, X, Y, scx, scy, st, c, rot = 0) {
  const wash = st.wash && st.wash.alpha > 0.01 ? st.wash : null;
  const sil = st.silhouette;
  const prevA = ctx.globalAlpha;
  ctx.save();
  ctx.translate(X, Y);
  if (scx !== 1 || scy !== 1) ctx.scale(scx, scy);
  if (rot) ctx.rotate(rot);
  if (sil) {
    ctx.drawImage(voxelWash(f.canvas, typeof sil === 'string' ? sil : '#102033', 0.86), items[0][1], items[0][2]);
    ctx.restore();
    return;
  }
  for (const [cv, dx, dy, dw, dh] of items) {
    if (dw === undefined) ctx.drawImage(cv, dx, dy);
    else ctx.drawImage(cv, dx, dy, dw, dh);
  }
  const [cv0, dx0, dy0, dw0, dh0] = items[0];
  const over = (color, a) => {
    ctx.globalAlpha = prevA * Math.min(1, a);
    const tc = tinted(cv0, color);
    if (dw0 === undefined) ctx.drawImage(tc, dx0, dy0); else ctx.drawImage(tc, dx0, dy0, dw0, dh0);
  };
  if (st.flush) over(st.flush[0], st.flush[1]);
  if (wash) over(wash.color, wash.alpha);
  ctx.globalAlpha = prevA;
  const gs = st.glow ?? (c.glow ? 1 : 0);
  if (gs > 0.01 && glows.length) {
    ctx.globalCompositeOperation = 'lighter';
    for (const [cv, dx, dy, dw, dh, soft] of glows) {
      ctx.globalAlpha = prevA * Math.min(1, gs) * (soft ? 0.55 : 0.45) * (wash ? 1 - wash.alpha * 0.5 : 1);
      if (dw === undefined) ctx.drawImage(cv, dx, dy); else ctx.drawImage(cv, dx, dy, dw, dh);
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = prevA;
  }
  ctx.restore();
}

// Chain creatures in voxel style: voxel-ball segments along the path, a voxel head pitched to the
// travel direction (mirrored when heading left), dynamic face overlays.
function drawVoxelChain(ctx, c, st) {
  const s = st.scale ?? 1;
  const t = st.time || 0;
  const sw = st.swimPhase ?? t * 1.2;
  const tau = worldTurn(st);
  const pts = st.chain && st.chain.length >= 2 ? st.chain : defaultChainPoints(c, s, sw, st.x, st.y, tau >= 0 ? 1 : -1);
  const n = pts.length;
  const X = Math.round(pts[0].x), Y = Math.round(pts[0].y);
  const dir = Math.atan2(pts[0].y - pts[1].y, pts[0].x - pts[1].x);
  const mirror = Math.cos(dir) < 0;
  let pitch = mirror ? Math.PI - dir : dir;
  pitch = Math.atan2(Math.sin(pitch), Math.cos(pitch));
  const res = voxelFrame(c, { S: s, yaw: 0, pitch: clamp(pitch / DEG, -90, 90), sw: 0, infl: 0, pose: false, lod: st.lod || 0, pri: st.pri ?? 1 });
  if (!res) return null;
  const { f, k } = res;
  const items = [];
  const sx = mirror ? -1 : 1;
  // segments tail -> head (in head-local coords; mirrored items are drawn through the same transform)
  for (let i = n - 1; i >= 1; i--) {
    const a = pts[i], b = pts[i - 1];
    const ra = chainRadius(c, i, n, s), rb = chainRadius(c, i - 1, n, s);
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    const steps = Math.max(1, Math.ceil(d / Math.max(1, Math.min(ra, rb) * 0.7)));
    for (let q = 0; q < steps; q++) {
      const u = q / steps;
      const ball = chainBall(c, ra + (rb - ra) * u);
      const wx = a.x + (b.x - a.x) * u - X, wy = a.y + (b.y - a.y) * u - Y;
      items.push([ball.canvas, Math.round(wx * sx - ball.ax), Math.round(wy - ball.ay)]);
    }
  }
  items.push([f.canvas, -f.ax * k, -f.ay * k, f.W * k, f.H * k]);
  const fs = faceState({ ...st, x: X, y: Y }, 0, sx, X, Y, { toon: !!c.toon });
  if (st.lookX == null) { fs.lx = 0.5; fs.ly = 0; }
  const partItems = [];
  if (!st.silhouette) voxelParts(partItems, [], c, f, st, fs, st.lod || 0);
  for (const it of partItems) items.push([it[0], it[1] * k, it[2] * k, it[3] * k, it[4] * k]);
  const glows = f.glow ? [[f.glow, -f.ax * k, -f.ay * k, f.W * k, f.H * k, true]] : [];
  compose(ctx, items, glows, X, Y, sx, 1, st, c, 0, 0);
  const toW = (p) => [X + p[0] * k * sx, Y + p[1] * k];
  const last = pts[n - 1];
  return {
    mouth: f.anchors.mouth ? toW(f.anchors.mouth) : [X, Y],
    top: [X, Y - c.chain.r * s * 2],
    bottom: [X, Y + c.chain.r * s * 2],
    tail: [last.x, last.y],
    eyes: f.eyes.map((e) => { const [x, y] = toW([e.x, e.y]); return { x, y, r: e.r * k, type: e.e.type }; }),
  };
}
