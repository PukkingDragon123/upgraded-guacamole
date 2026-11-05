// Fish rig entry point: drawFishRig(ctx, compiled, st) -> anchors in world coords (+ w, h of the drawn box).
// PHASE 6 LOW-POLY: every fish and creature is a faceted low-poly 3D model (src/fish/lowpolyfish.js on the shared
// WebGL2 renderer src/gfx/lowpoly.js): realistic anatomy, softly painted skin, translucent fins, small natural
// glossy eyes, Frutiger Aero gloss. Frames are cached sprite sheets (yaw bucket x swim frame x scale bucket x
// inflate x mouth) built under a per-frame time budget with nearest-frame fallback; while a creature's very first
// sheet is still pending, nothing is drawn for it (anchors still come back from its geometry). Creatures outside
// the canvas (under the current transform) are culled. The render resolution follows the canvas transform scale
// (the zoomed follow camera), so fish stay crisp up close. Realistic fish show no cartoon expressions: the jaw
// opens on bites (st.mouth) and when surprised / scared; puffers inflate (st.inflate).
// The Wakka chomper (kind 'chomper') turns in 90-degree steps.
// Extra st fields: pose (iconfish mimic pose), chain ([{x,y}] head-first for chain kinds), heading (deg,
// + = swimming away from the viewer: the fish turns its head into the scene), lod (0 near, 1 far), pri (build
// priority; >= 3 = hero close-up, < 0.5 = background: half resolution), silhouette (true | colour),
// wash {color, alpha}, glow, noCull, yawBase. turn is the world-space scaleX (-1..1) during a turn-around; turn: 1
// with facing: -1 means "facing left". setFishStyle / getFishStyle remain for API compatibility.

import { rigGeom, isKind, kindRotates, chainRadius, defaultChainPoints } from './fishart.js';
import { tinted, makeCanvas, ctxOf } from '../core/canvas.js';
import { lpFrame, lpTube, LP_SWIM, setLowpolyBudget, lowpolyStats, clearLowpolyCache } from '../fish/lowpolyfish.js';
import { realYawBase } from '../fish/realvox.js';

/** Kept for API compatibility: fish are always low-poly 3D. */
export function setFishStyle() {}
export function getFishStyle() { return 'lowpoly'; }
if (typeof window !== 'undefined') window.__rigStats = () => rigStats(); // debug / perf

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const fract = (v) => v - Math.floor(v);
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const DEG = Math.PI / 180;
const BASE_YAW = 12;

export function setRigBudget(ms) { setLowpolyBudget(Math.max(1.5, ms)); }
export function beginRigFrame() {}
let drawMs = 0, drawCalls = 0, pending = 0, culled = 0;
export function rigStats() { const s = lowpolyStats(); return { items: geoCache.size + s.sheetCount + s.poseCount, rasterized: s.sheets, fallbacks: s.fallbacks, drawMs, drawCalls, pending, culled, lowpoly: s }; }
const geoCache = new Map();
export function clearRigCache() { geoCache.clear(); washes.clear(); clearLowpolyCache(); }

// A render washed toward a colour, keeping its facets and highlights readable (undiscovered-fish silhouettes
// are dark renders, never flat shapes). Cached per (canvas, colour, amount).
const washes = new Map();
export function voxelWash(src, color, a = 0.8) {
  const key = color + '|' + a;
  let m = washes.get(src);
  if (!m) { washes.set(src, (m = new Map())); if (washes.size > 400) washes.delete(washes.keys().next().value); }
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
export { voxelWash as lowpolyWash };

// Mix a fin colour toward the water wash colour (the ridge is a flat translucent polygon).
function tintHex(a, b, t) {
  const p = (h) => { const n = parseInt(String(h).slice(1, 7), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const x = p(a), y = p(b);
  return 'rgb(' + x.map((v, i) => Math.round(v + (y[i] - v) * Math.min(1, t))).join(',') + ')';
}

// World-space scaleX of the creature: -1 facing left .. 1 facing right (through 0 mid-turn).
function worldTurn(st) {
  const facing = st.facing ?? 1;
  const turn = st.turn;
  if (turn == null) return facing;
  if (turn === 1 && facing === -1) return -1;
  return clamp(turn, -1, 1);
}

// Is the creature (roughly) outside the canvas under the current transform? Off-screen creatures are not
// rendered, only their anchors are returned.
function offscreen(ctx, c, st) {
  if (!ctx.getTransform || !ctx.canvas || st.noCull) return false;
  const m = ctx.getTransform();
  const k = Math.hypot(m.a, m.b);
  const x = st.chain && st.chain.length ? st.chain[0].x : st.x, y = st.chain && st.chain.length ? st.chain[0].y : st.y;
  if (x == null || y == null) return false;
  const sx = m.a * x + m.c * y + m.e, sy = m.b * x + m.d * y + m.f;
  const reach = (Math.max(c.L || 30, c.H || 20) * 1.6 + (st.chain ? st.chain.length * (c.chain?.r || 4) * 1.2 : 0)) * (st.scale ?? 1) * k + 16;
  const W = ctx.canvas.width, H = ctx.canvas.height;
  return sx < -reach || sy < -reach || sx > W + reach || sy > H + reach;
}

export function drawFishRig(ctx, c, st) {
  const t0 = now();
  if (offscreen(ctx, c, st)) { culled++; return placeholderAnchors(c, st); }
  let a = null;
  try { a = c.kind === 'chain' ? drawChain(ctx, c, st) : drawBody(ctx, c, st); } catch (e) { if (!c._rigErr) { c._rigErr = true; console.warn('fishrig: draw failed', e); } }
  if (!a) { pending++; a = placeholderAnchors(c, st); }
  drawMs += now() - t0;
  drawCalls++;
  return a;
}

// Anchors from the creature's geometry while its first frame builds (nothing is drawn meanwhile).
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
  if (!g) {
    try { g = rigGeom(c, { sw: 0, angle: 0, scale: s, inflate: 0, still: true }); } catch { g = { w: 30 * s, h: 14 * s, ox: 15 * s, oy: 7 * s, anchors: {}, eyes: [] }; }
    geoCache.set(key, g);
    if (geoCache.size > 600) geoCache.delete(geoCache.keys().next().value);
  }
  const sx = worldTurn(st) < 0 ? -1 : 1;
  const toW = (p) => [X + (p[0] - g.ox) * sx, Y + (p[1] - g.oy)];
  const out = { w: g.w, h: g.h };
  for (const [k, v] of Object.entries(g.anchors || {})) if (Array.isArray(v)) out[k] = toW(v);
  out.mouth = out.mouth || [X + 10 * s * sx, Y];
  out.top = out.top || [X, Y - 8 * s];
  out.bottom = out.bottom || [X, Y + 8 * s];
  out.tail = out.tail || [X - 12 * s * sx, Y];
  out.eyes = (g.eyes || []).map((e) => { const [x, y] = toW([e.x, e.y]); return { x, y, r: e.r, type: e.e?.type }; });
  return out;
}

// On-screen pixels per world unit of the current transform (the zoomed world camera, scaled panels).
function ctxScale(ctx) {
  if (!ctx.getTransform) return 1;
  const m = ctx.getTransform();
  const k = Math.hypot(m.a, m.b);
  return k > 0.05 && k < 40 ? k : 1;
}

function drawBody(ctx, c, st) {
  // solid creatures (crabs, jellies, octopus ...) do not pitch; fish pitch, inflate and open their jaws
  const solid = c.real ? c.real.plan === 'solid' : isKind(c);
  const tau = worldTurn(st);
  const Yw = Math.acos(clamp(tau, -1, 1)) / DEG; // world yaw 0..180 through the front
  const mirror = Yw > 90;
  let yaw = mirror ? 180 - Yw : Yw;
  const base = st.yawBase ?? realYawBase(c) ?? (kindRotates(c) ? 0 : BASE_YAW);
  yaw = base + (90 - base) * (yaw / 90) - (st.heading || 0);
  yaw = clamp(yaw, -90, 90);
  const zk = ctxScale(ctx);
  // background scenery fish render at half resolution (soft, cheap)
  const lowK = (st.pri ?? 1) < 0.5 && (st.scale ?? 1) * zk > 1.5 ? 0.5 : 1;
  const S = (st.scale ?? 1) * zk * lowK;
  const t = st.time || 0;
  const ph = solid ? st.swimPhase ?? t * 1.2 : st.tailPhase ?? st.swimPhase ?? t * 1.2;
  const sw = Math.floor(fract(ph) * LP_SWIM) % LP_SWIM;
  const infl = solid ? 0 : Math.round(clamp(st.inflate || 0, 0, 1) * 3);
  const surprised = st.emotion === 'surprised' || st.emotion === 'scared';
  const mouth = !solid && ((st.mouth || 0) > 0.3 || surprised) ? 1 : 0;
  const f = lpFrame(c, { S, yaw, sw, infl, mouth, pri: st.pri ?? 1 });
  if (!f) return null;
  const k = f.k / zk / lowK;
  const sq = clamp(st.squash || 0, -1, 1);
  const kx = k * (1 + 0.22 * sq), ky = k * (1 - 0.2 * sq);
  const X = Math.round(st.x * zk) / zk, Y = Math.round((st.y + (st.bob || 0)) * zk) / zk;
  // pitch: fish tilt with their swim direction; the Wakka chomper turns in crisp 90-degree steps
  const ang = kindRotates(c) ? Math.round((st.angle || 0) / (Math.PI / 2)) * (Math.PI / 2) : solid ? 0 : st.angle || 0;
  const sx = mirror ? -1 : 1;
  const translucent = (c.alpha ?? 255) < 255 && !st.silhouette;
  const prevA = ctx.globalAlpha;
  if (translucent) ctx.globalAlpha = prevA * Math.max(0.35, c.alpha / 255);
  ctx.save();
  ctx.translate(X, Y);
  if (sx < 0) ctx.scale(-1, 1);
  if (ang) ctx.rotate(ang);
  ctx.scale(kx, ky);
  const smoothPrev = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = true;
  const sil = st.silhouette;
  const wash = st.wash && st.wash.alpha > 0.01 ? st.wash : null;
  const src = sil ? voxelWash(f.canvas, typeof sil === 'string' ? sil : '#102033', 0.86) : f.canvas;
  ctx.drawImage(src, f.sx, f.sy, f.w, f.h, -f.ax, -f.ay, f.w, f.h);
  if (!sil) {
    if (wash) {
      ctx.globalAlpha = prevA * Math.min(1, wash.alpha);
      ctx.drawImage(tinted(f.canvas, wash.color), f.sx, f.sy, f.w, f.h, -f.ax, -f.ay, f.w, f.h);
      ctx.globalAlpha = prevA;
    }
    const gs = st.glow ?? (c.glow ? 1 : 0);
    const gsh = f.sheet.glow;
    if (gsh && gs > 0.01) {
      const op = ctx.globalCompositeOperation;
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = prevA * Math.min(1, gs) * 0.65 * (wash ? 1 - wash.alpha * 0.4 : 1);
      ctx.drawImage(gsh, f.sx, f.sy, f.w, f.h, -f.ax, -f.ay, f.w, f.h);
      ctx.globalCompositeOperation = op;
      ctx.globalAlpha = prevA;
    }
  }
  ctx.imageSmoothingEnabled = smoothPrev;
  ctx.restore();
  ctx.globalAlpha = prevA;
  // anchors: sprite px relative to the origin -> world
  const ca = Math.cos(ang), sa = Math.sin(ang);
  const toW = (p) => { const x = p[0] * kx, y = p[1] * ky; return [X + sx * (x * ca - y * sa), Y + (x * sa + y * ca)]; };
  const out = {};
  for (const [key, v] of Object.entries(f.anchors)) out[key] = toW(v);
  out.eyes = f.eyes.map((e) => { const [x, y] = toW([e.x, e.y]); return { x, y, r: e.r * k, type: 'real' }; });
  out.w = f.w * Math.abs(kx); out.h = f.h * ky;
  if (c.variant?.shiny) out.shiny = true;
  return out;
}

// Chain creatures (eels): faceted low-poly tube segments along the path (rotated per segment, the lit side kept
// up; a translucent dorsal ridge on realistic eels) and a low-poly head pitched to the travel direction (mirrored
// when heading left).
function drawChain(ctx, c, st) {
  const s = st.scale ?? 1;
  const t = st.time || 0;
  const sw = st.swimPhase ?? t * 1.2;
  const tau = worldTurn(st);
  const pts = st.chain && st.chain.length >= 2 ? st.chain : defaultChainPoints(c, s, sw, st.x, st.y, tau >= 0 ? 1 : -1);
  const n = pts.length;
  const X = pts[0].x, Y = pts[0].y;
  const dir = Math.atan2(pts[0].y - pts[1].y, pts[0].x - pts[1].x);
  const mirror = Math.cos(dir) < 0;
  let pitch = mirror ? Math.PI - dir : dir;
  pitch = Math.atan2(Math.sin(pitch), Math.cos(pitch));
  const zk = ctxScale(ctx);
  const f = lpFrame(c, { S: s * zk, yaw: 10, sw: 0, infl: 0, mouth: (st.mouth || 0) > 0.3 ? 1 : 0, pri: st.pri ?? 1 });
  if (!f) return null;
  const k = f.k / zk;
  const sil = st.silhouette;
  const wash = st.wash && st.wash.alpha > 0.01 ? st.wash : null;
  const prevA = ctx.globalAlpha;
  const sp = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = true;
  // body: oriented low-poly pills stamped along the path (tail first), lit side kept up
  const pill = (cv, tb, x, y, ang, r) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ang);
    if (Math.cos(ang) < 0) ctx.scale(1, -1);
    const kk = r / tb.r;
    const src = sil ? voxelWash(cv, typeof sil === 'string' ? sil : '#102033', 0.86) : cv;
    ctx.drawImage(src, -tb.ax * kk, -tb.ay * kk, tb.w * kk, tb.h * kk);
    if (wash && !sil) { ctx.globalAlpha = prevA * Math.min(1, wash.alpha); ctx.drawImage(tinted(cv, wash.color), -tb.ax * kk, -tb.ay * kk, tb.w * kk, tb.h * kk); ctx.globalAlpha = prevA; }
    ctx.restore();
  };
  const ridge = c.real ? [] : null;
  for (let i = n - 1; i >= 1; i--) {
    const a = pts[i], b = pts[i - 1];
    const ra = chainRadius(c, i, n, s), rb = chainRadius(c, i - 1, n, s);
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    if (d < 0.01) continue;
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    const tb = lpTube(c, Math.max(ra, rb) * zk);
    const steps = Math.max(1, Math.ceil(d / Math.max(0.4, Math.min(ra, rb) * 0.6)));
    for (let q = 0; q < steps; q++) {
      const u = q / steps, r = ra + (rb - ra) * u;
      if (tb) pill(tb.canvas, tb, a.x + (b.x - a.x) * u, a.y + (b.y - a.y) * u, ang, r);
    }
    if (ridge) { let nx = -(b.y - a.y) / d, ny = (b.x - a.x) / d; if (ny > 0) { nx = -nx; ny = -ny; } ridge.push([a.x, a.y, nx, ny, ra]); }
  }
  // realistic eels: a continuous translucent dorsal fin ridge along the back
  if (ridge && ridge.length > 2 && !sil) {
    const fc = c.real.seg?.fin || c.real.col?.fin || '#888888';
    ctx.save();
    ctx.beginPath();
    ridge.forEach(([x, y, nx, ny, r], i) => { const k = 0.9 * Math.min(1, i / 3); ctx[i ? 'lineTo' : 'moveTo'](x + nx * r * 0.7, y + ny * r * 0.7); void k; });
    for (let i = ridge.length - 1; i >= 0; i--) { const [x, y, nx, ny, r] = ridge[i]; const k = Math.min(1, i / 3) * Math.min(1, (ridge.length - 1 - i) / 2 + 0.3); ctx.lineTo(x + nx * r * (0.7 + 0.75 * k), y + ny * r * (0.7 + 0.75 * k)); }
    ctx.closePath();
    ctx.globalAlpha = prevA * 0.55;
    ctx.fillStyle = wash ? tintHex(fc, wash.color, wash.alpha) : fc;
    ctx.fill();
    ctx.restore();
  }
  // the head, pitched to the travel direction
  ctx.save();
  ctx.translate(X, Y);
  ctx.scale(mirror ? -1 : 1, 1);
  ctx.rotate(pitch);
  ctx.scale(k, k);
  ctx.drawImage(sil ? voxelWash(f.canvas, typeof sil === 'string' ? sil : '#102033', 0.86) : f.canvas, f.sx, f.sy, f.w, f.h, -f.ax, -f.ay, f.w, f.h);
  if (wash && !sil) {
    ctx.globalAlpha = prevA * Math.min(1, wash.alpha);
    ctx.drawImage(tinted(f.canvas, wash.color), f.sx, f.sy, f.w, f.h, -f.ax, -f.ay, f.w, f.h);
    ctx.globalAlpha = prevA;
  }
  ctx.restore();
  ctx.imageSmoothingEnabled = sp;
  const sx = mirror ? -1 : 1;
  const ca = Math.cos(pitch), sa = Math.sin(pitch);
  const toW = (p) => { const x = p[0] * k, y = p[1] * k; return [X + sx * (x * ca - y * sa), Y + (x * sa + y * ca)]; };
  const last = pts[n - 1];
  return {
    mouth: f.anchors.mouth ? toW(f.anchors.mouth) : [X, Y],
    top: [X, Y - c.chain.r * s * 2],
    bottom: [X, Y + c.chain.r * s * 2],
    tail: [last.x, last.y],
    eyes: f.eyes.map((e) => { const [x, y] = toW([e.x, e.y]); return { x, y, r: e.r * k, type: 'real' }; }),
  };
}
